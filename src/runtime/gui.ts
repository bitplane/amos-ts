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
import { GUI_EVENT, GuiState, packMenuNumber } from './guistate'
import { AMOS_KIND_INTEGER, AMOS_KIND_STRING } from './guikinds'
import type { GuiWindow } from './guistate'
import { drawBevelBox, KIND, MENU_FLAG, PEN, type DrawInfo, type MenuStrip } from '../amiga/gadtools'
import { TITLE_HEIGHT, WBORBOTTOM, WBORLEFT, WBORRIGHT } from '../amiga/intuition'

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
        if (g.exists(n)) g.actual = n
      } else {
        g.gfxScreen = n
      }
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
     * DEVIATION: LISTVIEW. Its items are not in the bank and cannot be: the
     * converter excludes GTLV_Labels from the tags that make a gadget carry a
     * payload and zeroes its data on the way past, because a listview's list
     * arrives at run time from a program's own array through `Gui Set
     * window,gadget,1,Array(...)`. Until that attribute takes an array rather
     * than a number, a LISTVIEW answers what `Gui Set$` gave it.
     */
    'gui read$': (_, a): Value => {
      const g = s()
      const w = windowOf(s(), int(a[0]!))
      const id = int(a[1]!)
      const gadget = g.gadget(w, id)
      if (gadget === null || !READ_STRING_KINDS.has(gadget.kind)) return VS('')
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

/** what a caller outside the extension needs to raise an event */
export function guiPost(rt: Runtime, window: number, code: number, result = 0, text = ''): void {
  rt.gui.post({ code, result, text, window })
}

