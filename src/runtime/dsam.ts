/**
 * D-Sam 1.01 --- Mark Everingham's disk sample player (AZ Software), slot 15.
 *
 * Fifty keywords over a 16,848-byte code hunk in 99 routines, read with
 * `extdis d-sam-1.01`. Routine 0 is at $50e and its data zone at $66a, which
 * is what every routine's opening `movea.l $1d8(a5),a2` loads.
 *
 * The idea is in the name. An ordinary AMOS `Sam Play` needs the whole sample
 * in chip memory; D-Sam streams it off disk through a small double buffer, so
 * a program can play a sample longer than the machine's RAM. Everingham built
 * that out of a second process (`CreateProc` at $3d78, 4,000-byte stack), two
 * signals (`AllocSignal` 20 and 21 at $55c and $566) and one interrupt handler
 * per audio channel (`SetIntVector` with `d0 = channel + 7`, INTB_AUD0, at
 * $3d16 and $3d4e), with the old vector saved to `$3bc(a2) + ch*4`.
 *
 * ## What stands in for the documentation
 *
 * `docs/D-Sam.doc` is 1,053 bytes and names two of the fifty keywords, `Smp
 * Open` and `Smp Play`. What fills the gap is the library's own error table at
 * $3dda, thirty NUL-separated strings that between them name nearly every
 * constraint the code enforces --- "Cannot play range of compressed sample",
 * "Samples are incompatible for dual playback", "Channels value does not match
 * assigned channels" --- and the author's `D-Sam-Example.AMOS`, which
 * exercises seventeen reader functions and settles the argument order this
 * file could otherwise only guess at: `Smp Loop Start(1,I)` is the sample
 * first and the loop second.
 *
 * ## The file format, from the constants rather than from a spec
 *
 * Routine 71 ($2da0) tests six chunk ids as long literals: `VHDR` at $2e56,
 * `NAME` $2e60, `CHAN` $2e6a, `SEQN` $2e74, `FADE` $2e7e and `BODY` $2e88,
 * inside `FORM`/`8SVX` at $2e2c and $2e42. SEQN and FADE are AudioMaster's
 * rather than IFF's, which is why errors 13 and 14 name that program.
 *
 * A file that is not IFF at all is not an error. $3238 `Lock`s it, `Examine`s
 * it, takes fib_Size from $7c of the FileInfoBlock and plays the whole thing
 * as raw signed bytes at 12,000 Hz (`move.w #$2ee0,$8(a4)`) and volume 64.
 *
 * ## Where this port differs
 *
 * DEVIATION: `Smp Open` holds the file's BYTES where the library holds a DOS
 * file handle and seeks. `AmosFS.read` is whole-file, and the point of D-Sam
 * is exactly the memory this port therefore spends. Nothing a program can ask
 * shows it: `=Smp Data` on an opened sample is error 17 either way, because
 * the library has no buffer to point at either. The Read and Seek calls are
 * still modelled one for one, so the chunk walk lands on the same bytes and
 * its quirks reproduce --- an unknown chunk of odd length puts the walk one
 * byte out of step here as it does there.
 *
 * DEVIATION: the reader process, the two signals and the four interrupt
 * vectors have no counterpart. There is one task in this port (see
 * ../amiga/README.md), so what they coordinate becomes a per-frame state
 * machine. Nothing in this tranche needs it; the playback keywords do.
 *
 * The sample records are real blocks at real addresses in a `MemPool`, chained
 * through +$3c from the list head at `$0(a2)` exactly as routine 73 chains
 * them, because `=Smp Data` and `=Smp Base` hand a program addresses and what
 * lies between them has to be walkable.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { AmosError, VI, VS, int, type Value } from '../interp/values'
import { MEMF, MemPool } from '../amiga/exec'

/**
 * The error table at $3dda, walked NUL to NUL.
 *
 * Entry 0 is the identity banner, and `Smp Version` (routine 40, $259a) is two
 * instructions that raise it: `moveq #$0,d0 / Rbra routine 97`. The keyword
 * announces the library by stopping the program with its name, which is not a
 * mistake --- an error table is the only way an extension prints anything.
 */
export const DSAM_ERRORS = [
  'D-Sam V1.01 rev 35 (C) 1992 AZ Software & Mark Everingham', // 0
  'Out of sample memory',
  'Sample already exists',
  'Sample does not exist',
  'Could not open sample file',
  'Error reading sample file',
  'Bad IFF structure in sample file',
  'Unknown compression scheme in sample file',
  'Illegal sample number',
  'Illegal channels value',
  'Illegal buffer size', // 10
  'Illegal playback speed',
  'Illegal playback volume',
  'Sample has no Audiomaster sequence',
  'Sample has no Audiomaster fade entry',
  'Sample has stereo data',
  'Sample has only mono data',
  'Sample is playing from disk',
  'No sample assigned to channels',
  'Illegal playback range',
  'Could not allocate hardware channels', // 20
  'Cannot assign stereo sample to single channel',
  'Channels are already assigned a sample',
  'Illegal sequence loop number',
  'Cannot modify channels while cued or playing',
  'Sample is still assigned to channels',
  'Samples are incompatible for dual playback',
  'Illegal priority value',
  'Cannot play range of compressed sample',
  'Illegal repeat value',
  'Channels value does not match assigned channels', // 30
] as const

/** raise one, the way routine 97 ($3dc6) does with the index in `d0` */
function dsErr(n: number): never {
  throw new AmosError(DSAM_ERRORS[n] ?? `D-Sam error ${n}`)
}

/**
 * Where the records and their buffers are mapped, matching
 * `Runtime.DSAM_HEAP_BASE` and `DSAM_HEAP_RESERVED`. Spelled out rather than
 * imported because `./runtime` is a TYPE-only import here, as it is in
 * make.ts; `memmap.test.ts` holds the two to agreeing.
 */
export const DSAM_HEAP_BASE = 0x34000000
export const DSAM_HEAP_RESERVED = 0x04000000

/**
 * The data zone, at the offsets `a2` uses.
 *
 * `SIZE` is $193a - $66a, the distance from the zone's first byte to routine
 * 1, because the zone is code and data together: `$554(a2)` and `$58e(a2)` are
 * the two interrupt handlers routine 92 ($3c9e) installs and `$60a(a2)` is the
 * seglist routine 95 hands `CreateProc`. Those parts are TypeScript here and
 * read as zero, which is the truth about them.
 */
export const DS = {
  /** the sample list head; routine 73 pushes each new record on the front */
  LIST: 0x00,
  /** `Smp Memory`'s two ceilings, and what is left of each */
  CHIP_TOTAL: 0x04,
  FAST_TOTAL: 0x08,
  CHIP_LEFT: 0x0c,
  FAST_LEFT: 0x10,
  /** word: the bits Minchip, Oversample and Decompress set */
  OPTIONS: 0x14,
  /** the colour clock chosen at $528, or at $542 when AMOS says not PAL */
  CLOCK: 0x16,
  DISK_BUF: 0x1a,
  DMA_BUF: 0x1e,
  /** four channel structures of $ba bytes, walked by `lea $ba(a3),a3` */
  CHANNELS: 0x22,
  /** `=Smp Disk Error` reads this and clears it (routine 59) */
  DISK_ERROR: 0x440,
  SIZE: 0x193a - 0x66a,
} as const

/** the option word at `$14(a2)`, one bit per keyword pair */
export const DOPT = {
  /** `Smp Decompress On` (routine 34, `ori.w #$40`), and up at a cold start */
  DECOMPRESS: 1 << 6,
  /** `Smp Oversample On` (routine 36, `ori.w #$1000`) */
  OVERSAMPLE: 1 << 12,
  /** `Smp Mode Minchip` (routine 1, `ori.w #$8000`); Minproc clears it */
  MINCHIP: 1 << 15,
} as const

/**
 * The 64-byte record routine 73 ($33ac) allocates with MEMF_CLEAR.
 *
 * The left and right halves sit $e apart and routine 72 ($329a) depends on it:
 * it points a4 at +$20, uses `$0(a4)`, `$8(a4)` and `$c(a4)`, then does `lea
 * $e(a4),a4` and reads the right channel through the same three offsets.
 */
export const SM = {
  /** word: the number `Smp Load n,...` was given */
  NUMBER: 0x00,
  /** the string block routine 67 builds; the pointer is at its characters */
  NAME: 0x02,
  FLAGS: 0x06,
  /** word: VHDR samplesPerSec, or 12,000 for a file that is not IFF */
  RATE: 0x08,
  /** word: VHDR volume, Fixed 16.16 scaled to 0..64 by `lsl.l #6 / swap` */
  VOLUME: 0x0a,
  /** what `=Smp Length` answers: the sequence total when there is one */
  LENGTH: 0x0c,
  /** what `=Smp Size` answers: the bytes of BODY, per channel */
  SIZE: 0x10,
  /** the SEQN table, pairs of longs, and its size in bytes */
  SEQ: 0x14,
  SEQ_SIZE: 0x18,
  /** the loops up to the FADE entry, totalled */
  FADE_LEN: 0x1c,
  LEFT: 0x20,
  FILE1: 0x24,
  LEFT_OFF: 0x28,
  LEFT_INIT: 0x2c,
  RIGHT: 0x2e,
  FILE2: 0x32,
  RIGHT_OFF: 0x36,
  RIGHT_INIT: 0x3a,
  NEXT: 0x3c,
  BYTES: 0x40,
} as const

/** the flags word at `+$6`, as the parser and the readers test it */
export const SF = {
  /** VHDR sCompression 1: Fibonacci delta, and cleared once decoded */
  COMPRESSED: 1 << 6,
  /** opened for disk play rather than loaded; `Smp Open` passes `#$100` */
  DISK: 1 << 8,
  /** a SEQN chunk was read */
  SEQUENCE: 1 << 9,
  /** a FADE chunk was read */
  FADE: 1 << 11,
  /** CHAN said 6 or 9 */
  STEREO: 1 << 14,
} as const

/**
 * `=Smp Info` (routine 54, $28a0) packs five flag bits into five result bits
 * through a table of five words at `$53a(a2)`: 11, 9, 6, 14, 8. `d1` counts
 * DOWN from 4, so the first word lands in the highest result bit.
 */
const INFO_BITS = [11, 9, 6, 14, 8] as const

/** the sixteen bytes at $133a, and the 8SVX spec's own Fibonacci table */
const FIB = [-34, -21, -13, -8, -5, -3, -2, -1, 0, 1, 2, 3, 5, 8, 13, 21] as const

/** 3579545/124: Paula's fastest safe rate, and routine 64's `cmpi.w #$70c3` */
const MAX_DMA_RATE = 0x70c3

/**
 * A file the library has open. It holds a BCPL handle and calls Read and Seek;
 * this holds the bytes and a position, and answers the same way.
 */
interface DsamFile {
  data: Uint8Array
  pos: number
}

export interface DsamState {
  /** the data zone; `=Smp Base` hands a program its address */
  zone: Uint8Array
  /** where the zone is mapped, or 0 until `=Smp Base` first asks */
  base: number
  /** the records and buffers routine 62 allocates, at real addresses */
  pool: MemPool
  /** open files, by the handle a record's +$24 or +$32 holds */
  files: Map<number, DsamFile>
  /** the next synthetic handle; zero is Open's failure and is never issued */
  nextHandle: number
}

export function newDsamState(): DsamState {
  const st: DsamState = {
    zone: new Uint8Array(DS.SIZE),
    base: 0,
    pool: new MemPool(DSAM_HEAP_BASE, DSAM_HEAP_RESERVED),
    files: new Map(),
    nextHandle: 1,
  }
  resetDefaults(st)
  // $528, and $542 when AMOS answers that the machine is not PAL. Both
  // constants are the standard colour clocks to the hertz.
  wr32(st.zone, DS.CLOCK, 3546895)
  return st
}

/* ---- reading and writing the zone and the pool ------------------------- */

const rd16 = (b: Uint8Array, o: number): number => ((b[o]! << 8) | b[o + 1]!) & 0xffff
const rd32 = (b: Uint8Array, o: number): number =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0

function wr16(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 8) & 0xff
  b[o + 1] = v & 0xff
}

function wr32(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 0xff
  b[o + 1] = (v >>> 16) & 0xff
  b[o + 2] = (v >>> 8) & 0xff
  b[o + 3] = v & 0xff
}

/** a pool address as an offset into the buffer the region maps */
const at = (addr: number): number => (addr >>> 0) - DSAM_HEAP_BASE

const poke16 = (st: DsamState, addr: number, o: number, v: number): void =>
  wr16(st.pool.buffer, at(addr) + o, v)
const poke32 = (st: DsamState, addr: number, o: number, v: number): void =>
  wr32(st.pool.buffer, at(addr) + o, v)
const peek16 = (st: DsamState, addr: number, o: number): number => rd16(st.pool.buffer, at(addr) + o)
const peek32 = (st: DsamState, addr: number, o: number): number => rd32(st.pool.buffer, at(addr) + o)
/** the flags word nearly every routine here starts by testing */
const flagsOf = (st: DsamState, rec: number): number => peek16(st, rec, SM.FLAGS)
const setFlags = (st: DsamState, rec: number, v: number): void => poke16(st, rec, SM.FLAGS, v)

/* ---- routine 61: what a cold start and `Smp Reset` both leave ---------- */

/**
 * Routine 61 ($2a24). Four `$ffffffff` ceilings, a 16KB disk buffer, a 2KB DMA
 * buffer, Minproc with Decompress on, and the disk error cleared. It ends
 * `SetTaskPri(reader, 0)`, which has nothing to reset here.
 */
function resetDefaults(st: DsamState): void {
  wr32(st.zone, DS.CHIP_TOTAL, 0xffffffff)
  wr32(st.zone, DS.CHIP_LEFT, 0xffffffff)
  wr32(st.zone, DS.FAST_TOTAL, 0xffffffff)
  wr32(st.zone, DS.FAST_LEFT, 0xffffffff)
  wr32(st.zone, DS.DISK_BUF, 0x4000)
  wr32(st.zone, DS.DMA_BUF, 0x800)
  wr16(st.zone, DS.OPTIONS, DOPT.DECOMPRESS)
  wr32(st.zone, DS.DISK_ERROR, 0)
}

/* ---- routines 62 and 63: AllocMem with the two ceilings in front ------- */

/**
 * Routine 62 ($2a6e). `d0` is the size and `d1` the requirements, and the
 * fallback order is the point: a request carrying neither CHIP nor FAST tries
 * fast first and retries in chip, so a sample lands in fast memory unless
 * something needs it where Paula can reach it.
 *
 * Each pool has a ceiling `Smp Memory` sets and a remainder this decrements,
 * which is what "Out of sample memory" means --- not that the machine is full
 * but that the extension has spent its allowance.
 *
 * DEFECT: `d1 = 6`, which routines 64 and 65 pass, loops forever when the size
 * is over the chip ceiling. $2aca falls to $2ac6, which restores `d1` from
 * `d3` and drops straight back into $2aca with nothing changed. Both callers
 * test the ceiling themselves before asking, so nothing reaches it; this
 * returns 0 rather than hanging, and says so here instead.
 */
function dsAlloc(st: DsamState, size: number, reqs: number): number {
  const z = st.zone
  const spend = (chip: boolean, got: number): number => {
    const off = chip ? DS.CHIP_LEFT : DS.FAST_LEFT
    wr32(z, off, (rd32(z, off) - size) >>> 0)
    return got
  }
  const grab = (chip: boolean): number =>
    st.pool.alloc(size, { clear: (reqs & MEMF.CLEAR) !== 0, chip })

  if ((reqs & MEMF.CHIP) === 0 && size <= rd32(z, DS.FAST_LEFT)) {
    const got = grab(false)
    if (got !== 0) return spend(false, got)
  }
  if (size <= rd32(z, DS.CHIP_LEFT)) {
    const got = grab(true)
    if (got !== 0) return spend(true, got)
  }
  return 0
}

/**
 * Routine 63 ($2b04). It calls FreeMem and then `TypeOfMem` on the block it
 * has just given back, to decide which ceiling gets the bytes returned. That
 * works because TypeOfMem answers from the memory list's regions rather than
 * from the block, and it is why the pool has to remember which pool each block
 * came from.
 */
function dsFree(st: DsamState, addr: number, size: number): void {
  if (addr === 0) return
  const chip = st.pool.chip(addr)
  st.pool.freeMem(addr)
  const off = chip ? DS.CHIP_LEFT : DS.FAST_LEFT
  wr32(st.zone, off, (rd32(st.zone, off) + size) >>> 0)
}

/* ---- routines 67 and 68: an AMOS string on the heap -------------------- */

/**
 * Routine 67 ($2cfc). The block is `length + 7` bytes: a long holding that
 * total, the AMOS word length, the characters and a NUL. The pointer handed
 * back is at the CHARACTERS, so `=Smp Name` subtracts 2 to make an AMOS string
 * of it (routine 44, `subq.l #$2,d3`) and routine 68 subtracts 6 to free it.
 */
function allocString(st: DsamState, text: string): number {
  const total = text.length + 7
  const block = dsAlloc(st, total, 0)
  if (block === 0) return 0
  const b = st.pool.buffer
  const o = at(block)
  wr32(b, o, total)
  wr16(b, o + 4, text.length)
  for (let i = 0; i < text.length; i++) b[o + 6 + i] = text.charCodeAt(i) & 0xff
  b[o + 6 + text.length] = 0
  return (block + 6) >>> 0
}

/** Routine 68 ($2d30): step back six bytes and free the size written there */
function freeString(st: DsamState, ptr: number): void {
  if (ptr === 0) return
  const block = (ptr - 6) >>> 0
  dsFree(st, block, rd32(st.pool.buffer, at(block)))
}

/** read one back, for `=Smp Name` and for the tests */
export function readDsamString(st: DsamState, ptr: number): string {
  if (ptr === 0) return ''
  const b = st.pool.buffer
  const o = at(ptr)
  const n = rd16(b, o - 2)
  let s = ''
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i]!)
  return s
}

/* ---- routines 73, 74 and 75: the sample list --------------------------- */

/**
 * Routine 73 ($33ac). Sixty-four MEMF_CLEAR bytes, the number in the first
 * word, and the record pushed on the front of the list at `$0(a2)`.
 *
 * DEFECT: the record is built through **a1**, not the a0 that `movea.l d0,a0`
 * has just loaded. The three writes are `3342 0000`, `236a 0000 003c` and
 * `2549 0000`, all mode 5 on register 1. Routine 62 never sets a1, so what
 * they land on is whatever exec's AllocMem left there. The library plainly
 * works, so on a real machine a1 comes back holding the block; nothing in this
 * code makes that true and no other routine depends on it. This links the
 * record through the pointer the code MEANT, because a port that reproduced
 * the register would have no sample list at all.
 */
function newSample(st: DsamState, number_: number): number {
  const rec = dsAlloc(st, SM.BYTES, MEMF.CLEAR)
  if (rec === 0) return 0
  poke16(st, rec, SM.NUMBER, number_)
  poke32(st, rec, SM.NEXT, rd32(st.zone, DS.LIST))
  wr32(st.zone, DS.LIST, rec)
  return rec
}

/** Routine 74 ($33d2): unlink, then free the sixty-four bytes */
function dropSample(st: DsamState, rec: number): void {
  let prev = 0
  let cur = rd32(st.zone, DS.LIST)
  while (cur !== 0 && cur !== rec) {
    prev = cur
    cur = peek32(st, cur, SM.NEXT)
  }
  if (cur === 0) return
  const next = peek32(st, cur, SM.NEXT)
  if (prev !== 0) poke32(st, prev, SM.NEXT, next)
  else wr32(st.zone, DS.LIST, next)
  dsFree(st, rec, SM.BYTES)
}

/**
 * Routine 75 ($3408). A number outside 0..$ffff is error 8; anything inside it
 * that is not in the list is simply absent, and the CALLER decides what that
 * means --- `Smp Load` wants absence and everything else wants error 3.
 */
function findSample(st: DsamState, n: number): number {
  if (n < 0 || n > 0xffff) dsErr(8)
  let cur = rd32(st.zone, DS.LIST)
  while (cur !== 0) {
    if (peek16(st, cur, SM.NUMBER) === (n & 0xffff)) return cur
    cur = peek32(st, cur, SM.NEXT)
  }
  return 0
}

/** the lookup the reader functions open with */
function mustFind(st: DsamState, n: number): number {
  const rec = findSample(st, n)
  if (rec === 0) dsErr(3)
  return rec
}

/* ---- the DOS calls the parser makes ------------------------------------ */

function openFile(rt: Runtime, st: DsamState, path: string): number {
  const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
  if (!bytes) return 0
  const h = st.nextHandle++
  st.files.set(h, { data: bytes, pos: 0 })
  return h
}

function closeFile(st: DsamState, h: number): void {
  st.files.delete(h)
}

/** Read(): the bytes transferred, which the parser compares to what it asked for */
function readFile(st: DsamState, h: number, n: number): Uint8Array {
  const f = st.files.get(h)
  if (!f) return new Uint8Array(0)
  const end = Math.min(f.data.length, f.pos + Math.max(0, n))
  const out = f.data.subarray(f.pos, end)
  f.pos = end
  return out
}

/**
 * Seek(). Returns the OLD position, or -1, and the parser uses both: $3164
 * seeks zero from the current position purely to learn where BODY's data
 * begins.
 */
function seekFile(st: DsamState, h: number, pos: number, mode: number): number {
  const f = st.files.get(h)
  if (!f) return -1
  const from = mode < 0 ? 0 : mode > 0 ? f.data.length : f.pos
  const to = from + pos
  if (to < 0 || to > f.data.length) return -1
  const was = f.pos
  f.pos = to
  return was
}

/** the four-byte read at $2f2e, and how a short read is detected */
function readLong(st: DsamState, h: number): number | null {
  const b = readFile(st, h, 4)
  return b.length === 4 ? rd32(b, 0) : null
}

/** the two-byte read at $2f48, sign-extended from its LOW byte by `ext.w` */
function readInitial(st: DsamState, h: number): number | null {
  const b = readFile(st, h, 2)
  if (b.length !== 2) return null
  const low = b[1]!
  return low >= 0x80 ? low - 0x100 : low
}

/* ---- routine 71: open a sample file and read its header ---------------- */

/** what the walk has seen, which SEQN and FADE both consult */
interface ChunkSeen {
  vhdr: boolean
  seqn: boolean
}

/**
 * Routine 71 ($2da0). `Smp Load` and `Smp Open` are the same parse with one
 * bit different, and the bit is in the record before the first chunk is read:
 * `move.w d5,$6(a4)` at $2dd4 puts `$100` there for `Smp Open`.
 *
 * Every failure has already unwound what it allocated, as the arms from $2eea
 * to $2f24 do, before it raises.
 */
function parseSample(
  rt: Runtime,
  st: DsamState,
  number_: number,
  path: string,
  diskFlags: number,
): { rec: number; handle: number } {
  if (findSample(st, number_) !== 0) dsErr(2)
  const rec = newSample(st, number_)
  if (rec === 0) dsErr(1)
  setFlags(st, rec, diskFlags)

  const nameBlock = allocString(st, path)
  if (nameBlock === 0) {
    dropSample(st, rec)
    dsErr(1)
  }
  const handle = openFile(rt, st, path)
  const fail = (n: number): never => {
    if (handle !== 0) closeFile(st, handle)
    freeSampleResources(st, rec)
    dropSample(st, rec)
    freeString(st, nameBlock)
    dsErr(n)
  }
  if (handle === 0) fail(4)

  const magic = readLong(st, handle)
  if (magic === null) fail(5)
  let iff = magic === 0x464f524d // 'FORM'
  if (iff) {
    readLong(st, handle) // the FORM length, which nothing here reads
    const kind = readLong(st, handle)
    if (kind === null) fail(5)
    iff = kind === 0x38535658 // '8SVX'
  }

  if (!iff) {
    // $3238: Lock, Examine, and play the whole file raw. The FileInfoBlock is
    // there only to carry fib_Size, which this already knows.
    const size = st.files.get(handle)!.data.length & ~1
    poke32(st, rec, SM.LENGTH, size)
    poke32(st, rec, SM.SIZE, size)
    poke16(st, rec, SM.RATE, 12000)
    poke16(st, rec, SM.VOLUME, 64)
    poke32(st, rec, SM.NAME, nameBlock)
    seekFile(st, handle, 0, -1)
    return { rec, handle }
  }

  const seen: ChunkSeen = { vhdr: false, seqn: false }
  for (;;) {
    const id = readLong(st, handle)
    if (id === null) fail(5)
    if (id === 0x424f4459) {
      readBody(st, rec, handle, nameBlock, fail)
      break
    }
    readChunk(st, rec, handle, id!, seen, fail)
  }
  // the filename block goes back unless it became the name. `Smp Open` keeps
  // it either way, which is what `btst #$8` at $2ed0 decides.
  if (peek32(st, rec, SM.NAME) !== nameBlock && (diskFlags & SF.DISK) === 0) {
    freeString(st, nameBlock)
  }
  return { rec, handle }
}

/** the five header chunks, and the seek that steps over everything else */
function readChunk(
  st: DsamState,
  rec: number,
  handle: number,
  id: number,
  seen: ChunkSeen,
  fail: (n: number) => never,
): void {
  const need = (): number => {
    const v = readLong(st, handle)
    if (v === null) fail(5)
    return v!
  }
  switch (id) {
    case 0x56484452: { // VHDR, $2f76
      if (need() !== 20) fail(6)
      const v = readFile(st, handle, 20)
      if (v.length !== 20) fail(5)
      const compression = v[15]!
      if (compression === 1) setFlags(st, rec, flagsOf(st, rec) | SF.COMPRESSED)
      else if (compression !== 0) fail(7)
      poke16(st, rec, SM.RATE, rd16(v, 12))
      // `lsl.l #$6,d0 / swap d0`: Fixed 1.0 is $10000 and 64 comes out
      poke16(st, rec, SM.VOLUME, (rd32(v, 16) << 6) >>> 16)
      seen.vhdr = true
      return
    }
    case 0x4e414d45: { // NAME, $2fc4
      const len = need()
      // zero is skipped, and a length over $ffff is treated as a chunk this
      // parser does not know: seeked past rather than read
      if (len === 0) return
      if (len > 0xffff) {
        if (seekFile(st, handle, len, 0) < 0) fail(5)
        return
      }
      const raw = readFile(st, handle, len)
      if (raw.length !== len) fail(5)
      let text = ''
      for (const c of raw) text += String.fromCharCode(c)
      // $300a re-counts the length by walking to the NUL, so a name with an
      // embedded zero byte is shortened here and its tail is never seen again
      const cut = text.indexOf('\0')
      const block = allocString(st, cut < 0 ? text : text.slice(0, cut))
      // a failed allocation drops the name and carries on ($2fec)
      if (block !== 0) poke32(st, rec, SM.NAME, block)
      return
    }
    case 0x4348414e: { // CHAN, $3026
      if (need() !== 4) fail(6)
      const v = need()
      // 6 is IFF's stereo; 9 is AudioMaster's, and the library takes both
      if (v === 6 || v === 9) setFlags(st, rec, flagsOf(st, rec) | SF.STEREO)
      return
    }
    case 0x5345514e: { // SEQN, $3066
      if (!seen.vhdr) fail(6)
      const len = need()
      if ((len & 7) !== 0) fail(6)
      const flags = flagsOf(st, rec)
      // a compressed sample gets its loops only when the bytes will be decoded
      // into memory: not when it plays off disk, and not with Decompress Off
      const skip =
        (flags & SF.COMPRESSED) !== 0 &&
        ((flags & SF.DISK) !== 0 || (rd16(st.zone, DS.OPTIONS) & DOPT.DECOMPRESS) === 0)
      const table = skip ? 0 : dsAlloc(st, len, 0)
      if (table === 0) {
        if (seekFile(st, handle, len, 0) < 0) fail(5)
        return
      }
      const raw = readFile(st, handle, len)
      if (raw.length !== len) fail(5)
      st.pool.buffer.set(raw, at(table))
      poke32(st, rec, SM.SEQ, table)
      poke32(st, rec, SM.SEQ_SIZE, len)
      // $30ca aligns each pair and totals the loops. DEFECT: the start gets
      // `bclr #$0` and the end `bclr #$1`, so a start is made even while an
      // end merely loses bit 1 --- an end of 7 stays 7 and an end of 6 becomes
      // 4. Both were meant to be aligned the same way.
      let total = 0
      for (let o = 0; o < len; o += 8) {
        const start = rd32(st.pool.buffer, at(table) + o) & ~1
        const end = rd32(st.pool.buffer, at(table) + o + 4) & ~2
        wr32(st.pool.buffer, at(table) + o, start)
        wr32(st.pool.buffer, at(table) + o + 4, end)
        total += end - start
      }
      poke32(st, rec, SM.LENGTH, total >>> 0)
      setFlags(st, rec, flagsOf(st, rec) | SF.SEQUENCE)
      seen.seqn = true
      return
    }
    case 0x46414445: { // FADE, $30f6
      if (need() !== 4) fail(6)
      const v = need()
      // a FADE that arrives before its SEQN is dropped without complaint
      if (!seen.seqn) return
      const off = (v - 1) << 3
      if (off >= peek32(st, rec, SM.SEQ_SIZE)) fail(6)
      setFlags(st, rec, flagsOf(st, rec) | SF.FADE)
      const table = peek32(st, rec, SM.SEQ)
      let total = 0
      for (let o = 0; o < off; o += 8) {
        total += rd32(st.pool.buffer, at(table) + o + 4) - rd32(st.pool.buffer, at(table) + o)
      }
      poke32(st, rec, SM.FADE_LEN, total >>> 0)
      return
    }
    default: {
      const len = need()
      // NOTE the skip is the chunk length exactly. IFF pads an odd chunk up to
      // an even boundary and this does not, so one odd unknown chunk puts
      // every id after it a byte out of step and the walk ends on error 5.
      if (seekFile(st, handle, len, 0) < 0) fail(5)
    }
  }
}

/** BODY at $3158: where the data is, how much of it, and the Fibonacci seeds */
function readBody(
  st: DsamState,
  rec: number,
  handle: number,
  nameBlock: number,
  fail: (n: number) => never,
): void {
  // a sample with no NAME is named after its file
  if (peek32(st, rec, SM.NAME) === 0) poke32(st, rec, SM.NAME, nameBlock)
  const len = readLong(st, handle)
  if (len === null) fail(5)
  const here = seekFile(st, handle, 0, 0)
  if (here < 0) fail(5)
  const flags = flagsOf(st, rec)
  let bytes = (flags & SF.STEREO) !== 0 ? len! >>> 1 : len!
  poke32(st, rec, SM.LEFT_OFF, here)
  poke32(st, rec, SM.RIGHT_OFF, here + bytes)
  if ((flags & SF.COMPRESSED) === 0) {
    bytes &= ~1
    poke32(st, rec, SM.SIZE, bytes)
    if ((flags & SF.SEQUENCE) === 0) poke32(st, rec, SM.LENGTH, bytes)
    return
  }
  // the two-byte Fibonacci header is not sample data, and each packed byte
  // becomes two samples once it is unpacked
  bytes -= 2
  const willDecode =
    (flags & SF.DISK) === 0 && (rd16(st.zone, DS.OPTIONS) & DOPT.DECOMPRESS) !== 0
  if (willDecode) bytes <<= 1
  poke32(st, rec, SM.SIZE, bytes)
  if ((flags & SF.SEQUENCE) === 0) poke32(st, rec, SM.LENGTH, bytes)
  const left = readInitial(st, handle)
  if (left === null) fail(5)
  poke16(st, rec, SM.LEFT_INIT, left! & 0xffff)
  poke32(st, rec, SM.LEFT_OFF, peek32(st, rec, SM.LEFT_OFF) + 2)
  if ((flags & SF.STEREO) === 0) return
  if (seekFile(st, handle, peek32(st, rec, SM.RIGHT_OFF), -1) < 0) fail(5)
  const right = readInitial(st, handle)
  if (right === null) fail(5)
  poke16(st, rec, SM.RIGHT_INIT, right! & 0xffff)
  poke32(st, rec, SM.RIGHT_OFF, peek32(st, rec, SM.RIGHT_OFF) + 2)
}

/** Routine 76 ($3442): everything a record points at, back to the pool */
function freeSampleResources(st: DsamState, rec: number): void {
  const flags = flagsOf(st, rec)
  if ((flags & SF.DISK) !== 0) {
    closeFile(st, peek32(st, rec, SM.FILE1))
    closeFile(st, peek32(st, rec, SM.FILE2))
  }
  freeString(st, peek32(st, rec, SM.NAME))
  poke32(st, rec, SM.NAME, 0)
  const seq = peek32(st, rec, SM.SEQ)
  if (seq !== 0) dsFree(st, seq, peek32(st, rec, SM.SEQ_SIZE))
  poke32(st, rec, SM.SEQ, 0)
  // both buffers are freed with the SAME size, +$10, and then it is zeroed
  const size = peek32(st, rec, SM.SIZE)
  const left = peek32(st, rec, SM.LEFT)
  if (left !== 0) {
    dsFree(st, left, size)
    const right = peek32(st, rec, SM.RIGHT)
    if (right !== 0) dsFree(st, right, size)
  }
  poke32(st, rec, SM.SIZE, 0)
}

/* ---- routine 64: where a loaded sample's bytes go ---------------------- */

/**
 * Routine 64 ($2b3a), inside Forbid/Permit. What it decides is the memory
 * TYPE, not whether to allocate: `d3 = 6` asks for chip so Paula can DMA
 * straight out of the buffer, and `d3 = 0` settles for fast because the bytes
 * will be copied through a chip double buffer anyway.
 *
 * Chip is asked for only with Minchip off, Oversample off, a rate at or under
 * $70c3, and room in both the extension's ceiling and AvailMem.
 */
function allocBody(rt: Runtime, st: DsamState, rec: number): boolean {
  const flags = flagsOf(st, rec)
  const size = peek32(st, rec, SM.SIZE)
  const want = (flags & SF.STEREO) !== 0 ? size * 2 : size
  const opts = rd16(st.zone, DS.OPTIONS)
  const chip =
    (opts & DOPT.MINCHIP) === 0 &&
    (opts & DOPT.OVERSAMPLE) === 0 &&
    peek16(st, rec, SM.RATE) <= MAX_DMA_RATE &&
    want <= rd32(st.zone, DS.CHIP_LEFT) &&
    want <= rt.chipFree()
  const reqs = chip ? MEMF.CHIP | MEMF.FAST : 0
  const left = dsAlloc(st, size, reqs)
  if (left === 0) return false
  poke32(st, rec, SM.LEFT, left)
  if ((flags & SF.STEREO) === 0) return true
  const right = dsAlloc(st, size, reqs)
  if (right === 0) return false
  poke32(st, rec, SM.RIGHT, right)
  return true
}

/* ---- routine 72: the BODY into memory ---------------------------------- */

/**
 * Routine 72 ($329a). One pass per channel, `lea $e(a4),a4` apart, each of
 * them a Seek to that channel's offset and then one of three reads.
 *
 * With Decompress Off a compressed BODY is read in AS IT IS and the flag stays
 * up, which makes `Smp Decompress` a mode rather than a conversion. With it on
 * the packed bytes go into the SECOND half of the buffer and are unpacked
 * forwards over themselves, and $33a4 clears the flag afterwards.
 */
function loadBody(st: DsamState, rec: number, handle: number): boolean {
  const flags = flagsOf(st, rec)
  const size = peek32(st, rec, SM.SIZE)
  const decode =
    (flags & SF.COMPRESSED) !== 0 && (rd16(st.zone, DS.OPTIONS) & DOPT.DECOMPRESS) !== 0
  const one = (buf: number, off: number, init: number): boolean => {
    if (seekFile(st, handle, off, -1) < 0) return false
    if (!decode) {
      const raw = readFile(st, handle, size)
      if (raw.length !== size) return false
      st.pool.buffer.set(raw, at(buf))
      return true
    }
    const packed = size >>> 1
    const raw = readFile(st, handle, packed)
    if (raw.length !== packed) return false
    const b = st.pool.buffer
    let o = at(buf)
    let acc = init & 0xff
    for (const byte of raw) {
      acc = (acc + FIB[byte >> 4]!) & 0xff
      b[o++] = acc
      acc = (acc + FIB[byte & 0xf]!) & 0xff
      b[o++] = acc
    }
    return true
  }
  if (!one(peek32(st, rec, SM.LEFT), peek32(st, rec, SM.LEFT_OFF), peek16(st, rec, SM.LEFT_INIT))) {
    return false
  }
  if ((flags & SF.STEREO) !== 0) {
    const ok = one(
      peek32(st, rec, SM.RIGHT),
      peek32(st, rec, SM.RIGHT_OFF),
      peek16(st, rec, SM.RIGHT_INIT),
    )
    if (!ok) return false
  }
  if (decode) setFlags(st, rec, flagsOf(st, rec) & ~SF.COMPRESSED)
  return true
}

/* ---- the keywords ------------------------------------------------------ */

export function makeDsamInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): DsamState => rt.dsam
  return {
    /** Routine 1 ($193a) --- `ori.w #$8000,$14(a2)`, three instructions */
    'smp mode minchip'() {
      const z = st().zone
      wr16(z, DS.OPTIONS, rd16(z, DS.OPTIONS) | DOPT.MINCHIP)
    },
    /** Routine 2 ($1946) --- and this is the state routine 61 leaves */
    'smp mode minproc'() {
      const z = st().zone
      wr16(z, DS.OPTIONS, rd16(z, DS.OPTIONS) & ~DOPT.MINCHIP)
    },
    /**
     * Routine 3 ($1952) --- `Smp Memory CHIP,FAST`.
     *
     * Both ceilings move at once, and either is refused if the extension has
     * already spent more than the new one allows: `$4(a2) - $c(a2)` is what
     * chip is holding, and a ceiling under it is error 1.
     */
    'smp memory'(it) {
      const chip = it.evalInt() >>> 0
      it.expect(',')
      const fast = it.evalInt() >>> 0
      const z = st().zone
      const chipUsed = (rd32(z, DS.CHIP_TOTAL) - rd32(z, DS.CHIP_LEFT)) >>> 0
      const fastUsed = (rd32(z, DS.FAST_TOTAL) - rd32(z, DS.FAST_LEFT)) >>> 0
      if (chipUsed > chip || fastUsed > fast) dsErr(1)
      wr32(z, DS.CHIP_TOTAL, chip)
      wr32(z, DS.FAST_TOTAL, fast)
      wr32(z, DS.CHIP_LEFT, (chip - chipUsed) >>> 0)
      wr32(z, DS.FAST_LEFT, (fast - fastUsed) >>> 0)
    },
    /**
     * Routine 4 ($1992). Rounded down to a multiple of eight and refused under
     * 512, then the DMA buffer follows at half its size, capped at $fff8.
     */
    'smp disk buffer'(it) {
      const n = (it.evalInt() & ~7) >>> 0
      if (n < 0x200) dsErr(10)
      const z = st().zone
      wr32(z, DS.DISK_BUF, n)
      wr32(z, DS.DMA_BUF, Math.min(n >>> 1, 0xfff8))
    },
    /**
     * Routine 5 ($19d4). The dependency runs the other way here: the DMA
     * buffer is set, and the disk buffer is rounded to a whole number of them,
     * at least two. A disk buffer that already divides exactly is left alone.
     */
    'smp dma buffer'(it) {
      const n = (it.evalInt() & ~7) >>> 0
      if (n < 0x100 || n > 0xfff8) dsErr(10)
      const z = st().zone
      wr32(z, DS.DMA_BUF, n)
      const disk = rd32(z, DS.DISK_BUF)
      const q = Math.floor(disk / n)
      if (q >= 2 && disk % n === 0) return
      wr32(z, DS.DISK_BUF, (Math.max(q, 2) * n) >>> 0)
    },
    /**
     * Routine 38 ($2558) --- `SetTaskPri` on the reader process, -20..20.
     *
     * DEVIATION: there is no second task here, so the range check is the whole
     * keyword. The value is not kept, because nothing can read it back.
     */
    'smp priority'(it) {
      const n = it.evalInt() | 0
      if (n < -20 || n > 20) dsErr(27)
    },
    /** Routine 6 ($1a2e) --- `Smp Load N,FILE$`: parse, allocate, read, close */
    'smp load'(it) {
      const n = it.evalInt() | 0
      it.expect(',')
      const path = it.evalStr()
      const s = st()
      const { rec, handle } = parseSample(rt, s, n, path, 0)
      const allocated = allocBody(rt, s, rec)
      const read = allocated && loadBody(s, rec, handle)
      closeFile(s, handle)
      if (read) return
      freeSampleResources(s, rec)
      dropSample(s, rec)
      dsErr(allocated ? 5 : 1)
    },
    /**
     * Routine 7 ($1a8a) --- `Smp Open N,FILE$`. The same parse with `$100`,
     * and the handle kept instead of the bytes. A stereo sample opens its file
     * a SECOND time, at +$32, so the two channels can seek independently.
     */
    'smp open'(it) {
      const n = it.evalInt() | 0
      it.expect(',')
      const path = it.evalStr()
      const s = st()
      const { rec, handle } = parseSample(rt, s, n, path, SF.DISK)
      poke32(s, rec, SM.FILE1, handle)
      if ((flagsOf(s, rec) & SF.STEREO) === 0) return
      const second = openFile(rt, s, path)
      if (second === 0) {
        freeSampleResources(s, rec)
        dropSample(s, rec)
        dsErr(4)
      }
      poke32(s, rec, SM.FILE2, second)
    },
    /**
     * Routine 8 ($1b1a) --- `Smp Close N`, over routine 77 ($34c6).
     *
     * Routine 77 walks all four channels before it frees anything and a sample
     * still assigned to one is error 25, so a close cannot pull a buffer out
     * from under a voice. That arm arrives with the channel keywords, since
     * until they exist nothing can be assigned.
     */
    'smp close'(it) {
      const s = st()
      const rec = mustFind(s, it.evalInt())
      freeSampleResources(s, rec)
      dropSample(s, rec)
    },
    /** Routine 34 ($2528) --- and this bit is already up after a cold start */
    'smp decompress on'() {
      const z = st().zone
      wr16(z, DS.OPTIONS, rd16(z, DS.OPTIONS) | DOPT.DECOMPRESS)
    },
    /** Routine 35 ($2534) */
    'smp decompress off'() {
      const z = st().zone
      wr16(z, DS.OPTIONS, rd16(z, DS.OPTIONS) & ~DOPT.DECOMPRESS)
    },
    /** Routine 36 ($2540) --- `ori.w #$1000`; routine 64 reads it as "not chip" */
    'smp oversample on'() {
      const z = st().zone
      wr16(z, DS.OPTIONS, rd16(z, DS.OPTIONS) | DOPT.OVERSAMPLE)
    },
    /** Routine 37 ($254c) */
    'smp oversample off'() {
      const z = st().zone
      wr16(z, DS.OPTIONS, rd16(z, DS.OPTIONS) & ~DOPT.OVERSAMPLE)
    },
    /**
     * Routine 39 ($258c) --- routine 60 then routine 61: stop every channel,
     * free every sample, and put the defaults back.
     */
    'smp reset'() {
      const s = st()
      let cur = rd32(s.zone, DS.LIST)
      while (cur !== 0) {
        const next = peek32(s, cur, SM.NEXT)
        freeSampleResources(s, cur)
        dsFree(s, cur, SM.BYTES)
        cur = next
      }
      wr32(s.zone, DS.LIST, 0)
      resetDefaults(s)
    },
    /**
     * Routine 40 ($259a) --- `moveq #$0,d0 / Rbra routine 97`, which raises
     * entry 0 of the error table. The keyword's whole job is to stop the
     * program with the library's name on the screen.
     */
    'smp version'() {
      dsErr(0)
    },
  }
}

export function makeDsamFunctions(rt: Runtime): Record<string, Func> {
  const st = (): DsamState => rt.dsam
  /** every reader function opens the same way: one argument, one lookup */
  const one = (a: Value[]): number => mustFind(st(), int(a[0]!))
  return {
    /** Routine 43 ($25fe) --- three instructions handing back `$1d8(a5)` */
    'smp base'(): Value {
      return VI(rt.dsamBase())
    },
    /** Routine 44 ($2606) --- the name pointer less two, i.e. an AMOS string */
    'smp name'(_, a): Value {
      const s = st()
      return VS(readDsamString(s, peek32(s, one(a), SM.NAME)))
    },
    /** Routine 45 ($2634) --- +$10, the bytes of BODY per channel */
    'smp size'(_, a): Value {
      return VI(peek32(st(), one(a), SM.SIZE) | 0)
    },
    /** Routine 46 ($2660) --- +$c, which SEQN overwrites with its own total */
    'smp length'(_, a): Value {
      return VI(peek32(st(), one(a), SM.LENGTH) | 0)
    },
    /** Routine 47 ($268c) --- the table size over eight; no SEQN is error 13 */
    'smp loops'(_, a): Value {
      const s = st()
      const rec = one(a)
      if ((flagsOf(s, rec) & SF.SEQUENCE) === 0) dsErr(13)
      return VI(peek32(s, rec, SM.SEQ_SIZE) >>> 3)
    },
    /** Routine 48 ($26cc) --- `=Smp Loop Start(SAMPLE,LOOP)`, the loop 1-based */
    'smp loop start'(_, a): Value {
      return VI(loopEdge(st(), a, 0))
    },
    /** Routine 49 ($2728) --- the same walk, four bytes further into the pair */
    'smp loop end'(_, a): Value {
      return VI(loopEdge(st(), a, 4))
    },
    /**
     * Routine 50 ($2784). Error 15 for a stereo sample --- it has two buffers
     * and this returns one address --- and error 17 for one playing off disk,
     * which has no buffer at all.
     */
    'smp data'(_, a): Value {
      const s = st()
      const rec = one(a)
      const flags = flagsOf(s, rec)
      if ((flags & SF.DISK) !== 0) dsErr(17)
      if ((flags & SF.STEREO) !== 0) dsErr(15)
      return VI(peek32(s, rec, SM.LEFT) | 0)
    },
    /** Routine 51 ($27d0) --- and a MONO sample is error 16 here */
    'smp left data'(_, a): Value {
      return VI(channelData(st(), a, SM.LEFT))
    },
    /** Routine 52 ($281c) */
    'smp right data'(_, a): Value {
      return VI(channelData(st(), a, SM.RIGHT))
    },
    /** Routine 53 ($2868) --- `moveq #$ff,d3`, so True is -1 */
    'smp stereo'(_, a): Value {
      const s = st()
      return VI((flagsOf(s, one(a)) & SF.STEREO) !== 0 ? -1 : 0)
    },
    /**
     * Routine 54 ($28a0). Five flags into five bits through the table at
     * `$53a(a2)`: 1 plays from disk, 2 stereo, 4 compressed, 8 has a sequence,
     * 16 has a fade. `Bin$(Smp Info(1),8)` is how the author's example prints
     * it.
     */
    'smp info'(_, a): Value {
      const flags = flagsOf(st(), one(a))
      let out = 0
      for (let i = 0; i < INFO_BITS.length; i++) {
        if ((flags & (1 << INFO_BITS[i]!)) !== 0) out |= 1 << (INFO_BITS.length - 1 - i)
      }
      return VI(out)
    },
    /** Routine 57 ($2946) */
    'smp sequence'(_, a): Value {
      const s = st()
      return VI((flagsOf(s, one(a)) & SF.SEQUENCE) !== 0 ? -1 : 0)
    },
    /** Routine 58 ($297e) */
    'smp fade'(_, a): Value {
      const s = st()
      return VI((flagsOf(s, one(a)) & SF.FADE) !== 0 ? -1 : 0)
    },
    /**
     * Routine 59 ($29b6) --- four instructions, and the third CLEARS `$440`.
     * The disk error is a latch a program reads once; asking twice answers
     * zero the second time.
     */
    'smp disk error'(): Value {
      const s = st()
      const v = rd32(s.zone, DS.DISK_ERROR)
      wr32(s.zone, DS.DISK_ERROR, 0)
      return VI(v | 0)
    },
    /** Routine 41 ($25a2) --- VHDR samplesPerSec, as a word */
    'smp speed'(_, a): Value {
      const s = st()
      return VI(peek16(s, one(a), SM.RATE))
    },
    /** Routine 42 ($25d0) --- VHDR volume scaled to 0..64 */
    'smp volume'(_, a): Value {
      const s = st()
      return VI(peek16(s, one(a), SM.VOLUME))
    },
  }
}

/** the shared half of routines 48 and 49: bounds first, then the pair */
function loopEdge(st: DsamState, a: Value[], half: number): number {
  const rec = mustFind(st, int(a[0]!))
  if ((flagsOf(st, rec) & SF.SEQUENCE) === 0) dsErr(13)
  const off = (int(a[1]!) - 1) << 3
  // `bmi` then `cmp.l $18(a0),d4 / bhi`: the test is ABOVE, not at or above,
  // so the loop one past the end reads the eight bytes after the table
  if (off < 0 || off > peek32(st, rec, SM.SEQ_SIZE)) dsErr(23)
  return rd32(st.pool.buffer, at(peek32(st, rec, SM.SEQ)) + off + half) | 0
}

/** the shared half of routines 51 and 52 */
function channelData(st: DsamState, a: Value[], which: number): number {
  const rec = mustFind(st, int(a[0]!))
  const flags = flagsOf(st, rec)
  if ((flags & SF.STEREO) === 0) dsErr(16)
  if ((flags & SF.DISK) !== 0) dsErr(17)
  return peek32(st, rec, which) | 0
}
