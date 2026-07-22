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
