import { describe, expect, it } from 'vitest'
import { BitMap } from './graphics'
import {
  COOKIE_CUT,
  USEA,
  USEB,
  USEC,
  bltBitMap,
  bltSize,
  logicFunction,
  logicWord,
  mintermBit,
  fillRow,
  mintermWord,
  shiftA,
  shiftB,
} from './blitter'

describe('the logic function', () => {
  /**
   * The reason this module exists. The bob compositor evaluated the truth
   * table one bit at a time honouring the channel enables; Personnal's Blit
   * Mask evaluated it sixteen bits in parallel without them. Nothing checked
   * that the two agreed, because they were in different directories.
   */
  it('the word form and the bit form are the same function', () => {
    for (let lf = 0; lf < 256; lf++) {
      for (const chan of [0, USEA, USEB, USEC, USEA | USEB, USEA | USEC, USEB | USEC, USEA | USEB | USEC]) {
        const con0 = chan | lf
        for (let i = 0; i < 8; i++) {
          const a = (i >> 2) & 1
          const b = (i >> 1) & 1
          const c = i & 1
          const word = logicWord(con0, a ? 0xffff : 0, b ? 0xffff : 0, c ? 0xffff : 0)
          expect(word & 1, `con0=$${con0.toString(16)} a=${a} b=${b} c=${c}`).toBe(mintermBit(con0, a, b, c))
          // and a word is uniform when its inputs are: all sixteen or none
          expect(word === 0 || word === 0xffff).toBe(true)
        }
      }
    }
  })

  it('$CA is the cookie cut, D = A ? B : C', () => {
    expect(mintermWord(0xca, 0xffff, 0xf0f0, 0x0ff0)).toBe(0xf0f0) // A set: B
    expect(mintermWord(0xca, 0x0000, 0xf0f0, 0x0ff0)).toBe(0x0ff0) // A clear: C
    expect(mintermWord(0xca, 0xff00, 0xffff, 0x0000)).toBe(0xff00) // per bit
  })

  it('$F0 is A to D and $00 writes zeros', () => {
    // the two Personnal uses: Blitter Copy is $09F0, Blitter Clear is $0100
    expect(mintermWord(0xf0, 0x1234, 0xffff, 0xffff)).toBe(0x1234)
    expect(mintermWord(0x00, 0xffff, 0xffff, 0xffff)).toBe(0)
  })

  it('$98 is (B AND C) OR (A AND NOT B AND NOT C), as Blit Mask claims', () => {
    // personnal.ts states this formula in prose for Blit Mask's minterm and
    // nothing checked the table produced it. $98 = bits 7, 4 and 3:
    // (A&B&C) | (A&~B&~C) | (~A&B&C), which collapses to the claim
    for (let i = 0; i < 8; i++) {
      const a = (i >> 2) & 1 ? 0xffff : 0
      const b = (i >> 1) & 1 ? 0xffff : 0
      const c = i & 1 ? 0xffff : 0
      expect(mintermWord(0x98, a, b, c)).toBe(((b & c) | (a & ~b & ~c)) & 0xffff)
    }
  })

  it('a disabled channel reads as all ones, which is what No Mask depends on', () => {
    // $07CA: channel A off. $CA collapses from "A ? B : C" to "D = B", so a
    // maskless image draws its colour 0 instead of letting the background out
    for (let b = 0; b < 2; b++) {
      for (let c = 0; c < 2; c++) {
        expect(mintermBit(0x07ca, 0, b, c)).toBe(b)
        expect(mintermBit(0x07ca, 1, b, c)).toBe(b)
      }
    }
    expect(logicWord(0x07ca, 0x0000, 0xf0f0, 0xffff)).toBe(0xf0f0)
  })

  it('decodes its own fields', () => {
    expect(logicFunction(COOKIE_CUT)).toBe(0xca)
    expect(shiftA(0xa0ca)).toBe(0xa)
    expect(shiftB(0x5002)).toBe(5)
  })
})

describe('BLTSIZE', () => {
  it('zero means maximum in both fields, not a no-op', () => {
    expect(bltSize(0)).toEqual({ rows: 1024, words: 64 })
    expect(bltSize(0x0040)).toEqual({ rows: 1, words: 64 }) // 1 row, words = 0 → 64
    expect(bltSize(0x0041)).toEqual({ rows: 1, words: 1 })
    expect(bltSize((200 << 6) + 20)).toEqual({ rows: 200, words: 20 })
  })

  it('the row count is ten bits and the word count six', () => {
    expect(bltSize(0xffff)).toEqual({ rows: 1023, words: 63 })
  })
})

describe('BltBitMapRastPort', () => {
  const filled = (w: number, h: number, fn: (x: number, y: number) => number): BitMap => {
    const bm = new BitMap(w, h, 8, ((w + 15) >> 4) << 1)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bm.writePixel(x, y, fn(x, y))
    return bm
  }

  it('copies a rectangle between bitmaps', () => {
    const src = filled(16, 16, (x, y) => (x + y * 16) & 0xff)
    const dst = filled(16, 16, () => 0)
    bltBitMap(src, 2, 3, dst, 8, 9, 4, 4)
    expect(dst.pixelAt(8, 9)).toBe(src.pixelAt(2, 3))
    expect(dst.pixelAt(11, 12)).toBe(src.pixelAt(5, 6))
    expect(dst.pixelAt(7, 9)).toBe(0) // nothing outside the rectangle
  })

  it('an overlapping copy on ONE bitmap does not smear', () => {
    // the case the staging buffer exists for: the chip solves it with the
    // descending bit, a forward loop would read pixels it had just written
    const bm = filled(16, 4, (x) => x + 1)
    bltBitMap(bm, 0, 0, bm, 2, 0, 8, 4)
    // the destination is the source shifted right by two, not a repeat of
    // the first two columns dragged across the row
    for (let x = 0; x < 8; x++) expect(bm.pixelAt(x + 2, 0), `x=${x}`).toBe(x + 1)
  })

  it('a transparent pen is left behind', () => {
    const src = filled(8, 8, (x) => (x < 4 ? 0 : 9))
    const dst = filled(8, 8, () => 7)
    bltBitMap(src, 0, 0, dst, 0, 0, 8, 8, 0)
    expect(dst.pixelAt(1, 1)).toBe(7) // colour 0 did not come over
    expect(dst.pixelAt(5, 1)).toBe(9)
  })

  it('reads outside the source as colour 0, and still writes it', () => {
    // NOTE: the region past the source edge comes over as zeros rather than
    // being skipped, so a blit that overruns its source paints black instead
    // of leaving the destination alone. On the machine those addresses read
    // whatever chip RAM held. This is the AGA port's observed behaviour and
    // its tests depend on it; a caller that wants the other rule clips first.
    const src = filled(8, 8, () => 3)
    const dst = filled(8, 8, () => 7)
    bltBitMap(src, 6, 6, dst, 0, 0, 8, 8)
    expect(dst.pixelAt(0, 0)).toBe(3) // src(6,6), inside
    expect(dst.pixelAt(2, 0)).toBe(0) // src(8,6), past the edge
  })

  it('clips at the destination rather than writing past it', () => {
    const src = filled(8, 8, () => 3)
    const dst = filled(8, 8, () => 0)
    bltBitMap(src, 0, 0, dst, 6, 6, 8, 8)
    expect(dst.pixelAt(7, 7)).toBe(3)
    expect(() => bltBitMap(src, 0, 0, dst, 100, 100, 8, 8)).not.toThrow()
  })

  it('a degenerate rectangle does nothing', () => {
    const src = filled(4, 4, () => 5)
    const dst = filled(4, 4, () => 1)
    bltBitMap(src, 0, 0, dst, 0, 0, 0, 4)
    bltBitMap(src, 0, 0, dst, 0, 0, 4, -1)
    expect(dst.pixelAt(0, 0)).toBe(1)
  })
})

describe('area fill', () => {
  const row = (bits: string): Uint8Array => {
    const out = new Uint8Array(Math.ceil(bits.length / 8))
    for (let i = 0; i < bits.length; i++) if (bits[i] === 'X') out[i >> 3]! |= 0x80 >> (i & 7)
    return out
  }
  const show = (r: Uint8Array, n: number): string => {
    let s = ''
    for (let i = 0; i < n; i++) s += r[i >> 3]! & (0x80 >> (i & 7)) ? 'X' : '.'
    return s
  }

  /**
   * The rule the AMCAF manual states, and the reason this function exists:
   * "It does only fill the gap between two dots of a horizontal line."
   */
  it('fills between a pair of bits and keeps both ends', () => {
    const r = row('.X....X.')
    fillRow(r)
    expect(show(r, 8)).toBe('.XXXXXX.')
  })

  it('adjacent bits leave nothing to fill', () => {
    const r = row('.XX.....')
    fillRow(r)
    expect(show(r, 8)).toBe('.XX.....')
  })

  it('two pairs fill independently', () => {
    const r = row('X..X.X.X')
    fillRow(r)
    expect(show(r, 8)).toBe('XXXX.XXX')
  })

  it('crosses a byte boundary', () => {
    const r = row('.....X....X.....')
    fillRow(r)
    expect(show(r, 16)).toBe('.....XXXXXX.....')
  })

  it('an empty row stays empty', () => {
    const r = row('........')
    fillRow(r)
    expect(show(r, 8)).toBe('........')
  })

  it('FCI starts the row already inside a shape', () => {
    // a polygon whose left edge lies outside the filled region
    const r = row('....X...')
    fillRow(r, true)
    expect(show(r, 8)).toBe('XXXXX...')
  })
})
