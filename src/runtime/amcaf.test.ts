import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { NullAudio } from '../amiga/paula'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'
import { pp20Crunch } from '../amiga/powerpacker'
import { NodeVolume } from '../cli/nodefs'
import { Machine } from '../amiga/machine'

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

/**
 * The same harness with a real audio sink attached.
 *
 * `run` builds a Runtime with no `audio:`, so `rt.host.audio?.` is undefined
 * and every Pt/Sam call through it is a silent no-op — which is why nothing
 * about the replayer's channel handling could be asserted before.
 */
function runAudio(src: string[]): { out: string; rt: Runtime; audio: NullAudio } {
  let out = ''
  const audio = new NullAudio()
  const rt = new Runtime(tokenize(src.join('\n'), table, extensions), table, {
    maxSteps: 1_000_000,
    extensions,
    audio,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(200)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return { out, rt, audio }
}

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
    // the name in the error is the proof: a keyword nothing core knows can
    // only have come from slot 8's table, so identity, slot binding and
    // tokenisation all worked and only the handler is missing. Any AMCAF
    // keyword still without one will do -- this was Reset Computer until the
    // machine layer gave it one, then Extreinit until the slot lifecycle did.
    // The Imploder pair are the last two, so when they land this test needs a
    // different subject or a different proof
    expect(() => run(['Imploder Load 1,"x"'])).toThrow(/unimplemented: imploder load/)
  })

  it('under the census policy it is skipped instead of throwing', () => {
    // 'skip' is how runreport sees past a missing keyword to count what the
    // rest of a program does.
    //
    // This asserted a typed DEFAULT until the extension-table pass, using
    // `Print Extbase` -- the spec's return-type code choosing an integer over
    // a string, which matters for the string-returning keywords with no `$`
    // in the name. AMCAF has no unimplemented function left to demonstrate it
    // with: the three keywords still without a handler are Extreinit, which
    // is n/a, and the Imploder pair, and all three are instructions.
    const { out, rt } = run(['Imploder Load 1,"x"', 'Print 42'], 'skip')
    expect(out).toBe(' 42\n')
    expect([...rt.interp.unimplemented.keys()]).toEqual(['imploder load'])
  })

  /**
   * The contested names now resolve BY SLOT, which is what `qualified` is for.
   *
   * Personnal's `Blitter Clear` takes an address and zeroes a screen's planes
   * through its control block; AMCAF's takes `screen,bitplane`. They are
   * different keywords that happen to share a spelling, and dispatch is by
   * name — so until AMCAF declared them, every AMCAF program calling either
   * one silently got Personnal's handler and its argument shape.
   *
   * Both still work, each under the slot its own program bound.
   */
  it('the contested blitter names resolve by slot, not first-wins', () => {
    // this harness binds AMCAF at slot 8, so the name now reaches AMCAF's
    // screen,bitplane form — which is the whole point. Personnal's address
    // form is covered in personnal.test.ts, under a binding that loads
    // Personnal and not AMCAF.
    const amcaf = run([
      'Screen Open 0,64,32,4,Lowres : Cls 0 : Ink 3 : Bar 0,0 To 9,9',
      'Blitter Clear 0,0',
      'Print Point(5,5)',
    ])
    // plane 0 wiped, so colour 3 (binary 11) becomes 2
    expect(amcaf.out.trim()).toBe('2')

    // and Personnal's ADDRESS form is a syntax error here, because the two
    // keywords take different arguments — the divergence the shared spelling
    // was hiding for the whole of the AMCAF port
    expect(() => run(['Screen Open 0,320,200,2,Lowres', 'Blitter Clear Logbase(0)'])).toThrow()
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
    expect(p('Qsin(512,1000)')).toBe('0')
    // the angle is masked to 10 bits, so a full turn is transparent
    expect(p('Qsin(1024+256,1000)')).toBe(p('Qsin(256,1000)'))
    // a zero radius returns zero without reading the table
    expect(p('Qsin(123,0)')).toBe('0')
  })

  /**
   * DEFECT: AMCAF's table peaks ONE STEP EARLY, so a quarter turn is 255
   * rather than 256 and `Qcos(0)` is not the radius.
   *
   * The init at $a2d8 copies 255 quarter-table entries, writes $100 as the
   * 256th, then mirrors — which puts the maximum at index 255 and 767 and
   * leaves DOUBLED zeros at 0/1023 and 511/512. An earlier pass here
   * generated `round(256*sin)` over a symmetric 1024 and disagreed with the
   * shipped table at 770 of 1024 entries.
   *
   * Reproduced rather than corrected: a program that plots a circle with
   * Qsin/Qcos gets AMCAF's circle, one unit out of round in the same place
   * the Amiga put it.
   */
  it('the sine table peaks one step early, so Qcos(0) is not the radius', () => {
    expect(p('Qsin(255,1000)')).toBe('1000') // the real maximum
    expect(p('Qsin(256,1000)')).toBe('996') // what "a quarter turn" gives
    expect(p('Qsin(767,1000)')).toBe('-1000')
    expect(p('Qcos(0,1000)')).toBe('996') // cos(0) * r is NOT r
    expect(p('Qcos(255,1000)')).toBe('0')
    // the doubled zero: 511 and 512 both land on it, as do 0 and 1023
    expect(p('Qsin(511,1000)')).toBe('0')
    expect(p('Qsin(512,1000)')).toBe('0')
  })

  it('Qarc is the inverse: the angle to a relative point', () => {
    expect(p('Qarc(1,0)')).toBe('0')
    expect(p('Qarc(0,1)')).toBe('256')
    expect(p('Qarc(-1,0)')).toBe('512')
    expect(p('Qarc(0,-1)')).toBe('768')
  })

  /**
   * The four axes above pass under an arctangent OR the library's table, so
   * they cannot tell the two apart — and an earlier pass here used
   * `Math.atan2` with `Math.round`, which disagrees with the shipped table at
   * 3808 of the 6561 points in a 81x81 grid. These are angles where they
   * differ, so the test fails if anyone swaps the table back for a formula.
   */
  it('Qarc reads the floored table, which is not round(atan2)', () => {
    expect(p('Qarc(100,37)')).toBe('57') // atan2 rounds this to 58
    expect(p('Qarc(-70,-24)')).toBe('565') // and this to 566
    // the eighth-turn mirror: |dy| > |dx| takes the 256-t branch
    expect(p('Qarc(37,100)')).toBe('199')
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

  /**
   * Routine 332 ($72f4): `divu.w #$32,d3` then `move.w d2,d3 / swap d3` keeps
   * the REMAINDER, exactly as Ct Minute keeps the remainder of its divide by
   * sixty. Ct Second (routine 331) keeps the quotient of the same divide, so
   * the two partition the field rather than reading it at two resolutions --
   * which is what the manual's "the number of vertical blanks (=1/50 of a
   * second)" was read as before the routine was followed.
   */
  it('Ct Second and Ct Tick partition the ticks field, quotient and remainder', () => {
    expect(p('Ct Second(Ct String("00:00:10"))')).toBe('10')
    expect(p('Ct Tick(Ct String("00:00:10"))')).toBe('0')
    // a tick count that is not a whole second: 505 ticks is 10s and 5 ticks
    expect(p('Ct Tick(Wordswap(0)+505)')).toBe('5')
    expect(p('Ct Second(Wordswap(0)+505)')).toBe('10')
    // never 50 or more, whatever the field holds
    expect(p('Ct Tick(Wordswap(0)+2999)')).toBe('49')
  })

  /**
   * Cd Year is routine 322 ($7104), a subtract-a-year-at-a-time loop whose
   * leap test is `move.b d3,d4 / andi.b #$3,d4` -- `year & 3` and nothing
   * else. 2100 is not a leap year under the calendar everyone else uses and
   * AMCAF gives it a 29 February, so from 1 March 2100 its dates run a day
   * behind. Reproduced, because a program that prints a date wants the date
   * AMCAF printed.
   */
  it('DEFECT: the leap rule is year AND 3, so 2100 gets a 29 February', () => {
    // 1 Jan 2100 is day 44560 counting from 1 Jan 1978 with the real calendar
    const y2100 = Math.floor((Date.UTC(2100, 0, 1) - Date.UTC(1978, 0, 1)) / 86400000)
    expect(p(`Cd Year(${y2100})`)).toBe('2100')
    // AMCAF believes in 29-Feb-2100; the real calendar says 1 March
    expect(p(`Cd Date$(${y2100 + 59})`)).toBe('Mon 29-Feb-00')
    expect(p(`Cd Day(${y2100 + 59})`)).toBe('29')
    expect(p(`Cd Month(${y2100 + 59})`)).toBe('2')
    // and 1980, 2000 and 2004 -- the years the two rules agree on -- still work
    expect(p('Cd Date$(789)')).toBe('Fri 29-Feb-80')
  })

  /**
   * Nothing in the year loop or the month splitter bounds its input. A
   * negative day count fails the very first `cmp.l d1,d0` and drops straight
   * out with the remainder untouched, so the answer is 1978, month 1, and a
   * day number of `days + 1`.
   */
  it('a date before the epoch is reported as January 1978 with a day of zero', () => {
    expect(p('Cd Year(-1)')).toBe('1978')
    expect(p('Cd Month(-1)')).toBe('1')
    expect(p('Cd Day(-1)')).toBe('0')
    expect(p('Cd Day(-5)')).toBe('-4')
  })

  /**
   * Cd Weekday is `(days+6) divu 7` (routine 325), and `divu.w` is a 32-by-16
   * divide: past day 458745 the quotient will not fit a word, so the 68000
   * leaves the operand alone and sets V. The routine never looks, and goes on
   * to clear the low word, swap and increment a byte -- so the answer becomes
   * the TOP HALF of the day count rather than a weekday.
   */
  it('DEFECT: Cd Weekday past day 458745 returns half the day count', () => {
    expect(p('Cd Weekday(458745)')).toBe('7') // the last day that still divides
    expect(p('Cd Weekday(458746)')).toBe('8') // (458752 >> 16) + 1
    expect(p('Cd Weekday(1000000)')).toBe('16') // (1000006 >> 16) + 1 = 15 + 1
  })

  /**
   * The two-digit printer at $7514 and $7638 starts each character at '0' and
   * counts up, byte-wide, with no upper bound. Its tens test is `cmp.b #$a,d0`
   * with a SIGNED branch, so a byte of $80..$FF skips the tens loop and is
   * counted out one unit at a time instead.
   */
  it('DEFECT: the two-digit printer walks past 9 rather than widening', () => {
    // the minutes field is sixteen bits, so an hour count of 25 is ordinary
    expect(p('Ct Time$(Wordswap(25*60))')).toBe('25:00:00')
    // at 100 hours the tens character counts ten past '0' and lands on ':',
    // and the string is still the eight characters the length word promised
    expect(p('Ct Time$(Wordswap(100*60))')).toBe(':0:00:00')
    expect(p('Ct Time$(Wordswap(100*60))').length).toBe(8)
    // 128 seconds of ticks reads as a NEGATIVE byte, so the tens loop is
    // skipped entirely and the units character is counted up 128 times
    expect(p('Ct Time$(Wordswap(0)+128*50)')).toBe(`00:00:0${String.fromCharCode(0x30 + 128)}`)
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

describe('slice 4: banks', () => {
  const setup = ['Reserve As Work 5,64', 'Loke Start(5),$12345678']

  it('Bank Name sets an eight-character id, and Bank Name$ reads it back', () => {
    // "the AMOS Tracker commands require a bank named 'Tracker '"
    const { out } = run([...setup, 'Bank Name 5,"Tracker"', 'Print "["+Bank Name$(5)+"]"'])
    expect(out.trim()).toBe('[Tracker ]')
  })

  it('Bank Permanent and Bank Temporary flip the Data/Work flag', () => {
    const { rt } = run([...setup, 'Bank Permanent 5'])
    expect(rt.memBanks.get(5)!.flags & 1).toBe(1)
    const b = run([...setup, 'Bank Permanent 5', 'Bank Temporary 5'])
    expect(b.rt.memBanks.get(5)!.flags & 1).toBe(0)
  })

  it('Bank To Chip and Bank To Fast move the bank between the pools', () => {
    expect(run([...setup, 'Bank To Chip 5']).rt.memBanks.get(5)!.memType).toBe(1)
    expect(run([...setup, 'Bank To Chip 5', 'Bank To Fast 5']).rt.memBanks.get(5)!.memType).toBe(0)
  })

  it('Bank Stretch resizes and keeps what was there', () => {
    const { rt } = run([...setup, 'Bank Stretch 5 To 256'])
    const b = rt.memBanks.get(5)!
    expect(b.data.length).toBe(256)
    expect(b.data[0]).toBe(0x12) // the Loke survived the realloc
    expect(b.data[3]).toBe(0x78)
  })

  it('Bank Copy duplicates a whole bank', () => {
    const { rt } = run([...setup, 'Reserve As Work 6,64', 'Bank Copy 5 To 6'])
    expect([...rt.memBanks.get(6)!.data.subarray(0, 4)]).toEqual([0x12, 0x34, 0x56, 0x78])
  })

  it('Bank Copy inherits the source bank name and its Data bit, and refuses a self-copy', () => {
    // routine 56 reads the source header: `move.w -$c(a0),d1` for the Reserve
    // flags and `subq.l #$8,a0` for the name, so the copy is the original's
    // twin rather than a bank called "Amcaf   "
    const work = run([...setup, 'Bank Name 5,"Tracker"', 'Bank Copy 5 To 6']).rt.memBanks.get(6)!
    expect(work.name).toBe('Tracker ')
    expect(work.kind === 'memory' && work.flags).toBe(0)
    const data = run(['Reserve As Data 5,64', 'Bank Copy 5 To 6']).rt.memBanks.get(6)!
    expect(data.kind === 'memory' && data.flags).toBe(1)
    // `move.l -$10(a0),d1 / cmp.l d1,d7 / Rbeq routine 157` -- error 23
    expect(() => run([...setup, 'Bank Copy 5 To 5'])).toThrow(/Illegal function call/)
  })

  it('every AMCAF Reserve asks for the bank type its `moveq #$n,d1` names', () => {
    // Eighteen call sites of routine 1103 in the 1.50 hunk were re-read for
    // this. d1 is the Reserve flags -- bit 0 Data, bit 1 Chip, pinned by
    // Dload's `moveq #$1,d1` against Wload's `moveq #$0,d1` -- and four
    // engine banks were being made Data against a `moveq #$0,d1`. It is not
    // cosmetic: Bnk_BitData (+Equ.s:1865) is what makes a bank survive
    // Erase Temp, so these used to outlive it and on the machine do not.
    const { rt } = run([
      'Screen Open 0,64,64,4,Lowres',
      'Make Pix Mask 0,0,0 To 8,8,5', // routine 225, `moveq #$0,d1` at $51f4
      'Coords Bank 6,4', //              routine  94, $33f0
      'Splinters Bank 7,4', //           routine 288, $6986
      'Td Stars Bank 8,4', //            routine 304, $6d8e
      'Alloc Trans Map 9,32,1', //       routine 148, $4174 -- already right
    ])
    const want: [number, string][] = [
      [5, 'Pix Mask'],
      [6, 'Coords  '],
      [7, 'Splinter'],
      [8, 'Stars   '],
      [9, 'TransMap'],
    ]
    for (const [n, name] of want) {
      const b = rt.memBanks.get(n)!
      expect(b.name).toBe(name)
      expect(b.kind === 'memory' && b.flags).toBe(0)
    }
    // Erase Temp is the observable consequence
    const after = run(['Splinters Bank 7,4', 'Erase Temp'])
    expect(after.rt.memBanks.get(7)).toBeUndefined()
  })

  it('Bank Copy over an existing bank Reserves rather than keeping its identity', () => {
    // the target used to keep the name and flags it had, which routine 56
    // never does -- there is one unconditional `Rjsr routine 1103` in it
    const { rt } = run([...setup, 'Reserve As Data 6,8', 'Bank Name 6,"Old"', 'Bank Copy 5 To 6'])
    const b = rt.memBanks.get(6)!
    expect(b.name).toBe('Work') // bank 5's, which Reserve As Work left unpadded
    expect(b.kind === 'memory' && b.flags).toBe(0)
    expect(b.data.length).toBe(64)
  })

  it('Bank Delta Encode and Decode are inverses, and do not change the length', () => {
    // "Delta encoding just stores the difference from one byte to the next"
    const { rt } = run([...setup, 'Bank Delta Encode 5'])
    const enc = rt.memBanks.get(5)!.data
    expect(enc.length).toBe(64)
    expect(enc[0]).toBe(0x12) // first byte is the difference from zero
    expect(enc[1]).toBe((0x34 - 0x12) & 0xff)
    const back = run([...setup, 'Bank Delta Encode 5', 'Bank Delta Decode 5'])
    expect([...back.rt.memBanks.get(5)!.data.subarray(0, 4)]).toEqual([0x12, 0x34, 0x56, 0x78])
  })

  it('Bank Checksum is a longword sum XORed with $FACEFACE ($2782)', () => {
    const { out } = run([...setup, 'Print Bank Checksum(5)'])
    // 64 bytes: one $12345678 longword and fifteen zeros
    expect(out.trim()).toBe(String((0x12345678 ^ 0xfaceface) | 0))
  })

  it('Bank Code Xor decodes with the same code, Add with the negative', () => {
    const xor = run([...setup, 'Bank Code Xor.b $AA,5', 'Bank Code Xor.b $AA,5'])
    expect([...xor.rt.memBanks.get(5)!.data.subarray(0, 4)]).toEqual([0x12, 0x34, 0x56, 0x78])
    const add = run([...setup, 'Bank Code Add.b 7,5', 'Bank Code Add.b -7,5'])
    expect([...add.rt.memBanks.get(5)!.data.subarray(0, 4)]).toEqual([0x12, 0x34, 0x56, 0x78])
    // and Add really did change it in between
    const once = run([...setup, 'Bank Code Add.b 7,5'])
    expect(once.rt.memBanks.get(5)!.data[0]).toBe(0x19)
  })

  it('Bank Code Rol and Ror undo each other', () => {
    const r = run([...setup, 'Bank Code Rol.b 3,5', 'Bank Code Ror.b 3,5'])
    expect([...r.rt.memBanks.get(5)!.data.subarray(0, 4)]).toEqual([0x12, 0x34, 0x56, 0x78])
    const rol = run([...setup, 'Bank Code Rol.b 4,5'])
    expect(rol.rt.memBanks.get(5)!.data[0]).toBe(0x21) // $12 rotated by a nibble
  })

  it('Bank Code Mix is a walking key, so the same code decodes it ($25d2)', () => {
    // d1 = code XOR $AA, then the key ADVANCES by d1 per element -- which is
    // why two identical bytes do not encode to the same thing
    const { rt } = run([...setup, 'Bank Code Mix.b 1,5'])
    const d = rt.memBanks.get(5)!.data
    expect(d[4]).not.toBe(d[5]) // both were zero before
    const back = run([...setup, 'Bank Code Mix.b 1,5', 'Bank Code Mix.b 1,5'])
    expect([...back.rt.memBanks.get(5)!.data.subarray(0, 4)]).toEqual([0x12, 0x34, 0x56, 0x78])
  })

  it('the word forms use $FACE where the byte forms use $AA', () => {
    // only the binary says this -- $AAAA would have been the obvious guess
    const w = run([...setup, 'Bank Code Mix.w 1,5', 'Bank Code Mix.w 1,5'])
    expect([...w.rt.memBanks.get(5)!.data.subarray(0, 4)]).toEqual([0x12, 0x34, 0x56, 0x78])
    const one = run([...setup, 'Bank Code Mix.w 0,5'])
    // key starts at 0 and advances by (0 XOR $FACE) = $FACE
    expect((one.rt.memBanks.get(5)!.data[0]! << 8) | one.rt.memBanks.get(5)!.data[1]!).toBe(0x1234 ^ 0xface)
  })

  /**
   * Routines 44/46/50/52 ($25a8, $25dc, $2648, $2680) are six-byte trampolines
   * — `Rbsr 353` to resolve the bank, then `Rbra` into workers 43/45/49/51 —
   * and each worker is the same shape as its `.b` sibling with the length
   * taken in WORDS (`lsr.l #1`) and a `.w` operation:
   *
   *     43  eor.w d0,(a0)+          45  add.w d0,(a0)+
   *     49  move.w (a0),d1 / rol.w d0,d1 / move.w d1,(a0)+
   *     51  ... ror.w d0,d1 ...
   *
   * All four were classified FAITHFUL with nothing dispatching them.
   */
  it('the .w encoders work a word at a time ($2584, $25b8, $2620, $2658)', () => {
    const first = (r: ReturnType<typeof run>): number => {
      const d = r.rt.memBanks.get(5)!.data
      return (d[0]! << 8) | d[1]!
    }
    expect(first(run([...setup, 'Bank Code Xor.w $FFFF,5']))).toBe(0x1234 ^ 0xffff)
    expect(first(run([...setup, 'Bank Code Add.w 1,5']))).toBe(0x1235)
    // a word rotate, not two byte rotates: $1234 by 4 is $2341, not $2143
    expect(first(run([...setup, 'Bank Code Rol.w 4,5']))).toBe(0x2341)
    expect(first(run([...setup, 'Bank Code Ror.w 4,5']))).toBe(0x4123)
    // each is undone by its partner, which is what the manual promises
    for (const [enc, dec] of [
      ['Bank Code Xor.w 999,5', 'Bank Code Xor.w 999,5'],
      ['Bank Code Add.w 999,5', 'Bank Code Add.w -999,5'],
      ['Bank Code Rol.w 7,5', 'Bank Code Ror.w 7,5'],
      ['Bank Code Ror.w 7,5', 'Bank Code Rol.w 7,5'],
    ]) {
      const r = run([...setup, enc!, dec!])
      expect([...r.rt.memBanks.get(5)!.data.subarray(0, 4)], enc).toEqual([0x12, 0x34, 0x56, 0x78])
    }
  })

  /**
   * `rol.w Dx,Dy` takes its count as `Dx mod 64`, and rotating sixteen bits by
   * k is k mod 16 — so a negative code rotates the other way, which is what
   * "use the negative code with the same instruction" rests on. -1 is 63 in
   * the low six bits, and 63 mod 16 is 15, one short of a full turn.
   */
  it('a negative rotate count is the other direction', () => {
    const first = (r: ReturnType<typeof run>): number => {
      const d = r.rt.memBanks.get(5)!.data
      return (d[0]! << 8) | d[1]!
    }
    expect(first(run([...setup, 'Bank Code Rol.w -1,5']))).toBe(first(run([...setup, 'Bank Code Rol.w 15,5'])))
    expect(first(run([...setup, 'Bank Code Rol.w 16,5']))).toBe(0x1234) // a full turn is identity
  })
})

describe('slice 5: disk and DOS objects', () => {
  const p = (expr: string): string => run([`Print ${expr}`]).out.trim()

  /** a Runtime with one writable volume, which the file keywords need */
  function runFs(src: string[]): { out: string; rt: Runtime } {
    const fs = new AmigaFS()
    fs.mountMemory('Work')
    fs.currentDir = 'Work:'
    let out = ''
    const rt = new Runtime(tokenize(src.join('\n'), table, extensions), table, {
      maxSteps: 1_000_000,
      extensions,
      fs,
      onText: (t) => (out += t),
    })
    const r = rt.runHeadless(200)
    if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
    return { out, rt }
  }

  it('Object Protection$ formats the byte as hsparwed', () => {
    // "converts this numeric value into a string in the format 'hsparwed'"
    expect(p('Object Protection$(0)')).toBe('----rwed') // nothing denied
    expect(p('Object Protection$($FF)')).toBe('hspa----') // everything denied
    expect(p('Object Protection$(4)')).toBe('----r-ed') // bit 2 denies write
    expect(p('Object Protection$($80)')).toBe('h---rwed')
  })

  it('Filename$ and Path$ split a mixed path, per the manual examples', () => {
    expect(p('Filename$("DH2:AMOS/AMOSPro")')).toBe('AMOSPro')
    expect(p('Path$("DH2:AMOS/AMOSPro")')).toBe('DH2:AMOS')
    expect(p('Filename$("DF0:Game")')).toBe('Game')
    expect(p('Path$("DF0:Game")')).toBe('DF0:')
    expect(p('Filename$("bare")')).toBe('bare')
  })

  it('Pattern Match turns * into #? and answers -1 or 0', () => {
    // "a asterik (*) will be converted into '#?' automatically"
    expect(p('Pattern Match("hello.iff","*.iff")')).toBe('-1')
    expect(p('Pattern Match("hello.abk","*.iff")')).toBe('0')
    expect(p('Pattern Match("hello","#?")')).toBe('-1')
  })

  /**
   * Routine 102 calls `jsr -$3c6(a6)` and `-$3cc(a6)` — ParsePatternNoCase and
   * MatchPatternNoCase, not the plain pair. So AMCAF's matcher folds case
   * where LDos's, on the same code here, does not; LDos's manual is explicit
   * that it does not ("use Upper$ or Lower$ if required").
   */
  it('Pattern Match is case-insensitive, and an empty pattern is #?', () => {
    expect(p('Pattern Match("HELLO.IFF","*.iff")')).toBe('-1')
    expect(p('Pattern Match("hello.iff","*.IFF")')).toBe('-1')
    expect(p('Pattern Match("MiXeD","mixed")')).toBe('-1')
    // the range in a class is folded with everything else, so [a-z] takes
    // uppercase letters too
    expect(p('Pattern Match("Q","[a-z]")')).toBe('-1')
    // `move.w (a0)+,d0 / bne` falls through to `move.w #$233f,(a1)+`, which is
    // the two characters '#' and '?' -- so an empty pattern matches anything
    expect(p('Pattern Match("anything","")')).toBe('-1')
    expect(p('Pattern Match("","")')).toBe('-1')
  })

  /*
   * Routine 100 ($3694) walks the real DosList -- DOSBase, dl_Root, rn_Info,
   * di_DevInfo, each a BPTR -- and returns dol_Type off the matching entry, so
   * a device, an assign and a volume are three genuinely different answers.
   * Running off the end of the list is routine 391, and a string with no colon
   * in it runs off the end of the string into routine 390.
   */
  it('Disk Type answers off the device list, and errors when a name is not on it', () => {
    expect(runFs(['Print Disk Type("DF0:")']).out.trim()).toBe('0')
    expect(runFs(['Print Disk Type("Work:")']).out.trim()).toBe('2')
    expect(runFs(['Assign "Data:" To "Work:"', 'Print Disk Type("Data:")']).out.trim()).toBe('1')
    // everything after the colon is cut, so a path answers for its device
    expect(runFs(['Print Disk Type("Work:some/file")']).out.trim()).toBe('2')
    expect(() => runFs(['Print Disk Type("Nowhere:")'])).toThrow(/File format not recognised/)
    expect(() => runFs(['Print Disk Type("Work")'])).toThrow(/Illegal function call/)
  })

  it('Disk State errors on a name that does not resolve, not -1', () => {
    // -1 is reserved for a drive with no disk in it: `move.l $18(a2),d0`
    // against `moveq #$ff,d1` is id_DiskType against ID_NO_DISK_PRESENT. A
    // failed Lock is routine 391 and a failed Info routine 392
    expect(runFs(['Print Disk State("Work:")']).out.trim()).toBe('0')
    expect(() => runFs(['Print Disk State("Nowhere:")'])).toThrow(/File format not recognised/)
    expect(() => runFs(['Print Disk State("Work")'])).toThrow(/Illegal function call/)
  })

  it('Io Error$ gives the extension its OWN texts, and empty for an unused number', () => {
    // twenty-six of them, at $a56a, ending exactly where routine 384 begins
    expect(p('Io Error$(205)')).toBe('object not found')
    expect(p('Io Error$(214)')).toBe('disk is write-protected')
    expect(p('Io Error$(218)')).toBe('device (or volume) is not mounted')
    expect(p('Io Error$(232)')).toBe('no more entries in directory')
    expect(p('"["+Io Error$(9999)+"]"')).toBe('[]')
    // 206 is a real dos.library code the extension's table simply omits
    expect(p('"["+Io Error$(206)+"]"')).toBe('[]')
  })

  it('Dos Hash lands every name in a 0..71 bucket', () => {
    for (const n of ['a', 'thrusts.info', 'AMOSPro', 'x'.repeat(30)]) {
      const h = Number(p(`Dos Hash("${n}")`))
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(72)
    }
  })

  /**
   * Routine 99 ($365a) raises a lowercase letter before folding it in:
   *
   *   cmp.b #$61,d2 / bcs / cmp.b #$7a,d2 / bhi / subi.b #$20,d2
   *
   * which an earlier pass left out, so the port hashed by case. AmigaDOS
   * directory lookup is case-insensitive and depends on this, so a program
   * walking real hash chains was being sent to the wrong bucket.
   */
  it('Dos Hash folds case, and only ASCII a..z', () => {
    expect(p('Dos Hash("AMOSPro")')).toBe(p('Dos Hash("amospro")'))
    expect(p('Dos Hash("MixedCase.iff")')).toBe(p('Dos Hash("MIXEDCASE.IFF")'))
    // the seed is the length, so an empty name is bucket zero
    expect(p('Dos Hash("")')).toBe('0')
    // only a..z is raised: an accented byte keeps its own value, so two names
    // AmigaDOS would call the same can still land apart
    expect(p('Dos Hash(Chr$(228))')).not.toBe(p('Dos Hash(Chr$(196))'))
  })

  /**
   * Both splitters are one left-to-right scan recording the last ':' or '/'
   * (routines 96 and 97), so a separator of EITHER kind wins if it comes
   * last. The port checked for a slash first, which gets "DH2:a/b:c" wrong.
   */
  it('Path$ cuts at the last separator of either kind', () => {
    expect(p('Path$("DH2:a/b:c")')).toBe('DH2:a/b:')
    expect(p('Filename$("DH2:a/b:c")')).toBe('c')
    // the asymmetry that makes a device name work: a colon is kept, a slash
    // dropped (`move.w d3,d2` against `move.w d3,d2 / subq.w #$1,d2`)
    expect(p('Path$("DF0:Game")')).toBe('DF0:')
    expect(p('Path$("a/b")')).toBe('a')
    expect(p('"["+Path$("bare")+"]"')).toBe('[]')
  })

  it('Examine Dir then Examine Next$ walks a drawer and closes at the end', () => {
    const { out } = runFs([
      'Dir$="Work:"',
      'Open Out 1,"Work:one.txt" : Print #1,"x" : Close 1',
      'Examine Dir "Work:"',
      'A$=Examine Next$',
      'Print A$',
      'B$=Examine Next$',
      'Print "["+B$+"]"',
    ])
    const lines = out.trim().split('\n')
    expect(lines[0]).toBe('one.txt')
    // "If the end of the directory list is reached, file$ will contain an
    // empty string and the drawer will be closed"
    expect(lines[1]).toBe('[]')
  })

  /**
   * The three failure paths, which are three distinct AMOS error numbers
   * rather than the one generic the port used to raise. Routines 390, 391 and
   * 392 are each `Rbsr 354 / moveq #n,d0 / Rjmp L_ScCopy`, and d0 is the AMOS
   * error number: $17 = 23, $51 = 81, $5e = 94. The texts are AMOS's own and
   * have nothing to do with what failed — the extension ships no message
   * table — but they are what a program's `Errn` reports.
   */
  it('a failed dos.library call is error 81, not the generic 23', () => {
    expect(() => runFs(['Examine Object "Work:nosuch.txt"'])).toThrow(/File format not recognised/)
    expect(() => runFs(['Examine Dir "Work:nosuchdir"'])).toThrow(/File format not recognised/)
    expect(() => runFs(['File Copy "Work:nosuch" To "Work:x"'])).toThrow(/File format not recognised/)
  })

  /**
   * `tst.l $4(a2) / bmi` at the end of Examine Dir (routine 109): a negative
   * fib_DirEntryType is a FILE, and the routine unlocks and fails rather than
   * treating it as a drawer with nothing in it.
   */
  it('Examine Dir handed a file locks it, examines it, then fails as error 94', () => {
    expect(() =>
      runFs(['Open Out 1,"Work:plain.txt" : Print #1,"x" : Close 1', 'Examine Dir "Work:plain.txt"']),
    ).toThrow(/Next without For/)
  })

  /**
   * Routine 363, the path converter every path argument goes through:
   *
   *   move.w (a0)+, d0 / subq.w #$1, d0 / cmp.w #$80, d0 / Rbcc routine 390
   *
   * `Rbcc` is unsigned, so a length of zero underflows to $FFFF and fails the
   * same test 129 fails. 1..128 characters, and an empty path is error 23
   * rather than a lookup that comes back empty-handed.
   */
  it('a path is 1..128 characters, and an empty one is error 23', () => {
    expect(() => runFs(['Examine Object ""'])).toThrow(/Illegal function call/)
    expect(() => runFs([`Examine Object "Work:${'x'.repeat(130)}"`])).toThrow(/Illegal function call/)
    // Filename$ and Path$ do NOT go through it -- they scan the AMOS string
    // in place -- so an empty argument is an empty answer
    expect(p('"["+Filename$("")+"]"')).toBe('[]')
  })

  /** Examine Next$ with no walk open is error 23 (`Rbeq routine 390`) */
  it('Examine Next$ without a directory open is an error, not an empty string', () => {
    expect(() => runFs(['A$=Examine Next$'])).toThrow(/Illegal function call/)
  })

  /**
   * The DateStamp trio, each against its routine.
   *
   * Object Date (120, $3c5c) hands back a whole longword from $184 — the day
   * count. Object Time (122, $3c80) reads TWO WORDS four bytes apart:
   *
   *     lea.l  $18a(a2), a0
   *     move.w (a0), d3 / swap d3 / move.w $4(a0), d3
   *
   * which is the low word of the DateStamp's minutes above the low word of
   * its ticks — the same `Wordswap(minutes)+ticks` packing Current Time uses,
   * confirmed here from the other end.
   *
   * Examine Stop (109, $3b4e) has no prologue at all and is idempotent: it
   * tests the stored lock at $37c, calls dos.library -$5a (UnLock) only if it
   * is non-zero, then clears it.
   */
  it('Object Date and Object Time are a split DateStamp, and Examine Stop is idempotent', () => {
    const { out } = runFs([
      'Open Out 1,"Work:d.txt" : Print #1,"x" : Close 1',
      'Examine Object "Work:d.txt"',
      'Print Object Date',
      'T=Object Time',
      // the packing: minutes in the HIGH word, ticks in the low
      'Print T/65536;",";T mod 65536',
    ])
    const lines = out.trim().split('\n')
    expect(Number(lines[0])).toBeGreaterThanOrEqual(0)
    const [mins, ticks] = lines[1]!.split(',').map((s) => Number(s.trim()))
    expect(mins).toBeGreaterThanOrEqual(0)
    expect(mins).toBeLessThan(1440) // minutes in a day
    expect(ticks).toBeLessThan(3000) // fiftieths in a minute

    // Set Object Date (130, $3d8c) writes the pair back
    const set = runFs([
      'Open Out 1,"Work:e.txt" : Print #1,"x" : Close 1',
      // "Set Object Date pathfile$,date,time" — the time arrives PACKED, and
      // routine 130 splits it back with `move.w d0,$38a / swap d0 / move.w
      // d0,$386`: ticks low, minutes high
      'Set Object Date "Work:e.txt",1000,60*65536+25',
      'Examine Object "Work:e.txt"',
      'Print Object Date;",";Object Time',
    ])
    expect(set.out.trim().replace(/\s+/g, '')).toBe(`1000,${60 * 65536 + 25}`)

    // Examine Stop with nothing open takes the `beq` past the UnLock
    expect(() => runFs(['Examine Stop'])).not.toThrow()
    expect(() => runFs(['Examine Dir "Work:"', 'Examine Stop', 'Examine Stop'])).not.toThrow()
  })

  /**
   * The host-boundary group, each against the dos.library offset its routine
   * calls: Io Error (160, $4762) is `jsr -$84(a6)` — IoErr; Write Cli (202,
   * $50f2) is `jsr -$3c(a6)` — Output — then a write to that handle; Disk
   * State (101, $37d2) scans the name to its ':' and takes a shared Lock via
   * `moveq #$fe,d2 / jsr -$54(a6)`; Tool Types$ (328, $78ca) opens a library
   * through ExecBase (`jsr -$228(a6)`) before reading the icon.
   */
  it('the host-boundary keywords dispatch and answer in range', () => {
    const { out } = runFs([
      'Open Out 1,"Work:f.txt" : Print #1,"x" : Close 1',
      'Print "io=";Io Error',
      'Write Cli "hello"',
      'Print "ds=";Disk State("Work:")',
      'Print "tt=["+Tool Types$("Work:f.txt","X")+"]"',
    ])
    const field = (k: string): string => {
      const line = out.split('\n').find((l) => l.includes(`${k}=`))
      return (line ?? '').split(`${k}=`)[1]!.trim()
    }
    expect(Number(field('io'))).toBe(0) // nothing has failed yet
    expect(out).toContain('hello') // Write Cli reached the CLI handle
    expect(Number.isFinite(Number(field('ds')))).toBe(true)
    expect(field('tt')).toBe('[]') // no .info, so no tool types
  })

  /**
   * Dload/Dsave (the raw block pair) and the PowerPacker pair. Ppunpack
   * decrunches in place through ../amiga/powerpacker.ts; Ppfromdisk loads and
   * decrunches in one step, taking a file that is not PowerPacked as it is.
   */
  /**
   * DEFECT: Rnc Unpack and =Rnp do nothing, and are reproduced that way.
   *
   * The author removed them twice — "V0.990 Removed some command to shrink
   * the extension: Rnc Unpack / =Rnp", reinstated at V1.00, then "V1.31
   * Finally removed Rnc Unpack and =Rnp". The tokens had to stay, because
   * deleting one shifts every later token id, so 1.40 and 1.50 both list them
   * and neither does anything:
   *
   *     rnc unpack ($63c0, 6 bytes)  move.l (a3)+,d5 / move.l (a3)+,d0 / rts
   *     rnp        ($63c6, 2 bytes)  rts
   *
   * Wiring a real RNC decompressor in — the obvious reading of the manual,
   * which still documents both — would be LESS faithful. A sweep of the whole
   * corpus for the RNC signature found nothing packed either.
   */
  it('Rnc Unpack and Rnp are the dead stubs the binary says they are', () => {
    const { rt } = runFs([
      'Reserve As Work 7,64',
      'Poke Start(7),$AB',
      'Rnc Unpack Start(7) To Start(7)+32',
      'Print Rnp',
    ])
    // it consumed its arguments and touched nothing
    expect(rt.memBanks.get(7)!.data[0]).toBe(0xab)
    expect(rt.memBanks.get(7)!.data[32]).toBe(0)
  })

  /**
   * Routines 104 and 103 differ in two constants: the Reserve type (0 or 1)
   * and an eight-character bank name that is a literal in the binary,
   * "Work    " for Wload and "Datas   " for Dload. The port had invented
   * "Amcaf   ", which was never on a real bank and which a program reading
   * Bank$ or saving the bank back out would see.
   */
  it('Wload and Dload name their banks Work and Datas, and a negative bank is chip', () => {
    const { rt } = runFs([
      'Open Out 1,"Work:b.bin" : Print #1,"xyz" : Close 1',
      'Wload "Work:b.bin",5',
      'Dload "Work:b.bin",6',
      // "If 'bank' is a negative number, the file is loaded into Chip ram
      // instead" -- `neg.w d0 / addq.w #$2,d1` on the Reserve type
      'Wload "Work:b.bin",-7',
    ])
    const b5 = rt.memBanks.get(5)!
    const b6 = rt.memBanks.get(6)!
    const b7 = rt.memBanks.get(7)!
    expect(b5.name).toBe('Work    ')
    expect(b6.name).toBe('Datas   ')
    // and the type each Reserve asks for: Work banks clear the Data bit
    expect(b5.kind === 'memory' && b5.flags).toBe(0)
    expect(b6.kind === 'memory' && b6.flags).toBe(1)
    // the negative form landed on bank 7, in chip
    expect(b7.name).toBe('Work    ')
    expect(b7.kind === 'memory' && b7.memType).toBe(1)
    expect(b5.kind === 'memory' && b5.memType).toBe(0)
  })

  it('Dload, Dsave and the PowerPacker pair round-trip a bank', () => {
    const { rt } = runFs([
      'Reserve As Work 7,64',
      'Poke Start(7),$AB : Poke Start(7)+1,$CD',
      'Dsave "Work:raw.bin",7',
      'Dload "Work:raw.bin",8',
      'Ppfromdisk "Work:raw.bin",9',
    ])
    expect([...rt.memBanks.get(8)!.data.subarray(0, 2)]).toEqual([0xab, 0xcd])
    // a file that is not PP20 comes through unchanged
    expect([...rt.memBanks.get(9)!.data.subarray(0, 2)]).toEqual([0xab, 0xcd])
    // and Ppfromdisk's own Reserve is `moveq #$0,d1 / lea "Work    ",a0` at
    // $5b38/$5b44, the same pair Ppunpack uses -- not a bank called "Amcaf   "
    const b9 = rt.memBanks.get(9)!
    expect(b9.name).toBe('Work    ')
    expect(b9.kind === 'memory' && b9.flags).toBe(0)
  })

  it('Ppfromdisk takes a negative bank number as the same bank in chip', () => {
    // `move.l (a3)+,d0 / bpl / neg.l d0 / moveq #$2,d1` at $5b3a
    const { rt } = runFs([
      'Reserve As Work 7,64',
      'Poke Start(7),$AB',
      'Dsave "Work:raw.bin",7',
      'Ppfromdisk "Work:raw.bin",-9',
    ])
    const b = rt.memBanks.get(9)!
    expect(b.kind === 'memory' && b.memType).toBe(1)
    expect(b.kind === 'memory' && b.flags).toBe(0)
  })

  /*
   * Routine 236 ($59ec) takes BANK NUMBERS, not addresses -- `Rjsr routine
   * 1121` resolves the source and `Rjsr routine 1103` RESERVES the
   * destination, with the name "Work    " sitting at $5a78 right after the
   * code. The size comes off PP20's last long, `move.l -$4(a0,d6.l),d2 /
   * lsr.l #$8,d2`. An earlier pass read both arguments as addresses and
   * decrunched in place.
   */
  it('Ppunpack decrunches one BANK into another it reserves itself', () => {
    const packed = pp20Crunch(new Uint8Array(64).fill(0x5a))
    const pokes = [...packed].map((b, i) => `Poke Start(7)+${i},${b}`)
    const { rt } = runFs([`Reserve As Work 7,${packed.length}`, ...pokes, 'Ppunpack 7 To 8'])
    const out = rt.memBanks.get(8)!.data
    expect(out.length).toBe(64)
    expect([...out.subarray(0, 4)]).toEqual([0x5a, 0x5a, 0x5a, 0x5a])
    // and a negative destination is the same chip-memory convention Wload uses
    const chip = runFs([`Reserve As Work 7,${packed.length}`, ...pokes, 'Ppunpack 7 To -8'])
    expect(chip.rt.memBanks.get(8)!.data.length).toBe(64)
  })

  it('Ppunpack has three requester messages and one AMOS error', () => {
    // the same bank twice is `cmp.l d0,d7 / Rbeq routine 390`
    expect(() => runFs(['Reserve As Work 7,64', 'Ppunpack 7 To 7'])).toThrow(/Illegal function call/)
    // anything that is not PP20 is message 8
    expect(() => runFs(['Reserve As Work 7,64', 'Ppunpack 7 To 8'])).toThrow(/Not a PowerPacker/)
    // and "PX20" is message 7, the encrypted variant
    const px = ['Poke Start(7),80', 'Poke Start(7)+1,88', 'Poke Start(7)+2,50', 'Poke Start(7)+3,48']
    expect(() => runFs(['Reserve As Work 7,64', ...px, 'Ppunpack 7 To 8'])).toThrow(/encrypted/)
  })

  it('the Object accessors read whatever Examine last described', () => {
    const { out } = runFs([
      'Open Out 1,"Work:two.txt" : Print #1,"hello" : Close 1',
      'Examine Object "Work:two.txt"',
      'Print Object Name$',
      'Print Object Type',
      'Print Object Size',
      'Print Object Blocks',
    ])
    const l = out.trim().split('\n').map((x) => x.trim())
    expect(l[0]).toBe('two.txt')
    expect(l[1]).toBe('-3') // negative for a file
    expect(Number(l[2])).toBeGreaterThan(0)
    expect(l[3]).toBe('1') // under one 512-byte block
  })

  /**
   * The accessors take NO argument — routines 114 to 129 are 12 to 20 byte
   * reads of the FileInfoBlock at $100 of the extension's block, and the token
   * table gives every one a spec of `"0"` or `"2"`. So the round-trip has to
   * go through Examine Object (routine 112, spec `I2`), which is what fills
   * the block in the first place.
   */
  it('Protect Object and Set Object Comment round-trip through the metadata', () => {
    const { out } = runFs([
      'Open Out 1,"Work:three.txt" : Print #1,"x" : Close 1',
      'Protect Object "Work:three.txt",$85',
      'Set Object Comment "Work:three.txt","a note"',
      'Examine Object "Work:three.txt"',
      'Print Object Protection',
      'Print Object Comment$',
      'Print Object Protection$(Object Protection)',
    ])
    const l = out.trim().split('\n').map((x) => x.trim())
    expect(l[0]).toBe(String(0x85))
    expect(l[1]).toBe('a note')
    // $85 is hidden, plus write and delete DENIED by the inverted low nibble
    expect(l[2]).toBe('h---r-e-')
  })

  /**
   * The block is a SNAPSHOT, which is the whole consequence of the accessors
   * being field reads: not one of routines 114 to 129 contains a library call,
   * so nothing re-reads the filesystem between an Examine and an accessor.
   * A change made after the Examine is invisible until the next Examine.
   */
  it('the Object accessors answer from the block, not the live filesystem', () => {
    const { out } = runFs([
      'Open Out 1,"Work:snap.txt" : Print #1,"x" : Close 1',
      'Protect Object "Work:snap.txt",$80',
      'Examine Object "Work:snap.txt"',
      'Protect Object "Work:snap.txt",$85',
      'Print Object Protection', // still what the Examine captured
      'Examine Object "Work:snap.txt"',
      'Print Object Protection', // now the new value
    ])
    const l = out.trim().split('\n').map((x) => x.trim())
    expect(l[0]).toBe(String(0x80))
    expect(l[1]).toBe(String(0x85))
  })

  /**
   * Before any Examine the block is still zero, and the routines read it
   * regardless — "they answer for whatever the block holds, including before
   * any Examine at all". Nothing checks, so nothing errors.
   */
  it('the Object accessors read the empty block before any Examine', () => {
    const { out } = runFs(['Print Object Size', 'Print Object Type', 'Print Len(Object Name$)'])
    const l = out.trim().split('\n').map((x) => x.trim())
    expect(l[0]).toBe('0')
    expect(l[1]).toBe('0')
    expect(l[2]).toBe('0')
  })

  it('Wload and Wsave move a whole file through a bank', () => {
    const { rt } = runFs([
      'Open Out 1,"Work:four.bin" : Print #1,"ABCD" : Close 1',
      'Wload "Work:four.bin",7',
      'Wsave "Work:copy.bin",7',
    ])
    expect(rt.memBanks.get(7)!.data.length).toBeGreaterThan(0)
    expect(rt.vfs!.readFile('Work:copy.bin')).not.toBe(null)
  })

  it('File Copy duplicates a file', () => {
    const { rt } = runFs([
      'Open Out 1,"Work:five.bin" : Print #1,"ZZZ" : Close 1',
      'File Copy "Work:five.bin" To "Work:six.bin"',
    ])
    const a = rt.vfs!.readFile('Work:five.bin')
    const b = rt.vfs!.readFile('Work:six.bin')
    expect(b).not.toBe(null)
    expect([...b!]).toEqual([...a!])
  })
})

describe('slice 6: colour and palette', () => {
  const p = (expr: string): string => run([`Print ${expr}`]).out.trim()
  const scr = ['Screen Open 0,320,200,16,Lowres']

  it('the Val functions and Glue Colour are inverses', () => {
    expect(p('Red Val($1A5)')).toBe('1')
    expect(p('Green Val($1A5)')).toBe('10')
    expect(p('Blue Val($1A5)')).toBe('5')
    expect(p('Glue Colour(1,10,5)')).toBe(String(0x1a5))
  })

  it('Rgb To Rrggbb zero-fills the missing bits, and back discards them', () => {
    // "The missing bits are set to zeros" -- so $FFF is $F0F0F0, not $FFFFFF
    expect(p('Rgb To Rrggbb($FFF)')).toBe(String(0xf0f0f0))
    expect(p('Rgb To Rrggbb($123)')).toBe(String(0x102030))
    expect(p('Rrggbb To Rgb($F0F0F0)')).toBe(String(0xfff))
    expect(p('Rrggbb To Rgb(Rgb To Rrggbb($8AC))')).toBe(String(0x8ac))
  })

  it('Mix Colour averages, and its three-argument form clamps', () => {
    expect(p('Mix Colour($000,$FFF)')).toBe(String(0x777))
    expect(p('Mix Colour($888,$888)')).toBe(String(0x888))
    // "added ... if positive or subtracted, if the value is negative",
    // bounded by lrgb and urgb
    expect(p('Mix Colour($888,$111,$000 To $FFF)')).toBe(String(0x999))
    expect(p('Mix Colour($EEE,$333,$000 To $FFF)')).toBe(String(0xfff))
  })

  it('Pal Get Screen stores a palette and Pal Set Screen puts it back', () => {
    const { out } = run([
      ...scr,
      'Colour 1,$F00',
      'Pal Get Screen 3,0',
      'Colour 1,$00F',
      'Print Colour(1)',
      'Pal Set Screen 3,0',
      'Print Colour(1)',
      'Print Pal Get(3,1)',
    ])
    const l = out.trim().split('\n').map((x) => x.trim())
    expect(l[0]).toBe(String(0x00f))
    expect(l[1]).toBe(String(0xf00))
    expect(l[2]).toBe(String(0xf00))
  })

  it('Pal Set writes one buffer entry, and the buffer number is bounded 0..7', () => {
    expect(run([...scr, 'Pal Set 7,5,$ABC', 'Print Pal Get(7,5)']).out.trim()).toBe(String(0xabc))
    expect(() => run([...scr, 'Pal Set 8,0,$FFF'])).toThrow(/Illegal function call/)
  })

  it('Pal Spread blends between two colours across a range', () => {
    const { out } = run([
      ...scr,
      'Pal Spread 0,$000 To 4,$888',
      'Print Colour(0);Colour(2);Colour(4)',
    ])
    const l = out.trim()
    expect(l).toContain('0') // the low end stays black
    expect(run([...scr, 'Pal Spread 0,$000 To 4,$888', 'Print Colour(4)']).out.trim()).toBe(String(0x888))
    expect(run([...scr, 'Pal Spread 0,$000 To 4,$888', 'Print Colour(2)']).out.trim()).toBe(String(0x444))
  })

  /**
   * Routine 334 ($736a), three things the manual does not mention.
   *
   * `cmp.w d6,d7 / bgt` with an `exg` pair behind it SWAPS the two ends when
   * they arrive the wrong way round, so a descending spread is the same blend
   * as the ascending one. The port used to refuse it.
   *
   * Each gun is worked at double scale and halved with the carry added back
   * (`lsr.w #$1,d1 / addx.w d2,d1`), so both halves round to nearest before
   * being summed, and the sum is then clamped to 15 — which matters, because
   * two separately rounded halves can add to 16.
   *
   * Both pen numbers are checked against 32, like every other palette keyword
   * in the slice.
   */
  it('Pal Spread swaps its ends, rounds each half, and clamps to 15', () => {
    // descending is the same blend as ascending
    const up = run([...scr, 'Pal Spread 0,$000 To 4,$888', 'Print Colour(1);Colour(2);Colour(3)']).out.trim()
    const down = run([...scr, 'Pal Spread 4,$888 To 0,$000', 'Print Colour(1);Colour(2);Colour(3)']).out.trim()
    expect(down).toBe(up)
    // a span of zero writes the single entry and returns -- and the swap test
    // is `bgt`, so EQUAL pens swap too and it is the SECOND colour that lands
    expect(run([...scr, 'Pal Spread 3,$ABC To 3,$000', 'Print Colour(3)']).out.trim()).toBe('0')
    expect(run([...scr, 'Pal Spread 3,$000 To 3,$ABC', 'Print Colour(3)']).out.trim()).toBe(String(0xabc))
    // both ends are bounded at 32
    expect(() => run([...scr, 'Pal Spread 0,$000 To 32,$FFF'])).toThrow()
    expect(() => run([...scr, 'Pal Spread -1,$000 To 4,$FFF'])).toThrow()
    // rounding is to NEAREST, not down: three steps from 0 to $FFF puts the
    // middle at 8 rather than 7
    expect(run([...scr, 'Pal Spread 0,$000 To 2,$FFF', 'Print Colour(1)']).out.trim()).toBe(String(0x888))
  })

  /**
   * Pal Get/Set take an index bounded by `cmp.w #$20` -- thirty-two, not the
   * 256 the port allowed -- and the address arithmetic agrees: `pal*64 +
   * index*2` into a 512-byte block, which is eight palettes of 32 WORDS.
   * Pal Get Screen and Pal Set Screen copy `moveq #$f,d7` longwords, which is
   * the same 32 colours.
   */
  it('the Pal buffers are 32 entries, not 256', () => {
    expect(() => run([...scr, 'Pal Set 0,32,$FFF'])).toThrow()
    expect(() => run([...scr, 'Print Pal Get(0,32)'])).toThrow()
    expect(run([...scr, 'Pal Set 0,31,$ABC', 'Print Pal Get(0,31)']).out.trim()).toBe(String(0xabc))
    // and the palette numbers are 0..7 either way
    expect(() => run([...scr, 'Pal Set 8,0,$FFF'])).toThrow()
  })

  /**
   * Routine 83 ($30aa). Three things the port was guessing before the routine
   * was read:
   *
   * The metric is a sixteen-byte LOOKUP TABLE at $3170 indexed by one gun's
   * absolute difference and summed over three — `0 1 3 5 8 12 16 20 30 40 50
   * 60 70 80 90 100` — not a squared distance. It is shallower than a square
   * below 4 and much steeper above 7.
   *
   * A TIE takes the LAST pen. The comparison is `cmp.w d0,d4 / blt`, which
   * computes best - candidate and skips only on a strictly negative result, so
   * an equal distance overwrites. AMOS's default 16-colour palette has $F00 at
   * both pen 1 and pen 4, and Best Pen($E00) answers 4 for that reason.
   *
   * An exact match returns immediately (`cmp.w d0,d5 / bne`), without
   * finishing the range, so it is the one case where the first wins.
   */
  it('Best Pen scores by the table at $3170, and a tie takes the last pen', () => {
    const pal = [...scr, 'Colour 1,$F00', 'Colour 2,$800', 'Colour 3,$00F']
    // pens 1 and 4 are both $F00, one gun out by one, so both score 1
    expect(run([...pal, 'Print Best Pen($E00)']).out.trim()).toBe('4')
    // an exact match short-circuits, so it beats a later tie
    expect(run([...pal, 'Print Best Pen($800)']).out.trim()).toBe('2')
    // restricted to 2..3 the near match is out of reach and $800 wins
    expect(run([...pal, 'Print Best Pen($E00,2 To 3)']).out.trim()).toBe('2')
    // the bounds are checked against 63 either way, and crossed bounds fail
    expect(() => run([...pal, 'Print Best Pen($E00,0 To 64)'])).toThrow()
    expect(() => run([...pal, 'Print Best Pen($E00,5 To 2)'])).toThrow()
  })

  /**
   * `cmp.w #$1f,d6 / bls` sends any pen above 31 to `move.w -$42(a0),d0 /
   * andi.w #$eee / lsr.w #$1` — the entry 32 lower, low bit of each gun
   * dropped and the rest halved. That is Extra Half-Brite, so a search over
   * the full 0..63 range weighs 32 colours that are not in the palette.
   */
  it('Best Pen treats pens 32-63 as Extra Half-Brite', () => {
    const pal = [...scr, 'Colour 1,$F00']
    // $700 is nothing in the palette, but it is half of pen 1's $F00, which
    // is what pen 33 displays
    expect(run([...pal, 'Print Best Pen($700,32 To 63)']).out.trim()).toBe('33')
  })

  it('Ham Colour decodes the HAM control byte against the previous pixel', () => {
    // bits 4-5: 01 replaces blue, 10 red, 11 green; 00 takes the palette entry
    expect(p('Ham Colour($1F,$000)')).toBe(String(0x00f)) // modify blue to 15
    expect(p('Ham Colour($2F,$000)')).toBe(String(0xf00)) // modify red
    expect(p('Ham Colour($3F,$000)')).toBe(String(0x0f0)) // modify green
    expect(p('Ham Colour($15,$FFF)')).toBe(String(0xff5)) // only blue changes
  })

  /**
   * Routine 161's last arm is an open `else`, not a fourth range, so a control
   * above 63 stays in the green branch instead of wrapping round to the
   * palette. `subi.w #$30,d0 / lsl.b #$4,d0` is a BYTE shift: 64 becomes $10
   * and shifts clean out of the byte, so the green nibble is 0 — where an
   * earlier pass masked with `& 63`, turning 64 into 0 and reading palette
   * entry 0 instead.
   */
  it('Ham Colour does not mask the control to 63', () => {
    expect(p('Ham Colour(64,$FFF)')).toBe(String(0xf0f)) // green cleared, not palette[0]
    expect(p('Ham Colour(65,$FFF)')).toBe(String(0xf1f)) // 65-48 = 17, low nibble 1
    expect(p('Ham Colour($3F,$FFF)')).toBe(String(0xfff)) // 63 is still green 15
  })

  it('Ham Best picks a byte that Ham Colour turns back into the target', () => {
    const { out } = run([...scr, 'C=Ham Best($0F0,$000)', 'Print Ham Colour(C,$000)'])
    expect(out.trim()).toBe(String(0x0f0))
  })

  // every palette entry far from anything the tests aim at, so only the one
  // entry each test sets is in contention
  const flat = [...scr, 'For I=0 To 15 : Colour I,$00F : Next I']

  /**
   * Routine 162 measures with Best Pen's weight table (`lea $458a(pc),a2`),
   * not a sum of squares. The two disagree here by one step in each
   * direction: the palette entry is 4 and 7 off in green and blue, weighing
   * 8+20 = 28, and the RED arm is 8 off in blue alone, weighing 30 — but
   * squared the palette entry costs 16+49 = 65 against the arm's 64.
   */
  it('Ham Best weighs candidates with the Best Pen table, not squares', () => {
    expect(run([...flat, 'Colour 1,$FC7', 'Print Ham Best($F80,$088)']).out.trim()).toBe('1')
  })

  /**
   * Ties go to whoever is measured LAST — `cmp.w d0,d5 / blt` skips only on a
   * strictly better incumbent — and the palette is measured before the three
   * arms. Palette entry 1 is 4 off in red, the RED arm 4 off in blue, so both
   * weigh 8 and the arm takes it: $20 + the wanted red nibble.
   */
  it('Ham Best gives a tie to the modify arm, not the palette', () => {
    expect(run([...flat, 'Colour 1,$370', 'Print Ham Best($770,$074)']).out.trim()).toBe(
      String(0x27),
    )
  })

  /**
   * `cmp.w d6,d7 / beq` answers before the palette is ever read: asking for
   * the colour that is already there gives control 1 with the blue already
   * in place, even when a palette entry matches exactly and would have been
   * the shorter answer.
   */
  it('Ham Best short-circuits an unchanged colour to a blue modify', () => {
    expect(run([...flat, 'Colour 3,$555', 'Print Ham Best($555,$555)']).out.trim()).toBe(
      String(0x15),
    )
  })

  // 4096 colours is how AMOS asks for HAM; `btst #$b` on the mode is the
  // only thing routine 163 will accept
  const hamScr = ['Screen Open 0,64,32,4096,Lowres', 'Cls 0']

  it('Ham Fade Out darkens by one step, sixteen calls to black', () => {
    // "darkens the screen by one single step. After calling it 16 times, the
    // Ham screen is completely black"
    expect(run([...hamScr, 'Colour 1,$FFF', 'Ham Fade Out 0', 'Print Colour(1)']).out.trim()).toBe(String(0xeee))
    const { out } = run([...hamScr, 'Colour 1,$FFF', 'For I=1 To 16 : Ham Fade Out 0 : Next I', 'Print Colour(1)'])
    expect(out.trim()).toBe('0')
  })

  /**
   * `move.w $48(a0),d0 / btst #$b,d0 / Rbeq routine 390` — a screen that is
   * not HAM is an error, not a no-op. The tests above used to fade a plain
   * 16-colour screen quite happily.
   */
  it('Ham Fade Out refuses a screen that is not HAM', () => {
    expect(() => run([...scr, 'Ham Fade Out 0'])).toThrow(/illegal function call/i)
  })

  /**
   * The half the port was missing: the modify nibbles in the bitmap darken
   * too, by a bitwise 4-bit decrement with borrow across planes 0-3, and only
   * where the control bits (planes 4 and 5) say the pixel IS a modify and the
   * nibble is not already zero.
   */
  it('Ham Fade Out darkens the modify nibbles in the bitmap', () => {
    const { rt } = run([
      ...hamScr,
      'Ink $2F : Plot 0,0', // modify RED, nibble 15 -> 14
      'Ink $10 : Plot 1,0', // modify BLUE, nibble 0  -> left alone
      'Ink $0F : Plot 2,0', // a palette index, not a modify -> left alone
      'Ham Fade Out 0',
    ])
    const px = rt.screens.get(0)!.rp.bitMap.pixels
    expect([px[0], px[1], px[2]]).toEqual([0x2e, 0x10, 0x0f])
  })

  /**
   * The manual promises -1 off the screen. Routine 160 has no -1 in it: both
   * out-of-range guards fall on `move.w (a0),d3` with a0 = `$62(a1)`, so the
   * answer is the RGB of palette entry 0. Colour 0 is black by default, which
   * is why "-1" was never caught by eye — so the test sets it to something
   * that cannot be confused with either 0 or -1.
   */
  it('Ham Point off the screen returns colour 0, not -1', () => {
    const off = [...scr, 'Colour 0,$4A7']
    expect(run([...off, 'Print Ham Point(-1,0)']).out.trim()).toBe(String(0x4a7))
    expect(run([...off, 'Print Ham Point(0,999)']).out.trim()).toBe(String(0x4a7))
    expect(run([...off, 'Print Ham Point(999,0)']).out.trim()).toBe(String(0x4a7))
    expect(run([...off, 'Print Ham Point(0,-1)']).out.trim()).toBe(String(0x4a7))
  })

  /**
   * And on the screen: colour 0 is the implicit colour before the left edge,
   * so a run of modify pixels builds off it. `$21` is control 2 (set RED) with
   * a nibble of 1, `$11` control 1 (set BLUE) with a nibble of 1.
   */
  it('Ham Point carries the line forward from colour 0', () => {
    // six planes, because the routine takes the control from planes 4 and 5
    const prog = [
      'Screen Open 0,64,32,64,Lowres',
      'Cls 0',
      'Colour 0,$4A7',
      'Ink $21 : Plot 0,0',
      'Ink $11 : Plot 1,0',
      // read the whole row before printing: Print draws at the cursor, which
      // is row 0, and would scribble over the pixels still to be read
      'A=Ham Point(0,0) : B=Ham Point(1,0) : C=Ham Point(2,0)',
      'Print A;" ";B;" ";C',
    ]
    // x=0 takes RED from colour 0's $4A7; x=1 then takes BLUE; x=2 is a
    // plain index 0, which replaces the whole colour again
    expect(run(prog).out.replace(/\s+/g, ' ').trim()).toBe(`${0x1a7} ${0x1a1} ${0x4a7}`)
  })

  /*
   * Routine 356 ($7f10) sums the three nibbles and divides by three: a flat
   * average, not a weighted luma. The divide is a 192-byte ramp built on entry
   * from 64 passes of `k, k, k+1`, so entry i is i/3 rounded to nearest. And
   * it never touches the destination's palette -- an earlier pass overwrote it
   * with a grey ramp, and wrote the chunky cache only to `invalidate()` it,
   * which threw the conversion away before anything could read it.
   */
  const grey = (rt: Runtime, x: number): number => rt.screens.get(1)!.rp.point(x, 0)

  it('Convert Grey averages R+G+B in thirds and leaves the palette alone', () => {
    const { rt } = run([
      'Screen Open 0,64,32,16,Lowres',
      'Screen Open 1,64,32,16,Lowres',
      'Screen 1 : Colour 3,$0F0',
      'Screen 0 : Cls 0',
      'Colour 0,$000 : Colour 1,$F00 : Colour 2,$FFF : Colour 3,$888',
      'Ink 1 : Bar 0,0 To 3,3 : Ink 2 : Bar 4,0 To 7,3 : Ink 3 : Bar 8,0 To 11,3',
      'Convert Grey 0 To 1',
    ])
    expect(grey(rt, 20)).toBe(0) // $000, sum 0
    expect(grey(rt, 0)).toBe(5) // $F00, sum 15, and 15/3 is 5
    expect(grey(rt, 4)).toBe(15) // $FFF, sum 45 -- white reaches the top here
    expect(grey(rt, 8)).toBe(8) // $888, sum 24, and 25/3 rounds to 8
    // the destination palette is untouched
    expect(rt.screens.get(1)!.palette[3]).toBe(0x0f0)
  })

  it('Convert Grey scales by the DESTINATION depth, and 32 colours falls short', () => {
    // `lsl.w d4,d3` shifts by depth-1 and `lsr.w #$3,d3` divides by eight, so
    // five planes index the ramp at sum*2: white is 90, which reads back 30
    const { rt } = run([
      'Screen Open 0,64,32,16,Lowres',
      'Screen Open 1,64,32,32,Lowres',
      'Screen 0 : Cls 0 : Colour 1,$FFF : Ink 1 : Bar 0,0 To 3,3',
      'Convert Grey 0 To 1',
    ])
    expect(grey(rt, 0)).toBe(30)
  })

  it('Convert Grey halves an EHB source above colour 31', () => {
    // colours 32..63 read `$22(a1,d3.w)` with d3 = colour*2, which is
    // palette[colour-32], and then `lsr.w #$4,d3` instead of #$3
    const { rt } = run([
      'Screen Open 0,64,32,64,Lowres',
      'Screen Open 1,64,32,16,Lowres',
      'Screen 0 : Cls 0 : Colour 1,$F00',
      'Ink 1 : Bar 0,0 To 3,3 : Ink 33 : Bar 4,0 To 7,3',
      'Convert Grey 0 To 1',
    ])
    expect(grey(rt, 0)).toBe(5) // sum 15, divided by eight then by three
    expect(grey(rt, 4)).toBe(2) // the same colour at half brightness
  })

  it('Convert Grey decodes a HAM source, holding across the row', () => {
    // "it makes no sense to open a HAM screen for that purpose" is about the
    // TARGET; the source arm at $80c6 decodes hold-and-modify properly, and
    // `move.w $62(a1),d5` restarts the hold from colour 0 on every row
    const { rt } = run([
      'Screen Open 0,64,32,4096,Lowres',
      'Screen Open 1,64,32,16,Lowres',
      'Screen 0 : Cls 0 : Colour 0,$000',
      'Ink $2F : Plot 0,0', // modify RED to 15: the hold becomes $F00
      'Ink $1F : Plot 1,0', // then modify BLUE: $F0F, carried from the last
      'Convert Grey 0 To 1',
    ])
    expect(grey(rt, 0)).toBe(5) // sum 15
    expect(grey(rt, 1)).toBe(10) // sum 30, and 31/3 rounds to 10
    expect(grey(rt, 2)).toBe(0) // index 0 sets the whole colour again
  })
})

describe('slice 7: graphics', () => {
    // 16 colours: the tests use pens up to 7, and a 4-colour screen would mask
  // them down to the palette's range
  const scr = ['Screen Open 0,64,32,16,Lowres', 'Cls 0']

  it('Blitter Fill fills the gap between two dots on a line', () => {
    // the manual's own rule: "It does only fill the gap between two dots of a
    // horizontal line. Therefore the limiting lines may only be one pixel
    // th[ick]. These lines can be either created using Turbo Draw or Bcircle."
    const { rt } = run([...scr, 'Turbo Plot 2,5,1', 'Turbo Plot 9,5,1', 'Blitter Fill 0,0'])
    const s = rt.screens.get(0)!
    const px = s.rp.bitMap.pixels
    expect(px[5 * 64 + 1]! & 1).toBe(0) // outside the pair
    expect(px[5 * 64 + 2]! & 1).toBe(1) // the left dot survives
    expect(px[5 * 64 + 5]! & 1).toBe(1) // the gap is filled
    expect(px[5 * 64 + 9]! & 1).toBe(1) // the right dot survives
    expect(px[5 * 64 + 10]! & 1).toBe(0)
  })

  it('Blitter Fill works one bitplane at a time, which is why plane is an argument', () => {
    const { rt } = run([...scr, 'Turbo Plot 2,5,2', 'Turbo Plot 9,5,2', 'Blitter Fill 0,1'])
    const px = rt.screens.get(0)!.rp.bitMap.pixels
    expect(px[5 * 64 + 5]! & 2).toBe(2) // plane 1 filled
    expect(px[5 * 64 + 5]! & 1).toBe(0) // plane 0 untouched
  })

  /**
   * "Added clipping for Turbo Plot, Shade Pix and Turbo Point. Now they are
   * as secure as the normal Plot and Point commands" (V1.30) — and routine
   * 349 ($7a8e) shows what "secure" means: it ANSWERS -1 rather than
   * declining to read. Every one of its four range tests branches to
   * `moveq #$0,d2 / moveq #$ff,d3 / rts`, and $ff through moveq is -1.
   *
   * The port answered 0, which is a real colour and indistinguishable from a
   * black pixel inside the screen. AMOS's own Point returns -1 too, so this
   * was the odd one out.
   */
  it('Turbo Point answers -1 outside the screen, not 0', () => {
    const { out } = run([...scr, 'Turbo Plot 3,4,5', 'Print Turbo Point(3,4)',
      'Print Turbo Point(999,999)', 'Print Turbo Point(-1,4)', 'Print Turbo Point(3,-1)',
      'Print Turbo Point(64,4)', 'Print Turbo Point(3,32)'])
    const l = out.trim().split('\n').map((x) => x.trim())
    expect(l).toEqual(['5', '-1', '-1', '-1', '-1', '-1'])
    // and the last pixel inside is still readable, so the bound is exclusive
    expect(run([...scr, 'Turbo Plot 63,31,7', 'Print Turbo Point(63,31)']).out.trim()).toBe('7')
    expect(() => run([...scr, 'Turbo Plot -5,-5,1'])).not.toThrow()
  })

  it('Turbo Draw draws a line', () => {
    const { rt } = run([...scr, 'Turbo Draw 0,0 To 10,0,3'])
    const px = rt.screens.get(0)!.rp.bitMap.pixels
    expect(px[5]).toBe(3)
    expect(px[11]).toBe(0)
  })

  /**
   * Neither takes a COLOUR, which an earlier pass gave both. Fcircle is ten
   * bytes — `move.l (a3),-(a3)` to duplicate the radius, then straight into
   * Fellipse — and Fellipse pops exactly four longs into d0-d3 for
   * `AreaEllipse(rp, xc, yc, a, b)` on GfxBase (-$ba), followed by AreaEnd
   * (-$108). So the fill takes the RastPort's FgPen, which is AMOS's Ink, and
   * the token table says the same: `I0,0,0` and `I0,0,0,0`.
   */
  it('Fcircle and Fellipse fill in Ink, and take no colour argument', () => {
    const { rt } = run([...scr, 'Ink 7', 'Fcircle 20,16,8'])
    const px = rt.screens.get(0)!.rp.bitMap.pixels
    expect(px[16 * 64 + 20]).toBe(7) // the centre is filled, in Ink
    const e = run([...scr, 'Ink 5', 'Fellipse 20,16,10,4'])
    expect(e.rt.screens.get(0)!.rp.bitMap.pixels[16 * 64 + 20]).toBe(5)
    // a colour argument is one too many and does not parse
    expect(() => run([...scr, 'Fcircle 20,16,8,7'])).toThrow(/syntax/)
    expect(() => run([...scr, 'Fellipse 20,16,10,4,5'])).toThrow(/syntax/)
  })

  /**
   * Routine 346 is thirty bytes: look the default plane mask up and fall into
   * the six-argument routine. The table at $7778 is `01 03 07 0f 1f 3f` — SIX
   * bytes, indexed by `depth - 1`. A depth of 7 or 8 reads the two bytes after
   * it, which are the first half of the next routine's `movea.l $168(a5),a2`:
   * $24 and $6d. So on an AGA screen the default mask is 36 or 109 rather than
   * 127 or 255, and the line comes out in the wrong colour. Reproduced.
   *
   * A mask of ZERO draws nothing: routine 347 opens `move.l (a3)+,d6 / bne`
   * and the fall-through skips the five remaining arguments and returns.
   */
  it('DEFECT: Turbo Draw has only six default plane masks, so AGA reads past them', () => {
    const wide = ['Screen Open 0,64,32,256,Lowres', 'Cls 0'] // depth 8
    const { rt } = run([...wide, 'Turbo Draw 0,0 To 20,0,255'])
    // 255 asked for, the byte after the table -- $6d = 109 -- delivered
    expect(rt.screens.get(0)!.rp.point(10, 0)).toBe(109)
    // a plane mask of zero draws nothing at all
    const none = run([...scr, 'Turbo Draw 0,0 To 20,0,7,0'])
    expect(none.rt.screens.get(0)!.rp.point(10, 0)).toBe(0)
    // and a six-plane screen still gets every plane
    const six = run([...scr, 'Turbo Draw 0,0 To 20,0,7'])
    expect(six.rt.screens.get(0)!.rp.point(10, 0)).toBe(7)
  })

  it('Bcircle draws an outline into ONE plane, which Blitter Fill can then fill', () => {
    const { rt } = run([...scr, 'Bcircle 20,16,8,0', 'Blitter Fill 0,0'])
    const px = rt.screens.get(0)!.rp.bitMap.pixels
    expect(px[16 * 64 + 20]! & 1).toBe(1) // inside is filled
    expect(px[16 * 64 + 40]! & 1).toBe(0) // well outside is not
  })

  /*
   * Routine 353 ($7dd4) is a per-scanline circle whose only write is
   * `bchg.b d0,(a1,d1.w)`. An earlier pass swept it parametrically and OR-ed.
   */
  it('Bcircle toggles, which is why the same circle twice erases it', () => {
    const one = run([...scr, 'Bcircle 20,10,5,0'])
    expect(one.rt.screens.get(0)!.rp.point(15, 10)).toBe(1)
    const twice = run([...scr, 'Bcircle 20,10,5,0', 'Bcircle 20,10,5,0'])
    expect(twice.rt.screens.get(0)!.rp.point(15, 10)).toBe(0)
    expect(twice.rt.screens.get(0)!.rp.point(17, 6)).toBe(0)
  })

  it('Bcircle leaves the very top and bottom pixels undrawn', () => {
    // at dy = r the four plots are two pairs at the same x and cancel; the two
    // plots before the loop exist to survive the same cancellation at dy = 0
    const rp = run([...scr, 'Bcircle 20,10,5,0']).rt.screens.get(0)!.rp
    expect(rp.point(20, 5)).toBe(0)
    expect(rp.point(20, 15)).toBe(0)
    expect(rp.point(15, 10)).toBe(1)
    expect(rp.point(25, 10)).toBe(1)
    // and the Newton root rounds rather than flooring: 25-16 = 9 gives 3, but
    // 25-4 = 21 gives 5 where a floor would give 4
    expect(rp.point(17, 6)).toBe(1)
    expect(rp.point(15, 8)).toBe(1)
  })

  it('Bcircle clamps x to the right edge instead of clipping it', () => {
    // `cmp.w d3,d0 / blt / move.w d3,d0 / subq.w #$1,d0` -- a circle off the
    // right edge leaves a stripe down the last column
    const rp = run([...scr, 'Bcircle 62,10,5,0']).rt.screens.get(0)!.rp
    expect(rp.point(63, 8)).toBe(1)
    expect(rp.point(63, 9)).toBe(1)
    expect(rp.point(63, 10)).toBe(1)
    expect(rp.point(63, 12)).toBe(1)
  })

  it('Blitter Busy is never true, and Blitter Wait has nothing to wait for', () => {
    expect(run([...scr, 'Print Blitter Busy']).out.trim()).toBe('0')
    expect(() => run([...scr, 'Blitter Wait'])).not.toThrow()
  })

  it('Vclip clamps where Vmod wraps — the manual pairs them', () => {
    expect(run(['Print Vclip(11,1 To 10)']).out.trim()).toBe('10')
    expect(run(['Print Vclip(0,1 To 10)']).out.trim()).toBe('1')
    expect(run(['Print Vclip(5,1 To 10)']).out.trim()).toBe('5')
    // the contrast that makes the pair worth having
    expect(run(['Print Vmod(11,1 To 10)']).out.trim()).toBe('1')
  })

  it('Aga Detect is true, because the modelled machine really is an A1200', () => {
    expect(run(['Print Aga Detect']).out.trim()).toBe('-1')
  })

  it('Set Ntsc and Set Pal write BEAMCON0, and do not displace Personnal', () => {
    expect(run(['Set Ntsc']).rt.beamcon0).toBe(0)
    expect(run(['Set Pal']).rt.beamcon0).toBe(0x20)
  })

  it('the Scrn structure pointers answer 0 rather than a plausible lie', () => {
    for (const k of ['Scrn Rastport', 'Scrn Bitmap', 'Scrn Layer', 'Scrn Layerinfo', 'Scrn Region']) {
      expect(run([...scr, `Print ${k}`]).out.trim()).toBe('0')
    }
  })

  /**
   * Routines 279 to 283 open `movea.l $52c(a5),a0 / move.l a0,d0 / Rbeq
   * routine 394`, and 394 is `moveq #$2f,d0` into L_ScCopy — AMOS error 47,
   * "Screen not opened". The pointer this port cannot supply is approximated
   * as 0, but the guard in front of it is real behaviour and is reproduced.
   */
  it('the Scrn pointers raise Screen not opened when there is none', () => {
    for (const k of ['Scrn Rastport', 'Scrn Bitmap', 'Scrn Layer', 'Scrn Layerinfo', 'Scrn Region']) {
      // assigned, not printed: Print needs a screen of its own, so printing
      // would prove nothing about the guard inside the routine
      expect(() => run(['Screen Close 0', `A=${k}`])).toThrow(/screen not opened/i)
    }
  })
})

describe('slice 7b: zoom, masks, C2P and the rest', () => {
  const scr = ['Screen Open 0,64,32,16,Lowres', 'Cls 0']

  /**
   * The last of the FAITHFUL-but-undispatched list, each against its routine.
   *
   * Exchange Bob/Icon (200/201, $5052/$50a2) share a shape: resolve the bank
   * through routine 1101/1102, read the count from `(a0)+`, then range-check
   * BOTH indices with `cmp.w d2,dn / Rbhi 390` and return early when they are
   * equal (`cmp.l d0,d1 / bne` past an `rts`).
   *
   * DEVIATION: that check is `bhi`, UNSIGNED, so index 0 passes it and the
   * following `subq.w #1 / lsl.w #3` then indexes eight bytes BEFORE the
   * table. The port errors instead of reading out of bounds — a corruption
   * that cannot be reproduced meaningfully.
   *
   * Blitter Copy Limit (routines 60 and 61 — an earlier pass cited 305, which
   * is Splinters territory) stores the rectangle Blitter Copy works within;
   * C2p Shift/Fire and Pix Shift Down and the Shade Bob pair are the effect
   * engines' remaining entry points.
   */
  it('the remaining graphics keywords dispatch against their routines', () => {
    const bobs = [...scr, 'Get Bob 1,0,0 To 8,8', 'Get Bob 2,8,0 To 16,8']
    expect(() => run([...bobs, 'Exchange Bob 1,2'])).not.toThrow()
    expect(() => run([...bobs, 'Exchange Bob 1,1'])).not.toThrow() // equal: early rts
    expect(() => run([...bobs, 'Exchange Bob 1,99'])).toThrow() // past the count
    expect(() => run([...bobs, 'Exchange Bob 0,1'])).toThrow() // see the DEVIATION above

    expect(() => run([...scr, 'Blitter Copy Limit 0'])).not.toThrow()
    expect(() => run([...scr, 'Blitter Copy Limit 0,0 To 31,15'])).not.toThrow()
  })

  /**
   * Routines 61, 71 and 75 share one region decode, instruction for
   * instruction:
   *
   *     move.l (a3)+,d4 / lsr.w #$4,d4        x1 DOWN to a 16-pixel boundary
   *     addi.w #$f,d6 / lsr.w #$4,d6          x2 UP to one
   *     sub.w d4,d6 / beq bail / bmi bail     the WORD count
   *     sub.w d5,d7 / beq bail / bmi bail     the ROW count
   *
   * so x is word-granular in BOTH directions and y2 is exclusive. The port
   * worked in whole pixels with both corners inclusive.
   */
  it('the blitter region is whole words wide and stops before y2', () => {
    const { rt } = run([
      'Screen Open 0,64,32,16,Lowres',
      'Ink 1 : Bar 0,0 To 63,31', // plane 0 set everywhere
      'Blitter Clear 0,0,4,0 To 12,2',
    ])
    const s = rt.screens.get(0)!
    const p = (x: number, y: number): number => s.rp.point(x, y) & 1
    expect(p(0, 0)).toBe(0) // x1 of 4 rounds DOWN, so pixel 0 goes too
    expect(p(15, 0)).toBe(0) // x2 of 12 rounds UP, so the whole word goes
    expect(p(16, 0)).toBe(1) // and the next word does not
    expect(p(0, 1)).toBe(0)
    expect(p(0, 2)).toBe(1) // two rows from y1 = 0, so y2 is exclusive
  })

  /**
   * The three do NOT agree on what an empty region means. Blitter Clear and
   * Blitter Fill bail with `addq.l #$8,a3 / rts` — they pop their remaining
   * arguments and do nothing. Blitter Copy Limit bails with `Rbra routine
   * 157`, which is a four-byte jump to routine 390: an error.
   */
  it('an empty blitter region is a no-op for Clear and an error for Copy Limit', () => {
    const { rt } = run([
      'Screen Open 0,64,32,16,Lowres',
      'Ink 1 : Bar 0,0 To 63,31',
      'Blitter Clear 0,0,0,0 To 0,8', // zero words wide
    ])
    expect(rt.screens.get(0)!.rp.point(0, 0) & 1).toBe(1)
    expect(() => run([...scr, 'Blitter Copy Limit 0,0 To 0,8'])).toThrow(/illegal function call/i)
    expect(() => run([...scr, 'Blitter Copy Limit 0,8 To 32,0'])).toThrow(/illegal function call/i)

    /**
     * Blitter Copy s1,p1 To s2,p2[,minterm] — routine 62 ($28d4) pushes the
     * default minterm $F0 (D = A) and falls into 63, which range-checks each
     * plane against its screen's depth with `move.w $50(a0),d4 / cmp.w d4,d7
     * / Rbge 390`.
     */
    const copied = run([
      // 16 COLOURS is four planes; `Screen Open ...,4,...` would be two
      'Screen Open 0,64,32,16,Lowres : Cls 0',
      'Screen Open 1,64,32,16,Lowres : Cls 0',
      'Screen 0 : Ink 1 : Bar 0,0 To 7,7', // plane 0 set
      'Blitter Copy Limit 0,0 To 15,15',
      'Blitter Copy 0,0 To 1,2', // plane 0 of screen 0 -> plane 2 of screen 1
    ])
    // read the bitmap rather than Print: a Print would draw its own text onto
    // the screen being sampled. Colour 4 is plane 2 alone, and outside the
    // source rectangle the minterm writes 0 rather than leaving the pixel.
    const dst1 = copied.rt.screens.get(1)!.rp
    expect(dst1.point(3, 3)).toBe(4)
    expect(dst1.point(12, 3)).toBe(0)

    // the plane must be inside the screen's depth
    expect(() => run([...scr, 'Blitter Copy Limit 0', 'Blitter Copy 0,9 To 0,0'])).toThrow()
    // and the limit is not optional: "you MUST set the limits of the operation"
    expect(() => run(['Screen Open 0,64,32,16,Lowres', 'Blitter Copy 0,0 To 0,1'])).toThrow()

    expect(() => run([...scr, 'Ink 7 : Bar 0,0 To 31,15', 'Pix Shift Down 0,1,7,0,0 To 31,15'])).not.toThrow()
    expect(() => run([...scr, 'Shade Bob Planes 4', 'Shade Bob Mask 0'])).not.toThrow()

    // Shade Bob Up/Down (routines 286 and 287, $6644 and $67e2) take
    // screen,x,y,image and shift the colour indexes under the bob's mask one
    // way or the other
    const shade = [...scr, 'Ink 7 : Bar 0,0 To 15,15', 'Get Bob 1,0,0 To 8,8']
    expect(() => run([...shade, 'Shade Bob Up 0,0,0,1'])).not.toThrow()
    expect(() => run([...shade, 'Shade Bob Down 0,0,0,1'])).not.toThrow()

    // Exchange Icon (201, $50a2) is Exchange Bob against the icon bank
    const icons = [...scr, 'Get Icon 1,0,0 To 8,8', 'Get Icon 2,8,0 To 16,8']
    expect(() => run([...icons, 'Exchange Icon 1,2'])).not.toThrow()
    expect(() => run([...icons, 'Exchange Icon 1,99'])).toThrow()

    // C2p Shift / C2p Fire — the chunky-to-planar pair, st,wx,wy To st2,n
    const c2p = ['Screen Open 0,64,32,16,Lowres', 'Reserve As Work 5,4096', 'Reserve As Work 6,4096']
    expect(() => run([...c2p, 'C2p Shift Start(5),8,8 To Start(6),1'])).not.toThrow()
    expect(() => run([...c2p, 'C2p Fire Start(5),8,8 To Start(6),1'])).not.toThrow()
  })

  /**
   * The far corner is EXCLUSIVE: `sub.w d4,d6 / subq.w #$1,d6` then `dbra d6`
   * runs x2-x1 times from x1, so a 10x10 Bar counted 0,0 To 9,9 gives 81 and
   * not the 100 an earlier pass expected. Counting the whole block needs
   * 10,10.
   */
  it('Count Pixels counts what is NOT the colour, over a half-open box', () => {
    // "Counts the pixels ... that DON'T have the colour index colour"
    const bar = [...scr, 'Ink 3 : Bar 0,0 To 9,9']
    expect(run([...bar, 'Print Count Pixels(0,0,0,0 To 9,9)']).out.trim()).toBe('81')
    expect(run([...bar, 'Print Count Pixels(0,0,0,0 To 10,10)']).out.trim()).toBe('100')
    expect(run([...bar, 'Print Count Pixels(0,3,0,0 To 10,10)']).out.trim()).toBe('0')
  })

  /**
   * `Rbeq routine 390` fires before any counting, so an empty box is AMOS
   * error 23 and not a count of nothing; `Rbmi` makes a reversed one an error
   * as well.
   */
  it('Count Pixels errors on an empty or reversed box', () => {
    expect(() => run([...scr, 'Print Count Pixels(0,0,5,5 To 5,9)'])).toThrow(/illegal function call/i)
    expect(() => run([...scr, 'Print Count Pixels(0,0,5,5 To 9,5)'])).toThrow(/illegal function call/i)
    expect(() => run([...scr, 'Print Count Pixels(0,0,5,5 To 1,9)'])).toThrow(/illegal function call/i)
  })

  /** `move.b d2,$2(a7)` / `cmp.b $a(a7),d0` — the colour is a byte */
  it('Count Pixels compares the colour as a byte', () => {
    const bar = [...scr, 'Ink 3 : Bar 0,0 To 9,9']
    // 259 truncates to 3, so the whole block matches and nothing is counted
    expect(run([...bar, 'Print Count Pixels(0,259,0,0 To 10,10)']).out.trim()).toBe('0')
  })

  /**
   * A single lit pixel at the left of the source row, so the two multipliers
   * can be told apart. The box is 0,0 To 8,1 — both far corners exclusive —
   * which copies the eight pixels of row 0. The destination lands at 0,16 to
   * keep clear of the console cursor screen 1 draws into its own bitmap.
   */
  const zoom = (mode: string): number[] => {
    const { rt } = run([
      'Screen Open 0,64,32,16,Lowres',
      'Screen Open 1,64,32,16,Lowres',
      'Screen 1 : Cls 0',
      'Screen 0 : Cls 0 : Ink 5 : Plot 0,0',
      `Bzoom 0,0,0,8,1 To 1,0,16,${mode}`,
    ])
    const px = rt.screens.get(1)!.rp.bitMap.pixels
    const at = (x: number, y: number): number => px[(16 + y) * 64 + x]!
    return [at(0, 0), at(1, 0), at(2, 0), at(0, 1), at(0, 2)]
  }

  /**
   * The two nibbles were the wrong way round. `$342(a2)` is the HIGH nibble
   * minus one and counts extra copies of each finished destination ROW;
   * `$340(a2)` is the LOW nibble and picks between four bit-stretching
   * tables, which is why only 1, 2, 4 and 8 exist horizontally. The manual
   * agrees once it is read the same way: "double, four times or eight times
   * as wide and from 1 to 15 times as high".
   */
  it('Bzoom takes its width from the low nibble and its height from the high', () => {
    //                      x0 x1 x2  y1 y2
    expect(zoom('$12')).toEqual([5, 5, 0, 0, 0]) // 2 wide, 1 high
    expect(zoom('$21')).toEqual([5, 0, 0, 5, 0]) // 1 wide, 2 high
    expect(zoom('$31')).toEqual([5, 0, 0, 5, 5]) // 1 wide, 3 high
    expect(zoom('$14')).toEqual([5, 5, 5, 0, 0]) // 4 wide, 1 high
    expect(zoom('$22')).toEqual([5, 5, 0, 5, 0]) // the old test's factor, symmetric
  })

  /**
   * The mode is popped and validated before any other argument is read:
   * `Rbmi routine 390` on the whole long, `andi.w #$f0,d0 / tst.w d0 / Rbeq`
   * on the vertical, and four `cmp.w`s with an `Rbne` on the horizontal.
   */
  it('Bzoom validates both nibbles of the factor', () => {
    const bad = (mode: string): void => {
      run([
        'Screen Open 0,64,32,16,Lowres',
        'Screen Open 1,64,32,16,Lowres',
        `Bzoom 0,0,0,8,1 To 1,0,0,${mode}`,
      ])
    }
    expect(() => bad('$13')).toThrow(/illegal function call/i) // 3 is not 1,2,4,8
    expect(() => bad('$02')).toThrow(/illegal function call/i) // a zero height
    expect(() => bad('-1')).toThrow(/illegal function call/i) // Rbmi
    expect(() => bad('$F8')).not.toThrow() // 15 high, 8 wide is the maximum
  })

  it('Mask Copy without a mask is a plain Screen Copy', () => {
    const { rt } = run([
      'Screen Open 0,64,32,16,Lowres',
      'Screen Open 1,64,32,16,Lowres',
      'Screen 0 : Cls 0 : Ink 6 : Bar 0,0 To 3,3',
      'Mask Copy 0,0,0,3,3 To 1,10,10,0',
    ])
    expect(rt.screens.get(1)!.rp.bitMap.pixels[10 * 64 + 10]).toBe(6)
  })

  /**
   * `sub.l d0,d4 / sub.l d1,d5` gives BltMaskBitMapRastPort its xSize and
   * ySize, so the far corner is exclusive here as it is in Count Pixels,
   * Coords Read and Bzoom. A 4x4 Bar copied 0,0 To 3,3 lands 3x3.
   */
  it('Mask Copy has an exclusive far corner', () => {
    const { rt } = run([
      'Screen Open 0,64,32,16,Lowres',
      'Screen Open 1,64,32,16,Lowres',
      'Screen 1 : Cls 0',
      'Screen 0 : Cls 0 : Ink 6 : Bar 0,0 To 3,3',
      'Mask Copy 0,0,0,3,3 To 1,10,10,0',
    ])
    const px = rt.screens.get(1)!.rp.bitMap.pixels
    expect(px[10 * 64 + 12]).toBe(6) // the third column arrives
    expect(px[10 * 64 + 13]).toBe(0) // the fourth does not
    expect(px[12 * 64 + 10]).toBe(6)
    expect(px[13 * 64 + 10]).toBe(0)
  })

  /**
   * Routine 174 ($4756) is the whole-screen form the port did not have:
   * `Mask Copy s1 To s2,mask`, with all four coordinates zeroed and the sizes
   * taken from `move.w $4c(a0),d4 / move.w $4e(a0),d5`.
   */
  it('Mask Copy takes a whole-screen form with no coordinates at all', () => {
    const { rt } = run([
      'Screen Open 0,64,32,16,Lowres',
      'Screen Open 1,64,32,16,Lowres',
      'Screen 1 : Cls 0',
      'Screen 0 : Cls 0 : Ink 6 : Bar 0,0 To 3,3 : Plot 63,31',
      'Mask Copy 0 To 1,0',
    ])
    const px = rt.screens.get(1)!.rp.bitMap.pixels
    expect(px[0]).toBe(6)
    expect(px[31 * 64 + 63]).toBe(6) // the far corner of the screen too
  })

  /**
   * Routine 175 is twelve bytes that push $E0 and fall into 176, so the
   * minterm is an optional tenth argument rather than a separate form.
   */
  it('Mask Copy accepts an explicit minterm as a tenth argument', () => {
    const { rt } = run([
      'Screen Open 0,64,32,16,Lowres',
      'Screen Open 1,64,32,16,Lowres',
      'Screen 1 : Cls 0',
      'Screen 0 : Cls 0 : Ink 6 : Bar 0,0 To 3,3',
      'Mask Copy 0,0,0,3,3 To 1,10,10,0,$E0',
    ])
    expect(rt.screens.get(1)!.rp.bitMap.pixels[10 * 64 + 10]).toBe(6)
  })

  it('C2p Convert writes a chunky buffer into a screen', () => {
    const { rt } = run([
      'Screen Open 0,64,32,16,Lowres : Cls 0',
      'Reserve As Work 9,64',
      'Poke Start(9),7 : Poke Start(9)+1,3',
      'C2p Convert Start(9),32,1 To 0,0,0',
    ])
    const px = rt.screens.get(0)!.rp.bitMap.pixels
    expect(px[0]).toBe(7)
    expect(px[1]).toBe(3)
  })

  /**
   * Routine 382's entry checks all branch to $a0ba, which is `movem.l
   * (a7)+,d2-d7/a2-a6 / rts`. Bad arguments do nothing at all — they are not
   * an error, so a program with the wrong width just sees an unchanged
   * screen. `andi.w #$1f,d4` is the width, `andi.w #$7,d5` the x offset.
   */
  it('C2p Convert silently does nothing on an unaligned width or offset', () => {
    const px = (prog: string): number => {
      const { rt } = run([
        'Screen Open 0,64,32,16,Lowres : Cls 0',
        'Reserve As Work 9,64',
        'Poke Start(9),7',
        prog,
      ])
      return rt.screens.get(0)!.rp.bitMap.pixels[0]!
    }
    expect(px('C2p Convert Start(9),32,1 To 0,0,0')).toBe(7) // the control
    expect(px('C2p Convert Start(9),16,1 To 0,0,0')).toBe(0) // width not a multiple of 32
    expect(px('C2p Convert Start(9),32,0 To 0,0,0')).toBe(0) // no rows
    expect(px('C2p Convert Start(9),96,1 To 0,0,0')).toBe(0) // wider than the bitmap
  })

  /**
   * Routine 77 ($2ff2) shifts every BYTE right, four at a time, and the mask
   * is what makes it a per-byte shift rather than a longword one:
   *
   *     moveq #$ff,d0 / lsr.b d7,d0     what survives one byte's shift
   *     ...replicated into all four...
   *  L: move.l (a0)+,d1 / lsr.l d7,d1 / and.l d0,d1 / move.l d1,(a2)+
   *
   * An earlier pass had it ADDING its last argument to each byte, which is
   * neither the name nor the code.
   */
  it('C2p Shift shifts each byte right, and leaves a partial longword alone', () => {
    const peek = (prog: string[], n: number): number[] => {
      const { rt } = run([
        'Reserve As Work 3,64 : Reserve As Work 4,64',
        'Poke Start(3),128 : Poke Start(3)+1,64 : Poke Start(3)+2,32 : Poke Start(3)+3,16',
        'Poke Start(3)+4,255 : Poke Start(3)+5,255',
        'Poke Start(4)+4,17 : Poke Start(4)+5,18',
        ...prog,
      ])
      const d = rt.memBanks.get(4)!.data
      return Array.from({ length: n }, (_, i) => d[i]!)
    }
    // 128>>2, 64>>2, 32>>2, 16>>2
    expect(peek(['C2p Shift Start(3),4,1 To Start(4),2'], 4)).toEqual([32, 16, 8, 4])
    // a shift of zero is the plain copy arm at $3022
    expect(peek(['C2p Shift Start(3),4,1 To Start(4),0'], 4)).toEqual([128, 64, 32, 16])
    // `lsr.l #$2,d6` counts LONGWORDS, so six bytes is one longword and the
    // last two are never written -- the markers survive
    expect(peek(['C2p Shift Start(3),6,1 To Start(4),1'], 6)).toEqual([64, 32, 16, 8, 17, 18])
  })

  /**
   * Routine 76 ($2fa2) is a FLAME filter: five neighbours summed -- the byte
   * one row below, one row above, left, itself and right -- averaged through
   * a table, then the decay taken off and clamped at zero. An earlier pass
   * subtracted the decay from each byte on its own, which is a fade.
   *
   * NOTE: the routine walks the buffer FLAT, so "left" and "right" cross row
   * boundaries, and it reads a row either side of the buffer without
   * checking. Both reproduced, the second as zero rather than as heap.
   */
  it('C2p Fire averages five neighbours before it decays', () => {
    const { rt } = run([
      'Reserve As Work 3,64 : Reserve As Work 4,64',
      // a 4x3 buffer with the middle row bright
      'For I=4 To 7 : Poke Start(3)+I,100 : Next I',
      'C2p Fire Start(3),4,3 To Start(4),0',
    ])
    const d = rt.memBanks.get(4)!.data
    // row 0 col 0: only the byte below it is lit, so 100/5
    expect(d[0]).toBe(20)
    // row 1 col 1: left, self and right are all lit, so 300/5
    expect(d[5]).toBe(60)
    // row 1 col 0: self and right, plus the flat walk's "left" from row 0
    expect(d[4]).toBe(40)
    // the table rounds to NEAREST rather than flooring: routine 396 steps the
    // value up between the third and fourth byte of each five-byte group, so
    // a sum of 3 gives 1 where a floor would give 0
    const odd = run([
      'Reserve As Work 3,64 : Reserve As Work 4,64',
      'Poke Start(3)+4,1 : Poke Start(3)+5,1 : Poke Start(3)+6,1',
      'C2p Fire Start(3),4,3 To Start(4),0',
    ])
    expect(odd.rt.memBanks.get(4)!.data[5]).toBe(1) // sum 3, and 3/5 rounds to 1
    const two = run([
      'Reserve As Work 3,64 : Reserve As Work 4,64',
      'Poke Start(3)+4,1 : Poke Start(3)+5,1',
      'C2p Fire Start(3),4,3 To Start(4),0',
    ])
    expect(two.rt.memBanks.get(4)!.data[5]).toBe(0) // sum 2, and 2/5 rounds to 0
    // and the decay comes off after the average, clamped at zero
    const dark = run([
      'Reserve As Work 3,64 : Reserve As Work 4,64',
      'For I=4 To 7 : Poke Start(3)+I,100 : Next I',
      'C2p Fire Start(3),4,3 To Start(4),25',
    ])
    const e = dark.rt.memBanks.get(4)!.data
    expect(e[0]).toBe(0) // 20 - 25 clamps
    expect(e[5]).toBe(35) // 60 - 25
  })

  /**
   * `movem.l $8(a1),a3-a6` — four plane pointers out of the BitMap, so the
   * converter writes planes 0-3 and only the low nibble of each source byte.
   * That is what the `cmp.w #$4,d4` depth gate is guarding, and it is why a
   * deeper screen keeps whatever planes 4 and up already held.
   */
  it('C2p Convert writes four planes, leaving the rest of the pixel alone', () => {
    const { rt } = run([
      'Screen Open 0,64,32,64,Lowres : Cls 0',
      'Ink $30 : Plot 0,0', // planes 4 and 5 set under the first pixel
      'Reserve As Work 9,64',
      'Poke Start(9),$27',
      'C2p Convert Start(9),32,1 To 0,0,0',
    ])
    // the source byte's high bits are dropped and the screen's high planes
    // survive: $30 | ($27 and $0F) = $37
    expect(rt.screens.get(0)!.rp.bitMap.pixels[0]).toBe(0x37)
  })

  /** the depth gate itself: message 18, `At least 4 planes required!` */
  it('C2p Convert refuses a screen shallower than four planes', () => {
    expect(() =>
      run([
        'Screen Open 0,64,32,4,Lowres : Cls 0',
        'Reserve As Work 9,64',
        'C2p Convert Start(9),32,1 To 0,0,0',
      ]),
    ).toThrow(/At least 4 planes required/)
  })

  /**
   * The manual: *"This function replaces the AMOS function Text Styles,
   * because this one does not return the multicoloured font bit (Bit 6). Apart
   * from this, Font Style is totally identical with the AMOS function."*
   *
   * Routine 145 is seven instructions and reads TextFont + $17. AMOS's Text
   * Styles is `move.b 56(a1),d3` off the RASTPORT (FnTextStyle, +Lib.s:9896),
   * which is rp_AlgoStyle. The colour-font bit the manual wants is
   * FSF_COLORFONT, bit 6 of **tf_Style** at TextFont + $16.
   *
   * $17 is tf_FLAGS, one byte further on: ROMFONT/DISKFONT/REVPATH/TALLDOT/
   * WIDEDOT/PROPORTIONAL/DESIGNED/REMOVED. So Font Style never reports a style
   * at all, and Set Text cannot move it. Bit 6 there is FPF_DESIGNED, which is
   * set on essentially every real font — which is presumably why an off-by-one
   * survived three years of releases: the bit the manual promises always looks
   * set. Reproduced.
   */
  it('DEFECT: Font Style reads tf_Flags, one byte past the style it documents', () => {
    // Set Text writes rp_AlgoStyle, which this never looks at
    expect(run([...scr, 'Set Text 1', 'Print Font Style']).out.trim()).toBe(
      run([...scr, 'Print Font Style']).out.trim(),
    )
    // what comes back is the font's flags, not a style
    const { rt, out } = run([...scr, 'Print Font Style'])
    expect(out.trim()).toBe(String(rt.screens.get(0)!.rp.font?.flags ?? 0))
  })

  it('Cop Pos gives the address of the next copper instruction', () => {
    // Cop Reset needs the system copper out of the way first, which is what
    // "If you create your own copperlist" in the manual assumes
    const { out } = run(['Copper Off', 'Cop Reset', 'Cop Move $180,$F00', 'Print Cop Pos'])
    expect(Number(out.trim())).toBeGreaterThan(0)
  })

  it('Raster Wait yields rather than racing a beam that is not there', () => {
    expect(() => run([...scr, 'Raster Wait 100'])).not.toThrow()
    expect(() => run([...scr, 'Raster Wait 100,20'])).not.toThrow()
  })

  /**
   * X Raster (192, $4f68) reads $dff007 and doubles it, because HPOS counts
   * colour clocks and each is two lores pixels. Y Raster (193, $4f7e) is a
   * NINE-bit read — $dff005 supplies V8 above $dff006's eight — which is why
   * a PAL frame's 312 lines fit. An earlier pass shifted a sixteen-bit word
   * right by eight and masked with $1ff, so bit 8 could never be set and Y
   * wrapped at 256.
   */
  it('X Raster doubles the colour clock, Y Raster is nine bits wide', () => {
    // the modelled beam advances a line every 64 steps, so it takes a real
    // loop to sweep a frame rather than a handful of statements
    const { rt, out } = run([
      ...scr,
      'Hi=0',
      'For I=0 To 24000',
      'A=Y Raster : If A>Hi Then Hi=A',
      'Next I',
      'Print Hi;",";X Raster',
    ])
    const [hi, xr] = out.trim().split(',').map(Number)
    expect(hi).toBeGreaterThan(255) // impossible under an eight-bit read
    expect(hi).toBeLessThan(313) // and still inside a PAL frame
    expect(xr! % 2).toBe(0) // always even: the value is doubled
    expect(xr).toBeLessThanOrEqual(510)
    expect(rt).toBeTruthy()
  })

  /**
   * Shade Bob Mask (routine 284, $6610) normalises to exactly 0 or 1 —
   * `move.l (a3)+,d0 / beq` then either `move.w #$1,$284(a2)` or
   * `clr.w $284(a2)` — so it does not store the value it was given.
   */
  it('Shade Bob Mask stores a flag, not the value', () => {
    expect(run(['Shade Bob Mask 99']).rt.amcaf.shadeMask).toBe(true)
    expect(run(['Shade Bob Mask 0']).rt.amcaf.shadeMask).toBe(false)
    expect(run(['Shade Bob Mask -1']).rt.amcaf.shadeMask).toBe(true)
  })

  /**
   * The header of amcaf.ts used to say the hunk held no printable text at all.
   * It holds the version string, four instructions into routine 19, length
   * word and all — and the two releases differ in LANGUAGE as well as version:
   *
   *   1.40, $2176:  "AMCAF Erweiterung V1.40 26-Dec-95 von Chris Hodges."
   *   1.50, $22d8:  "AMCAF extension V1.50beta4 11-Jan-98 by Chris Hodges."
   *
   * the shareware build in German, the freeware final in English — the same
   * split the demo guards showed. One body of code serves both here and the
   * token tables carry no registry id, so this answers with 1.50's.
   */
  it('Amcaf Version$ is the string in the binary, not a made-up one', () => {
    expect(run(['Print Amcaf Version$']).out.trim()).toBe(
      'AMCAF extension V1.50beta4 11-Jan-98 by Chris Hodges.',
    )
  })

  /**
   * The manual: *"After calling Amcaf Aga Notation On, all AMCAF commands and
   * functions take 24 bit values... The default setting is 12 bit."*
   *
   * Both halves of that are wrong, and the routines are twelve bytes each so
   * there is nowhere for the disagreement to hide. `On` (routine 80) writes
   * **4** and `Off` (routine 81) writes **8**; the readers take 4 as the
   * 12-bit path; and the extension's own init routine writes 4 as well — the
   * sequence at $1eba. So `On` sets the mode it was already in and `Off` is
   * the only way to reach 24-bit. Reproduced.
   *
   * "All AMCAF commands and functions" is wrong too: the flag is read from
   * exactly three addresses in the hunk, and they are these three functions.
   */
  it('DEFECT: Amcaf Aga Notation On and Off are the wrong way round', () => {
    // the default is 12-bit, which the manual gets right
    expect(run(['Print Red Val($1A5)']).out.trim()).toBe('1')
    expect(run(['Print Green Val($1A5)']).out.trim()).toBe('10')
    expect(run(['Print Blue Val($1A5)']).out.trim()).toBe('5')
    // "On" is a no-op -- it writes the 4 that was already there
    expect(run(['Amcaf Aga Notation On', 'Print Red Val($1A5)']).out.trim()).toBe('1')
    expect(run(['Amcaf Aga Notation On']).rt.amcaf.notationBits).toBe(4)
    // "Off" is what actually selects 24-bit
    expect(run(['Amcaf Aga Notation Off']).rt.amcaf.notationBits).toBe(8)
    expect(run(['Amcaf Aga Notation Off', 'Print Red Val($123456)']).out.trim()).toBe('18')
    expect(run(['Amcaf Aga Notation Off', 'Print Green Val($123456)']).out.trim()).toBe('52')
    expect(run(['Amcaf Aga Notation Off', 'Print Blue Val($123456)']).out.trim()).toBe('86')
    // Glue Colour does NOT consult the flag: `moveq #$f,d0` and an `and` per
    // gun, so it is always 12-bit
    expect(run(['Amcaf Aga Notation Off', 'Print Glue Colour(1,10,5)']).out.trim()).toBe(String(0x1a5))
    // routine 210 writes `$4a(a0)` of the CURRENT SCREEN, not a global:
    // `movea.l $52c(a5),a0 / andi.w #$3f,d0 / move.w d0,$4a(a0)`
    const sp = run(['Screen Open 0,64,32,4,Lowres', 'Set Sprite Priority 5'])
    expect(sp.rt.screens.get(0)!.spritePriority).toBe(5)
    // ...so two screens hold their own, which one global could not express
    const two = run(['Screen Open 0,64,32,4,Lowres', 'Set Sprite Priority 5',
      'Screen Open 1,64,32,4,Lowres', 'Set Sprite Priority 9'])
    expect([two.rt.screens.get(0)!.spritePriority, two.rt.screens.get(1)!.spritePriority]).toEqual([5, 9])
    // and the six-bit mask is the routine's own `andi.w #$3f`
    const m = run(['Screen Open 0,64,32,4,Lowres', 'Set Sprite Priority 255'])
    expect(m.rt.screens.get(0)!.spritePriority).toBe(0x3f)
  })
})

describe('slice 8: the effect engines', () => {
  const scr = ['Screen Open 0,64,32,16,Lowres', 'Cls 0']

  /**
   * Routine 223 is EIGHT bytes — `moveq #$6,d0 / move.l d0,-(a3)` and a branch
   * into the worker — so the plane count is a hardcoded SIX, not Shade Bob
   * Planes and not an argument. The token table agrees at `I0,0`. An earlier
   * pass gave it an optional third parameter and read the Shade Bob setting
   * when it was absent, which made Shade Bob Planes look like it applied here.
   *
   * The worker (224) is a ripple adder, not an arithmetic increment: per
   * plane, `btst` the bit, `bclr` and carry on if set, `bset` and stop if not.
   * The manual's "if the highest colour is reached, the colour is resetted to
   * be cycled" falls out of that, and so does the early stop — `move.l a0,d0 /
   * beq` bails on a null plane pointer, so a screen with fewer than six planes
   * carries only as far as it has.
   */
  it('Shade Pix always carries through six planes, whatever Shade Bob Planes says', () => {
    // Shade Bob Planes 2 does not bound it: 3 carries into plane 3
    const { rt } = run([...scr, 'Shade Bob Planes 2', 'Turbo Plot 5,5,3', 'Shade Pix 5,5'])
    expect(rt.screens.get(0)!.rp.point(5, 5)).toBe(4)
    const b = run([...scr, 'Turbo Plot 5,5,1', 'Shade Pix 5,5'])
    expect(b.rt.screens.get(0)!.rp.point(5, 5)).toBe(2)
    // the screen's own depth is the real limit: 15 on four planes runs out
    const c = run([...scr, 'Turbo Plot 5,5,15', 'Shade Pix 5,5'])
    expect(c.rt.screens.get(0)!.rp.point(5, 5)).toBe(0)
    // a third argument does not parse
    expect(() => run([...scr, 'Shade Pix 5,5,2'])).toThrow(/syntax/)
  })

  it('Shade Bob Planes is bounded 1..6, as the manual states', () => {
    expect(run([...scr, 'Shade Bob Planes 6']).rt.amcaf.shadePlanes).toBe(6)
    expect(() => run([...scr, 'Shade Bob Planes 0'])).toThrow(/Illegal function call/)
    expect(() => run([...scr, 'Shade Bob Planes 7'])).toThrow(/Illegal function call/)
  })

  /*
   * Routines 286 ($6644) and 287 ($67e2) differ in exactly one instruction.
   * Both do `eor.w d1,d0 / move.w d0,(a1)` for the sum bit; Up then propagates
   * `and.w d2,d1` against the OLD word and Down `and.w d0,d1` against the NEW
   * one, which is a carry and a borrow. `dbra d5` over Shade Bob Planes planes
   * means it wraps within them and leaves the planes above alone.
   */
  const stamp = [...scr, 'Ink 1 : Bar 0,0 To 15,15', 'Get Bob 1,0,0 To 16,16', 'Cls 0']

  it('Shade Bob Up is a ripple carry that wraps inside Shade Bob Planes', () => {
    const { rt } = run([
      ...stamp,
      'Shade Bob Planes 2',
      'Plot 32,20,0 : Plot 33,20,3 : Plot 34,20,7 : Plot 35,20,15',
      'Shade Bob Up 0,32,20,1',
    ])
    const rp = rt.screens.get(0)!.rp
    expect(rp.point(32, 20)).toBe(1) // 0 -> 1
    expect(rp.point(33, 20)).toBe(0) // 3 wraps to 0 within two planes
    expect(rp.point(34, 20)).toBe(4) // 7 wraps to 4: plane 2 is untouched
    expect(rp.point(35, 20)).toBe(12) // and 15 keeps planes 2 and 3
  })

  it('Shade Bob Down is the same loop borrowing instead of carrying', () => {
    const { rt } = run([
      ...stamp,
      'Shade Bob Planes 2',
      'Plot 32,20,0 : Plot 33,20,3 : Plot 34,20,4 : Plot 35,20,15',
      'Shade Bob Down 0,32,20,1',
    ])
    const rp = rt.screens.get(0)!.rp
    expect(rp.point(32, 20)).toBe(3) // 0 borrows round to 3
    expect(rp.point(33, 20)).toBe(2)
    expect(rp.point(34, 20)).toBe(7) // 4 -> 7, the high plane held
    expect(rp.point(35, 20)).toBe(14)
  })

  it('Shade Bob clips to the screen rather than running into the next row', () => {
    // the routine drops whole words off either edge and barrel-shifts the rest
    // ($67a0), which comes to an exact clip; nothing spills into row+1
    const { rt } = run([
      ...stamp,
      'Shade Bob Planes 4',
      'Plot 63,20,5 : Plot 0,21,5',
      'Shade Bob Up 0,56,20,1', // 56..71 across a 64-wide screen
    ])
    const rp = rt.screens.get(0)!.rp
    expect(rp.point(63, 20)).toBe(6)
    expect(rp.point(0, 21)).toBe(5)
  })

  /*
   * DEFECT: routine 384 ($a7c6) reads the two hot spot words alike and then
   * sign-extends only one of them -- `move.w $6(a1),d0 / ext.w d0` for X
   * against a plain `move.w $8(a1),d0` for Y. $a80c really is 48 80.
   */
  it('Shade Bob truncates the hot spot X to a signed byte, and not the Y', () => {
    // 130 reads back as -126, so the stamp lands at 130+126 = 256, off a
    // 64-wide screen, where the honest reading would put it at x=0
    const bad = run([...stamp, 'Hot Spot 1,130,0', 'Plot 0,20,5', 'Shade Bob Up 0,130,20,1'])
    expect(bad.rt.screens.get(0)!.rp.point(0, 20)).toBe(5)
    // one below the byte's edge and it behaves: 130-127 = 3
    const ok = run([...stamp, 'Hot Spot 1,127,0', 'Plot 3,20,5', 'Shade Bob Up 0,130,20,1'])
    expect(ok.rt.screens.get(0)!.rp.point(3, 20)).toBe(6)
    // the Y is a whole word, so 130 there is just 130 and moves the stamp up
    const y = run([...stamp, 'Hot Spot 1,0,130', 'Plot 4,20,5', 'Shade Bob Up 0,4,150,1'])
    expect(y.rt.screens.get(0)!.rp.point(4, 20)).toBe(6)
  })

  it('Pix Shift wraps within c1..c2 where Pix Brighten stops at the top', () => {
    // this pair is the whole distinction the manual draws: Shade Bobs cannot
    // "limit the colours to a certain range", the Pix commands can
    const setup = [...scr, 'Turbo Plot 2,2,5']
    const wrap = run([...setup, 'Pix Shift Up 0,3,5,0,0 To 9,9'])
    expect(wrap.rt.screens.get(0)!.rp.point(2, 2)).toBe(3) // 5 wraps to 3
    const stop = run([...setup, 'Pix Brighten 0,3,5,0,0 To 9,9'])
    expect(stop.rt.screens.get(0)!.rp.point(2, 2)).toBe(5) // stays at the top
    const down = run([...setup, 'Pix Darken 0,3,5,0,0 To 9,9'])
    expect(down.rt.screens.get(0)!.rp.point(2, 2)).toBe(4)
  })

  it('a colour outside c1..c2 is "not affected"', () => {
    const { rt } = run([...scr, 'Turbo Plot 2,2,1', 'Pix Shift Up 0,3,5,0,0 To 9,9'])
    expect(rt.screens.get(0)!.rp.point(2, 2)).toBe(1)
  })

  it('Make Pix Mask grabs a region, and Pix Shift honours it', () => {
    const { rt } = run([
      ...scr,
      'Turbo Plot 0,0,1', // one set pixel inside the mask region
      'Make Pix Mask 0,0,0 To 3,3,9',
      'Cls 0',
      'Ink 5 : Bar 0,0 To 3,3',
      'Pix Shift Up 0,0,15,0,0 To 3,3,9',
    ])
    const s = rt.screens.get(0)!
    // `move.w d6,d2 / mulu.w d7,d2` sizes the bank from the extents BEFORE
    // the subq pair turns them into dbra counts, so 0,0 To 3,3 is 3x3
    expect(rt.memBanks.get(9)!.data.length).toBe(9)
    expect(s.rp.point(0, 0)).toBe(6) // masked in: shifted
    expect(s.rp.point(1, 1)).toBe(5) // masked out: untouched
  })

  /**
   * `movea.l (a2),a2` takes the FIRST plane pointer and `btst.l d4,(a2,d3.l)`
   * tests that one bit, so the mask is bitplane 0 and not the pixel value —
   * a colour of 2 has plane 0 clear and does not mask in, where an earlier
   * pass's `point(x,y) > 0` said it did.
   */
  it('Make Pix Mask reads bitplane 0 only, not the pixel value', () => {
    const { rt } = run([
      ...scr,
      'Turbo Plot 0,0,1', // plane 0 alone
      'Turbo Plot 1,0,2', // plane 1 alone — plane 0 is clear
      'Turbo Plot 2,0,3', // both planes
      'Make Pix Mask 0,0,0 To 4,1,9',
    ])
    const b = rt.memBanks.get(9)!
    expect(Array.from(b.data)).toEqual([1, 0, 1, 0])
    expect(b.name).toBe('Pix Mask') // the literal at $5252, not "PixMask "
  })

  /**
   * "These coordinates must be given as block positions, that means that
   * position 1,4 corresponds to the screen coordinates 16,64."
   *
   * The bank format is PLANAR, which an earlier pass had as chunky. Routine
   * 270's opening reads two header words — the tile COUNT and `planes - 1` —
   * then `lsl.l #$5,d7` and a `dbra` accumulation, which makes a tile 32 bytes
   * per plane (sixteen rows of one word) with its planes contiguous. The paste
   * is an unrolled `movem.w (a1)+` into the screen's own plane pointers, so it
   * is opaque: no mask, no write mode.
   */
  it('Paste Ptile reads a PLANAR tile bank with a two-word header', () => {
    const { rt } = run([
      ...scr,
      'Reserve As Work 4,512',
      // word 0 = one tile, word 1 = planes - 1 = 0, so a single bitplane
      'Doke Start(4),1 : Doke Start(4)+2,0',
      // the tile's first row: bits 15 and 14 of plane 0
      'Doke Start(4)+4,$C000',
      'Ptile Bank 4',
      'Paste Ptile 1,0,0',
    ])
    const s = rt.screens.get(0)!
    expect(s.rp.point(16, 0)).toBe(1)
    expect(s.rp.point(17, 0)).toBe(1)
    expect(s.rp.point(18, 0)).toBe(0)
    // the tile number is bounded by the header's count
    expect(() =>
      run([...scr, 'Reserve As Work 4,512', 'Doke Start(4),1', 'Ptile Bank 4', 'Paste Ptile 0,0,1']),
    ).toThrow(/Illegal function call/)
  })
})

describe('slice 9: Splinters and Td Stars', () => {
  const scr = ['Screen Open 0,64,32,16,Lowres', 'Cls 0']

  /** the bank as words, which is how all three routines address it */
  const bankWords = (rt: { memBanks: Map<number, { data: Uint8Array }> }, n: number) => {
    const d = rt.memBanks.get(n)!.data
    return { len: d.length, w: (at: number): number => (d[at]! << 8) | d[at + 1]! }
  }

  /**
   * Routine 94 ($33e6): `lsl.l #$2,d2 / addq.l #$8,d2` then Reserve, and the
   * header it writes is `move.w d7,(a0)+ / clr.w (a0)+ / moveq #$8,d0 /
   * move.l d0,(a0)` — count, cursor, and the offset of the first entry. An
   * earlier pass reserved count*4 and wrote no header at all.
   */
  it('Coords Bank reserves an eight-byte header and initialises it', () => {
    const { rt } = run([...scr, 'Coords Bank 4,100'])
    const { len, w } = bankWords(rt, 4)
    expect(len).toBe(8 + 100 * 4)
    expect(w(0)).toBe(100) // the count, which Coords Read reads as its limit
    expect(w(2)).toBe(0) // the cursor
    expect((w(4) << 16) | w(6)).toBe(8) // the offset of the first entry
    expect(rt.memBanks.get(4)!.name).toBe('Coords  ')
  })

  /** `move.l (a3)+,d2 / Rbeq routine 390` — a count of zero, before anything */
  it('Coords Bank refuses a count of zero', () => {
    expect(() => run([...scr, 'Coords Bank 4,0'])).toThrow(/illegal function call/i)
  })

  /**
   * Routine 93 ($33d4) is eighteen bytes that resolve the bank and store the
   * pointer: "the existing bank will only be switched to without erasing it.
   * So you can jump between predefined banks."
   */
  it('Coords Bank without a count does not erase the bank', () => {
    const { rt } = run([
      ...scr,
      'Turbo Plot 1,1,5',
      'Coords Bank 4,100',
      'Coords Read 0,0,0,0 To 9,9,4,0',
      'Coords Bank 4',
    ])
    expect(bankWords(rt, 4).w(0)).toBe(1) // the count Coords Read left
  })

  it('Coords Read fills the bank behind its header, in sixteenths of a pixel', () => {
    const { rt } = run([
      ...scr,
      'Turbo Plot 1,1,5',
      'Turbo Plot 2,2,6',
      'Coords Bank 4,100',
      'Coords Read 0,0,0,0 To 9,9,4,0',
    ])
    const { w } = bankWords(rt, 4)
    expect(w(0)).toBe(2) // the count found, replacing the limit
    expect(w(2)).toBe(0) // the cursor, which only routine 385 moves
    expect([w(8), w(10)]).toEqual([1 << 4, 1 << 4])
    expect([w(12), w(14)]).toEqual([2 << 4, 2 << 4])
  })

  /**
   * `cmp.w (a0),d3 / beq $34fa` re-reads the bank's first word every hit, so
   * the count Coords Bank put there is a hard limit on the scan — and the
   * count written back at the end then becomes the NEXT read's limit.
   */
  it("Coords Read stops at the bank's count, which then limits the next read", () => {
    const prog = [...scr, 'Turbo Plot 1,1,5', 'Turbo Plot 2,2,6', 'Turbo Plot 3,3,7']
    const { rt } = run([...prog, 'Coords Bank 4,2', 'Coords Read 0,0,0,0 To 9,9,4,0'])
    expect(bankWords(rt, 4).w(0)).toBe(2) // three dots, room for two

    const { rt: rt2 } = run([
      ...prog,
      'Coords Bank 4,100',
      'Coords Read 0,0,0,0 To 2,2,4,0', // finds only (1,1)
      'Coords Read 0,0,0,0 To 9,9,4,0', // now capped at 1, not 100
    ])
    expect(bankWords(rt2, 4).w(0)).toBe(1)
  })

  /** the scanner is Count Pixels', so it carries the same two findings */
  it('Coords Read has an exclusive far corner and errors on an empty box', () => {
    const prog = [...scr, 'Turbo Plot 1,1,5', 'Turbo Plot 5,5,6', 'Coords Bank 4,100']
    // 0,0 To 5,5 covers x,y 0..4, so the dot at 5,5 is outside
    expect(bankWords(run([...prog, 'Coords Read 0,0,0,0 To 5,5,4,0']).rt, 4).w(0)).toBe(1)
    expect(bankWords(run([...prog, 'Coords Read 0,0,0,0 To 6,6,4,0']).rt, 4).w(0)).toBe(2)
    expect(() => run([...prog, 'Coords Read 0,0,5,5 To 5,9,4,0'])).toThrow(/illegal function call/i)
  })

  /**
   * `move.w (a7),d0 / bne $3504` — a non-zero mode SHUFFLES the finished
   * list, not "the scan order" an earlier pass assumed. The permutation
   * itself is driven by VHPOSR and cannot be pinned here (see the NOTE on the
   * handler: the modelled beam stands still inside a keyword), so what is
   * pinned is that the same coordinates come back in a different order.
   */
  it('Coords Read shuffles the list when mode is not zero', () => {
    const dots = ['Turbo Plot 1,1,5', 'Turbo Plot 2,2,5', 'Turbo Plot 3,3,5', 'Turbo Plot 4,4,5', 'Turbo Plot 5,5,5', 'Turbo Plot 6,6,5']
    const read = (mode: number): number[] => {
      const { rt } = run([...scr, ...dots, 'Coords Bank 4,100', `Coords Read 0,0,0,0 To 9,9,4,${mode}`])
      const { w } = bankWords(rt, 4)
      return Array.from({ length: w(0) }, (_, i) => w(8 + i * 4) >> 4)
    }
    const plain = read(0)
    const shuffled = read(1)
    expect(plain).toEqual([1, 2, 3, 4, 5, 6])
    expect([...shuffled].sort((a, b) => a - b)).toEqual(plain) // the same six
    expect(shuffled).not.toEqual(plain) // in a different order
  })

  /**
   * The 22-byte record routines 385 and 386 define. Everything the engine
   * knows about a splinter is in the bank, so the bank is what these tests
   * read — there is no parallel state to inspect.
   */
  const splinters = (rt: { memBanks: Map<number, { data: Uint8Array }> }, bank: number, count: number) => {
    const d = rt.memBanks.get(bank)!.data
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
    return Array.from({ length: count }, (_, i) => {
      const o = i * 22
      return {
        x: v.getInt16(o), y: v.getInt16(o + 2),
        idx: v.getUint32(o + 4), pidx: v.getUint32(o + 8),
        vx: v.getInt16(o + 12), vy: v.getInt16(o + 14),
        colour: v.getUint8(o + 16), back: v.getUint8(o + 17),
        pback: v.getUint8(o + 18), fresh: v.getUint8(o + 19),
        life: v.getUint16(o + 20),
      }
    })
  }

  /** two dots to lift, the bank to lift them into, and a table to lift them onto */
  const lift = [
    'Turbo Plot 3,3,7',
    'Turbo Plot 5,5,6',
    'Coords Bank 4,100',
    'Coords Read 0,0,0,0 To 9,9,4,0',
    'Splinters Bank 5,4',
    'Splinters Colour 0,4',
    'Splinters Limit',
    'Splinters Max -1',
    'Splinters Fuel 10',
    'Splinters Init',
  ]

  it('Splinters Bank reserves 22 bytes a splinter, as documented', () => {
    const { rt } = run([...scr, 'Splinters Bank 5,10'])
    expect(rt.memBanks.get(5)!.data.length).toBe(220)
  })

  /**
   * Routine 295 ($6a60) is thirty-six bytes: `moveq #$ff,d0` — which is -1 —
   * and `move.l d0,(a0)` over `+$10..+$13` of every record. It marks the table
   * FREE and does nothing else.
   *
   * An earlier pass read the manual's "the Splinters are fed with the
   * coordinates and speeds you specified" as a description of this call and
   * seeded a particle array from the coordinate bank here. That took every
   * coordinate at once, ignored Splinters Max, and never advanced the bank's
   * cursor — so the engine could not run out, which is the one thing the real
   * one does.
   */
  it('Splinters Init only marks the table free — it reads nothing', () => {
    const { rt } = run([...scr, 'Turbo Plot 3,3,7', 'Coords Bank 4,100', 'Coords Read 0,0,0,0 To 9,9,4,0',
      'Splinters Bank 5,3', 'Splinters Init'])
    for (const s of splinters(rt, 5, 3)) {
      expect([s.colour, s.back, s.pback, s.fresh]).toEqual([0xff, 0xff, 0xff, 0xff])
      // the coordinates, speeds and life are untouched — still the zeros
      // Reserve left, because Init never looks at them
      expect([s.x, s.y, s.idx, s.vx, s.vy, s.life]).toEqual([0, 0, 0, 0, 0, 0])
    }
    // and the coordinate bank's cursor has not moved: only routine 385 does that
    expect(bankWords(rt, 4).w(2)).toBe(0)
  })

  /** `movea.l $26a(a2),a0 / move.l a0,d0 / Rbeq routine 390` opens all nine routines */
  it('Splinters Init without a bank is an error', () => {
    expect(() => run([...scr, 'Splinters Init'])).toThrow(/illegal function call/i)
  })

  /**
   * Routine 385 ($a88a) is where a splinter gets its coordinates, and it is
   * reached from routine 386 when one is found FREE, DEAD or out of bounds —
   * never from Init. It hands out ONE coordinate and advances both the
   * cursor at `+2` of the bank and the byte offset at `+4`.
   */
  it('a Move spawns from the coordinate bank, one entry at a time', () => {
    const { rt } = run([...scr, ...lift, 'Splinters Move'])
    const s = splinters(rt, 5, 4)

    // two coordinates, two splinters, in the order Coords Read wrote them
    expect([s[0]!.x, s[0]!.y]).toEqual([3 << 4, 5 << 4].slice(0, 1).concat([3 << 4])) // 3,3
    expect([s[1]!.x, s[1]!.y]).toEqual([5 << 4, 5 << 4])
    // `move.l d0,$4(a0)` — the flat pixel index, on a 64-pixel-wide screen
    expect([s[0]!.idx, s[1]!.idx]).toEqual([3 * 64 + 3, 5 * 64 + 5])
    // `clr.b $10(a0) / st.b $13(a0) / st.b $11(a0)` and the fuel from $27e
    expect([s[0]!.colour, s[0]!.fresh, s[0]!.back, s[0]!.life]).toEqual([0, 0xff, 0xff, 10])
    // a speed each from VHPOSR, `andi.w #$3f` less $1f, so never zero-zero
    expect(s[0]!.vx).toBeGreaterThanOrEqual(-30)
    expect(s[0]!.vx).toBeLessThanOrEqual(32)

    // the list ran out, so the last two are marked dead rather than spawned
    expect([s[2]!.colour, s[2]!.back]).toEqual([0xff, 0xff])
    expect([s[3]!.colour, s[3]!.back]).toEqual([0xff, 0xff])

    // the bank's own cursor and offset are the engine's state, and they moved
    const { w } = bankWords(rt, 4)
    expect(w(2)).toBe(2)
    expect((w(4) << 16) | w(6)).toBe(8 + 2 * 4)
  })

  /**
   * `move.w $282(a2),d5` once per Move, and routine 385 decrements it — so
   * "the max. amount of new Splinters to appear on each step" is an allowance
   * shared by the whole table, not a per-splinter test.
   */
  it('Splinters Max caps the spawns in one Move', () => {
    const { rt } = run([...scr, ...lift.map((l) => (l === 'Splinters Max -1' ? 'Splinters Max 1' : l)), 'Splinters Move'])
    expect(bankWords(rt, 4).w(2)).toBe(1)
    const s = splinters(rt, 5, 4)
    expect(s[0]!.colour).toBe(0) // spawned
    expect(s[1]!.colour).toBe(0xff) // the allowance was gone
  })

  /**
   * Routine 301 ($6c74) reads the screen at `+$4` into `+$11`, and then:
   *
   *     cmpi.b #$ff,$13(a0) / bne next / move.b d5,$10(a0)
   *
   * A splinter freshly out of routine 385 has `+$13` set, so its first Back
   * is also where it takes its colour — "they don't destroy the background
   * and use the colour of the pixel they have removed". Nothing else in the
   * extension ever writes `+$10` to anything but 0 or $ff.
   */
  it('a fresh splinter takes its colour from the screen on the first Back', () => {
    const { rt } = run([...scr, ...lift, 'Splinters Move', 'Splinters Back'])
    const s = splinters(rt, 5, 4)
    expect([s[0]!.colour, s[0]!.back]).toEqual([7, 7])
    expect([s[1]!.colour, s[1]!.back]).toEqual([6, 6])
  })

  /**
   * The second pass of routine 298 ($6b0c onwards), which nothing in the
   * manual prepares you for: a splinter that has just been lifted leaves a
   * HOLE, and the hole is filled with `$27b(a2)` — the byte Splinters Colour
   * stored — once, on the first Del after the spawn.
   */
  it('Single Del punches the hole in Splinters Colour, once', () => {
    const prog = (bk: number): string[] => [
      ...scr, 'Turbo Plot 3,3,7', 'Coords Bank 4,100', 'Coords Read 0,0,0,0 To 9,9,4,0',
      'Splinters Bank 5,2', `Splinters Colour ${bk},4`, 'Splinters Limit', 'Splinters Max -1',
      'Splinters Fuel 10', 'Splinters Init', 'Splinters Move', 'Splinters Back', 'Splinters Draw',
      'Splinters Single Del',
    ]
    const black = run(prog(0))
    expect(black.rt.screens.get(0)!.rp.point(3, 3)).toBe(0)
    expect(splinters(black.rt, 5, 1)[0]!.fresh).toBe(0) // `clr.b $13(a0)` — only once

    const blue = run(prog(5))
    expect(blue.rt.screens.get(0)!.rp.point(3, 3)).toBe(5)
  })

  /**
   * Routines 296 and 297 ($6a84, $6a94) are sixteen bytes each: del, move,
   * back, draw. An earlier pass had Single Do as restore-move-draw and Double
   * Do as move-draw, on the reasoning that a double-buffered screen already
   * carries the last frame as its background; both routines disagree.
   *
   * `+$13` is what makes the two Dels different. Single clears it outright;
   * Double steps it `$ff -> 1 -> 0`, so the hole is punched into BOTH buffers
   * before the marker goes.
   */
  it('Single Do and Double Do are del-move-back-draw, and stage the spawn marker differently', () => {
    const base = [...scr, 'Ink 9 : Bar 0,0 To 19,19', 'Coords Bank 4,200',
      'Coords Read 0,0,0,0 To 2,2,4,0', 'Splinters Bank 5,8', 'Splinters Colour 0,4',
      'Splinters Limit', 'Splinters Max -1', 'Splinters Fuel 50', 'Splinters Init']

    // one Do spawns and draws; the marker is still $ff because Del ran first
    const one = run([...base, 'Splinters Single Do'])
    expect(splinters(one.rt, 5, 4).map((s) => s.fresh)).toEqual([0xff, 0xff, 0xff, 0xff])

    // the second Do's Del clears it, and the hole appears
    const two = run([...base, 'Splinters Single Do', 'Splinters Single Do'])
    expect(splinters(two.rt, 5, 4).map((s) => s.fresh)).toEqual([0, 0, 0, 0])

    // Double Del takes two passes to get there, one per buffer
    const dbl1 = run([...base, 'Splinters Double Do', 'Splinters Double Do'])
    expect(splinters(dbl1.rt, 5, 4).map((s) => s.fresh)).toEqual([1, 1, 1, 1])
    const dbl2 = run([...base, 'Splinters Double Do', 'Splinters Double Do', 'Splinters Double Do'])
    expect(splinters(dbl2.rt, 5, 4).map((s) => s.fresh)).toEqual([0, 0, 0, 0])
  })

  /**
   * `move.l $4(a0),$8(a0) / move.b $11(a0),$12(a0)` at the very top of routine
   * 386 — the two generations Double Del needs cost six bytes a splinter and
   * shift on every Move, whether or not the splinter goes anywhere.
   */
  it('a Move shifts the position and background into the previous generation', () => {
    const base = [...scr, 'Ink 9 : Bar 0,0 To 19,19', 'Coords Bank 4,200',
      'Coords Read 0,0,0,0 To 2,2,4,0', 'Splinters Bank 5,4', 'Splinters Colour 0,4',
      'Splinters Limit', 'Splinters Max -1', 'Splinters Fuel 50', 'Splinters Init']
    const cycle = ['Splinters Single Del', 'Splinters Move', 'Splinters Back', 'Splinters Draw']
    const before = splinters(run([...base, ...cycle, ...cycle]).rt, 5, 4)
    const after = splinters(run([...base, ...cycle, ...cycle, ...cycle]).rt, 5, 4)
    for (let i = 0; i < 4; i++) {
      expect(after[i]!.pidx, `${i}`).toBe(before[i]!.idx)
      expect(after[i]!.pback, `${i}`).toBe(before[i]!.back)
    }
  })

  /**
   * The arithmetic of routine 386, in the units it actually uses:
   *
   *     move.w (a0),d2 / add.w $c(a0),d2         x += vx
   *     move.w $276(a2),d2 / add.w d2,$c(a0)     vx += gravity, AFTER the move
   *
   * All of it is sixteenths of a pixel and all of it is a WORD, so
   * `Splinters Gravity 1,1` is a sixteenth of a pixel per step per step, not a
   * pixel — sixteen times gentler than whole-pixel arithmetic made it.
   */
  it('a Move adds the speed to the position and the gravity to the speed, in sixteenths', () => {
    // the dots start in the middle of the screen, because a splinter that
    // leaves the limit box respawns and its old position is gone
    const base = [...scr, 'Ink 9 : Bar 0,0 To 39,29', 'Coords Bank 4,200',
      'Coords Read 0,0,20,14 To 22,16,4,0', 'Splinters Bank 5,4', 'Splinters Colour 0,4',
      'Splinters Limit', 'Splinters Max -1', 'Splinters Fuel 50', 'Splinters Gravity 3,-2',
      'Splinters Init']
    const cycle = ['Splinters Single Del', 'Splinters Move', 'Splinters Back', 'Splinters Draw']
    const before = splinters(run([...base, ...cycle, ...cycle]).rt, 5, 4)
    const after = splinters(run([...base, ...cycle, ...cycle, ...cycle]).rt, 5, 4)
    for (let i = 0; i < 4; i++) {
      expect(after[i]!.x, `x${i}`).toBe(before[i]!.x + before[i]!.vx)
      expect(after[i]!.y, `y${i}`).toBe(before[i]!.y + before[i]!.vy)
      expect(after[i]!.vx, `vx${i}`).toBe(before[i]!.vx + 3)
      expect(after[i]!.vy, `vy${i}`).toBe(before[i]!.vy - 2)
    }
  })

  /**
   * Leaving the limit box does NOT delete a splinter — routine 386's four
   * clip tests all `Rbra routine 385`, the same respawn a dead one gets, which
   * is what makes an endless field endless.
   *
   * `Splinters Limit 0,0 To 0,0` is the deterministic way to prove it: the
   * high corner takes a `subq.l #$1` after the shift, so x2 is -1, and
   * `cmp.w $272(a2),d2 / bpl` puts EVERY position outside. The unsigned
   * `cmp.w d0,d2 / bhi` that orders the pair leaves it that way, because
   * $ffff is higher than 0.
   */
  it('leaving the limit respawns rather than deletes, and the list is what runs out', () => {
    const base = [...scr, 'Ink 9 : Bar 0,0 To 19,19', 'Coords Bank 4,4',
      'Coords Read 0,0,0,0 To 2,2,4,0', 'Splinters Bank 5,1', 'Splinters Colour 0,4',
      'Splinters Limit 0,0 To 0,0', 'Splinters Max -1', 'Splinters Fuel 50', 'Splinters Init']
    const cycles = (n: number): string[] => Array.from({ length: n }, () => 'Splinters Single Do').flat()

    const lim = run([...base]).rt.amcaf.splinters.limit
    expect(lim).toEqual({ x1: 0, y1: 0, x2: -1, y2: -1 })

    // one record, four coordinates: each cycle after the first hands out one more
    for (const [n, cursor] of [[1, 1], [2, 2], [3, 3], [4, 4]] as const) {
      expect(bankWords(run([...base, ...cycles(n)]).rt, 4).w(2), `${n} cycles`).toBe(cursor)
    }

    // the fifth finds the list exhausted and marks the splinter free
    const spent = run([...base, ...cycles(5)])
    expect(splinters(spent.rt, 5, 1)[0]!.colour).toBe(0xff)
  })

  /**
   * Routine 303 ($6d4a) counts a splinter unless ALL THREE colour bytes are
   * $ff — `cmp.w $10(a0),d0` covers `+$10` and `+$11` at once, then
   * `cmp.b $12(a0),d0`. So one routine 385 has just given up on still counts
   * for one more Move, which is exactly how long its pixels are still on the
   * screen. Counting the length of a particle array cannot express that.
   */
  it('Splinters Active counts the three colour bytes, not a list', () => {
    const base = [...scr, 'Ink 9 : Bar 0,0 To 19,19', 'Coords Bank 4,2',
      'Coords Read 0,0,0,0 To 2,2,4,0', 'Splinters Bank 5,2', 'Splinters Colour 0,4',
      'Splinters Limit 0,0 To 0,0', 'Splinters Max -1', 'Splinters Fuel 50', 'Splinters Init']
    const active = (extra: string[]): number =>
      Number(run([...base, ...extra, 'Print Splinters Active']).out.trim())

    expect(active([])).toBe(0) // straight after Init, all $ff
    expect(active(['Splinters Single Do'])).toBe(2) // both spawned
    // the second cycle moves them both out of the box, finds the two-entry
    // list already spent, and marks them free — `st.b $10 / st.b $11`. They
    // still COUNT, because `+$12` remembers the background from the frame
    // before and their pixels are still on the screen until the next Del.
    expect(active(['Splinters Single Do', 'Splinters Single Do'])).toBe(2)
    // the third Move shifts that $ff into `+$12` as well, and now all three
    // agree. One frame of grace, which counting a list cannot express.
    expect(active(Array.from({ length: 3 }, () => 'Splinters Single Do'))).toBe(0)
  })

  /**
   * "protect the graphics in higher bitplanes from the influences of Shade
   * Bobs" is the sister keyword's wording; here the same idea is `$27c(a2)`,
   * the `planes - 1` Splinters Colour stores, used as the `dbra` bound in
   * every one of the four drawing loops. Planes above it are never addressed.
   */
  it('Splinters Draw touches only the planes Splinters Colour named', () => {
    const prog = (planes: number): number => {
      const { rt } = run([...scr, 'Ink 15 : Bar 0,0 To 9,9', 'Turbo Plot 3,3,7',
        'Coords Bank 4,100', 'Coords Read 0,0,3,3 To 4,4,4,0', 'Splinters Bank 5,1',
        `Splinters Colour 0,${planes}`, 'Splinters Limit', 'Splinters Max -1',
        'Splinters Fuel 10', 'Splinters Init', 'Splinters Move', 'Splinters Back',
        'Splinters Single Del'])
      return rt.screens.get(0)!.rp.point(3, 3)
    }
    // the lifted pixel is 7. With all four planes the hole is colour 0 outright
    expect(prog(4)).toBe(0)
    // with two, planes 2 and 3 are never addressed, so 0b0111 keeps its top
    // bit and the hole reads back as 4 rather than 0
    expect(prog(2)).toBe(4)
  })

  /** the 12-byte record routines 387 and 388 define — no z, and no colour */
  const stars = (rt: { memBanks: Map<number, { data: Uint8Array }> }, bank: number, count: number) => {
    const d = rt.memBanks.get(bank)!.data
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
    return Array.from({ length: count }, (_, i) => {
      const o = i * 12
      return {
        x: v.getInt16(o), y: v.getInt16(o + 2),
        px: v.getInt16(o + 4), py: v.getInt16(o + 6),
        vx: v.getInt16(o + 8), vy: v.getInt16(o + 10),
      }
    })
  }

  const field = [
    'Td Stars Bank 6,8', 'Td Stars Planes 0,1', 'Td Stars Limit',
    'Td Stars Origin 32,16', 'Td Stars Init',
  ]

  it('Td Stars Bank reserves 12 bytes a star', () => {
    const { rt } = run([...scr, 'Td Stars Bank 6,20'])
    expect(rt.memBanks.get(6)!.data.length).toBe(240)
  })

  /**
   * Routine 308 ($6e46) spawns each star at the ORIGIN and then runs it
   * forward 0..31 steps with the same routine 388 that Td Stars Move uses —
   * "the stars are moved by random values to avoid that they all start in the
   * origin", which turns out to be literal.
   *
   * An earlier pass invented `z: 1 + (i % 64)` and two multiplicative
   * velocities here. There is no z in a 12-byte star.
   */
  it('Td Stars Init spawns at the origin and steps each star along its own track', () => {
    const { rt } = run([...scr, ...field])
    const s = stars(rt, 6, 8)
    // the step counts differ, so the stars end up strung out rather than
    // heaped at the origin
    expect(new Set(s.map((q) => `${q.x},${q.y}`)).size).toBeGreaterThan(1)
    // with a limit box nothing can be inside, every spawn leaves immediately
    // and respawns, so Init leaves every star exactly at the origin — which
    // is stored in sixty-fourths and copied in by one `move.l`
    const out = stars(run([...scr, 'Td Stars Bank 6,8', 'Td Stars Planes 0,1',
      'Td Stars Limit 1000,1000 To 1001,1001', 'Td Stars Origin 32,16', 'Td Stars Init']).rt, 6, 8)
    for (const q of out) expect([q.x, q.y]).toEqual([32 * 64, 16 * 64])
    // routine 387 refuses a star whose two speeds add to less than sixteen
    // sixty-fourths, so none of them crawls
    for (const q of s) expect(Math.abs(q.vx) + Math.abs(q.vy)).toBeGreaterThanOrEqual(15)
  })

  /**
   * Routine 388's acceleration is MULTIPLICATIVE — `move.w d2,d0 / lsr.w
   * #$4,d0 / add.w d0,d2`, so v * 17/16 a step. Compounding is what makes a
   * star appear to rush past; an earlier pass added a constant to a `z`,
   * which grows linearly.
   */
  it('Td Stars Accelerate multiplies the speed by 17/16 a step', () => {
    const base = [...scr, 'Td Stars Bank 6,1', 'Td Stars Planes 0,1', 'Td Stars Limit',
      'Td Stars Origin 32,16', 'Td Stars Init']
    const before = stars(run([...base]).rt, 6, 1)[0]!
    const off = stars(run([...base, 'Td Stars Move']).rt, 6, 1)[0]!
    const on = stars(run([...base, 'Td Stars Accelerate On', 'Td Stars Move']).rt, 6, 1)[0]!
    // with Accelerate off the speed is untouched (no gravity is set)
    expect(off.vx).toBe(before.vx)
    // with it on, a positive speed gains v>>4 and a negative one loses it
    const grow = (v: number): number => (v >= 0 ? v + (v >> 4) : v - ((~v & 0xffff) >>> 4))
    expect(on.vx).toBe(grow(before.vx))
    expect(on.vy).toBe(grow(before.vy))
  })

  /**
   * `move.l (a0),$4(a0)` at the top of routine 388 — the previous position,
   * saved as one long, which is all Double Del needs.
   */
  it('a Move saves the position Double Del will clear', () => {
    const base = [...scr, ...field]
    const before = stars(run(base).rt, 6, 8)
    const after = stars(run([...base, 'Td Stars Move']).rt, 6, 8)
    for (let i = 0; i < 8; i++) {
      expect(after[i]!.px, `${i}`).toBe(before[i]!.x)
      expect(after[i]!.py, `${i}`).toBe(before[i]!.y)
    }
  })

  /**
   * Routine 319 draws a star's BRIGHTNESS from its speed, across the two
   * planes Td Stars Planes named:
   *
   *     |vx| + |vy| >> 6   >= 3  -> both planes
   *                        >= 2  -> plane B alone
   *                        else  -> plane A alone
   *
   * which is why the keyword takes two plane NUMBERS and refuses a screen
   * with fewer than four colours. An earlier pass drew every star as a solid
   * `(1 << planes) - 1` and had no brightness at all.
   */
  it('Td Stars Draw spreads a star over two planes by its speed', () => {
    // one star, no acceleration, a limit box wide enough that it survives
    const seen = new Set<number>()
    for (let n = 1; n <= 12; n++) {
      const { rt } = run([
        'Screen Open 0,320,64,16,Lowres', 'Cls 0',
        'Td Stars Bank 6,24', 'Td Stars Planes 0,1', 'Td Stars Limit',
        'Td Stars Origin 160,32', 'Td Stars Accelerate On', 'Td Stars Init',
        `For I=1 To ${n} : Td Stars Move : Next I`, 'Td Stars Draw',
      ])
      const px = rt.screens.get(0)!.rp
      for (let y = 0; y < 64; y++) for (let x = 0; x < 320; x++) {
        const c = px.point(x, y)
        if (c > 0) seen.add(c & 3)
      }
    }
    // all three brightnesses appear: plane 0 alone, plane 1 alone, and both
    expect([...seen].sort()).toEqual([1, 2, 3])
  })

  /** `add.w d1,d1` twice — the plane numbers are stored MULTIPLIED BY FOUR */
  it('Td Stars Planes keeps the plane offsets, not a count', () => {
    const { rt } = run([...scr, 'Td Stars Bank 6,4', 'Td Stars Planes 1,3'])
    expect([rt.amcaf.stars.planeA, rt.amcaf.stars.planeB]).toEqual([4, 12])
    // and each is bounded against the screen's own depth
    expect(() => run([...scr, 'Td Stars Bank 6,4', 'Td Stars Planes 0,4'])).toThrow(/illegal function call/i)
  })

  /**
   * DEFECT: Td Stars Limit silently overwrites Td Stars Origin, and the
   * explicit form computes the replacement wrongly.
   *
   * Routine 307 (Td Stars Origin) stores its pair at $256/$258. Routine 305
   * (the bare Limit) writes a LONGWORD to $256 — the same two words — so a
   * limit re-centres the field. Routine 306 (the `x1,y1 To x2,y2` form) then
   * derives that centre as
   *
   *     add.w d1,d0 / lsr.w #1,d0     ->  $256 = (x1 + y1) / 2
   *     add.w d3,d2 / lsr.w #1,d2     ->  $258 = (x2 + y2) / 2
   *
   * which averages x against y instead of each axis against its own pair.
   * Byte-identical in 1.50, so it survived every release. Nothing in the
   * manual mentions that Limit touches the origin at all.
   */
  it('Td Stars Limit clobbers the origin, and the explicit form mixes the axes', () => {
    // Everything below is in SIXTY-FOURTHS, which is what the engine stores.
    // The bare form re-centres on the screen, discarding an earlier Origin,
    // and takes the true middle: `move.w d0,d1` BEFORE the `subq`, then
    // `lsr.w #$1,d1`. On a 64x32 screen that is 64*64/2 and 32*64/2.
    const bare = run([...scr, 'Td Stars Bank 6,20', 'Td Stars Origin 5,7', 'Td Stars Limit'])
    expect([bare.rt.amcaf.stars.ox, bare.rt.amcaf.stars.oy]).toEqual([2048, 1024])

    // the explicit form: 10,20 To 40,30 should centre on (25,25) — 1600,1600.
    // It gives ((640+1280)/2, (2559+1919)/2) = (960,2239), and the second is
    // off the rectangle entirely and below the screen.
    const expl = run([...scr, 'Td Stars Bank 6,20', 'Td Stars Origin 5,7', 'Td Stars Limit 10,20 To 40,30'])
    expect([expl.rt.amcaf.stars.ox, expl.rt.amcaf.stars.oy]).toEqual([960, 2239])

    // ordering the call the other way round keeps the origin, which is the
    // only way to get the one you asked for
    const ok = run([...scr, 'Td Stars Bank 6,20', 'Td Stars Limit', 'Td Stars Origin 5,7'])
    expect([ok.rt.amcaf.stars.ox, ok.rt.amcaf.stars.oy]).toEqual([5 * 64, 7 * 64])
  })

  /**
   * The rest of the two engines' surface, each dispatched against its routine:
   * Splinters Limit/Max (291-292/289), Splinters Double Do/Del (297/299), and
   * Td Stars Gravity (309, two words at $25a/$25c), Accelerate Off (311, a
   * `clr.w $25e`), Single/Double Do (313/314 — del, move, draw, and NO back
   * step, unlike the Splinters pair) and Double Del (316).
   *
   * Splinters Limit's four corners are stored in SIXTEENTHS (`lsl.w #$4`)
   * with one taken off the high pair, so `2,3 To 20,15` is 32,48 To 319,239.
   */
  it('the rest of the two engines dispatch and hold their state', () => {
    const sp = run([...scr, 'Splinters Bank 5,10', 'Splinters Limit 2,3 To 20,15', 'Splinters Max 7'])
    expect(sp.rt.amcaf.splinters.limit).toEqual({ x1: 32, y1: 48, x2: 319, y2: 239 })
    expect(sp.rt.amcaf.splinters.maxNew).toBe(7)

    // Double Do and Double Del run without a prior generation to restore
    expect(() =>
      run([...scr, 'Coords Bank 4,4', 'Splinters Bank 5,10', 'Splinters Init',
        'Splinters Double Do', 'Splinters Double Del']),
    ).not.toThrow()

    const st = run([
      ...scr,
      'Td Stars Bank 6,10',
      'Td Stars Init',
      'Td Stars Gravity 2,-3',
      'Td Stars Accelerate On',
      'Td Stars Accelerate Off',
    ])
    expect([st.rt.amcaf.stars.gx, st.rt.amcaf.stars.gy]).toEqual([2, -3])
    // NOTE the asymmetry: routine 310 is `st.b $25e(a2)`, which writes $ff to
    // the HIGH byte, and routine 311 is `clr.w`, which clears both
    expect(st.rt.amcaf.stars.accelerate).toBe(0)
    const on = run([...scr, 'Td Stars Bank 6,10', 'Td Stars Accelerate On'])
    expect(on.rt.amcaf.stars.accelerate).toBe(0xff00)

    // the Do pair is del + move + draw — three calls, where Splinters has four
    expect(() =>
      run([...scr, 'Td Stars Bank 6,10', 'Td Stars Planes 0,1', 'Td Stars Limit', 'Td Stars Init',
        'Td Stars Single Do', 'Td Stars Double Do']),
    ).not.toThrow()
    expect(() => run([...scr, 'Td Stars Bank 6,10', 'Td Stars Planes 0,1', 'Td Stars Limit',
      'Td Stars Init', 'Td Stars Double Del'])).not.toThrow()
  })

  /**
   * A star that leaves the limit box is RESPAWNED at the origin by routine
   * 388's `Rbra routine 387`, which is what "as soon as they have left the
   * screen" means — the field never empties and never escapes.
   */
  it('Td Stars Move recycles a star that leaves the limit', () => {
    const { rt } = run([...scr, ...field, 'Td Stars Accelerate On',
      'For I=1 To 60 : Td Stars Move : Next I'])
    for (const q of stars(rt, 6, 8)) {
      expect(q.x >> 6).toBeGreaterThanOrEqual(0)
      expect(q.x >> 6).toBeLessThan(64)
      expect(q.y >> 6).toBeGreaterThanOrEqual(0)
      expect(q.y >> 6).toBeLessThan(32)
    }
  })

  /**
   * DEFECT: the indexed form of Td Stars Move has the wrong stride. Routine
   * 318 ($6ffc) bounds the index correctly against `$264(a2)` and then does
   *
   *     lsl.w #$4, d0 / adda.w d0, a0
   *
   * multiplying it by SIXTEEN where a star is TWELVE bytes -- routine 304
   * sizes the bank with `mulu.w #$c` and every other loop steps `lea
   * $c(a0),a0`. So only index 0 addresses a whole star; index 1 lands four
   * bytes in, and moves a record made of star 1's speeds and star 2's
   * position. Reproduced.
   */
  it('Td Stars Move n uses a stride of sixteen for a twelve-byte star', () => {
    const base = [...scr, ...field]
    const before = stars(run(base).rt, 6, 8)
    const after = stars(run([...base, 'Td Stars Move 1']).rt, 6, 8)
    // star 1 proper is untouched: its own record starts at byte 12
    expect(after[1]!.x).toBe(before[1]!.x)
    // ...but bytes 16..27 moved, which is the tail of star 1 and the head of 2
    expect(after.map((q) => q.px)).not.toEqual(before.map((q) => q.px))
    // index 0 is the one that works
    const zero = stars(run([...base, 'Td Stars Move 0']).rt, 6, 8)
    expect(zero[0]!.px).toBe(before[0]!.x)
  })

  /**
   * Both Bank keywords check the COUNT and not the bank number: `move.l
   * (a3)+,d2 / Rbeq routine 390` refuses a zero amount before anything else.
   * The per-entry sizes are `mulu.w #$16` for a splinter and `mulu.w #$c` for
   * a star, and the eight-character bank names are literals in the binary —
   * "Splinter" and "Stars   ", where the port had invented "TdStars ".
   *
   * Splinters Colour bounds its plane count against the CURRENT SCREEN rather
   * than against six: `move.w $50(a1),d0 / subq.w #$1,d2 / cmp.w d2,d0 /
   * Rble routine 390`.
   */
  it('the Bank keywords refuse a zero count and name their banks from the binary', () => {
    expect(() => run([...scr, 'Splinters Bank 5,0'])).toThrow(/Illegal function call/)
    expect(() => run([...scr, 'Td Stars Bank 6,0'])).toThrow(/Illegal function call/)
    const { rt } = run([...scr, 'Splinters Bank 5,4', 'Td Stars Bank 6,4'])
    expect(rt.memBanks.get(5)!.name).toBe('Splinter')
    expect(rt.memBanks.get(6)!.name).toBe('Stars   ')
    // 22 bytes a splinter, 12 a star
    expect(rt.memBanks.get(5)!.data.length).toBe(4 * 22)
    expect(rt.memBanks.get(6)!.data.length).toBe(4 * 12)
  })

  it('Splinters Colour bounds its plane count by the screen depth', () => {
    expect(() => run([...scr, 'Splinters Colour 0,5'])).toThrow(/Illegal function call/)
    expect(() => run([...scr, 'Splinters Colour 0,4'])).not.toThrow()
    // a two-colour screen only has room for one
    const two = ['Screen Open 0,64,32,2,Lowres', 'Cls 0']
    expect(() => run([...two, 'Splinters Colour 0,2'])).toThrow(/Illegal function call/)
    expect(() => run([...two, 'Splinters Colour 0,1'])).not.toThrow()
  })

  /**
   * Td Stars Planes takes TWO plane numbers, not a count — token spec `I0,0`,
   * and routine 312 pops two and bounds each against the screen's depth
   * (`cmp.w dN,d0 / Rble routine 390`), storing each times four. Its opening
   * depth check is the clearest use of AMCAF's own message table anywhere:
   * `cmp.w #$2,d0 / bge` else `moveq #$f,d0 / Rbra routine 397`, and message
   * fifteen is "At least 4 colours required in screen".
   */
  it('Td Stars Planes takes two plane numbers and needs four colours', () => {
    const two = ['Screen Open 0,64,32,2,Lowres', 'Cls 0'] // depth 1
    expect(() => run([...two, 'Td Stars Planes 0,0'])).toThrow(/At least 4 colours required/)
    // each plane number must be below the screen's depth
    expect(() => run([...scr, 'Td Stars Planes 0,4'])).toThrow(/Illegal function call/)
    expect(() => run([...scr, 'Td Stars Planes 4,0'])).toThrow(/Illegal function call/)
    expect(() => run([...scr, 'Td Stars Planes 0,3'])).not.toThrow()
    // and a single argument does not parse
    expect(() => run([...scr, 'Td Stars Planes 2'])).toThrow(/expected ","/)
  })

  it('Td Stars Draw marks the screen and Single Del clears it again', () => {
    const { rt } = run([
      ...scr,
      'Td Stars Bank 6,4',
      'Td Stars Planes 0,3',
      'Td Stars Origin 32,16',
      'Td Stars Init',
      'Td Stars Draw',
    ])
    expect(rt.screens.get(0)!.rp.point(32, 16)).toBeGreaterThan(0)
    const cleared = run([
      ...scr,
      'Td Stars Bank 6,4',
      'Td Stars Origin 32,16',
      'Td Stars Init',
      'Td Stars Draw',
      'Td Stars Single Del',
    ])
    expect(cleared.rt.screens.get(0)!.rp.point(32, 16)).toBe(0)
  })
})

describe('slice 10: vectors and the extension internals', () => {
  const p = (expr: string): string => run([`Print ${expr}`]).out.trim()

  /**
   * Routine 373 ($84e4) reads ONLY the nine-word matrix at $31e. Nothing else
   * in the extension writes that matrix, and the extension's block arrives
   * from `AllocMem #$10001` — MEMF_CLEAR. So a program that never calls
   * Vec Rot Precalc projects every point through nine zeros: the rotated z is
   * zero, `tst.w d5 / Rbeq routine 390` fires, and the program STOPS.
   *
   * An earlier pass made Precalc a no-op and recomputed from the angles on
   * every call, and wrote a test asserting that it "changes no answer, which
   * is why it can be a no-op". It changes every answer, including whether
   * there is one.
   */
  it('Vec Rot without a Precalc projects through the zero matrix, and errors', () => {
    expect(() => run(['Vec Rot Angles 0,0,0', 'Vec Rot Pos 0,0,0', 'Print Vec Rot X(100,50,256)']))
      .toThrow(/illegal function call/i)
    // a Vec Rot Pos with a non-zero z keeps the divide alive, and every point
    // then collapses onto the position, because the matrix contributes nothing
    const { out } = run([
      'Vec Rot Angles 0,0,0 : Vec Rot Pos 7,9,256',
      'A=Vec Rot X(100,50,300)',
      'Print A;",";Vec Rot Y;",";Vec Rot Z',
    ])
    expect(out.trim().replace(/\s+/g, '')).toBe('7,9,256')
  })

  /** with the matrix built, an identity rotation is a plain perspective divide */
  it('Vec Rot Precalc builds the matrix the projection runs on', () => {
    const { out } = run([
      'Vec Rot Angles 0,0,0 : Vec Rot Pos 0,0,0 : Vec Rot Precalc',
      'A=Vec Rot X(100,50,256)',
      'Print A;",";Vec Rot Y;",";Vec Rot Z',
    ])
    /*
     * DEFECT: the arguments reach the matrix BACKWARDS, so this is the
     * projection of (256, 50, 100) rather than (100, 50, 256).
     *
     * `(a3)+` pops the last argument first — the order Qcos depends on when
     * it adds a quarter turn to `$6(a3)` — and the first pop is what
     * multiplies `$31e`, the first COLUMN, which routine 4 builds as
     * `c1*c2`. With zero angles the matrix is diag(254, -254, 254), so:
     *
     *     X = z*254 / dist = 256*254 / 99  = 656
     *     Y = y*-254 / dist = 50*-254 / 99 = -128
     *     dist = x*254 >> 8, rounded      = 99
     *
     * The Y sign is the `neg.w d3` in routine 4's second row, also faithful.
     */
    expect(out.trim().replace(/\s+/g, '')).toBe('656,-128,99')
  })

  /**
   * The consequence a program can actually trip over: changing the angles
   * changes NOTHING until the next Precalc.
   */
  it('Vec Rot Angles has no effect until the next Precalc', () => {
    const before = run([
      'Vec Rot Pos 0,0,0 : Vec Rot Angles 0,0,0 : Vec Rot Precalc',
      'Print Vec Rot X(256,0,256)',
    ]).out.trim()
    const stale = run([
      'Vec Rot Pos 0,0,0 : Vec Rot Angles 0,0,0 : Vec Rot Precalc',
      'Vec Rot Angles 0,0,256',
      'Print Vec Rot X(256,0,256)',
    ]).out.trim()
    const fresh = run([
      'Vec Rot Pos 0,0,0 : Vec Rot Angles 0,0,0 : Vec Rot Precalc',
      'Vec Rot Angles 0,0,256 : Vec Rot Precalc',
      'Print Vec Rot X(256,0,256)',
    ]).out.trim()
    expect(stale).toBe(before)
    expect(fresh).not.toBe(before)
  })

  /** `add.w d0,d0` — the angles are kept DOUBLED, as table byte offsets */
  it('Vec Rot Angles masks to 1023 and doubles', () => {
    const { rt } = run(['Vec Rot Angles 1,2,3'])
    // and the LAST argument lands at $306, which is angA
    expect([rt.amcaf.vec.angA, rt.amcaf.vec.angB, rt.amcaf.vec.angC]).toEqual([6, 4, 2])
    const wrap = run(['Vec Rot Angles 1024,1025,-1'])
    expect(wrap.rt.amcaf.vec.angC).toBe(0)
    expect(wrap.rt.amcaf.vec.angB).toBe(2)
    expect(wrap.rt.amcaf.vec.angA).toBe(1023 * 2)
  })

  it('the bare form reads the cache the three-argument form filled', () => {
    // "If you call the function with the parameters x,y,z all three new
    // coordinates are calculated, i.e the y,z position too"
    const { out } = run([
      'Vec Rot Angles 0,0,0 : Vec Rot Pos 0,0,0 : Vec Rot Precalc',
      'A=Vec Rot X(40,80,256)',
      'Print Vec Rot X;",";Vec Rot Y',
    ])
    // again through the reversed argument order: (256, 80, 40) projected
    expect(out.trim().replace(/\s+/g, '')).toBe('1625,-508')
  })

  it('a quarter turn about the first angle swaps the axes', () => {
    const { out } = run([
      'Vec Rot Pos 0,0,0',
      'Vec Rot Angles 0,0,256 : Vec Rot Precalc',
      'A=Vec Rot X(256,0,256)',
      'Print Vec Rot Y',
    ])
    // 1024 units to the turn, so 256 is 90 degrees: x moves onto y
    expect(Math.abs(Number(out.trim()))).toBeGreaterThan(200)
  })

  /**
   * `tst.w d5 / Rbeq routine 390` — a rotated distance of zero is error 23,
   * where the port used to substitute 1 and carry on.
   */
  it('a projected distance of zero is an error', () => {
    expect(() =>
      // and it is the FIRST argument that has to be zero, not the third,
      // because of the reversal above
      run(['Vec Rot Angles 0,0,0 : Vec Rot Pos 0,0,0 : Vec Rot Precalc', 'Print Vec Rot X(0,10,10)']),
    ).toThrow(/illegal function call/i)
    expect(() =>
      run(['Vec Rot Angles 0,0,0 : Vec Rot Pos 0,0,0 : Vec Rot Precalc', 'Print Vec Rot X(10,10,0)']),
    ).not.toThrow()
  })

  it('Speek and Sdeek read memory as SIGNED, which Peek and Deek do not', () => {
    // "Bit 7 is used as sign bit so the result will be a value between -128
    // and 127 ... use this function instead of Peek if you have poked a
    // negative value"
    const { out } = run([
      'Reserve As Work 3,16',
      'Poke Start(3),$FF : Doke Start(3)+2,$FFFE',
      'Print Speek(Start(3));",";Peek(Start(3));",";Sdeek(Start(3)+2)',
    ])
    expect(out.trim().replace(/\s+/g, '')).toBe('-1,255,-2')
  })

  it('Amos Cli is zero, because nothing started this from a shell', () => {
    expect(p('Amos Cli')).toBe('0')
  })

  it('Audio Lock, Flush Libs and Open Workbench have nothing to do here', () => {
    expect(() => run(['Audio Lock', 'Audio Free', 'Flush Libs', 'Open Workbench'])).not.toThrow()
  })
})

describe('slice 11: the four-player adaptor and the second mouse', () => {
  const p = (expr: string): string => run([`Print ${expr}`]).out.trim()

  /**
   * Smouse X/Y (154/155, $4650) are the SETTERS, and they scale: the popped
   * value is shifted left by the stored Smouse Speed —
   * `move.w $2ee(a2),d1 / asl.w d1,d0` — before being stored at $2f4/$2f6.
   */
  it('Smouse X and Y scale the value they are given by the speed', () => {
    expect(run(['Smouse Speed 0', 'Smouse X 10', 'Smouse Y 20']).rt.amcaf.smouse.x).toBe(10)
    const fast = run(['Smouse Speed 2', 'Smouse X 10', 'Smouse Y 20']).rt.amcaf.smouse
    expect([fast.x, fast.y]).toEqual([40, 80])
  })

  /**
   * Qrnd (258, $63f0) is NOT AMOS's Rnd, whatever the manual says: it stirs a
   * seed with VHPOSR and scales a 15-bit fraction. Qrnd(0) hands back the
   * previous result. The beam is modelled deterministically here, so the
   * sequence is reproducible.
   */
  it('Qrnd stays in range, varies, and Qrnd(0) repeats the last result', () => {
    const { out } = run([
      'For I=0 To 40',
      'A=Qrnd(100) : If A<0 or A>=100 Then Print "BAD" : End',
      'S=S+A : Next I',
      'B=Qrnd(100)',
      'Print S;",";B;",";Qrnd(0)',
    ])
    const [sum, b, again] = out.trim().split(',').map((t) => Number(t.trim()))
    expect(sum).toBeGreaterThan(0) // not stuck on zero
    expect(again).toBe(b) // Qrnd(0) is the previous result
  })

  /**
   * Set Rain Colour (189, $4dce) and Rain Fade (190, $4dfe) both range-check
   * the rainbow with `Rbmi 390` / `cmp.w #4 / Rbge 390` — there are four, at
   * $18 bytes each from -$868(a5) — and Rain Fade additionally errors when
   * the rainbow's height word at $a(a1) is zero.
   */
  it('the rainbow pair check their index', () => {
    const setup = ['Screen Open 0,64,32,16,Lowres', 'Set Rainbow 0,0,16,"","",""', 'Rainbow 0,0,10,20']
    expect(() => run([...setup, 'Set Rain Colour 0,$F00'])).not.toThrow()
    expect(() => run([...setup, 'Rain Fade 0,$F00'])).not.toThrow()
    expect(() => run([...setup, 'Set Rain Colour 4,$F00'])).toThrow()
    expect(() => run([...setup, 'Rain Fade -1,$F00'])).toThrow()
  })

  it('the parallel-port joysticks report nothing, as Sticks does for the same wires', () => {
    // CIA-A PRB with no adaptor attached: an unused port reads as nothing
    // pressed on the machine too
    for (const j of [0, 1]) {
      expect(p(`Pjoy(${j})`)).toBe('0')
      expect(p(`Pfire(${j})`)).toBe('0')
      expect(p(`Pjup(${j})`)).toBe('0')
      expect(p(`Pjdown(${j})`)).toBe('0')
      expect(p(`Pjleft(${j})`)).toBe('0')
      expect(p(`Pjright(${j})`)).toBe('0')
    }
  })

  it("'j' must be either 0 or 1, which the manual states", () => {
    expect(() => p('Pjoy(2)')).toThrow(/Illegal function call/)
    expect(() => p('Pjoy(-1)')).toThrow(/Illegal function call/)
  })

  it('Xfire reads the ordinary fire for button 1 and nothing beyond', () => {
    const { rt } = run(['Print 1'])
    rt.input.joy = 16 // fire on the joystick port
    expect(run(['Print 1']).rt).toBeTruthy()
    // button 2 and up need lowlevel.library, which is not modelled
    expect(p('Xfire(1,2)')).toBe('0')
    expect(p('Xfire(1,4)')).toBe('0')
    expect(() => p('Xfire(3,1)')).toThrow(/Illegal function call/)
  })

  it('the second mouse holds where a program put it and reads no buttons', () => {
    // "not ... the AMOS pointer" -- a distinct position with nothing driving it
    expect(p('X Smouse')).toBe('0')
    expect(p('Y Smouse')).toBe('0')
    expect(p('Smouse Key')).toBe('0')
  })

  /**
   * Routines 168 ($4682) and 169 ($46c4), which share NOTHING with the other
   * two Limit keywords — the port borrowed Splinters' reader for all three.
   *
   * The explicit form is a plain store of four words: no `lsl.w #$4`, so the
   * box is in WHOLE PIXELS rather than sixteenths; no `subq`, so the far
   * corner is INCLUSIVE; and no `cmp.w`/`exg.l`, so a reversed rectangle
   * stays reversed instead of being normalised into a usable one.
   */
  it('Limit Smouse stores whole pixels, inclusive, and does not normalise', () => {
    expect(run(['Smouse Speed 3']).rt.amcaf.smouse.speed).toBe(3)
    const { rt } = run(['Screen Open 0,64,32,4,Lowres', 'Limit Smouse 1,2 To 30,20'])
    expect(rt.amcaf.smouse.limit).toEqual({ x1: 1, y1: 2, x2: 30, y2: 20 })
    // reversed in, reversed out — a box nothing can be inside
    const back = run(['Screen Open 0,64,32,4,Lowres', 'Limit Smouse 30,20 To 1,2'])
    expect(back.rt.amcaf.smouse.limit).toEqual({ x1: 30, y1: 20, x2: 1, y2: 2 })
  })

  /**
   * And the bare form does not start at 0,0. Routine 168 reads `$52(a0)` and
   * `$54(a0)` masked to the copper's ten bits — the screen's DISPLAY position
   * — and adds the size to it, so the box is where the screen sits on the
   * HARDWARE display. That is consistent with the rest of the family: X
   * Smouse and Smouse X are in the same coordinates AMOS's own X Mouse uses.
   */
  it('Limit Smouse takes the box from where the screen is DISPLAYED', () => {
    // a screen opens at the default 128,50
    expect(run(['Screen Open 0,64,32,4,Lowres', 'Limit Smouse']).rt.amcaf.smouse.limit).toEqual({
      x1: 128, y1: 50, x2: 128 + 63, y2: 50 + 31,
    })
    // ...and moving it moves the box with it
    expect(
      run(['Screen Open 0,64,32,4,Lowres', 'Screen Display 0,190,80,,', 'Limit Smouse']).rt.amcaf.smouse.limit,
    ).toEqual({ x1: 190, y1: 80, x2: 190 + 63, y2: 80 + 31 })
    // it SNAPSHOTS, so a later screen does not move the limits
    const resized = run(['Screen Open 0,64,32,4,Lowres', 'Limit Smouse', 'Screen Open 1,320,200,4,Lowres'])
    expect(resized.rt.amcaf.smouse.limit).toEqual({ x1: 128, y1: 50, x2: 191, y2: 81 })
  })
})

describe('slice 12: ProTracker replay', () => {
  /** the smallest legal module: 31 sample headers, one pattern, one sample */
  const modBank = (): string[] => [
    'Reserve As Work 3,3000',
    'Poke Start(3)+20+22,0 : Poke Start(3)+20+23,4', // sample 1 length = 4 words
    'Poke Start(3)+950,1', // song length 1
    'Poke Start(3)+952,0', // order[0] = pattern 0
    'Poke Start(3)+1080,Asc("M") : Poke Start(3)+1081,Asc(".")',
    'Poke Start(3)+1082,Asc("K") : Poke Start(3)+1083,Asc(".")',
    'Poke Start(3)+1084+1024,77', // the first sample byte, after one pattern
  ]

  it('Pt Play marks the module playing and Pt Stop stops it', () => {
    const { rt } = run([...modBank(), 'Pt Play 3'])
    expect(rt.amcaf.pt.playing).toBe(true)
    expect(rt.amcaf.pt.bank).toBe(3)
    expect(run([...modBank(), 'Pt Play 3', 'Pt Stop']).rt.amcaf.pt.playing).toBe(false)
  })

  /**
   * Selector 1 of routine 381 checks `$438(a0)` against `M.K.` ($4d2e4b2e)
   * and `M!K!` ($4d214b21) before it touches anything, and `Rbra routine 390`
   * on anything else. Both Pt Play and Pt Bank go through it, so naming a
   * bank that is not a ProTracker module stops the program rather than
   * quietly playing silence, which is what the port did.
   *
   * It also does `ori.b #$2,$bfe001` — the power LED off, which on the real
   * machine DISENGAGES the low-pass filter. Loading a module changes how the
   * whole Amiga sounds, and that reaches the sink here.
   */
  it('Pt Play refuses a bank that is not M.K. or M!K!, and drops the filter', () => {
    expect(() => run(['Reserve As Work 3,3000', 'Pt Play 3'])).toThrow()
    expect(() => run(['Reserve As Work 3,3000', 'Pt Bank 3'])).toThrow()
    // one `.` a line, so this is the same module signed M!K!
    expect(() => run([...modBank().map((l) => l.replace('Asc(".")', 'Asc("!")')), 'Pt Play 3'])).not.toThrow()
    const { audio } = runAudio([...modBank(), 'Pt Play 3'])
    expect(audio.events.filter((e) => e.kind === 'filter').map((e) => e.filter)).toEqual([false])
  })

  /**
   * Routine 268 ($61bc) reads the signal byte and CLEARS it in the same
   * breath — `move.b $2(a0),d3 / clr.b $2(a0)` — so a signal is consumed by
   * whoever reads it first. Pt Vu (255) has the identical shape and this port
   * already cleared that one; Pt Signal it did not, so a program polling it
   * saw the same signal for ever.
   */
  it('Pt Signal is consumed by reading it', () => {
    const { out } = run([...modBank(), 'Pt Play 3', 'Print Pt Signal;",";Pt Signal'])
    expect(out.trim().split(',')[1]!.trim()).toBe('0')
  })

  /**
   * Routines 228/229 range-check the channel — `Rbmi 390` on negative,
   * `cmp.b #4 / Rbge 390` past three — where the port had `& 3` and silently
   * answered for channel 0.
   */
  it('the Pt query functions error on a channel outside 0..3', () => {
    expect(() => run([...modBank(), 'Pt Play 3', 'A=Pt Cnote(4)'])).toThrow()
    expect(() => run([...modBank(), 'Pt Play 3', 'A=Pt Cinstr(-1)'])).toThrow()
    expect(() => run([...modBank(), 'Pt Play 3', 'A=Pt Cnote(3)'])).not.toThrow()
  })

  /**
   * Routine 246 ($5df6): `chan` is a BITMASK — `btst.b #0,d0` / `lsr.w #1,d0`
   * four times, stepping $10 bytes through the AUDxPER registers — and the
   * frequency is clamped to $190..$7530 before the period is derived.
   *
   * The third thing, missed last pass: `tst.b (a1) / bne` guards every write,
   * so only a channel actually playing an AMCAF sample is retuned. The
   * `Pt Instr Play 15,1` is what puts one on all four.
   */
  it('Pt Sam Freq takes a channel MASK and clamps the frequency', () => {
    const freqs = (src: string[]): Array<[number, number]> => {
      const { audio } = runAudio([...modBank(), 'Pt Play 3', 'Pt Instr Play 15,1', ...src])
      return audio.events.filter((e) => e.kind === 'freq').map((e) => [e.voice, e.freq ?? 0])
    }
    // mask 3 is channels 0 AND 1 — not "channel 3"
    expect(freqs(['Pt Sam Freq 3,8000'])).toEqual([
      [0, 8000],
      [1, 8000],
    ])
    // clamped to $190..$7530 before the period is derived
    expect(freqs(['Pt Sam Freq 1,10'])).toEqual([[0, 400]])
    expect(freqs(['Pt Sam Freq 2,99999'])).toEqual([[1, 30000]])
    // a negative is floored to zero first, then pulled up by the low clamp
    expect(freqs(['Pt Sam Freq 8,-5'])).toEqual([[3, 400]])
    // ...and nothing at all where no sample is running
    const idle = runAudio([...modBank(), 'Pt Play 3', 'Pt Sam Freq 15,8000'])
    expect(idle.audio.events.filter((e) => e.kind === 'freq')).toEqual([])
  })

  /**
   * Routine 247 ($5e50) is Pt Sam Freq's shape again — four passes of
   * `btst.b #0,d0` / `lsr.w #1,d0`, each clearing one DMACON bit and one
   * AUDxVOL — so the argument is a MASK. The port took it as an index, which
   * silenced channel 3 where the machine silences 0 and 1.
   */
  it('Pt Sam Stop takes a channel mask too', () => {
    const stops = (src: string): number[] => {
      const { audio } = runAudio([...modBank(), 'Pt Play 3', src])
      return audio.events.filter((e) => e.kind === 'stop').map((e) => e.voice)
    }
    expect(stops('Pt Sam Stop 3')).toEqual([0, 1])
    expect(stops('Pt Sam Stop 8')).toEqual([3])
    expect(stops('Pt Sam Stop 15')).toEqual([0, 1, 2, 3])
    expect(stops('Pt Sam Stop 0')).toEqual([])
  })

  /**
   * Routine 263 ($610c) does no such thing as the `Rbsr` into Pt Stop an
   * earlier pass credited it with — there is no `Rbsr` in it at all. Thirty
   * four bytes: resolve the bank, keep the address at $2bc, range-check it,
   * and tail into the replayer.
   *
   *     cmpa.l #$200000, a0
   *     Rbge   routine 390
   *     moveq  #$0, d1 / moveq #$1, d0
   *     Rbra   routine 381
   *
   * The 2MB test is a DEVIATION: it compares a real address and this port has
   * a flag, so enforcing it would reject every `Reserve As Work` bank,
   * including on machines where all memory is chip and the original is happy.
   *
   * Selector 1 of the replayer ($8a16) is the module SET-UP. It checks the
   * signature at $438(a0) against `M.K.` and `M!K!`, then resets speed to 6
   * (`move.b #$6,-$e(a5)`), the tempo to 125 (`move.w #$7d,(a5)`) and the
   * position, and stores the caller's d1 — zero here, one for Pt Play — as
   * the playing flag. So Pt Bank prepares a module without starting it, which
   * looks like a stop but is not one.
   */
  it('Pt Bank prepares the module and does not start it', () => {
    const stopped = run([...modBank(), 'Pt Play 3', 'Pt Bank 3'])
    expect(stopped.rt.amcaf.pt.playing).toBe(false)
    expect(stopped.rt.amcaf.pt.bank).toBe(3)
    // the replayer reset, which the Pt Stop reading never explained
    expect([stopped.rt.amcaf.pt.speed, stopped.rt.amcaf.pt.bpm]).toEqual([6, 125])
    expect([stopped.rt.amcaf.pt.pos, stopped.rt.amcaf.pt.row]).toEqual([0, 0])
  })

  /**
   * The three play paths all `Rbra routine 375`, and the entries above it are
   * only there to work out the four registers it wants. Routines 254/255/256
   * make that explicit for Pt Instr Play: the one-argument form pushes $f for
   * the voice and $3d09 for the frequency before falling into the three-
   * argument one. So the OPTIONAL argument is the leading one, and
   * `Pt Instr Play 1,5` is voice 1, instrument 5 — not instrument 1 on a mask
   * of 5, which is how the port read it.
   */
  it('Pt Instr Play takes voice FIRST, and defaults it to all four', () => {
    const played = (src: string): number[] => {
      const { audio } = runAudio([...modBank(), 'Pt Play 3', src])
      return audio.events.filter((e) => e.kind === 'play').map((e) => e.voice)
    }
    // one argument: the INSTRUMENT, on every channel
    expect(played('Pt Instr Play 1')).toEqual([0, 1, 2, 3])
    // two: voice mask 5 is channels 0 and 2, instrument 1
    expect(played('Pt Instr Play 5,1')).toEqual([0, 2])
    // a zero mask plays nowhere: `tst.w d2 / beq / rts` in routine 375
    expect(played('Pt Instr Play 0,1')).toEqual([])
    // and instrument 0 is error 23, from Pt Instr Address's own range check
    expect(() => runAudio([...modBank(), 'Pt Play 3', 'Pt Instr Play 1,0'])).toThrow()
  })

  /**
   * `moveq #$f,d1 / move.l d1,-(a3) / move.l d0,-(a3) / move.l #$3d09,-(a3)`
   * — 15625 Hz flat for an instrument with no frequency given, where the port
   * used the period table's C-3. And routine 375's own `cmp.w #$190` /
   * `cmp.w #$7530` clamp applies to every launch, not just Pt Sam Freq's.
   */
  it('an instrument with no frequency plays at 15625 Hz', () => {
    const hz = (src: string): number[] => {
      const { audio } = runAudio([...modBank(), 'Pt Play 3', src])
      return audio.events.filter((e) => e.kind === 'play').map((e) => e.freq ?? 0)
    }
    expect(hz('Pt Instr Play 1,1')).toEqual([15625])
    expect(hz('Pt Instr Play 1,1,8000')).toEqual([8000])
    expect(hz('Pt Instr Play 1,1,99999')).toEqual([30000])
    expect(hz('Pt Instr Play 1,1,-5')).toEqual([400])
  })

  /**
   * Routine 375's only volume write is `move.w $2d0(a2),$8(a4)`, and $2d0 is
   * Pt SAM Volume's word — routine 244 stores it and nothing else does. Pt
   * Volume is the music's `$4(a0)` and never reaches a sample at all. The
   * port passed the music volume to every launch and had the two Pt Sam
   * Volume forms the wrong way round besides: one argument sets the stored
   * default, two write AUDxVOL for a currently-playing channel.
   */
  it('a sample plays at Pt Sam Volume, and Pt Volume does not reach it', () => {
    const vol = (src: string[]): number | undefined => {
      const { audio } = runAudio([...modBank(), 'Pt Play 3', ...src, 'Pt Instr Play 1,1'])
      return audio.events.find((e) => e.kind === 'play')?.volume
    }
    expect(vol([])).toBe(64) // the .Lib's own initial $40
    expect(vol(['Pt Sam Volume 20'])).toBe(20)
    expect(vol(['Pt Volume 20'])).toBe(64) // the music knob, not this one
    expect(vol(['Pt Sam Volume 999'])).toBe(64)
    expect(vol(['Pt Sam Volume -5'])).toBe(0)
    // the two-argument form is a live AUDxVOL write, and only for a channel
    // that has something playing: `tst.b (a1) / bne next`
    const live = runAudio([...modBank(), 'Pt Play 3', 'Pt Instr Play 1,1', 'Pt Sam Volume 3,30'])
    expect(live.audio.events.filter((e) => e.kind === 'volume').map((e) => [e.voice, e.volume])).toEqual([[0, 30]])
    const idle = runAudio([...modBank(), 'Pt Play 3', 'Pt Sam Volume 15,30'])
    expect(idle.audio.events.filter((e) => e.kind === 'volume')).toEqual([])
  })

  /**
   * Routine 248 ($5e90) pops freq, length, address, voice — so the fourth
   * argument is the frequency in HERTZ, which routine 375 clamps and turns
   * into a period. The port ran the conversion the other way, treating it as
   * a period, so a program asking for 8363 Hz got 428.
   */
  it('Pt Raw Play takes a frequency in Hertz, not a period', () => {
    const { audio } = runAudio([...modBank(), 'Pt Sam Bank 3', 'Pt Raw Play 2,Start(3),8,8363'])
    expect(audio.events.filter((e) => e.kind === 'play').map((e) => [e.voice, e.freq])).toEqual([[1, 8363]])
  })

  /**
   * Every Pt Sam Play form opens `move.l $2c4(a2),d0 / Rbeq routine 390`, and
   * `cmp.w (a0),d7 / Rbhi routine 390` bounds the number against the bank's
   * own count word. The port returned silently on all three.
   */
  it('Pt Sam Play errors without a bank, on sample 0, and past the count', () => {
    // the AMOS sample bank format routine 250 walks: a count word, count
    // longs of offsets, then name[8], freq.w, length.l and the PCM
    const samBank = (): string[] => [
      'Reserve As Work 4,64',
      'Poke Start(4)+1,1', // one sample
      'Poke Start(4)+5,6', // its record at +6
      'Doke Start(4)+6+8,8000', // freq
      'Loke Start(4)+6+10,4', // four bytes of PCM
    ]
    expect(() => run([...modBank(), 'Pt Play 3', 'Pt Sam Play 1,1'])).toThrow()
    expect(() => run([...samBank(), 'Pt Sam Bank 4', 'Pt Sam Play 1,0'])).toThrow()
    expect(() => run([...samBank(), 'Pt Sam Bank 4', 'Pt Sam Play 1,2'])).toThrow()
    // and the frequency comes from the bank's own header when none is given
    const { audio } = runAudio([...samBank(), 'Pt Sam Bank 4', 'Pt Sam Play 1,1'])
    expect(audio.events.filter((e) => e.kind === 'play').map((e) => [e.voice, e.freq])).toEqual([[0, 8000]])
  })

  /**
   * Pt Voice does not merely record a mask. Routine 262 silences every
   * channel it turns off there and then — `move.w #$1,$96(a1)` on DMACON and
   * `clr.w $a8(a1)` on AUDxVOL, at $b8/$c8/$d8 for the rest.
   */
  it('Pt Voice silences the channels it takes away', () => {
    const { audio, rt } = runAudio([...modBank(), 'Pt Play 3', 'Pt Voice 3'])
    expect(rt.amcaf.pt.voices).toBe(3)
    expect(audio.events.filter((e) => e.kind === 'stop').map((e) => e.voice)).toEqual([2, 3])
  })

  it('Pt Stop with nothing playing leaves the channels alone', () => {
    // the changelog records this as a real bug: "Fixed a bug in Pt Stop which
    // cut off the channels, even if no music had been playing"
    expect(() => run(['Pt Stop'])).not.toThrow()
    expect(run(['Pt Stop']).rt.amcaf.pt.playing).toBe(false)
  })

  /**
   * Routine 266 opens `move.l $2bc(a2),d0 / Rbeq routine 390`, so continuing
   * with nothing ever played is an ERROR rather than the no-op the port had —
   * which matters because Pt Stop, its counterpart, deliberately is a no-op
   * (the changelog records that as a fixed bug). The two are not symmetric.
   */
  it('Pt Continue with nothing ever played is an error, unlike Pt Stop', () => {
    expect(() => run(['Pt Continue'])).toThrow(/Illegal function call/)
    expect(() => run(['Pt Stop'])).not.toThrow()
    const r = run([...modBank(), 'Pt Play 3', 'Pt Stop', 'Pt Continue'])
    expect(r.rt.amcaf.pt.playing).toBe(true)
  })

  it('Pt Cia Speed 0 switches to VBL timing and pins the rate at 125', () => {
    // "if you specify a value of zero, the timing will be switched from
    // CIA-Timing to Vertical Blank Timing. Then the bpm rate is automatically
    // set to exactly 125"
    const vbl = run(['Pt Cia Speed 0']).rt.amcaf.pt
    expect(vbl.cia).toBe(false)
    expect(vbl.bpm).toBe(125)
    const cia = run(['Pt Cia Speed 140']).rt.amcaf.pt
    expect(cia.cia).toBe(true)
    expect(cia.bpm).toBe(140)
  })

  /**
   * Routines 257 and 258 both open `move.l $2bc(a2),d0 / Rbeq routine 390`
   * and both range-check with `Rbmi / Rbeq / cmp.w #$1f,d0 / Rbhi`. All four
   * are error 23; the port answered 0 for every one of them.
   */
  it('Pt Instr Length reads the module sample table, and errors off it', () => {
    // sample 1's header says 4 words, so 8 bytes
    expect(run([...modBank(), 'Pt Play 3', 'Print Pt Instr Length(1)']).out.trim()).toBe('8')
    expect(run([...modBank(), 'Pt Play 3', 'Print Pt Instr Address(1)>0']).out.trim()).toBe('-1')
    expect(() => run([...modBank(), 'Pt Play 3', 'Print Pt Instr Length(0)'])).toThrow()
    expect(() => run([...modBank(), 'Pt Play 3', 'Print Pt Instr Length(32)'])).toThrow()
    expect(() => run([...modBank(), 'Pt Play 3', 'Print Pt Instr Address(-1)'])).toThrow()
    // with no Pt Play or Pt Bank there is no module at all
    expect(() => run(['Print Pt Instr Length(1)'])).toThrow()
  })

  /**
   * `bpl` tests the whole long and `cmp.w #$40,d0 / bls` only the low word,
   * so 65536 is positive, has a low word of zero, and stores silence.
   */
  it('Pt Volume clamps to the chip range, and truncates to a word first', () => {
    expect(run(['Pt Volume 200']).rt.amcaf.pt.volume).toBe(64)
    expect(run(['Pt Volume -5']).rt.amcaf.pt.volume).toBe(0)
    expect(run(['Pt Volume 65536']).rt.amcaf.pt.volume).toBe(0)
    expect(run(['Pt Volume 65600']).rt.amcaf.pt.volume).toBe(64)
  })

  it('Pt Vu is a note-on latch that clears when read, like AMOS Vumeter', () => {
    const { out } = run([...modBank(), 'Pt Play 3', 'Print Pt Vu(0);",";Pt Vu(0)'])
    expect(out.trim().replace(/\s+/g, '')).toBe('0,0')
  })

  /**
   * Routine 239 answers with a BITMASK — `moveq #$1,d3` through
   * `moveq #$8,d3`, zero for none — where the port answered 0..3 with -1 for
   * none. A program feeding the answer straight back to Pt Sam Play, which is
   * the only reason to ask, therefore asked for the wrong channel every time
   * and for no channel at all when the answer was 0.
   */
  it('Pt Free Voice answers with a mask, not an index', () => {
    // nothing playing: all four free, so the lowest bit
    expect(run(['Print Pt Free Voice']).out.trim()).toBe('1')
    // a mask naming exactly one voice is handed straight back, unexamined:
    // `cmp.w #$1,d7 / beq` for each of 1, 2, 4 and 8
    expect(run(['Print Pt Free Voice(2)']).out.trim()).toBe('2')
    expect(run(['Print Pt Free Voice(8)']).out.trim()).toBe('8')
    // ...and a mask of zero is zero
    expect(run(['Print Pt Free Voice(0)']).out.trim()).toBe('0')
    // with the music holding channels 0 and 1, the first channel it is not
    // using is 2 — bit 2, which is the value 4
    expect(run([...modBank(), 'Pt Play 3', 'Pt Voice 3', 'Print Pt Free Voice']).out.trim()).toBe('4')
    // and a voice with a sample on it is no longer free: `clr.b $e(a1)`
    expect(run([...modBank(), 'Pt Play 3', 'Pt Instr Play 3,1', 'Print Pt Free Voice']).out.trim()).toBe('4')
    // Pt Sam Stop hands it back — `st.b (a1)`
    expect(
      run([...modBank(), 'Pt Play 3', 'Pt Instr Play 3,1', 'Pt Sam Stop 1', 'Print Pt Free Voice']).out.trim(),
    ).toBe('1')
  })

  /**
   * With every masked voice busy the routine steals one, and which one is the
   * countdown word routine 375 leaves at `$12`: `length/2 * 100 / freq + 1`,
   * in fiftieths of a second, or -2 for a looping sample. `move.w #$ffff,d4`
   * with a signed `cmp.w d0,d4 / bpl` keeps the LARGEST, so a loop always
   * loses to a one-shot — and when every candidate is looping the answer is
   * zero and routine 375 drops the sample rather than interrupting anything.
   */
  it('with no voice free, Pt Free Voice steals the one running longest', () => {
    // instrument 1 is 8 bytes; at 15625 Hz that is 4 samples, so 1 tick, and
    // at 400 Hz it is 100/400*4 + 1 = 2. Channel 1 gets the longer one.
    const busy = ['Pt Instr Play 1,1', 'Pt Instr Play 2,1,400']
    expect(run([...modBank(), 'Pt Play 3', ...busy, 'Print Pt Free Voice(3)']).out.trim()).toBe('2')
    // a negative instrument number LOOPS, and a loop is never worth stealing
    const loop = ['Pt Instr Play 1,-1', 'Pt Instr Play 2,1']
    expect(run([...modBank(), 'Pt Play 3', ...loop, 'Print Pt Free Voice(3)']).out.trim()).toBe('2')
    // ...and if they all loop there is nothing to take
    const allLoop = ['Pt Instr Play 1,-1', 'Pt Instr Play 2,-1']
    expect(run([...modBank(), 'Pt Play 3', ...allLoop, 'Print Pt Free Voice(3)']).out.trim()).toBe('0')
  })

  it('Pt Cpos stays inside a pattern, 0 to 63', () => {
    const { out } = run([...modBank(), 'Pt Play 3', 'Print Pt Cpos;",";Pt Cpattern'])
    expect(out.trim().replace(/\s+/g, '')).toBe('0,0')
  })
})


/**
 * The 1.50 transition engine — routines 146-154, the block at $496..$4a6.
 *
 * "Transition", not transparency. Every one of these is read out of the
 * library, because the Guide documents them in nine lines of changelog and
 * nowhere else: there is no manual entry for any of them, no argument
 * description, and two of the four verbs the author advertised do not work in
 * the shipped binary either.
 */
describe('AMCAF transitions', () => {
  /** a 64-pixel two-plane screen (four colours), so the row stride is 8 bytes */
  const scr = ['Screen Open 0,64,8,4,Lowres', 'Cls 0']
  /**
   * A source that answers 1 for the middle entry and 0 for the one above it.
   *
   * The middle is where a map word of 0 lands: `lea $7ffe(a0),a0 / addq.l
   * #$2,a0` biases the pointer by $8000 and `(a0,d4.w)` sign-extends, so
   * `Source[w ^ $8000]` is the byte a map entry `w` selects.
   */
  const src = ['Alloc Trans Source 9', 'Poke Start(9)+32768,1']
  /** 32 pixels wide, one row — exactly one output longword */
  const map = ['Alloc Trans Map 10,32,1']

  it('Alloc Trans Source reserves 64K, named and flagged as the routine says', () => {
    const { rt } = run(['Alloc Trans Source 9'])
    const b = rt.memBanks.get(9)!
    // `moveq #$1,d2 / swap d2` is the size and it is not a parameter: the map
    // reaches every entry either side of the bias, so 64K is the only size
    expect(b.kind === 'memory' && b.data.length).toBe(0x10000)
    expect(b.name).toBe('TransSrc')
    // `moveq #$0,d1` -- a WORK bank, the same d1 Wload passes where Dload
    // passes 1 (routines 103/104, $3806 and $3860)
    expect(b.kind === 'memory' && b.flags).toBe(0)
  })

  it('Alloc Trans Map rounds the width UP to 32 and takes two bytes a pixel', () => {
    // `addi.w #$1f,d2 / andi.w #$ffe0,d2`, then `mulu.w d3,d2 / add.l d2,d2`
    const { rt } = run(['Alloc Trans Map 10,33,2'])
    const b = rt.memBanks.get(10)!
    expect(b.kind === 'memory' && b.data.length).toBe(64 * 2 * 2)
    expect(b.name).toBe('TransMap')
    expect(b.kind === 'memory' && b.flags).toBe(0)
  })

  it('Alloc Code Bank keeps the size it is given, and reserves it', () => {
    const { rt } = run(['Alloc Code Bank 11,256'])
    const b = rt.memBanks.get(11)!
    expect(b.kind === 'memory' && b.data.length).toBe(256)
    expect(b.name).toBe('CodeBank')
  })

  it('a map of zeros paints the whole longword from the middle of the source', () => {
    const { rt } = run([...scr, ...src, ...map, 'Trans Screen Runtime 0,0,0,0'])
    const s = rt.screens.get(0)!
    for (const x of [0, 1, 15, 16, 31]) expect(s.rp.point(x, 0)).toBe(1)
    expect(s.rp.point(32, 0)).toBe(0) // 32 pixels wide, and no further
  })

  it('only BIT 0 of the source byte is the pixel', () => {
    // `lsr.w #$1,d3 / addx.l d0,d0` -- the carry out is bit 0 and nothing else
    const even = run([...scr, ...src, ...map, 'Poke Start(9)+32769,2', 'Doke Start(10),1', 'Trans Screen Runtime 0,0,0,0'])
    expect(even.rt.screens.get(0)!.rp.point(0, 0)).toBe(0) // 2 -> bit 0 clear
    const odd = run([...scr, ...src, ...map, 'Poke Start(9)+32769,3', 'Doke Start(10),1', 'Trans Screen Runtime 0,0,0,0'])
    expect(odd.rt.screens.get(0)!.rp.point(0, 0)).toBe(1) // 3 -> bit 0 set
  })

  it('the map word is SIGNED: -1 reads below the bias, not above it', () => {
    const { rt } = run([
      ...scr,
      'Alloc Trans Source 9',
      'Poke Start(9)+32767,1', // one BELOW the middle
      ...map,
      'Doke Start(10),-1', // $ffff, which sign-extends to -1
      'Trans Screen Runtime 0,0,0,0',
    ])
    expect(rt.screens.get(0)!.rp.point(0, 0)).toBe(1)
    expect(rt.screens.get(0)!.rp.point(1, 0)).toBe(0) // word 1 is still 0 -> the middle, which is 0 here
  })

  it('the first map word in memory is the LEFTMOST pixel', () => {
    // `move.l (a3)+,d4` takes two entries; the HIGH word -- first in memory --
    // is shifted in first and so lands further left
    const { rt } = run([...scr, ...src, ...map, 'Doke Start(10),1', 'Trans Screen Runtime 0,0,0,0'])
    const s = rt.screens.get(0)!
    expect(s.rp.point(0, 0)).toBe(0) // the one entry pointed away from the 1
    expect(s.rp.point(1, 0)).toBe(1)
  })

  it('Ox is snapped DOWN to a multiple of 16', () => {
    // `andi.w #$fff0,d5 / lsr.w #$3,d5` -- 20 becomes 16, a two-byte offset
    const { rt } = run([...scr, ...src, ...map, 'Trans Screen Runtime 0,0,20,0'])
    const s = rt.screens.get(0)!
    expect(s.rp.point(15, 0)).toBe(0)
    expect(s.rp.point(16, 0)).toBe(1)
  })

  it('Oy steps by the screen width over eight', () => {
    const { rt } = run([...scr, ...src, ...map, 'Trans Screen Runtime 0,0,0,3'])
    const s = rt.screens.get(0)!
    expect(s.rp.point(0, 2)).toBe(0)
    expect(s.rp.point(0, 3)).toBe(1)
  })

  it('the bitplane chooses the plane, so the colour is a power of two', () => {
    const { rt } = run([...scr, ...src, ...map, 'Trans Screen Runtime 0,1,0,0'])
    expect(rt.screens.get(0)!.rp.point(0, 0)).toBe(2)
  })

  it('a bitplane outside 0..6 is error 23', () => {
    // `Rbmi routine 157` then `cmp.w #$6,d4 / Rbhi routine 157`, and both go
    // to 390 -- checked BEFORE the screen is even resolved
    expect(() => run([...scr, ...src, ...map, 'Trans Screen Runtime 0,7,0,0'])).toThrow(/Illegal function call/)
    expect(() => run([...scr, ...src, ...map, 'Trans Screen Runtime 0,-1,0,0'])).toThrow(/Illegal function call/)
  })

  it('DEVIATION: a plane inside 0..6 but past the screen depth is refused', () => {
    // the routine checks six and not `$50(a0)`, so the machine writes through
    // a plane pointer AMOS left null; this port raises instead
    expect(() => run([...scr, ...src, ...map, 'Trans Screen Runtime 0,5,0,0'])).toThrow(/Illegal function call/)
  })

  it('NOTE: an unset map or source is refused, where the machine walks from zero', () => {
    expect(() => run([...scr, ...src, 'Trans Screen Runtime 0,0,0,0'])).toThrow(/Illegal function call/)
    expect(() => run([...scr, ...map, 'Trans Screen Runtime 0,0,0,0'])).toThrow(/Illegal function call/)
  })

  it('Set Trans Map records the rounded width without reserving', () => {
    const { rt } = run([...scr, ...src, 'Reserve As Work 10,128', 'Set Trans Map 10,32,2', 'Trans Screen Runtime 0,0,0,0'])
    const s = rt.screens.get(0)!
    expect(s.rp.point(0, 0)).toBe(1)
    expect(s.rp.point(0, 1)).toBe(1) // two rows, from the height it was given
    expect(s.rp.point(0, 2)).toBe(0)
  })

  it('Set Trans Source points at a bank that is already there', () => {
    const { rt } = run([
      ...scr,
      'Reserve As Work 9,65536',
      'Poke Start(9)+32768,1',
      'Set Trans Source 9',
      ...map,
      'Trans Screen Runtime 0,0,0,0',
    ])
    expect(rt.screens.get(0)!.rp.point(0, 0)).toBe(1)
  })

  it('Trans Screen Static is a bare rts, but still takes its four arguments', () => {
    // routine 154 ($42fc) is two bytes; the changelog says "NOT YET
    // IMPLEMENTED" and means it
    const { rt } = run([...scr, ...src, ...map, 'Trans Screen Static 0,0,0,0'])
    expect(rt.screens.get(0)!.rp.point(0, 0)).toBe(0)
  })

  it('Trans Screen Dynamic is n/a — it assembles 68000 code, and Call runs it', () => {
    // routine 153 ($4272) emits `movea.l #dest,a0`, one `move.l #imm32,d16(a0)`
    // per non-zero longword, `rts`, then CacheClearU. Its output is machine
    // code for a machine this is not, and the only keyword that could reach it
    // is `Call`, n/a since the core port. So: no handler, deliberately
    expect(() => run([...scr, 'Trans Screen Dynamic 0,0,0,0'])).toThrow(/unimplemented: trans screen dynamic/)
  })
})

/**
 * The font group: Change Font, Make Bank Font, Change Bank Font, Change Print
 * Font and Turbo Text.
 *
 * Routines 139-144 and 343-345. Four of the five are graphics.library and
 * diskfont.library reached through AMOS's structures — `$aa(screen)` is
 * EcWindow (+Equ.s:507) and `$8(window)` is WiFont (+Equ.s:686) — and the
 * fifth, Turbo Text, is AMOS's own COut (+W.s:15646) unrolled.
 */
describe('AMCAF fonts', () => {
  // four colours, so the per-plane decomposition has two planes to disagree on
  const fscr = ['Screen Open 0,64,32,4,Lowres', 'Cls 0']

  /** the eight bytes of one character out of a Change Print Font bank */
  const glyph = (n: number, ch: number) => [0, 1, 2, 3, 4, 5, 6, 7].map((r) => `Poke Start(${n})+${ch * 8 + r},255`)

  it('Change Print Font replaces the charset the console prints with', () => {
    // routine 141 ($400c) stores the bank address straight into WiFont, and
    // COut indexes it by `lsl.w #3` off the raw byte -- no LoChar, no control
    // codes. A character of all-ones bytes prints as a solid 8x8 block.
    const { rt } = run([
      ...fscr,
      'Reserve As Work 5,2048',
      ...glyph(5, 65), // "A"
      'Change Print Font 5',
      'Pen 1 : Paper 0 : Locate 0,0 : Print "A";',
    ])
    const s = rt.screens.get(0)!
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(s.rp.point(x, y)).toBe(1)
  })

  it('Change Print Font keeps the bank ITSELF, so poking it changes the glyphs', () => {
    // `move.l a0,$8(a1)` is an address, not a copy
    const { rt } = run([
      ...fscr,
      'Reserve As Work 5,2048',
      'Change Print Font 5',
      ...glyph(5, 66), // poked AFTER the Change Print Font
      'Pen 1 : Locate 0,0 : Print "B";',
    ])
    expect(rt.screens.get(0)!.rp.point(0, 0)).toBe(1)
  })

  it('a new window goes back to the interpreter charset, as WOpen does', () => {
    // `move.l T_JeuDefo(a3),WiFont(a5)` (+W.s:13702) -- WiFont is not inherited
    const { rt } = run([
      'Screen Open 0,320,64,4,Lowres',
      'Reserve As Work 5,2048',
      ...glyph(5, 65),
      'Change Print Font 5',
      'Wind Open 2,0,0,10,2',
      'Pen 1 : Paper 0 : Print "A";',
    ])
    const s = rt.screens.get(0)!
    // the real "A" has a blank top row; the all-ones stand-in does not
    let lit = 0
    for (let x = 0; x < 8; x++) if (s.rp.point(x, 0) === 1) lit++
    expect(lit).toBeLessThan(8)
  })

  it('Make Bank Font writes a "FONT" container, Data AND Chip, named BankFont', () => {
    // routine 139: `moveq #$3,d1` against the literal "BankFont" at $3f66 --
    // the only Reserve in the extension that asks for both bits
    const { rt } = run([...fscr, 'Make Bank Font 7'])
    const b = rt.memBanks.get(7)!
    expect(b.name).toBe('BankFont')
    expect(b.kind === 'memory' && b.flags).toBe(1) // Data
    expect(b.kind === 'memory' && b.memType).toBe(1) // Chip
    const d = b.kind === 'memory' ? b.data : new Uint8Array()
    expect(String.fromCharCode(...d.subarray(0, 4))).toBe('FONT')
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
    expect(v.getUint32(4)).toBe(0) // `clr.l (a1)+`
    expect(v.getUint32(8)).toBe(0x6a) // `moveq #$6a,d0` -- always
    // tf_Accessors = 9999, `move.w #$270f,$36(a0)`: never close this font
    expect(v.getUint16(0x18 + 0x1e)).toBe(0x270f)
  })

  it('the bank is sized $6a + YSize*Modulo + 2*d6, where d6 is twice the char count', () => {
    // `moveq #$6a,d5 / add.l d7,d5 / add.l d6,d5 / add.l d6,d5`, with
    // d7 = YSize*Modulo and d6 = (HiChar - LoChar + 2) * 2
    const { rt } = run([...fscr, 'Make Bank Font 7'])
    const d = rt.memBanks.get(7)!.data
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
    const ySize = v.getUint16(0x18 + 0x14)
    const modulo = v.getUint16(0x18 + 0x26)
    const chars = d[0x18 + 0x21]! - d[0x18 + 0x20]! + 2
    expect(d.length).toBe(0x6a + ySize * modulo + 4 * chars)
    // and the CharLoc offset is exactly past the glyphs
    expect(v.getUint32(0x0c)).toBe(0x6a + ySize * modulo)
    // no CharSpace and no CharKern on this face, so both offsets are zero
    expect(v.getUint32(0x10)).toBe(0)
    expect(v.getUint32(0x14)).toBe(0)
  })

  it('Change Bank Font reads its own container back and sets rp_Font', () => {
    const { rt } = run([...fscr, 'Make Bank Font 7', 'Change Bank Font 7'])
    const f = rt.screens.get(0)!.rp.font
    expect(f).not.toBeNull()
    expect(f!.ySize).toBe(8)
    expect(f!.xSize).toBe(8)
    // `andi.b #$7d,$2f(a0) / ori.b #$1,$2f(a0)` -- FPF_ROMFONT arrives,
    // FPF_DISKFONT and FPF_REMOVED go, so nothing ever frees a bank font
    expect(f!.flags & 0x01).toBe(1)
    expect(f!.flags & 0x02).toBe(0)
    expect(f!.flags & 0x80).toBe(0)
    // the thirty bytes of ln_Name survive the trip
    expect(f!.name).toBe('amos.font')
  })

  it('Change Bank Font refuses a bank that is not one', () => {
    // `cmpi.l #$464f4e54,(a0) / Rbne routine 390` -- error 23
    expect(() => run([...fscr, 'Reserve As Work 7,64', 'Change Bank Font 7'])).toThrow(/Illegal function call/)
    expect(() => run([...fscr, 'Change Bank Font 9'])).toThrow(/Illegal function call/)
  })

  it('=Font Style answers off the same rp_Font the pair install', () => {
    // it reads `movea.l $34(a1),a1 / move.b $17(a1),d3` -- tf_Flags, which is
    // the DEFECT recorded on that keyword. Before this slice the port never
    // assigned rp_Font on an AMOS screen at all, so it could only answer 0
    const { out } = run([...fscr, 'Make Bank Font 7', 'Change Bank Font 7', 'Print Font Style'])
    expect(out.trim()).toBe('65') // FPF_ROMFONT | FPF_DESIGNED
  })

  it('Turbo Text draws the charset glyphs straight into the bitplanes', () => {
    const { rt } = run([
      ...fscr,
      'Reserve As Work 5,2048',
      ...glyph(5, 65),
      'Change Print Font 5',
      'Ink 3 : Turbo Text 0,0,"A"',
    ])
    const s = rt.screens.get(0)!
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(s.rp.point(x, y)).toBe(3)
  })

  it('DEFECT: with a pen bit clear the glyph still lands in that plane', () => {
    // three arms where COut has four. `asr.w #$1,d0 / bcs` dispatches on the
    // PAPER bit, and a plane whose paper bit is clear jams the glyph in
    // whatever rp_FgPen says -- `lsr.w #$1,d6` at $76f8 discards that bit
    // unread. So Ink 1 on four colours paints colour 3, not colour 1
    const { rt } = run([
      ...fscr,
      'Reserve As Work 5,2048',
      ...glyph(5, 65),
      'Change Print Font 5',
      'Ink 1 : Turbo Text 0,0,"A"',
    ])
    expect(rt.screens.get(0)!.rp.point(0, 0)).toBe(3)
  })

  it('the plane mask picks planes, and zero does nothing at all', () => {
    const one = run([
      ...fscr,
      'Reserve As Work 5,2048',
      ...glyph(5, 65),
      'Change Print Font 5',
      'Ink 3 : Turbo Text 0,0,"A",0,1',
    ])
    expect(one.rt.screens.get(0)!.rp.point(0, 0)).toBe(1)
    const none = run([
      ...fscr,
      'Reserve As Work 5,2048',
      ...glyph(5, 65),
      'Change Print Font 5',
      'Ink 3 : Turbo Text 0,0,"A",0,0',
    ])
    expect(none.rt.screens.get(0)!.rp.point(0, 0)).toBe(0)
  })

  it('NOTE: the fourth argument is dead — d6 is clobbered by rp_FgPen', () => {
    const a = run([...fscr, 'Ink 3 : Turbo Text 0,0,"A"'])
    const b = run([...fscr, 'Ink 3 : Turbo Text 0,0,"A",12345'])
    const pa = [...Array(8).keys()].map((x) => a.rt.screens.get(0)!.rp.point(x, 0))
    const pb = [...Array(8).keys()].map((x) => b.rt.screens.get(0)!.rp.point(x, 0))
    expect(pb).toEqual(pa)
  })

  it('y is a PIXEL row, not a text row', () => {
    // `mulu.w d1,d4` with d1 = EcTx>>3 -- so y steps one pixel, not eight
    const { rt } = run([
      ...fscr,
      'Reserve As Work 5,2048',
      ...glyph(5, 65),
      'Change Print Font 5',
      'Ink 3 : Turbo Text 0,3,"A"',
    ])
    const s = rt.screens.get(0)!
    expect(s.rp.point(0, 2)).toBe(0)
    expect(s.rp.point(0, 3)).toBe(3)
    expect(s.rp.point(0, 10)).toBe(3)
    expect(s.rp.point(0, 11)).toBe(0)
  })

  it('x must be a multiple of 8, and anything else silently does nothing', () => {
    // `andi.w #$7,d0 / tst.w d0 / bne` reaches two `rts` in a row
    const { rt } = run([
      ...fscr,
      'Reserve As Work 5,2048',
      ...glyph(5, 65),
      'Change Print Font 5',
      'Ink 3 : Turbo Text 4,0,"A"',
    ])
    const s = rt.screens.get(0)!
    for (let x = 0; x < 16; x++) expect(s.rp.point(x, 0)).toBe(0)
  })

  it('a negative coordinate is error 23, and so is a y past height minus eight', () => {
    // `Rbmi routine 390` on each, then `cmp.w d0,d4 / Rbhi` against EcTy-8
    expect(() => run([...fscr, 'Turbo Text -8,0,"A"'])).toThrow(/Illegal function call/)
    expect(() => run([...fscr, 'Turbo Text 0,-1,"A"'])).toThrow(/Illegal function call/)
    expect(() => run([...fscr, 'Turbo Text 0,25,"A"'])).toThrow(/Illegal function call/)
    expect(() => run([...fscr, 'Turbo Text 0,24,"A"'])).not.toThrow() // 32 - 8
  })

  it('a string running off the right edge is clipped, not wrapped', () => {
    // `move.w d1,d5 / sub.w d3,d5 / subq.w #$1,d5` -- the count is cut to the
    // cells that are left, and 64 pixels wide is eight of them
    const { rt } = run([
      ...fscr,
      'Reserve As Work 5,2048',
      ...glyph(5, 65),
      'Change Print Font 5',
      'Ink 3 : Turbo Text 48,0,"AAAA"',
    ])
    const s = rt.screens.get(0)!
    expect(s.rp.point(48, 0)).toBe(3)
    expect(s.rp.point(56, 0)).toBe(3)
    // nothing wrapped onto the next row
    expect(s.rp.point(0, 1)).toBe(0)
  })

  it('an empty string pops its arguments and returns', () => {
    // `move.w (a1)+,d5 / bne` else `addq.l #$8,a3 / rts`
    const { rt } = run([...fscr, 'Ink 3 : Turbo Text 0,0,""'])
    expect(rt.screens.get(0)!.rp.point(0, 0)).toBe(0)
  })
})

/**
 * Change Font against the real `.font` tree off the original partition —
 * routine 144 ($4030) is OpenDiskFont and SetFont and nothing else, so this is
 * the only one of the five that needs a font to exist.
 */
const AMCAF_FONTS = join(__dirname, '..', '..', 'fixtures', 'fonts')

describe.skipIf(!existsSync(AMCAF_FONTS))('AMCAF: Change Font with a real face (routine 144, $4030)', () => {
  function boot(src: string[]): Runtime {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    fs.mount('FontDisc', new NodeVolume(AMCAF_FONTS))
    fs.assign('Fonts', 'FontDisc:')
    const rt = new Runtime(tokenize(src.join('\n'), table, extensions), table, {
      maxSteps: 1_000_000,
      extensions,
      fs,
    })
    const r = rt.runHeadless(200)
    if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
    return rt
  }

  it('opens the named face onto rp_Font, the field Set Font writes', () => {
    const rt = boot(['Screen Open 0,320,64,4,Lowres', 'Change Font "2001.font",8'])
    expect(rt.screen.rp.font).not.toBeNull()
    expect(rt.screen.rp.font!.ySize).toBe(8)
    // Screen.font IS rp_Font, so AMOS's own Text sees what AMCAF installed
    expect(rt.screen.font).toBe(rt.screen.rp.font)
  })

  it('the height defaults to 8, which is routine 142 pushing it', () => {
    // `moveq #$8,d0 / move.l d0,-(a3) / Rbra routine 143`
    const rt = boot(['Screen Open 0,320,64,4,Lowres', 'Change Font "2001.font"'])
    expect(rt.screen.rp.font!.ySize).toBe(8)
  })

  it('the ".font" suffix is added when it is missing', () => {
    // `cmpi.b #$2e,-$5(a1) / beq` then five literal bytes at $4080-$4090, and
    // the changelog dates it: "Change Font now adds '.font' automatically"
    const rt = boot(['Screen Open 0,320,64,4,Lowres', 'Change Font "2001",8'])
    expect(rt.screen.rp.font).not.toBeNull()
  })

  it('a size the family has not got is requester message 10', () => {
    // `jsr -$1e(a6) / tst.l d0 / bne` else `moveq #$a,d0 / Rbra routine 397`,
    // and message 10 is "Couldn't open font"
    expect(() => boot(['Screen Open 0,320,64,4,Lowres', 'Change Font "2001.font",9'])).toThrow(/Couldn't open font/)
  })

  it('Make Bank Font round-trips a real face through the bank and back', () => {
    // the point of the pair: "These banks don't require the 'diskfont.library'
    // or other disk access any more, once they have been created"
    const rt = boot([
      'Screen Open 0,320,64,4,Lowres',
      'Change Font "2001.font",8',
      'Make Bank Font 7',
      'Change Font "2001.font",8', // put something else on rp_Font first
      'Change Bank Font 7',
    ])
    const f = rt.screen.rp.font!
    expect(f.ySize).toBe(8)
    expect(f.xSize).toBe(8)
    // dfh_Name is BLANK in every one of the eight size files on this disc --
    // the name lives in the `.font` descriptor, not the loadable file -- so
    // `movea.l $a(a2),a0 / 15 x move.w` copies thirty zero bytes on the
    // machine too. Faithful, and not much of a name
    expect(f.name).toBe('')
    // the glyphs themselves came back byte for byte
    const src = rt.memBanks.get(7)!.data
    const v = new DataView(src.buffer, src.byteOffset, src.byteLength)
    expect(f.charData.length).toBe(f.ySize * f.modulo)
    expect([...f.charData]).toEqual([...src.subarray(v.getUint32(8), v.getUint32(8) + f.charData.length)])
  })

  it('a proportional face keeps its CharSpace, and the bank grows for it', () => {
    // Pica/32 is proportional, so `tst.l $2c(a2)` is non-zero and the size
    // gains another d6 -- two bytes a character
    const rt = boot(['Screen Open 0,320,64,4,Lowres', 'Change Font "Pica.font",32', 'Make Bank Font 7', 'Change Bank Font 7'])
    const f = rt.screen.rp.font!
    expect(f.ySize).toBe(32)
    expect(f.proportional).toBe(true)
    expect(f.charSpace).not.toBeNull()
    const d = rt.memBanks.get(7)!.data
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
    expect(v.getUint32(0x10)).toBeGreaterThan(0) // the CharSpace offset is set
  })
})

/**
 * Reset Computer — routine 203 (1.40) / 215 ($4ff0, 1.50). Both of its arms
 * are a cold boot: ColdReboot on Kickstart 37+, and below that a hand-rolled
 * entry through the ROM's own reset vector.
 */
describe('AMCAF: Reset Computer, and the machine underneath it', () => {
  it('asks the machine for a COLD reset and ends the program there', () => {
    const { rt, out } = run(['Print "before"', 'Reset Computer', 'Print "after"'])
    expect(rt.machine.pendingReset).toEqual({ kind: 'cold', by: 'reset computer' })
    // it never returns on the machine; here the program stops, as System does
    expect(out).toContain('before')
    expect(out).not.toContain('after')
  })

  it('a reset ENDS the program rather than failing it', () => {
    // the census would otherwise report every rebooting program as a crash
    let out = ''
    const rt = new Runtime(tokenize('Reset Computer', table, extensions), table, {
      maxSteps: 1_000_000,
      extensions,
      onText: (t) => (out += t),
    })
    expect(rt.runHeadless(20).status).toBe('ended')
  })

  it('the machine outlives the Runtime when a caller supplies one', () => {
    // the whole point of passing it in: a reset destroys the environment and
    // not the thing it ran on, so the request survives to be acted on
    const machine = new Machine()
    const first = new Runtime(tokenize('Reset Computer', table, extensions), table, { extensions, machine })
    first.runHeadless(20)
    expect(machine.pendingReset?.kind).toBe('cold')
    const second = new Runtime(tokenize('Print "up"', table, extensions), table, { extensions, machine })
    expect(second.machine).toBe(machine)
    expect(second.machine.takeReset()?.by).toBe('reset computer')
    expect(machine.pendingReset).toBeNull()
  })

  it('without one, each Runtime gets its own and nothing leaks between them', () => {
    const a = new Runtime(tokenize('Reset Computer', table, extensions), table, { extensions })
    a.runHeadless(20)
    const b = new Runtime(tokenize('Print "up"', table, extensions), table, { extensions })
    expect(a.machine.pendingReset).not.toBeNull()
    expect(b.machine.pendingReset).toBeNull()
  })
})

/**
 * Launch — routines 209 (1.40) and 221/222 ($512e/$513a): LoadSeg then
 * CreateProc, on the seam in src/amiga/process.ts.
 */
describe('AMCAF: Launch, on the process seam', () => {
  /** the smallest thing hunk.ts accepts as an AmigaDOS binary */
  const BINARY = Uint8Array.from([
    0, 0, 3, 0xf3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    0, 0, 3, 0xe9, 0, 0, 0, 1, 0x4e, 0x75, 0, 0, 0, 0, 3, 0xf2,
  ])

  function boot(src: string[], host?: Partial<Runtime['host']>): Runtime {
    const fs = new AmigaFS()
    const vol = fs.mountMemory('Work')
    vol.write(['real'], BINARY)
    vol.write(['junk'], Uint8Array.from([1, 2, 3, 4]))
    fs.currentDir = 'Work:'
    const rt = new Runtime(tokenize(src.join('\n'), table, extensions), table, {
      maxSteps: 1_000_000,
      extensions,
      fs,
      ...(host ? { host } : {}),
    })
    const r = rt.runHeadless(200)
    if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
    return rt
  }

  it('a file that will not LoadSeg is an AmigaDOS error, not the requester', () => {
    // `jsr -$96(a6)` LoadSeg then `Rbeq routine 391` -- AMCAF's dos-error
    // path, which is AMOS error 81
    // error 81 is what routine 391 raises everywhere in this port -- the same
    // one Ppfromdisk and the Object accessors reach
    expect(() => boot(['Launch "nothere"'])).toThrow(/File format not recognised/)
    // and a file that exists but is not a binary fails the same way
    expect(() => boot(['Launch "junk"'])).toThrow(/File format not recognised/)
  })

  it('a file that DOES load reaches the other failure — message 11', () => {
    // the segment loaded, so `jsr -$8a(a6)` CreateProc is what returned NULL,
    // and that is `moveq #$b,d0 / Rbra routine 397`. Nothing here can start a
    // process, so this is the branch the routine itself takes when the machine
    // is out of memory -- a real answer, not a stub
    expect(() => boot(['Launch "real"'])).toThrow(/Couldn't launch process/)
  })

  it('with a host that can start one, it just returns', () => {
    const rt = boot(['Launch "real"', 'Print "after"'], { process: { launch: () => true } })
    expect(rt).toBeTruthy()
  })

  it('the default stack is 4096, and the second argument replaces it', () => {
    // `moveq #$0,d0 / move.w #$1000,d0` in routine 221
    const seen: number[] = []
    const host = { process: { launch: (r: { stackSize: number }) => (seen.push(r.stackSize), true) } }
    boot(['Launch "real"', 'Launch "real",65536'], host)
    expect(seen).toEqual([0x1000, 65536])
  })

  it('the priority is always 0 — the routine never takes one', () => {
    // `moveq #$0,d2` before CreateProc; there is no third argument
    let pri = -1
    const host = { process: { launch: (r: { priority: number }) => ((pri = r.priority), true) } }
    boot(['Launch "real"'], host)
    expect(pri).toBe(0)
  })
})

/**
 * Pptodisk — routines 235 ($59e4) and 234 ($58d2), the PowerPacker cruncher
 * and the other half of Ppunpack / Ppfromdisk.
 */
describe('AMCAF: Pptodisk (routines 234 and 235)', () => {
  function boot(src: string[]): { rt: Runtime; fs: AmigaFS } {
    const fs = new AmigaFS()
    fs.mountMemory('Work')
    fs.currentDir = 'Work:'
    const rt = new Runtime(tokenize(src.join('\n'), table, extensions), table, {
      maxSteps: 2_000_000,
      extensions,
      fs,
    })
    const r = rt.runHeadless(400)
    if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
    return { rt, fs }
  }

  const fill = ['Reserve As Work 5,1024', 'For I=0 To 1023 : Poke Start(5)+I,I And 15 : Next I']

  it('writes a real PP20 file, and Ppunpack reads it back byte for byte', () => {
    // the round trip is the proof: this port's own decruncher, which was
    // written against real corpus files, accepts what the cruncher emits
    const { rt, fs } = boot([
      ...fill,
      'Pptodisk "Work:b.pp",5',
      'Ppfromdisk "Work:b.pp",6',
    ])
    const f = fs.readFile('Work:b.pp')!
    expect(String.fromCharCode(...f.subarray(0, 4))).toBe('PP20')
    expect([...rt.memBanks.get(6)!.data]).toEqual([...rt.memBanks.get(5)!.data])
  })

  it('the efficiency table it writes is the one the corpus uses', () => {
    // every PP20 file in the fixtures carries [9,10,12,13] at offset 4
    const { fs } = boot([...fill, 'Pptodisk "Work:b.pp",5'])
    expect([...fs.readFile('Work:b.pp')!.subarray(4, 8)]).toEqual([9, 10, 12, 13])
  })

  it('the third argument is accepted and changes nothing', () => {
    // it is handed straight to powerpacker.library, and the 0..4 to table
    // mapping lives there rather than in this binary. No range check either
    const a = boot([...fill, 'Pptodisk "Work:b.pp",5']).fs.readFile('Work:b.pp')!
    for (const eff of ['0', '2', '4', '99', '-1']) {
      const b = boot([...fill, `Pptodisk "Work:c.pp",5,${eff}`]).fs.readFile('Work:c.pp')!
      expect([...b]).toEqual([...a])
    }
  })

  it('the crunched file is smaller than the bank it came from', () => {
    // 1024 bytes of a repeating 16-value ramp is exactly what LZ77 eats
    const { fs } = boot([...fill, 'Pptodisk "Work:b.pp",5'])
    expect(fs.readFile('Work:b.pp')!.length).toBeLessThan(1024)
  })

  it('a sprite or icon bank is message 4, by the same stand-in Ppunpack uses', () => {
    // the kind bits live twelve bytes below the data and this port has no
    // equivalent, so banks 1 and 2 stand in for them
    const { rt } = boot(['Reserve As Work 5,16'])
    expect(rt.spriteBank).toBeNull()
    // with no sprite bank loaded, bank 1 is just a bank
    expect(() => boot(['Reserve As Work 1,64', 'Pptodisk "Work:x.pp",1'])).not.toThrow()
  })

  it('a bank that was never reserved is error 23', () => {
    expect(() => boot(['Pptodisk "Work:x.pp",9'])).toThrow(/Illegal function call/)
  })
})

/**
 * The extension table at `$f8(a5)` — Extbase, Extdefault and Extremove, which
 * index it 16 bytes to the slot and read `+$0`, `+$4` and `+$8`. Routines 133
 * ($3c8e), 134 ($3cac) and 135 ($3cd8); Extreinit, routine 136 ($3d08), is n/a
 * because it calls the extension's own init code.
 *
 * These need real BINDINGS, not just token tables: the whole point of the
 * group is that a slot number resolves to a particular extension.
 */
describe('AMCAF: the extension table', () => {
  const TURBO_SLOT = 12
  const turbo = extensionById('turbo-plus-2.15')!
  const amcaf = extensionById('amcaf-1.50')!
  const bound = new Map([
    [AMCAF_SLOT, amcaf],
    [TURBO_SLOT, turbo],
  ])
  const tables = new Map([
    [AMCAF_SLOT, amcaf.table],
    [TURBO_SLOT, turbo.table],
  ])

  /** `prepare` runs before the program, so a test can set state to reset */
  function runBound(src: string[], prepare?: (rt: Runtime) => void): { out: string; rt: Runtime } {
    let out = ''
    const rt = new Runtime(tokenize(src.join('\n'), table, tables), table, {
      maxSteps: 1_000_000,
      extensions: tables,
      extBindings: bound,
      onText: (t) => (out += t),
    })
    prepare?.(rt)
    const r = rt.runHeadless(200)
    if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
    return { out, rt }
  }

  it('an occupied slot answers non-zero and an empty one answers 0', () => {
    // the comparison every program actually makes -- "is AMCAF loaded"
    const { out } = runBound(['Print Extbase(8)<>0', 'Print Extbase(4)'])
    expect(out.split('\n').slice(0, 2)).toEqual(['-1', ' 0'])
  })

  it('each slot gets a distinct base', () => {
    const { out } = runBound(['Print Extbase(8)<>Extbase(12)'])
    expect(out.trim()).toBe('-1')
  })

  it('slot 0 and slot 27 are error 23, in all three', () => {
    // `subq.l #$1,d0 / Rbmi` and `moveq #$1a,d1 / cmp.l d1,d0 / Rbge`, the
    // same six instructions in routines 133, 134 and 135
    for (const src of ['Print Extbase(0)', 'Extdefault 0', 'Extremove 0']) {
      expect(() => runBound([src])).toThrow(/Illegal function call/)
    }
    for (const src of ['Print Extbase(27)', 'Extdefault 27', 'Extremove 27']) {
      expect(() => runBound([src])).toThrow(/Illegal function call/)
    }
    // 1 and 26 are the far ends and are legal
    expect(() => runBound(['Extdefault 1', 'Extdefault 26'])).not.toThrow()
  })

  it("Extdefault runs that slot's default routine and only that one", () => {
    // TURBO's +$4: "Scene Icon Bank is set to 2 ... when you call Default"
    const set = (rt: Runtime): void => void (rt.turbo.scene.iconBank = 5)
    expect(runBound(['Extdefault 12'], set).rt.turbo.scene.iconBank).toBe(2)
    // AMCAF's own slot declares no default routine, which on the machine is
    // the null pointer at +$4 -- `beq` past the call, nothing touched
    expect(runBound(['Extdefault 8'], set).rt.turbo.scene.iconBank).toBe(5)
  })

  it('the core Default calls the same hook, for every occupied slot', () => {
    const set = (rt: Runtime): void => void (rt.turbo.scene.iconBank = 5)
    expect(runBound(['Default'], set).rt.turbo.scene.iconBank).toBe(2)
  })

  it('Extreinit rebuilds the whole state, where Extdefault resets settings', () => {
    // the difference is the point: TURBO's default routine puts back Scene
    // Icon Bank and the mask palette, and its init builds a fresh TurboState.
    // Anything that is NOT one of those two settings survives one and not
    // the other
    const set = (rt: Runtime): void => {
      rt.turbo.scene.iconBank = 5
      rt.turbo.objects.limit = 8
    }
    const def = runBound(['Extdefault 12'], set).rt
    expect(def.turbo.scene.iconBank).toBe(2)
    expect(def.turbo.objects.limit).toBe(8)

    const re = runBound(['Extreinit 12'], set).rt
    expect(re.turbo.scene.iconBank).toBe(2)
    expect(re.turbo.objects.limit).toBe(0)
  })

  it('Extreinit on a slot whose port declares no init does nothing', () => {
    expect(() => runBound(['Extreinit 1'])).not.toThrow()
  })

  it('Extremove leaves the base alone — it clears +$8, not +$0', () => {
    const { out } = runBound(['Extremove 8', 'Print Extbase(8)<>0'])
    expect(out.trim()).toBe('-1')
  })

  it('a second Extremove is not an error either', () => {
    expect(() => runBound(['Extremove 8', 'Extremove 8'])).not.toThrow()
  })
})
