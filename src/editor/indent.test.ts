import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { detokLineBytes, tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { ProgramBuffer } from './buffer'
import { indentBytes } from './indent'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)

/** indent `text` with the shipped three-space tab and list what came out */
function run(text: string, tab = 3): string[] {
  const p = ProgramBuffer.load(tested(text))
  indentBytes(p.bytes, p.stBas, tab)
  return Array.from({ length: p.lineCount }, (_, i) => detokLineBytes(p.bytes, p.findLine(i).at, table))
}

describe('a loop', () => {
  it('puts its body in and takes it out again', () => {
    expect(run('Print 1\nFor I=0 To 9\nPrint I\nNext I\nPrint 2')).toEqual([
      'Print 1',
      'For I=0 To 9',
      '   Print I',
      'Next I',
      'Print 2',
    ])
  })

  it('nests, one tab a level', () => {
    expect(run('For I=0 To 9\nFor J=0 To 9\nPrint J\nNext J\nNext I')).toEqual([
      'For I=0 To 9',
      '   For J=0 To 9',
      '      Print J',
      '   Next J',
      'Next I',
    ])
  })

  it('moves nothing when it opens and closes on one line', () => {
    // `IndPls` counts up in d7 and `IndMns` counts down, and only a counter
    // that has gone NEGATIVE takes the tab off this line as well
    expect(run('Print 1\nFor I=0 To 9 : Next I\nPrint 2')).toEqual(['Print 1', 'For I=0 To 9 : Next I', 'Print 2'])
  })

  it('takes the same tab whatever it is called', () => {
    for (const [open, close] of [
      ['Repeat ', 'Until A=1'],
      ['While A=1', 'Wend '],
      ['Do ', 'Loop '],
    ]) {
      // the trailing spaces are `Detok`'s: a keyword whose spec starts `I`
      // is written with one after it
      expect(run(`${open}\nPrint 1\n${close}`)).toEqual([open, '   Print 1', close])
    }
  })
})

describe('If', () => {
  it('outdents its Else and nothing else', () => {
    expect(run('If A=1\nPrint 1\nElse\nPrint 2\nEnd If')).toEqual([
      'If A=1',
      '   Print 1',
      'Else ',
      '   Print 2',
      'End If ',
    ])
  })

  it('leaves a one-line If alone, because Then already took the tab back', () => {
    // `IndThen` falls through into `IndMns` (:8541) and raises d4, which is
    // the flag `IndElse` reads to do nothing at all
    expect(run('Print 1\nIf A=1 Then Print 2 Else Print 3\nPrint 4')).toEqual([
      'Print 1',
      'If A=1 Then Print 2 Else Print 3',
      'Print 4',
    ])
  })

  it('treats Else If like an Else', () => {
    expect(run('If A=1\nPrint 1\nElse If A=2\nPrint 2\nEnd If')).toEqual([
      'If A=1',
      '   Print 1',
      'Else If A=2',
      '   Print 2',
      'End If ',
    ])
  })
})

describe('a procedure', () => {
  it('starts at column 0 whatever it is inside', () => {
    expect(run('For I=0 To 9\nProcedure P\nPrint 1\nEnd Proc\nNext I')).toEqual([
      'For I=0 To 9',
      'Procedure P',
      '   Print 1',
      'End Proc',
      'Next I',
    ])
  })

  it('is skipped whole when it is closed, body and all', () => {
    const p = ProgramBuffer.load(tested('Print 1\nProcedure P\n      Print 2\nEnd Proc\nPrint 3'))
    const at = p.findLine(1).at
    p.setProcClosed(at, true)
    indentBytes(p.bytes, p.stBas, 3)
    p.countLines()
    expect(Array.from({ length: p.lineCount }, (_, i) => detokLineBytes(p.bytes, p.findLine(i).at, table))).toEqual([
      'Print 1',
      'Procedure P',
      'Print 3',
    ])
    // `IndPro` steps over the fold by the size at offset 4, so the six spaces
    // the body was written with are still there when it is opened again
    p.setProcClosed(at, false)
    p.countLines()
    expect(detokLineBytes(p.bytes, p.findLine(2).at, table)).toBe('      Print 2')
  })
})

describe('the indent byte itself', () => {
  it('is one more than the spaces, so a line at column 0 holds 1', () => {
    const p = ProgramBuffer.load(tested('Print 1\nFor I=0 To 9\nPrint 2\nNext I'))
    indentBytes(p.bytes, p.stBas, 3)
    expect(p.bytes[p.findLine(0).at + 1]).toBe(1)
    expect(p.bytes[p.findLine(2).at + 1]).toBe(4)
  })

  it('never goes below 1, however many closers a line carries', () => {
    // NOT tested first: the indenter counts openers and closers and never
    // asks whether they match, which is the only reason the floor is needed
    const p = ProgramBuffer.load(tokeniseSource('Next I : Next J : Next K', table).slice(0, -2))
    indentBytes(p.bytes, p.stBas, 3)
    // `IndFL` floors d5 at zero before it adds the one
    expect(p.bytes[p.findLine(0).at + 1]).toBe(1)
  })
})
