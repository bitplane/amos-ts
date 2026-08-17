/**
 * FutureComposer 1.0-1.3, against `DME_FC1.3.library` and against the one real
 * module: bank 3 of `FC13_Example.amos`, named "FC1.3" and 4,936 bytes.
 *
 * The module is reached by sha256 out of the corpus. Most of these check the
 * layout arithmetic, because nothing in an FC file says where sample n starts,
 * and the two things 1.3 does differently from 1.4: the chain has no gap in
 * it, and the waveforms are not in the file at all.
 */
import { describe, expect, it } from 'vitest'
import { describeWith } from '../testing/fixture'
import { readFileSync } from 'node:fs'
import { parseAmosFile } from '../loader/amosfile'
import { corpusFile, haveCorpus } from '../cli/corpus'
import { NullAudio } from './paula'
import { FC13_WAVES } from './fc13waves'
import {
  FC13_HEADER_BYTES,
  FC13_MAX_PERIOD,
  FC13_MIN_PERIOD,
  FC13_PERIODS,
  FC13_SAMPLES,
  FC13_STEP_BYTES,
  Fc13,
  parseFc13,
} from './fc13'

/** sources/kyzer-dme/files/amospro_dme_v2.0/examples/FC13_Example.amos */
const EXAMPLE = 'd16cd2d56bf4a102965bb6d2c1df60bccdded98cca120ad3fac4160f99298a48'

function exampleBank(): Uint8Array | null {
  if (!haveCorpus()) return null
  const path = corpusFile(EXAMPLE)
  if (!path) return null
  const file = parseAmosFile(new Uint8Array(readFileSync(path)))
  const found = file?.banks.find((b) => 'data' in b && (b as { number?: number }).number === 3)
  return found && 'data' in found ? (found.data as Uint8Array) : null
}

/** the smallest thing `parseFc13` will take: a tag and a hundred bytes */
function stub(): Uint8Array {
  const d = new Uint8Array(0x200)
  for (const [i, c] of [...'SMOD'].entries()) d[i] = c.charCodeAt(0)
  return d
}

describe('the period table at $210f1e', () => {
  it('is 84 words where 1.4 has 128, and stops after the second octave up', () => {
    expect(FC13_PERIODS).toHaveLength(84)
    expect(FC13_PERIODS[0]).toBe(1712)
    expect(FC13_PERIODS.slice(48, 60)).toEqual(new Array(12).fill(113))
    expect(FC13_PERIODS[60]).toBe(3424)
    expect(FC13_PERIODS[72]).toBe(6848)
    expect(FC13_PERIODS[83]).toBe(3624)
  })

  it('leaves indices 84 to 127 off the end, which a bit-7 sequence byte can reach', () => {
    // `andi.w #$7f,d0` at $210cf0 admits 128 indices into an 84-word table.
    // The bytes past it are the sample table at $210fc6, not periods
    expect(FC13_PERIODS[84]).toBeUndefined()
    expect(FC13_PERIODS[127]).toBeUndefined()
  })

  it("brackets the replayer's own clamp, which tops out lower than 1.4's", () => {
    expect(FC13_MIN_PERIOD).toBe(0x71)
    expect(FC13_MAX_PERIOD).toBe(0x6b0)
    // the floor IS the table's lowest entry, and the ceiling its highest of
    // the first octave --- so only the vibrato and the portamento can bite
    expect(Math.min(...FC13_PERIODS)).toBe(FC13_MIN_PERIOD)
    expect(FC13_PERIODS[0]).toBe(FC13_MAX_PERIOD)
  })
})

describe('the header, off InitModule at $2105b4', () => {
  it('wants "SMOD" at offset zero', () => {
    expect(parseFc13(new Uint8Array(0x200))).toBeNull()
    expect(parseFc13(stub())).not.toBeNull()
  })

  it('starts the sequence at $64, a hundred bytes in, where 1.4 needs $b4', () => {
    expect(FC13_HEADER_BYTES).toBe(0x64)
    // ten six-byte sample headers from $28 land exactly on it, and there is
    // no table of wavetable lengths after them because there are no wavetables
    expect(0x28 + FC13_SAMPLES * 6).toBe(FC13_HEADER_BYTES)
  })

  it('holds 57 table entries: ten module samples then the 47 the library owns', () => {
    expect(parseFc13(stub())!.samples).toHaveLength(FC13_SAMPLES + FC13_WAVES)
  })

  it('gives every built-in waveform a repeat over the whole of itself', () => {
    for (const s of parseFc13(stub())!.samples.slice(FC13_SAMPLES)) {
      expect(s.repeatStart).toBe(0)
      expect(s.repeatWords).toBe(s.words)
      expect(s.words * 2).toBe(s.pcm.length)
    }
  })
})

const bank = exampleBank()

describeWith('bank 3 of FC13_Example.amos', bank, (data) => {
  const song = parseFc13(data)!

  it('is 4,936 bytes of SMOD with twelve sequence steps', () => {
    expect(data.length).toBe(4936)
    expect(song.steps).toBe(12)
    expect(song.sequence.length).toBe(song.steps * FC13_STEP_BYTES)
  })

  it('carries no samples at all, which is why the whole tune fits in five kilobytes', () => {
    const own = song.samples.slice(0, FC13_SAMPLES)
    expect(own.every((s) => s.words === 0)).toBe(true)
    // the sample data pointer still points somewhere: eight bytes off the end
    const at = (data[0x20]! << 24) | (data[0x21]! << 16) | (data[0x22]! << 8) | data[0x23]!
    expect(at).toBe(data.length - 8)
  })

  it('leaves the long at $24 unread, where 1.4 keeps its wavetable pointer', () => {
    expect(data.slice(0x24, 0x28)).toEqual(new Uint8Array(4))
  })

  it('takes its speed from step 0 and never changes it, because every other step is zero', () => {
    expect(song.speed).toBe(8)
    expect(song.speed).toBe(song.sequence[0x0c])
    for (let s = 1; s < song.steps; s++) expect(song.sequence[s * FC13_STEP_BYTES + 0x0c]).toBe(0)
  })

  it('ends every pattern on a zero byte, which is what the speed read lands on', () => {
    // $210a24 reads the last byte of the pattern a voice has just finished
    // instead of the step's speed byte. Every pattern here ends on a zero and
    // a zero means "leave the speed alone", so the module never sees it
    const patterns = song.patterns
    for (let p = 0; p * 64 < patterns.length; p++) expect(patterns[p * 64 + 0x3f]).toBe(0)
  })

  it('plays: 3,000 ticks, four voices busy, and no sample of zero length', () => {
    const audio = new NullAudio()
    const fc = new Fc13(() => audio)
    fc.load(song)
    for (let i = 0; i < 3000; i++) fc.tick()
    const played = audio.events.filter((e) => e.kind === 'play')
    expect(played.length).toBeGreaterThan(50)
    expect(played.every((e) => e.length! > 0)).toBe(true)
    expect(new Set(played.map((e) => e.voice)).size).toBe(4)
    expect(fc.position).toBeGreaterThan(0)
  })

  it('waits seven ticks before the first row, because the counter loads with the speed', () => {
    // $210646 puts the speed into the counter as well as into its reload,
    // where 1.4 starts the counter at one. It is the whole of the 140ms this
    // port sits behind an independent player on the same module
    const audio = new NullAudio()
    const fc = new Fc13(() => audio)
    fc.load(song)
    audio.events.length = 0
    for (let i = 0; i < 7; i++) fc.tick()
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(0)
    fc.tick()
    expect(audio.events.filter((e) => e.kind === 'play').length).toBeGreaterThan(0)
  })

  it('plays nothing but the built-in waveforms: every sample named is 10 or above', () => {
    const audio = new NullAudio()
    const fc = new Fc13(() => audio)
    fc.load(song)
    for (let i = 0; i < 3000; i++) fc.tick()
    // the ten module entries are all empty, so anything reaching `play` with
    // bytes in it came out of `fc13waves.ts`
    const lengths = new Set(audio.events.filter((e) => e.kind === 'play').map((e) => e.length))
    expect(lengths.size).toBeGreaterThan(0)
    for (const n of lengths) expect([16, 32, 48]).toContain(n)
  })

  it('swaps waveforms without retriggering, which is the whole of FC synthesis', () => {
    const audio = new NullAudio()
    const fc = new Fc13(() => audio)
    fc.load(song)
    for (let i = 0; i < 3000; i++) fc.tick()
    expect(audio.events.filter((e) => e.kind === 'waveform').length).toBeGreaterThan(50)
  })

  it("holds the period inside the replayer's clamp for every tick of it", () => {
    const audio = new NullAudio()
    const fc = new Fc13(() => audio)
    fc.load(song)
    for (let i = 0; i < 3000; i++) fc.tick()
    const freqs = audio.events.filter((e) => e.kind === 'freq').map((e) => 3546895 / e.freq!)
    expect(freqs.length).toBeGreaterThan(1000)
    expect(Math.min(...freqs)).toBeGreaterThanOrEqual(FC13_MIN_PERIOD - 1)
    expect(Math.max(...freqs)).toBeLessThanOrEqual(FC13_MAX_PERIOD + 1)
  })

  it('raises the end flag on the wrap and not before', () => {
    const audio = new NullAudio()
    const fc = new Fc13(() => audio)
    fc.load(song)
    // twelve steps of 32 rows at speed 8 is 3,072 ticks to the wrap
    for (let i = 0; i < 2000; i++) fc.tick()
    expect(fc.end).toBe(false)
    for (let i = 0; i < 1500; i++) fc.tick()
    expect(fc.readEnd()).toBe(true)
    expect(fc.readEnd()).toBe(false)
  })

  it('Fc13 Next Patt goes nowhere, because the subq and the addq cancel', () => {
    const fc = new Fc13(() => new NullAudio())
    fc.load(song)
    for (let i = 0; i < 400; i++) fc.tick()
    const where = fc.position
    fc.nextPattern()
    expect(fc.position).toBe(where)
    fc.prevPattern()
    expect(fc.position).toBeLessThan(where)
  })

  it('Stop leaves 64 behind when the master was zero, as the shared veneer does', () => {
    const fc = new Fc13(() => undefined)
    fc.load(song)
    fc.master = 0
    fc.stop()
    expect(fc.master).toBe(0x40)
    fc.cont()
    expect(fc.master).toBe(0)
  })

  it('stops and continues on its own flag, which in 1.3 is not the counter', () => {
    // $210dbc is a word of its own, so `Cont` does not have to reload the
    // counter the way 1.4's does
    const audio = new NullAudio()
    const fc = new Fc13(() => audio)
    fc.load(song)
    for (let i = 0; i < 100; i++) fc.tick()
    fc.stop()
    const counter = fc.counter
    audio.events.length = 0
    for (let i = 0; i < 500; i++) fc.tick()
    expect(audio.events).toHaveLength(0)
    fc.cont()
    expect(fc.counter).toBe(counter)
    fc.tick()
    expect(audio.events.length).toBeGreaterThan(0)
  })

  it('freezes a disabled voice: the row still steps, the sequences do not run', () => {
    const audio = new NullAudio()
    const fc = new Fc13(() => audio)
    fc.load(song)
    fc.setVoices(0b0111)
    audio.events.length = 0
    for (let i = 0; i < 1000; i++) fc.tick()
    expect(audio.events.filter((e) => e.voice === 3 && e.kind === 'freq')).toHaveLength(0)
    // and the other three are untouched by it
    expect(new Set(audio.events.filter((e) => e.kind === 'freq').map((e) => e.voice))).toEqual(new Set([0, 1, 2]))
  })
})
