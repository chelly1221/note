import { getDb } from './database';
import { MAX_IMAGE_BYTES, type Attachment } from './model';
import { validImage } from './image-format';

async function prepareImage(file: File): Promise<Attachment> {
  if (
    !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)
  )
    throw new Error('PNG, JPG, GIF, WebP 이미지를 선택해 주세요.');
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error('이미지는 한 장에 12MB까지 첨부할 수 있어요.');
  if (!file.size) throw new Error('비어 있는 이미지 파일이에요.');
  if (
    !validImage(
      new Uint8Array(await file.slice(0, 16).arrayBuffer()),
      file.type,
    )
  )
    throw new Error('이미지 파일의 형식과 내용이 일치하지 않아요.');
  const attachment: Attachment = {
    id: crypto.randomUUID(),
    name: file.name.slice(0, 200),
    mime: file.type,
    size: file.size,
    blob: file,
    uploaded: false,
    createdAt: new Date().toISOString(),
  };
  return attachment;
}

export async function saveImages(
  files: File[],
  db = getDb(),
): Promise<Attachment[]> {
  if (files.length > 10)
    throw new Error('이미지는 한 번에 10개까지 첨부할 수 있어요.');
  const attachments = await Promise.all(files.map(prepareImage));
  await db.transaction('rw', db.attachments, () =>
    db.attachments.bulkAdd(attachments),
  );
  return attachments;
}

export function imageMarkdown(attachment: Attachment) {
  const name = attachment.name
    .replace(/[[\]\\\n\r]/g, '')
    .replace(/\.[^.]+$/, '');
  return `![${name}](attachment:${attachment.id})`;
}
