/**
 * The DigiBooster replay, against `DME_DigiBooster.library` and against bank 3
 * of `DigiBooster_Example.amos`.
 *
 * Three things here are not what a ProTracker reader would guess, and each has
 * a test that fails loudly if it gets quietly "fixed": the row lands on the
 * tick the counter reaches the speed rather than on tick zero, the last tick
 * of a row throws most effects away, and every 1.x sample plays a finetune
 * step flat.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseAmosFile } from '../loader/amosfile'
import { corpusFile, haveCorpus } from '../cli/corpus'
import { NullAudio } from './paula'
import { PT_PERIODS, PT_PERIODS_PER_ROW } from './notes'
import { parseDigi } from './digi'
import {
  DIGI_DEFAULT_BOOST,
  DIGI_DEFAULT_BPM,
  DIGI_DEFAULT_SPEED,
  DIGI_MAX_PERIOD,
  DIGI_MIN_PERIOD,
  DigiPlayer,
  digiSpan,
  finetunePeriod,
} from './digiplay'

const EXAMPLE = '60ff9c70ecebff35aa5e3709a32b4f7bdcae920ac9429c24f7ac5ef308dafb10'

function exampleBank(): Uint8Array | null {
  if (!haveCorpus()) return null
  const path = corpusFile(EXAMPLE)
  if (!path) return null
  const file = parseAmosFile(new Uint8Array(readFileSync(path)))
  const found = file?.banks.find((b) => 'data' in b && (b as { number?: number }).number === 3)
  return found && 'data' in found ? (found.data as Uint8Array) : null
}

describe('the span, $2120b2', () => {
  it('is `$888c0e / bpm / period + 1`, which is one tick of sample', () => {
    // at 125bpm and period 214 a tick is about 20ms of a 16.5kHz stream
    expect(digiSpan(125, 214)).toBe(335)
    expect(digiSpan(125, 428)).toBe(168)
    // half the tempo is twice the bytes
    expect(digiSpan(62, 214)).toBeGreaterThan(digiSpan(125, 214) * 1.9)
  })

  it('answers zero rather than dividing by one', () => {
    expect(digiSpan(0, 214)).toBe(0)
    expect(digiSpan(125, 0)).toBe(0)
  })
})

describe('the finetune, $210f76 and $210fac', () => {
  it('picks the same note out of another row when the period is one of the 36', () => {
    // 856 is C-1 at finetune 0, and finetune -1 makes it 862
    expect(finetunePeriod(856, 0)).toBe(856)
    expect(finetunePeriod(856, -1)).toBe(PT_PERIODS[15 * PT_PERIODS_PER_ROW + 1]!)
    expect(finetunePeriod(856, -1)).toBe(862)
    expect(finetunePeriod(856, 7)).toBe(814)
  })

  it('falls back to a multiply over 140 when the period is not in the table', () => {
    // `mulu.w #$ffff` is a negate and `divu.w #$8c` is over 140
    expect(finetunePeriod(700, -1)).toBe(700 + Math.trunc(700 / 140))
    expect(finetunePeriod(700, 2)).toBe(700 - Math.trunc((700 * 2) / 140))
  })
})

const bank = exampleBank()

describe.skipIf(!bank)('bank 3 of DigiBooster_Example.amos', () => {
  const song = parseDigi(bank!)!

  const played = (ticks: number): NullAudio => {
    const audio = new NullAudio()
    const dp = new DigiPlayer(() => audio)
    dp.load(song)
    for (let i = 0; i < ticks; i++) dp.tick()
    return audio
  }

  it('starts on the library\'s own defaults, not the module\'s', () => {
    const dp = new DigiPlayer(() => new NullAudio())
    dp.load(song)
    expect(dp.speed).toBe(DIGI_DEFAULT_SPEED)
    expect(dp.bpm).toBe(DIGI_DEFAULT_BPM)
    expect(dp.boost).toBe(DIGI_DEFAULT_BOOST)
  })

  it('runs the CIA at the module\'s tempo rather than at 50Hz', () => {
    const dp = new DigiPlayer(() => new NullAudio())
    dp.load(song)
    // 1775101 / 125 is 14200 ticks of a 709379Hz clock
    expect(dp.tickHz).toBeCloseTo(709379 / 14200, 4)
    dp.bpm = 250
    expect(dp.tickHz).toBeGreaterThan(99)
  })

  it('waits SPEED ticks for the first note, because the row lands on the last one', () => {
    // $210ed2 is `blt`, so the row is processed on the tick where the counter
    // reaches the speed --- five ticks later than a ProTracker reader expects
    const dp = new DigiPlayer(() => new NullAudio())
    const audio = new NullAudio()
    const p = new DigiPlayer(() => audio)
    p.load(song)
    expect(dp.song).toBeNull()
    for (let i = 0; i < DIGI_DEFAULT_SPEED - 1; i++) p.tick()
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(0)
    p.tick()
    expect(audio.events.filter((e) => e.kind === 'play').length).toBeGreaterThan(0)
  })

  it('plays: a voice for every pair the module writes to, and no empty buffer', () => {
    const audio = played(600)
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays.length).toBeGreaterThan(200)
    expect(plays.every((e) => e.length! > 0)).toBe(true)
    // the eight channels pair two to a voice, and this module's opening
    // patterns write to 0, 2 and 4 --- so three voices sound and the fourth
    // has nothing to play rather than being dropped
    const wanted = new Set<number>()
    for (const p of [song.order[0]!, song.order[1]!]) {
      for (const row of song.patterns[p]!) {
        row.forEach((c, i) => { if (c.period !== 0 || c.sample !== 0) wanted.add(i >> 1) })
      }
    }
    expect(new Set(plays.map((e) => e.voice))).toEqual(wanted)
  })

  it('holds every period inside the replayer\'s own clamp', () => {
    const audio = played(600)
    const periods = audio.events.filter((e) => e.kind === 'play').map((e) => 3546895 / e.freq!)
    expect(periods.length).toBeGreaterThan(100)
    expect(Math.min(...periods)).toBeGreaterThanOrEqual(DIGI_MIN_PERIOD - 1)
    expect(Math.max(...periods)).toBeLessThanOrEqual(DIGI_MAX_PERIOD + 1)
  })

  it('plays every 1.x sample a finetune step FLAT, which is the library\'s bug', () => {
    // $2107b2 zeroes the finetunes for versions $10 to $13 and $210f60 then
    // does `subq.b #$1` on the byte, so a cleared field means -1
    expect(song.version).toBe(0x10)
    expect(song.samples.every((s) => s.finetune === 0)).toBe(true)
    const audio = played(600)
    const periods = audio.events.filter((e) => e.kind === 'play').map((e) => Math.round(3546895 / e.freq!))
    const tuned = new Set([...PT_PERIODS.subarray(1, 37)])
    const flat = new Set([...PT_PERIODS.subarray(15 * PT_PERIODS_PER_ROW + 1, 15 * PT_PERIODS_PER_ROW + 37)])
    // more of what comes out is on the -1 row than on the untuned one
    const onFlat = periods.filter((p) => flat.has(p)).length
    const onTuned = periods.filter((p) => tuned.has(p) && !flat.has(p)).length
    expect(onFlat).toBeGreaterThan(onTuned)
  })

  it('advances the position and raises the end flag on the wrap', () => {
    const audio = new NullAudio()
    const dp = new DigiPlayer(() => audio)
    dp.load(song)
    for (let i = 0; i < 400; i++) dp.tick()
    expect(dp.position).toBeGreaterThan(0)
    expect(dp.end).toBe(false)
    // 28 positions of 64 rows at speed 6 is a long way; walk it
    for (let i = 0; i < 12000 && !dp.end; i++) dp.tick()
    expect(dp.readEnd()).toBe(true)
    expect(dp.readEnd()).toBe(false)
  })

  it('Db Next Patt really does advance, unlike the other four players\' pairs', () => {
    const dp = new DigiPlayer(() => new NullAudio())
    dp.load(song)
    for (let i = 0; i < 100; i++) dp.tick()
    const was = dp.position
    dp.nextPattern()
    expect(dp.position).toBe(was + 1)
    expect(dp.row).toBe(0)
    dp.prevPattern()
    expect(dp.position).toBe(was)
  })

  it('scales the volume by the boost rate, so 75 is three quarters of full', () => {
    const loud = new NullAudio()
    const a = new DigiPlayer(() => loud)
    a.load(song)
    a.boost = 100
    for (let i = 0; i < 60; i++) a.tick()
    const quiet = new NullAudio()
    const b = new DigiPlayer(() => quiet)
    b.load(song)
    b.boost = 10
    for (let i = 0; i < 60; i++) b.tick()
    const peak = (n: NullAudio): number =>
      Math.max(0, ...n.events.filter((e) => e.kind === 'play').map((e) => Math.max(...(n.voiceState[e.voice]?.pcm ?? [0]))))
    expect(peak(loud)).toBeGreaterThan(peak(quiet))
  })

  it('stops dead, and continues where it stopped', () => {
    const audio = new NullAudio()
    const dp = new DigiPlayer(() => audio)
    dp.load(song)
    for (let i = 0; i < 100; i++) dp.tick()
    const where = dp.position
    const row = dp.row
    dp.stop()
    audio.events.length = 0
    for (let i = 0; i < 200; i++) dp.tick()
    expect(audio.events).toHaveLength(0)
    dp.cont()
    expect(dp.position).toBe(where)
    expect(dp.row).toBe(row)
    dp.tick()
    expect(audio.events.length).toBeGreaterThan(0)
  })

  it('leaves 64 behind when the master was zero, as the veneer does', () => {
    const dp = new DigiPlayer(() => undefined)
    dp.load(song)
    dp.master = 0
    dp.stop()
    expect(dp.master).toBe(0x40)
    dp.cont()
    expect(dp.master).toBe(0)
  })
})
