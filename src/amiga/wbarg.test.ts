import { describe, expect, it } from 'vitest'
import { wbArgLock, wbArgName, type WbArg } from './wbarg'

describe('OS DevKit WBArg readers: routines 1866/1867', () => {
  const args: WbArg[] = [
    { lock: 0x1111, name: 0xaaaa },
    { lock: 0x2222, name: 0xbbbb },
  ]

  it('reads the one-based name and lock fields', () => {
    expect(wbArgName(args, 2, 2)).toBe(0xbbbb)
    expect(wbArgLock(args, 2, 2)).toBe(0x2222)
  })

  it('returns zero for either bound or a null array', () => {
    for (const index of [0, -1, 3]) {
      expect(wbArgName(args, 2, index)).toBe(0)
      expect(wbArgLock(args, 2, index)).toBe(0)
    }
    expect(wbArgName(null, 2, 1)).toBe(0)
    expect(wbArgLock(null, 2, 1)).toBe(0)
  })
})
