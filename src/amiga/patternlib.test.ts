import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadHunks } from './hunk'
import {
  PATTERN_BAD_PATTERN,
  PATTERN_SPECIALS,
  PATTERN_UNMATCHED_BRACKET,
  PATTERN_UNMATCHED_PAREN,
  PatternError,
  matchOnce,
  parsePattern,
  patternEscape,
  patternFold,
  patternHasSpecials,
  patternRemove,
} from './patternlib'

const LIB = join(
  __dirname,
  '..',
  '..',
  'fixtures',
  'extensions',
  'easylife-1.10',
  'libs',
  'pattern.library',
)

/** the error code, or 0 if it parsed */
const code = (p: string, noCase = false): number => {
  try {
    parsePattern(p, noCase)
    return 0
  } catch (e) {
    return e instanceof PatternError ? e.code : NaN
  }
}
const m = (p: string, s: string): boolean => matchOnce(p, s, false)

describe('pattern.library: the fold table, against the library itself', () => {
  it.skipIf(!existsSync(LIB))('reproduces all 256 bytes of the table at $4540', () => {
    // fixtures/ is gitignored, so this is the one test that can only run
    // where the archive is. It is also the only one that can prove the fold
    // is Latin-1 rather than a blanket subtract-32.
    const image = loadHunks(new Uint8Array(readFileSync(LIB)), 0).image
    const at = 0xc516 - 0x7fd6 // the `lea $c516,a4` bias, less the -$7fd6 index
    for (let c = 0; c < 256; c++) expect([c, image[at + c]]).toEqual([c, patternFold(c)])
  })

  it('is a Latin-1 upcase, with the two holes Latin-1 requires', () => {
    expect(patternFold(0x61)).toBe(0x41) // a -> A
    expect(patternFold(0x7a)).toBe(0x5a) // z -> Z
    expect(patternFold(0x41)).toBe(0x41) // A stays
    expect(patternFold(0xe0)).toBe(0xc0) // a-grave -> A-grave
    expect(patternFold(0xfe)).toBe(0xde) // thorn
    expect(patternFold(0xf7)).toBe(0xf7) // the division sign is not a letter
    expect(patternFold(0xff)).toBe(0xff) // y-diaeresis has no Latin-1 uppercase
    let changed = 0
    for (let c = 0; c < 256; c++) if (patternFold(c) !== c) changed++
    expect(changed).toBe(56)
  })
})

describe('pattern.library: the control character set ($19f6, $1a82, $69e)', () => {
  it('is exactly eleven characters', () => {
    expect([...PATTERN_SPECIALS].sort().join('')).toBe("!#%'()*?[]|~".replace('!', ''))
    expect(PATTERN_SPECIALS.length).toBe(11)
  })

  it('Elpat Test answers for each of them and for nothing else', () => {
    for (const c of PATTERN_SPECIALS) expect([c, patternHasSpecials(`a${c}b`)]).toEqual([c, true])
    for (const c of 'abzAZ09 .,-_+=<>{}"@£$^&/\\:;') {
      expect([c, patternHasSpecials(`a${c}b`)]).toEqual([c, false])
    }
    expect(patternHasSpecials('')).toBe(false)
  })

  it('counts parentheses as control characters, which the guide files elsewhere', () => {
    expect(patternHasSpecials('(a)')).toBe(true)
  })
})

describe('pattern.library: Escape ($1a82)', () => {
  it('quotes every control character and passes the rest through', () => {
    expect(patternEscape('fred')).toBe('fred')
    expect(patternEscape('a*b')).toBe("a'*b")
    expect(patternEscape("'")).toBe("''")
    expect(patternEscape('#%()*?[]|~')).toBe("'#'%'('){0}'*'?'[']'|'~".replace('{0}', ''))
  })

  it('never grows a string past twice its length, which is what the caller allocates', () => {
    for (const s of ['', 'a', '****', "a'b*c", PATTERN_SPECIALS]) {
      expect(patternEscape(s).length).toBeLessThanOrEqual(s.length * 2)
    }
  })

  it('round-trips: an escaped string matches itself literally', () => {
    for (const s of ['a*b', 'x?y', '[a]', 'a|b', "q'r", '~z', '#w', '(p)', '100%']) {
      expect([s, m(patternEscape(s), s)]).toEqual([s, true])
    }
  })
})

describe('pattern.library: Remove ($19f6 with a buffer)', () => {
  it('drops a quote before an ordinary character', () => {
    expect(patternRemove("'a'b'c")).toBe('abc')
    expect(patternRemove('fred')).toBe('fred')
  })

  it('leaves live control characters alone', () => {
    expect(patternRemove('a*b')).toBe('a*b')
    expect(patternRemove('[a-z]#?')).toBe('[a-z]#?')
  })

  it('DEFECT: it unescapes control characters too, changing what the pattern means', () => {
    // the copy arm at $1a5c does not look at what it is unescaping, so a
    // quoted asterisk comes back as a live wildcard
    expect(patternRemove("a'*")).toBe('a*')
    expect(m("a'*", 'a*')).toBe(true)
    expect(m(patternRemove("a'*"), 'a*')).toBe(true) // still true, by luck
    expect(m("a'*", 'axyz')).toBe(false) // but the meaning has changed
    expect(m(patternRemove("a'*"), 'axyz')).toBe(true)
  })

  it("and the guide's own idiom is what exposes it", () => {
    // "P$ = ElPat Remove(P$) : If ElPat Test(P$) ..." --- a string that was
    // a plain literal before Remove is a pattern after it
    expect(patternHasSpecials(patternRemove("100'%"))).toBe(true)
  })
})

describe('pattern.library: the grammar ($69e), on the guide’s own examples', () => {
  it('a literal expression matches itself and only itself', () => {
    expect(m('a', 'a')).toBe(true)
    expect(m('a', 'b')).toBe(false)
    expect(m('fred', 'fred')).toBe(true)
    expect(m('fred', 'fredx')).toBe(false)
    expect(m('(hello) world', 'hello world')).toBe(true)
  })

  it('% matches the empty string', () => {
    expect(m('%', '')).toBe(true)
    expect(m('%', 'a')).toBe(false)
    expect(m('(ab|cd|%)', '')).toBe(true)
    expect(m('(ab|cd|%)', 'ab')).toBe(true)
    expect(m('(ab|cd|%)', 'cd')).toBe(true)
    expect(m('(ab|cd|%)', 'ac')).toBe(false)
  })

  it('a run of % collapses, because $abe advances without emitting', () => {
    expect(m('%%', '')).toBe(true)
    expect(m('%%%%a', 'a')).toBe(true)
  })

  it('? matches any single character', () => {
    expect(m('b?b', 'bab')).toBe(true)
    expect(m('b?b', 'baab')).toBe(false)
    expect(m('???', 'xyz')).toBe(true)
    expect(m('???', 'xy')).toBe(false)
  })

  it('#E repeats an expression zero or more times', () => {
    for (const s of ['', 'ab', 'abab', 'ababab']) expect([s, m('#(ab)', s)]).toEqual([s, true])
    expect(m('#(ab)', 'aba')).toBe(false)
    expect(m('#?', 'anything at all')).toBe(true)
  })

  it('* is a shortcut for #?', () => {
    for (const s of ['a', 'and', 'aardvark']) expect([s, m('a*', s)]).toEqual([s, true])
    expect(m('a*', 'bad')).toBe(false)
    expect(m('*', '')).toBe(true)
  })

  it('| offers alternatives', () => {
    expect(m('ab|cd', 'ab')).toBe(true)
    expect(m('ab|cd', 'cd')).toBe(true)
    expect(m('ab|cd', 'abcd')).toBe(false)
    expect(m('ab|cd', 'ac')).toBe(false)
  })

  it('~ negates the following expression', () => {
    // "~(ab*)" matches "","and","bass","can", and anything else that
    // doesn't begin with "ab"
    for (const s of ['', 'and', 'bass', 'can']) expect([s, m('~(ab*)', s)]).toEqual([s, true])
    for (const s of ['ab', 'abc', 'abbbb']) expect([s, m('~(ab*)', s)]).toEqual([s, false])
  })

  it('and ~ab* is a different pattern from ~(ab*), as the guide warns', () => {
    // ~ binds to the single expression that follows, so this is (~a)(b)(*)
    expect(m('~ab*', 'xb')).toBe(true)
    expect(m('~ab*', 'xbcde')).toBe(true)
    expect(m('~(ab*)', 'xb')).toBe(true)
    // the two differ on a subject that begins "ab"
    expect(m('~(ab*)', 'abz')).toBe(false)
  })

  it('[] matches any one of the expressions inside', () => {
    for (const s of ['a', 'b', 'c']) expect([s, m('[abc]', s)]).toEqual([s, true])
    expect(m('[abc]', 'd')).toBe(false)
    expect(m('[abc]', 'ab')).toBe(false)
    // "[(ab)c(de)]" matches "ab","c" and "de" only
    for (const s of ['ab', 'c', 'de']) expect([s, m('[(ab)c(de)]', s)]).toEqual([s, true])
    expect(m('[(ab)c(de)]', 'a')).toBe(false)
  })

  it('[] takes ranges, and a leading or trailing - is a literal', () => {
    expect(m('[0-9]', '7')).toBe(true)
    expect(m('[0-9]', 'a')).toBe(false)
    expect(m('#[-0-9a-z ]', 'a lower-case word 42')).toBe(true)
    expect(m('#[-0-9a-z ]', 'Capital')).toBe(false)
    expect(m('[a-]', '-')).toBe(true)
    expect(m('[a-]', 'a')).toBe(true)
    expect(m('[a-]', 'b')).toBe(false)
  })

  it('DEVIATION from the guide: * is standalone, so [0-9]* is not "any integer"', () => {
    // The guide's `*` entry says it "is a shortcut for the pattern "#?"",
    // and its examples for `[]` say `"[0-9]*" will match any positive
    // integer` and `"[-0-9a-z ]*" means any lower case word`. Those two
    // readings cannot both hold: a standalone `#?` after a class means "one
    // from the class, then anything", while "any positive integer" needs the
    // `*` to repeat the CLASS.
    //
    // $a90 settles it and the binary wins. The handler sets the CURRENT
    // node to type 1 and allocates it a fresh type 6 child of count 1; it
    // never looks at what preceded it. So `*` is exactly `#?` wherever it
    // appears, and the repeat-the-class reading would have to be written
    // `#[0-9]`.
    expect(m('[0-9]*', '7')).toBe(true)
    expect(m('[0-9]*', '7abc')).toBe(true) // not an integer, and it matches
    expect(m('[0-9]*', 'a7')).toBe(false) // the class still binds the first
    expect(m('#[0-9]', '7abc')).toBe(false) // which is what the guide meant
    expect(m('#[0-9]', '12345')).toBe(true)
  })

  it('a leading ~ inside brackets rejects instead of selecting', () => {
    expect(m('[~a-z]', 'A')).toBe(true)
    expect(m('[~a-z]', 'q')).toBe(false)
    expect(m('[~a-z]', '')).toBe(false) // it still consumes one character
  })

  it("' escapes the next character, including itself and parentheses", () => {
    expect(m("a'*", 'a*')).toBe(true)
    expect(m("a'*", 'ab')).toBe(false)
    expect(m("''", "'")).toBe(true)
    expect(m("'(", '(')).toBe(true)
  })
})

describe('pattern.library: the parse errors, by their own codes', () => {
  it('-105 for a trailing # or ~ ($764), or a trailing quote ($b10)', () => {
    expect(code('ab#')).toBe(PATTERN_BAD_PATTERN)
    expect(code('ab~')).toBe(PATTERN_BAD_PATTERN)
    expect(code("ab'")).toBe(PATTERN_BAD_PATTERN)
    expect(code("ab'#")).toBe(0) // escaped, so it is a literal
  })

  it('-105 for an empty alternative ($97e)', () => {
    expect(code('(ab|)')).toBe(PATTERN_BAD_PATTERN)
    expect(code('(|ab)')).toBe(PATTERN_BAD_PATTERN)
    expect(code('a|')).toBe(PATTERN_BAD_PATTERN)
    expect(code('(ab|%)')).toBe(0) // which is what % is for
  })

  it('-101 and -103 for unpaired brackets ($956, $948)', () => {
    expect(code('(ab')).toBe(PATTERN_UNMATCHED_PAREN)
    expect(code('ab)')).toBe(PATTERN_UNMATCHED_PAREN)
    expect(code('[ab')).toBe(PATTERN_UNMATCHED_BRACKET)
    expect(code('ab]')).toBe(PATTERN_UNMATCHED_BRACKET)
    expect(code("'(ab")).toBe(0) // escaped ones are not counted
  })

  it('and the empty pattern is legal, matching only the empty string', () => {
    expect(code('')).toBe(0)
    expect(m('', '')).toBe(true)
    expect(m('', 'a')).toBe(false)
  })
})

describe('pattern.library: the folded entry point ($1ae8, $1d84)', () => {
  it('folds the pattern and the subject through the same table', () => {
    expect(matchOnce('FRED', 'fred', true)).toBe(true)
    expect(matchOnce('fred', 'FRED', true)).toBe(true)
    expect(matchOnce('fred', 'FRED', false)).toBe(false)
    expect(matchOnce('[a-z]*', 'ABC', true)).toBe(true)
  })

  it('and the fold reaches Latin-1, which a subtract-32 would get wrong', () => {
    expect(matchOnce('é', 'É', true)).toBe(true) // e-acute
    expect(matchOnce('÷', '×', true)).toBe(false) // division vs multiplication
  })
})
