/**
 * OS DevKit 1.61 — first callable slice.
 *
 * This is deliberately an ExtensionImpl over the already-audited machine
 * helpers, not a 68k emulator. The routines cited below are workers resolved
 * through the library's Rbra trampolines by src/cli/osbackend.ts.
 */
import type { Func, Instr } from '../interp/builtins'
import { VI, VS, int, str } from '../interp/values'
import { OsCStringHeap } from '../amiga/oscstring'
import {
  A1200_POOLS, MEMF, availMem, closeLibrary, libraryRevision, libraryVersion, type MemPool, openLibrary,
} from '../amiga/exec'
import { amiga2Date } from '../amiga/datestamp'
import {
  CUSTOMSCREEN, GACT_GADGIMMEDIATE, GACT_RELVERIFY, GFLG_GADGDISABLED,
  IntuitionBaseLock, WBENCHSCREEN, WB_SLOT, WFLG_REPORTMOUSE, type UserGadget, type Window,
} from '../amiga/intuition'
import type { ExecSystem } from '../amiga/osexec'
import {
  OsWindowIds, OsWindowPatterns, eventCode, eventGadget, eventGadgetBank, eventItem, eventMenu,
  eventMouseX, eventMouseY, eventQualifier, eventSub, eventWindow, type OsWindowEvent,
} from '../amiga/oswindowid'
import {
  BARLABEL, GTBB_FRAMETYPE, GTBB_RECESSED, KIND, MENUNULL, NM, TAG, fullMenuNum, itemNum, menuNum, subNum,
  type Gadget, type GadgetKind, type GadTools, type MenuItem, type MenuStrip, type NewGadget, type NewMenu,
} from '../amiga/gadtools'
import { NativeScreenDrawInfoPens } from '../amiga/osintuitionstruct'
import { LayerInfo, refreshFromFlags, type Layer } from '../amiga/layers'
import { glyphBit, glyphMetrics, openDiskFont, type DiskFont } from '../amiga/diskfont'
import {
  allocColorMap, findColor, freeColorMap, getRgb4, getRgb32, obtainBestPen, obtainPen, releasePen, setRgb4ColorMap, setRgb32ColorMap,
  type NativeColorMap,
} from '../amiga/oscolormap'
import {
  chrLong, chrWord, extendByte, extendWithinWord, extendWord, joinWord, valLong, valWord,
} from '../amiga/osscalar'
import {
  A1200_ATTN_FLAGS, EXEC_SOFT_VERSION, EXEC_VERSION, systemCpu, systemFpu,
} from '../amiga/ossystem'
import type { Runtime } from './runtime'
import { screenPens } from './aslreq'
import { blitToRastPort } from './objects'
import { scrollRaster, type RastPort } from '../amiga/graphics'
import { doMethodA, doSuperMethodA, getAttr, setAttrsA, type BoopsiObject } from '../amiga/boopsi'
import { ieReadImage } from './intuiextendgad'
import { JP_TYPE_MASK, SCON_TAKE_OVER_SYS, SJA_TYPE_AUTOSENSE, elapsedTime, keyQuery, readJoyPort, setJoyPortType } from '../amiga/lowlevel'
import { IffParse } from '../amiga/iffparse'
import { Commodities } from '../amiga/commodities'
import { DosVariables } from '../amiga/dosvars'
import { ReadArgs } from '../amiga/readargs'
import { joinAmigaPath, type AmigaFS } from '../amiga/vfs'
import { DataTypesService, dataTypeString } from '../amiga/datatypes'
import { SHIPPED_DATATYPES } from '../amiga/datatypes.gen'
import { dosFilePart, dosPathPart } from '../amiga/dos'
import { loadHunks } from '../amiga/hunk'
import { OsResourceTracker } from '../amiga/ostracker'
import { wbArgLock, wbArgName, type WbArg } from '../amiga/wbarg'
import { findToolType, matchToolValue } from '../amiga/icon'
import { displayModeOf } from '../amiga/displayinfo'
import { getCatalogStr, getLocaleStr, parseCatalog, type Catalog } from '../amiga/localelib'

const SCREEN_CTRL_BASE = 0x4800_0000
const SCREEN_CTRL_SLOT = 0x1000

// intuition/intuition.h: WA_Dummy + 1 through the OpenWindowTagList core.
const WA = {
  Left: 0x80000064, Top: 0x80000065, Width: 0x80000066, Height: 0x80000067,
  DetailPen: 0x80000068, BlockPen: 0x80000069, IDCMP: 0x8000006a, Flags: 0x8000006b,
  Title: 0x8000006e, ScreenTitle: 0x8000006f, CustomScreen: 0x80000070,
  MinWidth: 0x80000072, MinHeight: 0x80000073, MaxWidth: 0x80000074, MaxHeight: 0x80000075,
} as const

export interface OsDevKitState {
  memory: MemPool
  strings: OsCStringHeap
  /** routine 1320's null/EntNul target: the library's private TagItem list. */
  defaultTagAddress: number
  defaultTagCursor: number
  /** Embedded TextAttr returned by `_base topaz`. */
  topazTextAttr: number
  /** Private 32-byte NewScreen definition mutated by `_scr def ...`. */
  screenDefinition: number
  /** Private 48-byte NewWindow definition mutated by `_wnd def ...`. */
  windowDefinition: number
  systemView: number
  activeView: number
  ibase: IntuitionBaseLock
  exec: ExecSystem
  colorMaps: Map<number, NativeColorMap>
  rastPortMaxPens: Map<number, number>
  screenIds: Map<number, { slot: number; base: number; rastPort: number; viewPort: number; bitMap: number; owned: boolean; publicLock: boolean }>
  /** DrawInfo blocks returned by GetScreenDrawInfo, keyed by their native pointer. */
  drawInfos: Map<number, { screen: number; font: number }>
  drawInfoDefaults: NativeScreenDrawInfoPens
  /** 0 for system pens, -1 for drawInfoDefaults, otherwise a caller pen-array pointer. */
  drawInfoPenSource: number
  /** SA_Pens policy captured by each screen opened through the Screen-ID wrapper. */
  screenDrawInfoPens: Map<number, number[]>
  currentScreenId: number
  windowIds: OsWindowIds
  windowHandles: Map<number, { window: Window; rastPort: number; bitMap: number }>
  /** Caller-owned old-style Requester pointers currently attached to a Window. */
  requesterWindows: Map<number, Window>
  windowPatterns: OsWindowPatterns
  /** The one MsgPort assigned to every Window-ID, as in private +$2f0. */
  windowPort: number
  windowEvent: OsWindowEvent
  fillPatternAddress: number
  areaPaths: Map<number, Array<{ kind: 'move' | 'draw' | 'ellipse'; values: number[] }>>
  gadtools: GadTools
  gadgetDef: NewGadget & { textPointer: number; font: number }
  nativeGadgets: Map<number, UserGadget>
  newMenuLists: Map<number, { capacity: number; cursor: number; entries: NewMenu[] }>
  menuItemRefs: Map<number, MenuItem>
  menuItemAddresses: Map<MenuItem, number>
  nextMenuItemAddress: number
  /** BOOPSI handles created through OS DevKit's private object registry 21. */
  boopsiObjects: Set<number>
  /** Cached private imageclass subclass returned by worker 1892. */
  fileImageClass: number
  gtGadgetBanks: Map<number, { max: number; screenSlot: number; visualInfo: number; context: Gadget; gadgets: Map<number, Gadget>; objects: Map<number, BoopsiObject>; attachedWindowId: number }>
  currentGtGadgetBank: number
  gtMode: { disabled: boolean; underscore: string; immediate: boolean; relVerify: boolean }
  gtIntegerMode: { tabCycle: boolean; maxChars: number; exitHelp: boolean; replaceMode: boolean }
  gtStringMode: { tabCycle: boolean; maxChars: number; exitHelp: boolean; replaceMode: boolean }
  gtListViewMode: { top: number; makeVisible: number; readOnly: boolean; scrollWidth: number; show: number; spacing: number }
  gtArrays: Map<number, number[]>
  gtLists: Map<number, number[]>
  gtMenuBanks: Map<number, { max: number; screenSlot: number; visualInfo: number; entries: NewMenu[]; strip: MenuStrip | null }>
  currentGtMenuBank: number
  openLibraries: Set<number>
  lowlevelBase: number
  lowlevelClock: { last: number }
  iff: IffParse
  iffBase: number
  commodities: Commodities
  dosVariables: DosVariables
  readArgs: ReadArgs
  dataTypes: DataTypesService
  dosNotifications: Map<number, { stop: () => void; name: number; messages: number[] }>
  dosSegments: Map<number, { base: number; path: string; size: number }>
  /** OS DevKit's private 32-class pointer tracker (workers 1883-1886). */
  tracker: OsResourceTracker
  /** Stable FindToolType result pointers, owned for each managed DiskObject. */
  toolTypePointers: Map<number, Map<string, number>>
  /** Stable FindDisplayInfo handles keyed by installed DisplayID. */
  displayInfoHandles: Map<number, number>
  /** Managed OpenLocale handles and their stable GetLocaleStr pointers. */
  locales: Map<number, Map<number, number>>
  /** Managed OpenCatalog handles and their stable translated string pointers. */
  catalogs: Map<number, { catalog: Catalog; strings: Map<number, number> }>
  chipRevision: number
  amosName: string
  dataRegisters: Int32Array
  addressRegisters: Int32Array
  pools: Map<number, { requirements: number; puddleSize: number; thresholdSize: number; allocations: Set<number> }>
  bitMaps: Map<number, { width: number; flags: number; ownedPlanes: number[] }>
  hardwareSprites: Array<{ sprite: number; data: number; viewPort: number } | null>
  /** AllocAslRequest-owned public requester prefixes, keyed by native address. */
  aslRequests: Map<number, { type: number; pending: boolean; ownedStrings: number[]; allocTags: Array<{ tag: number; data: number }> }>
  layerInfos: Map<number, LayerInfo | null>
  layers: Map<number, { owner: number; layer: Layer; bitmap: number; backfill: number }>
  fonts: Map<number, { font: DiskFont; opens: number; resident: boolean; name: number }>
}

export const newOsDevKitState = (exec: ExecSystem, gadtools: GadTools, fs: () => AmigaFS | null = () => null): OsDevKitState => {
  const strings = new OsCStringHeap(exec.pool)
  const state: OsDevKitState = {
    memory: exec.pool, strings, defaultTagAddress: 0, defaultTagCursor: 0,
    topazTextAttr: 0, screenDefinition: 0, windowDefinition: 0, systemView: 0, activeView: 0, ibase: new IntuitionBaseLock(), exec, colorMaps: new Map(), rastPortMaxPens: new Map(),
    screenIds: new Map(), drawInfos: new Map(), drawInfoDefaults: new NativeScreenDrawInfoPens(),
    drawInfoPenSource: 0, screenDrawInfoPens: new Map(), currentScreenId: -1,
    windowIds: new OsWindowIds(), windowHandles: new Map(), requesterWindows: new Map(),
    windowPatterns: new OsWindowPatterns(), windowPort: 0,
    windowEvent: { class: 0, code: 0, qualifier: 0, gadgetId: null, gadgetUserData: null, windowId: -1, mouseX: 0, mouseY: 0 },
    fillPatternAddress: 0,
    areaPaths: new Map(),
    gadtools,
    gadgetDef: { leftEdge: 0, topEdge: 0, width: 0, height: 0, gadgetText: '', gadgetID: 0, flags: 0, visualInfo: 0, userData: 0, textPointer: 0, font: 0 },
    nativeGadgets: new Map(),
    newMenuLists: new Map(), menuItemRefs: new Map(), menuItemAddresses: new Map(), nextMenuItemAddress: 0x7300_0000,
    boopsiObjects: new Set(), fileImageClass: 0,
    gtGadgetBanks: new Map(), currentGtGadgetBank: 0,
    gtMode: { disabled: false, underscore: '', immediate: false, relVerify: false },
    gtIntegerMode: { tabCycle: false, maxChars: 10, exitHelp: false, replaceMode: false },
    gtStringMode: { tabCycle: false, maxChars: 10, exitHelp: false, replaceMode: false },
    gtListViewMode: { top: 0, makeVisible: -1, readOnly: false, scrollWidth: 16, show: 0, spacing: 0 },
    gtArrays: new Map(), gtLists: new Map(),
    gtMenuBanks: new Map(), currentGtMenuBank: 0,
    openLibraries: new Set(), lowlevelBase: 0, lowlevelClock: { last: 0 }, iff: new IffParse(exec.pool), iffBase: 0,
    commodities: new Commodities(exec.messages),
    dosVariables: new DosVariables(exec.pool, fs), readArgs: new ReadArgs(),
    dataTypes: new DataTypesService(exec.pool, SHIPPED_DATATYPES), dosNotifications: new Map(), dosSegments: new Map(),
    tracker: new OsResourceTracker(), toolTypePointers: new Map(), displayInfoHandles: new Map(),
    locales: new Map(), catalogs: new Map(), chipRevision: 0xf, amosName: '',
    dataRegisters: new Int32Array(8), addressRegisters: new Int32Array(8), pools: new Map(), bitMaps: new Map(),
    hardwareSprites: Array.from({ length: 8 }, () => null), aslRequests: new Map(),
    layerInfos: new Map(), layers: new Map(),
    fonts: new Map(),
  }
  return state
}

function defaultTagsAddress(state: OsDevKitState): number {
  if (state.defaultTagAddress === 0) state.defaultTagAddress = state.memory.alloc(512, { clear: true })
  return state.defaultTagAddress
}

function topazTextAttrAddress(state: OsDevKitState): number {
  if (state.topazTextAttr !== 0) return state.topazTextAttr
  const address = state.memory.alloc(8, { clear: true })
  if (address === 0) return 0
  state.topazTextAttr = address
  set32(state, address, state.strings.fromAmos('topaz.font'))
  set32Word(state, address + 4, 8)
  state.memory.buffer[address + 7 - state.memory.base] = 1
  return address
}

function screenDefinitionAddress(state: OsDevKitState): number {
  if (state.screenDefinition !== 0) return state.screenDefinition
  const address = state.memory.alloc(32, { clear: true })
  if (address === 0) return 0
  state.screenDefinition = address
  set32Word(state, address + 4, 640); set32Word(state, address + 6, 256); set32Word(state, address + 8, 3)
  state.memory.buffer[address + 11 - state.memory.base] = 1
  set32(state, address + 16, topazTextAttrAddress(state))
  return address
}

function windowDefinitionAddress(state: OsDevKitState): number {
  if (state.windowDefinition === 0) {
    state.windowDefinition = state.memory.alloc(48, { clear: true })
    if (state.windowDefinition !== 0) {
      set32Word(state, state.windowDefinition, 16); set32Word(state, state.windowDefinition + 2, 16)
      set32Word(state, state.windowDefinition + 4, 64); set32Word(state, state.windowDefinition + 6, 64)
      state.memory.buffer[state.windowDefinition + 9 - state.memory.base] = 1
      set32(state, state.windowDefinition + 14, 2); set32Word(state, state.windowDefinition + 46, WBENCHSCREEN)
    }
  }
  return state.windowDefinition
}

function setFillPattern(state: OsDevKitState, high: boolean, values: readonly number[]): void {
  if (high) state.windowPatterns.setHigh(values); else state.windowPatterns.setLow(values)
  if (state.fillPatternAddress === 0) return
  const words = high ? state.windowPatterns.high : state.windowPatterns.low
  for (let i = 0; i < 8; i++) set32Word(state, state.fillPatternAddress + (high ? 16 : 0) + i * 2, words[i]!)
}

function fillPatternAddress(state: OsDevKitState): number {
  if (state.fillPatternAddress !== 0) return state.fillPatternAddress
  state.fillPatternAddress = state.memory.alloc(32, { clear: true })
  if (state.fillPatternAddress !== 0) {
    const low = Array.from(state.windowPatterns.low); const high = Array.from(state.windowPatterns.high)
    setFillPattern(state, false, low); setFillPattern(state, true, high)
  }
  return state.fillPatternAddress
}

function set32Word(state: OsDevKitState, address: number, value: number): void {
  const at = offset(state, address); state.memory.buffer[at] = value >>> 8; state.memory.buffer[at + 1] = value
}

const offset = (st: OsDevKitState, address: number): number => (address >>> 0) - st.memory.base
const get32 = (st: OsDevKitState, address: number): number => {
  const at = offset(st, address)
  const b = st.memory.buffer
  return (((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0)
}
const set32 = (st: OsDevKitState, address: number, value: number): void => {
  const at = offset(st, address)
  const b = st.memory.buffer
  b[at] = value >>> 24
  b[at + 1] = value >>> 16
  b[at + 2] = value >>> 8
  b[at + 3] = value
}
function cString(rt: Runtime, address: number): string {
  if (address === 0) return ''
  let result = ''
  for (let at = address >>> 0; ; at++) {
    const m = rt.resolveAddr(at)
    if (!m || m.data[m.off] === 0) break
    result += String.fromCharCode(m.data[m.off]!)
  }
  return result
}

function wbArgsAt(rt: Runtime, address: number, count: number): WbArg[] | null {
  if (address === 0 || count < 0) return null
  const args: WbArg[] = []
  for (let i = 0; i < count; i++) {
    const at = address + i * 8
    if (!rt.resolveAddr(at) || !rt.resolveAddr(at + 7)) return null
    args.push({ lock: structRead(rt, at, 4, false), name: structRead(rt, at + 4, 4, false) })
  }
  return args
}

function channelFind(st: OsDevKitState, list: number, position: number): number {
  if (list === 0 || position <= 0 || position > get32(st, list)) return 0
  let node = get32(st, list + 8)
  for (let at = 1; at < position; at++) node = get32(st, node - 12)
  return node
}

function channelLocation(st: OsDevKitState, node: number): number {
  if (node === 0) return 0
  const list = get32(st, node - 20)
  let cursor = get32(st, list + 8)
  for (let position = 1; cursor !== 0; position++, cursor = get32(st, cursor - 12)) {
    if (cursor === (node >>> 0)) return position
  }
  return 0
}

function channelAdd(st: OsDevKitState, list: number, length: number): number {
  if (list === 0) return 0
  const size = Math.max(0, length | 0)
  const base = st.memory.alloc(size + 24, { clear: true })
  if (base === 0) return 0
  const node = (base + 24) >>> 0
  const previous = get32(st, list + 12)
  set32(st, node - 24, size)
  set32(st, node - 20, list)
  set32(st, node - 16, previous)
  set32(st, node - 8, previous)
  set32(st, node - 4, list)
  set32(st, list, get32(st, list) + 1)
  set32(st, list + 12, node)
  if (get32(st, list + 8) === 0) set32(st, list + 8, node)
  else {
    set32(st, previous - 12, node)
    set32(st, previous - 4, node)
  }
  return node
}

function channelInsert(st: OsDevKitState, before: number, length: number): number {
  if (before === 0) return 0
  const list = get32(st, before - 20)
  const previous = get32(st, before - 16)
  const size = Math.max(0, length | 0)
  const base = st.memory.alloc(size + 24, { clear: true })
  if (base === 0) return 0
  const node = (base + 24) >>> 0
  set32(st, node - 24, size)
  set32(st, node - 20, list)
  set32(st, node - 16, previous)
  set32(st, node - 12, before)
  set32(st, node - 8, previous)
  set32(st, node - 4, before)
  set32(st, before - 16, node)
  set32(st, list, get32(st, list) + 1)
  if (previous === 0) set32(st, list + 8, node)
  else set32(st, previous - 12, node)
  return node
}

function channelFree(st: OsDevKitState, node: number): void {
  if (node === 0) return
  const list = get32(st, node - 20)
  const previous = get32(st, node - 16)
  const next = get32(st, node - 12)
  if (previous === 0) set32(st, list + 8, next)
  else set32(st, previous - 12, next)
  if (next === 0) set32(st, list + 12, previous)
  else set32(st, next - 16, previous)
  set32(st, list, get32(st, list) - 1)
  st.memory.freeMem((node - 24) >>> 0)
}

function channelResize(st: OsDevKitState, node: number, length: number): number {
  if (node === 0) return 0
  const size = Math.max(0, length | 0); const oldSize = get32(st, node - 24)
  const base = st.memory.alloc(size + 24, { clear: true })
  if (base === 0) return 0
  const replacement = (base + 24) >>> 0
  st.memory.buffer.set(
    st.memory.buffer.subarray(offset(st, node - 24), offset(st, node) + Math.min(oldSize, size)),
    offset(st, base),
  )
  set32(st, replacement - 24, size)
  const list = get32(st, replacement - 20), previous = get32(st, replacement - 16), next = get32(st, replacement - 12)
  if (get32(st, list + 8) === (node >>> 0)) set32(st, list + 8, replacement)
  if (get32(st, list + 12) === (node >>> 0)) set32(st, list + 12, replacement)
  if (previous !== 0) {
    if (get32(st, previous - 12) === (node >>> 0)) set32(st, previous - 12, replacement)
    if (get32(st, previous - 4) === (node >>> 0)) set32(st, previous - 4, replacement)
  }
  if (next !== 0) {
    if (get32(st, next - 16) === (node >>> 0)) set32(st, next - 16, replacement)
    if (get32(st, next - 8) === (node >>> 0)) set32(st, next - 8, replacement)
  }
  st.memory.freeMem((node - 24) >>> 0)
  return replacement
}

function tagItems(st: OsDevKitState, list: number): Array<{ tag: number; data: number; address: number }> {
  if (list === 0 || list === -0x8000_0000) list = defaultTagsAddress(st)
  const out: Array<{ tag: number; data: number; address: number }> = []
  for (let at = list >>> 0; ; at += 8) {
    const tag = get32(st, at)
    if (tag === 0) break
    out.push({ tag, data: get32(st, at + 4) | 0, address: at })
  }
  return out
}

function setTag(st: OsDevKitState, list: number, tag: number, data: number): void {
  if (list === 0 || list === -0x8000_0000) {
    const base = defaultTagsAddress(st); const at = base + st.defaultTagCursor * 8
    if (base !== 0 && st.defaultTagCursor < 63) {
      set32(st, at, tag); set32(st, at + 4, data); st.defaultTagCursor++
    }
    return
  }
  const used = get32(st, list - 4)
  const capacity = get32(st, list - 8)
  if (used + 1 >= capacity) return
  set32(st, list + used * 4, tag)
  set32(st, list + used * 4 + 4, data)
  set32(st, list - 4, used + 2)
}

function finishTags(st: OsDevKitState, list: number): void {
  if (list === 0 || list === -0x8000_0000) {
    const base = defaultTagsAddress(st)
    if (base !== 0) set32(st, base + st.defaultTagCursor * 8, 0)
    st.defaultTagCursor = 0
    return
  }
  set32(st, list + get32(st, list - 4) * 4, 0)
  set32(st, list - 4, 0)
}

function writeLong(rt: Runtime, address: number, value: number): void {
  rt.longsAt(address >>> 0, true)?.set(0, value)
}

type StructWidth = 1 | 2 | 4

function structRead(rt: Runtime, address: number, width: StructWidth, signed: boolean): number {
  const m = rt.resolveAddr(address >>> 0)
  if (!m || m.off + width > m.data.length) return 0
  let value = 0
  for (let i = 0; i < width; i++) value = (value << 8) | m.data[m.off + i]!
  if (width === 4) return value | 0
  const bits = width * 8
  return signed && value >= 2 ** (bits - 1) ? value - 2 ** bits : value
}

function structWrite(rt: Runtime, address: number, width: StructWidth, value: number): void {
  const m = rt.resolveWrite(address >>> 0)
  if (!m || m.off + width > m.data.length) return
  for (let i = 0; i < width; i++) m.data[m.off + i] = value >>> ((width - i - 1) * 8)
}

interface NativeRaster {
  rp: number
  bitmap: number
  bytesPerRow: number
  height: number
  depth: number
  width: number
  /** Inclusive clipping rectangle imposed by the selected native RastPort. */
  clip?: { x1: number; y1: number; x2: number; y2: number } | null
}

function nativeRaster(rt: Runtime, rp: number): NativeRaster | null {
  const bitmap = structRead(rt, rp + 4, 4, false) >>> 0
  if (bitmap === 0) return null
  const bytesPerRow = structRead(rt, bitmap, 2, false)
  const height = structRead(rt, bitmap + 2, 2, false)
  const depth = Math.min(8, structRead(rt, bitmap + 5, 1, false))
  if (bytesPerRow === 0 || height === 0 || depth === 0) return null
  return { rp, bitmap, bytesPerRow, height, depth, width: bytesPerRow * 8 }
}

function nativePoint(rt: Runtime, raster: NativeRaster, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return -1
  let color = 0
  for (let plane = 0; plane < raster.depth; plane++) {
    const address = structRead(rt, raster.bitmap + 8 + plane * 4, 4, false) >>> 0
    const byte = rt.resolveAddr(address + y * raster.bytesPerRow + (x >>> 3))
    if (byte && ((byte.data[byte.off]! >>> (7 - (x & 7))) & 1) !== 0) color |= 1 << plane
  }
  return color
}

function insideNativeRaster(raster: NativeRaster, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return false
  const clip = raster.clip
  return !clip || (x >= clip.x1 && y >= clip.y1 && x <= clip.x2 && y <= clip.y2)
}

function nativePlot(rt: Runtime, raster: NativeRaster, x: number, y: number): void {
  if (!insideNativeRaster(raster, x, y)) return
  const fg = structRead(rt, raster.rp + 25, 1, false)
  const mode = structRead(rt, raster.rp + 28, 1, false)
  const mask = structRead(rt, raster.rp + 24, 1, false)
  const old = nativePoint(rt, raster, x, y)
  const colorMask = (1 << raster.depth) - 1
  const wanted = mode === 2 ? (~old & colorMask) : fg
  const next = ((old & ~mask) | (wanted & mask)) & colorMask
  for (let plane = 0; plane < raster.depth; plane++) {
    if ((mask & (1 << plane)) === 0) continue
    const address = structRead(rt, raster.bitmap + 8 + plane * 4, 4, false) >>> 0
    const byte = rt.resolveWrite(address + y * raster.bytesPerRow + (x >>> 3))
    if (!byte) continue
    const bit = 1 << (7 - (x & 7))
    byte.data[byte.off] = (next & (1 << plane)) !== 0 ? byte.data[byte.off]! | bit : byte.data[byte.off]! & ~bit
  }
}

function nativePutColor(rt: Runtime, raster: NativeRaster, x: number, y: number, color: number, ignoreClip = false): void {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return
  if (!ignoreClip && !insideNativeRaster(raster, x, y)) return
  const mask = structRead(rt, raster.rp + 24, 1, false)
  for (let plane = 0; plane < raster.depth; plane++) {
    if ((mask & (1 << plane)) === 0) continue
    const address = structRead(rt, raster.bitmap + 8 + plane * 4, 4, false) >>> 0
    const byte = rt.resolveWrite(address + y * raster.bytesPerRow + (x >>> 3))
    if (!byte) continue
    const bit = 1 << (7 - (x & 7))
    byte.data[byte.off] = (color & (1 << plane)) !== 0 ? byte.data[byte.off]! | bit : byte.data[byte.off]! & ~bit
  }
}

function nativeScrollRaster(rt: Runtime, raster: NativeRaster, dx: number, dy: number, x1: number, y1: number, x2: number, y2: number): void {
  if (x1 > x2) [x1, x2] = [x2, x1]
  if (y1 > y2) [y1, y2] = [y2, y1]
  x1 = Math.max(0, x1); y1 = Math.max(0, y1); x2 = Math.min(raster.width - 1, x2); y2 = Math.min(raster.height - 1, y2)
  if (x2 < x1 || y2 < y1 || (dx === 0 && dy === 0)) return
  const width = x2 - x1 + 1; const height = y2 - y1 + 1; const source = new Int16Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) source[y * width + x] = nativePoint(rt, raster, x1 + x, y1 + y)
  const background = structRead(rt, raster.rp + 26, 1, false)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = x + dx; const sy = y + dy
    nativePutColor(rt, raster, x1 + x, y1 + y, sx >= 0 && sx < width && sy >= 0 && sy < height ? source[sy * width + sx]! : background)
  }
}

function nativeBitmapPixel(rt: Runtime, bitmap: number, x: number, y: number): number {
  const rowBytes = structRead(rt, bitmap, 2, false); const height = structRead(rt, bitmap + 2, 2, false)
  const depth = Math.min(8, structRead(rt, bitmap + 5, 1, false)); if (x < 0 || y < 0 || x >= rowBytes * 8 || y >= height) return 0
  let colour = 0
  for (let plane = 0; plane < depth; plane++) {
    const data = structRead(rt, bitmap + 8 + plane * 4, 4, false) >>> 0; const byte = rt.resolveAddr(data + y * rowBytes + (x >>> 3))
    if (byte && (byte.data[byte.off]! & (0x80 >>> (x & 7))) !== 0) colour |= 1 << plane
  }
  return colour
}

function putNativeBitmapPixel(rt: Runtime, bitmap: number, x: number, y: number, colour: number): void {
  const rowBytes = structRead(rt, bitmap, 2, false); const height = structRead(rt, bitmap + 2, 2, false)
  const depth = Math.min(8, structRead(rt, bitmap + 5, 1, false)); if (x < 0 || y < 0 || x >= rowBytes * 8 || y >= height) return
  for (let plane = 0; plane < depth; plane++) {
    const data = structRead(rt, bitmap + 8 + plane * 4, 4, false) >>> 0; const byte = rt.resolveWrite(data + y * rowBytes + (x >>> 3))
    if (!byte) continue
    const bit = 0x80 >>> (x & 7); byte.data[byte.off] = (colour & (1 << plane)) !== 0 ? byte.data[byte.off]! | bit : byte.data[byte.off]! & ~bit
  }
}

function nativeDrawImage(rt: Runtime, image: number, raster: NativeRaster, offsetX: number, offsetY: number): void {
  const left = structRead(rt, image, 2, true); const top = structRead(rt, image + 2, 2, true)
  const width = structRead(rt, image + 4, 2, false); const height = structRead(rt, image + 6, 2, false)
  const depth = structRead(rt, image + 8, 2, false); const data = structRead(rt, image + 10, 4, false) >>> 0
  const pick = structRead(rt, image + 14, 1, false); const onOff = structRead(rt, image + 15, 1, false)
  const rowBytes = ((width + 15) >>> 4) * 2; const planeBytes = rowBytes * height
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let color = 0; let sourcePlane = 0
    for (let bit = 0; bit < 8; bit++) {
      if ((pick & (1 << bit)) === 0) { if ((onOff & (1 << bit)) !== 0) color |= 1 << bit; continue }
      if (sourcePlane < depth) {
        const byte = rt.resolveAddr(data + sourcePlane * planeBytes + y * rowBytes + (x >>> 3))
        if (byte && (byte.data[byte.off]! & (0x80 >>> (x & 7))) !== 0) color |= 1 << bit
      }
      sourcePlane++
    }
    nativePutColor(rt, raster, offsetX + left + x, offsetY + top + y, color)
  }
}

function nativeDraw(rt: Runtime, raster: NativeRaster, x1: number, y1: number, x2: number, y2: number): void {
  const dx = Math.abs(x2 - x1); const sx = x1 < x2 ? 1 : -1
  const dy = -Math.abs(y2 - y1); const sy = y1 < y2 ? 1 : -1
  let error = dx + dy
  const pattern = structRead(rt, raster.rp + 34, 2, false)
  let patternBit = 15
  for (;;) {
    if (((pattern >>> patternBit) & 1) !== 0) nativePlot(rt, raster, x1, y1)
    patternBit = patternBit === 0 ? 15 : patternBit - 1
    if (x1 === x2 && y1 === y2) break
    const twice = 2 * error
    if (twice >= dy) { error += dy; x1 += sx }
    if (twice <= dx) { error += dx; y1 += sy }
  }
  structWrite(rt, raster.rp + 36, 2, x2); structWrite(rt, raster.rp + 38, 2, y2)
}

function nativeEllipse(rt: Runtime, raster: NativeRaster, cx: number, cy: number, rx: number, ry: number): void {
  if (rx <= 0 || ry <= 0) { nativePlot(rt, raster, cx, cy); return }
  const oldX = structRead(rt, raster.rp + 36, 2, true); const oldY = structRead(rt, raster.rp + 38, 2, true)
  let px = cx + rx; let py = cy
  const steps = Math.min(4096, Math.max(16, (rx + ry) * 2))
  for (let i = 1; i <= steps; i++) {
    const angle = i / steps * Math.PI * 2
    const x = cx + Math.round(rx * Math.cos(angle)); const y = cy + Math.round(ry * Math.sin(angle))
    nativeDraw(rt, raster, px, py, x, y); px = x; py = y
  }
  structWrite(rt, raster.rp + 36, 2, oldX); structWrite(rt, raster.rp + 38, 2, oldY)
}

function nativeFillColor(rt: Runtime, raster: NativeRaster, x: number, y: number): void {
  const pattern = structRead(rt, raster.rp + 8, 4, false) >>> 0
  if (pattern === 0) { nativePlot(rt, raster, x, y); return }
  const size = Math.min(4, structRead(rt, raster.rp + 29, 1, true))
  const rows = 1 << Math.max(0, size + 1)
  const word = structRead(rt, pattern + (y & (rows - 1)) * 2, 2, false)
  const useFront = (word & (0x8000 >>> (x & 15))) !== 0
  nativePutColor(rt, raster, x, y, structRead(rt, raster.rp + (useFront ? 25 : 26), 1, false))
}

function nativeFillPolygon(rt: Runtime, raster: NativeRaster, points: Array<[number, number]>): void {
  if (points.length < 3) return
  let minY = Infinity; let maxY = -Infinity
  for (const [, y] of points) { minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
  for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
    const xs: number[] = []
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i]!; const [x2, y2] = points[(i + 1) % points.length]!
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
    }
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.ceil(xs[i]!); x <= Math.floor(xs[i + 1]!); x++) nativeFillColor(rt, raster, x, y)
  }
}

function nativeFillEllipse(rt: Runtime, raster: NativeRaster, cx: number, cy: number, rx: number, ry: number): void {
  if (rx <= 0 || ry <= 0) return
  for (let y = -ry; y <= ry; y++) {
    const width = Math.floor(rx * Math.sqrt(Math.max(0, 1 - y * y / (ry * ry))))
    for (let x = -width; x <= width; x++) nativeFillColor(rt, raster, cx + x, cy + y)
  }
}

function nativeFlood(rt: Runtime, raster: NativeRaster, mode: number, sx: number, sy: number): void {
  const seed = nativePoint(rt, raster, sx, sy); if (seed < 0) return
  const outline = structRead(rt, raster.rp + 27, 1, false); const seen = new Set<number>()
  const open: Array<[number, number]> = [[sx, sy]]
  while (open.length) {
    const [x, y] = open.pop()!; const key = y * raster.width + x
    if (seen.has(key) || x < 0 || y < 0 || x >= raster.width || y >= raster.height) continue
    const color = nativePoint(rt, raster, x, y)
    if (mode === 0 ? color !== seed : color === outline) continue
    seen.add(key); nativeFillColor(rt, raster, x, y)
    open.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1])
  }
}

function appendArea(rt: Runtime, state: OsDevKitState, rp: number, kind: 'move' | 'draw' | 'ellipse', values: number[]): number {
  const area = structRead(rt, rp + 16, 4, false) >>> 0
  if (area === 0) return 0
  const count = structRead(rt, area + 16, 2, false); const max = structRead(rt, area + 18, 2, false)
  const needed = kind === 'ellipse' ? 2 : 1
  if (count + needed > max) return 0
  const vector = structRead(rt, area + 4, 4, false) >>> 0
  const flags = structRead(rt, area + 12, 4, false) >>> 0
  if (kind === 'ellipse') {
    for (let i = 0; i < 4; i++) structWrite(rt, vector + i * 2, 2, values[i]!)
    structWrite(rt, flags, 1, 2); structWrite(rt, flags + 1, 1, 2)
    structWrite(rt, area + 4, 4, vector + 8); structWrite(rt, area + 12, 4, flags + 2)
  } else {
    structWrite(rt, vector, 2, values[0]!); structWrite(rt, vector + 2, 2, values[1]!)
    structWrite(rt, flags, 1, kind === 'move' ? 0 : 1)
    structWrite(rt, area + 4, 4, vector + 4); structWrite(rt, area + 12, 4, flags + 1)
    if (count === 0) { structWrite(rt, area + 20, 2, values[0]!); structWrite(rt, area + 22, 2, values[1]!) }
  }
  structWrite(rt, area + 16, 2, count + needed)
  const path = state.areaPaths.get(area) ?? []; path.push({ kind, values }); state.areaPaths.set(area, path)
  return -1
}

function endArea(rt: Runtime, state: OsDevKitState, rp: number): number {
  const raster = nativeRaster(rt, rp); const area = structRead(rt, rp + 16, 4, false) >>> 0
  if (!raster || area === 0) return 0
  const path = state.areaPaths.get(area) ?? []; let polygon: Array<[number, number]> = []
  const flush = () => { nativeFillPolygon(rt, raster, polygon); polygon = [] }
  for (const command of path) {
    if (command.kind === 'move') { flush(); polygon.push([command.values[0]!, command.values[1]!]) }
    else if (command.kind === 'draw') polygon.push([command.values[0]!, command.values[1]!])
    else { flush(); nativeFillEllipse(rt, raster, command.values[0]!, command.values[1]!, command.values[2]!, command.values[3]!) }
  }
  flush(); state.areaPaths.set(area, [])
  const vectors = structRead(rt, area, 4, false); const flags = structRead(rt, area + 8, 4, false)
  structWrite(rt, area + 4, 4, vectors); structWrite(rt, area + 12, 4, flags); structWrite(rt, area + 16, 2, 0)
  return -1
}

function createNativeLayer(rt: Runtime, state: OsDevKitState, args: readonly number[], upfront: boolean): number {
  const infoAddress = args[0]! >>> 0; const bitmap = args[1]! >>> 0
  if (!state.layerInfos.has(infoAddress) || bitmap === 0) return 0
  let info = state.layerInfos.get(infoAddress) ?? null
  if (!info) {
    const width = structRead(rt, bitmap, 2, false) * 8; const height = structRead(rt, bitmap + 2, 2, false)
    if (width <= 0 || height <= 0) return 0
    info = new LayerInfo(width, height); state.layerInfos.set(infoAddress, info)
  }
  const rect = { minX: args[2]!, minY: args[3]!, maxX: args[4]!, maxY: args[5]! }
  const layer = upfront ? info.createUpfrontLayer(rect, refreshFromFlags(args[6]!)) : info.createBehindLayer(rect, refreshFromFlags(args[6]!))
  layer.backdrop = (args[6]! & 0x40) !== 0
  const address = state.memory.alloc(160, { clear: true }); if (address === 0) { info.deleteLayer(layer); return 0 }
  structWrite(rt, address + 8, 4, bitmap); structWrite(rt, address + 16, 2, rect.minX); structWrite(rt, address + 18, 2, rect.minY)
  structWrite(rt, address + 20, 2, rect.maxX); structWrite(rt, address + 22, 2, rect.maxY)
  state.layers.set(address, { owner: infoAddress, layer, bitmap, backfill: args[7]! >>> 0 }); return address
}

function nativeFont(state: OsDevKitState, font: DiskFont, resident: boolean): number {
  for (const [address, held] of state.fonts) if (held.font === font) { held.opens++; if (resident) held.resident = true; return address }
  const address = state.memory.alloc(52, { clear: true }); if (address === 0) return 0
  const name = state.strings.fromAmos(font.name)
  set32(state, address + 10, name)
  // The remaining public TextFont scalar fields are byte/word values.
  const off = address - state.memory.base
  state.memory.buffer[off + 20] = font.ySize >>> 8; state.memory.buffer[off + 21] = font.ySize
  state.memory.buffer[off + 22] = font.style; state.memory.buffer[off + 23] = font.flags
  state.memory.buffer[off + 24] = font.xSize >>> 8; state.memory.buffer[off + 25] = font.xSize
  state.memory.buffer[off + 26] = font.baseline >>> 8; state.memory.buffer[off + 27] = font.baseline
  state.memory.buffer[off + 32] = font.loChar; state.memory.buffer[off + 33] = font.hiChar
  state.fonts.set(address, { font, opens: 1, resident, name }); return address
}

function textAttr(rt: Runtime, state: OsDevKitState, address: number): { name: string; ySize: number; style: number; flags: number } | null {
  if (address === 0) return null
  const name = state.strings.get(structRead(rt, address, 4, false))
  return { name, ySize: structRead(rt, address + 4, 2, false), style: structRead(rt, address + 6, 1, false), flags: structRead(rt, address + 7, 1, false) }
}

function drawNativeText(rt: Runtime, state: OsDevKitState, rp: number, value: string, ox = 0, oy = 0): void {
  const raster = nativeRaster(rt, rp); const held = state.fonts.get(structRead(rt, rp + 52, 4, false) >>> 0)
  let x = structRead(rt, rp + 36, 2, true); const baseline = structRead(rt, rp + 38, 2, true)
  if (!raster || !held) { structWrite(rt, rp + 36, 2, x + value.length * 8); return }
  for (const ch of value) {
    const code = ch.charCodeAt(0); const metrics = glyphMetrics(held.font, code)
    for (let y = 0; y < held.font.ySize; y++) for (let gx = 0; gx < metrics.width; gx++) if (glyphBit(held.font, code, gx, y)) nativePlot(rt, raster, ox + x + metrics.kern + gx, oy + baseline - held.font.baseline + y)
    x += metrics.advance
  }
  structWrite(rt, rp + 36, 2, x)
}

function bindScreenId(rt: Runtime, state: OsDevKitState, id: number, slot: number, owned = false, publicLock = false): boolean {
  const screen = rt.screens.get(slot)
  if (!screen) return false
  const old = state.screenIds.get(id)
  if (old) {
    state.memory.freeMem(old.rastPort); state.memory.freeMem(old.viewPort); state.memory.freeMem(old.bitMap)
  }
  const bitMap = state.memory.alloc(40, { clear: true })
  const rastPort = state.memory.alloc(72, { clear: true })
  const viewPort = state.memory.alloc(40, { clear: true })
  structWrite(rt, bitMap, 2, screen.rowBytes); structWrite(rt, bitMap + 2, 2, screen.height)
  structWrite(rt, bitMap + 5, 1, screen.depth)
  for (let plane = 0; plane < screen.depth; plane++) structWrite(rt, bitMap + 8 + plane * 4, 4, rt.screenChipBase(slot) + plane * screen.planeSize)
  structWrite(rt, rastPort + 4, 4, bitMap); structWrite(rt, rastPort + 24, 1, 0xff)
  structWrite(rt, rastPort + 25, 1, screen.rp.fgPen); structWrite(rt, rastPort + 26, 1, screen.rp.bgPen)
  structWrite(rt, rastPort + 28, 1, screen.rp.drawMode); structWrite(rt, rastPort + 34, 2, screen.rp.linePtrn)
  structWrite(rt, rastPort + 52, 4, nativeFont(state, screen.font ?? rt.systemFont(), true))
  state.screenIds.set(id, {
    slot, base: (SCREEN_CTRL_BASE + slot * SCREEN_CTRL_SLOT) >>> 0,
    rastPort, viewPort, bitMap, owned, publicLock,
  })
  state.currentScreenId = id
  return true
}

/** Resolve one of Runtime's stable synthetic `struct Screen *` addresses. */
function managedScreenSlot(rt: Runtime, address: number): number | null {
  const relative = (address >>> 0) - SCREEN_CTRL_BASE
  if (relative < 0 || relative % SCREEN_CTRL_SLOT !== 0) return null
  const slot = relative / SCREEN_CTRL_SLOT
  return rt.screens.has(slot) ? slot : null
}

function screenRecordAtBase(state: OsDevKitState, base: number) {
  for (const [id, record] of state.screenIds) if (record.base === (base >>> 0)) return { id, record }
  return null
}

function systemViewAddress(rt: Runtime, state: OsDevKitState): number {
  if (state.systemView === 0) state.systemView = state.memory.alloc(18, { clear: true })
  if (state.systemView === 0) return 0
  const slot = rt.order[rt.order.length - 1]; const screen = slot === undefined ? undefined : rt.screens.get(slot)
  const record = slot === undefined ? undefined : [...state.screenIds.values()].find(entry => entry.slot === slot)
  structWrite(rt, state.systemView, 4, record?.viewPort ?? 0)
  structWrite(rt, state.systemView + 12, 2, screen?.displayY ?? 0); structWrite(rt, state.systemView + 14, 2, screen?.displayX ?? 0)
  structWrite(rt, state.systemView + 16, 2, screen ? (screen.hires ? 0x8000 : 0) | (screen.laced ? 4 : 0) : 0)
  return state.systemView
}

function selectedDrawInfoPens(rt: Runtime, state: OsDevKitState, depth: number): number[] {
  if (state.drawInfoPenSource === -1) return Array.from(state.drawInfoDefaults.pens)
  if (state.drawInfoPenSource !== 0) {
    return Array.from({ length: 12 }, (_, i) => structRead(rt, state.drawInfoPenSource + i * 2, 2, false))
  }
  return Array.from(screenPens(depth).pens)
}

/** GetScreenDrawInfo: a tracked 50-byte public record with its pen array. */
function allocScreenDrawInfo(rt: Runtime, state: OsDevKitState, screenAddress: number): number {
  const slot = managedScreenSlot(rt, screenAddress)
  if (slot === null) return 0
  const screen = rt.screens.get(slot)
  if (!screen) return 0
  // Keep the 24-byte pen array behind the public 50-byte structure. Intuition
  // owns both and FreeScreenDrawInfo releases them as one allocation.
  const address = state.memory.alloc(74, { clear: true })
  if (address === 0) return 0
  const pensAddress = address + 50
  const pens = state.screenDrawInfoPens.get(slot) ?? Array.from(screenPens(screen.depth).pens)
  for (let i = 0; i < 12; i++) structWrite(rt, pensAddress + i * 2, 2, pens[i] ?? 0)
  const font = nativeFont(state, screen.font ?? rt.systemFont(), true)
  structWrite(rt, address, 2, 2) // DRI_VERSION = 2 on the V39 machine model
  structWrite(rt, address + 2, 2, 12)
  structWrite(rt, address + 4, 4, pensAddress)
  structWrite(rt, address + 8, 4, font)
  structWrite(rt, address + 12, 2, screen.depth)
  structWrite(rt, address + 14, 2, screen.hires ? 1 : 2)
  structWrite(rt, address + 16, 2, screen.laced ? 1 : 2)
  state.drawInfos.set(address, { screen: screenAddress >>> 0, font })
  return address
}

function freeScreenDrawInfo(state: OsDevKitState, screenAddress: number, address: number): void {
  const held = state.drawInfos.get(address >>> 0)
  if (!held || held.screen !== (screenAddress >>> 0)) return
  const font = state.fonts.get(held.font)
  if (font && font.opens > 0) font.opens--
  state.drawInfos.delete(address >>> 0)
  state.memory.freeMem(address >>> 0)
}

function closeScreenId(rt: Runtime, state: OsDevKitState, id: number): void {
  const record = state.screenIds.get(id)
  if (!record) return
  state.memory.freeMem(record.rastPort); state.memory.freeMem(record.viewPort); state.memory.freeMem(record.bitMap)
  if (record.owned) { state.screenDrawInfoPens.delete(record.slot); rt.intuition.closeScreen(record.base) }
  if (record.publicLock) rt.intuition.unlockPubScreen(record.base)
  state.screenIds.delete(id)
  if (state.currentScreenId === id) state.currentScreenId = -1
}

function currentScreenRaster(rt: Runtime, state: OsDevKitState): NativeRaster | null {
  const record = state.screenIds.get(state.currentScreenId)
  if (!record) return null
  const raster = nativeRaster(rt, record.rastPort)
  if (raster) raster.clip = rt.screens.get(record.slot)?.rp.clip ?? null
  return raster
}

function currentScreen(rt: Runtime, state: OsDevKitState) {
  const record = state.screenIds.get(state.currentScreenId)
  return record ? rt.screens.get(record.slot) : undefined
}

function screenAtViewPort(rt: Runtime, state: OsDevKitState, viewPort: number) {
  const record = [...state.screenIds.values()].find((entry) => entry.viewPort === (viewPort >>> 0))
  return record ? rt.screens.get(record.slot) : undefined
}

function setViewPortRgb(rt: Runtime, state: OsDevKitState, viewPort: number, pen: number, red: number, green: number, blue: number, bits: 4 | 32): void {
  const screen = screenAtViewPort(rt, state, viewPort)
  if (screen && pen >= 0 && pen < screen.palette.length) {
    const r = bits === 4 ? red & 15 : red >>> 24
    const g = bits === 4 ? green & 15 : green >>> 24
    const b = bits === 4 ? blue & 15 : blue >>> 24
    screen.palette[pen] = ((r >>> (bits === 4 ? 0 : 4)) << 8) | ((g >>> (bits === 4 ? 0 : 4)) << 4) | (b >>> (bits === 4 ? 0 : 4))
    screen.paletteLo[pen] = bits === 4 ? screen.palette[pen]! : ((r & 15) << 8) | ((g & 15) << 4) | (b & 15)
    return
  }
  const map = state.colorMaps.get(structRead(rt, viewPort + 4, 4, false)) ?? null
  if (bits === 4) setRgb4ColorMap(map, pen, red, green, blue)
  else setRgb32ColorMap(map, pen, red, green, blue)
}

/** Copy the public native RastPort fields into the shared drawing backend. */
function syncNativeRastPort(rt: Runtime, raster: NativeRaster, rp: RastPort): void {
  rp.mask = structRead(rt, raster.rp + 24, 1, false)
  rp.fgPen = structRead(rt, raster.rp + 25, 1, false)
  rp.bgPen = structRead(rt, raster.rp + 26, 1, false)
  rp.aOlPen = structRead(rt, raster.rp + 27, 1, false)
  rp.drawMode = structRead(rt, raster.rp + 28, 1, false)
  rp.linePtrn = structRead(rt, raster.rp + 34, 2, false)
  rp.outline = (structRead(rt, raster.rp + 32, 2, false) & 8) !== 0
  rp.cpX = structRead(rt, raster.rp + 36, 2, true)
  rp.cpY = structRead(rt, raster.rp + 38, 2, true)
  rp.font = rt.osdevkit.fonts.get(structRead(rt, raster.rp + 52, 4, false) >>> 0)?.font ?? null
  const pattern = structRead(rt, raster.rp + 8, 4, false) >>> 0
  if (pattern === 0) rp.areaPtrn = null
  else {
    const size = Math.max(0, Math.min(4, structRead(rt, raster.rp + 29, 1, true)))
    rp.areaPtrn = Uint16Array.from({ length: 1 << (size + 1) }, (_, i) => structRead(rt, pattern + i * 2, 2, false))
  }
}

function writeNativeRastPort(rt: Runtime, raster: NativeRaster, rp: RastPort, ox = 0, oy = 0): void {
  structWrite(rt, raster.rp + 36, 2, rp.cpX - ox)
  structWrite(rt, raster.rp + 38, 2, rp.cpY - oy)
}

/** Borrow the selected managed Screen-ID's one shared drawing backend. */
function withScreenRastPort<T>(rt: Runtime, state: OsDevKitState, draw: (rp: RastPort) => T): T | undefined {
  const raster = currentScreenRaster(rt, state); const screen = currentScreen(rt, state)
  if (!raster || !screen) return undefined
  syncNativeRastPort(rt, raster, screen.rp)
  try { return draw(screen.rp) } finally { writeNativeRastPort(rt, raster, screen.rp) }
}

/** Borrow a screen RastPort for a Window-ID without leaking its private state. */
function withWindowRastPort<T>(rt: Runtime, state: OsDevKitState, draw: (rp: RastPort, ox: number, oy: number, window: Window) => T): T | undefined {
  const target = currentWindowTarget(rt, state)
  if (!target) return undefined
  const screen = rt.screens.get(target.window.screenSlot)
  if (!screen) return undefined
  const saved = screen.rp.snapshot()
  syncNativeRastPort(rt, target.raster, screen.rp)
  screen.rp.cpX += target.ox; screen.rp.cpY += target.oy
  screen.rp.clip = {
    x1: target.ox, y1: target.oy,
    x2: target.ox + target.window.width - 1, y2: target.oy + target.window.height - 1,
  }
  try { return draw(screen.rp, target.ox, target.oy, target.window) } finally {
    writeNativeRastPort(rt, target.raster, screen.rp, target.ox, target.oy)
    screen.rp.restore(saved)
  }
}

function withWindowBaseRastPort<T>(rt: Runtime, state: OsDevKitState, base: number, draw: (rp: RastPort, ox: number, oy: number, window: Window) => T): T | undefined {
  const id = state.windowIds.keyAtBase(base)
  const handle = id === null ? undefined : state.windowHandles.get(id)
  const raster = handle ? nativeRaster(rt, handle.rastPort) : null
  const screen = handle ? rt.screens.get(handle.window.screenSlot) : undefined
  if (!handle || !raster || !screen) return undefined
  const saved = screen.rp.snapshot(); const ox = handle.window.leftEdge; const oy = handle.window.topEdge
  syncNativeRastPort(rt, raster, screen.rp)
  screen.rp.cpX += ox; screen.rp.cpY += oy
  screen.rp.clip = { x1: ox, y1: oy, x2: ox + handle.window.width - 1, y2: oy + handle.window.height - 1 }
  try { return draw(screen.rp, ox, oy, handle.window) } finally {
    writeNativeRastPort(rt, raster, screen.rp, ox, oy); screen.rp.restore(saved)
  }
}

/**
 * Screen/Window-ID Paint and AreaEnd allocate one temporary one-bit raster,
 * use it synchronously, and free it before returning.
 */
function withTemporaryRaster(state: OsDevKitState, width: number, height: number, draw: () => void): boolean {
  // The shipped worker is `(width >> 3) + 1`, not word-aligned AllocRaster.
  const size = ((Math.max(0, width) >> 3) + 1) * Math.max(0, height)
  const raster = state.memory.alloc(size, { clear: true, chip: true })
  if (raster === 0) return false
  try { draw() } finally { state.memory.freeMem(raster) }
  return true
}

function screenRgb24(rt: Runtime, state: OsDevKitState, pen: number): number {
  const screen = currentScreen(rt, state)
  if (!screen || pen < 0 || pen >= screen.palette.length) return 0
  const hi = screen.palette[pen]!; const lo = screen.paletteLo[pen]!
  return (((((hi >> 8) & 15) << 4) | ((lo >> 8) & 15)) << 16) |
    (((((hi >> 4) & 15) << 4) | ((lo >> 4) & 15)) << 8) |
    (((hi & 15) << 4) | (lo & 15))
}

function setScreenRgb24(rt: Runtime, state: OsDevKitState, pen: number, colour: number): void {
  const screen = currentScreen(rt, state)
  if (!screen || pen < 0 || pen >= screen.palette.length) return
  const r = (colour >>> 16) & 0xff; const g = (colour >>> 8) & 0xff; const b = colour & 0xff
  screen.palette[pen] = ((r >>> 4) << 8) | ((g >>> 4) << 4) | (b >>> 4)
  screen.paletteLo[pen] = ((r & 15) << 8) | ((g & 15) << 4) | (b & 15)
  rt.copRegs.pal[pen] = screen.palette[pen]!
  rt.copRegs.palLo[pen] = screen.paletteLo[pen]!
}

function bindWindowRaster(rt: Runtime, state: OsDevKitState, window: Window): { rastPort: number; bitMap: number } | null {
  const screen = rt.screens.get(window.screenSlot)
  if (!screen) return null
  const bitMap = state.memory.alloc(40, { clear: true }); const rastPort = state.memory.alloc(72, { clear: true })
  if (bitMap === 0 || rastPort === 0) return null
  structWrite(rt, bitMap, 2, screen.rowBytes); structWrite(rt, bitMap + 2, 2, screen.height)
  structWrite(rt, bitMap + 5, 1, screen.depth)
  for (let plane = 0; plane < screen.depth; plane++) structWrite(rt, bitMap + 8 + plane * 4, 4, rt.screenChipBase(window.screenSlot) + plane * screen.planeSize)
  structWrite(rt, rastPort + 4, 4, bitMap); structWrite(rt, rastPort + 24, 1, 0xff)
  structWrite(rt, rastPort + 25, 1, screen.rp.fgPen); structWrite(rt, rastPort + 26, 1, screen.rp.bgPen)
  structWrite(rt, rastPort + 28, 1, screen.rp.drawMode); structWrite(rt, rastPort + 34, 2, screen.rp.linePtrn)
  structWrite(rt, rastPort + 52, 4, nativeFont(state, screen.font ?? rt.systemFont(), true))
  return { rastPort, bitMap }
}

function currentWindowTarget(rt: Runtime, state: OsDevKitState): {
  raster: NativeRaster; window: Window; ox: number; oy: number
} | null {
  const handle = state.windowHandles.get(state.windowIds.currentId)
  const raster = handle ? nativeRaster(rt, handle.rastPort) : null
  return handle && raster ? { raster, window: handle.window, ox: handle.window.leftEdge, oy: handle.window.topEdge } : null
}

function syncWindowBase(rt: Runtime, state: OsDevKitState, id: number): void {
  const record = state.windowIds.recordForKey(id); const handle = state.windowHandles.get(id)
  if (!record || !handle || record.base === 0) return
  const { window: w } = handle; const base = record.base
  structWrite(rt, base + 4, 2, w.leftEdge); structWrite(rt, base + 6, 2, w.topEdge)
  structWrite(rt, base + 8, 2, w.width); structWrite(rt, base + 10, 2, w.height)
  structWrite(rt, base + 16, 2, w.minWidth); structWrite(rt, base + 18, 2, w.minHeight)
  structWrite(rt, base + 20, 2, w.maxWidth); structWrite(rt, base + 22, 2, w.maxHeight)
  structWrite(rt, base + 24, 4, w.flags)
  structWrite(rt, base + 28, 4, w.menuStrip)
}

function syncAllWindowBases(rt: Runtime, state: OsDevKitState): void {
  for (const id of state.windowHandles.keys()) syncWindowBase(rt, state, id)
}

function selectedWindowHandle(state: OsDevKitState): { id: number; window: Window; rastPort: number; bitMap: number } | null {
  const id = state.windowIds.currentId; const handle = state.windowHandles.get(id)
  return handle ? { id, ...handle } : null
}

function windowAtBase(state: OsDevKitState, base: number): Window | null {
  const id = state.windowIds.keyAtBase(base)
  return id === null ? null : state.windowHandles.get(id)?.window ?? null
}

function windowBase(state: OsDevKitState, window: Window | null): number {
  if (!window) return 0
  for (const [id, handle] of state.windowHandles) if (handle.window === window) return state.windowIds.recordForKey(id)?.base ?? 0
  return 0
}

function windowViewPort(state: OsDevKitState, window: Window | null): number {
  if (!window) return 0
  for (const record of state.screenIds.values()) if (record.slot === window.screenSlot) return record.viewPort
  return 0
}

function menuItemAddress(state: OsDevKitState, item: MenuItem | null): number {
  if (!item) return 0
  const old = state.menuItemAddresses.get(item)
  if (old !== undefined) return old
  const address = state.nextMenuItemAddress
  state.nextMenuItemAddress += 0x100
  state.menuItemAddresses.set(item, address); state.menuItemRefs.set(address, item)
  return address
}

function nativeGadget(state: OsDevKitState, gadget: Gadget): UserGadget {
  let native = state.nativeGadgets.get(gadget.address)
  if (!native) {
    native = {
      leftEdge: gadget.leftEdge, topEdge: gadget.topEdge, width: gadget.width, height: gadget.height,
      id: gadget.address, kind: gadget.kind, flags: gadget.flags,
    }
    state.nativeGadgets.set(gadget.address, native)
  }
  native.leftEdge = gadget.leftEdge; native.topEdge = gadget.topEdge; native.width = gadget.width; native.height = gadget.height
  native.flags = gadget.flags | (gadget.disabled ? GFLG_GADGDISABLED : 0)
  if (gadget.kind === KIND.STRING || gadget.kind === KIND.INTEGER) {
    const buffer = gadget.kind === KIND.STRING ? gadget.string ?? '' : String(gadget.number ?? 0)
    const info = native.strInfo ?? { buffer, maxChars: 11, bufferPos: buffer.length, longInt: 0 }
    info.buffer = buffer; info.maxChars = (gadget.maxChars ?? 10) + 1
    info.bufferPos = Math.min(info.bufferPos, buffer.length); info.longInt = gadget.kind === KIND.INTEGER ? gadget.number ?? 0 : 0
    native.strInfo = info
  }
  if (gadget.image) native.image = gadget.image; else delete native.image
  if (gadget.selectImage) native.selectImage = gadget.selectImage; else delete native.selectImage
  return native
}

function nativeGadgetAt(rt: Runtime, state: OsDevKitState, address: number): UserGadget | null {
  const base = address >>> 0; if (base === 0) return null
  let gadget = state.nativeGadgets.get(base)
  if (!gadget) {
    gadget = { leftEdge: 0, topEdge: 0, width: 0, height: 0, id: base }
    state.nativeGadgets.set(base, gadget)
  }
  gadget.leftEdge = structRead(rt, base + 4, 2, true); gadget.topEdge = structRead(rt, base + 6, 2, true)
  gadget.width = structRead(rt, base + 8, 2, true); gadget.height = structRead(rt, base + 10, 2, true)
  gadget.flags = structRead(rt, base + 12, 2, false); gadget.activation = structRead(rt, base + 14, 2, false)
  gadget.kind = structRead(rt, base + 16, 2, false); gadget.id = base
  const info = structRead(rt, base + 34, 4, false) >>> 0
  if (info !== 0 && ((gadget.kind ?? 0) & 7) === 4) {
    const buffer = cString(rt, structRead(rt, info, 4, false) >>> 0)
    gadget.strInfo = {
      buffer, bufferPos: structRead(rt, info + 8, 2, false), maxChars: structRead(rt, info + 10, 2, false),
      longInt: structRead(rt, info + 18, 4, true),
    }
  }
  return gadget
}

function nativeGadgetList(rt: Runtime, state: OsDevKitState, first: number, count: number): UserGadget[] {
  const out: UserGadget[] = []; const seen = new Set<number>(); let address = first >>> 0
  const limit = count < 0 ? Number.POSITIVE_INFINITY : count
  while (address !== 0 && !seen.has(address) && out.length < limit) {
    seen.add(address); const gadget = nativeGadgetAt(rt, state, address); if (!gadget) break
    out.push(gadget); address = structRead(rt, address, 4, false) >>> 0
  }
  return out
}

function nativeBoopsiGadget(object: BoopsiObject): UserGadget {
  const attr = (id: number, fallback = 0): number => getAttr(id, object) ?? fallback
  return {
    leftEdge: attr(0x8003_0001), topEdge: attr(0x8003_0002), width: attr(0x8003_0003), height: attr(0x8003_0004),
    id: object.address, flags: attr(0x8003_000e) !== 0 ? GFLG_GADGDISABLED : 0,
  }
}

function detachGtBank(rt: Runtime, state: OsDevKitState, bank: { gadgets: Map<number, Gadget>; objects: Map<number, BoopsiObject>; attachedWindowId: number }): void {
  const window = state.windowHandles.get(bank.attachedWindowId)?.window
  if (window) {
    for (const gadget of bank.gadgets.values()) rt.intuition.detachWindowGadget(window, nativeGadget(state, gadget))
    for (const object of bank.objects.values()) {
      const native = window.gadgets.find(gadget => gadget.id === object.address)
      if (native) rt.intuition.detachWindowGadget(window, native)
    }
  }
  bank.attachedWindowId = -1
}

function addGtGadget(rt: Runtime, state: OsDevKitState, id: number, kind: GadgetKind, body: readonly number[], text: string, tags: readonly { tag: number; data: number }[] = []): Gadget | null {
  const bank = state.gtGadgetBanks.get(state.currentGtGadgetBank)
  if (!bank || id < 0 || id >= bank.max || bank.gadgets.has(id)) return null
  const previous = [...bank.gadgets.values()].at(-1) ?? bank.context
  const gadget = state.gadtools.createGadget(kind, previous, {
    leftEdge: body[0] ?? 0, topEdge: body[1] ?? 0, width: body[2] ?? 0, height: body[3] ?? 0,
    gadgetText: text, gadgetID: id, flags: body[4] ?? 0, visualInfo: bank.visualInfo, userData: state.currentGtGadgetBank,
  }, tags)
  if (!gadget) return null
  gadget.disabled = state.gtMode.disabled
  bank.gadgets.set(id, gadget)
  const native = nativeGadget(state, gadget)
  native.flags = (native.flags ?? 0) | (state.gtMode.disabled ? GFLG_GADGDISABLED : 0)
  native.activation = (state.gtMode.immediate ? GACT_GADGIMMEDIATE : 0) | (state.gtMode.relVerify ? GACT_RELVERIFY : 0)
  const window = state.windowHandles.get(bank.attachedWindowId)?.window
  if (window) rt.intuition.attachWindowGadget(window, native)
  return gadget
}

/** Build the native Image record emitted by workers 1005/1006 around a Bob. */
function makeGtImage(rt: Runtime, state: OsDevKitState, number: number): number {
  const image = rt.spriteBank?.image(number)
  if (!image) return 0
  image.flush()
  const address = state.memory.alloc(20 + image.planes.length, { clear: true, chip: true })
  if (address === 0) return 0
  const data = address + 20; const off = data - state.memory.base
  state.memory.buffer.set(image.planes, off)
  set32Word(state, address + 4, image.width); set32Word(state, address + 6, image.height); set32Word(state, address + 8, image.depth)
  set32(state, address + 10, data)
  state.memory.buffer[address + 14 - state.memory.base] = (1 << Math.min(image.depth, 8)) - 1
  return address
}

/** Build a native BitMap header plus its contiguous Bob planes. */
function makeGtBitmap(rt: Runtime, state: OsDevKitState, number: number): number {
  const image = rt.spriteBank?.image(number)
  if (!image) return 0
  image.flush()
  const address = state.memory.alloc(40 + image.planes.length, { clear: true, chip: true })
  if (address === 0) return 0
  const data = address + 40; state.memory.buffer.set(image.planes, data - state.memory.base)
  set32Word(state, address, image.rowBytes); set32Word(state, address + 2, image.height)
  state.memory.buffer[address + 5 - state.memory.base] = image.depth
  for (let plane = 0; plane < image.depth && plane < 8; plane++) set32(state, address + 8 + plane * 4, data + plane * image.planeSize)
  return address
}

function gtLabels(rt: Runtime, address: number): readonly string[] {
  const array = rt.dialogArrays.get(address)
  return array?.type === 2 ? array.data.map(value => value.k === 'str' ? value.s : '') : []
}

function freeGtStrings(state: OsDevKitState, pointers: readonly number[]): void {
  for (const pointer of pointers) state.strings.free(pointer)
}

function rebuildGtMenu(state: OsDevKitState, bank: { visualInfo: number; entries: NewMenu[]; strip: MenuStrip | null }): MenuStrip | null {
  if (bank.strip) state.gadtools.freeMenus(bank.strip)
  bank.strip = state.gadtools.createMenus([...bank.entries, { type: NM.END, label: '' }])
  if (bank.strip) state.gadtools.layoutMenus(bank.strip, bank.visualInfo)
  return bank.strip
}

/** Send an IECLASS_POINTERPOS/IESUBCLASS_PIXEL position in one screen's viewport. */
function setScreenMousePosition(rt: Runtime, slot: number, x: number, y: number): void {
  const screen = rt.screens.get(slot)
  if (!screen) return
  rt.input.mouseX = screen.displayX + (x - screen.offsetX) / (screen.hires ? 2 : 1)
  rt.input.mouseY = screen.displayY + (y - screen.offsetY) / (screen.laced ? 2 : 1)
}

/** GT_GetIMsg/GetMsg + the worker's 52-byte copy and immediate reply. */
function takeWindowEvent(state: OsDevKitState, mask = -1, expectedWindow = 0, port = state.windowPort): number {
  if (port === 0) return 0
  const memory = state.exec.messages.memory
  for (;;) {
    const message = state.exec.messages.getMsg(port)
    if (message === 0) return 0
    const cls = memory.readU32(message + 20) >>> 0
    const windowBase = memory.readU32(message + 44) >>> 0
    if ((expectedWindow !== 0 && windowBase !== (expectedWindow >>> 0)) || (cls & (mask >>> 0)) === 0) { memory.free(message); continue }
    const word = (at: number): number => (memory.readU8(at) << 8) | memory.readU8(at + 1)
    const signedWord = (at: number): number => (word(at) << 16) >> 16
    const item = memory.readU32(message + 28) >>> 0
    const gadget = state.gadtools.gadget(item)
    state.windowEvent = {
      class: cls,
      code: word(message + 24),
      qualifier: word(message + 26),
      gadgetId: gadget?.id ?? null,
      gadgetUserData: gadget?.userData ?? null,
      windowId: state.windowIds.keyAtBase(windowBase) ?? -1,
      mouseX: signedWord(message + 32),
      mouseY: signedWord(message + 34),
    }
    memory.free(message)
    return cls | 0
  }
}

function clearWindowPort(state: OsDevKitState, base: number): void {
  const window = windowAtBase(state, base); const port = window?.userPort ?? 0
  if (!window || port === 0) return
  const messages = state.exec.messages; const count = messages.pending(port)
  for (let i = 0; i < count; i++) {
    const message = messages.getMsg(port)
    if (message === 0) break
    if (messages.memory.readU32(message + 44) === (base >>> 0)) messages.memory.free(message)
    else messages.putMsg(port, message)
  }
}

function attachWindowId(
  rt: Runtime,
  state: OsDevKitState,
  id: number | null,
  window: Window,
  title: string,
  options: { sharePort?: boolean; titleAddress?: number } = {},
): number {
  const sharePort = options.sharePort ?? true
  const graphics = bindWindowRaster(rt, state, window)
  if (!graphics) { rt.intuition.closeWindow(window); return 0 }
  const base = state.memory.alloc(136, { clear: true })
  const requester = sharePort ? state.memory.alloc(112, { clear: true }) : 0
  if (base === 0 || (sharePort && requester === 0)) {
    if (base !== 0) state.memory.freeMem(base)
    if (requester !== 0) state.memory.freeMem(requester)
    state.memory.freeMem(graphics.rastPort); state.memory.freeMem(graphics.bitMap); rt.intuition.closeWindow(window)
    return 0
  }
  const ownsTitle = options.titleAddress === undefined
  const titleAddress = options.titleAddress ?? state.strings.fromAmos(title)
  if (sharePort && state.windowPort === 0) state.windowPort = state.exec.messages.createPort()
  if (sharePort && state.windowPort === 0) {
    if (ownsTitle) state.strings.free(titleAddress)
    state.memory.freeMem(base); state.memory.freeMem(requester)
    state.memory.freeMem(graphics.rastPort); state.memory.freeMem(graphics.bitMap); rt.intuition.closeWindow(window)
    return 0
  }
  if (sharePort) window.shareUserPort(state.windowPort, base)
  structWrite(rt, base + 32, 4, titleAddress)
  structWrite(rt, base + 46, 4, rt.intuition.windowScreenAddress(window))
  structWrite(rt, base + 50, 4, graphics.rastPort)
  structWrite(rt, base + 82, 4, window.idcmpFlags); structWrite(rt, base + 86, 4, window.userPort)
  const attached = id === null ? state.windowIds.attachAnonymous(base) : null
  const key = attached?.id ?? id!
  const record = attached?.record ?? state.windowIds.attach(key, base, graphics.rastPort)
  if (!record) return 0
  record.title = ownsTitle ? titleAddress : 0; record.owned0 = requester
  state.windowHandles.set(key, { window, ...graphics })
  syncAllWindowBases(rt, state)
  return base
}

function closeWindowId(rt: Runtime, state: OsDevKitState, id: number): boolean {
  const handle = state.windowHandles.get(id); const record = state.windowIds.close(id)
  if (!handle || !record) return false
  for (const [requester, window] of state.requesterWindows) if (window === handle.window) state.requesterWindows.delete(requester)
  rt.intuition.closeWindow(handle.window)
  if (record.title !== 0) state.strings.free(record.title)
  if (record.screenTitle !== 0) state.strings.free(record.screenTitle)
  for (const owned of [record.owned0, record.owned1, record.owned2]) if (owned !== 0) state.memory.freeMem(owned)
  state.memory.freeMem(handle.rastPort); state.memory.freeMem(handle.bitMap); state.memory.freeMem(record.base)
  state.windowHandles.delete(id)
  syncAllWindowBases(rt, state)
  return true
}

interface RawWindowSpec {
  left: number; top: number; width: number; height: number
  detailPen: number; blockPen: number; idcmp: number; flags: number
  titleAddress: number; screenAddress: number; type: number
  minWidth: number; minHeight: number; maxWidth: number; maxHeight: number
}

function rawWindowSpec(rt: Runtime, address: number): RawWindowSpec {
  return {
    left: structRead(rt, address, 2, true), top: structRead(rt, address + 2, 2, true),
    width: structRead(rt, address + 4, 2, false), height: structRead(rt, address + 6, 2, false),
    detailPen: structRead(rt, address + 8, 1, false), blockPen: structRead(rt, address + 9, 1, false),
    idcmp: structRead(rt, address + 10, 4, false), flags: structRead(rt, address + 14, 4, false),
    titleAddress: structRead(rt, address + 26, 4, false), screenAddress: structRead(rt, address + 30, 4, false),
    minWidth: structRead(rt, address + 38, 2, false), minHeight: structRead(rt, address + 40, 2, false),
    maxWidth: structRead(rt, address + 42, 2, false), maxHeight: structRead(rt, address + 44, 2, false),
    type: structRead(rt, address + 46, 2, false),
  }
}

function openRawWindow(rt: Runtime, state: OsDevKitState, spec: RawWindowSpec): number {
  const custom = spec.type !== WBENCHSCREEN
  const slot = custom ? managedScreenSlot(rt, spec.screenAddress) : WB_SLOT
  if (slot === null) return 0
  const title = cString(rt, spec.titleAddress)
  const window = rt.intuition.openWindow({
    leftEdge: spec.left, topEdge: spec.top, width: spec.width, height: spec.height,
    detailPen: spec.detailPen, blockPen: spec.blockPen, idcmpFlags: spec.idcmp, flags: spec.flags,
    title, type: custom ? CUSTOMSCREEN : WBENCHSCREEN, ...(custom ? { screenSlot: slot } : {}),
    minWidth: spec.minWidth || 1, minHeight: spec.minHeight || 1,
    maxWidth: spec.maxWidth || 0xffff, maxHeight: spec.maxHeight || 0xffff,
  })
  return window ? attachWindowId(rt, state, null, window, title, { sharePort: false, titleAddress: spec.titleAddress }) : 0
}

function structSet(rt: Runtime, width: StructWidth): Instr {
  return (it) => {
    it.expect('(')
    const base = it.evalInt(); it.expect(',')
    const displacement = it.evalInt(); it.expect(')'); it.expectOp('=')
    structWrite(rt, base + displacement, width, it.evalInt())
  }
}

function cpuSet(rt: Runtime, width: 2 | 4): Instr {
  return (it) => {
    it.expect('(')
    const address = it.evalInt(); it.expect(')'); it.expectOp('=')
    structWrite(rt, address, width, it.evalInt())
  }
}

function readArgs(it: Parameters<Instr>[0], count: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    if (i !== 0) it.expect(',')
    out.push(it.evalInt())
  }
  return out
}

export function makeOsDevKitInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): OsDevKitState => rt.osdevkit
  const heap = (): OsCStringHeap => rt.osdevkit.strings
  const labelsAt = (address: number): readonly string[] => gtLabels(rt, address)
  const menuLabel = (it: Parameters<Instr>[0]): string | typeof BARLABEL => {
    const kind = it.tok()?.kind
    return kind === 'int' || kind === 'bin' || kind === 'hex' ? (it.evalInt() === -1 ? BARLABEL : '') : it.evalStr()
  }
  const addGtMenuEntry = (entry: NewMenu): void => {
    const bank = st().gtMenuBanks.get(st().currentGtMenuBank)
    if (!bank || (entry.type === NM.TITLE && bank.entries.filter(item => item.type === NM.TITLE).length >= bank.max)) return
    bank.entries.push(entry); rebuildGtMenu(st(), bank)
  }
  const addGtImageMenu = (it: Parameters<Instr>[0], type: number, bob: boolean): void => {
    let imageAddress = it.evalInt(); it.expect(','); const key = it.evalStr(); it.expect(','); const flags = it.evalInt(); it.expect(','); const mutex = it.evalInt()
    if (imageAddress === -1) { addGtMenuEntry({ type, label: BARLABEL, commKey: key, flags, mutualExclude: mutex }); return }
    if (bob) imageAddress = makeGtImage(rt, st(), imageAddress)
    const image = ieReadImage(rt, imageAddress)
    if (image) addGtMenuEntry({ type, label: '', commKey: key, flags, mutualExclude: mutex, imageAddress, image })
  }
  const changeGtMenu = (it: Parameters<Instr>[0], action: 'on' | 'off' | 'check' | 'clear'): void => {
    const [menu, item, sub] = readArgs(it, 3); const strip = st().gtMenuBanks.get(st().currentGtMenuBank)?.strip
    if (!strip) return
    const number = fullMenuNum(menu!, item!, sub!)
    if (action === 'on') st().gadtools.onMenu(strip, number)
    else if (action === 'off') st().gadtools.offMenu(strip, number)
    else {
      const target = st().gadtools.itemAddress(strip, number)
      if (target && (target.flags & 1) !== 0) target.checked = action === 'check'
    }
  }
  const addScroller = (it: Parameters<Instr>[0], horizontal: boolean): void => {
    const [id, x, y, width, height, flags] = readArgs(it, 6); it.expect(','); const text = it.evalStr(); it.expect(','); const arrows = it.evalInt()
    const gadget = addGtGadget(rt, st(), id!, KIND.SCROLLER, [x!, y!, width!, height!, flags!], text, [{ tag: TAG.GTSC_Arrows, data: arrows }])
    if (gadget) gadget.horizontal = horizontal
  }
  const addSlider = (it: Parameters<Instr>[0], horizontal: boolean): void => {
    const [id, x, y, width, height, flags] = readArgs(it, 6); it.expect(','); const text = it.evalStr()
    it.expect(','); const levelSettings = it.evalInt(); it.expect(','); const format = it.evalStr()
    const gadget = addGtGadget(rt, st(), id!, KIND.SLIDER, [x!, y!, width!, height!, flags!], text, [
      { tag: TAG.GTSL_MaxLevelLen, data: levelSettings >>> 16 }, { tag: TAG.GTSL_LevelPlace, data: levelSettings & 0xffff },
      { tag: TAG.GTSL_LevelFormat, data: st().gadtools.stringRef(format) },
    ])
    if (gadget) gadget.horizontal = horizontal
  }
  return {
    'track set'(it) {
      const [type, pointer] = readArgs(it, 2); st().tracker.set(type!, pointer!)
    },
    'track unset'(it) {
      const [type, pointer] = readArgs(it, 2); st().tracker.unset(type!, pointer!)
    },
    'track add'(it) {
      const [type, pointer] = readArgs(it, 2); st().tracker.add(type!, pointer!)
    },
    '_it set draw'(it) {
      const [base, front, back, mode] = readArgs(it, 4)
      structWrite(rt, base!, 1, front!); structWrite(rt, base! + 1, 1, back!); structWrite(rt, base! + 2, 1, mode!)
    },
    '_it set corner'(it) {
      const [base, left, top] = readArgs(it, 3); structWrite(rt, base! + 4, 2, left!); structWrite(rt, base! + 6, 2, top!)
    },
    '_it set font'(it) { const [base, font] = readArgs(it, 2); structWrite(rt, base! + 8, 4, font!) },
    '_it set str'(it) { const [base, value] = readArgs(it, 2); structWrite(rt, base! + 12, 4, value!) },
    '_it set next'(it) { const [base, next] = readArgs(it, 2); structWrite(rt, base! + 16, 4, next!) },
    '_it set'(it) {
      const [base, front, back, mode, left, top, font, value, next] = readArgs(it, 9)
      structWrite(rt, base!, 1, front!); structWrite(rt, base! + 1, 1, back!); structWrite(rt, base! + 2, 1, mode!)
      structWrite(rt, base! + 4, 2, left!); structWrite(rt, base! + 6, 2, top!)
      structWrite(rt, base! + 8, 4, font!); structWrite(rt, base! + 12, 4, value!); structWrite(rt, base! + 16, 4, next!)
    },
    '_gad set next'(it) { const [base, value] = readArgs(it, 2); structWrite(rt, base!, 4, value!) },
    '_gad set body'(it) {
      const [base, left, top, width, height] = readArgs(it, 5)
      structWrite(rt, base! + 4, 2, left!); structWrite(rt, base! + 6, 2, top!)
      structWrite(rt, base! + 8, 2, width!); structWrite(rt, base! + 10, 2, height!)
    },
    '_gad set fat'(it) {
      const [base, flags, activation, type] = readArgs(it, 4)
      structWrite(rt, base! + 12, 2, flags!); structWrite(rt, base! + 14, 2, activation!); structWrite(rt, base! + 16, 2, type!)
    },
    '_gad set render'(it) {
      const [base, normal, selected] = readArgs(it, 3); structWrite(rt, base! + 18, 4, normal!); structWrite(rt, base! + 22, 4, selected!)
    },
    '_gad set text'(it) { const [base, value] = readArgs(it, 2); structWrite(rt, base! + 26, 4, value!) },
    '_gad set spec info'(it) { const [base, value] = readArgs(it, 2); structWrite(rt, base! + 34, 4, value!) },
    '_gad set user'(it) {
      const [base, id, value] = readArgs(it, 3); structWrite(rt, base! + 38, 2, id!); structWrite(rt, base! + 40, 4, value!)
    },
    '_gad off'(it) {
      const [base, windowBase, _requester] = readArgs(it, 3); const gadget = nativeGadgetAt(rt, st(), base!); const window = windowAtBase(st(), windowBase!)
      if (gadget && window) { gadget.flags = (gadget.flags ?? 0) | GFLG_GADGDISABLED; structWrite(rt, base! + 12, 2, gadget.flags); rt.intuition.refreshWindowGadget(window, gadget) }
    },
    '_gad on'(it) {
      const [base, windowBase, _requester] = readArgs(it, 3); const gadget = nativeGadgetAt(rt, st(), base!); const window = windowAtBase(st(), windowBase!)
      if (gadget && window) { gadget.flags = (gadget.flags ?? 0) & ~GFLG_GADGDISABLED; structWrite(rt, base! + 12, 2, gadget.flags); rt.intuition.refreshWindowGadget(window, gadget) }
    },
    '_gad refresh'(it) {
      const [base, windowBase, _requester, count] = readArgs(it, 4); const window = windowAtBase(st(), windowBase!)
      if (window) for (const gadget of nativeGadgetList(rt, st(), base!, count!)) rt.intuition.refreshWindowGadget(window, gadget)
    },
    '_gad modif prop'(it) {
      const [base, windowBase, _requester, flags, horizPot, vertPot, horizBody, vertBody, count] = readArgs(it, 9)
      const info = structRead(rt, base! + 34, 4, false) >>> 0; const window = windowAtBase(st(), windowBase!)
      if (info !== 0) [flags!, horizPot!, vertPot!, horizBody!, vertBody!].forEach((value, i) => structWrite(rt, info + i * 2, 2, value))
      if (window) for (const gadget of nativeGadgetList(rt, st(), base!, count!)) rt.intuition.refreshWindowGadget(window, gadget)
    },
    '_scr def body'(it) {
      const values = readArgs(it, 5); const base = screenDefinitionAddress(st())
      values.forEach((value, i) => structWrite(rt, base + i * 2, 2, value))
    },
    '_scr def pens'(it) {
      const [detail, block] = readArgs(it, 2); const base = screenDefinitionAddress(st())
      structWrite(rt, base + 10, 1, detail!); structWrite(rt, base + 11, 1, block!)
    },
    '_scr def title'(it) { structWrite(rt, screenDefinitionAddress(st()) + 20, 4, it.evalInt()) },
    '_scr def font'(it) { structWrite(rt, screenDefinitionAddress(st()) + 16, 4, it.evalInt()) },
    '_scr def bmap'(it) { structWrite(rt, screenDefinitionAddress(st()) + 28, 4, it.evalInt()) },
    '_scr def vmodes'(it) { structWrite(rt, screenDefinitionAddress(st()) + 12, 2, it.evalInt()) },
    '_scr def type'(it) { structWrite(rt, screenDefinitionAddress(st()) + 14, 2, it.evalInt()) },
    '_scr set title'(it) { const [base, title] = readArgs(it, 2); structWrite(rt, base! + 22, 4, title!) },
    '_scr set def title'(it) { const [base, title] = readArgs(it, 2); structWrite(rt, base! + 26, 4, title!) },
    '_wnd def body'(it) {
      const values = readArgs(it, 4); const base = windowDefinitionAddress(st())
      values.forEach((value, i) => structWrite(rt, base + i * 2, 2, value))
    },
    '_wnd def limits'(it) {
      const values = readArgs(it, 4); const base = windowDefinitionAddress(st())
      values.forEach((value, i) => structWrite(rt, base + 38 + i * 2, 2, value))
    },
    '_wnd def pens'(it) {
      const [detail, block] = readArgs(it, 2); const base = windowDefinitionAddress(st())
      structWrite(rt, base + 8, 1, detail!); structWrite(rt, base + 9, 1, block!)
    },
    '_wnd def idcmp'(it) { structWrite(rt, windowDefinitionAddress(st()) + 10, 4, it.evalInt()) },
    '_wnd def flags'(it) { structWrite(rt, windowDefinitionAddress(st()) + 14, 4, it.evalInt()) },
    '_wnd def gad'(it) { structWrite(rt, windowDefinitionAddress(st()) + 18, 4, it.evalInt()) },
    '_wnd def image'(it) { structWrite(rt, windowDefinitionAddress(st()) + 22, 4, it.evalInt()) },
    '_wnd def title'(it) { structWrite(rt, windowDefinitionAddress(st()) + 26, 4, it.evalInt()) },
    '_wnd def scr'(it) { structWrite(rt, windowDefinitionAddress(st()) + 30, 4, it.evalInt()) },
    '_wnd def type'(it) { structWrite(rt, windowDefinitionAddress(st()) + 46, 2, it.evalInt()) },
    '_wnd def bmap'(it) { structWrite(rt, windowDefinitionAddress(st()) + 34, 4, it.evalInt()) },
    '_mouse report'(it) {
      const base = it.evalInt() >>> 0; const window = windowAtBase(st(), base)
      if (window) { window.reportMouse(true); syncAllWindowBases(rt, st()) }
      else structWrite(rt, base + 24, 4, structRead(rt, base + 24, 4, false) | WFLG_REPORTMOUSE)
    },
    '_mouse unreport'(it) {
      const base = it.evalInt() >>> 0; const window = windowAtBase(st(), base)
      if (window) { window.reportMouse(false); syncAllWindowBases(rt, st()) }
      else structWrite(rt, base + 24, 4, structRead(rt, base + 24, 4, false) & ~WFLG_REPORTMOUSE)
    },
    '_wnd set titles'(it) {
      const [base, title, screenTitle] = readArgs(it, 3); const window = windowAtBase(st(), base!)
      if (window) { rt.intuition.setWindowTitles(window, cString(rt, title! >>> 0), cString(rt, screenTitle! >>> 0)); structWrite(rt, base! + 32, 4, title!); structWrite(rt, base! + 104, 4, screenTitle!) }
    },
    '_wnd set limits'(it) {
      const [base, minWidth, minHeight, maxWidth, maxHeight] = readArgs(it, 5); const window = windowAtBase(st(), base!)
      if (window) { rt.intuition.windowLimits(window, minWidth!, minHeight!, maxWidth!, maxHeight!); syncAllWindowBases(rt, st()) }
    },
    '_wnd set idcmp'(it) {
      const [base, flags] = readArgs(it, 2); const window = windowAtBase(st(), base!)
      if (window) { window.modifyIDCMP(flags!); structWrite(rt, base! + 82, 4, flags!) }
    },
    '_wnd close'(it) {
      const base = it.evalInt() >>> 0
      const id = st().windowIds.keyAtBase(base)
      if (id !== null) closeWindowId(rt, st(), id)
    },
    '_wnd clear port'(it) { clearWindowPort(st(), it.evalInt()) },
    '_wnd unshare port'(it) {
      const base = it.evalInt() >>> 0; const window = windowAtBase(st(), base)
      if (!window) return
      clearWindowPort(st(), base); window.modifyIDCMP(0); window.unshareUserPort()
      structWrite(rt, base + 82, 4, 0); structWrite(rt, base + 86, 4, 0)
    },
    '_wnd share port'(it) {
      const [base, port] = readArgs(it, 2); const window = windowAtBase(st(), base!)
      if (!window || port === 0) return
      clearWindowPort(st(), base!); window.shareUserPort(port! >>> 0, base! >>> 0)
      structWrite(rt, base! + 86, 4, port!)
    },
    '_wnd activate'(it) { const window = windowAtBase(st(), it.evalInt()); if (window) { rt.intuition.activateWindow(window); syncAllWindowBases(rt, st()) } },
    '_wnd move'(it) { const [base, x, y] = readArgs(it, 3); const window = windowAtBase(st(), base!); if (window) { rt.intuition.moveWindow(window, x!, y!); syncAllWindowBases(rt, st()) } },
    '_wnd box'(it) { const [base, x, y, width, height] = readArgs(it, 5); const window = windowAtBase(st(), base!); if (window) { rt.intuition.changeWindowBox(window, x!, y!, width!, height!); syncAllWindowBases(rt, st()) } },
    '_wnd size'(it) { const [base, width, height] = readArgs(it, 3); const window = windowAtBase(st(), base!); if (window) { rt.intuition.sizeWindow(window, width!, height!); syncAllWindowBases(rt, st()) } },
    '_wnd refresh frame'(it) { const window = windowAtBase(st(), it.evalInt()); if (window) rt.intuition.refreshWindowFrame(window) },
    '_wnd to back'(it) { const window = windowAtBase(st(), it.evalInt()); if (window) rt.intuition.windowToBack(window) },
    '_wnd to front'(it) { const window = windowAtBase(st(), it.evalInt()); if (window) rt.intuition.windowToFront(window) },
    '_wnd in front of'(it) {
      const [base, behind] = readArgs(it, 2); const window = windowAtBase(st(), base!), target = windowAtBase(st(), behind!)
      if (window && target && window.screenSlot === target.screenSlot) { rt.intuition.windowToFront(target); rt.intuition.windowToFront(window) }
    },
    '_wnd scroll raster'(it) {
      const [base, dx, dy, x1, y1] = readArgs(it, 5); it.expect('to'); const [x2, y2] = readArgs(it, 2)
      withWindowBaseRastPort(rt, st(), base!, (rp, ox, oy) => scrollRaster(rp, dx!, dy!, ox + x1!, oy + y1!, ox + x2!, oy + y2!))
    },
    '_ptr clear'(it) {
      const base = it.evalInt() >>> 0; const window = windowAtBase(st(), base)
      if (window) window.clearPointer()
      structWrite(rt, base + 74, 4, 0); structWrite(rt, base + 78, 4, 0)
    },
    '_ptr set'(it) {
      const [base, data, height, width, xOffset, yOffset] = readArgs(it, 6); const window = windowAtBase(st(), base!)
      if (window) window.setPointer(data!, height!, width!, xOffset!, yOffset!)
      structWrite(rt, base! + 74, 4, data!); structWrite(rt, base! + 78, 1, height!); structWrite(rt, base! + 79, 1, width!)
      structWrite(rt, base! + 80, 1, xOffset!); structWrite(rt, base! + 81, 1, yOffset!)
    },
    '_wnd id data'(it) {
      it.expect('('); const id = it.evalInt(); it.expect(')'); it.expectOp('=')
      st().windowIds.setData(id, it.evalInt())
    },
    '_it print'(it) {
      const [text, rp, x, y] = readArgs(it, 4); const value = cString(rt, structRead(rt, text! + 12, 4, false))
      structWrite(rt, rp! + 25, 1, structRead(rt, text!, 1, false))
      structWrite(rt, rp! + 26, 1, structRead(rt, text! + 1, 1, false))
      structWrite(rt, rp! + 28, 1, structRead(rt, text! + 2, 1, false))
      structWrite(rt, rp! + 36, 2, x! + structRead(rt, text! + 4, 2, true))
      structWrite(rt, rp! + 38, 2, y! + structRead(rt, text! + 6, 2, true))
      const attr = textAttr(rt, st(), structRead(rt, text! + 8, 4, false))
      const font = attr ? [...st().fonts].find(([, held]) => held.font.name.toLowerCase() === attr.name.toLowerCase() && held.font.ySize === attr.ySize)?.[0] : undefined
      if (font !== undefined) structWrite(rt, rp! + 52, 4, font)
      drawNativeText(rt, st(), rp!, value)
    },
    '_amos name'(it) { st().amosName = `~${it.evalStr()}`.slice(0, 31) },
    '_dreg'(it) {
      it.expect('('); const register = it.evalInt(); it.expect(')'); it.expectOp('='); const value = it.evalInt()
      if (register >= 0 && register < 8) st().dataRegisters[register] = value
    },
    '_areg'(it) {
      it.expect('('); const register = it.evalInt(); it.expect(')'); it.expectOp('='); const value = it.evalInt()
      if (register >= 0 && register < 8) st().addressRegisters[register] = value
    },
    '_loc close'(it) {
      const handle = it.evalInt() >>> 0; const locale = st().locales.get(handle)
      if (!locale) return
      for (const address of locale.values()) heap().free(address)
      st().locales.delete(handle); st().memory.freeMem(handle)
    },
    '_cat close'(it) {
      const handle = it.evalInt() >>> 0; const catalog = st().catalogs.get(handle)
      if (!catalog) return
      for (const address of catalog.strings.values()) heap().free(address)
      st().catalogs.delete(handle); st().memory.freeMem(handle)
    },
    '_pool delete'(it) {
      const handle = it.evalInt() >>> 0; const pool = st().pools.get(handle)
      if (!pool) return
      for (const address of pool.allocations) st().memory.freeMem(address)
      st().pools.delete(handle); st().memory.freeMem(handle)
    },
    '_pool free'(it) {
      const [handle, address, _size] = readArgs(it, 3); const pool = st().pools.get(handle! >>> 0)
      if (!pool?.allocations.delete(address! >>> 0)) return
      st().memory.freeMem(address! >>> 0)
    },
    '_bm free'(it) {
      const address = it.evalInt() >>> 0; const bitmap = st().bitMaps.get(address)
      if (!bitmap) return
      for (const plane of bitmap.ownedPlanes) st().memory.freeMem(plane)
      st().bitMaps.delete(address); st().memory.freeMem(address)
    },
    '_bm set plane'(it) {
      const [bitmap, plane, address] = readArgs(it, 3)
      if (plane! >= 0 && plane! < 8) structWrite(rt, bitmap! + 8 + plane! * 4, 4, address!)
    },
    '_spr change'(it) {
      const [viewPort, sprite, data] = readArgs(it, 3); const number = structRead(rt, sprite! + 10, 2, false)
      if (number < 8 && st().hardwareSprites[number]?.sprite === (sprite! >>> 0)) {
        st().hardwareSprites[number] = { sprite: sprite! >>> 0, data: data! >>> 0, viewPort: viewPort! >>> 0 }
        structWrite(rt, sprite!, 4, data!)
      }
    },
    '_spr free'(it) {
      const number = it.evalInt(); if (number >= 0 && number < 8) st().hardwareSprites[number] = null
    },
    '_spr move'(it) {
      const [viewPort, sprite, x, y] = readArgs(it, 4); const number = structRead(rt, sprite! + 10, 2, false)
      if (number < 8 && st().hardwareSprites[number]?.sprite === (sprite! >>> 0)) {
        st().hardwareSprites[number]!.viewPort = viewPort! >>> 0
        structWrite(rt, sprite! + 6, 2, x!); structWrite(rt, sprite! + 8, 2, y!)
      }
    },
    '_wb to back'() { rt.intuition.wBenchToBack() },
    '_wb to front'() { rt.intuition.wBenchToFront() },
    '_icon free'(it) {
      const icon = it.evalInt() >>> 0
      for (const address of st().toolTypePointers.get(icon)?.values() ?? []) heap().free(address)
      st().toolTypePointers.delete(icon); rt.icons.free(icon)
    },
    '_dt delete'(it) { st().dataTypes.dispose(it.evalInt() >>> 0) },
    '_dt release'(it) { st().dataTypes.release(it.evalInt() >>> 0) },
    '_dt set attrs'(it) {
      const [object, window, requester, tags] = readArgs(it, 4); const o = st().dataTypes.objects.get(object! >>> 0); if (!o) return
      o.window = window! >>> 0; o.requester = requester! >>> 0
      for (const tag of tagItems(st(), tags! >>> 0)) o.attributes.set(tag.tag, tag.data)
    },
    '_dt refresh'(it) {
      const [object, window, requester, tags] = readArgs(it, 4); const o = st().dataTypes.objects.get(object! >>> 0); if (!o) return
      o.window = window! >>> 0; o.requester = requester! >>> 0
      for (const tag of tagItems(st(), tags! >>> 0)) o.attributes.set(tag.tag, tag.data)
    },
    '_dos var value$'(it) {
      it.expect('('); const name = it.evalStr(); it.expect(','); const flags = it.evalInt(); it.expect(')'); it.expectOp('=')
      st().dosVariables.set(name, it.evalStr(), flags)
    },
    '_dos close'(it) { rt.dos.close(rt.vfs, it.evalInt()) },
    '_dos unlock'(it) { rt.dos.unlock(it.evalInt()) },
    '_dos set dir$'(it) { rt.vfs?.setCurrentDir(it.evalStr()) },
    '_dos end notify'(it) {
      const address = it.evalInt() >>> 0, notify = st().dosNotifications.get(address)
      if (!notify) return
      notify.stop(); st().strings.free(notify.name)
      for (const message of notify.messages) st().exec.memory.free(message)
      st().memory.freeMem(address); st().dosNotifications.delete(address)
    },
    '_cx uninstall'() { st().commodities.uninstall() },
    '_cx id create'(it) { const [id, type, arg1, arg2] = readArgs(it, 4); st().commodities.create(id!, type!, arg1!, arg2!) },
    '_cx id delete'(it) { st().commodities.delete(st().commodities.ids.get(it.evalInt()) ?? 0) },
    '_cx id clear error'(it) { const o = st().commodities.objects.get(st().commodities.ids.get(it.evalInt()) ?? 0); if (o) o.error = 0 },
    '_cx id activate'(it) { const o = st().commodities.objects.get(st().commodities.ids.get(it.evalInt()) ?? 0); if (o) o.active = true },
    '_cx id inactivate'(it) { const o = st().commodities.objects.get(st().commodities.ids.get(it.evalInt()) ?? 0); if (o) o.active = false },
    '_cx id attach'(it) { const child = it.evalInt(); it.expect('to'); const parent = it.evalInt(); st().commodities.attach(st().commodities.ids.get(child) ?? 0, st().commodities.ids.get(parent) ?? 0) },
    '_cx id remove'(it) { st().commodities.remove(st().commodities.ids.get(it.evalInt()) ?? 0) },
    '_cx enable'() { st().commodities.enabled = true; const o = st().commodities.objects.get(st().commodities.broker); if (o) o.active = true },
    '_cx disable'() { st().commodities.enabled = false; const o = st().commodities.objects.get(st().commodities.broker); if (o) o.active = false },
    '_iff close'(it) {
      const result = st().iff.close(it.evalInt() >>> 0)
      if (result) rt.vfs?.writeFile(result.path, result.bytes)
    },
    '_lib close'(it) {
      const base = it.evalInt() >>> 0
      if (st().openLibraries.delete(base)) closeLibrary(base)
    },
    '_sys own'() { rt.lowlevel.systemControl(SCON_TAKE_OVER_SYS, -1); rt.copperOn = false },
    '_sys disown'() { rt.lowlevel.systemControl(SCON_TAKE_OVER_SYS, 0); rt.copperOn = true },
    '_ggad def body'(it) {
      const [left, top, width, height] = readArgs(it, 4); Object.assign(st().gadgetDef, { leftEdge: left!, topEdge: top!, width: width!, height: height! })
    },
    '_ggad def text'(it) { const p = it.evalInt(); st().gadgetDef.textPointer = p; st().gadgetDef.gadgetText = st().strings.get(p) },
    '_ggad def id'(it) { st().gadgetDef.gadgetID = it.evalInt() & 0xffff },
    '_ggad def flags'(it) { st().gadgetDef.flags = it.evalInt() | 0 },
    '_ggad def user'(it) { st().gadgetDef.userData = it.evalInt() | 0 },
    '_ggad def vinf'(it) { st().gadgetDef.visualInfo = it.evalInt() | 0 },
    '_ggad def font'(it) { st().gadgetDef.font = it.evalInt() | 0 },
    '_ggad define'(it) {
      const [left, top, width, height, text, flags, id, user] = readArgs(it, 8)
      Object.assign(st().gadgetDef, {
        leftEdge: left!, topEdge: top!, width: width!, height: height!, textPointer: text!,
        gadgetText: st().strings.get(text!), flags: flags!, gadgetID: id! & 0xffff, userData: user!,
      })
    },
    '_ggad set attrs'(it) {
      const [gadget, _window, _requester, tags] = readArgs(it, 4); const g = st().gadtools.gadget(gadget!)
      if (g) st().gadtools.setGadgetAttrs(g, tagItems(st(), tags!))
    },
    '_ggad free'(it) { const g = st().gadtools.gadget(it.evalInt()); if (g) st().gadtools.freeGadgets(g) },
    '_ggad vinf free'(it) { st().gadtools.freeVisualInfo(it.evalInt()) },
    '_li free'(it) {
      const address = it.evalInt() >>> 0; const info = st().layerInfos.get(address)
      if (info) for (const [layerAddress, owned] of st().layers) if (owned.owner === address) { st().memory.freeMem(layerAddress); st().layers.delete(layerAddress) }
      st().layerInfos.delete(address); st().memory.freeMem(address)
    },
    '_layer delete'(it) {
      const address = it.evalInt() >>> 0; const owned = st().layers.get(address); if (!owned) return
      st().layerInfos.get(owned.owner)?.deleteLayer(owned.layer); st().layers.delete(address); st().memory.freeMem(address)
    },
    /** routine 1471: subtract the seven-byte private header, then FreeVec. */
    '_str free'(it) {
      heap().free(it.evalInt())
    },
    /** routine 1472: position word at -3, value byte at -1. */
    '_str pos'(it) {
      const text = it.evalInt()
      it.expect(',')
      const position = it.evalInt()
      it.expect(',')
      heap().position(text, position, it.evalInt())
    },
    /** routines 1473/1474: copy an AMOS string, optionally using a non-NUL terminator. */
    '_str put'(it) {
      const value = it.evalStr()
      it.expect(',')
      const text = it.evalInt()
      const terminator = it.accept(',') ? it.evalInt() : 0
      heap().put(text, value, terminator)
    },
    /** routine 512: CurrentTime writes seconds since 1978 and microseconds. */
    '_sys time'(it) {
      const secondsAt = it.evalInt()
      it.expect(',')
      const microsAt = it.evalInt()
      const now = rt.host.clock.now()
      writeLong(rt, secondsAt, now.days * 86_400 + now.mins * 60 + Math.floor(now.ticks / 50))
      writeLong(rt, microsAt, (now.ticks % 50) * 20_000)
    },
    /** routine 1755 is Exec CacheClearU; coherent managed memory needs no flush. */
    '_cache clr'() {},
    /** workers 1320-1322: append a pair, terminate/reset the cursor, and FreeVec. */
    '_tag set'(it) {
      const list = it.evalInt(); it.expect(',')
      const tag = it.evalInt(); it.expect(',')
      setTag(st(), list, tag, it.evalInt())
    },
    '_tag done'(it) { finishTags(st(), it.evalInt()) },
    '_tag list free'(it) {
      const list = it.evalInt()
      if (list !== 0) st().memory.freeMem((list - 8) >>> 0)
    },
    /** workers 1118/1120 and 1783: shared arena lifetime and byte-exact CopyMem. */
    '_mem free'(it) {
      const address = it.evalInt(); it.expect(','); it.evalInt()
      st().memory.freeMem(address >>> 0)
    },
    '_mem copy'(it) {
      const source = it.evalInt(); it.expect(',')
      const destination = it.evalInt(); it.expect(',')
      const length = it.evalInt()
      for (let i = 0; i < length; i++) {
        const from = rt.resolveAddr((source + i) >>> 0)
        const to = rt.resolveWrite((destination + i) >>> 0)
        if (!from || !to) break
        to.data[to.off] = from.data[from.off]!
      }
    },
    '_vec free'(it) { st().memory.freeMem(it.evalInt() >>> 0) },
    '_struct free'(it) { st().memory.freeMem(it.evalInt() >>> 0) },
    /** routines 16/18/20/22/24: assignment-form writes at base+displacement. */
    '_struct byte': structSet(rt, 1),
    '_struct ubyte': structSet(rt, 1),
    '_struct word': structSet(rt, 2),
    '_struct uword': structSet(rt, 2),
    '_struct long': structSet(rt, 4),
    /** routines 10/12/14: assignment-form direct word/long stores. */
    '_cpu word': cpuSet(rt, 2),
    '_cpu uword': cpuSet(rt, 2),
    '_cpu long': cpuSet(rt, 4),
    /** worker 1590: release the token returned by LockIBase. */
    '_ibase unlock'(it) { st().ibase.unlock(it.evalInt()) },
    /** worker 1570 calls Exec ColdReboot and never returns. */
    '_cold reboot'(it) {
      rt.machine.requestReset('cold', '_cold reboot')
      it.halt('ended')
      return 'jumped'
    },
    /** worker 1569 calls Exec Alert after bringing the Workbench forward. */
    '_alert'(it) {
      const number = it.evalInt() >>> 0
      rt.intuition.wBenchToFront()
      const alert = rt.exec.alert(number, '_alert')
      if (alert.deadEnd) {
        rt.machine.requestReset('cold', `_alert $${number.toString(16)}`)
        it.halt('ended')
        return 'jumped'
      }
    },
    /** workers 1534/1535/1538 and 1541: Exec public-port and message delivery. */
    '_port add'(it) { st().exec.messages.addPort(it.evalInt()) },
    '_port rem'(it) { st().exec.messages.remPort(it.evalInt()) },
    '_port delete'(it) { st().exec.messages.deletePort(it.evalInt()) },
    '_msg put'(it) {
      const port = it.evalInt(); it.expect(',')
      st().exec.messages.putMsg(port, it.evalInt())
    },
    '_msg reply'(it) { st().exec.messages.replyMsg(it.evalInt()) },
    '_gmsg reply'(it) { st().exec.messages.replyMsg(it.evalInt()) },
    /** workers 1559/1561: Exec signal ownership and delivery. */
    '_sig free'(it) { st().exec.messages.freeSignal(it.evalInt()) },
    '_sig put'(it) {
      const task = it.evalInt(); it.expect(',')
      st().exec.messages.signal(task, it.evalInt())
    },
    /** workers 1564-1566: native Interrupt lifetime and server removal. */
    '_int free'(it) { st().exec.interrupts.free(it.evalInt()) },
    '_int set'(it) {
      const interrupt = it.evalInt(); it.expect(',')
      const data = it.evalInt(); it.expect(',')
      st().exec.interrupts.set(interrupt, data, it.evalInt())
    },
    '_int add'(it) { const [vector, interrupt] = readArgs(it, 2); st().exec.interrupts.add(vector!, interrupt!) },
    '_int rem'(it) {
      const vector = it.evalInt(); it.expect(',')
      st().exec.interrupts.rem(vector, it.evalInt())
    },
    /** workers 1439-1455: native Exec List/Node fields and algorithms. */
    '_lnod set head'(it) { const p = it.evalInt(); it.expect(','); st().exec.memory.setListHead(p, it.evalInt()) },
    '_lnod set tail'(it) { const p = it.evalInt(); it.expect(','); st().exec.memory.setListTail(p, it.evalInt()) },
    '_lnod set type'(it) { const p = it.evalInt(); it.expect(','); st().exec.memory.setListType(p, it.evalInt()) },
    '_nod set succ'(it) { const p = it.evalInt(); it.expect(','); st().exec.memory.setNodeSucc(p, it.evalInt()) },
    '_nod set pred'(it) { const p = it.evalInt(); it.expect(','); st().exec.memory.setNodePred(p, it.evalInt()) },
    '_nod set type'(it) { const p = it.evalInt(); it.expect(','); st().exec.memory.setNodeType(p, it.evalInt()) },
    '_nod set name'(it) { const p = it.evalInt(); it.expect(','); st().exec.memory.setNodeName(p, it.evalInt()) },
    '_nod set pri'(it) { const p = it.evalInt(); it.expect(','); st().exec.memory.setNodePriority(p, it.evalInt()) },
    '_lnod free'(it) { st().exec.memory.free(it.evalInt()) },
    '_nod free'(it) { st().exec.memory.free(it.evalInt()) },
    '_nod ins'(it) {
      const list = it.evalInt(); it.expect(',')
      const node = it.evalInt(); it.expect(',')
      st().exec.memory.insert(list, node, it.evalInt())
    },
    '_nod rem'(it) { st().exec.memory.remove(it.evalInt()) },
    '_nod h add'(it) {
      const list = it.evalInt(); it.expect(','); st().exec.memory.addHead(list, it.evalInt())
    },
    '_nod h rem'(it) { st().exec.memory.remHead(it.evalInt()) },
    '_nod t add'(it) {
      const list = it.evalInt(); it.expect(','); st().exec.memory.addTail(list, it.evalInt())
    },
    '_nod t rem'(it) { st().exec.memory.remTail(it.evalInt()) },
    '_nod enqueue'(it) {
      const list = it.evalInt(); it.expect(',')
      const node = it.evalInt()
      st().exec.memory.enqueue(list, node)
    },
    /** workers 1122-1129 and 1143-1151: channel fields and lifetime. */
    '_chn set number'(it) { const p = it.evalInt(); it.expect(','); if (p !== 0) set32(st(), p, it.evalInt()) },
    '_chn set default'(it) { const p = it.evalInt(); it.expect(','); if (p !== 0) set32(st(), p + 4, it.evalInt()) },
    '_chn set first'(it) { const p = it.evalInt(); it.expect(','); if (p !== 0) set32(st(), p + 8, it.evalInt()) },
    '_chn set last'(it) { const p = it.evalInt(); it.expect(','); if (p !== 0) set32(st(), p + 12, it.evalInt()) },
    '_chn set list'(it) { const p = it.evalInt(); it.expect(','); if (p !== 0) set32(st(), p - 20, it.evalInt()) },
    '_chn set length'(it) { const p = it.evalInt(); it.expect(','); if (p !== 0) set32(st(), p - 24, it.evalInt()) },
    '_chn set next'(it) { const p = it.evalInt(); it.expect(','); if (p !== 0) set32(st(), p - 12, it.evalInt()) },
    '_chn set previous'(it) { const p = it.evalInt(); it.expect(','); if (p !== 0) set32(st(), p - 16, it.evalInt()) },
    '_chn free'(it, tok) {
      const first = it.evalInt()
      const node = tok.kind === 'ext' && tok.id === 0x0272
        ? (it.expect(','), channelFind(st(), first, it.evalInt()))
        : first
      channelFree(st(), node)
    },
    '_chn list free'(it) {
      const list = it.evalInt()
      if (list === 0) return
      while (get32(st(), list + 8) !== 0) channelFree(st(), get32(st(), list + 8))
      st().memory.freeMem(list >>> 0)
    },
    /** routine 1151 is a six-byte no-op that only consumes both arguments. */
    '_chn swap'(it) { it.evalInt(); it.expect(','); it.evalInt() },
    /** workers 314-318: cleared signed-word coordinate pairs. */
    '_dots set'(it) {
      const [dots, index, x, y] = readArgs(it, 4)
      structWrite(rt, dots! + index! * 4, 2, x!)
      structWrite(rt, dots! + index! * 4 + 2, 2, y!)
    },
    '_dots free'(it) { st().memory.freeMem(it.evalInt() >>> 0) },
    /** worker 667: struct TextAttr, including its trailing byte fields. */
    '_ta set'(it) {
      const [attr, name, ySize, style, flags] = readArgs(it, 5)
      structWrite(rt, attr!, 4, name!)
      structWrite(rt, attr! + 4, 2, ySize!)
      structWrite(rt, attr! + 6, 1, style!)
      structWrite(rt, attr! + 7, 1, flags!)
    },
    /** workers 300-304: struct Border at byte-exact native offsets. */
    '_bd set draw'(it) {
      const [border, front, back, mode] = readArgs(it, 4)
      structWrite(rt, border! + 4, 1, front!); structWrite(rt, border! + 5, 1, back!)
      structWrite(rt, border! + 6, 1, mode!)
    },
    '_bd set corner'(it) {
      const [border, left, top] = readArgs(it, 3)
      structWrite(rt, border!, 2, left!); structWrite(rt, border! + 2, 2, top!)
    },
    '_bd set dots'(it) {
      const [border, count, dots] = readArgs(it, 3)
      structWrite(rt, border! + 7, 1, count!); structWrite(rt, border! + 8, 4, dots!)
    },
    '_bd set next'(it) {
      const [border, next] = readArgs(it, 2); structWrite(rt, border! + 12, 4, next!)
    },
    '_bd set'(it) {
      const [border, left, top, front, back, mode, count, dots, next] = readArgs(it, 9)
      structWrite(rt, border!, 2, left!); structWrite(rt, border! + 2, 2, top!)
      structWrite(rt, border! + 4, 1, front!); structWrite(rt, border! + 5, 1, back!)
      structWrite(rt, border! + 6, 1, mode!); structWrite(rt, border! + 7, 1, count!)
      structWrite(rt, border! + 8, 4, dots!); structWrite(rt, border! + 12, 4, next!)
    },
    /** workers 319-321: struct Image setters. */
    '_img set body'(it) {
      const [image, left, top, width, height, depth, data] = readArgs(it, 7)
      for (const [at, value] of [[0, left], [2, top], [4, width], [6, height], [8, depth]] as const) {
        structWrite(rt, image! + at, 2, value!)
      }
      structWrite(rt, image! + 10, 4, data!)
    },
    '_img set planes'(it) {
      const [image, pick, onOff] = readArgs(it, 3)
      structWrite(rt, image! + 14, 1, pick!); structWrite(rt, image! + 15, 1, onOff!)
    },
    '_img set next'(it) {
      const [image, next] = readArgs(it, 2); structWrite(rt, image! + 16, 4, next!)
    },
    /** workers 335-337: packed, deliberately unaligned BooleanInfo. */
    '_bi set flags'(it) {
      const [info, flags] = readArgs(it, 2); structWrite(rt, info!, 2, flags!)
    },
    '_bi set mask'(it) {
      const [info, mask] = readArgs(it, 2); structWrite(rt, info! + 2, 4, mask!)
    },
    '_bi set'(it) {
      const [info, flags, mask] = readArgs(it, 3)
      structWrite(rt, info!, 2, flags!); structWrite(rt, info! + 2, 4, mask!)
    },
    /** worker 340 writes only the first five PropInfo words. */
    '_pi set'(it) {
      const [prop, ...values] = readArgs(it, 6)
      values.forEach((value, i) => structWrite(rt, prop! + i * 2, 2, value))
    },
    /** workers 352-356: partial and complete struct StringInfo setters. */
    '_si set buf'(it) {
      const [info, buffer, undo, position, maxChars, display] = readArgs(it, 6)
      structWrite(rt, info!, 4, buffer!); structWrite(rt, info! + 4, 4, undo!)
      structWrite(rt, info! + 8, 2, position!); structWrite(rt, info! + 10, 2, maxChars!)
      structWrite(rt, info! + 12, 2, display!)
    },
    '_si set ext'(it) {
      const [info, extension] = readArgs(it, 2); structWrite(rt, info! + 24, 4, extension!)
    },
    '_si set integer'(it) {
      const [info, integer] = readArgs(it, 2); structWrite(rt, info! + 28, 4, integer!)
    },
    '_si set keymap'(it) {
      const [info, keyMap] = readArgs(it, 2); structWrite(rt, info! + 32, 4, keyMap!)
    },
    '_si set'(it) {
      const [info, buffer, undo, position, maxChars, display, extension, integer, keyMap] = readArgs(it, 9)
      structWrite(rt, info!, 4, buffer!); structWrite(rt, info! + 4, 4, undo!)
      structWrite(rt, info! + 8, 2, position!); structWrite(rt, info! + 10, 2, maxChars!)
      structWrite(rt, info! + 12, 2, display!); structWrite(rt, info! + 24, 4, extension!)
      structWrite(rt, info! + 28, 4, integer!); structWrite(rt, info! + 32, 4, keyMap!)
    },
    /** Native graphics records, workers 562, 572-573, 588 and 620-674. */
    '_tmpras init'(it) {
      const [tmp, raster, size] = readArgs(it, 3)
      structWrite(rt, tmp!, 4, raster!); structWrite(rt, tmp! + 4, 4, size!)
    },
    '_tr set'(it) {
      const [tmp, raster, size] = readArgs(it, 3)
      structWrite(rt, tmp!, 4, raster!); structWrite(rt, tmp! + 4, 4, size!)
    },
    '_area init'(it) {
      const [area, buffer, maxVectors] = readArgs(it, 3)
      if (area === 0 || buffer === 0) return
      structWrite(rt, area!, 4, buffer!); structWrite(rt, area! + 4, 4, buffer!)
      structWrite(rt, area! + 8, 4, buffer! + maxVectors! * 4); structWrite(rt, area! + 12, 4, buffer! + maxVectors! * 4)
      structWrite(rt, area! + 16, 2, 0); structWrite(rt, area! + 18, 2, maxVectors!)
      structWrite(rt, area! + 20, 2, 0); structWrite(rt, area! + 22, 2, 0); st().areaPaths.set(area!, [])
    },
    '_rp flood'(it) {
      const [rp, mode, x, y] = readArgs(it, 4); const raster = nativeRaster(rt, rp!)
      if (raster && structRead(rt, rp! + 12, 4, false) !== 0) nativeFlood(rt, raster, mode!, x!, y!)
    },
    '_rp bar'(it) {
      const [rp, x1, y1, x2, y2] = readArgs(it, 5); const raster = nativeRaster(rt, rp!); if (!raster) return
      for (let y = Math.min(y1!, y2!); y <= Math.max(y1!, y2!); y++) for (let x = Math.min(x1!, x2!); x <= Math.max(x1!, x2!); x++) nativeFillColor(rt, raster, x, y)
    },
    '_rast free'(it) { const [raster] = readArgs(it, 3); if (raster !== 0) st().memory.freeMem(raster! >>> 0) },
    '_cop init view'(it) {
      const view = it.evalInt(); for (let at = 0; at < 18; at++) structWrite(rt, view + at, 1, 0)
    },
    '_cop load view'(it) { st().activeView = it.evalInt() >>> 0 },
    '_cop scroll vport'(it) {
      const viewPort = it.evalInt() >>> 0; const record = [...st().screenIds.values()].find(entry => entry.viewPort === viewPort)
      const screen = record ? rt.screens.get(record.slot) : undefined; const rasInfo = structRead(rt, viewPort + 20, 4, false) >>> 0
      if (screen && rasInfo !== 0) { screen.offsetX = structRead(rt, rasInfo + 8, 2, true); screen.offsetY = structRead(rt, rasInfo + 10, 2, true) }
    },
    '_cop wait tof'(it) { it.block({ type: 'wait', until: Math.floor(it.tick) + 1 }) },
    '_cop wait bottom'(it) { it.evalInt(); it.block({ type: 'wait', until: Math.floor(it.tick) + 1 }) },
    '_cop init vport'(it) {
      const viewPort = it.evalInt(); for (let at = 0; at < 40; at++) structWrite(rt, viewPort + at, 1, 0)
    },
    '_bm set datas'(it) {
      const [bitmap, modulo, height, depth, flags] = readArgs(it, 5)
      structWrite(rt, bitmap!, 2, modulo!); structWrite(rt, bitmap! + 2, 2, height!)
      structWrite(rt, bitmap! + 4, 1, flags!); structWrite(rt, bitmap! + 5, 1, depth!)
    },
    '_rp set layer'(it) { const [rp, p] = readArgs(it, 2); structWrite(rt, rp!, 4, p!) },
    '_rp set bmap'(it) { const [rp, p] = readArgs(it, 2); structWrite(rt, rp! + 4, 4, p!) },
    '_rp set tmpras'(it) { const [rp, p] = readArgs(it, 2); structWrite(rt, rp! + 12, 4, p!) },
    '_rp set area info'(it) { const [rp, p] = readArgs(it, 2); structWrite(rt, rp! + 16, 4, p!) },
    '_rp set o pen'(it) {
      const [rp, pen] = readArgs(it, 2); if ((pen! >>> 0) !== 0x8000_0000) structWrite(rt, rp! + 27, 1, pen!)
    },
    '_rp set line'(it) { const [rp, pattern] = readArgs(it, 2); structWrite(rt, rp! + 34, 2, pattern!) },
    '_rp set wr msk'(it) { const [rp, mask] = readArgs(it, 2); structWrite(rt, rp! + 24, 1, mask!) },
    '_rp wr msk'(it) { const [rp, mask] = readArgs(it, 2); structWrite(rt, rp! + 24, 1, mask!) },
    '_rp o pen'(it) { const [rp, pen] = readArgs(it, 2); structWrite(rt, rp! + 27, 1, pen!) },
    '_font set'(it) { const [rp, font] = readArgs(it, 2); if (font !== 0) structWrite(rt, rp! + 52, 4, font!) },
    '_font add'(it) { const held = st().fonts.get(it.evalInt() >>> 0); if (held) held.resident = true },
    '_font rem'(it) { const held = st().fonts.get(it.evalInt() >>> 0); if (held) held.resident = false },
    '_font close'(it) { const held = st().fonts.get(it.evalInt() >>> 0); if (held && held.opens > 0) held.opens-- },
    '_font ask'(it) {
      const [rp, attr] = readArgs(it, 2); if (rp === 0 || attr === 0) return
      const held = st().fonts.get(structRead(rt, rp! + 52, 4, false) >>> 0); if (!held) return
      structWrite(rt, attr!, 4, held.name); structWrite(rt, attr! + 4, 2, held.font.ySize)
      structWrite(rt, attr! + 6, 1, held.font.style); structWrite(rt, attr! + 7, 1, held.font.flags)
    },
    '_view set'(it) {
      const [view, viewPort, x, y, modes] = readArgs(it, 5)
      structWrite(rt, view!, 4, viewPort!); structWrite(rt, view! + 12, 2, y!); structWrite(rt, view! + 14, 2, x!); structWrite(rt, view! + 16, 2, modes!)
    },
    '_vp set next'(it) { const [vp, next] = readArgs(it, 2); structWrite(rt, vp!, 4, next!) },
    '_vp set body'(it) {
      const [vp, x, y, width, height, modes, priority] = readArgs(it, 7)
      structWrite(rt, vp! + 24, 2, width!); structWrite(rt, vp! + 26, 2, height!)
      structWrite(rt, vp! + 28, 2, x!); structWrite(rt, vp! + 30, 2, y!)
      structWrite(rt, vp! + 32, 2, modes!); structWrite(rt, vp! + 34, 2, priority!)
    },
    '_vp set cmap'(it) { const [vp, map] = readArgs(it, 2); structWrite(rt, vp! + 4, 4, map!) },
    '_vp set ras info'(it) { const [vp, info] = readArgs(it, 2); structWrite(rt, vp! + 36, 4, info!) },
    '_ri set'(it) {
      const [info, next, bitmap, x, y] = readArgs(it, 5)
      structWrite(rt, info!, 4, next!); structWrite(rt, info! + 4, 4, bitmap!)
      structWrite(rt, info! + 8, 2, x!); structWrite(rt, info! + 10, 2, y!)
    },
    '_spr set height'(it) { const [sprite, height] = readArgs(it, 2); structWrite(rt, sprite! + 4, 2, height!) },
    '_spr set nb'(it) { const [sprite, number] = readArgs(it, 2); structWrite(rt, sprite! + 10, 2, number!) },
    '_spr set pos'(it) {
      const [sprite, x, y] = readArgs(it, 3)
      structWrite(rt, sprite! + 6, 2, x!); structWrite(rt, sprite! + 8, 2, y!)
    },
    '_cm free'(it) {
      const address = it.evalInt(); const map = st().colorMaps.get(address) ?? null
      freeColorMap(map); st().colorMaps.delete(address); st().memory.freeMem(address >>> 0)
    },
    '_rgb4 cm set'(it) {
      const [map, index, red, green, blue] = readArgs(it, 5)
      setRgb4ColorMap(st().colorMaps.get(map!) ?? null, index!, red!, green!, blue!)
    },
    '_rgb32 cm set'(it) {
      const [map, index, red, green, blue] = readArgs(it, 5)
      setRgb32ColorMap(st().colorMaps.get(map!) ?? null, index!, red!, green!, blue!)
    },
    '_rgb32 get'(it) {
      const [map, first, count, destination] = readArgs(it, 4)
      const values = getRgb32(st().colorMaps.get(map!) ?? null, first!, count!)
      values.forEach((value, i) => structWrite(rt, destination! + i * 4, 4, value))
    },
    '_rgb4 load'(it) {
      const [viewPort, table, count] = readArgs(it, 3)
      for (let pen = 0; pen < count!; pen++) {
        const colour = structRead(rt, table! + pen * 2, 2, false)
        setViewPortRgb(rt, st(), viewPort!, pen, colour >>> 8, colour >>> 4, colour, 4)
      }
    },
    '_rgb4 set'(it) {
      const [viewPort, pen, red, green, blue] = readArgs(it, 5); setViewPortRgb(rt, st(), viewPort!, pen!, red!, green!, blue!, 4)
    },
    '_rgb32 load'(it) {
      const [viewPort, table] = readArgs(it, 2); const count = structRead(rt, table!, 2, false); const first = structRead(rt, table! + 2, 2, false)
      for (let i = 0; i < count; i++) setViewPortRgb(rt, st(), viewPort!, first + i,
        structRead(rt, table! + 4 + i * 12, 4, false), structRead(rt, table! + 8 + i * 12, 4, false),
        structRead(rt, table! + 12 + i * 12, 4, false), 32)
    },
    '_rgb32 set'(it) {
      const [viewPort, pen, red, green, blue] = readArgs(it, 5); setViewPortRgb(rt, st(), viewPort!, pen!, red!, green!, blue!, 32)
    },
    // Synchronous, non-contending blitter: these calls have no observable state.
    '_blt own'() {},
    '_blt disown'() {},
    '_blt wait'() {},
    /** workers 534-547 over caller-owned native RastPort and BitMap memory. */
    '_rp move'(it) {
      const [rp, x, y] = readArgs(it, 3)
      structWrite(rt, rp! + 36, 2, x!); structWrite(rt, rp! + 38, 2, y!)
    },
    '_rp a pen'(it) { const [rp, pen] = readArgs(it, 2); structWrite(rt, rp! + 25, 1, pen!) },
    '_rp b pen'(it) { const [rp, pen] = readArgs(it, 2); structWrite(rt, rp! + 26, 1, pen!) },
    '_rp dr md'(it) { const [rp, mode] = readArgs(it, 2); structWrite(rt, rp! + 28, 1, mode!) },
    '_rp rast'(it) {
      const [rp, pen] = readArgs(it, 2); const raster = nativeRaster(rt, rp!)
      if (!raster) return
      const mask = structRead(rt, rp! + 24, 1, false)
      for (let plane = 0; plane < raster.depth; plane++) {
        if ((mask & (1 << plane)) === 0) continue
        const address = structRead(rt, raster.bitmap + 8 + plane * 4, 4, false) >>> 0
        for (let at = 0; at < raster.bytesPerRow * raster.height; at++) {
          const byte = rt.resolveWrite(address + at)
          if (byte) byte.data[byte.off] = (pen! & (1 << plane)) !== 0 ? 0xff : 0
        }
      }
    },
    '_rp clr eol'(it) {
      const rp = it.evalInt(); const raster = nativeRaster(rt, rp)
      if (!raster) return
      const x = structRead(rt, rp + 36, 2, true); const baseline = structRead(rt, rp + 38, 2, true)
      const font = st().fonts.get(structRead(rt, rp + 52, 4, false) >>> 0)?.font ?? rt.systemFont()
      const pen = structRead(rt, rp + 26, 1, false)
      for (let y = baseline - font.baseline; y < baseline - font.baseline + font.ySize; y++) for (let px = x; px < raster.width; px++) nativePutColor(rt, raster, px, y, pen)
    },
    '_rp clr scr'(it) {
      const rp = it.evalInt(); const raster = nativeRaster(rt, rp)
      if (!raster) return
      const x = structRead(rt, rp + 36, 2, true); const baseline = structRead(rt, rp + 38, 2, true)
      const font = st().fonts.get(structRead(rt, rp + 52, 4, false) >>> 0)?.font ?? rt.systemFont()
      const pen = structRead(rt, rp + 26, 1, false); const top = baseline - font.baseline
      for (let y = top; y < raster.height; y++) for (let px = y === top ? x : 0; px < raster.width; px++) nativePutColor(rt, raster, px, y, pen)
    },
    '_rp poly draw'(it) {
      const [rp, count, dots] = readArgs(it, 3); const raster = nativeRaster(rt, rp!)
      if (!raster) return
      let x = structRead(rt, rp! + 36, 2, true); let y = structRead(rt, rp! + 38, 2, true)
      for (let i = 0; i < count!; i++) {
        const nx = structRead(rt, dots! + i * 4, 2, true); const ny = structRead(rt, dots! + i * 4 + 2, 2, true)
        nativeDraw(rt, raster, x, y, nx, ny); x = nx; y = ny
      }
    },
    '_rp scroll'(it) {
      const [rp, dx, dy, x1, y1] = readArgs(it, 5); it.expect('to'); const [x2, y2] = readArgs(it, 2)
      const raster = nativeRaster(rt, rp!); if (raster) nativeScrollRaster(rt, raster, dx!, dy!, x1!, y1!, x2!, y2!)
    },
    '_rp bf scroll'(it) {
      const [rp, dx, dy, x1, y1] = readArgs(it, 5); it.expect('to'); const [x2, y2] = readArgs(it, 2)
      const raster = nativeRaster(rt, rp!); if (raster) nativeScrollRaster(rt, raster, dx!, dy!, x1!, y1!, x2!, y2!)
    },
    '_scale bm'(it) {
      const args = it.evalInt() >>> 0; if (args === 0) return
      const srcX = structRead(rt, args, 2, false); const srcY = structRead(rt, args + 2, 2, false)
      const srcWidth = structRead(rt, args + 4, 2, false); const srcHeight = structRead(rt, args + 6, 2, false)
      const dstX = structRead(rt, args + 12, 2, false); const dstY = structRead(rt, args + 14, 2, false)
      const dstWidth = structRead(rt, args + 16, 2, false); const dstHeight = structRead(rt, args + 18, 2, false)
      const src = structRead(rt, args + 24, 4, false) >>> 0; const dst = structRead(rt, args + 28, 4, false) >>> 0
      if (src === 0 || dst === 0 || srcWidth === 0 || srcHeight === 0 || dstWidth === 0 || dstHeight === 0) return
      for (let y = 0; y < dstHeight; y++) for (let x = 0; x < dstWidth; x++) {
        putNativeBitmapPixel(rt, dst, dstX + x, dstY + y, nativeBitmapPixel(rt, src, srcX + Math.floor(x * srcWidth / dstWidth), srcY + Math.floor(y * srcHeight / dstHeight)))
      }
    },
    '_pen release'(it) { const [map, pen] = readArgs(it, 2); releasePen(st().colorMaps.get(map! >>> 0) ?? null, pen!) },
    '_pen set max'(it) { const [rastPort, maxPen] = readArgs(it, 2); st().rastPortMaxPens.set(rastPort! >>> 0, maxPen! & 0xffff) },
    '_rp draw'(it) {
      const [rp, x, y] = readArgs(it, 3); const raster = nativeRaster(rt, rp!)
      if (raster) nativeDraw(rt, raster, structRead(rt, rp! + 36, 2, true), structRead(rt, rp! + 38, 2, true), x!, y!)
    },
    '_rp ellipse'(it) {
      const [rp, x, y, rx, ry] = readArgs(it, 5); const raster = nativeRaster(rt, rp!)
      if (raster) nativeEllipse(rt, raster, x!, y!, rx!, ry!)
    },
    '_rp plot'(it) {
      const [rp, x, y] = readArgs(it, 3); const raster = nativeRaster(rt, rp!)
      if (raster) nativePlot(rt, raster, x!, y!)
    },
    '_rp text'(it) {
      const rp = it.evalInt(); it.expect(','); const value = it.evalStr()
      drawNativeText(rt, st(), rp, value)
    },
    '_bd draw'(it) {
      const [first, rp, offsetX, offsetY] = readArgs(it, 4); const raster = nativeRaster(rt, rp!)
      if (!raster) return
      for (let border = first! >>> 0; border !== 0; border = structRead(rt, border + 12, 4, false) >>> 0) {
        const left = structRead(rt, border, 2, true) + offsetX!; const top = structRead(rt, border + 2, 2, true) + offsetY!
        structWrite(rt, rp! + 25, 1, structRead(rt, border + 4, 1, false))
        structWrite(rt, rp! + 26, 1, structRead(rt, border + 5, 1, false))
        structWrite(rt, rp! + 28, 1, structRead(rt, border + 6, 1, false))
        const count = structRead(rt, border + 7, 1, false); const dots = structRead(rt, border + 8, 4, false) >>> 0
        if (count === 0 || dots === 0) continue
        let x = left + structRead(rt, dots, 2, true); let y = top + structRead(rt, dots + 2, 2, true)
        for (let i = 1; i < count; i++) {
          const nx = left + structRead(rt, dots + i * 4, 2, true)
          const ny = top + structRead(rt, dots + i * 4 + 2, 2, true)
          nativeDraw(rt, raster, x, y, nx, ny); x = nx; y = ny
        }
      }
    },
    '_img erase'(it) {
      const [image, rp, x, y] = readArgs(it, 4); const raster = nativeRaster(rt, rp!)
      if (!raster) return
      const left = structRead(rt, image!, 2, true) + x!; const top = structRead(rt, image! + 2, 2, true) + y!
      const width = structRead(rt, image! + 4, 2, false); const height = structRead(rt, image! + 6, 2, false)
      for (let iy = 0; iy < height; iy++) for (let ix = 0; ix < width; ix++) nativePutColor(rt, raster, left + ix, top + iy, 0)
    },
    '_img draw'(it) {
      const [image, rp, x, y] = readArgs(it, 4); const raster = nativeRaster(rt, rp!)
      if (raster) nativeDrawImage(rt, image!, raster, x!, y!)
    },
    '_img draw state'(it) {
      const [image, rp, x, y, state, _drawInfo] = readArgs(it, 6); const raster = nativeRaster(rt, rp!)
      if (!raster) return
      nativeDrawImage(rt, image!, raster, x!, y!)
      // IDS_SELECTED is the one state representable without DrawInfo pen policy.
      if (state === 1) {
        const left = structRead(rt, image!, 2, true) + x!; const top = structRead(rt, image! + 2, 2, true) + y!
        const width = structRead(rt, image! + 4, 2, false); const height = structRead(rt, image! + 6, 2, false)
        for (let iy = 0; iy < height; iy++) for (let ix = 0; ix < width; ix++) {
          nativePutColor(rt, raster, left + ix, top + iy, ~nativePoint(rt, raster, left + ix, top + iy))
        }
      }
    },
    /** Screen-ID wrappers over stable native records bound to managed screens. */
    '_scr def pub'(it) { rt.intuition.setDefaultPubScreen(cString(rt, it.evalInt() >>> 0)) },
    '_scr dinf free'(it) {
      const [screen, drawInfo] = readArgs(it, 2)
      freeScreenDrawInfo(st(), screen!, drawInfo!)
    },
    '_scr close'(it) {
      const found = screenRecordAtBase(st(), it.evalInt())
      if (found) closeScreenId(rt, st(), found.id)
    },
    '_scr move'(it) {
      const [base, dx, dy] = readArgs(it, 3); const found = screenRecordAtBase(st(), base!)
      const screen = found ? rt.screens.get(found.record.slot) : undefined
      if (screen) { screen.displayX += dx!; screen.displayY -= dy! }
    },
    '_scr position'(it) {
      const [base, x, y] = readArgs(it, 3); const found = screenRecordAtBase(st(), base!)
      const screen = found ? rt.screens.get(found.record.slot) : undefined
      if (screen) { screen.displayX = x!; screen.displayY = y! }
    },
    '_scr to back'(it) { const slot = managedScreenSlot(rt, it.evalInt()); if (slot !== null) rt.toBack(slot) },
    '_scr to front'(it) { const slot = managedScreenSlot(rt, it.evalInt()); if (slot !== null) rt.toFront(slot) },
    '_scr show title'(it) { const slot = managedScreenSlot(rt, it.evalInt()); if (slot !== null) rt.screens.get(slot)!.intuitionTitleVisible = true },
    '_scr hide title'(it) { const slot = managedScreenSlot(rt, it.evalInt()); if (slot !== null) rt.screens.get(slot)!.intuitionTitleVisible = false },
    '_scr id def dri pens v1'(it) { st().drawInfoDefaults.defineV1(readArgs(it, 9)) },
    '_scr id def dri pens v2'(it) { st().drawInfoDefaults.defineV2(readArgs(it, 3)) },
    '_scr id fix dri pens'(it) { st().drawInfoPenSource = it.evalInt() },
    '_scr id open'(it) {
      const [id, x, y, width, height, depth, mode, _type] = readArgs(it, 8)
      it.expect(','); const title = it.evalStr()
      closeScreenId(rt, st(), id!)
      const address = rt.intuition.openScreen({
        width: width!, height: height!, depth: depth!,
        hires: (mode! & 0x8000) !== 0, laced: (mode! & 4) !== 0,
        palette: [], displayY: y!, title,
      })
      if (address === 0) return
      const slot = rt.intuition.slotOf(address)
      if (slot === null) return
      const screen = rt.screens.get(slot)!
      screen.displayX = x!
      if (!bindScreenId(rt, st(), id!, slot, true)) rt.intuition.closeScreen(address)
      else st().screenDrawInfoPens.set(slot, selectedDrawInfoPens(rt, st(), screen.depth))
    },
    '_scr id from pointer'(it) {
      const [id, pointer] = readArgs(it, 2)
      const relative = (pointer! >>> 0) - SCREEN_CTRL_BASE
      if (relative >= 0 && relative % SCREEN_CTRL_SLOT === 0) bindScreenId(rt, st(), id!, relative / SCREEN_CTRL_SLOT)
    },
    '_scr id use'(it) {
      const id = it.evalInt(); if (st().screenIds.has(id)) st().currentScreenId = id
    },
    '_scr id close'(it) {
      closeScreenId(rt, st(), it.evalInt())
    },
    '_scr id from wb'(it) {
      const id = it.evalInt(); const address = rt.intuition.openWorkBench()
      if (address !== 0) bindScreenId(rt, st(), id, WB_SLOT)
    },
    '_scr id from pub'(it) {
      const id = it.evalInt(); it.expect(','); const address = rt.intuition.lockPubScreen(it.evalStr())
      if (address === 0) return
      const slot = address === SCREEN_CTRL_BASE + WB_SLOT * SCREEN_CTRL_SLOT ? WB_SLOT : rt.intuition.slotOf(address)
      if (slot === null || !bindScreenId(rt, st(), id, slot, false, true)) rt.intuition.unlockPubScreen(address)
    },
    '_scr pub unlock'(it) { rt.intuition.unlockPubScreen(it.evalInt() >>> 0) },
    '_scr id show'(it) { const r = st().screenIds.get(it.evalInt()); if (r) rt.screens.get(r.slot)!.visible = true },
    '_scr id hide'(it) { const r = st().screenIds.get(it.evalInt()); if (r) rt.screens.get(r.slot)!.visible = false },
    '_scr id move'(it) {
      const [id, dx, dy] = readArgs(it, 3); const record = st().screenIds.get(id!)
      const screen = record ? rt.screens.get(record.slot) : undefined
      if (screen) { screen.displayX += dx!; screen.displayY += dy! }
    },
    '_scr id offset'(it) {
      const [id, x, y] = readArgs(it, 3); const record = st().screenIds.get(id!)
      const screen = record ? rt.screens.get(record.slot) : undefined
      if (screen) { screen.offsetX = x!; screen.offsetY = y! }
    },
    '_scr id set mouse pos'(it) {
      const [id, x, y] = readArgs(it, 3); const record = st().screenIds.get(id!)
      // Unlike AMOS X/Y Hard, POINTERPOS coordinates are in the viewport.
      if (record) setScreenMousePosition(rt, record.slot, x!, y!)
    },
    '_scr id clip'(it) {
      const x1 = it.evalInt(); it.expect(','); const y1 = it.evalInt(); it.expect('to')
      const x2 = it.evalInt(); it.expect(','); const y2 = it.evalInt(); const screen = currentScreen(rt, st())
      if (screen) screen.rp.clip = {
        x1: Math.min(x1, x2), y1: Math.min(y1, y2),
        x2: Math.max(x1, x2), y2: Math.max(y1, y2),
      }
    },
    '_scr id set pal'(it) {
      const [pen, colour] = readArgs(it, 2); const screen = currentScreen(rt, st())
      if (screen && pen! >= 0 && pen! < screen.palette.length) {
        screen.palette[pen!] = colour! & 0xfff; screen.paletteLo[pen!] = colour! & 0xfff
      }
    },
    '_scr id colour'(it) {
      const [pen, colour] = readArgs(it, 2); const screen = currentScreen(rt, st())
      if (screen && pen! >= 0 && pen! < screen.palette.length) {
        screen.palette[pen!] = colour! & 0xfff; screen.paletteLo[pen!] = colour! & 0xfff
      }
    },
    '_scr id set aga pal'(it) {
      const [pen, colour] = readArgs(it, 2); setScreenRgb24(rt, st(), pen!, colour!)
    },
    '_scr id aga colour'(it) {
      const [pen, colour] = readArgs(it, 2); setScreenRgb24(rt, st(), pen!, colour!)
    },
    '_scr id ink'(it) {
      const [front, back, outline] = readArgs(it, 3); const raster = currentScreenRaster(rt, st())
      if (!raster) return
      structWrite(rt, raster.rp + 25, 1, front!); structWrite(rt, raster.rp + 26, 1, back!)
      structWrite(rt, raster.rp + 27, 1, outline!)
    },
    '_scr id gr writing'(it) {
      const raster = currentScreenRaster(rt, st()); if (raster) structWrite(rt, raster.rp + 28, 1, it.evalInt())
      else it.evalInt()
    },
    '_scr id cls'(it) {
      const pen = it.evalInt()
      withScreenRastPort(rt, st(), rp => rp.setRast(pen))
    },
    '_scr id plot'(it) {
      const [x, y] = readArgs(it, 2); withScreenRastPort(rt, st(), rp => rp.plot(x!, y!))
    },
    '_scr id set line'(it) {
      const raster = currentScreenRaster(rt, st()); if (raster) structWrite(rt, raster.rp + 34, 2, it.evalInt())
      else it.evalInt()
    },
    '_scr id rect'(it) {
      const x1 = it.evalInt(); it.expect(','); const y1 = it.evalInt(); it.expect('to')
      const x2 = it.evalInt(); it.expect(','); const y2 = it.evalInt()
      withScreenRastPort(rt, st(), rp => { rp.draw(x1, y1, x2, y1); rp.draw(x2, y1, x2, y2); rp.draw(x2, y2, x1, y2); rp.draw(x1, y2, x1, y1) })
    },
    '_scr id line to'(it) {
      const [x, y] = readArgs(it, 2); withScreenRastPort(rt, st(), rp => rp.draw(rp.cpX, rp.cpY, x!, y!))
    },
    '_scr id line'(it) {
      const x1 = it.evalInt(); it.expect(','); const y1 = it.evalInt(); it.expect('to')
      const x2 = it.evalInt(); it.expect(','); const y2 = it.evalInt()
      withScreenRastPort(rt, st(), rp => rp.draw(x1, y1, x2, y2))
    },
    '_scr id ellipse'(it) {
      const [x, y, rx, ry] = readArgs(it, 4); withScreenRastPort(rt, st(), rp => rp.ellipse(x!, y!, rx!, ry!))
    },
    '_scr id gr locate'(it) {
      const [x, y] = readArgs(it, 2); const raster = currentScreenRaster(rt, st())
      if (raster) { structWrite(rt, raster.rp + 36, 2, x!); structWrite(rt, raster.rp + 38, 2, y!) }
    },
    '_scr id text'(it) {
      const x = it.evalInt(); it.expect(','); const y = it.evalInt(); it.expect(','); const value = it.evalStr()
      withScreenRastPort(rt, st(), rp => rp.text(x, y, value))
    },
    '_scr id set paint'(it) { const raster = currentScreenRaster(rt, st()); const value = it.evalInt(); if (raster) structWrite(rt, raster.rp + 32, 1, value ? 0x08 : 0) },
    '_scr id pattern off'() { const raster = currentScreenRaster(rt, st()); if (raster) structWrite(rt, raster.rp + 8, 4, 0) },
    '_scr id pattern on'() {
      const raster = currentScreenRaster(rt, st()); if (raster) { structWrite(rt, raster.rp + 8, 4, fillPatternAddress(st())); structWrite(rt, raster.rp + 29, 1, 3) }
    },
    '_scr id set low pattern'(it) { setFillPattern(st(), false, readArgs(it, 8)) },
    '_scr id set high pattern'(it) { setFillPattern(st(), true, readArgs(it, 8)) },
    '_scr id bar'(it) {
      const x1 = it.evalInt(); it.expect(','); const y1 = it.evalInt(); it.expect('to'); const x2 = it.evalInt(); it.expect(','); const y2 = it.evalInt()
      withScreenRastPort(rt, st(), rp => rp.areaRectFill(x1, y1, x2, y2))
    },
    '_scr id fill ellipse'(it) {
      const [cx, cy, rx, ry] = readArgs(it, 4)
      withScreenRastPort(rt, st(), rp => withTemporaryRaster(st(), rp.width, rp.height, () => rp.ellipse(cx!, cy!, rx!, ry!, rp.fgPen, true)))
    },
    '_scr id paint'(it) {
      const [x, y, mode] = readArgs(it, 3)
      withScreenRastPort(rt, st(), rp => withTemporaryRaster(st(), rp.width, rp.height, () => rp.flood(mode!, x!, y!)))
    },
    '_scr id scroll'(it) {
      const x1 = it.evalInt(); it.expect(','); const y1 = it.evalInt(); it.expect('to'); const x2 = it.evalInt(); it.expect(','); const y2 = it.evalInt(); it.expect(','); const dx = it.evalInt(); it.expect(','); const dy = it.evalInt()
      withScreenRastPort(rt, st(), rp => scrollRaster(rp, dx, dy, x1, y1, x2, y2))
    },
    '_scr id put bob'(it) {
      const [number, x, y] = readArgs(it, 3)
      const image = number! > 0 ? rt.spriteBank?.image(number!) : undefined
      if (image) withScreenRastPort(rt, st(), rp => blitToRastPort(rp, image, x!, y!, true))
    },
    /** Window-ID lifecycle, workers 3042-3047, over Intuition and shared native graphics. */
    '_wnd id open'(it) {
      const [id, x, y, width, height, flags, idcmp, _gadgetBank] = readArgs(it, 8)
      it.expect(','); const title = it.evalStr()
      const screen = st().screenIds.get(st().currentScreenId)
      if (!screen || id! < 0 || st().windowIds.base(id!) !== 0) return
      const window = rt.intuition.openWindow({
        leftEdge: x!, topEdge: y!, width: width!, height: height!, detailPen: 0, blockPen: 1,
        idcmpFlags: idcmp!, flags: flags!, title, type: CUSTOMSCREEN, screenSlot: screen.slot,
      })
      if (!window) return
      attachWindowId(rt, st(), id!, window, title)
    },
    '_wnd id tag open'(it) {
      const id = it.evalInt(); it.expect(','); const list = it.evalInt()
      if (id < 0 || st().windowIds.base(id) !== 0) return
      const tags = tagItems(st(), list)
      const value = (tag: number, fallback: number): number => tags.find(t => t.tag === tag)?.data ?? fallback
      const custom = value(WA.CustomScreen, 0) >>> 0
      const slot = custom === 0 ? WB_SLOT : managedScreenSlot(rt, custom)
      if (slot === null) return
      const title = cString(rt, value(WA.Title, 0) >>> 0)
      const window = rt.intuition.openWindow({
        leftEdge: value(WA.Left, 0), topEdge: value(WA.Top, 0),
        width: value(WA.Width, 0), height: value(WA.Height, 0),
        detailPen: value(WA.DetailPen, 0), blockPen: value(WA.BlockPen, 1),
        idcmpFlags: value(WA.IDCMP, 0), flags: value(WA.Flags, 0), title,
        type: custom === 0 ? WBENCHSCREEN : CUSTOMSCREEN, ...(custom === 0 ? {} : { screenSlot: slot }),
        minWidth: value(WA.MinWidth, 1), minHeight: value(WA.MinHeight, 1),
        maxWidth: value(WA.MaxWidth, 0xffff), maxHeight: value(WA.MaxHeight, 0xffff),
      })
      if (!window || !attachWindowId(rt, st(), id, window, title)) return
      const screenTitle = cString(rt, value(WA.ScreenTitle, 0) >>> 0)
      if (screenTitle !== '') {
        const record = st().windowIds.record(id)!
        record.screenTitle = heap().fromAmos(screenTitle)
        structWrite(rt, record.base + 104, 4, record.screenTitle)
        rt.intuition.setWindowTitles(window, title, screenTitle)
      }
    },
    '_wnd id close'(it) {
      closeWindowId(rt, st(), it.evalInt())
    },
    '_wnd id use'(it) {
      const id = it.evalInt(); const handle = st().windowHandles.get(id)
      st().windowIds.use(id, handle?.rastPort ?? 0)
    },
    '_wnd id limits'(it) {
      const [minWidth, minHeight, maxWidth, maxHeight] = readArgs(it, 4); const selected = selectedWindowHandle(st())
      if (!selected) return
      rt.intuition.windowLimits(selected.window, minWidth!, minHeight!, maxWidth!, maxHeight!)
      syncWindowBase(rt, st(), selected.id)
    },
    '_wnd id move'(it) {
      const [dx, dy] = readArgs(it, 2); const selected = selectedWindowHandle(st()); if (!selected) return
      rt.intuition.moveWindow(selected.window, dx!, dy!); syncWindowBase(rt, st(), selected.id)
    },
    '_wnd id size'(it) {
      const [dx, dy] = readArgs(it, 2); const selected = selectedWindowHandle(st()); if (!selected) return
      rt.intuition.sizeWindow(selected.window, dx!, dy!); syncWindowBase(rt, st(), selected.id)
    },
    '_wnd id box'(it) {
      const [left, top, width, height] = readArgs(it, 4); const selected = selectedWindowHandle(st()); if (!selected) return
      rt.intuition.changeWindowBox(selected.window, left!, top!, width!, height!); syncWindowBase(rt, st(), selected.id)
    },
    '_wnd id titles'(it) {
      const title = it.evalStr(); it.expect(','); const screenTitle = it.evalStr(); const selected = selectedWindowHandle(st())
      if (!selected) return
      const record = st().windowIds.record(selected.id)!
      if (record.title !== 0) heap().free(record.title)
      if (record.screenTitle !== 0) heap().free(record.screenTitle)
      record.title = heap().fromAmos(title); record.screenTitle = heap().fromAmos(screenTitle)
      structWrite(rt, record.base + 32, 4, record.title); structWrite(rt, record.base + 104, 4, record.screenTitle)
      rt.intuition.setWindowTitles(selected.window, title, screenTitle)
    },
    '_wnd id activate'(it) {
      const id = it.evalInt(); const handle = st().windowHandles.get(id); if (!handle) return
      rt.intuition.activateWindow(handle.window); st().windowIds.use(id, handle.rastPort)
      syncAllWindowBases(rt, st())
    },
    '_wnd id lock'(it) {
      const id = it.evalInt(); const handle = st().windowHandles.get(id); const record = st().windowIds.record(id)
      if (handle && record?.owned0) rt.intuition.request(handle.window)
    },
    '_wnd id unlock'(it) {
      const id = it.evalInt(); const handle = st().windowHandles.get(id); const record = st().windowIds.record(id)
      if (handle && record?.owned0) rt.intuition.endRequest(handle.window)
    },
    '_req init'(it) {
      const requester = it.evalInt() >>> 0
      if (requester === 0) return
      for (let i = 0; i < 112; i++) structWrite(rt, requester + i, 1, 0)
      st().requesterWindows.delete(requester)
    },
    '_req end'(it) {
      const requester = it.evalInt() >>> 0; it.expect(','); const base = it.evalInt() >>> 0
      const window = windowAtBase(st(), base)
      if (window && st().requesterWindows.get(requester) === window) {
        rt.intuition.endRequest(window)
        st().requesterWindows.delete(requester)
      }
    },
    '_asl free'(it) {
      const requester = it.evalInt() >>> 0
      const record = st().aslRequests.get(requester)
      if (!record) return
      for (const address of record.ownedStrings) heap().free(address)
      st().aslRequests.delete(requester)
      st().memory.freeMem(requester)
    },
    '_help ctrl'(it) {
      const base = it.evalInt() >>> 0; it.expect(','); const flags = it.evalInt()
      const window = windowAtBase(st(), base)
      if (window) rt.intuition.helpControl(window, flags)
    },
    '_sp stop'() { rt.stonePlayer.stop() },
    '_sp remove'() { rt.stonePlayer.remove() },
    '_sp volume'(it) { const left = it.evalInt(); it.expect(','); const right = it.evalInt(); rt.stonePlayer.leftVolume = left; rt.stonePlayer.rightVolume = right },
    '_sp balance'(it) { const left = it.evalInt(); it.expect(','); const right = it.evalInt(); rt.stonePlayer.balance = right - left },
    '_sp speed'(it) { rt.stonePlayer.speed = it.evalInt() },
    '_sp mix'(it) { rt.stonePlayer.setMixFrequency(it.evalInt()) },
    '_fx balance'(it) { rt.stonePlayer.balance = it.evalInt() },
    /** Worker 1911: select any positive 16-bit AMOS Samples bank number. */
    '_fx bank'(it) {
      const number = it.evalInt()
      if (number <= 0 || number > 0xffff) return
      rt.samBankNum = number
    },
    /** Workers 1908/1909: AMOS Samples bank playback on an eight-bit mask. */
    '_fx play'(it, tok) {
      const mask = it.evalInt(); it.expect(','); const sampleNumber = it.evalInt()
      // The five-argument form is worker 1910's raw native callback entry.
      // Its callback must execute to choose one of the eight software channels.
      if (tok.kind === 'ext' && tok.id === 0x3daa) {
        it.expect(','); it.evalInt(); it.expect(','); it.evalInt(); it.expect(','); it.evalInt()
        return
      }
      const frequency = it.accept(',') ? it.evalInt() : null
      const sample = rt.getSample(sampleNumber)
      const hz = frequency ?? sample.freq
      if (hz <= 0) return
      rt.stonePlayer.playSample(mask & 0xff, sampleNumber, hz)
      // The shared sink is Paula-shaped. StonePlayer retains channels 4..7;
      // channels 0..3 take the normal AMOS voice/music ownership path.
      rt.samPlay(mask & 0x0f, sample.pcm, hz)
    },
    '_wnd id ink'(it) {
      const [front, back, outline] = readArgs(it, 3); const target = currentWindowTarget(rt, st())
      if (!target) return
      structWrite(rt, target.raster.rp + 25, 1, front!); structWrite(rt, target.raster.rp + 26, 1, back!)
      structWrite(rt, target.raster.rp + 27, 1, outline!)
    },
    '_wnd id gr writing'(it) { const value = it.evalInt(); const t = currentWindowTarget(rt, st()); if (t) structWrite(rt, t.raster.rp + 28, 1, value) },
    '_wnd id set line'(it) { const value = it.evalInt(); const t = currentWindowTarget(rt, st()); if (t) structWrite(rt, t.raster.rp + 34, 2, value) },
    '_wnd id plot'(it) { const [x, y] = readArgs(it, 2); withWindowRastPort(rt, st(), (rp, ox, oy) => rp.plot(ox + x!, oy + y!)) },
    '_wnd id gr locate'(it) {
      const [x, y] = readArgs(it, 2); const t = currentWindowTarget(rt, st())
      if (t) { structWrite(rt, t.raster.rp + 36, 2, x!); structWrite(rt, t.raster.rp + 38, 2, y!) }
    },
    '_wnd id line to'(it) {
      const [x, y] = readArgs(it, 2)
      withWindowRastPort(rt, st(), (rp, ox, oy) => rp.draw(rp.cpX, rp.cpY, ox + x!, oy + y!))
    },
    '_wnd id line'(it) {
      const x1 = it.evalInt(); it.expect(','); const y1 = it.evalInt(); it.expect('to'); const x2 = it.evalInt(); it.expect(','); const y2 = it.evalInt()
      withWindowRastPort(rt, st(), (rp, ox, oy) => rp.draw(ox + x1, oy + y1, ox + x2, oy + y2))
    },
    '_wnd id rect'(it) {
      const x1 = it.evalInt(); it.expect(','); const y1 = it.evalInt(); it.expect('to'); const x2 = it.evalInt(); it.expect(','); const y2 = it.evalInt()
      withWindowRastPort(rt, st(), (rp, ox, oy) => {
        rp.draw(ox + x1, oy + y1, ox + x2, oy + y1); rp.draw(ox + x2, oy + y1, ox + x2, oy + y2)
        rp.draw(ox + x2, oy + y2, ox + x1, oy + y2); rp.draw(ox + x1, oy + y2, ox + x1, oy + y1)
      })
    },
    '_wnd id ellipse'(it) { const [x, y, rx, ry] = readArgs(it, 4); withWindowRastPort(rt, st(), (rp, ox, oy) => rp.ellipse(ox + x!, oy + y!, rx!, ry!)) },
    '_wnd id cls'(it) {
      const pen = it.evalInt()
      withWindowRastPort(rt, st(), (rp, ox, oy, window) => {
        rp.rectFillReplace(ox, oy, ox + window.width - 1, oy + window.height - 1, pen)
      })
    },
    '_wnd id bar'(it) {
      const x1 = it.evalInt(); it.expect(','); const y1 = it.evalInt(); it.expect('to'); const x2 = it.evalInt(); it.expect(','); const y2 = it.evalInt()
      withWindowRastPort(rt, st(), (rp, ox, oy) => rp.areaRectFill(ox + x1, oy + y1, ox + x2, oy + y2))
    },
    '_wnd id fill ellipse'(it) {
      const [cx, cy, rx, ry] = readArgs(it, 4); if (rx! <= 0 || ry! <= 0) return
      withWindowRastPort(rt, st(), (rp, ox, oy, window) => {
        return withTemporaryRaster(st(), window.width, window.height, () => rp.ellipse(ox + cx!, oy + cy!, rx!, ry!, rp.fgPen, true))
      })
    },
    '_wnd id paint'(it) {
      const [sx, sy, mode] = readArgs(it, 3)
      withWindowRastPort(rt, st(), (rp, ox, oy, window) => {
        return withTemporaryRaster(st(), window.width, window.height, () => rp.flood(mode!, ox + sx!, oy + sy!))
      })
    },
    '_wnd id scroll'(it) {
      const x1 = it.evalInt(); it.expect(','); const y1 = it.evalInt(); it.expect('to'); const x2 = it.evalInt(); it.expect(','); const y2 = it.evalInt(); it.expect(','); const dx = it.evalInt(); it.expect(','); const dy = it.evalInt()
      withWindowRastPort(rt, st(), (rp, ox, oy) => scrollRaster(rp, dx, dy, ox + x1, oy + y1, ox + x2, oy + y2))
    },
    '_wnd id put bob'(it) {
      const [number, x, y] = readArgs(it, 3)
      const image = number! > 0 ? rt.spriteBank?.image(number!) : undefined
      if (image) withWindowRastPort(rt, st(), (rp, ox, oy) => blitToRastPort(rp, image, ox + x!, oy + y!, true))
    },
    '_wnd id text'(it) {
      const x = it.evalInt(); it.expect(','); const y = it.evalInt(); it.expect(','); const value = it.evalStr()
      withWindowRastPort(rt, st(), (rp, ox, oy) => rp.text(ox + x, oy + y, value))
    },
    '_wnd id set paint'(it) { const value = it.evalInt(); const t = currentWindowTarget(rt, st()); if (t) structWrite(rt, t.raster.rp + 32, 1, value ? 0x08 : 0) },
    '_wnd id pattern off'() { const t = currentWindowTarget(rt, st()); if (t) structWrite(rt, t.raster.rp + 8, 4, 0) },
    '_wnd id pattern on'() { const t = currentWindowTarget(rt, st()); if (t) { structWrite(rt, t.raster.rp + 8, 4, fillPatternAddress(st())); structWrite(rt, t.raster.rp + 29, 1, 3) } },
    '_wnd id set low pattern'(it) { setFillPattern(st(), false, readArgs(it, 8)) },
    '_wnd id set high pattern'(it) { setFillPattern(st(), true, readArgs(it, 8)) },
    '_wnd id set mouse pos'(it) {
      const [id, x, y] = readArgs(it, 3); const handle = st().windowHandles.get(id!)
      if (handle) setScreenMousePosition(rt, handle.window.screenSlot, handle.window.leftEdge + x!, handle.window.topEdge + y!)
    },
    '_wnd id mouse'(it) {
      const [id, number, _resolution] = readArgs(it, 3); const handle = st().windowHandles.get(id!)
      if (!handle) return
      if (number! < 0) {
        // WA_BusyPointer via SetWindowPointerA. The pointer object is owned by
        // Intuition; this stable sentinel distinguishes it from caller data.
        handle.window.setPointer(0x8000_0000, 16, 1, 0, 0)
        return
      }
      if (number === 0) { handle.window.clearPointer(); return }
      const image = rt.spriteBank?.image(number!)
      if (!image) return
      // pointerclass receives the temporary BitMap plus negative hotspots.
      // Object banks have one synthetic base, so retain the image number in
      // the otherwise opaque pointer identity exposed by struct Window.
      handle.window.setPointer(rt.bankBase(1) + number!, image.height, Math.ceil(image.width / 16), -image.hotX, -image.hotY)
    },
    '_gmn set'(it) {
      const [address, type, label, command, flags, mutualExclude, userData] = readArgs(it, 7)
      const list = st().newMenuLists.get(address! >>> 0)
      if (!list || list.cursor >= list.capacity) return
      list.entries[list.cursor++] = {
        type: type! & 0xff,
        label: label === -1 ? BARLABEL : cString(rt, label! >>> 0),
        commKey: command === 0 ? '' : cString(rt, command! >>> 0),
        flags: flags! & 0xffff, mutualExclude: mutualExclude! | 0, userData: userData! >>> 0,
      }
    },
    '_gmn end'(it) {
      const list = st().newMenuLists.get(it.evalInt() >>> 0)
      if (!list) return
      list.entries[list.cursor] = { type: NM.END, label: '' }
      list.cursor = 0
    },
    '_gmn list free'(it) {
      const address = it.evalInt() >>> 0
      if (st().newMenuLists.delete(address)) st().memory.freeMem(address - 8)
    },
    '_gmn free'(it) {
      const strip = st().gadtools.menuStrip(it.evalInt() >>> 0)
      if (strip) st().gadtools.freeMenus(strip)
    },
    '_obj free'(it) {
      const address = it.evalInt() >>> 0
      if (!st().boopsiObjects.delete(address)) return
      const object = rt.boopsi.objectAt(address)
      if (object) rt.boopsi.disposeObject(object)
    },
    'reserve as gt gadgets'(it) {
      const [number, max, screenSlot] = readArgs(it, 3)
      if (number! <= 0 || number! > 0xffff || max! < 0 || !rt.screens.has(screenSlot!)) return
      const old = st().gtGadgetBanks.get(number!)
      if (old) {
        detachGtBank(rt, st(), old); st().gadtools.freeGadgets(old.context); st().gadtools.freeVisualInfo(old.visualInfo)
      }
      rt.reserveBank(number!, max! * 16 + 32, 'GT Gads', false)
      const screen = rt.screens.get(screenSlot!)!
      const pens = Array.from(screenPens(screen.depth).pens)
      const visual = st().gadtools.getVisualInfo(screenSlot!, { numPens: pens.length, pens, depth: screen.depth })
      st().gtGadgetBanks.set(number!, {
        max: max! & 0xffff, screenSlot: screenSlot!, visualInfo: visual.address,
        context: st().gadtools.createContext(), gadgets: new Map(), objects: new Map(), attachedWindowId: -1,
      })
      st().currentGtGadgetBank = number!
    },
    '_gt gadgets bank'(it) { st().currentGtGadgetBank = it.evalInt() & 0xffff },
    '_gt gadgets remove'(it) {
      const bank = st().gtGadgetBanks.get(it.evalInt() & 0xffff); if (bank) detachGtBank(rt, st(), bank)
    },
    '_gt gadgets attach'(it) {
      const bank = st().gtGadgetBanks.get(it.evalInt() & 0xffff); const id = st().windowIds.currentId
      const window = st().windowHandles.get(id)?.window
      if (!bank || !window) return
      detachGtBank(rt, st(), bank)
      for (const gadget of bank.gadgets.values()) rt.intuition.attachWindowGadget(window, nativeGadget(st(), gadget))
      for (const object of bank.objects.values()) rt.intuition.attachWindowGadget(window, nativeBoopsiGadget(object))
      bank.attachedWindowId = id
    },
    '_gt gadgets erase'(it) {
      const number = it.evalInt() & 0xffff; const bank = st().gtGadgetBanks.get(number)
      if (!bank) return
      detachGtBank(rt, st(), bank); st().gadtools.freeGadgets(bank.context); st().gadtools.freeVisualInfo(bank.visualInfo)
      for (const object of bank.objects.values()) rt.boopsi.disposeObject(object)
      st().gtGadgetBanks.delete(number); rt.eraseBank(number)
    },
    '_gt set mode'(it) {
      const disabled = it.evalInt(); it.expect(','); const underscore = it.evalStr(); it.expect(',')
      const immediate = it.evalInt(); it.expect(','); const relVerify = it.evalInt()
      st().gtMode = {
        disabled: disabled !== 0, underscore: underscore.length === 0 ? '' : underscore[0]!,
        immediate: immediate !== 0, relVerify: relVerify !== 0,
      }
    },
    '_gt refresh wnd'(it) {
      const base = it.evalInt(); it.expect(','); it.evalInt()
      const window = windowAtBase(st(), base)
      if (window) for (const gadget of window.gadgets) rt.intuition.refreshWindowGadget(window, gadget)
    },
    '_gt begin refresh'(it) { windowAtBase(st(), it.evalInt())?.layer.beginUpdate() },
    '_gt end refresh'(it) {
      const window = windowAtBase(st(), it.evalInt()); it.expect(','); const complete = it.evalInt()
      window?.layer.endUpdate(complete !== 0)
    },
    '_gt button'(it) {
      const [id, x, y, width, height, flags] = readArgs(it, 6); it.expect(','); const text = it.evalStr()
      addGtGadget(rt, st(), id!, KIND.BUTTON, [x!, y!, width!, height!, flags!], text)
    },
    '_gt checkbox'(it) {
      const [id, x, y, width, height, flags] = readArgs(it, 6); it.expect(','); const text = it.evalStr(); it.expect(','); const checked = it.evalInt()
      addGtGadget(rt, st(), id!, KIND.CHECKBOX, [x!, y!, width!, height!, flags!], text, [{ tag: TAG.GTCB_Checked, data: checked }])
    },
    '_gt set checkbox'(it) {
      const [id, checked] = readArgs(it, 2); const bank = st().gtGadgetBanks.get(st().currentGtGadgetBank); const gadget = bank?.gadgets.get(id!)
      if (gadget?.kind !== KIND.CHECKBOX) return
      st().gadtools.setGadgetAttrs(gadget, [{ tag: TAG.GTCB_Checked, data: checked! }])
      const window = bank && st().windowHandles.get(bank.attachedWindowId)?.window
      if (window) rt.intuition.refreshWindowGadget(window, nativeGadget(st(), gadget))
    },
    '_gt cycle'(it) {
      const [id, x, y, width, height, flags] = readArgs(it, 6); it.expect(','); const text = it.evalStr()
      it.expect(','); const array = it.evalInt(); it.expect(','); const selected = it.evalInt()
      addGtGadget(rt, st(), id!, KIND.CYCLE, [x!, y!, width!, height!, flags!], text, [
        { tag: TAG.GTCY_Labels, data: st().gadtools.listRef(labelsAt(array!)) }, { tag: TAG.GTCY_Active, data: selected! },
      ])
    },
    '_gt set cycle'(it) {
      const [id, array, selected] = readArgs(it, 3)
      const gadget = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.gadgets.get(id!)
      if (gadget?.kind === KIND.CYCLE) st().gadtools.setGadgetAttrs(gadget, [
        { tag: TAG.GTCY_Labels, data: st().gadtools.listRef(labelsAt(array!)) }, { tag: TAG.GTCY_Active, data: selected! },
      ])
    },
    '_gt set listview mode'(it) {
      const [top, makeVisible, readOnly, scrollWidth, show, spacing] = readArgs(it, 6)
      st().gtListViewMode = { top: top!, makeVisible: makeVisible!, readOnly: readOnly !== 0, scrollWidth: scrollWidth!, show: show!, spacing: spacing! }
    },
    '_gt listview'(it) {
      const [id, x, y, width, height, flags] = readArgs(it, 6); it.expect(','); const text = it.evalStr()
      it.expect(','); const array = it.evalInt(); it.expect(','); const selected = it.evalInt(); const mode = st().gtListViewMode
      const gadget = addGtGadget(rt, st(), id!, KIND.LISTVIEW, [x!, y!, width!, height!, flags!], text, [
        { tag: TAG.GTLV_Labels, data: st().gadtools.listRef(labelsAt(array!)) }, { tag: TAG.GTLV_Selected, data: selected! },
        { tag: TAG.GTLV_Top, data: mode.top }, { tag: TAG.GTLV_MakeVisible, data: mode.makeVisible },
        { tag: TAG.GTLV_ReadOnly, data: mode.readOnly ? -1 : 0 }, { tag: TAG.GTLV_ScrollWidth, data: mode.scrollWidth },
        { tag: TAG.GTLV_ShowSelected, data: mode.show },
      ])
      if (gadget) gadget.spacing = mode.spacing
    },
    '_gt set listview'(it) {
      const [id, array, selected, top, makeVisible] = readArgs(it, 5)
      const gadget = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.gadgets.get(id!)
      if (gadget?.kind === KIND.LISTVIEW) st().gadtools.setGadgetAttrs(gadget, [
        { tag: TAG.GTLV_Labels, data: st().gadtools.listRef(labelsAt(array!)) }, { tag: TAG.GTLV_Selected, data: selected! },
        { tag: TAG.GTLV_Top, data: top! }, { tag: TAG.GTLV_MakeVisible, data: makeVisible! },
      ])
    },
    '_gt mx'(it) {
      const [id, x, y, width, height, flags] = readArgs(it, 6); it.expect(','); const text = it.evalStr()
      it.expect(','); const array = it.evalInt(); it.expect(','); const spacing = it.evalInt()
      addGtGadget(rt, st(), id!, KIND.MX, [x!, y!, width!, height!, flags!], text, [
        { tag: TAG.GTMX_Labels, data: st().gadtools.listRef(labelsAt(array!)) }, { tag: TAG.GTMX_Spacing, data: spacing! },
      ])
    },
    '_gt set mx'(it) {
      const [id, selected] = readArgs(it, 2)
      const gadget = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.gadgets.get(id!)
      if (gadget?.kind === KIND.MX) st().gadtools.setGadgetAttrs(gadget, [{ tag: TAG.GTMX_Active, data: selected! }])
    },
    '_gt set integer mode'(it) {
      const [tabCycle, maxChars, exitHelp, replaceMode] = readArgs(it, 4)
      st().gtIntegerMode = { tabCycle: tabCycle !== 0, maxChars: maxChars!, exitHelp: exitHelp !== 0, replaceMode: replaceMode !== 0 }
    },
    '_gt integer'(it) {
      const [id, x, y, width, height, flags] = readArgs(it, 6); it.expect(','); const text = it.evalStr()
      it.expect(','); const value = it.evalInt(); it.expect(','); it.evalInt() // justification lives in StringExtend
      addGtGadget(rt, st(), id!, KIND.INTEGER, [x!, y!, width!, height!, flags!], text, [
        { tag: TAG.GTIN_Number, data: value }, { tag: TAG.GTIN_MaxChars, data: st().gtIntegerMode.maxChars },
      ])
    },
    '_gt set integer'(it) {
      const [id, value] = readArgs(it, 2); const bank = st().gtGadgetBanks.get(st().currentGtGadgetBank); const gadget = bank?.gadgets.get(id!)
      if (gadget?.kind !== KIND.INTEGER) return
      st().gadtools.setGadgetAttrs(gadget, [{ tag: TAG.GTIN_Number, data: value! }])
    },
    '_gt set string mode'(it) {
      const [tabCycle, maxChars, exitHelp, replaceMode] = readArgs(it, 4)
      st().gtStringMode = { tabCycle: tabCycle !== 0, maxChars: maxChars!, exitHelp: exitHelp !== 0, replaceMode: replaceMode !== 0 }
    },
    '_gt string'(it) {
      const [id, x, y, width, height, flags] = readArgs(it, 6); it.expect(','); const text = it.evalStr()
      it.expect(','); const value = it.evalStr(); it.expect(','); it.evalInt() // justification belongs to StringExtend
      addGtGadget(rt, st(), id!, KIND.STRING, [x!, y!, width!, height!, flags!], text, [
        { tag: TAG.GTST_String, data: st().gadtools.stringRef(value) },
        { tag: TAG.GTST_MaxChars, data: st().gtStringMode.maxChars },
      ])
    },
    '_gt set string'(it) {
      const id = it.evalInt(); it.expect(','); const value = it.evalStr()
      const bank = st().gtGadgetBanks.get(st().currentGtGadgetBank); const gadget = bank?.gadgets.get(id)
      if (gadget?.kind !== KIND.STRING) return
      st().gadtools.setGadgetAttrs(gadget, [{ tag: TAG.GTST_String, data: st().gadtools.stringRef(value) }])
    },
    '_gt text'(it) {
      const [id, x, y, width, height, flags] = readArgs(it, 6); it.expect(','); const text = it.evalStr()
      it.expect(','); const value = it.evalStr(); it.expect(','); const border = it.evalInt()
      addGtGadget(rt, st(), id!, KIND.TEXT, [x!, y!, width!, height!, flags!], text, [
        { tag: TAG.GTTX_Text, data: st().gadtools.stringRef(value) }, { tag: TAG.GTTX_Border, data: border },
      ])
    },
    '_gt set text'(it) {
      const id = it.evalInt(); it.expect(','); const value = it.evalStr()
      it.expect(','); const frontPen = it.evalInt(); it.expect(','); const backPen = it.evalInt(); it.expect(','); const justification = it.evalInt()
      const bank = st().gtGadgetBanks.get(st().currentGtGadgetBank); const gadget = bank?.gadgets.get(id)
      if (gadget?.kind !== KIND.TEXT) return
      st().gadtools.setGadgetAttrs(gadget, [
        { tag: TAG.GTTX_Text, data: st().gadtools.stringRef(value) }, { tag: TAG.GTNM_FrontPen, data: frontPen },
        { tag: TAG.GTNM_BackPen, data: backPen }, { tag: TAG.GTNM_Justification, data: justification },
      ])
    },
    '_gt number'(it) {
      const [id, x, y, width, height, flags] = readArgs(it, 6); it.expect(','); const text = it.evalStr()
      it.expect(','); const maxChars = it.evalInt(); it.expect(','); const border = it.evalInt()
      addGtGadget(rt, st(), id!, KIND.NUMBER, [x!, y!, width!, height!, flags!], text, [
        { tag: TAG.GTNM_MaxNumberLen, data: maxChars }, { tag: TAG.GTNM_Border, data: border },
      ])
    },
    '_gt set number'(it) {
      const [id, value, frontPen, backPen, justification] = readArgs(it, 5); it.expect(','); const format = it.evalStr()
      const gadget = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.gadgets.get(id!)
      if (gadget?.kind === KIND.NUMBER) st().gadtools.setGadgetAttrs(gadget, [
        { tag: TAG.GTNM_Number, data: value! }, { tag: TAG.GTNM_FrontPen, data: frontPen! },
        { tag: TAG.GTNM_BackPen, data: backPen! }, { tag: TAG.GTNM_Justification, data: justification! },
        { tag: TAG.GTNM_Format, data: st().gadtools.stringRef(format) },
      ])
    },
    '_gt palette'(it) {
      const [id, x, y, width, height, flags] = readArgs(it, 6); it.expect(','); const text = it.evalStr()
      it.expect(','); const depth = it.evalInt(); it.expect(','); const selected = it.evalInt()
      addGtGadget(rt, st(), id!, KIND.PALETTE, [x!, y!, width!, height!, flags!], text, [
        { tag: TAG.GTPA_Depth, data: depth! }, { tag: TAG.GTPA_Color, data: selected! },
      ])
    },
    '_gt set palette'(it) {
      const [id, color, offset, colorTable] = readArgs(it, 4)
      const gadget = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.gadgets.get(id!)
      if (gadget?.kind === KIND.PALETTE) st().gadtools.setGadgetAttrs(gadget, [
        { tag: TAG.GTPA_Color, data: color! }, { tag: TAG.GTPA_ColorOffset, data: offset! }, { tag: TAG.GTPA_ColorTable, data: colorTable! },
      ])
    },
    '_gt h scroller'(it) { addScroller(it, true) },
    '_gt v scroller'(it) { addScroller(it, false) },
    '_gt set scroller'(it) {
      const [id, top, visible, total] = readArgs(it, 4)
      const gadget = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.gadgets.get(id!)
      if (gadget?.kind === KIND.SCROLLER) st().gadtools.setGadgetAttrs(gadget, [
        { tag: TAG.GTSC_Top, data: top! }, { tag: TAG.GTSC_Visible, data: visible! }, { tag: TAG.GTSC_Total, data: total! },
      ])
    },
    '_gt h slider'(it) { addSlider(it, true) },
    '_gt v slider'(it) { addSlider(it, false) },
    '_gt set slider'(it) {
      const [id, level, min, max, justification] = readArgs(it, 5); it.expect(','); const format = it.evalStr()
      const gadget = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.gadgets.get(id!)
      if (gadget?.kind === KIND.SLIDER) st().gadtools.setGadgetAttrs(gadget, [
        { tag: TAG.GTSL_Level, data: level! }, { tag: TAG.GTSL_Min, data: min! }, { tag: TAG.GTSL_Max, data: max! },
        { tag: TAG.GTSL_Justification, data: justification! }, { tag: TAG.GTSL_LevelFormat, data: st().gadtools.stringRef(format) },
      ])
    },
    '_gt disable'(it) {
      const gadget = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.gadgets.get(it.evalInt())
      if (!gadget) return
      gadget.disabled = true; nativeGadget(st(), gadget).flags = (nativeGadget(st(), gadget).flags ?? 0) | GFLG_GADGDISABLED
    },
    '_gt enable'(it) {
      const gadget = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.gadgets.get(it.evalInt())
      if (!gadget) return
      gadget.disabled = false; nativeGadget(st(), gadget).flags = (nativeGadget(st(), gadget).flags ?? 0) & ~GFLG_GADGDISABLED
    },
    '_gt activate'(it) {
      const bank = st().gtGadgetBanks.get(st().currentGtGadgetBank); const gadget = bank?.gadgets.get(it.evalInt())
      const window = bank && st().windowHandles.get(bank.attachedWindowId)?.window
      if (gadget && window) rt.intuition.activateGadget(window, nativeGadget(st(), gadget))
    },
    '_gt refresh'(it) {
      const bank = st().gtGadgetBanks.get(st().currentGtGadgetBank); const gadget = bank?.gadgets.get(it.evalInt())
      const window = bank && st().windowHandles.get(bank.attachedWindowId)?.window
      if (gadget && window) rt.intuition.refreshWindowGadget(window, nativeGadget(st(), gadget))
    },
    '_gt boopsi'(it) {
      const id = it.evalInt(); it.expect(','); const privateClass = it.evalInt(); it.expect(','); const publicClass = it.evalStr(); it.expect(','); const tags = it.evalInt()
      const bank = st().gtGadgetBanks.get(st().currentGtGadgetBank)
      if (!bank || id < 0 || id >= bank.max || bank.gadgets.has(id) || bank.objects.has(id)) return
      // Private class pointers cannot exist until a library backend registers
      // their native addresses. Public classes use the shared registry now.
      if (privateClass !== 0 || publicClass === '') return
      const object = rt.boopsi.newObjectA(publicClass, tagItems(st(), tags))
      if (!object) return
      bank.objects.set(id, object)
      const window = st().windowHandles.get(bank.attachedWindowId)?.window
      if (window) rt.intuition.attachWindowGadget(window, nativeBoopsiGadget(object))
    },
    '_gt image'(it) {
      const [id, x, y, flags, normal, selected] = readArgs(it, 6)
      const first = ieReadImage(rt, normal!); const second = ieReadImage(rt, selected!)
      if (!first) return
      const gadget = addGtGadget(rt, st(), id!, KIND.BUTTON, [x!, y!, first.width, first.height, flags!], '')
      if (gadget) Object.assign(gadget, { imageAddress: normal, selectImageAddress: selected, image: first, selectImage: second ?? first })
    },
    '_gt set image'(it) {
      const [id, normal, selected] = readArgs(it, 3)
      const gadget = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.gadgets.get(id!)
      const first = ieReadImage(rt, normal!); const second = ieReadImage(rt, selected!)
      if (!gadget || !first) return
      Object.assign(gadget, { width: first.width, height: first.height, imageAddress: normal, selectImageAddress: selected, image: first, selectImage: second ?? first })
      nativeGadget(st(), gadget)
    },
    '_gt bob'(it) {
      const [id, x, y, flags, normalBob, selectedBob] = readArgs(it, 6)
      const normal = makeGtImage(rt, st(), normalBob!); const selected = makeGtImage(rt, st(), selectedBob!)
      if (normal === 0) return
      const first = ieReadImage(rt, normal)!; const gadget = addGtGadget(rt, st(), id!, KIND.BUTTON, [x!, y!, first.width, first.height, flags!], '')
      if (gadget) Object.assign(gadget, { imageAddress: normal, selectImageAddress: selected, image: first, selectImage: ieReadImage(rt, selected) ?? first })
    },
    '_gt set bob'(it) {
      const [id, normalBob, selectedBob] = readArgs(it, 3)
      const gadget = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.gadgets.get(id!)
      if (!gadget) return
      const normal = makeGtImage(rt, st(), normalBob!); const selected = makeGtImage(rt, st(), selectedBob!); const first = ieReadImage(rt, normal)
      if (!first) return
      Object.assign(gadget, { width: first.width, height: first.height, imageAddress: normal, selectImageAddress: selected, image: first, selectImage: ieReadImage(rt, selected) ?? first })
      nativeGadget(st(), gadget)
    },
    '_gt set attrs'(it) {
      const [id, tags] = readArgs(it, 2); const object = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.objects.get(id!)
      if (object) setAttrsA(object, tagItems(st(), tags!))
    },
    '_gt free array'(it) {
      const address = it.evalInt() >>> 0; const strings = st().gtArrays.get(address)
      if (!strings) return
      freeGtStrings(st(), strings); st().gtArrays.delete(address); st().memory.freeMem(address)
    },
    '_gt free list'(it) {
      const address = it.evalInt() >>> 0; const allocations = st().gtLists.get(address)
      if (!allocations) return
      for (const allocation of allocations) st().exec.memory.free(allocation)
      st().gtLists.delete(address); st().exec.memory.free(address)
    },
    '_gt bevel box'(it) {
      const [type, x, y, width, height, recessed] = readArgs(it, 6)
      const visualInfo = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.visualInfo ?? 0
      withWindowRastPort(rt, st(), (rp, ox, oy) => st().gadtools.drawBevelBoxA(rp, ox + x!, oy + y!, width!, height!, [
        { tag: GTBB_FRAMETYPE, data: type! }, { tag: GTBB_RECESSED, data: recessed! }, { tag: TAG.GT_VisualInfo, data: visualInfo },
      ]))
    },
    'reserve as gt menus'(it) {
      const [number, max, screenSlot] = readArgs(it, 3)
      if (number! <= 0 || max! < 0 || !rt.screens.has(screenSlot!)) return
      const old = st().gtMenuBanks.get(number!); if (old?.strip) st().gadtools.freeMenus(old.strip)
      if (old) st().gadtools.freeVisualInfo(old.visualInfo)
      rt.reserveBank(number!, max! * 20 + 32, 'GT Menus', false)
      const screen = rt.screens.get(screenSlot!)!; const pens = Array.from(screenPens(screen.depth).pens)
      const visualInfo = st().gadtools.getVisualInfo(screenSlot!, { numPens: pens.length, pens, depth: screen.depth }).address
      st().gtMenuBanks.set(number!, { max: max!, screenSlot: screenSlot!, visualInfo, entries: [], strip: null }); st().currentGtMenuBank = number!
    },
    '_gt menus bank'(it) { st().currentGtMenuBank = it.evalInt() },
    '_gt menus erase'(it) {
      const number = it.evalInt(); const bank = st().gtMenuBanks.get(number)
      if (!bank) return
      if (bank.strip) st().gadtools.freeMenus(bank.strip); st().gadtools.freeVisualInfo(bank.visualInfo)
      st().gtMenuBanks.delete(number); rt.eraseBank(number)
    },
    '_gt menus attach'(it) {
      const number = it.evalInt(); const window = st().windowHandles.get(st().windowIds.currentId)?.window
      if (!window) return
      if (number === 0) { window.clearMenuStrip(); syncAllWindowBases(rt, st()); return }
      const bank = st().gtMenuBanks.get(number); const strip = bank?.strip ?? (bank ? rebuildGtMenu(st(), bank) : null)
      if (strip) { window.setMenuStrip(strip.address); syncAllWindowBases(rt, st()) }
    },
    '_gt add menu'(it) {
      const label = it.evalStr(); it.expect(','); addGtMenuEntry({ type: NM.TITLE, label, flags: it.evalInt() })
    },
    '_gt add item'(it) {
      const label = menuLabel(it); it.expect(','); const key = it.evalStr(); it.expect(','); const flags = it.evalInt(); it.expect(','); const mutex = it.evalInt()
      addGtMenuEntry({ type: NM.ITEM, label, commKey: key, flags, mutualExclude: mutex })
    },
    '_gt add sub'(it) {
      const label = menuLabel(it); it.expect(','); const key = it.evalStr(); it.expect(','); const flags = it.evalInt(); it.expect(','); const mutex = it.evalInt()
      addGtMenuEntry({ type: NM.SUB, label, commKey: key, flags, mutualExclude: mutex })
    },
    '_gt add image item'(it) { addGtImageMenu(it, NM.IM_ITEM, false) },
    '_gt add image sub'(it) { addGtImageMenu(it, NM.IM_SUB, false) },
    '_gt add bob item'(it) { addGtImageMenu(it, NM.IM_ITEM, true) },
    '_gt add bob sub'(it) { addGtImageMenu(it, NM.IM_SUB, true) },
    '_gt menu on'(it) { changeGtMenu(it, 'on') },
    '_gt menu off'(it) { changeGtMenu(it, 'off') },
    '_gt menu set check'(it) { changeGtMenu(it, 'check') },
    '_gt menu clear check'(it) { changeGtMenu(it, 'clear') },
    '_menu set'(it) {
      const [base, address] = readArgs(it, 2); const window = windowAtBase(st(), base!); const strip = st().gadtools.menuStrip(address! >>> 0)
      if (window && strip) { window.setMenuStrip(strip.address); syncAllWindowBases(rt, st()) }
    },
    '_menu clear'(it) {
      const window = windowAtBase(st(), it.evalInt()); if (window) { window.clearMenuStrip(); syncAllWindowBases(rt, st()) }
    },
    '_menu share'(it) {
      const base = it.evalInt(); it.expect('to'); const address = it.evalInt()
      const window = windowAtBase(st(), base); const strip = st().gadtools.menuStrip(address >>> 0)
      if (window && strip) { window.setMenuStrip(strip.address); syncAllWindowBases(rt, st()) }
    },
    '_menu off'(it) {
      const [base, number] = readArgs(it, 2); const window = windowAtBase(st(), base!); const strip = window ? st().gadtools.menuStrip(window.menuStrip) : null
      if (strip) st().gadtools.offMenu(strip, number!)
    },
    '_menu on'(it) {
      const [base, number] = readArgs(it, 2); const window = windowAtBase(st(), base!); const strip = window ? st().gadtools.menuStrip(window.menuStrip) : null
      if (strip) st().gadtools.onMenu(strip, number!)
    },
  }
}

export function makeOsDevKitFunctions(rt: Runtime): Record<string, Func> {
  const st = (): OsDevKitState => rt.osdevkit
  const heap = (): OsCStringHeap => rt.osdevkit.strings
  const n = (a: Parameters<Func>[1], at: number): number => int(a[at] ?? VI(0))
  return {
    'track exist'(_, a) { return VI(st().tracker.find(n(a, 0), n(a, 1))) },
    '_wnd open'(_, a) {
      const definition = a.length === 1 ? n(a, 0) >>> 0 : windowDefinitionAddress(st())
      if (definition === 0) return VI(0)
      const spec = rawWindowSpec(rt, definition)
      if (a.length === 4) {
        spec.left = n(a, 0); spec.top = n(a, 1); spec.width = n(a, 2); spec.height = n(a, 3)
      } else if (a.length === 7) {
        spec.screenAddress = n(a, 0) >>> 0; spec.type = spec.screenAddress === 0 ? WBENCHSCREEN : CUSTOMSCREEN
        spec.left = n(a, 1); spec.top = n(a, 2); spec.width = n(a, 3); spec.height = n(a, 4)
        spec.flags = n(a, 5); spec.idcmp = n(a, 6)
      }
      return VI(openRawWindow(rt, st(), spec))
    },
    '_wnd tag open'(_, a) {
      const definition = a.length > 1 && (n(a, 0) >>> 0) !== 0x8000_0000 ? n(a, 0) >>> 0 : windowDefinitionAddress(st())
      if (definition === 0) return VI(0)
      const spec = rawWindowSpec(rt, definition); const tags = tagItems(st(), n(a, a.length - 1))
      const value = (tag: number, fallback: number): number => tags.find(item => item.tag === tag)?.data ?? fallback
      spec.left = value(WA.Left, spec.left); spec.top = value(WA.Top, spec.top)
      spec.width = value(WA.Width, spec.width); spec.height = value(WA.Height, spec.height)
      spec.detailPen = value(WA.DetailPen, spec.detailPen); spec.blockPen = value(WA.BlockPen, spec.blockPen)
      spec.idcmp = value(WA.IDCMP, spec.idcmp); spec.flags = value(WA.Flags, spec.flags)
      spec.titleAddress = value(WA.Title, spec.titleAddress); spec.screenAddress = value(WA.CustomScreen, spec.screenAddress)
      spec.type = spec.screenAddress === 0 ? WBENCHSCREEN : CUSTOMSCREEN
      spec.minWidth = value(WA.MinWidth, spec.minWidth); spec.minHeight = value(WA.MinHeight, spec.minHeight)
      spec.maxWidth = value(WA.MaxWidth, spec.maxWidth); spec.maxHeight = value(WA.MaxHeight, spec.maxHeight)
      return VI(openRawWindow(rt, st(), spec))
    },
    '_dos day$'() {
      return VS(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][nowCivil(rt).weekday]!)
    },
    '_dos date$'(_, a) {
      const date = nowCivil(rt); const dd = String(date.day).padStart(2, '0'); const mm = String(date.month).padStart(2, '0')
      const yy = String(date.year % 100).padStart(2, '0'); const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.month - 1]!
      const value = n(a, 0)
      return VS(value === 1 ? `${yy}-${mm}-${dd}` : value === 2 ? `${mm}-${dd}-${yy}` : value === 3 ? `${dd}-${mm}-${yy}` : `${dd}-${month}-${yy}`)
    },
    '_dos time$'() {
      const date = nowCivil(rt); const two = (value: number): string => String(value).padStart(2, '0')
      return VS(`${two(date.hour)}:${two(date.min)}:${two(date.sec)}`)
    },
    '_scr what front'() {
      const slot = rt.order[rt.order.length - 1]
      return VI(slot === undefined ? 0 : (SCREEN_CTRL_BASE + slot * SCREEN_CTRL_SLOT) >>> 0)
    },
    '_sys view'() { return VI(st().activeView || systemViewAddress(rt, st())) },
    '_cop vbeam pos'() { return VI(rt.interp.beamLine()) },
    '_scr what active'() {
      const slot = rt.intuition.activeWindow?.screenSlot ?? rt.order[rt.order.length - 1]
      return VI(slot === undefined ? 0 : (SCREEN_CTRL_BASE + slot * SCREEN_CTRL_SLOT) >>> 0)
    },
    '_scr what vport'(_, a) { return VI(screenRecordAtBase(st(), n(a, 0))?.record.viewPort ?? 0) },
    '_scr what rport'(_, a) { return VI(screenRecordAtBase(st(), n(a, 0))?.record.rastPort ?? 0) },
    '_query overscan'(_, a) {
      const mode = displayModeOf(n(a, 0) >>> 0); const rect = n(a, 1) >>> 0; const type = n(a, 2)
      if (!mode || rect === 0 || type < 1 || type > 4) return VI(0)
      structWrite(rt, rect, 2, 0); structWrite(rt, rect + 2, 2, 0)
      structWrite(rt, rect + 4, 2, mode.width - 1); structWrite(rt, rect + 6, 2, mode.height - 1)
      return VI(-1)
    },
    '_scale div'(_, a) {
      const denominator = n(a, 2) & 0xffff
      return VI(denominator === 0 ? 0 : Math.floor((n(a, 0) & 0xffff) * (n(a, 1) & 0xffff) / denominator))
    },
    '_pen find'(_, a) { return VI(findColor(st().colorMaps.get(n(a, 0) >>> 0) ?? null, n(a, 1), n(a, 2), n(a, 3), n(a, 4))) },
    '_pen obtain best'(_, a) { return VI(obtainBestPen(st().colorMaps.get(n(a, 0) >>> 0) ?? null, n(a, 1), n(a, 2), n(a, 3))) },
    '_pen obtain'(_, a) { return VI(obtainPen(st().colorMaps.get(n(a, 0) >>> 0) ?? null, n(a, 1), n(a, 2), n(a, 3), n(a, 4), n(a, 5))) },
    '_it what front pen'(_, a) { return VI(structRead(rt, n(a, 0), 1, false)) },
    '_it what back pen'(_, a) { return VI(structRead(rt, n(a, 0) + 1, 1, false)) },
    '_it what draw mode'(_, a) { return VI(structRead(rt, n(a, 0) + 2, 1, false)) },
    '_it what left'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 2, true)) },
    '_it what top'(_, a) { return VI(structRead(rt, n(a, 0) + 6, 2, true)) },
    '_it what font'(_, a) { return VI(structRead(rt, n(a, 0) + 8, 4, false)) },
    '_it what str'(_, a) { return VI(structRead(rt, n(a, 0) + 12, 4, false)) },
    '_it what next'(_, a) { return VI(structRead(rt, n(a, 0) + 16, 4, false)) },
    '_it what len'(_, a) {
      const text = n(a, 0); const value = cString(rt, structRead(rt, text + 12, 4, false))
      const attr = textAttr(rt, st(), structRead(rt, text + 8, 4, false))
      const held = attr ? [...st().fonts.values()].find(({ font }) => font.name.toLowerCase() === attr.name.toLowerCase() && font.ySize === attr.ySize) : undefined
      return VI(held ? [...value].reduce((width, ch) => width + glyphMetrics(held.font, ch.charCodeAt(0)).advance, 0) : value.length * 8)
    },
    '_gad activate'(_, a) {
      const gadget = nativeGadgetAt(rt, st(), n(a, 0)); const window = windowAtBase(st(), n(a, 1))
      return VI(gadget && window && rt.intuition.activateGadget(window, gadget) ? -1 : 0)
    },
    '_gad add'(_, a) {
      const first = n(a, 0); const window = windowAtBase(st(), n(a, 1)); const position = n(a, 3); const count = n(a, 4)
      return VI(window ? rt.intuition.addWindowGadgets(window, nativeGadgetList(rt, st(), first, count), position) : -1)
    },
    '_gad remove'(_, a) {
      const gadget = nativeGadgetAt(rt, st(), n(a, 0)); const window = windowAtBase(st(), n(a, 1))
      return VI(gadget && window ? rt.intuition.removeWindowGadgets(window, gadget, n(a, 2)) : -1)
    },
    '_gad what next'(_, a) { return VI(structRead(rt, n(a, 0), 4, false)) },
    '_gad what left'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 2, false)) },
    '_gad what top'(_, a) { return VI(structRead(rt, n(a, 0) + 6, 2, false)) },
    '_gad what width'(_, a) { return VI(structRead(rt, n(a, 0) + 8, 2, false)) },
    '_gad what height'(_, a) { return VI(structRead(rt, n(a, 0) + 10, 2, false)) },
    '_gad what flags'(_, a) { return VI(structRead(rt, n(a, 0) + 12, 2, false)) },
    '_gad what activation'(_, a) { return VI(structRead(rt, n(a, 0) + 14, 2, false)) },
    '_gad what type'(_, a) { return VI(structRead(rt, n(a, 0) + 16, 2, false)) },
    '_gad what render'(_, a) { return VI(structRead(rt, n(a, 0) + 18, 4, false)) },
    '_gad what h render'(_, a) { return VI(structRead(rt, n(a, 0) + 22, 4, false)) },
    '_gad what text'(_, a) { return VI(structRead(rt, n(a, 0) + 26, 4, false)) },
    '_gad what spec info'(_, a) { return VI(structRead(rt, n(a, 0) + 34, 4, false)) },
    '_gad what user id'(_, a) { return VI(structRead(rt, n(a, 0) + 38, 2, false)) },
    '_gad what user data'(_, a) { return VI(structRead(rt, n(a, 0) + 40, 4, false)) },
    '_scr what next'(_, a) { return VI(structRead(rt, n(a, 0), 4, false)) },
    '_scr what title'(_, a) { return VI(structRead(rt, n(a, 0) + 22, 4, false)) },
    '_scr what def title'(_, a) { return VI(structRead(rt, n(a, 0) + 26, 4, false)) },
    '_scr what bmap'(_, a) { return VI((n(a, 0) + 184) >>> 0) },
    '_scr what first wnd'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 4, false)) },
    '_scr what font'(_, a) { return VI(structRead(rt, n(a, 0) + 40, 4, false)) },
    '_scr what layer'(_, a) { return VI(structRead(rt, n(a, 0) + 334, 4, false)) },
    '_scr what width'(_, a) { return VI(structRead(rt, n(a, 0) + 12, 2, false)) },
    '_scr what height'(_, a) { return VI(structRead(rt, n(a, 0) + 14, 2, false)) },
    '_scr what depth'(_, a) { return VI(structRead(rt, n(a, 0) + 189, 1, false)) },
    '_scr what d pen'(_, a) { return VI(structRead(rt, n(a, 0) + 330, 1, false)) },
    '_scr what b pen'(_, a) { return VI(structRead(rt, n(a, 0) + 331, 1, false)) },
    '_scr what x mouse'(_, a) { return VI(structRead(rt, n(a, 0) + 18, 2, true)) },
    '_scr what y mouse'(_, a) { return VI(structRead(rt, n(a, 0) + 16, 2, true)) },
    '_scr what barh'(_, a) { return VI(structRead(rt, n(a, 0) + 30, 1, false)) },
    '_scr what vmodes'(_, a) { return VI(structRead(rt, n(a, 0) + 76, 2, false)) },
    '_scr what type'(_, a) { return VI(structRead(rt, n(a, 0) + 20, 2, false)) },
    '_scr wdef title'() { return VI(structRead(rt, screenDefinitionAddress(st()) + 20, 4, false)) },
    '_scr wdef bmap'() { return VI(structRead(rt, screenDefinitionAddress(st()) + 28, 4, false)) },
    '_scr wdef vmodes'() { return VI(structRead(rt, screenDefinitionAddress(st()) + 12, 2, false)) },
    '_scr wdef type'() { return VI(structRead(rt, screenDefinitionAddress(st()) + 14, 2, false)) },
    '_scr wdef font'() { return VI(structRead(rt, screenDefinitionAddress(st()) + 16, 4, false)) },
    '_wnd what front'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 4, false)) },
    '_wnd what next'(_, a) { return VI(structRead(rt, n(a, 0), 4, false)) },
    '_wnd what title'(_, a) { return VI(structRead(rt, n(a, 0) + 32, 4, false)) },
    '_wnd what scr title'(_, a) { return VI(structRead(rt, n(a, 0) + 104, 4, false)) },
    '_wnd what scr'(_, a) { return VI(structRead(rt, n(a, 0) + 46, 4, false)) },
    '_wnd what rport'(_, a) { return VI(structRead(rt, n(a, 0) + 50, 4, false)) },
    '_wnd what left'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 2, false)) },
    '_wnd what top'(_, a) { return VI(structRead(rt, n(a, 0) + 6, 2, false)) },
    '_wnd what width'(_, a) { return VI(structRead(rt, n(a, 0) + 8, 2, false)) },
    '_wnd what height'(_, a) { return VI(structRead(rt, n(a, 0) + 10, 2, false)) },
    '_wnd what x mouse'(_, a) { return VI(structRead(rt, n(a, 0) + 14, 2, true)) },
    '_wnd what y mouse'(_, a) { return VI(structRead(rt, n(a, 0) + 12, 2, true)) },
    '_wnd what min width'(_, a) { return VI(structRead(rt, n(a, 0) + 16, 2, false)) },
    '_wnd what min height'(_, a) { return VI(structRead(rt, n(a, 0) + 18, 2, false)) },
    '_wnd what max width'(_, a) { return VI(structRead(rt, n(a, 0) + 20, 2, false)) },
    '_wnd what max height'(_, a) { return VI(structRead(rt, n(a, 0) + 22, 2, false)) },
    '_wnd what flags'(_, a) { return VI(structRead(rt, n(a, 0) + 24, 4, false)) },
    '_wnd what menu'(_, a) { return VI(structRead(rt, n(a, 0) + 28, 4, false)) },
    '_wnd what first req'(_, a) { return VI(structRead(rt, n(a, 0) + 36, 4, false)) },
    '_wnd what dm req'(_, a) { return VI(structRead(rt, n(a, 0) + 40, 4, false)) },
    '_wnd what count req'(_, a) { return VI(structRead(rt, n(a, 0) + 44, 2, false)) },
    '_wnd what bdr left'(_, a) { return VI(structRead(rt, n(a, 0) + 54, 1, false)) },
    '_wnd what bdr top'(_, a) { return VI(structRead(rt, n(a, 0) + 55, 1, false)) },
    '_wnd what bdr right'(_, a) { return VI(structRead(rt, n(a, 0) + 56, 1, false)) },
    '_wnd what bdr bottom'(_, a) { return VI(structRead(rt, n(a, 0) + 57, 1, false)) },
    '_wnd what first gad'(_, a) { return VI(structRead(rt, n(a, 0) + 62, 4, false)) },
    '_wnd what parent'(_, a) { return VI(structRead(rt, n(a, 0) + 66, 4, false)) },
    '_wnd what descendant'(_, a) { return VI(structRead(rt, n(a, 0) + 70, 4, false)) },
    '_wnd what pointer height'(_, a) { return VI(structRead(rt, n(a, 0) + 78, 1, false)) },
    '_wnd what pointer width'(_, a) { return VI(structRead(rt, n(a, 0) + 79, 1, false)) },
    '_wnd what pointer xoff'(_, a) { return VI(structRead(rt, n(a, 0) + 80, 1, false)) },
    '_wnd what pointer yoff'(_, a) { return VI(structRead(rt, n(a, 0) + 81, 1, false)) },
    '_wnd what idcmp'(_, a) { return VI(structRead(rt, n(a, 0) + 82, 4, false)) },
    '_wnd what user port'(_, a) { return VI(structRead(rt, n(a, 0) + 86, 4, false)) },
    '_wnd what port'(_, a) { return VI(structRead(rt, n(a, 0) + 90, 4, false)) },
    '_wnd what int msg'(_, a) { return VI(structRead(rt, n(a, 0) + 94, 4, false)) },
    '_wnd what d pen'(_, a) { return VI(structRead(rt, n(a, 0) + 98, 1, false)) },
    '_wnd what b pen'(_, a) { return VI(structRead(rt, n(a, 0) + 99, 1, false)) },
    '_wnd what image'(_, a) { return VI(structRead(rt, n(a, 0) + 100, 4, false)) },
    '_wnd what user data'(_, a) { return VI(structRead(rt, n(a, 0) + 120, 4, false)) },
    '_wnd what ext data'(_, a) { return VI(structRead(rt, n(a, 0) + 116, 4, false)) },
    '_wnd what layer'(_, a) { return VI(structRead(rt, n(a, 0) + 124, 4, false)) },
    '_wnd what font'(_, a) { return VI(structRead(rt, n(a, 0) + 128, 4, false)) },
    '_wnd what active'() { return VI(windowBase(st(), rt.intuition.activeWindow)) },
    '_wnd what pointer'(_, a) { return VI(windowAtBase(st(), n(a, 0))?.pointer?.data ?? 0) },
    '_wnd what vport'(_, a) { return VI(windowViewPort(st(), windowAtBase(st(), n(a, 0)))) },
    '_wnd wait port'(_, a) {
      const base = n(a, 0) >>> 0; const window = windowAtBase(st(), base)
      return VI(window ? takeWindowEvent(st(), n(a, 1), base, window.userPort) : 0)
    },
    '_event wait port'(_, a) { return VI(takeWindowEvent(st(), n(a, 1), 0, n(a, 0) >>> 0)) },
    '_wnd wdef left'() { return VI(structRead(rt, windowDefinitionAddress(st()), 2, false)) },
    '_wnd wdef top'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 2, 2, false)) },
    '_wnd wdef width'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 4, 2, false)) },
    '_wnd wdef height'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 6, 2, false)) },
    '_wnd wdef d pen'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 8, 1, false)) },
    '_wnd wdef b pen'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 9, 1, false)) },
    '_wnd wdef idcmp'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 10, 4, false)) },
    '_wnd wdef flags'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 14, 4, false)) },
    '_wnd wdef gad'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 18, 4, false)) },
    '_wnd wdef image'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 22, 4, false)) },
    '_wnd wdef title'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 26, 4, false)) },
    '_wnd wdef scr'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 30, 4, false)) },
    '_wnd wdef min width'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 38, 2, false)) },
    '_wnd wdef min height'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 40, 2, false)) },
    '_wnd wdef max width'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 42, 2, false)) },
    '_wnd wdef max height'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 44, 2, false)) },
    '_wnd wdef type'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 46, 2, false)) },
    '_wnd wdef bmap'() { return VI(structRead(rt, windowDefinitionAddress(st()) + 34, 4, false)) },
    '_disp info find'(_, a) {
      const id = n(a, 0) >>> 0
      if (!displayModeOf(id)) return VI(0)
      let handle = st().displayInfoHandles.get(id)
      if (handle === undefined) {
        handle = st().memory.alloc(4, { clear: true }); if (handle !== 0) structWrite(rt, handle, 4, id)
        st().displayInfoHandles.set(id, handle)
      }
      return VI(handle)
    },
    '_lib version'(_, a) { return VI(libraryVersion(n(a, 0))) },
    '_lib revision'(_, a) { return VI(libraryRevision(n(a, 0))) },
    '_cache ctrl'(_, a) { return VI(rt.machine.cpu.cacheControl(n(a, 0), n(a, 1))) },
    '_chip set rev'(_, a) { const old = st().chipRevision; const requested = n(a, 0); st().chipRevision = requested === -1 ? 0xf : requested & 0xf; return VI(old) },
    '_vp get mode'(_, a) { return VI(structRead(rt, n(a, 0) + 32, 2, false)) },
    '_dreg'(_, a) { const register = n(a, 0); return VI(register >= 0 && register < 8 ? st().dataRegisters[register]! : 0) },
    '_areg'(_, a) { const register = n(a, 0); return VI(register >= 0 && register < 8 ? st().addressRegisters[register]! : 0) },
    '_mem avail'(_, a) {
      const own = st().memory.usage(); const used = rt.memoryInUse()
      return VI(availMem(A1200_POOLS, { chip: own.chip + used.chip, fast: own.fast + used.fast }, n(a, 0)))
    },
    '_mem type'(_, a) {
      const address = n(a, 0) >>> 0; const own = st().memory.typeOfMem(address)
      if (address >= st().memory.base && address < st().memory.base + st().memory.reserved) return VI(own)
      return VI(rt.resolveAddr(address) ? MEMF.PUBLIC | MEMF.FAST : 0)
    },
    '_pool create'(_, a) {
      const handle = st().memory.alloc(16, { clear: true })
      if (handle !== 0) st().pools.set(handle, {
        requirements: n(a, 0), puddleSize: n(a, 1) >>> 0, thresholdSize: n(a, 2) >>> 0, allocations: new Set(),
      })
      return VI(handle)
    },
    '_pool alloc'(_, a) {
      const pool = st().pools.get(n(a, 0) >>> 0); if (!pool) return VI(0)
      const address = st().memory.alloc(n(a, 1), {
        clear: (pool.requirements & MEMF.CLEAR) !== 0, chip: (pool.requirements & MEMF.CHIP) !== 0,
      })
      if (address !== 0) pool.allocations.add(address)
      return VI(address)
    },
    '_bm alloc'(_, a) {
      const width = n(a, 0), height = n(a, 1), depth = n(a, 2), flags = n(a, 3)
      if (width <= 0 || height <= 0 || depth <= 0 || depth > 8) return VI(0)
      const bitmap = st().memory.alloc(40, { clear: true }); if (bitmap === 0) return VI(0)
      const rowBytes = Math.ceil(width / 16) * 2; const ownedPlanes: number[] = []
      for (let plane = 0; plane < depth; plane++) {
        const address = st().memory.alloc(rowBytes * height, { clear: (flags & 1) !== 0, chip: true })
        if (address === 0) {
          for (const owned of ownedPlanes) st().memory.freeMem(owned)
          st().memory.freeMem(bitmap); return VI(0)
        }
        ownedPlanes.push(address); structWrite(rt, bitmap + 8 + plane * 4, 4, address)
      }
      structWrite(rt, bitmap, 2, rowBytes); structWrite(rt, bitmap + 2, 2, height)
      structWrite(rt, bitmap + 4, 1, flags); structWrite(rt, bitmap + 5, 1, depth)
      st().bitMaps.set(bitmap, { width, flags, ownedPlanes }); return VI(bitmap)
    },
    '_bm what attr'(_, a) {
      const address = n(a, 0), attribute = n(a, 1), bitmap = st().bitMaps.get(address >>> 0)
      if (attribute === 0) return VI(structRead(rt, address + 2, 2, false))
      if (attribute === 4) return VI(structRead(rt, address + 5, 1, false))
      if (attribute === 8) return VI(bitmap?.width ?? structRead(rt, address, 2, false) * 8)
      if (attribute === 12) return VI(bitmap?.flags ?? structRead(rt, address + 4, 1, false))
      return VI(0)
    },
    '_spr get'(_, a) {
      const sprite = n(a, 0) >>> 0; const requested = n(a, 1)
      const number = requested === -1 ? st().hardwareSprites.findIndex((entry) => entry === null) : requested
      if (sprite === 0 || number < 0 || number >= 8 || st().hardwareSprites[number] !== null) return VI(-1)
      st().hardwareSprites[number] = { sprite, data: structRead(rt, sprite, 4, false), viewPort: 0 }
      structWrite(rt, sprite + 10, 2, number); return VI(number)
    },
    '_loc init'() { return VI(openLibrary('locale.library', 36) === 0 ? 0 : -1) },
    '_loc open'(_, a) {
      // The reproducible machine locale is the built-in English locale. A
      // named .language backend is intentionally left to the partial verdict.
      if (n(a, 0) !== 0) return VI(0)
      const handle = st().memory.alloc(132, { clear: true })
      if (handle !== 0) st().locales.set(handle, new Map())
      return VI(handle)
    },
    '_loc str'(_, a) {
      const handle = n(a, 0) >>> 0; const id = n(a, 1); const locale = st().locales.get(handle)
      if (!locale) return VI(0)
      let pointer = locale.get(id)
      if (pointer === undefined) { pointer = heap().fromAmos(getLocaleStr(id)); locale.set(id, pointer) }
      return VI(pointer)
    },
    '_cat open'(_, a) {
      if (!st().locales.has(n(a, 0) >>> 0)) return VI(0)
      const bytes = rt.vfs?.readFile(cString(rt, n(a, 1) >>> 0)); const catalog = bytes ? parseCatalog(bytes) : null
      if (!catalog) return VI(0)
      const handle = st().memory.alloc(4, { clear: true })
      if (handle !== 0) st().catalogs.set(handle, { catalog, strings: new Map() })
      return VI(handle)
    },
    '_cat str'(_, a) {
      const record = st().catalogs.get(n(a, 0) >>> 0); const id = n(a, 1); const fallback = n(a, 2) >>> 0
      if (!record) return VI(fallback)
      if (!record.catalog.strings.has(id)) return VI(fallback)
      const value = getCatalogStr(record.catalog, id, cString(rt, fallback))
      let pointer = record.strings.get(id)
      if (pointer === undefined) { pointer = heap().fromAmos(value); record.strings.set(id, pointer) }
      return VI(pointer)
    },
    '_wnd id data'(_, a) { return VI(st().windowIds.data(n(a, 0))) },
    '_arg what str'(_, a) {
      const address = n(a, 0) >>> 0; const count = n(a, 1)
      return VI(wbArgName(wbArgsAt(rt, address, count), count, n(a, 2)))
    },
    '_arg what lock'(_, a) {
      const address = n(a, 0) >>> 0; const count = n(a, 1)
      return VI(wbArgLock(wbArgsAt(rt, address, count), count, n(a, 2)))
    },
    '_tool find'(_, a) {
      const object = n(a, 0) >>> 0; const icon = rt.icons.objects.get(object)
      const value = icon ? findToolType(icon.toolTypes, cString(rt, n(a, 1) >>> 0)) : null
      if (value === null) return VI(0)
      let pointers = st().toolTypePointers.get(object)
      if (!pointers) { pointers = new Map(); st().toolTypePointers.set(object, pointers) }
      let pointer = pointers.get(value)
      if (pointer === undefined) { pointer = heap().fromAmos(value); pointers.set(value, pointer) }
      return VI(pointer)
    },
    '_tool match'(_, a) {
      return VI(matchToolValue(cString(rt, n(a, 0) >>> 0), cString(rt, n(a, 1) >>> 0)) ? -1 : 0)
    },
    '_tool get$'(_, a) {
      const icon = rt.icons.objects.get(n(a, 0) >>> 0)
      return VS(icon ? findToolType(icon.toolTypes, str(a[1] ?? VS(''))) ?? '' : '')
    },
    '_tool exist'(_, a) {
      const icon = rt.icons.objects.get(n(a, 0) >>> 0)
      return VI(icon && findToolType(icon.toolTypes, str(a[1] ?? VS(''))) !== null ? -1 : 0)
    },
    '_tool val match$'(_, a) {
      return VI(matchToolValue(str(a[0] ?? VS('')), str(a[1] ?? VS(''))) ? -1 : 0)
    },
    /**
     * Routines 1585/1586: these Preferences entry points are explicitly
     * obsolete in the guide and the shipped workers are eight-byte stubs.
     * AMOS has already evaluated the arguments before dispatch reaches us;
     * each worker merely drops them and clears both integer result registers.
     */
    '_prfs get def'() { return VI(0) },
    '_prfs get'() { return VI(0) },
    '_prfs set'() { return VI(0) },
    '_req do'(_, a) {
      const requester = n(a, 0) >>> 0; const window = windowAtBase(st(), n(a, 1))
      if (requester === 0 || !window || st().requesterWindows.has(requester)) return VI(0)
      if (!rt.intuition.request(window)) return VI(0)
      st().requesterWindows.set(requester, window)
      return VI(1)
    },
    '_asl alloc'(_, a) {
      const type = n(a, 0)
      if (type < 0 || type > 2) return VI(0)
      const requester = st().memory.alloc(64, { clear: true })
      if (requester !== 0) st().aslRequests.set(requester, {
        type, pending: false, ownedStrings: [],
        allocTags: tagItems(st(), n(a, 1)).map(({ tag, data }) => ({ tag, data })),
      })
      return VI(requester)
    },
    '_asl do'(it, a) {
      const requester = n(a, 0) >>> 0; const record = st().aslRequests.get(requester)
      if (!record) return VI(0)
      if (record.pending) {
        if (record.type === 0 && rt.asl) {
          if (!rt.asl.done) { it.block({ type: 'asl' }, true); return VI(0) }
          const result = rt.asl.result; const setup = rt.asl.setup; rt.asl = null; record.pending = false
          if (result === '') return VI(0)
          for (const address of record.ownedStrings) heap().free(address)
          const file = heap().fromAmos(setup.file); const drawer = heap().fromAmos(setup.dir)
          record.ownedStrings = [file, drawer]; structWrite(rt, requester + 4, 4, file); structWrite(rt, requester + 8, 4, drawer)
          structWrite(rt, requester + 32, 4, 0); structWrite(rt, requester + 36, 4, 0)
          return VI(1)
        }
        if (record.type === 1 && rt.aslFont) {
          if (!rt.aslFont.done) { it.block({ type: 'asl' }, true); return VI(0) }
          const font = rt.aslFont; rt.aslFont = null; record.pending = false
          if (font.result === '') return VI(0)
          for (const address of record.ownedStrings) heap().free(address)
          const name = heap().fromAmos(font.result); record.ownedStrings = [name]
          structWrite(rt, requester + 8, 4, name); structWrite(rt, requester + 12, 2, font.resultSize)
          return VI(1)
        }
        if (record.type === 2 && rt.aslMode) {
          if (!rt.aslMode.done) { it.block({ type: 'asl' }, true); return VI(0) }
          const mode = rt.aslMode; rt.aslMode = null; record.pending = false
          if (mode.result === -1) return VI(0)
          structWrite(rt, requester, 4, mode.result); structWrite(rt, requester + 4, 4, mode.setup.displayWidth)
          structWrite(rt, requester + 8, 4, mode.setup.displayHeight); structWrite(rt, requester + 12, 2, mode.setup.depth)
          return VI(1)
        }
        record.pending = false
        return VI(0)
      }
      const requestTags = tagItems(st(), n(a, 1))
      const tags = new Map(record.allocTags.map(item => [item.tag, item.data]))
      for (const item of requestTags) tags.set(item.tag, item.data)
      const tagged = (tag: number, fallback: number): number => tags.get(tag) ?? fallback
      const taggedString = (tag: number): string => cString(rt, tagged(tag, 0) >>> 0)
      const screen = tagged(0x8008_0028, 0) >>> 0
      const parent = windowAtBase(st(), tagged(0x8008_0002, 0))
      const slot = screen !== 0 ? managedScreenSlot(rt, screen) : parent?.screenSlot ?? null
      const common = {
        hail: taggedString(0x8008_0001), okText: taggedString(0x8008_0012),
        cancelText: taggedString(0x8008_0013), left: tagged(0x8008_0003, 30),
        top: tagged(0x8008_0004, 20), width: tagged(0x8008_0005, 318),
        height: tagged(0x8008_0006, record.type === 0 ? 178 : 198),
      }
      let started = false
      if (record.type === 0) started = rt.startAslRequest({
        ...common,
        dir: taggedString(0x8008_0009) || cString(rt, structRead(rt, requester + 8, 4, false)) || (rt.vfs?.currentDir ?? ''),
        file: taggedString(0x8008_0008) || cString(rt, structRead(rt, requester + 4, 4, false)),
        pattern: taggedString(0x8008_000a),
        rejectIcons: tagged(0x8008_003c, tagged(0x8008_0016, 0) & 4) !== 0,
        doPatterns: tagged(0x8008_002e, tagged(0x8008_0014, 1) & 1) !== 0,
      }, slot)
      else if (record.type === 1) started = rt.startAslFontRequest({
        ...common,
        name: taggedString(0x8008_000a) || cString(rt, structRead(rt, requester + 8, 4, false)),
        size: tagged(0x8008_000b, structRead(rt, requester + 12, 2, false) || 8),
      }, slot)
      else started = rt.startAslModeRequest({
        ...common,
        id: tagged(0x8008_00c8, structRead(rt, requester, 4, false)),
        displayWidth: tagged(0x8008_00ca, structRead(rt, requester + 4, 4, false) || 640),
        displayHeight: tagged(0x8008_00cc, structRead(rt, requester + 8, 4, false) || 200),
        depth: tagged(0x8008_00ce, structRead(rt, requester + 12, 2, false) || 2),
      }, slot)
      if (!started) return VI(0)
      record.pending = true; it.block({ type: 'asl' }, true); return VI(0)
    },
    '_asl file$'(it, a) {
      if (rt.asl) {
        if (!rt.asl.done) { it.block({ type: 'asl' }, true); return VS('') }
        const result = rt.asl.result; rt.asl = null; return VS(result)
      }
      const window = windowAtBase(st(), n(a, 0)); const title = str(a[1] ?? VS('')); const dir = str(a[2] ?? VS(''))
      const file = str(a[3] ?? VS('')); const pattern = str(a[4] ?? VS(''))
      if (!rt.startAslRequest({
        hail: title, okText: '', cancelText: '', left: 30, top: 20, width: 318, height: 178,
        dir: dir || (rt.vfs?.currentDir ?? ''), file, pattern, rejectIcons: false, doPatterns: true,
      }, window?.screenSlot ?? null)) return VS('')
      it.block({ type: 'asl' }, true); return VS('')
    },
    '_ag display'(_, a) {
      const screen = n(a, 0) >>> 0
      const name = cString(rt, n(a, 1))
      const baseName = cString(rt, n(a, 2))
      const context = n(a, 3) >>> 0
      const handle = rt.amigaGuide.open(name, screen, baseName, context)
      if (handle !== 0) rt.amigaGuide.close(handle)
      // Worker 1895 preserves OpenAmigaGuideA's handle in d0 across Close.
      return VI(handle)
    },
    '_ag show'(_, a) {
      const screen = n(a, 0) >>> 0; const name = str(a[1] ?? VS(''))
      const handle = rt.amigaGuide.open(name, screen)
      if (handle !== 0) rt.amigaGuide.close(handle)
      return VI(handle)
    },
    '_sp install'() { return VI(rt.stonePlayer.install()) },
    '_sp play'(_, a) { return VI(rt.stonePlayer.play(n(a, 0) >>> 0, n(a, 1) >>> 0)) },
    '_sp check'(_, a) { return VI(rt.stonePlayer.check(n(a, 0) >>> 0, n(a, 1) >>> 0)) },
    '_asl what file'(_, a) {
      const requester = n(a, 0) >>> 0
      if (a.length < 2) return VI(requester === 0 ? 0 : structRead(rt, requester + 4, 4, false))
      const selection = n(a, 1)
      if (selection < 1 || requester === 0) return VI(0)
      const count = structRead(rt, requester + 32, 4, false)
      const args = structRead(rt, requester + 36, 4, false)
      if (selection > count || args === 0) return VI(0)
      return VI(structRead(rt, args + selection * 8 - 4, 4, false))
    },
    '_asl what drawer'(_, a) { const requester = n(a, 0) >>> 0; return VI(requester === 0 ? 0 : structRead(rt, requester + 8, 4, false)) },
    '_asl what nb args'(_, a) { const requester = n(a, 0) >>> 0; return VI(requester === 0 ? 0 : structRead(rt, requester + 32, 4, false)) },
    /** FontRequest embeds its public TextAttr at offset eight; this returns its address, not a field. */
    '_asl what font'(_, a) { const requester = n(a, 0) >>> 0; return VI(requester === 0 ? 0 : requester + 8) },
    '_wb close'() { return VI(rt.intuition.closeWorkBench() ? -1 : 0) },
    '_wb open'() { return VI(rt.intuition.openWorkBench() !== 0 ? -1 : 0) },
    '_wb msg'() { return VI(rt.workbench.message) },
    '_base wb'() { return VI(openLibrary('workbench.library', 36)) },
    '_app add icon'(_, a) { return VI(rt.workbench.add('icon', n(a, 0), n(a, 1), n(a, 2), n(a, 3), n(a, 5), n(a, 6))) },
    '_app add menu'(_, a) { return VI(rt.workbench.add('menu', n(a, 0), n(a, 1), n(a, 2), n(a, 3), 0, n(a, 4))) },
    '_app add wnd'(_, a) { return VI(rt.workbench.add('window', n(a, 0), n(a, 1), 0, n(a, 3), n(a, 2), n(a, 4))) },
    '_app rem icon'(_, a) { return VI(rt.workbench.remove(n(a, 0) >>> 0, 'icon') ? -1 : 0) },
    '_app rem menu'(_, a) { return VI(rt.workbench.remove(n(a, 0) >>> 0, 'menu') ? -1 : 0) },
    '_app rem wnd'(_, a) { return VI(rt.workbench.remove(n(a, 0) >>> 0, 'window') ? -1 : 0) },
    '_icon kill'(_, a) { return VI(rt.icons.kill(cString(rt, n(a, 0))) ? -1 : 0) },
    '_icon def'(_, a) { return VI(rt.icons.def(n(a, 0))) },
    '_icon load'(_, a) { return VI(rt.icons.load(cString(rt, n(a, 0)))) },
    '_icon save'(_, a) { return VI(rt.icons.save(cString(rt, n(a, 0)), n(a, 1) >>> 0) ? -1 : 0) },
    '_icon get'(_, a) { return VI(rt.icons.load(str(a[0] ?? VS('')))) },
    '_icon del'(_, a) { return VI(rt.icons.kill(str(a[0] ?? VS(''))) ? -1 : 0) },
    '_icon put'(_, a) { return VI(rt.icons.save(str(a[0] ?? VS('')), n(a, 1) >>> 0) ? -1 : 0) },
    '_icon info'(_, a) { const p = rt.icons.load(str(a[1] ?? VS(''))); if (p) rt.icons.free(p); return VI(p ? -1 : 0) },
    '_dt init'() { return VI(openLibrary('datatypes.library', 39)) },
    '_dt create'(_, a) {
      const path = cString(rt, n(a, 0)); const attrs = new Map(tagItems(st(), n(a, 1)).map(t => [t.tag, t.data]))
      return VI(st().dataTypes.create(path, rt.vfs?.readFile(path) ?? null, attrs))
    },
    '_dt what attrs'(_, a) {
      const o = st().dataTypes.objects.get(n(a, 0) >>> 0); if (!o) return VI(0); let count = 0
      for (const tag of tagItems(st(), n(a, 1))) { const value = o.attributes.get(tag.tag); if (value !== undefined && tag.data !== 0) { structWrite(rt, tag.data, 4, value); count++ } }
      return VI(count)
    },
    '_dt obtain'(_, a) {
      const source = n(a, 1); const path = cString(rt, source); const bytes = path ? rt.vfs?.readFile(path) ?? null : null
      return VI(st().dataTypes.obtain(bytes))
    },
    '_dt add'(_, a) { return VI(st().dataTypes.add(n(a, 0) >>> 0, n(a, 1) >>> 0, n(a, 2) >>> 0, n(a, 3))) },
    '_dt remove'(_, a) { return VI(st().dataTypes.remove(n(a, 1) >>> 0, n(a, 0) >>> 0)) },
    '_dt what methods'(_, a) { return VI(st().dataTypes.objects.has(n(a, 0) >>> 0) ? st().dataTypes.methodList(false) : 0) },
    '_dt what triggers'(_, a) { return VI(st().dataTypes.objects.has(n(a, 0) >>> 0) ? st().dataTypes.methodList(true) : 0) },
    '_dt do'(_, a) { return VI(st().dataTypes.objects.has(n(a, 0) >>> 0) ? 1 : 0) },
    '_dt str$'(_, a) { return VS(dataTypeString(n(a, 0))) },
    '_dos err'() { return VI(rt.dos.ioErr) },
    '_dos open'(_, a) { return VI(rt.dos.open(rt.vfs, cString(rt, n(a, 0)), n(a, 1))) },
    '_dos opin'(_, a) { return VI(rt.dos.open(rt.vfs, str(a[0] ?? VS('')), 1005)) },
    '_dos opout'(_, a) { return VI(rt.dos.open(rt.vfs, str(a[0] ?? VS('')), 1006)) },
    '_dos append'(_, a) {
      const handle = rt.dos.open(rt.vfs, str(a[0] ?? VS('')), 1004)
      if (handle) rt.dos.seek(handle, 0, 1)
      return VI(handle)
    },
    '_dos seek'(_, a) { return VI(rt.dos.seek(n(a, 0), n(a, 1), n(a, 2))) },
    '_dos read'(_, a) {
      const buffer = n(a, 1) >>> 0, bytes = rt.dos.read(n(a, 0), n(a, 2))
      if (!bytes) return VI(-1)
      for (let i = 0; i < bytes.length; i++) { const m = rt.resolveWrite(buffer + i); if (!m) return VI(-1); m.data[m.off] = bytes[i]! }
      return VI(bytes.length)
    },
    '_dos write'(_, a) {
      const buffer = n(a, 1) >>> 0, length = n(a, 2); if (length < 0) return VI(-1)
      const bytes = new Uint8Array(length)
      for (let i = 0; i < length; i++) { const m = rt.resolveAddr(buffer + i); if (!m) return VI(-1); bytes[i] = m.data[m.off]! }
      return VI(rt.dos.write(rt.vfs, n(a, 0), bytes))
    },
    '_dos f getc'(_, a) { return VI(rt.dos.getc(n(a, 0))) },
    '_dos f gets'(_, a) {
      const buffer = n(a, 1) >>> 0, length = n(a, 2), bytes = rt.dos.gets(n(a, 0), length)
      if (!bytes || buffer === 0) return VI(0)
      for (let i = 0; i < bytes.length; i++) { const m = rt.resolveWrite(buffer + i); if (!m) return VI(0); m.data[m.off] = bytes[i]! }
      const end = rt.resolveWrite(buffer + bytes.length); if (!end) return VI(0); end.data[end.off] = 0
      return VI(buffer)
    },
    '_dos f putc'(_, a) { return VI(rt.dos.write(rt.vfs, n(a, 0), Uint8Array.of(n(a, 1))) < 0 ? -1 : n(a, 1) & 0xff) },
    '_dos f puts'(_, a) { return VI(rt.dos.write(rt.vfs, n(a, 0), new TextEncoder().encode(cString(rt, n(a, 1)))) < 0 ? -1 : 0) },
    '_dos f ungetc'(_, a) { return VI(rt.dos.ungetc(n(a, 0), n(a, 1))) },
    '_dos f name'(_, a) {
      const file = rt.dos.file(n(a, 0)), buffer = n(a, 1) >>> 0, length = n(a, 2)
      if (!file || !buffer || file.path.length + 1 > length) return VI(0)
      for (let i = 0; i < file.path.length; i++) { const m = rt.resolveWrite(buffer + i); if (!m) return VI(0); m.data[m.off] = file.path.charCodeAt(i) & 0xff }
      const end = rt.resolveWrite(buffer + file.path.length); if (!end) return VI(0); end.data[end.off] = 0
      return VI(-1)
    },
    '_fh name$'(_, a) { return VS(rt.dos.file(n(a, 0))?.path ?? '') },
    '_dos mode'(_, a) { return VI(rt.dos.file(n(a, 0)) && [0, 1].includes(n(a, 1)) && [-2, -1].includes(n(a, 2)) ? -1 : 0) },
    '_dos print'(_, a) { return VI(rt.dos.write(rt.vfs, n(a, 0), new TextEncoder().encode(str(a[1] ?? VS('')))) < 0 ? 0 : -1) },
    '_dos input'(_, a) {
      const bytes = rt.dos.gets(n(a, 0), 65536); if (!bytes) return VS('')
      let end = bytes.length; if (end && bytes[end - 1] === 10) end--; if (end && bytes[end - 1] === 13) end--
      return VS(String.fromCharCode(...bytes.subarray(0, end)))
    },
    '_dos eof'(_, a) { const file = rt.dos.file(n(a, 0)); return VI(!file || (file.ungot === null && file.position >= file.data.length) ? -1 : 0) },
    '_dos lof'(_, a) { return VI(rt.dos.file(n(a, 0))?.data.length ?? 0) },
    '_dos lock'(_, a) { return VI(rt.dos.lock(rt.vfs, cString(rt, n(a, 0)), n(a, 1))) },
    '_dos rd lock'(_, a) { return VI(rt.dos.lock(rt.vfs, str(a[0] ?? VS('')), -2)) },
    '_dos wr lock'(_, a) { return VI(rt.dos.lock(rt.vfs, str(a[0] ?? VS('')), -1)) },
    '_dos l open'(_, a) { return VI(rt.dos.parentLock(rt.vfs, n(a, 0))) },
    '_dos dir'(_, a) { return VI(rt.dos.currentDir(rt.vfs, n(a, 0))) },
    '_lock name$'(_, a) { return VS(rt.dos.lockInfo(n(a, 0))?.path ?? '') },
    '_dos what dir$'() { return VS(rt.vfs?.currentDir ?? '') },
    '_dos exist'(_, a) { return VI(rt.vfs?.exists(str(a[0] ?? VS(''))) ? -1 : 0) },
    '_dos l name'(_, a) {
      const lock = rt.dos.lockInfo(n(a, 0)), buffer = n(a, 1) >>> 0, length = n(a, 2)
      if (!lock || !buffer || lock.path.length + 1 > length) return VI(0)
      for (let i = 0; i < lock.path.length; i++) { const m = rt.resolveWrite(buffer + i); if (!m) return VI(0); m.data[m.off] = lock.path.charCodeAt(i) & 0xff }
      const end = rt.resolveWrite(buffer + lock.path.length); if (!end) return VI(0); end.data[end.off] = 0
      return VI(-1)
    },
    '_dos seg load'(_, a) {
      const path = cString(rt, n(a, 0)); if (!path) return VI(0)
      const bytes = rt.vfs?.readFile(path); if (!bytes) { rt.dos.ioErr = 205; return VI(0) }
      try {
        const probe = loadHunks(bytes, 0), base = st().memory.alloc(probe.image.length + 4, { clear: true })
        if (!base) { rt.dos.ioErr = 103; return VI(0) }
        const loaded = loadHunks(bytes, base + 4)
        for (let i = 0; i < loaded.image.length; i++) { const m = rt.resolveWrite(base + 4 + i); if (m) m.data[m.off] = loaded.image[i]! }
        const segment = base >>> 2
        st().dosSegments.set(segment, { base, path, size: loaded.image.length + 4 }); rt.dos.ioErr = 0
        return VI(segment)
      } catch { rt.dos.ioErr = 121; return VI(0) }
    },
    '_dos seg unload'(_, a) {
      const segment = n(a, 0) >>> 0, loaded = st().dosSegments.get(segment)
      if (!loaded) return VI(0)
      st().memory.freeMem(loaded.base); st().dosSegments.delete(segment)
      return VI(-1)
    },
    '_dos new proc'(_, a) {
      const tags = new Map(tagItems(st(), n(a, 0)).map(item => [item.tag >>> 0, item.data]))
      const NP_DUMMY = 0x8000_03e8, segment = (tags.get(NP_DUMMY + 1) ?? 0) >>> 0
      const loaded = st().dosSegments.get(segment); if (!loaded) return VI(0)
      const nameAddress = (tags.get(NP_DUMMY + 12) ?? 0) >>> 0
      const name = nameAddress ? cString(rt, nameAddress) : 'New Process'
      const priority = (tags.get(NP_DUMMY + 13) ?? 0) << 24 >> 24
      const stackSize = tags.get(NP_DUMMY + 11) ?? 4000
      if (!rt.host.process?.launch?.({ name: loaded.path, priority, stackSize })) return VI(0)
      return VI(st().exec.tasks.register(name, priority))
    },
    '_dos sig notify'(_, a) {
      const path = cString(rt, n(a, 0)), task = n(a, 1) >>> 0, signal = n(a, 2), user = n(a, 3)
      if (!rt.vfs || !path || signal < 0 || signal > 31) return VI(0)
      const request = st().memory.alloc(48, { clear: true }), name = st().strings.fromAmos(path)
      structWrite(rt, request, 4, name); structWrite(rt, request + 8, 4, user); structWrite(rt, request + 12, 4, 0x4000_0000)
      structWrite(rt, request + 16, 4, task); structWrite(rt, request + 20, 1, signal)
      const folded = path.toLowerCase(), directory = rt.vfs.exists(path) === 'dir'
      const stop = rt.vfs.watch(event => {
        const changed = event.path.toLowerCase()
        if (changed === folded || (directory && changed.startsWith(`${folded.replace(/\/$/, '')}/`))) st().exec.messages.signal(task, 1 << signal)
      })
      st().dosNotifications.set(request, { stop, name, messages: [] })
      return VI(request)
    },
    '_dos msg notify'(_, a) {
      const path = cString(rt, n(a, 0)), port = n(a, 1) >>> 0, user = n(a, 2)
      if (!rt.vfs || !path || port === 0) return VI(0)
      const request = st().memory.alloc(48, { clear: true }), name = st().strings.fromAmos(path)
      structWrite(rt, request, 4, name); structWrite(rt, request + 8, 4, user); structWrite(rt, request + 12, 4, 0x4000_0001)
      structWrite(rt, request + 16, 4, port)
      const messages: number[] = [], folded = path.toLowerCase(), directory = rt.vfs.exists(path) === 'dir'
      const stop = rt.vfs.watch(event => {
        const changed = event.path.toLowerCase()
        if (changed !== folded && !(directory && changed.startsWith(`${folded.replace(/\/$/, '')}/`))) return
        const message = st().exec.messages.allocMessage(0, 38); messages.push(message)
        st().exec.memory.writeU32(message + 20, 0x4000_0000)
        structWrite(rt, message + 24, 2, 0x1234)
        st().exec.memory.writeU32(message + 26, request)
        st().exec.messages.putMsg(port, message)
      })
      st().dosNotifications.set(request, { stop, name, messages })
      return VI(request)
    },
    '_nmsg what nreq'(_, a) { return VI(structRead(rt, n(a, 0) + 26, 4, false)) },
    '_nr what user'(_, a) { return VI(structRead(rt, n(a, 0) + 8, 4, false)) },
    '_prg dir$'() { return VS(rt.commandName ? dosPathPart(rt.commandName) : '') },
    '_prg name$'() { return VS(rt.commandName ? dosFilePart(rt.commandName) : '') },
    '_dos set err'(_, a) { return VI(rt.dos.setIoErr(n(a, 0))) },
    '_dos fault'(_, a) {
      const code = n(a, 0), headerAddress = n(a, 1) >>> 0
      const buffer = n(a, 2) >>> 0, length = n(a, 3)
      const value = rt.dos.fault(code, headerAddress === 0 ? null : cString(rt, headerAddress))
      if (value === null || buffer === 0 || length <= 0) return VI(0)
      const bytes = new TextEncoder().encode(value)
      const count = Math.min(bytes.length, Math.max(0, length - 1))
      for (let i = 0; i < count; i++) {
        const m = rt.resolveWrite(buffer + i)
        if (!m) break
        m.data[m.off] = bytes[i]!
      }
      const end = rt.resolveWrite(buffer + count)
      if (end) end.data[end.off] = 0
      // The native result is unusable through at least V47; the extension's
      // own manual consequently specifies no meaning for this value.
      return VI(0)
    },
    '_dos add part'(_, a) {
      const pathAddress = n(a, 0) >>> 0, nameAddress = n(a, 1) >>> 0, length = n(a, 2)
      if (pathAddress === 0 || nameAddress === 0 || length <= 0) return VI(0)
      const value = joinAmigaPath(cString(rt, pathAddress), cString(rt, nameAddress))
      if (value.length + 1 > length) return VI(0)
      for (let i = 0; i < value.length; i++) {
        const m = rt.resolveWrite(pathAddress + i)
        if (!m) return VI(0)
        m.data[m.off] = value.charCodeAt(i) & 0xff
      }
      const end = rt.resolveWrite(pathAddress + value.length)
      if (!end) return VI(0)
      end.data[end.off] = 0
      return VI(-1)
    },
    '_dos file part'(_, a) {
      const address = n(a, 0) >>> 0
      if (address === 0) return VI(0)
      const path = cString(rt, address)
      return VI((address + path.length - dosFilePart(path).length) >>> 0)
    },
    '_dos path part'(_, a) {
      const address = n(a, 0) >>> 0
      if (address === 0) return VI(0)
      return VI((address + dosPathPart(cString(rt, address)).length) >>> 0)
    },
    '_path add'(_, a) { return VS(joinAmigaPath(str(a[0] ?? VS('')), str(a[1] ?? VS(''))).slice(0, 1022)) },
    '_file part'(_, a) { return VS(dosFilePart(str(a[0] ?? VS('')))) },
    '_path part'(_, a) { return VS(dosPathPart(str(a[0] ?? VS('')))) },
    '_dos report'(_, a) { return VI(rt.dos.report(n(a, 0), n(a, 1), n(a, 2), n(a, 3)) ? -1 : 0) },
    '_dos var del'(_, a) { return VI(st().dosVariables.delete(str(a[0] ?? VS('')), n(a, 1)) ? -1 : 0) },
    '_dos var find'(_, a) { return VI(st().dosVariables.find(str(a[0] ?? VS('')), n(a, 1))) },
    '_dos var value$'(_, a) { return VS(st().dosVariables.get(str(a[0] ?? VS('')), n(a, 1))) },
    '_cli read args'(_, a) { return VI(st().readArgs.read(str(a[0] ?? VS('')), str(a[1] ?? VS(''))) ? -1 : 0) },
    '_cli what arg$'(_, a) { return VS(st().readArgs.string(n(a, 0), n(a, 1))) },
    '_cli what arg'(_, a) { return VI(st().readArgs.number(n(a, 0), n(a, 1))) },
    '_cx init'() { st().commodities.base = openLibrary('commodities.library', 0); return VI(st().commodities.base) },
    '_base cx'() { return VI(st().commodities.base) },
    '_cx install'(_, a) { return VI(st().commodities.install(str(a[0] ?? VS('')), n(a, 3), n(a, 4), n(a, 5))) },
    '_cx broker'() { return VI(st().commodities.broker) },
    '_cx id base'(_, a) { return VI(st().commodities.ids.get(n(a, 0)) ?? 0) },
    '_cx msg port'() { return VI(st().commodities.port) },
    '_cx id type'(_, a) { return VI(st().commodities.objects.get(st().commodities.ids.get(n(a, 0)) ?? 0)?.type ?? 0) },
    '_cx id error'(_, a) { return VI(st().commodities.objects.get(st().commodities.ids.get(n(a, 0)) ?? 0)?.error ?? 0) },
    '_cx id wait event'() { return VI(st().commodities.next(true)) },
    '_cx id next event'() { return VI(st().commodities.next(false)) },
    '_cx id event type'() { return VI(st().commodities.current?.type ?? 0) },
    '_cx id event id'() { return VI(st().commodities.current?.id ?? 0) },
    '_cx id event data'() { return VI(st().commodities.current?.data ?? 0) },
    '_iff init'() { st().iffBase = openLibrary('iffparse.library', 0); return VI(st().iffBase) },
    '_base iff'() { return VI(st().iffBase) },
    '_iff open in'(_, a) { const path = str(a[0] ?? VS('')); const bytes = rt.vfs?.readFile(path); return VI(bytes ? st().iff.openIn(path, bytes) : 0) },
    '_iff open out'(_, a) { return VI(st().iff.openOut(str(a[0] ?? VS('')))) },
    '_iff parse'(_, a) { return VI(st().iff.parse(n(a, 0) >>> 0, n(a, 1))) },
    '_chunk current'(_, a) { return VI(st().iff.current(n(a, 0) >>> 0)) },
    '_chunk parent'(_, a) { return VI(st().iff.parent(n(a, 0) >>> 0)) },
    '_chunk read'(_, a) {
      const buffer = n(a, 1) >>> 0, bytes = st().iff.read(n(a, 0) >>> 0, n(a, 2)); if (!bytes) return VI(-4)
      for (let i = 0; i < bytes.length; i++) { const m = rt.resolveWrite(buffer + i); if (m) m.data[m.off] = bytes[i]! }
      return VI(bytes.length)
    },
    '_chunk write'(_, a) {
      const buffer = n(a, 1) >>> 0, bytes = new Uint8Array(Math.max(0, n(a, 2)))
      for (let i = 0; i < bytes.length; i++) { const m = rt.resolveAddr(buffer + i); bytes[i] = m?.data[m.off] ?? 0 }
      return VI(st().iff.write(n(a, 0) >>> 0, bytes))
    },
    '_chunk child'(_, a) { return VI(st().iff.push(n(a, 0) >>> 0, n(a, 1) >>> 0, n(a, 2) >>> 0, n(a, 3))) },
    '_chunk end'(_, a) { return VI(st().iff.pop(n(a, 0) >>> 0)) },
    '_chunk what size'(_, a) { return VI(st().iff.context(n(a, 0) >>> 0)?.size ?? 0) },
    '_chunk what scan'(_, a) { return VI(st().iff.context(n(a, 0) >>> 0)?.scan ?? 0) },
    '_chunk what type'(_, a) { return VI(st().iff.context(n(a, 0) >>> 0)?.type ?? 0) },
    '_chunk what id'(_, a) { return VI(st().iff.context(n(a, 0) >>> 0)?.id ?? 0) },
    '_low init'() {
      st().lowlevelBase = openLibrary('lowlevel.library', 0)
      st().lowlevelClock.last = Math.floor((rt.interp.tick * 65536) / 50)
      return VI(st().lowlevelBase)
    },
    '_lib open'(_, a) {
      const base = openLibrary(str(a[0] ?? VS('')), n(a, 1))
      if (base !== 0) st().openLibraries.add(base)
      return VI(base)
    },
    '_joy set'(_, a) {
      const port = n(a, 0); const old = (readJoyPort(rt.input.ports, port) & JP_TYPE_MASK) >>> 28
      setJoyPortType(rt.input.ports, port, n(a, 1)); return VI(old)
    },
    '_joy init'(_, a) {
      const port = n(a, 0); const old = (readJoyPort(rt.input.ports, port) & JP_TYPE_MASK) >>> 28
      setJoyPortType(rt.input.ports, port, SJA_TYPE_AUTOSENSE); return VI(old)
    },
    '_joy read'(_, a) { return VI(readJoyPort(rt.input.ports, n(a, 0)) | 0) },
    '_joy type'(_, a) { return VI((readJoyPort(rt.input.ports, n(a, 0)) & JP_TYPE_MASK) >>> 28) },
    '_time elapsed'() { return VI(elapsedTime(st().lowlevelClock, Math.floor((rt.interp.tick * 65536) / 50))) },
    /**
     * Worker 9 accidentally calls QueryKeys with uninitialised a0/d1.  Preserve
     * the apparent intent with a stable raw-key query instead of emulating
     * whatever memory corruption happened to supply on a particular run.
     */
    '_key pressed'() {
      for (let key = 0; key <= 0x7f; key++) if (keyQuery(rt.input.keys, key)) return VI(key)
      return VI(0)
    },
    '_li new'() {
      const address = st().memory.alloc(112, { clear: true }); if (address !== 0) st().layerInfos.set(address, null); return VI(address)
    },
    '_layer create behind'(_, a) { return VI(createNativeLayer(rt, st(), a.map((v) => int(v)), false)) },
    '_layer create upfront'(_, a) { return VI(createNativeLayer(rt, st(), a.map((v) => int(v)), true)) },
    '_ggad context'(_, a) {
      const destination = n(a, 0); if (destination === 0) return VI(0)
      const context = st().gadtools.createContext(); structWrite(rt, destination, 4, context.address); return VI(-1)
    },
    '_gmn list alloc'(_, a) {
      const capacity = n(a, 0) & 0xffff
      const base = st().memory.alloc(capacity * 20 + 28, { clear: true })
      if (base === 0) return VI(0)
      const address = (base + 8) >>> 0
      st().newMenuLists.set(address, { capacity, cursor: 0, entries: [] })
      return VI(address)
    },
    '_gmn create'(_, a) {
      const list = st().newMenuLists.get(n(a, 0) >>> 0)
      if (!list) return VI(0)
      return VI(st().gadtools.createMenus(list.entries, tagItems(st(), n(a, 1)))?.address ?? 0)
    },
    '_gmn layout'(_, a) {
      const strip = st().gadtools.menuStrip(n(a, 0) >>> 0)
      return VI(strip && st().gadtools.layoutMenus(strip, n(a, 1), undefined) ? -1 : 0)
    },
    '_obj new'(_, a) {
      const privateClass = n(a, 0) >>> 0
      const className = str(a[1] ?? VS(''))
      const cl = privateClass === 0 ? className : rt.boopsi.classAt(privateClass)
      if (!cl) return VI(0)
      const object = rt.boopsi.newObjectA(cl, tagItems(st(), n(a, 2)))
      if (!object) return VI(0)
      st().boopsiObjects.add(object.address)
      return VI(object.address)
    },
    '_class get file'() {
      if (st().fileImageClass !== 0) return VI(st().fileImageClass)
      rt.boopsi.ensureIntuitionClasses()
      const cl = rt.boopsi.makeClass('', 'imageclass', (entered, object, message) => doSuperMethodA(entered, object, message))
      if (!cl) return VI(0)
      st().fileImageClass = rt.boopsi.classHandle(cl)
      return VI(st().fileImageClass)
    },
    '_obj what attr'(_, a) {
      const object = rt.boopsi.objectAt(n(a, 0) >>> 0)
      if (!object || !st().boopsiObjects.has(object.address)) return VI(0)
      return VI(getAttr(n(a, 1) >>> 0, object) ?? 0)
    },
    '_obj set attrs'(_, a) {
      const object = rt.boopsi.objectAt(n(a, 0) >>> 0)
      if (!object || !st().boopsiObjects.has(object.address)) return VI(0)
      // Window and Requester are GInfo context in SetGadgetAttrsA; generic
      // attribute ownership remains the BOOPSI object's, not the window's.
      return VI(setAttrsA(object, tagItems(st(), n(a, 3))))
    },
    '_obj do'(_, a) {
      const object = rt.boopsi.objectAt(n(a, 0) >>> 0); const message = n(a, 3) >>> 0
      if (!object || !st().boopsiObjects.has(object.address) || message === 0) return VI(0)
      return VI(doMethodA(object, { MethodID: structRead(rt, message, 4, false) >>> 0 }))
    },
    '_gt what integer'(_, a) {
      const gadget = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.gadgets.get(n(a, 0))
      return VI(gadget?.kind === KIND.INTEGER ? gadget.number ?? 0 : 0)
    },
    '_gt what string'(_, a) {
      const gadget = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.gadgets.get(n(a, 0))
      return VS(gadget?.kind === KIND.STRING ? gadget.string ?? '' : '')
    },
    '_gt base'(_, a) {
      const bank = st().gtGadgetBanks.get(st().currentGtGadgetBank); const id = n(a, 0)
      return VI(bank?.gadgets.get(id)?.address ?? bank?.objects.get(id)?.address ?? 0)
    },
    '_gt what attr'(_, a) {
      const object = st().gtGadgetBanks.get(st().currentGtGadgetBank)?.objects.get(n(a, 0))
      return VI(object ? getAttr(n(a, 1) >>> 0, object) ?? 0 : 0)
    },
    /** Worker 1498: derive NewGadget fields from GA_* tags, then CreateGadgetA. */
    '_gt create'(_, a) {
      const kind = n(a, 0) as GadgetKind
      if (!(Object.values(KIND) as number[]).includes(kind)) return VI(0)
      const previous = st().gadtools.gadget(n(a, 1))
      const tags = tagItems(st(), n(a, 4))
      const data = (tag: number): number => tags.find(item => item.tag === tag)?.data ?? 0
      const ng: NewGadget = {
        leftEdge: data(0x8003_0001), topEdge: data(0x8003_0003),
        width: data(0x8003_0005), height: data(0x8003_0007),
        gadgetText: cString(rt, data(0x8003_0009) >>> 0),
        gadgetID: data(0x8003_0010) & 0xffff, flags: n(a, 3),
        visualInfo: data(0x8008_0034) >>> 0, userData: data(0x8003_0011) >>> 0,
      }
      // a[2] is ng_TextAttr. Managed font rendering has no native pointer for
      // this field; the remaining public NewGadget fields are retained above.
      return VI(st().gadtools.createGadget(kind, previous, ng, tags)?.address ?? 0)
    },
    '_gt make image'(_, a) { return VI(makeGtImage(rt, st(), n(a, 0))) },
    '_gt make bitmap'(_, a) { return VI(makeGtBitmap(rt, st(), n(a, 0))) },
    '_gt make array'(_, a) {
      const labels = gtLabels(rt, n(a, 0)); const address = st().memory.alloc((labels.length + 1) * 4, { clear: true })
      if (address === 0) return VI(0)
      const pointers = labels.map(label => st().strings.fromAmos(label))
      for (let i = 0; i < pointers.length; i++) set32(st(), address + i * 4, pointers[i]!)
      st().gtArrays.set(address, pointers); return VI(address)
    },
    '_gt make list'(_, a) {
      const labels = gtLabels(rt, n(a, 0)); const list = st().exec.memory.allocList(); const allocations: number[] = []
      for (const label of labels) {
        const name = st().exec.memory.allocCString(label); const node = st().exec.memory.allocNode()
        st().exec.memory.setNodeName(node, name); st().exec.memory.addTail(list, node); allocations.push(node, name)
      }
      st().gtLists.set(list, allocations); return VI(list)
    },
    '_gt menu what check'(_, a) {
      const strip = st().gtMenuBanks.get(st().currentGtMenuBank)?.strip
      const item = strip ? st().gadtools.itemAddress(strip, fullMenuNum(n(a, 0), n(a, 1), n(a, 2))) : null
      return VI(item?.checked ? -1 : 0)
    },
    '_menu what address'(_, a) {
      const strip = st().gadtools.menuStrip(n(a, 0) >>> 0)
      return VI(menuItemAddress(st(), strip ? st().gadtools.itemAddress(strip, n(a, 1)) : null))
    },
    '_menu what menu nb'(_, a) { return VI(menuNum(n(a, 0))) },
    '_menu what item nb'(_, a) { return VI(itemNum(n(a, 0))) },
    '_menu what sub nb'(_, a) { return VI(subNum(n(a, 0))) },
    '_menu what flags'(_, a) {
      const item = st().menuItemRefs.get(n(a, 0) >>> 0)
      return VI(item ? (item.flags & ~0x110) | (item.disabled ? 0x10 : 0) | (item.checked ? 0x100 : 0) : 0)
    },
    '_menu what user'(_, a) { return VI(st().menuItemRefs.get(n(a, 0) >>> 0)?.userData ?? 0) },
    '_menu what next sel'(_, a) { return VI(st().menuItemRefs.get(n(a, 0) >>> 0)?.nextSelect ?? 0) },
    '_ggad create'(_, a) {
      const explicit = a.length >= 4; const defAt = explicit ? n(a, 0) : 0
      const kind = n(a, explicit ? 1 : 0) as GadgetKind
      const previous = st().gadtools.gadget(n(a, explicit ? 2 : 1)); const tagsAt = n(a, explicit ? 3 : 2)
      const d = st().gadgetDef
      const ng: NewGadget = defAt === 0 ? d : {
        leftEdge: structRead(rt, defAt, 2, true), topEdge: structRead(rt, defAt + 2, 2, true),
        width: structRead(rt, defAt + 4, 2, false), height: structRead(rt, defAt + 6, 2, false),
        gadgetText: st().strings.get(structRead(rt, defAt + 8, 4, false)),
        gadgetID: structRead(rt, defAt + 16, 2, false), flags: structRead(rt, defAt + 18, 4, false),
        visualInfo: structRead(rt, defAt + 22, 4, false), userData: structRead(rt, defAt + 26, 4, false),
      }
      if (!(Object.values(KIND) as number[]).includes(kind)) return VI(0)
      return VI(st().gadtools.createGadget(kind, previous, ng, tagItems(st(), tagsAt))?.address ?? 0)
    },
    '_ggad vinf get'(_, a) {
      const screenBase = n(a, 0); const binding = [...st().screenIds.values()].find((s) => s.base === (screenBase >>> 0))
      if (!binding) return VI(0)
      const screen = rt.screens.get(binding.slot); if (!screen) return VI(0)
      const depth = screen.depth
      const pens = st().screenDrawInfoPens.get(binding.slot) ?? Array.from(screenPens(depth).pens)
      return VI(st().gadtools.getVisualInfo(binding.slot, { numPens: pens.length, pens, depth }).address)
    },
    '_ggad wdef left'() { return VI(st().gadgetDef.leftEdge) },
    '_ggad wdef top'() { return VI(st().gadgetDef.topEdge) },
    '_ggad wdef width'() { return VI(st().gadgetDef.width) },
    '_ggad wdef height'() { return VI(st().gadgetDef.height) },
    '_ggad wdef text'() { return VI(st().gadgetDef.textPointer) },
    '_ggad wdef font'() { return VI(st().gadgetDef.font) },
    '_ggad wdef id'() { return VI(st().gadgetDef.gadgetID) },
    '_ggad wdef flags'() { return VI(st().gadgetDef.flags) },
    '_ggad wdef user'() { return VI(st().gadgetDef.userData ?? 0) },
    '_ggad wdef vinf'() { return VI(st().gadgetDef.visualInfo) },
    '_ggad add'(_, a) {
      const first = st().gadtools.gadget(n(a, 0)); const windowBase = n(a, 1) >>> 0
      const id = st().windowIds.keyAtBase(windowBase); const handle = id === null ? undefined : st().windowHandles.get(id)
      if (!first || !handle) return VI(-1)
      const at = Math.max(0, Math.min(n(a, 2) < 0 ? handle.window.gadgets.length : n(a, 2), handle.window.gadgets.length))
      const gadgets = st().gadtools.chain(first).map((g) => nativeGadget(st(), g))
      handle.window.gadgets.splice(at, 0, ...gadgets.filter((g) => !handle.window.gadgets.includes(g)))
      return VI(at)
    },
    /** routines 1466/1467: C length, optionally stopped by a caller byte. */
    '_str len'(_, a) { return VI(heap().length(n(a, 0), a.length > 1 ? n(a, 1) : 0)) },
    /** routines 1468/1469: copy that same bounded C span into an AMOS string. */
    '_str get'(_, a) { return VS(heap().get(n(a, 0), a.length > 1 ? n(a, 1) : 0)) },
    /** routine 1470: cleared AllocVec(capacity+8), returning base+7. */
    '_str alloc'(_, a) { return VI(heap().alloc(n(a, 0))) },
    /** routine 1475: AMOS length-word string to the private C allocation. */
    '_to str'(_, a) { return VI(heap().fromAmos(str(a[0] ?? VS('')))) },
    /** routine 1476 points at a static zero-length AMOS string. */
    '_0$'() { return VS('') },

    /** routines 1752, 1757–1759: exact register-width transformations. */
    '_join.w'(_, a) { return VI(joinWord(n(a, 0), n(a, 1))) },
    '_ext.b'(_, a) { return VI(extendByte(n(a, 0))) },
    '_ext.w'(_, a) { return VI(extendWithinWord(n(a, 0))) },
    '_ext.l'(_, a) { return VI(extendWord(n(a, 0))) },
    /** routines 26–29: fixed-width big-endian binary strings. */
    '_chr$.l'(_, a) { return VS(chrLong(n(a, 0))) },
    '_chr$.w'(_, a) { return VS(chrWord(n(a, 0))) },
    '_val.l'(_, a) { return VI(valLong(str(a[0] ?? VS('')))) },
    '_val.w'(_, a) { return VI(valWord(str(a[0] ?? VS('')))) },

    /** routines 675/676 and 1753/1754: ExecBase identity fields. */
    '_sys version'() { return VI(EXEC_VERSION) },
    '_sys revision'() { return VI(EXEC_SOFT_VERSION) },
    '_sys cpu'() { return VI(systemCpu(A1200_ATTN_FLAGS)) },
    '_sys fpu'() { return VI(systemFpu(A1200_ATTN_FLAGS)) },
    /** worker 1319: capacity in longwords, cursor, then count+1 TagItems. */
    '_tag list alloc'(_, a) {
      const count = Math.max(0, n(a, 0))
      const base = st().memory.alloc(count * 8 + 12, { clear: true })
      if (base === 0) return VI(0)
      set32(st(), base, count * 2)
      return VI((base + 8) >>> 0)
    },
    /** utility FindTagItem/GetTagData, workers 1324/1325. */
    '_tag find'(_, a) {
      const found = tagItems(st(), n(a, 0)).find((t) => t.tag === (n(a, 1) >>> 0))
      return VI(found?.address ?? 0)
    },
    '_tag data'(_, a) {
      const found = tagItems(st(), n(a, 0)).find((t) => t.tag === (n(a, 1) >>> 0))
      return VI(found?.data ?? n(a, 2))
    },
    /** workers 1848-1853 call Amiga2Date on the live system seconds. */
    '_ut sec'() { return VI(nowCivil(rt).sec) },
    '_ut min'() { return VI(nowCivil(rt).min) },
    '_ut hour'() { return VI(nowCivil(rt).hour) },
    '_ut day'() { return VI(nowCivil(rt).day) },
    '_ut month'() { return VI(nowCivil(rt).month) },
    '_ut year'() { return VI(nowCivil(rt).year) },
    /** workers 1117 and 1782: AllocMem/AllocVec over the shared mapped arena. */
    '_mem alloc'(_, a) { return VI(st().memory.alloc(n(a, 0), { clear: (n(a, 1) & MEMF.CLEAR) !== 0, chip: (n(a, 1) & MEMF.CHIP) !== 0 })) },
    '_mem abs alloc'(_, a) { return VI(st().memory.alloc(n(a, 0), { clear: (n(a, 1) & MEMF.CLEAR) !== 0, chip: (n(a, 1) & MEMF.CHIP) !== 0 })) },
    '_vec alloc'(_, a) { return VI(st().memory.alloc(n(a, 0), { clear: (n(a, 1) & MEMF.CLEAR) !== 0, chip: (n(a, 1) & MEMF.CHIP) !== 0 })) },
    '_struct alloc'(_, a) { return VI(st().memory.alloc(n(a, 0), { clear: true })) },
    /** routines 17/19/21/23/25: signed/unsigned reads at base+displacement. */
    '_struct byte'(_, a) { return VI(structRead(rt, n(a, 0) + n(a, 1), 1, true)) },
    '_struct ubyte'(_, a) { return VI(structRead(rt, n(a, 0) + n(a, 1), 1, false)) },
    '_struct word'(_, a) { return VI(structRead(rt, n(a, 0) + n(a, 1), 2, true)) },
    '_struct uword'(_, a) { return VI(structRead(rt, n(a, 0) + n(a, 1), 2, false)) },
    '_struct long'(_, a) { return VI(structRead(rt, n(a, 0) + n(a, 1), 4, true)) },
    /** routines 11-15: direct CPU-sized reads. */
    '_cpu word'(_, a) { return VI(structRead(rt, n(a, 0), 2, true)) },
    '_cpu uword'(_, a) { return VI(structRead(rt, n(a, 0), 2, false)) },
    '_cpu long'(_, a) { return VI(structRead(rt, n(a, 0), 4, true)) },
    /** workers 1589 and 1747-1751/1781/1794/1882/1152. */
    '_ibase lock'(_, a) { return VI(st().ibase.lock(n(a, 0))) },
    '_base dos'() { return VI(openLibrary('dos.library', 36)) },
    '_base gfx'() { return VI(openLibrary('graphics.library', 36)) },
    '_base int'() { return VI(openLibrary('intuition.library', 36)) },
    '_base gad'() { return VI(openLibrary('gadtools.library', 36)) },
    '_base asl'() { return VI(openLibrary('asl.library', 36)) },
    '_base icon'() { return VI(openLibrary('icon.library', 36)) },
    '_base loc'() { return VI(openLibrary('locale.library', 36)) },
    '_base dt'() { return VI(openLibrary('datatypes.library', 36)) },
    '_base layers'() { return VI(openLibrary('layers.library', 36)) },
    '_base topaz'() { return VI(topazTextAttrAddress(st())) },
    '_base tag'() { return VI(defaultTagsAddress(st())) },
    '_id unique'() { return VI(rt.uniqueIds.get()) },
    '_dbl click'(_, a) { return VI(rt.intuition.doubleClick(n(a, 0), n(a, 1), n(a, 2), n(a, 3)) ? 1 : 0) },
    /** workers 1536/1537/1539 and 1545/1557/1558: native MsgPort access. */
    '_port find'(_, a) { return VI(st().exec.messages.findPort(cString(rt, n(a, 0)))) },
    '_port create'() { return VI(st().exec.messages.createPort()) },
    '_port what sig nb'(_, a) { return VI(st().exec.messages.portSignalBit(n(a, 0))) },
    '_port what sig task'(_, a) { return VI(st().exec.messages.portSignalTask(n(a, 0))) },
    /** workers 1542/1543 and 1796: exact Message structure fields. */
    '_msg what length'(_, a) { return VI(st().exec.messages.messageLength(n(a, 0))) },
    '_msg what reply port'(_, a) { return VI(st().exec.messages.messageReplyPort(n(a, 0))) },
    '_msg get'(_, a) { return VI(st().exec.messages.getMsg(n(a, 0))) },
    /** workers 1559/1560: AllocSignal and masked SetSignal. */
    '_sig alloc'(_, a) { return VI(st().exec.messages.allocSignal(n(a, 0))) },
    '_sig set'(_, a) { return VI(st().exec.messages.setSignal(n(a, 0), n(a, 1))) },
    '_sig wait'(_, a) { return VI(st().exec.messages.wait(n(a, 0)) ?? 0) },
    '_task find'(_, a) { const address = n(a, 0) >>> 0; return VI(st().exec.tasks.find(address === 0 ? null : cString(rt, address))) },
    '_task set pri'(_, a) { return VI(st().exec.tasks.setPriority(n(a, 0), n(a, 1))) },
    '_port wait'(_, a) { return VI(st().exec.messages.waitPort(n(a, 0)) ?? 0) },
    '_gmsg get'(_, a) { return VI(st().exec.messages.getMsg(n(a, 0))) },
    /** worker 1563: cleared 22-byte native Interrupt allocation. */
    '_int alloc'() { return VI(st().exec.interrupts.alloc()) },
    /** workers 1447/1448 and 1456-1465: list allocation, search and field reads. */
    '_lnod alloc'() {
      return VI(st().exec.memory.allocList())
    },
    '_nod alloc'(_, a) { return VI(st().exec.memory.allocNode(Math.max(0, n(a, 0)))) },
    '_nod find name'(_, a) {
      const start = n(a, 0)
      const name = n(a, 1)
      if (start === 0 || name === 0) return VI(0)
      const wanted = cString(rt, name)
      for (let node = get32(st(), start); node !== 0 && get32(st(), node) !== 0; node = get32(st(), node)) {
        if (cString(rt, get32(st(), node + 10)) === wanted) return VI(node)
      }
      return VI(0)
    },
    '_lnod what head'(_, a) { return VI(st().exec.memory.listHead(n(a, 0))) },
    '_lnod what tail'(_, a) { return VI(st().exec.memory.listTail(n(a, 0))) },
    '_lnod what type'(_, a) { return VI(st().exec.memory.listType(n(a, 0))) },
    '_nod what succ'(_, a) { return VI(st().exec.memory.nodeSucc(n(a, 0))) },
    '_nod what pred'(_, a) { return VI(st().exec.memory.nodePred(n(a, 0))) },
    '_nod what type'(_, a) { return VI(st().exec.memory.nodeType(n(a, 0))) },
    '_nod what pri'(_, a) { return VI(st().exec.memory.nodePriority(n(a, 0))) },
    '_nod what name'(_, a) { return VI(st().exec.memory.nodeName(n(a, 0))) },
    '_nod what start'(_, a) { return VI(st().exec.memory.nodeStart(n(a, 0))) },
    /** workers 1130-1142 and 1146-1150: channel reads and constructors. */
    '_chn what number'(_, a) { return VI(get32(st(), n(a, 0))) },
    '_chn what default'(_, a) { return VI(get32(st(), n(a, 0) + 4)) },
    '_chn what first'(_, a) { return VI(get32(st(), n(a, 0) + 8)) },
    '_chn what last'(_, a) { return VI(get32(st(), n(a, 0) + 12)) },
    '_chn what list'(_, a) { return VI(get32(st(), n(a, 0) - 20)) },
    '_chn what length'(_, a) { return VI(get32(st(), n(a, 0) - 24)) },
    '_chn what next'(_, a) { return VI(get32(st(), n(a, 0) - 12)) },
    '_chn what previous'(_, a) { return VI(get32(st(), n(a, 0) - 16)) },
    '_chn list alloc'(_, a) {
      const list = st().memory.alloc(16, { clear: true })
      if (list !== 0) set32(st(), list + 4, n(a, 0))
      return VI(list)
    },
    '_chn add'(_, a) {
      const list = n(a, 0)
      return VI(channelAdd(st(), list, a.length > 1 ? n(a, 1) : get32(st(), list + 4)))
    },
    '_chn location'(_, a) { return VI(channelLocation(st(), n(a, 0))) },
    '_chn find'(_, a) { return VI(channelFind(st(), n(a, 0), n(a, 1))) },
    '_chn ins'(_, a, tok) {
      const id = tok?.kind === 'ext' ? tok.id : 0
      if (id === 0x02ac || id === 0x02b6) {
        const list = n(a, 0)
        const length = id === 0x02b6 ? n(a, 1) : get32(st(), list + 4)
        const position = id === 0x02b6 ? n(a, 2) : n(a, 1)
        return VI(channelInsert(st(), channelFind(st(), list, position), length))
      }
      const before = n(a, 0)
      return VI(channelInsert(st(), before, a.length > 1 ? n(a, 1) : get32(st(), get32(st(), before - 20) + 4)))
    },
    '_chn new length'(_, a) { return VI(channelResize(st(), n(a, 0) >>> 0, n(a, 1))) },
    '_dots alloc'(_, a) { return VI(st().memory.alloc(Math.max(0, n(a, 0)) * 4, { clear: true })) },
    '_dots what x'(_, a) { return VI(structRead(rt, n(a, 0) + n(a, 1) * 4, 2, true)) },
    '_dots what y'(_, a) { return VI(structRead(rt, n(a, 0) + n(a, 1) * 4 + 2, 2, true)) },
    /** workers 478-486: public IntuiMessage fields at offsets $14..$2c. */
    '_imsg what class'(_, a) { return VI(structRead(rt, n(a, 0) + 20, 4, false)) },
    '_imsg what code'(_, a) { return VI(structRead(rt, n(a, 0) + 24, 2, false)) },
    '_imsg what qualifier'(_, a) { return VI(structRead(rt, n(a, 0) + 26, 2, false)) },
    '_imsg what item'(_, a) { return VI(structRead(rt, n(a, 0) + 28, 4, false)) },
    '_imsg what x mouse'(_, a) { return VI(structRead(rt, n(a, 0) + 32, 2, true)) },
    '_imsg what y mouse'(_, a) { return VI(structRead(rt, n(a, 0) + 34, 2, true)) },
    '_imsg what seconds'(_, a) { return VI(structRead(rt, n(a, 0) + 36, 4, false)) },
    '_imsg what micros'(_, a) { return VI(structRead(rt, n(a, 0) + 40, 4, false)) },
    '_imsg what wnd'(_, a) { return VI(structRead(rt, n(a, 0) + 44, 4, false)) },
    '_ta what name'(_, a) { return VI(structRead(rt, n(a, 0), 4, false)) },
    '_ta what height'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 2, false)) },
    '_ta what style'(_, a) { return VI(structRead(rt, n(a, 0) + 6, 1, false)) },
    '_ta what flags'(_, a) { return VI(structRead(rt, n(a, 0) + 7, 1, false)) },
    '_bd what front pen'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 1, false)) },
    '_bd what back pen'(_, a) { return VI(structRead(rt, n(a, 0) + 5, 1, false)) },
    '_bd what draw mode'(_, a) { return VI(structRead(rt, n(a, 0) + 6, 1, false)) },
    '_bd what left'(_, a) { return VI(structRead(rt, n(a, 0), 2, false)) },
    '_bd what top'(_, a) { return VI(structRead(rt, n(a, 0) + 2, 2, false)) },
    '_bd what dots nb'(_, a) { return VI(structRead(rt, n(a, 0) + 7, 1, false)) },
    '_bd what dots'(_, a) { return VI(structRead(rt, n(a, 0) + 8, 4, false)) },
    '_bd what next'(_, a) { return VI(structRead(rt, n(a, 0) + 12, 4, false)) },
    '_img point in'(_, a) {
      const image = n(a, 0); const x = n(a, 1); const y = n(a, 2)
      const left = structRead(rt, image, 2, true); const top = structRead(rt, image + 2, 2, true)
      const width = structRead(rt, image + 4, 2, false); const height = structRead(rt, image + 6, 2, false)
      return VI(x >= left && y >= top && x < left + width && y < top + height ? -1 : 0)
    },
    '_img what left'(_, a) { return VI(structRead(rt, n(a, 0), 2, false)) },
    '_img what top'(_, a) { return VI(structRead(rt, n(a, 0) + 2, 2, false)) },
    '_img what width'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 2, false)) },
    '_img what height'(_, a) { return VI(structRead(rt, n(a, 0) + 6, 2, false)) },
    '_img what depth'(_, a) { return VI(structRead(rt, n(a, 0) + 8, 2, false)) },
    '_img what body'(_, a) { return VI(structRead(rt, n(a, 0) + 10, 4, false)) },
    '_img what pick'(_, a) { return VI(structRead(rt, n(a, 0) + 14, 1, false)) },
    '_img what onoff'(_, a) { return VI(structRead(rt, n(a, 0) + 15, 1, false)) },
    '_img what next'(_, a) { return VI(structRead(rt, n(a, 0) + 16, 4, false)) },
    '_bi what flags'(_, a) { return VI(structRead(rt, n(a, 0), 2, false)) },
    '_bi what mask'(_, a) { return VI(structRead(rt, n(a, 0) + 2, 4, false)) },
    '_pi what flags'(_, a) { return VI(structRead(rt, n(a, 0), 2, false)) },
    '_pi what % horiz'(_, a) { return VI(structRead(rt, n(a, 0) + 2, 2, false)) },
    '_pi what % vert'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 2, false)) },
    '_pi what % width'(_, a) { return VI(structRead(rt, n(a, 0) + 6, 2, false)) },
    '_pi what % height'(_, a) { return VI(structRead(rt, n(a, 0) + 8, 2, false)) },
    '_pi what width'(_, a) { return VI(structRead(rt, n(a, 0) + 10, 2, false)) },
    '_pi what height'(_, a) { return VI(structRead(rt, n(a, 0) + 12, 2, false)) },
    '_pi what hinc'(_, a) { return VI(structRead(rt, n(a, 0) + 14, 2, false)) },
    '_pi what vinc'(_, a) { return VI(structRead(rt, n(a, 0) + 16, 2, false)) },
    '_pi what left'(_, a) { return VI(structRead(rt, n(a, 0) + 18, 2, false)) },
    '_pi what top'(_, a) { return VI(structRead(rt, n(a, 0) + 20, 2, false)) },
    '_si what buf'(_, a) { return VI(structRead(rt, n(a, 0), 4, false)) },
    '_si what undo buf'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 4, false)) },
    '_si what pos buf'(_, a) { return VI(structRead(rt, n(a, 0) + 8, 2, false)) },
    '_si what max chars'(_, a) { return VI(structRead(rt, n(a, 0) + 10, 2, false)) },
    '_si what disp chars'(_, a) { return VI(structRead(rt, n(a, 0) + 12, 2, false)) },
    '_si what undo pos'(_, a) { return VI(structRead(rt, n(a, 0) + 14, 2, false)) },
    '_si what nb chars'(_, a) { return VI(structRead(rt, n(a, 0) + 16, 2, false)) },
    '_si what disp count'(_, a) { return VI(structRead(rt, n(a, 0) + 18, 2, false)) },
    '_si what cleft'(_, a) { return VI(structRead(rt, n(a, 0) + 20, 2, false)) },
    '_si what ctop'(_, a) { return VI(structRead(rt, n(a, 0) + 22, 2, false)) },
    '_si what ext'(_, a) { return VI(structRead(rt, n(a, 0) + 24, 4, false)) },
    '_si what integer'(_, a) { return VI(structRead(rt, n(a, 0) + 28, 4, true)) },
    '_si what keymap'(_, a) { return VI(structRead(rt, n(a, 0) + 32, 4, false)) },
    '_tr what raster'(_, a) { return VI(structRead(rt, n(a, 0), 4, false)) },
    '_tr what size'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 4, false)) },
    '_area draw'(_, a) { return VI(appendArea(rt, st(), n(a, 0), 'draw', [n(a, 1), n(a, 2)])) },
    '_area ellipse'(_, a) { return VI(appendArea(rt, st(), n(a, 0), 'ellipse', [n(a, 1), n(a, 2), n(a, 3), n(a, 4)])) },
    '_area end'(_, a) { return VI(endArea(rt, st(), n(a, 0))) },
    '_area move'(_, a) { return VI(appendArea(rt, st(), n(a, 0), 'move', [n(a, 1), n(a, 2)])) },
    '_rast alloc'(_, a) {
      const width = n(a, 0); const height = n(a, 1); const bytes = (((width + 15) >>> 4) * 2) * height
      return VI(st().memory.alloc(bytes, { clear: true, chip: true }))
    },
    '_bm what modulo'(_, a) { return VI(structRead(rt, n(a, 0), 2, false)) },
    '_bm what height'(_, a) { return VI(structRead(rt, n(a, 0) + 2, 2, false)) },
    '_bm what flags'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 1, false)) },
    '_bm what depth'(_, a) { return VI(structRead(rt, n(a, 0) + 5, 1, false)) },
    '_bm what plane'(_, a) {
      const bitmap = n(a, 0); const plane = n(a, 1); const depth = structRead(rt, bitmap + 5, 1, false)
      return VI(plane < 0 || plane >= depth ? 0 : structRead(rt, bitmap + 8 + plane * 4, 4, false))
    },
    '_rp what layer'(_, a) { return VI(structRead(rt, n(a, 0), 4, false)) },
    '_rp what bmap'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 4, false)) },
    '_rp what tmpras'(_, a) { return VI(structRead(rt, n(a, 0) + 12, 4, false)) },
    '_rp what area info'(_, a) { return VI(structRead(rt, n(a, 0) + 16, 4, false)) },
    '_rp what text base'(_, a) { return VI(structRead(rt, n(a, 0) + 62, 2, false)) },
    '_rp what xgr'(_, a) { return VI(structRead(rt, n(a, 0) + 36, 2, true)) },
    '_rp what ygr'(_, a) { return VI(structRead(rt, n(a, 0) + 38, 2, true)) },
    '_font style'(_, a) { return VI(structRead(rt, n(a, 0) + 56, 1, false)) },
    '_font open'(_, a) {
      const attr = textAttr(rt, st(), n(a, 0)); if (!attr) return VI(0)
      const system = rt.systemFont()
      if (system.name.toLowerCase() === attr.name.toLowerCase() && system.ySize === attr.ySize && (system.style & attr.style) === attr.style) return VI(nativeFont(st(), system, true))
      for (const [address, held] of st().fonts) if (held.resident && held.font.name.toLowerCase() === attr.name.toLowerCase() && held.font.ySize === attr.ySize && (held.font.style & attr.style) === attr.style) { held.opens++; return VI(address) }
      return VI(0)
    },
    '_font load'(_, a) {
      const attr = textAttr(rt, st(), n(a, 0)); if (!attr) return VI(0)
      const system = rt.systemFont()
      if (system.name.toLowerCase() === attr.name.toLowerCase() && system.ySize === attr.ySize && (system.style & attr.style) === attr.style) return VI(nativeFont(st(), system, true))
      for (const [address, held] of st().fonts) if (held.resident && held.font.name.toLowerCase() === attr.name.toLowerCase() && held.font.ySize === attr.ySize && (held.font.style & attr.style) === attr.style) { held.opens++; return VI(address) }
      const font = openDiskFont((path) => rt.vfs?.read(path) ?? null, attr.name, attr.ySize, attr.style)
      return VI(font ? nativeFont(st(), font, false) : 0)
    },
    '_font soft style'(_, a) {
      const rp = n(a, 0); const style = n(a, 1); const enable = n(a, 2)
      const old = structRead(rt, rp + 56, 1, false); const next = (old & ~enable) | (style & enable)
      structWrite(rt, rp + 56, 1, next); return VI(next & 0xff)
    },
    '_view what vport'(_, a) { return VI(structRead(rt, n(a, 0), 4, false)) },
    '_view what x'(_, a) { return VI(structRead(rt, n(a, 0) + 14, 2, true)) },
    '_view what y'(_, a) { return VI(structRead(rt, n(a, 0) + 12, 2, true)) },
    '_view what modes'(_, a) { return VI(structRead(rt, n(a, 0) + 16, 2, false)) },
    '_vp what next'(_, a) { return VI(structRead(rt, n(a, 0), 4, false)) },
    '_vp what cmap'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 4, false)) },
    '_vp what ras info'(_, a) { return VI(structRead(rt, n(a, 0) + 36, 4, false)) },
    '_vp what width'() { return VI(structRead(rt, 0x18, 2, false)) },
    '_vp what height'(_, a) { return VI(structRead(rt, n(a, 0) + 26, 2, false)) },
    '_vp what x'(_, a) { return VI(structRead(rt, n(a, 0) + 28, 2, false)) },
    '_vp what y'(_, a) { return VI(structRead(rt, n(a, 0) + 30, 2, false)) },
    '_vp what modes'(_, a) { return VI(structRead(rt, n(a, 0) + 32, 2, false)) },
    '_vp what spr pri'(_, a) { return VI(structRead(rt, n(a, 0) + 34, 1, false)) },
    '_ri what next'(_, a) { return VI(structRead(rt, n(a, 0), 4, false)) },
    '_ri what bmap'(_, a) { return VI(structRead(rt, n(a, 0) + 4, 4, false)) },
    '_ri what x'(_, a) { return VI(structRead(rt, n(a, 0) + 8, 2, true)) },
    '_ri what y'(_, a) { return VI(structRead(rt, n(a, 0) + 10, 2, true)) },
    '_rp point'(_, a) {
      const raster = nativeRaster(rt, n(a, 0)); return VI(raster ? nativePoint(rt, raster, n(a, 1), n(a, 2)) : -1)
    },
    '_rp len text'(_, a) {
      const rp = n(a, 0); const value = str(a[1] ?? VS('')); const held = st().fonts.get(structRead(rt, rp + 52, 4, false) >>> 0)
      return VI(held ? [...value].reduce((width, ch) => width + glyphMetrics(held.font, ch.charCodeAt(0)).advance, 0) : value.length * 8)
    },
    '_scr dinf get'(_, a) { return VI(allocScreenDrawInfo(rt, st(), n(a, 0))) },
    '_scr id base'(_, a) { return VI(st().screenIds.get(n(a, 0))?.base ?? 0) },
    '_scr id rport'(_, a) { return VI(st().screenIds.get(n(a, 0))?.rastPort ?? 0) },
    '_scr id vport'(_, a) { return VI(st().screenIds.get(n(a, 0))?.viewPort ?? 0) },
    '_scr id in use'() { return VI(st().currentScreenId) },
    '_scr id width'(_, a) { const r = st().screenIds.get(n(a, 0)); return VI(r ? rt.screens.get(r.slot)!.width : 0) },
    '_scr id height'(_, a) { const r = st().screenIds.get(n(a, 0)); return VI(r ? rt.screens.get(r.slot)!.height : 0) },
    '_scr id depth'(_, a) { const r = st().screenIds.get(n(a, 0)); return VI(r ? rt.screens.get(r.slot)!.depth : 0) },
    '_scr id mode'(_, a) {
      const r = st().screenIds.get(n(a, 0)); const screen = r ? rt.screens.get(r.slot) : undefined
      return VI(screen ? (screen.hires ? 0x8000 : 0) | (screen.ham ? 0x800 : 0) | (screen.laced ? 4 : 0) : 0)
    },
    '_scr id x mouse'(_, a) {
      const r = st().screenIds.get(n(a, 0)); const screen = r ? rt.screens.get(r.slot) : undefined
      return VI(screen ? rt.mouseOnScreen(screen).x : 0)
    },
    '_scr id y mouse'(_, a) {
      const r = st().screenIds.get(n(a, 0)); const screen = r ? rt.screens.get(r.slot) : undefined
      return VI(screen ? rt.mouseOnScreen(screen).y : 0)
    },
    '_scr id get pal'(_, a) {
      const pen = n(a, 0); const screen = currentScreen(rt, st())
      return VI(screen && pen >= 0 && pen < screen.palette.length ? screen.palette[pen]! & 0xfff : 0)
    },
    '_scr pub lock'(_, a) { return VI(rt.intuition.lockPubScreen(cString(rt, n(a, 0) >>> 0))) },
    '_scr pub modes'(_, a) { return VI(rt.intuition.setPubScreenModes(n(a, 0))) },
    '_scr pub status'(_, a) {
      const screen = n(a, 0); return VI(screen === 0 ? -1 : rt.intuition.pubScreenStatus(screen, n(a, 1)))
    },
    '_scr id colour'(_, a) {
      const pen = n(a, 0); const screen = currentScreen(rt, st())
      return VI(screen && pen >= 0 && pen < screen.palette.length ? screen.palette[pen]! & 0xfff : 0)
    },
    '_scr id get aga pal'(_, a) { return VI(screenRgb24(rt, st(), n(a, 0))) },
    '_scr id aga colour'(_, a) { return VI(screenRgb24(rt, st(), n(a, 0))) },
    '_scr id point'(_, a) { return VI(withScreenRastPort(rt, st(), rp => rp.point(n(a, 0), n(a, 1))) ?? -1) },
    '_wnd id base'(_, a) { return VI(st().windowIds.base(n(a, 0))) },
    '_wnd id in use'() { return VI(st().windowIds.currentId) },
    '_wnd id mask event'(_, a) { return VI(takeWindowEvent(st(), n(a, 0))) },
    '_wnd id wait event'() { return VI(takeWindowEvent(st())) },
    '_wnd id next event'() { return VI(takeWindowEvent(st())) },
    '_wnd id event wnd'() { return VI(eventWindow(st().windowEvent)) },
    '_wnd id event code'() { return VI(eventCode(st().windowEvent)) },
    '_wnd id event qualifier'() { return VI(eventQualifier(st().windowEvent)) },
    '_wnd id event gadget'() { return VI(eventGadget(st().windowEvent)) },
    '_wnd id event gt bank'() { return VI(eventGadgetBank(st().windowEvent)) },
    '_wnd id event menu'() { return VI(eventMenu(st().windowEvent)) },
    '_wnd id event item'() { return VI(eventItem(st().windowEvent)) },
    '_wnd id event sub'() { return VI(eventSub(st().windowEvent)) },
    '_wnd id event next menu'() {
      const event = st().windowEvent
      const handle = st().windowHandles.get(event.windowId)
      const strip = handle ? st().gadtools.menuStrip(handle.window.menuStrip) : null
      const item = strip ? st().gadtools.itemAddress(strip, event.code) : null
      if (!item) return VI(0)
      event.code = item.nextSelect & 0xffff
      return VI(event.code === MENUNULL ? 0 : -1)
    },
    '_wnd id event x mouse'() { return VI(eventMouseX(st().windowEvent)) },
    '_wnd id event y mouse'() { return VI(eventMouseY(st().windowEvent)) },
    '_wnd id x mouse'() { return VI(selectedWindowHandle(st())?.window.mouseX ?? 0) },
    '_wnd id y mouse'() { return VI(selectedWindowHandle(st())?.window.mouseY ?? 0) },
    '_wnd id xgr'() {
      const selected = selectedWindowHandle(st()); return VI(selected ? structRead(rt, selected.rastPort + 36, 2, true) : 0)
    },
    '_wnd id ygr'() {
      const selected = selectedWindowHandle(st()); return VI(selected ? structRead(rt, selected.rastPort + 38, 2, true) : 0)
    },
    '_wnd id x'() { return VI(selectedWindowHandle(st())?.window.leftEdge ?? 0) },
    '_wnd id y'() { return VI(selectedWindowHandle(st())?.window.topEdge ?? 0) },
    '_wnd id width'() { return VI(selectedWindowHandle(st())?.window.width ?? 0) },
    '_wnd id height'() { return VI(selectedWindowHandle(st())?.window.height ?? 0) },
    '_wnd id top bdr'() { return VI(selectedWindowHandle(st())?.window.borderTop ?? 0) },
    '_wnd id bottom bdr'() { return VI(selectedWindowHandle(st())?.window.borderBottom ?? 0) },
    '_wnd id left bdr'() { return VI(selectedWindowHandle(st())?.window.borderLeft ?? 0) },
    '_wnd id right bdr'() { return VI(selectedWindowHandle(st())?.window.borderRight ?? 0) },
    '_wnd id inner width'() {
      const w = selectedWindowHandle(st())?.window; return VI(w ? w.width - w.borderLeft - w.borderRight : 0)
    },
    '_wnd id inner height'() {
      const w = selectedWindowHandle(st())?.window; return VI(w ? w.height - w.borderTop - w.borderBottom : 0)
    },
    '_wnd id inner x mouse'() {
      const w = selectedWindowHandle(st())?.window; return VI(w ? w.mouseX - w.borderLeft : 0)
    },
    '_wnd id inner y mouse'() {
      const w = selectedWindowHandle(st())?.window; return VI(w ? w.mouseY - w.borderTop : 0)
    },
    '_wnd id point'(_, a) { return VI(withWindowRastPort(rt, st(), (rp, ox, oy) => rp.point(ox + n(a, 0), oy + n(a, 1))) ?? -1) },
    '_cm alloc'(_, a) {
      const map = allocColorMap(n(a, 0)); const address = st().memory.alloc(8, { clear: true })
      if (address !== 0) st().colorMaps.set(address, map)
      return VI(address)
    },
    '_rgb4 get'(_, a) { return VI(getRgb4(st().colorMaps.get(n(a, 0)) ?? null, n(a, 1))) },
  }
}

function nowCivil(rt: Runtime): ReturnType<typeof amiga2Date> {
  const now = rt.host.clock.now()
  return amiga2Date(now.days * 86_400 + now.mins * 60 + Math.floor(now.ticks / 50))
}
