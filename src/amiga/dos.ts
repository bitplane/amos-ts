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

/* ------------------------------------------------------------------ *
 * dos.library path parts
 * ------------------------------------------------------------------ */

/**
 * The string beginning at the pointer returned by dos.library `FilePart()`.
 *
 * A colon separates a device from its first component just as a slash
 * separates drawers. The returned pointer is one byte past the last such
 * separator, so a trailing separator quite deliberately answers an empty
 * string.
 */
export function dosFilePart(path: string): string {
  const at = Math.max(path.lastIndexOf(':'), path.lastIndexOf('/'))
  return path.slice(at + 1)
}

/**
 * The bytes preceding the pointer returned by dos.library `PathPart()`.
 *
 * `PathPart` points AT a final slash, but immediately after a device colon.
 * This slightly asymmetric rule is visible in OS DevKit's shipped example:
 * `RAM:ENV/Sys/serial.prefs` yields `RAM:ENV/Sys`, while `RAM:file` yields
 * `RAM:`. Returning the prefix is more useful in TypeScript than returning a
 * pointer into a C string, while preserving the exact observable text.
 */
export function dosPathPart(path: string): string {
  const slash = path.lastIndexOf('/')
  const colon = path.lastIndexOf(':')
  if (slash > colon) return path.slice(0, slash)
  if (colon >= 0) return path.slice(0, colon + 1)
  return ''
}

/* ------------------------------------------------------------------ *
 * dos.library error text
 * ------------------------------------------------------------------ */

/**
 * English dos.library error catalogue. AMCAF 1.50 supplies the longer V36
 * fallback spellings; the remaining canonical numbers are independently
 * listed by the corpus APD489 `Error_Codes.Doc` table.
 */
const DOS_ERRORS: Readonly<Record<number, string>> = {
  49: 'file not executable', 103: 'not enough memory available', 105: 'task table full',
  114: 'bad template', 115: 'bad number', 116: 'required argument missing',
  117: 'key needs argument', 118: 'too many arguments', 119: 'unmatched quotes',
  120: 'line too long', 121: 'file is not executable', 122: 'invalid resident library',
  201: 'no default directory', 202: 'object is in use', 203: 'object already exists',
  204: 'directory not found', 205: 'object not found', 206: 'bad stream name',
  207: 'object is too large', 209: 'action not known', 210: 'object name invalid',
  211: 'invalid object lock', 212: 'object is not of required type', 213: 'disk is not validated',
  214: 'disk is write-protected', 215: 'rename across devices attempted', 216: 'directory not empty',
  217: 'too many levels', 218: 'device (or volume) is not mounted', 219: 'seek failure',
  220: 'comment is too long', 221: 'disk full', 222: 'object is protected from deletion',
  223: 'file is write protected', 224: 'file is read protected', 225: 'not a valid DOS disk',
  226: 'no disk in drive', 232: 'no more entries in directory', 233: 'is soft link',
  234: 'object linked', 235: 'bad hunk', 236: 'not implemented', 240: 'record not locked',
  241: 'lock collision', 242: 'lock timeout', 243: 'unlock error',
}

/** AMCAF-compatible lower-case text; an unknown error has no table entry. */
export function dosErrorText(code: number): string { return DOS_ERRORS[code | 0] ?? '' }

/**
 * Text written by `Fault()`, excluding its final NUL. A non-NULL empty
 * header still produces `": "`; AMCAF 1.50 relies on precisely that detail.
 * Code zero is the native no-write case.
 */
export function dosFaultText(code: number, header: string | null): string | null {
  code |= 0
  if (code === 0) return null
  const error = dosErrorText(code)
  const message = error ? error[0]!.toUpperCase() + error.slice(1) : String(code)
  return `${header === null ? '' : `${header}: `}${message}`
}

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

export interface DosReport { error: number; type: number; argument: number; device: number }

/** Process-wide dos.library result state (`IoErr`, `SetIoErr`, `ReportEvent`). */
export interface DosFile {
  path: string
  mode: number
  access: -2 | -1
  data: Uint8Array
  position: number
  ungot: number | null
}

export interface DosStorage {
  readFile(path: string): Uint8Array | null
  writeFile(path: string, data: Uint8Array): void
}

export interface DosFilesystem extends DosStorage {
  currentDir: string
  exists(path: string): 'file' | 'dir' | null
  setCurrentDir(path: string): boolean
}

export interface DosLock { path: string; access: -2 | -1 }

export class DosSystem {
  ioErr = 0
  lastReport: DosReport | null = null
  readonly files = new Map<number, DosFile>()
  readonly locks = new Map<number, DosLock>()
  private nextFile = 1
  private nextLock = 1
  setIoErr(value: number): number { const old = this.ioErr; this.ioErr = value | 0; return old }
  fault(code: number, header: string | null): string | null { return dosFaultText(code, header) }
  report(error: number, type: number, argument: number, device: number): boolean {
    this.ioErr = error | 0
    this.lastReport = { error: error | 0, type: type | 0, argument: argument >>> 0, device: device >>> 0 }
    return true
  }
  private samePath(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase() }
  private canOwn(path: string, access: -2 | -1, exceptFile = 0, exceptLock = 0): boolean {
    for (const [handle, file] of this.files) {
      if (handle === exceptFile || !this.samePath(file.path, path)) continue
      if (access === -1 || file.access === -1) return false
    }
    for (const [handle, lock] of this.locks) {
      if (handle === exceptLock || !this.samePath(lock.path, path)) continue
      if (access === -1 || lock.access === -1) return false
    }
    return true
  }
  open(storage: DosStorage | null | undefined, path: string, mode: number): number {
    if (!storage || !path || ![1004, 1005, 1006].includes(mode | 0)) { this.ioErr = 205; return 0 }
    const access: -2 | -1 = mode === 1005 ? -2 : -1
    if (!this.canOwn(path, access)) { this.ioErr = 202; return 0 }
    const old = storage.readFile(path)
    if (!old && mode === 1005) { this.ioErr = 205; return 0 }
    const data = mode === 1006 ? new Uint8Array() : Uint8Array.from(old ?? [])
    if (mode === 1006 || (mode === 1004 && !old)) storage.writeFile(path, data)
    const handle = (0x7f40_0000 + this.nextFile++ * 4) >>> 0
    this.files.set(handle, { path, mode: mode | 0, access, data, position: 0, ungot: null })
    this.ioErr = 0
    return handle
  }
  close(storage: DosStorage | null | undefined, handle: number): boolean {
    const file = this.files.get(handle >>> 0)
    if (!file) { this.ioErr = 211; return false }
    if (file.mode !== 1005) storage?.writeFile(file.path, file.data)
    this.files.delete(handle >>> 0)
    return true
  }
  file(handle: number): DosFile | null { return this.files.get(handle >>> 0) ?? null }
  seek(handle: number, offset: number, mode: number): number {
    const file = this.file(handle)
    if (!file) { this.ioErr = 211; return -1 }
    const old = file.position
    const position = (mode === -1 ? 0 : mode === 0 ? old : mode === 1 ? file.data.length : Number.NaN) + (offset | 0)
    if (!Number.isFinite(position) || position < 0) { this.ioErr = 219; return -1 }
    file.position = position
    file.ungot = null
    return old
  }
  read(handle: number, length: number): Uint8Array | null {
    const file = this.file(handle)
    if (!file || length < 0) { this.ioErr = 211; return null }
    const out: number[] = []
    if (file.ungot !== null && length > 0) { out.push(file.ungot); file.ungot = null }
    const count = Math.min(length - out.length, Math.max(0, file.data.length - file.position))
    for (let i = 0; i < count; i++) out.push(file.data[file.position++]!)
    return Uint8Array.from(out)
  }
  write(storage: DosStorage | null | undefined, handle: number, bytes: Uint8Array): number {
    const file = this.file(handle)
    if (!file || file.mode === 1005) { this.ioErr = 223; return -1 }
    const end = file.position + bytes.length
    if (end > file.data.length) { const grown = new Uint8Array(end); grown.set(file.data); file.data = grown }
    file.data.set(bytes, file.position); file.position = end; file.ungot = null
    storage?.writeFile(file.path, file.data)
    return bytes.length
  }
  getc(handle: number): number { const b = this.read(handle, 1); return !b || b.length === 0 ? -1 : b[0]! }
  ungetc(handle: number, value: number): number {
    const file = this.file(handle)
    if (!file || file.ungot !== null) return -1
    if (value === -1) { if (file.position === 0) return -1; value = file.data[file.position - 1]! }
    file.ungot = value & 0xff
    return value & 0xff
  }
  gets(handle: number, length: number): Uint8Array | null {
    if (length <= 0 || !this.file(handle)) return null
    const out: number[] = []
    while (out.length < length - 1) { const c = this.getc(handle); if (c < 0) break; out.push(c); if (c === 0 || c === 10) break }
    return out.length === 0 ? null : Uint8Array.from(out)
  }
  lock(fs: DosFilesystem | null | undefined, path: string, access: number): number {
    if (!fs || ![-2, -1].includes(access) || fs.exists(path) === null) { this.ioErr = 205; return 0 }
    if (!this.canOwn(path, access as -2 | -1)) { this.ioErr = 202; return 0 }
    const handle = (0x7f50_0000 + this.nextLock++ * 4) >>> 0
    this.locks.set(handle, { path, access: access as -2 | -1 })
    this.ioErr = 0
    return handle
  }
  unlock(handle: number): boolean { return this.locks.delete(handle >>> 0) }
  changeMode(handle: number, type: number, access: number): boolean {
    handle >>>= 0
    if (![-2, -1].includes(access) || ![0, 1].includes(type)) { this.ioErr = 211; return false }
    if (type === 0) {
      const lock = this.locks.get(handle)
      if (!lock || !this.canOwn(lock.path, access as -2 | -1, 0, handle)) { this.ioErr = lock ? 202 : 211; return false }
      lock.access = access as -2 | -1
    } else {
      const file = this.files.get(handle)
      if (!file || !this.canOwn(file.path, access as -2 | -1, handle)) { this.ioErr = file ? 202 : 211; return false }
      file.access = access as -2 | -1
    }
    this.ioErr = 0
    return true
  }
  lockInfo(handle: number): DosLock | null { return this.locks.get(handle >>> 0) ?? null }
  parentLock(fs: DosFilesystem | null | undefined, handle: number): number {
    const lock = this.lockInfo(handle)
    if (!lock) return 0
    const parent = dosPathPart(lock.path)
    return parent === lock.path ? 0 : this.lock(fs, parent, -2)
  }
  currentDir(fs: DosFilesystem | null | undefined, handle: number): number {
    const lock = this.lockInfo(handle)
    if (!fs || !lock) return 0
    const old = this.lock(fs, fs.currentDir, -2)
    if (!fs.setCurrentDir(lock.path)) { if (old) this.unlock(old); return 0 }
    return old
  }
}
