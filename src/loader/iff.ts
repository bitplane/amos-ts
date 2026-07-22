import { BinReader } from './binreader'

/**
 * IFF ILBM picture loader (Load Iff): BMHD/CMAP/CAMG/BODY with ByteRun1
 * decompression, planar → chunky. HAM images decode as plain indexed
 * (wrong colours, honest limitation until a HAM composite exists); EHB
 * palettes get their upper 32 half-brightness entries computed.
 */
export interface IlbmImage {
  width: number
  height: number
  depth: number
  /** CAMG viewport mode: $8000 hires, $4 lace, $800 HAM, $80 EHB */
  mode: number
  /** RGB4 palette (up to 64 entries for EHB) */
  palette: number[]
  /** chunky pixels, width*height */
  pixels: Uint8Array
}

export function parseIlbm(bytes: Uint8Array): IlbmImage {
  const r = new BinReader(bytes)
  if (r.str(4) !== 'FORM') throw new Error('not an IFF file')
  r.u32()
  if (r.str(4) !== 'ILBM') throw new Error('not an ILBM picture')

  let width = 0
  let height = 0
  let depth = 0
  let masking = 0
  let compression = 0
  let mode = 0
  const palette: number[] = []
  let body: Uint8Array | null = null

  while (r.remaining >= 8) {
    const id = r.str(4)
    const len = r.u32()
    const next = Math.min(r.pos + len + (len & 1), bytes.length)
    switch (id) {
      case 'BMHD':
        width = r.u16()
        height = r.u16()
        r.skip(4) // x, y
        depth = r.u8()
        masking = r.u8()
        compression = r.u8()
        break
      case 'CMAP': {
        for (let i = 0; i + 2 < len; i += 3) {
          const red = r.u8()
          const green = r.u8()
          const blue = r.u8()
          palette.push(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4))
        }
        break
      }
      case 'CAMG':
        mode = r.u32()
        break
      case 'BODY':
        body = bytes.subarray(r.pos, r.pos + len)
        break
    }
    r.seek(next)
  }
  if (body === null || width === 0 || depth === 0) {
    // palette-only IFFs (CMAP, no BODY) are used by Load Iff to set colours
    if (palette.length > 0) return { width: 0, height: 0, depth, mode, palette, pixels: new Uint8Array(0) }
    throw new Error('ILBM missing BMHD or BODY')
  }

  if (mode & 0x80) {
    // extra-half-brite: upper 32 colours are half of the lower
    for (let i = 0; i < 32 && palette.length < 64; i++) {
      const v = palette[i] ?? 0
      palette.push((((v >> 8) & 15) >> 1 << 8) | ((((v >> 4) & 15) >> 1) << 4) | ((v & 15) >> 1))
    }
  }

  const rowBytes = ((width + 15) >> 4) * 2
  const planesPerRow = depth + (masking === 1 ? 1 : 0)
  const pixels = new Uint8Array(width * height)
  const row = new Uint8Array(rowBytes)
  let p = 0

  for (let y = 0; y < height; y++) {
    for (let plane = 0; plane < planesPerRow; plane++) {
      // unpack one plane row
      if (compression === 1) {
        let out = 0
        while (out < rowBytes && p < body.length) {
          const n = body[p++]!
          if (n < 128) {
            for (let i = 0; i <= n && out < rowBytes; i++) row[out++] = body[p++] ?? 0
          } else if (n > 128) {
            const v = body[p++] ?? 0
            for (let i = 0; i < 257 - n && out < rowBytes; i++) row[out++] = v
          }
        }
      } else {
        row.set(body.subarray(p, p + rowBytes))
        p += rowBytes
      }
      if (plane >= depth) continue // mask plane — skipped
      const bit = 1 << plane
      const base = y * width
      for (let x = 0; x < width; x++) {
        if ((row[x >> 3]! >> (7 - (x & 7))) & 1) pixels[base + x] = pixels[base + x]! | bit
      }
    }
  }

  return { width, height, depth, mode, palette, pixels }
}
