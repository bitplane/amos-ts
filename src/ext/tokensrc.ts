/**
 * Assemble an AMOS extension token table from its assembler source.
 *
 * Some extensions ship their source rather than (or as well as) a linked
 * `.Lib`. The token table is a plain run of `dc.w`/`dc.b` directives, so we
 * can assemble it back to the exact bytes the linker would have produced and
 * feed them to the same `parseTokenTable` used for binaries — which means a
 * source-derived table is byte-exact ground truth, not a transcription.
 *
 * The layout per entry (see `parseTokenTable` in ../tokens/libtok.ts):
 *   dc.w <instruction routine>,<function routine>   ; -1 = "not one of these"
 *   dc.b "nam",$80+'e',"<spec>",-1                  ; -2/-3 = variant follows
 *
 * Routine operands are symbols (`L_IscreenClose`) whose values live in the
 * link map, which we do not have and do not need: nothing dispatches on the
 * routine number. Symbols assemble to SYMBOLIC so that the instruction-vs-
 * function distinction (the `-1`s) survives, which identification does use.
 *
 * Word directives are auto-aligned, matching DevPac/PhxAss behaviour — the
 * sources carry no `even` between entries and the real tables are padded to
 * even length.
 */
import { parseTokenTable, type TokenEntry } from '../tokens/libtok'

/** Placeholder for a routine operand given as a link-time symbol. */
export const SYMBOLIC = 0x0001

export interface AssembleOptions {
  /** Symbols treated as defined by `ifd` (e.g. CREATOR for the AMOS 1.3 build). */
  defines?: Iterable<string>
}

/** Split an operand list on commas that are outside quotes. */
function splitOperands(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (quote) {
      cur += c
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      cur += c
      continue
    }
    if (c === ',') {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim() !== '') out.push(cur.trim())
  return out
}

/** Strip a `;` comment that is not inside a quoted string. */
function stripComment(line: string): string {
  let quote = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quote) {
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === ';' || c === '*') return line.slice(0, i)
  }
  return line
}

/** Evaluate one term of an operand: a number, a char literal or a symbol. */
function term(t: string): number {
  t = t.trim()
  if (t === '') return 0
  if (t.startsWith('$')) return parseInt(t.slice(1), 16)
  if (t.startsWith('%')) return parseInt(t.slice(1), 2)
  if (/^-?\d+$/.test(t)) return parseInt(t, 10)
  if (/^'.'$/.test(t)) return t.charCodeAt(1)
  return SYMBOLIC
}

/** Evaluate an operand expression limited to the `+`/`-` sums these tables use. */
function evalExpr(e: string): number {
  let total = 0
  let sign = 1
  let cur = ''
  for (let i = 0; i < e.length; i++) {
    const c = e[i]!
    // a sign inside a char literal or leading a negative number is not an operator
    if ((c === '+' || c === '-') && cur.trim() !== '' && !cur.trim().endsWith("'")) {
      total += sign * term(cur)
      sign = c === '+' ? 1 : -1
      cur = ''
      continue
    }
    cur += c
  }
  return total + sign * term(cur)
}

class Emitter {
  bytes: number[] = []
  byte(v: number): void {
    this.bytes.push(v & 0xff)
  }
  word(v: number): void {
    if (this.bytes.length % 2 !== 0) this.bytes.push(0) // assembler word alignment
    this.bytes.push((v >> 8) & 0xff, v & 0xff)
  }
  even(): void {
    if (this.bytes.length % 2 !== 0) this.bytes.push(0)
  }
}

/**
 * Assemble the `dc.w`/`dc.b` run of a token-table source to bytes.
 *
 * Conditionals are honoured so the right build is selected: `ifd`/`ifnd`
 * against `defines`, and constant `ifne`/`ifeq` (the sources use `ifne 0`
 * to comment out a block).
 */
export function assembleTokenSource(text: string, opts: AssembleOptions = {}): Uint8Array {
  const defines = new Set(opts.defines ?? [])
  const em = new Emitter()
  /** For each open conditional: is the branch we are currently in emitting? */
  const stack: Array<{ taken: boolean; everTaken: boolean }> = []
  const emitting = (): boolean => stack.every((s) => s.taken)

  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw).trim()
    if (line === '') continue
    const m = /^(?:(\S+):?\s+)?(\S+)(?:\s+(.*))?$/.exec(line)
    if (!m) continue
    // A label may sit in column 1; the directive is then the second field.
    let op = (m[2] ?? '').toLowerCase()
    let args = m[3] ?? ''
    if (/^(dc\.[bwl]|even|ifd|ifnd|ifne|ifeq|else|endc|endif)$/.test((m[1] ?? '').toLowerCase())) {
      op = (m[1] ?? '').toLowerCase()
      args = `${m[2] ?? ''} ${m[3] ?? ''}`.trim()
    }

    switch (op) {
      case 'ifd':
      case 'ifnd': {
        const has = defines.has(args.trim())
        const take = op === 'ifd' ? has : !has
        stack.push({ taken: take, everTaken: take })
        continue
      }
      case 'ifne':
      case 'ifeq': {
        const v = evalExpr(args.trim())
        const take = op === 'ifne' ? v !== 0 : v === 0
        stack.push({ taken: take, everTaken: take })
        continue
      }
      case 'else': {
        const top = stack[stack.length - 1]
        if (top) {
          top.taken = !top.everTaken
          top.everTaken ||= top.taken
        }
        continue
      }
      case 'endc':
      case 'endif':
        stack.pop()
        continue
    }
    if (!emitting()) continue

    if (op === 'even') {
      em.even()
      continue
    }
    if (op !== 'dc.b' && op !== 'dc.w') continue
    for (const operand of splitOperands(args)) {
      if (/^".*"$/.test(operand)) {
        const s = operand.slice(1, -1)
        for (let i = 0; i < s.length; i++) em.byte(s.charCodeAt(i))
        continue
      }
      const v = evalExpr(operand)
      if (op === 'dc.b') em.byte(v)
      else em.word(v)
    }
  }
  return new Uint8Array(em.bytes)
}

/** Assemble a token-table source and parse it into entries. */
export function tokensFromSource(text: string, opts: AssembleOptions = {}): TokenEntry[] {
  return parseTokenTable(assembleTokenSource(text, opts))
}
