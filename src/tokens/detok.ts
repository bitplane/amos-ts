import type { TokenLine, Tok } from './stream'
import type { TokenTable } from './stream'

/** Capitalize an instruction name the way the AMOS editor displays it. */
function displayName(name: string): string {
  return name.replace(/(^|[ ])([a-z])/g, (_, sp: string, c: string) => sp + c.toUpperCase())
}

/** Variable/label type suffix from the flags byte. */
function suffix(flags: number): string {
  if (flags & 0x01) return '#'
  if (flags & 0x02) return '$'
  return ''
}

export interface DetokOptions {
  /** token tables for extensions, keyed by extension slot number */
  extensions?: Map<number, TokenTable>
}

export function detokLine(line: TokenLine, table: TokenTable, opts: DetokOptions = {}): string {
  let out = ' '.repeat(Math.max(0, line.indent - 1))
  for (const tok of line.tokens) {
    const text = tokText(tok, table, opts)
    // Insert a space between adjacent words/values ("Dim L", "1 To 10");
    // punctuation like ( ) , = attaches directly.
    if (/[\w$#%)\]"']$/.test(out) && /^[\w$%"'[]/.test(text)) out += ' '
    out += text
  }
  return out.replace(/\s+$/, '')
}

export function detokSource(lines: TokenLine[], table: TokenTable, opts: DetokOptions = {}): string {
  return lines.map((l) => detokLine(l, table, opts)).join('\n')
}

function tokText(tok: Tok, table: TokenTable, opts: DetokOptions): string {
  switch (tok.kind) {
    case 'op':
      return tok.op
    // identifiers are stored lowercase; the editor displays them in caps
    case 'var':
      return tok.name.toUpperCase() + suffix(tok.flags)
    case 'label':
      return tok.name.toUpperCase() + suffix(tok.flags) + ':'
    case 'procCall':
      return tok.name.toUpperCase() + suffix(tok.flags)
    case 'labelRef':
      return tok.name.toUpperCase() + suffix(tok.flags)
    case 'int':
      return String(tok.value)
    case 'bin':
      return '%' + tok.value.toString(2)
    case 'hex':
      return '$' + tok.value.toString(16).toUpperCase()
    case 'float':
      return formatFloat(tok.value)
    case 'str':
      return tok.quote + tok.value + tok.quote
    case 'rem': {
      const kw = table.get(tok.id)?.name.trim() === "'" ? "' " : 'Rem '
      return kw + tok.text
    }
    case 'proc':
      return 'Procedure '
    case 'apml':
      return `[machine code: ${tok.mc.length} bytes]`
    case 'ext': {
      const name = opts.extensions?.get(tok.ext)?.name(tok.id)
      if (name !== undefined) return displayName(name)
      return `{ext${tok.ext}:$${tok.id.toString(16).padStart(4, '0')}}`
    }
    case 'core': {
      const name = table.name(tok.id)
      if (name === undefined) return `{$${tok.id.toString(16).padStart(4, '0')}}`
      return displayName(name)
    }
  }
}

function formatFloat(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return v.toFixed(1)
  const s = String(v)
  return s.includes('e') || s.includes('.') ? s : s + '.0'
}
