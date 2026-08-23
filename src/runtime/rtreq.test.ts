/**
 * reqtools' EZRequest, driven the way a user drives it, through the three
 * Intuition Extension keywords that open one.
 *
 * The layout arithmetic is pinned in ../amiga/reqtools.test.ts against
 * `req.c`; nothing here asserts a coordinate. These click through `layout`,
 * which is the same arithmetic the renderer uses, and check the answer,
 * because the answer is what an AMOS program can see.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { WB_SLOT } from '../amiga/intuition'
import { RT_TEXT } from '../amiga/reqtools'
import { E, IEXT_ERRORS } from './intuition'
import { AmigaFS } from '../amiga/vfs'

const table = new TokenTable(CORE_TOKENS)
const ext = extensionById('intuition-1.3b')!
const exts = new Map([[14, ext.table]])

function boot(program: string): { rt: Runtime; out: () => string } {
  let out = ''
  const rt = new Runtime(tokenize(program, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[14, ext]]),
    maxSteps: 9_000_000,
    onText: (t) => (out += t),
  })
  // one frame, not runHeadless: a headless run answers the requester on the
  // frame it opens, which is the right thing for a program nobody is driving
  // and the wrong thing for a test that means to drive it
  rt.frame()
  return { rt, out: () => out }
}

/** press and release the left button over a window-relative point */
function click(rt: Runtime, wx: number, wy: number): void {
  const st = rt.rtReq!
  const scr = rt.screens.get(WB_SLOT)!
  rt.input.mouseX = scr.screenToHardX(st.window.leftEdge + wx)
  rt.input.mouseY = st.window.topEdge + wy + scr.displayY - scr.offsetY
  rt.input.mouseK = 1
  rt.frame()
  rt.input.mouseK = 0
  rt.frame()
}

/** click the middle of gadget `i`, counting from the left */
function press(rt: Runtime, i: number): void {
  const b = rt.rtReq!.layout.buttons[i]!.box
  click(rt, b.x + (b.w >> 1), b.y + (b.h >> 1))
}

/** type one character at the requester, optionally with the left Amiga held */
function type(rt: Runtime, ch: string, scan = 0, lAmiga = false): void {
  if (lAmiga) rt.input.keys.add(0x66)
  rt.pressKey(ch, scan)
  rt.frame()
  rt.frame()
  if (lAmiga) rt.input.keys.delete(0x66)
}

/** let the blocked keyword resume and the Print run */
function finish(rt: Runtime): void {
  for (let i = 0; i < 4; i++) rt.frame()
}

describe('Irequest Warning', () => {
  const PROG = 'A=Irequest Warning("Delete it?")\nPrint A'

  it('answers -1 for Ok and 0 for Cancel', () => {
    const ok = boot(PROG)
    press(ok.rt, 0)
    finish(ok.rt)
    expect(ok.out().trim()).toBe('-1')

    const no = boot(PROG)
    press(no.rt, 1)
    finish(no.rt)
    expect(no.out().trim()).toBe('0')
  })

  it('supplies the extension\'s own Ok and Cancel, not reqtools\'', () => {
    const b = boot(PROG)
    // `dc.b 0,2,"Ok"` at $5dbc and `dc.b 0,6,"Cancel"` at $5dc0. reqtools'
    // own default is ` _Ok |_Cancel`, which these are deliberately not
    expect(b.rt.rtReq!.layout.buttons.map((g) => g.text)).toEqual(['Ok', 'Cancel'])
    expect(RT_TEXT.okBarCancel).toBe(' _Ok |_Cancel')
  })

  it('takes both gadget texts when it is given four arguments', () => {
    const b = boot('A=Irequest Warning("Careful","Save it?","Save","Throw away")\nPrint A')
    expect(b.rt.rtReq!.layout.buttons.map((g) => g.text)).toEqual(['Save', 'Throw away'])
    expect(b.rt.rtReq!.window.title).toBe('Careful')
  })

  it('refuses an empty gadget text before it opens anything', () => {
    const rt = new Runtime(tokenize('A=Irequest Warning("Sure?","","Cancel")', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[14, ext]]),
      maxSteps: 9_000_000,
    })
    expect(() => rt.frame()).toThrow(IEXT_ERRORS[E.IFC])
    expect(rt.rtReq).toBeNull()
  })

  it('is cancelled by a headless run, which is what nobody clicking means', () => {
    const b = boot(PROG)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('0')
  })
})

describe('Irequest Message', () => {
  it('numbers the gadgets 1 to N from the left', () => {
    for (const [i, want] of [
      [0, '1'],
      [1, '2'],
      [2, '3'],
    ] as const) {
      const b = boot('A=Irequest Message("Pick one","Yes|No|Maybe")\nPrint A')
      expect(b.rt.rtReq!.layout.buttons.length).toBe(3)
      press(b.rt, i)
      finish(b.rt)
      expect(b.out().trim()).toBe(want)
    }
  })

  it('turns bars in the BODY into lines and bars in the GADGETS into gadgets', () => {
    const b = boot('A=Irequest Message("Line one|Line two","Ok")\nPrint A')
    expect(b.rt.rtReq!.layout.lines.map((l) => l.text)).toEqual(['Line one', 'Line two'])
    expect(b.rt.rtReq!.layout.buttons.length).toBe(1)
  })

  it('titles itself AMOS Request until something says otherwise', () => {
    expect(boot('A=Irequest Message("Hello","Ok")').rt.rtReq!.window.title).toBe('AMOS Request')
    expect(boot('Irequest Def Title "Setup"\nA=Irequest Message("Hello","Ok")').rt.rtReq!.window.title).toBe('Setup')
    expect(boot('A=Irequest Message("Own","Hello","Ok")').rt.rtReq!.window.title).toBe('Own')
  })

  /**
   * `$5f16 lea.l $42(a4),a2`. The empty string is meant to put "AMOS Request"
   * back and instead installs the address of the cell holding the pointer to
   * it, which reads as an empty string on any machine whose extension loaded
   * below 16MB.
   */
  it('is left with a BLANK title by Irequest Def Title ""', () => {
    const b = boot('Irequest Def Title ""\nA=Irequest Message("Hello","Ok")')
    expect(b.rt.rtReq!.window.title).toBe('')
  })
})

describe('Irequest Error', () => {
  it('is an instruction with one gadget and no answer', () => {
    const b = boot('Irequest Error "Disk full"\nPrint "after"')
    expect(b.rt.rtReq!.layout.buttons.map((g) => g.text)).toEqual(['Cancel'])
    press(b.rt, 0)
    finish(b.rt)
    expect(b.out().trim()).toBe('after')
  })

  it('takes a title and its own gadget when it is given three', () => {
    const b = boot('Irequest Error "Trouble","Disk full","Oh well"')
    expect(b.rt.rtReq!.window.title).toBe('Trouble')
    expect(b.rt.rtReq!.layout.buttons.map((g) => g.text)).toEqual(['Oh well'])
  })
})

describe('the keyboard shortcuts', () => {
  it('answers Y for the first gadget and N, R or ESC for the last', () => {
    for (const [key, want] of [
      ['y', '1'],
      ['n', '3'],
      ['r', '3'],
      ['\x1b', '3'],
    ] as const) {
      const b = boot('A=Irequest Message("Pick","Yes|No|Maybe")\nPrint A')
      type(b.rt, key)
      finish(b.rt)
      expect(b.out().trim(), key).toBe(want)
    }
  })

  it('presses the bold gadget on RETURN', () => {
    const b = boot('A=Irequest Message("Pick","Yes|No|Maybe")\nPrint A')
    expect(b.rt.rtReq!.layout.buttons.map((g) => g.bold)).toEqual([true, false, false])
    type(b.rt, '\r', 0x44)
    finish(b.rt)
    expect(b.out().trim()).toBe('1')
  })

  it('takes an underscored letter out of the label and makes it the key', () => {
    const b = boot('A=Irequest Message("Pick","Yes|No|Maybe")\nPrint A')
    // no RT_Underscore in the extension's tag list, so an underscore is a
    // character like any other and marks nothing
    expect(b.rt.rtReq!.layout.buttons.map((g) => g.key)).toEqual(['', '', ''])
  })

  /**
   * EZREQF_LAMIGAQUAL, which `Irequest Warning` and `Irequest Error` pass and
   * `Irequest Message` does not. The doc: "so it is harder to accidently
   * select something you will regret. Note that the RETURN and ESC key remain
   * active!"
   */
  it('needs the Amiga key held once LAMIGAQUAL is in force', () => {
    const plain = boot('A=Irequest Warning("Delete it?")\nPrint A')
    type(plain.rt, 'y')
    expect(plain.rt.rtReq!.done).toBe(false)
    type(plain.rt, 'v', 0, true)
    finish(plain.rt)
    expect(plain.out().trim()).toBe('-1')

    const esc = boot('A=Irequest Warning("Delete it?")\nPrint A')
    type(esc.rt, '\x1b')
    finish(esc.rt)
    expect(esc.out().trim()).toBe('0')
  })

  /**
   * `$87f2 lea.l $88c0(pc),a0 / $87f6 or.l d0,(a0)`. The flags are ORed into
   * a static tag list and nothing ever clears it, so one Irequest Warning
   * arms LAMIGAQUAL for every Irequest Message afterwards.
   */
  it('leaves LAMIGAQUAL set for every requester after the first Warning', () => {
    const b = boot('A=Irequest Warning("Delete it?")\nB=Irequest Message("Pick","Yes|No")\nPrint B')
    press(b.rt, 1)
    finish(b.rt)
    // the Message requester is up now, and a bare Y no longer answers it
    type(b.rt, 'y')
    expect(b.rt.rtReq!.done).toBe(false)
    type(b.rt, 'v', 0, true)
    finish(b.rt)
    expect(b.out().trim()).toBe('1')
  })
})

describe('=Reqtools Here', () => {
  it('is -1, because the library is here', () => {
    const b = boot('Print Reqtools Here')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('-1')
  })
})

/* --------------------------------------------------------------------------
 * The file requester
 * ----------------------------------------------------------------------- */

function bootFile(program: string, files: string[] = ['readme.txt', 'picture.iff', 'notes.doc', 'thing.info']): {
  rt: Runtime
  out: () => string
} {
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  fs.currentDir = 'DH0:'
  for (const n of files) fs.writeFile(`DH0:${n}`, new Uint8Array([1, 2, 3]))
  fs.writeFile('DH0:Pictures/inner.iff', new Uint8Array([1]))
  let out = ''
  const rt = new Runtime(tokenize(program, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[14, ext]]),
    maxSteps: 9_000_000,
    fs,
    onText: (t) => (out += t),
  })
  rt.frame()
  return { rt, out: () => out }
}

/** click a window-relative point on the file requester */
function fclick(rt: Runtime, wx: number, wy: number, shift = false): void {
  const st = rt.rtFile!
  const scr = rt.screens.get(WB_SLOT)!
  if (shift) rt.input.keys.add(0x60)
  rt.input.mouseX = scr.screenToHardX(st.window.leftEdge + wx)
  rt.input.mouseY = st.window.topEdge + wy + scr.displayY - scr.offsetY
  rt.input.mouseK = 1
  rt.frame()
  rt.input.mouseK = 0
  rt.frame()
  if (shift) rt.input.keys.delete(0x60)
}

/** the middle of list row `i` */
function frow(rt: Runtime, i: number, shift = false): void {
  const l = rt.rtFile!.layout
  fclick(rt, l.boxLeft + 4, l.boxTop + i * l.entryHeight + 2, shift)
}

/** press one of the four buttons: 0 Ok, 1 Volumes, 2 Parent, 3 Cancel */
function fbutton(rt: Runtime, i: number): void {
  const b = rt.rtFile!.layout.buttons[i]!.box
  fclick(rt, b.x + (b.w >> 1), b.y + (b.h >> 1))
}

describe('the reqtools file requester', () => {
  const PROG = 'F$=Irequest File$("Load")\nPrint "["+F$+"]"'

  /**
   * The order is the library's, and it is the opposite of asl's. With no
   * ReqTools.prefs the flags word is zero, so neither DIRSFIRST nor DIRSMIXED
   * is set and `SetFileDirMode` gives files id 0 and drawers id 1. The prefs
   * guide states the consequence: "If none of the 'Display Drawers First' or
   * 'Mix Files And Drawers' is checked files will be displayed before
   * drawers."
   */
  it('lists files first and drawers after, each sorted', () => {
    const b = bootFile(PROG)
    expect(b.rt.rtFile!.rows.map((e) => e.name)).toEqual([
      'notes.doc',
      'picture.iff',
      'readme.txt',
      'thing.info',
      'Pictures',
    ])
  })

  it('opens on the process directory and joins it to the name', () => {
    const b = bootFile(PROG)
    expect(b.rt.rtFile!.dir).toBe('DH0:')
    frow(b.rt, 1)
    expect(b.rt.rtFile!.file).toBe('picture.iff')
    fbutton(b.rt, 0)
    finish(b.rt)
    // `cmp.b #':',-1(a0) / beq .putfil`, so no second separator after DH0:
    expect(b.out().trim()).toBe('[DH0:picture.iff]')
  })

  it('enters a drawer on a SINGLE click, which is the GADGETUP arm', () => {
    const b = bootFile(PROG)
    frow(b.rt, 4)
    expect(b.rt.rtFile!.dir).toBe('DH0:Pictures')
    expect(b.rt.rtFile!.rows.map((e) => e.name)).toEqual(['inner.iff'])
    frow(b.rt, 0)
    fbutton(b.rt, 0)
    finish(b.rt)
    expect(b.out().trim()).toBe('[DH0:Pictures/inner.iff]')
  })

  it('picks a file on a double click without touching Ok', () => {
    const b = bootFile(PROG)
    frow(b.rt, 0)
    frow(b.rt, 0)
    finish(b.rt)
    expect(b.out().trim()).toBe('[DH0:notes.doc]')
  })

  it('answers the empty string for Cancel, and for Ok on an empty name', () => {
    const cancel = bootFile(PROG)
    fbutton(cancel.rt, 3)
    finish(cancel.rt)
    expect(cancel.out().trim()).toBe('[]')

    // `if (!nodir && (filename[0] || allowempty)) return TRUE; return NULL`
    const empty = bootFile(PROG)
    fbutton(empty.rt, 0)
    finish(empty.rt)
    expect(empty.out().trim()).toBe('[]')
  })

  it('takes Parent back up the tree and Volumes to the device list', () => {
    const b = bootFile(PROG)
    frow(b.rt, 4)
    expect(b.rt.rtFile!.dir).toBe('DH0:Pictures')
    fbutton(b.rt, 2)
    expect(b.rt.rtFile!.dir).toBe('DH0:')
    fbutton(b.rt, 1)
    expect(b.rt.rtFile!.volumes).toBe(true)
    expect(b.rt.rtFile!.rows.map((e) => e.name)).toContain('DH0:')
  })

  it('starts with the default name in the File gadget', () => {
    const b = bootFile('F$=Irequest File$("Load","#?","notes.doc")\nPrint "["+F$+"]"')
    expect(b.rt.rtFile!.file).toBe('notes.doc')
    fbutton(b.rt, 0)
    finish(b.rt)
    expect(b.out().trim()).toBe('[DH0:notes.doc]')
  })

  /**
   * `IsHidden` in filereqextra.c matches a `.info` name with its last five
   * characters cut off, so the pattern that keeps `picture.iff` keeps
   * `picture.iff.info` with it.
   */
  it('filters files by an AmigaDOS pattern and never drawers', () => {
    const b = bootFile('F$=Irequest File$("Load","#?.iff")\nPrint "["+F$+"]"', [
      'readme.txt',
      'picture.iff',
      'picture.iff.info',
    ])
    expect(b.rt.rtFile!.rows.map((e) => e.name)).toEqual(['picture.iff', 'picture.iff.info', 'Pictures'])
  })

  /**
   * `$54ea move.l a1,d0 / $54ec beq.b $54f0` skips the only assignment to a1
   * while a1 is zero, and `$54d6 suba.l a1,a1` made it zero. So the arm that
   * would set RTFI_Dir is unreachable and the whole string goes in as the
   * match pattern.
   */
  it('never splits a directory out of the pattern, so a path matches nothing', () => {
    const b = bootFile('F$=Irequest File$("Load","DH0:#?.iff")\nPrint "["+F$+"]"')
    expect(b.rt.rtFile!.dir).toBe('DH0:')
    expect(b.rt.rtFile!.pattern).toBe('DH0:#?.iff')
    expect(b.rt.rtFile!.rows.map((e) => e.name)).toEqual(['Pictures'])
  })

  it('leaves the last pattern standing when a later call omits one', () => {
    const b = bootFile(
      'F$=Irequest File$("One","#?.iff")\nG$=Irequest File$("Two")\nPrint "["+G$+"]"',
    )
    expect(b.rt.rtFile!.pattern).toBe('#?.iff')
    fbutton(b.rt, 3)
    finish(b.rt)
    // `.nopat` branches past the whole rtChangeReqAttrA
    expect(b.rt.rtFile!.pattern).toBe('#?.iff')
  })

  it('reopens where it was left, because nothing ever sets RTFI_Dir', () => {
    const b = bootFile('F$=Irequest File$("One")\nG$=Irequest File$("Two")\nPrint "["+G$+"]"')
    frow(b.rt, 4)
    expect(b.rt.rtFile!.dir).toBe('DH0:Pictures')
    fbutton(b.rt, 3)
    finish(b.rt)
    expect(b.rt.rtFile!.dir).toBe('DH0:Pictures')
  })
})

describe('Irequest File Multi$ and Irequest File Next$', () => {
  const PROG =
    'F$=Irequest File Multi$("Load")\nWhile F$<>""\nPrint "["+F$+"]"\nF$=Irequest File Next$\nWend'

  it('adds a top row of four gadgets that the single form has not', () => {
    const b = bootFile(PROG)
    expect(b.rt.rtFile!.layout.top.map((g) => g.text)).toEqual(['Selected:', 'All', 'Match..', 'Clear'])
  })

  it('answers the first name and hands out the rest one at a time', () => {
    const b = bootFile(PROG)
    frow(b.rt, 0)
    frow(b.rt, 2, true)
    expect(b.rt.rtFile!.rows.filter((e) => e.selected).length).toBe(2)
    fbutton(b.rt, 0)
    for (let i = 0; i < 12; i++) b.rt.frame()
    expect(b.out().trim().split('\n').map((s) => s.trim())).toEqual([
      '[DH0:notes.doc]',
      '[DH0:readme.txt]',
    ])
  })

  it('replaces a plain click\'s selection and adds to it with SHIFT', () => {
    const b = bootFile(PROG)
    frow(b.rt, 0)
    frow(b.rt, 1)
    expect(b.rt.rtFile!.rows.filter((e) => e.selected).map((e) => e.name)).toEqual(['picture.iff'])
    frow(b.rt, 2, true)
    expect(b.rt.rtFile!.rows.filter((e) => e.selected).map((e) => e.name)).toEqual([
      'picture.iff',
      'readme.txt',
    ])
  })

  it('selects everything with _All and drops it again with C_lear', () => {
    const b = bootFile(PROG)
    const all = b.rt.rtFile!.layout.top[1]!.box
    fclick(b.rt, all.x + (all.w >> 1), all.y + (all.h >> 1))
    expect(b.rt.rtFile!.rows.filter((e) => e.selected).length).toBe(4)
    const clr = b.rt.rtFile!.layout.top[3]!.box
    fclick(b.rt, clr.x + (clr.w >> 1), clr.y + (clr.h >> 1))
    expect(b.rt.rtFile!.rows.filter((e) => e.selected).length).toBe(0)
  })

  /** `rtGetStringA (glob->selpattern, 123, MSG_MATCH_WINTITLE, ...)` */
  it('puts a Match... string requester on top and selects with its answer', () => {
    const b = bootFile(PROG)
    const box = b.rt.rtFile!.layout.top[2]!.box
    fclick(b.rt, box.x + (box.w >> 1), box.y + (box.h >> 1))
    const sub = b.rt.rtFile!.sub
    expect(sub).not.toBeNull()
    expect(sub!.window.title).toBe(RT_TEXT.matchWinTitle)
    for (const ch of '#?.doc') {
      b.rt.pressKey(ch, 0)
      b.rt.frame()
    }
    b.rt.pressKey('\r', 0x44)
    b.rt.frame()
    b.rt.frame()
    expect(b.rt.rtFile!.sub).toBeNull()
    expect(b.rt.rtFile!.rows.filter((e) => e.selected).map((e) => e.name)).toEqual(['notes.doc'])
  })

  /**
   * `AllocSelectedFiles`: when the name in the File gadget is not among the
   * selected entries the whole list is thrown away and replaced by that one
   * name. Nico's comment on it is "This is the most intuitive behaviour!"
   */
  it('throws the list away when the File gadget names something outside it', () => {
    const b = bootFile(PROG)
    const all = b.rt.rtFile!.layout.top[1]!.box
    fclick(b.rt, all.x + (all.w >> 1), all.y + (all.h >> 1))
    b.rt.rtFile!.file = 'elsewhere.txt'
    fbutton(b.rt, 0)
    for (let i = 0; i < 12; i++) b.rt.frame()
    expect(b.out().trim()).toBe('[DH0:elsewhere.txt]')
  })

  it('is the empty string when nothing was picked', () => {
    const b = bootFile(PROG)
    fbutton(b.rt, 3)
    for (let i = 0; i < 8; i++) b.rt.frame()
    expect(b.out().trim()).toBe('')
  })
})

/* --------------------------------------------------------------------------
 * The font requester
 * ----------------------------------------------------------------------- */

/** click a window-relative point on the font requester */
function ntclick(rt: Runtime, wx: number, wy: number): void {
  const st = rt.rtFont!
  const scr = rt.screens.get(WB_SLOT)!
  rt.input.mouseX = scr.screenToHardX(st.window.leftEdge + wx)
  rt.input.mouseY = st.window.topEdge + wy + scr.displayY - scr.offsetY
  rt.input.mouseK = 1
  rt.frame()
  rt.input.mouseK = 0
  rt.frame()
}

/** click list row `i`, counting from the top of the visible list */
function ntrow(rt: Runtime, i: number): void {
  const l = rt.rtFont!.layout
  ntclick(rt, l.boxLeft + 4, l.boxTop + i * l.entryHeight + 2)
}

/** click Ok (0) or Cancel (1) */
function ntbutton(rt: Runtime, i: number): void {
  const b = rt.rtFont!.layout.buttons[i]!.box
  ntclick(rt, b.x + (b.w >> 1), b.y + (b.h >> 1))
}

describe('Irequest Font$', () => {
  const PROG = 'A$=Irequest Font$("Pick one")\nPrint "["+A$+"]"'

  it('lists every face by name and size, name first then size', () => {
    const b = boot(PROG)
    const rows = b.rt.rtFont!.rows
    // `AddEntry` files on the name case-insensitively and then on the size
    // ascending, and `filereqmain.c`:418 cuts `.font` off before it goes in
    expect(rows.every((r) => !/\.font$/i.test(r.name))).toBe(true)
    const names = rows.map((r) => r.name)
    expect([...names].sort()).toEqual(names)
    const topaz = rows.filter((r) => r.name === 'topaz').map((r) => r.size)
    expect(topaz).toEqual([8, 9])
  })

  it('answers name.font/size, which is the format the guide promises', () => {
    const b = boot(PROG)
    const i = b.rt.rtFont!.rows.findIndex((r) => r.name === 'topaz' && r.size === 9)
    b.rt.rtFont!.first = i
    ntrow(b.rt, 0)
    ntbutton(b.rt, 0)
    for (let k = 0; k < 8; k++) b.rt.frame()
    expect(b.out().trim()).toBe('[topaz.font/9]')
  })

  it('leaves on a double click without waiting for Ok', () => {
    const b = boot(PROG)
    const i = b.rt.rtFont!.rows.findIndex((r) => r.name === 'topaz' && r.size === 8)
    b.rt.rtFont!.first = i
    ntrow(b.rt, 0)
    ntrow(b.rt, 0)
    for (let k = 0; k < 8; k++) b.rt.frame()
    expect(b.out().trim()).toBe('[topaz.font/8]')
  })

  it('is the empty string for Cancel', () => {
    const b = boot(PROG)
    ntbutton(b.rt, 1)
    for (let k = 0; k < 8; k++) b.rt.frame()
    expect(b.out().trim()).toBe('[]')
  })

  it('is the empty string when Ok is pressed on an empty name gadget', () => {
    // `selfile = (APTR)(filename[0] != 0)` --- the font arm of `LeaveReq`
    // answers FALSE for an empty gadget however the requester was left
    const b = boot(PROG)
    expect(b.rt.rtFont!.name).toBe('')
    ntbutton(b.rt, 0)
    for (let k = 0; k < 8; k++) b.rt.frame()
    expect(b.out().trim()).toBe('[]')
  })

  it('opens on no face at all, and says so in the sample box', () => {
    // rtAllocRequestA MEMF_CLEARs the struct the extension keeps at
    // `$174(a4)`, so the first call has an empty name and a zero size and
    // OpenDiskFont cannot succeed
    const b = boot(PROG)
    const st = b.rt.rtFont!
    expect(st.name).toBe('')
    expect(st.size).toBe(0)
    expect(st.selected).toBe(-1)
    expect(RT_TEXT.couldntOpenFont).toBe("Couldn't open font!")
  })

  it('comes up where the last one was left', () => {
    const b = boot('A$=Irequest Font$\nB$=Irequest Font$\nPrint "["+B$+"]"')
    const i = b.rt.rtFont!.rows.findIndex((r) => r.name === 'topaz' && r.size === 9)
    b.rt.rtFont!.first = i
    ntrow(b.rt, 0)
    ntbutton(b.rt, 0)
    for (let k = 0; k < 6; k++) b.rt.frame()
    const second = b.rt.rtFont!
    expect(second.name).toBe('topaz.font')
    expect(second.size).toBe(9)
    expect(second.rows[second.selected]).toEqual({ name: 'topaz', size: 9 })
  })

  it('takes the title from its argument and comes up untitled without one', () => {
    expect(boot(PROG).rt.rtFont!.layout.title).toBe('Pick one')
    // routine 216 is `clr.l -(a3)` into routine 215, and a null title pointer
    // is `sub.l a3,a3` --- no title, not a default one
    expect(boot('A$=Irequest Font$\nPrint A$').rt.rtFont!.layout.title).toBe('')
  })

  it('cancels rather than hanging when nobody is there to click it', () => {
    const b = boot(PROG)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('[]')
  })
})

/** click at a window-relative point on the screenmode requester */
function stclick(rt: Runtime, wx: number, wy: number): void {
  const st = rt.rtScreen!
  const scr = rt.screens.get(WB_SLOT)!
  rt.input.mouseX = scr.screenToHardX(st.window.leftEdge + wx)
  rt.input.mouseY = st.window.topEdge + wy + scr.displayY - scr.offsetY
  rt.input.mouseK = 1
  rt.frame()
  rt.input.mouseK = 0
  rt.frame()
}

/** click mode row `i`, counting from the top of the visible list */
function strow(rt: Runtime, i: number): void {
  const l = rt.rtScreen!.layout
  stclick(rt, l.boxLeft + 4, l.boxTop + i * l.entryHeight + 2)
}

/** click Ok (0) or Cancel (1) */
function stbutton(rt: Runtime, i: number): void {
  const b = rt.rtScreen!.layout.buttons[i]!.box
  stclick(rt, b.x + (b.w >> 1), b.y + (b.h >> 1))
}

/** click the middle of a box the layout named */
function stbox(rt: Runtime, b: { x: number; y: number; w: number; h: number }): void {
  stclick(rt, b.x + (b.w >> 1), b.y + (b.h >> 1))
}

describe('Irequest Screen', () => {
  const PROG = 'A=Irequest Screen("Pick a mode")\nPrint "[";A;"]"'

  it('lists the installed modes by name, filed alphabetically', () => {
    const b = boot(PROG)
    const rows = b.rt.rtScreen!.rows
    // `FindEntry` files a SCRMODE on the name alone, so the driver's own walk
    // order comes out sorted; a mode row carries no size, because PrintEntry
    // fills `sizestr` for five entry types and SCRMODE is none of them
    expect(rows.map((r) => r.name)).toEqual([
      'PAL:High Res',
      'PAL:High Res Laced',
      'PAL:Low Res',
      'PAL:Low Res Laced',
      'PAL:Super-High Res',
      'PAL:Super-High Res Laced',
    ])
  })

  it('opens on the first mode, and on a width and height of zero', () => {
    // the cleared struct holds DisplayID 0, which the list walk drops as a
    // default-monitor id, so FindCurrentPos misses and the first entry is
    // taken. `usedefwidth = (glob->width == glob->defwidth)` was decided
    // against a defwidth of zero before that, so it stays FALSE
    const st = boot(PROG).rt.rtScreen!
    expect(st.selected).toBe(0)
    expect(st.rows[0]!.name).toBe('PAL:High Res')
    expect(st.width).toBe(0)
    expect(st.height).toBe(0)
    expect(st.useDefWidth).toBe(false)
    expect(st.useDefHeight).toBe(false)
  })

  it('fills the size in when a Default box is ticked', () => {
    const b = boot(PROG)
    const l = b.rt.rtScreen!.layout
    stbox(b.rt, l.defWidth!)
    stbox(b.rt, l.defHeight!)
    const st = b.rt.rtScreen!
    expect(st.useDefWidth).toBe(true)
    // PAL:High Res is 640 by 256, the hires bit doubling the nominal width
    expect(st.width).toBe(640)
    expect(st.height).toBe(256)
  })

  it('is True for Ok and False for Cancel', () => {
    const ok = boot(PROG)
    stbutton(ok.rt, 0)
    for (let k = 0; k < 8; k++) ok.rt.frame()
    expect(ok.out().trim()).toBe('[-1]')
    const no = boot(PROG)
    stbutton(no.rt, 1)
    for (let k = 0; k < 8; k++) no.rt.frame()
    expect(no.out().trim()).toBe('[ 0]')
  })

  it('leaves on a double click without waiting for Ok', () => {
    const b = boot(PROG)
    strow(b.rt, 2)
    strow(b.rt, 2)
    for (let k = 0; k < 8; k++) b.rt.frame()
    expect(b.out().trim()).toBe('[-1]')
  })

  it('feeds the four readers off ScreenData, not off the requester', () => {
    const b = boot(
      'A=Irequest Screen\nPrint Ireq Scr Width;" ";Ireq Scr Height;" ";Ireq Scr Colour;" ";Ireq Scr Mode(0);" ";Ireq Scr Mode(1)',
    )
    // PAL:Low Res Laced, then Default on both boxes so the size is real
    strow(b.rt, 3)
    const l = b.rt.rtScreen!.layout
    stbox(b.rt, l.defWidth!)
    stbox(b.rt, l.defHeight!)
    stbutton(b.rt, 0)
    for (let k = 0; k < 8; k++) b.rt.frame()
    // 320 by 512, 2 colours from the slider's own minimum of 1, ViewModes is
    // `id & $88a4` which keeps LACED and throws the PAL monitor away, and
    // n <> 0 answers the whole DisplayID
    expect(b.out().trim()).toBe('320  512  2  4  135172')
  })

  it('takes the colour count off the slider, and the count is 1 << depth', () => {
    const b = boot('A=Irequest Screen\nPrint Ireq Scr Colour')
    const d = b.rt.rtScreen!.layout.depth!
    // the right-hand end of the slider is the maximum depth this port opens
    stclick(b.rt, d.x + d.w - 1, d.y + (d.h >> 1))
    expect(b.rt.rtScreen!.depth).toBe(8)
    stbutton(b.rt, 0)
    for (let k = 0; k < 8; k++) b.rt.frame()
    expect(b.out().trim()).toBe('256')
  })

  it('leaves the last answer standing when the next one is cancelled', () => {
    // only the `.ok` arm at `$5b8c` writes ScreenData
    const b = boot('A=Irequest Screen\nB=Irequest Screen\nPrint Ireq Scr Width')
    strow(b.rt, 4)
    const l = b.rt.rtScreen!.layout
    stbox(b.rt, l.defWidth!)
    stbutton(b.rt, 0)
    for (let k = 0; k < 6; k++) b.rt.frame()
    stbutton(b.rt, 1)
    for (let k = 0; k < 8; k++) b.rt.frame()
    // PAL:Super-High Res is 1280 wide, and the cancel did not overwrite it
    expect(b.out().trim()).toBe('1280')
  })

  it('comes up where the last one was left', () => {
    const b = boot('A=Irequest Screen\nB=Irequest Screen\nPrint B')
    strow(b.rt, 5)
    stbutton(b.rt, 0)
    for (let k = 0; k < 6; k++) b.rt.frame()
    const second = b.rt.rtScreen!
    expect(second.selected).toBe(5)
    expect(second.rows[5]!.name).toBe('PAL:Super-High Res Laced')
  })

  it('takes the title from its argument and comes up untitled without one', () => {
    expect(boot(PROG).rt.rtScreen!.layout.title).toBe('Pick a mode')
    // routine 218 is `clr.l -(a3)` into 217, and a null title is `sub.l a3,a3`
    expect(boot('A=Irequest Screen\nPrint A').rt.rtScreen!.layout.title).toBe('')
  })

  it('cancels rather than hanging when nobody is there to click it', () => {
    const b = boot(PROG)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('[ 0]')
  })
})
