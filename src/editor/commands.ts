/**
 * `JFonc` (+Edit.s:3151): the 184 commands the editor can be told to run.
 *
 * A keystroke reaches one through `Ed_Ky2Fonc` (./keymap.ts); a menu entry, a
 * macro and the ZAP remote control reach the same table by number. `Ed_FCall`
 * (:2565) is the one door, and it reads `FlagFonc` (:3347) before it opens:
 * that byte says what the command will need redrawn and whether it may run at
 * all on the line the cursor is sitting on.
 *
 * ## What is here
 *
 * The movement and editing commands, 1 to 37, the marks (39 to 58), the block
 * (59 to 63, 72, 181), the undo replay (65, 94), search and replace (66 to 68,
 * 99 to 101), the disc (33 to 35, 80, 85, 97, 98, 152) and the macros (106 to
 * 110, 143, 144), plus Delete to start of line (64) and Insert mode (75).
 *
 * The rest need something this port has not built yet: a second window (61,
 * 84, 88, 91 to 96, 102) or the interpreter (77, 78). `COMMANDS` has no entry
 * for them and `edCall` throws rather than silently doing nothing, so a key
 * map that reaches one says which.
 *
 * ## What a command does NOT do here
 *
 * Draw. `Ed_Loca`, `Ed_EALiCu`, `Ed_AffBuf` and `Ed_EALigne` are the four
 * routines the machine ends a command with, and all four only put on screen
 * what the state already says. ./display.ts reads that state afterwards.
 * `Ed_NewBuf` is the exception and is NOT display: it detokenises the whole
 * window out of the program, so it is `Edit.fill()` and it is called.
 */
import { T } from '../tokens/stream'
import { detokLineBytes, tokeniseLine } from '../tokens/edtok'
import { TK } from '../tokens/edtok'
import { EMPTY_LINE_BYTES, ProgramBuffer } from './buffer'
import { BF } from './block'
import { DiskError, Edit, EditorAlert } from './edit'
import { EditBuffer } from './editbuf'
import { UN, type UndoRecord } from './undo'
import { FLAG_FONC, ED_ROUTINES } from './keymap.gen'
import { keyToFunc, type EdKey } from './keymap'
import {
  findMacro,
  macroKeys,
  newTape,
  packKey,
  readMacroFile,
  stopTape,
  tapeKey,
  unpackKey,
  writeMacroFile,
  type KeyLong,
} from './macros'
import { SM, SM_TURBO, repBuffer, schBack, schFront, type Confirm } from './search'
import { ED_SYSTEME } from '../runtime/edmessages.gen'
import {
  EMPTY_BANKS,
  H_BLOCK,
  PRG,
  bakName,
  fileName,
  programSource,
  readProgramFile,
  writeProgramFile,
  type EditorFS,
} from './files'

/**
 * The commands this port implements, by the number +Edit.s gives them.
 *
 * Numbered from 1, which is how every comment in the source and every entry
 * in `ED_ROUTINES` is numbered. `Ed_FCall` itself counts from 0; see
 * ./keymap.ts for why both numberings exist.
 */
export const ED = {
  CUR_UP: 1,
  CUR_DOWN: 2,
  CUR_LEFT: 3,
  CUR_RIGHT: 4,
  TOP_PAGE: 5,
  BOTTOM_PAGE: 6,
  WORD_LEFT: 7,
  WORD_RIGHT: 8,
  PAGE_UP: 9,
  PAGE_DOWN: 10,
  LINE_START: 11,
  LINE_END: 12,
  TEXT_TOP: 17,
  TEXT_BOTTOM: 18,
  RETURN: 19,
  BACKSPACE: 20,
  DELETE: 21,
  CLEAR_LINE: 22,
  DELETE_LINE: 23,
  TAB: 24,
  SHIFT_TAB: 25,
  INSERT_LINE: 29,
  DELETE_TO_END: 30,
  PREV_LABEL: 31,
  NEXT_LABEL: 32,
  DELETE_WORD: 36,
  BACK_WORD: 37,
  SET_MARK_0: 39,
  GOTO_MARK_0: 49,
  UNDO: 65,
  BLOCK_ON: 59,
  BLOCK_FORGET: 60,
  BLOCK_CUT: 62,
  BLOCK_PASTE: 63,
  BLOCK_STORE: 72,
  BLOCK_ALL: 181,
  LOAD: 33,
  SAVE_AS: 34,
  SAVE: 35,
  NEW: 80,
  MERGE_ASCII: 85,
  BLOCK_SAVE_ASCII: 97,
  BLOCK_SAVE: 98,
  SAVE_AS_NAME: 152,
  MACRO_NEW: 106,
  MACRO_DEL: 107,
  MACRO_DEL_ALL: 108,
  MACRO_LOAD_AS: 109,
  MACRO_SAVE_AS: 110,
  MACRO_LOAD_DEFAULT: 143,
  MACRO_SAVE_DEFAULT: 144,
  SEARCH: 66,
  SEARCH_NEXT: 67,
  SEARCH_PREV: 68,
  REPLACE: 99,
  REPLACE_NEXT: 100,
  REPLACE_PREV: 101,
  DELETE_TO_START: 64,
  FLIP_INSERT: 75,
  REDO: 94,
} as const

/**
 * `FlagFonc`'s bits, off the assembler's own comment above the table.
 *
 * Bits 3 and 4 are never set in the shipped table and the comment does not
 * name them.
 */
export const FLAG = {
  /** bit 0: the whole window needs redrawing */
  BUFFER: 0x01,
  /** bit 1: only the line under the cursor does */
  LINE: 0x02,
  /** bit 2: refuse if the cursor is on a closed procedure */
  CLOSED: 0x04,
  /** bit 5: may be recorded into a macro */
  MACRO: 0x20,
  /** bit 6: takes a command line string from the caller */
  COMMAND: 0x40,
  /** bit 7: the ZAP remote control may call it */
  ZAP: 0x80,
} as const

/** `FlagFonc[cmd]` for 1-based command `cmd` */
export function flagsOf(cmd: number): number {
  const f = FLAG_FONC[cmd - 1]
  if (f === undefined) throw new RangeError(`no editor command ${cmd}`)
  return f
}

/** the `JFonc` routine name, which is what makes a command number checkable */
export function routineOf(cmd: number): string {
  const r = ED_ROUTINES[cmd - 1]
  if (r === undefined) throw new RangeError(`no editor command ${cmd}`)
  return r
}

/* ---- the pieces the commands are built out of --------------------------- */

/** `Ed_LCourant` (:11181) with the `bne Ed_NotEdit` its callers follow it with */
function mustEdit(e: Edit): void {
  if (!e.buf.editable(e.yCu)) throw new EditorAlert(183)
}

/** `Une_Lettre` (:4152): a digit, a letter, or anything from 128 up */
function isWordChar(c: number): boolean {
  return (
    (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x80 && c <= 0xff)
  )
}

/**
 * `Ed_Cent` (:10059): scroll sideways until the cursor is in the window.
 *
 * One column at a time in either direction, so the cursor ends up against the
 * edge it went out of rather than in the middle, whatever the routine is
 * called.
 */
function cent(e: Edit): void {
  const d = e.xCu - e.xPos
  if (d < 0) e.xPos += d
  else if (d >= e.windTx) e.xPos += d - e.windTx + 1
}

/**
 * `Ed_SetX` (:10105): put the cursor at column `x` and pick a scroll for it.
 *
 * Not `Ed_Cent`: this one snaps `Edt_XPos` to a multiple of 20, walking up in
 * twenties while what is left is 60 or more. Under 70 it does not scroll at
 * all, which is the same 70 `Ed_CDroite` uses.
 */
function setX(e: Edit, x: number): void {
  e.xCu = x
  let pos = 0
  let left = x
  while (left >= 70) {
    do {
      pos += 20
      left -= 20
    } while (left >= 60)
  }
  e.xPos = pos
}

/**
 * `Ed_SetY` (:10124): put the cursor on program line `y`.
 *
 * The line past the last is reachable (`cmp.w Prg_NLigne(a6),d0 / bls`), and
 * that is deliberate: it is the line a program grows onto.
 */
function setY(e: Edit, y: number): void {
  const line = Math.min(y, e.prog.lineCount)
  const d = line - e.yPos
  if (d < 0) e.yPos += d
  else if (d >= e.buf.rows) e.yPos += d - e.buf.rows + 1
  e.yCu = line - e.yPos
}

/** `Ed_GotoY` (:10096) */
function gotoY(e: Edit, y: number): void {
  if (e.line === y) return
  e.tokCur()
  const was = e.yPos
  setY(e, y)
  if (e.yPos !== was) e.fill()
}

/** `Ed_GotoX` (:10085) */
function gotoX(e: Edit, x: number): void {
  if (x === e.xCu) return
  setX(e, x)
}

/**
 * `Ed_AutoMarks` (:4192): push where the cursor was onto marks 0 to 3.
 *
 * Four deep, and every long jump pushes. So marks 0 to 3 are a jump-back
 * history and only 4 to 9 are the user's, even though Set Mark will happily
 * write into the first four and the next Bottom of text will shift it away.
 */
function autoMarks(e: Edit): void {
  const now = (((e.line & 0xffff) * 0x10000) >>> 0) + 0xff00 + (e.xCu & 0xff)
  if (e.prog.marks[0] === now) return
  for (let i = 3; i > 0; i--) e.prog.marks[i] = e.prog.marks[i - 1]!
  e.prog.marks[0] = now
}

/**
 * `R_MotGoch` (:3937): the column the word to the left of the cursor starts at.
 *
 * Back over spaces if it starts on one, then back over word characters, then
 * forward one. A cursor past the end of the text answers the end
 * (`cmp.w d0,d1 / bls .MGo0`) without looking at anything.
 */
function wordLeft(e: Edit): number {
  const { text, length } = e.current()
  if (e.xCu > length) return length
  let i = e.xCu
  const at = (n: number): number => text.charCodeAt(n) & 0xff
  if (--i < 0) return 0
  if (at(i) === 32) {
    while (--i >= 0 && at(i) === 32);
    if (i < 0) return 0
  }
  // .MGo2 tests the character BEFORE the one that stopped the space run, so
  // whatever ended it is stepped over without being asked what it is
  while (--i >= 0 && isWordChar(at(i)));
  return i + 1
}

/**
 * `R_MotDroi` (:3960): the column the next word starts at.
 *
 * Forward over word characters, then over one non-word character and any run
 * of spaces after it. The index runs one ahead of the character being read
 * (`addq.w #1,d1` comes before `move.b (a1)+,d2`), so it lands past the
 * character that stopped it.
 */
function wordRight(e: Edit): number {
  const { text, length } = e.current()
  const at = (n: number): number => text.charCodeAt(n) & 0xff
  let i = e.xCu
  for (;;) {
    i++
    if (i >= length) return i
    if (isWordChar(at(i - 1))) continue
    if (at(i) !== 32) return i
  }
}

/**
 * `R_DelChar` (:1880) behind an undo record over the same run (`Un_CLine`).
 *
 * `Edt_LEdited` is raised INSIDE `R_DelChar`, at `.Del2`, and only when the
 * guard let the delete through. So it is here and not in the three commands
 * that call it: none of `Ed_DelMot`, `Ed_BackMot` or `Ed_DelDebut` touches
 * the flag itself, and without it the window would change and the program
 * would not.
 */
function cutRun(e: Edit, col: number, count: number): void {
  const { text } = e.current()
  e.undo.recordLine(UN.CLEAR, e.xCu, e.line, bytes(text.slice(col, col + count)))
  if (e.buf.delete(e.yCu, col, count)) e.edited++
}

const bytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)

/* ---- 1 to 12: the cursor ------------------------------------------------ */

/** `Ed_ChtT` (:3739), the tokenise-free entry `Ed_Join` and `Ed_CHaut` share */
function curUp(e: Edit): void {
  if (e.yCu !== 0) {
    e.yCu--
    return
  }
  if (e.yPos === 0) throw new EditorAlert(200, 25) // Ed_CHtE, Top of text
  e.yPos--
  e.buf.scrollDown()
  e.buf.untok(0, e.prog, e.yPos, e.table, e.opts)
}

/** `Ed_CBasT` (:3793) */
function curDown(e: Edit): void {
  if (e.line >= e.prog.lineCount) throw new EditorAlert(201, 25) // Ed_CBasE, Bottom of text
  if (e.yCu < e.buf.rows - 1) {
    e.yCu++
    return
  }
  e.yPos++
  e.buf.scrollUp()
  e.buf.untok(e.buf.rows - 1, e.prog, e.yPos + e.buf.rows - 1, e.table, e.opts)
}

/**
 * `Ed_CGauche` (:3842) and `Ed_CDroite` (:3866).
 *
 * Neither calls `Ed_TokCur`, because neither leaves the line. Both scroll one
 * column at a time and both use a constant rather than `Edt_WindTx`: left of
 * 15 from the window's edge, or 70 columns into it. The 70 is written
 * `WiTx-10`, and `WiTx` is the window structure's offset 80 (+Equ.s:668), so
 * the scroll margin is the window's own size read as a number.
 */
function curLeft(e: Edit): void {
  if (e.xCu === 0) return
  e.xCu--
  if (e.xCu - e.xPos < 15 && e.xPos !== 0) e.xPos--
}

function curRight(e: Edit): void {
  if (e.xCu >= EditBuffer.MAX_TYPED) return
  e.xCu++
  if (e.xCu - e.xPos >= 70) e.xPos++
}

/* ---- 19 to 37: the line ------------------------------------------------- */

/**
 * `Ed_Join` (:10553): backspace at column 0 pulls the line onto the one above.
 *
 * It only ever joins WITHIN the window (`tst.w Edt_YCu(a4) / beq .Out`), so
 * backspacing at the top row does nothing at all rather than scrolling up
 * first. Undo is suppressed while it works and one JOIN record written at the
 * end, because otherwise the delete and the cursor move would each leave one.
 */
function join(e: Edit): void {
  if (e.yCu === 0 || e.xCu !== 0) return
  e.undo.suppressed++

  const here = e.current()
  const above = e.buf.length(e.yCu - 1)
  if (here.length !== 0 && !e.buf.editable(e.yCu - 1)) throw new EditorAlert(183)
  if (above + here.length >= EditBuffer.MAX_TYPED) throw new EditorAlert(199, 50)

  e.buf.setText(e.yCu - 1, e.buf.text(e.yCu - 1) + here.text)
  e.buf.setText(e.yCu, '')

  const deleted = deleteLineHere(e)
  if (deleted !== 0) {
    // the line was the last one, so nothing came off the program. If what is
    // now the last line is an empty instruction, take it out instead
    const n = e.prog.lineCount
    if (n !== 0) {
      const { at, found } = e.prog.findLine(n - 1)
      if (found && e.prog.sizeOfLine(at) === EMPTY_LINE_BYTES && e.prog.bytes[at + 2] === 0 && e.prog.bytes[at + 3] === 0) {
        e.prog.deleteLine(n - 1)
      }
    }
  }

  curUp(e)
  e.edited++
  e.xCu = above
  cent(e)

  e.undo.suppressed--
  e.undo.recordLine(UN.JOIN, e.xCu, e.line, bytes(e.current().text))
}

/** `Ed_DelLiCu` (:10504): the program line goes, and the window closes over it */
function deleteLineHere(e: Edit): number {
  const at = e.line
  mustEdit(e)
  const was = e.xCu
  e.xCu = 0
  e.undo.recordLine(UN.DLINE, e.xCu, at, bytes(e.current().text))
  e.xCu = was

  const r = e.prog.deleteLine(at)
  if (r === 0) {
    e.buf.closeRow(e.yCu)
    e.buf.untok(e.buf.rows - 1, e.prog, e.yPos + e.buf.rows - 1, e.table, e.opts)
  }
  return r
}

/**
 * `Ed_Return` (:10617): the text right of the cursor becomes the next line.
 *
 * The half being carried down goes into the program buffer's own free space
 * at `Prg_StMini`, which is why splitting a line needs 260 bytes free and
 * says Out of buffer space when it does not have them. This port carries it
 * in a string and checks the same distance, since the space is real: the
 * tokenise that follows writes into the buffer from the other end.
 *
 * The line count is read BEFORE the tokenise and compared after. A tokenise
 * that appended a line has already done the insert, and doing it again would
 * leave a blank line behind.
 */
function returnKey(e: Edit): void {
  if (e.xCu === 0) {
    insertLine(e)
    curDown(e)
    e.xCu = 0
    cent(e)
    return
  }
  if (e.prog.free() <= 260) throw new EditorAlert(202, 200)
  if (!e.buf.editable(e.yCu)) {
    // .PaEd: a closed procedure is not split, the cursor just moves past it
    curDown(e)
    e.xCu = 0
    cent(e)
    insertLine(e)
    return
  }

  const { text, length } = e.current()
  e.undo.recordLine(UN.SPLIT, e.xCu, e.line, bytes(text))
  e.undo.suppressed++

  const carried = text.slice(Math.min(e.xCu, length))
  e.buf.setText(e.yCu, text.slice(0, Math.min(e.xCu, length)))

  const before = e.prog.lineCount
  e.edited++
  e.tokCur(1)

  curDown(e)
  e.xCu = 0
  cent(e)
  if (before === e.prog.lineCount) insertLine(e)

  e.buf.setEditable(e.yCu, true)
  e.buf.setText(e.yCu, carried)
  e.edited++
  e.undo.suppressed--
}

/** `Ed_InsLine` (:10700): an empty line in front of the cursor */
function insertLine(e: Edit): void {
  e.tokCur()
  const empty = Uint8Array.of(EMPTY_LINE_BYTES / 2, 0, 0, 0)
  const r = e.prog.store(e.line, empty, true)
  if (r.error === 1) throw new EditorAlert(202, 200)
  e.undo.record(UN.ILINE, e.xCu, e.line)
  e.prog.lineCount++
  e.fill()
}

/** `Ed_EffLigne` (:3578): the whole line, kept for undo */
function clearLine(e: Edit): void {
  e.edited++
  e.xCu = 0
  const { text } = e.current()
  e.buf.setText(e.yCu, '')
  e.undo.recordLine(UN.CLEAR, e.xCu, e.line, bytes(text))
  cent(e)
}

/** `Ed_DelFin` (:3592): from the cursor to the end of the line */
function deleteToEnd(e: Edit): void {
  e.edited++
  const { text, length } = e.current()
  if (e.xCu >= length) return
  e.undo.recordLine(UN.CLEAR, e.xCu, e.line, bytes(text.slice(e.xCu)))
  e.buf.setText(e.yCu, text.slice(0, e.xCu))
}

/**
 * `Ed_DelDebut` (:3608): from the start of the line to the cursor.
 *
 * `cmp.w d0,d1 / bcc .Skip / move.w d1,d0` clamps the count to the line, so a
 * cursor past the end deletes the whole line rather than reaching past it.
 */
function deleteToStart(e: Edit): void {
  const { length } = e.current()
  if (e.xCu === 0) return
  const count = Math.min(e.xCu, length)
  e.xCu = 0
  cutRun(e, 0, count)
}

/** `Ed_DelMot` (:3624): from the cursor to the start of the next word */
function deleteWord(e: Edit): void {
  const to = wordRight(e)
  if (to <= e.xCu) return
  const count = to - e.xCu
  if (e.xCu >= e.current().length) return
  cutRun(e, e.xCu, count)
}

/** `Ed_BackMot` (:3646): back to the start of this word, then delete forward */
function backWord(e: Edit): void {
  const to = wordLeft(e)
  if (to >= e.xCu) return
  e.xCu = to
  cent(e)
  deleteWord(e)
}

/**
 * `Ed_Tab` (:3659): the whole line moves right by `Ed_Tabs`.
 *
 * Not an insert at the cursor. It opens `Ed_Tabs` spaces at column 0 whatever
 * column the cursor is in, and moves the cursor with the text. The limit is
 * `cmp.w #250,d0 / bcc Ed_LToLong`, so a line that would not fit refuses
 * rather than being trimmed the way `R_InsChar` trims.
 */
function tab(e: Edit): void {
  const { text, length } = e.current()
  if (length + e.tabs >= EditBuffer.MAX_TYPED) throw new EditorAlert(199, 50)
  e.buf.setText(e.yCu, ' '.repeat(e.tabs) + text)
  e.xCu += e.tabs
  e.edited++
  cent(e)
}

/**
 * `Ed_ShTab` (:3686): up to `Ed_Tabs` leading spaces come off.
 *
 * Fewer if the line has fewer, and none at all if it starts with something
 * else, so it is not the inverse of Tab on a line that was never indented.
 */
function shiftTab(e: Edit): void {
  const { text } = e.current()
  let n = 0
  while (n < e.tabs && text.charAt(n) === ' ') n++
  if (n === 0) return
  e.buf.setText(e.yCu, text.slice(n))
  e.xCu = Math.max(0, e.xCu - n)
  e.edited++
  cent(e)
}

/* ---- 17, 18, 31, 32: the long jumps ------------------------------------- */

/** `Ed_HTex` (:4079). It ends on `Ed_CHtE`, so arriving at the top says so */
function textTop(e: Edit): void {
  e.yPos = 0
  e.xPos = 0
  e.yCu = 0
  e.xCu = 0
  e.fill()
  throw new EditorAlert(200, 25)
}

/** `Ed_BTex` (:4094): the last line, half a window from the top */
function textBottom(e: Edit): void {
  const pos = Math.max(0, e.prog.lineCount - (e.buf.rows >> 1))
  e.yPos = pos
  e.yCu = e.prog.lineCount - pos
  e.xPos = 0
  e.xCu = 0
  e.fill()
  throw new EditorAlert(201, 25)
}

/**
 * `Ed_NLab` (:10175): the nearest `Procedure` or label line either side.
 *
 * It walks the whole program from line 0 every time, counting, and keeps the
 * last one before the cursor and the first one after. There is no index; a
 * program with no labels at all is a full walk for nothing.
 */
function nearestLabels(e: Edit): { before: number; after: number } {
  const here = e.line
  let before = 0
  let after = -1
  let at = e.prog.findLine(0).at
  let n = -1
  for (;;) {
    const size = e.prog.sizeOfLine(at)
    if (size === 0) break
    n++
    const id = (e.prog.bytes[at + 2]! << 8) | e.prog.bytes[at + 3]!
    if (id === TK.PROCEDURE || id === T.LABEL) {
      if (n > here) {
        after = n
        break
      }
      if (n < here) before = n
    }
    at += size
  }
  return { before, after: after < 0 ? 0 : after }
}

/** `NLb1` (:4121), the tail both label commands share */
function gotoLabel(e: Edit, line: number): void {
  if (line === 0) return textTop(e)
  if (line >= e.prog.lineCount) return textBottom(e)
  autoMarks(e)
  const d = line - e.yCu
  if (d < 0) {
    e.yCu = line
    e.yPos = 0
  } else {
    e.yPos = d
  }
  e.xCu = 0
  e.fill()
}

/* ---- 59 to 63, 72 and 181: the block ------------------------------------ */

/** the block's two corners, in order */
interface Limits {
  y0: number
  y1: number
  x0: number
  x1: number
}

/**
 * `Ed_BlocLimits` (:6600): the anchor and the cursor, earlier one first.
 *
 * One corner is `Edt_XBloc`/`Edt_YBloc`, the other is the cursor, and `.Sw`
 * swaps them when the cursor is the earlier.
 */
function blocLimits(e: Edit): Limits {
  if (e.yBloc < 0) throw new EditorAlert(6) // Ed_BlocWhat, "What block?"
  let y0 = e.yBloc
  let y1 = e.line
  let x0 = e.xBloc
  let x1 = e.xCu
  if (y1 < y0 || (y1 === y0 && x1 < x0)) {
    ;[y0, y1] = [y1, y0]
    ;[x0, x1] = [x1, x0]
  }
  return { y0, y1, x0, x1 }
}

/**
 * `Ed_BlockLimits` (:5920), which is `Ed_BlocLimits` plus `.L0`.
 *
 * Two routines whose labels differ by one letter, twenty lines of identical
 * arithmetic apart, and one thing between them: this one clamps the end to
 * the last line, and a clamped end takes the column to 0 because there is no
 * half of a line that does not exist. The block commands call this one and
 * the turbo Replace calls the other, so a Replace All can be handed an end
 * line past the program and a Block Cut cannot.
 */
function blockLimits(e: Edit): Limits {
  const l = blocLimits(e)
  if (l.y1 >= e.prog.lineCount) {
    l.y1 = e.prog.lineCount
    l.x1 = 0
  }
  return l
}

/**
 * The text of program line `n` as `Ed_BlockCopyA0` gets at it.
 *
 * Two ways in, and which one it takes matters. If `n` is the line the cursor
 * is on it reads the SLOT, because that is where the characters the user has
 * typed but not left yet are; otherwise it detokenises the program. Null back
 * means the line is a closed procedure and the caller has a `.Proc` arm for
 * it; undefined means there is no such line.
 */
function lineText(e: Edit, n: number): string | null | undefined {
  if (n === e.line && e.buf.editable(e.yCu)) {
    const slot = e.buf.text(e.yCu)
    // `tst.w d0 / beq .NoBloc`: an empty slot under the cursor is not an
    // empty first line, it is no block at all
    if (slot.length !== 0) return slot
  }
  const { at, found } = e.prog.findLine(n)
  if (!found) return undefined
  if (!e.prog.isEditable(at)) return null
  return detokLineBytes(e.prog.bytes, at, e.table, e.opts)
}

/**
 * `Ed_BlockCopyA0` (:6112): gather the block. False is `.NoBloc`.
 *
 * The two ends are clamped to the lines they are on rather than refused, so
 * dragging a block past the end of a short line takes the whole of it.
 */
function blockCopy(e: Edit): boolean {
  const lim = blockLimits(e)
  const { y0, y1 } = lim
  let { x0, x1 } = lim
  let flags = 0
  let first = ''
  let last = ''

  const head = lineText(e, y0)
  if (head === undefined) return false
  if (head === null) {
    // .Proc1: the block opens on a fold, which can only be taken whole
    if (x0 !== 0) throw new EditorAlert(183)
    if (y1 <= y0) throw new EditorAlert(183)
    flags |= BF.PROC_FIRST
  } else {
    x0 = Math.min(x0, head.length)
    if (y0 === y1) {
      // .Seul: one line, so both columns are on it and there is no middle
      x1 = Math.min(x1, head.length)
      if (x1 - x0 === 0) return false
      e.block.write({ y0, y1, x0, x1, flags: flags | BF.SINGLE, first: bytes(head.slice(x0, x1)), lines: 0, middle: new Uint8Array(0), last: new Uint8Array(0) })
      return true
    }
    first = head.slice(x0)
  }

  // .Der: the last line's head, and a fold there can only be taken whole too
  const tail = lineText(e, y1)
  if (tail === null) {
    if (x1 !== 0) throw new EditorAlert(183) // .Proc2
  } else if (tail !== undefined) {
    x1 = Math.min(x1, tail.length)
    last = tail.slice(0, x1)
  }

  // .Mil: the whole lines between, as tokens. A closed first line is INSIDE
  // the middle, because the fold is what is being copied
  const from = y0 + ((flags & BF.PROC_FIRST) !== 0 ? 0 : 1)
  const parts: Uint8Array[] = []
  let lines = 0
  for (let n = from; n < y1; n++) {
    const { at, found } = e.prog.findLine(n)
    if (!found) break
    const size = e.prog.sizeOfLine(at)
    parts.push(e.prog.bytes.subarray(at, at + size))
    lines++
  }
  const middle = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    middle.set(p, at)
    at += p.length
  }

  e.block.write({ y0, y1, x0, x1, flags, first: bytes(first), lines, middle, last: bytes(last) })
  return true
}

/**
 * `Ed_BlockInsertA0` (:5945): the block back into the program at the cursor.
 *
 * The first record goes in as characters where the cursor is, then a Return
 * splits the line, then the middle is stored in one move, then the last
 * record goes in as characters at the start of the line that follows. The
 * cursor ends at the block's own last column, which is what makes pasting
 * twice in a row stack cleanly.
 */
function blockInsert(e: Edit): void {
  const b = e.block.read()
  if (b === null) return
  e.undo.suppressed++
  try {
    // a fold cannot be typed on, so a block whose first record has characters
    // cannot be pasted onto one
    if (!e.buf.editable(e.yCu) && b.first.length !== 0) throw new EditorAlert(183)
    e.xCu = Math.min(e.xCu, e.current().length)
    let line = e.line

    if (b.first.length !== 0) {
      if (e.buf.insert(e.yCu, e.xCu, text(b.first)) > 0) e.edited++
      gotoX(e, b.first.length + e.xCu)
    }
    if ((b.flags & BF.SINGLE) !== 0) return
    if ((b.flags & BF.PROC_FIRST) === 0) {
      returnKey(e)
      e.tokCur()
      line++
    }
    if (b.lines !== 0) {
      const r = e.prog.storeBlock(line, b.middle)
      if (r.error !== 0) throw new EditorAlert(202, 200)
      e.prog.marksChange(line, b.lines)
      line += b.lines
    }
    e.prog.countLines()
    gotoY(e, line)
    e.fill()
    if (b.last.length !== 0) {
      if (e.buf.insert(e.yCu, e.xCu, text(b.last)) > 0) e.edited++
      e.tokCur()
    }
    gotoX(e, b.x1)
  } finally {
    e.undo.suppressed--
  }
}

/**
 * `Ed_BlockDeleteA0` (:6023): take the block back out, which is the cut half
 * of Cut.
 *
 * It undoes what an insert does, in the same order: the middle in one chunk,
 * then the characters off each end, then a join to put the two halves of the
 * split line back together.
 */
function blockDelete(e: Edit): void {
  const b = e.block.read()
  if (b === null) return
  e.undo.suppressed++
  try {
    gotoX(e, b.x0)
    gotoY(e, b.y0)
    const proc = (b.flags & BF.PROC_FIRST) !== 0
    const single = (b.flags & BF.SINGLE) !== 0

    if (proc || !single) {
      if (b.lines !== 0) {
        const at = proc ? b.y0 : b.y0 + 1
        // DEFECT: `.NoMi` means to pass the line to `Ed_MarksChange` and
        // writes it into d1 twice instead of d0, and the second write
        // (`move.w (a3),d1`) clobbers the first. So d0 is whatever
        // `Ed_DelChunk` left, and `Ed_DelChunk` leaves `Tk_FindL`'s exit
        // value: `FndT` does `move.w (a0),d0`, the found line's length and
        // indent bytes. The marks are then shifted at a line number in the
        // thousands, which matches none of them, so cutting a block leaves
        // every mark below it pointing one block too far down. `.Proc1`
        // twenty lines above writes `move.w d4,d0` and gets it right.
        const found = e.prog.findLine(at)
        const stale = proc ? at : found.found ? (e.prog.bytes[found.at]! << 8) | e.prog.bytes[found.at + 1]! : 0
        e.prog.deleteChunk(at, b.middle.length)
        e.prog.marksChange(stale, -b.lines)
        e.prog.countLines()
        e.fill()
      }
    }

    if (proc) {
      gotoX(e, 0)
      if (b.last.length !== 0) {
        if (e.buf.delete(e.yCu, e.xCu, b.last.length)) e.edited++
        e.tokCur()
      }
      return
    }

    if (b.first.length !== 0) {
      if (e.buf.delete(e.yCu, e.xCu, b.first.length)) e.edited++
    }
    if (single) return
    e.tokCur()

    gotoX(e, 0)
    gotoY(e, b.y0 + 1)
    if (b.last.length !== 0) {
      if (e.buf.delete(e.yCu, e.xCu, b.last.length)) e.edited++
      e.tokCur()
    }
    join(e)
    e.tokCur()
  } finally {
    e.undo.suppressed--
  }
}

/* ---- Ed_PKey, the whole of it ------------------------------------------- */

/**
 * `Ed_PKey` (:1790) end to end: the character in, then the cursor after it.
 *
 * `Edit.pKey` stops at the change to the buffer so that typing can be tested
 * without a cursor; the routine itself finishes on `bsr Ed_CDroite`, and
 * three callers need that -- the key loop, and both halves of the undo
 * replay. A character below space takes `.EdL15` straight to the redraw, so
 * it does not move the cursor either.
 */
export function typeChar(e: Edit, ch: string, insert = e.insert): void {
  if (ch.charCodeAt(0) < 32) return
  e.pKey(ch, insert)
  curRight(e)
}

/* ---- JUndo and JRedo ---------------------------------------------------- */

/**
 * `Un_XY` (:2222): the cursor onto the record's own line and column.
 *
 * The two placements differ in ORDER and in where the line comes from.
 * `Un_XY` goes down then across and takes both numbers off the record.
 * `Un_XYSto` goes across then down and takes the LINE out of the block,
 * because a record that owns one has had its own line word overwritten by
 * the pointer to it (`move.l a0,2(a2)` in `Un_CLine`). `UndoRecord` resolves
 * that already, so only the order is left, and nothing here reads the line
 * between the two moves.
 */
function unXY(e: Edit, r: UndoRecord): void {
  gotoY(e, r.y)
  gotoX(e, r.x)
}

/** `Un_XYSto` (:2216) */
function unXYSto(e: Edit, r: UndoRecord): void {
  gotoX(e, r.x)
  gotoY(e, r.y)
}

/** the payload of a record that must own one */
function payload(r: UndoRecord): Uint8Array {
  if (r.block === null) throw new Error(`undo record ${r.code} has no block`)
  return r.block
}

const text = (b: Uint8Array): string => String.fromCharCode(...b)

/** `Un_RepLine` (:2180): the whole line back to what the block holds */
function repLine(e: Edit, r: UndoRecord): void {
  e.buf.setText(e.yCu, text(payload(r)))
  e.edited++
}

/** `Un_C2` (:2092): the block's characters back in at the cursor */
function unClear(e: Edit, r: UndoRecord): void {
  const p = payload(r)
  if (p.length === 0) return
  if (e.buf.insert(e.yCu, e.xCu, text(p)) > 0) e.edited++
}

/**
 * `JUndo` (+Edit.s:2030). One entry per `UN` code, and they undo by RUNNING
 * the commands rather than by restoring state: `Un_Char` calls `Ed_Delete`,
 * `Un_Join` calls `Ed_ReturnQuiet`. `Ed_FUndo` is what keeps that from
 * recording itself.
 */
const UNDO: Record<number, (e: Edit, r: UndoRecord) => void> = {
  [UN.CHAR]: (e, r) => {
    unXY(e, r)
    // b4 is -1 when the character was inserted and the character it covered
    // when it was not, so one byte decides which way back it is
    if ((r.b4 & 0x80) !== 0) return e.deleteChar()
    e.buf.overwrite(e.yCu, e.xCu, String.fromCharCode(r.b4))
    e.edited++
  },
  [UN.DELETE]: (e, r) => {
    unXY(e, r)
    // `moveq #1,d6`: always insert, whatever mode the editor is in now
    typeChar(e, String.fromCharCode(r.b5), true)
  },
  [UN.CLEAR]: (e, r) => {
    unXYSto(e, r)
    unClear(e, r)
  },
  [UN.DLINE]: (e, r) => {
    unXYSto(e, r)
    insertLine(e)
    unClear(e, r)
  },
  [UN.TOKEN]: (e, r) => {
    unXYSto(e, r)
    const p = payload(r)
    // [added:2][oldLen:1][old][newLen:1][new] -- only the old half is read
    e.buf.setText(e.yCu, text(p.subarray(3, 3 + p[2]!)))
    e.prog.lineCount -= (p[0]! << 8) | p[1]!
    e.edited++
  },
  [UN.ILINE]: (e, r) => {
    unXY(e, r)
    deleteLineHere(e)
  },
  [UN.SPLIT]: (e, r) => {
    // the second half's line goes, and the line that moves up into its place
    // gets the whole saved line back
    unXYSto(e, r)
    deleteLineHere(e)
    unXYSto(e, r)
    repLine(e, r)
  },
  [UN.JOIN]: (e, r) => {
    unXYSto(e, r)
    repLine(e, r)
    returnKey(e)
  },
}

/**
 * `JRedo` (:2038). Four of the eight are the command run again, and the last
 * two are each other: `Re_Join` IS `Un_Split` and `Re_Split` IS `Un_Join`,
 * one routine apiece with two labels on it.
 */
const REDO: Record<number, (e: Edit, r: UndoRecord) => void> = {
  [UN.CHAR]: (e, r) => {
    unXY(e, r)
    typeChar(e, String.fromCharCode(r.b5), (r.b4 & 0x80) !== 0)
  },
  [UN.DELETE]: (e, r) => {
    unXY(e, r)
    e.deleteChar()
  },
  [UN.CLEAR]: (e, r) => {
    unXYSto(e, r)
    const n = payload(r).length
    if (n !== 0 && e.buf.delete(e.yCu, e.xCu, n)) e.edited++
  },
  [UN.DLINE]: (e, r) => {
    unXYSto(e, r)
    deleteLineHere(e)
  },
  [UN.TOKEN]: (e, r) => {
    // whatever the slot holds goes back through the tokeniser, which is the
    // new spelling again because tokenising the old text gives the same
    // tokens and `Detok` writes the editor's own spelling back over them
    unXYSto(e, r)
    e.edited++
    e.tokCur()
  },
  [UN.ILINE]: (e, r) => {
    unXY(e, r)
    insertLine(e)
  },
  [UN.SPLIT]: (e, r) => UNDO[UN.JOIN]!(e, r),
  [UN.JOIN]: (e, r) => UNDO[UN.SPLIT]!(e, r),
}

/**
 * `Ed_Undo` (:1905) and `Ed_Redo` (:1921).
 *
 * Undo steps back and then reads; redo reads and then steps forward. Both
 * raise `Ed_FUndo` around the handler, which is the whole reason the handlers
 * can be written as commands: `Un_Join` pressing Return would otherwise
 * record a split, and undoing twice would go round in a circle.
 */
function replay(e: Edit, back: boolean): void {
  const r = back ? e.undo.undo() : e.undo.redo()
  // Ed_NoUndo (:9878) is message 4 and Ed_NoRedo message 5
  if (r === null) throw new EditorAlert(back ? 4 : 5)
  const fn = (back ? UNDO : REDO)[r.code]
  if (fn === undefined) throw new RangeError(`undo record ${r.code} is not one of the eight`)
  e.undo.suppressed++
  try {
    fn(e, r)
  } finally {
    e.undo.suppressed--
  }
}

/* ---- 66 to 68 and 99 to 101: search and replace -------------------------- */

/**
 * `Ed_DiaS` (:6962): put the requester up and take back what it holds.
 *
 * The copies back are unconditional. `move.w d0,-(sp)` stows the answer, the
 * flags and the string are read out of the requester's variables anyway, and
 * only then is the answer popped, so a cancelled requester still leaves
 * whatever was typed into it in `Ed_SchBuf` and `Ed_SchMode`.
 *
 * `move.l #32,(a2)+` is the gadget's width, which is why 34 bytes of buffer
 * is enough for a string nobody can overrun.
 */
function askFor(e: Edit, which: 4 | 6): boolean {
  if (e.dialogues === null) return true
  const a = e.dialogues.ask({ which, search: e.schBuf, replace: e.repBuf, mode: e.schMode })
  e.schBuf = a.search.slice(0, 32)
  e.schMode = a.mode & 0b1111
  // EdD_Search never asks for the replace string; `Ed_Replace` adds it
  if (which === 6) e.repBuf = a.replace.slice(0, 32)
  return a.ok
}

/**
 * `Ed_Dialogue` (:3107) for everything but the search box.
 *
 * DEVIATION: with no requester installed there is nobody to ask, so every
 * question answers with its first button. That is Yes to "save it first?" and
 * Ok to "overwrite?", which is what a requester that always says Ok would do.
 */
function confirm(e: Edit, c: Confirm): number {
  if (e.dialogues === null) return 1
  return e.dialogues.confirm(c)
}

/**
 * `Ed_File_Selector` (:14059), or `Name1` as it stands.
 *
 * `tst.b Ed_Zappeuse(a5) / bne .Zap` is the first instruction: under the ZAP
 * remote control the selector answers 1 without drawing anything, because the
 * name is already in `Name1`. A port with no requester is in exactly that
 * position.
 */
function selectFile(e: Edit, which: number): boolean {
  if (e.dialogues === null) return true
  const picked = e.dialogues.select(which, e.name1)
  if (picked === null) return false
  e.name1 = picked
  return true
}

/**
 * `Ed_SR` (:7031): find the next match, and put the replacement in if the
 * mode's bit 15 says to.
 *
 * The cursor moves to the match before anything is replaced, so `Ed_LCourant`
 * reads the slot the match is in. There is no `bne Ed_NotEdit` after that
 * call: the splice goes into whatever the slot holds, and a closed procedure
 * is caught two steps later by `Ed_Stocke`.
 *
 * A replacement is recorded by `Ed_TokCur` and by nothing else, so it goes
 * into the undo ring as a TOKEN record whose "old" half is the slot AS
 * SPLICED. Undoing a Replace gives back the replaced line in the user's own
 * spelling rather than the line before it, which is to say a single Replace
 * cannot be undone.
 */
function searchReplace(e: Edit, mode: number): void {
  const hit =
    (mode & SM.BACK) !== 0 ? schBack(e, e.line, e.xCu, mode) : schFront(e, e.line, e.xCu, 32000, 32000, mode)
  if (hit === null) {
    e.fill() // Ed_NoFound opens with Ed_NewBuf
    throw new EditorAlert(205)
  }
  autoMarks(e)
  gotoY(e, hit.y)
  gotoX(e, hit.x)
  if ((mode & SM.REPLACE) === 0) return
  const out = repBuffer(e.buf.text(e.yCu), hit.x, e.schBuf.length, e.repBuf)
  e.buf.setText(e.yCu, out)
  e.edited++
  e.tokCur()
  // `add.w d3,d6` inside RepBuffer, so the cursor lands past the replacement
  gotoX(e, hit.x + e.repBuf.length)
}

/**
 * `.Turbo` (:7265): every match between the two limits, in one pass.
 *
 * Nothing here touches the edit buffer. Each line is detokenised, spliced,
 * tokenised and stored straight back into the program, and `Ed_NewBuf` at
 * `.Finish` is what puts the window back in step. That is also why no undo
 * record is written: `Ed_TokCur` is never reached.
 *
 * DEFECT: `.Loop` opens with `subq.w #1,d6 / bpl .Pos / moveq #0,d6`, which
 * takes a start column of 0 back to 0, and `Ed_SchFront` then steps it to 1.
 * So the first line of the range is searched from column 1 and a match at
 * column 0 of it is never replaced. Every later line is entered through
 * `.Srch2`, which sets the column to 0 without the step, so the fault is the
 * first line only. Replace All over a whole program cannot change the first
 * word of line 1.
 */
function turboReplace(e: Edit, mode: number): void {
  let y = 0
  let x = 0
  let yMax = 32000
  let xMax = 32000
  if ((mode & SM.BLOCK) !== 0) {
    const b = blocLimits(e)
    y = b.y0
    x = b.x0
    yMax = b.y1
    xMax = b.x1
    // `move.w d2,d3 / beq.s .Pab` sets the flags off the column, so an end at
    // column 0 keeps its limit rather than being decremented past it
    if (xMax !== 0) xMax -= 1
  }
  let count = 0
  for (;;) {
    x = x > 0 ? x - 1 : 0
    const hit = schFront(e, y, x, yMax, xMax, mode)
    if (hit === null) break
    y = hit.y
    // `Ed_BufT` still holds the line `Ed_SchFront` last detokenised, which is
    // this one
    const text = detokLineBytes(e.prog.bytes, e.prog.findLine(y).at, e.table, e.opts)
    // `bne Ed_LToLong` with no redisplay, unlike the `.Llong` below it
    const out = repBuffer(text, hit.x, e.schBuf.length, e.repBuf)
    x = hit.x + e.repBuf.length
    let line: Uint8Array
    try {
      line = tokeniseLine(out, e.table, e.opts)
    } catch {
      e.fill() // .Llong
      throw new EditorAlert(199, 50)
    }
    // DEFECT: `bne .Outb` tests neither sign nor value, so `Ed_Stocke`'s -1
    // for a closed procedure is reported as Out of buffer space. It is
    // reachable: the fold detokenises to its `Procedure` header and a search
    // that matches there lands the replacement on a line that cannot take it
    if (e.prog.store(y, line).error !== 0) {
      e.fill()
      throw new EditorAlert(202, 200)
    }
    count++
  }
  e.fill() // .Finish
  if (count === 0) throw new EditorAlert(205)
  // EdD_Changes and message 40, " change(s) done.". Its answer is dropped
  confirm(e, { which: 10, count })
}

/**
 * `Ed_Search` (:7000), `Ed_SearchNext` (:7021) and `Ed_SearchPrev` (:7011).
 *
 * The two directed ones fall into the undirected one when there is nothing
 * in the buffer to look for, which is `beq.s Ed_Search` and is how a first
 * Search Next raises the requester.
 *
 * `and.w #%0011,d5` in `Ed_Search` keeps the case and direction gadgets and
 * drops the two turbo ones, so ticking All Occurences in the SEARCH requester
 * does nothing at all.
 */
function searchCmd(e: Edit): void {
  e.tokCur()
  if (!askFor(e, 4)) throw new EditorAlert(206) // Ed_NotDone
  searchReplace(e, e.schMode & 0b0011)
}

/**
 * `Ed_Replace` (:7232), `Ed_ReplaceNext` (:7344) and `Ed_ReplacePrev` (:7356).
 *
 * The three are a loop rather than three routines. `Ed_Replace` picks a
 * direction and branches into one of the other two; either of those branches
 * back to `Ed_Replace` when a buffer is empty; and the turbo arm does the
 * same. Cancel and a filled pair of buffers are the only ways out.
 *
 * A cancelled Replace requester goes to `Ed_Loop` with no message at all,
 * where a cancelled Search says "Not done." Two requesters, one line apart in
 * the source, disagreeing about what a Cancel is worth saying.
 */
function replaceCmd(e: Edit, entry: 99 | 100 | 101): void {
  let at: 99 | 100 | 101 = entry
  for (;;) {
    if (at === 99) {
      e.tokCur()
      if (!askFor(e, 6)) return
      const mode = e.schMode
      if ((mode & SM_TURBO) !== 0) {
        // `btst #2,d5` picks which of the two confirmations to put up
        if (confirm(e, { which: (mode & SM.BLOCK) !== 0 ? 8 : 9 }) !== 1) throw new EditorAlert(206)
        if (e.schBuf !== '' && e.repBuf !== '') return turboReplace(e, mode)
        noRequester(e)
        continue
      }
      at = (mode & SM.BACK) !== 0 ? 101 : 100
      continue
    }
    // Ed_RSR (:7348), reached with the mode already picked
    const mode = at === 100 ? (e.schMode & 1) | SM.REPLACE : (e.schMode & 1) | SM.REPLACE | SM.BACK
    e.tokCur()
    if (e.schBuf !== '' && e.repBuf !== '') return searchReplace(e, mode)
    noRequester(e)
    at = 99
  }
}

/**
 * DEVIATION: the machine's loop back to the requester has no end. It puts the
 * dialogue up again, and again, until the user fills both fields or cancels.
 * With no requester installed there is nothing to put up and nothing that
 * could change, so this port stops with "Not done." rather than spinning.
 */
function noRequester(e: Edit): void {
  if (e.dialogues === null) throw new EditorAlert(206)
}

/* ---- 33 to 35, 80, 85, 97, 98 and 152: the disc ------------------------- */

/** `Ed_NPrgToBuf` (:7555): the program's own name, or system message 7 */
function prgName(e: Edit): string {
  return e.prog.name === '' ? ED_SYSTEME[6]! : fileName(e.prog.name)
}

/** `Ed_SaveOver` (:13302): EdD_AExist when the name is already taken */
function saveOver(e: Edit, fs: EditorFS): void {
  if (fs.exists(e.name1) === null) return
  if (confirm(e, { which: 47, name: e.name1 }) !== 1) throw new EditorAlert(206)
}

/** the filesystem, or the disc error every command that needs one raises */
function disc(e: Edit): EditorFS {
  if (e.fs === null) throw new DiskError()
  return e.fs
}

/**
 * `Ed_MakeBak` (:13697): rename the file being saved over to `.Bak`.
 *
 * Three AmigaDOS codes are not failures. 205 is "there was nothing to rename",
 * which is the first save of a new file. 203 is "the .Bak is already there",
 * and `.Bak5` deletes it and starts again. 215 is a rename across two devices,
 * which cannot happen here at all: the backup name is the same path with a
 * different extension, so both ends are always on the same volume.
 *
 * DEVIATION: `EditorFS.rename` answers yes or no and not a code, so 203 is
 * recognised by asking whether the target exists rather than by asking why the
 * rename failed.
 */
function makeBak(e: Edit, fs: EditorFS): void {
  const to = bakName(e.name1, ED_SYSTEME[20]!)
  for (let tries = 0; tries < 2; tries++) {
    if (fs.rename(e.name1, to)) return
    if (fs.exists(e.name1) === null) return
    if (fs.exists(to) === null) break
    fs.deleteFile(to)
  }
  throw new DiskError()
}

/**
 * `Ed_SavePrg` (:13660) and `Ed_SavePrg2` (:13668) below it, which is the same
 * routine entered past the backup.
 *
 * `Prg_StModif` is set to 1 AFTER the save, with the author's "force le
 * menage" beside it, and the header has already been written from what it was
 * before. So a program that has passed Test saves once as `V` and every time
 * after that as `v`, without being edited in between.
 */
function savePrg(e: Edit, bak: boolean): void {
  const fs = disc(e)
  if (bak && e.svBak) makeBak(e, fs)
  e.prog.countLines()
  const file = writeProgramFile({
    pro: e.prog.pro,
    mathFlags: e.prog.mathFlags,
    tested: !e.prog.modified,
    source: programSource(e.prog),
    banks: e.prog.banks,
  })
  if (!fs.writeFile(e.name1, file)) throw new DiskError()
  // Prg_Save's own tail: the name it was saved under becomes the program's
  e.prog.name = e.name1
  e.prog.changed = false
  e.prog.modified = true
  // `Ed_SaveIcon` (:13748) follows, and writes a .info through icon.library
  // when PI_Icons is set. Nothing here draws icons.
}

/** `Ed_Sv` (:13649): the name is settled, so write it */
function saveNamed(e: Edit): void {
  savePrg(e, true)
}

/** `Ed_SvAs` (:13643): ask for a name first */
function saveAs(e: Edit): void {
  if (!selectFile(e, 74)) throw new EditorAlert(206)
  saveNamed(e)
}

/**
 * `Ed_SaveIt` (:13632): Save, which is Save As until the program has a name.
 *
 * `Ed_Save` and `Ed_SaveAs` are two `bsr Ed_TokCur` and a branch apart. Save
 * As jumps over this test and always asks.
 */
function saveIt(e: Edit): void {
  if (e.prog.name === '') return saveAs(e)
  e.name1 = e.prog.name
  saveNamed(e)
}

/**
 * `Ed_Saved` (:13315): "NAME not saved. Save?", before something throws the
 * program away.
 *
 * The one requester in the editor whose three answers are three different
 * things. 1 saves, 2 goes on without saving, and anything else abandons the
 * command that asked. `Ed_NotDone2` rather than `Ed_NotDone`, so the window
 * is not redrawn on the way out.
 */
function saved(e: Edit): void {
  if (!e.prog.changed) return
  const answer = confirm(e, { which: 11, name: prgName(e) })
  if (answer === 2) return
  if (answer !== 1) throw new EditorAlert(206)
  saveIt(e)
}

/**
 * `Ed_New2` (:10899) and `Edt_New` (:10910) after it.
 *
 * `Edt_New` clears every word from `Edt_SInit` to `Edt_EInit` and then puts
 * -1 back into the two block fields. What it does NOT touch is `Ed_Block`,
 * which lives in a5 rather than a4: New empties the program and keeps the
 * clipboard, so a block cut from one program can be pasted into the next.
 */
function newProgram(e: Edit): void {
  e.prog.newProgram()
  e.xCu = 0
  e.yCu = 0
  e.xPos = 0
  e.yPos = 0
  e.edited = 0
  e.xBloc = 0
  e.yBloc = -1
  e.yOldBloc = -1
  e.undo.raz() // Prg_UndoCreate
  e.prog.marks.fill(0) // Prg_MarkRaz
  e.fill()
}

/**
 * `Ed_ReLoad` (:13405): read the file, and grow the buffer if it will not fit.
 *
 * `moveq #1,d0` is "revenir si pas assez grand", so `Prg_Load` answers 1
 * rather than reallocating, and `Ed_GetPlace` puts EdD_TooSmall up before it
 * does. The retry then goes round the whole read again.
 *
 * `.Load` asks for 256 bytes more than the file, so a program that fits its
 * buffer to the byte is still refused and reloaded into a bigger one.
 */
function reload(e: Edit): void {
  const fs = disc(e)
  const bytes = fs.readFile(e.name1)
  if (bytes === null) throw new DiskError(205)
  for (;;) {
    const r = readProgramFile(bytes, e.prog.bytes.length)
    if (r.error === PRG.NOT_AMOS) throw new EditorAlert(207) // Ed_PaAMOS
    if (r.error === PRG.MEMORY) throw new EditorAlert(204, 120) // Ed_OMm
    if (r.error === PRG.DISK) throw new DiskError()
    if (r.error === PRG.TOO_SMALL) {
      // Ed_GetPlace (:9915). Its other arm is the Set Buffer Size requester,
      // which is `JFonc` 122 and is not ported
      if (confirm(e, { which: 37, count: r.needs }) !== 1) throw new EditorAlert(206)
      e.prog = ProgramBuffer.create(r.needs)
      continue
    }
    const f = r.file!
    const room = Math.max(e.prog.bytes.length, r.needs)
    e.prog = ProgramBuffer.load(f.source, room)
    e.prog.pro = f.pro
    e.prog.mathFlags = f.mathFlags
    e.prog.banks = f.banks
    e.prog.name = e.name1
    e.prog.changed = false
    // EdLok: `move.b #1,Prg_StModif(a6)`, "force le test". Whatever the file
    // said in byte 11, a program comes back from disc untested
    e.prog.modified = true
    e.fill()
    return
  }
}

/**
 * `Ed_LoadA` (:13489), Merge Ascii: a text file tokenised a line at a time and
 * inserted at the cursor.
 *
 * The line splitting is `.Fin1` to `.Fin4` and it is stricter than it looks. A
 * tab becomes a space in place. CR and LF both end a line, and `.Fin2` then
 * steps over ONE more byte if that byte is also below space -- which joins the
 * two halves of a CRLF, and swallows a blank line, because the second
 * newline of a pair is read as the other half of the first.
 *
 * DEFECT: any other control character reaches `.Bad`, and `.Bad` and `.Long`
 * are two labels on the same instruction. A file with a stray byte under 32 in
 * it reports "Line too long."
 */
function loadAscii(e: Edit): void {
  e.tokCur()
  e.undo.raz()
  if (!selectFile(e, 86)) throw new EditorAlert(206)
  const fs = disc(e)
  const bytes = fs.readFile(e.name1)
  if (bytes === null) throw new DiskError(205)
  let line = e.line
  let at = 0
  const done = (): void => {
    e.prog.countLines()
    e.fill()
  }
  while (at < bytes.length) {
    const was = e.abort
    e.abort = false
    if (was) break
    let end = at
    const text: number[] = []
    for (;;) {
      const c = bytes[end]
      if (c === undefined || c === 0) break
      if (c >= 32) {
        text.push(c)
        end++
        continue
      }
      if (c === 9) {
        // `move.b #" ",(a2)`: the tab is overwritten in the buffer itself
        text.push(32)
        end++
        continue
      }
      if (c === 10 || c === 13) {
        // `.Fin2`: one more byte goes if it is also below space
        if ((bytes[end + 1] ?? 0) < 32) end++
        break
      }
      done()
      throw new EditorAlert(199, 50) // .Bad, which is .Long
    }
    // `sub.l a3,d0 / cmp.l #250,d0`, measured to the terminator
    if (end - at >= 250) {
      done()
      throw new EditorAlert(199, 50)
    }
    let tokens: Uint8Array
    try {
      tokens = tokeniseLine(text.map((c) => String.fromCharCode(c)).join(''), e.table, e.opts)
    } catch {
      done()
      throw new EditorAlert(199, 50)
    }
    if (e.prog.store(line, tokens, true).error !== 0) {
      done()
      throw new EditorAlert(202, 200) // .OBuf
    }
    line++
    e.prog.lineCount++
    at = end + 1
  }
  done()
}

/**
 * `Ed_BlocSave` (:6318), `JFonc` 98: the block as a program of its own.
 *
 * It writes `EnHead` and not `H_Pro`, so a saved block says `AMOS ProEd.v` in
 * the wild and still loads, because `Prg_Load` compares eight bytes. The size
 * word goes down as a placeholder and is poked in at the end, after a seek
 * back to offset 16, which is the only seek in the editor.
 *
 * An end that tokenises to nothing is not written at all: `Tokenise` answers
 * d1 of 0 for an empty line (`TokVide` :14705) and `beq` skips the write.
 */
function blockSave(e: Edit): void {
  e.tokCur()
  const b = e.block.read()
  if (b === null) throw new EditorAlert(6) // Ed_BlocWhat
  if (!selectFile(e, 90)) throw new EditorAlert(206)
  const fs = disc(e)
  saveOver(e, fs)
  const parts: Uint8Array[] = []
  const push = (chars: Uint8Array): void => {
    if (chars.length === 0) return
    const line = tokeniseLine(text(chars), e.table, e.opts)
    if (line.length <= EMPTY_LINE_BYTES) return
    parts.push(line)
  }
  push(b.first)
  if (b.middle.length !== 0) parts.push(b.middle)
  push(b.last)
  let size = 0
  for (const p of parts) size += p.length
  const source = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    source.set(p, at)
    at += p.length
  }
  // `Bnk.SaveVide` writes the same six bytes `Bnk.SaveAll` writes for a
  // program with no banks
  const out = writeProgramFile({ pro: true, mathFlags: 0, tested: false, source, banks: EMPTY_BANKS })
  out.set(Uint8Array.from(H_BLOCK, (c) => c.charCodeAt(0)), 0)
  if (!fs.writeFile(e.name1, out)) throw new DiskError()
}

/**
 * `Ed_BlocSaveAscii` (:6440), `JFonc` 97, over `BlToA0`/`BlToA1` (:6541).
 *
 * Every line gets a linefeed after it, the last one included, because the 10
 * is poked past the text before the write rather than between writes. A record
 * that holds nothing produces no line at all (`.1Vide`), so a block that
 * starts at the end of a line does not begin with a blank one.
 */
function blockSaveAscii(e: Edit): void {
  e.tokCur()
  const b = e.block.read()
  if (b === null) throw new EditorAlert(6)
  if (!selectFile(e, 82)) throw new EditorAlert(206)
  const fs = disc(e)
  saveOver(e, fs)
  const lines: string[] = []
  if (b.first.length !== 0) lines.push(text(b.first))
  let at = 0
  for (let n = 0; n < b.lines; n++) {
    lines.push(detokLineBytes(b.middle, at, e.table, e.opts))
    const len = b.middle[at]! * 2
    if (len === 0) break
    at += len
  }
  if (b.last.length !== 0) lines.push(text(b.last))
  const out = lines.length === 0 ? '' : lines.join('\n') + '\n'
  if (!fs.writeFile(e.name1, bytes(out))) throw new DiskError()
}

/* ---- 106 to 110, 143 and 144: the macros -------------------------------- */

/**
 * `Sys_AddPath` (+B.s:534): the system directory, if the name has no volume.
 *
 * `.Ess` scans the WHOLE name for a colon rather than only its front, so
 * anything with one anywhere is left alone.
 */
function addPath(e: Edit, name: string): string {
  return name.includes(':') ? name : e.sysPath + name
}

/** EdD_Macro1 and EdD_MacroD, or `Dia_LastKey` as it stands */
function pressKey(e: Edit, which: number): number {
  if (e.dialogues === null) return e.lastKey
  return e.dialogues.pressKey(which)
}

/** `EdMa_No` (:6924): EdD_MacroNo, and no alert with it */
function noMacros(e: Edit): void {
  confirm(e, { which: 22 })
}

/**
 * `EdMa_Stop` (:6868): the tape closed and kept.
 *
 * NOT a `JFonc` command. The only thing that calls it is the mouse handler at
 * :1240, `tst.w EdMa_Tape(a5) / bne EdMa_Stop`, which is why message 30 says
 * "Click mouse button to end." There is no key that stops a recording.
 */
export function macroStop(e: Edit): number {
  const tape = e.macroTape
  if (tape === null) return 0
  e.macroTape = null
  e.macroChange = true
  const macro = stopTape(tape)
  return run(e, () => {
    // `.Vide`: a macro with nothing in it is thrown away and reported as
    // Not done, which is the only refusal that reaches the user
    if (macro === null) throw new EditorAlert(206)
    e.macros.unshift(macro)
    throw new EditorAlert(45) // Ed_Al100, "Macro successfully recorded."
  })
}

/**
 * `EdMa_Load` (:6700) and `EdMa_LoadIt` (:6643) around it.
 *
 * The erase happens inside `EdMa_Load`, before the file is opened, so a load
 * that then fails has already thrown the old macros away. The requester that
 * asks about it, EdD_MacroEra, is one level up and does not know.
 */
function macroLoad(e: Edit): void {
  if (e.macros.length !== 0 && confirm(e, { which: 21 }) !== 1) throw new EditorAlert(206)
  const fs = disc(e)
  e.macros = []
  e.macroChange = false
  const bytes = fs.readFile(e.name1)
  if (bytes === null) throw new DiskError(205)
  const r = readMacroFile(bytes)
  if (r.error === -1) throw new EditorAlert(204, 120) // Ed_OMm
  if (r.error === 1) throw new DiskError()
  if (r.error === 2) {
    // EdD_MacroPas, and `bsr Ed_Loca` after it: a requester, not an alert
    confirm(e, { which: 23 })
    return
  }
  e.macros = r.list
}

/** `EdMa_Save` (:6753) and `EdMa_SaveIt` (:6686) around it */
function macroSave(e: Edit): void {
  const fs = disc(e)
  if (!fs.writeFile(e.name1, writeMacroFile(e.macros))) throw new DiskError()
  e.macroChanged = false
}

/* ---- the table ---------------------------------------------------------- */

/** every command this port runs, by its 1-based `JFonc` number */
export const COMMANDS: Record<number, (e: Edit) => void> = {
  1: (e) => {
    e.tokCur()
    curUp(e)
  },
  2: (e) => {
    e.tokCur()
    curDown(e)
  },
  3: curLeft,
  4: curRight,
  5: (e) => {
    e.tokCur()
    e.yCu = 0
  },
  6: (e) => {
    // Ed_BPage (:3900): the bottom row, or the last line if the window
    // reaches past it
    e.tokCur()
    let row = e.buf.rows - 1
    const last = e.yPos + row
    if (last >= e.prog.lineCount) row -= last - e.prog.lineCount
    e.yCu = row
  },
  7: (e) => {
    e.xCu = wordLeft(e)
    cent(e)
  },
  8: (e) => {
    e.xCu = wordRight(e)
    cent(e)
  },
  9: (e) => {
    // Ed_PHaut (:3986): a window less two rows, so two lines of context stay
    e.tokCur()
    if (e.yPos === 0) return textTop(e)
    e.yPos = Math.max(0, e.yPos - Math.max(1, e.buf.rows - 2))
    e.fill()
  },
  10: (e) => {
    e.tokCur()
    const step = Math.max(1, e.buf.rows - 2)
    if (e.line + step >= e.prog.lineCount) return textBottom(e)
    e.yPos += step
    e.fill()
  },
  11: (e) => {
    e.xCu = 0
    cent(e)
  },
  12: (e) => {
    e.xCu = e.current().length
    cent(e)
  },
  17: (e) => {
    e.tokCur()
    autoMarks(e)
    textTop(e)
  },
  18: (e) => {
    e.tokCur()
    autoMarks(e)
    textBottom(e)
  },
  19: returnKey,
  20: (e) => {
    if (e.xCu === 0) return join(e)
    curLeft(e)
    e.deleteChar()
  },
  21: (e) => e.deleteChar(),
  22: clearLine,
  23: (e) => {
    deleteLineHere(e)
  },
  24: tab,
  25: shiftTab,
  29: insertLine,
  30: deleteToEnd,
  31: (e) => {
    e.tokCur()
    gotoLabel(e, nearestLabels(e).before)
  },
  32: (e) => {
    e.tokCur()
    gotoLabel(e, nearestLabels(e).after)
  },
  33: (e) => {
    // Ed_Load (:13390)
    e.tokCur()
    saved(e)
    if (!selectFile(e, 70)) throw new EditorAlert(206)
    newProgram(e)
    reload(e)
  },
  34: (e) => {
    // Ed_SaveAs (:13627), which is Ed_SaveIt with the name test jumped over
    e.tokCur()
    saveAs(e)
  },
  35: (e) => {
    // Ed_Save (:13630)
    e.tokCur()
    saveIt(e)
  },
  36: deleteWord,
  37: backWord,
  59: (e) => {
    // Ed_BlocOn (:5830): the same key drops the anchor and picks it up again
    if (e.yBloc >= 0) {
      e.yBloc = -1
      return
    }
    e.yBloc = e.line
    e.xBloc = e.xCu
    e.yOldBloc = 0
  },
  60: (e) => {
    // Ed_BlocForget (:5879)
    if (e.block.empty) throw new EditorAlert(6)
    e.block.free()
    throw new EditorAlert(8) // "Block deleted from memory."
  },
  62: (e) => {
    // Ed_BlocCut (:5888). `Prg_UndoRaz` with the author's own comment beside
    // it -- "Illegal: remettre plus tard!" -- so a cut throws the undo
    // history away rather than being undoable, and he knew it
    if (!blockCopy(e)) throw new EditorAlert(6)
    e.yBloc = -1
    blockDelete(e)
    e.undo.raz()
    throw new EditorAlert(7) // "Block stored in memory."
  },
  63: (e) => {
    // Ed_BlocPaste (:5903)
    if (e.block.empty) throw new EditorAlert(6)
    blockInsert(e)
    e.undo.raz()
  },
  64: deleteToStart,
  65: (e) => replay(e, true),
  66: searchCmd,
  67: (e) => {
    e.tokCur()
    if (e.schBuf === '') return searchCmd(e)
    searchReplace(e, e.schMode & 0b0001)
  },
  68: (e) => {
    e.tokCur()
    if (e.schBuf === '') return searchCmd(e)
    searchReplace(e, (e.schMode & 0b0001) | SM.BACK)
  },
  72: (e) => {
    // Ed_BlocStore (:5867)
    if (!blockCopy(e)) throw new EditorAlert(6)
    e.yBloc = -1
    throw new EditorAlert(7)
  },
  75: (e) => {
    e.insert = !e.insert
  },
  80: (e) => {
    // Ed_New (:10896)
    e.tokCur()
    saved(e)
    newProgram(e)
  },
  85: loadAscii,
  97: blockSaveAscii,
  98: blockSave,
  94: (e) => replay(e, false),
  99: (e) => replaceCmd(e, 99),
  100: (e) => replaceCmd(e, 100),
  101: (e) => replaceCmd(e, 101),
  106: (e) => {
    // EdMa_New (:6831)
    e.tokCur()
    const key = pressKey(e, 13)
    if (key === 0) throw new EditorAlert(206)
    const already = findMacro(e.macros, key)
    if (already !== null) {
      // EdD_Macro2, "This key is already assigned to a macro. Erase it?"
      if (confirm(e, { which: 14 }) !== 1) throw new EditorAlert(206)
      e.macros.splice(e.macros.indexOf(already), 1)
    }
    e.macroTape = newTape(key)
  },
  107: (e) => {
    // EdMa_Del (:6793)
    e.tokCur()
    if (e.macros.length === 0) return noMacros(e)
    const key = pressKey(e, 18)
    if (key === 0) throw new EditorAlert(206)
    const m = findMacro(e.macros, key)
    if (m === null) {
      // EdD_MacroNA, "This key is not assigned to a macro!", and `bsr Ed_Loca`
      confirm(e, { which: 19 })
      return
    }
    e.macros.splice(e.macros.indexOf(m), 1)
    e.macroChange = true
  },
  108: (e) => {
    // EdMa_DelAll (:6817)
    e.tokCur()
    if (e.macros.length === 0) return noMacros(e)
    if (confirm(e, { which: 20 }) !== 1) throw new EditorAlert(206)
    e.macros = []
    e.macroChange = true
  },
  109: (e) => {
    // EdMa_LoadAs (:6632)
    if (!selectFile(e, 55)) throw new EditorAlert(206)
    macroLoad(e)
    e.macroChanged = true
  },
  110: (e) => {
    // EdMa_SaveAs (:6677)
    if (!selectFile(e, 51)) throw new EditorAlert(206)
    saveOver(e, disc(e))
    macroSave(e)
  },
  143: (e) => {
    // EdMa_LoadDefault (:6623)
    e.name1 = addPath(e, ED_SYSTEME[45]!)
    macroLoad(e)
    e.macroChanged = false
  },
  144: (e) => {
    // EdMa_SaveDefault (:6668), which does NOT ask before writing over it
    e.name1 = addPath(e, ED_SYSTEME[45]!)
    macroSave(e)
  },
  152: (e) => {
    // Ed_SaveAsName (:13607): save to Name1 with no .Bak, and put the
    // program's own name back afterwards, because `Prg_Save` overwrites it
    const was = e.prog.name
    try {
      savePrg(e, false)
    } finally {
      e.prog.name = was
    }
  },
  181: (e) => {
    // Ed_BlocAll (:5854): the anchor at the top and the cursor at the top too,
    // with YBloc at the line PAST the last, so the block runs the other way
    e.xCu = 0
    e.yCu = 0
    e.xPos = 0
    e.yPos = 0
    e.xBloc = 0
    e.yBloc = e.prog.lineCount
    e.fill()
  },
}

// 39 to 48 Ed_SMark0-9, 49 to 58 Ed_GMark0-9. Ten `addq.w #1,d0` in a row
// falling into one routine (:4214), which is the whole of what they are.
for (let i = 0; i < 10; i++) {
  COMMANDS[ED.SET_MARK_0 + i] = (e) => {
    e.tokCur()
    e.prog.setMark(i, e.line, e.xCu)
    throw new EditorAlert(64) // Ed_Al100, "Mark set."
  }
  COMMANDS[ED.GOTO_MARK_0 + i] = (e) => {
    e.tokCur()
    const m = e.prog.getMark(i)
    if (m === null) throw new EditorAlert(65) // Ed_NoMark, "Mark not defined."
    autoMarks(e)
    gotoY(e, m.line)
    gotoX(e, m.column)
  }
}

/**
 * `Ed_FCall` (+Edit.s:2565): run command `cmd`, 1-based. Answers the alert it
 * ended on, 0 for none.
 *
 * The flag byte is read before the command, not after: bit 2 is checked
 * against the line the cursor is on and raises Line not editable without the
 * command being reached at all, so `Ed_DelLiCu`'s own check is the second
 * one. `Ed_SCallFlags` is left holding what the command wants redrawn, which
 * a split view reads to decide whether the other half needs it too.
 */
export function edCall(e: Edit, cmd: number): number {
  const flags = flagsOf(cmd)
  const fn = COMMANDS[cmd]
  if (fn === undefined) throw new RangeError(`editor command ${cmd} (${routineOf(cmd)}) is not ported`)
  if (e.macroTape !== null && (flags & FLAG.MACRO) === 0) {
    // `.NoMacro` (:2624): the key that got here has already been taped, so
    // the refusal rewinds over it. The command does not run, `Ed_SCallFlags`
    // is not written, and `bra Ed_Loop` is the end of it
    e.macroTape.at -= 3
    e.alert = 0
    e.alertTime = 0
    confirm(e, { which: 15 }) // EdD_Macro3, "This function cannot be used in a macro!"
    return 0
  }
  e.callFlags = flags
  return run(e, () => {
    if ((flags & FLAG.CLOSED) !== 0) mustEdit(e)
    e.yOldBloc = e.line
    fn(e)
  })
}

/**
 * The key half of `Ed_Key` (:1616): one keystroke, whatever it turns out to
 * be. Answers the alert, 0 for none.
 *
 * `Ed_Ky2Fonc` first, and a zero back means nobody claimed the key, so it
 * goes to `Ed_PKey` as a character (`.Char` at :1622). That is the whole
 * arbitration: there is no list of printable keys anywhere, only the key map
 * and what falls through it.
 *
 * What is NOT here is the macro layer above it. `Ed_Key` reads from
 * `EdMa_Play` before it reads the keyboard, writes to `EdMa_List` when one is
 * recording, and checks whether the key IS a macro before any of this. That
 * is a command set of its own (`JFonc` 106 to 110) and none of it is ported.
 */
export function edKey(e: Edit, key: EdKey, table?: Uint8Array): number {
  // the tape comes first, and a key it records is NOT looked up as a macro:
  // `.2Big bra .EndMac` steps straight over `.UneMac`
  if (e.macroTape !== null) {
    tapeKey(e.macroTape, packKey(inkey(key)))
    return endMac(e, key, table)
  }
  const macro = findMacro(e.macros, packKey(inkey(key)))
  if (macro === null) return endMac(e, key, table)
  // `.UneMac`: point the player at it and `bra Ed_Key`, which comes straight
  // back round the playback arm and runs the macro's first keystroke now
  e.macroPlay = { keys: macroKeys(macro), at: 0 }
  return edMacroStep(e, table) ?? 0
}

/**
 * The playback half of `Ed_Key` (:1560), which is everything above the
 * `Inkey` call.
 *
 * DEVIATION: one routine on the machine, two here. `Ed_Key` reads the tape and
 * then falls through to the keyboard in the same call; a port cannot own the
 * keyboard, so the fall-through is a null answer and the host reads the key
 * itself. Everything else is the same instructions in the same order.
 *
 * Three bytes a keystroke, ASCII first, and `$FF` in the ASCII slot ends it.
 * The pointer is stepped BEFORE the terminator is tested, so a macro that ends
 * leaves `EdMa_Play` pointing past its own end for the one instruction it
 * takes to clear it.
 */
export function edMacroStep(e: Edit, table?: Uint8Array): number | null {
  const play = e.macroPlay
  if (play === null) return null
  const at = play.at
  play.at += 3
  const ascii = play.keys[at] ?? 0xff
  if (ascii === 0xff) {
    e.macroPlay = null
    return null
  }
  const key = unpackKey(packKey({ ascii, scan: play.keys[at + 1] ?? 0, shift: play.keys[at + 2] ?? 0 }))
  // straight to `.EndMac`: a key out of a macro is neither taped nor looked up
  return endMac(e, { ch: String.fromCharCode(key.ascii), scan: key.scan, shift: key.shift }, table)
}

/** `.EndMac` (:1614): the key map, and what falls through it */
function endMac(e: Edit, key: EdKey, table?: Uint8Array): number {
  const cmd = keyToFunc(key, table)
  if (cmd !== 0) return edCall(e, cmd)
  e.callFlags = 0
  // `move.b Ed_Insert(a5),d6` is read here and not held, so flipping the mode
  // takes effect on the next key rather than on this one
  return run(e, () => typeChar(e, key.ch ?? '', e.insert))
}

/** an `EdKey` as `Inkey` would have packed it */
const inkey = (k: EdKey): KeyLong => ({
  ascii: (k.ch ?? '').charCodeAt(0) & 0xff || 0,
  scan: k.scan ?? 0,
  shift: k.shift ?? 0,
})

/**
 * The `Ed_Loop` end of it: run the thing, and keep the alert it ended on.
 *
 * `Ed_Alert` never comes back to its caller, it branches to the loop, so an
 * alert here is a message and not a failure. Anything else thrown is a defect
 * in this port and goes up.
 */
function run(e: Edit, fn: () => void): number {
  e.alert = 0
  e.alertTime = 0
  e.diskError = -1
  try {
    fn()
  } catch (err) {
    // `Ed_DError` also ends in `bra Ed_Loop`, but its message is the
    // interpreter's and not the editor's, so it lands in its own field and
    // the answer here stays 0. `Edit.diskError` is what says which
    if (err instanceof DiskError) {
      e.diskError = err.dos
      return 0
    }
    if (!(err instanceof EditorAlert)) throw err
    e.alert = err.code
    e.alertTime = err.duration
  }
  return e.alert
}
