import { describe, expect, it } from 'vitest'
import { chrLong, chrWord, extendByte, extendWithinWord, extendWord, joinWord, valLong, valWord } from './osscalar'

describe('OS DevKit scalar workers', () => {
  it('reproduces the exact swap/move.w/swap join', () => {
    expect(joinWord(0x1234_5678, 0xabcd_9abc)).toBe(0x9abc_1234 | 0)
  })

  it('distinguishes byte extension, word-local extension and long extension', () => {
    expect(extendByte(0x1234_5680)).toBe(-128)
    expect(extendWithinWord(0x1234_5680) >>> 0).toBe(0x1234_ff80)
    expect(extendWord(0x1234_8001)).toBe(-32767)
  })

  it('round-trips big-endian long and word binary strings', () => {
    expect([...chrLong(0x1234_80ff)].map((c) => c.charCodeAt(0))).toEqual([0x12, 0x34, 0x80, 0xff])
    expect(valLong(chrLong(0x1234_80ff)) >>> 0).toBe(0x1234_80ff)
    expect([...chrWord(0x80ff)].map((c) => c.charCodeAt(0))).toEqual([0x80, 0xff])
    expect(valWord(chrWord(0x80ff))).toBe(0x80ff)
  })
})
