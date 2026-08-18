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
import { GUI_EVENT, guiPost } from './gui'
import { readGuiBank } from './guibank'
import { packMenuNumber } from './guistate'
import { MENU_FLAG } from '../amiga/gadtools'
import { parseAmosFile } from '../loader/amosfile'
import { haveCorpus } from '../cli/corpus'
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

  it('Gui Window, Gui Selected and Gui Actual all start at 0', () => {
    for (const f of ['Gui Window', 'Gui Selected', 'Gui Actual']) expect(val(f), f).toBe(0)
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

  it('drawing with no window open does nothing rather than failing', () => {
    expect(() => run('Gui Ink 3 : Gui Plot 1,1 : Gui Cls 2', bank)).not.toThrow()
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

  it('does nothing for a gadget the design does not have', () => {
    const rt = run(`${open} : Gui Set 1,9,0,5 : Gui Set 1,9,-1,1`, bank)
    const w = rt.gui.windows.get(1)!
    expect(w.attrs.has(9)).toBe(false)
    expect(w.ghosted.size).toBe(0)
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

  it('Gui Read$ is empty for a window or gadget that is not there', () => {
    const out = runOut(`${open} : Print "[";Gui Read$(9,0);"]" : Print "[";Gui Read$(1,9);"]"`, bank).out
    expect(out.trim().split('\n')).toEqual(['[]', '[]'])
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

  it('Gui Check answers -1 for a window that is not open', () => {
    expect(Number(runOut(`${open} : Print Gui Check(9,10,10)`, bank).out.trim())).toBe(-1)
  })

  /** "if you have done Gui Range 1,1,10,20... 5 will be set to 10" */
  it('Gui Range records the clip an integer gadget is held to', () => {
    const rt = run(`${open} : Gui Range 1,1,10,20`, bank)
    expect(rt.gui.windows.get(1)!.ranges.get(1)).toEqual([10, 20])
  })

  it('Gui Activate names a gadget and Gui Gadget reads it back', () => {
    const out = runOut(`${open} : Gui Activate 1,2 : Print Gui Gadget`, bank).out
    expect(Number(out.trim())).toBe(2)
    // a gadget the design lacks is not activated
    expect(Number(runOut(`${open} : Gui Activate 1,9 : Print Gui Gadget`, bank).out.trim())).toBe(0)
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
