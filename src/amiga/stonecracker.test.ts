/**
 * StoneCracker `S404`.
 *
 * There is no crunched file in the corpus to decode — the magic turns up only
 * inside the libraries that know it — so most of what is here is the pair
 * against each other over inputs chosen to reach every code in the tree, plus
 * the header and trailer fields against the cruncher's own tail at $83a. A
 * wrong reading of one code would have to be wrong the same way twice to
 * survive a round trip of data that uses it, and the length ladder is walked
 * one value at a time so that each of its four arms is entered.
 *
 * The last describe is the one that does not depend on this port being right.
 * `ancient` decrunches what `stcCrunch` writes, and it never saw any of this.
 */
import { describe, expect, it } from 'vitest'
import { CHECKED, HAS_ANCIENT, ORACLE, ORACLE_REQUIRED, ancientIdentify, ancientVerify } from '../testing/oracle'
import { STC_OFFSET_BITS, STC_S403, STC_S404, isStoneCracked, stcCrunch, stcDecrunch, stcLength } from './stonecracker'

const be32 = (d: Uint8Array, at: number): number =>
  ((d[at]! << 24) | (d[at + 1]! << 16) | (d[at + 2]! << 8) | d[at + 3]!) >>> 0
const be16 = (d: Uint8Array, at: number): number => (d[at]! << 8) | d[at + 1]!

const bytes = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)))

/** A minimal S403 file, independently packed from that decoder's bit grammar. */
function s403(length: number, stream: number[]): Uint8Array {
  const words = Math.ceil(stream.length / 16)
  const countAt = 16 + words * 2
  const out = new Uint8Array(countAt + 2)
  const put32 = (at: number, value: number): void => {
    out[at] = value >>> 24
    out[at + 1] = value >>> 16
    out[at + 2] = value >>> 8
    out[at + 3] = value
  }
  put32(0, STC_S403)
  put32(8, length)
  put32(12, countAt - 16)
  for (let word = 0; word < words; word++) {
    let value = 0
    for (let bit = 0; bit < 16; bit++) value |= (stream[word * 16 + bit] ?? 0) << bit
    const at = countAt - 2 - word * 2
    out[at] = value >>> 8
    out[at + 1] = value
  }
  out[countAt + 1] = Math.min(16, stream.length)
  return out
}

const lsb = (value: number, count: number): number[] =>
  Array.from({ length: count }, (_, bit) => (value >>> bit) & 1)

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

  it('recognises both formats and reads their shared length field', () => {
    const file = stcCrunch(noise(100))
    expect(isStoneCracked(file)).toBe(true)
    expect(stcLength(file)).toBe(100)
    const old = s403(1, [0, ...lsb(0x41, 8)])
    expect(isStoneCracked(old)).toBe(true)
    expect(stcLength(old)).toBe(1)
    expect(stcDecrunch(old)).toEqual(Uint8Array.of(0x41))
    expect(isStoneCracked(bytes('not a crunched file at all'))).toBe(false)
  })

  /**
   * LVO -$24 tests both magics and returns d0 = 0 for anything else, having
   * done nothing; both of The Game's callers test that.
   */
  it('answers null for a magic it does not know', () => {
    expect(stcDecrunch(new Uint8Array(4))).toBeNull()
  })
})

describe('the older S403 decoder', () => {
  it('reads literals least-significant bit first', () => {
    expect(stcDecrunch(s403(3, [0, ...lsb(0x43, 8), 0, ...lsb(0x42, 8), 0, ...lsb(0x41, 8)])))
      .toEqual(Uint8Array.from([0x41, 0x42, 0x43]))
  })

  it('uses its two-byte match arm and nearest offset table', () => {
    // Decode tail "AB" as literals, then copy those two bytes backwards.
    const stream = [0, ...lsb(0x42, 8), 0, ...lsb(0x41, 8), 1, ...lsb(0, 2), ...lsb(1, 5), 1]
    expect(stcDecrunch(s403(4, stream))).toEqual(bytes('ABAB'))
  })

  it('covers every length arm, including repeated seven extensions', () => {
    const lengthBits = (length: number): number[] => {
      if (length === 2) return [1]
      if (length === 3) return [0, 1]
      if (length === 4) return [0, 0, 1]
      const out = [0, 0, 0]
      let left = length - 5
      while (left >= 7) {
        out.push(...lsb(7, 3))
        left -= 7
      }
      return [...out, ...lsb(left, 3)]
    }
    for (const length of [2, 3, 4, 5, 11, 12, 40]) {
      const stream = [0, ...lsb(0x41, 8), 1, ...lsb(0, 2), ...lsb(0, 5), ...lengthBits(length)]
      expect(stcDecrunch(s403(length + 1, stream)), `${length}-byte match`)
        .toEqual(new Uint8Array(length + 1).fill(0x41))
    }
  })

  it('covers all four offset tables from the binary', () => {
    const widths = [5, 8, 10, 12]
    const distances = [1, 33, 289, 1313]
    for (let cls = 0; cls < 4; cls++) {
      const distance = distances[cls]!
      const stream: number[] = []
      for (let i = 0; i < distance; i++) stream.push(0, ...lsb(0x41, 8))
      stream.push(1, ...lsb(cls, 2), ...lsb(0, widths[cls]!), 1)
      expect(stcDecrunch(s403(distance + 2, stream)), `offset class ${cls}`)
        .toEqual(new Uint8Array(distance + 2).fill(0x41))
    }
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

/**
 * `ancient` as an outside reader of `stcCrunch`.
 *
 * This file's header says what the gap was: no crunched file exists in the
 * corpus, so everything above is the pair here agreeing with itself. A sweep
 * of all 45,743 corpus files through `ancient identify` turns up 115
 * PowerPacker files and not one StoneCracker, which settles that as measured
 * rather than assumed.
 *
 * So the only outside evidence available is the other direction: hand our
 * crunched stream to somebody else's decruncher. `ancient` reads S404 from
 * its own understanding of the format and has never seen this port.
 */
describe('StoneCracker against ancient, an independent implementation', () => {
  const CASES: Array<[string, Uint8Array]> = [
    ['one byte', new Uint8Array([65])],
    ['a long run, all RLE', new Uint8Array(3000)],
    ['text', bytes('AMOS Professional '.repeat(600))],
    ['incompressible, which drives the literal run', noise(20_000, 7)],
    ['a ramp, all short matches', Uint8Array.from({ length: 5000 }, (_, i) => i & 0x3f)],
    ['every length the ladder spells', (() => {
      const parts: number[] = []
      for (let len = 2; len <= 300; len++) {
        const unit = noise(len, len * 31 + 1)
        parts.push(...unit, ...unit)
      }
      return Uint8Array.from(parts)
    })()],
  ]

  it('is installed wherever it is required', () => {
    if (!ORACLE_REQUIRED) return
    expect(HAS_ANCIENT, 'AMOS_ORACLE=1 but `ancient` is not on PATH').toBe(true)
  })

  it.skipIf(!HAS_ANCIENT)('records which build produced the evidence', () => {
    expect(CHECKED, `ancient ${ORACLE} has not been checked against this file`).toContain(ORACLE)
  })

  it.skipIf(!HAS_ANCIENT)('decodes every stream stcCrunch writes', () => {
    for (const [name, body] of CASES) {
      const packed = stcCrunch(body)
      expect(ancientIdentify(packed), name).toContain('S404')
      expect(ancientVerify(packed, body), name).toContain('Files match!')
    }
  })

  it.skipIf(!HAS_ANCIENT)('agrees on every offset window a caller actually asks for', () => {
    const body = bytes('short window '.repeat(400))
    for (const bits of [10, 11, 12, 13, 14]) {
      const packed = stcCrunch(body, bits)
      expect(ancientVerify(packed, body), `offsetBits ${bits}`).toContain('Files match!')
    }
  })

  /**
   * And disagrees outside 10..14, which nothing in this port reaches.
   *
   * `stcCrunch` writes the caller's number into the trailer and `stcDecrunch`
   * uses it as a field width without a range test, because the decruncher at
   * $958 does not make one either. `ancient` refuses anything below 10 or
   * above 14. Both callers here are The Game's `G Encrypt` and `G Stc Pack`
   * in ../runtime/thegame.ts, and both take the default 12, so the
   * disagreement is reachable only from a test.
   *
   * Unsettled on purpose. A range `ancient` enforces and the machine code
   * does not is a claim about what real StoneCracker WROTE, not about what
   * its decruncher would read, and no crunched file exists to settle it.
   */
  it.skipIf(!HAS_ANCIENT)('and refuses the widths outside it, which the decruncher does not', () => {
    const body = bytes('short window '.repeat(400))
    for (const bits of [8, 9, 15, 16]) {
      const packed = stcCrunch(body, bits)
      expect(stcDecrunch(packed), `offsetBits ${bits}`).toEqual(body)
      expect(ancientVerify(packed, body), `offsetBits ${bits}`).not.toContain('Files match!')
    }
  })

  /**
   * Three sources, three names for the same four bytes.
   *
   * `ancient` calls S404 "StoneCracker v4.10" and S403 "v4.02a". This file
   * calls them 4.04 and 4.03, after the magic. DecrunchLib names S401
   * "StoneCracker 4.01 D" (../amiga/decrunchlib.gen.ts). Nobody is wrong: the
   * magic is a format tag and the version is the program that wrote it, and
   * the two were never in step. Recorded so a reader who runs `ancient` on a
   * file this port wrote is not left wondering which of them is confused.
   */
  it.skipIf(!HAS_ANCIENT)('is called something else by ancient, which is worth knowing', () => {
    const id = ancientIdentify(stcCrunch(bytes('name check '.repeat(40))))
    expect(id).toContain('S404')
    expect(id).toContain('StoneCracker v4.10')
  })
})
