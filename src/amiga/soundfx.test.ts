/**
 * SoundFX 1.3, against `DME_SoundFX1.3.library` and against the one real
 * module: bank 3 of `SoundFX13_Example.amos`, named "SFX1.3" and 35,900 bytes.
 *
 * The module is reached by sha256 out of the corpus, because a third-party
 * module is not ours to keep in the tree. The synthetic ones below are built
 * here, since what they check is the layout arithmetic rather than any file.
 */
import { describe, expect, it } from 'vitest'
import { describeWith } from '../testing/fixture'
import { readFileSync } from 'node:fs'
import { parseAmosFile } from '../loader/amosfile'
import { corpusFile, haveCorpus } from '../cli/corpus'
import { NullAudio } from './paula'
import {
  SFX_INSTRUMENTS,
  SFX_LENGTH_AT,
  SFX_PATTERNS_AT,
  SFX_PATTERN_BYTES,
  SFX_PERIODS,
  SFX_RECORDS_AT,
  SFX_RECORD_BYTES,
  SFX_SEQUENCE_AT,
  SFX_TICKS_PER_ROW,
  SoundFx,
  parseSfx,
} from './soundfx'

/** sources/kyzer-dme/files/amospro_dme_v2.0/examples/SoundFX13_Example.amos */
const EXAMPLE = '2e9167ab0abcc99de3294ede8748d6a0b34cd5a24a09286d0041bc1680991525'

function exampleBank(): Uint8Array | null {
  if (!haveCorpus()) return null
  const path = corpusFile(EXAMPLE)
  if (!path) return null
  const file = parseAmosFile(new Uint8Array(readFileSync(path)))
  const found = file?.banks.find((b) => 'data' in b && (b as { number?: number }).number === 3)
  return found && 'data' in found ? (found.data as Uint8Array) : null
}

/* ---- a module built to order ---- */

interface Built {
  /** how many sequence entries are the song */
  length?: number
  sequence?: number[]
  /** [instrument 1..15] lengths in bytes */
  lengths?: number[]
  /** per instrument: [oneShotWords, volume, repeatStart, repeatWords] */
  records?: Array<[number, number, number, number]>
  /** [pattern][row][channel] = the four bytes */
  rows?: Array<{ pattern: number; row: number; channel: number; event: number[] }>
  sample?: (i: number, n: number) => number
}

function build(b: Built = {}): Uint8Array {
  const sequence = b.sequence ?? [0]
  const length = b.length ?? sequence.length
  const lengths = b.lengths ?? []
  let highest = 0
  for (let i = 0; i < length; i++) highest = Math.max(highest, sequence[i] ?? 0)
  const patternBytes = (highest + 1) * SFX_PATTERN_BYTES
  const total = lengths.reduce((a, n) => a + n, 0)
  const out = new Uint8Array(SFX_PATTERNS_AT + patternBytes + total)
  const w = (at: number, n: number): void => { out[at] = (n >> 8) & 0xff; out[at + 1] = n & 0xff }
  for (let i = 0; i < SFX_INSTRUMENTS; i++) {
    const n = lengths[i] ?? 0
    out[i * 4 + 2] = (n >> 8) & 0xff
    out[i * 4 + 3] = n & 0xff
  }
  for (const [i, c] of [...'SONG'].entries()) out[0x3c + i] = c.charCodeAt(0)
  w(0x40, 0x38a4)
  for (let i = 0; i < SFX_INSTRUMENTS; i++) {
    const rec = SFX_RECORDS_AT + (i + 1) * SFX_RECORD_BYTES
    const [one, vol, rs, rw] = b.records?.[i] ?? [Math.max(1, (lengths[i] ?? 2) / 2 - 1), 0x40, 0, 1]
    w(rec, one); w(rec + 2, vol); w(rec + 4, rs); w(rec + 6, rw)
  }
  out[SFX_LENGTH_AT] = length
  for (const [i, n] of sequence.entries()) out[SFX_SEQUENCE_AT + i] = n
  for (const r of b.rows ?? []) {
    const at = SFX_PATTERNS_AT + r.pattern * SFX_PATTERN_BYTES + r.row * 0x10 + r.channel * 4
    for (const [i, n] of r.event.entries()) out[at + i] = n
  }
  let at = SFX_PATTERNS_AT + patternBytes
  for (const [i, n] of lengths.entries()) {
    for (let k = 0; k < n; k++) out[at + k] = (b.sample ?? ((s: number) => 0x10 + s))(i, k) & 0xff
    at += n
  }
  return out
}

/** one row's four bytes: period, instrument, command, parameter */
const ev = (period: number, instrument = 0, command = 0, param = 0): number[] =>
  [(period >> 8) & 0xff, period & 0xff, ((instrument & 0xf) << 4) | (command & 0xf), param]

function player(data: Uint8Array): { fx: SoundFx; audio: NullAudio } {
  const audio = new NullAudio()
  const fx = new SoundFx(() => audio)
  fx.load(parseSfx(data)!)
  audio.events.length = 0
  return { fx, audio }
}

/** run to the Nth row: the row lands on every sixth tick */
const rows = (fx: SoundFx, n: number): void => {
  for (let i = 0; i < n * SFX_TICKS_PER_ROW; i++) fx.tick()
}

describe('the file layout, off InitModule at $2105a4', () => {
  it('wants "SONG" at $3c and nothing else', () => {
    expect(parseSfx(build())).not.toBeNull()
    const bad = build()
    bad[0x3d] = 0x21
    expect(parseSfx(bad)).toBeNull()
    // "SO31", the 31-instrument variant, is a different four bytes and this
    // library has no branch for it
    expect(parseSfx(new Uint8Array(0x300))).toBeNull()
  })

  it('reads the song length as ONE BYTE at $212, which `move.b` into $210aff says', () => {
    const song = parseSfx(build({ sequence: [0, 1, 0], length: 3 }))!
    expect(song.length).toBe(3)
    expect([...song.sequence.subarray(0, 3)]).toEqual([0, 1, 0])
    expect(song.sequence.length).toBe(0x80)
  })

  it('counts patterns from the sequence entries INSIDE the song length only', () => {
    // $2105ec walks `length` bytes and keeps the largest. A high entry past
    // the end is never seen, so the samples sit closer to the front
    const inside = parseSfx(build({ sequence: [0, 1, 7], length: 3 }))!
    expect(inside.patterns).toBe(8)
    const outside = parseSfx(build({ sequence: [0, 1, 7], length: 2 }))!
    expect(outside.patterns).toBe(2)
  })

  it('indexes the instrument records ONE-BASED off $48, so record 0 is dead space', () => {
    const data = build({ lengths: [4, 0, 6], records: [[2, 0x30, 0, 1], [0, 0, 0, 0], [3, 0x2a, 4, 1]] })
    // instrument 1's fields are $48 + 30 = $66, which is where the reading
    // of DME's own example put them
    expect(SFX_RECORDS_AT + SFX_RECORD_BYTES).toBe(0x66)
    const song = parseSfx(data)!
    expect(song.samples[0]!.oneShotWords).toBe(2)
    expect(song.samples[0]!.volume).toBe(0x30)
    expect(song.samples[2]!.volume).toBe(0x2a)
    expect(song.samples[2]!.repeatStart).toBe(4)
  })

  it('lays the samples end to end after the patterns, in table order', () => {
    const song = parseSfx(build({ lengths: [4, 0, 6] }))!
    expect(song.samples[0]!.pcm.length).toBe(4)
    expect(song.samples[1]!.pcm.length).toBe(0)
    expect(song.samples[2]!.pcm.length).toBe(6)
    // sample 1 is 0x10 + 0 and sample 3 is 0x10 + 2, so the second's bytes
    // start where the first's stop
    expect([...song.samples[0]!.pcm]).toEqual([0x10, 0x10, 0x10, 0x10])
    expect([...song.samples[2]!.pcm]).toEqual([0x12, 0x12, 0x12, 0x12, 0x12, 0x12])
  })

  it('stores the module\'s own CIA divisor and the library never reads it back', () => {
    // $2105bc writes $210b02 and a scan of the relocated image finds no other
    // reference. Every module plays at 1,775,101 / 125
    expect(parseSfx(build())!.delay).toBe(0x38a4)
  })
})

describe('the period table at $210b2e', () => {
  it('is 36 periods and then twelve more copies of the lowest', () => {
    expect(SFX_PERIODS).toHaveLength(48)
    expect(SFX_PERIODS[0]).toBe(856)
    expect(SFX_PERIODS[35]).toBe(113)
    expect(SFX_PERIODS.slice(36)).toEqual(new Array(12).fill(113))
  })

  it('descends, which is what makes command 7 raise the period and lower the note', () => {
    for (let i = 1; i < 36; i++) expect(SFX_PERIODS[i]!).toBeLessThan(SFX_PERIODS[i - 1]!)
  })
})

describe('the row, at $21083a', () => {
  const one = build({
    lengths: [8],
    records: [[4, 0x40, 0, 1]],
    rows: [{ pattern: 0, row: 0, channel: 0, event: ev(428, 1) }],
  })

  it('comes round every sixth tick, and the five between it run the commands', () => {
    const { fx, audio } = player(one)
    for (let i = 0; i < 5; i++) fx.tick()
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(0)
    fx.tick()
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(1)
  })

  it('plays the instrument at the row\'s period', () => {
    const { fx, audio } = player(one)
    rows(fx, 1)
    const play = audio.events.find((e) => e.kind === 'play')!
    expect(play.voice).toBe(0)
    // 3,546,895 / 428
    expect(Math.round(play.freq!)).toBe(8287)
  })

  it('hands the one-shot length from the record and NOT the sample length', () => {
    // AUDxLEN is the record's +$16 in words. Here that is 4 words of an
    // 8-byte sample, so the DMA plays it all and then relatches on the repeat
    const { audio } = (() => {
      const p = player(one)
      rows(p.fx, 1)
      return p
    })()
    const play = audio.events.find((e) => e.kind === 'play')!
    expect(play.length).toBe(8)
    expect(play.loopStart).toBe(0)
    expect(play.loopEnd).toBe(2)
  })

  it('a looped instrument gets its repeat region, which begins where the one-shot ends', () => {
    const looped = build({
      lengths: [16],
      // one-shot 4 words = 8 bytes, repeat from byte 8 for 4 words
      records: [[4, 0x40, 8, 4]],
      rows: [{ pattern: 0, row: 0, channel: 0, event: ev(428, 1) }],
    })
    const { fx, audio } = player(looped)
    rows(fx, 1)
    const play = audio.events.find((e) => e.kind === 'play')!
    expect(play.loopStart).toBe(8)
    expect(play.loopEnd).toBe(16)
  })

  it('period 0 is no note at all, and leaves the voice running', () => {
    const quiet = build({ lengths: [8], rows: [{ pattern: 0, row: 0, channel: 0, event: ev(0, 0) }] })
    const { fx, audio } = player(quiet)
    rows(fx, 1)
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(0)
  })

  it('$fffe is a note off: volume zero and no new sample', () => {
    const off = build({
      lengths: [8],
      rows: [
        { pattern: 0, row: 0, channel: 0, event: ev(428, 1) },
        { pattern: 0, row: 1, channel: 0, event: ev(0xfffe) },
      ],
    })
    const { fx, audio } = player(off)
    rows(fx, 2)
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(1)
    expect(audio.events.filter((e) => e.kind === 'volume' && e.volume === 0)).not.toHaveLength(0)
  })

  it('$fffd holds the note AND clears the command, which `clr.w $2(a6)` does', () => {
    const hold = build({
      lengths: [8],
      rows: [
        // command 2, a pitch bend, then a hold row that cancels it
        { pattern: 0, row: 0, channel: 0, event: ev(428, 1, 2, 0x10) },
        { pattern: 0, row: 1, channel: 0, event: ev(0xfffd) },
      ],
    })
    const { fx } = player(hold)
    rows(fx, 1)
    for (let i = 0; i < 5; i++) fx.tick()
    // the bend ran on five ticks of row 0, one step each
    expect(fx.channels[0]!.period).toBe(428 + 5)
    rows(fx, 1)
    expect(fx.channels[0]!.command).toBe(0)
    expect(fx.channels[0]!.param).toBe(0)
  })

  it('wraps at the song length and raises the end flag, which the read clears', () => {
    const short = build({ sequence: [0], length: 1, lengths: [8] })
    const { fx } = player(short)
    rows(fx, 64)
    expect(fx.pos).toBe(0)
    expect(fx.readEnd()).toBe(true)
    expect(fx.readEnd()).toBe(false)
  })
})

describe('the commands', () => {
  const withCommand = (command: number, param: number, period = 428): Uint8Array =>
    build({
      lengths: [8],
      records: [[4, 0x20, 0, 1]],
      rows: [{ pattern: 0, row: 0, channel: 0, event: ev(period, 1, command, param) }],
    })

  it('5 and 6 move the instrument\'s own volume, and both clamp', () => {
    const up = player(withCommand(5, 0x30))
    rows(up.fx, 1)
    expect(up.fx.vu[0]).toBe(0x40)
    const down = player(withCommand(6, 0x30))
    rows(down.fx, 1)
    expect(down.fx.vu[0]).toBe(0)
  })

  it('1 is an arpeggio that reads base, x, y, base, y, x --- not ProTracker\'s order', () => {
    // 428 is index 12. +1 is 404 and +2 is 381
    const { fx, audio } = player(withCommand(1, 0x21))
    rows(fx, 1)
    audio.events.length = 0
    const seen: number[] = []
    for (let i = 0; i < 5; i++) {
      fx.tick()
      const f = audio.events.filter((e) => e.kind === 'freq').pop()
      seen.push(Math.round(3546895 / f!.freq!))
      audio.events.length = 0
    }
    // ticks 1..5, and the row tick itself is the base
    expect(seen).toEqual([381, 404, 428, 404, 381])
  })

  it('2 bends the period by the high nibble up, else the low nibble down', () => {
    const up = player(withCommand(2, 0x30))
    rows(up.fx, 1)
    for (let i = 0; i < 5; i++) up.fx.tick()
    expect(up.fx.channels[0]!.period).toBe(428 + 15)
    const down = player(withCommand(2, 0x03))
    rows(down.fx, 1)
    for (let i = 0; i < 5; i++) down.fx.tick()
    expect(down.fx.channels[0]!.period).toBe(428 - 15)
  })

  it('7 slides the period UP toward a lower note, and stops on the target', () => {
    // low nibble 2 a tick, high nibble 1 semitone: 428 toward 453
    const { fx } = player(withCommand(7, 0x12))
    rows(fx, 1)
    for (let i = 0; i < 5; i++) fx.tick()
    expect(fx.channels[0]!.slideTo).toBe(453)
    // the tick that sets a slide up does not also step it ($210748 returns),
    // so four of the five ticks moved it
    expect(fx.channels[0]!.slideNow).toBe(436)
    for (let i = 0; i < 20; i++) fx.tick()
    expect(fx.channels[0]!.slideNow).toBe(453)
  })

  it('8 slides the other way, and clamps the same', () => {
    const { fx } = player(withCommand(8, 0x12))
    rows(fx, 1)
    for (let i = 0; i < 40; i++) fx.tick()
    expect(fx.channels[0]!.slideTo).toBe(404)
    expect(fx.channels[0]!.slideNow).toBe(404)
  })

  it('a period the table does not hold makes the slide arrive at once', () => {
    // $210794: the search hits $ffff and the target becomes the period itself
    const { fx } = player(withCommand(7, 0x12, 429))
    rows(fx, 1)
    fx.tick()
    expect(fx.channels[0]!.slideTo).toBe(429)
  })
})

describe('the library\'s own bugs, reproduced', () => {
  it('a note that scales to volume zero silences ALL FOUR voices', () => {
    // $2103b0 tests the scaled volume and clears $dff0a8, $b8, $c8 and $d8
    const data = build({
      lengths: [8, 8],
      records: [[4, 0x40, 0, 1], [4, 0, 0, 1]],
      rows: [
        { pattern: 0, row: 0, channel: 0, event: ev(428, 1) },
        // channel 1 plays instrument 2, whose volume is zero
        { pattern: 0, row: 1, channel: 1, event: ev(428, 2) },
      ],
    })
    const { fx, audio } = player(data)
    rows(fx, 1)
    audio.events.length = 0
    rows(fx, 1)
    const zeroed = audio.events.filter((e) => e.kind === 'volume' && e.volume === 0).map((e) => e.voice)
    expect(new Set(zeroed)).toEqual(new Set([0, 1, 2, 3]))
  })

  it('and a master of zero makes every note do it', () => {
    const data = build({
      lengths: [8],
      rows: [{ pattern: 0, row: 0, channel: 0, event: ev(428, 1) }],
    })
    const { fx, audio } = player(data)
    fx.master = 0
    rows(fx, 1)
    const zeroed = audio.events.filter((e) => e.kind === 'volume' && e.volume === 0).map((e) => e.voice)
    expect(new Set(zeroed)).toEqual(new Set([0, 1, 2, 3]))
  })

  it('an unlooped sample repeats its own first word, because the clear at $21061e is dead', () => {
    // `cmpa.l $210b0a.l,a1 / bge` with $210b0a never written --- so the two
    // bytes the loop lands on are the composer's, not zeroes
    const data = build({
      lengths: [8],
      records: [[4, 0x40, 0, 1]],
      rows: [{ pattern: 0, row: 0, channel: 0, event: ev(428, 1) }],
      sample: () => 0x7f,
    })
    const { fx, audio } = player(data)
    rows(fx, 1)
    const play = audio.events.find((e) => e.kind === 'play')!
    expect(play.loopStart).toBe(0)
    expect(play.loopEnd).toBe(2)
    expect([...audio.voiceState[0]!.pcm!.subarray(0, 2)]).toEqual([0x7f, 0x7f])
  })
})

describe('the play flags', () => {
  const data = build({ lengths: [8], rows: [{ pattern: 0, row: 0, channel: 0, event: ev(428, 1) }] })

  it('a stopped replayer walks the loop and reads no pattern, so the position holds', () => {
    const { fx } = player(data)
    fx.stop()
    rows(fx, 200)
    expect(fx.pos).toBe(0)
    expect(fx.rowOffset).toBe(0)
  })

  it('Cont puts the saved master back and does not move the position', () => {
    const { fx } = player(data)
    fx.master = 0x20
    rows(fx, 3)
    const where = fx.rowOffset
    fx.stop()
    fx.cont()
    expect(fx.master).toBe(0x20)
    expect(fx.rowOffset).toBe(where)
  })

  it('Stop leaves 64 behind when the master was zero, and Cont undoes it', () => {
    const { fx } = player(data)
    fx.master = 0
    fx.stop()
    expect(fx.master).toBe(0x40)
    fx.cont()
    expect(fx.master).toBe(0)
  })

  it('Next Patt and Prev Patt wrap, and Next does NOT raise the end flag', () => {
    const { fx } = player(build({ sequence: [0, 1, 2], length: 3, lengths: [8] }))
    expect(fx.nextPattern()).toBe(1)
    expect(fx.nextPattern()).toBe(2)
    expect(fx.nextPattern()).toBe(0)
    expect(fx.readEnd()).toBe(false)
    expect(fx.prevPattern()).toBe(2)
  })
})

const bank = exampleBank()

describeWith('bank 3 of SoundFX13_Example.amos', bank, (data) => {
  const song = parseSfx(data)!

  it('is 35,900 bytes with "SONG" at $3c and 16 positions over 10 patterns', () => {
    expect(data.length).toBe(35900)
    expect(song.length).toBe(16)
    expect(song.patterns).toBe(10)
    expect([...song.sequence.subarray(0, 16)]).toEqual([0, 1, 2, 3, 4, 6, 5, 7, 8, 9, 6, 5, 7, 3, 4, 7])
  })

  it('accounts for every byte of the file: header, patterns, samples', () => {
    const total = song.samples.reduce((a, s) => a + s.pcm.length, 0)
    // 660 + 10 x $400 + the samples, and the bank is eight bytes longer
    expect(SFX_PATTERNS_AT + song.patterns * SFX_PATTERN_BYTES + total).toBe(35892)
  })

  it('names three instruments and leaves twelve empty', () => {
    const named = song.samples.map((s, i) => [i + 1, s.name] as const).filter(([, n]) => n !== '')
    expect(named).toEqual([[1, 'BrassEns.1'], [3, 'Janet'], [5, 'moog1']])
    expect(song.samples.filter((s) => s.pcm.length > 0)).toHaveLength(3)
  })

  it('proves the one-shot word is the repeat start halved, on the two looped ones', () => {
    for (const n of [3, 5]) {
      const s = song.samples[n - 1]!
      expect(s.repeatStart).toBe(s.oneShotWords * 2)
      expect(s.repeatWords).toBeGreaterThan(1)
    }
    // and the unlooped one is the whole sample in words, less one
    const first = song.samples[0]!
    expect(first.oneShotWords).toBe(first.pcm.length / 2 - 1)
    expect(first.repeatStart).toBe(0)
    expect(first.repeatWords).toBe(1)
  })

  it('plays: 3,000 ticks name every instrument the module uses and never a missing one', () => {
    const audio = new NullAudio()
    const fx = new SoundFx(() => audio)
    fx.load(song)
    for (let i = 0; i < 3000; i++) fx.tick()
    const played = audio.events.filter((e) => e.kind === 'play')
    expect(played.length).toBeGreaterThan(100)
    expect(played.every((e) => e.length! > 0)).toBe(true)
    // 500 rows at six ticks is 7.8 patterns, so the position has moved on
    expect(fx.pos).toBeGreaterThan(0)
  })
})
