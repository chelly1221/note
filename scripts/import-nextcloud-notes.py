"""Import the private, read-only Nextcloud export through Note's authenticated API.

Run on the app server. Source files remain untouched. Stable IDs prevent duplicate
imports; existing notes are verified and never overwritten. Prints counts only.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen
from uuid import UUID, uuid5

os.umask(0o077)
base = Path('/srv/note')
nas = Path('/mnt/note/note')
source_root = Path('/srv/nextcloud/data/3chan/files').resolve()
snapshot = (base / 'nextcloud-export.json').read_bytes()
export = json.loads(snapshot)
namespace = UUID((nas / '.note-storage').read_text().strip())
backup = Path('/mnt/note/nextcloud-import-20260910')
backup.mkdir(mode=0o700, exist_ok=True)
snapshot_backup = backup / 'source.json'
if snapshot_backup.exists():
    assert snapshot_backup.read_bytes() == snapshot, 'Source snapshot changed; review before retry.'
else:
    snapshot_backup.write_bytes(snapshot)

def iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def digest(data):
    return hashlib.sha256(data).hexdigest()

prepared = []
for source in export['notes']:
    assert not source['error']
    assert len(source['title']) <= 300 and len(source['content']) <= 1_000_000
    assert source['sourceSha256'] == source['contentSha256'], 'Source encoding requires review.'
    filename = (source_root / source['internalPath'].lstrip('/')).resolve()
    assert filename.is_relative_to(source_root / '메모')
    raw = filename.read_bytes()
    # Nextcloud's server-side encryption wraps physical files. The Notes service
    # above supplies the decrypted text; preserve physical bytes separately.
    encrypted = raw.startswith(b'HBEGIN')
    if not encrypted:
        assert digest(raw) == source['sourceSha256'], 'Source changed during export.'
    original = backup / 'originals' / filename.relative_to(source_root)
    original.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if original.exists():
        assert original.read_bytes() == raw
    else:
        original.write_bytes(raw)
    note_id = str(uuid5(namespace, f"nextcloud:{export['user']}:{source['id']}"))
    folder = 'Nextcloud에서 가져옴' + (' / ' + source['category'] if source['category'] else '')
    assert len(folder) <= 80
    note = {
        'id': note_id, 'title': source['title'], 'content': source['content'],
        'folder': folder, 'tags': [], 'pinned': source['favorite'], 'deletedAt': None,
        'createdAt': iso(source['created'] or source['modified']),
        'updatedAt': iso(source['modified']), 'revision': 0, 'attachments': [],
    }
    # This snapshot has no images. Fail closed if rerun on different source data.
    assert '![' not in note['content'] and '<img' not in note['content'].lower()
    prepared.append((source, filename, note, digest(raw)))
assert len({note['id'] for _, _, note, _ in prepared}) == len(prepared)

def request(route, payload=None):
    headers = {'Origin': 'https://note.3chan.kr', 'X-Note-Request': '1'}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    req = Request('https://audax-vm.tail62313c.ts.net:8443' + route,
                  data=json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None,
                  headers=headers)
    with urlopen(req, timeout=30) as response:
        return json.loads(response.read())

assert request('/api/health')['storageReady']
assert request('/api/auth/identity')['auth'] == 'tailscale'
assert request('/api/status')['storageId'] == str(namespace)
report = []
created = 0
for source, filename, note, physical_hash in prepared:
    target = nas / 'notes' / (note['id'] + '.json')
    if target.exists():
        saved = json.loads(target.read_text())
    else:
        result = request('/api/sync/push', {
            'mutationId': str(uuid5(namespace, 'nextcloud-mutation:' + note['id'] + ':' + source['contentSha256'])),
            'note': note,
        })
        assert result['outcome'] == 'saved'
        saved = result['note']
        created += 1
    for field in note:
        if field != 'revision':
            assert saved[field] == note[field], 'Existing imported note differs; no overwrite attempted.'
    assert saved['revision'] == 1
    assert json.loads(target.read_text()) == saved
    history = request('/api/notes/' + note['id'] + '/history')['versions']
    assert len(history) == 1 and history[0] == saved
    assert digest(filename.read_bytes()) == physical_hash
    report.append({'sourceId': source['id'], 'noteId': note['id'], 'sha256': source['contentSha256'],
                   'sourceModified': note['updatedAt'], 'verified': True})

(backup / 'verification.json').write_text(json.dumps({
    'source': 'Nextcloud Notes', 'count': len(report), 'created': created,
    'originalsUnchanged': True, 'notes': report,
}, ensure_ascii=False, indent=2))
print(json.dumps({'imported': created, 'verified': len(report), 'sourceUnchanged': True,
                  'titleContentDatesExact': True, 'backup': str(backup)}, ensure_ascii=False))
