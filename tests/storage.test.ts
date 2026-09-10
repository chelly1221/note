import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { NoteStorage, type StorageConfig } from '../server/storage';
import { newNote, toDocument } from '../lib/model';

let root: string;
let store: NoteStorage;
let config: StorageConfig;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'note-test-'));
  const nasRoot = path.join(root, 'nas');
  await fs.mkdir(nasRoot);
  const storageId = randomUUID();
  await fs.writeFile(path.join(nasRoot, '.note-storage'), storageId);
  config = { nasRoot, stateDir: path.join(root, 'state'), storageId };
  store = new NoteStorage(config);
  await store.initialize();
});
afterEach(async () => {
  store?.close();
  await fs.rm(root, { recursive: true, force: true });
});
const mutation = () => ({
  mutationId: randomUUID(),
  note: toDocument(
    newNote({ title: '테스트 노트', content: '한국어 기록 🌸' }),
  ),
});

describe('NAS-backed storage', () => {
  it('preserves imported modification dates, then timestamps later edits on the server', async () => {
    const input = mutation();
    input.note.createdAt = '2024-02-03T04:05:06.000Z';
    input.note.updatedAt = '2025-06-07T08:09:10.000Z';
    const imported = await store.mutate(input);
    expect(imported.note.createdAt).toBe(input.note.createdAt);
    expect(imported.note.updatedAt).toBe(input.note.updatedAt);
    const edited = await store.mutate({
      mutationId: randomUUID(),
      note: { ...imported.note, content: '가져온 뒤 수정' },
    });
    expect(edited.note.createdAt).toBe(input.note.createdAt);
    expect(Date.parse(edited.note.updatedAt)).toBeGreaterThan(
      Date.parse(input.note.updatedAt),
    );
    const future = mutation();
    future.note.updatedAt = '2099-01-01T00:00:00.000Z';
    expect(
      Date.parse((await store.mutate(future)).note.updatedAt),
    ).toBeLessThan(Date.parse(future.note.updatedAt));
  });
  it('refuses to append after the NAS has been restored behind the local index', async () => {
    await store.mutate(mutation());
    const journal = path.join(config.nasRoot, 'journal');
    for (const name of await fs.readdir(journal))
      await fs.rename(
        path.join(journal, name),
        path.join(config.nasRoot, name + '.held'),
      );
    store.close();
    store = new NoteStorage(config);
    await expect(store.initialize()).rejects.toMatchObject({
      code: 'journal_rollback',
    });
  });
  it('detects duplicate journal sequence numbers before replay', async () => {
    await store.mutate(mutation());
    const journal = path.join(config.nasRoot, 'journal');
    const first = (await fs.readdir(journal))[0];
    await fs.copyFile(
      path.join(journal, first),
      path.join(journal, '0000000000000001-' + randomUUID() + '.json'),
    );
    store.close();
    store = new NoteStorage(config);
    await expect(store.initialize()).rejects.toMatchObject({
      code: 'journal_gap',
    });
  });
  it('bounds large Unicode sync pages without skipping later records', async () => {
    const ids = [];
    for (let index = 0; index < 4; index++) {
      const input = mutation();
      input.note.content = '한'.repeat(1_000_000);
      ids.push((await store.mutate(input)).note.id);
    }
    const first = await store.changes(0);
    expect(first.notes).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(
      8 * 1024 * 1024,
    );
    const second = await store.changes(first.cursor);
    expect(second.notes.map((note) => note.id)).toEqual(ids.slice(2));
    expect(second.hasMore).toBe(false);
  });
  it('commits an immutable NAS journal and readable note before acknowledgement', async () => {
    const input = mutation();
    const result = await store.mutate(input);
    expect(result.outcome).toBe('saved');
    expect(result.note.revision).toBe(1);
    const entries = await fs.readdir(path.join(config.nasRoot, 'journal'));
    expect(entries).toHaveLength(1);
    const entry = JSON.parse(
      await fs.readFile(
        path.join(config.nasRoot, 'journal', entries[0]),
        'utf8',
      ),
    );
    expect(entry.note.content).toBe(input.note.content);
    expect(
      await fs.readFile(
        path.join(config.nasRoot, 'notes', `${input.note.id}.md`),
        'utf8',
      ),
    ).toContain('한국어 기록 🌸');
  });
  it('retries the same mutation exactly once and rejects ID reuse with different content', async () => {
    const input = mutation();
    const first = await store.mutate(input);
    const second = await store.mutate(input);
    expect(second).toEqual(first);
    expect(store.lastSequence()).toBe(1);
    await expect(
      store.mutate({ ...input, note: { ...input.note, content: '다른 내용' } }),
    ).rejects.toMatchObject({ code: 'mutation_reused' });
    expect(store.lastSequence()).toBe(1);
  });
  it('detects two devices editing the same revision without overwriting either request', async () => {
    const initial = await store.mutate(mutation());
    const a = { ...initial.note, content: '안드로이드에서 작성' };
    const b = { ...initial.note, content: '웹에서 작성' };
    const [one, two] = await Promise.all([
      store.mutate({ mutationId: randomUUID(), note: a }),
      store.mutate({ mutationId: randomUUID(), note: b }),
    ]);
    expect(one.outcome).toBe('saved');
    expect(two.outcome).toBe('conflict');
    expect(two.note.content).toBe(a.content);
    expect(store.lastSequence()).toBe(2);
  });
  it('keeps delete and restore events in the synchronization feed', async () => {
    let result = await store.mutate(mutation());
    result = await store.mutate({
      mutationId: randomUUID(),
      note: { ...result.note, deletedAt: new Date().toISOString() },
    });
    expect(result.note.deletedAt).not.toBeNull();
    result = await store.mutate({
      mutationId: randomUUID(),
      note: { ...result.note, deletedAt: null },
    });
    const feed = await store.changes(0);
    expect(feed.notes.map((note) => note.revision)).toEqual([1, 2, 3]);
    expect(feed.notes[2].deletedAt).toBeNull();
  });
  it('refuses writes when the NAS identity disappears and resumes without losing queued data', async () => {
    const input = mutation();
    await fs.rename(
      path.join(config.nasRoot, '.note-storage'),
      path.join(config.nasRoot, '.marker-offline'),
    );
    await expect(store.mutate(input)).rejects.toMatchObject({
      code: 'nas_unavailable',
    });
    expect(store.lastSequence()).toBe(0);
    await fs.rename(
      path.join(config.nasRoot, '.marker-offline'),
      path.join(config.nasRoot, '.note-storage'),
    );
    expect((await store.mutate(input)).note.revision).toBe(1);
  });
  it('never creates a local directory in place of an unavailable NAS mount', async () => {
    store.close();
    store = new NoteStorage({
      ...config,
      nasRoot: path.join(root, 'unmounted'),
    });
    await expect(store.initialize()).rejects.toMatchObject({
      code: 'nas_unavailable',
    });
    await expect(fs.stat(path.join(root, 'unmounted'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('rebuilds the entire server index from only the NAS journal', async () => {
    const first = await store.mutate(mutation());
    await store.mutate({
      mutationId: randomUUID(),
      note: { ...first.note, content: '복구해야 하는 최신 내용' },
    });
    store.close();
    store = new NoteStorage({
      ...config,
      stateDir: path.join(root, 'fresh-state'),
    });
    await store.initialize();
    expect(store.getNote(first.note.id)?.content).toBe(
      '복구해야 하는 최신 내용',
    );
    expect(store.lastSequence()).toBe(2);
    expect(await store.history(first.note.id)).toHaveLength(2);
  });
  it('recovers a journal committed before an index update (crash boundary)', async () => {
    const first = await store.mutate(mutation());
    store.index.exec(
      'DELETE FROM notes; DELETE FROM changes; DELETE FROM mutations;',
    );
    store.close();
    store = new NoteStorage(config);
    await store.initialize();
    expect(store.getNote(first.note.id)).toEqual(first.note);
    expect(store.lastSequence()).toBe(1);
  });
  it('paginates changes without skipping records and rejects a cursor ahead of the server', async () => {
    for (let i = 0; i < 4; i++) await store.mutate(mutation());
    const page = await store.changes(0, 2);
    expect(page.cursor).toBe(2);
    expect(page.hasMore).toBe(true);
    const next = await store.changes(page.cursor, 2);
    expect(next.cursor).toBe(4);
    expect(next.hasMore).toBe(false);
    await expect(store.changes(99)).rejects.toMatchObject({
      code: 'cursor_invalid',
    });
  });
  it('verifies attachment bytes and prevents one ID from referring to different images', async () => {
    const id = randomUUID();
    const bytes = Buffer.from('image-data');
    await store.putAttachment(id, '사진.jpg', 'image/jpeg', bytes);
    expect((await store.attachmentBytes(id)).bytes).toEqual(bytes);
    await store.putAttachment(id, '사진.jpg', 'image/jpeg', bytes);
    await expect(
      store.putAttachment(
        id,
        '다른.jpg',
        'image/jpeg',
        Buffer.from('different'),
      ),
    ).rejects.toMatchObject({ code: 'attachment_conflict' });
    await fs.writeFile(
      path.join(config.nasRoot, 'attachments', `${id}.bin`),
      'corrupt',
    );
    await expect(store.attachmentBytes(id)).rejects.toMatchObject({
      code: 'attachment_corrupt',
    });
  });
  it('does not accept a note whose attachments have not been committed', async () => {
    const input = mutation();
    input.note.attachments = [randomUUID()];
    await expect(store.mutate(input)).rejects.toMatchObject({
      code: 'attachment_missing',
    });
    expect(store.lastSequence()).toBe(0);
  });
});
