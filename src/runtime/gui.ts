/**
 * The GUI extension 2.10, by Pietro Ghizzoni — the General group.
 *
 * Twelve keywords that open a design from a bank, close it again, and run the
 * event loop every other keyword reports through. See ./guibank.ts for the
 * format the designs arrive in and ./guistate.ts for what a window is here.
 *
 * ## Evidence
 *
 * `GUI2.guide`, which documents 202 of the extension's 204 keywords, and
 * `AMOSPro_GUI.Lib` where it is silent. Every code these answer is quoted at
 * the keyword that answers it.
 *
 * ## The part that is not built yet
 *
 * Opening a window here fills in state and raises no pixels. gadtools and
 * intuition are both modelled and neither is wired to this yet, so a program
 * can open a GUI, read its gadgets and run its event loop, and see nothing.
 * That is a half-built keyword rather than a finished one, and the coverage
 * row stays at 0% until the whole set is done, which is the rule that stops
 * this being mistaken for progress it is not.
 */
import { AmosError, VI, VS, int, str, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { readGuiBank } from './guibank'
import { GUI_CENTRE_X, GUI_CENTRE_Y, GUI_EVENT, GUI_MAX_ZONES, GUI_TITLE_MAX, GuiState, PUB_SCREENS, guiScale, newWindowPort, packMenuNumber } from './guistate'
import { AMOS_KIND_INTEGER, AMOS_KIND_STRING } from './guikinds'
import type { GuiEvent, GuiWindow } from './guistate'
import type { GuiGadget } from './guibank'
import { drawBevelBox, KIND, MENU_FLAG, PEN, type DrawInfo, type MenuStrip } from '../amiga/gadtools'
import { TITLE_HEIGHT, WB_DISPLAY_Y, WB_HEIGHT, WB_WIDTH, WBORBOTTOM, WBORLEFT, WBORRIGHT } from '../amiga/intuition'
import type { Interp } from '../interp/interp'

export function newGuiState(): GuiState {
  return new GuiState()
}

/**
 * The extension's own error messages, packed NUL-separated at $7952 and
 * indexed zero-based by d0 through `L_ErrorExt`. See
 * `./extimpl.ts`'s `errors` for how that call works.
 *
 * Thirty-five of them, and the list is the only place several of this
 * extension's rules are written down at all: the guide never says that
 * drawing before `Gui Gfx` is an error, or that a bank has to be NAMED "Gui",
 * or that `Gui Range` refuses a gadget that is not an integer or a string.
 * Every one of those is a message here and a branch in the code that raises
 * it.
 *
 * Spelling and punctuation are the author's. "This isn't a Integer/String
 * Gadget" is his article, and the three exclamation marks are his too.
 */
export const GUI_ERRORS = [
  'Program Interrupted',
  'Unable to open window',
  'Gadget not defined',
  'Gui not defined',
  'Gui already used',
  'Bank not reserved',
  'Not a Gui bank',
  'Gui not open',
  'Window already open',
  'Illegal gadget value',
  'Window not open',
  'Gfx output not defined',
  'Image not reserved',
  'Asl.library not found!',
  'Illegal screen parameter',
  'Screen already open',
  'Unable to open screen',
  'Screen not opened',
  'Wrong GUI bank version. Use the GUI converter 2.3',
  "This isn't a Integer/String Gadget",
  'Socket not opened!',
  'Unable to send packet',
  'Unable to open file',
  'Channel already used!',
  'Not enough memory!',
  'Unable to open AppIcon',
  'Unable to display picture',
  'xfa.library not available',
  'Unable to load xfa file',
  'Unable to allocate xfa frames',
  'Unable to play xfa anim',
  'Bobs bank not reserved',
  'Zone not reserved',
  'Illegal number of zones',
  'Illegal function call',
] as const

/** the indices this file raises, named where a bare number would not read */
export const GUI_ERR = {
  BANK_NOT_RESERVED: 5,
  NOT_A_GUI_BANK: 6,
  ILLEGAL_GADGET_VALUE: 9,
  WINDOW_NOT_OPEN: 10,
  GFX_NOT_DEFINED: 11,
  NOT_AN_INPUT_GADGET: 19,
  GADGET_NOT_DEFINED: 2,
  SCREEN_NOT_OPENED: 17,
  ZONE_NOT_RESERVED: 32,
  ILLEGAL_NUMBER_OF_ZONES: 33,
  ILLEGAL_FUNCTION_CALL: 34,
  ILLEGAL_SCREEN_PARAMETER: 14,
} as const

/** raise one, the way `L_ErrorExt` does: every extension error is trappable */
function guiError(n: number): never {
  throw new AmosError(GUI_ERRORS[n] ?? `GUI error ${n}`)
}

/**
 * Read the bank the state is pointed at, once.
 *
 * The guide has `Gui Bank` name it and `Gui Open`'s third argument switch it,
 * and neither is documented as loading anything: the program has already done
 * `Load "x.abk"` and the bank is simply there. So this looks it up when a
 * design is first wanted and again whenever the number changes.
 */
function designs(rt: Runtime, s: GuiState): void {
  const bank = rt.memBanks.get(s.bank)
  s.designs = bank === undefined ? [] : readGuiBank(bank.data)
}

/**
 * Where the drawing keywords land: the window `Gui Gfx 0,n` named, or the
 * selected one before anything has.
 *
 * On the machine this is one longword, `$1bc` of the extension's state, and
 * it holds a RastPort rather than a window: `Gui Gfx 0,n` fills it from
 * `Window.RPort` at $6820 and `Gui Gfx 1,n` from the screen's, which is why
 * one variable serves both. Null here when neither has been set.
 */
function target(g: GuiState): GuiWindow | null {
  return g.windows.get(g.actual) ?? g.windows.get(g.selected) ?? null
}

/**
 * A gadget by number, or "Gadget not defined".
 *
 * Routine 246 at $6680 sets `moveq #$2,d7` twice: once before it tests for a
 * negative number and once after the window lookup, so a bad gadget answers 2
 * and a closed window answers the 10 routine 244 left behind. The order
 * matters, because a program that asks about gadget -1 of a window that is
 * not open gets 2 rather than 10.
 */
function gadgetOf(g: GuiState, win: number, id: number): { w: GuiWindow; gad: GuiGadget } {
  if (id < 0) guiError(GUI_ERR.GADGET_NOT_DEFINED)
  const w = windowOf(g, win)
  const gad = g.gadget(w, id)
  if (gad === null) guiError(GUI_ERR.GADGET_NOT_DEFINED)
  return { w, gad }
}

/**
 * The string array a LISTVIEW was given, through `Gui Set window,gadget,1,
 * Array(A$(0))`.
 *
 * "you MUST use Varptr(String) as value" for a string gadget and `Array()`
 * for a listview, and both are addresses on the machine. This port's
 * `Array()` hands back an opaque handle for a string array rather than an
 * address, registered in `rt.dialogArrays`, so the handle stored in attribute
 * 1 is looked up rather than dereferenced.
 *
 * Null when attribute 1 holds something that is not a live string array,
 * which is every listview a program never gave one to.
 */
function listArray(rt: Runtime, g: GuiState, w: GuiWindow, id: number): string[] | null {
  const arr = rt.dialogArrays.get(g.attrsOf(w, id)[1])
  if (arr === undefined || arr.type !== VAR_STRING) return null
  return arr.data.map((v) => (v.k === 'str' ? v.s : ''))
}

/**
 * Rotate a string array by one, which is what both `Gui Array` keywords do.
 *
 * $335a and $338c are the two loops, and each ends by writing the value it
 * saved at the far end -- so nothing is lost and neither is a shift. The
 * bounds are the binary's: a negative start does nothing and so does a start
 * past the last index, and neither raises.
 *
 * The machine reads the array's length from ONE WORD at `$2` of the
 * descriptor, which is the first dimension. This rotates the whole flat
 * array, which is the same thing for the one-dimensional arrays a listview
 * takes and the only kind the guide's examples show.
 */
function rotateArray(rt: Runtime, handle: number, start: number, up: boolean): void {
  const arr = rt.dialogArrays.get(handle)
  if (arr === undefined || arr.type !== VAR_STRING) return
  const last = arr.data.length - 1
  if (start < 0 || start > last - 1) return
  if (up) {
    const first = arr.data[start]!
    for (let i = start; i < last; i++) arr.data[i] = arr.data[i + 1]!
    arr.data[last] = first
  } else {
    const end = arr.data[last]!
    for (let i = last; i > start; i--) arr.data[i] = arr.data[i - 1]!
    arr.data[start] = end
  }
}

/**
 * Resize a window and give it a RastPort the new size.
 *
 * `Gui Resize` and `Gui Change` both end in routine 240, the gadget relayout,
 * and both keep the Gfx size in step when the window is the one `Gui Gfx`
 * named. Nothing here draws yet, so what that comes to is a new bitmap.
 */
function resizeWindow(w: GuiWindow, width: number, height: number): void {
  if (width === w.width && height === w.height) return
  w.width = width
  w.height = height
  w.rp = newWindowPort(width, height)
}

/**
 * What `Gui Sy` takes off before scaling: TEN, where the design used eleven.
 *
 * Named rather than written inline because it is the whole of a defect. See
 * the keyword.
 */
const SY_DESIGN_TOP = 10

/** `VarType` 2: a string array, which is the only kind these keywords take */
const VAR_STRING = 2

/**
 * The scale `Gui Sx` and `Gui Sw` apply, skipped for a window that was laid
 * out in topaz/8: `tst.w $42(a1) / bne` at $28f0 jumps past the call.
 */
function sensitiveX(g: GuiState, win: number, v: number): number {
  return windowOf(g, win).topaz ? v : guiScale(v, g.fontWidth)
}

/** the same for `Gui Sy` and `Gui Sh`, testing the same word at $2920 */
function sensitiveY(g: GuiState, win: number, v: number): number {
  return windowOf(g, win).topaz ? v : guiScale(v, g.fontHeight)
}

/**
 * The pointer in Workbench screen coordinates.
 *
 * `Gui Mouse X` reads `$12` of the Screen at `$1d2` and `Gui Mouse Y` reads
 * `$10`, which are `Screen.MouseX` and `Screen.MouseY` -- the two are stored
 * Y first, which is why the offsets look swapped.
 *
 * DEVIATION: there is no Screen under these windows here. The pointer this
 * port has is AMOS's, in hardware coordinates, so it is converted the way
 * `Screen.hardToScreenX` converts for a hires 640-wide Workbench: twice the
 * distance from the standard display origin at 128, and down from the
 * Workbench's own top edge at line 44. Clamped to the screen box, because
 * intuition does not let the pointer leave it and a program reading a
 * negative MouseX would be reading something the machine cannot produce.
 */
function screenMouse(it: Interp): [number, number] {
  const x = (it.inp.mouseX - 128) * 2
  const y = it.inp.mouseY - WB_DISPLAY_Y
  return [Math.max(0, Math.min(WB_WIDTH - 1, x)), Math.max(0, Math.min(WB_HEIGHT - 1, y))]
}

/**
 * The same, but raising "Gfx output not defined" when there is none.
 *
 * Every drawing keyword tests `$1bc` and branches to the error with
 * `moveq #$b,d7` -- `Gui Ink` at $1f92, `Gui Cls` at $20a2, `Gui Writing` at
 * $261c, `Gui Text` at $25e2, `Gui Paint` at $2c20 and the rest. The guide
 * never mentions it; the error string and the branch are the whole evidence
 * that drawing before `Gui Gfx` is an error at all.
 */
function gfx(g: GuiState): GuiWindow {
  return target(g) ?? guiError(GUI_ERR.GFX_NOT_DEFINED)
}

/**
 * A window by its number, or "Window not open".
 *
 * The library's own lookup is routine 244 at $63ee. It walks the window list
 * comparing `$c(a0)`, and it sets `moveq #$a,d7` on the way in, so every
 * keyword that calls it and tests the result raises the same error 10 without
 * naming it. Sixteen of them do.
 */
function windowOf(g: GuiState, n: number): GuiWindow {
  return g.windows.get(n) ?? guiError(GUI_ERR.WINDOW_NOT_OPEN)
}

/**
 * The three kinds `Gui Read$` answers for, from the guide's own list.
 * Everything else gets an empty string.
 */
const READ_STRING_KINDS = new Set<number>([KIND.LISTVIEW, KIND.CYCLE, KIND.STRING])

/**
 * A DrawInfo for `Gui Bbox`, whose pens are the window's own ink and paper.
 *
 * DEVIATION: gadtools takes SHINEPEN and SHADOWPEN out of the screen's
 * DrawInfo, and these windows have no screen. Ink and paper are what a GUI
 * program can actually set through this extension, so a bevel drawn here is
 * in the two colours the program chose rather than in two it never named.
 */
function bevelPens(w: GuiWindow, g: GuiState): DrawInfo {
  const pens = new Array<number>(12).fill(w.ink)
  pens[PEN.SHINE] = w.ink
  pens[PEN.SHADOW] = g.paper
  return { numPens: pens.length, pens, depth: w.rp.depth }
}

export function makeGuiInstructions(rt: Runtime): Record<string, Instr> {
  const s = (): GuiState => rt.gui
  /** the two coordinates every drawing keyword starts with */
  const pair = (it: Parameters<Instr>[0]): [number, number] => {
    const x = it.evalInt()
    it.expect(',')
    return [x, it.evalInt()]
  }

  /**
   * The four arguments every menu keyword takes, in the order the library
   * pops them: window first, then menu, item and sub through the packer.
   *
   * Null when the window is not open or carries no strip, which is the
   * `tst.l d0 / Rbeq` at $423a and the `beq` at $42a0.
   */
  const menuArgs = (it: Parameters<Instr>[0]): { strip: MenuStrip; number: number } | null => {
    const win = it.evalInt()
    it.expect(',')
    const menu = it.evalInt()
    it.expect(',')
    const item = it.evalInt()
    it.expect(',')
    const sub = it.evalInt()
    const strip = s().windows.get(win)?.strip
    if (strip === undefined || strip === null) return null
    return { strip, number: packMenuNumber(menu, item, sub) }
  }

  const menuEnable = (it: Parameters<Instr>[0], on: boolean): void => {
    const a = menuArgs(it)
    if (a === null) return
    const gt = s().gt
    if (on) gt.onMenu(a.strip, a.number)
    else gt.offMenu(a.strip, a.number)
  }

  const menuCheck = (it: Parameters<Instr>[0], on: boolean): void => {
    const a = menuArgs(it)
    if (a === null) return
    const item = s().gt.itemAddress(a.strip, a.number)
    if (item === null) return
    // the binary works in Flags and nothing else: `ori.w #$100` to check,
    // `andi.w #$ff` to uncheck, which clears three more bits with it
    if (on) item.flags |= MENU_FLAG.CHECKED
    else item.flags &= 0xff
    item.checked = on
  }

  return {
    /**
     * `Gui Bank bank`.
     *
     * "Before you can begin opening GUI windows which have been turned into
     * banks, you will need to tell the system which AMOS bank the GUI info is
     * located in. The converter will place it in bank 20 by default."
     */
    'gui bank': (it) => {
      const g = s()
      g.bank = it.evalInt()
      designs(rt, g)
    },

    /**
     * `Gui Open window,gui[,bank[,x,y,width,height]]`.
     *
     * Three syntaxes, and the guide is explicit about each: the bank "will
     * then become the current GUI bank", and without the geometry the window
     * takes "the position and size as specified in the GadToolsBox editor".
     *
     * The gui number is one-based in a program and zero-based in the bank's
     * own chain, which is the usual AMOS offset and is why `- 1` appears here
     * rather than in ./guistate.ts.
     */
    'gui open': (it) => {
      const g = s()
      const win = it.evalInt()
      it.expect(',')
      const gui = it.evalInt()
      if (it.accept(',')) {
        g.bank = it.evalInt()
        designs(rt, g)
      } else if (g.designs.length === 0) {
        designs(rt, g)
      }
      let box
      if (it.accept(',')) {
        const left = it.evalInt()
        it.expect(',')
        const top = it.evalInt()
        it.expect(',')
        const width = it.evalInt()
        it.expect(',')
        const height = it.evalInt()
        box = { left, top, width, height }
      }
      g.open(win, gui - 1, box)
    },

    /** `Gui Reset` — close all the windows */
    'gui reset': () => {
      s().reset()
    },

    /**
     * `Gui Gfx type,number` — where the drawing keywords land.
     *
     * TWO arguments, and the first is not the window:
     *
     *     0 - Window
     *     1 - Screen
     *
     * "The Number parameter tells the system which window or screen to direct
     * the output to." `Gui Actual` reads back the window this set.
     *
     * The token table is what caught this. Its spec is `I0,0` and a first
     * reading of the guide's prose had it taking one argument, which would
     * have left every drawing keyword pointed at a screen number.
     */
    'gui gfx': (it) => {
      const g = s()
      const type = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      g.gfxToScreen = type !== 0
      if (type === 0) {
        // routine 251's window arm sets `moveq #$a,d7` at $67d8 before it
        // looks, so naming a closed window here is "Window not open"
        windowOf(g, n)
        g.actual = n
      } else {
        g.gfxScreen = n
      }
    },

    /**
     * `Gui Mouse Mode 0|1` — "Alter frequency of Mouse Click events".
     *
     * "by default you'll receive two -11 events, 1 when you click the button,
     * and another when you let go. If you set Gui Mouse Mode to 1, this will
     * change to just 1 event". $2ace stores the word and checks nothing; the
     * pump at $709a is where it means anything, and the event it keeps is the
     * RELEASE: $70a2 lets $e8, $e9 and $ea through, which are SELECTUP,
     * MENUUP and MIDDLEUP.
     */
    'gui mouse mode': (it) => {
      s().mouseMode = it.evalInt() & 0xffff
    },

    /**
     * `Gui Mouse Queue window,limit` — "Expand mouse queue limit".
     *
     * Straight to intuition's `SetMouseQueue` (-$1f2) at $3886 with the
     * window and the number. "Usually intuition queue a maximum of 5 mouse
     * movements, and discard all the other if you don't read them in time!"
     */
    'gui mouse queue': (it) => {
      const n = it.evalInt()
      it.expect(',')
      windowOf(s(), n).mouseQueue = it.evalInt()
    },

    /**
     * `Gui Mouse Report window,mode` — "Activate events reports on every
     * mouse movement", which is WFLG_REPORTMOUSE.
     *
     * The library sets and clears the bit in `Window.Flags` itself, `ori.l
     * #$200,$18(a0)` at $2dee and an AND at $2de8, rather than calling
     * intuition's ReportMouse. The word beside it at `$3e(a1)` looks like a
     * nesting count and is not one: only bit 0 is ever tested, so two
     * consecutive Trues leave it at one and a single False clears it.
     */
    'gui mouse report': (it) => {
      const n = it.evalInt()
      it.expect(',')
      windowOf(s(), n).reportMouse = it.evalInt() !== 0
    },

    /**
     * `Gui Rmb window,mode` — "Enable the use of the Right mouse button".
     *
     * INVERTED, and the guide says so in words while the binary says it in
     * bits: "Gui Rmb 1,True   The RMB will be detected as normal by
     * intuition" clears WFLG_RMBTRAP ($2c12), and False SETS it ($2c08) so
     * the program gets a -11 instead. Its own closing warning is the
     * consequence: "If YOU monitor the right mouse button, the menus aren't
     * displayed!"
     */
    'gui rmb': (it) => {
      const n = it.evalInt()
      it.expect(',')
      windowOf(s(), n).rmb = it.evalInt() !== 0
    },

    /**
     * `Gui Sensitive On` — "make your GUI windows use your Workbench font
     * settings for displaying". Bit 0 of `$85`, set at $2300.
     *
     * "This is the default setting", and $1678 sets the same bit during init,
     * so the two agree.
     */
    'gui sensitive on': () => {
      s().sensitive = true
    },

    /**
     * `Gui Sensitive Off` — "makes your windows use the topaz/8 font as used
     * when you create the GUI in GadToolsBox". $230c clears the bit.
     *
     * It takes effect at the next `Gui Open`: a window copies the flag into
     * its own `$42` at $5726 and never looks at the global again.
     */
    'gui sensitive off': () => {
      s().sensitive = false
    },

    /**
     * `Gui To Front window` — "moves the specified window to the frontmost of
     * the display".
     *
     * TWO calls, and the guide names one: WindowToFront (-$138) at $1ea6 and
     * then ActivateWindow (-$1c2) at $1eae. So raising a window also makes it
     * the active one, which `Gui Selected` reports.
     */
    'gui to front': (it) => {
      const g = s()
      g.toFront(windowOf(g, it.evalInt()))
    },

    /** `Gui To Back window` — WindowToBack (-$132) alone, and no activate */
    'gui to back': (it) => {
      const g = s()
      g.toBack(windowOf(g, it.evalInt()))
    },

    /**
     * `Gui Move window,x,y` — "move the specified window, to the new x and y
     * coordinates specified".
     *
     * Routine 247 at $66b0 compares the packed LeftEdge/TopEdge longword with
     * the pair asked for and returns without doing anything when they match.
     * Otherwise it calls MoveWindow (-$a8), which takes DELTAS rather than
     * coordinates, and then busy-waits at $66ee until intuition has actually
     * moved it -- the call is asynchronous and the keyword is not.
     */
    'gui move': (it) => {
      const g = s()
      const w = windowOf(g, it.evalInt())
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      w.left = x
      w.top = y
    },

    /**
     * `Gui Resize window,width,height`.
     *
     * The same shape as `Gui Move`: compare the packed Width/Height longword,
     * SizeWindow (-$120) with deltas, wait for it, then relay out the
     * gadgets. It also updates the Gfx size at $22b6 when the window being
     * resized is the one `Gui Gfx` named, and it records what was ASKED FOR
     * where `Gui Change` beside it records what the window actually got.
     */
    'gui resize': (it) => {
      const g = s()
      const w = windowOf(g, it.evalInt())
      it.expect(',')
      const width = it.evalInt()
      it.expect(',')
      const height = it.evalInt()
      resizeWindow(w, width, height)
    },

    /**
     * `Gui Change window,x,y,width,height` — "Use it if you must quickly move
     * and resize your window, instead of Gui Move followed by Gui Resize".
     *
     * ChangeWindowBox (-$1e6) takes all four absolutely, so this one needs no
     * deltas and no wait loop.
     */
    'gui change': (it) => {
      const g = s()
      const w = windowOf(g, it.evalInt())
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const width = it.evalInt()
      it.expect(',')
      const height = it.evalInt()
      w.left = x
      w.top = y
      resizeWindow(w, width, height)
    },

    /**
     * `Gui Center x,y` — "Switch on/off the ability to centre widows on the
     * current screen", separately for each axis.
     *
     * Two bits at `$1a2`, and it takes effect at the next `Gui Open` rather
     * than moving anything now.
     */
    'gui center': (it) => {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      s().centre = (x !== 0 ? GUI_CENTRE_X : 0) | (y !== 0 ? GUI_CENTRE_Y : 0)
    },

    /** `Gui Remember On` — bit 2 of `$85`, set at $2572 */
    'gui remember on': () => {
      s().remember = true
    },

    /**
     * `Gui Remember Off` — "will simply set the window back to its original
     * settings each time it is closed, as set in the GadToolsBox editor".
     */
    'gui remember off': () => {
      s().remember = false
    },

    /**
     * `Gui Titles window,window title$,screen title$`.
     *
     * "If you pass a empty string in one of the title string th old one will
     * be left unchanged", and the binary does it by turning an empty string
     * into -1 at $26b0 and $26ba, which is what SetWindowTitles (-$114) reads
     * as "leave this one".
     *
     * Each title is copied into a 101-byte buffer at `$3a` of the window
     * record, the second one found with `lea $65(a3),a3`, so a hundred
     * characters is as much as either will hold.
     */
    'gui titles': (it) => {
      const g = s()
      const w = windowOf(g, it.evalInt())
      it.expect(',')
      const title = str(it.evalExpr())
      it.expect(',')
      const screen = str(it.evalExpr())
      if (title !== '') w.title = title.slice(0, GUI_TITLE_MAX)
      if (screen !== '') w.screenTitle = screen.slice(0, GUI_TITLE_MAX)
    },

    /**
     * `Gui Set Mode mode` — "Enable or disable the presence of the iconify
     * (zoom) gagdet in the titlebar of your windows".
     *
     * One word at `$60`, and the guide's own note is the reason it is here
     * and not on a window: "this command doesn't modify the windows already
     * opened, but only those opened later!"
     */
    'gui set mode': (it) => {
      s().iconifyGadget = it.evalInt()
    },

    /**
     * `Gui Beep` — DisplayBeep (-$60) with a NULL screen at $2558.
     *
     * The guide says "it will flash your current screen"; NULL means EVERY
     * open screen, which is what intuition's own autodoc calls "beep all of
     * the screens".
     *
     * DEVIATION: nothing flashes. These windows raise no pixels yet and the
     * port has no Workbench screen to invert, so the call is counted instead.
     * What the user would get on the machine also depends on their own
     * Preferences, which the guide is careful to say: "or perform the playing
     * of a sample, depending on how you have your workbench preferences set".
     */
    'gui beep': () => {
      s().beeps++
    },

    /**
     * `Gui Pause vbls` — "pause the program for the specified number of vbl's
     * in a system friendly way, using 0% CPU time".
     *
     * dos.library's Delay (-$c6), which counts TICKS. A tick is a fiftieth of
     * a second and so is a PAL vertical blank, which is why the guide can
     * call them vbls and be right on the machine this was written for.
     */
    'gui pause': (it) => {
      const n = it.evalInt()
      if (n > 0) it.block({ type: 'wait', until: it.tick + n })
    },

    /**
     * `Gui Wait Vbl [vbls]` — WaitTOF (-$10e), once or in a `dbra` loop.
     *
     * Two forms, which is what the `!` on the token table's name means: the
     * bare one at $2314 waits once and routine 77 at $2754 waits the number
     * given. "Gui Wait Vbl is exactly like the AMOS Wait Vbl command, except
     * for intuition."
     */
    'gui wait vbl': (it) => {
      const n = it.atStmtEnd() ? 1 : it.evalInt()
      if (n > 0) it.block({ type: 'wait', until: it.tick + n })
    },

    /**
     * `Gui Reserve Zone window,number of zones`.
     *
     * The count is checked FIRST, before the window: $407c is `tst.l d2 /
     * Rble` and $4082 is `cmpi.l #$1388,d2 / Rbhi`, both raising "Illegal
     * number of zones", and routine 244 only runs after. So asking window 9
     * for zero zones complains about the zeros.
     *
     * Five thousand is the ceiling, which the guide denies: "There is no
     * limit to the number of zones, except the amount of free memory."
     *
     * The block is AllocVec'd MEMF_CLEAR, so every zone starts as the
     * rectangle 0,0 to 0,0 -- which contains the point 0,0. Reserving without
     * setting is not the same as having no zones.
     */
    'gui reserve zone': (it) => {
      const g = s()
      const win = it.evalInt()
      it.expect(',')
      const count = it.evalInt()
      if (count <= 0 || count > GUI_MAX_ZONES) guiError(GUI_ERR.ILLEGAL_NUMBER_OF_ZONES)
      windowOf(g, win)
      g.zones.set(win, Array.from({ length: count }, () => ({ x1: 0, y1: 0, x2: 0, y2: 0 })))
    },

    /**
     * `Gui Free Zone window` — "Erase all the zones of the specified window".
     *
     * FreeVec at $40f2 and the pointer cleared at $40de, in that order, so
     * freeing a window that never reserved any is not an error.
     */
    'gui free zone': (it) => {
      const g = s()
      const win = it.evalInt()
      windowOf(g, win)
      g.zones.delete(win)
    },

    /**
     * `Gui Set Zone window,zone,x,y To x1,y1` — "used to define a rectangular
     * area wich can be tested by the different Zone functions".
     *
     * Four checks in the binary's order: the window (10), then a negative
     * zone number and a window with no block and a zone past the end, all
     * three "Zone not reserved" (32), and last the rectangle. $4138 is `cmp.w
     * d2,d4 / Rble`, so x1 must be STRICTLY greater than x and y1 than y --
     * a zone one pixel wide is legal and a zero-width one is "Illegal
     * function call". AMOS's own Set Zone checks neither.
     */
    'gui set zone': (it) => {
      const g = s()
      const win = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      windowOf(g, win)
      const list = g.zones.get(win)
      if (n < 0 || list === undefined || n >= list.length) guiError(GUI_ERR.ZONE_NOT_RESERVED)
      if (x2 <= x1 || y2 <= y1) guiError(GUI_ERR.ILLEGAL_FUNCTION_CALL)
      list[n] = { x1, y1, x2, y2 }
    },

    /**
     * `Gui Array Up array address,start position` — "cycle upwards the
     * contents of a string array, starting from the specified element".
     *
     * A ROTATION and not a shift: $335a saves the element at `start`, slides
     * the rest down one, and writes the saved one in at the far end. The
     * guide's worked example is the proof, and it is also the use it names:
     * blank an element, rotate from it, and the hole ends up past the data
     * where a listview will not show it.
     *
     * Nothing is checked but the bounds, and going out of them is silent: a
     * negative start returns at $3340 and a start past the last index at
     * $334c. The address is not checked at all.
     */
    'gui array up': (it) => {
      const handle = it.evalInt()
      it.expect(',')
      rotateArray(rt, handle, it.evalInt(), true)
    },

    /** `Gui Array Down array address,start position` — the same the other way, $3368 */
    'gui array down': (it) => {
      const handle = it.evalInt()
      it.expect(',')
      rotateArray(rt, handle, it.evalInt(), false)
    },

    /**
     * `Gui Pub Free` — "You MUST always free a public screen when you have
     * finished with it."
     *
     * UnlockPubScreen at $2b38, and $2b2a puts `$1d2` back from `$1ca`
     * first -- so freeing the lock also puts the screen `Gui Mouse X` reads
     * back to the one before it. Freeing when nothing is locked returns at
     * $2b1e without complaint.
     */
    'gui pub free': () => {
      const g = s()
      g.pubLock = 0
      g.pubName = ''
    },

    /**
     * `Gui Pub List` — "obtain a list of all public screens currently opened
     * on your Amiga".
     *
     * LockPubScreenList locks INTUITION while it is held, which is why the
     * guide shouts: "ATTENTION: While you are reading the list of screens,
     * the system is locked. You must read all the names as soon as you can!"
     *
     * Calling it twice does nothing the second time: $2b44 tests `$1da` and
     * returns if a list is already held, so it cannot leak a second lock.
     */
    'gui pub list': () => {
      const g = s()
      if (g.pubListAt < 0) g.pubListAt = 0
    },

    /**
     * `Gui Pub List Free` — "You MUST use this command when you have finished
     * with the list."
     *
     * Clears the cursor and then unlocks, and does nothing when no list is
     * held. Note that `Gui Pub Name$` frees the list ITSELF once it walks off
     * the end, so the guide's own loop has already unlocked by the time this
     * runs.
     */
    'gui pub list free': () => {
      s().pubListAt = -1
    },

    /**
     * `Gui Pub To Front SCREEN` — ScreenToFront (-$fc), where SCREEN is the
     * lock `Gui Pub Screen` returned.
     *
     * A lock of zero or less is "Illegal screen parameter": `moveq #$e,d7`
     * then `Rble` at $2bc4, before anything else. So the failure `Gui Pub
     * Screen` reports with a 0 raises here rather than being ignored.
     */
    'gui pub to front': (it) => {
      if (it.evalInt() <= 0) guiError(GUI_ERR.ILLEGAL_SCREEN_PARAMETER)
    },

    /** `Gui Pub To Back SCREEN` — ScreenToBack (-$f6), with the same guard */
    'gui pub to back': (it) => {
      if (it.evalInt() <= 0) guiError(GUI_ERR.ILLEGAL_SCREEN_PARAMETER)
    },

    /**
     * `Gui Pub Mode screen number,mode` — "Change the public status of a
     * screen".
     *
     * PubScreenStatus, and the mode is INVERTED on the way: $3fc6 turns mode
     * 0 into the flag 1 and everything else into 0, because the flag is
     * PSNF_PRIVATE. "If you set the mode to 0, the screen became PRIVATE."
     *
     * The screen is one of this extension's own, looked up by number, so
     * with `Gui Screen Open` not built every number is "Screen not opened".
     */
    'gui pub mode': (it) => {
      it.evalInt()
      it.expect(',')
      it.evalInt()
      guiError(GUI_ERR.SCREEN_NOT_OPENED)
    },

    /** `Gui Off window` — lock a GUI, so it stops answering events */
    'gui off': (it) => {
      windowOf(s(), it.evalInt()).locked = true
    },

    /** `Gui On window` — unlock one */
    'gui on': (it) => {
      windowOf(s(), it.evalInt()).locked = false
    },

    /**
     * `Gui Lock window` — lock everything EXCEPT that one.
     *
     * "Gui Lock will disable all the open windows except the specified
     * window", which is the opposite of what its name and its place beside
     * `Gui Unlock` suggest. Its spec is `I0`, one argument, and a lock-them-
     * all reading would have taken none.
     *
     * "It can also be used to force a user to make a selection in a specific
     * window", which is what the exception is for.
     */
    'gui lock': (it) => {
      const g = s()
      const keep = it.evalInt()
      windowOf(g, keep)
      for (const w of g.windows.values()) w.locked = w.number !== keep
    },

    /** `Gui Unlock` — unlock all of them */
    'gui unlock': () => {
      for (const w of s().windows.values()) w.locked = false
    },

    /**
     * `Gui Ink colour` — "set the ink colour for future gfx commands such as
     * Gui Draw and Gui Plot".
     */
    'gui ink': (it) => {
      const n = it.evalInt()
      gfx(s()).ink = n
    },

    /**
     * `Gui Pen colour` — the FrontPen `Gui Text` draws with.
     *
     * It is not a window's and not a RastPort's: $260a writes one byte to
     * `$290` of the extension's state and does nothing else. `Gui Text`
     * copies it into an IntuiText at $25cc. So changing the Gfx output does
     * not change the pen, which is the opposite of how `Gui Ink` behaves.
     */
    'gui pen': (it) => {
      s().pen = it.evalInt() & 0xff
    },

    /** `Gui Paper colour` — the BackPen of the same IntuiText, at `$28e` */
    'gui paper': (it) => {
      s().paper = it.evalInt() & 0xff
    },

    /**
     * `Gui Writing mode` — both a state byte and a RastPort mode.
     *
     * $2616 stores it at `$292` for `Gui Text` to read as the IntuiText
     * DrawMode, AND calls SetDrMd on the Gfx RastPort. So it is the one of
     * the three that needs an output open, and the only one that raises
     * "Gfx output not defined".
     */
    'gui writing': (it) => {
      const n = it.evalInt()
      const g = s()
      gfx(g).writing = n
      g.writing = n & 0xff
    },

    /**
     * `Gui Cls colour` — "clears all of the current graphics output".
     *
     * The guide warns what it is not: "Gui Cls will also clear all of the
     * window borders! To clear only graphics, you should use Gui Clw". Since
     * a window here has no border drawn into its own bitmap, the two differ
     * only in which window they take, which is where that difference lives
     * until borders are drawn.
     */
    'gui cls': (it) => {
      const c = it.evalInt()
      gfx(s()).rp.setRast(c)
    },

    /**
     * `Gui Clw window,colour` — "clear all of the graphics from the specified
     * window... screen borders and titles will be left intact, unlike Gui
     * Cls".
     */
    'gui clw': (it) => {
      const n = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      // this one names its window, so it raises 10 rather than 11
      windowOf(s(), n).rp.setRast(c)
    },

    /** `Gui Plot x,y` */
    'gui plot': (it) => {
      const [x, y] = pair(it)
      const w = gfx(s())
      w.rp.plot(x, y, w.ink)
      w.grX = x
      w.grY = y
    },

    /**
     * `Gui Draw x,y To x2,y2` — the `t` in its spec `I0,0t0,0` is the `To`.
     *
     * AMOS's own Draw leaves the graphics cursor at the far end, which is
     * what makes `Gui Draw To` a continuation, so this does the same.
     */
    'gui draw': (it) => {
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      const w = gfx(s())
      w.rp.draw(x1, y1, x2, y2, w.ink)
      w.grX = x2
      w.grY = y2
    },

    /** `Gui Draw To x,y` — on from wherever the cursor was left */
    'gui draw to': (it) => {
      const [x, y] = pair(it)
      const w = gfx(s())
      w.rp.draw(w.grX, w.grY, x, y, w.ink)
      w.grX = x
      w.grY = y
    },

    /** `Gui Bar x,y To x2,y2` — "a solid block... in exactly the same way as
        the AMOS command BAR" */
    'gui bar': (it) => {
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      const w = gfx(s())
      w.rp.rectFill(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2), w.ink)
      w.grX = x1
      w.grY = y1
    },

    /**
     * `Gui Box x,y To x2,y2` — the outline of the same rectangle.
     *
     * DEFECT: it is the only drawing keyword that does NOT check the Gfx
     * output. $48f6 loads `$1bc(a1)` into a1 and writes `$24(a1)` and
     * `$26(a1)` without testing it, where `Gui Bar` beside it tests and
     * raises "Gfx output not defined". With no output open a1 is zero and
     * those two writes land at absolute $24 and $26, inside the 68000's
     * exception vectors. This port has no such address, so it draws nothing
     * instead; what is reproduced is that it does not raise.
     */
    'gui box': (it) => {
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      const w = target(s())
      if (w === null) return
      const l = Math.min(x1, x2)
      const r = Math.max(x1, x2)
      const t = Math.min(y1, y2)
      const b = Math.max(y1, y2)
      w.rp.draw(l, t, r, t, w.ink)
      w.rp.draw(l, b, r, b, w.ink)
      w.rp.draw(l, t, l, b, w.ink)
      w.rp.draw(r, t, r, b, w.ink)
      w.grX = x1
      w.grY = y1
    },

    /** `Gui Ellipse x,y,rx,ry` */
    'gui ellipse': (it) => {
      const [x, y] = pair(it)
      it.expect(',')
      const rx = it.evalInt()
      it.expect(',')
      const ry = it.evalInt()
      const w = gfx(s())
      if (rx <= 0 || ry <= 0) return
      w.rp.ellipse(x, y, rx, ry, w.ink)
    },

    /**
     * `Gui Paint x,y` — "Works in exactly the same way as the Amos command
     * Paint. It will simply fill any section of the current gfx output with a
     * solid block of colour using the currently defined ink."
     *
     * AMOS's Paint defaults to its mode 1, the same-colour region, and that
     * is `RastPort.flood`'s mode ZERO: the two number the modes the opposite
     * way round, because AMOS follows graphics.library's Flood and the
     * RastPort here follows the sense of its own argument. Passing 1 here
     * floods until the OUTLINE pen instead, which with no outline set fills
     * nothing at all, and is what this did until a test noticed.
     */
    'gui paint': (it) => {
      const [x, y] = pair(it)
      const w = gfx(s())
      w.rp.flood(0, x, y, w.ink)
      w.grX = x
      w.grY = y
    },

    /**
     * `Gui Bbox x,y,xx,yy,mode` — "If mode is set to anything other than 0,
     * then the box is drawn recessed."
     *
     * This is gadtools' own DrawBevelBoxA, and `../amiga/gadtools.ts` reads
     * that same sentence out of GUI2.guide when it explains what recessed
     * means. The two agree because they are the same call.
     */
    'gui bbox': (it) => {
      const [x, y] = pair(it)
      it.expect(',')
      const width = it.evalInt()
      it.expect(',')
      const height = it.evalInt()
      it.expect(',')
      const mode = it.evalInt()
      const g = s()
      const w = gfx(g)
      drawBevelBox(w.rp, x, y, width, height, bevelPens(w, g), { recessed: mode !== 0 })
    },

    /**
     * `Gui Set window,gadget,attribute,value`.
     *
     * The guide's own table decides what each attribute means, and it depends
     * on the kind: attribute 0 is the value for every kind that has one,
     * attribute 1 is a LISTVIEW's array, a SCROLLER's total or a SLIDER's
     * MINIMUM, and attribute 2 is a LISTVIEW's top item, a SLIDER's MAXIMUM
     * or a SCROLLER's VISIBLE size. One number, three meanings, chosen by
     * what the gadget is.
     *
     * Attribute -1 is the odd one and is documented separately: "you just
     * need to use the attribute -1 and the value 0/1 to" ghost a gadget, and
     * the guide's examples read `Gui Set 1,5,-1,1 : Rem Gadget number 5 in
     * win 1 is turned OFF`.
     *
     * DEVIATION: STRING and TEXT. Their attribute 0 wants a pointer -- "you
     * MUST use Varptr(String) as value" -- and nothing here can dereference
     * one into the string a program meant. That path is ignored rather than
     * guessed at, and `Gui Set$` is the one that works, which is what the
     * guide points at anyway: "It's a shortcut of the Gui Set command."
     */
    'gui set': (it) => {
      const win = it.evalInt()
      it.expect(',')
      const id = it.evalInt()
      it.expect(',')
      const attr = it.evalInt()
      it.expect(',')
      const value = it.evalInt()
      const g = s()
      const w = windowOf(g, win)
      // routine 241's two checks, in its order: the attribute first
      // (`cmpi.l #$ffffffff,d3 / blt` at $603a), then the gadget
      if (attr < -1) guiError(GUI_ERR.ILLEGAL_GADGET_VALUE)
      if (g.gadget(w, id) === null) guiError(GUI_ERR.ILLEGAL_GADGET_VALUE)
      if (attr === -1) {
        if (value === 0) w.ghosted.delete(id)
        else w.ghosted.add(id)
        return
      }
      if (attr < 0 || attr > 2) return
      g.attrsOf(w, id)[attr as 0 | 1 | 2] = value
    },

    /**
     * `Gui Set$ window,gadget,string` — the shortcut for a string or text
     * gadget that does not need a Varptr.
     */
    'gui set$': (it) => {
      const win = it.evalInt()
      it.expect(',')
      const id = it.evalInt()
      it.expect(',')
      const text = str(it.evalExpr())
      const g = s()
      const w = windowOf(g, win)
      if (g.gadget(w, id) === null) guiError(GUI_ERR.ILLEGAL_GADGET_VALUE)
      w.strings.set(id, text)
    },

    /**
     * `Gui Range window,gadget,minvalue,maxvalue` — "All the values entered
     * by the user will be clipped in the specified range."
     *
     * The guide's example is worth keeping because it says which way the clip
     * goes at both ends: "if you have done Gui Range 1,1,10,20, and the user
     * inputs 5, it will automatically be set to 10. Similarly, if the user
     * inputs 2273226, it will be set to 20."
     */
    'gui range': (it) => {
      const win = it.evalInt()
      it.expect(',')
      const id = it.evalInt()
      it.expect(',')
      const lo = it.evalInt()
      it.expect(',')
      const hi = it.evalInt()
      const g = s()
      // $2524 compares the two before looking at anything else, and calls a
      // reversed range "Illegal gadget value" rather than an illegal range
      if (hi < lo) guiError(GUI_ERR.ILLEGAL_GADGET_VALUE)
      const w = windowOf(g, win)
      const gad = g.gadget(w, id)
      // "This isn't a Integer/String Gadget", though only INTEGER passes:
      // `cmpi.l #$3,d0 / Rbne` at $2532 tests one kind, where `Gui Activate`
      // beside it tests two
      if (gad === null || gad.kind !== AMOS_KIND_INTEGER) guiError(GUI_ERR.NOT_AN_INPUT_GADGET)
      w.ranges.set(id, [lo, hi])
    },

    /**
     * `Gui Menu On window,menu,item,sub` — "Activate a menu", which is
     * intuition's `OnMenu` (-$c0) at $4250 with nothing between it and the
     * three arguments but the packer at $4c10.
     *
     * The arguments are one-based and a zero means "none", so
     * `Gui Menu On 1,2,0,0` enables the whole of the second menu and
     * `Gui Menu On 1,2,3,0` enables its third item. See `packMenuNumber`.
     */
    'gui menu on': (it) => menuEnable(it, true),

    /** `Gui Menu Off window,menu,item,sub` — `OffMenu` (-$b4) at $427c */
    'gui menu off': (it) => menuEnable(it, false),

    /**
     * `Gui Menu Check window,menu,item,sub` — "Checkmark a menu item".
     *
     * $4284 does it by hand rather than through a library call: ItemAddress
     * for the MenuItem, `ori.w #$100,$c(a0)` to set CHECKED in its Flags, and
     * `ResetMenuStrip` to make intuition redraw the bar.
     *
     * It reads the strip out of `$16(a0)` first and gives up when it is zero,
     * so a window whose design carries no menus is a no-op rather than an
     * error.
     */
    'gui menu check': (it) => menuCheck(it, true),

    /**
     * `Gui Menu Uncheck window,menu,item,sub`.
     *
     * DEFECT: `andi.w #$ff,$c(a0)` at $4302 clears the WHOLE high byte of
     * Flags, not just CHECKED. ISDRAWN, HIGHITEM and MENUTOGGLED go with it.
     * Only MENUTOGGLED is a program-visible loss: an item the user had
     * toggled forgets that it was, so the next pick sets it rather than
     * clearing it. The other two intuition rebuilds on the next render. This
     * port clears the same four bits.
     */
    'gui menu uncheck': (it) => menuCheck(it, false),

    /**
     * `Gui Activate window,gadget` — "activate the specified input gadget
     * (wether it be a string/integer gadget) encouraging the user to type
     * something in".
     *
     * The two kinds are named by number at $2836 and $283e: 3 and $c, which
     * are INTEGER and STRING. Anything else is "This isn't a Integer/String
     * Gadget", and it is checked BEFORE the window is looked up -- routine
     * 237 answers 0 for a window that is not open, and 0 is not 3 or 12, so a
     * closed window reaches error 19 rather than error 10.
     */
    'gui activate': (it) => {
      const win = it.evalInt()
      it.expect(',')
      const id = it.evalInt()
      const g = s()
      const w = g.windows.get(win)
      const kind = w === undefined ? -1 : (g.gadget(w, id)?.kind ?? -1)
      if (kind !== AMOS_KIND_INTEGER && kind !== AMOS_KIND_STRING) guiError(GUI_ERR.NOT_AN_INPUT_GADGET)
      g.activeGadget = id
    },

    /** `Gui Text x,y,text$` */
    'gui text': (it) => {
      const [x, y] = pair(it)
      it.expect(',')
      const text = str(it.evalExpr())
      const g = s()
      const w = gfx(g)
      if (w.rp.font === null) return
      // the IntuiText the keyword builds at $25bc takes its pens from the
      // extension's state and not from the RastPort
      w.rp.text(x, y, text, g.pen)
    },
  }
}

export function makeGuiFunctions(rt: Runtime): Record<string, Func> {
  const s = (): GuiState => rt.gui

  return {
    /**
     * `A=Gui Close(window)`, answering one of four codes:
     *
     *     0 - Window Closed
     *     1 - First opened Window closed
     *     2 - Last opened window closed
     *     3 - Last window closed
     *
     * and the guide's own warning about what it is NOT: "Opened windows will
     * not close by themselves when the close gadget is clicked, you have to
     * monitor for it to happen".
     */
    'gui close': (_, a): Value => VI(s().closeWindow(int(a[0]!))),

    /**
     * `A=Gui Exist(window)`.
     *
     * "If it isn't, then FALSE is returned. If the window is open, it will
     * return with the window's structure address."
     *
     * DEVIATION: the address. Nothing here has a `struct Window` at an
     * address, and the guide's next line is "Dont fiddle with this structure
     * unless you really know what you're doing to it!!", so what a program
     * can legitimately do with the value is test it. This answers -1, which
     * is AMOS's TRUE and is truthy in every test a program can write, rather
     * than a number pretending to be a pointer.
     */
    'gui exist': (_, a): Value => VI(s().exists(int(a[0]!)) ? -1 : 0),

    /**
     * `A=Gui Wait` — "will wait until the user interacts with your program".
     *
     * DEVIATION: it does not block. On the machine the program freezes here
     * until Intuition delivers something; this port has one thread and a
     * frame loop that must keep turning, so this answers the next queued
     * event or -7. A program written as `Repeat : A=Gui Wait : Until A=-1`
     * therefore spins rather than sleeps, which costs frames and changes
     * nothing a program can observe about the events themselves.
     */
    'gui wait': (): Value => VI(s().nextEvent()),

    /**
     * `A=Gui Event` — the same answers without waiting.
     *
     * "It returns the value -7 if nothing is happened..."
     */
    'gui event': (): Value => VI(s().nextEvent()),

    /**
     * `A=Gui Code` — the result code of the last event.
     *
     * "After Gui Code has been called, its value is automatically reset to -1
     * again, until the next call to Gui Wait loads it with a new value."
     */
    'gui code': (): Value => VI(s().readCode()),

    /** `A=Gui Code$` — the string half, for STRING gadgets */
    'gui code$': (): Value => VS(s().readCodeText()),

    /**
     * `A=Gui Menu(n)` — which menu item the last event -2 named.
     *
     * "A menu item has been selected. You've to use the Gui Menu function to
     * know which item has been chosen." The guide says no more, and routine
     * 14 at $1e82 is one `Rbsr` into routine 4, where the four arguments live:
     * 1 the menu, 2 the item, 3 the sub-item, 4 step to the next of a
     * multi-select. All three fields come back ONE-BASED.
     */
    'gui menu': (_, a): Value => VI(s().menuField(int(a[0]!))),

    /**
     * `A=Gui Mouse X` and `A=Gui Mouse Y` — "the screen coordinates of the
     * mouse". See `screenMouse` for what stands in for the screen here.
     */
    'gui mouse x': (it): Value => VI(screenMouse(it)[0]),
    'gui mouse y': (it): Value => VI(screenMouse(it)[1]),

    /**
     * `A=Gui Mouse Wx` and `Wy` — the same, less the window's own corner.
     * "The top-left coordinates of a window are 0,0."
     *
     * `Window.MouseX` and `MouseY`, at $e and $c of the Window intuition
     * keeps up to date. The window is the Gfx one rather than the selected
     * one: $2a0c reads `$1c2`, which `Gui Gfx` sets and `Gui Actual` reports
     * the number of. Error 10 when there is none, from the `moveq #$a,d7` at
     * $2a0a -- so this is the one pair that raises "Window not open" where
     * everything else drawing-shaped raises "Gfx output not defined".
     */
    'gui mouse wx': (it): Value => {
      const w = target(s()) ?? guiError(GUI_ERR.WINDOW_NOT_OPEN)
      return VI(screenMouse(it)[0] - w.left)
    },
    'gui mouse wy': (it): Value => {
      const w = target(s()) ?? guiError(GUI_ERR.WINDOW_NOT_OPEN)
      return VI(screenMouse(it)[1] - w.top)
    },

    /**
     * `A=Gui Mouse Ex` and `Ey` — where the pointer was when the last event
     * happened, rather than where it is now.
     *
     * "if the user click the mouse you'll receive the -11 event, but if you
     * try to get the mouse coords using Gui Mouse Wx you'll get the CURRENT
     * mouse coord wich may be different from the point where the user has
     * clicked." The guide lists three events that fill them in: -11 mouse
     * click, -12 mouse move and -15 icon drag'n'drop.
     *
     * Two words at `$29c` and `$29e`, copied out of the IntuiMessage at
     * $6d0a. They are never cleared, so after an event that carries no
     * position they still hold the last one that did.
     */
    'gui mouse ex': (): Value => VI(s().eventX),
    'gui mouse ey': (): Value => VI(s().eventY),

    /**
     * `A=Gui Width(window)` and `Gui Height(window)` — "the width of the
     * specified window in pixels", borders and all.
     *
     * `Window.Width` at $8 and `Height` at $a, and `Gui X` and `Gui Y` are
     * `LeftEdge` at $4 and `TopEdge` at $6 of the same struct.
     */
    'gui width': (_, a): Value => VI(windowOf(s(), int(a[0]!)).width),
    'gui height': (_, a): Value => VI(windowOf(s(), int(a[0]!)).height),
    'gui x': (_, a): Value => VI(windowOf(s(), int(a[0]!)).left),
    'gui y': (_, a): Value => VI(windowOf(s(), int(a[0]!)).top),

    /**
     * `A=Gui In Width(window)` and `Gui In Height(window)` — the same "
     * excluding the window borders".
     *
     * $2740 subtracts `$36(a0)` and `$38(a0)` from the width, which are
     * BorderLeft and BorderRight, and $2780 subtracts `$37` and `$39` from
     * the height, BorderTop and BorderBottom. The four bytes `Gui Border`
     * reports one at a time.
     */
    'gui in width': (_, a): Value => VI(windowOf(s(), int(a[0]!)).width - WBORLEFT - WBORRIGHT),
    'gui in height': (_, a): Value => VI(windowOf(s(), int(a[0]!)).height - TITLE_HEIGHT - WBORBOTTOM),

    /**
     * `A=Gui X Gad(window,gadget)` and its three siblings — the gadget's box
     * "relative to the top-left of the window".
     *
     * These read the LAID-OUT Gadget rather than the bank's NewGadget, so
     * they carry both the font scale and the border the layout pass added at
     * $5906 and $5938. That is why the guide points at them from `Gui
     * Sensitive On`: "the GUI will try to adapt itself to your workbench
     * settings", and this is how a program finds out where things ended up.
     */
    'gui x gad': (_, a): Value => {
      const g = s()
      const { gad } = gadgetOf(g, int(a[0]!), int(a[1]!))
      return VI(guiScale(gad.leftEdge, g.fontWidth) + WBORLEFT)
    },
    'gui y gad': (_, a): Value => {
      const g = s()
      const { gad } = gadgetOf(g, int(a[0]!), int(a[1]!))
      return VI(guiScale(gad.topEdge, g.fontHeight) + TITLE_HEIGHT)
    },
    'gui gad width': (_, a): Value => {
      const g = s()
      const { gad } = gadgetOf(g, int(a[0]!), int(a[1]!))
      return VI(guiScale(gad.width, g.fontWidth))
    },
    'gui gad height': (_, a): Value => {
      const g = s()
      const { gad } = gadgetOf(g, int(a[0]!), int(a[1]!))
      return VI(guiScale(gad.height, g.fontHeight))
    },

    /**
     * `A=Gui Sx(window,x)` — "the new X position of a point, when scaled as
     * the gadgets are with Gui Sensitive On".
     *
     * TWO arguments, not one. The guide prints `A=Gui Sx(X)` and its worked
     * example reads `Gui Bar Gui Sx(10),Gui Sy(15) To Gui Sx(25),Gui Sy(30)`,
     * but the token table's spec is `00,0` and $28d8 pops a value AND a
     * window before calling the window lookup. All four of these take the
     * window first.
     *
     * The arithmetic is the layout pass run backwards then forwards: take off
     * the border the design was drawn with, scale, add the border the window
     * actually got. `subq.l #$4,d1` at $28dc is GuiConv's own `Deek(WORK)-4`.
     */
    'gui sx': (_, a): Value => VI(sensitiveX(s(), int(a[0]!), int(a[1]!) - WBORLEFT) + WBORLEFT),

    /**
     * `A=Gui Sy(window,y)` — the same for a Y coordinate.
     *
     * DEFECT: it takes off TEN where the design used ELEVEN. $2908 is
     * `subi.l #$a,d1`, GuiConv writes `Doke _STRUCTS+2,Deek(WORK+6)-11`, and
     * the border added back at $292a is `$298`, which $568a builds as
     * WBorTop + the font's height + 1 -- 11 for a Workbench with topaz/8. So
     * with the default font `Gui Sy(w,y)` answers y+1 rather than y, where
     * `Gui Sx` beside it is exact. One pixel, and it grows with the font.
     */
    'gui sy': (_, a): Value => VI(sensitiveY(s(), int(a[0]!), int(a[1]!) - SY_DESIGN_TOP) + TITLE_HEIGHT),

    /**
     * `A=Gui Sw(window,width)` and `Gui Sh(window,height)` — "the pixel width
     * rescaled by the font sensitivity routine".
     *
     * A size rather than a position, so neither takes a border off nor adds
     * one back: $2934 and $295a are the scale alone.
     */
    'gui sw': (_, a): Value => VI(sensitiveX(s(), int(a[0]!), int(a[1]!))),
    'gui sh': (_, a): Value => VI(sensitiveY(s(), int(a[0]!), int(a[1]!))),

    /**
     * `A=Gui X Font` and `Gui Y Font` — the character cell everything above
     * is scaled by, `$294` and `$296`.
     *
     * They belong to the extension rather than to a window, and a window that
     * could not be scaled has already forced them back to 8.
     */
    'gui x font': (): Value => VI(s().fontWidth),
    'gui y font': (): Value => VI(s().fontHeight),

    /**
     * `T$=Gui Title$(window)` — "Returns the title of the specified window".
     *
     * A number of ZERO OR LESS names a SCREEN instead, which the guide does
     * not say: $402e branches on `tst.l d0 / bgt`, works out `$10000 - n` to
     * get the screen number, and reads the screen record's own title at $404c
     * with "Screen not opened" for its error. Above zero it reads
     * `Window.Title` at `$20`.
     */
    'gui title$': (_, a): Value => {
      const n = int(a[0]!)
      // no screens exist in this port yet, so every screen number is unopened
      if (n <= 0) guiError(GUI_ERR.SCREEN_NOT_OPENED)
      return VS(windowOf(s(), n).title)
    },

    /**
     * `A=Gui Mouse Zone(window,x,y)` — "Returns the number of zone at the
     * specified mouse coordinates. If no zone are present, the value -1 is
     * returned."
     *
     * A window that reserved nothing is "Zone not reserved" rather than -1:
     * $416c tests the pointer and raises before the hit test runs.
     */
    'gui mouse zone': (_, a): Value => {
      const g = s()
      const win = int(a[0]!)
      windowOf(g, win)
      if (!g.zones.has(win)) guiError(GUI_ERR.ZONE_NOT_RESERVED)
      return VI(g.zoneAt(win, int(a[1]!), int(a[2]!)))
    },

    /**
     * `Z=Gui Zone` — "It works exactly like the Gui Gadget function, except
     * it detects the window zones instead of the gadgets!"
     *
     * A different word from `Gui Gadget`'s, `$a0` against `$102`, so the two
     * are read independently and one does not clear the other.
     */
    'gui zone': (): Value => VI(s().activeZone),

    /**
     * `A=Gui Array Read(window,listview,element)` — "the number of the array
     * associated to the specified element of the listview".
     *
     * A listview holds only the non-empty entries, so its numbering and the
     * array's diverge as soon as one element is blank. The guide's example:
     *
     *     A$(0)="Hello" A$(1)="" A$(2)="World!" A$(3)="" A$(4)="Amiga RULEZ!"
     *
     * "if the user click on 'World!' Gui Read() returns 1. But the array is
     * A$(2)". This answers 2.
     *
     * $3112 walks the node list the library built and reads `$e` of each,
     * where it kept the source index. -1 when the element is past the end,
     * from the `moveq #$ff,d3` at $30e6.
     */
    'gui array read': (_, a): Value => {
      const g = s()
      const w = windowOf(g, int(a[0]!))
      const items = listArray(rt, g, w, int(a[1]!))
      if (items === null) return VI(-1)
      return VI(g.listItems(items)[int(a[2]!)]?.index ?? -1)
    },

    /**
     * `A=Gui Array(element)` — "the equivalent of Gui Code, but returns the
     * correct array value associated to the listview element".
     *
     * One word at `$1a0`, filled in when a listview event is decoded. It
     * takes an argument the routine never reads: $3126 loads `$1a0` and
     * returns, so `Gui Array(0)` and `Gui Array(99)` answer the same thing.
     */
    'gui array': (): Value => VI(s().arrayIndex),

    /**
     * `LOCK=Gui Pub Screen(NAME$)` — "attempt to obtain access to the named
     * public screen ... or else the value returned in LOCK will be 0".
     *
     * It frees the previous lock first, at $2af6, which is the guide's "If
     * you try to lock another screen with Gui Pub Screen, the previous screen
     * will be freed automatically". The lock also becomes the current screen:
     * $2b0a writes it to `$1d2` as well as `$1ce`, and `$1d2` is what `Gui
     * Mouse X` reads its coordinates out of.
     */
    'gui pub screen': (_, a): Value => {
      const g = s()
      const name = str(a[0]!)
      g.pubLock = 0
      g.pubName = ''
      if (!PUB_SCREENS.includes(name)) return VI(0)
      g.pubName = name
      g.pubLock = PUB_SCREENS.indexOf(name) + 1
      return VI(g.pubLock)
    },

    /**
     * `A$=Gui Pub Name$` — "the next public screen name from the Amiga's
     * list".
     *
     * The guide's own way of reading it, which is also the only safe one:
     *
     *     Gui Pub List
     *     For I=0 To 31 : PUB$(I)=Gui Pub Name$ : Exit If PUB$(I)="" : Next
     *     Gui Pub List Free
     *
     * Empty when no list is held, and empty at the end -- $2b7a finds the
     * node whose ln_Succ is zero, which is the List's own tail sentinel,
     * unlocks the list there and answers with AMOS's shared empty string. So
     * the loop above terminates by itself and the `Gui Pub List Free` after
     * it has nothing left to do.
     */
    'gui pub name$': (): Value => {
      const g = s()
      if (g.pubListAt < 0) return VS('')
      const name = PUB_SCREENS[g.pubListAt]
      if (name === undefined) {
        g.pubListAt = -1
        return VS('')
      }
      g.pubListAt++
      return VS(name)
    },

    /**
     * `C=Gui Pub Check(screen number)` — "Return the number of windows opened
     * on the specified Screen".
     *
     * DEFECT: it counts one less than that. Routine 221 at $49de starts at
     * `Screen.FirstWindow` and then counts NextWindow LINKS, so a screen with
     * one window answers 0 and a screen with three answers 2. It also reads
     * through a null FirstWindow, because the count begins by dereferencing
     * it without a test -- an empty screen walks whatever is at address 0.
     *
     * Zero for a screen that does not exist, which is not an error: routine
     * 259 answers 0 and $49ea takes the count with it.
     */
    'gui pub check': (): Value => VI(0),

    /** `A=Gui Window` — which window generated the last event */
    'gui window': (): Value => VI(s().eventWindow()),

    /** `A=Gui Selected` — the currently selected window */
    'gui selected': (): Value => VI(s().selected),

    /**
     * `A=Gui Actual` — "the window number set by the Gui Gfx command".
     *
     * -1 when no window is open at all: $2158 is `moveq #$ff,d3` and the
     * window-list test at $215a leaves it there. The guide does not say so.
     */
    'gui actual': (): Value => VI(s().windows.size === 0 ? -1 : s().actual),

    /**
     * `INK=Gui Point(X,Y)` — "Works in exactly the same way as the Amos
     * command Point. It will simply returns the colour of the point at the
     * specified X,Y coordinates."
     */
    'gui point': (_, a): Value => VI(gfx(s()).rp.point(int(a[0]!), int(a[1]!))),

    /**
     * `A=Gui Read(window,gadget)` — "the current status of the specified
     * gadget", which is its attribute 0.
     *
     * "Gui Read is similar to Gui Code except it doesnt need to be called
     * after the specified gadget is selected", so unlike `Gui Code` this does
     * not reset itself.
     */
    'gui read': (_, a): Value => {
      const g = s()
      const w = g.windows.get(int(a[0]!))
      const id = int(a[1]!)
      if (w === undefined || g.gadget(w, id) === null) return VI(0)
      return VI(g.attrsOf(w, id)[0])
    },

    /**
     * `A$=Gui Read$(window,gadget)` — "the string held in the specified
     * gadget", for three kinds:
     *
     *     LISTVIEW  Selected item
     *     CYCLE     Selected item
     *     STRING    Text entered
     *
     * "For all the other kind of gadgets a empty string will be returned."
     *
     * A CYCLE selects out of the item list the bank carries, indexed by its
     * attribute 0, which is what `Gui Code` reports when the user clicks it:
     * "CYCLE - Currently selected item (in order of list, 0 is first entry)".
     * Anything `Gui Set$` put there wins, since a program that set its own
     * text meant it.
     *
     * A LISTVIEW's items are not in the bank and cannot be: the converter
     * excludes GTLV_Labels from the tags that make a gadget carry a payload
     * and zeroes its data on the way past, because the list arrives at run
     * time from a program's own array through `Gui Set
     * window,gadget,1,Array(...)`. So this reads that array, skipping the
     * empty elements the way the listview itself does.
     */
    'gui read$': (_, a): Value => {
      const g = s()
      const w = windowOf(s(), int(a[0]!))
      const id = int(a[1]!)
      const gadget = g.gadget(w, id)
      if (gadget === null || !READ_STRING_KINDS.has(gadget.kind)) return VS('')
      const array = gadget.kind === KIND.LISTVIEW ? listArray(rt, g, w, id) : null
      if (array !== null) return VS(g.listItems(array)[g.attrsOf(w, id)[0]]?.text ?? '')
      const set = w.strings.get(id)
      if (set !== undefined) return VS(set)
      if (gadget.items.length > 0) return VS(gadget.items[g.attrsOf(w, id)[0]] ?? '')
      return VS(gadget.text)
    },

    /**
     * `A=Gui Kind(window,gadget)` — the gadget type.
     *
     * The guide's list opens "0 - BUTTON (with image)", which is GuiConv's
     * own kind 0 and gadtools' GENERIC, and is the fifth place this port has
     * seen that substitution stated.
     */
    'gui kind': (_, a): Value => {
      const g = s()
      const w = g.windows.get(int(a[0]!))
      if (w === undefined) return VI(-1)
      return VI(g.gadget(w, int(a[1]!))?.kind ?? -1)
    },

    /**
     * `A=Gui Check(window,x,y)` — "Checks the window at the specified X and Y
     * coordinates to see if a gadget exists. If a gadget does exist, the
     * number of the gadget is returned, else -1 is reported."
     */
    'gui check': (_, a): Value => {
      const w = windowOf(s(), int(a[0]!))
      const x = int(a[1]!)
      const y = int(a[2]!)
      for (const d of w.design.gadgets) {
        if (x >= d.leftEdge && x < d.leftEdge + d.width && y >= d.topEdge && y < d.topEdge + d.height) return VI(d.id)
      }
      return VI(-1)
    },

    /** `GAD=Gui Gadget` — the gadget a mouse or drag event named */
    'gui gadget': (): Value => VI(s().activeGadget),

    /**
     * `A=Gui Border(window,border)` — the size of one of a window's four
     * borders:
     *
     *     0 - Left Border    1 - Top Border
     *     2 - Right Border   3 - Bottom Border
     *
     * DEVIATION: these are Intuition's own border widths, which a window gets
     * from the screen it opened on and from which system gadgets it asked
     * for. These windows have no screen, so the numbers are the ones
     * `../amiga/intuition.ts` reads off `struct Screen`'s WBorLeft and
     * friends, with the title bar's height for the top. A GUI opened on a
     * screen with a taller font would differ.
     */
    'gui border': (_, a): Value => {
      const n = int(a[1]!)
      // 0 to 3 only, and $225e tests the range BEFORE looking the window up,
      // so `Gui Border(9,7)` answers 0 where `Gui Border(9,0)` raises
      if (n < 0 || n > 3) return VI(0)
      void windowOf(s(), int(a[0]!))
      // the four bytes at Window+$36: BorderLeft, Top, Right, Bottom
      return VI([WBORLEFT, TITLE_HEIGHT, WBORRIGHT, WBORBOTTOM][n] ?? 0)
    },
  }
}

/** the event codes, re-exported so the tests and later keyword groups share them */
export { GUI_EVENT }

/**
 * What a caller outside the extension needs to raise an event.
 *
 * `at` is where the pointer was, which the three events the guide lists for
 * `Gui Mouse Ex` carry: -11 mouse click, -12 mouse move and -15 icon
 * drag'n'drop. Omitting it leaves the two state words holding the last
 * position that was reported, which is what the library does.
 */
export function guiPost(rt: Runtime, window: number, code: number, result = 0, text = '', at?: [number, number]): void {
  const e: GuiEvent = { code, result, text, window }
  if (at !== undefined) {
    e.mouseX = at[0]
    e.mouseY = at[1]
  }
  rt.gui.post(e)
}

