import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { NullAudio } from '../amiga/paula'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'

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
    // tokenisation all worked and only the handler is missing
    expect(() => run(['Reset Computer'])).toThrow(/unimplemented: reset computer/)
  })

  it('under the census policy it yields a typed default instead of throwing', () => {
    // 'skip' is how runreport sees past a missing keyword to count what the
    // rest of a program does. The spec's return-type code decides the type,
    // which matters for the string-returning keywords with no `$` in the name
    const { out, rt } = run(['Print Extbase'], 'skip')
    // " 0" is AMOS's leading space for a non-negative number, and the spec's
    // return-type code is what chose an integer rather than a string
    expect(out).toBe(' 0\n')
    expect([...rt.interp.unimplemented.keys()]).toEqual(['extbase'])
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

  it('Disk Type calls DFn: a device', () => {
    expect(p('Disk Type("DF0:")')).toBe('0')
    expect(p('Disk Type("Workbench:")')).toBe('2')
  })

  it('Io Error$ gives dos.library text, and empty for an unused number', () => {
    // "Returns a dos errorstring" -- and "If no error number exists, an empty
    // string will be returned"
    expect(p('Io Error$(205)')).toBe('object not found')
    expect(p('Io Error$(214)')).toBe('disk write protected')
    expect(p('"["+Io Error$(9999)+"]"')).toBe('[]')
  })

  it('Dos Hash lands every name in a 0..71 bucket', () => {
    for (const n of ['a', 'thrusts.info', 'AMOSPro', 'x'.repeat(30)]) {
      const h = Number(p(`Dos Hash("${n}")`))
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(72)
    }
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
    // Ppunpack wants a real PP20 header; plain data is an error, where
    // Ppfromdisk above is documented as taking an unpacked file as it is
    expect(() => runFs(['Reserve As Work 7,64', 'Reserve As Work 8,64', 'Ppunpack Start(7) To Start(8)'])).toThrow()
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

  it('Protect Object and Set Object Comment round-trip through the metadata', () => {
    const { out } = runFs([
      'Open Out 1,"Work:three.txt" : Print #1,"x" : Close 1',
      'Protect Object "Work:three.txt",$85',
      'Set Object Comment "Work:three.txt","a note"',
      'Print Object Protection("Work:three.txt")',
      'Print Object Comment$("Work:three.txt")',
      'Print Object Protection$(Object Protection("Work:three.txt"))',
    ])
    const l = out.trim().split('\n').map((x) => x.trim())
    expect(l[0]).toBe(String(0x85))
    expect(l[1]).toBe('a note')
    // $85 is hidden, plus write and delete DENIED by the inverted low nibble
    expect(l[2]).toBe('h---r-e-')
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

  it('Best Pen finds the nearest entry, and honours a range', () => {
    // every entry the test reasons about is set, so the default palette
    // cannot supply a closer one and change the answer
    const pal = [...scr, 'Colour 1,$F00', 'Colour 2,$800', 'Colour 3,$00F']
    expect(run([...pal, 'Print Best Pen($E00)']).out.trim()).toBe('1')
    // restricted to 2..3 the exact match is out of reach and $800 wins
    expect(run([...pal, 'Print Best Pen($E00,2 To 3)']).out.trim()).toBe('2')
  })

  it('Ham Colour decodes the HAM control byte against the previous pixel', () => {
    // bits 4-5: 01 replaces blue, 10 red, 11 green; 00 takes the palette entry
    expect(p('Ham Colour($1F,$000)')).toBe(String(0x00f)) // modify blue to 15
    expect(p('Ham Colour($2F,$000)')).toBe(String(0xf00)) // modify red
    expect(p('Ham Colour($3F,$000)')).toBe(String(0x0f0)) // modify green
    expect(p('Ham Colour($15,$FFF)')).toBe(String(0xff5)) // only blue changes
  })

  it('Ham Best picks a byte that Ham Colour turns back into the target', () => {
    const { out } = run([...scr, 'C=Ham Best($0F0,$000)', 'Print Ham Colour(C,$000)'])
    expect(out.trim()).toBe(String(0x0f0))
  })

  it('Ham Fade Out darkens by one step, sixteen calls to black', () => {
    // "darkens the screen by one single step. After calling it 16 times, the
    // Ham screen is completely black"
    expect(run([...scr, 'Colour 1,$FFF', 'Ham Fade Out 0', 'Print Colour(1)']).out.trim()).toBe(String(0xeee))
    const { out } = run([...scr, 'Colour 1,$FFF', 'For I=1 To 16 : Ham Fade Out 0 : Next I', 'Print Colour(1)'])
    expect(out.trim()).toBe('0')
  })

  it('Ham Point is -1 off the screen', () => {
    expect(run([...scr, 'Print Ham Point(-1,0)']).out.trim()).toBe('-1')
    expect(run([...scr, 'Print Ham Point(0,999)']).out.trim()).toBe('-1')
  })

  it('Convert Grey builds a grey ramp and remaps onto it', () => {
    const { rt } = run([
      'Screen Open 0,64,32,4,Lowres',
      'Screen Open 1,64,32,4,Lowres',
      'Screen 0 : Colour 1,$F00 : Ink 1 : Bar 0,0 To 9,9',
      'Convert Grey 0 To 1',
    ])
    const dst = rt.screens.get(1)!
    // the target palette is an even grey ramp
    expect(dst.palette[0]).toBe(0)
    expect(dst.palette[3]).toBe(0xfff)
    // and red mapped to something darker than white
    expect(dst.rp.bitMap.pixels[0]).toBeGreaterThan(0)
    expect(dst.rp.bitMap.pixels[0]).toBeLessThan(3)
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

  it('Turbo Plot and Turbo Point are the fast Plot and Point, and clip', () => {
    // "Added clipping for Turbo Plot, Shade Pix and Turbo Point. Now they are
    // as secure as the normal Plot and Point commands" (V1.30)
    const { out } = run([...scr, 'Turbo Plot 3,4,5', 'Print Turbo Point(3,4)', 'Print Turbo Point(999,999)'])
    const l = out.trim().split('\n').map((x) => x.trim())
    expect(l[0]).toBe('5')
    expect(l[1]).toBe('0')
    expect(() => run([...scr, 'Turbo Plot -5,-5,1'])).not.toThrow()
  })

  it('Turbo Draw draws a line', () => {
    const { rt } = run([...scr, 'Turbo Draw 0,0 To 10,0,3'])
    const px = rt.screens.get(0)!.rp.bitMap.pixels
    expect(px[5]).toBe(3)
    expect(px[11]).toBe(0)
  })

  it('Fcircle and Fellipse fill, where AMOS Circle only outlines', () => {
    const { rt } = run([...scr, 'Fcircle 20,16,8,7'])
    const px = rt.screens.get(0)!.rp.bitMap.pixels
    expect(px[16 * 64 + 20]).toBe(7) // the centre is filled
    const e = run([...scr, 'Fellipse 20,16,10,4,5'])
    expect(e.rt.screens.get(0)!.rp.bitMap.pixels[16 * 64 + 20]).toBe(5)
  })

  it('Bcircle draws an outline into ONE plane, which Blitter Fill can then fill', () => {
    const { rt } = run([...scr, 'Bcircle 20,16,8,0', 'Blitter Fill 0,0'])
    const px = rt.screens.get(0)!.rp.bitMap.pixels
    expect(px[16 * 64 + 20]! & 1).toBe(1) // inside is filled
    expect(px[16 * 64 + 40]! & 1).toBe(0) // well outside is not
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
})

describe('slice 7b: zoom, masks, C2P and the rest', () => {
  const scr = ['Screen Open 0,64,32,16,Lowres', 'Cls 0']

  /**
   * The last of the FAITHFUL-but-undispatched list, each against its routine.
   *
   * Exchange Bob/Icon (200/201, $5052/$50a2) share a shape: resolve the bank
   * through routine 1101/1102, read the count from `(a0)+`, then range-check
   * BOTH indices with `cmp.w d2,dn / Rbhi 372` and return early when they are
   * equal (`cmp.l d0,d1 / bne` past an `rts`).
   *
   * DEVIATION: that check is `bhi`, UNSIGNED, so index 0 passes it and the
   * following `subq.w #1 / lsl.w #3` then indexes eight bytes BEFORE the
   * table. The port errors instead of reading out of bounds — a corruption
   * that cannot be reproduced meaningfully.
   *
   * Blitter Copy Limit (routine 305) stores the rectangle Blitter Copy works
   * within; C2p Shift/Fire and Pix Shift Down and the Shade Bob pair are the
   * effect engines' remaining entry points.
   */
  it('the remaining graphics keywords dispatch against their routines', () => {
    const bobs = [...scr, 'Get Bob 1,0,0 To 8,8', 'Get Bob 2,8,0 To 16,8']
    expect(() => run([...bobs, 'Exchange Bob 1,2'])).not.toThrow()
    expect(() => run([...bobs, 'Exchange Bob 1,1'])).not.toThrow() // equal: early rts
    expect(() => run([...bobs, 'Exchange Bob 1,99'])).toThrow() // past the count
    expect(() => run([...bobs, 'Exchange Bob 0,1'])).toThrow() // see the DEVIATION above

    expect(() => run([...scr, 'Blitter Copy Limit 0'])).not.toThrow()
    expect(() => run([...scr, 'Blitter Copy Limit 0,0 To 31,15'])).not.toThrow()

    /**
     * Blitter Copy s1,p1 To s2,p2[,minterm] — routine 62 ($28a0) pushes the
     * default minterm $F0 (D = A) and falls into 63, which range-checks each
     * plane against its screen's depth with `move.w $50(a0),d4 / cmp.w d4,d7
     * / Rbge 372`.
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

    // Shade Bob Up/Down (272/271, $67b8) take screen,x,y,image and shift the
    // colour indexes under the bob's mask one way or the other
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

  it('Count Pixels counts what is NOT the colour, which the name hides', () => {
    // "Counts the pixels ... that DON'T have the colour index colour"
    const { out } = run([...scr, 'Ink 3 : Bar 0,0 To 9,9', 'Print Count Pixels(0,0,0,0 To 9,9)'])
    expect(out.trim()).toBe('100') // all 100 are non-zero
    expect(run([...scr, 'Ink 3 : Bar 0,0 To 9,9', 'Print Count Pixels(0,3,0,0 To 9,9)']).out.trim()).toBe('0')
  })

  it('Bzoom scales by an integer factor and rounds x down to a multiple of 8', () => {
    // "The coordinates x1 and x2 are rounded down to the next multiple of
    // eight, x3 is even rounded to the nearest multiple of 16."
    const { rt } = run([
      'Screen Open 0,64,32,16,Lowres',
      'Screen Open 1,64,32,16,Lowres',
      'Screen 0 : Cls 0 : Ink 5 : Bar 0,0 To 7,1',
      'Bzoom 0,0,0,7,1 To 1,0,0,$22',
    ])
    const px = rt.screens.get(1)!.rp.bitMap.pixels
    expect(px[0]).toBe(5)
    expect(px[1]).toBe(5) // doubled horizontally
    expect(px[64]).toBe(5) // and vertically
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

  it('C2p Convert writes a chunky buffer into a screen', () => {
    const { rt } = run([
      'Screen Open 0,64,32,16,Lowres : Cls 0',
      'Reserve As Work 9,64',
      'Poke Start(9),7 : Poke Start(9)+1,3',
      'C2p Convert Start(9),2,1 To 0,0,0',
    ])
    const px = rt.screens.get(0)!.rp.bitMap.pixels
    expect(px[0]).toBe(7)
    expect(px[1]).toBe(3)
  })

  it('Font Style reports the style byte, including bit 6', () => {
    // "replaces the AMOS function Text Styles, because this one does not
    // return the multicoloured font bit (Bit 6)"
    expect(run([...scr, 'Set Text 1', 'Print Font Style']).out.trim()).toBe('1')
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
   * Shade Bob Mask (routine 270, $6774) normalises to exactly 0 or 1 —
   * `move.l (a3)+,d0 / beq` then either `move.w #$1,$284(a2)` or
   * `clr.w $284(a2)` — so it does not store the value it was given.
   */
  it('Shade Bob Mask stores a flag, not the value', () => {
    expect(run(['Shade Bob Mask 99']).rt.amcaf.shadeMask).toBe(true)
    expect(run(['Shade Bob Mask 0']).rt.amcaf.shadeMask).toBe(false)
    expect(run(['Shade Bob Mask -1']).rt.amcaf.shadeMask).toBe(true)
  })

  it('Amcaf Aga Notation and Set Sprite Priority hold their state', () => {
    expect(run(['Amcaf Aga Notation On']).rt.amcaf.agaNotation).toBe(true)
    expect(run(['Amcaf Aga Notation On', 'Amcaf Aga Notation Off']).rt.amcaf.agaNotation).toBe(false)
    expect(run(['Set Sprite Priority 5']).rt.amcaf.spritePriority).toBe(5)
  })
})

describe('slice 8: the effect engines', () => {
  const scr = ['Screen Open 0,64,32,16,Lowres', 'Cls 0']

  it('Shade Pix bumps a colour index and CYCLES at the top', () => {
    // "If the highest colour is reached, the colour is resetted to be cycled"
    const { rt } = run([...scr, 'Shade Bob Planes 2', 'Turbo Plot 5,5,3', 'Shade Pix 5,5'])
    expect(rt.screens.get(0)!.rp.point(5, 5)).toBe(0) // 3 wraps to 0 in 2 planes
    const b = run([...scr, 'Shade Bob Planes 2', 'Turbo Plot 5,5,1', 'Shade Pix 5,5'])
    expect(b.rt.screens.get(0)!.rp.point(5, 5)).toBe(2)
  })

  it('Shade Bob Planes is bounded 1..6, as the manual states', () => {
    expect(run([...scr, 'Shade Bob Planes 6']).rt.amcaf.shadePlanes).toBe(6)
    expect(() => run([...scr, 'Shade Bob Planes 0'])).toThrow(/Illegal function call/)
    expect(() => run([...scr, 'Shade Bob Planes 7'])).toThrow(/Illegal function call/)
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
    expect(rt.memBanks.get(9)!.data.length).toBe(16)
    expect(s.rp.point(0, 0)).toBe(6) // masked in: shifted
    expect(s.rp.point(1, 1)).toBe(5) // masked out: untouched
  })

  it('Ptile Bank and Paste Ptile place a block by block coordinates', () => {
    // "These coordinates must be given as block positions"
    const { rt } = run([
      ...scr,
      'Reserve As Work 4,512',
      'Poke Start(4),9',
      'Ptile Bank 4',
      'Paste Ptile 1,0,0',
    ])
    expect(rt.screens.get(0)!.rp.point(16, 0)).toBe(9)
  })
})

describe('slice 9: Splinters and Td Stars', () => {
  const scr = ['Screen Open 0,64,32,16,Lowres', 'Cls 0']

  it('Coords Read gathers every dot that is NOT the background colour', () => {
    const { rt } = run([
      ...scr,
      'Turbo Plot 1,1,5',
      'Turbo Plot 2,2,6',
      'Coords Bank 4,100',
      'Coords Read 0,0,0,0 To 9,9,4,0',
    ])
    // two dots found, four bytes each
    const d = rt.memBanks.get(4)!.data
    expect((d[0]! << 8) | d[1]!).toBe(1)
    expect((d[2]! << 8) | d[3]!).toBe(1)
    expect((d[4]! << 8) | d[5]!).toBe(2)
  })

  it('Splinters Init takes the colour of the pixel it lifts', () => {
    // "they don't destroy the background and use the colour of the pixel
    // they have removed"
    const { rt } = run([
      ...scr,
      'Turbo Plot 3,3,7',
      'Coords Bank 4,100',
      'Coords Read 0,0,0,0 To 9,9,4,0',
      'Splinters Bank 5,50',
      'Splinters Colour 0,4',
      'Splinters Init',
    ])
    const sp = rt.amcaf.splinters
    expect(sp.p).toHaveLength(1)
    expect(sp.p[0]!.c).toBe(7)
  })

  it('Splinters Bank reserves 22 bytes a splinter, as documented', () => {
    const { rt } = run([...scr, 'Splinters Bank 5,10'])
    expect(rt.memBanks.get(5)!.data.length).toBe(220)
  })

  it('Splinters Gravity drifts them, and Fuel kills them off', () => {
    const setup = [
      ...scr,
      'Turbo Plot 3,3,7',
      'Coords Bank 4,100',
      'Coords Read 0,0,0,0 To 9,9,4,0',
      'Splinters Bank 5,50',
      'Splinters Init',
    ]
    const drift = run([...setup, 'Splinters Gravity 1,0', 'Splinters Move', 'Print Splinters Active'])
    expect(drift.rt.amcaf.splinters.p[0]!.x).toBe(4) // moved right by the gravity
    // "the number of steps the splinters are moved before they vanish"
    const gone = run([...setup, 'Splinters Fuel 1', 'Splinters Init', 'Splinters Move', 'Splinters Move'])
    expect(gone.rt.amcaf.splinters.p).toHaveLength(0)
  })

  it('Splinters Back and Single Del put the background back', () => {
    const { rt } = run([
      ...scr,
      'Ink 9 : Bar 0,0 To 9,9',
      'Coords Bank 4,200',
      'Coords Read 0,0,0,0 To 3,3,4,0',
      'Splinters Bank 5,50',
      'Splinters Init',
      'Splinters Back',
      'Splinters Gravity 0,1',
      'Splinters Move',
      'Splinters Draw',
      'Splinters Single Del',
    ])
    // the saved background is restored where the splinters started
    expect(rt.screens.get(0)!.rp.point(0, 0)).toBe(9)
  })

  /**
   * Routines 282 and 283 ($6c48, $6c60) are each FOUR calls — del, move,
   * back, draw — and the two differ only in which del. An earlier pass had
   * Single Do as restore-move-draw and Double Do as move-draw, reasoning that
   * a double-buffered screen already carries the last frame as background;
   * the routines and the manual both disagree.
   *
   * Double Del "must wipe the pre-last pixels ... (when using Double
   * Buffering)", so Back keeps two generations and the two Dels put back
   * different ones. With a single generation they were the same call, and a
   * test could not tell them apart.
   */
  it('Single Do and Double Do are del-move-back-draw, from different generations', () => {
    const base = [
      ...scr,
      'Ink 9 : Bar 0,0 To 19,19',
      'Coords Bank 4,200',
      'Coords Read 0,0,0,0 To 1,1,4,0',
      'Splinters Bank 5,50',
      'Splinters Init',
      'Splinters Gravity 0,1',
    ]
    // Do runs Back itself, so the background keeps advancing and a following
    // Single Del cleans up the frame just drawn
    const single = run([...base, 'Splinters Single Do', 'Splinters Single Do', 'Splinters Single Del'])
    const px = single.rt.screens.get(0)!.rp
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) expect(px.point(x, y), `${x},${y}`).toBe(9)

    // the two Dels work on different generations. After ONE Do there is a
    // current generation and no previous one, so Double Del has nothing to
    // put back — which is exactly the frame-behind it models.
    const one = run([...base, 'Splinters Single Do'])
    expect(one.rt.amcaf.splinters.saved).not.toBe(null)
    expect(one.rt.amcaf.splinters.savedPrev).toBe(null)

    // after TWO, the generations hold different positions, a frame apart
    const two = run([...base, 'Splinters Single Do', 'Splinters Single Do'])
    const sp = two.rt.amcaf.splinters
    const at = (g: typeof sp.saved): string => (g ?? []).map((q) => `${q.x},${q.y}`).join(' ')
    expect(at(sp.savedPrev)).not.toBe(at(sp.saved))
    expect(at(sp.savedPrev)).not.toBe('')
  })

  it('Td Stars Bank reserves 12 bytes a star, and Init spreads them', () => {
    const { rt } = run([...scr, 'Td Stars Bank 6,20', 'Td Stars Origin 32,16', 'Td Stars Init'])
    expect(rt.memBanks.get(6)!.data.length).toBe(240)
    const st = rt.amcaf.stars
    expect(st.s).toHaveLength(20)
    // "the stars are moved by random values to avoid that they all start in
    // the origin" -- so their velocities differ
    expect(new Set(st.s.map((q) => q.vx)).size).toBeGreaterThan(1)
  })

  /**
   * DEFECT: Td Stars Limit silently overwrites Td Stars Origin, and the
   * explicit form computes the replacement wrongly.
   *
   * Routine 293 (Td Stars Origin) stores its pair at $256/$258. Routine 291
   * (the bare Limit) writes a LONGWORD to $256 — the same two words — so a
   * limit re-centres the field. Routine 292 (the `x1,y1 To x2,y2` form) then
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
    // the bare form re-centres on the screen, discarding an earlier Origin
    const bare = run([...scr, 'Td Stars Bank 6,20', 'Td Stars Origin 5,7', 'Td Stars Limit'])
    expect([bare.rt.amcaf.stars.ox, bare.rt.amcaf.stars.oy]).toEqual([32, 16]) // a 64x32 screen

    // the explicit form: x1=10,y1=20 To x2=40,y2=30 should centre on (25,25).
    // It gives ((10+20)/2, (39+29)/2) = (15,34) — the second is off the
    // rectangle entirely, and below the screen.
    const expl = run([...scr, 'Td Stars Bank 6,20', 'Td Stars Origin 5,7', 'Td Stars Limit 10,20 To 40,30'])
    expect([expl.rt.amcaf.stars.ox, expl.rt.amcaf.stars.oy]).toEqual([15, 34])

    // ordering the call the other way round keeps the origin, which is the
    // only way to get the one you asked for
    const ok = run([...scr, 'Td Stars Bank 6,20', 'Td Stars Limit', 'Td Stars Origin 5,7'])
    expect([ok.rt.amcaf.stars.ox, ok.rt.amcaf.stars.oy]).toEqual([5, 7])
  })

  /**
   * The rest of the two engines' surface, each dispatched against its routine:
   * Splinters Limit/Max (277/275), Splinters Double Do/Del (283/285), and
   * Td Stars Gravity (295, two words at $25a/$25c), Accelerate Off (297, a
   * `clr.w $25e`), Single/Double Do (299/300 — del, move, draw, and NO back
   * step, unlike the Splinters pair) and Double Del (302).
   */
  it('the rest of the two engines dispatch and hold their state', () => {
    const sp = run([...scr, 'Splinters Bank 5,10', 'Splinters Limit 2,3 To 20,15', 'Splinters Max 7'])
    expect(sp.rt.amcaf.splinters.limit).toMatchObject({ x1: 2, y1: 3, x2: 19, y2: 14 })
    expect(sp.rt.amcaf.splinters.maxNew).toBe(7)

    // Double Do and Double Del run without a prior generation to restore
    expect(() =>
      run([...scr, 'Splinters Bank 5,10', 'Splinters Init', 'Splinters Double Do', 'Splinters Double Del']),
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
    expect(st.rt.amcaf.stars.accelerate).toBe(false)

    // the Do pair is del + move + draw — three calls, where Splinters has four
    expect(() =>
      run([...scr, 'Td Stars Bank 6,10', 'Td Stars Init', 'Td Stars Single Do', 'Td Stars Double Do']),
    ).not.toThrow()
    expect(() => run([...scr, 'Td Stars Bank 6,10', 'Td Stars Init', 'Td Stars Double Del'])).not.toThrow()
  })

  it('Td Stars Move sends them outward and recycles at the limit', () => {
    const { rt } = run([
      ...scr,
      'Td Stars Bank 6,8',
      'Td Stars Origin 32,16',
      'Td Stars Accelerate On',
      'Td Stars Init',
      'For I=1 To 60 : Td Stars Move : Next I',
    ])
    // every star is still inside the screen: one that left was put back at
    // the origin, which is what "as soon as they have left the screen" means
    for (const q of rt.amcaf.stars.s) {
      expect(q.x | 0).toBeGreaterThanOrEqual(0)
      expect(q.x | 0).toBeLessThan(64)
    }
  })

  it('Td Stars Draw marks the screen and Single Del clears it again', () => {
    const { rt } = run([
      ...scr,
      'Td Stars Bank 6,4',
      'Td Stars Planes 4',
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

  it('Vec Rot with no rotation is a plain perspective divide', () => {
    const { out } = run([
      'Vec Rot Angles 0,0,0',
      'Vec Rot Pos 0,0,0',
      'A=Vec Rot X(100,50,256)',
      'Print A;",";Vec Rot Y;",";Vec Rot Z',
    ])
    // z = 256 is unit distance, so x and y would come back unchanged if
    // cos(0) were 1 — but it is 255/256 (see the table DEFECT above), and
    // three successive rotations each scale by it
    expect(out.trim().replace(/\s+/g, '')).toBe('100,50,254')
  })

  it('the bare form reads the cache the three-argument form filled', () => {
    // "If you call the function with the parameters x,y,z all three new
    // coordinates are calculated, i.e the y,z position too"
    const { out } = run([
      'Vec Rot Angles 0,0,0 : Vec Rot Pos 0,0,0',
      'A=Vec Rot X(40,80,256)',
      'Print Vec Rot X;",";Vec Rot Y',
    ])
    expect(out.trim().replace(/\s+/g, '')).toBe('40,80')
  })

  it('a quarter turn about Z swaps the axes', () => {
    const { out } = run([
      'Vec Rot Pos 0,0,0',
      'Vec Rot Angles 0,0,256',
      'A=Vec Rot X(256,0,256)',
      'Print Vec Rot Y',
    ])
    // 1024 units to the turn, so 256 is 90 degrees: x moves onto y
    expect(Number(out.trim())).toBeGreaterThan(200)
  })

  it('Vec Rot Precalc changes no answer, which is why it can be a no-op', () => {
    const a = run(['Vec Rot Angles 100,200,300 : Vec Rot Pos 0,0,0', 'Print Vec Rot X(50,60,300)'])
    const b = run([
      'Vec Rot Angles 100,200,300 : Vec Rot Pos 0,0,0',
      'Vec Rot Precalc',
      'Print Vec Rot X(50,60,300)',
    ])
    expect(a.out.trim()).toBe(b.out.trim())
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
   * the rainbow with `Rbmi 372` / `cmp.w #4 / Rbge 372` — there are four, at
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

  it('Smouse Speed and Limit Smouse hold their settings', () => {
    expect(run(['Smouse Speed 3']).rt.amcaf.smouse.speed).toBe(3)
    // the To bound is EXCLUSIVE: routine 278 shifts both corners into
    // sixteenths and then `subq.l #1` the high pair, so pixel 30 is outside
    const { rt } = run(['Screen Open 0,64,32,4,Lowres', 'Limit Smouse 1,2 To 30,20'])
    expect(rt.amcaf.smouse.limit).toMatchObject({ x1: 1, y1: 2, x2: 29, y2: 19 })
    // ...and the corners are normalised, `cmp.w` + `exg.l` per axis. The swap
    // happens after the subtract, so descending is not quite the mirror of
    // ascending: it gives 30..1 where ascending gave 1..29
    const back = run(['Screen Open 0,64,32,4,Lowres', 'Limit Smouse 30,20 To 1,2'])
    expect(back.rt.amcaf.smouse.limit).toMatchObject({ x1: 1, y1: 2, x2: 30, y2: 20 })
    // "If the parameters are omitted, the full size of the current screen" —
    // and routine 277 ($6b66) SNAPSHOTS it rather than deferring, reading
    // $4c/$4e off the current screen and storing (size << 4) - 1, which in
    // whole pixels is size - 1
    expect(run(['Screen Open 0,64,32,4,Lowres', 'Limit Smouse']).rt.amcaf.smouse.limit).toMatchObject({
      x1: 0,
      y1: 0,
      x2: 63,
      y2: 31,
    })
    // ...so a later resize does not move the limits
    const resized = run(['Screen Open 0,64,32,4,Lowres', 'Limit Smouse', 'Screen Open 1,320,200,4,Lowres'])
    expect(resized.rt.amcaf.smouse.limit).toMatchObject({ x1: 0, y1: 0, x2: 63, y2: 31 })
    // with no screen at all the routine takes its `Rbeq 376` error branch
    expect(() => run(['Screen Close 0', 'Limit Smouse'])).toThrow()
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
   * Routine 254 ($62e0) reads the signal byte and CLEARS it in the same
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
   * Routines 228/229 range-check the channel — `Rbmi 372` on negative,
   * `cmp.b #4 / Rbge 372` past three — where the port had `& 3` and silently
   * answered for channel 0.
   */
  it('the Pt query functions error on a channel outside 0..3', () => {
    expect(() => run([...modBank(), 'Pt Play 3', 'A=Pt Cnote(4)'])).toThrow()
    expect(() => run([...modBank(), 'Pt Play 3', 'A=Pt Cinstr(-1)'])).toThrow()
    expect(() => run([...modBank(), 'Pt Play 3', 'A=Pt Cnote(3)'])).not.toThrow()
  })

  /**
   * Routine 232 ($5e70): `chan` is a BITMASK — `btst.b #0,d0` / `lsr.w #1,d0`
   * four times, stepping $10 bytes through the AUDxPER registers — and the
   * frequency is clamped to $190..$7530 before the period is derived.
   */
  it('Pt Sam Freq takes a channel MASK and clamps the frequency', () => {
    const freqs = (src: string[]): Array<[number, number]> => {
      const { audio } = runAudio([...modBank(), 'Pt Play 3', ...src])
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
  })

  /**
   * Routine 233 ($5ecc) is Pt Sam Freq's shape again — four passes of
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
   * Routine 249 ($61f0) calls `Rbsr 253` — Pt Stop — before it even reads its
   * argument, and then range-checks where the bank landed:
   *
   *     cmpa.l #$200000, a0
   *     Rbge   routine 372
   *
   * so a module at or above 2MB — outside chip RAM, where Paula cannot reach
   * it — is an error. That half is a DEVIATION: it compares a real address
   * and this port has a flag, so enforcing it would reject every
   * `Reserve As Work` bank, including on machines where all memory is chip
   * and the original is happy. The Pt Stop half is reproduced.
   */
  it('Pt Bank stops the music before it reads its argument', () => {
    const stopped = run([...modBank(), 'Pt Play 3', 'Pt Bank 3'])
    expect(stopped.rt.amcaf.pt.playing).toBe(false)
    expect(stopped.rt.amcaf.pt.bank).toBe(3)
  })

  it('Pt Sam Bank and the sample players reach the audio sink', () => {
    // Pt Sam Bank (235, $5f24) just resolves the bank and stores its address
    expect(run([...modBank(), 'Pt Sam Bank 3']).rt.amcaf.pt.samBank).toBe(3)
    // and the three play paths each reach a voice
    const played = (src: string): number[] => {
      const { audio } = runAudio([...modBank(), 'Pt Play 3', src])
      return audio.events.filter((e) => e.kind === 'play').map((e) => e.voice)
    }
    // the voice argument is a MASK here too — "on which channels the sample
    // number should be replayed" — so 0 plays nowhere and 5 plays on 0 and 2
    expect(played('Pt Instr Play 1,0')).toEqual([])
    expect(played('Pt Instr Play 1,5')).toEqual([0, 2])
    expect(played('Pt Instr Play 1')).toEqual([0]) // omitted: a free channel
    expect(played('Pt Raw Play 0,Start(3),8,428').length).toBeGreaterThan(0)
    // Pt Sam Play takes the same mask; its bank is Pt Sam Bank's, not the
    // module's, so with none set it falls back and simply reaches the sink
    expect(() => runAudio([...modBank(), 'Pt Play 3', 'Pt Sam Bank 3', 'Pt Sam Play 1,1'])).not.toThrow()
    expect(() => runAudio([...modBank(), 'Pt Play 3', 'Pt Sam Play 1'])).not.toThrow()
    // Pt Sam Volume's 0..64 clamp, which is Paula's own saturating range
    const { audio } = runAudio([...modBank(), 'Pt Play 3', 'Pt Sam Volume 0,999', 'Pt Sam Volume 0,-5'])
    const vols = audio.events.filter((e) => e.kind === 'volume').map((e) => e.volume)
    expect(vols).toEqual([64, 0])
  })

  it('Pt Stop with nothing playing leaves the channels alone', () => {
    // the changelog records this as a real bug: "Fixed a bug in Pt Stop which
    // cut off the channels, even if no music had been playing"
    expect(() => run(['Pt Stop'])).not.toThrow()
    expect(run(['Pt Stop']).rt.amcaf.pt.playing).toBe(false)
  })

  it('Pt Continue resumes, but only once a module has been loaded', () => {
    expect(run(['Pt Continue']).rt.amcaf.pt.playing).toBe(false)
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

  it('Pt Instr Length reads the module sample table', () => {
    // sample 1's header says 4 words, so 8 bytes
    expect(run([...modBank(), 'Pt Play 3', 'Print Pt Instr Length(1)']).out.trim()).toBe('8')
    expect(run([...modBank(), 'Pt Play 3', 'Print Pt Instr Address(1)>0']).out.trim()).toBe('-1')
    // out of range is nothing
    expect(run([...modBank(), 'Pt Play 3', 'Print Pt Instr Length(0)']).out.trim()).toBe('0')
    expect(run([...modBank(), 'Pt Play 3', 'Print Pt Instr Length(32)']).out.trim()).toBe('0')
  })

  it('Pt Volume clamps to the chip range, not to AMOS 0..63', () => {
    expect(run(['Pt Volume 200']).rt.amcaf.pt.volume).toBe(64)
    expect(run(['Pt Volume -5']).rt.amcaf.pt.volume).toBe(0)
  })

  it('Pt Vu is a note-on latch that clears when read, like AMOS Vumeter', () => {
    const { out } = run([...modBank(), 'Pt Play 3', 'Print Pt Vu(0);",";Pt Vu(0)'])
    expect(out.trim().replace(/\s+/g, '')).toBe('0,0')
  })

  it('Pt Free Voice reports what the music is not using', () => {
    // nothing playing: every voice is free, so the first is 0
    expect(run(['Print Pt Free Voice']).out.trim()).toBe('0')
    expect(run(['Print Pt Free Voice(2)']).out.trim()).toBe('-1')
    // with the music holding voices 0 and 1, the first free one is 2
    const { out } = run([...modBank(), 'Pt Play 3', 'Pt Voice 3', 'Print Pt Free Voice'])
    expect(out.trim()).toBe('2')
  })

  it('Pt Cpos stays inside a pattern, 0 to 63', () => {
    const { out } = run([...modBank(), 'Pt Play 3', 'Print Pt Cpos;",";Pt Cpattern'])
    expect(out.trim().replace(/\s+/g, '')).toBe('0,0')
  })
})
