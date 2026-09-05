import { describe, expect, it } from 'vitest'
import { amiga2Date } from './datestamp'
import { UniqueIdSource } from './utility'

describe('utility.library backend', () => {
  it('Amiga2Date uses the 1978 epoch and fills every ClockData field', () => {
    expect(amiga2Date(0)).toEqual({ year: 1978, month: 1, day: 1, hour: 0, min: 0, sec: 0, weekday: 0 })
    expect(amiga2Date(86_400 + 3_661)).toEqual({ year: 1978, month: 1, day: 2, hour: 1, min: 1, sec: 1, weekday: 1 })
  })

  it('GetUniqueID never returns zero and does not repeat', () => {
    const ids = new UniqueIdSource()
    expect([ids.get(), ids.get(), ids.get()]).toEqual([1, 2, 3])
  })
})
