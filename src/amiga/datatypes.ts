/**
 * `datatypes.library` — what a file IS, and which class handles it.
 *
 * Commodore's answer to the question every file manager asks. The library
 * itself decodes nothing: it identifies data and names the class library that
 * knows how to read it, and the classes (`picture.datatype`, `sound.datatype`
 * and the per-format ones under them) do the work. Keeping that split is why
 * this file has no importers outside the layer and needs none.
 *
 * ## Evidence
 *
 * Unusually good, and unusually little of it is disassembly, because the
 * interesting part of this library is DATA that ships beside it.
 *
 * The interface is `datatypes_lib.fd`, `##bias 30`, taken from GUI 2.10's own
 * `Tools/FD` in the corpus. Its first entry is private, which is why
 * `ObtainDataTypeA` is -36 rather than -30, and its comment says why:
 * "functions in V40 or higher (Release 3.1)".
 *
 * The descriptors are ten real files out of a Workbench 3.0 `Devs/DataTypes`
 * drawer on the AMOS PD Library CD, and `struct DataTypeHeader` below was
 * read out of them rather than out of a header. Taking ILBM: its DTHD chunk
 * begins with $38, $3d, $42, $20, and adding each to the chunk's own start
 * lands exactly on "ILBM", "ilbm", "#?" and the mask words. Then "pict",
 * "ilbm", $000c. Ten files, every one decoding to the same 32-byte shape
 * with no slack, which is a stronger check than a header would have been.
 *
 * `datatypes.library` itself is in the corpus too, 18,388 bytes dated 3
 * September 1992, and is the place to go for anything below that this file
 * marks as unread.
 *
 * ## The mask, which is the whole identification
 *
 * One WORD per byte of the file, compared against the bytes from offset 0.
 * $ffff matches anything. That reading is forced rather than chosen: every
 * literal in all ten descriptors is $0000..$00ff, so $ffff cannot be a
 * byte value, and it is -1 as a signed word which is what `dth_MaskLen` being
 * a WORD count of a WORD array implies.
 *
 * ILBM's is `F O R M ?? ?? ?? ?? I L B M`, which is an IFF FORM with its
 * length skipped. JPEG's is `ff d8 ff e0 ?? ?? J F I F`. GIF's is
 * `G I F 8 ?? a`, matching both 87a and 89a.
 *
 * ## What this does NOT identify
 *
 * Archives, modules and crunched files. The group IDs are media: AROS's own
 * table (`workbench/libs/datatypes/getdtstring.c`) lists nine and there is no
 * archive among them, so a tenth would be an invention rather than a port.
 * The Amiga's answer for archives was `xadmaster.library` and for crunched
 * files `xfdmaster.library`, which are separate subsystems and belong in
 * separate files. `./decrunchlib.ts` already identifies 16 data formats and
 * 76 executable ones and is the second of those in all but name.
 *
 * A caller wanting one answer for any file asks this first and falls through.
 * The fallthrough is the caller's policy and is deliberately not here.
 */

/**
 * The jump table, from `datatypes_lib.fd`.
 *
 * `datatypesPrivate1` occupies the first slot, so the public list starts six
 * lower than the bias and ObtainDataTypeA is -36. Three more private slots
 * sit between PrintDTObjectA and GetDTString, which is why the last entry is
 * -138 and not -120. Both gaps are the kind that come out six or eighteen
 * wrong when an .fd is skimmed rather than counted; the test counts.
 */
export const LVO = {
  ObtainDataTypeA: -36,
  ReleaseDataType: -42,
  NewDTObjectA: -48,
  DisposeDTObject: -54,
  SetDTAttrsA: -60,
  GetDTAttrsA: -66,
  AddDTObject: -72,
  RefreshDTObjectA: -78,
  DoAsyncLayout: -84,
  DoDTMethodA: -90,
  RemoveDTObject: -96,
  GetDTMethods: -102,
  GetDTTriggerMethods: -108,
  PrintDTObjectA: -114,
  GetDTString: -138,
} as const

/**
 * `struct DataTypeHeader`, 32 bytes, read off the descriptors.
 *
 * Every one of the first four fields is an OFFSET from the start of the DTHD
 * chunk where the machine has a pointer, which is what lets a descriptor be a
 * file that can be loaded anywhere. The library relocates them on load; here
 * they are resolved at parse time and never seen again.
 */
export const DTHD = {
  Name: 0,
  BaseName: 4,
  Pattern: 8,
  Mask: 12,
  GroupID: 16,
  ID: 20,
  MaskLen: 24,
  /** the word between MaskLen and Flags, zero in all ten */
  Pad: 26,
  Flags: 28,
  Priority: 30,
  SIZEOF: 32,
} as const

/**
 * `dth_Flags`, the low two bits, which say how the file is built rather than
 * how it is matched.
 *
 * Every mask in the set is applied the same way from offset 0, so this
 * changes nothing about identification. It tells a CLASS what it is holding.
 * The values are read off the set: 2 on the three IFF descriptors (ILBM,
 * 8SVX, FTXT, whose masks all begin `F O R M`), 1 on AmigaGuide (whose mask
 * is the literal text `@database`), 0 on the six binary ones.
 */
export const DTF = {
  BINARY: 0,
  ASCII: 1,
  IFF: 2,
  /** the mask the two bits occupy */
  TYPE_MASK: 0x3,
} as const

/**
 * `dth_GroupID`, the four-character class.
 *
 * The four in the shipped set are `pict`, `soun`, `text` and `docu`. The rest
 * are AROS's, from the table in `workbench/libs/datatypes/getdtstring.c`,
 * which names nine and stops:
 *
 *     { GID_SYSTEM, "System" },   { GID_TEXT,      "Text" },
 *     { GID_DOCUMENT, "Document" }, { GID_SOUND,   "Sound" },
 *     { GID_INSTRUMENT, "Instrument" }, { GID_MUSIC, "Music" },
 *     { GID_PICTURE, "Picture" }, { GID_ANIMATION, "Animation" },
 *     { GID_MOVIE, "Movie" },
 *
 * Nine, and no archive. That absence is the reason this port keeps archives
 * in their own subsystem rather than adding a tenth.
 */
export const GID = {
  SYSTEM: 'syst',
  TEXT: 'text',
  DOCUMENT: 'docu',
  SOUND: 'soun',
  INSTRUMENT: 'inst',
  MUSIC: 'musi',
  PICTURE: 'pict',
  ANIMATION: 'anim',
  MOVIE: 'movi',
} as const

export type GroupID = (typeof GID)[keyof typeof GID]

/** one descriptor, with the offsets already resolved to the things they named */
export interface DataTypeHeader {
  /** dth_Name: what a user is shown, "Windows Bitmap" */
  name: string
  /** dth_BaseName: the class, "ilbm" meaning `ilbm.datatype` */
  baseName: string
  /** dth_Pattern: an AmigaDOS pattern, usually "#?" */
  pattern: string
  /** dth_GroupID */
  groupID: string
  /**
   * dth_ID, kept as the four bytes it is.
   *
   * Two of the shipped ten make that worth saying. GIF's is `gif\0`, three
   * characters and a NUL, because on the machine this is a ULONG and nothing
   * requires all four to be printable. And "Windows Bitmap" and "Windows
   * Icon" BOTH carry `wind`, so the id is not unique even within one group:
   * `baseName` is what separates them, `bmp` against `ico`. Trimming or
   * de-duplicating either would be tidying evidence.
   */
  id: string
  /** dth_Flags */
  flags: number
  /** dth_Priority: ties are broken by it, and every shipped one is 0 */
  priority: number
  /** dth_Mask, one word per byte, $ffff matching anything */
  mask: readonly number[]
}

/** IFF chunk id, four characters */
function fourCC(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!)
}

/** a NUL-terminated string at an offset, which is what the four pointers name */
function cstr(b: Uint8Array, at: number): string {
  let end = at
  while (end < b.length && b[end] !== 0) end++
  return String.fromCharCode(...b.subarray(at, end))
}

/**
 * Read one `DEVS:DataTypes` file.
 *
 * Null for anything that is not a `FORM DTYP` with a DTHD in it, which is
 * what lets a caller point this at the whole drawer and ignore the `.info`
 * files and the licence text sitting beside the descriptors.
 */
export function parseDescriptor(bytes: Uint8Array): DataTypeHeader | null {
  if (bytes.length < 12 || fourCC(bytes, 0) !== 'FORM' || fourCC(bytes, 8) !== 'DTYP') return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  let at = 12
  let dthd = -1
  while (at + 8 <= bytes.length) {
    const id = fourCC(bytes, at)
    const len = dv.getUint32(at + 4)
    if (id === 'DTHD') dthd = at + 8
    // IFF pads odd chunks to an even boundary
    at += 8 + len + (len & 1)
  }
  if (dthd < 0 || dthd + DTHD.SIZEOF > bytes.length) return null

  const maskAt = dthd + dv.getUint32(dthd + DTHD.Mask)
  const maskLen = dv.getInt16(dthd + DTHD.MaskLen)
  if (maskLen < 0 || maskAt + maskLen * 2 > bytes.length) return null
  const mask: number[] = []
  for (let i = 0; i < maskLen; i++) mask.push(dv.getUint16(maskAt + i * 2))

  return {
    name: cstr(bytes, dthd + dv.getUint32(dthd + DTHD.Name)),
    baseName: cstr(bytes, dthd + dv.getUint32(dthd + DTHD.BaseName)),
    pattern: cstr(bytes, dthd + dv.getUint32(dthd + DTHD.Pattern)),
    groupID: fourCC(bytes, dthd + DTHD.GroupID),
    id: fourCC(bytes, dthd + DTHD.ID),
    flags: dv.getUint16(dthd + DTHD.Flags),
    priority: dv.getInt16(dthd + DTHD.Priority),
    mask,
  }
}

/** does this descriptor's mask match the front of `data`? */
export function maskMatches(dt: DataTypeHeader, data: Uint8Array): boolean {
  if (data.length < dt.mask.length) return false
  for (let i = 0; i < dt.mask.length; i++) {
    const want = dt.mask[i]!
    if (want === WILDCARD) continue
    if (data[i] !== want) return false
  }
  return true
}

/** $ffff, which is -1 as a signed word and cannot be a byte */
export const WILDCARD = 0xffff

/**
 * `ObtainDataTypeA(DTST_MEMORY, ...)` (-36): which descriptor claims this
 * data, or null when none does.
 *
 * DEVIATION: the ORDER, not the matching. Which
 * descriptor a real library returns when two match is decided inside the
 * binary, and this file has not read that code. What it does instead is
 * stated rather than hidden: descriptors are tried by priority descending,
 * and MASK LENGTH descending within a priority, so the most specific match
 * wins. That is a defensible rule and it is not necessarily Commodore's.
 *
 * The set makes the question real rather than theoretical. MacPaint's whole
 * mask is one byte of $00, so it matches any file starting with a zero byte,
 * which includes every Windows Icon and plenty else. Every shipped descriptor
 * has priority 0, so on the real machine something else must be separating
 * them, and longest-mask-first is this port's answer until the binary is
 * read.
 */
export function obtainDataType(data: Uint8Array, types: readonly DataTypeHeader[]): DataTypeHeader | null {
  let best: DataTypeHeader | null = null
  for (const dt of types) {
    if (!maskMatches(dt, data)) continue
    if (best === null || dt.priority > best.priority || (dt.priority === best.priority && dt.mask.length > best.mask.length)) {
      best = dt
    }
  }
  return best
}

/** every descriptor that matched, most specific first, for a caller that wants to see the tie */
export function candidates(data: Uint8Array, types: readonly DataTypeHeader[]): DataTypeHeader[] {
  return types
    .filter((dt) => maskMatches(dt, data))
    .sort((a, b) => b.priority - a.priority || b.mask.length - a.mask.length)
}
