/**
 * OctaMix's generated tables and its two tempo modes.
 *
 * There is no module to play, so nothing here can be checked by listening. What
 * CAN be checked is arithmetic that has to hold whatever the library meant: an
 * octave is a factor of two, the note table lands on the Amiga periods everyone
 * knows, and a tempo of 33 comes out at the 50 Hz MED has always run at. Where
 * a number is only an instruction, the test says which instruction.
 */
import { describe, expect, it } from 'vitest'
import { MMD_FLAG2_BMASK, MMD_FLAG2_BPM } from './mmd2'
import {
  OMIX_CLOCK,
  OMIX_DEFAULT_BUFFER,
  OMIX_DEFAULT_RATE,
  OMIX_FINETUNES,
  OMIX_MAX_BUFFER,
  OMIX_MAX_CHANNELS,
  OMIX_MAX_RATE,
  OMIX_MIN_BUFFER,
  OMIX_MIN_NOTE_VALUE,
  OMIX_MIN_RATE,
  OMIX_NOTES,
  OMIX_SEMITONE,
  OMIX_TABLE_BASE,
  OMIX_TABLE_BYTES,
  OMIX_TABLE_STEP,
  OMIX_TEMPO_DIVISOR,
  OMIX_TEMPO_NUMERATOR,
  omixBend,
  omixNoteTable,
  omixNoteTables,
  omixPaulaPeriod,
  omixSamplesPerTick,
  omixSamplesPerTickFixed,
  omixTickHz,
} from './omix'

describe('the constants the library is built on', () => {
  it('uses the NTSC colour clock and nothing else', () => {
    expect(OMIX_CLOCK).toBe(0x369e99)
    expect(OMIX_CLOCK).toBe(3579545)
  })

  /**
   * The whole reason the tables are generated rather than shipped. 69,433 over
   * 65,536 is 2 ** (1/12) to seven figures, which is what makes the recurrence
   * a semitone.
   */
  it('steps by a semitone in 16.16', () => {
    expect(OMIX_SEMITONE).toBe(69433)
    expect(OMIX_SEMITONE / 0x10000).toBeCloseTo(2 ** (1 / 12), 6)
  })

  /** $900 of tables, $90 each, is sixteen finetunes of 72 words */
  it('fits sixteen tables of 72 words into the $900 it allocates', () => {
    expect(OMIX_FINETUNES * OMIX_TABLE_BYTES).toBe(0x900)
    expect(OMIX_NOTES * 2).toBe(OMIX_TABLE_BYTES)
  })

  it('takes the ranges the extension checks and the defaults hunk 2 ships', () => {
    expect(OMIX_MIN_RATE).toBe(1000)
    expect(OMIX_MAX_RATE).toBe(0xffff)
    expect(OMIX_MIN_BUFFER).toBe(4)
    expect(OMIX_MAX_BUFFER).toBe(0x7ffc)
    expect(OMIX_DEFAULT_RATE).toBe(15000)
    expect(OMIX_DEFAULT_BUFFER).toBe(1024)
    expect(OMIX_MAX_CHANNELS).toBe(64)
  })
})

describe('the note table $211d18 generates', () => {
  const t = omixNoteTable(0)

  it('is 72 entries and ascends throughout', () => {
    expect(t).toHaveLength(OMIX_NOTES)
    for (let n = 1; n < OMIX_NOTES; n++) expect(t[n]!).toBeGreaterThan(t[n - 1]!)
  })

  /** $211d2e stores before it steps, so entry 0 is the base's high word */
  it('opens on the base rather than on the base times the ratio', () => {
    expect(t[0]).toBe(Math.floor(OMIX_TABLE_BASE / 0x10000))
    expect(t[0]).toBe(1046)
  })

  /**
   * The check that says the recurrence is right rather than merely plausible.
   * Every twelfth entry doubles, and it converges: the early octaves carry the
   * truncation of fewer multiplies.
   */
  it('doubles every twelve entries', () => {
    for (const n of [12, 24, 36, 48, 60]) expect(t[n]! / t[n - 12]!).toBeCloseTo(2, 2)
    // by the third octave the drift has washed out entirely
    expect(t[36]! / t[24]!).toBe(2)
    expect(t[48]! / t[36]!).toBe(2)
  })

  /**
   * And the check that says it is MUSIC. Read as periods against the clock the
   * library itself divides by, the table lands on ProTracker's octaves.
   */
  it('reads as the Amiga periods when the clock is divided by it', () => {
    const period = (n: number): number => OMIX_CLOCK / t[n]!
    // within a unit, which is 36 truncating multiplies of accumulated drift
    expect(period(12)).toBeCloseTo(1712, -0.2)
    expect(Math.abs(period(12) - 1712)).toBeLessThan(1)
    expect(Math.abs(period(24) - 856)).toBeLessThan(1)
    expect(Math.abs(period(36) - 428)).toBeLessThan(1)
    expect(Math.abs(period(48) - 214)).toBeLessThan(1)
  })

  /**
   * The finetune shifts the BASE and not the ratio, so it is linear where the
   * notes are logarithmic: 510,940 over 68,616,340 is 0.745% a step, about an
   * eighth of a semitone, and sixteen steps span a little under two of them.
   */
  it('shifts the base linearly with the finetune', () => {
    const tables = omixNoteTables()
    expect(tables).toHaveLength(OMIX_FINETUNES)
    // index 8 is finetune 0
    expect([...tables[8]!]).toEqual([...t])
    expect(tables[0]![0]).toBe(Math.floor((OMIX_TABLE_BASE - 8 * OMIX_TABLE_STEP) / 0x10000))
    expect(tables[15]![0]).toBe(Math.floor((OMIX_TABLE_BASE + 7 * OMIX_TABLE_STEP) / 0x10000))
    const step = OMIX_TABLE_STEP / OMIX_TABLE_BASE
    expect(step).toBeCloseTo(0.00744, 4)
    // an eighth of a semitone, near enough
    expect(Math.log2(1 + step) * 12).toBeCloseTo(0.128, 2)
  })

  it('rises with the finetune at every note the table can hold', () => {
    const tables = omixNoteTables()
    for (const n of [0, 24, 48, 60]) {
      for (let f = 1; f < OMIX_FINETUNES; f++) {
        expect(tables[f]![n]!).toBeGreaterThan(tables[f - 1]![n]!)
      }
    }
  })

  /**
   * $211d2e is a `move.w`. At finetune +6 and +7 the recurrence has outgrown a
   * word by note 71, so those two entries wrap instead of saturating and the
   * top note plays about seven octaves low. Two entries out of 1,152, and no
   * others: this is the exact edge, not a rounding tolerance.
   */
  it('wraps at note 71, and only at the two highest finetunes', () => {
    const tables = omixNoteTables()
    const wrapped: number[] = []
    for (let f = 0; f < OMIX_FINETUNES; f++) {
      for (let n = 1; n < OMIX_NOTES; n++) {
        if (tables[f]![n]! < tables[f]![n - 1]!) {
          wrapped.push(f - 8)
          break
        }
      }
    }
    expect(wrapped).toEqual([6, 7])
    expect(tables[14]![71]).toBe(474)
    expect(tables[15]![71]).toBe(808)
    // and the note before each wrap is where the table was actually heading
    expect(tables[14]![70]).toBeGreaterThan(0xf000)
  })

  it('stays inside a word at the top for every finetune that does not wrap', () => {
    const tables = omixNoteTables()
    for (let f = 0; f < 14; f++) {
      expect(tables[f]![71]!).toBeGreaterThan(tables[f]![70]!)
      expect(tables[f]![71]!).toBeLessThan(0x10000)
    }
  })
})

describe('the bend, and the floor it lands on', () => {
  /**
   * $21218e and $21219a divide the same clock both ways, so the constant
   * cancels and a bend of nothing is very nearly the identity. Not exactly:
   * two truncating divides can lose a unit.
   */
  it('returns close to what it was given when the bend is zero', () => {
    // the error is one period's worth of truncation, so it grows with the
    // note: a unit low in the table, five in the middle, hundreds at the top
    for (const [v, bound] of [
      [1046, 1],
      [2090, 2],
      [8358, 6],
    ] as [number, number][]) {
      expect(Math.abs(omixBend(v, 0) - v)).toBeLessThanOrEqual(bound)
    }
  })

  /**
   * Both divides are `divu.w`. Low in the table the period is thousands and
   * losing its fraction costs nothing; at the top it is 56, and throwing away
   * 0.7 of that moves the value 1.3%. So the top of the range is quantised to
   * whole periods, which is what a period-driven replayer does anyway.
   *
   * It does not accumulate: `$26(a5)` keeps the table value and every tick
   * recomputes from it, so a held note lands on the same wrong value forever
   * rather than walking away from the note.
   */
  it('quantises the top of the range to whole periods, and does not drift', () => {
    const top = 63111
    const once = omixBend(top, 0)
    expect(once).toBe(63920)
    expect(Math.abs(once - top) / top).toBeCloseTo(0.013, 3)
    // idempotent, which is what makes it a quantisation rather than a drift
    expect(omixBend(once, 0)).toBe(once)
  })

  it('bends down for a positive period offset and up for a negative one', () => {
    const v = 8358
    expect(omixBend(v, 40)).toBeLessThan(v)
    expect(omixBend(v, -40)).toBeGreaterThan(v)
  })

  /** $2121a2 is `bhi`, so the floor is on the VALUE and a ceiling on the period */
  it('floors the value at $71, which is a ceiling on the period', () => {
    expect(OMIX_MIN_NOTE_VALUE).toBe(0x71)
    expect(omixBend(200, 30000)).toBe(OMIX_MIN_NOTE_VALUE)
    // and the floor is a floor: a value already at it stays
    expect(omixBend(OMIX_MIN_NOTE_VALUE, 0)).toBe(OMIX_MIN_NOTE_VALUE)
  })

  /**
   * $21218c jumps a zero value straight to the clamp rather than returning it,
   * so a channel with no note comes back as $71 and not as silence. Reproduced
   * because it is what the register holds.
   */
  it('turns a zero value into the floor rather than into zero', () => {
    expect(omixBend(0, 0)).toBe(OMIX_MIN_NOTE_VALUE)
    expect(omixBend(0, 500)).toBe(OMIX_MIN_NOTE_VALUE)
  })
})

describe('the two tempo modes', () => {
  /** $2115be: bit 5 of flags2 picks the arm */
  it('picks the arm on the BPM bit', () => {
    const plain = omixSamplesPerTick(15000, 33, 0)
    const bpm = omixSamplesPerTick(15000, 33, MMD_FLAG2_BPM | 3)
    expect(plain).not.toBe(bpm)
  })

  /**
   * $2115f2, and the number that says the port is right: MED's tempo 33 has
   * always been 50 Hz, and this comes out at 49.8 whatever the rate.
   */
  it('plays tempo 33 at very nearly 50 Hz, at any rate', () => {
    for (const rate of [8000, 15000, 28000, 44100]) {
      const per = omixSamplesPerTick(rate, 33, 0)
      expect(rate / per).toBeCloseTo(49.8, 0)
    }
  })

  it('keeps no fraction in the plain arm, because $211608 stores a zero', () => {
    const fixed = omixSamplesPerTickFixed(15000, 33, 0)
    expect(fixed % 0x10000).toBe(0)
    expect(fixed / 0x10000).toBe(omixSamplesPerTick(15000, 33, 0))
  })

  /**
   * `divu.w` cannot return a quotient past 65,535, and 470,000 / 7 is 67,142.
   * The library does not check; a real 68000 takes an exception there.
   */
  it('cannot express a tempo below eight, and says so with a zero', () => {
    expect(Math.floor(OMIX_TEMPO_NUMERATOR / 8)).toBeLessThan(0x10000)
    expect(Math.floor(OMIX_TEMPO_NUMERATOR / 7)).toBeGreaterThan(0xffff)
    expect(omixSamplesPerTick(15000, 8, 0)).toBeGreaterThan(0)
    expect(omixSamplesPerTick(15000, 7, 0)).toBe(0)
  })

  it('divides by 44,336, which is 709,376 over sixteen', () => {
    expect(OMIX_TEMPO_DIVISOR).toBe(44336)
    expect(OMIX_TEMPO_DIVISOR * 16).toBe(709376)
  })

  /**
   * $2115c6, and the dimensional check that says the ten and the beat mask are
   * in the right places: 120 BPM with four lines to the beat and six ticks to
   * the line has to be eight lines a second.
   */
  it('turns 120 BPM at four lines a beat into eight lines a second', () => {
    const flags2 = MMD_FLAG2_BPM | (4 - 1)
    expect((flags2 & MMD_FLAG2_BMASK) + 1).toBe(4)
    const rate = 15000
    const ticks = omixTickHz(rate, 120, flags2)
    // six ticks to the line, which is `tempo2`
    expect(ticks / 6).toBeCloseTo(8, 5)
    expect((ticks / 6 / 4) * 60).toBeCloseTo(120, 4)
  })

  it('keeps sixteen fractional bits in the BPM arm', () => {
    const fixed = omixSamplesPerTickFixed(15000, 120, MMD_FLAG2_BPM | 3)
    expect(fixed % 0x10000).not.toBe(0)
    expect(Math.floor(fixed / 0x10000)).toBe(omixSamplesPerTick(15000, 120, MMD_FLAG2_BPM | 3))
  })

  it('is zero for a tempo of zero rather than dividing by it', () => {
    expect(omixSamplesPerTick(15000, 0, 0)).toBe(0)
    expect(omixSamplesPerTick(15000, 0, MMD_FLAG2_BPM)).toBe(0)
  })
})

describe('the one place the NTSC constant is not cancelled', () => {
  /**
   * $213610 asks Paula for `3,579,545 / rate`. Paula clocks it against
   * 3,546,895 on a PAL machine, so the stream plays 0.92% slow. In the pitch
   * path the same constant divides both ways and cancels; here it does not.
   */
  it('asks Paula for an NTSC period, which is 0.92% out on PAL', () => {
    const PAL = 3546895
    // the clock on its own, which is the flat number mmd2mix.ts records
    expect(1 - PAL / OMIX_CLOCK).toBeCloseTo(0.00912, 5)
    // and what a listener would measure, which moves with the rate because
    // $213610's period is a whole number
    const err = (rate: number): number => 1 - PAL / omixPaulaPeriod(rate) / rate
    expect(err(8000)).toBeCloseTo(0.0081, 3)
    expect(err(15000)).toBeCloseTo(0.0065, 3)
    expect(err(28000)).toBeCloseTo(0.0026, 3)
    // Below 32,840 the period is coarse enough that the clock always wins and
    // the stream is always slow. Above it the rounding can outweigh the clock
    // and the stream runs FAST instead, worst at 65,083 and by 0.92%.
    for (let rate = OMIX_MIN_RATE; rate < 32840; rate += 7) expect(err(rate)).toBeGreaterThan(0)
    expect(err(32840)).toBeLessThan(0)
    expect(err(65083)).toBeCloseTo(-0.0092, 4)
  })

  it('is zero for a rate of zero rather than dividing by it', () => {
    expect(omixPaulaPeriod(0)).toBe(0)
  })
})
