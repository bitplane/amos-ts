/**
 * GUI 2.10's General group, run as AMOS.
 *
 * ./guistate.test.ts checks the state machine directly; this checks that the
 * keywords reach it, with the argument counts the token table declares. Two
 * of those specs corrected a first reading of the guide, and both have a test
 * here so the correction cannot quietly come undone.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { GUI_ERR, GUI_ERRORS, GUI_EVENT, guiPost } from './gui'
import { readGuiBank } from './guibank'
import { DEFAULT_MOUSE_QUEUE, GUI_CLOSE, GUI_TITLE_MAX, guiScale } from './guistate'
import { packMenuNumber } from './guistate'
import { MENU_FLAG } from '../amiga/gadtools'
import { parseAmosFile } from '../loader/amosfile'
import { haveCorpus } from '../cli/corpus'
import { firstCodeHunk } from '../tokens/libtok'
import { describeWith } from '../testing/fixture'

const table = new TokenTable(CORE_TOKENS)
/** slot 24, the manifest's recommendedSlot */
const gui = extensionById('gui-2.10')!
const exts = new Map([[24, gui.table]])

const EXAMPLE = '../amos-files/sources/ultimate-amiga-amos-factory/files/gui210/GUI2/Examples/BootSelector.Amos'

function exampleBank(): Uint8Array | null {
  if (!haveCorpus()) return null
  try {
    const file = parseAmosFile(new Uint8Array(readFileSync(EXAMPLE)))
    const b = file?.banks.find((x) => 'data' in x && (x as { number?: number }).number === 20)
    return b && 'data' in b ? (b.data as Uint8Array) : null
  } catch {
    return null
  }
}

/** run a listing with the GUI extension present, and hand back the machine */
function run(src: string, bank?: Uint8Array): Runtime {
  return runOut(src, bank).rt
}

/** the same, keeping what the program printed */
function runOut(src: string, bank?: Uint8Array): { rt: Runtime; out: string } {
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[24, gui]]),
    maxSteps: 2_000_000,
    onText: (t) => (out += t),
  })
  if (bank !== undefined) {
    rt.memBanks.set(20, { kind: 'memory', number: 20, memType: 1, name: 'Gui', flags: 0, data: bank })
  }
  mustFinish(rt.runHeadless(500))
  return { rt, out }
}

/**
 * What a one-line program prints.
 *
 * Reading a variable out of the interpreter needs its internal key, which is
 * not the name as written; printing is what every other extension test here
 * does and it exercises the same path a program would.
 */
function val(expr: string, bank?: Uint8Array): number {
  return Number(runOut(`Print ${expr}`, bank).out.trim())
}

describe('the keywords reach the state', () => {
  it('Gui Bank names the bank, and starts at 20', () => {
    const rt = run('Gui Bank 22')
    expect(rt.gui.bank).toBe(22)
    expect(run('Rem').gui.bank).toBe(20)
  })

  it('Gui Reset closes everything', () => {
    const rt = run('Gui Reset')
    expect(rt.gui.windows.size).toBe(0)
  })

  it('Gui Wait and Gui Event both answer -7 with nothing queued', () => {
    expect(val('Gui Wait')).toBe(GUI_EVENT.NOTHING)
    expect(val('Gui Event')).toBe(GUI_EVENT.NOTHING)
  })

  it('Gui Exist is false for a window nobody opened', () => {
    expect(val('Gui Exist(1)')).toBe(0)
  })

  it('Gui Close on nothing answers 0', () => {
    expect(val('Gui Close(1)')).toBe(0)
  })

  it('Gui Code answers -1 before anything has happened', () => {
    expect(val('Gui Code')).toBe(-1)
  })

  it('Gui Window and Gui Selected start at 0, and Gui Actual at -1', () => {
    for (const f of ['Gui Window', 'Gui Selected']) expect(val(f), f).toBe(0)
    // $2158 loads -1 and the window-list test at $215a leaves it there
    expect(val('Gui Actual')).toBe(-1)
  })

  /**
   * `Gui Gfx type,number` takes TWO arguments and the first is not a window:
   * 0 is Window and 1 is Screen. The token table's spec is `I0,0`, and a
   * one-argument reading would have pointed every drawing keyword at a
   * screen number.
   */
  it('Gui Gfx takes a type and a number, in that order', () => {
    const rt = run('Gui Gfx 1,3')
    expect(rt.gui.gfxToScreen).toBe(true)
    expect(rt.gui.gfxScreen).toBe(3)
  })
})

describeWith('with BootSelector s own bank loaded', exampleBank(), (bank) => {
  it('the bank holds one GUI with four gadgets', () => {
    expect(readGuiBank(bank)).toHaveLength(1)
  })

  it('Gui Open opens it, and Gui Exist then says so', () => {
    expect(val('Gui Exist(1)', bank)).toBe(0)
    const { rt, out } = runOut('Gui Open 1,1 : Print Gui Exist(1) : Print Gui Actual', bank)
    expect(out.trim().split('\n').map(Number)).toEqual([-1, 1])
    expect(rt.gui.windows.size).toBe(1)
  })

  /** the gui number is one-based in a program and zero-based in the bank */
  it('counts GUIs from one, so gui 2 is not there', () => {
    const rt = run('Gui Open 1,2', bank)
    expect(rt.gui.windows.size).toBe(0)
  })

  it('takes the editor s geometry unless given some', () => {
    const rt = run('Gui Open 1,1', bank)
    const w = rt.gui.windows.get(1)!
    expect([w.width, w.height]).toEqual([143, 37])
    const rt2 = run('Gui Open 1,1,20,5,6,7,8', bank)
    const w2 = rt2.gui.windows.get(1)!
    expect([w2.left, w2.top, w2.width, w2.height]).toEqual([5, 6, 7, 8])
  })

  it('Gui Close answers 3 for the last window', () => {
    const out = runOut('Gui Open 1,1 : Print Gui Close(1) : Print Gui Exist(1)', bank).out
    expect(out.trim().split('\n').map(Number)).toEqual([3, 0])
  })

  /**
   * "Gui Lock will disable all the open windows except the specified
   * window", which is the opposite of what the name suggests and of what
   * pairing it with Gui Unlock suggests. Its spec is `I0`, one argument.
   */
  it('Gui Lock locks everything except the one named', () => {
    const rt = run('Gui Open 1,1 : Gui Open 2,1 : Gui Lock 2', bank)
    // the same design opened twice is two windows
    expect(rt.gui.windows.get(1)!.locked).toBe(true)
    expect(rt.gui.windows.get(2)!.locked).toBe(false)
    const rt2 = run('Gui Open 1,1 : Gui Lock 1 : Gui Unlock', bank)
    expect(rt2.gui.windows.get(1)!.locked).toBe(false)
  })

  it('reports a queued gadget click through Wait, Code and Window', () => {
    const rt = run('Gui Open 1,1', bank)
    guiPost(rt, 1, 2, 55, 'typed')
    expect(rt.gui.nextEvent()).toBe(2)
    expect(rt.gui.readCode()).toBe(55)
    expect(rt.gui.readCode()).toBe(-1)
    expect(rt.gui.readCodeText()).toBe('typed')
    expect(rt.gui.eventWindow()).toBe(1)
  })
})

describeWith('the drawing group', exampleBank(), (bank) => {
  /** open a window and hand back the machine, so a test can read its pixels */
  function drawn(body: string): Runtime {
    return run(`Gui Open 1,1 : ${body}`, bank)
  }
  const rp = (rt: Runtime) => rt.gui.windows.get(1)!.rp

  it('gives the window a bitmap of its own size', () => {
    const rt = drawn('Rem')
    expect([rp(rt).width, rp(rt).height]).toEqual([143, 37])
  })

  it('Gui Ink sets the colour every later keyword uses', () => {
    const rt = drawn('Gui Ink 5 : Gui Plot 10,10')
    expect(rt.gui.windows.get(1)!.ink).toBe(5)
    expect(rp(rt).point(10, 10)).toBe(5)
  })

  it('Gui Cls fills the whole window', () => {
    const rt = drawn('Gui Cls 3')
    expect(rp(rt).point(0, 0)).toBe(3)
    expect(rp(rt).point(142, 36)).toBe(3)
  })

  /** "Gui Clw will clear all of the graphics from the specified window" */
  it('Gui Clw takes a window number and a colour', () => {
    const rt = drawn('Gui Cls 3 : Gui Clw 1,7')
    expect(rp(rt).point(5, 5)).toBe(7)
  })

  it('Gui Draw joins two points and leaves the cursor at the far end', () => {
    const rt = drawn('Gui Ink 4 : Gui Draw 0,0 To 20,0 : Gui Draw To 20,10')
    expect(rp(rt).point(10, 0)).toBe(4)
    expect(rp(rt).point(20, 5)).toBe(4)
    const w = rt.gui.windows.get(1)!
    expect([w.grX, w.grY]).toEqual([20, 10])
  })

  it('Gui Bar fills and Gui Box outlines the same rectangle', () => {
    const bar = drawn('Gui Ink 6 : Gui Bar 2,2 To 12,12')
    expect(rp(bar).point(7, 7)).toBe(6)
    const box = drawn('Gui Ink 6 : Gui Box 2,2 To 12,12')
    expect(rp(box).point(7, 2)).toBe(6)
    expect(rp(box).point(7, 7)).toBe(0)
  })

  it('Gui Ellipse draws, and refuses a zero radius', () => {
    const rt = drawn('Gui Ink 2 : Gui Ellipse 40,18,20,10')
    expect(rp(rt).point(60, 18)).toBe(2)
    // a zero radius draws nothing rather than throwing
    expect(() => drawn('Gui Ellipse 40,18,0,10')).not.toThrow()
  })

  it('Gui Paint floods from the point given', () => {
    const rt = drawn('Gui Ink 1 : Gui Box 2,2 To 20,20 : Gui Ink 5 : Gui Paint 10,10')
    expect(rp(rt).point(10, 10)).toBe(5)
    // the outline is untouched, which is what stopped the flood
    expect(rp(rt).point(2, 10)).toBe(1)
  })

  it('Gui Point reads a colour back', () => {
    expect(Number(runOut('Gui Open 1,1 : Gui Ink 6 : Gui Plot 4,4 : Print Gui Point(4,4)', bank).out.trim())).toBe(6)
    expect(Number(runOut('Gui Open 1,1 : Print Gui Point(4,4)', bank).out.trim())).toBe(0)
  })

  /**
   * "If mode is set to anything other than 0, then the box is drawn
   * recessed", which is the same sentence gadtools.ts reads for
   * DrawBevelBoxA, because this is that call.
   */
  it('Gui Bbox draws a bevel and mode swaps it', () => {
    const raised = drawn('Gui Ink 4 : Gui Paper 2 : Gui Bbox 4,4,20,10,0')
    const sunk = drawn('Gui Ink 4 : Gui Paper 2 : Gui Bbox 4,4,20,10,1')
    expect(rp(raised).point(4, 4)).toBe(4)
    expect(rp(sunk).point(4, 4)).toBe(2)
    // and the far corner is the other way round in each
    expect(rp(raised).point(23, 13)).toBe(2)
    expect(rp(sunk).point(23, 13)).toBe(4)
  })

  it('Gui Border answers the four sides in the guide s order', () => {
    const out = runOut('Gui Open 1,1 : For I=0 To 3 : Print Gui Border(1,I) : Next', bank).out
    const sides = out.trim().split('\n').map(Number)
    expect(sides).toHaveLength(4)
    // left and right are the same, and the top carries the title bar
    expect(sides[0]).toBe(sides[2])
    expect(sides[1]).toBeGreaterThan(sides[3]!)
  })

  /**
   * Every drawing keyword tests `$1bc`, the Gfx RastPort, and raises error 11
   * when it is zero. The guide never mentions it; the string table and the
   * `moveq #$b,d7` in front of each branch are the whole evidence.
   */
  it('drawing with no Gfx output raises rather than doing nothing', () => {
    for (const kw of ['Gui Ink 3', 'Gui Plot 1,1', 'Gui Cls 2', 'Gui Bar 0,0 To 4,4', 'Gui Writing 1', 'Gui Text 0,0,"x"']) {
      expect(() => run(kw, bank), kw).toThrow(GUI_ERRORS[GUI_ERR.GFX_NOT_DEFINED])
    }
  })

  /**
   * DEFECT: `Gui Box` is the one that does not check. $48f6 loads `$1bc` into
   * an address register and writes through it without testing, where `Gui
   * Bar` beside it tests and raises.
   */
  it('Gui Box alone does not raise, because it never looks', () => {
    expect(() => run('Gui Box 0,0 To 4,4', bank)).not.toThrow()
  })
})

describeWith('the gadget group', exampleBank(), (bank) => {
  /** BootSelector's design: gadget 0 is TEXT, 1..3 are IMAGE */
  const open = 'Gui Open 1,1'

  it('Gui Kind names each gadget, and -1 for one that is not there', () => {
    const out = runOut(`${open} : For I=0 To 3 : Print Gui Kind(1,I) : Next : Print Gui Kind(1,9)`, bank).out
    expect(out.trim().split('\n').map(Number)).toEqual([13, 0, 0, 0, -1])
  })

  /**
   * "Gui Read is similar to Gui Code except it doesnt need to be called
   * after the specified gadget is selected", so unlike Gui Code it does not
   * reset itself on read.
   */
  it('Gui Set writes attribute 0 and Gui Read reads it, twice', () => {
    const out = runOut(`${open} : Gui Set 1,1,0,42 : Print Gui Read(1,1) : Print Gui Read(1,1)`, bank).out
    expect(out.trim().split('\n').map(Number)).toEqual([42, 42])
  })

  it('keeps the three attributes apart', () => {
    const rt = run(`${open} : Gui Set 1,1,0,7 : Gui Set 1,1,1,8 : Gui Set 1,1,2,9`, bank)
    expect(rt.gui.attrsOf(rt.gui.windows.get(1)!, 1)).toEqual([7, 8, 9])
  })

  it('ignores an attribute outside the guide s range', () => {
    const rt = run(`${open} : Gui Set 1,1,3,5`, bank)
    expect(rt.gui.attrsOf(rt.gui.windows.get(1)!, 1)).toEqual([0, 0, 0])
  })

  /** `Gui Set 1,5,-1,1 : Rem Gadget number 5 in win 1 is turned OFF` */
  it('attribute -1 ghosts a gadget and 0 brings it back', () => {
    const off = run(`${open} : Gui Set 1,2,-1,1`, bank)
    expect(off.gui.windows.get(1)!.ghosted.has(2)).toBe(true)
    const on = run(`${open} : Gui Set 1,2,-1,1 : Gui Set 1,2,-1,0`, bank)
    expect(on.gui.windows.get(1)!.ghosted.has(2)).toBe(false)
  })

  /** routine 241 checks the attribute first, then the gadget, both as error 9 */
  it('raises Illegal gadget value for a gadget the design does not have', () => {
    expect(() => run(`${open} : Gui Set 1,9,0,5`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_GADGET_VALUE])
    expect(() => run(`${open} : Gui Set 1,0,-2,5`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_GADGET_VALUE])
    expect(() => run(`Gui Set 9,0,0,5`, bank)).toThrow(GUI_ERRORS[GUI_ERR.WINDOW_NOT_OPEN])
  })

  /**
   * Gui Read$ answers for LISTVIEW, CYCLE and STRING, and "For all the other
   * kind of gadgets a empty string will be returned". BootSelector's gadget
   * 0 is a TEXT, which is not on that list.
   */
  it('Gui Set$ and Gui Read$ carry a string, but only for the three kinds', () => {
    const out = runOut(`${open} : Gui Set$ 1,0,"hello" : Print "[";Gui Read$(1,0);"]"`, bank).out
    expect(out.trim()).toBe('[]')
  })

  it('Gui Read$ raises for a closed window and is empty for a missing gadget', () => {
    expect(() => run(`${open} : Print Gui Read$(9,0)`, bank)).toThrow(GUI_ERRORS[GUI_ERR.WINDOW_NOT_OPEN])
    expect(runOut(`${open} : Print "[";Gui Read$(1,9);"]"`, bank).out.trim()).toBe('[]')
  })

  /**
   * BootSelector's three image gadgets sit at x=0, 48 and 96, all 48 wide and
   * 37 tall, so a point in each lands on a different one and a point below
   * them lands on none.
   */
  it('Gui Check finds the gadget under a point, or -1', () => {
    const out = runOut(`${open} : Print Gui Check(1,10,10) : Print Gui Check(1,60,10) : Print Gui Check(1,100,10) : Print Gui Check(1,10,200)`, bank).out
    expect(out.trim().split('\n').map(Number)).toEqual([1, 2, 3, -1])
  })

  it('Gui Check raises for a window that is not open', () => {
    expect(() => run(`${open} : Print Gui Check(9,10,10)`, bank)).toThrow(GUI_ERRORS[GUI_ERR.WINDOW_NOT_OPEN])
  })

  /**
   * "if you have done Gui Range 1,1,10,20... 5 will be set to 10", and the
   * gadget has to be an INTEGER: `cmpi.l #$3,d0 / Rbne` at $2532. None of
   * BootSelector's four is, so this design can only show the refusal.
   */
  it('Gui Range takes an INTEGER gadget and refuses anything else', () => {
    expect(() => run(`${open} : Gui Range 1,1,10,20`, bank)).toThrow(GUI_ERRORS[GUI_ERR.NOT_AN_INPUT_GADGET])
    // the reversed range is checked before the gadget, and answers 9 not 19
    expect(() => run(`${open} : Gui Range 1,1,20,10`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_GADGET_VALUE])
  })

  /** INTEGER or STRING only, by number at $2836 and $283e; BootSelector has neither */
  it('Gui Activate refuses a gadget that is not an INTEGER or a STRING', () => {
    for (const id of [0, 1, 2, 3, 9]) {
      expect(() => run(`${open} : Gui Activate 1,${id}`, bank), `gadget ${id}`).toThrow(GUI_ERRORS[GUI_ERR.NOT_AN_INPUT_GADGET])
    }
  })
})

/**
 * The menu group, over the one bank on this machine that carries menus.
 *
 * `DBench/DB_Information.abk` from Kyzer's DataBench: three titles, twelve
 * items, two of them separators. Nothing else held has a menu at all, so
 * without it these five keywords could only be tested against a strip this
 * repo made up.
 */
const DBENCH = '../amos-files/sources/kyzer-dbench/files/DBench/DB_Information.abk'

function dbenchBank(): Uint8Array | null {
  if (!haveCorpus()) return null
  try {
    const b = new Uint8Array(readFileSync(DBENCH))
    if (String.fromCharCode(...b.subarray(0, 4)) !== 'AmBk') return null
    return b.subarray(20)
  } catch {
    return null
  }
}

describeWith('the menu group, over DataBench s menu bar', dbenchBank(), (bank) => {
  const open = 'Gui Open 1,1'
  /** menu 1 item 1 is "Use", the first thing under Project */
  const USE = packMenuNumber(1, 1, 0)

  it('builds the strip from the bank when the window opens', () => {
    const rt = run(open, bank)
    const strip = rt.gui.windows.get(1)!.strip!
    expect(strip.menus.map((m) => m.label)).toEqual(['Project', 'View', 'Functions'])
    expect(strip.menus[0]!.items).toHaveLength(5)
  })

  /**
   * A zero argument means the field is absent, so item 0 names the whole
   * menu. That is `OffMenu` with NOITEM, and intuition takes the column with
   * the title.
   */
  it('Gui Menu Off takes a whole menu, and Gui Menu On gives it back', () => {
    const rt = run(`${open} : Gui Menu Off 1,2,0,0`, bank)
    const strip = rt.gui.windows.get(1)!.strip!
    expect(strip.menus[1]!.disabled).toBe(true)
    expect(strip.menus[0]!.disabled).toBe(false)
    const back = run(`${open} : Gui Menu Off 1,2,0,0 : Gui Menu On 1,2,0,0`, bank)
    expect(back.gui.windows.get(1)!.strip!.menus[1]!.disabled).toBe(false)
  })

  it('names one item when the third argument is given', () => {
    const rt = run(`${open} : Gui Menu Off 1,1,2,0`, bank)
    const items = rt.gui.windows.get(1)!.strip!.menus[0]!.items
    expect(items[1]!.label).toBe('Close')
    expect(items[1]!.disabled).toBe(true)
    expect(items[0]!.disabled).toBe(false)
  })

  /**
   * Check is `ori.w #$100` and uncheck is `andi.w #$ff`, so the two are not
   * inverses in Flags even though they are in `checked`. See the DEFECT note
   * on `gui menu uncheck`.
   */
  it('Gui Menu Check sets CHECKED, and Uncheck clears the whole high byte', () => {
    const rt = run(`${open} : Gui Menu Check 1,1,1,0`, bank)
    const item = rt.gui.windows.get(1)!.strip!.menus[0]!.items[0]!
    expect(item.checked).toBe(true)
    expect(item.flags & MENU_FLAG.CHECKED).toBe(MENU_FLAG.CHECKED)

    const rt2 = run(`${open} : Gui Menu Check 1,1,1,0 : Gui Menu Uncheck 1,1,1,0`, bank)
    const item2 = rt2.gui.windows.get(1)!.strip!.menus[0]!.items[0]!
    expect(item2.checked).toBe(false)
    expect(item2.flags & 0xff00).toBe(0)
  })

  it('does nothing at all for a window that is not open', () => {
    expect(() => run(`${open} : Gui Menu Check 9,1,1,0`, bank)).not.toThrow()
  })

  /**
   * The guide's whole account of event -2: "A menu item has been selected.
   * You've to use the Gui Menu function to know which item has been chosen."
   */
  it('Gui Wait reports -2 and Gui Menu says which item', () => {
    const rt = run(open, bank)
    rt.gui.postMenu(1, USE)
    expect(rt.gui.nextEvent()).toBe(GUI_EVENT.MENU)
    expect([rt.gui.menuField(1), rt.gui.menuField(2), rt.gui.menuField(3)]).toEqual([1, 1, 32])
  })

  /** picking a CHECKIT item is what turns its checkmark on, not the keyword */
  it('a pick moves the item s own state, the way gadtools selectItem does', () => {
    const rt = run(open, bank)
    const item = rt.gui.windows.get(1)!.strip!.menus[0]!.items[0]!
    item.flags |= MENU_FLAG.CHECKIT
    rt.gui.postMenu(1, USE)
    expect(item.checked).toBe(true)
  })
})

/**
 * The error table, re-read out of the library rather than restated.
 *
 * `AMOSPro_GUI.Lib` from the same archive the manifest names. The strings are
 * packed NUL-separated in the code hunk and `L_ErrorExt` indexes them
 * zero-based, so a transcription slip anywhere in the list shifts every
 * message after it onto the wrong branch.
 */
const LIBRARY = '../amos-files/sources/ultimate-amiga-amos-factory/files/gui210/GUI2/AMOSPro_GUI.Lib'

function errorStrings(): string[] | null {
  if (!haveCorpus()) return null
  try {
    const code = firstCodeHunk(new Uint8Array(readFileSync(LIBRARY)))
    if (code === null) return null
    // $7952 is the address the `lea $7952(pc),a0` at $7940 loads, and $7c58
    // is the byte after the last message's NUL: 774 bytes for 35 strings
    const text = String.fromCharCode(...code.subarray(0x7952, 0x7c58))
    return text.split('\0').slice(0, GUI_ERRORS.length)
  } catch {
    return null
  }
}

describeWith('the error table', errorStrings(), (strings) => {
  it('is the library s own thirty-five messages, in its own order', () => {
    expect(GUI_ERRORS).toHaveLength(35)
    expect([...GUI_ERRORS]).toEqual(strings)
  })

  /** the six this file raises by name have to be at the indices it uses */
  it('has the named indices where the code branches to them', () => {
    expect(GUI_ERRORS[GUI_ERR.BANK_NOT_RESERVED]).toBe('Bank not reserved')
    expect(GUI_ERRORS[GUI_ERR.NOT_A_GUI_BANK]).toBe('Not a Gui bank')
    expect(GUI_ERRORS[GUI_ERR.ILLEGAL_GADGET_VALUE]).toBe('Illegal gadget value')
    expect(GUI_ERRORS[GUI_ERR.WINDOW_NOT_OPEN]).toBe('Window not open')
    expect(GUI_ERRORS[GUI_ERR.GFX_NOT_DEFINED]).toBe('Gfx output not defined')
    expect(GUI_ERRORS[GUI_ERR.NOT_AN_INPUT_GADGET]).toBe("This isn't a Integer/String Gadget")
  })
})

describeWith('the three text pens', exampleBank(), (bank) => {
  /**
   * `Gui Pen`, `Gui Paper` and `Gui Writing` write one byte each into the
   * EXTENSION's state at $290, $28e and $292, not into a window. `Gui Text`
   * copies all three into an IntuiText at $25cc. So opening a second window
   * does not reset them, where `Gui Ink` follows whichever RastPort is
   * current because it is a SetAPen.
   */
  it('belong to the extension and survive a change of window', () => {
    const rt = run('Gui Open 1,1 : Gui Pen 5 : Gui Paper 3 : Gui Open 2,1 : Gui Gfx 0,2', bank)
    expect([rt.gui.pen, rt.gui.paper]).toEqual([5, 3])
  })

  /**
   * `Gui Writing` is the one of the three that also calls SetDrMd, so it is
   * the one that needs an output open. `Gui Pen` and `Gui Paper` touch no
   * RastPort and raise nothing.
   */
  it('and only Writing needs a Gfx output', () => {
    expect(() => run('Gui Pen 5 : Gui Paper 3', bank)).not.toThrow()
    expect(() => run('Gui Writing 1', bank)).toThrow(GUI_ERRORS[GUI_ERR.GFX_NOT_DEFINED])
  })
})

/**
 * The mouse group, ten keywords the guide documents fully and the binary
 * settles the details of.
 *
 * Three of them read the pointer through a Screen this port has not opened,
 * so what a screen coordinate IS here is `screenMouse`'s deviation and the
 * numbers below follow from it: hardware X 128 and hardware line 44 are the
 * top left of a hires 640x256 Workbench.
 */
describeWith('the mouse group', exampleBank(), (bank) => {
  const open = 'Gui Open 1,1'

  /** put the pointer somewhere and read the two screen coordinates back */
  function atHardware(x: number, y: number, src: string): number[] {
    let out = ''
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[24, gui]]),
      maxSteps: 2_000_000,
      onText: (t) => (out += t),
    })
    rt.memBanks.set(20, { kind: 'memory', number: 20, memType: 1, name: 'Gui', flags: 0, data: bank })
    rt.input.mouseX = x
    rt.input.mouseY = y
    mustFinish(rt.runHeadless(500))
    return out.trim().split('\n').map(Number)
  }

  /**
   * `Screen.MouseX` is at $12 and `MouseY` at $10, because the struct stores
   * Y first. Hardware 128,44 is the Workbench's top left, and X doubles
   * because the screen is hires.
   */
  it('Gui Mouse X and Y are the pointer on the Workbench screen', () => {
    expect(atHardware(128, 44, 'Print Gui Mouse X : Print Gui Mouse Y')).toEqual([0, 0])
    expect(atHardware(228, 144, 'Print Gui Mouse X : Print Gui Mouse Y')).toEqual([200, 100])
  })

  it('and are clamped to the screen, which is where intuition keeps them', () => {
    expect(atHardware(0, 0, 'Print Gui Mouse X : Print Gui Mouse Y')).toEqual([0, 0])
    expect(atHardware(9999, 9999, 'Print Gui Mouse X : Print Gui Mouse Y')).toEqual([639, 255])
  })

  /**
   * BootSelector's window sits at the position its editor saved. Wx and Wy
   * are the same pointer less that corner, and unlike X and Y they are not
   * clamped: intuition lets a window's MouseX go negative when the pointer
   * leaves it.
   */
  it('Gui Mouse Wx and Wy take the window s corner off', () => {
    const rt = run(open, bank)
    const w = rt.gui.windows.get(1)!
    const got = atHardware(228, 144, `${open} : Print Gui Mouse Wx : Print Gui Mouse Wy`)
    expect(got).toEqual([200 - w.left, 100 - w.top])
  })

  /** the `moveq #$a,d7` at $2a0a, which is 10 and not the drawing keywords' 11 */
  it('Gui Mouse Wx raises Window not open with no Gfx window', () => {
    expect(() => run('Print Gui Mouse Wx', bank)).toThrow(GUI_ERRORS[GUI_ERR.WINDOW_NOT_OPEN])
    expect(() => run('Print Gui Mouse Wy', bank)).toThrow(GUI_ERRORS[GUI_ERR.WINDOW_NOT_OPEN])
  })

  /**
   * "you'll get the CURRENT mouse coord wich may be different from the point
   * where the user has clicked" -- so Ex and Ey are the event's, taken from
   * the IntuiMessage rather than from the pointer.
   */
  it('Gui Mouse Ex and Ey hold where the event happened, not where the pointer is', () => {
    const rt = run(open, bank)
    guiPost(rt, 1, GUI_EVENT.MOUSECLICK, 0, '', [77, 88])
    expect(rt.gui.nextEvent()).toBe(GUI_EVENT.MOUSECLICK)
    expect([rt.gui.eventX, rt.gui.eventY]).toEqual([77, 88])
    // an event with no position leaves the last one standing: nothing clears
    // the two words
    guiPost(rt, 1, GUI_EVENT.CLOSE)
    expect(rt.gui.nextEvent()).toBe(GUI_EVENT.CLOSE)
    expect([rt.gui.eventX, rt.gui.eventY]).toEqual([77, 88])
  })

  it('Gui Mouse Mode is a word the pump reads, and takes anything', () => {
    expect(run('Gui Mouse Mode 1', bank).gui.mouseMode).toBe(1)
    expect(run('Gui Mouse Mode 0', bank).gui.mouseMode).toBe(0)
  })

  /** SetMouseQueue's argument, over intuition's own default of five */
  it('Gui Mouse Queue is per window and starts at intuition s five', () => {
    const rt = run(`${open} : Gui Open 2,1 : Gui Mouse Queue 1,40`, bank)
    expect(rt.gui.windows.get(1)!.mouseQueue).toBe(40)
    expect(rt.gui.windows.get(2)!.mouseQueue).toBe(DEFAULT_MOUSE_QUEUE)
  })

  it('Gui Mouse Report is WFLG_REPORTMOUSE, and off to begin with', () => {
    expect(run(open, bank).gui.windows.get(1)!.reportMouse).toBe(false)
    expect(run(`${open} : Gui Mouse Report 1,-1`, bank).gui.windows.get(1)!.reportMouse).toBe(true)
    // the word beside the flag only ever tests bit 0, so a second True
    // changes nothing and one False clears it
    expect(run(`${open} : Gui Mouse Report 1,-1 : Gui Mouse Report 1,-1 : Gui Mouse Report 1,0`, bank).gui.windows.get(1)!.reportMouse).toBe(false)
  })

  /**
   * The inversion, which is the one thing about this group a program can get
   * backwards: True means intuition keeps the button and the menus still pop
   * up. $2c12 CLEARS RMBTRAP for True.
   */
  it('Gui Rmb True leaves the button to intuition and False takes it', () => {
    expect(run(open, bank).gui.windows.get(1)!.rmb).toBe(true)
    expect(run(`${open} : Gui Rmb 1,False`, bank).gui.windows.get(1)!.rmb).toBe(false)
    expect(run(`${open} : Gui Rmb 1,False : Gui Rmb 1,True`, bank).gui.windows.get(1)!.rmb).toBe(true)
  })

  it('every one that names a window raises when it is not open', () => {
    for (const kw of ['Gui Mouse Queue 9,40', 'Gui Mouse Report 9,-1', 'Gui Rmb 9,0']) {
      expect(() => run(kw, bank), kw).toThrow(GUI_ERRORS[GUI_ERR.WINDOW_NOT_OPEN])
    }
  })
})

/**
 * The Window Sizes group, and the font-sensitive scale under it.
 *
 * BootSelector's window is 143x37 at the position its editor saved, and its
 * three image gadgets are 48x37 at x = 0, 48 and 96 in the bank. Every number
 * below is one of those put through the layout the library does at open.
 */
describeWith('the window sizes group', exampleBank(), (bank) => {
  const open = 'Gui Open 1,1'

  it('Gui Width, Height, X and Y are the Window struct s four fields', () => {
    const rt = run(open, bank)
    const w = rt.gui.windows.get(1)!
    const got = runOut(`${open} : Print Gui Width(1) : Print Gui Height(1) : Print Gui X(1) : Print Gui Y(1)`, bank).out
    expect(got.trim().split('\n').map(Number)).toEqual([w.width, w.height, w.left, w.top])
    expect([w.width, w.height]).toEqual([143, 37])
  })

  /**
   * "excluding the window borders", which is BorderLeft + BorderRight off the
   * width and BorderTop + BorderBottom off the height. The same four bytes
   * `Gui Border` reports one at a time, so the two keywords have to agree.
   */
  it('Gui In Width and In Height take the four borders off', () => {
    const got = runOut(
      `${open} : Print Gui In Width(1) : Print Gui In Height(1) : Print Gui Border(1,0)+Gui Border(1,2) : Print Gui Border(1,1)+Gui Border(1,3)`,
      bank,
    ).out.trim().split('\n').map(Number)
    expect(got[0]).toBe(143 - got[2]!)
    expect(got[1]).toBe(37 - got[3]!)
  })

  /**
   * A gadget's box as the layout left it: the bank's coordinate scaled, then
   * the border added. With topaz/8 the scale is the identity, so the three
   * images land at their stored 0, 48 and 96 plus BorderLeft.
   */
  it('Gui X Gad and friends read the laid-out gadget, border included', () => {
    const got = runOut(
      `${open} : Print Gui X Gad(1,1) : Print Gui X Gad(1,2) : Print Gui Y Gad(1,1) : Print Gui Gad Width(1,1) : Print Gui Gad Height(1,1)`,
      bank,
    ).out.trim().split('\n').map(Number)
    const left = Number(runOut(`${open} : Print Gui Border(1,0)`, bank).out.trim())
    const top = Number(runOut(`${open} : Print Gui Border(1,1)`, bank).out.trim())
    expect(got[0]).toBe(0 + left)
    expect(got[1]).toBe(48 + left)
    expect(got[2]).toBe(0 + top)
    expect([got[3], got[4]]).toEqual([48, 37])
  })

  /** routine 246 answers 2 for the gadget and lets 244's 10 through for the window */
  it('a bad gadget is "Gadget not defined" and a closed window is not', () => {
    expect(() => run(`${open} : Print Gui X Gad(1,9)`, bank)).toThrow(GUI_ERRORS[GUI_ERR.GADGET_NOT_DEFINED])
    expect(() => run(`${open} : Print Gui Gad Width(1,-1)`, bank)).toThrow(GUI_ERRORS[GUI_ERR.GADGET_NOT_DEFINED])
    expect(() => run(`${open} : Print Gui Y Gad(9,0)`, bank)).toThrow(GUI_ERRORS[GUI_ERR.WINDOW_NOT_OPEN])
  })

  /**
   * TWO arguments. The guide prints `A=Gui Sx(X)` and its worked example
   * passes one, but the token table's spec is `00,0` and $28d8 pops a value
   * and a window. A one-argument reading would not even parse.
   */
  it('Gui Sx and its three siblings take the window first', () => {
    const spec = gui.table.entries.find((e) => e.name === 'gui sx')!.spec
    expect(spec).toBe('00,0')
    expect(() => run(`${open} : Print Gui Sx(1,10)`, bank)).not.toThrow()
  })

  /**
   * With topaz/8 the scale is the identity -- `(v*8+4)/8` is v -- so `Gui Sw`
   * and `Gui Sh` hand back what they were given, and `Gui Sx` is exact
   * because it takes off the same BorderLeft it adds back.
   */
  it('scales by the identity while the font is topaz/8', () => {
    const got = runOut(`${open} : Print Gui Sw(1,10) : Print Gui Sh(1,15) : Print Gui Sx(1,10)`, bank).out
    expect(got.trim().split('\n').map(Number)).toEqual([10, 15, 10])
    expect(runOut(`${open} : Print Gui X Font : Print Gui Y Font`, bank).out.trim().split('\n').map(Number)).toEqual([8, 8])
  })

  /**
   * DEFECT: `Gui Sy` takes off ten and adds eleven back. $2908 is
   * `subi.l #$a,d1` where GuiConv wrote `-11` and where $568a builds the
   * border it adds as WBorTop + font height + 1. So the guide's own example,
   * `Gui Bar Gui Sx(10),Gui Sy(15)`, lands one pixel low.
   */
  it('Gui Sy answers one more than it was given, and Gui Sx does not', () => {
    const got = runOut(`${open} : Print Gui Sy(1,15) : Print Gui Sx(1,15)`, bank).out
    expect(got.trim().split('\n').map(Number)).toEqual([16, 15])
  })

  /**
   * The scale itself, tested away from the keywords because no font this port
   * can reach is anything but topaz/8 yet. `+4` before an unsigned divide is
   * rounding to nearest.
   */
  it('the scale rounds to nearest, which is what the +4 before the divide is', () => {
    expect(guiScale(10, 8)).toBe(10)
    // topaz/9: ten cells become eleven and a bit, rounded to eleven
    expect(guiScale(10, 9)).toBe(11)
    expect(guiScale(1, 12)).toBe(2)
    expect(guiScale(0, 40)).toBe(0)
  })

  /**
   * "Gui Sensitive Off makes your windows use the topaz/8 font". The flag is
   * the extension's and a window copies it at open, so turning it off after a
   * window is open changes nothing about that window.
   */
  it('Gui Sensitive is the extension s flag, copied into a window at open', () => {
    expect(run(open, bank).gui.sensitive).toBe(true)
    const rt = run(`Gui Sensitive Off : ${open} : Gui Sensitive On`, bank)
    expect(rt.gui.sensitive).toBe(true)
    expect(rt.gui.windows.get(1)!.topaz).toBe(true)
    expect(run(open, bank).gui.windows.get(1)!.topaz).toBe(false)
  })
})

/**
 * The window-management group: the eleven keywords that move, size, stack and
 * name a window, plus the three that wait.
 */
describeWith('the window management group', exampleBank(), (bank) => {
  const open = 'Gui Open 1,1'

  /**
   * WindowToFront is one call and ActivateWindow at $1eae is the other, so
   * raising a window also selects it. `Gui To Back` has no second call and
   * leaves the selection where it was.
   */
  it('Gui To Front raises AND activates; Gui To Back only lowers', () => {
    const rt = run(`${open} : Gui Open 2,1 : Gui To Front 1`, bank)
    expect(rt.gui.stack().map((w) => w.number)).toEqual([1, 2])
    expect(rt.gui.selected).toBe(1)

    const back = run(`${open} : Gui Open 2,1 : Gui To Back 2`, bank)
    expect(back.gui.stack().map((w) => w.number)).toEqual([1, 2])
    // still 2, because opening it selected it and lowering it did not change that
    expect(back.gui.selected).toBe(2)
  })

  /** the stack is separate from the open order, which `Gui Close` still reports on */
  it('raising a window does not change what Gui Close reports', () => {
    const out = runOut(`${open} : Gui Open 2,1 : Gui To Front 1 : Print Gui Close(1)`, bank).out
    // window 1 was opened first, so closing it is still code 1
    expect(Number(out.trim())).toBe(GUI_CLOSE.FIRST)
  })

  it('Gui Move and Gui Resize each change their half', () => {
    const rt = run(`${open} : Gui Move 1,50,60 : Gui Resize 1,200,120`, bank)
    const w = rt.gui.windows.get(1)!
    expect([w.left, w.top, w.width, w.height]).toEqual([50, 60, 200, 120])
    // the RastPort follows the window, since the old one is the wrong size
    expect([w.rp.width, w.rp.height]).toEqual([200, 120])
  })

  it('Gui Change does both in one call', () => {
    const rt = run(`${open} : Gui Change 1,10,20,300,200`, bank)
    const w = rt.gui.windows.get(1)!
    expect([w.left, w.top, w.width, w.height]).toEqual([10, 20, 300, 200])
  })

  it('all three raise Window not open for a window that is not', () => {
    for (const kw of ['Gui Move 9,1,1', 'Gui Resize 9,10,10', 'Gui Change 9,1,1,10,10', 'Gui To Front 9', 'Gui To Back 9']) {
      expect(() => run(kw, bank), kw).toThrow(GUI_ERRORS[GUI_ERR.WINDOW_NOT_OPEN])
    }
  })

  /**
   * "Gui Center True,False  The windows will be centered only the X coord",
   * and the mask is read as a mask: the X centring is skipped only when it is
   * exactly GUI_CENTRE_Y and the Y only when it is exactly GUI_CENTRE_X.
   */
  it('Gui Center takes each axis on its own, at the next open', () => {
    const both = run(`Gui Center -1,-1 : ${open}`, bank).gui.windows.get(1)!
    expect([both.left, both.top]).toEqual([(640 - 143) >> 1, (256 - 37) >> 1])

    const xOnly = run(`Gui Center -1,0 : ${open}`, bank).gui.windows.get(1)!
    const plain = run(open, bank).gui.windows.get(1)!
    expect(xOnly.left).toBe((640 - 143) >> 1)
    expect(xOnly.top).toBe(plain.top)

    const yOnly = run(`Gui Center 0,-1 : ${open}`, bank).gui.windows.get(1)!
    expect(yOnly.left).toBe(plain.left)
    expect(yOnly.top).toBe((256 - 37) >> 1)

    // both false clears the mask, and $3266 clears the flag bit with it
    expect(run(`Gui Center -1,-1 : Gui Center 0,0 : ${open}`, bank).gui.windows.get(1)!.left).toBe(plain.left)
  })

  /**
   * "Gui Remember On will make the system remember where exactly a window was
   * when it was closed, so if it is opened again in the future, it will keep
   * its old positions."
   */
  it('Gui Remember keeps a closed window s position for the next open', () => {
    const kept = run(`Gui Remember On : ${open} : Gui Move 1,77,88 : A=Gui Close(1) : ${open}`, bank).gui.windows.get(1)!
    expect([kept.left, kept.top]).toEqual([77, 88])

    const forgotten = run(`${open} : Gui Move 1,77,88 : A=Gui Close(1) : ${open}`, bank).gui.windows.get(1)!
    const plain = run(open, bank).gui.windows.get(1)!
    expect([forgotten.left, forgotten.top]).toEqual([plain.left, plain.top])
  })

  /**
   * The window opens with the title the bank gave it, which for BootSelector
   * is GadToolsBox's own untouched default.
   */
  it('Gui Titles sets each title, and an empty string leaves one alone', () => {
    expect(runOut(`${open} : Print Gui Title$(1)`, bank).out.trim()).toBe('Work Window')
    expect(runOut(`${open} : Gui Titles 1,"Hello","Screen" : Print Gui Title$(1)`, bank).out.trim()).toBe('Hello')

    const rt = run(`${open} : Gui Titles 1,"Hello","Screen" : Gui Titles 1,"","Other"`, bank)
    const w = rt.gui.windows.get(1)!
    expect([w.title, w.screenTitle]).toEqual(['Hello', 'Other'])
  })

  /** a hundred characters, which is the 101-byte buffer less its NUL */
  it('and truncates a title to what the buffer holds', () => {
    const long = 'x'.repeat(200)
    const rt = run(`${open} : Gui Titles 1,"${long}",""`, bank)
    expect(rt.gui.windows.get(1)!.title).toHaveLength(GUI_TITLE_MAX)
  })

  /**
   * A number of zero or less names a SCREEN, which the guide never says.
   * $402e branches on it and works out `$10000 - n`.
   */
  it('Gui Title$ of zero or less asks about a screen, not a window', () => {
    for (const n of [0, -1, -3]) {
      expect(() => run(`${open} : Print Gui Title$(${n})`, bank), `${n}`).toThrow(GUI_ERRORS[GUI_ERR.SCREEN_NOT_OPENED])
    }
  })

  it('Gui Set Mode is one word for windows not yet opened', () => {
    expect(run('Gui Set Mode 1', bank).gui.iconifyGadget).toBe(1)
    expect(run('Rem', bank).gui.iconifyGadget).toBe(0)
  })

  it('Gui Beep asks for one, and Gui Wait Vbl takes a count or none', () => {
    expect(run('Gui Beep : Gui Beep', bank).gui.beeps).toBe(2)
    expect(() => run('Gui Wait Vbl', bank)).not.toThrow()
    expect(() => run('Gui Wait Vbl 3 : Gui Pause 2', bank)).not.toThrow()
  })
})
