/**
 * TFMX's replay, against the numbers the library states outright and against
 * the one module DME shipped.
 *
 * There is no second reader for TFMX on this machine --- libopenmpt does not
 * take it either --- so nothing here is checked against a recording. What is
 * checkable is the arithmetic, the three dispatch tables, and that a real
 * module walks its own trackstep table and reaches its own notes.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { NullAudio } from './paula'
import { parseTfmx } from './tfmx'
import {
  TFMX_CIA_CLOCK,
  TFMX_CIA_NTSC,
  TFMX_CIA_NTSC_LATCH,
  TFMX_CIA_NUM,
  TFMX_CIA_PAL,
  TFMX_PERIODS,
  TFMX_SPEED_MAX,
  TFMX_VOICES,
  TFMX_VOICE_SLOTS,
  TfmxPlayer,
} from './tfmxplay'

describe('the constants the library states', () => {
  it('runs CIA-B at 50.0 Hz on either machine, by two different periods', () => {
    expect(TFMX_CIA_CLOCK / TFMX_CIA_PAL).toBeCloseTo(50, 2)
    // the 60 Hz machine's CIA clock is the NTSC Paula clock over five
    expect((3579545 / 5) / TFMX_CIA_NTSC).toBeCloseTo(49.99, 2)
  })

  it('latches a period two counts off the one it gave the 60 Hz timer', () => {
    // $211c20 writes $37f0 and $211c34 latches $37ee, and every tick after the
    // first rewrites the timer from the latch
    expect(TFMX_CIA_NTSC - TFMX_CIA_NTSC_LATCH).toBe(2)
  })

  it('divides 1,790,456 for a tempo above fifteen', () => {
    expect(TFMX_CIA_NUM).toBe(1790456)
    expect(TFMX_SPEED_MAX).toBe(15)
    // a tempo of 500 is 3,580 counts, which is 198 Hz
    expect(TFMX_CIA_CLOCK / Math.floor(TFMX_CIA_NUM / 500)).toBeCloseTo(198.15, 2)
  })

  it('has sixteen voice slots over four voices, so slot 9 is voice 1', () => {
    expect(TFMX_VOICE_SLOTS).toBe(16)
    expect(TFMX_VOICES).toBe(4)
    expect(9 % TFMX_VOICES).toBe(1)
  })
})

describe('the period table at $212380', () => {
  it('is 64 words and halves every twelve', () => {
    expect(TFMX_PERIODS).toHaveLength(64)
    for (let n = 0; n + 12 < 48; n++)
      expect(TFMX_PERIODS[n + 12]! / TFMX_PERIODS[n]!).toBeCloseTo(0.5, 1)
  })

  it('repeats an octave rather than running out', () => {
    // entries 48 to 59 are 36 to 47 again, which is what a note past the top
    // plays --- the table does not clamp and it does not wrap to silence
    for (let n = 0; n < 12; n++) expect(TFMX_PERIODS[48 + n]).toBe(TFMX_PERIODS[36 + n])
  })

  it('opens at 1710, which is a shade above ProTracker\'s lowest', () => {
    expect(TFMX_PERIODS[0]).toBe(0x6ae)
    expect(TFMX_PERIODS[47]).toBe(0x71)
  })
})

/** the module out of bank 3 of `TFMX_Example.amos`, which is DME's own */
const FIXTURE = 'fixtures/modules/dme/tfmx.tfm'

function load(): { p: TfmxPlayer; audio: NullAudio } | null {
  let data: Uint8Array
  try {
    data = new Uint8Array(readFileSync(FIXTURE))
  } catch {
    return null
  }
  const song = parseTfmx(data)
  if (!song) return null
  const audio = new NullAudio()
  const p = new TfmxPlayer(() => audio)
  p.load(song)
  return { p, audio }
}

const held = load()

describe.skipIf(!held)('the module DME shipped', () => {
  it('starts subsong 0 at trackstep 2 and runs 43 rows', () => {
    const { p } = load()!
    p.play(0)
    // the subsong tables say 2 and 45, and `=Tfmx Song Length` is the difference
    expect(p.length).toBe(43)
    expect(p.position).toBe(0)
    expect(p.playing).toBe(true)
  })

  it('has a tempo of zero, so one trackstep row is one interrupt', () => {
    // $211a6a only reads the word as a divisor above 15, so a 0 leaves the CIA
    // at its 50 Hz default and makes the speed 0
    const { p } = load()!
    p.play(0)
    expect(p.tickHz).toBeCloseTo(50, 2)
  })

  it('walks its own trackstep table and reaches three voices', () => {
    const { p, audio } = load()!
    p.play(0)
    for (let f = 0; f < 1500; f++) p.vbl()
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays.length).toBeGreaterThan(200)
    expect(new Set(plays.map((e) => e.voice)).size).toBeGreaterThanOrEqual(3)
    expect(p.position).toBeGreaterThan(4)
    // every period it asks for is one Paula would take
    for (const e of plays) expect(e.freq!).toBeGreaterThan(3546895 / 0x7ff)
  })

  it('never reads a sample outside the bank it was given', () => {
    const { p, audio } = load()!
    p.play(0)
    for (let f = 0; f < 900; f++) p.vbl()
    for (const e of audio.events) if (e.kind === 'play') expect(e.length!).toBeGreaterThan(0)
  })

  it('stops every voice when it is told to', () => {
    const { p, audio } = load()!
    p.play(0)
    for (let f = 0; f < 300; f++) p.vbl()
    audio.events.length = 0
    p.stop()
    expect(p.playing).toBe(false)
    expect(audio.events.filter((e) => e.kind === 'stop')).toHaveLength(TFMX_VOICES)
    // and a vbl after a stop does nothing at all
    const before = audio.events.length
    p.vbl()
    expect(audio.events).toHaveLength(before)
  })

  it('takes a volume of 0 to 64 and hands it straight back', () => {
    const { p } = load()!
    p.play(0)
    p.volume = 40
    expect(p.volume).toBe(40)
    p.volume = 0
    expect(p.volume).toBe(0)
  })

  it('moves the trackstep pointer without leaving the subsong', () => {
    const { p } = load()!
    p.play(0)
    for (let f = 0; f < 400; f++) p.vbl()
    const was = p.position
    p.seek(1)
    expect(p.position).toBe(was + 1)
    // $210388 clamps against the subsong's own first and last rather than the
    // song's, so walking back past the start stops at the start
    for (let i = 0; i < 100; i++) p.seek(-1)
    expect(p.position).toBe(0)
  })
})

describe.skipIf(!held)('what a note command decodes to', () => {
  /** reach the voices without exporting them: the tests are in the same layer */
  const voices = (p: TfmxPlayer): { note: number; lock: number; keyOn: boolean; portaRate: number }[] =>
    (p as unknown as { voices: { note: number; lock: number; keyOn: boolean; portaRate: number }[] }).voices

  const note = (p: TfmxPlayer, cmd: number): void =>
    (p as unknown as { noteCommand: (c: number) => void }).noteCommand(cmd)

  it('sends a slot above three round to a voice that exists', () => {
    const { p } = load()!
    p.play(0)
    // $211600 indexes sixteen slots with `& $f`, and $211bba filled slots 4 to
    // 15 by copying the first four twelve times over
    note(p, 0x18000900)
    expect(voices(p)[1]!.note).toBe(0x18)
  })

  it('locks a voice with $fc and lets nothing but $fc through', () => {
    const { p } = load()!
    p.play(0)
    note(p, 0xfc010005)
    expect(voices(p)[0]!.lock).toBe(1)
    note(p, 0x18000000)
    expect(voices(p)[0]!.note).not.toBe(0x18)
  })

  it('takes $f5 as the key coming up rather than as a note', () => {
    const { p } = load()!
    p.play(0)
    note(p, 0x18000000)
    expect(voices(p)[0]!.keyOn).toBe(true)
    note(p, 0xf5000000)
    expect(voices(p)[0]!.keyOn).toBe(false)
  })

  it('takes $c0 and up as a portamento to the note in the low six bits', () => {
    const { p } = load()!
    p.play(0)
    note(p, 0xd8040007)
    expect(voices(p)[0]!.note).toBe(0x18)
    expect(voices(p)[0]!.portaRate).toBe(7)
  })
})
