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
 * ## What batch 2's fifteen keywords reach
 *
 * Five go straight at the hardware or at AmigaOS and owe GMS nothing:
 * `G Reboot` is `ColdReboot` with no version check, `=G Left Click` and
 * `G Wait Lmb` are `btst.b #$6,$bfe001` on CIA-A's PRA, `G Wait Rmb` is bit 10
 * of POTINP at `$dff016`, and `=G Check Vbl` is one compare against `$dff006`.
 * Four more are library calls this port already models: `=G Cd32` opens
 * `lowlevel.library` and calls `ReadJoyPort`, `=G Cli` is `dos.library`'s
 * `Execute`, `=G File Size` is `Lock`/`Examine`/`UnLock` for `fib_Size`, and
 * `G Iconify`/`=G Icon Check` are `workbench.library`'s AppIcon pair.
 *
 * The last four are GMS after all, whatever the batch assumed: `=G Right
 * Click`, `=G X Mouse`, `=G Y Mouse` and `G Set Mouse` all go through the
 * input structure at block +$b2e, and the guide says so for two of them —
 * *"*GMS REQUIRED*"*. They are ported against this port's own mouse instead,
 * which is the same state by a shorter route; nothing about the values a
 * program sees depends on the structure they came out of.
 *
 * ## The trigonometry tables
 *
 * `G Set Table` (routine 94, $31bc) builds them and `=Gsin`/`=Gcos` (85, 86)
 * read them; nothing else in the extension does, and the guide has no node for
 * the builder at all, so a program that calls either function without calling
 * it first is reading through a null pointer.
 *
 * The layout, from the routine: `AllocMem(10n, MEMF_CLEAR)`, the sin pointer
 * to the start at block +$bce and the cos pointer 2n bytes in at +$bd2, the
 * byte size kept at +$bd6 so the next call can free it. So the table is 5n
 * words long, entry `i` is the sine of `i` steps of a quarter-circle split n
 * ways, and cos is the same table read n entries later — the standard trick,
 * and it needs 5n rather than 4n+1 entries so that `Gcos(359)` still lands
 * inside it.
 *
 * The values come from the worker at $323c: a cosine Taylor series to
 * x^12/12! in 16.16 fixed point, then `lsr.l #$1` and the low word, which
 * makes the stored word cos(x)*32768. `cos(0)` would be exactly $8000 and
 * therefore negative, and the `tst.w d1 / dbpl d1` pair at $329e is what deals
 * with it: DBcc decrements the low word when the condition is false, so a
 * negative word is quietly turned into $7fff. Six values are written per pass
 * — the eighth-circle symmetries — and entries 0 and 2n are never written at
 * all, which is correct only because MEMF_CLEAR already left them zero and
 * sin(0) and sin(pi) are zero.
 *
 * ## The value register
 *
 * `=Gsin`, `=Gcos`, `=GScreen Width` and `=GScreen Height` all end with
 * `move.w <something>,d3` and no `moveq #$0,d3` in front of it, which writes
 * the low half of the value register and leaves the high half holding whatever
 * was there, and AMOS guarantees nothing about it. All the extension docs say
 * is *"To send a function ... parameter back to AMOS, you load it in D3, ...
 * and put its type in D2"* — the worked example vendored at
 * `fixtures/official-amos/Tutorial/Extensions`, which is careful at every
 * word-sized return of its own: `move.b 88(a0),d3 / ext.w d3 / ext.l d3` for
 * `=Mouth Width`. So is AMOSPro.Lib itself, which writes either `moveq #$0,d3
 * / move.w $9ea(a5),d3` or `move.w -$16(a5),d3 / ext.l d3`. This extension's
 * own `=G Amiga` (routine 91) clears d3 first, so the author knew; the four
 * above are oversights.
 *
 * This port takes the high half as zero, which is the only reading under which
 * `=GScreen Width` reports a width. It costs `=Gsin` and `=Gcos` their sign;
 * see the catalogue.
 *
 * ## Defects
 *
 * - **DEFECT: `=Gsin` and `=Gcos` cannot return a negative number.** Routines
 *   85 and 86 read a table word into the low half of d3 and then `asr.l #$8`
 *   the whole register. With the high half zero the shift is a logical one, so
 *   the sine of 210 degrees comes back as 192 rather than -64: the word $C000
 *   read as $0000C000. The guide says *"returns sin of angle B multiplyed by
 *   128"*, and the magnitudes are right — it is only the top half of the
 *   circle that is wrong, which is the half a program is least likely to test
 *   first.
 * - **DEFECT: `=Gsin` and `=Gcos` are declared to return a float.** Their
 *   token spec is `10`, and the extension docs give `1` as
 *   *"1--> function that returns a float"*. The routines set
 *   the value register and never touch d2, the type register, so what a
 *   program gets is whatever type the last thing evaluated left behind — an
 *   integer, for the argument they were just given. Answered as an integer
 *   here.
 * - **DEFECT: `G Set Table 0` divides by zero.** The default is applied to the
 *   wrong register. `asl.w #$1,d7` doubles the count, `tst.l d0 / bne` falls
 *   through to `move.l #$b4,d0` when it is zero — so the SIZE defaults to a
 *   180-word quarter — but the fill at $3232 is handed d6, which still holds
 *   the original zero, and `divu.l d0,d1` at $3246 traps. There is no
 *   exception vector in this port, so it surfaces as AMOS error 20, which is
 *   what ../runtime/gamesupport.ts does with GameSupport's zero-divide.
 * - **DEFECT: the last quarter of the table is one step out.** Four of the
 *   five stores per pass walk outward from the quarter marks, and the fifth,
 *   `move.w d1,-(a4)`, starts at entry 5n — one PAST the end — so entry
 *   `5n-1-k` receives cos(k) where it should hold cos(k+1). With the usual
 *   n of 90 that is entries 360..449, which is exactly what `=Gcos` reads for
 *   270..359 degrees: `Gcos(270)` answers 2 instead of 0, being cos(271).
 * - **DEFECT: `G Set Table` frees the old table before it knows it can build a
 *   new one.** `FreeMem` runs first, and if the `AllocMem` then fails the two
 *   pointers at +$bce and +$bd2 are left pointing at the memory just handed
 *   back. `=Gsin` reads through them regardless.
 * - **DEFECT: `G Handicap` gives AMOS the LOWEST priority.** The guide says
 *   *"Gives Amos a priority of 256! Shutting off many system funcions thus
 *   speeding up your code."* and routine 88 is `move.l #$80,d0` into
 *   `SetTaskPri`, which takes a signed byte: $80 is -128, the bottom of the
 *   range. So the keyword does the exact opposite of what its own
 *   documentation promises, and the name is the accurate part.
 * - **DEFECT: `G Unhandicap` on its own calls SetTaskPri with a null task.**
 *   Routine 89 reads the task pointer from block +$b36 and the saved priority
 *   from +$b3a without testing either, and nothing but `G Handicap` ever
 *   writes them.
 * - **DEFECT: `G Handicap` twice loses the original priority.** The second
 *   call saves the -128 the first one installed, so `G Unhandicap` restores
 *   the handicap.
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
 * - **DEFECT: `G Set Mouse` writes two overlapping longs.** Routine 80
 *   ($2bce) is `move.l d0,$b34(a0)` and then `move.l d1,$b32(a0)`, into two
 *   fields that `=G X Mouse` and `=G Y Mouse` read back as WORDS at $b32 and
 *   $b34. The second store covers $b32..$b35, so it lands its low word on top
 *   of the first store's high word: x ends up holding the high half of the x
 *   argument, which is zero for any sane coordinate, and y ends up holding the
 *   low half of the same argument. The y argument never reaches anything. The
 *   guide agrees without explaining, leaving both argument descriptions blank
 *   and saying *"DONT USE"*.
 * - **DEFECT: `=G Y Mouse` does not poll.** Routine 78 ($2b74) calls GMS's
 *   input poll at `-$24(a6)` before accumulating the x delta; routine 79
 *   ($2ba6) loads the same two pointers and skips the call, so a y read
 *   accumulates whatever delta the last x read left behind. Reading y without
 *   reading x first returns a stale figure.
 * - **DEFECT: `=G Cli` never sets its result.** Routine 60 ($24aa) leaves d3 —
 *   the value register — at the zero it used as an argument to `Execute`, and
 *   on failure writes -1 into d2, which is the TYPE register. So the function
 *   always answers 0 and a failed command corrupts the type instead.
 * - **DEFECT: `=G File Size` leaks its FileInfoBlock.** Routine 64 ($2698)
 *   allocates 1,000 bytes with `AllocMem` and never frees them, on every call
 *   and on every path out.
 * - **DEFECT: `G Wait Lmb` and `G Wait Rmb` disagree about the screen.**
 *   Routine 13 ($188e) tests block +$12c before calling `G Update` in the wait
 *   loop; routine 14 ($18b2) calls it unconditionally. With no screen open the
 *   right-button wait updates a display that is not there.
 * - **DEFECT: `G Close Req` closes a library nothing opens.** Routine 8
 *   ($16d4) calls `CloseLibrary` on the base at +$0c, and no instruction in
 *   the code hunk ever writes that longword. The guide marks all four
 *   requester commands *"Removed"* and three of them are still in the table;
 *   the opener is the one that really went. Batch 4 territory, recorded here
 *   because the catalogue belongs in one place.
 */
import type { Func, Instr } from '../interp/builtins'
import { AmosError, VI, str } from '../interp/values'
import { counterDelta, joyDatX, joyDatY, mouseDat } from '../amiga/gameport'
import { execute } from '../amiga/process'
import {
  JPF_BUTTON_BLUE,
  JPF_BUTTON_FORWARD,
  JPF_BUTTON_GREEN,
  JPF_BUTTON_PLAY,
  JPF_BUTTON_RED,
  JPF_BUTTON_REVERSE,
  JPF_BUTTON_YELLOW,
  JPF_JOY_DOWN,
  JPF_JOY_LEFT,
  JPF_JOY_RIGHT,
  JPF_JOY_UP,
  readJoyPort,
} from '../amiga/lowlevel'
import { Protracker, parseMod, type PtSong } from '../amiga/protracker'
import { Runtime } from './runtime'

/** an argument that arrived as a Value */
const int = (v: unknown): number => Number((v as { n?: number } | undefined)?.n ?? 0) | 0

/** ptreplay $3a6: `move.w #$39,$e(a5)` — what PlayModule sets the volume to */
export const PT_PLAY_VOLUME = 57

/** the handle this port hands out; ptreplay's is an address and its value never shows */
const PT_HANDLE = 1

/**
 * What `-$18ae(a5)` holds, and therefore what `=G Oddno` answers.
 *
 * AMOS keeps `graphics.library`'s base in its own workspace and every
 * extension reaches it there; this one hands it to the program. It has to be a
 * number, and it has to be one nothing mistakes for a real allocation:
 * `../amiga/exec.ts` puts the bases its `OpenLibrary` hands out at
 * `0x7f10_0000`, and this sits just below them, being a base too — one AMOS
 * opened long before any of those.
 */
export const TGE_GFX_BASE = 0x7f0f_0000

/**
 * The zero run at block +$352, which is what `=G Getmem` points at: 2,148
 * bytes between the last library-name string and the end of the data block.
 */
export const TGE_SCRATCH_SIZE = 2148

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

  /** block +$352 — the 2,148 zero bytes `=G Getmem` hands out the address of */
  scratch: Uint8Array
  /** block +$b32 and +$b34, the two mouse accumulators, as WORDS */
  mouseX: number
  mouseY: number
  /** the quadrature counters the last `=G X Mouse` poll saw */
  prevX: number
  prevY: number
  /** whether those two hold a real reading yet */
  seeded: boolean
  /** whether an AppIcon is on the Workbench, and whether it has been clicked */
  iconUp: boolean
  iconClicked: boolean
  /** bytes `=G File Size` has allocated and never freed */
  fibLeak: number

  /** block +$bce, the sin table — and, n entries in, the cos table at +$bd2 */
  trig: Int16Array | null
  /** (+$bd2 - +$bce) / 2: how far into it `=Gcos` starts */
  cosAt: number
  /** block +$bd6 — the byte size the next `G Set Table` hands to `FreeMem` */
  trigBytes: number

  /** whether `G Handicap` has run, so block +$b36 holds a task pointer */
  handicapped: boolean
  /** the task priority, which nothing here schedules on; see `G Handicap` */
  priority: number
  /** block +$b3a — the priority `G Unhandicap` puts back */
  savedPriority: number
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
    scratch: new Uint8Array(TGE_SCRATCH_SIZE),
    mouseX: 0,
    mouseY: 0,
    prevX: 0,
    prevY: 0,
    seeded: false,
    iconUp: false,
    iconClicked: false,
    fibLeak: 0,
    trig: null,
    cosAt: 0,
    trigBytes: 0,
    handicapped: false,
    priority: 0,
    savedPriority: 0,
  }
}

/** $3240: `move.l #$1921fb5,d1` — a quarter turn in 8.24 fixed point */
const QUARTER_TURN_8_24 = 0x1921fb5

/**
 * One pass of the series at $3264..$329c: cos(x) as a 16.15 word, x in 16.16.
 *
 * Written as the 68020 arithmetic rather than as `Math.cos`, because the
 * rounding is observable — a program reads these words through `=Gsin` and the
 * shift throws all but the top eight bits away, so which side of a boundary a
 * truncation lands on decides the answer. Both 64-bit products are taken apart
 * the same way the routine does it: `move.w d4,d5 / swap d5` keeps bits 47..16
 * of the product, which is the 16.16 result.
 */
function cosFixed(x16: number): number {
  // mulu.l d5,d4:d5 — an UNSIGNED square, then neg.l
  const sq = BigInt(x16 >>> 0) * BigInt(x16 >>> 0)
  const minusX2 = -Number(BigInt.asIntN(32, sq >> 16n)) | 0

  let sum = 0x00010000 // d1, and the series starts at 1.0
  let term = 0x00010000 // d3
  let k = 0 // d2
  let fact = 1 // d6
  do {
    // muls.l d5,d4:d3 — signed this time, same middle 32 bits
    term = Number(BigInt.asIntN(32, BigInt.asUintN(64, BigInt(term) * BigInt(minusX2)) >> 16n)) | 0
    k += 1
    fact = Math.imul(fact, k)
    k += 1
    fact = Math.imul(fact, k)
    // divs.l truncates toward zero, which is what `|0` does to a negative
    sum = (sum + ((term / fact) | 0)) | 0
  } while (k >>> 0 < 12)

  sum = sum >>> 1 // lsr.l #$1,d1
  // tst.w d1 / dbpl d1: DBcc decrements the WORD when the condition fails, so
  // the only value this can reach -- cos(0)'s $8000 -- becomes $7fff
  if ((sum & 0x8000) !== 0) sum = (sum & ~0xffff) | ((sum - 1) & 0xffff)
  return sum & 0xffff
}

/**
 * The filler at $323c: `n` passes, six stores each, over a 5n-word table.
 *
 * `a0` walks up from entry n and `a1` down from it, `a3` up from 3n and `a2`
 * down from it with the sign flipped, and `a4` down from 5n — which is one
 * past the last entry rather than on it, and is the off-by-one in the
 * catalogue. Entries 0 and 2n are left as `AllocMem(MEMF_CLEAR)` left them.
 *
 * A `G Set Table` past 32767 writes far outside the block it allocated,
 * because the size came from a word shift and the fill did not: the count
 * wraps to zero for the size, defaults to 180 words, and then n passes write
 * over whatever follows. Nothing is corrupted here — the writes fall off the
 * end of an `Int16Array` and are dropped — and that is a DEVIATION rather than
 * a reproduction, there being no neighbouring allocation to trash.
 */
function fillTrig(table: Int16Array, n: number): void {
  // divu.l d0,d1 with a zero divisor is a 68020 zero-divide exception, and
  // there is no vector for one here; ../runtime/gamesupport.ts settled on AMOS
  // error 20 as the nearest true thing to say
  if ((n >>> 0) === 0) throw new AmosError('Division by zero', 20)
  const step = Math.floor(QUARTER_TURN_8_24 / (n >>> 0))

  let angle = 0 // d0, 8.24
  for (let k = 0; k < n; k++) {
    const v = cosFixed(angle >>> 8)
    const neg = -v & 0xffff // neg.w on the same word
    if (n + k < table.length) table[n + k] = v
    if (n - k < table.length) table[n - k] = v
    if (5 * n - 1 - k < table.length) table[5 * n - 1 - k] = v
    if (3 * n - k < table.length) table[3 * n - k] = neg
    if (3 * n + k < table.length) table[3 * n + k] = neg
    angle = (angle + step) >>> 0
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

/**
 * `move.w (a1,d0.w),d3 / asr.l #$8,d3` — the tail `=Gsin` and `=Gcos` share.
 *
 * `from` is the pointer they start at, as a word index: 0 for +$bce and
 * `cosAt` for +$bd2. The displacement is a SIGN-EXTENDED word, so an index
 * from 16384 up reads below the table rather than above it, and neither
 * routine tests for that or for the table being there at all — both cases are
 * memory this port does not model, and both answer 0.
 *
 * The shift is arithmetic on a register whose high half the routine never
 * wrote. Taken as zero here, which makes it a logical shift and costs the
 * result its sign.
 */
function trigWord(st: TheGameState, index: number, from: number): number {
  const disp = ((index << 1) & 0xffff) << 16 >> 16
  const at = from + (disp >> 1)
  const word = st.trig && at >= 0 && at < st.trig.length ? st.trig[at]! : 0
  return (word & 0xffff) >> 8
}

export function makeTheGameInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): TheGameState => rt.thegame

  return {
    /**
     * Routine 4 ($1682) — `G Reboot`. *"Reboot the system"*.
     *
     * `movea.l $4.w,a6 / jsr -$2d6(a6) / rts`: `ColdReboot`, with no check
     * that the machine has one. `../amiga/machine.ts` catalogues it beside
     * every other extension's reboot keyword and answers for what a cold
     * reboot means here.
     */
    'g reboot': () => {
      rt.machine.requestReset('cold', 'g reboot')
    },

    /**
     * Routine 13 ($188e) — `G Wait Lmb`. *"Waits for lmb press, all amal and
     * stuff will still work."*
     *
     *     Rjsr L_Tests / movea.l $1c8(a5),a0 / movea.l $12c(a3),a0
     *     tst.l a0 / beq / Rbsr routine 53 (g update)
     *     btst.b #$6,$bfe001 / bne -> loop
     *
     * `L_Tests` is what the guide's *"all amal and stuff"* means — AMOS's own
     * per-pass work, which is why the loop does not freeze the interpreter.
     * The `G Update` is guarded on the GMS screen pointer, unlike `G Wait
     * Rmb`'s; with no screen open there is nothing to refresh.
     */
    'g wait lmb': (it) => {
      if ((rt.input.mouseK & 1) !== 0) return
      // rewind, so the statement re-runs and tests bit 6 again -- the loop is
      // the keyword's, exactly as it is on the machine
      it.block({ type: 'waitInput', mouse: true, key: false }, true)
    },

    /**
     * Routine 14 ($18b2) — `G Wait Rmb`, and the guide's *"Nopes:"* for
     * "Notes:".
     *
     * Bit 10 of POTINP at `$dff016` is the right button, and the `G Update` in
     * this loop is NOT guarded on a screen the way `G Wait Lmb`'s is.
     */
    'g wait rmb': (it) => {
      if ((rt.input.mouseK & 2) !== 0) return
      it.block({ type: 'waitInput', mouse: true, key: false }, true)
    },

    /**
     * Routine 80 ($2bce) — `G Set Mouse X,Y`, and the guide leaves both
     * argument descriptions blank and says *"DONT USE"*.
     *
     * The two overlapping longs are reproduced exactly; see the catalogue.
     * Arguments pop right to left, so d0 is Y and d1 is X, and the stores go
     * `d0 -> $b34` then `d1 -> $b32` over four bytes each.
     */
    'g set mouse': (it) => {
      const s = st()
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      // $b32..$b35 as the machine leaves them: the y store first, then the x
      // store landing its low word on top of the y field
      const bytes = new Uint8Array(6)
      const put32 = (at: number, v: number): void => {
        bytes[at] = (v >>> 24) & 0xff
        bytes[at + 1] = (v >>> 16) & 0xff
        bytes[at + 2] = (v >>> 8) & 0xff
        bytes[at + 3] = v & 0xff
      }
      put32(2, y) // move.l d0,$b34(a0)
      put32(0, x) // move.l d1,$b32(a0)
      s.mouseX = ((bytes[0]! << 8) | bytes[1]!) & 0xffff
      s.mouseY = ((bytes[2]! << 8) | bytes[3]!) & 0xffff
    },

    /**
     * Routine 94 ($31bc) — `G Set Table N`. Undocumented: the guide has no
     * node for it, and `=Gsin` and `=Gcos` are useless without it.
     *
     * N is the number of steps in a quarter turn, so `G Set Table 90` is the
     * degrees the `=Gcos` node means by *"The angle to use in degrees."* The
     * routine frees the last table, allocates 10N bytes, points +$bce at the
     * start and +$bd2 2N bytes in, and fills it.
     *
     *     move.l $bd6(a3),d0 / tst.l d0 / beq / movea.l $bce(a3),a1 / FreeMem
     *     move.l d7,d6 / asl.w #$1,d7 / move.l d7,d0
     *     tst.l d0 / bne / move.l #$b4,d0
     *     move.l d0,d7 / mulu.l #$4,d1 / add.l d1,d0 / move.l d0,$bd6(a3)
     *     AllocMem(d0, MEMF_CLEAR) / tst.l d0 / beq
     *     move.l d0,$bce(a3) / add.l d7,d0 / move.l d0,$bd2(a3)
     *
     * Three things fall out of that and all three are reproduced: the doubling
     * is a WORD shift while the size is a long, so a count of 32768 or more
     * wraps; the default of 180 reaches the size and not the fill, so a count
     * of zero divides by zero; and the free happens before the allocation, so
     * a failed allocation leaves both pointers dangling.
     */
    'g set table': (it) => {
      const s = st()
      const n = it.evalInt()
      // asl.w #$1,d7 on a long register: the high half is untouched
      const doubled = (n & ~0xffff) | ((n << 1) & 0xffff)
      const size = Math.imul(doubled === 0 ? 180 : doubled, 5)
      const cosBytes = doubled === 0 ? 180 : doubled
      s.trigBytes = size
      // AllocMem answers zero for a size the machine has not got, and a
      // negative count arrives here as one
      if (size <= 0 || size > rt.chipFree() + rt.fastFree()) return
      const table = new Int16Array(size >> 1)
      fillTrig(table, n)
      s.trig = table
      s.cosAt = cosBytes >> 1
    },

    /**
     * Routine 88 ($2eec) — `G Handicap`.
     *
     * `FindTask(NULL)` into block +$b36, then `SetTaskPri` with `move.l
     * #$80,d0` and the old priority into +$b3a. SetTaskPri takes a SIGNED
     * byte, so $80 is -128 and the guide's *"Gives Amos a priority of 256!
     * ... thus speeding up your code"* is backwards in both halves — see the
     * catalogue.
     *
     * There is no scheduler here to apply a priority to, so the value is
     * recorded and nothing else happens, which is what ../runtime/turbo.ts
     * does with `Multi No`.
     */
    'g handicap': () => {
      const s = st()
      s.savedPriority = s.priority
      s.priority = -128
      s.handicapped = true
    },

    /**
     * Routine 89 ($2f18) — `G Unhandicap`. *"Removes the system restrictions
     * brought abut by the G Handicap command."*
     *
     * `SetTaskPri` again, with the task and the priority read straight back
     * out of +$b36 and +$b3a and neither of them tested. Called on its own
     * that is a null task pointer, which is the catalogue's; called after two
     * `G Handicap`s it restores the handicap, because the second one saved it.
     */
    'g unhandicap': () => {
      const s = st()
      if (!s.handicapped) {
        // SetTaskPri(NULL, 0) writes through a null pointer on the machine;
        // there is nothing to write through here
        return
      }
      s.priority = s.savedPriority
    },

    /**
     * Routine 61 ($24d8) and its three-argument variant routine 71 ($28c8) —
     * `G Iconify TITLE$,ICON$` and `G Iconify TITLE$,ICON$,MULTI`. *"puts a
     * icon on WB, and waits for the user to Double-Click before returning"*,
     * against *"Puts a Icon on WB, and returns straight away"* for the second.
     *
     * The routine opens `icon.library` (name at block +$94, base at +$a2) and
     * then `workbench.library` (name at +$a6, base at +$b8), and if the SECOND
     * open fails it closes the first and returns having done nothing:
     *
     *     lea $a6(a3),a1 / OpenLibrary -> $b8(a3)
     *     tst.l d0 / bne -> the work
     *     movea.l $a2(a3),a1 / CloseLibrary / bra exit
     *
     * That is the arm every call takes here. This port has no
     * `workbench.library` — the same wall GameSupport's `Gsiconify` meets —
     * and nothing is faked past it: there is no AppIcon to add, no message
     * port to wait on, and `=G Icon Check` therefore answers 0 for ever.
     *
     * Both arguments are still evaluated, because the machine pops them before
     * it reaches the failure test.
     */
    'g iconify': (it) => {
      it.evalStr()
      it.expect(',')
      it.evalStr()
      if (it.accept(',')) it.evalInt()
      // workbench.library is not modelled, so the open fails and the routine
      // closes icon.library and leaves
      st().iconUp = false
    },

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
     * Routine 5 ($168c) — `=G Left Click`. *"Checks for lmb press."*
     *
     * `btst.b #$6,$bfe001` — CIA-A's PRA, where the left button is active low,
     * so the answer is -1 when the bit is CLEAR. It does not go near
     * `lowlevel.library` or GMS.
     */
    'g left click': () => VI((rt.input.mouseK & 1) !== 0 ? -1 : 0),

    /**
     * Routine 6 ($169e) — `=G Right Click`. *"Checks for rmb press."*
     *
     * Unlike the left one this goes through GMS: `movea.l $b2e(a2),a0` and
     * then `cmp.w #$1,$14(a0)` on the input structure. Same answer, read from
     * this port's own mouse.
     */
    'g right click': () => VI((rt.input.mouseK & 2) !== 0 ? -1 : 0),

    /**
     * Routine 11 ($173e) — `=G Check Vbl`. *"Check if it is time for a vbl
     * (PPC)."*
     *
     * One compare and two branches: `cmpi.b #$ff,$dff006`, which is the low
     * eight bits of the beam's vertical position. So it answers true on
     * exactly one line out of every 256, and on a PAL screen that is line 255
     * — well down the visible picture and nowhere near the vertical blank the
     * name promises.
     */
    'g check vbl': () => VI((rt.interp.beamLine() & 0xff) === 0xff ? -1 : 0),

    /**
     * Routine 12 ($1750) — `=G Cd32(PORT)`. *"B=port 0-3, returns lowlevel
     * bitmap"*, which it does not: the routine opens `lowlevel.library` (name
     * at block +$36, base at +$32), calls `ReadJoyPort`, and then REPACKS the
     * result into eleven low bits of its own —
     *
     *     ReadJoyPort  ->  G Cd32        ReadJoyPort  ->  G Cd32
     *     right   $1       $008          play    $20000   $400
     *     left    $2       $004          rev     $40000   $100
     *     down    $4       $002          fwd     $80000   $200
     *     up      $8       $001          green  $100000   $040
     *                                    yellow $200000   $080
     *                                    red    $400000   $010
     *                                    blue   $800000   $020
     *
     * The four directions are read through an `ext.l d7` that has already
     * thrown the top sixteen bits away; `move.l d6,d7` puts them back before
     * the buttons are tested, so the truncation costs nothing.
     */
    'g cd32': (_it, a) => {
      const raw = readJoyPort(rt.input.ports, int(a[0]) & 3)
      let out = 0
      if (raw & JPF_JOY_RIGHT) out |= 0x008
      if (raw & JPF_JOY_LEFT) out |= 0x004
      if (raw & JPF_JOY_DOWN) out |= 0x002
      if (raw & JPF_JOY_UP) out |= 0x001
      if (raw & JPF_BUTTON_PLAY) out |= 0x400
      if (raw & JPF_BUTTON_GREEN) out |= 0x040
      if (raw & JPF_BUTTON_YELLOW) out |= 0x080
      if (raw & JPF_BUTTON_RED) out |= 0x010
      if (raw & JPF_BUTTON_BLUE) out |= 0x020
      if (raw & JPF_BUTTON_REVERSE) out |= 0x100
      if (raw & JPF_BUTTON_FORWARD) out |= 0x200
      return VI(out)
    },

    /**
     * Routine 60 ($24aa) — `=G Cli(COMMAND$)`. *"similar to exec but allows
     * expressions in the structure"*.
     *
     * `dos.library`'s `Execute(cmd, 0, 0)`, with `adda.l #$2,a0` to step over
     * the AMOS string's length word.
     *
     * DEFECT: d3 — the value register — is left at the zero it held as an
     * argument, so the function always answers 0; and the failure arm writes
     * -1 into d2, the TYPE register, rather than into the value. Reproduced as
     * the constant zero, which is what a program sees on the success path and
     * on the failure path both.
     */
    'g cli': (_it, a) => {
      execute(rt.host.process, { command: str(a[0]!), io: { input: null, output: null } })
      return VI(0)
    },

    /**
     * Routine 64 ($2698) — `=G File Size(NAME$)`. *"Returns the length of the
     * specified file."*
     *
     * `AllocMem($3e8, MEMF_CLEAR)`, `Lock(name, SHARED_LOCK)`, `Examine`,
     * `UnLock`, and then `move.l $7c(a4),d3` — `fib_Size`. A lock that fails
     * is `moveq #$51,d0` into `G Exit`, error 81.
     *
     * DEFECT: the FileInfoBlock is never freed. A thousand bytes go on every
     * call, on the failure path as well as the success one.
     */
    'g file size': (_it, a) => {
      const s = st()
      s.fibLeak += 1000
      const name = str(a[0]!)
      const data = rt.vfs?.readFile(name) ?? rt.fs?.read(name) ?? null
      return VI(data ? data.length : 0)
    },

    /**
     * Routine 65 ($270e) — `=G Getmem`.
     *
     * Three instructions: `lea $352(a3),a0 / move.l a0,d3`. The answer is the
     * ADDRESS of a scratch area inside the extension's own data block — 2,148
     * zero bytes between the last library name and the end of it — and not a
     * figure for free memory, which is what the name suggests and what the
     * guide, having no node for this at all, does not say.
     */
    'g getmem': () => VI(Runtime.TGE_SCRATCH_BASE),

    /**
     * Routine 78 ($2b74) — `=G X Mouse`. *"Returns the X HARDWARE coordinate
     * of the mouse pointer."*, with the guide's own *"*GMS REQUIRED*"*.
     *
     * It is an ACCUMULATOR, not a coordinate: GMS's input poll at `-$24(a6)`
     * is called, and then the structure's x delta at +$e is ADDED to the word
     * at block +$b32 and the sum both stored and returned. So the value walks
     * with the mouse from wherever `G Set Mouse` left it.
     */
    'g x mouse': () => {
      const s = st()
      const w = mouseDat(rt.input.mouseX, rt.input.mouseY)
      // the first poll establishes the baseline rather than reporting the
      // whole free-running counter as one movement, which is what GMS's own
      // first read does and what ../runtime/gamesupport.ts calls seeding
      if (!s.seeded) {
        s.prevX = joyDatX(w)
        s.prevY = joyDatY(w)
        s.seeded = true
      }
      const x = joyDatX(w)
      s.mouseX = (s.mouseX + counterDelta(x, s.prevX)) & 0xffff
      s.prevX = x
      const y = joyDatY(w)
      s.prevY = y
      return VI(s.mouseX)
    },

    /**
     * Routine 79 ($2ba6) — `=G Y Mouse`, the same accumulator on +$b34.
     *
     * DEFECT: it loads the same two pointers as `=G X Mouse` and then does NOT
     * call the poll, so the delta it adds is whatever the last x read left
     * behind. Reading y without reading x first moves nothing.
     */
    'g y mouse': () => {
      const s = st()
      const w = mouseDat(rt.input.mouseX, rt.input.mouseY)
      if (!s.seeded) {
        s.prevX = joyDatX(w)
        s.prevY = joyDatY(w)
        s.seeded = true
      }
      s.mouseY = (s.mouseY + counterDelta(joyDatY(w), s.prevY)) & 0xffff
      return VI(s.mouseY)
    },

    /**
     * Routine 72 ($2a44) — `=G Icon Check`. *"This command checks to see if
     * the icon which was put on wb by G Iconify has been double clicked on. If
     * it has been double clicked on it automagically removes it, and returns
     * True(-1)."*
     *
     * `GetMsg` on the port at block +$b22, `RemoveAppIcon` through
     * `workbench.library` at +$b8, then the port is drained and deleted. The
     * first instruction after loading the port is `tst.l a0 / beq` — and there
     * is never a port here, because `G Iconify` could not open
     * `workbench.library`.
     */
    'g icon check': () => VI(st().iconClicked ? -1 : 0),

    /**
     * Routine 30 ($1d14) — `=G Oddno`. The guide's node is one line, the
     * synopsis `A=G Oddno(B#)`, and no description at all.
     *
     * Two instructions: `move.l -$18ae(a5),d3 / rts`. That slot is AMOS's
     * `graphics.library` base — see `src/cli/oscalls.ts`, which names the
     * whole set — so the answer is a library pointer and has nothing to do
     * with odd numbers.
     *
     * The synopsis is wrong as well: the token spec is `V0`, and the extension
     * docs give `V` as *"V--> reserved variable. In that case, you must ...
     * state the type"*, the `0` being that type. So it takes no argument and no
     * brackets, the way `Timer` does,
     * and `G Oddno(B#)` will not tokenise. The routine agrees: it pops
     * nothing.
     *
     * It sits between eight bare `rts` placeholders at routines 29 and 31-38,
     * which is what an abandoned block of the jump table looks like.
     */
    'g oddno': () => VI(TGE_GFX_BASE),

    /**
     * Routine 85 ($2e1e) — `=Gsin(ANGLE)`. *"returns sin of angle B
     * multiplyed by 128"*.
     *
     *     movea.l $1c8(a5),a0 / movea.l $bce(a0),a1
     *     move.l (a3)+,d0 / asl.w #$1,d0
     *     move.w (a1,d0.w),d3 / asr.l #$8,d3 / rts
     *
     * No bounds test and no table test. The index is doubled with a WORD
     * shift and then used as a sign-extended word displacement, so it wraps
     * every 32768 entries and reads backwards from the table for the second
     * half of that; and with no `G Set Table` the base is zero and the read
     * comes out of the bottom of memory. Neither is memory this port has, so
     * both answer 0.
     *
     * `asr.l #$8` turns the stored cos(x)*32768 into the promised *128 — and
     * loses the sign, because only the low half of d3 was written. See the
     * catalogue.
     */
    'gsin': (_it, a) => VI(trigWord(st(), int(a[0]), 0)),

    /**
     * Routine 86 ($2e32) — `=Gcos(ANGLE)`. *"Returns the cosine of the angle
     * multiplied by 128."*, with *"Angle -> The angle to use in degrees."*,
     * which is only true after `G Set Table 90`.
     *
     * The same seven instructions on the pointer at +$bd2 instead of +$bce,
     * which is the same table read n entries later. The last quarter of it is
     * one step out and this is the function that reads it; see the catalogue.
     */
    'gcos': (_it, a) => {
      const s = st()
      return VI(trigWord(s, int(a[0]), s.cosAt))
    },

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
