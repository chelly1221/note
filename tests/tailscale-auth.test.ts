import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildApp } from '../server/app';
import { newNote, toDocument } from '../lib/model';

let root: string;
let server: Awaited<ReturnType<typeof buildApp>>;
const login = 'owner@example.test';
const origin = 'https://note.example.test';
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'note-tailscale-'));
  const nasRoot = path.join(root, 'nas');
  await fs.mkdir(nasRoot);
  const storageId = crypto.randomUUID();
  await fs.writeFile(path.join(nasRoot, '.note-storage'), storageId);
  server = await buildApp({
    nasRoot,
    stateDir: path.join(root, 'state'),
    storageId,
    tailscaleLogins: [login],
    origins: [origin, 'https://localhost'],
    secureCookies: true,
  });
});
afterEach(async () => {
  await server.app.close();
  await fs.rm(root, { recursive: true, force: true });
});
describe('Tailscale Serve identity authorization', () => {
  it('rejects absent identity and other tailnet users even with an old cookie or bearer', async () => {
    for (const headers of [
      {},
      { 'tailscale-user-login': 'guest@example.test' },
      {
        authorization: 'Bearer old-session',
        cookie: 'note_session=old-cookie',
      },
    ]) {
      const result = await server.app.inject({ url: '/api/status', headers });
      expect(result.statusCode).toBe(401);
      expect(result.json().code).toBe('tailscale_required');
    }
  });
  it('authenticates every request without a password, cookie, or token', async () => {
    const headers = {
      origin,
      'tailscale-user-login': login,
      'x-note-request': '1',
    };
    const identity = await server.app.inject({
      url: '/api/auth/identity',
      headers,
    });
    expect(identity.statusCode).toBe(200);
    expect(identity.json()).toMatchObject({ login, auth: 'tailscale' });
    expect(identity.headers['set-cookie']).toBeUndefined();
    const note = toDocument(newNote({ content: 'Tailscale 전용 저장 검증' }));
    const saved = await server.app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers,
      payload: { mutationId: crypto.randomUUID(), note },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().note.content).toBe(note.content);
    expect((await server.app.inject({ url: '/api/status' })).statusCode).toBe(
      401,
    );
    expect(
      (
        await server.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers,
          payload: { key: 'any-old-key', deviceName: 'old client' },
        })
      ).statusCode,
    ).toBe(404);
  });
  it('enforces browser origins and explicit mutation headers even for the owner', async () => {
    const payload = {
      mutationId: crypto.randomUUID(),
      note: toDocument(newNote()),
    };
    expect(
      (
        await server.app.inject({
          method: 'POST',
          url: '/api/sync/push',
          payload,
          headers: { 'tailscale-user-login': login },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await server.app.inject({
          url: '/api/auth/identity',
          headers: {
            origin: 'https://untrusted.test',
            'tailscale-user-login': login,
          },
        })
      ).statusCode,
    ).toBe(403);
    const preflight = await server.app.inject({
      method: 'OPTIONS',
      url: '/api/sync/push',
      headers: { origin, 'access-control-request-method': 'POST' },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
  });
});
