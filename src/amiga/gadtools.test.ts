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
  GT_TAG_BASE,
  GadTools,
  KIND,
  KINDS,
  LVO,
  NEWGADGET_SIZEOF,
  TAG,
  TAG_DONE,
  findTag,
} from './gadtools'
import type { NewGadget, TagItem } from './gadtools'

const root = join(fileURLToPath(new URL('../..', import.meta.url)))
const FD = join(root, 'fixtures/amigaos/FD-GUI210/gadtools_lib.fd')
const GUIDE = join(root, 'fixtures/extensions/os-devkit-1.61/docs/os_guides/os_gadtools_l.guide')

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
    const vi = gt.getVisualInfo(12, 2)
    expect(vi.address).toBeGreaterThan(0)
    expect(gt.visualInfo(vi.address)).toBe(vi)
    expect(vi.screenSlot).toBe(12)
    expect(vi.depth).toBe(2)
  })

  it('forgets it after FreeVisualInfo, and never reuses the address', () => {
    const gt = new GadTools()
    const a = gt.getVisualInfo(12, 2)
    gt.freeVisualInfo(a.address)
    expect(gt.visualInfo(a.address)).toBeNull()
    const b = gt.getVisualInfo(12, 2)
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
    const vi = gt.getVisualInfo(12, 2)
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
