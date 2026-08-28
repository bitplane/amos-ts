import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from '../runtime/runtime'
import { AmigaFS } from '../amiga/vfs'
import { amosErrorCode, type AmosError } from './values'
import { Interp } from './interp'
import { BufferIO } from './io'

const table = new TokenTable(CORE_TOKENS)

function run(src: string, keys?: string): { rt: Runtime; out: string } {
  let out = ''
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  const rt = new Runtime(tokenize(src, table), table, {
    maxSteps: 300_000,
    fs,
    onText: (t) => (out += t),
  })
  if (keys !== undefined) {
    for (const ch of keys) rt.input.keyQueue.push({ ch, scan: 0 })
    rt.input.keyQueue.push({ ch: '\r', scan: 68 })
  }
  const r = rt.runHeadless(2_000)
  mustFinish(r)
  return { rt, out }
}

describe('user-defined functions (Fn / Def Fn)', () => {
  it('Fn evaluates the stored expression with its parameters bound', () => {
    expect(run('Def Fn SQ(X)=X*X\nPrint Fn SQ(7)').out).toBe(' 49\n')
    expect(run('Def Fn AD(A,B)=A+B*2\nPrint Fn AD(3,4)').out).toBe(' 11\n')
  })

  it('parameters are NOT local — the call overwrites the variable of that name', () => {
    // FnFn (+ILib.s:4206) resolves each parameter with FindVar and pokes the
    // argument into that ordinary variable, with no save/restore around the
    // call. So a Def Fn parameter clobbers a global of the same name, and a
    // program that relies on X afterwards sees the argument, not its old value.
    const { out } = run(['X=100', 'Def Fn DBL(X)=X*2', 'Print Fn DBL(5)', 'Print X'].join('\n'))
    expect(out).toBe(' 10\n 5\n')
  })

  it('a string function returns a string', () => {
    expect(run('Def Fn J$(A$,B$)=A$+"-"+B$\nPrint Fn J$("a","b")').out).toBe('a-b\n')
  })

  it('the two ways Fn fails have numbers of their own, not 23', () => {
    // FnNDef (+ILib.s:4265) is `moveq #15,d0` and FnIlNb (+ILib.s:4263) is
    // `moveq #16,d0`. Both used to arrive numberless and report 23, which is
    // the message a program printing Errn$ would have shown.
    const code = (src: string): number => {
      try {
        run(src)
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    // InDFn (+ILib.s:4194) pokes the body pointer into the variable at RUN
    // time and FnFn opens `move.l (a0),d0 / beq FnNDef`, so a Def Fn the
    // program jumped over leaves the slot empty. The name still resolves,
    // which is why the Test pass lets this through.
    expect(code(['Goto SKIP', 'Def Fn SQ(X)=X*X', 'SKIP:', 'Print Fn SQ(2)'].join('\n'))).toBe(15)
    expect(code('Def Fn SQ(X)=X*X\nPrint Fn SQ(1,2)')).toBe(16)
    // and a string argument against a numeric parameter is TypeMis, 34.
    // FnFn (+ILib.s:4237) tests the two types separately: `cmp.b #1,d1` for
    // the parameter and, at FFn2, `cmp.b #1,d2 / bhi TypeMis` for the
    // argument. Only 2 is above 1, so int against float coerces and either
    // side being a string is the error.
    expect(code('Def Fn SQ(X)=X*X\nPrint Fn SQ("a")')).toBe(34)
  })
})

describe('Not as a prefix operator (FnNot — a fresh New_Evalue)', () => {
  it('swallows the whole rest of the expression rather than binding tightly', () => {
    // Not A=1 or B=2 parses as Not(A=1 or B=2), so with A=1 the result is 0
    expect(run('A=1 : B=0 : Print Not A=1 or B=2').out).toBe(' 0\n')
    // and with neither true, Not(false) is -1
    expect(run('A=9 : B=0 : Print Not A=1 or B=2').out).toBe('-1\n')
  })
})

describe('Every (interrupt-driven Gosub/Proc)', () => {
  it('Every takes 1 to 32766, and Error clamps at 255', () => {
    const code = (src: string): number => {
      try {
        run(src)
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    // InEvery +ILib.s:2040: `tst.l d3 / beq FonCall / cmp.l #32767,d3 / bcc
    // FonCall`, and bcc fires ON 32767
    expect(code('Every 0 Gosub T\nEnd\nT:\nReturn')).toBe(23)
    expect(code('Every -1 Gosub T\nEnd\nT:\nReturn')).toBe(23)
    expect(code('Every 32767 Gosub T\nEnd\nT:\nReturn')).toBe(23)
    expect(code('Every 32766 Gosub T\nEnd\nT:\nReturn')).toBe(0)
    // InError +Lib.s:11396 clamps with an UNSIGNED compare, so a negative
    // arrives at 255 as well
    expect(code('Error 300')).toBe(255)
    expect(code('Error -1')).toBe(255)
    expect(code('Error 255')).toBe(255)
    expect(code('Error 23')).toBe(23)
  })

  it('Every On/Off gate the periodic call without forgetting it', () => {
    const prog = [
      'N=0',
      'Every 2 Gosub TICK',
      'Every Off',
      'For I=0 To 400 : Next I',
      'Print N',
      'End',
      'TICK:',
      'N=N+1',
      'Return',
    ].join('\n')
    // with Every Off nothing fires however long we spin
    expect(run(prog).out).toBe(' 0\n')
  })

  it('Every needs a Gosub or Proc target', () => {
    // `V1_Every` (+Verif.s:2281) reads the token after the count and takes
    // only _TkGsb or _TkPrc, so this never reaches the interpreter
    expect(() => run('Every 2 Print "x"')).toThrow(/Syntax error/)
  })

  it('Every On re-arms a handler that was switched off', () => {
    const { rt } = run(['Every 50 Gosub T', 'Every Off', 'Every On', 'End', 'T:', 'Return'].join('\n'))
    expect(rt.interp.every?.on).toBe(true)
  })
})

describe('error handling (Resume / Resume Label)', () => {
  it('Resume retries the statement that failed', () => {
    const prog = [
      'Dim A(2)',
      'A(1)=42',
      'On Error Goto H',
      'I=9',
      'Print A(I)',
      'End',
      'H:',
      'I=1',
      'Resume',
    ].join('\n')
    // the subscript is out of range, the handler repairs I, and Resume runs
    // the *same* statement again — which now succeeds
    expect(run(prog).out).toBe(' 42\n')
  })

  it('Resume Label records in the MAIN program, and the bare form jumps (InResumeLabel +ILib.s:1916)', () => {
    // `bsr Finie / beq.s ResL1` splits the two forms. The named one writes
    // ErrorChr and returns; the bare one pops the procedure and jumps there.
    //
    // The recording form cannot go in the handler. Its first test is `tst.l
    // OnErrLine(a5) / beq NoOnErr`, InResumeLabel (+ILib.s:1921), and CallProc clears
    // OnErrLine on the way in (+ILib.s:2603), so inside a handler procedure
    // it is error 5. What it writes is ErrorChr, which CallProc only SAVES
    // (+ILib.s:2587) — so the bare form's PopP restores the caller's copy and
    // reads the label back out of it.
    //
    // the target is named as a STRING, because a bare label token is resolved
    // by the verifier inside the procedure that wrote it. GetLabel's GLb1
    // ("une expression") is the form that reaches the main program.
    const prog = [
      'On Error Proc H',
      'Resume Label "AFTER"',
      'Error 23',
      'Print "not reached"',
      'End',
      'AFTER:',
      'Print "recovered"',
      'End',
      'Procedure H',
      '  Print "handler continues"',
      '  Resume Label',
      'End Proc',
    ].join('\n')
    expect(run(prog).out).toBe('handler continues\nrecovered\n')
    // and the same program with the recording moved into the handler is 5
    const inHandler = [
      'On Error Proc H',
      'Error 23',
      'End',
      'AFTER:',
      'End',
      'Procedure H',
      '  Resume Label "AFTER"',
      '  Resume Label',
      'End Proc',
    ].join('\n')
    expect(() => run(inHandler)).toThrow(/No ON ERROR PROC/)
  })

  it('Resume Label needs an On Error PROC, not a Goto (NoOnErr +ILib.s:1922)', () => {
    // `tst.w ErrorChr(a5) / bpl NoOnErr` — bit 31 is what On Error Proc sets,
    // and error 5 says so in as many words
    const prog = ['On Error Goto H', 'Error 23', 'End', 'AFTER:', 'End', 'H:', 'Resume Label "AFTER"'].join('\n')
    expect(() => run(prog)).toThrow(/No ON ERROR PROC/)
  })

  it('a bare Resume Label outside an error is error 7 (NoErr +ILib.s:1936)', () => {
    expect(() => run('Resume Label')).toThrow(/Resume without error/)
  })

  it('Pop Proc cannot leave an error handler — Resume is the only way out', () => {
    // RPopPro (+ILib.s:2699) opens `tst.w ErrorOn(a5) / bne EProErr`, and
    // EProErr (+ILib.s:1178) is `moveq #8,d0`. The test is BEFORE the `[`,
    // so a Pop Proc carrying a value is refused just the same.
    const prog = ['On Error Proc H', 'Error 23', 'End', 'Procedure H', '  Pop Proc', 'End Proc'].join('\n')
    expect(() => run(prog)).toThrow(/must RESUME/)
    const valued = ['On Error Proc H', 'Error 23', 'End', 'Procedure H', '  Pop Proc[1]', 'End Proc'].join('\n')
    expect(() => run(valued)).toThrow(/must RESUME/)
    // and outside a handler it is the ordinary early return
    const ok = ['T', 'Print Param', 'Procedure T', '  Pop Proc[7]', 'End Proc'].join('\n')
    expect(run(ok).out).toBe(' 7\n')
  })

})

describe('interpreter no-ops that must still parse', () => {
  it('Break On/Off do not disturb the program that sets them', () => {
    // what they DO is one bit each, tested against a real Ctrl-C in
    // cluster.test.ts; this is only that the statements run
    expect(run('Break Off : Print "a" : Break On : Print "b"').out).toBe('a\nb\n')
  })

  it('Command Line$ is empty when nothing invoked the program', () => {
    expect(run('Print Len(Command Line$)').out).toBe(' 0\n')
  })

  it('Command Line$ = stores what the function reads back (InCommandLine)', () => {
    expect(run('Command Line$="df0:game 3" : Print Command Line$').out).toBe('df0:game 3\n')
  })

  it('Command Line$ = errors at 256 characters (+Lib.s:7871 cmp.w #256)', () => {
    expect(run('Command Line$=String$("x",255) : Print Len(Command Line$)').out).toBe(' 255\n')
    expect(() => run('Command Line$=String$("x",256)')).toThrow(/Illegal function call/)
  })
})

describe('Line Input', () => {
  /** Run until the program blocks for input, returning what it printed first. */
  function untilBlocked(src: string): { rt: Runtime; out: string; status: string } {
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, onText: (t) => (out += t) })
    const r = rt.runHeadless(2_000)
    return { rt, out, status: r.status }
  }

  it('emits its prompt before reading', () => {
    const { out } = untilBlocked('Line Input "name? ";A$ : Print "[";A$;"]"')
    expect(out.startsWith('name? ')).toBe(true)
  })

  it('takes one whole line per variable (InnPut +ILib.s:4912)', () => {
    // InLineInput pushes a zero separator, so Inn2 copies to the end of the
    // line and the comma in `A$,B$` sends Inn10 back for a second one
    const io = new BufferIO(['one,two', 'three'])
    const it = new Interp(tokenize('Line Input A$,B$ : Print A$;"|";B$', table), table, { io, maxSteps: 100_000 })
    it.run()
    expect(io.out).toContain('one,two|three')
  })

  it('Input splits one line at the commas instead (InInput +ILib.s:4829)', () => {
    const io = new BufferIO(['one,two'])
    const it = new Interp(tokenize('Input A$,B$ : Print A$;"|";B$', table), table, { io, maxSteps: 100_000 })
    it.run()
    expect(io.out).toContain('one|two')
  })

  it('Input asks again when the line runs out of fields (Inn10 InnEnc)', () => {
    // `cmp.b #",",(a2)+` fails on a short line, and the routine prints "?"
    // and reads a whole fresh one rather than leaving the variable empty
    const io = new BufferIO(['one', 'two'])
    const it = new Interp(tokenize('Input A$,B$ : Print A$;"|";B$', table), table, { io, maxSteps: 100_000 })
    it.run()
    expect(io.out).toContain('one|two')
  })

  it('types at the console cursor, no separate input box', () => {
    // AMOS reads Input where the cursor is, echoing as you type. Keys arrive
    // through the same queue Inkey$ reads, so this drives it exactly as the
    // browser does — there is nothing web-specific about the line editor.
    // frame() rather than runHeadless, which deliberately fast-forwards a
    // pending Input with an empty line so a census cannot hang on one
    let out = ''
    const rt = new Runtime(tokenize('Line Input "name? ";A$ : Print "[";A$;"]"', table), table, {
      maxSteps: 300_000,
      onText: (t) => (out += t),
    })
    const step = (n = 3): void => {
      for (let i = 0; i < n; i++) rt.frame()
    }
    step()
    expect(out).toBe('name? ')
    for (const ch of 'Gaz') rt.pressKey(ch)
    step()
    expect(out).toBe('name? Gaz') // echoed as typed
    rt.pressKey('\r')
    step()
    expect(out).toBe('name? Gaz\n[Gaz]\n')
  })

  it('backspace rubs the character out rather than only moving the cursor', () => {
    // the console's own backspace steps left without erasing, so the editor
    // writes back-space-back to actually clear the glyph
    let out = ''
    const rt = new Runtime(tokenize('Line Input A$ : Print "[";A$;"]"', table), table, {
      maxSteps: 300_000,
      onText: (t) => (out += t),
    })
    rt.frame()
    for (const ch of 'abX') rt.pressKey(ch)
    rt.pressKey('\x08')
    rt.pressKey('c')
    rt.pressKey('\r')
    for (let i = 0; i < 3; i++) rt.frame()
    expect(out).toBe('? abX\x08 \x08c\n[abc]\n')
  })

  it('a backspace on an empty line does nothing', () => {
    let out = ''
    const rt = new Runtime(tokenize('Line Input A$ : Print "[";A$;"]"', table), table, {
      maxSteps: 300_000,
      onText: (t) => (out += t),
    })
    rt.frame()
    rt.pressKey('\x08')
    rt.pressKey('\r')
    for (let i = 0; i < 3; i++) rt.frame()
    expect(out).toBe('? \n[]\n')
  })

  it('without a prompt string it still prints the "? " prompt', () => {
    // Line Input prompts like Input does; headless nobody types, so the line
    // comes back empty and the echoed newline lands before the next Print
    const { out } = untilBlocked('Line Input A$ : Print "[";A$;"]"')
    expect(out).toBe('? \n[]\n')
  })
})

describe('banks and storage', () => {
  it('Erase All frees every bank at once', () => {
    const { out } = run(
      ['Reserve As Work 5,100', 'Reserve As Work 6,100', 'Erase All', 'Print Length(5);Length(6)'].join(
        '\n',
      ),
    )
    // Length of a freed bank is 0
    expect(out).toBe(' 0 0\n')
  })

  it('Reserve As Chip Data allocates a bank of the requested size', () => {
    expect(run('Reserve As Chip Data 7,256\nPrint Length(7)').out).toBe(' 256\n')
  })

  /**
   * `=Dfree` (+Lib.s:4938) takes no argument: it copies `PathAct` -- the
   * CURRENT path -- into Name1, locks that, calls Info() and returns
   * (id_NumBlocks - id_NumBlocksUsed) * id_BytesPerBlock. `Disc Info$`
   * (:4995) is the same three lines after the volume name.
   *
   * A memory volume has no capacity of its own to report, so both fall back
   * to the stand-in rather than claiming the store is full. The measured case
   * is a real disk image and lives in ../amiga/adf.test.ts.
   */
  it('Dfree reports the free space of the current drive', () => {
    expect(run('Print Dfree>0').out).toBe('-1\n')
  })

  it('Disc Info$ names the volume and carries the same count in ten columns', () => {
    const { out } = run('A$=Disc Info$("DH0:")\nPrint Left$(A$,4);"|";Len(A$)-4;"|";Str$(Dfree)=" "+Mid$(A$,5,10)')
    // "DH0:" then the count left-aligned in a ten-character field, and it is
    // the same number =Dfree gives -- Str$ of a positive integer leads with a
    // space, which is the only difference
    expect(out).toBe('DH0:| 10|-1\n')
  })

  it('Dir lists a directory without disturbing the program', () => {
    const { out } = run('Dir "DH0:"\nPrint "after"')
    expect(out.endsWith('after\n')).toBe(true)
  })
})

describe('For takes the loop variable\'s type for all three values', () => {
  // InFor (+ILib.s:2073) runs the start, the limit and the step each through
  // MMType (+ILib.s:2109), `cmp.b d1,d2 / bne.s MMt1 / rts` and then FlToInt1
  // or IntToFl1. All three take the VARIABLE's type, not their own.
  const ran = (loop: string): string =>
    run(`N=0\n${loop}\nN=N+1\nNext\nPrint N`).out.trim()

  it('truncates a fractional step on an integer variable', () => {
    // step 0, so Next adds nothing and `tst.l d3 / bpl.s next1` takes the
    // positive branch, where 10 is already past the limit. InFor makes no
    // initial test, so the body has run once by then.
    expect(ran('For A=10 To 1 Step -0.5')).toBe('1')
    // the same loop on a float variable keeps the step and counts down
    expect(ran('For B#=10 To 1 Step -0.5')).toBe('19')
  })

  it('truncates a fractional limit on an integer variable', () => {
    expect(ran('For C=1 To 10.7')).toBe('10')
    expect(ran('For D#=1 To 10.7')).toBe('10')
  })
})

describe('error trapping', () => {
  const code = (src: string): number => {
    try {
      run(src)
      return 0
    } catch (e) {
      return amosErrorCode(e as AmosError)
    }
  }

  it('re-arming On Error inside a handler that has not resumed is error 3', () => {
    // InOnError (+ILib.s:1878) opens `tst.w ErrorOn(a5) / bne NoResum`, and
    // NoResum (+ILib.s:1202) is `moveq #3,d0`. The port cleared ErrorOn here
    // instead, which let a handler quietly re-arm itself and never resume.
    const src = ['On Error Goto HND', 'Error 30', 'End', 'HND:', 'Print "in"', 'On Error Goto HND', 'Resume Next']
    expect(code(src.join('\n'))).toBe(3)
    // and the ordinary arm-then-resume path still works
    src[5] = 'Print "ok"'
    expect(run(src.join('\n')).out).toBe('in\nok\n')
  })

  it('On Error Goto 0 switches trapping off rather than naming a label', () => {
    // `cmp.w #_TkEnt,(a6) / bne.s OnEg1 / move.l 2(a6),d0 / bne.s OnEg1 /
    // addq.l #6,a6` steps over the token and its longword and returns with
    // OnErrLine already cleared. It never reaches GetLabel, so the digits are
    // not a label name — the port used to raise "label not defined: 0".
    expect(code('On Error Goto 0\nError 30')).toBe(30)
    expect(code(['On Error Goto HND', 'On Error Goto 0', 'Error 30', 'End', 'HND:', 'Resume Next'].join('\n'))).toBe(30)
  })

  it('an On Error Proc handler cannot Resume to a label', () => {
    // ResP (+ILib.s:1969) is `bsr Finie / bne ResPLab`, and ResPLab
    // (+ILib.s:1196) is `moveq #4,d0`. PopP has to run on the way out, so the
    // named form is Resume Label; plain `Resume LBL` would jump with the
    // procedure still stacked.
    const proc = ['On Error Proc HND', 'Error 30', 'Print "no"', 'End', 'Procedure HND', 'Resume BACK', 'BACK:', 'End Proc']
    expect(code(proc.join('\n'))).toBe(4)
    // the bare Resume is the form that works, and it pops the procedure
    const ok = ['On Error Proc HND', 'Error 30', 'Print "after"', 'End',
      'Procedure HND', 'Print "in"', 'Resume Next', 'End Proc']
    expect(run(ok.join('\n')).out).toBe('in\nafter\n')
  })

  it('a called procedure does not inherit the caller\'s On Error', () => {
    // CallProc pushes OnErrLine, ErrorChr and ErrorOn (+ILib.s:2586) and then
    // does `clr.l OnErrLine(a5)` (+ILib.s:2603); End Proc pops all three back
    // (+ILib.s:2651). So an error inside a procedure is untrapped even when
    // the caller armed a handler, and the handler is live again on return.
    const inside = ['On Error Goto HND', 'Proc BAD', 'Print "no"', 'End',
      'HND:', 'Print "caught"', 'Resume Next', 'Procedure BAD', 'Error 30', 'End Proc']
    expect(code(inside.join('\n'))).toBe(30)
    const after = ['On Error Goto HND', 'Proc OK', 'Error 30', 'Print "on"', 'End',
      'HND:', 'Print "caught"', 'Resume Next', 'Procedure OK', 'Print "in"', 'End Proc']
    expect(run(after.join('\n')).out).toBe('in\ncaught\non\n')
  })

  it('End Proc cannot leave an error handler either', () => {
    // `EPro1: tst.w ErrorOn(a5) / bne EProErr` (+ILib.s:2638) is the same test
    // Pop Proc makes, and the pair differ only in where it sits: End Proc has
    // already run FnEProc on the bracket by the time it looks.
    const src = ['On Error Proc HND', 'Error 30', 'Print "no"', 'End', 'Procedure HND', 'Print "in"', 'End Proc']
    expect(code(src.join('\n'))).toBe(8)
    // Resume is still the way out, and the caller's handler survives it
    const twice = ['On Error Proc HND', 'Error 30', 'Error 30', 'Print "done"', 'End',
      'Procedure HND', 'Print "in"', 'Resume Next', 'End Proc']
    expect(run(twice.join('\n')).out).toBe('in\nin\ndone\n')
  })

  it('Resume to a label outside any error is error 7, not a jump', () => {
    // `tst.w ErrorOn(a5) / beq NoErr` precedes the ErrorChr test, so the
    // no-error case answers 7 whichever form was written
    expect(code('Resume BACK\nBACK:')).toBe(7)
    expect(code('Resume')).toBe(7)
    expect(code('Resume Label')).toBe(7)
  })
})
