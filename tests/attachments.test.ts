import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NoteDatabase } from '../lib/database';
import { saveImages } from '../lib/attachments';
let db: NoteDatabase;
const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPt8AAAAASUVORK5CYII=',
    'base64',
  ),
);
beforeEach(async () => {
  db = new NoteDatabase('images-' + crypto.randomUUID());
  await db.open();
});
afterEach(async () => {
  await db.delete();
});
describe('image attachment batches', () => {
  it('preserves all selected image bytes together', async () => {
    const files = [
      new File([png], '한글.png', { type: 'image/png' }),
      new File([png], '두 번째.png', { type: 'image/png' }),
    ];
    const saved = await saveImages(files, db);
    expect(await db.attachments.count()).toBe(2);
    expect(saved.map((image) => image.name)).toEqual(
      files.map((file) => file.name),
    );
    expect(new Uint8Array(await saved[0].blob!.arrayBuffer())).toEqual(png);
  });
  it('does not retain a partial batch when one selected file is invalid', async () => {
    const files = [
      new File([png], '정상.png', { type: 'image/png' }),
      new File(['bad'], '잘못된.png', { type: 'image/png' }),
    ];
    await expect(saveImages(files, db)).rejects.toThrow('형식과 내용');
    expect(await db.attachments.count()).toBe(0);
  });
  it('rejects oversized batches instead of silently dropping files', async () => {
    const files = Array.from(
      { length: 11 },
      () => new File([png], 'photo.png', { type: 'image/png' }),
    );
    await expect(saveImages(files, db)).rejects.toThrow('한 번에 10개');
    expect(await db.attachments.count()).toBe(0);
  });
});
