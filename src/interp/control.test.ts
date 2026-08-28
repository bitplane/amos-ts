import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from '../runtime/runtime'
import { AmigaFS } from '../amiga/vfs'
import { amosErrorCode, type AmosError } from './values'

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

  it('Resume Label records, and the bare form is the one that jumps (InResumeLabel +ILib.s:1916)', () => {
    // `bsr Finie / beq.s ResL1` splits the two forms. The named one stores
    // the label and returns, so the rest of the handler still runs.
    // the target is named as a STRING, because a bare label token is resolved
    // by the verifier inside the procedure that wrote it and ResL1's PopP has
    // left that procedure by the time the jump happens. GetLabel's GLb1
    // ("une expression") is the form that reaches the main program.
    const prog = [
      'On Error Proc H',
      'Error 1',
      'Print "not reached"',
      'End',
      'AFTER:',
      'Print "recovered"',
      'End',
      'Procedure H',
      '  Resume Label "AFTER"',
      '  Print "handler continues"',
      '  Resume Label',
      'End Proc',
    ].join('\n')
    expect(run(prog).out).toBe('handler continues\nrecovered\n')
  })

  it('Resume Label needs an On Error PROC, not a Goto (NoOnErr +ILib.s:1922)', () => {
    // `tst.w ErrorChr(a5) / bpl NoOnErr` — bit 31 is what On Error Proc sets,
    // and error 5 says so in as many words
    const prog = ['On Error Goto H', 'Error 1', 'End', 'AFTER:', 'End', 'H:', 'Resume Label "AFTER"'].join('\n')
    expect(() => run(prog)).toThrow(/No ON ERROR PROC/)
  })

  it('a bare Resume Label outside an error is error 7 (NoErr +ILib.s:1936)', () => {
    expect(() => run('Resume Label')).toThrow(/Resume without error/)
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
