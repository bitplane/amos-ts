/** Shared observable core of iffparse.library. */
import type { MemPool } from './exec'

export const IFFERR = { EOF: -1, EOC: -2, NO_SCOPE: -3, READ: -4, WRITE: -5, SEEK: -6, MANGLED: -7, SYNTAX: -8, NOT_IFF: -9, NO_MEM: -10 } as const
export const ID_FORM = 0x464f524d
export const ID_LIST = 0x4c495354
export const ID_CAT = 0x43415420
export const ID_PROP = 0x50524f50

export interface IffContext { address: number; id: number; type: number; size: number; scan: number; start: number; parent: number; data: Uint8Array; cursor: number }
interface IffHandle { address: number; mode: 'r' | 'w'; bytes: Uint8Array; position: number; current: number; stack: number[]; leaving: boolean; output: number[]; path: string }

const be32 = (b: Uint8Array, p: number): number => (((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0)
const put32 = (a: number[], n: number): void => { a.push(n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255) }
const isGroup = (id: number): boolean => id === ID_FORM || id === ID_LIST || id === ID_CAT || id === ID_PROP

export class IffParse {
  readonly handles = new Map<number, IffHandle>()
  readonly contexts = new Map<number, IffContext>()
  constructor(private readonly memory: MemPool) {}

  openIn(path: string, bytes: Uint8Array): number { return this.open(path, 'r', bytes) }
  openOut(path: string): number { return this.open(path, 'w', new Uint8Array()) }
  private open(path: string, mode: 'r' | 'w', bytes: Uint8Array): number {
    const address = this.memory.alloc(32, { clear: true }); if (!address) return 0
    this.handles.set(address, { address, mode, bytes, position: 0, current: 0, stack: [], leaving: false, output: [], path }); return address
  }
  close(address: number): { path: string; bytes: Uint8Array } | null {
    const h = this.handles.get(address); if (!h) return null
    this.handles.delete(address); for (const p of h.stack) this.freeContext(p)
    this.memory.freeMem(address)
    return h.mode === 'w' ? { path: h.path, bytes: Uint8Array.from(h.output) } : null
  }
  parse(address: number, control: number): number {
    const h = this.handles.get(address); if (!h || h.mode !== 'r') return IFFERR.READ
    if (control !== 0 && control !== 1 && control !== 2) return IFFERR.SYNTAX
    if (control === 0) {
      let result = 0
      while (result === 0 || result === IFFERR.EOC) result = this.step(h)
      return result
    }
    return this.step(h)
  }
  private step(h: IffHandle): number {
    if (h.position === 0 && (h.bytes.length < 12 || !isGroup(be32(h.bytes, 0)))) return IFFERR.NOT_IFF
    if (h.leaving) {
      const old = h.stack.pop(); if (old !== undefined) this.freeContext(old)
      h.current = h.stack.at(-1) ?? 0; h.leaving = false
    }
    const current = this.contexts.get(h.current)
    if (current && !isGroup(current.id)) {
      current.scan = current.size; current.cursor = current.data.length
      h.position = current.start + 8 + ((current.size + 1) & ~1); this.syncContext(current); this.syncReadGroups(h); h.leaving = true
      return IFFERR.EOC
    }
    if (current && h.position >= current.start + 8 + current.size) {
      current.scan = current.size; h.position = current.start + 8 + ((current.size + 1) & ~1)
      this.syncContext(current); this.syncReadGroups(h); h.leaving = true; return IFFERR.EOC
    }
    if (!current && h.position >= h.bytes.length) return IFFERR.EOF
    const p = h.position; if (p + 8 > h.bytes.length) return IFFERR.EOF
    const id = be32(h.bytes, p), size = be32(h.bytes, p + 4); if (p + 8 + size > h.bytes.length) return IFFERR.MANGLED
    const parent = h.stack.at(-1) ?? 0; const type = id === ID_FORM && size >= 4 ? be32(h.bytes, p + 8) : (parent ? this.contexts.get(parent)?.type ?? 0 : 0)
    const group = isGroup(id); if (group && size < 4) return IFFERR.MANGLED
    const actualType = group ? be32(h.bytes, p + 8) : type
    const dataAt = p + 8 + (group ? 4 : 0), dataSize = size - (group ? 4 : 0)
    const ctx = this.allocContext(id, actualType, size, p, parent, h.bytes.subarray(dataAt, dataAt + dataSize), group ? 4 : 0); if (!ctx) return IFFERR.NO_MEM
    h.stack.push(ctx.address); h.current = ctx.address; h.position = dataAt; this.syncReadGroups(h)
    return 0
  }
  current(h: number): number { return this.handles.get(h)?.current ?? 0 }
  /** Entire immutable input stream, for consumers such as datatypes.library. */
  input(h: number): Uint8Array | null {
    const handle = this.handles.get(h)
    return handle?.mode === 'r' ? handle.bytes : null
  }
  parent(c: number): number { return this.contexts.get(c)?.parent ?? 0 }
  context(c: number): IffContext | undefined { return this.contexts.get(c) }
  read(hp: number, size: number): Uint8Array | null { const h = this.handles.get(hp), c = h && this.contexts.get(h.current); if (!h || !c || isGroup(c.id)) return null; const out = c.data.subarray(c.cursor, c.cursor + Math.max(0, size)); c.cursor += out.length; c.scan = c.cursor; h.position += out.length; this.syncContext(c); this.syncReadGroups(h); return out }
  push(hp: number, type: number, id: number, size: number): number {
    const h = this.handles.get(hp); if (!h || h.mode !== 'w') return IFFERR.WRITE
    const start = h.output.length; put32(h.output, id); put32(h.output, size < 0 ? 0 : size); if (id === ID_FORM) put32(h.output, type)
    const c = this.allocContext(id, type, size, start, h.stack.at(-1) ?? 0, new Uint8Array(), isGroup(id) ? 4 : 0); if (!c) return IFFERR.NO_MEM
    h.stack.push(c.address); h.current = c.address; return 0
  }
  write(hp: number, bytes: Uint8Array): number { const h = this.handles.get(hp), c = h && this.contexts.get(h.current); if (!h || h.mode !== 'w' || !c) return IFFERR.WRITE; h.output.push(...bytes); c.scan += bytes.length; this.syncContext(c); this.syncWriteGroups(h); return bytes.length }
  pop(hp: number): number {
    const h = this.handles.get(hp), cp = h?.stack.pop(); if (!h || cp === undefined) return IFFERR.NO_SCOPE
    const c = this.contexts.get(cp)!; const actual = h.output.length - c.start - 8
    if (c.size < 0) for (let i = 0; i < 4; i++) h.output[c.start + 4 + i] = actual >>> (24 - i * 8) & 255
    if (actual & 1) h.output.push(0); h.current = h.stack.at(-1) ?? 0; this.freeContext(cp); this.syncWriteGroups(h); return 0
  }
  private allocContext(id: number, type: number, size: number, start: number, parent: number, data: Uint8Array, scan: number): IffContext | null {
    const address = this.memory.alloc(32, { clear: true }); if (!address) return null
    const c = { address, id, type, size, scan, start, parent, data, cursor: 0 }; this.contexts.set(address, c); this.syncContext(c); return c
  }
  private syncContext(c: IffContext): void {
    const at = c.address - this.memory.base
    const view = new DataView(this.memory.buffer.buffer, this.memory.buffer.byteOffset, this.memory.buffer.byteLength)
    view.setUint32(at + 8, c.id); view.setUint32(at + 12, c.type); view.setInt32(at + 16, c.size); view.setInt32(at + 20, c.scan)
  }
  private syncReadGroups(h: IffHandle): void {
    for (const address of h.stack) {
      const c = this.contexts.get(address)
      if (!c || !isGroup(c.id)) continue
      c.scan = Math.max(4, Math.min(c.size, h.position - c.start - 8)); this.syncContext(c)
    }
  }
  private syncWriteGroups(h: IffHandle): void {
    for (const address of h.stack) {
      const c = this.contexts.get(address)
      if (!c || !isGroup(c.id)) continue
      c.scan = Math.max(4, h.output.length - c.start - 8); this.syncContext(c)
    }
  }
  private freeContext(p: number): void { if (this.contexts.delete(p)) this.memory.freeMem(p) }
}
