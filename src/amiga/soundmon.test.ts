/**
 * The BP SoundMon 2.0 format, against bank 3 of `SoundMon_Example.amos`.
 *
 * The pattern count is the check that matters. Nothing in the file states it,
 * so `InitModule` derives it by scanning every song slot for the largest
 * number, and getting that wrong moves the waveform tables and the samples
 * with it — the module still parses and plays noise.
 */
import { describe, expect, it } from 'vitest'
import { describeWith } from '../testing/fixture'
import { readFileSync } from 'node:fs'
import { parseAmosFile } from '../loader/amosfile'
import { corpusFile, haveCorpus } from '../cli/corpus'
import {
  SMON_INSTRUMENTS,
  SMON_MAGIC,
  SMON_MAGIC_AT,
  SMON_PATTERN_BYTES,
  SMON_RECORDS_AT,
  SMON_ROWS,
  SMON_SONG_AT,
  SMON_STEP_BYTES,
  SMON_WAVE_BYTES,
  parseSmon,
} from './soundmon'

/** sources/kyzer-dme/files/amospro_dme_v2.0/examples/SoundMon_Example.amos */
const EXAMPLE = 'd5e3ff21cf6af515f82cf81744fcc158346b6c31d70adfeb417a703c77b362a8'

function exampleBank(): Uint8Array | null {
  if (!haveCorpus()) return null
  const path = corpusFile(EXAMPLE)
  if (!path) return null
  const file = parseAmosFile(new Uint8Array(readFileSync(path)))
  const found = file?.banks.find((b) => 'data' in b && (b as { number?: number }).number === 3)
  return found && 'data' in found ? (found.data as Uint8Array) : null
}

describe('the header', () => {
  it('wants "V.2" at $1a, and the byte after it is a count rather than a tag', () => {
    const d = new Uint8Array(0x400)
    expect(parseSmon(d)).toBeNull()
    for (const [i, c] of [...SMON_MAGIC].entries()) d[SMON_MAGIC_AT + i] = c.charCodeAt(0)
    // still no steps, and a song of none has nothing to play
    expect(parseSmon(d)).toBeNull()
    d[0x1f] = 1
    expect(parseSmon(d)).not.toBeNull()
    // $1d is the waveform count, and the extension's own test at $5564 clears
    // that byte before comparing, so it can be anything
    d[0x1d] = 0x99
    expect(parseSmon(d)).not.toBeNull()
  })

  it('lays fifteen records of thirty-two bytes and lands EXACTLY on the song', () => {
    // $20 + 15 * $20 is $200, which is where `move.l #$200,d0` at $210622
    // starts reading the song. The header has no slack in it at all
    expect(SMON_RECORDS_AT + SMON_INSTRUMENTS * 0x20).toBe(SMON_SONG_AT)
    expect(SMON_SONG_AT).toBe(0x200)
  })
})

const bank = exampleBank()

describeWith('bank 3 of SoundMon_Example.amos', bank, (data) => {
  const song = parseSmon(data)!

  it('is 7,368 bytes of "NEVERENDING", 105 steps and 35 waveform tables', () => {
    expect(data.length).toBe(7368)
    expect(song.name).toBe('NEVERENDING')
    expect(song.steps).toBe(105)
    expect(song.waves).toHaveLength(35)
    expect(song.sequence).toHaveLength(105)
  })

  it('DERIVES 61 patterns, because the file never says how many there are', () => {
    // $210634 walks all `steps * 4` slots and keeps the largest
    const largest = Math.max(...song.sequence.flat().map((s) => s.pattern))
    expect(song.patterns).toHaveLength(largest)
    expect(largest).toBe(61)
  })

  it('accounts for every byte: header, song, patterns, waveforms, samples', () => {
    const patternsAt = SMON_SONG_AT + song.steps * SMON_STEP_BYTES
    const wavesAt = patternsAt + song.patterns.length * SMON_PATTERN_BYTES
    const samplesAt = wavesAt + song.waves.length * SMON_WAVE_BYTES
    expect(patternsAt).toBe(0x890)
    expect(wavesAt).toBe(0x1400)
    const used = song.instruments.reduce((a, i) => a + (i.sample?.words ?? 0) * 2, 0)
    // eight bytes over, which is the bank rounded up rather than sample data
    expect(data.length - (samplesAt + used)).toBe(8)
  })

  it('mixes the two kinds of instrument in one record layout', () => {
    expect(song.instruments).toHaveLength(SMON_INSTRUMENTS)
    expect(song.instruments.filter((i) => i.synth)).toHaveLength(8)
    expect(song.instruments.filter((i) => !i.synth)).toHaveLength(7)
    // a synth carries no audio at all and a sampled one carries no scripts
    for (const i of song.instruments) {
      expect(i.synth ? i.sample : i.synthesis).toBeNull()
      expect(i.synth ? i.synthesis : i.sample).not.toBeNull()
    }
  })

  it('reads $18 as a length for a sample and a speed for a synth, at one offset', () => {
    // the sharpest of the record's two readings, and the chain at $21067c
    // moves only for the sampled kind
    const sampled = song.instruments.find((i) => !i.synth)!
    expect(sampled.sample!.pcm.length).toBe(sampled.sample!.words * 2)
    const synth = song.instruments.find((i) => i.synth)!
    expect(synth.synthesis!.shapeSpeed).toBeGreaterThan(0)
  })

  it('gives every waveform table its full 64 bytes', () => {
    for (const w of song.waves) expect(w).toHaveLength(SMON_WAVE_BYTES)
  })

  it('names sixteen rows of three bytes in every pattern', () => {
    for (const p of song.patterns) expect(p).toHaveLength(SMON_ROWS)
    // the instrument is the high nibble and the command the low one
    for (const p of song.patterns) {
      for (const c of p) {
        expect(c.instrument).toBeLessThanOrEqual(0x0f)
        expect(c.command).toBeLessThanOrEqual(0x0f)
      }
    }
  })

  it('never names a pattern the derived count does not reach', () => {
    for (const step of song.sequence) {
      for (const slot of step) expect(slot.pattern).toBeLessThanOrEqual(song.patterns.length)
    }
  })
})
