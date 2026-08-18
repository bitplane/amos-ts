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
import { GadTools, ITEM_MASK, MENU_MASK, MENUNULL, SUB_MASK, fullMenuNum, type MenuStrip } from '../amiga/gadtools'
import { WB_HEIGHT, WB_WIDTH } from '../amiga/intuition'
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

/**
 * What intuition queues before it starts discarding, from the guide's own
 * sentence at `Gui Mouse Queue`: "Usually intuition queue a maximum of 5
 * mouse movements". It is intuition's default and not this extension's, so
 * nothing in the binary writes it.
 */
export const DEFAULT_MOUSE_QUEUE = 5

/**
 * topaz/8, the font every stored coordinate in a GUI bank is measured in.
 *
 * It is the divisor of the font-sensitive scale at $21c0 and $21d6, and the
 * size $573a and $5740 force when a window cannot be scaled: "Gui Sensitive
 * Off makes your windows use the topaz/8 font as used when you create the GUI
 * in GadToolsBox".
 */
export const TOPAZ_SIZE = 8

/**
 * How long a title `Gui Titles` will copy.
 *
 * The two buffers sit at `$3a` of the window record and $26f8 finds the
 * second one with `lea $65(a3),a3`, so each is 101 bytes: a hundred
 * characters and the NUL $26ec writes after them.
 */
export const GUI_TITLE_MAX = 100

/**
 * `Gui Center`'s two bits, `$1a2`.
 *
 * $3252 sets bit 0 for the X argument and $325c adds 2 for the Y, and the two
 * open-time tests read it as a mask rather than as a number: $5c70 skips the
 * X centring when it is exactly 2 and $5cda skips the Y when it is exactly 1.
 */
export const GUI_CENTRE_X = 1
export const GUI_CENTRE_Y = 2

/**
 * What `Gui Reserve Zone` will take, `cmpi.l #$1388,d2` at $4082.
 *
 * The guide says otherwise: "There is no limit to the number of zones, except
 * the amount of free memory." Five thousand is the limit, and asking for
 * 5,001 is "Illegal number of zones".
 */
export const GUI_MAX_ZONES = 5000

/** eight bytes a zone, `mulu.w #$8,d2`: four words, x, y, x1, y1 */
export const GUI_ZONE_SIZE = 8

/**
 * The public screens this port has.
 *
 * Intuition always keeps the Workbench on the list, and nothing else here
 * opens a screen yet -- `Gui Screen Open` is not built, and it is what would
 * add to this. So the list has one name, and `Gui Pub List` walking it to the
 * end after one entry is the machine's own behaviour on a Workbench with
 * nothing else running.
 */
export const PUB_SCREENS: readonly string[] = ['Workbench']

/** one detection zone, as `Gui Set Zone` writes it */
export interface GuiZone {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * The font-sensitive scale, routines 41 and 42 at $21b4 and $21ca:
 *
 *     mulu.w $294(a0),d0 / addq.w #$4,d0 / divu.w #$8,d0
 *
 * A coordinate times the character cell, over topaz/8's, rounded to nearest
 * by the `+4` before an unsigned divide. So the two routines are one function
 * with two different multipliers, which is why `Gui Sw` and `Gui Sh` are two
 * keywords rather than one.
 */
export function guiScale(v: number, cell: number): number {
  return Math.trunc((v * cell + 4) / TOPAZ_SIZE)
}

/**
 * `Gui Menu(4)`, the argument that is not a field.
 *
 * Routine 4 tests for it first, `cmp.w #$4,d0 / beq` at $1d00, and only then
 * looks at the pending flag. The guide's index line says only "Returns Menu
 * code", so what the four arguments mean is the binary's.
 */
export const GUI_MENU_NEXT = 4

/**
 * The three menu keywords' argument packing, routine 224 at $4c10.
 *
 * Each of menu, item and sub arrives ONE-BASED and is decremented; anything
 * that would land below -1 is clamped to -1 by the three `moveq #$ff` at
 * $4c22, $4c2c and $4c36. So a zero argument means "none", and -1 is what
 * intuition spells NOMENU, NOITEM and NOSUB.
 *
 * The rotates that follow put the three into the five, six and five bits
 * intuition reads them out of. They also leave rubbish above bit 15 whenever
 * one of the three was absent, because -1 rotates its whole sign into the top
 * of the longword; MENUNUM and its two siblings mask that off, so packing
 * into sixteen bits here is the same number the library passes.
 */
export function packMenuNumber(menu: number, item: number, sub: number): number {
  const one = (v: number): number => (v < 1 ? -1 : v - 1)
  return fullMenuNum(one(menu), one(item), one(sub))
}

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
  /**
   * Per-gadget state, by gadget id, as the guide's own three attributes.
   *
   * "Some kinds of gadgets allows you to update up to 3 different attributes
   * (0 to 2)". Attribute 0 is the value, 1 and 2 are the bounds a LISTVIEW,
   * SCROLLER or SLIDER carries beside it, and what each means depends on the
   * kind: attribute 2 is a slider's MAX and a scroller's VISIBLE.
   */
  attrs: Map<number, [number, number, number]>
  /** what `Gui Set$` put in a STRING or TEXT gadget */
  strings: Map<number, string>
  /** `Gui Set window,gadget,-1,1` ghosts a gadget so it cannot be selected */
  ghosted: Set<number>
  /** `Gui Range`, the clip an INTEGER gadget's input is held to */
  ranges: Map<number, [number, number]>
  /**
   * `Gui Mouse Report`: WFLG_REPORTMOUSE, which $2dee sets and $2de8 clears
   * straight in `Window.Flags` rather than through intuition's ReportMouse.
   *
   * The binary keeps a WORD beside it and tests only bit 0, so the counter it
   * looks like cannot count: two `True`s in a row leave it at 1 and one
   * `False` clears it. A boolean is what it is.
   */
  reportMouse: boolean
  /**
   * `Gui Rmb`: WFLG_RMBTRAP, INVERTED. `Gui Rmb w,True` CLEARS the bit
   * ($2c12) and lets intuition pop its menus up; `Gui Rmb w,False` sets it
   * ($2c08) and the program gets a -11 instead. True here is the guide's
   * True, so it means "intuition handles it".
   */
  rmb: boolean
  /**
   * `Gui Mouse Queue`: SetMouseQueue's length. "Usually intuition queue a
   * maximum of 5 mouse movements, and discard all the other if you don't read
   * them in time".
   */
  mouseQueue: number
  /**
   * This window was laid out in topaz/8 rather than in the screen's font.
   *
   * `$42` of the library's window record, set at $5726 when either `Gui
   * Sensitive Off` cleared the global flag OR the scaled window would not
   * fit the screen -- the guide's "If the new sizes cause the window to not
   * fit on-screen anymore, the command will be ignored by the system". The
   * same branch forces the two font sizes back to 8. `Gui Sx` and its three
   * siblings test this word and skip their scaling when it is set.
   */
  topaz: boolean
  /** the order it was opened in, which `Gui Close` reports on */
  openedAt: number
  /**
   * Where it sits front to back, which `Gui To Front` and `Gui To Back` move.
   *
   * A separate number from `openedAt` because the two answer different
   * questions: `Gui Close` reports on the order windows were OPENED in and
   * has to keep reporting that after a raise.
   */
  depth: number
  /** `Gui Titles`, and what `Gui Title$` reads back */
  title: string
  /** the second half of the same keyword, the screen's title while this window has it */
  screenTitle: string
  /**
   * The menu strip, built from the design's NewMenu array when it has one.
   *
   * The library keeps it at `$16` of its own window record and hands it to
   * `SetMenuStrip` at $5dc0, and every menu keyword reaches it the same way:
   * `Gui Menu Check` reloads `$16(a0)` at $429c and gives up when it is zero.
   */
  strip: MenuStrip | null
  /** what the drawing keywords draw into; see GUI_WINDOW_DEPTH */
  rp: RastPort
  /**
   * `Gui Ink`: SetAPen on this window's RastPort, which is why it is here and
   * `GuiState.pen` is not.
   */
  ink: number
  /** `Gui Writing`: the SetDrMd half, the RastPort's own drawing mode */
  writing: number
  /** the graphics cursor `Gui Draw To` continues from */
  grX: number
  grY: number
}

/** one thing that happened, waiting for `Gui Wait` to report it */
export interface GuiEvent {
  /** the gadget number, or one of GUI_EVENT */
  code: number
  /**
   * Where the pointer was, for `Gui Mouse Ex` and `Gui Mouse Ey`.
   *
   * The library copies `$20(a1)` and `$22(a1)` out of the IntuiMessage at
   * $6d0a, which are its MouseX and MouseY. Absent on an event that carries
   * no position, which leaves the last one standing exactly as the two state
   * words do.
   */
  mouseX?: number
  mouseY?: number
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
  /** `Gui Activate` sets it and `Gui Gadget` reads it */
  activeGadget = 0
  /**
   * The three bytes `Gui Text` builds its IntuiText from, at `$290`, `$28e`
   * and `$292` of the extension's state.
   *
   * They belong to the EXTENSION rather than to a window: $260a, $25fe and
   * $2616 each write one byte here and nothing per-window, and $25cc copies
   * all three into the IntuiText. So switching the Gfx output leaves them
   * alone, where `Gui Ink` follows the output because it is a SetAPen on
   * whichever RastPort is current.
   */
  pen = 1
  paper = 0
  writing = 0
  /**
   * `Gui Mouse Mode`, one word at `$2a0`.
   *
   * Zero is the default and reports both halves of a click; anything else
   * reports only the release. The pump at $709a tests it and then compares
   * the raw code against $e8, $e9 and $ea -- SELECTUP, MENUUP and MIDDLEUP --
   * letting those three through and swallowing everything else. That is the
   * guide's "1 when you click the button, and another when you let go"
   * reduced to one, and it is the UP that survives.
   */
  mouseMode = 0
  /** `$29c` and `$29e`: where the pointer was for the last event reported */
  eventX = 0
  eventY = 0
  /**
   * `Gui Sensitive On` / `Off`: bit 0 of `$85`, and it starts SET.
   *
   * $1678 sets it during init, which is the guide's "This is the default
   * setting". It is the extension's and not a window's: a window copies it
   * into its own `topaz` at open and keeps that reading for its whole life.
   */
  sensitive = true
  /**
   * `Gui Center`'s mask at `$1a2`, and `$85` bit 4 beside it, which the
   * keyword keeps in step: $3266 clears the bit again when both arguments
   * were false, so the bit carries nothing the mask does not.
   */
  centre = 0
  /**
   * `Gui Remember On` / `Off`: bit 2 of `$85`.
   *
   * "Gui Remember On will make the system remember where exactly a window was
   * when it was closed, so if it is opened again in the future, it will keep
   * its old positions."
   */
  remember = false
  /**
   * Those positions, by GUI number.
   *
   * DEVIATION: the machine keeps them IN THE BANK. $5c04 reads the top out of
   * `$2e` of the GUI's Header Info block when the flag is set, where $5bf8
   * reads `$2` without it. Holding them here instead means they survive a
   * re-read of the bank, which on the machine would put the designed
   * positions back.
   */
  readonly remembered = new Map<number, [number, number]>()
  /**
   * `Gui Set Mode`, one word at `$60`: whether a window gets an iconify
   * gadget. "this command doesn't modify the windows already opened, but only
   * those opened later!"
   */
  iconifyGadget = 0
  /** how many times `Gui Beep` has been asked for; see the keyword */
  beeps = 0
  /**
   * `Gui Reserve Zone`'s blocks, by WINDOW NUMBER rather than by window.
   *
   * "When you close a window the zones ARE NOT erased! When you reopen the
   * window the zones are already there so you don't need to redifine them!",
   * which the guide says twice and which is the whole reason `Gui Free Zone`
   * exists. The block hangs off `$3e` of the library's window record and the
   * close at $6448 unlinks that record without freeing either.
   */
  readonly zones = new Map<number, GuiZone[]>()
  /**
   * `$1ce`: the public screen `Gui Pub Screen` locked, or 0.
   *
   * A LOCK on the machine, which is a Screen pointer; a token here, because
   * a program can only test it for zero and hand it back to `Gui Pub To
   * Front`. `$1d2` follows it, which is why locking a public screen also
   * changes what `Gui Mouse X` reads.
   */
  pubLock = 0
  /** the name behind that lock, so `Gui Pub Free` can say what it let go of */
  pubName = ''
  /**
   * `$1da`: how far `Gui Pub Name$` has walked, and whether the list is
   * locked at all.
   *
   * -1 when no list is held. Zero or more is the index of the next name, and
   * the walk frees the list itself when it runs off the end: $2b7a tests the
   * node's ln_Succ and calls UnlockPubScreenList when it is zero. That is
   * what makes the guide's loop terminate -- "Exit If PUB$(I)=''" -- without
   * the program having counted anything.
   */
  pubListAt = -1
  /** `$a0`: the zone the last event was in, which `Gui Zone` reads */
  activeZone = 0
  /**
   * `$1a0`: the ARRAY index of the listview item the last event named, which
   * `Gui Array` reads.
   *
   * Not the same number as `Gui Code`'s, and that is the whole point of the
   * keyword: the listview holds only the non-empty entries, so its item 1 can
   * be the array's element 2.
   */
  arrayIndex = 0
  private depthTop = 0
  private depthBottom = 0
  /**
   * The character cell, `$294` and `$296`, taken from the screen's font at
   * $56a6 and $56ac -- `tf_XSize` and `tf_YSize` of the RastPort's TextFont.
   *
   * DEVIATION: 8 and 8 here for both, because this port has no Workbench
   * screen and so no Preferences font. That is topaz/8, which is what
   * GadToolsBox designed in and what $573a forces when a window cannot be
   * scaled, so every scale below comes out as the identity until a screen
   * exists to read a font off.
   */
  fontWidth = TOPAZ_SIZE
  fontHeight = TOPAZ_SIZE
  /**
   * The library's own gadtools instance, which owns every menu strip.
   *
   * One per state rather than one per window, because a strip outlives the
   * keyword that made it and `Gui Menu Check` has to find it again.
   */
  readonly gt = new GadTools()
  /**
   * The menu number the last MENUPICK carried, at `$ee` of the library's
   * state, and whether one is waiting, which is bit 2 of `$84`.
   *
   * `Gui Menu` answers -1 when the bit is clear, so a program that asks
   * without an event pending gets the same answer as one that asks for a
   * field that does not exist.
   */
  menuNumber = MENUNULL
  menuPending = false
  /** the strip the pending number belongs to, `$f0` of the same state */
  menuStrip: MenuStrip | null = null
  /** events waiting to be reported */
  readonly pending: GuiEvent[] = []
  /** the last event `Gui Wait` or `Gui Event` reported */
  last: GuiEvent | null = null
  private opens = 0

  /**
   * Where a window opens across, with `Gui Center`'s X bit applied.
   *
   * $5c76 is `move.w $c(a0),d0 / sub.l $14(a1),d0 / ror.l #$1,d0`, the screen
   * width less the window's over two, and it is skipped when the centre mask
   * is exactly GUI_CENTRE_Y.
   *
   * `ror` rather than `lsr`, which puts bit 0 up at bit 31 when the
   * difference is odd. It costs nothing: the tag's data goes into
   * NewWindow.TopEdge, which is a WORD, so the stray bit is truncated away
   * before anything reads it. A slip, not a defect.
   */
  private openLeft(left: number, width: number): number {
    if (this.centre === 0 || this.centre === GUI_CENTRE_Y) return left
    return (WB_WIDTH - width) >> 1
  }

  /** the same down the screen, from $5ce0, skipped when the mask is GUI_CENTRE_X */
  private openTop(top: number, height: number): number {
    if (this.centre === 0 || this.centre === GUI_CENTRE_X) return top
    return (WB_HEIGHT - height) >> 1
  }

  /**
   * `Gui To Front window` — WindowToFront (-$138) and then ActivateWindow
   * (-$1c2) at $1eae, which the guide does not mention. So raising a window
   * also selects it.
   */
  toFront(w: GuiWindow): void {
    w.depth = ++this.depthTop
    this.selected = w.number
  }

  /** `Gui To Back window` — WindowToBack (-$132) alone, with no activate */
  toBack(w: GuiWindow): void {
    w.depth = --this.depthBottom
  }

  /** front to back, which is the order a renderer would draw them in reverse */
  stack(): GuiWindow[] {
    return [...this.windows.values()].sort((a, b) => b.depth - a.depth)
  }

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
    const width = box?.width ?? design.width
    const height = box?.height ?? design.height
    const kept = this.remember ? this.remembered.get(guiIndex) : undefined
    const w: GuiWindow = {
      number: n,
      gui: guiIndex,
      design,
      left: box?.left ?? this.openLeft(kept?.[0] ?? design.left, width),
      top: box?.top ?? this.openTop(kept?.[1] ?? design.top, height),
      width,
      height,
      locked: false,
      attrs: new Map(),
      strings: new Map(),
      ghosted: new Set(),
      ranges: new Map(),
      reportMouse: false,
      rmb: true,
      topaz: !this.sensitive,
      depth: ++this.depthTop,
      title: design.title,
      screenTitle: design.screenName,
      mouseQueue: DEFAULT_MOUSE_QUEUE,
      openedAt: this.opens++,
      strip: design.menus.length > 0 ? this.gt.createMenus(design.menus) : null,
      rp: newWindowPort(box?.width ?? design.width, box?.height ?? design.height),
      ink: 1,
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
    if (this.remember) this.remembered.set(w.gui, [w.left, w.top])
    const others = [...this.windows.values()].filter((x) => x.number !== n)
    this.windows.delete(n)
    if (this.selected === n) this.selected = others[others.length - 1]?.number ?? 0
    if (this.actual === n) this.actual = others[others.length - 1]?.number ?? 0
    if (others.length === 0) return GUI_CLOSE.LAST
    if (others.every((x) => x.openedAt > w.openedAt)) return GUI_CLOSE.FIRST
    if (others.every((x) => x.openedAt < w.openedAt)) return GUI_CLOSE.LAST_OPENED
    return GUI_CLOSE.CLOSED
  }

  /**
   * Record a menu pick and queue the event for `Gui Wait`.
   *
   * The guide's own instruction for event -2: "A menu item has been selected.
   * You've to use the Gui Menu function to know which item has been chosen."
   * So the number goes into the state and the event carries only -2.
   */
  postMenu(window: number, number: number): void {
    this.menuNumber = number
    this.menuPending = true
    this.menuStrip = this.windows.get(window)?.strip ?? null
    if (this.menuStrip !== null) this.gt.selectItem(this.menuStrip, number)
    this.post({ code: GUI_EVENT.MENU, result: -1, text: '', window })
  }

  /**
   * `Gui Menu(n)`, routine 4 at $1cf6, which is four functions in one
   * argument.
   *
   * 1, 2 and 3 take the pending number apart with the masks at $1d18, $1d20
   * and $1d2e, and `addq.l #$1,d3` at $1d4e then makes each ONE-BASED. So a
   * pick of the first item of the first menu answers 1,1,32: the sub field
   * holds NOSUB, which is 31 masked, and 32 out of the addq. That is the
   * value a program tests, not zero.
   *
   * Anything else answers -1, and so does asking with no event pending: the
   * `moveq #$ff,d3` at $1cfa falls through the branch at $1d0c without the
   * addq, and the $fe at $1d4c reaches the addq to make the same -1.
   */
  menuField(which: number): number {
    if (which === GUI_MENU_NEXT) return this.nextMenuSelect()
    if (!this.menuPending) return -1
    const n = this.menuNumber
    if (which === 1) return (n & MENU_MASK) + 1
    if (which === 2) return ((n >> 5) & ITEM_MASK) + 1
    if (which === 3) return ((n >> 11) & SUB_MASK) + 1
    return -1
  }

  /**
   * `Gui Menu(4)`: step to the next item of a multi-select, 1 if there was
   * one and 0 if not.
   *
   * The $1d58 branch calls ItemAddress on the strip it kept, reads NextSelect
   * out of `$20(a0)`, and stores it back over the pending number before
   * setting the pending bit again. Zero when there is no strip, which is the
   * `tst.l $f0(a1) / beq` at $1d5a.
   */
  nextMenuSelect(): number {
    if (this.menuStrip === null) return 0
    const it = this.gt.itemAddress(this.menuStrip, this.menuNumber)
    if (it === null || it.nextSelect === MENUNULL) return 0
    this.menuNumber = it.nextSelect
    this.menuPending = true
    return 1
  }

  /** `Gui Reset`: close all the windows */
  reset(): void {
    this.windows.clear()
    this.pending.length = 0
    this.last = null
    this.selected = 0
    this.actual = 0
    this.menuPending = false
    this.menuNumber = MENUNULL
    this.menuStrip = null
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
      if (e.mouseX !== undefined) this.eventX = e.mouseX
      if (e.mouseY !== undefined) this.eventY = e.mouseY
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

  /**
   * `Gui Mouse Zone(window,x,y)`, the hit test at $4c4e.
   *
   * First match wins and both edges are inclusive: the four tests are `bgt`
   * on x1 and `blt` on x2, so a point on the border is inside. -1 when
   * nothing contains it, which is the `moveq #$ff,d0` the loop falls out to.
   *
   * A reserved-but-never-set zone is all zeros, because the block is
   * AllocVec'd MEMF_CLEAR, so it contains the point 0,0. That is not a
   * special case in the test, it is what a zero rectangle means to it.
   */
  zoneAt(window: number, x: number, y: number): number {
    const list = this.zones.get(window) ?? []
    for (const [i, z] of list.entries()) {
      if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) return i
    }
    return -1
  }

  /** the gadget a window's design carries under `id`, or null */
  gadget(w: GuiWindow, id: number): GuiGadget | null {
    return w.design.gadgets.find((g) => g.id === id) ?? null
  }

  /**
   * The visible items of a LISTVIEW: the non-empty entries of the array a
   * program gave it, in order.
   *
   * The library builds a `struct List` of Nodes, one per non-empty string,
   * and keeps the source index in each node at `$e` -- which is what `Gui
   * Array Read` walks at $3112. Skipping the empties is the behaviour the
   * guide spells out with its own example: five elements, two of them empty,
   * "the listview will be" three lines.
   */
  listItems(items: readonly string[]): Array<{ index: number; text: string }> {
    const out: Array<{ index: number; text: string }> = []
    for (const [i, t] of items.entries()) if (t !== '') out.push({ index: i, text: t })
    return out
  }

  /** a gadget's three attributes, made on demand and zero until set */
  attrsOf(w: GuiWindow, id: number): [number, number, number] {
    let a = w.attrs.get(id)
    if (a === undefined) {
      a = [0, 0, 0]
      w.attrs.set(id, a)
    }
    return a
  }
}

/** a window's own RastPort, sized to it and never smaller than one pixel */
export function newWindowPort(width: number, height: number): RastPort {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  return new RastPort(new BitMap(w, h, GUI_WINDOW_DEPTH, rowBytesFor(w)))
}
