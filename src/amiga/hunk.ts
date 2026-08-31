/**
 * AmigaDOS hunk files, loaded and relocated.
 *
 * `firstCodeHunk` in ./libtok handles the one case AMOS extensions need — a
 * single code hunk, read where it lies. AMOS 3D's engine is not that: it is a
 * linked C program, 29 hunks with cross-hunk RELOC32 entries, and nothing in
 * it can be read until the relocations are applied. So this is the real
 * loader: place each hunk at an address, walk the relocation tables, and hand
 * back one flat image with a map of where each hunk landed.
 *
 * Layout follows the RKRM's "AmigaDOS Object File Format": HUNK_HEADER gives
 * the hunk count and a size table, then each hunk is a type long, a length in
 * longs, the contents, and any number of relocation/symbol/debug blocks
 * before HUNK_END.
 */
import { BinReader } from '../loader/binreader'

export const HUNK_UNIT = 0x3e7
export const HUNK_NAME = 0x3e8
export const HUNK_CODE = 0x3e9
export const HUNK_DATA = 0x3ea
export const HUNK_BSS = 0x3eb
export const HUNK_RELOC32 = 0x3ec
export const HUNK_RELOC16 = 0x3ed
export const HUNK_RELOC8 = 0x3ee
export const HUNK_EXT = 0x3ef
export const HUNK_SYMBOL = 0x3f0
export const HUNK_DEBUG = 0x3f1
export const HUNK_END = 0x3f2
export const HUNK_HEADER = 0x3f3
export const HUNK_OVERLAY = 0x3f5
export const HUNK_BREAK = 0x3f6
export const HUNK_DREL32 = 0x3f7

export interface Hunk {
  index: number
  kind: 'code' | 'data' | 'bss'
  /** where this hunk was placed in the flat image */
  base: number
  /** allocated length in bytes (BSS hunks have content shorter than this) */
  length: number
  /** RELOC32 entries: offset within this hunk -> hunk it points into */
  relocs: Array<{ offset: number; target: number }>
}

export interface LoadedHunks {
  /** the flat image, every hunk placed and every RELOC32 applied */
  image: Uint8Array
  hunks: Hunk[]
  /** the address the image starts at, i.e. hunks[0].base */
  base: number
}

/** round up to the next multiple of four */
const align4 = (n: number): number => (n + 3) & ~3

/**
 * Load a hunk file and relocate it into one contiguous image.
 *
 * `base` is where hunk 0 goes. It only has to be somewhere the 32-bit
 * relocated pointers can be told apart from small integers; the default is
 * high enough to be obvious in a disassembly and low enough to stay positive.
 */
/**
 * The header, up to and including the size table — the part every reader of
 * this format needs and the part that used to be written out three times.
 *
 * The size table gives the space each hunk is ALLOCATED. That is not the same
 * as the number of bytes stored for it: a HUNK_CODE block carries its own
 * length, and a hunk may be allocated more than it stores, the remainder being
 * implicitly zero. Both numbers are kept below, because callers want different
 * ones — a loader wants the allocation, a reader of a single hunk's contents
 * wants what was actually stored.
 */
function readHeader(r: BinReader): number[] {
  if (r.u32() !== HUNK_HEADER) throw new Error('not an Amiga hunk file')
  // resident library names: a list of length-prefixed strings, zero-terminated
  for (let len = r.u32(); len !== 0; len = r.u32()) r.skip(len * 4)
  const tableSize = r.u32()
  const first = r.u32()
  const last = r.u32()
  if (last < first || tableSize === 0) throw new Error('bad hunk header')
  const sizes: number[] = []
  for (let i = first; i <= last; i++) sizes.push((r.u32() & 0x0fff_ffff) * 4)
  return sizes
}

/**
 * The contents of the first code hunk, as stored — no relocation, no copy.
 *
 * This is what a reader of a LIBRARY wants rather than a loader: AMOS
 * extensions are a single code hunk whose token table is read where it lies,
 * and `parseAmosLib` then indexes into the returned view.
 *
 * It deliberately stops after that hunk's contents and never looks at the
 * trailing relocation, symbol or debug blocks. `loadHunks` must parse those to
 * completion and throws on anything it does not recognise, which is right for
 * a loader and wrong here — the library tools (`libcat`, `libpool`, `genext`)
 * run over user-supplied `.Lib` files from outside the fixture set, where
 * being able to read the table out of a slightly odd file is the whole job.
 *
 * WIDENED relative to the version this replaces: that one rejected any file
 * carrying a resident library name list, where `readHeader` skips it properly.
 * Strictly more permissive, so no file that parsed before parses differently.
 */
export function firstCodeHunk(bytes: Uint8Array): Uint8Array {
  const r = new BinReader(bytes)
  readHeader(r)
  const type = r.u32() & 0x0fff_ffff
  if (type !== HUNK_CODE) throw new Error(`expected first hunk to be code, got $${type.toString(16)}`)
  return r.raw(r.u32() * 4)
}

export function loadHunks(bytes: Uint8Array, base = 0x0021_0000): LoadedHunks {
  const r = new BinReader(bytes)
  const sizes = readHeader(r)

  // place them, in order, four-byte aligned
  const hunks: Hunk[] = []
  let at = base
  for (const [i, size] of sizes.entries()) {
    hunks.push({ index: i, kind: 'bss', base: at, length: size, relocs: [] })
    at = align4(at + size)
  }
  const image = new Uint8Array(at - base)

  // read the body of each hunk
  for (let i = 0; i < sizes.length; i++) {
    const h = hunks[i]!
    let type = r.u32() & 0x0fff_ffff
    if (type === HUNK_NAME) {
      r.skip(r.u32() * 4)
      type = r.u32() & 0x0fff_ffff
    }
    if (type === HUNK_CODE || type === HUNK_DATA) {
      h.kind = type === HUNK_CODE ? 'code' : 'data'
      const contents = r.raw(r.u32() * 4)
      image.set(contents, h.base - base)
    } else if (type === HUNK_BSS) {
      h.kind = 'bss'
      r.u32() // length in longs; the contents are implicitly zero
    } else {
      throw new Error(`hunk ${i}: expected code/data/bss, got $${type.toString(16)}`)
    }
    // trailing blocks until HUNK_END
    for (;;) {
      const blk = r.u32() & 0x0fff_ffff
      if (blk === HUNK_END) break
      if (blk === HUNK_RELOC32 || blk === HUNK_DREL32) {
        for (let count = r.u32(); count !== 0; count = r.u32()) {
          const target = r.u32()
          for (let k = 0; k < count; k++) h.relocs.push({ offset: r.u32(), target })
        }
      } else if (blk === HUNK_SYMBOL) {
        for (let len = r.u32(); len !== 0; len = r.u32()) {
          r.skip(len * 4)
          r.u32() // value
        }
      } else if (blk === HUNK_DEBUG || blk === HUNK_NAME) {
        r.skip(r.u32() * 4)
      } else if (blk === HUNK_RELOC16 || blk === HUNK_RELOC8) {
        throw new Error(`hunk ${i}: short relocations are not supported`)
      } else {
        throw new Error(`hunk ${i}: unexpected block $${blk.toString(16)}`)
      }
    }
  }

  // apply the relocations now every hunk has an address
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength)
  for (const h of hunks) {
    for (const { offset, target } of h.relocs) {
      const to = hunks[target]
      if (!to) throw new Error(`hunk ${h.index}: relocation into missing hunk ${target}`)
      const at2 = h.base - base + offset
      view.setUint32(at2, (view.getUint32(at2, false) + to.base) >>> 0, false)
    }
  }
  return { image, hunks, base }
}

/** read a relocated 32-bit pointer out of a loaded image, as an address */
export function readPtr(l: LoadedHunks, address: number): number {
  const off = address - l.base
  if (off < 0 || off + 4 > l.image.length) throw new Error(`address $${address.toString(16)} is outside the image`)
  return new DataView(l.image.buffer, l.image.byteOffset, l.image.byteLength).getUint32(off, false) >>> 0
}

/** which hunk an address falls in, or null */
export function hunkAt(l: LoadedHunks, address: number): Hunk | null {
  return l.hunks.find((h) => address >= h.base && address < h.base + h.length) ?? null
}
