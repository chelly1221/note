import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  documentSchema,
  mutationSchema,
  type Mutation,
} from '../lib/validation.ts';
import type { NoteDocument } from '../lib/model.ts';

export class StorageError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 503,
  ) {
    super(message);
  }
}
interface JournalEntry {
  schema: 1;
  sequence: number;
  mutationId: string;
  fingerprint: string;
  note: NoteDocument;
}
export interface StoredAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
}
export interface StorageConfig {
  nasRoot: string;
  stateDir: string;
  storageId: string;
  requireMount?: boolean;
}

export async function atomicWrite(filename: string, data: string | Buffer) {
  const tmp = `${filename}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, filename);
  // Commit the rename as well as its bytes. Windows does not support directory fsync.
  if (process.platform !== 'win32') {
    const directory = await fs.open(path.dirname(filename), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

export class NoteStorage {
  readonly config: StorageConfig;
  index!: DatabaseSync;
  private queue: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private initialized = false;

  constructor(config: StorageConfig) {
    this.config = {
      ...config,
      nasRoot: path.resolve(config.nasRoot),
      stateDir: path.resolve(config.stateDir),
    };
  }

  async assertAvailable() {
    try {
      if (this.config.requireMount) {
        if (process.platform !== 'linux')
          throw new Error('Mount verification requires Linux.');
        await fs.stat(this.config.nasRoot); // Trigger a configured automount without creating any files.
        const mounts = await fs.readFile('/proc/self/mountinfo', 'utf8');
        const nasPath = this.config.nasRoot;
        const valid = mounts.split('\n').some((line) => {
          const parts = line.split(' ');
          const separator = parts.indexOf('-');
          const mounted = (parts[4] || '').replace(/\\040/g, ' ');
          return (
            ['nfs', 'nfs4', 'cifs'].includes(parts[separator + 1]) &&
            (nasPath === mounted || nasPath.startsWith(mounted + '/'))
          );
        });
        if (!valid)
          throw new Error('The configured path is not on the NAS mount.');
      }
      const marker = (
        await fs.readFile(
          path.join(this.config.nasRoot, '.note-storage'),
          'utf8',
        )
      ).trim();
      if (marker !== this.config.storageId)
        throw new Error('Storage identity does not match.');
      await fs.access(this.config.nasRoot, constants.R_OK | constants.W_OK);
    } catch {
      throw new StorageError(
        'nas_unavailable',
        'NAS 저장소에 연결할 수 없어요. 노트는 기기에 보관됩니다.',
      );
    }
  }

  private async prepare() {
    await this.assertAvailable();
    if (!this.index) {
      await fs.mkdir(this.config.stateDir, { recursive: true, mode: 0o700 });
      this.index = new DatabaseSync(
        path.join(this.config.stateDir, 'index.sqlite'),
      );
      this.index.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS changes (sequence INTEGER PRIMARY KEY, note_id TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS mutations (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, device_name TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_changes_note_sequence ON changes(note_id, sequence DESC);`);
    }
    // A failed initialization can leave an open index. Recheck on every retry.
    const storedId = this.index
      .prepare('SELECT value FROM metadata WHERE key = ?')
      .get('storageId') as { value: string } | undefined;
    if (storedId && storedId.value !== this.config.storageId)
      throw new StorageError(
        'storage_mismatch',
        '서버의 저장소 정보가 일치하지 않습니다.',
      );
    this.index
      .prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)')
      .run('storageId', this.config.storageId);
    for (const directory of ['journal', 'notes', 'attachments'])
      await fs.mkdir(path.join(this.config.nasRoot, directory), {
        recursive: true,
        mode: 0o700,
      });
    await this.recover();
    this.initialized = true;
  }

  private applyEntry(entry: JournalEntry) {
    this.index.exec('BEGIN IMMEDIATE');
    try {
      const payload = JSON.stringify(entry.note);
      this.index
        .prepare(
          'INSERT OR REPLACE INTO notes(id,revision,payload) VALUES (?,?,?)',
        )
        .run(entry.note.id, entry.note.revision, payload);
      this.index
        .prepare(
          'INSERT OR IGNORE INTO changes(sequence,note_id,payload) VALUES (?,?,?)',
        )
        .run(entry.sequence, entry.note.id, payload);
      this.index
        .prepare(
          'INSERT OR IGNORE INTO mutations(id,fingerprint,payload) VALUES (?,?,?)',
        )
        .run(entry.mutationId, entry.fingerprint, payload);
      this.index.exec('COMMIT');
    } catch (error) {
      this.index.exec('ROLLBACK');
      throw error;
    }
  }

  private async recover() {
    let last = this.lastSequence();
    const entries = (
      await fs.readdir(path.join(this.config.nasRoot, 'journal'))
    )
      .filter((name) => /^\d{16}-[a-f0-9-]{36}\.json$/.test(name))
      .sort();
    if (last > Number(entries.at(-1)?.slice(0, 16) ?? 0))
      throw new StorageError(
        'journal_rollback',
        'NAS가 이전 시점으로 복원되어 서버 인덱스의 복구가 필요합니다.',
      );
    for (let position = 0; position < entries.length; position++) {
      if (Number(entries[position].slice(0, 16)) !== position + 1)
        throw new StorageError(
          'journal_gap',
          'NAS 변경 이력에 누락이나 중복이 있어 복구 확인이 필요합니다.',
        );
    }
    for (const name of entries) {
      const sequence = Number(name.slice(0, 16));
      if (sequence <= last) continue;
      if (sequence !== last + 1)
        throw new StorageError(
          'journal_gap',
          'NAS 변경 이력에 누락이 있어 복구 확인이 필요합니다.',
        );
      const entry = JSON.parse(
        await fs.readFile(
          path.join(this.config.nasRoot, 'journal', name),
          'utf8',
        ),
      ) as JournalEntry;
      documentSchema.parse(entry.note);
      if (
        entry.schema !== 1 ||
        entry.sequence !== sequence ||
        typeof entry.fingerprint !== 'string' ||
        entry.mutationId !== name.slice(17, -5)
      )
        throw new StorageError(
          'journal_invalid',
          'NAS 변경 이력을 읽을 수 없습니다.',
        );
      this.applyEntry(entry);
      last = sequence;
    }
  }

  private async serialized<T>(work: () => Promise<T>): Promise<T> {
    if (this.queued > 100)
      throw new StorageError(
        'storage_busy',
        '저장소가 바빠요. 잠시 후 다시 연결합니다.',
      );
    this.queued++;
    const operation = this.queue.then(async () => {
      if (!this.initialized) await this.prepare();
      else await this.assertAvailable();
      return work();
    });
    this.queue = operation
      .catch(() => {
        this.initialized = false;
      })
      .finally(() => {
        this.queued--;
      });
    return operation;
  }

  async initialize() {
    await this.serialized(async () => undefined);
  }
  close() {
    this.index?.close();
  }
  lastSequence(): number {
    return (
      this.index
        .prepare('SELECT COALESCE(MAX(sequence),0) AS seq FROM changes')
        .get() as { seq: number }
    ).seq;
  }
  getNote(id: string): NoteDocument | null {
    const row = this.index
      .prepare('SELECT payload FROM notes WHERE id = ?')
      .get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }

  async mutate(
    input: Mutation,
  ): Promise<{ outcome: 'saved' | 'conflict'; note: NoteDocument }> {
    const mutation = mutationSchema.parse(input);
    return this.serialized(async () => {
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(mutation.note))
        .digest('hex');
      const previous = this.index
        .prepare('SELECT fingerprint,payload FROM mutations WHERE id=?')
        .get(mutation.mutationId) as
        | { fingerprint: string; payload: string }
        | undefined;
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new StorageError(
            'mutation_reused',
            '같은 저장 요청에 다른 내용이 들어 있습니다.',
            409,
          );
        return { outcome: 'saved', note: JSON.parse(previous.payload) };
      }
      const current = this.getNote(mutation.note.id);
      if ((current?.revision ?? 0) !== mutation.note.revision) {
        if (!current)
          throw new StorageError(
            'note_missing',
            '원본 노트를 찾을 수 없습니다.',
            409,
          );
        return { outcome: 'conflict', note: current };
      }
      for (const id of mutation.note.attachments) await this.getAttachment(id);
      const note: NoteDocument = {
        ...mutation.note,
        createdAt: current?.createdAt ?? mutation.note.createdAt,
        revision: (current?.revision ?? 0) + 1,
        // Imported and offline-created notes keep their original editing time.
        // Later revisions use the server clock; revisions drive synchronization.
        updatedAt:
          !current && Date.parse(mutation.note.updatedAt) <= Date.now()
            ? mutation.note.updatedAt
            : new Date().toISOString(),
      };
      const entry: JournalEntry = {
        schema: 1,
        sequence: this.lastSequence() + 1,
        mutationId: mutation.mutationId,
        fingerprint,
        note,
      };
      const filename = `${String(entry.sequence).padStart(16, '0')}-${mutation.mutationId}.json`;
      // The NAS journal is committed before the index and before acknowledging the client.
      await atomicWrite(
        path.join(this.config.nasRoot, 'journal', filename),
        JSON.stringify(entry),
      );
      this.applyEntry(entry);
      // Human-readable exports are derived data. The immutable journal is authoritative.
      try {
        // Both writes must settle before the next revision, including failures.
        await Promise.allSettled([
          atomicWrite(
            path.join(this.config.nasRoot, 'notes', `${note.id}.json`),
            JSON.stringify(note, null, 2),
          ),
          atomicWrite(
            path.join(this.config.nasRoot, 'notes', `${note.id}.md`),
            `# ${note.title || '제목 없는 노트'}\n\n${note.content}\n`,
          ),
        ]);
      } catch {
        /* A later repair can regenerate exports from the committed journal. */
      }
      return { outcome: 'saved', note };
    });
  }

  async changes(cursor: number, limit = 100) {
    return this.serialized(async () => {
      if (cursor > this.lastSequence())
        throw new StorageError(
          'cursor_invalid',
          '동기화 위치를 다시 확인해야 합니다.',
          409,
        );
      const iterator = this.index
        .prepare(
          'SELECT sequence,payload FROM changes WHERE sequence > ? ORDER BY sequence LIMIT ?',
        )
        .iterate(cursor, Math.min(limit, 100));
      const rows: { sequence: number; payload: string }[] = [];
      let bytes = 0;
      for (const value of iterator) {
        const row = value as { sequence: number; payload: string };
        const size = Buffer.byteLength(row.payload);
        if (rows.length && bytes + size > 8 * 1024 * 1024) break;
        rows.push(row);
        bytes += size;
      }
      return {
        notes: rows.map((row) => JSON.parse(row.payload) as NoteDocument),
        cursor: rows.at(-1)?.sequence ?? cursor,
        hasMore: (rows.at(-1)?.sequence ?? cursor) < this.lastSequence(),
        storageId: this.config.storageId,
      };
    });
  }

  async history(id: string) {
    return this.serialized(async () => {
      const iterator = this.index
        .prepare(
          'SELECT payload FROM changes WHERE note_id = ? ORDER BY sequence DESC LIMIT 50',
        )
        .iterate(id);
      const versions: NoteDocument[] = [];
      let bytes = 0;
      for (const value of iterator) {
        const row = value as { payload: string };
        const size = Buffer.byteLength(row.payload);
        if (versions.length && bytes + size > 8 * 1024 * 1024) break;
        versions.push(JSON.parse(row.payload));
        bytes += size;
      }
      return versions;
    });
  }

  async putAttachment(id: string, name: string, mime: string, bytes: Buffer) {
    return this.serialized(async () => {
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      try {
        const existing = await this.getAttachment(id);
        if (existing.sha256 === sha256) return existing;
        throw new StorageError(
          'attachment_conflict',
          '첨부 파일 식별자가 중복되었습니다.',
          409,
        );
      } catch (error) {
        if (
          !(
            error instanceof StorageError && error.code === 'attachment_missing'
          )
        )
          throw error;
      }
      const metadata: StoredAttachment = {
        id,
        name,
        mime,
        size: bytes.length,
        sha256,
        createdAt: new Date().toISOString(),
      };
      await atomicWrite(
        path.join(this.config.nasRoot, 'attachments', `${id}.bin`),
        bytes,
      );
      await atomicWrite(
        path.join(this.config.nasRoot, 'attachments', `${id}.json`),
        JSON.stringify(metadata),
      );
      return metadata;
    });
  }

  async getAttachment(id: string): Promise<StoredAttachment> {
    try {
      return JSON.parse(
        await fs.readFile(
          path.join(this.config.nasRoot, 'attachments', `${id}.json`),
          'utf8',
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new StorageError(
          'attachment_missing',
          '이미지가 아직 서버에 저장되지 않았어요.',
          409,
        );
      throw error;
    }
  }

  async attachmentBytes(id: string) {
    await this.assertAvailable();
    const metadata = await this.getAttachment(id);
    const bytes = await fs.readFile(
      path.join(this.config.nasRoot, 'attachments', `${id}.bin`),
    );
    if (
      bytes.length !== metadata.size ||
      createHash('sha256').update(bytes).digest('hex') !== metadata.sha256
    )
      throw new StorageError(
        'attachment_corrupt',
        '저장된 이미지의 무결성을 확인할 수 없습니다.',
      );
    return { metadata, bytes };
  }
}
