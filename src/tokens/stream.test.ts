import { describe, expect, it } from 'vitest'
import { TokenTable, parseSource, decodeFFP, OPERATORS } from './stream'
import { detokSource } from './edtok'
import { CORE_TOKENS } from './tables.gen'

const table = new TokenTable(CORE_TOKENS)

/** Build a tokenized line from raw words/bytes. */
function line(indent: number, body: number[]): number[] {
  const len = body.length + 2 + 2
  if (len % 2 !== 0) throw new Error('odd line')
  return [len / 2, indent, ...body, 0, 0]
}

const ch = (s: string) => [...s].map((c) => c.charCodeAt(0))

describe('operators', () => {
  it('maps ids derived from the editor operator table layout', () => {
    expect(OPERATORS.get(0xffa2)).toBe('=')
    expect(OPERATORS.get(0xffc0)).toBe('+')
    expect(OPERATORS.get(0xffca)).toBe('-')
    expect(OPERATORS.get(0xff58)).toBe(' and ')
  })
})

describe('decodeFFP', () => {
  it('decodes Motorola FFP floats', () => {
    expect(decodeFFP(0)).toBe(0)
    // 1.0 = mantissa $800000, exponent 65 ($41)
    expect(decodeFFP(0x80000041)).toBe(1)
    expect(decodeFFP(0x800000c1)).toBe(-1)
    expect(decodeFFP(0xc0000041)).toBe(1.5)
  })
})

describe('parseSource + detok', () => {
  it('parses a variable assignment with operator and integer', () => {
    // SCORE = SCORE + 10
    const varTok = [0x00, 0x06, 0, 0, 6, 0, ...ch('score'), 0]
    const src = new Uint8Array(
      line(1, [...varTok, 0xff, 0xa2, ...varTok, 0xff, 0xc0, 0x00, 0x3e, 0, 0, 0, 10]),
    )
    const lines = parseSource(src, table)
    expect(lines).toHaveLength(1)
    expect(detokSource(lines, table)).toBe('SCORE=SCORE+10')
  })

  it('resolves a nameless variant but leaves the constant slots nameless', () => {
    // $051E is Mid$'s two-argument form, which borrows the name of the $050E
    // entry above it. $2B6A is nameless for a different reason: its spec is
    // C3, the double-precision literal, and nothing types it. Carrying a
    // neighbour's name onto that one made it read as "screen mode", the
    // keyword at $2B58.
    expect(table.name(0x051e)).toBe('mid$')
    expect(table.name(0x2b6a)).toBe('')
    expect(table.name(0x2b58)).toBe('screen mode')
  })

  it('parses strings, floats and rem', () => {
    const src = new Uint8Array([
      ...line(1, [0x00, 0x26, 0, 5, ...ch('hello'), 0]), // "hello" (padded)
      ...line(1, [0x00, 0x46, 0x80, 0x00, 0x00, 0x41]), // 1.0 FFP
      // "Rem hi !": the keyword name is "rem" with nothing after it, so the
      // space the user typed is the first byte of the remark's own text
      ...line(1, [0x06, 0x4a, 0, 4, ...ch(' hi!')]),
    ])
    const lines = parseSource(src, table)
    const out = detokSource(lines, table).split('\n')
    expect(out[0]).toBe('"hello"')
    expect(out[1]).toBe('1.0')
    expect(out[2]).toBe('Rem hi!')
  })

  it('accepts trailing zero padding after the last line', () => {
    const src = new Uint8Array([...line(1, [0x00, 0x3e, 0, 0, 0, 1]), 0, 0, 0, 0])
    expect(parseSource(src, table)).toHaveLength(1)
  })

  it('reports unknown tokens with line context', () => {
    const src = new Uint8Array(line(1, [0x0b, 0x0b, 0, 0]))
    expect(() => parseSource(src, table)).toThrow(/unknown token \$0b0b/)
  })
})

describe('every token knows where it is', () => {
  /**
   * `VerPos(a5)` is an address, not a line number: `rErr1` (+ILib.s:1370)
   * stores `d7-2` in it and `Ed_ErrEdit` (+Edit.s:8291) reads it back to put
   * the cursor on the token an error was about. So the parse has to keep one
   * offset per token, and the id word is where the machine points.
   */
  it('records the id word offset, which is 2 past the line header', () => {
    // Print 7 : Print 9, with the int record a 2-byte id and a longword
    const src = Uint8Array.from(
      line(1, [0x04, 0x76, 0x00, 0x3e, 0, 0, 0, 7, 0x04, 0x76, 0x00, 0x3e, 0, 0, 0, 9]),
    )
    const [l] = parseSource(src, table)
    expect(l!.tokens.length).toBe(4)
    expect(l!.offsets).toEqual([2, 4, 10, 12])
    // and each offset is the token's own id word back again
    const ids = [0x0476, 0x003e, 0x0476, 0x003e]
    for (let i = 0; i < ids.length; i++) {
      const at = l!.offsets![i]!
      expect((src[at]! << 8) | src[at + 1]!).toBe(ids[i])
    }
  })

  it('skips the inline link words, so a For points at For and not at its link', () => {
    // For <var A> = <int 1> To <int 2>, where For carries a 2-byte link
    const src = Uint8Array.from(
      line(1, [
        0x02, 0x3c, 0, 0, // For + link
        0x00, 0x06, 0, 0, 1, 0, ...ch('A'), 0, // variable record, name padded even
        0xff, 0xa2,
        0x00, 0x3e, 0, 0, 0, 1,
      ]),
    )
    const [l] = parseSource(src, table)
    // the variable record is 6 bytes of header, 'A', and a pad byte
    expect(l!.offsets).toEqual([2, 6, 14, 16])
    expect((src[6]! << 8) | src[7]!).toBe(0x0006)
  })
})
