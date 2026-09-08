import { describe, expect, it } from 'vitest'
import { ReadArgs } from './readargs'

describe('dos.library ReadArgs', () => {
  it('accepts aliases, equals forms, switches and escaped quotes', () => {
    const r = new ReadArgs()
    expect(r.read('Q FILE="a b" NOTE "say *"hello*""', 'QUICK=Q/S,FILE/A/K,NOTE/K')).toBe(true)
    expect([r.number(0), r.string(1), r.string(2)]).toEqual([-1, 'a b', 'say "hello"'])
  })

  it('does not treat a quoted keyword as a keyword', () => {
    const r = new ReadArgs(); expect(r.read('"QUIET"', 'NAME/A,QUIET/S')).toBe(true)
    expect(r.string(0)).toBe('QUIET'); expect(r.number(1)).toBe(0)
  })

  it('gives trailing required arguments back from a multi argument', () => {
    const r = new ReadArgs(); expect(r.read('one two destination', 'FROM/A/M,TO/A')).toBe(true)
    expect([r.string(0, 0), r.string(0, 1), r.string(1)]).toEqual(['one', 'two', 'destination'])
  })

  it('captures /F as one value and rejects malformed input', () => {
    const r = new ReadArgs(); expect(r.read('LIST SYS: ALL', 'COMMAND/F')).toBe(true); expect(r.string(0)).toBe('LIST SYS: ALL')
    expect(r.read('COUNT=nope', 'COUNT/N/K')).toBe(false)
    expect(r.read('"unfinished', 'VALUE')).toBe(false)
    expect(r.read('one two', 'VALUE')).toBe(false)
  })
})
