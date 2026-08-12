import { describe, expect, it } from 'vitest'
import { isNumericColumn, mdTable } from './mdtable'

describe('mdTable', () => {
  it('pads every column to its widest member and right-justifies numbers', () => {
    const t = mdTable(
      ['area', 'keywords', 'coverage'],
      [
        ['aga-1.0', '24', '100%'],
        ['amospro-colours-1.0', '27', '100%'],
        ['amon-1.04', '24', '0%'],
      ],
    )
    expect(t).toBe(
      [
        '| area                | keywords | coverage |',
        '| ------------------- | -------: | -------: |',
        '| aga-1.0             |       24 |     100% |',
        '| amospro-colours-1.0 |       27 |     100% |',
        '| amon-1.04           |       24 |       0% |',
      ].join('\n'),
    )
  })

  /** the header is a word over a column of figures, so it must not vote */
  it('does not let the heading make a numeric column left-aligned', () => {
    expect(isNumericColumn(['24', '280', '3'])).toBe(true)
    expect(mdTable(['keywords'], [['24'], ['280']])).toContain('-------:')
  })

  it('treats placeholders as neither numeric nor prose', () => {
    expect(isNumericColumn(['100%', '—', '0%'])).toBe(true)
    expect(isNumericColumn(['—', '—'])).toBe(false)
    expect(isNumericColumn(['12', 'see note'])).toBe(false)
  })

  it('accepts signed, decimal and thousands-separated figures', () => {
    expect(isNumericColumn(['-1', '1,024', '3.5', '99%'])).toBe(true)
    expect(isNumericColumn(['$1a'])).toBe(false)
  })

  it('honours an explicit alignment over the inference', () => {
    const t = mdTable(['n'], [['1']], ['left'])
    expect(t).toBe(['| n   |', '| --- |', '| 1   |'].join('\n'))
  })

  it('never emits a column narrower than the separator needs', () => {
    for (const line of mdTable(['a'], [['1']]).split('\n')) expect(line.length).toBe(7)
  })

  it('throws on a ragged row rather than rendering it wrong', () => {
    expect(() => mdTable(['a', 'b'], [['1']])).toThrow(/row 0 has 1 cells/)
  })
})
