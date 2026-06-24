// Generates FocusLock icons (rounded indigo squares) with no image libraries —
// builds valid PNGs by hand (zlib + CRC32).
//   resources/tray.png  (32px, system tray)
//   build/icon.png      (256px, installer / app icon — electron-builder makes the .ico)
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

// FocusLock indigo (#6366F1)
const R = 99
const G = 102
const B = 241

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}

/** Alpha for a rounded-rect mask at (x, y). */
function alphaAt(x, y, size, radius) {
  const cx = Math.min(x, size - 1 - x)
  const cy = Math.min(y, size - 1 - y)
  if (cx >= radius || cy >= radius) return 255
  const dx = radius - cx
  const dy = radius - cy
  return Math.sqrt(dx * dx + dy * dy) <= radius ? 255 : 0
}

function makePng(size) {
  const radius = Math.round(size * 0.18)
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = 1 + size * 4
  const raw = Buffer.alloc(size * stride)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const o = y * stride + 1 + x * 4
      raw[o] = R
      raw[o + 1] = G
      raw[o + 2] = B
      raw[o + 3] = alphaAt(x, y, size, radius)
    }
  }
  const idat = zlib.deflateSync(raw)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

function write(rel, size) {
  const out = path.join(__dirname, '..', rel)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const png = makePng(size)
  fs.writeFileSync(out, png)
  console.log(`Wrote ${rel} (${size}px, ${png.length} bytes)`)
}

write('resources/tray.png', 32)
write('build/icon.png', 256)
