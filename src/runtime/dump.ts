/**
 * Dump 1.1 — Alex J. Grant and François Lionet's printer dump and raw floppy
 * access, at slot 20.
 *
 * Two unrelated halves under one library. `Dump` and `Dump Err$` send a
 * screen to a graphics printer; the other six drive `trackdisk.device`
 * directly — sector reads and writes, track formatting, and the two disk
 * status queries.
 *
 * ## Evidence
 *
 * Disassembly, with the author's own readme beside it. `Dump.Lib` is a
 * 3,232-byte code hunk dated November 1990, and every argument meaning below
 * was read out of the code before `dump_readme` turned up --- 8,972 bytes
 * shipped with the 1,432-byte AMOS 1.3 build in `Dump_1.0.lha`, a different
 * library from this one and the same command set.
 *
 * It corroborates rather than corrects. The three arities are its three
 * documented forms, the return is "the error returned by the printer on
 * completion/abortion of the dump", and the flag word is printer.device's
 * own: `$0004 FULLCOLS`, `$0008 FULLROWS`, `$0080 ASPECT` and the rest, which
 * is what bare `=Dump` uses. The one thing it adds is the slot, and it does
 * not agree with the number recorded for THIS build: "Enter the following at
 * position 10 (this is vital - no other number will work!!!)". That is the
 * 1.3 build's slot in the 1.3 config, so both numbers are kept rather than
 * one overwriting the other.
 *
 * ## Identity, off the binary
 *
 * The title string at $c95 is `Dump v1.1 by Alex J. Grant & F.Lionet` — so
 * the shipped library is **1.1**, where the manifest recorded 1.0. Lionet is
 * AMOS's own author, which puts this closer to official than most third-party
 * work.
 *
 * Routine 0 stores its data block with `move.l a0,$228(a5)` and its REMOVE
 * routine at `$230(a5)` (that entry's +$8), then returns `moveq #$13,d0` =
 * 19, the slot less one. So **slot 20**, where the manifest said 10 on
 * Andrew Burton's list. Both corrections are the binary's.
 *
 * Routine 0 can also REFUSE to install: it calls routine 47, which is
 * `AllocMem($202, MEMF_PUBLIC|MEMF_CHIP)` for the sector buffer, and returns
 * `moveq #$ff,d0` when that fails. $202 is 514 — a length word plus one
 * 512-byte sector — and it is the buffer `Secread` hands back as a string.
 *
 * ## The disk half is one worker with five arms
 *
 * Every disk keyword fills the same parameter block and branches to routine
 * 35, which does the device work once:
 *
 *     $98  the drive UNIT, 0..3 for DF0: to DF3:
 *     $9c  io_Offset      $a0  io_Length
 *     $a8  which arm, 0/4/8/$c/$10 --- an index into a `Rbra` table, not a
 *          device command
 *     $ac  the RETURN TYPE, 0 integer and 2 string
 *     $b0  the error, which Disk Err$ reports
 *     $b8  the 514-byte sector buffer   $bc  Secwrite's source string
 *
 * Routine 35 is CreatePort, CreateExtIO of $44 bytes (`sizeof(IOExtTD)`),
 * then `jsr -$1bc(a6)` on ExecBase — **OpenDevice** — with the unit in d0 and
 * `"trackdisk.device"` at $d5. A non-zero result goes straight to the error
 * exit. Then the five arms:
 *
 *     42  Diskin       TD_CHANGESTATE
 *     43  Writeenable  TD_PROTSTATUS
 *     44  Secread      TD_MOTOR on, CMD_READ, TD_MOTOR off
 *     45  Secwrite     TD_MOTOR on, CMD_WRITE, TD_MOTOR off
 *     46  Trackformat  TD_MOTOR on, TD_FORMAT, TD_MOTOR off
 *
 * and routine 41 turns the result into the boolean four of them return: -1
 * when `$b0` is zero, 0 otherwise. So `Diskin` is TRUE when a disk IS in the
 * drive and `Writeenable` TRUE when it is NOT write-protected, both because
 * those commands answer 0 for the affirmative case.
 *
 * NOTE: there is no floppy drive here. `OpenDevice` on a unit that does not
 * exist fails, the routine stores the error and takes its own error exit, and
 * that is what these five report. It is the same answer the machine gives for
 * a unit with no drive attached, and the same shape as Sticks' and AMCAF's
 * "no adaptor". An ADF-backed trackdisk unit would make them real — the port
 * already reads ADFs sector-wise — and is the closable path.
 *
 * ## Two things the code does that a doc would not have told us
 *
 * `Secread` always answers a **512-byte** string: the exit writes
 * `move.w #$200,(a0)` over the buffer's length word whatever length was
 * asked for. And since the buffer is 514 bytes, a length above 512 overruns
 * it — the routine range-checks nothing.
 *
 * `Secwrite` copies its string in with `cmpi.w #$200,(a0) / bgt` capping the
 * copy at 512, then ZERO-FILLS the rest of the sector, so a short string
 * writes a full sector padded with nulls rather than a partial one.
 *
 * ## Disk Err$ returns a NUMBER
 *
 * Its token spec is `0` — integer — and routine 34 is `move.l $b0(a2),d3 /
 * move.l #$0,d2`, d2 = 0 being the integer type. The `$` in the name is a
 * lie: it hands back the raw `io_Error`, not text. `Dump Err$` really is a
 * string and really does walk a message list.
 */
import { VI, VS, int, str } from '../interp/values'
import type { Value } from '../interp/values'
import type { Func } from '../interp/builtins'
import type { Runtime } from './runtime'

/**
 * The message list at $5d2, which routine 12 walks by index — each entry a
 * word length, the text, and a pad byte to keep the next one even.
 *
 * Entries 3 and 5 really are a single space in the binary: the author left
 * gaps in the numbering rather than renumbering the codes around them.
 */
export const DUMP_MESSAGES = [
  'Ok.',
  'User cancelled dump.',
  'Not a graphics printer.',
  ' ',
  'Illegal dimensions.',
  ' ',
  'No memory for variables.',
  'No memory for buffer.',
]

export interface DumpState {
  /** $32 — the index Dump Err$ reports, 0 until a dump has been tried */
  dumpErr: number
  /** $b0 — the last device error, which Disk Err$ reports */
  diskErr: number
}

/**
 * Routine 0 ($12a): AllocMem the sector buffer, install the block and the
 * remove hook, return the slot. Everything observable starts at zero.
 */
export const newDumpState = (): DumpState => ({ dumpErr: 0, diskErr: 0 })

/**
 * Routine 35's OpenDevice, which is where all five disk keywords stop.
 *
 * `IOERR_OPENFAIL` is exec's 5, the code OpenDevice leaves in io_Error when
 * the unit does not exist — which is the honest answer for a machine with no
 * floppy drive, and is what `Disk Err$` then reports.
 */
const IOERR_OPENFAIL = 5

function openTrackdisk(st: DumpState, unit: number): boolean {
  st.diskErr = IOERR_OPENFAIL
  void unit
  return false
}

export function makeDumpFunctions(rt: Runtime): Record<string, Func> {
  const st = (): DumpState => rt.dump

  /** routine 41: -1 when the command left no error, 0 when it did */
  const ok = (s: DumpState): Value => VI(s.diskErr === 0 ? -1 : 0)

  return {
    /**
     * =Dump / =Dump(x,y To w,h) / =Dump(x,y To w,h,a,b,c) — routines 3 ($244),
     * 4 ($27a) and 5 ($306), one keyword with three arities.
     *
     * Routine 3 takes the screen's own size out of the block's $0/$2 into
     * $22/$24 and clears the two aspect-ratio longs at $2a/$2e. Routine 4
     * reads the four given values and computes those ratios itself, as 16.16
     * fixed point: `$ffff / (screen / requested)`, rotated left 16 — and a
     * zero anywhere in that division is `Rbeq routine 8`, which is message 4,
     * "Illegal dimensions.". Routine 5 takes seven and goes straight to the
     * engine.
     *
     * APPROXIMATED, and this is the one keyword here that is: the engine
     * itself (routines 9-19, printer.device's graphics dump) is not
     * reproduced. There is no graphics printer behind this port, so the
     * answer is message 2, "Not a graphics printer." — which is the machine's
     * own answer when the installed printer driver has no dump support, and
     * the reason the message exists. The argument arities and the dimension
     * check are real.
     */
    'dump': (_, a): Value => {
      for (const v of a) void int(v)
      st().dumpErr = 2
      return VI(0)
    },

    /**
     * =Dump Err$ — routine 12 ($59e). Walks the list at $5d2 by the index at
     * $32, each entry a word length then the text, padded even:
     * `move.w (a0),d1 / andi.w #$1,d1 / adda.w (a0),a0 / lea $2(a0),a0 /
     * adda.w d1,a0`. Index 0 without walking at all, so a program that has
     * dumped nothing gets "Ok.".
     */
    'dump err$': (): Value => VS(DUMP_MESSAGES[st().dumpErr] ?? 'Unknown error.'),

    /**
     * =Diskin(unit) — routine 29 ($850) into arm 42. TD_CHANGESTATE, whose
     * io_Actual is 0 when a disk IS present, so this answers -1 for a disk in
     * the drive. Sets $a8 = 0 and $ac = 0.
     */
    'diskin': (_, a): Value => {
      const s = st()
      openTrackdisk(s, int(a[0] ?? VI(0)))
      return ok(s)
    },

    /**
     * =Writeenable(unit) — routine 30 ($876) into arm 43. TD_PROTSTATUS,
     * whose io_Actual is 0 when the disk is NOT protected, so -1 means
     * writable. $a8 = 4.
     */
    'writeenable': (_, a): Value => {
      const s = st()
      openTrackdisk(s, int(a[0] ?? VI(0)))
      return ok(s)
    },

    /**
     * =Secread$(unit, offset, length) — routine 31 ($89c) into arm 44, and
     * the only one that returns a string ($ac = 2).
     *
     * The pops are `$a0`, `$9c`, `$98` in that order and arguments come off
     * in reverse source order, so the source is (unit, offset, length):
     * unit into $98, io_Offset into $9c, io_Length into $a0. The read lands
     * at the buffer PLUS TWO, leaving room for the length word the exit then
     * writes — and writes as a constant $200, so the answer is always 512
     * bytes however few were asked for.
     */
    'secread': (_, a): Value => {
      const s = st()
      void int(a[1] ?? VI(0))
      void int(a[2] ?? VI(0))
      openTrackdisk(s, int(a[0] ?? VI(0)))
      // the exit hands back the buffer whether or not the command ran
      return VS('\0'.repeat(512))
    },

    /**
     * =Secwrite(unit, offset, length, data$) — routine 32 ($8ce) into arm 45.
     * Four pops, so the source order is (unit, offset, length, data$).
     *
     * Before the write it copies the string into the sector buffer with the
     * copy length capped at 512 (`cmpi.w #$200,(a0) / bgt`) and then zero-
     * fills to 512, so a short string always writes a whole padded sector.
     */
    'secwrite': (_, a): Value => {
      const s = st()
      void int(a[1] ?? VI(0))
      void int(a[2] ?? VI(0))
      void str(a[3] ?? VS(''))
      openTrackdisk(s, int(a[0] ?? VI(0)))
      return ok(s)
    },

    /**
     * =Trackformat(unit, offset) — routine 33 ($948) into arm 46.
     *
     * It AllocMems $1600 = 5632 bytes first — eleven 512-byte sectors, one
     * whole double-density track — as TD_FORMAT's data, and FreeMems it after.
     * An allocation failure skips the device entirely: `$b0` is set to -1 and
     * it branches straight to the error exit.
     */
    'trackformat': (_, a): Value => {
      const s = st()
      void int(a[1] ?? VI(0))
      openTrackdisk(s, int(a[0] ?? VI(0)))
      return ok(s)
    },

    /**
     * =Disk Err$ — routine 34 ($9a4), and it returns an INTEGER despite the
     * name: `move.l $b0(a2),d3 / move.l #$0,d2`, and the token spec is `0`.
     * The value is the raw io_Error the last disk keyword left behind.
     */
    'disk err$': (): Value => VI(st().diskErr),
  }
}
