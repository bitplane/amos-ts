/**
 * ADF (Amiga Disk File) reader — the raw sector image of an Amiga floppy,
 * holding an OFS or FFS filesystem.
 *
 * Most surviving AMOS material is in this form: coverdisks, the AMOS PD
 * library's own disks, the diskzines (Amoszine, Totally AMOS), and anything
 * that arrived as DMS, which decompresses to exactly this. Reading it directly
 * means a `.adf` can be dropped into the browser and mounted as a volume the
 * way a zip already is.
 *
 * ## Layout
 *
 * The image is headerless — a plain run of 512-byte blocks, identified by its
 * size (880K = 901,120 bytes = 1760 blocks). The boot block carries `DOS` plus
 * a flags byte, and the root block sits at the physical middle of the disk.
 *
 * A directory (root or subdirectory) holds a hash table of 72 longs at offset
 * 24. Each entry is a block number; entries whose names collide are chained
 * through the `hash_chain` long at offset 496. Every header block ends with a
 * secondary type at offset 508: 2 for a directory, -3 for a file.
 *
 * A file header lists its data blocks in a table at offsets 24..308, filled
 * **backwards** — offset 308 is the first data block, 304 the second, and so
 * on for `high_seq` entries. Files needing more than 72 blocks chain further
 * tables through the `extension` long at offset 504. (Verified against
 * Totally AMOS issue 1: header block 891, high_seq 18, first_data 687, and
 * the table holding 687 down to 670 in descending order.)
 *
 * The two filesystems differ only in the data blocks. OFS puts a 24-byte
 * header on each, leaving 488 usable bytes and recording the real length;
 * FFS uses all 512 bytes as data, so the length comes from the file size.
 */
/**
 * One file read out of the image.
 *
 * Structurally identical to `ArchiveEntry` in ../runtime/archive.ts, and
 * declared here rather than imported from it because that import was a cycle
 * — archive.ts imports this module back — and pointed the wrong way besides:
 * a filesystem does not depend on the caller that happens to mount it.
 */
export interface AdfFile {
  path: string
  data: Uint8Array
}

const BSIZE = 512
/** longs 6..77 of a header block: the hash table / data block table */
const TABLE_START = 24
const TABLE_END = 308
/**
 * The table holds 72 longs — (512/4) - 56 — at offsets 24 to 308 *inclusive*,
 * so 308 is the last slot and not a limit to stop before. A directory walk
 * that treats it as exclusive loses every name that hashes to slot 71, which
 * is silent: the file is simply absent from the listing. (Found on a real
 * disk, where `thrusts.info` hashed there and vanished.)
 */
const TABLE_SLOTS = 72
/** offsets from the start of a header block */
const OFF = {
  type: 0,
  headerKey: 4,
  highSeq: 8,
  firstData: 16,
  byteSize: 324,
  nameLen: 432,
  hashChain: 496,
  parent: 500,
  extension: 504,
  secType: 508,
} as const

const T_HEADER = 2
const T_DATA = 8
const ST_ROOT = 1
const ST_USERDIR = 2
const ST_FILE = -3

export interface AdfInfo {
  /** volume label from the root block */
  label: string
  /** 'OFS' or 'FFS' — the boot block's flags bit 0 */
  filesystem: 'OFS' | 'FFS'
  /** international case folding (bit 1) and directory cache (bit 2) */
  intl: boolean
  dirCache: boolean
  blocks: number
}

/** the known Amiga floppy geometries, all headerless and told apart by size */
const SIZES = new Set([901_120, 912_384, 1_802_240])

/** Does this look like an Amiga disk image? */
export function isAdf(bytes: Uint8Array): boolean {
  if (!SIZES.has(bytes.length)) return false
  return bytes[0] === 0x44 && bytes[1] === 0x4f && bytes[2] === 0x53 // "DOS"
}

class Adf {
  readonly view: DataView
  readonly blocks: number
  readonly ffs: boolean
  readonly intl: boolean
  readonly dirCache: boolean

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.blocks = Math.floor(bytes.length / BSIZE)
    const flags = bytes[3] ?? 0
    this.ffs = (flags & 1) !== 0
    this.intl = (flags & 2) !== 0
    this.dirCache = (flags & 4) !== 0
  }

  u32(block: number, off: number): number {
    return this.view.getUint32(block * BSIZE + off, false)
  }

  i32(block: number, off: number): number {
    return this.view.getInt32(block * BSIZE + off, false)
  }

  /** the BCPL-style string at `off`: a length byte followed by the bytes */
  name(block: number, off: number): string {
    const base = block * BSIZE + off
    const len = Math.min(this.bytes[base] ?? 0, 30)
    let s = ''
    for (let i = 1; i <= len; i++) s += String.fromCharCode(this.bytes[base + i]!)
    return s
  }

  valid(block: number): boolean {
    return block > 0 && block < this.blocks
  }
}

/** every data block of a file, in order, following the extension chain */
function dataBlocks(a: Adf, header: number): number[] {
  const out: number[] = []
  let block = header
  const seen = new Set<number>()
  while (a.valid(block) && !seen.has(block)) {
    seen.add(block)
    const highSeq = a.u32(block, OFF.highSeq)
    // the table is filled backwards from TABLE_END, one long per data block
    for (let i = 0; i < highSeq && i <= (TABLE_END - TABLE_START) / 4; i++) {
      const n = a.u32(block, TABLE_END - i * 4)
      if (a.valid(n)) out.push(n)
    }
    block = a.u32(block, OFF.extension)
  }
  return out
}

function readFile(a: Adf, header: number): Uint8Array {
  const size = a.u32(header, OFF.byteSize)
  const out = new Uint8Array(size)
  let pos = 0
  for (const b of dataBlocks(a, header)) {
    if (pos >= size) break
    // OFS data blocks carry a 24-byte header and their own length; FFS
    // blocks are pure data, so the file size is the only bound
    const dataOff = a.ffs ? 0 : 24
    const avail = a.ffs ? BSIZE : Math.min(a.u32(b, 12), BSIZE - 24)
    if (!a.ffs && a.u32(b, 0) !== T_DATA) continue // not a data block; skip rather than trust it
    const n = Math.min(avail, size - pos)
    out.set(a.bytes.subarray(b * BSIZE + dataOff, b * BSIZE + dataOff + n), pos)
    pos += n
  }
  return out
}

/**
 * Read an ADF into flat path/data entries, the same shape the zip and tar
 * readers produce, so it drops into `volumeFromEntries` unchanged.
 *
 * Unreadable or unrecognised entries are skipped rather than throwing: these
 * are thirty-year-old floppy images and a single bad block should not cost the
 * rest of the disk. Soft links and hard links are skipped too — they carry no
 * data of their own.
 */
export function readAdf(bytes: Uint8Array): AdfFile[] {
  if (!isAdf(bytes)) throw new Error('not an Amiga disk image')
  const a = new Adf(bytes)
  const root = Math.floor(a.blocks / 2)
  if (a.u32(root, OFF.type) !== T_HEADER || a.i32(root, OFF.secType) !== ST_ROOT) {
    throw new Error('no Amiga root block — image may be non-DOS or damaged')
  }

  const out: AdfFile[] = []
  const visited = new Set<number>()

  const walk = (dir: number, prefix: string): void => {
    if (visited.has(dir)) return // a corrupt disk can loop
    visited.add(dir)
    for (let slot = 0; slot < TABLE_SLOTS; slot++) {
      const off = TABLE_START + slot * 4
      let block = a.u32(dir, off)
      // follow the collision chain for this hash slot
      while (a.valid(block) && !visited.has(block)) {
        const secType = a.i32(block, OFF.secType)
        const name = a.name(block, OFF.nameLen)
        const path = prefix === '' ? name : `${prefix}/${name}`
        if (secType === ST_USERDIR) {
          walk(block, path)
        } else if (secType === ST_FILE) {
          visited.add(block)
          try {
            out.push({ path, data: readFile(a, block) })
          } catch {
            /* skip an unreadable file, keep the rest of the disk */
          }
        } else {
          visited.add(block) // links and anything unrecognised
        }
        block = a.u32(block, OFF.hashChain)
      }
    }
  }

  walk(root, '')
  return out
}

/** Volume label and filesystem flags, without reading any file data. */
export function adfInfo(bytes: Uint8Array): AdfInfo {
  const a = new Adf(bytes)
  const root = Math.floor(a.blocks / 2)
  return {
    label: a.name(root, OFF.nameLen),
    filesystem: a.ffs ? 'FFS' : 'OFS',
    intl: a.intl,
    dirCache: a.dirCache,
    blocks: a.blocks,
  }
}
