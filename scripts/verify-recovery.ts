/** Read the real NAS journal into an isolated temporary index; never alter live state. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { NoteStorage } from '../server/storage';
const nasRoot = process.env.NAS_ROOT!;
const storageId = process.env.NAS_STORAGE_ID!;
assert(nasRoot && storageId);
const stateDir = await fs.mkdtemp('/tmp/note-recovery-');
const recovered = new NoteStorage({
  nasRoot,
  storageId,
  stateDir,
  requireMount: true,
});
try {
  await recovered.initialize();
  const files = (await fs.readdir(path.join(nasRoot, 'notes'))).filter((name) =>
    name.endsWith('.json'),
  );
  let verified = 0;
  for (const name of files) {
    const exported = JSON.parse(
      await fs.readFile(path.join(nasRoot, 'notes', name), 'utf8'),
    );
    const note = recovered.getNote(exported.id);
    assert(
      isDeepStrictEqual(note, exported),
      'Recovered index differs from a NAS export; inspect privately on the server.',
    );
    verified++;
  }
  assert(verified >= 16);
  console.log(
    JSON.stringify({
      recoveredNotes: verified,
      journalEntries: recovered.lastSequence(),
      exactMatch: true,
      liveIndexUntouched: true,
    }),
  );
} finally {
  recovered.close();
  assert(path.resolve(stateDir).startsWith('/tmp/note-recovery-'));
  await fs.rm(stateDir, { recursive: true, force: true });
}
