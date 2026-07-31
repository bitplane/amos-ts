import { describe, expect, it } from 'vitest'
import { decode, decodeRow, encode, fillSpan, getPixel, rowBytesFor, setPixel } from './planar'

/** a bitmap's worth of scratch, with its geometry */
function bitmap(width: number, height: number, depth: number): {
  planes: Uint8Array
  planeSize: number
  rowBytes: number
  depth: number
  width: number
  height: number
} {
  const rowBytes = rowBytesFor(width)
  const planeSize = rowBytes * height
  return { planes: new Uint8Array(depth * planeSize), planeSize, rowBytes, depth, width, height }
}

const px = (b: ReturnType<typeof bitmap>, x: number, y: number): number =>
  getPixel(b.planes, b.planeSize, b.rowBytes, b.depth, x, y)
const put = (b: ReturnType<typeof bitmap>, x: number, y: number, v: number, m = 0xff): void =>
  setPixel(b.planes, b.planeSize, b.rowBytes, b.depth, x, y, v, m)

describe('planar layout', () => {
  it('rows are whole words, so 17 pixels take 4 bytes', () => {
    // the hardware fetches words; a 17-wide bitmap wastes 15 bits per row
    expect(rowBytesFor(16)).toBe(2)
    expect(rowBytesFor(17)).toBe(4)
    expect(rowBytesFor(320)).toBe(40)
    expect(rowBytesFor(640)).toBe(80)
  })

  it('x=0 is the HIGH bit of byte 0, as the hardware packs it', () => {
    const b = bitmap(32, 1, 1)
    put(b, 0, 0, 1)
    expect(b.planes[0]).toBe(0x80)
    b.planes.fill(0)
    put(b, 7, 0, 1)
    expect(b.planes[0]).toBe(0x01)
    b.planes.fill(0)
    put(b, 8, 0, 1)
    expect(b.planes[1]).toBe(0x80)
  })

  it('each bit of the pen lands in its own plane', () => {
    const b = bitmap(16, 1, 5)
    put(b, 3, 0, 0b10101)
    const bit = 0x80 >> 3
    expect(b.planes[0]! & bit).toBeTruthy() // bit 0
    expect(b.planes[b.planeSize]! & bit).toBeFalsy() // bit 1
    expect(b.planes[2 * b.planeSize]! & bit).toBeTruthy() // bit 2
    expect(b.planes[3 * b.planeSize]! & bit).toBeFalsy() // bit 3
    expect(b.planes[4 * b.planeSize]! & bit).toBeTruthy() // bit 4
    expect(px(b, 3, 0)).toBe(0b10101)
  })

  it('writing clears the bits it does not set', () => {
    // the chunky version got this free; planar has to clear explicitly, and
    // forgetting to is the classic bitplane bug
    const b = bitmap(16, 1, 4)
    put(b, 5, 0, 0b1111)
    expect(px(b, 5, 0)).toBe(0b1111)
    put(b, 5, 0, 0b0101)
    expect(px(b, 5, 0)).toBe(0b0101)
    put(b, 5, 0, 0)
    expect(px(b, 5, 0)).toBe(0)
  })

  it('a write mask names PLANES, not index bits', () => {
    const b = bitmap(16, 1, 4)
    put(b, 2, 0, 0b1111)
    // only plane 0 writable: the rest keep their old bits
    put(b, 2, 0, 0b0000, 0b0001)
    expect(px(b, 2, 0)).toBe(0b1110)
    // planes 1 and 2 writable, writing 0b0101 over the 0b1110 above:
    //   plane 0 masked out -> keeps 0
    //   plane 1 writable   -> takes 0
    //   plane 2 writable   -> takes 1
    //   plane 3 masked out -> keeps 1
    put(b, 2, 0, 0b0101, 0b0110)
    expect(px(b, 2, 0)).toBe(0b1100)
  })

  it('neighbouring pixels are untouched', () => {
    const b = bitmap(64, 2, 5)
    for (let x = 0; x < 64; x++) put(b, x, 0, (x % 31) + 1)
    put(b, 30, 0, 7)
    expect(px(b, 29, 0)).toBe((29 % 31) + 1)
    expect(px(b, 30, 0)).toBe(7)
    expect(px(b, 31, 0)).toBe((31 % 31) + 1)
    expect(px(b, 30, 1)).toBe(0)
  })
})

describe('fillSpan', () => {
  it('fills inclusive, and only inside the span', () => {
    const b = bitmap(64, 1, 4)
    fillSpan(b.planes, b.planeSize, b.rowBytes, b.depth, 0, 5, 20, 0b1011)
    expect(px(b, 4, 0)).toBe(0)
    for (let x = 5; x <= 20; x++) expect(px(b, x, 0), `x=${x}`).toBe(0b1011)
    expect(px(b, 21, 0)).toBe(0)
  })

  it('handles a span inside one byte', () => {
    const b = bitmap(64, 1, 4)
    fillSpan(b.planes, b.planeSize, b.rowBytes, b.depth, 0, 2, 4, 0b0110)
    expect(px(b, 1, 0)).toBe(0)
    expect(px(b, 2, 0)).toBe(0b0110)
    expect(px(b, 4, 0)).toBe(0b0110)
    expect(px(b, 5, 0)).toBe(0)
  })

  it('clears as well as sets', () => {
    const b = bitmap(64, 1, 4)
    fillSpan(b.planes, b.planeSize, b.rowBytes, b.depth, 0, 0, 63, 0b1111)
    fillSpan(b.planes, b.planeSize, b.rowBytes, b.depth, 0, 10, 30, 0)
    expect(px(b, 9, 0)).toBe(0b1111)
    expect(px(b, 10, 0)).toBe(0)
    expect(px(b, 30, 0)).toBe(0)
    expect(px(b, 31, 0)).toBe(0b1111)
  })

  it('agrees with setPixel over every start/end pair in a word range', () => {
    // the edge masks are where a span fill goes wrong, so check them all
    for (let x1 = 0; x1 < 34; x1++) {
      for (let x2 = x1; x2 < 34; x2++) {
        const a = bitmap(48, 1, 3)
        const c = bitmap(48, 1, 3)
        fillSpan(a.planes, a.planeSize, a.rowBytes, a.depth, 0, x1, x2, 5)
        for (let x = x1; x <= x2; x++) put(c, x, 0, 5)
        expect(Buffer.from(a.planes).equals(Buffer.from(c.planes)), `${x1}..${x2}`).toBe(true)
      }
    }
  })
})

describe('decode / encode round-trip', () => {
  it('decodeRow matches getPixel across widths that are not word multiples', () => {
    for (const width of [1, 7, 8, 15, 16, 17, 31, 33, 320, 640]) {
      const b = bitmap(width, 1, 5)
      for (let x = 0; x < width; x++) put(b, x, 0, (x * 7) % 32)
      const out = new Uint8Array(width)
      decodeRow(b.planes, b.planeSize, b.rowBytes, b.depth, width, 0, out, 0)
      for (let x = 0; x < width; x++) expect(out[x], `w=${width} x=${x}`).toBe(px(b, x, 0))
    }
  })

  it('round-trips a full bitmap at every depth', () => {
    for (let depth = 1; depth <= 8; depth++) {
      const width = 67
      const height = 5
      const b = bitmap(width, height, depth)
      const src = new Uint8Array(width * height)
      for (let i = 0; i < src.length; i++) src[i] = (i * 13) % (1 << depth)
      encode(src, b.planes, b.planeSize, b.rowBytes, depth, width, height)
      const out = new Uint8Array(width * height)
      decode(b.planes, b.planeSize, b.rowBytes, depth, width, height, out)
      expect(Buffer.from(out).equals(Buffer.from(src)), `depth=${depth}`).toBe(true)
    }
  })

  it('encode clears what was there before', () => {
    const b = bitmap(32, 2, 4)
    b.planes.fill(0xff)
    const src = new Uint8Array(32 * 2) // all zero
    encode(src, b.planes, b.planeSize, b.rowBytes, 4, 32, 2)
    expect(b.planes.every((v) => v === 0)).toBe(true)
  })

  it('padding bits past the width do not leak into decoded pixels', () => {
    // a 17-wide row has 15 unused bits; junk there must not appear as pixels
    const b = bitmap(17, 1, 4)
    b.planes.fill(0xff)
    const out = new Uint8Array(17)
    decodeRow(b.planes, b.planeSize, b.rowBytes, b.depth, 17, 0, out, 0)
    expect(out.length).toBe(17)
    for (let x = 0; x < 17; x++) expect(out[x]).toBe(0b1111)
  })
})
