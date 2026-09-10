import { getDb, updateLocalNote, type NoteDatabase } from './database';
import { editableFields, type EditableNote, type LocalNote } from './model';

/** Serializes one editor's drafts and protects changes made by another writer. */
export class EditWriter {
  id: string;
  private base: EditableNote;
  private requestedTitle: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    note: LocalNote,
    private db: NoteDatabase = getDb(),
  ) {
    this.id = note.id;
    this.base = editableFields(note);
    this.requestedTitle = note.title;
  }

  receive(note: LocalNote) {
    if (note.id !== this.id) return;
    this.base = editableFields(note);
    this.requestedTitle = note.title;
  }

  write(fields: EditableNote): Promise<LocalNote> {
    const requested = editableFields(fields);
    const operation = this.queue.then(async () => {
      const payload = {
        ...requested,
        title:
          requested.title === this.requestedTitle
            ? this.base.title
            : requested.title,
      };
      const saved = await updateLocalNote(this.id, payload, this.db, this.base);
      this.id = saved.id;
      this.base = editableFields(saved);
      this.requestedTitle = requested.title;
      return saved;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
