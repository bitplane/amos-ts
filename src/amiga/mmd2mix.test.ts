/**
 * octaplayer's mixer, against the three constants that pin it: 227 << 14,
 * 124 << 14, and the ten-byte tempo row at $212346.
 *
 * Everything here is arithmetic the library states outright, so it is checked
 * exactly rather than approximately. The one place a tolerance appears is the
 * tick rate, because that is a division the library never performs.
 */
import { describe, expect, it } from 'vitest'
import { PAULA_CLOCK_PAL } from './paula'
import {
  OMED_BUFFER_BYTES,
  OMED_PERIOD_HQ,
  OMED_PERIOD_NORMAL,
  OMED_STEP_HQ,
  OMED_STEP_NORMAL,
  OMED_TEMPO_WORDS,
  OMED_TEMPO_WORDS_HQ,
  OMED_UNROLL,
  omedAdvance,
  omedBufferWords,
  omedMix,
  omedMixRate,
  omedStep,
  omedTickHz,
  swapWords,
  type OmedSide,
} from './mmd2mix'

describe('the two rates, and where their numerators come from', () => {
  it('is 227 << 14 and 124 << 14, which is why the step is periods over the period', () => {
    expect(OMED_STEP_NORMAL).toBe(OMED_PERIOD_NORMAL << 14)
    expect(OMED_STEP_HQ).toBe(OMED_PERIOD_HQ << 14)
  })

  it('plays at 15,625 Hz and 28,604 Hz off the PAL clock', () => {
    expect(omedMixRate(false)).toBeCloseTo(15625, 0)
    expect(omedMixRate(true)).toBeCloseTo(28604, 0)
    expect(omedMixRate(false)).toBe(PAULA_CLOCK_PAL / 0xe3)
  })

  it('steps exactly one byte per output at the rate it is playing at', () => {
    // $10000 swapped is 1 in the low word: whole bytes, no fraction
    expect(omedStep(OMED_PERIOD_NORMAL, false)).toBe(1)
    expect(omedStep(OMED_PERIOD_HQ, true)).toBe(1)
  })

  it('halves the step for twice the period', () => {
    // 0.5 lives in the high word once the value is swapped
    expect(omedStep(OMED_PERIOD_NORMAL * 2, false)).toBe(0x80000000)
    expect(omedStep(OMED_PERIOD_NORMAL / 2, false)).toBe(2)
  })

  it('lets divu.w overflow rather than trap, which pins the step at three', () => {
    // 3719168 / 56 is 66413, past a word, so d2 keeps the low word of D itself
    expect(omedStep(56, false)).toBe(3)
    // and $1f0000's low word is zero, so an HQ side that overflows stops dead
    expect(omedStep(30, true)).toBe(0)
  })
})

describe('the tempo table at $212346', () => {
  it('is ten bytes a row, and row 0 is multiples of ten', () => {
    expect(OMED_TEMPO_WORDS).toHaveLength(10)
    expect(OMED_TEMPO_WORDS_HQ).toHaveLength(10)
    // twice a row-0 entry is the buffer in bytes, and the loop writes 20 at a time
    expect([...OMED_TEMPO_WORDS].every((w) => (2 * w) % OMED_UNROLL === 0)).toBe(true)
  })

  it('sends 0 and everything from 10 up to the same slowest entry', () => {
    for (const t of [0, 10, 13, 33, 240, -1]) expect(omedBufferWords(t, false, false)).toBe(200)
    expect(omedBufferWords(9, false, false)).toBe(190)
  })

  it('doubles for HQ and for FLAG_SLOWHQ, and SLOWHQ wins', () => {
    expect(omedBufferWords(6, false, false)).toBe(160)
    expect(omedBufferWords(6, true, false)).toBe(292)
    expect(omedBufferWords(6, false, true)).toBe(320)
    expect(omedBufferWords(6, true, true)).toBe(320)
  })

  it('never asks for more than the $320 bytes a buffer holds', () => {
    for (let t = 0; t <= 20; t++)
      for (const hq of [false, true])
        for (const slow of [false, true])
          expect(2 * omedBufferWords(t, hq, slow)).toBeLessThanOrEqual(OMED_BUFFER_BYTES)
  })
})

describe('the tick, which is one buffer', () => {
  it('lands near 50 Hz at tempo 6 and stays there in HQ', () => {
    expect(omedTickHz(6, false, false)).toBeCloseTo(48.83, 1)
    expect(omedTickHz(6, true, false)).toBeCloseTo(48.98, 1)
  })

  it('cannot reach medplayer\'s fast tempos, because the buffer has a floor', () => {
    // medplayer's tempo 1 is 293 Hz off the CIA; 110 words at 15,625 Hz is 71
    expect(omedTickHz(1, false, false)).toBeCloseTo(71.02, 1)
  })

  it('runs tempo 13 and tempo 33 at exactly the same speed', () => {
    expect(omedTickHz(13, false, false)).toBe(omedTickHz(33, false, false))
    expect(omedTickHz(13, false, false)).toBeCloseTo(39.06, 1)
  })

  it('is what FLAG_SLOWHQ makes slow: the same rate over twice the buffer', () => {
    expect(omedTickHz(6, false, true)).toBeCloseTo(omedTickHz(6, false, false) / 2, 4)
  })
})

describe('the whole-buffer advance', () => {
  it('is the sample count when the step is one byte an output', () => {
    expect(omedAdvance(OMED_PERIOD_NORMAL, 320, false)).toBe(320)
    expect(omedAdvance(OMED_PERIOD_NORMAL * 2, 320, false)).toBe(160)
  })

  it('agrees with walking the step 320 times', () => {
    const period = 428
    let pos = 0
    for (let i = 0; i < 320; i++) {
      const sum = pos + omedStep(period, false)
      pos = ((sum & 0xffff0000) | (((sum & 0xffff) + (sum > 0xffffffff ? 1 : 0)) & 0xffff)) >>> 0
    }
    expect(omedAdvance(period, 320, false)).toBe(pos & 0xffff)
  })
})

describe('swap', () => {
  it('is what puts the fraction above the index', () => {
    expect(swapWords(0x00010000)).toBe(0x00000001)
    expect(swapWords(0x00008000)).toBe(0x80000000)
    expect(swapWords(0xdeadbeef)).toBe(0xbeefdead)
  })
})

const side = (o: Partial<OmedSide>): OmedSide => ({ at: 0, end: 0, loop: 0, period: 0, ...o })

describe('the mix itself', () => {
  /** a ramp, so a read at index n is recognisably n. Nothing starts at 0: a
   *  pointer of zero is what $2108f0 reads as no sample at all. */
  const ramp = (n: number): Int8Array => Int8Array.from({ length: n }, (_, i) => (i % 100) - 50)

  it('adds two signed bytes with no scaling and no clamp', () => {
    const pcm = Int8Array.of(0, 100, 100, 100, 100)
    const a = side({ at: 1, end: 5, period: OMED_PERIOD_NORMAL })
    const b = side({ at: 1, end: 5, period: OMED_PERIOD_NORMAL })
    const out = new Int8Array(2)
    omedMix(out, pcm, a, b, false)
    // 200 is not a byte, and the library never finds out
    expect([...out]).toEqual([-56, -56])
  })

  it('reads the silence byte for a side with no pointer or no period', () => {
    const pcm = Int8Array.of(0, 40, 40, 40, 40)
    const a = side({ at: 1, end: 5, period: OMED_PERIOD_NORMAL })
    const b = side({ at: 1, end: 5, period: 0 })
    const out = new Int8Array(3)
    omedMix(out, pcm, a, b, false)
    expect([...out]).toEqual([40, 40, 40])
    expect(a.at).toBe(4)
    expect(b.at).toBe(1)
  })

  it('advances each side by whole bytes and leaves the fraction behind', () => {
    const pcm = ramp(64)
    const a = side({ at: 1, end: 64, period: OMED_PERIOD_NORMAL * 2 })
    const b = side({ at: 1, end: 64, period: 0 })
    const out = new Int8Array(8)
    omedMix(out, pcm, a, b, false)
    // half a byte an output, so the first four bytes each land twice
    expect([...out]).toEqual([-49, -49, -48, -48, -47, -47, -46, -46])
    expect(a.at).toBe(5)
  })

  it('restarts a whole buffer early, because the end test is asked once', () => {
    const pcm = ramp(64)
    // 40 bytes left and 64 wanted, so the switch happens before a byte is read
    const a = side({ at: 24, end: 64, loop: 0, period: OMED_PERIOD_NORMAL })
    a.loop = 8
    const out = new Int8Array(64)
    omedMix(out, pcm, a, side({}), false)
    expect(out[0]).toBe(pcm[8])
    expect(a.at).toBe(8 + 64)
  })

  it('mutes a one-shot for good rather than restarting it', () => {
    const pcm = ramp(64)
    const a = side({ at: 40, end: 64, loop: 0, period: OMED_PERIOD_NORMAL })
    const out = new Int8Array(32)
    omedMix(out, pcm, a, side({}), false)
    expect(a.at).toBe(0)
    expect([...out].every((v) => v === 0)).toBe(true)
  })

  it('keeps playing when the advance stops one byte short of the end', () => {
    const pcm = ramp(64)
    const a = side({ at: 1, end: 32, loop: 1, period: OMED_PERIOD_NORMAL })
    const out = new Int8Array(30)
    omedMix(out, pcm, a, side({}), false)
    expect(a.at).toBe(31)
    expect(out[0]).toBe(pcm[1])
  })
})
