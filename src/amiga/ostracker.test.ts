import { describe, expect, it } from 'vitest'
import { OsResourceTracker } from './ostracker'

describe('OS DevKit resource tracker (workers 1883-1886)', () => {
  it('keeps 32 independent type lists and Set deduplicates', () => {
    const t = new OsResourceTracker()
    t.set(8, 0x1234)
    t.set(8, 0x1234)
    t.set(9, 0x1234)
    expect(t.entries(8)).toEqual([0x1234])
    expect(t.entries(9)).toEqual([0x1234])
    expect(t.find(8, 0x1234)).toBe(1)
  })

  it('Add can append, Unset removes the found slot, and invalid inputs do nothing', () => {
    const t = new OsResourceTracker()
    t.add(2, 1)
    t.add(2, 2)
    t.add(2, 1)
    t.unset(2, 1)
    expect(t.entries(2)).toEqual([2, 1])
    expect(t.find(2, 1)).toBe(2)
    t.set(-1, 3)
    t.set(32, 3)
    t.set(0, 0)
    expect(t.entries(0)).toEqual([])
  })
})
