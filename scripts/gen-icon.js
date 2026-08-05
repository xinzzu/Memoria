const zlib = require("node:zlib");
const fs = require("node:fs");

const SIZE = 256;

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(px) {
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    for (let x = 0; x < SIZE; x++) {
      const o = y * (SIZE * 4 + 1) + 1 + x * 4;
      const c = px[y][x];
      raw[o] = c[0];
      raw[o + 1] = c[1];
      raw[o + 2] = c[2];
      raw[o + 3] = c[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// gradient blue background + white circle (brain-ish)
const px = [];
for (let y = 0; y < SIZE; y++) {
  const row = [];
  for (let x = 0; x < SIZE; x++) {
    const t = (x + y) / (2 * SIZE);
    const r = Math.round(30 + 49 * t);
    const g = Math.round(58 + 82 * t);
    const b = Math.round(120 + 135 * t);
    const dx = x - 128;
    const dy = y - 128;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 70) {
      row.push([255, 255, 255, 255]);
    } else if (dist < 85) {
      row.push([255, 255, 255, 255]);
    } else {
      row.push([r, g, b, 255]);
    }
  }
  px.push(row);
}

const png = makePng(px);
fs.mkdirSync("build", { recursive: true });
fs.writeFileSync("build/icon.png", png);

// ICO (Vista+ format, embeds PNG)
const icondir = Buffer.alloc(6);
icondir.writeUInt16LE(0, 0); // reserved
icondir.writeUInt16LE(1, 2); // type icon
icondir.writeUInt16LE(1, 4); // count
const entries = [];
const sizes = [256, 64, 48, 32];
let offset = 6 + 16 * sizes.length;
for (let i = 0; i < sizes.length; i++) {
  const s = sizes[i];
  const entry = Buffer.alloc(16);
  entry[0] = s >= 256 ? 0 : s;
  entry[1] = s >= 256 ? 0 : s;
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  entries.push(entry);
}
fs.writeFileSync("build/icon.ico", Buffer.concat([icondir, ...entries, png]));
console.log("icons written: build/icon.png, build/icon.ico");
