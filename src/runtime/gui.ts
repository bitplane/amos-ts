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
import { VI, VS, int, str, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { readGuiBank } from './guibank'
import { GUI_EVENT, GuiState } from './guistate'
import type { GuiWindow } from './guistate'
import { drawBevelBox, PEN, type DrawInfo } from '../amiga/gadtools'
import { TITLE_HEIGHT, WBORBOTTOM, WBORLEFT, WBORRIGHT } from '../amiga/intuition'

export function newGuiState(): GuiState {
  return new GuiState()
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
 * Null when nothing is open, and every drawing keyword returns quietly on
 * that rather than raising. The guide never says what drawing into no window
 * does and a program that tries has already lost its window some other way.
 */
function target(g: GuiState): GuiWindow | null {
  return g.windows.get(g.actual) ?? g.windows.get(g.selected) ?? null
}

/**
 * A DrawInfo for `Gui Bbox`, whose pens are the window's own ink and paper.
 *
 * DEVIATION: gadtools takes SHINEPEN and SHADOWPEN out of the screen's
 * DrawInfo, and these windows have no screen. Ink and paper are what a GUI
 * program can actually set through this extension, so a bevel drawn here is
 * in the two colours the program chose rather than in two it never named.
 */
function bevelPens(w: GuiWindow): DrawInfo {
  const pens = new Array<number>(12).fill(w.ink)
  pens[PEN.SHINE] = w.ink
  pens[PEN.SHADOW] = w.paper
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
      const w = s().windows.get(it.evalInt())
      if (w !== undefined) w.locked = true
    },

    /** `Gui On window` — unlock one */
    'gui on': (it) => {
      const w = s().windows.get(it.evalInt())
      if (w !== undefined) w.locked = false
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
      const w = target(s())
      if (w !== null) w.ink = n
    },

    /** `Gui Pen colour` — the text pen, which AMOS's own Pen also is */
    'gui pen': (it) => {
      const n = it.evalInt()
      const w = target(s())
      if (w !== null) w.ink = n
    },

    /** `Gui Paper colour` */
    'gui paper': (it) => {
      const n = it.evalInt()
      const w = target(s())
      if (w !== null) w.paper = n
    },

    /** `Gui Writing mode` — the drawing mode, kept and not yet acted on */
    'gui writing': (it) => {
      const n = it.evalInt()
      const w = target(s())
      if (w !== null) w.writing = n
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
      const w = target(s())
      if (w !== null) w.rp.setRast(c)
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
      s().windows.get(n)?.rp.setRast(c)
    },

    /** `Gui Plot x,y` */
    'gui plot': (it) => {
      const [x, y] = pair(it)
      const w = target(s())
      if (w === null) return
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
      const w = target(s())
      if (w === null) return
      w.rp.draw(x1, y1, x2, y2, w.ink)
      w.grX = x2
      w.grY = y2
    },

    /** `Gui Draw To x,y` — on from wherever the cursor was left */
    'gui draw to': (it) => {
      const [x, y] = pair(it)
      const w = target(s())
      if (w === null) return
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
      const w = target(s())
      if (w === null) return
      w.rp.rectFill(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2), w.ink)
      w.grX = x1
      w.grY = y1
    },

    /** `Gui Box x,y To x2,y2` — the outline of the same rectangle */
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
      const w = target(s())
      if (w === null || rx <= 0 || ry <= 0) return
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
      const w = target(s())
      if (w === null) return
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
      const w = target(s())
      if (w === null) return
      drawBevelBox(w.rp, x, y, width, height, bevelPens(w), { recessed: mode !== 0 })
    },

    /** `Gui Text x,y,text$` */
    'gui text': (it) => {
      const [x, y] = pair(it)
      it.expect(',')
      const text = str(it.evalExpr())
      const w = target(s())
      if (w === null || w.rp.font === null) return
      w.rp.text(x, y, text, w.ink)
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

    /** `A=Gui Window` — which window generated the last event */
    'gui window': (): Value => VI(s().eventWindow()),

    /** `A=Gui Selected` — the currently selected window */
    'gui selected': (): Value => VI(s().selected),

    /** `A=Gui Actual` — "the window number set by the Gui Gfx command" */
    'gui actual': (): Value => VI(s().actual),

    /**
     * `INK=Gui Point(X,Y)` — "Works in exactly the same way as the Amos
     * command Point. It will simply returns the colour of the point at the
     * specified X,Y coordinates."
     */
    'gui point': (_, a): Value => {
      const w = target(s())
      if (w === null) return VI(0)
      return VI(w.rp.point(int(a[0]!), int(a[1]!)))
    },

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
      const w = s().windows.get(int(a[0]!))
      if (w === undefined) return VI(0)
      return VI([WBORLEFT, TITLE_HEIGHT, WBORRIGHT, WBORBOTTOM][int(a[1]!)] ?? 0)
    },
  }
}

/** the event codes, re-exported so the tests and later keyword groups share them */
export { GUI_EVENT }

/** what a caller outside the extension needs to raise an event */
export function guiPost(rt: Runtime, window: number, code: number, result = 0, text = ''): void {
  rt.gui.post({ code, result, text, window })
}

