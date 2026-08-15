/**
 * The SoundMon replay, against `DME_SoundMon2.0.library` and bank 3 of
 * `SoundMon_Example.amos`.
 *
 * No second reader exists for BP SoundMon on this machine --- libopenmpt does
 * not read it and `ancient` is a decruncher --- so these check the mechanism
 * rather than a recording, the way `thxplay.test.ts` has to.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseAmosFile } from '../loader/amosfile'
import { corpusFile, haveCorpus } from '../cli/corpus'
import { NullAudio } from './paula'
import { PT_PERIODS } from './notes'
import { parseSmon } from './soundmon'
import { SMON_ARP_PHASES, SMON_PERIODS, SoundMon } from './soundmonplay'

const EXAMPLE = 'd5e3ff21cf6af515f82cf81744fcc158346b6c31d70adfeb417a703c77b362a8'

function exampleBank(): Uint8Array | null {
  if (!haveCorpus()) return null
  const path = corpusFile(EXAMPLE)
  if (!path) return null
  const file = parseAmosFile(new Uint8Array(readFileSync(path)))
  const found = file?.banks.find((b) => 'data' in b && (b as { number?: number }).number === 3)
  return found && 'data' in found ? (found.data as Uint8Array) : null
}

describe('the period table at $210e82', () => {
  it('is 48 words of four octaves, and is NOT ProTracker\'s', () => {
    expect(SMON_PERIODS).toHaveLength(48)
    expect(SMON_PERIODS[0]).toBe(856)
    expect(SMON_PERIODS[47]).toBe(57)
    // the disagreements are real and this is why `notes.ts` cannot supply it
    expect(SMON_PERIODS[2]).toBe(760)
    expect(PT_PERIODS[3]).toBe(762)
    expect(SMON_PERIODS[4]).toBe(680)
    expect(PT_PERIODS[5]).toBe(678)
    // and ProTracker's stops at 113 where this one has a whole octave more
    expect(SMON_PERIODS[35]).toBe(113)
    expect(SMON_PERIODS[36]).toBe(107)
  })

  it('falls the whole way, so a higher note is never a longer period', () => {
    for (let i = 1; i < SMON_PERIODS.length; i++) expect(SMON_PERIODS[i]!).toBeLessThan(SMON_PERIODS[i - 1]!)
  })
})

const bank = exampleBank()

describe.skipIf(!bank)('bank 3 of SoundMon_Example.amos', () => {
  const song = parseSmon(bank!)!

  const played = (ticks: number): { audio: NullAudio; sm: SoundMon } => {
    const audio = new NullAudio()
    const sm = new SoundMon(() => audio)
    sm.load(song)
    for (let i = 0; i < ticks; i++) sm.tick()
    return { audio, sm }
  }

  it('plays on all four voices, and every one of them is a synth', () => {
    const { audio, sm } = played(1500)
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays.length).toBeGreaterThan(300)
    expect(new Set(plays.map((e) => e.voice)).size).toBe(4)
    expect(sm.voices.every((v) => v.synth)).toBe(true)
  })

  it('holds every period inside the table it indexes', () => {
    const { audio } = played(1500)
    const periods = audio.events.filter((e) => e.kind === 'play').map((e) => Math.round(3546895 / e.freq!))
    expect(periods.length).toBeGreaterThan(100)
    expect(Math.min(...periods)).toBeGreaterThanOrEqual(SMON_PERIODS[SMON_PERIODS.length - 1]!)
    expect(Math.max(...periods)).toBeLessThanOrEqual(SMON_PERIODS[0]!)
  })

  it('REWRITES the waveform while the voice plays it, which is the synth', () => {
    // $210ce0 negates a run of the backup into the live buffer and $210cd2
    // puts it back. Nothing else in this port mutates a sounding sample
    const { audio } = played(1500)
    expect(audio.events.filter((e) => e.kind === 'waveform').length).toBeGreaterThan(500)
  })

  it('keeps a private waveform per voice, because the tables are shared', () => {
    const { sm } = played(600)
    const buffers = sm.voices.map((v) => v.pcm).filter(Boolean)
    expect(buffers.length).toBeGreaterThan(1)
    // two voices on the same table must not be the same array, or one voice's
    // shape sweep would drag the other's with it
    for (let i = 0; i < buffers.length; i++) {
      for (let j = i + 1; j < buffers.length; j++) expect(buffers[i]).not.toBe(buffers[j])
    }
  })

  it('only ever holds the backup or its negation, at any moment of the sweep', () => {
    // the whole of the shape modulator: $210ce0 negates backup bytes forward
    // and $210cd2 copies them back. Nothing else may reach the buffer, so
    // every byte must be one of the two at all times
    for (const ticks of [1, 7, 60, 301, 900]) {
      const { sm } = played(ticks)
      for (const v of sm.voices) {
        if (!v.synth || !v.pcm) continue
        for (let i = 0; i < Math.min(v.pcm.length, v.backup.length); i++) {
          const b = v.backup[i]!
          expect([ticks, i, v.pcm[i]]).toEqual([ticks, i, v.pcm[i] === b ? b : -b])
        }
      }
    }
  })

  it('walks three arpeggio phases and reloads, rather than counting forever', () => {
    const audio = new NullAudio()
    const sm = new SoundMon(() => audio)
    sm.load(song)
    const seen = new Set<number>()
    for (let i = 0; i < 60; i++) {
      seen.add(sm.arpPhase)
      sm.tick()
    }
    expect(seen).toEqual(new Set([1, 2, SMON_ARP_PHASES]))
  })

  it('advances the position and raises the end flag at the last step', () => {
    const { sm } = played(1500)
    expect(sm.position).toBeGreaterThan(0)
    expect(sm.end).toBe(false)
    // 105 steps of 16 rows at speed 6 is a long walk
    for (let i = 0; i < 40000 && !sm.end; i++) sm.tick()
    expect(sm.readEnd()).toBe(true)
    expect(sm.readEnd()).toBe(false)
  })

  it('takes its speed from a command rather than from the header', () => {
    // there is no speed byte in a SoundMon header at all: `$210d97` starts at
    // one and command 2 is the only thing that writes it
    const audio = new NullAudio()
    const sm = new SoundMon(() => audio)
    sm.load(song)
    expect(sm.speed).toBe(1)
    for (let i = 0; i < 200; i++) sm.tick()
    expect(sm.speed).toBeGreaterThan(1)
  })

  it('a stopped replayer ticks nothing, and continuing keeps the position', () => {
    const audio = new NullAudio()
    const sm = new SoundMon(() => audio)
    sm.load(song)
    for (let i = 0; i < 200; i++) sm.tick()
    const where = sm.position
    sm.stop()
    audio.events.length = 0
    for (let i = 0; i < 300; i++) sm.tick()
    expect(audio.events).toHaveLength(0)
    sm.cont()
    expect(sm.position).toBe(where)
    sm.tick()
    expect(audio.events.length).toBeGreaterThan(0)
  })

  it('silences a disabled voice and leaves the other three alone', () => {
    const audio = new NullAudio()
    const sm = new SoundMon(() => audio)
    sm.load(song)
    sm.setVoices(0b0111)
    audio.events.length = 0
    for (let i = 0; i < 400; i++) sm.tick()
    expect(audio.events.filter((e) => e.kind === 'play' && e.voice === 3)).toHaveLength(0)
    expect(new Set(audio.events.filter((e) => e.kind === 'play').map((e) => e.voice))).toEqual(new Set([0, 1, 2]))
  })

  it('leaves 64 behind when the master was zero, as the shared veneer does', () => {
    const sm = new SoundMon(() => undefined)
    sm.load(song)
    sm.master = 0
    sm.stop()
    expect(sm.master).toBe(0x40)
    sm.cont()
    expect(sm.master).toBe(0)
  })
})
