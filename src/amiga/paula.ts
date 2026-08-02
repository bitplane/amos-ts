/**
 * Paula's four audio voices — clock, period, volume, and the sink boundary.
 *
 * ## Why this exists
 *
 * There are already **two** module replayers in this port, and neither owns
 * the chip they both drive:
 *
 * - `runtime/music.ts`, AMOS's own tracker (+Music.s)
 * - `runtime/med.ts`, a reimplementation of the MMD0/MMD1 format behind
 *   `Med Play`, because medplayer.library is not part of the AMOS source
 *
 * Both imported `periodToHz` out of `runtime/audio.ts`, and P61 Music and
 * AMCAF's ProTracker would make four callers of a period table that lived
 * beside one of them. That is the shape the date arithmetic had before
 * `datestamp.ts` — written once per caller until somebody counted.
 *
 * ## What the consolidation found
 *
 * The sink's volume parameter was named `volume63` and documented as AMOS's
 * 0..63, but `med.ts` computes `Math.min(64, ...)` in four places — because
 * **64 is right**. AUDxVOL is six bits and Paula treats anything above 64 as
 * 64, so full scale is 64 and AMOS's own maximum of 63 is genuinely one step
 * below it. `web/audio.ts` divided by 63, so a MED voice at full volume asked
 * for 64/63 of unity gain and every AMOS voice was rendered a step too loud.
 *
 * The chip's range is the one that belongs here: `MAX_VOLUME` is 64, and
 * `clampVolume` is what a sink applies. AMOS using only 0..63 of it is AMOS's
 * business, and its keywords still clamp where they always did.
 *
 * ## What is NOT here
 *
 * The AMOS `Samples` bank (bank 5) stays in `runtime/audio.ts`. Its layout —
 * a count, a table of offsets, then `name[8]`, freq, length, PCM — is a file
 * format AMOS invented and parses in `GetSam`; Paula never sees it. Same rule
 * that keeps `bobBltcon0` out of `blitter.ts`.
 *
 * Mixing is absent, deliberately. Nothing here renders samples: `AudioSink`
 * is the boundary beneath this layer (`host.ts`), WebAudio implements it in
 * the browser and `NullAudio` records it headless. What Paula contributes is
 * the arithmetic every caller was repeating and the state a test can read.
 */

/**
 * The audio clock. Paula's sample rate is this divided by AUDxPER.
 *
 * PAL is what AMOS assumes — `MusClock` (+Music.s:851) holds this value —
 * and the NTSC figure is here because `Set Ntsc` exists and a program that
 * switches gets a different pitch on the machine.
 */
export const PAULA_CLOCK_PAL = 3546895
export const PAULA_CLOCK_NTSC = 3579545
/** the default, and what every caller meant when it said PAULA_CLOCK */
export const PAULA_CLOCK = PAULA_CLOCK_PAL

/**
 * The shortest period the DMA can service: two colour clocks a word, so
 * ~28.6kHz. AMOS clamps to exactly this in `SPl0` (+Music.s:3316-3322).
 */
export const MIN_PERIOD = 124

/**
 * AUDxVOL is six bits and saturates at 64, which is unity gain — NOT 63.
 * AMOS's keywords use 0..63 and so never reach full scale, which is a fact
 * about AMOS rather than about Paula.
 */
export const MAX_VOLUME = 64

/** AUDxPER for a requested sample rate: clock/freq, floored, never below the DMA limit */
export function samPeriod(freqHz: number, clock = PAULA_CLOCK): number {
  return Math.max(MIN_PERIOD, Math.floor(clock / Math.max(1, freqHz)))
}

/** the rate Paula actually plays at for a given period */
export function periodToHz(period: number, clock = PAULA_CLOCK): number {
  return clock / Math.max(1, period)
}

/** AUDxVOL as the chip sees it: 0..64, saturating rather than wrapping */
export function clampVolume(v: number): number {
  return v < 0 ? 0 : v > MAX_VOLUME ? MAX_VOLUME : v
}

/** unity-referenced gain for a AUDxVOL value — what a rendering sink wants */
export function volumeGain(v: number): number {
  return clampVolume(v) / MAX_VOLUME
}

/**
 * The sink is a HOST capability and lives in `host.ts` beside `clock`,
 * `printer` and `serial` — what the outside world supplies, rather than
 * something the chip owns. Re-exported here because every caller of the audio
 * layer wants the two together.
 */
import type { AudioSink } from './host'
export type { AudioSink } from './host'

export interface AudioEvent {
  kind: 'play' | 'stop' | 'volume' | 'freq' | 'loop' | 'filter'
  voice: number
  freq?: number
  length?: number
  volume?: number
  loop?: boolean
  loopStart?: number
  loopEnd?: number
  filter?: boolean
}

/**
 * What a voice is doing right now — AUDxLC, AUDxLEN, AUDxPER and AUDxVOL as
 * a reader can see them, plus whether its DMA bit is on.
 *
 * This is the per-frame oracle every player test reads, which is the other
 * reason it belongs to the chip rather than to one of the players.
 */
export interface VoiceState {
  playing: boolean
  pcm: Int8Array | null
  freq: number
  volume: number
  loopStart: number
  loopEnd: number
}

/** headless sink: records the event stream and the live per-voice state */
export class NullAudio implements AudioSink {
  events: AudioEvent[] = []
  /** the LED filter, which is CIA-A's PRA bit 1 rather than Paula's own */
  filter = true
  voiceState: VoiceState[] = [0, 1, 2, 3].map(() => ({
    playing: false,
    pcm: null,
    freq: 0,
    volume: 0,
    loopStart: -1,
    loopEnd: 0,
  }))

  play(voice: number, pcm: Int8Array, freqHz: number, volume: number, loopStart: number, loopEnd?: number): void {
    const end = loopEnd ?? pcm.length
    const vol = clampVolume(volume)
    this.events.push({
      kind: 'play', voice, freq: freqHz, length: pcm.length, volume: vol,
      loop: loopStart >= 0, loopStart, loopEnd: end,
    })
    const s = this.voiceState[voice]!
    s.playing = true
    s.pcm = pcm
    s.freq = freqHz
    s.volume = vol
    s.loopStart = loopStart
    s.loopEnd = end
  }

  stop(voice: number): void {
    this.events.push({ kind: 'stop', voice })
    const s = this.voiceState[voice]!
    s.playing = false
    s.pcm = null
  }

  setVolume(voice: number, volume: number): void {
    const vol = clampVolume(volume)
    this.events.push({ kind: 'volume', voice, volume: vol })
    this.voiceState[voice]!.volume = vol
  }

  setFrequency(voice: number, freqHz: number): void {
    this.events.push({ kind: 'freq', voice, freq: freqHz })
    this.voiceState[voice]!.freq = freqHz
  }

  setLoop(voice: number, loopStart: number, loopEnd?: number): void {
    const s = this.voiceState[voice]!
    const end = loopEnd ?? s.pcm?.length ?? 0
    this.events.push({ kind: 'loop', voice, loopStart, loopEnd: end })
    if (s.playing) {
      s.loopStart = loopStart
      s.loopEnd = end
    }
  }

  setFilter(on: boolean): void {
    this.events.push({ kind: 'filter', voice: -1, filter: on })
    this.filter = on
  }
}
