/**
 * intuition.library — the Workbench screen, and who owns the display.
 *
 * ## Why this starts with a screen and not a window
 *
 * The first Intuition call anything in this port reaches is OpenWorkBench.
 * EasyLife's `Eliconify Begin` opens with OpenWorkBench / WBenchToFront /
 * OpenWindow, and jd-int wants the same screen. A window cannot exist before
 * the screen it is on, and the screen is the harder of the two here, because
 * the display is a single copper-list interpreter: anything that wants to
 * appear has to express itself as copper registers plus BPLxPT. There is no
 * second renderer to hang an Intuition screen off.
 *
 * That question turned out to be already answered, by AMOS. AMOS opens
 * screens BASIC cannot name — EcFonc 8, EcEdit 9, EcFsel 10, EcReq 11
 * (+Equ.s:792) — and they are ordinary screens in every respect the hardware
 * cares about: a slot in `screens`, a place in `order`, a band in the copper
 * list, a slot in the chip address space. The only thing that makes them
 * system screens is that `Screen Open` rejects the index.
 *
 * So a Workbench screen is one of those, at a slot of its own. This module
 * does not build it — that is `ScreenHost`, below, implemented on the AMOS
 * side, because the layer rule (src/amiga/layer.test.ts) is that nothing here
 * imports from src/runtime. What this module owns is everything that is
 * intuition.library's rather than the machine's: the geometry and palette the
 * Workbench screen opens with, whether it is open, and the four calls'
 * success and failure conditions.
 *
 * ## Evidence
 *
 * LVOs from `fixtures/amigaos/FD1.3/intuition_lib.fd` (Commodore's own
 * function definitions, off the Workbench 1.3.3 Extras disk): OpenWorkBench
 * -210, CloseWorkBench -78, WBenchToFront -342, WBenchToBack -336. AROS
 * confirms the numbering from the other direction — `AROS_LH0(IPTR,
 * OpenWorkBench, ..., 35, Intuition)` is 35 * 6 = -210.
 *
 * Behaviour from AROS's rom/intuition/openworkbench.c and closeworkbench.c
 * (data and semantics only; AROS is APL/LGPL and none of its code is copied):
 * OpenWorkBench returns the EXISTING screen if there is one rather than
 * opening a second, and CloseWorkBench returns FALSE both when there is no
 * Workbench screen at all and when something is still visiting it.
 *
 * The screen itself is read off the disk rather than remembered. Workbench
 * 1.3 rev 34.20 (GB), `devs/system-configuration`, is a `struct Preferences`,
 * and the four screen colours sit at offsets 110-116. The decode is confirmed
 * end to end by PrinterFilename: "generic" lands at offset 128, exactly where
 * the struct puts it.
 *
 * ## And then a window
 *
 * OpenWindow (-204) and CloseWindow (-72) sit on `./layers.ts`: a window IS a
 * layer plus a border, a title, some system gadgets and a message port. The
 * layer chain does the occlusion, this file does everything Intuition adds on
 * top of it. See `renderFrame` for what is and is not evidence-backed about
 * the pixels.
 */
import type { DiskFont } from './diskfont'
import type { RastPort } from './graphics'
import { LayerInfo, Region, type Layer, type Rect } from './layers'

/** the Workbench screen's colours, from Preferences on the 1.3 disk */
export const WB_PALETTE: readonly number[] = [
  0x005a, // color0 — the blue desktop
  0x0fff, // color1 — white, the text pen
  0x0002, // color2 — "black" (a very dark blue, not $000)
  0x0f80, // color3 — orange, the highlight pen
]

/**
 * The Workbench screen's geometry.
 *
 * NOTE: 640x256 hires, depth 2. AROS takes width and height from
 * GfxBase->NormalDisplayColumns/Rows when Preferences asks for
 * STDSCREENWIDTH/HEIGHT, which on PAL is 640x256, and depth from
 * ScreenModePrefs — a V39 file that a 1.3 machine does not have, where the
 * Workbench screen is four colours. `system-configuration` carries no screen
 * size or depth field at all, so this is the machine's answer rather than the
 * disk's, and a 1.3 Workbench is 640x256x2 on every PAL Amiga.
 */
export const WB_WIDTH = 640
export const WB_HEIGHT = 256
export const WB_DEPTH = 2

/**
 * `struct Preferences`, as GetPrefs (-126) and GetDefPrefs (-132) hand it out.
 *
 * 232 bytes, and the two offsets this port has actually CONFIRMED against a
 * real file are the ones the comment at the top of this module names: the
 * four screen colours at 110, 112, 114 and 116, and PrinterFilename at 128,
 * where "generic" lands on the Workbench 1.3.3 disk. Everything below is
 * placed relative to those two anchors.
 *
 * Only the fields this port has an answer for are filled in. The rest stay
 * zero, which is a defensible Preferences rather than an invented one: a
 * program reading a field nothing here models gets the same nothing it would
 * get from a machine whose Preferences had never been saved.
 */
export const PREFERENCES_SIZEOF = 232

/** the field offsets filled in below, named as intuition/preferences.h names them */
export const PREF = {
  fontHeight: 0,
  printerPort: 1,
  baudRate: 2,
  /** color17..19, the sprite colours */
  color17: 102,
  pointerTicks: 108,
  /** the four Workbench screen colours -- the anchor this decode was checked on */
  color0: 110,
  viewXOffset: 118,
  viewYOffset: 119,
  viewInitX: 120,
  viewInitY: 122,
  enableCli: 124,
  printerType: 126,
  /** "generic" on the 1.3 disk, and the second anchor */
  printerFilename: 128,
  laceWb: 185,
} as const

/**
 * A Preferences block for a machine running this port: the Workbench palette
 * this module already keeps, a topaz-8 font height, and the CLI enabled.
 *
 * `def` is GetDefPrefs rather than GetPrefs. On a real machine the two differ
 * once anything has edited Preferences and been saved; here nothing can, so
 * they answer alike and the flag exists to record that the distinction was
 * read rather than missed.
 */
export function preferencesBytes(def = false): Uint8Array {
  const out = new Uint8Array(PREFERENCES_SIZEOF)
  const dv = new DataView(out.buffer)
  out[PREF.fontHeight] = 8
  dv.setUint16(PREF.baudRate, 9600)
  dv.setUint16(PREF.pointerTicks, 1)
  for (let i = 0; i < 4; i++) dv.setUint16(PREF.color0 + i * 2, WB_PALETTE[i]!)
  dv.setInt16(PREF.viewInitX, 0)
  dv.setInt16(PREF.viewInitY, 0)
  dv.setUint16(PREF.enableCli, def ? 0 : 1)
  for (const [i, c] of Array.from('generic').entries()) out[PREF.printerFilename + i] = c.charCodeAt(0)
  return out
}

/**
 * What the machine has to be able to do for a screen to exist. Implemented on
 * the AMOS side (Runtime), because building a bitmap and putting it in the
 * copper list is the machine's job, not intuition.library's.
 *
 * `slot` is a screen index above the range any keyword can name.
 */
export interface ScreenHost {
  /** open a screen at this slot; a no-op if one is already there */
  openScreen(slot: number, spec: ScreenSpec): void
  /** close it; returns false if it could not be closed */
  closeScreen(slot: number): boolean
  screenToFront(slot: number): void
  screenToBack(slot: number): void
  isOpen(slot: number): boolean
  /**
   * The address a program would see as `struct Screen *`. Intuition hands
   * these out and programs pass them straight back, so what matters is only
   * that it is stable, non-zero and distinct per screen.
   */
  screenAddr(slot: number): number
  /**
   * The screen's geometry, for the Layer_Info over its bitmap. `hires`
   * selects the system-gadget size the way Intuition does — a hires screen
   * gets the MEDRES images, a lores one the LOWRES images (AROS
   * openwindow.c:846).
   */
  screenSize(slot: number): { width: number; height: number; hires: boolean } | null
  /**
   * The screen's RastPort. Window frames are Intuition's own pixels and it
   * draws them itself; a null RastPort means a screen that cannot be drawn
   * into, and rendering is skipped rather than failing.
   */
  screenRast(slot: number): RastPort | null
  /**
   * The face a window title is drawn in — topaz 8 on a 1.3 machine. Null
   * draws no title, which is what a RastPort with no rp_Font does anyway.
   */
  systemFont(): DiskFont | null
}

export interface ScreenSpec {
  width: number
  height: number
  depth: number
  hires: boolean
  laced: boolean
  palette: readonly number[]
  /** hardware line the screen's top edge sits on */
  displayY: number
  title: string
}

/**
 * The slot the Workbench screen takes. Above AMOS's own system screens
 * (8-11), in the range reserved for screens the machine's OWNER opens.
 */
export const WB_SLOT = 12

/**
 * Where a CUSTOM screen goes — `OpenScreen` with `NewScreen.Type` of
 * CUSTOMSCREEN, which is what jd-int's `Jd Open Intscreen` asks for.
 *
 * Above the Workbench, for the same reason the Workbench is above AMOS's own
 * system screens: nothing that shares this address space may collide, and the
 * slot decides the copper band. Eight of them, which is more than any program
 * in the corpus opens and cheap to bound — an unbounded pool would let a
 * program in a loop allocate bitmaps until the machine died, where the real
 * OpenScreen fails on chip RAM and returns NULL.
 */
export const CUSTOM_SLOT_FIRST = 13
export const CUSTOM_SLOT_COUNT = 8

/**
 * NOTE: the Workbench screen opens at hardware line 44, not at the top of the
 * raster. AMOS's default screen sits at line 50 (EcYBase+24) and a real
 * Workbench sits a little above it; the exact figure is a Preferences
 * ViewInitY on the real machine and this file's copy reads 0, which means
 * "wherever the ROM puts it". 44 is the standard PAL Workbench top edge.
 */
export const WB_DISPLAY_Y = 44

// ---- windows -------------------------------------------------------------

/**
 * IDCMP class bits (intuition/intuition.h). Only the ones something in this
 * port raises or listens for are named; the numbering is the header's and is
 * confirmed from the other side by the extension binaries that ask for them —
 * EasyLife's `Eliconify Begin` writes $208 into NewWindow.IDCMPFlags, which is
 * exactly CLOSEWINDOW | MOUSEBUTTONS.
 */
export const IDCMP_NEWSIZE = 0x2
export const IDCMP_REFRESHWINDOW = 0x4
export const IDCMP_MOUSEBUTTONS = 0x8
export const IDCMP_MOUSEMOVE = 0x10
export const IDCMP_GADGETDOWN = 0x20
export const IDCMP_GADGETUP = 0x40
export const IDCMP_MENUPICK = 0x100
export const IDCMP_DISKINSERTED = 0x8000
export const IDCMP_DISKREMOVED = 0x1_0000
export const IDCMP_VANILLAKEY = 0x20_0000
export const IDCMP_CLOSEWINDOW = 0x200
export const IDCMP_ACTIVEWINDOW = 0x4_0000
export const IDCMP_INACTIVEWINDOW = 0x8_0000

/**
 * WFLG_* — NewWindow.Flags. Same source, and the same second witness:
 * EasyLife asks for $1000E, which is RMBTRAP | DRAGBAR | DEPTHGADGET |
 * CLOSEGADGET, a window you can move, depth-arrange and close but not size.
 */
export const WFLG_SIZEGADGET = 0x1
export const WFLG_DRAGBAR = 0x2
export const WFLG_DEPTHGADGET = 0x4
export const WFLG_CLOSEGADGET = 0x8
export const WFLG_SIMPLE_REFRESH = 0x40
export const WFLG_SUPER_BITMAP = 0x80
export const WFLG_BACKDROP = 0x100
export const WFLG_REPORTMOUSE = 0x200
export const WFLG_BORDERLESS = 0x800
export const WFLG_ACTIVATE = 0x1000
export const WFLG_WINDOWACTIVE = 0x2000
export const WFLG_RMBTRAP = 0x1_0000

/**
 * IntuiMessage.Code for an IDCMP_MOUSEBUTTONS: the raw input event's
 * IECODE_LBUTTON/RBUTTON, with IECODE_UP_PREFIX ($80) on the release.
 * EasyLife compares against $69 and $e9, the right button down and up.
 */
export const SELECTDOWN = 0x68
export const SELECTUP = 0xe8
export const MENUDOWN = 0x69
export const MENUUP = 0xe9

/** NewWindow.Type */
export const WBENCHSCREEN = 1
export const CUSTOMSCREEN = 0xf

/**
 * The screen's window-border widths — `struct Screen`'s WBorTop/Left/Right/
 * Bottom, which every window on it inherits (AROS openwindow.c:732-739).
 * A titled window then adds the font to the top: `BorderTop += YSize + 1`
 * (openwindow.c:754), so topaz 8 gives 2 + 8 + 1 = ELEVEN.
 *
 * That number is the reason to trust the rest of it. EasyLife's iconify
 * window is `dc.w 11` for its height and nothing else, and its `Eliconify
 * Test` rejects any click at row 10 or below — a window that is its title bar
 * and not one pixel more. The extension and the OS agree without either
 * having been consulted about the other.
 */
export const WBORTOP = 2
export const WBORLEFT = 4
export const WBORRIGHT = 4
export const WBORBOTTOM = 2

/** the system font's height, which is what BorderTop is measured in */
export const SYSFONT_YSIZE = 8

/** BorderTop for a window with a title bar */
export const TITLE_HEIGHT = WBORTOP + SYSFONT_YSIZE + 1

/**
 * System-gadget widths, from AROS's windecorclass.c:298-308 — the sizes it
 * keeps for compatibility rather than its own DEFSIZE. LOWRES for a lores
 * screen, MEDRES for a hires one; the HIRES column is for a 1280-wide mode
 * this port has no screens in.
 */
export const CLOSE_WIDTH_LORES = 15
export const CLOSE_WIDTH_MEDRES = 20
export const DEPTH_WIDTH_LORES = 18
export const DEPTH_WIDTH_MEDRES = 24

export interface NewWindow {
  leftEdge: number
  topEdge: number
  width: number
  height: number
  /** rp_FgPen for the title and the gadget detail; the screen's if omitted */
  detailPen: number
  /** what the border bars are filled with */
  blockPen: number
  idcmpFlags: number
  flags: number
  title: string
  /** WBENCHSCREEN or CUSTOMSCREEN; CUSTOMSCREEN needs `screenSlot` */
  type: number
  /** which screen, when Type is CUSTOMSCREEN */
  screenSlot?: number
}

/** exec's `struct Message` as Intuition fills it in for a window's UserPort */
export interface IntuiMessage {
  /** the IDCMP_* bit that raised it */
  class: number
  code: number
  qualifier: number
  /** the pointer, in WINDOW coordinates */
  mouseX: number
  mouseY: number
  seconds: number
  micros: number
  /**
   * IntuiMessage.IAddress. On the machine this is a pointer whose meaning
   * depends on the class; the only class anything here raises it for is
   * GADGETUP, where it points at the Gadget and a program reads GadgetID out
   * of it. There are no gadget structures in this address space, so the id
   * IS the address as far as a caller can tell — which is all jd-int wants.
   */
  iaddress: number
}

/** which part of the border the pointer is over */
export type WindowPart = 'close' | 'depth' | 'drag' | 'body'

/**
 * `struct Window`. The geometry lives in the Layer's rectangle rather than
 * being copied into fields beside it, because the layer chain is what moves
 * and clips it and two copies of the same numbers is how they drift.
 */
export class Window {
  constructor(
    readonly screenSlot: number,
    readonly layer: Layer,
    readonly title: string,
    readonly idcmpFlags: number,
    flags: number,
    readonly detailPen: number,
    readonly blockPen: number,
    readonly closeWidth: number,
    readonly depthWidth: number,
  ) {
    this.flags = flags
  }

  flags: number

  get leftEdge(): number {
    return this.layer.rect.minX
  }
  get topEdge(): number {
    return this.layer.rect.minY
  }
  get width(): number {
    return this.layer.rect.maxX - this.layer.rect.minX + 1
  }
  get height(): number {
    return this.layer.rect.maxY - this.layer.rect.minY + 1
  }

  get borderless(): boolean {
    return (this.flags & WFLG_BORDERLESS) !== 0
  }
  get borderTop(): number {
    if (this.borderless) return 0
    return this.title !== '' || (this.flags & (WFLG_DRAGBAR | WFLG_CLOSEGADGET | WFLG_DEPTHGADGET)) !== 0
      ? TITLE_HEIGHT
      : WBORTOP
  }
  get borderLeft(): number {
    return this.borderless ? 0 : WBORLEFT
  }
  get borderRight(): number {
    return this.borderless ? 0 : WBORRIGHT
  }
  get borderBottom(): number {
    return this.borderless ? 0 : WBORBOTTOM
  }

  get active(): boolean {
    return (this.flags & WFLG_WINDOWACTIVE) !== 0
  }

  /** the pointer's last position, in window coordinates (Window.MouseX/Y) */
  mouseX = 0
  mouseY = 0

  /** the UserPort's queue. Held oldest first, which is what GetMsg pops. */
  private readonly queue: IntuiMessage[] = []

  /**
   * exec GetMsg on the window's UserPort. Null when the port is empty.
   *
   * NOTE: nothing here corresponds to ReplyMsg. On the machine a program that
   * never replies leaks the message and Intuition's free list drains; here the
   * message is simply gone once popped. That difference is observable ONLY as
   * memory, and it is the reason `Eliconify Test`'s missing ReplyMsg costs
   * nothing in this port — see the DEFECT note on that keyword.
   */
  getMsg(): IntuiMessage | null {
    return this.queue.shift() ?? null
  }

  /** how many messages are waiting, for a test to look at */
  get pending(): number {
    return this.queue.length
  }

  /**
   * Raise one, if the window asked for that class. A window's IDCMPFlags are
   * a filter and not a hint: Intuition does not queue what was not requested,
   * which is what keeps a program that only listens for CLOSEWINDOW from
   * drowning in MOUSEMOVE.
   */
  post(cls: number, code: number, qualifier = 0, seconds = 0, micros = 0, iaddress = 0): boolean {
    if ((this.idcmpFlags & cls) === 0) return false
    this.queue.push({
      class: cls,
      code,
      qualifier,
      mouseX: this.mouseX,
      mouseY: this.mouseY,
      seconds,
      micros,
      iaddress,
    })
    return true
  }

  /** which system gadget, if any, window-relative (rx, ry) is over */
  partAt(rx: number, ry: number): WindowPart {
    if (this.borderless) return 'body'
    if (ry < 0 || ry >= this.borderTop) return 'body'
    if ((this.flags & WFLG_CLOSEGADGET) !== 0 && rx < this.closeWidth) return 'close'
    if ((this.flags & WFLG_DEPTHGADGET) !== 0 && rx >= this.width - this.depthWidth) return 'depth'
    if ((this.flags & WFLG_DRAGBAR) !== 0) return 'drag'
    return 'body'
  }

  /**
   * The window's own gadget list — `AddGadget` (-42) and `RemoveGList` (-444).
   *
   * Only what a BOOLEAN gadget needs: a rectangle relative to the window and
   * the `GadgetID` that comes back in the IDCMP message. Intuition's Gadget
   * carries imagery, text, mutual-exclude and a SpecialInfo union as well;
   * none of that is here because nothing that opens one of these fills any of
   * it in — jd-int CopyMems a 48-byte template whose only live fields are the
   * four geometry words and the id.
   *
   * Kept in front-to-back order, and `gadgetAt` walks it that way, so a
   * gadget added later and overlapping an earlier one takes the click. That
   * is AddGadget's `position` of -1 (add at the END of the list) combined
   * with Intuition testing the list in order.
   */
  readonly gadgets: UserGadget[] = []

  /** the frontmost gadget containing a window-relative point, or null */
  gadgetAt(rx: number, ry: number): UserGadget | null {
    for (const g of this.gadgets) {
      if (rx >= g.leftEdge && rx < g.leftEdge + g.width && ry >= g.topEdge && ry < g.topEdge + g.height) return g
    }
    return null
  }
}

/**
 * A boolean gadget in a window, as much of `struct Gadget` as anything here
 * fills in. `id` is GadgetID at offset 38, which is what an IDCMP GADGETUP
 * message's caller reads back out of `IAddress`.
 */
export interface UserGadget {
  leftEdge: number
  topEdge: number
  width: number
  height: number
  id: number
}

export class Intuition {
  constructor(private readonly host: ScreenHost) {}

  /**
   * Visitors — anything that has claimed the Workbench screen and would be
   * left dangling if it closed. On a real machine these are windows opened
   * with a `NewWindow.Screen` pointing at it and LockPubScreen holders.
   *
   * OpenWindow on WB_SLOT is what increments it, and CloseWindow what puts
   * it back, so a program that has iconified onto the Workbench cannot have
   * the Workbench closed out from under it. `addVisitor`/`removeVisitor`
   * remain public for the other kind — a LockPubScreen holder that has no
   * window of its own.
   */
  private visitors = 0

  /** intuition.library -210. The existing screen if there is one, else a new
   * one; 0 if it could not be opened. */
  openWorkBench(): number {
    if (!this.host.isOpen(WB_SLOT)) {
      this.host.openScreen(WB_SLOT, {
        width: WB_WIDTH,
        height: WB_HEIGHT,
        depth: WB_DEPTH,
        hires: true,
        laced: false,
        palette: WB_PALETTE,
        displayY: WB_DISPLAY_Y,
        title: 'Workbench Screen',
      })
      if (!this.host.isOpen(WB_SLOT)) return 0
    }
    return this.host.screenAddr(WB_SLOT)
  }

  /**
   * intuition.library -78. FALSE when there is no Workbench screen to close
   * and when something is still visiting it — both of those are ordinary
   * outcomes rather than errors, and a program that iconifies is expected to
   * cope with the Workbench refusing to go away.
   */
  closeWorkBench(): boolean {
    if (!this.host.isOpen(WB_SLOT)) return false
    if (this.visitors !== 0) return false
    if (!this.host.closeScreen(WB_SLOT)) return false
    // the layer chain belonged to that bitmap and the bitmap is gone
    this.infos.delete(WB_SLOT)
    return true
  }

  /** intuition.library -342 */
  wBenchToFront(): boolean {
    if (!this.host.isOpen(WB_SLOT)) return false
    this.host.screenToFront(WB_SLOT)
    return true
  }

  /** intuition.library -336 */
  wBenchToBack(): boolean {
    if (!this.host.isOpen(WB_SLOT)) return false
    this.host.screenToBack(WB_SLOT)
    return true
  }

  /** is the Workbench screen open? (IntuitionBase->WorkBench != NULL) */
  workBenchOpen(): boolean {
    return this.host.isOpen(WB_SLOT)
  }

  /** a visitor claims the Workbench screen, and CloseWorkBench starts failing */
  addVisitor(): void {
    this.visitors++
  }

  removeVisitor(): void {
    if (this.visitors > 0) this.visitors--
  }

  // ---- windows -----------------------------------------------------------

  /** one Layer_Info per screen, made on the first window that lands there */
  private readonly infos = new Map<number, LayerInfo>()
  private readonly open: Window[] = []
  private activeWin: Window | null = null
  /** something changed shape or depth; the next render() has work to do */
  private dirty = false
  /** a drag in progress, and where in the bar it was grabbed */
  private drag: { w: Window; ox: number; oy: number } | null = null
  /** a system gadget pressed but not yet released — RelVerify */
  private armed: { w: Window; part: WindowPart } | null = null
  /** the boolean gadget a press landed on, waiting for the release that fires it */
  private armedGadget: { w: Window; g: UserGadget } | null = null
  private buttons = 0

  /** every open window, backmost first */
  get windows(): readonly Window[] {
    return this.open
  }

  /** IntuitionBase->ActiveWindow */
  get activeWindow(): Window | null {
    return this.activeWin
  }

  /** the layer chain over a screen's bitmap, created on demand */
  private info(slot: number): LayerInfo | null {
    const have = this.infos.get(slot)
    if (have) return have
    const size = this.host.screenSize(slot)
    if (!size) return null
    const li = new LayerInfo(size.width, size.height)
    this.infos.set(slot, li)
    return li
  }

  /**
   * intuition.library -204. Null when the window cannot be opened, which is
   * the return a program tests: EasyLife answers 2 for it, and its guide
   * names the cause — "Usually means that It wouldn't fit on the screen at
   * the given co-ordinates".
   *
   * That IS the check here. A window whose rectangle is not wholly inside the
   * screen fails, as does one on a screen that is not open.
   *
   * NOTE: SMART refresh is the default (WFLG_SIMPLE_REFRESH clear means
   * SMART_REFRESH), and `./layers.ts` clips a smart layer correctly but does
   * not allocate its backing store — a smart layer that is uncovered comes
   * back blank rather than restored. Nothing here notices, because Intuition
   * redraws these windows itself; a window with client content would.
   */
  openWindow(nw: NewWindow): Window | null {
    const slot = nw.type === WBENCHSCREEN ? WB_SLOT : (nw.screenSlot ?? -1)
    if (!this.host.isOpen(slot)) {
      // the Workbench is opened on demand, exactly as a NewWindow.Type of
      // WBENCHSCREEN asks for; any other screen has to be there already
      if (nw.type !== WBENCHSCREEN || this.openWorkBench() === 0) return null
    }
    const size = this.host.screenSize(slot)
    const li = this.info(slot)
    if (!size || !li) return null
    if (nw.width <= 0 || nw.height <= 0) return null
    if (nw.leftEdge < 0 || nw.topEdge < 0) return null
    if (nw.leftEdge + nw.width > size.width || nw.topEdge + nw.height > size.height) return null

    const r: Rect = {
      minX: nw.leftEdge,
      minY: nw.topEdge,
      maxX: nw.leftEdge + nw.width - 1,
      maxY: nw.topEdge + nw.height - 1,
    }
    const backdrop = (nw.flags & WFLG_BACKDROP) !== 0
    const refresh = (nw.flags & WFLG_SUPER_BITMAP) !== 0 ? 'super' : (nw.flags & WFLG_SIMPLE_REFRESH) !== 0 ? 'simple' : 'smart'
    const layer = backdrop ? li.createBehindLayer(r, refresh) : li.createUpfrontLayer(r, refresh)
    layer.backdrop = backdrop

    const w = new Window(
      slot,
      layer,
      nw.title,
      nw.idcmpFlags,
      nw.flags & ~WFLG_WINDOWACTIVE,
      nw.detailPen,
      nw.blockPen,
      size.hires ? CLOSE_WIDTH_MEDRES : CLOSE_WIDTH_LORES,
      size.hires ? DEPTH_WIDTH_MEDRES : DEPTH_WIDTH_LORES,
    )
    if (backdrop) this.open.unshift(w)
    else this.open.push(w)
    if (slot === WB_SLOT) this.visitors++
    // The interior, ONCE, at open. Intuition clears a new window's box and
    // then leaves the contents to whoever opened it, and `renderFrame` used to
    // repeat the clear on every refresh --- which is invisible while only the
    // Workbench renders and nothing draws into a window there, and erases the
    // program's own drawing the moment either changes. jd-int's `Jd Intplot`
    // and Int 1.0's `Wb Draw` are both windows a program draws into.
    const rp = this.host.screenRast(slot)
    if (rp) {
      const save = rp.snapshot()
      rp.clip = null
      rp.drawMode = 0
      rp.areaPtrn = null
      rp.mask = 0xff
      rp.rectFill(r.minX, r.minY, r.maxX, r.maxY, 0)
      rp.restore(save)
    }
    this.dirty = true
    if ((nw.flags & WFLG_ACTIVATE) !== 0) this.activateWindow(w)
    return w
  }

  /**
   * `OpenScreen(newScreen)` — intuition.library -198, for a CUSTOMSCREEN.
   *
   * Returns the address a program holds as `struct Screen *`, or 0 when there
   * is no slot left or the geometry is not one this display can show. The
   * Workbench is NOT reachable this way: `openWorkBench` owns WB_SLOT and the
   * two must not fight over it, which is also why `NewScreen.Type` decides
   * between them at the caller rather than here.
   *
   * DEVIATION: the machine's OpenScreen fails on chip RAM before it fails on
   * anything else, and the failure a program can actually provoke is a depth
   * or a width the display cannot do. Depth is bounded at 6 — 5 bitplanes
   * plus HAM/EHB is the most an OCS display fetches — and a zero or negative
   * dimension is refused. Everything else opens.
   */
  openScreen(spec: ScreenSpec): number {
    if (spec.width <= 0 || spec.height <= 0) return 0
    if (spec.depth <= 0 || spec.depth > 6) return 0
    let slot = -1
    for (let i = 0; i < CUSTOM_SLOT_COUNT; i++) {
      if (!this.host.isOpen(CUSTOM_SLOT_FIRST + i)) {
        slot = CUSTOM_SLOT_FIRST + i
        break
      }
    }
    if (slot < 0) return 0
    this.host.openScreen(slot, spec)
    if (!this.host.isOpen(slot)) return 0
    this.host.screenToFront(slot)
    this.dirty = true
    return this.host.screenAddr(slot)
  }

  /**
   * `CloseScreen(screen)` — intuition.library -66. False when the address is
   * not a screen this opened, or when a window is still on it: the machine
   * leaves a screen with windows open and CloseScreen returns FALSE, which is
   * the same protection `closeWorkBench` already has through its visitor
   * count.
   */
  closeScreen(addr: number): boolean {
    const slot = this.slotOf(addr)
    if (slot === null) return false
    if (this.open.some((w) => w.screenSlot === slot)) return false
    this.infos.delete(slot)
    this.dirty = true
    return this.host.closeScreen(slot)
  }

  /** the custom slot holding this `struct Screen *`, or null */
  slotOf(addr: number): number | null {
    if (addr === 0) return null
    for (let i = 0; i < CUSTOM_SLOT_COUNT; i++) {
      const slot = CUSTOM_SLOT_FIRST + i
      if (this.host.isOpen(slot) && this.host.screenAddr(slot) === addr) return slot
    }
    return null
  }

  /** `ScreenToFront(screen)` — intuition.library -252 */
  screenToFront(addr: number): void {
    const slot = this.slotOf(addr)
    if (slot === null) return
    this.host.screenToFront(slot)
    this.dirty = true
  }

  /** intuition.library -72 */
  closeWindow(w: Window): boolean {
    const i = this.open.indexOf(w)
    if (i < 0) return false
    this.open.splice(i, 1)
    this.info(w.screenSlot)?.deleteLayer(w.layer)
    if (w.screenSlot === WB_SLOT && this.visitors > 0) this.visitors--
    if (this.drag?.w === w) this.drag = null
    if (this.armed?.w === w) this.armed = null
    if (this.activeWin === w) {
      this.activeWin = null
      // Intuition activates whatever is now in front, on the same screen
      const next = this.frontWindow(w.screenSlot)
      if (next) this.activateWindow(next)
    }
    this.dirty = true
    return true
  }

  /** ActivateWindow (-450), and the two IDCMP classes that go with it */
  activateWindow(w: Window): void {
    if (this.activeWin === w) return
    const old = this.activeWin
    if (old) {
      old.flags &= ~WFLG_WINDOWACTIVE
      old.post(IDCMP_INACTIVEWINDOW, 0)
    }
    this.activeWin = w
    w.flags |= WFLG_WINDOWACTIVE
    w.post(IDCMP_ACTIVEWINDOW, 0)
    this.dirty = true
  }

  /** WindowToFront (-312) */
  windowToFront(w: Window): void {
    const li = this.info(w.screenSlot)
    if (!li || !li.upfrontLayer(w.layer)) return
    const i = this.open.indexOf(w)
    if (i >= 0) {
      this.open.splice(i, 1)
      this.open.push(w)
    }
    this.dirty = true
  }

  /** WindowToBack (-306) */
  windowToBack(w: Window): void {
    const li = this.info(w.screenSlot)
    if (!li || !li.behindLayer(w.layer)) return
    const i = this.open.indexOf(w)
    if (i >= 0) {
      this.open.splice(i, 1)
      this.open.unshift(w)
    }
    this.dirty = true
  }

  /**
   * MoveWindow (-168). Clamped to the screen.
   *
   * DEVIATION: Intuition lets a window be dragged past the right and bottom
   * edges, and the layer chain here would clip it correctly if it were. It is
   * clamped because nothing in this port can drag a window BACK once its
   * title bar is off the screen — there is no Workbench menu, no keyboard
   * shortcut and no window list. A window that cannot be recovered is worse
   * than one that will not go quite far enough.
   */
  moveWindow(w: Window, dx: number, dy: number): void {
    const size = this.host.screenSize(w.screenSlot)
    const li = this.info(w.screenSlot)
    if (!size || !li) return
    const x = Math.max(0, Math.min(size.width - w.width, w.leftEdge + dx))
    const y = Math.max(0, Math.min(size.height - w.height, w.topEdge + dy))
    if (x === w.leftEdge && y === w.topEdge) return
    li.moveLayer(w.layer, x - w.leftEdge, y - w.topEdge)
    this.dirty = true
  }

  /** the frontmost window on a screen */
  private frontWindow(slot: number): Window | null {
    for (let i = this.open.length - 1; i >= 0; i--) {
      const w = this.open[i]!
      if (w.screenSlot === slot) return w
    }
    return null
  }

  /** WhichWindow: the frontmost window whose VISIBLE part covers the point */
  windowAt(slot: number, x: number, y: number): Window | null {
    const li = this.infos.get(slot)
    if (!li) return null
    const l = li.whichLayer(x, y)
    if (!l) return null
    return this.open.find((w) => w.layer === l) ?? null
  }

  // ---- input -------------------------------------------------------------

  /**
   * One frame of the pointer, in SCREEN coordinates, with AMOS's button
   * encoding (bit 0 left, bit 1 right) — the caller already has both and
   * neither the input event stream nor the input.device is modelled here.
   *
   * What Intuition does with it, and why each piece is where it is:
   *
   * - the LEFT button activates the window under it and works its system
   *   gadgets. A gadget with GA_RelVerify — which the close and depth
   *   gadgets have — fires on RELEASE, and only if the pointer is still
   *   inside it, so a press you drag off is a press you cancelled.
   * - the RIGHT button goes to the ACTIVE window, wherever the pointer is.
   *   That is the whole reason EasyLife's iconify window works: it asks for
   *   RMBTRAP so the right button reaches it as MOUSEBUTTONS instead of
   *   opening a menu, and then tests the coordinates itself.
   */
  handleInput(slot: number, x: number, y: number, buttons: number, seconds = 0, micros = 0): void {
    const li = this.infos.get(slot)
    if (!li) return
    const prev = this.buttons
    this.buttons = buttons
    const left = (buttons & 1) !== 0
    const wasLeft = (prev & 1) !== 0
    const right = (buttons & 2) !== 0
    const wasRight = (prev & 2) !== 0

    // every window on this screen sees the pointer, because a message posted
    // later reads MouseX/MouseY off the window it is posted to
    for (const w of this.open) {
      if (w.screenSlot !== slot) continue
      w.mouseX = x - w.leftEdge
      w.mouseY = y - w.topEdge
    }

    if (this.drag) {
      if (left) {
        this.moveWindow(this.drag.w, x - this.drag.ox - this.drag.w.leftEdge, y - this.drag.oy - this.drag.w.topEdge)
        return
      }
      this.drag = null
    }

    if (left && !wasLeft) {
      const w = this.windowAt(slot, x, y)
      if (w) {
        this.activateWindow(w)
        const part = w.partAt(x - w.leftEdge, y - w.topEdge)
        const g = part === 'body' ? w.gadgetAt(x - w.leftEdge, y - w.topEdge) : null
        if (g) {
          // a boolean gadget with GA_RelVerify fires on RELEASE, so the press
          // only arms it; `armedGadget` is the same idea as `armed` for the
          // system gadgets and cancels the same way, by moving off it
          this.armedGadget = { w, g }
          w.post(IDCMP_GADGETDOWN, 0, 0, seconds, micros, g.id)
        } else if (part === 'drag') this.drag = { w, ox: x - w.leftEdge, oy: y - w.topEdge }
        else if (part === 'body') w.post(IDCMP_MOUSEBUTTONS, SELECTDOWN, 0, seconds, micros)
        else this.armed = { w, part }
      }
    } else if (!left && wasLeft) {
      const ag = this.armedGadget
      this.armedGadget = null
      if (ag) {
        if (ag.w.gadgetAt(x - ag.w.leftEdge, y - ag.w.topEdge) === ag.g) {
          ag.w.post(IDCMP_GADGETUP, 0, 0, seconds, micros, ag.g.id)
        }
        return
      }
      const a = this.armed
      this.armed = null
      if (a && a.w.partAt(x - a.w.leftEdge, y - a.w.topEdge) === a.part) {
        if (a.part === 'close') a.w.post(IDCMP_CLOSEWINDOW, 0, 0, seconds, micros)
        else if (a.part === 'depth') this.depthArrange(a.w)
      } else if (!a) {
        this.activeWin?.post(IDCMP_MOUSEBUTTONS, SELECTUP, 0, seconds, micros)
      }
    }

    if (right !== wasRight) {
      this.activeWin?.post(IDCMP_MOUSEBUTTONS, right ? MENUDOWN : MENUUP, 0, seconds, micros)
    }
  }

  /** the depth gadget: to the front, unless it is already there */
  private depthArrange(w: Window): void {
    if (this.frontWindow(w.screenSlot) === w) this.windowToBack(w)
    else this.windowToFront(w)
  }

  // ---- rendering ---------------------------------------------------------

  /**
   * Put the screen's windows on it. A no-op unless something moved, so the
   * caller can drive it every frame.
   *
   * ## What this is, and what it is not
   *
   * Intuition on the machine repaints only DAMAGE, and asks the program to
   * repaint its own window with a REFRESHWINDOW message. Nothing in this port
   * has client content in an Intuition window — the frames are all Intuition's
   * own pixels — so painting the background and then every window back to
   * front reaches the same bitmap, and does it without a refresh protocol
   * nothing would answer. `./layers.ts` still does the work that matters: each
   * window paints through its layer's visible region, so a window behind
   * another is clipped by it rather than drawn over it.
   *
   * DEVIATION: a window with client content would come back blank here where
   * the machine would have asked its owner to redraw it. The moment anything
   * opens an Intuition window it draws into itself, this has to become
   * damage-driven; it is not, and the layer already carries the damage list
   * that would drive it.
   */
  render(slot: number): void {
    if (!this.dirty) return
    const li = this.infos.get(slot)
    const rp = this.host.screenRast(slot)
    if (!li || !rp) return
    this.dirty = false

    const save = rp.snapshot()
    rp.drawMode = 0 // JAM1: these are flat fills, not patterned ones
    rp.areaPtrn = null
    rp.linePtrn = 0xffff
    rp.mask = 0xff

    // The desktop, wherever no window covers it, and ONLY on the Workbench.
    //
    // A custom screen's background belongs to whoever opened it: jd-int draws
    // straight onto the screen's RastPort when no window is current, which is
    // its documented fallback, and filling here would erase that every time a
    // window moved. Intuition does not repaint a custom screen either --- it
    // damages the uncovered region and leaves the owner to refresh it --- so
    // the fill is the Workbench's backdrop rather than a rule about screens.
    if (slot === WB_SLOT) {
      const bg = Region.fromRect(li.bounds())
      for (const l of li.layers) bg.clearRect(l.rect)
      for (const r of bg.rects) rp.rectFill(r.minX, r.minY, r.maxX, r.maxY, 0)
    }

    for (const w of this.open) {
      if (w.screenSlot !== slot) continue
      for (const r of w.layer.visible().rects) this.renderFrame(rp, w, r)
    }
    rp.restore(save)
  }

  /** force the next render() to repaint, e.g. after something else drew */
  invalidate(): void {
    this.dirty = true
  }

  /**
   * One window's frame, clipped to one of its visible rectangles.
   *
   * ## The evidence, and the honest edge of it
   *
   * The GEOMETRY is sourced: border widths from `struct Screen`'s
   * WBorTop/Left/Right/Bottom, the title bar's height from
   * `BorderTop += tf_YSize + 1`, gadget widths from the compatibility table
   * in AROS's windecorclass.c. Those numbers are checked from the other side
   * by EasyLife, which hardcodes 11 for the height of a window that is
   * nothing but its title bar.
   *
   * The PENS are documented roles rather than measured pixels: DetailPen is
   * "the pen used for the details of the window's border" and BlockPen "for
   * the block-fill areas", so the bars fill with BlockPen and the text and
   * gadget outlines draw in DetailPen, swapping over when the window is not
   * active so that active and inactive are told apart.
   *
   * NOTE: the gadget IMAGERY is not the ROM's. The 1.3 close and depth
   * gadgets are bitmap images in Kickstart, and no Kickstart is in the
   * archive; what is drawn here is a box with a mark in it, sized and placed
   * where the real one goes. Everything about these windows is faithful
   * except how the two gadgets look, and this is the sentence that says so.
   */
  private renderFrame(rp: RastPort, w: Window, clip: Rect): void {
    rp.clip = { x1: clip.minX, y1: clip.minY, x2: clip.maxX, y2: clip.maxY }
    const x1 = w.leftEdge
    const y1 = w.topEdge
    const x2 = x1 + w.width - 1
    const y2 = y1 + w.height - 1

    if (w.borderless) return

    const fill = w.active ? w.blockPen : w.detailPen
    const ink = w.active ? w.detailPen : w.blockPen
    const bt = w.borderTop

    // the four border bars
    rp.rectFill(x1, y1, x2, y1 + bt - 1, fill)
    if (w.borderBottom > 0) rp.rectFill(x1, y2 - w.borderBottom + 1, x2, y2, fill)
    if (w.borderLeft > 0) rp.rectFill(x1, y1 + bt, x1 + w.borderLeft - 1, y2, fill)
    if (w.borderRight > 0) rp.rectFill(x2 - w.borderRight + 1, y1 + bt, x2, y2, fill)

    // a one-pixel outline, so the window reads as one against the desktop
    rp.draw(x1, y1, x2, y1, ink)
    rp.draw(x1, y2, x2, y2, ink)
    rp.draw(x1, y1, x1, y2, ink)
    rp.draw(x2, y1, x2, y2, ink)
    if (bt < w.height) rp.draw(x1, y1 + bt - 1, x2, y1 + bt - 1, ink)

    let textX = x1 + w.borderLeft
    if ((w.flags & WFLG_CLOSEGADGET) !== 0) {
      this.renderGadget(rp, x1, y1, w.closeWidth, bt, ink, fill, 'close')
      textX = x1 + w.closeWidth + w.borderLeft
    }
    if ((w.flags & WFLG_DEPTHGADGET) !== 0) {
      this.renderGadget(rp, x2 - w.depthWidth + 1, y1, w.depthWidth, bt, ink, fill, 'depth')
    }

    if (w.title !== '') {
      const font = this.host.systemFont()
      if (font) {
        const old = rp.font
        rp.font = font
        rp.text(textX, y1 + WBORTOP + font.baseline, w.title, ink)
        rp.font = old
      }
    }
  }

  /** a system gadget: its box, and the mark that says which one it is */
  private renderGadget(
    rp: RastPort,
    gx: number,
    gy: number,
    gw: number,
    gh: number,
    ink: number,
    fill: number,
    which: 'close' | 'depth',
  ): void {
    rp.draw(gx + gw - 1, gy, gx + gw - 1, gy + gh - 1, ink)
    if (which === 'close') {
      // the 1.3 close gadget is a small filled square inside a hollow one
      const cx = gx + ((gw - 6) >> 1)
      const cy = gy + ((gh - 6) >> 1)
      rp.rectFill(cx, cy, cx + 5, cy + 5, ink)
      rp.rectFill(cx + 2, cy + 2, cx + 3, cy + 3, fill)
    } else {
      // and the depth gadget two overlapping rectangles, front one at the
      // top right, which is what "bring to front" means on the machine
      const bw = gw - 8
      const bh = gh - 4
      rp.rectFill(gx + 3, gy + 2, gx + 3 + bw - 1, gy + 2 + bh - 1, ink)
      rp.rectFill(gx + 4, gy + 3, gx + 3 + bw - 2, gy + 2 + bh - 2, fill)
      rp.rectFill(gx + 3 + (bw >> 1), gy + 2, gx + 3 + bw - 1, gy + 2 + (bh >> 1), ink)
    }
  }
}
