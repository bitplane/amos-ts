import { describe, expect, it } from 'vitest'
import { M68030 } from './cpu'

describe('Exec CPU-cache operations', () => {
  it('CacheControl returns the old word and changes only masked bits', () => {
    const cpu = new M68030()
    expect(cpu.cacheControl(0b1010, 0b1111)).toBe(0)
    expect(cpu.cacheBits).toBe(0b1010)
    expect(cpu.cacheControl(0b0101, 0b0011)).toBe(0b1010)
    expect(cpu.cacheBits).toBe(0b1001)
  })

  it('CacheClearU is valid on the coherent backend and does not change controls', () => {
    const cpu = new M68030()
    cpu.cacheControl(0x8000_0001, 0xffff_ffff)
    cpu.clearCaches()
    expect(cpu.cacheBits).toBe(0x8000_0001)
  })
})
