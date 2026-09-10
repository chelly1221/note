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
  TAILSCALE_SERVER_URL,
  toDocument,
  type ConnectionSettings,
  type LocalNote,
  type NoteDocument,
  type SyncSnapshot,
} from './model';
import { documentSchema } from './validation';
import { createSyncScheduler } from './sync-scheduler';

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
let rerunRequested = false;
let interval: ReturnType<typeof setInterval> | undefined;
const scheduler = createSyncScheduler(() => {
  void syncNow({ automatic: true });
});
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

export async function connectionSettings(): Promise<ConnectionSettings> {
  const settings = await getSetting<ConnectionSettings>('connection', {
    serverUrl: TAILSCALE_SERVER_URL,
    deviceName: Capacitor.isNativePlatform() ? 'Android' : '웹 브라우저',
    connected: false,
  });
  // Existing installations keep their notes and sync cursor while switching transport.
  if (!settings.serverUrl || settings.serverUrl === 'https://note.3chan.kr')
    return { ...settings, serverUrl: TAILSCALE_SERVER_URL };
  return settings;
}

export async function apiRequest<T>(
  pathname: string,
  options: RequestInit = {},
  config?: ConnectionSettings,
): Promise<T> {
  const settings = config ?? (await connectionSettings());
  const headers = new Headers(options.headers);
  if ((options.method ?? 'GET').toUpperCase() !== 'GET')
    headers.set('X-Note-Request', '1');
  const response = await fetch(`${settings.serverUrl}${pathname}`, {
    ...options,
    headers,
    credentials: 'omit',
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

export async function connectServer(deviceName: string) {
  const current = await connectionSettings();
  const next: ConnectionSettings = {
    serverUrl: TAILSCALE_SERVER_URL,
    deviceName: deviceName.trim() || '내 기기',
    connected: true,
  };
  const result = await apiRequest<{
    storageId: string;
    login: string;
    auth: string;
  }>('/api/auth/identity', {}, next);
  if (result.auth !== 'tailscale' || typeof result.login !== 'string')
    throw new Error('Tailscale 사용자 확인에 실패했어요.');
  // A different vault must never inherit revision numbers or the previous cursor.
  if (current.storageId && current.storageId !== result.storageId)
    throw new Error(
      '이 기기는 다른 저장소와 연결되어 있어요. 기존 노트를 내보낸 뒤 별도의 앱 공간에서 연결해 주세요.',
    );
  await setSetting('connection', {
    ...next,
    storageId: result.storageId,
    login: result.login,
  });
  connectionGeneration++;
  consecutiveFailures = 0;
  nextAutomaticAttempt = 0;
  publish({ state: 'idle', message: 'Tailscale로 연결됨' });
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
        message: 'Tailscale 계정 연결을 확인해 주세요.',
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
            : 'Tailscale 연결 대기 · 기기에 저장',
        nasAvailable: null,
      });
  }
}

export async function syncNow(options: { automatic?: boolean } = {}) {
  if (running) {
    rerunRequested = true;
    return;
  }
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
    if (rerunRequested) {
      rerunRequested = false;
      requestSync();
    }
  }
}

export function requestSync() {
  scheduler.request();
}
export async function refreshPending() {
  const pending = await getDb().notes.where('syncState').equals(1).count();
  publish({ pending });
  requestSync();
}
export async function startSync() {
  publish({ lastSyncedAt: await getSetting('lastSyncedAt', null) });
  const settings = await connectionSettings();
  const events =
    settings.connected && typeof EventSource !== 'undefined'
      ? new EventSource(`${settings.serverUrl}/api/sync/events`)
      : undefined;
  events?.addEventListener('open', requestSync);
  events?.addEventListener('change', requestSync);
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
    events?.close();
    clearInterval(interval);
    interval = undefined;
    scheduler.cancel();
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    window.removeEventListener('focus', requestSync);
  };
}
