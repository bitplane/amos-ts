import { decodeFfp } from '../amiga/ffp'
import { BinReader } from '../loader/binreader'
import { procode } from './procode'
import type { TokenEntry } from './libtok'

/**
 * Special token ids — the first entries of the core token table, from
 * `+Equ.s:1997-2012`.
 *
 * $1E and $36 were the wrong way round here until the corpus settled it.
 * `_TkBin equ $0000001E` and `_TkHex equ $00000036`, and the programs agree:
 * $36 carries $FFF, $F00 and $600, which are AMOS palette colours written in
 * hex, while $1E carries $C0, $3F and $FFFF, which are masks written in
 * binary. Every listing printed a `%` for a `$` and a `$` for a `%`.
 */
export const T = {
  EOL: 0x0000,
  VARIABLE: 0x0006,
  LABEL: 0x000c,
  PROC_CALL: 0x0012,
  LABEL_REF: 0x0018,
  BIN: 0x001e,
  STR_DQ: 0x0026,
  STR_SQ: 0x002e,
  HEX: 0x0036,
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
  | {
      kind: 'proc'
      id: number
      size: number
      /**
       * The 16-bit word at offset 10 of the Procedure line, which the editor
       * treats as a bitfield on its HIGH byte: bit 7 folded (Ed_ProcOpen
       * `bchg #7,10(a2)`, +Edit.s:8862), bit 6 "cannot be opened" (`btst
       * #6,10(a2)`, :8846). Bits 14 and 12 together are AMOS Pro's own
       * machine-language procedure (`or.w #%0101000000000000,10(a3)`, :8759).
       */
      flags: number
      /** the body is not token lines — see PROTECTED_PROC */
      protectedBody?: Uint8Array
      endTarget: number
    }
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

  /**
   * @param isExtension an extension's own table rather than the core one
   */
  constructor(
    readonly entries: TokenEntry[],
    isExtension = false,
  ) {
    /*
     * Entries with an empty name are argument-count variants of the last
     * named entry. "Empty" means nothing printable: the tokenizer never
     * compares a variant's name, because after a -2 terminator VerC4/VerC6
     * (+Verif.s:3193) steps over the routine words and skips the name bytes
     * outright, so the filler is arbitrary. Every variant but one is a bare
     * $80; Read Text's three-parameter form (+Lib.s:14701) writes $8C, a
     * lone $0C.
     *
     * WHERE the variants start differs by table. In the core table the ids
     * below T.EXTENSION are the special low ones (variable, string, int) and
     * are legitimately nameless, so the rule begins above them. An
     * extension's own table numbers from zero, where only entry 0 is the
     * header, and a variant can sit anywhere: GUI's `Gui Open window,gui`
     * is $06 and its `window,gui,bank` form is $18.
     *
     * Getting that wrong is silent. `Names.of` hands the dispatcher an empty
     * string, no handler matches it, and the statement is skipped with no
     * error: GuiDemo.Amos ran its `Gui Open 1,1,20`, opened nothing, and
     * failed on the next line with "Window not open".
     */
    const first = isExtension ? 0 : T.EXTENSION
    let lastName = ''
    for (const e of entries) {
      this.byId.set(e.id, e)
      // a spec opening with C is a CONSTANT slot, not a variant: the seven of
      // them are the six low ones plus $2B6A, which is `_TkDFl`, the
      // double-precision literal. They are nameless because nothing types
      // them, and carrying a neighbour's name onto them made $2B6A read as
      // "screen mode", the keyword that happens to sit above it.
      const blank = e.name.trim() === '' && !e.spec.startsWith('C')
      if (!blank && e.name.trim() !== '') lastName = e.name
      const name = e.id > first && blank ? lastName : e.name
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

/** Motorola Fast Floating Point, which the format itself defines in ../amiga/ffp.ts */
export const decodeFFP = decodeFfp

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
/**
 * Bit 14 of the Procedure flags word — the editor's `btst #6,10(a2)` on the
 * high byte, "this procedure cannot be opened" (+Edit.s:8846). Set for both
 * machine-language and locked procedures, and for nothing else.
 */
export const PROTECTED_PROC = 0x4000
/**
 * Bit 13 — the body is CURRENTLY enciphered. The verifier deciphers it in
 * place and clears this bit (`bchg #5,8(a6)`, +Verif.s:5219), leaving bit 14
 * set: the procedure stays closed to the editor, but its body is tokens
 * again. See procode.ts.
 */
export const ENCIPHERED_PROC = 0x2000
/** and bit 12 alongside it means machine language rather than a cipher */
export const MACHINE_CODE_PROC = 0x1000

/**
 * The source with any locked procedure body deciphered, which is the form the
 * editor holds and the only form a detokeniser can read. `parseSource` does
 * this internally; the line offsets it reports are into THIS buffer.
 */
export function decipheredSource(src: Uint8Array, table: TokenTable): Uint8Array {
  return decipherLocked(src, table) ?? src
}

export function parseSource(src: Uint8Array, table: TokenTable): TokenLine[] {
  // As the verifier does before a program runs, and for the same reason: what
  // follows cannot read a locked procedure until it has been deciphered.
  src = decipherLocked(src, table) ?? src
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
      if (tok.kind === 'proc') {
        lastProcEnd = tok.endTarget
        // A body that is still not token lines by the time it gets here. Two
        // kinds reach this point, and the flags word tells them apart:
        //
        //  - AMOS Pro's machine-language procedure (bits 14 and 12, Ed_ProcML
        //    +Edit.s:8759), which stores a hunk-loaded 68k image. Most start
        //    their body with an `@_apml_@` line and take the path below
        //    instead; the ones that do not are skipped here.
        //  - an AMOS 1.x locked procedure that `decipherLocked` could not
        //    read — a truncated file, or a body that did not come back as
        //    tokens. Bit 13 is still set on those, and only on those.
        //
        // The line LENGTHS survive the cipher, so walking a locked body by
        // its length bytes lands exactly on End Proc, and the body can be
        // taken whole with the parse resuming there. That is what keeps the
        // rest of the program: the alternative is to read the cipher as
        // tokens, fail on the first word that is not one, and lose the lot.
        const bodyStartsApml =
          pos + 4 <= src.length && table.isApml((src[pos + 2]! << 8) | src[pos + 3]!)
        const unreadable = tok.flags & (ENCIPHERED_PROC | MACHINE_CODE_PROC)
        if (tok.flags & PROTECTED_PROC && unreadable && !bodyStartsApml) {
          if (tok.endTarget <= pos || tok.endTarget > src.length) {
            throw new TokenStreamError(
              `protected procedure at ${pos} with bad End Proc target ${tok.endTarget}`,
              pos,
              src.subarray(pos, Math.min(pos + 64, src.length)),
            )
          }
          tok.protectedBody = src.subarray(pos, tok.endTarget)
          pos = tok.endTarget
          // A LOCKED procedure's cipher runs one line past its own body, so
          // the End Proc line at endTarget keeps its length, indent and End
          // Proc token in clear but has its EOL word enciphered along with
          // the rest. Machine-code procedures leave that line untouched. So
          // take the token and let the remainder of the line go with the
          // body.
          if (!(tok.flags & MACHINE_CODE_PROC)) {
            const endLen = src[pos]
            if (endLen === undefined || endLen < 2 || pos + endLen * 2 > src.length) {
              throw new TokenStreamError(
                `locked procedure at ${tok.endTarget} without an End Proc line`,
                pos,
                src.subarray(pos, Math.min(pos + 64, src.length)),
              )
            }
            const endToks = parseLine(new BinReader(src.subarray(pos + 2, pos + 4)), table, pos + 2)
            lines.push({ offset: pos, indent: src[pos + 1]!, tokens: endToks })
            pos += endLen * 2
          }
        }
      }
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

/**
 * Decipher every locked procedure in a source block, the way the verifier
 * does before the program runs (+Verif.s:1553). Returns a deciphered COPY, or
 * null when there was nothing enciphered — which is all but 166 of the 5,131
 * programs in the corpus archive, and the reason the copy is made lazily.
 *
 * Locked procedures nest: `TUSTMC.AMOS` has two whose headers lie inside an
 * outer cipher and only become readable once the outer one is undone. Walking
 * INTO each body as it is deciphered handles that in the one pass, because a
 * nested header is an ordinary Procedure line by the time the walk reaches it.
 */
function decipherLocked(src: Uint8Array, table: TokenTable): Uint8Array | null {
  let out: Uint8Array | null = null
  let pos = 0
  for (;;) {
    const buf = out ?? src
    if (pos + 12 > buf.length) break
    const lenWords = buf[pos]!
    if (lenWords < 2 || pos + lenWords * 2 > buf.length) break
    if (!table.isProcedure((buf[pos + 2]! << 8) | buf[pos + 3]!)) {
      pos += lenWords * 2
      continue
    }
    const flags = (buf[pos + 10]! << 8) | buf[pos + 11]!
    const size =
      ((buf[pos + 4]! << 24) | (buf[pos + 5]! << 16) | (buf[pos + 6]! << 8) | buf[pos + 7]!) >>> 0
    const endTarget = pos + 8 + size
    // A machine-language body is a 68k image, and ProCode itself returns at
    // once on bit 12; step over it rather than into it.
    if (flags & MACHINE_CODE_PROC) {
      if (endTarget <= pos || endTarget > buf.length) break
      pos = endTarget
      continue
    }
    if (!(flags & PROTECTED_PROC) || !(flags & ENCIPHERED_PROC)) {
      pos += lenWords * 2
      continue
    }
    if (endTarget <= pos || endTarget > buf.length) break
    // first one found: from here on the work is done on a copy
    if (!out) {
      out = Uint8Array.from(src)
      continue
    }
    const bodyStart = pos + lenWords * 2
    const original = out.slice(bodyStart, Math.min(endTarget + 8, out.length))
    if (procode(out, pos) && bodyIsTokens(out, table, bodyStart, endTarget)) {
      out[pos + 10] = out[pos + 10]! & ~0x20 // bchg #5,8(a6), +Verif.s:5219
      pos = bodyStart
      continue
    }
    // The cipher is symmetric and unauthenticated, so a wrong key or a
    // truncated file yields bytes rather than an error. Put the body back as
    // it was, bit 13 and all, and let parseSource take it whole.
    out.set(original, bodyStart)
    pos = endTarget
  }
  return out
}

/**
 * Does a just-deciphered body read as token lines? This is what tells a
 * successful decipher from a plausible-looking failure: every line must parse
 * and the walk must land exactly on the End Proc line.
 *
 * A procedure nested inside this one is stepped over rather than checked. Its
 * own body is a separate question — and if it is locked it is still
 * enciphered at this point, since the walk above has not reached it yet.
 */
function bodyIsTokens(src: Uint8Array, table: TokenTable, start: number, end: number): boolean {
  let pos = start
  while (pos < end) {
    const lenWords = src[pos]!
    const lineEnd = pos + lenWords * 2
    if (lenWords < 2) return false
    const id = (src[pos + 2]! << 8) | src[pos + 3]!
    if (lineEnd > end) {
      /*
       * The End Proc line, reached early because it carries a return list.
       *
       * `pos + 8 + size` is six bytes short of that line's END, not its
       * start, so the two coincide only for a bare `End Proc` and its three
       * words. `End Proc[bscore]` is eleven, and the walk meets it sixteen
       * bytes before `end`.
       *
       * Every locked procedure in Gush's A3 ends that way, so every one of
       * them was judged a failed decipher, put back enciphered, and left for
       * parseSource to choke on: "unknown operator token $c80f", which is
       * ciphertext being read as a token.
       */
      return (table.name(id) ?? '').trim().toLowerCase() === 'end proc' && lineEnd === end + 6
    }
    try {
      parseLine(new BinReader(src.subarray(pos + 2, lineEnd)), table, pos + 2)
    } catch {
      return false
    }
    if (table.isProcedure(id)) {
      const size =
        ((src[pos + 4]! << 24) | (src[pos + 5]! << 16) | (src[pos + 6]! << 8) | src[pos + 7]!) >>> 0
      const inner = pos + 8 + size
      if (inner <= pos || inner >= end) return false
      const endLen = src[inner]!
      if (endLen < 2 || inner + endLen * 2 > end) return false
      pos = inner + endLen * 2
      continue
    }
    pos = lineEnd
  }
  return pos === end
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
    r.skip(2) // a per-procedure word the editor keeps; not the line count
    const flags = r.u16()
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
