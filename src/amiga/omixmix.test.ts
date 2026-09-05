/**
 * OctaMix's volume tables, its step, and its two inner loops.
 *
 * The same rule as `omix.test.ts`: no module, so every check is either against
 * the instruction that produces the number or against arithmetic that has to
 * hold. The one that carries the most weight here is the 8-bit table's shape
 * --- it has to be odd-symmetric about $80 and linear in the volume, and if the
 * signed read at $2133dc were wrong it would be neither.
 */
import { describe, expect, it } from 'vitest'
import { MMD_FLAG3_STEREO } from './mmd2'
import {
  OMIX_FLAG_BACKWARD,
  OMIX_FLAG_LOOP,
  OMIX_FLAG_OFF,
  OMIX_FLAG_PINGPONG,
  OMIX_VOLADJ_NEUTRAL,
  OMIX_VOLUMES,
  OMIX_VOLUME_SCALE,
  OMIX_ECHO_MS,
  OMIX_SPREAD_BASE,
  omixChannelVolume,
  omixEcho,
  omixEchoFrames,
  omixMix,
  omixSplit14,
  omixShift,
  omixStep,
  omixTrackScale,
  omixVoice,
  omixStereoSpread,
  omixVolumeRow,
  omixVolumeTable,
} from './omixmix'

describe('the 14-bit converter', () => {
  it('puts the high byte on the main channel and the next six bits on its volume-1 partner', () => {
    const { high, low } = omixSplit14(new Int16Array([0x1234, -0x1234, 0x7fff, -0x8000]))
    expect([...high]).toEqual([0x12, -0x13, 0x7f, -0x80])
    expect([...low]).toEqual([0x0d, 0x33, 0x3f, 0])
  })
})

describe('the step', () => {
  /** $211146 and $21114e: a quotient and then the remainder's fraction */
  it('is the note value over the rate, as 16.16', () => {
    const s = omixStep(15040, 15040)
    expect(s >>> 16).toBe(1)
    expect(s & 0xffff).toBe(0)
    const half = omixStep(7520, 15040)
    expect(half >>> 16).toBe(0)
    expect(half & 0xffff).toBe(0x8000)
  })

  it('is zero for a rate of zero rather than dividing by it', () => {
    expect(omixStep(8358, 0)).toBe(0)
  })

  /** a note an octave up steps twice as fast, which is the whole point */
  it('doubles when the note value doubles', () => {
    const a = omixStep(4179, 15040)
    const b = omixStep(8358, 15040)
    expect(Math.abs(b - 2 * a)).toBeLessThan(4)
  })
})

describe('the 8-bit volume table', () => {
  const t = omixVolumeTable(4, OMIX_VOLADJ_NEUTRAL)

  it('is 64 volumes of 256 words', () => {
    expect(t).toHaveLength(OMIX_VOLUMES * 256)
  })

  /**
   * $2133dc reads the byte into the HIGH half of a word and multiplies signed,
   * so $00..$7f are positive and $80..$ff negative. A table that got this wrong
   * would be monotonic across all 256 entries instead of sawtoothed, and would
   * play every sample with a DC offset.
   */
  it('reads the sample byte as signed, so it is odd about $80', () => {
    const row = omixVolumeRow(t, 63)
    expect(row[0]).toBe(0)
    expect(row[1]!).toBeGreaterThan(0)
    expect(row[0x7f]!).toBeGreaterThan(0)
    expect(row[0x80]!).toBeLessThan(0)
    expect(row[0xff]!).toBeLessThan(0)
    // $7f is the most positive and $80 the most negative
    expect(row[0x7f]).toBe(Math.max(...row))
    expect(row[0x80]).toBe(Math.min(...row))
  })

  /** the scale is `(volume + 1)`, so the rows are a straight line in volume */
  it('is linear in the volume', () => {
    const at = (v: number): number => omixVolumeRow(t, v)[0x7f]!
    expect(at(63) / at(31)).toBeCloseTo(64 / 32, 1)
    expect(at(31) / at(15)).toBeCloseTo(32 / 16, 1)
  })

  /**
   * `volume + 1` at $2133d6 means volume 0 is not silence. It is inaudible but
   * it is not zero, which is why a channel is silenced by bit 7 of `$38` and
   * never by its volume.
   */
  it('is quiet but not silent at volume zero', () => {
    const row = omixVolumeRow(t, 0)
    expect(row[0x7f]!).toBeGreaterThan(0)
    expect(row[0x7f]!).toBeLessThan(omixVolumeRow(t, 63)[0x7f]! / 32)
  })

  /** more channels divide further, because $2133c4 multiplies by the count */
  it('gets quieter as the channel count rises', () => {
    const four = omixVolumeTable(4, OMIX_VOLADJ_NEUTRAL)
    const thirtyTwo = omixVolumeTable(32, OMIX_VOLADJ_NEUTRAL)
    expect(omixVolumeRow(thirtyTwo, 63)[0x7f]!).toBeLessThan(omixVolumeRow(four, 63)[0x7f]!)
    expect(omixVolumeRow(four, 63)[0x7f]! / omixVolumeRow(thirtyTwo, 63)[0x7f]!).toBeCloseTo(8, 0)
  })

  /** $2133b4: stereo halves the count first, so each side is twice as loud */
  it('halves the channel count when the song is stereo', () => {
    const mono = omixVolumeTable(8, OMIX_VOLADJ_NEUTRAL, 0)
    const stereo = omixVolumeTable(8, OMIX_VOLADJ_NEUTRAL, MMD_FLAG3_STEREO)
    expect(omixVolumeRow(stereo, 63)[0x7f]!).toBeCloseTo(omixVolumeRow(mono, 63)[0x7f]! * 2, -1)
    // bit 1 turns the halving back off
    const both = omixVolumeTable(8, OMIX_VOLADJ_NEUTRAL, MMD_FLAG3_STEREO | 2)
    expect(omixVolumeRow(both, 63)[0x7f]).toBe(omixVolumeRow(mono, 63)[0x7f])
  })

  it('is all zeroes rather than a divide by zero when there are no channels', () => {
    const none = omixVolumeTable(0, OMIX_VOLADJ_NEUTRAL)
    expect([...none].every((v) => v === 0)).toBe(true)
  })

  it('divides by 6400 a channel, which is the $1900 at $2133c4', () => {
    expect(OMIX_VOLUME_SCALE).toBe(6400)
  })
})

describe('the 16-bit shift', () => {
  /** $2133fa is a ladder, and it is ceil(log2(channels)) written out longhand */
  it('is ceil(log2(channels)) for two and up', () => {
    expect(omixShift(1, OMIX_VOLADJ_NEUTRAL)).toBe(0)
    expect(omixShift(2, OMIX_VOLADJ_NEUTRAL)).toBe(1)
    expect(omixShift(3, OMIX_VOLADJ_NEUTRAL)).toBe(2)
    expect(omixShift(4, OMIX_VOLADJ_NEUTRAL)).toBe(2)
    expect(omixShift(8, OMIX_VOLADJ_NEUTRAL)).toBe(3)
    expect(omixShift(16, OMIX_VOLADJ_NEUTRAL)).toBe(4)
    expect(omixShift(32, OMIX_VOLADJ_NEUTRAL)).toBe(5)
    expect(omixShift(64, OMIX_VOLADJ_NEUTRAL)).toBe(6)
    for (let c = 2; c <= 64; c++) expect(omixShift(c, OMIX_VOLADJ_NEUTRAL)).toBe(Math.ceil(Math.log2(c)))
  })

  it('takes one off for stereo, unless bit 1 says not to', () => {
    expect(omixShift(8, OMIX_VOLADJ_NEUTRAL, MMD_FLAG3_STEREO)).toBe(2)
    expect(omixShift(8, OMIX_VOLADJ_NEUTRAL, MMD_FLAG3_STEREO | 2)).toBe(3)
    // and never below zero
    expect(omixShift(1, OMIX_VOLADJ_NEUTRAL, MMD_FLAG3_STEREO)).toBe(0)
  })

  /** $213448 gives headroom back at 200, 400 and 800 */
  it('gives a step back for each doubling of voladj above 200', () => {
    expect(omixShift(64, 100)).toBe(6)
    expect(omixShift(64, 200)).toBe(5)
    expect(omixShift(64, 400)).toBe(4)
    expect(omixShift(64, 800)).toBe(3)
    // and stops when there is nothing left to give
    expect(omixShift(2, 800)).toBe(0)
  })

  /** $213464 spends one at each of 100, 50, 25, 13, 7, 4 and 2 */
  it('spends a step for each halving of voladj below 100', () => {
    expect(omixShift(4, 99)).toBe(3)
    expect(omixShift(4, 49)).toBe(4)
    expect(omixShift(4, 24)).toBe(5)
    expect(omixShift(4, 12)).toBe(6)
    expect(omixShift(4, 1)).toBe(9)
  })
})

describe('the track scale', () => {
  /** $212f2e, which octaplayer does not do at all: it reads neither field */
  it('is trackvol times mastervol over sixteen', () => {
    expect(omixTrackScale(64, 64)).toBe(256)
    expect(omixTrackScale(32, 64)).toBe(128)
    expect(omixTrackScale(0, 64)).toBe(0)
  })

  /** $212b8c then scales the channel volume by it and shifts eight */
  it('leaves a full track at its own volume', () => {
    expect(omixChannelVolume(64, omixTrackScale(64, 64))).toBe(64)
    expect(omixChannelVolume(64, omixTrackScale(32, 64))).toBe(32)
  })
})

describe('the inner loop', () => {
  const table = omixVolumeTable(4, OMIX_VOLADJ_NEUTRAL)
  const row = omixVolumeRow(table, 63)

  function voice(over: Partial<ReturnType<typeof omixVoice>> = {}): ReturnType<typeof omixVoice> {
    return { ...omixVoice(), flags: OMIX_FLAG_LOOP, volumeTable: row, step: 0x10000, end: 8, ...over }
  }

  it('adds nothing for a channel whose bit 7 is set', () => {
    const acc = new Int16Array(4)
    expect(omixMix(acc, 4, voice({ flags: OMIX_FLAG_OFF }), new Int8Array(8).fill(64))).toBe(false)
    expect([...acc]).toEqual([0, 0, 0, 0])
  })

  it('adds nothing for a step of zero, which $211140 never sets', () => {
    const acc = new Int16Array(4)
    expect(omixMix(acc, 4, voice({ step: 0 }), new Int8Array(8).fill(64))).toBe(false)
  })

  /** the accumulator SUMS, which is what makes it a mixer */
  it('adds each voice on top of the last', () => {
    const pcm = new Int8Array(8).fill(64)
    const acc = new Int16Array(4)
    omixMix(acc, 4, voice(), pcm)
    const one = acc[0]!
    expect(one).toBe(row[64])
    omixMix(acc, 4, voice(), pcm)
    expect(acc[0]).toBe(one * 2)
  })

  /** `add.w` wraps rather than saturating, and nothing in the library clamps */
  it('wraps at sixteen bits rather than clamping', () => {
    const loud = omixVolumeRow(omixVolumeTable(1, 800), 63)
    const pcm = new Int8Array(8).fill(127)
    const acc = new Int16Array(2)
    for (let i = 0; i < 40; i++) omixMix(acc, 2, voice({ volumeTable: loud }), pcm)
    // it has been round at least once, which a clamp would have prevented
    expect(acc[0]).toBeLessThan(0)
  })

  /** $21041a: bit 6 clear is a one-shot and sets bit 7 */
  it('kills a one-shot at the end and leaves the rest of the span alone', () => {
    const v = voice({ flags: 0, end: 4 })
    const acc = new Int16Array(8)
    omixMix(acc, 8, v, new Int8Array(8).fill(64))
    expect(v.flags & OMIX_FLAG_OFF).toBe(OMIX_FLAG_OFF)
    expect(acc[0]!).not.toBe(0)
    expect(acc[7]).toBe(0)
  })

  /** $21042a: one loop length off the index, and round again */
  it('wraps a looping sample by its loop length', () => {
    const v = voice({ flags: OMIX_FLAG_LOOP, end: 4, loopLength: 4 })
    const acc = new Int16Array(16)
    omixMix(acc, 16, v, new Int8Array(8).fill(64))
    expect(v.flags & OMIX_FLAG_OFF).toBe(0)
    // it is still sounding sixteen samples later, which a one-shot would not be
    expect(acc[15]!).not.toBe(0)
    // the index is left past the end until the next run wraps it, which is
    // where $210450 puts it back too
    expect(v.position).toBeLessThanOrEqual(4)
  })

  /** $210464: bit 0 turns the direction round instead of wrapping */
  it('turns a ping-pong loop round rather than wrapping it', () => {
    const v = voice({ flags: OMIX_FLAG_LOOP | OMIX_FLAG_PINGPONG, end: 4, loopLength: 4 })
    const acc = new Int16Array(8)
    omixMix(acc, 8, v, new Int8Array(8).fill(64))
    expect(v.flags & OMIX_FLAG_BACKWARD).toBe(OMIX_FLAG_BACKWARD)
    expect(v.flags & OMIX_FLAG_OFF).toBe(0)
  })

  /** a looping voice with nowhere to loop back to is dead, not an endless read */
  it('kills a looping voice whose loop length is zero', () => {
    const v = voice({ flags: OMIX_FLAG_LOOP, end: 4, loopLength: 0 })
    const acc = new Int16Array(8)
    omixMix(acc, 8, v, new Int8Array(8).fill(64))
    expect(v.flags & OMIX_FLAG_OFF).toBe(OMIX_FLAG_OFF)
  })

  /**
   * The fraction carries into the index, which is what `add.w d6,d4 / addx.l
   * d5,d2` does. At half speed the same frame is read twice.
   */
  it('carries the fraction into the index', () => {
    const v = voice({ step: 0x8000, end: 8 })
    const pcm = Int8Array.from([1, 2, 3, 4, 5, 6, 7, 8])
    const acc = new Int16Array(4)
    omixMix(acc, 4, v, pcm)
    expect(acc[0]).toBe(row[1])
    expect(acc[1]).toBe(row[1])
    expect(acc[2]).toBe(row[2])
    expect(acc[3]).toBe(row[2])
  })

  /**
   * $210556's family shifts instead of looking up, so a 16-bit instrument has
   * power-of-two volume and nothing between. This is the check that the two
   * paths really are different rather than one scaled twice.
   */
  it('shifts a 16-bit sample rather than tabling it', () => {
    const pcm = new Int8Array(16)
    // big-endian 16-bit frames of 0x4000
    for (let i = 0; i < 8; i += 1) {
      pcm[i * 2] = 0x40
      pcm[i * 2 + 1] = 0
    }
    const acc = new Int16Array(4)
    omixMix(acc, 4, voice({ sixteenBit: true, shift: 2, volumeTable: null }), pcm)
    expect(acc[0]).toBe(0x4000 >> 2)
    const quieter = new Int16Array(4)
    omixMix(quieter, 4, voice({ sixteenBit: true, shift: 3, volumeTable: null }), pcm)
    expect(quieter[0]).toBe(0x4000 >> 3)
  })

  /** `asr.w`, so a negative 16-bit sample rounds toward minus one */
  it('rounds a negative 16-bit sample down, the way asr does', () => {
    const pcm = Int8Array.from([0xff, 0xff, 0xff, 0xff])
    const acc = new Int16Array(2)
    omixMix(acc, 2, voice({ sixteenBit: true, shift: 4, volumeTable: null, end: 2 }), pcm)
    // -1 >> 4 is -1 and not 0
    expect(acc[0]).toBe(-1)
  })
})

describe('the echo', () => {
  /** $2134b4: `mix_echolen * rate / 1000`, so the field is milliseconds */
  it('turns milliseconds into frames at the mixing rate', () => {
    expect(OMIX_ECHO_MS).toBe(1000)
    expect(omixEchoFrames(100, 15040)).toBe(1504)
    expect(omixEchoFrames(250, 28185)).toBe(7046)
    expect(omixEchoFrames(100, 0)).toBe(0)
  })

  /**
   * The line holds what has ALREADY been echoed ($211a7c writes the sum back,
   * not the input), so a single impulse comes round again and again, quieter
   * each lap by the depth shift.
   */
  it('recirculates, because the sum goes back into the line', () => {
    const line = new Int16Array(4)
    const acc = new Int16Array(4)
    acc[0] = 1024
    let pos = omixEcho(acc, 4, line, 0, 1, false, 0)
    expect(acc[0]).toBe(1024)
    expect(line[0]).toBe(1024)
    // four frames later the tap comes round
    const next = new Int16Array(4)
    pos = omixEcho(next, 4, line, pos, 1, false, 0)
    expect(next[0]).toBe(512)
    // and again, halved once more
    const third = new Int16Array(4)
    omixEcho(third, 4, line, pos, 1, false, 0)
    expect(third[0]).toBe(256)
  })

  /** a deeper shift is a QUIETER echo, because it is `asr` and not a multiply */
  it('gets quieter as the depth rises', () => {
    const tap = (depth: number): number => {
      const line = new Int16Array(2)
      const a = new Int16Array(2)
      a[0] = 4096
      const p = omixEcho(a, 2, line, 0, depth, false, 0)
      const b = new Int16Array(2)
      omixEcho(b, 2, line, p, depth, false, 0)
      return b[0]!
    }
    expect(tap(1)).toBe(2048)
    expect(tap(2)).toBe(1024)
    expect(tap(4)).toBe(256)
  })

  /** $211a50: the position wraps at the line length rather than running off */
  it('wraps the line and keeps its place across calls', () => {
    const line = new Int16Array(3)
    const acc = new Int16Array(5)
    const pos = omixEcho(acc, 5, line, 0, 1, false, 0)
    expect(pos).toBeLessThanOrEqual(3)
  })

  /**
   * $211adc, and the only thing that makes type 2 different: the right delayed
   * sample lands on the LEFT output.
   */
  it('cross-feeds the sides for echo type 2 in stereo', () => {
    const line = new Int16Array(4)
    const acc = new Int16Array(4)
    // one frame: left 1024, right 0
    acc[0] = 1024
    acc[1] = 0
    const pos = omixEcho(acc, 2, line, 0, 1, true, 2)
    const next = new Int16Array(4)
    omixEcho(next, 2, line, pos, 1, true, 2)
    // the left impulse comes back on the RIGHT
    expect(next[1]).toBe(512)
    expect(next[0]).toBe(0)
  })

  it('keeps each side on its own tap for any other type', () => {
    const line = new Int16Array(4)
    const acc = new Int16Array(4)
    acc[0] = 1024
    const pos = omixEcho(acc, 2, line, 0, 1, true, 1)
    const next = new Int16Array(4)
    omixEcho(next, 2, line, pos, 1, true, 1)
    expect(next[0]).toBe(512)
    expect(next[1]).toBe(0)
  })
})

describe('the stereo spread', () => {
  /** $211bd2 widens, $211c30 narrows, and the shift is five either side */
  it('subtracts the other side for a positive separation', () => {
    const acc = Int16Array.from([1024, 0])
    omixStereoSpread(acc, 1, OMIX_SPREAD_BASE)
    // a separation of five is a shift of zero: the whole of the other channel
    expect(acc[0]).toBe(1024)
    expect(acc[1]).toBe(-1024)
  })

  it('adds the other side for a negative separation', () => {
    const acc = Int16Array.from([1024, 0])
    omixStereoSpread(acc, 1, -OMIX_SPREAD_BASE)
    expect(acc[0]).toBe(1024)
    expect(acc[1]).toBe(1024)
  })

  /** a small separation is a big shift, so it barely moves */
  it('moves less as the separation shrinks', () => {
    const at = (sep: number): number => {
      const acc = Int16Array.from([1024, 1024])
      omixStereoSpread(acc, 1, sep)
      return acc[0]!
    }
    expect(at(1)).toBe(1024 - (1024 >> 4))
    expect(at(4)).toBe(1024 - (1024 >> 1))
  })

  /**
   * Both sides are read before either is written ($211bda and $211bdc). A
   * sequential version would feed the already-widened left into the right, and
   * this is the case that tells them apart.
   */
  it('is a matrix and not two sequential subtractions', () => {
    const acc = Int16Array.from([1024, 512])
    omixStereoSpread(acc, 1, 4)
    expect(acc[0]).toBe(1024 - (512 >> 1))
    expect(acc[1]).toBe(512 - (1024 >> 1))
  })

  it('does nothing at all for a separation of zero', () => {
    const acc = Int16Array.from([1024, 512])
    omixStereoSpread(acc, 1, 0)
    expect([...acc]).toEqual([1024, 512])
  })
})
