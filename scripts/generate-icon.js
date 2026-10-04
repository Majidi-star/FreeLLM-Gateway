import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createPNG(width, height) {
  // Create 512x512 PNG with blue/teal GoalRoute theme (#0f172a / #3b82f6)
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = [0]; // Filter type 0: None
    for (let x = 0; x < width; x++) {
      // Circle gradient icon
      const dx = x - width / 2;
      const dy = y - height / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const isInside = dist < (width / 2 - 16);
      
      if (isInside) {
        // Gradient from cyan (#06b6d4) to indigo (#4f46e5)
        const t = (x + y) / (width + height);
        const r = Math.round(6 + t * (79 - 6));
        const g = Math.round(182 + t * (70 - 182));
        const b = Math.round(212 + t * (229 - 212));
        row.push(r, g, b, 255);
      } else {
        row.push(0, 0, 0, 0); // Transparent
      }
    }
    rows.push(Buffer.from(row));
  }
  
  const rawData = Buffer.concat(rows);
  const compressed = zlib.deflateSync(rawData);

  // Helper for CRC32
  function crc32(buf) {
    let c = 0xffffffff;
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let k = n;
      for (let m = 0; m < 8; m++) {
        if (k & 1) k = 0xedb88320 ^ (k >>> 1);
        else k = k >>> 1;
      }
      table[n] = k;
    }
    for (let i = 0; i < buf.length; i++) {
      c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const typeAndData = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(typeAndData), 0);
    return Buffer.concat([len, typeAndData, crcBuf]);
  }

  // Header
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  
  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // Bit depth
  ihdrData.writeUInt8(6, 9); // Color type 6 (RGBA)
  ihdrData.writeUInt8(0, 10); // Compression
  ihdrData.writeUInt8(0, 11); // Filter
  ihdrData.writeUInt8(0, 12); // Interlace
  const ihdr = makeChunk('IHDR', ihdrData);

  // IDAT
  const idat = makeChunk('IDAT', compressed);

  // IEND
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdr, idat, iend]);
}

const buildDir = path.resolve(process.cwd(), 'build');
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

const iconPath = path.join(buildDir, 'icon.png');
const pngBuffer = createPNG(512, 512);
fs.writeFileSync(iconPath, pngBuffer);
console.log(`[✓] Generated application icon at ${iconPath} (${pngBuffer.length} bytes)`);
