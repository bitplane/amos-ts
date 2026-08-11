/**
 * StoneCracker `S404`.
 *
 * There is no crunched file in the corpus to check against — the magic turns
 * up only inside the libraries that know it — so what is checked here is the
 * pair against each other over inputs chosen to reach every code in the tree,
 * plus the header and trailer fields against the cruncher's own tail at $83a.
 * A wrong reading of one code would have to be wrong the same way twice to
 * survive a round trip of data that uses it, and the length ladder is walked
 * one value at a time so that each of its four arms is entered.
 */
import { describe, expect, it } from 'vitest'
import { STC_OFFSET_BITS, STC_S404, isStoneCracked, stcCrunch, stcDecrunch, stcLength } from './stonecracker'

const be32 = (d: Uint8Array, at: number): number =>
  ((d[at]! << 24) | (d[at + 1]! << 16) | (d[at + 2]! << 8) | d[at + 3]!) >>> 0
const be16 = (d: Uint8Array, at: number): number => (d[at]! << 8) | d[at + 1]!

const bytes = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)))

/** a deterministic pseudo-random buffer: nothing here may depend on a seed */
function noise(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n)
  let x = seed >>> 0
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0
    out[i] = (x >>> 16) & 0xff
  }
  return out
}

const roundTrip = (data: Uint8Array): Uint8Array | null => stcDecrunch(stcCrunch(data))

describe('the S404 container', () => {
  it('writes the magic, the length and the trailer offset', () => {
    const data = bytes('the quick brown fox jumps over the lazy dog')
    const file = stcCrunch(data)
    expect(be32(file, 0)).toBe(STC_S404)
    // +$04 is the crunch buffer's slack and the decruncher steps over it
    expect(be32(file, 4)).toBe(0)
    expect(be32(file, 8)).toBe(data.length)
    // `adda.l (a1),a1` with a1 at +$0c lands on the trailer's first word
    const trailer = 12 + be32(file, 12)
    expect(trailer + 6).toBeLessThanOrEqual(file.length)
    expect(be16(file, trailer)).toBe(STC_OFFSET_BITS)
    expect(be16(file, trailer + 4)).toBeLessThan(16)
  })

  /** the tail at $83a pads to a longword before it writes HUNK_END */
  it('reports a length that is a whole number of longwords', () => {
    for (let n = 0; n < 40; n++) expect(stcCrunch(noise(n)).length % 4).toBe(0)
  })

  it('recognises its own files and reads the length out of them', () => {
    const file = stcCrunch(noise(100))
    expect(isStoneCracked(file)).toBe(true)
    expect(stcLength(file)).toBe(100)
    expect(isStoneCracked(bytes('not a crunched file at all'))).toBe(false)
  })

  /**
   * LVO -$36 tests both magics and returns d0 = 0 for anything else, having
   * done nothing; both of The Game's callers test that. S403 lands here too,
   * which is this file's limitation and not the format's.
   */
  it('answers null for a magic it does not know', () => {
    expect(stcDecrunch(bytes('S403' + '\0'.repeat(20)))).toBeNull()
    expect(stcDecrunch(new Uint8Array(4))).toBeNull()
  })
})

describe('S404 round trips', () => {
  it('carries the empty buffer', () => {
    expect(stcDecrunch(stcCrunch(new Uint8Array(0)))).toEqual(new Uint8Array(0))
  })

  it('carries every length from 1 to 200 bytes of noise', () => {
    for (let n = 1; n <= 200; n++) {
      const data = noise(n, n)
      expect(Array.from(roundTrip(data) ?? []), `${n} bytes`).toEqual(Array.from(data))
    }
  })

  /**
   * A run of one byte is the RLE case: the match source is a byte the same
   * copy has just written, which only works because the copy walks down
   * byte by byte.
   */
  it('carries a long run of one byte', () => {
    const data = new Uint8Array(5000).fill(0x41)
    expect(roundTrip(data)).toEqual(data)
  })

  it('carries text with long repeats', () => {
    const line = 'AMOS Professional, the Game Extension, and a repeated tail. '
    const data = bytes(line.repeat(200))
    const file = stcCrunch(data)
    expect(stcDecrunch(file)).toEqual(data)
    // and it is a crunch, not an inflation
    expect(file.length).toBeLessThan(data.length / 2)
  })

  /** the far offset class, which needs a match beyond 543 bytes back */
  it('carries a repeat further back than the two near offset classes', () => {
    const head = bytes('a distinctive opening phrase that will be matched later. ')
    const data = new Uint8Array(head.length * 2 + 3000)
    data.set(head, 0)
    data.set(noise(3000, 7), head.length)
    data.set(head, head.length + 3000)
    expect(roundTrip(data)).toEqual(data)
  })

  it('carries a buffer larger than the offset window', () => {
    const data = noise(20000, 99)
    expect(roundTrip(data)).toEqual(data)
  })

  /**
   * The length ladder has four arms — 2..3, 4..7, 8..22 and 23 up — and a
   * repeat of exactly L bytes at a known distance is what enters each. Every
   * length from 2 to 300 is walked so no arm and no boundary is skipped.
   */
  it('carries a repeat of every length the ladder can spell', () => {
    for (let len = 2; len <= 300; len++) {
      const unit = noise(len, len * 31 + 1)
      const data = new Uint8Array(len * 2 + 4)
      data.set(unit, 0)
      data.set(unit, len)
      data.set(bytes('done'), len * 2)
      expect(Array.from(roundTrip(data) ?? []), `repeat of ${len}`).toEqual(Array.from(data))
    }
  })

  /** the literal run at $b7a covers 14..45 bytes and the encoder uses it */
  it('carries incompressible data through the literal run', () => {
    const data = noise(500, 4242)
    const file = stcCrunch(data)
    expect(stcDecrunch(file)).toEqual(data)
    // nine bits a byte is what single literals would cost; the run beats it
    expect(file.length).toBeLessThan(500 * 9 / 8 + 24)
  })

  it('takes a narrower offset window', () => {
    const data = bytes('short window '.repeat(60))
    const file = stcCrunch(data, 8)
    expect(be16(file, 12 + be32(file, 12))).toBe(8)
    expect(stcDecrunch(file)).toEqual(data)
  })
})
