import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { buildApp } from '../server/app';
import { newNote, toDocument } from '../lib/model';

let root: string;
let server: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;
const accessKey = 'test-key-' + randomUUID();
const origin = 'http://localhost:3000';
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'note-api-'));
  const nasRoot = path.join(root, 'nas');
  await fs.mkdir(nasRoot);
  const storageId = randomUUID();
  await fs.writeFile(path.join(nasRoot, '.note-storage'), storageId);
  server = await buildApp({
    nasRoot,
    stateDir: path.join(root, 'state'),
    storageId,
    accessKey,
    origins: [origin, 'https://localhost'],
    secureCookies: false,
  });
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { key: accessKey, deviceName: '테스트 웹' },
  });
  cookie = response.cookies[0].name + '=' + response.cookies[0].value;
});
afterEach(async () => {
  await server.app.close();
  await fs.rm(root, { recursive: true, force: true });
});
const headers = () => ({ cookie, origin, 'x-note-request': '1' });

describe('authenticated sync API', () => {
  it('allows only the built inline scripts and caches hashed assets immutably', async () => {
    const config = server.storage.config;
    await server.app.close();
    const webRoot = path.join(root, 'web');
    await fs.mkdir(path.join(webRoot, '_next/static/chunks'), {
      recursive: true,
    });
    const inline = 'window.booted = true;';
    await fs.writeFile(
      path.join(webRoot, 'index.html'),
      `<!doctype html><script>${inline}</script><script src="/_next/static/chunks/app.js"></script>`,
    );
    await fs.writeFile(
      path.join(webRoot, '_next/static/chunks/app.js'),
      'export {};',
    );
    server = await buildApp({
      ...config,
      accessKey,
      origins: [origin],
      secureCookies: true,
      webRoot,
    });
    const html = await server.app.inject({ url: '/' });
    const policy = String(html.headers['content-security-policy']);
    expect(policy).toContain(
      `'sha256-${createHash('sha256').update(inline).digest('base64')}'`,
    );
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).not.toContain("'unsafe-eval'");
    const js = await server.app.inject({ url: '/_next/static/chunks/app.js' });
    expect(js.headers['cache-control']).toContain('immutable');
    expect(html.headers['cache-control']).toBe('no-cache');
  });
  it('requires a session to read or write notes', async () => {
    expect(
      (await server.app.inject({ url: '/api/sync/pull?cursor=0' })).statusCode,
    ).toBe(401);
    expect(
      (
        await server.app.inject({
          method: 'POST',
          url: '/api/sync/push',
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
  });
  it('rejects unknown browser origins even with valid credentials', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { key: accessKey, deviceName: 'bad' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.cookies).toHaveLength(0);
  });
  it('keeps the web session HttpOnly and does not expose bearer tokens to the browser', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { key: accessKey, deviceName: '웹' },
    });
    expect(response.json().token).toBeUndefined();
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Strict');
  });
  it('supports native bearer sessions with the same authorization checks', async () => {
    const login = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://localhost', 'x-note-client': 'native' },
      payload: { key: accessKey, deviceName: 'Android' },
    });
    const token = login.json().token;
    expect(typeof token).toBe('string');
    const response = await server.app.inject({
      url: '/api/status',
      headers: {
        authorization: `Bearer ${token}`,
        origin: 'https://localhost',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().nasAvailable).toBe(true);
  });
  it('rejects forged session tokens', async () => {
    const response = await server.app.inject({
      url: '/api/status',
      headers: { authorization: 'Bearer fake.signature' },
    });
    expect(response.statusCode).toBe(401);
  });
  it('requires an explicit request marker for cookie-authenticated mutations', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie, origin },
      payload: { mutationId: randomUUID(), note: toDocument(newNote()) },
    });
    expect(response.statusCode).toBe(403);
  });
  it('validates note IDs, revisions, body shape and content size', async () => {
    for (const patch of [
      { id: '../../outside' },
      { revision: -1 },
      { title: 'x'.repeat(301) },
      { attachments: ['../secret'] },
      { content: 'x'.repeat(1_000_001) },
    ]) {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: headers(),
        payload: {
          mutationId: randomUUID(),
          note: { ...toDocument(newNote()), ...patch },
        },
      });
      expect(response.statusCode).toBe(400);
    }
  });
  it('round-trips Unicode notes through NAS storage and the changes feed', async () => {
    const note = toDocument(
      newNote({
        title: '🌸 오늘의 생각',
        content: '한글과 이모지 🧡\n- [ ] 할 일',
      }),
    );
    const push = await server.app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: headers(),
      payload: { mutationId: randomUUID(), note },
    });
    expect(push.statusCode).toBe(200);
    const pull = await server.app.inject({
      url: '/api/sync/pull?cursor=0',
      headers: headers(),
    });
    expect(pull.json().notes[0].content).toBe(note.content);
    expect(pull.json().cursor).toBe(1);
  });
  it('rejects active formats and mismatched image signatures', async () => {
    const svg = await server.app.inject({
      method: 'PUT',
      url: `/api/attachments/${randomUUID()}`,
      headers: { ...headers(), 'content-type': 'image/svg+xml' },
      payload: '<svg onload="alert(1)"/>',
    });
    expect(svg.statusCode).toBe(415);
    const fake = await server.app.inject({
      method: 'PUT',
      url: `/api/attachments/${randomUUID()}`,
      headers: { ...headers(), 'content-type': 'image/png' },
      payload: Buffer.from('not-an-image'),
    });
    expect(fake.statusCode).toBe(400);
  });
  it('uploads and retrieves an attachment only through an authenticated request', async () => {
    const id = randomUUID();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPt8AAAAASUVORK5CYII=',
      'base64',
    );
    const upload = await server.app.inject({
      method: 'PUT',
      url: `/api/attachments/${id}`,
      headers: {
        ...headers(),
        'content-type': 'image/png',
        'x-filename': encodeURIComponent('테스트.png'),
      },
      payload: png,
    });
    expect(upload.statusCode).toBe(200);
    const response = await server.app.inject({
      url: `/api/attachments/${id}`,
      headers: headers(),
    });
    expect(response.rawPayload).toEqual(png);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(
      (await server.app.inject({ url: `/api/attachments/${id}` })).statusCode,
    ).toBe(401);
  });
  it('reports NAS failure without acknowledging writes', async () => {
    await fs.rename(
      path.join(root, 'nas', '.note-storage'),
      path.join(root, 'nas', '.offline'),
    );
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: headers(),
      payload: { mutationId: randomUUID(), note: toDocument(newNote()) },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('nas_unavailable');
    expect(server.storage.lastSequence()).toBe(0);
  });
});
