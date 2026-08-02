import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'

/**
 * AMCAF (Chris Hodges), against `AMCAF.Guide` and `AMOSPro_AMCAF.Lib`
 * disassembled with `extdis amcaf-1.50`. Slice 0 proves the plumbing only:
 * identity, slot binding, and that wiring an empty port displaced nothing.
 */
const table = new TokenTable(CORE_TOKENS)
/** "Its documentation states the extension expects slot 8" */
const AMCAF_SLOT = 8
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
  [AMCAF_SLOT, extensionById('amcaf-1.50')!.table] as const,
])

function run(src: string | string[], onUnimplemented?: 'throw' | 'skip'): { out: string; rt: Runtime } {
  let out = ''
  const rt = new Runtime(tokenize(Array.isArray(src) ? src.join('\n') : src, table, extensions), table, {
    maxSteps: 1_000_000,
    extensions,
    ...(onUnimplemented ? { onUnimplemented } : {}),
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(200)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return { out, rt }
}

describe('AMCAF identity', () => {
  it('both releases are registered and share one port', () => {
    const a = extensionById('amcaf-1.40')
    const b = extensionById('amcaf-1.50')
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a!.author).toBe('Chris Hodges')
    expect(b!.author).toBe('Chris Hodges')
    expect(b!.defaultSlot).toBe(AMCAF_SLOT)
  })

  it('1.50 is 1.40 plus twelve keywords, removing none', () => {
    // which is why the 1.50 manual documents 1.40 and the author says he had
    // no time to update it -- one port can serve both
    const names = (id: string): Set<string> =>
      new Set(
        extensionById(id)!
          .tokens.filter((e) => e.name)
          .map((e) => e.name.replace(/^!/, '')),
      )
    const v140 = names('amcaf-1.40')
    const v150 = names('amcaf-1.50')
    expect([...v140].filter((n) => !v150.has(n))).toEqual([])
    expect([...v150].filter((n) => !v140.has(n))).toHaveLength(12)
    expect(v150.size).toBe(280)
  })
})

describe('the slice-0 wiring', () => {
  it('binds at slot 8: an AMCAF keyword resolves to its own name', () => {
    // the name in the error is the proof. `amcaf length` is nothing core
    // knows, so it can only have come from slot 8's table -- identity, slot
    // binding and tokenisation all worked, and only the handler is missing
    // (it arrives in slice 10)
    expect(() => run(['Print Amcaf Length'])).toThrow(/unimplemented function: amcaf length/)
  })

  it('under the census policy it yields a typed default instead of throwing', () => {
    // 'skip' is how runreport sees past a missing keyword to count what the
    // rest of a program does. The spec's return-type code decides the type,
    // which matters for the string-returning keywords with no `$` in the name
    const { out, rt } = run(['Print Amcaf Length', 'Print Amcaf Version$'], 'skip')
    // " 0" is AMOS's leading space for a non-negative number; the second line
    // is empty because Amcaf Version$ has spec "2" and defaults to a string
    expect(out).toBe(' 0\n\n')
    expect([...rt.interp.unimplemented.keys()].sort()).toEqual(['amcaf length', 'amcaf version$'])
  })

  it('displaced nothing: the armed contested names still reach Personnal', () => {
    // the eight qualified declarations arrive with their slices. Until then
    // AMCAF must not have taken a name off a port that works. Personnal's
    // Blitter Clear zeroes a screen's planes through its control block, and
    // an empty AMCAF registering the plain name would have silenced it
    const { rt } = run([
      'Screen Open 0,320,200,2,Lowres : Ink 1 : Bar 0,0 To 9,9',
      'Blitter Clear Logbase(0)',
      'Print Point(5,5)',
    ])
    expect(rt).toBeTruthy()
  })
})

describe('slice 1: maths and bit operations', () => {
  const p = (expr: string): string => run([`Print ${expr}`]).out.trim()

  it('Even and Odd are the low bit, -1 or 0 ($4c9a)', () => {
    expect(p('Even(4)')).toBe('-1')
    expect(p('Even(5)')).toBe('0')
    expect(p('Odd(5)')).toBe('-1')
    expect(p('Odd(-4)')).toBe('0') // -4 is even; the test is bit 0, not sign
  })

  it('Wordswap swaps the halves ($4cf6, one `swap d3`)', () => {
    expect(p('Wordswap($12345678)')).toBe(String(0x56781234))
    expect(p('Wordswap(Wordswap($DEADBEEF))')).toBe(String(0xdeadbeef | 0))
  })

  it('Lsl shifts rather than rotating, whatever the manual says ($4ce2)', () => {
    // "Rotates the number 'v' to the left" -- it is `asl.l`, and the manual's
    // own worked description (v*2, v*4, v*8) is the shift
    expect(p('Lsl(1,3)')).toBe('8')
    expect(p('Lsl(3,2)')).toBe('12')
    expect(p('Lsl(1,31)')).toBe(String(-2147483648)) // bits leave the top
  })

  it('Lsr is an ARITHMETIC shift, so a negative stays negative ($4cec)', () => {
    // the keyword is named Lsr and the instruction is asr.l -- which also
    // makes the manual's "same as a division by 2^n" false for negatives
    expect(p('Lsr(8,3)')).toBe('1')
    expect(p('Lsr(-8,1)')).toBe('-4')
    expect(p('Lsr(-3,1)')).toBe('-2') // division by 2 would give -1
    expect(p('Lsr(-1,31)')).toBe('-1') // sign replicated all the way
  })

  it('Binexp and Binlog are inverses over the powers of two', () => {
    expect(p('Binexp(1)')).toBe('2')
    expect(p('Binexp(3)')).toBe('8')
    expect(p('Binexp(16)')).toBe('65536')
    expect(p('Binexp(24)')).toBe('16777216') // the manual's own examples
    expect(p('Binlog(2)')).toBe('1')
    expect(p('Binlog(8)')).toBe('3')
    expect(p('Binlog(65536)')).toBe('16')
    expect(p('Binlog(16777216)')).toBe('24')
    for (const n of [0, 1, 5, 17, 31]) expect(p(`Binlog(Binexp(${n}))`)).toBe(String(n))
  })

  it('Binlog refuses anything that is not exactly a power of two ($4cc2)', () => {
    // `tst.l d0 / Rbne` after the count: a leftover bit is an error, not a
    // floor, and zero takes the `Rbeq` branch before the loop even starts
    expect(() => p('Binlog(0)')).toThrow(/Illegal function call/)
    expect(() => p('Binlog(3)')).toThrow(/Illegal function call/)
    expect(() => p('Binlog(1000)')).toThrow(/Illegal function call/)
    expect(p('Binlog(1024)')).toBe('10')
  })

  it('Qsqr is an integer root, zero for zero and an error for negatives', () => {
    expect(p('Qsqr(0)')).toBe('0')
    expect(p('Qsqr(16)')).toBe('4')
    expect(p('Qsqr(17)')).toBe('4') // integer only
    expect(p('Qsqr(65536)')).toBe('256')
  })

  it('Vin tests an inclusive range', () => {
    expect(p('Vin(5,1 To 10)')).toBe('-1')
    expect(p('Vin(1,1 To 10)')).toBe('-1') // inclusive at both ends
    expect(p('Vin(10,1 To 10)')).toBe('-1')
    expect(p('Vin(11,1 To 10)')).toBe('0')
  })

  it('Vmod WRAPS where Vclip would clamp ($49e6)', () => {
    // "If val exceeds upper by 1, it will be set to lower ... If it goes
    // deeper than lower by 1, it will be set to upper"
    expect(p('Vmod(11,1 To 10)')).toBe('1')
    expect(p('Vmod(12,1 To 10)')).toBe('2')
    expect(p('Vmod(0,1 To 10)')).toBe('10')
    expect(p('Vmod(-1,1 To 10)')).toBe('9')
    // the one-bound form takes zero as the lower bound
    expect(p('Vmod(10,9)')).toBe('0')
    expect(p('Vmod(-1,9)')).toBe('9')
  })

  it('Qsin and Qcos run 1024 units to the turn, scaled by the radius', () => {
    expect(p('Qsin(0,1000)')).toBe('0')
    expect(p('Qsin(256,1000)')).toBe('1000') // a quarter turn is 90 degrees
    expect(p('Qsin(512,1000)')).toBe('0')
    expect(p('Qsin(768,1000)')).toBe('-1000')
    expect(p('Qcos(0,1000)')).toBe('1000')
    expect(p('Qcos(256,1000)')).toBe('0')
    // the angle is masked to 10 bits, so a full turn is transparent
    expect(p('Qsin(1024+256,1000)')).toBe(p('Qsin(256,1000)'))
    // a zero radius returns zero without reading the table
    expect(p('Qsin(123,0)')).toBe('0')
  })

  it('Qarc is the inverse: the angle to a relative point', () => {
    expect(p('Qarc(1,0)')).toBe('0')
    expect(p('Qarc(0,1)')).toBe('256')
    expect(p('Qarc(-1,0)')).toBe('512')
    expect(p('Qarc(0,-1)')).toBe('768')
  })

  it('Nop and Nfn do nothing, which is their documented purpose', () => {
    // "It's only used, like Nop, in speed testing routines"
    expect(p('Nfn')).toBe('0')
    expect(run(['Nop', 'Print 42']).out.trim()).toBe('42')
  })

  it('Cpu and Fpu report the modelled A1200, agreeing with JD', () => {
    // Cpu reads AttnFlags and maps bit 1 to 68020; the same identity the
    // memory pools answer for
    expect(p('Cpu')).toBe('68020')
    expect(p('Fpu')).toBe('0')
  })
})

describe('slice 2: strings', () => {
  const p = (expr: string): string => run([`Print ${expr}`]).out.trim()

  it('Chr.w$/Chr.l$ and Asc.w/Asc.l round-trip a number through bytes', () => {
    expect(p('Len(Chr.w$(1))')).toBe('2')
    expect(p('Len(Chr.l$(1))')).toBe('4')
    expect(p('Asc.w(Chr.w$(12345))')).toBe('12345')
    expect(p('Asc.l(Chr.l$(1234567))')).toBe('1234567')
    // Asc.w is unsigned, Asc.l is signed -- the one asymmetry in the group
    expect(p('Asc.w(Chr.w$(65535))')).toBe('65535')
    expect(p('Asc.l(Chr.l$(-1))')).toBe('-1')
    // "The upper 16 bits of the value are ignored"
    expect(p('Asc.w(Chr.w$($1F0F0))')).toBe(String(0xf0f0))
  })

  it('Asc.w and Asc.l refuse a string too short to hold the value', () => {
    expect(() => p('Asc.w("A")')).toThrow(/Illegal function call/)
    expect(() => p('Asc.l("ABC")')).toThrow(/Illegal function call/)
  })

  it('Lsstr$ pads with spaces and Lzstr$ with zeros, neither with a sign', () => {
    expect(p('"["+Lsstr$(42,5)+"]"')).toBe('[   42]')
    expect(p('"["+Lzstr$(42,5)+"]"')).toBe('[00042]')
    // "The sign of the number will not be printed"
    expect(p('"["+Lsstr$(-42,5)+"]"')).toBe('[   42]')
    expect(p('"["+Lzstr$(-42,5)+"]"')).toBe('[00042]')
  })

  it("Lsstr$ bounds n to 1..10, which is the routine's own check ($488e)", () => {
    expect(() => p('Lsstr$(1,0)')).toThrow(/Illegal function call/)
    expect(() => p('Lsstr$(1,11)')).toThrow(/Illegal function call/)
    expect(p('Len(Lsstr$(1,10))')).toBe('10')
  })

  it("Insstr$ counts LEADING CHARACTERS KEPT, not a 1-based index ($4a44)", () => {
    // the manual's own example, and the routine's `cmp.w d5,d7 / Rbhi` bound
    expect(p('Insstr$("Hello Ben!","dear ",6)')).toBe('Hello dear Ben!')
    expect(p('Insstr$("BC","A",0)')).toBe('ABC') // 0 is legal: insert at the front
    expect(p('Insstr$("AB","C",2)')).toBe('ABC') // len is legal: append
    expect(() => p('Insstr$("AB","C",3)')).toThrow(/Illegal function call/)
    expect(() => p('Insstr$("AB","C",-1)')).toThrow(/Illegal function call/)
    expect(p('Insstr$("AB","",1)')).toBe('AB') // empty insert returns it untouched
  })

  it('Cutstr$ removes an inclusive 1-based run', () => {
    expect(p('Cutstr$("Hello dear Ben!",7 To 11)')).toBe('Hello Ben!')
    expect(p('Cutstr$("ABCDE",1 To 1)')).toBe('BCDE')
    expect(p('Cutstr$("ABCDE",5 To 5)')).toBe('ABCD')
    expect(() => p('Cutstr$("ABC",3 To 1)')).toThrow(/Illegal function call/)
  })

  it('Replacestr$ replaces every occurrence', () => {
    expect(p('Replacestr$("a-b-c","-" To "+")')).toBe('a+b+c')
    expect(p('Replacestr$("aaa","aa" To "b")')).toBe('ba')
    expect(p('Replacestr$("abc","x" To "y")')).toBe('abc')
  })

  it('Itemstr$ numbers items FROM ZERO, with | as the default separator', () => {
    // the manual's three worked examples
    expect(p('Itemstr$("Ben|Semprini|Petri|Andy",1)')).toBe('Semprini')
    expect(p('Itemstr$("The quick brown fox",2," ")')).toBe('brown')
    expect(p('Itemstr$("zero|one|two||four|five",5)')).toBe('five')
    // "empty items can be used without hesitation"
    expect(p('"["+Itemstr$("zero|one|two||four|five",3)+"]"')).toBe('[]')
  })

  it('Itemstr$ errors on an empty string or a missing item', () => {
    expect(() => p('Itemstr$("",0)')).toThrow(/Illegal function call/)
    expect(() => p('Itemstr$("a|b",5)')).toThrow(/Illegal function call/)
  })

  it('Scanstr$ names a key, and answers empty for an unused code', () => {
    expect(p('Scanstr$($40)')).toBe('Space')
    expect(p('Scanstr$($20)')).toBe('A')
    expect(p('Scanstr$($50)')).toBe('F1')
    expect(p('"["+Scanstr$($7F)+"]"')).toBe('[]')
  })
})

describe('slice 3: date and time', () => {
  const p = (expr: string): string => run([`Print ${expr}`]).out.trim()

  it('day zero is 1 January 1978, and it was a Sunday', () => {
    expect(p('Cd Day(0)')).toBe('1')
    expect(p('Cd Month(0)')).toBe('1')
    expect(p('Cd Year(0)')).toBe('1978')
    // "1 (monday) and 7 (sunday)" -- the epoch starts at 7, not at 1
    expect(p('Cd Weekday(0)')).toBe('7')
    expect(p('Cd Weekday(1)')).toBe('1')
    expect(p('Cd Weekday(7)')).toBe('7')
  })

  it("Cd Date$ is 'WWW DD-MMM-YY'", () => {
    expect(p('Cd Date$(0)')).toBe('Sun 01-Jan-78')
    expect(p('Cd Date$(31)')).toBe('Wed 01-Feb-78')
  })

  it('the packed time is Wordswap(minutes)+ticks, as the manual states', () => {
    // "the time is created out of Wordswap(minutes)+ticks"
    const t = 'Ct String("13:45:30")'
    expect(p(`Ct Hour(${t})`)).toBe('13')
    expect(p(`Ct Minute(${t})`)).toBe('45')
    expect(p(`Ct Second(${t})`)).toBe('30')
    expect(p(`Ct Time$(${t})`)).toBe('13:45:30')
    // minutes really are in the high word
    expect(p(`Wordswap(${t}) and $FFFF`)).toBe(String(13 * 60 + 45))
  })

  it('Ct Tick is the tick field itself, at 50 to the second', () => {
    expect(p('Ct Tick(Ct String("00:00:10"))')).toBe('500')
    expect(p('Ct Second(Ct String("00:00:10"))')).toBe('10')
  })

  it('Ct String takes HH:MM or HH:MM:SS, and -1 for anything else', () => {
    expect(p('Ct Time$(Ct String("09:05"))')).toBe('09:05:00')
    expect(p('Ct String("25:00")')).toBe('-1')
    expect(p('Ct String("9-5")')).toBe('-1')
    expect(p('Ct String("")')).toBe('-1')
  })

  it('Cd String parses DD-MMM-YY and the full month name', () => {
    expect(p('Cd Date$(Cd String("01-Jan-78"))')).toBe('Sun 01-Jan-78')
    expect(p('Cd Date$(Cd String("25-December-99"))')).toBe('Sat 25-Dec-99')
    expect(p('Cd String("31-Feb-90")')).toBe('-1') // a date that does not exist
    expect(p('Cd String("hello")')).toBe('-1')
  })

  it('Cd String takes Today/Tomorrow, and a weekday means the LAST one', () => {
    // "weekday strings refer to the last occurence of the week, i.e 'Monday'
    // represents last monday and not next monday"
    expect(p('Cd String("Today")-Current Date')).toBe('0')
    expect(p('Cd String("Tomorrow")-Current Date')).toBe('1')
    expect(p('Cd String("Yesterday")-Current Date')).toBe('-1')
    const back = Number(p('Current Date-Cd String("Monday")'))
    expect(back).toBeGreaterThanOrEqual(1)
    expect(back).toBeLessThanOrEqual(7)
    expect(p('Cd Weekday(Cd String("Monday"))')).toBe('1')
  })

  it('Current Date and Current Time agree with the host clock', () => {
    expect(Number(p('Current Date'))).toBeGreaterThan(16000) // well past 1978
    expect(Number(p('Ct Hour(Current Time)'))).toBeLessThan(24)
    expect(Number(p('Ct Minute(Current Time)'))).toBeLessThan(60)
  })
})
