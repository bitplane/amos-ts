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
import type { DirEntry, FileMeta, Volume } from './vfs'
import { MAX_COMMENT, ST_FILE, ST_ROOT, ST_USERDIR } from './dos'

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
/**
 * Offsets from the start of a header block.
 *
 * A file header and a user directory block share their tail: the protection
 * long, the FileNote, the DateStamp and the name all sit at the same place in
 * both, which is why one set of offsets serves for either. `byteSize` is the
 * exception — only a file has one, and a directory block leaves it zero.
 */
const OFF = {
  type: 0,
  headerKey: 4,
  highSeq: 8,
  firstData: 16,
  protect: 320,
  byteSize: 324,
  comment: 328,
  days: 420,
  mins: 424,
  ticks: 428,
  nameLen: 432,
  hashChain: 496,
  parent: 500,
  extension: 504,
  secType: 508,
} as const

/**
 * The FileNote is a BCPL string too, but 79 characters rather than 30 — the
 * same 79 `fib_Comment` holds, because this block is what Examine copies it
 * out of.
 */
const COMMENT_MAX = MAX_COMMENT
const NAME_MAX = 30

const T_HEADER = 2
const T_DATA = 8
/*
 * The secondary type at offset 508 is the SAME numbering as
 * `fib_DirEntryType`, and not by coincidence: Examine reports what the header
 * block says. ST_ROOT, ST_USERDIR and ST_FILE come from ./dos.ts rather than
 * being declared a third time — this file had its own copies, LDos had named
 * ones and JD wrote the bare numbers.
 */

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
  name(block: number, off: number, max: number = NAME_MAX): string {
    const base = block * BSIZE + off
    const len = Math.min(this.bytes[base] ?? 0, max)
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
  return infoOf(a, Math.floor(a.blocks / 2))
}

function infoOf(a: Adf, root: number): AdfInfo {
  return {
    label: a.name(root, OFF.nameLen),
    filesystem: a.ffs ? 'FFS' : 'OFS',
    intl: a.intl,
    dirCache: a.dirCache,
    blocks: a.blocks,
  }
}

/** the block a name in some directory points at */
interface AdfNode {
  name: string
  block: number
  isDir: boolean
  size: number
}

/**
 * The image mounted as a volume: read on demand, and carrying the metadata
 * the flat `readAdf` path throws away.
 *
 * `readAdf` exists for callers that want the whole disk as bytes — the
 * extractor, and the tests. Everything else should mount this instead, for
 * two reasons.
 *
 * ONE, it keeps what the disk actually says. A flat `{path, data}` pair has
 * nowhere to put the volume label, the protection bits, the FileNote or the
 * DateStamp, so mounting a flattened ADF meant `Dir$`, `Jd Protection` and
 * LDos's whole metadata family answering with `defaultMeta()`'s zeros for a
 * disk that has real values sitting in its header blocks. The label matters
 * most: it is the name the disk was called, and a program written to load
 * `MyDisk:data/pic.iff` cannot find a volume mounted under a mangled host
 * filename.
 *
 * TWO, it reads a file when a file is asked for. Flattening decompresses the
 * entire disk up front and then holds a second copy of it in a MemoryVolume;
 * an 880K image where the program wants one 12K picture paid for all of it.
 * Directory blocks are still walked eagerly — they are one block each and the
 * listing has to exist to resolve a path — but data blocks are not touched
 * until `read`.
 *
 * Read-only, which `Volume` already expects: writes land in
 * `AmigaFS.overlay` with a tombstone, so a program can happily save over a
 * file on a mounted floppy without the image changing.
 */
export class AdfVolume implements Volume {
  private readonly a: Adf
  private readonly rootBlock: number
  /** directory listings, memoised by block — a disk is walked once */
  private readonly listings = new Map<number, Map<string, AdfNode>>()
  readonly info: AdfInfo

  constructor(bytes: Uint8Array) {
    if (!isAdf(bytes)) throw new Error('not an Amiga disk image')
    this.a = new Adf(bytes)
    this.rootBlock = Math.floor(this.a.blocks / 2)
    if (this.a.u32(this.rootBlock, OFF.type) !== T_HEADER || this.a.i32(this.rootBlock, OFF.secType) !== ST_ROOT) {
      throw new Error('no Amiga root block — image may be non-DOS or damaged')
    }
    this.info = infoOf(this.a, this.rootBlock)
  }

  /** the disk's own name, from the root block — what it should be mounted as */
  get label(): string {
    return this.info.label
  }

  /** one directory's entries, hash table plus collision chains */
  private listing(dir: number): Map<string, AdfNode> {
    const hit = this.listings.get(dir)
    if (hit) return hit
    const out = new Map<string, AdfNode>()
    this.listings.set(dir, out) // before walking: a corrupt disk can loop back
    const seen = new Set<number>([dir])
    for (let slot = 0; slot < TABLE_SLOTS; slot++) {
      let block = this.a.u32(dir, TABLE_START + slot * 4)
      while (this.a.valid(block) && !seen.has(block)) {
        seen.add(block)
        const secType = this.a.i32(block, OFF.secType)
        // links and anything unrecognised are skipped, as in readAdf: they
        // carry no data of their own
        if (secType === ST_USERDIR || secType === ST_FILE) {
          const isDir = secType === ST_USERDIR
          out.set(this.a.name(block, OFF.nameLen).toLowerCase(), {
            name: this.a.name(block, OFF.nameLen),
            block,
            isDir,
            size: isDir ? 0 : this.a.u32(block, OFF.byteSize),
          })
        }
        block = this.a.u32(block, OFF.hashChain)
      }
    }
    return out
  }

  /** the block of the directory `segs` names, or null if it is not one */
  private dirBlock(segs: string[]): number | null {
    let block = this.rootBlock
    for (const seg of segs) {
      const e = this.listing(block).get(seg.toLowerCase())
      if (!e?.isDir) return null
      block = e.block
    }
    return block
  }

  private nodeAt(segs: string[]): AdfNode | null {
    if (segs.length === 0) return null
    const parent = this.dirBlock(segs.slice(0, -1))
    if (parent === null) return null
    return this.listing(parent).get(segs[segs.length - 1]!.toLowerCase()) ?? null
  }

  read(segs: string[]): Uint8Array | null {
    const n = this.nodeAt(segs)
    if (!n || n.isDir) return null
    try {
      return readFile(this.a, n.block)
    } catch {
      // one bad block should not be a crash: these are thirty-year-old
      // floppy images, and readAdf skips such a file rather than throwing
      return null
    }
  }

  list(segs: string[]): DirEntry[] | null {
    const block = this.dirBlock(segs)
    if (block === null) return null
    return [...this.listing(block).values()].map((n) => ({ name: n.name, isDir: n.isDir, size: n.size }))
  }

  exists(segs: string[]): 'file' | 'dir' | null {
    if (segs.length === 0) return 'dir'
    const n = this.nodeAt(segs)
    return n === null ? null : n.isDir ? 'dir' : 'file'
  }

  /**
   * The AmigaDOS metadata in the header block.
   *
   * The protection long is masked to a byte: the defined bits are the low
   * eight (hswa in the high nibble, rwed in the low, the latter active low)
   * and that is the width the keywords reading it use.
   *
   * The root gets no answer. It has a DateStamp of its own — the last time
   * the root directory changed — but no protection bits and no FileNote, and
   * inventing them for the volume itself would be making something up.
   */
  meta(segs: string[]): Partial<FileMeta> | null {
    const n = this.nodeAt(segs)
    if (n === null) return null
    return {
      comment: this.a.name(n.block, OFF.comment, COMMENT_MAX),
      protection: this.a.u32(n.block, OFF.protect) & 0xff,
      days: this.a.u32(n.block, OFF.days),
      mins: this.a.u32(n.block, OFF.mins),
      ticks: this.a.u32(n.block, OFF.ticks),
    }
  }
}
