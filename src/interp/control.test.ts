import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from '../runtime/runtime'
import { AmigaFS } from '../runtime/vfs'

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
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return { rt, out }
}

describe('user-defined functions (Fn / Def Fn)', () => {
  it('Fn evaluates the stored expression with its parameters bound', () => {
    expect(run('Def Fn SQ(X)=X*X\nPrint Fn SQ(7)').out).toBe(' 49\n')
    expect(run('Def Fn AD(A,B)=A+B*2\nPrint Fn AD(3,4)').out).toBe(' 11\n')
  })

  it('parameters are NOT local — the call overwrites the variable of that name', () => {
    // FnFn (+ILib.s:4235) resolves each parameter with FindVar and pokes the
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
    expect(() => run('Every 2 Print "x"')).toThrow(/Every needs Gosub or Proc/)
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

  it('Resume Label restarts execution at a named label', () => {
    const prog = [
      'On Error Goto H',
      'Error 1',
      'Print "not reached"',
      'End',
      'AFTER:',
      'Print "recovered"',
      'End',
      'H:',
      'Resume Label AFTER',
    ].join('\n')
    expect(run(prog).out).toBe('recovered\n')
  })

})

describe('interpreter no-ops that must still parse', () => {
  it('Break On/Off are accepted and do nothing observable', () => {
    // Ctrl-C trapping has no meaning here, but a program that sets it must
    // keep running rather than stop on a skipped keyword
    expect(run('Break Off : Print "a" : Break On : Print "b"').out).toBe('a\nb\n')
  })

  it('Command Line$ is empty when nothing invoked the program', () => {
    expect(run('Print Len(Command Line$)').out).toBe(' 0\n')
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

  it('Dfree reports the free space of the current drive', () => {
    // a freshly mounted RAM volume has room; the value is a byte count
    expect(run('Print Dfree>0').out).toBe('-1\n')
  })

  it('Dir lists a directory without disturbing the program', () => {
    const { out } = run('Dir "DH0:"\nPrint "after"')
    expect(out.endsWith('after\n')).toBe(true)
  })
})
