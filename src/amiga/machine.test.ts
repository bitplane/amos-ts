import { describe, expect, it } from 'vitest'
import { Machine } from './machine'

describe('the machine: power and reset', () => {
  it('starts on, with nothing pending', () => {
    const m = new Machine()
    expect(m.power).toBe('on')
    expect(m.pendingReset).toBeNull()
  })

  it('records who asked, so a host can say why the screen went black', () => {
    const m = new Machine()
    m.requestReset('cold', 'reset computer')
    expect(m.pendingReset).toEqual({ kind: 'cold', by: 'reset computer' })
  })

  it('the FIRST request wins — a warm one cannot downgrade a cold one', () => {
    const m = new Machine()
    m.requestReset('cold', 'reset computer')
    m.requestReset('warm', 'warm reset')
    expect(m.pendingReset).toEqual({ kind: 'cold', by: 'reset computer' })
  })

  it('taking the reset clears it, so a loop cannot perform one twice', () => {
    const m = new Machine()
    m.requestReset('warm', 'host')
    expect(m.takeReset()).toEqual({ kind: 'warm', by: 'host' })
    expect(m.takeReset()).toBeNull()
    expect(m.pendingReset).toBeNull()
  })

  it('powering off asks for a cold reset and stays off until told otherwise', () => {
    const m = new Machine()
    m.powerOff('host')
    expect(m.power).toBe('off')
    expect(m.pendingReset?.kind).toBe('cold')
    m.powerOn()
    expect(m.power).toBe('on')
    expect(m.pendingReset).toBeNull()
  })
})
