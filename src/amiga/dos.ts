/**
 * `dos.library`'s FileInfoBlock — entry types, protection bits, and the
 * struct offsets an Examine writes into.
 *
 * ## Why this exists
 *
 * `fib_DirEntryType` had two callers and one name between them:
 *
 * - `runtime/ldos.ts` declared `FIB_ST_USERDIR = 2` and `FIB_ST_FILE = -3`
 *   and documented where in the struct they come from.
 * - `runtime/jd.ts` wrote `VI(2)` and `VI(-3)` as bare literals, with a
 *   comment saying "which is AmigaDOS's own convention" and nothing to point
 *   at.
 *
 * The protection bits were worse: LDos masks them with `& 0xff`, JD passes
 * them straight through, and `vfs.ts` explains in prose which nibble is
 * active low — three places reasoning about the same eight bits and not one
 * of them naming a single flag.
 *
 * These are `dos.library`'s definitions. AMCAF's `Object Type`, `Object
 * Protection`, `Object Blocks`, `Object Comment$` and its `Examine` family
 * are the third caller, and they should find the constants already here
 * rather than add a third spelling.
 *
 * ## What is NOT here
 *
 * The **scan** is not. LDos's `Lcat First`/`Lcat Next` is Lock/Examine/ExNext
 * and AMCAF's `Examine Dir`/`Examine Next$` will be the same shape, but
 * LDos's version sorts its entries and a real ExNext returns them in
 * whatever order the filesystem holds them. Ordering is the port's decision,
 * so the scan stays with the port until there are two of them to compare and
 * something to say about what they share beyond the loop.
 *
 * The **protection string** (`hsparwed`) arrived with its caller, exactly as
 * planned: AMCAF's `Object Protection$` is documented as converting "this
 * numeric value into a string in the format 'hsparwed'", which is the format
 * `protectionString` produces and a test pins.
 *
 * The scan now has its second caller too — AMCAF's `Examine Dir`/`Next$` beside
 * LDos's `Lcat First`/`Next` — so unifying them is justified where it was not
 * before. Deferred rather than done: the two disagree on ordering, and picking
 * a winner is a decision with a right answer to find rather than a merge.
 */

/* ------------------------------------------------------------------ *
 * fib_DirEntryType
 * ------------------------------------------------------------------ */

/**
 * The type field of a FileInfoBlock, at offset 4.
 *
 * **Positive is a directory and negative is a file**, which is the whole
 * convention: a caller that only wants to tell them apart tests the sign
 * rather than matching a value, and that is what AMOS extensions document
 * when they say "positive for directories, negative for files".
 */
export const ST_ROOT = 1
export const ST_USERDIR = 2
export const ST_SOFTLINK = 3
export const ST_LINKDIR = 4
export const ST_FILE = -3
export const ST_LINKFILE = -4
export const ST_PIPEFILE = -5

/** the type a plain Examine reports for something we know only as file-or-dir */
export function entryType(isDir: boolean): number {
  return isDir ? ST_USERDIR : ST_FILE
}

/** the sign test itself, which is what the type field is really for */
export function isDirType(type: number): boolean {
  return type > 0
}

/* ------------------------------------------------------------------ *
 * fib_Protection
 * ------------------------------------------------------------------ */

/**
 * The protection bits.
 *
 * The low nibble is **active LOW** — a set bit DENIES the permission — so 0
 * is the default `----rwed` rather than "nothing allowed". The high nibble is
 * active high in the ordinary way. Getting that backwards is the classic
 * mistake with this field, which is exactly why the flags belong somewhere
 * that can say so once.
 */
export const FIBF_DELETE = 1 << 0
export const FIBF_EXECUTE = 1 << 1
export const FIBF_WRITE = 1 << 2
export const FIBF_READ = 1 << 3
export const FIBF_ARCHIVE = 1 << 4
export const FIBF_PURE = 1 << 5
export const FIBF_SCRIPT = 1 << 6
export const FIBF_HIDDEN = 1 << 7

/** the four bits a set flag DENIES rather than grants */
export const FIBF_ACTIVE_LOW = FIBF_DELETE | FIBF_EXECUTE | FIBF_WRITE | FIBF_READ

/** is this permission granted, given the low nibble's inverted sense? */
export function permits(protection: number, flag: number): boolean {
  return (flag & FIBF_ACTIVE_LOW) !== 0 ? (protection & flag) === 0 : (protection & flag) !== 0
}

/* ------------------------------------------------------------------ *
 * struct FileInfoBlock
 * ------------------------------------------------------------------ */

/**
 * Field offsets, verified against LDos's accessors — every one of them
 * indexes the documented offset, which is also what explains `Lcat Push`
 * saving an otherwise odd 264 bytes: a 4-byte lock plus this 260-byte
 * struct.
 */
export const FIB_DISKKEY = 0
export const FIB_DIRENTRYTYPE = 4
/** 108 bytes, a BCPL-style NUL-terminated name */
export const FIB_FILENAME = 8
export const FIB_PROTECTION = 116
export const FIB_ENTRYTYPE = 120
export const FIB_SIZE_ = 124
export const FIB_NUMBLOCKS = 128
/** a DateStamp: three longwords, days / minutes / ticks */
export const FIB_DATE = 132
/** 80 bytes, so 79 characters and a terminator */
export const FIB_COMMENT = 144
/**
 * The tail nobody reads, and the reason the struct is 260 rather than 224:
 * two owner words and 32 reserved bytes after the comment. LDos's `Lcat Push`
 * saves all of it — the arithmetic only closes with these here.
 */
export const FIB_OWNERUID = 224
export const FIB_OWNERGID = 226
export const FIB_RESERVED = 228
export const FIB_RESERVED_SIZE = 32
/** sizeof(struct FileInfoBlock) */
export const FIB_SIZEOF = 260

/** the longest FileNote that fits in fib_Comment */
export const MAX_COMMENT = 79

/* ------------------------------------------------------------------ *
 * fib_NumBlocks
 * ------------------------------------------------------------------ */

/**
 * How many blocks a file of this size occupies.
 *
 * NOTE: this counts DATA blocks only. A real `fib_NumBlocks` also counts the
 * file header and any extension blocks, so a large file reports a few more on
 * the machine than it does here. LDos's manual describes the data figure
 * ("FFS can hold 512 bytes of data in one block") and that is what its
 * `Lcat Blocks` returns.
 *
 * The default is FFS. Old filesystem blocks carry a 24-byte header inside the
 * same 512, leaving 488 for data, which is why the block size is a parameter
 * rather than a constant.
 */
export function blocksFor(size: number, dataBytesPerBlock = 512): number {
  if (!(size > 0) || !(dataBytesPerBlock > 0)) return 0
  return Math.ceil(size / dataBytesPerBlock)
}

/**
 * `fib_Protection` as AmigaDOS lists it: eight characters, `hsparwed`.
 *
 * The high nibble reads normally — a set bit shows its letter — and the low
 * nibble is INVERTED, so a set bit means the permission is denied and shows a
 * dash. Protection 0 is therefore `----rwed`, everything permitted and nothing
 * flagged, which is the default a freshly written file has.
 */
export function protectionString(protection: number): string {
  const HIGH = [FIBF_HIDDEN, FIBF_SCRIPT, FIBF_PURE, FIBF_ARCHIVE]
  const LOW = [FIBF_READ, FIBF_WRITE, FIBF_EXECUTE, FIBF_DELETE]
  const letters = 'hsparwed'
  let out = ''
  ;[...HIGH, ...LOW].forEach((flag, i) => {
    out += permits(protection, flag) ? letters[i]! : '-'
  })
  return out
}

/** data bytes per block on the two filesystems */
export const FFS_BLOCK_DATA = 512
export const OFS_BLOCK_DATA = 488

/**
 * `struct InfoData`, what `Info()` fills in — dos/dos.h.
 *
 * Only the four fields anything here reads are named. `id_NumSoftErrors` and
 * `id_UnitNumber` sit above them and `id_InUse` below; nothing asks.
 */
export const ID_NUMSOFTERRORS = 0
export const ID_UNITNUMBER = 4
export const ID_DISKSTATE = 8
export const ID_NUMBLOCKS = 12
export const ID_NUMBLOCKSUSED = 16
export const ID_BYTESPERBLOCK = 20
export const ID_DISKTYPE = 24
export const ID_VOLUMENODE = 28
export const ID_INUSE = 32

/** id_DiskState */
export const ID_WRITE_PROTECTED = 80
export const ID_VALIDATING = 81
export const ID_VALIDATED = 82

/**
 * id_DiskType, as longwords. The three-letter ones carry a version byte, so
 * OFS is `DOS\0` and FFS is `DOS\1` — which is why CRAFT's manual describes
 * `Disc Type$` as answering `"DOS"+Chr$(1)` for a Fast File System disk.
 */
export const ID_NO_DISK_PRESENT = -1
export const ID_UNREADABLE_DISK = 0x42414400 // 'BAD\0'
export const ID_DOS_DISK = 0x444f5300 // 'DOS\0'
export const ID_FFS_DISK = 0x444f5301 // 'DOS\1'
export const ID_INTER_DOS_DISK = 0x444f5302 // 'DOS\2'
export const ID_INTER_FFS_DISK = 0x444f5303 // 'DOS\3'
export const ID_NOT_REALLY_DOS = 0x4e444f53 // 'NDOS'
export const ID_KICKSTART_DISK = 0x4b49434b // 'KICK'

/** what `Examine()` and `ExNext()` fill a FileInfoBlock in from */
export interface FibFields {
  /** fib_DirEntryType — positive for a directory, negative for a file */
  type: number
  name: string
  protection: number
  size: number
  days: number
  mins: number
  ticks: number
  comment: string
}

/**
 * Lay a FileInfoBlock out as the 260 bytes a program can Peek.
 *
 * Needed because some extensions hand the block's ADDRESS back rather than
 * its fields — CRAFT's `Dr Fib` does, and its manual sends the reader to an
 * appendix of offsets — so the struct has to exist as memory and not only as
 * a record. `fib_DiskKey` is left zero: it is the block number the entry
 * lives at, which is a real filesystem's business and not this one's.
 *
 * Both strings are BCPL-flavoured C: NUL-terminated and truncated to the room
 * available, 107 characters for the name and `MAX_COMMENT` for the note.
 */
export function fibBytes(f: FibFields): Uint8Array {
  const out = new Uint8Array(FIB_SIZEOF)
  const v = new DataView(out.buffer)
  v.setInt32(FIB_DIRENTRYTYPE, f.type, false)
  v.setInt32(FIB_ENTRYTYPE, f.type, false)
  v.setInt32(FIB_PROTECTION, f.protection, false)
  v.setInt32(FIB_SIZE_, f.size, false)
  v.setInt32(FIB_NUMBLOCKS, blocksFor(f.size), false)
  v.setInt32(FIB_DATE, f.days, false)
  v.setInt32(FIB_DATE + 4, f.mins, false)
  v.setInt32(FIB_DATE + 8, f.ticks, false)
  const put = (at: number, s: string, max: number): void => {
    for (let i = 0; i < Math.min(s.length, max); i++) out[at + i] = s.charCodeAt(i) & 0xff
  }
  put(FIB_FILENAME, f.name, 107)
  put(FIB_COMMENT, f.comment, MAX_COMMENT)
  return out
}
