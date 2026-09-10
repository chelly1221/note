import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildPublicWeb } from '../server/web';
import { TAILSCALE_SERVER_URL } from '../lib/model';

describe('public domain isolation', () => {
  it('serves the login shell but has no API, even with forged Tailscale headers', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'note-public-'));
    await fs.writeFile(
      path.join(root, 'index.html'),
      '<html>노트 연결 화면</html>',
    );
    const app = await buildPublicWeb({ webRoot: root });
    try {
      const shell = await app.inject('/');
      expect(shell.statusCode).toBe(200);
      expect(shell.headers['content-security-policy']).toContain(
        TAILSCALE_SERVER_URL,
      );
      for (const url of [
        '/api/status',
        '/api/sync/pull',
        '/%61pi/status',
        '/api/../api/status',
        '/.env',
        '/nas/note/notes/id.json',
      ]) {
        const response = await app.inject({
          url,
          headers: { 'tailscale-user-login': 'owner@example.test' },
        });
        expect(response.statusCode).toBe(404);
        expect(response.body).not.toContain('storageId');
      }
    } finally {
      await app.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
