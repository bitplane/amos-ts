/**
 * gadtools, checked against the two files its numbers came from.
 *
 * The point of these is that they FAIL when someone edits a constant from
 * memory. `gadtools.ts` holds nineteen LVOs and fifty tags, none of which
 * this port can verify by running anything, so the check has to be that the
 * source documents still say what the file claims they say. Both are read
 * here rather than paraphrased.
 *
 * The `.fd` and the guide are in `fixtures/`, which is gitignored, so every
 * test that opens one skips when it is absent instead of failing. That is the
 * same bargain the rest of the corpus tests make: a machine without the
 * fixtures still runs the suite, and a machine with them catches the drift.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GADGIMAGE,
  GADGET,
  BARLABEL,
  DEFAULT_MENU_LAYOUT,
  GTBB_FRAMETYPE,
  GTBB_RECESSED,
  GT_TAG_BASE,
  GadTools,
  KIND,
  KINDS,
  LVO,
  MENUNULL,
  MENU_FLAG,
  NEWGADGET_SIZEOF,
  NEWMENU,
  NEWMENU_SIZEOF,
  NM,
  NOITEM,
  NOMENU,
  NOSUB,
  NUMDRIPENS,
  PEN,
  TAG,
  TAG_DONE,
  contentOf,
  drawBevelBox,
  findTag,
  frameOf,
  fullMenuNum,
  itemNum,
  menuNum,
  renderGadget,
  subNum,
} from './gadtools'
import type { DrawInfo, NewGadget, TagItem } from './gadtools'
import type { DiskFont } from './diskfont'
import { BitMap, RastPort } from './graphics'
import { rowBytesFor } from './planar'
import { FONT8 } from '../runtime/font.gen'

const root = join(fileURLToPath(new URL('../..', import.meta.url)))
const FD = join(root, 'fixtures/amigaos/FD-GUI210/gadtools_lib.fd')
const GUIDE = join(root, 'fixtures/extensions/os-devkit-1.61/docs/os_guides/os_gadtools_l.guide')

/**
 * A DrawInfo with distinguishable pens.
 *
 * Every pen is its own index, so a test that reads a pixel back gets a number
 * that names the ROLE it was drawn for rather than a colour that happens to
 * match. Twelve pens is the V2 array, which is what `screenpen_str` ends at.
 */
function dri(over: Partial<DrawInfo> = {}): DrawInfo {
  return { numPens: NUMDRIPENS, pens: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], depth: 2, ...over }
}

/** a RastPort deep enough to hold pen 11, so no pen aliases another */
function port(w = 64, h = 32): RastPort {
  const rp = new RastPort(new BitMap(w, h, 4, rowBytesFor(w)))
  rp.font = topaz()
  return rp
}

/**
 * A topaz-metric 8x8 font, so the render tests actually put glyphs down.
 *
 * The same shape `runtime.ts` builds for Intuition and for the same reason:
 * the real topaz is in Kickstart ROM and no ROM is held here, so the METRICS
 * are topaz's (8 wide, 8 tall, baseline 6) and only the letterforms differ.
 * A test comparing two renders needs ink on the page, and unmounted-font
 * renders would agree by drawing nothing.
 */
let topazCache: DiskFont | null = null
function topaz(): DiskFont {
  if (topazCache !== null) return topazCache
  const modulo = 256
  const charData = new Uint8Array(modulo * 8)
  const charLoc: Array<[number, number]> = []
  for (let ch = 0; ch < 256; ch++) {
    const g = FONT8[ch] ?? FONT8[32]!
    for (let row = 0; row < 8; row++) charData[row * modulo + ch] = g[row]!
    charLoc.push([ch * 8, 8])
  }
  topazCache = {
    name: 'topaz.font',
    ySize: 8,
    style: 0,
    flags: 0,
    xSize: 8,
    baseline: 6,
    loChar: 0,
    hiChar: 255,
    proportional: false,
    modulo,
    charData,
    charLoc,
    charSpace: null,
    charKern: null,
  }
  return topazCache
}

/** a NewGadget with the fields nothing under test cares about filled in */
function ng(over: Partial<NewGadget> = {}): NewGadget {
  return {
    leftEdge: 10,
    topEdge: 20,
    width: 100,
    height: 12,
    gadgetText: 'OK',
    gadgetID: 1,
    flags: 0,
    visualInfo: 0,
    ...over,
  }
}

describe('the jump table', () => {
  /**
   * Parses the `.fd` the way a linker would: `##bias` sets the first offset
   * and every public or private entry steps it by six. A private one still
   * consumes a slot, which is the whole reason GT_GetGadgetAttrsA is at -174
   * and not -138, and getting that wrong is the classic way to read an .fd.
   */
  it('every LVO is the one gadtools_lib.fd gives it', () => {
    if (!existsSync(FD)) return
    const text = readFileSync(FD, 'utf8')
    let bias = 0
    let at = 0
    const offsets = new Map<string, number>()
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (line.startsWith('##bias')) {
        bias = Number(line.split(/\s+/)[1])
        at = bias
        continue
      }
      if (line === '' || line.startsWith('*') || line.startsWith('##')) continue
      const name = line.match(/^(\w+)\s*\(/)?.[1]
      if (name === undefined) continue
      offsets.set(name, -at)
      at += 6
    }
    expect(bias, 'gadtools_lib.fd should still say ##bias 30').toBe(30)
    expect(offsets.size, 'nineteen public functions and six private slots').toBe(25)
    for (const [name, lvo] of Object.entries(LVO)) {
      expect(offsets.get(name), `${name} in the .fd`).toBe(lvo)
    }
  })

  it('names every public function in the .fd and nothing else', () => {
    if (!existsSync(FD)) return
    const text = readFileSync(FD, 'utf8')
    const publics: string[] = []
    let visible = true
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (line === '##public') visible = true
      else if (line === '##private') visible = false
      if (line === '' || line.startsWith('*') || line.startsWith('##')) continue
      const name = line.match(/^(\w+)\s*\(/)?.[1]
      if (name !== undefined && visible) publics.push(name)
    }
    expect(publics.length).toBe(19)
    expect(Object.keys(LVO).sort()).toEqual([...publics].sort())
  })
})

describe('the tags and kinds, against the OS DevKit guide', () => {
  /**
   * The guide prints each tag as a name on one line and `($8008xxxx)` on the
   * next, which is what this reads. A tag whose value is not in the gadtools
   * range is skipped, because the same sections document intuition's GA_ and
   * STRINGA_ tags and those deliberately live elsewhere.
   */
  function guideTags(): Map<string, number> {
    const text = readFileSync(GUIDE, 'utf8')
    const out = new Map<string, number>()
    const lines = text.split('\n')
    for (let i = 0; i < lines.length - 1; i++) {
      const name = lines[i]!.match(/^(GT[A-Z]{0,2}_\w+)\s{2,}/)?.[1]
      if (name === undefined) continue
      // "($8008000E),(ARR)" and the guide's one entry that lost its "($"
      const hex = lines[i + 1]!.match(/\$?([0-9A-Fa-f]{8})\)/)?.[1]
      if (hex === undefined) continue
      const value = Number.parseInt(hex, 16)
      if (out.has(name)) expect(out.get(name), `${name} printed twice`).toBe(value)
      out.set(name, value)
    }
    return out
  }

  it('every tag this port names has the guide s value', () => {
    if (!existsSync(GUIDE)) return
    const guide = guideTags()
    let checked = 0
    for (const [name, value] of Object.entries(TAG)) {
      const doc = guide.get(name)
      if (doc === undefined) continue
      expect(value, `${name} in the guide`).toBe(doc)
      checked++
    }
    // if this drops, the parse above stopped matching rather than the file
    // changing, which is the failure mode a bare loop hides
    expect(checked, 'tags cross-checked against the guide').toBeGreaterThanOrEqual(40)
  })

  /**
   * GTMX_Spacing is the one the guide prints as $8000803D where every other
   * gadtools tag is $8008xxxx. `gadtools.ts` keeps it as written and says
   * why; this pins the decision so that "fixing" it fails a test rather than
   * passing silently.
   */
  it('keeps the guide s GTMX_Spacing exactly as printed', () => {
    expect(TAG.GTMX_Spacing).toBe(0x8000_803d)
    expect(TAG.GTMX_Spacing & 0xffff_0000).not.toBe(GT_TAG_BASE & 0xffff_0000)
    if (!existsSync(GUIDE)) return
    expect(guideTags().get('GTMX_Spacing')).toBe(0x8000_803d)
  })

  /** "The TAGs of gadgets : 'CYCLE' TYPE=$7" is the guide stating both halves */
  it('every kind number is the one the guide heads its section with', () => {
    if (!existsSync(GUIDE)) return
    const text = readFileSync(GUIDE, 'utf8')
    const seen = new Map<string, number>()
    for (const m of text.matchAll(/gadgets\s*:?\s*'([A-Z]+)'\s*TYPE=\$([0-9A-Fa-f]+)/g)) {
      seen.set(m[1]!, Number.parseInt(m[2]!, 16))
    }
    expect(seen.size, 'the guide documents twelve kinds').toBe(12)
    for (const [name, value] of seen) {
      expect(KIND[name as keyof typeof KIND], `${name} TYPE=$${value.toString(16)}`).toBe(value)
    }
    // GENERIC is the one KIND holds that the guide has no section for: a
    // generic gadget has no kind-specific tags to document
    expect(Object.keys(KIND).length).toBe(seen.size + 1)
  })

  it('leaves $a unused, as the guide s numbering does', () => {
    expect(KINDS).not.toContain(0xa)
    expect(KIND.SCROLLER).toBe(0x9)
    expect(KIND.SLIDER).toBe(0xb)
  })
})

describe('the struct sizes the GUI binaries state', () => {
  /**
   * `gui-1.61` $23c6 is `moveq #$1e,d0` into CopyMem, which is the binary
   * saying sizeof(struct NewGadget) without a header in the room. The field
   * offsets add up to the same 30: four words, a pointer, a pointer, a word,
   * then three longwords.
   */
  it('NewGadget is thirty bytes and its fields fill them', () => {
    expect(NEWGADGET_SIZEOF).toBe(30)
    const words = 4 * 2 // LeftEdge TopEdge Width Height
    const gadgetText = 4
    const textAttr = 4
    const gadgetID = 2
    const rest = 3 * 4 // Flags VisualInfo UserData
    expect(words + gadgetText + textAttr + gadgetID + rest).toBe(NEWGADGET_SIZEOF)
  })

  /** from gui-1.61 $2472, $247e and $2482 */
  it('holds the three Gadget offsets that binary writes', () => {
    expect(GADGET.Flags).toBe(0x0c)
    expect(GADGET.GadgetRender).toBe(0x12)
    expect(GADGET.SelectRender).toBe(0x16)
    expect(GADGIMAGE).toBe(0x4)
  })
})

describe('VisualInfo', () => {
  it('hands out an address and answers to it', () => {
    const gt = new GadTools()
    const vi = gt.getVisualInfo(12, dri())
    expect(vi.address).toBeGreaterThan(0)
    expect(gt.visualInfo(vi.address)).toBe(vi)
    expect(vi.screenSlot).toBe(12)
    expect(vi.drawInfo.depth).toBe(2)
  })

  it('forgets it after FreeVisualInfo, and never reuses the address', () => {
    const gt = new GadTools()
    const a = gt.getVisualInfo(12, dri())
    gt.freeVisualInfo(a.address)
    expect(gt.visualInfo(a.address)).toBeNull()
    const b = gt.getVisualInfo(12, dri())
    expect(b.address).not.toBe(a.address)
  })

  it('shrugs at an address it never issued', () => {
    const gt = new GadTools()
    expect(gt.visualInfo(0x1234)).toBeNull()
    expect(() => gt.freeVisualInfo(0x1234)).not.toThrow()
  })
})

describe('the gadget list', () => {
  it('CreateContext heads a chain the gadgets hang off', () => {
    const gt = new GadTools()
    const ctx = gt.createContext()
    const a = gt.createGadget(KIND.BUTTON, ctx, ng({ gadgetID: 1 }))!
    const b = gt.createGadget(KIND.CHECKBOX, a, ng({ gadgetID: 2 }))!
    expect(gt.chain(ctx).map((g) => g.id)).toEqual([0, 1, 2])
    expect(gt.chain(ctx)[2]).toBe(b)
  })

  /**
   * gadtools returns NULL and the caller stops, which is what `gui-1.61` does
   * at $245e: `tst.l d0 / beq.w $27ce` straight out of its build loop.
   */
  it('refuses to build on a freed gadget', () => {
    const gt = new GadTools()
    const ctx = gt.createContext()
    gt.freeGadgets(ctx)
    expect(gt.createGadget(KIND.BUTTON, ctx, ng())).toBeNull()
  })

  it('refuses a NewGadget naming a VisualInfo it never issued', () => {
    const gt = new GadTools()
    const ctx = gt.createContext()
    expect(gt.createGadget(KIND.BUTTON, ctx, ng({ visualInfo: 0xdead }))).toBeNull()
  })

  it('accepts a VisualInfo it did issue, and refuses it once freed', () => {
    const gt = new GadTools()
    const vi = gt.getVisualInfo(12, dri())
    const ctx = gt.createContext()
    expect(gt.createGadget(KIND.BUTTON, ctx, ng({ visualInfo: vi.address }))).not.toBeNull()
    gt.freeVisualInfo(vi.address)
    expect(gt.createGadget(KIND.BUTTON, ctx, ng({ visualInfo: vi.address }))).toBeNull()
  })

  it('FreeGadgets walks the whole chain from the context', () => {
    const gt = new GadTools()
    const ctx = gt.createContext()
    const a = gt.createGadget(KIND.BUTTON, ctx, ng())!
    const b = gt.createGadget(KIND.SLIDER, a, ng())!
    expect(gt.freeGadgets(ctx)).toBe(3)
    expect(gt.gadget(a.address)).toBeNull()
    expect(gt.gadget(b.address)).toBeNull()
    // freeing twice frees nothing, rather than counting them again
    expect(gt.freeGadgets(ctx)).toBe(0)
  })
})

describe('the defaults each kind starts with', () => {
  /** all of these are the guide's own words, quoted in kindDefaults */
  it('gives a SLIDER 0 to 15 at level 0', () => {
    const gt = new GadTools()
    const g = gt.createGadget(KIND.SLIDER, null, ng())!
    expect([g.min, g.max, g.level]).toEqual([0, 15, 0])
  })

  it('gives a SCROLLER 2 visible where Top and Total are 0', () => {
    const gt = new GadTools()
    const g = gt.createGadget(KIND.SCROLLER, null, ng())!
    expect([g.top, g.total, g.visible]).toEqual([0, 0, 2])
  })

  it('gives a PALETTE one bitplane with pen 1 selected', () => {
    const gt = new GadTools()
    const g = gt.createGadget(KIND.PALETTE, null, ng())!
    expect([g.paletteDepth, g.color, g.colorOffset]).toEqual([1, 1, 0])
  })

  it('gives an INTEGER ten characters', () => {
    const gt = new GadTools()
    const g = gt.createGadget(KIND.INTEGER, null, ng())!
    expect([g.number, g.maxChars]).toEqual([0, 10])
  })

  it('leaves a BUTTON with no state of its own', () => {
    const gt = new GadTools()
    const g = gt.createGadget(KIND.BUTTON, null, ng())!
    expect(g.checked).toBeUndefined()
    expect(g.level).toBeUndefined()
    expect(g.labels).toBeUndefined()
  })
})

describe('tags', () => {
  it('reads a CYCLE s labels and active choice', () => {
    const gt = new GadTools()
    const labels = gt.listRef(['Lowres', 'Hires', 'Interlace'])
    const g = gt.createGadget(KIND.CYCLE, null, ng(), [
      { tag: TAG.GTCY_Labels, data: labels },
      { tag: TAG.GTCY_Active, data: 2 },
    ])!
    expect(g.labels).toEqual(['Lowres', 'Hires', 'Interlace'])
    expect(g.active).toBe(2)
  })

  it('reads a STRING s initial content', () => {
    const gt = new GadTools()
    const g = gt.createGadget(KIND.STRING, null, ng(), [
      { tag: TAG.GTST_String, data: gt.stringRef('RONNIE') },
      { tag: TAG.GTST_MaxChars, data: 32 },
    ])!
    expect(g.string).toBe('RONNIE')
    expect(g.maxChars).toBe(32)
  })

  /**
   * The behaviour that makes one tag list usable across a whole row of
   * gadgets: gadtools ignores what is not this kind's. A CYCLE handed
   * GTSL_Level keeps its own state and drops the slider's.
   */
  it('ignores a tag belonging to another kind', () => {
    const gt = new GadTools()
    const shared: TagItem[] = [
      { tag: TAG.GTCY_Active, data: 1 },
      { tag: TAG.GTSL_Level, data: 9 },
      { tag: TAG.GTCB_Checked, data: 1 },
    ]
    const cycle = gt.createGadget(KIND.CYCLE, null, ng(), shared)!
    const slider = gt.createGadget(KIND.SLIDER, null, ng(), shared)!
    const check = gt.createGadget(KIND.CHECKBOX, null, ng(), shared)!
    expect(cycle.active).toBe(1)
    expect(cycle.level).toBeUndefined()
    expect(slider.level).toBe(9)
    expect(slider.active).toBeUndefined()
    expect(check.checked).toBe(true)
  })

  it('stops at TAG_DONE, leaving what follows unread', () => {
    const gt = new GadTools()
    const g = gt.createGadget(KIND.SLIDER, null, ng(), [
      { tag: TAG.GTSL_Level, data: 4 },
      { tag: TAG_DONE, data: 0 },
      { tag: TAG.GTSL_Max, data: 99 },
    ])!
    expect(g.level).toBe(4)
    expect(g.max).toBe(15)
  })

  it('GT_SetGadgetAttrsA counts what it took and changes only that', () => {
    const gt = new GadTools()
    const g = gt.createGadget(KIND.SLIDER, null, ng())!
    const took = gt.setGadgetAttrs(g, [
      { tag: TAG.GTSL_Level, data: 7 },
      { tag: TAG.GTCY_Active, data: 3 },
      { tag: TAG.GTSL_Max, data: 20 },
    ])
    expect(took).toBe(2)
    expect(g.level).toBe(7)
    expect(g.max).toBe(20)
    expect(g.active).toBeUndefined()
  })

  it('sets nothing on a freed gadget', () => {
    const gt = new GadTools()
    const g = gt.createGadget(KIND.SLIDER, null, ng())!
    gt.freeGadgets(g)
    expect(gt.setGadgetAttrs(g, [{ tag: TAG.GTSL_Level, data: 7 }])).toBe(0)
    expect(g.level).toBe(0)
  })

  it('findTag answers the first match and the fallback otherwise', () => {
    const tags: TagItem[] = [
      { tag: TAG.GTSL_Min, data: 3 },
      { tag: TAG.GTSL_Min, data: 4 },
    ]
    expect(findTag(tags, TAG.GTSL_Min, -1)).toBe(3)
    expect(findTag(tags, TAG.GTSL_Max, -1)).toBe(-1)
    expect(findTag([{ tag: TAG_DONE, data: 0 }, ...tags], TAG.GTSL_Min, -1)).toBe(-1)
  })
})

describe('the pen array', () => {
  /**
   * `screenpen_str` prints each pen with its byte offset, every entry a word,
   * so the index is the offset halved. This restates that arithmetic rather
   * than the indices, which is the part that would be wrong if someone
   * miscounted.
   */
  it('indexes each pen at half its byte offset in the guide', () => {
    const guideOffsets: Array<[keyof typeof PEN, number]> = [
      ['DETAIL', 0x0000],
      ['BLOCK', 0x0002],
      ['TEXT', 0x0004],
      ['SHINE', 0x0006],
      ['SHADOW', 0x0008],
      ['FILL', 0x000a],
      ['FILLTEXT', 0x000c],
      ['BACKGROUND', 0x000e],
      ['HIGHLIGHTTEXT', 0x0010],
      ['BARDETAIL', 0x0012],
      ['BARBLOCK', 0x0014],
      ['BARTRIM', 0x0016],
    ]
    for (const [name, offset] of guideOffsets) expect(PEN[name], name).toBe(offset / 2)
    expect(NUMDRIPENS).toBe(guideOffsets.length)
  })

  /**
   * dri_NumPens is a real limit: a V1 DrawInfo stops at HIGHLIGHTTEXTPEN and
   * the three BAR pens are not in it. Reading past the end answers pen 0
   * rather than undefined.
   */
  it('clamps a pen past dri_NumPens to pen 0', () => {
    const rp = port(8, 4)
    // a V1 array: nine pens, so BARTRIM is off the end
    drawBevelBox(rp, 0, 0, 4, 4, { numPens: 9, pens: [7, 1, 2, 3, 4, 5, 6, 7, 8], depth: 2 })
    expect(rp.point(0, 0)).toBe(3)
    drawBevelBox(rp, 0, 0, 4, 4, { numPens: 2, pens: [7, 1], depth: 2 })
    expect(rp.point(0, 0)).toBe(7)
  })
})

describe('DrawBevelBoxA', () => {
  /** raised: shine along the top and left, shadow along the bottom and right */
  it('draws raised with shine above and shadow below', () => {
    const rp = port()
    drawBevelBox(rp, 4, 4, 10, 6, dri())
    expect(rp.point(4, 4)).toBe(PEN.SHINE)
    expect(rp.point(9, 4)).toBe(PEN.SHINE)
    expect(rp.point(4, 7)).toBe(PEN.SHINE)
    expect(rp.point(9, 9)).toBe(PEN.SHADOW)
    expect(rp.point(13, 6)).toBe(PEN.SHADOW)
  })

  /**
   * "If 'True' the colours are 'swaped' like a pushed button", which is the
   * one thing about this drawing that two manuals both state.
   */
  it('swaps the two colours when recessed', () => {
    const raised = port()
    const sunk = port()
    drawBevelBox(raised, 4, 4, 10, 6, dri())
    drawBevelBox(sunk, 4, 4, 10, 6, dri(), { recessed: true })
    for (const [x, y] of [
      [4, 4],
      [9, 4],
      [4, 7],
      [9, 9],
      [13, 6],
    ] as const) {
      const a = raised.point(x, y)
      const b = sunk.point(x, y)
      expect([a, b].sort()).toEqual([PEN.SHINE, PEN.SHADOW])
      expect(a).not.toBe(b)
    }
  })

  it('draws nothing for an empty box', () => {
    const rp = port()
    drawBevelBox(rp, 4, 4, 0, 6, dri())
    drawBevelBox(rp, 4, 4, 10, 0, dri())
    for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) expect(rp.point(x, y)).toBe(0)
  })

  /**
   * The tag-list entry point, which is what the GUI extensions call. Both
   * substitute their own VisualInfo into the caller's list first, so a list
   * naming a VisualInfo this instance never issued has to fail rather than
   * draw in pens from nowhere.
   */
  it('resolves GT_VisualInfo out of the tag list', () => {
    const gt = new GadTools()
    const vi = gt.getVisualInfo(12, dri())
    const rp = port()
    expect(gt.drawBevelBoxA(rp, 2, 2, 8, 8, [{ tag: TAG.GT_VisualInfo, data: vi.address }])).toBe(true)
    expect(rp.point(2, 2)).toBe(PEN.SHINE)
  })

  it('refuses a tag list with no VisualInfo, or a freed one', () => {
    const gt = new GadTools()
    const vi = gt.getVisualInfo(12, dri())
    const rp = port()
    expect(gt.drawBevelBoxA(rp, 2, 2, 8, 8, [])).toBe(false)
    gt.freeVisualInfo(vi.address)
    expect(gt.drawBevelBoxA(rp, 2, 2, 8, 8, [{ tag: TAG.GT_VisualInfo, data: vi.address }])).toBe(false)
    expect(rp.point(2, 2)).toBe(0)
  })

  it('takes GTBB_Recessed through the tag list', () => {
    const gt = new GadTools()
    const vi = gt.getVisualInfo(12, dri())
    const rp = port()
    gt.drawBevelBoxA(rp, 2, 2, 8, 8, [
      { tag: TAG.GT_VisualInfo, data: vi.address },
      { tag: GTBB_RECESSED, data: 1 },
    ])
    expect(rp.point(2, 2)).toBe(PEN.SHADOW)
  })

  /**
   * GTBB_FrameType is accepted and not acted on, because no document held
   * here gives its values. Asserted rather than left as a comment, so that
   * the day someone finds the values this test is what tells them where to
   * look.
   */
  it('records GTBB_FrameType without changing what it draws', () => {
    const a = port()
    const b = port()
    drawBevelBox(a, 2, 2, 8, 8, dri(), { frameType: 0 })
    drawBevelBox(b, 2, 2, 8, 8, dri(), { frameType: 2 })
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) expect(b.point(x, y)).toBe(a.point(x, y))
  })

  it('names the recessed and frame-type tags the binaries carry', () => {
    expect(GTBB_RECESSED).toBe(0x8008_0033)
    expect(GTBB_FRAMETYPE).toBe(0x8008_004d)
  })
})

describe('rendering a gadget', () => {
  function built(kind: number, over: Partial<NewGadget> = {}, tags: TagItem[] = []) {
    const gt = new GadTools()
    return gt.createGadget(kind as never, null, ng({ leftEdge: 2, topEdge: 2, width: 20, height: 10, ...over }), tags)!
  }

  /**
   * The one per-kind appearance any held document states: GTNM_Border and
   * GTTX_Border both promise "a 'RECESSED' rectancle", and without the border
   * there is no frame at all.
   */
  it('frames NUMBER and TEXT only when they ask for a border', () => {
    for (const kind of [KIND.NUMBER, KIND.TEXT]) {
      expect(frameOf(built(kind), false)).toBeNull()
      expect(frameOf(built(kind), true)).toBe('recessed')
    }
  })

  it('sinks the kinds that take typing and raises the controls', () => {
    expect(frameOf(built(KIND.STRING))).toBe('recessed')
    expect(frameOf(built(KIND.INTEGER))).toBe('recessed')
    expect(frameOf(built(KIND.LISTVIEW))).toBe('recessed')
    expect(frameOf(built(KIND.BUTTON))).toBe('raised')
    expect(frameOf(built(KIND.CHECKBOX))).toBe('raised')
    expect(frameOf(built(KIND.GENERIC))).toBeNull()
  })

  /**
   * ng_GadgetText is the LABEL and the contents are what the kind shows in
   * its own box. Keeping them apart is what makes GT_SetGadgetAttrsA useful:
   * the label is drawn once, the contents on every change.
   */
  it('shows each kind s own contents rather than its label', () => {
    const gt = new GadTools()
    const cycle = gt.createGadget(KIND.CYCLE, null, ng({ gadgetText: 'Mode' }), [
      { tag: TAG.GTCY_Labels, data: gt.listRef(['Lowres', 'Hires']) },
      { tag: TAG.GTCY_Active, data: 1 },
    ])!
    expect(cycle.text).toBe('Mode')
    expect(contentOf(cycle)).toBe('Hires')

    const str = gt.createGadget(KIND.STRING, null, ng({ gadgetText: 'Name' }), [
      { tag: TAG.GTST_String, data: gt.stringRef('RONNIE') },
    ])!
    expect(contentOf(str)).toBe('RONNIE')

    const num = gt.createGadget(KIND.NUMBER, null, ng({ gadgetText: 'Score' }), [{ tag: TAG.GTNM_Number, data: 1234 }])!
    expect(contentOf(num)).toBe('1234')

    // a BUTTON's label IS its contents, since it has nowhere else to put it
    expect(contentOf(gt.createGadget(KIND.BUTTON, null, ng({ gadgetText: 'OK' }))!)).toBe('OK')
    // and a kind whose interior is imagery shows no text at all
    expect(contentOf(gt.createGadget(KIND.PALETTE, null, ng())!)).toBe('')
  })

  it('paints the interior in BACKGROUNDPEN before the frame', () => {
    const rp = port()
    rp.rectFill(0, 0, 30, 20, 9)
    // PALETTE, because its interior is imagery rather than text and so the
    // whole inside should be background with nothing drawn over it
    renderGadget(rp, built(KIND.PALETTE), dri())
    expect(rp.point(2, 2)).toBe(PEN.SHINE)
    expect(rp.point(21, 11)).toBe(PEN.SHADOW)
    for (let y = 3; y < 11; y++) for (let x = 3; x < 21; x++) expect(rp.point(x, y)).toBe(PEN.BACKGROUND)
    // outside the gadget is untouched
    expect(rp.point(28, 18)).toBe(9)
  })

  it('draws a button s label inside its frame', () => {
    const rp = port()
    renderGadget(rp, built(KIND.BUTTON, { gadgetText: 'OK' }), dri())
    let ink = 0
    for (let y = 3; y < 11; y++) for (let x = 3; x < 21; x++) if (rp.point(x, y) === PEN.TEXT) ink++
    expect(ink, 'OK should put ink inside the box').toBeGreaterThan(10)
  })

  /**
   * The case that made the fill necessary: a shorter value drawn over a
   * longer one has to cover it, and GT_SetGadgetAttrsA is how that happens.
   */
  it('covers a longer value when a shorter one replaces it', () => {
    const gt = new GadTools()
    const g = gt.createGadget(KIND.NUMBER, null, ng({ leftEdge: 0, topEdge: 0, width: 60, height: 10 }), [
      { tag: TAG.GTNM_Number, data: 888_888 },
    ])!
    const inked = (rp: RastPort): number => {
      let n = 0
      for (let y = 1; y < 9; y++) for (let x = 1; x < 59; x++) if (rp.point(x, y) === PEN.TEXT) n++
      return n
    }

    // both renders go to the SAME port, which is the situation that matters:
    // the second has to cover what the first left behind
    const rp = port()
    renderGadget(rp, g, dri())
    const six = inked(rp)
    expect(six, 'six digits should have put ink down').toBeGreaterThan(20)

    gt.setGadgetAttrs(g, [{ tag: TAG.GTNM_Number, data: 1 }])
    renderGadget(rp, g, dri())
    const one = inked(rp)
    expect(one).toBeGreaterThan(0)
    expect(one, 'one digit should leave less ink than six').toBeLessThan(six / 3)

    // and it matches a clean render of the same gadget, so nothing survived
    const clean = port()
    renderGadget(clean, g, dri())
    for (let y = 1; y < 9; y++) for (let x = 1; x < 59; x++) expect(rp.point(x, y)).toBe(clean.point(x, y))
  })

  it('draws nothing for a freed or empty gadget', () => {
    const gt = new GadTools()
    const g = gt.createGadget(KIND.BUTTON, null, ng({ leftEdge: 2, topEdge: 2, width: 10, height: 10 }))!
    gt.freeGadgets(g)
    const rp = port()
    renderGadget(rp, g, dri())
    renderGadget(rp, built(KIND.BUTTON, { width: 0 }), dri())
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(rp.point(x, y)).toBe(0)
  })
})

describe('menus', () => {
  /** the strip every test below builds on: two titles, items, subs and a bar */
  function strip(gt = new GadTools()) {
    const s = gt.createMenus([
      { type: NM.TITLE, label: 'Project' },
      { type: NM.ITEM, label: 'Open', commKey: 'O' },
      { type: NM.ITEM, label: BARLABEL },
      { type: NM.ITEM, label: 'Quit', commKey: 'Q' },
      { type: NM.TITLE, label: 'Edit' },
      { type: NM.ITEM, label: 'Paste' },
      { type: NM.SUB, label: 'Text' },
      { type: NM.SUB, label: 'Graphics' },
      { type: NM.END, label: '' },
    ])!
    return { gt, s }
  }

  /**
   * The guide prints the type numbers in `_gmn Set`. NM_END is the one it
   * does not name, and `gui-1.61` supplies it: its walk at $2584 is
   * `tst.b d0 / beq`, so zero ends the array.
   */
  it('holds the type numbers the guide prints', () => {
    expect(NM.TITLE).toBe(0x1)
    expect(NM.ITEM).toBe(0x2)
    expect(NM.SUB).toBe(0x3)
    expect(NM.IMAGE).toBe(0x80)
    expect(NM.IM_ITEM).toBe(0x82)
    expect(NM.IM_SUB).toBe(0x83)
    expect(NM.END).toBe(0)
    // IM_ITEM and IM_SUB are the plain types with MENU_IMAGE set, which is
    // what lets createMenus strip the bit and treat them the same
    expect(NM.IM_ITEM).toBe(NM.ITEM | NM.IMAGE)
    expect(NM.IM_SUB).toBe(NM.SUB | NM.IMAGE)
  })

  /**
   * `lea $14(a0),a0` at gui-1.61 $25a6 steps from one nm_Label to the next,
   * so the entry is twenty bytes. The guide's `_gmn Set` argument order fills
   * exactly those twenty.
   */
  it('makes NewMenu twenty bytes, and its fields fill them', () => {
    expect(NEWMENU_SIZEOF).toBe(20)
    expect(NEWMENU.Type).toBe(0)
    expect(NEWMENU.Label).toBe(2)
    expect(NEWMENU.CommKey).toBe(6)
    // Type + pad, Label, CommKey, Flags, MutualExclude, UserData
    expect(1 + 1 + 4 + 4 + 2 + 4 + 4).toBe(NEWMENU_SIZEOF)
    expect(NEWMENU.UserData + 4).toBe(NEWMENU_SIZEOF)
  })

  /**
   * Read straight out of gui-1.61 $f64-$f80: mask $1f, then ror 5 and mask
   * $3f, then ror 11 and mask $1f.
   */
  it('packs a menu number five, six and five bits', () => {
    const n = fullMenuNum(3, 40, 17)
    expect(menuNum(n)).toBe(3)
    expect(itemNum(n)).toBe(40)
    expect(subNum(n)).toBe(17)
    // each field is exactly as wide as its mask
    expect(menuNum(fullMenuNum(NOMENU, 0, 0))).toBe(0x1f)
    expect(itemNum(fullMenuNum(0, NOITEM, 0))).toBe(0x3f)
    expect(subNum(fullMenuNum(0, 0, NOSUB))).toBe(0x1f)
    // and they do not bleed into each other
    expect(itemNum(fullMenuNum(NOMENU, 0, NOSUB))).toBe(0)
    expect(menuNum(fullMenuNum(0, NOITEM, NOSUB))).toBe(0)
    expect(5 + 6 + 5).toBe(16)
  })

  /** MENUNULL is what gui-1.61 $fca compares NextSelect against */
  it('treats MENUNULL as no selection', () => {
    expect(MENUNULL).toBe(0xffff)
    const { gt, s } = strip()
    expect(s.menus.length).toBe(2)
    expect(gt.itemAddress(s, MENUNULL)).toBeNull()
  })

  it('walks the flat array into a tree', () => {
    const { s } = strip()
    expect(s.menus.map((m) => m.label)).toEqual(['Project', 'Edit'])
    expect(s.menus[0]!.items.map((i) => i.label)).toEqual(['Open', BARLABEL, 'Quit'])
    expect(s.menus[1]!.items[0]!.subItems.map((i) => i.label)).toEqual(['Text', 'Graphics'])
  })

  /** "The 'BARLABEL' makes parties of Items count" */
  it('counts a BARLABEL as an item, so Quit is number two', () => {
    const { gt, s } = strip()
    expect(gt.itemAddress(s, fullMenuNum(0, 1, NOSUB))!.label).toBe(BARLABEL)
    expect(gt.itemAddress(s, fullMenuNum(0, 2, NOSUB))!.label).toBe('Quit')
    expect(s.menus[0]!.items[2]!.index).toBe(2)
  })

  it('stops at NM_END and ignores what follows', () => {
    const gt = new GadTools()
    const s = gt.createMenus([
      { type: NM.TITLE, label: 'One' },
      { type: NM.END, label: '' },
      { type: NM.TITLE, label: 'Never' },
    ])!
    expect(s.menus.map((m) => m.label)).toEqual(['One'])
  })

  it('treats IM_ITEM as an ITEM, since MENU_IMAGE only changes the label', () => {
    const gt = new GadTools()
    const s = gt.createMenus([
      { type: NM.TITLE, label: 'M' },
      { type: NM.IM_ITEM, label: 'Pic' },
      { type: NM.IM_SUB, label: 'Sub' },
    ])!
    expect(s.menus[0]!.items[0]!.label).toBe('Pic')
    expect(s.menus[0]!.items[0]!.subItems[0]!.label).toBe('Sub')
  })

  it('refuses an array with an item before any title', () => {
    const gt = new GadTools()
    expect(gt.createMenus([{ type: NM.ITEM, label: 'Orphan' }])).toBeNull()
    expect(
      gt.createMenus([
        { type: NM.TITLE, label: 'M' },
        { type: NM.SUB, label: 'Orphan' },
      ]),
    ).toBeNull()
    expect(gt.createMenus([{ type: 0x7f, label: 'Nonsense' }])).toBeNull()
  })

  it('lays the bar out left to right and drops each column from its title', () => {
    const { gt, s } = strip()
    const vi = gt.getVisualInfo(12, dri())
    expect(gt.layoutMenus(s, vi.address)).toBe(true)
    const [project, edit] = s.menus
    expect(project!.leftEdge).toBe(0)
    expect(edit!.leftEdge).toBe(project!.width)
    expect(project!.topEdge).toBe(0)
    // items drop below the bar, each under its own title
    expect(project!.items[0]!.topEdge).toBe(DEFAULT_MENU_LAYOUT.barHeight)
    expect(project!.items[0]!.leftEdge).toBe(project!.leftEdge)
    expect(edit!.items[0]!.leftEdge).toBe(edit!.leftEdge)
    // and a column is one width throughout
    const widths = new Set(project!.items.map((i) => i.width))
    expect(widths.size).toBe(1)
  })

  /** a separator is not a text row, so it does not get a text row's height */
  it('gives a BARLABEL less height than a labelled item', () => {
    const { gt, s } = strip()
    gt.layoutMenus(s, gt.getVisualInfo(12, dri()).address)
    const items = s.menus[0]!.items
    expect(items[1]!.height).toBe(DEFAULT_MENU_LAYOUT.barLabelHeight)
    expect(items[0]!.height).toBe(DEFAULT_MENU_LAYOUT.charHeight)
    // and the one below it starts where it ends
    expect(items[2]!.topEdge).toBe(items[1]!.topEdge + items[1]!.height)
  })

  it('sub-items hang off the right of their column', () => {
    const { gt, s } = strip()
    gt.layoutMenus(s, gt.getVisualInfo(12, dri()).address)
    const paste = s.menus[1]!.items[0]!
    expect(paste.subItems[0]!.leftEdge).toBe(paste.leftEdge + paste.width)
    expect(paste.subItems[0]!.topEdge).toBe(paste.topEdge)
    expect(paste.subItems[1]!.topEdge).toBe(paste.topEdge + paste.subItems[0]!.height)
  })

  it('fails to lay out with a VisualInfo it never issued, or a freed strip', () => {
    const { gt, s } = strip()
    expect(gt.layoutMenus(s, 0xdead)).toBe(false)
    expect(s.laidOut).toBe(false)
    const vi = gt.getVisualInfo(12, dri())
    gt.freeMenus(s)
    expect(gt.layoutMenus(s, vi.address)).toBe(false)
  })

  it('FreeMenus once, and the strip stops answering', () => {
    const { gt, s } = strip()
    expect(gt.menuStrip(s.address)).toBe(s)
    expect(gt.freeMenus(s)).toBe(true)
    expect(gt.freeMenus(s)).toBe(false)
    expect(gt.menuStrip(s.address)).toBeNull()
    expect(gt.itemAddress(s, fullMenuNum(0, 0, NOSUB))).toBeNull()
  })

  it('ItemAddress answers null for a field naming something absent', () => {
    const { gt, s } = strip()
    expect(gt.itemAddress(s, fullMenuNum(0, 0, NOSUB))!.label).toBe('Open')
    expect(gt.itemAddress(s, fullMenuNum(1, 0, 1))!.label).toBe('Graphics')
    expect(gt.itemAddress(s, fullMenuNum(9, 0, NOSUB))).toBeNull()
    expect(gt.itemAddress(s, fullMenuNum(0, 9, NOSUB))).toBeNull()
    expect(gt.itemAddress(s, fullMenuNum(0, 0, 4))).toBeNull()
  })

  it('reads the flags into the item, per the guide s _gmn Set list', () => {
    const gt = new GadTools()
    const s = gt.createMenus([
      { type: NM.TITLE, label: 'M', flags: MENU_FLAG.NM_MENUDISABLED },
      { type: NM.ITEM, label: 'On', flags: MENU_FLAG.CHECKIT | MENU_FLAG.CHECKED },
      { type: NM.ITEM, label: 'Off', flags: MENU_FLAG.CHECKIT },
      { type: NM.ITEM, label: 'Grey', flags: MENU_FLAG.NM_ITEMDISABLED },
    ])!
    expect(s.menus[0]!.disabled).toBe(true)
    expect(s.menus[0]!.items[0]!.checked).toBe(true)
    expect(s.menus[0]!.items[1]!.checked).toBe(false)
    expect(s.menus[0]!.items[2]!.disabled).toBe(true)
    // CHECKED without CHECKIT checks nothing: there is no checkmark to set
    const bare = gt.createMenus([
      { type: NM.TITLE, label: 'M' },
      { type: NM.ITEM, label: 'X', flags: MENU_FLAG.CHECKED },
    ])!
    expect(bare.menus[0]!.items[0]!.checked).toBe(false)
  })

  /**
   * The guide's own worked example, with its five items and its note that a
   * BARLABEL takes a number. Item_01 carries MUTEXCL = %01100, which clears
   * items 2 and 3 and leaves 0 and 4 alone.
   */
  it('clears the items a MutualExclude mask names', () => {
    const gt = new GadTools()
    const check = MENU_FLAG.CHECKIT | MENU_FLAG.CHECKED
    const s = gt.createMenus([
      { type: NM.TITLE, label: 'Menu' },
      { type: NM.ITEM, label: 'Item_00' },
      { type: NM.ITEM, label: 'Item_01', flags: check, mutualExclude: 0b01100 },
      { type: NM.ITEM, label: 'Item_02', flags: check, mutualExclude: 0b01010 },
      { type: NM.ITEM, label: 'Item_03', flags: check, mutualExclude: 0b00110 },
      { type: NM.ITEM, label: 'Item_04' },
    ])!
    const items = s.menus[0]!.items
    expect(items.map((i) => i.checked)).toEqual([false, true, true, true, false])
    gt.selectItem(s, fullMenuNum(0, 1, NOSUB))
    // 01100 names items 2 and 3; 0 and 4 were never CHECKIT anyway
    expect(items.map((i) => i.checked)).toEqual([false, true, false, false, false])
  })

  it('leaves a non-CHECKIT item alone and toggles only with MENUTOGGLE', () => {
    const gt = new GadTools()
    const s = gt.createMenus([
      { type: NM.TITLE, label: 'M' },
      { type: NM.ITEM, label: 'Plain' },
      { type: NM.ITEM, label: 'Sticky', flags: MENU_FLAG.CHECKIT },
      { type: NM.ITEM, label: 'Toggle', flags: MENU_FLAG.CHECKIT | MENU_FLAG.MENUTOGGLE },
    ])!
    const [plain, sticky, toggle] = s.menus[0]!.items
    gt.selectItem(s, fullMenuNum(0, 0, NOSUB))
    expect(plain!.checked).toBe(false)
    gt.selectItem(s, fullMenuNum(0, 1, NOSUB))
    gt.selectItem(s, fullMenuNum(0, 1, NOSUB))
    expect(sticky!.checked, 'without MENUTOGGLE, picking again keeps it set').toBe(true)
    gt.selectItem(s, fullMenuNum(0, 2, NOSUB))
    expect(toggle!.checked).toBe(true)
    gt.selectItem(s, fullMenuNum(0, 2, NOSUB))
    expect(toggle!.checked, 'MENUTOGGLE clears it on the second pick').toBe(false)
  })

  /** exclusion is within one list: a sub-item's mask names its siblings */
  it('excludes among sub-items rather than reaching up to the items', () => {
    const gt = new GadTools()
    const check = MENU_FLAG.CHECKIT | MENU_FLAG.CHECKED
    const s = gt.createMenus([
      { type: NM.TITLE, label: 'M' },
      { type: NM.ITEM, label: 'Parent', flags: check, mutualExclude: 0b11 },
      { type: NM.SUB, label: 'A', flags: check, mutualExclude: 0b10 },
      { type: NM.SUB, label: 'B', flags: check },
    ])!
    const parent = s.menus[0]!.items[0]!
    gt.selectItem(s, fullMenuNum(0, 0, 0))
    expect(parent.subItems[1]!.checked).toBe(false)
    expect(parent.checked, 'the parent is not its own sub-item s sibling').toBe(true)
  })
})

describe('the per-kind tag table in gui-1.61', () => {
  /**
   * At $e66 of the code hunk sits fifteen entries, one per kind 0 to $e, each
   * a count word followed by that many longword tags. It is the list of tags
   * GUI 1.61 reads back OUT of a gadget, and it is the strongest single piece
   * of evidence in this file: the kind numbering, the kind-to-tag pairing and
   * the reserved $a are all stated at once, by a binary, in a form that
   * cannot be read two ways.
   *
   * A tag list found by walking a table cannot be confused with an asl one
   * the way a whole-file scan can, which is exactly the mistake this replaced.
   */
  const TABLE_AT = 0xe66

  function table(bytes: Buffer): Map<number, number[]> {
    const out = new Map<number, number[]>()
    let at = TABLE_AT
    for (let kind = 0; kind <= 0xe; kind++) {
      const count = bytes.readUInt16BE(at)
      at += 2
      const tags: number[] = []
      for (let i = 0; i < count; i++) {
        tags.push(bytes.readUInt32BE(at))
        at += 4
      }
      out.set(kind, tags)
    }
    return out
  }

  /** the hunk, since $e66 is an offset into it and not into the file */
  function hunk(): Buffer | null {
    const full = join(root, 'fixtures/extensions/gui-1.61/amospro_gui.lib')
    if (!existsSync(full)) return null
    // AmigaDOS hunk: HUNK_HEADER $3f3, then the first HUNK_CODE $3e9 whose
    // longword length precedes the body
    const bytes = readFileSync(full)
    for (let i = 0; i <= bytes.length - 8; i += 4) {
      if (bytes.readUInt32BE(i) === 0x0000_03e9) return bytes.subarray(i + 8)
    }
    return null
  }

  it('pairs every kind with the tags this port gives it', () => {
    const code = hunk()
    if (code === null) return
    const t = table(code)
    expect(t.get(KIND.CHECKBOX)).toEqual([TAG.GTCB_Checked])
    expect(t.get(KIND.INTEGER)).toEqual([TAG.GTIN_Number])
    expect(t.get(KIND.LISTVIEW)).toEqual([TAG.GTLV_Selected, TAG.GTLV_Labels, TAG.GTLV_Top])
    expect(t.get(KIND.MX)).toEqual([TAG.GTMX_Active])
    expect(t.get(KIND.NUMBER)).toEqual([TAG.GTNM_Number])
    expect(t.get(KIND.CYCLE)).toEqual([TAG.GTCY_Active])
    expect(t.get(KIND.PALETTE)).toEqual([TAG.GTPA_Color])
    expect(t.get(KIND.SCROLLER)).toEqual([TAG.GTSC_Top, TAG.GTSC_Total, TAG.GTSC_Visible])
    expect(t.get(KIND.SLIDER)).toEqual([TAG.GTSL_Level, TAG.GTSL_Min, TAG.GTSL_Max])
    expect(t.get(KIND.STRING)).toEqual([TAG.GTST_String])
    expect(t.get(KIND.TEXT)).toEqual([TAG.GTTX_Text])
  })

  /**
   * The kinds that read back nothing. GENERIC and BUTTON have no state, and
   * $a is the slot gadtools reserves between SCROLLER and SLIDER: the binary
   * leaves it empty rather than skipping it, which is what makes the table an
   * index by kind number rather than a list in kind order.
   */
  it('leaves GENERIC, BUTTON and the reserved $a empty', () => {
    const code = hunk()
    if (code === null) return
    const t = table(code)
    expect(t.get(KIND.GENERIC)).toEqual([])
    expect(t.get(KIND.BUTTON)).toEqual([])
    expect(t.get(0xa)).toEqual([])
  })

  it('names every tag in the table', () => {
    const code = hunk()
    if (code === null) return
    const known = new Set<number>(Object.values(TAG))
    const unknown = new Set<number>()
    for (const tags of table(code).values()) {
      for (const tag of tags) if (!known.has(tag)) unknown.add(tag)
    }
    expect([...unknown].map((v) => '$' + v.toString(16))).toEqual([])
  })
})

describe('the tag base gadtools shares with asl', () => {
  /**
   * The mistake this file made first: scanning a binary for $8008xxxx and
   * calling every hit a gadtools tag. asl numbers from the same base, both
   * GUI extensions open both libraries, and a value on its own says nothing
   * about which one it belongs to.
   *
   * Pinned as a test so the shortcut cannot come back. It reads the two
   * guides and asserts they really do collide, rather than restating the
   * collision from this file's own comment.
   */
  it('really does collide, in the guides own numbers', () => {
    const asl = join(root, 'fixtures/extensions/os-devkit-1.61/docs/os_guides/os_misc1.guide')
    if (!existsSync(asl) || !existsSync(GUIDE)) return
    const text = readFileSync(asl, 'utf8')
    const aslTags = new Map<string, number>()
    const lines = text.split('\n')
    for (let i = 0; i < lines.length - 1; i++) {
      const name = lines[i]!.match(/^(ASL[A-Z]{2}_\w+)/)?.[1]
      if (name === undefined) continue
      const hex = lines[i + 1]!.match(/\(\$([0-9A-Fa-f]{8})\)/)?.[1] ?? lines[i]!.match(/\(\$([0-9A-Fa-f]{8})\)/)?.[1]
      if (hex !== undefined) aslTags.set(name, Number.parseInt(hex, 16))
    }
    expect(aslTags.get('ASLFR_Screen'), 'the guide should still print ASLFR_Screen').toBe(TAG.GTSL_Level)
    expect(aslTags.get('ASLSM_DoWidth')).toBe(GT_TAG_BASE + 0x6d)
    expect(aslTags.get('ASLSM_DoOverscanType')).toBe(GT_TAG_BASE + 0x70)
    // and the four gui-1.61 hands to AllocAslRequest at $95e are those, not gadgets
    for (const t of [0x6d, 0x6e, 0x6f, 0x70]) {
      expect(Object.values(TAG), `$8008${t.toString(16)} is asl's, not gadtools'`).not.toContain(GT_TAG_BASE + t)
    }
  })
})
