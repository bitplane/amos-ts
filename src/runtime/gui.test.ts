/**
 * The three GUI releases, run as AMOS.
 *
 * ./guistate.test.ts checks the state machine directly; this checks that the
 * keywords reach it, with the argument counts the token table declares. Two
 * of those specs corrected a first reading of the guide, and both have a test
 * here so the correction cannot quietly come undone.
 *
 * Most of the file runs 2.10, which is the release with the most keywords and
 * the fullest guide. `on('1.6x')` and `on('1.5b')` build the same harness
 * bound to an earlier identity, and the blocks that use them are the places
 * the releases genuinely differ.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { GUI_ERR, GUI_ERRORS, GUI_ERRORS_15B, GUI_ERRORS_161, GUI_EVENT, guiPost, guiPostAppIcon } from './gui'
import { readGuiBank } from './guibank'
import { DEFAULT_MOUSE_QUEUE, GUI_CLOSE, GUI_OS_VERSION, GUI_TITLE_MAX, TCP_LIMIT_DEFAULT, TOPAZ_SIZE, expand12, guiScale } from './guistate'
import { packMenuNumber } from './guistate'
import { MENU_FLAG } from '../amiga/gadtools'
import { TITLE_HEIGHT } from '../amiga/intuition'
import { parseAmosFile } from '../loader/amosfile'
import { haveCorpus } from '../cli/corpus'
import { firstCodeHunk } from '../tokens/libtok'
import { join } from 'node:path'
import { AmigaFS } from '../amiga/vfs'
import { BankImage, ObjectBank } from './objects'
import { encodeIlbm } from '../amiga/ilbm'
import { describeIf, describeWith } from '../testing/fixture'

const table = new TokenTable(CORE_TOKENS)
/** slot 24, which all three releases recommend and none of them can share */
const RELEASE_IDS = { '2.10': 'gui-2.10', '1.6x': 'gui-1.61', '1.5b': 'gui-1.5b' } as const
type Release = keyof typeof RELEASE_IDS

/**
 * A harness bound to one release.
 *
 * The binding is what `guiRelease` reads, so this is the only way to reach
 * the branches that differ; the token TABLE has to come from the same place,
 * or a listing would tokenise against one release's ids and run against
 * another's behaviour.
 */
function on(release: Release) {
  const ext = extensionById(RELEASE_IDS[release])!
  const exts = new Map([[24, ext.table]])
  const runOut = (src: string, bank?: Uint8Array, prep?: (rt: Runtime) => void): { rt: Runtime; out: string } => {
    let out = ''
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[24, ext]]),
      maxSteps: 2_000_000,
      onText: (t) => (out += t),
    })
    if (bank !== undefined) {
      rt.memBanks.set(20, { kind: 'memory', number: 20, memType: 1, name: 'Gui', flags: 0, data: bank })
    }
    prep?.(rt)
    mustFinish(rt.runHeadless(500))
    return { rt, out }
  }
  return {
    ext,
    exts,
    runOut,
    run: (src: string, bank?: Uint8Array): Runtime => runOut(src, bank).rt,
    val: (expr: string, bank?: Uint8Array): number => Number(runOut(`Print ${expr}`, bank).out.trim()),
  }
}

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
function runOut(src: string, bank?: Uint8Array, prep?: (rt: Runtime) => void): { rt: Runtime; out: string } {
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
  prep?.(rt)
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

  /**
   * "screen borders and titles will be left intact, unlike Gui Cls", and the
   * mechanism is that this is a RectFill of the interior where `Gui Cls` is a
   * SetRast of the whole bitmap. The box is the Window's own four border
   * bytes, so (5,5) is inside the title bar and keeps what `Gui Cls` put
   * there.
   */
  it('Gui Clw fills the interior and leaves the borders alone', () => {
    const rt = drawn('Gui Cls 3 : Gui Clw 1,7')
    expect(rp(rt).point(5, 5)).toBe(3)
    expect(rp(rt).point(20, 20)).toBe(7)
  })

  /** `cmpi.l #$80000000,d1 / beq` skips the SetAPen: the ink stands */
  it('and with no colour it fills with the ink', () => {
    const rt = drawn('Gui Cls 3 : Gui Ink 5 : Gui Clw 1')
    expect(rp(rt).point(20, 20)).toBe(5)
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

  /** DrawEllipse with what it was given: no clamp, no range check */
  it('Gui Ellipse draws, and a zero radius is the degenerate point', () => {
    const rt = drawn('Gui Ink 2 : Gui Ellipse 40,18,20,10')
    expect(rp(rt).point(60, 18)).toBe(2)
    const flat = drawn('Gui Ink 2 : Gui Ellipse 40,18,0,10')
    expect(rp(flat).point(40, 18)).toBe(2)
  })

  /**
   * PrintIText places the text by its TOP and adds the font's baseline; the
   * RastPort here is given the baseline, so the conversion belongs on this
   * side of the call. An empty string returns before the Gfx output is even
   * checked, `tst.w d2 / beq` at $25b4.
   */
  it('Gui Text draws below the y it is given, and an empty string draws nothing', () => {
    const rt = drawn('Gui Pen 5 : Gui Text 4,10,"H"')
    const port = rp(rt)
    let below = 0
    for (let y = 10; y < 20; y++) for (let x = 4; x < 12; x++) if (port.point(x, y) === 5) below++
    expect(below).toBeGreaterThan(0)
    for (let y = 0; y < 10; y++) for (let x = 4; x < 12; x++) expect(port.point(x, y)).not.toBe(5)
    expect(() => drawn('Gui Text 0,0,""')).not.toThrow()
  })

  /**
   * `moveq #$1,d2` before Flood is OUTLINE mode, and nothing in the extension
   * sets AOlPen. So the boundary is colour 0 whatever the program drew its
   * outline in, and a window cleared to 0 cannot be filled at all: the seed
   * is already on the stopping colour. The one shape that works is an outline
   * drawn in 0 on a non-zero ground, which is `Jd Intfill`'s case too.
   */
  it('Gui Paint spreads until it meets colour 0, the AOlPen nothing sets', () => {
    // a pen-1 outline does not bound it: the fill runs straight over
    const over = drawn('Gui Ink 1 : Gui Box 2,2 To 20,20 : Gui Ink 5 : Gui Paint 10,10')
    expect(rp(over).point(10, 10)).toBe(0)

    const ground = drawn('Gui Cls 3 : Gui Ink 0 : Gui Box 2,2 To 20,20 : Gui Ink 5 : Gui Paint 10,10')
    expect(rp(ground).point(10, 10)).toBe(5)
    expect(rp(ground).point(2, 10)).toBe(0) // the pen-0 outline is the boundary
    expect(rp(ground).point(30, 30)).toBe(3) // and nothing escaped it
  })

  /** WritePixel does not move rp_cp, so a plot does not move the line cursor */
  it('Gui Plot leaves the graphics cursor where the last line left it', () => {
    const rt = drawn('Gui Ink 4 : Gui Draw 4,4 To 8,4 : Gui Plot 40,20 : Gui Draw To 12,4')
    // the second line runs on from (8,4), not from the plot
    expect(rp(rt).point(10, 4)).toBe(4)
    expect(rp(rt).point(40, 20)).toBe(4)
    expect(rp(rt).point(24, 12)).toBe(0)
  })

  /**
   * Both endpoints go through the clamp at $2036 --- to the OUTPUT's width
   * and height, inclusive, and to zero --- so a line that runs off the window
   * is MOVED rather than clipped and comes out with a different slope.
   */
  it('Gui Draw clamps its endpoints to the output instead of clipping them', () => {
    const w = 48
    const rt = drawn(`Gui Ink 7 : Gui Draw 0,0 To ${w * 4},8`)
    const port = rp(rt)
    // clamped: the far end is at x = width, so the line reaches y 8 there
    expect(port.point(port.width - 1, 8)).toBe(7)
    // clipped it would still be climbing at the right edge, nowhere near 8
    expect(port.point(port.width - 1, 2)).toBe(0)
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
    // gadget 0 is the bank's TEXT, which has one attribute; 1 to 3 are IMAGEs
    const out = runOut(`${open} : Gui Set 1,0,0,42 : Print Gui Read(1,0) : Print Gui Read(1,0)`, bank).out
    expect(out.trim().split('\n').map(Number)).toEqual([42, 42])
  })

  /**
   * The tag table at `$3b8` gives each KIND its attribute count, and
   * `cmp.l d0,d3 / bge` at $60be refuses anything at or above it. A BUTTON
   * and an IMAGE have none at all, so every attribute of one is error 9 --
   * which is stricter than the guide's grid reads, and is the grid's empty
   * rows stated as a rule.
   */
  it('refuses an attribute the gadget s kind does not have', () => {
    // gadget 1 is an IMAGE: zero attributes, so even 0 raises
    expect(() => run(`${open} : Gui Set 1,1,0,5`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_GADGET_VALUE])
    // gadget 0 is a TEXT: one attribute, so 0 is fine and 1 is not
    expect(() => run(`${open} : Gui Set 1,0,0,5`, bank)).not.toThrow()
    expect(() => run(`${open} : Gui Set 1,0,1,5`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_GADGET_VALUE])
  })

  /**
   * `tst.l d1 / bge` at $6066 and three `cmpi.w` after it: a negative value
   * is legal only for INTEGER, SLIDER and NUMBER. 1.61's history dates the
   * check --- "Fixed bug: You can now set/range an integer gadget to a
   * negative value" --- and a TEXT gadget is not one of the three.
   */
  it('refuses a negative value for a kind whose tag is not signed', () => {
    expect(() => run(`${open} : Gui Set 1,0,0,-1`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_GADGET_VALUE])
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
 *
 * It is a 1.6x bank. The version word at +48 is 22, so it runs on the 1.6x
 * binding; under 2.10 the header is eighteen bytes longer and the window box
 * lands on the wrong words, which is what the release parameter is for.
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
  const { run } = on('1.6x')
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
   * The guide's whole account of event -2: "A menu item has been selected.
   * You've to use the Gui Menu function to know which item has been chosen."
   */
  it('Gui Wait reports -2 and Gui Menu says which item', () => {
    const rt = run(open, bank)
    rt.gui.postMenu(1, USE)
    expect(rt.gui.nextEvent()).toBe(GUI_EVENT.MENU)
    expect([rt.gui.menuField(1), rt.gui.menuField(2), rt.gui.menuField(3)]).toEqual([1, 1, 32])
  })

  /**
   * `Gui Menu(n)` through the keyword rather than off the state: routine 14
   * is `move.l (a3)+,d0` and one call, and the argument selects the field.
   * Four is not a field --- `cmp.w #$4,d0 / beq` is tested first --- and
   * answers whether another pick is queued behind this one.
   */
  it('Gui Menu answers the three fields and then whether more follow', () => {
    const got = runOut('A=Gui Wait : Print Gui Menu(1);Gui Menu(2);Gui Menu(3);Gui Menu(4)', bank, (rt) => {
      rt.gui.designs = readGuiBank(bank, '1.6x')
      rt.gui.open(1, 0)
      rt.gui.postMenu(1, USE)
    })
    expect(got.out.trim().split(/\s+/).map(Number)).toEqual([1, 1, 32, 0])
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
 * The four menu keywords 2.10 added, which 1.61 has no name for.
 *
 * No 2.10 bank in the corpus carries a menu, and DataBench's does. A DESIGN
 * is release-independent once it has been read, the menu section's layout
 * did not change and the release only decides where the header ends, so
 * the bank is read as the 1.6x bank it is and the window is opened from the
 * result directly. `Gui Open` is the one step that would not do here, because
 * it is where the version word at +48 is tested and 22 is not 40.
 */
describeWith('the four menu keywords 2.10 added', dbenchBank(), (bank) => {
  const open = (rt: Runtime): void => {
    rt.gui.designs = readGuiBank(bank, '1.6x')
    rt.gui.open(1, 0)
  }
  const withMenus = (src: string): Runtime => {
    const { rt } = on('2.10').runOut(src, undefined, open)
    return rt
  }
  /**
   * A zero argument means the field is absent, so item 0 names the whole
   * menu. That is `OffMenu` with NOITEM, and intuition takes the column with
   * the title.
   */
  it('Gui Menu Off takes a whole menu, and Gui Menu On gives it back', () => {
    const rt = withMenus(`Gui Menu Off 1,2,0,0`)
    const strip = rt.gui.windows.get(1)!.strip!
    expect(strip.menus[1]!.disabled).toBe(true)
    expect(strip.menus[0]!.disabled).toBe(false)
    const back = withMenus(`Gui Menu Off 1,2,0,0 : Gui Menu On 1,2,0,0`)
    expect(back.gui.windows.get(1)!.strip!.menus[1]!.disabled).toBe(false)
  })

  it('names one item when the third argument is given', () => {
    const rt = withMenus(`Gui Menu Off 1,1,2,0`)
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
    const rt = withMenus(`Gui Menu Check 1,1,1,0`)
    const item = rt.gui.windows.get(1)!.strip!.menus[0]!.items[0]!
    expect(item.checked).toBe(true)
    expect(item.flags & MENU_FLAG.CHECKED).toBe(MENU_FLAG.CHECKED)

    const rt2 = withMenus(`Gui Menu Check 1,1,1,0 : Gui Menu Uncheck 1,1,1,0`)
    const item2 = rt2.gui.windows.get(1)!.strip!.menus[0]!.items[0]!
    expect(item2.checked).toBe(false)
    expect(item2.flags & 0xff00).toBe(0)
  })

  it('does nothing at all for a window that is not open', () => {
    expect(() => withMenus(`Gui Menu Check 9,1,1,0`)).not.toThrow()
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
    // `$29c` and `$29e`, four instructions each and no test at all, so the two
    // are read through the keywords rather than off the state
    const got = runOut('A=Gui Wait : Print Gui Mouse Ex;Gui Mouse Ey', bank, (rt) => {
      rt.gui.designs = readGuiBank(bank)
      rt.gui.open(1, 0)
      guiPost(rt, 1, GUI_EVENT.MOUSECLICK, 0, '', [77, 88])
    })
    expect(got.out.trim().split(/\s+/).map(Number)).toEqual([77, 88])

    // an event with no position leaves the last one standing: nothing clears
    // the two words
    const rt = run(open, bank)
    guiPost(rt, 1, GUI_EVENT.MOUSECLICK, 0, '', [77, 88])
    expect(rt.gui.nextEvent()).toBe(GUI_EVENT.MOUSECLICK)
    guiPost(rt, 1, GUI_EVENT.CLOSE)
    expect(rt.gui.nextEvent()).toBe(GUI_EVENT.CLOSE)
    expect([rt.gui.eventX, rt.gui.eventY]).toEqual([77, 88])
  })

  /**
   * `Gui Code$` clears itself, which the guide says of `Gui Code` and not of
   * this one: routine 3 tests bit 1 of `$84` and `bclr`s it before it converts
   * `$e0`, which is routine 2's shape with bit 0.
   */
  it('Gui Code$ answers once and the null string after', () => {
    const got = runOut('A=Gui Wait : Print "[";Gui Code$;"][";Gui Code$;"]"', bank, (rt) => {
      rt.gui.designs = readGuiBank(bank)
      rt.gui.open(1, 0)
      guiPost(rt, 1, 0, 0, 'typed')
    })
    expect(got.out.trim()).toBe('[typed][]')
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

/**
 * The zone group: five keywords over a block of rectangles that belongs to a
 * window NUMBER rather than to a window, and outlives it.
 */
/**
 * The requester group needs AMOS's own dialog engine and its default resource
 * bank, because that is what stands in for asl.library here.
 */
const DEFAULT_ABK = join(__dirname, '..', '..', 'fixtures', 'official-amos', 'APSystem', 'AMOSPro_Default_Resource.Abk')

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string): Boot {
  let printed = ''
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  fs.currentDir = 'RAM:'
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[24, gui]]),
    maxSteps: 300_000,
    fs,
    onText: (t) => (printed += t),
  })
  rt.loadSystemResource(readFileSync(DEFAULT_ABK))
  return { rt, out: () => printed }
}

/** one frame, so the block is standing and a test can answer it itself */
function park(b: Boot): void {
  b.rt.frame()
}

describeIf('the requester group', existsSync(DEFAULT_ABK), () => {
  /** intuition numbers the rightmost gadget 0, which is also how a drain reads */
  it('Gui Req answers 0 with nobody there to click', () => {
    const b = boot('A=Gui Req("Title","Quit?","Yes|No") : Print A')
    mustFinish(b.rt.runHeadless(2_000))
    expect(Number(b.out().trim())).toBe(0)
  })

  it('and answers the gadget that was pressed, counting from 1 on the left', () => {
    const b = boot('A=Gui Req("Title","Quit?","One|Two|Three") : Print A')
    park(b)
    const chan = b.rt.gui.req
    expect(chan).not.toBeNull()
    b.rt.finishDialogRun(b.rt.dialogs.get(chan!)!, 2)
    mustFinish(b.rt.runHeadless(2_000))
    expect(Number(b.out().trim())).toBe(2)
  })

  /** "you must manually place the Chr$(10) character at the places you wish" */
  it('the message splits on Chr$(10) and the gadgets on the bar', () => {
    const b = boot('A=Gui Req("T","Line one"+Chr$(10)+"Line two","One|Two")')
    park(b)
    const d = b.rt.dialogs.get(b.rt.gui.req!)!
    expect([d.vars[0], d.vars[1]]).toEqual(['Line one', 'Line two'])
    expect([d.vars[10], d.vars[11]]).toEqual(['One', 'Two'])
  })

  it('Gui Asl$ joins the drawer and the file, and splits them for the readers', () => {
    const b = boot('A$=Gui Asl$("Pick","RAM:","x.txt","#?") : Print "["+A$+"]["+Gui File$+"]["+Gui Dir$+"]"')
    park(b)
    expect(b.rt.fsel).not.toBeNull()
    b.rt.finishFselNow('RAM:Work/thing.txt')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('[RAM:Work/thing.txt][thing.txt][RAM:Work]')
  })

  /** a volume keeps its colon and takes no slash, which is the $762e test */
  it('a file in the root of a volume gets no separator of its own', () => {
    const b = boot('A$=Gui Asl$("Pick","","","") : Print "["+A$+"]["+Gui Dir$+"]"')
    park(b)
    b.rt.finishFselNow('RAM:thing.txt')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('[RAM:thing.txt][RAM:]')
  })

  /** "If CANCEL was hit, the string will remain empty", and so do both halves */
  it('a cancel empties the two readers as well', () => {
    const b = boot('A$=Gui Asl$("Pick","RAM:","keep.txt","") : Print "["+A$+"]["+Gui File$+"]["+Gui Dir$+"]"')
    park(b)
    b.rt.finishFselNow('')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('[][][]')
  })

  /** they read `$158` and `$15c` and test nothing else, so this is legal */
  it('Gui File$ and Gui Dir$ answer before anything has been requested', () => {
    const b = boot('Print "["+Gui File$+"]["+Gui Dir$+"]"')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('[][]')
  })
})

describe('the ASL screen and font group', () => {
  /** "If the value returned is -1 then the user hit Cancel on the requester" */
  it('Gui Asl Screen answers cancel, and the readers answer zeros', () => {
    const out = runOut('Print Gui Asl Screen : Print Gui Asl Id : Print Gui Asl Width : Print Gui Asl Height : Print Gui Asl Depth').out
    expect(out.trim().split(/\s+/).map(Number)).toEqual([-1, 0, 0, 0, 0])
  })

  /**
   * The `dbra` reads a word, so a depth of 0 counts from -1 and turns 65,536
   * times. That is a multiple of 32, and a longword rotate comes back to 1.
   */
  it('Gui Asl Colours rotates, so depth 0 answers 1 and depth 33 answers 2', () => {
    const colours = (depth: number): number =>
      Number(runOut('Print Gui Asl Colours', undefined, (rt) => (rt.gui.aslScreen.depth = depth)).out)
    expect([1, 2, 4, 8].map(colours)).toEqual([2, 4, 16, 256])
    expect(colours(0)).toBe(1)
    expect(colours(33)).toBe(2)
  })

  it('Gui Asl Font answers cancel, and Gui Font Size 0 beside it', () => {
    expect(runOut('Print "["+Gui Asl Font+"]" : Print Gui Font Size').out.trim()).toBe('[]\n 0')
  })

  /** routine 124 takes width, height, DisplayID and the colour count from `$150` */
  it('Gui Asl Open opens a screen from what the requester was left holding', () => {
    const rt = runOut('Gui Asl Open 3,"Picked"', undefined, (r) =>
      Object.assign(r.gui.aslScreen, { displayID: 0x29000, width: 800, height: 600, depth: 3 }),
    ).rt
    const sc = rt.gui.screens.get(3)!
    expect([sc.width, sc.height, sc.depth, sc.modeID, sc.name]).toEqual([800, 600, 3, 0x29000, 'Picked'])
    expect(rt.gui.current).toBe(sc)
  })

  it('and takes a font name and size in its second form', () => {
    const rt = run('Gui Asl Open 3,"Picked","topaz.font",11')
    const sc = rt.gui.screens.get(3)!
    expect([sc.fontName, sc.fontSize]).toEqual(['topaz.font', 11])
  })

  /**
   * DEFECT: routine 232 restores d7 from the stack at $5198, and this keyword
   * loads none of its own, so the number that reaches the error call is
   * whatever the last failure left. 14 is what `Gui Screen Open` leaves.
   */
  it('Gui Asl Open raises Illegal screen parameter for a number it cannot use', () => {
    expect(() => run('Gui Asl Open 0,"x"')).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_SCREEN_PARAMETER])
    expect(() => run('Gui Asl Open 3,"x" : Gui Asl Open 3,"y"')).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_SCREEN_PARAMETER])
  })
})

describeWith('the lock and remember flags', exampleBank(), (bank) => {
  const open = 'Gui Open 1,1'

  /**
   * `Gui Off` and `Gui On` are one window each, where `Gui Lock` and
   * `Gui Unlock` walk the whole list. A locked window's events are dropped by
   * the pump rather than held.
   */
  it('Gui Off locks one window and Gui On gives it back', () => {
    expect(run(`${open} : Gui Off 1`, bank).gui.windows.get(1)!.locked).toBe(true)
    expect(run(`${open} : Gui Off 1 : Gui On 1`, bank).gui.windows.get(1)!.locked).toBe(false)
  })

  /** bit 2 of `$85`, `bset` at $2572 and `bclr` at $257e */
  it('Gui Remember On and Off are one bit', () => {
    expect(run('Gui Remember On', bank).gui.remember).toBe(true)
    expect(run('Gui Remember On : Gui Remember Off', bank).gui.remember).toBe(false)
  })

  /** `$102`, four instructions: what the last mouse or drag event named */
  it('Gui Gadget reads the word the pump wrote', () => {
    expect(Number(runOut(`${open} : Print Gui Gadget`, bank).out.trim())).toBe(0)
    const got = runOut(`${open} : Print Gui Gadget`, bank, (rt) => {
      rt.gui.activeGadget = 5
    })
    expect(Number(got.out.trim())).toBe(5)
  })
})

describeWith('the colour group', exampleBank(), (bank) => {
  const open = 'Gui Open 1,1'

  /** $5586: the first window locks the default public screen into `$1d2` */
  it('opening a window is what makes a screen current', () => {
    expect(run('Rem').gui.current).toBe(null)
    const rt = run(open, bank)
    expect(rt.gui.current).toBe(rt.gui.workbench)
  })

  /**
   * The four Preferences colours, expanded from twelve bits to twenty-four by
   * replicating each nibble -- $0fff is white at both widths.
   */
  it('a screen opens with intuition s four colours', () => {
    const out = runOut(`${open} : Print Gui Colour(1) : Print Gui Colour(3)`, bank).out.trim().split(/\s+/).map(Number)
    expect(out).toEqual([0xffffff, 0xff8800])
  })

  it('Gui Rgb takes four arguments, and Gui Colour reads them back', () => {
    const rt = run(`${open} : Gui Rgb 2,255,128,0`, bank)
    expect(rt.gui.current!.palette[2]).toBe(0xff8000)
    expect(Number(runOut(`${open} : Gui Rgb 2,255,128,0 : Print Gui Colour(2)`, bank).out)).toBe(0xff8000)
  })

  /** routine 142, the other half of the `!` entry: one packed $RRGGBB */
  it('Gui Rgb also takes two, packed', () => {
    const rt = run(`${open} : Gui Rgb 2,$FF8000`, bank)
    expect(rt.gui.current!.palette[2]).toBe(0xff8000)
  })

  /**
   * $302c and $304e clamp the four-argument form's index, and routine 142
   * clamps nothing at all. Neither writes past the end of a two-plane map.
   */
  it('only the four-argument form clamps its index', () => {
    const rt = run(`${open} : Gui Rgb -1,255,255,255`, bank)
    // the negative became 0 at $300c, so entry 0 took it
    expect(rt.gui.current!.palette[0]).toBe(0xffffff)

    const two = run(`${open} : Gui Rgb -1,$FFFFFF`, bank)
    expect(two.gui.current!.palette[0]).toBe(expand12(0x005a))
  })

  it('the three component functions are arithmetic, not a screen read', () => {
    const out = runOut('Print Gui Red($FF8040) : Print Gui Green($FF8040) : Print Gui Blue($FF8040)').out
    expect(out.trim().split(/\s+/).map(Number)).toEqual([255, 128, 64])
  })

  /** "So if you need the red...  C=Gui Best(255,0,0) : Gui Ink C" */
  it('Gui Best answers the nearest pen already in the map', () => {
    // colour 3 is $ff8800, which is nearer red than white, blue or near-black
    const best = (r: number, g: number, b: number): number =>
      Number(runOut(`${open} : Print Gui Best(${r},${g},${b})`, bank).out)
    expect(best(255, 0, 0)).toBe(3)
    expect(best(255, 255, 255)).toBe(1)
    expect(best(0, 0, 0)).toBe(2)
  })

  /** it takes an exact entry over a near one, which is the whole point */
  it('Gui Best finds a colour Gui Rgb put there', () => {
    expect(Number(runOut(`${open} : Gui Rgb 2,0,255,0 : Print Gui Best(0,255,0)`, bank).out)).toBe(2)
  })
})

describeWith('the iconify group', exampleBank(), (bank) => {
  const open = 'Gui Open 1,1'

  /**
   * "The number of the window just closed will be used as AppIcon number. So
   * if you iconify the Window number 5, the AppIcon number 5 will be
   * created." Routine 260 reads it out of `$c(a0)` over the `moveq #$0,d0`
   * routine 53 arrived with.
   */
  it('Gui Iconify closes the window and names the AppIcon after it', () => {
    const rt = run(`Gui Open 5,1 : W=Gui Iconify(5,"HELLO","")`, bank)
    expect(rt.gui.windows.has(5)).toBe(false)
    const apps = [...rt.gui.apps.values()]
    expect(apps.length).toBe(1)
    expect([apps[0]!.id, apps[0]!.name, apps[0]!.icon]).toEqual([5, 'HELLO', ''])
    expect(apps[0]!.window).toEqual({ number: 5, gui: 0, topaz: false })
  })

  /** the handle is what `Gui Uniconify` takes, and it is not the window number */
  it('Gui Iconify returns a handle, and Gui Uniconify opens the same window again', () => {
    const rt = run(`Gui Open 5,1 : W=Gui Iconify(5,"HELLO","") : Gui Uniconify W`, bank)
    expect(rt.gui.windows.has(5)).toBe(true)
    expect(rt.gui.windows.get(5)!.gui).toBe(0)
    // routine 261 frees the node once the window is back
    expect(rt.gui.apps.size).toBe(0)
  })

  /** `move.w #$1,$60(a0)` at $23e0, with the old mode parked in the node */
  it('Gui Uniconify forces the iconify gadget on and puts the mode back', () => {
    const rt = run(`Gui Set Mode 0 : Gui Open 5,1 : W=Gui Iconify(5,"a","") : Gui Uniconify W`, bank)
    expect(rt.gui.iconifyGadget).toBe(0)
  })

  /**
   * `$42` of the record into `$48` at $2370, back out at $23a2, and the
   * global sensitive bit cleared for the re-open so the window is rebuilt in
   * topaz/8 the way it was.
   */
  it('a window laid out in topaz comes back in topaz', () => {
    const rt = run(`Gui Sensitive Off : Gui Open 5,1 : Gui Sensitive On : W=Gui Iconify(5,"a","") : Gui Uniconify W`, bank)
    expect(rt.gui.windows.get(5)!.topaz).toBe(true)
    // and the flag itself is put back, which is the restore at $23fc
    expect(rt.gui.sensitive).toBe(true)
  })

  /** the guide's guru, reached from the side the binary actually tests for */
  it('uniconifying one handle twice raises Window not open', () => {
    const src = `Gui Open 5,1 : W=Gui Iconify(5,"a","") : Gui Uniconify W : Gui Uniconify W`
    expect(() => run(src, bank)).toThrow(GUI_ERRORS[GUI_ERR.WINDOW_NOT_OPEN])
    expect(() => run('Gui Uniconify 99', bank)).toThrow(GUI_ERRORS[GUI_ERR.WINDOW_NOT_OPEN])
  })

  it('Gui Iconify raises Window not open for a window that is not', () => {
    expect(() => run('W=Gui Iconify(9,"a","")', bank)).toThrow(GUI_ERRORS[GUI_ERR.WINDOW_NOT_OPEN])
  })

  /** "There is not limit to the number of appicons that you can create!" */
  it('Gui App Icon puts one up without a window behind it', () => {
    const rt = run('Gui App Icon 1,"AMOS","AMOSPro_System:AMOSPro" : Gui App Icon 2,"Two",""')
    const apps = [...rt.gui.apps.values()]
    expect(apps.map((a) => a.id)).toEqual([1, 2])
    expect(apps[0]!.icon).toBe('AMOSPro_System:AMOSPro')
    expect(apps[0]!.window).toBe(null)
  })

  /** `move.w d0,$8(a4)` at $76ea and `cmp.w $8(a1),d0` at $3cac, both words */
  it('the AppIcon number is a word at both ends', () => {
    const rt = run('Gui App Icon 65537,"a","" : Gui App Remove 1')
    expect(rt.gui.apps.size).toBe(0)
  })

  it('Gui App Remove takes the first match and ignores a number it cannot find', () => {
    const rt = run('Gui App Icon 1,"one","" : Gui App Icon 1,"two","" : Gui App Remove 1 : Gui App Remove 7')
    expect([...rt.gui.apps.values()].map((a) => a.name)).toEqual(['two'])
  })

  /** am_Type minus 7 off `moveq #$f1,d4`: APPICON is 8, so -16 */
  it('an AppIcon message answers -16, its number and its drop count', () => {
    const rt = run('Rem')
    guiPostAppIcon(rt, 3, ['Work:foo', 'Work:bar'], [10, 20])
    expect(rt.gui.nextEvent()).toBe(GUI_EVENT.APPICON)
    expect(rt.gui.readCode()).toBe(2)
    expect(rt.gui.appId).toBe(3)
    expect(rt.gui.nextAppName()).toBe('Work:foo')
    expect(rt.gui.nextAppName()).toBe('Work:bar')
    // "If the user has just double-clicked your AppIcon, Gui Code returns 0"
    expect(rt.gui.nextAppName()).toBe('')
  })

  /** `ext.l d0` at $7212 on the word the node kept */
  it('Gui App Id sign-extends the number', () => {
    const rt = run('Rem')
    guiPostAppIcon(rt, -1, [])
    expect(rt.gui.nextEvent()).toBe(GUI_EVENT.APPICON)
    expect(rt.gui.appId).toBe(-1)
    expect(rt.gui.readCode()).toBe(0)
  })

  /** the pump writes `$de` only where it has a window, and $7202 does not */
  it('an AppIcon message leaves Gui Window and Gui Selected alone', () => {
    const rt = run(open, bank)
    guiPost(rt, 1, GUI_EVENT.MOUSECLICK)
    expect(rt.gui.nextEvent()).toBe(GUI_EVENT.MOUSECLICK)
    guiPostAppIcon(rt, 9, [])
    expect(rt.gui.nextEvent()).toBe(GUI_EVENT.APPICON)
    expect(rt.gui.eventWindow()).toBe(1)
    expect(rt.gui.selected).toBe(1)
  })

  /** and the position does travel, out of am_MouseX and am_MouseY at $71ec */
  it('an AppIcon message carries the pointer position', () => {
    const rt = run('Rem')
    guiPostAppIcon(rt, 1, [], [33, 44])
    expect(rt.gui.nextEvent()).toBe(GUI_EVENT.APPICON)
    expect([rt.gui.eventX, rt.gui.eventY]).toEqual([33, 44])
  })
})

describeWith('the zone group', exampleBank(), (bank) => {
  const open = 'Gui Open 1,1'

  it('reserves a block and sets a rectangle in it', () => {
    const rt = run(`${open} : Gui Reserve Zone 1,4 : Gui Set Zone 1,2,10,20 To 30,40`, bank)
    const list = rt.gui.zones.get(1)!
    expect(list).toHaveLength(4)
    expect(list[2]).toEqual({ x1: 10, y1: 20, x2: 30, y2: 40 })
  })

  /**
   * The count is checked before the window: $407c and $4082 both raise before
   * routine 244 runs, so a bad count on a closed window complains about the
   * count.
   */
  it('checks the count first, and stops at five thousand', () => {
    expect(() => run(`${open} : Gui Reserve Zone 1,0`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_NUMBER_OF_ZONES])
    expect(() => run(`${open} : Gui Reserve Zone 1,5001`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_NUMBER_OF_ZONES])
    expect(() => run(`${open} : Gui Reserve Zone 1,5000`, bank)).not.toThrow()
    // the count wins over the window, which is not the usual order
    expect(() => run(`Gui Reserve Zone 9,0`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_NUMBER_OF_ZONES])
    expect(() => run(`Gui Reserve Zone 9,4`, bank)).toThrow(GUI_ERRORS[GUI_ERR.WINDOW_NOT_OPEN])
  })

  /** three different ways to be "Zone not reserved", all error 32 */
  it('refuses a zone number that is negative, past the end, or unreserved', () => {
    expect(() => run(`${open} : Gui Reserve Zone 1,4 : Gui Set Zone 1,-1,0,0 To 1,1`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ZONE_NOT_RESERVED])
    expect(() => run(`${open} : Gui Reserve Zone 1,4 : Gui Set Zone 1,4,0,0 To 1,1`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ZONE_NOT_RESERVED])
    expect(() => run(`${open} : Gui Set Zone 1,0,0,0 To 1,1`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ZONE_NOT_RESERVED])
    // and the last legal one is count - 1
    expect(() => run(`${open} : Gui Reserve Zone 1,4 : Gui Set Zone 1,3,0,0 To 1,1`, bank)).not.toThrow()
  })

  /**
   * `cmp.w d2,d4 / Rble` at $4138: x1 must be STRICTLY greater than x. So one
   * pixel is legal and zero is "Illegal function call". AMOS's own Set Zone
   * checks neither end.
   */
  it('wants a rectangle with real width and height', () => {
    const setup = `${open} : Gui Reserve Zone 1,2`
    expect(() => run(`${setup} : Gui Set Zone 1,0,10,10 To 11,11`, bank)).not.toThrow()
    expect(() => run(`${setup} : Gui Set Zone 1,0,10,10 To 10,11`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_FUNCTION_CALL])
    expect(() => run(`${setup} : Gui Set Zone 1,0,10,10 To 11,10`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_FUNCTION_CALL])
    expect(() => run(`${setup} : Gui Set Zone 1,0,10,10 To 5,5`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_FUNCTION_CALL])
  })

  /** first match wins, both edges are inclusive, and -1 for a miss */
  it('Gui Mouse Zone finds the first zone containing the point, edges included', () => {
    const setup = `${open} : Gui Reserve Zone 1,3 : Gui Set Zone 1,0,0,0 To 20,20 : Gui Set Zone 1,1,10,10 To 30,30 : Gui Set Zone 1,2,50,50 To 60,60`
    const got = runOut(
      `${setup} : Print Gui Mouse Zone(1,5,5) : Print Gui Mouse Zone(1,15,15) : Print Gui Mouse Zone(1,20,20) : Print Gui Mouse Zone(1,55,55) : Print Gui Mouse Zone(1,100,100)`,
      bank,
    ).out
    // 15,15 is in both 0 and 1; the walk stops at 0
    expect(got.trim().split('\n').map(Number)).toEqual([0, 0, 0, 2, -1])
  })

  /**
   * The block is AllocVec'd MEMF_CLEAR, so a reserved-but-unset zone is the
   * rectangle 0,0 to 0,0 and the hit test finds it at the origin. Not a
   * special case; a zero rectangle is what that means to it.
   */
  it('a reserved but never set zone still contains the origin', () => {
    const got = runOut(`${open} : Gui Reserve Zone 1,2 : Print Gui Mouse Zone(1,0,0) : Print Gui Mouse Zone(1,1,1)`, bank).out
    expect(got.trim().split('\n').map(Number)).toEqual([0, -1])
  })

  it('Gui Mouse Zone on a window with no block raises rather than answering -1', () => {
    expect(() => run(`${open} : Print Gui Mouse Zone(1,0,0)`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ZONE_NOT_RESERVED])
  })

  /**
   * "When you close a window the zones ARE NOT erased! When you reopen the
   * window the zones are already there so you don't need to redifine them!"
   * -- which is why `Gui Free Zone` exists at all.
   */
  it('zones outlive the window and only Gui Free Zone erases them', () => {
    const kept = run(`${open} : Gui Reserve Zone 1,2 : Gui Set Zone 1,0,5,5 To 15,15 : A=Gui Close(1) : ${open}`, bank)
    expect(kept.gui.zones.get(1)![0]).toEqual({ x1: 5, y1: 5, x2: 15, y2: 15 })

    const freed = run(`${open} : Gui Reserve Zone 1,2 : Gui Free Zone 1`, bank)
    expect(freed.gui.zones.has(1)).toBe(false)
    // freeing a window that reserved nothing is not an error
    expect(() => run(`${open} : Gui Free Zone 1`, bank)).not.toThrow()
  })

  it('Gui Zone reads its own word, separate from Gui Gadget s', () => {
    const rt = run(open, bank)
    expect(rt.gui.activeZone).toBe(0)
    rt.gui.activeZone = 3
    rt.gui.activeGadget = 7
    expect(runOut(`${open} : Print Gui Zone`, bank).out.trim()).toBe('0')
  })
})

/**
 * The array group, and the listview it exists for.
 *
 * A listview shows only the non-empty elements of the array a program hands
 * it, so its numbering and the array's diverge at the first blank. Every
 * example here is the guide's own:
 *
 *     A$(0)="Hello" A$(1)="" A$(2)="World!" A$(3)="" A$(4)="Amiga RULEZ!"
 *
 * GuiDemo is the bank with a LISTVIEW in it; BootSelector has none. It is a
 * 1.6x bank and these are 2.10's keywords, so the designs are read as 1.6x
 * and the window opened from them, for the reason the menu block above gives.
 */
const DEMO = '../amos-files/sources/aminet-dev-amos/files/GuiExt162/GuiExtension/Demos/GuiDemo.Amos'

function demoBank(): Uint8Array | null {
  if (!haveCorpus()) return null
  try {
    const file = parseAmosFile(new Uint8Array(readFileSync(DEMO)))
    const b = file?.banks.find((x) => 'data' in x && (x as { number?: number }).number === 20)
    return b && 'data' in b ? (b.data as Uint8Array) : null
  } catch {
    return null
  }
}

describeWith('the array group', demoBank(), (bank) => {
  /** GuiDemo's listview is gadget 0, and it opens as GUI 1 */
  const opened = (rt: Runtime): void => {
    rt.gui.designs = readGuiBank(bank, '1.6x')
    rt.gui.open(1, 0)
  }
  const runOut = (src: string): { rt: Runtime; out: string } => on('2.10').runOut(src, undefined, opened)
  const run = (src: string): Runtime => runOut(src).rt
  const fill = 'Dim A$(4) : A$(0)="Hello" : A$(2)="World!" : A$(4)="Amiga RULEZ!"'
  const attach = `${fill} : Gui Set 1,0,1,Array(A$(0))`

  it('finds the listview in the demo bank', () => {
    const rt = run('Rem')
    expect(rt.gui.windows.get(1)!.design.gadgets[0]!.kind).toBe(4)
  })

  /**
   * A LISTVIEW is one of the three kinds the tag table gives THREE attributes
   * --- GTLV_Selected, GTLV_Labels and GTLV_Top, in that order --- so this is
   * where `Gui Set`'s 0, 1 and 2 are all legal at once. The other two are
   * SCROLLER and SLIDER; every other kind has one or none.
   */
  it('keeps the listview s three attributes apart', () => {
    const rt = run('Gui Set 1,0,0,7 : Gui Set 1,0,1,8 : Gui Set 1,0,2,9')
    expect(rt.gui.attrsOf(rt.gui.windows.get(1)!, 0)).toEqual([7, 8, 9])
    expect(() => run('Gui Set 1,0,3,1')).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_GADGET_VALUE])
  })

  /**
   * The bank carries no items for a listview, so before this commit the only
   * answer was whatever `Gui Set$` had put there. Now the array is the source.
   */
  it('Gui Read$ reads the array, skipping the blanks', () => {
    const got = runOut(
      `${attach} : Print Gui Read$(1,0) : Gui Set 1,0,0,1 : Print Gui Read$(1,0) : Gui Set 1,0,0,2 : Print Gui Read$(1,0)`,
    ).out
    expect(got.trim().split('\n')).toEqual(['Hello', 'World!', 'Amiga RULEZ!'])
  })

  /** "if the user click on 'World!' Gui Read() returns 1. But the array is A$(2)" */
  it('Gui Array Read maps a listview item back to its array element', () => {
    const got = runOut(
      `${attach} : Print Gui Array Read(1,0,0) : Print Gui Array Read(1,0,1) : Print Gui Array Read(1,0,2) : Print Gui Array Read(1,0,3)`,
    ).out
    expect(got.trim().split('\n').map(Number)).toEqual([0, 2, 4, -1])
  })

  it('and answers -1 for a listview that was never given an array', () => {
    expect(runOut(`Print Gui Array Read(1,0,0)`).out.trim()).toBe('-1')
  })

  /**
   * The guide's first worked example, run as it is written:
   *
   *     Gui Array Up Array(A$(0)),0 : Rem the result is......
   *     A$(0)="" A$(1)="World!" A$(2)="" A$(3)="Amiga RULEZ!" A$(4)="Hello"
   */
  it('Gui Array Up rotates, and the guide s own example comes out', () => {
    const got = runOut(
      `${fill} : Gui Array Up Array(A$(0)),0 : For I=0 To 4 : Print "[";A$(I);"]" : Next I`,
    ).out
    expect(got.trim().split('\n')).toEqual(['[]', '[World!]', '[]', '[Amiga RULEZ!]', '[Hello]'])
  })

  /** "if you call it again....." */
  it('and again, which is the line after it', () => {
    const got = runOut(
      `${fill} : Gui Array Up Array(A$(0)),0 : Gui Array Up Array(A$(0)),0 : For I=0 To 4 : Print "[";A$(I);"]" : Next I`,
    ).out
    expect(got.trim().split('\n')).toEqual(['[World!]', '[]', '[Amiga RULEZ!]', '[Hello]', '[]'])
  })

  /**
   * The second example, which is what the keyword is FOR: blank an element,
   * rotate from it, and the hole ends up past the data.
   *
   *     A$(1)="" : Gui Array up Array(A$(0)),1
   *     A$(0)="String1" A$(1)="String3" A$(2)="String4" A$(3)=""
   */
  it('rotates only the tail from the start position', () => {
    const got = runOut(
      `Dim A$(3) : A$(0)="String1" : A$(1)="String2" : A$(2)="String3" : A$(3)="String4" : A$(1)="" : Gui Array Up Array(A$(0)),1 : For I=0 To 3 : Print "[";A$(I);"]" : Next I`,
    ).out
    expect(got.trim().split('\n')).toEqual(['[String1]', '[String3]', '[String4]', '[]'])
  })

  it('Gui Array Down puts it back', () => {
    const got = runOut(
      `${fill} : Gui Array Up Array(A$(0)),0 : Gui Array Down Array(A$(0)),0 : For I=0 To 4 : Print "[";A$(I);"]" : Next I`,
    ).out
    expect(got.trim().split('\n')).toEqual(['[Hello]', '[]', '[World!]', '[]', '[Amiga RULEZ!]'])
  })

  /**
   * Out of bounds is silent both ways: $3340 returns on a negative start and
   * $334c on one past the last index. Neither raises and neither touches the
   * array.
   */
  it('does nothing at all for a start position out of range', () => {
    const same = ['[Hello]', '[]', '[World!]', '[]', '[Amiga RULEZ!]']
    for (const n of [-1, 4, 9]) {
      const got = runOut(`${fill} : Gui Array Up Array(A$(0)),${n} : For I=0 To 4 : Print "[";A$(I);"]" : Next I`).out
      expect(got.trim().split('\n'), `start ${n}`).toEqual(same)
    }
  })

  /** $3126 loads one word and returns; the argument is never read */
  it('Gui Array ignores the argument it is given', () => {
    const got = runOut(`Print Gui Array(0) : Print Gui Array(99)`).out
    expect(got.trim().split('\n').map(Number)).toEqual([0, 0])
  })
})

/**
 * The public screen group.
 *
 * Intuition always keeps the Workbench public, and nothing else here opens a
 * screen, so the list has one name on it. That is also what a real Workbench
 * with nothing else running looks like.
 */
describeWith('the public screen group', exampleBank(), (bank) => {
  it('locks the Workbench by name and refuses anything else', () => {
    const got = runOut('Print Gui Pub Screen("Workbench") : Print Gui Pub Screen("Nonesuch")', bank).out
    const [ok, no] = got.trim().split('\n').map(Number)
    expect(ok).toBeGreaterThan(0)
    expect(no).toBe(0)
  })

  /**
   * "If you try to lock another screen with Gui Pub Screen, the previous
   * screen will be freed automatically" -- $2af6 unlocks before it locks.
   */
  it('frees the previous lock before taking a new one', () => {
    const rt = run('A=Gui Pub Screen("Workbench") : B=Gui Pub Screen("Nonesuch")', bank)
    expect(rt.gui.pubLock).toBe(0)
    expect(rt.gui.pubName).toBe('')
  })

  it('Gui Pub Free lets it go, and does nothing when nothing is held', () => {
    const rt = run('A=Gui Pub Screen("Workbench") : Gui Pub Free', bank)
    expect(rt.gui.pubLock).toBe(0)
    expect(() => run('Gui Pub Free : Gui Pub Free', bank)).not.toThrow()
  })

  /**
   * The guide's own loop, run as it is written. It terminates by itself
   * because the walk answers "" at the tail, and frees the list there.
   */
  it('walks the list the way the guide says to', () => {
    const out = runOut(
      'Dim P$(31) : Gui Pub List : For I=0 To 31 : P$(I)=Gui Pub Name$ : Exit If P$(I)="" : Next : Gui Pub List Free : Print "[";P$(0);"]" : Print "[";P$(1);"]"',
      bank,
    ).out
    expect(out.trim().split('\n')).toEqual(['[Workbench]', '[]'])
  })

  /** $2b44 tests the cursor and returns, so a second Gui Pub List is a no-op */
  it('does not restart the walk if Gui Pub List is called twice', () => {
    const out = runOut('Gui Pub List : A$=Gui Pub Name$ : Gui Pub List : Print "[";Gui Pub Name$;"]"', bank).out
    expect(out.trim()).toBe('[]')
  })

  it('Gui Pub Name$ is empty when no list is held', () => {
    expect(runOut('Print "[";Gui Pub Name$;"]"', bank).out.trim()).toBe('[]')
  })

  /** `moveq #$e,d7 / Rble` at $2bc4, before the call and before anything else */
  it('Gui Pub To Front and To Back refuse a lock of zero or less', () => {
    for (const kw of ['Gui Pub To Front 0', 'Gui Pub To Back 0', 'Gui Pub To Front -1']) {
      expect(() => run(kw, bank), kw).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_SCREEN_PARAMETER])
    }
    expect(() => run('A=Gui Pub Screen("Workbench") : Gui Pub To Front A', bank)).not.toThrow()
  })

  /**
   * These two take one of this extension's OWN screens, by number through
   * routine 259. With `Gui Screen Open` not built there are none, so Gui Pub
   * Mode raises 17 and Gui Pub Check answers 0 -- which is what the binary
   * does for a number that names nothing, since $49ea takes the zero count
   * rather than erroring.
   */
  it('Gui Pub Mode raises with no screens open, and Gui Pub Check answers 0', () => {
    expect(() => run('Gui Pub Mode 1,0', bank)).toThrow(GUI_ERRORS[GUI_ERR.SCREEN_NOT_OPENED])
    expect(runOut('Print Gui Pub Check(1)', bank).out.trim()).toBe('0')
  })
})

/**
 * The screen group. These raise no pixels, for the same reason the windows do
 * not; what is here is the geometry, the mode and the names every other
 * keyword in the group reads back.
 */
describeWith('the screen group', exampleBank(), (bank) => {
  const open = 'Gui Screen Open 1,640,256,16,$8000,"Test"'

  /**
   * The four size functions take NO argument and read the current screen,
   * which their specs say too: a bare `0`.
   */
  it('opens one and answers about it as the current screen', () => {
    const got = runOut(
      `${open} : Print Gui Screen Width : Print Gui Screen Height : Print Gui Screen Depth : Print Gui Screen Colours`,
      bank,
    ).out
    expect(got.trim().split('\n').map(Number)).toEqual([640, 256, 4, 16])
  })

  /**
   * $4fa4 adds PAL_MONITOR_ID to any ModeID below $10000 on Kickstart 39 and
   * up, so graphics.library's bare HIRES_KEY opens a PAL hires screen rather
   * than failing.
   */
  it('turns a bare display key into a PAL mode', () => {
    const rt = run(open, bank)
    expect(rt.gui.screens.get(1)!.modeID).toBe(0x21000 + 0x8000)
    // one that already names a monitor is left alone
    const dblpal = run('Gui Screen Open 1,640,256,4,$A9004,"x"', bank)
    expect(dblpal.gui.screens.get(1)!.modeID).toBe(0xa9004)
  })

  /**
   * The colours become a depth by rotating right until bit 0 comes up set,
   * which is a logarithm only for a power of two. Twelve colours quietly
   * become two planes and four.
   */
  it('turns colours into planes by the rotate, not by a logarithm', () => {
    for (const [colours, depth] of [[2, 1], [16, 4], [256, 8], [12, 2], [0, 2]] as const) {
      const rt = run(`Gui Screen Open 1,320,200,${colours},0,"x"`, bank)
      expect(rt.gui.screens.get(1)!.depth, `${colours} colours`).toBe(depth)
    }
  })

  it('refuses screen number 0, and refuses a number twice', () => {
    expect(() => run('Gui Screen Open 0,320,200,4,0,"x"', bank)).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_SCREEN_PARAMETER])
    // DEFECT: not 15. Routine 232's `movem.l (a7)+,d1-d7` at $5198 puts the
    // caller's d7 back, so the `moveq #$e,d7` at $217c is what reaches the
    // error call however the open failed
    expect(() => run(`${open} : ${open}`, bank)).toThrow(GUI_ERRORS[GUI_ERR.ILLEGAL_SCREEN_PARAMETER])
  })

  it('takes the font form too, which is the second of its two syntaxes', () => {
    const rt = run('Gui Screen Open 1,640,256,4,0,"Test","topaz.font",11', bank)
    const sc = rt.gui.screens.get(1)!
    expect([sc.name, sc.fontName, sc.fontSize]).toEqual(['Test', 'topaz.font', 11])
  })

  /**
   * "The opened screen became the current screen... if you've previously
   * locked a public screen, it will be automatically unlocked", $5150.
   */
  it('opening a screen drops a public screen lock', () => {
    const rt = run(`A=Gui Pub Screen("Workbench") : ${open}`, bank)
    expect(rt.gui.pubLock).toBe(0)
    expect(rt.gui.current!.number).toBe(1)
  })

  /** and a lock makes the Workbench current, because $2b0a writes `$1d2` too */
  it('locking a public screen makes it the current one, and freeing puts it back', () => {
    const locked = runOut(`${open} : A=Gui Pub Screen("Workbench") : Print Gui Screen Width`, bank).out
    expect(Number(locked.trim())).toBe(640)
    const rt = run(`Gui Screen Open 1,320,200,4,0,"x" : A=Gui Pub Screen("Workbench") : Gui Pub Free`, bank)
    expect(rt.gui.current!.number).toBe(1)
    expect(runOut('Gui Screen Open 1,320,200,4,0,"x" : A=Gui Pub Screen("Workbench") : Gui Pub Free : Print Gui Screen Width', bank).out.trim()).toBe('320')
  })

  it('answers Screen not opened with no screen and no lock', () => {
    for (const kw of ['Print Gui Screen Width', 'Print Gui Screen Height', 'Print Gui Screen Depth', 'Print Gui Screen Colours']) {
      expect(() => run(kw, bank), kw).toThrow(GUI_ERRORS[GUI_ERR.SCREEN_NOT_OPENED])
    }
    expect(() => run('Print Gui Screen Base(1)', bank)).toThrow(GUI_ERRORS[GUI_ERR.SCREEN_NOT_OPENED])
    expect(() => run('Gui Screen Close 1', bank)).toThrow(GUI_ERRORS[GUI_ERR.SCREEN_NOT_OPENED])
  })

  /**
   * THREE arguments and the last two are absolute, against the guide's
   * `Gui Screen Move deltaX,deltaY`. $39cc subtracts the screen's own
   * LeftEdge and TopEdge before calling MoveScreen, which is the one that
   * takes deltas.
   */
  it('Gui Screen Move takes a screen and a position, not two deltas', () => {
    const rt = run(`${open} : Gui Screen Move 1,10,20 : Gui Screen Move 1,30,40`, bank)
    const sc = rt.gui.screens.get(1)!
    expect([sc.left, sc.top]).toEqual([30, 40])
  })

  /**
   * DEFECT: $3892 passes error 15, "Screen already open", on a path that
   * fails because the number is free. Every other screen lookup passes 17.
   */
  it('Gui Show Title raises the wrong error for a screen that is not there', () => {
    expect(() => run('Gui Show Title 9,0', bank)).toThrow(GUI_ERRORS[GUI_ERR.SCREEN_ALREADY_OPEN])
    const rt = run(`${open} : Gui Show Title 1,0`, bank)
    expect(rt.gui.screens.get(1)!.showTitle).toBe(false)
  })

  /** "By default the screen is set to private state" */
  it('a screen opens private, and Gui Pub Mode changes it', () => {
    expect(run(open, bank).gui.screens.get(1)!.isPublic).toBe(false)
    expect(run(`${open} : Gui Pub Mode 1,1`, bank).gui.screens.get(1)!.isPublic).toBe(true)
    expect(run(`${open} : Gui Pub Mode 1,1 : Gui Pub Mode 1,0`, bank).gui.screens.get(1)!.isPublic).toBe(false)
  })

  it('closing a screen forgets it and leaves no current one', () => {
    const rt = run(`${open} : Gui Screen Close 1`, bank)
    expect(rt.gui.screens.size).toBe(0)
    expect(rt.gui.current).toBeNull()
  })

  /** each nibble times $11, packed as $00RRGGBB */
  it('Gui Aga expands a 12-bit colour to 24', () => {
    const got = runOut('Print Gui Aga($FFF) : Print Gui Aga($000) : Print Gui Aga($F80) : Print Gui Aga($08F)', bank).out
    expect(got.trim().split('\n').map(Number)).toEqual([0xffffff, 0, 0xff8800, 0x0088ff])
  })

  it('Gui Os is the version every other version test here compares against', () => {
    expect(Number(runOut('Print Gui Os', bank).out.trim())).toBe(GUI_OS_VERSION)
    expect(GUI_OS_VERSION).toBeGreaterThanOrEqual(39)
  })

  /** ModeNotAvailable plus one, and this port has no display database */
  it('Gui Monitor answers available for everything', () => {
    expect(runOut('Print Gui Monitor($A9004)', bank).out.trim()).toBe('1')
  })
})

/**
 * The odds and ends: two 3d keywords, a timer, a qualifier and two pointers.
 *
 * Grouped by what is left rather than by what they share, which is how the
 * guide's own "Miscellaneous commands" node groups them.
 */
describeWith('the 3d, timer and key group', exampleBank(), (bank) => {
  const open = 'Gui Open 1,1'
  const rp = (rt: Runtime) => rt.gui.windows.get(1)!.rp

  /**
   * 128 over Z: `asl.l #$7,d0 / divs.w d2,d0` at $3d16. With the eye at the
   * default 0,0 a Z of 128 is the identity, so the line lands where a plain
   * `Gui Draw` would put it.
   */
  it('Gui Line 3d divides by Z and offsets by the eye', () => {
    const rt = run(`${open} : Gui Ink 4 : Gui Line 3d 0,0,128 To 20,0,128`, bank)
    expect(rp(rt).point(10, 0)).toBe(4)
    const w = rt.gui.windows.get(1)!
    expect([w.grX, w.grY]).toEqual([20, 0])
  })

  it('a Z of 256 halves the coordinates', () => {
    const rt = run(`${open} : Gui Ink 5 : Gui Line 3d 0,0,256 To 40,0,256`, bank)
    expect(rt.gui.windows.get(1)!.grX).toBe(20)
  })

  it('Gui Eye 3d moves the vanishing point, in words', () => {
    const rt = run(`${open} : Gui Eye 3d 30,12 : Gui Line 3d 0,0,128 To 0,0,128`, bank)
    expect([rt.gui.eyeX, rt.gui.eyeY]).toEqual([30, 12])
    const w = rt.gui.windows.get(1)!
    expect([w.grX, w.grY]).toEqual([30, 12])
  })

  /**
   * DEFECT: the error a zero Z raises is 20, "Socket not opened!", which
   * belongs to the TCP group. $3d48 is `moveq #$14,d7` and nothing between
   * there and `L_ErrorExt` reloads it.
   */
  it('a zero Z raises the TCP group s error', () => {
    expect(() => run(`${open} : Gui Line 3d 0,0,0 To 1,1,1`, bank)).toThrow(GUI_ERRORS[GUI_ERR.SOCKET_NOT_OPENED])
    expect(() => run(`${open} : Gui Line 3d 1,1,1 To 0,0,0`, bank)).toThrow(GUI_ERRORS[GUI_ERR.SOCKET_NOT_OPENED])
    expect(GUI_ERRORS[GUI_ERR.SOCKET_NOT_OPENED]).toBe('Socket not opened!')
  })

  /**
   * `Gui Line 3d` does not test `$1bc` where every other drawing keyword
   * does, so on the machine this reads Move's arguments out of address zero.
   * This port raises the group's own 11 instead.
   */
  it('Gui Line 3d with no Gfx output raises rather than reading zero', () => {
    expect(() => run('Gui Line 3d 0,0,1 To 1,1,1', bank)).toThrow(GUI_ERRORS[GUI_ERR.GFX_NOT_DEFINED])
  })

  /** "when the specified time period is elapsed Gui Wait will inform you (event -13)" */
  it('Gui Timer comes due as event -13, once', () => {
    const rt = run(`${open} : Gui Timer 0,0`, bank)
    expect(rt.gui.timerAt).not.toBeNull()
    // Gui Wait is where the pump would have found the reply
    const { out } = runOut(`${open} : Gui Timer 0,0 : Print Gui Wait : Print Gui Wait`, bank)
    expect(out.trim().split('\n').map(Number)).toEqual([GUI_EVENT.TIMER, GUI_EVENT.NOTHING])
  })

  /**
   * "Before sending a new timer request, you've to wait the end of the
   * previous one otherwise it'll be ignored!" — and $431c tests the bit
   * before it writes anything, so the second request is not merely refused,
   * it leaves the first one's time standing.
   */
  it('a second Gui Timer while one is running is ignored', () => {
    const { rt, out } = runOut(`${open} : Gui Timer 10,0 : Gui Timer 0,0 : Print Gui Wait`, bank)
    // the ten-second request stands, so nothing is due yet
    expect(Number(out.trim())).toBe(GUI_EVENT.NOTHING)
    expect(rt.gui.timerAt! - rt.frames).toBeGreaterThan(400)
  })

  /** the timer names no window: $6ba4 reaches the report without writing `$de` */
  it('a timer leaves Gui Window naming whoever spoke last', () => {
    const { out } = runOut(`${open} : Gui Timer 0,0 : Print Gui Wait : Print Gui Window`, bank, (rt) => {
      guiPost(rt, 1, 3)
    })
    // the injected gadget event is reported first and names window 1
    expect(out.trim().split('\n').map(Number)).toEqual([3, 1])
  })

  /**
   * `$e4` is the last IntuiMessage's Qualifier, masked with $7ffb at $6cf8.
   *
   * DEFECT: bit 2 is Caps Lock in the guide's own table and the mask clears
   * it. Bits 8 to 14 are not in the table and survive.
   */
  it('Gui Key Shift reports the qualifier, less Caps Lock', () => {
    const shift = (q: number): number =>
      Number(runOut(`${open} : Print Gui Wait : Print Gui Key Shift`, bank, (rt) => {
        guiPost(rt, 1, GUI_EVENT.KEY, 0, 'x', undefined, q)
      }).out.trim().split('\n')[1])
    expect(shift(0b0000_0011)).toBe(3)
    expect(shift(0b0000_0100)).toBe(0)
    expect(shift(0b0000_1111)).toBe(0b1011)
    expect(shift(0x8000)).toBe(0)
    expect(shift(0x4000)).toBe(0x4000)
  })

  /** an event that is not an IntuiMessage leaves the word standing */
  it('a timer does not disturb Gui Key Shift', () => {
    const { out } = runOut(
      `${open} : Print Gui Wait : Gui Timer 0,0 : Print Gui Wait : Print Gui Key Shift`,
      bank,
      (rt) => {
        guiPost(rt, 1, GUI_EVENT.KEY, 0, 'x', undefined, 8)
      },
    )
    expect(out.trim().split('\n').map(Number)).toEqual([GUI_EVENT.KEY, GUI_EVENT.TIMER, 8])
  })

  /**
   * "It works just like the AMOS command Text Length()". Eight pixels a
   * character until a screen carries a font that is not topaz/8.
   */
  it('Gui Len measures the string against the window s font', () => {
    expect(Number(runOut(`${open} : Print Gui Len("Hello",1)`, bank).out.trim())).toBe(40)
    expect(Number(runOut(`${open} : Print Gui Len("",1)`, bank).out.trim())).toBe(0)
  })

  /** a negative mode never looks a window up, so it cannot raise */
  it('Gui Len with a negative mode measures on the screen instead', () => {
    expect(Number(runOut(`${open} : Print Gui Len("Hello",-1)`, bank).out.trim())).toBe(40)
    expect(() => run(`${open} : Print Gui Len("Hi",9)`, bank)).toThrow(GUI_ERRORS[GUI_ERR.WINDOW_NOT_OPEN])
  })

  /**
   * Worth a line of its own: $2cce loads `moveq #$7,d7` where every other
   * `$1bc` reader loads 11, so this one keyword says "Gui not open".
   */
  it('Gui Text Base is topaz/8 s baseline, and has its own error', () => {
    expect(Number(runOut(`${open} : Print Gui Text Base`, bank).out.trim())).toBe(6)
    expect(() => run('Print Gui Text Base', bank)).toThrow(GUI_ERRORS[GUI_ERR.GUI_NOT_OPEN])
  })
})

/**
 * `Gui Gad Adr` and `Gui Gad Tag`, the two keywords that hand back addresses.
 */
describeWith('the address group', exampleBank(), (bank) => {
  const open = 'Gui Open 1,1'

  /** distinct, non-zero, and the same number every time it is asked for */
  it('Gui Gad Adr answers one handle per gadget', () => {
    const out = runOut(
      `${open} : Print Gui Gad Adr(1,0) : Print Gui Gad Adr(1,1) : Print Gui Gad Adr(1,0)`,
      bank,
    ).out.trim().split('\n').map(Number)
    expect(out[0]).toBeGreaterThan(0)
    expect(out[1]).not.toBe(out[0])
    expect(out[2]).toBe(out[0])
  })

  /**
   * The one place it differs from `Gui X Gad`, which runs the same lookup:
   * $2828 answers 0 where $279e raises "Gadget not defined".
   */
  it('Gui Gad Adr answers 0 where Gui X Gad raises', () => {
    expect(val(`Gui Gad Adr(9,0)`, bank)).toBe(0)
    expect(Number(runOut(`${open} : Print Gui Gad Adr(1,-1)`, bank).out.trim())).toBe(0)
    expect(Number(runOut(`${open} : Print Gui Gad Adr(1,99)`, bank).out.trim())).toBe(0)
    expect(() => run(`${open} : Print Gui X Gad(1,99)`, bank)).toThrow(GUI_ERRORS[GUI_ERR.GADGET_NOT_DEFINED])
  })

  /**
   * DEFECT: the last design in a chain is unreachable, so a bank holding one
   * GUI has nothing this keyword will answer about. Both GUI banks in the
   * corpus hold exactly one.
   */
  it('Gui Gad Tag refuses the only design in a one-design bank', () => {
    expect(readGuiBank(bank)).toHaveLength(1)
    expect(() => run(`${open} : Print Gui Gad Tag(1,0,20,$8008000B)`, bank)).toThrow(
      GUI_ERRORS[GUI_ERR.GUI_NOT_DEFINED],
    )
  })

  /**
   * So the working path needs a chain of two, which is the same bank twice
   * with the first one's Next field set to the distance between them.
   */
  const twin = ((): Uint8Array => {
    const b = new Uint8Array(bank.length * 2)
    b.set(bank, 0)
    b.set(bank, bank.length)
    b[0] = (bank.length >> 8) & 0xff
    b[1] = bank.length & 0xff
    return b
  })()

  it('the twin bank chains two designs', () => {
    expect(readGuiBank(twin)).toHaveLength(2)
  })

  /**
   * BootSelector's gadget 0 carries one tag, $8008000B, which is GTTX_Text.
   * The answer is the address of its DATA longword: the tag area starts at
   * +94 and the pair's data is four bytes into it.
   */
  it('Gui Gad Tag points at the tag s data inside the bank', () => {
    const rt = new Runtime(tokenize('Rem', table, exts), table, { extensions: exts, extBindings: new Map([[24, gui]]) })
    const want = rt.bankBase(20) + 94 + 4
    expect(Number(runOut(`Print Gui Gad Tag(1,0,20,$8008000B)`, twin).out.trim())).toBe(want)
  })

  it('a tag the gadget does not carry answers 0', () => {
    expect(Number(runOut(`Print Gui Gad Tag(1,0,20,$80080006)`, twin).out.trim())).toBe(0)
    expect(Number(runOut(`Print Gui Gad Tag(1,1,20,$8008000B)`, twin).out.trim())).toBe(0)
  })

  it('Gui Gad Tag checks the bank, the design and the gadget in that order', () => {
    expect(() => run(`Print Gui Gad Tag(1,0,21,0)`, twin)).toThrow(GUI_ERRORS[GUI_ERR.BANK_NOT_RESERVED])
    expect(() => run(`Print Gui Gad Tag(0,0,20,0)`, twin)).toThrow(GUI_ERRORS[GUI_ERR.GUI_NOT_DEFINED])
    expect(() => run(`Print Gui Gad Tag(1,-1,20,0)`, twin)).toThrow(GUI_ERRORS[GUI_ERR.GADGET_NOT_DEFINED])
    expect(() => run(`Print Gui Gad Tag(1,4,20,0)`, twin)).toThrow(GUI_ERRORS[GUI_ERR.GADGET_NOT_DEFINED])
    // design 2 is the last of the two, and the last is the one it cannot reach
    expect(() => run(`Print Gui Gad Tag(2,0,20,0)`, twin)).toThrow(GUI_ERRORS[GUI_ERR.GUI_NOT_DEFINED])
  })

  /**
   * DEFECT: the bound is `cmp.w` at $2f30 and the walk is `cmp.l` at $2f4e,
   * so a gadget number whose low word is in range passes and then counts
   * 65,537 lists forward. Answered as 0 here rather than read on past the
   * bank.
   */
  it('a gadget number of 65536 passes the word-wide bound', () => {
    expect(Number(runOut(`Print Gui Gad Tag(1,65535,20,0)`, twin).out.trim())).toBe(0)
  })
})

/**
 * The file and stream group: six keywords over dos.library, and two over its
 * notification.
 *
 * These need a writable filesystem rather than a GUI bank, so they run on
 * their own machine with RAM: and CLIPS: mounted — the two volumes
 * `../cli/nodefs.ts` and `../web/player.ts` give every program.
 */
describe('the file and stream group', () => {
  interface Fsd {
    rt: Runtime
    fs: AmigaFS
    out: () => string
  }

  function withFs(src: string): Fsd {
    let printed = ''
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    fs.mountMemory('CLIPS')
    fs.currentDir = 'RAM:'
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[24, gui]]),
      maxSteps: 300_000,
      fs,
      onText: (t) => (printed += t),
    })
    return { rt, fs, out: () => printed }
  }

  function ran(src: string): Fsd {
    const f = withFs(src)
    mustFinish(f.rt.runHeadless(500))
    return f
  }

  /** "Works in the opposite to Gui Get$, by placing the string into the file" */
  it('Gui Put writes a string and Gui Get$ reads it back', () => {
    const f = ran(`Gui Put "RAM:cfg","hello world" : Print Gui Get$("RAM:cfg")`)
    expect(f.out().trim()).toBe('hello world')
    expect(f.fs.readFile('RAM:cfg')).toEqual(Uint8Array.from('hello world', (c) => c.charCodeAt(0)))
  })

  /** the length is the string's own word, so a zero byte is data */
  it('Gui Put writes an embedded zero rather than stopping at it', () => {
    const f = ran(`Gui Put "RAM:z","a"+Chr$(0)+"b" : Print Len(Gui Get$("RAM:z"))`)
    expect(f.fs.readFile('RAM:z')).toEqual(Uint8Array.from([97, 0, 98]))
    expect(f.out().trim()).toBe('3')
  })

  it('both raise "Unable to open file" and nothing else', () => {
    expect(() => ran(`Print Gui Get$("RAM:nothing")`)).toThrow(GUI_ERRORS[GUI_ERR.UNABLE_TO_OPEN_FILE])
    expect(() => ran(`Gui Put "NOSUCH:x","y"`)).toThrow(GUI_ERRORS[GUI_ERR.UNABLE_TO_OPEN_FILE])
  })

  /**
   * DEVIATION: no shell. `Input()` answers zero and $327e takes the branch to
   * the null string, which is the same branch a Workbench-launched program
   * takes on the machine.
   */
  it('Gui Input$ is empty with no input stream', () => {
    expect(ran('Print "["+Gui Input$+"]"').out().trim()).toBe('[]')
  })

  /**
   * DEVIATION: the other way round -- $32bc tests the string's LENGTH and
   * not the handle, so there is no null branch to take and the text goes to
   * the console. An empty string does return without doing anything.
   */
  it('Gui Output writes to the console, and an empty string does not', () => {
    expect(ran(`Gui Output "shell text"`).out()).toBe('shell text')
    expect(ran(`Gui Output ""`).out()).toBe('')
  })

  /** FORM ???? FTXT CHRS ???? and the bytes, which is twenty bytes of header */
  it('Gui Clip Write$ builds an IFF FTXT at CLIPS:0', () => {
    const f = ran(`Gui Clip Write$ "abcd"`)
    const got = f.fs.readFile('CLIPS:0')!
    expect(got.length).toBe(24)
    expect(String.fromCharCode(...got.subarray(0, 4))).toBe('FORM')
    expect(String.fromCharCode(...got.subarray(8, 16))).toBe('FTXTCHRS')
    const dv = new DataView(got.buffer, got.byteOffset, got.byteLength)
    // 12 for FTXT, CHRS and the chunk size, plus the four bytes of text
    expect(dv.getUint32(4)).toBe(16)
    expect(dv.getUint32(16)).toBe(4)
    expect(String.fromCharCode(...got.subarray(20))).toBe('abcd')
  })

  /**
   * DEFECT: `(len + $d) & $fffe` at $48ae rounds an odd length up for IFF's
   * pad byte, and the byte count is that plus 8 — one more than the `len +
   * $14` AllocVec at $488a asked for. The file is still correct IFF.
   */
  it('an odd length writes one byte past the buffer it allocated', () => {
    const f = ran(`Gui Clip Write$ "abcde"`)
    const got = f.fs.readFile('CLIPS:0')!
    // the buffer was 25 bytes and 26 were written
    expect(got.length).toBe(26)
    expect(new DataView(got.buffer, got.byteOffset, got.byteLength).getUint32(4)).toBe(18)
    expect(got[25]).toBe(0)
  })

  it('Gui Clip Read$ reads its own writing back', () => {
    expect(ran(`Gui Clip Write$ "round trip" : Print Gui Clip Read$`).out().trim()).toBe('round trip')
    expect(ran(`Gui Clip Write$ "odd" : Print "["+Gui Clip Read$+"]"`).out().trim()).toBe('[odd]')
  })

  /** "Obviously it works only if some characters are present..." */
  it('an empty or absent clipboard answers an empty string', () => {
    expect(ran(`Print "["+Gui Clip Read$+"]"`).out().trim()).toBe('[]')
    const f = withFs(`Print "["+Gui Clip Read$+"]"`)
    f.fs.writeFile('CLIPS:0', Uint8Array.from('FORM....ILBM', (c) => c.charCodeAt(0)))
    mustFinish(f.rt.runHeadless(500))
    expect(f.out().trim()).toBe('[]')
  })

  /**
   * Every chunk is read into the same buffer and only a CHRS moves the write
   * pointer on, so the answer is the CHRS bodies run together and everything
   * else is overwritten by what follows it.
   */
  it('several CHRS chunks join, and other chunks are skipped', () => {
    const chunk = (id: string, body: string): number[] => {
      const b = [...id].map((c) => c.charCodeAt(0))
      const n = body.length
      b.push((n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff)
      b.push(...[...body].map((c) => c.charCodeAt(0)))
      if (n & 1) b.push(0)
      return b
    }
    const body = [...chunk('FVER', 'v1'), ...chunk('CHRS', 'one'), ...chunk('CHRS', 'two')]
    const iff = Uint8Array.from([
      ...[...'FORM'].map((c) => c.charCodeAt(0)),
      0,
      0,
      0,
      body.length + 4,
      ...[...'FTXT'].map((c) => c.charCodeAt(0)),
      ...body,
    ])
    const f = withFs(`Print "["+Gui Clip Read$+"]"`)
    f.fs.writeFile('CLIPS:0', iff)
    mustFinish(f.rt.runHeadless(500))
    expect(f.out().trim()).toBe('[onetwo]')
  })

  /**
   * DEFECT: `andi.l #$fffe` masks the READ length to sixteen bits while
   * `adda.l d6,a3` moves the write pointer the full size. A CHRS of 70,000
   * reads 4,464 bytes and advances 70,000, so the answer is 70,000 characters
   * of which all but the first 4,464 were never written.
   */
  it('a CHRS over 64K reads short and steps long', () => {
    const n = 70_000
    const head = Uint8Array.from([
      ...[...'FORM'].map((c) => c.charCodeAt(0)),
      0, 0, 0, 0,
      ...[...'FTXTCHRS'].map((c) => c.charCodeAt(0)),
      (n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff,
    ])
    const iff = new Uint8Array(head.length + n)
    iff.set(head, 0)
    iff.fill(0x41, head.length)
    const f = withFs(`A$=Gui Clip Read$ : Print Len(A$) : Print Asc(Mid$(A$,1,1)) : Print Asc(Mid$(A$,5000,1))`)
    f.fs.writeFile('CLIPS:0', iff)
    mustFinish(f.rt.runHeadless(500))
    // (70000 + 1) AND $fffe is 4464, so only that many bytes were ever read
    expect(f.out().trim().split('\n').map(Number)).toEqual([n, 0x41, 0])
  })

  /**
   * "You can monitor a specified file or directory, and when something modify
   * it you'll be informed (Gui Wait return -14, and Gui Code the notify ID."
   */
  it('Gui Notify reports a write as event -14 carrying its own id', () => {
    const f = ran(
      `N=Gui Notify("RAM:watched") : Print N : Gui Put "RAM:watched","x" : Print Gui Wait : Print Gui Code`,
    )
    const [id, event, code] = f.out().trim().split('\n').map(Number)
    expect(id).toBeGreaterThan(0)
    expect(event).toBe(GUI_EVENT.NOTIFY)
    expect(code).toBe(id)
  })

  /** a directory watch answers for anything inside it */
  it('a directory watch hears its own files', () => {
    const f = ran(`N=Gui Notify("RAM:") : Gui Put "RAM:inside","x" : Print Gui Wait`)
    expect(Number(f.out().trim())).toBe(GUI_EVENT.NOTIFY)
  })

  it('a write somewhere else is not reported', () => {
    const f = ran(`N=Gui Notify("RAM:watched") : Gui Put "RAM:other","x" : Print Gui Wait`)
    expect(Number(f.out().trim())).toBe(GUI_EVENT.NOTHING)
  })

  /**
   * $3a34 and $3a3c: an empty name and one over $50 characters both answer 0
   * without an error, because the node has only that much room for it.
   */
  it('Gui Notify refuses an empty name and one over 80 characters', () => {
    const long = `RAM:${'x'.repeat(80)}`
    const f = ran(`Print Gui Notify("") : Print Gui Notify("${long}")`)
    expect(f.out().trim().split('\n').map(Number)).toEqual([0, 0])
  })

  it('Gui Rem Notify stops it, and an id it does not know is not an error', () => {
    const f = ran(
      `N=Gui Notify("RAM:watched") : Gui Rem Notify N : Gui Rem Notify 12345 : Gui Put "RAM:watched","x" : Print Gui Wait`,
    )
    expect(Number(f.out().trim())).toBe(GUI_EVENT.NOTHING)
    expect(f.rt.gui.notifies.size).toBe(0)
  })

  /** "You can monitor as many files as you want", and each has its own id */
  it('two watches answer with two ids', () => {
    const f = ran(
      `A=Gui Notify("RAM:one") : B=Gui Notify("RAM:two") : Gui Put "RAM:two","x" : E=Gui Wait : Print Gui Code=B`,
    )
    expect(Number(f.out().trim())).toBe(-1)
  })
})

/**
 * The locale group, plus the two help keywords that sit beside it in the
 * guide's "Miscellaneous" node.
 */
describeWith('the locale group', exampleBank(), (bank) => {
  /** a `FORM ... CTLG` with a LANG chunk and one STRS run, as parseCatalog reads */
  function catalog(lang: string, strings: Array<[number, string]>): Uint8Array {
    const bytes: number[] = []
    const put = (s: string): void => {
      bytes.push(...[...s].map((c) => c.charCodeAt(0)))
    }
    const be = (n: number): void => {
      bytes.push((n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff)
    }
    const strs: number[] = []
    for (const [id, text] of strings) {
      strs.push((id >> 24) & 0xff, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff)
      const len = text.length + 1
      strs.push((len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff)
      strs.push(...[...text].map((c) => c.charCodeAt(0)), 0)
      // the ENTRY pads on to the next longword, which is separate from the length
      while (strs.length % 4 !== 0) strs.push(0)
    }
    put('FORM')
    be(0)
    put('CTLG')
    put('LANG')
    be(lang.length + 1)
    put(lang)
    bytes.push(0)
    if ((lang.length + 1) & 1) bytes.push(0)
    put('STRS')
    be(strs.length)
    bytes.push(...strs)
    const out = Uint8Array.from(bytes)
    new DataView(out.buffer).setUint32(4, out.length - 8)
    return out
  }

  function withCat(src: string, cat: Uint8Array | null, name = 'RAM:x.catalog'): { rt: Runtime; out: string } {
    let printed = ''
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    fs.currentDir = 'RAM:'
    if (cat !== null) fs.writeFile(name, cat)
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[24, gui]]),
      maxSteps: 300_000,
      fs,
      onText: (t) => (printed += t),
    })
    rt.memBanks.set(20, { kind: 'memory', number: 20, memType: 1, name: 'Gui', flags: 0, data: bank })
    mustFinish(rt.runHeadless(500))
    return { rt, out: printed }
  }

  /**
   * BootSelector's four gadgets carry no names at all and gadget 0 carries a
   * TEXT payload of one space, so the chain runs: four empty names with the
   * payload after the first, then the title, then the screen name.
   */
  it('the bank labels its gadgets and its window', () => {
    const g = readGuiBank(bank)[0]!
    expect(g.gadgets.map((x) => x.payload)).toEqual(['text', 'none', 'none', 'none'])
    expect([g.title, g.screenName]).toEqual(['Work Window', ''])
    expect(g.catalogBase).toBe(0)
  })

  /**
   * The numbering is GuiConv's `_LOCALE` order: each gadget's name, then its
   * payload, then the menus, then the window title and the screen title. So
   * gadget 0's name is 0, its text is 1, the other three names are 2 to 4 and
   * the window title is 5.
   */
  it('Gui Catalog Open localises the labels a window is built with', () => {
    const cat = catalog('italiano', [
      [1, 'Avvia'],
      [5, 'Titolo'],
      [3, 'Terzo'],
    ])
    const r = withCat(
      `C=Gui Catalog Open("RAM:x.catalog",20) : Print C<>0 : Gui Open 1,1 : Print Gui Title$(1)`,
      cat,
    )
    const lines = r.out.trim().split('\n')
    expect(Number(lines[0])).toBe(-1)
    expect(lines[1]).toBe('Titolo')
    const d = r.rt.gui.windows.get(1)!.design
    expect(d.gadgets[0]!.text).toBe('Avvia')
    // number 3 is the SECOND unnamed gadget, because the payload took number 1
    expect(d.gadgets[2]!.name).toBe('Terzo')
    expect(d.gadgets[1]!.name).toBe('')
    // and the bank itself is untouched, as it is on the machine
    expect(readGuiBank(bank)[0]!.title).toBe('Work Window')
  })

  /** "You must localize your bank BEFORE open anyone of its GUI!!!" */
  it('a window already open keeps the labels it was built with', () => {
    const cat = catalog('italiano', [[5, 'Titolo']])
    const r = withCat(`Gui Open 1,1 : C=Gui Catalog Open("RAM:x.catalog",20) : Print Gui Title$(1)`, cat)
    expect(r.out.trim()).toBe('Work Window')
  })

  it('a missing catalog answers 0 and changes nothing', () => {
    const r = withCat(`Print Gui Catalog Open("RAM:x.catalog",20) : Gui Open 1,1 : Print Gui Title$(1)`, null)
    expect(r.out.trim().split('\n')).toEqual(['0', 'Work Window'])
  })

  /** `cmpi.l #$47756920,-$8(a0)`: the bank has to be NAMED Gui */
  it('a bank that is not named Gui answers 0', () => {
    let printed = ''
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    fs.writeFile('RAM:x.catalog', catalog('italiano', [[0, 'Ciao']]))
    const rt = new Runtime(tokenize(`Print Gui Catalog Open("RAM:x.catalog",20)`, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[24, gui]]),
      fs,
      onText: (t) => (printed += t),
    })
    rt.memBanks.set(20, { kind: 'memory', number: 20, memType: 1, name: 'Work', flags: 0, data: bank })
    mustFinish(rt.runHeadless(500))
    expect(printed.trim()).toBe('0')
    // and a bank that is not reserved at all
    expect(Number(runOut(`Print Gui Catalog Open("RAM:x.catalog",21)`, bank).out.trim())).toBe(0)
  })

  /**
   * $3cc0 hands GetCatalogStr the null string for its default, so an id the
   * catalog does not carry answers empty rather than the bank's own label.
   */
  it('Gui Catalog$ reads the attached catalog, and empty for anything else', () => {
    const cat = catalog('italiano', [[21, 'Ventuno']])
    const r = withCat(
      `C=Gui Catalog Open("RAM:x.catalog",20) : Print "["+Gui Catalog$(21)+"]" : Print "["+Gui Catalog$(99)+"]"`,
      cat,
    )
    expect(r.out.trim().split('\n')).toEqual(['[Ventuno]', '[]'])
    expect(Number(runOut(`Print Len(Gui Catalog$(0))`, bank).out.trim())).toBe(0)
  })

  it('Gui Catalog Close drops it, and an id it does not know is not an error', () => {
    const cat = catalog('italiano', [[5, 'Titolo']])
    const r = withCat(
      `C=Gui Catalog Open("RAM:x.catalog",20) : Gui Catalog Close 999 : Gui Catalog Close C : Gui Open 1,1 : Print Gui Title$(1)`,
      cat,
    )
    expect(r.out.trim()).toBe('Work Window')
    expect(r.rt.gui.catalogs.size).toBe(0)
  })

  /** the word at +68 of the head design, zero when the converter wrote none */
  it('Gui User Catalog reads the bank header, and 0 with no bank', () => {
    expect(Number(runOut(`Print Gui User Catalog`, bank).out.trim())).toBe(0)
    expect(val('Gui User Catalog')).toBe(0)
  })

  /**
   * "a message defined by you will be automatically displayed into the
   * specified display gadget". Gadget 1's box is 0,0 to 48,37, so a move at
   * 10,10 is over it and the array's element 1 is what appears.
   */
  const helpSrc = `Dim H$(3) : H$(0)="zero" : H$(1)="one" : H$(2)="two" : H$(3)="three"
Gui Open 1,1 : Gui Help 1,0,Array(H$(0)) : Print Gui Wait`

  it('Gui Help writes the array entry for the gadget under the pointer', () => {
    const r = runOut(helpSrc, bank, (m) => {
      m.gui.post({ code: GUI_EVENT.MOUSEMOVE, result: 0, text: '', window: 1, mouseX: 10, mouseY: 10 })
    })
    expect(r.rt.gui.windows.get(1)!.strings.get(0)).toBe('one')
    // the move was SWALLOWED: help is on and Gui Mouse Report is not
    expect(Number(r.out.trim())).toBe(GUI_EVENT.NOTHING)
  })

  /** flags 3: $6eb6 reports the move as well as running the help */
  it('with Gui Mouse Report on as well, the move is reported too', () => {
    const src = helpSrc.replace('Gui Help 1,0', 'Gui Mouse Report 1,True : Gui Help 1,0')
    const r = runOut(src, bank, (m) => {
      m.gui.post({ code: GUI_EVENT.MOUSEMOVE, result: 0, text: '', window: 1, mouseX: 10, mouseY: 10 })
    })
    expect(r.rt.gui.windows.get(1)!.strings.get(0)).toBe('one')
    expect(Number(r.out.trim())).toBe(GUI_EVENT.MOUSEMOVE)
  })

  /**
   * "Over nothing" is number 0 after the `addq.l #$1,d3` at $6e76, and `Gui
   * Help` zeroed `$40` when it was switched on -- so the FIRST move over no
   * gadget matches the remembered value at $6e78 and the display is never
   * written at all. It blanks only after the pointer has been over something.
   */
  it('the first move over no gadget writes nothing, and a later one blanks', () => {
    const one = runOut(helpSrc, bank, (m) => {
      m.gui.post({ code: GUI_EVENT.MOUSEMOVE, result: 0, text: '', window: 1, mouseX: 600, mouseY: 600 })
    })
    expect(one.rt.gui.windows.get(1)!.strings.get(0)).toBeUndefined()
    const two = runOut(helpSrc, bank, (m) => {
      m.gui.post({ code: GUI_EVENT.MOUSEMOVE, result: 0, text: '', window: 1, mouseX: 10, mouseY: 10 })
      m.gui.post({ code: GUI_EVENT.MOUSEMOVE, result: 0, text: '', window: 1, mouseX: 600, mouseY: 600 })
    })
    expect(two.rt.gui.windows.get(1)!.strings.get(0)).toBe('')
  })

  /** "call it again with the array address set to 0" */
  it('Gui Help with a zero array turns it off, and off twice is a no-op', () => {
    const src = `Dim H$(3) : H$(1)="one"
Gui Open 1,1 : Gui Help 1,0,Array(H$(0)) : Gui Help 1,0,0 : Gui Help 1,0,0
Print Gui Wait : Print Gui Wait`
    const r = runOut(src, bank, (m) => {
      m.gui.post({ code: GUI_EVENT.MOUSEMOVE, result: 0, text: '', window: 1, mouseX: 10, mouseY: 10 })
      m.gui.post({ code: GUI_EVENT.MOUSEMOVE, result: 0, text: '', window: 1, mouseX: 20, mouseY: 20 })
    })
    const w = r.rt.gui.windows.get(1)!
    expect(w.helpOn).toBe(false)
    // with help off both moves are reported, and neither writes a gadget
    expect(r.out.trim().split('\n').map(Number)).toEqual([GUI_EVENT.MOUSEMOVE, GUI_EVENT.MOUSEMOVE])
    expect(w.strings.size).toBe(0)
  })
})

/**
 * The XFA group: nine keywords over xfa.library, which is not modelled and is
 * not in the corpus either. What is testable is the branch a machine without
 * it takes, which is the one the extension has an error string for.
 */
describe('the XFA group', () => {
  it('both play keywords raise "xfa.library not available"', () => {
    expect(() => run(`Xfa Play "RAM:a.xfa",0,0,0,0,0`)).toThrow(GUI_ERRORS[GUI_ERR.XFA_NOT_AVAILABLE])
    expect(() => run(`Xfa Rtg Play "RAM:a.xfa",1,1,1,1,1`)).toThrow(GUI_ERRORS[GUI_ERR.XFA_NOT_AVAILABLE])
    expect(GUI_ERRORS[GUI_ERR.XFA_NOT_AVAILABLE]).toBe('xfa.library not available')
  })

  /** $3f14 leaves d0 at zero and raises nothing at all */
  it('Xfa Check answers 0 without raising', () => {
    expect(val(`Xfa Check("RAM:a.xfa")`)).toBe(0)
  })

  /** six reads of `$2a8` to `$2b4`, which no check has filled in */
  it('the six readers answer zero, and take no arguments', () => {
    const out = runOut(
      `Print Xfa Width : Print Xfa Height : Print Xfa Mode Id : Print Xfa Depth : Print Xfa Pack : Print Xfa Frames`,
    ).out
    expect(out.trim().split('\n').map(Number)).toEqual([0, 0, 0, 0, 0, 0])
  })
})

/**
 * The graphics group: the three pastes, the scroll, the two screen-to-screen
 * copies and the two that need a library this port has not got.
 */
describeWith('the graphics group', exampleBank(), (bank) => {
  const rp = (rt: Runtime) => rt.gui.windows.get(1)!.rp

  /**
   * An AMOS bob bank of one 16x2 image whose left half is colour 3.
   *
   * Sixteen wide because a bank image's row is measured in whole words --
   * `bankRowBytesFor` truncates -- and an eight-wide one has no bytes at all.
   */
  function bobs(rt: Runtime): void {
    const img = new BankImage(16, 2, 4, 0, 0)
    img.planes.fill(0)
    const row = img.rowBytes
    for (let plane = 0; plane < 2; plane++) {
      for (let y = 0; y < 2; y++) img.planes[plane * img.planeSize + y * row] = 0xff
    }
    // a planes write needs the chunky cache dropped, which the setter does
    img.planes = Uint8Array.from(img.planes)
    const b = new ObjectBank()
    b.images = [img]
    rt.spriteBank = b
    rt.iconBank = b
  }

  it('Gui Paste Bob and Gui Paste Icon draw the bank image', () => {
    for (const kw of ['Gui Paste Bob 1,4,4', 'Gui Paste Icon 1,4,4']) {
      const r = runOut(`Gui Open 1,1 : Gui Gfx 0,1 : ${kw}`, bank, bobs)
      expect(rp(r.rt).point(4, 4), kw).toBe(3)
      expect(rp(r.rt).point(11, 5), kw).toBe(3)
      expect(rp(r.rt).point(12, 5), kw).toBe(0)
    }
  })

  /** $74fa refuses zero and below, $7502 the count: both are error 12 */
  it('a number no bank answers to is "Image not reserved"', () => {
    const src = 'Gui Open 1,1 : Gui Gfx 0,1 : Gui Paste Bob 9,0,0'
    expect(() => runOut(src, bank, bobs)).toThrow(GUI_ERRORS[GUI_ERR.IMAGE_NOT_RESERVED])
    expect(() => runOut(src.replace('9', '0'), bank, bobs)).toThrow(GUI_ERRORS[GUI_ERR.IMAGE_NOT_RESERVED])
    expect(() => run('Gui Paste Block 1,0,0', bank)).toThrow(GUI_ERRORS[GUI_ERR.IMAGE_NOT_RESERVED])
  })

  /** routine 256 tests `$1bc` first, with `moveq #$b,d7` */
  it('pasting with no Gfx output raises 11', () => {
    expect(() => runOut('Gui Paste Bob 1,0,0', bank, bobs)).toThrow(GUI_ERRORS[GUI_ERR.GFX_NOT_DEFINED])
  })

  /** DrawImage is opaque, so colour 0 in the image is drawn and not skipped */
  it('the paste is opaque where AMOS s own Paste Bob is not', () => {
    const clear = (rt: Runtime): void => {
      // colour 5 in pixel 0 only: planes 0 and 2, top bit of the first byte
      const img = new BankImage(16, 1, 4, 0, 0)
      img.planes.fill(0)
      img.planes[0] = 0x80
      img.planes[2 * img.planeSize] = 0x80
      img.planes = Uint8Array.from(img.planes)
      const b = new ObjectBank()
      b.images = [img]
      rt.spriteBank = b
    }
    const r = runOut(`Gui Open 1,1 : Gui Gfx 0,1 : Gui Cls 7 : Gui Paste Bob 1,0,0`, bank, clear)
    expect(rp(r.rt).point(0, 0)).toBe(5)
    // pixels 1 to 3 are colour 0 in the image, and they overwrite the 7
    expect(rp(r.rt).point(2, 0)).toBe(0)
  })

  /**
   * ScrollRaster's registers put the DISTANCE last: `(rp,dx,dy,xMin,yMin,
   * xMax,yMax)` against `Gui Scroll x,y to xx,yy,numx,numy`.
   */
  it('Gui Scroll moves the box by the last two arguments', () => {
    const r = runOut(`Gui Open 1,1 : Gui Gfx 0,1 : Gui Ink 6 : Gui Plot 10,10 : Gui Scroll 0,0 To 40,20,4,0`, bank)
    expect(rp(r.rt).point(6, 10)).toBe(6)
    expect(rp(r.rt).point(10, 10)).toBe(0)
  })

  /** zero is the gfx output, above zero a GUI screen, below zero AMOS's own */
  it('Gui Screen Copy moves a rectangle between the two ends', () => {
    // sixteen colours, because a four-colour screen's RastPort is two planes
    // deep and would keep only the bottom two bits of the 5
    const src = `Gui Screen Open 1,320,200,16,0,"S" : Gui Open 1,1 : Gui Gfx 0,1
Gui Ink 5 : Gui Bar 0,0 To 3,3 : Gui Screen Copy 0,0,0,4,4 To 1,20,30`
    const r = runOut(src, bank)
    const screen = r.rt.gui.screens.get(1)!
    expect(screen.rp.point(20, 30)).toBe(5)
    expect(screen.rp.point(23, 33)).toBe(5)
    expect(screen.rp.point(24, 34)).toBe(0)
  })

  it('a screen number that names none is "Screen not opened"', () => {
    expect(() => run('Gui Open 1,1 : Gui Gfx 0,1 : Gui Screen Copy 9,0,0,4,4 To 0,0,0', bank)).toThrow(
      GUI_ERRORS[GUI_ERR.SCREEN_NOT_OPENED],
    )
  })

  /** "Display the IFF file loaded in the bank, into the specified screen" */
  it('Gui Display Iff draws the bank s picture into the screen', () => {
    const pic = encodeIlbm({
      width: 8,
      height: 4,
      depth: 4,
      mode: 0,
      palette: [0x000, 0xf00, 0x0f0, 0x00f],
      pixels: Uint8Array.from({ length: 32 }, (_, i) => (i % 4 === 0 ? 1 : 2)),
    })
    const put = (rt: Runtime): void => {
      rt.memBanks.set(5, { kind: 'memory', number: 5, memType: 1, name: 'Work', flags: 0, data: pic })
    }
    const r = runOut(`Gui Screen Open 1,320,200,16,0,"S" : Gui Display Iff 5 To 1`, bank, put)
    const screen = r.rt.gui.screens.get(1)!
    expect(screen.rp.point(0, 0)).toBe(1)
    expect(screen.rp.point(1, 0)).toBe(2)
    // the CMAP goes into the screen's colours, 12 bits expanded to 24
    expect(screen.palette[1]).toBe(expand12(0xf00))
  })

  /** `cmp.w $c(a0),d0 / bhi` with `moveq #$1a,d7` */
  it('a picture too big for the screen is "Unable to display picture"', () => {
    const pic = encodeIlbm({
      width: 640,
      height: 400,
      depth: 2,
      mode: 0,
      palette: [0, 0xfff],
      pixels: new Uint8Array(640 * 400),
    })
    const put = (rt: Runtime): void => {
      rt.memBanks.set(5, { kind: 'memory', number: 5, memType: 1, name: 'Work', flags: 0, data: pic })
    }
    expect(() => runOut(`Gui Screen Open 1,320,200,4,0,"S" : Gui Display Iff 5 To 1`, bank, put)).toThrow(
      GUI_ERRORS[GUI_ERR.UNABLE_TO_DISPLAY],
    )
    // and with the mode set, the screen is reopened at the picture's own size
    const r = runOut(`Gui Screen Open 1,320,200,4,0,"S" : Gui Display Iff 5 To 1,1`, bank, put)
    expect([r.rt.gui.screens.get(1)!.width, r.rt.gui.screens.get(1)!.height]).toEqual([640, 400])
    expect(() => run('Gui Screen Open 1,320,200,4,0,"S" : Gui Display Iff 9 To 1', bank)).toThrow(
      GUI_ERRORS[GUI_ERR.BANK_NOT_RESERVED],
    )
  })

  /** "IMPORTANT: This command requires the xfa.libray!", and $3ff6 agrees */
  it('Gui Save Iff raises the xfa.library error before it looks at anything', () => {
    expect(() => run('Gui Save Iff 9,"RAM:x.iff"', bank)).toThrow(GUI_ERRORS[GUI_ERR.XFA_NOT_AVAILABLE])
  })

  /** the palette is copied on the way in, and nothing puts it back */
  it('Gui Clone copies the AMOS palette and does not restore it', () => {
    const src = `Screen Open 0,320,200,16,Lowres : Palette $F00,$0F0
Gui Screen Open 1,320,200,16,0,"S" : Gui Clone 1,True : Print Gui Colour(1)
Gui Clone 1,False : Print Gui Colour(1) : Print Gui Screen Colours(1)`
    const out = runOut(src, bank).out.trim().split('\n').map(Number)
    expect(out[0]).toBe(expand12(0x0f0))
    expect(out[1]).toBe(expand12(0x0f0))
    expect(out[2]).toBe(16)
    expect(() => run('Gui Clone 9,True', bank)).toThrow(GUI_ERRORS[GUI_ERR.SCREEN_NOT_OPENED])
  })

  /**
   * `Accessories/RTGBob.Amos` writes the bank this reads: a twelve-byte
   * header, 32 palette quads, 32 empty longwords for the pens and one
   * (width, height, pointer) per image.
   */
  it('Gui Remap writes a pen into the bank for every colour', () => {
    const data = new Uint8Array(0x10c + 8 + 4)
    const dv = new DataView(data.buffer)
    dv.setUint32(0, 1) // one image
    dv.setUint32(4, 2) // two colours
    dv.setUint32(8, 4)
    // colour 0 black, colour 1 white, as (0, R, G, B)
    data.set([0, 0, 0, 0], 0xc)
    data.set([0, 0xff, 0xff, 0xff], 0x10)
    dv.setUint16(0x10c, 4)
    dv.setUint16(0x10e, 1)
    data.set([1, 1, 0, 0], 0x114)
    const put = (rt: Runtime): void => {
      rt.memBanks.set(6, { kind: 'memory', number: 6, memType: 1, name: 'RTG Bobs', flags: 0, data })
    }
    const r = runOut(`Gui Screen Open 1,320,200,4,0,"S" : Gui Rgb 1,255,255,255 : Gui Remap 6`, bank, put)
    const out = new DataView(data.buffer)
    // bit 31 is the marker $4ab0 sets on a FindColor answer
    expect(out.getUint32(0x8c) >>> 31).toBe(1)
    expect(out.getUint32(0x90) & 0x7fff_ffff).toBe(1)
    expect(r.rt.gui.rtgPlanes).toHaveLength(1)
    expect(r.rt.gui.rtgPlanes[0]!.width).toBe(4)
    expect(() => run('Gui Remap 9', bank)).toThrow(GUI_ERRORS[GUI_ERR.BANK_NOT_RESERVED])
  })
})

/**
 * The TCP group: eighteen keywords over bsdsocket.library, which this port
 * has no host capability for. What is testable is the answer every one of
 * them gives with no Internet stack, and the guide documents each.
 */
describe('the TCP group', () => {
  /** "-1 = Unable to alocate a socket", which is routine 227 failing to open */
  it('Tcp Open and Tcp Listen answer -1 with no stack', () => {
    expect(val(`Tcp Open("www.amiga.org",80,0)`)).toBe(-1)
    expect(val(`Tcp Listen(80,0)`)).toBe(-1)
  })

  /** routine 226 carries `moveq #$14,d7`, and six keywords test its result */
  it('the socket-taking keywords raise "Socket not opened!"', () => {
    const each = [
      'Print Tcp Send(0,0,0)',
      'Print Tcp Send$(0,"x")',
      'Print Tcp Read(0,0,0)',
      'Print Tcp Read$(0)',
      'Print Tcp Accept(0)',
      'Tcp Set 0,1',
      'Tcp Download 0 To "RAM:x",0',
    ]
    for (const src of each) {
      expect(() => run(src), src).toThrow(GUI_ERRORS[GUI_ERR.SOCKET_NOT_OPENED])
    }
    expect(GUI_ERRORS[GUI_ERR.SOCKET_NOT_OPENED]).toBe('Socket not opened!')
  })

  /** $452e is `beq` to the exit with d3 already zeroed, so this one does not */
  it('Tcp User is the one that answers 0 rather than raising', () => {
    expect(val('Tcp User(0)')).toBe(0)
    expect(val('Tcp Abort(0)')).toBe(0)
  })

  /** three words of state, and nothing has written any of them */
  it('the three readers answer zero', () => {
    const out = runOut('Print Tcp Socket : Print Tcp Total : Print Tcp Recvd : Print Tcp Error').out
    expect(out.trim().split('\n').map(Number)).toEqual([0, 0, 0, 0])
  })

  /** $46f8 calls through a null library base; the empty string is the answer */
  it('Tcp Host$ answers empty rather than reading address zero', () => {
    expect(runOut('Print "["+Tcp Host$+"]"').out.trim()).toBe('[]')
  })

  /**
   * $46d0 writes a NUL over the FOURTH byte of the buffer and parses the
   * first three, so the "200" of "200 HELLO mail.server.com" is right by
   * arithmetic rather than by parsing.
   */
  it('Tcp Response reads exactly three characters', () => {
    expect(val('Tcp Response')).toBe(0)
    const r = runOut('Print Tcp Response', undefined, (rt) => {
      rt.gui.tcpLine = '200 HELLO mail.server.com'
    })
    expect(Number(r.out.trim())).toBe(200)
    const four = runOut('Print Tcp Response', undefined, (rt) => {
      rt.gui.tcpLine = '4004 too long'
    })
    expect(Number(four.out.trim())).toBe(400)
  })

  /** two token arities: no argument closes them all, one closes that socket */
  it('Tcp Close takes a socket or nothing, and raises for neither', () => {
    expect(() => run('Tcp Close')).not.toThrow()
    expect(() => run('Tcp Close 3')).not.toThrow()
  })
})

/**
 * The 1.5 beta, over a program that used it.
 *
 * `AP_GUI/master.AMOS` and its `slave.AMOS` are two halves of an AMOS-to-ARexx
 * bridge by ahapp@top.monad.net, and extscan identifies their slot 24 as
 * gui-1.5b exactly, off the token ids. The bank is 1,140 bytes: four
 * CHECKBOXes, seven menu entries, and a header that stops at 44 with no
 * version word anywhere in it.
 */
const AP_GUI = '../amos-files/sources/aminet-dev-amos/files/AP_GUI/master.AMOS'

function betaBank(): Uint8Array | null {
  if (!haveCorpus()) return null
  try {
    const file = parseAmosFile(new Uint8Array(readFileSync(AP_GUI)))
    const b = file?.banks.find((x) => 'data' in x && (x as { number?: number }).number === 20)
    return b && 'data' in b ? (b.data as Uint8Array) : null
  } catch {
    return null
  }
}

describeWith('the 1.5 beta, over AP_GUI s own bank', betaBank(), (bank) => {
  const { run, runOut, val } = on('1.5b')

  it('reads only with the 44-byte header, and carries no version', () => {
    const beta = readGuiBank(bank, '1.5b')
    expect(beta).toHaveLength(1)
    expect(beta[0]!.version).toBe(0)
    expect(beta[0]!.gadgets.map((g) => g.kind)).toEqual([2, 2, 2, 2])
    expect(beta[0]!.title).toBe('Watch out what you do!')
    // the same bytes through 2.10's reader find a GUI whose window box is
    // eighteen bytes further on than it is
    expect(readGuiBank(bank, '2.10')[0]?.width).not.toBe(beta[0]!.width)
  })

  it('opens without the version check the later releases make', () => {
    const rt = run('Gui Open 1,1', bank)
    expect(rt.gui.windows.get(1)!.design.title).toBe('Watch out what you do!')
  })

  /** "-1 last window closed", where 1.61 and 2.10 both answer 3 */
  it('Gui Close answers -1 for the last window', () => {
    expect(Number(runOut('Gui Open 1,1 : Print Gui Close(1)', bank).out.trim())).toBe(GUI_CLOSE.LAST_BETA)
  })

  /** `moveq #$fd,d0` stands unless `$62` has a window list */
  it('Gui Wait answers -3 with nothing open, and pumps once a window is', () => {
    expect(val('Gui Wait', bank)).toBe(GUI_EVENT.UNUSED3)
    expect(Number(runOut('Gui Open 1,1 : Print Gui Wait', bank).out.trim())).toBe(GUI_EVENT.NOTHING)
  })

  /** the token is `gui circle` where the doc's heading says GUI ELLIPSE */
  it('Gui Circle draws the ellipse 2.10 renamed', () => {
    const rt = run('Gui Open 1,1 : Gui Gfx 0,1 : Gui Ink 3 : Gui Circle 40,40,20,10', bank)
    const rp = rt.gui.windows.get(1)!.rp
    expect(rp.point(60, 40)).toBe(3)
    expect(rp.point(40, 30)).toBe(3)
  })

  /** `EcCall AMOS_WB` with d1 zero, then the T_NoFlip word, then WBenchToFront */
  it('Gui Amiga locks AMOS and Gui Amos unlocks it', () => {
    expect(run('Gui Amiga', bank).noFlip).toBe(true)
    expect(run('Gui Amiga : Gui Amos', bank).noFlip).toBe(false)
  })

  /** three arguments, not 1.61's four: the pattern came with 1.6 */
  it('Gui Asl$ takes three arguments here', () => {
    expect(runOut('Print "["+Gui Asl$("t","","f")+"]"', bank).out.trim()).toBe('[]')
  })

  /** routine 54 returns AslRequest s own answer, and the spec says INTEGER */
  it('Gui Asl Font answers a number rather than a font name', () => {
    expect(val('Gui Asl Font', bank)).toBe(-1)
  })

  /**
   * Roll the window up to its title bar and back. The beta has no guard, so
   * a second iconify saves the rolled-up box over the real one and the window
   * can never be restored; 1.61 added the test that stops it.
   */
  it('Gui Iconify shrinks to the title bar and Gui Uniconify puts it back', () => {
    const rt = run('Gui Open 1,1 : Gui Iconify 1', bank)
    const w = rt.gui.windows.get(1)!
    expect(w.height).toBe(TITLE_HEIGHT)
    expect(rt.gui.iconBoxes.get(0)![3]).toBeGreaterThan(TITLE_HEIGHT)

    const back = run('Gui Open 1,1 : Gui Iconify 1 : Gui Uniconify 1', bank)
    expect(back.gui.windows.get(1)!.height).toBeGreaterThan(TITLE_HEIGHT)

    // twice, which is the bug the history records as fixed in 1.61
    const lost = run('Gui Open 1,1 : Gui Iconify 1 : Gui Iconify 1 : Gui Uniconify 1', bank)
    expect(lost.gui.windows.get(1)!.height).toBe(TITLE_HEIGHT)
  })

  /**
   * `bset.b d0,d1` makes the depth `1 << n`, so 3 asks for eight bitplanes
   * and 4 asks for sixteen and OpenScreen refuses it.
   */
  it('Gui Screen Open turns the depth into a bit mask', () => {
    expect(run('Gui Screen Open 1,320,200,3,0', bank).gui.screens.get(1)!.depth).toBe(8)
    expect(run('Gui Screen Open 1,320,200,2,0', bank).gui.screens.get(1)!.depth).toBe(4)
    expect(run('Gui Screen Open 1,320,200,4,0', bank).gui.screens.has(1)).toBe(false)
  })
})

/**
 * What 1.61 spells differently, over GuiDemo's own bank.
 *
 * The four scale functions and `Gui Len` each lost an argument between this
 * release and 2.10, and `Gui Amiga` gained one. A listing written for either
 * release and parsed against the other runs off the end of its own arguments,
 * which is why the release has to reach the handlers at all.
 */
describeWith('what 1.61 spells differently', demoBank(), (bank) => {
  const { run, val } = on('1.6x')

  it('opens a converter-20 bank that 2.10 would refuse', () => {
    expect(readGuiBank(bank, '1.6x')[0]!.version).toBe(20)
    expect(run('Gui Open 1,1', bank).gui.windows.has(1)).toBe(true)
    const later = on('2.10')
    expect(() => later.run('Gui Open 1,1', bank)).toThrow(GUI_ERRORS[GUI_ERR.WRONG_BANK_VERSION])
  })

  /** and the message names 1.63, not 2.3 */
  it('names its own converter in the version error', () => {
    expect(GUI_ERRORS_161[GUI_ERR.WRONG_BANK_VERSION]).toBe('Wrong GUI bank version. Use the GUI converter 1.63')
    expect(GUI_ERRORS_161[GUI_ERR.CHANNEL_NOT_OPENED]).toBe('Channel not opened!')
    expect(GUI_ERRORS_161).toHaveLength(24)
    expect(GUI_ERRORS_15B[0]).toBe('AMIGA RULEZ!')
    expect(GUI_ERRORS_15B).toHaveLength(14)
  })

  /** `=GUI SX(x)`, one argument, and the borders come from the extension */
  it('Gui Sx and Gui Sy take one argument', () => {
    expect(val('Gui Sx(4)', bank)).toBe(4)
    expect(val('Gui Sy(10)', bank)).toBe(TITLE_HEIGHT)
    expect(val('Gui Sw(64)', bank)).toBe(64)
    expect(val('Gui Sh(64)', bank)).toBe(64)
  })

  /** `=GUI LEN(text$)` with no window to measure against */
  it('Gui Len takes one argument', () => {
    expect(val('Gui Len("AMOS")', bank)).toBe(4 * TOPAZ_SIZE)
  })

  /** `GUI AMIGA 0` and `GUI AMIGA 1` do the same three things under an interpreter */
  it('Gui Amiga takes a mode here, and both modes do the same', () => {
    for (const mode of [0, 1]) expect(run(`Gui Amiga ${mode}`, bank).noFlip, `mode ${mode}`).toBe(true)
  })

  /** `cmp.w $a(a2),d0 / beq` at $161c, the fix the history dates to 1.61 */
  it('Gui Iconify refuses to iconify an already iconified window', () => {
    const rt = run('Gui Open 1,1 : Gui Iconify 1 : Gui Iconify 1 : Gui Uniconify 1', bank)
    expect(rt.gui.windows.get(1)!.height).toBeGreaterThan(TITLE_HEIGHT)
  })

  /** the beta's -3 is gone: 1.61's pump answers -7 the way 2.10's does */
  it('Gui Wait answers -7 with nothing open', () => {
    expect(val('Gui Wait', bank)).toBe(GUI_EVENT.NOTHING)
  })
})

/**
 * 1.61's TCP group, which is AmigaDOS and not sockets.
 *
 * Every one of the twenty-one keywords works on a file handle: `Tcp Open`
 * prepends `TCP:` to the name and `Tcp F Open` does not, and both then call
 * dos Open with MODE_READWRITE. GuiNet.Amos, the demo shipped with 1.62, is the
 * worked example. Its `AMINET=Tcp Open(1,"ftp.wustl.edu/80")` is AmiTCP's
 * handler syntax for a host and a port, and its own banner says "the TCP
 * commands are under development! This is only a preview!"
 */
describe('the 1.61 TCP group', () => {
  const { ext, exts: tcpExts } = on('1.6x')

  function withFs(src: string, seed?: string): { rt: Runtime; fs: AmigaFS; out: () => string } {
    let printed = ''
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    fs.currentDir = 'RAM:'
    if (seed !== undefined) fs.writeFile('RAM:in.txt', Uint8Array.from(seed, (c) => c.charCodeAt(0)))
    const rt = new Runtime(tokenize(src, table, tcpExts), table, {
      extensions: tcpExts,
      extBindings: new Map([[24, ext]]),
      maxSteps: 300_000,
      fs,
      onText: (t) => (printed += t),
    })
    mustFinish(rt.runHeadless(500))
    return { rt, fs, out: () => printed }
  }

  /**
   * The name goes to dos Open unchanged and a success is non-zero. The mode
   * is `move.l #$3ec,d2`, MODE_READWRITE, which opens an existing file for
   * update and creates one that is not there without truncating either --
   * which is how GuiNet.Amos can name `Ram:Recent.html` and expect to write
   * it. `Gui Get$` and `Gui Put` in the same library settle the numbering
   * between them: $3ed is MODE_OLDFILE and $3ee MODE_NEWFILE.
   */
  it('Tcp F Open opens a file, and creates one that is not there', () => {
    const r = withFs('Print Tcp F Open(1,"RAM:in.txt") : Print Tcp F Open(2,"RAM:new.txt")', 'hello')
    const [ok, made] = r.out().trim().split('\n').map(Number)
    expect(ok).not.toBe(0)
    expect(made).not.toBe(0)
    expect(r.rt.gui.channels.get(2)!.data).toHaveLength(0)
  })

  /** and the new one reaches the file store once it is written and closed */
  it('a file it created is there after Tcp Close', () => {
    const r = withFs('A=Tcp F Open(2,"RAM:new.txt") : A=Tcp Put$(2,"made") : Tcp Close')
    expect(String.fromCharCode(...r.fs.readFile('RAM:new.txt')!)).toBe('made')
  })

  /** `TCP:` is AmiTCP's handler and this port has no network to mount one on */
  it('Tcp Open answers 0, because nothing here answers TCP:', () => {
    expect(Number(withFs('Print Tcp Open(1,"ftp.wustl.edu/80")').out().trim())).toBe(0)
  })

  /** `moveq #$17,d7` before the name is even built */
  it('a channel that is already open is Channel already used!', () => {
    expect(() => withFs('A=Tcp F Open(1,"RAM:in.txt") : A=Tcp F Open(1,"RAM:in.txt")', 'x')).toThrow(
      GUI_ERRORS_161[GUI_ERR.CHANNEL_ALREADY_USED],
    )
  })

  /** `moveq #$14,d7` in routine 115, which is 1.61's wording of error 20 */
  it('a channel that was never opened is Channel not opened!', () => {
    expect(() => withFs('A=Tcp Put$(4,"x")')).toThrow(GUI_ERRORS_161[GUI_ERR.CHANNEL_NOT_OPENED])
  })

  /** dos Write, synchronous, and the answer is the byte count */
  it('Tcp Put$ writes and Tcp Close flushes it back', () => {
    const r = withFs('A=Tcp F Open(1,"RAM:in.txt") : Print Tcp Put$(1,"WXYZ") : Tcp Close', 'abcdefgh')
    expect(Number(r.out().trim())).toBe(4)
    expect(String.fromCharCode(...r.fs.readFile('RAM:in.txt')!)).toBe('WXYZefgh')
    expect(r.rt.gui.channels.size).toBe(0)
  })

  /**
   * `Tcp Read` posts an ACTION_READ packet and answers its id; the bytes and
   * the count arrive at the next `Gui Wait`, as -9 with `Tcp Code` holding
   * dp_Res1. That is GuiNet.Amos's whole loop.
   */
  it('Tcp Read is asynchronous: an id now, the -9 and the count after', () => {
    const r = withFs(
      'Reserve As Work 5,64 : B=Start(5) : A=Tcp F Open(1,"RAM:in.txt") : P=Tcp Read(1,B,4) : ' +
        'Print P : Print Tcp Count : Print Tcp Check : Print Gui Wait : ' +
        'Print Tcp Code : Print Tcp Channel : Print Tcp Type : Print Tcp Count : Print Peek$(B,4)',
      'abcdefgh',
    )
    const lines = r.out().trim().split('\n')
    expect(lines.slice(0, 8).map(Number)).toEqual([1, 1, -1, GUI_EVENT.TCP, 4, 1, 82, 0])
    expect(lines[8]).toBe('abcd')
  })

  /** ACTION_WRITE is the other dp_Type, and `Tcp Buffer` gives the address back */
  it('Tcp Send reports type 87 and the buffer it was given', () => {
    const r = withFs(
      'Reserve As Work 5,64 : B=Start(5) : A=Tcp F Open(1,"RAM:in.txt") : P=Tcp Send(1,B,4) : ' +
        'A=Gui Wait : Print Tcp Type : Print Tcp Buffer=B : Print Tcp Error',
      'abcdefgh',
    )
    expect(r.out().trim().split('\n').map(Number)).toEqual([87, -1, 0])
  })

  /** WaitForChar then Read, and an empty wait is `moveq #$fe,d0` */
  it('Tcp Get reads synchronously and answers -2 at the end of the data', () => {
    const r = withFs(
      'Reserve As Work 5,64 : B=Start(5) : A=Tcp F Open(1,"RAM:in.txt") : ' +
        'Print Tcp Get(1,B,3) : Print Peek$(B,3) : Print Tcp Get(1,B,3) : Print Tcp Get(1,B,3)',
      'abcde',
    )
    const lines = r.out().trim().split('\n')
    expect(Number(lines[0])).toBe(3)
    expect(lines[1]).toBe('abc')
    expect(Number(lines[2])).toBe(2)
    expect(Number(lines[3])).toBe(-2)
  })

  /** `Tcp Trash` eats the replies and leaves `$2b6` exactly where it was */
  it('Tcp Trash drops the replies without correcting Tcp Count', () => {
    const r = withFs(
      'Reserve As Work 5,64 : B=Start(5) : A=Tcp F Open(1,"RAM:in.txt") : A=Tcp Read(1,B,2) : ' +
        'A=Tcp Read(1,B,2) : Tcp Trash : Print Tcp Check : Print Tcp Count : Print Gui Wait',
      'abcdefgh',
    )
    expect(r.out().trim().split('\n').map(Number)).toEqual([0, 2, GUI_EVENT.NOTHING])
  })

  /** the boot writes twenty million microseconds, and `Tcp Limit` overwrites it */
  it('Tcp Limit sets the WaitForChar timeout, twenty seconds by default', () => {
    const r = withFs('Tcp Limit 500')
    expect(r.rt.gui.charLimit).toBe(500)
    expect(withFs('Rem').rt.gui.charLimit).toBe(TCP_LIMIT_DEFAULT)
  })

  /** two DateStamps, minutes and seconds only, and the same second is 0 */
  it('Tcp Time measures from Tcp Reset', () => {
    expect(Number(withFs('Tcp Reset : Print Tcp Time').out().trim())).toBe(0)
  })
})
