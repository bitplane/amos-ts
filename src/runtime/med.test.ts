import { describe, expect, it } from 'vitest'
import { PAULA_CLOCK_NTSC, PAULA_CLOCK_PAL } from '../amiga/paula'
import { medTickHz, medTimer } from './med'

/**
 * `MEDSetTempo` ($2111a4 of medplayer-1f2ca57f), which decides everything
 * about MED timing and which this port used to approximate as ticks per vbl.
 * docs/medplayer/README.md is the read.
 */
describe('the MED primary tempo', () => {
  it('takes tempos 1 to 10 from the table at $2111e0', () => {
    const timers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => medTimer(t, false, 4))
    expect(timers).toEqual([2417, 4833, 7250, 9666, 12083, 14500, 16916, 19332, 21436, 24163])
  })

  it('puts the ninth entry 314 counts below the line the other nine follow', () => {
    // The table is tempo * 14500/6, which makes each tempo that many times
    // the rate of tempo 1. Nine entries sit within four counts of that line.
    const line = (t: number): number => (t * 14500) / 6
    const off = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => Math.round(medTimer(t, false, 4) - line(t)) | 0)
    expect(off).toEqual([0, 0, 0, -1, 0, 0, -1, -1, -314, -4])
  })

  it('divides 470000 from tempo 11 up ($2111c8)', () => {
    expect(medTimer(11, false, 4)).toBe(42727)
    expect(medTimer(240, false, 4)).toBe(1958)
    // the whole range the F command can reach still fits the divu.w quotient
    for (let t = 11; t <= 240; t++) expect(medTimer(t, false, 4)).toBeLessThanOrEqual(0xffff)
  })

  it('divides 1773447 by tempo times lines-per-beat in BPM mode ($2111f4)', () => {
    expect(medTimer(125, true, 4)).toBe(3546)
    expect(medTimer(125, true, 8)).toBe(1773)
  })
})

describe('the MED tick rate', () => {
  const cia = PAULA_CLOCK_PAL / 5

  it('is the CIA clock over the timer, and tempo 6 is a shade under a PAL frame', () => {
    expect(medTickHz(6, false, 4)).toBeCloseTo(cia / 14500, 6)
    expect(medTickHz(6, false, 4)).toBeCloseTo(48.92, 2)
  })

  it('is not 50 Hz at tempo 33, which is what the old approximation assumed', () => {
    expect(medTickHz(33, false, 4)).toBeCloseTo(49.809, 3)
    expect(medTickHz(33, false, 4)).not.toBe(50)
  })

  it('divides by four in BPM mode ($2108a2), so 125 beats over 4 lines is a frame', () => {
    expect(medTickHz(125, true, 4)).toBeCloseTo(50.01, 2)
    expect(medTickHz(125, true, 4) * 4).toBeCloseTo(cia / 3546, 6)
    // lines-per-beat scales it, which the ticks-per-vbl approximation ignored
    expect(medTickHz(125, true, 8)).toBeCloseTo(2 * medTickHz(125, true, 4), 1)
  })

  it('stops rather than inventing a rate for a tempo the table cannot serve', () => {
    expect(medTickHz(0, false, 4)).toBe(0)
    expect(medTickHz(-1, false, 4)).toBe(0)
    expect(medTickHz(1_000_000, false, 4)).toBe(0)
  })
})

/**
 * The library never says what its constants are divided into, and the whole
 * tick rate rests on the answer. Its NTSC switch settles it: $2116ce replaces
 * both PAL constants when `ExecBase+$212` is not 50, and the replacements are
 * the PAL ones scaled by the Paula clock ratio. So the divisor is the Paula
 * clock over five, and the tick rate is the same on either machine.
 */
describe('the CIA clock the constants imply', () => {
  const scale = (n: number): number => Math.round((n * PAULA_CLOCK_NTSC) / PAULA_CLOCK_PAL)

  it('scales 470000 to the 474326 at $2116d6', () => {
    expect(scale(470000)).toBe(474326)
  })

  it('scales 1773447 to the 1789772 at $2116de', () => {
    expect(scale(1773447)).toBe(1789772)
  })
})
