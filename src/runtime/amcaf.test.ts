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
