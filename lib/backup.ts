import { z } from 'zod';
import { getDb, type NoteDatabase } from './database';
import {
  attachmentIds,
  MAX_IMAGE_BYTES,
  toDocument,
  type Attachment,
  type NoteDocument,
} from './model';
import { documentSchema, idSchema } from './validation';
import { IMAGE_MIMES, validImage } from './image-format';

const MAX_IMAGES_BYTES = 40 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 60 * 1024 * 1024;
const backupSchema = z
  .object({
    format: z.literal('note'),
    version: z.literal(1),
    exportedAt: z.iso.datetime(),
    notes: z.array(documentSchema).max(10000),
    attachments: z
      .array(
        z
          .object({
            id: idSchema,
            name: z.string().max(200),
            mime: z.enum(IMAGE_MIMES),
            size: z.number().int().positive().max(MAX_IMAGE_BYTES),
            createdAt: z.iso.datetime(),
            data: z
              .string()
              .max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
              .regex(
                /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
              ),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();

export function safeFilename(title: string) {
  return (
    (title || '제목 없는 노트')
      .split('')
      .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
      .join('')
      .replace(/[<>:"/\\|?*]/g, '_')
      .slice(0, 100)
      .replace(/[. ]+$/g, '') || '노트'
  );
}

async function requiredImages(
  ids: string[],
  db: NoteDatabase,
): Promise<Attachment[]> {
  const files = await db.attachments.bulkGet([...new Set(ids)]);
  if (files.some((file) => !file?.blob))
    throw new Error('이미지를 모두 동기화한 후 내보내 주세요.');
  const present = files as Attachment[];
  if (
    present.reduce((sum, file) => sum + (file.blob?.size ?? 0), 0) >
    MAX_IMAGES_BYTES
  )
    throw new Error(
      '첨부 이미지가 40MB를 넘어요. 노트를 나누어 내보내거나 NAS 폴더를 백업해 주세요.',
    );
  return present;
}

export async function buildMarkdownFile(note: NoteDocument, db = getDb()) {
  const name = safeFilename(note.title);
  const images = await requiredImages(attachmentIds(note.content), db);
  if (!images.length)
    return {
      filename: `${name}.md`,
      blob: new Blob(
        [`# ${note.title || '제목 없는 노트'}\n\n${note.content}\n`],
        { type: 'text/markdown;charset=utf-8' },
      ),
    };
  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  const replacements = new Map<string, string>();
  const extensions: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  for (const image of images) {
    const filename = `images/${image.id}.${extensions[image.mime] || 'bin'}`;
    files[filename] = new Uint8Array(await image.blob!.arrayBuffer());
    replacements.set(image.id, filename);
  }
  const content = note.content.replace(
    /attachment:([a-f0-9-]{36})/gi,
    (original, id) => replacements.get(id.toLowerCase()) ?? original,
  );
  files[`${name}.md`] = strToU8(
    `# ${note.title || '제목 없는 노트'}\n\n${content}\n`,
  );
  const archive = zipSync(files, { level: 0 });
  return {
    filename: `${name}.zip`,
    blob: new Blob([new Uint8Array(archive)], { type: 'application/zip' }),
  };
}

export async function buildNotebookBackup(db = getDb()) {
  const { notes, files } = await db.transaction(
    'r',
    db.notes,
    db.attachments,
    async () => {
      const notes = await db.notes.toArray();
      if (notes.length > 10000)
        throw new Error('노트가 1만 개를 넘어요. NAS 폴더를 백업해 주세요.');
      return {
        notes,
        files: await requiredImages(
          notes.flatMap((note) => note.attachments),
          db,
        ),
      };
    },
  );
  const attachments = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.blob!.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192)
      binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    attachments.push({
      id: file.id,
      name: file.name,
      mime: file.mime,
      size: bytes.length,
      createdAt: file.createdAt,
      data: btoa(binary),
    });
  }
  const value = {
    format: 'note',
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: notes.map(toDocument),
    attachments,
  };
  const blob = new Blob([JSON.stringify(value)], { type: 'application/json' });
  if (blob.size > MAX_BACKUP_BYTES)
    throw new Error('백업이 60MB를 넘어요. NAS 폴더를 백업해 주세요.');
  return {
    filename: `노트-${new Date().toISOString().slice(0, 10)}.json`,
    blob,
  };
}

export async function readNotebookBackup(file: Blob) {
  if (file.size > MAX_BACKUP_BYTES)
    throw new Error('백업 파일은 60MB 이하로 가져올 수 있어요.');
  let decoded: unknown;
  try {
    decoded = JSON.parse(await file.text());
  } catch {
    throw new Error('백업 JSON 파일을 읽을 수 없어요.');
  }
  const result = backupSchema.safeParse(decoded);
  if (!result.success) throw new Error('지원하는 노트 백업 형식이 아니에요.');
  const backup = result.data;
  if (
    new Set(backup.notes.map((note) => note.id.toLowerCase())).size !==
    backup.notes.length
  )
    throw new Error('백업에 중복된 노트 식별자가 있어요.');
  const images = new Map<string, Attachment>();
  let total = 0;
  for (const item of backup.attachments) {
    const id = item.id.toLowerCase();
    if (images.has(id))
      throw new Error('백업에 중복된 이미지 식별자가 있어요.');
    const bytes = Uint8Array.from(atob(item.data), (character) =>
      character.charCodeAt(0),
    );
    total += bytes.length;
    if (
      total > MAX_IMAGES_BYTES ||
      bytes.length !== item.size ||
      !validImage(bytes, item.mime)
    )
      throw new Error('백업 이미지의 형식이나 크기가 일치하지 않아요.');
    images.set(id, {
      id,
      name: item.name,
      mime: item.mime,
      size: bytes.length,
      createdAt: item.createdAt,
      uploaded: false,
      blob: new Blob([bytes], { type: item.mime }),
    });
  }
  for (const note of backup.notes) {
    const embedded = attachmentIds(note.content).sort();
    const declared = [
      ...new Set(note.attachments.map((id) => id.toLowerCase())),
    ].sort();
    if (
      JSON.stringify(embedded) !== JSON.stringify(declared) ||
      declared.some((id) => !images.has(id))
    )
      throw new Error('백업에 필요한 이미지가 누락되어 있어요.');
  }
  return { notes: backup.notes, images };
}
