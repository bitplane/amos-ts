import { BinReader } from '../loader/binreader'
import type { TokenEntry } from './libtok'

/** Special token ids — the first entries of the core token table. */
export const T = {
  EOL: 0x0000,
  VARIABLE: 0x0006,
  LABEL: 0x000c,
  PROC_CALL: 0x0012,
  LABEL_REF: 0x0018,
  HEX: 0x001e,
  STR_DQ: 0x0026,
  STR_SQ: 0x002e,
  BIN: 0x0036,
  INT: 0x003e,
  FLOAT: 0x0046,
  EXTENSION: 0x004e,
} as const

/**
 * Operators are tokenized from the editor's Dtk_Operateurs table (+Edit.s).
 * Their token ids are NEGATIVE byte offsets from the end of that table, so
 * the id depends on each entry's stored size: 4 header bytes + name + spec +
 * terminator, padded to even. "=" works out to -94 = $FFA2, "+" to $FFC0.
 */
const OP_DEFS: Array<[name: string, spec: string]> = [
  [' xor ', 'O00'],
  [' or ', 'O00'],
  [' and ', 'O00'],
  ['<>', 'O20'],
  ['><', 'O20'],
  ['<=', 'O20'],
  ['=<', 'O20'],
  ['>=', 'O20'],
  ['=>', 'O20'],
  ['=', 'O20'],
  ['<', 'O20'],
  ['>', 'O20'],
  ['+', 'O22'],
  ['-', 'O22'],
  [' mod ', 'O00'],
  ['*', 'O00'],
  ['/', 'O00'],
  ['^', 'O00'],
]

export const OPERATORS: ReadonlyMap<number, string> = (() => {
  const sizes = OP_DEFS.map(([name, spec]) => {
    const n = 4 + name.length + spec.length + 1
    return n % 2 === 0 ? n : n + 1
  })
  const total = sizes.reduce((a, b) => a + b, 0)
  const map = new Map<number, string>()
  let at = 0
  for (let i = 0; i < OP_DEFS.length; i++) {
    map.set(0x10000 - (total - at), OP_DEFS[i]![0])
    at += sizes[i]!
  }
  return map
})()

/**
 * Control-flow instructions whose tokens are followed by inline link data
 * (branch targets, recomputed by the interpreter before each run).
 * Most carry one u16; On/Exit/Exit If carry two.
 */
const INLINE_2_NAMES = new Set(['if', 'else', 'else if', 'for', 'repeat', 'while', 'do', 'data'])
const INLINE_4_NAMES = new Set(['on', 'exit', 'exit if'])
/** Lvo("Name") caches the resolved library vector offset: u32 value + u16. */
const INLINE_6_NAMES = new Set(['lvo'])

export type Tok =
  | { kind: 'var' | 'label' | 'procCall' | 'labelRef'; name: string; flags: number }
  | { kind: 'op'; id: number; op: string }
  | { kind: 'int' | 'bin' | 'hex'; value: number }
  | { kind: 'float'; value: number; raw: number }
  | { kind: 'str'; value: string; quote: '"' | "'" }
  /**
   * An extension keyword. `ext` is the interpreter-config slot number, which
   * identifies the extension only relative to the machine the program was
   * saved on. `nparams` is the byte Ver_Extension pokes after the slot
   * (+Verif.s:456-460): $FF for an AP20-format library, otherwise the actual
   * argument count of this use — the strongest signal available for working
   * out which extension a slot really held. See src/ext/identify.ts.
   */
  | { kind: 'ext'; ext: number; id: number; nparams: number }
  | { kind: 'rem'; id: number; text: string }
  | { kind: 'proc'; id: number; size: number; flags: number; endTarget: number }
  | {
      kind: 'apml'
      /** relative pointer back to the procedure's parameter list, 0 if none */
      param: number
      /** filled in by parseSource: raw 68k machine code bytes that followed */
      mc: Uint8Array
    }
  | { kind: 'core'; id: number }

export interface TokenLine {
  /** byte offset of the line within the source block */
  offset: number
  indent: number
  tokens: Tok[]
}

/** Lookup helper over an extracted token table. */
export class TokenTable {
  private byId = new Map<number, TokenEntry>()
  private names = new Map<number, string>()
  private remIds = new Set<number>()
  private procIds = new Set<number>()
  private apmlIds = new Set<number>()
  private inlineBytes = new Map<number, number>()

  constructor(readonly entries: TokenEntry[]) {
    // Entries with an empty name are argument-count variants of the last
    // named entry (the low special ids — variable, string, ... — excluded).
    // "Empty" means nothing printable: the tokenizer never compares a
    // variant's name — after a -2 terminator VerC4/VerC6 (+Verif.s:3193)
    // steps over the routine words and skips the name bytes outright — so
    // the filler is arbitrary. Every variant but one is a bare $80; Read
    // Text's three-parameter form (+Lib.s:14701) writes $8C, a lone $0C.
    let lastName = ''
    for (const e of entries) {
      this.byId.set(e.id, e)
      const blank = e.name.trim() === ''
      if (!blank) lastName = e.name
      const name = e.id > T.EXTENSION && blank ? lastName : e.name
      this.names.set(e.id, name)
      const n = name.trim().replace(/^!/, '')
      if (n === 'rem' || n === "'") this.remIds.add(e.id)
      if (n === 'procedure') this.procIds.add(e.id)
      if (n === '@_apml_@') this.apmlIds.add(e.id)
      if (INLINE_2_NAMES.has(n)) this.inlineBytes.set(e.id, 2)
      if (INLINE_4_NAMES.has(n)) this.inlineBytes.set(e.id, 4)
      if (INLINE_6_NAMES.has(n)) this.inlineBytes.set(e.id, 6)
    }
  }

  get(id: number): TokenEntry | undefined {
    return this.byId.get(id)
  }

  /** Display name: variants resolved to their instruction, "!" flag stripped. */
  name(id: number): string | undefined {
    const n = this.names.get(id)
    return n === undefined ? undefined : n.replace(/^!/, '')
  }

  isRem(id: number): boolean {
    return this.remIds.has(id)
  }

  isProcedure(id: number): boolean {
    return this.procIds.has(id)
  }

  isApml(id: number): boolean {
    return this.apmlIds.has(id)
  }

  inlineSize(id: number): number {
    return this.inlineBytes.get(id) ?? 0
  }
}

/** Motorola Fast Floating Point: 24-bit mantissa, sign bit 7, exponent bits 6-0 excess-64. */
export function decodeFFP(raw: number): number {
  if (raw === 0) return 0
  const mantissa = raw >>> 8
  const sign = raw & 0x80 ? -1 : 1
  const exp = (raw & 0x7f) - 64
  return (sign * mantissa * 2 ** exp) / 2 ** 24
}

export class TokenStreamError extends Error {
  constructor(
    message: string,
    readonly lineOffset: number,
    readonly lineBytes: Uint8Array,
  ) {
    super(message)
  }
}

/** Parse one tokenized source block (the part of a .AMOS file after the 20-byte header). */
export function parseSource(src: Uint8Array, table: TokenTable): TokenLine[] {
  const lines: TokenLine[] = []
  let pos = 0
  let lastProcEnd = -1
  while (pos < src.length) {
    const lenWords = src[pos]!
    const indent = src[pos + 1]!
    const lineEnd = pos + lenWords * 2
    // Some files end with zero padding after the last line.
    if (lenWords === 0 && src.subarray(pos).every((b) => b === 0)) break
    if (lenWords === 0 || lineEnd > src.length) {
      throw new TokenStreamError(
        `bad line length ${lenWords} words at offset ${pos}`,
        pos,
        src.subarray(pos, Math.min(pos + 64, src.length)),
      )
    }
    const r = new BinReader(src.subarray(pos + 2, lineEnd))
    let tokens: Tok[]
    try {
      tokens = parseLine(r, table, pos + 2)
    } catch (e) {
      throw new TokenStreamError(
        `line at offset ${pos}: ${e instanceof Error ? e.message : e}`,
        pos,
        src.subarray(pos, lineEnd),
      )
    }
    lines.push({ offset: pos, indent, tokens })
    pos = lineEnd
    for (const tok of tokens) {
      if (tok.kind === 'proc') lastProcEnd = tok.endTarget
      if (tok.kind === 'apml') {
        // Raw 68k machine code follows this line, up to the enclosing
        // procedure's End Proc line (located via the Procedure size link).
        if (lastProcEnd <= pos || lastProcEnd > src.length) {
          throw new TokenStreamError(
            `machine-code procedure at ${pos} with bad End Proc target ${lastProcEnd}`,
            pos,
            src.subarray(pos, Math.min(pos + 64, src.length)),
          )
        }
        tok.mc = src.subarray(pos, lastProcEnd)
        pos = lastProcEnd
      }
    }
  }
  return lines
}

function parseLine(r: BinReader, table: TokenTable, lineDataOffset: number): Tok[] {
  const toks: Tok[] = []
  while (r.remaining >= 2) {
    const idOffset = lineDataOffset + r.pos
    const id = r.u16()
    if (id === T.EOL) return toks
    toks.push(parseTok(id, r, table, idOffset))
  }
  // Most lines end with a null token, but e.g. @_apml_@ lines rely on the
  // line length alone.
  return toks
}

function evenStr(r: BinReader, len: number): string {
  let s = ''
  for (const b of r.raw(len)) s += String.fromCharCode(b)
  if (len % 2 !== 0) r.skip(1)
  return s
}

function parseTok(id: number, r: BinReader, table: TokenTable, idOffset: number): Tok {
  if (id & 0x8000) {
    const op = OPERATORS.get(id)
    if (!op) throw new Error(`unknown operator token $${id.toString(16)}`)
    return { kind: 'op', id, op }
  }
  switch (id) {
    case T.VARIABLE:
    case T.LABEL:
    case T.PROC_CALL:
    case T.LABEL_REF: {
      r.skip(2) // runtime link, zero in saved files
      const len = r.u8()
      const flags = r.u8()
      // the stored length includes NUL padding to even size
      const name = evenStr(r, len).replace(/\0+$/, '')
      const kind =
        id === T.VARIABLE ? 'var' : id === T.LABEL ? 'label' : id === T.PROC_CALL ? 'procCall' : 'labelRef'
      return { kind, name, flags }
    }
    case T.INT:
      return { kind: 'int', value: r.i32() }
    case T.BIN:
      return { kind: 'bin', value: r.u32() }
    case T.HEX:
      return { kind: 'hex', value: r.u32() }
    case T.FLOAT: {
      const raw = r.u32()
      return { kind: 'float', value: decodeFFP(raw), raw }
    }
    case T.STR_DQ:
    case T.STR_SQ: {
      const len = r.u16()
      return { kind: 'str', value: evenStr(r, len), quote: id === T.STR_DQ ? '"' : "'" }
    }
    case T.EXTENSION: {
      const ext = r.u8()
      const nparams = r.u8()
      const extId = r.u16()
      return { kind: 'ext', ext, id: extId, nparams }
    }
  }
  if (table.isRem(id)) {
    r.skip(1)
    const len = r.u8()
    return { kind: 'rem', id, text: evenStr(r, len) }
  }
  if (table.isProcedure(id)) {
    const size = r.u32()
    r.skip(2) // saved seed used by the folding encryption
    r.skip(1)
    const flags = r.u8()
    // size is the byte distance from just after the size field (id + 2 + 4)
    // to the start of the End Proc line
    return { kind: 'proc', id, size, flags, endTarget: idOffset + 6 + size }
  }
  if (table.isApml(id)) {
    return { kind: 'apml', param: r.u16(), mc: new Uint8Array(0) }
  }
  if (!table.get(id)) throw new Error(`unknown token $${id.toString(16).padStart(4, '0')}`)
  r.skip(table.inlineSize(id))
  return { kind: 'core', id }
}
