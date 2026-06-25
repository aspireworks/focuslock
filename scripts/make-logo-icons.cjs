// Generates Spawncamp's icons from the master logo at brand/spawncamp-logo.png.
// No image libraries — PNGs are decoded/encoded by hand (zlib + CRC32).
// Auto-crops the shield mark out of the "icon + wordmark" logo (it finds the
// transparent gutter between them), recolors it white, and emits:
//   src/renderer/src/assets/spawncamp-icon.png  (white shield, transparent — in-app rail badge)
//   build/icon.png    (256px, white shield on the indigo brand square — app/installer icon)
//   resources/tray.png (32px, same — system tray)
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'brand', 'spawncamp-logo.png')
const INDIGO = [99, 102, 241] // #6366F1

// ---------- PNG decode (8-bit RGBA, non-interlaced) ----------
function decode(buf) {
  let p = 8
  const idat = []
  let W, H, ct
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    const data = buf.slice(p + 8, p + 8 + len)
    if (type === 'IHDR') { W = data.readUInt32BE(0); H = data.readUInt32BE(4); ct = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  if (ct !== 6) throw new Error('expected RGBA source (colorType 6), got ' + ct)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const ch = 4, stride = W * ch
  const img = Buffer.alloc(H * stride)
  const prev = Buffer.alloc(stride)
  const paeth = (a, b, c) => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
  let pos = 0
  for (let y = 0; y < H; y++) {
    const f = raw[pos++]
    const row = img.slice(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const x = raw[pos++]
      const a = i >= ch ? row[i - ch] : 0
      const b = prev[i]
      const c = i >= ch ? prev[i - ch] : 0
      let v
      switch (f) { case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + b; break; case 3: v = x + ((a + b) >> 1); break; case 4: v = x + paeth(a, b, c); break; default: v = x }
      row[i] = v & 0xff
    }
    row.copy(prev)
  }
  return { W, H, img }
}

// ---------- PNG encode (8-bit RGBA) ----------
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return (~c) >>> 0 }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crc]) }
function encode(W, H, img) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6
  const stride = 1 + W * 4
  const raw = Buffer.alloc(H * stride)
  for (let y = 0; y < H; y++) { raw[y * stride] = 0; img.copy(raw, y * stride + 1, y * W * 4, (y + 1) * W * 4) }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ---------- isolate the shield: first opaque cluster before a wide transparent gutter ----------
function extractWhiteShield(dec) {
  const { W, H, img } = dec
  const A = (x, y) => img[(y * W + x) * 4 + 3]
  const col = new Array(W).fill(0)
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (A(x, y) > 16) col[x]++
  const firstX = col.findIndex((c) => c > 0)
  // walk right until a run of >=20 fully-empty columns: that's the icon/wordmark gutter
  let gutterStart = -1, run = 0
  for (let x = firstX; x < W; x++) {
    if (col[x] === 0) { if (run === 0) gutterStart = x; run++; if (run >= 20) break }
    else { run = 0; gutterStart = -1 }
  }
  const endX = gutterStart > 0 ? gutterStart - 1 : W - 1
  let top = -1, bot = -1
  for (let y = 0; y < H; y++) { let any = false; for (let x = firstX; x <= endX; x++) if (A(x, y) > 16) { any = true; break } if (any) { if (top < 0) top = y; bot = y } }
  const w = endX - firstX + 1, h = bot - top + 1
  const out = Buffer.alloc(w * h * 4) // white pixels, alpha taken from the source mark
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = A(firstX + i, top + j)
    const o = (j * w + i) * 4
    out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; out[o + 3] = a
  }
  console.log(`  shield cropped at x:${firstX} y:${top} ${w}x${h}`)
  return { w, h, buf: out }
}

// ---------- the whole logo (icon + wordmark), recolored white, tightly trimmed ----------
function extractWhiteFull(dec) {
  const { W, H, img } = dec
  const A = (x, y) => img[(y * W + x) * 4 + 3]
  let minX = W, minY = H, maxX = -1, maxY = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (A(x, y) > 16) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const w = maxX - minX + 1, h = maxY - minY + 1
  const out = Buffer.alloc(w * h * 4)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = A(minX + i, minY + j)
    const o = (j * w + i) * 4
    out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; out[o + 3] = a
  }
  console.log(`  full logo trimmed to ${w}x${h}`)
  return { w, h, buf: out }
}

// ---------- area-average downscale with premultiplied alpha (no edge fringing) ----------
function resize(src, dw, dh) {
  const { w: sw, h: sh, buf } = src
  const out = Buffer.alloc(dw * dh * 4)
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = dy * sh / dh, sy1 = (dy + 1) * sh / dh
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = dx * sw / dw, sx1 = (dx + 1) * sw / dw
      let r = 0, g = 0, b = 0, a = 0, wsum = 0
      for (let yy = Math.floor(sy0); yy < Math.min(sh, Math.ceil(sy1)); yy++) {
        const covY = Math.min(yy + 1, sy1) - Math.max(yy, sy0)
        for (let xx = Math.floor(sx0); xx < Math.min(sw, Math.ceil(sx1)); xx++) {
          const covX = Math.min(xx + 1, sx1) - Math.max(xx, sx0)
          const cw = covX * covY
          const o = (yy * sw + xx) * 4
          const al = buf[o + 3] / 255
          r += buf[o] * al * cw; g += buf[o + 1] * al * cw; b += buf[o + 2] * al * cw
          a += al * cw; wsum += cw
        }
      }
      const oo = (dy * dw + dx) * 4
      if (a > 0) { out[oo] = Math.round(r / a); out[oo + 1] = Math.round(g / a); out[oo + 2] = Math.round(b / a); out[oo + 3] = Math.round((a / wsum) * 255) }
      else { out[oo] = 255; out[oo + 1] = 255; out[oo + 2] = 255; out[oo + 3] = 0 }
    }
  }
  return { w: dw, h: dh, buf: out }
}

// ---------- source-over blit ----------
function blit(dst, DW, DH, src, ox, oy) {
  for (let j = 0; j < src.h; j++) for (let i = 0; i < src.w; i++) {
    const dx = ox + i, dy = oy + j
    if (dx < 0 || dy < 0 || dx >= DW || dy >= DH) continue
    const so = (j * src.w + i) * 4, doo = (dy * DW + dx) * 4
    const sa = src.buf[so + 3] / 255
    if (sa <= 0) continue
    const da = dst[doo + 3] / 255
    const outA = sa + da * (1 - sa)
    for (let k = 0; k < 3; k++) dst[doo + k] = Math.round((src.buf[so + k] * sa + dst[doo + k] * da * (1 - sa)) / (outA || 1))
    dst[doo + 3] = Math.round(outA * 255)
  }
}

// center the shield on a square canvas at the given scale fraction of the side
function composeOnto(canvas, S, glyph, scaleFrac) {
  const target = Math.round(S * scaleFrac)
  const s = Math.min(target / glyph.w, target / glyph.h)
  const scaled = resize(glyph, Math.max(1, Math.round(glyph.w * s)), Math.max(1, Math.round(glyph.h * s)))
  blit(canvas, S, S, scaled, Math.round((S - scaled.w) / 2), Math.round((S - scaled.h) / 2))
}

// anti-aliased rounded-square, filled indigo
function roundedIndigo(S) {
  const radius = Math.round(S * 0.18)
  const canvas = Buffer.alloc(S * S * 4)
  const corner = (x, y) => {
    const cx = Math.min(x, S - 1 - x), cy = Math.min(y, S - 1 - y)
    if (cx >= radius || cy >= radius) return 255
    const dx = radius - cx - 0.5, dy = radius - cy - 0.5
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d <= radius - 0.5) return 255
    if (d >= radius + 0.5) return 0
    return Math.round((radius + 0.5 - d) * 255)
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = (y * S + x) * 4
    canvas[o] = INDIGO[0]; canvas[o + 1] = INDIGO[1]; canvas[o + 2] = INDIGO[2]; canvas[o + 3] = corner(x, y)
  }
  return canvas
}

function write(rel, W, H, img) {
  const out = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const png = encode(W, H, img)
  fs.writeFileSync(out, png)
  console.log(`Wrote ${rel} (${W}x${H}, ${png.length} bytes)`)
}

// ---------- build ----------
console.log('Reading', path.relative(ROOT, SRC))
const dec = decode(fs.readFileSync(SRC))
const shield = extractWhiteShield(dec)

// In-app rail badge: white shield, transparent background, hi-res for crispness
const badge = Buffer.alloc(192 * 192 * 4)
composeOnto(badge, 192, shield, 0.86)
write('src/renderer/src/assets/spawncamp-icon.png', 192, 192, badge)

// Full horizontal logo, white on transparent — onboarding welcome screen
const full = extractWhiteFull(dec)
const wmW = 720
const wm = resize(full, wmW, Math.round((full.h * wmW) / full.w))
write('src/renderer/src/assets/spawncamp-wordmark.png', wm.w, wm.h, wm.buf)

// App/installer icon + tray: white shield on the indigo brand square
for (const [rel, S, frac] of [['build/icon.png', 256, 0.58], ['resources/tray.png', 32, 0.6]]) {
  const c = roundedIndigo(S)
  composeOnto(c, S, shield, frac)
  write(rel, S, S, c)
}
