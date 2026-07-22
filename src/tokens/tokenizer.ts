import { OPERATORS, T, TokenTable } from './stream'
import type { Tok, TokenLine } from './stream'

/**
 * Text → token stream, the reverse of the detokenizer.
 *
 * This exists mainly so tests can be written in AMOS source instead of
 * hand-built token arrays, and so a future web editor can accept typed
 * code. It expects editor-normalized source (single spaces in keywords,
 * as produced by detokSource); it is not a full reimplementation of the
 * editor's tokenizer. Inline branch links are not computed — the
 * interpreter derives control flow from its own prescan.
 */

const WORD = /[A-Za-z_][A-Za-z0-9_]*[$#]?/y
const NUMBER = /(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?/y
const PUNCT_NAMES = new Set([',', ';', '#', '(', ')', '[', ']', ':'])

interface Keyword {
  id: number
  /** extension slot when the keyword comes from an extension table */
  ext?: number
}

interface Tables {
  keywords: Map<string, Keyword>
  keywordList: string[] // sorted longest first, for greedy matching
  punct: Map<string, number>
  remId: number
  tickRemId: number
  procId: number
}

const tablesCache = new WeakMap<TokenTable, Tables>()

function buildTables(table: TokenTable, extensions?: Map<number, TokenTable>): Tables {
  const cached = extensions === undefined ? tablesCache.get(table) : undefined
  if (cached) return cached
  const keywords = new Map<string, Keyword>()
  const punct = new Map<string, number>()
  let remId = -1
  let tickRemId = -1
  let procId = -1
  for (const e of table.entries) {
    if (e.id <= T.EXTENSION || e.name === '') continue
    const name = e.name.replace(/^!/, '').trim().toLowerCase()
    if (name === "'") {
      if (tickRemId < 0) tickRemId = e.id
      continue
    }
    if (PUNCT_NAMES.has(name)) {
      if (!punct.has(name)) punct.set(name, e.id)
      continue
    }
    if (name === 'rem' && remId < 0) remId = e.id
    if (name === 'procedure' && procId < 0) procId = e.id
    if (!keywords.has(name)) keywords.set(name, { id: e.id })
  }
  for (const [slot, ext] of extensions ?? []) {
    for (const e of ext.entries) {
      if (e.name === '') continue
      const name = e.name.replace(/^!/, '').trim().toLowerCase()
      if (name !== '' && !keywords.has(name)) keywords.set(name, { id: e.id, ext: slot })
    }
  }
  const keywordList = [...keywords.keys()].sort((a, b) => b.length - a.length)
  const tables: Tables = { keywords, keywordList, punct, remId, tickRemId, procId }
  if (extensions === undefined) tablesCache.set(table, tables)
  return tables
}

/** trimmed name → [token id, name as stored (with padding spaces)] */
const OP_BY_NAME = new Map<string, [number, string]>()
for (const [id, name] of OPERATORS) OP_BY_NAME.set(name.trim(), [id, name])
// longest first so <= beats <, etc.
const OP_SYMBOLS = [...OP_BY_NAME.keys()].filter((n) => !/[a-z]/.test(n)).sort((a, b) => b.length - a.length)
const OP_WORDS = new Set(['and', 'or', 'xor', 'mod'])

export class TokenizeError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(`line ${line}, col ${column}: ${message}`)
  }
}

export function tokenize(source: string, table: TokenTable, extensions?: Map<number, TokenTable>): TokenLine[] {
  const tables = buildTables(table, extensions)
  // procedure names must be known up front: calls can precede definitions
  const procNames = new Set<string>()
  for (const m of source.matchAll(/^\s*procedure\s+([a-z_][a-z0-9_]*[$#]?)/gim)) {
    procNames.add(m[1]!.toLowerCase())
  }

  const lines: TokenLine[] = []
  let offset = 0
  const srcLines = source.split('\n')
  for (let ln = 0; ln < srcLines.length; ln++) {
    const tokens = tokenizeLine(srcLines[ln]!, ln + 1, tables, procNames)
    const indentMatch = /^ */.exec(srcLines[ln]!)!
    lines.push({ offset, indent: indentMatch[0].length + 1, tokens })
    offset += 2 // synthetic, roughly "a line header per line"
  }
  // drop trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1]!.tokens.length === 0) lines.pop()
  return lines
}

function varFlags(name: string): number {
  if (name.endsWith('#')) return 1
  if (name.endsWith('$')) return 2
  return 0
}

function ident(name: string, kind: 'var' | 'label' | 'procCall' | 'labelRef'): Tok {
  return { kind, name: name.toLowerCase(), flags: varFlags(name) }
}

function tokenizeLine(text: string, ln: number, tables: Tables, procNames: Set<string>): Tok[] {
  const toks: Tok[] = []
  let pos = 0
  let stmtStart = true
  let labelCtx = false // after Goto/Gosub/Restore: bare identifiers are label refs

  const fail = (msg: string): never => {
    throw new TokenizeError(msg, ln, pos + 1)
  }

  while (pos < text.length) {
    const c = text[pos]!
    if (c === ' ' || c === '\t') {
      pos++
      continue
    }

    // label definition: identifier or line number followed by ':' at line start
    if (toks.length === 0) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*[$#]?):(?![=<>])/.exec(text.slice(pos))
      if (m && !isKeywordAt(text, pos, tables).length) {
        toks.push(ident(m[1]!, 'label'))
        pos += m[0].length
        continue
      }
      const num = /^(\d+)\s/.exec(text.slice(pos))
      if (num) {
        toks.push({ kind: 'label', name: num[1]!, flags: 0 })
        pos += num[1]!.length
        continue
      }
    }

    // comment: Rem handled via keyword below; ' only at statement start
    if (c === "'" && stmtStart) {
      let t = text.slice(pos + 1)
      if (t.startsWith(' ')) t = t.slice(1)
      toks.push({ kind: 'rem', id: tables.tickRemId, text: t })
      return toks
    }

    if (c === '"' || c === "'") {
      const end = text.indexOf(c, pos + 1)
      if (end < 0) fail('unterminated string')
      toks.push({ kind: 'str', value: text.slice(pos + 1, end), quote: c as '"' | "'" })
      pos = end + 1
      stmtStart = false
      continue
    }

    if (c === '$') {
      const m = /^\$([0-9A-Fa-f]+)/.exec(text.slice(pos))
      if (!m) fail('bad hex literal')
      toks.push({ kind: 'hex', value: parseInt(m![1]!, 16) | 0 })
      pos += m![0].length
      stmtStart = false
      continue
    }
    if (c === '%') {
      const m = /^%([01]+)/.exec(text.slice(pos))
      if (!m) fail('bad binary literal')
      toks.push({ kind: 'bin', value: parseInt(m![1]!, 2) | 0 })
      pos += m![0].length
      stmtStart = false
      continue
    }

    NUMBER.lastIndex = pos
    const numMatch = NUMBER.exec(text)
    if (numMatch) {
      const s = numMatch[0]
      if (s.includes('.') || numMatch[2]) {
        toks.push({ kind: 'float', value: parseFloat(s), raw: 0 })
      } else {
        toks.push({ kind: 'int', value: parseInt(s, 10) | 0 })
      }
      pos += s.length
      stmtStart = false
      continue
    }

    WORD.lastIndex = pos
    const word = WORD.exec(text)
    if (word) {
      const w = word[0].toLowerCase()
      if (OP_WORDS.has(w)) {
        const [id, name] = OP_BY_NAME.get(w)!
        toks.push({ kind: 'op', id, op: name })
        pos += w.length
        stmtStart = false
        continue
      }
      const kw = isKeywordAt(text, pos, tables)
      if (kw.length > 0) {
        const entry = tables.keywords.get(kw)!
        const id = entry.id
        pos += kw.length
        if (entry.ext !== undefined) {
          toks.push({ kind: 'ext', ext: entry.ext, id })
          stmtStart = false
          continue
        }
        if (kw === 'rem') {
          let t = text.slice(pos)
          if (t.startsWith(' ')) t = t.slice(1)
          toks.push({ kind: 'rem', id: tables.remId, text: t })
          return toks
        }
        if (kw === 'procedure') {
          toks.push({ kind: 'proc', id, size: 0, flags: 0, endTarget: -1 })
          stmtStart = false
          continue
        }
        toks.push({ kind: 'core', id })
        labelCtx = kw === 'goto' || kw === 'gosub' || kw === 'restore'
        stmtStart = false
        continue
      }
      // plain identifier
      if (procNames.has(w)) toks.push(ident(word[0], 'procCall'))
      else if (labelCtx) toks.push(ident(word[0], 'labelRef'))
      else toks.push(ident(word[0], 'var'))
      pos += word[0].length
      stmtStart = false
      continue
    }

    const opSym = OP_SYMBOLS.find((s) => text.startsWith(s, pos))
    if (opSym) {
      const [id, name] = OP_BY_NAME.get(opSym)!
      toks.push({ kind: 'op', id, op: name })
      pos += opSym.length
      stmtStart = false
      continue
    }

    if (tables.punct.has(c)) {
      toks.push({ kind: 'core', id: tables.punct.get(c)! })
      pos++
      if (c === ':') {
        stmtStart = true
        labelCtx = false
      } else if (c !== ',') {
        labelCtx = false
      }
      continue
    }

    fail(`unexpected character ${JSON.stringify(c)}`)
  }
  return toks
}

/** Longest keyword (possibly multi-word, e.g. "end if") starting at pos, or ''. */
function isKeywordAt(text: string, pos: number, tables: Tables): string {
  const rest = text.slice(pos).toLowerCase()
  for (const kw of tables.keywordList) {
    if (!rest.startsWith(kw)) continue
    const after = rest[kw.length]
    if (after !== undefined && /[a-z0-9_$#]/.test(after)) continue
    return kw
  }
  return ''
}
