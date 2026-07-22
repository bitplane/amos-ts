import { describe, expect, it } from 'vitest'
import { parseTokenTable } from './libtok'

const ch = (s: string) => [...s].map((c) => c.charCodeAt(0))

describe('parseTokenTable', () => {
  it('parses entries with names, variants and terminator styles', () => {
    const table = new Uint8Array([
      // null entry: instr 1, func 2, empty name, empty spec
      0, 1, 0, 2, 0x80, 0xff,
      // "bob" with spec I0, $FE variant marker
      0, 3, 0, 4, ...ch('bo'), 'b'.charCodeAt(0) | 0x80, ...ch('I0'), 0xfe,
      // unnamed variant, spec I, $FF (odd length -> padded)
      0, 5, 0, 6, 0x80, 'I'.charCodeAt(0), 0xff, 0,
      // terminator
      0, 0,
    ])
    const entries = parseTokenTable(table)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ id: 0, name: '', instr: 1, func: 2 })
    expect(entries[1]).toMatchObject({ id: 6, name: 'bob', spec: 'I0' })
    expect(entries[2]).toMatchObject({ id: 16, name: '', spec: 'I' })
  })
})
