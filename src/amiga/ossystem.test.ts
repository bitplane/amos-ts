import { describe, expect, it } from 'vitest'
import {
  A1200_ATTN_FLAGS, EXEC_SOFT_VERSION, EXEC_VERSION, currentSystemTime, systemCpu, systemFpu,
} from './ossystem'

describe('OS DevKit system identity operations', () => {
  it('uses the Amiga system-time epoch and splits microseconds', () => {
    expect(currentSystemTime(Date.UTC(1978, 0, 1, 0, 0, 1, 234))).toEqual({ seconds: 1, micros: 234000 })
  })

  it('reads the modelled Exec version and SoftVer identities', () => {
    expect(EXEC_VERSION).toBe(40)
    expect(EXEC_SOFT_VERSION).toBe(0)
  })

  it('matches routine 1753 CPU arithmetic for every low AttnFlags bit', () => {
    expect(systemCpu(0)).toBe(0)
    expect(systemCpu(1)).toBe(10)
    expect(systemCpu(2)).toBe(10)
    expect(systemCpu(4)).toBe(10)
    expect(systemCpu(8)).toBe(10)
    expect(systemCpu(15)).toBe(40)
    expect(systemCpu(A1200_ATTN_FLAGS)).toBe(20)
  })

  it('matches routine 1754 FPU arithmetic, including its 68040 bit-clears', () => {
    expect(systemFpu(0)).toBe(0)
    expect(systemFpu(1 << 4)).toBe(81)
    expect(systemFpu(1 << 5)).toBe(1)
    expect(systemFpu((1 << 4) | (1 << 5))).toBe(82)
    expect(systemFpu(1 << 6)).toBe(40)
    expect(systemFpu((1 << 4) | (1 << 6))).toBe(41)
    expect(systemFpu(A1200_ATTN_FLAGS)).toBe(0)
  })
})
