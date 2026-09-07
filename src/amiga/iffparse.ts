/** Shared observable core of iffparse.library. */
import type { MemPool } from './exec'

export const IFFERR = { EOF: -1, EOC: -2, NO_SCOPE: -3, READ: -4, WRITE: -5, SEEK: -6, MANGLED: -7, SYNTAX: -8, NOT_IFF: -9, NO_MEM: -10 } as const
export const ID_FORM = 0x464f524d

export interface IffContext { address: number; id: number; type: number; size: number; scan: number; parent: number; data: Uint8Array; cursor: number }
interface IffHandle { address: number; mode: 'r' | 'w'; bytes: Uint8Array; position: number; current: number; stack: number[]; output: number[]; path: string }

const be32 = (b: Uint8Array, p: number): number => (((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0)
const put32 = (a: number[], n: number): void => { a.push(n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255) }

export class IffParse {
  readonly handles = new Map<number, IffHandle>()
  readonly contexts = new Map<number, IffContext>()
  constructor(private readonly memory: MemPool) {}

  openIn(path: string, bytes: Uint8Array): number { return this.open(path, 'r', bytes) }
  openOut(path: string): number { return this.open(path, 'w', new Uint8Array()) }
  private open(path: string, mode: 'r' | 'w', bytes: Uint8Array): number {
    const address = this.memory.alloc(32, { clear: true }); if (!address) return 0
    this.handles.set(address, { address, mode, bytes, position: 0, current: 0, stack: [], output: [], path }); return address
  }
  close(address: number): { path: string; bytes: Uint8Array } | null {
    const h = this.handles.get(address); if (!h) return null
    this.handles.delete(address); for (const p of h.stack) this.freeContext(p); if (h.current) this.freeContext(h.current)
    this.memory.freeMem(address)
    return h.mode === 'w' ? { path: h.path, bytes: Uint8Array.from(h.output) } : null
  }
  parse(address: number, control: number): number {
    const h = this.handles.get(address); if (!h || h.mode !== 'r') return IFFERR.READ
    if (control !== 0 && control !== 1 && control !== 2) return IFFERR.SYNTAX
    if (h.position === 0 && (h.bytes.length < 12 || be32(h.bytes, 0) !== ID_FORM)) return IFFERR.NOT_IFF
    if (h.current && h.stack.at(-1) !== h.current) { const old = this.contexts.get(h.current); if (old) h.position += 8 + ((old.size + 1) & ~1); this.freeContext(h.current); h.current = 0 }
    while (h.position >= this.scopeEnd(h)) { const parent = h.stack.pop(); if (parent === undefined) return IFFERR.EOF; h.position = this.scopeEnd(h); h.current = parent; return IFFERR.EOC }
    const p = h.position; if (p + 8 > h.bytes.length) return IFFERR.EOF
    const id = be32(h.bytes, p), size = be32(h.bytes, p + 4); if (p + 8 + size > h.bytes.length) return IFFERR.MANGLED
    const parent = h.stack.at(-1) ?? 0; const type = id === ID_FORM && size >= 4 ? be32(h.bytes, p + 8) : (parent ? this.contexts.get(parent)?.type ?? 0 : 0)
    const dataAt = p + 8 + (id === ID_FORM ? 4 : 0), dataSize = size - (id === ID_FORM ? 4 : 0)
    const ctx = this.allocContext(id, type, size, p, parent, h.bytes.subarray(dataAt, dataAt + dataSize)); if (!ctx) return IFFERR.NO_MEM
    h.current = ctx.address
    if (id === ID_FORM) { h.stack.push(ctx.address); h.current = ctx.address; h.position = p + 12 } else h.position = p
    return 0
  }
  private scopeEnd(h: IffHandle): number { const p = h.stack.at(-1); if (!p) return h.bytes.length; const c = this.contexts.get(p)!; return c.scan + 8 + c.size }
  current(h: number): number { return this.handles.get(h)?.current ?? 0 }
  parent(c: number): number { return this.contexts.get(c)?.parent ?? 0 }
  context(c: number): IffContext | undefined { return this.contexts.get(c) }
  read(hp: number, size: number): Uint8Array | null { const h = this.handles.get(hp), c = h && this.contexts.get(h.current); if (!c) return null; const out = c.data.subarray(c.cursor, c.cursor + Math.max(0, size)); c.cursor += out.length; return out }
  push(hp: number, type: number, id: number, size: number): number {
    const h = this.handles.get(hp); if (!h || h.mode !== 'w') return IFFERR.WRITE
    const start = h.output.length; put32(h.output, id); put32(h.output, size < 0 ? 0 : size); if (id === ID_FORM) put32(h.output, type)
    const c = this.allocContext(id, type, size, start, h.stack.at(-1) ?? 0, new Uint8Array()); if (!c) return IFFERR.NO_MEM
    h.stack.push(c.address); h.current = c.address; return 0
  }
  write(hp: number, bytes: Uint8Array): number { const h = this.handles.get(hp); if (!h || h.mode !== 'w' || !h.stack.length) return IFFERR.WRITE; h.output.push(...bytes); return bytes.length }
  pop(hp: number): number {
    const h = this.handles.get(hp), cp = h?.stack.pop(); if (!h || cp === undefined) return IFFERR.NO_SCOPE
    const c = this.contexts.get(cp)!; const actual = h.output.length - c.scan - 8
    if (c.size < 0) for (let i = 0; i < 4; i++) h.output[c.scan + 4 + i] = actual >>> (24 - i * 8) & 255
    if (actual & 1) h.output.push(0); h.current = h.stack.at(-1) ?? 0; this.freeContext(cp); return 0
  }
  private allocContext(id: number, type: number, size: number, scan: number, parent: number, data: Uint8Array): IffContext | null {
    const address = this.memory.alloc(32, { clear: true }); if (!address) return null
    const c = { address, id, type, size, scan, parent, data, cursor: 0 }; this.contexts.set(address, c); return c
  }
  private freeContext(p: number): void { if (this.contexts.delete(p)) this.memory.freeMem(p) }
}
