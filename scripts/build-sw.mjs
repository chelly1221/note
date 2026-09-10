import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { serviceWorkerSource } from './service-worker-template.mjs';
const root = path.resolve('dist/client');
async function list(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith('.'))
        .map((entry) =>
          entry.isDirectory()
            ? list(path.join(directory, entry.name))
            : [path.join(directory, entry.name)],
        ),
    )
  ).flat();
}
const files = (await list(root)).filter(
  (file) => !file.endsWith('sw.js') && !file.endsWith('.map'),
);
const hash = createHash('sha256');
for (const file of files.sort()) hash.update(await fs.readFile(file));
const cache = `note-shell-${hash.digest('hex').slice(0, 16)}`;
const assets = [
  '/',
  ...files
    .map((file) => '/' + path.relative(root, file).replaceAll('\\', '/'))
    .filter((url) => url !== '/index.html'),
];
const worker = serviceWorkerSource(cache,assets);
await fs.writeFile(path.join(root, 'sw.js'), worker);
console.log(`Offline shell ready: ${assets.length} assets, ${cache}`);
