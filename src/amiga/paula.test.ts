import { describe, expect, it } from 'vitest'
import {
  MAX_VOLUME,
  MIN_PERIOD,
  NullAudio,
  PAULA_CLOCK,
  PAULA_CLOCK_NTSC,
  PAULA_CLOCK_PAL,
  clampVolume,
  periodToHz,
  samPeriod,
  volumeGain,
} from './paula'

describe('the audio clock', () => {
  it('defaults to PAL, which is what AMOS assumes', () => {
    // MusClock (+Music.s:851) holds this value; Set Ntsc is the keyword that
    // would change a real machine's pitch
    expect(PAULA_CLOCK).toBe(PAULA_CLOCK_PAL)
    expect(PAULA_CLOCK_PAL).toBe(3546895)
    expect(PAULA_CLOCK_NTSC).toBe(3579545)
  })

  it('the same period is a different rate on an NTSC machine', () => {
    expect(periodToHz(428, PAULA_CLOCK_NTSC)).toBeGreaterThan(periodToHz(428, PAULA_CLOCK_PAL))
  })
})

describe('period', () => {
  it('clamps at the DMA limit — nothing plays faster than ~28.6kHz', () => {
    expect(samPeriod(1_000_000)).toBe(MIN_PERIOD)
    expect(MIN_PERIOD).toBe(124)
    expect(periodToHz(MIN_PERIOD)).toBeCloseTo(28604, 0)
  })

  it('is the clock divided by the rate, floored', () => {
    expect(samPeriod(8363)).toBe(Math.floor(PAULA_CLOCK / 8363))
    expect(samPeriod(11025)).toBe(Math.floor(PAULA_CLOCK / 11025))
  })

  it('round-trips within one period step', () => {
    for (const hz of [4000, 8363, 11025, 16726, 22050]) {
      const p = samPeriod(hz)
      // flooring the period rounds the rate UP, never down
      expect(periodToHz(p)).toBeGreaterThanOrEqual(hz)
      expect(periodToHz(p + 1)).toBeLessThan(hz)
    }
  })

  it('survives a zero or negative rate rather than dividing by zero', () => {
    expect(Number.isFinite(samPeriod(0))).toBe(true)
    expect(Number.isFinite(periodToHz(0))).toBe(true)
  })
})

describe('volume', () => {
  /**
   * The reason this module exists in the shape it does. AUDxVOL is six bits
   * and saturates at 64; AMOS's own keywords error outside 0..63, so AMOS
   * never reaches full scale on the machine either. MED does, and did, and
   * the WebAudio sink was dividing by 63 for both.
   */
  it('saturates at 64, which is unity — not 63', () => {
    expect(MAX_VOLUME).toBe(64)
    expect(clampVolume(64)).toBe(64)
    expect(clampVolume(65)).toBe(64)
    expect(clampVolume(9999)).toBe(64)
    expect(clampVolume(-1)).toBe(0)
  })

  it("AMOS's loudest is one step below the chip's", () => {
    expect(volumeGain(64)).toBe(1)
    expect(volumeGain(63)).toBeCloseTo(63 / 64, 10)
    expect(volumeGain(63)).toBeLessThan(1)
    expect(volumeGain(0)).toBe(0)
  })

  it('a value past the top does not exceed unity gain', () => {
    // med.ts computes up to 64 and the old 63-divisor turned that into 1.016
    expect(volumeGain(64)).toBeLessThanOrEqual(1)
    expect(volumeGain(100)).toBe(1)
  })
})

describe('the headless voices', () => {
  const pcm = new Int8Array([0, 1, 2, 3, 4, 5, 6, 7])

  it('records what a voice was told and what it is doing', () => {
    const a = new NullAudio()
    a.play(2, pcm, 8000, 40, -1)
    expect(a.voiceState[2]).toMatchObject({ playing: true, freq: 8000, volume: 40, loopStart: -1, loopEnd: 8 })
    expect(a.events.at(-1)).toMatchObject({ kind: 'play', voice: 2, loop: false })
    a.stop(2)
    expect(a.voiceState[2]!.playing).toBe(false)
    expect(a.voiceState[2]!.pcm).toBe(null)
  })

  it('clamps the volume the chip way, on play and on setVolume', () => {
    const a = new NullAudio()
    a.play(0, pcm, 8000, 200, -1)
    expect(a.voiceState[0]!.volume).toBe(64)
    a.setVolume(0, -5)
    expect(a.voiceState[0]!.volume).toBe(0)
    expect(a.events.at(-1)).toMatchObject({ kind: 'volume', volume: 0 })
  })

  it('a loop change only lands on a voice that is playing', () => {
    const a = new NullAudio()
    a.setLoop(1, 2, 6)
    expect(a.voiceState[1]!.loopStart).toBe(-1) // silent voice: recorded, not applied
    a.play(1, pcm, 8000, 32, -1)
    a.setLoop(1, 2, 6)
    expect(a.voiceState[1]).toMatchObject({ loopStart: 2, loopEnd: 6 })
  })

  it('the LED filter is global, not per voice', () => {
    const a = new NullAudio()
    expect(a.filter).toBe(true)
    a.setFilter(false)
    expect(a.filter).toBe(false)
    expect(a.events.at(-1)).toMatchObject({ kind: 'filter', voice: -1, filter: false })
  })
})
