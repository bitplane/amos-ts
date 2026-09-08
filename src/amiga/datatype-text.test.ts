import { describe, expect, it } from 'vitest'
import { decodeDataTypeText } from './datatype-text'

const id = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))
const long = (n: number): number[] => [n >>> 24, n >>> 16, n >>> 8, n].map((v) => v & 0xff)
const chunk = (name: string, body: number[]): number[] => [...id(name), ...long(body.length), ...body, ...(body.length & 1 ? [0] : [])]

describe('text datatypes', () => {
  it('joins the CHRS chunks in an IFF FTXT and skips formatting chunks', () => {
    const body = [...id('FTXT'), ...chunk('CHRS', id('hello ')), ...chunk('FONS', [0, 1, 2]), ...chunk('CHRS', id('world'))]
    const file = Uint8Array.from([...id('FORM'), ...long(body.length), ...body])
    expect(decodeDataTypeText(file, 'FTXT')).toBe('hello world')
  })

  it('opens AmigaGuide source as Latin-1 text', () => {
    const guide = Uint8Array.from(id('@database Manual\n@node Main "Hello"\nText\n@endnode\n'))
    expect(decodeDataTypeText(guide, 'AmigaGuide')).toContain('@node Main')
  })

  it('does not claim malformed input', () => {
    expect(decodeDataTypeText(new Uint8Array([1, 2, 3]), 'FTXT')).toBeNull()
    expect(decodeDataTypeText(Uint8Array.from(id('ordinary text')), 'AmigaGuide')).toBeNull()
  })
})
