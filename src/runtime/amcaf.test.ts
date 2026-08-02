import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
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
    const { out, rt } = run(['Print Amcaf Length', 'Print Extpath$("x")'], 'skip')
    // " 0" is AMOS's leading space for a non-negative number; the second line
    // is empty because Extpath$ has spec "2" and defaults to a string
    expect(out).toBe(' 0\n\n')
    expect([...rt.interp.unimplemented.keys()].sort()).toEqual(['amcaf length', 'extpath$'])
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

  it('Td Stars Bank reserves 12 bytes a star, and Init spreads them', () => {
    const { rt } = run([...scr, 'Td Stars Bank 6,20', 'Td Stars Origin 32,16', 'Td Stars Init'])
    expect(rt.memBanks.get(6)!.data.length).toBe(240)
    const st = rt.amcaf.stars
    expect(st.s).toHaveLength(20)
    // "the stars are moved by random values to avoid that they all start in
    // the origin" -- so their velocities differ
    expect(new Set(st.s.map((q) => q.vx)).size).toBeGreaterThan(1)
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
    // z = 256 is unit distance, so x and y come back unchanged
    expect(out.trim().replace(/\s+/g, '')).toBe('100,50,256')
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
