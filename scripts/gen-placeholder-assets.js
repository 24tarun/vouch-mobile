/**
 * Generates solid-colour placeholder PNG assets for Expo.
 * Replace the output files with real artwork before App Store submission.
 * Run: node scripts/gen-placeholder-assets.js
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ─── Minimal PNG encoder ──────────────────────────────────────────────────────

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type);
  const l = Buffer.allocUnsafe(4); l.writeUInt32BE(data.length);
  const c = Buffer.allocUnsafe(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, c]);
}

function solidPNG(w, h, r, g, b) {
  const header = Buffer.from([137,80,78,71,13,10,26,10]);

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8]=8; ihdr[9]=2; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;

  const rowLen = 1 + w * 3;
  const raw = Buffer.allocUnsafe(h * rowLen);
  for (let y = 0; y < h; y++) {
    const off = y * rowLen;
    raw[off] = 0; // filter None
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x*3]   = r;
      raw[off + 1 + x*3+1] = g;
      raw[off + 1 + x*3+2] = b;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([header, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ─── Write assets ─────────────────────────────────────────────────────────────

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });

const BG = [15, 15, 15]; // #0F0F0F

fs.writeFileSync(path.join(out, 'icon.png'),          solidPNG(1024, 1024, ...BG));
fs.writeFileSync(path.join(out, 'adaptive-icon.png'), solidPNG(1024, 1024, ...BG));
fs.writeFileSync(path.join(out, 'splash.png'),        solidPNG(1284, 2778, ...BG));
fs.writeFileSync(path.join(out, 'favicon.png'),       solidPNG(32,   32,   ...BG));

console.log('✓  Placeholder assets written to assets/');
console.log('   Replace with real artwork before App Store submission.');
