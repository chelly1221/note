"""Idempotent host setup; do not print any authentication credentials."""
import os
from pathlib import Path
import secrets
import shutil

base = Path('/srv/note')
mount = Path('/mnt/note')
if not os.path.ismount(mount):
    raise SystemExit('The NAS is not mounted.')
storage_id = (mount / 'note/.note-storage').read_text().strip()
state = base / 'state'
state.mkdir(mode=0o700, exist_ok=True)
os.chown(state, 1001, 1001)
env = base / '.env'
if not env.exists():
    key = secrets.token_urlsafe(32)
    contents = '\n'.join([
        f'APP_ACCESS_KEY={key}',
        'APP_ORIGINS=https://note.3chan.kr,https://localhost',
        f'NAS_STORAGE_ID={storage_id}',
        '',
    ])
    env.write_text(contents)
    os.chmod(env, 0o600)
    os.chown(env, 1001, 1001)
    connection = base / 'connection.txt'
    connection.write_text('노트 서버 연결 정보\n\n서버 주소: https://note.3chan.kr\n연결 키: ' + key + '\n\n연결 키는 나의 기기에만 입력하세요. NAS 비밀번호와는 별개의 앱 전용 키입니다.\n', encoding='utf-8')
    os.chmod(connection, 0o600)
    os.chown(connection, 1001, 1001)
fstab = Path('/etc/fstab')
current = fstab.read_text()
entry = '//100.75.89.101/Note /mnt/note cifs credentials=/etc/note/nas.credentials,vers=3.1.1,seal,uid=1001,gid=1001,file_mode=0600,dir_mode=0700,nosuid,nodev,noexec,nofail,_netdev,x-systemd.automount,x-systemd.mount-timeout=30,x-systemd.requires=tailscaled.service 0 0'
existing = [line for line in current.splitlines() if not line.lstrip().startswith('#') and '/mnt/note' in line]
if existing and existing != [entry]:
    raise SystemExit('A different mount entry already exists; inspect it before changing it.')
if not existing:
    backup = Path('/etc/fstab.before-note')
    if not backup.exists():
        shutil.copy2(fstab, backup)
    with fstab.open('a') as handle:
        handle.write('\n# Note private NAS storage\n' + entry + '\n')
shutil.copy2(base / 'scripts/note.service', '/etc/systemd/system/note.service')
print('Persistent mount, private runtime settings, and service installed.')
