/**
 * `Edt_`: one window onto a program, and the cycle that keeps the two halves
 * of it in step.
 *
 * A program is tokens and a line being typed is text, so the editor holds
 * both and converts at the edges. `Ed_Untok` (+Edit.s:10874) fills a display
 * row from a program line; the user types into the row; `Ed_TokCur` (:10729)
 * tokenises it back when the cursor leaves. `Edt_LEdited` is the dirty flag
 * that decides whether that last step has anything to do, and every command
 * that moves off the line calls `Ed_TokCur` first.
 *
 * The cursor is two pairs. `Edt_XCu`/`Edt_YCu` are where it is IN THE WINDOW,
 * `Edt_XPos`/`Edt_YPos` are what the window is scrolled to, and the program
 * line is the sum. `Ed_LCourant` (:11181) uses only `Edt_YCu`, because the
 * edit buffer is indexed by display row and not by program line.
 *
 * ## What is not here
 *
 * The cursor moves the machine's routines end with. `Ed_PKey` finishes on
 * `Ed_CDroite` and `Ed_Loca`; this class stops at the change to the buffer,
 * and ./commands.ts moves the cursor afterwards. The state below is what
 * ./display.ts reads, so nothing here draws either.
 */
import type { TokenTable } from '../tokens/stream'
import { detokLineBytes, tokeniseLine, type EdtokOptions } from '../tokens/edtok'
import { ED_MESSAGES } from '../runtime/edmessages.gen'
import { EMPTY_LINE_BYTES, type ProgramBuffer } from './buffer'
import { Block } from './block'
import { EditBuffer } from './editbuf'
import { UN, type UndoBuffer } from './undo'

/**
 * `Ed_Alert` (+Edit.s:7595): a message across the status line.
 *
 * It is thrown rather than returned because that is what the machine does
 * with it. `Ed_Alert` ends in `bra Ed_Loop`, not `rts`: the message goes in
 * `Edt_EtAlert`, `EtA_Alert` is raised, and the command that was running is
 * abandoned wherever it had got to. So the throw is the control flow, and
 * `edCall` in ./commands.ts is `Ed_Loop` catching it.
 *
 * None of these is an error. "Top of text" arrives when Home has WORKED.
 *
 * `code` is the `Ed_GetMessage` number, so it is checkable against the
 * shipped table: 183 is `Ed_NotEdit` (:9754), 199 `Ed_LToLong` (:9762), 202
 * `Ed_OofBuf` (:9792). The table is one-based and `ED_MESSAGES` is not.
 */
export class EditorAlert extends Error {
  /**
   * @param code the `Ed_GetMessage` number
   * @param duration `Ed_Alert`'s d0, which lands in `Edt_EtMess`. 100 is
   *   `Ed_Al100`'s and what most callers pass; the two ends of the text pass
   *   25 and Out of buffer space passes 200.
   */
  constructor(
    readonly code: number,
    readonly duration = 100,
  ) {
    super(ED_MESSAGES[code - 1] ?? `editor message ${code}`)
    this.name = 'EditorAlert'
  }
}

export class Edit {
  /** `Edt_XCu`, the cursor's column within the line */
  xCu = 0
  /** `Edt_YCu`, the cursor's row within the window */
  yCu = 0
  /** `Edt_XPos`, how far the window has scrolled sideways */
  xPos = 0
  /** `Edt_YPos`, the program line at the top of the window */
  yPos = 0
  /** `Edt_LEdited`, raised by anything that changes the line being typed */
  edited = 0

  /**
   * `Edt_WindTx`, the window's width in characters.
   *
   * `Ed_DrawWindows` (:11655) computes it as `(Ed_Sx - 16) / 8`, and the
   * editor screen is 640 wide (`.Ed_Sx`, +Editor_Config.s:58), so 78.
   * `Ed_CDroite` does NOT use it -- it scrolls at a hardcoded `WiTx-10`,
   * which is 70 because `WiTx` is the window structure's own offset 80.
   */
  windTx = 78

  /** `Edt_XBloc`/`Edt_YBloc`: the block's anchor, -1 for no block */
  xBloc = 0
  yBloc = -1

  /**
   * `Ed_Block`, the clipboard the anchor and the cursor cut and paste through.
   *
   * One per window here and one for the whole editor on the machine; ./block.ts
   * says what that costs. Assign the same `Block` to two windows to share it.
   */
  block = new Block()

  /**
   * `Ed_Insert` (+Editor_Config.s:90, default -1). On the machine this is one
   * flag for the whole editor rather than one per window, which is why
   * flipping it in a split view flips it in both halves.
   */
  insert = true

  /** `Ed_Tabs` (+Editor_Config.s:59): three spaces */
  tabs = 3

  /** `Edt_EtatAff`: which fields of the status line are stale (+Equ.s:1962) */
  etatAff = 0

  /** `Ed_SCallFlags`: what the command that just ran wants redrawn */
  callFlags = 0

  /** `Edt_YOldBloc`: the line the cursor was on when the last command began */
  yOldBloc = 0

  /** `Edt_EtAlert`: the message the status line is showing, 0 for none */
  alert = 0

  /** `Edt_EtMess`: how long it stays there */
  alertTime = 0

  constructor(
    readonly prog: ProgramBuffer,
    readonly buf: EditBuffer,
    readonly undo: UndoBuffer,
    readonly table: TokenTable,
    readonly opts: EdtokOptions = {},
  ) {}

  /** the program line under the cursor: `Edt_YPos + Edt_YCu` */
  get line(): number {
    return this.yPos + this.yCu
  }

  /** `Ed_LCourant` (:11181), as much of it as has a meaning without a screen */
  current(): { text: string; length: number; editable: boolean } {
    return { text: this.buf.text(this.yCu), length: this.buf.length(this.yCu), editable: this.buf.editable(this.yCu) }
  }

  /** `Ed_BufUntok` (:10846): every row of the window from `Edt_YPos` */
  fill(): void {
    this.buf.fill(this.yPos, this.prog, this.table, this.opts)
  }

  /**
   * `Ed_PKey` (+Edit.s:1790): one character into the line being typed.
   *
   * Below space it does nothing but redraw. A cursor past the end of the text
   * is pulled back to the end first, which is why typing in the middle of
   * nowhere lands at the end of the line rather than in a gap.
   *
   * The two modes part only in the middle of a line: at the end both just
   * append (`.EdL13`). Insert refuses at 250 with `Ed_LToLong`, where
   * `R_InsChar` at the same limit silently inserts what fits -- the same
   * number, two behaviours, in one file.
   *
   * DEFECT: the undo record goes in before the limit is checked. `Un_Debut`
   * is at `.EdL10a` and the `cmp.w #250,d0 / bcc Ed_LToLong` is inside
   * `.EdL11` below it, so a keystroke that raises Line too long still leaves
   * a CHAR record behind. Undoing it deletes a character the user did type.
   */
  pKey(ch: string, insert = true): void {
    const code = ch.charCodeAt(0)
    if (code < 32) return
    if (!this.buf.editable(this.yCu)) throw new EditorAlert(183)
    const len = this.buf.length(this.yCu)
    if (this.xCu > len) this.xCu = len
    const atEnd = this.xCu === len
    // `move.b #-1,4(a2)` first, and overwrite replaces it with what it covered
    const b4 = insert || atEnd ? 0xff : this.buf.text(this.yCu).charCodeAt(this.xCu)
    this.undo.record(UN.CHAR, this.xCu, this.line, b4, code)
    if (insert && !atEnd && len >= EditBuffer.MAX_TYPED) throw new EditorAlert(199, 50)
    if (insert || atEnd) this.buf.insert(this.yCu, this.xCu, ch)
    else this.buf.overwrite(this.yCu, this.xCu, ch)
    this.edited++
  }

  /**
   * `Ed_Delete` (:3565): the character under the cursor.
   *
   * `sub.w Edt_XCu(a4),d0 / subq.w #1,d0 / bmi CFin` -- nothing happens when
   * there is no character there, which is the guard `R_DelChar` relies on.
   */
  deleteChar(): void {
    const { length, text } = this.current()
    if (length - this.xCu - 1 < 0) return
    this.undo.record(UN.DELETE, this.xCu, this.line, 0, text.charCodeAt(this.xCu))
    this.buf.delete(this.yCu, this.xCu, 1)
    this.edited++
  }

  /**
   * `Ed_TokCur` (:10729) through `Ed_TokStok2` (:10745): the line being typed
   * back into the program.
   *
   * The line gains one only when the cursor is on the line PAST the last and
   * something was actually stored. `d2` is the caller's `seed` plus
   * `Tokenise`'s d0 -- 1 for a line with anything in it, 0 for an empty one
   * (`TokVide` :14705) -- plus `Ed_Stocke`'s "one more line" flag, and the
   * count moves only if the sum is non-zero. `Ed_Return` passes a seed of 1
   * so that splitting the last line always gains one, however empty the half
   * left behind is.
   *
   * The redisplay is not cosmetic. `Detok` writes the line back into the slot
   * in the editor's own spelling, so what the user typed is replaced by what
   * AMOS calls it, and the undo record holds both: the typed text to go back
   * to and the canonical text that replaced it.
   */
  tokCur(seed = 0): void {
    if (this.edited === 0) return
    this.edited = 0
    const typed = this.buf.text(this.yCu)
    let line: Uint8Array
    try {
      line = tokeniseLine(typed, this.table, this.opts)
    } catch {
      throw new EditorAlert(199, 50)
    }
    const content = seed + (line.length > EMPTY_LINE_BYTES ? 1 : 0)
    const at = this.line
    const r = this.prog.store(at, line)
    if (r.error === 1) throw new EditorAlert(202, 200)
    if (r.error === -1) throw new EditorAlert(183)
    let added = 0
    if (at === this.prog.lineCount && content + (r.added ? 1 : 0) !== 0) {
      added = 1
      this.prog.lineCount++
    }
    // `bsr Detok` back into the slot, then the undo record over both spellings
    const canonical = detokLineBytes(this.prog.bytes, r.at, this.table, this.opts)
    this.buf.setText(this.yCu, canonical)
    this.undo.recordToken(this.xCu, at, added, bytes(typed), bytes(canonical))
  }
}

const bytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)
