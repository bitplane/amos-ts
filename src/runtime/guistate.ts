/**
 * GUI 2.10's own state: which bank, which windows are open, what happened.
 *
 * Split from the keyword file because the keywords are a thin surface over
 * this and the interesting part is what a window IS here. See ./guibank.ts
 * for the format the designs arrive in.
 *
 * ## Evidence
 *
 * `GUI2.guide` by Pietro Ghizzoni, which documents 202 of the extension's 204
 * keywords, and the binary `AMOSPro_GUI.Lib` where the guide is silent. Every
 * event code below is the guide's own list, quoted at `GUI_EVENT`.
 */
import { BitMap, RastPort } from '../amiga/graphics'
import { rowBytesFor } from '../amiga/planar'
import type { Gui, GuiGadget } from './guibank'

/**
 * How many bitplanes a GUI window gets.
 *
 * DEVIATION: on the machine a window has no bitmap of its own. It draws into
 * its screen's, through a RastPort whose depth is the screen's, and GUI 2.10
 * opens on the Workbench or on a public screen it did not choose. This port
 * has no screen under these windows yet, so each carries its own eight-plane
 * bitmap: eight because `Gui Ink` takes a colour index and nothing in the
 * extension's own keywords can name one above 255, so a shallower bitmap
 * would silently clamp an ink a program legitimately set.
 */
export const GUI_WINDOW_DEPTH = 8

/**
 * The event codes `Gui Wait` answers with, verbatim from the guide.
 *
 * A value of zero or more is "the number of the gadget selected by the user",
 * so every event that is not a gadget has to be negative, and the guide lists
 * them as a block. Two are marked "Not used", which are kept rather than
 * skipped: leaving a hole where -3 and -17 are would make the next reader
 * wonder whether this port lost them.
 */
export const GUI_EVENT = {
  /** Window's close gadget selected */
  CLOSE: -1,
  /** Menu item selected */
  MENU: -2,
  /** "Not used", the guide's own words */
  UNUSED3: -3,
  /** Raw key pressed */
  RAWKEY: -4,
  /** Key pressed */
  KEY: -5,
  /** You must iconify the window! */
  ICONIFY: -6,
  /** Nothing selected, which is what `Gui Event` answers when idle */
  NOTHING: -7,
  /** Window resized */
  RESIZE: -8,
  /** Internet TCP/IP message */
  TCP: -9,
  /** ARexx message */
  AREXX: -10,
  /** Mouse Clicked */
  MOUSECLICK: -11,
  /** Mouse Moved */
  MOUSEMOVE: -12,
  /** Timer event */
  TIMER: -13,
  /** DOS Notification */
  NOTIFY: -14,
  /** AppWindow event */
  APPWINDOW: -15,
  /** AppIcon event */
  APPICON: -16,
  /** "Not used" */
  UNUSED17: -17,
  /** Window on/off */
  WINDOWACTIVE: -18,
} as const

/**
 * What `Gui Close` answers, from the guide's own four lines:
 *
 *     0 - Window Closed
 *     1 - First opened Window closed
 *     2 - Last opened window closed
 *     3 - Last window closed
 *
 * The three are not exclusive on their face and the guide does not say which
 * wins. `closeWindow` takes them in the order that makes each reachable:
 * the only window open is 3, otherwise first is 1 and last is 2.
 */
export const GUI_CLOSE = {
  CLOSED: 0,
  FIRST: 1,
  LAST_OPENED: 2,
  LAST: 3,
} as const

/** the bank GuiConv writes by default, and what `Gui Bank` starts at */
export const DEFAULT_GUI_BANK = 20

/** one open window */
export interface GuiWindow {
  /** the number the program opened it as, which is how every keyword names it */
  number: number
  /** which GUI in the bank it was opened from */
  gui: number
  /** the design, so a keyword can find a gadget without re-reading the bank */
  design: Gui
  left: number
  top: number
  width: number
  height: number
  /** locked by `Gui Off`, which stops it answering events */
  locked: boolean
  /** per-gadget state, indexed by the gadget's own id */
  values: Map<number, number>
  strings: Map<number, string>
  /** the order it was opened in, which `Gui Close` reports on */
  openedAt: number
  /** what the drawing keywords draw into; see GUI_WINDOW_DEPTH */
  rp: RastPort
  /** `Gui Ink`, the colour every drawing keyword defaults to */
  ink: number
  /** `Gui Paper` */
  paper: number
  /** `Gui Writing`, the drawing mode */
  writing: number
  /** the graphics cursor `Gui Draw To` continues from */
  grX: number
  grY: number
}

/** one thing that happened, waiting for `Gui Wait` to report it */
export interface GuiEvent {
  /** the gadget number, or one of GUI_EVENT */
  code: number
  /** what `Gui Code` answers, and -1 once read */
  result: number
  /** what `Gui Code$` answers */
  text: string
  /** which window, for `Gui Window` */
  window: number
}

/**
 * The extension's whole state.
 *
 * One of these per Runtime. Nothing here draws: a window's pixels are
 * `../amiga/intuition.ts`'s and its gadgets `../amiga/gadtools.ts`'s, and
 * this is the AMOS side that names them by number.
 */
export class GuiState {
  /** `Gui Bank`, which the guide says the converter defaults to 20 */
  bank = DEFAULT_GUI_BANK
  /** every GUI in the current bank, once one has been read */
  designs: Gui[] = []
  /** open windows by their program-visible number */
  readonly windows = new Map<number, GuiWindow>()
  /** `Gui Gfx 0,n` sets this; `Gui Actual` reads it */
  actual = 0
  /** `Gui Gfx 1,n` points drawing at a screen instead of a window */
  gfxToScreen = false
  /** which screen, when it does */
  gfxScreen = 0
  /** the most recently opened or clicked window, which `Gui Selected` reads */
  selected = 0
  /** events waiting to be reported */
  readonly pending: GuiEvent[] = []
  /** the last event `Gui Wait` or `Gui Event` reported */
  last: GuiEvent | null = null
  private opens = 0

  /** `Gui Exist(window)`: false, or something truthy standing in for the address */
  exists(n: number): boolean {
    return this.windows.has(n)
  }

  /**
   * `Gui Open window,gui[,bank[,x,y,w,h]]`.
   *
   * "If the window you specify is already open, it will be selected and pop
   * to front... no error will occur", so a repeat open is a select. The
   * geometry falls back to "the position and size as specified in the
   * GadToolsBox editor", which is what the bank's own header carries.
   */
  open(n: number, guiIndex: number, box?: { left: number; top: number; width: number; height: number }): GuiWindow | null {
    const existing = this.windows.get(n)
    if (existing !== undefined) {
      this.selected = n
      return existing
    }
    const design = this.designs[guiIndex]
    if (design === undefined) return null
    const w: GuiWindow = {
      number: n,
      gui: guiIndex,
      design,
      left: box?.left ?? design.left,
      top: box?.top ?? design.top,
      width: box?.width ?? design.width,
      height: box?.height ?? design.height,
      locked: false,
      values: new Map(),
      strings: new Map(),
      openedAt: this.opens++,
      rp: newWindowPort(box?.width ?? design.width, box?.height ?? design.height),
      ink: 1,
      paper: 0,
      writing: 0,
      grX: 0,
      grY: 0,
    }
    this.windows.set(n, w)
    this.selected = n
    // "When you open a window, this window becomes the current, selected
    // window", and with nothing else open it is also where graphics go
    if (this.actual === 0) this.actual = n
    return w
  }

  /**
   * `A=Gui Close(window)`, answering the guide's four codes.
   *
   * Ordered so each is reachable: closing the only open window is 3, and
   * otherwise first-opened beats last-opened, since a window can be both when
   * two are open and neither reading is more right than the other.
   */
  closeWindow(n: number): number {
    const w = this.windows.get(n)
    if (w === undefined) return GUI_CLOSE.CLOSED
    const others = [...this.windows.values()].filter((x) => x.number !== n)
    this.windows.delete(n)
    if (this.selected === n) this.selected = others[others.length - 1]?.number ?? 0
    if (this.actual === n) this.actual = others[others.length - 1]?.number ?? 0
    if (others.length === 0) return GUI_CLOSE.LAST
    if (others.every((x) => x.openedAt > w.openedAt)) return GUI_CLOSE.FIRST
    if (others.every((x) => x.openedAt < w.openedAt)) return GUI_CLOSE.LAST_OPENED
    return GUI_CLOSE.CLOSED
  }

  /** `Gui Reset`: close all the windows */
  reset(): void {
    this.windows.clear()
    this.pending.length = 0
    this.last = null
    this.selected = 0
    this.actual = 0
  }

  /** queue something for `Gui Wait` to find */
  post(e: GuiEvent): void {
    this.pending.push(e)
  }

  /**
   * `Gui Event`: the same answers as `Gui Wait` without blocking, and -7 when
   * nothing has happened.
   *
   * A locked window's events are dropped rather than queued behind the lock,
   * because `Gui Off` is documented as locking a GUI and a program that
   * unlocks would otherwise be handed a backlog of clicks it never saw.
   */
  nextEvent(): number {
    for (;;) {
      const e = this.pending.shift()
      if (e === undefined) {
        this.last = null
        return GUI_EVENT.NOTHING
      }
      if (this.windows.get(e.window)?.locked === true) continue
      this.last = e
      this.selected = e.window
      return e.code
    }
  }

  /**
   * `Gui Code`, which the guide is emphatic about: "After Gui Code has been
   * called, its value is automatically reset to -1 again, until the next call
   * to Gui Wait loads it with a new value."
   */
  readCode(): number {
    const v = this.last?.result ?? -1
    if (this.last !== null) this.last.result = -1
    return v
  }

  /** `Gui Code$`, the string half of the same */
  readCodeText(): string {
    return this.last?.text ?? ''
  }

  /** `Gui Window`: which window produced the last event */
  eventWindow(): number {
    return this.last?.window ?? 0
  }

  /** the gadget a window's design carries under `id`, or null */
  gadget(w: GuiWindow, id: number): GuiGadget | null {
    return w.design.gadgets.find((g) => g.id === id) ?? null
  }
}

/** a window's own RastPort, sized to it and never smaller than one pixel */
export function newWindowPort(width: number, height: number): RastPort {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  return new RastPort(new BitMap(w, h, GUI_WINDOW_DEPTH, rowBytesFor(w)))
}
