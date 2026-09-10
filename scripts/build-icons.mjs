import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const source = await fs.readFile('public/favicon.svg');
await Promise.all(
  [192, 512].map((size) =>
    sharp(source).resize(size, size).png().toFile(`public/icon-${size}.png`),
  ),
);
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
