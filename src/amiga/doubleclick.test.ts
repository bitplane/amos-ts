import { describe, expect, it } from 'vitest'
import { doubleClick } from './doubleclick'

describe('intuition DoubleClick', () => {
  it('normalizes microseconds across a seconds boundary', () => {
    expect(doubleClick(10, 900_000, 11, 100_000)).toBe(true)
    expect(doubleClick(10, 900_000, 11, 500_001)).toBe(false)
  })

  it('rejects timestamps in reverse order and accepts the interval boundary', () => {
    expect(doubleClick(11, 0, 10, 999_999)).toBe(false)
    expect(doubleClick(10, 0, 10, 500_000)).toBe(true)
  })
})
