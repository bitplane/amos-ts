/**
 * SLN 2.0 — Søren Nielsen's extension, at slot 24.
 *
 * Seventy keywords in six groups that have almost nothing to do with each
 * other: a mouse-counter reader, eight fast typed arrays outside AMOS's own
 * variable system, eight user VBL hooks, a sample player with its own bank
 * format, raw `trackdisk.device` sector access, and a ProTracker replayer.
 * It is one person's toolbox rather than a product line, and the `Historie`
 * file that ships beside it reads as one: v1.0 is the arrays, the samples and
 * the mouse, and v2.0 adds *"S Disk Open, S Disk Close, S Motor On..."* and
 * turns the whole thing shareware.
 *
 * ## Evidence
 *
 * SOURCE tier, and unusually complete: `sln_extII.s` is 4,949 lines and
 * carries every routine, the token table, the data zone and the error strings.
 * It is not the shell-only case `GameSupport.s` turned out to be — the only
 * things it `include`s are `Sln_Macros.s`, AMOS's own `|amos_includes.s` and
 * `exec/ports.i`, i.e. the macro and equate files every extension needs, and
 * nothing that holds a keyword body. `ExtNb equ 24-1` is the slot, in the
 * author's own hand, and it agrees with Andrew Burton's list.
 *
 * The binary is read anyway where the source says something surprising, which
 * is the tier rule working rather than distrust: `extdis sln-2.0` disassembles
 * `AMOSPro_SLN_2.0.lib` (17,576-byte code hunk, 113 routines, jump table at
 * +18). Every claim below marked "the binary agrees" was checked that way.
 *
 * ## The token table has 70 names for 71 commands, and one of them is a lie
 *
 * `Sln_ext_Historie` ends *"Sln extension indeholder nu ialt 71
 * kommandoer/instruktioner"* — 71 commands. The table holds 70 names. The
 * missing one is not missing: `s mask$` is in the table with this beside it,
 *
 *     dc.w  1,-1        ;This command is non-existent!!! DO NOT USE.
 *     dc.b  "s mask","$"+$80,"22,2",-1  ;Strictly for maintaining compability
 *           ;(will be replaced, as soon as I find another command which fit
 *           ; the length)
 *
 * so the author was padding the table to keep token ids stable across a
 * release. Its spec `"22,2"` parses it as a STRING FUNCTION of two strings,
 * and its function routine is -1. There is no routine to reach: evaluating it
 * jumps through a null vector. It is `n/a` here for that reason — the same
 * classification AMCAF's `Trans Screen Dynamic` gets, and for the same reason,
 * that the token exists and the code behind it does not.
 *
 * ## The data zone (`MB`, the block routine 0 hands AMOS)
 *
 *     PrevX/PrevY   .l   last frame's raw counter byte, sign-extended
 *     CurX/CurY     .l   the accumulated position S X Mouse reads
 *     Status        .w   see the bit table below
 *     Status2       .w   which voices the SAMPLE player holds
 *     Abase[8]      .l   array base addresses      Acell[8]  .b  cell size
 *     Asize[8]      .l   bytes allocated           Axsize/Aysize/Azsize[8] .l
 *     Atype         .b   bit n set = the USER supplied array n's memory
 *     TrackTempo    .b   6
 *     InterBase[8]  .l   user VBL routine addresses
 *     InterVarAdr[8].l   the a0 each one is called with
 *     Volume[4]     .w   the per-channel level the VBL hook re-asserts
 *     BankName      "Sln.Sam."      SamBankNr .w
 *     IChan[4]      .l   the CIA clock tick to stop each voice at
 *     ISBase[4] .l  ISLen[4] .l     the chip copy playing on each voice
 *     DiskBuffer 12b     TrackIO 80b     TrackMsg 36b
 *
 * `Status`, from the source's own table:
 *
 *     0     mouse reader on            1-4   volume control, voices 0-3
 *     5-8   sample stop timer, 0-3     9-12  free the chip copy when it stops
 *     13    trackdisk.device open      14    tracker player running
 *
 * ## What this port cannot do, stated once
 *
 * `S Iinit` installs a 68k routine to be called every vertical blank. There is
 * no 68k here — the same boundary `Call`, `Dreg` and `Doscall` are n/a for —
 * so the table is kept faithfully and nothing is ever entered. See `slnVbl`.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { AmosError, VI, int, type Value } from '../interp/values'
import { mouseDat } from '../amiga/gameport'

/**
 * The twenty-eight messages, verbatim from `sln_extII.s`'s `ErrMess` table.
 *
 * Trappable: routine 111 sets `moveq #0,d1` before `L_ErrorExt`, which is the
 * same convention every other extension here uses.
 *
 * Nine through twenty-four are `trackdisk.device`'s own `io_Error` values,
 * renumbered: `L_TrackErrorCheck` reads the byte at `31(a1)` and subtracts 11
 * before raising, with the source's comment *"Trackerrors start with 20, mine
 * at 9"*. So TDERR_NoSecHdr (20) is message 11 rather than 10 — the author's
 * arithmetic is off by one against his own table, which `slnTrackError`
 * reproduces rather than corrects.
 */
export const SLN_ERRORS = [
  'Illegal function call',
  'Out of memory',
  'Unable to reserve bank',
  'File error',
  'Sample bank not reserved',
  'Unable to reserve enough memory to play sample',
  'Unable to open window',
  'Unable to open trackdisk device',
  'Trackdisk device not opened',
  'Unknown trackdisk error',
  'Trackdisk error: No sector header present',
  'Trackdisk error: Invalid sector header',
  'Trackdisk error: Invalid sector ID',
  'Trackdisk error: Incorrect header checksum',
  'Trackdisk error: Incorrect sector checksum',
  'Trackdisk error: Not enough sectors available',
  'Trackdisk error: Illegal sector header',
  'Trackdisk error: Disk is writeprotected',
  'Trackdisk error: Disk was changed',
  'Trackdisk error: Track not found',
  'Trackdisk error: Not enough memory',
  'Trackdisk error: Illegal sector number',
  'Trackdisk error: Illegal drive type',
  'Trackdisk error: Drive in use',
  'Trackdisk error: Reset phase',
  'Start position exceeds song length',
  'Unable to delete file',
  'Unable to lock file/dir',
]

export const slnError = (n: number): never => {
  throw new AmosError(SLN_ERRORS[n] ?? `SLN error ${n}`)
}

/** `move.b $dff00d,d0 / ext.l d0` — the counter byte read as signed */
const sb = (v: number): number => (v << 24) >> 24

/** Status bits, by the source's own numbering */
const ST_MOUSE = 0

/** how many of each thing the data zone has room for */
export const SLN_ARRAYS = 8
export const SLN_INTERRUPTS = 8

export interface SlnState {
  /** PrevX/PrevY — the previous frame's raw counter, sign-extended */
  prevX: number
  prevY: number
  /** CurX/CurY — what `S X Mouse` and `S Y Mouse` hand back */
  curX: number
  curY: number
  /** Status and Status2, both words */
  status: number
  status2: number
  /** InterBase[8] and InterVarAdr[8] */
  interBase: number[]
  interVar: number[]
}

export function newSlnState(): SlnState {
  return {
    prevX: 0,
    prevY: 0,
    curX: 0,
    curY: 0,
    // routine 0 writes none of these: the data zone is static inside the code
    // hunk, so everything starts as the assembled bytes, and every field above
    // is `dc.l 0` / `dc.w 0` there
    status: 0,
    status2: 0,
    interBase: new Array<number>(SLN_INTERRUPTS).fill(0),
    interVar: new Array<number>(SLN_INTERRUPTS).fill(0),
  }
}

/**
 * JOY0DAT as this port supplies it — the pointer position through eight bits.
 *
 * SLN reads the two halves separately (`$dff00d` is the X counter, `$dff00c`
 * the Y) rather than the word, so this is `mouseDat` split back up. Same
 * register `../amiga/gameport.ts` already serves GameSupport and Ercole from.
 */
const counterX = (rt: Runtime): number => sb(mouseDat(rt.input.mouseX, rt.input.mouseY) & 0xff)
const counterY = (rt: Runtime): number => sb((mouseDat(rt.input.mouseX, rt.input.mouseY) >> 8) & 0xff)

/**
 * One axis of `InterStart`, the VBL hook routine 0 installs.
 *
 *     move.b  $dff00d,d0 / ext.l d0     this frame's counter
 *     move.l  (a1),d1                   PrevX
 *     sub.l   d1,d0                     the delta
 *     cmpi.l  #50,d0  / bge  skip       "Test for overrun"
 *     cmpi.l  #-50,d0 / ble  skip
 *     move.l  (a0),d1 / add.l d0,d1 / move.l d1,(a0)
 *     move.b  $dff00d,d2 / ext.l d2 / move.l d2,(a1)
 *
 * DEFECT: this is what the "overrun" guard costs --- the counter is a byte and
 * wraps, so a pointer crossing 127 gives a delta of -255 and one crossing -128
 * gives +255. Both are outside +/-50, so the sample is DISCARDED rather than
 * wrapped, and `S X Mouse` loses 255 units of travel every 256. A real
 * quadrature reader takes the delta modulo 256 into -128..127 — which is what
 * `counterDelta` in ../amiga/gameport.ts does for GameSupport, and the
 * contrast is the point. The guard also drops any genuine movement of 50 or
 * more counts in one frame, so a fast drag stalls the reading entirely.
 *
 * NOTE the bounds are inclusive on both sides (`bge`/`ble`, not `bgt`/`blt`),
 * so exactly +/-50 is discarded too.
 *
 * The re-read for PrevX is the routine's own: it does not reuse the value it
 * just subtracted from. On the machine the counter can have advanced between
 * the two instructions and the difference is lost; here the two reads are the
 * same value, which is the best a frame-granular pointer can do.
 */
function accumulate(cur: number, prev: number, now: number): { cur: number; prev: number } {
  const d = now - prev
  if (d >= 50 || d <= -50) return { cur, prev: now }
  return { cur: (cur + d) | 0, prev: now }
}

/**
 * `InterStart`, minus the parts that belong to later batches.
 *
 * Routine 0 installs it with `L_Ifree`/`L9`-style code inlined: it counts the
 * free `VblRout` slots, takes the first one, and stores the slot index in
 * `UsedVBL` so `End` can clear exactly that entry. It deliberately does NOT
 * erase anyone else's hook — the source comment is *"Insert interrupt routine
 * (WITHOUT erasing any previously installed)"* — and if none is free it gives
 * up silently and still reports success.
 *
 * The hook does four things in order: the mouse counters (here), the eight
 * user routines (below), the per-voice volume re-assert, and the sample stop
 * timer. The last two arrive with the sample batch.
 */
export function slnVbl(rt: Runtime): void {
  const st = rt.sln
  if (!st) return
  if (st.status & (1 << ST_MOUSE)) {
    const x = accumulate(st.curX, st.prevX, counterX(rt))
    st.curX = x.cur
    st.prevX = x.prev
    const y = accumulate(st.curY, st.prevY, counterY(rt))
    st.curY = y.cur
    st.prevY = y.prev
  }
  /*
   * The user interrupts, which is where this port stops:
   *
   *     move.l  (a1),a2      InterBase[n]
   *     move.l  (a3),a0      InterVarAdr[n], handed over in a0
   *     jsr     (a2)
   *
   * DEVIATION: structural. That `jsr` enters 68000 machine code, and this
   * port executes none — the boundary `Call`, `Dreg`, `Execall` and machine-code
   * procedures are all n/a for. The table is maintained exactly (`S Iinit`,
   * `S Ierase`, `=S Ibase`, `=S Iadr`, `=S Ifree` all answer from it), so a
   * program can install, count and read back its hooks and see the right
   * numbers; the routine simply never runs. It raises nothing, because the
   * failure is once a frame rather than once at the call, and an error thrown
   * fifty times a second is not a diagnosis.
   */
}

export function makeSlnInstructions(rt: Runtime): Record<string, Instr> {
  return {
    // ---- mouse ---------------------------------------------------------
    /**
     * Routine 1 — `bset #0,Status`. The reader, not the pointer: AMOS's own
     * mouse goes on running either way, and this only starts the counter
     * accumulation in the VBL hook.
     */
    's mouse on'(): void {
      rt.sln.status |= 1 << ST_MOUSE
    },
    /** routine 2 — `bclr #0,Status`, and the accumulators keep their values */
    's mouse off'(): void {
      rt.sln.status &= ~(1 << ST_MOUSE)
    },
    /** routine 7 — `move.l (a3)+,CurX`, with no range check of any kind */
    's x mouse='(it): void {
      rt.sln.curX = it.evalInt() | 0
    },
    /** routine 8 — the same for CurY */
    's y mouse='(it): void {
      rt.sln.curY = it.evalInt() | 0
    },

    // ---- user interrupts -----------------------------------------------
    /**
     * Routine 26 — `s iinit nr,bank/adr,var bank/adr`.
     *
     * Both address arguments go through the same test, `cmpi.l #$10000,d1 /
     * ble .GetAdr`: anything up to and including 65536 is a BANK NUMBER and is
     * resolved with `L_Bnk.GetAdr`, anything above it is an address already.
     * The v2.0 Historie lists exactly this as a change from v1.0 — *"S Ainit &
     * S Iinit - accepterer nu også bank nummre istedet for adresser"*.
     *
     * `ble` is signed and inclusive, so bank 65536 is a bank and a negative
     * "address" is one too. A bank that does not exist raises error 0.
     *
     * The slot check is `bclr.l #31,d3` then `cmpi.l #8,d3 / rbcc` — an
     * UNSIGNED compare against a longword, so unlike the reader keywords below
     * this one really does reject everything outside 0..7.
     */
    's iinit'(it): void {
      const st = rt.sln
      const nrArg = it.evalInt()
      it.expect(',')
      const adrArg = it.evalInt()
      it.expect(',')
      const varArg = it.evalInt()
      // the routine pops right to left, so the VAR bank is resolved first and
      // its "bank does not exist" error is the one a program sees
      const varAdr = slnAddrOrBank(rt, varArg)
      const adr = slnAddrOrBank(rt, adrArg)
      const nr = nrArg & 0x7fffffff
      if (nr >>> 0 >= SLN_INTERRUPTS) slnError(0)
      st.interBase[nr] = adr
      st.interVar[nr] = varAdr
    },
    /**
     * Routine 29 — `REPT 8 / clr.l (a0) / clr.l (a1)`. Both tables at once,
     * no argument, no way to remove one hook. Called by the extension's own
     * DEFAULT and END routines, so `Run` and quitting clear them.
     */
    's ierase'(): void {
      const st = rt.sln
      st.interBase.fill(0)
      st.interVar.fill(0)
    },
  }
}

export function makeSlnFunctions(rt: Runtime): Record<string, Func> {
  return {
    // ---- mouse ---------------------------------------------------------
    /** routine 3 — `move.l CurX,d3`, a signed 32-bit count of counter units */
    's x mouse': (): Value => VI(rt.sln.curX),
    /** routine 4 — CurY */
    's y mouse': (): Value => VI(rt.sln.curY),
    /**
     * Routine 5, and it is six instructions long:
     *
     *     clr.l d2 / clr.l d3
     *     btst.b #$2,$bfe001.l
     *     bne.w  .end
     *     bset.b #$0,d3
     *
     * DEFECT: bit 2 of CIA-A PRA is the floppy DISK-CHANGE line, /CHNG.
     * The left mouse button is bit 6, /FIR0 — which is what TURBO Plus, Misc,
     * First, JD and AMOS itself all test. The binary agrees with the source
     * byte for byte, so this is what shipped, and the author's own comment two
     * lines down (*"Sorry - don't know address for button 2"*) shows he was
     * looking for the buttons and got the bit number wrong.
     *
     * What that means on a real machine: /CHNG sits HIGH once the drive has
     * stepped after a disk was inserted, and only goes low when a disk is
     * removed. So the routine answers 0 — no button — on any machine with a
     * disk in DF0:, which in 1994 was every machine running this. **`S Mouse
     * Button` cannot report a mouse press.** It answers 0 here for the same
     * reason: nothing ejects a disk in this port, so the line never falls.
     *
     * Bit 1, the right button, is dead in a second way. The code for it is
     * present and COMMENTED OUT:
     *
     *     ;btst #6,$dff016
     *     ;bne  L5_end
     *     ;bset #1,d3
     *
     * and $dff016 bit 6 is POTGOR's right-button bit, which is correct. He had
     * the answer and did not enable it, so bit 1 is always clear.
     */
    's mouse button': (): Value => VI(0),

    // ---- user interrupts -----------------------------------------------
    /**
     * Routine 27 — how many of the eight slots are still zero.
     *
     * NOT to be confused with routine 6, which is also called `L_Ifree` in the
     * source and counts free slots in AMOS's OWN `VblRout` table; that one is
     * an internal helper the cold start uses and no keyword reaches. The token
     * table binds `s ifree` to function routine 27, which is
     * `L_InterFree`, and this is that.
     */
    's ifree': (): Value => VI(rt.sln.interBase.filter((v) => v === 0).length),
    /** routine 24 — `InterBase[nr]`; see `slotRead` for the guard */
    's ibase': (_, a): Value => VI(slotRead(rt.sln.interBase, int(a[0]!))),
    /** routine 25 — `InterVarAdr[nr]`, the same guard again */
    's iadr': (_, a): Value => VI(slotRead(rt.sln.interVar, int(a[0]!))),
  }
}

/**
 * The guard `=S Ibase` and `=S Iadr` share, reproduced rather than tidied.
 *
 *     move.l  (a3)+,d1
 *     bclr.l  #31,d1
 *     cmpi    #8,d1        <- WORD compare, signed
 *     rbge    L_error0
 *     mulu    #4,d1        <- LOW WORD only, 16x16 -> 32
 *     move.l  (a0,d1.l),d3
 *
 * DEFECT: the check is a word and the index is a long. `bclr #31` clears the
 * sign bit of the LONGWORD, so -1 becomes $7fffffff, whose low word is $ffff,
 * which as a signed word is -1 and passes `bge #8`. `mulu #4` then makes it
 * $3fffc and the routine reads 262,140 bytes past the table.
 *
 * So the guard rejects 8..32767 and lets everything else through. Anything
 * this port cannot resolve to a real slot answers 0 rather than inventing a
 * number for memory that is not modelled.
 */
function slotRead(table: readonly number[], arg: number): number {
  const idx = (arg & 0x7fffffff) & 0xffff
  if ((idx << 16) >> 16 >= SLN_INTERRUPTS) slnError(0)
  return table[idx] ?? 0
}

/**
 * `cmpi.l #$10000,dn / ble .GetAdr` — the "bank number or address" test the
 * v2.0 keywords share, and the one thing the Historie calls out as new.
 *
 * `ble` is a SIGNED compare and inclusive, so 65536 itself is a bank number
 * and so is anything negative. `L_Bnk.GetAdr` returns zero for a bank that is
 * not reserved, and every caller answers error 0 on that.
 */
export function slnAddrOrBank(rt: Runtime, v: number): number {
  if (v > 0x10000) return v >>> 0
  const bank = rt.memBanks.get(v)
  if (!bank) slnError(0)
  return rt.bankBase(v) >>> 0
}
