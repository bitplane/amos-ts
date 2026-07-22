import { describe, expect, it } from 'vitest'
import { BinReader } from './binreader'

describe('BinReader', () => {
  it('reads big-endian integers', () => {
    const r = new BinReader(new Uint8Array([0x12, 0x34, 0x56, 0x78, 0xff, 0xfe]))
    expect(r.u16()).toBe(0x1234)
    expect(r.u32()).toBe(0x5678fffe)
    expect(r.remaining).toBe(0)
  })

  it('reads signed values', () => {
    const r = new BinReader(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xfe]))
    expect(r.i16()).toBe(-1)
    expect(r.i32()).toBe(-2)
  })

  it('reads Latin-1 strings and peeks without advancing', () => {
    const bytes = new Uint8Array([...'AMOS Pro'].map((c) => c.charCodeAt(0)))
    const r = new BinReader(bytes)
    expect(r.peekStr(4)).toBe('AMOS')
    expect(r.pos).toBe(0)
    expect(r.str(8)).toBe('AMOS Pro')
  })

  it('throws on out-of-bounds reads and seeks', () => {
    const r = new BinReader(new Uint8Array([0, 1]))
    expect(() => r.raw(3)).toThrow(RangeError)
    expect(() => r.seek(5)).toThrow(RangeError)
  })
})
