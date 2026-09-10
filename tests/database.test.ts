import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NoteDatabase,
  acknowledgePush,
  applyRemote,
  createLocalNote,
  initializeDatabase,
  migratePreviousDatabase,
  preserveConflict,
  updateLocalNote,
} from '../lib/database';
import { toDocument } from '../lib/model';
let db: NoteDatabase;
beforeEach(async () => {
  db = new NoteDatabase(`test-${crypto.randomUUID()}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});
describe('local-first editing', () => {
  it('moves offline edits, images and settings before deleting an earlier database', async () => {
    const previous = new NoteDatabase(`previous-${crypto.randomUUID()}`);
    await initializeDatabase(previous);
    const imageId = crypto.randomUUID();
    const note = await createLocalNote(
      { content: `오프라인 글 ![사진](attachment:${imageId})` },
      previous,
    );
    await previous.attachments.put({
      id: imageId,
      name: '사진.png',
      mime: 'image/png',
      size: 3,
      blob: new Blob(['abc']),
      uploaded: false,
      createdAt: note.createdAt,
    });
    await previous.settings.put({ key: 'activeId', value: note.id });
    previous.close();
    await migratePreviousDatabase(db, [previous.name]);
    expect((await db.notes.get(note.id))?.content).toBe(note.content);
    expect((await db.notes.get(note.id))?.dirty).toBe(true);
    expect(await (await db.attachments.get(imageId))?.blob?.text()).toBe('abc');
    expect((await db.settings.get('activeId'))?.value).toBe(note.id);
    expect(await NoteDatabase.exists(previous.name)).toBe(false);
  });
  it('creates the welcome note once across repeated initialization', async () => {
    await Promise.all([initializeDatabase(db), initializeDatabase(db)]);
    expect(await db.notes.count()).toBe(1);
  });
  it('commits rapid consecutive edits without dropping the latest text', async () => {
    const note = await createLocalNote({}, db);
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        updateLocalNote(note.id, { content: `입력 ${i}` }, db),
      ),
    );
    expect((await db.notes.get(note.id))?.content).toBe('입력 29');
  });
  it('does not erase a newer edit when an older network save is acknowledged', async () => {
    const sent = await createLocalNote({ content: '전송할 내용' }, db);
    await updateLocalNote(sent.id, { content: '전송 중에 추가한 문장' }, db);
    await acknowledgePush(sent, { ...toDocument(sent), revision: 1 }, db);
    const current = await db.notes.get(sent.id);
    expect(current?.content).toBe('전송 중에 추가한 문장');
    expect(current?.dirty).toBe(true);
    expect(current?.revision).toBe(1);
  });
  it('marks a matching acknowledged edit clean', async () => {
    const sent = await createLocalNote({ content: '기록' }, db);
    await acknowledgePush(sent, { ...toDocument(sent), revision: 1 }, db);
    expect((await db.notes.get(sent.id))?.dirty).toBe(false);
  });
  it('keeps both versions of a conflicting note and queues the local copy', async () => {
    const note = await createLocalNote(
      { title: '아이디어', content: '기기의 문장' },
      db,
    );
    const remote = {
      ...toDocument(note),
      content: '다른 기기의 문장',
      revision: 1,
    };
    const copy = await preserveConflict(note.id, remote, db);
    expect(copy?.id).not.toBe(note.id);
    expect(copy?.dirty).toBe(true);
    expect(copy?.revision).toBe(0);
    expect(copy?.content).toBe('기기의 문장');
    expect(copy?.conflictOf).toBe(note.id);
    expect((await db.notes.get(note.id))?.content).toBe('다른 기기의 문장');
    expect(await db.notes.count()).toBe(2);
  });
  it('ignores an old feed revision while a newer local edit is pending', async () => {
    const note = await createLocalNote({ content: 'base', revision: 5 }, db);
    await updateLocalNote(note.id, { content: 'new local' }, db);
    await applyRemote({ ...toDocument(note), revision: 3, content: 'old' }, db);
    expect((await db.notes.get(note.id))?.content).toBe('new local');
    expect(await db.notes.count()).toBe(1);
  });
  it('extracts attachment IDs and normalizes tags on edits', async () => {
    const note = await createLocalNote({}, db);
    const id = crypto.randomUUID();
    await updateLocalNote(
      note.id,
      { content: `![photo](attachment:${id})`, tags: [' 일상 ', '일상', ''] },
      db,
    );
    expect((await db.notes.get(note.id))?.attachments).toEqual([id]);
    expect((await db.notes.get(note.id))?.tags).toEqual(['일상']);
  });
});
