/**
 * Every line of every program in `fixtures/`, out through the editor and back.
 *
 * This is the test the byte-level pair exists for. `Detok` and `Tokenise` are
 * run against each other over 124,000 real lines, and what comes back has to
 * be the bytes that went in.
 *
 * It cannot be a bare comparison, because a SAVED program is not what the
 * tokeniser wrote. AMOS verifies before it runs and the verifier writes back
 * into the token stream: 86,500 of the 111,109 variable records here carry a
 * runtime link, 24,984 of the 27,471 inline branch slots are filled in, and
 * 5,896 names have been promoted from variable to procedure call. The
 * tokeniser writes zeros in all of those. So `normalise` clears exactly what
 * the verifier owns, and everything else has to match on the nose.
 *
 * What is left over after that is 65 lines in 124,468, and each one is a case
 * where the TEXT does not carry enough to choose. `explained` decides that
 * structurally rather than by file name, so a real regression cannot hide in
 * the total. Set AMOS_RT_REPORT to print the counts.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { T, TokenTable, decipheredSource, parseSource } from './stream'
import type { TokenLine } from './stream'
import { CORE_TOKENS } from './tables.gen'
import { extensionTablesFor } from '../ext/identify'
import { parseAmosFile } from '../loader/amosfile'
import { TK, detokLineBytes, inlineBytes, tokeniseLine } from './edtok'

const fixtures = join(process.cwd(), 'fixtures')
const table = new TokenTable(CORE_TOKENS)

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walk(p)
    else if (/\.amos$/i.test(name)) yield p
  }
}

/**
 * The nameless variants, mapped back to the entry whose name they borrow.
 *
 * A variant has no name of its own, so nothing the user types can reach it:
 * the tokeniser matches the named entry and the verifier swaps in the variant
 * once it has counted the arguments. `Screen` is the clearest case, holding
 * the instruction at $0C6E and the function at $0C7C.
 */
function variantParents(t: TokenTable, isExtension: boolean): Map<number, number> {
  const map = new Map<number, number>()
  const first = isExtension ? 0 : T.EXTENSION
  let last = -1
  for (const e of t.entries) {
    if (e.name !== '') {
      last = e.id
      continue
    }
    if (e.id > first && last >= 0) map.set(e.id, last)
  }
  return map
}
const coreParents = variantParents(table, false)

/** Clear every field the verifier owns, leaving what `Tokenise` itself wrote. */
function normalise(src: Uint8Array, at: number, ext: Map<number, TokenTable>): string {
  const b = Uint8Array.from(src.subarray(at, at + src[at]! * 2))
  // an empty line's indent byte is not the tokeniser's: TokVide never reaches
  // TokT1, so it writes 0, and the editor's own blank line carries 1
  if (b.length === 4) b[1] = 0
  const put = (p: number, v: number): void => {
    b[p] = v >>> 8
    b[p + 1] = v & 0xff
  }
  let p = 2
  while (p + 2 <= b.length) {
    let id = (b[p]! << 8) | b[p + 1]!
    if (id === 0) break
    p += 2
    if (id <= T.LABEL_REF) {
      // the runtime link, the array and procedure flag bits, and the promotion
      // of a name to a procedure call or a line-number reference
      put(p - 2, T.VARIABLE)
      b[p] = 0
      b[p + 1] = 0
      b[p + 3]! &= 3
      p += 4 + b[p + 2]!
      continue
    }
    if (id === T.STR_DQ || id === T.STR_SQ || id === TK.REM || id === TK.REM_TICK) {
      p += 2 + ((b[p]! << 8) | b[p + 1]!)
      if (p % 2 !== 0) p++
      continue
    }
    if (id === TK.DOUBLE_FLOAT) {
      p += 8
      continue
    }
    if (id < T.EXTENSION) {
      p += 4
      continue
    }
    if (id === T.EXTENSION) {
      const t = ext.get(b[p]!)
      const eid = (b[p + 2]! << 8) | b[p + 3]!
      const parent = t === undefined ? undefined : variantParents(t, true).get(eid)
      if (parent !== undefined) put(p + 2, parent)
      // "Nb Par", the argument count the verifier fills in at $28408
      b[p + 1] = 0
      p += 4
      continue
    }
    const parent = coreParents.get(id)
    if (parent !== undefined) {
      put(p - 2, parent)
      id = parent
    }
    const n = inlineBytes(id)
    for (let k = 0; k < n; k++) b[p + k] = 0
    p += n
  }
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ')
}

/** every keyword name that appears on more than one entry of a table */
function ambiguousNames(t: TokenTable): Set<string> {
  const seen = new Map<string, number>()
  const dup = new Set<string>()
  for (const e of t.entries) {
    if (e.name === '') continue
    const n = e.name.replace(/^!/, '')
    if (seen.has(n)) dup.add(n)
    seen.set(n, e.id)
  }
  return dup
}
const coreAmbiguous = ambiguousNames(table)

/** every keyword name a loaded table holds, for the case where a variable collides */
function keywordNames(ext: Map<number, TokenTable>): Set<string> {
  const all = new Set<string>()
  for (const t of [table, ...ext.values()]) {
    for (const e of t.entries) if (e.name !== '') all.add(e.name.replace(/^!/, ''))
  }
  return all
}

/**
 * Whether a line the round trip changed is one the TEXT cannot decide.
 *
 * Four ways that happens, and all four are properties of AMOS rather than of
 * this port:
 *
 *   - the name is on two entries. `set dir` is $17B6 and $17C4, one taking a
 *     path and one taking a path and a flag, and `tag str` is the same shape
 *     in easylife. Only the argument count separates them, and the tokeniser
 *     does not count arguments.
 *   - a variable is spelled like a keyword. `_Get_DOS_Error` uses `ERR$` as a
 *     variable and AMOS Professional has `Err$` as a string function, so the
 *     program cannot be re-edited in the editor that reads it.
 *   - the line uses an extension nothing here can load, which lists as
 *     "Extension S" and comes back as two variables.
 *   - the program predates a keyword. `Quatro` holds `Else` `If` as two
 *     tokens; `Else If` has been one since Professional, and 349 programs
 *     here use it.
 */
function explained(
  b: Uint8Array,
  at: number,
  ext: Map<number, TokenTable>,
  names: Set<string>,
): boolean {
  let p = at + 2
  const end = at + b[at]! * 2
  let previous = 0
  while (p + 2 <= end) {
    const id = (b[p]! << 8) | b[p + 1]!
    if (id === 0) break
    p += 2
    if (id <= T.LABEL_REF) {
      const len = b[p + 2]!
      let name = ''
      for (let i = 0; i < len; i++) {
        const c = b[p + 4 + i]!
        if (c === 0) break
        name += String.fromCharCode(c)
      }
      const suffix = (b[p + 3]! & 3) === 1 ? '#' : (b[p + 3]! & 3) === 2 ? '$' : ''
      if (names.has(name + suffix)) return true
      p += 4 + len
      previous = id
      continue
    }
    if (id === T.STR_DQ || id === T.STR_SQ || id === TK.REM || id === TK.REM_TICK) {
      p += 2 + ((b[p]! << 8) | b[p + 1]!)
      if (p % 2 !== 0) p++
      previous = id
      continue
    }
    if (id === TK.DOUBLE_FLOAT) {
      p += 8
      previous = id
      continue
    }
    if (id < T.EXTENSION) {
      p += 4
      previous = id
      continue
    }
    if (id === T.EXTENSION) {
      const t = ext.get(b[p]!)
      if (t === undefined) return true
      const eid = (b[p + 2]! << 8) | b[p + 3]!
      const n = t.name(eid)
      if (n !== undefined && ambiguousNames(t).has(n)) return true
      p += 4
      previous = id
      continue
    }
    if (previous === TK.ELSE && id === TK.IF) return true
    const n = table.name(id)
    if (n !== undefined && coreAmbiguous.has(n)) return true
    p += inlineBytes(id)
    previous = id
  }
  return false
}

/** the byte ranges the editor never shows and never retokenises */
function opaqueRanges(src: Uint8Array, lines: TokenLine[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const line of lines) {
    for (const tok of line.tokens) {
      if (tok.kind === 'apml') out.push([line.offset, line.offset + src[line.offset]! * 2 + tok.mc.length])
      if (tok.kind === 'proc' && tok.protectedBody) {
        out.push([line.offset, line.offset + tok.protectedBody.length])
      }
    }
  }
  return out
}

interface Result {
  programs: number
  lines: number
  opaque: number
  textDiffer: number
  unstable: number
  byteDiffer: number
  unexplained: string[]
}

function sweep(): Result {
  const r: Result = {
    programs: 0,
    lines: 0,
    opaque: 0,
    textDiffer: 0,
    unstable: 0,
    byteDiffer: 0,
    unexplained: [],
  }
  if (!existsSync(fixtures)) return r
  for (const path of walk(fixtures)) {
    let src: Uint8Array
    let lines: TokenLine[]
    try {
      const file = parseAmosFile(new Uint8Array(readFileSync(path)))
      if (file.source.length === 0) continue
      lines = parseSource(file.source, table)
      src = decipheredSource(file.source, table)
    } catch {
      // a program this suite cannot parse is corpus.test.ts's business
      continue
    }
    r.programs++
    const extensions = extensionTablesFor(lines)
    const opts = { extensions }
    const names = keywordNames(extensions)
    const opaque = opaqueRanges(src, lines)
    let p = 0
    while (p + 2 <= src.length) {
      const words = src[p]!
      if (words === 0) break
      if (opaque.some(([a, b]) => p >= a && p < b)) {
        r.opaque++
        p += words * 2
        continue
      }
      r.lines++
      const text = detokLineBytes(src, p, table, opts)
      const back = tokeniseLine(text, table, opts)
      const again = detokLineBytes(back, 0, table, opts)
      if (again !== text) r.textDiffer++
      if (String(tokeniseLine(again, table, opts)) !== String(back)) r.unstable++
      const want = normalise(src, p, extensions)
      const got = back[0] === 0 ? '' : normalise(back, 0, extensions)
      if (want !== got) {
        r.byteDiffer++
        if (!explained(src, p, extensions, names)) {
          if (r.unexplained.length < 20) r.unexplained.push(`${path}@${p}: |${text}|`)
        }
      }
      p += words * 2
    }
  }
  return r
}

const result = sweep()
if (process.env.AMOS_RT_REPORT !== undefined) {
  console.log(JSON.stringify({ ...result, unexplained: result.unexplained.length }))
}

describe.skipIf(result.programs === 0)('every line of the corpus, out and back', () => {
  it('read enough programs that an empty sweep cannot pass for a clean one', () => {
    expect(result.programs).toBeGreaterThan(400)
    expect(result.lines).toBeGreaterThan(100_000)
  })

  it('leaves nothing unexplained', () => {
    expect(result.unexplained).toEqual([])
  })

  it('changes fewer than one line in a thousand, verifier fields aside', () => {
    expect(result.byteDiffer / result.lines).toBeLessThan(0.001)
  })

  it('settles after one pass, which is what the editor needs', () => {
    // a line the user merely walks past goes through both halves, so a round
    // trip that kept changing the line would rewrite a program by being read
    expect(result.unstable).toBe(0)
  })

  it('shows the same text again for all but the lines it cannot', () => {
    // the 1.7% are the empty lines the editor inserted with an indent
    // Tokenise cannot produce, plus the byte cases above
    expect(result.textDiffer / result.lines).toBeLessThan(0.02)
  })
})
