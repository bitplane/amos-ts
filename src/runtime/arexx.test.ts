/**
 * The ARexx families — AMOS's own `Arexx *` (+Lib.s:15025-15160) over the
 * public ports in `amiga/rexx.ts`, and LDos's `Lrexx *`, which sits on a
 * library this port does not model.
 *
 * The handshake is the whole of it: a program registers a named port, a
 * sender outside puts a message on it, the program reads the arguments and
 * replies with a code and — when asked — a string.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { RXFF_RESULT, rexxMessage } from '../amiga/rexx'

const table = new TokenTable(CORE_TOKENS)

function boot(src: string): { rt: Runtime; out: () => string } {
  let out = ''
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 500_000, onText: (t) => (out += t) })
  return { rt, out: () => out }
}

const run = (src: string): string => {
  const b = boot(src)
  mustFinish(b.rt.runHeadless(500))
  return b.out().trim()
}

/**
 * Open the port, park on a Wait Vbl so it really exists, post, then let the
 * rest run. A message cannot be posted before the program has registered the
 * port -- `post` answers false and drops it, which is what PutMsg to a port
 * that is not there does.
 */
function withMessage(rest: string, msg: ReturnType<typeof rexxMessage>): { rt: Runtime; out: () => string } {
  const b = boot(`Arexx Open "P"\nWait Vbl\n${rest}`)
  b.rt.frame()
  expect(b.rt.rexx.post('P', msg)).toBe(true)
  mustFinish(b.rt.runHeadless(200))
  return b
}

describe('Arexx Open', () => {
  it('registers a public port that Arexx Exist can then find', () => {
    // FnArexxExist is Arx_RegisterPort with d0 = 0, a lookup rather than a
    // registration
    expect(run('Print Arexx Exist("MYPORT") : Arexx Open "MYPORT" : Print Arexx Exist("MYPORT")')).toBe('0\n-1')
  })

  it('and names are case-sensitive, as exec FindPort is', () => {
    expect(run('Arexx Open "MYPORT" : Print Arexx Exist("myport")')).toBe('0')
  })

  it('refuses a name of 32 characters or more', () => {
    // `cmp.w #32,d2 / Rbcc L_StooLong`
    expect(() => run(`Arexx Open "${'A'.repeat(32)}"`)).toThrow(/too long/i)
    expect(() => run(`Arexx Open "${'A'.repeat(31)}"`)).not.toThrow()
  })

  it('and any character at or below a space', () => {
    // `cmp.b #" ",-1(a0) / Rble L_FonCall` -- so a name with a space in it is
    // a function-call error, not a port with a space in it
    expect(() => run('Arexx Open "MY PORT"')).toThrow(/function call/)
  })
})

describe('=Arexx and =Arexx$', () => {
  it('answers 0 with nothing waiting, 1 for a message, 2 when a result is wanted', () => {
    // FnArexx has three answers, not two: a program branches on 2 to decide
    // whether to bother building a result string
    expect(withMessage('Print Arexx', rexxMessage('DO SOMETHING')).out().trim()).toBe('1')
    expect(withMessage('Print Arexx', rexxMessage('DO SOMETHING', true)).out().trim()).toBe('2')
    expect(run('Arexx Open "P" : Print Arexx')).toBe('0')
  })

  it('Arexx$ reads the message arguments, 0 to 15', () => {
    const m = rexxMessage('COMMAND')
    m.args[1] = 'second'
    const b = withMessage('A=Arexx : Print "["+Arexx$(0)+"]["+Arexx$(1)+"]"', m)
    expect(b.out().trim()).toBe('[COMMAND][second]')
  })

  it('and answers the empty string for a slot that is not there', () => {
    // three separate `Rbeq L_Ret_ChVide` arms come out as one answer
    expect(withMessage('A=Arexx : Print "["+Arexx$(5)+"]"', rexxMessage('X')).out().trim()).toBe('[]')
    expect(run('Arexx Open "P" : Print "["+Arexx$(0)+"]"')).toBe('[]')
  })

  it('refuses an argument number of 16 or more', () => {
    // `cmp.l #16,d3 / Rbcc L_FonCall`
    expect(() => run('Arexx Open "P" : Print Arexx$(16)')).toThrow(/function call/)
  })
})

describe('Arexx Answer and Arexx Close', () => {
  it('replies with a code, and with a string when the sender asked for one', () => {
    const m = rexxMessage('X', true)
    withMessage('A=Arexx : Arexx Answer 0,"the result"', m)
    expect(m.replied).toBe(true)
    expect(m.result1).toBe(0)
    expect(m.result2).toBe('the result')
  })

  it('and drops the string when the sender did not', () => {
    // `and.l #RXFF_RESULT,d0 / beq .NoResult` -- dropped, not raised
    const m = rexxMessage('X') // no RXFF_RESULT
    expect(m.action & RXFF_RESULT).toBe(0)
    withMessage('A=Arexx : Arexx Answer 5,"ignored"', m)
    expect(m.result1).toBe(5)
    expect(m.result2).toBe('')
  })

  it('Arexx Close is error 198 while a message is still held', () => {
    // `tst.l Arx_Answer(a5) / bne .Err` -- what stops a sender waiting for a
    // reply that is never coming
    const b = boot('Arexx Open "P"\nWait Vbl\nA=Arexx : Arexx Close')
    b.rt.frame()
    b.rt.rexx.post('P', rexxMessage('X'))
    expect(() => mustFinish(b.rt.runHeadless(200))).toThrow(/not answered/i)
  })

  it('and takes the port away once the message is answered', () => {
    const b = withMessage('A=Arexx : Arexx Answer 0 : Arexx Close : Print Arexx Exist("P")', rexxMessage('X'))
    expect(b.out().trim()).toBe('0')
  })
})

describe('Arexx Wait', () => {
  it('waits, and comes back when a message arrives', () => {
    // InArexxWait is WaitMul then poll, round and round; with nothing sending
    // it waits for ever, which is what the machine does with no script
    const b = boot('Arexx Open "P"\nArexx Wait\nPrint "got"')
    b.rt.runHeadless(5)
    expect(b.out()).toBe('')
    expect(b.rt.rexx.post('P', rexxMessage('X'))).toBe(true)
    mustFinish(b.rt.runHeadless(200))
    expect(b.out().trim()).toBe('got')
  })
})

describe('LDos: the Lrexx family', () => {
  const ldos = extensionById('ldos-2.6')!
  const exts = new Map([[6, ldos.table]])
  const ld = (src: string): string => {
    let out = ''
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[6, ldos]]),
      maxSteps: 500_000,
      onText: (t) => (out += t),
    })
    mustFinish(rt.runHeadless(200))
    return out.trim()
  }

  it('reports the library it needs, in the library\'s own words', () => {
    // every routine opens by loading rexxhost.library's base from +$5a8 and
    // taking `moveq #$18,d0 / Rbra routine 91` when it is zero
    for (const src of [
      'A=Lrexx Make Host("HOST")',
      'Lrexx Remove Host',
      'A$=Lrexx Get Msg(0)',
      'A=Lrexx Execute("say hello")',
      'Lrexx Reply "x",0,0',
      // "22,2,0" --- a STRING function, so the result needs a string variable
      'A$=Lrexx Send Msg("PORT","cmd",0)',
    ]) {
      expect(() => ld(src), src).toThrow(/Missing part of ARexx/)
    }
  })

  it('but Result1 and Result2 do not check it, so they answer zero', () => {
    // four instructions each: a longword read from +$5b0 and +$5b4
    expect(ld('Print Lrexx Result1;" ";Lrexx Result2').split(/\s+/).map(Number)).toEqual([0, 0])
  })
})
