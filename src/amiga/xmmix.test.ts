/**
 * FastTracker 2's mixer, and the four tables it is built on.
 *
 * Three of the four are GENERATED here rather than shipped, so the checks that
 * matter are the ones that run the generator against the library's own bytes.
 * `DME_FastTracker.library` is in `fixtures/` and gitignored, so those are
 * gated and the arithmetic tests are not.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { describeWith } from '../testing/fixture'
import { loadHunks } from './hunk'
import {
  XM_CLOCK,
  XM_HEADROOM,
  XM_MIX_RATE,
  XM_PAL_CLOCK,
  XM_PAULA_PERIOD,
  XM_PERIODS,
  XM_PERIOD_BASE,
  XM_PERIOD_OVERRUN,
  XM_REQUESTED_RATE,
  xmAmigaPeriod,
  xmHeadroom,
  xmLevel,
  xmLevelTable,
  xmLinearPeriod,
  xmLinearTable,
  xmMix,
  xmPairs,
  xmSamplesPerTick,
  xmSides,
  xmStep,
  xmVoice,
  xmVolumeTable,
} from './xmmix'

function library(): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync('fixtures/libs/dme/DME_FastTracker.library'))
  } catch {
    return null
  }
}

describe('the rate the mixer actually runs at', () => {
  /**
   * $2101aa writes 28,000 into `$62(a5)` and $215390 rounds it through a Paula
   * period and back. Neither number is the one that was asked for.
   */
  it('asks for 28,000 and gets 28,149 at period 126', () => {
    expect(XM_REQUESTED_RATE).toBe(28000)
    expect(XM_PAL_CLOCK).toBe(3546895)
    expect(XM_PAULA_PERIOD).toBe(126)
    expect(XM_MIX_RATE).toBe(28149)
    expect(Math.floor(XM_PAL_CLOCK / XM_REQUESTED_RATE)).toBe(XM_PAULA_PERIOD)
  })

  /** `move.l #$369de4,$c6(a5)` at $211ade */
  it('uses FastTracker 2 own clock, quartered', () => {
    expect(XM_CLOCK).toBe(0x369de4)
    expect(XM_CLOCK * 4).toBe(8363 * 1712)
  })

  /** $210ac4: `(rate * 5) / (bpm * 2)`, rounded up to even */
  it('turns a BPM into an even number of samples a tick', () => {
    expect(xmSamplesPerTick(XM_MIX_RATE, 125)).toBe(562)
    expect(xmSamplesPerTick(XM_MIX_RATE, 114)).toBe(618)
    for (const bpm of [32, 60, 125, 200, 255]) expect(xmSamplesPerTick(XM_MIX_RATE, bpm) % 2).toBe(0)
  })

  /**
   * The whole pitch chain in one number. C-4 is note 49 with no relative note
   * and no finetune, its linear period is 4608, $211d94 turns that into the
   * Amiga period 1712, and $210ee4's step then plays it at FastTracker's own
   * middle C.
   */
  it('plays C-4 at 8363 Hz through both conversions', () => {
    const table = xmLinearTable()
    // $1e40 is 7744, which is XM's own 7680 plus one semitone. That extra 64
    // is how $212336 absorbs a note byte that arrives 1-based: C-4 is 49, and
    // 7744 - 49 * 64 is the 4608 the linear table is built around.
    expect(0x1e40).toBe(7744)
    const linear = 0x1e40 - 49 * 64
    expect(linear).toBe(4608)
    expect(xmLinearPeriod(linear, table)).toBe(1712)
    // $210ee4 truncates three times --- the clock over the period, the shift
    // left fourteen, and the divide by the rate over sixteen --- so this is
    // 8361 rather than 8363. Kept, because it is what the machine plays.
    const step = xmStep(1712, XM_MIX_RATE)
    expect(step).toBe(19467)
    expect(Math.round((step / 65536) * XM_MIX_RATE)).toBe(8361)
  })

  /**
   * The truncation costs most where the period is largest, because
   * `floor(clock / period)` throws away the same fraction of a smaller
   * quotient. Measured over the whole note range with no finetune.
   */
  it('drifts 0.02% at C-4 and 0.33% at the bottom of the range', () => {
    const exact = (p: number): number => (8363 * 1712) / p
    const got = (p: number): number => (xmStep(p, XM_MIX_RATE) / 65536) * XM_MIX_RATE
    const drift = (n: number): number => {
      const p = xmAmigaPeriod(n, 0)
      return Math.abs(got(p) - exact(p)) / exact(p)
    }
    expect(drift(49)).toBeLessThan(0.0003)
    let worst = 0
    for (let n = 13; n <= 96; n++) worst = Math.max(worst, drift(n))
    expect(worst).toBeLessThan(0.004)
    expect(worst).toBeGreaterThan(0.003)
  })

  /**
   * The two frequency tables are the same tuning, which is the check worth
   * having: a module with the linear flag and one without play the same notes,
   * and neither table knows about the other.
   */
  it('agrees between the linear and Amiga tables at every octave', () => {
    const table = xmLinearTable()
    for (const note of [37, 49, 61, 73]) {
      expect(xmLinearPeriod(0x1e40 - note * 64, table)).toBe(xmAmigaPeriod(note, 0))
    }
  })
})

describe('the Amiga period table', () => {
  /**
   * $212346 indexes from $212aa2 with `(note % 12) * 8 + finetune / 16`, and
   * that index is negative for any C note with a negative finetune. Eight more
   * words sit below the label for it.
   */
  it('runs from eight words below its label', () => {
    expect(XM_PERIOD_BASE).toBe(8)
    expect(XM_PERIODS).toHaveLength(104)
    expect(XM_PERIODS[XM_PERIOD_BASE]).toBe(907)
    expect(XM_PERIODS[0]).toBe(960)
    expect(XM_PERIODS[XM_PERIODS.length - 1]).toBe(457)
  })

  /**
   * The lookup is sixteen times the period and $212394 shifts by `octave - 1`,
   * so the sixteen comes out in the shift. C-4 is note 49 and lands on 1712,
   * which is `8363 * 1712 / 8363` --- the constant $211db8 divides by.
   */
  it('halves the period for each octave, with C-4 on 1712', () => {
    expect(xmAmigaPeriod(49, 0)).toBe(1712)
    expect(xmAmigaPeriod(37, 0)).toBe(3424)
    expect(xmAmigaPeriod(61, 0)).toBe(856)
    expect(xmAmigaPeriod(73, 0)).toBe(428)
  })

  /** $212398: `subq.w #$1,d0 / bmi` doubles rather than shifting for octave 0 */
  it('doubles for octave zero instead of shifting right by minus one', () => {
    expect(xmAmigaPeriod(1, 0)).toBe(27392)
    expect(xmAmigaPeriod(13, 0)).toBe(13696)
    expect(xmAmigaPeriod(1, 0)).toBe(xmAmigaPeriod(13, 0) * 2)
  })

  /**
   * A negative finetune reads BELOW the label, which is why the array carries
   * eight words the disassembly reads as instructions. A full -128 is eight
   * steps, which is one whole semitone down: 1712 becomes 1814.
   */
  it('finetunes down into the eight words below $212aa2', () => {
    expect(xmAmigaPeriod(49, -16)).toBe(1724)
    expect(xmAmigaPeriod(49, 16)).toBe(1700)
    expect(xmAmigaPeriod(49, -128)).toBe(1814)
    expect(1814 / 1712).toBeCloseTo(2 ** (1 / 12), 3)
  })

  /**
   * The one place it runs off the TOP. `(11 % 12) * 8 = 88`, plus a finetune
   * step of 7, plus one for the neighbour, is index 96 --- which is the first
   * word of the linear table at $212b62, and that word is 8. So a B note with
   * a finetune of 112 or more interpolates 457 against 8 and comes out an
   * octave and a half above where it was asked for.
   */
  it('interpolates the top note against the linear table when finetune is 112 or more', () => {
    expect(XM_PERIOD_OVERRUN).toBe(8)
    // 59 % 12 is 11, so this is the semitone that can reach index 96, and a
    // finetune of 111 is the last one whose step of 6 stays inside the table
    expect(xmAmigaPeriod(59, 111)).toBe(914)
    // 457 * 1 + 8 * 15 = 577, shifted right by octave - 1 = 3
    expect(xmAmigaPeriod(59, 127)).toBe(72)
  })
})

describe('the level and volume tables', () => {
  /** $21177e: `((signed b) * v) >> 6 + $80`, and an arithmetic shift */
  it('biases every sample by $80 and scales by the volume', () => {
    const t = xmVolumeTable()
    expect(t).toHaveLength(65 * 256)
    // silence at any volume
    for (const v of [0, 1, 32, 64]) expect(t[v * 256 + 0]).toBe(0x80)
    // full volume is the identity, biased
    expect(t[64 * 256 + 0x7f]).toBe(0x80 + 0x7f)
    expect(t[64 * 256 + 0x80]).toBe(0)
    // volume zero flattens everything to the bias
    for (const b of [0, 1, 0x7f, 0x80, 0xff]) expect(t[b]).toBe(0x80)
  })

  /** $211712's divisor, off the thirty words at $211b2e */
  it('gives four channels no attenuation and thirty-two a divisor of seven', () => {
    expect(xmHeadroom(4)).toBe(1)
    expect(xmHeadroom(8)).toBe(1)
    expect(xmHeadroom(12)).toBe(2)
    expect(xmHeadroom(14)).toBe(2)
    expect(xmHeadroom(16)).toBe(3)
    expect(xmHeadroom(32)).toBe(7)
  })

  /**
   * $211a82 is `move.w $c0(a5),d0 / subq.w #$4,d0` with no floor, so two and
   * three channels index the two words before the table. Both are enormous
   * once shifted right seven and the divisor clamps to one.
   */
  it('clamps to one for the two channel counts that read before the table', () => {
    expect(XM_HEADROOM[0]).toBe(0x7000)
    expect(XM_HEADROOM[1]).toBe(0x4e75)
    expect(xmHeadroom(2)).toBe(1)
    expect(xmHeadroom(3)).toBe(1)
  })

  it('builds one table per sounding count, each 256 entries longer', () => {
    const levels = xmLevelTable(14)
    expect(levels).toHaveLength(xmPairs(14))
    for (const [i, row] of levels.entries()) expect(row).toHaveLength(256 * (i + 1))
  })

  /**
   * Row r takes off `128 * (r + 1)` biases and divides. One voice at full
   * volume through a divisor of two therefore comes back halved.
   */
  it('takes off one bias per sounding voice and divides by the headroom', () => {
    const levels = xmLevelTable(14)
    expect(levels[0]![0x80]).toBe(0)
    expect(levels[0]![0x80 + 64]).toBe(32)
    expect(levels[0]![0x80 - 64]).toBe(-32)
    // two voices: the bias is 256 and the range is twice as wide
    expect(levels[1]![0x100]).toBe(0)
    expect(levels[1]![0x100 + 128]).toBe(64)
  })

  it('clamps rather than wrapping', () => {
    const levels = xmLevelTable(4)
    // four channels have a divisor of one, so two loud voices clip
    expect(levels[1]![0x100 + 200]).toBe(127)
    expect(levels[1]![0]).toBe(-128)
  })

  it('picks the row by the count that sounded', () => {
    const levels = xmLevelTable(14)
    const acc = Uint16Array.from([0x80, 0x100, 0x180])
    const out = new Int8Array(3)
    xmLevel(out, acc, 3, levels, 1)
    expect(out[0]).toBe(0)
    xmLevel(out, acc, 3, levels, 2)
    expect(out[1]).toBe(0)
    xmLevel(out, acc, 3, levels, 3)
    expect(out[2]).toBe(0)
  })
})

describe('the panning and the mix loop', () => {
  /** $211abe: 0 and 3 left, 1 and 2 right, repeating */
  it('pans LRRL by channel number', () => {
    expect([...xmSides(8)]).toEqual([1, 0xff, 0xff, 1, 1, 0xff, 0xff, 1])
  })

  it('fills a silent voice with the bias on the store pass and leaves it on the add', () => {
    const acc = new Uint16Array(4).fill(0x123)
    const v = xmVoice()
    expect(xmMix(acc, 4, v, xmVolumeTable(), 64, XM_MIX_RATE, true)).toBe(false)
    expect([...acc]).toEqual([0x80, 0x80, 0x80, 0x80])
    acc.fill(0x123)
    expect(xmMix(acc, 4, v, xmVolumeTable(), 64, XM_MIX_RATE, false)).toBe(false)
    expect([...acc]).toEqual([0x123, 0x123, 0x123, 0x123])
  })

  it('adds a second voice on top of the first', () => {
    const volumes = xmVolumeTable()
    const acc = new Uint16Array(4)
    const one = xmVoice()
    one.pcm = Int8Array.from([64, 64, 64, 64])
    one.length = 4
    one.volume = 64
    one.period = 0x7fff // slow enough not to run out
    one.ended = false
    xmMix(acc, 4, one, volumes, 64, XM_MIX_RATE, true)
    expect(acc[0]).toBe(0x80 + 64)
    const two = xmVoice()
    two.pcm = Int8Array.from([-64, -64, -64, -64])
    two.length = 4
    two.volume = 64
    two.period = 0x7fff
    two.ended = false
    xmMix(acc, 4, two, volumes, 64, XM_MIX_RATE, false)
    // the two biases now, and the samples cancelling
    expect(acc[0]).toBe(0x100)
  })

  /** $210fda: a one-shot dies and a looping voice wraps by the loop length */
  it('ends a one-shot and wraps a loop', () => {
    const volumes = xmVolumeTable()
    const dead = xmVoice()
    dead.pcm = new Int8Array(4).fill(32)
    dead.length = 4
    dead.volume = 64
    dead.period = 200
    dead.ended = false
    const acc = new Uint16Array(64)
    xmMix(acc, 64, dead, volumes, 64, XM_MIX_RATE, true)
    expect(dead.ended).toBe(true)

    const loop = xmVoice()
    loop.pcm = new Int8Array(8).fill(32)
    loop.length = 8
    loop.loopStart = 4
    loop.looping = true
    loop.volume = 64
    loop.period = 200
    loop.ended = false
    xmMix(acc, 64, loop, volumes, 64, XM_MIX_RATE, true)
    expect(loop.ended).toBe(false)
    expect(loop.position >>> 16).toBeGreaterThanOrEqual(4)
    expect(loop.position >>> 16).toBeLessThan(8)
  })
})

describeWith('DME_FastTracker.library itself', library(), (raw) => {
  const loaded = loadHunks(raw)
  const base = loaded.base
  const img = loaded.image
  const w = (a: number): number => (img[a - base]! << 8) | img[a - base + 1]!
  const l = (a: number): number =>
    (((img[a - base]! << 24) | (img[a - base + 1]! << 16) | (img[a - base + 2]! << 8) | img[a - base + 3]!) >>> 0)

  it('is the 27,620-byte image at $210000', () => {
    expect(loaded.image).toHaveLength(27620)
    expect(base).toBe(0x210000)
  })

  /** the 104 words from $212a92, read back one at a time */
  it('matches the Amiga period table byte for byte', () => {
    for (const [i, v] of XM_PERIODS.entries()) expect([i, w(0x212a92 + i * 2)]).toEqual([i, v])
  })

  /** and the word one past the top IS the linear table's first high word */
  it('overruns the period table into the linear table, whose high word is 8', () => {
    expect(w(0x212a92 + XM_PERIODS.length * 2)).toBe(XM_PERIOD_OVERRUN)
    expect(0x212aa2 + 96 * 2).toBe(0x212b62)
  })

  /**
   * The 768 longs at $212b62 are `8363 * 64 * 2 ** (-n / 768)`. Recovering the
   * generator rather than shipping the table is the rule this project keeps;
   * this is the check that the generator is the right one.
   */
  it('regenerates the whole linear frequency table', () => {
    const table = xmLinearTable()
    expect(table).toHaveLength(768)
    let exact = 0
    for (let n = 0; n < 768; n++) if (table[n] === l(0x212b62 + n * 4)) exact++
    expect(exact).toBe(768)
  })

  /** the thirty words at $211b2e, plus the two instructions before them */
  it('matches the headroom table, including the two words below it', () => {
    for (const [i, v] of XM_HEADROOM.entries()) expect([i, w(0x211b2a + i * 2)]).toEqual([i, v])
  })
})
