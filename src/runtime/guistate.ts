/**
 * The GUI extension's own state: which bank, which windows are open, what
 * happened.
 *
 * Split from the keyword file because the keywords are a thin surface over
 * this and the interesting part is what a window IS here. See ./guibank.ts
 * for the format the designs arrive in.
 *
 * One state for all three releases, with `release` marking the few fields and
 * answers that differ; ./gui.ts's header says why one port serves them.
 *
 * ## Evidence
 *
 * `GUI2.guide` by Pietro Ghizzoni, which documents 202 of 2.10's 204
 * keywords, `GUI.guide` for the 1.6 line and `AMOSPro_GUI.Doc` for the beta,
 * and the binaries where the three are silent. Every event code below is
 * 2.10's own list, quoted at `GUI_EVENT`; the beta stops at -6 and 1.61 at
 * -10.
 */
import { BitMap, RastPort } from '../amiga/graphics'
import { rowBytesFor } from '../amiga/planar'
import { GadTools, ITEM_MASK, MENU_MASK, MENUNULL, SUB_MASK, fullMenuNum, type MenuStrip } from '../amiga/gadtools'
import { WB_DEPTH, WB_HEIGHT, WB_PALETTE, WB_WIDTH } from '../amiga/intuition'
import type { Gui, GuiGadget, GuiRelease } from './guibank'
import { getCatalogStr, type Catalog } from '../amiga/localelib'

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
  /**
   * What 1.5b answers instead of 3, and its own doc says so: "-1 last window
   * closed" against 1.61's "3 - Last window closed."
   *
   * Routine 61's arm at $1980 clears both list heads and takes `moveq #$ff,d1`
   * where the three arms above it load 0, 1 and 2. So the beta's four codes
   * are 0, 1, 2 and -1, and a program that tested `Until Gui Close(1)=3` on
   * the beta would never stop.
   */
  LAST_BETA: -1,
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
 * What the pump keeps of an IntuiMessage's Qualifier: `andi.w #$7ffb` at
 * $6cf8, applied to `$e4` the instruction after it is filled in.
 *
 * Two bits go. $8000 is IEQUALIFIER_RELATIVEMOUSE, which a GUI window never
 * asks for. $0004 is IEQUALIFIER_CAPSLOCK.
 *
 * DEFECT: `Gui Key Shift` can never report Caps Lock. The guide's own bit
 * table lists *"2     Caps Lock"* between the shifts and Ctrl, and the mask
 * clears exactly that bit before any keyword can read it. The seven other
 * rows work. Bits 8 to 14 survive too and the table does not mention them, so
 * a value above 255 -- $4000 for a held left button -- is a legal answer.
 */
export const KEY_SHIFT_MASK = 0x7ffb

/**
 * Where `Gui Gad Adr`'s answers come from.
 *
 * DEVIATION: the keyword returns a `struct Gadget *`, read out of the window
 * record's pointer array at `$46(a0,gadget*4)`. gadtools laid those out on
 * the machine and this port lays out none, so the number is minted here
 * instead: distinct per window and gadget index, stable for as long as the
 * state lives, and nothing can be read back through it. `Gui Gad Tag` needs
 * no such thing, because its answer points into the bank and a bank has a
 * real address here.
 *
 * `0x7c00_0000` because the addresses above it are taken --- `0x7d00_0000` is
 * `../amiga/gadtools.ts`'s own gadgets, `0x7e00_0000` BOOPSI's objects,
 * `0x7f10_0000` exec's library bases --- and eight apart for the reason
 * gadtools spaces its by eight: a Gadget is longword aligned and consecutive
 * addresses would read as suspiciously dense.
 */
const GUI_GADGET_ORIGIN = 0x7c00_0000
const GUI_GADGET_STRIDE = 8

/**
 * The same again for `Gui Notify`, whose id is the NotifyRequest's address.
 *
 * $8c apart because that is the node's size, `move.l #$8c,d0` at $3a4c, and a
 * program that printed two ids would see the same spacing the machine's
 * AllocVec would have given it.
 */
const GUI_NOTIFY_ORIGIN = 0x7c40_0000
const GUI_NOTIFY_STRIDE = 0x8c

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

/**
 * What `Gui Os` answers, `$18a` of the extension's state.
 *
 * Nothing else in this port declares a Kickstart version. 40 is 3.1, which is
 * the release `../amiga/exec.ts` already dates `lowlevel.library` to, and it
 * is above the 39 `Gui Screen Open` tests for at $4f88 -- so this port takes
 * the modern branch of every version test the extension makes.
 */
export const GUI_OS_VERSION = 40

/**
 * PAL_MONITOR_ID, which `Gui Screen Open` adds to a bare display key.
 *
 * $4fa4 is `addi.l #$21000,d3` on any ModeID below $10000, so passing $8000
 * -- graphics.library's HIRES_KEY -- opens a PAL hires screen rather than
 * failing. On a machine below OS 39 the same test refuses anything $21000 or
 * above instead, at $4f90.
 */
export const PAL_MONITOR_ID = 0x0002_1000

/**
 * The band `Gui Exist` answers in, one above the $100000 `Gui Screen Base`
 * uses. Two keywords hand out stand-in pointers and a program is entitled to
 * find them different, so the bands are what keep `Gui Exist(1)` from
 * equalling `Gui Screen Base(1)`.
 */
export const GUI_WINDOW_BASE = 0x0020_0000

/** one screen `Gui Screen Open` made */
export interface GuiScreen {
  number: number
  width: number
  height: number
  /** worked out from the colours asked for; see `depthForColours` */
  depth: number
  modeID: number
  name: string
  fontName: string
  fontSize: number
  left: number
  top: number
  /** `Gui Show Title`, and screens open with one */
  showTitle: boolean
  /** `Gui Pub Mode`: false is PRIVATE, which is what a screen opens as */
  isPublic: boolean
  /**
   * The ColorMap at `ViewPort+$4`, one entry per pen, as 24-bit $RRGGBB.
   *
   * Twenty-four bits because `$18a` says 40 and every colour keyword in this
   * extension branches on `cmpi.w #$27` -- 39 -- taking the SetRGB32 side
   * here. `Gui Colour` builds exactly this number out of three GetRGB32
   * fractions at $30be, so it is the shape the keywords already speak in.
   */
  palette: number[]
  /**
   * The screen's own BitMap, at `Screen+$2c` and reached through its RastPort
   * at `$54`.
   *
   * `Gui Screen Copy`, `Gui Display Iff` and `Gui Clone` all work on it:
   * $41d2 is `lea $54(a1),a1` for the destination and $4216 takes `$4` of
   * that for the source's BitMap. A screen with no pixels could not answer
   * any of the three.
   */
  rp: RastPort
  /**
   * `Gui Clone screen,True` has this screen showing AMOS's own BitMap.
   *
   * One flag rather than a swapped bitmap: the machine points the ViewPort at
   * AMOS's planes with ChangeVPBitMap and gives them back on False, and what
   * a program can see of that here is which picture the screen is showing.
   */
  cloned: boolean
}

/** a screen's RastPort, sized and coloured the way `Gui Screen Open` asked */
export function newScreenPort(width: number, height: number, depth: number): RastPort {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  return new RastPort(new BitMap(w, h, Math.max(1, Math.min(8, depth)), rowBytesFor(w)))
}

/**
 * A 12-bit $0RGB colour as 24-bit $RRGGBB, by replicating each nibble.
 *
 * What the hardware does with a 4-bit colour register on AGA, and what makes
 * $0fff read back as $ffffff rather than $0f0f0f.
 */
export function expand12(v: number): number {
  const n = (i: number): number => ((v >> (i * 4)) & 0xf) * 0x11
  return (n(2) << 16) | (n(1) << 8) | n(0)
}

/**
 * The colours a screen opens with: intuition's four, then black.
 *
 * DEVIATION: OpenScreen copies color0 to color3 out of Preferences and leaves
 * everything above them as GetColorMap left it, which is zeroed. Nothing here
 * reads the user's Preferences, so the four are `../amiga/intuition.ts`'s
 * WB_PALETTE -- the same four that file already opens its Workbench with.
 */
export function defaultPalette(depth: number): number[] {
  const pens = 1 << Math.max(1, Math.min(8, depth))
  return Array.from({ length: pens }, (_, i) => expand12(WB_PALETTE[i] ?? 0))
}

/**
 * The Workbench as a `GuiScreen`, which is what a `Gui Pub Screen` lock on it
 * makes current.
 *
 * Number 0 so it can never collide with one `Gui Screen Open` made -- $217e
 * refuses that number outright -- and hires 640x256x2, the same figures
 * `../amiga/intuition.ts` opens its Workbench with. One per `GuiState`, so
 * that `Gui Rgb` on a locked Workbench still reads back through `Gui Colour`.
 */
export function workbenchScreen(): GuiScreen {
  return {
    number: 0,
    width: WB_WIDTH,
    height: WB_HEIGHT,
    depth: WB_DEPTH,
    modeID: PAL_MONITOR_ID | 0x8000,
    name: 'Workbench',
    fontName: '',
    fontSize: 0,
    left: 0,
    top: 0,
    showTitle: true,
    isPublic: true,
    palette: defaultPalette(WB_DEPTH),
    rp: newScreenPort(WB_WIDTH, WB_HEIGHT, WB_DEPTH),
    cloned: false,
  }
}

/**
 * How many bitplanes a colour count asks for, $4faa:
 *
 *     tst.l d2 / bgt .n / moveq #$4,d2
 *     .n: ror.l #$1,d2 / addq.l #$1,d4 / btst.b #$0,d2 / beq .n
 *
 * It rotates right until bit 0 comes up set, counting the rotations. For a
 * power of two that is the log, which is what a caller means. For anything
 * else it is the position of the LOWEST set bit above bit 0, so 12 colours
 * quietly become 2 planes and 4 colours. Zero or less is taken as 4.
 */
export function depthForColours(colours: number): number {
  let v = (colours > 0 ? colours : 4) >>> 0
  let n = 0
  do {
    v = ((v >>> 1) | (v << 31)) >>> 0
    n++
  } while ((v & 1) === 0 && n < 32)
  return n
}

/**
 * icon.library's WBTOOL, the type `Gui App Icon` falls back to.
 *
 * `moveq #$3,d0 / jsr -$78(a6)` at $7712 is GetDefDiskObject, and it only
 * runs when GetDiskObject on the path the program gave came back null. So a
 * path that names nothing is not an error, it is the guide's "If you don't
 * specify the icon path, the system default TOOL icon will be used."
 */
export const WBTOOL = 3

/**
 * One AppIcon, the node routine 260 AllocVecs at $768c.
 *
 * Twenty-six bytes plus the name: `$0` and `$4` are the list links, `$8` the
 * id as a WORD, `$a` the window record it iconified, `$e` that record's
 * second half, `$12` the AppIcon workbench.library handed back, `$16` the
 * DiskObject and `$1a` the name text. The list itself hangs off `$1ac` and
 * `$1b0` of the extension's state, head and tail.
 */
/**
 * One live `Gui Notify`, which is a StartNotify that has not been ended.
 *
 * `path` is what the program named, kept because the filesystem reports
 * changes by path and the match is made here rather than by a handler.
 */
/**
 * One entry of the socket chain at `$2dc`, as routine 227 AllocVecs it.
 *
 * `$4` is the bsdsocket descriptor every keyword names it by, `$24` the user
 * data `Tcp Open`'s third argument set and `Tcp Set` changes, and `$28` to
 * `$38` the file, the buffer and the counts `Tcp Download` fills in.
 */
export interface GuiSocket {
  /** `$4`, the number `Tcp Open` and `Tcp Listen` hand back */
  readonly fd: number
  /** `$24`, "a free value for the user" */
  user: number
  /** `$28`: the file `Tcp Download` is writing to, or empty */
  download: string
}

export interface GuiNotify {
  /** what `Gui Code` answers on the event -14 this raises */
  readonly id: number
  /** the file or directory being watched, as the program spelled it */
  readonly path: string
  /** what `AmigaFS.watch` handed back, called by `Gui Rem Notify` */
  readonly stop: () => void
}

export interface GuiApp {
  /**
   * What `Gui Iconify` answers and `Gui Uniconify` takes back.
   *
   * DEVIATION: the machine returns the node's ADDRESS, which is what the
   * guide's "Iconify ID" is. Nothing here has an address, and a program can
   * only hand the number straight back, so this counts from 1.
   */
  handle: number
  /** `$8`, and a WORD: `move.w d0,$8(a4)` truncates whatever it was given */
  id: number
  /** `$1a`: the text that appears under the icon */
  name: string
  /** the path GetDiskObject was given, which the guide says omits the .info */
  icon: string
  /**
   * `$a` and `$e`: the window this iconified, or null for a plain
   * `Gui App Icon`.
   *
   * Nulled by `Gui Uniconify` at $23ec before it re-opens, which is the test
   * at the top of the same keyword: a second uniconify of one handle finds
   * zero here. On the machine the node is freed by then too, so the guide's
   * "a nice guru will visit you" is the honest description.
   */
  window: { number: number; gui: number; topaz: boolean } | null
}

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
 * The same scale as 1.61 computes it, which is a ROTATE and not a divide.
 *
 * Routines 39 and 40 at $147a and $148e end `ror.l #$3,d0 / ext.l d0` where
 * 2.10's end `divu.w #$8,d0`. A rotate is not a shift: the three bits that
 * fall off the bottom arrive at the top, and `ext.l` then keeps only the low
 * WORD sign-extended, so what survives is bits 3 to 18 of `v * cell + 4`.
 *
 * For every coordinate a GUI can hold that is the same number as the divide
 *, the product stays under 2^19 for a 640-pixel window and a 16-pixel cell
 *, and the two part on a NEGATIVE v, where `divu.w` is unsigned and
 * overflows and the rotate does not. Neither release has a reachable negative
 * here, so this is a difference in how, not in what.
 */
export function guiScaleRor(v: number, cell: number): number {
  const n = (v * cell + 4) >>> 0
  const r = ((n >>> 3) | (n << 29)) >>> 0
  return ((r & 0xffff) << 16) >> 16
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
   * `Gui Help` is on for this window: bit 1 of the same word `reportMouse` is
   * bit 0 of, at `$3e` of the Header Info block.
   *
   * Two independent bits rather than a count. `Gui Mouse Report` adds and
   * takes away 1 at $2e00 and $2dd6, testing bit 0 first so it cannot go
   * twice; `Gui Help` adds and takes away 2 at $391c and $3902, testing
   * against 1 for the same reason. The pump reads the whole word: 1 reports
   * the move and does no help, 2 does the help and swallows the move, 3 does
   * both.
   */
  helpOn: boolean
  /** `$42` of that block: the string array `Gui Help` was given */
  helpArray: number
  /** `$46`: which gadget the help text is written into */
  helpGadget: number
  /** `$40`: the gadget the pointer was last over, so a move inside one is free */
  helpLast: number
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
  /**
   * Which GUI screen it opened on, or 0 for the Workbench.
   *
   * A window opens on `$1d2`, the current screen, which `Gui Screen Open` and
   * `Gui Pub Screen` both set. `Gui Pub Check` counts what is on a screen by
   * walking `Screen.FirstWindow`, and this is what stands in for that chain.
   */
  screen: number
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
/**
 * How many channels 1.61's `Tcp` group has, `moveq #$31,d2 / dbra` at $ac2 and
 * again at $1b14, fifty, at `$1d2` of the state, one longword each.
 *
 * DEFECT: nothing bounds-checks the number. `lsl.l #$2,d0 / move.l
 * (a0,d0.w),d0` in every one of the eight routines that index it, so channel
 * 50 reads the four bytes after the table and channel -1 reads the four before
 * it. The table is followed by the window and font words, which is a long way
 * from harmless. This port refuses a channel outside the table instead, since
 * it has no state at those addresses to hand back.
 */
export const TCP_CHANNELS = 50

/**
 * `move.l #$1312d00,$2ba(a3)` at $ade, twenty million microseconds, which
 * is the twenty seconds `Tcp Get` waits before it answers -2.
 *
 * `Tcp Limit` overwrites it and nothing puts it back short of a reboot of the
 * extension, which is where this value is set.
 */
export const TCP_LIMIT_DEFAULT = 0x1312d00

/**
 * One open AmigaDOS file, which is all a 1.61 "TCP" channel is.
 *
 * `Tcp Open` prepends `TCP:` to the name and `Tcp F Open` does not, and both
 * then call the same routine 116: MODE_OLDFILE ($3ec) through dos Open. So the
 * group is DOS I/O over a handler, and on a machine with AmiTCP mounted that
 * handler is the network.
 *
 * Held whole rather than streamed because ../amiga/vfs.ts is a whole-file
 * store; `pos` is fh_Pos and `dirty` says whether the close has to write back.
 */
export interface GuiChannel {
  path: string
  data: Uint8Array
  pos: number
  dirty: boolean
}

/**
 * One DosPacket reply waiting on the extension's own MsgPort.
 *
 * Routine 117 AllocMems $4c bytes and lays a StandardPacket in it, the
 * Message first, `lea $14(a0),a1` for the DosPacket, `move.l a1,$a(a0)` so the
 * reply can be found from the message, and writes two longwords of its own
 * PAST the DosPacket's thirty bytes, at `$30` and `$34`: a serial number and
 * the channel. `Tcp Packet` and `Tcp Channel` are those two.
 */
export interface GuiPacket {
  /** `$30` of the packet, `$2aa` counted up */
  id: number
  /** dp_Type, $52 for a `Tcp Read` and $57 for a `Tcp Send` */
  type: number
  /** dp_Res1, which the pump also copies into `Gui Code` */
  res1: number
  /** dp_Res2 */
  res2: number
  /** `$34`, the channel the request named */
  channel: number
  /** dp_Arg2, the buffer address */
  buffer: number
}

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
  /**
   * The IntuiMessage's Qualifier, for `Gui Key Shift`.
   *
   * Absent on an event that is not an IntuiMessage. The timer signal at $6ba4
   * and the AppMessage at $7202 both reach the reporting code without going
   * past the `$e4` write, so neither disturbs what the last real message
   * left there.
   */
  qualifier?: number
  /**
   * Which window, for `Gui Window`.
   *
   * Absent on an event that names none. The pump writes `$de` only where it
   * has a window to write -- the AppIcon path at $7202 does not, and so `Gui
   * Window` after an event -16 still answers whichever window spoke last.
   */
  window?: number
}

/**
 * The extension's whole state.
 *
 * One of these per Runtime. Nothing here draws: a window's pixels are
 * `../amiga/intuition.ts`'s and its gadgets `../amiga/gadtools.ts`'s, and
 * this is the AMOS side that names them by number.
 */
export class GuiState {
  /**
   * Which of the three releases the program bound, since one body of code
   * serves all of them.
   *
   * Set once from `rt.extBindings` when the Runtime is built, because the
   * answer cannot change while a program runs: a slot holds one library. Read
   * wherever the releases genuinely differ, the bank layout, `Gui Wait`'s
   * codes, the arity of eight keywords, and nowhere else, which is the
   * point of keeping it a field rather than a fork in the port.
   */
  release: GuiRelease = '2.10'
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
  /** `$de`: which window the last event that named one came from */
  private eventWin = 0
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
   * Where 1.5b's and 1.61's `Gui Iconify` park a window's box while it is
   * rolled up to its title bar, keyed by DESIGN.
   *
   * Not by window, because the machine does not key it by window: routine 51
   * does `adda.w $2a(a0),a0` and writes the four words into the Header Info
   * block of the GUI itself, at the offsets the 1.5 converter's comments call
   * "Window Left Edge / Top / Width / Height". It is the bank's own field and
   * it survives the window closing.
   *
   * 2.10's `Gui Iconify` is a different keyword under the same name, it
   * closes the window and puts up an AppIcon, and does not use this.
   */
  readonly iconBoxes = new Map<number, [number, number, number, number]>()
  /**
   * `Gui Set Mode`, one word at `$60`: whether a window gets an iconify
   * gadget. "this command doesn't modify the windows already opened, but only
   * those opened later!"
   */
  iconifyGadget = 0
  /**
   * `$1ac` and `$1b0`: every AppIcon this program has put up, oldest first.
   *
   * Keyed by handle rather than by id because two AppIcons may share an id
   * and `Gui Iconify` hands back the node, not the number. `Gui App Remove`
   * walks this in order and stops at the first id that matches, which is what
   * the `move.l (a1),d1 / beq / bra` loop at $3caa does.
   */
  readonly apps = new Map<number, GuiApp>()
  /** the next handle; see `GuiApp.handle` for why it is not an address */
  private handles = 0
  /**
   * `$90`: which AppIcon the last event -16 named, for `Gui App Id`.
   *
   * Two steps at $71e6 and $720a, because AddAppIconA is given the NODE as
   * its id and `'AMOS'` as its userdata. The pump first copies am_ID into
   * `$90`, then -- only for am_Type 8, AMTYPE_APPICON -- dereferences it and
   * replaces it with `$8` of the node, `ext.l`'d. So this is the word the
   * program passed, SIGN-EXTENDED: `Gui App Icon -1` reports -1, and
   * `Gui App Icon 65537` reports 1.
   */
  appId = 0
  /**
   * `$94` and `$98`: the file names `Gui App Name$` still has to hand out.
   *
   * DEVIATION: the machine holds an AppMessage's am_ArgList, pairs of lock
   * and name, and builds each path on demand with NameFromLock (-$192) into
   * the $400-byte buffer at `$2b8` and AddPart (-$372) on top. There are no
   * locks here, so these arrive already joined.
   */
  readonly appNames: string[] = []
  /**
   * `$158` and `$15c`: fr_File and fr_Drawer, copied out of the ASL file
   * requester at $75e2 and read back by `Gui File$` and `Gui Dir$`.
   *
   * Both are cleared at $75b8 BEFORE AslRequest runs, so a cancel leaves them
   * empty -- "If CANCEL was selected on the requester, it will return an
   * empty string" -- and a second cancel wipes what the first request found.
   */
  aslFile = ''
  aslDir = ''
  /** the dialog channel a `Gui Req` is blocked on, or null */
  req: number | null = null
  /**
   * `$150`: the ScreenModeRequester, always allocated and zeroed.
   *
   * AllocAslRequest at init hands back a cleared struct and asl fills it on
   * the first request, so these are its four fields before anyone has picked
   * anything -- sm_DisplayID at `$0`, sm_DisplayWidth at `$4`,
   * sm_DisplayHeight at `$8` and sm_DisplayDepth at `$c`. Present rather than
   * null because the five readers dereference `$150` without testing it.
   */
  readonly aslScreen = { displayID: 0, width: 0, height: 0, depth: 0 }
  /** `$160`: the size `Gui Asl Font` last picked, and what `Gui Font Size` reads */
  aslFontSize = 0
  /** the font name that went with it, "including the .font extension" */
  aslFontName = ''
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
  /**
   * `Gui Screen Open`'s screens, by the number a program gave them.
   *
   * DEVIATION: they raise no pixels, for the same reason the windows do not.
   * What is here is the geometry, the mode and the names, which is what every
   * other keyword in the group reads back.
   */
  readonly screens = new Map<number, GuiScreen>()
  /**
   * `$1d2`, the CURRENT screen: whichever was opened or locked last.
   *
   * One longword serves both halves. `Gui Screen Open` writes it at the end
   * of routine 232 and `Gui Pub Screen` writes it at $2b0a, so `Gui Screen
   * Width` answers about a locked public screen just as readily as about one
   * this program opened.
   */
  current: GuiScreen | null = null
  /** the Workbench, made once so that colours written to it stay written */
  readonly workbench: GuiScreen = workbenchScreen()
  /**
   * `$1ca`, the last screen this program OPENED, which `Gui Pub Free` puts
   * back into `$1d2` at $2b2a.
   *
   * So freeing a public screen lock does not leave the extension with no
   * current screen; it leaves it with the one before the lock.
   */
  beforeLock: GuiScreen | null = null
  /**
   * `$e4`: the Qualifier of the last IntuiMessage, which `Gui Key Shift`
   * answers with.
   *
   * The pump writes it for EVERY message it takes, not only key ones:
   * `move.w $1a(a1),$e4(a3)` at $6cf2 sits in the common IntuiMessage block,
   * ahead of the class dispatch at $6d2a. So a click updates it too, and the
   * guide's *"When Gui Wait report a Keyboard event"* describes when it is
   * useful rather than when it is written.
   */
  keyShift = 0
  /**
   * `$2a4` and `$2a6`: where `Gui Line 3d` divides towards.
   *
   * Two words, and `Gui Eye 3d` is the only writer. They start at 0,0, which
   * puts the vanishing point in the window's top-left corner.
   */
  eyeX = 0
  eyeY = 0
  /**
   * The frame the outstanding `Gui Timer` request comes due on, or null for
   * none.
   *
   * On the machine this is bit 5 of `$85` plus a timer.device IORequest that
   * SendIO left running. `Gui Timer` refuses to start a second one while the
   * bit is set -- the guide's *"Before sending a new timer request, you've to
   * wait the end of the previous one otherwise it'll be ignored!"* -- and the
   * pump clears it at $6ba4 on the way to reporting event -13.
   */
  timerAt: number | null = null
  /**
   * The DOS notifications `Gui Notify` has running, by the id it handed back.
   *
   * On the machine each is a NotifyRequest AllocVec'd at $3a4c, $8c bytes
   * with the watched name copied to `$30`, chained through `$84`/`$88` off
   * the head and tail at `$1a4`/`$1a8`. The id a program holds IS the node's
   * address, which is what routine 262 compares against to unlink it. Here it
   * is a number from the same origin `Gui Gad Adr` mints from, and the
   * unsubscribe the filesystem handed back is kept beside it.
   */
  readonly notifies = new Map<number, GuiNotify>()
  /**
   * `Gui Remap`'s converted planes, one per image of the bank it last ran on.
   *
   * On the machine these are one AllocVec at `$bc` and routine 223 frees them
   * before the next remap, which is why there is only ever one bank's worth.
   */
  readonly rtgPlanes: Array<{ width: number; height: number; planes: Uint8Array }> = []
  /**
   * The catalog `Gui Catalog Open` attached to the current bank, and every
   * catalog still open by the id it handed back.
   *
   * On the machine the pointer goes into `$34` of EVERY design in the bank --
   * $3bce walks the chain writing it -- and the window builder reads it back
   * off the head design at $5a36. One field here, because the port re-reads
   * the bank rather than writing to it.
   */
  catalog: Catalog | null = null
  readonly catalogs = new Map<number, Catalog>()
  /** `Gui Gad Adr`'s handles, minted once per window and gadget index */
  private readonly gadgetAddrs = new Map<string, number>()
  private nextGadgetAddr = GUI_GADGET_ORIGIN
  private nextNotifyId = GUI_NOTIFY_ORIGIN
  /**
   * `$2a8` to `$2b4`: what the last `Xfa Check` read out of an anim's header.
   *
   * Six fields, and the six reader keywords are one `move` each. `Xfa Check`
   * fills them from XFA_HeadPtr's block at $3f34 -- the width word times
   * eight, then the height word, the mode id longword, the depth and pack
   * bytes and the frame count longword -- and nothing else writes them, so a
   * program that never called `Xfa Check` reads zeroes.
   */
  xfa = { width: 0, height: 0, modeId: 0, depth: 0, pack: 0, frames: 0 }
  /**
   * The TCP group's state: the socket list at `$2dc` and the four words the
   * readers answer from.
   *
   * `sockets` is the chain routine 226 walks comparing `$4` of each node, and
   * it is empty for as long as bsdsocket.library will not open -- which here
   * is always. See ./gui.ts's `Tcp Open` for why the whole group is written
   * against a stack that is not there.
   */
  readonly sockets = new Map<number, GuiSocket>()
  /** `$2e4`, the socket the last event named, which `Tcp Socket` reads */
  tcpSocket = 0
  /** `$2e8` and `$2c0`: the download totals `Tcp Total` and `Tcp Recvd` read */
  tcpTotal = 0
  tcpRecvd = 0
  /** the last line `Tcp Read$` left in the scratch, which `Tcp Response` parses */
  tcpLine = ''
  /**
   * 1.61's TCP group, which shares nothing with 2.10's but the prefix.
   *
   * Fifty DOS channels at `$1d2`, a MsgPort at `$29a` that the pump drains,
   * and the readers' six fields, which are filled in from ONE reply at a time
   * and stand until the next.
   */
  readonly channels = new Map<number, GuiChannel>()
  /** the message list of the port at `$29a`, oldest first */
  readonly packets: GuiPacket[] = []
  /** `$2aa`, counted up per packet and never reset short of a reboot */
  packetSerial = 0
  /** `$2b6`, what `Tcp Count` reads: sent and not yet collected */
  packetsOut = 0
  /** `$2ba`, `Tcp Limit`'s microseconds */
  charLimit = TCP_LIMIT_DEFAULT
  /** the six fields the pump writes at $31f8, which the six readers answer */
  reply: GuiPacket = { id: 0, type: 0, res1: 0, res2: 0, channel: 0, buffer: 0 }
  /** `$2b2` and `$2b4`, the DateStamp minute and second `Tcp Reset` parks */
  stampMinute = 0
  stampSecond = 0
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

  /**
   * `Gui Exist(window)`: 0, or a stand-in for the `struct Window` address.
   *
   * Routine 21 at $1f0e answers `$e(a0)` of the window record it found, and
   * `$e` is where routine 251 reads the Intuition window from before taking
   * `$8`/`$a` off it as Width and Height -- wd_Width and wd_Height in
   * includes/intuition/intuition.i, so the field is wd_NextWindow's struct
   * and the answer is a pointer. Zero when routine 244 finds nothing.
   *
   * DEVIATION: nothing here has a `struct Window` at an address. The number
   * has to be non-zero, stable, and DIFFERENT per window, because those are
   * the three properties a program can observe without dereferencing it, and
   * `Gui Screen Base` already answers its own band the same way.
   */
  exists(n: number): number {
    return this.windows.has(n) ? GUI_WINDOW_BASE + n : 0
  }

  /**
   * `Gui Open window,gui[,bank[,x,y,w,h]]`.
   *
   * "If the window you specify is already open, it will be selected and pop
   * to front... no error will occur", so a repeat open is a select. The
   * geometry falls back to "the position and size as specified in the
   * GadToolsBox editor", which is what the bank's own header carries.
   *
   * Routine 239 opens with `moveq #$8,d7` -- error 8 is "Window already
   * open" -- and then never uses it: at $5508 the window it found goes
   * straight to `Rbsr routine 15`, which is `Gui To Front`, and then to
   * routine 251 with d1 clear, which is the `Gui Gfx 0` retarget. d7 is
   * cleared at $5518 and the routine returns success. So the front is
   * literal, not a manner of speaking, and the prepared error is dead.
   */
  open(n: number, guiIndex: number, box?: { left: number; top: number; width: number; height: number }): GuiWindow | null {
    const existing = this.windows.get(n)
    if (existing !== undefined) {
      this.selected = n
      existing.depth = ++this.depthTop
      return existing
    }
    const raw = this.designs[guiIndex]
    if (raw === undefined) return null
    const design = this.localise(raw)
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
      helpOn: false,
      helpArray: 0,
      helpGadget: 0,
      helpLast: 0,
      rmb: true,
      topaz: !this.sensitive,
      depth: ++this.depthTop,
      screen: this.current?.number ?? 0,
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
    // $5586: with no current screen, opening a window locks the default
    // public one -- LockPubScreen (-$d2) with a null name -- and stores it in
    // both `$1ca` and `$1d2`. So the first `Gui Open` is what gives every
    // screen keyword something to answer about.
    this.current ??= this.workbench
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
    if (others.length === 0) return this.release === '1.5b' ? GUI_CLOSE.LAST_BETA : GUI_CLOSE.LAST
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
    this.eventWin = 0
  }

  /** queue something for `Gui Wait` to find */
  post(e: GuiEvent): void {
    // $6cf2 and $6cf8: the pump copies the message's Qualifier into `$e4` and
    // masks it as it takes the message, which is before the program ever asks
    if (e.qualifier !== undefined) this.keyShift = e.qualifier & KEY_SHIFT_MASK
    this.pending.push(e)
  }

  /**
   * `A=Gui Gad Adr(window,gadget)`'s answer for one gadget: a handle, minted
   * on first ask and the same one every time after. See GUI_GADGET_ORIGIN.
   */
  /**
   * A design with its labels run through the catalog, or the design itself
   * when there is none.
   *
   * The library does this while it BUILDS the window, at $5a2c, and writes
   * the translation into the NewGadget it is filling in rather than back into
   * the bank -- so the bank is untouched and every open translates again.
   * That is why this clones.
   *
   * The numbering is a running counter loaded from the Header Info block's
   * `$3a` at $5600 and bumped once per label the chain reader hands out, so
   * it is exactly GuiConv's `_LOCALE` order: each gadget's name, then its
   * payload, then the menus, then the window title and the screen title. The
   * `Chr$(1)` that closes a list is consumed by the reader's padding scan at
   * $5a68 and never gets a number of its own.
   */
  private localise(g: Gui): Gui {
    const cat = this.catalog
    if (cat === null) return g
    let n = g.catalogBase
    const tr = (s: string): string => getCatalogStr(cat, n++, s)
    const gadgets = g.gadgets.map((gad) => {
      const name = tr(gad.name)
      const items = gad.payload === 'list' ? gad.items.map(tr) : gad.items
      const text = gad.payload === 'text' ? tr(gad.text) : gad.text
      return { ...gad, name, items, text }
    })
    const menus = g.menus.map((m) => {
      const out = { ...m, label: typeof m.label === 'string' ? tr(m.label) : m.label }
      if (out.commKey !== undefined) out.commKey = tr(out.commKey)
      return out
    })
    return { ...g, gadgets, menus, title: tr(g.title), screenName: tr(g.screenName) }
  }

  /** the next `Gui Notify` id, which is where the node would have been */
  notifyHandle(): number {
    const made = this.nextNotifyId
    this.nextNotifyId += GUI_NOTIFY_STRIDE
    return made
  }

  gadgetAddress(win: number, index: number): number {
    const key = `${win}:${index}`
    const had = this.gadgetAddrs.get(key)
    if (had !== undefined) return had
    const made = this.nextGadgetAddr
    this.nextGadgetAddr += GUI_GADGET_STRIDE
    this.gadgetAddrs.set(key, made)
    return made
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
      if (e === undefined) return this.nextPacket()
      if (e.window !== undefined && this.windows.get(e.window)?.locked === true) continue
      this.last = e
      if (e.window !== undefined) {
        this.eventWin = e.window
        this.selected = e.window
      }
      if (e.mouseX !== undefined) this.eventX = e.mouseX
      if (e.mouseY !== undefined) this.eventY = e.mouseY
      return e.code
    }
  }

  /**
   * 1.61's -9, once intuition has nothing left to say.
   *
   * The pump tests the port signals in order, intuition's at $31a2, its own
   * at $31b6, ARexx's at $31d6, so a reply is only looked at when no window
   * event is pending, which is this call's position. GetMsg, read the six
   * fields out of the DosPacket through `$a(a0)`, FreeMem it, and answer -9
   * with dp_Res1 also copied into `$96`: `move.l $29e(a3),$96(a3)` at $3224,
   * which is the word `Gui Code` reads.
   */
  private nextPacket(): number {
    const p = this.packets.shift()
    if (p === undefined) {
      this.last = null
      return GUI_EVENT.NOTHING
    }
    this.reply = p
    this.packetsOut = Math.max(0, this.packetsOut - 1)
    this.last = { code: GUI_EVENT.TCP, result: p.res1, text: '' }
    return GUI_EVENT.TCP
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

  /**
   * `Gui Code$`, the string half of the same, and it clears itself too.
   *
   * Routine 3 tests bit 1 of `$84` and `bclr`s it before it converts `$e0`,
   * exactly as `Gui Code` does with bit 0. So the guide's "its value is
   * automatically reset" is true of both, and a second `Gui Code$` before the
   * next event answers the null string.
   */
  readCodeText(): string {
    const v = this.last?.text ?? ''
    if (this.last !== null) this.last.text = ''
    return v
  }

  /** `Gui Window`: which window produced the last event, `$de` */
  eventWindow(): number {
    return this.eventWin
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

  /**
   * Put an AppIcon up: routine 260's node, linked at the tail.
   *
   * The id is truncated to a word on the way in, because `move.w d0,$8(a4)`
   * at $76ea is where it lands.
   */
  addApp(id: number, name: string, icon: string, window: GuiApp['window']): GuiApp {
    const app: GuiApp = { handle: ++this.handles, id: id & 0xffff, name, icon, window }
    this.apps.set(app.handle, app)
    return app
  }

  /**
   * `Gui App Remove id`, routine 166 at $3c9e.
   *
   * A word compare, so 65537 removes AppIcon 1. Nothing happens when no id
   * matches: the walk runs off the end and the keyword returns, and the guide
   * gives this keyword no node of its own to say otherwise.
   */
  removeAppById(id: number): void {
    for (const app of this.apps.values()) {
      if (app.id === (id & 0xffff)) {
        this.apps.delete(app.handle)
        return
      }
    }
  }

  /**
   * `Gui App Name$`, one name per call and the empty string when the queue is
   * dry.
   *
   * `tst.l $98(a2) / beq` at $3adc answers `$662(a5)`, AMOS's own null
   * string, without touching the queue. So calling it more times than
   * `Gui Code` said is safe, which is worth knowing because the guide's two
   * examples disagree about which event to count from.
   */
  nextAppName(): string {
    return this.appNames.shift() ?? ''
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
