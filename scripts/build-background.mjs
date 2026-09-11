import { build } from 'esbuild';
import fs from 'node:fs/promises';
await build({entryPoints:['lib/background-entry.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/client/background.js',minify:true});
await fs.writeFile('dist/client/background.html',"<!doctype html><html lang=\"ko\"><head><meta charset=\"UTF-8\"><title>자동 동기화</title></head><body><script type=\"module\" src=\"/background.js\"></script></body></html>\n");
