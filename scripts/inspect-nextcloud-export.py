"""Print counts and content limits, never note contents or connection secrets."""
import collections
import json
from pathlib import Path
import re

data = json.loads(Path('/srv/note/nextcloud-export.json').read_text())
notes = data['notes']
files = list(Path('/srv/nextcloud/data/3chan/files/메모').rglob('*'))
images = [url for note in notes for url in re.findall(r'!\[[^\]]*\]\(([^\n]+?)\)', note['content'])]
html_images = sum(len(re.findall(r'<img\b', note['content'], re.I)) for note in notes)
print(json.dumps({
    'notes': len(notes), 'categories': data['categories'],
    'favorites': sum(note['favorite'] for note in notes),
    'maxTitle': max([len(note['title']) for note in notes], default=0),
    'maxContent': max([len(note['content']) for note in notes], default=0),
    'maxCategory': max([len(note['category']) for note in notes], default=0),
    'sourceBytes': sum(note['sourceBytes'] for note in notes),
    'sourceContentIdentical': all(note['sourceSha256'] == note['contentSha256'] for note in notes),
    'markdownImages': len(images), 'htmlImages': html_images,
    'imageSchemes': dict(collections.Counter(re.match(r'^([a-z]+):', image, re.I).group(1) if re.match(r'^([a-z]+):', image, re.I) else 'relative' for image in images)),
    'fileExtensions': dict(collections.Counter(file.suffix for file in files if file.is_file())),
    'earliestModified': min([note['modified'] for note in notes], default=0),
    'latestModified': max([note['modified'] for note in notes], default=0),
    'createdAvailable': sum(bool(note['created']) for note in notes),
}, ensure_ascii=False))
import hashlib
for note in notes:
    target = Path('/srv/nextcloud/data/3chan/files') / note['internalPath'].lstrip('/')
    raw = target.read_bytes()
    if hashlib.sha256(raw).hexdigest() != note['sourceSha256']:
        print(json.dumps({'sourceId': note['id'], 'apiBytes': note['sourceBytes'], 'diskBytes': len(raw), 'encrypted': raw.startswith(b'HBEGIN'), 'mtimeChanged': int(target.stat().st_mtime) != note['modified']}))
