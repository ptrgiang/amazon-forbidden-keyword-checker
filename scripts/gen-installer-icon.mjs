import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'public', 'icons');
const outDir = join(root, 'release');
const outFile = join(outDir, 'AmazonForbiddenKeywordCheckerSetup.ico');
const sizes = [16, 32, 48, 128];

mkdirSync(outDir, { recursive: true });

const images = sizes.map((size) => ({
  size,
  data: readFileSync(join(sourceDir, `icon${size}.png`))
}));

const headerSize = 6;
const entrySize = 16;
let imageOffset = headerSize + images.length * entrySize;

const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // icon
header.writeUInt16LE(images.length, 4);

const entries = [];
for (const image of images) {
  const entry = Buffer.alloc(entrySize);
  entry[0] = image.size === 256 ? 0 : image.size;
  entry[1] = image.size === 256 ? 0 : image.size;
  entry[2] = 0; // true color
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bit depth
  entry.writeUInt32LE(image.data.length, 8);
  entry.writeUInt32LE(imageOffset, 12);
  imageOffset += image.data.length;
  entries.push(entry);
}

writeFileSync(outFile, Buffer.concat([header, ...entries, ...images.map((image) => image.data)]));
console.log(`installer icon (${images.length} sizes): ${outFile}`);
