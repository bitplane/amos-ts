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
import type { AudioSink } from './host'
import type { RastPort } from './graphics'
import { parseAmigaGuide, type AmigaGuideDocument, type AmigaGuideInline } from './amigaguide'
import {
  Boopsi, OM_DISPOSE, OM_GET, OM_NEW, OM_SET, OM_UPDATE, TAG_DONE, doMethodA, doSuperMethodA, getAttr, setAttrsA,
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

/** Release 40.15 datatype class tags used by the managed object backend. */
const DUMMY = 0x80001000
export const DTA = {
  Name: DUMMY + 100, DataType: DUMMY + 103, ObjName: DUMMY + 109,
  NominalVert: DUMMY + 124, NominalHoriz: DUMMY + 125,
  TopVert: DUMMY + 11, VisibleVert: DUMMY + 12, TotalVert: DUMMY + 13, VertUnit: DUMMY + 14,
  TopHoriz: DUMMY + 15, VisibleHoriz: DUMMY + 16, TotalHoriz: DUMMY + 17, HorizUnit: DUMMY + 18,
  TriggerMethods: DUMMY + 21, Methods: DUMMY + 24,
  NodeName: DUMMY + 19, Title: DUMMY + 20,
  Busy: DUMMY + 28, Sync: DUMMY + 29,
  Domain: DUMMY + 104, Width: DUMMY + 107, Height: DUMMY + 108, FrameInfo: DUMMY + 116,
  SelectDomain: DUMMY + 121, TotalPVert: DUMMY + 122, TotalPHoriz: DUMMY + 123,
  BaseName: DUMMY + 30, GroupID: DUMMY + 31,
} as const
export const PDTA = {
  ModeID: DUMMY + 200, BitMapHeader: DUMMY + 201, BitMap: DUMMY + 202,
  ColorRegisters: DUMMY + 203, CRegs: DUMMY + 204, NumColors: DUMMY + 209,
} as const
export const TDTA = { Buffer: DUMMY + 300, BufferLen: DUMMY + 301 } as const
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

/**
 * `ReleaseDataType(dt)` (-42). Descriptors are immutable shared records in
 * this backend, so releasing one has no observable work to perform.
 */
export function releaseDataType(_dt: DataTypeHeader | null): void {}

/** every descriptor that matched, most specific first, for a caller that wants to see the tie */
export function candidates(data: Uint8Array, types: readonly DataTypeHeader[]): DataTypeHeader[] {
  return types
    .filter((dt) => maskMatches(dt, data))
    .sort((a, b) => b.priority - a.priority || b.mask.length - a.mask.length)
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
}

/** Managed form of the public DTM_* message records after pointer translation. */
export interface DataTypeMethodMessage extends Msg {
  window?: number
  frameSize?: number
  putFrame?: (frame: Uint8Array) => boolean
  nodeName?: string
  triggerFunction?: number
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
}

function guideText(items: readonly AmigaGuideInline[]): string {
  return items.map(item => item.type === 'text' ? item.text : item.type === 'link' ? guideText(item.label) : '').join('')
}

function pictureFor(bytes: Uint8Array, descriptor: DataTypeHeader): IndexedBitmap | null {
  try {
    if (descriptor.baseName === 'ilbm') {
      const image = parseIlbm(bytes)
      return { width: image.width, height: image.height, depth: image.depth, pixels: image.pixels, palette: [...image.palette] }
    }
    if (descriptor.baseName === 'macpaint') {
      const image = decodeMacPaint(bytes)
      return image && { ...image, depth: 1, palette: [0xfff, 0] }
    }
    if (descriptor.baseName === 'bmp') return decodeBmp(bytes)
    if (descriptor.baseName === 'ico') return decodeIco(bytes)
    if (descriptor.baseName === 'pcx') return decodePcx(bytes)
    if (descriptor.baseName === 'gif') return decodeGif(bytes)
    if (descriptor.baseName === 'jpeg') {
      const image = decodeJpeg(bytes)
      return image && quantiseRgb(image.pixels, image.width, image.height)
    }
  } catch { return null }
  return null
}

/** Shared native-facing DataTypes object lifecycle used by OS extensions. */
export class DataTypesService {
  readonly objects = new Map<number, DataTypeObject>()
  readonly obtained = new Map<number, DataTypeHeader>()
  private readonly methodLists = new Map<string, number>()
  private readonly dataTypeClass: BoopsiClass
  private readonly classes = new Map<string, BoopsiClass>()
  constructor(private readonly memory: import('./exec').MemPool, readonly descriptors: readonly DataTypeHeader[],
    private readonly audio: () => AudioSink | null = () => null, private readonly boopsi = new Boopsi(memory)) {
    this.boopsi.ensureIntuitionClasses()
    const existing = this.boopsi.findClass('datatypesclass')
    this.dataTypeClass = existing ?? this.boopsi.makeClass('datatypesclass', 'gadgetclass', (cl, obj, msg) => {
      if (msg.MethodID === OM_NEW) {
        // gadgetclass must not retain a second copy of datatype attributes.
        const made = this.boopsi.objectAt(doSuperMethodA(cl, obj, { MethodID: OM_NEW, attrs: [] } as OpSet))
        if (!made) return 0
        const data = made.instData<{ attributes: Map<number, number> }>(cl)
        data.attributes = new Map()
        for (const item of (msg as OpSet).attrs) if (item.tag !== TAG_DONE) data.attributes.set(item.tag >>> 0, item.data)
        return made.address
      }
      if (msg.MethodID === OM_SET || msg.MethodID === OM_UPDATE) {
        const data = (obj as BoopsiObject).instData<{ attributes?: Map<number, number> }>(cl)
        data.attributes ??= new Map()
        let used = 0
        for (const item of (msg as OpSet).attrs) if (item.tag !== TAG_DONE) {
          data.attributes.set(item.tag >>> 0, item.data); used++
        }
        return used
      }
      if (msg.MethodID === OM_GET) {
        const get = msg as OpGet
        const value = (obj as BoopsiObject).instData<{ attributes?: Map<number, number> }>(cl).attributes?.get(get.attrID >>> 0)
        if (value === undefined) return doSuperMethodA(cl, obj, msg)
        get.storage = value; return 1
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
    attrs.set(PDTA.BitMap, this.bytes(owned, bitmap))
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
    const picture = descriptor.groupID === GID.PICTURE ? pictureFor(bytes, descriptor) : null
    const sound = descriptor.groupID === GID.SOUND ? decode8svx(bytes) : null
    const text = descriptor.baseName === 'ascii' ? decodeDataTypeText(bytes, descriptor.name) : null
    const guide = descriptor.baseName === 'amigaguide' ? parseAmigaGuide(bytes) : null
    if ((descriptor.groupID === GID.PICTURE && !picture) || (descriptor.groupID === GID.SOUND && !sound) ||
      (descriptor.baseName === 'ascii' && text === null) || (descriptor.baseName === 'amigaguide' && !guide)) return 0
    const owned: number[] = []
    const computed = picture ? this.pictureAttrs(owned, picture, descriptor.baseName === 'ilbm' ? parseIlbm(bytes).mode : 0)
      : sound ? this.soundAttrs(owned, sound) : new Map<number, number>()
    if (text !== null) {
      const raw = new Uint8Array(text.length + 1); for (let i = 0; i < text.length; i++) raw[i] = text.charCodeAt(i) & 0xff
      computed.set(TDTA.Buffer, this.bytes(owned, raw)); computed.set(TDTA.BufferLen, text.length)
    }
    computed.set(DTA.Name, this.string(owned, path)); computed.set(DTA.ObjName, computed.get(DTA.Name)!)
    computed.set(DTA.BaseName, this.string(owned, descriptor.baseName)); computed.set(DTA.GroupID, fourCCValue(descriptor.groupID))
    const lines = text?.split('\n') ?? []
    const width = picture?.width ?? Math.max(0, ...lines.map(line => line.length)); const height = picture?.height ?? lines.length
    computed.set(DTA.TopHoriz, 0); computed.set(DTA.VisibleHoriz, width); computed.set(DTA.TotalHoriz, width); computed.set(DTA.HorizUnit, 1)
    computed.set(DTA.TopVert, 0); computed.set(DTA.VisibleVert, height); computed.set(DTA.TotalVert, height); computed.set(DTA.VertUnit, 1)
    computed.set(DTA.Width, width); computed.set(DTA.Height, height); computed.set(DTA.TotalPHoriz, width); computed.set(DTA.TotalPVert, height)
    computed.set(DTA.Busy, 0); computed.set(DTA.Sync, 0)
    for (const [tag, value] of attributes) computed.set(tag >>> 0, value)
    const object = this.boopsi.newObjectA(this.classFor(descriptor), [...computed].map(([tag, data]) => ({ tag, data })))
    if (!object) { for (const allocation of owned) this.memory.freeMem(allocation); return 0 }
    const address = object.address
    const shared = object.instData<{ attributes: Map<number, number> }>(this.dataTypeClass).attributes
    this.objects.set(address, { address, object, path, descriptor, attributes: shared, window: 0, requester: 0, position: -1,
      owned, media: picture ?? sound ?? guide ?? text, source: Uint8Array.from(bytes), soundPlaying: false })
    if (guide) this.goTo(address, guide.entryNode)
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
      case DTM.Trigger:
        return this.trigger(address, message.triggerFunction ?? 0) ? 1 : 0
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
    const address = this.memory.alloc(32, { clear: true }); if (address) this.obtained.set(address, descriptor); return address
  }
  release(address: number): void { if (this.obtained.delete(address)) this.memory.freeMem(address) }
  add(object: number, window: number, requester: number, position: number): number {
    const o = this.objects.get(object); if (!o) return 0; o.window = window; o.requester = requester; o.position = position; return position
  }
  remove(object: number, window: number): number {
    const o = this.objects.get(object); if (!o || (window !== 0 && o.window !== window)) return -1
    const old = o.position; o.window = 0; o.requester = 0; o.position = -1; return old
  }
  methodList(object: number, triggers = false): number {
    const o = this.objects.get(object); if (!o) return 0
    if (triggers && o.descriptor.groupID !== GID.SOUND) return 0
    const kind = triggers ? `trigger:${o.descriptor.groupID}` : `method:${o.descriptor.groupID}`
    const existing = this.methodLists.get(kind); if (existing) return existing
    if (triggers) {
      // DTMethod is { label, command, trigger function }, terminated by zeros.
      const play = this.string([], 'Play'); const command = this.string([], 'PLAY')
      const address = this.memory.alloc(24, { clear: true }); if (!address) return 0
      const at = address - this.memory.base; const dv = new DataView(this.memory.buffer.buffer, this.memory.buffer.byteOffset)
      dv.setUint32(at, play); dv.setUint32(at + 4, command); dv.setUint32(at + 8, 2)
      this.methodLists.set(kind, address); return address
    }
    const values = o.descriptor.baseName === 'amigaguide' ? [DTM.FrameBox, DTM.ProcLayout, DTM.AsyncLayout, DTM.GoTo, DTM.Copy, DTM.Write, 0]
      : o.descriptor.groupID === GID.PICTURE ? [DTM.FrameBox, DTM.ProcLayout, DTM.AsyncLayout, DTM.Draw, DTM.Write, 0]
        : o.descriptor.groupID === GID.SOUND ? [DTM.ProcLayout, DTM.AsyncLayout, DTM.Trigger, DTM.Write, 0]
          : [DTM.FrameBox, DTM.ProcLayout, DTM.AsyncLayout, DTM.Copy, DTM.Write, 0]
    const address = this.memory.alloc(values.length * 4, { clear: true }); if (!address) return 0
    const at = address - this.memory.base; const dv = new DataView(this.memory.buffer.buffer, this.memory.buffer.byteOffset)
    values.forEach((value, i) => dv.setUint32(at + i * 4, value)); this.methodLists.set(kind, address)
    return address
  }
  layout(address: number): boolean {
    const o = this.objects.get(address); if (!o) return false
    o.attributes.set(DTA.Methods, this.methodList(address, false))
    o.attributes.set(DTA.TriggerMethods, this.methodList(address, true))
    const hUnit = Math.max(1, o.attributes.get(DTA.HorizUnit) ?? 1); const vUnit = Math.max(1, o.attributes.get(DTA.VertUnit) ?? 1)
    const totalH = Math.max(0, o.attributes.get(DTA.TotalHoriz) ?? 0); const totalV = Math.max(0, o.attributes.get(DTA.TotalVert) ?? 0)
    const visibleH = Math.min(totalH, Math.max(0, Math.floor((o.attributes.get(DTA.Width) ?? totalH * hUnit) / hUnit)))
    const visibleV = Math.min(totalV, Math.max(0, Math.floor((o.attributes.get(DTA.Height) ?? totalV * vUnit) / vUnit)))
    o.attributes.set(DTA.VisibleHoriz, visibleH); o.attributes.set(DTA.VisibleVert, visibleV)
    o.attributes.set(DTA.TopHoriz, Math.max(0, Math.min(o.attributes.get(DTA.TopHoriz) ?? 0, totalH - visibleH)))
    o.attributes.set(DTA.TopVert, Math.max(0, Math.min(o.attributes.get(DTA.TopVert) ?? 0, totalV - visibleV)))
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
  trigger(address: number, fn: number): boolean {
    const o = this.objects.get(address)
    if (!o || o.descriptor.groupID !== GID.SOUND || fn !== 2) return false
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
    const buffer = o.attributes.get(TDTA.Buffer); const length = o.attributes.get(TDTA.BufferLen)
    if (!buffer || length === undefined) return null
    return Uint8Array.from(this.memory.buffer.subarray(buffer - this.memory.base, buffer - this.memory.base + length))
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
    const text = guideText(node.content); const raw = new Uint8Array(text.length + 1)
    for (let i = 0; i < text.length; i++) raw[i] = text.charCodeAt(i) & 0xff
    const buffer = this.bytes(o.owned, raw); const name = this.string(o.owned, node.id); const title = this.string(o.owned, node.title)
    o.attributes.set(TDTA.Buffer, buffer); o.attributes.set(TDTA.BufferLen, text.length)
    o.attributes.set(DTA.NodeName, name); o.attributes.set(DTA.Title, title)
    const lines = text.split('\n'); const width = Math.max(0, ...lines.map(line => line.length)); const height = lines.length
    o.attributes.set(DTA.TotalVert, height); o.attributes.set(DTA.VisibleVert, height); o.attributes.set(DTA.TotalPVert, height)
    o.attributes.set(DTA.TotalHoriz, width); o.attributes.set(DTA.TotalPHoriz, width)
    return true
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
}

/** V40 GetDTString ids used by datatypes.library. Unknown ids return empty. */
export const dataTypeString = (id: number): string => ({
  0: 'DataTypes', 1: 'Could not open datatype', 2: 'Unknown datatype', 3: 'DataType error',
}[id] ?? '')
