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
import { AmosError, VI, int, str, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import {
  CUSTOMSCREEN,
  IDCMP_GADGETUP,
  IDCMP_MENUPICK,
  WBENCHSCREEN,
  WB_DISPLAY_Y,
  type UserGadget,
  type Window,
} from '../amiga/intuition'
import { BARLABEL, GadTools, MENUNULL, NM, itemNum, subNum, type MenuStrip, type NewMenu } from '../amiga/gadtools'

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
}

export function newIntState(): IntState {
  return new IntState()
}

/** the window `$d94` names, or "Window Is Not Open" --- routine 44's `moveq #$b,d7` */
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

export function makeIntInstructions(rt: Runtime): Record<string, Instr> {
  const s = (): IntState => rt.int

  /** the four flag arguments `Wb Menu Item` and `Wb Menu Sub Item` sum */
  const menuFlags = (it: Parameters<Instr>[0]): number => {
    let f = 0
    for (let i = 0; i < 4; i++) {
      it.expect(',')
      f += it.evalInt()
    }
    return f & 0xffff
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
      let f = it.evalInt()
      for (let i = 1; i < 8; i++) {
        it.expect(',')
        f += it.evalInt()
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
     */
    'wb open window': (it) => {
      const st = s()
      const num = it.evalInt()
      const [x, y, width, height] = four(it, true)
      const [minW, minH, maxW, maxH] = four(it, true)
      if (st.windows.has(num)) intError(INT_ERR.WINDOW_ALREADY_OPENED)
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
      // the four limits are NewWindow.MinWidth..MaxHeight, which nothing in
      // this port resizes by, so they are read and dropped
      void minW
      void minH
      void maxW
      void maxH
      if (w === null) intError(30)
      if (num > MAX_WINDOW) intError(INT_ERR.NUMBER_0_100)
      for (const g of st.boolGadgets.get(num) ?? []) w.gadgets.push(g)
      st.windows.set(num, w)
      st.current = num
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
      if (w === undefined) return
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
      // DEVIATION: the screen title is dropped. SetWindowTitles sets what the
      // SCREEN's bar reads while this window is active, and no screen here
      // draws a bar at all --- ../amiga/intuition.ts renders windows onto a
      // screen and leaves the screen's own furniture to the display.
      void screenTitle
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
      if (num > MAX_SCREEN) intError(INT_ERR.SCREEN_NUMBER_TO_HIGH)
      void pen1
      void pen2
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
      void x
      st.screens.set(num, addr)
      st.screen = addr
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

    /** `Wb Move Screen x,y` --- MoveScreen (-$a2), which is a DELTA and not a position */
    'wb move screen': (it) => {
      const st = s()
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      if (st.screen === -1 || st.screen === 0) return
      const slot = rt.intuition.slotOf(st.screen)
      const screen = slot === null ? undefined : rt.screens.get(slot)
      if (!screen) return
      void dx
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
        border: {
          leftEdge: -256,
          topEdge: -256,
          pen: 3,
          xy: [0, 0, width + 1, 0, width + 1, height + 1, 0, height + 1, 0, 0],
        },
        text: { leftEdge: xText, topEdge: yText, frontPen: 2, text },
      }
      const list = st.boolGadgets.get(num) ?? []
      list.push(gad)
      st.boolGadgets.set(num, list)
      // a window that is already open takes it at once, which is what
      // linking onto the list a live NewWindow already pointed at amounts to
      st.windows.get(num)?.gadgets.push(gad)
    },
  }
}

/** the nine arguments `Wb Window Flags` and `Wb Window Ids` add together */
function sumNine(it: Parameters<Instr>[0]): number {
  let f = it.evalInt()
  for (let i = 1; i < 9; i++) {
    it.expect(',')
    f += it.evalInt()
  }
  return f >>> 0
}

/** four comma-separated integers, the shape both open keywords start with */
function four(it: Parameters<Instr>[0], leading = false): [number, number, number, number] {
  const out: number[] = []
  for (let i = 0; i < 4; i++) {
    if (i > 0 || leading) it.expect(',')
    out.push(it.evalInt())
  }
  return [out[0]!, out[1]!, out[2]!, out[3]!]
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
