/**
 * `xfdmaster.library` — is this one file crunched, and if so, uncrunch it.
 *
 * The front door this port had every piece of but never fitted. PowerPacker,
 * the Imploder, ByteKiller and StoneCracker are all here as codecs, each
 * written for whichever extension wanted it first, and nothing could ask "is
 * this file packed" without knowing in advance which of them to try. That
 * question is what xfdmaster exists to answer.
 *
 * ## What it is NOT, in its author's words
 *
 * `xfd_Developer/xfdmaster_dev.readme`:
 *
 *     The XFD system  is for single file decrunching.  It can be compared to
 *     XAD system,  which  is  for  file extraction  from  archives!  They  do
 *     different work, but are used together often.
 *
 * So an LHA is not this library's problem and never was. That is the same
 * line `./datatypes.ts` draws for media, and the three together are the whole
 * identification story: datatypes for what a file is, xfd for whether it is
 * packed, xad for whether it contains other files.
 *
 * The same readme places it against what this port already had:
 *
 *     Other  than the predecessor decrunch.library, the xfdmaster.library has
 *     a  more  flexible interface, offers the possibility to decrunch already
 *     loaded  program  segments,  supports  external  decrunchers, is able to
 *     unlink 4EB9/4EF9- and text-linked files  and can scan for crunched data
 *     in any memory area.
 *
 * `./decrunchlib.ts` IS that predecessor, 35.237, and its identification is
 * complete where this one's is a handful of slaves. Neither replaces the
 * other, and the trade is exact: decrunch.library NAMES 92 formats and
 * decrunches one of them, this names three and decrunches all three.
 *
 * ## Evidence
 *
 * SOURCE tier, which is rare for a library this port did not already have.
 * `util/pack/xfdmaster_dev.lha` off Aminet, release 1.38 / 39.15 by Georg
 * Hörmann and Dirk Stöcker, vendored at `fixtures/aminet/xfd/`. Every size
 * checked against the archive listing on extraction, all 91 files.
 *
 * The constants below are `Include/C/libraries/xfdmaster.h` 39.5, verbatim
 * including the version each was added in. The LVOs are
 * `Include/FD/xfdmaster_lib.fd`, which is newer than the 37.1 copy GUI 2.10
 * ships in its own `Tools/FD` and carries nine more entries. The behaviour is
 * `Include/Autodocs/xfdmaster.doc`, 32KB of Commodore-style autodocs.
 *
 * The matching user archive supplies `xfdmaster.library` 39.15 (09.03.2003),
 * 78,448 bytes on disk and 75,192 bytes loaded. Its resident and vectors have
 * now been checked against the FD, and its callable behaviour settles the
 * details below that the interface documentation cannot.
 */
import { isImploded, explodeChecked } from './imploder'
import { pp20Decrunch } from './powerpacker'
import { isStoneCracked, stcDecrunch, stcLength } from './stonecracker'

/**
 * The jump table, from `Include/FD/xfdmaster_lib.fd`.
 *
 * No private slots anywhere in it, so this is the rare .fd where the offsets
 * are just the bias and six times the index. `xfdRecogBuffer` at -54 is
 * confirmed a second time by its own autodoc, which prints the offset under
 * the synopsis.
 */
export const LVO = {
  xfdAllocBufferInfo: -30,
  xfdFreeBufferInfo: -36,
  xfdAllocSegmentInfo: -42,
  xfdFreeSegmentInfo: -48,
  xfdRecogBuffer: -54,
  xfdDecrunchBuffer: -60,
  xfdRecogSegment: -66,
  xfdDecrunchSegment: -72,
  xfdGetErrorText: -78,
  xfdTestHunkStructure: -84,
  /** V34 */
  xfdTestHunkStructureNew: -90,
  xfdRelocate: -96,
  /** V36 */
  xfdTestHunkStructureFlags: -102,
  xfdStripHunks: -108,
  xfdAllocObject: -114,
  xfdFreeObject: -120,
  xfdRecogLinker: -126,
  xfdUnlink: -132,
  /** V37 */
  xfdScanData: -138,
  xfdFreeScanList: -144,
  xfdObjectType: -150,
  xfdInitScanHook: -156,
} as const

/**
 * `xfdbi_Error`, from xfdmaster.h. Three ranges, and the ranges mean
 * something: $0000 is the library's own, $1000 is hunk STRUCTURE trouble and
 * $2000 is a hunk the relocator will not handle.
 */
export const XFDERR = {
  OK: 0x0000,
  NOMEMORY: 0x0001,
  NOSLAVE: 0x0002,
  NOTSUPPORTED: 0x0003,
  UNKNOWN: 0x0004,
  NOSOURCE: 0x0005,
  WRONGPASSWORD: 0x0006,
  BADHUNK: 0x0007,
  CORRUPTEDDATA: 0x0008,
  /** V34 */
  MISSINGRESOURCE: 0x0009,
  /** V35 */
  WRONGKEY: 0x000a,
  /** V37 */
  BETTERCPU: 0x000b,
  HOOKBREAK: 0x000c,
  DOSERROR: 0x000d,
  /** V38 */
  NOTARGET: 0x000e,
  TARGETTOOSMALL: 0x000f,
  TARGETNOTSUPPORTED: 0x0010,

  /** V34, the hunk-structure range */
  UNDEFINEDHUNK: 0x1000,
  NOHUNKHEADER: 0x1001,
  BADEXTTYPE: 0x1002,
  BUFFERTRUNCATED: 0x1003,
  WRONGHUNKAMOUNT: 0x1004,
  /** V36 */
  NOOVERLAYS: 0x1005,

  /** V34, the relocation range */
  UNSUPPORTEDHUNK: 0x2000,
  BADRELMODE: 0x2001,
} as const

/**
 * The exact strings returned by `xfdGetErrorText` at `$9e0`, including its
 * unusual leading slash for success and lower-case spelling. The fallback is
 * the table's `$ffff` entry.
 */
export const XFDERR_TEXT: Readonly<Record<number, string>> = {
  [XFDERR.OK]: '/no errors',
  [XFDERR.NOMEMORY]: 'out of memory',
  [XFDERR.NOSLAVE]: 'missing slave entry',
  [XFDERR.NOTSUPPORTED]: 'not supported',
  [XFDERR.UNKNOWN]: 'unknown file',
  [XFDERR.NOSOURCE]: 'no source specified',
  [XFDERR.WRONGPASSWORD]: 'wrong password',
  [XFDERR.BADHUNK]: 'bad hunk structure',
  [XFDERR.CORRUPTEDDATA]: 'corrupted data',
  [XFDERR.MISSINGRESOURCE]: 'missing resource',
  [XFDERR.WRONGKEY]: 'wrong 16/32 bit key',
  [XFDERR.BETTERCPU]: 'better cpu required',
  [XFDERR.HOOKBREAK]: 'hook caused break',
  [XFDERR.DOSERROR]: 'dos error',
  [XFDERR.NOTARGET]: 'no user target',
  [XFDERR.TARGETTOOSMALL]: 'user target too small',
  [XFDERR.TARGETNOTSUPPORTED]: 'user target not supported',
  [XFDERR.UNDEFINEDHUNK]: 'undefined hunk type',
  [XFDERR.NOHUNKHEADER]: 'file is not executable',
  [XFDERR.BADEXTTYPE]: 'bad hunk_ext type',
  [XFDERR.BUFFERTRUNCATED]: 'buffer truncated',
  [XFDERR.WRONGHUNKAMOUNT]: 'wrong amount of hunks',
  [XFDERR.NOOVERLAYS]: 'overlays not allowed',
  [XFDERR.UNSUPPORTEDHUNK]: 'unsupported hunk type',
  [XFDERR.BADRELMODE]: 'unknown relocation mode',
}

/** `xfdGetErrorText(error)` (-78). See the DEVIATION on XFDERR_TEXT. */
export function getErrorText(error: number): string {
  return XFDERR_TEXT[error] ?? 'undefined error'
}

/**
 * `xfdbi_PackerFlags`, the bit numbers from xfdmaster.h.
 *
 * The first three are the packer's KIND and are what a caller checks before
 * deciding what to do with the result: a RELOC or ADDR packer produced an
 * executable, a DATA packer produced a file.
 */
export const XFDPFB = {
  RELOC: 0,
  ADDR: 1,
  DATA: 2,
  PASSWORD: 4,
  /** V34 */
  RELMODE: 5,
  /** V35 */
  KEY16: 6,
  KEY32: 7,
  /** V37, private to the library */
  EXTERN: 15,
} as const

export const XFDPFF = {
  RELOC: 1 << XFDPFB.RELOC,
  ADDR: 1 << XFDPFB.ADDR,
  DATA: 1 << XFDPFB.DATA,
  PASSWORD: 1 << XFDPFB.PASSWORD,
  RELMODE: 1 << XFDPFB.RELMODE,
  KEY16: 1 << XFDPFB.KEY16,
  KEY32: 1 << XFDPFB.KEY32,
  EXTERN: 1 << XFDPFB.EXTERN,
} as const

/** `xfdbi_Flags`, which influence recognition rather than describe it (V37) */
export const XFDFB = {
  RECOGEXTERN: 0,
  RECOGTARGETLEN: 1,
  RECOGUSERTARGET: 2,
  USERTARGET: 3,
  /** V39 */
  MASTERALLOC: 4,
} as const

export const XFDFF = {
  RECOGEXTERN: 1 << XFDFB.RECOGEXTERN,
  RECOGTARGETLEN: 1 << XFDFB.RECOGTARGETLEN,
  RECOGUSERTARGET: 1 << XFDFB.RECOGUSERTARGET,
  USERTARGET: 1 << XFDFB.USERTARGET,
  MASTERALLOC: 1 << XFDFB.MASTERALLOC,
} as const

/**
 * `struct xfdBufferInfo`, with the fields this port fills in.
 *
 * The names are the header's, minus the `xfdbi_` prefix, because a reader
 * checking this against `xfdmaster.h` should not have to translate. Fields
 * that only mean something to a real allocator are absent rather than present
 * and always zero: `Slave` is marked PRIVATE in the header, and
 * `TargetBufMemType` selects a chip or fast pool that a JavaScript array does
 * not have.
 */
export interface XfdBufferInfo {
  /** xfdbi_SourceBuffer */
  sourceBuffer: Uint8Array
  /** xfdbi_PackerName, set by recogBuffer */
  packerName?: string | undefined
  /** xfdbi_PackerFlags */
  packerFlags?: number | undefined
  /** xfdbi_Error */
  error?: number | undefined
  /** xfdbi_TargetBuffer, set by decrunchBuffer */
  targetBuffer?: Uint8Array | undefined
  /** xfdbi_TargetBufSaveLen: the USED length, which is what a caller writes out */
  targetBufSaveLen?: number | undefined
  /** xfdbi_Flags */
  flags?: number | undefined
  /** xfdbi_MinTargetLen, V38, -1 when the slave cannot say */
  minTargetLen?: number | undefined
  /** xfdbi_FinalTargetLen, V38, -1 when the slave cannot say */
  finalTargetLen?: number | undefined
}

/**
 * One decruncher, which xfdmaster calls a SLAVE.
 *
 * `recog` must be cheap and must not throw: the library runs every slave's
 * recognition over every file it is asked about, so a slave that reads past
 * the end of a short buffer would take the whole scan down.
 */
export interface XfdSlave {
  /** xfds_MasterVersion is not modelled; this is xfds_PackerName */
  name: string
  /** xfds_PackerFlags */
  flags: number
  /** xfds_RecogSize, the least the recogniser needs to see */
  recogSize: number
  recog(data: Uint8Array): boolean
  /** the decrunched length before decrunching, or -1 when it cannot be known */
  length?(data: Uint8Array): number
  /** throws or returns null on corrupt input; both are turned into XFDERR */
  decrunch(data: Uint8Array): Uint8Array | null
}

const be32 = (d: Uint8Array, at: number): number =>
  ((d[at]! << 24) | (d[at + 1]! << 16) | (d[at + 2]! << 8) | d[at + 3]!) >>> 0

/**
 * The slaves this port has codecs for.
 *
 * Four, against the roughly seventy `xfd_Developer/Sources/ASM` ships. That
 * gap is the honest state of things and not a bug: each of these was written
 * because one extension needed it, and this file makes them reachable
 * together rather than conjuring the other sixty-six.
 *
 * ByteKiller is deliberately ABSENT even though `./bytekiller.ts` decrunches
 * it. Its own header says bare ByteKiller data "has no magic AT ALL", so a
 * recogniser for it could only guess, and a slave that guesses would claim
 * files belonging to every other slave. xfdmaster's own ByteKillerClone slave
 * is in the archive and the day someone reads it is the day this gains a
 * fifth entry.
 */
export const SLAVES: readonly XfdSlave[] = [
  {
    name: 'PowerPacker',
    flags: XFDPFF.DATA,
    recogSize: 12,
    recog: (d) => d.length >= 12 && (be32(d, 0) === 0x50503230 || be32(d, 0) === 0x50503131),
    // the trailer is the decrunched length in the HIGH three bytes and the
    // skip-bit count in the low one, which is how ./powerpacker.ts reads it
    length: (d) => (d.length >= 12 ? be32(d, d.length - 4) >>> 8 : -1),
    decrunch: (d) => pp20Decrunch(d),
  },
  {
    name: 'Imploder',
    flags: XFDPFF.DATA,
    recogSize: 12,
    recog: isImploded,
    decrunch: (d) => explodeChecked(d),
  },
  {
    name: 'StoneCracker 4.04',
    flags: XFDPFF.DATA,
    recogSize: 16,
    recog: isStoneCracked,
    length: (d) => (isStoneCracked(d) ? stcLength(d) : -1),
    decrunch: (d) => stcDecrunch(d),
  },
]

/**
 * `xfdRecogBuffer(bufferinfo)` (-54).
 *
 * "Examines a file for known crunchers... RESULT success - TRUE if a cruncher
 * has been recognized, FALSE if file is unknown." On a hit it fills in
 * PackerName and PackerFlags, and MinTargetLen and FinalTargetLen for the
 * slaves that can say.
 *
 * DEVIATION: which slave wins when two recognise the same file. The library
 * walks its installed list, while this
 * takes the first slave in `SLAVES` that recognises, which is a stated rule
 * rather than the library's. It costs nothing today because all three
 * recognisers are distinct four-byte magics, and it will cost something the
 * moment a slave without a magic is added, which is one of the reasons
 * ByteKiller is not one.
 */
export function recogBuffer(bi: XfdBufferInfo, slaves: readonly XfdSlave[] = SLAVES): boolean {
  bi.packerName = undefined
  bi.packerFlags = undefined
  bi.error = XFDERR.OK
  if (bi.sourceBuffer.length === 0) {
    bi.error = XFDERR.NOSOURCE
    return false
  }
  for (const s of slaves) {
    if (bi.sourceBuffer.length < s.recogSize) continue
    if (!s.recog(bi.sourceBuffer)) continue
    bi.packerName = s.name
    bi.packerFlags = s.flags
    const len = s.length?.(bi.sourceBuffer) ?? -1
    bi.minTargetLen = len
    bi.finalTargetLen = len
    return true
  }
  bi.error = XFDERR.UNKNOWN
  return false
}

/**
 * `xfdDecrunchBuffer(bufferinfo)` (-60).
 *
 * The caller must have successfully called `recogBuffer` first. The binary at
 * `$4fa..$502` reads the private Slave pointer and returns XFDERR_NOSLAVE when
 * it is null; it does not perform recognition as a convenience.
 *
 * A codec that throws or answers null becomes XFDERR_CORRUPTEDDATA, which is
 * the header's "Crunched data is corrupted" and is what a truncated or
 * tampered file actually is.
 */
export function decrunchBuffer(bi: XfdBufferInfo, slaves: readonly XfdSlave[] = SLAVES): boolean {
  bi.targetBuffer = undefined
  bi.targetBufSaveLen = undefined
  if (bi.packerName === undefined) {
    bi.error = XFDERR.NOSLAVE
    return false
  }
  const slave = slaves.find((s) => s.name === bi.packerName)
  if (slave === undefined) {
    bi.error = XFDERR.NOSLAVE
    return false
  }
  let out: Uint8Array | null = null
  try {
    out = slave.decrunch(bi.sourceBuffer)
  } catch {
    out = null
  }
  if (out === null) {
    bi.error = XFDERR.CORRUPTEDDATA
    return false
  }
  bi.targetBuffer = out
  bi.targetBufSaveLen = out.length
  bi.error = XFDERR.OK
  return true
}

/**
 * Everything above in one call, for a caller that only wants the bytes.
 *
 * Not part of the library. It exists because the three-step dance is the
 * library's and not this port's, and a file tree asking "is this packed"
 * should not have to allocate a BufferInfo to find out.
 */
export function unpack(data: Uint8Array): { name: string; data: Uint8Array } | null {
  const bi: XfdBufferInfo = { sourceBuffer: data }
  if (!recogBuffer(bi)) return null
  if (!decrunchBuffer(bi)) return null
  return { name: bi.packerName!, data: bi.targetBuffer! }
}
