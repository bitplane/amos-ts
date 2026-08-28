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
import type { FloppyDrive } from '../amiga/trackdisk'
import type { Func, Instr } from '../interp/builtins'
import { AmosError, VI, int, str, type Value } from '../interp/values'
import { MemPool } from '../amiga/exec'
import { mouseDat } from '../amiga/gameport'
import { Protracker, parseMod } from '../amiga/protracker'
import {
  IDCMP_CLOSEWINDOW,
  WBENCHSCREEN,
  WFLG_ACTIVATE,
  WFLG_CLOSEGADGET,
  WFLG_DEPTHGADGET,
  WFLG_DRAGBAR,
  type Window,
} from '../amiga/intuition'

/** `SyCall AmalFrz` / `AmalUfrz` — every channel at once, as Amal Freeze does */
const amalFreeze = (rt: Runtime, on: boolean): void => {
  for (const ch of rt.channels.values()) ch.frozen = on
}

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
 * SLN's AllocMem pool.
 *
 * SLN needs a real heap where Personnal and MED needed a single block: it
 * allocates one per array and one per SAMPLE, and the samples are a linked
 * list threaded through their own headers, so a program walking it with Leek
 * needs the blocks to sit at distinct addresses in one space with the gaps in
 * the right places. `MemPool` in ../amiga/exec.ts is that, and this names
 * where SLN's copy of it is mapped.
 *
 * `MEMF_CLEAR` is honoured because the extension is careful about it in both
 * directions: `S Ainit` passes `move.l #0,d1`, and its own comment is
 * *"Request public mem (NB!! Not cleared)"*, while `S Delete` passes
 * `#1<<16`, which is MEMF_CLEAR, for its FileInfoBlocks. `MEMF_CHIP` (2) is
 * asked for by `S Sam Play` and `S Sam Chip Load`, and the pool records it
 * rather than honouring it — see `MemPool.chip`.
 *
 * The two constants are spelled out rather than imported because `./runtime`
 * is a TYPE-only import here and reaching for the class would make it a
 * cycle; they match `Runtime.SLN_HEAP_BASE` and `SLN_HEAP_RESERVED`, and
 * `memmap.test.ts` holds the two to agreeing.
 */
const HEAP_BASE = 0x4400_0000
const HEAP_RESERVED = 0x0400_0000

export const newSlnHeap = (): MemPool => new MemPool(HEAP_BASE, HEAP_RESERVED)

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
  heap: MemPool
  /** `IWindow` — the one iconify window, open only while S Iconify is blocked */
  iconWindow: Window | null
  /** SamBankNr — which AMOS bank the sample chain lives in; 0 means none */
  samBankNr: number
  /** Volume[4] — what the VBL hook re-asserts into AUDxVOL, per voice */
  volume: number[]
  /** IChan/ISBase/ISLen, one entry per voice */
  voices: SlnVoice[]
  /** the TrackIO request and Status bit 13 */
  disk: SlnDisk
  /** TrackTempo — `dc.b 6` in the data zone, and the seed for every mt_init */
  trackTempo: number
  /** the replayer and its play counter */
  music: SlnMusic
}

export function newSlnState(rt?: Runtime): SlnState {
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
    heap: newSlnHeap(),
    iconWindow: null,
    samBankNr: 0,
    volume: [0, 0, 0, 0],
    voices: Array.from({ length: 4 }, () => ({ stopAt: 0, base: 0, len: 0 })),
    disk: { open: false, unit: 0, motor: false, pending: null },
    trackTempo: 6,
    music: { replay: new Protracker(() => rt?.host.audio), times: 0 },
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
   * `CallPlayer`, the tail of the hook: `btst #14,d0 / bne / Rbra
   * L_TrackerPlayer` with d0 zero, which is the replayer's "play one tick".
   *
   * The channel mask is Status2 --- the voices the SAMPLE player is using ---
   * and the player writes to a ten-byte `dummy` instead of the hardware for
   * each of them, so a sound effect takes a voice off the music for as long as
   * it lasts and hands it back afterwards. Reading it here rather than at
   * `S Sam Play` is the routine's own order: the mask is sampled once a frame,
   * at the top of the player.
   */
  if (st.status & (1 << 14)) {
    const m = st.music
    m.replay.voices = 0b1111 & ~st.status2
    m.replay.tick()
    // `mt_NextPosition`: the counter comes down when the song WRAPS, and zero
    // stops it. `e8` is -2 exactly there --- see Protracker.jumpTo.
    if (m.replay.e8 === -2) {
      m.replay.e8 = 0
      m.times = (m.times - 1) & 0xffff
      if (m.times === 0) trackStop(rt)
    }
  }
  /*
   * The volume control, third in the hook: for each of Status bits 1 to 4,
   * `move.w Volume[n],$dff0a8+n*$10`. It is a re-assert, not a set, so a level
   * asked for by `S Volume` beats anything the sample player or the tracker
   * wrote in the same frame -- and it keeps beating it until `S Sam Stop`
   * clears the bit, which is the only thing that does.
   */
  for (let v = 0; v < 4; v++) {
    if (st.status & (1 << (v + 1))) rt.host.audio?.setVolume(v, st.volume[v]! & 63)
  }
  /*
   * The stop timer, fourth and last. `move.b $bfea01/$bfe901/$bfe801,d3` reads
   * CIA-A's time-of-day counter, which ticks at the VERTICAL BLANK, and each
   * armed voice is stopped once the clock reaches its IChan. `blt` is signed
   * on a 24-bit value, so a wrap of the TOD leaves a voice playing until it
   * comes round again -- 93 hours, and not worth reproducing beyond the mask.
   */
  const now = rt.interp.tick & 0xff_ffff
  for (let v = 0; v < 4; v++) {
    if (!(st.status & (1 << (v + 5)))) continue
    if (now < st.voices[v]!.stopAt) continue
    samStop(rt, 1 << v)
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

/* ---- the sample player ------------------------------------------------ *
 *
 * A sample is a 24-byte header with its data straight after it, allocated out
 * of the pool, and the samples of a bank form a doubly-linked list threaded
 * through those headers. The bank itself is eight bytes and holds the head
 * pointer at +4, which is why the list is walked by NUMBER rather than
 * indexed: `=S Sam Base(3)` follows `next` three times.
 *
 *     +0   the PREVIOUS sample, or the BANK for sample 1
 *     +4   the next sample, or 0
 *     +8   length in bytes, not counting the header
 *     +12  replay frequency in Hz
 *     +16  clip start      +20 clip end, 0 meaning no clip
 *     +24  the raw signed 8-bit data
 *
 * The layout is the source's own comment block, and a program can walk it
 * with `Leek(S Sam Base(1)+4)`.
 * ---------------------------------------------------------------------- */

/** the sample header, as offsets, because eight routines index it by hand */
const SAM_PREV = 0
const SAM_NEXT = 4
const SAM_LEN = 8
const SAM_FREQ = 12
const SAM_CLIP0 = 16
const SAM_CLIP1 = 20
export const SAM_HEADER = 24

/** the PAL colour clock, and the period divisor `S Sam Play` uses verbatim */
const PAL_CLOCK = 3546895

const peek32 = (rt: Runtime, a: number): number =>
  ((peek8(rt, a) << 24) | (peek8(rt, a + 1) << 16) | (peek8(rt, a + 2) << 8) | peek8(rt, a + 3)) >>> 0

function poke32(rt: Runtime, a: number, v: number): void {
  poke8(rt, a, v >>> 24)
  poke8(rt, a + 1, v >>> 16)
  poke8(rt, a + 2, v >>> 8)
  poke8(rt, a + 3, v)
}

/**
 * `=S Sam Base(NR)` — routine 50, and the routine every other sample keyword
 * calls to turn a number into an address.
 *
 *     dlea SamBankNr / move.w (a0),d0 / beq -> error 4
 *     Rjsr L_Bnk.GetAdr / beq -> error 4
 *     move.l (a3)+,d1 / subq.l #1,d1
 *  L: move.l 4(a0),a1 / beq -> 0 / move.l a1,a0 / dbra d1,L
 *
 * So sample 1 is the bank's own `next`, and 0 comes back for a number past
 * the end of the chain. NOTE `S Sam Base(0)`: `subq.l #1` makes the counter
 * -1, and `dbra` decrements BEFORE testing, so it walks the whole chain and
 * answers 0 rather than answering the bank.
 */
function samBase(rt: Runtime, nr: number): number {
  const st = rt.sln
  if (st.samBankNr === 0) slnError(4)
  const bank = rt.memBanks.get(st.samBankNr)
  if (!bank) slnError(4)
  let addr = rt.bankBase(st.samBankNr) >>> 0
  let count = (nr - 1) | 0
  for (;;) {
    const next = peek32(rt, addr + SAM_NEXT)
    if (next === 0) return 0
    addr = next
    if (count === 0) return addr
    count = ((count - 1) & 0xffff) === 0xffff ? -1 : count - 1
    if (count < 0) return 0
  }
}

/** `L_GetAdrOfLastSam`, routine 52 — walk to the end, bank included */
function lastSam(rt: Runtime): number {
  const st = rt.sln
  if (st.samBankNr === 0) slnError(4)
  if (!rt.memBanks.get(st.samBankNr)) slnError(4)
  let addr = rt.bankBase(st.samBankNr) >>> 0
  for (;;) {
    const next = peek32(rt, addr + SAM_NEXT)
    if (next === 0) return addr
    addr = next
  }
}

/**
 * `L_SamLoad3` — routine 54, the loader both `S Sam Load` and
 * `S Sam Chip Load` go through, and it does not add the sample to the chain.
 *
 *     Open(name, MODE_OLDFILE)                   0 -> error 3
 *     Seek(fh, 0, OFFSET_END) / Seek(fh, 0, OFFSET_BEGINNING)
 *     d5 = the file length                       (Seek returns the OLD position)
 *     AllocMem(d5 + 24, d7)                      0 -> error 3, not error 1
 *     Read(fh, block + 24, d5)
 *
 * so the FILE lands at +24 and the 24 bytes in front of it are the header.
 *
 * DEFECT: the raw arm. `subi.l #$24,d5` — the recorded length is the FILE
 * length minus twenty-four, where the data is the whole file. The author
 * conflated the size he allocated with the size he read, and the last 24
 * bytes of every raw sample are outside the length, so they never play. It
 * round-trips through `S Sam Bank Save`, which writes `length + 24`, so
 * nothing else notices.
 *
 * The 8SVX arm is stranger. It tests `"FORM"` at +0 and `"8SVX"` at +8 of the
 * FILE, then assumes a fixed 104-byte IFF header: it moves the sample header
 * forward to +104 (so the data starts at file offset 104), FreeMems the 104
 * bytes it just walked past, records `filelen - 128` as the length, and takes
 * the frequency from a WORD at file offset 32 — which is VHDR's
 * samplesPerSec, correct, but only if the VHDR is the first chunk. The 104
 * and the 128 disagree by exactly the header size, so the data also stops 24
 * bytes short of the file. Neither number is read from the IFF, so an 8SVX
 * whose header is not 104 bytes long loads as noise.
 */
function samLoadRaw(rt: Runtime, name: string, chip: boolean): number {
  const bytes = rt.vfs?.read(name)
  if (!bytes) slnError(3)
  const file = bytes!
  const block = rt.sln.heap.alloc(file.length + SAM_HEADER, { chip })
  if (block === 0) slnError(3)
  for (let i = 0; i < file.length; i++) poke8(rt, block + SAM_HEADER + i, file[i]!)
  const magic = (off: number): string => String.fromCharCode(...file.subarray(off, off + 4))
  if (file.length >= 12 && magic(0) === 'FORM' && magic(8) === '8SVX') {
    const head = (block + 104) >>> 0
    poke32(rt, head + SAM_LEN, (file.length - 128) >>> 0)
    // move.w #0,116(a0) / move.w 56(a0),118(a0): the frequency is a WORD, and
    // 56 off the BLOCK is file offset 32, VHDR's samplesPerSec
    poke32(rt, head + SAM_FREQ, ((file[32] ?? 0) << 8) | (file[33] ?? 0))
    poke32(rt, head + SAM_CLIP0, 0)
    poke32(rt, head + SAM_CLIP1, 0)
    rt.sln.heap.shrinkFront(block, 104)
    return head
  }
  poke32(rt, block + SAM_LEN, (file.length - SAM_HEADER) >>> 0)
  poke32(rt, block + SAM_FREQ, 8000) // "Set standard freq."
  poke32(rt, block + SAM_CLIP0, 0)
  poke32(rt, block + SAM_CLIP1, 0)
  return block
}

/** routines 38 and 61 — load, then link on at the END of the chain */
function samLoadAppend(rt: Runtime, name: string, chip: boolean): void {
  const fresh = samLoadRaw(rt, name, chip)
  const last = lastSam(rt)
  poke32(rt, last + SAM_NEXT, fresh)
  poke32(rt, fresh + SAM_PREV, last)
  poke32(rt, fresh + SAM_NEXT, 0)
}

/**
 * Routines 39 and 62 — load, then splice in BEFORE sample NR.
 *
 *     move.l (a0),(a1)    new.prev = nr.prev
 *     move.l a1,(a0)      nr.prev  = new
 *     move.l a0,4(a1)     new.next = nr
 *     move.l (a1),a2 / move.l a1,4(a2)   nr.prev.next = new
 *
 * A number past the end of the chain falls through to the append path, so
 * `S Sam Load "x",99` on a four-sample bank makes it the fifth.
 */
function samLoadInsert(rt: Runtime, name: string, nr: number, chip: boolean): void {
  const fresh = samLoadRaw(rt, name, chip)
  const at = samBase(rt, nr)
  if (at === 0) {
    const last = lastSam(rt)
    poke32(rt, last + SAM_NEXT, fresh)
    poke32(rt, fresh + SAM_PREV, last)
    poke32(rt, fresh + SAM_NEXT, 0)
    return
  }
  const prev = peek32(rt, at + SAM_PREV)
  poke32(rt, fresh + SAM_PREV, prev)
  poke32(rt, at + SAM_PREV, fresh)
  poke32(rt, fresh + SAM_NEXT, at)
  poke32(rt, prev + SAM_NEXT, fresh)
}

/** the eight-byte bank `S Sam Bank Reserve` makes, and its name */
const SAM_BANK_NAME = 'Sln.Sam.'

/** routines 44 and 53 — reserve the bank, zero both longwords, adopt it */
function samBankReserve(rt: Runtime, nr: number): void {
  if (rt.memBanks.get(nr)) slnError(2)
  rt.reserveBank(nr, 8, SAM_BANK_NAME)
  const base = rt.bankBase(nr) >>> 0
  poke32(rt, base, 0)
  poke32(rt, base + 4, 0)
  rt.sln.samBankNr = nr & 0xffff
}

/**
 * The chip copy `S Sam Play` makes when a sample is not already in chip
 * memory, and the four `IChan` stop timers beside it.
 *
 * Status bits 5-8 mean "this voice has a stop time set" and bits 9-12 mean
 * "free the chip copy when it stops". The VBL hook checks the first four
 * against the CIA-A time-of-day counter, which on an Amiga ticks at the
 * vertical blank — which is why `S Sam Play`'s arithmetic multiplies by 50.
 */
export interface SlnVoice {
  /** IChan[n] — the TOD tick to stop at */
  stopAt: number
  /** ISBase[n] / ISLen[n] — the chip block, so the hook can free it */
  base: number
  len: number
}

/** an Int8Array over whatever the address resolves to, for the audio sink */
function pcmAt(rt: Runtime, addr: number, len: number): Int8Array | null {
  const m = rt.resolveAddr(addr >>> 0)
  if (!m || len <= 0) return null
  const n = Math.min(len, m.data.length - m.off)
  if (n <= 0) return null
  return new Int8Array(m.data.buffer, m.data.byteOffset + m.off, n)
}

/**
 * `L_StopSam`'s body, routine 58 — shared with `S Sam Play`, which stops the
 * voices it is about to use before it uses them.
 *
 *     move.w  d1,$dff096          DMACON, bit 15 clear: DMA off
 *     bclr    #5+n,d0 / bclr #1+n,d0 / bclr #n,d3
 *     btst    #9+n,d0 / beq       nothing to free
 *     bsr     StopSamMemCheck / cmpi.l #1,d2 / bne   more than one user
 *     FreeMem(ISLen[n], ISBase[n])
 *
 * so it clears the stop timer, the VOLUME CONTROL bit — which is `S Volume`'s,
 * and a program that stops a voice loses the level it asked for on it — and
 * the Status2 in-use bit, in that order.
 *
 * DEFECT: `StopSamMemCheck` does not count what it says it counts. It is
 * `moveq #3,d6` over the four ISBase entries with `cmp.l (a2),d7 / bne` LEAVING
 * the loop, so it counts a RUN of voices sharing this block from ISBase0
 * onward and stops at the first that differs — not the total. Voices 0 and 2
 * sharing one chip copy with voice 1 on something else each count one user,
 * and the block is freed twice.
 */
function samStop(rt: Runtime, channels: number): void {
  const st = rt.sln
  for (let v = 0; v < 4; v++) {
    if (!(channels & (1 << v))) continue
    rt.host.audio?.stop(v)
    st.status &= ~(1 << (v + 5))
    st.status &= ~(1 << (v + 1))
    st.status2 &= ~(1 << v)
    if (!(st.status & (1 << (v + 9)))) continue
    if (samMemUsers(st, v) === 1) st.heap.freeMem(st.voices[v]!.base)
    st.voices[v] = { stopAt: st.voices[v]!.stopAt, base: 0, len: 0 }
    st.status &= ~(1 << (v + 9))
  }
}

/** `SamMemCheck` / `StopSamMemCheck` — the run, not the count; see `samStop` */
function samMemUsers(st: SlnState, voice: number): number {
  const want = st.voices[voice]!.base
  let n = 0
  for (let v = 0; v < 4; v++) {
    if (st.voices[v]!.base !== want) break
    n++
  }
  return n
}

/* ---- trackdisk.device -------------------------------------------------- *
 *
 * The v2.0 half of the extension, and the reason it exists: seventeen
 * keywords that reach the floppy past AmigaDOS entirely, so a program can
 * read and write raw sectors, spin the motor and rename a disk by editing its
 * root block. `S Checksum` is here for that last one.
 *
 * The IORequest is `TrackIO`, eighty bytes in the data zone, and the routines
 * index it by hand: command at 28, io_Error at 31, io_Actual at 32, io_Length
 * at 36, io_Data at 40, io_Offset at 44. Commands used: 2 CMD_READ, 3
 * CMD_WRITE, 4 CMD_UPDATE, 9 TD_MOTOR, 11 TD_FORMAT, 13 TD_CHANGENUM, 14
 * TD_CHANGESTATE, 15 TD_PROTSTATUS, 19 TD_GETNUMTRACKS.
 *
 * ## What a drive is here
 *
 * A unit is DF0: to DF3:, and it has a disk in it when an ADF is mounted
 * there — an ADF is exactly the sector image `CMD_READ` wants, so a mounted
 * one is served byte for byte and a write goes back into it. A unit with no
 * image mounted is an EMPTY DRIVE, which is a real state and the honest one:
 * `S Disk State` says no disk, and a read raises TDERR_DiskChanged, exactly
 * as a bare drive does. `S Disk Open` itself succeeds either way, because on
 * the machine opening a unit that exists succeeds whether or not it holds a
 * disk; only unit 4 and above fail.
 * ---------------------------------------------------------------------- */

/** the block SLN's `S Disk Rename` edits: 880 * 512 on a DD floppy */
const ROOT_BLOCK_OFFSET = 450560
/** a sector, and the granularity every read and write is checked against */
const SECTOR = 512
/** `io_Error` values, as trackdisk numbers them; see `slnTrackError` */
const TDERR_NotSpecified = 20
const TDERR_DiskChanged = 29

/**
 * `L_TrackErrorCheck`, routine 105 — turn a non-zero `io_Error` into one of
 * this extension's messages.
 *
 *     cmpi.b  #0,31(a1) / bne
 *     move.b  31(a1),d0 / subi.l #11,d0
 *     ...MotorOff, then L_custom_error
 *
 * DEFECT: the arithmetic is off by one against the author's own table. His
 * comment is *"Trackerrors start with 20, mine at 9"*, and 20 - 11 is 9 —
 * except that message 9 is "Unknown trackdisk error" and message 10 is
 * "No sector header present", which is what TDERR 20 actually means. So every
 * trackdisk error is reported as the message BELOW the right one, and
 * TDERR_NotSpecified (20) comes out as the catch-all rather than as its own
 * text. Reproduced, not corrected.
 *
 * It also turns the motor off on the way out, which the caller was going to
 * do anyway on the synchronous path and was NOT going to do on the
 * `S Disk Send Read` path.
 */
function slnTrackError(rt: Runtime, ioError: number): never {
  slnMotor(rt, false)
  return slnError(ioError - 11)
}

/** the DRIVE this channel opened, or null for a unit that does not exist */
function slnDrive(rt: Runtime): FloppyDrive | null {
  return rt.machine.drives[rt.sln.disk.unit] ?? null
}

/**
 * TD_MOTOR: `move.w #9,28(a1) / move.l #1,36(a1) / DoIO`.
 *
 * The motor is the DRIVE's, so this sets it there. `sln.disk.motor` is a view
 * of that: the extension asked and the drive is what holds the answer, which
 * matters now that CIA-A's /RDY line reads it.
 */
function slnMotor(rt: Runtime, on: boolean): void {
  const d = slnDrive(rt)
  if (d) d.motorOn = on
  rt.sln.disk.motor = on
}

/**
 * `CMD_UPDATE` — flush the track buffer. There is no track buffer here, so
 * what it does instead is what the flush makes true: the filesystem's cached
 * directory walks are now stale, because the sectors under them were written
 * past it, and `AdfVolume.invalidate` is what says so.
 */
function diskUpdate(rt: Runtime): void {
  slnDrive(rt)?.medium?.invalidate?.()
}

/** the sector image of the unit's disk, or null for an empty drive */
function diskImage(rt: Runtime): Uint8Array | null {
  if (!rt.sln.disk.open) return null
  return slnDrive(rt)?.medium?.image ?? null
}

/** `L_TrackCheck`, routine 36 — `btst #13,Status`, and error 8 if it is clear */
function trackCheck(rt: Runtime): void {
  if (!rt.sln.disk.open) slnError(8)
}

/**
 * `L_TrackRead3` / `L_TrackWrite3`, routines 70 and 73 — set the request up
 * and range-check it.
 *
 *     divu.w  #512,d0 / divu.w #512,d1 / swap / swap
 *     cmpi.w  #0,d0 / rbne L_error0        length not a whole sector
 *     cmpi.w  #0,d1 / rbne L_error0        offset likewise
 *
 * `divu.w` is 32/16, so the check is on the REMAINDER in the high word — and
 * a length of 32768 sectors or more overflows the quotient, which on the
 * 68000 leaves the destination untouched and the "remainder" is then the
 * original value's high word. Nothing in reach of a floppy gets near it.
 *
 * The write path has one more step: if length and offset are ALSO whole
 * multiples of 5632 — eleven sectors, one track — the command is promoted
 * from CMD_WRITE to TD_FORMAT, *"(faster)"*. The difference is real on the
 * machine and invisible here: a format lays down a whole track without
 * reading it first, so it works on a track that is not formatted yet and
 * skips the read-modify-write, but the bytes that end up on the disk are the
 * same bytes. Nothing this port can observe distinguishes them.
 */
function checkAligned(length: number, offset: number): void {
  if (length % SECTOR !== 0) slnError(0)
  if (offset % SECTOR !== 0) slnError(0)
}

export interface SlnDisk {
  /** Status bit 13 — `trackdisk.device` is open */
  open: boolean
  /** the unit `S Disk Open` named */
  unit: number
  /** TD_MOTOR's last argument; nothing here spins, but the state is real */
  motor: boolean
  /**
   * The request left over from `S Disk Send Read` / `S Disk Send Write`, which
   * SendIO rather than DoIO and come back before the transfer has happened.
   * `S Disk Wait` completes it and `S Disk Abort` throws it away.
   */
  pending: { write: boolean; length: number; buffer: number; offset: number } | null
}

/* ---- the tracker player ------------------------------------------------ *
 *
 * `L_TrackerPlayer`, routine 85, is 1,370 lines of the source and is stock
 * PT2.3A with five things bolted on. It is not reimplemented here:
 * `../amiga/protracker.ts` is already a four-voice ProTracker replay checked
 * byte-exactly against the corpus, and it serves AMCAF, P61, MED and
 * GameSupport as well. What IS read off this one is what it ADDS, because
 * that is where it differs:
 *
 *   - `mt_speed` is seeded from `TrackTempo` rather than from 6, so
 *     `S Track Tempo=` changes the speed of the NEXT song as well as this one
 *   - `mt_VolFaktor`, a percentage applied at the instrument trigger only
 *   - the channel mask: `Status2` names the voices the SAMPLE player holds,
 *     and every voice loop writes to a ten-byte `dummy` instead of the
 *     hardware for those, so a sound effect takes a voice off the music
 *   - `times_to_play`, decremented when the song wraps, stopping at zero
 *   - a start position, checked against the song length
 *
 * ONE THING IT DOES NOT ADD, and it matters: there is no CIA tempo. `Fxx`
 * goes to `mt_SetSpeed` for every value, so `F80` is a speed of 128 rather
 * than 128 BPM. Every other replayer in this port carries a DEVIATION note
 * about ticking once a vertical blank where the machine runs a CIA timer;
 * this one does not need it, because SLN's player ticks once a vertical blank
 * too. `ciaTempo = false` is what says so.
 * ---------------------------------------------------------------------- */

/** the bank `S Track Load` makes, and what `S Track Play` checks for */
const TRACK_BANK_NAME = 'Tracker '
/** `950(a0)` — songlength, in a 31-instrument MOD */
const MOD_SONGLENGTH = 950

export interface SlnMusic {
  /** the engine, shared with every other module player here */
  replay: Protracker
  /** `times_to_play`; 0 is "obvios (0=infinite)", the source's own comment */
  times: number
}

/**
 * `S Track Play`'s and `=S Track Length`'s shared argument: a bank number at
 * or below 65536, or an address.
 *
 *     cmpa.l  #65536,a0 / ble .GetAdr
 *     ...Bnk.GetAdr / Rbeq L_error0
 *     cmpi.l  #"Trac",-$8(a0) / rbne L_error0
 *     cmpi.l  #"ker ",-$4(a0) / rbne L_error0
 *
 * The eight bytes in front of a bank's data are its NAME, so the check is
 * that this is a bank `S Track Load` made. An ADDRESS skips the check
 * entirely, which is how a program plays a module it loaded some other way.
 *
 * `=S Track Length` uses `blo` where this uses `ble`, so 65536 exactly is a
 * bank here and an address there.
 */
function trackBank(rt: Runtime, arg: number, checkName: boolean, inclusive: boolean): Uint8Array | null {
  const isBank = inclusive ? arg <= 0x10000 : arg < 0x10000
  if (!isBank) {
    const m = rt.resolveAddr(arg >>> 0)
    return m ? m.data.subarray(m.off) : null
  }
  const bank = rt.memBanks.get(arg)
  if (!bank) slnError(0)
  if (checkName && bank!.name.padEnd(8, ' ') !== TRACK_BANK_NAME) slnError(0)
  return bank!.data
}

/**
 * `mt_end`, reached by `S Track Stop` and by the play counter running out.
 *
 *     dlea Status2,a0 / move.w (a0),d0
 *     btst #n,d0 / bne (skip)      the SAMPLE player holds this voice
 *     clr.w $dff0a8+n*$10 / bset #n,d1
 *     move.w d1,$dff096            DMA off for the ones it silenced
 *
 * so it silences only the voices `Status2` does not claim, and a sample
 * playing under the music keeps playing. `Protracker.voices` is the same
 * mask from the other side, which is why it is set here rather than in the
 * keyword: the two have to agree on the same frame.
 */
function trackStop(rt: Runtime): void {
  const st = rt.sln
  if (!(st.status & (1 << 14))) return
  st.status &= ~(1 << 14)
  st.music.replay.voices = 0b1111 & ~st.status2
  st.music.replay.stop()
}

export function makeSlnInstructions(rt: Runtime): Record<string, Instr> {
  /** CMD_READ / CMD_WRITE / TD_FORMAT against the mounted image */
  const transfer = (write: boolean, length: number, buffer: number, offset: number): void => {
    const image = diskImage(rt)
    rt.sln.disk.motor = true
    if (!image) slnTrackError(rt, TDERR_DiskChanged)
    if (offset + length > image!.length) slnTrackError(rt, TDERR_NotSpecified)
    if (write) {
      for (let i = 0; i < length; i++) image![offset + i] = peek8(rt, buffer + i)
    } else {
      for (let i = 0; i < length; i++) poke8(rt, buffer + i, image![offset + i]!)
    }
  }

  /** the three arguments every read and write takes, popped right to left */
  const request = (it: Parameters<Instr>[0]): { length: number; buffer: number; offset: number } => {
    const offset = it.evalInt()
    it.expect(',')
    const buffer = it.evalInt() >>> 0
    it.expect(',')
    const length = it.evalInt()
    checkAligned(length, offset)
    return { length, buffer, offset }
  }

  return {
    // ---- the tracker ----------------------------------------------------
    /**
     * Routines 88 and 89 — `S Track Load FILE$ [,BANK]`, defaulting to bank 7.
     *
     * `Bnk.Reserve` with `Bnk_BitData | Bnk_BitChip` under the name
     * "Tracker ", the file read straight into it, and a short read is error 0
     * rather than error 3. A filename of 128 characters or more is error 0 as
     * well, checked with `cmp.w #128,d0 / Rbcc` AFTER the `subq.w #1`, so the
     * real limit is 129. A bank number of 65536 or more is error 0; a failed
     * reserve is error 1.
     *
     * The bank name is the whole of the type system: `S Track Play` checks the
     * eight bytes in front of the data and refuses anything else.
     */
    's track load'(it): void {
      const name = it.evalStr()
      const nr = it.accept(',') ? it.evalInt() : 7
      if (nr >= 0x10000) slnError(0)
      if (name.length >= 129) slnError(0)
      const bytes = rt.vfs?.read(name)
      if (!bytes) slnError(3)
      rt.eraseBank(nr)
      rt.reserveBank(nr, bytes!.length, TRACK_BANK_NAME, true, true)
      rt.memBanks.get(nr)!.data.set(bytes!)
    },
    /**
     * Routines 96, 86 and 87 — `S Track Play BANK [,TIMES [,START]]`, each
     * pushing a default and falling into the next, so the bare form is
     * `bank, 0, 0`: from the top, for ever.
     *
     * It stops a player that is already running first (`btst #14,Status`),
     * then checks the start position against `950(a0)`, the song length, with
     * `cmp.b 950(a0),d7 / rbhi` — an UNSIGNED byte compare, so a start equal
     * to the length is allowed and one past it is error 25.
     */
    's track play'(it): void {
      const st = rt.sln
      const arg = it.evalInt()
      const times = it.accept(',') ? it.evalInt() : 0
      const start = it.accept(',') ? it.evalInt() : 0
      if (st.status & (1 << 14)) trackStop(rt)
      const data = trackBank(rt, arg, true, true)
      if (!data) slnError(0)
      if ((start & 0xff) > (data![MOD_SONGLENGTH] ?? 0)) slnError(25)
      const song = parseMod(data!)
      if (!song) slnError(0)
      const m = st.music
      m.times = times & 0xffff
      m.replay.load(song!, start & 0xff)
      // mt_init: `lea mt_speed(pc),a1 / dlea TrackTempo,a2 / move.b (a2),(a1)`
      // --- the speed comes from the extension's setting, not from 6
      m.replay.speed = st.trackTempo
      m.replay.trigVolPercent = 100 // `move.b #100,(a0)`, every init
      m.replay.ciaTempo = false
      m.replay.e8 = 0
      m.replay.playing = true
      st.status |= 1 << 14
    },
    /**
     * Routine 90 — `S Track Stop`. `btst #14,Status` first, so it is safe to
     * call when nothing is playing, and it goes through `mt_end`, which
     * silences only the voices `Status2` does NOT claim: a sample playing
     * under the music keeps playing.
     */
    's track stop'(): void {
      trackStop(rt)
    },
    /**
     * Routine 91 — `S Track Volume PERCENT`.
     *
     * NOTE the name. `Sln_ext_Historie` lists this as *"S Track Volume="* and
     * the token table spells it without the equals, so the Historie is stale;
     * the table is what a program has to type.
     *
     * The value is a PERCENTAGE and it is applied at the instrument trigger
     * only — `Cxx` and the volume slides write the channel volume straight to
     * AUDxVOL with no factor at all, so a channel that slides escapes the
     * setting until its next instrument. There is no range check: the factor
     * is a byte, and anything above 100 makes the module louder up to the
     * `cmpi.w #64` clamp in the player.
     */
    's track volume'(it): void {
      rt.sln.music.replay.trigVolPercent = it.evalInt() & 0xff
    },
    /**
     * Routine 93 — `S Track Tempo= TEMPO`, and it writes TWO things: the
     * extension's own `TrackTempo` byte, which seeds `mt_speed` at the next
     * `S Track Play`, and `mt_speed` itself through `mt_SetTempo`, which also
     * clears the tick counter so the change lands on the next row rather than
     * mid-row. A tempo of 0 stores 0, and the player's `blo` against a speed
     * of zero then never matches — the module freezes on its current row.
     */
    's track tempo='(it): void {
      const v = it.evalInt() & 0xff
      rt.sln.trackTempo = v
      rt.sln.music.replay.counter = 0
      rt.sln.music.replay.speed = v
    },

    // ---- trackdisk ------------------------------------------------------
    /**
     * Routine 64 — `S Disk Open DRIVE`. It closes any request it already has,
     * builds a MsgPort out of `FindTask(NULL)` and `AddPort`, and opens
     * `trackdisk.device` on the unit with no flags. A non-zero return is
     * error 7; success sets Status bit 13.
     *
     * NOTE it never sets `TDF_ALLOW_NON_3_5`, so this is a floppy unit and
     * nothing else. Units 0 to 3 exist on the machine whether or not they hold
     * a disk; 4 and above do not.
     */
    's disk open'(it): void {
      const unit = it.evalInt()
      const st = rt.sln
      st.disk = { open: false, unit: 0, motor: false, pending: null }
      if (unit < 0 || unit > 3) slnError(7)
      st.disk = { open: true, unit, motor: false, pending: null }
      st.status |= 1 << 13
    },
    /**
     * Routine 65 — `S Disk Close`. `btst #13,Status` first, so calling it
     * twice is harmless, then RemPort, CloseDevice and the bit. It is called
     * by the extension's own DEFAULT and END routines, so `Run` and quitting
     * both close the drive.
     */
    's disk close'(): void {
      const st = rt.sln
      if (!st.disk.open) return
      st.disk = { open: false, unit: st.disk.unit, motor: false, pending: null }
      st.status &= ~(1 << 13)
    },
    /** routine 66 — TD_MOTOR with io_Length 1 */
    's motor on'(): void {
      trackCheck(rt)
      slnMotor(rt, true)
    },
    /** routine 67 — TD_MOTOR with io_Length 0 */
    's motor off'(): void {
      trackCheck(rt)
      slnMotor(rt, false)
    },
    /**
     * Routine 68 — `S Disk Read OFFSET, BUFFER, LENGTH`: DoIO, check the
     * error, then turn the motor off. The synchronous form, and the one that
     * leaves the drive tidy.
     */
    's disk read'(it): void {
      const r = request(it)
      trackCheck(rt)
      transfer(false, r.length, r.buffer, r.offset)
      slnMotor(rt, false)
    },
    /**
     * Routine 69 — `S Disk Send Read`: SendIO instead, so the routine returns
     * before the transfer has happened and the motor stays on. On the machine
     * the buffer is not yet valid; `S Disk Wait` is what makes it so. Here the
     * transfer is recorded and performed by `S Disk Wait`, which is the only
     * way to make "not yet" observable at all.
     */
    's disk send read'(it): void {
      const r = request(it)
      trackCheck(rt)
      rt.sln.disk.pending = { write: false, ...r }
      slnMotor(rt, true)
    },
    /**
     * Routine 71 — `S Disk Write OFFSET, BUFFER, LENGTH`: DoIO, check, then
     * CMD_UPDATE to flush trackdisk's own track buffer, then motor off. The
     * update is what makes the write reach the disk rather than the cache.
     */
    's disk write'(it): void {
      const r = request(it)
      trackCheck(rt)
      transfer(true, r.length, r.buffer, r.offset)
      diskUpdate(rt)
      slnMotor(rt, false)
    },
    /**
     * Routine 72 — `S Disk Send Write`, and the source's own closing comment
     * is the whole difference: *"Note: buffer not updated, and motor is still
     * on."* No CMD_UPDATE either, so the write can still be sitting in
     * trackdisk's track buffer when the routine returns.
     */
    's disk send write'(it): void {
      const r = request(it)
      trackCheck(rt)
      rt.sln.disk.pending = { write: true, ...r }
      slnMotor(rt, true)
    },
    /** routine 79 — exec AbortIO (-480) on the outstanding request */
    's disk abort'(): void {
      trackCheck(rt)
      rt.sln.disk.pending = null
    },
    /** routine 80 — exec WaitIO (-474): the SendIO pair's other half */
    's disk wait'(): void {
      trackCheck(rt)
      const p = rt.sln.disk.pending
      rt.sln.disk.pending = null
      if (p) transfer(p.write, p.length, p.buffer, p.offset)
    },
    /** routines 82 and 81 — CMD_UPDATE, flushing trackdisk's track buffer */
    's disk update'(): void {
      trackCheck(rt)
      diskUpdate(rt)
    },
    /**
     * Routine 84 — `S Disk Rename NAME$`, which edits the disk's root block
     * in place rather than going through AmigaDOS `Relabel`.
     *
     *     AllocMem(512, MEMF_CHIP)            0 -> error 1
     *     S Disk Read 450560, buffer, 512
     *     ...name length clamped to 30, written as a length byte at +432
     *     S Checksum -> 20(buffer)
     *     S Disk Write 450560, buffer, 512
     *
     * 450560 is block 880, the root block of a double-density floppy, and 432
     * is `bcpl_name` in it. It pushes the arguments onto AMOS's own stack and
     * calls its own `S Disk Read` and `S Disk Write` keywords to do the work,
     * so all of their checks apply — including turning the motor off twice.
     *
     * DEFECT: the copy loop is `move.b d0,(a0)+` for the length byte and then
     * `dbra d0` over the characters, so it writes LENGTH + 1 of them — one
     * byte past the name, into the first byte of the 30-byte field's padding.
     * Harmless for a name of 30 or less, which the clamp guarantees, but the
     * byte written is whatever followed the AMOS string.
     */
    's disk rename'(it): void {
      const name = it.evalStr()
      trackCheck(rt)
      const buffer = rt.sln.heap.alloc(SECTOR, { chip: true })
      if (buffer === 0) slnError(1)
      try {
        transfer(false, SECTOR, buffer, ROOT_BLOCK_OFFSET)
        slnMotor(rt, false)
        const chars = name.slice(0, 30)
        poke8(rt, buffer + 432, chars.length)
        for (let i = 0; i < chars.length; i++) poke8(rt, buffer + 433 + i, chars.charCodeAt(i))
        let sum = 0
        for (let i = 0; i < 128; i++) sum = (sum - peek32(rt, buffer + i * 4)) | 0
        poke32(rt, buffer + 20, ((sum + peek32(rt, buffer + 20)) | 0) >>> 0)
        transfer(true, SECTOR, buffer, ROOT_BLOCK_OFFSET)
        diskUpdate(rt)
        slnMotor(rt, false)
      } finally {
        rt.sln.heap.freeMem(buffer)
      }
    },

    // ---- samples --------------------------------------------------------
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

    // ---- samples --------------------------------------------------------
    /**
     * Routine 37 — `S Volume CHANNELS, VOLUME`, and it is not a one-shot: it
     * arms Status bits 1 to 4, and the VBL hook writes `Volume[n]` into AUDxVOL
     * every frame for as long as they are set. So a level asked for here
     * OVERRIDES whatever the replayer or a playing sample wants, once a frame,
     * until something clears the bit.
     *
     *     and.w #%1111111111100001,d2     "Clear any former vol. control"
     *
     * is the first thing it does, so each call replaces the whole set rather
     * than adding to it: `S Volume 1,32` after `S Volume 2,10` leaves voice 1
     * uncontrolled. The range check is `cmpi #64,d0 / rbcc`, unsigned, so 64
     * and above raise and a negative volume raises with them.
     */
    's volume'(it): void {
      const st = rt.sln
      const channels = it.evalInt()
      it.expect(',')
      const vol = it.evalInt()
      if ((vol >>> 0) >= 64) slnError(0)
      st.status &= 0b1111_1111_1110_0001
      for (let v = 0; v < 4; v++) {
        if (!(channels & (1 << v))) continue
        st.status |= 1 << (v + 1)
        st.volume[v] = vol & 0xffff
      }
    },
    /** routines 43 — `S Sam Bank= NR`, a WORD store and no validation at all */
    's sam bank='(it): void {
      rt.sln.samBankNr = it.evalInt() & 0xffff
    },
    /**
     * Routines 53 and 44 — `S Sam Bank Reserve [NR]`, defaulting to bank 6.
     * `Bnk.Reserve` for eight bytes under the name "Sln.Sam.", both longwords
     * cleared, and SamBankNr adopted. A bank number already in use is error 2.
     */
    's sam bank reserve'(it): void {
      samBankReserve(rt, it.atStmtEnd() ? 6 : it.evalInt())
    },
    /** routines 38/39 (public memory) and 61/62 (chip) — see `samLoadRaw` */
    's sam load'(it): void {
      const name = it.evalStr()
      if (it.accept(',')) samLoadInsert(rt, name, it.evalInt(), false)
      else samLoadAppend(rt, name, false)
    },
    /**
     * Routines 61 and 62 — the same loader with `move.l #$2,d7`, MEMF_CHIP.
     * It matters to `S Sam Play`, which checks `TypeOfMem` and skips making a
     * chip copy when the sample is already there.
     */
    's sam chip load'(it): void {
      const name = it.evalStr()
      if (it.accept(',')) samLoadInsert(rt, name, it.evalInt(), true)
      else samLoadAppend(rt, name, true)
    },
    /** routine 41 — `S Set Freq NR, FREQ`, a plain longword into the header */
    's set freq'(it): void {
      const nr = it.evalInt()
      it.expect(',')
      const freq = it.evalInt()
      const addr = samBase(rt, nr)
      if (addr === 0) slnError(0)
      poke32(rt, addr + SAM_FREQ, freq >>> 0)
    },
    /**
     * Routine 51 — `S Sam Clip NR, START, END`.
     *
     * An END of ZERO deletes the clip, which is why the header's "no clip" is
     * a zero end rather than a zero length. An END past the sample is clamped
     * to the length; an END below the START raises. START is not checked
     * against anything, so a start past the end of the sample is accepted and
     * `S Sam Play` then computes a negative clip length and falls back to
     * playing the whole sample.
     */
    's sam clip'(it): void {
      const nr = it.evalInt()
      it.expect(',')
      const start = it.evalInt()
      it.expect(',')
      let end = it.evalInt()
      const addr = samBase(rt, nr)
      if (addr === 0) slnError(0)
      if (end === 0) {
        poke32(rt, addr + SAM_CLIP0, 0)
        poke32(rt, addr + SAM_CLIP1, 0)
        return
      }
      const len = peek32(rt, addr + SAM_LEN)
      if (end > len) end = len
      if (end < start) slnError(0)
      poke32(rt, addr + SAM_CLIP0, start >>> 0)
      poke32(rt, addr + SAM_CLIP1, end >>> 0)
    },
    /**
     * Routine 40 — `S Sam Play NR, TIMES, CHANNELS, VOLUME`, and the whole of
     * the player is in it.
     *
     * It stops the named channels first (`Rbsr L_StopSam` with the mask pushed
     * back onto AMOS's own argument stack), then finds the sample, then makes
     * sure the bytes it is about to hand Paula are in chip memory:
     * `TypeOfMem` is -534, and `cmpi.l #$703,d0` is MEMF_PUBLIC|MEMF_CHIP|
     * MEMF_LOCAL|MEMF_24BITDMA. Anything else gets an `AllocMem(len, MEMF_CHIP)`
     * and a copy, and Status bits 9-12 remember to free it again.
     *
     * TIMES is not a loop counter. The routine starts the DMA and works out
     * WHEN to stop it:
     *
     *     mulu d0,d2          times * length
     *     divu d3,d2          / frequency          -> seconds, remainder high
     *     ...quotient * 50, remainder * 50 / freq, added back
     *     move.b $bfea01/$bfe901/$bfe801, d3       CIA-A time of day
     *     add.l d3,d2 -> IChan[n]
     *
     * and CIA-A's TOD counts VERTICAL BLANKS, which is where the 50 comes from
     * and why the answer is in frames. Amiga audio DMA repeats from AUDxLC
     * forever, so what a program hears is the sample looping until the hook
     * reaches that tick. TIMES = 0 leaves Status bits 5-8 clear and nothing
     * ever stops it — "0 = infinite", which is the same mechanism, not a
     * special case.
     *
     * The period is `3546895 / freq` truncated, so the frequency actually
     * played is the period's rather than the one asked for.
     *
     * DEVIATION: `mulu` is 16x16, so `times * length` truncates both operands
     * to their low words. A sample of more than 65535 bytes therefore gets a
     * stop time computed from `length mod 65536` and cuts off early. That is
     * the routine's, and it is reproduced; what is NOT the routine's is that
     * the clock here is the frame counter rather than a real TOD, which comes
     * to the same thing at 50Hz and drifts on a 60Hz machine, where the real
     * TOD would too.
     */
    's sam play'(it): void {
      const st = rt.sln
      const nr = it.evalInt()
      it.expect(',')
      const times = it.evalInt()
      it.expect(',')
      const channels = it.evalInt() & ~0x8000_0000
      it.expect(',')
      const vol = it.evalInt() & ~0x8000_0000
      if ((vol >>> 0) > 63) slnError(0)
      if ((channels >>> 0) > 0b1111) slnError(0)
      samStop(rt, channels)
      const addr = samBase(rt, nr)
      if (addr === 0) slnError(0)

      const clipEnd = peek32(rt, addr + SAM_CLIP1)
      const clipStart = peek32(rt, addr + SAM_CLIP0)
      const length = peek32(rt, addr + SAM_LEN)
      let dataAt = (addr + SAM_HEADER) >>> 0
      let clipLen = 0
      let owned = 0
      if (st.heap.chip(addr)) {
        if (clipEnd !== 0) {
          const n = (clipEnd - clipStart) | 0
          if (n >= 0) {
            dataAt = (addr + SAM_HEADER + clipStart) >>> 0
            clipLen = n
          }
        }
      } else {
        const n = clipEnd !== 0 ? (clipEnd - clipStart) | 0 : 0
        const want = n > 0 ? n : length
        const copy = st.heap.alloc(want, { chip: true })
        if (copy === 0) slnError(5)
        const from = (addr + SAM_HEADER + (n > 0 ? clipStart : 0)) >>> 0
        for (let i = 0; i < want; i++) poke8(rt, copy + i, peek8(rt, from + i))
        dataAt = copy
        clipLen = n > 0 ? n : 0
        owned = copy
      }

      const playLen = clipLen !== 0 ? clipLen : length
      const freq = peek32(rt, addr + SAM_FREQ)
      // the frame count, exactly as the routine computes it
      let ticks = 0
      if (freq !== 0) {
        const total = mulu16(times, playLen)
        const q = Math.floor(total / freq) & 0xffff
        const r = total % freq
        ticks = (q * 50 + (Math.floor((r * 50) / freq) & 0xffff)) | 0
      }
      const period = freq === 0 ? 0 : Math.floor(PAL_CLOCK / freq) & 0xffff
      const now = rt.interp.tick & 0xff_ffff
      const audio = rt.host.audio
      const pcm = pcmAt(rt, dataAt, playLen)
      for (let v = 0; v < 4; v++) {
        if (!(channels & (1 << v))) continue
        if (times !== 0) {
          st.status |= 1 << (v + 5)
          if (owned !== 0) st.status |= 1 << (v + 9)
        }
        st.voices[v] = { stopAt: (now + ticks) >>> 0, base: owned, len: playLen }
        st.status2 |= 1 << v
        if (pcm && period !== 0) audio?.play(v, pcm, PAL_CLOCK / period, vol, 0, playLen)
      }
    },
    /**
     * Routine 58 — `S Sam Stop CHANNELS`. `move.w d1,$dff096` with bit 15
     * clear turns the DMA off, then the status bits go and, if this voice was
     * the last user of a chip copy, the copy is freed.
     *
     * `SamMemCheck` is what decides that: it compares this voice's ISBase with
     * all four and counts the matches, freeing only on exactly one. NOTE the
     * loop is `moveq #3,d6 / dbra` with a `bne` that leaves it early, so it
     * stops counting at the first voice whose base DIFFERS — it counts a run,
     * not a total. Two voices sharing a copy with a third voice between them
     * therefore both think they are alone, and the block is freed twice.
     */
    's sam stop'(it): void {
      const channels = it.evalInt() & ~0x8000_0000
      if ((channels >>> 0) > 0b1111) slnError(0)
      samStop(rt, channels)
    },
    /**
     * Routine 42 — `S Sam Del NR`, unlinking one sample and freeing it.
     *
     * It looks the sample up three times — NR, NR-1 and NR+1 — rather than
     * following the links it already has, and re-pushes the argument onto
     * AMOS's stack each time (`move.l (a3),-(sp)`, with the source's own
     * comment *"Not a mistake!"*, because `S Sam Base` is what consumes it).
     * Deleting sample 1 has its own arm: the previous "sample" is the bank.
     */
    's sam del'(it): void {
      const nr = it.evalInt()
      const victim = samBase(rt, nr)
      if (victim === 0) slnError(0)
      const prev = nr - 1 <= 0 ? rt.bankBase(rt.sln.samBankNr) >>> 0 : samBase(rt, nr - 1)
      const next = samBase(rt, nr + 1)
      poke32(rt, prev + SAM_NEXT, next)
      if (next !== 0) poke32(rt, next + SAM_PREV, prev)
      rt.sln.heap.freeMem(victim)
    },
    /**
     * Routines 45 and 59 — `S Sam Bank Erase [NR]`. It deletes sample 1 over
     * and over until `S Sam Base(1)` answers zero, then `Bnk.Eff` on the bank
     * number. NOTE it erases whichever bank the ARGUMENT names while deleting
     * out of whichever bank SamBankNr names, and nothing makes those the same:
     * `S Sam Bank Erase 7` with the sample bank set to 6 empties bank 6 and
     * erases bank 7.
     */
    's sam bank erase'(it): void {
      const nr = it.atStmtEnd() ? rt.sln.samBankNr : it.evalInt()
      for (let guard = 0; guard < 4096; guard++) {
        const first = samBase(rt, 1)
        if (first === 0) break
        const next = peek32(rt, first + SAM_NEXT)
        poke32(rt, (rt.bankBase(rt.sln.samBankNr) >>> 0) + SAM_NEXT, next)
        if (next !== 0) poke32(rt, next + SAM_PREV, rt.bankBase(rt.sln.samBankNr) >>> 0)
        rt.sln.heap.freeMem(first)
      }
      rt.eraseBank(nr)
    },
    /**
     * Routines 46 and 47 — `S Sam Bank Load NAME$ [,NR]`, defaulting to bank 6.
     *
     * The file is "Sln.Sam." and then, per sample, the twelve bytes of the
     * header up to and including the length, followed by `length + 12` more —
     * which covers the frequency, the two clip fields and the data. So the
     * on-disk record is the whole 24-byte header plus the data, split across
     * two reads because the loader needs the length before it can allocate.
     * The two link pointers are written to the file and thrown away on the way
     * back in, which is what makes the file portable between sessions.
     *
     * A short read of the twelve-byte record ends the file cleanly (*"assuming
     * that no more samples were saved"*); anything else is error 3.
     */
    's sam bank load'(it): void {
      const name = it.evalStr()
      const nr = it.accept(',') ? it.evalInt() : 6
      const bytes = rt.vfs?.read(name)
      if (!bytes) slnError(3)
      const file = bytes!
      const magic = String.fromCharCode(...file.subarray(0, 8))
      if (magic !== SAM_BANK_NAME) slnError(3)
      samBankReserve(rt, nr)
      let at = 8
      let prev = rt.bankBase(nr) >>> 0
      while (at + 12 <= file.length) {
        const len =
          ((file[at + 8]! << 24) | (file[at + 9]! << 16) | (file[at + 10]! << 8) | file[at + 11]!) >>> 0
        const block = rt.sln.heap.alloc(len + SAM_HEADER)
        if (block === 0) slnError(1)
        for (let i = 0; i < 12; i++) poke8(rt, block + i, file[at + i]!)
        for (let i = 0; i < len + 12; i++) poke8(rt, block + 12 + i, file[at + 12 + i] ?? 0)
        poke32(rt, prev + SAM_NEXT, block)
        poke32(rt, block + SAM_PREV, prev)
        poke32(rt, block + SAM_NEXT, 0)
        prev = block
        at += 12 + len + 12
      }
    },
    /**
     * Routines 48 and 49 — `S Sam Bank Save NAME$ [,NR]`. The two-argument
     * form swaps SamBankNr for the duration and puts it back on every exit,
     * failure included; the one-argument form pushes SamBankNr and falls into
     * it, so it is the same code saving the current bank.
     *
     * Each sample is written as `header + length + 24` bytes straight out of
     * memory, link pointers and all — see `S Sam Bank Load` for what happens
     * to them on the way back.
     */
    's sam bank save'(it): void {
      const st = rt.sln
      const name = it.evalStr()
      const nr = it.accept(',') ? it.evalInt() : st.samBankNr
      const was = st.samBankNr
      st.samBankNr = nr & 0xffff
      try {
        const out: number[] = [...SAM_BANK_NAME].map((c) => c.charCodeAt(0))
        for (let n = 1; ; n++) {
          const addr = samBase(rt, n)
          if (addr === 0) break
          const total = peek32(rt, addr + SAM_LEN) + SAM_HEADER
          for (let i = 0; i < total; i++) out.push(peek8(rt, addr + i))
        }
        if (!rt.vfs?.writeFile(name, Uint8Array.from(out))) slnError(3)
      } finally {
        st.samBankNr = was
      }
    },

    // ---- files and the iconify window -----------------------------------
    /**
     * Routine 95 — `S Delete filename$`, which deletes a file or, in code that
     * is almost never reached, a whole directory tree.
     *
     *     Lock(name, -1)              exclusive; 0 -> error 27
     *     AllocMem(260, MEMF_CLEAR)   0 -> routine 98
     *     Examine(lock, fib)
     *     cmpi.l #$0, $4(a0) / bhi    fib_DirEntryType > 0 -> the directory arm
     *     FreeMem / UnLock / DeleteFile(name) / beq -> error 26
     *
     * DEFECT: `a0` is not the FileInfoBlock. `Examine` takes its arguments in
     * d1 and d2 and sets nothing in a0, and the last thing to write a0 was the
     * filename copy loop at $3e54, which left it pointing just past the AMOS
     * string's characters. So the file-or-directory decision is made on four
     * bytes of whatever follows that string in AMOS's string area, and the
     * FileInfoBlock the routine went to the trouble of filling is never read.
     * Confirmed at $3eb2.
     *
     * DEVIATION: those four bytes are not modelled, so the FILE arm is taken.
     * That is the arm a zeroed string area gives — the normal case for a
     * freshly loaded program — and it is the arm the author must have been
     * testing, since it is the one that works. The consequence to know about
     * is that the directory arm, which is two thirds of the routine and does a
     * genuine recursive `CurrentDir`/`ExNext`/`Delete` walk, is unreachable in
     * practice: `S Delete` on a directory calls AmigaDOS `DeleteFile` on it,
     * which succeeds for an empty one and fails for any other.
     *
     * DEFECT: the out-of-memory arm reports the wrong message. `L_error1`
     * (routine 98) is `move.l #$1,d1` where every other error routine writes
     * d0, and d0 is what `L_ErrorExt` indexes the table with — so it raises
     * whatever d0 held, which here is the zero AllocMem just returned. The
     * message is "Illegal function call", not "Out of memory".
     */
    's delete'(it): void {
      const path = it.evalStr()
      // Lock(name, ACCESS_WRITE): a name that is not there gets no lock
      if (rt.vfs?.exists(path) == null) slnError(27)
      if (!rt.vfs!.deleteFile(path)) slnError(26)
    },
    /**
     * Routine 63 — `S Iconify title$,x,y,width`.
     *
     *     move.w  T_AMOShere(a5),d3 / beq
     *     EcCalD  AMOS_WB,0           AMOS is in front -> flip to Workbench
     *     SyCall  AmalFrz
     *     ...width; a width of ZERO is the only argument check, -> error 6
     *     IntCall -204                OpenWindow; 0 -> AmalUfrz, error 6
     *     move.b  MP_SIGBIT(port),d1 / bset d1,d0 / ExeCall -318   Wait()
     *     IntCall -72                 CloseWindow
     *     SyCall  AmalUfrz / EcCalD AMOS_WB,1
     *
     * The NewWindow at `IWindowStruc` decodes field for field: 20,20, 200x12,
     * pens 0 and 1, IDCMP $200 (CLOSEWINDOW alone), Flags $100e — ACTIVATE,
     * CLOSEGADGET, DEPTHGADGET, DRAGBAR — and Type 1, WBENCHSCREEN. The
     * program's x, y and width overwrite three of those; the HEIGHT of 12 is
     * fixed, and so are the min and max heights, so the window cannot be
     * resized into anything but a title bar. Width is written to nw_Width,
     * nw_MinWidth and nw_MaxWidth alike.
     *
     * NOTE it does NOT open the Workbench. The `IntCall -210` that would have
     * is commented out in the source, so on a machine whose Workbench screen
     * was closed the OpenWindow fails and the program gets error 6. This port
     * is more forgiving in one place only, and it is not this file's choice:
     * `intuition.ts`'s `openWindow` opens the Workbench on demand for a
     * NewWindow of type WBENCHSCREEN, which is what AROS does.
     *
     * DEVIATION: `Wait()` on the port's signal bit suspends the whole task
     * until the close gadget is clicked, and there is one thread here that has
     * to get back to the frame loop. `it.block(..., true)` re-runs the whole
     * statement on the next frame instead, which is what `Eliconify Amos`
     * already does for the same reason — the block is what makes a frame go
     * by, and the polling and the answer are the routine's.
     */
    's iconify'(it): void {
      const st = rt.sln
      if (st.iconWindow) {
        // the second and later visits: the routine is inside Wait()
        for (;;) {
          const m = st.iconWindow.getMsg()
          if (!m) {
            it.block({ type: 'iconify' }, true)
            return
          }
          if ((m.class & 0xffff) === IDCMP_CLOSEWINDOW) break
        }
        rt.intuition.closeWindow(st.iconWindow)
        st.iconWindow = null
        amalFreeze(rt, false)
        return
      }
      const title = it.evalStr()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const width = it.evalInt()
      // SyCall AmalFrz -- every channel, which is `Amal Freeze` with no
      // argument (InAmalFreeze +Lib.s)
      amalFreeze(rt, true)
      if (width === 0) {
        amalFreeze(rt, false)
        slnError(6)
      }
      const win = rt.intuition.openWindow({
        leftEdge: x,
        topEdge: y,
        width,
        height: 12,
        detailPen: 0,
        blockPen: 1,
        idcmpFlags: IDCMP_CLOSEWINDOW,
        flags: WFLG_ACTIVATE | WFLG_CLOSEGADGET | WFLG_DEPTHGADGET | WFLG_DRAGBAR,
        title,
        type: WBENCHSCREEN,
      })
      if (!win) {
        amalFreeze(rt, false)
        slnError(6)
      }
      st.iconWindow = win
      it.block({ type: 'iconify' }, true)
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
    // ---- the tracker ----------------------------------------------------
    /**
     * Routine 92 — `=S Track Length BANK/ADR`: the byte at 950, which is a
     * MOD's song length in positions. NOTE it uses `blo` where `S Track Play`
     * uses `ble`, so 65536 exactly is an ADDRESS here and a BANK there, and it
     * does not check the bank's name — it will read 950 bytes into anything.
     */
    's track length': (_, a): Value => {
      const data = trackBank(rt, int(a[0]!), false, false)
      return VI(data?.[MOD_SONGLENGTH] ?? 0)
    },
    /**
     * Routine 94 — `=S Track Tempo`, the extension's own `TrackTempo` byte.
     * NOT the player's live speed: an `Fxx` in the module moves `mt_speed` and
     * leaves this alone, so the two disagree the moment a module sets its own.
     */
    's track tempo': (): Value => VI(rt.sln.trackTempo),

    // ---- trackdisk ------------------------------------------------------
    /**
     * Routine 74 — `=S Disk State`.
     *
     *     TD_CHANGESTATE / DoIO
     *     move.b 35(a1),d3 / ext.w / ext.l / eori.l #$ffffffff
     *
     * 35 is the low byte of io_Actual, which TD_CHANGESTATE sets to zero when
     * a disk is present and non-zero when it is not, and the `eori` is a NOT.
     *
     * DEFECT: the source's own comment is *"The function return -1 if a disk
     * is in drive, or 0 if it isn't"*, and the second half is wrong. NOT 0 is
     * -1, so a disk gives -1; NOT 1 is -2, so an EMPTY DRIVE gives -2, not 0.
     * A program written to the comment and testing `= 0` never sees an empty
     * drive at all.
     */
    's disk state': (): Value => {
      trackCheck(rt)
      return VI(~(diskImage(rt) ? 0 : 1))
    },
    /**
     * Routine 75 — `=S Disk Prot State`: TD_PROTSTATUS, and the same io_Actual
     * byte sign-extended, without the NOT. Non-zero means write protected.
     *
     * The tab lives on the DRIVE (`../amiga/trackdisk.ts`), which is why an
     * ADF cannot answer this and why the port used to return a flat 0. The
     * non-zero value is 1 rather than $ff, which is the same byte `S Disk
     * State` above assumes trackdisk leaves for TD_CHANGESTATE; either would
     * sign-extend to a true answer and neither is stated by anything held
     * here.
     */
    's disk prot state': (): Value => {
      trackCheck(rt)
      return VI(slnDrive(rt)?.writeProtected === true ? 1 : 0)
    },
    /**
     * Routine 76 — `=S Disk Changes`: TD_CHANGENUM, the low byte of io_Actual
     * ZERO-extended, with the source's own note *"Do not extend byte"* on the
     * line that does not. The comment above it calls the answer *"number of
     * disk changes*2"*, which is an observation about trackdisk rather than
     * anything the routine does: the counter goes up on insertion and on
     * removal alike, which is what `FloppyDrive.changes` counts.
     */
    's disk changes': (): Value => {
      trackCheck(rt)
      return VI((slnDrive(rt)?.changes ?? 0) & 0xff)
    },
    /**
     * Routine 77 — `=S Num Tracks`: TD_GETNUMTRACKS, the low byte of io_Actual
     * zero-extended. A double-density Amiga floppy is 80 cylinders of two
     * heads, so the answer is 160 — and the byte is why: 160 fits and a
     * high-density disk's 320 would come back as 64.
     */
    's num tracks': (): Value => {
      trackCheck(rt)
      const image = diskImage(rt)
      return VI(image ? Math.floor(image.length / (SECTOR * 11)) & 0xff : 0)
    },
    /**
     * Routine 78 — `=S Disk Dev Check`: -1 when the device is open, 0 when it
     * is not. The only trackdisk keyword with no `L_TrackCheck` in front of
     * it, which is what makes it the one a program can safely ask first.
     */
    's disk dev check': (): Value => VI(rt.sln.disk.open ? -1 : 0),

    // ---- samples --------------------------------------------------------
    /** routine 55 — SamBankNr, straight out of the data zone */
    's sam bank': (): Value => VI(rt.sln.samBankNr),
    /** routine 50 — see `samBase`; 0 for a number past the end of the chain */
    's sam base': (_, a): Value => VI(samBase(rt, int(a[0]!))),
    /**
     * Routine 56 — the header's frequency longword. A sample that is not there
     * raises, where `=S Sam Length` on the same number answers 0.
     */
    's sam freq': (_, a): Value => {
      const addr = samBase(rt, int(a[0]!))
      if (addr === 0) slnError(0)
      return VI(peek32(rt, addr + SAM_FREQ) | 0)
    },
    /**
     * Routine 60 — the header's length. Seven instructions, and the missing
     * one is the error: `cmpi.l #0,d3 / beq _end` returns the zero `S Sam Base`
     * left in d3 rather than raising, so a sample that is not there is
     * indistinguishable from one of length zero.
     */
    's sam length': (_, a): Value => {
      const addr = samBase(rt, int(a[0]!))
      return VI(addr === 0 ? 0 : peek32(rt, addr + SAM_LEN) | 0)
    },

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
    /**
     * Routine 35 — `=S Compare$(SOURCE$, MASK$, POS, ENDPOS)`.
     *
     * It is not a comparison: it is a scan for the first character of SOURCE$
     * that appears ANYWHERE in MASK$, returning its 1-based position or 0. The
     * mask is a set of characters, not a substring, and the inner loop walks
     * the whole of it for every source character.
     *
     * NOTE the `$` in the name is decoration. The token spec is `"02,2,0,0"`,
     * whose leading `0` makes this an INTEGER function of two strings and two
     * integers, and the routine ends `clr.l d2` — AMOS's "the result is a
     * number". So `A = S Compare$(a$, b$, 0, 0)` is the way to call it.
     *
     * POS is 1-based and clipped by `cmp.l d2,d0 / rbcs L_error0`, so a POS
     * beyond the string raises; 0 and 1 both mean "from the start", because
     * `subq.l #1,d2 / ble` skips the adjustment for anything not positive.
     * ENDPOS counts from the START and 0 means "to the end": `d7 = len - ENDPOS`
     * is the number of characters to drop, applied only when it is positive
     * AND smaller than what is left to scan.
     *
     * DEVIATION: an EMPTY mask, or an empty source, runs off the end of its
     * buffer. `move.w (a1)+,d1 / move.l d1,d4 / subi.w #1,d4` gives $ffff for a
     * zero length and the `dbra` then reads 65,536 bytes of whatever follows.
     * Nothing here has a byte to give past the end of a JS string, so both
     * cases answer 0.
     */
    's compare$': (_, a): Value => {
      const src = str(a[0]!)
      const mask = str(a[1]!)
      const pos = int(a[2]!)
      const endPos = int(a[3]!)
      let len = src.length
      let count = len - 1
      let from = 0
      if (below(len, pos)) slnError(0)
      if (pos - 1 > 0) {
        count -= pos - 1
        from += pos - 1
      }
      const drop = len - endPos
      if (drop > 0 && count > drop) {
        count -= drop
        len -= drop
      }
      if (mask.length === 0 || src.length === 0) return VI(0)
      for (let i = 0; i <= count; i++) {
        if (mask.includes(src[from + i] ?? '\u0000')) return VI(len - (count - i))
      }
      return VI(0)
    },
    /**
     * Routine 83 — `=S Checksum(ADR)`, and it is the AmigaDOS block checksum:
     * 128 longwords SUBTRACTED from zero, then the longword at +20 added back
     * because that is the field the checksum itself lives in. So the answer is
     * the negated sum of the other 127 longwords, which is what a root block,
     * a boot block or a file header wants at offset 20. `S Disk Rename` uses it
     * on the root block it has just edited.
     *
     * Any address the port maps will do — a bank, an array from `=S Abase`, the
     * 512-byte buffer `S Disk Read` filled.
     */
    's checksum': (_, a): Value => {
      const base = int(a[0]!) >>> 0
      const long = (off: number): number =>
        (peek8(rt, base + off) * 0x1000000 +
          (peek8(rt, base + off + 1) << 16) +
          (peek8(rt, base + off + 2) << 8) +
          peek8(rt, base + off + 3)) >>>
        0
      let sum = 0
      for (let i = 0; i < 128; i++) sum = (sum - long(i * 4)) | 0
      return VI((sum + long(20)) | 0)
    },
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
