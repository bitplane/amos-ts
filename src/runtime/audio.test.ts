import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { EXTENSION_TOKENS } from '../ext/registry'
import { tokenize } from '../tokens/source'
import { Runtime } from './runtime'
import { parseSampleBank } from './audio'
import { NullAudio, samPeriod, periodToHz, PAULA_CLOCK } from '../amiga/paula'
import type { MemoryBank } from '../loader/amosfile'

const table = new TokenTable(CORE_TOKENS)
const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs, true)]))

/** synthetic Samples bank: one 4-byte sample named TICK at 8363 Hz */
function sampleBank(): MemoryBank {
  const rec = [
    ...[...'TICK    '].map((c) => c.charCodeAt(0)),
    0x20, 0xab, // freq 8363
    0, 0, 0, 4, // length
    10, 20, 30, 40, // pcm
  ]
  const data = new Uint8Array([0, 1, 0, 0, 0, 6, ...rec])
  return { kind: 'memory', number: 5, memType: 1, name: 'Samples', flags: 0, data }
}

function run(src: string, frames = 100): { rt: Runtime; audio: NullAudio } {
  const audio = new NullAudio()
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    audio,
    banks: [sampleBank()],
    maxSteps: 100_000,
  })
  rt.runHeadless(frames)
  return { rt, audio }
}

describe('sample bank', () => {
  it('parses count, offsets and records', () => {
    const entries = parseSampleBank(sampleBank().data)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('TICK')
    expect(entries[0]!.freq).toBe(8363)
    expect([...entries[0]!.pcm]).toEqual([10, 20, 30, 40])
  })
})

describe('sample playback', () => {
  it('plays on all voices at the period-quantized Paula rate (SPl0 +Music.s:3316)', () => {
    const { audio } = run('Sam Play 1')
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays).toHaveLength(4)
    // AUDxPER = floor(clock/8363) = 424, so Paula actually plays clock/424
    expect(plays[0]).toMatchObject({ freq: PAULA_CLOCK / 424, length: 4, loop: false })
  })

  it('clamps the period to 124 — rates above ~28.6kHz are impossible', () => {
    expect(samPeriod(50000)).toBe(124)
    expect(periodToHz(samPeriod(50000))).toBeCloseTo(PAULA_CLOCK / 124)
  })

  it('respects voice masks and frequency overrides', () => {
    const { audio } = run('Sam Play %101,1,4000')
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays.map((p) => p.voice)).toEqual([0, 2])
    expect(plays[0]!.freq).toBe(PAULA_CLOCK / samPeriod(4000))
  })

  it('errors on an explicit frequency <= 500 (InSamPlay3 +Music.s:3148)', () => {
    expect(() => run('Sam Play 15,1,500')).toThrow(/illegal function call/i)
  })

  it('errors on undefined samples and bad bank numbers', () => {
    expect(() => run('Sam Play 7')).toThrow(/sample not defined/i)
    expect(() => run('Sam Bank 6\nSam Play 1')).toThrow(/sample bank not found/i)
    expect(() => run('Sam Bank 0')).toThrow(/illegal function call/i)
    expect(() => run('Sam Bank 17')).toThrow(/illegal function call/i)
  })

  it('loops when Sam Loop On is active and stops with Sam Stop', () => {
    const { audio } = run('Sam Loop On\nSam Play 1\nSam Stop')
    const play = audio.events.find((e) => e.kind === 'play')!
    expect(play.loop).toBe(true)
    expect(audio.events.some((e) => e.kind === 'stop')).toBe(true)
  })

  /**
   * DEFECT: `Sam Loop On` has a masked form that cannot be typed.
   *
   * +Music.s:407 declares the pair the way `Sam Loop Off` does at :411, but
   * with the wrong spec on the variant:
   *
   *     dc.w  L_InSamLoopOn0,L_Nul        dc.w  L_InSamLoopOff0,L_Nul
   *     dc.b  "!sam loop o","n"+$80,"I",-2      dc.b  "sam loop of","f"+$80,"I",-2
   *     dc.w  L_InSamLoopOn1,L_Nul        dc.w  L_InSamLoopOff1,L_Nul
   *     dc.b  $80,"I",-1                  dc.b  $80,"I0",-1
   *
   * `InSamLoopOn1` (:3020) is `moveq #0,d0 / move.l d3,d1 / Rbra L_SL0`, so it
   * wants the voice mask in d3 --- but its entry's spec is "I" and not "I0",
   * so `VerC` matches the no-argument form first and the variant is never
   * reached. The shipped BINARY carries the same two bytes as the source.
   *
   * So ON is all four voices, always, and OFF still takes a mask. The masked
   * routine is reached here through a hand-built token, which is the only way
   * anything ever reached it.
   */
  it('Sam Loop On cannot be given a mask, and Sam Loop Off can', () => {
    expect(() => run('Sam Loop On %0001')).toThrow(/syntax error/i)
    expect(() => run('Sam Loop Off %0001')).not.toThrow()
    // ON with no argument is `moveq #%1111,d1` (InSamLoopOn0, :3026)
    const { audio } = run('Sam Loop On\nSam Play %0011,1')
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays.find((p) => p.voice === 0)!.loop).toBe(true)
    expect(plays.find((p) => p.voice === 1)!.loop).toBe(true)
    // live re-point: voice 1 is playing one-shot when Sam Loop On lands, and
    // `move.l d0,Sami_rpos(a0)` in SL0 re-points it without restarting
    const { audio: a2 } = run('Sam Play %0010,1\nSam Loop On')
    expect(a2.events.some((e) => e.kind === 'loop' && e.voice === 1 && e.loopStart === 0)).toBe(true)
    expect(a2.voiceState[1]!.loopStart).toBe(0)
  })

  it('applies Volume to selected voices; default is 56 (MusDef +Music.s:918)', () => {
    const { audio, rt } = run('Volume %0011,20')
    expect(rt.voices[0]!.volume).toBe(20)
    expect(rt.voices[2]!.volume).toBe(56)
    expect(audio.events.filter((e) => e.kind === 'volume')).toHaveLength(2)
  })

  it('Volume errors outside 0-63 and the 1-arg form sets music volume (InVolume1 +Music.s:2739)', () => {
    expect(() => run('Volume 64')).toThrow(/illegal function call/i)
    expect(() => run('Volume %0011,-1')).toThrow(/illegal function call/i)
    const { rt } = run('Volume 30')
    expect(rt.musicVolume).toBe(30)
    expect(rt.voices[3]!.volume).toBe(30)
    // 2-arg form leaves music volume alone
    const { rt: rt2 } = run('Volume %1111,30')
    expect(rt2.musicVolume).toBe(56)
  })

  it('Sam Raw validates length and frequency (InSamRaw +Music.s:3157)', () => {
    expect(() => run('Reserve As Work 10,1000\nSam Raw 15,Start(10),256,8000')).toThrow(/illegal function call/i)
    expect(() => run('Reserve As Work 10,1000\nSam Raw 15,Start(10),512,500')).toThrow(/illegal function call/i)
    const { audio } = run('Reserve As Work 10,1000\nSam Raw %0001,Start(10),512,8000')
    const play = audio.events.find((e) => e.kind === 'play')!
    expect(play).toMatchObject({ voice: 0, length: 512, freq: PAULA_CLOCK / samPeriod(8000) })
  })

  it('Led On/Off drives the power-LED low-pass filter (InLedOn +Music.s:3917)', () => {
    const { audio } = run('Led Off\nLed On')
    expect(audio.events.filter((e) => e.kind === 'filter').map((e) => e.filter)).toEqual([false, true])
    expect(audio.filter).toBe(true)
  })
})

describe('effects and vumeter', () => {
  it('Bell is the looped square wave on all four voices (InBell +Music.s:2681)', () => {
    const { audio } = run('Bell')
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays.map((p) => p.voice)).toEqual([0, 1, 2, 3])
    // default note 70, octave (70+2)/12 = 6 -> the 8-byte mip, looped
    expect(plays.every((p) => p.length === 8 && p.loop)).toBe(true)
    // period = clock/(8*1760Hz) = 251
    expect(plays[0]!.freq).toBeCloseTo(PAULA_CLOCK / 251)
  })

  it('Shoot and Boom play detuned noise on all four voices (Shout +Music.s:2722)', () => {
    const { audio } = run('Shoot')
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(new Set(plays.map((p) => p.voice)).size).toBe(4)
    // noise: the 510-byte refreshed buffer, looped; each voice one note apart
    expect(plays.every((p) => p.length === 510 && p.loop)).toBe(true)
    expect(new Set(plays.map((p) => p.freq)).size).toBe(4)
  })

  it('envelopes drive the volume then stop the voice (MuIntE +Music.s:3638)', () => {
    const { rt, audio } = run('Bell')
    for (let i = 0; i < 60; i++) rt.frame() // the program ended; envelopes keep running
    // EnvBell (1,64)(4,40)(25,0): volume jumps to 56, decays, voice stops
    const vols = audio.events.filter((e) => e.kind === 'volume' && e.voice === 0).map((e) => e.volume!)
    expect(vols[0]).toBe(56) // (64*56)>>6 at default voice volume 56
    expect(vols[vols.length - 1]).toBe(0)
    expect(audio.events.some((e) => e.kind === 'stop' && e.voice === 0)).toBe(true)
    expect(audio.voiceState[0]!.playing).toBe(false)
  })

  it('Vumeter reads and clears the note-on byte (FnVuMeter +Music.s:3893)', () => {
    const audio = new NullAudio()
    const rt = new Runtime(
      tokenize('Print Vumeter(2)\nPrint Vumeter(2)', table, extensions),
      table,
      { extensions, audio, banks: [sampleBank()], maxSteps: 100_000, onText: () => {} },
    )
    // the music player stores the note volume here on trigger (DoNote
    // +Music.s:1245); simulate a note-on, then the read must clear it
    rt.vuBytes[2] = 48
    let out = ''
    rt.interp.io.write = (t) => (out += t)
    rt.runHeadless(10)
    expect(out.trim().split('\n').map((s) => parseInt(s, 10))).toEqual([48, 0])
  })

  it('Vumeter is untouched by Sam Play (only the music player writes it)', () => {
    const { rt } = run('Sam Play %0001,1,8000')
    expect(rt.vumeter(0)).toBe(0)
  })

  it('Vumeter errors on voices outside 0-3', () => {
    expect(() => run('Print Vumeter(4)')).toThrow(/illegal function call/i)
  })
})
