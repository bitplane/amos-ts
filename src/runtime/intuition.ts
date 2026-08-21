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
import { WB_DISPLAY_Y } from '../amiga/intuition'

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

export class IextState {
  /** every screen by its own number; `FindIscr` is a walk of this list */
  readonly screens = new Map<number, IextScreen>()
  /** `CurIscreen`, which every current-form keyword reads */
  current = -1
  /** `ScrOpenBehind`, set by `Iscreen Open Back` until `Iscreen Open Front` */
  openBehind = false
  /** `NextPublic`, set for ONE open by `Iscreen Open Public` */
  nextPublic = false
  /** `CurIwindow`, cleared by `Set Iscreen`; windows.s owns it otherwise */
  currentWindow = -1
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
    st.screens.set(num, { number: num, slot, address, width, height, depth, mode, title, displayID })
    st.current = num
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
  }
}

/** the `(n)` form or the bare one, which every reader in `screens.s` pairs */
function pick(st: IextState, a: readonly Value[]): IextScreen {
  return a.length > 0 ? findIscr(st, int(a[0]!)) : curIscr(st)
}
