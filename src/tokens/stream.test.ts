import { describe, expect, it } from 'vitest'
import { TokenTable, parseSource, decodeFFP, OPERATORS } from './stream'
import { detokSource } from './detok'
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

  it('parses strings, floats and rem', () => {
    const src = new Uint8Array([
      ...line(1, [0x00, 0x26, 0, 5, ...ch('hello'), 0]), // "hello" (padded)
      ...line(1, [0x00, 0x46, 0x80, 0x00, 0x00, 0x41]), // 1.0 FFP
      ...line(1, [0x06, 0x4a, 0, 4, ...ch('hi !')]), // Rem hi !
    ])
    const lines = parseSource(src, table)
    const out = detokSource(lines, table).split('\n')
    expect(out[0]).toBe('"hello"')
    expect(out[1]).toBe('1.0')
    expect(out[2]).toBe('Rem hi !')
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
