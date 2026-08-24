import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)

function out(src: string): string {
  let o = ''
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, onText: (t) => (o += t) })
  mustFinish(rt.runHeadless(1_000))
  return o.trim()
}

/** a 64-byte work bank at bank 10, and A holding its address */
const BANK = 'Reserve As Work 10,64\nA=Start(10)\n'

describe('Equ and Lvo read the value the Test pass poked in', () => {
  it('hand back the longword and nothing else', () => {
    // `FnEqu` (+ILib.s:5881) is `move.l (a6),d3` and a skip over the name.
    // One routine serves both: the token table gives `equ` and `lvo` the
    // same func number (+Lib.s:1606/1608).
    expect(out('Print Equ("AEd_Up")')).toBe('1')
    expect(out('Print Equ("CTF_UPPER")')).toBe('64')
    expect(out('Print Lvo("Open")')).toBe('-30')
    expect(out('Print Lvo("Write")')).toBe('-48')
  })

  it('are an ordinary integer in an expression', () => {
    expect(out('Print Equ("AEd_Up")+Equ("AEd_Down")*2')).toBe('5')
  })
})

describe('Struc reads a field by its type digit', () => {
  it('sign-extends types 0 to 2 and not 3 to 5', () => {
    // `FnStruc` (+ILib.s:5923, $768c in AMOSPro.Lib): .Byte/.Word/.Long then
    // .UByte/.UWord/.ULong, picked by `lsl.w #1,d0 / jmp .Jmp(pc,d0.w)`
    expect(out(`${BANK}Poke A+9,255\nPrint Struc(A,"LN_PRI")`)).toBe('-1') // 0, signed byte
    expect(out(`${BANK}Poke A+8,255\nPrint Struc(A,"LN_TYPE")`)).toBe('255') // 3, unsigned byte
    expect(out(`${BANK}Doke A+14,65535\nPrint Struc(A,"SS_NESTCOUNT")`)).toBe('-1') // 1, signed word
    expect(out(`${BANK}Doke A,65535\nPrint Struc(A,"RT_MATCHWORD")`)).toBe('65535') // 4, unsigned word
    expect(out(`${BANK}Loke A,-7\nPrint Struc(A,"ds_Days")`)).toBe('-7') // 2, signed long
  })

  it('adds the equate to a base address that can be any expression', () => {
    expect(out(`${BANK}Poke A+8,3\nB=A-8\nPrint Struc(B+8,"LN_TYPE")`)).toBe('3')
  })

  it('a word or long at an odd address is an address error, a byte is not', () => {
    // `btst #0,d1 / bne AdrErr`, which the two byte arms do not reach
    expect(out(`${BANK}Poke A+9,7\nPrint Struc(A,"LN_PRI")`)).toBe('7')
    expect(() => out(`${BANK}Print Struc(A+1,"ds_Days")`)).toThrow(/Address error/)
  })
})

describe('Struc$ follows the pointer to a C string', () => {
  it('reads up to the zero byte, and an empty string from a null pointer', () => {
    // the field holds what an exec Node holds: `A0ToChaine` (+Lib.s:3720)
    // counts to the terminator and copies that many characters
    expect(out(`${BANK}Loke A+10,A+32\nPoke A+32,72 : Poke A+33,73 : Poke A+34,0\nPrint Struc$(A,"LN_NAME")`)).toBe('HI')
    expect(out(`${BANK}Print "[";Struc$(A,"LN_NAME");"]"`)).toBe('[]')
  })
})

describe('what the assigning forms really store', () => {
  it('DEFECT: a byte field is written with the type index, not the value', () => {
    // `InStruc` (+ILib.s:5896) reaches `.Byte` as `move.b d0,(a0)` -- `10 80`
    // at $7666 of AMOSPro.Lib's code hunk -- where d0 is the type doubled and
    // the value is in d3. So an unsigned byte field stores 6 whatever it was
    // assigned, and a signed one stores 0.
    expect(out(`${BANK}Struc(A,"LN_TYPE")=99\nPrint Peek(A+8)`)).toBe('6')
    expect(out(`${BANK}Struc(A,"LN_PRI")=99\nPrint Peek(A+9)`)).toBe('0')
  })

  it('the word and long arms use the value, and are correct', () => {
    expect(out(`${BANK}Struc(A,"ds_Days")=12345\nPrint Leek(A)`)).toBe('12345')
    expect(out(`${BANK}Struc(A,"SS_NESTCOUNT")=513\nPrint Deek(A+14)`)).toBe('513')
  })

  it('DEFECT: what Struc$ writes, Struc$ cannot read back', () => {
    // `InStrucD` (:5962) stores a pointer to the LENGTH WORD of a block it
    // built, and `FnStrucD` reads a C string from wherever the pointer goes.
    // For anything under 255 characters that length word's high byte is zero,
    // so the read stops before it starts. No program in the corpus of 3,875
    // uses `Struc$` at all.
    expect(out(`${BANK}Struc$(A,"LN_NAME")="hi"\nPrint Leek(A+10)<>0`)).toBe('-1')
    expect(out(`${BANK}Struc$(A,"LN_NAME")="hi"\nPrint "[";Struc$(A,"LN_NAME");"]"`)).toBe('[]')
  })

  it('a string opening |00| leaves the null pointer the field was cleared to', () => {
    // `clr.l (a0)` first, then `cmp.l #"|00|",(a2) / beq .Skp`
    expect(out(`${BANK}Loke A+10,999\nStruc$(A,"LN_NAME")="|00|"\nPrint Leek(A+10)`)).toBe('0')
    expect(out(`${BANK}Struc$(A,"LN_NAME")="|00|and more"\nPrint Leek(A+10)`)).toBe('0')
  })
})
