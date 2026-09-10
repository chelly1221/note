import fs from 'node:fs/promises';
import path from 'node:path';
// Android serves packaged assets locally; HTTP compression copies only help the web.
const root = path.resolve('android/app/src/main/assets/public/tailscale');
for (const version of await fs.readdir(root)) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
  for (const suffix of ['gz', 'br']) {
    await fs
      .unlink(path.join(root, version, `main.wasm.${suffix}`))
      .catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
  }
}
