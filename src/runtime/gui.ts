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
import { VI, VS, int, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { readGuiBank } from './guibank'
import { GUI_EVENT, GuiState } from './guistate'

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

export function makeGuiInstructions(rt: Runtime): Record<string, Instr> {
  const s = (): GuiState => rt.gui

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
  }
}

/** the event codes, re-exported so the tests and later keyword groups share them */
export { GUI_EVENT }

/** what a caller outside the extension needs to raise an event */
export function guiPost(rt: Runtime, window: number, code: number, result = 0, text = ''): void {
  rt.gui.post({ code, result, text, window })
}

