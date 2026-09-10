import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NoteDatabase,
  applyRemote,
  createLocalNote,
  updateLocalNote,
} from '../lib/database';
import { EditWriter } from '../lib/edit-writer';
import { editableFields, toDocument } from '../lib/model';

let db: NoteDatabase;
beforeEach(async () => {
  db = new NoteDatabase('writer-' + crypto.randomUUID());
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

describe('active editor drafts', () => {
  it('serializes rapid drafts without creating false conflicts', async () => {
    const note = await createLocalNote({ title: '계속 쓰기' }, db);
    const writer = new EditWriter(note, db);
    await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        writer.write({ ...editableFields(note), content: '입력 ' + index }),
      ),
    );
    expect(await db.notes.count()).toBe(1);
    expect((await db.notes.get(note.id))?.content).toBe('입력 29');
  });
  it('preserves both tabs when they edit a shared original concurrently', async () => {
    const note = await createLocalNote(
      { title: '두 창', content: '공통 문장' },
      db,
    );
    const left = new EditWriter(note, db);
    const right = new EditWriter(note, db);
    await left.write({ ...editableFields(note), content: '첫 번째 창의 내용' });
    const saved = await right.write({
      ...editableFields(note),
      content: '두 번째 창의 내용',
    });
    expect(saved.id).not.toBe(note.id);
    expect(saved.conflictOf).toBe(note.id);
    expect((await db.notes.get(note.id))?.content).toBe('첫 번째 창의 내용');
    expect((await db.notes.get(saved.id))?.content).toBe('두 번째 창의 내용');
  });
  it('keeps queued typing on the same conflict copy', async () => {
    const note = await createLocalNote({ title: '두 창', content: '원문' }, db);
    const writer = new EditWriter(note, db);
    await updateLocalNote(note.id, { content: '다른 창' }, db);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        writer.write({ ...editableFields(note), content: '이 창 ' + index }),
      ),
    );
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(await db.notes.count()).toBe(2);
    expect((await db.notes.get(writer.id))?.content).toBe('이 창 19');
    expect((await db.notes.get(writer.id))?.title).toBe('두 창 (이 기기 사본)');
  });
  it('continues on the exact copy already preserved by network synchronization', async () => {
    const note = await createLocalNote(
      { title: '동시 작성', content: '로컬 초안', revision: 1 },
      db,
    );
    const writer = new EditWriter(note, db);
    const copy = await applyRemote(
      { ...toDocument(note), revision: 2, content: '서버의 새 버전' },
      db,
    );
    const saved = await writer.write({
      ...editableFields(note),
      content: '로컬 초안\n계속 쓴 문장',
    });
    expect(saved.id).toBe(copy?.id);
    expect(await db.notes.count()).toBe(2);
    expect((await db.notes.get(note.id))?.content).toBe('서버의 새 버전');
    expect(saved.content).toContain('계속 쓴 문장');
  });
  it('protects unrelated metadata changed in a second tab', async () => {
    const note = await createLocalNote({ title: '원문', tags: ['일상'] }, db);
    const writer = new EditWriter(note, db);
    await updateLocalNote(note.id, { tags: ['업무'] }, db);
    const saved = await writer.write({
      ...editableFields(note),
      content: '여전히 일상에 쓰는 내용',
    });
    expect((await db.notes.get(note.id))?.tags).toEqual(['업무']);
    expect(saved.tags).toEqual(['일상']);
  });
  it('allows a user to rename the copy after it has been created', async () => {
    const note = await createLocalNote({ title: '초안' }, db);
    const writer = new EditWriter(note, db);
    await updateLocalNote(note.id, { content: '다른 창' }, db);
    const copy = await writer.write({
      ...editableFields(note),
      content: '내 창',
    });
    const renamed = await writer.write({
      ...editableFields(copy),
      title: '정리한 아이디어',
    });
    expect(renamed.id).toBe(copy.id);
    expect(renamed.title).toBe('정리한 아이디어');
  });
  it('keeps conflict titles within the server title limit', async () => {
    const note = await createLocalNote({ title: '가'.repeat(300) }, db);
    const writer = new EditWriter(note, db);
    await updateLocalNote(note.id, { content: '다른 창' }, db);
    const saved = await writer.write({
      ...editableFields(note),
      content: '내 창',
    });
    expect(saved.title.length).toBeLessThanOrEqual(300);
    expect(saved.title).toContain('이 기기 사본');
  });
});
