/**
 * The editor's two halves, on bytes built by hand.
 *
 * The corpus sweep in roundtrip.test.ts is the one that proves these agree
 * with AMOS. These pin the individual rules, so that when the sweep moves it
 * says which rule moved.
 */
import { describe, expect, it } from 'vitest'
import { T, TokenTable } from './stream'
import { CORE_TOKENS } from './tables.gen'
import { detokLineBytes, inlineBytes, matchKeyword, TK, tokeniseLine, valRout } from './edtok'

const table = new TokenTable(CORE_TOKENS)

/** a line, the way the editor stores one: length in words, indent, tokens, terminator */
const line = (indent: number, ...bytes: number[]): Uint8Array => {
  const body = [...bytes, 0, 0]
  if (body.length % 2 !== 0) body.push(0)
  return Uint8Array.from([(body.length + 2) >> 1, indent, ...body])
}
const w = (v: number): number[] => [(v >>> 8) & 0xff, v & 0xff]
const l = (v: number): number[] => [...w((v >>> 16) & 0xffff), ...w(v & 0xffff)]
const chars = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))
const detok = (src: Uint8Array): string => detokLineBytes(src, 0, table)
const hex = (u: Uint8Array): string => [...u].map((b) => b.toString(16).padStart(2, '0')).join(' ')

describe('detokenise', () => {
  it('writes one space fewer than the indent byte', () => {
    // Dtk1 counts down from indent-2 and dbra runs once more, so an indent of
    // 1 is column zero and 0 and 1 both give nothing
    expect(detok(line(1, ...w(TK.PRINT)))).toBe('Print ')
    expect(detok(line(5, ...w(TK.PRINT)))).toBe('    Print ')
    expect(detok(line(0, ...w(TK.PRINT)))).toBe('Print ')
  })

  it('puts a space before an instruction and after it, and neither near a bracket', () => {
    // "print" has spec I, "(" has spec O
    const src = line(1, ...w(TK.PRINT), ...w(TK.OPEN_PAREN), ...w(T.INT), ...l(7))
    expect(detok(src)).toBe('Print(7')
  })

  it('capitalises after every space but not a leading one', () => {
    // $FFD4 is " mod ", stored with a space at each end, so Dtk8 spends its
    // one uppercasing on the space and Dtk9a copies the word as it stands.
    // $FFA2 is "=", which has no spaces to give it any.
    const src = line(1, ...w(T.INT), ...l(9), ...w(0xffd4), ...w(T.INT), ...l(2))
    expect(detok(src)).toBe('9 mod 2')
    expect(detok(line(1, ...w(T.INT), ...l(1), ...w(0xffa2), ...w(T.INT), ...l(1)))).toBe('1=1')
  })

  it('writes a variable record with its type suffix and nothing of its link', () => {
    const rec = [...w(T.VARIABLE), ...w(0x1234), 4, 2, ...chars('ab\0\0')]
    expect(detok(line(1, ...rec))).toBe('AB$')
  })

  it('marks a label with a colon and a line number with nothing', () => {
    expect(detok(line(1, ...w(T.LABEL), 0, 0, 4, 0, ...chars('loop')))).toBe('LOOP:')
    expect(detok(line(1, ...w(T.LABEL), 0, 0, 4, 0, ...chars('100\0')))).toBe('100')
  })

  it('gives a float a ".0" when nothing else marks it as one', () => {
    // DtkC8 looks for a point or an E and puts one on if there is neither,
    // which is what keeps 128 a float across the round trip
    expect(detok(line(1, ...w(T.FLOAT), ...l(0x80000048)))).toBe('128.0')
    expect(detok(line(1, ...w(T.FLOAT), ...l(0xc0000041)))).toBe('1.5')
  })

  it('reads a remark to the terminator, pad and all', () => {
    const rem = [...w(TK.REM_TICK), ...w(4), ...chars('hi ')]
    expect(detok(line(1, ...rem, 0))).toBe("'hi ")
  })

  it('names a missing extension by its slot letter', () => {
    expect(detok(line(1, ...w(T.EXTENSION), 2, 0, ...w(0x100)))).toBe('Extension C ')
  })
})

describe('tokenise', () => {
  it('counts the indent from one and caps it at 127', () => {
    expect(tokeniseLine('Print', table)[1]).toBe(1)
    expect(tokeniseLine('   Print', table)[1]).toBe(4)
    expect(tokeniseLine(' '.repeat(200) + 'Print', table)[1]).toBe(127)
  })

  it('gives a line with nothing on it four bytes and no indent', () => {
    // TokVide never reaches TokT1, so the indent byte keeps the zero the
    // header was cleared to, however many spaces were counted
    expect(hex(tokeniseLine('', table))).toBe('02 00 00 00')
    expect(hex(tokeniseLine('     ', table))).toBe('02 00 00 00')
  })

  it('pads a name to even and counts the pad in the length byte', () => {
    const one = tokeniseLine('A', table)
    expect(hex(one)).toBe('06 01 00 06 00 00 02 00 61 00 00 00')
    const two = tokeniseLine('AB$', table)
    expect(hex(two)).toBe('06 01 00 06 00 00 02 02 61 62 00 00')
  })

  it('pads a string with a zero and leaves the pad OUT of its length', () => {
    // TkC1 takes the length before the pad, which is the opposite of what a
    // remark does
    expect(hex(tokeniseLine('"abc"', table))).toBe('06 01 00 26 00 03 61 62 63 00 00 00')
  })

  it('pads a remark with a space and counts it IN', () => {
    expect(hex(tokeniseLine("'h", table))).toBe('05 01 06 52 00 02 68 20 00 00')
    expect(hex(tokeniseLine("'hi", table))).toBe('05 01 06 52 00 02 68 69 00 00')
  })

  it('makes a leading number into a label and a bare name into a variable', () => {
    expect(hex(tokeniseLine('100 Print', table))).toBe('08 01 00 0c 00 00 04 00 31 30 30 00 04 76 00 00')
    // "loop" is the keyword that closes a Do, so the label has to be a name
    // the table does not already hold
    expect(hex(tokeniseLine('again:', table))).toBe('08 01 00 0c 00 00 06 00 61 67 61 69 6e 00 00 00')
  })

  it('opens a label reference after Then, where a number would otherwise be a constant', () => {
    const t = tokeniseLine('Then 100', table)
    expect(hex(t)).toBe('08 01 02 c6 00 18 00 00 04 00 31 30 30 00 00 00')
  })

  it('takes the longest keyword across the table, so Screen Open beats Screen', () => {
    const short = tokeniseLine('Screen 1', table)
    const long = tokeniseLine('Screen Open 1,2,3,4,Lowres', table)
    expect((short[2]! << 8) | short[3]!).not.toBe((long[2]! << 8) | long[3]!)
    // and a space inside a keyword is optional in what you type
    expect(hex(tokeniseLine('Screen Open 1', table))).toBe(hex(tokeniseLine('screenopen 1', table)))
  })

  it('reaches the operator table first, so "and" is never a keyword', () => {
    // an operator id is a NEGATIVE offset from the end of Dtk_Operateurs, so
    // it reads as a word above $8000
    const t = tokeniseLine('A and 2', table)
    const words = []
    for (let i = 2; i + 1 < t.length; i += 2) words.push((t[i]! << 8) | t[i + 1]!)
    expect(words.some((v) => v >= 0x8000)).toBe(true)
  })

  it('makes a leading digit a line number, whatever follows it', () => {
    // TokT2 looks for the digit before anything else, so the 1 here is a
    // label and not the integer constant it would be anywhere else on the line
    expect(hex(tokeniseLine('1 and 2', table))).toBe(
      '0a 01 00 0c 00 00 02 00 31 00 ff 58 00 3e 00 00 00 02 00 00',
    )
  })

  it('turns ? into Print and ? # into Print #', () => {
    expect(hex(tokeniseLine('?"a"', table))).toBe('06 01 04 76 00 26 00 01 61 00 00 00')
    expect(hex(tokeniseLine('? #1', table))).toBe('06 01 04 6a 00 3e 00 00 00 01 00 00')
  })

  it('drops a character that can neither start a name nor match anything', () => {
    // TkKf1 falls through to TokLoop without writing, so the "@" is gone
    expect(hex(tokeniseLine('@', table))).toBe('02 01 00 00')
  })

  it('refuses a line of 510 bytes or more the way .Long does', () => {
    expect(hex(tokeniseLine('"' + 'x'.repeat(600) + '"', table))).toBe('00 00')
  })

  it('leaves the verifier its fields: the link, the inline slots and the flag bits', () => {
    const t = tokeniseLine('For I=1 To 2', table)
    // For carries two zero bytes where the offset of its Next will go
    expect(hex(t.subarray(2, 6))).toBe('02 3c 00 00')
    expect(inlineBytes(TK.FOR)).toBe(2)
    expect(inlineBytes(TK.PROCEDURE)).toBe(8)
    // Equ, Lvo, Struc and Struc$ are the six-byte range, not just Lvo
    expect([TK.EQU, 0x2a4a, 0x2a54, TK.STRUC_S].map(inlineBytes)).toEqual([6, 6, 6, 6])
  })
})

describe('matchKeyword', () => {
  it('makes a space inside a name optional and a space at the end free', () => {
    expect(matchKeyword('screen open', 'screen open 1', 0)).toBe(11)
    expect(matchKeyword('screen open', 'screenopen 1', 0)).toBe(10)
    expect(matchKeyword('to ', 'to10', 0)).toBe(2)
    expect(matchKeyword('to ', 'to 10', 0)).toBe(2)
  })

  it('looks past a leading ! or space, which mark the entry and not the word', () => {
    expect(matchKeyword('!mid$', 'mid$(a$,1)', 0)).toBe(4)
    expect(matchKeyword(' and ', 'and 2', 0)).toBe(3)
  })

  it('is case blind on the input and only on a-z', () => {
    expect(matchKeyword('print', 'PRINT', 0)).toBe(5)
    expect(matchKeyword('print', 'PRINY', 0)).toBe(-1)
  })
})

describe('ValRout', () => {
  it('decides float by how the number is written and never by its value', () => {
    // val4 branches on d3, which a point or a signed exponent sets
    expect(valRout('2', 0)?.id).toBe(T.INT)
    expect(valRout('2.0', 0)?.id).toBe(T.FLOAT)
    expect(valRout('2E1', 0)?.id).toBe(T.FLOAT)
    expect(valRout('2E', 0)?.id).toBe(T.INT)
  })

  it('reads $ as hex and % as binary, and stops at the ninth hex digit', () => {
    expect(valRout('$FF0', 0)).toMatchObject({ id: T.HEX, value: 0xff0 })
    expect(valRout('%1011', 0)).toMatchObject({ id: T.BIN, value: 0b1011 })
    expect(valRout('$123456789', 0)?.value).toBe(0)
  })

  it('skips spaces inside a decimal number but not inside a hex one', () => {
    // minichr eats spaces, minichr2 does not
    expect(valRout('1 2 3', 0)).toMatchObject({ value: 123 })
    expect(valRout('$F F', 0)).toMatchObject({ value: 0xf, end: 2 })
  })

  it('answers zero rather than wrapping when a decimal will not fit a long', () => {
    expect(valRout('99999999999', 0)?.value).toBe(0)
  })

  it('leaves a leading sign for the operator, because Tokenise passes d0 zero', () => {
    expect(valRout('-5', 0)).toBeNull()
  })
})
