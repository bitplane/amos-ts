/**
 * `Edt_BufE`: the lines the cursor is actually in, one 256-byte slot each.
 *
 * A program is tokens and a line being typed is text, so the editor keeps
 * both. `Ed_Untok` (+Edit.s:10874) detokenises a program line into the slot
 * for a display row, the user types into the slot, and `Ed_TokCur` (:10729)
 * tokenises it back when the cursor leaves. `Edt_LEdited` is the dirty flag
 * that decides whether that last step has anything to do.
 *
 * The slot is fixed and the arithmetic is a shift: `Ed_LCourant` (:11181) is
 * `move.w Edt_YCu(a4),d0 / lsl.w #8,d0`, so row times 256. Inside it,
 * `move.w (a0)+,d0` reads a length word and leaves the pointer on the text,
 * and `tst.b 255-2(a0)` -- byte 255 of the slot -- is the flag saying whether
 * the line may be changed at all.
 *
 * ## Two limits, and they are not the same number
 *
 * `R_InsChar` (:1850) caps a line at 250 characters: `cmp.w #250,d0`, and
 * over that it inserts only what fits rather than refusing. So nothing TYPED
 * can pass 250.
 *
 * `Detok` has no such cap. It writes from slot+2 with the flag at slot+255,
 * which leaves 253, and a longer line walks straight over the flag and into
 * the next row. Measured over 124,480 lines in fixtures: two are longer than
 * 250, both the same `Screen Copy` in _Fancy_Wipes.AMOS at 252, and none is
 * longer than 253. So the overflow is reachable in principle and nothing in
 * the corpus reaches it.
 */
import type { TokenTable } from '../tokens/stream'
import { detokLineBytes, type EdtokOptions } from '../tokens/edtok'
import type { ProgramBuffer } from './buffer'

/** `lsl.w #8`: one row of the edit buffer */
const SLOT = 256

/** where the text starts, past the length word */
const TEXT = 2

export class EditBuffer {
  /** `cmp.w #250,d0` in `R_InsChar`: the longest line that can be typed */
  static readonly MAX_TYPED = 250
  /** what fits between the length word and the flag at byte 255 */
  static readonly MAX_HELD = SLOT - TEXT - 1

  readonly bytes: Uint8Array

  constructor(readonly rows: number) {
    this.bytes = new Uint8Array(rows * SLOT)
  }

  private base(row: number): number {
    if (row < 0 || row >= this.rows) throw new RangeError(`row ${row} is outside the edit buffer`)
    return row * SLOT
  }

  /** the length word `Ed_LCourant` reads */
  length(row: number): number {
    const at = this.base(row)
    return (this.bytes[at]! << 8) | this.bytes[at + 1]!
  }

  private setLength(row: number, n: number): void {
    const at = this.base(row)
    this.bytes[at] = (n >>> 8) & 0xff
    this.bytes[at + 1] = n & 0xff
  }

  text(row: number): string {
    const at = this.base(row) + TEXT
    let out = ''
    for (let i = 0; i < this.length(row); i++) out += String.fromCharCode(this.bytes[at + i]!)
    return out
  }

  /**
   * Put text in directly, which is what `Detok` does and nothing else.
   *
   * DEVIATION: the machine would write past byte 255 and into the next row.
   * Nothing in the corpus is long enough to, and a port that reproduced it
   * would be corrupting a neighbouring line to no one's benefit, so the write
   * stops at the flag and the line is truncated.
   */
  setText(row: number, s: string): void {
    const n = Math.min(s.length, EditBuffer.MAX_HELD)
    const at = this.base(row) + TEXT
    for (let i = 0; i < n; i++) this.bytes[at + i] = s.charCodeAt(i) & 0xff
    this.setLength(row, n)
  }

  /** byte 255: `Tk_EditL` said no, so the cursor may sit here and change nothing */
  editable(row: number): boolean {
    return this.bytes[this.base(row) + SLOT - 1] === 0
  }

  setEditable(row: number, ok: boolean): void {
    this.bytes[this.base(row) + SLOT - 1] = ok ? 0 : 0xff
  }

  /**
   * `R_InsChar` (:1850): `chars` into row `row` at column `col`.
   *
   * Returns how many went in, which is fewer than asked when the line would
   * pass 250. The machine trims rather than refusing: `sub.w #250,d0 / sub.w
   * d0,d2 / move.w #250,d0`. Zero back means the caller must not raise
   * `Edt_LEdited`, because `tst.w d2 / beq .Out` skips the bump too.
   */
  insert(row: number, col: number, chars: string): number {
    const len = this.length(row)
    let n = chars.length
    let end = len + n
    if (end > EditBuffer.MAX_TYPED) {
      n -= end - EditBuffer.MAX_TYPED
      end = EditBuffer.MAX_TYPED
    }
    if (n <= 0) return 0
    const at = this.base(row) + TEXT
    this.bytes.copyWithin(at + col + n, at + col, at + end - n)
    for (let i = 0; i < n; i++) this.bytes[at + col + i] = chars.charCodeAt(i) & 0xff
    this.setLength(row, len + n)
    return n
  }

  /**
   * The overwrite arm of `Ed_PKey` (:1826): one character over another.
   *
   * `move.b d7,(a1)` with the length left alone, which is the whole of it.
   * There is no `R_` routine for this because nothing else needs it.
   */
  overwrite(row: number, col: number, ch: string): void {
    this.bytes[this.base(row) + TEXT + col] = ch.charCodeAt(0) & 0xff
  }

  /**
   * `R_DelChar` (:1880): `count` characters at column `col`.
   *
   * The guard is `cmp.w d0,d2 / bhi .Skip`, which compares the count against
   * the whole LINE and not against what is left after the cursor. Deleting
   * more than that shortens the line by the full count and moves nothing, so
   * characters before the cursor fall off the end. Every caller checks first
   * -- `Ed_Delete` (:3565) will not run without a character under the cursor
   * -- so the arithmetic is the caller's to get right, and it is left here as
   * the machine has it.
   */
  delete(row: number, col: number, count: number): boolean {
    const len = this.length(row)
    if (count > len) return false
    const at = this.base(row) + TEXT
    const move = len - col - count
    if (move > 0) this.bytes.copyWithin(at + col, at + col + count, at + col + count + move)
    this.setLength(row, len - count)
    return true
  }

  /**
   * `Ed_Untok` (:10874): program line `line` into display row `row`.
   *
   * The slot is cleared and marked editable first, so a row past the end of
   * the program is an empty editable line rather than whatever was there.
   * `Tk_EditL` then decides the flag, and the line is detokenised either way
   * -- a closed procedure is shown, it just cannot be typed on.
   */
  untok(row: number, prog: ProgramBuffer, line: number, table: TokenTable, opts: EdtokOptions = {}): void {
    this.setLength(row, 0)
    this.setEditable(row, true)
    const { at, found } = prog.findLine(line)
    if (!found) return
    this.setEditable(row, prog.isEditable(at))
    this.setText(row, detokLineBytes(prog.bytes, at, table, opts))
  }

  /**
   * `Ed_CHt` (:3762): every row moves down one, and row 0 is left alone.
   *
   * The caller fills it, because only the caller knows which program line
   * the window has just scrolled onto. A one-row window skips the move
   * (`cmp.w #1,Edt_WindTy(a4) / beq .Skip`), which falls out of the loop.
   */
  scrollDown(): void {
    this.bytes.copyWithin(SLOT, 0, this.rows * SLOT - SLOT)
  }

  /** `Ed_CBs` (:3820): every row moves up one, and the last is left alone */
  scrollUp(): void {
    this.bytes.copyWithin(0, SLOT, this.rows * SLOT)
  }

  /**
   * `.RetV1` in `Ed_DelLiCu` (:10531): row `row` goes, the rest come up.
   *
   * Unlike the two scrolls this one DOES clear what it leaves behind
   * (`clr.w -256(a2)`), so the last row is an empty editable line until the
   * caller detokenises the program line that has moved into it.
   */
  closeRow(row: number): void {
    const at = this.base(row)
    this.bytes.copyWithin(at, at + SLOT, this.rows * SLOT)
    this.setLength(this.rows - 1, 0)
  }

  /** `Ed_BufUntok` (:10846): every row of the window, from program line `top` */
  fill(top: number, prog: ProgramBuffer, table: TokenTable, opts: EdtokOptions = {}): void {
    for (let row = 0; row < this.rows; row++) this.untok(row, prog, top + row, table, opts)
  }
}
