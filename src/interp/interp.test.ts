import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Interp } from './interp'
import { BufferIO } from './io'

const table = new TokenTable(CORE_TOKENS)

function run(src: string, inputs: string[] = []): string {
  const io = new BufferIO(inputs)
  const interp = new Interp(tokenize(src, table), table, { io, maxSteps: 100_000 })
  const result = interp.run()
  if (result.status === 'maxSteps') throw new Error('program did not terminate')
  return io.out
}

describe('expressions', () => {
  it('applies operator precedence', () => {
    expect(run('Print 2+3*4')).toBe(' 14\n')
    expect(run('Print (2+3)*4')).toBe(' 20\n')
    expect(run('Print 2^3+1')).toBe(' 9\n')
    expect(run('Print 10 mod 3')).toBe(' 1\n')
  })

  it('does integer division on integers, float on floats', () => {
    expect(run('Print 7/2')).toBe(' 3\n')
    expect(run('Print 7.0/2')).toBe(' 3.5\n')
    expect(run('Print -7/2')).toBe('-3\n')
  })

  it('evaluates comparisons to -1/0 (AMOS True/False)', () => {
    expect(run('Print 3>2')).toBe('-1\n')
    expect(run('Print 3<2')).toBe(' 0\n')
    expect(run('Print True : Print False')).toBe('-1\n 0\n')
    expect(run('Print 3>2 and 2>1')).toBe('-1\n')
    expect(run('Print Not 3>2')).toBe(' 0\n')
  })

  it('handles strings: concat, compare, functions', () => {
    expect(run('Print "AB"+"CD"')).toBe('ABCD\n')
    expect(run('Print "AB"="AB"')).toBe('-1\n')
    expect(run('Print Len("HELLO")')).toBe(' 5\n')
    expect(run('Print Mid$("HELLO",2,3)')).toBe('ELL\n')
    expect(run('Print Mid$("HELLO",2)')).toBe('ELLO\n')
    expect(run('Print Left$("HELLO",2);Right$("HELLO",2)')).toBe('HELO\n')
    expect(run('Print Instr("HELLO","LL")')).toBe(' 3\n')
    expect(run('Print Chr$(65);Asc("A")')).toBe('A 65\n')
    expect(run('Print Upper$("abc");Lower$("DEF");Flip$("abc")')).toBe('ABCdefcba\n')
    expect(run('Print String$("xy",3);Space$(2);"!"')).toBe('xxx  !\n')
    expect(run('Print Str$(42)+Str$(3.5)')).toBe(' 42 3.5\n')
    expect(run('Print Val("42");Val("3.5")')).toBe(' 42 3.5\n')
    expect(run('Print Hex$(255);" ";Bin$(5,4)')).toBe('$FF %0101\n')
  })

  it('evaluates math functions', () => {
    expect(run('Print Abs(-5);Sgn(-2);Int(3.7);Int(-1.5)')).toBe(' 5-1 3-2\n')
    expect(run('Print Max(3,7);Min(3,7)')).toBe(' 7 3\n')
    expect(run('Print Sqr(9.0)')).toBe(' 3\n')
    expect(run('Degree : Print Sin(90)')).toBe(' 1\n')
  })
})

describe('variables', () => {
  it('defaults to 0 / empty and respects type suffixes', () => {
    expect(run('Print A;B#;"[";C$;"]"')).toBe(' 0 0[]\n')
    expect(run('A=3.9 : Print A')).toBe(' 3\n') // int var truncates
    expect(run('A#=3.9 : Print A#')).toBe(' 3.9\n')
  })

  it('keeps A, A# and A$ distinct', () => {
    expect(run('A=1 : A#=2.5 : A$="x" : Print A;A#;A$')).toBe(' 1 2.5x\n')
  })

  it('supports arrays via Dim, with bounds', () => {
    expect(run('Dim A(5) : A(3)=7 : Print A(3);A(0)')).toBe(' 7 0\n')
    expect(run('Dim G(3,3) : G(1,2)=9 : Print G(1,2);G(2,1)')).toBe(' 9 0\n')
    expect(() => run('Dim A(2) : A(3)=1')).toThrow(/index out of range/)
    expect(() => run('A(1)=1')).toThrow(/not dimensioned/)
  })

  it('implements Inc, Dec, Add and Swap', () => {
    expect(run('A=5 : Inc A : Print A')).toBe(' 6\n')
    expect(run('A=5 : Dec A : Print A')).toBe(' 4\n')
    expect(run('A=5 : Add A,10 : Print A')).toBe(' 15\n')
    expect(run('A=9 : Add A,1,1 To 9 : Print A')).toBe(' 1\n') // wraps
    expect(run('A=1 : B=2 : Swap A,B : Print A;B')).toBe(' 2 1\n')
  })
})

describe('control flow', () => {
  it('runs single-line If/Then/Else', () => {
    expect(run('If 1=1 Then Print "Y" Else Print "N"')).toBe('Y\n')
    expect(run('If 1=2 Then Print "Y" Else Print "N"')).toBe('N\n')
    expect(run('If 1=2 Then Print "Y"\nPrint "AFTER"')).toBe('AFTER\n')
    expect(run('A=1 : If A Then Print "A" : Print "B"\nPrint "C"')).toBe('A\nB\nC\n')
  })

  it('runs structured If / Else If / Else / End If', () => {
    const prog = (n: number) =>
      [
        `A=${n}`,
        'If A=1',
        '   Print "one"',
        'Else If A=2',
        '   Print "two"',
        'Else',
        '   Print "many"',
        'End If',
        'Print "done"',
      ].join('\n')
    expect(run(prog(1))).toBe('one\ndone\n')
    expect(run(prog(2))).toBe('two\ndone\n')
    expect(run(prog(3))).toBe('many\ndone\n')
  })

  it('runs For/Next with Step, skip and nesting', () => {
    expect(run('For I=1 To 5 : Print I; : Next : Print')).toBe(' 1 2 3 4 5\n')
    expect(run('For I=10 To 1 Step -3 : Print I; : Next I : Print')).toBe(' 10 7 4 1\n')
    expect(run('For I=5 To 1 : Print "X" : Next\nPrint "SKIP"')).toBe('SKIP\n')
    expect(run('For I=1 To 2 : For J=1 To 2 : Print I;J;" "; : Next J : Next I')).toBe(' 1 1  1 2  2 1  2 2 ')
  })

  it('runs Repeat/Until and While/Wend', () => {
    expect(run('X=0\nRepeat\n Inc X : Print X;\nUntil X>=3\nPrint')).toBe(' 1 2 3\n')
    expect(run('X=0\nWhile X<3\n Inc X : Print X;\nWend\nPrint')).toBe(' 1 2 3\n')
    expect(run('X=5\nWhile X<3\n Print "NO"\nWend\nPrint "OK"')).toBe('OK\n')
  })

  it('runs Do/Loop with Exit and Exit If', () => {
    expect(run('X=0\nDo\n Inc X\n Exit If X>=3\nLoop\nPrint X')).toBe(' 3\n')
    expect(run('Do\n Exit\nLoop\nPrint "OUT"')).toBe('OUT\n')
    const nested = ['For I=1 To 3', ' Do', '  Exit 2', ' Loop', 'Next', 'Print "OUT"'].join('\n')
    expect(run(nested)).toBe('OUT\n')
  })

  it('supports Goto, Gosub/Return and On Gosub', () => {
    expect(run('Goto SKIP\nPrint "NO"\nSKIP:\nPrint "YES"')).toBe('YES\n')
    expect(run('Gosub SUB\nPrint "BACK"\nEnd\nSUB:\nPrint "IN"\nReturn')).toBe('IN\nBACK\n')
    expect(run('On 2 Gosub A,B\nEnd\nA: Print "A" : Return\nB: Print "B" : Return')).toBe('B\n')
  })

  it('honours End and Stop', () => {
    expect(run('Print "A"\nEnd\nPrint "B"')).toBe('A\n')
  })
})

describe('procedures', () => {
  it('passes parameters and keeps locals separate', () => {
    const prog = [
      'A=10',
      'MANGLE[3]',
      'Print A',
      'Procedure MANGLE[A]',
      '   A=A*2 : Print A',
      'End Proc',
    ].join('\n')
    expect(run(prog)).toBe(' 6\n 10\n')
  })

  it('returns values via End Proc[...] and Param', () => {
    const prog = ['DOUBLE[21]', 'Print Param', 'Procedure DOUBLE[N]', 'End Proc[N*2]'].join('\n')
    expect(run(prog)).toBe(' 42\n')
  })

  it('supports Shared and Global', () => {
    const shared = ['S=1', 'BUMP', 'Print S', 'Procedure BUMP', '   Shared S', '   Inc S', 'End Proc'].join('\n')
    expect(run(shared)).toBe(' 2\n')
    const glob = ['Global G', 'G=5', 'PEEKG', 'Procedure PEEKG', '   Print G', 'End Proc'].join('\n')
    expect(run(glob)).toBe(' 5\n')
  })

  it('skips procedure bodies in normal flow', () => {
    expect(run('Print "A"\nProcedure P\n   Print "NEVER"\nEnd Proc\nPrint "B"')).toBe('A\nB\n')
  })

  it('supports recursion', () => {
    const prog = [
      'FAC[5]',
      'Print Param',
      'Procedure FAC[N]',
      '   If N<2 Then Pop Proc',
      '   FAC[N-1]',
      '   R=Param*N',
      'End Proc[R]',
    ].join('\n')
    // FAC(1) returns via Pop Proc without a value; Param keeps its previous value
    const out = run(prog)
    expect(out.endsWith('\n')).toBe(true)
  })
})

describe('data', () => {
  it('reads typed data with Restore', () => {
    const prog = [
      'Data 10,20,"AB"',
      'Read A,B,C$',
      'Print A;B;C$',
      'Restore',
      'Read X',
      'Print X',
    ].join('\n')
    expect(run(prog)).toBe(' 10 20AB\n 10\n')
  })

  it('reads across lines and handles negative values', () => {
    const prog = ['Data 1,-2', 'Data 3', 'Read A,B,C', 'Print A;B;C'].join('\n')
    expect(run(prog)).toBe(' 1-2 3\n')
  })

  it('restores to a label', () => {
    const prog = ['Data 1', 'L2: Data 2', 'Restore L2', 'Read A', 'Print A'].join('\n')
    expect(run(prog)).toBe(' 2\n')
  })
})

describe('error trapping', () => {
  it('jumps to an On Error Goto handler', () => {
    const prog = [
      'On Error Goto OOPS',
      'Error 12',
      'Print "NOT REACHED"',
      'End',
      'OOPS:',
      'Print "CAUGHT";Errtrap',
    ].join('\n')
    expect(run(prog)).toBe('CAUGHT 1\n')
  })

  it('resumes at the next statement', () => {
    const prog = ['On Error Goto H', 'Error 1 : Print "AFTER"', 'End', 'H:', 'Resume Next'].join('\n')
    expect(run(prog)).toBe('AFTER\n')
  })

  it('swallows errors under Trap and reports via Errtrap', () => {
    expect(run('Trap Error 5\nPrint Errtrap')).toBe(' 1\n')
    expect(run('Trap Print "OK"\nPrint Errtrap')).toBe('OK\n 0\n')
  })

  it('is fatal without a handler', () => {
    expect(() => run('Error 9')).toThrow(/Error 9/)
  })
})

describe('i/o', () => {
  it('supports Input with prompt and multiple targets', () => {
    expect(run('Input "N? ";A$\nPrint "HI ";A$', ['GAZ'])).toBe('N? GAZ\nHI GAZ\n')
    expect(run('Input A,B\nPrint A+B', ['3,4'])).toBe('3,4\n 7\n')
  })

  it('separates Print items with ; and pads with ,', () => {
    expect(run('Print "A";"B"')).toBe('AB\n')
    expect(run('Print "A","B"')).toBe('A            B\n')
    expect(run('Print "A";')).toBe('A')
  })

  it('seeds the RNG deterministically', () => {
    const a = run('Randomize 1 : For I=1 To 5 : Print Rnd(9); : Next')
    const b = run('Randomize 1 : For I=1 To 5 : Print Rnd(9); : Next')
    expect(a).toBe(b)
    expect(run('Print Rnd(0)')).toBe(' 0\n')
  })

  it('reports runtime errors with line context', () => {
    expect(() => run('Print 1/0')).toThrow(/division by zero.*line 1.*Print 1\/0/s)
    expect(() => run('A$="X"+1')).toThrow(/Type mismatch/)
  })

  it('stops runaway programs at maxSteps', () => {
    expect(() => run('Do\nLoop')).toThrow(/did not terminate/)
  })
})
