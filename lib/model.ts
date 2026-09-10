export const APP_VERSION = '0.2.4';
export const ANDROID_DOWNLOAD_URL = `https://note.3chan.kr/downloads/note-${APP_VERSION}.apk`;
export const TAILSCALE_SERVER_URL = 'https://audax-vm.tail62313c.ts.net:8443';
export const DEFAULT_FOLDER = '기본 노트';
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_NOTE_LENGTH = 1_000_000;

export interface NoteDocument {
  id: string;
  title: string;
  content: string;
  folder: string;
  tags: string[];
  pinned: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  attachments: string[];
  conflictOf?: string;
}

export interface LocalNote extends NoteDocument {
  dirty: boolean;
  syncState: 0 | 1;
  mutationId: string;
}

export type EditableNote = Pick<
  NoteDocument,
  'title' | 'content' | 'folder' | 'tags' | 'pinned' | 'deletedAt'
>;

export function editableFields(note: EditableNote): EditableNote {
  return {
    title: note.title,
    content: note.content,
    folder: note.folder,
    tags: [...note.tags],
    pinned: note.pinned,
    deletedAt: note.deletedAt,
  };
}

export function conflictTitle(title: string) {
  const suffix = ' (이 기기 사본)';
  return `${(title || '제목 없는 노트').slice(0, 300 - suffix.length)}${suffix}`;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  blob?: Blob;
  uploaded: boolean;
  createdAt: string;
}

export interface ConnectionSettings {
  serverUrl: string;
  deviceName: string;
  connected: boolean;
  storageId?: string;
  login?: string;
}

export interface SyncSnapshot {
  state:
    | 'unconfigured'
    | 'idle'
    | 'syncing'
    | 'offline'
    | 'error'
    | 'auth-required';
  lastSyncedAt: string | null;
  pending: number;
  message: string;
  nasAvailable: boolean | null;
}

export function newNote(patch: Partial<NoteDocument> = {}): LocalNote {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: '',
    content: '',
    folder: DEFAULT_FOLDER,
    tags: [],
    pinned: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    attachments: [],
    ...patch,
    ...(patch.content !== undefined
      ? { attachments: attachmentIds(patch.content) }
      : {}),
    ...(patch.title !== undefined ? { title: patch.title.slice(0, 300) } : {}),
    ...(patch.tags ? { tags: normalizeTags(patch.tags) } : {}),
    dirty: true,
    syncState: 1,
    mutationId: crypto.randomUUID(),
  };
}

export function toDocument(note: LocalNote): NoteDocument {
  const {
    dirty: _dirty,
    syncState: _syncState,
    mutationId: _mutation,
    ...document
  } = note;
  return document;
}

export function attachmentIds(content: string): string[] {
  return [
    ...new Set(
      [...content.matchAll(/attachment:([a-f0-9-]{36})/gi)].map((match) =>
        match[1].toLowerCase(),
      ),
    ),
  ];
}

export function notePreview(content: string): string {
  return content
    .slice(0, 1200)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [이미지] ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s|>\s|[-*+]\s(?:\[[ xX]\]\s)?)/gm, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export function normalizeTags(value: string | string[]): string[] {
  return [
    ...new Set(
      (Array.isArray(value) ? value : value.split(/[,#\n]/))
        .map((t) => t.trim().slice(0, 40))
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

export function normalizeServerUrl(input: string): string {
  const value = input.trim().replace(/\/+$/, '');
  if (!value) return '';
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('서버의 기본 주소만 입력해 주세요.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error('HTTPS 서버 주소를 입력해 주세요.');
  return url.origin;
}
