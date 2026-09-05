import { describe, expect, it } from 'vitest'
import {
  OsWindowIds, OsWindowPatterns, eventCode, eventGadget, eventGadgetBank, eventItem, eventMenu, eventMouseX,
  eventMouseY, eventQualifier, eventSub, eventWindow, type OsWindowEvent,
} from './oswindowid'

const event = (over: Partial<OsWindowEvent> = {}): OsWindowEvent => ({
  class: 0x100, code: (4 << 11) | (17 << 5) | 3, qualifier: 0x12345,
  gadgetId: 0x10002, gadgetUserData: 0x8765_4321, windowId: 7,
  mouseX: 0xffff, mouseY: 0x8001, ...over,
})

describe('OS DevKit high-level Window IDs', () => {
  it('grows zeroed 28-byte records and preserves the +$18 Data long', () => {
    const ids = new OsWindowIds()
    expect(ids.record(2)).toEqual({ base: 0, title: 0, screenTitle: 0, owned0: 0, owned1: 0, owned2: 0, data: 0 })
    expect(ids.records).toHaveLength(3)
    ids.setData(2, -2)
    expect(ids.data(2)).toBe(0xffff_fffe)
  })

  it('selects and closes a record with its current base and RastPort', () => {
    const ids = new OsWindowIds()
    ids.attach(4, 0x1234, 0x5678)
    expect([ids.currentId, ids.currentBase, ids.currentRastPort]).toEqual([4, 0x1234, 0x5678])
    expect(ids.close(4)?.base).toBe(0x1234)
    expect([ids.currentId, ids.currentBase, ids.currentRastPort]).toEqual([-1, 0, 0])
  })

  it('retains both eight-word area pattern halves', () => {
    const p = new OsWindowPatterns()
    p.setLow([1, 2, 3, 4, 5, 6, 7, -1])
    p.setHigh([9, 10, 11, 12, 13, 14, 15, 0x10010])
    expect([...p.low]).toEqual([1, 2, 3, 4, 5, 6, 7, 0xffff])
    expect([...p.high]).toEqual([9, 10, 11, 12, 13, 14, 15, 16])
  })

  it('reads the copied IntuiMessage and Gadget fields at their machine widths', () => {
    const e = event()
    expect([eventWindow(e), eventCode(e), eventQualifier(e)]).toEqual([7, 0x2223, 0x2345])
    expect([eventGadget(e), eventGadgetBank(e)]).toEqual([2, -2023406815])
    expect([eventMouseX(e), eventMouseY(e)]).toEqual([-1, -32767])
  })

  it('decodes menu, item and subitem and rejects non-menu/sentinel values', () => {
    expect([eventMenu(event()), eventItem(event()), eventSub(event())]).toEqual([3, 17, 4])
    expect([eventMenu(event({ class: 1 })), eventItem(event({ class: 1 })), eventSub(event({ class: 1 }))])
      .toEqual([-1, -1, -1])
    expect(eventMenu(event({ code: 0x1f }))).toBe(-1)
    expect(eventItem(event({ code: 0x7e0 }))).toBe(-1)
    expect(eventSub(event({ code: 0xf800 }))).toBe(-1)
  })
})
