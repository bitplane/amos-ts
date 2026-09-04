/**
 * asl.library's file requester, driven the way a user drives it.
 *
 * The STRINGS are read out of `asl.library` itself: the WB 3.0 copy in the
 * corpus is an ordinary hunk binary carrying `asl 39.4 (18.8.92)` at $4e, and
 * every label below is quoted from it. The pixel layout is not sourced and
 * says so in ../amiga/asl.ts's header, so nothing here asserts a coordinate
 * --- the tests click through `layout`, which is the same arithmetic the
 * renderer uses, and check what comes back.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'
import { WB_SLOT } from '../amiga/intuition'
import { ASL_FONT_HEIGHT, ASL_TEXT, type Box } from '../amiga/asl'

const table = new TokenTable(CORE_TOKENS)
const ext = extensionById('int-1.0')!
const exts = new Map([[25, ext.table]])

const REQ = 'F$=Wb Asl Req("Pick","Load","Cancel",0,1,20,20,280,160)'

function boot(program: string, files: string[] = ['readme.txt', 'picture.iff', 'notes.doc', 'thing.info']): {
  rt: Runtime
  out: () => string
} {
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  fs.currentDir = 'DH0:'
  for (const n of files) fs.writeFile(`DH0:${n}`, new Uint8Array([1]))
  fs.writeFile('DH0:Pictures/inner.iff', new Uint8Array([1]))
  let out = ''
  const rt = new Runtime(tokenize(program, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[25, ext]]),
    maxSteps: 9_000_000,
    fs,
    onText: (t) => (out += t),
  })
  // ONE frame, not runHeadless: a headless run cancels the requester on the
  // very frame it opens, which is what `runHeadless` does to the file
  // selector too and for the same reason -- nobody is going to click it
  rt.frame()
  return { rt, out: () => out }
}

/** press and release the left button over a window-relative point */
function click(rt: Runtime, wx: number, wy: number): void {
  const st = rt.asl!
  const scr = rt.screens.get(WB_SLOT)!
  rt.input.mouseX = scr.screenToHardX(st.window.leftEdge + wx)
  rt.input.mouseY = st.window.topEdge + wy + scr.displayY - scr.offsetY
  rt.input.mouseK = 1
  rt.frame()
  rt.input.mouseK = 0
  rt.frame()
}

const mid = (b: Box): [number, number] => [b.x + (b.w >> 1), b.y + (b.h >> 1)]
/** the middle of list row `i`, in window coordinates */
const row = (rt: Runtime, i: number): [number, number] => [
  mid(rt.asl!.layout.list)[0],
  rt.asl!.layout.list.y + 2 + i * ASL_FONT_HEIGHT + 3,
]

/** let the blocked keyword resume and the Print run */
function finish(rt: Runtime): void {
  for (let i = 0; i < 4; i++) rt.frame()
}

describe('the ASL file requester', () => {
  const PROG = `Wb Asl Info 1\nWb Asl Dir "DH0:"\n${REQ}\nPrint "["+F$+"]"`

  /**
   * Drawers first and then files, each side by name --- and `.info` gone,
   * because `Wb Asl Info 1` is ASLFR_REJECTICONS and the author's comment on
   * it is "1= Dont Show Info Files".
   */
  it('lists drawers first, then files, with the icons rejected', () => {
    const b = boot(PROG)
    expect(b.rt.asl!.rows.map((r) => (r.dir ? `/${r.name}` : r.name))).toEqual([
      '/Pictures',
      'notes.doc',
      'picture.iff',
      'readme.txt',
    ])
  })

  /** ASLFR_REJECTICONS off leaves them in */
  it('without Wb Asl Info the icons are listed', () => {
    const b = boot(`Wb Asl Dir "DH0:"\n${REQ}\nPrint F$`)
    expect(b.rt.asl!.rows.map((r) => r.name)).toContain('thing.info')
  })

  /** a pattern filters FILES only, so a filtered view stays navigable */
  it('Wb Asl Pattern filters the files and leaves the drawers', () => {
    const b = boot(`Wb Asl Dir "DH0:"\nWb Asl Pattern "*.iff"\n${REQ}\nPrint F$`)
    expect(b.rt.asl!.rows.map((r) => r.name)).toEqual(['Pictures', 'picture.iff'])
  })

  /** click a name, then OK: the drawer and the file joined */
  it('a file and OK answer the whole path', () => {
    const b = boot(PROG)
    click(b.rt, ...row(b.rt, 2))
    expect(b.rt.asl!.setup.file).toBe('picture.iff')
    click(b.rt, ...mid(b.rt.asl!.layout.ok))
    finish(b.rt)
    expect(b.out().trim()).toBe('[DH0:picture.iff]')
  })

  /** `tst.l d0 / beq` on AslRequest's answer: a cancel is the empty string */
  it('Cancel answers nothing', () => {
    const b = boot(PROG)
    click(b.rt, ...mid(b.rt.asl!.layout.cancel))
    finish(b.rt)
    expect(b.out().trim()).toBe('[]')
  })

  /** and so does the window's close gadget */
  it('the close gadget is a cancel', () => {
    const b = boot(PROG)
    const w = b.rt.asl!.window
    expect(w.post(0x200 /* IDCMP_CLOSEWINDOW */, 0)).toBe(true)
    finish(b.rt)
    expect(b.out().trim()).toBe('[]')
  })

  /**
   * A single click on a drawer only selects it; the second one inside half a
   * second enters it. Entering FORGETS that click, or the next single click
   * on whatever lands at the same row would read as a double one and pick a
   * file the moment the drawer opened.
   */
  it('a drawer takes two clicks to enter, and entering forgets them', () => {
    const b = boot(PROG)
    click(b.rt, ...row(b.rt, 0))
    expect(b.rt.asl!.setup.dir).toBe('DH0:')
    click(b.rt, ...row(b.rt, 0))
    expect(b.rt.asl!.setup.dir).toBe('DH0:Pictures')
    expect(b.rt.asl!.rows.map((r) => r.name)).toEqual(['inner.iff'])
    // the row that is now at index 0 is a FILE, and one click must not take it
    click(b.rt, ...row(b.rt, 0))
    expect(b.rt.asl).not.toBeNull()
    expect(b.rt.asl!.setup.file).toBe('inner.iff')
    click(b.rt, ...mid(b.rt.asl!.layout.ok))
    finish(b.rt)
    expect(b.out().trim()).toBe('[DH0:Pictures/inner.iff]')
  })

  /** a double click on a FILE is the file and OK together */
  it('a double click on a file answers straight away', () => {
    const b = boot(PROG)
    click(b.rt, ...row(b.rt, 2))
    click(b.rt, ...row(b.rt, 2))
    finish(b.rt)
    expect(b.out().trim()).toBe('[DH0:picture.iff]')
  })

  /** Parent goes up, and the root of a volume has nowhere to go */
  it('Parent climbs, and stops at the volume', () => {
    const b = boot(PROG)
    click(b.rt, ...row(b.rt, 0))
    click(b.rt, ...row(b.rt, 0))
    expect(b.rt.asl!.setup.dir).toBe('DH0:Pictures')
    click(b.rt, ...mid(b.rt.asl!.layout.parent))
    expect(b.rt.asl!.setup.dir).toBe('DH0:')
    click(b.rt, ...mid(b.rt.asl!.layout.parent))
    expect(b.rt.asl!.setup.dir).toBe('DH0:')
  })

  /** Volumes swaps the list for the mounted names */
  it('Volumes lists the volumes', () => {
    const b = boot(PROG)
    click(b.rt, ...mid(b.rt.asl!.layout.volumes))
    expect(b.rt.asl!.rows.map((r) => r.name)).toEqual(['DH0:'])
  })

  /** OK with nothing picked answers nothing rather than the bare drawer */
  it('OK with no file answers nothing', () => {
    const b = boot(PROG)
    click(b.rt, ...mid(b.rt.asl!.layout.ok))
    finish(b.rt)
    expect(b.out().trim()).toBe('[]')
  })

  /**
   * ASL_Hail is the title, and `Select File` is what asl 39.4 puts there
   * when nothing passes one (the string at $5b82).
   */
  it('the title is ASL_Hail, or the library own default', () => {
    expect(boot(PROG).rt.asl!.window.title).toBe('Pick')
    const b = boot(`Wb Asl Dir "DH0:"\nF$=Wb Asl Req("","Ok","Cancel",0,1,20,20,280,160)\nPrint F$`)
    expect(b.rt.asl!.window.title).toBe(ASL_TEXT.fileTitle)
  })

  /**
   * ASLFR_DOPATTERNS is `Wb Asl Req`'s fifth argument, and it decides whether
   * the Pattern field is there at all.
   */
  it('the Pattern field is only there when asked for', () => {
    expect(boot(PROG).rt.asl!.layout.pattern).not.toBeNull()
    const b = boot(`Wb Asl Dir "DH0:"\nF$=Wb Asl Req("P","Ok","Cancel",0,0,20,20,280,160)\nPrint F$`)
    expect(b.rt.asl!.layout.pattern).toBeNull()
  })

  /**
   * `cmpi.l #$3,d0 / Rbge routine 95`, and routine 95 is `moveq #$17,d0 /
   * Rjmp L_Error` --- AMOS's own error 23 rather than one of Int's messages.
   */
  it('a request type of 3 or more is Illegal function call', () => {
    // it raises on the frame that reaches the keyword, which is the one
    // `boot` runs, so the throw is the boot itself
    expect(() => boot('F$=Wb Asl Req("P","Ok","Cancel",3,1,20,20,280,160)')).toThrow(/illegal function call/i)
    // negative is NOT out of range: `cmpi.l #$3,d0 / Rbge` is signed, so it
    // falls past the check onto the file arm at $2b48 with 0
    const b = boot(`Wb Asl Dir "DH0:"\nF$=Wb Asl Req("P","Ok","Cancel",-1,1,20,20,280,160)\nPrint F$`)
    expect(b.rt.asl).not.toBeNull()
  })

  /**
   * DEVIATION: the font and screen-mode requesters open nothing. The library
   * has both and this port has neither, and the routine's own shape makes it
   * harmless -- `cmpi.l #$0,d4 / bne` after AslRequest means only the FILE
   * type goes on to join a path, so the other two answer the empty string on
   * the machine as well.
   */
  it('the font and screen-mode types are not this requester', () => {
    for (const type of [1, 2]) {
      const b = boot(`F$=Wb Asl Req("P","Ok","Cancel",${type},1,20,20,280,160)\nPrint "["+F$+"]"`)
      expect(b.rt.asl).toBeNull()
      mustFinish(b.rt.runHeadless(200))
      expect(b.out().trim()).toBe('[]')
    }
  })

  /**
   * A headless run has nobody to click it, so `runHeadless` dismisses it the
   * way it dismisses the file selector. Without that, any program that opens
   * one never returns.
   */
  it('a headless run cancels it rather than hanging', () => {
    const b = boot(PROG)
    mustFinish(b.rt.runHeadless(500))
    expect(b.out().trim()).toBe('[]')
    expect(b.rt.asl).toBeNull()
  })
})

/**
 * asl.library's FONT requester.
 *
 * The strings are the library's own: the default title `Select Font` at
 * $5b24, and the 66-character preview line at $2fc, which is what the real
 * requester draws in the face you have picked. The pixel layout is modelled
 * and ../amiga/asl.ts's header says so, so nothing here asserts a coordinate.
 */
describe('the ASL font requester', () => {
  const REQ = 'F$=Wb Asl Req("Pick","Use","Cancel",1,0,20,20,300,180)'
  const PROG = `${REQ}\nPrint "["+F$+"]"`

  function boot(program: string): { rt: Runtime; out: () => string } {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    fs.currentDir = 'DH0:'
    let out = ''
    const rt = new Runtime(tokenize(program, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[25, ext]]),
      maxSteps: 9_000_000,
      fs,
      onText: (t) => (out += t),
    })
    rt.frame()
    return { rt, out: () => out }
  }

  function click(rt: Runtime, wx: number, wy: number): void {
    const st = rt.aslFont!
    const scr = rt.screens.get(WB_SLOT)!
    rt.input.mouseX = scr.screenToHardX(st.window.leftEdge + wx)
    rt.input.mouseY = st.window.topEdge + wy + scr.displayY - scr.offsetY
    rt.input.mouseK = 1
    rt.frame()
    rt.input.mouseK = 0
    rt.frame()
  }
  const mid = (b: Box): [number, number] => [b.x + (b.w >> 1), b.y + (b.h >> 1)]
  const nameRow = (rt: Runtime, i: number): [number, number] => [
    mid(rt.aslFont!.layout.names)[0],
    rt.aslFont!.layout.names.y + 2 + i * ASL_FONT_HEIGHT + 3,
  ]
  const sizeRow = (rt: Runtime, i: number): [number, number] => [
    mid(rt.aslFont!.layout.sizes)[0],
    rt.aslFont!.layout.sizes.y + 2 + i * ASL_FONT_HEIGHT + 3,
  ]

  /** every face AvailFonts finds, by distinct name */
  it('lists the faces once each and the sizes of the chosen one', () => {
    const b = boot(PROG)
    const st = b.rt.aslFont!
    expect(st.names).toContain('topaz.font')
    expect(st.names).toContain('times.font')
    // one row a NAME, however many sizes it has
    expect(new Set(st.names).size).toBe(st.names.length)
    // asl 39.4 seeds fo_Attr with topaz/8 before applying caller tags
    expect(st.setup.name).toBe('topaz.font')
    expect(st.sizes.length).toBeGreaterThan(0)
    expect(st.setup.size).toBe(8)
  })

  /** a new face has its own sizes, and the old index means nothing in them */
  it('picking a name resets the sizes to that face own', () => {
    const b = boot(PROG)
    const st = b.rt.aslFont!
    const times = st.names.indexOf('times.font')
    click(b.rt, ...nameRow(b.rt, times))
    expect(st.setup.name).toBe('times.font')
    expect(st.sizes).toEqual([11, 13, 15, 18, 24])
    expect(st.setup.size).toBe(11)
  })

  /**
   * `movea.l (a1),a0` and `move.w $4(a1),$160(a2)` off the requester's
   * fo_Attr at +8: ta_Name and ta_YSize, which is all GUI 2.10 reads.
   */
  it('OK answers the name and the size that were picked', () => {
    const b = boot(PROG)
    const st = b.rt.aslFont!
    click(b.rt, ...nameRow(b.rt, st.names.indexOf('times.font')))
    click(b.rt, ...sizeRow(b.rt, 3))
    expect(st.setup.size).toBe(18)
    click(b.rt, ...mid(st.layout.ok))
    expect([st.result, st.resultSize]).toEqual(['times.font', 18])
  })

  /** `Select Font` is what asl 39.4 titles it when nothing passes ASL_Hail */
  it('the title is ASL_Hail, or the library own default', () => {
    expect(boot(PROG).rt.aslFont!.window.title).toBe('Pick')
    const b = boot('F$=Wb Asl Req("","Use","Cancel",1,0,20,20,300,180)\nPrint F$')
    expect(b.rt.aslFont!.window.title).toBe(ASL_TEXT.fontTitle)
  })

  /**
   * Int 1.0 opens it and then throws the answer away. `cmpi.l #$0,d4 /
   * bne.w $2d7c` runs AFTER AslRequest, so only the FILE type goes on to
   * build a string --- the font requester really does open on the machine
   * (AllocAslRequest at $2b6c keeps a FontRequest), and really does answer
   * nothing.
   */
  it('Wb Asl Req opens it for type 1 and still answers nothing', () => {
    const b = boot(PROG)
    expect(b.rt.aslFont).not.toBeNull()
    const st = b.rt.aslFont!
    click(b.rt, ...nameRow(b.rt, st.names.indexOf('times.font')))
    click(b.rt, ...mid(st.layout.ok))
    for (let i = 0; i < 4; i++) b.rt.frame()
    expect(b.out().trim()).toBe('[]')
  })

  /** and a headless run dismisses it, as it does the file one */
  it('a headless run cancels it rather than hanging', () => {
    const b = boot(PROG)
    mustFinish(b.rt.runHeadless(500))
    expect(b.rt.aslFont).toBeNull()
    expect(b.out().trim()).toBe('[]')
  })
})
