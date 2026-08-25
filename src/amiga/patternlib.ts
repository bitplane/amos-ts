/**
 * `pattern.library` 5.00 (23 Jan 1992), Copyright (C) 1992 by Angela Schmidt.
 *
 * A shared library that installs into `LIBS:`, so it belongs here beside
 * `powerpacker.library` and the Imploder rather than with whichever caller
 * happened to need it first. EasyLife's nine `Elpat` keywords are the caller
 * today; the library itself knows nothing about AMOS.
 *
 * It is a THIRD pattern grammar in this tree and must not be confused with
 * either of the others:
 *
 *   `dospattern.ts`   dos.library's ParsePattern/MatchPattern, behind
 *                     LDos's `Lmatch` and JD-K3's `Jd Match`
 *   Joker             AMOS's own, +Lib.s:6602
 *   this              Angela Schmidt's, and closest of the three to a
 *                     regular expression: it has alternation and negation
 *
 * ## What was read, and from where
 *
 * The binary is `fixtures/extensions/easylife-1.10/libs/pattern.library`,
 * 19,280 bytes, three hunks. It carries no RTF_AUTOINIT romtag, so the
 * function table is not where a romtag would point: it is the longword table
 * at $12c, 25 entries, found by scanning for a run of in-range even
 * addresses. Numbering from LVO -6:
 *
 *   -72  $1b44  ParsePattern, case sensitive
 *   -78  $1ae8  ParsePattern, case folded
 *   -84  $19f6  the scan-and-copy worker behind Test and Remove
 *   -90  $1a82  the escape worker
 *   -96  $1d84  match a subject against a parsed pattern
 *  -102  $1998  free a parsed pattern
 *  -108  $21ae  parse, match and free, case sensitive
 *  -114  $21e6  parse, match and free, case folded
 *
 * Four of those are reproduced here at instruction level, because they are
 * small and wholly readable: $19f6, $1a82, the fold table at $4540, and the
 * compiler's dispatch and error codes. The MATCHER's internal form is not
 * reproduced --- see the note on `matchPattern`.
 *
 * ## Errors
 *
 * The library answers small negatives; the codes are recorded here because
 * they distinguish the failures, even though EasyLife collapses all of them
 * to one AMOS error with a `bmi`.
 *
 *   -100  $1bf8, $1dda  out of memory
 *   -101  $956          a `)` with no `(`
 *   -103  $948          a `]` with no `[`
 *   -105  $764, $97e,   a trailing `#` or `~`, an empty alternative,
 *         $b10, $bf0    a trailing `'`
 *   -107  $1b5a         the flags argument was not zero
 */

/** the library's own error numbers, from the `moveq` at each failure */
export const PATTERN_NOMEM = -100
export const PATTERN_UNMATCHED_PAREN = -101
export const PATTERN_UNMATCHED_BRACKET = -103
export const PATTERN_BAD_PATTERN = -105
export const PATTERN_BAD_FLAGS = -107

/** thrown instead of an AMOS error, because this layer has no AMOS in it */
export class PatternError extends Error {
  constructor(readonly code: number) {
    super(`pattern.library error ${code}`)
    this.name = 'PatternError'
  }
}

/**
 * The eleven characters the library treats as control characters, in the
 * order its comparison chain tests them. Both $19f6 and $1a82 subtract $2a
 * ('*') first and then walk outwards, and the compiler at $69e repeats the
 * same chain, so all three agree by construction:
 *
 *     sub.b #$2a,d0 / beq -> '*'
 *     bpl        -> the upper arm: $3f '?', $5b '[', $5d ']', $7c '|', $7e '~'
 *     addq.b #7  -> the lower arm: $23 '#', $25 '%', $27 '\'', $28 '(', $29 ')'
 *
 * `(` and `)` are in the set even though the guide lists them under grouping
 * rather than under control characters, which is why `Elpat Test("(a)")`
 * answers true.
 */
export const PATTERN_SPECIALS = "*#%'()?[]|~"

const isSpecial = (c: number): boolean => PATTERN_SPECIALS.includes(String.fromCharCode(c))

/**
 * The 256-byte fold table at $4540, applied by the routine at $1fc6 to the
 * pattern (and, in $1d84, to the subject as well) whenever the case-folded
 * entry points are used.
 *
 * Fifty-six bytes differ from the identity: `a`-`z` to `A`-`Z`, and $e0-$fe
 * to $c0-$de. The two holes in that upper run are the ones ISO 8859-1
 * requires --- $f7 is the division sign, not a letter, and $ff has no
 * uppercase form in Latin-1 --- so the table is a correct Latin-1 upcase and
 * not a blanket subtract-32. `patternlib.test.ts` checks all 256 bytes
 * against the library file itself.
 */
export function patternFold(c: number): number {
  if (c >= 0x61 && c <= 0x7a) return c - 32
  if (c >= 0xe0 && c <= 0xfe && c !== 0xf7) return c - 32
  return c
}

const foldStr = (s: string): string =>
  s.replace(/[\s\S]/g, (ch) => String.fromCharCode(patternFold(ch.charCodeAt(0) & 0xff)))

/**
 * The worker at $19f6, in its two modes. With no output buffer it stops at
 * the first control character and answers 1; with one it copies the whole
 * string and answers whether it saw any.
 *
 * The `'` arm at $1a42 is where the two modes genuinely differ. It steps
 * over the quote first, and then:
 *
 *     tst.b (a0) / beq $1a4c         a trailing quote: flag it either way
 *     move.l a1,d2 / bne $1a52       with a buffer, go straight to the copy
 *     ...                            without one, flag it
 *
 * so in copy mode the quote is DROPPED and whatever followed it is copied
 * raw. That is the defect described on `patternRemove`.
 */
function scanPattern(s: string, copy: boolean): { hit: boolean; out: string } {
  let out = ''
  let hit = false
  let i = 0
  while (i < s.length) {
    const c = s.charCodeAt(i) & 0xff
    if (c === 0x27) {
      // the escape arm: step over the quote, then diverge by mode
      i++
      if (i >= s.length) {
        hit = true
        if (!copy) break
        // $1a4c falls into the copy, which reads the byte past the
        // terminator; nothing sensible can be copied, so stop here
        break
      }
      if (!copy) {
        hit = true
        break
      }
      out += s[i]
      i++
      continue
    }
    if (isSpecial(c)) {
      hit = true
      if (!copy) break
    }
    if (copy) out += s[i]
    i++
  }
  return { hit, out }
}

/**
 * `= Elpat Test( S$ )` --- $19f6 with a null output buffer. "Returns True if
 * the string S$ contains any special pattern matching control characters."
 */
export const patternHasSpecials = (s: string): boolean => scanPattern(s, false).hit

/**
 * `= Elpat Remove( P$ )` --- $19f6 with an output buffer.
 *
 * NOTE: the guide says this "removes all unecessary pattern matching
 * characters", and for an escape before an ORDINARY character that is what
 * happens: `'a` becomes `a`. But the copy arm does not check what it is
 * unescaping, so `a'*` becomes `a*` --- a literal asterisk turned into a
 * wildcard, which changes what the pattern means rather than tidying it.
 * Reproduced, because a caller following the guide's own
 * `P$=Elpat Remove(P$) : If Elpat Test(P$)` idiom would see it.
 *
 * A pattern ending in a bare `'` also walks off the end of the source in the
 * real routine, copying the terminator and then testing the byte after it.
 * Nothing useful can come of that, so this stops at the terminator instead;
 * the DEVIATION is invisible to any caller whose buffer is not adjacent to
 * something interesting.
 */
export const patternRemove = (p: string): string => scanPattern(p, true).out

/**
 * `= Elpat Escape( S$ )` --- $1a82. Writes a `'` before each of the eleven
 * control characters and copies everything else through, which is why the
 * caller has to allocate twice the source length.
 */
export function patternEscape(s: string): string {
  let out = ''
  for (const ch of s) {
    if (isSpecial(ch.charCodeAt(0) & 0xff)) out += "'"
    out += ch
  }
  return out
}

/* ---- the compiled pattern ------------------------------------------------
 *
 * The compiler at $66e allocates uniform cells --- `(cell)` a child list,
 * `$4(cell)` the next cell, `$8(cell)` a type byte, `$c(cell)` a count ---
 * and every branch of its dispatch ends in a `move.b #N,$8(...)`. Those ten
 * type numbers are kept here because they are what makes each branch below
 * checkable against the listing:
 *
 *    1  $70c, $a90   repeat: `#E`, and `*` which is `#?`
 *    2  $c42         one literal character
 *    3  $714         negate: `~E`
 *    4  $8a2, $9b4   an alternative in a list
 *    5  $c7c         a run of literal characters
 *    6  $ae0, $aaa   any character, `$c` of them: `?` counts its repeats
 *    7  $844         `[~...]`, the negated bracket
 *    8  $b4c         a range, `a-z`, only inside brackets
 *    9  $ad4, $870   the empty match, `%`, and the end of a list
 *   10  $784, $84e   a list: `(...)` and `[...]`
 */
type Node =
  | { t: 1; sub: Node[] } // repeat
  | { t: 2; ch: number } // literal
  | { t: 3; sub: Node[] } // negate
  | { t: 6; count: number } // any, count characters
  | { t: 7; alts: Node[][] } // [~...]
  | { t: 8; lo: number; hi: number } // range
  | { t: 9 } // empty
  | { t: 10; alts: Node[][] } // (...) and [...]

export interface ParsedPattern {
  /** the alternatives of the whole pattern, `a|b|c` */
  alts: Node[][]
  /** `$5a` of the compiled struct: 1 case sensitive, 2 case folded */
  mode: 1 | 2
}

/**
 * ParsePattern --- $1b44 case sensitive, $1ae8 case folded.
 *
 * The folded entry does not parse differently: it copies the pattern, runs
 * the copy through the fold table at $1fc6, parses THAT with $1b44, and then
 * stamps `$5a` to 2 so the matcher knows to fold the subject too. So one
 * parser, two flags, which is what this reproduces.
 *
 * The grammar is the compiler's dispatch at $69e, in its order:
 *
 *   `#E` `~E`  $6ee   one handler for both, since both are prefix operators
 *              $764   a trailing one, with nothing to apply to, is -105
 *   `(`        $772   a list; $956 is the `)` with no `(`, -101
 *   `[`        $7fa   $18d8 finds the matching `]` allowing for nesting;
 *                     $844 makes it type 7 if a `~` follows the bracket,
 *                     $84e type 10 otherwise; $948 is `]` alone, -103
 *   `]` `)`           close the current list
 *   `|`        $964   splits the chain; an empty side is -105 at $97e
 *   `*`        $a90   a repeat whose child is a one-character `?`
 *   `%`        $abe   the empty match --- but a `%` followed by another `%`
 *                     emits nothing at all and just advances, so a run of
 *                     them collapses to one
 *   `?`        $ae0   `$c` counts the run, so `???` is one node of three
 *   `'`        $b04   escape; $b10 is a trailing one, -105
 *   otherwise  $b1a   a literal, or a range if `$42(a5)` bit 7 says we are
 *                     inside brackets AND the next character is `-` AND the
 *                     one after that is not `]`
 *
 * That last condition is the guide's rule stated from the other side: "if
 * you want to match the `-` character, it must be either the first or last
 * character in the brackets".
 */
export function parsePattern(pattern: string, noCase: boolean, flags = 0): ParsedPattern {
  if (flags !== 0) throw new PatternError(PATTERN_BAD_FLAGS)
  const p = noCase ? foldStr(pattern) : pattern
  let i = 0

  /** one `|`-separated group of chains, up to a closer */
  const parseAlts = (closer: '' | ')' | ']', inBrackets: boolean): Node[][] => {
    const alts: Node[][] = []
    for (;;) {
      const chain = parseChain(closer, inBrackets)
      // $97e: an alternative with nothing in it is not allowed
      if (chain.length === 0 && (alts.length > 0 || p[i] === '|')) {
        throw new PatternError(PATTERN_BAD_PATTERN)
      }
      alts.push(chain)
      if (p[i] === '|') {
        i++
        continue
      }
      break
    }
    return alts
  }

  const parseChain = (closer: '' | ')' | ']', inBrackets: boolean): Node[] => {
    const out: Node[] = []
    for (;;) {
      if (i >= p.length) {
        // $956 / $948: a list that never closed
        if (closer === ')') throw new PatternError(PATTERN_UNMATCHED_PAREN)
        if (closer === ']') throw new PatternError(PATTERN_UNMATCHED_BRACKET)
        return out
      }
      const c = p[i]!
      if (c === '|') return out
      if (c === ')') {
        if (closer !== ')') throw new PatternError(PATTERN_UNMATCHED_PAREN)
        return out
      }
      if (c === ']') {
        if (closer !== ']') throw new PatternError(PATTERN_UNMATCHED_BRACKET)
        return out
      }
      out.push(parseItem(inBrackets))
    }
  }

  const parseItem = (inBrackets: boolean): Node => {
    const c = p[i]!
    // $6ee: `#` and `~` share a handler and differ only in the type byte
    if (c === '#' || c === '~') {
      i++
      if (i >= p.length) throw new PatternError(PATTERN_BAD_PATTERN)
      const sub = [parseItem(inBrackets)]
      return c === '#' ? { t: 1, sub } : { t: 3, sub }
    }
    // $a90: `*` is a repeat over a one-character any, i.e. literally `#?`
    if (c === '*') {
      i++
      return { t: 1, sub: [{ t: 6, count: 1 }] }
    }
    // $ae0: consecutive `?` collapse into one node with a count
    if (c === '?') {
      let n = 0
      while (p[i] === '?') {
        n++
        i++
      }
      return { t: 6, count: n }
    }
    // $abe: `%%` advances without emitting, so only the last of a run counts
    if (c === '%') {
      while (p[i] === '%' && p[i + 1] === '%') i++
      i++
      return { t: 9 }
    }
    if (c === '(') {
      i++
      const alts = parseAlts(')', false)
      if (p[i] !== ')') throw new PatternError(PATTERN_UNMATCHED_PAREN)
      i++
      return { t: 10, alts }
    }
    if (c === '[') {
      i++
      // $844 versus $84e: a `~` immediately inside makes the whole bracket
      // a rejection rather than a selection
      const negated = p[i] === '~'
      if (negated) i++
      const alts = bracketAlts()
      if (p[i] !== ']') throw new PatternError(PATTERN_UNMATCHED_BRACKET)
      i++
      return negated ? { t: 7, alts } : { t: 10, alts }
    }
    // $b04: the escape, and $b10 its trailing form
    if (c === "'") {
      i++
      if (i >= p.length) throw new PatternError(PATTERN_BAD_PATTERN)
      const lit = p.charCodeAt(i) & 0xff
      i++
      return { t: 2, ch: lit }
    }
    // $b1a: a literal, or the start of a range
    const lit = p.charCodeAt(i) & 0xff
    if (inBrackets && p[i + 1] === '-' && p[i + 2] !== undefined && p[i + 2] !== ']') {
      i += 2
      const hi = p.charCodeAt(i) & 0xff
      i++
      return { t: 8, lo: lit, hi }
    }
    i++
    return { t: 2, ch: lit }
  }

  /**
   * Inside brackets every expression is an alternative in its own right ---
   * the guide's "[abc] ... is a shorthand for (a|b|c)", and "[(ab)c(de)]
   * matches "ab","c" and "de" only" --- so juxtaposition alternates here
   * where everywhere else it concatenates. That is the type 4 chain the `[`
   * handler builds at $89e onwards, one cell per expression.
   */
  const bracketAlts = (): Node[][] => {
    const alts: Node[][] = []
    while (i < p.length && p[i] !== ']') {
      if (p[i] === '|') {
        i++
        continue
      }
      alts.push([parseItem(true)])
    }
    if (i >= p.length) throw new PatternError(PATTERN_UNMATCHED_BRACKET)
    return alts
  }

  const alts = parseAlts('', false)
  if (i < p.length) {
    // only a stray closer can leave input behind
    throw new PatternError(p[i] === ')' ? PATTERN_UNMATCHED_PAREN : PATTERN_UNMATCHED_BRACKET)
  }
  return { alts, mode: noCase ? 2 : 1 }
}

/**
 * MatchPattern --- $1d84.
 *
 * The subject is matched WHOLE: the guide's `"b?b" matches the string "bab",
 * but not "baab"` only holds if both ends are anchored, and `"a*"` matching
 * "aardvark" needs the `*` to reach the end.
 *
 * $1d84 does not backtrack. It allocates two arrays of `(strlen+1)*4` bytes
 * ($1e52 and $1eb4, both `AllocMem` of `(d0+1)<<2`) and hands them to $1894
 * with the node list, which is the shape of a set-of-positions simulation
 * rather than a recursive descent with a stack. That matters for `~`: the
 * complement of a set of reachable end positions is a set, and negation is
 * only cheap in that formulation --- a backtracker cannot express `~` at all
 * without re-running the sub-pattern to exhaustion.
 *
 * So this reproduces the SEMANTICS as reachable end positions, not the
 * library's two arrays:
 *
 *     ends(E, i) = { j : E matches subject[i..j) }
 *
 * and the pattern matches when `subject.length` is in `ends(root, 0)`.
 *
 * NOTE: the compiled form itself is not reproduced. The 0x5c-byte struct,
 * its two hanging allocations freed at $19b8 and $19d2, the `$1c` custom
 * comparison hook called at $1dee and the `$2f` bit that inverts its answer
 * are all invisible through the library's own entry points, and EasyLife
 * never sets the hook: routines 137 and 138 store what ParsePattern returned
 * and nothing else. What is observable is the answer, and that is what this
 * is checked on.
 */
export function matchPattern(pat: ParsedPattern, subject: string): boolean {
  const s = pat.mode === 2 ? foldStr(subject) : subject
  const n = s.length

  const chainEnds = (chain: Node[], from: number): Set<number> => {
    let cur = new Set<number>([from])
    for (const node of chain) {
      const next = new Set<number>()
      for (const at of cur) for (const j of nodeEnds(node, at)) next.add(j)
      if (next.size === 0) return next
      cur = next
    }
    return cur
  }

  const altsEnds = (alts: Node[][], from: number): Set<number> => {
    const out = new Set<number>()
    for (const chain of alts) for (const j of chainEnds(chain, from)) out.add(j)
    return out
  }

  const nodeEnds = (node: Node, at: number): Set<number> => {
    switch (node.t) {
      case 2:
        return at < n && (s.charCodeAt(at) & 0xff) === node.ch ? new Set([at + 1]) : new Set()
      case 6:
        // `$c` consecutive any-characters, all or nothing
        return at + node.count <= n ? new Set([at + node.count]) : new Set()
      case 8:
        if (at >= n) return new Set()
        {
          const c = s.charCodeAt(at) & 0xff
          return c >= node.lo && c <= node.hi ? new Set([at + 1]) : new Set()
        }
      case 9:
        return new Set([at])
      case 10:
        return altsEnds(node.alts, at)
      case 7: {
        // `[~...]` rejects one character: it consumes exactly one, and only
        // if none of the alternatives would have matched there
        if (at >= n) return new Set()
        const hit = altsEnds(node.alts, at)
        return hit.size === 0 ? new Set([at + 1]) : new Set()
      }
      case 1: {
        // zero or more, as a closure over reachable positions
        const seen = new Set<number>([at])
        const queue = [at]
        while (queue.length) {
          const from = queue.pop()!
          for (const j of chainEnds(node.sub, from)) {
            // a sub-expression that matched nothing would loop for ever
            if (!seen.has(j)) {
              seen.add(j)
              queue.push(j)
            }
          }
        }
        return seen
      }
      case 3: {
        // every end position the sub-expression does NOT reach
        const hit = chainEnds(node.sub, at)
        const out = new Set<number>()
        for (let j = at; j <= n; j++) if (!hit.has(j)) out.add(j)
        return out
      }
    }
  }

  return altsEnds(pat.alts, 0).has(n)
}

/**
 * The composite entry points, $21ae case sensitive and $21e6 folded: parse,
 * match, free, and pass a parse failure straight out.
 *
 *     bsr ParsePattern / tst.l d2 / ble  -> return the parse result
 *     bsr MatchPattern / bsr FreePattern -> return the match result
 */
export function matchOnce(pattern: string, subject: string, noCase: boolean): boolean {
  return matchPattern(parsePattern(pattern, noCase), subject)
}
