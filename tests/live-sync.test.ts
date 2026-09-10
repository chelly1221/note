import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildApp } from '../server/app';
import { newNote, toDocument } from '../lib/model';

describe('live sync notifications', () => {
  it('authenticates the stream, announces durable saves without note contents, and closes cleanly', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'note-events-'));
    const nasRoot = path.join(root, 'nas');
    await fs.mkdir(nasRoot);
    const storageId = crypto.randomUUID();
    await fs.writeFile(path.join(nasRoot, '.note-storage'), storageId);
    const { app } = await buildApp({
      nasRoot,
      stateDir: path.join(root, 'state'),
      storageId,
      tailscaleLogins: ['owner@example.test'],
      origins: ['https://note.example.test'],
      secureCookies: true,
    });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      expect((await fetch(address + '/api/sync/events')).status).toBe(401);
      const stream = await fetch(address + '/api/sync/events', {
        headers: {
          'tailscale-user-login': 'owner@example.test',
          origin: 'https://note.example.test',
        },
        signal: controller.signal,
      });
      expect(stream.status).toBe(200);
      expect(stream.headers.get('content-type')).toContain('text/event-stream');
      expect(stream.headers.get('access-control-allow-origin')).toBe(
        'https://note.example.test',
      );
      const reader = stream.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(
        'connected',
      );
      const next = reader.read();
      const note = toDocument(
        newNote({ content: 'This content must stay out of event payloads' }),
      );
      const saved = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          'tailscale-user-login': 'owner@example.test',
          'x-note-request': '1',
        },
        payload: { mutationId: crypto.randomUUID(), note },
      });
      expect(saved.statusCode).toBe(200);
      const event = new TextDecoder().decode((await next).value);
      expect(event).toContain('event: change');
      expect(event).not.toContain(note.content);
      expect(
        JSON.parse(
          await fs.readFile(
            path.join(nasRoot, 'notes', note.id + '.json'),
            'utf8',
          ),
        ).content,
      ).toBe(note.content);
      const closed = reader.read();
      await app.close();
      expect((await closed).done).toBe(true);
    } finally {
      clearTimeout(timeout);
      controller.abort();
      await app.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
