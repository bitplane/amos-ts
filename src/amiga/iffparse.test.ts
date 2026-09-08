import { describe, expect, it } from 'vitest'
import { MemPool } from './exec'
import { ID_FORM, ID_LIST, IFFERR, IffParse } from './iffparse'

const id = (s: string): number => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0
const pool = (): MemPool => new MemPool(0x1000_0000, 0x10000)
const field = (memory: MemPool, address: number, offset: number): number =>
  new DataView(memory.buffer.buffer, memory.buffer.byteOffset).getInt32(address - memory.base + offset)

describe('iffparse.library shared backend', () => {
  it('raw-steps contexts and publishes the exact ContextNode prefix', () => {
    const memory = pool(); const iff = new IffParse(memory)
    const bytes = Uint8Array.from([
      0x46,0x4f,0x52,0x4d, 0,0,0,14, 0x54,0x45,0x53,0x54,
      0x44,0x41,0x54,0x41, 0,0,0,2, 0x12,0x34,
    ])
    const handle = iff.openIn('RAM:test.iff', bytes)
    expect(iff.parse(handle, 2)).toBe(0)
    const form = iff.current(handle); expect([field(memory, form, 8) >>> 0, field(memory, form, 12) >>> 0, field(memory, form, 16), field(memory, form, 20)]).toEqual([ID_FORM, id('TEST'), 14, 4])
    expect(iff.parse(handle, 2)).toBe(0)
    const data = iff.current(handle); expect(iff.parent(data)).toBe(form)
    expect(iff.read(handle, 1)).toEqual(Uint8Array.of(0x12)); expect(field(memory, data, 20)).toBe(1)
    expect(iff.parse(handle, 2)).toBe(IFFERR.EOC); expect(iff.current(handle)).toBe(data)
    expect(iff.parse(handle, 2)).toBe(IFFERR.EOC); expect(iff.current(handle)).toBe(form)
    expect(iff.parse(handle, 2)).toBe(IFFERR.EOF); expect(iff.current(handle)).toBe(0)
  })

  it('SCAN consumes an unhandled file and recognizes every complex group ID', () => {
    for (const group of [ID_FORM, ID_LIST, id('CAT '), id('PROP')]) {
      const memory = pool(); const iff = new IffParse(memory)
      const bytes = Uint8Array.from([group >>> 24, group >>> 16 & 255, group >>> 8 & 255, group & 255, 0,0,0,4, 0x54,0x45,0x53,0x54])
      const handle = iff.openIn('RAM:group.iff', bytes)
      expect(iff.parse(handle, 0)).toBe(IFFERR.EOF)
      expect(iff.current(handle)).toBe(0)
    }
  })

  it('tracks write progress and back-patches unknown chunk sizes', () => {
    const memory = pool(); const iff = new IffParse(memory); const handle = iff.openOut('RAM:out.iff')
    expect(iff.push(handle, id('TEST'), ID_FORM, -1)).toBe(0)
    const form = iff.current(handle); expect(field(memory, form, 20)).toBe(4)
    expect(iff.push(handle, id('TEST'), id('DATA'), -1)).toBe(0)
    const data = iff.current(handle); expect(iff.write(handle, Uint8Array.of(1, 2, 3))).toBe(3)
    expect(field(memory, data, 20)).toBe(3)
    expect(iff.pop(handle)).toBe(0); expect(field(memory, form, 20)).toBe(16)
    expect(iff.pop(handle)).toBe(0)
    const result = iff.close(handle); expect(result?.bytes.length).toBe(24)
    expect(Array.from(result!.bytes.slice(4, 8))).toEqual([0, 0, 0, 16])
    expect(Array.from(result!.bytes.slice(16, 20))).toEqual([0, 0, 0, 3])
  })
})
