import { describe, expect, it } from 'vitest'
import { joker, matchesJoker } from './joker'

/**
 * `Joker` (+Lib.s:6631). Every case below is read off the routine rather
 * than off any manual — the AMOS Professional manual documents `*` and `?`
 * for `Dir` and says nothing about what either does around a dot, nothing
 * about `/`, and nothing about `#`.
 *
 * This replaced a RegExp approximation that treated the filter as AmigaDOS's
 * `#?` / `*` / `?`. Four of the five rules below refute it.
 */
describe('Joker — AMOS\'s own filename filter (+Lib.s:6631)', () => {
  it('folds case on both sides (JokA/JokB)', () => {
    expect(joker('README', 'readme')).toBe(true)
    expect(joker('readme', 'README')).toBe(true)
    // and nothing outside a-z: the fold is two range compares, not a locale
    expect(joker('a[b', 'A[B')).toBe(true)
  })

  it('`*` stops at a dot and does not cross one (JokE/JokF)', () => {
    // the sharpest difference from AmigaDOS. `*` consumes name characters up
    // to the next '.', then hands back to the filter
    expect(joker('*.iff', 'pic.iff')).toBe(true)
    expect(joker('*.iff', 'my.pic.iff')).toBe(false) // would match under #?
    expect(joker('*.*', 'my.pic.iff')).toBe(false)
    expect(joker('*.*.*', 'my.pic.iff')).toBe(true)
  })

  it('`*` alone matches only a name with no dot in it', () => {
    // which is why AMOS has no "*" convention for listing everything: the
    // filter that means everything is empty, or '**'
    expect(joker('*', 'readme')).toBe(true)
    expect(joker('*', 'readme.txt')).toBe(false)
    expect(joker('**', 'readme.txt')).toBe(true)
    expect(joker('**', 'anything at all.abk')).toBe(true)
  })

  it('`?` matches any character EXCEPT a dot (JokC)', () => {
    expect(joker('level?.iff', 'level1.iff')).toBe(true)
    expect(joker('a?c', 'abc')).toBe(true)
    expect(joker('a?c', 'a.c')).toBe(false)
  })

  it('`.` is a literal dot (JokD)', () => {
    expect(joker('a.c', 'a.c')).toBe(true)
    expect(joker('a.c', 'abc')).toBe(false)
  })

  it('`#` is an ordinary character, so `#?` is a hash and a non-dot', () => {
    // dos.library's "zero or more" means nothing to this routine, and `#?`
    // is exactly what an Amiga programmer writes -- so the old RegExp read
    // the commonest filter in the corpus backwards
    expect(joker('#?.iff', 'picture.iff')).toBe(false)
    expect(joker('#?.iff', '#a.iff')).toBe(true)
    expect(joker('#?', '#a')).toBe(true)
  })

  it('`/` separates alternative filters, retried from the start (ReJok)', () => {
    expect(joker('*.iff/*.abk', 'pic.iff')).toBe(true)
    expect(joker('*.iff/*.abk', 'sound.abk')).toBe(true)
    expect(joker('*.iff/*.abk', 'notes.txt')).toBe(false)
    // three of them, and the last one still gets its turn
    expect(joker('a/b/c', 'c')).toBe(true)
    // the name really does go back to the start for each alternative
    expect(joker('xy/ab', 'ab')).toBe(true)
  })

  it('a filter that runs out with name left over fails outright (JokL0)', () => {
    // `beq.s JokNON`, not a branch to ReJok -- there is no alternative left
    // to try at the end of the string anyway, but the asymmetry is real
    expect(joker('ab', 'abc')).toBe(false)
    expect(joker('abc', 'ab')).toBe(false)
  })

  it('the name running out needs the filter to end too (JokX)', () => {
    expect(joker('', '')).toBe(true)
    expect(joker('abc', 'abc')).toBe(true)
    // ending on an alternative boundary counts as ending
    expect(joker('abc/xyz', 'abc')).toBe(true)
  })

  it('terminates on a filter that is all separators', () => {
    // ReJok's scan always moves the alternative start forward, so a filter
    // of nothing but '/' runs out rather than looping
    expect(joker('///', 'x')).toBe(false)
    expect(joker('/', '')).toBe(true)
  })

  it('an empty filter is not matched at all, it is skipped', () => {
    // FillDev +Lib.s:6120 and FillNxt :6215 both guard `tst.b (a0) / beq`.
    // matchesJoker is where that guard lives so no caller substitutes '*'
    expect(matchesJoker('', 'anything.at.all')).toBe(true)
    expect(joker('', 'anything.at.all')).toBe(false)
    expect(matchesJoker('*.iff', 'pic.iff')).toBe(true)
    expect(matchesJoker('*.iff', 'pic.abk')).toBe(false)
  })
})
