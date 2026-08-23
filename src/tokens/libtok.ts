import { BinReader } from '../loader/binreader'

/**
 * Extracts the token table from a compiled AMOS Professional library
 * (AMOSPro.Lib, AMOSPro_Music.Lib, ...).
 *
 * These are Amiga hunk executables whose first code hunk contains:
 *   dc.l  C_Tk-C_Off        ; size of the jump table area
 *   dc.l  C_Lib-C_Tk        ; size of the token table
 *   dc.l  ...               ; (core lib has 4 size longs, extensions 3)
 *   dc.w  0
 *   dc.b  "AP20"
 *   <jump table area>       ; C_Off
 *   <token table>           ; C_Tk
 *
 * A token's 16-bit id in a tokenized program is the byte offset of its
 * entry from C_Tk. Each entry:
 *   u16 instruction routine number, u16 function routine number,
 *   name bytes (last char has bit 7 set; a lone $80 means empty name),
 *   parameter-spec bytes until $FF, padded to even length.
 */
export interface TokenEntry {
  /** token id = byte offset of this entry from the start of the table */
  id: number
  name: string
  /**
   * Parameter/type spec chars, verbatim from the library.
   *
   * The first character is the KIND, and AMOS Professional's own extension
   * docs give the whole alphabet (`|Music.s`, on the Tutorial disc, vendored
   * under `fixtures/official-amos`):
   *
   *     I  instruction
   *     0  function that returns a integer
   *     1  function that returns a float
   *     2  function that returns a string
   *     V  reserved variable -- "you must state the type" after it
   *
   * The rest is the parameter list: a type per parameter, `,` or `t` (for
   * `To`) between them. So `I0,0` is an instruction taking two integers, `20`
   * is a string function of one integer, and `V0` is an integer reserved
   * variable — no brackets and no arguments, the way `Timer` is written.
   *
   * The `V` matters and is easy to miss, because a `V0` entry has a function
   * routine and nothing else distinguishes it from a `0`: fifteen of The
   * Game's keywords are reserved variables, and its guide writes one of them
   * as `A=G Oddno(B#)`, which will not tokenise.
   */
  spec: string
  /**
   * The byte that ENDED the spec, when it was not the usual $FF.
   *
   * `VerC4` (+Verif.s:3158) tests it exactly: `cmp.b #-2,d1 / bne VerSynt`.
   * A $FE says the entry that follows is an argument-count variant of this
   * instruction, so a spec that did not match is retried against it and the
   * matching id is poked back over the token. A $FD says the entry that
   * follows is the same keyword's FUNCTION form, which `Ope_InstFonction`
   * (:2735) steps onto instead. Two core entries carry $FD, `!screen` and
   * `!colour`, and everything else is $FE or $FF.
   *
   * Omitted when it is $FF, which is 574 of the 778 core entries.
   */
  end?: number
  instr: number
  func: number
}

/**
 * The AmigaDOS hunk reader lives in ../amiga — it is an OS executable format,
 * not an AMOS one, and this module owning a copy of it was an accident of who
 * needed it first. Re-exported because it is public API (see ../index.ts).
 */
export { firstCodeHunk } from '../amiga/hunk'
import { firstCodeHunk } from '../amiga/hunk'

export interface AmosLib {
  tokens: TokenEntry[]
  /** raw code hunk, for future reference (e.g. locating runtime routines) */
  code: Uint8Array
}

/**
 * Token ids in saved programs are offsets from a fixed base near C_Tk. The
 * exact base is anchored empirically: "rem" must land on its known id $064A
 * (verified against tokenized files). Applied by parseAmosLib when the core
 * "rem" entry is present; extension tables use offsets as-is.
 */
function rebase(tokens: TokenEntry[]): TokenEntry[] {
  const rem = tokens.find((t) => t.name === 'rem')
  if (!rem) return tokens
  const delta = 0x064a - rem.id
  if (delta !== 0) for (const t of tokens) t.id += delta
  return tokens
}

export function parseAmosLib(bytes: Uint8Array): AmosLib {
  const code = firstCodeHunk(bytes)
  // Locate the "AP20" magic preceded by a zero word; size longs come before.
  let magic = -1
  for (let i = 0; i + 4 <= code.length && i < 64; i += 2) {
    if (code[i] === 0x41 && code[i + 1] === 0x50 && code[i + 2] === 0x32 && code[i + 3] === 0x30) {
      magic = i
      break
    }
  }
  if (magic < 0) throw new Error('AP20 magic not found — not an AMOS library')
  const r = new BinReader(code)
  const jumpSize = r.u32()
  const tokSize = r.u32()
  const tableStart = magic + 4 + jumpSize
  const table = code.subarray(tableStart, tableStart + tokSize)
  return { tokens: rebase(parseTokenTable(table)), code }
}

/** the four bytes AMOSTools writes where a token entry's two routine words were */
const AMOSTOOLS_SCRUB = 0x3d3d3d3d

/**
 * A token table with the library stripped out from under it — the shape the
 * `AMOSTools/Extensions` directory ships.
 *
 * These files keep a hunk header and a HUNK_CODE, but both length fields read
 * zero and there is no code: what follows is the original library's token
 * table, byte for byte, with every entry's `instr`/`func` pair overwritten
 * with `====`. So the NAMES, the parameter SPECS and — because an id is the
 * byte offset of its entry — the IDS all survive, and nothing else does.
 *
 * That makes them worth reading and worth distrusting in equal measure, so
 * this refuses anything that does not carry the scrub: a real library must go
 * through `parseAmosLibOld`, which can tell you what the routines are.
 *
 * The routine numbers come back the way `intuition-1.3b`'s assembled table
 * reports its own unknown ones: the side the spec says exists is 1, AMOS's
 * absent-routine marker in an AP20 table, and the other side is $ffff. The
 * spec's first character is the only witness left to which is which.
 *
 * CORROBORATED against CRAFT, which is held here both ways: the stub's table
 * agrees with the real `AMOSPro_CRAFT.Lib` on all 168 entries' id, name and
 * spec. See libtok.test.ts.
 */
export function parseAmosToolsTable(bytes: Uint8Array): TokenEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // the hunk shell is a formality here: header, HUNK_CODE, and two lengths
  // that both lie. The three size longwords the library format puts at the
  // head of its code hunk follow, and the table is 10 bytes past them.
  if (bytes.length < 0x40 || v.getUint32(0) !== 0x0000_03f3) {
    throw new Error('not an AMOSTools token table — no hunk header')
  }
  const start = 0x20 + 8 + v.getUint32(0x20) + 10
  if (v.getUint32(start) !== AMOSTOOLS_SCRUB && v.getUint32(start + 4) !== AMOSTOOLS_SCRUB) {
    throw new Error('not an AMOSTools token table — the routine words are not scrubbed')
  }
  return parseTokenTable(bytes.subarray(start)).map((t) => {
    if (t.name === '' && t.spec === '') return t
    const isInstr = t.spec.startsWith('I')
    return { ...t, instr: isInstr ? 1 : 0xffff, func: isInstr ? 0xffff : 1 }
  })
}

/**
 * Older / third-party extensions (TURBO Plus, GUI, Ldos) lack the AP20
 * magic of the stock AMOS Pro 2.0 libraries. Their code hunk begins with
 * a header long = the jump-table size; the token table follows the jump
 * table, and the entry offsets sit 10 bytes past 8+jumpSize (a fixed
 * header the file token-ids are measured from — verified by matching
 * 45/45 Ldos, 52/52 TURBO and 34/34 GUI ids used across the corpus).
 */
export function parseAmosLibOld(bytes: Uint8Array): AmosLib {
  const code = firstCodeHunk(bytes)
  const v = new DataView(code.buffer, code.byteOffset, code.byteLength)
  const jumpSize = v.getUint32(0)
  const table = code.subarray(8 + jumpSize + 10)
  return { tokens: parseTokenTable(table), code }
}

export function parseTokenTable(table: Uint8Array): TokenEntry[] {
  const r = new BinReader(table)
  const entries: TokenEntry[] = []
  while (r.remaining >= 6) {
    const id = r.pos
    // A zero word at an entry-start position (other than the null entry at
    // offset 0) terminates the table; index sections (FSwp/ComP/KwiK) follow.
    if (id > 0 && r.bytes[r.pos] === 0 && r.bytes[r.pos + 1] === 0) break
    const instr = r.u16()
    const func = r.u16()
    let name = ''
    let truncated = false
    for (;;) {
      if (r.remaining === 0) {
        truncated = true
        break
      }
      const b = r.u8()
      if (b === 0x80) break // empty name
      name += String.fromCharCode(b & 0x7f)
      if (b & 0x80) break
      if (name.length > 40) throw new Error(`runaway token name at $${id.toString(16)}`)
    }
    let spec = ''
    let end = 0xff
    while (!truncated) {
      if (r.remaining === 0) {
        truncated = true
        break
      }
      const b = r.u8()
      /**
       * The spec ends at the first NEGATIVE byte, which is the rule AMOS
       * itself uses. `Ver_Ech` (+Verif.s:5259) is the interpreter's own walk
       * over this table, swapping each entry's routine pair for the verify
       * build's, and it advances like this:
       *
       *     .Skip1  tst.b (a0)+ / bpl.s .Skip1     the name
       *     .Skip2  tst.b (a0)+ / bpl.s .Skip2     the spec
       *             move.w a0,d0 / and.w #1,d0 / add.w d0,a0
       *
       * so bit 7, not the value. In practice the terminator written is -1
       * ($FF), or -2/-3 ($FE/$FD) to mark that the next entry is a variant of
       * the same instruction with no name of its own — an argument-count
       * variant and the function form respectively. Testing for those three
       * values agreed with `bpl` on all 91 libraries held, so this is not a
       * behaviour change; it is the difference between a rule that happens to
       * work and the one the 68k executes.
       *
       * It matters because a $00 is POSITIVE and so terminates nothing.
       * AMOSPro_Range.Lib's `splot` entry has no terminator at all, and the
       * walk runs on into the following entry — see src/cli/extdis.ts. A
       * reader that stopped at $00 would produce a tidier table than the
       * Amiga does, and every id after it would be wrong.
       *
       * What that one missing byte costs Range 2.9Plus is two keywords.
       * $046e's spec reads "I0,0,0,0\0\0M", which no argument list can match,
       * so `Splot` is a syntax error however it is written; and the entry
       * behind it resumes four bytes late, so `float planes` is read as
       * routine $666c named "t planes" and routine 77 has no name at all.
       * The walk resynchronises at $0494 and `fmod` onwards is intact.
       */
      if (b & 0x80) {
        end = b
        break
      }
      spec += String.fromCharCode(b)
      if (spec.length > 64) throw new Error(`runaway token spec at $${id.toString(16)}`)
    }
    if (truncated) break
    if (r.pos % 2 !== 0) r.skip(1)
    entries.push(end === 0xff ? { id, name, spec, instr, func } : { id, name, spec, end, instr, func })
    // A zero word where the next entry's routine numbers should be, followed
    // by nothing meaningful, marks padding at the end of the table.
    if (r.remaining < 6) break
  }
  return entries
}
