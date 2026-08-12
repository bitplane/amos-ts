/**
 * Explode 2.01, against `AMOSPro_Explode_Lib.s` — the author's own commented
 * assembler, which ships with the library — and against the German manual
 * beside it. `extdis explode-2.01` opens the binary the source built.
 *
 * The port is going in by functional group and this file grows with it.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** slot 7 — `ExtNb equ 7-1`, line 16 of the source */
const explode = extensionById('explode-2.01')!
const exts = new Map([[7, explode.table]])

function boot(src: string): { rt: Runtime; out: () => string } {
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[7, explode]]),
    maxSteps: 500_000,
    onText: (t) => (out += t),
  })
  return { rt, out: () => out }
}

function run(src: string): string {
  const b = boot(src)
  mustFinish(b.rt.runHeadless(3_000))
  return b.out().trim().replace(/\s+/g, ' ')
}

const val = (expr: string, setup = ''): string => run(`${setup === '' ? '' : `${setup}\n`}Print ${expr}`)

describe('Explode: strings to numbers and back', () => {
  it('Byte, Word and Long read the leading characters big-endian', () => {
    // the first character sits at 2(a0), past the string block's length word
    expect(val('Byte("A")')).toBe('65')
    expect(val('Word(Chr$(1)+Chr$(2))')).toBe('258')
    expect(val('Long(Chr$(0)+Chr$(0)+Chr$(1)+Chr$(0))')).toBe('256')
  })

  it('Word is UNSIGNED and Long is SIGNED, which is the one asymmetry', () => {
    // routines 61 and 63: Byte and Word zero d3 first, Long does not
    expect(val('Word(Chr$(255)+Chr$(255))')).toBe('65535')
    expect(val('Long(Chr$(255)+Chr$(255)+Chr$(255)+Chr$(255))')).toBe('-1')
  })

  it('and a string too short reads zero rather than the next thing in the heap', () => {
    // explode.ts records this as a deviation: the machine reads on into the
    // string heap, and there is no heap here to read
    expect(val('Word("A")')).toBe('16640') // $41 then nothing
    expect(val('Long("")')).toBe('0')
  })

  it('Byte$, Word$ and Long$ are the inverses', () => {
    expect(val('Len(Byte$(65));" ";Asc(Byte$(65))')).toBe('1 65')
    expect(val('Len(Word$(258));" ";Word(Word$(258))')).toBe('2 258')
    expect(val('Len(Long$(123456));" ";Long(Long$(123456))')).toBe('4 123456')
  })

  it('and they truncate to their width rather than complaining', () => {
    expect(val('Asc(Byte$(321))')).toBe('65') // 321 & $ff
    expect(val('Word(Word$(65538))')).toBe('2')
  })
})

describe('Explode: the shifts, where the WIDTH is the whole behaviour', () => {
  /*
   * `lsl.b d2,d3` shifts the low byte of d3 and leaves the other three bytes
   * alone, and the routine returns the whole of d3. Three keywords per
   * direction exist for exactly this reason.
   */
  it('Lsl.b moves the low byte and leaves everything above it', () => {
    expect(val('Lsl.b(1,$1234)')).toBe(String(0x1268))
    expect(val('Lsl.w(1,$12345678)')).toBe(String(0x1234acf0 | 0))
    expect(val('Lsl.l(1,$1234)')).toBe(String(0x2468))
  })

  it('Lsr.b likewise, and the high bytes survive a shift that empties the field', () => {
    expect(val('Lsr.b(1,$1234)')).toBe(String(0x121a))
    expect(val('Lsr.b(8,$1234)')).toBe(String(0x1200))
    expect(val('Lsr.w(8,$12345678)')).toBe(String(0x12340056))
  })

  it('a count at or past the width empties the field; the count is taken mod 64', () => {
    expect(val('Lsl.b(8,$1234)')).toBe(String(0x1200))
    expect(val('Lsl.l(32,$1234)')).toBe('0')
    expect(val('Lsl.b(64,$1234)')).toBe(String(0x1234)) // 64 & 63 = 0
  })

  it('the .l forms handle the top bit, which is where a JS shift would go wrong', () => {
    expect(val('Lsl.l(1,$40000000)')).toBe(String(-2147483648))
    expect(val('Lsr.l(1,$80000000)')).toBe(String(0x40000000))
    expect(val('Lsr.l(31,$80000000)')).toBe('1')
  })
})

describe('Explode: Even, Odd and Align', () => {
  it('Even and Odd are one btst, answering -1', () => {
    expect(val('Even(4)')).toBe('-1')
    expect(val('Even(5)')).toBe('0')
    expect(val('Odd(5)')).toBe('-1')
    expect(val('Odd(4)')).toBe('0')
    // the test is bit 0, so a negative odd number is still odd
    expect(val('Odd(-3)')).toBe('-1')
  })

  it('Align rounds UP to a multiple and leaves an exact one alone', () => {
    expect(val('Align(10,4)')).toBe('12')
    expect(val('Align(12,4)')).toBe('12')
    expect(val('Align(1,512)')).toBe('512')
    expect(val('Align(0,4)')).toBe('0')
  })

  it('and an alignment of zero is AMOS error 23', () => {
    // `tst.l d0 / Rbeq L_IFunc`
    expect(() => run('A=Align(10,0)')).toThrow(/function call/i)
  })
})

describe('Explode: the print sequences', () => {
  /*
   * Routines 33 to 38 all tail into one three-byte builder: ESC, the
   * routine's own letter, and the argument plus "0". They change nothing
   * themselves — AMOS's Print does the work when it meets the escape.
   */
  it('each is ESC, a letter and a digit', () => {
    expect(val('Len(Pinv$(1))')).toBe('3')
    expect(val('Asc(Mid$(Pinv$(1),1,1))')).toBe('27')
    expect(val('Mid$(Pinv$(1),2,2)')).toBe('I1')
    expect(val('Mid$(Psad$(0),2,2)')).toBe('S0')
    expect(val('Mid$(Pund$(1),2,2)')).toBe('U1')
    expect(val('Mid$(Pcpn$(3),2,2)')).toBe('D3')
    expect(val('Mid$(Pjam$(2),2,2)')).toBe('W2')
    expect(val('Mid$(Pcsr$(0),2,2)')).toBe('C0')
  })

  it('the digit is a BYTE add, so an argument past 9 runs off the end of the digits', () => {
    // `addi.b #"0",d1` with nothing to stop it
    expect(val('Mid$(Pinv$(10),3,1)')).toBe(':')
    expect(val('Asc(Mid$(Pinv$(208),3,1))')).toBe('0') // wrapped right round
  })

  it('Pdef$ is eight sequences and sets the pen and paper the others cannot', () => {
    expect(val('Len(Pdef$)')).toBe('24')
    // ESC I0 S0 U0 P1 B0 D3 W0 C1
    expect(val('Mid$(Pdef$,2,2)')).toBe('I0')
    expect(val('Mid$(Pdef$,11,2)')).toBe('P1')
    expect(val('Mid$(Pdef$,14,2)')).toBe('B0')
    expect(val('Mid$(Pdef$,23,2)')).toBe('C1')
  })

  it('and AMOS Print ACTS on them, which needed three escapes core did not have', () => {
    // ESC I, S and U were missing from screen.ts until this batch; the
    // manual's own shape is `Print "a";Pinv$(1);"b"`
    const rt = boot('Print Pinv$(1);"x"').rt
    mustFinish(rt.runHeadless(2_000))
    expect(rt.screen.curWin.inverse).toBe(true)
    const off = boot('Print Pinv$(1);"x";Pinv$(0);"y"').rt
    mustFinish(off.runHeadless(2_000))
    expect(off.screen.curWin.inverse).toBe(false)
  })

  it('Pund$ and Psad$ reach the same fields Under On and Shade On set', () => {
    const u = boot('Print Pund$(1);"x"').rt
    mustFinish(u.runHeadless(2_000))
    expect(u.screen.curWin.style & 1).toBe(1)
    const s = boot('Print Psad$(1);"x"').rt
    mustFinish(s.runHeadless(2_000))
    expect(s.screen.curWin.shade).toBe(true)
  })

  it('and Pdef$ puts all three back, plus the pen and paper', () => {
    const rt = boot('Pen 5 : Paper 3 : Inverse On : Under On : Shade On\nPrint Pdef$').rt
    mustFinish(rt.runHeadless(2_000))
    const w = rt.screen.curWin
    expect([w.inverse, w.shade, w.style & 1]).toEqual([false, false, 0])
    expect([w.pen, w.paper]).toEqual([1, 0])
  })
})

describe('Explode: Format$, which is exec RawDoFmt', () => {
  /*
   * Routine 40 hands the string and a buffer to exec and copies back what
   * comes out, so the widths are exec's: %d eats a WORD off the buffer and
   * %ld a longword. The author's own example feeds it Rs Word for %d.
   */
  const withBuf = (fmt: string, pokes: string[]): string =>
    val(`Format$("${fmt}",Start(9))`, ['Reserve As Work 9,64', ...pokes].join('\n'))

  it('%d takes a WORD and %ld a longword', () => {
    expect(withBuf('v=%d', ['Doke Start(9),1234'])).toBe('v=1234')
    expect(withBuf('v=%ld', ['Loke Start(9),123456'])).toBe('v=123456')
    // and %d is signed off that word
    expect(withBuf('v=%d', ['Doke Start(9),$FFFF'])).toBe('v=-1')
  })

  it('walks the buffer, one argument after another', () => {
    expect(withBuf('%d.%d', ['Doke Start(9),1', 'Doke Start(9)+2,53'])).toBe('1.53')
    expect(withBuf('%x-%x', ['Doke Start(9),$28', 'Doke Start(9)+2,$4'])).toBe('28-4')
  })

  it('%s follows a longword POINTER, which is what Rs Aptr leaves', () => {
    const src = [
      'Reserve As Work 9,64',
      'A$="Explode"+Chr$(0)',
      'Loke Start(9),Varptr(A$)',
      'Print Format$("name=%s",Start(9))',
    ].join('\n')
    expect(run(src)).toBe('name=Explode')
  })

  it('handles a width, a zero pad and a literal percent', () => {
    expect(withBuf('[%6d]', ['Doke Start(9),42'])).toBe('[ 42]')
    expect(withBuf('[%-6d]', ['Doke Start(9),42'])).toBe('[42 ]')
    expect(withBuf('[%06d]', ['Doke Start(9),42'])).toBe('[000042]')
    expect(withBuf('100%%', [])).toBe('100%')
  })

  it('and a bank that was never reserved is AMOS error 36', () => {
    expect(() => run('A$=Format$("x",9)')).toThrow(/bank not reserved/i)
  })
})
