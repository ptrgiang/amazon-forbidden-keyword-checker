// Generates the extension icons (red rounded badge with a white "!")
// as PNG files without any image dependencies: raw RGBA -> zlib -> PNG.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Signed distance helpers, drawn with 3x3 supersampling for smooth edges.
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = 3;
  const red = [220, 38, 38];
  const white = [255, 255, 255];
  const radius = size * 0.22;

  const inRoundedRect = (x, y) => {
    const pad = size * 0.04;
    const x0 = pad, y0 = pad, x1 = size - pad, y1 = size - pad;
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.max(x0 + radius, Math.min(x, x1 - radius));
    const cy = Math.max(y0 + radius, Math.min(y, y1 - radius));
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= radius * radius || (x >= x0 + radius && x <= x1 - radius) || (y >= y0 + radius && y <= y1 - radius);
  };

  const inBang = (x, y) => {
    const cx = size / 2;
    const barW = size * 0.14;
    const barTop = size * 0.22;
    const barBottom = size * 0.60;
    const dotR = size * 0.085;
    const dotCy = size * 0.755;
    if (Math.abs(x - cx) <= barW / 2 && y >= barTop && y <= barBottom) {
      return true;
    }
    const dx = x - cx, dy = y - dotCy;
    return dx * dx + dy * dy <= dotR * dotR;
  };

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0, fg = 0, total = S * S;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = px + (sx + 0.5) / S;
          const y = py + (sy + 0.5) / S;
          if (inRoundedRect(x, y)) {
            bg++;
            if (inBang(x, y)) fg++;
          }
        }
      }
      const i = (py * size + px) * 4;
      if (bg === 0) {
        rgba[i + 3] = 0;
        continue;
      }
      const fgRatio = fg / total;
      const bgRatio = bg / total;
      rgba[i] = Math.round(red[0] * (1 - fgRatio) + white[0] * fgRatio);
      rgba[i + 1] = Math.round(red[1] * (1 - fgRatio) + white[1] * fgRatio);
      rgba[i + 2] = Math.round(red[2] * (1 - fgRatio) + white[2] * fgRatio);
      rgba[i + 3] = Math.round(255 * bgRatio);
    }
  }
  return rgba;
}

for (const size of [16, 32, 48, 128]) {
  const png = encodePng(size, drawIcon(size));
  writeFileSync(join(outDir, `icon${size}.png`), png);
  console.log(`icon${size}.png (${png.length} bytes)`);
}
