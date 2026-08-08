/**
 * P61 1.2 — Chris Hodges' AMOS wrapper around Jarno Paananen's Player 6.1A.
 *
 * Nine keywords at slot 25 that start, stop and steer a packed ProTracker
 * module. The format itself is `src/amiga/p61.ts`; this file is only the
 * AMOS-facing half.
 *
 * ## Evidence
 *
 * SOURCE tier on both halves. `AMOSPro_P61A.Lib.s`, 349 lines, is the
 * extension; `610.2_devpac3.asm`, 2,483 lines, is the replayer it includes.
 * Every clamp, error and field below is read off the first of those.
 *
 * ## The name collision, and why these are slot-qualified
 *
 * Personnal 1.1 ALSO has `P61 Play` and `P61 Stop`, at slot 13, with
 * different arguments and a different state machine. Two extensions, one pair
 * of names. Both are registered `qualified`, so each resolves as
 * `ext<slot>:p61 play` and a program gets whichever library it actually
 * loaded rather than whichever port happened to register first.
 *
 * NOTE: before this port existed, KEYWORDS.md credited p61-1.2 with two
 * implemented keywords it had never had — `FAITHFUL` is a flat set of NAMES
 * and Personnal's two matched. p61-1.2 had no binding at all. The measure is
 * being fixed separately; the point here is that the collision is real and
 * predates the port.
 *
 * ## The state
 *
 * `O_P61Base`, `O_MusicBank`, `O_MusicAddress`, `O_SamBuffer`,
 * `O_MusicEnabled`, `O_MusicPaused`, plus the replayer's own fields reached
 * as `P61_x-P61_motuuli(a0)`: Master, FadeTo, FadeSpeed, FadeCount, Pos,
 * Patt, CRow, Tempo, E8, Play.
 */
import { AmosError, VI, funcCall } from '../interp/values'
import type { Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { p61Song, parseP61, type P61Module } from '../amiga/p61'
import { Protracker } from '../amiga/protracker'

export interface P61State {
  /** O_MusicBank / O_MusicEnabled / O_MusicPaused */
  bank: number
  enabled: boolean
  paused: boolean
  /** the decoded module, or null when Play could not read one */
  module: P61Module | null
  /** P61_Master and P61_FadeTo, both 0..64 and both set by P61 Volume */
  master: number
  fadeTo: number
  /** P61_FadeSpeed and P61_FadeCount, set together by P61 Fade */
  fadeSpeed: number
  fadeCount: number
  /** P61_Pos, P61_Patt, P61_CRow — where the song is */
  pos: number
  patt: number
  row: number
  /** P61_Tempo, and P61_Play which Pause clears and Continue sets */
  tempo: number
  play: boolean
  /**
   * P61_E8 — the info nibble the module's E8 command last left. `P61 Signal`
   * reads it AND resets it to -1, so it is a read-once mailbox.
   */
  e8: number
  /** the CIA period pair Cia Speed computes, P61_thi2 and P61_thi */
  thi2: number
  thi: number
  /**
   * Player 6.1A itself — `src/amiga/protracker.ts`, which IS this extension's
   * replayer transcribed from the source it ships. Built on the first Play so
   * a program that never plays never makes one.
   */
  replay: Protracker | null
}

/**
 * The block as `P61_motuuli` declares it: Master 64, FadeTo 64, FadeSpeed 1,
 * FadeCount 0, Tempo 1, Play 1, E8 0. Play is 1 from the start, which is why
 * a module begins the moment Init returns.
 */
export const newP61State = (): P61State => ({
  bank: 0,
  enabled: false,
  paused: false,
  module: null,
  master: 64,
  fadeTo: 64,
  fadeSpeed: 1,
  fadeCount: 0,
  pos: 0,
  patt: 0,
  row: 0,
  tempo: 1,
  play: true,
  e8: 0,
  thi2: 0,
  thi: 0,
  replay: null,
})

/** the replay, made on first use */
function replayOf(rt: Runtime): Protracker {
  const s = rt.p61
  if (!s.replay) s.replay = new Protracker(() => rt.audio)
  return s.replay
}

/**
 * `P61_Music`, from `frame()`.
 *
 * NOTE: on the machine this is a CIA interrupt at whatever `P61 Cia Speed`
 * asked for — `P61_thi2`/`P61_thi` are the timer pair — or a level 6 server,
 * and either way it runs independently of the display. This port has one 50Hz
 * clock, so a module keeps VBL tempo whatever Cia Speed was given; the keyword
 * still computes and stores the pair. AMCAF's `amcafPtVbl` records the same
 * limit from the other side, and for the same reason.
 */
export function p61Vbl(rt: Runtime): void {
  const s = rt.p61
  const r = s.replay
  if (!r || !r.playing) return
  r.tick()
  s.pos = r.pos
  s.patt = r.patt
  s.row = r.row
  // P61_E8 is one word and the replayer writes it; -2 is the song wrapping,
  // which `=P61 Signal` therefore reports as it would an E8 command
  if (r.e8 !== 0) {
    s.e8 = r.e8
    r.e8 = 0
  }
}

// `Rblt L_IFonc` is AMOS 23 — the shared funcCall().

/**
 * `P61_timer`, the CIA clock the tempo divides.
 *
 * `move.l P61_timer-P61_motuuli(a0),d1 / divu d0,d1` and the source sets it
 * from the PAL or NTSC constant at `P61_ForcePAL`/`P61_NTSC`. 1773447 is the
 * PAL half-clock the CIA counts at.
 */
const P61_TIMER = 1773447

export function makeP61Instructions(rt: Runtime): Record<string, Instr> {
  const st = (): P61State => rt.p61

  return {
    /**
     * P61 Play bank[,pos] — `L_P61Play1` and `L_P61Play2` (source:148, source:152).
     *
     * The one-argument form is two instructions, `clr.l -(a3)` then a branch
     * into the two-argument one, so a missing position is a pushed 0 and
     * `tst.l d6 / ble` then skips the seek entirely.
     *
     * It stops first, resolves the bank through `L_Bnk.OrAdr`, and steps over
     * an optional `P61A` signature. `btst #6,3(a0)` means the module wants a
     * separate sample buffer, whose size is the LONG at +4; a failed AllocVec
     * is custom error 0. Then the replayer's own fields are reset — Master
     * and FadeTo to 64, Pos, Patt and CRow to 0, Tempo to 125, E8 to -1 —
     * and P61_Init runs, a non-zero return being custom error 1.
     *
     * NOTE: Tempo is set to 125 here, not to the 1 the block declares. 125 is
     * the BPM every ProTracker module starts at, so the field is a tempo in
     * beats rather than the flag its comment ("Use tempo? 0=no") suggests.
     */
    'p61 play'(it) {
      const bank = it.evalInt()
      const pos = it.accept(',') ? it.evalInt() : 0
      const s = st()
      stop(rt)
      s.bank = bank
      const mem = rt.memBanks.get(bank)
      if (!mem) throw new AmosError('bank not reserved')
      const m = parseP61(mem.data)
      if (!m) throw new AmosError('Illegal function call', 23) // P61_Init != 0
      s.module = m
      s.master = 64
      s.fadeTo = 64
      s.pos = 0
      s.patt = 0
      s.row = 0
      s.tempo = 125
      s.e8 = -1
      s.play = true
      s.paused = false
      // P61_Init's own tail: the song into the replayer, then the fields the
      // wrapper resets on top of it
      const r = replayOf(rt)
      r.load(p61Song(m), 0)
      r.master = 64
      r.fadeTo = 64
      r.playing = true
      // `tst.l d6 / ble .nopos` — only a POSITIVE position seeks
      if (pos > 0) setPosition(s, pos)
      s.enabled = true
    },

    /**
     * P61 Stop — `L_P61Stop` (source:205). P61_End when something is playing, then FreeVec
     * over the sample buffer. Calling it with nothing playing is not an
     * error: `tst.w O_MusicEnabled(a2) / beq` skips straight to the free.
     */
    'p61 stop'() {
      stop(rt)
    },

    /**
     * P61 Pause — `L_P61Pause` (source:221). Clears P61_Play, sets O_MusicPaused, and then
     * silences the hardware itself: `move d0,$a8(a0)` through `$d8` zeroes
     * all four AUDxVOL and `move #$f,$96(a0)` clears the four audio DMA bits
     * in DMACON. Pausing an already-paused module does nothing at all —
     * `tst.l O_MusicPaused(a2) / bne .skip` — so the volumes are not zeroed
     * twice.
     */
    'p61 pause'() {
      const s = st()
      if (s.paused) return
      s.play = false
      s.paused = true
      if (s.replay) s.replay.playing = false
      for (let v = 0; v < 4; v++) rt.audio?.setVolume?.(v, 0)
      // the four registers were written from outside the replay
      s.replay?.forget()
    },

    /**
     * P61 Continue — `L_P61Continue` (source:237). P61_Play back to 1 and O_MusicPaused to
     * 0, and nothing else: the DMA Pause turned off comes back when the
     * replayer next triggers a note.
     *
     * Unlike Pause it is NOT guarded, so continuing a module that was never
     * paused still sets Play — which is how a program can restart one it
     * stopped by poking Play directly.
     */
    'p61 continue'() {
      const s = st()
      s.play = true
      s.paused = false
      if (s.replay && s.replay.song) s.replay.playing = true
    },

    /**
     * P61 Volume v — `L_P61Volume` (source:244). Clamped to 0..64 with two one-sided
     * tests: `bpl` sends a negative to 0 and `cmp.w #64,d0 / blt` sends
     * anything from 64 up to 64.
     *
     * It sets Master AND FadeTo together, so a volume change cancels a fade
     * in progress rather than being overtaken by it.
     */
    'p61 volume'(it) {
      const v = it.evalInt()
      const s = st()
      const c = v < 0 ? 0 : v >= 64 ? 64 : v
      s.master = c
      s.fadeTo = c
      if (s.replay) {
        s.replay.master = c
        s.replay.fadeTo = c
      }
    },

    /**
     * P61 Cia Speed bpm — `L_P61CiaSpeed` (source:257). Clamped to 32..255, then
     * `P61_timer / bpm` becomes thi2 and `thi = thi2 - $1f0*2`.
     *
     * The clamp reads oddly and is transcribed as written: `cmp.w #32,d0 /
     * bgt .no32` sets 32 when the value is 32 or BELOW, and `cmp.w #255,d0 /
     * blt .no255` sets 255 when it is 255 or above. So 32 itself is replaced
     * by 32 and 255 by 255 — the same number, harmlessly.
     */
    'p61 cia speed'(it) {
      const bpm = it.evalInt()
      const s = st()
      const c = bpm <= 32 ? 32 : bpm >= 255 ? 255 : bpm
      s.thi2 = Math.floor(P61_TIMER / c) & 0xffff
      s.thi = (s.thi2 - 0x1f0 * 2) & 0xffff
    },

    /**
     * P61 Fade speed[,vol] — `L_P61Fade1` and `L_P61Fade2` (source:284, source:288).
     *
     * The one-argument form pushes 0 first, so `P61 Fade 5` fades OUT: the
     * missing target is zero, not the current volume. The target is popped
     * first and the speed second, and `Rblt L_IFonc` makes a negative speed
     * an Illegal Function Call. FadeSpeed and FadeCount are both loaded, so
     * the first step happens after a full period rather than immediately.
     */
    'p61 fade'(it) {
      const speed = it.evalInt()
      const vol = it.accept('to') ? it.evalInt() : 0
      const s = st()
      s.fadeTo = vol & 0xffff
      if (speed < 0) funcCall()
      s.fadeSpeed = speed & 0xffff
      s.fadeCount = speed & 0xffff
      if (s.replay) {
        s.replay.fadeTo = s.fadeTo
        s.replay.fadeSpeed = s.fadeSpeed
        s.replay.fadeCount = s.fadeCount
      }
    },
  }
}

/** `L_P61Stop`'s body, which P61 Play calls before anything else. */
function stop(rt: Runtime): void {
  const s = rt.p61
  if (s.enabled) {
    s.enabled = false
    for (let v = 0; v < 4; v++) rt.audio?.setVolume?.(v, 0)
  }
  // P61_End, which the replayer's own `stop` is: the voices it holds go quiet
  if (s.replay) s.replay.stop()
  s.module = null
  s.paused = false
}

/**
 * `P61_SetPosition` (source:691), reached as function 3 of `L_P61Func`.
 *
 * `moveq #0,d1 / move.b d0,d1` takes only the LOW BYTE of the position, then
 * `cmp P61_slen,d0 / blo` replaces anything at or past the song length with
 * 0. So seeking past the end restarts rather than erroring, and a position
 * above 255 wraps into the byte first.
 */
function setPosition(s: P61State, pos: number): void {
  const len = s.module ? s.module.positions.length : 0
  const p = pos & 0xff
  s.pos = len > 0 && p < len ? p : 0
  s.row = 0
  s.patt = s.module?.positions[s.pos] ?? 0
  s.replay?.setPosition(pos)
}

export function makeP61Functions(rt: Runtime): Record<string, Func> {
  return {
    /**
     * =P61 Signal — `L_P61Signal` (source:274). Reads P61_E8 and writes -1 back over it in
     * the same breath, so the value is delivered once and a second read gets
     * -1 until the module's next E8 command.
     *
     * That makes it a one-shot mailbox rather than a status register: a game
     * puts E8 commands in the module where it wants the graphics to change,
     * and polls this until something arrives.
     */
    'p61 signal': (): Value => {
      const s = rt.p61
      const v = (s.e8 << 16) >> 16
      s.e8 = -1
      return VI(v)
    },

    /** =P61 Pos — `L_P61Pos` (source:299), the song position as a signed word. */
    'p61 pos': (): Value => VI((rt.p61.pos << 16) >> 16),
  }
}
