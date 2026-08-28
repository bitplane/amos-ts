/**
 * IntuiExtend 2.01b, the ReqTools group.
 *
 * The requesters themselves are ../amiga/reqtools.ts and ./rtreq.ts, both
 * already pinned by their own tests. What is pinned here is the VENEER: which
 * argument reaches which field, what the workspace holds afterwards, and the
 * four places where the binary and Request.guide disagree.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { WB_SLOT } from '../amiga/intuition'
import { FREQF } from '../amiga/reqtools'
import { Runtime } from './runtime'
import { IE_REQTOOLS_BASE } from './intuiextendreq'

const table = new TokenTable(CORE_TOKENS)
const ie = extensionById('intuiextend-2.01b')!
const extensions = new Map([[23, ie.table]])

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string): Boot {
  let printed = ''
  const fs = new AmigaFS()
  const ram = fs.mountMemory('RAM')
  ram.write(['one.txt'], new TextEncoder().encode('one'))
  ram.write(['two.txt'], new TextEncoder().encode('two'))
  ram.write(['three.dat'], new TextEncoder().encode('three'))
  fs.currentDir = 'RAM:'
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[23, ie]]),
    maxSteps: 300_000,
    fs,
    onText: (t) => (printed += t),
  })
  return { rt, out: () => printed }
}

/** run to the end, which answers every requester the way an empty room does */
function run(src: string): Boot {
  const b = boot(src)
  mustFinish(b.rt.runHeadless(4000))
  return b
}

const vals = (src: string): number[] =>
  run(src)
    .out()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)

const lines = (src: string): string[] =>
  run(src)
    .out()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')

/** step one frame, which leaves the requester up for the test to answer */
function park(b: Boot): void {
  b.rt.frame()
}

function click(b: Boot, win: { leftEdge: number; topEdge: number }, wx: number, wy: number): void {
  const scr = b.rt.screens.get(WB_SLOT)!
  b.rt.input.mouseX = scr.screenToHardX(win.leftEdge + wx)
  b.rt.input.mouseY = win.topEdge + wy + scr.displayY - scr.offsetY
  b.rt.input.mouseK = 1
  b.rt.frame()
  b.rt.input.mouseK = 0
  b.rt.frame()
}

function finish(b: Boot): void {
  for (let i = 0; i < 6; i++) b.rt.frame()
}

/** `Rt Lib Open` first, because every other keyword in the group needs it */
const OPEN = 'L=Rt Lib Open\n'

describe('IntuiExtend 2.01b — Rt Lib Open and Rt Lib Close', () => {
  /**
   * `$44e8 moveq #$ff,d3` runs before the base is tested, and the
   * already-open path sets only d2. So the answer is the base once and -1
   * after that, where Req7 promises the address every time.
   */
  it('answers the base once and -1 for every call after it', () => {
    expect(vals('Print Rt Lib Open\nPrint Rt Lib Open\nPrint Rt Lib Open\n')).toEqual([
      IE_REQTOOLS_BASE | 0,
      -1,
      -1,
    ])
  })

  /** `$459e move.l #$0,(a0)` clears the base, so the next open is a first one */
  it('opens again after a close', () => {
    expect(vals('A=Rt Lib Open\nRt Lib Close\nPrint Rt Lib Open\n')).toEqual([IE_REQTOOLS_BASE | 0])
  })

  /** the close is guarded by the same `tst.l (a0)`, so a second one does nothing */
  it('takes a close with nothing open', () => {
    expect(vals('Rt Lib Close\nRt Lib Close\nPrint Rt Lib Open\n')).toEqual([IE_REQTOOLS_BASE | 0])
  })
})

describe('IntuiExtend 2.01b — the group without a library', () => {
  /**
   * Every keyword opens `movea.l $258(a5),a0 / adda.w #$10,a0 / tst.l (a0) /
   * beq`, so with nothing opened they all take the exit branch.
   */
  it('answers 0 from every requester until Rt Lib Open is called', () => {
    const src =
      'Print Rt File Req("T","","","",2)\n' +
      'Print Rt Dir Req("T","",2)\n' +
      'Print Rt Multifile Req("T","",2)\n' +
      'Print Rt Text Req("B","Ok","T",0,2)\n' +
      'Print Rt Number Req("T",0)\n' +
      'Print Rt Palette Req("T",0,2)\n' +
      'Print Rt Font Req("T",0,2)\n' +
      'Print Rt Screen Mode Req("T",0,2)\n'
    expect(vals(src)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  /** and the readers answer their cleared workspace */
  it('reads an empty workspace', () => {
    const out = lines('Print "[";Rt Get Name$;"][";Rt Get Dir$;"][";Rt Get Font Name;"]"\n')
    expect(out).toEqual(['[][][]'])
    expect(vals('Print Rt Get Font Size;Rt Get Display Id;Rt Get Display Width\n')).toEqual([0, 0, 0])
  })
})

describe('IntuiExtend 2.01b — the file requesters', () => {
  /**
   * `$454a move.l #$10,$8(a2)` is FREQF_PATGAD, and MPAT$ is the argument the
   * gadget exists for.
   */
  it('Rt File Req asks for the pattern gadget and fills the three strings', () => {
    const b = boot(OPEN + 'A=Rt File Req("Load","RAM:","one.txt","#?.txt",2)\n')
    park(b)
    const st = b.rt.rtFile!
    expect(st.setup.flags).toBe(FREQF.PATGAD)
    expect(st.window.title).toBe('Load')
    expect(st.dir).toBe('RAM:')
    expect(st.pattern).toBe('#?.txt')
    expect(st.file).toBe('one.txt')
  })

  /** Req1's answer is rtFileRequestA's: 1 for Ok and 0 for Cancel */
  it('answers 1 for Ok and leaves the name and directory behind', () => {
    const b = boot(OPEN + 'A=Rt File Req("Load","RAM:","one.txt","",2)\nPrint A;" [";Rt Get Name$;"][";Rt Get Dir$;"]"\n')
    park(b)
    const st = b.rt.rtFile!
    const ok = st.layout.buttons[0]!.box
    click(b, st.window, ok.x + (ok.w >> 1), ok.y + (ok.h >> 1))
    finish(b)
    expect(b.out().trim()).toBe('1 [one.txt][RAM:]')
  })

  /** an unanswered requester cancels, and rtFileRequestA answers FALSE */
  it('answers 0 for a cancel', () => {
    expect(vals(OPEN + 'Print Rt File Req("Load","RAM:","","",2)\n')).toEqual([0])
  })

  /**
   * `$465a move.l #$8,$8(a2)` is FREQF_NOFILES, which the doc calls the way
   * to "allow the user to select a directory rather than a file".
   */
  it('Rt Dir Req asks for NOFILES and passes no pattern', () => {
    const b = boot(OPEN + 'A=Rt Dir Req("Where","RAM:",2)\n')
    park(b)
    const st = b.rt.rtFile!
    expect(st.setup.flags).toBe(FREQF.NOFILES)
    expect(st.window.title).toBe('Where')
    expect(st.pattern).toBe('')
  })

  /**
   * Routine 215 never writes the name buffer, and routine 214 hands
   * workspace+$604 to rtFileRequestA all the same. So a `Rt Dir Req` after a
   * `Rt File Req` opens on the name the file requester left.
   */
  it('Rt Dir Req reuses the name buffer the last requester filled', () => {
    const b = boot(OPEN + 'A=Rt File Req("Load","RAM:","kept.txt","",2)\nB=Rt Dir Req("Where","RAM:",2)\n')
    park(b)
    const first = b.rt.rtFile!
    const cancel = first.layout.buttons[first.layout.buttons.length - 1]!.box
    click(b, first.window, cancel.x + (cancel.w >> 1), cancel.y + (cancel.h >> 1))
    park(b)
    park(b)
    expect(b.rt.rtFile?.file).toBe('kept.txt')
  })

  /** `$468e move.l #$1,$8(a2)`: MULTISELECT alone, so SELECTDIRS is off */
  it('Rt Multifile Req asks for MULTISELECT and nothing else', () => {
    const b = boot(OPEN + 'A=Rt Multifile Req("Pick","RAM:",2)\n')
    park(b)
    expect(b.rt.rtFile!.setup.flags).toBe(FREQF.MULTISELECT)
  })

  /** the count is the walk at $46a8-$46b2, and a cancel gives an empty list */
  it('answers 0 and an empty list for a cancel', () => {
    expect(vals(OPEN + 'Print Rt Multifile Req("Pick","RAM:",2)\nPrint "[";Rt Get Flist$(1);"]"\n')[0]).toBe(0)
    expect(lines(OPEN + 'A=Rt Multifile Req("Pick","RAM:",2)\nPrint "[";Rt Get Flist$(1);"]"\n')).toEqual(['[]'])
  })

  /**
   * `$46ce tst.w d0 / bls` and `$46d2 cmp.w $4(a2),d0 / bgt`, so the number is
   * one-based and checked at both ends.
   */
  it('Rt Get Flist$ is one-based and answers the empty string out of range', () => {
    expect(lines(OPEN + 'Print "[";Rt Get Flist$(0);"][";Rt Get Flist$(-1);"][";Rt Get Flist$(99);"]"\n')).toEqual([
      '[][][]',
    ])
  })

  /** `$4728 clr.l (a0)+ / clr.w (a0)` clears the head and the count together */
  it('Rt Free Flist empties the list', () => {
    expect(lines(OPEN + 'A=Rt Multifile Req("Pick","RAM:",2)\nRt Free Flist\nPrint "[";Rt Get Flist$(1);"]"\n')).toEqual([
      '[]',
    ])
  })
})

describe('IntuiExtend 2.01b — the text requesters', () => {
  /**
   * FLAG reaches rtReqInfo.Flags here, which is RTEZ_Flags, and Req9's answer
   * is rtEZRequestA's: the rightmost gadget is 0 and they count from 1 at the
   * left.
   */
  it('Rt Text Req numbers its buttons from the left and cancels to 0', () => {
    expect(vals(OPEN + 'Print Rt Text Req("Quit?","Yes|No","T",0,2)\n')).toEqual([0])
    const b = boot(OPEN + 'A=Rt Text Req("Quit?","Yes|No","T",0,2)\nPrint A\n')
    park(b)
    const st = b.rt.rtReq!
    const yes = st.layout.buttons[0]!.box
    click(b, st.window, yes.x + (yes.w >> 1), yes.y + (yes.h >> 1))
    finish(b)
    expect(b.out().trim()).toBe('1')
  })

  /** TITLE$ is rtReqInfo.ReqTitle, `$475a move.l a0,$c(a2)` */
  it('puts TITLE$ in the title bar and TEXT$ in the body', () => {
    const b = boot(OPEN + 'A=Rt Text Req("Are you sure?","Yes|No","Careful",0,2)\n')
    park(b)
    expect(b.rt.rtReq!.window.title).toBe('Careful')
    expect(b.rt.rtReq!.layout.lines.map((l) => l.text)).toEqual(['Are you sure?'])
  })

  /**
   * Routine 220 reads the BUFFER back and drops rtGetStringA's TRUE/FALSE, so
   * a cancelled requester hands back DEFAULTTEXT$.
   */
  it('Rt String Req answers the default when it is cancelled', () => {
    // the assignment is on its own line: a keyword that blocks restarts the
    // statement it is in, and a `Print` with text before the call emits it twice
    expect(lines(OPEN + 'A$=Rt String Req("Name","Fred",20,0,2)\nPrint "[";A$;"]"\n')).toEqual(['[Fred]'])
  })

  /** CARMAX is rtGetStringA's maxchars in d0 and routine 143's allocation */
  it('passes CARMAX as the buffer length', () => {
    const b = boot(OPEN + 'A$=Rt String Req("Name","Fred",12,0,2)\n')
    park(b)
    expect(b.rt.rtReq!.args.maxLen).toBe(12)
    expect(b.rt.rtReq!.buffer).toBe('Fred')
  })
})

describe('IntuiExtend 2.01b — Rt Number Req', () => {
  /**
   * ReqA says "BOUT=0 Si le bouton Ok est selectionne ou 1 Si c'est le bouton
   * Annuler/Cancel". `reqtools.doc`:1130 says "ret - TRUE if user entered a
   * number, FALSE if not", and routine 224 copies d0 to d3 untouched. So a
   * cancel is 0, not 1.
   */
  it('answers 0 for a cancel, which is the opposite of what the guide says', () => {
    expect(vals(OPEN + 'Reserve As Work 10,4\nV=Start(10)\nLoke V,1993\nPrint Rt Number Req("How many",V)\n')).toEqual([
      0,
    ])
  })

  /** "'longvar' will NOT change if the requester is aborted", `reqtools.doc`:1136 */
  it('leaves the caller long alone when it is cancelled', () => {
    expect(
      vals(OPEN + 'Reserve As Work 10,4\nV=Start(10)\nLoke V,1993\nA=Rt Number Req("How many",V)\nPrint Leek(V)\n'),
    ).toEqual([1993])
  })

  /** and the long is the value the gadget opens on */
  it('shows the value the address already holds', () => {
    const b = boot(OPEN + 'Reserve As Work 10,4\nV=Start(10)\nLoke V,1993\nA=Rt Number Req("How many",V)\n')
    park(b)
    expect(b.rt.rtReq!.args.value).toBe(1993)
  })
})

describe('IntuiExtend 2.01b — the three that misuse their arguments', () => {
  /**
   * `$48fc move.l d6,$8(a1)` puts POS in rtfo_Flags, which is RTFO_Flags. The
   * position argument the guide documents is a flags word on the machine.
   */
  it('Rt Font Req writes POS into RTFO_Flags', () => {
    const b = boot(OPEN + 'A=Rt Font Req("Pick a font",0,4)\n')
    park(b)
    expect(b.rt.rtFont!.setup.flags).toBe(4)
    expect(b.rt.rtFont!.window.title).toBe('Pick a font')
  })

  /** `$490e tst.b d0` then `$4912 move.l #$0,(a2)`: a cancel empties the name */
  it('Rt Font Req empties the font name on a cancel', () => {
    expect(lines(OPEN + 'A=Rt Font Req("Pick",0,0)\nPrint A;" [";Rt Get Font Name;"]"\n')).toEqual(['0 []'])
  })

  /** POS is popped into a0 at $48a4 and overwritten by FLAG at $48a6 */
  it('Rt Palette Req takes its title and answers -1 for a cancel', () => {
    const b = boot(OPEN + 'A=Rt Palette Req("Colours",0,2)\n')
    park(b)
    expect(b.rt.rtPalette!.setup.title).toBe('Colours')
    expect(vals(OPEN + 'Print Rt Palette Req("Colours",0,2)\n')).toEqual([-1])
  })

  /** the same two lines at $496a and $496c, so neither argument reaches a field */
  it('Rt Screen Mode Req passes no RTSC_Flags at all', () => {
    const b = boot(OPEN + 'A=Rt Screen Mode Req("Mode",1,4)\n')
    park(b)
    expect(b.rt.rtScreen!.setup.flags).toBe(0)
    expect(b.rt.rtScreen!.window.title).toBe('Mode')
  })
})

describe('IntuiExtend 2.01b — the six screen mode readers', () => {
  /**
   * Routine 227 copies the block only when the low byte of d0 is set, and
   * nothing else in the extension writes workspace+$75c. So a cancelled
   * request leaves all six reading zero.
   */
  it('all read 0 until a request is accepted', () => {
    const src =
      OPEN +
      'A=Rt Screen Mode Req("Mode",0,2)\n' +
      'Print Rt Get Display Id;Rt Get Display Width;Rt Get Display Height\n' +
      'Print Rt Get Display Depth;Rt Get Overscan Type;Rt Get Autoscroll\n'
    expect(vals(src)).toEqual([0, 0, 0, 0, 0, 0])
  })

  /**
   * ReqG links these two as "Rt Get Display Overscantype" and "Rt Get Display
   * Autoscroll". Neither name is in the table, so neither will parse.
   */
  it('carries the two names the guide does not use', () => {
    const names = ie.tokens.map((t) => t.name)
    expect(names).toContain('rt get overscan type')
    expect(names).toContain('rt get autoscroll')
    expect(names).not.toContain('rt get display overscantype')
    expect(names).not.toContain('rt get display autoscroll')
  })

  /** and Rt Get Display Id has no node in Request.guide at all */
  it('carries Rt Get Display Id, which the guide never mentions', () => {
    const id = ie.tokens.find((t) => t.name === 'rt get display id')
    expect(id).toBeDefined()
    expect(id!.func).toBe(297)
  })
})
