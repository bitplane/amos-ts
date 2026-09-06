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
import {
  chrLong, chrWord, extendByte, extendWithinWord, extendWord, joinWord, valLong, valWord,
} from '../amiga/osscalar'
import {
  A1200_ATTN_FLAGS, EXEC_SOFT_VERSION, EXEC_VERSION, systemCpu, systemFpu,
} from '../amiga/ossystem'
import type { Runtime } from './runtime'

export interface OsDevKitState {
  memory: MemPool
  strings: OsCStringHeap
  /** routine 1320's null/EntNul target: the library's private TagItem list. */
  defaultTags: Array<{ tag: number; data: number }>
  ibase: IntuitionBaseLock
}

export const newOsDevKitState = (): OsDevKitState => {
  const strings = new OsCStringHeap()
  return { memory: strings.memory, strings, defaultTags: [], ibase: new IntuitionBaseLock() }
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
  }
}

function nowCivil(rt: Runtime): ReturnType<typeof amiga2Date> {
  const now = rt.host.clock.now()
  return amiga2Date(now.days * 86_400 + now.mins * 60 + Math.floor(now.ticks / 50))
}
