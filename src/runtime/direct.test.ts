import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'

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

  it('rejects a comment', () => rejects('Rem hello')) // VerRem +Verif.s:773
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
})
