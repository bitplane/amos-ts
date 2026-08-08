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

/**
 * `exec.library` AllocMem and FreeMem, as much of them as this extension can
 * see, over one buffer mapped at `Runtime.SLN_HEAP_BASE`.
 *
 * SLN needs a real heap where Personnal and MED needed a single block: it
 * allocates one per array and one per SAMPLE, and the samples are a linked
 * list threaded through their own headers, so a program walking it with Leek
 * needs the blocks to sit at distinct addresses in one space with the gaps in
 * the right places. That is what this is, and nothing more — first fit over a
 * free list, eight-byte granularity as AllocMem has, coalescing on free.
 *
 * It lives here rather than in `src/amiga` because that directory's rule is
 * shared AND AmigaOS, and this has exactly one caller. If a second extension
 * ever wants AllocMem, this is what moves.
 *
 * `MEMF_CLEAR` is honoured because the extension is careful about it in both
 * directions: `S Ainit` passes `move.l #0,d1`, and its own comment is
 * *"Request public mem (NB!! Not cleared)"*, while `S Delete` passes
 * `#1<<16`, which is MEMF_CLEAR, for its FileInfoBlocks. `MEMF_CHIP` (2) is
 * asked for by `S Sam Play` and `S Sam Chip Load`; there is one pool here,
 * so the flag is recorded rather than honoured — see `chip`.
 */
const HEAP_BASE = 0x4400_0000
/**
 * Where the pool is mapped and how much of the map it claims, matching
 * `Runtime.SLN_HEAP_BASE` and `SLN_HEAP_RESERVED`. Spelled out rather than
 * imported because `./runtime` is a TYPE-only import here and reaching for the
 * class would make it a cycle. `memmap.test.ts` holds the two to agreeing.
 */
const HEAP_RESERVED = 0x0400_0000

export class SlnHeap {
  /** what the region maps; grows by doubling, and addresses are offsets into it */
  buffer = new Uint8Array(0)
  /** the bump pointer: everything above it has never been handed out */
  private top = 0
  /** returned blocks, sorted by offset and coalesced */
  private free: Array<{ off: number; len: number }> = []
  /** what each live block was given, so `freeMem` can check the caller's size */
  private live = new Map<number, number>()
  /** offsets that were asked for as chip memory, for `S Sam Play`'s TypeOfMem */
  private chipBlocks = new Set<number>()

  /** AllocMem: an ADDRESS, or 0. Offset 0 is never handed out, so 0 is unambiguous */
  alloc(len: number, opts: { clear?: boolean; chip?: boolean } = {}): number {
    if (len <= 0) return 0
    const need = (len + 7) & ~7
    for (let i = 0; i < this.free.length; i++) {
      const b = this.free[i]!
      if (b.len < need) continue
      const off = b.off
      if (b.len === need) this.free.splice(i, 1)
      else {
        b.off += need
        b.len -= need
      }
      return this.take(off, need, opts)
    }
    // 8 bytes of dead space at the bottom so no real block sits at offset 0
    if (this.top === 0) this.top = 8
    const off = this.top
    this.top += need
    if (this.top > HEAP_RESERVED) return 0
    if (this.top > this.buffer.length) {
      let size = Math.max(this.buffer.length * 2, 0x10000)
      while (size < this.top) size *= 2
      const grown = new Uint8Array(Math.min(size, HEAP_RESERVED))
      grown.set(this.buffer)
      this.buffer = grown
    }
    return this.take(off, need, opts)
  }

  private take(off: number, len: number, opts: { clear?: boolean; chip?: boolean }): number {
    this.live.set(off, len)
    if (opts.chip) this.chipBlocks.add(off)
    else this.chipBlocks.delete(off)
    if (opts.clear) this.buffer.fill(0, off, off + len)
    return (HEAP_BASE + off) >>> 0
  }

  /**
   * FreeMem. The caller supplies the length on the Amiga and this ignores it,
   * for the reason the array batch documents at length: `S Ainit` frees the
   * WRONG BLOCK with the RIGHT SIZE, and a model that trusted the size would
   * turn that defect into an arena corruption nothing could observe. What it
   * does reproduce is which block goes back.
   */
  freeMem(addr: number): void {
    const off = (addr >>> 0) - HEAP_BASE
    const len = this.live.get(off)
    if (len === undefined) return
    this.live.delete(off)
    this.chipBlocks.delete(off)
    this.free.push({ off, len })
    this.free.sort((a, b) => a.off - b.off)
    for (let i = this.free.length - 1; i > 0; i--) {
      const prev = this.free[i - 1]!
      const here = this.free[i]!
      if (prev.off + prev.len === here.off) {
        prev.len += here.len
        this.free.splice(i, 1)
      }
    }
  }

  /** is this address inside a block that was asked for as chip memory? */
  chip(addr: number): boolean {
    const off = (addr >>> 0) - HEAP_BASE
    for (const base of this.chipBlocks) {
      const len = this.live.get(base)
      if (len !== undefined && off >= base && off < base + len) return true
    }
    return false
  }

  /** the length a block was given, or 0 — for `S Sam Del` and the array frees */
  sizeOf(addr: number): number {
    return this.live.get((addr >>> 0) - HEAP_BASE) ?? 0
  }
}

/**
 * One of the eight array slots — `Abase[n]` and the five attribute tables
 * beside it, held as fields rather than as parallel arrays because every
 * routine that touches one touches all six.
 */
export interface SlnArray {
  /** Abase — an address, in the heap or in whatever the user supplied */
  base: number
  /** Acell — 1, 2 or 4 bytes, and `=S Atype` is what reads it back */
  cell: number
  /** Asize — the BYTE count passed to AllocMem */
  size: number
  /** Axsize / Aysize / Azsize — dimensions, each one more than the argument */
  x: number
  y: number
  z: number
}

const newArray = (): SlnArray => ({ base: 0, cell: 0, size: 0, x: 0, y: 0, z: 0 })

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
  /** Abase/Acell/Asize/Axsize/Aysize/Azsize, one entry each */
  arrays: SlnArray[]
  /** Atype — bit n set means the USER supplied array n's memory */
  atype: number
  /** the AllocMem pool everything above is carved out of */
  heap: SlnHeap
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
    arrays: Array.from({ length: SLN_ARRAYS }, newArray),
    atype: 0,
    heap: new SlnHeap(),
  }
}

/* ---- reading and writing the modelled address space ------------------- */

const peek8 = (rt: Runtime, a: number): number => {
  const m = rt.resolveAddr(a >>> 0)
  return m ? (m.data[m.off] ?? 0) : 0
}

const poke8 = (rt: Runtime, a: number, v: number): void => {
  const m = rt.resolveWrite(a >>> 0)
  if (m) m.data[m.off] = v & 0xff
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

/* ---- the eight arrays ------------------------------------------------- *
 *
 * Eight typed arrays of 1, 2 or 4 byte cells in up to three dimensions, held
 * outside AMOS's own variable system in memory the extension allocates. The
 * point of them is speed — an AMOS `DIM` array goes through the interpreter's
 * variable machinery on every access — and the price is that every bound and
 * every cell size is checked by hand, in eleven routines, which do not agree
 * with each other. This section is mostly a record of where they differ.
 * ---------------------------------------------------------------------- */

/** `mulu` — 16 x 16 -> 32, unsigned, and it is why a big array allocates short */
const mulu16 = (a: number, b: number): number => (a & 0xffff) * (b & 0xffff)

/** `cmp / bcs` — "branch if the destination is BELOW the source", unsigned */
const below = (a: number, b: number): boolean => (a >>> 0) < (b >>> 0)

/**
 * The guard `=S Asize`, `=S Abase`, `=S Axsize`, `=S Aysize`, `=S Azsize`,
 * `=S Atype`, `=S Ibase` and `=S Iadr` all share, reproduced rather than
 * tidied:
 *
 *     cmpi    #8,d1        <- WORD compare, signed
 *     rbge    L_error0
 *     cmpi    #0,d1
 *     rbcs    L_error0     <- unsigned "below zero": can never be taken
 *     mulu    #4,d1        <- LOW WORD only, 16x16 -> 32
 *
 * DEFECT: twice over. The second check is dead: `bcs` after `cmpi #0` asks
 * whether an unsigned value is below zero. And the first is a WORD compare on
 * a value the routine then indexes with as a LONG, so -1 passes (its low word
 * is -1 as a word) and `mulu #4` turns it into $3fffc — 262,140 bytes past
 * the table. The guard really only rejects 8 through 32767.
 *
 * Anything outside the eight real slots answers 0 here rather than inventing a
 * number for memory that is not modelled.
 */
function guardedSlot(arg: number): number {
  const idx = arg & 0xffff
  if (((idx << 16) >> 16) >= SLN_ARRAYS) slnError(0)
  return idx
}

/** `L_ArrayErase`, routine 32 — clear the six attributes and the Atype bit */
function arrayErase(st: SlnState, nr: number): void {
  st.arrays[nr] = newArray()
  st.atype &= ~(1 << (nr & 7))
}

/**
 * `S Ainit nr,type,x,y,z` — routine 11, the allocating form, and two defects
 * that shipped.
 *
 * The checks in order, all on WORDS: `nr >= 8` signed; `cell == 3`; `cell >= 5`
 * signed; `cell <= 0` UNSIGNED, so only zero is caught and a negative cell size
 * passes every one of the three; `y+1 < 0`; `z+1 < 0`. There is no check on x
 * at all, because `x + 1 == 0` is the private signal that means *erase* — so
 * `S Ainit n,1,-1,0,0` is the only way to reach `L_ArrayErase` and get the slot
 * genuinely cleared.
 *
 * DEFECT: the free. Re-initialising a slot that already holds memory this
 * extension allocated is supposed to hand that memory back first. What it
 * actually does is
 *
 *     movea.l (a2), a1          <- Abase[0], NOT Abase[nr]
 *     move.l  (a0,d3.w), d0     <- Asize[nr]
 *     jsr     -$d2(a6)          FreeMem
 *
 * so re-initialising array 3 frees ARRAY 0's block with array 3's length. On
 * the machine that corrupts the memory list; with array 0 unused it is
 * `FreeMem(NULL, n)`, which gurus. Confirmed at $e2c in the binary.
 *
 * DEFECT: the flag. The attributes are stored through one `lea` on Axsize
 * with displacements, and the last of them is `bclr.b d3,$40(a1)` — Axsize+$40
 * is AZSIZE, not Atype, which is at Axsize+$60. So the "user supplied this
 * memory" bit is never cleared; what gets cleared is a bit of the top byte of
 * Azsize[0], which is zero anyway. The consequence is real: a slot that once
 * held a user-supplied array keeps its Atype bit forever, so every block this
 * routine later allocates into that slot leaks, and `S Aerase` cannot free it
 * either.
 *
 * DEFECT: the size. `mulu` is 16x16 and the product feeds the next `mulu`,
 * which takes its LOW WORD — so x*y*z*cell truncates to 16 bits at every step
 * and an array of more than 65535 elements allocates far less than it needs.
 */
function arrayInit(rt: Runtime, nr0: number, cell: number, x0: number, y0: number, z0: number): void {
  const st = rt.sln
  const z = (z0 + 1) | 0
  const y = (y0 + 1) | 0
  const x = (x0 + 1) | 0
  const w = (v: number): number => (v << 16) >> 16
  if (w(nr0) >= SLN_ARRAYS) slnError(0)
  if (w(cell) === 3) slnError(0)
  if (w(cell) >= 5) slnError(0)
  if ((cell & 0xffff) === 0) slnError(0)
  if (w(y) < 0) slnError(0)
  if (w(z) < 0) slnError(0)
  const nr = (nr0 & 0xffff) % SLN_ARRAYS
  const slot = st.arrays[nr]!
  if (slot.base !== 0 && !(st.atype & (1 << nr))) {
    // the defect: array ZERO's address, with this array's size
    st.heap.freeMem(st.arrays[0]!.base)
  }
  if (w(x) === 0) return arrayErase(st, nr)
  let size = x
  if (w(y) !== 0) {
    size = mulu16(size, y)
    if (w(z) !== 0) size = mulu16(size, z)
  }
  size = mulu16(size, cell)
  const addr = st.heap.alloc(size)
  // `Request public mem (NB!! Not cleared)` -- the author's own comment
  if (addr === 0) slnError(1)
  st.arrays[nr] = { base: addr, cell: cell & 0xff, size, x, y, z }
  // and here the Atype bit is NOT cleared -- see DEFECT 2
}

/**
 * `S Ainit nr,bank/adr,cell,x,y,z` — routine 31, the form that takes memory
 * the program already has. The Historie lists it as a v2.0 change: *"S Ainit &
 * S Iinit - accepterer nu også bank nummre istedet for adresser"*.
 *
 * DEFECT: the dimensions are incremented by ONE, TWO and THREE.
 *
 *     addi.l  #$1, d7      Z
 *     addi.l  #$2, d6      Y
 *     addi.l  #$3, d5      X
 *
 * against routine 11's three `#$1`s. Confirmed at $14f2/$14fa/$1502. So an
 * array declared over the program's own buffer reports two more rows and three
 * more columns than were asked for, and `S Array` and `S Aset` will happily
 * index into them — past the end of the buffer the program supplied. It also
 * makes the recorded size larger than the buffer, though that only matters to
 * a FreeMem this form never performs.
 *
 * The Atype bit IS set correctly here (`dlea Atype,a1 / bset.b d3,(a1)`), which
 * is what makes routine 11's failure to clear it visible.
 */
function arrayAdrInit(rt: Runtime, nr0: number, adrArg: number, cell: number, x0: number, y0: number, z0: number): void {
  const st = rt.sln
  const z = (z0 + 1) | 0
  const y = (y0 + 2) | 0
  const x = (x0 + 3) | 0
  const w = (v: number): number => (v << 16) >> 16
  const adr = slnAddrOrBank(rt, adrArg)
  if (w(nr0) >= SLN_ARRAYS) slnError(0)
  if (w(cell) === 3) slnError(0)
  if (w(cell) >= 5) slnError(0)
  if ((cell & 0xffff) === 0) slnError(0)
  if (w(y) < 0) slnError(0)
  if (w(z) < 0) slnError(0)
  const nr = (nr0 & 0xffff) % SLN_ARRAYS
  if (st.arrays[nr]!.base !== 0 && !(st.atype & (1 << nr))) {
    st.heap.freeMem(st.arrays[0]!.base)
  }
  if (w(x) === 0) return arrayErase(st, nr)
  let size = x
  if (w(y) !== 0) {
    size = mulu16(size, y)
    if (w(z) !== 0) size = mulu16(size, z)
  }
  size = mulu16(size, cell)
  st.arrays[nr] = { base: adr, cell: cell & 0xff, size, x, y, z }
  st.atype |= 1 << nr
}

/**
 * `L_GetArrayElement` (routine 28) and `L_SetArrayElement` (routine 10).
 *
 * They do not agree, in two ways worth knowing about.
 *
 * A BYTE cell is stored with `move.b` and read back with `clr.l d3 / move.b`,
 * which is ZERO-extended. So `S Aset n,i,-1` then `S Array(n,i)` gives 255.
 * A WORD cell is read with `move.w / ext.l`, sign-extended, so words round-trip.
 *
 * DEFECT: the WORD store does not truncate a negative value, it FORCES the
 * sign bit —
 *
 *     btst.b  #$1f, d7     bit 31 (a register operand, so this is a LONG btst)
 *     bne     .neg
 *     move.w  d7, (a2)
 *     .neg: bset.b #$f, d7 / move.w d7, (a2)
 *
 * so storing -65536 ($ffff0000), whose low word is 0, writes $8000 and reads
 * back -32768 instead of 0. Anything already negative in its low word is
 * unaffected, which is why the bug survived: it is only visible for a value
 * whose sign and whose low word disagree.
 */
function getElement(rt: Runtime, addr: number, cell: number): number {
  if (cell === 1) return peek8(rt, addr)
  if (cell === 2) return (((peek8(rt, addr) << 8) | peek8(rt, addr + 1)) << 16) >> 16
  return ((peek8(rt, addr) << 24) | (peek8(rt, addr + 1) << 16) | (peek8(rt, addr + 2) << 8) | peek8(rt, addr + 3)) | 0
}

function setElement(rt: Runtime, addr: number, cell: number, v: number): void {
  if (cell === 1) return poke8(rt, addr, v)
  if (cell === 2) {
    const stored = (v & 0x80000000) !== 0 ? v | 0x8000 : v
    poke8(rt, addr, stored >> 8)
    poke8(rt, addr + 1, stored)
    return
  }
  poke8(rt, addr, v >>> 24)
  poke8(rt, addr + 1, v >>> 16)
  poke8(rt, addr + 2, v >>> 8)
  poke8(rt, addr + 3, v)
}

/** the slot every element routine looks up, with its own `Abase == 0` check */
function elementSlot(st: SlnState, nr: number): SlnArray {
  const slot = st.arrays[nr & 7]!
  if (slot.base === 0) slnError(0)
  return slot
}

/**
 * `S Array(nr,x)` — routine 23 — and `S Aset nr,x,value` — routine 21.
 *
 * DEFECT: the two do not use the same bound. The reader is
 *
 *     move.l  (a1), d4      <- Axsize, and NO `subi.l #1`
 *     cmp.w   d0, d4        <- a WORD compare
 *     rbcs    L_error0
 *
 * where the writer has the `subi.l #1,d4` and a `cmp.l`. So index == Xsize can
 * be READ and cannot be WRITTEN: `S Array(n,x)` returns one element past the
 * end of the array, and the word compare means only the low 16 bits of the
 * index are checked at all.
 *
 * The two also differ in how they reach the cell. The reader ends
 * `adda.l d1,a2`, the writer `adda d0,a2` — a WORD add, sign-extended. Every
 * writing routine in the extension does this and only two of the readers do,
 * so an array larger than 32K can be read to the end and can only be written
 * in its first 32K; past that the offset goes negative and the write lands
 * BELOW the array's base.
 */
function element1D(st: SlnState, nr0: number, x: number, write: boolean): { addr: number; cell: number } {
  if ((nr0 >>> 0) >= SLN_ARRAYS) slnError(0)
  const nr = nr0 & 7
  const slot = st.arrays[nr]!
  if (write) {
    if (below(slot.x - 1, x)) slnError(0)
  } else if (below(slot.x & 0xffff, x & 0xffff)) slnError(0)
  elementSlot(st, nr)
  const off = mulu16(x, slot.cell)
  return { addr: (slot.base + (write ? (off << 16) >> 16 : off)) >>> 0, cell: slot.cell }
}

/**
 * `S Array(nr,x,y)` — routine 22 — and `S Aset nr,x,y,value` — routine 20,
 * which are the same code twice and carry the same two defects.
 *
 *     move.l  (a1), d4      Aysize[nr]
 *     subi.l  #$1, d4
 *     cmp.l   d0, d4        <- Y against Ysize-1, and NO BRANCH FOLLOWS
 *     movea.l ...           Axsize[nr]
 *     move.l  (a1), d4
 *     subi.l  #$1, d4
 *     cmp.l   d0, d4        <- Y again, this time against XSIZE-1
 *     Rbcs    L_error0
 *
 * DEFECT: the Y check's branch is missing, so its result is discarded, and the
 * check that does branch compares Y — `d0` — against the X bound. `d2`, which
 * holds X, is never compared with anything. So a two-dimensional array is
 * bounds-checked on the wrong index against the wrong limit, and the X index
 * is not checked at all. Confirmed at $1258 and $126c in the binary, and at
 * $1178 for the writer.
 *
 * The index itself is right: `mulu.w d4,d0 / add.l d2,d0` is `y * Xsize + x`.
 */
function element2D(st: SlnState, nr0: number, x: number, y: number): { addr: number; cell: number } {
  if ((nr0 & 0xffff) >= SLN_ARRAYS) slnError(0)
  const nr = nr0 & 7
  const slot = st.arrays[nr]!
  // the bound that actually branches: Y against Xsize - 1
  if (below(slot.x - 1, y)) slnError(0)
  if ((slot.x - 1) < 0) slnError(0)
  elementSlot(st, nr)
  const off = mulu16(mulu16(slot.x, y) + x, slot.cell)
  return { addr: (slot.base + ((off << 16) >> 16)) >>> 0, cell: slot.cell }
}

/**
 * `S Array(nr,x,y,z)` — routine 14 — and `S Aset nr,x,y,z,value` — routine 19.
 *
 * The three-dimensional pair is the one that checks everything it should:
 * `nr` against 8 as an unsigned LONG, Z against Zsize-1, Y against Ysize-1 and
 * X against Xsize-1, each with its branch. The index is
 * `z * Ysize * Xsize + y * Xsize + x`, and every multiply is `mulu`, so the
 * running product truncates to 16 bits each time.
 *
 * The two differ only in the last instruction: the reader is `adda.l d1,a2`
 * and the writer `adda d1,a2`, the same 32K write ceiling as everywhere else.
 */
function element3D(st: SlnState, nr0: number, x: number, y: number, z: number, write: boolean): { addr: number; cell: number } {
  if ((nr0 >>> 0) >= SLN_ARRAYS) slnError(0)
  const nr = nr0 & 7
  const slot = st.arrays[nr]!
  if (below(slot.z - 1, z)) slnError(0)
  if (below(slot.y - 1, y)) slnError(0)
  if (below(slot.x - 1, x)) slnError(0)
  elementSlot(st, nr)
  let idx = mulu16(z, slot.y)
  idx = mulu16(idx, slot.x)
  idx = (idx + mulu16(slot.x, y) + x) | 0
  const off = mulu16(idx, slot.cell)
  return { addr: (slot.base + (write ? (off << 16) >> 16 : off)) >>> 0, cell: slot.cell }
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

    // ---- arrays ---------------------------------------------------------
    /** routines 11 and 31 — five arguments allocate, six take the program's memory */
    's ainit'(it): void {
      const a = [it.evalInt()]
      while (it.accept(',')) a.push(it.evalInt())
      if (a.length >= 6) arrayAdrInit(rt, a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!)
      else arrayInit(rt, a[0]!, a[1]!, a[2]!, a[3]!, a[4]!)
    },
    /** routines 19, 20 and 21 — three, four or five arguments */
    's aset'(it): void {
      const st = rt.sln
      const a = [it.evalInt()]
      while (it.accept(',')) a.push(it.evalInt())
      const value = a[a.length - 1]!
      const cell =
        a.length >= 5
          ? element3D(st, a[0]!, a[1]!, a[2]!, a[3]!, true)
          : a.length === 4
            ? element2D(st, a[0]!, a[1]!, a[2]!)
            : element1D(st, a[0]!, a[1]!, true)
      setElement(rt, cell.addr, cell.cell, value)
    },
    /**
     * Routine 30 — `S Aclear nr`.
     *
     * DEFECT: the counter is the array's length in BYTES and the loop writes
     * LONGWORDS.
     *
     *     move.l  (a1), d1       Asize[nr], a byte count
     *     subi.l  #$1, d1
     *     .loop: clr.l (a1) / adda.l #$4,a1 / dbra d1,.loop
     *
     * so it clears four times the array and runs off the end into whatever is
     * next in the memory list. Confirmed at $14d0-$14e2. `dbra` counts on a
     * WORD, so the run is `Asize mod 65536` longwords rather than `Asize`, and
     * an array of exactly 65536 bytes clears one longword rather than none —
     * the counter is `Asize - 1`, whose low word is $ffff. The heap here is one
     * contiguous buffer, so the overrun lands on the neighbouring allocation
     * exactly as it does on the machine.
     *
     * The guard is `cmpi.l #8,d0 / rbge`, a SIGNED long compare, so a negative
     * slot number passes it; `mulu #4` then indexes off the table, which finds
     * no array here and the routine's own `Abase == 0` test ends it.
     */
    's aclear'(it): void {
      const st = rt.sln
      const arg = it.evalInt()
      if (arg >= SLN_ARRAYS) slnError(0)
      const nr = (arg & 0xffff) * 4
      if (nr % 4 !== 0 || nr / 4 >= SLN_ARRAYS) return
      const slot = st.arrays[nr / 4]!
      if (slot.base === 0) return
      const longs = ((slot.size - 1) & 0xffff) + 1
      for (let i = 0; i < longs; i++) setElement(rt, (slot.base + i * 4) >>> 0, 4, 0)
    },
    /**
     * Routine 33 — `S Aerase nr`, and it does not erase.
     *
     *     move.l  #$1, -(a3)     cell size
     *     move.l  #$0, -(a3)     x
     *     move.l  #$0, -(a3)     y
     *     move.l  #$0, -(a3)     z
     *     Rbra    routine 11
     *
     * DEFECT: `S Ainit` adds one to each dimension and only treats `x + 1 == 0`
     * as the erase signal, so pushing x = 0 asks for a 1 x 1 x 1 array of
     * one-byte cells. The slot is therefore FREED — through routine 11's own
     * wrong-block free — and immediately RE-ALLOCATED as a single byte:
     * `=S Abase` still answers non-zero, `=S Asize` answers 1, and the slot is
     * still marked initialised. Reaching `L_ArrayErase` needs x = -1, which
     * only the long form of `S Ainit` can ask for.
     */
    's aerase'(it): void {
      arrayInit(rt, it.evalInt(), 1, 0, 0, 0)
    },
    /**
     * Routine 34 — `S Aerase All`: the same eight times with the slot number
     * counting 0 to 7, inheriting everything `S Aerase` gets wrong. It is
     * called by the extension's DEFAULT and END routines, so a program that
     * runs to the end leaves eight one-byte allocations behind.
     */
    's aerase all'(): void {
      for (let n = 0; n < SLN_ARRAYS; n++) arrayInit(rt, n, 1, 0, 0, 0)
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
    // ---- arrays ---------------------------------------------------------
    /** routine 12 — Asize[nr], the BYTE count that went to AllocMem */
    's asize': (_, a): Value => VI(rt.sln.arrays[guardedSlot(int(a[0]!))]?.size ?? 0),
    /** routine 13 — Abase[nr], the address itself */
    's abase': (_, a): Value => VI(rt.sln.arrays[guardedSlot(int(a[0]!))]?.base ?? 0),
    /** routine 15 — Axsize[nr], which is the argument plus one (or plus three) */
    's axsize': (_, a): Value => VI(rt.sln.arrays[guardedSlot(int(a[0]!))]?.x ?? 0),
    /** routine 16 — Aysize[nr] */
    's aysize': (_, a): Value => VI(rt.sln.arrays[guardedSlot(int(a[0]!))]?.y ?? 0),
    /** routine 17 — Azsize[nr] */
    's azsize': (_, a): Value => VI(rt.sln.arrays[guardedSlot(int(a[0]!))]?.z ?? 0),
    /**
     * Routine 18 — and "type" means the CELL SIZE, not the Atype flag.
     *
     * It reads `Acell`, a byte per slot, with no `mulu #4` and with the
     * `adda d1,a0` that would have been needed commented out in the source; the
     * displacement does the indexing instead. So this answers 1, 2 or 4 — the
     * same number `S Ainit`'s second argument takes, which the extension calls
     * the type throughout. Nothing reads the real Atype bitmap back out.
     */
    's atype': (_, a): Value => VI(rt.sln.arrays[guardedSlot(int(a[0]!))]?.cell ?? 0),
    /** routines 14, 22 and 23 — three, two or one index */
    's array': (_, a): Value => {
      const st = rt.sln
      const idx = a.map((v) => int(v))
      const cell =
        idx.length >= 4
          ? element3D(st, idx[0]!, idx[1]!, idx[2]!, idx[3]!, false)
          : idx.length === 3
            ? element2D(st, idx[0]!, idx[1]!, idx[2]!)
            : element1D(st, idx[0]!, idx[1]!, false)
      return VI(getElement(rt, cell.addr, cell.cell))
    },

    /**
     * Routine 24 — `InterBase[nr]`, and it has `bclr.l #31,d1` in front of the
     * shared guard where the array readers do not. It changes nothing: `bclr`
     * clears the sign bit of the LONGWORD, and `guardedSlot` only ever looks
     * at the low word.
     */
    's ibase': (_, a): Value => VI(rt.sln.interBase[guardedSlot(int(a[0]!) & 0x7fffffff)] ?? 0),
    /** routine 25 — `InterVarAdr[nr]`, the same guard again */
    's iadr': (_, a): Value => VI(rt.sln.interVar[guardedSlot(int(a[0]!) & 0x7fffffff)] ?? 0),
  }
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
