/**
 * MED 7.1 — Haiko Lemser's OctaMED extension, at slot 19.
 *
 * Twenty-eight keywords that load a MED module from a FILE (not a bank) and
 * drive it through one of OctaMED's three shared player libraries. The
 * extension itself plays nothing: every keyword is a mode test followed by a
 * `jsr -$xx(a6)` on whichever library `Med Load` selected.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier. `MED.Lib`, a 4,120-byte code hunk — small because it is a
 * shim — plus `MED.Guide` beside it, in German. Every routine below has been
 * read; the Guide contributes the LIBRARY defaults the shim never writes, and
 * is cited where it does.
 *
 * ## Identity, settled off the binary
 *
 * The Aminet upload field says `Version: 7.0`. The binary says
 * `$VER: MED Extension V7.1 by Haiko Lemser` at $380, so it is 7.1.
 *
 * The slot is 19, three ways over. Routine 0 does
 *
 *     lea.l  $380(pc), a3
 *     move.l a3, $218(a5)          the slot's data pointer
 *     lea.l  $312(pc), a0
 *     move.l a0, $21c(a5)          the slot's DEFAULT routine
 *     ...
 *     moveq  #$12, d0              and returns 18
 *
 * A slot's entry is sixteen bytes at `$f8 + (slot-1)*16`, so `$218` is
 * `(0x218 - 0xf8)/16 + 1 = 19`, `$21c` is that entry's +$4 — which is the
 * DEFAULT hook, exactly as +Equ.s describes — and the `moveq #$12` return is
 * the same slot zero-based. The formula was calibrated first on three ports
 * whose slots were already known: tome-4.23 `$158` → 7, powerbobs-1.0 `$1b8`
 * → 13, p61-1.2 `$278` → 25.
 *
 * ## The three libraries, and which of them this port has
 *
 * Routine 0 opens all three with `moveq #$7,d0` — version 7 or better —
 * and stores the bases at $3e6, $3ea, $3ee:
 *
 *     mode 0  medplayer.library       4 channel      MMD0 / MMD1
 *     mode 1  octaplayer.library      5-8 channel    MMD2
 *     mode 2  octamixplayer.library   0-64 channel   MMD3
 *
 * This port has the first. `runtime/med.ts` is a reimplementation of MMD0/MMD1
 * replay written for the stock Music extension's `Med Play`, and it is the
 * same four-channel job medplayer.library does, so `medplayer.library` is
 * declared present in `../amiga/exec.ts` and mode 0 is fully served.
 *
 * The other two mix several voices into each of Paula's four in software, and
 * this port has no mixer at all — `../amiga/paula.ts` says so in as many
 * words. They are therefore declared ABSENT rather than faked, which is a
 * case the extension already handles and reports in its own German: `Med Load
 * "x",1` raises *"octaplayer.library V7.+ nicht geöffnet"*, exactly as it
 * would on an Amiga with the libraries not installed.
 *
 * DEVIATION: on the machine that same call would not report anything, it
 * would crash. Routine 37 — the presence check — reads the mode from $3f6,
 * and `Med Load` calls it at $684 BEFORE storing the new mode at $68a. So a
 * program whose first call is `Med Load "x",1` gets mode 0 checked, passes,
 * and then reaches `movea.l $3ea.l,a6 / jsr -$3c(a6)` with $3ea still zero.
 * `Med Fast Load` has the identical ordering ($b14 before $b1a). This port
 * checks the NEW mode's library before dispatching and raises error 5 or 6,
 * because a jump through address zero is not behaviour to reproduce.
 *
 * ## The state, at its absolute addresses in the library's own data
 *
 *   $3e6  medplayer.library base       $3f2  the loaded module
 *   $3ea  octaplayer.library base      $3f6  the mode, 0 at boot
 *   $3ee  octamixplayer.library base   $3f8/$3fc  Med Get Player's scratch
 *
 * ## The DEFAULT hook is a documented leak
 *
 * The routine at $312, stored into $21c(a5), is called for every occupied
 * slot when AMOS runs `Default`. It stops and frees the player on each of the
 * three libraries and then does `move.l #$0,$3f2.l` — it never closes a
 * library and it never frees the MODULE. The Guide is candid about the
 * consequence: after a Ctrl+C, *"gibt es nur eine möglichkeit den Speicher
 * wieder frei zu geben...(Eine Reset,Kaltstart,Reboot)"*. This port drops the
 * reference, which a garbage collector then reclaims; the program cannot tell
 * the difference, since either way the pointer is gone.
 *
 * ## The nag screen that is never shown
 *
 * $403..$561 holds a shareware panel — *"MusicMaker (MED.Lib) Erweiterung für
 * AMOS 1.3"*, *"Vollversion für nur 10.00 DM"*, *"Drücken Sie die linke
 * Maus-Taste für weiter"* — and error 9 is *"DEMO Version !!! Keine Fehler
 * Meldungen."*. Neither is reachable: no routine holds a `lea` to $403, and
 * no caller passes 9 to the error raiser. So this build is the full version
 * carrying its demo build's data, and there is nothing to reproduce or skip.
 *
 * ## Contested names
 *
 * `Med Load`, `Med Play` and `Med Stop` are also the stock Music extension's,
 * with different arguments — the core takes a BANK, this takes a filename and
 * a mode. All three are registered `qualified`, so each resolves as
 * `ext19:<name>` and a program gets whichever library it actually loaded.
 * `Med Continue` does not collide: the core spells its resume `Med Cont`.
 */
import { AmosError, VI, VS, int, str } from '../interp/values'
import type { Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import { Runtime } from './runtime'
import { MedPlayer } from './med'
import { openLibrary } from '../amiga/exec'

/**
 * Routine 38's message table at $ec0 — ten NUL-separated German strings, and
 * the index in d0 is 0-based (the table begins ON the first string, where
 * AMCAF's equivalent begins on a terminator).
 *
 * Every raiser in the library lands on the right one: routine 37 passes 0, 5
 * and 6 for its three libraries, `Med Load` passes 2 then 7 then 1, `Med Fast
 * Load` passes 2 then 7 then 8, and every keyword needing a module passes 3.
 * 4 and 9 have no caller.
 *
 * The delivery is a REQUESTER, not a trappable AMOS error — `Rjmp
 * L_ErrorExt` with `moveq #$12,d2`, the same shape as AMCAF's routine 397.
 * A message-carrying AmosError is how this port already spells that.
 */
export const MED_ERRORS = [
  'medplayer.library V7.+ nicht geöffnet',
  'Lade Fehler',
  'Player reserviert',
  'Kein MED Modul geladen',
  'Player schon installiert',
  'octaplayer.library V7.+ nicht geöffnet',
  'octamixplayer.library V7.+ nicht geöffnet',
  'Mode Nummer nicht gültig',
  'Fast Lade Fehler',
  'DEMO Version !!! Keine Fehler Meldungen.',
]

/** routine 38 ($eb0) — the requester, by the index the caller puts in d0 */
const medErr = (n: number): never => {
  throw new AmosError(MED_ERRORS[n] ?? `MED error ${n}`)
}

export interface MedExtState {
  /** $3e6, $3ea, $3ee — what OpenLibrary(name, 7) returned in routine 0 */
  medBase: number
  octaBase: number
  octaMixBase: number
  /** $3f2 — the loaded module; null is the pointer being zero */
  module: Uint8Array | null
  /** $3f6 — 0 medplayer, 1 octaplayer, 2 octamixplayer. Routine 0 clears it */
  mode: number
  /** the replayer `Med Init Player` installs, and the MIDI flag it takes */
  player: MedPlayer | null
  midi: boolean
  /** Med Set Mod Nr — the sub-song, and every Load puts it back to 0 */
  modNr: number
  /** Med Set Hq (mode 1 only), 0 = off per the Guide's default */
  hq: number
  /** Med Fastplay On/Off, and the output buffer it takes; 64 when omitted */
  fastPlay: boolean
  fastBuffer: number
  /** the module came from Med Fast Load rather than Med Load */
  fastLoaded: boolean
  /** Med 14bit Mode On/Off (mode 2 only). The Guide: default is ALWAYS on */
  bit14: boolean
  /** Med Set Mixing Freq / Med Set Mixbuffer (mode 2 only), Guide defaults */
  mixFreq: number
  mixBuffer: number
}

/**
 * Routine 0 ($2aa), which is all of the extension's startup.
 *
 * Three OpenLibrary calls, `move.l #$0,$3f6.l`, and nothing else — no
 * allocation, no module, no player. Everything below the three bases is this
 * port's own bookkeeping or a Guide-documented library default.
 */
export const newMedExtState = (): MedExtState => ({
  medBase: openLibrary('medplayer.library', 7),
  octaBase: openLibrary('octaplayer.library', 7),
  octaMixBase: openLibrary('octamixplayer.library', 7),
  module: null,
  mode: 0,
  player: null,
  midi: false,
  modNr: 0,
  // Med Set Hq: "0 = aus (Default)"
  hq: 0,
  fastPlay: false,
  // Med Fastplay On: "Als Default Wert ist 64 installiert"
  fastBuffer: 0x40,
  fastLoaded: false,
  // Med 14bit Mode: "Als Default Einstellung ist der 14 Bit Modus IMMER an"
  bit14: true,
  // Med Set Mixing Freq: "Als Default ist diese IMMER auf 15000 gesetzt"
  mixFreq: 15000,
  // Med Set Mixbuffer: "Als Default ist der Mixbuffer auf 1024 gesetzt"
  mixBuffer: 1024,
})

/**
 * Routine 37 ($e52) — the library the CURRENT mode needs is open, or the
 * matching message.
 *
 * Three `cmpi.l` against $3f6 and an `rts` for anything else, so a mode
 * outside 0..2 passes silently; only `Med Load` and `Med Fast Load` reject
 * one, and they do it after this runs.
 */
function checkPlayer(st: MedExtState): void {
  if (st.mode === 0 && !st.medBase) medErr(0)
  if (st.mode === 1 && !st.octaBase) medErr(5)
  if (st.mode === 2 && !st.octaMixBase) medErr(6)
}

/**
 * The `movea.l $3f2.l,a0 / tst.l $3f2.l / bne / moveq #$3,d0 / Rbra 38` that
 * opens fourteen of the nineteen instructions.
 *
 * NOTE which keywords do NOT have it: `Med Set Hq`, `Med Fast Load`, the four
 * fastplay routines, `Med 14bit Mode On/Off`, `Med Set Mixing Freq`, `Med Set
 * Mixbuffer`, `Med Get Player`, and the five plain struct readers.
 */
function needModule(st: MedExtState): Uint8Array {
  if (!st.module) medErr(3)
  return st.module!
}

/**
 * The base address `Med Mod Base` reports.
 *
 * One region for one module: `Med Load` refuses to run while $3f2 is
 * non-zero, so two modules can never be loaded at once and the address is
 * constant for the run. See Runtime.MED_MODULE_BASE.
 */
const modBase = (rt: Runtime): number => (rt.medExt.module ? Runtime.MED_MODULE_BASE : 0)

/**
 * Which of the three libraries a file needs, from its identifier.
 *
 * Routine 15 asks medplayer.library: LoadModule (-$48), a query at -$6c, then
 * UnLoadModule (-$4e), which is why the Guide warns *"zum prüfen wird das
 * gesamte Modul in den Speicher geladen und anschließend wieder entfernt"*.
 * The answer that query gives is fixed by the module's generation, and the
 * Guide's own mode table says which is which: MMD0 and MMD1 are the four
 * channel format medplayer plays, MMD2 is octaplayer's, MMD3 is
 * octamixplayer's.
 *
 * NOTE: routine 15 has NO failure path. A file that is not a module at all
 * leaves d0 from LoadModule at zero and the query then runs on a null
 * pointer. Nothing here can reproduce that, so a non-module answers 0, which
 * is what the register would have held had the query returned nothing.
 */
function playerFor(data: Uint8Array): number {
  const id = String.fromCharCode(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0)
  if (id === 'MMD2') return 1
  if (id === 'MMD3') return 2
  return 0
}

/** LoadModule's own verdict: a MED module, or the null it returns instead */
const isModule = (data: Uint8Array): boolean =>
  ['MMD0', 'MMD1', 'MMD2', 'MMD3'].includes(
    String.fromCharCode(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0),
  )

/**
 * Install the module on the runtime, which is what makes `Med Mod Base`'s
 * address resolve. Clearing it is the `move.l #$0,$3f2.l` in `Med Unload`
 * and in the DEFAULT hook.
 */
function setModule(rt: Runtime, data: Uint8Array | null): void {
  rt.medExt.module = data
  rt.medModule = data
}

/**
 * A replayer over the extension's own module.
 *
 * `MedPlayer` was written for the Music extension, where the module is a
 * memory bank and `MedCheck` (+Music.s:4567) stops replay when that bank is
 * freed or replaced. MED 7.1 has no bank, so the host answers with a pseudo-
 * bank named `Med` whose data is $3f2 — which makes the same check mean the
 * right thing here: replay stops when `Med Unload` clears the pointer.
 */
function newPlayer(rt: Runtime): MedPlayer {
  const st = rt.medExt
  const bank = { name: 'Med', get data(): Uint8Array { return st.module ?? new Uint8Array(0) } }
  return new MedPlayer({
    get audio() {
      return rt.audio
    },
    tick: () => rt.interp.tick,
    getBank: () => (st.module ? bank : null),
  })
}

/**
 * The two Load routines, which differ only in their LVOs and their failure
 * message: routine 5 ($672) reports 1 and routine 17 ($b02) reports 8.
 *
 * Both: refuse if a module is already loaded (2), check the OLD mode's
 * library, store the NEW mode, reject a mode outside 0..2 (7), then load.
 */
function medLoad(rt: Runtime, path: string, mode: number, fast: boolean): void {
  const st = rt.medExt
  if (st.module) medErr(2)
  checkPlayer(st)
  st.mode = mode
  if (mode !== 0 && mode !== 1 && mode !== 2) medErr(7)
  // DEVIATION: the machine dispatches through the new mode's base without
  // testing it, and jumps through zero when that library never opened
  checkPlayer(st)
  const data = rt.fs?.read(path)
  if (!data || !isModule(data)) medErr(fast ? 8 : 1)
  setModule(rt, data!)
  st.fastLoaded = fast
  // "da dieser Befehl beim laden IMMER auf NULL gesetzt wird" --- Med Set Mod Nr
  st.modNr = 0
}

export function makeMedExtInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): MedExtState => rt.medExt

  return {
    /**
     * Med Load "file",mode — routine 5 ($672).
     *
     * `movem.l (a3)+,d2/a0` pops the mode into d2 and the string into a0, and
     * `move.w (a0)+,d1` steps a0 past the AMOS length word: d1 is a scratch
     * register, not an argument, which routine 15 confirms by doing the same
     * skip as `adda.l #$2,a0` instead.
     */
    'med load'(it) {
      const path = it.evalStr()
      it.expect(',')
      medLoad(rt, path, it.evalInt(), false)
    },

    /**
     * Med Fast Load "file",mode — routine 17 ($b02).
     *
     * Byte for byte routine 5 with three different LVOs and error 8 in place
     * of error 1. The Guide: the module is loaded into and played from FAST
     * ram, and it says the distinction is moot for MMD3, which
     * octamixplayer plays from fast ram either way.
     *
     * NOTE: this port has one flat address space and no chip/fast split for a
     * loaded module, so the only thing the choice changes here is what
     * `Med Is Fastplaying` reports.
     */
    'med fast load'(it) {
      const path = it.evalStr()
      it.expect(',')
      medLoad(rt, path, it.evalInt(), true)
    },

    /**
     * Med Play — routine 3 ($584). PlayModule on the mode's library.
     *
     * The Guide warns to run `Med Init Player` first and routine 3 does not
     * check, so nor does this — but where the machine would call PlayModule
     * with no player installed and get whatever medplayer.library does about
     * it, this installs one rather than inventing a failure.
     */
    'med play'() {
      const s = st()
      needModule(s)
      checkPlayer(s)
      if (!s.player) s.player = newPlayer(rt)
      s.player.play(0, s.modNr)
    },

    /** Med Stop — routine 4 ($5fe). StopPlayer; needs a module first. */
    'med stop'() {
      const s = st()
      needModule(s)
      checkPlayer(s)
      s.player?.stop()
    },

    /**
     * Med Continue — routine 9 ($82c). ContModule.
     *
     * The token table spells it `med continue`; the Guide's node title says
     * "Med Continus". The binary wins.
     */
    'med continue'() {
      const s = st()
      needModule(s)
      checkPlayer(s)
      s.player?.cont()
    },

    /**
     * Med Init Player 0/1 — routine 7 ($73c). GetPlayer, with the argument
     * reaching the library in d0: the Guide says 0 = no MIDI, 1 = MIDI.
     *
     * NOTE: no MIDI output exists in this port — `med.ts` says the same of
     * the core `Med Midi On` — so the flag is stored and nothing sends to it.
     * The observable half, the module check, is reproduced.
     */
    'med init player'(it) {
      const s = st()
      needModule(s)
      const midi = it.evalInt()
      checkPlayer(s)
      s.midi = midi !== 0
      s.player ??= newPlayer(rt)
    },

    /**
     * Med Free Player — routine 8 ($7b8). FreePlayer.
     *
     * The Guide: *"Dieser Befehl STOPT und entfernt die MED Player Routine"*,
     * so the stop is the library's, not a second `Med Stop`.
     */
    'med free player'() {
      const s = st()
      needModule(s)
      checkPlayer(s)
      s.player?.stop()
      s.player = null
    },

    /**
     * Med Unload — routine 11 ($8d6), and the only routine that calls two
     * others: `Rbsr routine 4` then `Rbsr routine 8`, Med Stop then Med Free
     * Player, before UnLoadModule and `move.l #$0,$3f2.l`.
     *
     * The Guide is emphatic that a program must call it, which is the same
     * leak the DEFAULT hook has.
     */
    'med unload'() {
      const s = st()
      needModule(s)
      s.player?.stop()
      s.player = null
      checkPlayer(s)
      setModule(rt, null)
    },

    /**
     * Med Set Tempo n — routine 10 ($8a6).
     *
     * NOTE: it calls medplayer's -$42 whatever the mode is — no dispatch at
     * all, unlike its neighbours. The Guide's range is 0-240, with 1-10 the
     * ProTracker tempos; the routine clamps nothing, so nor does this.
     */
    'med set tempo'(it) {
      const s = st()
      needModule(s)
      const t = it.evalInt()
      checkPlayer(s)
      s.player?.setTempo(t)
    },

    /**
     * Med Set Mod Nr n — routine 13 ($990). SetModnum, the sub-song.
     *
     * The Guide: call it BEFORE `Med Play`, and a Load always resets it to 0.
     * That ordering is why this stores it for the next Play rather than
     * repositioning a running module.
     */
    'med set mod nr'(it) {
      const s = st()
      needModule(s)
      const n = it.evalInt()
      checkPlayer(s)
      s.modNr = n
    },

    /**
     * Med Reset Midi — routine 12 ($962). medplayer's -$5a, no dispatch.
     *
     * NOTE: nothing to reset — this port has no MIDI output, as `med.ts`
     * records for `Med Midi On`. The module check is the observable half and
     * it is reproduced.
     */
    'med reset midi'() {
      const s = st()
      needModule(s)
      checkPlayer(s)
    },

    /**
     * Med Reloc — routine 14 ($a06).
     *
     * NOTE: what the library does here is not knowable from this binary. The
     * Guide's own author wrote *"Dieser Befehl setzt ein geladenes MED Modul
     * in den Uhrsprungs Zustand zurück. ???"* — with the question marks. Put
     * back to its original state is modelled as re-seating the module at the
     * current sub-song, position zero, without starting it, which is what
     * `Med Play` does minus the start.
     */
    'med reloc'() {
      const s = st()
      needModule(s)
      checkPlayer(s)
      if (s.player) {
        s.player.play(0, s.modNr)
        s.player.stop()
      }
    },

    /**
     * Med Set Hq 0/1 — routine 16 ($ad4). MODE 1 ONLY: a single `cmpi.l #$1,
     * $3f6.l / beq`, and every other mode returns having done nothing.
     *
     * It is also one of the five instructions with no module check. The Guide
     * sends the reader to OctaMED's own documentation for what HQ means.
     */
    'med set hq'(it) {
      const s = st()
      const v = it.evalInt()
      checkPlayer(s)
      if (s.mode === 1) s.hq = v
    },

    /**
     * Med Fastplay On [buffer] — routines 25 ($c70) and 26 ($cc6).
     *
     * Two routines for one keyword: 25 takes no argument and loads `move.l
     * #$40,d1`, 26 pops the buffer into d1. Both set d0 to 1. Mode 0 calls
     * medplayer's -$7e and mode 1 octaplayer's -$6c; mode 2 falls straight to
     * the exit, having done nothing.
     *
     * The Guide's rules for the buffer — divisible by 4, strictly between 4
     * and 400 — are the LIBRARY's, and neither routine enforces them, so
     * neither does this.
     */
    'med fastplay on'(it) {
      const s = st()
      const buf = it.atStmtEnd() ? 0x40 : it.evalInt()
      checkPlayer(s)
      if (s.mode === 0 || s.mode === 1) {
        s.fastPlay = true
        s.fastBuffer = buf
      }
    },

    /**
     * Med Fastplay Off [buffer] — routines 27 ($d18) and 28 ($d6e), the same
     * pair with `move.l #$0,d0`.
     *
     * The Guide: pass the same buffer you passed to `Med Fastplay On`, or
     * neither.
     */
    'med fastplay off'(it) {
      const s = st()
      const buf = it.atStmtEnd() ? 0x40 : it.evalInt()
      checkPlayer(s)
      if (s.mode === 0 || s.mode === 1) {
        s.fastPlay = false
        s.fastBuffer = buf
      }
    },

    /**
     * Med 14bit Mode On — routine 29 ($dc0), which is `moveq #$1,d0 / bra` into
     * routine 30's body at $dd0. MODE 2 ONLY.
     */
    'med 14bit mode on'() {
      const s = st()
      checkPlayer(s)
      if (s.mode === 2) s.bit14 = true
    },

    /** Med 14bit Mode Off — routine 30 ($dc8), the `moveq #$0,d0` entry. */
    'med 14bit mode off'() {
      const s = st()
      checkPlayer(s)
      if (s.mode === 2) s.bit14 = false
    },

    /**
     * Med Set Mixing Freq f — routine 31 ($dfa). MODE 2 ONLY.
     *
     * The Guide's 1000..65535 is the library's rule and this routine does not
     * check it, so the value is stored as given.
     */
    'med set mixing freq'(it) {
      const s = st()
      const f = it.evalInt()
      checkPlayer(s)
      if (s.mode === 2) s.mixFreq = f
    },

    /** Med Set Mixbuffer n — routine 32 ($e26). MODE 2 ONLY, unchecked. */
    'med set mixbuffer'(it) {
      const s = st()
      const n = it.evalInt()
      checkPlayer(s)
      if (s.mode === 2) s.mixBuffer = n
    },
  }
}

export function makeMedExtFunctions(rt: Runtime): Record<string, Func> {
  const st = (): MedExtState => rt.medExt

  return {
    /**
     * =Med Pointer — routine 6 ($70a). medplayer's -$54, whatever the mode.
     *
     * DEVIATION: the Guide says this one is unreliable — *"soll eigentlich
     * die korrekte Startadresse ... zurück geben. Aber leider tut er das
     * nicht immer korrekt"* — and that `Med Mod Base` exists BECAUSE of it.
     * The inaccuracy is inside a library this port does not have, so the two
     * agree here where on the machine they sometimes would not.
     */
    'med pointer': (): Value => {
      const s = st()
      needModule(s)
      checkPlayer(s)
      return VI(modBase(rt))
    },

    /**
     * =Med Mod Base — routine 23 ($bea), which is `move.l $3f2.l,d3` and
     * nothing else: no module check, so with none loaded it returns 0.
     *
     * The Guide's reason for the keyword: *"Da zum laden keine AMOS Banken
     * benutzt werden, kann dieser Befehl zum bearbeiten eines MED Moduls sehr
     * nützlich sein"* — so the address has to be one Peek and Poke can reach,
     * which is what Runtime.MED_MODULE_BASE is for.
     */
    'med mod base': (): Value => VI(modBase(rt)),

    /**
     * =Med Get Player("file") — routine 15 ($a80).
     *
     * Loads the file through medplayer, asks which player it needs, unloads
     * it again, and touches neither $3f2 nor $3f6 — so it is safe to call
     * with a module already playing, and its answer is what `Med Load`'s
     * second argument should be.
     */
    'med get player': (_, a): Value => {
      const s = st()
      checkPlayer(s)
      const data = rt.fs?.read(str(a[0] ?? VS('')))
      return VI(data ? playerFor(data) : 0)
    },

    /**
     * =Med Is Fastplaying — routine 24 ($bf4).
     *
     * Mode 0 asks medplayer's -$72 and mode 1 octaplayer's -$60, but mode 2
     * does not ask anyone: `move.l #$ffffffff,d0` unconditionally. Which is
     * the Guide's complaint in reverse — *"Merkwürdiger Weise funktioniert
     * das nur bei MED Modulen die mit dem octamixplayer.library gespielt
     * werden"* — those always answer true because the answer is a constant.
     *
     * NOTE: for modes 0 and 1 the library's answer is modelled by the
     * `Med Fastplay On/Off` flag, since fast-ram replay is exactly what that
     * pair switches and this port has no chip/fast split of its own.
     */
    'med is fastplaying': (): Value => {
      const s = st()
      needModule(s)
      checkPlayer(s)
      if (s.mode === 2) return VI(-1)
      return VI(s.fastPlay ? -1 : 0)
    },

    /**
     * =Med Get Sub Songs — routine 18 ($b9a): `move.b $33(a0),d0`.
     *
     * $33 is `extra_songs` in the MMD header — static file data, so this one
     * is exact. The Guide: 0 means no sub-songs, 3 means the song plus three
     * more.
     *
     * NOTE: this and the four below have NO module check. On the machine
     * `movea.l $3f2.l,a0` with nothing loaded leaves a0 at zero and the read
     * comes off the 68000 exception vectors; here it answers 0.
     */
    'med get sub songs': (): Value => VI(st().player ? st().player!.extraSongs : hdrByte(rt, 0x33)),

    /** =Med Pblock — routine 19 ($baa): `move.w $2a(a0),d0`, MMD `pblock`. */
    'med pblock': (): Value => VI(st().player ? st().player!.hdrPblock : hdrWord(rt, 0x2a)),

    /** =Med Pline — routine 20 ($bba): `move.w $2c(a0),d0`, MMD `pline`. */
    'med pline': (): Value => VI(st().player ? st().player!.hdrPline : hdrWord(rt, 0x2c)),

    /** =Med Seq Num — routine 21 ($bca): `move.w $2e(a0),d0`, MMD `pseqnum`. */
    'med seq num': (): Value => VI(st().player ? st().player!.hdrPseqnum : hdrWord(rt, 0x2e)),

    /**
     * =Med Counter — routine 22 ($bda): `move.b $32(a0),d0`, MMD `counter`.
     *
     * The Guide, in full: *"Tja keine Ahnung wozu der gut sein soll. Gibt aber
     * irgend einen Wert zurück. (Toll nich ???)"*. It is the replayer's
     * tick-within-the-line counter, which is what this answers.
     */
    'med counter': (): Value => VI(st().player ? st().player!.hdrCounter : hdrByte(rt, 0x32)),
  }
}

/** the five struct readers, before a player exists to answer for them */
const hdrByte = (rt: Runtime, at: number): number => rt.medExt.module?.[at] ?? 0
const hdrWord = (rt: Runtime, at: number): number => {
  const d = rt.medExt.module
  return d ? (((d[at] ?? 0) << 8) | (d[at + 1] ?? 0)) : 0
}

/**
 * The DEFAULT hook at $312, stored into `$21c(a5)` by routine 0 and called
 * for every occupied slot by AMOS's `Default`.
 *
 * Stop and free the player on each open library, then `move.l #$0,$3f2.l`.
 * It closes nothing and frees no module: see the leak note in the header.
 */
export function medExtDefault(rt: Runtime): void {
  const s = rt.medExt
  s.player?.stop()
  s.player = null
  setModule(rt, null)
}

export { int }
