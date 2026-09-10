import { z } from 'zod';
import { createLocalNote, getDb } from './database';
import { DEFAULT_FOLDER, MAX_NOTE_LENGTH, notePreview } from './model';
import { finishEditing } from './edit-session';
import { refreshPending } from './sync';

interface ModelContext {
  registerTool(
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute(input: unknown): Promise<unknown>;
    },
    options: { signal: AbortSignal },
  ): void | Promise<void>;
}
const searchSchema = z
  .object({
    query: z.string().max(500).default(''),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
const createSchema = z
  .object({
    title: z.string().max(300),
    content: z.string().max(MAX_NOTE_LENGTH),
    folder: z.string().trim().min(1).max(80).default(DEFAULT_FOLDER),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  })
  .strict();

/** The same local storage and save guard used by the visible note workspace. */
export function registerNoteTools(onCreated: (id: string) => Promise<void>) {
  const context = (document as Document & { modelContext?: ModelContext })
    .modelContext;
  if (!context?.registerTool) return () => {};
  const lifetime = new AbortController();
  const definitions = [
    {
      name: 'search_notes',
      title: '노트 검색',
      description:
        'Search active notes on this device by title, Markdown content or tags. Returns a concise preview without changing any notes.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 500 },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input: unknown) {
        const { query, limit } = searchSchema.parse(input);
        const needle = query.toLocaleLowerCase();
        const notes = (await getDb().notes.toArray())
          .filter(
            (note) =>
              !note.deletedAt &&
              `${note.title} ${note.content} ${note.tags.join(' ')}`
                .toLocaleLowerCase()
                .includes(needle),
          )
          .sort(
            (a, b) =>
              Number(b.pinned) - Number(a.pinned) ||
              b.updatedAt.localeCompare(a.updatedAt),
          );
        return {
          total: notes.length,
          notes: notes
            .slice(0, limit)
            .map((note) => ({
              id: note.id,
              title: note.title,
              preview: notePreview(note.content),
              folder: note.folder,
              tags: note.tags,
            })),
        };
      },
    },
    {
      name: 'create_note',
      title: '새 노트 작성',
      description:
        'Create and save a new Markdown note on this device, open it in the editor, and queue normal NAS synchronization. Does not replace existing notes.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 300 },
          content: { type: 'string', maxLength: MAX_NOTE_LENGTH },
          folder: { type: 'string', minLength: 1, maxLength: 80 },
          tags: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 40 },
            maxItems: 20,
          },
        },
        required: ['title', 'content'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input: unknown) {
        const values = createSchema.parse(input);
        if (!(await finishEditing()))
          throw new Error('현재 편집 중인 노트를 먼저 저장해 주세요.');
        const note = await createLocalNote(values);
        await onCreated(note.id);
        await refreshPending();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        return { id: note.id, title: note.title, savedOnDevice: true };
      },
    },
  ];
  for (const definition of definitions) {
    try {
      void Promise.resolve(
        context.registerTool(definition, { signal: lifetime.signal }),
      ).catch(() => {});
    } catch {
      /* Unsupported browser registrations do not affect normal editing. */
    }
  }
  return () => lifetime.abort();
}
