import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const source = await fs.readFile('public/favicon.svg');
await Promise.all(
  [16, 32, 192, 512].map((size) =>
    sharp(source)
      .resize(size, size)
      .png()
      .toFile(`public/${size < 192 ? 'favicon' : 'icon'}-${size}.png`),
  ),
);
// PNG entries in ICO provide a fallback for browsers that do not use SVG icons.
const pngs = await Promise.all(
  [16, 32].map((size) => fs.readFile(`public/favicon-${size}.png`)),
);
const header = Buffer.alloc(6 + pngs.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach((png, index) => {
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = [16, 32][index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
await fs.writeFile('public/favicon.ico', Buffer.concat([header, ...pngs]));
const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(densities)) {
  const directory = `android/app/src/main/res/mipmap-${density}`;
  await fs.mkdir(directory, { recursive: true });
  for (const file of ['ic_launcher.png', 'ic_launcher_round.png'])
    await sharp(source)
      .resize(size, size)
      .png()
      .toFile(path.join(directory, file));
}
console.log(
  'Web and Android launcher icons generated from the shared brand vector.',
);
