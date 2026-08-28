import { BinReader } from './binreader'

/**
 * Pac.Pic. packed picture decoder — a direct port of UnPack_Bitmap in
 * +Lib.s (the Compact extension's Spack/Unpack format).
 *
 * A bank holds an optional packed-screen header (magic $12031990: screen
 * geometry + palette) followed by a packed bitmap (magic $06071963).
 * Pixels are stored as vertical byte runs inside "lumps" of `lumpHeight`
 * rows, driven by two bitstreams: an RLE stream saying "fetch a new data
 * byte or repeat", and a points stream saying "fetch a new RLE byte or
 * reuse it". The streams run continuously across all bitplanes.
 */

export const SCREEN_MAGIC = 0x12031990
export const BITMAP_MAGIC = 0x06071963

export interface PacScreen {
  width: number
  height: number
  /** BPLCON0-style mode bits: $8000 hires, $4 lace */
  mode: number
  nColors: number
  nPlanes: number
  /** RGB4, 32 entries */
  palette: number[]
  /** display offsets, kept for completeness */
  awX: number
  awY: number
}

export interface PacPicture {
  screen: PacScreen | null
  /** default destination, pixels (x is stored in bytes and byte-aligned) */
  x: number
  y: number
  width: number
  height: number
  nPlanes: number
  /** chunky pixels, width*height */
  pixels: Uint8Array
}

export function parsePacPic(bytes: Uint8Array): PacPicture {
  const r = new BinReader(bytes)
  let screen: PacScreen | null = null
  let off = 0
  if (bytes.length >= 4 && r.u32() === SCREEN_MAGIC) {
    const width = r.u16()
    const height = r.u16()
    const awX = r.u16()
    const awY = r.u16()
    r.skip(4) // AWTx, AWTy
    r.skip(4) // AVx, AVy
    const mode = r.u16()
    const nColors = r.u16()
    const nPlanes = r.u16()
    const palette: number[] = []
    for (let i = 0; i < 32; i++) palette.push(r.u16() & 0xfff)
    screen = { width, height, mode, nColors, nPlanes, palette, awX, awY }
    off = 90 // PsLong
  }
  r.seek(off)
  if (r.u32() !== BITMAP_MAGIC) throw new Error('not a Pac.Pic bank')
  const dx = r.u16() // in bytes
  const dy = r.u16()
  const tx = r.u16() // width in bytes
  const ty = r.u16() // height in lumps
  const lumpHeight = r.u16()
  const nPlanes = r.u16()
  const rleOff = off + r.u32()
  const pointsOff = off + r.u32()
  const dataOff = off + 24 // PkDatas1

  const width = tx * 8
  const height = ty * lumpHeight
  const planes: Uint8Array[] = []
  for (let p = 0; p < nPlanes; p++) planes.push(new Uint8Array(tx * height))

  // stream state (persists across planes)
  let a4 = dataOff // data bytes
  let a5 = rleOff // rle bytes
  let a6 = pointsOff // points bits
  let rleBit = 7 // d0
  let pointsBit = 7 // d1
  let rleByte = bytes[a5++] ?? 0 // d2
  let dataByte = bytes[a4++] ?? 0 // d3
  if ((bytes[a6] ?? 0) & 0x80) rleByte = bytes[a5++] ?? 0
  pointsBit-- // = 6

  const consumeRleBit = (): boolean => {
    const set = ((rleByte >> rleBit) & 1) === 1
    if (--rleBit < 0) {
      rleBit = 7
      if (((bytes[a6] ?? 0) >> pointsBit) & 1) rleByte = bytes[a5++] ?? 0
      if (--pointsBit < 0) {
        pointsBit = 7
        a6++
      }
    }
    return set
  }

  for (let p = 0; p < nPlanes; p++) {
    const plane = planes[p]!
    for (let lump = 0; lump < ty; lump++) {
      const rowBase = lump * lumpHeight * tx
      for (let col = 0; col < tx; col++) {
        let addr = rowBase + col
        for (let k = 0; k < lumpHeight; k++) {
          if (consumeRleBit()) dataByte = bytes[a4++] ?? 0
          plane[addr] = dataByte
          addr += tx
        }
      }
    }
  }

  // planar → chunky
  const pixels = new Uint8Array(width * height)
  for (let p = 0; p < nPlanes; p++) {
    const plane = planes[p]!
    const bit = 1 << p
    for (let y = 0; y < height; y++) {
      const rowOff = y * tx
      const outOff = y * width
      for (let bx = 0; bx < tx; bx++) {
        const v = plane[rowOff + bx]!
        if (v === 0) continue
        for (let b = 0; b < 8; b++) {
          if ((v >> (7 - b)) & 1) {
            const i = outOff + bx * 8 + b
            pixels[i] = pixels[i]! | bit
          }
        }
      }
    }
  }

  return { screen, x: dx * 8, y: dy, width, height, nPlanes, pixels }
}

// ---------------------------------------------------------------------------
// Pack / Spack — the encoder, from +Compact.s (Pack 452, GetSize 317)
// ---------------------------------------------------------------------------

/** the square heights GetSize tries, TSize +Compact.s:446 */
const SQUARE_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 24, 32, 48, 64]

export interface PackSource {
  /** the screen's planar bitmap: plane p starts at p*planeSize */
  planar: Uint8Array
  planeSize: number
  /** EcTLigne — bytes per bitplane row */
  rowBytes: number
  nPlanes: number
}

/**
 * One packing pass with a chosen square height (`Pack`, +Compact.s:478).
 *
 * The bitmap is walked as `ty` bands of `tcar` lines, each band scanned a
 * byte-column at a time straight down, and every byte that differs from the
 * last one emitted is appended to the data stream with a flag bit set in an
 * intermediate table. That table is then run through the very same "same as
 * before?" compression, which is why the format has two data streams and one
 * stored bit table: the decoder rebuilds the first table as it goes.
 */
function packWith(
  src: PackSource,
  dx: number,
  dy: number,
  tx: number,
  ty: number,
  tcar: number,
): Uint8Array {
  const { planar, planeSize, rowBytes, nPlanes } = src
  // the intermediate flag table is allocated exactly as the 68k does — one
  // bit per byte examined, plus two bytes of slack that are compressed along
  // with the rest (MemFast +Compact.s:517)
  const interSize = ((tcar * tx * ty * nPlanes) >>> 3) + 2
  const t1 = new Uint8Array(interSize)

  // PkDatas1[0] is the cleared byte the 68k pre-increments past, and it is
  // also the decoder's initial "previous byte" — so it must stay 0
  const data1: number[] = [0]
  let prev = 0
  let bit = 7
  let tp = 0
  for (let p = 0; p < nPlanes; p++) {
    const base = p * planeSize + dy * rowBytes + dx
    for (let band = 0; band < ty; band++) {
      const bandStart = base + band * tcar * rowBytes
      for (let col = 0; col < tx; col++) {
        let addr = bandStart + col
        for (let k = 0; k < tcar; k++) {
          const b = planar[addr] ?? 0
          if (b !== prev) {
            prev = b
            data1.push(b)
            t1[tp] = t1[tp]! | (1 << bit)
          }
          if (--bit < 0) {
            bit = 7
            tp++
          }
          addr += rowBytes
        }
      }
    }
  }

  // second level: the flag table compressed by the same rule
  const t2 = new Uint8Array((interSize >>> 3) + 2)
  const data2: number[] = [0]
  let prev2 = 0
  bit = 7
  let t2p = 0
  for (let i = 0; i < interSize; i++) {
    const b = t1[i]!
    if (b !== prev2) {
      prev2 = b
      data2.push(b)
      t2[t2p] = t2[t2p]! | (1 << bit)
    }
    if (--bit < 0) {
      bit = 7
      t2p++
    }
  }

  const pointsOff = 24 + data1.length // PkPoint2
  const dataOff2 = pointsOff + t2.length // PkDatas2
  // "Final size (EVEN!)": the last written byte, +3, rounded down to even
  const size = (dataOff2 + data2.length - 1 + 3) & ~1
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setUint32(0, BITMAP_MAGIC)
  view.setUint16(4, dx)
  view.setUint16(6, dy)
  view.setUint16(8, tx)
  view.setUint16(10, ty)
  view.setUint16(12, tcar)
  view.setUint16(14, nPlanes)
  view.setUint32(16, dataOff2)
  view.setUint32(20, pointsOff)
  out.set(data1, 24)
  out.set(t2, pointsOff)
  out.set(data2, dataOff2)
  return out
}

/**
 * GetSize +Compact.s:343: try every square height that divides the region
 * exactly and keep the smallest result — ties go to the first tried, since
 * the original only replaces its best on a strict improvement (`bcc`).
 * dx/dy are in bytes and lines, tx in bytes, tyLines in lines.
 */
export function packBitmap(src: PackSource, dx: number, dy: number, tx: number, tyLines: number): Uint8Array {
  let best: Uint8Array | null = null
  for (const tcar of SQUARE_SIZES) {
    if (tyLines % tcar !== 0) continue
    const got = packWith(src, dx, dy, tx, tyLines / tcar, tcar)
    if (best === null || got.length < best.length) best = got
  }
  // TY below the smallest square never happens: 1 divides everything
  if (best === null) throw new Error('no usable square size')
  return best
}

export interface PackScreenHeader {
  width: number
  height: number
  nColors: number
  nPlanes: number
  /** EcCon0 — the BPLCON0-style mode word */
  mode: number
  awX: number
  awY: number
  awTX: number
  awTY: number
  avX: number
  avY: number
  palette: ArrayLike<number>
}

/** PsLong (+Equ.s:912): the screen definition Spack puts in front */
export const SCREEN_HEADER_SIZE = 90

/**
 * Spack (+Compact.s:165): the same packed bitmap with a screen definition in
 * front, so Unpack can recreate the screen it came from.
 */
export function packScreen(header: PackScreenHeader, bitmap: Uint8Array): Uint8Array {
  const out = new Uint8Array(SCREEN_HEADER_SIZE + bitmap.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, SCREEN_MAGIC)
  view.setUint16(4, header.width)
  view.setUint16(6, header.height)
  view.setUint16(8, header.awX)
  view.setUint16(10, header.awY)
  view.setUint16(12, header.awTX)
  view.setUint16(14, header.awTY)
  view.setUint16(16, header.avX)
  view.setUint16(18, header.avY)
  view.setUint16(20, header.mode)
  view.setUint16(22, header.nColors)
  view.setUint16(24, header.nPlanes)
  for (let i = 0; i < 32; i++) view.setUint16(26 + i * 2, header.palette[i] ?? 0)
  out.set(bitmap, SCREEN_HEADER_SIZE)
  return out
}
