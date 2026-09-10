import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const revision = '3d3261b66ee1dd57e390abce4c2828f8b542d5a2';
const root = process.cwd();
const source = path.join(root, '.local/tailscale');
const output = path.join(root, 'public/tailscale/0.2.1');
const go =
  process.env.NOTE_GO ??
  path.join(
    root,
    '.local/go/bin',
    process.platform === 'win32' ? 'go.exe' : 'go',
  );
function run(file, args, options = {}) {
  return execFileSync(file, args, {
    cwd: source,
    stdio: 'inherit',
    ...options,
  });
}
await fs.mkdir(output, { recursive: true });
const head = run('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
  stdio: 'pipe',
}).trim();
if (head !== revision)
  throw new Error(`Expected Tailscale ${revision}, found ${head}`);
let bridge = run('git', ['show', `${revision}:cmd/tsconnect/wasm/wasm_js.go`], {
  encoding: 'utf8',
  stdio: 'pipe',
});
bridge = bridge.replace(
  '"tailscale.com/control/controlclient"',
  '"tailscale.com/types/logger"',
);
bridge = bridge.replace('controlclient.LoginEphemeral', '0');
bridge = bridge.replace(
  'logtail := logtail.NewLogger(c, log.Printf)\n\tlogf := logtail.Logf',
  '_ = c // Note does not send diagnostic logs to a third party.\n\tlogf := logger.Discard',
);
bridge = bridge.replace(
  'log.Printf("NOTIFY: %+v", n)',
  '// Do not log identity, login URLs or network maps.',
);
bridge = bridge.replace(
  'return map[string]any{\n\t\t"run":',
  'return noteExports(jsIPN, map[string]any{\n\t\t"run":',
);
bridge = bridge.replace(
  '\n\t}\n}\n\ntype jsIPN struct',
  '\n\t})\n}\n\ntype jsIPN struct',
);
await fs.writeFile(path.join(source, 'cmd/tsconnect/wasm/wasm_js.go'), bridge);
for (const name of ['note_js.go', 'isrgrootx1.crt', 'isrgrootx2.crt'])
  await fs.copyFile(
    path.join(root, 'networking/tailscale', name),
    path.join(source, 'cmd/tsconnect/wasm', name),
  );
await fs.mkdir(path.join(source, 'cmd/note-build-flags'), { recursive: true });
await fs.writeFile(
  path.join(source, 'cmd/note-build-flags/main.go'),
  'package main\nimport ("fmt"; "tailscale.com/cmd/tsconnect/wasmbuild")\nfunc main(){fmt.Print(wasmbuild.Tags())}\n',
);
// Use upstream's feature set with stock Go, not the optional Tailscale Go fork.
const tags = run(go, ['run', './cmd/note-build-flags'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
  .trim()
  .split(',')
  .filter((tag) => tag !== 'tailscale_go')
  .join(',');
run(
  go,
  [
    'build',
    '-tags',
    tags,
    '-trimpath',
    '-ldflags=-s -w',
    '-o',
    path.join(output, 'main.wasm'),
    './cmd/tsconnect/wasm',
  ],
  { env: { ...process.env, GOOS: 'js', GOARCH: 'wasm', GOTOOLCHAIN: 'local' } },
);
const goroot = run(go, ['env', 'GOROOT'], {
  encoding: 'utf8',
  stdio: 'pipe',
}).trim();
await fs.copyFile(
  path.join(goroot, 'lib/wasm/wasm_exec.js'),
  path.join(output, 'wasm_exec.js'),
);
await fs.copyFile(
  path.join(source, 'LICENSE'),
  path.join(output, 'TAILSCALE-LICENSE.txt'),
);
await fs.copyFile(
  path.join(goroot, 'LICENSE'),
  path.join(output, 'GO-LICENSE.txt'),
);
const wasm = await fs.readFile(path.join(output, 'main.wasm'));
await fs.writeFile(
  path.join(output, 'main.wasm.gz'),
  gzipSync(wasm, { level: 9 }),
);
await fs.writeFile(
  path.join(output, 'main.wasm.br'),
  brotliCompressSync(wasm, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
);
// Include licenses and notices for the downloaded modules in the pinned build.
const modules = run(go, ['list', '-m', '-json', 'all'], {
  encoding: 'utf8',
  stdio: 'pipe',
});
const moduleList = JSON.parse(
  '[' + modules.trim().replace(/}\s*{/g, '},{') + ']',
);
let notices =
  'Third-party software included in the Note embedded Tailscale build.\n';
for (const dependency of moduleList) {
  if (!dependency.Dir || dependency.Main) continue;
  for (const name of await fs.readdir(dependency.Dir)) {
    if (!/^(LICENSE|COPYING|NOTICE)(\.|$)/i.test(name)) continue;
    const filename = path.join(dependency.Dir, name);
    if (!(await fs.stat(filename)).isFile()) continue;
    notices +=
      `\n\n--- ${dependency.Path} ${dependency.Version} / ${name} ---\n` +
      (await fs.readFile(filename, 'utf8'));
  }
}
await fs.writeFile(path.join(output, 'THIRD-PARTY-NOTICES.txt'), notices);
await fs.writeFile(
  path.join(output, 'build.json'),
  JSON.stringify(
    {
      revision,
      go: run(go, ['version'], { encoding: 'utf8', stdio: 'pipe' }).trim(),
      sha256: createHash('sha256').update(wasm).digest('hex'),
      bytes: wasm.length,
    },
    null,
    2,
  ),
);
console.log(
  `Embedded Tailscale built: ${(wasm.length / 1024 / 1024).toFixed(1)} MiB`,
);
