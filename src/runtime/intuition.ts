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
 * ## ALL of it is readable, and two directories hold it
 *
 * `src/` is the keyword layer and `src2/` is the external code segment that
 * `extcode.s` pulls in with `incbin "obj/extcode"` --- eleven more assembler
 * files, not the compiled C it looks like from `src/` alone. `OpenIscr` and
 * `OpenIwin` live in `src2/screens.s` and `src2/windows.s`. The makefile is
 * what says so: `EXTOBJ` lists the objects and `EXTSRC` maps them back to
 * `src2/%1.s`.
 *
 * ## Two traps in reading it, both real
 *
 * `output.s` IS NOT BUILT. It defines `L_Itext`, `L_Icentre`, `L_Iwrite` and
 * two more that `text.s` also defines, and the makefile's `INTSRC0` lists
 * `text.s` and `graphics.s` and never `output.s`. It is a superseded copy,
 * and `graphics.s` is its replacement --- with `Ipaste Bob` and `=Ipoint`
 * that `output.s` has never heard of.
 *
 * And the source does not tell you what the binary does. `SAFE_GRPOS` is the
 * cheap case --- `graphics.s` guards four range checks with `ifd
 * SAFE_GRPOS`, `defs.i`:46 has the `equ` commented out, and the binary
 * confirms it: `ilocate gr` goes from `move.l (a3)+,d0` straight to
 * SetCoords with nothing in between. `Iget Icon` is the expensive one. Its
 * four `bgt L_IllFunc` come out of `/extasm` as `bgt.b +4` over a marker
 * carrying the OPPOSITE condition, and the keyword answers error 13 to every
 * call because of it. Source for structure, binary for what runs.
 *
 * `mvoe.l` and `mvoeq` are not evidence of any of that. They are the
 * author's own macros --- `macros.i`:3, *"Because I keep typing \"mvoe\"
 * instead of \"move\" so much... :-)"* --- and the tree uses them nine
 * times.
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
import { AmosError, VI, VS, int, str, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { MODE_KEY, MONITOR } from '../amiga/displayinfo'
import { RastPort, type BitMap } from '../amiga/graphics'
import { MENUNULL, NOITEM, NOMENU, NOSUB, itemNum, menuNum, subNum } from '../amiga/gadtools'
import { openDiskFont, type DiskFont } from '../amiga/diskfont'
import {
  EZREQF,
  FREQF,
  REQ_MODE,
  RT_FILEREQ_PREFS,
  RT_MAXINT,
  RT_MININT,
  RT_TEXT,
  SCREQF,
  type FileReqSetup,
  type FontReqSetup,
  type ReqEntry,
  type ReqSetup,
  type ScreenReqSetup,
} from '../amiga/reqtools'
import { rtScreenResult } from './rtreq'
import type { Screen } from './screen'
import {
  AUTOKNOB,
  FREEHORIZ,
  FREEVERT,
  GACT_GADGIMMEDIATE,
  GACT_LONGINT,
  GACT_RELVERIFY,
  GACT_STRINGCENTER,
  GACT_STRINGRIGHT,
  GACT_TOGGLESELECT,
  GFLG_GADGDISABLED,
  GFLG_GADGHIMAGE,
  GFLG_GADGHNONE,
  GFLG_SELECTED,
  GTYP_BOOLGADGET,
  GTYP_PROPGADGET,
  GTYP_STRGADGET,
  MAXBODY,
  MAXPOT,
  type Border,
  type UserGadget,
} from '../amiga/intuition'
import { CUSTOMSCREEN, TITLE_HEIGHT, IDCMP_CLOSEWINDOW, IDCMP_GADGETDOWN, IDCMP_GADGETUP, IDCMP_MENUPICK, IDCMP_MOUSEBUTTONS, IDCMP_RAWKEY, WB_DISPLAY_Y, WB_SLOT, WBENCHSCREEN, WFLG_BACKDROP, WFLG_BORDERLESS, WFLG_RMBTRAP, type Window } from '../amiga/intuition'

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

/**
 * Thrown instead of an AmosError while `Itrap On` is in force.
 *
 * `errors.s`'s `.trap` arm does not raise: it sets `ErrorTrapped`, restores
 * the stack to `A7StackEnd-4` -- Church's own comment is "Quit from offending
 * routine" -- and returns as though the keyword had finished. So the program
 * carries on and asks `=Ierrtrap` afterwards. `wrapTrapped` below is where
 * that unwinding happens here.
 */
class IextTrapped extends Error {}

/** the state, which `iError` needs before the Runtime hands it out */
let iextState: IextState | null = null

/**
 * Raise one of Church's errors, or trap it.
 *
 * `L_CustomError` records the number and its message in `LastError` and
 * `LastErrorStr` whichever way it goes -- `tmove.l d0,LastError` happens
 * before the trap is even tested -- so `=Ierr` and `=Ierr$` answer for a
 * trapped error as readily as for a fatal one.
 */
function iError(n: number): never {
  const st = iextState
  if (st) {
    st.lastError = n
    st.lastErrorStr = IEXT_ERRORS[n] ?? ''
    if (st.trapErrors) {
      st.errorTrapped = true
      throw new IextTrapped()
    }
  }
  throw new AmosError(IEXT_ERRORS[n] ?? `Intuition error ${n}`)
}

/**
 * Wrap every handler so a trapped error abandons it and nothing more.
 *
 * This is the `.trap` arm's stack unwind. It is done here rather than at each
 * keyword because that is what the arm does: one place, every routine.
 */
function wrapTrapped<T extends Record<string, (...a: never[]) => unknown>>(map: T): T {
  const out: Record<string, unknown> = {}
  for (const [name, fn] of Object.entries(map)) {
    out[name] = (...a: never[]): unknown => {
      try {
        return fn(...a)
      } catch (e) {
        if (e instanceof IextTrapped) return VI(0)
        throw e
      }
    }
  }
  return out as T
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
  /**
   * `sc_Width` and `sc_Height` --- the DISPLAYED size, which is not the
   * bitmap's and not `se_Width`/`se_Height` either. They open equal to what
   * the program asked for and `Iscreen Display` is the only writer, so the
   * short form of `Iscreen Copy` --- which reads them at $23c0 for the size
   * of its blit --- copies less of a screen whose display has been narrowed.
   */
  scWidth: number
  scHeight: number
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
/**
 * `input.s`'s three readers, mid-line.
 *
 * `d2` is the character count in `L_ReadStr` and the accumulated VALUE in
 * `L_ReadInt`, `d3` the radix -- 0, 16 or 32, which is the byte offset into
 * the limit table and not the base -- and `d4` the sign, 0 or 8 for the same
 * reason.
 */
export interface IextRead {
  kind: 'char' | 'str' | 'int'
  /** `L_ReadChar`'s one character, or `L_ReadStr`'s buffer */
  text: string
  /** `L_ReadInt`'s d2, unsigned: the positive limit is the UNSIGNED maximum */
  value: number
  /** d3 --- 0 decimal, 16 binary, 32 hex */
  radix: number
  /** d4 --- `.cancel` still applies it, so "-" then a cursor key is -0 */
  negative: boolean
  done: boolean
}

export const WE_MAGIC = 0xbead_f00d

/**
 * `struct MenuItem` with Church's three words on the end of it.
 *
 * `defs.i`:28-31 extends Intuition's 34-byte MenuItem to 42: `mi_ItemNum`,
 * `mi_IsSubitem` and `mi_Parent`. The number is the program's own, which is
 * why `=Ichoice` can answer in the numbering `Set Imenu` was given rather
 * than in the position Intuition picks by.
 */
export interface IextMenuItem {
  /** `mi_ItemNum`, at 34 */
  number: number
  /** `mi_IsSubitem`, at 36 */
  isSub: boolean
  /** the IntuiText's own string, held through `mi_ItemFill` -> `it_IText` */
  text: string
  leftEdge: number
  topEdge: number
  width: number
  height: number
  /** `it_FrontPen` and `it_BackPen`, which are the RastPort's the other way up */
  frontPen: number
  backPen: number
  subItems: IextMenuItem[]
}

/** `struct Menu` plus `mu_MenuNum` at 30, which `defs.i`:26 puts there */
export interface IextMenu {
  number: number
  /** `mu_MenuName`, the title on the bar */
  name: string
  leftEdge: number
  width: number
  /** `move.w #10,mu_Height(a2)`, and nothing measures it */
  height: number
  items: IextMenuItem[]
}

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
  /**
   * `wd_RPort`, made on demand.
   *
   * `GetCurRP` is what every drawing keyword opens with, and the pens, the
   * draw mode and the graphics cursor are its state --- which is why `Iink`
   * is a mode and `Idraw To` has somewhere to draw FROM.
   */
  rp?: RastPort
  /**
   * `we_FirstMenu`, sorted ascending by number.
   *
   * `FindImenu` walks it with `cmp.w mu_MenuNum(a0),d2 / beq .exit / bcs
   * .high`, so a number BELOW the one it is standing on ends the walk as a
   * miss. That only works on a sorted list, and `.muprev` keeps it sorted by
   * inserting after the last node with a smaller number.
   */
  menus: IextMenu[]
  /**
   * `we_Gadgets` and `we_NGadgets`: the array `Reserve Igadget n` allocates.
   *
   * One slot a gadget, MEMF_CLEARed, and a slot with `gg_GadgetType` still
   * zero is one `Set Igadget ...` has not filled in --- which is error 27,
   * "Gadget not defined". Reserving again frees the old array outright, so
   * every gadget in it goes.
   */
  gadgets: (IextGadget | null)[]
  /** `we_HilitePen` and `we_ShadowPen`, both 1 until `Set Ipens` moves them */
  hilitePen: number
  shadowPen: number
  /**
   * `SetWindowTitles`' third argument: what the SCREEN's bar reads while
   * this window is active. Kept and not drawn --- ../amiga/intuition.ts
   * gives an Iscreen no title bar to put it in, and `Iscreen Title Height`
   * answers the height of one that is never rendered.
   */
  screenTitle: string
}

/**
 * One entry of `we_Gadgets`: a `struct Gadget`, its extension and its
 * SpecialInfo, laid end to end.
 *
 * `GADGETSIZE equ gg_sizeof+ge_sizeof+si_sizeof` is 44 + 18 + 36 = 98, which
 * is the `lea.l $62(a5),a5` the two all-gadget loops step by.
 */
export interface IextGadget {
  /** the live gadget, which is also what the window's list holds when it is on */
  gad: UserGadget
  /** `ge_NUnits` and `ge_KnobSize`, sliders only */
  units: number
  knobSize: number
  /** `ge_HitCount`, hit-select gadgets only */
  hitCount: number
  /** `ge_Flags` GEF_DISPLAYED: whether `Igadget On` has added it to the window */
  displayed: boolean
  /** `ge_Flags` GEF_GADGETDOWN, which `=Igadget Down` reads */
  down: boolean
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
   * one, which is why the guide can say "different screens may have
   * same-numbered windows".
   */
  readonly wbWindows = new Map<number, IextWindow>()
  /** `LastActiveWB`, saved whenever a Workbench window stops being current */
  lastActiveWB = -1
  /**
   * `LastCode` and `LastQual`, which `=Iscan` and `=Ishift` read back.
   *
   * Set by whatever last took a key out of the buffer, and NOT cleared by
   * `Iclear Key` -- that resets the buffer pointer and leaves these alone.
   */
  lastCode = 0
  lastQual = 0
  /** `EventData`, the second half of whatever `Iwait Event` last answered */
  eventData = 0
  /**
   * `MenuBufPtr`'s buffer, which `Iclear Menu` resets and `DoEvent` fills.
   *
   * A 256-entry ring of one word each (`MenuBufSize equ 256*ue_sizeof`, and
   * `ue_sizeof` is 2), so 255 picks fit: `DoEvent` discards the event AND
   * hides it from its caller when the write would meet the read pointer.
   */
  readonly menuPicks: number[] = []
  /**
   * `LastMenu`, `LastMenuItem` and `LastMenuSub`, which `=Ichoice` reads.
   *
   * -1 is Church's "none since last check". Each is read-and-clear, so three
   * `Ichoice` calls answer for one pick and a fourth answers 0.
   */
  lastMenu = -1
  lastMenuItem = -1
  lastMenuSub = -1
  /**
   * `DefReqTitle` (`data.i`:91), the title every requester takes when the
   * caller passes none.
   *
   * `i_DefReqTitleStr` is "AMOS Request" and `startup.s`:381 installs it with
   * `dmove.l DefReqTitleStr,a0`, which loads the POINTER out of the data
   * cell. Two other places get it wrong. `CloseAll`, the reset routine, is
   * `dlea DefReqTitleStr,a0` at `startup.s`:487, and `Irequest Def Title`
   * with an empty string is the same instruction: `$5f16 lea.l $42(a4),a2`.
   * That is the ADDRESS of the four-byte cell, so the title becomes the
   * pointer read as characters, and the pointer's top byte is zero on any
   * machine with under 16MB. DEFECT: reset and `Irequest Def Title ""` both
   * leave a BLANK title bar where the author meant "AMOS Request".
   */
  defReqTitle = 'AMOS Request'
  /**
   * `RTEZ_Flags` in `EZRequest`'s static tag list, which is never cleared.
   *
   * `$87f2 lea.l $88c0(pc),a0 / $87f6 or.l d0,(a0)`, and `$88c0` is the
   * flags field of the table at `$88b4`. It starts at EZREQF_CENTERTEXT and
   * every caller ORs into it. DEFECT: `Irequest Warning` and `Irequest Error`
   * pass EZREQF_LAMIGAQUAL, so after either of them has run once, every
   * `Irequest Message` for the rest of the session needs the Amiga key held
   * for its Y and N shortcuts, which nothing put it there to ask for.
   */
  ezFlags: number = EZREQF.CENTERTEXT
  /**
   * `Filename108` (`data.i`), the file requester's File gadget.
   *
   * `Irequest File$` writes it before every call, from `def$` or from
   * nothing. `Irequest File Multi$` does NOT: its `.doreq` is `dlea
   * Filename108,a2` with no clear in front, so the multi requester opens with
   * whatever name the last single one was left holding.
   */
  freqFile = ''
  /**
   * `rtfi_Dir` inside the one FileReq the extension allocates at startup.
   *
   * Null until the first requester, which opens on the process's current
   * directory because `dirname[256]` came back cleared from
   * `rtAllocRequestA`. After that it is wherever the user left it, because
   * nothing in `request.s` ever sets RTFI_Dir. See `startFileReq`.
   */
  freqDir: string | null = null
  /**
   * `rtfi_MatchPat`, and an omitted pattern LEAVES THE LAST ONE STANDING:
   * `.nopat` skips the whole `rtChangeReqAttrA` rather than clearing it.
   */
  freqPattern = ''
  /** `FRFileList`, what `Irequest File Next$` has not handed out yet */
  frFileList: ReqEntry[] = []
  /** `FRDir`, the directory the multi list's names hang off */
  frDir = ''
  /**
   * `rtfo_Attr` inside the one FontReq the extension allocates at startup.
   *
   * `moveq #$2,d0 / bsr.w $8a2e / move.l d0,$174(a4)` at `$96d6` is
   * `rtAllocRequestA (RT_FONTREQ, NULL)`, once, for the life of the
   * extension. MEMF_CLEAR is what leaves the name empty and the size zero, so
   * the FIRST font requester opens on no face at all and its sample box says
   * `Couldn't open font!`; every one after that comes up where the last was
   * left.
   */
  fontReqName = ''
  fontReqSize = 0
  /**
   * The ScreenModeReq at `$178(a4)`, allocated once at `$96e8` and cleared.
   *
   * `filereq.c`:264 tests `DisplayID == INVALID_ID` and a cleared struct
   * holds 0, not ~0, so the first `=Irequest Screen` reads its mode, depth,
   * width and height straight off the zeros. What Ok leaves here is what the
   * next call opens on.
   */
  screenReq = { displayId: 0, width: 0, height: 0, depth: 0 }
  /**
   * `ScreenData` at `$17c(a4)`, `defs.i`:145: sd_Width, sd_Height, sd_NumCols
   * at +4, sd_DisplayID at +8 and sd_ViewModes at +$c.
   *
   * A separate cache from the requester struct, and only the `.ok` arm at
   * `$5b8c` writes it --- a cancelled requester leaves the last answer
   * standing, which is what makes the four `Ireq Scr` readers safe to call
   * after one.
   */
  screenData = { width: 0, height: 0, numCols: 0, displayId: 0, viewModes: 0 }
  /**
   * Set by `runHeadless` when it breaks a wait nobody is going to satisfy.
   *
   * Not part of the extension. A headless run has no keyboard and no mouse,
   * so `Iwait Key` would spin until the step budget ran out; this is what
   * lets the waiters give up once rather than never.
   */
  /**
   * The line editor `=Iread Str$` or `=Iread Int` is part way through.
   *
   * Both are one `.lp` loop with `WaitTOF` in it, so the keyword runs for as
   * many frames as the typing takes and everything the loop holds in
   * registers --- the buffer, the accumulator, the radix and the sign ---
   * has to live somewhere between them. One slot is enough: the loop cannot
   * be re-entered, because it does not return until Return is pressed.
   */
  read: IextRead | null = null

  headlessWake = false
  /** `TrapErrors` / `ErrorTrapped` / `LastError`, which `other.s` reads back */
  trapErrors = false
  errorTrapped = false
  lastError = -1
  /** `LastErrorStr`, which `=Ierr$` hands back and then stops trapping */
  lastErrorStr = ''
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
function pumpStatus(st: IextState, w: IextWindow): number {
  doEvent(st, 0)
  return w.flags
}

/**
 * The IDCMP mask every window of this extension opens with, `defs.i`:184-187.
 *
 * `OpenIwin` and `OpenIscr` both end the same way -- `dmove.l
 * MyUserPort,wd_UserPort(a0) / move.l #IDCMPFLAGS,d0 / intcall ModifyIDCMP`.
 */
const IEXT_IDCMP =
  IDCMP_RAWKEY | IDCMP_MOUSEBUTTONS | IDCMP_CLOSEWINDOW | IDCMP_MENUPICK | IDCMP_GADGETDOWN | IDCMP_GADGETUP

/** `IDCMPWAIT`, `defs.i`:189-192 --- IDCMPFLAGS without GADGETDOWN */
const IEXT_IDCMPWAIT = IEXT_IDCMP & ~IDCMP_GADGETDOWN

/**
 * Every window the extension has open, on any screen and on the Workbench.
 *
 * They share ONE message port. `OpenIwin` says so in Church's own comment,
 * *"Make window use common UserPort"*, and `MyUserPort` is opened once at
 * startup (`src2/startup.s`:387). So a keyword that pumps for input pumps
 * every window's events, not the current one's: a close gadget pressed on
 * window 3 is noticed by an `=Iwindow Status(1)`, and a menu pick made
 * anywhere reaches `=Ichoice`.
 */
function allIwins(st: IextState): IextWindow[] {
  const out: IextWindow[] = []
  for (const scr of st.screens.values()) out.push(...scr.windows.values())
  out.push(...st.wbWindows.values())
  return out
}

/**
 * `DoEvent` --- drain the common port, filing each message, and stop at the
 * first one whose class is in `want`.
 *
 * DEVIATION: this port gives each window its own queue, so the walk is in
 * window order where the original's is in arrival order. Nothing a program
 * can arrange makes that observable without two windows delivering in the
 * same frame.
 */
function doEvent(st: IextState, want: number): { cls: number; code: number; iaddress: number } | null {
  for (const w of allIwins(st)) {
    for (;;) {
      const msg = w.window.getMsg()
      if (!msg) break
      const cls = sortEvent(st, w, msg.class, msg.code, msg.iaddress)
      if ((cls & want) !== 0) return { cls, code: msg.code, iaddress: msg.iaddress }
    }
  }
  return null
}

/**
 * How many picks the menu ring holds.
 *
 * `MenuBufSize equ 256*ue_sizeof` with `ue_sizeof` 2, and `DoEvent` refuses
 * the write when it would leave `MenuBufPtr` one entry short of
 * `MenuBufNext` -- `movea.l $cc(a4),a1 / subq.l #$2,a1 / cmpa.l a0,a1 / bne
 * .setmu` -- so one slot of the ring is always empty.
 */
const IEXT_MENU_BUF = 255

/**
 * `DoEvent`'s one-message body: sort it into a buffer, then report its class.
 *
 * Church's own summary is *"Keep repeating until im_Class & D0 or no more
 * messages"*, and each class has an arm that files it somewhere before the
 * loop decides whether to stop. Two of them matter here. CLOSEWINDOW sets
 * `WEF_CLOSED` on the window the message names, which is what `=Iwindow
 * Status` reads back without ever seeing the message itself. MENUPICK writes
 * `im_Code` into the ring, which is where `GetMenu` and so `=Ichoice` find
 * it -- so a pick that `Iwait Event` returns is ALSO buffered, and the two
 * keywords are meant to be used one after the other.
 *
 * Returns the class DoEvent reports, which is 0 when an arm dropped the
 * event: a full menu ring is `moveq #0,d3`, and so is a key code of $60 or
 * above, the *"key up and shifting-key events"* the RAWKEY arm ignores.
 */
function sortEvent(st: IextState, w: IextWindow, cls: number, code: number, iaddress = 0): number {
  if (cls === IDCMP_CLOSEWINDOW) {
    w.flags |= WEF.CLOSED
    return cls
  }
  if (cls === IDCMP_MENUPICK) {
    if (st.menuPicks.length >= IEXT_MENU_BUF) return 0
    st.menuPicks.push(code)
  }
  // the two gadget arms: GADGETDOWN sets GEF_GADGETDOWN and counts a
  // hit-select press, GADGETUP clears it again. `=Igadget Down` and the
  // hit-select arm of `=Igadget Read` are both reading what this leaves
  if (cls === IDCMP_GADGETDOWN || cls === IDCMP_GADGETUP) {
    const g = w.gadgets.find((e) => e?.gad.id === iaddress)
    if (g) {
      g.down = cls === IDCMP_GADGETDOWN
      const toggle = ((g.gad.activation ?? 0) & GACT_TOGGLESELECT) !== 0
      if (cls === IDCMP_GADGETDOWN && g.gad.kind === GTYP_BOOLGADGET && !toggle) {
        g.hitCount = Math.min(0x7fff, g.hitCount + 1)
      }
      // `cmp.l #GADGETUP,d3` and then `clr.w ge_HitCount(a0)` for a
      // BOOLGADGET with TOGGLESELECT: a toggle keeps no count, and DoEvent
      // throws away any that a Set Igadget Hit on the same slot left behind
      if (cls === IDCMP_GADGETUP && g.gad.kind === GTYP_BOOLGADGET && toggle) g.hitCount = 0
    }
  }
  return cls
}

/** `OpenIwin`, which is compiled C; the guide and `defs.i` state its limits */
function openIwindow(rt: Runtime, it: Parameters<Instr>[0], onWb: boolean, legacy = false): void {
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
  // `legacy` is `Iwindow_Open`, whose token entries stop at the six-argument
  // form: there is no seventh for the flags to arrive in, which is the
  // guide's "you will not be able to use any new features of the command"
  const flags = !legacy && it.accept(',') ? it.evalInt() : IEXT_WFLAGS
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
    idcmpFlags: IEXT_IDCMP,
    flags,
    title,
    type: onWb ? WBENCHSCREEN : CUSTOMSCREEN,
    ...(onWb ? {} : { screenSlot: slot }),
  })
  if (!window) iError(E.UOW)
  list.set(num, {
    number: num,
    screen: onWb ? null : st.current,
    window,
    // `src2/windows.s`:373 --- `move.l #WEF_UNSET,we_Flags(a5)`, "Window CP
    // not yet (officially) set". SetCoords clears it and SetCoordsRel
    // refuses to move while it is up; `Iwrite` is what a program sees it
    // through.
    flags: WEF.UNSET,
    title,
    menus: [],
    gadgets: [],
    // `we_HilitePen` and `we_ShadowPen` are byte fields in a MEMF_CLEARed
    // block until `Set Ipens` writes them, so a gadget drawn before that is
    // drawn in pen 0 on both sides and is invisible
    hilitePen: 0,
    shadowPen: 0,
    screenTitle: '',
  })
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

/** `x1,y1 To x2,y2`, the shape the `t` in a spec marks */
function rectTo(it: Parameters<Instr>[0]): [number, number, number, number] {
  const x1 = it.evalInt()
  it.expect(',')
  const y1 = it.evalInt()
  it.expect('to')
  const x2 = it.evalInt()
  it.expect(',')
  const y2 = it.evalInt()
  return [x1, y1, x2, y2]
}

/** an argument that may be left out, which AMOS compiles to EntNul */
function omittable(it: Parameters<Instr>[0]): number | null {
  return it.atStmtEnd() || it.nm() === ',' ? null : it.evalInt()
}

/** the same test for a string slot: `cmp.l #Null,d2` over a string pointer */
function omittableStr(it: Parameters<Instr>[0]): string | null {
  return it.atStmtEnd() || it.nm() === ',' ? null : str(it.evalExpr())
}

/**
 * `dmove.l CurIwindow,d3 / beq L_NoWin` --- the current window, raw.
 *
 * Not the same question `GetCurIwin` asks: that one falls back to the
 * screen's base window, and this reads the variable and answers error 6 when
 * it is zero. `Iscreen Open` leaves it zero and `Set Iscreen` clears it, so
 * `Set Iwindow Title ,,"x"` on a screen nothing has selected a window on is
 * error 6 rather than a title on the backdrop.
 */
function curIwinRaw(st: IextState): IextWindow {
  if (st.currentWindow === -1) iError(E.WNO)
  return st.currentIsWB ? findWbIwin(st, st.currentWindow) : findIwin(st, st.currentWindow)
}

/**
 * `sc_BarHeight` --- what `=Iscreen Title Height` reads off the Screen.
 *
 * Intuition computes it at OpenScreen from the screen's font and its border:
 * AROS `rom/intuition/openscreen.c`:2135 is `dri_Font->tf_YSize +
 * WBorTop - 2 + BarVBorder * 2`, which for topaz 8 with WBorTop 2 and
 * BarVBorder 1 is 10, and the comment beside it --- "real layer will be 1
 * pixel higher!" --- is why ../amiga/intuition.ts's TITLE_HEIGHT is 11. So
 * the two are one number and this keeps them tied.
 *
 * It does not depend on whether a title is showing. ShowTitle moves the bar
 * in and out of the view and never touches the field.
 */
const IEXT_BAR_HEIGHT = TITLE_HEIGHT - 1

/**
 * `ScrollRaster(rp, 0, dy, xMin, yMin, xMax, yMax)` --- the one call
 * `Iwrite` makes, which is the only one in this extension.
 *
 * `graphics_lib.fd` puts it at -396 and orders it `(a1,d0/d1,d2/d3/d4/d5)`.
 * A positive dy moves the raster UP by dy and leaves the bottom dy rows in
 * the background pen, which is what makes the last line of a window scroll
 * rather than write off the bottom.
 */
function scrollRasterUp(rp: RastPort, dy: number, x1: number, y1: number, x2: number, y2: number): void {
  if (dy <= 0) return
  for (let y = y1; y <= y2 - dy; y++) {
    for (let x = x1; x <= x2; x++) rp.putPixel(x, y, rp.point(x, y + dy))
  }
  for (let y = Math.max(y1, y2 - dy + 1); y <= y2; y++) {
    for (let x = x1; x <= x2; x++) rp.putPixel(x, y, rp.bgPen)
  }
}

/**
 * The three readers' shared shape: start the editor, drain what is queued,
 * and give the frame back if it is still open.
 *
 * The routine's own loop is `GetKey / WaitTOF / bra`, one frame per empty
 * poll, and this is that loop turned inside out --- the keyword re-runs each
 * frame instead of spinning inside one. `runHeadless` breaks it the way it
 * breaks `Iwait Key`: nothing is going to type, so the editor closes on
 * whatever it has, which is nothing.
 */
function readKeyword(rt: Runtime, st: IextState, it: Parameters<Func>[0], kind: IextRead['kind']): Value {
  // `jtcall GetCurInput` before anything, which is where a program with no
  // window at all is refused
  curIwin(st)
  st.read ??= { kind, text: '', value: 0, radix: 0, negative: false, done: false }
  const r = st.read
  pumpRead(rt, st, r)
  if (!r.done && st.headlessWake) {
    st.headlessWake = false
    r.done = true
  }
  if (!r.done) {
    it.block({ type: 'ievent' }, true)
    return kind === 'int' ? VI(0) : VS('')
  }
  st.read = null
  if (kind !== 'int') return VS(r.text)
  // `move.l d2,d3 / tst.w d4 / beq .exit / neg.l d3`, and d3 goes back as a
  // signed longword however far past 2147483647 the accumulator was let run
  const raw = r.value >>> 0
  return VI(r.negative ? -raw | 0 : raw | 0)
}

/**
 * `L_ReadInt`'s limit table at $45a4, four longwords per radix.
 *
 * Indexed by `d3 + d4` BYTES --- the radix is 0, 16 or 32 and the sign is 0
 * or 8, so the pair addresses the row directly. Each row is `MaxPos,
 * MaxPosMaxDig, MaxNeg, MaxNegMaxDig`, and the check is `cmp.l 0(a3,d6.w),d2
 * / bhi .lp / bcs .putdig / cmp.b 7(a3,d6.w),d7 / bhi .lp` --- the `7` reads
 * the low byte of the second longword, which is where a value of 15 or less
 * lives.
 *
 * The three POSITIVE rows all bound the accumulator at 4294967295 --- 429496729
 * remainder 5 for decimal, $7fffffff remainder 1 for binary, $fffffff
 * remainder $f for hex --- and the three negative ones at 2147483648. So the
 * author's "maximum positive value" is the UNSIGNED maximum, consistently in
 * all three bases, and anything a program types above 2147483647 comes back
 * as the negative long those bits are: `=Iread Int` over 4294967295 is -1.
 */
const IEXT_READINT_MAX: readonly (readonly [number, number])[] = [
  [429496729, 5],
  [214748364, 8],
  [0x7fffffff, 1],
  [0x40000000, 0],
  [0x0fffffff, 0xf],
  [0x08000000, 0],
]

/** the row `d3 + d4` picks: decimal, binary or hex, positive or negative */
function readIntLimit(r: IextRead): readonly [number, number] {
  const row = (r.radix === 16 ? 2 : r.radix === 32 ? 4 : 0) + (r.negative ? 1 : 0)
  return IEXT_READINT_MAX[row]!
}

/**
 * The echo both editors do, and the erase both do backwards.
 *
 * A character goes in at the RastPort's cursor with `Text` and the cursor
 * advances. A backspace measures the character's width off the font, walks
 * the cursor back by it, redraws the same character in RP_COMPLEMENT --- which
 * XORs it away --- and then puts the cursor back where the redraw started.
 *
 * NOTE: the mode is restored with `moveq #RP_JAM2,d0`, not with what it was,
 * so a program that set COMPLEMENT with `Igr Writing` and then read a line
 * gets JAM2 back.
 *
 * DEFECT: the width is wrong on a proportional font. `move.l d1,a0` puts the
 * CharSpace table in a0 and the next instruction is `move.l tf_CharKern(a0),d1`
 * --- reading 48 bytes into the space table rather than the font's kern
 * pointer, and adding a word out of whatever that lands on. `L_ReadInt`'s
 * copy drops the kern lookup altogether, so the two disagree as well.
 * Neither can fire here: topaz 8 has a null `tf_CharSpace` and takes the
 * `.nospc` arm, `move.w tf_XSize(a0),d0`, which is the width this uses.
 */
function readEcho(rp: RastPort, ox: number, oy: number, ch: string, erase: boolean): void {
  if (!erase) {
    winText(rp, ox, oy, ch)
    return
  }
  rp.cpX -= rp.textLength(ch)
  const at = rp.cpX
  rp.drawMode = 2
  winText(rp, ox, oy, ch)
  rp.drawMode = 1
  rp.cpX = at
}

/** the character a digit value echoes as, `add.b #'0' / cmp.b #'9' / addq.b #7` */
function digitChar(v: number): string {
  return String.fromCharCode(v < 10 ? 48 + v : 48 + v + 7)
}

/**
 * `L_ReadStr` and `L_ReadInt`'s `.lp`, one pass over everything queued.
 *
 * `GetKey` answers Z-set for an empty buffer, and only then does the loop
 * `WaitTOF`; with keys waiting it takes them one after another without
 * giving a frame back. So this drains and the caller blocks only if the
 * editor is still open afterwards.
 *
 * `move.b d0,d7 / beq .cancel` ends the line on a character of ZERO. The
 * author's comment beside it says "0 returned if window closed", and that is
 * not where zeros come from: `ConvRawKey` is RawKeyConvert into a ONE-byte
 * buffer, so every key whose sequence does not fit --- the cursor keys, the
 * function keys, Help --- answers 0 and DoEvent files it as `ke_char`. On the
 * machine an arrow key abandons the line. DEVIATION: this port's keyboard
 * never queues a character-less key (Runtime.pressKey takes a character), so
 * the arm is written and only a test that pushes one can reach it.
 */
function pumpRead(rt: Runtime, st: IextState, r: IextRead): void {
  const { rp, ox, oy } = curRp(rt, st)
  for (;;) {
    if (r.done) return
    const ch = takeKey(rt, st)
    if (ch === null) return
    const code = ch.length > 0 ? ch.charCodeAt(0) : 0
    if (r.kind === 'char') {
      // `L_ReadChar` tests nothing: `move.b d0,2(a0)` whatever came back, so
      // a character-less key is the one-character string Chr$(0)
      r.text = String.fromCharCode(code)
      r.done = true
      return
    }
    if (code === 0) {
      // `.cancel` --- and it falls into `.endlp`, so the sign still applies
      r.text = ''
      r.value = 0
      r.done = true
      return
    }
    if (code === 13 || code === 10) {
      r.done = true
      return
    }
    if (r.kind === 'str') {
      if (code === 8) {
        if (r.text.length === 0) continue
        const last = r.text.slice(-1)
        r.text = r.text.slice(0, -1)
        readEcho(rp, ox, oy, last, true)
        continue
      }
      r.text += ch
      readEcho(rp, ox, oy, ch, false)
      continue
    }
    readIntKey(r, rp, ox, oy, ch, code)
  }
}

/**
 * One key of `L_ReadInt`, which is a radix parser as much as an editor.
 *
 * The prefixes only exist while the value is still zero and the radix is
 * still unset: `-` then `%` or `$` in that order, so `-$ff` parses and `$-ff`
 * does not --- once d3 is set the whole block is jumped over and `-` falls
 * into the digit path, where `sub.b #'0',d7 / bmi .lp` drops it.
 *
 * A `0` typed while the value is zero is thrown away by `cmp.b #'0',d7 / beq
 * .lp`, and thrown away before the echo, so `$0` shows as `$`.
 *
 * A letter is folded by `bclr #5,d7` on the value AND `bclr #5,1(a7)` on the
 * copy being echoed, so a lower-case `ff` is entered and displayed as `FF`.
 */
function readIntKey(r: IextRead, rp: RastPort, ox: number, oy: number, ch: string, code: number): void {
  if (code === 8) {
    readIntBack(r, rp, ox, oy)
    return
  }
  if (r.value === 0 && r.radix === 0) {
    if (!r.negative && ch === '-') {
      r.negative = true
      readEcho(rp, ox, oy, ch, false)
      return
    }
    if (ch === '%') {
      r.radix = 16
      readEcho(rp, ox, oy, ch, false)
      return
    }
    if (ch === '$') {
      r.radix = 32
      readEcho(rp, ox, oy, ch, false)
      return
    }
  }
  if (r.value === 0 && ch === '0') return
  let d = code - 48
  if (d < 0) return
  let out = ch
  if (d > 9) {
    d &= ~32
    out = String.fromCharCode(code & ~32)
    d -= 17
    if (d < 0) return
    d += 10
  }
  const maxDigit = r.radix === 16 ? 1 : r.radix === 32 ? 15 : 9
  if (d > maxDigit) return
  const [maxVal, maxLast] = readIntLimit(r)
  if (r.value > maxVal) return
  if (r.value === maxVal && d > maxLast) return
  const base = r.radix === 16 ? 2 : r.radix === 32 ? 16 : 10
  r.value = r.value * base + d
  readEcho(rp, ox, oy, out, false)
}

/** `.bksp` --- a digit, then the radix mark, then the sign, in that order */
function readIntBack(r: IextRead, rp: RastPort, ox: number, oy: number): void {
  if (r.value !== 0) {
    const base = r.radix === 16 ? 2 : r.radix === 32 ? 16 : 10
    const digit = r.value % base
    r.value = Math.floor(r.value / base)
    readEcho(rp, ox, oy, digitChar(digit), true)
    return
  }
  if (r.radix !== 0) {
    const mark = r.radix === 16 ? '%' : '$'
    r.radix = 0
    readEcho(rp, ox, oy, mark, true)
    return
  }
  if (!r.negative) return
  r.negative = false
  readEcho(rp, ox, oy, '-', true)
}

/**
 * `Iwrite [s$]` --- a string and then the next line, and the guide is right
 * that it is Print with one argument: *"Without the argument, it just goes
 * to the next line, like Print without any parameters."* Routine 182 is four
 * instructions --- `dlea NullStr,a0 / move.l a0,-(a3) / bsr L_Iwrite` ---
 * over routine 181, so the bare form IS the string form given "".
 *
 * `jtcall GetWinFlags / btst #WEB_UNSET,d0` is the first-write home:
 * `SetCoords(0, rp_TxBaseline)` on a window whose cursor has never been
 * placed, so the first `Iwrite` starts at the top-left of the window
 * whatever the RastPort was carrying.
 *
 * Then the line feed, measured in the WINDOW's interior rather than the
 * RastPort's: `(wd_Height - wd_BorderTop - wd_BorderBottom) / rp_TxHeight`
 * is the row count and `(rp_cp_y - wd_BorderTop) / rp_TxHeight + 1` is where
 * the cursor is. On the last row it ScrollRasters the interior up one line;
 * anywhere else it is `SetCoordsRel(0, rp_TxHeight)`, the call that will not
 * move a cursor still marked UNSET. Either way it ends `SetCoords(0,
 * #Null)`, so x goes home and y stays where the branch left it.
 *
 * DEFECT: those two measurements disagree about where the window starts, and
 * a window with a border is the casualty. The homing puts the cursor at
 * `rp_TxBaseline`, 6 for topaz 8, measured from the RastPort's origin --- the
 * window's top-left CORNER, border included. The row then subtracts
 * `wd_BorderTop`, which is 11 on any window with a title bar, so `sub.w`
 * leaves $fffb and `divu.w` reads that as 65531: 8191 rows, and the
 * comparison scrolls. Nothing after that moves the cursor, so every `Iwrite`
 * into an `Iwindow Open` window draws the same line at y 6 --- inside the
 * title bar --- and scrolls the interior underneath it. On the screen's own
 * backdrop window, which is borderless, all of it works.
 */
function iWrite(rt: Runtime, st: IextState, text: string): void {
  const { rp, ox, oy, w } = curRp(rt, st)
  const font = rp.font
  const th = font ? font.ySize : 8
  if ((w.flags & WEF.UNSET) !== 0) setGrPos(w, rp, 0, font ? font.baseline : 6)
  rp.text(ox + rp.cpX, oy + rp.cpY, text)
  rp.cpX += rp.textLength(text)
  const win = w.window
  // both divides are `divu.w`, unsigned, on a register whose low word is all
  // the `sub.w` before it touched
  const uw = (v: number): number => v & 0xffff
  const rows = Math.trunc(uw(win.height - win.borderTop - win.borderBottom) / th)
  const row = uw(Math.trunc(uw(rp.cpY - win.borderTop) / th) + 1)
  if (row >= rows) {
    scrollRasterUp(
      rp,
      th,
      ox + win.borderLeft,
      oy + win.borderTop,
      ox + win.width - win.borderRight - 1,
      oy + win.height - win.borderBottom - 1,
    )
  } else {
    // `SetCoordsRel(0, rp_TxHeight)`, and UNSET is already clear by here
    rp.cpY += th
  }
  setGrPos(w, rp, 0, null)
}

/**
 * Where the Intuition display's top-left corner sits in this port's hardware
 * coordinates.
 *
 * A screen whose `sc_LeftEdge` and `sc_TopEdge` are both zero is at 128,44
 * here: `openIscreen` below hands ../amiga/intuition.ts `displayY:
 * WB_DISPLAY_Y` for every screen it opens, and a fresh ./screen.ts Screen
 * carries `displayX = 128`. `Iscreen Display` is the only keyword that moves
 * one, and MoveScreen's arguments are deltas off those two fields, so this
 * is what turns the routine's absolute x and y back into a position.
 */
const IEXT_VIEW_LEFT = 128
const IEXT_VIEW_TOP = WB_DISPLAY_Y

/**
 * `FindAscr` (`amosfuncs.s`:234) --- an AMOS screen by number, for the four
 * keywords that copy across the fence.
 *
 * `cmp.l #7,d0 / bhi Ascr0to7` is an UNSIGNED longword compare, so a
 * negative number is a very large one and answers error 35, "Valid AMOS
 * screen numbers range from 0 to 7". A number in range with no screen open
 * falls out of the walk as zero and every caller reads that as `beq
 * L_NoScr`, error 16 --- so 8 and 3-with-nothing-open are different errors.
 *
 * The walk itself is over AMOS's own screen table at `-528(SavedA5)`, which
 * the author annotates *"Why isn't this documented?"*, and it matches on
 * `EcNumber(a0) & 7` rather than on the number itself.
 */
function findAscr(rt: Runtime, n: number): Screen {
  if ((n >>> 0) > 7) iError(E.ASN)
  return rt.screens.get(n) ?? iError(E.SNO)
}

/**
 * `BltBitMap(src, xSrc, ySrc, dst, xDest, yDest, xSize, ySize, $c0, -1, 0)`
 * --- the four instructions all six screen-copy keywords end in.
 *
 * `graphics_lib.fd` puts it at -30 and orders the arguments
 * `(a0,d0/d1,a1,d2/d3,d4/d5,d6/d7,a2)`, which is why every one of the six
 * loads the WIDTH into d4 and the HEIGHT into d5. `move.b #$c0,d6` is a
 * straight copy and `moveq #-1,d7` asks for every plane, so what bounds the
 * blit is the two DEPTHS: it moves `min(srcDepth, dstDepth)` planes and
 * leaves anything above them alone. AROS `rom/graphics/bltbitmap.c`:137 is
 * `depth = GetBitMapAttr(srcBitMap, BMA_DEPTH)` and :140 `if (x < depth)
 * depth = x` --- a reimplementation, but of the contract the autodoc states.
 *
 * Both depths are arguments rather than read off the BitMaps because four of
 * the six build their far end as a `struct BitMap` in the extension's own
 * data zone, and `Iscreen Amos Copy` fills its depth byte with zero, which
 * is why this can be asked for no planes at all. IEXT_AMOS_DEST_DEPTH below
 * carries that instruction and what follows from it.
 *
 * DEVIATION: the rectangle is clipped to both bitmaps. The ROM call is not,
 * which is what the guide's *"you will probably crash your Amiga!"* is
 * about, and there is no memory here to corrupt on a program's behalf.
 */
function bltIscreen(
  src: BitMap,
  sx: number,
  sy: number,
  dst: BitMap,
  dx: number,
  dy: number,
  w: number,
  h: number,
  srcDepth: number,
  dstDepth: number,
): void {
  const planes = Math.min(srcDepth, dstDepth)
  if (planes <= 0 || w <= 0 || h <= 0) return
  const mask = (1 << planes) - 1
  const keep = new Uint8Array(w * h)
  for (let ry = 0; ry < h; ry++) {
    const y = sy + ry
    if (y < 0 || y >= src.height) continue
    for (let rx = 0; rx < w; rx++) {
      const x = sx + rx
      if (x < 0 || x >= src.width) continue
      keep[ry * w + rx] = src.pixelAt(x, y)
    }
  }
  for (let ry = 0; ry < h; ry++) {
    const y = dy + ry
    if (y < 0 || y >= dst.height) continue
    for (let rx = 0; rx < w; rx++) {
      const x = dx + rx
      if (x < 0 || x >= dst.width) continue
      dst.writePixel(x, y, (dst.pixelAt(x, y) & ~mask) | (keep[ry * w + rx]! & mask))
    }
  }
}

/**
 * `sub.w d1,d5 / addq.w #1,d5` --- a rectangle edge pair as a size.
 *
 * Both halves are `.w`, so a reversed rectangle is not a negative size but a
 * very large unsigned one, and the blit runs to the edge of the bitmap
 * instead of doing nothing.
 */
function copySpan(from: number, to: number): number {
  return (to - from + 1) & 0xffff
}

/**
 * `Iget Sprite Palette [mask]` and `Iget Icon Palette [mask]` --- the object
 * or icon bank's 32 colours onto the current screen, and the masked form
 * loads them BACKWARDS.
 *
 * Four routines, 53 and 54 for sprites and 55 and 56 for icons, differing
 * only in `moveq #$1,d0` against `moveq #$2,d0` for GetBankAdr and in which
 * `Bnk_Bit` they then test --- bit 2 for objects, bit 3 for icons. Missing
 * either way is error 24 or 21. The palette is `bank + 2 + count * 8`:
 * `move.w (a0)+,d0 / lsl.l #$3,d0 / adda.l d0,a0` walks the pointer pairs.
 *
 * The plain form is one LoadRGB4 of all 32 in order. The masked one is a
 * loop, and `moveq #$1f,d5` counts DOWN while `move.w (a5)+,d1` reads UP.
 *
 * DEFECT: the loop uses d5 for both the mask bit and the destination colour,
 * so entry 0 of the bank goes to colour 31, entry 1 to colour 30, and the
 * palette arrives reversed. `Iget Sprite Palette` and `Iget Sprite Palette
 * 0` therefore disagree about every colour but the middle pair, which is a
 * thing a program can see in one line.
 *
 * DEFECT: the mask runs the wrong way round. `btst d5,d4 / bne .next` SKIPS
 * a colour whose bit is set, where the guide says *"if you just wanted to
 * get colours 1, 2, 6, and 8, and leave the other colours alone, you could
 * use: Iget Icon Palette %101000110"* --- a set bit meaning copy. AMOS's own
 * `Get Icon Palette` agrees with the guide, so a program moved across from
 * one to the other gets the complement of what it asked for.
 *
 * Both are reproduced. The bank palette is real here and so is the screen's,
 * and there is nothing in either defect this port has to invent.
 */
/**
 * `Set Icolour n,c` --- SetRGB4 on the current screen, split into three
 * nibbles by hand.
 *
 * `cmp.w cm_Count(a1),d0 / bcc L_IllFunc` bounds the index by the ColorMap's
 * own size, unsigned, so a negative index fails it too. The colour is
 * `lsr.w #8 / and #$f`, `lsr.w #4 / and #$f`, `and #$f`, which makes it a
 * 12-bit value however wide the screen is.
 */
function setIcolour(rt: Runtime, st: IextState, it: Parameters<Instr>[0]): void {
  const scr = curIscr(st)
  const n = it.evalInt()
  it.expect(',')
  const c = it.evalInt()
  const pal = rt.screens.get(scr.slot)?.palette
  if (!pal || (n >>> 0) >= colourMapCount(scr)) iError(E.IFC)
  pal[n] = c & 0x0fff
}

function iGetBankPalette(rt: Runtime, st: IextState, it: Parameters<Instr>[0], icons: boolean): void {
  const masked = !it.atStmtEnd()
  const mask = masked ? it.evalInt() : 0
  const pal = rt.screens.get(curIscr(st).slot)?.palette
  const bank = icons ? rt.iconBank : rt.spriteBank
  if (!bank) iError(icons ? E.NIB : E.NOB)
  if (!pal) return
  for (let i = 0; i < 32; i++) {
    const c = masked ? 31 - i : i
    if (masked && (mask & (1 << c)) !== 0) continue
    pal[c] = bank.palette[i] ?? 0
  }
}

/**
 * `Ipaste Icon x,y,n` --- icon n into the current window's RastPort.
 *
 * Routine 204 ($523e) builds a `struct BitMap` on the fly from the icon's
 * own header: `move.w (a5)+,d0 / add.w d0,d0` is the width in words turned
 * into `bm_BytesPerRow`, then `bm_Rows`, then `move.b d2,$5(a0)` for the
 * depth --- a BYTE write, unlike the one `Iscreen Amos Copy` gets wrong ---
 * and `addq.l #$4,a5` steps over the hot spot without reading it. So an icon
 * pastes by its top-left corner however its hot spot is set, and the blit is
 * `bm_BytesPerRow * 8` wide rather than the stored width.
 *
 * `Rbsr routine 184` is `Ilocate Gr`, which is how the graphics cursor ends
 * up where the guide says: *"The graphics pointer is left at the top left
 * corner of the icon image."* It runs AFTER FindIcon, so a missing icon is
 * error 20 and leaves the cursor alone.
 *
 * `move.l a2,d7 / bne` picks the arm: a null mask pointer is
 * BltBitMapRastPort with minterm $c0 and anything else is
 * BltMaskBitMapRastPort with $e0 over `mask + 4`.
 *
 * DEFECT: that test cannot tell a mask from AMOS's sentinel. `InPasteIcon`
 * (+Lib.s:12740) is `tst.l 4(a2) / Rbne L_Paste / move.l #$C0000000,4(a2)`,
 * so AMOS's own `Paste Icon` stamps $C0000000 into an empty mask field the
 * first time it draws an icon. An `Ipaste Icon` after a `Paste Icon` on the
 * same icon reads $C0000004 as mask data. Recorded and not reproduced: this
 * port keeps a boolean where the machine keeps that pointer, and there is no
 * $C0000000 to read.
 */
function iPasteIcon(rt: Runtime, st: IextState, it: Parameters<Instr>[0]): void {
  const { rp, ox, oy, w: iw } = curRp(rt, st)
  const x = it.evalInt()
  it.expect(',')
  const y = it.evalInt()
  it.expect(',')
  const n = it.evalInt()
  const img = rt.iconBank?.image(n) ?? null
  if (!img) iError(E.IND)
  setGrPos(iw, rp, x, y)
  const w = Math.min(img.width, img.rowBytes * 8)
  const planes = Math.min(img.depth, rp.bitMap.depth)
  if (planes <= 0) return
  const bits = (1 << planes) - 1
  for (let iy = 0; iy < img.height; iy++) {
    for (let ix = 0; ix < w; ix++) {
      const v = img.pixelAt(ix, iy)
      // minterm $e0 through the icon's mask, which is colour 0
      if (!img.opaque && v === 0) continue
      const tx = ox + rp.cpX + ix
      const ty = oy + rp.cpY + iy
      if (!rp.inClip(tx, ty)) continue
      rp.putPixel(tx, ty, (rp.point(tx, ty) & ~bits) | (v & bits))
    }
  }
}

/**
 * The ceiling every coordinate of `Iget Icon` is measured against, and the
 * comparison that makes the keyword unusable.
 *
 * DEFECT: `Iget Icon` cannot grab anything. Each of x1, y1, x2 and y2 goes
 * through `cmp.l #$7fff,dN / bgt.b +4 / <Rble routine 140>` at $7cd6, $7cec,
 * $7d02 and $7d18. AMOS's loader turns a marker into a real branch carrying
 * the marker's own condition --- `+B.s`:2611 GRouB pokes the opcode word
 * from `GRout + kind*8 + 4`, and kind 12's entry is `ble GRout` --- so what
 * runs is `bgt.b over / ble.w L_IllFunc`, which branches to the error
 * whenever the value is NOT greater than 32767. Every coordinate a program
 * would write is under 32767, so every call answers error 13.
 *
 * The two-instruction shape is there because AMOS has no `Rbgt`: `+CEqu.s`
 * defines markers for bra, bsr, eq, ne, cs, cc, lt, ge, ls, hi, le, pl and
 * mi, and this library needs a far `bgt` in exactly these four places and
 * nowhere else. Whether the inversion came in at the source or at `/extasm`
 * cannot be settled from here, and it does not change what the binary does.
 *
 * DEFECT: past the gate, `$7d4e cmp.w d3,d5 / Rbcs routine 164` raises
 * "Backward coordinates" when y1 is BELOW y2, and `$7d54` does the same for
 * x1 and x2 --- the normal order both times, and the comparison the author
 * wanted is the other way round. Reproduced beside the gate, since the
 * arguments are all this needs.
 *
 * The last two are recorded and not written, because neither is reachable
 * and neither is survivable. `$7d7e cmp.w (a0),d7` checks the icon number
 * against the first word of the SCREEN structure, a0 having been reloaded
 * with `wd_WScreen` for the bounds tests and never given the bank back. And
 * the store at the end, `$7eae move.l a0,-$6(a2,d7.l)`, runs after `$7ea0
 * suba.l a2,a2` cleared a2 for BltBitMap's tempA, so the icon pointer goes
 * to absolute address `n * 8 - 6` --- the exception vectors.
 */
const IEXT_COORD_CEILING = 0x7fff

/**
 * `Iget Icon [screen[,window],]n,x1,y1 To x2,y2`, all three spellings.
 *
 * Routines 283, 284 and 285 each find a window and fall into 286, which is
 * the whole of the work. 283 takes the current window, 284 the named
 * screen's BASE window --- `move.l sc_UserData(a0),a0 / move.l
 * se_BaseWin(a0),a5`, which is what the guide means by *"If you specify a
 * screen number but omit the window number, the base window (window number
 * 0) is used"* --- and 285 walks that screen's list with FindIwin2. Both of
 * the longer ones PEEK at their extra arguments, `move.l 20(a3),d0` without
 * a pop, and drop them afterwards, which is what lets one base routine take
 * the last five off the stack in every case.
 *
 * Then the checks, in the order the binary runs them, and every one of them
 * is reached before the gate that stops the keyword dead.
 */
function iGetIcon(rt: Runtime, st: IextState, it: Parameters<Instr>[0]): never {
  const before: number[] = [it.evalInt()]
  while (it.accept(',')) before.push(it.evalInt())
  it.expect('to')
  const x2 = it.evalInt()
  it.expect(',')
  const y2 = it.evalInt()
  if (before.length < 3 || before.length > 5) iError(E.IFC)
  const extra = before.length - 3
  const win =
    extra === 0
      ? curIwin(st)
      : extra === 1
        ? (findIscr(st, before[0]!).windows.get(0) ?? iError(E.SNO))
        : (findIscr(st, before[0]!).windows.get(before[1]!) ?? iError(E.WNO))
  const [n, x1, y1] = [before[extra]!, before[extra + 1]!, before[extra + 2]!]

  if (!rt.iconBank) iError(E.NIB)
  if ((n >>> 0) > 0xffff) iError(E.IFC)
  if ((n & 0xffff) === 0) iError(E.IFC)
  // `movem.l (a3)+,d3-d7` leaves d6 = x1, d5 = y1, d4 = x2, d3 = y2, and the
  // ceiling pairs run in that order
  for (const v of [x1, y1, x2, y2]) {
    if (!(v > IEXT_COORD_CEILING)) iError(E.IFC)
    if (v < -0x8000) iError(E.IFC)
  }
  // everything below is word arithmetic on `wd_WScreen`
  const scr = rt.screens.get(win.window.screenSlot)
  const w16 = (v: number): number => v & 0xffff
  const s16 = (v: number): number => (v << 16) >> 16
  if (scr) {
    if (s16(x1) >= scr.width) iError(E.IFC)
    if (s16(y1) >= scr.height) iError(E.IFC)
  }
  if (s16(x2) < 0) iError(E.IFC)
  if (s16(y2) < 0) iError(E.IFC)
  if (w16(y1) < w16(y2)) iError(E.BWC)
  if (w16(x1) < w16(x2)) iError(E.BWC)
  iError(E.IND)
}

/**
 * `bm_Depth` of the BitMap `Iscreen Amos Copy` blits INTO, and it is zero.
 *
 * DEFECT: $270a and $27ba are `move.w $50(a0),$5(a1)` --- EcNPlan written as
 * a WORD to `bm_Depth`, which is one byte at offset 5. Two things follow.
 * The address is odd, so on a 68000 the keyword is an address error and
 * nothing else; this machine is a 68020 (./jd.ts's `Jd Cpu`), which allows
 * the access, and then big-endian order puts EcNPlan's HIGH byte in
 * `bm_Depth` and its low byte in `bm_Pad`. A plane count of 1 to 6 has a
 * high byte of 0, so the destination is a BitMap of no planes and BltBitMap
 * copies nothing at all.
 *
 * `Amos Iscreen Copy` going the other way is `move.w $50(a1),d6 / move.b
 * d6,$5(a0)` at $25da and does it correctly, which is what makes this a slip
 * rather than a misunderstanding. `Iscreen Amos Copy` was added in 1.3b, 22
 * February 1996, the last release the extension ever had, so it never worked
 * in any version.
 */
const IEXT_AMOS_DEST_DEPTH = 0

/** an Iscreen's BitMap, or null for a screen ../amiga/intuition.ts lost */
function iscrBitMap(rt: Runtime, scr: IextScreen): BitMap | null {
  return rt.screens.get(scr.slot)?.rp.bitMap ?? null
}

/** both spellings of a copy keyword's arguments; `whole` is the `a To b` one */
interface CopyArgs {
  a: number
  b: number
  x1: number
  y1: number
  x2: number
  y2: number
  dx: number
  dy: number
  whole: boolean
}

/**
 * `a To b` or `a,x1,y1,x2,y2 To b,x,y`, which the token table spells as two
 * entries --- `I0t0` naming the keyword and an unnamed `I0,0,0,0,0t0,0,0`
 * continuation beside it, pointing at the routine one BELOW. So `Iscreen
 * Copy` is routine 37 for the short form and 36 for the long one, and the
 * same pairing holds at 43/42 and 45/44.
 */
function copyArgs(it: Parameters<Instr>[0]): CopyArgs {
  const a = it.evalInt()
  const c: CopyArgs = { a, b: 0, x1: 0, y1: 0, x2: 0, y2: 0, dx: 0, dy: 0, whole: true }
  if (it.accept(',')) {
    c.whole = false
    c.x1 = it.evalInt()
    it.expect(',')
    c.y1 = it.evalInt()
    it.expect(',')
    c.x2 = it.evalInt()
    it.expect(',')
    c.y2 = it.evalInt()
  }
  it.expect('to')
  c.b = it.evalInt()
  if (!c.whole) {
    it.expect(',')
    c.dx = it.evalInt()
    it.expect(',')
    c.dy = it.evalInt()
  }
  return c
}

/**
 * A `.w` result in a register the argument arrived in as a longword: the low
 * word changes and the high word rides through untouched.
 *
 * The four coordinate converters are all word arithmetic --- `lsr.w #2,d3`,
 * `add.w d3,d3`, `add.w v_DxOffset(a1),d3` --- and then return d3 whole, so
 * an argument that fits in a word converts the obvious way and one that does
 * not keeps its top half: `=X Ihard(65536)` on a hires screen is 65536.
 */
function wordOp(v: number, f: (low: number) => number): number {
  return ((v & ~0xffff) | (f(v & 0xffff) & 0xffff)) | 0
}

/** `defs.i`:171-173 --- what `OpenIwin` uses when the flags are Null */
const IEXT_WFLAGS = 0x1 | 0x2 | 0x4 | 0x8 | 0x1000


/**
 * `GetCurRP`: the current window's RastPort, and where its origin sits.
 *
 * A window's RPort has its origin at the window's top-left and is clipped to
 * it, so the port carries an offset beside it -- the same shape ./jdint.ts
 * and ./int.ts use, and for the same reason.
 */
function curRp(rt: Runtime, st: IextState): { rp: RastPort; ox: number; oy: number; w: IextWindow } {
  const w = curIwin(st)
  if (!w.rp) {
    const bitMap = rt.screens.get(w.window.screenSlot)?.rp.bitMap ?? rt.screen.rp.bitMap
    w.rp = new RastPort(bitMap)
    w.rp.font = rt.systemFont()
    // `SetAPen` is what `Iink` moves; a fresh RPort starts at pen 1
    w.rp.fgPen = 1
    w.rp.bgPen = 0
  }
  const win = w.window
  w.rp.clip = {
    x1: win.leftEdge,
    y1: win.topEdge,
    x2: win.leftEdge + win.width - 1,
    y2: win.topEdge + win.height - 1,
  }
  return { rp: w.rp, ox: win.leftEdge, oy: win.topEdge, w }
}

/** the screen's base window, which `Icls` clears rather than the current one */
function baseRp(rt: Runtime, st: IextState): { rp: RastPort; ox: number; oy: number; w: IextWindow } {
  const saved = st.currentWindow
  const savedWb = st.currentIsWB
  st.currentWindow = 0
  st.currentIsWB = false
  try {
    return curRp(rt, st)
  } finally {
    st.currentWindow = saved
    st.currentIsWB = savedWb
  }
}

/**
 * `L_IlocateGr` with SAFE_GRPOS OUT, which is how it shipped.
 *
 * `defs.i`:46 has `;SAFE_GRPOS equ 1` commented out and the binary bears it
 * out: routine 184 goes from `move.l (a3)+,d0` straight to SetCoords. So a
 * coordinate off the window is accepted and the clip deals with it.
 *
 * Either may be Null, which keeps the cursor where it is.
 */
/**
 * `SetCoords` (`src2/windows.s`:660) --- Move, and the flag it clears.
 *
 * An omitted coordinate is `cmp.l #Null,d0 / beq .nox`, which reads the
 * RastPort's own `rp_cp_x` back and moves to it, so it keeps that axis. The
 * two instructions after the Move are `moveq #WEF_UNSET,d1 / bsr
 * SetWinFlags`: any absolute positioning marks the window's cursor as SET,
 * and `SetCoordsRel` next door is `btst #WEB_UNSET,d0 / bne .exit` and will
 * not move a cursor that has never been placed. Every drawing keyword in
 * this extension reaches SetCoords through `L_IlocateGr`, so any of them
 * clears it and `Iwrite` is the only keyword that can tell.
 */
/**
 * `Text` through a window's RastPort, leaving the cursor where the library
 * leaves it.
 *
 * graphics.library's Text advances `rp_cp_x` by what it drew and does not
 * touch `rp_cp_y`, and ../amiga/graphics.ts does the same --- but it is
 * handed SCREEN coordinates here while the extension keeps its cursor in
 * WINDOW ones, so both have to be put back. Without that a window at 40,30
 * came out of one `Itext` with its cursor 40 pixels along and 30 lines down
 * from where the program left it, and `Itext` counted the string's width
 * twice on top.
 */
function winText(rp: RastPort, ox: number, oy: number, str_: string): void {
  const x = rp.cpX
  const y = rp.cpY
  rp.text(ox + x, oy + y, str_)
  rp.cpX = x + rp.textLength(str_)
  rp.cpY = y
}

function setGrPos(w: IextWindow, rp: RastPort, x: number | null, y: number | null): void {
  if (x !== null) rp.cpX = x
  if (y !== null) rp.cpY = y
  w.flags &= ~WEF.UNSET
}

/**
 * `cm_Count` --- how many entries the screen's ColorMap has.
 *
 * Both colour keywords bound their index by it, `cmp.w cm_Count(a1),d0 /
 * bcc L_IllFunc` on the way in and `bmi` on GetRGB4's -1 on the way out.
 *
 * It is Intuition's number, not the extension's: OpenScreen allocates the map
 * with `GetColorMap` for the depth it was asked for, so a four-plane screen
 * has sixteen. This port's `Screen.palette` is 256 wide whatever the depth --
 * AGA's whole register file, so that a program poking a high pen has
 * somewhere to poke -- which would let an index no real ColorMap has through.
 */
function colourMapCount(scr: IextScreen): number {
  return 1 << scr.depth
}

/**
 * `Set Ifont`'s font name, and the `.font` it appends by hand.
 *
 * `fonts.s` compares the last five bytes to `'.'`, `'f'`, `'o'`, `'n'`, `'t'`
 * one at a time, so the test is case SENSITIVE and the guide says so:
 * *"if it does, it (the \".font\") MUST be in lower case"*, and again in the
 * error node, *"something like Set Ifont \"fontname.Font\" won't work"*.
 *
 * DEVIATION: the compare starts at `chars + len - 5` whatever `len` is, so a
 * name shorter than five characters reads the length word and whatever sits
 * before it. Those bytes cannot spell `.font` in any layout worth modelling,
 * and the branch they reach is the one that appends, which is what happens
 * here.
 */
function ifontFamily(name: string): string {
  return name.endsWith('.font') ? name : `${name}.font`
}

/**
 * `OpenFont` then `OpenDiskFont`, and `L_NoFont` when neither answers.
 *
 * The order matters and it is the machine's: OpenFont searches the fonts
 * already in memory, which on any Amiga means ROM topaz before anything on
 * disk. Here that list has one entry, `rt.systemFont()`, so a request for
 * `topaz.font` at 8 never touches the volume.
 */
function openIfont(rt: Runtime, name: string, size: number): DiskFont {
  const family = ifontFamily(name)
  const rom = rt.systemFont()
  if (family === rom.name && size === rom.ySize) return rom
  return openDiskFont((path) => rt.vfs?.read(path) ?? null, family, size) ?? iError(E.FNA)
}

/**
 * An address for a `struct TextFont *`, which `=Ifont Base` hands back.
 *
 * Same arrangement as `windowAddr`: the extension returns a pointer into
 * graphics.library's font and this port has no such memory, so each face gets
 * one stable number the first time it is asked for.
 */
const IEXT_FONT_ORIGIN = 0x7cb0_0000
const iextFontAddrs = new WeakMap<DiskFont, number>()
let iextFontAddrNext = 0
function fontAddr(f: DiskFont): number {
  const had = iextFontAddrs.get(f)
  if (had !== undefined) return had
  const made = IEXT_FONT_ORIGIN + iextFontAddrNext++ * 0x40
  iextFontAddrs.set(f, made)
  return made
}

/** `Ievent Vbl` --- `move.l #$80000000,d3`, which no IDCMP class can be */
const IEXT_EVENT_VBL = -0x8000_0000

/**
 * `GetKey`: take one character out of the buffer, remembering its raw code.
 *
 * `LastCode` and `LastQual` are what `=Iscan` and `=Ishift` read back, and
 * they are written HERE rather than when the key arrived -- so they describe
 * the last key CONSUMED, not the last one pressed.
 */
function takeKey(rt: Runtime, st: IextState): string | null {
  const k = rt.input.keyQueue.shift()
  if (!k) return null
  st.lastCode = k.scan
  st.lastQual = k.shift ?? 0
  return k.ch
}

/**
 * `EventData` --- `tmove.l d1,EventData`, and d1 is whatever DoEvent's arm
 * for that class happened to leave in d0.
 *
 * The guide is honest about it: *"Currently, only a gadget event has extra
 * data to be read by this function; it returns the number of the gadget that
 * was clicked on."* Reading the arms one at a time says why. GADGETDOWN and
 * GADGETUP both end `moveq #0,d0 / move.w gg_GadgetID(a1),d0`, which is the
 * promise. CLOSEWINDOW leaves `WEF_CLOSED`, because `moveq #WEF_CLOSED,d0 /
 * move.l d0,d1 / bsr SetSomeWinFlags` and SetSomeWinFlags's `and.l d1,d0`
 * gives it straight back. MOUSEBUTTONS leaves the BIT NUMBER it toggled, 0
 * for select and 1 for menu. RAWKEY leaves the character ConvRawKey made, or
 * the raw code when the arm dropped the event.
 *
 * DEVIATION: MENUPICK and every class with no arm at all leave the
 * IntuiMessage POINTER, because `move.l d0,a0` at the top of DoEvent copied
 * it out of d0 and nothing wrote d0 again. This port has no address for a
 * message, and the guide tells programs not to read it, so it answers 0.
 */
function eventDataFor(cls: number, code: number, iaddress: number): number {
  if (cls === IDCMP_GADGETUP || cls === IDCMP_GADGETDOWN) return iaddress
  if (cls === IDCMP_CLOSEWINDOW) return WEF.CLOSED
  if (cls === IDCMP_MOUSEBUTTONS) return code & 0x7f & 3
  if (cls === IDCMP_RAWKEY) return code
  return 0
}

/**
 * `L_IwaitEvent` and `L_IwaitEventVbl`, which differ by one signal.
 *
 * The Vbl form adds `VBLSignal` to the mask it waits on and answers
 * `$80000000` when that is what woke it, so a program can drive an animation
 * off the same loop that reads its gadgets.
 */
function waitEvent(rt: Runtime, it: Parameters<Func>[0], vbl: boolean): Value {
  const st = rt.iext
  // `jtcall GetCurInput` first, which is where a program with no screen open
  // at all is refused
  curIwin(st)
  // `jtcall DoEvent` with IDCMPWAIT files every message it passes, then
  // `tmove.l d1,EventData` keeps whatever the matching arm left in d0
  const hit = doEvent(st, IEXT_IDCMPWAIT)
  if (hit) {
    st.eventData = eventDataFor(hit.cls, hit.code, hit.iaddress)
    return VI(hit.cls)
  }
  // `.vbl` --- the Vbl form gives the frame back rather than waiting again
  if (vbl) return VI(IEXT_EVENT_VBL)
  if (st.headlessWake) {
    st.headlessWake = false
    return VI(0)
  }
  it.block({ type: 'ievent' }, true)
  return VI(0)
}

/* --------------------------------------------------------------------------
 * `gadgets.s`
 *
 * `Reserve Igadget n` AllocMemClears an array of n slots on the CURRENT
 * window, each `GADGETSIZE equ gg_sizeof+ge_sizeof+si_sizeof` = 98 bytes --
 * the `lea.l $62(a5),a5` the two all-gadget loops step by. A `Set Igadget
 * ...` fills one slot in; `Igadget On` links it into the window's own gadget
 * list with AddGadget (-42) and refreshes it with RefreshGList (-432).
 * ----------------------------------------------------------------------- */

/**
 * The `n,x,y,w,h` every `Set Igadget` opens with, and the rest of a fixed
 * list.
 *
 * A height left out reaches the routine as AMOS's `Null`, `$80000000`, which
 * `cmp.l #Null,d3 / beq` turns into the font height plus four. The token
 * spec spells that as an omissible argument, so an empty one reads as zero
 * here and the two arms agree.
 */
function gadArgs(it: Parameters<Instr>[0], n: number): number[] {
  const out: number[] = [it.evalInt()]
  for (let i = 1; i < n; i++) {
    it.expect(',')
    // an omitted argument reads as zero, which is what `cmp.l #Null,d3`
    // turns into the font height for a string gadget's height
    out.push(it.atStmtEnd() || it.nm() === ',' ? 0 : it.evalInt())
  }
  return out
}

/** `we_Gadgets`, checked for `n` in range, or error 34, "Gadget not reserved" */
function gadSlotIndex(w: IextWindow, n: number): number {
  // `cmp.l #$10000,d7 / bcc L_GadNotRes` then `cmp.w we_NGadgets,d7 / bhi`,
  // and it is `bhi` -- an n EQUAL to the count passes, because the array is
  // one-based and slot n is index n-1
  if (n < 0 || n >= 0x1_0000) iError(E.GNR)
  if (n > w.gadgets.length) iError(E.GNR)
  // `subq.w #1,d7 / bmi L_IllFunc` -- gadget 0 is error 13, not error 34
  if (n - 1 < 0) iError(E.IFC)
  return n - 1
}

/** the slot, and error 33 when no `Set Igadget` has filled it in */
function gadDefined(w: IextWindow, n: number): IextGadget {
  const g = w.gadgets[gadSlotIndex(w, n)]
  // `tst.w gg_GadgetType(a0) / beq L_GadNotDef`: a MEMF_CLEARed slot has type
  // zero, and no gadget type is zero
  if (!g) iError(E.GND)
  return g
}

/**
 * The two-border bevel every boolean gadget carries, and the swapped pair it
 * shows while SELECTED.
 *
 * `L_MakeBoolGad` writes them out by hand: `(w-1,0) - (0,0) - (0,h-1)` in the
 * hilite pen and `(w-1,0) - (w-1,h-1) - (0,h-1)` in the shadow pen, then the
 * same two with the pens the other way round into `gg_SelectRender`. So a
 * gadget is a raised box that goes recessed when it is pressed, drawn with
 * whatever pens `Set Ipens` last put in `we_HilitePen` and `we_ShadowPen`.
 */
function boolBorders(w: IextWindow, width: number, height: number, swapped: boolean): Border[] {
  const d4 = width - 1
  const d3 = height - 1
  const first = swapped ? w.shadowPen : w.hilitePen
  const second = swapped ? w.hilitePen : w.shadowPen
  return [
    { leftEdge: 0, topEdge: 0, pen: first, xy: [d4, 0, 0, 0, 0, d3] },
    { leftEdge: 0, topEdge: 0, pen: second, xy: [d4, 0, d4, d3, 0, d3] },
  ]
}

/**
 * `L_MakeSlider`'s border: four `struct Border`s, an inner pair and an outer
 * pair, so the container reads as a groove rather than a box.
 *
 * `(1,1)-(1,h-2)` and `(0,h-1)-(0,0)-(w-2,0)` in the hilite pen, then
 * `(w-2,1)-(w-2,h-2)` and `(w-1,0)-(w-1,h-1)-(1,h-1)` in the shadow pen.
 */
function sliderBorders(w: IextWindow, width: number, height: number): Border[] {
  const d4 = width - 1
  const d3 = height - 1
  const d6 = d4 - 1
  const d7 = d3 - 1
  return [
    { leftEdge: 0, topEdge: 0, pen: w.hilitePen, xy: [1, 1, 1, d7] },
    { leftEdge: 0, topEdge: 0, pen: w.hilitePen, xy: [0, d3, 0, 0, d6, 0] },
    { leftEdge: 0, topEdge: 0, pen: w.shadowPen, xy: [d6, 1, d6, d7] },
    { leftEdge: 0, topEdge: 0, pen: w.shadowPen, xy: [d4, 0, d4, d3, 1, d3] },
  ]
}

/**
 * `L_gStringBorder`: the box a string or integer gadget sits INSIDE.
 *
 * The gadget itself was shrunk by 4 on the left, 2 on the top, 8 in width and
 * 4 in height, so the border is drawn at negative offsets to land back on the
 * rectangle the caller asked for. `d4` is `gg_Width + 3` and `d3` is
 * `gg_Height + 1`, which is that arithmetic run backwards.
 */
function stringBorders(w: IextWindow, width: number, height: number): Border[] {
  const d4 = width + 3
  const d3 = height + 1
  const d6 = d4 - 1
  const d7 = d3 - 1
  return [
    { leftEdge: 0, topEdge: 0, pen: w.hilitePen, xy: [-3, -1, -3, d7] },
    { leftEdge: 0, topEdge: 0, pen: w.hilitePen, xy: [-4, d3, -4, -2, d6, -2] },
    { leftEdge: 0, topEdge: 0, pen: w.shadowPen, xy: [d6, -1, d6, d7] },
    { leftEdge: 0, topEdge: 0, pen: w.shadowPen, xy: [d4, -2, d4, d3, -3, d3] },
  ]
}

/**
 * The bounds every `Set Igadget` checks, in the order it checks them.
 *
 * x and y are made window-relative by ADDING the border widths, so a program
 * gives coordinates inside the frame and Intuition gets coordinates from the
 * window's corner. Then each of the four must be under `$8000`, the bottom
 * and right edges must fall inside the window counting its own borders, and
 * -- for a boolean gadget only -- the size must be at least 4 by 4.
 */
function gadBounds(
  iw: IextWindow,
  x: number,
  y: number,
  gw: number,
  gh: number,
  minSize: boolean,
): { x: number; y: number } {
  const win = iw.window
  const left = x + win.borderLeft
  const top = y + win.borderTop
  for (const v of [gh, gw, top, left]) if (v > 0x8000) iError(E.IFC)
  if (win.borderBottom + gh + top >= win.height) iError(E.IFC)
  if (win.borderRight + gw + left >= win.width) iError(E.IFC)
  if (minSize && (gh < 4 || gw < 4)) iError(E.IFC)
  return { x: left, y: top }
}

/** put a filled-in gadget in its slot, replacing whatever was there */
function putGadget(rt: Runtime, w: IextWindow, index: number, g: IextGadget): void {
  const old = w.gadgets[index]
  if (old?.displayed) {
    const at = w.window.gadgets.indexOf(old.gad)
    if (at >= 0) w.window.gadgets.splice(at, 1)
  }
  w.gadgets[index] = g
  rt.intuition.invalidate()
}

/** `L_MakeBoolGad`, shared by Set Igadget Toggle and Set Igadget Hit */
function makeBoolGad(rt: Runtime, box: readonly number[], selected: boolean, toggle: boolean): void {
  const st = rt.iext
  const w = curIwin(st)
  const n = box[0]!
  const index = gadSlotIndex(w, n)
  const [gx, gy, gw, gh] = [box[1]!, box[2]!, box[3]!, box[4]!]
  const at = gadBounds(w, gx, gy, gw, gh, true)
  const gad: UserGadget = {
    leftEdge: at.x,
    topEdge: at.y,
    width: gw,
    height: gh,
    id: n,
    kind: GTYP_BOOLGADGET,
    // `move.w #GADGHIMAGE,gg_Flags` and then SELECTED ORed in, which is what
    // makes `gg_SelectRender` the highlight
    flags: GFLG_GADGHIMAGE | (selected ? GFLG_SELECTED : 0),
    activation: (toggle ? GACT_TOGGLESELECT : 0) | GACT_GADGIMMEDIATE | GACT_RELVERIFY,
    borders: boolBorders(w, gw, gh, false),
    selectBorders: boolBorders(w, gw, gh, true),
  }
  putGadget(rt, w, index, { gad, units: 0, knobSize: 0, hitCount: 0, displayed: false, down: false })
}

/**
 * `L_MakeSlider`, and the two defects it carries.
 *
 * DEFECT: `$68ca move.w #$ffff,$6(a0) / clr.w $2(a0)`. That is the VERTICAL
 * arm of the "nothing is hidden" case, and `$6(a0)` is pi_HorizBody and
 * `$2(a0)` is pi_HorizPot -- the same two the horizontal arm four
 * instructions above writes. A vertical slider whose size covers its units
 * therefore leaves pi_VertBody at the zero AllocMemClear left, and an
 * AUTOKNOB with a body of zero is a knob clamped to KNOBVMIN, four pixels,
 * at the top of its container.
 *
 * DEFECT: the FREEHORIZ/FREEVERT decision is read off the wrong word.
 * `$68a8 divu.w (a7)+,d1` pops the hidden count and `$68aa tst.w (a7)+` pops
 * the direction flag, so by the time `$68d8 tst.w (a7)+` runs the stack is
 * back at the `movem.l a4/a6,-(a7)` `pstart` pushed and what it tests is the
 * HIGH WORD OF a4 -- the extension's own data zone pointer. Above 64KB, which
 * is every real machine, that is non-zero and every slider comes out
 * FREEVERT. `pstart` saves a7 in `A7StackPtr` and `ret` restores it, so the
 * unbalanced pop costs nothing else. The "nothing hidden" path reaches
 * `.piflag` with the flag still on the stack and gets it right.
 *
 * DEVIATION: this port has no saved a4 to read and no address for its data
 * zone, so the slider is built with the direction the caller asked for. Both
 * defects are recorded rather than reproduced, the same call `=Irequest File
 * Next$` gets.
 */
function makeSlider(rt: Runtime, v: readonly number[], vertical: boolean): void {
  const st = rt.iext
  const w = curIwin(st)
  const n = v[0]!
  const index = gadSlotIndex(w, n)
  const [gx, gy, gw, gh] = [v[1]!, v[2]!, v[3]!, v[4]!]
  const [units, pos, size, overlap] = [v[5]!, v[6]!, v[7]!, v[8]!]
  const at = gadBounds(w, gx, gy, gw, gh, false)
  const prop = { flags: AUTOKNOB | (vertical ? FREEVERT : FREEHORIZ), horizPot: 0, vertPot: 0, horizBody: 0, vertBody: 0 }
  const hidden = units - size
  let body = MAXBODY
  let pot = 0
  if (hidden > 0) {
    // `Body = ((visible - overlap) * MAXBODY) / (total - overlap)` and
    // `Pot = (position * MAXPOT) / hidden`, both the author's own comment
    body = Math.trunc(((size - overlap) * MAXBODY) / Math.max(1, units - overlap))
    pot = Math.min(MAXPOT, Math.trunc((pos * MAXPOT) / hidden))
  }
  if (vertical) {
    prop.vertBody = body
    prop.vertPot = pot
  } else {
    prop.horizBody = body
    prop.horizPot = pot
  }
  const gad: UserGadget = {
    leftEdge: at.x,
    topEdge: at.y,
    width: gw,
    height: gh,
    id: n,
    kind: GTYP_PROPGADGET,
    flags: GFLG_GADGHNONE,
    activation: GACT_GADGIMMEDIATE | GACT_RELVERIFY,
    borders: sliderBorders(w, gw, gh),
    prop,
  }
  putGadget(rt, w, index, { gad, units, knobSize: size, hitCount: 0, displayed: false, down: false })
}

/** `.left`, `.centre` and the `cmp.l #2` that refuses anything else */
function strPos(v: number): number {
  if (v === 0) return 0
  if (v === 1) return GACT_STRINGCENTER
  if (v === 2) return GACT_STRINGRIGHT
  return iError(E.IFC)
}

/**
 * `L_SetIgadString` and `L_SetIgadInt`, which are the same routine twice.
 *
 * A height of zero -- the AMOS `Null` an omitted argument passes -- becomes
 * `rp_TxHeight + 4`, and anything smaller than that is error 13; so is a
 * width under 32. The gadget is then shrunk to sit INSIDE its border: 4 off
 * the left, 2 off the top, 8 off the width and 4 off the height.
 *
 * `si_MaxChars` counts the NUL, so `Set Igadget String n,...,size` holds
 * `size - 1` characters. The integer one is a flat 12, "`-1234567890` plus
 * trailing null" in the author's comment, which is eleven characters and
 * exactly fits `-2147483648`.
 */
function makeStringGad(
  rt: Runtime,
  box: readonly number[],
  opts: { maxChars: number; text: string; longInt: number | null; posArg: number },
): void {
  const st = rt.iext
  const w = curIwin(st)
  const n = box[0]!
  const index = gadSlotIndex(w, n)
  const font = rt.systemFont()
  const [gx, gy, gw] = [box[1]!, box[2]!, box[3]!]
  const asked = box[4]!
  const gh = asked === 0 ? font.ySize + 4 : asked
  const at = gadBounds(w, gx, gy, gw, gh, false)
  if (gh < font.ySize + 4) iError(E.IFC)
  if (gw < 32) iError(E.IFC)
  const inner = { x: at.x + 4, y: at.y + 2, w: gw - 8, h: gh - 4 }
  const gad: UserGadget = {
    leftEdge: inner.x,
    topEdge: inner.y,
    width: inner.w,
    height: inner.h,
    id: n,
    kind: GTYP_STRGADGET,
    flags: GFLG_GADGHNONE,
    activation:
      strPos(opts.posArg) | GACT_GADGIMMEDIATE | GACT_RELVERIFY | (opts.longInt === null ? 0 : GACT_LONGINT),
    borders: stringBorders(w, inner.w, inner.h),
    strInfo: {
      buffer: opts.text.slice(0, Math.max(0, opts.maxChars - 1)),
      maxChars: opts.maxChars,
      bufferPos: 0,
      longInt: opts.longInt ?? 0,
    },
  }
  putGadget(rt, w, index, { gad, units: 0, knobSize: 0, hitCount: 0, displayed: false, down: false })
}

/** `Igadget On n`: AddGadget then RefreshGList, and a second On does nothing */
function gadgetOn(rt: Runtime, w: IextWindow, g: IextGadget): void {
  if (g.displayed) return
  g.displayed = true
  w.window.gadgets.push(g.gad)
  rt.intuition.invalidate()
}

/** `Igadget Off n`: RemoveGadget then `ClearGadget`, which blanks its box */
function gadgetOff(rt: Runtime, w: IextWindow, g: IextGadget): void {
  if (!g.displayed) return
  g.displayed = false
  g.down = false
  const at = w.window.gadgets.indexOf(g.gad)
  if (at >= 0) w.window.gadgets.splice(at, 1)
  rt.intuition.invalidate()
}

/**
 * `FindImenu`, `FindImenuItem` and `FindImenuSub`, which are one walk.
 *
 * `cmp.w mu_MenuNum(a0),d2 / beq .exit / bcs .high` --- equal is a hit, and
 * a number BELOW the wanted one ends the walk as a miss, so the list has to
 * be ascending and `at` is where a new node belongs. The node before `at` is
 * the `a1` all three return, which is what the creator inserts after and what
 * the deleter relinks through.
 *
 * `FindImenuSub` has a slip the others do not: its `.loop` is `move.l a0,d1`
 * where theirs is `move.l a0,d0`, so running off the end leaves d0 holding
 * the subitem NUMBER instead of zero. `L_SetImenu` tests a0 and never sees
 * it, and `L_GetImenu`, which tests d0, is not reachable -- see the note on
 * `Set Imenu`.
 */
function findSorted<T extends { number: number }>(list: readonly T[], n: number): { node: T | null; at: number } {
  let at = 0
  while (at < list.length && list[at]!.number < n) at++
  return { node: at < list.length && list[at]!.number === n ? list[at]! : null, at }
}

/**
 * Intuition's `ItemAddress(firstMenu, code)` --- the MenuItem a pick names.
 *
 * The code is POSITIONAL, five bits of menu index, six of item, five of sub,
 * and `NOITEM`/`NOSUB` are those fields all ones. So this walks by index and
 * `GetMenu` reads `mu_MenuNum` and `mi_ItemNum` back OUT of what it finds:
 * the two numberings are different and the structures are the bridge.
 *
 * Null when the code addresses nothing, which `GetMenu` treats as an internal
 * error -- `move.l #$75655F1F,d1 / bsr InternalErr2`.
 */
function itemAddress(menus: readonly IextMenu[], code: number): IextMenuItem | null {
  const mi = menuNum(code)
  const ii = itemNum(code)
  const si = subNum(code)
  if (mi === NOMENU || ii === NOITEM) return null
  const item = menus[mi]?.items[ii]
  if (!item) return null
  return si === NOSUB ? item : (item.subItems[si] ?? null)
}

/**
 * `GetMenu` --- pump the port, take one pick, and put it in the three words.
 *
 * `cmp.w #MENUNULL,d2 / beq .portok` sends an empty pick back round to pump
 * again rather than reporting it, so a menu opened and released over nothing
 * never reaches `=Ichoice`.
 *
 * The three words are filled from the STRUCTURE, walking `mi_Parent` up: a
 * subitem sets all three, an item sets `LastMenuSub` to 0 -- `dclr.w
 * LastMenuSub`, zero and not -1, so `Ichoice(3)` after an item answers 0
 * because the value is 0 rather than because nothing was picked.
 */
function getMenu(st: IextState, w: IextWindow): boolean {
  for (;;) {
    doEvent(st, IDCMP_MENUPICK)
    const pick = st.menuPicks.shift()
    if (pick === undefined) return false
    if (pick === MENUNULL) continue
    const hit = itemAddress(w.menus, pick)
    if (!hit) return false
    let item = hit
    if (hit.isSub) {
      st.lastMenuSub = hit.number
      item = w.menus.flatMap((m) => m.items).find((i) => i.subItems.includes(hit)) ?? hit
    } else {
      st.lastMenuSub = 0
    }
    st.lastMenuItem = item.number
    st.lastMenu = w.menus.find((m) => m.items.includes(item))?.number ?? 0
    return true
  }
}

/** one of the three `Last*` words, read and cleared as `=Ichoice` reads it */
function takeChoice(st: IextState, w: IextWindow, which: 1 | 2 | 3): number {
  const key = which === 1 ? 'lastMenu' : which === 2 ? 'lastMenuItem' : 'lastMenuSub'
  if (st[key] < 0) getMenu(st, w)
  const v = st[key]
  st[key] = -1
  // `tst.w d3 / bpl .exit2 / moveq #0,d3` --- -1 leaves as 0
  return v < 0 ? 0 : v
}

/* --------------------------------------------------------------------------
 * The requesters, `request.s` over reqtools.library
 * ----------------------------------------------------------------------- */

/**
 * `RT_Window`, or no window tag at all.
 *
 * Every requester in `request.s` builds the same three-way choice before it
 * calls: `dmove.l CurIwindow,d0 / bne .setwin`, then `dmove.l CurIscreen,d0 /
 * bne .setscr`, and failing both `addq.l #8,a0` walks PAST the RT_Window pair
 * so the tag list starts at RTFI_Flags. A requester with no window tag opens
 * on the default public screen, which is the Workbench.
 */
function reqSlot(st: IextState): number | null {
  if (st.currentWindow !== -1) {
    const w = st.currentIsWB
      ? st.wbWindows.get(st.currentWindow)
      : st.screens.get(st.current)?.windows.get(st.currentWindow)
    if (w) return w.screen === null ? WB_SLOT : (st.screens.get(w.screen)?.slot ?? WB_SLOT)
  }
  const scr = st.screens.get(st.current)
  return scr ? scr.slot : null
}

/**
 * `EZRequest` (`src2/intmisc.s`:94), the jump-table entry at `$d8` that all
 * three message keywords go through.
 *
 * It does four things `rtEZRequestA` does not. An empty gadget string is
 * error 13 before anything opens (`tst.b (a2) / beq IllFunc`). Every `|` in
 * the BODY becomes a newline, which is how an AMOS string carries more than
 * one line. A missing or empty title falls back to `DefReqTitle`. And the
 * answer is renumbered: reqtools gives the rightmost gadget 0, and the helper
 * turns that back into the gadget COUNT by walking the format for bars, so
 * what a program sees is 1 for the leftmost climbing to N for the rightmost.
 *
 * DEFECT: an empty BODY reaches `rtEZRequestA` as a pointer to whatever a5
 * held. `$8800 bmi.b $881e` skips the StrAlloc that sets a5, and `$8856
 * movea.l a5,a1` runs one instruction BEFORE `$8858 movea.l $911c(pc),a5`
 * re-establishes it, so the body text is read from the AMOS base register.
 * This port draws an empty body, which is what that address spells on a
 * machine where the first byte under a5 is zero.
 */
function startEz(rt: Runtime, st: IextState, title: string, body: string, gadgets: string, extra: number): void {
  if (gadgets === '') iError(E.IFC)
  st.ezFlags |= extra
  const setup: ReqSetup = {
    mode: REQ_MODE.EZREQUEST,
    body: body.split('|').join('\n'),
    gadgets,
    title: title === '' ? st.defReqTitle : title,
    flags: st.ezFlags,
    width: 0,
    // no RT_Underscore in the tag list, so reqtools leaves `underscore` at 0
    // and an underscore in a label is drawn rather than eaten
    underscore: '',
    defaultResponse: 1,
    min: RT_MININT,
    max: RT_MAXINT,
    minmax: false,
  }
  const args = { setup, buffer: '', maxLen: 0, value: 0, showDefault: true, allowEmpty: false, invisible: false }
  if (!rt.startRtRequest(args, reqSlot(st))) iError(E.NRT)
}

/** the helper's renumbering: 1 for the leftmost, the gadget COUNT for the rightmost */
function ezAnswer(rt: Runtime): number {
  const r = rt.rtReq
  if (!r) return 0
  const n = r.result === 0 ? r.layout.buttons.length : r.result
  rt.rtReq = null
  return n
}


/**
 * `rtfi_Dir` and the File gadget joined, which every one of the three file
 * keywords does by hand in its own copy of the same loop.
 *
 * `cmp.b #':',-1(a0) / beq .putfil / cmp.b #'/',-1(a0) / beq .putfil` and
 * then `move.b #'/',(a0)+`: a separator goes in unless the directory already
 * ends in one, and the AMOS length word is bumped by one when it does.
 */
function joinFreq(dir: string, name: string): string {
  if (dir === '') return name
  return dir.endsWith(':') || dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

/** the tag list `request.s` builds for `rtFileRequestA`, and the open */
function startFileReq(rt: Runtime, st: IextState, title: string, extra: number): void {
  const setup: FileReqSetup = {
    title,
    // no RTFI_OkText in the tag list, so the library's own ` _Ok ` stands
    okText: RT_TEXT.ok,
    underscore: '_',
    dir: st.freqDir ?? (rt.vfs?.currentDir ?? ''),
    pattern: st.freqPattern,
    file: st.freqFile,
    // `.tags dc.l RTFI_Flags,FREQF_PATGAD`, and the multi one ORs
    // FREQF_MULTISELECT into the same word
    flags: FREQF.PATGAD | extra,
    height: 0,
    hideInfo: false,
    // no RT_ReqPos in the tag list, so the prefs decide and that is
    // REQPOS_TOPLEFTSCR at 25, 18
    reqPos: RT_FILEREQ_PREFS.reqPos,
  }
  if (!rt.startRtFileRequest(setup, reqSlot(st))) iError(E.NRT)
}

/** the tag list `request.s` builds for `rtFontRequestA`, and the open */
function startFontReq(rt: Runtime, st: IextState, title: string): void {
  const setup: FontReqSetup = {
    title,
    okText: RT_TEXT.ok,
    underscore: '_',
    // `.tags dc.l RTFO_Flags,FREQF_SCALE` --- the one flag, and the guide's
    // own note on it is that scaling "works on Kickstart 2.0 only". Not
    // FREQF_STYLE, so there are no Bold/Italic/Underline gadgets, and not
    // FREQF_FIXEDWIDTH or FREQF_COLORFONTS, so every face is offered
    flags: FREQF.SCALE,
    height: 0,
    // `glob->sampleheight = 24` at `filereq.c`:104, and no RTFO_SampleHeight
    // tag to move it
    sampleHeight: 24,
    // `minsize` stays at the zero rtAllocRequestA left; `maxsize = MAXINT`
    minSize: 0,
    maxSize: RT_MAXINT,
  }
  if (!rt.startRtFontRequest(setup, st.fontReqName, st.fontReqSize, reqSlot(st))) iError(E.NRT)
}

/** the tag list `request.s` builds for `rtScreenModeRequestA`, and the open */
function startScreenReq(rt: Runtime, st: IextState, title: string): void {
  const setup: ScreenReqSetup = {
    title,
    okText: RT_TEXT.ok,
    underscore: '_',
    // `.tags dc.l RTSC_Flags,SCREQF_SIZEGADS|SCREQF_DEPTHGAD`, and the tag
    // list at `$5bfa` reads `80 00 00 28 00 00 60 00`. So there are Width,
    // Height and colour gadgets and no overscan cycle: the size a program
    // gets back is whatever the user typed or left, and the overscan type is
    // always 0, Regular Size
    flags: SCREQF.SIZEGADS | SCREQF.DEPTHGAD,
    height: 0,
  }
  if (!rt.startRtScreenRequest(setup, st.screenReq, reqSlot(st))) iError(E.NRT)
}

/**
 * `MODES equ HIRES | HAM | EHB | SUPERHIRES | LACED`, `defs.i`:170.
 *
 * $8000 | $0800 | $0080 | $0020 | $0004 is $88a4, which is the literal in
 * `$5ba6 and.w #$88a4,d0`. Church keeps the low half of the DisplayID and
 * throws the monitor away, so `=Ireq Scr Mode(0)` answers a ViewModes word
 * an `Iscreen Open` can be handed and `=Ireq Scr Mode(1)` answers the whole
 * id.
 */
const IEXT_MODES_MASK = 0x88a4

export function makeIextInstructions(rt: Runtime): Record<string, Instr> {
  return wrapTrapped(iextInstructions(rt))
}

/**
 * The spellings a program written before 1.3 still carries, and why they
 * have an underscore in them.
 *
 * AMOS stores a token NUMBER and the editor prints whatever the current
 * table calls it, so renaming an entry renames it in every program already
 * saved. Andrew Church used that: when 1.3 and 1.3b gave `Iscreen Open` and
 * most of the window keywords their spaced spellings, he did not delete the
 * old entries, he renamed them with an underscore and marked each one
 * `;Obsolete` in `itokens.s`. An old program keeps working and says so in
 * its own listing. The guide puts it plainly: *"you may notice an underscore
 * ("_") in a few command names. That indicates that a program was written
 * using an old version of the extension. The commands will function exactly
 * as expected, but unless you remove the underscore, you will not be able to
 * use any new features of the command."*
 *
 * Every pair below points at the same routines, checked entry by entry
 * against the binary's token table. The one place the guide's "new features"
 * bites is `Iwindow Open`: the old entries stop at the six-argument form and
 * the new ones carry a seventh for the flags. See `openIwindow`'s `legacy`.
 *
 * `i_creen` and `i_indow` look like typos and are not --- they are `=Iscreen`
 * and `=Iwindow` with the underscore put where it fits in a name that has no
 * space to take it.
 */
const IEXT_OBSOLETE: readonly (readonly [string, string])[] = [
  ['iscreen_open', 'iscreen open'],
  ['set_iscreen', 'set iscreen'],
  ['i_creen', 'iscreen'],
  ['iwindow_to front', 'iwindow to front'],
  ['iwindow_to back', 'iwindow to back'],
  ['iwindow_move', 'iwindow move'],
  ['iwindow_size', 'iwindow size'],
  ['iwindow_x', 'iwindow x'],
  ['iwindow_y', 'iwindow y'],
  ['iwindow_width', 'iwindow width'],
  ['iwindow_height', 'iwindow height'],
  ['iwindow_status', 'iwindow status'],
  ['set_iwindow', 'set iwindow'],
  ['i_indow', 'iwindow'],
]

function iextInstructions(rt: Runtime): Record<string, Instr> {
  const s = (): IextState => {
    iextState = rt.iext
    return rt.iext
  }

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
      scWidth: width,
      scHeight: height,
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
      idcmpFlags: IEXT_IDCMP,
      flags: WFLG_BORDERLESS | WFLG_BACKDROP,
      title: '',
      type: CUSTOMSCREEN,
      screenSlot: slot,
    })
    if (base) {
      scr.windows.set(0, {
        number: 0,
        screen: num,
        window: base,
        // `src2/screens.s`:370 --- `move.l #WEF_UNSET|WEF_BASEWIN,we_Flags(a0)`
        flags: WEF.UNSET | WEF.BASEWIN,
        title: '',
        menus: [],
        gadgets: [],
        hilitePen: 0,
        shadowPen: 0,
        screenTitle: '',
      })
    }
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

  const table: Record<string, Instr> = {
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

    /**
     * `Iscreen Display n,x,y,w,h` --- position and displayed size, all four
     * omittable, and the height arm reads the width register.
     *
     * `movem.l (a3)+,d2-d6` takes the five arguments in one instruction, so
     * d6 is n, d5 x, d4 y, d3 w and d2 h. Position first: an omitted x with
     * an omitted y skips MoveScreen entirely, otherwise the missing one
     * becomes a zero DELTA and the given one is floored at zero (`tst.w d5 /
     * bpl / moveq #0,d5`) and turned into a delta by `sub.w
     * sc_LeftEdge(a2),d5`. The guide adds what the code cannot say: *"NOTE:
     * Under Kickstart 1.3b, screens cannot be moved horizontally."*
     *
     * The width arm at $1fd0 is right --- MaxDispWidth, then `se_Width`,
     * then `sc_Width` and `vp_DWidth` both take d3.
     *
     * DEFECT: the height arm at $1ff0 is the width arm with one register
     * left behind. `cmp.w $12(a0),d3` checks the WIDTH against `se_Height`,
     * and `move.w d3,$46(a2)` writes the WIDTH into `vp_DHeight`. So
     * `Iscreen Display 1,,,,100` sets `sc_Height` to 100 and the displayed
     * height to ZERO --- d3 still holds AMOS's `Null`, $80000000, whose low
     * word is 0 --- and `Iscreen Display 1,,,320,100` displays 320 lines of
     * a screen 100 high. The 1.1a changelog claims *"Fixed Iscreen Display
     * bug which did not set the display width and height correctly"*: the
     * width half was fixed and this half shipped in every release after it.
     *
     * MaxDispWidth and MaxDispHeight are both $ffff here. `startup.s`:245 is
     * `cmpi.w #$24,$14(a6) / bcs` on intuition.library's version, and 2.0 or
     * over takes `moveq #-1,d0` into each; the 1.3 arm below it computes 449
     * and 311 off the ViewLord instead. So only the `se_` ceilings can fire,
     * error 13.
     */
    'iscreen display': (it) => {
      const st = s()
      const n = it.evalInt()
      it.expect(',')
      const x = omittable(it)
      it.expect(',')
      const y = omittable(it)
      it.expect(',')
      const w = omittable(it)
      it.expect(',')
      const h = omittable(it)
      const scr = findIscr(st, n)
      const sc = rt.screens.get(scr.slot)
      if (sc) {
        if (x !== null) sc.displayX = IEXT_VIEW_LEFT + Math.max(0, x)
        if (y !== null) sc.displayY = IEXT_VIEW_TOP + Math.max(0, y)
      }
      // d3's low word, which is zero when the width was left out
      const d3 = w === null ? 0 : w & 0xffff
      if (w !== null) {
        if (d3 > scr.width) iError(E.IFC)
        scr.scWidth = d3
        if (sc) sc.displayW = d3
      }
      if (h !== null) {
        if (d3 > scr.height) iError(E.IFC)
        scr.scHeight = h & 0xffff
        if (sc) sc.displayH = d3
      }
    },

    /**
     * `Iscreen Offset n,x,y` --- `ri_RxOffset` and `ri_RyOffset` of the
     * ViewPort's RasInfo, each kept when its argument is `Null`.
     *
     * Then MakeScreen, and then a MoveScreen of 0,0 the author labels
     * `;kludge` in the source --- a second rethink to make the new offset
     * take, which nothing here needs.
     */
    'iscreen offset': (it) => {
      const st = s()
      const n = it.evalInt()
      it.expect(',')
      const x = omittable(it)
      it.expect(',')
      const y = omittable(it)
      const sc = rt.screens.get(findIscr(st, n).slot)
      if (!sc) return
      if (x !== null) sc.offsetX = x
      if (y !== null) sc.offsetY = y
    },

    /**
     * `Iscreen Copy a To b` and `Iscreen Copy a,x1,y1,x2,y2 To b,x,y`.
     *
     * Routines 37 at $2382 and 36 at $22fc, ending in the same four
     * instructions: `move.b #$c0,d6 / moveq #-1,d7 / WaitBlit / BltBitMap`.
     * The short form takes its size from the SOURCE's `sc_Width` and
     * `sc_Height` at $23c0, which are the displayed size `Iscreen Display`
     * writes and not the bitmap's, so narrowing a screen's display narrows
     * what copying it whole moves.
     *
     * The DESTINATION is resolved first. It is the last argument pushed and
     * so the first popped, `move.l (a3)+,d0 / jtcall FindIscr` at $2398
     * before the source's at $23ae, which is what decides the error when
     * neither screen is open.
     */
    'iscreen copy': (it) => {
      const st = s()
      const c = copyArgs(it)
      const dst = iscrBitMap(rt, findIscr(st, c.b))
      const from = findIscr(st, c.a)
      const src = iscrBitMap(rt, from)
      if (!src || !dst) return
      if (c.whole) bltIscreen(src, 0, 0, dst, 0, 0, from.scWidth, from.scHeight, src.depth, dst.depth)
      else {
        const w = copySpan(c.x1, c.x2)
        const h = copySpan(c.y1, c.y2)
        bltIscreen(src, c.x1, c.y1, dst, c.dx, c.dy, w, h, src.depth, dst.depth)
      }
    },

    /**
     * `Amos Iscreen Copy a To b` --- an AMOS screen onto an Intuition one.
     *
     * Routines 43 and 42 build a `struct BitMap` in the extension's own data
     * zone at $224(a4) and point it at the AMOS screen: six plane pointers
     * copied out of `EcCurrent` whatever the depth, `bm_BytesPerRow` from
     * `EcTx` shifted right three (the source's own comment is *";AMOS screen
     * width always 16n"*), `bm_Rows` from `EcTy`, `bm_Flags` cleared, and
     * `bm_Depth` from `EcNPlan`. Copying it whole is `EcTx` by `EcTy`, the
     * AMOS screen's full size and not the Intuition one's.
     *
     * `EcCurrent` is the LOGICAL screen, so on a double-buffered screen this
     * copies the buffer the program has been drawing into rather than the
     * one on display.
     */
    'amos iscreen copy': (it) => {
      const st = s()
      const c = copyArgs(it)
      const dst = iscrBitMap(rt, findIscr(st, c.b))
      const from = findAscr(rt, c.a)
      const src = from.rp.bitMap
      if (!dst) return
      if (c.whole) bltIscreen(src, 0, 0, dst, 0, 0, from.width, from.height, src.depth, dst.depth)
      else {
        const w = copySpan(c.x1, c.x2)
        const h = copySpan(c.y1, c.y2)
        bltIscreen(src, c.x1, c.y1, dst, c.dx, c.dy, w, h, src.depth, dst.depth)
      }
    },

    /**
     * `Iscreen Amos Copy a To b` --- the same fence in the other direction,
     * and it moves nothing. See IEXT_AMOS_DEST_DEPTH for the instruction.
     *
     * Everything else about routines 45 and 44 is right: the temporary
     * BitMap is built the same way, the size for the whole-screen form comes
     * off the source Intuition screen's `sc_Width` and `sc_Height` at $27d2,
     * both screen numbers are checked, and the pair ends in an extra
     * `WaitBlit` the other four do not have, over the author's own reason
     * --- *"Need to call WaitBlit() after BltBitMap() because AMOS might
     * not"*.
     */
    'iscreen amos copy': (it) => {
      const st = s()
      const c = copyArgs(it)
      const to = findAscr(rt, c.b)
      const from = findIscr(st, c.a)
      const src = iscrBitMap(rt, from)
      if (!src) return
      const dst = to.rp.bitMap
      if (c.whole) {
        bltIscreen(src, 0, 0, dst, 0, 0, from.scWidth, from.scHeight, src.depth, IEXT_AMOS_DEST_DEPTH)
      } else {
        const w = copySpan(c.x1, c.x2)
        const h = copySpan(c.y1, c.y2)
        bltIscreen(src, c.x1, c.y1, dst, c.dx, c.dy, w, h, src.depth, IEXT_AMOS_DEST_DEPTH)
      }
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
    /** the pre-1.3 spellings, which have no flags argument. See IEXT_OBSOLETE. */
    'iwindow_open': (it) => openIwindow(rt, it, false, true),
    'iwindow_open wb': (it) => openIwindow(rt, it, true, true),

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
 
    /* ------------------------------------------------------------------
     * Drawing, text and colour
     *
     * `graphics.s` and `text.s`, both of which the makefile's INTSRC0 lists.
     * `output.s` defines five of these too and is NOT built; see the header.
     *
     * Every one of them opens with `jtcall GetCurRP` -- the CURRENT window's
     * RastPort, or the base window's when no window is selected -- so the
     * pens and the graphics cursor are per window and persist between
     * keywords.
     * ------------------------------------------------------------------ */

    /**
     * `Ilocate x,y` --- TEXT positioning, in character cells.
     *
     * `mulu tf_YSize` and `mulu tf_XSize` convert, and the y gets
     * `add.w tf_Baseline` on top so the cell's BASELINE is where the cursor
     * lands. Either may be left out. Unlike `Ilocate Gr` this one IS range
     * checked, and unconditionally: `bm_Rows / tf_YSize` and
     * `bm_BytesPerRow * 8 / tf_XSize` bound it, and over either is error 13.
     */
    'ilocate': (it) => {
      const { rp, w: iw } = curRp(rt, s())
      const x = omittable(it)
      it.expect(',')
      const y = omittable(it)
      const f = rp.font
      const xs = f ? f.xSize : 8
      const ys = f ? f.ySize : 8
      if (x !== null && (x < 0 || x >= Math.floor(rp.width / xs))) iError(E.IFC)
      if (y !== null && (y < 0 || y >= Math.floor(rp.height / ys))) iError(E.IFC)
      setGrPos(iw, rp, x === null ? null : x * xs, y === null ? null : y * ys + (f ? f.baseline : 6))
    },

    /** `Ilocate Gr x,y` --- graphics positioning, and nothing bounds it */
    'ilocate gr': (it) => {
      const { rp, w: iw } = curRp(rt, s())
      const x = omittable(it)
      it.expect(',')
      const y = omittable(it)
      setGrPos(iw, rp, x, y)
    },

    /** `Igr Writing n` --- SetDrMd, graphics.library's own numbering */
    'igr writing': (it) => {
      const { rp } = curRp(rt, s())
      rp.drawMode = it.evalInt() & 0xff
    },

    /**
     * `Iink fg[,bg[,ol]]` --- three routines, and they set three registers.
     *
     * `L_SetInk` writes `rp_AOLPen` DIRECTLY and calls SetBPen and SetAPen
     * for the other two, which is the same shape AMOS's own `Ink` has.
     */
    'iink': (it) => {
      const { rp } = curRp(rt, s())
      rp.fgPen = it.evalInt()
      if (it.accept(',')) rp.bgPen = it.evalInt()
      if (it.accept(',')) rp.aOlPen = it.evalInt()
    },

    /**
     * `Icls` and `Icls colour` --- SetRast on the SCREEN's base window.
     *
     * `GetCurIscr` then `se_BaseWin` then `wd_RPort`: it clears the whole
     * screen, not the current window. `Iclw` beside it is the one that clears
     * a window.
     */
    'icls': (it) => {
      const st = s()
      const { rp } = baseRp(rt, st)
      if (it.atStmtEnd()) {
        rp.setRast(0)
        return
      }
      const colour = it.evalInt()
      if (it.atStmtEnd()) {
        rp.setRast(colour)
        return
      }
      // `Icls colour,x1,y1 To x2,y2` -- RectFill between them, with the pen
      // put back afterwards (`move.b rp_FgPen(a0),d7` and a SetAPen at the
      // end). Backward coordinates are error 25 and checked before anything.
      it.expect(',')
      const [x1, y1, x2, y2] = rectTo(it)
      if (x2 < x1 || y2 < y1) iError(E.BWC)
      const save = rp.fgPen
      rp.fgPen = colour
      rp.rectFill(x1, y1, x2, y2)
      rp.fgPen = save
    },

    /**
     * `Iclw` and `Iclw colour` --- the current WINDOW's interior.
     *
     * The rectangle is the client area: `wd_BorderLeft` and `wd_BorderTop`
     * for the corner, and the width and height less the far borders.
     */
    'iclw': (it) => {
      const st = s()
      const { rp, ox, oy, w } = curRp(rt, st)
      const win = w.window
      const save = rp.fgPen
      const colour = it.atStmtEnd() ? 0 : it.evalInt()
      if (!it.atStmtEnd()) {
        it.expect(',')
        const [x1, y1, x2, y2] = rectTo(it)
        if (x2 < x1 || y2 < y1) iError(E.BWC)
        rp.fgPen = colour
        rp.rectFill(ox + x1, oy + y1, ox + x2, oy + y2)
        rp.fgPen = save
        return
      }
      rp.fgPen = colour
      rp.rectFill(
        ox + win.borderLeft,
        oy + win.borderTop,
        ox + win.width - win.borderRight - 1,
        oy + win.height - win.borderBottom - 1,
      )
      rp.fgPen = save
    },

    /** `Iplot x,y[,c]` --- SetAPen when a colour is given, then WritePixel */
    'iplot': (it) => {
      const { rp, ox, oy, w: iw } = curRp(rt, s())
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      if (it.accept(',')) rp.fgPen = it.evalInt()
      setGrPos(iw, rp, x, y)
      rp.plot(ox + x, oy + y)
    },

    /**
     * `Idraw x1,y1 To x2,y2` and `Idraw To x,y`.
     *
     * The second form starts where the cursor is, which is what makes
     * `Ilocate Gr` and a run of `Idraw To` a polyline.
     */
    'idraw': (it) => {
      const { rp, ox, oy, w: iw } = curRp(rt, s())
      const [x1, y1, x2, y2] = rectTo(it)
      rp.draw(ox + x1, oy + y1, ox + x2, oy + y2)
      setGrPos(iw, rp, x2, y2)
    },

    /**
     * `Idraw To x,y` --- its own keyword, spec `I0,0`, not a variant of the
     * one above.
     *
     * `L_IdrawTo` draws from where the cursor is, which is what makes
     * `Ilocate Gr` and a run of these a polyline.
     */
    'idraw to': (it) => {
      const { rp, ox, oy, w: iw } = curRp(rt, s())
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      rp.draw(ox + rp.cpX, oy + rp.cpY, ox + x, oy + y)
      setGrPos(iw, rp, x, y)
    },

    /** `Ibox x1,y1 To x2,y2` --- four sides, and backward is error 25 */
    'ibox': (it) => {
      const { rp, ox, oy, w: iw } = curRp(rt, s())
      const [x1, y1, x2, y2] = rectTo(it)
      if (x2 < x1 || y2 < y1) iError(E.BWC)
      rp.draw(ox + x1, oy + y1, ox + x2, oy + y1)
      rp.draw(ox + x2, oy + y1, ox + x2, oy + y2)
      rp.draw(ox + x2, oy + y2, ox + x1, oy + y2)
      rp.draw(ox + x1, oy + y2, ox + x1, oy + y1)
      setGrPos(iw, rp, x2, y2)
    },

    /** `Ibar x1,y1 To x2,y2` --- RectFill, filled */
    'ibar': (it) => {
      const { rp, ox, oy } = curRp(rt, s())
      const [x1, y1, x2, y2] = rectTo(it)
      if (x2 < x1 || y2 < y1) iError(E.BWC)
      rp.rectFill(ox + x1, oy + y1, ox + x2, oy + y2)
    },

    /** `Iellipse cx,cy,rx,ry` --- DrawEllipse, an outline */
    'iellipse': (it) => {
      const { rp, ox, oy } = curRp(rt, s())
      const cx = it.evalInt()
      it.expect(',')
      const cy = it.evalInt()
      it.expect(',')
      const rx = it.evalInt()
      it.expect(',')
      const ry = it.evalInt()
      rp.ellipse(ox + cx, oy + cy, rx, ry)
    },

    /** `Icircle cx,cy,r` --- `L_Icircle` falls into `L_Iellipse` with r twice */
    'icircle': (it) => {
      const { rp, ox, oy } = curRp(rt, s())
      const cx = it.evalInt()
      it.expect(',')
      const cy = it.evalInt()
      it.expect(',')
      const r = it.evalInt()
      rp.ellipse(ox + cx, oy + cy, r, r)
    },

    /**
     * `Itext [x],[y],s$` --- position, then graphics.library's Text.
     *
     * `bsr L_IlocateGr` between the two, so the coordinates are GRAPHICS ones
     * and either may be left out. `y` is therefore a baseline, not a top.
     */
    'itext': (it) => {
      const { rp, ox, oy, w: iw } = curRp(rt, s())
      const x = omittable(it)
      it.expect(',')
      const y = omittable(it)
      it.expect(',')
      const text = str(it.evalExpr())
      setGrPos(iw, rp, x, y)
      winText(rp, ox, oy, text)
    },

    /**
     * `Set Icolour n,c` --- and the `Set` is typed, not a convention.
     *
     * `itokens.s`:281 spells the token `"set icolou",$80+'r',"I0,0"`, so the
     * instruction and the `=Icolour(n)` beside it are two different words
     * and not one name in two positions. This port had the handler under the
     * bare name for a while, which made `Icolour 1,$f00` --- a function in
     * statement position, and a syntax error on the machine --- work.
     */
    'set icolour': (it) => setIcolour(rt, s(), it),

    /** `Iget Sprite Palette [mask]`, and the mask form loads it backwards */
    'iget sprite palette': (it) => iGetBankPalette(rt, s(), it, false),
    /** `Iget Icon Palette [mask]` --- routines 55 and 56, bank 2 */
    'iget icon palette': (it) => iGetBankPalette(rt, s(), it, true),

    /** `Ipaste Icon x,y,n` --- routine 204 */
    'ipaste icon': (it) => iPasteIcon(rt, s(), it),

    /** `Iget Icon [screen[,window],]n,x1,y1 To x2,y2` --- routines 283 to 286 */
    'iget icon': (it) => iGetIcon(rt, s(), it),

    /** `Iwrite s$` and `Iwrite` --- routines 181 and 182 */
    'iwrite': (it) => iWrite(rt, s(), it.atStmtEnd() ? '' : str(it.evalExpr())),

    /**
     * `Set Iwindow Title [n],[win$],[scr$]` --- SetWindowTitles, and each of
     * the three may be left out.
     *
     * An omitted title becomes `moveq #-1,d5`, which is what SetWindowTitles
     * reads as "leave this one alone"; an EMPTY string becomes zero, which
     * clears it. An omitted window is `dmove.l CurIwindow,d3 / beq L_NoWin`,
     * the variable and not GetCurIwin, so no current window is error 6 rather
     * than the backdrop.
     *
     * DEFECT: only the window number can actually be left out. The spec is
     * "I0,2,2" and `Ope_Fin2` (+Verif.s:2768) types an empty slot as "0", so
     * `Set Iwindow Title 1,,` meets `cmp.b d0,d1 / bne VerType` in VerC and is
     * a Type mismatch. The -1 arm of both title arguments is unreachable from
     * source, and the handler keeps it because the ROUTINE has it.
     *
     * NOTE: the copies are `jtcall StrAlloc` and nothing frees the ones they
     * replace. `Set Iscreen Title` next door does free its old title, so
     * this is the pair disagreeing rather than a rule.
     */
    'set iwindow title': (it) => {
      const st = s()
      const n = omittable(it)
      it.expect(',')
      const winTitle = omittableStr(it)
      it.expect(',')
      const scrTitle = omittableStr(it)
      const target = n === null ? curIwinRaw(st) : findIwin(st, n)
      if (winTitle !== null) {
        target.title = winTitle
        target.window.title = winTitle
      }
      if (scrTitle !== null) target.screenTitle = scrTitle
    },

    /**
     * `Set Iscreen Title s$` and `Set Iscreen Title s$,n`, and the token
     * table hands each one to the other's routine.
     *
     * DEFECT: `itokens.s`:709 is `dc.w L_SetIscrTitle` under `"!set iscreen
     * titl",$80+'e',"I2"` and `dc.w L_SetCurIscrTitle` under `$80,"I2,0"`,
     * and the binary's token table says the same --- the one-string spelling
     * dispatches to routine 46, which opens `move.l (a3)+,d0 / jtcall
     * FindIscr`, and the string-and-number spelling to routine 47, which
     * opens `jtcall GetCurIscr` and then takes ONE argument as a string
     * pointer. The `=Iscreen Title Height` pair three lines below is written
     * the same way and is the right way round, which is what makes this a
     * slip rather than a convention.
     *
     * So `Set Iscreen Title "x"` hands the string's ADDRESS to FindIscr. No
     * screen is numbered that, and the keyword is error 16.
     *
     * DEFECT: and routine 47 could not have worked anyway. `moveq #$1,d0` at
     * $290a has no `bra` after it, so the arm that allocated and stored the
     * title falls straight into `.none` --- `movea.l d6,a0 / clr.l $1a(a0) /
     * moveq #$0,d0` --- which clears `sc_DefaultTitle` again and calls
     * ShowTitle with zero. The string it just allocated is leaked, and the
     * current screen ends with no title and a hidden bar however it was
     * called. That is what the two-argument spelling does here: the number
     * is read as the string pointer and never as a screen, so screen n is
     * untouched.
     *
     * DEFECT: routine 46, the one the short spelling reaches, has its own.
     * `$2878 movea.l d6,a0` is dead and `$287a clr.l $1a(a1)` clears through
     * a1, which nothing on that path loaded --- so an EMPTY title on a named
     * screen writes four zero bytes wherever a1 was pointing. Unreachable
     * through the swapped token and recorded rather than reproduced: there
     * is no a1 here to write through.
     */
    'set iscreen title': (it) => {
      const st = s()
      // evaluated and then thrown away by whichever routine it reaches
      str(it.evalExpr())
      // routine 46, handed the string's address where a screen number goes
      if (!it.accept(',')) iError(E.SNO)
      // routine 47, which reads the number as a string pointer and then ends
      // at `.none` whichever way it came in
      it.evalInt()
      curIscr(st).title = ''
    },

    /**
     * `Ipalette` --- and it does nothing at all.
     *
     * `color.s` carries the real one behind `ifne 0` with the author's own
     * reason above it: "Ipalette disabled because it's unstable." What
     * shipped is `L_Ipalette0`, "just a stub", and the binary agrees to the
     * byte: routine 52 is two bytes long and they are an `rts`.
     *
     * So a program calling it is not refused and is not obeyed either, which
     * is what the extension does and what this does.
     */
    'ipalette': (it) => {
      // the spec is `I0`, so an argument is still parsed and dropped
      while (!it.atStmtEnd()) {
        it.evalInt()
        if (!it.accept(',')) break
      }
    },

    /**
     * `Icentre s$` --- centred across the WINDOW's full width.
     *
     * `move.w wd_Width(a2),d0 / sub.w d1,d0 / lsr.w #1,d0` with d1 the
     * TextLength, and the y goes in as `#Null` so the line the cursor is
     * already on is the one it lands on.
     */
    'icentre': (it) => {
      const { rp, ox, oy, w } = curRp(rt, s())
      const text = str(it.evalExpr())
      const x = (w.window.width - rp.textLength(text)) >> 1
      setGrPos(w, rp, x, null)
      winText(rp, ox, oy, text)
    },

    /**
     * `Set Ifont name$,size` --- OpenFont, else OpenDiskFont, else error 15.
     *
     * Routine 109. The size is popped FIRST and the name second, which is the
     * parameter block being walked backwards; the token spec declares them
     * the other way round.
     *
     * The old face is closed AFTER the new one is set, and `rp_RP_User` is
     * where the pointer to close is kept between calls -- `move.l
     * rp_Font(a2),rp_RP_User(a2)` on the way out. Nothing here refcounts a
     * face, so that half leaves no trace.
     */
    'set ifont': (it) => {
      const first = str(it.evalExpr())
      if (it.accept(',')) {
        const size = it.evalInt()
        curRp(rt, s()).rp.font = openIfont(rt, first, size)
        return
      }

      /*
       * `Set Ifont namesize$` --- and it cannot work.
       *
       * Routine 110 splits "fontname/NNN" at the LAST '/', builds the name
       * into a fresh string and pushes it back for routine 109. The guide
       * sells the pairing: *"This is useful in conjunction with Irequest
       * Font"*, whose own node promises the "fontname/size" this parses.
       *
       * DEFECT: the string it pushes is not the string it built. `lea.l
       * $3e5e(pc),a1` sets up the RSControl, `jsr $c8(a6)` is GetRetStr, and
       * `move.l a1,-(a7)` at $3e30 saves a1 believing the new string is in
       * it. GetRetStr answers in d0 and a0. a1 by then is `$a4(a4)`, left
       * there by StrAlloc's `lea.l $a4(a4),a1` at $89e8 -- and nothing puts
       * it back, because `pstart2`/`ret2` (macros2.i:3, :8) save a4 and a6
       * and `jtcall` (macros.i:129) saves a6. So `move.l (a7)+,-(a3)` at
       * $3e42 hands routine 109 the address of `FirstString` in the data
       * zone. Routine 109 reads its length word out of the high half of a
       * heap pointer and its characters out of whatever follows.
       *
       * A second bug underneath it, which decides the same outcome on its
       * own: `move.w d5,(a1)+` writes the WHOLE original length into the new
       * string, not the `d6` name length the allocation was sized for. Even
       * with the right pointer the name would still be "topaz/8", the '/' and
       * the digits included.
       *
       * Either way OpenFont and OpenDiskFont both fail and `L_NoFont` raises
       * 15. That is the outcome this reproduces. The two range checks that
       * run BEFORE the bug still decide their own errors: no '/' at all, or a
       * non-digit after the last one, is `Rbeq routine 140` and `Rbmi routine
       * 140`, which is `L_IllFunc`.
       */
      const cut = first.lastIndexOf('/')
      if (cut < 0) iError(E.IFC)
      const digits = first.slice(cut + 1)
      // `.lp2` reads a byte before testing, so a trailing '/' tests the byte
      // past the string; nothing a font name can put there is a digit
      if (digits === '' || !/^[0-9]+$/.test(digits)) iError(E.IFC)
      iError(E.FNA)
    },
 
    /* ------------------------------------------------------------------
     * Input
     *
     * The extension keeps its OWN key and menu buffers -- `KeyBufPtr` and
     * `MenuBufPtr` with a `Next` pointer each -- and `Iclear` resets a
     * pointer rather than draining anything. This port has AMOS's queue
     * instead, so a clear drains it; the observable is the same and the note
     * says which.
     * ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------
     * Menus
     *
     * The extension builds Intuition's own Menu and MenuItem structures by
     * hand and hands the chain to SetMenuStrip, rather than going through
     * gadtools. `defs.i`:26-31 puts its own numbers on the end of both, so a
     * program keeps its numbering and Intuition keeps its positions.
     * ------------------------------------------------------------------ */

    /**
     * `Set Imenu s$,menu[,item[,sub]]` --- define one entry, or free it.
     *
     * Three token entries, one body: `clr.l -(a3) / bra` pushes a zero for
     * each level the program left off. An EMPTY string frees the structure
     * instead of making one, and freeing a menu takes its items with it
     * (`FreeImenu` loops `mi_NextItem` calling `FreeImenuItem`).
     *
     * The geometry is fixed at creation and never laid out again. A menu is
     * `(len << 3) + 8` wide and 10 tall and starts 8 pixels right of the
     * previous one; an item is `(len << 3) + 4` wide and `2 + rp_TxHeight`
     * tall and sits directly under the previous one; a subitem starts 8
     * pixels left of its parent's right edge. "Previous" is the node this one
     * is inserted AFTER in number order, so defining menu 3 before menu 1
     * leaves menu 1 at the far left with 3 already sitting on top of it.
     *
     * The item's pens come off the RastPort the other way up --- `move.b
     * rp_BgPen(a0),it_FrontPen(a5)` and `move.b rp_FgPen(a0),it_BackPen(a5)`
     * --- so menu text is the window's colours inverted.
     *
     * A commented-out block at the top of `itokens.s` shows what this was:
     * `!imenu$` with spec `V20`, an assignable function with a matching
     * `s$=Imenu$(menu)` getter. The reader survived the cut. Routines 235,
     * 236 and 237 are `L_GetImenu` and its two trampolines, sitting in the
     * jump table between `Set Imenu`'s 234 and `Ichoice`'s 238 with no token
     * entry naming them, so no program can reach them.
     */
    'set imenu': (it) => {
      const st = s()
      const w = curIwin(st)
      const text = str(it.evalExpr())
      it.expect(',')
      const menuNo = it.evalInt()
      let itemNo = 0
      let subNo = 0
      if (it.accept(',')) {
        itemNo = it.evalInt()
        if (it.accept(',')) subNo = it.evalInt()
      }
      // `jtcall GetWinFlags / btst #WEB_MENUACTIVE,d0 / bne L_MenuActive`,
      // which is the first thing the routine does
      if (w.flags & WEF.MENUACTIVE) iError(E.MAA)
      // `tst.l d5 / beq` then three `cmp.l #n,dx / bhi`, all unsigned
      if (menuNo === 0 || (menuNo >>> 0) > 31 || (itemNo >>> 0) > 63 || (subNo >>> 0) > 31) iError(E.IFC)

      const menuHit = findSorted(w.menus, menuNo)
      const menu = menuHit.node
      if (!menu) {
        // not found, so the numbers below it must be zero
        if (itemNo !== 0 || subNo !== 0) iError(E.IFC)
      } else if (itemNo === 0) {
        if (subNo !== 0) iError(E.IFC)
      }
      const itemHit = menu && itemNo !== 0 ? findSorted(menu.items, itemNo) : null
      if (itemHit && !itemHit.node && subNo !== 0) iError(E.IFC)
      const subHit = itemHit?.node && subNo !== 0 ? findSorted(itemHit.node.subItems, subNo) : null

      const owner = subHit ? itemHit!.node!.subItems : itemHit ? menu!.items : null
      const node = subHit ? subHit.node : itemHit ? itemHit.node : menu
      const at = subHit ? subHit.at : itemHit ? itemHit.at : menuHit.at

      if (node) {
        // `.exists` --- unlink and free before anything is rebuilt
        if (!owner) {
          w.menus.splice(menuHit.at, 1)
        } else {
          const idx = owner.indexOf(node as IextMenuItem)
          /*
           * DEFECT: `.isitm2` picks the list head to write from `d2`, the
           * MENU, whichever list the node was actually in --- `movea.l d2,a1
           * / lea.l $12(a1),a1` and $12 is `mu_FirstItem`. That is right for
           * an item that is first in its menu and wrong for a SUBITEM that is
           * first under its parent, which wants `mi_SubItem` at $1c. So
           * deleting the first subitem of an item replaces the whole menu's
           * item list with that subitem's siblings, and the parent item is
           * left pointing at what was just freed.
           *
           * The create path does distinguish them --- `tst.w d7 / bne
           * .issub2` picks `mi_SubItem-mi_NextItem(a0)` --- so the two halves
           * of the same routine disagree.
           *
           * DEVIATION: on the machine the parent then walks into freed
           * memory. Here the subitem is simply still there.
           */
          if (idx > 0) owner.splice(idx, 1)
          else menu!.items = owner.slice(1)
        }
        // `tst.w (a5) / beq .exit` --- an empty string was a delete and stops
        if (text === '') return
      } else if (text === '') {
        return
      }

      // `.create`
      const font = curRp(rt, st).rp
      if (!menu || itemNo === 0) {
        const prev = w.menus[menuHit.at - 1]
        w.menus.splice(at, 0, {
          number: menuNo,
          name: text,
          leftEdge: prev ? prev.leftEdge + prev.width + 8 : 0,
          width: (text.length << 3) + 8,
          height: 10,
          items: menu ? menu.items : [],
        })
        return
      }
      const list = subNo !== 0 ? itemHit!.node!.subItems : menu.items
      const prev = list[at - 1]
      const parent = subNo !== 0 ? itemHit!.node! : null
      list.splice(at, 0, {
        number: subNo !== 0 ? subNo : itemNo,
        isSub: subNo !== 0,
        text,
        leftEdge: parent ? parent.leftEdge + parent.width - 8 : 0,
        topEdge: prev ? prev.topEdge + prev.height : 0,
        width: (text.length << 3) + 4,
        height: 2 + (font.font?.ySize ?? 0),
        frontPen: font.bgPen,
        backPen: font.fgPen,
        subItems: [],
      })
    },

    /**
     * `Imenu On` --- SetMenuStrip, and RMBTRAP off so Intuition gets the
     * right button.
     *
     * With no menus defined it does the opposite of what its name says:
     * `beq .nomenu` sets RMBTRAP, calls ClearMenuStrip and clears
     * WEF_MENUACTIVE, so turning menus on for a window that has none turns
     * them off.
     */
    'imenu on': () => {
      const st = s()
      const w = curIwin(st)
      if (w.menus.length === 0) {
        w.window.flags |= WFLG_RMBTRAP
        w.flags &= ~WEF.MENUACTIVE
        return
      }
      w.window.flags &= ~WFLG_RMBTRAP
      w.flags |= WEF.MENUACTIVE
    },

    /** `Imenu Off` --- RMBTRAP back on, ClearMenuStrip, and the flag down */
    'imenu off': () => {
      const st = s()
      const w = curIwin(st)
      w.window.flags |= WFLG_RMBTRAP
      w.flags &= ~WEF.MENUACTIVE
    },

    /* ------------------------------------------------------------------
     * The odds and ends of `other.s`
     * ------------------------------------------------------------------ */

    /**
     * `Iwait n` --- n frames, pumping the port on each.
     *
     * `.lp` is `DoEvent` with a class of 0 and then `WaitTOF`, `subq.l #1,d2`
     * until it runs out. Pumping matters: a wait is where a program's close
     * gadget gets noticed, the same way `=Iwindow Status` is.
     */
    'iwait': (it) => {
      const st = s()
      const n = it.evalInt()
      pumpStatus(st, curIwin(st))
      if (n > 0) it.block({ type: 'wait', until: it.tick + n })
    },

    /** `Iwait Vbl` --- `move.l #1,-(a3) / bra L_Iwait`, one frame */
    'iwait vbl': (it) => {
      const st = s()
      pumpStatus(st, curIwin(st))
      it.block({ type: 'wait', until: it.tick + 1 })
    },

    /**
     * `Ierror n` --- raise one of the extension's own errors by number.
     *
     * `move.l (a3)+,d0 / bra L_CustomError`, so it goes through exactly the
     * path an internal error does: it can be trapped, and it sets `LastError`
     * and `LastErrorStr` on the way.
     */
    'ierror': (it) => {
      iError(it.evalInt())
    },

    /**
     * `Itrap On` --- and it clears `ErrorTrapped` on the way in.
     *
     * `tmove.b #-1,TrapErrors` then `dclr.b ErrorTrapped`, so turning
     * trapping on forgets any error trapped before it.
     */
    'itrap on': () => {
      const st = s()
      st.trapErrors = true
      st.errorTrapped = false
    },
    /** `Itrap Off` --- `dclr.b TrapErrors`, and it leaves ErrorTrapped alone */
    'itrap off': () => {
      s().trapErrors = false
    },

    /**
     * `I Flush` --- `jtcall FlushRetStr`, and it is not safe to call.
     *
     * Every string an Intuition function returns comes from `GetRetStr`,
     * which allocates `len + 6` and keeps four of those bytes in front of the
     * AMOS string as a link. `FlushRetStr` walks that list and frees the lot.
     * The `.rsc` blocks the keywords pass it are zero bytes wide -- `defs.i`
     * has `RsReset` and then `rsc_sizeof equ __RS` with no fields between,
     * over the comment *"Currently empty, but kept in case we find a use for
     * it."*
     *
     * DEVIATION: the list is malformed, so the walk runs off the end of it.
     * `move.l $80fa(pc),d1 / beq.b $8122 / movea.l d1,a0` takes the CURRENT
     * head as the place to store the new block, and only an empty list gets
     * `lea.l $80fa(pc),a0`, the address of `RSList` itself. So the second
     * string sets `head->link = new` and `new->link = head`, a two-element
     * cycle that `RSList` still points into, and every string after that
     * replaces the second element and leaks the one it displaced.
     * `FlushRetStr` then frees the head, follows the link to the other block,
     * frees that, and follows ITS link back to memory exec has already taken
     * -- where `StrFree`'s `move.l -(a0),a1 / move.l -(a0),(a1)` writes a
     * word through whatever the free list left in the header.
     *
     * Nothing here allocates a string that way, so there is nothing to free
     * and no list to walk off.
     */
    'i flush': (it) => {
      // $1558's spec is "I0", so there is a cache number to read and drop
      it.evalInt()
    },

    /**
     * `Reserve Igadget [n]` --- routine 242 ($64e0), with 243 for the bare
     * form.
     *
     * Both start by freeing whatever the current window already had, so
     * reserving twice throws the first lot away; the bare form is only that
     * free. `cmp.l #$10000,d2 / bcc L_TooManyGads` is error 30, "Only 65535
     * gadgets allowed", and a negative count is error 13 before it.
     *
     * NOTE: the out-of-memory path frees the wrong size. The gadget array was
     * allocated `d2 * GADGETSIZE`, 98 bytes a slot, and `mulu #gg_sizeof,d2`
     * before the FreeMem asks for 44 -- so a failure to allocate the BORDER
     * array hands exec back less than half the block. Unreachable here, where
     * nothing runs out.
     */
    'reserve igadget': (it) => {
      const st = s()
      const w = curIwin(st)
      // the free comes first whatever happens next
      for (const g of w.gadgets) if (g) gadgetOff(rt, w, g)
      w.gadgets = []
      if (it.atStmtEnd()) return
      const n = it.evalInt()
      if (n < 0) iError(E.IFC)
      if (n >= 0x1_0000) iError(E.TMG)
      w.gadgets = new Array<IextGadget | null>(n).fill(null)
    },

    /**
     * `Set Igadget Toggle n,x,y,w,h[,state]` --- routine 245 ($675e) for the
     * short form, 244 ($6754) for the long one.
     *
     * A BOOLGADGET with TOGGLESELECT: it flips on the press and stays
     * flipped, and `=Igadget Read` hands back GFLG_SELECTED as a boolean.
     */
    'set igadget toggle': (it) => {
      const box = gadArgs(it, 5)
      const state = it.accept(',') ? it.evalInt() : 0
      makeBoolGad(rt, box, state !== 0, true)
    },

    /**
     * `Set Igadget Hit n,x,y,w,h` --- routine 246 ($6768).
     *
     * The same routine with `moveq #0,d1`, so no TOGGLESELECT: the gadget
     * shows SELECTED only while it is held, and what a program reads is a
     * COUNT of presses rather than a state. See `=Igadget Read`.
     */
    'set igadget hit': (it) => {
      makeBoolGad(rt, gadArgs(it, 5), false, false)
    },

    /** `Set Igadget Hslider n,x,y,w,h,units,pos,size,overlap` --- routine 248 ($69ca), into 247 ($6770) */
    'set igadget hslider': (it) => {
      makeSlider(rt, gadArgs(it, 9), false)
    },
    /** `Set Igadget Vslider ...` --- routine 249 ($69d0), `moveq #1,d0` into the same body */
    'set igadget vslider': (it) => {
      makeSlider(rt, gadArgs(it, 9), true)
    },

    /**
     * `Set Igadget String n,x,y,w,h,size[,init$[,strpos]]` --- routine 250
     * ($69d6), with 251 and 252 for the shorter forms.
     *
     * `strpos` is 0 for left, 1 for centred and 2 for right; anything else is
     * error 13. `size` is `si_MaxChars` and COUNTS the NUL, so the field
     * holds one character fewer than the number asked for. An initial string
     * longer than that is cut, and cut one shorter still: `cmp.w d2,d1 / bcs
     * .okilen / move.w d2,d1 / subq.w #1,d1`.
     */
    'set igadget string': (it) => {
      const box = gadArgs(it, 5)
      it.expect(',')
      const size = it.evalInt()
      if (size < 0 || size > 65534) iError(E.IFC)
      const init = it.accept(',') ? str(it.evalExpr()) : ''
      const pos = it.accept(',') ? it.evalInt() : 0
      makeStringGad(rt, box, { maxChars: size + 1, text: init, longInt: null, posArg: pos })
    },

    /**
     * `Set Igadget Int n,x,y,w,h[,init[,strpos]]` --- routine 253 ($6bf0),
     * with 255 and 256 for the shorter forms; 254 ($6e22) between them is
     * `L_gStringBorder`, which both types fall into.
     *
     * A STRGADGET with GACT_LONGINT, whose buffer is a flat twelve bytes:
     * "`-1234567890` plus trailing null" is the author's own comment, eleven
     * characters, which is exactly what `-2147483648` needs. That value gets
     * its own arm, `move.l #'-214',(a0)+` and two more longs, because the
     * digit loop would negate it back to itself.
     */
    'set igadget int': (it) => {
      const box = gadArgs(it, 5)
      const init = it.accept(',') ? it.evalInt() : 0
      const pos = it.accept(',') ? it.evalInt() : 0
      makeStringGad(rt, box, { maxChars: 12, text: String(init), longInt: init, posArg: pos })
    },

    /**
     * `Igadget On [n]` --- routine 257 ($6ffc) for one, 258 ($709a) for all.
     *
     * One gadget is AddGadget (-42) and RefreshGList (-432) and a gadget
     * already displayed is left alone. The all-form chains every DEFINED slot
     * that is not displayed into one list and AddGLists the lot; a window
     * with slots but none of them defined is error 33.
     */
    'igadget on': (it) => {
      const st = s()
      const w = curIwin(st)
      if (!it.atStmtEnd()) {
        gadgetOn(rt, w, gadDefined(w, it.evalInt()))
        return
      }
      if (w.gadgets.length === 0) iError(E.GNR)
      let any = false
      for (const g of w.gadgets) {
        if (!g) continue
        any = true
        gadgetOn(rt, w, g)
      }
      if (!any) iError(E.GND)
    },

    /**
     * `Igadget Off [n]` --- routine 259 ($7150) for one, 260 ($71e0) for all.
     *
     * RemoveGadget and then `ClearGadget`, which paints the gadget's box back
     * to the window's background: a gadget turned off leaves no trace. The
     * all-form walks the WINDOW's list looking for the first gadget whose
     * `ge_MagicID` is $BADF00D, so a window carrying gadgets from somewhere
     * else keeps them.
     */
    'igadget off': (it) => {
      const st = s()
      const w = curIwin(st)
      if (!it.atStmtEnd()) {
        gadgetOff(rt, w, w.gadgets[gadSlotIndex(w, it.evalInt())] ?? iError(E.GND))
        return
      }
      if (w.gadgets.length === 0) iError(E.GNR)
      for (const g of w.gadgets) if (g) gadgetOff(rt, w, g)
    },

    /**
     * `Igadget Active [n]` --- routine 261 ($7282) for one, 262 ($7308) for all.
     *
     * Clears GADGDISABLED and refreshes, which is how a ghosted gadget comes
     * back. A gadget that is not displayed is left disabled-or-not and not
     * refreshed, since there is nothing on screen to refresh.
     *
     * DEFECT: the all-form loops on an uninitialised register. `$7330 tst.w
     * $18(a0)` TESTS `we_NGadgets` and never loads it, and `$7366 dbra d7`
     * counts down whatever d7 held on entry -- so the walk runs a leftover
     * number of times, `andi.w #$feff,$c(a5)` clearing GADGDISABLED in
     * whatever lies past the end of the array. `Igadget Inactive` beside it
     * is the same routine with `$742e move.w $18(a0),d7` in that slot, which
     * is the instruction this one is missing. Both are then off by one
     * anyway: `dbra` with the COUNT rather than the count less one walks
     * `n + 1` slots, where every other loop in the file does `subq.w #1`
     * first.
     *
     * DEVIATION: there is no register left over here and nothing past the
     * array to write to, so both walks stop at the end of the array.
     */
    'igadget active': (it) => {
      const st = s()
      const w = curIwin(st)
      if (!it.atStmtEnd()) {
        const g = gadDefined(w, it.evalInt())
        g.gad.flags = (g.gad.flags ?? 0) & ~GFLG_GADGDISABLED
        rt.intuition.invalidate()
        return
      }
      if (w.gadgets.length === 0) iError(E.GNR)
      for (const g of w.gadgets) {
        if (!g?.displayed) continue
        g.gad.flags = (g.gad.flags ?? 0) & ~GFLG_GADGDISABLED
      }
      rt.intuition.invalidate()
    },

    /** `Igadget Inactive [n]` --- routines 263 ($7380) and 264 ($7406): GADGDISABLED, ghosted */
    'igadget inactive': (it) => {
      const st = s()
      const w = curIwin(st)
      if (!it.atStmtEnd()) {
        const g = gadDefined(w, it.evalInt())
        g.gad.flags = (g.gad.flags ?? 0) | GFLG_GADGDISABLED
        rt.intuition.invalidate()
        return
      }
      if (w.gadgets.length === 0) iError(E.GNR)
      for (const g of w.gadgets) {
        if (!g?.displayed) continue
        g.gad.flags = (g.gad.flags ?? 0) | GFLG_GADGDISABLED
      }
      rt.intuition.invalidate()
    },

    /**
     * `Set Ipens highlight,shadow` --- routine 267 ($7620).
     *
     * The two pens every gadget border is built from, kept on the WINDOW.
     * They are read when a gadget is MADE, so changing them afterwards
     * changes nothing already defined. Either argument may be omitted --
     * `cmp.l #Null,d7 / beq .shadow` -- and 0 to 255 is the legal range.
     */
    'set ipens': (it) => {
      const st = s()
      const w = curIwin(st)
      // "I0,0" with no variant, so both slots are always there and either may
      // be EMPTY: `Set Ipens 5,` and `Set Ipens ,1`
      const hi = omittable(it)
      it.expect(',')
      const sh = omittable(it)
      if (hi !== null) {
        if (hi < 0 || hi > 255) iError(E.IFC)
        w.hilitePen = hi
      }
      if (sh !== null) {
        if (sh < 0 || sh > 255) iError(E.IFC)
        w.shadowPen = sh
      }
    },

    /**
     * `Set Igadget Value n,v` --- routine 269 ($7706).
     *
     * A LONGINT string gadget takes the number and reformats its buffer; a
     * TOGGLESELECT boolean takes it as a boolean and does nothing when it is
     * already there; a hit-select boolean is error 13, "Can't set value of a
     * hit-select!" in the author's own comment. A slider takes it as a
     * position, clamped to `NUnits - KnobSize`.
     *
     * DEFECT: the slider arm passes the wrong two words as the body.
     * `$787c move.w $6(a0),d3` and `$7880 move.w $8(a0),d4` read from a0, the
     * GADGET, where pi_HorizBody and pi_VertBody are offsets into the
     * PropInfo in a2 -- so `$6(a0)` is gg_TopEdge and `$8(a0)` is gg_Width,
     * and NewModifyProp (-468) is handed a gadget's coordinates as knob
     * sizes. A body of 230 against MAXBODY's 65535 is a knob clamped to its
     * KNOBHMIN of six pixels, so the first `Set Igadget Value` on a slider
     * shrinks its knob to nothing and every one after that keeps it there.
     *
     * DEVIATION: the body is left as `Set Igadget Hslider` computed it. The
     * direction, at least, this arm asks correctly: `$78a0 moveq #$4,d7 /
     * and.w d0,d7` tests FREEVERT in pi_Flags, which is the field
     * `=Igadget Read` next door does NOT use.
     */
    'set igadget value': (it) => {
      const st = s()
      const w = curIwin(st)
      const n = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const g = gadDefined(w, n)
      const gad = g.gad
      if (gad.kind === GTYP_STRGADGET) {
        if (((gad.activation ?? 0) & GACT_LONGINT) === 0) iError(E.WGT)
        gad.strInfo!.longInt = v | 0
        gad.strInfo!.buffer = String(v | 0)
        gad.strInfo!.bufferPos = 0
      } else if (gad.kind === GTYP_PROPGADGET) {
        const room = g.units - g.knobSize
        if (room <= 0) return
        const pos = Math.min(room, Math.max(0, v))
        const pot = Math.min(MAXPOT, Math.trunc((pos * MAXPOT) / room))
        if ((gad.prop!.flags & FREEVERT) !== 0) gad.prop!.vertPot = pot
        else gad.prop!.horizPot = pot
      } else {
        if (((gad.activation ?? 0) & GACT_TOGGLESELECT) === 0) iError(E.IFC)
        const want = v !== 0 ? GFLG_SELECTED : 0
        if (((gad.flags ?? 0) & GFLG_SELECTED) === want) return
        gad.flags = ((gad.flags ?? 0) & ~GFLG_SELECTED) | want
      }
      rt.intuition.invalidate()
    },

    /**
     * `Set Igadget Value$ n,v$` --- routine 270 ($78c6).
     *
     * A STRGADGET without LONGINT, or error 32. The string is copied into
     * `si_Buffer` and cut to `si_MaxChars`, which is the size the gadget was
     * defined with.
     */
    'set igadget value$': (it) => {
      const st = s()
      const w = curIwin(st)
      const n = it.evalInt()
      it.expect(',')
      const v = str(it.evalExpr())
      const g = gadDefined(w, n)
      if (g.gad.kind !== GTYP_STRGADGET) iError(E.WGT)
      if (((g.gad.activation ?? 0) & GACT_LONGINT) !== 0) iError(E.WGT)
      const si = g.gad.strInfo!
      si.buffer = v.slice(0, Math.max(0, si.maxChars - 1))
      si.bufferPos = 0
      rt.intuition.invalidate()
    },

    'iclear all': () => {
      rt.input.keyQueue.length = 0
      s().menuPicks.length = 0
    },
    /** `Iclear Key` --- the key buffer only, and it leaves LastCode alone */
    'iclear key': () => {
      rt.input.keyQueue.length = 0
    },
    /** `Iclear Menu` --- the menu buffer only */
    'iclear menu': () => {
      s().menuPicks.length = 0
    },
    /**
     * `Irequest Error [title$,] s$ [,cancel$]` --- one gadget, no answer.
     *
     * Routine 226 and its two shorter forms. The one-argument version pushes
     * its own `dc.b 0,6,"Cancel"` at `$5e50`, which is the extension's word
     * and not reqtools' `_Cancel`: no underscore, so no shortcut on the C.
     * The gadget string is checked first and an empty one is error 13.
     *
     * The result is thrown away, which is what makes this an instruction
     * where `Irequest Message` is a function. With one gadget there is
     * nothing to learn from the answer anyway.
     */
    'irequest error': (it) => {
      const st = s()
      // the arguments are parsed FIRST, even on a resume: `it.block(..., true)`
      // re-runs the statement, and a handler that returned early would leave
      // its own tokens unread
      const a: string[] = []
      while (!it.atStmtEnd()) {
        a.push(str(it.evalExpr()))
        if (!it.accept(',')) break
      }
      if (rt.rtReq) {
        if (rt.rtReq.done) {
          rt.rtReq = null
          return
        }
        it.block({ type: 'rtreq' }, true)
        return
      }
      const title = a.length >= 3 ? a[0]! : ''
      const body = a.length >= 3 ? a[1]! : (a[0] ?? '')
      const cancel = a.length >= 3 ? a[2]! : a.length === 2 ? a[1]! : 'Cancel'
      startEz(rt, st, title, body, cancel, EZREQF.LAMIGAQUAL)
      it.block({ type: 'rtreq' }, true)
    },

    /**
     * `Irequest Def Title title$` --- routine 231.
     *
     * An empty string is meant to put "AMOS Request" back and does not:
     * `$5f16 lea.l $42(a4),a2` takes the address of the pointer CELL rather
     * than the pointer in it. See `IextState.defReqTitle` for the whole of
     * it. Reproduced, so a program that clears the title gets the blank bar
     * a real one gets.
     */
    'irequest def title': (it) => {
      s().defReqTitle = str(it.evalExpr())
    },

    /**
     * `Iclear Mouse` --- nothing at all.
     *
     * `L_IbufResetMouse` is one instruction, an `rts`, and Andrew Church
     * labelled it himself: "Iclear Mouse - now a no-op". There was a mouse
     * buffer once and there is not any more.
     */
    'iclear mouse': () => {},

    /**
     * `Iwait Key` --- `.lp` until `GetKey` answers something.
     *
     * A poll and a block, which is what the `.lp` loop is: the keyword
     * re-runs each frame until a key is there. `runHeadless` breaks it, since
     * nothing is going to press one.
     */
    'iwait key': (it) => {
      const st = s()
      if (rt.input.keyQueue.length > 0) {
        takeKey(rt, st)
        return
      }
      if (st.headlessWake) {
        st.headlessWake = false
        return
      }
      it.block({ type: 'ievent' }, true)
    },

    /** `Iwait Mouse` --- the same shape over `GetMouse` */
    'iwait mouse': (it) => {
      const st = s()
      if ((rt.input.mouseK & 3) !== 0) return
      if (st.headlessWake) {
        st.headlessWake = false
        return
      }
      it.block({ type: 'ievent' }, true)
    },
  }
  for (const [was, now] of IEXT_OBSOLETE) if (table[now]) table[was] = table[now]!
  return table
}

export function makeIextFunctions(rt: Runtime): Record<string, Func> {
  return wrapTrapped(iextFunctions(rt))
}

function iextFunctions(rt: Runtime): Record<string, Func> {
  const s = (): IextState => rt.iext

  const table: Record<string, Func> = {
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
     * are `IsAGA` and `IsECS` in `data.i`. Where they are SET is
     * `src2/startup.s`:324-337, and it is not what the keyword's own comment
     * says --- that comment claims it "checks SysBase->lib_Version >= 39.
     * There must be a better way!" and the code found the better way without
     * anyone going back to the comment:
     *
     *     moveq #GFXF_HR_AGNUS|GFXF_HR_DENISE,d1
     *     move.b d1,d0 / and.b gb_ChipRevBits0(a0),d0
     *     cmp.b d0,d1 / seq d0            ;"Need both ECS chips for an ECS system"
     *     tmove.b d0,IsECS
     *     or.b  #GFXF_AA_ALICE|GFXF_AA_LISA,d1
     *     move.b d1,d0 / and.b gb_ChipRevBits0(a0),d0
     *     cmp.b d0,d1 / seq d0
     *     tmove.b d0,IsAGA
     *
     * So `IsAGA` requires all FOUR chip bits, the two ECS ones included ---
     * which means AGA IMPLIES ECS here, and both are true together on any
     * machine that has AA. The whole thing sits behind `dtst.b WB20`, so a
     * machine below Kickstart 2.0 leaves both at zero, which is the "returns
     * False on all others" the `=Ecs` comment promises.
     *
     * The bit VALUES are not needed and not held: nothing in the corpus
     * defines GFXF_HR_AGNUS. What decides the answer is the machine, and that
     * is settled elsewhere --- ./jd.ts's A1200 with `Jd Chipset` answering 2
     * for AA, and ./guistate.ts's Kickstart 40.
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

    /**
     * `=X Ihard(x)`, `=X Iscreen(x)`, `=Y Ihard(y)`, `=Y Iscreen(y)` --- a
     * resolution shift on the CURRENT screen, and nothing else in them.
     *
     * `move.w sc_ViewPort+vp_Modes(a0),d1` then `moveq #SUPERHIRES,d2` and
     * `move.w #HIRES,d2`: superhires shifts two, hires one, lores none, and
     * the Y pair test LACED on its own. The offset added afterwards is the
     * ViewLord's `v_DxOffset` at $e(a1) and `v_DyOffset` at $c(a1), which
     * `=X Hard Min` already answers 0 for on a machine with no Overscan
     * preference to move them.
     *
     * The screen's own `sc_LeftEdge` is not in it. A screen `Iscreen
     * Display` has moved still converts as though it sat at the display's
     * top-left corner, so the pair round-trips and neither end is where the
     * screen is.
     *
     * All four are `.w` arithmetic in a register the argument arrived in as
     * a longword, and d3 goes back whole: `=X Ihard(-2)` on a hires screen
     * is not -1 but -32769, `$fffe` shifted to `$7fff` under an untouched
     * high word of `$ffff`.
     */
    'x ihard': (_, a): Value => {
      const mode = curIscr(s()).mode
      const by = (mode & MODE_KEY.SUPERHIRES) !== 0 ? 2 : (mode & MODE_KEY.HIRES) !== 0 ? 1 : 0
      return VI(wordOp(int(a[0]!), (lo) => lo >>> by))
    },
    'x iscreen': (_, a): Value => {
      const mode = curIscr(s()).mode
      const by = (mode & MODE_KEY.SUPERHIRES) !== 0 ? 2 : (mode & MODE_KEY.HIRES) !== 0 ? 1 : 0
      return VI(wordOp(int(a[0]!), (lo) => lo << by))
    },
    'y ihard': (_, a): Value => {
      const laced = (curIscr(s()).mode & MODE_KEY.LACE) !== 0
      return VI(wordOp(int(a[0]!), (lo) => (laced ? lo >>> 1 : lo)))
    },
    'y iscreen': (_, a): Value => {
      const laced = (curIscr(s()).mode & MODE_KEY.LACE) !== 0
      return VI(wordOp(int(a[0]!), (lo) => (laced ? lo << 1 : lo)))
    },

    /** `=Iscreen` --- `se_ScrNum` of the current screen */
    iscreen: (): Value => VI(curIscr(s()).number),

    /**
     * `=Iscreen Title Height` and `=Iscreen Title Height(n)` --- `moveq #0,d3
     * / move.b sc_BarHeight(a0),d3`, and the pair is spelled the right way
     * round where `Set Iscreen Title`'s is not.
     *
     * Ten, and it does not move: ShowTitle takes the bar out of the view and
     * leaves the field alone, so a screen with no title answers the same as
     * one with. The guide's use for it is `Text 0,Iscreen Title Height+Itext
     * Base,"Text right below the title bar"`.
     */
    'iscreen title height': (_, a): Value => {
      // the lookup is the only thing that can fail: error 16 for a screen
      // that is not open, and `GetCurIscr` for the bare form
      pick(s(), a)
      return VI(IEXT_BAR_HEIGHT)
    },

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
      return VI(pumpStatus(s(), w) & (WEF.CLOSED | WEF.MENUACTIVE))
    },
    /**
     * `=Icolour(n)` --- GetRGB4 off the current screen's ColorMap.
     *
     * `move.l d0,d3 / bmi L_IllFunc`: GetRGB4 answers -1 for an index the map
     * does not have, and the routine turns that into error 13 rather than
     * passing it back.
     */
    'icolour': (_, a): Value => {
      const st = s()
      const scr = curIscr(st)
      const pal = rt.screens.get(scr.slot)?.palette
      const n = int(a[0]!)
      if (!pal || (n >>> 0) >= colourMapCount(scr)) iError(E.IFC)
      return VI(pal[n]! & 0x0fff)
    },

    /**
     * `=Ipoint(x,y)` --- ReadPixel, bounded by the WINDOW rather than the
     * screen.
     *
     * `move.w wd_Width(a0),d2` and `wd_Height` are the limits, and both
     * comparisons are `bcc` --- unsigned, so a negative coordinate is a very
     * large one and fails the same way.
     */
    'ipoint': (_, a): Value => {
      const st = s()
      const { rp, ox, oy, w } = curRp(rt, st)
      const x = int(a[0]!)
      const y = int(a[1]!)
      if ((y >>> 0) >= w.window.height || (x >>> 0) >= w.window.width) iError(E.IFC)
      return VI(rp.point(ox + x, oy + y))
    },

    /** `=Ixgr` and `=Iygr` --- `rp_cp_x` and `rp_cp_y`, the graphics cursor */
    'ixgr': (): Value => VI(curRp(rt, s()).rp.cpX),
    'iygr': (): Value => VI(curRp(rt, s()).rp.cpY),

    /**
     * `=Itext Base` --- `tf_Baseline` of the current RastPort's font.
     *
     * How far below the top of the line the baseline sits, which is the
     * number `Itext` needs to place a string by its top instead: topaz 8
     * answers 6.
     */
    'itext base': (): Value => VI(curRp(rt, s()).rp.font?.baseline ?? 0),

    /**
     * `=Itext Length(s$)` --- graphics.library's TextLength, in pixels.
     *
     * Measured in the CURRENT font, and it measures rather than draws, so a
     * proportional face gives a different answer per string.
     */
    'itext length': (_, a): Value => VI(curRp(rt, s()).rp.textLength(str(a[0]!))),

    /**
     * `=Ifont$` --- the face's own name, `.font` and all.
     *
     * `move.l rp_Font(a0),a0 / move.l 10(a0),a0`, and 10 is
     * `tf_Message+MN_NODE+LN_NAME`: a TextFont opens with an exec Message, so
     * the name is the Node's. It is the name the font was OPENED under, which
     * is why it comes back with the extension on it.
     */
    'ifont$': (): Value => VS(curRp(rt, s()).rp.font?.name ?? ''),

    /**
     * `=Ifont Base` --- `move.l rp_Font(a0),d3`, the TextFont pointer itself.
     *
     * DEVIATION: a real address into graphics.library's font, for a program
     * that wants to Peek the glyph data. This port has no such memory, so the
     * number is stable and unique per face and points at nothing.
     */
    'ifont base': (): Value => {
      const f = curRp(rt, s()).rp.font
      return VI(f ? fontAddr(f) : 0)
    },

    /** `=Ifont Height` --- `tf_YSize`, the size the face was opened at */
    'ifont height': (): Value => VI(curRp(rt, s()).rp.font?.ySize ?? 0),
    /**
     * `=Iread Char$` --- one key, and it waits for it.
     *
     * Routine 126 ($41f8) is `.lp jtcall GetKey / bne .endlp / gfxcall
     * WaitTOF / bra .lp`, so the program stops until something is pressed. It
     * tests nothing about what came back: `dlea String1,a0 / move.b d0,2(a0)`
     * puts the character into a one-long AMOS string whatever it is, so a key
     * `ConvRawKey` had nothing for --- a cursor key, an F-key --- answers
     * Chr$(0) rather than waiting for a real one. `=Iread Str$` and `=Iread
     * Int` treat that same zero as a cancel; this one hands it back.
     */
    'iread char$': (it): Value => readKeyword(rt, s(), it, 'char'),

    /**
     * `=Iread Str$` --- a line editor in 100 instructions.
     *
     * Routine 127 ($4256) keeps the line on the stack, 256 bytes at a time,
     * and echoes every character it accepts through the CURRENT RastPort with
     * `Text`. Return (13) or Linefeed (10) end it, backspace (8) walks one
     * character back and XORs it away, and a zero character cancels to the
     * empty string. Nothing else is filtered, so a Tab or an Escape goes into
     * the line and is drawn.
     *
     * NOTE: it writes at the graphics cursor and never moves the LINE. There
     * is no wrap and no scroll, so a line longer than the window draws off
     * the right-hand edge and keeps going.
     */
    'iread str$': (it): Value => readKeyword(rt, s(), it, 'str'),

    /**
     * `=Iread Int` --- the same editor over a number, with three bases.
     *
     * Routine 128 ($4394). A leading `-` and then `%` for binary or `$` for
     * hex, each accepted only while the value is still zero, and then digits
     * bounded by IEXT_READINT_MAX. Backspace unwinds the value one digit at a
     * time by dividing, and once it reaches zero it takes the radix mark and
     * then the sign.
     */
    'iread int': (it): Value => readKeyword(rt, s(), it, 'int'),

    /**
     * `=Iscan` and `=Ishift` --- `LastCode` and `LastQual`.
     *
     * What the last key TAKEN out of the buffer was, raw. `Iclear Key` resets
     * the buffer pointer and does not touch either, so they outlive a clear.
     */
    iscan: (): Value => VI(s().lastCode),
    /** `=Ierr` --- `LastError`, set by every error trapped or raised */
    ierr: (): Value => VI(s().lastError),

    /**
     * `=Ierr$` --- the message, and reading it TURNS TRAPPING OFF.
     *
     * `dclr.b TrapErrors` sits between the empty test and the return, so
     * asking what went wrong stops the next thing going wrong from being
     * caught. Church's own idiom pairs it with `Itrap On` again.
     *
     * DEFECT: the `bmi L_NoErrStr` after it is DEAD. `dclr` is `clr.b`
     * (`macros.i`:32), which leaves N clear, so the branch can never be
     * taken and error 22, "Error text not available", is unreachable from
     * here. The binary shipped it: `clr.b $1d(a4)` and then `Rbmi routine
     * 161`, two instructions apart.
     */
    'ierr$': (): Value => {
      const st = s()
      if (st.lastErrorStr === '') return VS('')
      st.trapErrors = false
      return VS(st.lastErrorStr)
    },

    /**
     * `=Ierrtrap` --- did something get trapped, and forget it.
     *
     * `dmove.b ErrorTrapped,d3` and then `dclr.b ErrorTrapped`, so it is a
     * read-and-clear: asking twice answers -1 and then 0.
     */
    ierrtrap: (): Value => {
      const st = s()
      const was = st.errorTrapped
      st.errorTrapped = false
      return VI(was ? -1 : 0)
    },

    /**
     * `=Ichoice(level)` --- 1 for the menu, 2 for the item, 3 for the subitem.
     *
     * `subq.l #1,d0 / beq .menu` three times over, and a fourth value is
     * error 13. Each level is READ AND CLEARED on its own: the reader puts
     * -1 back, so the same pick answers once per level and a second ask gives
     * 0. A level still holding -1 pumps `GetMenu` first, which fills all
     * three at once, so the three calls can come in any order.
     */
    ichoice: (_, a): Value => {
      const st = s()
      const level = int(a[0]!)
      if (level < 1 || level > 3) iError(E.IFC)
      return VI(takeChoice(st, curIwin(st), level as 1 | 2 | 3))
    },

    /**
     * `=Irequest File$([title$ [,pattern$ [,default$] ] ])` --- routine 207,
     * and 208 to 210 for the shorter forms.
     *
     * The guide: "Pattern$ is a standard AmigaDOS wildcard to determine which
     * files are displayed in the requester.  Note that this differs from the
     * AMOS wildcard format; for example, AMOS's "**" (all files) pattern is
     * "#?" in AmigaDOS." ../amiga/dospattern.ts is that matcher.
     *
     * DEFECT: routine 207 carries thirty instructions meant to split a
     * DIRECTORY off the front of the pattern, and not one of them can run.
     * `$54d6 suba.l a1,a1` clears the register that remembers where the last
     * `:` or `/` was, and the guard on the only assignment is `$54ea move.l
     * a1,d0 / $54ec beq.b $54f0`, which skips it while a1 is zero. So a1 is
     * zero for ever, `$54f6 move.l a1,d0 / $54f8 beq.b $552a` always takes
     * the no-path arm, and the arm at `$54fc` that would set RTFI_Dir and
     * RTFI_MatchPat as a pair is compiled and unreachable. `bne` was meant.
     * The whole pattern goes in as RTFI_MatchPat instead, which matches
     * against bare filenames, so `Irequest File$("Load","df0:#?.iff")` shows
     * nothing at all. Reproduced. The guide never promised a path there,
     * which is why this survived.
     *
     * An omitted pattern leaves the LAST one in place rather than clearing
     * it: `.nopat` branches past the whole `rtChangeReqAttrA`.
     */
    'irequest file$': (it, a): Value => {
      const st = s()
      if (rt.rtFile) {
        if (!rt.rtFile.done) {
          it.block({ type: 'rtreq' }, true)
          return VS('')
        }
        const f = rt.rtFile
        rt.rtFile = null
        st.freqFile = f.result
        st.freqDir = f.dir
        // `tst.l d0 / beq .cancel` on the library's answer, and then
        // `dtst.b Filename108 / bne .gotfil` --- so Ok on an empty File
        // gadget is a cancel here too
        if (!f.ok || f.result === '') return VS('')
        return VS(joinFreq(f.dir, f.result))
      }
      const n = a.length
      const title = n >= 1 ? str(a[0]!) : ''
      const pat = n >= 2 ? str(a[1]!) : ''
      if (pat !== '') st.freqPattern = pat
      st.freqFile = n >= 3 ? str(a[2]!) : ''
      startFileReq(rt, st, title, 0)
      it.block({ type: 'rtreq' }, true)
      return VS('')
    },

    /**
     * `=Irequest File Multi$([title$ [,pattern$] ])` --- routine 211, with
     * 212 and 213 for the shorter forms.
     *
     * The same routine with FREQF_MULTISELECT added and the default filename
     * dropped, so the guide is right that "The parameters to Irequest File
     * Multi$ are the same as those to ... except that you cannot specify a
     * default filename." It opens with `rtFreeFileList` on the
     * previous answer, so a second call throws the first list away whether or
     * not `Irequest File Next$` finished reading it.
     *
     * It does NOT clear `Filename108` the way the single form does, so the
     * File gadget comes up holding whatever the last `Irequest File$` left
     * there.
     */
    'irequest file multi$': (it, a): Value => {
      const st = s()
      if (rt.rtFile) {
        if (!rt.rtFile.done) {
          it.block({ type: 'rtreq' }, true)
          return VS('')
        }
        const f = rt.rtFile
        rt.rtFile = null
        st.freqFile = f.result
        st.freqDir = f.dir
        if (!f.ok || f.list.length === 0) {
          st.frFileList = []
          st.frDir = ''
          return VS('')
        }
        // `tst.b (a1) / bne .yesdir`: an EMPTY directory string leaves FRDir
        // cleared, and every name then comes back unprefixed
        st.frDir = f.dir
        st.frFileList = f.list.slice(1)
        return VS(joinFreq(f.dir, f.list[0]?.name ?? ''))
      }
      const n = a.length
      const title = n >= 1 ? str(a[0]!) : ''
      const pat = n >= 2 ? str(a[1]!) : ''
      if (pat !== '') st.freqPattern = pat
      st.frFileList = []
      startFileReq(rt, st, title, FREQF.MULTISELECT)
      it.block({ type: 'rtreq' }, true)
      return VS('')
    },

    /**
     * `=Irequest File Next$` --- routine 214 ($58f4).
     *
     * DEFECT: the worst one in this extension, `$592e move.l $170.w,d5`.
     * `FRDirLen` is a longword at `$170(a4)` of the data zone, and the line
     * above it reads its neighbour correctly as `$5924 move.l $16c(a4),d6`.
     * This one lost the `d` off `dmove.l` in the source and assembles to
     * ABSOLUTE SHORT, so it reads address `$170` in low memory, which on a
     * real machine is inside the exception vector table. That value is then
     * the length for both the GetRetStr allocation at `$5936` and the CopyMem
     * at `$5958`, so the second name of a multi-selection copies a ROM
     * pointer's worth of bytes into a small buffer. `Irequest File Multi$`
     * has the same arithmetic and gets it right, so the FIRST file always
     * works and the next one takes the machine down.
     *
     * DEVIATION: this port has no low memory to read and no way to make a
     * megabyte-long CopyMem mean anything, so it joins the directory the way
     * the author meant. The defect is recorded rather than reproduced, the
     * same call ./g stc pack's overrun gets.
     */
    'irequest file next$': (): Value => {
      const st = s()
      const e = st.frFileList.shift()
      if (!e) return VS('')
      return VS(joinFreq(st.frDir, e.name))
    },

    /**
     * `=Irequest Font$([title$])` --- routine 215, with 216 for the short form.
     *
     * The guide sells the pairing outright: *"This string can be passed to
     * Set Ifont to set the font to the user's preference."* The format it
     * promises is fontname, a slash, and the size.
     *
     * DEFECT: it cannot. `GetRetStr` answers in d0 and a0; `$5a5a lea.l
     * $5adc(pc),a1` puts the `.rsc` control block in a1 before the call, and
     * StrAlloc's own `$89e8 lea.l $a4(a4),a1` leaves the address of
     * `FirstString` there afterwards. Nothing puts a1 back, because
     * `pstart2`/`ret2` (macros2.i:3, :8) save a4 and a6 and `jtcall`
     * (macros.i:129) saves a6. So `$5a76 addq.w #$1,(a1)` bumps the HIGH word
     * of the string list's head pointer instead of the new string's length
     * word, once for the `/` and once per digit of the size, and `$5aae
     * move.l a1,d3` hands the caller the address of `FirstString` itself. The
     * string it built --- correct, and holding `topaz.font/8` --- is never
     * returned and never freed.
     *
     * What the caller gets is `data.i`'s `FirstString`, read as an AMOS
     * string: a length word that is the top half of a heap pointer plus the
     * increments, and characters taken from `LastError` and `LastErrorStr`
     * behind it. The same misuse is in `=Irequest File Next$` and in `Set
     * Ifont namesize$`, and `=Irequest File$` and `=Irequest File Multi$` are
     * the two that get it right --- `$5648 move.l a0,(a7)` saves the string
     * and reads it back. Three of five.
     *
     * DEVIATION: this port has no Amiga heap and no pointer to read a length
     * out of, so it answers the `name.font/size` the author meant, the same
     * call `=Irequest File Next$` gets. `Set Ifont` is broken on its own
     * account, so the pairing the guide promises still fails --- with error
     * 15 rather than with rubbish.
     *
     * A cancel is `dlea NullStr,a0`, the zero word at `$a2(a4)` immediately
     * in front of `FirstString`, and that path is correct: an empty string.
     * `LeaveReq`'s font arm is `selfile = (APTR)(filename[0] != 0)`, so Ok on
     * an empty name gadget is a cancel too.
     */
    'irequest font$': (it, a): Value => {
      const st = s()
      if (rt.rtFont) {
        if (!rt.rtFont.done) {
          it.block({ type: 'rtreq' }, true)
          return VS('')
        }
        const f = rt.rtFont
        rt.rtFont = null
        // the requester struct outlives the call, so the next one opens here
        st.fontReqName = f.result
        st.fontReqSize = f.resultSize
        if (!f.ok) return VS('')
        return VS(`${f.result}/${f.resultSize}`)
      }
      startFontReq(rt, st, a.length >= 1 ? str(a[0]!) : '')
      it.block({ type: 'rtreq' }, true)
      return VS('')
    },

    /**
     * `=Irequest Screen([title$])` --- routine 217, with 218 for the short
     * form.
     *
     * The guide is exact about what it is for: *"Requests a screen mode,
     * size, and depth from the user."* The answer is a boolean, `moveq #-1,d3`
     * at `$5b8a` against `moveq #$0,d3` at `$5b86`, and the values go into
     * `ScreenData` for the four `Ireq Scr` readers to pick up.
     *
     * `dtst.b WB20 / beq L_NeedKick20` guards it, error 2, "Need Kickstart
     * 2.0 or higher". This machine declares Kickstart 40, so the arm is
     * reproduced by being written down and never taken. The library's own
     * autodoc is blunter than the guide about why: *"The 1.3 version of
     * ReqTools also contains the screenmode requester, but unless you are
     * running 2.0 or higher it will not come up."*
     *
     * The title is StrAlloc'd into a C string, passed in a3 --- the FD is
     * `rtScreenModeRequestA(screenmodereq,title,taglist)(A1,A3,A0)` --- and
     * freed after, and this one guards the free with `move.l a3,d0 / beq
     * .nottl`. `=Irequest File$` does not, and calls StrFree on a null.
     *
     * The colour count is the extension's own arithmetic, not the library's:
     * `$5bb8 moveq #$1,d0 / lsl.l d1,d0` off `rtsc_DisplayDepth`, with a HAM
     * mode branching to 4096 at depth 6 and 262144 otherwise. So an EHB mode
     * would read 64 in the requester and 64 here by coincidence rather than
     * by agreement, and a HAM8 screen reads 262144 where reqtools' own
     * readout says 16M.
     */
    'irequest screen': (it, a): Value => {
      const st = s()
      if (rt.rtScreen) {
        if (!rt.rtScreen.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtScreen
        const got = rtScreenResult(r)
        const ok = r.ok
        rt.rtScreen = null
        // the requester struct outlives the call, so the next one opens here
        st.screenReq = got
        if (!ok) return VI(0)
        st.screenData = {
          width: got.width,
          height: got.height,
          displayId: got.displayId,
          viewModes: got.displayId & IEXT_MODES_MASK,
          numCols:
            (got.displayId & 0x0800) !== 0 ? (got.depth === 6 ? 4096 : 262_144) : 1 << got.depth,
        }
        return VI(-1)
      }
      startScreenReq(rt, st, a.length >= 1 ? str(a[0]!) : '')
      it.block({ type: 'rtreq' }, true)
      return VI(0)
    },

    /**
     * `=Ireq Scr Mode(n)` --- routine 219.
     *
     * `move.l (a3)+,d0 / bne .dispID`: zero answers sd_ViewModes at `$c` of
     * ScreenData, a word, and anything else answers sd_DisplayID at `$8`, a
     * long. The guide names the pair *"If n is 0, the screen mode (e.g. Ham,
     * Hires) is returned."*
     */
    'ireq scr mode': (_it, a): Value => {
      const d = s().screenData
      return VI(int(a[0]!) === 0 ? d.viewModes : d.displayId)
    },

    /**
     * `=Ireq Scr Colour` --- routine 220, `move.l sd_NumCols(a0),d3`.
     *
     * The guide: *"Returns the number of colours from the most recent
     * Irequest Screen."* Zero until one has been answered, because
     * `rtAllocRequestA` cleared the block it reads.
     */
    'ireq scr colour': (): Value => VI(s().screenData.numCols),

    /** `=Ireq Scr Width` --- routine 221, `move.w sd_Width(a0),d3` */
    'ireq scr width': (): Value => VI(s().screenData.width),

    /** `=Ireq Scr Height` --- routine 222, `move.w sd_Height(a0),d3` */
    'ireq scr height': (): Value => VI(s().screenData.height),

    /**
     * `=Irequest Warning([title$,] s$, ok$, cancel$)` --- routine 223.
     *
     * The two gadget strings are joined with a bar and BOTH are checked:
     * `move.w (a2)+,d3 / beq L_IllFunc` on the cancel, then the same on the
     * ok, so either one empty is error 13 before the requester opens. The
     * one-argument form supplies its own "Ok" and "Cancel" from `$5dbc` and
     * `$5dc0`.
     *
     * The answer is `subq.w #$2,d0 / move.w d0,d3 / ext.l d3` over the
     * helper's 1-and-2, so Ok is -1 and Cancel is 0. That is AMOS's own
     * boolean, which is the point: `If Irequest Warning("Delete it?")` reads
     * as English and needs no comparison.
     *
     * EZREQF_LAMIGAQUAL goes in, and the guide's reason is reqtools': the
     * flag is for "a destructive action", and it limits the shortcuts to
     * Left-Amiga V and Left-Amiga B so a stray Y cannot answer yes. RETURN
     * and ESC stay live either way.
     */
    'irequest warning': (it, a): Value => {
      const st = s()
      if (rt.rtReq) {
        if (rt.rtReq.done) return VI(ezAnswer(rt) - 2)
        it.block({ type: 'rtreq' }, true)
        return VI(0)
      }
      const n = a.length
      const title = n >= 4 ? str(a[0]!) : ''
      const body = n >= 4 ? str(a[1]!) : str(a[0]!)
      const ok = n >= 4 ? str(a[2]!) : n === 3 ? str(a[1]!) : 'Ok'
      const cancel = n >= 4 ? str(a[3]!) : n === 3 ? str(a[2]!) : 'Cancel'
      if (ok === '' || cancel === '') iError(E.IFC)
      startEz(rt, st, title, body, `${ok}|${cancel}`, EZREQF.LAMIGAQUAL)
      it.block({ type: 'rtreq' }, true)
      return VI(0)
    },

    /**
     * `=Irequest Message([title$,] text$, gadget$)` --- routine 229.
     *
     * The plain one: no extra flags, and the answer handed back as the helper
     * left it, so gadgets number 1 to N from the left. `gadget$` is a whole
     * reqtools format and may carry bars, which is the only way an AMOS
     * program gets a three-way requester out of this extension.
     */
    'irequest message': (it, a): Value => {
      const st = s()
      if (rt.rtReq) {
        if (rt.rtReq.done) return VI(ezAnswer(rt))
        it.block({ type: 'rtreq' }, true)
        return VI(0)
      }
      const n = a.length
      const title = n >= 3 ? str(a[0]!) : ''
      const body = n >= 3 ? str(a[1]!) : str(a[0]!)
      const gadgets = n >= 3 ? str(a[2]!) : str(a[1]!)
      startEz(rt, st, title, body, gadgets, 0)
      it.block({ type: 'rtreq' }, true)
      return VI(0)
    },

    /**
     * `=Reqtools Here` --- is `reqtools.library` open?
     *
     * Routine 282: `tst.l $5a(a4) / sne.b d3 / ext.w d3 / ext.l d3`, so a
     * non-zero `ReqToolsBase` answers -1 and nothing else does. ../amiga/
     * reqtools.ts is the library and ../amiga/exec.ts lists it, so the open
     * in `startup.s` succeeds and this is -1. Every requester in `request.s`
     * goes through `rtcall`, whose first two instructions are `dtst.l
     * ReqToolsBase / beq L_NoReqTools`, so this answer and error 29 are the
     * same fact read two ways.
     */
    'reqtools here': (): Value => VI(-1),

    ishift: (): Value => VI(s().lastQual),

    /**
     * `=Imouse Key` --- and it answers 0 whatever the buttons are doing.
     *
     * Routine 122 is `jsr $88(a6)` (GetCurInput), `jsr $98(a6)` (GetMouse)
     * and then `move.b $29(a4),d3`, which is `MouseState` in `data.i`:32.
     * GetMouse only pumps: `move.l #MOUSEBUTTONS,d0 / bsr DoEvent`, so
     * `DoEvent`'s MOUSEBUTTONS arm is the one place the byte is written.
     *
     * DEFECT: that arm never sets a bit. `bclr #7,d0 / seq d1` puts $FF in d1
     * for a press, because SELECTDOWN is $68 with bit 7 clear and SELECTUP is
     * $e8 with it set; `tst.b d1 / bne .mbset` then splits the two. Both arms
     * are `bclr d0,d1`, byte for byte -- $8504 for the release and $8510 for
     * the press, where the press one wants `bset`. So the byte starts at zero
     * and every event clears a bit of it again.
     *
     * The guide promises what the author meant: *"Bit 0 is the left button,
     * bit 1 is the right button, and bit 2 is the middle button.  So a value
     * of %011 indicates that both the left and right mouse buttons are
     * pressed."* All three bits are reachable -- `and.w #3,d0` bounds the bit
     * NUMBER, not a mask, and MIDDLEDOWN is $6a -- and none of them is ever
     * set.
     *
     * `=Imouse X` and `=Imouse Y` are unaffected: they read `wd_MouseX` out
     * of the Window and never look at this byte.
     */
    'imouse key': (): Value => VI(0),

    /**
     * `=Imouse X` and `=Imouse Y` --- the pointer in the current window, less
     * its border.
     *
     * `move.w wd_MouseX(a0),d3` and then `sub.w wd_BorderLeft(a0)`, so the
     * answer is CLIENT-relative: 0,0 is the first drawable pixel and not the
     * window's corner. Nothing clamps it, so a pointer over the border reads
     * negative.
     */
    'imouse x': (): Value => {
      const w = curIwin(s()).window
      return VI(((w.mouseX - w.borderLeft) << 16) >> 16)
    },
    'imouse y': (): Value => {
      const w = curIwin(s()).window
      return VI(((w.mouseY - w.borderTop) << 16) >> 16)
    },

    /**
     * `=Iget$` --- one character if there is one, and the empty string if not.
     *
     * `jtcall GetKey / beq .nokey`, and `.nokey` is `dlea NullStr,a0`. So it
     * never waits, which is what separates it from `=Iread Char$`.
     */
    'iget$': (): Value => VS(takeKey(rt, s()) ?? ''),

    /**
     * `=Ievent Vbl`, `Mouse`, `Gadget`, `Menu`, `Close` and `Key` --- six
     * constants, three instructions each.
     *
     * They are IDCMP classes, so `E=Iwait Event : If E=Ievent Close` is the
     * idiom, and `Ievent Vbl` is `$80000000` because no IDCMP class could
     * collide with it.
     */
    /**
     * `=Igadget Read(n)` --- routine 265 ($747e), one function over four
     * gadget types.
     *
     * A LONGINT string gadget answers `si_LongInt`; a plain string gadget is
     * error 32. A TOGGLESELECT boolean answers GFLG_SELECTED as AMOS's own
     * boolean. A hit-select boolean answers -1 ONCE per press and decrements
     * `ge_HitCount` doing it, so a program that misses a frame still sees
     * every click; it pumps `DoEvent` with GADGETUP first, which is how the
     * count gets filled in before it is read.
     *
     * A slider answers `(NUnits - KnobSize) * Pot / MAXPOT`, rounded by
     * `add.l #MAXPOT/2` and with the `divu` remainder cleared by
     * `swap / clr.w / swap`.
     *
     * DEFECT: it asks the wrong field which way the slider runs. `$chkdir`
     * is `btst #GEB_VSLIDER,ge_Flags`, and nothing in `gadgets.s` ever SETS
     * that bit -- the four Make routines all `clr.l ge_Flags` and only
     * GEF_DISPLAYED and GEF_GADGETDOWN are ever ORed in afterwards. So the
     * test is always false and every slider is read through pi_HorizPot,
     * which for a vertical one was never written: `=Igadget Read` on a
     * `Set Igadget Vslider` answers 0 whatever the user does. `Set Igadget
     * Value` next door asks pi_Flags for FREEVERT instead and gets it right,
     * so the two halves of one feature disagree.
     *
     * DEVIATION: this port reads the pot the slider actually uses, so a
     * vertical slider answers its position. Reproducing the defect would
     * make `Set Igadget Vslider` unreadable and untestable, and the bit it
     * turns on is a field this port has no reason to model twice.
     */
    'igadget read': (_it, a): Value => {
      const st = s()
      const w = curIwin(st)
      const g = gadDefined(w, int(a[0]!))
      const gad = g.gad
      if (gad.kind === GTYP_STRGADGET) {
        if (((gad.activation ?? 0) & GACT_LONGINT) === 0) iError(E.WGT)
        return VI(gad.strInfo!.longInt)
      }
      if (gad.kind === GTYP_PROPGADGET) {
        const room = Math.max(0, g.units - g.knobSize)
        const p = gad.prop!
        const pot = (p.flags & FREEVERT) !== 0 ? p.vertPot : p.horizPot
        return VI(Math.trunc((room * pot + Math.trunc(MAXPOT / 2)) / MAXPOT))
      }
      if (((gad.activation ?? 0) & GACT_TOGGLESELECT) !== 0) {
        return VI(((gad.flags ?? 0) & GFLG_SELECTED) !== 0 ? -1 : 0)
      }
      // hit-select: `jtcall DoEvent` with GADGETUP files the presses, then
      // one is taken off the count
      doEvent(st, IDCMP_GADGETUP)
      if (g.hitCount === 0) return VI(0)
      g.hitCount--
      return VI(-1)
    },

    /**
     * `=Igadget Read$(n)` --- routine 266 ($758c).
     *
     * A STRGADGET without LONGINT, or error 32; the buffer, as `ReturnString`
     * hands it back. This one uses the jump table's `ReturnString` rather
     * than `GetRetStr`, so it does not carry the register confusion three of
     * its neighbours do.
     */
    'igadget read$': (_it, a): Value => {
      const st = s()
      const w = curIwin(st)
      const g = gadDefined(w, int(a[0]!))
      if (g.gad.kind !== GTYP_STRGADGET) iError(E.WGT)
      if (((g.gad.activation ?? 0) & GACT_LONGINT) !== 0) iError(E.WGT)
      return VS(g.gad.strInfo!.buffer)
    },

    /**
     * `=Igadget Down(n)` --- routine 268 ($768c): GEF_GADGETDOWN as a boolean.
     *
     * The flag is kept by the extension rather than by Intuition, and it is
     * `DoEvent` that maintains it -- GADGETDOWN sets it and GADGETUP clears
     * it -- so it reads true only between a press and its release, and only
     * once the program has pumped the port.
     */
    'igadget down': (_it, a): Value => {
      const st = s()
      const w = curIwin(st)
      const g = gadDefined(w, int(a[0]!))
      doEvent(st, IEXT_IDCMPWAIT)
      return VI(g.down ? -1 : 0)
    },

    'ievent vbl': (): Value => VI(IEXT_EVENT_VBL),
    'ievent mouse': (): Value => VI(IDCMP_MOUSEBUTTONS),
    'ievent gadget': (): Value => VI(IDCMP_GADGETUP),
    'ievent menu': (): Value => VI(IDCMP_MENUPICK),
    'ievent close': (): Value => VI(IDCMP_CLOSEWINDOW),
    'ievent key': (): Value => VI(IDCMP_RAWKEY),

    /** `=Ievent Data` --- the second half of whatever the last wait answered */
    'ievent data': (): Value => VI(s().eventData),

    /**
     * `=Iwait Event` --- block on the window's UserPort, answer the IDCMP
     * CLASS.
     *
     * `L_IwaitEvent` waits on `mp_SigBit` of the port, pumps `DoEvent` with
     * `IDCMPWAIT`, stores the message's second word in `EventData` and loops
     * while the class is zero. So it returns a class and never a message.
     *
     * `DoEvent`'s gadget arms are what `=Igadget Down` and the hit-select
     * arm of `=Igadget Read` are reading: GADGETDOWN sets GEF_GADGETDOWN and
     * counts a press, GADGETUP clears the flag, and a GADGETUP from a
     * TOGGLESELECT gadget clears `ge_HitCount` outright --- `cmp.l
     * #GADGETUP,d3`, then BOOLGADGET and TOGGLESELECT, then `clr.w
     * ge_HitCount(a0)`.
     */
    'iwait event': (it): Value => waitEvent(rt, it, false),
    'iwait event vbl': (it): Value => waitEvent(rt, it, true),


    'iwindow status wb': (_, a): Value => {
      const w = findWbIwin(s(), int(a[0]!))
      return VI(pumpStatus(s(), w) & (WEF.CLOSED | WEF.MENUACTIVE))
    },
  }
  for (const [was, now] of IEXT_OBSOLETE) if (table[now]) table[was] = table[now]!
  return table
}

/** the `(n)` form or the bare one, which every reader in `screens.s` pairs */
function pick(st: IextState, a: readonly Value[]): IextScreen {
  return a.length > 0 ? findIscr(st, int(a[0]!)) : curIscr(st)
}
