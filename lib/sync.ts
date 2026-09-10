import { Capacitor } from '@capacitor/core';
import {
  getDb,
  getSetting,
  setSetting,
  acknowledgePush,
  preserveConflict,
  applyRemote,
} from './database';
import {
  normalizeServerUrl,
  toDocument,
  type ConnectionSettings,
  type LocalNote,
  type NoteDocument,
  type SyncSnapshot,
} from './model';
import { documentSchema } from './validation';

const initial: SyncSnapshot = {
  state: 'unconfigured',
  lastSyncedAt: null,
  pending: 0,
  message: '이 기기에 저장',
  nasAvailable: null,
};
let snapshot: SyncSnapshot = initial;
const listeners = new Set<() => void>();
let running = false;
let interval: ReturnType<typeof setInterval> | undefined;
let followup: ReturnType<typeof setTimeout> | undefined;
let nativeToken: string | undefined;
let nativeTokenLoaded = false;
let connectionGeneration = 0;
let consecutiveFailures = 0;
let nextAutomaticAttempt = 0;

export const subscribeSync = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getSyncSnapshot = () => snapshot;
export const getServerSyncSnapshot = () => initial;
function publish(update: Partial<SyncSnapshot>) {
  snapshot = { ...snapshot, ...update };
  for (const listener of listeners) listener();
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function tokenStore() {
  // Android uses an app-owned Keystore plugin. No secret is stored in browser storage.
  const { registerPlugin } = await import('@capacitor/core');
  return registerPlugin<{
    get(): Promise<{ value?: string }>;
    set(options: { value: string }): Promise<void>;
    remove(): Promise<void>;
  }>('NoteCredentials');
}
async function getNativeToken() {
  if (!Capacitor.isNativePlatform()) return undefined;
  if (!nativeTokenLoaded) {
    nativeToken = (await (await tokenStore()).get()).value;
    nativeTokenLoaded = true;
  }
  return nativeToken;
}

export async function connectionSettings(): Promise<ConnectionSettings> {
  return getSetting('connection', {
    serverUrl: Capacitor.isNativePlatform() ? 'https://note.3chan.kr' : '',
    deviceName: Capacitor.isNativePlatform() ? 'Android' : '웹 브라우저',
    connected: false,
  });
}

export async function apiRequest<T>(
  pathname: string,
  options: RequestInit = {},
  config?: ConnectionSettings,
): Promise<T> {
  const settings = config ?? (await connectionSettings());
  const token = await getNativeToken();
  const headers = new Headers(options.headers);
  headers.set('X-Note-Request', '1');
  if (Capacitor.isNativePlatform()) headers.set('X-Note-Client', 'native');
  if (token && pathname !== '/api/auth/login')
    headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${settings.serverUrl}${pathname}`, {
    ...options,
    headers,
    credentials: 'include',
    signal: options.signal ?? AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
    };
    throw new ApiError(
      body.code || 'server_error',
      body.message || '서버에 연결할 수 없어요.',
      response.status,
    );
  }
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json')
    ? response.json()
    : (response.blob() as Promise<T>);
}

export async function connectServer(
  serverUrl: string,
  key: string,
  deviceName: string,
) {
  const current = await connectionSettings();
  const next: ConnectionSettings = {
    serverUrl: normalizeServerUrl(serverUrl),
    deviceName: deviceName.trim() || '내 기기',
    connected: true,
  };
  if (!next.serverUrl && Capacitor.isNativePlatform())
    throw new Error('서버 주소를 입력해 주세요.');
  const result = await apiRequest<{
    connected: boolean;
    storageId: string;
    token?: string;
  }>(
    '/api/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, deviceName: next.deviceName }),
    },
    next,
  );
  // A different vault must never inherit revision numbers or the previous cursor.
  if (current.storageId && current.storageId !== result.storageId)
    throw new Error(
      '이 기기는 다른 저장소와 연결되어 있어요. 기존 노트를 내보낸 뒤 별도의 앱 공간에서 연결해 주세요.',
    );
  if (result.token) {
    await (await tokenStore()).set({ value: result.token });
    nativeToken = result.token;
    nativeTokenLoaded = true;
  }
  await setSetting('connection', { ...next, storageId: result.storageId });
  connectionGeneration++;
  consecutiveFailures = 0;
  nextAutomaticAttempt = 0;
  publish({ state: 'idle', message: '서버에 연결됨' });
  requestSync();
}

export async function disconnectServer() {
  const settings = await connectionSettings();
  connectionGeneration++;
  await setSetting('connection', { ...settings, connected: false });
  publish({
    state: 'unconfigured',
    message: '이 기기에 저장',
    nasAvailable: null,
  });
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' }, settings);
  } catch {
    /* Local disconnect remains possible offline. */
  }
  if (Capacitor.isNativePlatform()) await (await tokenStore()).remove();
  nativeToken = undefined;
  nativeTokenLoaded = true;
}

function reportConflict(originalId: string, copy: LocalNote | null) {
  if (copy && typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent('note-conflict', {
        detail: { originalId, copyId: copy.id },
      }),
    );
}

async function uploadAttachments(
  note: LocalNote,
  settings: ConnectionSettings,
) {
  const db = getDb();
  for (const id of note.attachments) {
    const attachment = await db.attachments.get(id);
    if (attachment?.uploaded) continue;
    if (!attachment?.blob)
      throw new Error('첨부 이미지가 이 기기에 없어 업로드할 수 없습니다.');
    await apiRequest(
      `/api/attachments/${id}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': attachment.mime,
          'X-Filename': encodeURIComponent(attachment.name),
        },
        body: attachment.blob,
      },
      settings,
    );
    await db.attachments.update(id, { uploaded: true });
  }
}

async function downloadAttachments(
  note: NoteDocument,
  settings: ConnectionSettings,
) {
  const db = getDb();
  for (const id of note.attachments) {
    if ((await db.attachments.get(id))?.blob) continue;
    const blob = await apiRequest<Blob>(`/api/attachments/${id}`, {}, settings);
    await db.attachments.put({
      id,
      name: '동기화한 이미지',
      mime: blob.type,
      size: blob.size,
      blob,
      uploaded: true,
      createdAt: new Date().toISOString(),
    });
  }
}

async function performSync() {
  const settings = await connectionSettings();
  const db = getDb();
  const generation = connectionGeneration;
  const pending = await db.notes.where('syncState').equals(1).toArray();
  publish({ pending: pending.length });
  if (!settings.connected) {
    publish({ state: 'unconfigured', message: '이 기기에 저장' });
    return;
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    publish({
      state: 'offline',
      message: '오프라인 · 기기에 저장',
      nasAvailable: null,
    });
    return;
  }
  publish({ state: 'syncing', message: '동기화 중' });
  try {
    const status = await apiRequest<{
      storageId: string;
      nasAvailable: boolean;
    }>('/api/status', {}, settings);
    if (generation !== connectionGeneration) return;
    if (status.storageId !== settings.storageId)
      throw new Error('서버의 저장소가 변경되어 동기화를 중지했어요.');
    publish({ nasAvailable: status.nasAvailable });
    for (const note of pending) {
      if (generation !== connectionGeneration) return;
      await uploadAttachments(note, settings);
      if (generation !== connectionGeneration) return;
      const result = await apiRequest<{
        outcome: 'saved' | 'conflict';
        note: NoteDocument;
      }>(
        '/api/sync/push',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mutationId: note.mutationId,
            note: toDocument(note),
          }),
        },
        settings,
      );
      if (generation !== connectionGeneration) return;
      const remote = documentSchema.parse(result.note);
      if (result.outcome === 'conflict')
        reportConflict(note.id, await preserveConflict(note.id, remote));
      else await acknowledgePush(note, remote);
    }
    let cursor = await getSetting('syncCursor', 0);
    let more = true;
    while (more && generation === connectionGeneration) {
      let result: {
        notes: NoteDocument[];
        cursor: number;
        hasMore: boolean;
        storageId: string;
      };
      try {
        result = await apiRequest(
          `/api/sync/pull?cursor=${cursor}`,
          {},
          settings,
        );
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.code === 'cursor_invalid' &&
          cursor !== 0
        ) {
          cursor = 0;
          await setSetting('syncCursor', 0);
          continue;
        }
        throw error;
      }
      if (generation !== connectionGeneration) return;
      if (
        result.storageId !== settings.storageId ||
        !Number.isSafeInteger(result.cursor) ||
        result.cursor < cursor
      )
        throw new Error('서버 동기화 응답을 확인할 수 없어요.');
      for (const value of result.notes) {
        const remote = documentSchema.parse(value);
        // Download before advancing the cursor so missing images are retried.
        await downloadAttachments(remote, settings);
        if (generation !== connectionGeneration) return;
        reportConflict(remote.id, await applyRemote(remote));
      }
      cursor = result.cursor;
      more = result.hasMore;
      await setSetting('syncCursor', cursor);
    }
    if (generation !== connectionGeneration) return;
    const remaining = await db.notes.where('syncState').equals(1).count();
    const lastSyncedAt = new Date().toISOString();
    await setSetting('lastSyncedAt', lastSyncedAt);
    consecutiveFailures = 0;
    nextAutomaticAttempt = 0;
    publish({
      state: 'idle',
      pending: remaining,
      lastSyncedAt,
      message: remaining ? '변경 내용 전송 대기' : 'NAS에 동기화됨',
      nasAvailable: true,
    });
    if (remaining) requestSync();
  } catch (error) {
    if (generation !== connectionGeneration) return;
    consecutiveFailures++;
    nextAutomaticAttempt =
      Date.now() +
      Math.min(5 * 60_000, 15_000 * 2 ** Math.min(consecutiveFailures - 1, 5));
    if (error instanceof ApiError && error.status === 401)
      publish({
        state: 'auth-required',
        message: '서버에 다시 연결해 주세요.',
        nasAvailable: null,
      });
    else if (error instanceof ApiError && error.code.startsWith('nas_'))
      publish({
        state: 'offline',
        message: error.message,
        nasAvailable: false,
      });
    else
      publish({
        state: 'error',
        message:
          error instanceof Error && error.name !== 'TypeError'
            ? error.message
            : '서버 연결을 기다리는 중 · 기기에 저장',
        nasAvailable: null,
      });
  }
}

export async function syncNow(options: { automatic?: boolean } = {}) {
  if (running) return;
  if (
    options.automatic &&
    (snapshot.state === 'auth-required' || Date.now() < nextAutomaticAttempt)
  )
    return;
  running = true;
  try {
    // One network sync owner per browser origin; other tabs receive IndexedDB updates.
    if (typeof navigator !== 'undefined' && navigator.locks)
      await navigator.locks.request(
        'note-sync',
        { ifAvailable: true },
        async (lock) => {
          if (lock) await performSync();
        },
      );
    else await performSync();
  } finally {
    running = false;
  }
}

export function requestSync() {
  clearTimeout(followup);
  followup = setTimeout(() => {
    void syncNow({ automatic: true });
  }, 1200);
}
export async function refreshPending() {
  const pending = await getDb().notes.where('syncState').equals(1).count();
  publish({ pending });
  requestSync();
}
export async function startSync() {
  publish({ lastSyncedAt: await getSetting('lastSyncedAt', null) });
  if (!interval)
    interval = setInterval(() => {
      void syncNow({ automatic: true });
    }, 15000);
  const online = () => {
    nextAutomaticAttempt = 0;
    requestSync();
  };
  const offline = () => {
    if (snapshot.state !== 'unconfigured')
      publish({
        state: 'offline',
        message: '오프라인 · 기기에 저장',
        nasAvailable: null,
      });
  };
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  window.addEventListener('focus', requestSync);
  requestSync();
  return () => {
    clearInterval(interval);
    interval = undefined;
    clearTimeout(followup);
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    window.removeEventListener('focus', requestSync);
  };
}
