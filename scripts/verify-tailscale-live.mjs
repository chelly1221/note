// Read-only verification from a device connected to the owner's tailnet.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const privateUrl = 'https://audax-vm.tail62313c.ts.net:8443';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function read(route) {
  const response = await fetch(privateUrl + route, { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200);
  return response.json();
}
assert.equal((await fetch('https://note.3chan.kr/api/status')).status, 404);
assert.equal((await read('/api/auth/identity')).auth, 'tailscale');
const notes = new Map();
let cursor = 0;
while (true) {
  const page = await read('/api/sync/pull?cursor=' + cursor);
  for (const note of page.notes) notes.set(note.id, note);
  cursor = page.cursor;
  if (!page.hasMore) break;
}
const imported = [...notes.values()].filter((note) => note.folder === 'Nextcloud에서 가져옴' && !note.deletedAt);
assert.equal(imported.length, 16);
const qa = [...notes.values()].find((note) => note.title.startsWith('자동 저장 검증 · 길어지는 제목'));
assert(qa);
for (const line of ['목록으로 이동해도 내용 유지', '새로고침 후 내용 유지', 'Tailscale을 통해 NAS에 반영'])
  assert(qa.content.includes('- [x] ' + line));
assert.equal(qa.attachments.length, 2);
const expected = new Set(await Promise.all(['public/icon-192.png', 'public/icon-512.png'].map(async (path) => hash(await fs.readFile(path)))));
for (const id of qa.attachments) {
  const response = await fetch(privateUrl + '/api/attachments/' + id);
  assert.equal(response.status, 200);
  assert(expected.delete(hash(Buffer.from(await response.arrayBuffer()))));
}
assert.equal(expected.size, 0);
console.log('PASS: public API blocked, Tailscale identity, 16 migrated notes, automatic checklist saving, two exact image hashes.');
