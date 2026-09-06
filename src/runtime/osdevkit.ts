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
import { MEMF, type MemPool, openLibrary } from '../amiga/exec'
import { amiga2Date } from '../amiga/datestamp'
import { IntuitionBaseLock } from '../amiga/intuition'
import type { ExecSystem } from '../amiga/osexec'
import {
  allocColorMap, freeColorMap, getRgb4, getRgb32, setRgb4ColorMap, setRgb32ColorMap,
  type NativeColorMap,
} from '../amiga/oscolormap'
import {
  chrLong, chrWord, extendByte, extendWithinWord, extendWord, joinWord, valLong, valWord,
} from '../amiga/osscalar'
import {
  A1200_ATTN_FLAGS, EXEC_SOFT_VERSION, EXEC_VERSION, systemCpu, systemFpu,
} from '../amiga/ossystem'
import type { Runtime } from './runtime'

const SCREEN_CTRL_BASE = 0x4800_0000
const SCREEN_CTRL_SLOT = 0x1000

export interface OsDevKitState {
  memory: MemPool
  strings: OsCStringHeap
  /** routine 1320's null/EntNul target: the library's private TagItem list. */
  defaultTags: Array<{ tag: number; data: number }>
  ibase: IntuitionBaseLock
  exec: ExecSystem
  colorMaps: Map<number, NativeColorMap>
  screenIds: Map<number, { slot: number; base: number; rastPort: number; viewPort: number; bitMap: number; owned: boolean }>
  currentScreenId: number
}

export const newOsDevKitState = (exec: ExecSystem): OsDevKitState => {
  const strings = new OsCStringHeap(exec.pool)
  return {
    memory: exec.pool, strings, defaultTags: [], ibase: new IntuitionBaseLock(), exec, colorMaps: new Map(),
    screenIds: new Map(), currentScreenId: -1,
  }
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

function tagItems(st: OsDevKitState, list: number): Array<{ tag: number; data: number; address: number }> {
  if (list === 0 || list === -0x8000_0000) return st.defaultTags.map((t, i) => ({ ...t, address: 0x50_000000 + i * 8 }))
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
    st.defaultTags.push({ tag: tag >>> 0, data: data | 0 })
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
    st.defaultTags.push({ tag: 0, data: 0 })
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

function nativePlot(rt: Runtime, raster: NativeRaster, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return
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

function nativePutColor(rt: Runtime, raster: NativeRaster, x: number, y: number, color: number): void {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return
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

function bindScreenId(rt: Runtime, state: OsDevKitState, id: number, slot: number, owned = false): boolean {
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
  state.screenIds.set(id, {
    slot, base: (SCREEN_CTRL_BASE + slot * SCREEN_CTRL_SLOT) >>> 0,
    rastPort, viewPort, bitMap, owned,
  })
  state.currentScreenId = id
  return true
}

function currentScreenRaster(rt: Runtime, state: OsDevKitState): NativeRaster | null {
  const record = state.screenIds.get(state.currentScreenId)
  return record ? nativeRaster(rt, record.rastPort) : null
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
  return {
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
    /** workers 1534/1535/1538 and 1541: Exec public-port and message delivery. */
    '_port add'(it) { st().exec.messages.addPort(it.evalInt()) },
    '_port rem'(it) { st().exec.messages.remPort(it.evalInt()) },
    '_port delete'(it) { st().exec.messages.deletePort(it.evalInt()) },
    '_msg put'(it) {
      const port = it.evalInt(); it.expect(',')
      st().exec.messages.putMsg(port, it.evalInt())
    },
    '_msg reply'(it) { st().exec.messages.replyMsg(it.evalInt()) },
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
    '_cop init view'(it) {
      const view = it.evalInt(); for (let at = 0; at < 18; at++) structWrite(rt, view + at, 1, 0)
    },
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
    '_view set'(it) {
      const [view, viewPort, _x, _y, modes] = readArgs(it, 5)
      structWrite(rt, view!, 4, viewPort!); structWrite(rt, view! + 12, 4, modes!)
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
      // A null rp_Font has no glyph source, but Text still advances the cursor.
      structWrite(rt, rp + 36, 2, structRead(rt, rp + 36, 2, true) + value.length * 8)
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
    '_scr id from pointer'(it) {
      const [id, pointer] = readArgs(it, 2)
      const relative = (pointer! >>> 0) - SCREEN_CTRL_BASE
      if (relative >= 0 && relative % SCREEN_CTRL_SLOT === 0) bindScreenId(rt, st(), id!, relative / SCREEN_CTRL_SLOT)
    },
    '_scr id use'(it) {
      const id = it.evalInt(); if (st().screenIds.has(id)) st().currentScreenId = id
    },
    '_scr id close'(it) {
      const id = it.evalInt(); const record = st().screenIds.get(id)
      if (!record) return
      st().memory.freeMem(record.rastPort); st().memory.freeMem(record.viewPort); st().memory.freeMem(record.bitMap)
      if (record.owned) rt.closeScreen(record.slot)
      st().screenIds.delete(id); if (st().currentScreenId === id) st().currentScreenId = -1
    },
    '_scr id show'(it) { const r = st().screenIds.get(it.evalInt()); if (r) rt.screens.get(r.slot)!.visible = true },
    '_scr id hide'(it) { const r = st().screenIds.get(it.evalInt()); if (r) rt.screens.get(r.slot)!.visible = false },
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
      const pen = it.evalInt(); const raster = currentScreenRaster(rt, st())
      if (!raster) return
      const old = structRead(rt, raster.rp + 25, 1, false); structWrite(rt, raster.rp + 25, 1, pen)
      for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) nativePutColor(rt, raster, x, y, pen)
      structWrite(rt, raster.rp + 25, 1, old)
    },
    '_scr id plot'(it) {
      const [x, y] = readArgs(it, 2); const raster = currentScreenRaster(rt, st()); if (raster) nativePlot(rt, raster, x!, y!)
    },
    '_scr id set line'(it) {
      const raster = currentScreenRaster(rt, st()); if (raster) structWrite(rt, raster.rp + 34, 2, it.evalInt())
      else it.evalInt()
    },
    '_scr id rect'(it) {
      const x1 = it.evalInt(); it.expect(','); const y1 = it.evalInt(); it.expect('to')
      const x2 = it.evalInt(); it.expect(','); const y2 = it.evalInt(); const raster = currentScreenRaster(rt, st())
      if (raster) { nativeDraw(rt, raster, x1, y1, x2, y1); nativeDraw(rt, raster, x2, y1, x2, y2); nativeDraw(rt, raster, x2, y2, x1, y2); nativeDraw(rt, raster, x1, y2, x1, y1) }
    },
    '_scr id line to'(it) {
      const [x, y] = readArgs(it, 2); const raster = currentScreenRaster(rt, st())
      if (raster) nativeDraw(rt, raster, structRead(rt, raster.rp + 36, 2, true), structRead(rt, raster.rp + 38, 2, true), x!, y!)
    },
    '_scr id line'(it) {
      const x1 = it.evalInt(); it.expect(','); const y1 = it.evalInt(); it.expect('to')
      const x2 = it.evalInt(); it.expect(','); const y2 = it.evalInt(); const raster = currentScreenRaster(rt, st())
      if (raster) nativeDraw(rt, raster, x1, y1, x2, y2)
    },
    '_scr id ellipse'(it) {
      const [x, y, rx, ry] = readArgs(it, 4); const raster = currentScreenRaster(rt, st())
      if (raster) nativeEllipse(rt, raster, x!, y!, rx!, ry!)
    },
    '_scr id gr locate'(it) {
      const [x, y] = readArgs(it, 2); const raster = currentScreenRaster(rt, st())
      if (raster) { structWrite(rt, raster.rp + 36, 2, x!); structWrite(rt, raster.rp + 38, 2, y!) }
    },
    '_scr id text'(it) {
      const x = it.evalInt(); it.expect(','); const y = it.evalInt(); it.expect(','); const value = it.evalStr()
      const raster = currentScreenRaster(rt, st()); if (!raster) return
      structWrite(rt, raster.rp + 36, 2, x + value.length * 8); structWrite(rt, raster.rp + 38, 2, y)
    },
  }
}

export function makeOsDevKitFunctions(rt: Runtime): Record<string, Func> {
  const st = (): OsDevKitState => rt.osdevkit
  const heap = (): OsCStringHeap => rt.osdevkit.strings
  const n = (a: Parameters<Func>[1], at: number): number => int(a[at] ?? VI(0))
  return {
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
    /** workers 1536/1537/1539 and 1545/1557/1558: native MsgPort access. */
    '_port find'(_, a) { return VI(st().exec.messages.findPort(cString(rt, n(a, 0)))) },
    '_port create'() { return VI(st().exec.messages.createPort()) },
    '_port what sig nb'(_, a) { return VI(st().exec.messages.portSignalBit(n(a, 0))) },
    '_port what sig task'(_, a) { return VI(st().exec.messages.portSignalTask(n(a, 0))) },
    /** workers 1542/1543 and 1796: exact Message structure fields. */
    '_msg what length'(_, a) { return VI(st().exec.messages.messageLength(n(a, 0))) },
    '_msg what reply port'(_, a) { return VI(st().exec.messages.messageReplyPort(n(a, 0))) },
    /** workers 1559/1560: AllocSignal and masked SetSignal. */
    '_sig alloc'(_, a) { return VI(st().exec.messages.allocSignal(n(a, 0))) },
    '_sig set'(_, a) { return VI(st().exec.messages.setSignal(n(a, 0), n(a, 1))) },
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
    '_rp len text'(_, a) { return VI(str(a[1] ?? VS('')).length * 8) },
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
    '_scr id point'(_, a) {
      const raster = currentScreenRaster(rt, st()); return VI(raster ? nativePoint(rt, raster, n(a, 0), n(a, 1)) : -1)
    },
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
