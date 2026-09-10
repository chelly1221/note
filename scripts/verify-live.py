"""Run on the Tailscale-connected app server: verify NAS durability and conflicts.

Creates one clearly labelled test note and leaves it in recoverable trash.
Authentication comes only from Tailscale Serve; no application key is used.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen
from uuid import uuid4

base = Path('/srv/note')
nas = Path('/mnt/note/note')
origin = 'https://note.3chan.kr'
private_origin = 'https://audax-vm.tail62313c.ts.net:8443'

def request(route, payload=None, method=None):
    headers = {'Origin': origin, 'X-Note-Request': '1'}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    req = Request(private_origin + route, data=json.dumps(payload).encode() if payload is not None else None,
                  headers=headers, method=method)
    with urlopen(req, timeout=20) as response:
        content = response.read()
        return json.loads(content) if 'application/json' in response.headers.get('Content-Type', '') else content

assert request('/api/health')['storageReady']
assert request('/api/auth/identity')['auth'] == 'tailscale'
assert request('/api/status')['storageId'] == (nas / '.note-storage').read_text().strip()
all_notes = {}
cursor = 0
while True:
    page = request('/api/sync/pull?cursor=' + str(cursor))
    all_notes.update({note['id']: note for note in page['notes']})
    cursor = page['cursor']
    if not page['hasMore']:
        break
browser_notes = [note for note in all_notes.values() if note['title'] == '동기화 검증 · 웹에서 쓴 기록']
assert browser_notes, 'Create the browser verification note first.'
browser_note = browser_notes[0]
assert '- [x] 웹에서 기록하기' in browser_note['content']
assert browser_note['attachments'], 'The browser image upload is missing.'
for image_id in browser_note['attachments']:
    remote = request('/api/attachments/' + image_id)
    stored = (nas / 'attachments' / (image_id + '.bin')).read_bytes()
    metadata = json.loads((nas / 'attachments' / (image_id + '.json')).read_text())
    assert remote == stored and hashlib.sha256(remote).hexdigest() == metadata['sha256']
assert json.loads((nas / 'notes' / (browser_note['id'] + '.json')).read_text()) == browser_note
print('PASS: browser Markdown/checklist/image -> HTTPS API -> NAS, exact bytes and SHA-256')

now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
note = {'id': str(uuid4()), 'title': '자동 검증 기록 · 복원 가능', 'content': 'HTTPS/NAS 검증용 기록입니다.',
        'folder': '기본 노트', 'tags': [], 'pinned': False, 'deletedAt': None,
        'createdAt': now, 'updatedAt': now, 'revision': 0, 'attachments': []}
mutation = {'mutationId': str(uuid4()), 'note': note}
first = request('/api/sync/push', mutation)
assert first['outcome'] == 'saved' and first['note']['revision'] == 1
assert request('/api/sync/push', mutation) == first
stale = request('/api/sync/push', {'mutationId': str(uuid4()), 'note': {**note, 'content': 'stale device'}})
assert stale['outcome'] == 'conflict' and stale['note'] == first['note']
note = first['note']
for deleted_at in [now, None, now]:
    outcome = request('/api/sync/push', {'mutationId': str(uuid4()), 'note': {**note, 'deletedAt': deleted_at}})
    assert outcome['outcome'] == 'saved'
    note = outcome['note']
    assert json.loads((nas / 'notes' / (note['id'] + '.json')).read_text()) == note
assert len(request('/api/notes/' + note['id'] + '/history')['versions']) == 4
assert note['deletedAt']
print('PASS: idempotent save, two-device revision conflict, trash/restore/history, durable NAS export')
