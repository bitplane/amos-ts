/**
 * DigiBooster's mixer, checked against what the instructions say rather than
 * against a recording.
 *
 * The table is built into BSS at run time, so there is no blob in the library
 * to diff it against. What there is instead is nine instructions, and these
 * pin the properties that follow from them: the doubled volume, the truncating
 * divide, and the clip at half scale that gives the format its distortion.
 */
import { describe, expect, it } from 'vitest'
import {
  DIGI_MIX_CEIL,
  DIGI_MIX_FLOOR,
  DIGI_MIX_LEVELS,
  DIGI_MIX_ONE,
  DIGI_MIX_VOLUMES,
  digiStep,
  digiVolumeTable,
  mixPair,
} from './digimix'

const table = digiVolumeTable()
const at = (v: number, s: number): number => table[v * DIGI_MIX_LEVELS + (s & 0xff)]!

describe('the volume table at $23af00', () => {
  it('is 65 volumes of 256, which is `moveq #$40,d6` and `move.w #$ff,d7`', () => {
    expect(DIGI_MIX_VOLUMES).toBe(65)
    expect(table).toHaveLength(65 * 256)
  })

  it('silences everything at volume zero', () => {
    for (let s = 0; s < DIGI_MIX_LEVELS; s++) expect(at(0, s)).toBe(0)
  })

  it('CLIPS at full volume rather than scaling, which is the format distorting', () => {
    // `s * 2v / 128` is the identity at v = 64, and then the two `cmp.b`
    // clamps take everything outside [-64, 63] to the edge
    for (let s = -64; s <= 63; s++) expect(at(64, s)).toBe(s)
    expect(at(64, 64)).toBe(DIGI_MIX_CEIL)
    expect(at(64, 127)).toBe(DIGI_MIX_CEIL)
    expect(at(64, -65)).toBe(DIGI_MIX_FLOOR)
    expect(at(64, -128)).toBe(DIGI_MIX_FLOOR)
  })

  it('halves at volume 32 and truncates toward zero, as DIVS does', () => {
    expect(at(32, 100)).toBe(50)
    expect(at(32, -100)).toBe(-50)
    // 3 * 64 / 128 is 1.5, and DIVS goes toward zero on both signs
    expect(at(32, 3)).toBe(1)
    expect(at(32, -3)).toBe(-1)
  })

  it('never leaves the pair able to overflow a byte', () => {
    // the whole point of the clip: two sides added must fit in one signed byte
    for (let v = 0; v < DIGI_MIX_VOLUMES; v++) {
      for (let s = 0; s < DIGI_MIX_LEVELS; s++) {
        expect(at(v, s)).toBeLessThanOrEqual(DIGI_MIX_CEIL)
        expect(at(v, s)).toBeGreaterThanOrEqual(DIGI_MIX_FLOOR)
      }
    }
    expect(DIGI_MIX_CEIL * 2).toBeLessThanOrEqual(127)
    expect(DIGI_MIX_FLOOR * 2).toBeGreaterThanOrEqual(-128)
  })

  it('rises with the sample and with the volume, everywhere', () => {
    for (let v = 0; v < DIGI_MIX_VOLUMES; v++) {
      for (let s = -128; s < 127; s++) expect(at(v, s + 1)).toBeGreaterThanOrEqual(at(v, s))
    }
    // and a louder row is never quieter on a positive sample
    for (let v = 1; v < DIGI_MIX_VOLUMES; v++) expect(at(v, 50)).toBeGreaterThanOrEqual(at(v - 1, 50))
  })
})

describe('the step at $2124b4', () => {
  it('consumes n bytes of the second channel while the first consumes span', () => {
    expect(digiStep(332, 332)).toBe(DIGI_MIX_ONE)
    expect(digiStep(332, 166)).toBe(2 * DIGI_MIX_ONE)
    expect(digiStep(332, 664)).toBe(DIGI_MIX_ONE / 2)
  })

  it('holds the second channel still rather than dividing by zero', () => {
    expect(digiStep(332, 0)).toBe(0)
  })
})

/** a ramp, so a resampled read is obvious from the value that comes out */
const ramp = (n: number, from = 0): Int8Array => Int8Array.from({ length: n }, (_, i) => (from + i) & 0x3f)

describe('the mixing loop at $212562', () => {
  it('sums the pair when both run at the same rate', () => {
    const out = new Int8Array(8)
    const a = { pcm: ramp(8), pos: 0, end: 8, volume: 64 }
    const b = { pcm: ramp(8, 10), pos: 0, end: 8, volume: 64 }
    mixPair(out, a, b, digiStep(8, 8), table)
    expect([...out]).toEqual([10, 12, 14, 16, 18, 20, 22, 24])
    expect(a.pos).toBe(8)
    expect(b.pos).toBe(8)
  })

  it('advances the first channel one byte an output sample, always', () => {
    const out = new Int8Array(6)
    const a = { pcm: ramp(6), pos: 0, end: 6, volume: 64 }
    const b = { pcm: ramp(6), pos: 0, end: 6, volume: 0 }
    mixPair(out, a, b, digiStep(6, 1), table)
    expect([...out]).toEqual([0, 1, 2, 3, 4, 5])
    expect(a.pos).toBe(6)
  })

  it('HOLDS the second channel between advances, which is the resampling', () => {
    // B at half A's rate: each of its bytes lasts two output samples
    const out = new Int8Array(8)
    const a = { pcm: new Int8Array(8), pos: 0, end: 8, volume: 64 }
    const b = { pcm: ramp(8, 1), pos: 0, end: 8, volume: 64 }
    mixPair(out, a, b, digiStep(8, 4), table)
    expect([...out]).toEqual([1, 2, 2, 3, 3, 4, 4, 5])
  })

  it('takes ONE MORE byte of B than the step asks for, because both counters start at it', () => {
    // `move.l d6,d2 / move.l d6,d3` at $212558 seeds the accumulator with a
    // whole step, so the very first output sample already calls for a B byte.
    // It has to: `move.l a5,d0` leaves the held value as the low byte of a
    // page-aligned table pointer, which is zero, so there is nothing to hold
    // yet. A span of eight asking for four bytes reads five
    const out = new Int8Array(8)
    const a = { pcm: new Int8Array(8), pos: 0, end: 8, volume: 0 }
    const b = { pcm: ramp(8), pos: 0, end: 8, volume: 64 }
    mixPair(out, a, b, digiStep(8, 4), table)
    expect(b.pos).toBe(5)
    // at one to one it lands exactly, which is the case the pairing is for
    const same = { pcm: ramp(8), pos: 0, end: 8, volume: 64 }
    mixPair(out, a, same, digiStep(8, 8), table)
    expect(same.pos).toBe(8)
  })

  it('goes quiet at a channel end instead of reading past it', () => {
    // $2125f4's arm, where both sides finish inside the span
    const out = new Int8Array(8)
    const a = { pcm: ramp(4, 1), pos: 0, end: 4, volume: 64 }
    const b = { pcm: ramp(2, 20), pos: 0, end: 2, volume: 64 }
    mixPair(out, a, b, digiStep(8, 8), table)
    expect([...out]).toEqual([21, 23, 3, 4, 0, 0, 0, 0])
  })

  it('plays one side alone when the other is not sounding', () => {
    // $21258e and $2125ce, the arms for a pair with only one voice in it
    const out = new Int8Array(4)
    const a = { pcm: null, pos: 0, end: 0, volume: 64 }
    const b = { pcm: ramp(4, 5), pos: 0, end: 4, volume: 64 }
    mixPair(out, a, b, digiStep(4, 4), table)
    expect([...out]).toEqual([5, 6, 7, 8])
  })

  it('leaves both positions where the span finished, for the caller to wrap', () => {
    const out = new Int8Array(10)
    const a = { pcm: ramp(64), pos: 3, end: 64, volume: 32 }
    const b = { pcm: ramp(64), pos: 7, end: 64, volume: 32 }
    mixPair(out, a, b, digiStep(10, 5), table)
    expect(a.pos).toBe(13)
    expect(b.pos).toBe(13)
  })

  it('never leaves the buffer outside a signed byte, at any volume pair', () => {
    const out = new Int8Array(256)
    const pairs: [number, number][] = [[64, 64], [64, 40], [17, 63], [0, 64]]
    for (const [va, vb] of pairs) {
      const a = { pcm: Int8Array.from({ length: 256 }, (_, i) => (i << 24) >> 24), pos: 0, end: 256, volume: va }
      const b = { pcm: Int8Array.from({ length: 256 }, (_, i) => ((255 - i) << 24) >> 24), pos: 0, end: 256, volume: vb }
      mixPair(out, a, b, digiStep(256, 256), table)
      for (const v of out) {
        expect(v).toBeLessThanOrEqual(127)
        expect(v).toBeGreaterThanOrEqual(-128)
      }
    }
  })
})
