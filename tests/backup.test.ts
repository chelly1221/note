import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { NoteDatabase, createLocalNote } from '../lib/database';
import {
  buildMarkdownFile,
  buildNotebookBackup,
  readNotebookBackup,
} from '../lib/backup';
import { importNotebook } from '../lib/export';
import { newNote, toDocument } from '../lib/model';

let db: NoteDatabase;
const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPt8AAAAASUVORK5CYII=',
    'base64',
  ),
);
beforeEach(async () => {
  db = new NoteDatabase('backup-' + crypto.randomUUID());
  await db.open();
});
afterEach(async () => {
  await db.delete();
});
async function illustratedNote() {
  const id = crypto.randomUUID();
  await db.attachments.add({
    id,
    name: '사진.png',
    mime: 'image/png',
    size: png.length,
    blob: new Blob([png], { type: 'image/png' }),
    uploaded: false,
    createdAt: new Date().toISOString(),
  });
  return createLocalNote(
    {
      title: '오늘의 기록',
      content: `- [x] 사진 남기기\n![사진](attachment:${id})`,
      tags: ['일상'],
    },
    db,
  );
}
const file = (value: unknown) =>
  new File([JSON.stringify(value)], 'backup.json', {
    type: 'application/json',
  });

describe('portable exports and recoverable backups', () => {
  it('exports text-only notes as ordinary UTF-8 Markdown with a safe filename', async () => {
    const note = toDocument(
      newNote({
        title: '아이디어 / 초안',
        content: '한국어 🧡\n- [ ] 생각하기',
      }),
    );
    const result = await buildMarkdownFile(note, db);
    expect(result.filename).toBe('아이디어 _ 초안.md');
    expect(await result.blob.text()).toContain(note.content);
  });
  it('packs image bytes beside Markdown and rewrites every attachment link', async () => {
    const note = await illustratedNote();
    const result = await buildMarkdownFile(note, db);
    expect(result.filename).toBe('오늘의 기록.zip');
    const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    const markdown = strFromU8(files['오늘의 기록.md']);
    expect(markdown).not.toContain('attachment:');
    expect(markdown).toContain(`images/${note.attachments[0]}.png`);
    expect(files[`images/${note.attachments[0]}.png`]).toEqual(png);
  });
  it('round-trips a complete backup as new copies without overwriting existing notes', async () => {
    const note = await illustratedNote();
    const exported = await buildNotebookBackup(db);
    const count = await importNotebook(
      new File([exported.blob], 'backup.json'),
      db,
    );
    expect(count).toBe(1);
    expect(await db.notes.count()).toBe(2);
    const copy = (await db.notes.toArray()).find(
      (value) => value.id !== note.id,
    )!;
    expect(copy.id).not.toBe(note.id);
    expect(copy.attachments[0]).not.toBe(note.attachments[0]);
    expect(copy.content).toContain(`attachment:${copy.attachments[0]}`);
    expect(copy.dirty).toBe(true);
    expect(copy.tags).toEqual(['일상']);
    const restored = await db.attachments.get(copy.attachments[0]);
    expect(new Uint8Array(await restored!.blob!.arrayBuffer())).toEqual(png);
    expect((await db.notes.get(note.id))?.content).toBe(note.content);
  });
  it('refuses incomplete image exports instead of silently omitting an attachment', async () => {
    const note = toDocument(
      newNote({ content: `![missing](attachment:${crypto.randomUUID()})` }),
    );
    await expect(buildMarkdownFile(note, db)).rejects.toThrow('모두 동기화');
  });
  it('rejects duplicate IDs and corrupted image bytes before changing the database', async () => {
    await illustratedNote();
    const exported = await buildNotebookBackup(db);
    const raw = JSON.parse(await exported.blob.text());
    await expect(
      importNotebook(file({ ...raw, notes: [...raw.notes, ...raw.notes] }), db),
    ).rejects.toThrow('중복된 노트');
    await expect(
      importNotebook(
        file({ ...raw, attachments: [...raw.attachments, ...raw.attachments] }),
        db,
      ),
    ).rejects.toThrow('중복된 이미지');
    await expect(
      importNotebook(
        file({
          ...raw,
          attachments: [
            { ...raw.attachments[0], data: btoa('not an image'), size: 12 },
          ],
        }),
        db,
      ),
    ).rejects.toThrow('형식이나 크기');
    expect(await db.notes.count()).toBe(1);
    expect(await db.attachments.count()).toBe(1);
  });
  it('rejects missing embedded images and malformed base64 data', async () => {
    await illustratedNote();
    const exported = await buildNotebookBackup(db);
    const raw = JSON.parse(await exported.blob.text());
    await expect(
      readNotebookBackup(file({ ...raw, attachments: [] })),
    ).rejects.toThrow('누락');
    await expect(
      readNotebookBackup(
        file({ ...raw, notes: [{ ...raw.notes[0], attachments: [] }] }),
      ),
    ).rejects.toThrow('누락');
    await expect(
      readNotebookBackup(
        file({
          ...raw,
          attachments: [{ ...raw.attachments[0], data: '<script>' }],
        }),
      ),
    ).rejects.toThrow('백업 형식');
  });
});
