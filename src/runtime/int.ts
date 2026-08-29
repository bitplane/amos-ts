/**
 * Int 1.0, by D.J.Software: Workbench windows, screens and menus from AMOS.
 *
 * Sixty-two keywords at slot 25, every one of them a thin wrapper over
 * intuition.library, graphics.library or gadtools.library. This file is the
 * first batch: the ones whose back end this port already had, which is the
 * windows, the screens, the menus, the boolean gadgets and the event loop.
 *
 * ## Evidence
 *
 * BINARY tier. `AMOSPRO_Int.Lib`, a 24,612-byte code hunk with 101 jump-table
 * entries; `extdis int-1.0` disassembles it, and the AMOS 1.3 build `Int.Lib`
 * is held beside it with the same token table. The two documents are a bare
 * syntax list, `commands.txt`, and an install note, so neither says what a
 * keyword MEANS and the code is the whole account.
 *
 * What fills that gap is the eighteen example programs the archive ships, one
 * per feature, whose own comments name every IDCMP bit and window flag the
 * extension takes:
 *
 *     '  $200=Report When The Close Gadget Has Been Clicked
 *     '  $2000000=Report When A Window Has Been Resized
 *     Wb Window Ids %10000000000000000000000000,%10000,...
 *
 * Every one of those is intuition's own value, so `Wb Window Ids` and
 * `Wb Window Flags` are IDCMP and WFLG masks and nothing of the extension's
 * own invention.
 *
 * ## The zone, as the routines use it
 *
 * `$278(a5)`, which is `$f8 + 16*24` --- slot 25, one-based, exactly as the
 * install note says to configure it.
 *
 *     +$0000  the window table, one longword per number
 *     +$0190  window flags, what `Wb Window Flags` summed
 *     +$01d4  the menu build list per window
 *     +$0364  the menu strip per window
 *     +$04f4  how many menu entries that list holds
 *     +$06d4  the screen table, one longword per number
 *     +$0864  the NewScreen `Wb Open Screen` fills
 *     +$0a86  the item, `$0a8a` the menu, `$0a8e` the sub-item
 *     +$0b62  the highest screen number, `$0b66` the highest window number
 *     +$1192  the boolean gadget list per window
 *     +$134e  the gadtools context per window
 *     +$0d8c  VisualInfo, `$0d90` GadToolsBase, `$0d96` the locked pub screen
 *     +$0d94  the current window number, `$0dca` the IDCMP mask
 *     +$0de4  the NewScreen Type, `$0de6` the screen windows open on
 *     +$0e02  the window `Wb Event` last polled
 *
 * ## Three limits on two tables, and they disagree
 *
 * `Wb Open Window` takes 0 to 100 (`cmpi.l #$64,d1 / bgt`), and
 * `Wb Window Base` reads only 0 to 21. `Wb Open Screen` takes 0 to 99 and
 * `Wb Screen Base` reads all of them, while `Wb Close Screen` and
 * `Wb Screen Num` stop at 20 (`cmpi.l #$15,d6 / bge`). So a screen opened
 * above 20 can never be closed or selected again, and a window above 21 has
 * no readable address. Both tables are 100 longwords wide; it is the checks
 * that differ, and each is reproduced where it sits.
 */
import { AmosError, funcCall, int, str, type Value, VI, VS } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { RastPort, scrollRaster } from '../amiga/graphics'
import { CIAF_GAMEPORT0, CIAF_GAMEPORT1 } from '../amiga/cia'
import { joyDatOf } from '../amiga/gameport'
import { ICON_BANK } from './banks'
import { ASL_TYPE, type AslFileSetup } from '../amiga/asl'
import { encodeIlbm, parseIlbm, type IlbmImage } from '../amiga/ilbm'
import { GID, obtainDataType } from '../amiga/datatypes'
import { SHIPPED_DATATYPES } from '../amiga/datatypes.gen'
import {
  CUSTOMSCREEN,
  WB_SLOT,
  IDCMP_GADGETUP,
  IDCMP_MENUPICK,
  WBENCHSCREEN,
  WB_DISPLAY_Y,
  type UserGadget,
  type Window,
} from '../amiga/intuition'
import { BARLABEL, GadTools, KIND, MENUNULL, NM, itemNum, subNum, TAG, type Gadget, type MenuStrip, type NewMenu } from '../amiga/gadtools'

/**
 * The library's own messages, packed NUL-separated at $5b48 and indexed
 * zero-based through `L_ErrorExt`.
 *
 * Fifty-two, which is more than any other extension here carries, and the
 * spelling is the author's throughout: "Screen Number To High", "Bank Number
 * Is To Low", "Number 10 Type Is Not Allowed". The last of those is the only
 * statement anywhere that gadtools reserves kind 10.
 */
export const INT_ERRORS = [
  'Depth Needs To Be 1 To 8',
  "This Window Can't Be Closed",
  'This Window Is Already Opened',
  'Cannot Open Asl Library',
  'Number Needs To Be 0-100',
  'Cannot Open Screen',
  'Cannot Close This Screen',
  'Screen Number To High',
  'Screen Flag Error',
  'Number Is To High',
  'Cannot Move This Window',
  'Window Is Not Open',
  'Cannot Get Window RastPort',
  'Not Enough Memory To Load IFF',
  'File Not Found',
  'Not An IFF File',
  'No IFF In Bank',
  'Gadget Not Found',
  'Could Not Create Gadget',
  'Could Not Get Windows RastPort',
  'No Icons In Bank',
  'Picture Is Not Packed',
  'Bank Number Is To Low',
  'Dos Error',
  'Cannot Load 24 Bit Data',
  'Number 10 Type Is Not Allowed',
  'Number Type Is To High',
  'Wrong Type Of Flag',
  'Only Number Type 2 And 12 Allowed',
  'Not Enough Memory',
  'Cannot Open Window',
  'Cannot Open Gadtools.Library',
  'Cannot Get Visual Info',
  'Cannot Create Menus',
  'Cannot Allocate ASL',
  'Cannot Open Dos.Library',
  'Cannot Find Screen',
  'Cannot Open ASL Requester',
  'Cannot Read DataType',
  'Not An Image DataType',
  'Cannot Open DataType Library',
  'No Colours Found In Image',
  'Bank Is Already In Use',
  'Bank Number Is To High',
  'Only Type 1 Is Allowed',
  'Cannot Open Layers Library',
  'Could Not Save IFF',
  'Could Not Allocate IFF Handle',
  'Could Not Create IFF Stream',
  'Could Not Create IFF Header',
  'Out Of Buffer Space (L_SAVEIFF)',
  'UNKNOWN ERROR (L_SAVEIFF)',
] as const

/** the indices this file branches to by name */
export const INT_ERR = {
  WINDOW_ALREADY_OPENED: 2,
  NUMBER_0_100: 4,
  CANNOT_OPEN_SCREEN: 5,
  SCREEN_NUMBER_TO_HIGH: 7,
  SCREEN_FLAG_ERROR: 8,
  NUMBER_IS_TO_HIGH: 9,
  CANNOT_MOVE_THIS_WINDOW: 10,
  WINDOW_IS_NOT_OPEN: 11,
  NOT_ENOUGH_MEMORY_TO_LOAD_IFF: 13,
  FILE_NOT_FOUND: 14,
  NOT_AN_IFF_FILE: 15,
  NO_IFF_IN_BANK: 16,
  NO_ICONS_IN_BANK: 20,
  BANK_NUMBER_IS_TO_LOW: 22,
  CANNOT_FIND_SCREEN: 36,
  COULD_NOT_SAVE_IFF: 46,
  CANNOT_READ_DATATYPE: 38,
  NOT_AN_IMAGE_DATATYPE: 39,
  NO_COLOURS_FOUND: 41,
  CANNOT_CREATE_MENUS: 33,
  ONLY_TYPE_1: 44,
} as const

function intError(n: number): never {
  throw new AmosError(INT_ERRORS[n] ?? `Int error ${n}`)
}

/**
 * What `Wb Open Window` and `Wb Open Screen` will take, and what the readers
 * will take back. See the header: the checks disagree and each is its own.
 */
const MAX_WINDOW = 100
const MAX_SCREEN = 99
/** `cmpi.l #$15,...` --- `Wb Window Base`, `Wb Close Screen` and `Wb Screen Num` */
const READ_LIMIT = 21

/** one entry of the menu list `Wb Menu Title` and its two friends build */
interface IntMenuEntry {
  nm: NewMenu
}

export class IntState {
  /** `$d94`, the window every drawing keyword works on; `Wb Window Num` sets it */
  window = 0
  /** `$e02`, the window `Wb Event` last polled or `Wb Open Window` last made */
  current = 0
  /** the window table at zone+0 */
  readonly windows = new Map<number, Window>()
  /** `$6d4`, the screen table; the value is the address OpenScreen returned */
  readonly screens = new Map<number, number>()
  /** `$de6`: the screen new windows open on, -1 for the Workbench */
  screen = -1
  /** `$190` and `$dca`: what the two flag keywords summed, for the NEXT open */
  winFlags = 0
  idcmp = 0
  /** `$de4`, NewScreen.Type, and zero is "Screen Flag Error" */
  screenType = 0
  /** `$1d4` and `$4f4`: the menu entries built so far, per window */
  readonly menuList = new Map<number, IntMenuEntry[]>()
  /** `$364`, the strip SetMenuStrip was given, per window */
  readonly strips = new Map<number, MenuStrip>()
  /** `$a8a`, `$a86`, `$a8e`: what the last MENUPICK decoded to */
  menu = -1
  item = -1
  sub = -1
  /** `$1192`, the boolean gadgets waiting for a window to open on */
  readonly boolGadgets = new Map<number, UserGadget[]>()
  /**
   * `$d90` and `$d8c`, GadToolsBase and the VisualInfo routine 11 opens.
   *
   * One per program rather than one per window, exactly as the zone holds it:
   * the first keyword that needs either opens both and every later one finds
   * them there.
   */
  readonly gt = new GadTools()
  /** `Wb Flash Screen`, which has nothing to flash here; see the keyword */
  beeps = 0
  /** `$134e`, the gadtools chain per window, in the order CreateGadgetA made it */
  readonly gtGadgets = new Map<number, Gadget[]>()
  /** which gadget ActivateGadget was last given, since nothing here has a cursor */
  activeGadget = -1
  /**
   * `wd_RPort`, one per window number.
   *
   * Every drawing keyword is the same four instructions: routine 44 for the
   * window pointer, then `movea.l $32(a1),a1`, which is wd_RPort. The pens,
   * the draw mode and the current position live in it, so `Wb Front Pen` is
   * a mode the next `Wb Draw` reads rather than an argument it takes.
   *
   * The origin is the window's top-left and the clip is the window, which is
   * what a real RPort's Layer does; ./jdint.ts carries the offset the same
   * way for the same reason.
   */
  readonly rports = new Map<number, RastPort>()
  /**
   * `$f7e` and `$107e`, the pattern and directory the next `Wb Asl Req` will
   * ask for, and `$dfa`, its hide-`.info` flag.
   *
   * Byte buffers rather than strings because neither writer terminates what
   * it copies, and that is observable: see `Wb Asl Pattern`. The zone is
   * allocated zeroed, so both start empty.
   */
  readonly aslPattern = new Uint8Array(0x101)
  readonly aslDir = new Uint8Array(0x100)
  aslHideInfo = 0
  /** `fr_File` of the requester at `$a96`, which `Wb File` reads back */
  aslFile = ''
  /**
   * `$884`, the words `Wb Palette` writes and `Wb Load Rgb` hands to
   * LoadRGB4 (-$c0).
   *
   * 514 bytes to the next field at `$a86`, which is 256 words and two bytes
   * of slack, and 256 is LoadRGB4's own ceiling. `Wb Palette n` indexes it in
   * sixteen-byte groups (`mulu.w #$e,d1 / mulu.w #$2,d2 / add.l d2,d1`, so
   * n*16) while `Wb Load Rgb` reads it flat from the start, which is what
   * makes the two agree: group n is colours n*8 to n*8+7.
   */
  readonly colours = new Uint16Array(256)
}

/** `moveq #$14,d1` in routine 68: the StringInfo buffer is twenty bytes */
const GT_STRING_MAX = 20



export function newIntState(): IntState {
  return new IntState()
}

/**
 * The window `$d94` names, or "Window Is Not Open".
 *
 * Routine 44 ($3650) is the table read alone --- `mulu.w #$4,d7 /
 * move.l (a4,d7.l),d0` --- and every caller tests the answer itself and
 * raises `moveq #$b,d0` on zero.
 */
function windowOf(st: IntState, n: number): Window {
  return st.windows.get(n) ?? intError(INT_ERR.WINDOW_IS_NOT_OPEN)
}

/**
 * The NewMenu type of the next entry, from the three templates at `$684`,
 * `$698` and `$6ac`.
 *
 * NM_TITLE, NM_ITEM and NM_SUB, and the fourth template at `$6c0` is the
 * NM_END that `Wb Menu On` appends before it calls CreateMenusA.
 */
function pushMenu(st: IntState, type: number, label: string, commKey: string, flags: number): void {
  const list = st.menuList.get(st.window) ?? []
  // an empty label is `moveq #$ff,d6` at $270a, which becomes NM_BARLABEL:
  // `Wb Menu Item "","",,,,` is how the examples draw a separator
  const nm: NewMenu = { type, label: label === '' ? BARLABEL : label, flags }
  if (commKey !== '') nm.commKey = commKey.slice(0, 1)
  list.push({ nm })
  st.menuList.set(st.window, list)
}

/**
 * `Wb Open Screen`'s body, and routine 40 itself.
 *
 * A function rather than only a keyword because routine 83 CALLS routine 40:
 * `Wb Dt Image To Screen` with a mode of 0 pushes nine parameters and
 * `Rbsr routine 40` at $4caa, so the two cannot be allowed to drift apart.
 */
function openIntScreen(
  rt: Runtime,
  st: IntState,
  num: number,
  y: number,
  width: number,
  height: number,
  planes: number,
  mode: number,
): void {
  if (num > MAX_SCREEN) intError(INT_ERR.SCREEN_NUMBER_TO_HIGH)
  const addr = rt.intuition.openScreen({
    width,
    height,
    depth: planes,
    hires: (mode & 0x8000) !== 0,
    laced: (mode & 0x4) !== 0,
    palette: [],
    displayY: WB_DISPLAY_Y + y,
    title: '',
  })
  if (addr === 0) intError(INT_ERR.CANNOT_OPEN_SCREEN)
  st.screens.set(num, addr)
  st.screen = addr
}

/** `Wb Open Window`'s body, and routine 2, which routine 83 calls at $4cf2 */
function openIntWindow(rt: Runtime, st: IntState, num: number, x: number, y: number, width: number, height: number): void {
  const onCustom = st.screen !== -1 && st.screen !== 0 && rt.intuition.slotOf(st.screen) !== null
  const w = rt.intuition.openWindow({
    leftEdge: x,
    topEdge: y,
    width,
    height,
    detailPen: 0,
    blockPen: 1,
    idcmpFlags: st.idcmp,
    flags: st.winFlags,
    title: '',
    type: onCustom ? CUSTOMSCREEN : WBENCHSCREEN,
    ...(onCustom ? { screenSlot: rt.intuition.slotOf(st.screen)! } : {}),
  })
  if (w === null) intError(30)
  if (num > MAX_WINDOW) intError(INT_ERR.NUMBER_0_100)
  for (const g of st.boolGadgets.get(num) ?? []) w.gadgets.push(g)
  st.windows.set(num, w)
  st.current = num
}

export function makeIntInstructions(rt: Runtime): Record<string, Instr> {
  const s = (): IntState => rt.int

  /** the four flag arguments `Wb Menu Item` and `Wb Menu Sub Item` sum */
  const menuFlags = (it: Parameters<Instr>[0]): number => {
    let f = 0
    for (let i = 0; i < 4; i++) {
      it.expect(',')
      f += flagArg(it)
    }
    // `Wb Menu Item "Asl","",,,,` is gadgets+menus+asl.AMOS with all four
    // elided, so four EntNuls go into the sum. The mask is the keyword's own
    // and it takes them all back off.
    return f & 0xffff
  }

  /**
   * wd_RPort, and where the window's origin sits on the screen.
   *
   * Routine 44 ($3650) reads the window table and every drawing keyword
   * follows it with `movea.l $32(a1),a1`. A zero entry is `moveq #$b,d0`,
   * "Window Is Not Open", which is what `windowOf` raises.
   *
   * The RastPort is made once per window and kept, because the pens, the
   * draw mode and the current position are its state and the keywords that
   * set them are separate from the ones that read them. The clip is refreshed
   * on every call instead, since `Wb Move Window` moves the layer under it.
   */
  const target = (num?: number): { rp: RastPort; ox: number; oy: number } => {
    const st = s()
    const n = num ?? st.window
    const w = windowOf(st, n)
    let rp = st.rports.get(n)
    if (!rp) {
      const bitMap = rt.screens.get(w.screenSlot)?.rp.bitMap ?? rt.screen.rp.bitMap
      rp = new RastPort(bitMap)
      rp.font = rt.systemFont()
      st.rports.set(n, rp)
    }
    rp.clip = {
      x1: w.leftEdge,
      y1: w.topEdge,
      x2: w.leftEdge + w.width - 1,
      y2: w.topEdge + w.height - 1,
    }
    return { rp, ox: w.leftEdge, oy: w.topEdge }
  }

  return {
    /**
     * `Wb Window Flags a,b,c,d,e,f,g,h,i` and `Wb Window Ids ...` --- the two
     * masks the NEXT `Wb Open Window` opens with.
     *
     * Nine arguments each and both routines do the same thing with them:
     * clear the longword, add all nine, store. Nine because the author
     * expected one flag per argument and said so in the examples --- "If
     * Using More Than 9 Flags Just Add Flags Together" --- so the sum is the
     * feature rather than an accident of the parser.
     *
     * They are intuition's own bits. `$190` becomes NewWindow.Flags and
     * `$dca` becomes NewWindow.IDCMPFlags, and the examples' comments name
     * them: `$1000=Activate The Window When First Opened` is WFLG_ACTIVATE,
     * `$200=Report When The Close Gadget Has Been Clicked` is
     * IDCMP_CLOSEWINDOW.
     */
    'wb window flags': (it) => {
      s().winFlags = sumNine(it)
    },
    'wb window ids': (it) => {
      s().idcmp = sumNine(it)
    },

    /**
     * `Wb Screen Flags a..h` --- EIGHT arguments, not nine, and the sum is
     * NewScreen.Type rather than a flag set.
     *
     * `$de4` is a WORD and `Wb Open Screen` refuses to run while it is zero:
     * `move.w $de4(a4),d0 / beq` is the first thing routine 40 does, and the
     * arm it takes is error 8, "Screen Flag Error". So a program must set
     * this before it opens a screen, and the examples all pass `%1111`,
     * which is CUSTOMSCREEN.
     */
    'wb screen flags': (it) => {
      let f = flagArg(it)
      for (let i = 1; i < 8; i++) {
        it.expect(',')
        f += flagArg(it)
      }
      s().screenType = f & 0xffff
    },

    /**
     * `Wb Window Num n` --- which window everything else works on.
     *
     * One word at `$d94`, written without a check of any kind: naming a
     * window that is not open is not an error here, it is an error at the
     * next keyword that looks one up.
     */
    'wb window num': (it) => {
      s().window = it.evalInt() & 0xffff
    },

    /**
     * `Wb Screen Num n` --- which screen the next `Wb Open Window` opens on.
     *
     * -1 puts `$de6` back to -1, which is the Workbench. Any other number is
     * looked up in the screen table and the ADDRESS stored, so selecting a
     * screen that was never opened quietly selects zero rather than raising.
     * Above 20 is error 7, which is the reader's limit and not the table's.
     */
    'wb screen num': (it) => {
      const st = s()
      const n = it.evalInt()
      if (n === -1) {
        st.screen = -1
        return
      }
      if (n >= READ_LIMIT) intError(INT_ERR.SCREEN_NUMBER_TO_HIGH)
      st.screen = st.screens.get(n) ?? 0
    },

    /**
     * `Wb Open Window num,x,y,width,height,minW,minH,maxW,maxH`.
     *
     * Nine arguments into a NewWindow, in the order they are popped: the four
     * limits first because they are the last written, then the geometry.
     * DetailPen 0 and BlockPen 1 are the routine's own constants, the flags
     * and the IDCMP come from the two keywords above, and Type is a
     * PUBLICSCREEN 2 with NewWindow.Screen filled in from `$de6` --- so a
     * program that has not opened a screen gets the Workbench.
     *
     * The number is checked LAST, after OpenWindow has already succeeded:
     * `cmpi.l #$64,d1 / bgt` at $21f0 raises error 4 with the window open and
     * nothing holding it, so a bad number leaks the window it just made.
     *
     * There is no already-open check. The error table carries "This Window Is
     * Already Opened" at index 2 and NOTHING in the library loads a 2 --- the
     * whole of routine 2's error surface is the 30 at $2366 and the 4 at
     * $2374. Reopening a number therefore opens a second window and writes it
     * over the table entry, and the first one stays on the screen with no
     * keyword able to name it. That leak is the behaviour.
     */
    'wb open window': (it) => {
      const st = s()
      const num = it.evalInt()
      const [x, y, width, height] = four(it, true)
      const [minW, minH, maxW, maxH] = four(it, true)
      // the four limits are NewWindow.MinWidth..MaxHeight, which nothing in
      // this port resizes by, so they are read and dropped
      void minW
      void minH
      void maxW
      void maxH
      openIntWindow(rt, st, num, x, y, width, height)
    },

    /**
     * `Wb Close Window num` --- ClearMenuStrip if there is one, then
     * CloseWindow, then free the gadget block.
     *
     * The menu strip goes first and the order matters on the machine:
     * CloseWindow on a window that still has a strip attached leaves
     * intuition holding a pointer into memory the window owned.
     */
    'wb close window': (it) => {
      const st = s()
      const num = it.evalInt()
      const w = st.windows.get(num)
      // routine 94, which is `clr.l (a3)+ / moveq #$1,d0` into the error
      // dispatcher: a number the table holds nothing for is "This Window
      // Can't Be Closed" and not a quiet return
      if (w === undefined) intError(1)
      st.strips.delete(num)
      rt.intuition.closeWindow(w)
      st.windows.delete(num)
      st.boolGadgets.delete(num)
      st.menuList.delete(num)
    },

    /**
     * `Wb Move Window x,y` --- MoveWindow (-$a8) on the current window.
     *
     * A window that is not open is error 10, "Cannot Move This Window", where
     * every other keyword that looks one up raises 11. The two arms are four
     * instructions apart at $2472 and there is no reason for the difference
     * beyond which `moveq` the author typed.
     */
    'wb move window': (it) => {
      const st = s()
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const w = st.windows.get(st.window)
      if (w === undefined) intError(INT_ERR.CANNOT_MOVE_THIS_WINDOW)
      rt.intuition.moveWindow(w, x, y)
    },

    /**
     * `Wb Titles window$,screen$` --- SetWindowTitles (-$114).
     *
     * Both strings are popped and neither is checked, so an empty one is a
     * real empty title rather than intuition's "leave it alone" (-1).
     */
    'wb titles': (it) => {
      const st = s()
      const title = str(it.evalExpr())
      it.expect(',')
      const screenTitle = str(it.evalExpr())
      const w = windowOf(st, st.window)
      w.title = title
      // Both strings are kept. The second is what the SCREEN's bar reads while
      // this window is active and nothing here draws a screen bar, so it is
      // recorded and not shown; dropping it would lose what the program said.
      w.screenTitle = screenTitle
      rt.intuition.invalidate()
    },

    /**
     * `Wb Flash Screen` --- DisplayBeep(NULL), which flashes EVERY screen.
     *
     * `movea.w #$0,a0` before `jsr -$60(a6)`, and a null screen is the
     * whole display rather than one of them.
     *
     * DEVIATION: nothing flashes. DisplayBeep inverts a screen's colour zero
     * for a moment and puts it back, which is a two-frame effect this port has
     * no place to hold; the count is here so a test can see the call happened,
     * the same way ./gui.ts counts `Gui Beep`.
     */
    'wb flash screen': () => {
      s().beeps++
    },

    /**
     * `Wb Open Screen num,x,y,width,height,planes,pen1,pen2,mode`.
     *
     * Nine arguments into the NewScreen at `$864`, and the Type comes from
     * `Wb Screen Flags` rather than from an argument. The number is checked
     * BEFORE OpenScreen this time --- `cmpi.l #$64,d6 / bge` --- so 100 and
     * above is error 7 and nothing is opened.
     */
    'wb open screen': (it) => {
      const st = s()
      if (st.screenType === 0) intError(INT_ERR.SCREEN_FLAG_ERROR)
      const num = it.evalInt()
      const [x, y, width, height] = four(it, true)
      it.expect(',')
      const planes = it.evalInt()
      it.expect(',')
      const pen1 = it.evalInt()
      it.expect(',')
      const pen2 = it.evalInt()
      it.expect(',')
      const mode = it.evalInt()
      void pen1
      void pen2
      void x
      openIntScreen(rt, st, num, y, width, height, planes, mode)
    },

    /**
     * `Wb Close Screen num` --- CloseScreen (-$42), and the number stops at 20.
     *
     * A number the table holds nothing for is error 6, "Cannot Close This
     * Screen"; 21 and above is error 7 before the table is even read.
     */
    'wb close screen': (it) => {
      const st = s()
      const num = it.evalInt()
      if (num >= READ_LIMIT) intError(INT_ERR.SCREEN_NUMBER_TO_HIGH)
      const addr = st.screens.get(num)
      if (addr === undefined || addr === 0) intError(6)
      rt.intuition.closeScreen(addr)
      st.screens.delete(num)
      if (st.screen === addr) st.screen = -1
    },

    /**
     * `Wb Screen Offset x,y` --- ScrollVPort (-$24c) after NEGATING both.
     *
     * `clr.l d2 / sub.l d0,d2` on each, into the ViewPort's DxOffset and
     * DyOffset, so `Wb Screen Offset 10,0` moves the display ten pixels the
     * other way from what the argument reads like.
     */
    'wb screen offset': (it) => {
      const st = s()
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      if (st.screen === -1 || st.screen === 0) return
      const slot = rt.intuition.slotOf(st.screen)
      const screen = slot === null ? undefined : rt.screens.get(slot)
      if (!screen) return
      screen.offsetX = -x
      screen.offsetY = -y
    },

    /**
     * `Wb Move Screen x,y` --- MoveScreen (-$a2), whose arguments are DELTAS.
     *
     * Both of them: `move.l (a3)+,d1` takes the Y and `move.l (a3)+,d0` the X,
     * and the call moves the screen by each. It works on `$de6`, the screen
     * `Wb Screen Num` last selected, and does nothing at all when that is -1.
     */
    'wb move screen': (it) => {
      const st = s()
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      if (st.screen === -1 || st.screen === 0) return
      const slot = rt.intuition.slotOf(st.screen)
      const screen = slot === null ? undefined : rt.screens.get(slot)
      if (!screen) return
      screen.displayX += dx
      screen.displayY += dy
    },

    /**
     * `Wb Menu Title text$` --- the first of the three that build a menu.
     *
     * Each of the three appends one 20-byte NewMenu to a list at `$1d4`,
     * keyed by the CURRENT window, and counts it at `$4f4`. Nothing is handed
     * to gadtools until `Wb Menu On`, which is why a program may build the
     * whole tree in any order it likes and why the examples read as a flat
     * run of statements.
     */
    'wb menu title': (it) => {
      pushMenu(s(), NM.TITLE, str(it.evalExpr()), '', 0)
    },

    /**
     * `Wb Menu Item text$,key$,f1,f2,f3,f4` --- and the four flags are summed.
     *
     * The example names them: `$1=Checkit  $8=MenuToggle  $100=Checked`,
     * which are CHECKIT, MENUTOGGLE and CHECKED. An empty text is
     * NM_BARLABEL, a separator, and the command key is truncated to ONE
     * character --- `move.b (a2)+,(a1)+` copies exactly one byte and a NUL
     * after it, whatever the program passed.
     */
    'wb menu item': (it) => {
      const text = str(it.evalExpr())
      it.expect(',')
      const key = str(it.evalExpr())
      pushMenu(s(), NM.ITEM, text, key, menuFlags(it))
    },

    /** `Wb Menu Sub Item text$,key$,f1,f2,f3,f4` --- the same with NM_SUB */
    'wb menu sub item': (it) => {
      const text = str(it.evalExpr())
      it.expect(',')
      const key = str(it.evalExpr())
      pushMenu(s(), NM.SUB, text, key, menuFlags(it))
    },

    /**
     * `Wb Menu On window` --- CreateMenusA, LayoutMenusA, SetMenuStrip.
     *
     * The list built by the three keywords above is copied into an array of
     * count+1 NewMenus, the last of them the NM_END template at `$6c0`, and
     * handed to gadtools: `jsr -$30(a6)` is CreateMenusA and `jsr -$42(a6)`
     * LayoutMenusA, both on a base this extension opens for itself. That
     * makes Int 1.0's menus gadtools menus and not hand-built Intuition ones,
     * which is what lets this port hand them straight to ../amiga/gadtools.ts.
     *
     * The window is named by ARGUMENT here and by `$d94` in the three
     * builders, so a program that changes `Wb Window Num` between building
     * and switching on attaches one window's menus to another's.
     */
    'wb menu on': (it) => {
      const st = s()
      const num = it.evalInt()
      const w = windowOf(st, num)
      const list = st.menuList.get(st.window) ?? []
      const strip = st.gt.createMenus(list.map((e) => e.nm))
      if (strip === null) intError(INT_ERR.CANNOT_CREATE_MENUS)
      st.gt.layoutMenus(strip, 0)
      st.strips.set(num, strip)
      void w
    },

    /**
     * `Wb Bool Gadget x,y,width,height,type,xtext,ytext,text$,window`.
     *
     * A hundred bytes of AllocMem holding a Gadget, its Border, the Border's
     * five coordinate pairs and an IntuiText, linked onto a per-window list at
     * `$1192` that `Wb Open Window` hands to NewWindow.FirstGadget. So the
     * gadgets are made BEFORE the window and the examples do exactly that.
     *
     * `type` must be 1: `cmpi.l #$1,$10(a3)` reads the fifth argument before
     * anything else and error 44, "Only Type 1 Is Allowed", is the other arm.
     * One is BOOLGADGET.
     *
     * DEFECT: the Border's LeftEdge and TopEdge are written with `move.b
     * #$ff` at $4048 and $404e, and both fields are WORDS. The high byte
     * takes the $ff and the low byte stays 0, so each reads -256 rather than
     * the -1 the author meant, and the outline draws 256 pixels up and to the
     * left of the gadget --- off the window, and usually off the screen. What
     * a program sees is a gadget with a label and no box. Reproduced.
     *
     * DEFECT: GadgetID is never written. The 100 bytes are MEMF_CLEAR and
     * nothing fills `$26`, so every boolean gadget in every window has id 0
     * and `Wb Event` cannot tell two of them apart. The author's own
     * bool_gadgets.AMOS makes four buttons and tests only the close gadget.
     */
    'wb bool gadget': (it) => {
      const st = s()
      const [x, y, width, height] = four(it)
      it.expect(',')
      const type = it.evalInt()
      it.expect(',')
      const xText = it.evalInt()
      it.expect(',')
      const yText = it.evalInt()
      it.expect(',')
      const text = str(it.evalExpr())
      it.expect(',')
      const num = it.evalInt()
      if (type !== 1) intError(INT_ERR.ONLY_TYPE_1)
      const gad: UserGadget = {
        leftEdge: x,
        topEdge: y,
        width,
        height,
        // $26 is never written, so it is what MEMF_CLEAR left
        id: 0,
        borders: [
          {
            leftEdge: -256,
            topEdge: -256,
            pen: 3,
            xy: [0, 0, width + 1, 0, width + 1, height + 1, 0, height + 1, 0, 0],
          },
        ],
        text: { leftEdge: xText, topEdge: yText, frontPen: 2, text },
      }
      const list = st.boolGadgets.get(num) ?? []
      list.push(gad)
      st.boolGadgets.set(num, list)
      // a window that is already open takes it at once, which is what
      // linking onto the list a live NewWindow already pointed at amounts to
      st.windows.get(num)?.gadgets.push(gad)
    },

    /**
     * `Wb Gt Gadget x,y,width,height,text$,id,textpos,type,window` --- a
     * gadtools gadget, CreateGadgetA on a context this keyword opens.
     *
     * `jsr -$72(a6)` is CreateContext, once per window and kept at `$134e`,
     * and `jsr -$1e(a6)` is CreateGadgetA per gadget. The NewGadget is the
     * real thirty bytes and the TextAttr is topaz.
     *
     * Only two kinds get through, and the three refusals are a ladder:
     * `cmpi.w #$a` is error 25, "Number 10 Type Is Not Allowed", which is the
     * only statement anywhere in this port that gadtools reserves kind 10;
     * `cmpi.w #$f / bge` is error 26; and anything that is not 1 or 12 falls
     * to error 28.
     *
     * DEFECT: error 28 reads "Only Number Type 2 And 12 Allowed" and the code
     * tests for 1 and 12. `cmpi.l #$1,d0 / beq` at $4274 is BUTTON, not
     * CHECKBOX, so a program that believes the message and passes 2 gets the
     * message again.
     *
     * `textpos` is a PLACETEXT_ bit and has to be exactly one of six:
     * 1, 2, 4, 8, $10 or $20, else error 27.
     */
    'wb gt gadget': (it) => {
      const st = s()
      const [x, y, width, height] = four(it)
      it.expect(',')
      const text = str(it.evalExpr())
      it.expect(',')
      const id = it.evalInt()
      it.expect(',')
      const textPos = it.evalInt()
      it.expect(',')
      const kind = it.evalInt()
      it.expect(',')
      const num = it.evalInt()
      if (kind === 10) intError(25)
      if (kind >= 15) intError(26)
      if (kind !== KIND.BUTTON && kind !== KIND.STRING) intError(28)
      if (![1, 2, 4, 8, 0x10, 0x20].includes(textPos)) intError(27)
      const chain = st.gtGadgets.get(num) ?? []
      const g = st.gt.createGadget(
        kind as 1 | 12,
        chain[chain.length - 1] ?? st.gt.createContext(),
        { leftEdge: x, topEdge: y, width, height, gadgetText: text, gadgetID: id, flags: textPos, visualInfo: 0 },
        kind === KIND.STRING ? [{ tag: TAG.GTST_String, data: 0 }] : [],
      )
      if (g === null) intError(18)
      if (kind === KIND.STRING) g.string = ''
      chain.push(g)
      st.gtGadgets.set(num, chain)
      // DEVIATION: nothing paints it. The hit region goes on the window so a
      // click still reports the id through `Wb Event`, and the gadget itself
      // holds the value the three readers below answer from; what a program
      // does not get is the frame gadtools would have drawn. GUI 2.10's
      // gadgets are in the same position and ./gui.ts says so too.
      const hit: UserGadget = { leftEdge: x, topEdge: y, width, height, id }
      st.windows.get(num)?.gadgets.push(hit)
    },

    /**
     * `Wb Set Gt String n,text$,activate` --- write a STRING gadget's buffer
     * and optionally put the cursor in it.
     *
     * GT_SetGadgetAttrsA (-$2a) and then ActivateGadget (-$1ce) when the third
     * argument is not zero.
     *
     * DEFECT: the buffer is TWENTY bytes and the copy does not stop at the
     * gadget's own size. `moveq #$14,d1` counts down while `move.b (a1)+,(a4)+`
     * copies, and the NUL pad that follows writes the rest of the twenty
     * whatever the string was, so a longer string is cut at twenty characters
     * and a shorter one is padded to it.
     */
    'wb set gt string': (it) => {
      const st = s()
      const n = it.evalInt()
      it.expect(',')
      const text = str(it.evalExpr())
      it.expect(',')
      const activate = it.evalInt()
      const g = gtGadgetOf(st, n)
      g.string = text.slice(0, GT_STRING_MAX)
      st.activeGadget = activate === 0 ? st.activeGadget : n
    },

    /**
     * `Wb Activate Gt n` --- ActivateGadget (-$1ce), and a number the chain
     * does not reach is error 17, "Gadget Not Found".
     */
    'wb activate gt': (it) => {
      const st = s()
      const n = it.evalInt()
      gtGadgetOf(st, n)
      st.activeGadget = n
    },

    /* ------------------------------------------------------------------
     * The drawing group: graphics.library through wd_RPort
     *
     * Thirteen keywords, and twelve of them are the same four instructions
     * with a different `jsr` on the end:
     *
     *     move.w  $d94(a4), d7        the current window number
     *     Rbsr    routine 44          the window table at zone+0
     *     movea.l d0, a1              -> zero is error $b
     *     movea.l $32(a1), a1         wd_RPort
     *
     * Argument order is REVERSED against the source text. `(a3)+` walks the
     * parameter block upwards from the LAST argument, which the token table
     * settles rather than the reading does: `Wb Text` is spec `I2,0,0`, so
     * the string is written first, and routine 19 pops it LAST ($2a9a).
     * `Wb Put Chr$` (`I2,0`) and `Wb Intuitext` (`I2,0,0,0,0,0,0,0`) put the
     * string in the same place and pop it last too, three tables agreeing
     * about three different routines.
     *
     * Several of them end in `Rbsr routine 4`, which is WaitBlit (-$e4) and
     * nothing else. Which ones do is not a pattern --- `Wb Fill Box` waits
     * and `Wb Ellipse` does not --- and it costs nothing here, so the
     * asymmetry is recorded and not modelled.
     * ------------------------------------------------------------------ */

    /**
     * `Wb Draw Mode n` --- SetDrMd (-$162) on the current window's RPort.
     *
     * The mode is graphics.library's, not AMOS's: 0 JAM1, 1 JAM2,
     * 2 COMPLEMENT, 4 INVERSVID, and it stays set until the next call.
     */
    'wb draw mode': (it) => {
      const n = it.evalInt()
      target().rp.drawMode = n & 0xff
    },

    /**
     * `Wb Front Pen n` --- SetAPen (-$156), then WaitBlit.
     *
     * This is the pen every later keyword in the group draws with, which is
     * why none of them takes a colour.
     */
    'wb front pen': (it) => {
      const n = it.evalInt()
      target().rp.fgPen = n
    },

    /** `Wb Back Pen n` --- SetBPen (-$15c), then WaitBlit. */
    'wb back pen': (it) => {
      const n = it.evalInt()
      target().rp.bgPen = n
    },

    /**
     * `Wb Text a$,x,y` --- Move (-$f0) to (x,y), then Text (-$3c).
     *
     * `y` IS THE BASELINE and not the top of the glyphs, because this is
     * graphics.library's Text rather than AMOS's, and the two disagree about
     * that by the font's ascent. Routine 19 reads the string's length word at
     * $2a9c and passes it as Text's count, so the whole string prints
     * whatever it holds.
     */
    'wb text': (it) => {
      const text = str(it.evalExpr())
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const { rp, ox, oy } = target()
      rp.text(ox + x, oy + y, text)
    },

    /**
     * `Wb Draw x1,y1 To x2,y2` --- Move (-$f0) then Draw (-$f6).
     *
     * DEFECT: routine 22 looks the window up TWICE, once for each call, and
     * only tests the first answer ($2e5c). The second lookup at $2e84 goes
     * straight into `movea.l d0,a1 / movea.l $32(a1),a1`, so a window that
     * closed between the two would dereference zero. Nothing can close a
     * window mid-keyword here, so the second lookup is the same window and
     * the missing test costs nothing.
     */
    'wb draw': (it) => {
      const [x1, y1, x2, y2] = rectTo(it)
      const { rp, ox, oy } = target()
      rp.draw(ox + x1, oy + y1, ox + x2, oy + y2)
    },

    /**
     * `Wb Ellipse x,y,a,b` --- DrawEllipse (-$b4).
     *
     * Centre then the two radii, `a` horizontal and `b` vertical, and it is
     * an outline: graphics.library fills through AreaEllipse and this is not
     * that call.
     */
    'wb ellipse': (it) => {
      const [x, y, a, b] = four(it)
      const { rp, ox, oy } = target()
      rp.ellipse(ox + x, oy + y, a, b)
    },

    /** `Wb Fill Box x1,y1 To x2,y2` --- RectFill (-$132), then WaitBlit. */
    'wb fill box': (it) => {
      const [x1, y1, x2, y2] = rectTo(it)
      const { rp, ox, oy } = target()
      rp.rectFill(ox + x1, oy + y1, ox + x2, oy + y2)
    },

    /**
     * `Wb Box x1,y1 To x2,y2` --- Move (-$f0) to the first corner, then
     * PolyDraw (-$150) of FIVE points.
     *
     * Routine 75 builds the array at `$16a6(a4)` and `moveq #$5,d0` counts
     * it. The five are (x1,y1), (x2,y1), (x2,y2), (x1,y2), (x1,y1) --- so
     * the first is where Move already put the pen and the segment to it is
     * zero-length. It is reproduced rather than dropped because COMPLEMENT
     * mode can see it: that corner gets inverted twice, once by the
     * degenerate segment and once by the closing one.
     */
    'wb box': (it) => {
      const [x1, y1, x2, y2] = rectTo(it)
      const { rp, ox, oy } = target()
      const pts: Array<[number, number]> = [
        [x1, y1],
        [x2, y1],
        [x2, y2],
        [x1, y2],
        [x1, y1],
      ]
      let px = ox + x1
      let py = oy + y1
      for (const [x, y] of pts) {
        rp.draw(px, py, ox + x, oy + y)
        px = ox + x
        py = oy + y
      }
    },

    /**
     * `Wb Scroll win,dx,dy,x1,y1,x2,y2` --- ScrollRaster (-$18c).
     *
     * The ONLY keyword in the group that takes its window as an argument
     * instead of reading `$d94`: routine 51 pops seven and the last of them
     * ($3e4e) is what routine 44 is given.
     *
     * The argument roles come from the other side. AMOS's own Intuition
     * extension scrolls its text window with the same call and the same
     * registers --- `moveq #0,d0 / move.w rp_TxHeight(a2),d1 / call
     * ScrollRaster` after loading d2..d5 from the window's four border
     * insets (Intuition-41.95 `src/output.s:176-191`) --- so d0 is dx, d1 is
     * dy, and d2..d5 are xMin, yMin, xMax, yMax. A positive dy scrolls the
     * contents UP, which is what advancing a line of text means.
     *
     * DEVIATION: the vacated strip is filled with the RastPort's background
     * pen. A window's RPort has a Layer, and a real layered ScrollRaster
     * damages the uncovered region for the owner to refresh instead. Nothing
     * here is damage-driven (see intuition.ts `render`), so the fill is the
     * closest thing this port can do and it is written down rather than
     * hidden.
     */
    'wb scroll': (it) => {
      const win = it.evalInt()
      it.expect(',')
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      const [x1, y1, x2, y2] = four(it, true)
      const { rp, ox, oy } = target(win)
      scrollRaster(rp, dx, dy, ox + x1, oy + y1, ox + x2, oy + y2)
    },

    /**
     * `Wb Put Chr$ a$,address` --- the string's bytes, into memory.
     *
     * No library call at all: routine 69 reads the length word and copies
     * that many bytes (`subq.l #$1,d2 / move.b (a1)+,(a0)+ / dbra`), and
     * writes NO terminator. It is `Poke$` with the count taken from the
     * string rather than given, and it is here so a program can fill an
     * IntuiText or a gadget buffer it got an address for.
     */
    'wb put chr$': (it) => {
      const text = str(it.evalExpr())
      it.expect(',')
      const addr = it.evalInt()
      const m = rt.resolveWrite(addr >>> 0)
      if (m) for (let i = 0; i < text.length && m.off + i < m.data.length; i++) m.data[m.off + i] = text.charCodeAt(i) & 0xff
    },

    /**
     * `Wb Intuitext a$,left,top,mode,frontPen,backPen,xOffset,yOffset` ---
     * an IntuiText built at `$c8a(a4)` and handed to PrintIText (-$d8).
     *
     * The eight go in that order and the routine scatters them: `$4` and `$6`
     * are it_LeftEdge and it_TopEdge, `$2` it_DrawMode, `(a1)` it_FrontPen,
     * `$1` it_BackPen, `$c` it_IText, `$10` it_NextText cleared. The last two
     * arguments are PrintIText's own leftOffset and topOffset, so the text
     * lands at left+xOffset, top+yOffset.
     *
     * DEFECT: it_IText points at the AMOS string's BYTES and nothing
     * terminates them. Routine 54 reads the length word at $3f2c into d5 and
     * then throws it away four instructions later (`movem.l (a7)+,d5-d6`),
     * so the count is read and never used, while PrintIText prints to the
     * first zero byte. On the machine that means whatever follows the string
     * in memory. Here the string is what prints, which is the only honest
     * thing this port can do with an overrun that has nothing to run into.
     */
    'wb intuitext': (it) => {
      const text = str(it.evalExpr())
      it.expect(',')
      const left = it.evalInt()
      it.expect(',')
      const top = it.evalInt()
      it.expect(',')
      const mode = it.evalInt()
      it.expect(',')
      const frontPen = it.evalInt()
      it.expect(',')
      const backPen = it.evalInt()
      it.expect(',')
      const xOffset = it.evalInt()
      it.expect(',')
      const yOffset = it.evalInt()
      const { rp, ox, oy } = target()
      const font = rt.systemFont()
      const save = rp.snapshot()
      rp.font = font
      rp.drawMode = mode & 0xff
      rp.fgPen = frontPen & 0xff
      rp.bgPen = backPen & 0xff
      // PrintIText positions the glyphs by their TOP, unlike Text, so the
      // baseline is one ascent down from it_TopEdge
      rp.text(ox + left + xOffset, oy + top + yOffset + font.baseline, text)
      rp.restore(save)
    },

    /**
     * `Wb Palette n,c0,c1,c2,c3,c4,c5,c6,c7` --- eight colours into the
     * table at `$884`, in groups of sixteen bytes.
     *
     * Nothing is drawn and no library is called. `n` is read WITHOUT being
     * popped (`move.l $20(a3),d1`, the ninth slot, which is the first
     * argument) and the eight are written backwards from offset 14 down to
     * 0, so they land in source order.
     *
     * DEFECT: `n` is not checked. The table has 514 bytes to the next field
     * and the multiply is `n*16`, so `Wb Palette 33,...` writes over the
     * item, menu and sub-item numbers at `$a86`. Here it is a 256-word array
     * and a group past the end is dropped, because there is nothing beyond
     * it in this port to corrupt.
     */
    'wb palette': (it) => {
      const st = s()
      const n = it.evalInt()
      for (let i = 0; i < 8; i++) {
        it.expect(',')
        const c = it.evalInt() & 0xffff
        const at = n * 8 + i
        if (at >= 0 && at < st.colours.length) st.colours[at] = c
      }
    },

    /**
     * `Wb Load Rgb n` --- LoadRGB4 (-$c0) of the first `n` words of the
     * table, into the ViewPort of the screen new windows open on.
     *
     * `movea.l d2,a0 / lea $2c(a0),a0` is sc_ViewPort, and d2 is `$de6` when
     * that is not -1. When it IS -1 the routine takes the Workbench:
     * LockPubScreen with the name at `$e30` and then UnlockPubScreen with the
     * pointer it just got, four instructions apart at $36f4 and $3708, so the
     * screen is used after the lock that protected it was dropped. Nothing
     * here can close the Workbench underneath it, so the race is noted and
     * not modelled.
     */
    'wb load rgb': (it) => {
      const st = s()
      const n = it.evalInt()
      const slot = st.screen === -1 ? WB_SLOT : rt.intuition.slotOf(st.screen)
      const scr = slot === null ? undefined : rt.screens.get(slot)
      if (!scr) return
      const count = Math.min(n, st.colours.length, scr.palette.length)
      for (let i = 0; i < count; i++) scr.palette[i] = st.colours[i]! & 0x0fff
    },

    /* ------------------------------------------------------------------
     * The input group: the silicon, not AMOS and not Intuition
     *
     * Six keywords and not one of them opens a library. Two read the window
     * struct, two read CIA-A's serial register at $bfec01, one reads CIA-A's
     * PRA at $bfe001 and one reads the gameport counters at $dff00a/$dff00c.
     * ------------------------------------------------------------------ */

    /**
     * `Wb Clear Key` --- empty CIA-A's serial register and wait for it.
     *
     * Routine 31, seven instructions:
     *
     *     clr.b  $bfec01.l
     *     move.b $bfec01.l, d0
     *     tst.b  d0
     *     bne.b  (again)
     *
     * A spin, because the keyboard can clock the next byte in between the
     * write and the read. Nothing here is clocking one, so the read after the
     * write is always zero and the loop runs once. It is the other half of
     * `Wb Keycode`: read the code, then clear it so the next press is a new
     * one rather than the same one again.
     */
    'wb clear key': () => {
      rt.input.sdr = 0
    },

    /* ------------------------------------------------------------------
     * The requester's settings: three stores, no library call between them.
     *
     * `Wb Asl Req` is the only keyword here that opens asl.library. These
     * three fill in what it will ask for, and `Wb File` reads back what it
     * answered. iff_to_bank.AMOS is the shape, with the author's own
     * comments:
     *
     *     Wb Asl Info 1: Rem   *** 1= Dont Show Info Files 0=Show Info Files ***
     *     Wb Asl Dir "SYS:": Rem  *** Dir To Display In Asl Requester ***
     *     F$=Wb Asl Req("Pick A IFF File","Load","Cancel",0,1,125,30,310,193)
     * ------------------------------------------------------------------ */

    /**
     * `Wb Asl Pattern a$` --- the match pattern, into the buffer at `$f7e`.
     *
     * Routine 58 drops the whole call when the string is longer than 256
     * (`cmpi.w #$100,d0 / bgt`), and otherwise copies with a loop that tests
     * the byte AFTER the one it just took:
     *
     *     move.b (a2)+, (a0)+
     *     tst.b  (a2) / beq (done)
     *     dbra   d0, (again)
     *
     * DEFECT: no terminator is written on either exit. The buffer is zone
     * memory, so it starts as zeros and the first pattern reads back
     * correctly --- but a SHORTER pattern after a longer one only overwrites
     * its own length and the old tail is still there. `Wb Asl Pattern
     * "#?.iff"` and then `Wb Asl Pattern "#?"` leaves "#?.iff" in the buffer,
     * and a pattern can never get shorter for the life of the program.
     */
    'wb asl pattern': (it) => {
      const p = str(it.evalExpr())
      if (p.length > 0x100) return
      const buf = s().aslPattern
      for (let i = 0; i < p.length && i < buf.length; i++) buf[i] = p.charCodeAt(i) & 0xff
    },

    /**
     * `Wb Asl Info n` --- `move.l d0,$dfa(a4)` and nothing else.
     *
     * What it means is the author's, in iff_to_bank.AMOS: *"1= Dont Show Info
     * Files 0=Show Info Files"*. So it hides Workbench's `.info` files from
     * the requester.
     */
    'wb asl info': (it) => {
      s().aslHideInfo = it.evalInt()
    },

    /**
     * `Wb Asl Dir a$` --- the directory to open in, at `$107e`.
     *
     * Routine 72 copies `length + 1` bytes (`move.w (a0)+,d0` then
     * `dbra d0`), so it takes one byte from PAST the string --- the
     * terminator, when there is one. Unlike `Wb Asl Pattern` there is no
     * length check at all, so a long enough string writes past the buffer
     * into whatever the zone holds after it.
     */
    'wb asl dir': (it) => {
      const d = str(it.evalExpr())
      const buf = s().aslDir
      for (let i = 0; i < d.length && i < buf.length; i++) buf[i] = d.charCodeAt(i) & 0xff
      if (d.length < buf.length) buf[d.length] = 0
    },
    /**
     * `Wb Paste Icon x,y,n` --- one icon out of AMOS's bank 2, through
     * intuition's DrawImage (-$72).
     *
     * Routine 76 walks AMOS's own bank list at `$5ea(a5)` looking for
     * `moveq #$2,d3` --- the bank number is a literal, not an argument ---
     * and then checks the eight bytes it starts with against `$49636f6e` and
     * `$73202020`, which spell "Icons   ". Neither is there and it is error
     * 20, "No Icons In Bank".
     *
     * It builds a `struct Image` at `$16ba(a4)`: LeftEdge and TopEdge from
     * the first two arguments, Width from the bank entry's width-in-words
     * times 16, Height from its height word, and ImageData ten bytes into the
     * entry, which is past AMOS's own five-word image header.
     *
     * DEFECT: Image.Depth is the SCREEN's, not the icon's. It comes from
     * `GetScreenDrawInfo(wd_WScreen)` and `dri_Depth`, with PlanePick set to
     * `(1 << depth) - 1` by a `mulu.w #$2` loop, so DrawImage is told to read
     * as many planes as the screen has out of an icon that may have fewer.
     * On a screen deeper than its icons that reads whatever follows them.
     * Nothing here can reproduce that: a bank image carries its own depth.
     *
     * `cmp.w d0,d7 / blt` is the range check and it is one-sided --- an index
     * ABOVE the count returns quietly, and an index of 0 indexes six bytes
     * BELOW the table with nothing to stop it.
     */
    /**
     * `Wb Iff To Bank file$,n` --- the whole ILBM into a bank, unparsed,
     * behind four words that describe it.
     *
     * Routine 49 does no image decoding at all. It opens the file with
     * dos.library, takes its length from `fib_Size` at `$7c` of a
     * FileInfoBlock, reserves `size + 16` under the name at `$e6c` --- which
     * is the string "IFF.Pic." at code $1536 --- and `Read`s the file in
     * whole. Only then does it walk the chunks, and only for two of them:
     * BMHD's width, height and nPlanes, and CAMG's low word. BODY ends both
     * walks.
     *
     * The layout is what iff_to_bank.AMOS reads back:
     *
     *     Start(n)+0   width       BMHD +0
     *     Start(n)+2   height      BMHD +2
     *     Start(n)+4   mode        CAMG's low word, 0 when there is no CAMG
     *     Start(n)+6   depth       BMHD +8, one byte, sign-extended
     *     Start(n)+8   the file, from its `FORM`
     *
     * On the machine the eight bytes of the bank's NAME sit in front of that
     * and `Start` answers past them; here the name is a field of the bank, so
     * the reserve is still `size + 16` and the last eight bytes go unused.
     *
     * `moveq #$2,d1` on AllocDosObject is DOS_FIB and `move.l #$3ed,d2` on
     * Open is MODE_OLDFILE. A bank number of 0 is error 22 before anything is
     * opened, an unreadable file is 14, and anything that is not `FORM....
     * ILBM` is 15 --- checked after the whole file is in the bank, which is
     * why a 900KB text file is read before it is refused.
     */
    /**
     * `Wb Default` --- close everything this extension opened, in reverse
     * order, and let the libraries go.
     *
     * No arguments: the token spec is `I` and routine 39 pops nothing. It
     * counts DOWN from `$b66`, the highest window number, to zero inclusive,
     * and for each one ClearMenuStrips it (-$36), CloseWindows it (-$48),
     * frees its gadget list, its menu strip through gadtools FreeMenus and
     * its image buffer. Then FreeVisualInfo on `$d8c`, then the same descent
     * over `$b62` and the screen table with CloseScreen (-$42), then
     * `move.l #$ffffffff,$de6` so new windows go back to the Workbench,
     * UnlockPubScreen, and CloseLibrary on gadtools and asl.
     *
     * Three things it does NOT reset, and each is visible afterwards: `$d94`,
     * so `Wb Window Num` still names a window that is gone; the colour table
     * at `$884`; and the three requester settings. A program can call this
     * and then open a window straight back onto the pattern it set before.
     */
    'wb default': () => {
      const st = s()
      // descending, which is the order `dbra` gives the table
      for (const n of [...st.windows.keys()].sort((a, b) => b - a)) {
        const w = st.windows.get(n)!
        rt.intuition.closeWindow(w)
        st.windows.delete(n)
        st.strips.delete(n)
        st.menuList.delete(n)
        st.boolGadgets.delete(n)
        st.gtGadgets.delete(n)
        st.rports.delete(n)
      }
      for (const n of [...st.screens.keys()].sort((a, b) => b - a)) {
        rt.intuition.closeScreen(st.screens.get(n)!)
        st.screens.delete(n)
      }
      st.screen = -1
      st.activeGadget = -1
    },

    /**
     * `Wb Save Iff file$,screen` --- an intuition screen out to an ILBM,
     * through iffparse.
     *
     * The second argument is a `Wb Open Screen` number, not a bank: routine
     * 89 pops it into d0 and indexes `$6d4(a4)`, and -1 goes through routine
     * 88, which LockPubScreens the name at `$e30` --- the Workbench. It opens
     * layers.library and iffparse.library first, and the failures are error
     * 45 and error 46.
     *
     * It writes FORM ILBM with BMHD, CMAP, CAMG and BODY, through PushChunk
     * (-$54), WriteChunkBytes (-$42) and PopChunk (-$5a).
     *
     * The BODY IS NOT COMPRESSED, unlike AMOS's own `Save Iff`. The BMHD is
     * built in zone memory at `$bda`, which starts zeroed, and the only
     * fields routine 89 writes into it are Width, Height, nPlanes, PageWidth
     * and PageHeight --- so the compression byte at +10 and both aspect bytes
     * at +14 stay 0, and there is no ByteRun1 packer in its 2,166 bytes to
     * put a 1 there.
     */
    /**
     * `Wb Dt Image To Screen screen,window,file$,bank,mode` --- a picture
     * through `datatypes.library`, into a bank or onto a screen it opens
     * itself.
     *
     * Routine 83 opens `datatypes.library` version 37, `NewDTObjectA`s the
     * filename (-$30) and asks `GetDTAttrsA` (-$42) for the colour count and
     * the colour table. The picture's own size comes off the instance data at
     * `$136` of the object --- `$2` the ViewMode, `$4` the width, `$6` the
     * height --- and the colour registers are ULONG triples, which is why the
     * pack loop steps FOUR bytes a component (`move.b (a2)+,d1 /
     * addq.l #$3,a2`) and keeps only the top nibble of each.
     *
     * `mode` is the fifth argument and it picks between two whole arms,
     * `cmpi.b #$0,$d82(a4) / beq`:
     *
     *  - 0 opens a screen and a window for the picture ITSELF, by pushing
     *    nine parameters and calling routines 40 and 2 --- `Wb Open Screen`
     *    and `Wb Open Window` --- then LoadRGB4 and DrawImage.
     *  - anything else writes the bank named by the fourth argument, and the
     *    first two arguments are never popped.
     *
     * The bank is an `IFF.Raw ` one and routine 83 spells the name into it
     * with two immediates, `move.l #$4946462e` and `move.l #$52617720`. Then
     * the four words at `+8` --- width, height, ViewMode, colours --- and the
     * planes eight bytes past those, with three bytes of colour map per
     * colour after them. DataType_To_Bank.AMOS reads it straight back with
     * `Deek(Start(1))` and hands it to `Wb Image To Window`.
     *
     * APPROXIMATED, and for one reason: what this port can turn into
     * bitplanes. `datatypes.library` reaches a decoder per format and
     * ../amiga/datatypes.ts identifies every one it ships without decoding
     * any. ILBM goes through ../amiga/ilbm.ts and comes out exact. Anything
     * else --- a JPEG, which ../amiga/jpeg.ts decodes to 24-bit RGB and
     * nothing here quantises back down, or a format with no decoder at all
     * --- is error 38, "Cannot Read DataType", which is the library's own
     * answer for a file it cannot make a picture of.
     */
    'wb dt image to screen': (it) => {
      const st = s()
      const screenNum = it.evalInt()
      it.expect(',')
      const windowNum = it.evalInt()
      it.expect(',')
      const path = str(it.evalExpr())
      it.expect(',')
      const bank = it.evalInt()
      it.expect(',')
      const mode = it.evalInt() & 0xff
      // `NewDTObjectA` failing is `moveq #$27,d0` at $4ee0 -- error 39, "Not
      // An Image DataType" -- and it fails the same way for a file that is
      // not there as for one no descriptor claims
      const bytes = rt.fs?.read(path)
      if (!bytes) intError(INT_ERR.NOT_AN_IMAGE_DATATYPE)
      const dt = obtainDataType(bytes, SHIPPED_DATATYPES)
      if (dt && dt.groupID !== GID.PICTURE) intError(INT_ERR.NOT_AN_IMAGE_DATATYPE)
      let pic: IlbmImage
      try {
        pic = parseIlbm(bytes)
      } catch {
        // NOT one of routine 83's arms. Nothing in it loads 38, and 38 is the
        // only message in the table for a picture that will not read, so this
        // is where the port's own gap is reported rather than hidden: a
        // picture datatype recognised it and no decoder here can make planes
        // of it. See the coverage note.
        intError(INT_ERR.CANNOT_READ_DATATYPE)
      }
      // `move.l $cf2(a4),d0 / beq` at $4bfc, into `moveq #$29,d0`: a picture
      // with no colour map at all is error 41
      if (pic.palette.length === 0 && pic.depth === 0) intError(INT_ERR.NO_COLOURS_FOUND)
      const colours = pic.palette.length === 0 ? 1 << pic.depth : pic.palette.length
      for (let i = 0; i < colours && i < st.colours.length; i++) st.colours[i] = pic.palette[i] ?? 0
      if (mode === 0) {
        // the routine builds both parameter blocks itself and calls routines
        // 40 and 2. `Wb Open Screen` still wants `$de4` set, which is the
        // caller's business and not this keyword's.
        openIntScreen(rt, st, screenNum, 0, pic.width, pic.height, pic.depth, pic.mode)
        openIntWindow(rt, st, windowNum, 0, 0, pic.width, pic.height)
        const w = st.windows.get(windowNum)
        const scr = w ? rt.screens.get(w.screenSlot) : undefined
        if (scr) for (let i = 0; i < colours && i < scr.palette.length; i++) scr.palette[i] = st.colours[i]! & 0x0fff
        if (w) {
          const { rp, ox, oy } = target(windowNum)
          for (let y = 0; y < pic.height; y++) {
            for (let x = 0; x < pic.width; x++) {
              if (rp.inClip(ox + x, oy + y)) rp.putPixel(ox + x, oy + y, pic.pixels[y * pic.width + x]!)
            }
          }
        }
        return
      }
      // `move.w $dfe(a4),d3 / beq` --- bank 0 writes nothing at all and
      // raises nothing either
      if (bank === 0) return
      const rowBytes = ((pic.width + 15) >> 4) * 2
      const planeBytes = rowBytes * pic.height * pic.depth
      rt.reserveBank(bank, 16 + planeBytes + colours * 3, 'IFF.Raw ')
      const data = rt.memBanks.get(bank)!.data
      const put = (off: number, v: number): void => {
        data[off] = (v >> 8) & 0xff
        data[off + 1] = v & 0xff
      }
      put(0, pic.width)
      put(2, pic.height)
      put(4, pic.mode)
      // a DEPTH and not a count, which the reader settles rather than the
      // writer: routine 82's Raw arm takes this word and doubles 1 that many
      // times (`subq.l #$1,d1 / moveq #$1,d2 / mulu.w #$2,d2 / dbra`) to get
      // the number of colours, so the two halves of one extension would
      // contradict each other if it held anything else
      put(6, pic.depth)
      for (let y = 0; y < pic.height; y++) {
        for (let p = 0; p < pic.depth; p++) {
          const row = 8 + (y * pic.depth + p) * rowBytes
          for (let x = 0; x < pic.width; x++) {
            if ((pic.pixels[y * pic.width + x]! >> p) & 1) data[row + (x >> 3)]! |= 0x80 >> (x & 7)
          }
        }
      }
      const palAt = 8 + planeBytes
      for (let i = 0; i < colours; i++) {
        const v = pic.palette[i] ?? 0
        data[palAt + i * 3] = ((v >> 8) & 0xf) * 0x11
        data[palAt + i * 3 + 1] = ((v >> 4) & 0xf) * 0x11
        data[palAt + i * 3 + 2] = (v & 0xf) * 0x11
      }
    },

    'wb save iff': (it) => {
      const path = str(it.evalExpr())
      it.expect(',')
      const n = it.evalInt()
      const st = s()
      // routine 88 is LockPubScreen on the name at `$e30`, and locking the
      // default public screen is what brings the Workbench up if it is not
      if (n === -1) rt.intuition.openWorkBench()
      const slot = n === -1 ? WB_SLOT : rt.intuition.slotOf(st.screens.get(n) ?? 0)
      const scr = slot === null ? undefined : rt.screens.get(slot)
      if (!scr) intError(INT_ERR.CANNOT_FIND_SCREEN)
      const camg = (scr.hires ? 0x8000 : 0) | (scr.laced ? 4 : 0) | (scr.ham ? 0x800 : 0) | (scr.ehb ? 0x80 : 0)
      const bytes = encodeIlbm(
        { width: scr.width, height: scr.height, depth: scr.depth, mode: camg, palette: [...scr.palette], pixels: scr.pixels },
        { compression: 0, aspect: [0, 0] },
      )
      if (!rt.vfs?.writeFile(path, bytes)) intError(INT_ERR.COULD_NOT_SAVE_IFF)
    },

    'wb iff to bank': (it) => {
      const path = str(it.evalExpr())
      it.expect(',')
      const n = it.evalInt()
      if (n === 0) intError(INT_ERR.BANK_NUMBER_IS_TO_LOW)
      // `move.w (a0)+,d1 / beq` --- an empty name never reaches Open
      if (path === '') intError(INT_ERR.FILE_NOT_FOUND)
      const bytes = rt.fs?.read(path)
      if (!bytes) intError(INT_ERR.FILE_NOT_FOUND)
      rt.reserveBank(n, bytes.length + 16, 'IFF.Pic.')
      const data = rt.memBanks.get(n)!.data
      data.set(bytes, 8)
      const id = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4))
      if (bytes.length < 12 || id(0) !== 'FORM' || id(8) !== 'ILBM') intError(INT_ERR.NOT_AN_IFF_FILE)
      const be32 = (at: number): number =>
        ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
      const put = (off: number, v: number): void => {
        data[off] = (v >> 8) & 0xff
        data[off + 1] = v & 0xff
      }
      // the walk is `bsr` to a four-byte reader, twice per chunk, and it
      // stops at BODY without ever looking for the chunk it wants again
      const form = be32(4)
      let at = 12
      let seen = 12
      for (;;) {
        if (at + 8 > bytes.length) break
        const chunk = id(at)
        const len = be32(at + 4)
        if (chunk === 'BODY') break
        if (chunk === 'BMHD') {
          put(0, (bytes[at + 8]! << 8) | bytes[at + 9]!)
          put(2, (bytes[at + 10]! << 8) | bytes[at + 11]!)
          // `move.b $8(a0),d0 / ext.w d0` -- nPlanes is one byte and it is
          // sign-extended, so a depth above 127 comes back negative
          put(6, ((bytes[at + 16]! << 24) >> 24) & 0xffff)
        }
        if (chunk === 'CAMG') put(4, (bytes[at + 10]! << 8) | bytes[at + 11]!)
        at += 8 + len + (len & 1)
        seen += 8 + len
        if (seen >= form) break
      }
    },

    /**
     * `Wb Get Iff Palette bank,screen` --- a colour map into `$884` and then
     * LoadRGB4 on the screen's ViewPort.
     *
     * Routine 82 takes three kinds of bank, told apart by the eight bytes of
     * name that begin one:
     *
     *  - `IFF.Pic.` --- walk the FORM at `Start(n)+8` for a CMAP, then
     *    `move.l (a0)+,d0 / divu.w #$3,d0` for the colour count.
     *  - `IFF.Raw ` --- no chunks at all: the palette is `3 * 2^depth` bytes
     *    at the END of the bank, found by subtracting from the bank's length.
     *  - `Icons   ` --- 32 words sitting just past the image table, which it
     *    loads by pushing 32 and calling `Wb Load Rgb` itself.
     *
     * The RGB4 packing is four instructions and no rounding: `andi.w #$f0`
     * on red, then two `lsr.b #$4`, so each 8-bit component keeps its top
     * nibble and the bottom one is dropped.
     *
     * The screen is `$6d4`, the `Wb Open Screen` table, or the Workbench for
     * -1. A number with nothing in the table is error 36.
     *
     * DEFECT: `divu.w` leaves its REMAINDER in the top half of d0 and
     * `move.l d0,d4` takes the whole longword, which is what LoadRGB4 is
     * given as a count. A CMAP whose length is not a multiple of three
     * therefore asks for tens of thousands of colours. Every well-formed one
     * is a multiple of three, which is why it has never mattered.
     */
    'wb get iff palette': (it) => {
      const st = s()
      const bank = it.evalInt()
      it.expect(',')
      const scrNum = it.evalInt()
      if (bank === 0) intError(INT_ERR.BANK_NUMBER_IS_TO_LOW)
      let count = 0
      if (bank === ICON_BANK && rt.iconBank) {
        // the icon bank's own palette, which ../runtime/objects.ts keeps
        // beside the images rather than after them
        const pal = rt.iconBank.palette
        for (let i = 0; i < 32; i++) st.colours[i] = pal[i] ?? 0
        count = 32
      } else {
        const mem = rt.memBanks.get(bank)
        if (!mem) intError(INT_ERR.NO_IFF_IN_BANK)
        const rgb = iffBankPalette(mem.name, mem.data)
        if (rgb === null) intError(INT_ERR.NO_IFF_IN_BANK)
        for (let i = 0; i < rgb.length && i < st.colours.length; i++) st.colours[i] = rgb[i]!
        count = rgb.length
      }
      // `$d96` empty is LockPubScreen with the name at `$e30`, which brings
      // the Workbench up when it is not already there
      if (scrNum === -1) rt.intuition.openWorkBench()
      const slot = scrNum === -1 ? WB_SLOT : rt.intuition.slotOf(st.screens.get(scrNum) ?? 0)
      if (slot === null) intError(INT_ERR.CANNOT_FIND_SCREEN)
      const scr = rt.screens.get(slot)
      if (!scr) intError(INT_ERR.CANNOT_FIND_SCREEN)
      for (let i = 0; i < count && i < scr.palette.length; i++) scr.palette[i] = st.colours[i]! & 0x0fff
    },

    /**
     * `Wb Image To Window window,bank` --- the picture in a bank, decoded and
     * drawn at the window's origin, with its colour map.
     *
     * Routine 50 takes the same two bank names as `Wb Get Iff Palette` and
     * tells them apart the same way, `IFF.Pic.` through a full chunk walk and
     * `IFF.Raw ` with `moveq #$ff,d2` marking it. It clears twenty-four
     * longwords of workspace at `$b02` first, decodes BMHD, CMAP, CRNG and
     * CAMG, unpacks the BODY into memory it AllocMems, hands the result to
     * DrawImage (-$72) at 0,0 and the colour map to LoadRGB4 (-$c0). So the
     * picture lands at the window's top-left corner and brings its palette
     * with it --- which is why iff_to_bank.AMOS never calls
     * `Wb Get Iff Palette` and the picture still comes out in colour.
     *
     * The argument order is window first and bank second, the reverse of
     * `Wb Get Iff Palette`: routine 50 pops the bank into d3 and the window
     * into d7, and a3 walks the parameter block backwards.
     */
    'wb image to window': (it) => {
      const win = it.evalInt()
      it.expect(',')
      const bank = it.evalInt()
      if (bank === 0) intError(INT_ERR.BANK_NUMBER_IS_TO_LOW)
      const mem = rt.memBanks.get(bank)
      if (!mem) intError(INT_ERR.NO_IFF_IN_BANK)
      const pic = iffBankImage(mem.name, mem.data)
      if (pic === null) intError(INT_ERR.NO_IFF_IN_BANK)
      const { rp, ox, oy } = target(win)
      const scr = rt.screens.get(windowOf(s(), win).screenSlot)
      if (scr) for (let i = 0; i < pic.palette.length && i < scr.palette.length; i++) scr.palette[i] = pic.palette[i]! & 0x0fff
      for (let y = 0; y < pic.height; y++) {
        for (let x = 0; x < pic.width; x++) {
          const sx = ox + x
          const sy = oy + y
          if (rp.inClip(sx, sy)) rp.putPixel(sx, sy, pic.pixels[y * pic.width + x]!)
        }
      }
    },

    'wb paste icon': (it) => {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      const bank = rt.iconBank
      if (!bank || bank.images.length === 0) intError(INT_ERR.NO_ICONS_IN_BANK)
      // one-based, and only the upper end is checked
      if (n > bank.images.length) return
      const img = bank.images[n - 1]
      if (!img) return
      const { rp, ox, oy } = target()
      const px = img.pixels
      for (let iy = 0; iy < img.height; iy++) {
        for (let ix = 0; ix < img.width; ix++) {
          const sx = ox + x + ix
          const sy = oy + y + iy
          // DrawImage is a blitter copy through PlanePick, not a drawn
          // primitive: no draw mode, no pattern, and colour 0 is a colour
          if (rp.inClip(sx, sy)) rp.putPixel(sx, sy, px[iy * img.width + ix]!)
        }
      }
    },

  }
}

/**
 * One of the current window's gadtools gadgets, by position in the chain.
 *
 * The walk is `movea.l (a0),a0 / dbra d1,...` from the list head, so the
 * argument is a distance and not the GadgetID `Wb Gt Gadget` was given.
 * Running off the end is error 17.
 */
function gtGadgetOf(st: IntState, n: number): Gadget {
  const chain = st.gtGadgets.get(st.window) ?? []
  return chain[n] ?? intError(17)
}

/**
 * EntNul (+Equ.s:39), which is what an empty integer slot compiles to.
 *
 * It matters here because the author's own examples leave the slots empty:
 * `Wb Window Flags %100000000000,%1000000000000,,,,,,,` is ellipse1.AMOS and
 * ellipse2.AMOS, and `Wb Screen Flags %1111,,,,,,,` is scroll.AMOS. Seven
 * EntNuls go into the sum, and the two keywords disagree about what that
 * does: routine 9 stores the LONG (`move.l d1,$190`), so bit 31 survives into
 * NewWindow.Flags, and routine 42 stores a WORD (`move.w d1,$de4`), so it
 * does not. Intuition defines nothing at bit 31, which is why the examples
 * work anyway.
 */
const ENT_NUL = -0x8000_0000

/**
 * One argument of a flag list, or EntNul when the slot is empty.
 *
 * The test is ./instr.ts's, where `Limit Mouse` needs the same thing.
 */
function flagArg(it: Parameters<Instr>[0]): number {
  return it.atStmtEnd() || it.nm() === ',' || it.nm() === 'to' ? ENT_NUL : it.evalInt()
}


/**
 * wd_MouseX or wd_MouseY of the current window, as routines 17 and 18 read
 * them: no error, and zero-extended from a word.
 */
function windowCoord(st: IntState, pick: (w: Window) => number): number {
  const w = st.windows.get(st.window)
  return w === undefined ? 0 : pick(w) & 0xffff
}

/** the nine arguments `Wb Window Flags` and `Wb Window Ids` add together */
function sumNine(it: Parameters<Instr>[0]): number {
  let f = flagArg(it)
  for (let i = 1; i < 9; i++) {
    it.expect(',')
    f += flagArg(it)
  }
  return f >>> 0
}

/**
 * `x1,y1 To x2,y2` --- the `I0,0t0,0` specs, where the `t` is the To.
 *
 * `Wb Draw`, `Wb Fill Box` and `Wb Box` all carry it, and `Wb Ellipse` does
 * not: its spec is four plain commas.
 */
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


/**
 * Four comma-separated integers, the shape both open keywords start with.
 *
 * Through `flagArg`, because the author's own examples leave them empty:
 * `Wb Open Window 0,0,10,140,50,,,,` is window_move.AMOS, where the four
 * NewWindow limits are all elided. An empty slot compiles to EntNul and this
 * port has to read one rather than fail to parse it.
 */
function four(it: Parameters<Instr>[0], leading = false): [number, number, number, number] {
  const out: number[] = []
  for (let i = 0; i < 4; i++) {
    if (i > 0 || leading) it.expect(',')
    out.push(flagArg(it))
  }
  return [out[0]!, out[1]!, out[2]!, out[3]!]
}

/**
 * The colour map of an `IFF.Pic.` or `IFF.Raw ` bank, as RGB4 words.
 *
 * Null for a bank whose eight-byte name is neither, which routine 82 answers
 * with error 16. The packing keeps each component's top nibble and drops the
 * rest: `andi.w #$f0,d1` and two `lsr.b #$4`, with no rounding anywhere.
 */
function iffBankPalette(rawName: string, data: Uint8Array): number[] | null {
  // routine 82 compares EIGHT BYTES of the bank's data. A bank's name is held
  // here the way the loader holds one, trailing spaces off -- see
  // `Runtime.reserveBank` -- so `IFF.Raw ` arrives as `IFF.Raw`.
  const name = rawName.trimEnd()
  const rgb4 = (r: number, g: number, b: number): number => ((r & 0xf0) << 4) | (g & 0xf0) | (b >> 4)
  const be32 = (at: number): number =>
    ((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0
  if (name === 'IFF.Raw') {
    // `3 * 2^depth` bytes at the very end, reached by subtracting from the
    // bank's own length rather than by any chunk walk
    const depth = ((data[6]! << 8) | data[7]!) & 0xffff
    const n = 1 << depth
    const at = data.length - 8 - n * 3
    if (at < 8) return null
    const out: number[] = []
    for (let i = 0; i < n; i++) out.push(rgb4(data[at + i * 3]!, data[at + i * 3 + 1]!, data[at + i * 3 + 2]!))
    return out
  }
  if (name !== 'IFF.Pic.') return null
  // the FORM begins eight bytes into the bank; walk to CMAP
  const form = be32(12)
  let at = 20
  let seen = 12
  while (at + 8 <= data.length && seen < form) {
    const chunk = String.fromCharCode(...data.subarray(at, at + 4))
    const len = be32(at + 4)
    if (chunk === 'CMAP') {
      const n = Math.floor(len / 3)
      const out: number[] = []
      for (let i = 0; i < n; i++) {
        const p = at + 8 + i * 3
        out.push(rgb4(data[p]!, data[p + 1]!, data[p + 2]!))
      }
      return out
    }
    at += 8 + len + (len & 1)
    seen += 8 + len
  }
  return null
}

/**
 * The picture in an `IFF.Pic.` or `IFF.Raw ` bank, or null for a bank that is
 * neither --- which routine 50 answers with error 16.
 *
 * `IFF.Pic.` holds the file whole from `Start(n)+8`, so the decoder is
 * ../amiga/ilbm.ts's. `IFF.Raw ` is what `Wb Dt Image To Screen` writes
 * instead: no chunks at all, the four-word header and then the planes, with
 * `3 * 2^depth` bytes of colour map at the end. That layout is DERIVED, from
 * routine 82's `lea $18(a0),a0` and its subtraction off the bank's length,
 * and nothing in this port writes such a bank yet for it to be checked
 * against.
 */
function iffBankImage(rawName: string, data: Uint8Array): IlbmImage | null {
  const name = rawName.trimEnd()
  if (name === 'IFF.Pic.') {
    try {
      return parseIlbm(data.subarray(8))
    } catch {
      return null
    }
  }
  if (name !== 'IFF.Raw') return null
  const w = (at: number): number => ((data[at]! << 8) | data[at + 1]!) & 0xffff
  const width = w(0)
  const height = w(2)
  const mode = w(4)
  const depth = w(6)
  const palette = iffBankPalette(rawName, data)
  if (palette === null || width === 0 || height === 0 || depth === 0) return null
  const rowBytes = ((width + 15) >> 4) * 2
  const pixels = new Uint8Array(width * height)
  // the planes begin eight bytes into `Start(n)`, past the four-word header:
  // routine 83 writes them at `$10(a0) + $10` where the bank data starts at
  // `$10(a0)` and `Start` answers eight bytes into it, past the name
  const at = 8
  for (let y = 0; y < height; y++) {
    for (let p = 0; p < depth; p++) {
      const row = at + (y * depth + p) * rowBytes
      for (let x = 0; x < width; x++) {
        const b = data[row + (x >> 3)] ?? 0
        if ((b >> (7 - (x & 7))) & 1) pixels[y * width + x] = (pixels[y * width + x] ?? 0) | (1 << p)
      }
    }
  }
  return { width, height, depth, mode, palette, pixels }
}

export function makeIntFunctions(rt: Runtime): Record<string, Func> {
  const s = (): IntState => rt.int

  return {
    /**
     * `A=Wb Event` --- GetMsg, ReplyMsg, and answer what came.
     *
     * It does NOT block: `tst.l d0 / beq` on GetMsg's answer returns 0 with
     * the three menu fields put back to -1, which is the idle case the
     * examples loop on.
     *
     * What it returns is the IDCMP CLASS, except for two arms. GADGETUP hands
     * back the gadget's own id out of `$26` of the Gadget in IAddress, and
     * MENUPICK decodes the code into `Wb Menu`, `Wb Item` and `Wb Sub Item`
     * and then returns the class $100 anyway. So a gadget whose id happens to
     * be $200 is indistinguishable from the close gadget.
     */
    'wb event': (): Value => {
      const st = s()
      const w = st.windows.get(st.window)
      if (w === undefined) intError(INT_ERR.WINDOW_IS_NOT_OPEN)
      st.current = st.window
      const m = w.getMsg()
      if (m === null) {
        st.menu = -1
        st.item = -1
        st.sub = -1
        return VI(0)
      }
      if (m.class === IDCMP_GADGETUP) return VI(m.iaddress === 0 ? 0 : gadgetIdOf(w, m.iaddress))
      if (m.class !== IDCMP_MENUPICK) {
        st.menu = -1
        st.item = -1
        st.sub = -1
        return VI(m.class)
      }
      decodeMenu(st, m.code)
      return VI(IDCMP_MENUPICK)
    },

    /**
     * `A=Wb Menu`, `A=Wb Item` and `A=Wb Sub Item` --- what the last MENUPICK
     * decoded to, ONE-BASED.
     *
     * Each reader adds one to what the pump stored, and -1 comes back as 0.
     * So a program tests `If ITEM>0` rather than for -1, which is what the
     * examples do.
     *
     * DEFECT: the pump writes the item OR the sub-item and never both. The
     * arm at $30b6 stores the item and returns; the arm at $30d0 stores the
     * sub-item and returns. So after a sub-item is picked `Wb Item` still
     * reports whatever the previous pick left there.
     *
     * DEFECT: the menu number is `code & $f` where MENUNUM is five bits.
     * `lsl.b #$4,d4 / lsr.b #$4,d4` isolates four, so menu 16 reads as menu 0
     * and menu 17 as menu 1. Nothing in the examples has sixteen menus.
     */
    'wb menu': (): Value => VI(s().menu),
    'wb item': (): Value => VI(oneBased(s().item)),
    'wb sub item': (): Value => VI(oneBased(s().sub)),

    /**
     * `A$=Wb Gt String(n)` --- a STRING gadget's buffer, read out of the
     * StringInfo at `$22` of the Gadget.
     *
     * The chain is walked n+1 times from the list head, so the argument is a
     * distance rather than the GadgetID.
     *
     * DEFECT: zero is refused, and with the wrong message. `move.l (a3)+,d0 /
     * beq` at $451c jumps to the arm that loads `moveq #$b,d0`, which is
     * "Window Is Not Open" --- so asking for the first gadget of a window that
     * is plainly open is reported as the window not being open.
     */
    'wb gt string': (_, a): Value => {
      const st = s()
      const n = int(a[0]!)
      if (st.windows.get(st.window) === undefined) intError(INT_ERR.WINDOW_IS_NOT_OPEN)
      if (n === 0) intError(INT_ERR.WINDOW_IS_NOT_OPEN)
      const chain = st.gtGadgets.get(st.window) ?? []
      return VS(chain[n]?.string ?? '')
    },

    /** `A=Wb Current Window` --- `$e02`, which `Wb Event` and `Wb Open Window` set */
    'wb current window': (): Value => VI(s().current),

    /**
     * `A=Wb Window Base(n)` --- the `struct Window *`, and only for 0 to 21.
     *
     * DEVIATION: nothing in this port has a Window at an address, so the
     * number is minted per window and is stable while it is open. What a
     * program can do with it is test it, which is what Image_View.AMOS does
     * with `Wb Screen Base` beside it: `If SCR>0 : Wb Close Screen 0`.
     */
    'wb window base': (_, a): Value => {
      const st = s()
      const n = int(a[0]!)
      if (n > READ_LIMIT) intError(INT_ERR.NUMBER_IS_TO_HIGH)
      const w = st.windows.get(n)
      return VI(w === undefined ? 0 : WINDOW_BASE_ORIGIN + n * 4)
    },

    /**
     * `A=Wb Screen Base(n)` --- the `struct Screen *`, for 0 to 99.
     *
     * The real address this time, because `Wb Screen Num` takes one back and
     * intuition.ts already mints them for OpenScreen.
     */
    'wb screen base': (_, a): Value => {
      const n = int(a[0]!)
      if (n > MAX_SCREEN) intError(INT_ERR.NUMBER_0_100)
      return VI(s().screens.get(n) ?? 0)
    },

    /* ------------------------------------------------------------------
     * The input group's readers. See the instructions for what they share.
     * ------------------------------------------------------------------ */

    /**
     * `=Wb Asl Req(title$,ok$,cancel$,type,patterns,left,top,width,height)`
     * --- asl.library's requester, and the only keyword here that opens one.
     *
     * Routine 21 opens `asl.library` version 37, AllocAslRequests one of the
     * three types on first use and keeps it (`$a96`, `$a9a`, `$a9e`, one per
     * type), then fills a fourteen-tag list at `$c12(a4)` and calls
     * AslRequest (-$3c). The tags are a template in the code hunk at file
     * offset `0x12fc` and only their VALUES are written, which is why the
     * disassembly shows stores at `+4`, `+$c`, `+$14` and never a tag:
     *
     *     ASL_Hail          arg1        ASL_File         fr_File
     *     ASL_OKText        arg2        ASL_Dir          fr_Drawer or `Wb Asl Dir`
     *     ASL_CancelText    arg3        ASL_Pattern      `Wb Asl Pattern`
     *     ASLFR_DOPATTERNS  arg5        ASLFR_REJECTICONS `Wb Asl Info`
     *     ASL_LeftEdge      arg6        ASL_FuncFlags    the template's own
     *     ASL_TopEdge       arg7        ASLFR_SCREEN     `$de6`, or 0
     *     ASL_Width         arg8
     *     ASL_Height        arg9
     *
     * ASLFR_REJECTICONS is `Wb Asl Info`, and the author's comment on it in
     * iff_to_bank.AMOS --- "1= Dont Show Info Files 0=Show Info Files" ---
     * is exactly what that tag does, which is what identified it.
     *
     * `arg4` is the TYPE and never reaches the tag list: 0 is a file
     * requester, 1 a font one and 2 a screen-mode one, and `cmpi.l #$3,d0 /
     * Rbge` makes anything else error 44, "Only Type 1 Is Allowed".
     *
     * On OK the routine joins `fr_Drawer` and `fr_File` by hand in the buffer
     * at `$ab6`, adding a `/` unless the drawer already ends in one or in a
     * `:`. A cancel is `tst.l d0 / beq`, and the answer is the empty string.
     *
     * DEVIATION: types 1 and 2 open nothing and answer the empty string. The
     * file requester is ../amiga/asl.ts and ./aslreq.ts; a font and a screen
     * mode requester are two more layouts on the same frame, and neither has
     * a caller in this port yet.
     */
    'wb asl req': (it, a): Value => {
      const st = s()
      // resuming: the requester is still up, or it has just answered
      if (rt.asl) {
        if (rt.asl.done) {
          const r = rt.asl.result
          rt.asl = null
          st.aslFile = r === '' ? '' : r.slice(r.lastIndexOf('/') + 1)
          return VS(r)
        }
        it.block({ type: 'asl' }, true)
        return VS('')
      }
      const title = str(a[0]!)
      const okText = str(a[1]!)
      const cancelText = str(a[2]!)
      const type = int(a[3]!)
      // `cmpi.l #$3,d0 / Rbge routine 95`, and routine 95 is `moveq #$17,d0 /
      // Rjmp L_Error` -- AMOS's own error 23 and not one of Int's messages.
      // The compare is SIGNED, so a NEGATIVE type falls past it and lands on
      // the file arm at $2b48 along with 0.
      if (type >= 3) funcCall()
      // `cmpi.l #$0,d4 / bne.w $2d7c` AFTER AslRequest: only the FILE
      // requester goes on to join a path, so the other two answer the empty
      // string on the machine's own code path too. The font one still OPENS
      // here, because `Wb Asl Req(...,1,...)` opening nothing at all would be
      // a different program from one whose user cancelled -- and the routine
      // does AllocAslRequest a FontRequest at $2b6c and keep it.
      if (type === ASL_TYPE.FONT) {
        if (rt.aslFont) {
          if (rt.aslFont.done) {
            rt.aslFont = null
            return VS('')
          }
          it.block({ type: 'asl' }, true)
          return VS('')
        }
        const opened = rt.startAslFontRequest(
          {
            hail: title,
            okText,
            cancelText,
            left: int(a[5]!),
            top: int(a[6]!),
            width: int(a[7]!),
            height: int(a[8]!),
            name: '',
            size: 0,
          },
          st.screen === -1 ? null : rt.intuition.slotOf(st.screen),
        )
        if (!opened) return VS('')
        it.block({ type: 'asl' }, true)
        return VS('')
      }
      if (type === ASL_TYPE.SCREENMODE) {
        // routine 21 AllocAslRequests a ScreenModeRequest at $2b8c and keeps
        // it, so this one opens too and its answer goes the same way the
        // font one's does: nowhere, because only the FILE arm builds a string
        if (rt.aslMode) {
          if (rt.aslMode.done) {
            rt.aslMode = null
            return VS('')
          }
          it.block({ type: 'asl' }, true)
          return VS('')
        }
        const opened = rt.startAslModeRequest(
          {
            hail: title,
            okText,
            cancelText,
            left: int(a[5]!),
            top: int(a[6]!),
            width: int(a[7]!),
            height: int(a[8]!),
            id: 0,
            displayWidth: 0,
            displayHeight: 0,
            depth: 2,
          },
          st.screen === -1 ? null : rt.intuition.slotOf(st.screen),
        )
        if (!opened) return VS('')
        it.block({ type: 'asl' }, true)
        return VS('')
      }
      const upTo = (b: Uint8Array): string => {
        let out = ''
        for (const c of b) {
          if (c === 0) break
          out += String.fromCharCode(c)
        }
        return out
      }
      const setup: AslFileSetup = {
        hail: title,
        okText,
        cancelText,
        doPatterns: int(a[4]!) !== 0,
        left: int(a[5]!),
        top: int(a[6]!),
        width: int(a[7]!),
        height: int(a[8]!),
        // `$8(a0)` is fr_Drawer and an EMPTY one falls back to `Wb Asl Dir`
        dir: upTo(st.aslDir) === '' ? (rt.vfs?.currentDir ?? '') : upTo(st.aslDir),
        file: st.aslFile,
        pattern: upTo(st.aslPattern),
        rejectIcons: st.aslHideInfo !== 0,
      }
      const slot = st.screen === -1 ? null : rt.intuition.slotOf(st.screen)
      if (!rt.startAslRequest(setup, slot)) return VS('')
      it.block({ type: 'asl' }, true)
      return VS('')
    },

    /**
     * `=Wb Mousex` and `=Wb Mousey` --- wd_MouseX and wd_MouseY of the
     * current window, which are window-relative.
     *
     * `move.w $e(a1),d3` and `move.w $c(a1),d3`, and the offsets are what the
     * struct says: wd_NextWindow is a pointer at 0, then four words of
     * geometry, so `intuition.i:690` puts wd_MouseY at 12 and wd_MouseX at 14
     * --- Y FIRST, which is the order the header has them in and the reverse
     * of every other pair in the file.
     *
     * Two things neither reader does. It does not raise: routines 17 and 18
     * are `movea.l d0,a1 / beq` into a `moveq #$0,d3`, so a window that is
     * not open answers 0 rather than "Window Is Not Open". And the word is
     * ZERO-extended into a cleared d3, so a pointer left of or above the
     * window --- wd_MouseX is signed and goes negative there --- comes back
     * as 65535 rather than as -1.
     */
    'wb mousex': (): Value => VI(windowCoord(s(), (w) => w.mouseX)),
    'wb mousey': (): Value => VI(windowCoord(s(), (w) => w.mouseY)),

    /**
     * `=Wb Keycode` --- the raw key out of CIA-A's serial register, with bit
     * 7 flipped.
     *
     * Routine 30 does the canonical decode and then one instruction more:
     *
     *     move.b $bfec01.l, d0
     *     tst.b  d0 / beq -> moveq #$ff,d3
     *     eori.b #$ff, d0        not: undo the keyboard's invert
     *     ror.b  #$1, d0         undo its rotate -> the scancode
     *     subi.b #$80, d0
     *
     * `not` then `ror #1` is the undo every reader on the machine does (see
     * ../amiga/keyboard.ts), and it leaves the scancode with bit 7 set for a
     * release. `subi.b #$80` on a byte then FLIPS that bit: a press answers
     * scancode + 128 and a release answers the scancode on its own. So the
     * high half of the range is what is going down and the low half is what
     * is coming up, which is the opposite way round from the wire.
     *
     * An empty register is `moveq #$ff,d3`, which is -1 and not 255.
     */
    'wb keycode': (): Value => {
      const sdr = rt.input.sdr & 0xff
      if (sdr === 0) return VI(-1)
      const code = ((~sdr & 0xff) >> 1) | ((~sdr & 0x01) << 7)
      return VI((code - 0x80) & 0xff)
    },

    /**
     * `=Wb Mouse Key` --- 1 while the left button is down, -1 while it is up.
     *
     * `btst.b #$6,$bfe001.l` on CIA-A's PRA, where /FIR0 is active LOW, so
     * the `beq` arm --- bit clear --- is the pressed one and it loads
     * `moveq #$1,d3`. The other loads `moveq #$ff,d3`, which is -1.
     *
     * Note the polarity against everything else in this tree: TURBO's
     * `Left Click` and The Game's `G Left Click` answer -1 for PRESSED and 0
     * for not. This one is 1 and -1, and never 0.
     *
     * It opens with `Rbsr routine 4`, WaitBlit, for no reason a read of a CIA
     * register can have.
     */
    'wb mouse key': (): Value => VI((rt.machine.cia.pra() & CIAF_GAMEPORT0) === 0 ? 1 : -1),

    /**
     * `=Wb Joy(port)` --- ONE direction from the gameport counters, plus 100
     * for a fire.
     *
     * Routine 53 reads `$dff00c` when the argument is exactly 1 and `$dff00a`
     * otherwise, then tests four things in order and lets each overwrite the
     * last:
     *
     *     btst #$9  -> 1      bit 9, which is LEFT
     *     btst #$1  -> 2      bit 1, RIGHT
     *     d0 & 3 is 1 or 2      -> 3    bit 0 XOR bit 1, DOWN
     *     d0 & $300 is $100/$200 -> 4   bit 8 XOR bit 9, UP
     *
     * The bit meanings are the register's, not the extension's: a digital
     * stick puts `left` on 9, `right` on 1, `right^down` on 0 and `left^up`
     * on 8 (../amiga/gameport.ts `joyDatOf`, off `custom.i`). So this answers
     * a single number and a diagonal loses one of its two directions --- the
     * LAST test to match wins, which makes up beat down beat right beat left.
     *
     * DEFECT: the fire bonus is always port 1's. `btst.b #$7,$bfe001.l` ---
     * /FIR1 --- is read at $3e8a, BEFORE the argument is popped at $3e9e, so
     * `Wb Joy(0)` reads port 0's stick and port 1's button.
     */
    'wb joy': (_, a): Value => {
      const fire = (rt.machine.cia.pra() & CIAF_GAMEPORT1) === 0 ? 100 : 0
      const w = joyDatOf(rt.input.ports[int(a[0]!) === 1 ? 1 : 0])
      let dir = 0
      if ((w & (1 << 9)) !== 0) dir = 1
      if ((w & (1 << 1)) !== 0) dir = 2
      const low = w & 3
      if (low === 1 || low === 2) dir = 3
      const high = w & 0x300
      if (high === 0x100 || high === 0x200) dir = 4
      return VI(dir + fire)
    },

    /**
     * `=Wb File` --- the filename the last `Wb Asl Req` answered.
     *
     * Routine 35 reads `$a96`, the FileRequester `Wb Asl Req` allocated, then
     * `$4(a0)`, which is `fr_File`. It walks that to the NUL to measure it
     * and then writes the length word into the two bytes BEFORE the buffer
     * (`move.w d0,-(a1)`) so the result can be handed back as an AMOS string
     * without copying --- so it scribbles two bytes onto asl.library's own
     * structure every time it is called.
     *
     * An empty `fr_File` is `tst.l (a0) / beq` into `moveq #$0,d3`, a null
     * string pointer with the type still 2. That is the empty string.
     *
     * The name has no `$` on it, which is the token table's spelling and not
     * a slip here: the entry is `wb file` with spec `2`.
     */
    'wb file': (): Value => VS(s().aslFile),

    /**
     * `=Wb Find String(a$, start To end, fold)` --- a byte search of the
     * modelled address space, and it does not work.
     *
     * Routine 71 walks `a1` from `start` and matches the pattern byte by
     * byte, taking the byte after the string as its terminator. On a
     * mismatch, with `fold` zero, it reaches this:
     *
     *     cmpa.l a1, a2
     *     bge.b  (not found, answer 0)
     *     movea.l d3, a0        reset the pattern
     *     bra    (try again at a1)
     *
     * DEFECT: `cmpa.l a1,a2` computes `a2 - a1`, and `a2` is `end` while `a1`
     * is where the scan has got to. For any search where `end` is above
     * `start` --- which is every sensible one --- the branch is taken on the
     * FIRST mismatched byte and the answer is 0. So it can only ever find a
     * string that begins exactly at `start`. The bytes are `B5 C9 6C` at file
     * offset `0x46f4`, checked against the library rather than read off the
     * listing, because a defect this total is worth being sure of. Nothing in
     * the eighteen example programs calls this keyword.
     *
     * DEFECT: and a match answers `start + 1`. The success arm is
     * `move.l a1,d3 / sub.l d4,d3 / addq.l #$1,d3` with `a1` one past the
     * matched bytes and `d4` the pattern's length, so the address it computes
     * is one above where the match began.
     *
     * The `fold` path compares the pattern against the memory byte plus 32
     * and then against it minus 32, which is case-insensitivity for letters.
     * It does that by WRITING to the memory it is searching --- `addi.b
     * #$20,(a1)`, compare, `subi.b #$20,-(a1)` --- and every path puts the
     * byte back, so nothing here can see it happen. On the machine it makes
     * the keyword unusable on ROM.
     */
    'wb find string': (_, a): Value => {
      const pat = str(a[0]!)
      const end = int(a[2]!)
      const fold = int(a[3]!)
      const byteAt = (addr: number): number => {
        const m = rt.resolveAddr(addr >>> 0)
        return m ? (m.data[m.off] ?? 0) : 0
      }
      // a transliteration, because every branch here matters: `a1` is the
      // scan pointer, `ai` is a0's distance into the pattern, and the arm at
      // $46d4 jumps back to the MATCH label and not to the top, so the
      // `a1 == a2` test happens exactly once
      let a1 = int(a[1]!)
      const found = (): Value => VI((a1 - pat.length + 1) | 0)
      if (a1 === end) return found()
      let ai = 0
      for (;;) {
        if (ai === pat.length) return found()
        const want = pat.charCodeAt(ai) & 0xff
        const got = byteAt(a1)
        ai++
        a1++
        if (want === got) continue
        if (fold !== 0 && (want === ((got + 0x20) & 0xff) || want === ((got - 0x20) & 0xff))) continue
        if (end >= a1) return VI(0)
        ai = 0
      }
    },
  }
}

/**
 * Where `Wb Window Base` answers from.
 *
 * DEVIATION: there is no `struct Window` at an address here, which is the same
 * hole ./gui.ts fills for `Gui Gad Adr`. `0x7c90_0000` because the neighbouring
 * origins are taken --- `0x7c80_0000` is GUI 1.61's TCP handles.
 */
const WINDOW_BASE_ORIGIN = 0x7c90_0000

/** -1 comes back as 0 and everything else gains one, `addq.l #$1,d3` */
function oneBased(v: number): number {
  return v === -1 ? 0 : v + 1
}

/** which of the window's gadgets an IAddress names */
function gadgetIdOf(w: Window, iaddress: number): number {
  return w.gadgets.find((g) => g.id === iaddress)?.id ?? iaddress
}

/**
 * MENUPICK's code, as routine 28 takes it apart.
 *
 * `$ffff` is MENUNULL and clears all three. Otherwise the menu is the low
 * four bits plus one, and then `(code >> 5) - $7c0` decides which of the
 * other two fields is written: negative means the sub-item number is real
 * (NOSUB is $1f, and $1f << 6 is $7c0), and zero or above means there is no
 * sub-item and the value IS the item.
 */
function decodeMenu(st: IntState, code: number): void {
  if (code === MENUNULL) {
    st.menu = -1
    st.item = -1
    st.sub = -1
    return
  }
  st.menu = (code & 0xf) + 1
  if (subNum(code) === NOSUB) st.item = itemNum(code)
  else st.sub = subNum(code)
}

/** `$1f`, the SUBNUM the machine writes when a pick has no sub-item */
const NOSUB = 0x1f
