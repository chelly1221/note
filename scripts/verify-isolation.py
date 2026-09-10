"""Read-only Docker deployment check. Prints no environment values or note data."""
import json
import subprocess

def docker(*args):
    return json.loads(subprocess.check_output(['docker', *args], text=True))

api, web = docker('inspect', 'note', 'note-web')
env = dict(value.split('=', 1) for value in api['Config']['Env'] if '=' in value)
web_env = dict(value.split('=', 1) for value in web['Config']['Env'] if '=' in value)
assert env.get('AUTH_MODE') == 'tailscale', 'Tailscale authentication is required.'
assert env.get('TAILSCALE_ALLOWED_LOGINS', '').strip(), 'A user allowlist is required.'
assert 'APP_ACCESS_KEY' not in env, 'Remove the obsolete application key.'
assert not any(key in web_env for key in ['NAS_ROOT', 'NAS_STORAGE_ID', 'APP_ACCESS_KEY', 'TAILSCALE_ALLOWED_LOGINS'])
assert set(api['NetworkSettings']['Networks']) == {'note_private'}
assert set(web['NetworkSettings']['Networks']) == {'web'}
peers = docker('network', 'inspect', 'note_private')[0]['Containers']
assert set(peers) == {api['Id']}, 'The API network has an unexpected peer.'
ports = api['HostConfig']['PortBindings']
assert ports == {'8787/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '8787'}]}
assert not web['HostConfig']['PortBindings'], 'Publish the web through Caddy only.'
assert all(mount['Destination'] in ['/downloads', '/tmp'] for mount in web['Mounts'])
assert all(not mount['RW'] for mount in web['Mounts'] if mount['Destination'] == '/downloads')
assert any(mount['Destination'] == '/nas' for mount in api['Mounts'])
assert api['HostConfig']['ReadonlyRootfs'] and web['HostConfig']['ReadonlyRootfs']
print('PASS: Tailscale authentication, isolated API network, loopback-only port, public web without NAS or app keys, read-only containers.')
