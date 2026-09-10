"""Switch only Note to a private API plus an isolated public login shell."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import time
from urllib.request import urlopen

base = Path('/srv/note')
caddy = Path('/srv/proxy/Caddyfile')
backup = base / 'tailscale-cutover-backup'
mode = sys.argv[1]
os.umask(0o077)
if mode == 'prepare':
    backup.mkdir(mode=0o700, exist_ok=True)
    for source in [base / '.env', base / 'compose.yaml', base / 'Dockerfile', caddy]:
        target = backup / source.name
        if not target.exists(): shutil.copy2(source, target)
    status = json.loads(subprocess.check_output(['tailscale', 'status', '--json']))
    login = status['User'][str(status['Self']['UserID'])]['LoginName']
    env = dict(line.split('=', 1) for line in (base / '.env').read_text().splitlines() if '=' in line)
    env.pop('APP_ACCESS_KEY', None)
    env['AUTH_MODE'] = 'tailscale'
    env['TAILSCALE_ALLOWED_LOGINS'] = login
    env['APP_ORIGINS'] = 'https://note.3chan.kr,https://localhost,https://audax-vm.tail62313c.ts.net:8443'
    (base / '.env').write_text(''.join(f'{key}={value}\n' for key, value in env.items()))
    (base / 'connection.txt').write_text('노트 연결 안내\n\n웹: https://note.3chan.kr\nPC와 휴대폰에서 Tailscale에 로그인하고 연결을 켜 주세요.\n노트의 Tailscale로 연결 버튼을 누르면 본인 계정을 확인합니다.\n별도 연결 키나 노트 비밀번호는 사용하지 않습니다.\n')
    print('Private Tailscale settings prepared; previous deployment backed up.')
elif mode == 'activate':
    for attempt in range(40):
        try:
            with urlopen('http://127.0.0.1:8787/api/health', timeout=3) as response:
                if json.load(response)['storageReady']: break
        except Exception:
            if attempt == 39: raise
            time.sleep(0.5)
    else: raise RuntimeError('NAS API is not ready')
    before = caddy.read_text()
    old = 'reverse_proxy note-app:8787'
    new = 'reverse_proxy note-web:8788'
    if old in before:
        assert before.count(old) == 1
        caddy.write_text(before.replace(old, new))
    else:
        assert new in before, 'Expected Note proxy route was not found.'
    checked = subprocess.run(['docker', 'exec', 'caddy', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile'], capture_output=True)
    if checked.returncode:
        caddy.write_text(before)
        raise RuntimeError('Proxy validation failed; previous file restored.')
    subprocess.run(['docker', 'exec', 'caddy', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile'], check=True, capture_output=True)
    subprocess.run(['tailscale', 'serve', '--bg', '--https=8443', 'http://127.0.0.1:8787'], check=True)
    print('Tailscale-only API enabled; public domain serves the login shell only.')
else:
    raise SystemExit('Use prepare or activate.')
