import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z, ZodError } from 'zod';
import { idSchema, mutationSchema } from '../lib/validation.ts';
import { MAX_IMAGE_BYTES, APP_VERSION } from '../lib/model.ts';
import { validImage } from '../lib/image-format.ts';
import { NoteStorage, StorageError, type StorageConfig } from './storage.ts';

export interface AppConfig extends StorageConfig {
  accessKey: string;
  origins: string[];
  secureCookies: boolean;
  webRoot?: string;
  logger?: boolean;
}

function deadline<T>(promise: Promise<T>, timeoutMs = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new StorageError(
              'nas_timeout',
              'NAS 응답을 기다리고 있어요. 기기에 저장한 뒤 다시 연결합니다.',
            ),
          ),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function buildApp(config: AppConfig) {
  if (config.accessKey.length < 24)
    throw new Error('NOTE access key must contain at least 24 characters.');
  const app = Fastify({
    logger: config.logger ?? false,
    bodyLimit: MAX_IMAGE_BYTES + 1024,
    requestTimeout: 20000,
    // Exactly one shared Caddy proxy reaches this container; the published port is loopback-only.
    trustProxy: (_address, hop) => hop === 0,
  });
  const storage = new NoteStorage(config);
  const secret = createHash('sha256')
    .update(`note-session:${config.accessKey}`)
    .digest();
  const keyDigest = createHash('sha256').update(config.accessKey).digest();
  const origins = new Set(config.origins);
  let initError = false;
  try {
    await deadline(storage.initialize());
  } catch {
    initError = true;
  }
  const sign = (payload: string) =>
    createHmac('sha256', secret).update(payload).digest('base64url');
  function makeSession(deviceName: string) {
    const payload = Buffer.from(
      JSON.stringify({
        expires: Date.now() + 30 * 86400000,
        deviceName,
        nonce: randomBytes(16).toString('hex'),
      }),
    ).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }
  function readSession(
    token: string | undefined,
  ): { expires: number; deviceName: string } | null {
    if (!token || token.length > 4096) return null;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return null;
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      return null;
    try {
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return typeof value.expires === 'number' &&
        value.expires > Date.now() &&
        typeof value.deviceName === 'string'
        ? value
        : null;
    } catch {
      return null;
    }
  }

  await app.register(cors, {
    origin: (origin, callback) =>
      callback(null, !origin || origins.has(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Note-Client',
      'X-Note-Request',
      'X-Filename',
    ],
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });
  app.addContentTypeParser(
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    if (origin && !origins.has(origin))
      return reply.code(403).send({
        code: 'origin_denied',
        message: '이 앱 주소에서는 서버에 연결할 수 없어요.',
      });
    if (
      request.method === 'OPTIONS' ||
      ['/api/health', '/api/auth/login'].includes(request.url.split('?')[0])
    )
      return;
    const bearer = request.headers.authorization?.startsWith('Bearer ')
      ? request.headers.authorization.slice(7)
      : undefined;
    const session = readSession(bearer ?? request.cookies.note_session);
    if (!session)
      return reply.code(401).send({
        code: 'auth_required',
        message: '서버 연결 키를 입력해 주세요.',
      });
    if (
      request.method !== 'GET' &&
      request.headers['x-note-request'] !== '1'
    )
      return reply.code(403).send({
        code: 'request_denied',
        message: '요청을 확인할 수 없습니다.',
      });
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        code: 'invalid_input',
        message: '입력한 형식이나 크기를 확인해 주세요.',
      });
    if (error instanceof StorageError)
      return reply
        .code(error.statusCode)
        .send({ code: error.code, message: error.message });
    const details = error as {
      statusCode?: number;
      code?: string;
      name?: string;
    };
    const status =
      typeof details.statusCode === 'number' ? details.statusCode : 500;
    app.log.error(
      { code: details.code ?? 'internal', name: details.name },
      'Request failed',
    );
    return reply.code(status).send({
      code: status === 429 ? 'rate_limited' : 'request_failed',
      message:
        status === 429
          ? '잠시 후 다시 시도해 주세요.'
          : '요청을 처리하지 못했어요. 기기의 기록은 유지됩니다.',
    });
  });

  app.get('/api/health', async (_request, reply) => {
    try {
      await deadline(storage.assertAvailable());
      return { app: 'note', version: APP_VERSION, storageReady: !initError };
    } catch {
      return reply
        .code(503)
        .send({ app: 'note', version: APP_VERSION, storageReady: false });
    }
  });
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = z
        .object({
          key: z.string().max(512),
          deviceName: z.string().trim().min(1).max(80),
        })
        .strict()
        .parse(request.body);
      if (
        !timingSafeEqual(
          createHash('sha256').update(input.key).digest(),
          keyDigest,
        )
      )
        return reply
          .code(401)
          .send({ code: 'invalid_key', message: '연결 키가 맞지 않아요.' });
      const token = makeSession(input.deviceName);
      reply.setCookie('note_session', token, {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'strict',
        path: '/api',
        maxAge: 30 * 86400,
      });
      return {
        connected: true,
        storageId: config.storageId,
        ...(request.headers['x-note-client'] === 'native' ? { token } : {}),
      };
    },
  );
  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie('note_session', { path: '/api' });
    return { disconnected: true };
  });
  app.get('/api/status', async () => {
    await deadline(storage.initialize());
    initError = false;
    return {
      storageId: config.storageId,
      nasAvailable: true,
      version: APP_VERSION,
      serverTime: new Date().toISOString(),
    };
  });
  app.post('/api/sync/push', async (request) =>
    deadline(storage.mutate(mutationSchema.parse(request.body))),
  );
  app.get('/api/sync/pull', async (request) => {
    const { cursor } = z
      .object({
        cursor: z.coerce
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .default(0),
      })
      .parse(request.query);
    return deadline(storage.changes(cursor));
  });
  app.get('/api/notes/:id/history', async (request) => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    return { versions: await deadline(storage.history(id)) };
  });
  app.put('/api/attachments/:id', async (request) => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const mime = request.headers['content-type']?.split(';')[0] ?? '';
    const bytes = request.body;
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length === 0 ||
      bytes.length > MAX_IMAGE_BYTES ||
      !validImage(bytes, mime)
    )
      throw new StorageError(
        'invalid_image',
        'PNG, JPG, GIF, WebP 이미지를 12MB 이하로 첨부해 주세요.',
        400,
      );
    let name = 'image';
    try {
      name = decodeURIComponent(
        String(request.headers['x-filename'] ?? 'image'),
      ).slice(0, 200);
    } catch {
      throw new StorageError(
        'invalid_filename',
        '파일 이름을 읽을 수 없습니다.',
        400,
      );
    }
    return deadline(storage.putAttachment(id, name, mime, bytes));
  });
  app.get('/api/attachments/:id', async (request, reply) => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const { metadata, bytes } = await deadline(storage.attachmentBytes(id));
    reply
      .header('Content-Type', metadata.mime)
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(metadata.name)}`,
      );
    return bytes;
  });

  if (config.webRoot) {
    await fs.access(path.join(config.webRoot, 'index.html'));
    const scriptHashes = new Set<string>();
    for (const name of (await fs.readdir(config.webRoot)).filter((name) =>
      name.endsWith('.html'),
    )) {
      const html = await fs.readFile(path.join(config.webRoot, name), 'utf8');
      for (const match of html.matchAll(
        /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
      )) {
        if (!/\bsrc\s*=/.test(match[1]))
          scriptHashes.add(
            `'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`,
          );
      }
    }
    const contentPolicy = [
      "default-src 'self'",
      `script-src 'self' ${[...scriptHashes].join(' ')}`,
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "font-src 'self'",
      "connect-src 'self' https:",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; ');
    await app.register(fastifyStatic, {
      root: path.resolve(config.webRoot),
      index: ['index.html'],
      setHeaders(response, filename) {
        response.header('Content-Security-Policy', contentPolicy);
        response.header(
          'Cache-Control',
          filename.endsWith('.html') || filename.endsWith('sw.js')
            ? 'no-cache'
            : filename.includes(`${path.sep}_next${path.sep}static${path.sep}`)
              ? 'public, max-age=31536000, immutable'
              : 'public, max-age=3600',
        );
      },
    });
  }
  app.addHook('onClose', async () => storage.close());
  return { app, storage };
}
