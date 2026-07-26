/**
 * AmigaDOS pattern matching, as `Lmatch` exposes it.
 *
 * LdosV25.DOC documents the syntax exactly, and it is dos.library's own —
 * richer than the `#?` / `*` / `?` subset `amigaPattern` in vfs.ts handles for
 * filename globbing:
 *
 *     ?        Matches a single character.
 *     #        Matches the following expression 0 or more times.
 *     (ab|cd)  Matches any one of the items separated by '|'.
 *     ~        Negates the following expression. It matches all strings
 *              that do not match the expression.
 *     [abc]    Character class: matches any of the characters in the class.
 *     [~bc]    Character class: matches any of the characters NOT in it.
 *     a-z      Character range (only within character classes).
 *     %        Matches 0 characters always (useful in "(foo|bar|%)").
 *     *        Synonym for "#?", not available by default in 2.0. Available
 *              as an option that can be turned on.
 *
 * and defines "expression" as "either a single character (ex: "#?"), or an
 * alternation (ex: "#(ab|cd|ef)"), or a character class (ex: "#[a-zA-Z]")".
 *
 * `~` is why this cannot be compiled to a RegExp: negation of an arbitrary
 * sub-pattern has no regex equivalent. Matching is therefore a backtracking
 * walk in continuation-passing style, where `~expr` succeeds at any span the
 * inner expression fails to match exactly.
 */

type Node =
  | { k: 'char'; c: string }
  | { k: 'any' } // ?
  | { k: 'empty' } // %
  | { k: 'class'; neg: boolean; ranges: Array<[number, number]> }
  | { k: 'alt'; branches: Node[][] }
  | { k: 'star'; of: Node } // #expr
  | { k: 'not'; of: Node } // ~expr

class PatternError extends Error {}

/**
 * `*` is off by default under AmigaDOS 2.0, matching the manual. AMOS itself
 * accepts it in its own globbing, so callers that want the lenient reading
 * pass star=true.
 */
export function parseAmigaPattern(pattern: string, star = false): Node[] {
  let i = 0

  const parseSeq = (): Node[] => {
    const seq: Node[] = []
    while (i < pattern.length && pattern[i] !== '|' && pattern[i] !== ')') seq.push(parseItem())
    return seq
  }

  const parseItem = (): Node => {
    const c = pattern[i]!
    if (c === '#') {
      i++
      return { k: 'star', of: parseItem() }
    }
    if (c === '~') {
      i++
      return { k: 'not', of: parseItem() }
    }
    if (c === '*' && star) {
      i++
      return { k: 'star', of: { k: 'any' } }
    }
    if (c === '?') {
      i++
      return { k: 'any' }
    }
    if (c === '%') {
      i++
      return { k: 'empty' }
    }
    if (c === '(') {
      i++
      const branches: Node[][] = [parseSeq()]
      while (pattern[i] === '|') {
        i++
        branches.push(parseSeq())
      }
      if (pattern[i] !== ')') throw new PatternError('unclosed (')
      i++
      return { k: 'alt', branches }
    }
    if (c === '[') {
      i++
      const neg = pattern[i] === '~'
      if (neg) i++
      const ranges: Array<[number, number]> = []
      let first = true
      while (i < pattern.length && (pattern[i] !== ']' || first)) {
        first = false
        const lo = pattern[i++]!
        if (pattern[i] === '-' && i + 1 < pattern.length && pattern[i + 1] !== ']') {
          i++
          ranges.push([lo.charCodeAt(0), pattern[i++]!.charCodeAt(0)])
        } else {
          ranges.push([lo.charCodeAt(0), lo.charCodeAt(0)])
        }
      }
      if (pattern[i] !== ']') throw new PatternError('unclosed [')
      i++
      return { k: 'class', neg, ranges }
    }
    if (c === "'") {
      // AmigaDOS quotes the next character to take it literally
      i++
      const lit = pattern[i] ?? "'"
      i++
      return { k: 'char', c: lit }
    }
    i++
    return { k: 'char', c }
  }

  const seq = parseSeq()
  if (i < pattern.length) throw new PatternError(`unexpected '${pattern[i]}'`)
  return seq
}

/** does the pattern contain anything that makes it a pattern rather than text? */
export function hasWildcard(pattern: string, star = false): boolean {
  try {
    // anything that is not a literal character is one of the wildcard forms
    // the manual lists — including a bare alternation like "(ab|cd)", which
    // is a pattern even when every branch is plain text
    return parseAmigaPattern(pattern, star).some((n) => n.k !== 'char')
  } catch {
    return false // an unparseable pattern is not a valid wildcard
  }
}

/** match `seq` against s[from..], calling `k` with each possible end position */
function matchSeq(seq: Node[], s: string, from: number, k: (at: number) => boolean): boolean {
  if (seq.length === 0) return k(from)
  const [head, ...rest] = seq as [Node, ...Node[]]
  return matchNode(head, s, from, (at) => matchSeq(rest, s, at, k))
}

function matchNode(n: Node, s: string, at: number, k: (at: number) => boolean): boolean {
  switch (n.k) {
    case 'char':
      return at < s.length && s[at] === n.c ? k(at + 1) : false
    case 'any':
      return at < s.length ? k(at + 1) : false
    case 'empty':
      return k(at)
    case 'class': {
      if (at >= s.length) return false
      const code = s.charCodeAt(at)
      const inside = n.ranges.some(([lo, hi]) => code >= lo && code <= hi)
      return inside !== n.neg ? k(at + 1) : false
    }
    case 'alt':
      return n.branches.some((b) => matchSeq(b, s, at, k))
    case 'star': {
      // greedy with backtracking; a zero-width body must not loop forever
      const tryFrom = (pos: number, seen: Set<number>): boolean => {
        if (k(pos)) return true
        if (seen.has(pos)) return false
        seen.add(pos)
        return matchNode(n.of, s, pos, (next) => (next === pos ? false : tryFrom(next, seen)))
      }
      return tryFrom(at, new Set())
    }
    case 'not': {
      // "matches all strings that do not match the expression": try every
      // span from here, and take the ones the inner expression rejects
      for (let end = at; end <= s.length; end++) {
        const span = s.slice(at, end)
        const inner = matchSeq([n.of], span, 0, (p) => p === span.length)
        if (!inner && k(end)) return true
      }
      return false
    }
  }
}

/**
 * Whole-string match, which is what dos.library's MatchPattern does — the
 * pattern must account for the entire source, not merely occur inside it.
 * Case-sensitive, as the manual states ("use Upper$ or Lower$ if required").
 */
export function amigaMatch(source: string, pattern: string, star = false): boolean {
  let seq: Node[]
  try {
    seq = parseAmigaPattern(pattern, star)
  } catch {
    return false
  }
  return matchSeq(seq, source, 0, (at) => at === source.length)
}
