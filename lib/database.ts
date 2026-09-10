import Dexie, { type EntityTable } from 'dexie';
import {
  attachmentIds,
  conflictTitle,
  editableFields,
  newNote,
  normalizeTags,
  MAX_NOTE_LENGTH,
  type Attachment,
  type EditableNote,
  type LocalNote,
  type NoteDocument,
} from './model';

export class NoteDatabase extends Dexie {
  notes!: EntityTable<LocalNote, 'id'>;
  attachments!: EntityTable<Attachment, 'id'>;
  settings!: EntityTable<{ key: string; value: unknown }, 'key'>;
  constructor(name = 'note') {
    super(name);
    this.version(1).stores({
      notes: 'id, updatedAt, folder, *tags',
      attachments: 'id, createdAt',
      settings: 'key',
    });
    this.version(2)
      .stores({
        notes: 'id, updatedAt, folder, *tags, syncState',
        attachments: 'id, createdAt',
        settings: 'key',
      })
      .upgrade((transaction) =>
        transaction
          .table('notes')
          .toCollection()
          .modify((note) => {
            note.syncState = note.dirty ? 1 : 0;
          }),
      );
  }
}

let singleton: NoteDatabase | undefined;
export const getDb = () => (singleton ??= new NoteDatabase());

export async function getSetting<T>(
  key: string,
  fallback: T,
  db = getDb(),
): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}
export async function setSetting(key: string, value: unknown, db = getDb()) {
  await db.settings.put({ key, value });
}

const initializing = new WeakMap<NoteDatabase, Promise<void>>();
export function initializeDatabase(db = getDb()) {
  let operation = initializing.get(db);
  if (!operation) {
    operation = initializeOnce(db).finally(() => initializing.delete(db));
    initializing.set(db, operation);
  }
  return operation;
}

async function initializeOnce(db: NoteDatabase) {
  await db.open();
  if (db.name === 'note') await migratePreviousDatabase(db);
  await db.transaction('rw', db.notes, db.settings, async () => {
    if (await db.settings.get('initialized')) return;
    // The old preview is migrated once without discarding user edits.
    let imported = false;
    try {
      const raw =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(
              Object.keys(localStorage).find((key) =>
                key.endsWith('-preview'),
              ) ?? 'note-preview',
            )
          : null;
      const legacy = raw ? JSON.parse(raw) : null;
      if (Array.isArray(legacy)) {
        for (const item of legacy) {
          if (
            typeof item?.content !== 'string' ||
            typeof item?.title !== 'string'
          )
            continue;
          await db.notes.put(
            newNote({
              title: item.title,
              content: item.content,
              pinned: Boolean(item.pinned),
              folder: typeof item.folder === 'string' ? item.folder : undefined,
              tags: Array.isArray(item.tags)
                ? normalizeTags(
                    item.tags.filter((t: unknown) => typeof t === 'string'),
                  )
                : [],
              deletedAt: item.deleted ? new Date().toISOString() : null,
            }),
          );
        }
        imported = true;
      }
    } catch {
      /* Leave the original preview untouched if it cannot be imported. */
    }
    if (!imported && !(await db.notes.count())) {
      await db.notes.put(
        newNote({
          title: '노트 사용 안내',
          pinned: true,
          tags: ['시작하기'],
          content:
            '바쁜 하루 속 떠오른 생각을 이곳에 놓아두세요.\n정리되지 않은 문장도 좋은 시작이 됩니다.\n\n## 나만의 기록을 시작해요\n\n**새 노트**를 눌러 첫 페이지를 펼쳐보세요. 적는 동안 이 기기에 자동으로 저장됩니다.\n\n- [ ] 오늘 떠오른 생각 적기\n- [ ] 나만의 폴더로 정리하기\n- [ ] 서버를 연결해 다른 기기에서 이어 쓰기\n\n## 마크다운으로 가볍게\n\n**굵은 글씨**, *기울임*, 제목, 목록을 사용할 수 있어요. 상단의 **미리보기**에서 글의 모습을 확인하세요.\n\n> 서두르지 않아도 괜찮아요. 한 문장부터 시작해요.\n\n이미지는 도구 모음의 이미지 버튼으로 첨부할 수 있어요. 이 안내도 자유롭게 고치거나 삭제할 수 있습니다.',
        }),
      );
    }
    await db.settings.put({ key: 'initialized', value: true });
  });
}

/** Move the earlier app database without losing offline edits or attachment bytes. */
export async function migratePreviousDatabase(
  target: NoteDatabase,
  candidates?: string[],
) {
  if (await target.settings.get('initialized')) return;
  const names = candidates ?? (await Dexie.getDatabaseNames());
  for (const name of names.filter((name) => name !== target.name)) {
    const source = new Dexie(name);
    try {
      await source.open();
      const tables = source.tables.map((table) => table.name).sort();
      if (tables.join(',') !== 'attachments,notes,settings') continue;
      const initialized = await source.table('settings').get('initialized');
      if (initialized?.value !== true) continue;
      const snapshot = await source.transaction(
        'r',
        source.tables,
        async () => ({
          notes: await source.table<LocalNote>('notes').toArray(),
          attachments: await source.table<Attachment>('attachments').toArray(),
          settings: await source
            .table<{ key: string; value: unknown }>('settings')
            .toArray(),
        }),
      );
      if (
        snapshot.notes.some(
          (note) =>
            typeof note.id !== 'string' || typeof note.mutationId !== 'string',
        )
      )
        continue;
      const migrated = await target.transaction(
        'rw',
        target.tables,
        async () => {
          if (await target.settings.get('initialized')) return false;
          if (await target.notes.count())
            throw new Error(
              '기존 노트를 보호하기 위해 저장소 이전을 중단했어요.',
            );
          await target.notes.bulkPut(
            snapshot.notes.map((note) => ({
              ...note,
              syncState: note.dirty ? 1 : 0,
            })),
          );
          await target.attachments.bulkPut(snapshot.attachments);
          await target.settings.bulkPut(snapshot.settings);
          return true;
        },
      );
      source.close();
      if (migrated) await Dexie.delete(name);
      return;
    } finally {
      source.close();
    }
  }
}

export async function createLocalNote(
  patch: Partial<NoteDocument> = {},
  db = getDb(),
) {
  const note = newNote(patch);
  await db.notes.add(note);
  return note;
}

export async function updateLocalNote(
  id: string,
  patch: Partial<EditableNote>,
  db = getDb(),
  expected?: EditableNote,
) {
  return db.transaction('rw', db.notes, async () => {
    let current = await db.notes.get(id);
    if (!current) throw new Error('노트를 찾을 수 없어요.');
    if (patch.content !== undefined && patch.content.length > MAX_NOTE_LENGTH)
      throw new Error('노트는 100만 자까지 작성할 수 있어요.');
    if (
      patch.content !== undefined &&
      attachmentIds(patch.content).length > 100
    )
      throw new Error('한 노트에는 이미지를 100개까지 첨부할 수 있어요.');
    if (
      expected &&
      JSON.stringify(editableFields(current)) !==
        JSON.stringify(editableFields(expected))
    ) {
      // Another tab or a sync result changed the source while this editor was typing.
      // Reuse the copy made by the sync engine when it contains our exact prior draft.
      const priorCopy = await db.notes
        .filter(
          (candidate) =>
            candidate.conflictOf === id &&
            JSON.stringify(
              editableFields({ ...candidate, title: expected.title }),
            ) === JSON.stringify(editableFields(expected)) &&
            candidate.title === conflictTitle(expected.title),
        )
        .first();
      if (priorCopy) current = priorCopy;
      else {
        const copy = newNote({
          ...current,
          ...patch,
          id: crypto.randomUUID(),
          revision: 0,
          conflictOf: id,
          title: conflictTitle(patch.title ?? expected.title),
        });
        await db.notes.add(copy);
        return copy;
      }
      patch = {
        ...patch,
        title:
          patch.title === expected.title
            ? current.title
            : conflictTitle(patch.title ?? expected.title),
      };
    }
    const updated: LocalNote = {
      ...current,
      ...patch,
      ...(patch.tags ? { tags: normalizeTags(patch.tags) } : {}),
      ...(patch.content !== undefined
        ? { attachments: attachmentIds(patch.content) }
        : {}),
      dirty: true,
      syncState: 1,
      mutationId: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    await db.notes.put(updated);
    return updated;
  });
}

export async function acknowledgePush(
  sent: LocalNote,
  remote: NoteDocument,
  db = getDb(),
) {
  await db.transaction('rw', db.notes, async () => {
    const current = await db.notes.get(sent.id);
    if (!current) return;
    if (current.mutationId === sent.mutationId)
      await db.notes.put({
        ...remote,
        dirty: false,
        syncState: 0,
        mutationId: current.mutationId,
      });
    else if (remote.revision > current.revision)
      await db.notes.update(current.id, { revision: remote.revision });
  });
}

export async function preserveConflict(
  id: string,
  remote: NoteDocument,
  db = getDb(),
) {
  return db.transaction('rw', db.notes, async () => {
    const local = await db.notes.get(id);
    if (!local || !local.dirty) {
      await db.notes.put({
        ...remote,
        dirty: false,
        syncState: 0,
        mutationId: crypto.randomUUID(),
      });
      return null;
    }
    const copy = newNote({
      ...local,
      id: crypto.randomUUID(),
      revision: 0,
      title: conflictTitle(local.title),
      conflictOf: id,
    });
    await db.notes.add(copy);
    await db.notes.put({
      ...remote,
      dirty: false,
      syncState: 0,
      mutationId: crypto.randomUUID(),
    });
    return copy;
  });
}

export async function applyRemote(remote: NoteDocument, db = getDb()) {
  return db.transaction('rw', db.notes, async () => {
    const local = await db.notes.get(remote.id);
    if (local?.dirty) {
      if (remote.revision > local.revision)
        return preserveConflict(local.id, remote, db);
      return null;
    }
    if (!local || remote.revision > local.revision)
      await db.notes.put({
        ...remote,
        dirty: false,
        syncState: 0,
        mutationId: crypto.randomUUID(),
      });
    return null;
  });
}
