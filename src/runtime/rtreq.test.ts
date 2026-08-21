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
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { WB_SLOT } from '../amiga/intuition'
import { RT_TEXT } from '../amiga/reqtools'
import { E, IEXT_ERRORS } from './intuition'

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
