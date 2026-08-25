/**
 * The editor's own detokeniser and tokeniser, working on bytes.
 *
 * `Detok` (+Edit.s:14743) and `Tokenise` (+Edit.s:14226) are the two halves of
 * one loop the AMOS editor runs constantly: a line is turned into text to be
 * shown, and turned back into tokens the moment the cursor leaves it. So the
 * invariant that matters is not that either half is readable on its own. It is
 * that **retokenising a line nobody changed does not alter a byte**, because
 * every line the user merely walks past goes through both.
 *
 * These take and produce the LINE, header included: byte 0 is the length in
 * words, byte 1 is the indent. Everything downstream (`parseSource`, `prescan`,
 * the interpreter) is untouched, because the interpreter recomputes control
 * flow and never reads an inline link.
 *
 * `detok.ts` used to do the same job from the parsed `Tok` union, spacing the
 * result with a regular expression. It put a space after every colon that
 * belonged before it, one in front of an opening bracket that never takes one,
 * and one after a remark's quote that the remark's own text already held.
 * `detokLine` here takes a `TokenLine` too, by encoding it back to bytes
 * first, so there is one detokeniser rather than two that disagree.
 */
import { decodeFfp, encodeFfp } from '../amiga/ffp'
import { OPERATORS, T, TokenTable } from './stream'
import type { TokenLine } from './stream'
import type { TokenEntry } from './libtok'
import { ascToFfp, floatToAsc, longToBin, longToDec, longToHex } from './numfmt'

/**
 * The token ids the editor branches on, from `+Equ.s:1997-2121`.
 *
 * These are byte offsets into the core token table, so naming them is naming
 * positions in one particular library. They hold: `rem` at $064A is what
 * ../tokens/libtok.ts anchors its rebase on, and every one of these lands on
 * the keyword +Equ.s says it should.
 */
export const TK = {
  FOR: 0x023c,
  NEXT: 0x0246,
  REPEAT: 0x0250,
  UNTIL: 0x025c,
  WHILE: 0x0268,
  WEND: 0x0274,
  DO: 0x027e,
  LOOP: 0x0286,
  EXIT_IF: 0x0290,
  EXIT: 0x029e,
  IF: 0x02be,
  THEN: 0x02c6,
  ELSE: 0x02d0,
  END_IF: 0x02da,
  ON: 0x0316,
  PROCEDURE: 0x0376,
  DATA: 0x0404,
  PRINT_HASH: 0x046a,
  PRINT: 0x0476,
  REM: 0x064a,
  REM_TICK: 0x0652,
  ELSE_IF: 0x25a4,
  END_PROC: 0x0390,
  /** the six-byte range is `Equ`, `Lvo`, `Struc` and `Struc$`, inclusive */
  EQU: 0x2a40,
  STRUC_S: 0x2a64,
  /** the double-precision constant, which has no name and never needs one */
  DOUBLE_FLOAT: 0x2b6a,
  OPEN_PAREN: 0x0074,
  /** `_TkBra1` (+Equ.s:2014), the `[` a parameter list opens with */
  BRA1: 0x0084,
  /** `_TkML` (+Equ.s:2111), which is `@_apml_@` */
  ML: 0x258c,
} as const

/** 0 lowercase, 1 UPPERCASE, 2 Capitalised: the two config bytes `DtkMaj1` and `DtkMaj2` */
export type CaseMode = 0 | 1 | 2

export interface EdtokOptions {
  /** `DtkMaj1`, for keywords. The shipped configuration is 2. */
  keywordCase?: CaseMode
  /** `DtkMaj2`, for variables and labels. The shipped configuration is 1. */
  identCase?: CaseMode
  /** token tables for extensions, keyed by the slot number the line stores */
  extensions?: Map<number, TokenTable>
}

/**
 * How many bytes follow a token id, from `TInst` (+Edit.s:15102).
 *
 * This is the authority, and it is keyed on the ID RANGE rather than on names:
 * $2A40 to $2A64 is `Equ`, `Lvo`, `Struc` and `Struc$`, all six. The links are
 * where the interpreter's own jump targets were cached, and they are why the
 * round trip has to carry bytes it never shows: `For` at the top of a loop
 * holds the offset of its `Next`.
 */
export function inlineBytes(id: number): number {
  switch (id) {
    case TK.FOR:
    case TK.REPEAT:
    case TK.WHILE:
    case TK.DO:
    case TK.IF:
    case TK.ELSE:
    case TK.ELSE_IF:
    case TK.DATA:
      return 2
    case TK.EXIT:
    case TK.EXIT_IF:
    case TK.ON:
    case T.EXTENSION:
      return 4
    case TK.PROCEDURE:
      return 8
    default:
      return id >= TK.EQU && id <= TK.STRUC_S ? 6 : 0
  }
}

/** `TInst`: the offset of the token after the one at `p`, whose id is `id`. */
export function skipToken(src: Uint8Array, p: number, id: number): number {
  if (id === 0) return p
  if (id <= T.LABEL_REF) return p + 4 + src[p + 2]!
  if (id === T.STR_DQ || id === T.STR_SQ || id === TK.REM || id === TK.REM_TICK) {
    const n = p + 2 + ((src[p]! << 8) | src[p + 1]!)
    return n % 2 === 0 ? n : n + 1
  }
  if (id === TK.DOUBLE_FLOAT) return p + 8
  if (id <= T.FLOAT) return p + 4
  return p + inlineBytes(id)
}

/* ---- detokenise ---------------------------------------------------------- */

/**
 * `Dtk5`, `Dtk6` and `Dtk8`: the three ways `DtkMaj1` writes a keyword.
 *
 * Mode 2 is two loops, not a rule about spaces. `Dtk8` uppercases the one
 * character it is entered on; `Dtk9a` then copies verbatim until it WRITES a
 * space, and only then hands back. So the first character is uppercased and so
 * is whatever follows a space `Dtk9a` wrote, which is every space except a
 * LEADING one, because `Dtk9a` never wrote that.
 *
 * The word operators are stored with spaces on both sides, so they come out
 * lowercase: `A and B` lists as `and`, never `And`, at the shipped setting.
 */
function keywordCase(name: string, mode: CaseMode): string {
  if (mode === 0) return name
  if (mode === 1) return upperAll(name)
  let out = ''
  let i = 0
  while (i < name.length) {
    out += upper(name.charAt(i))
    i++
    while (i < name.length) {
      const c = name.charAt(i)
      out += c
      i++
      if (c === ' ') break
    }
  }
  return out
}

/** `DtkV2`, `DtkV3` and `DtkV5`: the three ways `DtkMaj2` writes an identifier. */
function identCase(name: string, mode: CaseMode): string {
  if (mode === 0) return name
  if (mode === 1) return upperAll(name)
  // DEFECT: mode 2 reads its first character through `move.b (a6)+,d0` at
  // $284A0, and a6 is the TOKEN pointer, not the name pointer that the rest of
  // the loop uses. So it prints the high byte of the record's runtime link
  // where the first letter should be, and then leaves a6 one byte on, which
  // desynchronises the whole line. The shipped configuration is 1, so nothing
  // reaches it. Not reproduced: this returns what the loop meant to write.
  return upper(name.charAt(0)) + name.slice(1)
}

/** the message `DtkEe` patches an extension letter into, at $2854E */
function missingExtension(slot: number): string {
  return 'Extension ' + String.fromCharCode(0x41 + (slot & 0xff))
}

/**
 * One line of tokens as the text the editor shows.
 *
 * `offset` is the line's own start, so byte 0 is its length in words. The
 * result carries the indent as leading spaces, one fewer than the indent byte,
 * exactly as `Dtk1` writes them.
 */
/**
 * `Detok`'s d0 in and the word it pushes at `clr.w -(sp)` out.
 *
 * `DtkLoop` opens `cmp.l a3,a6` (+Edit.s:14768) and takes the write pointer's
 * distance from the start of the text the moment the walk reaches the token at
 * `at`. That is BEFORE the token's own leading space, and the indent counts,
 * because a2 is set before `Dtk1` writes it.
 *
 * `column` stays -1 when the walk never reaches the offset.
 */
export interface DetokWatch {
  at: number
  column: number
}

export function detokLineBytes(
  src: Uint8Array,
  offset: number,
  table: TokenTable,
  opts: EdtokOptions = {},
  watch?: DetokWatch,
): string {
  const kwCase = opts.keywordCase ?? 2
  const idCase = opts.identCase ?? 1
  if (src[offset] === 0) return ''
  let out = ' '.repeat(Math.max(0, src[offset + 1]! - 1))
  const start = out.length
  let p = offset + 2
  const end = offset + src[offset]! * 2
  /** d5 bit 0: the last thing written was an identifier or a constant */
  let adjacent = false

  const u16 = (at: number): number => (src[at]! << 8) | src[at + 1]!
  const u32 = (at: number): number => ((u16(at) << 16) | u16(at + 2)) >>> 0
  /** `cmp.b #" ",-1(a4)`: the run-together test every arm opens with */
  const spaced = (): boolean => out.length === start || out.endsWith(' ')

  while (p + 2 <= end) {
    // `DtkLoop`: the watch is tested before anything is written for the token
    if (watch !== undefined && p === watch.at) watch.column = out.length
    const id = u16(p)
    p += 2
    if (id === 0) break

    // variables, labels, procedure calls and label references
    if (id <= T.LABEL_REF) {
      if (adjacent && !spaced()) out += ' '
      const len = src[p + 2]!
      const flags = src[p + 3]!
      let name = ''
      for (let i = 0; i < len; i++) {
        const c = src[p + 4 + i]!
        if (c === 0) break
        name += String.fromCharCode(c)
      }
      out += identCase(name, idCase)
      p += 4 + len
      adjacent = true
      if (id === T.LABEL) {
        // a label whose name opens with a digit is a line number, and takes
        // neither a colon nor a type suffix
        if (!(name.charCodeAt(0) >= 0x30 && name.charCodeAt(0) <= 0x39)) out += ':'
      } else if ((flags & 3) === 1) out += '#'
      else if ((flags & 3) === 2) out += '$'
      continue
    }

    // constants
    if (id < T.EXTENSION || id === TK.DOUBLE_FLOAT) {
      if (adjacent && !spaced()) out += ' '
      adjacent = false
      if (id === T.INT) {
        out += longToDec(u32(p) | 0)
        p += 4
      } else if (id === T.HEX) {
        out += longToHex(u32(p))
        p += 4
      } else if (id === T.BIN) {
        out += longToBin(u32(p))
        p += 4
      } else if (id === T.FLOAT || id === TK.DOUBLE_FLOAT) {
        // DEVIATION: a double-precision constant is written by DoubleToAsc
        // with 15 digits; this prints its top long through FloatToAsc, which
        // is the right text only when the low long is zero. No corpus program
        // holds one, because it needs Set Double Precision at tokenise time.
        const text = floatToAsc(decodeFfp(u32(p)))
        // DtkC8: put a ".0" on anything that came back without a point or an
        // exponent, which is what makes "128" list as "128.0" and stay a float
        out += /[.E]/.test(text) ? text : text + '.0'
        p += id === T.FLOAT ? 4 : 8
      } else {
        const quote = id === T.STR_DQ ? '"' : "'"
        const len = u16(p)
        p += 2
        let s = ''
        for (let i = 0; i < len; i++) s += String.fromCharCode(src[p + i]!)
        p += len
        if (p % 2 !== 0) p++
        out += quote + s + quote
      }
      continue
    }

    // keywords, operators and extension tokens
    adjacent = false
    let name: string | undefined
    let spec: string
    if (id >= 0x8000) {
      name = OPERATORS.get(id)
      spec = 'O'
    } else if (id === T.EXTENSION) {
      const slot = src[p]!
      const extId = u16(p + 2)
      const ext = opts.extensions?.get(slot)
      name = ext?.name(extId)
      if (name === undefined) {
        name = missingExtension(slot)
        spec = 'I'
      } else {
        spec = ext?.get(extId)?.spec ?? ''
      }
    } else {
      const entry: TokenEntry | undefined = table.get(id)
      name = table.name(id)
      spec = entry?.spec ?? ''
    }
    if (name === undefined) name = `{$${id.toString(16).padStart(4, '0')}}`

    if (id === TK.OPEN_PAREN) {
      // DtkP: an opening bracket eats a space rather than making one
      if (out.length > start && out.endsWith(' ')) out = out.slice(0, -1)
      out += '('
      p = skipToken(src, p, id)
      continue
    }

    // Dtk3a: a space in front unless the spec says this is an operator, a
    // reserved variable or a function. '9' is not in the range the compare
    // covers, so a spec of "9..." takes the space.
    const k = spec.charAt(0)
    const noSpace = k === 'O' || k === 'V' || (k >= '0' && k <= '8')
    if (!noSpace && !spaced()) out += ' '
    out += keywordCase(name, kwCase)

    if (id === TK.REM || id === TK.REM_TICK) {
      // DtkRem: the length word is skipped and the text is copied to its NUL,
      // which is the line terminator. An odd-length remark was padded with a
      // space at $2842E, and that space is inside the count, so it comes back.
      p += 2
      while (p < src.length && src[p] !== 0) out += String.fromCharCode(src[p++]!)
      continue
    }
    // DtkE: a trailing space after an instruction, and only an instruction
    if (k === 'I') out += ' '
    p = skipToken(src, p, id)
  }
  return out
}

/** Every line of a source block, walked by the length byte the way the editor does. */
export function detokBytes(src: Uint8Array, table: TokenTable, opts: EdtokOptions = {}): string[] {
  const out: string[] = []
  let p = 0
  while (p + 2 <= src.length) {
    const words = src[p]!
    if (words === 0) break
    out.push(detokLineBytes(src, p, table, opts))
    p += words * 2
  }
  return out
}

/* ---- tokenise ------------------------------------------------------------ */

/** `MinD0` at $2846E, and `Minus`: a-z only, nothing above 127 */
function lower(c: string): string {
  return c >= 'A' && c <= 'Z' ? String.fromCharCode(c.charCodeAt(0) + 32) : c
}

/**
 * `DtkV3` ($15012) and `MajD0ed`: `cmp.b #"a"` and `cmp.b #"z"`, nothing else.
 *
 * The accented half of Latin-1 is left alone in both directions, which is what
 * lets a name carrying one survive a listing. `TkV2` takes any byte above 128
 * into an identifier and `MinD0` does not fold it, so `HÖHE=90` in
 * `_ChartLine.AMOS` is stored as "h\xf6he" and has to list as "H\xf6HE".
 * JavaScript's toUpperCase would make that "H\xd6HE" and change the program.
 */
function upper(c: string): string {
  return c >= 'a' && c <= 'z' ? String.fromCharCode(c.charCodeAt(0) - 32) : c
}

/** the same over a whole name, which is all `DtkV3` and `Dtk6` do */
function upperAll(name: string): string {
  let out = ''
  for (const c of name) out += upper(c)
  return out
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9'
}

/**
 * One keyword name against the input, giving the characters consumed or -1.
 *
 * The stored name carries three conventions. A leading `!` or space is not
 * part of the word: it marks the entry as the one variants point back to, and
 * the per-letter index is built on the letter after it. A space inside the
 * name matches an optional space in the input, which is why `Screen Open` and
 * `screenopen` are the same keyword. And the LAST character, if it is a space,
 * matches nothing at all, so `to ` needs no space after it.
 */
export function matchKeyword(name: string, text: string, at: number): number {
  let k = 0
  while (k < name.length && (name.charAt(k) === '!' || name.charAt(k) === ' ')) k++
  if (k >= name.length) return -1
  if (at >= text.length || lower(text.charAt(at)) !== name.charAt(k)) return -1
  let i = at + 1
  let p = k + 1
  const at_ = (j: number): string => (j < text.length ? lower(text.charAt(j)) : '\0')
  while (p < name.length) {
    const d = name.charAt(p)
    if (p === name.length - 1) {
      // TkKt: a trailing space matches nothing, anything else must be there
      if (d === ' ') return i - at
      return d === at_(i) ? i + 1 - at : -1
    }
    p++
    if (d === ' ') {
      // a space in the pattern is optional in the input
      if (at_(i) === ' ') i++
      continue
    }
    if (d !== at_(i)) return -1
    i++
  }
  return i - at
}

/** where a keyword search landed: which table, which id, and how much it ate */
interface Match {
  id: number
  /** the extension slot, or 0 for the core table and -1 for an operator */
  slot: number
  chars: number
  weight: number
}

function searchTable(
  entries: readonly TokenEntry[],
  slot: number,
  text: string,
  at: number,
  first: boolean,
  best: Match | null,
): Match | null {
  let found = best
  for (const e of entries) {
    if (e.name === '') continue
    const chars = matchKeyword(e.name, text, at)
    if (chars < 0) continue
    const weight = e.name.length
    if (first) return { id: e.id, slot, chars, weight }
    if (found === null || weight > found.weight) found = { id: e.id, slot, chars, weight }
  }
  return found
}

/**
 * `Tokenise`'s keyword search, in the order the machine runs it.
 *
 * The operator table goes first and takes the FIRST match, which is why typing
 * `and` reaches the operator rather than any keyword spelled that way. Then
 * the core table and the extensions: a word starting a-z is searched through
 * the per-letter index at $2842C and the LONGEST match across every table
 * wins, so `Screen Open` beats `Screen`. Anything else takes the first match
 * in table order.
 */
function findKeyword(
  text: string,
  at: number,
  table: TokenTable,
  extensions: Map<number, TokenTable> | undefined,
): Match | null {
  const c = lower(text.charAt(at))
  if (c === '!') return null
  for (const [id, name] of OPERATORS) {
    const chars = matchKeyword(name, text, at)
    if (chars >= 0) return { id, slot: -1, chars, weight: name.length }
  }
  const fast = c >= 'a' && c <= 'z'
  let best = searchTable(table.entries, 0, text, at, !fast, null)
  if (best !== null && !fast) return best
  for (const [slot, ext] of extensions ?? []) {
    best = searchTable(ext.entries, slot, text, at, !fast, best)
    if (best !== null && !fast) return best
  }
  return best
}

/** what `ValRout` (+ILib.s:7018) hands back: a constant token and its payload */
interface NumberToken {
  id: number
  value: number
  /** the low long of a double, which only `_TkDFl` carries */
  low: number
  end: number
}

/**
 * `ValRout`, called from `Tokenise`'s number branch (`TokLoop` +Edit.s:14391)
 * with d0 zero, so that a leading sign is left for the operator.
 *
 * Whether a decimal number is an integer or a float is decided by the way it
 * is WRITTEN and never by its value: `val4` branches on d3, which `val3z` sets
 * for a point and `val3c` for an exponent that has a sign or a digit after it.
 * So `2.0` is a float and `2` is not, and `2E1` is a float worth 20.
 */
export function valRout(text: string, at: number): NumberToken | null {
  let i = at
  while (text.charAt(i) === ' ') i++
  const c = text.charAt(i)
  if (c === '$') return radix(text, i + 1, 16)
  if (c === '%') return radix(text, i + 1, 2)
  if (c !== '.' && !isDigit(c)) return null

  // val3: find the end, and decide int or float on the way
  let j = i
  let point = false
  let float = false
  for (;;) {
    const d = text.charAt(j)
    if (d === ' ') {
      j++
      continue
    }
    if (isDigit(d)) {
      j++
      continue
    }
    if (d === '.') {
      if (point) break
      point = true
      j++
      continue
    }
    if (d === 'e' || d === 'E') {
      j++
      while (text.charAt(j) === ' ') j++
      if (text.charAt(j) === '+' || text.charAt(j) === '-') {
        float = true
        j++
        while (text.charAt(j) === ' ') j++
      }
      while (isDigit(text.charAt(j))) {
        float = true
        j++
      }
      break
    }
    break
  }
  if (!point && !float) return declong(text, i)
  // Ca1: copied into BuFloat with the spaces taken out, 33 bytes at most
  const digits = text.slice(i, j).replace(/ /g, '').slice(0, 33)
  return { id: T.FLOAT, value: ascToFfp(digits), low: 0, end: j }
}

/** `declong` ($271AE): decimal, space-tolerant, and zero on overflow */
function declong(text: string, at: number): NumberToken | null {
  let i = at
  let v = 0
  let digits = 0
  for (;;) {
    const c = text.charAt(i)
    if (c === ' ') {
      i++
      continue
    }
    if (!isDigit(c)) break
    v = v * 10 + (c.charCodeAt(0) - 0x30)
    // ddh2: anything that leaves the top bit set is out of range, and val10
    // answers zero rather than wrapping
    if (v > 0x7fffffff) return { id: T.INT, value: 0, low: 0, end: i + 1 }
    digits++
    i++
  }
  if (digits === 0) return null
  return { id: T.INT, value: v, low: 0, end: i }
}

/** `hexalong` and `binlong`: eight hex digits at most, and no spaces skipped */
function radix(text: string, at: number, base: 16 | 2): NumberToken | null {
  const max = base === 16 ? 9 : 33
  let i = at
  let v = 0
  let digits = 0
  for (;;) {
    const c = lower(text.charAt(i))
    const d = c === '' ? -1 : base === 16 ? '0123456789abcdef'.indexOf(c) : '01'.indexOf(c)
    if (d < 0) break
    v = base === 16 ? ((v << 4) | d) >>> 0 : ((v << 1) | d) >>> 0
    digits++
    i++
    if (digits === max) return { id: base === 16 ? T.HEX : T.BIN, value: 0, low: 0, end: i }
  }
  if (digits === 0) return null
  return { id: base === 16 ? T.HEX : T.BIN, value: v, low: 0, end: i }
}

/** a growable line buffer that knows its own parity, which is what the pads test */
class LineOut {
  bytes: number[] = [0, 0]
  u8(v: number): void {
    this.bytes.push(v & 0xff)
  }
  u16(v: number): void {
    this.bytes.push((v >>> 8) & 0xff, v & 0xff)
  }
  u32(v: number): void {
    this.u16((v >>> 16) & 0xffff)
    this.u16(v & 0xffff)
  }
  zero(n: number): void {
    for (let i = 0; i < n; i++) this.bytes.push(0)
  }
  get length(): number {
    return this.bytes.length
  }
}

/**
 * One line of text back into tokens, header included.
 *
 * DEVIATION: three fields come out zero that a saved program holds filled in,
 * because the tokeniser genuinely writes zeros there and the VERIFIER fills
 * them afterwards. They are the variable record's runtime link word, the
 * inline branch links, and the ids $12 and $18 that mark a name as a procedure
 * call or a line-number reference rather than a variable. Measured over the
 * 566 corpus programs: 86,500 of 111,109 variable records carry a non-zero
 * link, 24,984 of 27,471 inline slots are filled, and there are 5,896
 * procedure calls the tokeniser cannot produce on its own. So the fixed point
 * the editor keeps is the TEXT, not the bytes, and a byte comparison has to
 * clear what the verifier wrote.
 *
 * Returns an empty line of four bytes for a line with nothing on it, which is
 * what `TokVide` leaves: a length of 2 words, a zero indent and a terminator.
 */
export function tokeniseLine(text: string, table: TokenTable, opts: EdtokOptions = {}): Uint8Array {
  const out = new LineOut()
  const ext = opts.extensions

  // TokT: leading spaces, counted from one and capped at 127
  let i = 0
  while (text.charAt(i) === ' ') i++
  if (i >= text.length) return Uint8Array.from([2, 0, 0, 0])
  out.bytes[1] = Math.min(i + 1, 127)

  /** the record being built: where its id word sits */
  let mark = -1
  /** d5 bit 1, a variable is open */
  let inVar = false
  /** d5 bit 4, that variable is the line number */
  let lineNumber = false
  /** d5 bit 3, past the start of the line */
  let started = false
  /** d5 bit 5, the rest of the line is a remark */
  let inRem = false
  /** d5 bit 0, a string is open, and the quote that closes it */
  let quote = ''

  const openVar = (id: number, first: string): void => {
    mark = out.length
    out.u16(id)
    out.zero(4)
    out.u8(first.charCodeAt(0))
    inVar = true
  }

  /** TkV7: pad to even, then poke the length and the type flag */
  const closeVar = (flag: number): void => {
    if (out.length % 2 !== 0) out.u8(0)
    out.bytes[mark + 4] = out.length - mark - 6
    out.bytes[mark + 5] = flag
    inVar = false
  }

  if (isDigit(text.charAt(i))) {
    lineNumber = true
    openVar(T.VARIABLE, text.charAt(i))
    i++
  } else if (text.charAt(i) === "'") {
    i++
    out.u16(TK.REM_TICK)
    mark = out.length
    out.u16(0)
    inRem = true
  }

  while (i < text.length) {
    const c = text.charAt(i)
    i++
    if (inRem) {
      out.u8(c.charCodeAt(0))
      continue
    }

    if (inVar) {
      const d = lower(c)
      if (lineNumber) {
        if (isDigit(d)) {
          out.u8(d.charCodeAt(0))
          continue
        }
        // TkV0: the line number ends, and its record becomes a label whether
        // or not a colon closed it
        started = true
        lineNumber = false
        if (d !== ':') i--
        out.bytes[mark] = T.LABEL >>> 8
        out.bytes[mark + 1] = T.LABEL & 0xff
        closeVar(0)
        continue
      }
      if (d === '_' || isDigit(d) || (d >= 'a' && d <= 'z') || d.charCodeAt(0) >= 128) {
        out.u8(d.charCodeAt(0))
        continue
      }
      // TkV4: a colon closes a LABEL, but only at the start of the line
      if (!started && d === ':') {
        started = true
        out.bytes[mark] = T.LABEL >>> 8
        out.bytes[mark + 1] = T.LABEL & 0xff
        closeVar(0)
        continue
      }
      started = true
      i--
      let flag = 0
      if (d === '$') {
        flag = 2
        i++
      } else if (d === '#') {
        flag = 1
        i++
      }
      closeVar(flag)
      continue
    }

    if (quote !== '') {
      if (c === quote) {
        // TkC1: the length is taken BEFORE the pad, so it counts text only
        const len = out.length - mark - 4
        if (out.length % 2 !== 0) out.u8(0)
        out.bytes[mark + 2] = (len >>> 8) & 0xff
        out.bytes[mark + 3] = len & 0xff
        quote = ''
        continue
      }
      out.u8(c.charCodeAt(0))
      continue
    }

    if (c === '"' || c === "'") {
      quote = c
      mark = out.length
      out.u16(c === '"' ? T.STR_DQ : T.STR_SQ)
      out.u16(0)
      continue
    }
    if (c === ' ') continue

    // TkOtre: a number, before any keyword is tried
    const num = valRout(text, i - 1)
    if (num !== null) {
      out.u16(num.id)
      out.u32(num.value)
      if (num.id === TK.DOUBLE_FLOAT) out.u32(num.low)
      i = num.end
      continue
    }

    // Tkl1a: "?" is Print, and "? #" is Print #
    if (c === '?') {
      let j = i
      while (text.charAt(j) === ' ') j++
      if (text.charAt(j) === '#') {
        out.u16(TK.PRINT_HASH)
        i = j + 1
      } else {
        out.u16(TK.PRINT)
      }
      lineNumber = false
      started = true
      continue
    }

    const hit = findKeyword(text, i - 1, table, ext)
    if (hit !== null) {
      i = i - 1 + hit.chars
      lineNumber = false
      started = true
      if (hit.slot > 0) {
        out.u16(T.EXTENSION)
        out.u8(hit.slot)
        out.u8(0)
        out.u16(hit.id)
        continue
      }
      out.u16(hit.id)
      if (hit.id === TK.REM) {
        mark = out.length
        out.u16(0)
        inRem = true
        continue
      }
      out.zero(inlineBytes(hit.id))
      if (hit.id === TK.THEN || hit.id === TK.ELSE) {
        // TkKtc: a line number right after Then or Else is a reference, not a
        // constant, so it opens a record rather than going through ValRout
        let j = i
        while (text.charAt(j) === ' ') j++
        if (isDigit(text.charAt(j))) {
          openVar(T.LABEL_REF, text.charAt(j))
          i = j + 1
        }
      }
      continue
    }

    // TkKf1: nothing matched, so this opens a variable — or is dropped, which
    // is what happens to any character that cannot start a name
    const d = lower(c)
    if (d === '_' || d.charCodeAt(0) >= 128 || (d >= 'a' && d <= 'z')) openVar(T.VARIABLE, d)
  }

  // TokFin: close whatever was still open
  if (inVar) {
    if (lineNumber) {
      out.bytes[mark] = T.LABEL >>> 8
      out.bytes[mark + 1] = T.LABEL & 0xff
    }
    closeVar(0)
  } else if (quote !== '') {
    const len = out.length - mark - 4
    if (out.length % 2 !== 0) out.u8(0)
    out.bytes[mark + 2] = (len >>> 8) & 0xff
    out.bytes[mark + 3] = len & 0xff
  } else if (inRem) {
    // FRem: a remark is padded with a SPACE, not a zero, and the pad is inside
    // the count
    if (out.length % 2 !== 0) out.u8(0x20)
    const len = out.length - mark - 2
    out.bytes[mark] = (len >>> 8) & 0xff
    out.bytes[mark + 1] = len & 0xff
  }
  out.u16(0)
  if (out.length >= 510) return Uint8Array.from([0, 0])
  out.bytes[0] = out.length >>> 1
  return Uint8Array.from(out.bytes)
}

/**
 * A whole listing into a source block, the way the editor holds one.
 *
 * Every line goes through `tokeniseLine`, so a program typed as text and a
 * program loaded from disc are the same bytes by the time anything reads them.
 * A line too long for the format is dropped rather than truncated, which is
 * what the editor's own -1 return leaves on screen.
 */
export function tokeniseSource(text: string, table: TokenTable, opts: EdtokOptions = {}): Uint8Array {
  const out: number[] = []
  for (const line of text.split('\n')) {
    const bytes = tokeniseLine(line.replace(/\r$/, ''), table, opts)
    if (bytes[0] === 0) continue
    for (const b of bytes) out.push(b)
  }
  out.push(0, 0)
  return Uint8Array.from(out)
}

/**
 * A parsed line back into the bytes it was read from, so that anything holding
 * a `TokenLine` can be shown through the one detokeniser.
 *
 * Lossy in exactly the places `parseSource` is, and they are the same places
 * the verifier owns: the record's runtime link, the inline branch payloads and
 * the extension argument count come back as zeros. None of them is printed, so
 * the listing is the same either way.
 *
 * This is what lets `tokenize`'s output, which never came from a file, be
 * listed by `Detok` rather than by a second detokeniser with its own idea of
 * where the spaces go.
 */
export function encodeLine(line: TokenLine, table: TokenTable): Uint8Array {
  const out = new LineOut()
  out.bytes[1] = line.indent
  const name = (id: number, text: string, flags: number): void => {
    out.u16(id)
    out.u16(0)
    const chars = [...text].map((c) => c.charCodeAt(0))
    if (chars.length % 2 !== 0) chars.push(0)
    out.u8(chars.length)
    out.u8(flags)
    for (const c of chars) out.u8(c)
  }
  for (const tok of line.tokens) {
    switch (tok.kind) {
      case 'var':
        name(T.VARIABLE, tok.name, tok.flags)
        break
      case 'label':
        name(T.LABEL, tok.name, tok.flags)
        break
      case 'procCall':
        name(T.PROC_CALL, tok.name, tok.flags)
        break
      case 'labelRef':
        name(T.LABEL_REF, tok.name, tok.flags)
        break
      case 'op':
        out.u16(tok.id)
        break
      case 'int':
        out.u16(T.INT)
        out.u32(tok.value)
        break
      case 'bin':
        out.u16(T.BIN)
        out.u32(tok.value)
        break
      case 'hex':
        out.u16(T.HEX)
        out.u32(tok.value)
        break
      case 'float':
        out.u16(T.FLOAT)
        out.u32(tok.raw !== 0 ? tok.raw : (encodeFfp(tok.value) ?? 0))
        break
      case 'str': {
        out.u16(tok.quote === '"' ? T.STR_DQ : T.STR_SQ)
        out.u16(tok.value.length)
        for (const c of tok.value) out.u8(c.charCodeAt(0))
        if (out.length % 2 !== 0) out.u8(0)
        break
      }
      case 'rem': {
        out.u16(tok.id)
        out.u16(tok.text.length)
        for (const c of tok.text) out.u8(c.charCodeAt(0))
        if (out.length % 2 !== 0) out.u8(0x20)
        break
      }
      case 'proc':
        out.u16(tok.id)
        out.u32(tok.size)
        out.u16(0)
        out.u16(tok.flags)
        break
      case 'apml':
        // the machine code itself follows the LINE, so only the marker and
        // its pointer back to the parameter list belong here
        out.u16(table.entries.find((e) => e.name.replace(/^!/, '') === '@_apml_@')?.id ?? 0)
        out.u16(tok.param)
        break
      case 'ext':
        out.u16(T.EXTENSION)
        out.u8(tok.ext)
        out.u8(0)
        out.u16(tok.id)
        break
      case 'core':
        out.u16(tok.id)
        out.zero(inlineBytes(tok.id))
        break
    }
  }
  out.u16(0)
  out.bytes[0] = out.length >>> 1
  return Uint8Array.from(out.bytes)
}

/** One `TokenLine` as the text the editor shows, through `Detok`. */
export function detokLine(line: TokenLine, table: TokenTable, opts: EdtokOptions = {}): string {
  return detokLineBytes(encodeLine(line, table), 0, table, opts)
}

/** A whole program's lines as a listing. */
export function detokSource(lines: TokenLine[], table: TokenTable, opts: EdtokOptions = {}): string {
  return lines.map((l) => detokLine(l, table, opts)).join('\n')
}
