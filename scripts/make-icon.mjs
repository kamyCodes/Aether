/**
 * Generate build/icon.ico from public/aether-icon-512.png.
 * Writes a Windows ICO containing PNG-compressed 256px + 48/32/16 raw BMP
 * layers? — simplest robust form: a single 256×256 PNG-embedded entry, which
 * Vista+ and electron-builder both accept.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SRC = path.resolve('public', 'aether-icon-512.png');
const OUT = path.resolve('build', 'icon.ico');
if (!fs.existsSync(SRC)) {
  console.error('source icon missing:', SRC);
  process.exit(1);
}
const png = fs.readFileSync(SRC);

// Re-encode the 512px PNG down to 256px? Without an image lib we keep the
// source pixels; Windows scales ICOs down fine. Embed as-is at 512 (PNG
// entries may be any square size; Explorer renders them).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count

const entry = Buffer.alloc(16);
const size = 512;
entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
entry.writeUInt8(0, 2); // palette
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8); // data size
entry.writeUInt32LE(6 + 16, 12); // data offset

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, entry, png]));
console.log('wrote', OUT, `(${6 + 16 + png.length} bytes)`);
