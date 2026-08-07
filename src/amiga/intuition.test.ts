import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { Intuition, WB_DEPTH, WB_HEIGHT, WB_PALETTE, WB_SLOT, WB_WIDTH } from './intuition'
import type { ScreenHost, ScreenSpec } from './intuition'

/** the smallest thing that can hold a screen: what the AMOS side does, minus AMOS */
function fakeHost(): { host: ScreenHost; open: Map<number, ScreenSpec>; order: number[]; closes: number[] } {
  const open = new Map<number, ScreenSpec>()
  const order: number[] = []
  const closes: number[] = []
  const host = {
    openScreen: (slot: number, spec: ScreenSpec): void => {
      if (open.has(slot)) return
      open.set(slot, spec)
      order.unshift(slot)
    },
    closeScreen: (slot: number): boolean => {
      if (!open.has(slot)) return false
      open.delete(slot)
      order.splice(order.indexOf(slot), 1)
      closes.push(slot)
      return true
    },
    screenToFront: (slot: number): void => {
      order.splice(order.indexOf(slot), 1)
      order.push(slot)
    },
    screenToBack: (slot: number): void => {
      order.splice(order.indexOf(slot), 1)
      order.unshift(slot)
    },
    isOpen: (slot: number): boolean => open.has(slot),
    screenAddr: (slot: number): number => 0x4800_0000 + slot * 0x1000,
  }
  return { host, open, order, closes }
}

describe('OpenWorkBench (intuition.library -210)', () => {
  it('opens the Workbench screen and returns a pointer to it', () => {
    const { host, open } = fakeHost()
    const i = new Intuition(host)
    const p = i.openWorkBench()
    expect(p).not.toBe(0)
    expect(open.has(WB_SLOT)).toBe(true)
    const s = open.get(WB_SLOT)!
    expect([s.width, s.height, s.depth]).toEqual([WB_WIDTH, WB_HEIGHT, WB_DEPTH])
    expect(s.hires).toBe(true)
    expect(s.laced).toBe(false)
  })

  /**
   * "If successful return value is a pointer to the screen structure" — and
   * AROS returns the EXISTING screen rather than opening a second one, which
   * is what makes OpenWorkBench safe to call from anything that wants a
   * Workbench to be there.
   */
  it('returns the same screen the second time, without opening another', () => {
    const { host, open } = fakeHost()
    const i = new Intuition(host)
    const a = i.openWorkBench()
    const b = i.openWorkBench()
    expect(b).toBe(a)
    expect(open.size).toBe(1)
  })

  it('does not bring it to the front — WBenchToFront is a separate call', () => {
    const { host, order } = fakeHost()
    const i = new Intuition(host)
    // something else is already on screen
    host.openScreen(0, {} as ScreenSpec)
    i.openWorkBench()
    expect(order[order.length - 1]).toBe(0)
    expect(i.wBenchToFront()).toBe(true)
    expect(order[order.length - 1]).toBe(WB_SLOT)
  })
})

describe('CloseWorkBench (intuition.library -78)', () => {
  it('FALSE when there is no Workbench screen', () => {
    const { host } = fakeHost()
    expect(new Intuition(host).closeWorkBench()).toBe(false)
  })

  it('closes it, and TRUE', () => {
    const { host, closes } = fakeHost()
    const i = new Intuition(host)
    i.openWorkBench()
    expect(i.closeWorkBench()).toBe(true)
    expect(closes).toEqual([WB_SLOT])
    expect(i.workBenchOpen()).toBe(false)
  })

  /**
   * psn_VisitorCount != 0 -> FALSE, before it even tries. A program that
   * iconifies onto the Workbench is exactly the case: its own window is the
   * visitor, and the Workbench must not vanish underneath it.
   */
  it('FALSE while something is visiting it, and the screen survives', () => {
    const { host } = fakeHost()
    const i = new Intuition(host)
    i.openWorkBench()
    i.addVisitor()
    expect(i.closeWorkBench()).toBe(false)
    expect(i.workBenchOpen()).toBe(true)
    i.removeVisitor()
    expect(i.closeWorkBench()).toBe(true)
  })
})

describe('WBenchToFront / WBenchToBack (-342 / -336)', () => {
  it('FALSE with no Workbench screen — nothing to move', () => {
    const { host } = fakeHost()
    const i = new Intuition(host)
    expect(i.wBenchToFront()).toBe(false)
    expect(i.wBenchToBack()).toBe(false)
  })

  it('move it through the screen order', () => {
    const { host, order } = fakeHost()
    const i = new Intuition(host)
    host.openScreen(0, {} as ScreenSpec)
    i.openWorkBench()
    expect(i.wBenchToFront()).toBe(true)
    expect(order).toEqual([0, WB_SLOT])
    expect(i.wBenchToBack()).toBe(true)
    expect(order).toEqual([WB_SLOT, 0])
  })
})

describe('the Workbench palette, against Preferences on the disk', () => {
  /**
   * `devs/system-configuration` from Workbench 1.3 rev 34.20 (GB) is a
   * `struct Preferences`. The four screen colours are at 110-116, and the
   * decode is confirmed end to end by PrinterFilename — "generic" lands at
   * offset 128, exactly where the struct puts it.
   *
   * Commodore's file, so it lives under fixtures/ with the FD files rather
   * than in the repo, and the test skips when it is not to hand — the same
   * shape as the diskfont tests against the original partition.
   */
  const PREFS = 'fixtures/amigaos/WB1.3/system-configuration'

  it.skipIf(!existsSync(PREFS))('color0-3 are the blue/white/black/orange of a 1.3 desktop', () => {
    const b = readFileSync(PREFS)
    const w = (o: number): number => (b[o]! << 8) | b[o + 1]!
    expect(String.fromCharCode(...b.subarray(128, 135))).toBe('generic')
    expect([w(110), w(112), w(114), w(116)]).toEqual([...WB_PALETTE])
  })

  it('is four entries, and colour 0 is the blue desktop', () => {
    expect(WB_PALETTE).toHaveLength(1 << WB_DEPTH)
    expect(WB_PALETTE[0]).toBe(0x005a)
  })
})
