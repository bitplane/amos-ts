/**
 * `Easylife.Library` — the structured-variable engine behind EasyLife's
 * twenty `St ...` keywords.
 *
 * ## Why this is in `src/runtime` and not `src/amiga`
 *
 * It is a real Amiga shared library — RomTag, RTF_AUTOINIT, fourteen user
 * LVOs, and an autodoc in `EasyLifeSTRUCT.guide` — so the obvious home looks
 * like `src/amiga`, beside `patternlib.ts` and `xpkmaster.ts`. It does not
 * belong there, for the reason that directory's README gives: **one caller
 * owns it**, and this one is not even independent of that caller. It is
 * Paul Hickman's own library, shipped with his own extension, and it reaches
 * back into AMOS twice —
 *
 *   - the type table comes from a CALLBACK the extension installs at
 *     `$2a(a6)`, a six-byte thunk at `$11b4` that is `Rjmp L_Bnk_GetAdr`
 *     (AMOS routine $44c). The library therefore knows nothing about AMOS
 *     banks and everything about AMOS: it asks the extension, and the
 *     extension asks AMOS for bank `$ec` = 12.
 *   - `ELST_SaveTree` and `ELST_LoadTree` take DOSBase from `$2b8(a5)` —
 *     AMOS's own workspace register, still live because the extension calls
 *     in with `movea.l $1e8(a5),a6` and never touches a5.
 *
 * A library that indexes AMOS's a5 is not a modelled machine, it is the
 * extension's back half. `src/amiga/README.md`'s test — "more than one
 * caller could reasonably need it and none of them owns it" — fails on both
 * halves, so it lives here, next to `easylife.ts`.
 *
 * ## Evidence
 *
 * DISASSEMBLY, off `fixtures/extensions/easylife-1.10/libs/Easylife.Library`
 * (2,764 bytes, one 2,600-byte code hunk, `Easylife.Library V 1.02
 * (21.09.94) (c) Paul Hickman`), with `EasyLifeSTRUCT.guide`'s autodoc
 * beside it. The LVOs, and the addresses they resolve to:
 *
 *      -30 $1d8  ELST_Lookup(ID, scope)
 *      -36 $236  the type table, through the callback
 *      -42 $166  ELST_Free
 *      -48 $25a  ELST_New
 *      -54 $3be  ELST_GetElement(Elem, Inst, Idx, NIdx)
 *      -60 $46a  ELST_SetElement(Elem, Inst, Idx, NIdx, Value)
 *      -66 $548  ELST_StrCmp
 *      -72 $59c  ELST_FreeBlocks
 *      -78 $5f8  ELST_TreeScan
 *      -84 $6d0  ELST_TreeScanFree
 *      -90 $7b4  ELST_LoadTree
 *      -96 $6e8  ELST_SaveTree
 *     -102 $8e4  ELST_RelocateTable
 *     -108 $97a  free a whole graph — `St Erase`
 *
 * Where the guide and the binary disagree the binary wins, and over this
 * library they disagree four times: the lookup table's count word, the sign
 * of `ELST_StrCmp`, cycles reaching the root, and arrays of sub-structures.
 * Each is marked where it happens.
 *
 * ## Errors
 *
 * Every entry point returns with the Z flag set on failure and an error
 * indicator in d0, and the extension's routine 299 ($3aca) is what reads it:
 * negative means EasyLife's own message table, negated; non-negative means
 * an AMOS error number. `ElstError` carries that d0 verbatim so the one
 * place that translates it is the one place the 68k translates it.
 */
import { Runtime } from './runtime'

/** `"ElSt"` — the definitions bank's magic, and a saved file's */
export const ELST_MAGIC = 0x456c5374

/**
 * Bank 12, written by routine 0's `move.l #$c,$ec(a2)` and never written
 * again. The number is the library's, not a user setting: no keyword
 * changes `$ec`.
 */
export const ELST_BANK = 12

/**
 * The twelve element type codes, in the order `ELST_GetElement`'s jump table
 * at $3f4 and `ELST_SetElement`'s at $49a index them, which is also the
 * order the autodoc names them.
 */
export const ST_LONG = 0
export const ST_RANGED_LONG = 1
export const ST_WORD = 2
export const ST_RANGED_WORD = 3
export const ST_BYTE = 4
export const ST_RANGED_BYTE = 5
export const ST_REAL = 6
export const ST_POINTER = 7
export const ST_TYPED_POINTER = 8
export const ST_BOOLEAN = 9
export const ST_STRING = 10
export const ST_SUBSTRUCT = 11

/**
 * A failure from the library, carrying the d0 the 68k would have returned.
 *
 * Negative: EasyLife's private message table, negated — see `EASYLIFE_ERRORS`
 * in easylife.ts. Non-negative: an AMOS run-time error number.
 */
export class ElstError extends Error {
  constructor(readonly d0: number) {
    super(`easylife.library error ${d0}`)
    this.name = 'ElstError'
  }
}

/** $9ae — the type-table callback answered 0, so bank 12 is not reserved */
const ERR_NO_BANK = 36
/** $9b8 — AllocMem failed */
const ERR_NO_MEM = 24
/** $9c2 — the wrong number of subscripts, or a free from outside every block */
const ERR_FUNC_CALL = 23
/** $9cc — Open() failed in SaveTree or LoadTree. See the note on `saveTree` */
const ERR_OPEN = 94
/** $a1c — LoadTree's magic word was not `"ElSt"`. Same note */
const ERR_MAGIC = 98
/** $9e0 — an array subscript out of range. See the note in `resolve` */
const ERR_INDEX = -31
/** $9ea / $9f4 — a ranged integer below its minimum / above its maximum */
const ERR_UNDER = -32
const ERR_OVER = -33
/** $9fe — a typed pointer assigned the address of the wrong type */
const ERR_PTR_TYPE = -34
/** $a12 — a string longer than the element's maximum */
const ERR_STR_LONG = -35
/** $a08 — the value of a sub-structure element cannot be assigned */
const ERR_SUBSTRUCT = -36

/**
 * `Element/Structure not recognised`, message 38.
 *
 * DEFECT: nothing in either binary raises it. `ELST_Lookup` fails by falling
 * out of its `dbra` and returning with the Z flag set and d0 UNSET — $ffff
 * when the search ran off the end of the table, 0 when the id passed in was
 * 0, and the residual loop counter when the entry's offset landed outside
 * bank 12. Its five callers all `beq.w $9b0`, an exit block that unlinks and
 * sets Z without touching d0, so routine 299 sees a non-negative number and
 * hands it to `L_Error` as an AMOS error code. 65535 is off the end of AMOS's
 * table and 0 is its empty first entry. The message the guide documents at
 * length — "This error occurs if the value you pass is not in bank 12, or is
 * in the wrong part of the bank" — is in the table and unreachable.
 *
 * Not reproducible: an AMOS error number of 65535 is not a behaviour a caller
 * can observe as anything but a crash. The port raises message 38, which is
 * what the table and the guide both name it.
 */
const ERR_NOT_FOUND = -38

const be32 = (b: Uint8Array, o: number): number =>
  (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0
const be16 = (b: Uint8Array, o: number): number => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0)

/** one pool block: exec's MemHeader made concrete, see `newBlock` */
export interface ElstBlock {
  /** the address `extBlockBase` gave it, so instances have real addresses */
  base: number
  data: Uint8Array
  /** free runs as (offset, length), sorted and coalesced — exec's MemChunk list */
  free: Array<{ at: number; len: number }>
}

/** the library's `$f0`/`$f4`/`$f8`: the cached table, the live count, the chain */
export interface ElstPool {
  blocks: ElstBlock[]
  live: number
}

export const newElstPool = (): ElstPool => ({ blocks: [], live: 0 })

/**
 * `$236` — the type table, which IS the Structs bank.
 *
 * `move.l $f0(a6),d0 / bne` is a cache; on a miss it calls the extension's
 * callback with `$ec(a6)` and stores the answer. The callback is
 * `L_Bnk_GetAdr`, so a bank that is not reserved answers 0 and every caller
 * turns that into AMOS 36. Nothing checks the bank's NAME or its `"ElSt"`
 * magic, so bank 12 holding something else is read as though it were a
 * definitions bank rather than refused.
 *
 * NOTE: the cache is not modelled. `$f0` exists to save a call into AMOS per
 * lookup and there is nothing to save here, but it is also what
 * `ELST_FreeBlocks` reads the block size out of — see `freeBlocks`.
 */
export function typeTable(rt: Runtime): Uint8Array {
  const b = rt.memBanks.get(ELST_BANK)
  if (!b || b.kind !== 'memory' || b.data.length === 0) throw new ElstError(ERR_NO_BANK)
  return b.data
}

/**
 * `$1d8 ELST_Lookup(ID = d0, scope = d1)` — turn an `ST_...` value into the
 * offset of its definition.
 *
 * The lookup table sits at the front of the bank: a count word, then entries
 * of `[offset:16][key:16]`. Key 0 marks a structure name; any other key is
 * the id of the structure an element belongs to, which is what makes
 * `St Set T,ST_VALUE` an error when `value` is some other structure's
 * element even though `ST_VALUE` is a legal name.
 *
 * DEVIATION: from the guide, `d0 = (a0)+.w` then `dbra d0` runs count+1 times,
 * so the word is a dbra count and holds entries MINUS ONE. The guide's own
 * format page writes `dc.w 3` for a three-entry example. All five Structs
 * banks in the archive store entries-1, so the binary and the artefacts agree
 * and the guide is wrong.
 *
 * The two bounds are the bank's own: `$10(a1)` is the header's offset-to-
 * definitions and `-$14(a1)` is the AMOS bank node's LONG field, which is the
 * bank length plus sixteen. An offset in the final sixteen bytes therefore
 * passes a check meant to stop at the end of the bank.
 */
export function lookup(bank: Uint8Array, id: number, scope: number): number {
  // `move.l d0,d2 / beq` — id 0 never matches, and takes the failure exit
  // before the table is even fetched
  if (id === 0) throw new ElstError(ERR_NOT_FOUND)
  const count = be16(bank, id)
  let at = id + 2
  for (let i = 0; i <= count; i++) {
    const entry = be32(bank, at)
    at += 4
    // `cmp.w d1,d2` — only the LOW word, which is the key
    if ((entry & 0xffff) !== (scope & 0xffff)) continue
    // `move.w #0,d2 / swap d2` — the entry's HIGH word, the definition offset
    const off = entry >>> 16
    if (off < be32(bank, 16)) break
    if (off >= bank.length + 16) break
    return off
  }
  throw new ElstError(ERR_NOT_FOUND)
}

/** a structure definition, key 0 — `$680`'s reading, field for field */
export interface StructDef {
  /** +0, the allocation size, already rounded up by the compiler */
  size: number
  /** +4, how many pointer elements; they occupy offsets 4, 8, ... 4*n */
  pointers: number
  /** +6 and the ten-byte records after it */
  subs: Array<{ offset: number; count: number; id: number }>
}

export function structDef(bank: Uint8Array, off: number): StructDef {
  const size = be32(bank, off)
  const pointers = be16(bank, off + 4)
  const nsubs = be16(bank, off + 6)
  const subs: StructDef['subs'] = []
  let at = off + 8
  for (let i = 0; i < nsubs; i++) {
    subs.push({ offset: be32(bank, at), count: be32(bank, at + 4), id: be16(bank, at + 8) })
    at += 10
  }
  return { size, pointers, subs }
}

/** an element definition — the bytes `$364` walks and the arms then read */
export interface ElementDef {
  type: number
  /** one bound per dimension, in the order the descriptor stores them */
  dims: number[]
  /** the element's byte offset within the instance */
  offset: number
  /** where the type-specific tail starts, which each arm reads for itself */
  extra: number
}

export function elementDef(bank: Uint8Array, off: number): ElementDef {
  const type = bank[off] ?? 0
  const ndims = bank[off + 1] ?? 0
  const dims: number[] = []
  let at = off + 2
  for (let i = 0; i < ndims; i++) {
    dims.push(be16(bank, at))
    at += 2
  }
  return { type, dims, offset: be32(bank, at), extra: at + 4 }
}

/** what `$364` hands its two callers */
export interface Resolved {
  def: ElementDef
  /** the flattened subscript, still in ELEMENTS — each arm scales it itself */
  index: number
  /** the instance's address */
  inst: number
}

/**
 * `$364` — the resolver both `ELST_GetElement` and `ELST_SetElement` sit on.
 *
 * Reads the instance's type word, looks the element up under it, checks the
 * subscript count against the descriptor, and folds the subscripts into one
 * index with `d4 = d4 * bound + subscript`.
 *
 * The subscripts arrive in REVERSE source order, because they are read off
 * AMOS's parameter stack upwards: the autodoc says so outright — "ARRAY(X,Y,Z)
 * should have the longwords in the order: D2=Z, D2+4=Y, D2+8=X". The k-th
 * descriptor word is therefore paired with the k-th longword of that list,
 * whatever "highest dimension first" was meant to mean, and pairing them the
 * way the code does is right by construction.
 *
 * DEFECT: the range test is `bmi` on the subscript and then `cmp.l d3,d2 /
 * bcs`, which fails only when the subscript is GREATER than the bound —
 * equal passes. Both arms branch to $9e0, message 31 "Array index value is
 * negative"; $9d6, message 30 "Array index value is too high", is in the
 * table and nothing reaches it. Reproduced exactly: the port raises 31 for
 * both and admits an index equal to the bound.
 */
export function resolve(
  rt: Runtime,
  elem: number,
  inst: number,
  idx: readonly number[],
): Resolved {
  const bank = typeTable(rt)
  const type = readWord(rt, inst)
  const def = elementDef(bank, lookup(bank, elem, type))
  if (def.dims.length !== idx.length) throw new ElstError(ERR_FUNC_CALL)
  let flat = 0
  for (let i = 0; i < def.dims.length; i++) {
    const bound = def.dims[i] ?? 0
    const sub = idx[i] ?? 0
    if (sub < 0) throw new ElstError(ERR_INDEX)
    if (bound < sub) throw new ElstError(ERR_INDEX)
    // `mulu.w d2,d4` — a WORD multiply, so the accumulator wraps at 32 bits
    flat = (Math.imul(flat, bound & 0xffff) + sub) | 0
  }
  return { def, index: flat, inst }
}

/* ------------------------------------------------------------------ *
 * reading and writing the modelled address space
 * ------------------------------------------------------------------ */

function readByte(rt: Runtime, addr: number): number {
  const m = rt.resolveAddr(addr >>> 0)
  return m ? (m.data[m.off] ?? 0) : 0
}

function writeByte(rt: Runtime, addr: number, v: number): void {
  const m = rt.resolveWrite(addr >>> 0)
  if (m) m.data[m.off] = v & 0xff
}

const readWord = (rt: Runtime, a: number): number => (readByte(rt, a) << 8) | readByte(rt, a + 1)
const readLong = (rt: Runtime, a: number): number =>
  ((readWord(rt, a) << 16) | readWord(rt, a + 2)) >>> 0

function writeWord(rt: Runtime, a: number, v: number): void {
  writeByte(rt, a, v >> 8)
  writeByte(rt, a + 1, v)
}

function writeLong(rt: Runtime, a: number, v: number): void {
  writeWord(rt, a, v >>> 16)
  writeWord(rt, a + 2, v)
}

/* ------------------------------------------------------------------ *
 * the pool
 * ------------------------------------------------------------------ */

/**
 * `$2f6` — a fresh block, and it is an exec memory pool spelled out.
 *
 * `AllocMem(blockSize, MEMF_CLEAR)` for the size at bank+12, then a MemHeader
 * is built INSIDE it at `block - $e` (so `mh_First`, `mh_Lower`, `mh_Upper`
 * and `mh_Free` land at block+2, +6, +$a and +$e), the chain link goes at
 * block+$12, and the one initial MemChunk at block+$18 covers `size - $20`
 * bytes. `ELST_New` then calls exec's `Allocate` against that header, so
 * every instance address is first-fit into an eight-byte-grained free list,
 * and `ELST_Free` calls `Deallocate`, which coalesces.
 *
 * That is why the guide's warning is worth heeding — "Once freed the memory
 * may be used by another structure ... it is possible that the new structure
 * does not begin at the same address as the old" — and it is why the port
 * models the free list rather than handing out fresh addresses: reuse after a
 * free is observable, and programs written against this library depend on
 * nothing else.
 *
 * The first usable offset is $18 and the initial run is `size - $20`, both
 * from the 68k; the eight bytes between them are the slack `mh_Free` claims
 * and the chunk never covers.
 *
 * DEVIATION: `Runtime.EXT_DATA_SLOT` is 64K, so a definitions bank asking for
 * a larger block would have one running into its neighbour's addresses.
 * Blocks are capped at the slot size. Both sizes the guide documents ($2000
 * and $4000) are far below it.
 */
function newBlock(rt: Runtime, pool: ElstPool, bank: Uint8Array): ElstBlock {
  const size = Math.min(be32(bank, 12), Runtime.EXT_DATA_SLOT)
  if (size <= 0x20) throw new ElstError(ERR_NO_MEM)
  const data = new Uint8Array(size)
  const base = rt.extBlockBase(`easylife-structs-${pool.blocks.length}`, data)
  const block: ElstBlock = { base, data, free: [{ at: 0x18, len: size - 0x20 }] }
  pool.blocks.push(block)
  return block
}

/** exec's `Allocate`: first fit over the chunk list, rounded to eight bytes */
function allocate(rt: Runtime, pool: ElstPool, bank: Uint8Array, bytes: number): number {
  const need = (bytes + 7) & ~7
  const take = (b: ElstBlock): number | null => {
    for (let i = 0; i < b.free.length; i++) {
      const run = b.free[i]!
      if (run.len < need) continue
      const at = run.at
      run.at += need
      run.len -= need
      if (run.len === 0) b.free.splice(i, 1)
      return (b.base + at) >>> 0
    }
    return null
  }
  for (const b of pool.blocks) {
    const at = take(b)
    if (at !== null) return at
  }
  const at = take(newBlock(rt, pool, bank))
  if (at === null) throw new ElstError(ERR_NO_MEM)
  return at
}

/** exec's `Deallocate`: put the run back and coalesce with its neighbours */
function deallocate(block: ElstBlock, off: number, bytes: number): void {
  const len = (bytes + 7) & ~7
  let i = 0
  while (i < block.free.length && (block.free[i]?.at ?? 0) < off) i++
  block.free.splice(i, 0, { at: off, len })
  for (let k = block.free.length - 1; k > 0; k--) {
    const prev = block.free[k - 1]!
    const cur = block.free[k]!
    if (prev.at + prev.len === cur.at) {
      prev.len += cur.len
      block.free.splice(k, 1)
    }
  }
}

/** the block an address falls in — `$166`'s walk of the chain */
function blockOf(pool: ElstPool, addr: number): ElstBlock | null {
  for (const b of pool.blocks) {
    if (addr >= b.base && addr < b.base + b.data.length) return b
  }
  return null
}

/**
 * `$25a ELST_New(type = d0, flags = d1)`.
 *
 * Looks the type up under scope 0, allocates the definition's size, writes
 * the type word and a zero flags word, and — only when the flag is exactly
 * `MEMF_CLEAR` — zeroes `size/4 - 1` longwords from offset 4. `St New` always
 * passes `MEMF_CLEAR`; `ELST_LoadTree` passes 0 because it is about to read
 * the body off disk. That zeroing is the whole of the guide's initialisation
 * table: a ranged integer is stored biased by its minimum, so all-bits-zero
 * IS its lowest legal value, which is why the guide can promise "a very fast
 * initialization" and still say ranged integers start at their minimum.
 */
export function newInstance(rt: Runtime, pool: ElstPool, type: number, clear: boolean): number {
  const bank = typeTable(rt)
  const def = structDef(bank, lookup(bank, type, 0))
  const at = allocate(rt, pool, bank, def.size)
  writeWord(rt, at, type)
  writeWord(rt, at + 2, 0)
  if (clear) {
    for (let o = 4; o + 4 <= def.size; o += 4) writeLong(rt, at + o, 0)
  }
  pool.live++
  return at
}

/**
 * `$166 ELST_Free(instance = d0)`.
 *
 * Fetches the bank (AMOS 36 if it has gone), looks the instance's type up to
 * get its size, then walks the block chain for the block that contains the
 * address and `Deallocate`s it there. An address in no block is AMOS 23 —
 * which is also what a program gets for freeing something twice, since the
 * second call still finds a block and still succeeds. Only an address
 * outside every block is refused.
 */
export function freeInstance(rt: Runtime, pool: ElstPool, inst: number): void {
  const bank = typeTable(rt)
  const def = structDef(bank, lookup(bank, readWord(rt, inst), 0))
  const block = blockOf(pool, inst >>> 0)
  if (!block) throw new ElstError(ERR_FUNC_CALL)
  deallocate(block, (inst >>> 0) - block.base, def.size)
  pool.live--
}

/**
 * `$59c ELST_FreeBlocks(mode = d0)` — `St Free All`.
 *
 * Walks the chain FreeMem-ing each block, then zeroes `$f8`, `$f4` and `$f0`.
 *
 * NOTE: the `mode` argument is documented and unused — `move.l $f8(a6),d1`
 * overwrites d0's caller value before anything reads it, and `St Free All`
 * passes 0 anyway. The blocks themselves stay registered as ext-data slots
 * here, because an address handed to `Runtime.extBlockBase` is fixed for the
 * run; they are emptied instead, which is what a program can observe.
 */
export function freeBlocks(pool: ElstPool): void {
  for (const b of pool.blocks) {
    b.data.fill(0)
    b.free = [{ at: 0x18, len: b.data.length - 0x20 }]
  }
  pool.live = 0
}

/* ------------------------------------------------------------------ *
 * the typed-field engine
 * ------------------------------------------------------------------ */

/**
 * `$3be ELST_GetElement` and its twelve-arm jump table at $3f4.
 *
 * Returns the raw d0 each arm leaves. Every read is ZERO-extended, which is
 * not an accident of this port: d0 holds the jump table's word offset when
 * the arm is entered, and every one of those is below $100, so a `move.w` or
 * `move.b` into it leaves the bits above clean.
 *
 * NOTE: a Real Number element (type 6) is read as a raw longword and returned
 * through routine 260's `moveq #$0,d2` — AMOS's integer type. `St Set`'s
 * value slot is an integer slot too, so a real element can only ever be
 * written and read as the bit pattern it holds. The guide's "returned as an
 * AMOS integer / real number (Depending on element type)" describes an
 * intention the code does not carry out.
 */
export function getElement(rt: Runtime, r: Resolved): number {
  const bank = typeTable(rt)
  const { def, index, inst } = r
  const at = (inst + def.offset) >>> 0
  const min = (): number => be32(bank, def.extra) | 0
  switch (def.type) {
    case ST_LONG:
    case ST_POINTER:
    case ST_TYPED_POINTER:
      return readLong(rt, at + index * 4) | 0
    case ST_RANGED_LONG:
      return (readLong(rt, at + index * 4) + min()) | 0
    case ST_WORD:
      return readWord(rt, at + index * 2)
    case ST_RANGED_WORD:
      return (readWord(rt, at + index * 2) + min()) | 0
    case ST_BYTE:
      return readByte(rt, at + index)
    case ST_RANGED_BYTE:
      return (readByte(rt, at + index) + min()) | 0
    case ST_REAL:
      // $42e: no bias, and no conversion either
      return readLong(rt, at + index * 4) | 0
    case ST_BOOLEAN: {
      // $436: the bit index is the descriptor's byte plus the flat index, and
      // `btst Dn,<mem>` takes the bit modulo 8 while the byte comes from an
      // ARITHMETIC shift of the same value
      const bit = ((bank[def.extra] ?? 0) + index) | 0
      const byte = readByte(rt, at + (bit >> 3))
      return (byte >> (bit & 7)) & 1 ? -1 : 0
    }
    case ST_STRING:
      // $44a: stride maxlen+2, and the answer points PAST the length word,
      // at the NUL-terminated characters
      return (at + index * (be16(bank, def.extra) + 2) + 2) | 0
    case ST_SUBSTRUCT: {
      // $458: the address of the sub-structure, and the arm WRITES its type
      // word and a flags word of 1 into it on the way past. That flag is what
      // stops `ELST_TreeScan` from ever following a pointer into it.
      const size = be16(bank, def.extra)
      const sub = (at + index * size) >>> 0
      writeWord(rt, sub, be16(bank, def.extra + 2))
      writeWord(rt, sub + 2, 1)
      return sub | 0
    }
    default:
      throw new ElstError(ERR_FUNC_CALL)
  }
}

/**
 * `$46a ELST_SetElement` and its twelve-arm jump table at $49a.
 *
 * A ranged integer is stored BIASED — `sub.l (a0)+,d6` first, then the bound
 * check against `(max - min)` — which is what makes an all-zero instance read
 * back as each ranged element's minimum.
 *
 * The two range branches are `bmi` for the low end and `beq / bcc` for the
 * high, so a value exactly equal to the maximum is accepted and one above it
 * is not.
 */
export function setElement(rt: Runtime, r: Resolved, value: number): void {
  const bank = typeTable(rt)
  const { def, index, inst } = r
  const at = (inst + def.offset) >>> 0
  /** the two checks $4b2, $4c8 and $4de share, in their order */
  const ranged = (): number => {
    const v = (value - (be32(bank, def.extra) | 0)) | 0
    if (v < 0) throw new ElstError(ERR_UNDER)
    const span = be32(bank, def.extra + 4) | 0
    if (v !== span && v >>> 0 >= span >>> 0) throw new ElstError(ERR_OVER)
    return v
  }
  switch (def.type) {
    case ST_LONG:
    case ST_REAL:
    case ST_POINTER:
      writeLong(rt, at + index * 4, value)
      return
    case ST_RANGED_LONG:
      writeLong(rt, at + index * 4, ranged())
      return
    case ST_WORD:
      writeWord(rt, at + index * 2, value)
      return
    case ST_RANGED_WORD:
      writeWord(rt, at + index * 2, ranged())
      return
    case ST_BYTE:
      writeByte(rt, at + index, value)
      return
    case ST_RANGED_BYTE:
      writeByte(rt, at + index, ranged())
      return
    case ST_TYPED_POINTER: {
      // $4f2: nil is always allowed; anything else must be an instance whose
      // type word matches the descriptor's, which is the only place in the
      // library that reads through a value on its way in
      if (value !== 0 && readWord(rt, value) !== be16(bank, def.extra)) {
        throw new ElstError(ERR_PTR_TYPE)
      }
      writeLong(rt, at + index * 4, value)
      return
    }
    case ST_BOOLEAN: {
      const bit = ((bank[def.extra] ?? 0) + index) | 0
      const a = at + (bit >> 3)
      const b = readByte(rt, a)
      writeByte(rt, a, value !== 0 ? b | (1 << (bit & 7)) : b & ~(1 << (bit & 7)))
      return
    }
    case ST_SUBSTRUCT:
      // $544 is `bra.w $a08` and nothing else
      throw new ElstError(ERR_SUBSTRUCT)
    default:
      throw new ElstError(ERR_FUNC_CALL)
  }
}

/**
 * `$522` — the string arm, which is its own shape and worth stating.
 *
 * The AMOS string is `[length word][characters]`, and the copy is
 * `dbra d0` over `d0 = length + 2`, so it moves the length word AND the
 * characters, and then writes one NUL byte after them. That is length+3
 * bytes into an element whose stride is length+2.
 *
 * DEFECT: for a single string element the compiler leaves room — the guide's
 * size is "Max Len+3 rounded up to even" — so the NUL lands in the slack. For
 * an ARRAY of strings it does not: the stride the accessors use is maxlen+2
 * and the compiler's element size is maxlen+3 rounded up, so writing element
 * N puts its terminator into element N+1's length word. Reproduced, because
 * the port writes through the same address space the 68k would: the bytes
 * land where they land.
 */
export function setString(rt: Runtime, r: Resolved, s: string): void {
  const bank = typeTable(rt)
  const { def, index, inst } = r
  if (def.type !== ST_STRING) throw new ElstError(ERR_FUNC_CALL)
  const max = be16(bank, def.extra)
  if (max < s.length) throw new ElstError(ERR_STR_LONG)
  let at = ((inst + def.offset) >>> 0) + index * (max + 2)
  writeWord(rt, at, s.length)
  at += 2
  for (let i = 0; i < s.length; i++) writeByte(rt, at + i, s.charCodeAt(i) & 0xff)
  writeByte(rt, at + s.length, 0)
}

/** the characters of a string element, as `St Get$` copies them out */
export function getString(rt: Runtime, r: Resolved): string {
  if (r.def.type !== ST_STRING) throw new ElstError(ERR_FUNC_CALL)
  const at = getElement(rt, r)
  const len = readWord(rt, at - 2)
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(readByte(rt, at + i))
  return s
}

/**
 * `$548 ELST_StrCmp` — compare a string element against a string, in place.
 *
 * DEVIATION: from the guide, and it is a sign error the guide gets backwards.
 * The autodoc and the command page both say "-1 if STRING$ is less than the
 * element string". The code says the opposite: the byte comparison is
 * `cmpm.b (a0)+,(a1)+`, which on the 68k computes destination minus source —
 * argument minus element — and `blt` on that goes to the arm returning +1. The
 * length arms agree with it: an element that runs out first (so the element is
 * the shorter, and less) reaches `moveq #$ff,d0`, -1.
 *
 * So the result is the element compared against the string, not the string
 * against the element. Implemented as the binary has it.
 */
export function strCmp(rt: Runtime, r: Resolved, s: string): number {
  if (r.def.type !== ST_STRING) throw new ElstError(ERR_FUNC_CALL)
  const el = getString(rt, r)
  const n = Math.min(el.length, s.length)
  for (let i = 0; i < n; i++) {
    const d = s.charCodeAt(i) - el.charCodeAt(i)
    if (d !== 0) return d < 0 ? 1 : -1
  }
  if (el.length === s.length) return 0
  return el.length < s.length ? -1 : 1
}

/* ------------------------------------------------------------------ *
 * the graph: scan, save, load, relocate
 * ------------------------------------------------------------------ */

/**
 * `$5f8 ELST_TreeScan` and its recursive half `$670`.
 *
 * Breadth-first: the root goes into the list, and the read cursor chases the
 * write cursor until they meet. Each instance's POINTER elements sit at
 * offsets 4, 8, ... 4*n and each target is added unless its flags word is
 * already non-zero — which covers both "seen this round" (bit 1, set by the
 * scan) and "is a sub-structure" (bit 0, set by the getter). That second
 * reading is the guide's "If a pointer points to a sub-structure, the
 * sub-structure is not saved". The scan clears bit 1 again on the way out.
 *
 * DEFECT: the ROOT's flags word is never set — `move.l d3,(a1)` stores it
 * without marking it — so a cycle that comes back to the root appends the
 * root a second time. The guide promises "Each instance is only saved once"
 * and "It is OK if your graph contains cycles". Reproduced: a two-instance
 * ring saves three records.
 *
 * DEFECT: an ARRAY of sub-structures is walked as element zero, count+1
 * times. `dbra d5,$6bc` loops back onto the `bsr` without advancing a0, and
 * nothing between the two touches it. Reproduced, because it costs nothing to
 * be literal: the same address is rescanned, so nothing new is found and the
 * other elements of the array are never reached.
 */
export function treeScan(rt: Runtime, root: number): number[] {
  const bank = typeTable(rt)
  const list: number[] = [root >>> 0]
  const marked: number[] = []
  const scanOne = (inst: number, type: number): void => {
    const def = structDef(bank, lookup(bank, type, 0))
    for (let i = def.pointers; i >= 1; i--) {
      const p = readLong(rt, inst + 4 * i)
      if (p === 0) continue
      if (readWord(rt, p + 2) !== 0) continue
      writeWord(rt, p + 2, readWord(rt, p + 2) | 2)
      marked.push(p)
      list.push(p)
    }
    for (const sub of def.subs) {
      const at = (inst + sub.offset) >>> 0
      for (let k = 0; k <= sub.count; k++) scanOne(at, sub.id)
    }
  }
  for (let read = 0; read < list.length; read++) {
    const inst = list[read]!
    scanOne(inst, readWord(rt, inst))
  }
  for (const p of marked) writeWord(rt, p + 2, readWord(rt, p + 2) & ~2)
  return list
}

/**
 * `$6e8 ELST_SaveTree(root = d0, filename = d1)`.
 *
 * Twelve bytes of header — `"ElSt"`, the instance count, a zero — then, per
 * instance, its address at the time of saving followed by the whole instance
 * exactly as it sits in memory, its size taken from the definition. No length
 * is written: `ELST_LoadTree` deduces it from the type word.
 *
 * NOTE: the failure exits set d0 to 94 and 98, which routine 299 passes to
 * `L_Error` as AMOS error numbers — and those are "Next without For in
 * animation string" and "Instruction only valid in autotest". They are
 * plainly not the messages meant; the numbers are what the binary holds and
 * the port raises them unchanged, because the alternative is inventing an
 * error the extension cannot produce.
 */
export function saveTree(rt: Runtime, root: number): Uint8Array {
  const bank = typeTable(rt)
  const list = treeScan(rt, root)
  const parts: Uint8Array[] = []
  const head = new Uint8Array(12)
  new DataView(head.buffer).setUint32(0, ELST_MAGIC, false)
  new DataView(head.buffer).setUint32(4, list.length, false)
  parts.push(head)
  for (const inst of list) {
    const def = structDef(bank, lookup(bank, readWord(rt, inst), 0))
    const rec = new Uint8Array(4 + def.size)
    new DataView(rec.buffer).setUint32(0, inst >>> 0, false)
    for (let i = 0; i < def.size; i++) rec[4 + i] = readByte(rt, inst + i)
    parts.push(rec)
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** `$9cc` — what both `St Save` and `St Load` raise when Open() fails */
export const ELST_ERR_OPEN = ERR_OPEN

/**
 * `$7b4 ELST_LoadTree(filename = d0)` with `$8e4 ELST_RelocateTable` after it.
 *
 * Reads the header, allocates a new instance per record with `ELST_New` and
 * NO clear, reads the body over it, and then relocates: for every pointer
 * element of every new instance, the old address it holds is looked up in the
 * list of old addresses and replaced by the new address at the same position.
 * A pointer to something outside the file is left alone.
 *
 * Sub-structures are walked too, and the walk WRITES each one's type word back
 * (`move.w d2,(a0)`) before recursing — the loaded bytes carry whatever the
 * saving program's getter had left there.
 *
 * DEFECT: the same array-of-sub-structures bug as `treeScan`, from the same
 * shape — `dbra d7,$964` loops back onto the type-word write without
 * advancing a0. Reproduced.
 *
 * NOTE: a header claiming zero instances makes `subq.w #$1,d4` -1 and the
 * `dbra` below it wrap to 65536 passes. `ELST_SaveTree` cannot write one,
 * since `ELST_TreeScan` always returns at least the root, so the port refuses
 * it rather than modelling the wrap.
 */
export function loadTree(rt: Runtime, pool: ElstPool, file: Uint8Array): number {
  if (file.length < 12 || be32(file, 0) !== ELST_MAGIC) throw new ElstError(ERR_MAGIC)
  const count = be32(file, 4)
  if (count === 0 || count > 0xffff) throw new ElstError(ERR_MAGIC)
  const bank = typeTable(rt)
  const olds: number[] = []
  const news: number[] = []
  let at = 12
  for (let i = 0; i < count; i++) {
    if (at + 8 > file.length) throw new ElstError(ERR_OPEN)
    olds.push(be32(file, at))
    const type = be16(file, at + 4)
    const inst = newInstance(rt, pool, type, false)
    news.push(inst)
    const size = structDef(bank, lookup(bank, type, 0)).size
    for (let k = 4; k < size; k++) writeByte(rt, inst + k, file[at + 4 + k] ?? 0)
    at += 4 + size
  }
  relocate(rt, news, olds)
  return news[0] ?? 0
}

/** `$8e4` / `$90e` — the pointer fixup, over one list against the other */
function relocate(rt: Runtime, news: readonly number[], olds: readonly number[]): void {
  const bank = typeTable(rt)
  const walk = (inst: number, type: number): void => {
    const def = structDef(bank, lookup(bank, type, 0))
    for (let i = def.pointers; i >= 1; i--) {
      const old = readLong(rt, inst + 4 * i)
      if (old === 0) continue
      const k = olds.indexOf(old)
      if (k >= 0) writeLong(rt, inst + 4 * i, news[k] ?? 0)
    }
    for (const sub of def.subs) {
      const at = (inst + sub.offset) >>> 0
      for (let n = 0; n <= sub.count; n++) {
        writeWord(rt, at, sub.id)
        walk(at, sub.id)
      }
    }
  }
  for (const inst of news) walk(inst, readWord(rt, inst))
}

/**
 * `$97a`, LVO -108 — `St Erase`. Scan the graph, free every instance in it,
 * release the list. The extension gives it no name in the autodoc's list.
 */
export function eraseTree(rt: Runtime, pool: ElstPool, root: number): void {
  for (const inst of treeScan(rt, root)) freeInstance(rt, pool, inst)
}

/**
 * `St Output$`'s payload: the instance's `size` bytes, type word first.
 *
 * DEFECT: and it is the reason this is stated as an intention rather than as
 * a transcription. Routine 270 ($38f8) is broken twice over, identically in
 * 1.09 and 1.10, so it is not a 1.10 regression:
 *
 *   - `$38fc` is `3012`, `move.w (a2),d0` — it reads the type it is about to
 *     look up out of a2, which nothing in the routine loads. Routine 271
 *     does the same job two instructions later with `3610`, `move.w (a0),d3`,
 *     off the pointer it actually popped.
 *   - after the lookup, `$3914` puts the DEFINITION in a2 and every read
 *     after it is `(a2)+` — `move.w (a2)+,d0` for the string's length word
 *     and `move.l (a2)+,(a1)+` for the body. The instance popped into a0 is
 *     never read at all, so the string carries bank 12's definition, and its
 *     length word is the high half of the definition's size longword.
 *
 * The second one cannot be squared with any register assignment: routine 269
 * checks the string's length against the definition's size and its first word
 * against the instance's type, and no reading of 270 produces either. The
 * pair does not round-trip on a real Amiga, and there is no behaviour to
 * reproduce that a caller could tell from a crash — the guide's "This command
 * returns a copy of the structure instance in a string" is implemented
 * instead, and this is the record.
 */
export function instanceBytes(rt: Runtime, inst: number, size: number): string {
  let s = ''
  for (let i = 0; i < size; i++) s += String.fromCharCode(readByte(rt, inst + i))
  return s
}

/** the inverse, for `St Input`, whose own checks routine 269 does make */
export function putInstanceBytes(rt: Runtime, inst: number, s: string): void {
  for (let i = 0; i < s.length; i++) writeByte(rt, inst + i, s.charCodeAt(i) & 0xff)
}

export { readWord as elstReadWord, readLong as elstReadLong, writeLong as elstWriteLong }
