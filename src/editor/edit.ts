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
import type { Block } from './block'
import { EditBuffer } from './editbuf'
import { UN, type UndoBuffer } from './undo'
import type { EditorFS } from './files'
import type { Macro, MacroTape } from './macros'
import type { EditorDialogues } from './search'
import { Editor } from './windows'

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
   * What `Edt_EtAlert` is really given: a0, a pointer to the characters.
   *
   * Almost every caller reaches `Ed_Alert` through `Ed_GetMessage`, which
   * makes a0 out of `Ed_Messages` and the code. `Ed_Check1.3` (:8449) does
   * not -- it calls `Ed_GetMessageA0` against `Ed_TstMessages`, so its
   * message is 49 in a table this one has never indexed.
   */
  readonly text: string

  /**
   * @param code the `Ed_GetMessage` number
   * @param duration `Ed_Alert`'s d0, which lands in `Edt_EtMess`. 100 is
   *   `Ed_Al100`'s and what most callers pass; the two ends of the text pass
   *   25 and Out of buffer space passes 200.
   * @param text the characters, when they did not come from `Ed_Messages`
   */
  constructor(
    readonly code: number,
    readonly duration = 100,
    text?: string,
  ) {
    super(text ?? ED_MESSAGES[code - 1] ?? `editor message ${code}`)
    this.text = this.message
    this.name = 'EditorAlert'
  }
}

/**
 * `Ed_DError` (+Edit.s:14019): the command died on the disc.
 *
 * The same control flow as `EditorAlert` -- it ends in `bra Ed_Loop` and the
 * command is abandoned -- but the message comes from a different table. The
 * machine reads `_LVOIoErr`, looks it up in `ErDisked` (:14050) and indexes
 * `Ed_RunMessages`, which is the interpreter's list and not the editor's.
 *
 * DEVIATION: this port has not generated that table, so what is carried is
 * the AmigaDOS code itself. 0 means the filesystem refused and did not say
 * why, which is every failure `EditorFS`'s booleans can report.
 */
export class DiskError extends Error {
  constructor(readonly dos = 0) {
    super(`disc error ${dos}`)
    this.name = 'DiskError'
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

  /**
   * `Edt_WindTy`, the window's height in text rows, which is the edit
   * buffer's row count and not a second number.
   *
   * `Ed_DrawWindows` (:11844) hands each visible window `WindTy` rows of the
   * one `Ed_BufE` allocation, so the two cannot disagree. Zero is a legal
   * value and means the window is rolled up to its two bars, which is what
   * Enlarge Window flips a window to.
   */
  get windTy(): number {
    return this.buf.rows
  }

  set windTy(rows: number) {
    this.buf.resize(rows)
  }

  /** `Edt_WindOldTy`: the height to go back to when Enlarge Window unrolls it */
  windOldTy = 0

  /**
   * `Edt_Hidden`: 0 has a screen area, 1 has been asked to give it up, 2 has.
   *
   * Every walk of the list tests `tst.b`, so 1 and 2 are both hidden.
   * ./windows.ts says which routine moves it between them.
   */
  hidden: 0 | 1 | 2 = 0

  /** `Edt_First`: the topmost visible window. `Edt_WFirstLast` works it out */
  first = false

  /** `Edt_Last`: the bottom one. Both, and the window is alone on the screen */
  last = false

  /** `Edt_Order`: its place down the screen, from 1. Hidden windows keep the old one */
  order = 0

  /**
   * `Edt_Window`: the zone number its screen area was opened under, `Order * 8`.
   *
   * Zero means it has none. `Edt_GetAd` turns a click back into a window with
   * it, which is the only reason it survives here.
   */
  window = 0

  /** `Edt_LinkPrev` and `Edt_LinkNext`: the split-view chain over ONE program */
  linkPrev: Edit | null = null
  linkNext: Edit | null = null

  /** `Edt_LinkScroll`: the window this one drags along when its cursor moves */
  linkScroll: Edit | null = null

  /** `Edt_LinkYOld`: the program line the scroll link last saw the cursor on */
  linkYOld = 0

  /** `Edt_LinkFlag`: this window is already inside `Ed_LinkeScroll`'s recursion */
  linkFlag = false

  /** `Edt_PrgDelete`: throw the program away when it stops running */
  prgDelete = false

  /** `Edt_XBloc`/`Edt_YBloc`: the block's anchor, -1 for no block */
  xBloc = 0
  yBloc = -1

  /** `Edt_EtatAff`: which fields of the status line are stale (+Equ.s:1962) */
  etatAff = 0

  /** `Edt_YOldBloc`: the line the cursor was on when the last command began */
  yOldBloc = 0

  /** `Edt_EtAlert`: the message the status line is showing, 0 for none */
  alert = 0

  /**
   * The characters `Edt_EtAlert` points at, when `alert` alone does not find
   * them. Empty means `Ed_Messages` at `alert`, which is every other caller.
   */
  alertText = ''

  /** `Edt_EtMess`: how long it stays there */
  alertTime = 0

  /**
   * `Prg_StBas` and the rest of the program structure.
   *
   * Not readonly, because `Prg_ChgTTexte` (+Verif.s:4757) frees the old
   * allocation and makes a new one. `Ed_GetPlace` (+Edit.s:9915) does that
   * when a file will not fit, and the program in the old buffer is gone.
   * `Edt_Prg` is a POINTER: Split View gives two windows the same one.
   */
  prog: ProgramBuffer

  /* ---- what `a5` holds, reached through `Edt_` ---------------------------- */

  /** `Ed_Block(a5)`: the editor's one clipboard, shared by every window */
  get block(): Block {
    return this.editor.block
  }

  /** `Ed_SchBuf(a5)`: what Search is looking for */
  get schBuf(): string {
    return this.editor.schBuf
  }

  set schBuf(v: string) {
    this.editor.schBuf = v
  }

  /** `Ed_RepBuf(a5)`: what it is replaced with */
  get repBuf(): string {
    return this.editor.repBuf
  }

  set repBuf(v: string) {
    this.editor.repBuf = v
  }

  /** `Ed_SchMode(a5)`: the four flag gadgets of ./search.ts's `SM` */
  get schMode(): number {
    return this.editor.schMode
  }

  set schMode(v: number) {
    this.editor.schMode = v
  }

  /** `EdMa_List(a5)`: the macros, most recently made first */
  get macros(): Macro[] {
    return this.editor.macros
  }

  set macros(v: Macro[]) {
    this.editor.macros = v
  }

  /** `EdMa_Play(a5)`: where playback has got to, null for none */
  get macroPlay(): { keys: Uint8Array; at: number } | null {
    return this.editor.macroPlay
  }

  set macroPlay(v: { keys: Uint8Array; at: number } | null) {
    this.editor.macroPlay = v
  }

  /** `EdMa_Tape(a5)`: the buffer being recorded into, null for none */
  get macroTape(): MacroTape | null {
    return this.editor.macroTape
  }

  set macroTape(v: MacroTape | null) {
    this.editor.macroTape = v
  }

  /** `EdMa_Change(a5)`, which nothing reads. ./windows.ts says why that matters */
  get macroChange(): boolean {
    return this.editor.macroChange
  }

  set macroChange(v: boolean) {
    this.editor.macroChange = v
  }

  /** `EdMa_Changed(a5)`: raised by Load As, and read by Quit */
  get macroChanged(): boolean {
    return this.editor.macroChanged
  }

  set macroChanged(v: boolean) {
    this.editor.macroChanged = v
  }

  /** `Name1(a5)`: the filename every disc command works through */
  get name1(): string {
    return this.editor.name1
  }

  set name1(v: string) {
    this.editor.name1 = v
  }

  /** `Dia_LastKey`: the keystroke the last requester was answered with */
  get lastKey(): number {
    return this.editor.lastKey
  }

  set lastKey(v: number) {
    this.editor.lastKey = v
  }

  /** `Sys_Pathname(a5)`: the AMOSPro system directory */
  get sysPath(): string {
    return this.editor.sysPath
  }

  set sysPath(v: string) {
    this.editor.sysPath = v
  }

  /** `Ed_SvBak`: rename the old file to `.Bak` before saving over it */
  get svBak(): boolean {
    return this.editor.svBak
  }

  set svBak(v: boolean) {
    this.editor.svBak = v
  }

  /** `DosBase`: the filesystem, null for none */
  get fs(): EditorFS | null {
    return this.editor.fs
  }

  set fs(v: EditorFS | null) {
    this.editor.fs = v
  }

  /** the `Ed_TstMessages` code the last Test stopped on, -1 for none */
  get testError(): number {
    return this.editor.testError
  }

  set testError(v: number) {
    this.editor.testError = v
  }

  /** `Ed_DError`: the AmigaDOS code the last command died on, -1 for none */
  get diskError(): number {
    return this.editor.diskError
  }

  set diskError(v: number) {
    this.editor.diskError = v
  }

  /** the requesters, which the machine draws and this port asks for */
  get dialogues(): EditorDialogues | null {
    return this.editor.dialogues
  }

  set dialogues(v: EditorDialogues | null) {
    this.editor.dialogues = v
  }

  /** `Ed_Insert`: config, so flipping it in one half of a split flips the other */
  get insert(): boolean {
    return this.editor.insert
  }

  set insert(v: boolean) {
    this.editor.insert = v
  }

  /** `Ed_Tabs`: three spaces */
  get tabs(): number {
    return this.editor.tabs
  }

  set tabs(v: number) {
    this.editor.tabs = v
  }

  /** `T_Actualise`'s `BitControl`: Ctrl-C is down */
  get abort(): boolean {
    return this.editor.abort
  }

  set abort(v: boolean) {
    this.editor.abort = v
  }

  /** `Ed_SCallFlags`: what the command that just ran wants redrawn */
  get callFlags(): number {
    return this.editor.callFlags
  }

  set callFlags(v: number) {
    this.editor.callFlags = v
  }

  /**
   * `Edt_OpWindow`'s two allocations (:11253) and the link that follows them.
   *
   * A window links in after whichever one is current, which is what the
   * machine does because `Edt_Next` is a forward chain with no tail. The
   * program's window count goes up here and `Edt_DelWindow` brings it down.
   *
   * `Edt_Current` is set by `Edt_OpWindow` only for a VISIBLE window; here the
   * first window in the list takes it whatever it is, because an editor whose
   * only window is hidden is not a state the machine can reach either.
   */
  constructor(
    prog: ProgramBuffer,
    readonly buf: EditBuffer,
    readonly undo: UndoBuffer,
    readonly table: TokenTable,
    readonly opts: EdtokOptions = {},
    readonly editor: Editor = new Editor(),
  ) {
    this.prog = prog
    prog.edited++
    this.editor.addProgram(prog)
    this.editor.link(this.editor.current, this)
    if (this.editor.current === null) this.editor.current = this
  }

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
    // `bsr Ed_Stocke / bne Ed_OofBuf` (:10763) tests neither sign nor value,
    // so `StoClo`'s -1 reports Out of buffer space and not Line not editable
    if (r.error !== 0) throw new EditorAlert(202, 200)
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
