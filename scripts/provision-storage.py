"""Run on the user's Linux server after mounting the specified Note share."""
import os
from pathlib import Path
import uuid

mount = Path('/mnt/note')
if not os.path.ismount(mount):
    raise SystemExit('The NAS share must be mounted before provisioning.')
root = mount / 'note'
root.mkdir(mode=0o700, exist_ok=True)
marker = root / '.note-storage'
if not marker.exists():
    with marker.open('x') as handle:
        handle.write(str(uuid.uuid4()) + '\n')
        handle.flush()
        os.fsync(handle.fileno())
probe = root / ('.write-probe-' + str(uuid.uuid4()))
try:
    with probe.open('x') as handle:
        handle.write('note storage verification\n')
        handle.flush()
        os.fsync(handle.fileno())
    assert probe.read_text() == 'note storage verification\n'
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
finally:
    probe.unlink(missing_ok=True)
print('NAS read/write and file/directory fsync verified.')
print('Storage ID:', marker.read_text().strip())
