import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { NA } from '../coverage/status'
import { makeAllInstructions } from './instr'

const table = new TokenTable(CORE_TOKENS)
/**
 * Slot 22 because that is where the author put it: `ExtNb equ 22-1` in
 * |jd.s, and the disc's own Extension_numbers file recommends 20/21/22 for
 * the Colour, Prt and JD trio.
 */
const jd = extensionById('jd-5.3')!
const exts = new Map([[22, jd.table]])

/** run a program with JD bound and return what it printed */
function run(src: string): string {
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[22, jd]]),
    maxSteps: 2_000_000,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(500)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return out
}

/** a Runtime with JD bound, for the dispatch-level checks */
function bootJd(): Runtime {
  return new Runtime(tokenize('Rem', table, exts), table, {
    extensions: exts,
    extBindings: new Map([[22, jd]]),
    maxSteps: 200_000,
  })
}

/** the value of a single expression, as printed */
const val = (expr: string): string => run(`Print ${expr}`).trim()

/** a string expression with its spaces intact — val() trims, which matters
 *  for the keywords whose whole job is padding */
const sval = (expr: string): string => {
  const printed = run(`Print "["+${expr}+"]"`)
  return printed.slice(printed.indexOf('[') + 1, printed.lastIndexOf(']'))
}

describe('JD: shifts and rotates (+|jd.s:3718-3800)', () => {
  it('shifts by the count, with the value as the SECOND argument', () => {
    // the manual: "parameters: quantity and number", and the routine pops the
    // value into d3 first because the first pop is the last argument
    expect(val('Jd Lsl(1,1)')).toBe('2')
    expect(val('Jd Lsl(4,1)')).toBe('16')
    expect(val('Jd Lsr(4,16)')).toBe('1')
  })

  it('a count of ZERO shifts once — dbra tests after the body', () => {
    // sub.l #1,d2 makes the counter -1, but the shift sits before the dbra,
    // so it has already run. Nothing in the manual says this.
    expect(val('Jd Lsl(0,1)')).toBe('2')
    expect(val('Jd Lsr(0,2)')).toBe('1')
  })

  it('asr keeps the sign where lsr does not', () => {
    expect(val('Jd Asr(1,-8)')).toBe('-4')
    // lsr of -8 shifts the sign bit down: $FFFFFFF8 >> 1 = $7FFFFFFC
    expect(val('Jd Lsr(1,-8)')).toBe('2147483644')
  })

  it('rotates wrap end to end', () => {
    expect(val('Jd Rol(1,-2147483648)')).toBe('1') // bit 31 -> bit 0
    expect(val('Jd Ror(1,1)')).toBe('-2147483648') // bit 0 -> bit 31
  })

  it('roxl rotates through X, and the count is what seeds X', () => {
    // `sub.l #1,d2` sets X only when it borrows, which happens for a count of
    // zero and nothing else. So Roxl(0,n) rotates a 1 into bit 0 and Roxl(1,n)
    // rotates a 0 in.
    expect(val('Jd Roxl(1,1)')).toBe('2')
    expect(val('Jd Roxl(0,1)')).toBe('3') // the borrowed X lands in bit 0
    expect(val('Jd Roxr(0,2)')).toBe('-2147483647') // X into bit 31, 2>>1 = 1
  })

  it('the count is not masked to 0..31 the way one 68k instruction would be', () => {
    // 33 separate `lsl.l #1` are 33 shifts, not 33 mod 64
    expect(val('Jd Lsl(33,1)')).toBe('0')
    // but a rotate of 32 comes back to where it started
    expect(val('Jd Rol(32,12345)')).toBe('12345')
  })
})

describe('JD: logic and predicates', () => {
  it('Jd Imp is implication and Jd Eqv is equivalence, bit by bit', () => {
    // routines 78/79 walk bit 31 down to 0 by patching their own btst operand
    expect(val('Jd Imp(0,0)')).toBe('-1') // ~0 | 0 = all ones
    expect(val('Jd Imp(-1,0)')).toBe('0')
    expect(val('Jd Imp(12,10)')).toBe(String((~12 | 10) | 0))
    expect(val('Jd Eqv(12,10)')).toBe(String(~(12 ^ 10) | 0))
    expect(val('Jd Eqv(-1,-1)')).toBe('-1')
  })

  it('Jd Odd answers 1 for an EVEN number — the code, not the prose', () => {
    // The routine clears bit 0 and returns 1 when that changed nothing. Its
    // label says is_odd and the manual says "0/1 = even/odd", but the manual's
    // own example is A=Jd Odd(2) -> A=1, which agrees with the code.
    expect(val('Jd Odd(2)')).toBe('1')
    expect(val('Jd Odd(3)')).toBe('0')
    expect(val('Jd Odd(0)')).toBe('1')
    expect(val('Jd Odd(-3)')).toBe('0')
  })

  it('Jd Limit tests a closed range, as its own example does', () => {
    expect(val('Jd Limit(-3,-8,10)')).toBe('1') // the manual's example
    expect(val('Jd Limit(11,-8,10)')).toBe('0')
    expect(val('Jd Limit(-8,-8,10)')).toBe('1') // inclusive at both ends
    expect(val('Jd Limit(10,-8,10)')).toBe('1')
  })
})

describe('JD: floating point (the FFP constants, +|jd.s:4163/5502)', () => {
  it('Pi# and E# are the library\'s own FFP words, not IEEE', () => {
    // $c90fdb42 and $adf85442 decoded, which is what a real AMOS would hold
    expect(val('Jd Pi#')).toBe('3.141593')
    expect(val('Jd E#')).toBe('2.718282')
  })

  it('Jd Percent is a float division, and bounds each argument with error 23', () => {
    expect(val('Jd Percent(200,50)')).toBe('100')
    expect(val('Jd Percent(3,50)')).toBe('1.5')
    // value 0..65535, divisor 1..100 — L_outdim for anything outside
    expect(() => run('Print Jd Percent(65536,50)')).toThrow(/illegal function call/i)
    expect(() => run('Print Jd Percent(10,0)')).toThrow(/illegal function call/i)
    expect(() => run('Print Jd Percent(10,101)')).toThrow(/illegal function call/i)
    expect(() => run('Print Jd Percent(-1,50)')).toThrow(/illegal function call/i)
  })

  it('Jd Distance is Pythagoras between two points', () => {
    expect(val('Jd Distance(0,0 To 3,4)')).toBe('5')
    expect(val('Jd Distance(10,10 To 10,10)')).toBe('0')
  })
})

describe('JD: Jd Arcus (+|jd.s:5508)', () => {
  it('answers 90 and 270 for a horizontal line, from its own branch', () => {
    // the general path would give 0 or 180 here, which is why the branch is
    // in the source at all
    expect(val('Jd Arcus(0,0 To 10,0)')).toBe('90')
    expect(val('Jd Arcus(0,0 To -10,0)')).toBe('270')
  })

  it('adds 180 when dy is positive and wraps into 0..359', () => {
    expect(val('Jd Arcus(0,0 To 0,-10)')).toBe('0') // straight up
    expect(val('Jd Arcus(0,0 To 0,10)')).toBe('180') // straight down
    for (const e of ['Jd Arcus(0,0 To 7,-3)', 'Jd Arcus(0,0 To -7,3)', 'Jd Arcus(5,5 To 1,9)']) {
      const n = Number(val(e))
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(360)
    }
  })

  it('truncates toward zero, because SPFix does', () => {
    // dx/dy = 3/-2, atan is -56.309..., SPFix takes it to -56, +360 = 304
    expect(val('Jd Arcus(0,0 To 3,-2)')).toBe('304')
    // and 45 degrees exactly stays 45 rather than sliding to 44
    expect(val('Jd Arcus(0,0 To -1,-1)')).toBe('45')
  })
})

describe('JD strings: the manual\'s own examples (+|jd.s:1341-2440)', () => {
  it('reproduces every worked example the manual prints', () => {
    expect(val('Jd Cut$("Test",2,2)')).toBe('Tt')
    expect(val('Jd Insert$("Tt",2,"es")')).toBe('Test')
    expect(val('Jd Paste$("Test","es","a")')).toBe('Tat')
    expect(sval('Jd Extend$("Test",8,0)')).toBe('  Test  ')
    expect(sval('Jd Extend$("Test",8,1)')).toBe('    Test')
    expect(sval('Jd Extend$("Test",8,-1)')).toBe('Test    ')
    expect(val('Jd Exval$(12,4,"0")')).toBe('0012')
    expect(val('Jd Linstr("tester","te")')).toBe('4')
  })
})

describe('JD strings: what the source says and the manual does not', () => {
  it('Change$ SWAPS case rather than raising it', () => {
    expect(sval('Jd Change$("Test 1")')).toBe('tEST 1')
  })

  it('Firstup$ treats only bytes outside \'0\'..\'z\' as word breaks', () => {
    expect(sval('Jd Firstup$("hello world")')).toBe('Hello World')
    // a full stop is below '0', so it breaks; a colon is not, so it does not
    expect(val('Jd Firstup$("one.two")')).toBe('One.Two')
    expect(val('Jd Firstup$("one:two")')).toBe('One:two')
    // an initial that is already capital is left alone, not lowered
    expect(val('Jd Firstup$("Test")')).toBe('Test')
  })

  it('Skip$ trims spaces only, at both ends', () => {
    expect(sval('Jd Skip$("  a b  ")')).toBe('a b')
  })

  it('Count counts OVERLAPPING occurrences', () => {
    // the search position advances by one on a match, not by the match length
    expect(val('Jd Count("aaa","aa")')).toBe('2')
    expect(val('Jd Count("Test","t")')).toBe('1')
  })

  it('Paste$ does not rescan what it just wrote', () => {
    expect(val('Jd Paste$("aaa","a","aa")')).toBe('aaaaaa')
  })

  it('Cut$ clamps the count rather than failing past the end', () => {
    expect(val('Jd Cut$("Test",3,99)')).toBe('Te')
    // and returns the input for a zero position, zero count or empty string
    expect(val('Jd Cut$("Test",0,2)')).toBe('Test')
    expect(val('Jd Cut$("Test",2,0)')).toBe('Test')
  })

  it('Insert$ past the end appends, and Extend$ never truncates', () => {
    expect(val('Jd Insert$("ab",99,"c")')).toBe('abc')
    expect(val('Jd Extend$("Testing",4,0)')).toBe('Testing')
  })

  it('the rotates move one character round', () => {
    expect(val('Jd Rol$("abcd")')).toBe('bcda')
    expect(val('Jd Ror$("abcd")')).toBe('dabc')
  })

  it('Ninstr finds the first character that is NOT the one given', () => {
    expect(val('Jd Ninstr("aaab","a")')).toBe('4')
    expect(val('Jd Ninstr("aaaa","a")')).toBe('0')
    expect(val('Jd Ninstr("abab","a",2)')).toBe('2')
    // only the first byte of the second argument is used
    expect(val('Jd Ninstr("aaab","az")')).toBe('4')
  })

  it('Detab pads to the next multiple of the tab width', () => {
    expect(sval('Jd Detab("a"+Chr$(9)+"b",4)')).toBe('a   b')
  })
})

describe('JD Compare: the six pattern cases (+|jd.s:864-940)', () => {
  const cmp = (s: string, p: string): string => val(`Jd Compare("${s}","${p}")`)

  it('handles all, exact, prefix, suffix, midfix and pre_suffix', () => {
    expect(cmp('anything', '*')).toBe('1')
    expect(cmp('Test', 'Test')).toBe('1')
    expect(cmp('Test', 'Tes')).toBe('0')
    expect(cmp('Testing', 'Test*')).toBe('1')
    expect(cmp('Testing', 'ing*')).toBe('0')
    expect(cmp('Testing', '*ing')).toBe('1')
    expect(cmp('Testing', '*est*')).toBe('1')
    expect(cmp('Testing', '*xyz*')).toBe('0')
    expect(cmp('Testing', 'Te*ng')).toBe('1')
    expect(cmp('Testing', 'Te*xx')).toBe('0')
  })

  it('? matches exactly one character, in every case', () => {
    expect(cmp('Test', 'T?st')).toBe('1')
    expect(cmp('Test', 'T??t')).toBe('1')
    expect(cmp('Test', 'T?t')).toBe('0') // length still has to match
    expect(cmp('Testing', '*i?g')).toBe('1')
  })
})

describe('JD: crypt, dumps and checksums (+|jd.s:1628-3372)', () => {
  it('Crypt$ and Encrypt$ are inverse table substitutions', () => {
    // whatever the table maps, the round trip has to come back
    const round = run('A$="Test 123" : Print "["+Jd Encrypt$(Jd Crypt$(A$))+"]"')
    expect(round.slice(round.indexOf('[') + 1, round.lastIndexOf(']'))).toBe('Test 123')
  })

  it('Crypt$ puts German text in dictionary order', () => {
    // the point of the table: crypted, a-umlaut sorts next to a rather than
    // above z, so a plain string compare orders German correctly
    const out = run([
      'A$=Jd Crypt$("a") : B$=Jd Crypt$(Chr$(228)) : C$=Jd Crypt$("b") : D$=Jd Crypt$("z")',
      'If A$<B$ and B$<C$ Then Print "ordered" Else Print "not"',
      'If C$<D$ Then Print "bz ok"',
    ].join('\n'))
    expect(out).toContain('ordered')
    expect(out).toContain('bz ok')
  })

  it('Dump$ dots the control ranges and keeps the rest', () => {
    expect(sval('Jd Dump$("a"+Chr$(9)+"b"+Chr$(200))')).toBe(`a.b${String.fromCharCode(200)}`)
    expect(sval('Jd Dump$("a"+Chr$(130)+"b")')).toBe('a.b')
  })

  it('the checksums insist on their block size', () => {
    // 512 for a filesystem block, 1024 for a boot block; anything else is 0
    expect(val('Jd Checksum("short")')).toBe('0')
    expect(val('Jd Bootchecksum("short")')).toBe('0')
    expect(val('Jd Checksum(String$(Chr$(0),512))')).toBe('0')
  })

  it('Checksum answers what makes a filesystem block sum to zero', () => {
    // a block of $01010101 longwords: 128 of them sum to $80808080, less the
    // one at offset 20, negated
    const out = run([
      'A$=String$(Chr$(1),512)',
      'Print Jd Checksum(A$)',
    ].join('\n'))
    const want = -((0x01010101 * 128 - 0x01010101) | 0) | 0
    expect(Number(out.trim())).toBe(want)
  })
})

describe('JD: Oct$ and Deoct are an inverse pair, and not octal (+|jd.s:3202/3334)', () => {
  it('round-trips every value, which is what they are for', () => {
    for (const n of [0, 7, 8, 16, 63, 100, 1000]) {
      expect(val(`Jd Deoct(Jd Oct$(${n}))`)).toBe(String(n))
    }
  })

  it('agrees with real octal only below 64', () => {
    expect(val('Jd Oct$(16)')).toBe('& 20') // 20 octal is 16 — correct here
    expect(val('Jd Oct$(100)')).toBe('& 124') // 124 octal is 84, not 100
    expect(val('Jd Deoct("&124")')).toBe('100') // and it reads its own back
  })

  it('applies the sign the manual example drops', () => {
    // the manual prints Deoct(&-20) -> 16; the routine negates on d6
    expect(val('Jd Deoct("&-20")')).toBe('-16')
    expect(val('Jd Oct$(-16)')).toBe('&-20')
  })
})

describe('JD: areas and the console (+|jd.s:1933-3520)', () => {
  it('Get Area splits a range, with the manual\'s three shapes', () => {
    expect(run('Jd Get Area "10-20" : Print Jd Area First;",";Jd Area Last').trim()).toBe('10, 20')
    expect(run('Jd Get Area "10-" : Print Jd Area First;",";Jd Area Last').trim()).toBe('10, 0')
    expect(run('Jd Get Area "-20" : Print Jd Area First;",";Jd Area Last').trim()).toBe('0, 20')
  })

  it('Reset Area clears both', () => {
    expect(run('Jd Get Area "3-4" : Jd Reset Area : Print Jd Area First;",";Jd Area Last').trim()).toBe('0, 0')
  })

  it('Jd Type writes the string, sound argument or not', () => {
    expect(run('Curs Off : Jd Type "hello",2,0').trim()).toBe('hello')
    expect(run('Curs Off : Jd Type "hi",-1,1').trim()).toBe('hi')
  })

  it('Jd Hexdump reads through the same address space as Peek', () => {
    const out = run([
      'Reserve As Work 10,16',
      'Loke Start(10),$41424344',
      'Curs Off : Jd Hexdump 1,Start(10),4,4',
    ].join('\n'))
    expect(out.trim()).toBe('41 42 43 44')
  })

  it('Jd Get Tab reports the console tab width', () => {
    expect(run('Set Tab 7 : Print Jd Get Tab').trim()).toBe('7')
  })
})

describe('JD: date and time (+|jd.s:1070-1300, 4346-4700)', () => {
  it('Date$ is TEN characters with a four-digit year, whatever the manual says', () => {
    const d = sval('Jd Date$')
    expect(d).toMatch(/^\d\d\.\d\d\.\d{4}$/)
    expect(d.length).toBe(10)
  })

  it('and that is why Dayval/Monthval/Yearval accept it', () => {
    // each opens `cmp.w #10,(a0)+ / Rbne L_outdim`, so the 8-character form
    // the manual documents would be error 23 on the library's own output
    expect(run('D$=Jd Date$ : Print Jd Dayval(D$);",";Jd Monthval(D$);",";Jd Yearval(D$)')).toMatch(/\d/)
    expect(val('Jd Dayval("24.12.1994")')).toBe('24')
    expect(val('Jd Monthval("24.12.1994")')).toBe('12')
    expect(val('Jd Yearval("24.12.1994")')).toBe('1994')
    expect(() => run('Print Jd Yearval("24.12.94")')).toThrow(/illegal function call/i)
  })

  it('Time$ is eight characters', () => {
    expect(sval('Jd Time$')).toMatch(/^\d\d:\d\d:\d\d$/)
  })

  it('Timesecs and Secstime$ are inverses, and Timesecs wants eight characters', () => {
    expect(val('Jd Timesecs("01:02:03")')).toBe(String(3723))
    expect(sval('Jd Secstime$(3723)')).toBe('01:02:03')
    expect(val('Jd Timesecs("1:2:3")')).toBe('0')
    expect(sval('Jd Secstime$(0)')).toBe('00:00:00')
  })

  it('Actual Date$/Time$ answer the later of the two', () => {
    expect(sval('Jd Actual Date$("01.01.1994","02.01.1994")')).toBe('02.01.1994')
    expect(sval('Jd Actual Date$("01.02.1994","28.01.1994")')).toBe('01.02.1994')
    expect(sval('Jd Actual Time$("10:00:00","09:59:59")')).toBe('10:00:00')
  })

  it('Leap Year follows the table, including where the table runs out', () => {
    expect(val('Jd Leap Year(1996)')).toBe('1')
    expect(val('Jd Leap Year(1997)')).toBe('0')
    expect(val('Jd Leap Year(1900)')).toBe('0') // a century that is not in the table
    expect(val('Jd Leap Year(2000)')).toBe('1') // one that is
    // 5200 IS a leap year by the calendar; the table stops at 4800, so the
    // library says no and so do we
    expect(val('Jd Leap Year(5200)')).toBe('0')
    expect(() => run('Print Jd Leap Year(1582)')).toThrow(/illegal function call/i)
    expect(() => run('Print Jd Leap Year(10000)')).toThrow(/illegal function call/i)
  })

  it('Day is 1=Sunday and Day$ names it in English', () => {
    // 25.12.1994 was a Sunday
    expect(val('Jd Day(25,12,1994)')).toBe('1')
    expect(sval('Jd Day$(1)')).toBe('Sunday')
    expect(sval('Jd Day$(7)')).toBe('Saturday')
    expect(sval('Jd Day$(Jd Day(24,12,1994))')).toBe('Saturday')
    expect(() => run('Print Jd Day$(8)')).toThrow(/illegal function call/i)
  })

  it('Day Of Year counts the leap day', () => {
    expect(val('Jd Day Of Year(1,1,1994)')).toBe('1')
    expect(val('Jd Day Of Year(31,12,1995)')).toBe('365')
    expect(val('Jd Day Of Year(31,12,1996)')).toBe('366') // a leap year
    expect(val('Jd Day Of Year(1,3,1996)')).toBe('61')
    expect(val('Jd Day Of Year(1,3,1995)')).toBe('60')
  })

  it('Setdate and Setclock are n/a, with no handler at all', () => {
    // they poke the RTC chip at $DC0000; NA in status.ts, and an n/a keyword
    // must not be dispatched — coverage.test.ts holds the two lists apart
    expect(NA.has('jd setdate')).toBe(true)
    expect(NA.has('jd setclock')).toBe(true)
    const funcs = makeAllInstructions(bootJd())
    expect('jd setdate' in funcs).toBe(false)
    expect('jd setclock' in funcs).toBe(false)
  })
})

describe('JD: arrays through the address space (+|jd.s:5984-6080)', () => {
  it('Get Dim reads the DIM value from the block header', () => {
    // =Array gives the block address; the dimension word is at +2, which is
    // the DIM value and one less than the element count
    expect(run('Dim A(10) : B=Array(A(0)) : Print Jd Get Dim(B)').trim()).toBe('10')
  })

  it('Array Swap exchanges two elements in the program\'s own array', () => {
    const out = run([
      'Dim A(5)',
      'A(1)=11 : A(2)=22',
      'B=Array(A(0))',
      'Jd Array Swap B,1,2',
      'Print A(1);",";A(2)',
    ].join('\n'))
    expect(out.trim()).toBe('22, 11')
  })

  it('Array Swap refuses an index equal to the dimension, as bge does', () => {
    // the checks are `cmp.w d2,d0 / Rbge L_outdim`, so index = dim is error 23
    // even though Array Clear wipes that element
    expect(() => run('Dim A(5) : B=Array(A(0)) : Jd Array Swap B,5,1')).toThrow(/illegal function call/i)
  })

  it('Array Clear zeroes every element including the last', () => {
    const out = run([
      'Dim A(3)',
      'A(0)=1 : A(1)=2 : A(2)=3 : A(3)=4',
      'B=Array(A(0))',
      'Jd Array Clear B',
      'Print A(0);",";A(1);",";A(2);",";A(3)',
    ].join('\n'))
    expect(out.trim()).toBe('0, 0, 0, 0')
  })

  it('Reduce Dim shrinks the header word and Reset Dim puts it back', () => {
    const out = run([
      'Dim A(10)',
      'B=Array(A(0))',
      'Jd Reduce Dim B,4',
      'Print Jd Get Dim(B)',
      'Jd Reset Dim B',
      'Print Jd Get Dim(B)',
    ].join('\n'))
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['4', '10'])
  })

  it('Reduce Dim refuses a value that is not smaller, and Reset Dim an unknown array', () => {
    expect(() => run('Dim A(10) : B=Array(A(0)) : Jd Reduce Dim B,10')).toThrow(/illegal function call/i)
    expect(() => run('Dim A(10) : B=Array(A(0)) : Jd Reduce Dim B,11')).toThrow(/illegal function call/i)
    expect(() => run('Dim A(10) : B=Array(A(0)) : Jd Reset Dim B')).toThrow(/illegal function call/i)
  })

  it('the undo table holds twenty, which is what the manual\'s "max. 20" is', () => {
    // dimlist..dimendlist is twenty six-byte entries; the twenty-first
    // outstanding reduction is error 23
    const prog = ['Dim A(30)', 'B=Array(A(0))']
    for (let i = 0; i < 20; i++) prog.push(`Dim B${i}(10) : C=Array(B${i}(0)) : Jd Reduce Dim C,3`)
    prog.push('Dim Z(10) : D=Array(Z(0)) : Jd Reduce Dim D,3')
    expect(() => run(prog.join('\n'))).toThrow(/illegal function call/i)
  })
})
