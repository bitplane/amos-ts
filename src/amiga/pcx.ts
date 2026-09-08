/** ZSoft PCX: its 128-byte header, scanline RLE and planar pixel layouts. */
import { quantiseRgb, type IndexedBitmap } from './windowsbitmap'

const rgb4 = (r: number, g: number, b: number): number => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)

function palette16(data: Uint8Array): number[] {
  return Array.from({ length: 16 }, (_, i) => rgb4(data[16 + i * 3]!, data[17 + i * 3]!, data[18 + i * 3]!))
}

/** Expand exactly one image's worth of PCX RLE; trailing palette bytes stay unread. */
function unrle(data: Uint8Array, start: number, length: number): Uint8Array | null {
  const out = new Uint8Array(length)
  let source = start, target = 0
  while (target < length && source < data.length) {
    const token = data[source++]!
    let count = 1, value = token
    if ((token & 0xc0) === 0xc0) {
      count = token & 0x3f
      if (count === 0 || source >= data.length) return null
      value = data[source++]!
    }
    if (target + count > length) return null
    out.fill(value, target, target + count)
    target += count
  }
  return target === length ? out : null
}

function sample(row: Uint8Array, x: number, bits: number): number {
  if (bits === 8) return row[x] ?? 0
  const perByte = 8 / bits
  const shift = (perByte - 1 - (x % perByte)) * bits
  return ((row[Math.floor(x / perByte)] ?? 0) >> shift) & ((1 << bits) - 1)
}

export function decodePcx(data: Uint8Array): IndexedBitmap | null {
  if (data.length < 128 || data[0] !== 0x0a || data[2] !== 1) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const bits = data[3]!
  const xmin = view.getUint16(4, true), ymin = view.getUint16(6, true)
  const xmax = view.getUint16(8, true), ymax = view.getUint16(10, true)
  const width = xmax - xmin + 1, height = ymax - ymin + 1
  const planes = data[65]!
  const bytesPerLine = view.getUint16(66, true)
  if (width <= 0 || height <= 0 || ![1, 2, 4, 8].includes(bits) || planes < 1 || planes > 4) return null
  if (bytesPerLine < Math.ceil(width * bits / 8)) return null
  const decoded = unrle(data, 128, height * planes * bytesPerLine)
  if (!decoded) return null

  if (bits === 8 && planes >= 3) {
    const rgb = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const scan = y * planes * bytesPerLine
      const at = (y * width + x) * 3
      rgb[at] = decoded[scan + x]!
      rgb[at + 1] = decoded[scan + bytesPerLine + x]!
      rgb[at + 2] = decoded[scan + bytesPerLine * 2 + x]!
    }
    return quantiseRgb(rgb, width, height)
  }

  const totalBits = bits * planes
  if (totalBits > 8) return null
  const pixels = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const scan = y * planes * bytesPerLine
    let value = 0
    for (let plane = 0; plane < planes; plane++) {
      value |= sample(decoded.subarray(scan + plane * bytesPerLine, scan + (plane + 1) * bytesPerLine), x, bits) << (plane * bits)
    }
    pixels[y * width + x] = value
  }

  let palette: number[]
  if (bits === 8 && planes === 1) {
    const at = data.length - 769
    if (at < 128 || data[at] !== 0x0c) return null
    palette = Array.from({ length: 256 }, (_, i) => rgb4(data[at + 1 + i * 3]!, data[at + 2 + i * 3]!, data[at + 3 + i * 3]!))
  } else {
    palette = palette16(data).slice(0, 1 << totalBits)
  }
  return { width, height, depth: Math.max(1, Math.min(8, totalBits)), pixels, palette }
}
