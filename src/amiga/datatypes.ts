/**
 * `datatypes.library` — what a file IS, and which class handles it.
 *
 * Commodore's answer to the question every file manager asks. The library
 * itself identifies data and names the class library that handles it. This
 * service also owns the decoded class-object state used by the runtime's
 * datatype methods.
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
import { decodeMacPaint } from './macpaint'
import { encodeIlbm, parseIlbm } from './ilbm'
import { decodeBmp, decodeIco, quantiseRgb, type IndexedBitmap } from './windowsbitmap'
import { decodePcx } from './pcx'
import { decodeGif } from './gif'
import { decodeJpeg } from './jpeg'
import { decode8svx, type Voice8svx } from './iff8svx'
import { decodeDataTypeText } from './datatype-text'
import { periodToHz, samPeriod } from './paula'
import type { AudioSink, PrinterPage } from './host'
import type { RastPort } from './graphics'
import { parseAmigaGuide, type AmigaGuideDocument, type AmigaGuideInline } from './amigaguide'
import {
  Boopsi, GA, GM, OM_DISPOSE, OM_GET, OM_NEW, OM_SET, OM_UPDATE, TAG_DONE, doMethodA, doSuperMethodA, getAttr, setAttrsA,
  type BoopsiClass, type BoopsiObject, type Msg, type OpGet, type OpSet,
} from './boopsi'

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

/** Standard DTM_TRIGGER function numbers used by the held datatype classes. */
export const STM = {
  Done: 0, Pause: 1, Play: 2, Contents: 3, Index: 4, Retrace: 5,
  BrowsePrev: 6, BrowseNext: 7, NextField: 8, PrevField: 9,
  ActivateField: 10, Command: 11, Help: 17,
} as const

export const STMD = { Mask: 0x00ff0000, StrPtr: 0x00030000 } as const

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
  MISC: 3,
  /** the mask the two bits occupy */
  TYPE_MASK: 0xf,
  CASE: 0x10,
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

/** Release 40.15 datatype class tags used by the managed object backend. */
const DUMMY = 0x80001000
export const DTA = {
  TextAttr: DUMMY + 10,
  TopVert: DUMMY + 11, VisibleVert: DUMMY + 12, TotalVert: DUMMY + 13, VertUnit: DUMMY + 14,
  TopHoriz: DUMMY + 15, VisibleHoriz: DUMMY + 16, TotalHoriz: DUMMY + 17, HorizUnit: DUMMY + 18,
  NodeName: DUMMY + 19, Title: DUMMY + 20, TriggerMethods: DUMMY + 21, Data: DUMMY + 22,
  TextFont: DUMMY + 23, Methods: DUMMY + 24, PrinterStatus: DUMMY + 25,
  PrinterProc: DUMMY + 26, LayoutProc: DUMMY + 27, Busy: DUMMY + 28, Sync: DUMMY + 29,
  BaseName: DUMMY + 30, GroupID: DUMMY + 31,
  ErrorLevel: DUMMY + 32, ErrorNumber: DUMMY + 33, ErrorString: DUMMY + 34,
  Name: DUMMY + 100, DataType: DUMMY + 103, ObjName: DUMMY + 109,
  SourceType: DUMMY + 101, Handle: DUMMY + 102,
  ObjAuthor: DUMMY + 110, ObjAnnotation: DUMMY + 111, ObjCopyright: DUMMY + 112,
  ObjVersion: DUMMY + 113, ObjectID: DUMMY + 114, UserData: DUMMY + 115,
  NominalVert: DUMMY + 124, NominalHoriz: DUMMY + 125,
  Domain: DUMMY + 104, FrameInfo: DUMMY + 116,
  SelectDomain: DUMMY + 121, TotalPVert: DUMMY + 122, TotalPHoriz: DUMMY + 123,
  DestCols: DUMMY + 400, DestRows: DUMMY + 401, Special: DUMMY + 402, RastPort: DUMMY + 403,
} as const
export const PDTA = {
  ModeID: DUMMY + 200, BitMapHeader: DUMMY + 201, BitMap: DUMMY + 202,
  ColorRegisters: DUMMY + 203, CRegs: DUMMY + 204, GRegs: DUMMY + 205,
  ColorTable: DUMMY + 206, ColorTable2: DUMMY + 207, Allocated: DUMMY + 208,
  NumColors: DUMMY + 209, NumAlloc: DUMMY + 210, Remap: DUMMY + 211,
  Screen: DUMMY + 212, FreeSourceBitMap: DUMMY + 213, Grab: DUMMY + 214,
  DestBitMap: DUMMY + 215, ClassBitMap: DUMMY + 216, NumSparse: DUMMY + 217,
  SparseTable: DUMMY + 218,
} as const
export const TDTA = {
  Buffer: DUMMY + 300, BufferLen: DUMMY + 301, LineList: DUMMY + 302,
  WordSelect: DUMMY + 303, WordDelim: DUMMY + 304, WordWrap: DUMMY + 305,
} as const
const SDUMMY = DUMMY + 500
export const SDTA = {
  VoiceHeader: SDUMMY + 1, Sample: SDUMMY + 2, SampleLength: SDUMMY + 3,
  Period: SDUMMY + 4, Volume: SDUMMY + 5, Cycles: SDUMMY + 6,
} as const

/** Release 40.15 datatypesclass.h method IDs. */
export const DTM = {
  FrameBox: 0x601, ProcLayout: 0x602, AsyncLayout: 0x603, RemoveDTObject: 0x604,
  Select: 0x605, ClearSelected: 0x606, Copy: 0x607, Print: 0x608, AbortPrint: 0x609,
  GoTo: 0x630, Trigger: 0x631, ObtainDrawInfo: 0x640, Draw: 0x641,
  ReleaseDrawInfo: 0x642, Write: 0x650,
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

function fourCCValue(text: string): number {
  return (((text.charCodeAt(0) & 0xff) << 24) | ((text.charCodeAt(1) & 0xff) << 16) |
    ((text.charCodeAt(2) & 0xff) << 8) | (text.charCodeAt(3) & 0xff)) >>> 0
}

/** a NUL-terminated string at an offset, which is what the four pointers name */
function cstr(b: Uint8Array, at: number): string {
  let end = at
  while (end < b.length && b[end] !== 0) end++
  return String.fromCharCode(...b.subarray(at, end))
}

function iffMetadata(bytes: Uint8Array): Partial<Record<'name' | 'author' | 'annotation' | 'copyright' | 'version', string>> {
  const result: Partial<Record<'name' | 'author' | 'annotation' | 'copyright' | 'version', string>> = {}
  if (bytes.length < 12 || fourCC(bytes, 0) !== 'FORM') return result
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = Math.min(bytes.length, 8 + view.getUint32(4)); const fields = new Map<string, keyof typeof result>([
    ['NAME', 'name'], ['AUTH', 'author'], ['ANNO', 'annotation'], ['(c) ', 'copyright'], ['VERS', 'version'],
  ])
  for (let at = 12; at + 8 <= end;) {
    const size = view.getUint32(at + 4); const next = at + 8 + size
    if (next > end) break
    const field = fields.get(fourCC(bytes, at))
    if (field) {
      const data = bytes.subarray(at + 8, next); const zero = data.indexOf(0)
      result[field] = new TextDecoder('latin1').decode(zero < 0 ? data : data.subarray(0, zero))
    }
    at = next + (size & 1)
  }
  return result
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
    const got = data[i]!
    if (got !== want && ((dt.flags & DTF.CASE) !== 0 ||
      String.fromCharCode(got).toLowerCase() !== String.fromCharCode(want).toLowerCase())) return false
  }
  return true
}

/** $ffff, which is -1 as a signed word and cannot be a byte */
export const WILDCARD = 0xffff

/**
 * `ObtainDataTypeA(DTST_MEMORY, ...)` (-36): which descriptor claims this
 * data, or null when none does.
 *
 * The V39 library classifies the first buffer as IFF, ASCII or binary, walks
 * that priority-sorted descriptor list, applies the case-insensitive mask and
 * then calls the concrete datatype's validation hook. That last step matters:
 * MacPaint's one-byte zero mask also matches Windows icons, but macpaint.datatype
 * rejects their structure and the walk continues to ico.datatype.
 */
export function obtainDataType(data: Uint8Array, types: readonly DataTypeHeader[]): DataTypeHeader | null {
  // DTST_FILE also compares the FORM length with the FileInfoBlock size. This
  // memory-facing helper may intentionally hold only the probe bytes, so the
  // IFF envelope itself is the information available at this boundary.
  const envelope = data.length >= 12 ? String.fromCharCode(...data.subarray(0, 4)) : ''
  const form = envelope === 'FORM' || envelope === 'CAT ' || envelope === 'LIST'
  let printable = 0
  for (const byte of data.subarray(0, Math.min(64, data.length))) if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127)) printable++
  const kind = form ? DTF.IFF : printable > Math.min(64, data.length) * 3 / 4 ? DTF.ASCII : DTF.BINARY
  return candidates(data, types)
    .find(dt => (dt.flags & DTF.TYPE_MASK) === kind && validateDescriptor(data, dt)) ?? null
}

/**
 * `ReleaseDataType(dt)` (-42). Descriptors are immutable shared records in
 * this backend, so releasing one has no observable work to perform.
 */
export function releaseDataType(_dt: DataTypeHeader | null): void {}

/** Every mask match in the priority order used by the descriptor lists. */
export function candidates(data: Uint8Array, types: readonly DataTypeHeader[]): DataTypeHeader[] {
  return types
    .filter((dt) => maskMatches(dt, data))
    .map((dt, order) => ({ dt, order }))
    .sort((a, b) => b.dt.priority - a.dt.priority || a.order - b.order)
    .map(item => item.dt)
}

export interface DataTypeObject {
  address: number
  /** the same object registered in the machine-wide BOOPSI object space */
  object: BoopsiObject
  path: string
  descriptor: DataTypeHeader
  attributes: Map<number, number>
  window: number
  requester: number
  position: number
  /** allocations owned by the class object and released with it */
  owned: number[]
  media: IndexedBitmap | Voice8svx | AmigaGuideDocument | string | null
  source: Uint8Array
  soundPlaying: boolean
  /** AmigaGuide node identity and DTM_TRIGGER retrace stack. */
  guideNode: string
  guideHistory: string[]
  guideField: number
  /** replaceable allocations backing TDTA_LineList after buffer mutation */
  textLayoutOwned: number[]
  textLayoutKey: string
  textSelection: { start: number; end: number } | null
  /** stable internal IBox returned by DTA_SelectDomain while highlighted */
  selectionDomain: number
  /** stable public IBox returned by DTA_Domain */
  domain: number
}

/** Managed form of the public DTM_* message records after pointer translation. */
export interface DataTypeMethodMessage extends Msg {
  window?: number
  frameSize?: number
  putFrame?: (frame: Uint8Array) => boolean
  nodeName?: string
  triggerFunction?: number
  triggerData?: string
  putCopy?: (bytes: Uint8Array) => boolean
  writeMode?: number
  putWrite?: (bytes: Uint8Array) => boolean
  rastPort?: RastPort
  left?: number
  top?: number
  width?: number
  height?: number
  topHoriz?: number
  topVert?: number
  select?: { minX: number; minY: number; maxX: number; maxY: number }
  printAttrs?: ReadonlyMap<number, number>
}

function guideText(items: readonly AmigaGuideInline[]): string {
  return items.map(item => item.type === 'text' ? item.text : item.type === 'link' ? guideText(item.label) : '').join('')
}

export interface DataTypePicture extends IndexedBitmap { mode: number }

/*
 * The V39.5 sound.datatype data hunk: a 54x24, two-plane Image used by
 * GM_RENDER. Rows are word-rounded to eight bytes per plane. Keeping the
 * native planes here also keeps refresh and BOOPSI rendering on one path.
 */
const SOUND_ICON_PLANES = Uint8Array.from((
  '000000100200000000000028040000000000006808000400000000a810000c00' +
  '0000012820000c000000f22800c00c0000010e2803000c0000010a280c000c00' +
  '00010a2800000c0000010a2800000c0000010a2807e00c0000010a2800000c00' +
  '00010a2800000c0000010a280c000c0000010e2803000c000000f22800c00c00' +
  '0000012820000c00000000a810000c000000006808000c000000002804000c00' +
  '0000001002000c000000000000000c000000000000000c007ffffffffffffc00' +
  '00000000000000000000001000000000ffffff93f77ff800d555555144555000' +
  'd55554d155555000d55505d151155000d554f1d154555000d554f5d151455000' +
  'd554f5d155155000d554f5d154555000d554f5d150155000d554f5d155555000' +
  'd554f5d154055000d554f5d151555000d554f1d154555000d55501d154155000' +
  'd55500d155155000d555415145455000d555551155555000d555555151555000' +
  'd555554155555000d555555154555000d5555551555550008000000000000000'
).match(/../g)!.map(byte => Number.parseInt(byte, 16)))
const SOUND_ICON_WIDTH = 54
const SOUND_ICON_HEIGHT = 24
const SOUND_ICON_ROW_BYTES = 8

/** Decode through the concrete class named by an already-obtained descriptor. */
export function decodeDataTypePicture(bytes: Uint8Array, descriptor: DataTypeHeader): DataTypePicture | null {
  try {
    if (descriptor.baseName === 'ilbm') {
      const image = parseIlbm(bytes)
      return { width: image.width, height: image.height, depth: image.depth, pixels: image.pixels, palette: [...image.palette], mode: image.mode }
    }
    if (descriptor.baseName === 'macpaint') {
      const image = decodeMacPaint(bytes)
      return image && { ...image, depth: 1, palette: [0xfff, 0], mode: 0x8004 }
    }
    const indexed = descriptor.baseName === 'bmp' ? decodeBmp(bytes)
      : descriptor.baseName === 'ico' ? decodeIco(bytes)
        : descriptor.baseName === 'pcx' ? decodePcx(bytes)
          : descriptor.baseName === 'gif' ? decodeGif(bytes) : null
    if (indexed) return { ...indexed, mode: 0 }
    if (descriptor.baseName === 'jpeg') {
      const image = decodeJpeg(bytes)
      const indexedJpeg = image && quantiseRgb(image.pixels, image.width, image.height)
      return indexedJpeg && { ...indexedJpeg, mode: 0 }
    }
  } catch { return null }
  return null
}

function validateDescriptor(bytes: Uint8Array, descriptor: DataTypeHeader): boolean {
  // The weak MacPaint descriptor has a validation hook; without it virtually
  // every zero-prefixed binary (including ICO) would be claimed. The other
  // descriptors in the held drawer are selected by their concrete masks;
  // object construction, not ObtainDataTypeA, performs their full decode.
  if (descriptor.baseName === 'macpaint') return decodeMacPaint(bytes) !== null
  return true
}

/** Shared native-facing DataTypes object lifecycle used by OS extensions. */
export class DataTypesService {
  readonly objects = new Map<number, DataTypeObject>()
  readonly obtained = new Map<number, DataTypeHeader>()
  private readonly methodLists = new Map<string, number>()
  private readonly nativeDescriptors = new Map<DataTypeHeader, number>()
  private readonly dataTypeClass: BoopsiClass
  private readonly classes = new Map<string, BoopsiClass>()
  constructor(private readonly memory: import('./exec').MemPool, readonly descriptors: readonly DataTypeHeader[],
    private readonly audio: () => AudioSink | null = () => null, private readonly boopsi = new Boopsi(memory),
    private readonly textPrinter: () => ((text: string) => void) | null = () => null,
    private readonly pagePrinter: () => ((page: PrinterPage) => void) | null = () => null,
    private readonly systemCommand: () => ((command: string) => boolean) | null = () => null) {
    this.boopsi.ensureIntuitionClasses()
    const existing = this.boopsi.findClass('datatypesclass')
    this.dataTypeClass = existing ?? this.boopsi.makeClass('datatypesclass', 'gadgetclass', (cl, obj, msg) => {
      if (msg.MethodID === OM_NEW) {
        // gadgetclass must not retain a second copy of datatype attributes.
        const made = this.boopsi.objectAt(doSuperMethodA(cl, obj, msg))
        if (!made) return 0
        const data = made.instData<{ attributes: Map<number, number> }>(cl)
        data.attributes = new Map()
        for (const item of (msg as OpSet).attrs) if (item.tag !== TAG_DONE && ((item.tag & 0xffff0000) >>> 0) !== 0x80030000) {
          data.attributes.set(item.tag >>> 0, item.data)
        }
        return made.address
      }
      if (msg.MethodID === OM_SET || msg.MethodID === OM_UPDATE) {
        const data = (obj as BoopsiObject).instData<{ attributes?: Map<number, number> }>(cl)
        data.attributes ??= new Map()
        const inherited = doSuperMethodA(cl, obj, msg); let used = 0
        const items = (msg as OpSet).attrs
        for (const item of items) if (item.tag !== TAG_DONE && ((item.tag & 0xffff0000) >>> 0) !== 0x80030000) {
          data.attributes.set(item.tag >>> 0, item.data); used++
        }
        this.applySet((obj as BoopsiObject).address, items)
        return inherited + used
      }
      if (msg.MethodID === OM_GET) {
        const get = msg as OpGet
        const value = (obj as BoopsiObject).instData<{ attributes?: Map<number, number> }>(cl).attributes?.get(get.attrID >>> 0)
        if (value === undefined) return doSuperMethodA(cl, obj, msg)
        get.storage = value; return 1
      }
      if (msg.MethodID === GM.Layout) return this.layout((obj as BoopsiObject).address) ? 1 : 0
      if (msg.MethodID === GM.HitTest) return 1
      if (msg.MethodID === GM.GoActive) {
        const address = (obj as BoopsiObject).address
        return this.objects.get(address)?.descriptor.groupID === GID.SOUND && this.trigger(address, STM.Play) ? 1 : 0
      }
      if (msg.MethodID === GM.Render) {
        const address = (obj as BoopsiObject).address; const port = (msg as DataTypeMethodMessage).rastPort
        if (!port) return 0
        const held = this.objects.get(address); if (!held) return 0
        if (held.descriptor.groupID === GID.SOUND) return this.drawSound(port) ? 1 : 0
        if (held.descriptor.groupID === GID.PICTURE) return this.draw(address, port, 0, 0,
          getAttr(GA.Width, held.object) ?? 0, getAttr(GA.Height, held.object) ?? 0,
          held.attributes.get(DTA.TopHoriz) ?? 0, held.attributes.get(DTA.TopVert) ?? 0) ? 1 : 0
        return this.drawText(address, port) ? 1 : 0
      }
      if (msg.MethodID === OM_DISPOSE) this.destroy((obj as BoopsiObject).address)
      else if (msg.MethodID >= DTM.FrameBox) return this.dispatchMethod((obj as BoopsiObject).address, msg as DataTypeMethodMessage)
      return doSuperMethodA(cl, obj, msg)
    })!
  }

  private classFor(descriptor: DataTypeHeader): BoopsiClass {
    const id = `${descriptor.baseName}.datatype`
    const old = this.classes.get(id) ?? this.boopsi.findClass(id)
    if (old) { this.classes.set(id, old); return old }
    const made = this.boopsi.makeClass(id, this.dataTypeClass, (cl, obj, msg) => doSuperMethodA(cl, obj, msg))!
    this.classes.set(id, made); return made
  }

  private destroy(address: number): void {
    const object = this.objects.get(address); if (!object) return
    if (object.soundPlaying) this.audio()?.stop(0)
    for (const owned of object.textLayoutOwned) this.memory.freeMem(owned)
    for (const owned of object.owned) this.memory.freeMem(owned)
    this.objects.delete(address)
  }

  private bytes(owned: number[], data: Uint8Array): number {
    const address = this.memory.alloc(Math.max(1, data.length), { clear: true })
    if (!address) return 0
    this.memory.buffer.set(data, address - this.memory.base); owned.push(address); return address
  }
  private string(owned: number[], text: string): number {
    const data = new Uint8Array(text.length + 1)
    for (let i = 0; i < text.length; i++) data[i] = text.charCodeAt(i) & 0xff
    return this.bytes(owned, data)
  }
  private put16(address: number, value: number): void {
    const at = address - this.memory.base; this.memory.buffer[at] = value >>> 8; this.memory.buffer[at + 1] = value
  }
  private put32(address: number, value: number): void { this.put16(address, value >>> 16); this.put16(address + 2, value) }
  /** Shared `struct DataType` and relocated `DataTypeHeader`, as returned by ObtainDataTypeA. */
  private descriptorAddress(descriptor: DataTypeHeader): number {
    const old = this.nativeDescriptors.get(descriptor); if (old) return old
    const record = this.memory.alloc(58, { clear: true }); const header = this.memory.alloc(DTHD.SIZEOF, { clear: true })
    if (!record || !header) { if (record) this.memory.freeMem(record); if (header) this.memory.freeMem(header); return 0 }
    const name = this.string([], descriptor.name); const baseName = this.string([], descriptor.baseName)
    const pattern = this.string([], descriptor.pattern); const mask = this.memory.alloc(Math.max(2, descriptor.mask.length * 2), { clear: true })
    if (!name || !baseName || !pattern || !mask) return 0
    descriptor.mask.forEach((value, i) => this.put16(mask + i * 2, value))
    this.put32(header + DTHD.Name, name); this.put32(header + DTHD.BaseName, baseName)
    this.put32(header + DTHD.Pattern, pattern); this.put32(header + DTHD.Mask, mask)
    this.put32(header + DTHD.GroupID, fourCCValue(descriptor.groupID))
    this.put32(header + DTHD.ID, fourCCValue(descriptor.id))
    this.put16(header + DTHD.MaskLen, descriptor.mask.length); this.put16(header + DTHD.Flags, descriptor.flags)
    this.put16(header + DTHD.Priority, descriptor.priority)
    this.put32(record + 28, header); this.put32(record + 54, 58)
    this.nativeDescriptors.set(descriptor, record); this.obtained.set(record, descriptor); return record
  }
  private pictureAttrs(owned: number[], image: IndexedBitmap, mode = 0): Map<number, number> {
    const attrs = new Map<number, number>([[DTA.NominalHoriz, image.width], [DTA.NominalVert, image.height],
      [PDTA.ModeID, mode], [PDTA.NumColors, image.palette.length]])
    const header = new Uint8Array(20); const hv = new DataView(header.buffer)
    hv.setUint16(0, image.width); hv.setUint16(2, image.height); header[8] = image.depth
    hv.setInt16(16, image.width); hv.setInt16(18, image.height)
    attrs.set(PDTA.BitMapHeader, this.bytes(owned, header))
    const regs = new Uint8Array(image.palette.length * 3)
    const cregs = new Uint8Array(image.palette.length * 12)
    image.palette.forEach((colour, i) => {
      const rgb = [((colour >> 8) & 15) * 17, ((colour >> 4) & 15) * 17, (colour & 15) * 17]
      regs.set(rgb, i * 3)
      for (let c = 0; c < 3; c++) cregs[i * 12 + c * 4] = rgb[c]!
    })
    attrs.set(PDTA.ColorRegisters, this.bytes(owned, regs)); attrs.set(PDTA.CRegs, this.bytes(owned, cregs))
    attrs.set(PDTA.GRegs, this.bytes(owned, cregs))
    const pens = Uint8Array.from({ length: image.palette.length }, (_, i) => i)
    attrs.set(PDTA.ColorTable, this.bytes(owned, pens)); attrs.set(PDTA.ColorTable2, this.bytes(owned, pens))
    const rowBytes = ((image.width + 15) >> 4) << 1
    const bitmap = new Uint8Array(40); const bv = new DataView(bitmap.buffer)
    bv.setUint16(0, rowBytes); bv.setUint16(2, image.height); bitmap[5] = image.depth
    for (let plane = 0; plane < Math.min(8, image.depth); plane++) {
      const bits = new Uint8Array(rowBytes * image.height)
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        if ((image.pixels[y * image.width + x]! & (1 << plane)) !== 0) bits[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7)
      }
      bv.setUint32(8 + plane * 4, this.bytes(owned, bits))
    }
    const bitmapAddress = this.bytes(owned, bitmap)
    attrs.set(PDTA.BitMap, bitmapAddress); attrs.set(PDTA.DestBitMap, bitmapAddress); attrs.set(PDTA.ClassBitMap, bitmapAddress)
    attrs.set(PDTA.Allocated, 0); attrs.set(PDTA.NumAlloc, 0); attrs.set(PDTA.Remap, 1)
    attrs.set(PDTA.Screen, 0); attrs.set(PDTA.FreeSourceBitMap, 0)
    attrs.set(PDTA.Grab, this.bytes(owned, new Uint8Array(4)))
    attrs.set(PDTA.NumSparse, 0); attrs.set(PDTA.SparseTable, 0)
    const frame = new Uint8Array(36); const fv = new DataView(frame.buffer)
    fv.setInt16(4, 1); fv.setInt16(6, 1); frame[8] = 4; frame[9] = 4; frame[10] = 4
    fv.setUint32(12, image.width); fv.setUint32(16, image.height); fv.setUint32(20, image.depth)
    fv.setUint32(32, 0x2 | 0x4) // FIF_SCROLLABLE | FIF_REMAPPABLE
    attrs.set(DTA.FrameInfo, this.bytes(owned, frame))
    return attrs
  }
  private soundAttrs(owned: number[], voice: Voice8svx): Map<number, number> {
    const sample = this.bytes(owned, new Uint8Array(voice.left.buffer, voice.left.byteOffset, voice.left.byteLength))
    const vh = new Uint8Array(20); const v = new DataView(vh.buffer)
    v.setUint32(0, voice.oneShot); v.setUint32(4, voice.repeat); v.setUint16(12, voice.rate)
    vh[14] = 1; vh[15] = voice.compression; v.setUint32(16, voice.volume)
    return new Map([[SDTA.VoiceHeader, this.bytes(owned, vh)], [SDTA.Sample, sample],
      [SDTA.SampleLength, voice.left.length], [SDTA.Period, samPeriod(voice.rate)],
      [SDTA.Volume, Math.min(64, (voice.volume * 64) >>> 16)], [SDTA.Cycles, 1]])
  }

  create(path: string, bytes: Uint8Array | null, attributes: ReadonlyMap<number, number>): number {
    if (!bytes) return 0
    const descriptor = obtainDataType(bytes, this.descriptors); if (!descriptor) return 0
    const picture = descriptor.groupID === GID.PICTURE ? decodeDataTypePicture(bytes, descriptor) : null
    const sound = descriptor.groupID === GID.SOUND ? decode8svx(bytes) : null
    const text = descriptor.baseName === 'ascii' ? decodeDataTypeText(bytes, descriptor.name) : null
    const guide = descriptor.baseName === 'amigaguide' ? parseAmigaGuide(bytes) : null
    if ((descriptor.groupID === GID.PICTURE && !picture) || (descriptor.groupID === GID.SOUND && !sound) ||
      (descriptor.baseName === 'ascii' && text === null) || (descriptor.baseName === 'amigaguide' && !guide)) return 0
    const owned: number[] = []
    const computed = picture ? this.pictureAttrs(owned, picture, picture.mode)
      : sound ? this.soundAttrs(owned, sound) : new Map<number, number>()
    if (text !== null) {
      const raw = new Uint8Array(text.length + 1); for (let i = 0; i < text.length; i++) raw[i] = text.charCodeAt(i) & 0xff
      computed.set(TDTA.Buffer, this.bytes(owned, raw)); computed.set(TDTA.BufferLen, text.length)
    }
    if (text !== null || guide) {
      computed.set(TDTA.WordSelect, 0)
      computed.set(TDTA.WordDelim, this.string(owned, '\t *-,()<>[];"'))
      computed.set(TDTA.WordWrap, guide?.wordWrap ? 1 : 0)
      computed.set(DTA.TextAttr, 0)
    }
    computed.set(DTA.Name, this.string(owned, path)); computed.set(DTA.ObjName, computed.get(DTA.Name)!)
    computed.set(DTA.Title, computed.get(DTA.ObjName)!)
    computed.set(DTA.ObjAuthor, 0); computed.set(DTA.ObjAnnotation, 0); computed.set(DTA.ObjCopyright, 0)
    computed.set(DTA.ObjVersion, 0); computed.set(DTA.ObjectID, 0); computed.set(DTA.UserData, 0); computed.set(DTA.TextFont, 0)
    const metadata = iffMetadata(bytes)
    if (metadata.name) computed.set(DTA.ObjName, this.string(owned, metadata.name))
    if (metadata.author) computed.set(DTA.ObjAuthor, this.string(owned, metadata.author))
    if (metadata.annotation) computed.set(DTA.ObjAnnotation, this.string(owned, metadata.annotation))
    if (metadata.copyright) computed.set(DTA.ObjCopyright, this.string(owned, metadata.copyright))
    if (metadata.version) computed.set(DTA.ObjVersion, this.string(owned, metadata.version))
    computed.set(DTA.Title, computed.get(DTA.ObjName)!)
    if (sound?.name) computed.set(DTA.ObjName, this.string(owned, sound.name))
    if (guide) {
      if (guide.database) computed.set(DTA.ObjName, this.string(owned, guide.database))
      if (guide.title) computed.set(DTA.Title, this.string(owned, guide.title))
      if (guide.author) computed.set(DTA.ObjAuthor, this.string(owned, guide.author))
      if (guide.version) computed.set(DTA.ObjVersion, this.string(owned, guide.version))
    }
    computed.set(DTA.SourceType, 2); computed.set(DTA.Handle, 0); computed.set(DTA.DataType, this.descriptorAddress(descriptor))
    computed.set(DTA.BaseName, this.string(owned, descriptor.baseName)); computed.set(DTA.GroupID, fourCCValue(descriptor.groupID))
    const lines = (text ?? (guide ? guideText(guide.nodes.get(guide.entryNode.toLowerCase())?.content ?? []) : '')).split('\n')
    const unit = picture || sound ? 1 : 8
    const width = picture?.width ?? (sound ? SOUND_ICON_WIDTH : Math.max(0, ...lines.map(line => line.length)))
    const height = picture?.height ?? (sound ? SOUND_ICON_HEIGHT : lines.length)
    computed.set(DTA.NominalHoriz, width); computed.set(DTA.NominalVert, height)
    computed.set(DTA.TopHoriz, 0); computed.set(DTA.VisibleHoriz, width); computed.set(DTA.TotalHoriz, width); computed.set(DTA.HorizUnit, unit)
    computed.set(DTA.TopVert, 0); computed.set(DTA.VisibleVert, height); computed.set(DTA.TotalVert, height); computed.set(DTA.VertUnit, unit)
    computed.set(GA.Width, width * unit); computed.set(GA.Height, height * unit)
    computed.set(DTA.TotalPHoriz, width * unit); computed.set(DTA.TotalPVert, height * unit)
    computed.set(DTA.Busy, 0); computed.set(DTA.Sync, 0)
    computed.set(DTA.PrinterStatus, 0); computed.set(DTA.PrinterProc, 0); computed.set(DTA.LayoutProc, 0)
    computed.set(DTA.ErrorLevel, 0); computed.set(DTA.ErrorNumber, 0); computed.set(DTA.ErrorString, 0)
    for (const [tag, value] of attributes) computed.set(tag >>> 0, value)
    const domain = this.memory.alloc(8, { clear: true })
    if (!domain) { for (const allocation of owned) this.memory.freeMem(allocation); return 0 }
    owned.push(domain); const domainView = new DataView(this.memory.buffer.buffer, this.memory.buffer.byteOffset + domain - this.memory.base, 8)
    domainView.setInt16(4, computed.get(GA.Width) ?? width); domainView.setInt16(6, computed.get(GA.Height) ?? height)
    computed.set(DTA.Domain, domain)
    const object = this.boopsi.newObjectA(this.classFor(descriptor), [...computed].map(([tag, data]) => ({ tag, data })))
    if (!object) { for (const allocation of owned) this.memory.freeMem(allocation); return 0 }
    const address = object.address
    const shared = object.instData<{ attributes: Map<number, number> }>(this.dataTypeClass).attributes
    shared.set(DTA.Data, address)
    this.objects.set(address, { address, object, path, descriptor, attributes: shared, window: 0, requester: 0, position: -1,
      owned, media: picture ?? sound ?? guide ?? text, source: Uint8Array.from(bytes), soundPlaying: false,
      guideNode: '', guideHistory: [], guideField: -1, textLayoutOwned: [], textLayoutKey: '', textSelection: null,
      selectionDomain: 0, domain })
    shared.set(DTA.Methods, this.methodList(address, false))
    shared.set(DTA.TriggerMethods, this.methodList(address, true))
    if (guide) this.goTo(address, guide.entryNode)
    else if (text !== null) this.rebuildTextLines(this.objects.get(address)!)
    return address
  }
  dispose(address: number): void {
    const object = this.objects.get(address)?.object; if (object) this.boopsi.disposeObject(object)
  }
  /** SetDTAttrsA: the datatype class receives the same OM_SET as any BOOPSI caller. */
  setAttrs(address: number, attributes: readonly { tag: number; data: number }[], window = 0, requester = 0): number {
    const held = this.objects.get(address); if (!held) return 0
    held.window = window >>> 0; held.requester = requester >>> 0
    return setAttrsA(held.object, attributes)
  }
  /** RefreshDTObjectA: update context/attributes, lay out, then render through the class-owned media. */
  refresh(address: number, attributes: readonly { tag: number; data: number }[], window: number, requester: number,
    rastPort?: RastPort): boolean {
    const held = this.objects.get(address); if (!held || window === 0) return false
    this.setAttrs(address, attributes, window, requester)
    this.layout(address)
    // sound.datatype advertises Trigger/Copy/Write, not Draw. Refreshing it
    // updates the gadget state but has no media pixels to send to a RastPort.
    if (held.descriptor.groupID === GID.SOUND) return rastPort ? this.drawSound(rastPort) : true
    if (rastPort === undefined) return false
    if (held.descriptor.groupID === GID.PICTURE) return this.draw(address, rastPort, 0, 0,
      getAttr(GA.Width, held.object) ?? 0, getAttr(GA.Height, held.object) ?? 0,
      held.attributes.get(DTA.TopHoriz) ?? 0, held.attributes.get(DTA.TopVert) ?? 0)
    if (held.descriptor.groupID === GID.TEXT || held.descriptor.groupID === GID.DOCUMENT) return this.drawText(address, rastPort)
    return true
  }
  /** GetDTAttrsA's per-tag lookup through OM_GET. */
  attr(address: number, id: number): number | null {
    const object = this.objects.get(address)?.object
    return object ? getAttr(id >>> 0, object) : null
  }
  /** DoDTMethodA: dispatch through the object's actual datatype class. */
  doMethod(address: number, message: DataTypeMethodMessage): number {
    const object = this.objects.get(address)?.object
    return object ? doMethodA(object, message) : 0
  }

  private dispatchMethod(address: number, message: DataTypeMethodMessage): number {
    switch (message.MethodID) {
      case DTM.ProcLayout:
      case DTM.AsyncLayout:
        return this.layout(address) ? 1 : 0
      case DTM.RemoveDTObject:
        return this.remove(address, message.window ?? 0)
      case DTM.FrameBox: {
        const frame = this.frameBox(address)
        if (!frame || !message.putFrame || (message.frameSize ?? 0) <= 0) return 0
        return message.putFrame(frame.subarray(0, Math.min(frame.length, message.frameSize!))) ? 1 : 0
      }
      case DTM.GoTo:
        return this.goTo(address, message.nodeName ?? '') ? 1 : 0
      case DTM.Select:
        return message.select && this.select(address, message.select) ? 1 : 0
      case DTM.ClearSelected:
        return this.clearSelected(address) ? 1 : 0
      case DTM.Trigger:
        return this.trigger(address, message.triggerFunction ?? 0, message.triggerData) ? 1 : 0
      case DTM.Print:
        return this.print(address, message.printAttrs) ? 1 : 0
      case DTM.Copy: {
        const bytes = this.copyBytes(address)
        return bytes && message.putCopy?.(bytes) ? 1 : 0
      }
      case DTM.Write: {
        const bytes = this.writeBytes(address, message.writeMode ?? -1)
        return bytes && message.putWrite?.(bytes) ? 1 : 0
      }
      case DTM.Draw:
        return message.rastPort && this.draw(address, message.rastPort, message.left ?? 0, message.top ?? 0,
          message.width ?? 0, message.height ?? 0, message.topHoriz ?? 0, message.topVert ?? 0) ? 1 : 0
      default:
        return 0
    }
  }
  obtain(bytes: Uint8Array | null): number {
    if (!bytes) return 0; const descriptor = obtainDataType(bytes, this.descriptors); if (!descriptor) return 0
    if (descriptor.baseName === 'macpaint' && decodeMacPaint(bytes) === null) return 0
    return this.descriptorAddress(descriptor)
  }
  release(_address: number): void { /* shared descriptors remain owned by datatypes.library */ }
  add(object: number, window: number, requester: number, position: number): number {
    const o = this.objects.get(object); if (!o) return 0; o.window = window; o.requester = requester; o.position = position; return position
  }
  remove(object: number, window: number): number {
    const o = this.objects.get(object); if (!o || (window !== 0 && o.window !== window)) return -1
    const old = o.position; o.window = 0; o.requester = 0; o.position = -1; return old
  }
  methodList(object: number, triggers = false): number {
    const o = this.objects.get(object); if (!o) return 0
    if (triggers && o.descriptor.groupID !== GID.SOUND && o.descriptor.baseName !== 'amigaguide') return 0
    const kind = triggers ? `trigger:${o.descriptor.groupID}` : `method:${o.descriptor.groupID}`
    const existing = this.methodLists.get(kind); if (existing) return existing
    if (triggers) {
      // DTMethod is { label, command, trigger function }, terminated by zeros.
      const methods = o.descriptor.baseName === 'amigaguide'
        ? [['Contents', 'CONTENTS', STM.Contents], ['Index', 'INDEX', STM.Index], ['Retrace', 'RETRACE', STM.Retrace],
          ['Browse <', 'PREVIOUS', STM.BrowsePrev], ['Browse >', 'NEXT', STM.BrowseNext]] as const
        : [['Play', 'PLAY', STM.Play]] as const
      const address = this.memory.alloc((methods.length + 1) * 12, { clear: true }); if (!address) return 0
      const at = address - this.memory.base; const dv = new DataView(this.memory.buffer.buffer, this.memory.buffer.byteOffset)
      methods.forEach(([label, command, fn], i) => {
        dv.setUint32(at + i * 12, this.string([], label)); dv.setUint32(at + i * 12 + 4, this.string([], command))
        dv.setUint32(at + i * 12 + 8, fn)
      })
      this.methodLists.set(kind, address); return address
    }
    /*
     * These are the actual ULONG arrays in the highest held base-class
     * binaries: picture 39.14@$2f9c, sound 39.5@$16fc, text 39.7@$387e and
     * amigaguide 39.15@$b126. They end in -1, not TAG_DONE. Concrete format
     * classes inherit their base class's list.
     */
    const values = o.descriptor.baseName === 'amigaguide'
      ? [DTM.ClearSelected, DTM.Print, DTM.Copy, DTM.GoTo, DTM.Trigger, DTM.RemoveDTObject, DTM.FrameBox, 0xffffffff]
      : o.descriptor.groupID === GID.PICTURE
        ? [DTM.FrameBox, DTM.Select, DTM.ClearSelected, DTM.Copy, DTM.Print, DTM.Write, 0xffffffff]
        : o.descriptor.groupID === GID.SOUND
          ? [DTM.Trigger, DTM.Copy, DTM.Write, 0xffffffff]
          : [DTM.ClearSelected, DTM.Print, DTM.Copy, DTM.Write, 0xffffffff]
    const address = this.memory.alloc(values.length * 4, { clear: true }); if (!address) return 0
    const at = address - this.memory.base; const dv = new DataView(this.memory.buffer.buffer, this.memory.buffer.byteOffset)
    values.forEach((value, i) => dv.setUint32(at + i * 4, value)); this.methodLists.set(kind, address)
    return address
  }
  layout(address: number): boolean {
    const o = this.objects.get(address); if (!o) return false
    if (o.descriptor.groupID === GID.TEXT || o.descriptor.groupID === GID.DOCUMENT) this.rebuildTextLines(o)
    o.attributes.set(DTA.Methods, this.methodList(address, false))
    o.attributes.set(DTA.TriggerMethods, this.methodList(address, true))
    const hUnit = Math.max(1, o.attributes.get(DTA.HorizUnit) ?? 1); const vUnit = Math.max(1, o.attributes.get(DTA.VertUnit) ?? 1)
    const totalH = Math.max(0, o.attributes.get(DTA.TotalHoriz) ?? 0); const totalV = Math.max(0, o.attributes.get(DTA.TotalVert) ?? 0)
    const visibleH = Math.min(totalH, Math.max(0, Math.floor((getAttr(GA.Width, o.object) ?? totalH * hUnit) / hUnit)))
    const visibleV = Math.min(totalV, Math.max(0, Math.floor((getAttr(GA.Height, o.object) ?? totalV * vUnit) / vUnit)))
    o.attributes.set(DTA.VisibleHoriz, visibleH); o.attributes.set(DTA.VisibleVert, visibleV)
    o.attributes.set(DTA.TopHoriz, Math.max(0, Math.min(o.attributes.get(DTA.TopHoriz) ?? 0, totalH - visibleH)))
    o.attributes.set(DTA.TopVert, Math.max(0, Math.min(o.attributes.get(DTA.TopVert) ?? 0, totalV - visibleV)))
    return true
  }
  private applySet(address: number, items: readonly { tag: number; data: number }[]): void {
    const o = this.objects.get(address); if (!o) return
    const sink = o.soundPlaying ? this.audio() : null
    for (const item of items) {
      if (item.tag === DTA.SelectDomain && item.data && this.memory.sizeOf(item.data) >= 8) {
        if (!o.selectionDomain) { o.selectionDomain = this.memory.alloc(8, { clear: true }); if (o.selectionDomain) o.owned.push(o.selectionDomain) }
        if (o.selectionDomain) {
          this.memory.buffer.copyWithin(o.selectionDomain - this.memory.base, item.data - this.memory.base, item.data - this.memory.base + 8)
          o.attributes.set(DTA.SelectDomain, o.selectionDomain)
          this.syncTextSelection(o)
        }
      }
      if (item.tag === GA.Width || item.tag === GA.Height) {
        const view = new DataView(this.memory.buffer.buffer, this.memory.buffer.byteOffset + o.domain - this.memory.base, 8)
        if (item.tag === GA.Width) view.setInt16(4, item.data)
        else view.setInt16(6, item.data)
      }
      if (item.tag === DTA.NodeName && o.descriptor.baseName === 'amigaguide' && item.data) {
        this.goTo(address, this.mappedString(item.data))
      }
      if (item.tag === SDTA.Volume) {
        const volume = Math.max(0, Math.min(64, item.data))
        o.attributes.set(SDTA.Volume, volume)
        sink?.setVolume(0, volume)
      }
      if (sink && item.tag === SDTA.Period) sink.setFrequency(0, periodToHz(Math.max(1, item.data)))
      if (o.soundPlaying && ((item.tag === SDTA.Sample && item.data === 0) ||
        (item.tag === SDTA.SampleLength && item.data === 0))) {
        this.audio()?.stop(0); o.soundPlaying = false
      }
    }
    this.clampScroll(o)
  }

  private clampScroll(o: DataTypeObject): void {
    const totalH = Math.max(0, o.attributes.get(DTA.TotalHoriz) ?? 0); const visibleH = Math.max(0, o.attributes.get(DTA.VisibleHoriz) ?? 0)
    const totalV = Math.max(0, o.attributes.get(DTA.TotalVert) ?? 0); const visibleV = Math.max(0, o.attributes.get(DTA.VisibleVert) ?? 0)
    o.attributes.set(DTA.TopHoriz, Math.max(0, Math.min(o.attributes.get(DTA.TopHoriz) ?? 0, Math.max(0, totalH - visibleH))))
    o.attributes.set(DTA.TopVert, Math.max(0, Math.min(o.attributes.get(DTA.TopVert) ?? 0, Math.max(0, totalV - visibleV))))
  }
  private drawSound(rp: RastPort): boolean {
    const planeSize = SOUND_ICON_ROW_BYTES * SOUND_ICON_HEIGHT
    for (let y = 0; y < SOUND_ICON_HEIGHT; y++) for (let x = 0; x < SOUND_ICON_WIDTH; x++) {
      const mask = 0x80 >> (x & 7); const at = y * SOUND_ICON_ROW_BYTES + (x >> 3)
      const pen = (SOUND_ICON_PLANES[at]! & mask ? 1 : 0) |
        (SOUND_ICON_PLANES[planeSize + at]! & mask ? 2 : 0)
      rp.plot(x, y, pen)
    }
    return true
  }
  frameBox(address: number): Uint8Array | null {
    const o = this.objects.get(address); if (!o) return null
    const held = o.attributes.get(DTA.FrameInfo)
    if (held) return Uint8Array.from(this.memory.buffer.subarray(held - this.memory.base, held - this.memory.base + 36))
    const width = o.attributes.get(DTA.TotalPHoriz) ?? o.attributes.get(DTA.TotalHoriz) ?? 0
    const height = o.attributes.get(DTA.TotalPVert) ?? o.attributes.get(DTA.TotalVert) ?? 0
    const frame = new Uint8Array(36); const view = new DataView(frame.buffer)
    view.setInt16(4, 1); view.setInt16(6, 1); view.setUint32(12, width); view.setUint32(16, height)
    view.setUint32(20, this.nativePicture(o)?.depth ?? 0)
    view.setUint32(32, o.descriptor.groupID === GID.PICTURE ? 0x6 : (o.descriptor.groupID === GID.TEXT || o.descriptor.groupID === GID.DOCUMENT ? 0x2 : 0))
    return frame
  }
  trigger(address: number, fn: number, data = ''): boolean {
    const o = this.objects.get(address)
    if (!o) return false
    const functionID = fn & 0xffff
    if (o.descriptor.baseName === 'amigaguide') return this.guideTrigger(o, functionID, data)
    if (o.descriptor.groupID !== GID.SOUND || functionID !== STM.Play) return false
    const sink = this.audio(); if (!sink) return false
    const sampleAddress = o.attributes.get(SDTA.Sample) ?? 0
    const requestedLength = o.attributes.get(SDTA.SampleLength) ?? 0
    const available = this.memory.sizeOf(sampleAddress)
    if (available === 0 || requestedLength <= 0) return false
    const length = Math.min(requestedLength, available)
    const pcm = new Int8Array(this.memory.buffer.buffer, this.memory.buffer.byteOffset + sampleAddress - this.memory.base, length)
    const headerAddress = o.attributes.get(SDTA.VoiceHeader) ?? 0
    const headerAt = headerAddress - this.memory.base
    const header = this.memory.sizeOf(headerAddress) >= 20
      ? new DataView(this.memory.buffer.buffer, this.memory.buffer.byteOffset + headerAt, 20) : null
    const oneShot = header?.getUint32(0) ?? length; const repeat = header?.getUint32(4) ?? 0
    const period = o.attributes.get(SDTA.Period) ?? samPeriod(header?.getUint16(12) ?? 1)
    const loopStart = repeat > 0 ? Math.min(length, oneShot) : -1
    sink.play(0, pcm, periodToHz(period), o.attributes.get(SDTA.Volume) ?? 64, loopStart,
      repeat > 0 ? Math.min(length, oneShot + repeat) : undefined)
    o.soundPlaying = true; return true
  }
  copyBytes(address: number): Uint8Array | null {
    const o = this.objects.get(address); if (!o) return null
    const text = this.textBytes(o)
    if (text) {
      const selected = o.textSelection
      return selected ? text.slice(selected.start, selected.end) : text
    }
    const image = this.nativePicture(o)
    if (image) {
      const box = this.selection(o) ?? { left: 0, top: 0, width: image.width, height: image.height }
      const width = Math.max(0, Math.min(image.width - box.left, box.width))
      const height = Math.max(0, Math.min(image.height - box.top, box.height))
      if (width === 0 || height === 0) return null
      const pixels = new Uint8Array(width * height)
      for (let y = 0; y < height; y++) pixels.set(image.pixels.subarray((box.top + y) * image.width + box.left,
        (box.top + y) * image.width + box.left + width), y * width)
      return encodeIlbm({ ...image, width, height, pixels, mode: o.attributes.get(PDTA.ModeID) ?? 0 })
    }
    if (o.descriptor.groupID === GID.SOUND) return Uint8Array.from(o.source)
    return null
  }

  print(address: number, attrs: ReadonlyMap<number, number> = new Map()): boolean {
    const o = this.objects.get(address); if (!o) return false
    const image = this.nativePicture(o)
    if (image) {
      const sink = this.pagePrinter(); if (!sink) return false
      const pixels = new Uint8ClampedArray(image.width * image.height * 4)
      for (let i = 0; i < image.pixels.length; i++) {
        const colour = image.palette[image.pixels[i]!] ?? 0
        pixels[i * 4] = ((colour >> 8) & 15) * 17
        pixels[i * 4 + 1] = ((colour >> 4) & 15) * 17
        pixels[i * 4 + 2] = (colour & 15) * 17
        pixels[i * 4 + 3] = 255
      }
      sink({ pixels, width: image.width, height: image.height, srcX: 0, srcY: 0,
        special: attrs.get(DTA.Special) ?? 0, destCols: attrs.get(DTA.DestCols) ?? 0, destRows: attrs.get(DTA.DestRows) ?? 0 })
      return true
    }
    if (o.descriptor.groupID === GID.TEXT || o.descriptor.groupID === GID.DOCUMENT) {
      const sink = this.textPrinter(); const bytes = this.textBytes(o)
      if (!sink || !bytes) return false
      let text = ''; for (const byte of bytes) text += String.fromCharCode(byte)
      sink(text); return true
    }
    return false
  }

  select(address: number, rect: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
    const o = this.objects.get(address)
    if (!o || (o.descriptor.groupID !== GID.PICTURE && o.descriptor.groupID !== GID.TEXT && o.descriptor.groupID !== GID.DOCUMENT)) return false
    let boxAddress = o.selectionDomain
    if (boxAddress === 0 || this.memory.sizeOf(boxAddress) < 8) {
      boxAddress = this.memory.alloc(8, { clear: true }); if (!boxAddress) return false
      o.owned.push(boxAddress); o.selectionDomain = boxAddress
    }
    if (o.descriptor.groupID !== GID.PICTURE) {
      const hUnit = Math.max(1, o.attributes.get(DTA.HorizUnit) ?? 8)
      const vUnit = Math.max(1, o.attributes.get(DTA.VertUnit) ?? 8)
      const view = new DataView(this.memory.buffer.buffer, this.memory.buffer.byteOffset + boxAddress - this.memory.base, 8)
      view.setInt16(0, Math.min(rect.minX, rect.maxX)); view.setInt16(2, Math.min(rect.minY, rect.maxY))
      view.setInt16(4, Math.abs(rect.maxX - rect.minX) + 1); view.setInt16(6, Math.abs(rect.maxY - rect.minY) + 1)
      o.attributes.set(DTA.SelectDomain, boxAddress)
      this.syncTextSelection(o, hUnit, vUnit)
      return o.textSelection !== null
    }
    const image = this.nativePicture(o); if (!image) return false
    const left = Math.max(0, Math.min(image.width - 1, Math.min(rect.minX, rect.maxX)))
    const top = Math.max(0, Math.min(image.height - 1, Math.min(rect.minY, rect.maxY)))
    const right = Math.max(left, Math.min(image.width - 1, Math.max(rect.minX, rect.maxX)))
    const bottom = Math.max(top, Math.min(image.height - 1, Math.max(rect.minY, rect.maxY)))
    const view = new DataView(this.memory.buffer.buffer, this.memory.buffer.byteOffset + boxAddress - this.memory.base, 8)
    view.setInt16(0, left); view.setInt16(2, top); view.setInt16(4, right - left + 1); view.setInt16(6, bottom - top + 1)
    o.attributes.set(DTA.SelectDomain, boxAddress)
    return true
  }

  clearSelected(address: number): boolean {
    const o = this.objects.get(address); if (!o) return false
    o.attributes.set(DTA.SelectDomain, 0); o.textSelection = null; return true
  }
  writeBytes(address: number, mode: number): Uint8Array | null {
    const o = this.objects.get(address); if (!o || (mode !== 0 && mode !== 1)) return null
    if (mode === 1) return Uint8Array.from(o.source)
    const image = this.nativePicture(o)
    if (image) {
      return encodeIlbm({ width: image.width, height: image.height, depth: image.depth,
        mode: o.attributes.get(PDTA.ModeID) ?? 0, palette: image.palette, pixels: image.pixels })
    }
    if (o.descriptor.baseName === 'ilbm' || o.descriptor.baseName === '8svx' || o.descriptor.baseName === 'ascii') return Uint8Array.from(o.source)
    return null
  }
  goTo(address: number, nodeName: string): boolean {
    const o = this.objects.get(address); const guide = o?.media
    if (!o || !guide || typeof guide === 'string' || !('nodes' in guide)) return false
    const node = guide.nodes.get(nodeName.toLowerCase()); if (!node) return false
    if (o.guideNode && o.guideNode.toLowerCase() !== node.id.toLowerCase()) o.guideHistory.push(o.guideNode)
    o.guideNode = node.id; o.guideField = -1
    const text = guideText(node.content); const raw = new Uint8Array(text.length + 1)
    for (let i = 0; i < text.length; i++) raw[i] = text.charCodeAt(i) & 0xff
    const buffer = this.bytes(o.owned, raw); const name = this.string(o.owned, node.id); const title = this.string(o.owned, node.title)
    o.attributes.set(TDTA.Buffer, buffer); o.attributes.set(TDTA.BufferLen, text.length)
    o.attributes.set(DTA.NodeName, name); o.attributes.set(DTA.Title, title)
    o.attributes.set(TDTA.WordWrap, node.wordWrap ? 1 : 0)
    const lines = text.split('\n'); const width = Math.max(0, ...lines.map(line => line.length)); const height = lines.length
    const hUnit = o.attributes.get(DTA.HorizUnit) ?? 8; const vUnit = o.attributes.get(DTA.VertUnit) ?? 8
    o.attributes.set(DTA.TotalVert, height); o.attributes.set(DTA.VisibleVert, height); o.attributes.set(DTA.TotalPVert, height * vUnit)
    o.attributes.set(DTA.TotalHoriz, width); o.attributes.set(DTA.TotalPHoriz, width * hUnit)
    this.rebuildTextLines(o)
    return true
  }

  private rebuildTextLines(o: DataTypeObject): void {
    const buffer = o.attributes.get(TDTA.Buffer) ?? 0; const length = o.attributes.get(TDTA.BufferLen) ?? 0
    const wrap = (o.attributes.get(TDTA.WordWrap) ?? 0) !== 0
    const hUnit = Math.max(1, o.attributes.get(DTA.HorizUnit) ?? 8)
    const columns = Math.max(1, Math.floor((getAttr(GA.Width, o.object) ?? 0) / hUnit))
    const delimiterAddress = o.attributes.get(TDTA.WordDelim) ?? 0
    const key = `${buffer}:${length}:${wrap ? columns : 0}:${delimiterAddress}`; if (o.textLayoutKey === key) return
    for (const address of o.textLayoutOwned) this.memory.freeMem(address)
    o.textLayoutOwned.length = 0; o.textLayoutKey = key
    if (!buffer || length < 0 || this.memory.sizeOf(buffer) < length) { o.attributes.set(TDTA.LineList, 0); return }
    const list = this.memory.alloc(12, { clear: true }); if (!list) { o.attributes.set(TDTA.LineList, 0); return }
    o.textLayoutOwned.push(list)
    const raw = this.memory.buffer.subarray(buffer - this.memory.base, buffer - this.memory.base + length)
    const physical: Array<{ start: number; length: number; lf: boolean }> = []
    let start = 0
    for (let at = 0; at <= raw.length; at++) if (at === raw.length || raw[at] === 10 || raw[at] === 13) {
      physical.push({ start, length: at - start, lf: at < raw.length })
      if (raw[at] === 13 && raw[at + 1] === 10) at++
      start = at + 1
    }
    const delimiters = this.mappedString(delimiterAddress, '\t *-,()<>[];"')
    const ranges: Array<{ start: number; length: number; lf: boolean }> = []
    for (const line of physical) {
      let offset = 0
      if (wrap) {
        while (line.length - offset > columns) {
          let take = columns
          for (let i = columns - 1; i > 0; i--) if (delimiters.includes(String.fromCharCode(raw[line.start + offset + i]!))) {
            take = i + 1; break
          }
          ranges.push({ start: line.start + offset, length: take, lf: false }); offset += take
        }
      }
      ranges.push({ start: line.start + offset, length: line.length - offset, lf: line.lf })
    }
    const nodes = ranges.map(() => this.memory.alloc(36, { clear: true }))
    if (nodes.some(address => address === 0)) {
      for (const address of nodes) if (address) this.memory.freeMem(address)
      this.memory.freeMem(list); o.textLayoutOwned.length = 0; o.attributes.set(TDTA.LineList, 0); return
    }
    o.textLayoutOwned.push(...nodes)
    this.put32(list, nodes[0] ?? list + 4); this.put32(list + 4, 0); this.put32(list + 8, nodes.at(-1) ?? list)
    const unit = Math.max(1, o.attributes.get(DTA.VertUnit) ?? 8)
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!; const line = ranges[i]!
      this.put32(node, nodes[i + 1] ?? list + 4); this.put32(node + 4, nodes[i - 1] ?? list)
      this.put32(node + 8, buffer + line.start); this.put32(node + 12, line.length)
      this.put16(node + 18, i * unit); this.put16(node + 20, line.length * 8); this.put16(node + 22, unit)
      this.put16(node + 24, line.lf ? 1 : 0)
    }
    o.attributes.set(TDTA.LineList, list)
    const widest = Math.max(0, ...ranges.map(line => line.length))
    o.attributes.set(DTA.TotalHoriz, widest); o.attributes.set(DTA.TotalPHoriz, widest * hUnit)
    o.attributes.set(DTA.TotalVert, ranges.length); o.attributes.set(DTA.TotalPVert, ranges.length * unit)
    this.clampScroll(o)
  }

  private guideTrigger(o: DataTypeObject, fn: number, data: string): boolean {
    const guide = o.media
    if (!guide || typeof guide === 'string' || !('nodes' in guide)) return false
    const current = guide.nodes.get(o.guideNode.toLowerCase())
    const visit = (name: string, retrace = false): boolean => {
      if (retrace) {
        const previous = o.guideHistory.pop(); if (!previous) return false
        const before = o.guideHistory.length
        if (!this.goTo(o.address, previous)) { o.guideHistory.push(previous); return false }
        o.guideHistory.length = before
        return true
      }
      return this.goTo(o.address, name)
    }
    const local = (target: { document: string; node: string } | undefined): boolean =>
      !!target && target.document === '' && visit(target.node || guide.entryNode)
    if (fn === STM.Contents) return local(current?.toc) || visit(guide.entryNode)
    if (fn === STM.Index) return local(current?.index) || visit('index')
    if (fn === STM.Help) return local(current?.help) || visit('help')
    if (fn === STM.Retrace) return visit('', true)
    if (fn === STM.BrowsePrev || fn === STM.BrowseNext) {
      const explicit = fn === STM.BrowsePrev ? current?.previous : current?.next
      if (explicit) return local(explicit)
      const nodes = [...guide.nodes.values()]
      const at = nodes.findIndex(node => node.id.toLowerCase() === o.guideNode.toLowerCase())
      const next = nodes[at + (fn === STM.BrowsePrev ? -1 : 1)]
      return !!next && visit(next.id)
    }
    if (fn === STM.Command) {
      const command = /^\s*(\S+)\s+(.+?)\s*$/i.exec(data); const verb = command?.[1]?.toLowerCase()
      const target = command?.[2]?.replace(/^"|"$/g, '')
      if ((verb === 'link' || verb === 'alink') && target) return local({ document: '', node: target })
      if (verb === 'system' && target) return this.systemCommand()?.(target) === true
      return false
    }
    if (fn === STM.NextField || fn === STM.PrevField || fn === STM.ActivateField) {
      if (!current) return false
      const links = current.content.filter((item): item is Extract<AmigaGuideInline, { type: 'link' }> => item.type === 'link')
      if (fn === STM.ActivateField) {
        const link = links[o.guideField]
        return !!link && local(link.target)
      }
      if (links.length === 0) { o.guideField = -1; return false }
      o.guideField = fn === STM.NextField
        ? (o.guideField + 1 + links.length) % links.length
        : (o.guideField < 0 ? links.length - 1 : o.guideField - 1 + links.length) % links.length
      return true
    }
    return false
  }
  draw(address: number, rp: RastPort, left: number, top: number, width: number, height: number,
    topHoriz = 0, topVert = 0): boolean {
    const o = this.objects.get(address); const image = o && this.nativePicture(o)
    if (!image) return false
    const w = width > 0 ? width : image.width; const h = height > 0 ? height : image.height
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = x + topHoriz; const sy = y + topVert
      if (sx >= 0 && sy >= 0 && sx < image.width && sy < image.height) rp.putPixel(left + x, top + y, image.pixels[sy * image.width + sx]!)
    }
    return true
  }

  private drawText(address: number, rp: RastPort): boolean {
    const o = this.objects.get(address)
    if (!o || !this.textBytes(o)) return false
    this.rebuildTextLines(o)
    const lines: string[] = []; const list = o.attributes.get(TDTA.LineList) ?? 0
    if (list) {
      const view = new DataView(this.memory.buffer.buffer, this.memory.buffer.byteOffset)
      let node = view.getUint32(list - this.memory.base)
      while (node && node !== list + 4 && this.memory.sizeOf(node) >= 36) {
        const at = node - this.memory.base; const text = view.getUint32(at + 8); const length = view.getUint32(at + 12)
        let line = ''; for (let i = 0; i < length; i++) line += String.fromCharCode(this.memory.buffer[text - this.memory.base + i]!)
        lines.push(line); node = view.getUint32(at)
      }
    }
    const top = Math.max(0, o.attributes.get(DTA.TopVert) ?? 0); const left = Math.max(0, o.attributes.get(DTA.TopHoriz) ?? 0)
    const visible = Math.max(0, o.attributes.get(DTA.VisibleVert) ?? lines.length)
    const columns = Math.max(0, o.attributes.get(DTA.VisibleHoriz) ?? 0)
    const unit = Math.max(1, o.attributes.get(DTA.VertUnit) ?? 8); const baseline = rp.font?.baseline ?? unit - 1
    for (let row = 0; row < visible && top + row < lines.length; row++) {
      const line = lines[top + row]!.slice(left, columns > 0 ? left + columns : undefined)
      rp.text(0, row * unit + baseline, line)
    }
    return true
  }

  private textBytes(o: DataTypeObject): Uint8Array | null {
    const buffer = o.attributes.get(TDTA.Buffer); const length = o.attributes.get(TDTA.BufferLen)
    if (!buffer || length === undefined || length < 0 || this.memory.sizeOf(buffer) < length) return null
    return Uint8Array.from(this.memory.buffer.subarray(buffer - this.memory.base, buffer - this.memory.base + length))
  }

  private mappedString(address: number, fallback = ''): string {
    const available = this.memory.sizeOf(address); if (!address || !available) return fallback
    let value = ''; const base = address - this.memory.base
    for (let i = 0; i < available && this.memory.buffer[base + i] !== 0; i++) value += String.fromCharCode(this.memory.buffer[base + i]!)
    return value
  }

  private syncTextSelection(o: DataTypeObject, hUnit = Math.max(1, o.attributes.get(DTA.HorizUnit) ?? 8),
    vUnit = Math.max(1, o.attributes.get(DTA.VertUnit) ?? 8)): void {
    const text = this.textBytes(o); const box = this.selection(o)
    if (!text || !box || (o.descriptor.groupID !== GID.TEXT && o.descriptor.groupID !== GID.DOCUMENT)) {
      o.textSelection = null; return
    }
    const source = String.fromCharCode(...text); const lines = source.split('\n'); const starts: number[] = []
    let offset = 0; for (const line of lines) { starts.push(offset); offset += line.length + 1 }
    const firstLine = Math.max(0, Math.min(lines.length - 1, Math.floor(box.top / vUnit)))
    const lastLine = Math.max(firstLine, Math.min(lines.length - 1, Math.floor((box.top + Math.max(0, box.height - 1)) / vUnit)))
    const firstCol = Math.max(0, Math.min(lines[firstLine]!.length, Math.floor(box.left / hUnit)))
    const lastCol = Math.max(0, Math.min(lines[lastLine]!.length,
      Math.floor((box.left + Math.max(0, box.width - 1)) / hUnit) + 1))
    let selection = { start: starts[firstLine]! + firstCol, end: starts[lastLine]! + lastCol }
    if ((o.attributes.get(TDTA.WordSelect) ?? 0) !== 0) {
      const delimiters = this.mappedString(o.attributes.get(TDTA.WordDelim) ?? 0, '\t *-,()<>[];"') + '\r\n'
      while (selection.start > 0 && !delimiters.includes(source[selection.start - 1]!)) selection.start--
      while (selection.end < source.length && !delimiters.includes(source[selection.end]!)) selection.end++
    }
    o.textSelection = selection
  }

  /** Decode the public PDTA records each time: callers may legally alter them in mapped memory. */
  private nativePicture(o: DataTypeObject): IndexedBitmap | null {
    if (o.descriptor.groupID !== GID.PICTURE) return null
    const headerAddress = o.attributes.get(PDTA.BitMapHeader) ?? 0
    const bitmapAddress = o.attributes.get(PDTA.BitMap) ?? 0
    if (this.memory.sizeOf(headerAddress) < 20 || this.memory.sizeOf(bitmapAddress) < 40) return null
    const hv = new DataView(this.memory.buffer.buffer, this.memory.buffer.byteOffset + headerAddress - this.memory.base, 20)
    const bv = new DataView(this.memory.buffer.buffer, this.memory.buffer.byteOffset + bitmapAddress - this.memory.base, 40)
    const width = hv.getUint16(0); const height = hv.getUint16(2)
    const rowBytes = bv.getUint16(0); const rows = bv.getUint16(2)
    const depth = Math.min(8, bv.getUint8(5))
    if (width === 0 || height === 0 || rowBytes === 0 || rows < height || depth === 0) return null
    const pixels = new Uint8Array(width * height)
    for (let plane = 0; plane < depth; plane++) {
      const planeAddress = bv.getUint32(8 + plane * 4)
      if (this.memory.sizeOf(planeAddress) < rowBytes * height) return null
      const at = planeAddress - this.memory.base
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (this.memory.buffer[at + y * rowBytes + (x >> 3)]! & (0x80 >> (x & 7))) pixels[y * width + x]! |= 1 << plane
      }
    }
    const count = Math.min(1 << depth, o.attributes.get(PDTA.NumColors) ?? 0)
    const registers = o.attributes.get(PDTA.ColorRegisters) ?? 0
    const palette: number[] = []
    if (count > 0 && this.memory.sizeOf(registers) >= count * 3) {
      const at = registers - this.memory.base
      for (let i = 0; i < count; i++) palette.push(
        ((this.memory.buffer[at + i * 3]! >> 4) << 8) |
        ((this.memory.buffer[at + i * 3 + 1]! >> 4) << 4) |
        (this.memory.buffer[at + i * 3 + 2]! >> 4))
    }
    while (palette.length < (1 << depth)) palette.push(0)
    return { width, height, depth, pixels, palette }
  }

  private selection(o: DataTypeObject): { left: number; top: number; width: number; height: number } | null {
    const address = o.attributes.get(DTA.SelectDomain) ?? 0
    if (this.memory.sizeOf(address) < 8) return null
    const view = new DataView(this.memory.buffer.buffer, this.memory.buffer.byteOffset + address - this.memory.base, 8)
    return { left: view.getInt16(0), top: view.getInt16(2), width: view.getInt16(4), height: view.getInt16(6) }
  }
}

/** V39 GetDTString English fallbacks, in the order held by the 39.11 binary. */
const DATA_TYPE_STRINGS = new Map<number, string>([
  [2000, 'Unknown data type for %s'], [2001, "Couldn't save %s"], [2002, "Couldn't open %s"],
  [2003, "Couldn't send message"], [2100, 'Binary'], [2101, 'ASCII'], [2102, 'IFF'], [2103, 'Miscellaneous'],
  [fourCCValue('syst'), 'System'], [fourCCValue('text'), 'Text'], [fourCCValue('docu'), 'Document'],
  [fourCCValue('soun'), 'Sound'], [fourCCValue('inst'), 'Instrument'], [fourCCValue('musi'), 'Music'],
  [fourCCValue('pict'), 'Picture'], [fourCCValue('anim'), 'Animation'], [fourCCValue('movi'), 'Movie'],
])

/** GetDTString returns NULL for an unknown id; the AMOS wrapper exposes that as empty. */
export const dataTypeString = (id: number): string => DATA_TYPE_STRINGS.get(id >>> 0) ?? ''
