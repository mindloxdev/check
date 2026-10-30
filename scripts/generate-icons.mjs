#!/usr/bin/env node
/**
 * Generates the PWA icon set and favicon.
 *
 *   node scripts/generate-icons.mjs
 *
 * Writes real PNGs with no image dependency: a PNG is just a zlib-compressed
 * scanline stream, and `node:zlib` is in the standard library. Each pixel is
 * supersampled 4x4 and averaged, which is what gives the curves clean edges
 * without a rasteriser.
 *
 * Re-run this only when the brand mark changes; the output is committed so a
 * fresh clone can build without it.
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(here, '..', 'public')

// --- brand -----------------------------------------------------------------
const INDIGO = [67, 56, 202] // #4338CA, the primary token
const WHITE = [255, 255, 255]
const SUPERSAMPLE = 4

/**
 * Signed-distance helpers. Each returns true when the sample point is inside
 * the shape, in a 0..1 normalised coordinate space.
 */
const roundedSquare = (x, y, radius) => {
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - radius), 0)
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - radius), 0)
  return Math.hypot(dx, dy) <= radius
}

const ring = (x, y, cx, cy, outer, inner) => {
  const d = Math.hypot(x - cx, y - cy)
  return d <= outer && d >= inner
}

const disc = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) <= r

/** A clock hand: a thick line segment from the centre at a given angle. */
const hand = (x, y, cx, cy, angleDeg, length, thickness) => {
  const angle = ((angleDeg - 90) * Math.PI) / 180
  const ex = cx + Math.cos(angle) * length
  const ey = cy + Math.sin(angle) * length
  // Distance from point to the segment (cx,cy)-(ex,ey).
  const vx = ex - cx
  const vy = ey - cy
  const wx = x - cx
  const wy = y - cy
  const lenSq = vx * vx + vy * vy
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq))
  const px = cx + vx * t
  const py = cy + vy * t
  return Math.hypot(x - px, y - py) <= thickness / 2
}

/**
 * The mark: a clock reading 9 o'clock-ish — the default expected arrival —
 * knocked out of a rounded indigo square.
 *
 * `maskable` insets the glyph so it survives Android's circular crop, which
 * clips roughly 10% from each edge.
 */
function sample(x, y, { maskable, transparentBackground }) {
  const inBackground = transparentBackground
    ? roundedSquare(x, y, 0.22)
    : roundedSquare(x, y, maskable ? 0.5 : 0.22)

  if (!inBackground) return null // transparent

  // Shrink the glyph for the maskable variant so the crop cannot clip it.
  const scale = maskable ? 0.62 : 0.82
  const gx = (x - 0.5) / scale + 0.5
  const gy = (y - 0.5) / scale + 0.5

  const cx = 0.5
  const cy = 0.5

  const onGlyph =
    ring(gx, gy, cx, cy, 0.36, 0.295) ||
    // Hour hand to 9, minute hand to 12 — "09:00".
    hand(gx, gy, cx, cy, 270, 0.17, 0.062) ||
    hand(gx, gy, cx, cy, 0, 0.23, 0.062) ||
    disc(gx, gy, cx, cy, 0.045)

  return onGlyph ? WHITE : INDIGO
}

function renderPng(size, options) {
  // RGBA, one filter byte (0 = none) per scanline.
  const bytesPerPixel = 4
  const stride = size * bytesPerPixel + 1
  const raw = Buffer.alloc(stride * size)

  for (let py = 0; py < size; py += 1) {
    const rowStart = py * stride
    raw[rowStart] = 0
    for (let px = 0; px < size; px += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size
          const colour = sample(x, y, options)
          if (colour) {
            r += colour[0]
            g += colour[1]
            b += colour[2]
            a += 255
          }
        }
      }
      const samples = SUPERSAMPLE * SUPERSAMPLE
      const offset = rowStart + 1 + px * bytesPerPixel
      // Premultiplied average, then un-premultiply so edge pixels keep the
      // right hue instead of darkening toward black.
      const alpha = a / samples
      if (alpha === 0) {
        raw[offset] = 0
        raw[offset + 1] = 0
        raw[offset + 2] = 0
        raw[offset + 3] = 0
      } else {
        const covered = a / 255
        raw[offset] = Math.round(r / covered)
        raw[offset + 1] = Math.round(g / covered)
        raw[offset + 2] = Math.round(b / covered)
        raw[offset + 3] = Math.round(alpha)
      }
    }
  }

  return buildPng(size, size, raw)
}

// --- PNG container ---------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

function buildPng(width, height, raw) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: truecolour with alpha
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- SVG favicon -----------------------------------------------------------

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Office attendance">
  <rect width="64" height="64" rx="14" fill="#4338CA"/>
  <g fill="none" stroke="#FFFFFF" stroke-width="4.2" stroke-linecap="round">
    <circle cx="32" cy="32" r="16.5"/>
    <path d="M32 32V22"/>
    <path d="M32 32h-7.5"/>
  </g>
  <circle cx="32" cy="32" r="2.6" fill="#FFFFFF"/>
</svg>
`

// --- write -----------------------------------------------------------------

mkdirSync(publicDir, { recursive: true })

const targets = [
  { file: 'icon-192.png', size: 192, options: { maskable: false } },
  { file: 'icon-512.png', size: 512, options: { maskable: false } },
  { file: 'icon-512-maskable.png', size: 512, options: { maskable: true } },
  // iOS does not honour transparency on a home-screen icon, so the opaque
  // rounded square is exactly what it needs.
  { file: 'apple-touch-icon.png', size: 180, options: { maskable: false } },
]

for (const { file, size, options } of targets) {
  const png = renderPng(size, options)
  writeFileSync(resolve(publicDir, file), png)
  console.log(`wrote public/${file} (${size}x${size}, ${png.length} bytes)`)
}

writeFileSync(resolve(publicDir, 'favicon.svg'), FAVICON_SVG, 'utf8')
console.log('wrote public/favicon.svg')
