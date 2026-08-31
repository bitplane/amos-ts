import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from './runtime'
import { EDITOR_RESOURCE_BANK, ED_PICS } from './edres.gen'
import { ED_MESSAGES } from './edmessages.gen'
import { parseAmosFile } from '../loader/amosfile'
import { parseResourceBank } from '../loader/resource'

const table = new TokenTable(CORE_TOKENS)

/**
 * A program run to its `Stop`, then a typed line, then the output of both.
 *
 * The machine gets here by pressing Escape in the editor while a program is
 * stopped; the port gets here by calling `enterDirect`. Either way the line
 * runs against variables the program left behind.
 */
function typed(program: string, ...lines: string[]): string {
  let out = ''
  const rt = new Runtime(tokenize(program, table), table, { maxSteps: 200_000, onText: (t) => (out += t) })
  rt.runHeadless(500)
  for (const line of lines) {
    rt.enterDirect(line)
    rt.runHeadless(500)
  }
  return out
}

describe('direct mode (Ver_Direct +Verif.s:71)', () => {
  it('sees the variables the program left behind', () => {
    // ResDir carves the direct slots off the same TabBas the program's
    // variables live in (+Verif.s:4040), so there is one arena, not two
    expect(typed('SCORE=42 : NAME$="ZAP" : Stop', 'Print SCORE;NAME$')).toBe(' 42ZAP\n')
  })

  it('writes them back', () => {
    expect(typed('SCORE=42 : Stop', 'SCORE=SCORE*2', 'Print SCORE')).toBe(' 84\n')
  })

  it('keeps them across separate typed lines', () => {
    expect(typed('Stop', 'A=7', 'B=A+1', 'Print B')).toBe(' 8\n')
  })

  it('runs the program\'s own arrays and procedures results, not a fresh set', () => {
    const prog = ['Dim T(4)', 'T(2)=99', 'Stop'].join('\n')
    expect(typed(prog, 'Print T(2)')).toBe(' 99\n')
  })

  it('puts the program back where it was when the line ends', () => {
    // halt('ended') pops the saved state, the path a Prun'd program returns
    // by, so the pc is the Stop's again and Cont would carry on from it
    let out = ''
    const rt = new Runtime(tokenize('A=1 : Stop : Print "AFTER"', table), table, { onText: (t) => (out += t) })
    rt.runHeadless(500)
    const at = { ...rt.interp.pc }
    rt.enterDirect('Print A')
    rt.runHeadless(500)
    expect(out).toBe(' 1\n')
    expect(rt.interp.pc).toEqual(at)
    expect(rt.inDirect).toBe(false)
  })

  it('is flagged while the line runs and clear after it', () => {
    const rt = new Runtime(tokenize('Stop', table), table, {})
    expect(rt.inDirect).toBe(false)
    rt.enterDirect('Wait Vbl')
    expect(rt.inDirect).toBe(true)
    rt.runHeadless(500)
    expect(rt.inDirect).toBe(false)
  })
})

describe('what direct mode will not verify (the ten VerIlD sites)', () => {
  const rejects = (line: string): void => {
    const rt = new Runtime(tokenize('Stop', table), table, {})
    rt.runHeadless(500)
    expect(() => rt.enterDirect(line), line).toThrow('Illegal direct mode')
  }

  it('rejects a comment', () => rejects('Rem hello')) // VerRem +Verif.s:745
  it('rejects a tick comment', () => rejects("' hello"))
  it('rejects a label definition', () => rejects('AGAIN:')) // VerLab :792
  it('rejects Set Stack', () => rejects('Set Stack 20')) // VerSStack :816
  it('rejects Set Buffer', () => rejects('Set Buffer 40')) // VerSBu :834
  it('rejects On Break Proc', () => rejects('On Break Proc HALT')) // V1_OnBreak :1530
  it('rejects Procedure', () => rejects('Procedure FOO')) // V1_Procedure :1550
  it('rejects End Proc', () => rejects('End Proc')) // V1_EndProc :1705
  it('rejects Global', () => rejects('Global A')) // VerSha :3856
  it('rejects Shared', () => rejects('Shared A'))

  it('rejects a procedure call, even one the program defines', () => {
    // VerPro (:781) and V1_CallProc (:3299) between them cover both places
    // the token appears. The procedure exists and is still refused.
    const prog = ['Stop', 'Procedure SHOUT', '  Print "HI"', 'End Proc'].join('\n')
    const rt = new Runtime(tokenize(prog, table), table, {})
    rt.runHeadless(500)
    expect(() => rt.enterDirect('SHOUT')).toThrow('Illegal direct mode')
  })

  it('allows the ordinary statements around them', () => {
    const rt = new Runtime(tokenize('Stop', table), table, {})
    rt.runHeadless(500)
    for (const ok of ['Print 1', 'A=1', 'If A=1 Then Print "Y"', 'For I=1 To 3 : Print I : Next I', 'Cls 0']) {
      expect(() => rt.enterDirect(ok), ok).not.toThrow()
      rt.runHeadless(500)
    }
  })
})

describe('an error in a typed line is never trapped (+ILib.s:1330)', () => {
  it('ignores the program\'s On Error Goto', () => {
    // `tst.w Direct(a5) / bne rErr1` sits between the error-1000 test and the
    // Trap test: a mistake in a typed line is reported to whoever typed it
    let out = ''
    const prog = ['On Error Goto OOPS', 'Stop', 'OOPS:', 'Print "TRAPPED"', 'Resume Next'].join('\n')
    const rt = new Runtime(tokenize(prog, table), table, { onText: (t) => (out += t) })
    rt.runHeadless(500)
    rt.enterDirect('A=1/0')
    expect(() => rt.runHeadless(500)).toThrow()
    expect(out).toBe('')
  })

  it('still traps one in the program itself', () => {
    let out = ''
    const prog = ['On Error Goto OOPS', 'A=1/0', 'Print "AFTER"', 'Stop', 'OOPS:', 'Print "TRAPPED"', 'Resume Next'].join(
      '\n',
    )
    const rt = new Runtime(tokenize(prog, table), table, { onText: (t) => (out += t) })
    rt.runHeadless(2000)
    expect(out).toBe('TRAPPED\nAFTER\n')
  })
})

describe('what a host needs to show a typed line', () => {
  it('hands the output to a console as well as the screen', () => {
    // io.write feeds onDirectText a copy while interp.direct is set. On the
    // machine the print lands on the editor's escape screen, which IS a
    // screen; a browser console gets the copy rather than a redirect.
    const rt = new Runtime(tokenize('A=6 : Stop', table), table, {})
    rt.runHeadless(500)
    let shown = ''
    rt.onDirectText = (t) => (shown += t)
    rt.enterDirect('Print A*7')
    rt.runHeadless(500)
    expect(shown).toBe(' 42\n')
    // and it really did reach the screen too
    expect(rt.screens.get(0)!.point(1, 1)).not.toBe(0)
  })

  it('says nothing to the console while the program itself prints', () => {
    const rt = new Runtime(tokenize('Print "PROGRAM" : Stop', table), table, {})
    let shown = ''
    rt.onDirectText = (t) => (shown += t)
    rt.runHeadless(500)
    expect(shown).toBe('')
  })

  it('unwinds a line that threw and leaves the program stopped where it was', () => {
    // Esc_Hide (+Edit.s:9536) with the program intact underneath. Without the
    // saved status coming back, a mistyped line would restart the program.
    let out = ''
    const rt = new Runtime(tokenize('A=1 : Stop : Print "RESUMED"', table), table, { onText: (t) => (out += t) })
    rt.runHeadless(500)
    const at = { ...rt.interp.pc }
    rt.enterDirect('Print 1/0')
    expect(() => rt.runHeadless(500)).toThrow()
    rt.exitDirect()
    expect(rt.inDirect).toBe(false)
    expect(rt.interp.pc).toEqual(at)
    rt.runHeadless(500)
    expect(out).toBe('')
    // and the program is still there to be typed at again
    rt.enterDirect('Print A')
    rt.runHeadless(500)
    expect(out).toBe(' 1\n')
  })
})

describe('the escape screen (Esc_Appear +Edit.s:9356)', () => {
  /** a program with something on screen 0, stopped, with the console up */
  function open(): Runtime {
    const prog = ['Screen Open 0,320,200,16,Lowres : Curs Off : Cls 0', 'SCORE=1234', 'Stop'].join('\n')
    const rt = new Runtime(tokenize(prog, table), table, {})
    for (let i = 0; i < 4; i++) rt.frame()
    rt.directScreen.open()
    return rt
  }

  const type = (rt: Runtime, text: string): void => {
    for (const ch of text) rt.directScreen.key(ch, 0)
    rt.directScreen.key('\r', 0x44)
    for (let i = 0; i < 8; i++) rt.frame()
  }

  /** the console's own pixels, so "did it print THERE" has an answer */
  const marked = (rt: Runtime, n: number): number => {
    const s = rt.screens.get(n)
    if (!s) return 0
    let lit = 0
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (s.point(x, y) !== 0) lit++
    return lit
  }

  it('takes the current screen while it is up, and gives it back', () => {
    // EcCalD Active,EcEdit is the whole trick: a typed Print goes to the
    // escape screen because the escape screen is what Print writes to
    const rt = open()
    expect(rt.currentIndex).toBe(9)
    expect(rt.screens.has(9)).toBe(true)
    rt.directScreen.close()
    expect(rt.currentIndex).toBe(0)
    expect(rt.screens.has(9)).toBe(false)
  })

  it('prints a typed line on itself and leaves the program\'s screen alone', () => {
    const rt = open()
    const before = marked(rt, 0)
    type(rt, 'Print SCORE')
    expect(marked(rt, 0)).toBe(before)
    expect(marked(rt, 9)).toBeGreaterThan(0)
  })

  it('reports an error and keeps the program', () => {
    // rt.frame() would otherwise throw the error out and the host would kill
    // the program for a mistake that was not its
    const rt = open()
    expect(() => type(rt, 'Print 1/0')).not.toThrow()
    expect(rt.inDirect).toBe(false)
    expect(rt.screens.has(0)).toBe(true)
    // and it still answers afterwards
    type(rt, 'SCORE=7')
    rt.directScreen.close()
    let out = ''
    rt.onDirectText = (t) => (out += t)
    rt.enterDirect('Print SCORE')
    rt.runHeadless(200)
    expect(out).toBe(' 7\n')
  })

  it('rubs out a character on backspace', () => {
    const rt = open()
    let out = ''
    rt.onDirectText = (t) => (out += t)
    for (const ch of 'Print 999') rt.directScreen.key(ch, 0)
    for (let i = 0; i < 3; i++) rt.directScreen.key('\b', 0x41)
    rt.directScreen.key('7', 0)
    rt.directScreen.key('\r', 0x44)
    for (let i = 0; i < 8; i++) rt.frame()
    expect(out).toBe(' 7\n')
  })

  it('runs nothing for an empty line', () => {
    const rt = open()
    let out = ''
    rt.onDirectText = (t) => (out += t)
    rt.directScreen.key('\r', 0x44)
    for (let i = 0; i < 4; i++) rt.frame()
    expect(out).toBe('')
    expect(rt.inDirect).toBe(false)
  })

  it('closes on Escape', () => {
    const rt = open()
    rt.directScreen.key('\x1b', 0x45)
    expect(rt.directScreen.isOpen).toBe(false)
    expect(rt.currentIndex).toBe(0)
  })

  /**
   * `Ed_Escape` (+Edit.s:8876) is entry 28 of the editor's own command table
   * and `Esc_Esc` (:9125) is the way back, so Escape is one key that goes both
   * ways. Going back down has to give a screen that works, not the husk of the
   * one that was closed: `Esc_Appear` builds it every time.
   */
  it('opens again after it has been closed, with a working line editor', () => {
    const rt = open()
    rt.directScreen.key('\x1b', 0x45)
    expect(rt.directScreen.isOpen).toBe(false)
    rt.directScreen.open()
    expect(rt.directScreen.isOpen).toBe(true)
    expect(rt.currentIndex).toBe(9)
    let out = ''
    rt.onDirectText = (t) => (out += t)
    for (const c of 'Print 21*2') rt.directScreen.key(c)
    rt.directScreen.key('\r', 0x44)
    for (let i = 0; i < 4; i++) rt.frame()
    expect(out).toBe(' 42\n')
  })
})

describe('the bar that closes off the escape screen (Ed_Enlarge +Edit.s:13793)', () => {
  it('reaches both edges, with the bar\'s own caps on them', () => {
    /*
     * `Es_Pics+2` is 480 wide and `Ed_Sx` is 640 (+Editor_Config.s:30), so
     * `Esc_Appear` draws it once at x=0 and then calls `Ed_Enlarge`: one
     * `L_ScCopy` of (160,y1)-(480,y1+8) to (320,y1), whose registers are
     * `D0=X1 D1=Y1 D2=X3 D3=Y3 D4=X2 D5=Y2` (+Lib.s:25398). The middle 320
     * columns move 160 right and the right cap lands on the right edge.
     *
     * This port tiled the picture instead, which put a right cap at 478 and a
     * fresh LEFT cap at 480 -- a notch three-quarters of the way along.
     */
    const rt = new Runtime(tokenize('Stop', table), table, { maxSteps: 200_000 })
    rt.runHeadless(50)
    rt.directScreen.open()
    rt.runHeadless(5)
    const s = rt.screens.get(9)!
    expect(s.width).toBe(640)
    const y = s.height - 4 // inside the bar, below its bevel
    // the two-pixel highlight on the left and the two-pixel shadow on the right
    expect([s.point(0, y), s.point(1, y)]).toEqual([5, 5])
    expect([s.point(638, y), s.point(639, y)]).toEqual([2, 2])
    // and nothing but fill in between: no second cap where the tile used to end
    for (let x = 2; x < 638; x++) expect([x, s.point(x, y)]).toEqual([x, 6])
  })
})

describe('the editor resource bank (Ed_ResourceLoad +Edit.s:4738)', () => {
  it('decodes, and holds the pictures at the numbers the editor names', () => {
    // +Edit.s:106-113 counts them out: Ed_Pics 1, Ed_BtPics +4, then twelve
    // editor buttons of two, three memory pictures, the escape screen's
    // three, and thirteen escape buttons of two
    const parsed = parseAmosFile(EDITOR_RESOURCE_BANK)
    const mem = parsed.banks.find((b) => 'data' in b) as { data: Uint8Array }
    const g = parseResourceBank(mem.data).graphics!
    expect(g.count).toBe(116)
    expect(g.nColors).toBe(8)
    // Es_Pics: the 128x16 title (Es_TitleSx x Es_TitleSy), the 16x8 right
    // border tile and the 480x8 bottom bar
    expect([g.image(ED_PICS.escape)!.width, g.image(ED_PICS.escape)!.height]).toEqual([128, 16])
    expect([g.image(ED_PICS.escape + 1)!.width, g.image(ED_PICS.escape + 1)!.height]).toEqual([16, 8])
    expect([g.image(ED_PICS.escape + 2)!.width, g.image(ED_PICS.escape + 2)!.height]).toEqual([480, 8])
    // and 26 buttons at Es_BoutonsSx x Es_BoutonsSy, two per button
    for (let i = 0; i < 26; i++) {
      const p = g.image(ED_PICS.escapeButtons + i)!
      expect([i, p.width, p.height]).toEqual([i, 32, 16])
    }
  })

  it('puts the licence notice on the escape screen, in AMOS\'s own words', () => {
    // the resource bank's licence asks for the copyright notice on the boot
    // screen, and ED_MESSAGES 20-22 is what AMOS itself puts there. The two
    // accented characters had to come out of the assembled binary: the
    // vendored +Editor_Config.s has EF BF BD where they were.
    expect(ED_MESSAGES[21]).toBe('By Fran\xe7ois Lionet')
    expect(ED_MESSAGES[22]).toBe('\xa9 1992 Europress Software Ltd.')
    const rt = new Runtime(tokenize('Stop', table), table, {})
    rt.runHeadless(200)
    rt.directScreen.open()
    const s = rt.screens.get(9)!
    // the title bar is the bank's, so it is not blank
    let lit = 0
    for (let y = 0; y < 16; y++) for (let x = 0; x < s.width; x++) if (s.point(x, y) !== 0) lit++
    expect(lit).toBeGreaterThan(1000)
  })
})

describe('the escape screen buttons (Esc_Bouton +Edit.s:8955)', () => {
  function open(): Runtime {
    const rt = new Runtime(tokenize('Screen Open 0,320,200,16,Lowres : Curs Off\nA=5\nStop', table), table, {})
    for (let i = 0; i < 4; i++) rt.frame()
    rt.directScreen.open()
    return rt
  }
  const line = (rt: Runtime): string => (rt.directScreen as unknown as { line: string }).line

  it('F1-F10 type the editor\'s twenty macros, F11-F20 on Shift', () => {
    // Esc_BtFonc reads system message 24+n (+Edit.s:9152), and Ed_GetSysteme
    // is 1-based, so F1 is ED_SYSTEME[23]
    const rt = open()
    rt.directScreen.key('', 0x53) // F4: "Dir$='", no backtick, so it waits
    expect(line(rt)).toBe("Dir$='")
    rt.directScreen.key('', 0x57) // F8: "Load Iff '"
    expect(line(rt)).toBe("Load Iff '")
    rt.directScreen.key('', 0x50, true) // Shift-F1 is F11: "Screen Close "
    expect(line(rt)).toBe('Screen Close ')
  })

  it('runs the macro at once when it ended in a backtick', () => {
    // `.Test` copies until the backtick, strips it and falls through to
    // Esc_R --- the Return path. Half of them do and half wait.
    const rt = open()
    let out = ''
    rt.onDirectText = (t) => (out += t)
    rt.directScreen.key('', 0x51) // F2 is "Default`"
    expect(line(rt)).toBe('')
    for (let i = 0; i < 6; i++) rt.frame()
    expect(rt.inDirect).toBe(false)
  })

  it('maps a click to the button under it and the button under it to a key', () => {
    // 1 at the left edge, 2 pinned right, then the run from Es_BoutonsX;
    // button n is function n-3 (`.Pa3` leaves d1 at n-4, 0-based)
    const rt = open()
    const at = (n: number): void => {
      const s = rt.screens.get(9)!
      const x = n === 1 ? 8 : n === 2 ? 640 - 16 : 160 + (n - 3) * 32 + 8
      rt.input.mouseX = s.displayX + Math.floor(x / 2)
      rt.input.mouseY = s.displayY + 8
    }
    at(7) // button 7 is function 4: "Dir$='"
    rt.input.mouseK = 1
    rt.frame()
    expect(line(rt)).toBe("Dir$='")
    rt.input.mouseK = 0
    rt.frame()
    // the right button adds ten: button 6 is normally F3 ("Dir`", which runs
    // and clears the line) and becomes F13, which waits
    at(6)
    rt.input.mouseK = 2
    rt.frame()
    expect(line(rt)).toBe('Wind Open ')
  })

  it('button 1 shuts the screen, as Esc_Esc does', () => {
    const rt = open()
    const s = rt.screens.get(9)!
    rt.input.mouseX = s.displayX + 4
    rt.input.mouseY = s.displayY + 8
    rt.input.mouseK = 1
    rt.frame()
    expect(rt.directScreen.isOpen).toBe(false)
    expect(rt.currentIndex).toBe(0)
  })

  it('button 3 remembers which way up it is, and nothing else', () => {
    // DEFECT: reproduced. Esc_Output is written by the button (+Edit.s:8994)
    // and read back by the button (:9313), and nothing in the editor reads it
    const rt = open()
    const out = (): number => (rt.directScreen as unknown as { output: number }).output
    expect(out()).toBe(0)
    rt.directScreen.press(3)
    expect(out()).toBe(1)
    rt.directScreen.press(3)
    expect(out()).toBe(0)
  })

  it('button 2 puts AMOS behind, which is what Ed_Wb calls', () => {
    // Ed_Wb (+Edit.s:11201) is `EcCalD AMOS_WB,0`, the same call InAmosToBack
    // makes (+Lib.s:11367)
    const rt = open()
    expect(() => rt.directScreen.press(2)).not.toThrow()
  })
})

describe('the escape screen over a running program', () => {
  it('holds the interpreter and lets the rest of the machine run', () => {
    // `Runtime.frame` keeps the copper, the bobs and the AUDIO CLOCK turning
    // while the escape screen is up, because a stopped program leaves those
    // running on the machine --- Paula does not stop because the editor is on
    // screen. Stalling the whole frame starved the mixer, and a typed `Say`
    // handed over 0.7 seconds of PCM that was never rendered.
    const rt = new Runtime(tokenize('A=0\nDo\nInc A\nWait Vbl\nLoop', table), table, { maxSteps: 500_000 })
    for (let i = 0; i < 10; i++) rt.frame()
    rt.directScreen.open()
    const frames = rt.frames
    const a = () => (rt.interp.frames[0]!.vars.get('a') as { v: number } | undefined)
    const before = a()
    for (let i = 0; i < 20; i++) rt.frame()
    // the machine advanced
    expect(rt.frames).toBe(frames + 20)
    // the program did not
    expect(a()).toEqual(before)
  })

  it('keeps a program\'s rainbow off the escape screen', () => {
    // DEVIATION: the reason is in display.ts. A rainbow writes its
    // register every line of its span whatever is in front, which is right,
    // and on the machine Escape leaves the program's display so the case
    // never arises. Overlaying it here made a demo cycling colour 3 down the
    // raster repaint the editor's own text with it.
    const prog = [
      'Screen Open 0,320,200,16,Lowres : Curs Off : Cls 0',
      'Set Rainbow 0,3,64,"(1,1,15)(1,-1,15)","(1,2,7)(1,-2,7)","(1,1,15)"',
      'Rainbow 0,0,50,200',
      'Do',
      '  Wait Vbl',
      'Loop',
    ].join('\n')
    const rt = new Runtime(tokenize(prog, table), table, { maxSteps: 500_000 })
    for (let i = 0; i < 20; i++) rt.frame()
    rt.directScreen.open()
    for (let i = 0; i < 10; i++) rt.frame()
    const s9 = rt.screens.get(9)!
    // the editor's display covers the program, so the rainbow has nothing of
    // it to colour --- and RainHide has masked the rainbow anyway
    expect(rt.rainbowsOn).toBe(false)
    // the text is pen 2, which nothing flashes; register 3 is the cursor's
    // and IS expected to move
    expect(s9.palette[2]).toBe(0x077)
    const { width, data } = rt.composite()
    const row = (s9.displayY + 20) * 2
    let lit = 0
    for (let x = 0; x < width; x++) {
      const o = (row * width + x) * 4
      // $077 is 0,119,119
      if (data[o] === 0 && data[o + 1] === 119 && data[o + 2] === 119) lit++
    }
    expect(lit).toBeGreaterThan(0)
  })
})

describe('the escape screen s window is system message 16', () => {
  /**
   * `Esc_Appear` (+Edit.s:9463) prints it and nothing else:
   *
   *     ESC C0  ESC J7  ESC B2  ESC P3  ESC D1  chr(25)
   *     ESC V0  chr(30) chr(30) ESC V1  ESC B2  ESC P3  ESC J1
   *
   * The port used to set paper, pen and cursor colour by hand and got two of
   * the three wrong.
   */
  it('takes its paper, its pen and its cursor colour from the message', () => {
    const rt = new Runtime(tokenize('Print "A"', table), table, { maxSteps: 200_000 })
    rt.runHeadless(200)
    rt.directScreen.open()
    const w = rt.screens.get(9)!.windows.get(1)!
    expect([w.paper, w.pen, w.cuCol]).toEqual([2, 3, 1])
  })

  it('flashes colour 1, which is the same register the editor s caret uses', () => {
    // `Dia_RScOpen`'s `.Fl` (+Lib.s:21021) runs `EcCall Flash` with
    // interpreter message 46 on the cursor colour, and `Ed_OpenIt` asks for 1
    // on `EcEdit`. The escape screen is drawn on that same screen and message
    // 16's `ESC D1` puts its cursor in the same register, so direct mode's
    // caret pulses for exactly the reason the editor's does.
    const rt = new Runtime(tokenize('Print "A"', table), table, { maxSteps: 200_000 })
    rt.runHeadless(200)
    rt.directScreen.open()
    const fl = rt.flashes.find((f) => f.reg === 1 && f.screen === 9)
    expect(fl).toBeDefined()
    expect(fl!.seq.length).toBeGreaterThan(1)
  })
})
