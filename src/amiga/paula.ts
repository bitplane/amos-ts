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
 * Mixing is next door, in `mixer.ts`. `AudioSink` is the boundary beneath this
 * layer (`host.ts`): WebAudio implements it in the browser, `NullAudio`
 * records it headless, and `PaulaMixer` renders it. What Paula contributes is
 * the arithmetic every caller was repeating and the state a test can read.
 *
 * The note tables are one level further down again, in `notes.ts`, which
 * imports nothing at all — a period table is a tuning, not a chip register,
 * and the replay needs sixteen finetuned rows where the chip needs none.
 */
import { PT_PERIODS } from './notes'

/**
 * The audio clock. Paula's sample rate is this divided by AUDxPER.
 *
 * PAL is what AMOS assumes — `MusClock` (+Music.s:825) holds this value —
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
 * Vertical blanks a second, which is what turns a frame number into a time
 * for `AudioSink.runTo`.
 *
 * Here because the sink's clock is in seconds and everything driving it counts
 * frames, so somebody has to state the rate. The machine's is a shade off 50;
 * AMOS's own `Timer` counts frames rather than seconds and so never notices,
 * and 50 is the figure every player in this port is written against.
 */
export const VBL_HZ = 50

/**
 * The 68000's clock on a PAL machine: half the Paula clock, to the hertz.
 *
 * `PAULA_CLOCK_PAL / 2` is 3,546,895 and the CPU runs at 7,093,790 — the same
 * crystal, and the reason both numbers are exact rather than nominal.
 */
export const CPU_CLOCK_PAL = PAULA_CLOCK_PAL * 2

/**
 * CPU cycles in one vertical blank: 141,876 on a PAL A500.
 *
 * What the 68000 had between one display frame and the next, before chip DMA
 * took its share. Everything a program did in a frame came out of this.
 */
export const CYCLES_PER_FRAME = Math.round(CPU_CLOCK_PAL / VBL_HZ)

/**
 * Cycles AMOS spends dispatching ONE statement, doing nothing else.
 *
 * The interpreter's inner loop is `+ILib.s:505-540` and with `Debug` off the
 * steady-state path through it is seven instructions:
 *
 *     move.w  (a6)+,d0                MOVE.W (An)+,Dn           8
 *     bne.s   _Inst                   Bcc.b taken              10
 *     move.l  a6,d7                   MOVE.L An,Dn              4
 *     move.w  0(a4,d0.w),d1           MOVE.W (d8,An,Xn),Dn     14
 *     move.l  -LB_Size(a4,d1.w),a0    MOVEA.L (d8,An,Xn),An    20
 *     jsr     (a0)                    JSR (An)                 16
 *     rts                             RTS                      16
 *
 * a6 is the token stream, a4 the token table, and the routine it lands in is
 * the keyword. Every one of those figures is the published 68000 timing and
 * none of them is a measurement — the 68000 has no cache and no prefetch
 * queue worth the name, so straight-line code costs what the table says.
 *
 * DEVIATION: chip RAM wait states are not in it. A token stream in chip
 * memory loses cycles to display DMA, more of them the more bitplanes are on,
 * so this is the fast-RAM figure and the floor.
 */
export const CYCLES_PER_DISPATCH = 88

/**
 * Statements a frame could hold if every keyword body were free: 1,612.
 *
 * `CYCLES_PER_FRAME / CYCLES_PER_DISPATCH`. It was the port's frame budget
 * until the numbers below replaced it, and it was always a CEILING rather
 * than an estimate: it assumes a keyword costs nothing beyond the seven
 * instructions that reach it. Kept because it is the honest upper bound on
 * how fast AMOS could possibly have gone, and quoting it as the machine's
 * speed is the mistake it invites.
 */
export const FRAME_DISPATCHES = Math.floor(CYCLES_PER_FRAME / CYCLES_PER_DISPATCH)

/**
 * What one ordinary AMOS statement actually cost: 206 cycles.
 *
 * MEASURED, not derived. `Speed_Tests.AMOS` on APD563 of the AMOS PD Library
 * (AMOS 1.34, 640x200x2 hires) times four loop constructs over 10,000
 * iterations each and prints the result in 50Hz ticks, which is 141,876
 * cycles apiece:
 *
 *     For A=1 To 10000: Next A                    48   1 stmt/iter   681
 *     A=1: While A<10000: Inc A: Wend             29   2 stmt/iter   206
 *     A=1: Repeat: Inc A: Until A=10000           29   2 stmt/iter   206
 *     A=1: Do: Inc A: Exit If A=10000: Loop       33   3 stmt/iter   156
 *
 * Two of the four land on 206 and the fourth is 24% under it, so 206 is the
 * central figure for a statement that is not a `Next`. The spread is what a
 * per-keyword table is for; this is the floor under it.
 *
 * The same file's ADDITION group is DISCARDED and the reason is arithmetic,
 * not taste. It claims `For A=1 To 10000: Inc No: Next A` in 12 ticks, which
 * is 2,500 statements in a frame; at AMOS's own 88-cycle dispatch loop that
 * needs 220,000 cycles against the 141,876 a frame has. It cannot have
 * happened. Its RATIOS survive and are worth keeping --- Inc : Add : `No=No+1`
 * at 1 : 1.6 : 2.6, the expression evaluator showing up where you would
 * expect it.
 *
 * This is 2.3x the bare dispatch above, which is the honest size of the gap
 * that comment used to describe as unknown.
 */
export const CYCLES_PER_STATEMENT = 206

/**
 * `Next`, measured on its own: 681 cycles, 3.3 ordinary statements.
 *
 * The `For A=1 To 10000: Next A` row is the most direct number in the whole
 * set, because the loop body IS one statement --- no division, no assumption
 * about what shares the iteration. AMOS searches its loop stack for the named
 * variable, and that is what the extra 475 cycles buy.
 *
 * It also happens to be the number that matters most, because a bare
 * `For ... Next` is how AMOS programmers hand-rolled a delay. 18th Hole's
 * power bar is `For J=0 To 280 : Next J` between each step, and reproducing
 * 281 x 681 = 191,361 cycles, one and a third frames, is what makes that bar
 * stoppable instead of a blur.
 */
export const CYCLES_PER_NEXT = 681

/**
 * What `Next` charges ON TOP of the statement it already is: 2.31 statements.
 *
 * A ratio rather than a cycle count, so that a machine with a different
 * statement cost keeps the same shape instead of needing the difference
 * recomputed. Every per-keyword cost that follows should be expressed this
 * way for the same reason.
 */
export const NEXT_EXTRA_STATEMENTS = CYCLES_PER_NEXT / CYCLES_PER_STATEMENT - 1

/**
 * The port's frame budget, in CPU cycles: one PAL vertical blank.
 *
 * The unit is cycles rather than statements because every measurement we have
 * is in cycles, because a keyword's cost has no sensible expression in
 * statements, and because a machine with a different clock changes this
 * number and nothing else.
 */
export const FRAME_CYCLES = CYCLES_PER_FRAME

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

/**
 * The standard three-octave Amiga period table, C-1 at index 0.
 *
 * Equal temperament against the PAL clock, 856 down to 113 — the table every
 * tracker on the machine shipped, because a ProTracker module stores these
 * numbers literally and a replayer has to map a note back onto one.
 *
 * It was written out FOUR times before `notes.ts` existed: here, `med.ts` in
 * decimal, `music.ts` in hex, and the first row of the replay's finetuned
 * table. AMOS's own copy is at +Music.s:2150. Now it is that first row, with
 * the duplicate word at index 0 dropped — the duplicate is there so an
 * arpeggio can index off the end of a row, which is a replay concern and not
 * this one's.
 *
 * AMOS's assembled table carries TWO ZEROS after these, which its arpeggio
 * lookup reads past the end into — that padding is AMOS's and stays in
 * `music.ts` with the code that depends on it.
 *
 * NOTE: the last two entries, 120 and 113, are SHORTER than `MIN_PERIOD`.
 * The top of octave 3 is faster than Paula's DMA can service cleanly, and
 * every tracker shipped the notes anyway. The table is therefore not clamped
 * — `samPeriod` clamps a requested sample RATE, which is a different
 * question, and a module playing B-3 gets whatever the machine gave it.
 */
export const AMIGA_PERIODS: readonly number[] = Array.from(PT_PERIODS.subarray(1, 37))

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
  kind: 'play' | 'stop' | 'volume' | 'freq' | 'loop' | 'filter' | 'waveform'
  voice: number
  freq?: number
  length?: number
  volume?: number
  loop?: boolean
  loopStart?: number
  loopEnd?: number
  filter?: boolean
  /**
   * When it happened, in seconds, as `runTo` last left the clock.
   *
   * Zero for every event until somebody calls `runTo`, which is the honest
   * answer for a caller that never says when: with no clock, everything in a
   * frame does happen at once.
   */
  at?: number
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
  /** the clock `runTo` moves; every event is stamped with it */
  now = 0
  voiceState: VoiceState[] = [0, 1, 2, 3].map(() => ({
    playing: false,
    pcm: null,
    freq: 0,
    volume: 0,
    loopStart: -1,
    loopEnd: 0,
  }))

  /** the recorder's own `runTo`: it renders nothing, so it only keeps the time */
  runTo(t: number): void {
    if (t > this.now) this.now = t
  }

  private emit(e: AudioEvent): void {
    e.at = this.now
    this.events.push(e)
  }

  play(voice: number, pcm: Int8Array, freqHz: number, volume: number, loopStart: number, loopEnd?: number): void {
    const end = loopEnd ?? pcm.length
    const vol = clampVolume(volume)
    this.emit({
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
    this.emit({ kind: 'stop', voice })
    const s = this.voiceState[voice]!
    s.playing = false
    s.pcm = null
  }

  setVolume(voice: number, volume: number): void {
    const vol = clampVolume(volume)
    this.emit({ kind: 'volume', voice, volume: vol })
    this.voiceState[voice]!.volume = vol
  }

  setFrequency(voice: number, freqHz: number): void {
    this.emit({ kind: 'freq', voice, freq: freqHz })
    this.voiceState[voice]!.freq = freqHz
  }

  setLoop(voice: number, loopStart: number, loopEnd?: number): void {
    const s = this.voiceState[voice]!
    const end = loopEnd ?? s.pcm?.length ?? 0
    this.emit({ kind: 'loop', voice, loopStart, loopEnd: end })
    if (s.playing) {
      s.loopStart = loopStart
      s.loopEnd = end
    }
  }

  /**
   * The bytes change under a voice that keeps playing — see `AudioSink`.
   *
   * `voiceState.pcm` is replaced so a test reads the waveform the voice is on
   * NOW, and `playing` is deliberately not touched: a `setWaveform` on a
   * stopped voice is what the machine does when it rewrites a buffer whose
   * DMA is off, and it stays stopped.
   */
  setWaveform(voice: number, pcm: Int8Array): void {
    this.emit({ kind: 'waveform', voice, length: pcm.length })
    this.voiceState[voice]!.pcm = pcm
  }

  setFilter(on: boolean): void {
    this.emit({ kind: 'filter', voice: -1, filter: on })
    this.filter = on
  }
}
