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
import { BinReader } from './binreader'

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
export function loadHunks(bytes: Uint8Array, base = 0x0021_0000): LoadedHunks {
  const r = new BinReader(bytes)
  if (r.u32() !== HUNK_HEADER) throw new Error('not an Amiga hunk file')
  // resident library names: a list of length-prefixed strings, zero-terminated
  for (let len = r.u32(); len !== 0; len = r.u32()) r.skip(len * 4)
  const tableSize = r.u32()
  const first = r.u32()
  const last = r.u32()
  if (last < first || tableSize === 0) throw new Error('bad hunk header')
  const sizes: number[] = []
  for (let i = first; i <= last; i++) sizes.push((r.u32() & 0x0fff_ffff) * 4)

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
