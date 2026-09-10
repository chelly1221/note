import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildApp } from '../server/app';
import { newNote, toDocument } from '../lib/model';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock('../lib/tailscale', () => ({
  ensureTailscale: async () => {},
  tailscaleFetch: (input: string, options: RequestInit) =>
    fetch(input, options),
  subscribeTailEvents: () => () => {},
}));
let root: string;
let server: Awaited<ReturnType<typeof buildApp>>;
let dbModule: typeof import('../lib/database');
let sync: typeof import('../lib/sync');
let fetchMock: ReturnType<typeof vi.fn>;
let afterRequest: ((route: string) => Promise<void>) | undefined;
let beforeRequest: ((route: string) => Promise<void>) | undefined;
const storageId = crypto.randomUUID();

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('window', new EventTarget());
  dbModule = await import('../lib/database');
  sync = await import('../lib/sync');
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'note-sync-'));
  const nasRoot = path.join(root, 'nas');
  await fs.mkdir(nasRoot);
  await fs.writeFile(path.join(nasRoot, '.note-storage'), storageId);
  server = await buildApp({
    nasRoot,
    stateDir: path.join(root, 'state'),
    storageId,
    tailscaleLogins: ['owner@example.test'],
    origins: ['https://notes.test'],
    secureCookies: true,
  });
  afterRequest = undefined;
  beforeRequest = undefined;
  fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const route = new URL(input).pathname + new URL(input).search;
    await beforeRequest?.(route);
    const headers = Object.fromEntries(new Headers(init.headers));
    let payload = init.body;
    if (payload instanceof Blob)
      payload = Buffer.from(await payload.arrayBuffer()) as unknown as BodyInit;
    const result = await server.app.inject({
      method: (init.method ?? 'GET') as 'GET' | 'POST' | 'PUT',
      url: route,
      headers: { ...headers, 'tailscale-user-login': 'owner@example.test' },
      payload: payload as string | undefined,
    });
    await afterRequest?.(route);
    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(result.headers))
      if (value !== undefined) responseHeaders.set(key, String(value));
    return new Response(new Uint8Array(result.rawPayload), {
      status: result.statusCode,
      headers: responseHeaders,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  await dbModule.setSetting('connection', {
    serverUrl: 'https://notes.test',
    deviceName: 'Test browser',
    connected: true,
    storageId,
  });
});

afterEach(async () => {
  // Clear the client retry timer through its public lifecycle.
  const stop = await sync.startSync();
  stop();
  await dbModule.getDb().delete();
  await server.app.close();
  await fs.rm(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('client synchronization against the real API', () => {
  it('uploads image bytes before committing the note, then advances the cursor', async () => {
    const imageId = crypto.randomUUID();
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPt8AAAAASUVORK5CYII=',
      'base64',
    );
    await dbModule.getDb().attachments.add({
      id: imageId,
      name: 'picture.png',
      mime: 'image/png',
      size: bytes.length,
      blob: new Blob([bytes], { type: 'image/png' }),
      uploaded: false,
      createdAt: new Date().toISOString(),
    });
    const note = await dbModule.createLocalNote({
      content: `이미지\n![photo](attachment:${imageId})`,
    });
    await sync.syncNow();
    expect(sync.getSyncSnapshot().state).toBe('idle');
    expect((await dbModule.getDb().notes.get(note.id))?.dirty).toBe(false);
    expect(server.storage.getNote(note.id)?.content).toBe(note.content);
    expect(
      await fs.readFile(
        path.join(root, 'nas', 'attachments', imageId + '.bin'),
      ),
    ).toEqual(bytes);
    const routes = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(
      routes.findIndex((route) => route.includes('/attachments/')),
    ).toBeLessThan(routes.findIndex((route) => route.endsWith('/sync/push')));
    expect(await dbModule.getSetting('syncCursor', 0)).toBe(1);
  });

  it('preserves typing that arrives while a network save is in flight', async () => {
    const note = await dbModule.createLocalNote({ content: '첫 문장' });
    afterRequest = async (route) => {
      if (route === '/api/sync/push') {
        afterRequest = undefined;
        await dbModule.updateLocalNote(note.id, {
          content: '첫 문장\n전송 중 계속 쓴 내용',
        });
      }
    };
    await sync.syncNow();
    const pending = await dbModule.getDb().notes.get(note.id);
    expect(pending?.content).toContain('계속 쓴 내용');
    expect(pending?.dirty).toBe(true);
    expect(pending?.revision).toBe(1);
    await sync.syncNow();
    expect(server.storage.getNote(note.id)?.content).toBe(pending?.content);
    expect(sync.getSyncSnapshot().pending).toBe(0);
  });

  it('keeps two devices’ conflicting revisions and uploads exactly one local copy', async () => {
    const original = toDocument(newNote({ content: '공통 원문' }));
    const first = await server.storage.mutate({
      mutationId: crypto.randomUUID(),
      note: original,
    });
    await dbModule.applyRemote(first.note);
    await dbModule.updateLocalNote(original.id, {
      content: '오프라인에서 쓴 문장',
    });
    await server.storage.mutate({
      mutationId: crypto.randomUUID(),
      note: { ...first.note, content: '다른 기기에서 쓴 문장' },
    });
    await sync.syncNow();
    const notes = await dbModule.getDb().notes.toArray();
    expect(notes).toHaveLength(2);
    expect(notes.find((note) => note.id === original.id)?.content).toBe(
      '다른 기기에서 쓴 문장',
    );
    const copy = notes.find((note) => note.conflictOf === original.id)!;
    expect(copy.content).toBe('오프라인에서 쓴 문장');
    await sync.syncNow();
    expect(await dbModule.getDb().notes.toArray()).toHaveLength(2);
    expect(server.storage.getNote(copy.id)?.content).toBe(copy.content);
  });

  it('keeps the outbox during NAS failure, backs off automatically, and allows manual retry', async () => {
    const note = await dbModule.createLocalNote({
      content: '연결이 없어도 지킬 기록',
    });
    await fs.rename(
      path.join(root, 'nas', '.note-storage'),
      path.join(root, 'nas', '.offline'),
    );
    await sync.syncNow();
    expect(sync.getSyncSnapshot().state).toBe('offline');
    expect((await dbModule.getDb().notes.get(note.id))?.dirty).toBe(true);
    const requests = fetchMock.mock.calls.length;
    await sync.syncNow({ automatic: true });
    expect(fetchMock.mock.calls).toHaveLength(requests);
    await fs.rename(
      path.join(root, 'nas', '.offline'),
      path.join(root, 'nas', '.note-storage'),
    );
    await sync.syncNow();
    expect(sync.getSyncSnapshot().state).toBe('idle');
    expect(server.storage.getNote(note.id)?.content).toBe(note.content);
  });

  it('does not push pending notes after disconnecting during the status request', async () => {
    const note = await dbModule.createLocalNote({
      content: '연결 해제 도중의 기록',
    });
    afterRequest = async (route) => {
      if (route === '/api/status') {
        afterRequest = undefined;
        await sync.disconnectServer();
      }
    };
    await sync.syncNow();
    expect(sync.getSyncSnapshot().state).toBe('unconfigured');
    expect(server.storage.getNote(note.id)).toBeNull();
    expect((await dbModule.getDb().notes.get(note.id))?.dirty).toBe(true);
  });

  it('stops automatic network retries after an expired session', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ code: 'auth_required', message: '다시 연결' }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
    );
    await sync.syncNow();
    expect(sync.getSyncSnapshot().state).toBe('auth-required');
    const requests = fetchMock.mock.calls.length;
    await sync.syncNow({ automatic: true });
    expect(fetchMock.mock.calls).toHaveLength(requests);
  });
});
