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
 * The movement and editing commands, 1 to 37, plus the marks (39 to 58),
 * Delete to start of line (64) and Insert mode (75). Those are the ones that
 * need nothing but a program, a window and a cursor.
 *
 * The rest need something this port has not built yet: a block (59 to 63), a
 * file requester (33 to 35), a dialogue (26, 76), a second window (91 to 96),
 * or the interpreter (77, 78). `COMMANDS` has no entry for them and
 * `edCall` throws rather than silently doing nothing, so a key map that
 * reaches one says which.
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
import { TK } from '../tokens/edtok'
import { EMPTY_LINE_BYTES } from './buffer'
import { Edit, EditorAlert } from './edit'
import { EditBuffer } from './editbuf'
import { UN } from './undo'
import { FLAG_FONC, ED_ROUTINES } from './keymap.gen'

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
  DELETE_TO_START: 64,
  FLIP_INSERT: 75,
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

/** `R_DelChar` behind an undo record over the same run (`Un_CLine`) */
function cutRun(e: Edit, col: number, count: number): void {
  const { text } = e.current()
  e.undo.recordLine(UN.CLEAR, e.xCu, e.line, bytes(text.slice(col, col + count)))
  e.buf.delete(e.yCu, col, count)
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
  36: deleteWord,
  37: backWord,
  64: deleteToStart,
  75: (e) => {
    e.insert = !e.insert
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
 *
 * The catch is `Ed_Loop`. `Ed_Alert` never returns to the command that
 * raised it, it branches back to the main loop with the message in
 * `Edt_EtAlert`, so an alert here ends the command and is reported rather
 * than thrown on. Home always alerts -- "Top of text" is what it says when it
 * has worked -- so a caller that treated one as a failure would be wrong
 * about half of them.
 */
export function edCall(e: Edit, cmd: number): number {
  const flags = flagsOf(cmd)
  e.callFlags = flags
  e.alert = 0
  e.alertTime = 0
  const fn = COMMANDS[cmd]
  if (fn === undefined) throw new RangeError(`editor command ${cmd} (${routineOf(cmd)}) is not ported`)
  try {
    if ((flags & FLAG.CLOSED) !== 0) mustEdit(e)
    e.yOldBloc = e.line
    fn(e)
  } catch (err) {
    if (!(err instanceof EditorAlert)) throw err
    e.alert = err.code
    e.alertTime = err.duration
  }
  return e.alert
}
