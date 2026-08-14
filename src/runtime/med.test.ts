import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadHunks } from '../amiga/hunk'
import { NullAudio, PAULA_CLOCK_NTSC, PAULA_CLOCK_PAL, periodToHz } from '../amiga/paula'
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

  it('derives finetune 0 word for word over all 60 notes', () => {
    const off = []
    for (let n = 0; n < 60; n++) if (medPeriod(n, 0) !== period(0, n)) off.push(n)
    expect(off).toEqual([])
    expect(medPeriod(0, 0)).toBe(3424) // 856 * 4, two octaves below ProTracker
  })

  it('folds notes 60 to 62 back an octave, as the table itself does', () => {
    for (let n = 60; n <= 62; n++) expect(medPeriod(n, 0)).toBe(period(0, n))
  })

  it('is within 13 counts on the fifteen finetunes it derives instead', () => {
    let worst = 0
    for (let f = 1; f < 16; f++) {
      for (let n = 0; n < 60; n++) worst = Math.max(worst, Math.abs(medPeriod(n, f) - period(f, n)))
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
  const p = new MedPlayer({
    audio,
    tick: () => 0,
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
    const down = playing(mmd0([[NOTE, 1, 0x2, 0x40]]))
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
