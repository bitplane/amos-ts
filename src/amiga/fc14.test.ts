/**
 * FutureComposer 1.4, against `DME_FC1.4.library` and against the one real
 * module: bank 3 of `FC14_Example.amos`, named "FC1.4" and 15,336 bytes.
 *
 * The module is reached by sha256 out of the corpus. The layout arithmetic is
 * what most of these check, because nothing in an FC file says where sample n
 * starts: only sample 0 has an offset and the rest are a chain.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseAmosFile } from '../loader/amosfile'
import { corpusFile, haveCorpus } from '../cli/corpus'
import { NullAudio } from './paula'
import {
  FC14_HEADER_BYTES,
  FC14_MAX_PERIOD,
  FC14_MIN_PERIOD,
  FC14_PERIODS,
  FC14_SAMPLES,
  FC14_STEP_BYTES,
  FC14_WAVES,
  Fc14,
  parseFc14,
} from './fc14'

/** sources/kyzer-dme/files/amospro_dme_v2.0/examples/FC14_Example.amos */
const EXAMPLE = '96ed4074548017728ab7d2941013c55e6cbfa98bff0030f7ccbeeaf923528946'

function exampleBank(): Uint8Array | null {
  if (!haveCorpus()) return null
  const path = corpusFile(EXAMPLE)
  if (!path) return null
  const file = parseAmosFile(new Uint8Array(readFileSync(path)))
  const found = file?.banks.find((b) => 'data' in b && (b as { number?: number }).number === 3)
  return found && 'data' in found ? (found.data as Uint8Array) : null
}

describe('the period table at $210f8a', () => {
  it('is 128 words: five octaves, a twelve-wide clamp, then two octaves up and a repeat', () => {
    expect(FC14_PERIODS).toHaveLength(128)
    expect(FC14_PERIODS[0]).toBe(1712)
    expect(FC14_PERIODS.slice(48, 60)).toEqual(new Array(12).fill(113))
    // the two ranges above the first, which only a bit-7 sequence byte reaches
    expect(FC14_PERIODS[60]).toBe(3424)
    expect(FC14_PERIODS[72]).toBe(6848)
    expect(FC14_PERIODS[84]).toBe(1712)
  })

  it('brackets the replayer\'s own clamp', () => {
    expect(FC14_MIN_PERIOD).toBe(0x71)
    expect(FC14_MAX_PERIOD).toBe(0xd60)
    // the floor IS the table's lowest entry: 113 is $71 exactly, so the clamp
    // can only ever bite what the vibrato and the portamentos added
    expect(Math.min(...FC14_PERIODS)).toBe(FC14_MIN_PERIOD)
  })
})

describe('the header, off InitModule at $2105c0', () => {
  it('wants "FC14" at offset zero, where SoundFX puts its magic at 60', () => {
    expect(parseFc14(new Uint8Array(0x200))).toBeNull()
    const d = new Uint8Array(0x200)
    for (const [i, c] of [...'FC14'].entries()) d[i] = c.charCodeAt(0)
    expect(parseFc14(d)).not.toBeNull()
  })

  it('holds ninety table entries: ten samples then eighty wavetables', () => {
    const d = new Uint8Array(0x200)
    for (const [i, c] of [...'FC14'].entries()) d[i] = c.charCodeAt(0)
    expect(parseFc14(d)!.samples).toHaveLength(FC14_SAMPLES + FC14_WAVES)
  })

  it('starts the sequence at $b4, which is what makes the header that long', () => {
    expect(FC14_HEADER_BYTES).toBe(0xb4)
    // 10 six-byte sample headers from $28 land on $64, and 80 wavetable
    // lengths from there land exactly on $b4
    expect(0x28 + FC14_SAMPLES * 6).toBe(0x64)
    expect(0x64 + FC14_WAVES).toBe(FC14_HEADER_BYTES)
  })
})

const bank = exampleBank()

describe.skipIf(!bank)('bank 3 of FC14_Example.amos', () => {
  const data = bank!
  const song = parseFc14(data)!

  it('is 15,336 bytes of FC14 with 49 sequence steps', () => {
    expect(data.length).toBe(15336)
    expect(song.steps).toBe(49)
    // 638 bytes of sequence is 49 steps and one byte over, and `divu.w #$d`
    // drops it --- the replayer's end pointer is 49 x 13, not 638
    expect(song.sequence.length).toBe(song.steps * FC14_STEP_BYTES)
  })

  it('accounts for every byte: header, sequence, patterns, sequences, samples, waves', () => {
    // the sample chain is the check that matters. Sample 0 is the only one
    // with an offset in the file; if `len * 2 + 2` were wrong, the third
    // sample would not end exactly where the wavetable begins
    const wavesAt = (data[0x24]! << 24) | (data[0x25]! << 16) | (data[0x26]! << 8) | data[0x27]!
    const samplesAt = (data[0x20]! << 24) | (data[0x21]! << 16) | (data[0x22]! << 8) | data[0x23]!
    const used = song.samples.slice(0, 3).reduce((a, s) => a + s.words * 2 + 2, 0)
    expect(samplesAt + used).toBe(wavesAt)
    // $210634 runs the chain over all ten entries unconditionally, so the
    // seven empty ones each still eat two bytes and their pointers walk on
    // past the wavetable base. Nothing plays them
    const all = song.samples.slice(0, FC14_SAMPLES).reduce((a, s) => a + s.words * 2 + 2, 0)
    expect(samplesAt + all).toBe(wavesAt + 14)
    const waveBytes = song.samples.slice(FC14_SAMPLES).reduce((a, s) => a + s.words * 2, 0)
    expect(wavesAt + waveBytes).toBe(15328)
  })

  it('has three real samples and 42 wavetables with data in them', () => {
    const used = song.samples.slice(0, FC14_SAMPLES).filter((s) => s.pcm.length > 0)
    expect(used).toHaveLength(3)
    expect(used.map((s) => s.words)).toEqual([3100, 1500, 348])
    // every real sample here loops its last word: the repeat start in BYTES
    // is twice the length in words
    for (const s of used) {
      expect(s.repeatStart).toBe(s.words * 2)
      expect(s.repeatWords).toBe(1)
    }
    expect(song.samples.slice(FC14_SAMPLES).filter((s) => s.pcm.length > 0).length).toBeGreaterThan(40)
  })

  it('gives every wavetable a repeat over the whole of itself', () => {
    for (const s of song.samples.slice(FC14_SAMPLES)) {
      expect(s.repeatStart).toBe(0)
      expect(s.repeatWords).toBe(s.words)
    }
  })

  it('takes its speed from step 0 rather than from a default', () => {
    expect(song.speed).toBe(song.sequence[0x0c])
    expect(song.speed).toBeGreaterThan(0)
  })

  it('plays: 3,000 ticks, four voices busy, and no sample of zero length', () => {
    const audio = new NullAudio()
    const fc = new Fc14(() => audio)
    fc.load(song)
    for (let i = 0; i < 3000; i++) fc.tick()
    const played = audio.events.filter((e) => e.kind === 'play')
    expect(played.length).toBeGreaterThan(50)
    expect(played.every((e) => e.length! > 0)).toBe(true)
    expect(new Set(played.map((e) => e.voice)).size).toBe(4)
    // 3,000 ticks at speed 3 is 1,000 rows, which is well past step 0
    expect(fc.position).toBeGreaterThan(0)
  })

  it('swaps waveforms without retriggering, which is the whole of FC synthesis', () => {
    // `$e4` goes to setWaveform and `$e2` to play. A module with wavetables
    // in it must do both, or the wavetable table is being read for nothing
    const audio = new NullAudio()
    const fc = new Fc14(() => audio)
    fc.load(song)
    for (let i = 0; i < 3000; i++) fc.tick()
    expect(audio.events.filter((e) => e.kind === 'waveform').length).toBeGreaterThan(50)
  })

  it('holds the period inside the replayer\'s clamp for every tick of it', () => {
    const audio = new NullAudio()
    const fc = new Fc14(() => audio)
    fc.load(song)
    for (let i = 0; i < 3000; i++) fc.tick()
    const freqs = audio.events.filter((e) => e.kind === 'freq').map((e) => 3546895 / e.freq!)
    expect(freqs.length).toBeGreaterThan(1000)
    expect(Math.min(...freqs)).toBeGreaterThanOrEqual(FC14_MIN_PERIOD - 1)
    expect(Math.max(...freqs)).toBeLessThanOrEqual(FC14_MAX_PERIOD + 1)
  })

  it('Fc14 Next Patt goes nowhere, because the subq and the addq cancel', () => {
    const audio = new NullAudio()
    const fc = new Fc14(() => audio)
    fc.load(song)
    for (let i = 0; i < 200; i++) fc.tick()
    const where = fc.position
    fc.nextPattern()
    expect(fc.position).toBe(where)
    // Prev, two vectors along, has the instruction Next is missing
    fc.prevPattern()
    expect(fc.position).toBeLessThan(where)
  })

  it('Stop leaves 64 behind when the master was zero, as the shared veneer does', () => {
    const fc = new Fc14(() => undefined)
    fc.load(song)
    fc.master = 0
    fc.stop()
    expect(fc.master).toBe(0x40)
    fc.cont()
    expect(fc.master).toBe(0)
  })

  it('a stopped replayer ticks nothing, because the counter IS the play flag', () => {
    const audio = new NullAudio()
    const fc = new Fc14(() => audio)
    fc.load(song)
    fc.stop()
    audio.events.length = 0
    for (let i = 0; i < 500; i++) fc.tick()
    expect(audio.events).toHaveLength(0)
  })
})
