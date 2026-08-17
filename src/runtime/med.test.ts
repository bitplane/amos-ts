import { describe, expect, it } from 'vitest'
import { describeIf } from '../testing/fixture'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadHunks } from '../amiga/hunk'
import { NullAudio, PAULA_CLOCK_NTSC, PAULA_CLOCK_PAL, periodToHz } from '../amiga/paula'
import { PaulaMixer } from '../amiga/mixer'
import { MED_SINUS, MedPlayer, medPeriod, medTickHz, medTimer } from './med'

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

/**
 * The one place this port can be checked against medplayer.library itself
 * rather than against a reading of it. The binary is not redistributable, so
 * these skip when it is absent, which is every machine but this one.
 *
 * Copy it out of the corpus with
 *   ../amos-files/sources/amos-pd-library-cd-1994/files/Library2.0/MEDPLAYER.library
 */
const LIB = join(__dirname, '../../fixtures/libs/medplayer/medplayer-1f2ca57f.library')

describe.skipIf(!existsSync(LIB))('against medplayer.library itself', () => {
  const image = ((): { at: (a: number) => number } => {
    if (!existsSync(LIB)) return { at: () => 0 }
    const l = loadHunks(readFileSync(LIB))
    return { at: (a: number) => (l.image[a - l.base]! << 8) | l.image[a - l.base + 1]! }
  })()
  /** the sixteen finetuned period tables, 96 words apiece */
  const period = (fine: number, note: number): number => image.at(0x212088 + fine * 0xc0 + note * 2)
  /**
   * Where each row is entered. $121c(a6) is the middle of a sixteen-long array
   * because $21035c indexes it with a SIGNED finetune, so -8 through -1 are
   * the eight longs below it and are rows 8 through 15.
   */
  const rowPtr = (fine: number): number =>
    (image.at(0x212ca8 + fine * 4) << 16) | image.at(0x212ca8 + fine * 4 + 2)

  it('derives every one of row 0_s 96 words', () => {
    const off = []
    for (let k = 0; k < 96; k++) if (medPeriod(k - 24, 0) !== period(0, k)) off.push(k)
    expect(off).toEqual([])
  })

  it('starts a sampled note 24 words in, which is where $212c88 points', () => {
    // sixteen rows of $212088 + 48 + row * 192, and a negative finetune is the
    // top half of the table, which is what `finetune & 0xf` comes to
    for (let f = -8; f < 8; f++) expect(rowPtr(f)).toBe(0x212088 + 48 + (f & 0xf) * 192)
    expect(medPeriod(0, 0)).toBe(856) // ProTracker's C-1, for anything sampled
    expect(medPeriod(-24, 0)).toBe(3424) // and what a pure synth reads there
  })

  it('holds the top octave three more times, which is what a high note lands in', () => {
    for (let k = 60; k < 96; k++) expect(period(0, k)).toBe(period(0, 48 + ((k - 60) % 12)))
  })

  it('is within 13 counts on the fifteen finetunes it derives instead', () => {
    let worst = 0
    for (let f = 1; f < 16; f++) {
      for (let k = 0; k < 96; k++) worst = Math.max(worst, Math.abs(medPeriod(k - 24, f) - period(f, k)))
    }
    // 0.45% at the extreme, about eight cents; the DEVIATION in med.ts
    expect(worst).toBe(13)
  })

  it('carries the vibrato table at $21087a byte for byte', () => {
    const b = (i: number): number => (image.at(0x21087a + (i & ~1)) >> (i % 2 === 0 ? 8 : 0)) & 0xff
    const lib = [...Array(32)].map((_, i) => (b(i) << 24) >> 24)
    expect([...MED_SINUS]).toEqual(lib)
    expect(lib[8]).toBe(127)
    expect(lib[24]).toBe(-127)
  })

  it('reads the tempo table at $2111e0 out of the same image', () => {
    const lib = [...Array(10)].map((_, i) => image.at(0x2111e0 + i * 2))
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => medTimer(t, false, 4))).toEqual(lib)
  })
})

/**
 * A one-block MMD0 built to order, so a command can be aimed at a single
 * track and the sink read back. `rows` is one entry per line, each `[note,
 * instrument, command, data]` on track 0.
 */
function mmd0(rows: number[][], song: Partial<Record<'flags' | 'flags2' | 'tempo2' | 'deftempo', number>> = {}): Uint8Array {
  const SONG = 0x40
  const BLOCKARR = SONG + 0x340
  const SMPLARR = BLOCKARR + 4
  const BLOCK = SMPLARR + 4
  const rowBytes = 3
  const SAMPLE = BLOCK + 2 + rows.length * rowBytes
  const d = new Uint8Array(SAMPLE + 6 + 64)
  const w = (o: number, n: number): void => { d[o] = (n >> 8) & 0xff; d[o + 1] = n & 0xff }
  const l = (o: number, n: number): void => { w(o, (n >>> 16) & 0xffff); w(o + 2, n & 0xffff) }
  d.set([0x4d, 0x4d, 0x44, 0x30]) // MMD0
  l(8, SONG)
  l(0x10, BLOCKARR)
  l(0x18, SMPLARR)
  // instrument 1: no loop, full volume, no transpose
  d[SONG + 6] = 64
  w(SONG + 504, 1) // numblocks
  w(SONG + 506, 1) // songlen
  d[SONG + 508] = 0 // playseq[0] -> block 0
  // tempo 1 is 293.5 Hz, so one vbl is 5.87 ticks and a test can see a
  // handler run several times without driving 50 frames to do it
  w(SONG + 0x2fc, song.deftempo ?? 1)
  d[SONG + 0x2ff] = song.flags ?? 0
  d[SONG + 0x300] = song.flags2 ?? 0
  d[SONG + 0x301] = song.tempo2 ?? 6
  for (let t = 0; t < 16; t++) d[SONG + 0x302 + t] = 64
  d[SONG + 0x312] = 64
  l(BLOCKARR, BLOCK)
  l(SMPLARR, SAMPLE)
  d[BLOCK] = 1 // one track
  d[BLOCK + 1] = rows.length - 1 // lines, less one
  rows.forEach(([note, instr, cmd, data], i) => {
    const o = BLOCK + 2 + i * rowBytes
    d[o] = (note! & 0x3f) | ((instr! & 0x30) << 2)
    d[o + 1] = ((instr! & 0xf) << 4) | (cmd! & 0xf)
    d[o + 2] = data!
  })
  l(SAMPLE, 64) // length
  return d
}

function playing(mod: Uint8Array): { p: MedPlayer; audio: NullAudio } {
  const audio = new NullAudio()
  // runtime.ts increments the frame counter before the replayers run, so
  // `tick()` is the number of the frame being played. The player reads it once
  // per vbl and nowhere else, so counting the calls is the same number, and a
  // second reader would show up as time jumping rather than as a silent pass.
  let frame = 0
  const p = new MedPlayer({
    audio,
    tick: () => ++frame,
    getBank: () => ({ name: 'Med', data: mod }),
  })
  p.play(7, 0)
  return { p, audio }
}

/** the effect set, checked one command at a time against its handler */
describe('the MED effect commands', () => {
  const NOTE = 25 // an octave that leaves room to slide either way

  it('arpeggios low, high, base, where ProTracker runs base, high, low', () => {
    const { p, audio } = playing(mmd0([[NOTE, 1, 0x0, 0x34]]))
    p.vbl()
    const freqs = audio.events.filter((e) => e.kind === 'freq').map((e) => e.freq!)
    const at = (semitones: number): number => periodToHz(medPeriod(NOTE - 1 + semitones, 0))
    // $210e52 takes the tick number mod 3: 0 is the low nibble, 1 the high,
    // 2 the base. Tick 0 is a row tick, so the first three heard are 0, 1, 2.
    expect(freqs.slice(0, 3)).toEqual([at(4), at(3), at(0)])
  })

  it('slides the volume DOWN by the whole byte when the high nibble is zero', () => {
    // $210f76, which is the one handler behind both A and D
    for (const cmd of [0xa, 0xd]) {
      const { p, audio } = playing(mmd0([[NOTE, 1, cmd, 0x05]]))
      p.vbl()
      const vols = audio.events.filter((e) => e.kind === 'volume').map((e) => e.volume)
      expect(vols[0]).toBe(59)
      expect(vols[1]).toBe(54)
    }
  })

  it('slides UP by the high nibble, ignoring the low one entirely', () => {
    // C20 first, because a note starts at 64 and there is nowhere up to go
    const { p, audio } = playing(mmd0([[NOTE, 1, 0xc, 0x20], [0, 0, 0xa, 0x27]], { tempo2: 8 }))
    for (let i = 0; i < 2; i++) p.vbl()
    const vols = audio.events.filter((e) => e.kind === 'volume').map((e) => e.volume)
    // the note itself already sounds at 20, so the first event is the slide
    expect(audio.events.find((e) => e.kind === 'play')?.volume).toBe(20)
    expect(vols.slice(0, 3)).toEqual([22, 24, 26])
  })

  it('reads C as decimal unless the song flags say hex ($210ae4)', () => {
    const dec = playing(mmd0([[NOTE, 1, 0xc, 0x40]]))
    expect(dec.audio.voiceState[0]!.volume).toBe(0)
    dec.p.vbl()
    expect(dec.audio.voiceState[0]!.volume).toBe(40)
    const hex = playing(mmd0([[NOTE, 1, 0xc, 0x40]], { flags: 0x10 }))
    hex.p.vbl()
    expect(hex.audio.voiceState[0]!.volume).toBe(64)
  })

  it('masks command 9 to five bits and reads zero as 32 ($210b2a)', () => {
    const { p } = playing(mmd0([[NOTE, 1, 0x9, 0x00]], { tempo2: 6 }))
    p.vbl()
    expect(p.hdrCounter).toBeLessThan(32)
    const { p: q } = playing(mmd0([[NOTE, 1, 0x9, 0x28]]))
    q.vbl()
    // $28 masks to 8, so the line lasts eight ticks and not forty
    expect(q.hdrCounter).toBeLessThan(8)
  })

  it('clamps a slide up at period 113 and lets a slide down run free', () => {
    const up = playing(mmd0([[59, 1, 0x1, 0x40]]))
    for (let i = 0; i < 20; i++) up.p.vbl()
    const freqs = up.audio.events.filter((e) => e.kind === 'freq').map((e) => e.freq!)
    expect(Math.max(...freqs)).toBeCloseTo(periodToHz(113), 5)
    // $210e26 has no upper clamp, so a long slide down passes 856 unhindered
    const down = playing(mmd0([[NOTE, 1, 0x2, 0x40]], { tempo2: 32 }))
    for (let i = 0; i < 20; i++) down.p.vbl()
    const low = down.audio.events.filter((e) => e.kind === 'freq').map((e) => e.freq!)
    expect(Math.min(...low)).toBeLessThan(periodToHz(856))
  })

  it('holds a note for the low nibble of command 8 and then decays it', () => {
    // $210b98 stores the decay high and the hold low, and $210d5c runs them
    const { p, audio } = playing(mmd0([[NOTE, 1, 0x8, 0x42], [0, 0, 0, 0]], { tempo2: 32 }))
    for (let i = 0; i < 5; i++) p.vbl()
    const vols = audio.events.filter((e) => e.kind === 'volume').map((e) => e.volume)
    expect(vols.length).toBeGreaterThan(0)
    expect(vols[vols.length - 1]).toBe(0)
  })

  it('sends the tremolo volume for one tick only ($211098)', () => {
    const { p, audio } = playing(mmd0([[NOTE, 1, 0x7, 0x84]], { tempo2: 32 }))
    for (let i = 0; i < 3; i++) p.vbl()
    const vols = audio.events.filter((e) => e.kind === 'volume').map((e) => e.volume ?? -1)
    // the volume moves away from 64 and comes back, rather than staying put
    expect(new Set(vols).size).toBeGreaterThan(1)
    expect(Math.max(...vols)).toBeLessThanOrEqual(64)
    expect(Math.min(...vols)).toBeGreaterThanOrEqual(0)
  })

  it('does not restart the sample under a portamento', () => {
    const { p, audio } = playing(mmd0([[NOTE, 1, 0x0, 0x00], [NOTE + 5, 0, 0x3, 0x08]], { tempo2: 8 }))
    for (let i = 0; i < 2; i++) p.vbl()
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(1)
  })

  it('skips the row tick on a slide when the song asks for ST timing', () => {
    const plain = playing(mmd0([[NOTE, 1, 0x2, 0x10]]))
    plain.p.vbl()
    const st = playing(mmd0([[NOTE, 1, 0x2, 0x10]], { flags: 0x20 }))
    st.p.vbl()
    const freqOf = (a: NullAudio): number[] => a.events.filter((e) => e.kind === 'freq').map((e) => e.freq!)
    // one fewer step, because $210e2a skips the tick the row plays on
    expect(freqOf(plain.audio).length).toBe(freqOf(st.audio).length + 1)
  })
})

/**
 * A synthsound instrument, which carries no sample at all: two byte scripts
 * and a handful of short waveforms, and the interpreters at $2105d6 turn them
 * into a voice.
 */
interface Syn {
  vol: number[]
  wf: number[]
  waves: number[][]
  volspeed?: number
  wfspeed?: number
  /** type $fffe, where waveforms[0] is a sampled header instead */
  hybrid?: boolean
}

function mmd0syn(rows: number[][], syn: Syn, song: Record<string, number> = {}): Uint8Array {
  const base = mmd0(rows, song)
  const SYN = base.length
  const WAVES = SYN + 0x216
  const sizes = syn.waves.map((w) => (syn.hybrid ? 6 : 2) + w.length)
  const d = new Uint8Array(WAVES + sizes.reduce((a, b) => a + b, 0))
  d.set(base)
  const w = (o: number, n: number): void => { d[o] = (n >> 8) & 0xff; d[o + 1] = n & 0xff }
  const l = (o: number, n: number): void => { w(o, (n >>> 16) & 0xffff); w(o + 2, n & 0xffff) }
  // smplarr[0] points at the SynthInstr rather than at a sample
  const SMPLARR = 0x40 + 0x340 + 4
  l(SMPLARR, SYN)
  w(SYN + 4, syn.hybrid ? 0xfffe : 0xffff)
  d[SYN + 0x12] = syn.volspeed ?? 1
  d[SYN + 0x13] = syn.wfspeed ?? 1
  w(SYN + 0x14, syn.waves.length) // wforms, which bounds the relocation loop
  syn.vol.forEach((b, i) => { d[SYN + 0x16 + i] = b })
  syn.wf.forEach((b, i) => { d[SYN + 0x96 + i] = b })
  let at = WAVES
  syn.waves.forEach((wave, i) => {
    // relative to the INSTRUMENT, which is what $212daa relocates them by
    l(SYN + 0x116 + i * 4, at - SYN)
    if (syn.hybrid) {
      l(at, wave.length) // a sample header: length, type, then the samples
      wave.forEach((b, k) => { d[at + 6 + k] = b & 0xff })
      at += 6 + wave.length
    } else {
      w(at, wave.length / 2) // a waveform header: the length in WORDS
      wave.forEach((b, k) => { d[at + 2 + k] = b & 0xff })
      at += 2 + wave.length
    }
  })
  return d
}

const RAMP = [...Array(32)].map((_, i) => i * 4 - 64)
const END = 0x8b // command B, which halts either list where it stands

describe('MED synthsounds', () => {
  const NOTE = 25

  it('sounds a waveform the list selects, and takes its volume from the other', () => {
    const { p, audio } = playing(mmd0syn([[NOTE, 1, 0, 0]], {
      vol: [40, END],
      wf: [0, END],
      waves: [RAMP],
    }))
    p.vbl()
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays).toHaveLength(1)
    expect(plays[0]!.length).toBe(32)
    expect(plays[0]!.loop).toBe(true)
    expect(audio.voiceState[0]!.volume).toBe(40)
  })

  it('swaps the waveform without restarting the voice ($210748)', () => {
    const { p, audio } = playing(mmd0syn([[NOTE, 1, 0, 0]], {
      vol: [40, END],
      wf: [0, 1, 0, 1, END],
      waves: [RAMP, RAMP.slice(0, 16)],
    }))
    p.vbl()
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(1)
    expect(audio.events.filter((e) => e.kind === 'waveform').length).toBeGreaterThanOrEqual(3)
    expect(audio.voiceState[0]!.pcm!.length).toBe(16)
  })

  it('walks an arpeggio run and loops back at the ARE ($2107a2)', () => {
    // ARP, the offsets 4 7 12, ARE, then halt. None of them is the note
    // itself, which the voice already sounds at.
    const { p, audio } = playing(mmd0syn([[NOTE, 1, 0, 0]], {
      vol: [40, END],
      wf: [0, 0x8c, 4, 7, 12, 0x8d, END],
      waves: [RAMP],
    }, { tempo2: 32 }))
    for (let i = 0; i < 2; i++) p.vbl()
    const at = (semi: number): number => periodToHz(medPeriod(NOTE - 1 + semi - 24, 0))
    const freqs = audio.events.filter((e) => e.kind === 'freq').map((e) => e.freq!)
    // the run repeats, so the first six heard are two turns of it
    expect(freqs.slice(0, 6)).toEqual([at(4), at(7), at(12), at(4), at(7), at(12)])
  })

  it('is an octave and a half below a sampled note at the same pitch', () => {
    // $210574 biases the period table by $30 bytes for a pure synth and
    // $210358 does not for a sample, so the same note number is not the
    // same note
    const s = playing(mmd0syn([[NOTE, 1, 0, 0]], { vol: [40, END], wf: [0, END], waves: [RAMP] }))
    s.p.vbl()
    const synth = s.audio.events.find((e) => e.kind === 'play')!.freq!
    const q = playing(mmd0([[NOTE, 1, 0, 0]]))
    q.p.vbl()
    const sample = q.audio.events.find((e) => e.kind === 'play')!.freq!
    expect(synth).toBeCloseTo(periodToHz(medPeriod(NOTE - 1 - 24, 0)), 5)
    expect(sample).toBeCloseTo(periodToHz(medPeriod(NOTE - 1, 0)), 5)
  })

  it('lets each list jump the other one ($2106b0 and $210804)', () => {
    // the waveform list picks a waveform then sends the volume list to 2,
    // where the volume is 7 rather than the 40 at 0
    const { p, audio } = playing(mmd0syn([[NOTE, 1, 0, 0]], {
      vol: [40, END, 7, END],
      wf: [0, 0x8a, 2, END],
      waves: [RAMP],
    }))
    for (let i = 0; i < 2; i++) p.vbl()
    expect(audio.voiceState[0]!.volume).toBe(7)
  })

  it('steps the volume with CHU and CHD, clamped to 0 and 64 ($2105f6)', () => {
    const { p, audio } = playing(mmd0syn([[NOTE, 1, 0, 0]], {
      vol: [0, 0x83, 10, END], // start at 0, then climb by ten a step
      wf: [0, END],
      waves: [RAMP],
    }, { tempo2: 32 }))
    for (let i = 0; i < 3; i++) p.vbl()
    const vols = audio.events.filter((e) => e.kind === 'volume').map((e) => e.volume ?? -1)
    expect(vols.slice(0, 3)).toEqual([10, 20, 30])
    expect(Math.max(...vols)).toBe(64)
  })

  it('runs a waveform as a volume envelope and stops after 128 bytes ($2106bc)', () => {
    const { p, audio } = playing(mmd0syn([[NOTE, 1, 0, 0]], {
      vol: [0x84, 0, END], // EN waveform 0
      wf: [0, END],
      waves: [RAMP],
    }, { tempo2: 32 }))
    p.vbl()
    const vols = audio.events.filter((e) => e.kind === 'volume').map((e) => e.volume ?? -1)
    // ((sample + 128) & 255) >> 2 over the ramp -8, -4, 0, 4 ...
    expect(vols.slice(0, 3)).toEqual([16, 17, 18])
  })

  it('overrides a volume slide, because the list writes $2(a5) every tick', () => {
    const { p, audio } = playing(mmd0syn([[NOTE, 1, 0xa, 0x05]], {
      vol: [40, END],
      wf: [0, END],
      waves: [RAMP],
    }, { tempo2: 32 }))
    for (let i = 0; i < 2; i++) p.vbl()
    expect(audio.voiceState[0]!.volume).toBe(40)
  })

  it('plays a hybrid from waveforms[0] and still runs its scripts ($210568)', () => {
    const { p, audio } = playing(mmd0syn([[NOTE, 1, 0, 0]], {
      vol: [33, END],
      wf: [END],
      waves: [RAMP],
      hybrid: true,
    }))
    p.vbl()
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays).toHaveLength(1)
    expect(plays[0]!.length).toBe(32)
    // the volume list still runs, so 33 and not the instrument's own 64
    expect(audio.voiceState[0]!.volume).toBe(33)
    // no $30 bias on a hybrid: it took the sampled path at $21033a
    expect(plays[0]!.freq).toBeCloseTo(periodToHz(medPeriod(NOTE - 1, 0)), 5)
  })

  it('starts the waveform list where command E on the row says ($2105c4)', () => {
    const { p, audio } = playing(mmd0syn([[NOTE, 1, 0xe, 0x02]], {
      vol: [40, END],
      wf: [0, END, 1, END],
      waves: [RAMP, RAMP.slice(0, 8)],
    }))
    p.vbl()
    expect(audio.events.find((e) => e.kind === 'play')!.length).toBe(8)
  })
})

/**
 * The CIA timer, as instants rather than as a rate.
 *
 * `MEDSetTempo` programs CIA-B timer A and the interrupt fires when it fires,
 * which is almost never on a frame boundary. What the player owes the sink is
 * the moment of each one, and `AudioSink.runTo` is where it says so.
 */
class Instants extends NullAudio {
  readonly at: number[] = []
  override runTo(t: number): void {
    this.at.push(t)
    super.runTo(t)
  }
}

function ticking(mod: Uint8Array): { p: MedPlayer; audio: Instants } {
  const audio = new Instants()
  let frame = 0
  const p = new MedPlayer({ audio, tick: () => ++frame, getBank: () => ({ name: 'Med', data: mod }) })
  p.play(7, 0)
  return { p, audio }
}

describe('the MED clock', () => {
  const NOTE = 25

  it('fires a CIA period apart, and not once a frame', () => {
    const { p, audio } = ticking(mmd0([[NOTE, 1, 0, 0]]))
    for (let i = 0; i < 3; i++) p.vbl()
    const gap = 1 / medTickHz(1, false, 4)
    for (let i = 1; i < audio.at.length; i++) {
      expect(audio.at[i]! - audio.at[i - 1]!).toBeCloseTo(gap, 12)
    }
    // 293.49 Hz over three frames of the 50Hz step
    expect(audio.at).toHaveLength(18)
    expect(audio.at[0]).toBe(0)
  })

  it('runs a tempo the frame cannot divide without dropping or gaining a tick', () => {
    // tempo 33 is 49.809 Hz, so twelve seconds of it is 598 interrupts. The
    // player that counted ticks into a frame ran 600, one per frame.
    const { p, audio } = ticking(mmd0([[NOTE, 1, 0, 0]], { deftempo: 33 }))
    for (let i = 0; i < 600; i++) p.vbl()
    expect(audio.at).toHaveLength(Math.floor(12 * medTickHz(33, false, 4)) + 1)
    expect(audio.at).toHaveLength(598)
  })

  it('keeps every instant inside the frame that ran it, and moving forward', () => {
    const { p, audio } = ticking(mmd0([[NOTE, 1, 0, 0]], { deftempo: 8 }))
    for (let i = 0; i < 20; i++) p.vbl()
    expect(audio.at[0]).toBe(0)
    expect(Math.max(...audio.at)).toBeLessThan(20 / 50)
    expect([...audio.at].sort((a, b) => a - b)).toEqual(audio.at)
  })
})

describe('a MED module as PCM', () => {
  it('renders sound, rather than a list of things the replayer asked for', () => {
    const mod = mmd0([[1, 1, 0xc, 0x40]])
    // the builder leaves the instrument silent; a ramp is something to hear
    for (let i = 0; i < 64; i++) mod[mod.length - 64 + i] = i * 2 - 64
    const out: number[] = []
    const mix = new PaulaMixer({ rate: 8000, filter: false, onBlock: (b) => out.push(...b) })
    let frame = 0
    const p = new MedPlayer({ audio: mix, tick: () => ++frame, getBank: () => ({ name: 'Med', data: mod }) })
    p.play(7, 0)
    for (let i = 0; i < 5; i++) {
      p.vbl()
      mix.runTo((i + 1) / 50) // what runtime.ts does at the end of a frame
    }
    expect(mix.frames).toBe(800)
    const left = out.filter((_, i) => i % 2 === 0)
    const right = out.filter((_, i) => i % 2 === 1)
    // track 0 is voice 0, which is wired to the left channel and to nothing
    // else, and C40 is volume 40 of 64 against a ramp that peaks at 62
    expect(right.every((s) => s === 0)).toBe(true)
    expect(Math.max(...left)).toBeCloseTo((62 / 128) * (40 / 64), 6)
    // the instrument has no repeat, and 64 bytes at 4143 Hz is 15.4ms against
    // a row that lasts 20.4ms, so a quarter of the output is it having ended.
    // The threshold is half of one sample byte at this volume, because the
    // fixed analog pole has an infinite tail and "not exactly zero" stopped
    // meaning "audible" the moment it was modelled.
    const floor = 1 / 128 / 2
    expect(left.filter((s) => Math.abs(s) > floor)).toHaveLength(610)
  })
})

/**
 * MMD2 and the octaplayer build, over DME_OctaMed.library.
 *
 * The module is built here because what is checked is the walk: section, then
 * play sequence, then block. `../amiga/mmd2.test.ts` reads the same layout off
 * three of OctaMED Professional 6's own files.
 */
function mmd2(opts: {
  /** one entry per section, each a list of block numbers */
  seqs: number[][]
  /** how wide each block is; its line count is always two */
  blocks?: number[]
  deftempo?: number
  flags?: number
}): Uint8Array {
  const d = new Uint8Array(0x2000)
  const w = (a: number, v: number): void => {
    d[a] = (v >> 8) & 0xff
    d[a + 1] = v & 0xff
  }
  const l = (a: number, v: number): void => {
    w(a, (v >>> 16) & 0xffff)
    w(a + 2, v & 0xffff)
  }
  const blocks = opts.blocks ?? [1]
  const SONG = 0x100
  const PSEQTAB = 0x500
  const SECTAB = 0x520
  const BLOCKARR = 0x540
  const SMPLARR = 0x560
  const SAMPLE = 0x580
  for (const [i, c] of [...'MMD2'].entries()) d[i] = c.charCodeAt(0)
  l(4, d.length)
  l(8, SONG)
  l(0x10, BLOCKARR)
  l(0x18, SMPLARR)

  w(SONG + 2, 16) // instrument 1 loops, so a note survives a whole buffer
  d[SONG + 6] = 64
  w(SONG + 0x1f8, blocks.length)
  w(SONG + 0x1fa, opts.seqs.length)
  l(SONG + 0x1fc, PSEQTAB)
  l(SONG + 0x200, SECTAB)
  w(SONG + 0x208, 8)
  w(SONG + 0x20a, opts.seqs.length)
  w(SONG + 0x2fc, opts.deftempo ?? 6)
  d[SONG + 0x2ff] = opts.flags ?? 0
  d[SONG + 0x301] = 1 // one tick a line, so a vbl is a line
  d[SONG + 0x312] = 64

  // each section runs the play sequence of the same number
  opts.seqs.forEach((seq, i) => {
    const at = 0x600 + i * 0x80
    l(PSEQTAB + i * 4, at)
    w(SECTAB + i * 2, i)
    w(at + 0x28, seq.length)
    seq.forEach((b, k) => w(at + 0x2a + k * 2, b))
  })
  blocks.forEach((tracks, i) => {
    const at = 0x800 + i * 0x100
    l(BLOCKARR + i * 4, at)
    w(at, tracks)
    w(at + 2, 1) // two lines
    // a note on every track of line 0, so a wide block is audibly wide
    for (let t = 0; t < tracks; t++) {
      d[at + 8 + t * 4] = 40 + i
      d[at + 9 + t * 4] = 1
    }
  })
  l(SMPLARR, SAMPLE)
  l(SAMPLE, 64)
  for (let i = 0; i < 64; i++) d[SAMPLE + 6 + i] = 50
  return d
}

function octa(mod: Uint8Array): { p: MedPlayer; audio: NullAudio } {
  const audio = new NullAudio()
  let frame = 0
  const p = new MedPlayer(
    { audio, tick: () => ++frame, getBank: () => ({ name: 'OctaMed ', data: mod }) },
    'octaplayer',
  )
  p.play(7, 0)
  return { p, audio }
}

describe('the MMD2 walk', () => {
  it('takes the block out of a play sequence the section table names', () => {
    const { p } = octa(mmd2({ seqs: [[2, 0, 1]], blocks: [1, 2, 3] }))
    expect(p.mmd2).toBe(true)
    expect(p.hdrPblock).toBe(2)
  })

  it('reads a play sequence length from the sequence, not from the song', () => {
    // $210ede's `cmp.w $28(a0),d4`, 40 bytes past a 32-character name
    const { p } = octa(mmd2({ seqs: [[0, 0], [0, 0, 0, 0]] }))
    for (let f = 0; f < 2; f++) p.vbl()
    expect(p.hdrPseqnum).toBe(1)
  })

  it('moves to the next SECTION when the play sequence runs out', () => {
    const { p } = octa(mmd2({ seqs: [[0], [1], [2]], blocks: [1, 2, 3] }))
    const seen: number[] = []
    for (let f = 0; f < 8; f++) {
      seen.push(p.hdrPblock)
      p.vbl()
      p.vbl()
    }
    // one block a section, two lines each, and three sections that wrap
    expect(seen.slice(0, 6)).toEqual([0, 1, 2, 0, 1, 2])
  })

  it('skips a play-sequence word with its top bit set', () => {
    // $210e1e's `bpl`, which sends a marker back round the walk
    const { p } = octa(mmd2({ seqs: [[0, 0x8000, 0x8001, 0]], blocks: [1, 2] }))
    for (let f = 0; f < 2; f++) p.vbl()
    expect(p.hdrPseqnum).toBe(3)
  })

  it('strides by the BLOCK\'s track count and not the song\'s', () => {
    // "Cuku's Dead" holds blocks four, five, six and seven wide in one song
    const { p, audio } = octa(mmd2({ seqs: [[0, 1]], blocks: [8, 2] }))
    p.vbl()
    expect(audio.voiceState.filter((v) => v.playing)).toHaveLength(4)
  })
})

describe('the octaplayer clock and mixer', () => {
  it('runs on the buffer length, so tempo 13 and tempo 33 are the same speed', () => {
    const a = octa(mmd2({ seqs: [[0]], deftempo: 13 }))
    const b = octa(mmd2({ seqs: [[0]], deftempo: 33 }))
    a.p.vbl()
    b.p.vbl()
    const len = (x: NullAudio): number => x.events.find((e) => e.kind === 'play')!.length!
    expect(len(a.audio)).toBe(400)
    expect(len(b.audio)).toBe(400)
  })

  it('doubles the buffer for FLAG_SLOWHQ and keeps the rate', () => {
    const { p, audio } = octa(mmd2({ seqs: [[0]], deftempo: 6, flags: 0x80 }))
    p.vbl()
    const e = audio.events.find((x) => x.kind === 'play')!
    expect([e.length, Math.round(e.freq!)]).toEqual([640, 15625])
  })

  it('adds the two tracks of a pair with no scaling', () => {
    const { p, audio } = octa(mmd2({ seqs: [[0]], blocks: [8] }))
    p.vbl()
    expect(audio.voiceState[0]!.pcm![0]).toBe(100)
  })

  it('takes the instrument volume whole, because trkvol and mastervol are dead', () => {
    // Neither $302 nor $312 appears anywhere in DME_OctaMed.library, and on an
    // MMD2 both belong to the MMD0 tail and hold zeroes. Scaling by them made
    // the whole render silent while every call-sequence test still passed.
    const { p, audio } = octa(mmd2({ seqs: [[0]], blocks: [8] }))
    p.vbl()
    expect(audio.voiceState[0]!.volume).toBe(64)
  })

  it('sounds four voices for eight tracks, and silence needs no buffer', () => {
    const { p, audio } = octa(mmd2({ seqs: [[0]], blocks: [8] }))
    p.vbl()
    expect(audio.voiceState.filter((v) => v.playing)).toHaveLength(4)
    p.stop()
    expect(audio.voiceState.filter((v) => v.playing)).toHaveLength(0)
  })
})

describe('Omed Next Patt and Omed Prev Patt, which are not mirrors', () => {
  it('forces the line to 63 going forward, whatever the block length', () => {
    const { p } = octa(mmd2({ seqs: [[0, 1]], blocks: [1, 1] }))
    p.octaNextPatt()
    expect(p.hdrPline).toBe(0x3f)
  })

  it('leaves the line alone going back from line zero', () => {
    // $210298 substitutes $3f for a zero line before the same subtraction
    const { p } = octa(mmd2({ seqs: [[0, 1]], blocks: [1, 1] }))
    p.octaPrevPatt()
    expect(p.hdrPline).toBe(0)
  })

  it('steps the SECTION on an MMD2 without moving the block', () => {
    // $21026c writes $c(a2) and leaves the cached $e(a2) alone, so the block
    // only changes at the next natural section boundary --- and skips one
    const { p } = octa(mmd2({ seqs: [[0], [1], [2]], blocks: [1, 2, 3] }))
    expect(p.hdrPblock).toBe(0)
    p.octaNextPatt()
    expect(p.hdrPblock).toBe(0)
  })
})

/**
 * "Little Fugue In G Minor", one of the 187 MMD2s OctaMED Professional 6
 * shipped, through the octaplayer build for four seconds of frames.
 *
 * Nothing here checks a waveform. What it checks is that the walk survives a
 * real file: nine blocks of 132 to 205 lines over six tracks, at a deftempo of
 * 13 that the buffer table flattens to its slowest entry.
 */
const FUGUE = 'fixtures/modules/dme/omed-fugue.mmd2'

describeIf('a real MMD2 through the mixer', existsSync(FUGUE), () => {
  const mod = new Uint8Array(readFileSync(FUGUE))

  it('fills every buffer at one length and one rate, and reaches four voices', () => {
    const { p, audio } = octa(mod)
    expect(p.mmd2).toBe(true)
    // the voices enter one at a time, which is what a fugue is, so this needs
    // a minute of frames before the fourth is heard from
    for (let f = 0; f < 3000; f++) p.vbl()
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays.length).toBeGreaterThan(1000)
    // deftempo 13 is past the table, so every buffer is the slowest: 400 bytes
    expect(new Set(plays.map((e) => e.length))).toEqual(new Set([400]))
    expect(new Set(plays.map((e) => Math.round(e.freq!)))).toEqual(new Set([15625]))
    expect(new Set(plays.map((e) => e.voice))).toEqual(new Set([0, 1, 2, 3]))
  })

  it('reaches the byte\'s limits without ever going over them', () => {
    // 710 of 3,424,000 output samples land on -128 or 127 over a minute of
    // this module, 0.02%. Every one is a real sum: instrumenting $210974's
    // bare `add.b` over the same run counts ZERO pairs outside a byte, which
    // is this author never asking two loud tracks to share a voice rather
    // than the mixer protecting him. It has no clamp to protect him with.
    const { p, audio } = octa(mod)
    let rail = 0
    let total = 0
    for (let f = 0; f < 3000; f++) {
      p.vbl()
      for (const v of audio.voiceState) {
        if (!v.playing || !v.pcm) continue
        for (const b of v.pcm) {
          total++
          if (b === -128 || b === 127) rail++
        }
      }
    }
    expect(total).toBe(3424000)
    expect(rail).toBe(710)
  })

  it('walks its nine blocks in the order the one play sequence names', () => {
    const { p } = octa(mod)
    const seen: number[] = []
    for (let f = 0; f < 4000; f++) {
      if (seen[seen.length - 1] !== p.hdrPblock) seen.push(p.hdrPblock)
      p.vbl()
    }
    expect(seen.slice(0, 4)).toEqual([0, 1, 2, 3])
  })
})
