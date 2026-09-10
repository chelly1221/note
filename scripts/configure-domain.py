"""Configure only Note's Caddy route and origins; never emit private keys."""
from pathlib import Path
from datetime import datetime, timezone
import shutil
import subprocess

base = Path('/srv/note')
env = base / '.env'
lines = env.read_text().splitlines()
origins = 'APP_ORIGINS=https://note.3chan.kr,https://localhost,https://audax-vm.tail62313c.ts.net:8443'
lines = [origins if line.startswith('APP_ORIGINS=') else line for line in lines]
env.write_text('\n'.join(lines) + '\n')
connection = base / 'connection.txt'
connection.write_text(connection.read_text().replace('https://audax-vm.tail62313c.ts.net:8443', 'https://note.3chan.kr'))

config = Path('/srv/proxy/Caddyfile')
before = config.read_text()
site = '\n# Note personal notes\nnote.3chan.kr {\n\tencode zstd gzip\n\treverse_proxy note-app:8787\n}\n'
if 'note.3chan.kr {' not in before:
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    shutil.copy2(config, config.with_name(f'Caddyfile.bak.{stamp}-note'))
    # Preserve the inode: Caddy mounts this file, rather than its parent directory.
    config.write_text(before + site)
    checked = subprocess.run(['docker', 'exec', 'caddy', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile'])
    if checked.returncode:
        config.write_text(before)
        raise SystemExit('Caddy validation failed; previous configuration restored.')
subprocess.run(['docker', 'exec', 'caddy', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile'], check=True)
print('Note domain configured; existing proxy routes preserved.')
