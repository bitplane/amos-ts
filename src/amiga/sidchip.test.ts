/**
 * The SID's register decode and its envelopes.
 *
 * These check the chip against its own data sheet, which is the right
 * evidence here: the thing being ported is a chip, not a library, and
 * `playsid.library` is downstream of it rather than the authority on it. What
 * playsid DOES with the result is `playsid.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import {
  ATTACK_MS,
  CTRL_GATE,
  CTRL_NOISE,
  CTRL_PULSE,
  CTRL_SAWTOOTH,
  CTRL_TEST,
  CTRL_TRIANGLE,
  C64_CLOCK_PAL,
  SidChip,
  sidFreqHz,
} from './sidchip'

describe('the register decode', () => {
  it('splits each voice into seven registers, three voices apart', () => {
    const sid = new SidChip()
    sid.write(0x00, 0x34)
    sid.write(0x01, 0x12)
    sid.write(0x07, 0x78)
    sid.write(0x08, 0x56)
    sid.write(0x0e, 0xbc)
    sid.write(0x0f, 0x9a)
    expect(sid.voices.map((v) => v.freq)).toEqual([0x1234, 0x5678, 0x9abc])
  })

  it('keeps the pulse width to twelve bits', () => {
    const sid = new SidChip()
    sid.write(0x02, 0xff)
    sid.write(0x03, 0xff)
    expect(sid.voices[0]!.pulseWidth).toBe(0xfff)
  })

  it('splits ADSR into four nibbles the way the data sheet does', () => {
    const sid = new SidChip()
    sid.write(0x05, 0x2a)
    sid.write(0x06, 0xb7)
    const v = sid.voices[0]!
    expect([v.attack, v.decay, v.sustain, v.release]).toEqual([2, 0xa, 0xb, 7])
  })

  it('reads $D418 as a volume and a voice-3 cut-off', () => {
    const sid = new SidChip()
    sid.write(0x18, 0x8b)
    expect(sid.volume).toBe(0xb)
    expect(sid.voice3Off).toBe(true)
  })

  it('assembles the filter cutoff out of three bits and eight', () => {
    const sid = new SidChip()
    sid.write(0x15, 0x07)
    sid.write(0x16, 0xff)
    expect(sid.filterCutoff).toBe(0x7ff)
  })
})

describe('the gate is an edge, not a level', () => {
  it('starts the attack on a rising gate and the release on a falling one', () => {
    const sid = new SidChip()
    const v = sid.voices[0]!
    expect(v.phase).toBe('release')
    sid.write(0x04, CTRL_TRIANGLE | CTRL_GATE)
    expect(v.phase).toBe('attack')
    sid.write(0x04, CTRL_TRIANGLE)
    expect(v.phase).toBe('release')
  })

  it('writing the same control byte twice does not retrigger', () => {
    const sid = new SidChip()
    const v = sid.voices[0]!
    sid.write(0x05, 0x00) // attack 0, 2ms, so one tick is well past the peak
    sid.write(0x04, CTRL_TRIANGLE | CTRL_GATE)
    sid.tickEnvelopes(1)
    const after = v.env
    expect(v.phase).toBe('decay')
    sid.write(0x04, CTRL_TRIANGLE | CTRL_GATE)
    expect(v.phase).toBe('decay')
    expect(v.env).toBe(after)
  })

  it('the test bit zeroes the phase and reseeds the noise register', () => {
    const sid = new SidChip()
    const v = sid.voices[0]!
    v.phaseAcc = 0.4
    sid.clockNoise(v, 100)
    sid.write(0x04, CTRL_TEST)
    expect(v.phaseAcc).toBe(0)
    expect(v.lfsr).toBe(0x7ffff8)
  })
})

describe('the envelope', () => {
  it('reaches full scale in about the attack time the data sheet gives', () => {
    const sid = new SidChip()
    sid.write(0x05, 0x80) // attack 8, which is 100ms
    sid.write(0x04, CTRL_TRIANGLE | CTRL_GATE)
    expect(ATTACK_MS[8]).toBe(100)
    // 99ms is not yet there, 101ms is past it
    sid.tickEnvelopes(0.099)
    expect(sid.voices[0]!.phase).toBe('attack')
    sid.tickEnvelopes(0.002)
    expect(sid.voices[0]!.phase).toBe('decay')
    expect(sid.voices[0]!.env).toBe(255)
  })

  it('decays to the sustain level and stays there', () => {
    const sid = new SidChip()
    sid.write(0x05, 0x00) // fastest attack and decay
    sid.write(0x06, 0x80) // sustain 8 of 15
    sid.write(0x04, CTRL_TRIANGLE | CTRL_GATE)
    for (let i = 0; i < 10; i++) sid.tickEnvelopes(0.02)
    const v = sid.voices[0]!
    expect(v.phase).toBe('sustain')
    expect(v.env).toBeCloseTo((8 * 255) / 15, 5)
    sid.tickEnvelopes(1)
    expect(v.env).toBeCloseTo((8 * 255) / 15, 5)
  })

  it('releases to silence and stops there rather than going negative', () => {
    const sid = new SidChip()
    sid.write(0x05, 0x00)
    sid.write(0x04, CTRL_TRIANGLE | CTRL_GATE)
    sid.tickEnvelopes(0.02)
    sid.write(0x04, CTRL_TRIANGLE)
    sid.tickEnvelopes(10)
    expect(sid.voices[0]!.env).toBe(0)
  })

  it('is three times slower on decay and release than on attack', () => {
    // The data sheet's own relation, not an approximation of one.
    const rise = new SidChip()
    rise.write(0x05, 0x90) // attack 9 = 250ms
    rise.write(0x04, CTRL_TRIANGLE | CTRL_GATE)
    rise.tickEnvelopes(0.25)
    expect(rise.voices[0]!.env).toBe(255)

    const fall = new SidChip()
    fall.write(0x06, 0x09) // release 9, so 750ms from full
    fall.voices[0]!.env = 255
    fall.tickEnvelopes(0.74)
    expect(fall.voices[0]!.env).toBeGreaterThan(0)
    fall.tickEnvelopes(0.02)
    expect(fall.voices[0]!.env).toBe(0)
  })
})

describe('the oscillators', () => {
  it('turns a frequency register into Hz through the φ2 clock', () => {
    // f = freq * clock / 2^24, the data sheet's formula.
    expect(sidFreqHz(0x1000, C64_CLOCK_PAL)).toBeCloseTo((0x1000 * 985248) / 16777216, 6)
    // Middle-ish A: the register value a tune would use for 440Hz.
    const reg = Math.round((440 * 16777216) / 985248)
    expect(sidFreqHz(reg, C64_CLOCK_PAL)).toBeCloseTo(440, 0)
  })

  it('a sawtooth ramps and a triangle folds', () => {
    const sid = new SidChip()
    const v = sid.voices[0]!
    const prev = sid.voices[2]!
    v.control = CTRL_SAWTOOTH
    expect(sid.sampleWaveform(v, 0, prev)).toBeCloseTo(-1, 6)
    expect(sid.sampleWaveform(v, 0.5, prev)).toBeCloseTo(0, 6)
    expect(sid.sampleWaveform(v, 0.999, prev)).toBeGreaterThan(0.99)

    v.control = CTRL_TRIANGLE
    expect(sid.sampleWaveform(v, 0, prev)).toBeCloseTo(-1, 6)
    expect(sid.sampleWaveform(v, 0.25, prev)).toBeCloseTo(0, 6)
    expect(sid.sampleWaveform(v, 0.5, prev)).toBeCloseTo(1, 6)
    expect(sid.sampleWaveform(v, 0.75, prev)).toBeCloseTo(0, 6)
  })

  it('the pulse width moves the duty cycle', () => {
    const sid = new SidChip()
    const v = sid.voices[0]!
    const prev = sid.voices[2]!
    v.control = CTRL_PULSE
    v.pulseWidth = 2048 // half
    expect(sid.sampleWaveform(v, 0.25, prev)).toBe(1)
    expect(sid.sampleWaveform(v, 0.75, prev)).toBe(-1)
    v.pulseWidth = 410 // a tenth
    expect(sid.sampleWaveform(v, 0.05, prev)).toBe(1)
    expect(sid.sampleWaveform(v, 0.25, prev)).toBe(-1)
  })

  it('the test bit silences the oscillator whatever waveform is selected', () => {
    const sid = new SidChip()
    const v = sid.voices[0]!
    v.control = CTRL_SAWTOOTH | CTRL_TEST
    expect(sid.sampleWaveform(v, 0.9, sid.voices[2]!)).toBe(0)
  })

  it('noise moves when clocked and the LFSR never reaches zero', () => {
    const sid = new SidChip()
    const v = sid.voices[0]!
    v.control = CTRL_NOISE
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) {
      sid.clockNoise(v, 7)
      expect(v.lfsr).not.toBe(0)
      seen.add(sid.sampleWaveform(v, 0, sid.voices[2]!))
    }
    expect(seen.size).toBeGreaterThan(20)
  })

  it('$D41B and $D41C read voice 3 back, which is what tunes use for randomness', () => {
    // `$211308` and `$211318` are the library feeding these two; every other
    // register below $D419 reads as zero.
    const sid = new SidChip()
    sid.voices[2]!.env = 200
    expect(sid.read(0x1c)).toBe(200)
    sid.voices[2]!.control = CTRL_SAWTOOTH
    sid.voices[2]!.phaseAcc = 0.75
    expect(sid.read(0x1b)).toBeGreaterThan(0)
    expect(sid.read(0x00)).toBe(0)
  })
})
