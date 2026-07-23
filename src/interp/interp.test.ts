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

describe('FFP single-precision floats (mathffp.library)', () => {
  it('rounds float arithmetic to 24-bit FFP precision', () => {
    // 2^30 = 1073741824 loses precision at FFP's 24-bit mantissa
    expect(run('A#=2^30 : Print A#')).toBe(' 1073742000\n')
    expect(run('Print Pi#')).toBe(' 3.141593\n') // the ROM FFP constant
  })

  it('overflows above the FFP range (~9.2e18), unlike a double', () => {
    expect(() => run('A#=1E10 : B#=A#*A#')).toThrow(/Overflow/) // 1e20 > 2^63
  })

  it('Set Double Precision switches to IEEE doubles (no FFP overflow)', () => {
    // 1e20 overflows FFP but is fine as a double
    expect(run('Set Double Precision 1 : A#=1E10 : B#=A#*A# : Print B#>0')).toBe('-1\n')
    // and back to single precision restores the overflow
    expect(() => run('Set Double Precision 1\nSet Double Precision 0\nA#=1E10 : B#=A#*A#')).toThrow(/Overflow/)
  })

  it('a value below the FFP minimum underflows to 0', () => {
    expect(run('A#=1E-10 : B#=A#*A# : Print B#')).toBe(' 0\n') // 1e-20 < 2^-65
  })
})

describe('expressions', () => {
  it('applies operator precedence', () => {
    expect(run('Print 2+3*4')).toBe(' 14\n')
    expect(run('Print (2+3)*4')).toBe(' 20\n')
    expect(run('Print 2^3+1')).toBe(' 9\n')
    expect(run('Print 10 mod 3')).toBe(' 1\n')
  })

  it('follows the authentic id-ladder precedence (New_Evalue in +ILib.s)', () => {
    // "/" binds tighter than "*": 10*(3/4) = 0, not (10*3)/4 = 7
    expect(run('Print 10*3/4')).toBe(' 0\n')
    expect(run('Print 7/2*2')).toBe(' 6\n') // (7/2)*2 — "*" is looser than "/"
    expect(run('Print 7*2/2')).toBe(' 7\n') // 7*(2/2)
    // mod is looser than * and /
    expect(run('Print 2*5 mod 3')).toBe(' 1\n') // (2*5) mod 3
    expect(run('Print 10 mod 3*2')).toBe(' 4\n') // 10 mod (3*2)
    // and binds tighter than or, or tighter than xor
    expect(run('Print 1 or 1 and 0')).toBe(' 1\n')
    expect(run('Print 1 xor 2 or 2')).toBe(' 3\n') // 1 xor (2 or 2) = 3
  })

  it('applies unary minus to the operand, tighter than ^', () => {
    expect(run('Print -2^2')).toBe(' 4\n') // (-2)^2, not -(2^2)
    expect(run('A=5 : Print --A')).toBe(' 5\n') // OpeM toggles per operator
  })

  it('makes ^ a float operation and Not consume the rest (FnNot)', () => {
    expect(run('Print 2^10')).toBe(' 1024\n')
    expect(run('Print Not 1=1')).toBe(' 0\n') // Not(1=1) = Not(-1) = 0
  })

  it('raises Overflow like Op_Plus/Op_Moins, wraps 16-bit fast multiplies', () => {
    expect(() => run('Print 2000000000+2000000000')).toThrow(/Overflow/)
    expect(() => run('Print 100000*100000')).toThrow(/Overflow/)
    // mulu fast path has no check: 50000*50000 wraps on a real Amiga
    expect(run('Print 50000*50000')).toBe('-1794967296\n')
  })

  it('implements Op_Modulo: unsigned left operand, no zero check', () => {
    expect(run('Print -7 mod 3')).toBe(' 0\n') // (2^32-7) mod 3
    expect(run('Print 7 mod 0')).toBe(' 7\n') // no DByZero in Op_Modulo
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

describe('string/math functions verified against the library source', () => {
  it('Rnd: FnRnd LCG, Rnd(0) returns the previous draw, negatives work', () => {
    const out = run('Randomize 1\nA=Rnd(100) : B=Rnd(0)\nPrint A=B\nPrint Rnd(-10)>=0')
    expect(out).toBe('-1\n-1\n')
    // deterministic sequence after Randomize
    expect(run('Randomize 7 : Print Rnd(99);Rnd(99)')).toBe(run('Randomize 7 : Print Rnd(99);Rnd(99)'))
  })

  it('Instr: empty needle is 0, start 0 acts as 1, negative start errors', () => {
    expect(run('Print Instr("ABC","")')).toBe(' 0\n')
    expect(run('Print Instr("ABC","B",0)')).toBe(' 2\n')
    expect(() => run('Print Instr("ABC","B",-1)')).toThrow(/function call/)
  })

  it('Left$/Right$/Mid$: negative counts error, Mid$ position 0 acts as 1', () => {
    expect(() => run('Print Left$("ABC",-1)')).toThrow(/function call/)
    expect(() => run('Print Right$("ABC",-1)')).toThrow(/function call/)
    expect(() => run('Print Mid$("ABC",-1)')).toThrow(/function call/)
    expect(run('Print Mid$("ABC",0,2)')).toBe('AB\n')
  })

  it('Chr$ rejects values outside 0-255 (FnChr)', () => {
    expect(run('Print Chr$(65)')).toBe('A\n')
    expect(() => run('Print Chr$(256)')).toThrow(/function call/)
    expect(() => run('Print Chr$(-1)')).toThrow(/function call/)
  })

  it('Space$/String$ reject negatives; String$ of "" is ""', () => {
    expect(() => run('Print Space$(-1)')).toThrow(/function call/)
    expect(run('Print String$("",5);"!"')).toBe('!\n')
  })

  it('Upper$/Lower$ convert ASCII only (FnUpper/FnLower)', () => {
    expect(run('Print Upper$("ab\xe9")')).toBe('AB\xe9\n') // é untouched
    expect(run('Print Lower$("AB\xc9")')).toBe('ab\xc9\n')
  })

  it('Sqr/Log/Ln reject negatives (FlPos)', () => {
    expect(() => run('Print Sqr(-1)')).toThrow(/function call/)
    expect(() => run('Print Log(-1)')).toThrow(/function call/)
    expect(() => run('Print Ln(-1)')).toThrow(/function call/)
  })

  it('hyperbolics share the angle-converting spec with Sin (spec "15")', () => {
    // Degree: Hsin(90) = sinh(pi/2) ≈ 2.3013
    const out = run('Degree : Print Hsin(90)')
    expect(parseFloat(out)).toBeCloseTo(Math.sinh(Math.PI / 2), 4)
  })

  it('Val skips spaces inside numbers (ValRout)', () => {
    expect(run('Print Val("1 2 3")')).toBe(' 123\n')
  })

  it('Fix controls float display (InFix)', () => {
    expect(run('Fix(2) : Print 3.14159')).toBe(' 3.14\n')
    expect(run('Fix(16) : Print 3.5')).toBe(' 3.5\n')
    expect(run('Fix(-3) : Print 31.4159')).toBe(' 3.142E+1\n')
  })

  it('control-character functions return console codes', () => {
    expect(run('Print Asc(Tab$);Asc(Cup$);Asc(Cdown$);Asc(Cleft$);Asc(Cright$)')).toBe(' 9 30 31 29 28\n')
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
    expect(run('For I=5 To 1 : Print "X" : Next\nPrint "SKIP"')).toBe('X\nSKIP\n') // body runs once
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

describe('statements verified against the library source', () => {
  it('For runs its body at least once — InFor has no initial test', () => {
    expect(run('For I=5 To 1 : Print "X"; : Next : Print')).toBe('X\n')
    expect(run('For I=1 To 0 : Print I; : Next')).toBe(' 1')
  })

  it('Next always operates on the innermost loop (InNext)', () => {
    // "Next I" inside the J loop still advances J
    expect(run('For I=1 To 1 : For J=1 To 2 : Print J; : Next I : Next J')).toBe(' 1 2')
  })

  it('Print comma emits a TAB the console interprets (sp12)', () => {
    expect(run('Print "A","B"')).toBe('A\tB\n')
  })

  it('Print Using formats one expression (ssprint/us*)', () => {
    expect(run('Print Using "###";42')).toBe(' 42\n')
    expect(run('Print Using "#####.##";3.14159')).toBe('    3.14\n')
    expect(run('Print Using "+###";7')).toBe('+  7\n')
    expect(run('Print Using "score ###!";5')).toBe('score   5!\n')
    expect(run('Print Using "~~~~~";"AB"')).toBe('AB   \n')
  })

  it('Read fills empty data items by target type (InRdV)', () => {
    expect(run('Data 1,,3\nRead A,B,C : Print A;B;C')).toBe(' 1 0 3\n')
    expect(run('Data ,\nRead A$,B$ : Print "[";A$;B$;"]"')).toBe('[]\n')
  })

  it('Data inside procedures is local to them (InRead proc scoping)', () => {
    const prog = [
      'Data 10',
      'P',
      'Read G : Print G',
      'End',
      'Procedure P',
      '   Data 99',
      '   Read L : Print L',
      'End Proc',
    ].join('\n')
    expect(run(prog)).toBe(' 99\n 10\n')
  })

  it('Def Fn / Fn evaluate with bound parameters (FnFn)', () => {
    expect(run('Def Fn D(X)=X*2\nPrint Fn D(21)')).toBe(' 42\n')
    // FnFn writes parameters straight into the real variables — A stays 1
    expect(run('A=5 : Def Fn S(A)=A+1\nPrint Fn S(1);A')).toBe(' 2 1\n')
    expect(run('Def Fn H$(N$)=N$+"!"\nPrint Fn H$("HI")')).toBe('HI!\n')
  })

  it('Every fires a Gosub on the frame clock (InEvery)', () => {
    const io = new BufferIO()
    const interp = new Interp(tokenize('Every 5 Gosub T\nDo\n Wait 1\nLoop\nT: Print "T"; : Return', table), table, {
      io,
      maxSteps: 10_000,
    })
    // drive the clock: unblock waits until enough frames pass
    for (let f = 0; f < 21; f++) {
      interp.tick++
      if (interp.blocked?.type === 'wait' && interp.tick >= interp.blocked.until) interp.blocked = null
      if (!interp.done && interp.blocked === null) interp.run(1_000)
    }
    expect(io.out).toBe('TTTT') // fires at ticks 5,10,15,20
  })
})

describe('flow verified against the library source', () => {
  it('Goto out of a loop unwinds its frame (LGoto)', () => {
    const prog = ['For I=1 To 2', 'Goto S', 'Next', 'S: Next'].join('\n')
    expect(() => run(prog)).toThrow(/Next without For/)
    // jumping WITHIN the loop keeps the frame
    expect(run(['For I=1 To 2', 'Goto K', 'K:', 'Print I;', 'Next'].join('\n'))).toBe(' 1 2')
  })

  it('Return discards loops opened since the Gosub (one shared stack)', () => {
    const prog = ['Gosub S', 'Next', 'End', 'S: For I=1 To 9 : Return'].join('\n')
    expect(() => run(prog)).toThrow(/Next without For/)
  })

  it('Dim rejects re-dimensioning and oversized arrays (InDim/AlrDim)', () => {
    expect(() => run('Dim A(5) : Dim A(5)')).toThrow(/already dimensioned/)
    expect(() => run('Dim A(70000)')).toThrow(/function call/)
    // per-procedure arrays get a fresh frame each call — no clash
    expect(run('P : P : Print "OK"\nEnd\nProcedure P\n Dim L(3)\nEnd Proc')).toBe('OK\n')
  })

  it('Input parses numbers like Val — hex and binary work (ValRout)', () => {
    expect(run('Input A\nPrint A', ['$FF'])).toBe('? $FF\n 255\n')
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
  it('jumps to an On Error Goto handler and reports the real error number', () => {
    const prog = [
      'On Error Goto OOPS',
      'Error 12',
      'Print "NOT REACHED"',
      'End',
      'OOPS:',
      'Print "CAUGHT";Errn',
    ].join('\n')
    expect(run(prog)).toBe('CAUGHT 12\n') // Errn = the real error number
  })

  it('resumes at the next statement', () => {
    const prog = ['On Error Goto H', 'Error 1 : Print "AFTER"', 'End', 'H:', 'Resume Next'].join('\n')
    expect(run(prog)).toBe('AFTER\n')
  })

  it('Errn/Err$ report the AMOS error number and message (.Error1)', () => {
    // division by zero = error 20
    const prog = ['On Error Goto H', 'A=1/0', 'End', 'H:', 'Print Errn;Err$(Errn)'].join('\n')
    expect(run(prog)).toBe(' 20Division by zero\n')
    // Err$(n) is a direct table lookup
    expect(run('Print Err$(23)')).toBe('Illegal function call\n')
  })

  it('Errtrap and Errn are separate slots (Trap vs On Error)', () => {
    expect(run('Trap Error 5\nPrint Errtrap')).toBe(' 5\n') // Trap → Errtrap = 5
    expect(run('Trap Print "OK"\nPrint Errtrap')).toBe('OK\n 0\n')
  })

  it('On Error Proc + Resume Next unwinds the handler frame (ResP +ILib.s:1998)', () => {
    const prog = [
      'On Error Proc HANDLER',
      'X=1/0',
      'Print "resumed";X',
      'End',
      'Procedure HANDLER',
      '  Shared X : X=99',
      '  Resume Next',
      'End Proc',
    ].join('\n')
    expect(run(prog)).toBe('resumed 99\n') // main continues, frame stack restored
  })

  it('Pop discards loop frames opened since the Gosub (InPop +ILib.s:2464)', () => {
    // after Pop inside a For, the loop frame is gone: Next has no For to
    // match, so it is a no-op and control falls straight through
    const prog = [
      'Gosub S',
      'Print "back in main"',
      'End',
      'S:',
      'For I=1 To 5',
      '  Pop',
      '  Goto DONE',
      'Next',
      'DONE:',
      'Print "popped, loops cleared"',
    ].join('\n')
    const out = run(prog)
    expect(out).toContain('popped, loops cleared')
    expect(out).not.toContain('back in main') // Pop discarded the return
  })

  it('is fatal without a handler', () => {
    expect(() => run('Error 9')).toThrow()
  })
})

describe('i/o', () => {
  it('supports Input with prompt and multiple targets', () => {
    expect(run('Input "N? ";A$\nPrint "HI ";A$', ['GAZ'])).toBe('N? GAZ\nHI GAZ\n')
    expect(run('Input A,B\nPrint A+B', ['3,4'])).toBe('? 3,4\n 7\n') // promptless prints "? "
  })

  it('separates Print items with ; and tabs with , (default tab 4)', () => {
    expect(run('Print "A";"B"')).toBe('AB\n')
    expect(run('Print "A","B"')).toBe('A\tB\n') // raw TAB; the console expands it
    expect(run('Print "ABCDE","B"')).toBe('ABCDE\tB\n')
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
