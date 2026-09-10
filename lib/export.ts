import { Capacitor } from '@capacitor/core';
import { getDb, createLocalNote, setSetting } from './database';
import { type NoteDocument } from './model';
import {
  buildMarkdownFile,
  buildNotebookBackup,
  readNotebookBackup,
} from './backup';

export async function downloadFile(filename: string, blob: Blob) {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192)
      binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    const result = await Filesystem.writeFile({
      path: filename,
      data: btoa(binary),
      directory: Directory.Cache,
    });
    await Share.share({ title: filename, url: result.uri });
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function exportMarkdown(note: NoteDocument) {
  const file = await buildMarkdownFile(note);
  await downloadFile(file.filename, file.blob);
}

export async function exportNotebook() {
  const file = await buildNotebookBackup();
  await downloadFile(file.filename, file.blob);
  await setSetting('lastExportAt', new Date().toISOString());
}

export async function importMarkdown(file: File, folder: string) {
  if (file.size > 1_000_000)
    throw new Error('노트 파일은 1MB 이하로 가져올 수 있어요.');
  const content = (await file.text())
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  if (content.includes('\u0000'))
    throw new Error('텍스트 또는 마크다운 파일을 선택해 주세요.');
  const heading = content.match(/^#\s+([^\n]+)(?:\n|$)/);
  return createLocalNote({
    title: (
      heading?.[1] || file.name.replace(/\.(md|markdown|txt)$/i, '')
    ).slice(0, 300),
    content: heading
      ? content.slice(heading[0].length).replace(/^\n/, '')
      : content,
    folder,
  });
}

export async function importNotebook(file: File, db = getDb()) {
  const { notes, images } = await readNotebookBackup(file);
  const ids = new Map(
    [...images.keys()].map((id) => [id, crypto.randomUUID()]),
  );
  const files = [...images.values()].map((file) => ({
    ...file,
    id: ids.get(file.id)!,
  }));
  await db.transaction('rw', db.notes, db.attachments, async () => {
    await db.attachments.bulkAdd(files);
    for (const note of notes) {
      const content = note.content.replace(
        /attachment:([a-f0-9-]{36})/gi,
        (original, id) =>
          ids.has(id.toLowerCase())
            ? `attachment:${ids.get(id.toLowerCase())}`
            : original,
      );
      await createLocalNote(
        {
          ...note,
          id: crypto.randomUUID(),
          revision: 0,
          content,
          conflictOf: undefined,
        },
        db,
      );
    }
  });
  return notes.length;
}
