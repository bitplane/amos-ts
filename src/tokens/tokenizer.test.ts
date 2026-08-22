import { describe, expect, it } from 'vitest'
import { TokenTable } from './stream'
import { CORE_TOKENS } from './tables.gen'
import { tokenize } from './tokenizer'
import { detokSource } from './edtok'

const table = new TokenTable(CORE_TOKENS)

/**
 * tokenize → detokenize should reproduce the listing.
 *
 * Trailing spaces are dropped for the comparison because `DtkE` puts one after
 * every instruction and `DtkFin` never takes it off again, so `Next` really
 * does list as "Next ". That is the editor's, not this tokenizer's.
 */
function roundTrip(src: string): string {
  return detokSource(tokenize(src, table), table)
    .split('\n')
    .map((l) => l.replace(/ +$/, ''))
    .join('\n')
}

describe('tokenizer', () => {
  it('round-trips editor-style listings', () => {
    const src = [
      'Print "HELLO"',
      'For D=1 To 8',
      '   Read L(D)',
      'Next',
      'If SCORE>HI Then HI=SCORE Else Print "NO"',
      'Repeat',
      '   Add X,1',
      'Until X>10',
    ].join('\n')
    expect(roundTrip(src)).toBe(src)
  })

  it('distinguishes keywords from identifiers sharing a prefix', () => {
    const toks = tokenize('FORK=1', table)[0]!.tokens
    expect(toks[0]).toMatchObject({ kind: 'var', name: 'fork' })
  })

  it('matches multi-word keywords greedily', () => {
    const lines = tokenize('If A\nElse If B\nEnd If', table)
    expect(lines[1]!.tokens[0]).toMatchObject({ kind: 'core' })
    expect(table.name((lines[1]!.tokens[0] as { id: number }).id)).toBe('else if ')
    expect(table.name((lines[2]!.tokens[0] as { id: number }).id)?.trim()).toBe('end if')
  })

  it('handles labels, procedures and label references', () => {
    const src = 'MAIN:\nGosub MAIN\nMYPROC[1]\nProcedure MYPROC[N]\nEnd Proc'
    const lines = tokenize(src, table)
    expect(lines[0]!.tokens[0]).toMatchObject({ kind: 'label', name: 'main' })
    expect(lines[1]!.tokens[1]).toMatchObject({ kind: 'labelRef', name: 'main' })
    expect(lines[2]!.tokens[0]).toMatchObject({ kind: 'procCall', name: 'myproc' })
    expect(lines[3]!.tokens[0]).toMatchObject({ kind: 'proc' })
    expect(lines[3]!.tokens[1]).toMatchObject({ kind: 'procCall', name: 'myproc' })
  })

  it('parses literals: hex, binary, floats, strings, variables with suffixes', () => {
    const toks = tokenize('A#=3.14 : B$="hi" : C=$FF+%101', table)[0]!.tokens
    expect(toks[0]).toMatchObject({ kind: 'var', name: 'a#', flags: 1 })
    // AscToFloat stores 3.14 as $C8F5C242, mantissa 13170114, one step under
    // the 13170115 correct rounding gives. The corpus has the same shape at
    // 1.07: $88F5C241 stored, $88F5C341 rounded.
    expect(toks[2]).toMatchObject({ kind: 'float', value: 3.1399998664855957 })
    expect(toks[4]).toMatchObject({ kind: 'var', name: 'b$', flags: 2 })
    expect(toks[6]).toMatchObject({ kind: 'str', value: 'hi' })
    expect(toks.find((t) => t.kind === 'hex')).toMatchObject({ value: 0xff })
    expect(toks.find((t) => t.kind === 'bin')).toMatchObject({ value: 5 })
  })

  it('treats Rem and tick comments as rem tokens', () => {
    const lines = tokenize("Rem hello\n' world", table)
    expect(lines[0]!.tokens[0]).toMatchObject({ kind: 'rem', text: 'hello' })
    expect(lines[1]!.tokens[0]).toMatchObject({ kind: 'rem', text: 'world' })
  })
})
