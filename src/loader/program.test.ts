import { describe, expect, it } from 'vitest'
import { isAmosProgram, loadProgram } from './program'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'

const table = new TokenTable(CORE_TOKENS)
const listing = (src: string): Uint8Array => new TextEncoder().encode(src)

describe('loading a program', () => {
  it('tells a tokenised program from a listing by its header', () => {
    expect(isAmosProgram(listing('AMOS Basic V134 xxxx'))).toBe(true)
    expect(isAmosProgram(listing('Print "hello"        '))).toBe(false)
    expect(isAmosProgram(listing('short'))).toBe(false)
    expect(isAmosProgram(null)).toBe(false)
  })

  it('gives a plain-text listing the stock extension slots', () => {
    // Without them the tokenizer knows only the core table, `Med Play` parses
    // as an identifier, and the program dies on `expected "="` as though Med
    // were an unassigned variable. Music is an extension, not core AMOS.
    const { lines, extensions } = loadProgram(listing('Med Play 7\n'), table)
    expect(extensions.size).toBeGreaterThan(0)
    const toks = lines.flatMap((l) => l.tokens)
    expect(toks.some((t) => t.kind === 'ext')).toBe(true)
  })

  it('still tokenises core keywords in a listing', () => {
    const { lines, amos } = loadProgram(listing('Print "Boom! Shake the workshop"\n'), table)
    expect(amos).toBeNull()
    expect(lines.flatMap((l) => l.tokens).some((t) => t.kind === 'core')).toBe(true)
  })
})
