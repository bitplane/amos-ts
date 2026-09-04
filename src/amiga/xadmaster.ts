/**
 * `xadmaster.library` — what is inside this archive, and get it out.
 *
 * The third of the three identification subsystems, and the one the file tree
 * has been waiting for. `./datatypes.ts` says what a file IS,
 * `./xfdmaster.ts` says whether it is PACKED, and this says whether it HOLDS
 * other files.
 *
 * That split is not a reading. It is what the two authors wrote, twice, in
 * matching words. `xad/xadmaster000.readme`:
 *
 *     The XAD system is for file extraction from archives! It can be compared
 *     to XFD system, which is for single file decrunching. They do different
 *     work, but are used together often.
 *
 * and `xfd_Developer/xfdmaster_dev.readme` says the same with the systems the
 * other way round. `xad/Libs/xadSpecial/xfd-xad` is a client that bridges
 * them, so "used together" ships as a file.
 *
 * ## Evidence
 *
 * `util/arc/xadmasterdev.lha` and `xadmaster000.lha` off Aminet, release
 * 12.1 by Dirk Stöcker, vendored at `fixtures/aminet/xad/`. All 124 files
 * extracted with every size checked against the archive listing.
 *
 * The constants below are `Include/C/libraries/xadmaster.h` verbatim, the
 * LVOs are `Include/FD/xadmaster_lib.fd`, and the behaviour is
 * `Include/Autodocs/xadmaster.doc`. The library BINARY is held too, 133,432
 * bytes, and `./lha.ts` reads its method dispatch for the LHA window sizes.
 *
 * ## What a CLIENT is here
 *
 * xad ships 38 external clients as separate binaries plus more built into the
 * master library, and this port has three formats it can read. A client here
 * is therefore a TypeScript object rather than a loadable file, and the
 * registry is a list rather than a directory scan. `xadGetClientInfo` is the
 * call that would enumerate them and it is honest about the difference: it
 * answers what this port has, which is not what a real machine's LIBS:xad
 * drawer would hold.
 *
 * One of the 38 is worth naming because it is about this project: `xad/AMOS`
 * 1.0, 20.12.2002, extracts banks out of an AMOS file. Its strings carry
 * `AmBk`, `Samp`, `Pic.`, `Pac.` and eight header magics. It is a third
 * party's independent reading of AMOS's own format and a cross-check on
 * `../loader/amosfile.ts` waiting to be used.
 */
import { readLha, readLhaHeaders } from './lha'
import { readTar } from './tar'
import { readZipDirectory, readZipEntry } from './zip'

/**
 * The jump table, from `Include/FD/xadmaster_lib.fd`.
 *
 * No private slots anywhere in it: bias, then six a step, all the way down.
 * That is worth stating because the previous two libraries in this directory
 * both HAVE gaps, and writing this table from that habit rather than from the
 * file put sixteen of the twenty-five out by between six and forty-two. The
 * test reads the .fd.
 */
export const LVO = {
  xadAllocObjectA: -30,
  xadFreeObjectA: -36,
  xadRecogFileA: -42,
  xadGetInfoA: -48,
  xadFreeInfo: -54,
  xadFileUnArcA: -60,
  xadDiskUnArcA: -66,
  xadGetErrorText: -72,
  xadGetClientInfo: -78,
  xadHookAccess: -84,
  xadConvertDatesA: -90,
  xadCalcCRC16: -96,
  xadCalcCRC32: -102,
  xadAllocVec: -108,
  xadCopyMem: -114,
  xadHookTagAccessA: -120,
  xadConvertProtectionA: -126,
  xadGetDiskInfoA: -132,
  xadDiskFileUnArcA: -138,
  xadGetHookAccessA: -144,
  xadFreeHookAccessA: -150,
  xadAddFileEntryA: -156,
  xadAddDiskEntryA: -162,
  xadGetFilenameA: -168,
  xadConvertNameA: -174,
} as const

/**
 * `xai_LastError` and every function's return, from xadmaster.h.
 *
 * Twenty-six of them, and the spread says what the library is for: half are
 * about the ARCHIVE being wrong and half about the extraction failing, which
 * is a distinction a caller showing a message needs.
 */
export const XADERR = {
  OK: 0x0000,
  UNKNOWN: 0x0001,
  INPUT: 0x0002,
  OUTPUT: 0x0003,
  BADPARAMS: 0x0004,
  NOMEMORY: 0x0005,
  ILLEGALDATA: 0x0006,
  NOTSUPPORTED: 0x0007,
  RESOURCE: 0x0008,
  DECRUNCH: 0x0009,
  FILETYPE: 0x000a,
  OPENFILE: 0x000b,
  SKIP: 0x000c,
  BREAK: 0x000d,
  FILEEXISTS: 0x000e,
  PASSWORD: 0x000f,
  MAKEDIR: 0x0010,
  CHECKSUM: 0x0011,
  VERIFY: 0x0012,
  GEOMETRY: 0x0013,
  DATAFORMAT: 0x0014,
  EMPTY: 0x0015,
  FILESYSTEM: 0x0016,
  FILEDIR: 0x0017,
  SHORTBUFFER: 0x0018,
  ENCODING: 0x0019,
} as const

/**
 * The exact built-in English strings returned by `xadGetErrorText` at
 * `$12a90`. A localised install may replace them through locale.library;
 * `xadmasterlang.lha` ships German, French and Polish catalogs.
 */
export const XADERR_TEXT: Readonly<Record<number, string>> = {
  [XADERR.OK]: 'no error',
  [XADERR.UNKNOWN]: 'unknown error',
  [XADERR.INPUT]: 'error reading input',
  [XADERR.OUTPUT]: 'error writing output',
  [XADERR.BADPARAMS]: 'function call with bad parameters',
  [XADERR.NOMEMORY]: 'not enough memory',
  [XADERR.ILLEGALDATA]: 'input data is illegal or corrupted',
  [XADERR.NOTSUPPORTED]: 'command is not supported',
  [XADERR.RESOURCE]: 'missing required resource',
  [XADERR.DECRUNCH]: 'error on decrunching data',
  [XADERR.FILETYPE]: 'filetype is unknown',
  [XADERR.OPENFILE]: 'opening file failed',
  [XADERR.SKIP]: 'file has been skipped',
  [XADERR.BREAK]: 'user break',
  [XADERR.FILEEXISTS]: 'file already exists',
  [XADERR.PASSWORD]: 'missing or wrong password',
  [XADERR.MAKEDIR]: 'could not create directory',
  [XADERR.CHECKSUM]: 'wrong checksum',
  [XADERR.VERIFY]: 'verify failed',
  [XADERR.GEOMETRY]: 'wrong drive geometry',
  [XADERR.DATAFORMAT]: 'unknown data format',
  [XADERR.EMPTY]: 'source contains no files',
  [XADERR.FILESYSTEM]: 'unknown filesystem',
  [XADERR.FILEDIR]: 'name of file exists as directory',
  [XADERR.SHORTBUFFER]: 'buffer too short',
  [XADERR.ENCODING]: 'text encoding defective',
}

/** `xadGetErrorText(errnum)` (-72). See the DEVIATION on XADERR_TEXT. */
export function getErrorText(error: number): string {
  return XADERR_TEXT[error] ?? XADERR_TEXT[XADERR.UNKNOWN]!
}

/** `xfi_Flags` bit numbers, from xadmaster.h; only the ones this port sets */
export const XADFIB = {
  CRYPTED: 0,
  DIRECTORY: 1,
  LINK: 2,
  INFOTEXT: 3,
  GROUPED: 4,
  ENDOFGROUP: 5,
  NODATE: 6,
  DELETED: 7,
  NOFILENAME: 9,
  NOUNCRUNCHSIZE: 10,
  PARTIALFILE: 11,
} as const

export const XADFIF = {
  CRYPTED: 1 << XADFIB.CRYPTED,
  DIRECTORY: 1 << XADFIB.DIRECTORY,
  LINK: 1 << XADFIB.LINK,
  INFOTEXT: 1 << XADFIB.INFOTEXT,
  GROUPED: 1 << XADFIB.GROUPED,
  ENDOFGROUP: 1 << XADFIB.ENDOFGROUP,
  NODATE: 1 << XADFIB.NODATE,
  DELETED: 1 << XADFIB.DELETED,
  NOFILENAME: 1 << XADFIB.NOFILENAME,
  NOUNCRUNCHSIZE: 1 << XADFIB.NOUNCRUNCHSIZE,
  PARTIALFILE: 1 << XADFIB.PARTIALFILE,
} as const

/**
 * `struct xadFileInfo`, with the fields this port fills in.
 *
 * The names are the header's minus the `xfi_` prefix. Absent are the ones
 * that only mean something on a real machine: `xfi_PrivateInfo` is the
 * client's own, and the four protection words are three operating systems'
 * ideas of the same thing which nothing here reads.
 */
export interface XadFileInfo {
  /** xfi_EntryNumber, from 1 as the autodocs number them */
  entryNumber: number
  /** xfi_FileName */
  fileName: string
  /** xfi_Comment, which LHA hides behind a NUL in the name */
  comment: string
  /** xfi_Size, the decrunched length */
  size: number
  /** xfi_CrunchSize */
  crunchSize: number
  /** xfi_Flags */
  flags: number
  /** xfi_DataPos, where the crunched bytes start */
  dataPos: number
}

/**
 * `struct xadArchiveInfo`, as far as a caller of this port needs it.
 *
 * `xai_Client` is the client that claimed the archive, which is the field
 * that makes the whole thing worth having: it is how a caller learns the
 * answer was "LHA" without asking each reader in turn.
 */
export interface XadArchiveInfo {
  client: string
  files: XadFileInfo[]
  lastError: number
  inSize: number
}

/**
 * One archive reader.
 *
 * `recog` gets the front of the file and must be cheap and total: the library
 * runs every client's recognition over every archive, and one that threw on a
 * short buffer would take the scan with it. `list` and `unarc` are only ever
 * called after `recog` has said yes.
 */
export interface XadClient {
  /** xc_ArchiverName */
  name: string
  /** xc_RecogSize, the least the recogniser needs */
  recogSize: number
  recog(data: Uint8Array): boolean
  list(data: Uint8Array): XadFileInfo[]
  /**
   * The bytes of one entry, or null when this client cannot decode it.
   *
   * May answer a promise. On the machine every client is synchronous, and
   * here ZIP cannot be: DEFLATE goes through `DecompressionStream`. Rather
   * than a second interface for the one asynchronous client, `fileUnArc`
   * awaits whatever comes back, so LHA and TAR stay as direct as they are.
   */
  unarc(data: Uint8Array, entry: XadFileInfo): Uint8Array | null | Promise<Uint8Array | null>
}

/**
 * The LHA client, over `./lha.ts`.
 *
 * Recognition is the method id at offset 2, which is the only field an LHA
 * header has that is reliably a constant. The size and name fields are data,
 * the checksum is one byte and matches by accident often enough to be
 * useless, and the level byte is 0, 1 or 2 which is three of the 256 values a
 * random byte takes.
 */
export const LHA_CLIENT: XadClient = {
  name: 'LhA',
  recogSize: 22,
  recog: (d) => d.length >= 22 && /^-l[hz][0-9s]-$/.test(String.fromCharCode(...d.subarray(2, 7))),
  list: (d) =>
    readLhaHeaders(d).map((h, i) => ({
      entryNumber: i + 1,
      fileName: h.path,
      comment: '',
      size: h.size,
      crunchSize: h.packedSize,
      flags: h.path.endsWith('/') ? XADFIF.DIRECTORY : 0,
      dataPos: h.dataOffset,
    })),
  unarc: (d, e) => readLha(d).find((f) => f.path === e.fileName)?.data ?? null,
}

/**
 * The ZIP client, over `./zip.ts`.
 *
 * `PK\x03\x04` is the local header. A ZIP that has been split or that begins
 * with a self-extracting stub does not start with it, and neither is
 * recognised here: the reader walks the central directory, so it needs the
 * whole file, and half of one is not an archive this can list.
 */
export const ZIP_CLIENT: XadClient = {
  name: 'Zip',
  recogSize: 4,
  recog: (d) => d.length >= 4 && d[0] === 0x50 && d[1] === 0x4b && d[2] === 0x03 && d[3] === 0x04,
  // the directory names every entry and its size, so listing costs no inflate
  list: (d) =>
    readZipDirectory(d).map((e, i) => ({
      entryNumber: i + 1,
      fileName: e.path,
      comment: '',
      size: e.size,
      crunchSize: e.packedSize,
      flags: e.path.endsWith('/') ? XADFIF.DIRECTORY : 0,
      dataPos: e.dataOffset,
    })),
  unarc: (d, e) => {
    const found = readZipDirectory(d).find((z) => z.path === e.fileName)
    return found === undefined ? null : readZipEntry(d, found)
  },
}

/**
 * The TAR client, over `./tar.ts`.
 *
 * `ustar` at offset 257, which is the only constant a tar header has. The
 * pre-POSIX tars that carry nothing there are not recognised, and that is a
 * real limit rather than an oversight: without the magic, a tar header is 512
 * bytes of text and a checksum, and claiming every such file would take
 * archives away from the clients that can actually read them.
 */
export const TAR_CLIENT: XadClient = {
  name: 'Tar',
  recogSize: 262,
  recog: (d) => d.length >= 262 && String.fromCharCode(...d.subarray(257, 262)) === 'ustar',
  list: (d) =>
    readTar(d).map((e, i) => ({
      entryNumber: i + 1,
      fileName: e.path,
      comment: '',
      size: e.data.length,
      crunchSize: e.data.length,
      flags: 0,
      dataPos: 0,
    })),
  unarc: (d, e) => readTar(d).find((f) => f.path === e.fileName)?.data ?? null,
}

/** every client this port has; a real machine would scan `LIBS:xad` for them */
export const CLIENTS: readonly XadClient[] = [LHA_CLIENT, ZIP_CLIENT, TAR_CLIENT]

/**
 * `xadRecogFileA(size, memory, tags)` (-42): which client claims this, or
 * null.
 *
 * The autodocs are explicit that recognition is by content and not by name:
 * an archive renamed to `.txt` is still an archive. Nothing here looks at a
 * filename either.
 */
export function recogFile(data: Uint8Array, clients: readonly XadClient[] = CLIENTS): XadClient | null {
  for (const c of clients) {
    if (data.length < c.recogSize) continue
    try {
      if (c.recog(data)) return c
    } catch {
      // a client that throws on recognition is a broken client, not a broken
      // archive, and must not stop the ones after it
    }
  }
  return null
}

/**
 * `xadGetInfoA(ai, tags)` (-48): the archive's contents, without extracting.
 *
 * `lastError` carries XADERR_FILETYPE when no client claimed it and
 * XADERR_EMPTY when one did and found nothing, which is the distinction the
 * header's own `XAD_NOEMPTYERROR` tag exists to suppress. A caller listing a
 * drawer wants those to read differently.
 */
export function getInfo(data: Uint8Array, clients: readonly XadClient[] = CLIENTS): XadArchiveInfo {
  const client = recogFile(data, clients)
  if (client === null) {
    return { client: '', files: [], lastError: XADERR.FILETYPE, inSize: data.length }
  }
  let files: XadFileInfo[] = []
  let lastError: number = XADERR.OK
  try {
    files = client.list(data)
  } catch {
    lastError = XADERR.ILLEGALDATA
  }
  if (lastError === XADERR.OK && files.length === 0) lastError = XADERR.EMPTY
  return { client: client.name, files, lastError, inSize: data.length }
}

/**
 * `xadFileUnArcA(ai, tags)` (-60): one entry's bytes.
 *
 * Null with the reason in `ai.lastError`, so a caller extracting a whole
 * archive can skip the member it could not read and say which one.
 */
export async function fileUnArc(
  data: Uint8Array,
  ai: XadArchiveInfo,
  entry: XadFileInfo,
  clients: readonly XadClient[] = CLIENTS,
): Promise<Uint8Array | null> {
  const client = clients.find((c) => c.name === ai.client)
  if (client === undefined) {
    ai.lastError = XADERR.FILETYPE
    return null
  }
  if ((entry.flags & XADFIF.DIRECTORY) !== 0) {
    ai.lastError = XADERR.SKIP
    return null
  }
  let out: Uint8Array | null = null
  try {
    out = await client.unarc(data, entry)
  } catch {
    out = null
  }
  if (out === null) {
    ai.lastError = XADERR.DECRUNCH
    return null
  }
  ai.lastError = XADERR.OK
  return out
}

/** one archive read whole, for a caller that wants the files and not the dance */
export interface XadFile {
  path: string
  data: Uint8Array
}

/**
 * Everything above in one call.
 *
 * Not part of the library. The three-step dance is xad's and a file tree
 * asking "what is in this" should not have to allocate an ArchiveInfo to find
 * out. Entries that fail are left out and `ai.lastError` holds the last
 * reason, which is why the ArchiveInfo comes back too.
 */
export async function unarchive(
  data: Uint8Array,
  clients: readonly XadClient[] = CLIENTS,
): Promise<{ ai: XadArchiveInfo; files: XadFile[] }> {
  const ai = getInfo(data, clients)
  const files: XadFile[] = []
  if (ai.lastError !== XADERR.OK) return { ai, files }
  for (const e of ai.files) {
    if ((e.flags & XADFIF.DIRECTORY) !== 0 || e.fileName === '') continue
    const bytes = await fileUnArc(data, ai, e, clients)
    if (bytes !== null) files.push({ path: e.fileName, data: bytes })
  }
  return { ai, files }
}
