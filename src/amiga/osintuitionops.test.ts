import { describe, expect, it } from 'vitest'
import { IntuitionBaseLock, WFLG_REPORTMOUSE, Window } from './intuition'
import { Layer } from './layers'

const window = (): Window => new Window(
  0,
  new Layer({ minX: 0, minY: 0, maxX: 31, maxY: 15 }, 'simple'),
  '', 0, 0, 0, 0, 15, 18,
)

describe('OS DevKit Intuition pointer, mouse and base-lock operations', () => {
  it('retains SetPointer arguments at native widths and clears them', () => {
    const w = window()
    w.setPointer(-1, 0x10002, 0x10003, 0xffff, 0x8001)
    expect(w.pointer).toEqual({
      data: 0xffff_ffff, height: 2, width: 3, xOffset: -1, yOffset: -32767,
    })
    w.clearPointer()
    expect(w.pointer).toBeNull()
  })

  it('ReportMouse toggles the exact Window flag', () => {
    const w = window()
    w.reportMouse(true)
    expect(w.flags & WFLG_REPORTMOUSE).toBe(WFLG_REPORTMOUSE)
    w.reportMouse(false)
    expect(w.flags & WFLG_REPORTMOUSE).toBe(0)
  })

  it('pairs distinct LockIBase tokens with their unlocks', () => {
    const ibase = new IntuitionBaseLock()
    const a = ibase.lock(0)
    const b = ibase.lock(1)
    expect(a).not.toBe(b)
    expect(ibase.isHeld(a)).toBe(true)
    expect(ibase.isHeld(b)).toBe(true)
    ibase.unlock(a)
    expect(ibase.isHeld(a)).toBe(false)
    expect(ibase.isHeld(b)).toBe(true)
  })
})
