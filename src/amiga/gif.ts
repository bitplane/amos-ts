/** GIF87a/GIF89a picture datatype decoder (first composited frame). */

export interface GifBitmap {
  width: number
  height: number
  depth: number
  pixels: Uint8Array
  /** RGB4, matching the other shared indexed-picture decoders. */
  palette: number[]
  alpha?: Uint8Array
}

const rgb4 = (r: number, g: number, b: number): number =>
  ((r >>> 4) << 8) | ((g >>> 4) << 4) | (b >>> 4)

function table(bytes: Uint8Array, at: number, count: number): { palette: number[]; at: number } | null {
  if (at + count * 3 > bytes.length) return null
  const palette: number[] = []
  for (let i = 0; i < count; i++) palette.push(rgb4(bytes[at + i * 3]!, bytes[at + i * 3 + 1]!, bytes[at + i * 3 + 2]!))
  return { palette, at: at + count * 3 }
}

function blocks(bytes: Uint8Array, start: number): { data: Uint8Array; at: number } | null {
  const parts: Uint8Array[] = []
  let size = 0
  let at = start
  for (;;) {
    if (at >= bytes.length) return null
    const n = bytes[at++]!
    if (n === 0) break
    if (at + n > bytes.length) return null
    parts.push(bytes.subarray(at, at + n))
    size += n
    at += n
  }
  const data = new Uint8Array(size)
  let out = 0
  for (const part of parts) { data.set(part, out); out += part.length }
  return { data, at }
}

function lzw(data: Uint8Array, minimum: number, wanted: number): Uint8Array | null {
  if (minimum < 2 || minimum > 8) return null
  const clear = 1 << minimum
  const end = clear + 1
  let width = minimum + 1
  let next = end + 1
  let bit = 0
  let previous: Uint8Array | null = null
  let dictionary: Uint8Array[] = []
  const reset = (): void => {
    dictionary = Array.from({ length: clear }, (_, i) => Uint8Array.of(i))
    dictionary[clear] = new Uint8Array()
    dictionary[end] = new Uint8Array()
    width = minimum + 1
    next = end + 1
    previous = null
  }
  const read = (): number | null => {
    if (bit + width > data.length * 8) return null
    let code = 0
    for (let i = 0; i < width; i++, bit++) code |= ((data[bit >>> 3]! >>> (bit & 7)) & 1) << i
    return code
  }
  reset()
  const out = new Uint8Array(wanted)
  let at = 0
  while (at < wanted) {
    const code = read()
    if (code === null || code === end) break
    if (code === clear) { reset(); continue }
    let entry = dictionary[code]
    if (!entry && code === next && previous) {
      entry = new Uint8Array(previous.length + 1)
      entry.set(previous)
      entry[previous.length] = previous[0]!
    }
    if (!entry || entry.length === 0) return null
    const take = Math.min(entry.length, wanted - at)
    out.set(entry.subarray(0, take), at)
    at += take
    if (previous && next < 4096) {
      const added = new Uint8Array(previous.length + 1)
      added.set(previous)
      added[previous.length] = entry[0]!
      dictionary[next++] = added
      if (next === (1 << width) && width < 12) width++
    }
    previous = entry
  }
  return at === wanted ? out : null
}

/** Decode the first GIF image onto its logical screen. */
export function decodeGif(bytes: Uint8Array): GifBitmap | null {
  if (bytes.length < 13) return null
  const sig = String.fromCharCode(...bytes.subarray(0, 6))
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null
  const word = (at: number): number => bytes[at]! | (bytes[at + 1]! << 8)
  const width = word(6)
  const height = word(8)
  if (width < 1 || height < 1 || width * height > 0x10000000) return null
  const packed = bytes[10]!
  const background = bytes[11]!
  let at = 13
  let global: number[] = []
  if (packed & 0x80) {
    const got = table(bytes, at, 1 << ((packed & 7) + 1))
    if (!got) return null
    global = got.palette
    at = got.at
  }
  let transparent = -1
  while (at < bytes.length) {
    const marker = bytes[at++]!
    if (marker === 0x3b) return null
    if (marker === 0x21) {
      if (at >= bytes.length) return null
      const kind = bytes[at++]!
      const got = blocks(bytes, at)
      if (!got) return null
      if (kind === 0xf9 && got.data.length >= 4 && (got.data[0]! & 1)) transparent = got.data[3]!
      at = got.at
      continue
    }
    if (marker !== 0x2c || at + 9 > bytes.length) return null
    const left = word(at); const top = word(at + 2)
    const imageWidth = word(at + 4); const imageHeight = word(at + 6)
    const imagePacked = bytes[at + 8]!
    at += 9
    let palette = global
    if (imagePacked & 0x80) {
      const got = table(bytes, at, 1 << ((imagePacked & 7) + 1))
      if (!got) return null
      palette = got.palette
      at = got.at
    }
    if (palette.length === 0 || at >= bytes.length) return null
    const minimum = bytes[at++]!
    const got = blocks(bytes, at)
    if (!got) return null
    const decoded = lzw(got.data, minimum, imageWidth * imageHeight)
    if (!decoded) return null
    const pixels = new Uint8Array(width * height).fill(background)
    const alpha = new Uint8Array(width * height).fill(background === transparent ? 0 : 255)
    const rows: number[] = []
    if (imagePacked & 0x40) {
      for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start!; y < imageHeight; y += step!) rows.push(y)
    } else for (let y = 0; y < imageHeight; y++) rows.push(y)
    for (let sourceY = 0; sourceY < imageHeight; sourceY++) {
      const y = top + rows[sourceY]!
      if (y >= height) continue
      for (let x = 0; x < imageWidth && left + x < width; x++) {
        const value = decoded[sourceY * imageWidth + x]!
        const dest = y * width + left + x
        pixels[dest] = value
        alpha[dest] = value === transparent ? 0 : 255
      }
    }
    return { width, height, depth: Math.ceil(Math.log2(Math.max(2, palette.length))), pixels, palette, alpha }
  }
  return null
}
