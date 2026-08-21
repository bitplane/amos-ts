/**
 * The Intuition Extension 1.3b, by Andrew Church.
 *
 * 183 keywords at slot 14, and the only row in the registry whose evidence is
 * the AUTHOR'S OWN SOURCE: 26 assembler files under
 * `fixtures/extensions/intuition-1.3b/src`, with his comments, his symbols
 * and his `todo` beside them. Every routine `itokens.s` names is defined in
 * them, and the table read out of `Intuition.lib` agrees with the one they
 * assemble to on all 183 names.
 *
 * ## What is readable and what is not
 *
 * The KEYWORD routines are all assembler and all shipped. What several of
 * them call is not: `jtcall OpenIscr` and its neighbours are entries in
 * `jumptable.i` implemented in a compiled C blob that `extcode.s` pulls in
 * with `incbin "obj/extcode"`. So the argument order, the defaults each
 * variant fills in, and the error paths are read from the source; the bodies
 * are read from the binary, and where neither settles a question the guide is
 * quoted as a clue and marked as one.
 *
 * ## The slot is 14, and the extension disagrees with itself about it
 *
 * `defs.i`:39 is `ExtNum equ 14`, `macros.i` reaches the zone with
 * `ExtAdr+(ExtNum-1)*16(a5)`, and the binary bears that out: `=Aga` is
 * `movea.l $1c8(a5),a4`, and `$1c8` is `$f8 + 16*13`. But `errors.s`:68 hands
 * L_ErrorExt `moveq #ExtNum,d2` where AMOS wants d2 zero-based, so every
 * error this extension raises is attributed to extension 15. See the manifest.
 *
 * ## The screen does not appear when it is opened
 *
 * The guide, on `Iscreen Open`: *"Note that the Intuition screen will not be
 * actually displayed until an Amos To Back instruction is executed (or the
 * user presses LeftAmiga+A)."* That is AMOS's own screen sitting in front,
 * not anything this extension does, and `Amos To Back` is what moves it.
 */
import { AmosError, VI, int, str, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { MODE_KEY, MONITOR } from '../amiga/displayinfo'
import { CUSTOMSCREEN, IDCMP_CLOSEWINDOW, WB_DISPLAY_Y, WB_SLOT, WBENCHSCREEN, WFLG_BACKDROP, WFLG_BORDERLESS, type Window } from '../amiga/intuition'

/**
 * What `=Aga` and `=Ecs` answer on the machine this port models.
 *
 * Neither is decided here. ./jd.ts settles the machine as an A1200 --- `Jd
 * Chipset` answers 2 for AA, `Jd Cpu` 68020, `Chip Free` 2MB --- and
 * ./guistate.ts declares Kickstart 40. Church's `=Aga` "checks
 * SysBase->lib_Version >= 39", and 40 is over it; AA carries the ECS feature
 * set, so `=Ecs` is true beside it.
 */
const IEXT_IS_AGA = true
const IEXT_IS_ECS = true

/**
 * Andrew Church's error table, `errors.s`'s `Errors:` run, spelled as he
 * spells them --- "Only 16 colours allowed on non-AGA hires screen" and
 * "Valid AMOS screen numbers range from 0 to 7" included.
 *
 * The two "Internal error" entries carry the zeroed code fields the routine
 * writes hex digits into at `.intlp2`; nothing here raises either.
 */
export const IEXT_ERRORS = [
  'Only 16 colours allowed on non-AGA hires screen',
  'Unable to open screen',
  'Need Kickstart 2.0 or higher',
  'Unable to open window',
  "Window 0 can't be closed",
  "Window 0 can't be modified",
  'Window not opened',
  'Window too small',
  'Window too large',
  'Illegal window parameter',
  'Window not closed',
  'Unable to open Workbench',
  'Program interrupted',
  'Illegal function call',
  'Out of memory',
  'Font not available',
  'Screen not opened',
  'Illegal screen parameter',
  'Illegal number of colours',
  'Screen not closed',
  'Icon not defined',
  'Icon bank not defined',
  'Error text not available',
  'Object not defined',
  'Object bank not defined',
  'Backward coordinates',
  'Menu already active',
  'Internal error, code 00000000',
  'Internal error, code 00000000, subcode 00000000',
  'ReqTools.library version 2 or higher required',
  'Only 65535 gadgets allowed',
  'Gadget already active',
  'Wrong gadget type',
  'Gadget not defined',
  'Gadget not reserved',
  'Valid AMOS screen numbers range from 0 to 7',
  'Bank not defined',
  'Bank format not understood',
  'Inconsistent data',
] as const

/** `errordefs.i`'s own names for them */
export const E = {
  C16: 0,
  UOS: 1,
  KS2: 2,
  UOW: 3,
  CW0: 4,
  MW0: 5,
  WNO: 6,
  WTS: 7,
  WTL: 8,
  IWP: 9,
  WNC: 10,
  NWB: 11,
  PI: 12,
  IFC: 13,
  OOM: 14,
  FNA: 15,
  SNO: 16,
  ISP: 17,
  INC: 18,
  SNC: 19,
  IND: 20,
  NIB: 21,
  NES: 22,
  OND: 23,
  NOB: 24,
  BWC: 25,
  MAA: 26,
  INT: 27,
  IN2: 28,
  NRT: 29,
  TMG: 30,
  GAA: 31,
  WGT: 32,
  GND: 33,
  GNR: 34,
  ASN: 35,
  BND: 36,
  FNU: 37,
  IDT: 38,
} as const

function iError(n: number): never {
  throw new AmosError(IEXT_ERRORS[n] ?? `Intuition error ${n}`)
}

/** `defs.i`:168 --- `MODES equ HIRES | HAM | EHB | SUPERHIRES | LACED` */
export const IEXT_MODES = MODE_KEY.HIRES | MODE_KEY.HAM | MODE_KEY.EXTRAHALFBRITE | MODE_KEY.SUPERHIRES | MODE_KEY.LACE

/**
 * One screen the extension opened, which is Church's `se_` block hanging off
 * `sc_UserData`.
 *
 * `se_Width` and `se_Height` are read back by `=Iscreen Width` and `=Iscreen
 * Height` rather than the screen's own `sc_Width`, so they are what the OPEN
 * was given and not what Intuition made of it.
 */
export interface IextScreen {
  /** `se_ScrNum`, and the guide says it "can be any integer" */
  number: number
  /** the AMOS screen slot ../amiga/intuition.ts opened for it */
  slot: number
  /** the `struct Screen *`, which `Iscreen Base` and `=Iscreen` hand out */
  address: number
  width: number
  height: number
  depth: number
  /** `se_FirstIwindow`: this screen's own windows, by number */
  readonly windows: Map<number, IextWindow>
  /** `se_LastActive`, restored when the screen becomes current again */
  lastActive: number
  /** `sc_ViewModes`, masked with MODES on the way out */
  mode: number
  title: string
  /**
   * The seventh argument, or this machine's own monitor when it was left out.
   *
   * Recorded and not otherwise used: what `OpenIscr` does with it beyond
   * choosing the monitor is in the compiled blob, and the mode BITS come from
   * the fifth argument -- which is what `=Iscreen Mode` reads back, masked
   * with MODES so no monitor bit could survive there anyway.
   */
  displayID: number
}

/**
 * `defs.i`:94-97 --- the `we_Flags` bits. `=Iwindow Status` masks its answer
 * with CLOSED and MENUACTIVE and calls those "Legal flags to return", so the
 * other two are the extension's own business.
 */
export const WEF = { UNSET: 1, CLOSED: 2, BASEWIN: 4, MENUACTIVE: 8 } as const

/**
 * `defs.i`:85 --- `WE_MAGIC equ $BEADF00D`, written into `we_MagicID` of
 * every window this extension opens.
 *
 * `=Iwindow Active` is the only reader: it takes whatever window Intuition
 * says is active, follows `wd_UserData`, and answers -1 only if the magic is
 * there. So the question it asks is "is the active window one of MINE", and a
 * foreign one answers 0 rather than raising.
 */
export const WE_MAGIC = 0xbead_f00d

/** one window the extension opened, which is Church's `we_` block */
export interface IextWindow {
  /** `we_WinNum`, and 0 is the screen's own base window */
  number: number
  /** the screen it belongs to, or null for a Workbench one */
  screen: number | null
  window: Window
  /** `we_Flags`, of which `=Iwindow Status` hands back two bits */
  flags: number
  title: string
}

export class IextState {
  /** every screen by its own number; `FindIscr` is a walk of this list */
  readonly screens = new Map<number, IextScreen>()
  /** `CurIscreen`, which every current-form keyword reads */
  current = -1
  /** `ScrOpenBehind`, set by `Iscreen Open Back` until `Iscreen Open Front` */
  openBehind = false
  /** `NextPublic`, set for ONE open by `Iscreen Open Public` */
  nextPublic = false
  /**
   * `CurIwindow` and `CurIwindowIsWB`, the pair every window keyword reads.
   *
   * -1 is `dclr.l CurIwindow`: no window current at all, which `=Iwindow`
   * answers 0 for and which `Set Iscreen` and `Set Iwindow 0` both leave.
   */
  currentWindow = -1
  currentIsWB = false
  /**
   * The windows of each screen, and the Workbench's own list beside them.
   *
   * Two lists because the extension has two: `FindIwin` walks
   * `se_FirstIwindow` of the CURRENT screen and `FindWBIwin` walks a separate
   * one, which is why the guide can say "different screens may have same-
   * numbered windows".
   */
  readonly wbWindows = new Map<number, IextWindow>()
  /** `LastActiveWB`, saved whenever a Workbench window stops being current */
  lastActiveWB = -1
  /** `TrapErrors` / `ErrorTrapped` / `LastError`, which `other.s` reads back */
  trapErrors = false
  errorTrapped = false
  lastError = -1
}

export function newIextState(): IextState {
  return new IextState()
}

/** `jtcall FindIscr` then `beq L_NoScr`: a number with no screen is error 16 */
function findIscr(st: IextState, n: number): IextScreen {
  return st.screens.get(n) ?? iError(E.SNO)
}

/** `jtcall GetCurIscr`, which every bare-form keyword opens with */
function curIscr(st: IextState): IextScreen {
  return st.screens.get(st.current) ?? iError(E.SNO)
}

/**
 * The depth a colour count and a mode ask for.
 *
 * The guide's own table is the source: Lowres HAM is 4096 colours and Lowres
 * HAM8 is 262144, "be sure to specify the correct number of colours (the one
 * listed)". So HAM and EHB are named by the MODE and the count only says
 * which of the two HAM depths is meant --- 4096 is six planes and 262144 is
 * eight. Everything else is the plain power of two.
 */
function depthFor(colours: number, mode: number): number {
  if ((mode & MODE_KEY.HAM) !== 0) return colours >= 262144 ? 8 : 6
  if ((mode & MODE_KEY.EXTRAHALFBRITE) !== 0) return 6
  if (colours < 2) iError(E.INC)
  const d = Math.ceil(Math.log2(colours))
  if (d < 1 || d > 8 || 1 << d !== colours) iError(E.INC)
  return d
}

/* --------------------------------------------------------------------------
 * The window helpers `windows.s` reaches through the jump table
 * ----------------------------------------------------------------------- */

/** the current screen, or error 16 --- `dtst.l CurIscreen / beq L_NoScr` */
function curScreen(st: IextState): IextScreen {
  return st.screens.get(st.current) ?? iError(E.SNO)
}

/** `FindIwin`: this screen's list, `beq L_NoWin` --- error 6 */
function findIwin(st: IextState, n: number): IextWindow {
  return curScreen(st).windows.get(n) ?? iError(E.WNO)
}

/** `FindWBIwin`: the Workbench list, which no screen owns */
function findWbIwin(st: IextState, n: number): IextWindow {
  return st.wbWindows.get(n) ?? iError(E.WNO)
}

/** `se_BaseWin` --- window 0, the backdrop opened with the screen */
function baseWin(st: IextState): IextWindow {
  return curScreen(st).windows.get(0) ?? iError(E.WNO)
}

/** `GetCurIwin2`, which falls back to the base window when none is current */
function curIwin(st: IextState): IextWindow {
  const n = st.currentWindow
  if (n === -1) return baseWin(st)
  return st.currentIsWB ? findWbIwin(st, n) : findIwin(st, n)
}

/**
 * The `n` form or the current one, refusing 0 by NUMBER first.
 *
 * `move.l (a3)+,d0 / beq L_NoModWin0` --- To Front, Move and Size all open
 * with it, so window 0 is error 5 before any list is walked.
 */
function modTarget(st: IextState, it: Parameters<Instr>[0]): IextWindow {
  if (it.atStmtEnd()) return curIwin(st)
  const n = it.evalInt()
  if (n === 0) iError(E.MW0)
  return findIwin(st, n)
}

/** an address for a `struct Window *`, which nothing in this port has */
const IEXT_WINDOW_ORIGIN = 0x7ca0_0000
function windowAddr(st: IextState, w: IextWindow): number {
  void st
  return IEXT_WINDOW_ORIGIN + (w.screen === null ? 0x8000 : w.screen * 0x100) + w.number * 4
}

/**
 * `=Iwindow X(n)` and its three siblings, sharing one shape.
 *
 * `beq .scrwin` takes window 0 out of the list walk entirely: it needs a
 * screen and then answers 0 for x and y. Width and height of window 0 go the
 * same way, so the screen's own origin and nothing else is what it reports.
 */
function edgeOf(st: IextState, a: readonly Value[], which: 'x' | 'y' | 'w' | 'h'): number {
  const n = a.length > 0 ? int(a[0]!) : null
  if (n === 0) {
    curScreen(st)
    return 0
  }
  const w = (n === null ? curIwin(st) : findIwin(st, n)).window
  return which === 'x' ? w.leftEdge : which === 'y' ? w.topEdge : which === 'w' ? w.width : w.height
}

/**
 * `GetActiveWin` and the magic check.
 *
 * Null when Intuition has no active window, or when the active one is not
 * this extension's --- `cmp.l #WE_MAGIC,we_MagicID(a0) / bne .no`, and
 * `WE_MAGIC` is `$BEADF00D`.
 */
function activeIwin(rt: Runtime, st: IextState): IextWindow | null {
  const active = rt.intuition.windows.find((w) => w.active)
  if (!active) return null
  for (const scr of st.screens.values()) for (const w of scr.windows.values()) if (w.window === active) return w
  for (const w of st.wbWindows.values()) if (w.window === active) return w
  return null
}

/**
 * `jtcall DoEvent` before the flags are read --- "If close gadget clicked,
 * catch it".
 *
 * Asking a window for its status is what NOTICES its close gadget, which is
 * how a program written the guide's way ends: `Repeat : Until Iwindow Status
 * and 2`. IDCMP_CLOSEWINDOW is $200.
 */
function pumpStatus(w: IextWindow): number {
  for (;;) {
    const msg = w.window.getMsg()
    if (!msg) break
    if (msg.class === 0x200) w.flags |= WEF.CLOSED
  }
  return w.flags
}

/** `OpenIwin`, which is compiled C; the guide and `defs.i` state its limits */
function openIwindow(rt: Runtime, it: Parameters<Instr>[0], onWb: boolean): void {
  const st = rt.iext
  const num = it.evalInt()
  it.expect(',')
  const x = it.evalInt()
  it.expect(',')
  const y = it.evalInt()
  it.expect(',')
  const width = it.evalInt()
  it.expect(',')
  const height = it.evalInt()
  const title = it.accept(',') ? str(it.evalExpr()) : ''
  // `move.l #Null,d1` when the flags are left out, and `defs.i`:40 says what
  // Null is: "what AMOS passes if a parameter is omitted". WFLAGS goes in
  // their place -- SIZEGADGET|DRAGBAR|DEPTHGADGET|CLOSEGADGET|ACTIVATE, plus
  // RMBTRAP, which this port has nothing to trap
  const flags = it.accept(',') ? it.evalInt() : IEXT_WFLAGS
  const list = onWb ? st.wbWindows : curScreen(st).windows
  // the guide: "If window n already exists, the 'Window not closed' error is
  // generated"
  if (list.has(num)) iError(E.WNC)
  // "the width and height of the window must be at least 80 x 48 pixels, and
  // cannot be larger than the currently visible size of the screen"
  if (width < 80 || height < 48) iError(E.WTS)
  const slot = onWb ? WB_SLOT : curScreen(st).slot
  const scr = rt.screens.get(slot)
  if (scr && (x < 0 || y < 0 || x + width > scr.width || y + height > scr.height)) iError(E.WTL)
  const window = rt.intuition.openWindow({
    leftEdge: x,
    topEdge: y,
    width,
    height,
    detailPen: 0,
    blockPen: 1,
    idcmpFlags: IDCMP_CLOSEWINDOW,
    flags,
    title,
    type: onWb ? WBENCHSCREEN : CUSTOMSCREEN,
    ...(onWb ? {} : { screenSlot: slot }),
  })
  if (!window) iError(E.UOW)
  list.set(num, { number: num, screen: onWb ? null : st.current, window, flags: 0, title })
  st.currentWindow = num
  st.currentIsWB = onWb
}

/** `L_WinMove`, whose two `cmp.l #Null` are the omitted-argument test */
function moveIwindow(rt: Runtime, st: IextState, it: Parameters<Instr>[0], onWb: boolean): void {
  const n = it.evalInt()
  if (!onWb && n === 0) iError(E.MW0)
  const target = onWb ? findWbIwin(st, n) : findIwin(st, n)
  it.expect(',')
  const x = omittable(it)
  it.expect(',')
  const y = omittable(it)
  const w = target.window
  const nx = x ?? w.leftEdge
  const ny = y ?? w.topEdge
  const scr = rt.screens.get(w.screenSlot)
  if (scr) {
    // `bhi` is UNSIGNED, so a negative coordinate is a very large one and
    // fails the same comparison
    if ((nx >>> 0) > scr.width - w.width || (ny >>> 0) > scr.height - w.height) iError(E.IFC)
  }
  rt.intuition.moveWindow(w, nx - w.leftEdge, ny - w.topEdge)
}

/** `L_WinSize`, and the 80x48 floor is `cmp.l #80,d2 / bcs L_WinTooSmall` */
function sizeIwindow(rt: Runtime, st: IextState, it: Parameters<Instr>[0], onWb: boolean): void {
  const n = it.evalInt()
  if (!onWb && n === 0) iError(E.MW0)
  const target = onWb ? findWbIwin(st, n) : findIwin(st, n)
  it.expect(',')
  const x = omittable(it)
  it.expect(',')
  const y = omittable(it)
  const w = target.window
  const nw = x ?? w.width
  const nh = y ?? w.height
  const scr = rt.screens.get(w.screenSlot)
  if (scr && ((nw >>> 0) > scr.width - w.leftEdge || (nh >>> 0) > scr.height - w.topEdge)) iError(E.WTL)
  if ((nw >>> 0) < 80 || (nh >>> 0) < 48) iError(E.WTS)
  rt.intuition.sizeWindow(w, nw - w.width, nh - w.height)
}

/** an argument that may be left out, which AMOS compiles to EntNul */
function omittable(it: Parameters<Instr>[0]): number | null {
  return it.atStmtEnd() || it.nm() === ',' ? null : it.evalInt()
}

/** `defs.i`:171-173 --- what `OpenIwin` uses when the flags are Null */
const IEXT_WFLAGS = 0x1 | 0x2 | 0x4 | 0x8 | 0x1000

export function makeIextInstructions(rt: Runtime): Record<string, Instr> {
  const s = (): IextState => rt.iext

  /**
   * `Iscreen Open n,w,h,colours,mode[,title$[,displayID]]`.
   *
   * FOUR variants share one body. The token table spells them as `-2`
   * continuations of one entry, and `screens.s` chains them: the five-argument
   * form is `L_IscreenOpen0`, `clr.l -(a3) / bra L_IscreenOpenNM`, which
   * pushes an empty title and falls into the six-argument one; that one picks
   * the display id itself --- `dtst.b IsNTSC / bne .ntsc` and then
   * `move.l #PAL_MONITOR_ID,-(a3)` or `#NTSC_MONITOR_ID` --- and falls into
   * the seven-argument `L_IscreenOpen`, which is `jtcall OpenIscr` and
   * nothing else.
   *
   * So an omitted displayID is not zero: it is this machine's own monitor,
   * and this machine is PAL. `dtst.b WB20 / beq L_NeedKick20` guards the
   * variants that take one, error 2.
   *
   * Reopening a number that is already open is error 19, "Screen not closed",
   * which the guide states outright. The guide also settles the title: *"If
   * title$ is empty or not given, the title bar will not appear."*
   */
  const openIscreen = (it: Parameters<Instr>[0], asPublic: boolean): void => {
    const st = s()
    const num = it.evalInt()
    it.expect(',')
    const width = it.evalInt()
    it.expect(',')
    const height = it.evalInt()
    it.expect(',')
    const colours = it.evalInt()
    it.expect(',')
    const mode = it.evalInt()
    const title = it.accept(',') ? str(it.evalExpr()) : ''
    // `PAL_MONITOR_ID` when the id is left out, which is what the six-argument
    // variant pushes for a machine that is not NTSC
    const displayID = it.accept(',') ? it.evalInt() : MONITOR.PAL
    if (st.screens.has(num)) iError(E.SNC)
    const depth = depthFor(colours, mode)
    // `E_16C` --- "Only 16 colours allowed on non-AGA hires screen". This
    // machine IS AGA (see `=Aga`), so the arm is reproduced and never taken.
    if (!IEXT_IS_AGA && (mode & MODE_KEY.HIRES) !== 0 && depth > 4) iError(E.C16)
    const address = rt.intuition.openScreen({
      width,
      height,
      depth,
      hires: (mode & MODE_KEY.HIRES) !== 0,
      laced: (mode & MODE_KEY.LACE) !== 0,
      palette: [],
      displayY: WB_DISPLAY_Y,
      title,
    })
    if (address === 0) iError(E.UOS)
    const slot = rt.intuition.slotOf(address)
    if (slot === null) iError(E.UOS)
    const scr: IextScreen = {
      number: num,
      slot,
      address,
      width,
      height,
      depth,
      mode,
      title,
      displayID,
      windows: new Map(),
      lastActive: -1,
    }
    st.screens.set(num, scr)
    st.current = num
    // `se_BaseWin`: every screen gets a backdrop window, which is what
    // `Iwindow Activate 0` activates and what gives the screen a RastPort to
    // draw into. It is window 0, it carries WEF_BASEWIN, and `Iwindow Close`
    // and the three modifiers all refuse it by number before they look.
    const base = rt.intuition.openWindow({
      leftEdge: 0,
      topEdge: 0,
      width,
      height,
      detailPen: 0,
      blockPen: 1,
      idcmpFlags: 0,
      flags: WFLG_BORDERLESS | WFLG_BACKDROP,
      title: '',
      type: CUSTOMSCREEN,
      screenSlot: slot,
    })
    if (base) scr.windows.set(0, { number: 0, screen: num, window: base, flags: WEF.BASEWIN, title: '' })
    st.currentWindow = -1
    st.currentIsWB = false
    // `tmove.b #-1,NextPublic` is set for ONE open and this is where it is
    // spent. Nothing in this port distinguishes a public screen from a
    // private one -- there is no second program to visit it -- so the flag is
    // recorded and cleared. See the coverage note.
    void asPublic
    st.nextPublic = false
    // `ScrOpenBehind` decides front or back, and it STAYS set until
    // `Iscreen Open Front` clears it: `L_IscrOpenBack` is `tmove.b #-1` with
    // no matching clear of its own
    if (st.openBehind) rt.intuition.screenToBack(address)
    else rt.intuition.screenToFront(address)
  }

  return {
    'iscreen open': (it) => openIscreen(it, false),
    'iscreen open public': (it) => openIscreen(it, true),

    /** `L_IscrOpenBack` --- `tmove.b #-1,ScrOpenBehind`, and it stays set */
    'iscreen open back': () => {
      s().openBehind = true
    },
    /** `L_IscrOpenFront` --- `dclr.b ScrOpenBehind` */
    'iscreen open front': () => {
      s().openBehind = false
    },

    /**
     * `Iscreen Close n` --- `FindIscr / beq L_NoScr` then `jtcall CloseIscr`.
     *
     * Closing the current screen leaves `CurIscreen` naming one that is gone,
     * which every later current-form keyword then answers error 16 for. That
     * is the routine's own shape: nothing in `L_IscreenClose` touches it.
     */
    'iscreen close': (it) => {
      const st = s()
      const scr = findIscr(st, it.evalInt())
      rt.intuition.closeScreen(scr.address)
      st.screens.delete(scr.number)
    },

    /**
     * `Set Iscreen n` --- and it remembers which window was current on the
     * screen it is LEAVING.
     *
     * `L_IscreenSet` writes `CurIwindow` into `se_LastActive` of the outgoing
     * screen (or into `LastActiveWB` when the current window is a Workbench
     * one), sets `CurIscreen`, and then `dclr.l CurIwindow` --- so selecting a
     * screen leaves no window current at all until something selects one.
     */
    'set iscreen': (it) => {
      const st = s()
      const scr = findIscr(st, it.evalInt())
      st.current = scr.number
      st.currentWindow = -1
    },

    /** `Iscreen To Front n` / `Iscreen To Front` --- ScreenToFront */
    'iscreen to front': (it) => {
      const st = s()
      const scr = it.atStmtEnd() ? curIscr(st) : findIscr(st, it.evalInt())
      rt.intuition.screenToFront(scr.address)
    },
    'iscreen to back': (it) => {
      const st = s()
      const scr = it.atStmtEnd() ? curIscr(st) : findIscr(st, it.evalInt())
      rt.intuition.screenToBack(scr.address)
    },
 
    /* ------------------------------------------------------------------
     * Windows
     *
     * Almost every one comes in three spellings: `n`, `Wb n`, and bare for
     * the current one. `windows.s` writes them as three routines sharing a
     * body -- `L_IwindowToFront` and `L_IwindowToFrontWB` both `bsr
     * L_WinToFront` -- and the only difference is which list the number is
     * looked up in. `FindIwin` walks the CURRENT screen's `se_FirstIwindow`
     * and `FindWBIwin` a separate Workbench one, which is what lets the
     * guide say "different screens may have same-numbered windows".
     *
     * WINDOW 0 IS THE SCREEN. It is `se_BaseWin`, a backdrop opened with the
     * screen, and the three modifiers refuse it BY NUMBER before they look
     * anything up: `Iwindow Close 0` is `beq L_NoCloseWin0` (error 4) and
     * To Front, Move and Size are `beq L_NoModWin0` (error 5).
     * ------------------------------------------------------------------ */

    /**
     * `Iwindow Open n,x,y,w,h[,title$[,flags]]`, and `Iwindow Open Wb` beside
     * it.
     *
     * Six routines, three per list, chained the way the screen ones are: the
     * five-argument form is `clr.l -(a3) / bra` into the six, which loads
     * `move.l #Null,d1` for the flags. `Null` is `$80000000` and `defs.i`
     * says what it is for -- "what AMOS passes if a parameter is omitted" --
     * so omitted flags are not zero flags, and `OpenIwin` puts `WFLAGS` in
     * their place: SIZEGADGET, DRAGBAR, DEPTHGADGET, CLOSEGADGET, ACTIVATE
     * and RMBTRAP (`defs.i`:171-173).
     *
     * `moveq #1,d0` for the screen form and `moveq #0,d0` for the Wb one is
     * the whole difference between them.
     *
     * The guide states the limits: "the width and height of the window must
     * be at least 80 x 48 pixels, and cannot be larger than the currently
     * visible size of the screen", and a number already open is "Window not
     * closed".
     */
    'iwindow open': (it) => openIwindow(rt, it, false),
    'iwindow open wb': (it) => openIwindow(rt, it, true),

    /**
     * `Iwindow Close n` --- and window 0 is refused before the list is
     * touched: `move.l (a3)+,d0 / beq L_NoCloseWin0`.
     *
     * The Wb form has no such check. `L_IwindowCloseWB` goes straight to
     * `FindWBIwin`, because a Workbench window 0 is just a window.
     */
    'iwindow close': (it) => {
      const st = s()
      const n = it.evalInt()
      if (n === 0) iError(E.CW0)
      const w = findIwin(st, n)
      rt.intuition.closeWindow(w.window)
      curScreen(st).windows.delete(n)
      if (st.currentWindow === n && !st.currentIsWB) st.currentWindow = -1
    },
    'iwindow close wb': (it) => {
      const st = s()
      const n = it.evalInt()
      const w = findWbIwin(st, n)
      rt.intuition.closeWindow(w.window)
      st.wbWindows.delete(n)
      if (st.currentWindow === n && st.currentIsWB) st.currentWindow = -1
    },

    /**
     * `Set Iwindow n` --- and 0 is not a window, it is "none".
     *
     * `dtst.l CurIscreen / beq L_NoScr` first, so there has to be a screen.
     * Then `move.l (a3)+,d0 / beq .bkwin`, and the `.bkwin` arm is
     * `dclr.l CurIwindow` --- it selects NO window rather than the base one.
     * Either arm saves the outgoing window into `LastActiveWB` when it was a
     * Workbench one.
     */
    'set iwindow': (it) => {
      const st = s()
      if (st.current === -1 || !st.screens.has(st.current)) iError(E.SNO)
      const n = it.evalInt()
      if (st.currentIsWB && st.currentWindow !== -1) st.lastActiveWB = st.currentWindow
      if (n === 0) {
        st.currentWindow = -1
        st.currentIsWB = false
        return
      }
      findIwin(st, n)
      st.currentWindow = n
      st.currentIsWB = false
    },

    /**
     * `Set Iwindow Wb n` --- the same, into the other list, and it saves the
     * outgoing window into the SCREEN's `se_LastActive` rather than into
     * `LastActiveWB`.
     */
    'set iwindow wb': (it) => {
      const st = s()
      const n = it.evalInt()
      findWbIwin(st, n)
      if (!st.currentIsWB) {
        const scr = st.screens.get(st.current)
        if (scr) scr.lastActive = st.currentWindow
      }
      st.currentWindow = n
      st.currentIsWB = true
    },

    /** `Iwindow To Front [n]` / `Iwindow To Front Wb n` --- WindowToFront */
    'iwindow to front': (it) => {
      rt.intuition.windowToFront(modTarget(s(), it).window)
    },
    'iwindow to front wb': (it) => {
      rt.intuition.windowToFront(findWbIwin(s(), it.evalInt()).window)
    },
    'iwindow to back': (it) => {
      rt.intuition.windowToBack(modTarget(s(), it).window)
    },
    'iwindow to back wb': (it) => {
      rt.intuition.windowToBack(findWbIwin(s(), it.evalInt()).window)
    },

    /**
     * `Iwindow Move n,x,y` --- and either coordinate may be left out.
     *
     * `L_WinMove` is `cmp.l #Null,d2 / bne .gotx` twice: an omitted x keeps
     * `wd_LeftEdge` and an omitted y keeps `wd_TopEdge`. Then both are
     * checked against `sc_Width - wd_Width` and `sc_Height - wd_Height` with
     * `bhi`, which is UNSIGNED --- so a negative coordinate is a huge one and
     * fails the same test. Over either is `L_IllFunc`, error 13.
     *
     * MoveWindow takes a DELTA, which is why the routine subtracts the
     * window's own edge before the call.
     */
    'iwindow move': (it) => moveIwindow(rt, s(), it, false),
    'iwindow move wb': (it) => moveIwindow(rt, s(), it, true),

    /**
     * `Iwindow Size n,x,y` --- the same shape with different limits.
     *
     * Omitted keeps `wd_Width` / `wd_Height`. The maximum is
     * `sc_Width - wd_LeftEdge` and `sc_Height - wd_TopEdge`, over which is
     * error 8; and there is a MINIMUM the guide states and the code enforces,
     * `cmp.l #80,d2 / bcs L_WinTooSmall` and `cmp.l #48,d3`, which is error 7.
     */
    'iwindow size': (it) => sizeIwindow(rt, s(), it, false),
    'iwindow size wb': (it) => sizeIwindow(rt, s(), it, true),

    /**
     * `Iwindow Activate n` --- sets the current window AND activates it.
     *
     * `beq .bkwin` sends 0 to the screen's `se_BaseWin`, so activating window
     * 0 activates the backdrop rather than clearing the selection the way
     * `Set Iwindow 0` does. Note what is missing: no `beq L_NoWin` after
     * `FindIwin`, so a number nothing opened reaches `ActivateWindow` with
     * whatever `FindIwin` left in a0.
     */
    'iwindow activate': (it) => {
      const st = s()
      const n = it.evalInt()
      const w = n === 0 ? baseWin(st) : findIwin(st, n)
      st.currentWindow = n
      st.currentIsWB = false
      rt.intuition.activateWindow(w.window)
    },
    'iwindow activate wb': (it) => {
      const st = s()
      const w = findWbIwin(st, it.evalInt())
      st.currentWindow = w.number
      st.currentIsWB = true
      rt.intuition.activateWindow(w.window)
    },
  }
}

export function makeIextFunctions(rt: Runtime): Record<string, Func> {
  const s = (): IextState => rt.iext

  return {
    /**
     * `=Ham`, `=Ehb`, `=Superhires` --- three constants and nothing else.
     *
     * `screens.s` opens with them: `move.l #HAM,d3 / moveq #0,d2 / rts`, and
     * `defs.i`:165-167 is `HAM equ $0800`, `EHB equ $0080`, `SUPERHIRES equ
     * $0020`. They are the bits a program adds into `Iscreen Open`'s mode.
     */
    ham: (): Value => VI(MODE_KEY.HAM),
    ehb: (): Value => VI(MODE_KEY.EXTRAHALFBRITE),
    superhires: (): Value => VI(MODE_KEY.SUPERHIRES),

    /**
     * `=Aga` and `=Ecs` --- two bytes of the extension's own data area.
     *
     * `move.b $20(a4),d3 / ext.w d3 / ext.l d3` and the same at `$21`, which
     * are `IsAGA` and `IsECS` in `data.i`. Neither is COMPUTED in the shipped
     * assembler: they are set by the compiled blob `extcode.s` pulls in, so
     * what is readable is the author's comment on the keyword ---
     * *"test for AGA chipset. Currently checks SysBase->lib_Version >= 39.
     * There must be a better way!"* --- and, for `=Ecs`, *"Only works on
     * systems with KS2.0 or higher; returns False on all others."*
     *
     * This port answers from the machine it has already decided it is, and
     * that decision is not made here: ./jd.ts settles it as an A1200, `Jd
     * Chipset` answering 2 for AA, and ./guistate.ts declares Kickstart 40.
     * Forty is over Church's 39, so `=Aga` is true; AA carries the ECS
     * feature set, so `=Ecs` is true beside it. APPROXIMATED, because the
     * test itself is in the part of the extension that is not source.
     */
    aga: (): Value => VI(IEXT_IS_AGA ? -1 : 0),
    ecs: (): Value => VI(IEXT_IS_ECS ? -1 : 0),

    /**
     * `=X Hard Min` and `=Y Hard Min` --- `v_DxOffset` and `v_DyOffset` of
     * the ViewLord, `movea.l $5e(a4),a0 / move.w $e(a0),d3`.
     *
     * The View's offset from the hardware origin, which on a machine with
     * default Preferences is zero on both axes. This port has no Overscan
     * preference to move it, so both stay there.
     */
    'x hard min': (): Value => VI(0),
    'y hard min': (): Value => VI(0),

    /** `=Iscreen` --- `se_ScrNum` of the current screen */
    iscreen: (): Value => VI(curIscr(s()).number),

    /** `=Iscreen Base` --- `dmove.l CurIscreen,d3`, the `struct Screen *` */
    'iscreen base': (): Value => VI(s().screens.get(s().current)?.address ?? 0),

    /**
     * `=Iscreen Width(n)` / `=Iscreen Width` --- `se_Width`, which is what the
     * OPEN was given rather than what Intuition made of it. `sc_Width` is
     * right there and the routine does not read it.
     */
    'iscreen width': (_, a): Value => VI(pick(s(), a).width),
    'iscreen height': (_, a): Value => VI(pick(s(), a).height),

    /**
     * `=Iscreen Mode(n)` --- `sc_ViewModes` masked with `MODES`, so only the
     * five bits `defs.i` names survive: HIRES, HAM, EHB, SUPERHIRES, LACED.
     */
    'iscreen mode': (_, a): Value => VI(pick(s(), a).mode & IEXT_MODES),

    /**
     * `=Iscreen Colour(n)` --- and HAM is counted, not computed.
     *
     * `L_GetIscrCols` asks `=Iscreen Mode` first and tests `and.w #HAM,d3`.
     * Without HAM it is `1 << sc_Depth`. WITH it the depth picks between two
     * literals: `cmp.b #8,sc_Depth / bne .ham6` gives `move.l #262144,d3` for
     * eight planes and `#4096` for anything else. So HAM8 answers 262144 --
     * the colours it can show -- and not the 2^24 its registers hold.
     */
    'iscreen colour': (_, a): Value => {
      const scr = pick(s(), a)
      if ((scr.mode & MODE_KEY.HAM) === 0) return VI(1 << scr.depth)
      return VI(scr.depth === 8 ? 262144 : 4096)
    },
 
    /**
     * `=Iwindow` --- the current window's number, and 0 for none.
     *
     * `dmove.l CurIwindow,d0 / beq .bkwin`, and `.bkwin` needs a screen
     * (error 16 without one) and then answers 0. So 0 means "the screen
     * itself", which is the same thing `Set Iwindow 0` selects.
     */
    iwindow: (): Value => {
      const st = s()
      if (st.currentWindow !== -1) return VI(st.currentWindow)
      if (st.current === -1 || !st.screens.has(st.current)) iError(E.SNO)
      return VI(0)
    },

    /** `=Iwindow On Wb` --- `CurIwindowIsWB`, sign-extended */
    'iwindow on wb': (): Value => VI(s().currentIsWB ? -1 : 0),

    /**
     * `=Iwindow X(n)` and its three siblings.
     *
     * `move.l (a3)+,d0 / beq .scrwin` --- window 0 does not go to the list at
     * all. The `.scrwin` arm wants a screen and then answers 0, so the
     * screen's own origin is what window 0 reports.
     */
    'iwindow x': (_, a): Value => VI(edgeOf(s(), a, 'x')),
    'iwindow y': (_, a): Value => VI(edgeOf(s(), a, 'y')),
    'iwindow width': (_, a): Value => VI(edgeOf(s(), a, 'w')),
    'iwindow height': (_, a): Value => VI(edgeOf(s(), a, 'h')),
    'iwindow x wb': (_, a): Value => VI(findWbIwin(s(), int(a[0]!)).window.leftEdge),
    'iwindow y wb': (_, a): Value => VI(findWbIwin(s(), int(a[0]!)).window.topEdge),
    'iwindow width wb': (_, a): Value => VI(findWbIwin(s(), int(a[0]!)).window.width),
    'iwindow height wb': (_, a): Value => VI(findWbIwin(s(), int(a[0]!)).window.height),

    /**
     * `=Iwindow Actual Width` and `=Iwindow Actual Height` --- the client
     * area, `wd_Width` less `wd_BorderLeft` and `wd_BorderRight`.
     *
     * Only the current form exists. There is no `(n)` and no `Wb` spelling of
     * either, which is the one place in `windows.s` the three-way pattern
     * does not hold.
     */
    'iwindow actual width': (): Value => {
      const w = curIwin(s()).window
      return VI(w.width - w.borderLeft - w.borderRight)
    },
    'iwindow actual height': (): Value => {
      const w = curIwin(s()).window
      return VI(w.height - w.borderTop - w.borderBottom)
    },

    /** `=Iwindow Base` --- `GetCurIwin2`, the `struct Window *` */
    'iwindow base': (): Value => VI(windowAddr(s(), curIwin(s()))),

    /**
     * `=Iwindow Active` --- is the window Intuition says is active one of
     * OURS?
     *
     * `GetActiveWin`, then `wd_UserData`, then
     * `cmp.l #WE_MAGIC,we_MagicID(a0)`. A foreign window answers 0 rather
     * than raising, and so does no active window at all.
     */
    'iwindow active': (): Value => VI(activeIwin(rt, s()) === null ? 0 : -1),

    /** `=Iwindow Active Num` --- `we_WinNum` of it, with no magic check */
    'iwindow active num': (): Value => VI(activeIwin(rt, s())?.number ?? 0),
    /** `=Iwindow Active Base` --- and this one does not follow UserData */
    'iwindow active base': (): Value => {
      const w = activeIwin(rt, s())
      return VI(w === null ? 0 : windowAddr(s(), w))
    },

    /**
     * `=Iwindow Status(n)` --- two bits, and a pump of the window's port
     * first.
     *
     * `jtcall DoEvent` runs before the flags are read, with the comment "If
     * close gadget clicked, catch it": asking a window for its status is what
     * notices that its close gadget was pressed. Then `and.l
     * #WEF_CLOSED|WEF_MENUACTIVE,d3`, which the source calls "Legal flags to
     * return" --- so WEF_UNSET and WEF_BASEWIN never leave the extension.
     */
    'iwindow status': (_, a): Value => {
      const st = s()
      const w = a.length > 0 ? findIwin(st, int(a[0]!)) : curIwin(st)
      return VI(pumpStatus(w) & (WEF.CLOSED | WEF.MENUACTIVE))
    },
    'iwindow status wb': (_, a): Value => {
      const w = findWbIwin(s(), int(a[0]!))
      return VI(pumpStatus(w) & (WEF.CLOSED | WEF.MENUACTIVE))
    },
  }
}

/** the `(n)` form or the bare one, which every reader in `screens.s` pairs */
function pick(st: IextState, a: readonly Value[]): IextScreen {
  return a.length > 0 ? findIscr(st, int(a[0]!)) : curIscr(st)
}
