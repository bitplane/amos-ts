/**
 * ScreamTracker's mixer, against the routines it was read from.
 *
 * The interesting checks are the ones a plain 16.16 mixer would pass anyway:
 * that the position's halves really are the other way up, that the volume
 * table's unsigned arm lands on the same bytes as its signed one, and that the
 * level table's rows are the ragged sizes $21158c builds rather than 256 each.
 */
import { describe, expect, it } from 'vitest'
import {
  S3M_BOOSTS,
  S3M_CLOCK,
  S3M_MIX_RATE,
  S3M_NOTE_PERIODS,
  S3M_SILENCE,
  S3M_VOLUMES,
  S3M_VOL_ROW,
  s3mBoost,
  s3mBoostWord,
  s3mLevel,
  s3mLevelTable,
  s3mMix,
  s3mPeriod,
  s3mSamplesPerTick,
  s3mSides,
  s3mStep,
  s3mVoice,
  s3mVolumeTable,
  swap32,
} from './s3mmix'

describe('the clock and the tick', () => {
  it('runs off ScreamTracker\'s constant, a quarter of 14,317,056', () => {
    // move.l #$369d80,$c2(a5) at $211874
    expect(S3M_CLOCK).toBe(0x369d80)
    expect(S3M_CLOCK * 4).toBe(14317056)
  })

  it('gives 560 samples a tick at 28,000 Hz and 125 BPM', () => {
    // $21086e: rate * 5 / (tempo * 2), then addq.w #1 and andi.w #$fffe
    expect(s3mSamplesPerTick(S3M_MIX_RATE, 125)).toBe(560)
    // the round up to even is visible at an odd quotient
    expect(s3mSamplesPerTick(S3M_MIX_RATE, 96)).toBe(730)
    expect(Math.trunc((S3M_MIX_RATE * 5) / 192)).toBe(729)
  })

  it('speeds up as the tempo rises, which is the way round S3M has it', () => {
    expect(s3mSamplesPerTick(S3M_MIX_RATE, 250)).toBeLessThan(s3mSamplesPerTick(S3M_MIX_RATE, 125))
  })
})

describe('the note table', () => {
  it('is ScreamTracker\'s twelve words, out of $2123d2', () => {
    expect([...S3M_NOTE_PERIODS]).toEqual([1712, 1616, 1524, 1440, 1356, 1280, 1208, 1140, 1076, 1016, 960, 907])
  })

  it('plays a sample at its own rate when the note is octave four', () => {
    // $211ac6: table * 8363 * 16 >> octave / c2spd
    const period = s3mPeriod(0x40, 8363)
    expect(period).toBe(1712)
    expect(Math.trunc(14317056 / period)).toBe(8362)
  })

  it('halves the period an octave up, so the shift is by the high nibble', () => {
    expect(s3mPeriod(0x30, 8363)).toBe(3424)
    expect(s3mPeriod(0x50, 8363)).toBe(856)
  })

  it('follows c2spd, which is what makes an odd recording rate play in tune', () => {
    expect(s3mPeriod(0x40, 16726)).toBe(856)
  })
})

describe('the step', () => {
  it('is a 16.16 fraction once both truncations have run', () => {
    // ($369d80 / period) << 14, then / (rate >> 4)
    const step = s3mStep(1712, S3M_MIX_RATE)
    const exact = (8363 / S3M_MIX_RATE) * 0x10000
    expect(step / 0x10000).toBeCloseTo(8363 / S3M_MIX_RATE, 3)
    // the three truncations run under four parts in ten thousand flat
    expect(exact - step).toBeGreaterThan(0)
    expect((exact - step) / exact).toBeLessThan(0.0004)
  })

  it('stays inside 32 bits at the shortest period the format reaches', () => {
    const shortest = s3mPeriod(0x70, 8363)
    expect(shortest).toBeGreaterThan(0)
    expect(Math.trunc(S3M_CLOCK / shortest) * 0x4000).toBeLessThan(0x100000000)
  })
})

describe('the byte-swapped position', () => {
  it('carries the fraction out of bit 31 into the index, not the other way', () => {
    const pcm = new Uint8Array(64)
    for (let i = 0; i < 64; i++) pcm[i] = i
    const volumes = s3mVolumeTable(false)
    const out = new Uint16Array(8)
    const v = s3mVoice()
    // a step of exactly a half: index 0,0,1,1,2,2,3,3
    v.period = 1
    v.volume = 64
    v.left = 64
    // s3mStep would give the module's own step; drive the loop by hand instead
    const half = swap32(0x8000)
    expect(half >>> 0).toBe(0x80000000)
    let pos = 0
    const seen: number[] = []
    for (let i = 0; i < 8; i++) {
      seen.push(pos & 0xffff)
      const sum = pos + half
      pos = ((sum & 0xffff0000) | (((sum & 0xffff) + (sum > 0xffffffff ? 1 : 0)) & 0xffff)) >>> 0
    }
    expect(seen).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
    expect(out.length).toBe(8)
    expect(volumes.length).toBe(S3M_VOLUMES * S3M_VOL_ROW)
    expect(v.period).toBe(1)
  })

  it('leaves the index in the LOW half, which is what (a0,d0.w) reads', () => {
    // one whole sample per step puts $1 in the low word, not the high one
    const step = 0x10000
    expect(swap32(step) & 0xffff).toBe(1)
    expect(swap32(step) >>> 16).toBe(0)
  })
})

describe('the volume table', () => {
  const unsigned = s3mVolumeTable(false)
  const signed = s3mVolumeTable(true)

  it('is 65 rows of 256, and every row is 256-aligned so a move.b indexes it', () => {
    expect(unsigned).toHaveLength(65 * 256)
    // $2102d4 rounds the allocation up to a $100 boundary for exactly this
    expect(S3M_VOL_ROW).toBe(0x100)
  })

  it('leaves silence at $80 and full volume unchanged', () => {
    expect(unsigned[64 * 256 + 0x80]).toBe(0x80)
    expect(unsigned[64 * 256 + 0]).toBe(0)
    expect(unsigned[64 * 256 + 0xff]).toBe(0xff)
  })

  it('flattens every byte to $80 at volume zero, which is why $210dea needs no table', () => {
    for (let b = 0; b < 256; b++) expect(unsigned[b]).toBe(0x80)
  })

  it('halves at volume 32, rounding towards minus infinity as asr.l does', () => {
    expect(unsigned[32 * 256 + 0]).toBe(0x40)
    expect(unsigned[32 * 256 + 0xff]).toBe(0x80 + 63)
  })

  it('gives the two arms the same byte for the same signed value', () => {
    // $211610 works in 16-bit two\'s complement and lets mulu.w read it as
    // large and positive; $211632 sign-extends first. The low byte agrees.
    for (let vol = 0; vol < 65; vol++) {
      for (let s = -128; s < 128; s++) {
        expect(signed[vol * 256 + (s & 0xff)]).toBe(unsigned[vol * 256 + (s + 128)])
      }
    }
  })
})

describe('the pan scan', () => {
  it('splits at eight, keeps the BUSIER side, and never goes below two', () => {
    // $211530: under eight is left, eight and over is right, bit 7 is off
    const settings = new Uint8Array(32).fill(0xff)
    for (let i = 0; i < 12; i++) settings[i] = i & 1 ? 8 : 0
    const s = s3mSides(settings)
    expect(s.left).toBe(6)
    expect(s.right).toBe(6)
    expect(s.channels).toBe(6)
    expect(s.last).toBe(12)
  })

  it('sizes the table for a module panned entirely one way', () => {
    const settings = new Uint8Array(32).fill(0xff)
    for (let i = 0; i < 9; i++) settings[i] = 0
    const s = s3mSides(settings)
    expect(s.right).toBe(0)
    expect(s.channels).toBe(9)
  })

  it('floors at two even when one channel sounds', () => {
    const settings = new Uint8Array(32).fill(0xff)
    settings[0] = 0
    expect(s3mSides(settings).channels).toBe(2)
  })
})

describe('the headroom', () => {
  it('is $140 and $40 more every second entry, out of $211886', () => {
    const want = [0x140, 0x140, 0x180, 0x180, 0x1c0, 0x1c0, 0x200, 0x200]
    expect(Array.from({ length: 8 }, (_, i) => s3mBoostWord(i))).toEqual(want)
    // thirty words, and the last is $4c0: the table stops just past 32 channels
    expect(s3mBoostWord(S3M_BOOSTS - 1)).toBe(0x4c0)
  })

  it('gives a twelve-channel module a divisor of two', () => {
    // $bc(a5) is 12, so the entry is $240 and the shift by seven gives 4
    expect(s3mBoost(12)).toBe(4)
    const levels = s3mLevelTable(6, s3mBoost(12))
    // row 5 covers a six-channel sum, and half of full scale already clips
    const row = levels.rows[5]!
    expect(levels.data[row + 6 * 128]).toBe(0)
    expect(levels.data[row + 6 * 128 + 400]).toBe(127)
  })
})

describe('the level table', () => {
  const levels = s3mLevelTable(6, 4)

  it('grows a row at a time, so a row is never indexed past its end', () => {
    expect([...levels.rows]).toEqual([0, 256, 768, 1536, 2560, 3840])
    expect(levels.data).toHaveLength(128 * 6 * 7)
  })

  it('takes off one bias per channel that sounded, so silence stays at zero', () => {
    for (let sounded = 1; sounded <= 6; sounded++) {
      const acc = new Uint16Array(1)
      acc[0] = sounded * S3M_SILENCE
      const out = new Int8Array(1)
      s3mLevel(out, acc, 1, levels, sounded)
      expect(out[0]).toBe(0)
    }
  })

  it('clamps rather than wraps, which is the whole loudness policy', () => {
    const acc = Uint16Array.of(0, 6 * 255)
    const out = new Int8Array(2)
    s3mLevel(out, acc, 2, levels, 6)
    expect(out[0]).toBe(-128)
    expect(out[1]).toBe(127)
  })
})

describe('mixing one voice', () => {
  const volumes = s3mVolumeTable(false)
  const ramp = new Uint8Array(256)
  for (let i = 0; i < 256; i++) ramp[i] = i

  // 511 and 28,016 make the step exactly $10000, so the index is the sample
  // number and every assertion below reads as a list of bytes. Both numbers
  // are chosen for that, not taken from a module.
  const ONE = 511
  const RATE_1 = 28016
  const RATE_HALF = 56032

  const voiceAt = (period: number): ReturnType<typeof s3mVoice> => {
    const v = s3mVoice()
    v.period = period
    v.volume = 64
    v.left = ramp.length
    return v
  }

  it('steps exactly one sample at the period the rest of these use', () => {
    expect(s3mStep(ONE, RATE_1)).toBe(0x10000)
    expect(s3mStep(ONE, RATE_HALF)).toBe(0x8000)
  })

  it('reads consecutive bytes when the step is one sample', () => {
    const v = voiceAt(ONE)
    const out = new Uint16Array(8)
    expect(s3mMix(out, 8, v, ramp, volumes, 64, RATE_1, true)).toBe(true)
    expect([...out]).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('rebases the pointer every run, so the index restarts at zero', () => {
    const v = voiceAt(ONE)
    const out = new Uint16Array(8)
    s3mMix(out, 8, v, ramp, volumes, 64, RATE_1, true)
    expect(v.at).toBe(8)
    expect(v.left).toBe(248)
    expect(v.pos & 0xffff).toBe(0)
    s3mMix(out, 8, v, ramp, volumes, 64, RATE_1, true)
    expect([...out]).toEqual([8, 9, 10, 11, 12, 13, 14, 15])
  })

  it('holds each byte for two samples at half the step', () => {
    const v = voiceAt(ONE)
    const out = new Uint16Array(8)
    s3mMix(out, 8, v, ramp, volumes, 64, RATE_HALF, true)
    expect([...out]).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
  })

  it('adds into the buffer for every channel after the first', () => {
    const v = voiceAt(ONE)
    const out = new Uint16Array(4).fill(0x80)
    s3mMix(out, 4, v, ramp, volumes, 64, RATE_1, false)
    expect([...out]).toEqual([0x80, 0x81, 0x82, 0x83])
  })

  it('fills silence when the first channel is dead and adds nothing when a later one is', () => {
    const dead = s3mVoice()
    const out = new Uint16Array(4).fill(0x1234)
    expect(s3mMix(out, 4, dead, ramp, volumes, 64, RATE_1, true)).toBe(true)
    expect([...out]).toEqual([0x80, 0x80, 0x80, 0x80])
    // $210e52 goes straight to an rts, so $210fd2 never counts this channel
    expect(s3mMix(out, 4, dead, ramp, volumes, 64, RATE_1, false)).toBe(false)
    expect([...out]).toEqual([0x80, 0x80, 0x80, 0x80])
  })

  it('reads ONE byte past a sample whose end falls on a step boundary', () => {
    // $210cc2 adds one to the run whether or not the divide came out exact
    const v = voiceAt(ONE)
    v.left = 3
    const out = new Uint16Array(6)
    s3mMix(out, 6, v, ramp, volumes, 64, RATE_1, true)
    expect(v.ended).toBe(true)
    expect([...out]).toEqual([0, 1, 2, 3, S3M_SILENCE, S3M_SILENCE])
  })

  it('carries the overshoot into a loop rather than clicking back to its start', () => {
    // $210d78 subtracts the remaining bytes from the index and $210d80 adds
    // that difference on, so the loop resumes where the step landed
    const v = voiceAt(ONE)
    v.left = 3
    v.loops = true
    v.loopAt = 100
    v.loopLength = 8
    const out = new Uint16Array(8)
    s3mMix(out, 8, v, ramp, volumes, 64, RATE_1, true)
    expect(v.ended).toBe(false)
    expect([...out]).toEqual([0, 1, 2, 3, 101, 102, 103, 104])
  })

  it('never lets the index reach the sign bit of (a0,d0.w)', () => {
    const v = voiceAt(ONE)
    v.left = 0x20000
    const big = new Uint8Array(0x20000)
    const out = new Uint16Array(560)
    for (let tick = 0; tick < 80; tick++) {
      s3mMix(out, 560, v, big, volumes, 64, RATE_1, true)
      expect(v.pos & 0xffff).toBe(0)
    }
    expect(v.at).toBe(80 * 560)
    expect(v.at).toBeGreaterThan(0x8000)
  })
})
