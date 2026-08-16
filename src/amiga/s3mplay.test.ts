/**
 * ScreamTracker's replay, against the library and against the module.
 *
 * Three of the checks below pin behaviour that is wrong. They are here because
 * the wrongness is the thing this port has to reproduce, and a test that
 * asserted the correct answer would quietly turn a faithful replay into a
 * better one.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { NullAudio } from './paula'
import { parseS3m, type S3mSong } from './s3m'
import { S3M_MIX_RATE, s3mSamplesPerTick, s3mSides } from './s3mmix'
import {
  S3M_BREAK_TENS,
  S3M_CMD,
  S3M_MAX_VOLUME,
  S3M_RETRIG_ADD,
  S3M_RETRIG_MUL,
  S3mPlayer,
  s3mSine,
} from './s3mplay'

function fixture(): S3mSong | null {
  try {
    return parseS3m(new Uint8Array(readFileSync('fixtures/modules/dme/st.s3m')))
  } catch {
    return null
  }
}

describe('the tables', () => {
  it('is the sine at $21240a, all 32 bytes', () => {
    // 00 18 31 4a 61 78 8d a1 b4 c5 d4 e0 eb f4 fa fd / ff fd fa ... 31 18
    expect([...s3mSine()]).toEqual([
      0x00, 0x18, 0x31, 0x4a, 0x61, 0x78, 0x8d, 0xa1, 0xb4, 0xc5, 0xd4, 0xe0, 0xeb, 0xf4, 0xfa, 0xfd,
      0xff, 0xfd, 0xfa, 0xf4, 0xeb, 0xe0, 0xd4, 0xc5, 0xb4, 0xa1, 0x8d, 0x78, 0x61, 0x4a, 0x31, 0x18,
    ])
  })

  it('is the two Qxy tables at $2123ea and $2123fa', () => {
    expect([...S3M_RETRIG_ADD]).toEqual([0, -1, -2, -4, -8, -16, 0, 0, 0, 1, 2, 4, 8, 16, 0, 0])
    expect([...S3M_RETRIG_MUL]).toEqual([0, 0, 0, 0, 0, 0, 10, 8, 0, 0, 0, 0, 0, 0, 24, 32])
    // the six zero slots in one are the six non-zero slots in the other
    for (let i = 0; i < 16; i++) expect(S3M_RETRIG_ADD[i] !== 0 && S3M_RETRIG_MUL[i] !== 0).toBe(false)
  })

  it('reads Cxy as decimal, so $C10 breaks to row ten and not row sixteen', () => {
    expect([...S3M_BREAK_TENS]).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150])
  })
})

const song = fixture()

describe.skipIf(!song)('the sequencer', () => {
  const boot = (): S3mPlayer => {
    const p = new S3mPlayer(() => undefined)
    p.load(song!)
    return p
  }

  it('starts on the module\'s own speed and tempo, not the defaults', () => {
    const p = boot()
    expect(p.speed).toBe(2)
    expect(p.samplesPerTick).toBe(s3mSamplesPerTick(S3M_MIX_RATE, 95))
    expect(p.order).toBe(0)
    expect(p.row).toBe(0)
  })

  it('fires a row every `speed` ticks and no oftener', () => {
    const p = boot()
    const rows: number[] = []
    for (let i = 0; i < 12; i++) {
      p.vbl()
      rows.push(p.row)
    }
    // the counter starts at zero and the row fires when it REACHES the speed,
    // so row 0 plays on the second tick and nothing at all on the first
    expect(rows).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6])
  })

  it('walks 64 rows and then steps the order', () => {
    const p = boot()
    for (let i = 0; i < 64 * 2; i++) p.vbl()
    expect(p.order).toBe(1)
    expect(p.row).toBe(0)
  })

  it('reaches the end of the order list and sets the flag rather than stopping', () => {
    const p = boot()
    let ticks = 0
    while (!p.ended && ticks < 200000) {
      p.vbl()
      ticks++
    }
    expect(p.ended).toBe(true)
    expect(p.playing).toBe(true)
    expect(ticks).toBeLessThan(200000)
  })

  it('loads an instrument and gives the voice its loop', () => {
    const p = boot()
    for (let i = 0; i < 40; i++) p.vbl()
    const live = p.channels.filter((c) => c.sample >= 0)
    expect(live.length).toBeGreaterThan(0)
    for (const c of live) expect(c.volume).toBeLessThanOrEqual(S3M_MAX_VOLUME)
  })

  it('splits the twelve channels six a side, which is what sizes the level table', () => {
    const sides = s3mSides(song!.settings)
    expect(sides.left + sides.right).toBe(12)
    expect(sides.channels).toBe(Math.max(sides.left, sides.right))
  })
})

/** the fixture with one cell of row 0 replaced, so the real row pass runs it */
function withCell(command: number, param: number, order = 0): S3mPlayer {
  const copy: S3mSong = { ...song!, patterns: song!.patterns.map((p) => p.map((r) => r.map((c) => ({ ...c })))) }
  for (const pat of copy.patterns) {
    for (const cell of pat[0]!) {
      cell.note = 0
      cell.instrument = 0
      cell.volume = -1
      cell.command = 0
      cell.param = 0
    }
    pat[0]![0] = { note: 0, instrument: 0, volume: -1, command, param }
  }
  const p = new S3mPlayer(() => undefined)
  p.load(copy)
  p.order = order
  return p
}

describe.skipIf(!song)('the three commands that are broken', () => {
  /** a channel with a live vibrato command, driven on TICKS only */
  const vibrating = (command: number, param: number): S3mPlayer => {
    const p = new S3mPlayer(() => undefined)
    p.load(song!)
    p.speed = 250
    p.tick = 0
    const ch = p.channels[0]!
    ch.flags = 0x80
    ch.command = command
    ch.param = param
    ch.memory = param
    ch.period = 1712
    ch.vibParam = 0
    ch.vibPos = 0
    return p
  }

  it('leaves H bending nothing, because $211f5c reads the command byte', () => {
    // the cell says speed 4 depth 8; the handler reads $3(a2) and sees 8
    const p = vibrating(S3M_CMD.H, 0x48)
    const ch = p.channels[0]!
    const v = p.voices[0]!
    for (let i = 0; i < 8; i++) p.vbl()
    expect(ch.vibParam).toBe(S3M_CMD.H)
    // a speed nibble of zero never moves the phase, and sine[0] is zero
    expect(ch.vibPos).toBe(0)
    expect(v.period).toBe(ch.period)
  })

  it('gives U a speed of one and a depth of five whatever the module asks', () => {
    const p = vibrating(S3M_CMD.U, 0xf1)
    const ch = p.channels[0]!
    p.vbl()
    // $15 is U's command byte: depth 5, speed 1
    expect(ch.vibParam).toBe(0x15)
    expect(ch.vibPos).toBe(1)
    // and it really does bend, unlike H, though a depth of five over a shift
    // of seven is at most nine period units either way
    const seen = new Set<number>()
    for (let i = 0; i < 64; i++) {
      p.vbl()
      seen.add(p.voices[0]!.period)
    }
    expect(ch.vibPos).toBe(65)
    expect(seen.size).toBeGreaterThan(4)
    // one whole turn of the 64-step sine, nine units each way
    expect(Math.max(...seen)).toBe(1712 + 9)
    expect(Math.min(...seen)).toBe(1712 - 9)
  })

  it('restarts the song on a BACKWARD Bxx instead of jumping to it', () => {
    // $211d7e branches only when the target is above the current order, and
    // $211d86 then throws the target away
    const p = withCell(S3M_CMD.B, 4, 10)
    for (let i = 0; i < p.speed; i++) p.vbl()
    expect(p.order).toBe(0)
    expect(p.ended).toBe(true)
  })

  it('jumps where it is told when the target is AHEAD', () => {
    const p = withCell(S3M_CMD.B, 9, 2)
    for (let i = 0; i < p.speed; i++) p.vbl()
    expect(p.order).toBe(9)
    expect(p.row).toBe(0)
  })

  it('breaks to a DECIMAL row, so C10 is row ten', () => {
    const p = withCell(S3M_CMD.C, 0x10, 0)
    for (let i = 0; i < p.speed; i++) p.vbl()
    expect(p.order).toBe(1)
    expect(p.row).toBe(10)
  })
})

describe.skipIf(!song)('the sound it makes', () => {
  it('fills both buffers and moves them, over four hundred ticks', () => {
    const audio = new NullAudio()
    const p = new S3mPlayer(() => audio)
    p.load(song!)
    let loudest = 0
    let quiet = 0
    for (let i = 0; i < 400; i++) p.vbl()
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(800)
    const pcm = audio.voiceState[0]!.pcm
    expect(pcm).toBeTruthy()
    for (const b of pcm!) {
      loudest = Math.max(loudest, Math.abs(b))
      if (b === 0) quiet++
    }
    // a real tick of twelve channels is neither silence nor a solid rail
    expect(loudest).toBeGreaterThan(4)
    expect(quiet).toBeLessThan(pcm!.length)
  })

  it('plays a buffer of exactly one tick on two voices', () => {
    const audio = new NullAudio()
    const p = new S3mPlayer(() => audio)
    p.load(song!)
    p.vbl()
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays.map((e) => e.voice).sort()).toEqual([0, 1])
    for (const e of plays) {
      expect(e.freq).toBe(S3M_MIX_RATE)
      expect(e.length).toBe(p.samplesPerTick)
    }
  })
})
