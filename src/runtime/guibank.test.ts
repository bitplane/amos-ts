/**
 * The GUI bank, against GuiConv's own constants and against a real bank.
 *
 * The format was read out of `GuiConv.Amos`, so the structural tests restate
 * that program's numbers. The one that decides whether the reading is right
 * is the last group: `BootSelector.Amos` ships 926 bytes of real bank, and
 * every field has to land somewhere that makes sense as an interface.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  GUI_CONVERTER_VERSION,
  GUI_HEADER_SIZE,
  GUI_INFO_SIZE,
  NEWGADGET_SIZE,
  isConverterKind,
  readGui,
  readGuiBank,
} from './guibank'
import { AMOS_KIND_IMAGE, AMOS_KIND_NAMES, AMOS_KIND_NUM } from './guikinds'
import { KIND } from '../amiga/gadtools'
import { NEWGADGET_SIZEOF } from '../amiga/gadtools'
import { parseAmosFile } from '../loader/amosfile'
import { haveCorpus } from '../cli/corpus'
import { describeWith } from '../testing/fixture'

/** GUI2/Examples/BootSelector.Amos by Marco Vettorello, shipped with GUI 2.10 */
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

describe('the constants GuiConv writes', () => {
  it('are the ones its own source sets', () => {
    // HSIZE=70 and VERS=40, both plain assignments in _SAVE_BANK
    expect(GUI_HEADER_SIZE).toBe(70)
    expect(GUI_CONVERTER_VERSION).toBe(40)
    // Ssave 2,WORK To WORK+74 for the window's own header
    expect(GUI_INFO_SIZE).toBe(74)
  })

  /**
   * `Add _STRUCTS,30` writes gadtools' NewGadget, which is the SIXTH
   * independent statement of that struct's size in this port: the others are
   * gui-1.61's `moveq #$1e,d0` into CopyMem and the field arithmetic in
   * ../amiga/gadtools.ts.
   */
  it('writes gadtools own NewGadget, thirty bytes of it', () => {
    expect(NEWGADGET_SIZE).toBe(30)
    expect(NEWGADGET_SIZE).toBe(NEWGADGET_SIZEOF)
  })
})

describe('the kind table', () => {
  /** GuiConv's own constants, and they are gadtools' for everything real */
  it('agrees with gadtools wherever both name a kind', () => {
    for (const [name, kind] of [
      ['BUTTON', KIND.BUTTON],
      ['CHECKBOX', KIND.CHECKBOX],
      ['INTEGER', KIND.INTEGER],
      ['LISTVIEW', KIND.LISTVIEW],
      ['CYCLE', KIND.CYCLE],
      ['PALETTE', KIND.PALETTE],
      ['SCROLLER', KIND.SCROLLER],
      ['SLIDER', KIND.SLIDER],
      ['STRING', KIND.STRING],
      ['TEXT', KIND.TEXT],
    ] as const) {
      expect(AMOS_KIND_NAMES[kind as number], `kind ${kind as number}`).toBe(name)
    }
  })

  /** the empty slot GuiConv's Data statement keeps, which is gadtools' reserved $a */
  it('keeps index ten empty, as gadtools reserves it', () => {
    expect(AMOS_KIND_NAMES[10]).toBe('')
    expect(KIND.SCROLLER).toBe(9)
    expect(KIND.SLIDER).toBe(11)
  })

  /**
   * Two are the converter's own. Index 0 is IMAGE where gadtools has GENERIC,
   * because the editor cannot make an image gadget and a BUTTON with no text
   * stands in for one. NUM at 14 is past gadtools' set entirely.
   */
  it('marks the two kinds gadtools does not have', () => {
    expect(AMOS_KIND_NAMES[AMOS_KIND_IMAGE]).toBe('IMAGE')
    expect(KIND.GENERIC).toBe(0)
    expect(AMOS_KIND_NAMES[AMOS_KIND_NUM]).toBe('NUM')
    expect(AMOS_KIND_NAMES).toHaveLength(15)
    expect(isConverterKind(AMOS_KIND_IMAGE)).toBe(true)
    expect(isConverterKind(AMOS_KIND_NUM)).toBe(true)
    expect(isConverterKind(KIND.BUTTON)).toBe(false)
  })
})

describe('a bank that is not one', () => {
  it('answers null rather than inventing gadgets', () => {
    expect(readGui(new Uint8Array(0))).toBeNull()
    expect(readGui(new Uint8Array(200))).toBeNull()
    expect(readGuiBank(new Uint8Array(200))).toEqual([])
  })

  it('rejects a header whose sections run backwards', () => {
    const b = new Uint8Array(400)
    const put = (at: number, v: number): void => {
      b[at] = v >> 8
      b[at + 1] = v & 0xff
    }
    put(26, 200) // kind
    put(28, 100) // tags, before the kinds
    put(30, 300)
    put(32, 350)
    expect(readGui(b)).toBeNull()
  })
})

describeWith('BootSelector.Amos bank 20', exampleBank(), (bank) => {
  const guis = readGuiBank(bank)
  const gui = guis[0]!

  it('is 926 bytes holding one GUI, converter version 40', () => {
    expect(bank.length).toBe(926)
    expect(guis).toHaveLength(1)
    expect(gui.version).toBe(GUI_CONVERTER_VERSION)
    expect(gui.hasMenus).toBe(false)
  })

  it('has four gadgets: one TEXT and three IMAGE', () => {
    expect(gui.gadgets.map((g) => AMOS_KIND_NAMES[g.kind])).toEqual(['TEXT', 'IMAGE', 'IMAGE', 'IMAGE'])
    // GuiConv numbers gadget ids from zero, `GADID=NGAD-1`
    expect(gui.gadgets.map((g) => g.id)).toEqual([0, 1, 2, 3])
  })

  /**
   * The three image gadgets are 48 wide and sit at 0, 48 and 96, which is a
   * row of three icons and is what a boot selector looks like. The window is
   * 143 wide, one pixel less than the three of them.
   */
  it('lays the three images in a row across the window', () => {
    const images = gui.gadgets.filter((g) => g.kind === AMOS_KIND_IMAGE)
    expect(images.map((g) => g.leftEdge)).toEqual([0, 48, 96])
    expect(images.map((g) => `${g.width}x${g.height}`)).toEqual(['48x37', '48x37', '48x37'])
    expect(gui.height).toBe(37)
    expect(gui.width).toBe(143)
  })

  /**
   * The cross-check that settles the image-gadget reading. ng_UserData holds
   * the BOB number, and the guide says the next bob after it is the selected
   * state: "the image 4 will be the unselected image, and the image 5 will be
   * used as selected image". The three gadgets name bobs 1, 3 and 5, which
   * are the odd numbers, and the program's sprite bank holds exactly six
   * images. Three gadgets, two states each.
   */
  it('names bobs 1, 3 and 5, and the program ships six', () => {
    const images = gui.gadgets.filter((g) => g.kind === AMOS_KIND_IMAGE)
    expect(images.map((g) => g.userData)).toEqual([1, 3, 5])
    expect(gui.imageGadgets).toBe(3)
    const file = parseAmosFile(new Uint8Array(readFileSync(EXAMPLE)))!
    const sprites = file.banks.find((b) => 'sprites' in b) as { sprites?: unknown[] } | undefined
    expect(sprites?.sprites).toHaveLength(images.length * 2)
  })

  /** `_ADDLAB` writes an absent label as Chr$(2)+Chr$(0), which reads as "" */
  it('reads the label chain, empty entries included', () => {
    expect(gui.labels).toContain('Work Window')
    expect(gui.labels.filter((l) => l === '')).not.toHaveLength(0)
  })

  it('keeps the tag area for the keywords to read', () => {
    expect(gui.tags.length).toBeGreaterThan(0)
    // gadtools tags are longwords from $80080000, and this bank carries some
    const dv = new DataView(gui.tags.buffer, gui.tags.byteOffset, gui.tags.byteLength)
    let found = 0
    for (let i = 0; i + 4 <= gui.tags.length; i += 2) {
      const v = dv.getUint32(i)
      if (v >= 0x8008_0000 && v <= 0x8008_00ff) found++
    }
    expect(found).toBeGreaterThan(0)
  })
})

/**
 * The GUI 1.62 demo, which is the only bank held that carries every gadget
 * kind. `GuiExt162/GuiExtension/Demos/GuiDemo.Amos` off Aminet, 2,796 bytes
 * in bank 20, and its converter version is 20 rather than the 40 BootSelector
 * carries: an older writer the same reader handles.
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

describeWith('GuiDemo.Amos bank 20, every gadget kind', demoBank(), (bank) => {
  const gui = readGuiBank(bank)[0]!

  it('is an older converter the same reader takes', () => {
    expect(gui.version).toBe(20)
    expect(gui.gadgets).toHaveLength(23)
  })

  /**
   * The tag area splits into one list per gadget, each closed by a single
   * zero LONGWORD rather than a pair, and what follows the last gadget is the
   * WINDOW's own list. Its first tag is $80000064, Intuition's WA_Left, which
   * is how the tail was identified as a window rather than a 24th gadget.
   */
  it('splits the tags per gadget, and the window s follow', () => {
    expect(gui.gadgetTags).toHaveLength(23)
    expect(gui.windowTags.length).toBeGreaterThan(10)
    expect(gui.windowTags[0]!.tag).toBe(0x8000_0064)
    // the first gadget is the listview, and its GTLV_Labels data is zeroed
    const lv = gui.gadgetTags[0]!.find((t) => t.tag === 0x8008_0006)
    expect(lv).toBeDefined()
    expect(lv!.data).toBe(0)
  })

  /**
   * CYCLE and MX carry their items in the bank, and `userData` is the count
   * LESS ONE: `Loke USER,N-1`. Both gadgets store 7 and hold 8.
   */
  it('reads a CYCLE s and an MX s items, counted by userData', () => {
    const cycle = gui.gadgets.find((g) => g.kind === 7)!
    const mx = gui.gadgets.find((g) => g.kind === 5)!
    expect(cycle.userData).toBe(7)
    expect(cycle.items).toHaveLength(cycle.userData + 1)
    expect(cycle.items).toEqual(['Only', 'Amiga', 'Makes it', 'Possible', 'And', 'AMOS', 'so', 'EASY!!!'])
    expect(mx.userData).toBe(7)
    expect(mx.items).toEqual(['0', '1', '2', '3', '4', '5', '6', '7'])
  })

  /**
   * A LISTVIEW has NO items in the bank. GuiConv's payload test is on the
   * tags and GTLV_Labels is not among them, because a listview's list arrives
   * at run time from a program's array. Keying the payload off the KIND gives
   * it one phantom item stolen from the next gadget's name.
   */
  it('gives a LISTVIEW no items at all', () => {
    const lv = gui.gadgets.find((g) => g.kind === 4)!
    expect(lv.items).toEqual([])
    expect(lv.userData).toBe(0)
  })

  /**
   * The progress bar is the extension's own: "Create a TEXT gadget with the
   * Default string set to PBAR". The converter empties the label and sets
   * UserData to 1, so a PBAR is a TEXT with no text and userData 1.
   */
  it('finds the two progress bars by what the converter left behind', () => {
    const bars = gui.gadgets.filter((g) => g.progressBar)
    expect(bars).toHaveLength(2)
    for (const b of bars) {
      expect(b.kind).toBe(13)
      expect(b.userData).toBe(1)
      expect(b.text).toBe('')
    }
  })

  it('leaves every other gadget without items or a bar', () => {
    const plain = gui.gadgets.filter((g) => ![5, 7].includes(g.kind))
    for (const g of plain) expect(g.items, `kind ${g.kind}`).toEqual([])
    expect(gui.gadgets.filter((g) => g.progressBar)).toHaveLength(2)
  })
})
