/**
 * The Game Extension 0.9 beta — Peter Cahill, 103 keywords at slot 14.
 *
 * *"Finally a AMOSPro Extension which adds AGA and RTG !! along with heaps of
 * new and MUCH FASTER functions"*. It is a shim over other people's libraries
 * rather than an engine of its own: the binary opens `req`, `reqtools`,
 * `lowlevel`, `ptreplay`, `stc`, `amos`, `graphics`, `dos`, `icon` and
 * `workbench`, plus GMS's `dpkernel.library`, which the guide confirms — *"TGE
 * uses GMS, and so you must pay all according gms lisences, and your program
 * will require gms(if you use TGE gfx)"*.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier, and the guide is not usable as a second source. It lags
 * the shipped table badly: six of its nodes name keywords the table does not
 * have (`G Getbob` and `A=G Pixel` are earlier names for `g get img` and `g
 * point`, `G Encyrpt`/`G Decyrpt` misspell what the table spells right, `G Set
 * Raster` says *"NOT done yet."*, and `A=G Open Req` says *"Removed"*), and
 * where it does describe behaviour it is wrong often enough that nothing here
 * is implemented from it. It is read for what the author MEANT and the routine
 * is read for what happens; see `src/ext/manifests/the-game-0.9.json`.
 *
 * ## The data block
 *
 * Every routine opens `movea.l $1c8(a5),a3` — the extension's block, which
 * lives inside its own code hunk at $a34 and begins with the four bytes `TGE`.
 * The offsets this file needs:
 *
 *     +$0c  req.library base        NEVER WRITTEN, see below
 *     +$10  "req.library"           never referenced
 *     +$1c  reqtools.library base
 *     +$20  "reqtools.library"
 *     +$47  "ptreplay.library"
 *     +$58  ptreplay.library base
 *     +$d0  the module ptreplay handed back
 *
 * ## ptreplay.library
 *
 * Version 6.6 (1996-03-20), vendored at `fixtures/libs/ptreplay.library`
 * because the twelve tracker keywords are nothing but calls into it and none
 * of them can be read without it. The offsets in a module handle, all read off
 * that binary:
 *
 *     -$0c  the song position, a BYTE
 *     +$00  a pointer to the module data
 *     +$08  non-zero while playing
 *     +$0c  paused, a word
 *     +$0e  the volume, a word
 *     +$10  the fade countdown, a byte
 *     +$11  the fade rate, a byte
 *     +$12  which channels are enabled, bits 0..3 for AUD0..AUD3
 *
 * and the entry points TGE reaches, named for what they do rather than for
 * what any header calls them:
 *
 *     -$1e  LoadModule    a0 = filename            -> d0 = handle
 *     -$24  UnLoadModule  a0 = handle
 *     -$2a  PlayModule    a0 = handle
 *     -$30  StopModule    a0 = handle
 *     -$36  Pause         a0 = handle
 *     -$3c  Unpause       a0 = handle
 *     -$48  SetVolume     a0 = handle, d0 = volume word
 *     -$4e  GetPos        a0 = handle              -> d0 = the byte at -$0c
 *     -$54  GetLength     a0 = handle              -> d0 = module byte $3b6
 *     -$7e  Fade          a0 = handle, d0 = rate
 *     -$84  ChannelOn     a0 = handle, d0 = mask
 *     -$8a  ChannelOff    a0 = handle, d0 = mask
 *     -$90  SetPos        a0 = handle, d0 = position
 *
 * Three of those settle a guide claim against it.
 *
 * **PlayModule sets the volume to 57.** `move.w #$39,$e(a5)` at ptreplay $3a6,
 * every time, so a `G Ptvolume` before a `G Ptplay` is thrown away and full
 * volume is not what a module starts at.
 *
 * **Fade takes a rate, not seconds.** The guide says *"Fades the protracker
 * module's volume to 0 over the specified ... Time -> Amount of time in
 * seconds."* ptreplay $6c2 stores the argument in BOTH fade bytes and
 * the interrupt at $9b8 counts one down, reloads it from the other, and drops
 * the volume word by one — so the argument is interrupt ticks per volume step.
 * It is easy to see how the guide got there: from ptreplay's own starting
 * volume of 57 at the default tempo, a rate of 1 does take about a second.
 * And a rate of ZERO is not a fast fade — $6cc jumps straight to StopModule.
 *
 * **Channel bit 0 is the first channel.** The guide says *"G Ptchan %0101 for
 * chan 2 and 4 to be turned on"*, which is the binary literal read left to
 * right. ptreplay $6ea tests bit 0 and writes `$dff0a0`, which is AUD0.
 *
 * ## Defects
 *
 * - **DEFECT: `G Ptload` opens ptreplay.library every time it is called.**
 *   Routine 15 ($18ca) calls `OpenLibrary` unconditionally and stores the base
 *   over the previous one, so a program that loads two modules has opened the
 *   library twice and can close it at most once. See `ptOpens`.
 * - **DEFECT: `G Ptload` never checks that the open worked.** The base goes
 *   straight into the block and the very next instruction is `jsr -$1e(a6)`
 *   through it, so a machine without `LIBS:ptreplay.library` jumps through
 *   zero rather than reporting anything.
 * - **DEFECT: `G Ptload` overwrites the previous module without unloading
 *   it.** The old handle is simply replaced at +$d0.
 * - **DEFECT: `G Ptstop` frees the module and keeps the pointer.** Routine 17
 *   ($1934) guards on both the base and the handle, calls StopModule and then
 *   UnLoadModule, and never clears +$d0 — so the guards still pass afterwards
 *   and a second `G Ptstop` frees the same handle twice.
 * - **DEFECT: `G Ptplay` pops an argument it does not declare.** Its token
 *   spec is `I`, no parameters, and routine 16 ($1918) opens `move.l (a3)+,d0`
 *   — a read off AMOS's parameter stack that nothing pushed. ptreplay ignores
 *   d0 entirely, so the damage is the stack imbalance and not the value.
 *   Nothing is reproduced here: this port hands a keyword its arguments as a
 *   list, so there is no stack to leave short. Same shape as Opal's
 *   `Ovcopperrefresh`, which declares one and never pops it.
 * - **DEFECT: `G Close Req` closes a library nothing opens.** Routine 8
 *   ($16d4) calls `CloseLibrary` on the base at +$0c, and no instruction in
 *   the code hunk ever writes that longword. The guide marks all four
 *   requester commands *"Removed"* and three of them are still in the table;
 *   the opener is the one that really went. Batch 4 territory, recorded here
 *   because the catalogue belongs in one place.
 */
import type { Func, Instr } from '../interp/builtins'
import { VI } from '../interp/values'
import { Protracker, parseMod, type PtSong } from '../amiga/protracker'
import type { Runtime } from './runtime'

/** ptreplay $3a6: `move.w #$39,$e(a5)` — what PlayModule sets the volume to */
export const PT_PLAY_VOLUME = 57

/** the handle this port hands out; ptreplay's is an address and its value never shows */
const PT_HANDLE = 1

export interface TheGameState {
  /** block +$58 — ptreplay.library's base, or 0 for "never opened" */
  ptBase: number
  /** how many times `G Ptload` has opened it; the leak is the point */
  ptOpens: number
  /** block +$d0 — the handle, which `G Ptstop` frees and leaves behind */
  module: number
  /** the song behind the handle, absent once `G Ptstop` has unloaded it */
  song: PtSong | null
  /** handle +$0c */
  paused: boolean
  /** handle +$10 and +$11 — the fade countdown and the rate it reloads from */
  fadeCount: number
  fadeRate: number
  replay: Protracker
}

export function newTheGameState(rt: Runtime): TheGameState {
  return {
    ptBase: 0,
    ptOpens: 0,
    module: 0,
    song: null,
    paused: false,
    fadeCount: 0,
    fadeRate: 0,
    replay: new Protracker(() => rt.host.audio),
  }
}

/**
 * ptreplay's interrupt, once a frame.
 *
 * The library drives itself off a CIA timer at the module's own tempo; every
 * replayer in this port ticks once a frame instead, which is the same
 * approximation `../runtime/gamesupport.ts` and `../runtime/p61.ts` make.
 *
 * The fade is ptreplay's own and not `Protracker`'s, because the end of it
 * differs: $9d4 falls through to a teardown when the volume word reaches
 * zero, where `Protracker` would sit at zero and keep playing.
 */
export function thegameVbl(rt: Runtime): void {
  const st = rt.thegame as TheGameState | undefined
  if (!st) return
  const r = st.replay
  if (!r.playing || st.paused) return
  r.tick()
  st.fadeCount = r.fadeCount
  if (st.fadeRate !== 0 && r.master === 0) {
    // ptreplay $9d8: the volume word ran out, so the module stops
    r.stop()
    st.fadeRate = 0
  }
}

/** every tracker keyword after `G Ptload` reaches through both of these */
const live = (st: TheGameState): boolean => st.ptBase !== 0 && st.module !== 0

export function makeTheGameInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): TheGameState => rt.thegame

  return {
    /**
     * Routine 15 ($18ca) — `G Ptload NAME$`. *"Loads a protracker module."*
     *
     * `adda.w #2,a0` first, because an AMOS string is its length word and then
     * its bytes, and ptreplay wants a plain filename.
     *
     * Three defects live in these seven instructions and all three are
     * reproduced: the library is opened again on every call, the open is not
     * checked, and any module already loaded is dropped without being
     * unloaded. See the catalogue above.
     */
    'g ptload': (it) => {
      const s = st()
      const name = it.evalStr()
      s.ptOpens++
      s.ptBase = 1
      const data = rt.vfs?.readFile(name) ?? rt.fs?.read(name) ?? null
      const song = data ? parseMod(data) : null
      // LoadModule answers zero for a file it cannot read, and the handle is
      // stored either way -- there is no test on it here
      s.module = song ? PT_HANDLE : 0
      s.song = song
      s.paused = false
      s.fadeRate = 0
      s.fadeCount = 0
    },

    /**
     * Routine 16 ($1918) — `G Ptplay`. *"Plays the mod that you've loaded"*.
     *
     * No guard on either the base or the handle, unlike `G Ptstop`. ptreplay
     * $3a6 null-checks the handle itself, so a play with nothing loaded is
     * quiet rather than fatal — but the base is not checked by anybody.
     *
     * The volume goes to 57 here, not to full and not to whatever `G Ptvolume`
     * last set.
     */
    'g ptplay': () => {
      const s = st()
      if (!s.song) return
      s.replay.load(s.song)
      s.replay.master = PT_PLAY_VOLUME
      s.replay.fadeTo = PT_PLAY_VOLUME
      s.replay.playing = true
      s.paused = false
      s.fadeRate = 0
      s.fadeCount = 0
    },

    /**
     * Routine 17 ($1934) — `G Ptstop`. *"Stops the playing protracker module
     * playing."*
     *
     * StopModule and then UnLoadModule, guarded on the base and the handle
     * both. The handle is not cleared afterwards, which is the defect: the
     * guards below still pass and the module is gone.
     */
    'g ptstop': () => {
      const s = st()
      if (!live(s)) return
      s.replay.stop()
      s.replay.song = null
      s.song = null
      s.paused = false
      s.fadeRate = 0
    },

    /**
     * Routine 18 ($1962) — `G Ptfade RATE`.
     *
     * The guide calls the argument a time in seconds and it is a rate; a rate
     * of zero is StopModule. See the header.
     */
    'g ptfade': (it) => {
      const s = st()
      const rate = it.evalInt() & 0xff
      if (!live(s)) return
      if (rate === 0) {
        s.replay.stop()
        s.replay.song = null
        s.song = null
        s.paused = false
        s.fadeRate = 0
        return
      }
      s.fadeRate = rate
      s.fadeCount = rate
      // ptreplay's fade IS Protracker's, step for step -- master toward the
      // target by one every `rate` ticks -- so the shared machinery runs it
      s.replay.fadeTo = 0
      s.replay.fadeSpeed = rate
      s.replay.fadeCount = rate
    },

    /** Routine 19 ($197e) — `G Ptpause`. *"Pauses at current position"*, handle +$0c */
    'g ptpause': () => {
      const s = st()
      if (!live(s)) return
      s.paused = true
      s.replay.forget()
      for (let v = 0; v < 4; v++) rt.host.audio?.stop(v)
    },

    /**
     * Routine 20 ($1998) — `G Ptunpause`.
     *
     * ptreplay $528 clears the pause word and does nothing else — it does not
     * check that anything is playing, so this un-pauses a module that was
     * never paused just as happily.
     */
    'g ptunpause': () => {
      const s = st()
      if (!live(s)) return
      s.paused = false
    },

    /**
     * Routine 21 ($19b2) — `G Ptvolume LEVEL`. *"Sound volume/level from
     * 0-63"*, which is the guide's range and not the library's: ptreplay $59e
     * stores the word with no clamp at all, and its own PlayModule uses 57.
     */
    'g ptvolume': (it) => {
      const s = st()
      const v = it.evalInt()
      if (!live(s)) return
      s.replay.master = v < 0 ? 0 : v > 64 ? 64 : v
      // ptreplay writes the volume word and leaves the fade bytes counting, so
      // a fade in flight carries on from the new level; with no fade running
      // the target has to follow, or Protracker's own pass drifts it back
      if (s.fadeRate === 0) s.replay.fadeTo = s.replay.master
    },

    /**
     * Routine 73 ($2ae4) — `G Ptchan On MASK`. *"Turns on the channels
     * specified ... Channel numbers in bitmap form"*, bit 0 first.
     *
     * ptreplay $6ea ANDs the mask with the channels it can have — $884 walks
     * four audio nodes and takes the ones whose type word is 13 — before
     * touching anything. There is no `audio.device` arbitration here and no
     * other task to lose a channel to, so all four are always available.
     */
    'g ptchan on': (it) => {
      const s = st()
      const mask = it.evalInt() & 0xf
      if (!live(s)) return
      s.replay.voices |= mask
    },

    /** Routine 74 ($2b00) — `G Ptchan Off MASK`, the same mask the other way */
    'g ptchan off': (it) => {
      const s = st()
      const mask = it.evalInt() & 0xf
      if (!live(s)) return
      s.replay.voices &= ~mask & 0xf
      for (let v = 0; v < 4; v++) if (mask & (1 << v)) rt.host.audio?.stop(v)
    },

    /**
     * Routine 75 ($2b1c) — `G Ptset Pos POSITION`.
     *
     * The guide gives up on this one — *"set the position of the player"* and
     * then *"jono not done. Pac, position meaning the pattern to continue
     * from?"*, the two authors' note to each other left in the shipped file.
     * ptreplay $7fe answers it: `move.b d0,-$c(a0)`, the song position, the
     * same byte `G Ptpos` reads back.
     *
     * DEVIATION: ptreplay writes the byte raw, with no test against the song's
     * length, and lets the interrupt find it. `Protracker.setPosition` sends a
     * position past the end back to 0, so the two differ for an out-of-range
     * argument.
     */
    'g ptset pos': (it) => {
      const s = st()
      const pos = it.evalInt() & 0xff
      if (!live(s)) return
      s.replay.setPosition(pos)
    },
  }
}

export function makeTheGameFunctions(rt: Runtime): Record<string, Func> {
  const st = (): TheGameState => rt.thegame

  return {
    /**
     * Routine 76 ($2b38) — `=G Ptpos`, the byte at handle -$0c. Undocumented:
     * the guide has a node for `G Ptlength` and none for this.
     */
    'g ptpos': () => {
      const s = st()
      return VI(live(s) ? s.replay.pos & 0xff : 0)
    },

    /**
     * Routine 77 ($2b56) — `=G Ptlength`. *"Returns the length of the mod."*
     *
     * ptreplay $5c8 follows the handle to the module and reads byte $3b6,
     * which in a 31-sample module is the song length — 20 bytes of title and
     * then thirty bytes for each of the samples. So it is the number of
     * positions, not a duration.
     */
    'g ptlength': () => {
      const s = st()
      return VI(live(s) && s.song ? s.song.positions.length & 0xff : 0)
    },
  }
}
