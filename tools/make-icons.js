// Draws the app icon (a white clock on teal) and saves it as PNG files in icons/.
// Also draws an orange version in icons/beta/ for the test copy of the app.
// Run with: npm run icons
// Uses only Node's built-in modules, so there's nothing to install.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [15, 118, 110];
const BETA_BG = [234, 88, 12];
const FG = [255, 255, 255];
const SIZES = [180, 192, 512];
const SAMPLES = 4; // 4x4 samples per pixel smooths the edges.

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Is the point (u, v), each from 0 to 1, part of the white clock?
function isClock(u, v) {
  const r = Math.hypot(u - 0.5, v - 0.5);
  if (r > 0.29 && r < 0.35) return true; // Clock face ring
  if (r < 0.035) return true; // Center dot
  if (distToSegment(u, v, 0.5, 0.5, 0.5, 0.28) < 0.022) return true; // Minute hand at 12
  const angle = (60 * Math.PI) / 180; // Hour hand at 2
  if (distToSegment(u, v, 0.5, 0.5, 0.5 + Math.sin(angle) * 0.15, 0.5 - Math.cos(angle) * 0.15) < 0.028) return true;
  return false;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function drawIcon(size, bg = BG) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // PNG filter type "none" for this row
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (isClock((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size)) hits++;
        }
      }
      const cover = hits / (SAMPLES * SAMPLES);
      for (let ch = 0; ch < 3; ch++) {
        raw[y * stride + 1 + x * 3 + ch] = Math.round(bg[ch] + (FG[ch] - bg[ch]) * cover);
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [folder, bg] of [['icons/', BG], ['icons/beta/', BETA_BG]]) {
  const outDir = new URL(`../${folder}`, import.meta.url);
  mkdirSync(outDir, { recursive: true });
  for (const size of SIZES) {
    writeFileSync(new URL(`icon-${size}.png`, outDir), drawIcon(size, bg));
    console.log(`${folder}icon-${size}.png`);
  }
}
