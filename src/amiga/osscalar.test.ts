import { describe, expect, it } from 'vitest'
import { chrLong, chrWord, extendByte, extendWithinWord, extendWord, joinWord, OsRegisterFrame, osAmosName, valLong, valWord } from './osscalar'

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

  it('stores all eight data and address registers as longwords', () => {
    const f = new OsRegisterFrame()
    f.setData(1, 0x1234_5678)
    f.setAddress(7, -1)
    expect(f.data(1)).toBe(0x1234_5678)
    expect(f.address(7)).toBe(-1)
  })

  it('prefixes the private AMOS name and truncates its payload to 31 bytes', () => {
    expect(osAmosName('OS')).toBe('~OS')
    expect(osAmosName('x'.repeat(40))).toBe('~' + 'x'.repeat(31))
  })
})
