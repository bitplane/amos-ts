import { BinReader } from './binreader'
import { rowBytesFor } from '../amiga/planar'

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

  const rowBytes = rowBytesFor(width)
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

/** ByteRun1 (PackBits) compress one plane row (Save Iff BODY encoding) */
function packRow(row: Uint8Array): number[] {
  const out: number[] = []
  let i = 0
  while (i < row.length) {
    // count a run of identical bytes
    let run = 1
    while (i + run < row.length && row[i + run] === row[i] && run < 128) run++
    if (run >= 2) {
      out.push(257 - run, row[i]!)
      i += run
    } else {
      // literal run: up to 128 bytes until a >=2 repeat begins
      const start = i
      let lit = 0
      while (i < row.length && lit < 128) {
        if (i + 1 < row.length && row[i + 1] === row[i] && i + 2 < row.length && row[i + 2] === row[i]) break
        i++
        lit++
      }
      out.push(lit - 1)
      for (let j = start; j < i; j++) out.push(row[j]!)
    }
  }
  return out
}

/**
 * Encode an indexed image as a compressed IFF ILBM (Save Iff): FORM ILBM
 * with BMHD (compression 1 = ByteRun1), CMAP (RGB4 → 8-bit), CAMG (the
 * viewport mode) and a row-interleaved BODY. The exact inverse of
 * parseIlbm for the fields AMOS round-trips.
 */
export function encodeIlbm(img: IlbmImage): Uint8Array {
  const { width, height, depth, mode, palette, pixels } = img
  const rowBytes = rowBytesFor(width)
  const chunks: Array<[string, number[]]> = []
  chunks.push([
    'BMHD',
    [
      width >> 8, width & 255, height >> 8, height & 255,
      0, 0, 0, 0, // x, y
      depth, 0 /* masking */, 1 /* compression = ByteRun1 */, 0 /* pad */,
      0, 0, // transparent colour
      1, 1, // aspect x, y
      width >> 8, width & 255, height >> 8, height & 255, // page w, h
    ],
  ])
  const cmap: number[] = []
  // Write back as many entries as we were handed rather than truncating to
  // the bitplane count: a CMAP wider than 2^depth is legal and real files use
  // it (AMOS 3D's Scrollpic.IFF is three planes with all 32 entries), and on
  // the Amiga the registers past the screen's depth still drive the sprites.
  //
  // The ceiling was 32, which is ECS's whole register file and was every
  // picture in the corpus until GMS's own logos arrived:
  // `gms/dev/Logos/GMSLogo-FullScreen.iff` is six planes with 64 CMAP entries
  // and no EHB bit — an ordinary AGA picture — and 32 of its colours were
  // being dropped on the way out. 256 is the AGA register file and what
  // `Screen.palette` holds.
  const n = Math.min(palette.length || 1 << depth, 256)
  for (let i = 0; i < n; i++) {
    const v = palette[i] ?? 0
    // RGB4 nibble → 8-bit, replicated into both nibbles like the Amiga
    cmap.push((((v >> 8) & 15) * 17) & 255, (((v >> 4) & 15) * 17) & 255, ((v & 15) * 17) & 255)
  }
  chunks.push(['CMAP', cmap])
  chunks.push(['CAMG', [(mode >>> 24) & 255, (mode >>> 16) & 255, (mode >>> 8) & 255, mode & 255]])

  const body: number[] = []
  const row = new Uint8Array(rowBytes)
  for (let y = 0; y < height; y++) {
    for (let plane = 0; plane < depth; plane++) {
      row.fill(0)
      const bit = 1 << plane
      const base = y * width
      for (let x = 0; x < width; x++) {
        if (pixels[base + x]! & bit) row[x >> 3]! |= 1 << (7 - (x & 7))
      }
      body.push(...packRow(row))
    }
  }
  chunks.push(['BODY', body])

  // assemble FORM
  const put = (arr: number[], s: string): void => {
    for (let i = 0; i < s.length; i++) arr.push(s.charCodeAt(i))
  }
  const put32 = (arr: number[], v: number): void => { arr.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255) }
  const inner: number[] = []
  put(inner, 'ILBM')
  for (const [id, data] of chunks) {
    put(inner, id)
    put32(inner, data.length)
    inner.push(...data)
    if (data.length & 1) inner.push(0) // pad to even
  }
  const form: number[] = []
  put(form, 'FORM')
  put32(form, inner.length)
  form.push(...inner)
  return Uint8Array.from(form)
}
