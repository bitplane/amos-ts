import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IDCMP_CLOSEWINDOW,
  IDCMP_MOUSEBUTTONS,
  Intuition,
  MENUDOWN,
  MENUUP,
  SELECTDOWN,
  TITLE_HEIGHT,
  WBENCHSCREEN,
  WB_DEPTH,
  WB_HEIGHT,
  WB_PALETTE,
  WB_SLOT,
  WB_WIDTH,
  WFLG_CLOSEGADGET,
  WFLG_DEPTHGADGET,
  WFLG_DRAGBAR,
  WFLG_RMBTRAP,
} from './intuition'
import type { NewWindow, ScreenHost, ScreenSpec } from './intuition'
import { BitMap, RastPort } from './graphics'
import { rowBytesFor } from './planar'

/** the smallest thing that can hold a screen: what the AMOS side does, minus AMOS */
function fakeHost(): {
  host: ScreenHost
  open: Map<number, ScreenSpec>
  order: number[]
  closes: number[]
  rast: Map<number, RastPort>
} {
  const open = new Map<number, ScreenSpec>()
  const order: number[] = []
  const closes: number[] = []
  const rast = new Map<number, RastPort>()
  const host = {
    openScreen: (slot: number, spec: ScreenSpec): void => {
      if (open.has(slot)) return
      open.set(slot, spec)
      order.unshift(slot)
      const wide = spec.width || 1
      const high = spec.height || 1
      rast.set(slot, new RastPort(new BitMap(wide, high, spec.depth || 1, rowBytesFor(wide))))
    },
    closeScreen: (slot: number): boolean => {
      if (!open.has(slot)) return false
      open.delete(slot)
      rast.delete(slot)
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
    screenSize: (slot: number): { width: number; height: number; hires: boolean } | null => {
      const s = open.get(slot)
      return s ? { width: s.width, height: s.height, hires: s.hires } : null
    },
    screenRast: (slot: number): RastPort | null => rast.get(slot) ?? null,
    systemFont: (): null => null,
  }
  return { host, open, order, closes, rast }
}

/** EasyLife's iconify window, which is the one real caller there is */
const ICONIFY: NewWindow = {
  leftEdge: 100,
  topEdge: 20,
  width: 5 * 8 + 80,
  height: 11,
  detailPen: 0,
  blockPen: 1,
  idcmpFlags: IDCMP_CLOSEWINDOW | IDCMP_MOUSEBUTTONS,
  flags: WFLG_RMBTRAP | WFLG_DRAGBAR | WFLG_DEPTHGADGET | WFLG_CLOSEGADGET,
  title: 'Hello',
  type: WBENCHSCREEN,
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
  // resolved from this file, not the cwd, so a run from anywhere still finds it
  const PREFS = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/amigaos/WB1.3/system-configuration')

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

describe('OpenWindow / CloseWindow (-204 / -72)', () => {
  it('opens the Workbench itself when the NewWindow says WBENCHSCREEN', () => {
    const { host, open } = fakeHost()
    const i = new Intuition(host)
    const w = i.openWindow(ICONIFY)
    expect(w).not.toBeNull()
    expect(open.has(WB_SLOT)).toBe(true)
    expect(i.windows).toHaveLength(1)
  })

  it('a titled window has BorderTop 11 — WBorTop + tf_YSize + 1', () => {
    const { host } = fakeHost()
    const w = new Intuition(host).openWindow(ICONIFY)!
    expect(w.borderTop).toBe(TITLE_HEIGHT)
    expect(w.borderTop).toBe(11)
    // and that is the whole of EasyLife's window
    expect(w.height).toBe(11)
  })

  it('the layer carries the geometry, inclusive at both ends', () => {
    const { host } = fakeHost()
    const w = new Intuition(host).openWindow(ICONIFY)!
    expect(w.layer.rect).toEqual({ minX: 100, minY: 20, maxX: 100 + 120 - 1, maxY: 30 })
    expect([w.leftEdge, w.topEdge, w.width, w.height]).toEqual([100, 20, 120, 11])
  })

  /**
   * "2 = Couldn't open window (Usually means that It wouldn't fit on the
   * screen at the given co-ordinates)" — the guide names the cause, so this
   * is the condition rather than a guess at one.
   */
  it('null when the window would not fit on the screen', () => {
    const { host } = fakeHost()
    const i = new Intuition(host)
    expect(i.openWindow({ ...ICONIFY, leftEdge: WB_WIDTH - 4 })).toBeNull()
    expect(i.openWindow({ ...ICONIFY, topEdge: WB_HEIGHT - 4 })).toBeNull()
    expect(i.openWindow({ ...ICONIFY, leftEdge: -1 })).toBeNull()
    expect(i.windows).toHaveLength(0)
  })

  it('CloseWindow takes the layer with it', () => {
    const { host } = fakeHost()
    const i = new Intuition(host)
    const w = i.openWindow(ICONIFY)!
    expect(i.closeWindow(w)).toBe(true)
    expect(i.windows).toHaveLength(0)
    expect(i.windowAt(WB_SLOT, 110, 25)).toBeNull()
    // and a second close is not a second success
    expect(i.closeWindow(w)).toBe(false)
  })

  /**
   * psn_VisitorCount, from the other side: the counter tested in isolation
   * above is what a window on the Workbench actually moves.
   */
  it('a window on the Workbench is a visitor, so CloseWorkBench refuses', () => {
    const { host } = fakeHost()
    const i = new Intuition(host)
    const w = i.openWindow(ICONIFY)!
    expect(i.closeWorkBench()).toBe(false)
    i.closeWindow(w)
    expect(i.closeWorkBench()).toBe(true)
  })

  it('the front window occludes the one behind it', () => {
    const { host } = fakeHost()
    const i = new Intuition(host)
    const back = i.openWindow(ICONIFY)!
    const front = i.openWindow({ ...ICONIFY, leftEdge: 140, title: 'Front' })!
    // they overlap from x=140 to x=219
    expect(i.windowAt(WB_SLOT, 200, 25)).toBe(front)
    expect(i.windowAt(WB_SLOT, 110, 25)).toBe(back)
    expect(back.layer.clip.contains(200, 25)).toBe(false)
    i.windowToFront(back)
    expect(i.windowAt(WB_SLOT, 200, 25)).toBe(back)
  })
})

describe('the system gadgets, and what the pointer does to them', () => {
  const setup = (): { i: Intuition; w: ReturnType<Intuition['openWindow']> } => {
    const { host } = fakeHost()
    const i = new Intuition(host)
    return { i, w: i.openWindow(ICONIFY) }
  }

  it('close on the left, depth on the right, drag bar between them', () => {
    const { w } = setup()
    expect(w!.partAt(0, 0)).toBe('close')
    expect(w!.partAt(w!.closeWidth - 1, 5)).toBe('close')
    expect(w!.partAt(w!.closeWidth, 5)).toBe('drag')
    expect(w!.partAt(w!.width - w!.depthWidth, 5)).toBe('depth')
    expect(w!.partAt(w!.width - 1, 10)).toBe('depth')
    // row 11 is past the bar, and past the window
    expect(w!.partAt(40, 11)).toBe('body')
  })

  /** GA_RelVerify: the gadget fires on the release, inside itself */
  it('CLOSEWINDOW arrives on the release, not the press', () => {
    const { i, w } = setup()
    i.handleInput(WB_SLOT, 105, 25, 1)
    expect(w!.pending).toBe(0)
    i.handleInput(WB_SLOT, 105, 25, 0)
    const m = w!.getMsg()!
    expect(m.class).toBe(IDCMP_CLOSEWINDOW)
  })

  it('a press dragged off the gadget is a press cancelled', () => {
    const { i, w } = setup()
    i.handleInput(WB_SLOT, 105, 25, 1)
    i.handleInput(WB_SLOT, 160, 25, 0)
    expect(w!.pending).toBe(0)
  })

  it('the drag bar moves the window, and the layer with it', () => {
    const { i, w } = setup()
    i.handleInput(WB_SLOT, 150, 25, 1)
    i.handleInput(WB_SLOT, 170, 35, 1)
    expect([w!.leftEdge, w!.topEdge]).toEqual([120, 30])
    expect(w!.layer.rect.minX).toBe(120)
    i.handleInput(WB_SLOT, 170, 35, 0)
    // and the button being up ends the drag
    i.handleInput(WB_SLOT, 300, 100, 0)
    expect(w!.leftEdge).toBe(120)
  })

  it('a window cannot be dragged off the screen', () => {
    const { i, w } = setup()
    i.handleInput(WB_SLOT, 150, 25, 1)
    i.handleInput(WB_SLOT, 5000, 5000, 1)
    expect(w!.leftEdge).toBe(WB_WIDTH - w!.width)
    expect(w!.topEdge).toBe(WB_HEIGHT - w!.height)
  })

  it('the depth gadget toggles front and back', () => {
    const { host } = fakeHost()
    const i = new Intuition(host)
    const a = i.openWindow(ICONIFY)!
    const b = i.openWindow({ ...ICONIFY, topEdge: 60 })!
    const gx = b.leftEdge + b.width - 2
    i.handleInput(WB_SLOT, gx, 65, 1)
    i.handleInput(WB_SLOT, gx, 65, 0)
    expect(i.windows[i.windows.length - 1]).toBe(a)
    const gx2 = b.leftEdge + b.width - 2
    i.handleInput(WB_SLOT, gx2, 65, 1)
    i.handleInput(WB_SLOT, gx2, 65, 0)
    expect(i.windows[i.windows.length - 1]).toBe(b)
  })
})

describe('IDCMP: what reaches the window, and what does not', () => {
  it('the class has to be in IDCMPFlags or nothing is queued', () => {
    const { host } = fakeHost()
    const i = new Intuition(host)
    // the same window, listening for the close gadget alone
    const w = i.openWindow({ ...ICONIFY, idcmpFlags: IDCMP_CLOSEWINDOW })!
    i.handleInput(WB_SLOT, 150, 25, 1) // the drag bar: no message either way
    i.handleInput(WB_SLOT, 150, 25, 0)
    i.handleInput(WB_SLOT, 150, 25, 2)
    expect(w.pending).toBe(0)
  })

  /**
   * The right button goes to the ACTIVE window and nowhere else, which is
   * what the EasyLife guide's "If you activate the window, then press the
   * right mouse button" describes from the program's side.
   */
  it('the right button reaches nothing until the window is active', () => {
    const { host } = fakeHost()
    const i = new Intuition(host)
    const w = i.openWindow(ICONIFY)!
    expect(i.activeWindow).toBeNull()
    i.handleInput(WB_SLOT, 150, 25, 2)
    i.handleInput(WB_SLOT, 150, 25, 0)
    expect(w.pending).toBe(0)

    // a left click in the body activates it
    i.handleInput(WB_SLOT, 150, 25, 1)
    i.handleInput(WB_SLOT, 150, 25, 0)
    expect(i.activeWindow).toBe(w)
    while (w.getMsg()) {
      /* drain the drag-bar press */
    }
    i.handleInput(WB_SLOT, 150, 25, 2)
    i.handleInput(WB_SLOT, 150, 25, 0)
    const down = w.getMsg()!
    const up = w.getMsg()!
    expect([down.class, down.code]).toEqual([IDCMP_MOUSEBUTTONS, MENUDOWN])
    expect([up.class, up.code]).toEqual([IDCMP_MOUSEBUTTONS, MENUUP])
  })

  it('MouseX and MouseY are window-relative', () => {
    const { host } = fakeHost()
    const i = new Intuition(host)
    // a window with an interior, since the iconify one is all title bar
    const w = i.openWindow({ ...ICONIFY, height: 60 })!
    i.handleInput(WB_SLOT, 150, 25, 0)
    expect([w.mouseX, w.mouseY]).toEqual([50, 5])
    // 40 rows down is past BorderTop, so this is the body and not the drag bar
    i.handleInput(WB_SLOT, 150, 60, 1)
    const m = w.getMsg()!
    expect([m.class, m.code, m.mouseX, m.mouseY]).toEqual([IDCMP_MOUSEBUTTONS, SELECTDOWN, 50, 40])
  })
})

describe('rendering: the window is on the screen', () => {
  it('paints the desktop, and the title bar over it', () => {
    const { host, rast } = fakeHost()
    const i = new Intuition(host)
    const w = i.openWindow(ICONIFY)!
    i.render(WB_SLOT)
    const px = rast.get(WB_SLOT)!.bitMap.pixels
    const at = (x: number, y: number): number => px[y * WB_WIDTH + x]!
    // the desktop is pen 0 all the way out
    expect(at(5, 5)).toBe(0)
    // the bar is filled with the block pen, inactive being detail=0 here...
    // the window is not active, so the fill is detailPen 0 and the ink is 1
    expect(at(w.leftEdge, w.topEdge)).toBe(1) // the outline
    expect(at(w.leftEdge + w.width - 1, w.topEdge + w.height - 1)).toBe(1)
  })

  it('an active window swaps the two pens over', () => {
    const { host, rast } = fakeHost()
    const i = new Intuition(host)
    const w = i.openWindow(ICONIFY)!
    i.activateWindow(w)
    i.render(WB_SLOT)
    const px = rast.get(WB_SLOT)!.bitMap.pixels
    // the bar interior, clear of both gadgets
    const x = w.leftEdge + w.closeWidth + 2
    expect(px[(w.topEdge + 5) * WB_WIDTH + x]!).toBe(1)
  })

  it('closing the window puts the desktop back', () => {
    const { host, rast } = fakeHost()
    const i = new Intuition(host)
    const w = i.openWindow(ICONIFY)!
    i.render(WB_SLOT)
    i.closeWindow(w)
    i.render(WB_SLOT)
    const px = rast.get(WB_SLOT)!.bitMap.pixels
    let nonzero = 0
    for (const v of px) if (v !== 0) nonzero++
    expect(nonzero).toBe(0)
  })

  it('render is a no-op until something changes', () => {
    const { host, rast } = fakeHost()
    const i = new Intuition(host)
    i.openWindow(ICONIFY)
    i.render(WB_SLOT)
    const rp = rast.get(WB_SLOT)!
    rp.rectFill(0, 0, 9, 9, 3)
    i.render(WB_SLOT) // nothing moved: the scribble survives
    expect(rp.bitMap.pixelAt(4, 4)).toBe(3)
    i.invalidate()
    i.render(WB_SLOT)
    expect(rp.bitMap.pixelAt(4, 4)).toBe(0)
  })
})
