import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from './runtime'
import { amosErrorCode, type AmosError } from '../interp/values'

const table = new TokenTable(CORE_TOKENS)

function run(src: string): { rt: Runtime; out: string } {
  let out = ''
  const rt = new Runtime(tokenize(src, table), table, {
    maxSteps: 300_000,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(1_000)
  mustFinish(r)
  return { rt, out }
}

const screen = (rt: Runtime) => rt.screens.get(rt.currentIndex)!

describe('console cursor movement', () => {
  it('Cdown/Cup/Cleft/Cright step the text cursor one cell', () => {
    // Cdown is a full newline (carriage return and line feed), the others
    // move within the line without touching the other axis.
    let { rt } = run('Locate 5,5 : Cdown')
    expect([screen(rt).curX, screen(rt).curY]).toEqual([0, 6])
    ;({ rt } = run('Locate 5,5 : Cup'))
    expect([screen(rt).curX, screen(rt).curY]).toEqual([5, 4])
    ;({ rt } = run('Locate 5,5 : Cleft'))
    expect([screen(rt).curX, screen(rt).curY]).toEqual([4, 5])
    ;({ rt } = run('Locate 5,5 : Cright'))
    expect([screen(rt).curX, screen(rt).curY]).toEqual([6, 5])
  })

  it('clamps at the window edges instead of wrapping or going negative', () => {
    let { rt } = run('Locate 0,0 : Cup : Cleft')
    expect([screen(rt).curX, screen(rt).curY]).toEqual([0, 0])
    // Cright stops on the last column
    ;({ rt } = run('Locate 0,0 : For I=0 To 200 : Cright : Next I'))
    expect(screen(rt).curX).toBe(screen(rt).cols - 1)
  })

  it('Curs On/Off and Curs Pen set cursor state without moving it', () => {
    let { rt } = run('Curs Off : Curs On')
    expect(screen(rt).cursorOn).toBe(true)
    ;({ rt } = run('Curs On : Curs Off'))
    expect(screen(rt).cursorOn).toBe(false)
    // InCursPen +Lib.s:13301 stores the cursor colour in WiCuCol
    ;({ rt } = run('Locate 3,3 : Curs Pen 2'))
    expect(screen(rt).curWin.cuCol).toBe(2)
    expect([screen(rt).curX, screen(rt).curY]).toEqual([3, 3])
  })

  it('Set Curs takes a cursor shape definition and consumes the whole statement', () => {
    // the cursor is composited rather than drawn from the shape table, so the
    // definition is parsed and discarded — it must not derail the next line
    const { out } = run('Set Curs 1,2,3,4,5,6,7,8\nPrint "after"')
    expect(out).toBe('after\n')
  })
})

describe('console line and style state', () => {
  it('Cline clears to end of line in the paper colour', () => {
    const { rt } = run('Screen Open 0,320,200,16,Lowres : Cls 0 : Paper 3 : Locate 2,1 : Cline')
    const s = screen(rt)
    // cells 0..1 untouched, from column 2 to the right edge painted with paper
    expect(s.point(0, 8)).toBe(0)
    expect(s.point(2 * 8, 8)).toBe(3)
    expect(s.point(s.cols * 8 - 1, 8)).toBe(3)
    // and only that text row
    expect(s.point(2 * 8, 0)).toBe(0)
  })

  it('Cline with a count clears only that many characters', () => {
    const { rt } = run('Screen Open 0,320,200,16,Lowres : Cls 0 : Paper 5 : Locate 1,2 : Cline 3')
    const s = screen(rt)
    expect(s.point(1 * 8, 2 * 8)).toBe(5)
    expect(s.point(4 * 8 - 1, 2 * 8)).toBe(5)
    expect(s.point(4 * 8, 2 * 8)).toBe(0)
  })

  it('Under Off, Inverse Off and Shade On/Off toggle window style flags', () => {
    let { rt } = run('Under On : Under Off')
    expect(screen(rt).curWin.style & 1).toBe(0)
    ;({ rt } = run('Under Off : Under On'))
    expect(screen(rt).curWin.style & 1).toBe(1)
    ;({ rt } = run('Inverse On : Inverse Off'))
    expect(screen(rt).curWin.inverse).toBe(false)
    ;({ rt } = run('Shade On'))
    expect(screen(rt).curWin.shade).toBe(true)
    ;({ rt } = run('Shade On : Shade Off'))
    expect(screen(rt).curWin.shade).toBe(false)
  })

  it('Set Tab changes the column Tab$ advances to (WiTab)', () => {
    // a tab advances to the next multiple of the window tab, which starts
    // at 4 (Wo3a in +W.s). The transcript keeps the raw control character —
    // it is the console that resolves it, so the cursor is what to measure.
    const at = (prog: string): number =>
      screen(run(`Screen Open 0,320,200,16,Lowres : Locate 0,0 : ${prog}`).rt).curX
    expect(at('Print "a";Tab$;')).toBe(4)
    expect(at('Set Tab 8 : Print "a";Tab$;')).toBe(8)
    expect(at('Set Tab 8 : Print "abcdefghi";Tab$;')).toBe(16)
    // a tab of zero would never advance, so it is clamped to 1
    expect(at('Set Tab 0 : Print "a";Tab$;')).toBe(2)
  })
})

describe('console escape-string functions', () => {
  it('Repeat$ hands the repeating to the console, and takes 1 to 206', () => {
    /*
     * FnRepeat (+Lib.s:14108) goes through FinRpt (+Lib.s:14152), the routine
     * Border$ and Zone$ also use, so the result is `Esc R 0` + text +
     * `Esc R n` — six characters longer than the text, not n copies of it.
     * Repete (+W.s:14993) is what turns that into n copies on the way out.
     */
    expect(run('Print Len(Repeat$("ab",3))').out).toBe(' 8\n')
    const { out } = run('A$=Repeat$("ab",3) : Print Mid$(A$,2,1);Asc(Mid$(A$,3,1));Mid$(A$,7,1);Asc(Mid$(A$,8,1))')
    expect(out).toBe('R 48R 51\n')
    // and the console really does repeat it: six characters printed, not two
    const { rt } = run('Print Repeat$("ab",3);')
    expect(screen(rt).curX).toBe(6)
    // one copy still prints once, and 206 is the last count that fits
    expect(run('Print Repeat$("ab",1);').rt.screens.get(0)!.curX).toBe(2)
    const code = (src: string): number => {
      try {
        run(src)
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    // tst.l d3 / Rbeq and cmp.l #207,d3 / Rbcc, both landing on WFonCall
    expect(code('A$=Repeat$("x",0)')).toBe(60)
    expect(code('A$=Repeat$("x",-1)')).toBe(60)
    expect(code('A$=Repeat$("x",207)')).toBe(60)
    expect(code('A$=Repeat$("x",206)')).toBe(0)
  })

  it('Cline takes 1 to 206 and Set Tab 0 to 207, both error 60', () => {
    const code = (src: string): number => {
      try {
        run(src)
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    // InCline1 (+Lib.s:13501) rejects 0 with tst.l and 207 with Rbcc
    expect(code('Cline 0')).toBe(60)
    expect(code('Cline -1')).toBe(60)
    expect(code('Cline 207')).toBe(60)
    expect(code('Cline 206')).toBe(0)
    // the bare form counts to the window edge and has nothing to check
    expect(code('Cline')).toBe(0)
    // InSetTab (+Lib.s:13543) uses Rbhi, so 207 passes and 0 is allowed
    expect(code('Set Tab 207')).toBe(0)
    expect(code('Set Tab 208')).toBe(60)
    expect(code('Set Tab -1')).toBe(60)
    expect(code('Set Tab 0')).toBe(0)
  })

  it('Paper$ and Pen$ build the console colour escapes', () => {
    // Esc B n selects paper, Esc P n selects pen; the digit is offset by 48
    expect(run('A$=Paper$(3) : Print Len(A$);Asc(Mid$(A$,2,1));Asc(Mid$(A$,3,1))').out).toBe(
      ' 3 66 51\n',
    )
    expect(run('A$=Pen$(2) : Print Asc(Mid$(A$,2,1));Asc(Mid$(A$,3,1))').out).toBe(' 80 50\n')
    // FPn (+Lib.s:14002) `cmp.l #32,d3 / Rbcc L_WFonCall`, and WFonCall is
    // `moveq #16,d0 / Rbra L_EcWiErr` so a program sees 60. Unsigned, so one
    // compare covers the negative end
    for (const src of ['A$=Pen$(32)', 'A$=Paper$(32)', 'A$=Pen$(-1)']) {
      let n = 0
      try {
        run(src)
      } catch (e) {
        n = amosErrorCode(e as AmosError)
      }
      expect([src, n]).toEqual([src, 60])
    }
    // 31 is the last legal one, and its digit byte is 48 + 31
    expect(run('A$=Pen$(31) : Print Asc(Mid$(A$,3,1))').out).toBe(' 79\n')
  })

  it('At refuses a coordinate outside 0 to 207, and still allows an omitted one', () => {
    // FnAt +Lib.s:14017 skips an EntNul slot and otherwise runs `cmp.l
    // #255-48,d2 / Rbhi L_WFonCall`. Rbhi is unsigned, so the one compare
    // catches a negative too, and WFonCall is error 60 rather than 23.
    const code = (src: string): number => {
      try {
        run(src)
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    expect(code('A$=At(-5,6)')).toBe(60)
    expect(code('A$=At(5,-6)')).toBe(60)
    // -1 is a typed value, not an empty slot: the sentinel is EntNul
    expect(code('A$=At(-1,6)')).toBe(60)
    expect(code('A$=At(208,6)')).toBe(60)
    expect(code('A$=At(207,207)')).toBe(0)
    // Esc X n Esc Y n is six characters, one escape per slot given
    expect(run('A$=At(5,6) : Print Len(A$);').out).toBe(' 6')
    expect(run('A$=At(,6) : Print Len(A$);').out).toBe(' 3')
    expect(run('A$=At(5,) : Print Len(A$);').out).toBe(' 3')
  })

  it('Cmove$ builds a relative cursor move, biased by 128', () => {
    // Esc N (x+128) Esc O (y+128) — the bias lets negative moves travel as
    // bytes, and FnCMoveD (+Lib.s:14060) writes the x escape first
    const { out } = run('A$=Cmove$(2,-3) : Print Asc(Mid$(A$,3,1));Asc(Mid$(A$,6,1))')
    expect(out).toBe(' 130 125\n')
    expect(run('A$=Cmove$(2,-3) : Print Mid$(A$,2,1);Mid$(A$,5,1)').out).toBe('NO\n')
  })

  it('Cmove$ leaves out an axis that is zero or empty, and refuses 128', () => {
    // tst.l d2 / beq and cmp.l #EntNul,d2 / beq skip the axis; with neither
    // axis flagged, tst.w d4 / Rbeq L_Ret_ChVide returns the empty string
    expect(run('Print Len(Cmove$(0,0))').out).toBe(' 0\n')
    expect(run('Print Len(Cmove$(,))').out).toBe(' 0\n')
    expect(run('Print Len(Cmove$(2,0))').out).toBe(' 3\n')
    expect(run('Print Len(Cmove$(0,-3))').out).toBe(' 3\n')
    // -1 is a real move now that an empty slot no longer arrives as -1
    expect(run('Print Len(Cmove$(-1,0))').out).toBe(' 3\n')
    const code = (src: string): number => {
      try {
        run(src)
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    // cmp.l #128 / Rbge and cmp.l #-128 / Rble, so the range is -127..127
    expect(code('A$=Cmove$(128,0)')).toBe(60)
    expect(code('A$=Cmove$(-128,0)')).toBe(60)
    expect(code('A$=Cmove$(0,128)')).toBe(60)
    expect(code('A$=Cmove$(127,-127)')).toBe(0)
    // the instruction biases first and compares unsigned, so it takes -128
    expect(code('Cmove -128,127')).toBe(0)
    expect(code('Cmove 128,0')).toBe(60)
    expect(code('Cmove 0,-129')).toBe(60)
  })
})

describe('hardware and screen coordinate mapping', () => {
  it('X Screen/Y Screen convert hardware coordinates to screen ones', () => {
    // the display window origin is hardware (128,50)
    const { out } = run(
      'Screen Open 0,320,200,16,Lowres : Screen Display 0,128,50,320,200 : Print X Screen(128);Y Screen(50)',
    )
    expect(out).toBe(' 0 0\n')
  })

  it('X Hard/Y Hard are the exact inverse of X Screen/Y Screen', () => {
    const { out } = run(
      [
        'Screen Open 0,320,200,16,Lowres',
        'Screen Display 0,128,50,320,200',
        'For X=0 To 300 Step 37',
        '  If X Hard(X Screen(X+128))<>X+128 Then Print "bad";X : End',
        'Next X',
        'Print "ok"',
      ].join('\n'),
    )
    expect(out).toBe('ok\n')
  })

  /**
   * `CXyScr` reads `EcWx(a0)`, the screen's own display X, and these four used
   * to have 128 and 50 written into them instead. A screen moved with
   * `Screen Display` is where the two answers part.
   */
  it('X Screen and Y Screen follow the screen s display position', () => {
    const { out } = run(
      [
        'Screen Open 0,320,200,16,Lowres',
        'Screen Display 0,200,100,320,200',
        'Print X Screen(200);Y Screen(100);X Screen(210);Y Screen(110)',
      ].join('\n'),
    )
    expect(out).toBe(' 0 0 10 10\n')
  })

  /** `btst #2,EcCon0+1(a0) / asl.w #1,d2`, the Y half of the hires test for X */
  it('a laced screen doubles the vertical step, as hires doubles the horizontal', () => {
    const { out } = run(
      [
        'Screen Open 0,320,400,16,Lowres+Laced',
        'Screen Display 0,128,50,320,400',
        'Print Y Screen(60);Y Hard(20)',
      ].join('\n'),
    )
    // ten hardware lines are twenty screen rows on an interlaced screen
    expect(out).toBe(' 20 60\n')
  })

  it('a hires screen halves the horizontal hardware step', () => {
    const { out } = run(
      'Screen Open 0,640,200,4,Hires : Screen Display 0,128,50,640,200 : Print X Screen(129);X Hard(2)',
    )
    // one hardware pixel is two screen pixels in hires, and back again
    expect(out).toBe(' 2 129\n')
  })

  /**
   * `ZoEc` tests in hardware units, so an interlaced screen 400 rows tall
   * occupies 200 hardware lines and not 400. Both readers doubled X and left
   * Y alone, which put the bottom of the box twice as far down as it is.
   */
  it('Scin measures a laced screen s box in hardware lines', () => {
    const prog = [
      'Screen Open 0,320,400,16,Lowres+Laced',
      'Screen Display 0,128,50,320,400',
      'Print Scin(130,60);Scin(130,240);Scin(130,300)',
    ].join('\n')
    // line 240 is inside its 200 lines, 300 is past the bottom of them
    expect(run(prog).out).toBe(' 0 0-1\n')
  })

  it('Scin reports which screen lies under a hardware point, topmost first', () => {
    const prog = [
      'Screen Open 0,320,100,4,Lowres : Screen Display 0,128,50,320,100',
      'Screen Open 1,320,100,4,Lowres : Screen Display 1,128,160,320,100',
      'Print Scin(130,60);Scin(130,170);Scin(130,300)',
    ].join('\n')
    expect(run(prog).out).toBe(' 0 1-1\n')
  })

  it('Xgr/Ygr report the graphics cursor left by the last drawing operation', () => {
    const { out } = run('Screen Open 0,320,200,16,Lowres : Plot 10,20 : Draw To 40,60 : Print Xgr;Ygr')
    expect(out).toBe(' 40 60\n')
  })

  it('Laced is the BPLCON0 interlace bit', () => {
    // screen-mode flags are OR-ed into the BPLCON0 word: Hires $8000, Lace $4
    expect(run('Print Laced').out).toBe(' 4\n')
    expect(run('Print Hires').out).toBe(' 32768\n')
  })
})

describe('screen visibility and offset', () => {
  it('Screen Show and Screen Hide toggle a screen without closing it', () => {
    const { rt } = run(
      'Screen Open 0,320,200,4,Lowres : Screen Hide 0 : Screen Show 0 : Screen Open 1,320,100,4,Lowres',
    )
    expect(rt.screens.get(0)!.visible).toBe(true)
  })

  it('Screen Offset scrolls the view within a larger screen', () => {
    const { rt } = run('Screen Open 0,640,400,4,Lowres : Screen Offset 0,32,16')
    const s = rt.screens.get(0)!
    expect([s.offsetX, s.offsetY]).toEqual([32, 16])
  })

  it('Screen Close removes the screen and its number stops resolving', () => {
    const { rt } = run('Screen Open 0,320,200,4,Lowres : Screen Open 1,320,200,4,Lowres : Screen Close 1')
    expect(rt.screens.has(1)).toBe(false)
    expect(rt.screens.has(0)).toBe(true)
  })

  it('Border draws a window frame and stores its style', () => {
    const { rt } = run('Screen Open 0,320,200,16,Lowres : Cls 0 : Border 3,2,1')
    const w = screen(rt).curWin
    expect(w.border).toBe(3)
    expect(w.borPap).toBe(2)
    expect(w.borPen).toBe(1)
  })

  it('Border refuses a style of 16 and a colour off the palette, and 0 changes nothing', () => {
    // WSBor +W.s:14016: `cmp.l #16,d1 / bcc WErr7`, then `tst.w d1 / beq.s
    // Wsb1` so zero passes the range check without being stored, then
    // `cmp.w EcNbCol(a4),d2 / bcc WErr7` for each colour. WErr7 is `moveq
    // #16,d0` (+W.s:15839), which through EcWiErr is error 60.
    const open = 'Screen Open 0,320,200,16,Lowres : Cls 0'
    // not the `run` above: mustFinish turns a failed program into a plain
    // Error and the AMOS number is what this test is about
    const code = (src: string): number => {
      try {
        const rt = new Runtime(tokenize(`${open} : ${src}`, table), table, { maxSteps: 300_000 })
        rt.runHeadless(1_000)
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    // the spec is I0,0,0, so all three commas are typed and a slot is left
    // EMPTY rather than dropped — `Border 16` on its own is a syntax error
    expect(code('Border 16,,')).toBe(60)
    expect(code('Border -1,,')).toBe(60)
    expect(code('Border 3,16,1')).toBe(60)
    expect(code('Border 3,2,16')).toBe(60)
    expect(code('Border 15,15,15')).toBe(0)
    // 0 is legal and leaves the style alone
    const { rt } = run(`${open} : Border 3,2,1 : Border 0,,`)
    expect(screen(rt).curWin.border).toBe(3)
    // an empty leading slot is legal and still is: `Border,0,14` is in the corpus
    const { rt: rt2 } = run(`${open} : Border 3,2,1 : Border,0,14`)
    expect([screen(rt2).curWin.border, screen(rt2).curWin.borPap]).toEqual([3, 0])
  })

  it('Title Bottom stores the lower window title', () => {
    const { rt } = run('Screen Open 0,320,200,16,Lowres : Wind Open 1,0,0,20,10,1 : Title Bottom "feet"')
    expect(screen(rt).curWin.titleBottom).toBe('feet')
  })
})

describe('input state', () => {
  it('Set Input changes the line-input terminator characters', () => {
    const { rt } = run('Set Input 10,-1')
    expect(rt.chrInp).toEqual([10, -1])
    const two = run('Set Input 13,10')
    expect(two.rt.chrInp).toEqual([13, 10])
  })

  it('Input$(n) waits for n printable keys, drops the rest, and echoes nothing', () => {
    // FnInputD1 +Lib.s:4666 loops on Inkey until it has n bytes, skipping
    // anything below space (`cmp.b #32,d1 / bcs.s FInp1a`). It never writes to
    // the console, so what the typist sees is nothing at all.
    let printed = ''
    const rt = new Runtime(tokenize('A$=Input$(3) : Print A$', table), table, {
      maxSteps: 100000,
      onText: (s) => {
        printed += s
      },
    })
    rt.input.keyQueue.push({ ch: 'A', scan: 32 })
    for (let i = 0; i < 5; i++) rt.frame()
    expect(rt.interp.blocked).not.toBeNull() // one key of three: still waiting
    expect(printed).toBe('') // and nothing of the 'A' reached the screen
    // the Return is eaten by `cmp.b #32,d1 / bcs.s FInp1a` and does not count
    rt.input.keyQueue.push({ ch: '\r', scan: 68 }, { ch: 'B', scan: 53 }, { ch: 'C', scan: 51 })
    for (let i = 0; i < 5; i++) rt.frame()
    expect(rt.interp.blocked).toBeNull()
    expect(printed).toBe('ABC\n')
  })

  it('Input$(0) is an illegal function call, because AskD3 rejects it', () => {
    // AskD3 +Lib.s:3756 reserves the string first: `tst.l d3 / Rbeq L_FonCall
    // / Rbmi L_FonCall`, so the count never reaches the Inkey loop.
    expect(() => run('A$=Input$(0)')).toThrow(/Illegal function call/)
  })

  it('Clear Key empties the pending key queue', () => {
    const rt = new Runtime(tokenize('Clear Key', table), table, { maxSteps: 1000 })
    rt.input.keyQueue.push({ ch: 'a', scan: 32 }, { ch: 'b', scan: 53 })
    rt.runHeadless(100)
    expect(rt.input.keyQueue).toEqual([])
  })

  it('ESC J keeps the console off the planes it masks out', () => {
    // `Planes` (+W.s:14878) walks the argument up while the plane number
    // counts DOWN and stores the complement; `ClFin` reads it back the same
    // way. Net of the two reversals, bit p of the argument is plane p.
    //
    // This is what the editor prints its program text through: system
    // message 20 ends in ESC J1, so a line lands in plane 0 and the window
    // furniture in planes 1 and 2 survives being printed over.
    const { rt } = run('Screen Open 0,320,200,8,0 : Cls 7 : Print Chr$(27);"J1";Chr$(27);"P0";Chr$(27);"B0";"A"')
    const s = screen(rt)
    // colour 7 is %111 everywhere; pen 0 and paper 0 through plane 0 alone
    // can only clear the bottom bit, so every pixel of the cell reads 6
    const cell = new Set<number>()
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) cell.add(s.point(x, y))
    expect([...cell]).toEqual([6])
  })

  it('ESC V0 is Scroll Off, which the editor sets on every window it opens', () => {
    // `Scroll` (+W.s:14770) is bit 0 of WiSys, set for ON, so the argument
    // is 0 for off. A window that cannot scroll wraps to the top instead.
    const { rt } = run('Print Chr$(27);"V0";')
    expect(screen(rt).curWin.scrollOff).toBe(true)
    const back = run('Print Chr$(27);"V0";Chr$(27);"V1";')
    expect(screen(back.rt).curWin.scrollOff).toBe(false)
  })

  it('ESC J is the console s mask and says nothing about graphics Text', () => {
    // `WiSys+1` is read by `COut`, `ClFin` and `Scrolle` and by nothing else.
    // `Text` goes through graphics.library and obeys `rp_Mask` alone, so a
    // window narrowed to plane 0 does not narrow what `Text` draws over it.
    //
    // The editor is where this showed: its text window prints through
    // `ESC J1`, and a requester drawn on the same screen came out with blank
    // buttons -- red on teal is %100, and masked to plane 0 that is nothing.
    const { rt } = run(
      'Screen Open 0,320,200,8,0 : Cls 0 : Print Chr$(27);"J1"; : Ink 4 : Text 0,60,"X"',
    )
    const s = screen(rt)
    let seen = 0
    for (let y = 50; y < 62; y++) for (let x = 0; x < 8; x++) seen |= s.point(x, y)
    // 4 is the glyph and 1 is what it is drawn ON: `EcOpen` (+W.s:3071) puts
    // the window's paper in the graphic BPen and `EcMode` is JAM2, so `Text`
    // paints the cell. Plane 2 is the half that matters here -- `ESC J1`
    // masked the console to plane 0 and did not narrow this.
    expect(seen).toBe(5)
    expect(seen & 4).toBe(4)
  })

  it('an escape split across two Prints still lands, because WiEsc outlives the string', () => {
    // `EscM` (+W.s:15800) sets WiEsc to 2 and returns; `Esc` counts it down
    // over the next two bytes. `COut` is fed one byte at a time, so the
    // machine has no notion of an escape belonging to one string.
    const { rt } = run('Print Chr$(27);"P3";"x";')
    expect(screen(rt).curWin.pen).toBe(3)
  })

  it('Hide/Show nest as a counter, and Hide On forces the pointer hidden', () => {
    // Hide decrements and Show increments; the pointer is drawn while the
    // count is >= 0. Hide On forces -1 outright, Show On forces 0, so a
    // program can escape an unbalanced nest without counting.
    expect(run('Show On : Hide : Show').rt.mouseShow).toBe(0)
    expect(run('Show On : Hide : Hide : Show').rt.mouseShow).toBe(-1)
    expect(run('Show On : Hide : Hide : Hide On').rt.mouseShow).toBe(-1)
    expect(run('Hide : Hide : Show On').rt.mouseShow).toBe(0)
  })
})
