import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { NA } from '../coverage/status'
import { makeAllInstructions } from './instr'
import { AmigaFS } from '../amiga/vfs'
import { NodeVolume } from '../cli/nodefs'

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

  /**
   * `sub.l #1,d2` makes the counter -1, and `dbra` decrements the low WORD and
   * branches while the result is not -1 -- so from $FFFF it goes all the way
   * round rather than stopping. The trip count is `((count-1) & $FFFF) + 1`.
   *
   * An earlier pass had this as "a count of zero shifts once", which is dbra
   * read backwards, and asserted it here.
   */
  it('a count of ZERO shifts 65536 times, not once', () => {
    // 65536 single-bit shifts of a 32-bit value leave nothing behind
    expect(val('Jd Lsl(0,1)')).toBe('0')
    expect(val('Jd Lsr(0,2)')).toBe('0')
    // asr saturates to the sign instead of emptying
    expect(val('Jd Asr(0,-8)')).toBe('-1')
    expect(val('Jd Asr(0,8)')).toBe('0')
    // and a rotate survives it, because 65536 is a whole number of 32s
    expect(val('Jd Rol(0,$12345678)')).toBe(String(0x12345678))
  })

  it('the count is a WORD, so it wraps rather than running away', () => {
    // 65537 low-words to 1, so this is a single shift
    expect(val('Jd Lsl(65537,1)')).toBe('2')
    // and a negative count is finite, not a hang: -1 gives $FFFE + 1 = 65535
    expect(val('Jd Rol(-1,1)')).toBe(String(1 << (65535 % 32)))
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
    // roxr with a count of 1: X is clear, so a 0 comes into bit 31
    expect(val('Jd Roxr(1,2)')).toBe('1')
    // a count of zero borrows, so X starts SET -- but it also means 65536
    // rotations of a 33-bit register, and 65536 mod 33 is 31, so neither of
    // these is anywhere near the single rotate the count suggests
    expect(val('Jd Roxl(0,1)')).toBe('-1073741824')
    expect(val('Jd Roxr(0,2)')).toBe('10')
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

describe('JD: input (+|jd.s:2031-3705, 5889-5984)', () => {
  /** run with a scripted host: keys and buttons arrive after `after` frames */
  function runWithInput(src: string, feed: (rt: Runtime, frame: number) => void): string {
    let out = ''
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[22, jd]]),
      maxSteps: 2_000_000,
      onText: (t) => (out += t),
    })
    for (let f = 0; f < 40; f++) {
      feed(rt, f)
      const r = rt.frame()
      if (r.status === 'ended' || r.status === 'stopped') break
    }
    return out
  }

  it('Mwait blocks until a button and answers which', () => {
    const out = runWithInput('Print Jd Mwait', (rt, f) => {
      if (f === 3) rt.input.mouseK = 2 // right
    })
    expect(out.trim()).toBe('2')
  })

  it('Keywait waits for one of the allowed keys and ignores the rest', () => {
    const out = runWithInput('Print Jd Keywait("ab")', (rt, f) => {
      if (f === 2) rt.input.keyQueue.push({ ch: 'z', scan: 49 })
      if (f === 5) {
        rt.input.keyQueue.length = 0
        rt.input.keyQueue.push({ ch: 'b', scan: 53 })
      }
    })
    expect(out.trim()).toBe(String('b'.charCodeAt(0)))
  })

  it('Wait Event takes either a button or a key', () => {
    const byKey = runWithInput('Jd Wait Event : Print "done"', (rt, f) => {
      if (f === 3) rt.input.keyQueue.push({ ch: 'x', scan: 50 })
    })
    expect(byKey.trim()).toBe('done')
    const byMouse = runWithInput('Jd Wait Event : Print "done"', (rt, f) => {
      if (f === 3) rt.input.mouseK = 1
    })
    expect(byMouse.trim()).toBe('done')
  })

  it('Keypress and the Moff readers do not wait', () => {
    const out = runWithInput('Print Jd Keypress;",";Jd Moff Click', (rt, f) => {
      if (f === 0) {
        rt.input.keyQueue.push({ ch: 'q', scan: 16 })
        rt.input.mouseK = 3
      }
    })
    expect(out.trim()).toBe('16, 3')
  })

  it('Multi Off/On and the drive LED are n/a, with no handlers', () => {
    // Multi Off is exec's Forbid; there is one task here and no LED
    for (const k of ['jd multi off', 'jd multi on', 'jd dled off', 'jd dled on']) {
      expect(NA.has(k), k).toBe(true)
      expect(k in makeAllInstructions(bootJd()), k).toBe(false)
    }
  })
})

describe('JD: screen readbacks and drawing (+|jd.s:1479-6199)', () => {
  it('reads the screen state AMOS holds', () => {
    expect(run('Screen Open 1,320,200,32,Lowres : Print Jd Screen Planes').trim()).toBe('5')
    expect(run('Screen Offset 0,7,9 : Print Jd Xoffset;",";Jd Yoffset').trim()).toBe('7, 9')
  })

  it('X Pos and Y Pos are polar, in degrees, truncated', () => {
    expect(run('Print Jd X Pos(100,100,10,0)').trim()).toBe('110')
    expect(run('Print Jd Y Pos(100,100,10,90)').trim()).toBe('110')
    expect(run('Print Jd X Pos(100,100,10,180)').trim()).toBe('90')
  })

  it('Char X and Char Y do not move when the face cannot be opened', () => {
    // set_font reads tf_XSize and tf_YSize out of the OPENED font, so with
    // no Fonts: drawer mounted there is nothing to read. The 68k reads them
    // through a null font_font anyway; the port declines that (DEVIATION at
    // the handler) and leaves the previous metrics standing.
    expect(run('Print Jd Char X;",";Jd Char Y').trim()).toBe('8, 8')
    expect(run('Jd Textfont "topaz",16 : Print Jd Char X;",";Jd Char Y').trim()).toBe('8, 8')
  })

  it('Spline draws a curve from the FIRST pair to the SECOND, bent by the THIRD', () => {
    // routine 84's de Casteljau: (x1,y1)->(x3,y3), (x3,y3)->(x2,y2), between.
    // Straight control point, so the curve is the straight line and every
    // segment lands on it -- which is what makes the endpoints checkable.
    const out = run([
      'Screen Open 0,320,200,16,Lowres : Cls 0 : Ink 7',
      'Jd Spline 10,10,110,10,60,10,10',
      'Print Point(10,10);",";Point(60,10);",";Point(110,10);",";Point(10,60)',
    ].join('\n'))
    expect(out.trim()).toBe('7, 7, 7, 0')
  })

  it('Spline bends towards the control point, and reaches the second pair', () => {
    const out = run([
      'Screen Open 0,320,200,16,Lowres : Cls 0 : Ink 4',
      // control well below the chord: the midpoint of the curve sits at
      // (0+2*100+200)/4 = 100 in x and (0+2*100+0)/4 = 50 in y
      'Jd Spline 0,0,200,0,100,100,4',
      'Print Point(200,0);",";Point(100,50);",";Point(100,100)',
    ].join('\n'))
    expect(out.trim()).toBe('4, 4, 0')
  })

  it('Spline with a step count below one draws nothing (`cmp.l d6,d7 / ble`)', () => {
    const out = run([
      'Screen Open 0,320,200,16,Lowres : Cls 0 : Ink 4',
      'Jd Spline 10,10,110,10,60,10,0',
      'Print Point(10,10);",";Point(110,10)',
    ].join('\n'))
    expect(out.trim()).toBe('0, 0')
  })

  it('Draw Angle and Grid put ink on the screen', () => {
    const drew = run([
      'Screen Open 0,320,200,16,Lowres : Cls 0 : Ink 5',
      'Jd Draw Angle 10,10,50,0',
      'Print Point(30,10)',
    ].join('\n'))
    expect(drew.trim()).toBe('5')
    const grid = run([
      'Screen Open 0,320,200,16,Lowres : Cls 0 : Ink 3',
      'Jd Grid 10,10,40,40,10,10',
      'Print Point(10,20);",";Point(20,10)',
    ].join('\n'))
    expect(grid.trim()).toBe('3, 3')
  })

  it('Exdatazone hands out an address that resolves', () => {
    const out = run('A=Jd Exdatazone(22) : Loke A,$1234 : Print Leek(A)').trim()
    expect(out).toBe(String(0x1234))
    expect(run('Print Jd Exdatazone(0)').trim()).toBe('0')
  })

  it('Video Off blanks the display until Video On', () => {
    let out = ''
    const rt = new Runtime(tokenize('Screen Open 0,320,200,16,Lowres : Cls 5 : Jd Video Off', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[22, jd]]),
      maxSteps: 200_000,
      onText: (t) => (out += t),
    })
    rt.runHeadless(50)
    const black = rt.composite().data
    let lit = 0
    for (let i = 0; i < black.length; i += 4) if (black[i]! | black[i + 1]! | black[i + 2]!) lit++
    expect(lit).toBe(0)
    rt.jd.videoOff = false
    const back = rt.composite().data
    let lit2 = 0
    for (let i = 0; i < back.length; i += 4) if (back[i]! | back[i + 1]! | back[i + 2]!) lit2++
    expect(lit2).toBeGreaterThan(0)
  })

  it('the machine-level keywords are n/a, with reasons', () => {
    // a hard reset, an ILLEGAL instruction, and a graphics.library pointer
    for (const k of ['jd reset', 'jd private', 'jd rastport']) expect(NA.has(k), k).toBe(true)
    expect('jd reset' in makeAllInstructions(bootJd())).toBe(false)
  })
})

describe('JD: files, memory and the device boundary (+|jd.s:2948-5769)', () => {
  /** a runtime with a writable RAM: to exercise the file half */
  function runFs(src: string): string {
    let out = ''
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[22, jd]]),
      maxSteps: 2_000_000,
      fs,
      onText: (t) => (out += t),
    })
    const r = rt.runHeadless(500)
    if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
    return out
  }

  it('reads size and type through the same filesystem LDos uses', () => {
    const out = runFs([
      'Open Out 1,"RAM:t.txt" : Print #1,"hello" : Close 1',
      'Print Jd File Size("RAM:t.txt")',
      'Print Jd File Type("RAM:t.txt")',
      'Print Jd File Size("RAM:nothere")',
    ].join('\n'))
    const lines = out.trim().split('\n').map((s) => s.trim())
    expect(Number(lines[0])).toBeGreaterThan(0)
    expect(lines[1]).toBe('-3') // negative for a file, AmigaDOS's convention
    expect(lines[2]).toBe('-1')
  })

  it('round-trips the comment and protection bits', () => {
    const out = runFs([
      'Open Out 1,"RAM:t.txt" : Print #1,"x" : Close 1',
      'A=Jd Set Comment("RAM:t.txt","a note")',
      'B=Jd Set Protection("RAM:t.txt",7)',
      'Print Jd File Comment$("RAM:t.txt")',
      'Print Jd File Protection("RAM:t.txt")',
    ].join('\n'))
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['a note', '7'])
  })

  it('copies a file and counts a directory', () => {
    const out = runFs([
      'Open Out 1,"RAM:a.txt" : Print #1,"data" : Close 1',
      'Print Jd Copy("RAM:a.txt","RAM:b.txt")',
      'Print Jd File Size("RAM:b.txt")>0',
      'Print Jd Count Files("RAM:")',
    ].join('\n'))
    const lines = out.trim().split('\n').map((s) => s.trim())
    expect(lines[0]).toBe('0')
    expect(lines[1]).toBe('-1')
    expect(Number(lines[2])).toBeGreaterThanOrEqual(2)
  })

  it('reports the memory pools AvailMem would', () => {
    // a comparison prints without the leading space a number gets
    const out = run('Print Jd Largest Chip Free>0;",";Jd Largest Fast Free>0').trim()
    expect(out).toBe('-1,-1')
  })

  /**
   * Routine 119 ($748a) reads the longword FOUR BYTES BEFORE the address it is
   * given, drops the low byte and arithmetic-shifts the rest down eight. That
   * is PowerPacker's trailer -- three bytes of decrunched length plus one byte
   * of skip-bits -- so it answers a SIZE.
   *
   * This port used to test the first four bytes for the literal "PP20" and
   * answer -1 or 0, which is a signature check the routine never performs.
   */
  it('Ppfind Mem reads the decrunched length out of the word before the address', () => {
    const out = run([
      'Reserve As Work 10,32',
      // trailer at Start(10): length $123456 in the top three bytes, skip in
      // the low one; the address handed over is four bytes past it
      'Loke Start(10),$12345607',
      'Print Jd Ppfind Mem(Start(10)+4)',
      'Loke Start(10),0',
      'Print Jd Ppfind Mem(Start(10)+4)',
    ].join('\n'))
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual([String(0x123456), '0'])
  })

  it('Ppfind Mem shifts with asr, so a length with bit 31 set comes back negative', () => {
    const out = run(['Reserve As Work 10,32', 'Loke Start(10),$FF000000', 'Print Jd Ppfind Mem(Start(10)+4)'].join('\n'))
    expect(out.trim()).toBe(String((0xff000000 | 0) >> 8))
  })

  it('the raw-floppy keywords are n/a — there is no block device under AmigaFS', () => {
    for (const k of [
      'jd read sector',
      'jd write sector',
      'jd install',
      'jd format',
      'jd shortformat',
      'jd relabel',
      'jd diskchange',
      'jd squash',
    ]) {
      expect(NA.has(k), k).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------ *
 * The 5.9 delta — the five keywords that exist only in the later table,
 * read out of the 5.9 BINARY (AMOSPro_JD.Lib) because the 5.3 source
 * predates them. Bound at slot 22 as 5.9 rather than 5.3.
 * ------------------------------------------------------------------ */
const jd59 = extensionById('jd-5.9')!
const exts59 = new Map([[22, jd59.table]])

function run59(src: string): string {
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts59), table, {
    extensions: exts59,
    extBindings: new Map([[22, jd59]]),
    maxSteps: 2_000_000,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(500)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return out
}
const val59 = (expr: string): string => run59(`Print ${expr}`).trim()

/**
 * 4.6, the version that answers slot 22's last unexplained ids. Its table is
 * registered for identification; the port serves it by name like the others,
 * and it carries three keywords 5.3 dropped.
 */
const jd46 = extensionById('jd-4.6')!
const exts46 = new Map([[22, jd46.table]])

function run46(src: string): string {
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts46), table, {
    extensions: exts46,
    extBindings: new Map([[22, jd46]]),
    maxSteps: 2_000_000,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(500)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return out
}

describe('JD 5.9: the keywords the later table added', () => {
  it('Jd Pattern IS Jd Compare — same token id, same routine, new word', () => {
    const a = jd.tokens.find((t) => t.name.replace(/^!/, '').trim() === 'jd compare')!
    const b = jd59.tokens.find((t) => t.name.replace(/^!/, '').trim() === 'jd pattern')!
    expect([b.id, b.spec, b.func]).toEqual([a.id, a.spec, a.func])
    // and it behaves as Jd Compare does: the manual's own example
    expect(val59('Jd Pattern("Test-String","*t-S*")')).toBe('1')
    expect(val59('Jd Pattern("Test-String","*z*")')).toBe('0')
  })

  it('Jd Cpu, Jd Fpu and Jd Chipset answer for the machine this port models', () => {
    // routine 162 adds $109a0 = 68000 to the 0/10/20/30/40 from AttnFlags,
    // so the answer is the full part number. An A1200: 68020, no FPU, AA.
    expect(val59('Jd Cpu')).toBe('68020')
    expect(val59('Jd Fpu')).toBe('0')
    expect(val59('Jd Chipset')).toBe('2')
  })

  it('Jd Dpath gives the 1-based position the filename starts at', () => {
    expect(val59('Jd Dpath("df0:file")')).toBe('5')
    expect(val59('Jd Dpath("dh0:games/amos/prog")')).toBe('16')
    expect(val59('Jd Dpath("file")')).toBe('1')
  })

  it('Jd Dpath never examines character 0 — ":file" answers 1, not 2', () => {
    // `subq.w #1,d3 / beq` leaves the loop before the first character is
    // tested, so a path that is nothing but a separator and a name misses it
    expect(val59('Jd Dpath(":file")')).toBe('1')
    expect(val59('Jd Dpath("/file")')).toBe('1')
    // one character further along and it is seen
    expect(val59('Jd Dpath("a:file")')).toBe('3')
  })

  it('Jd Stream$ reads memory up to a terminator byte', () => {
    // routine 121 in the 4.6 source, dropped by 5.3. Bank 10 gives a mapped
    // address to read from; "AB" then a linefeed, then more
    const out = run46([
      'Reserve As Work 10,16',
      'Loke Start(10),$41420A43',
      'Print Jd Stream$(Start(10),Start(10)+16,10)',
      // the copy stops at `end` while the length was already counted
      'Print Len(Jd Stream$(Start(10),Start(10)+1,10))',
      // start equal to end takes the `terminate` path
      'Print Len(Jd Stream$(Start(10),Start(10),10))',
    ].join('\n'))
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['AB', '1', '0'])
  })

  it('the two intuition base keywords are n/a, as Jd Rastport is', () => {
    expect(NA.has('jd intscreen base')).toBe(true)
    expect(NA.has('jd intwindow base')).toBe(true)
  })

  it('an empty path answers 1 rather than running off the end of the string', () => {
    // the counter starts at zero, so the `beq` never fires and the routine
    // walks backwards through memory. The deviation is recorded at the
    // keyword; here it stops and gives the bare-filename answer.
    expect(val59('Jd Dpath("")')).toBe('1')
  })
})

/**
 * The keywords the earlier slices classified FAITHFUL but never ran.
 *
 * The faithfulness gate found these: 27 keywords asserting they had been
 * checked against the 68k, none of which the suite dispatched, so the claim
 * rested on code review alone. Each test below runs the keyword and cites the
 * routine the port was written from. One of them changed an answer rather than
 * confirming it — see Jd Array$ Clear.
 */
describe('JD: the keywords the gate caught', () => {
  /** run with a scripted host, as the input describe above does */
  function runWithInput(src: string, feed: (rt: Runtime, frame: number) => void): string {
    let out = ''
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[22, jd]]),
      maxSteps: 2_000_000,
      onText: (t) => (out += t),
    })
    for (let f = 0; f < 40; f++) {
      feed(rt, f)
      const r = rt.frame()
      if (r.status === 'ended' || r.status === 'stopped') break
    }
    return out
  }

  /** a Runtime run to completion, for the keywords whose effect is state */
  function runRt(src: string): Runtime {
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[22, jd]]),
      maxSteps: 2_000_000,
    })
    rt.runHeadless(500)
    return rt
  }

  it('Asl IS Lsl — the 68000 has no arithmetic left shift that differs', () => {
    // routine 76 (+|jd.s:3781) is `asl.l #1,d3`, and asl and lsl are the same
    // instruction on the 68000: only the flags differ, and JD reads none
    expect(val('Jd Asl(1,1)')).toBe('2')
    expect(val('Jd Asl(1,-8)')).toBe('-16')
    expect(val('Jd Asl(1,-8)')).toBe(val('Jd Lsl(1,-8)'))
    // asr is the one that keeps the sign, and it is a different answer
    expect(val('Jd Asr(1,-8)')).toBe('-4')
  })

  it('Find answers 0 on a string array, having no pointers to follow', () => {
    // routine 80 (+|jd.s:3878) hands each element to Jd Compare's matcher; a
    // string array's elements are pointers the arena does not map. See NOTES.
    expect(run('Dim A(5) : B=Array(A(0)) : Print Jd Find(B,"x")').trim()).toBe('0')
  })

  it('Array$ Clear leaves a string array alone — it is not in the arena', () => {
    // routine 152 (:6053) points every element at a fresh empty string, so on
    // the machine a program reads the array back empty. Here Array(A$(0)) does
    // not answer an arena address at all, so there is nothing to repoint and
    // the contents survive. This test is why the comment above the handler now
    // says so; it claimed the opposite.
    const out = run([
      'Dim A$(3)',
      'A$(0)="x" : A$(3)="y"',
      'B=Array(A$(0))',
      'Jd Array$ Clear B',
      'Print "["+A$(0)+"]["+A$(3)+"]"',
    ].join('\n'))
    expect(out.trim()).toBe('[x][y]')
    // and the numeric form, which does map, still clears every element
    expect(
      run('Dim A(2) : A(0)=1 : A(2)=3 : B=Array(A(0)) : Jd Array Clear B : Print A(0);",";A(2)').trim(),
    ).toBe('0, 0')
  })

  it('Checkprt answers 0 — nothing is attached', () => {
    // routine 83 (+|jd.s:4002), and IOPorts already settled that this port has
    // no printer unless the host supplies one
    expect(val('Jd Checkprt')).toBe('0')
  })

  it('Flush is a no-op a program cannot observe', () => {
    // routine 87 flushes the DOS buffers; there is nothing for a program to
    // see afterwards that differs, which is why it is faithful rather than a
    // stub. What is checked here is that it dispatches and does not throw.
    expect(run('Jd Flush : Print "ok"').trim()).toBe('ok')
  })

  it('Print writes through the console when no face has been opened', () => {
    // routine 89 (:4215) tests font_font first and branches to nojdf when it
    // is zero, which is an ordinary WiCall Print of the string
    expect(run('Jd Print "hi" : Print "|"').trim()).toBe('hi|')
    // and a face that could not be opened leaves it zero
    expect(run('Jd Textfont "nosuch.font",8 : Jd Print "hi" : Print "|"').trim()).toBe('hi|')
  })

  it('Screen Resolution switches the current screen to hires and back', () => {
    // routine 161 (+|jd.s:6796)
    expect(runRt('Screen Open 0,320,200,16,Lowres : Jd Screen Resolution 1').screen.hires).toBe(true)
    expect(runRt('Screen Open 0,640,200,16,Hires : Jd Screen Resolution 0').screen.hires).toBe(false)
  })

  it('Video On clears what Video Off set', () => {
    // routines 112 and 113 (:5140, :5145) are DMACON writes; modelled as a
    // blank display, because with the copper stopped there is nothing to walk
    expect(runRt('Jd Video Off').jd.videoOff).toBe(true)
    expect(runRt('Jd Video Off : Jd Video On').jd.videoOff).toBe(false)
  })

  it('Draw Segment walks the arc between the two angles', () => {
    // routine 160 (+|jd.s:6199). Angle 0 is (x+rx, y), 90 is (x, y+ry), and a
    // 0..90 segment covers both ends and nothing outside the quadrant
    const out = run([
      'Screen Open 0,320,200,16,Lowres : Cls 0 : Ink 7',
      'Jd Draw Segment 100,100,50,50,0,90',
      'Print Point(150,100);",";Point(100,150);",";Point(50,100)',
    ].join('\n'))
    expect(out.trim()).toBe('7, 7, 0')
  })

  it('Ppdecrunch leaves the destination alone when the source is not PP20', () => {
    // routine 120 (:5216). The port runs the same decruncher LDos slice 9
    // wired up, behind the signature check the routine makes first
    const out = run([
      'Reserve As Work 1,64 : Reserve As Work 2,64',
      'Loke Start(2),$AABBCCDD',
      'Jd Ppdecrunch Start(1),Start(2),64',
      'Print Hex$(Leek(Start(2)))',
    ].join('\n'))
    expect(out.trim()).toBe('$AABBCCDD')
  })

  it('Spread writes its finished line, centred', () => {
    // routine 46 (+|jd.s:2755) reveals a centred string a character at a time
    // through AMOS's Centre. The motion is not paced here (see the DEVIATION);
    // the finished line is what a program can observe afterwards.
    const out = run('Jd Spread "hi",1,1')
    expect(out.trimEnd().endsWith('hi')).toBe(true)
    // centred on a 40-column screen: (40-2)/2 = 19 spaces
    expect(out.indexOf('hi')).toBe(19)
  })

  it('Tscroll waits for the button or key that would have stopped it', () => {
    // routine 47 (:2863) ends on `btst #6,$bfe001` or a key
    const out = runWithInput('Jd Tscroll "go",1,1 : Print "|"', (rt, f) => {
      if (f === 3) rt.input.mouseK = 1
    })
    expect(out).toContain('go')
    expect(out).toContain('|')
  })

  it('Wait Amiga needs the Amiga key held as well as the other one', () => {
    // routine 43 (+|jd.s:2507). A key on its own is not enough
    const out = runWithInput('Print Jd Wait Amiga', (rt, f) => {
      if (f === 2) rt.input.keyQueue.push({ ch: 'a', scan: 32 })
      if (f === 5) {
        rt.input.keys.add(0x66)
        rt.input.keyQueue.length = 0
        rt.input.keyQueue.push({ ch: 'b', scan: 53 })
      }
    })
    expect(out.trim()).toBe(String('b'.charCodeAt(0)))
  })

  it('Moff Key answers twice the complement, not a scancode', () => {
    // routines 142 and 145 (:5907, :5941) go to the hardware because Jd Multi
    // Off is exec's Forbid. Double Click reads a BUTTON and agrees with its
    // ordinary neighbour; Moff Key reads $bfec01, and the keyboard does not
    // put a scancode there.
    //
    // DEFECT: `lsr.b #1 / lsl.b #1` clears the bit it has just tested and the
    // byte is never decoded — no `not.b`, no `ror.b #1` — so what comes back
    // is 2 * (127 - scancode). Range's Key Scan bug, doubled.
    const out = runWithInput('Print Jd Moff Key;",";Jd Double Click', (rt, f) => {
      if (f === 0) {
        rt.keyDown(16) // Q
        rt.input.mouseK = 1
      }
    })
    expect(out.trim()).toBe(`${2 * (127 - 16)}, 1`) // 222, 1

    // bit 0 is the press/release marker, so a key coming up answers 0
    const up = runWithInput('Print Jd Moff Key', (rt, f) => {
      if (f === 0) rt.keyUp(16)
    })
    expect(up.trim()).toBe('0')
  })

  it('Get String$ and Get Number take the line the host supplies', () => {
    // routines 44 and 37 (:2521, :2217) are their own line editors; this port
    // routes them through the one the core's Input uses (see the DEVIATION),
    // so what is checked is the value and the length bound, not the editing
    const rt = new Runtime(tokenize('A$=Jd Get String$("dflt",3)\nPrint "["+A$+"]"', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[22, jd]]),
      maxSteps: 2_000_000,
      onText: (t) => (text += t),
    })
    let text = ''
    rt.frame()
    expect(rt.interp.blocked?.type).toBe('input')
    rt.submitLine('abcdefgh')
    rt.frame()
    // bounded by maxlen, which is 3
    expect(text).toContain('[abc]')
  })

  it('Get Number falls back to the default on an empty line, and takes 254 for 0', () => {
    let text = ''
    const rt = new Runtime(tokenize('Print Jd Get Number(42,0)', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[22, jd]]),
      maxSteps: 2_000_000,
      onText: (t) => (text += t),
    })
    rt.frame()
    expect(rt.interp.blocked?.type).toBe('input')
    rt.submitLine('')
    rt.frame()
    // `no_lim` (:2222) takes 254 when the length is 0, so nothing truncates,
    // and an empty line leaves the default standing
    expect(text).toContain('42')
  })
})

describe('JD: the device list and the directory counts (+|jd.s:4262-5769)', () => {
  function runFs(src: string): string {
    let out = ''
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[22, jd]]),
      maxSteps: 2_000_000,
      fs,
      onText: (t) => (out += t),
    })
    const r = rt.runHeadless(500)
    if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
    return out
  }

  it('Count Dirs counts the directories where Count Files counts the rest', () => {
    // routines 136 and 137 (+|jd.s:5761, :5769)
    const out = runFs([
      'Mkdir "RAM:one" : Mkdir "RAM:two"',
      'Open Out 1,"RAM:f.txt" : Print #1,"x" : Close 1',
      'Print Jd Count Dirs("RAM:")',
      'Print Jd Count Files("RAM:")',
    ].join('\n'))
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['2', '1'])
  })

  it('Hardware$, Volume$ and Logical$ are the three halves of the device list', () => {
    // routines 90, 91 and 92 (:4262, :4267, :4272). Physical devices, mounted
    // volumes and assigns; the first two answer the same list here because a
    // mounted memory volume IS the device
    const out = runFs([
      'Print "["+Jd Volume$+"]"',
      'Print "["+Jd Hardware$+"]"',
      'Print "["+Jd Logical$+"]"',
    ].join('\n'))
    const lines = out.trim().split('\n').map((s) => s.trim())
    expect(lines[0]).toContain('RAM')
    expect(lines[1]).toContain('RAM')
    // no assigns unless something makes one
    expect(lines[2]).toBe('[]')
  })
})

// ---- the real .font tree, when the original partition's fonts are present ----

const FONTS = join(__dirname, '..', '..', 'fixtures', 'fonts')

describe.skipIf(!existsSync(FONTS))('JD: Textfont and Print with a real face (+|jd.s:4177, :4215)', () => {
  function boot(src: string): { rt: Runtime; out: string } {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    fs.mount('FontDisc', new NodeVolume(FONTS))
    fs.assign('Fonts', 'FontDisc:')
    let out = ''
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[22, jd]]),
      maxSteps: 2_000_000,
      fs,
      onText: (t) => (out += t),
    })
    const r = rt.runHeadless(500)
    if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
    return { rt, out }
  }

  it('opens the named face onto the screen\'s rp_Font', () => {
    // SetFont(T_RastPort, font) -- and the manual is explicit that the face
    // is "for writing with >>Text<< or >>Jd Print<<", which is what one
    // rp_Font shared with AMOS's own Text means
    const { rt } = boot('Screen Open 0,320,200,16,Lowres : Jd Textfont "2001.font",8')
    expect(rt.screen.font).not.toBeNull()
    expect(rt.screen.font!.ySize).toBe(8)
    expect(rt.jd.font).toBe(rt.screen.font)
  })

  it('Char X and Char Y are the OPENED font\'s tf_XSize and tf_YSize', () => {
    // `move.w 20(a0),d0 / move.w 24(a0),d1` off the TextFont struct, not the
    // size the program asked for. Both of these refute the old size>>1 guess:
    // 2001/8 is square at 8 wide rather than 4, and Pica/32 is 26 rather
    // than 16 -- a proportional face whose nominal width is nothing like
    // half its height.
    expect(boot('Jd Textfont "2001.font",8 : Print Jd Char X;",";Jd Char Y').out.trim()).toBe('8, 8')
    const pica = boot('Jd Textfont "Pica.font",32 : Print Jd Char X;",";Jd Char Y').out.trim()
    expect(pica).toBe('26, 32')
  })

  it('the .font suffix is optional, because programs pass it either way', () => {
    expect(boot('Jd Textfont "2001",8 : Print Jd Char X').out.trim()).toBe('8')
  })

  it('a size the family does not have opens nothing', () => {
    // 2001.font holds one entry, ySize 8; OpenDiskFont answers NULL for 9
    const { rt } = boot('Jd Textfont "2001.font",9')
    expect(rt.jd.font).toBeNull()
    expect(rt.screen.font).toBeNull()
  })

  it('Print draws glyphs at the text cursor and advances it by characters', () => {
    // Move(rp, X*fx, (Y+1)*fy - 2) then Text, then Locate(X+len, Y). With
    // 2001/8 that is a baseline of 6 for row 0, so the glyphs land in rows
    // 0..7 of the screen -- where the console would have put them.
    const { rt } = boot([
      'Screen Open 0,320,200,16,Lowres : Cls 0 : Curs Off : Ink 5',
      'Locate 2,0',
      'Jd Textfont "2001.font",8',
      'Jd Print "AB"',
    ].join('\n'))
    let lit = 0
    for (let y = 0; y < 8; y++) for (let x = 16; x < 32; x++) if (rt.screen.point(x, y) === 5) lit++
    expect(lit).toBeGreaterThan(10) // two real glyphs, drawn in the ink
    // nothing before the cursor column
    let before = 0
    for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) if (rt.screen.point(x, y) !== 0) before++
    expect(before).toBe(0)
    // the cursor advanced by the CHARACTER count, not by the pixels drawn
    expect([rt.screen.curX, rt.screen.curY]).toEqual([4, 0])
  })

  it('Print turns the text cursor off first, as the ESC "C0" it sends does', () => {
    const { rt } = boot([
      'Screen Open 0,320,200,16,Lowres : Curs On',
      'Jd Textfont "2001.font",8',
      'Jd Print "x"',
    ].join('\n'))
    expect(rt.screen.cursorOn).toBe(false)
  })

  it('AMOS\'s own Text draws through the face JD opened', () => {
    // one rp_Font, two callers -- the manual's ">>Text<< or >>Jd Print<<"
    const { rt } = boot([
      'Screen Open 0,320,200,16,Lowres : Cls 0 : Ink 3',
      'Jd Textfont "2001.font",8',
      'Text 40,60,"A"',
    ].join('\n'))
    let lit = 0
    for (let y = 50; y < 62; y++) for (let x = 40; x < 50; x++) if (rt.screen.point(x, y) === 3) lit++
    expect(lit).toBeGreaterThan(5)
  })
})
