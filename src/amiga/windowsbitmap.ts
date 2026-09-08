/** Windows BMP and ICO pictures as indexed pixels suitable for Amiga bitplanes. */
export interface IndexedBitmap {
  width: number
  height: number
  depth: number
  pixels: Uint8Array
  /** RGB4 colours, the palette representation used by the runtime. */
  palette: number[]
  /** 0 transparent, 255 opaque; present for ICO images. */
  alpha?: Uint8Array
}

interface DibOptions { at: number; icon: boolean; dataEnd: number }

const rgb4 = (r: number, g: number, b: number): number => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
const strideFor = (width: number, bpp: number): number => Math.ceil(width * bpp / 32) * 4

function indexedDepth(colours: number): number {
  let depth = 1
  while ((1 << depth) < colours && depth < 8) depth++
  return depth
}

function decodeRle(data: Uint8Array, start: number, end: number, width: number, height: number, bpp: 4 | 8): Uint8Array | null {
  const pixels = new Uint8Array(width * height)
  let at = start, x = 0, y = height - 1
  const put = (value: number): void => { if (x < width && y >= 0 && y < height) pixels[y * width + x] = value; x++ }
  while (at + 1 < end && y >= 0) {
    const count = data[at++]!
    const value = data[at++]!
    if (count !== 0) {
      for (let i = 0; i < count; i++) put(bpp === 8 ? value : (i & 1) === 0 ? value >> 4 : value & 15)
      continue
    }
    if (value === 0) { x = 0; y--; continue }
    if (value === 1) break
    if (value === 2) {
      if (at + 1 >= end) return null
      x += data[at++]!; y -= data[at++]!
      continue
    }
    const literal = value
    if (bpp === 8) {
      if (at + literal > end) return null
      for (let i = 0; i < literal; i++) put(data[at++]!)
      if (literal & 1) at++
    } else {
      const bytes = Math.ceil(literal / 2)
      if (at + bytes > end) return null
      for (let i = 0; i < literal; i++) {
        const packed = data[at + (i >> 1)]!
        put((i & 1) === 0 ? packed >> 4 : packed & 15)
      }
      at += bytes + (bytes & 1)
    }
  }
  return pixels
}

function quantise(rgb: Uint8Array, width: number, height: number): IndexedBitmap {
  const pixels = new Uint8Array(width * height)
  const palette = Array.from({ length: 256 }, (_, value) => {
    const r = ((value >> 5) & 7) * 255 / 7
    const g = ((value >> 2) & 7) * 255 / 7
    const b = (value & 3) * 255 / 3
    return rgb4(r, g, b)
  })
  for (let i = 0; i < pixels.length; i++) pixels[i] = (rgb[i * 3]! & 0xe0) | ((rgb[i * 3 + 1]! & 0xe0) >> 3) | (rgb[i * 3 + 2]! >> 6)
  return { width, height, depth: 8, pixels, palette }
}

function decodeDib(data: Uint8Array, options: DibOptions): IndexedBitmap | null {
  const { at, icon, dataEnd } = options
  if (at + 40 > dataEnd) return null
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const header = v.getUint32(at, true)
  if (header < 40 || at + header > dataEnd) return null
  const width = v.getInt32(at + 4, true)
  const rawHeight = v.getInt32(at + 8, true)
  const height = Math.abs(icon ? rawHeight / 2 : rawHeight)
  const planes = v.getUint16(at + 12, true)
  const bpp = v.getUint16(at + 14, true)
  const compression = v.getUint32(at + 16, true)
  if (width <= 0 || !Number.isInteger(height) || height <= 0 || planes !== 1 || ![1, 4, 8, 24, 32].includes(bpp)) return null
  if (compression !== 0 && !((compression === 1 && bpp === 8) || (compression === 2 && bpp === 4))) return null

  const coloursUsed = v.getUint32(at + 32, true)
  const colourCount = bpp <= 8 ? (coloursUsed || 1 << bpp) : 0
  const palette: number[] = []
  let cursor = at + header
  if (cursor + colourCount * 4 > dataEnd) return null
  for (let i = 0; i < colourCount; i++, cursor += 4) palette.push(rgb4(data[cursor + 2]!, data[cursor + 1]!, data[cursor]!))
  const xorAt = cursor
  const rowStride = strideFor(width, bpp)
  const xorBytes = rowStride * height
  if (xorAt + xorBytes > dataEnd && compression === 0) return null

  let pixels: Uint8Array
  if (compression === 1 || compression === 2) {
    const decoded = decodeRle(data, xorAt, dataEnd, width, height, bpp as 4 | 8)
    if (!decoded) return null
    pixels = decoded
  } else if (bpp <= 8) {
    pixels = new Uint8Array(width * height)
    for (let sy = 0; sy < height; sy++) {
      const y = rawHeight < 0 && !icon ? sy : height - 1 - sy
      const row = xorAt + sy * rowStride
      for (let x = 0; x < width; x++) {
        const packed = data[row + ((x * bpp) >> 3)]!
        pixels[y * width + x] = bpp === 8 ? packed : bpp === 4 ? (x & 1 ? packed & 15 : packed >> 4) : (packed >> (7 - (x & 7))) & 1
      }
    }
  } else {
    const rgb = new Uint8Array(width * height * 3)
    for (let sy = 0; sy < height; sy++) {
      const y = rawHeight < 0 && !icon ? sy : height - 1 - sy
      const row = xorAt + sy * rowStride
      for (let x = 0; x < width; x++) {
        const source = row + x * (bpp >> 3)
        const target = (y * width + x) * 3
        rgb[target] = data[source + 2]!
        rgb[target + 1] = data[source + 1]!
        rgb[target + 2] = data[source]!
      }
    }
    const out = quantise(rgb, width, height)
    pixels = out.pixels
    palette.push(...out.palette)
  }

  if (!icon) return { width, height, depth: indexedDepth(palette.length), pixels, palette }
  const alpha = new Uint8Array(width * height).fill(255)
  let anyChannelAlpha = false
  if (bpp === 32) {
    for (let sy = 0; sy < height; sy++) for (let x = 0; x < width; x++) {
      const a = data[xorAt + sy * rowStride + x * 4 + 3]!
      alpha[(height - 1 - sy) * width + x] = a
      if (a !== 0) anyChannelAlpha = true
    }
  }
  const maskAt = xorAt + xorBytes
  const maskStride = strideFor(width, 1)
  if (!anyChannelAlpha && maskAt + maskStride * height <= dataEnd) {
    alpha.fill(255)
    for (let sy = 0; sy < height; sy++) for (let x = 0; x < width; x++) {
      if ((data[maskAt + sy * maskStride + (x >> 3)]! >> (7 - (x & 7))) & 1) alpha[(height - 1 - sy) * width + x] = 0
    }
  }
  return { width, height, depth: indexedDepth(palette.length), pixels, palette, alpha }
}

export function decodeBmp(data: Uint8Array): IndexedBitmap | null {
  if (data.length < 18 || data[0] !== 0x42 || data[1] !== 0x4d) return null
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const pixelsAt = v.getUint32(10, true)
  const headerAt = 14
  const decoded = decodeDib(data, { at: headerAt, icon: false, dataEnd: data.length })
  // For ordinary BMP the palette ends where bfOffBits says pixels begin.
  // Reject uncommon extra blocks rather than silently reading them as pixels.
  const header = v.getUint32(headerAt, true)
  const bpp = v.getUint16(headerAt + 14, true)
  const colours = bpp <= 8 ? (v.getUint32(headerAt + 32, true) || 1 << bpp) : 0
  return pixelsAt === headerAt + header + colours * 4 ? decoded : null
}

export function decodeIco(data: Uint8Array): IndexedBitmap | null {
  if (data.length < 22) return null
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (v.getUint16(0, true) !== 0 || v.getUint16(2, true) !== 1) return null
  const count = v.getUint16(4, true)
  if (count === 0 || 6 + count * 16 > data.length) return null
  const entries = Array.from({ length: count }, (_, i) => {
    const at = 6 + i * 16
    return { area: (data[at] || 256) * (data[at + 1] || 256), bpp: v.getUint16(at + 6, true), size: v.getUint32(at + 8, true), offset: v.getUint32(at + 12, true) }
  }).sort((a, b) => b.area - a.area || b.bpp - a.bpp)
  for (const entry of entries) {
    if (entry.offset + entry.size > data.length) continue
    const decoded = decodeDib(data, { at: entry.offset, icon: true, dataEnd: entry.offset + entry.size })
    if (decoded) return decoded
  }
  return null
}
