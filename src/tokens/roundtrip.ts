/**
 * A program out through the editor and back, and what a difference means.
 *
 * `Detok` and `Tokenise` are each other's inverse only up to the fields the
 * VERIFIER owns. A saved program is not what the tokeniser wrote: AMOS
 * verifies before it runs and writes back into the token stream, filling in
 * the variable record's runtime link, the inline branch slots, the extension
 * argument count and the promotion of a name to a procedure call. So a bare
 * byte comparison fails on most lines of every program, and says nothing.
 *
 * `normalise` clears exactly those fields and nothing else, so what is left
 * has to match on the nose. `explained` then decides STRUCTURALLY whether a
 * line that still differs is one the text cannot carry, rather than by file
 * name, so a real regression cannot hide in the total.
 *
 * Both sweeps use this: roundtrip.test.ts over `fixtures/`, and
 * roundtrip.corpus.test.ts over the 3,972 distinct programs in the index.
 */
import { T, TokenTable, decipheredSource, parseSource } from './stream'
import type { TokenLine } from './stream'
import { CORE_TOKENS } from './tables.gen'
import { extensionTablesFor } from '../ext/identify'
import { parseAmosFile } from '../loader/amosfile'
import { TK, detokLineBytes, inlineBytes, tokeniseLine } from './edtok'
import { ascToFfp, floatToAsc } from './numfmt'
import { decodeFfp } from '../amiga/ffp'

const table = new TokenTable(CORE_TOKENS)

/**
 * The nameless variants, mapped back to the entry whose name they borrow.
 *
 * A variant has no name of its own, so nothing the user types can reach it:
 * the tokeniser matches the named entry and the verifier swaps in the variant
 * once it has counted the arguments. `Screen` is the clearest case, holding
 * the instruction at $0C6E and the function at $0C7C.
 */
export function variantParents(t: TokenTable, isExtension: boolean): Map<number, number> {
  const map = new Map<number, number>()
  const first = isExtension ? 0 : T.EXTENSION
  let last = -1
  for (const e of t.entries) {
    if (!isVariant(e)) {
      if (e.name.trim() !== '') last = e.id
      continue
    }
    if (e.id > first && last >= 0) map.set(e.id, last)
  }
  return map
}

/**
 * The same test `TokenTable`'s constructor makes, and it has to be the same.
 *
 * A variant's name bytes are never compared, so the filler is arbitrary:
 * almost every one is a bare $80, and `Read Text`'s three-parameter form at
 * $293A is a lone $0C. Reading that as the name "\f" rather than as a variant
 * left `Zone3_0.AMOS` retokenising its `Read Text` to the two-parameter $292A.
 */
function isVariant(e: { name: string; spec: string }): boolean {
  return e.name.trim() === '' && !e.spec.startsWith('C')
}
const coreParents = variantParents(table, false)

/** the same map for an extension table, built once per table rather than per token */
const extParents = new WeakMap<TokenTable, Map<number, number>>()
function parentsOf(t: TokenTable): Map<number, number> {
  let m = extParents.get(t)
  if (m === undefined) {
    m = variantParents(t, true)
    extParents.set(t, m)
  }
  return m
}

/** the two-digit-per-byte spelling the report uses */
export const hex = (b: Uint8Array): string =>
  [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ')

/** Clear every field the verifier owns, leaving what `Tokenise` itself wrote. */
export function normalise(src: Uint8Array, at: number, ext: Map<number, TokenTable>): Uint8Array {
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
      const parent = t === undefined ? undefined : parentsOf(t).get(eid)
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
  return b
}

/** every keyword name that appears on more than one entry of a table */
export function ambiguousNames(t: TokenTable): Set<string> {
  const seen = new Map<string, number>()
  const dup = new Set<string>()
  for (const e of t.entries) {
    if (isVariant(e)) continue
    const n = e.name.replace(/^!/, '')
    if (seen.has(n)) dup.add(n)
    seen.set(n, e.id)
  }
  return dup
}
const coreAmbiguous = ambiguousNames(table)

const extAmbiguous = new WeakMap<TokenTable, Set<string>>()
function ambiguousOf(t: TokenTable): Set<string> {
  let s = extAmbiguous.get(t)
  if (s === undefined) {
    s = ambiguousNames(t)
    extAmbiguous.set(t, s)
  }
  return s
}

/**
 * Every keyword name the loaded tables hold, and the ones two tables share.
 *
 * `Tokenise` stops the moment a stored name runs out (`TkKt`, +Edit.s:14521)
 * and never looks at the character after it, so a keyword that is a PREFIX of
 * an identifier splits the identifier. `EQUALS` in an AMOS 1.34 program comes
 * back as `Equ` and `ALS`, because Professional added `Equ` afterwards.
 *
 * The shared set is separate because a name on two DIFFERENT tables is
 * ambiguous in the same way a name on two entries of one table is: `sload` is
 * $17A6 of the extension in slot 8 and $0210 of the one in slot 1, and only
 * the load order decides.
 */
export interface Keywords {
  names: Set<string>
  shared: Set<string>
}
/**
 * A number per table, so a set of tables can be a cache key.
 *
 * The slot numbers cannot be: APD031 puts its own XCommands in slot 1 where
 * another program has the music extension, and both programs then ask for the
 * same "1,2,3" and get each other's keywords.
 */
const tableIds = new WeakMap<TokenTable, number>()
let nextTableId = 0
function tableId(t: TokenTable): number {
  let id = tableIds.get(t)
  if (id === undefined) {
    id = nextTableId++
    tableIds.set(t, id)
  }
  return id
}

const keywordCache = new Map<string, Keywords>()
export function keywordNames(ext: Map<number, TokenTable>): Keywords {
  const key = [...ext.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, t]) => `${slot}.${tableId(t)}`)
    .join(',')
  const hit = keywordCache.get(key)
  if (hit !== undefined) return hit
  const names = new Set<string>()
  const shared = new Set<string>()
  for (const t of [table, ...ext.values()]) {
    const here = new Set<string>()
    for (const e of t.entries) {
      if (isVariant(e)) continue
      const n = e.name.replace(/^!/, '')
      here.add(n)
      // a space inside a stored name matches an optional space in the input,
      // so "track load" reaches into TRACKLOADED and "lib call" into LIBCALL1
      if (n.includes(' ')) here.add(n.replaceAll(' ', ''))
    }
    for (const n of here) {
      if (names.has(n)) shared.add(n)
      names.add(n)
    }
  }
  const built = { names, shared }
  keywordCache.set(key, built)
  return built
}

/**
 * A keyword no input can reach, because its stored name carries a capital.
 *
 * `MinD0` (+Edit.s:14711) folds the typed character to lower case before the
 * comparison at `Tkl0`, and the stored byte goes in as it stands, so an entry
 * spelled with an "L" can never be matched. ldos does exactly that with `Lrun`
 * at $0308, which is why `Lrun.AMOS` holds a call nobody can retype. No core
 * entry has one.
 */
function untypeable(name: string): boolean {
  return /[A-Z]/.test(name)
}

/** whether any keyword is this name, or bites off the front of it */
function keywordBites(name: string, keywords: Keywords): boolean {
  let lower = ''
  for (const c of name) lower += c >= 'A' && c <= 'Z' ? String.fromCharCode(c.charCodeAt(0) + 32) : c
  for (let n = lower.length; n > 0; n--) {
    if (keywords.names.has(lower.slice(0, n))) return true
  }
  return false
}

/**
 * Whether a float constant survives being listed and read back.
 *
 * It often does not, and that is AMOS's, not this port's: see the `DEFECT:` on
 * `ascToFfp`. A line holding one of these can never settle, because every pass
 * takes another step off the mantissa.
 */
export function driftingFloat(bits: number): boolean {
  return ascToFfp(floatToAsc(decodeFfp(bits))) !== bits
}

/**
 * A constant carrying a sign, which `Tokenise` cannot write.
 *
 * +Edit.s:14384 hands `ValRout` a zero in d0 under the comment "Ne pas tenir
 * compte du signe", and AMOS 1.3 gets there another way: `ValTok` clears d4
 * and branches to `val1c`, jumping over the block at `val1` that reads a sign.
 * Both leave a leading minus to the operator table.
 *
 * The corpus agrees to four decimal places past certainty: of 1,191,223
 * integer constants in 3,873 programs, exactly one is negative, and it is in
 * `GuiConv.Amos`, a converter's own accessory. The one negative float is in
 * Kyzer's synthetic `Numbers.AMOS`, whose `Data -1.0` was never typed into an
 * editor either.
 */
export function signedFloat(bits: number): boolean {
  return (bits & 0x80) !== 0 && (bits & 0xffffff00) !== 0
}

/** the same for an integer, where the sign is just the sign */
export function signedInt(value: number): boolean {
  return value < 0
}

/**
 * A name record carrying bytes after its terminator, inside its own length.
 *
 * `TkV8` (+Edit.s:14374) pokes `a4 - a0 - 6`, the length of what it has just
 * written, so the tokeniser can leave at most the one NUL that pads the name
 * to even. 33 records in the corpus carry more than that, and one of them is
 * `DR$` in `NoteBook.AMOS` stored as "dr\0\0\0\0ry" in eight bytes, the tail
 * of a longer name that was there before. Retyping the line writes the short
 * record, which is the right answer and a different one.
 */
function staleName(b: Uint8Array, at: number, len: number): boolean {
  let zero = -1
  for (let i = 0; i < len; i++) {
    if (b[at + i] === 0) {
      zero = i
      break
    }
  }
  if (zero < 0) return false
  for (let i = zero + 1; i < len; i++) if (b[at + i] !== 0) return true
  return false
}

/**
 * Whether a line the round trip changed is one the TEXT cannot decide.
 *
 * Eight ways that happens, and every one is a property of AMOS rather than of
 * this port:
 *
 *   - the name is on two entries. `set dir` is $17B6 and $17C4, one taking a
 *     path and one taking a path and a flag, and `tag str` is the same shape
 *     in easylife. Only the argument count separates them, and the tokeniser
 *     does not count arguments.
 *   - the name is on two TABLES. `sload` is $17A6 of one extension and $0210
 *     of another, and whichever slot is searched first wins.
 *   - a keyword is the whole of an identifier, or the front of one. `ERR$` is
 *     a variable in `_Get_DOS_Error` and a string function in Professional;
 *     `EVENTLOOP` is a label in an AMOS 1.3 program and `Even` plus `TLOOP`
 *     once the extension holding `Even` is in slot 8. `TkKt` accepts a match
 *     as soon as the stored name runs out and never looks at what follows.
 *   - the line uses an extension nothing here can load, or a slot filled by a
 *     different library from the one that wrote the line. Either lists as
 *     "Extension S" and comes back as two variables.
 *   - the program predates a keyword. `Quatro` holds `Else` `If` as two
 *     tokens; `Else If` has been one since Professional, and 349 programs
 *     here use it.
 *   - the keyword's own name cannot be typed. See `untypeable`.
 *   - the line holds a constant carrying a sign, which the tokeniser cannot
 *     write, or a float the listing cannot reproduce. See `signedFloat` and
 *     `driftingFloat`.
 *   - a name record carries the tail of a longer name it used to hold. See
 *     `staleName`.
 */
export function explained(
  b: Uint8Array,
  at: number,
  ext: Map<number, TokenTable>,
  keywords: Keywords,
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
      if (keywordBites(name + suffix, keywords)) return true
      if (staleName(b, p + 4, len)) return true
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
      if (id === T.FLOAT) {
        const bits = ((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0
        if (signedFloat(bits) || driftingFloat(bits)) return true
      }
      if (id === T.INT && signedInt((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!)) {
        return true
      }
      p += 4
      previous = id
      continue
    }
    if (id === T.EXTENSION) {
      const t = ext.get(b[p]!)
      if (t === undefined) return true
      const eid = (b[p + 2]! << 8) | b[p + 3]!
      const n = t.name(eid)
      // the slot is filled but not with this library: APD031 puts its own
      // XCommands in slot 1, and $002E is not a routine the table found there
      // has a name for, so the listing can only say "Extension B"
      if (n === undefined || untypeable(n)) return true
      if (ambiguousOf(t).has(n) || keywords.shared.has(n)) return true
      p += 4
      previous = id
      continue
    }
    if (previous === TK.ELSE && id === TK.IF) return true
    const n = table.name(id)
    if (n !== undefined && (untypeable(n) || coreAmbiguous.has(n) || keywords.shared.has(n))) return true
    p += inlineBytes(id)
    previous = id
  }
  return false
}

/** the byte ranges the editor never shows and never retokenises */
export function opaqueRanges(src: Uint8Array, lines: TokenLine[]): Array<[number, number]> {
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

/** two byte strings, compared without building either as a string */
function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Whether the line lists through a placeholder rather than through a keyword.
 *
 * `DtkEe` (+Edit.s:14808) patches the slot letter into the last byte of
 * `ExtNot`, "Extension " with a $80 after it, and hands the result on with
 * d3 = "I" so it prints as an instruction with a trailing space. That text is
 * a report, not the program: retyping it gives two variables, and listing
 * THOSE gives "EXTENSION ZVarptr(" because a function's spec opens with "0"
 * and takes no leading space. AMOS does the same, which is why you do not
 * edit a program without the extensions it was written with.
 */
function listsAPlaceholder(b: Uint8Array, at: number, ext: Map<number, TokenTable>): boolean {
  let p = at + 2
  const end = at + b[at]! * 2
  while (p + 2 <= end) {
    const id = (b[p]! << 8) | b[p + 1]!
    if (id === 0) return false
    p += 2
    if (id <= T.LABEL_REF) {
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
    if (id === T.EXTENSION) {
      const t = ext.get(b[p]!)
      if (t === undefined || t.name((b[p + 2]! << 8) | b[p + 3]!) === undefined) return true
      p += 4
      continue
    }
    p += id < T.EXTENSION ? 4 : inlineBytes(id)
  }
  return false
}

/** whether any float constant on a tokenised line is one the listing cannot reproduce */
function lineDrifts(b: Uint8Array): boolean {
  let p = 2
  const end = b[0]! * 2
  while (p + 2 <= end) {
    const id = (b[p]! << 8) | b[p + 1]!
    if (id === 0) return false
    p += 2
    if (id <= T.LABEL_REF) {
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
    if (id === T.FLOAT) {
      const bits = ((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0
      if (driftingFloat(bits)) return true
    }
    p += id < T.EXTENSION ? 4 : id === T.EXTENSION ? 4 : inlineBytes(id)
  }
  return false
}

export interface Result {
  programs: number
  unreadable: number
  lines: number
  opaque: number
  textDiffer: number
  unstable: number
  drifting: number
  byteDiffer: number
  unexplainedCount: number
  unexplained: string[]
}

export const emptyResult = (): Result => ({
  programs: 0,
  unreadable: 0,
  lines: 0,
  opaque: 0,
  textDiffer: 0,
  unstable: 0,
  drifting: 0,
  byteDiffer: 0,
  unexplainedCount: 0,
  unexplained: [],
})

/**
 * One program, accumulated into `r`.
 *
 * A file this suite cannot parse is corpus.test.ts's business rather than
 * this one's, so it is counted and skipped. That count is the guard against a
 * sweep that quietly stopped reading anything.
 */
export function sweepProgram(bytes: Uint8Array, path: string, r: Result): void {
  let src: Uint8Array
  let lines: TokenLine[]
  try {
    const file = parseAmosFile(bytes)
    if (file.source.length === 0) return
    lines = parseSource(file.source, table)
    src = decipheredSource(file.source, table)
  } catch {
    r.unreadable++
    return
  }
  r.programs++
  const extensions = extensionTablesFor(lines)
  const opts = { extensions }
  const keywords = keywordNames(extensions)
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
    // the same text tokenises to the same bytes, so only a line whose listing
    // MOVED can be unstable, and that is 2% of them
    if (again !== text) {
      r.textDiffer++
      if (!same(tokeniseLine(again, table, opts), back)) {
        // a line whose constant walks down on every listing can never settle,
        // and neither can one whose listing is a placeholder for a library
        // that is not here
        if ((back[0] !== 0 && lineDrifts(back)) || listsAPlaceholder(src, p, extensions)) {
          r.drifting++
        } else {
          r.unstable++
        }
      }
    }
    const want = normalise(src, p, extensions)
    const got = back[0] === 0 ? new Uint8Array(0) : normalise(back, 0, extensions)
    if (!same(want, got)) {
      r.byteDiffer++
      if (!explained(src, p, extensions, keywords)) {
        r.unexplainedCount++
        if (r.unexplained.length < 20) {
          r.unexplained.push(`${path}@${p}: |${text}|\n    want ${hex(want)}\n    got  ${hex(got)}`)
        }
      }
    }
    p += words * 2
  }
}

/** print the counts when AMOS_RT_REPORT is set, so a sweep can be measured without editing it */
export function report(name: string, r: Result): void {
  if (process.env.AMOS_RT_REPORT === undefined) return
  console.log(JSON.stringify({ sweep: name, ...r, unexplained: r.unexplained.length }))
}
