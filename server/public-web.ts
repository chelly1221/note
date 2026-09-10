import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TAILSCALE_SERVER_URL } from '../lib/model.ts';

export async function registerPublicWeb(
  app: FastifyInstance,
  config: { webRoot?: string; downloadsRoot?: string },
) {
  if (config.downloadsRoot) {
    await app.register(fastifyStatic, {
      root: path.resolve(config.downloadsRoot),
      prefix: '/downloads/',
      decorateReply: false,
      index: false,
      setHeaders(response, filename) {
        response.header('Cache-Control', 'no-cache');
        response.header(
          'Content-Disposition',
          `attachment; filename="${path.basename(filename)}"`,
        );
        if (filename.endsWith('.apk'))
          response.header(
            'Content-Type',
            'application/vnd.android.package-archive',
          );
      },
    });
  }
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
      `connect-src 'self' ${TAILSCALE_SERVER_URL}`,
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
}
