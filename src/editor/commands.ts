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
 * The windows are 38, 61, 81, 84, 88, 91 to 93, 95, 96, 102, 103, 112, 113 and
 * 153, over the list in ./windows.ts. The Test pass and Indent are 78 and 79,
 * the folds 87, 89 and 90, and the configuration 137 to 142.
 *
 * Quit and the session file are 82, the one-question requesters 26, 76, 83 and
 * 114, what the remote control writes 69, 70, 71, 154 and 182, and the menus'
 * own 27, 104, 148, 179, 180 and 183 plus the 46 `Ed_UserMenu` slots.
 *
 * The menu editors are 73, 74, 135 and 136.
 *
 * The status bar's four arrows are 13 to 16, the printer 86 and 146, the two
 * About boxes 149 and 150, Check 1.3 is 147 and Insert Machine Language 151.
 * Running a program is 77, 105 and 111 and the escape screen is 28, and what
 * either MEANS is the host's: see `Editor.runProgram` and
 * `Editor.escapeScreen`.
 *
 * The 1 that is left is `Ed_GoMonitor` (145), which is +Monitor.s and 4,291
 * lines of its own. `COMMANDS` has no entry for it and `edCall` throws rather
 * than silently doing nothing, so a key map that reaches it says which.
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
import { detokLineBytes, tokeniseLine, type DetokWatch } from '../tokens/edtok'
import { TK } from '../tokens/edtok'
import { MACHINE_CODE_PROC, PROTECTED_PROC } from '../tokens/stream'
import { VerifyError, verify } from '../tokens/verify'
import { ED_MESSAGES, ED_TST_MESSAGES } from '../runtime/edmessages.gen'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'
import { parseAmosFile } from '../loader/amosfile'
import { HUNK_CODE, HUNK_HEADER } from '../amiga/hunk'
import { indentBytes } from './indent'
import { EMPTY_LINE_BYTES, PROC_CLOSED, ProgramBuffer } from './buffer'
import { BF, type BlockView } from './block'
import { DiskError, Edit, EditorAlert } from './edit'
import { EditBuffer } from './editbuf'
import { UN, UndoBuffer, type UndoRecord } from './undo'
import { FLAG_FONC, FLAG_FONC_PAST, ED_ROUTINES } from './keymap.gen'
import { encodeKey, keyToFunc, setKey, type EdKey } from './keymap'
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
import {
  CFG,
  TEXT_BLOCKS,
  changeMessage,
  firstFreeMessage,
  messages,
  readConfig,
  writeConfig,
} from './config'
import {
  AMOS_EXT,
  NEW_PROJECT,
  SESSION_NAME,
  readSession,
  writeSession,
} from './session'
import { EDM_HIDDEN_MAX, EDM_USER_COMMANDS, EDM_USER_LONG, EDM_USER_MAX, hiddenPage } from './menus'
import { ED_BAS_SY, ED_ETAT_SY, ED_ROW_SY } from './windows'
import type { Editor, PrgCommand } from './windows'
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
  HIDE: 38,
  OPEN_LOAD: 61,
  CLOSE: 81,
  MERGE: 84,
  LOAD_HIDDEN: 88,
  PREV_WINDOW: 91,
  NEXT_WINDOW: 92,
  FLIP_SIZE: 93,
  SPLIT: 95,
  LINK_CURSOR: 96,
  NEW_ALL_HIDDEN: 102,
  OPEN_NEW: 103,
  EDIT_HIDDEN: 112,
  NEW_HIDDEN: 113,
  CLOSE_NAME: 153,
  QUIT: 82,
  SET_TAB: 26,
  USER_MENU: 27,
  KEY_TO_MENU: 73,
  PROGRAM_TO_MENU: 74,
  ADD_USER: 135,
  DEL_USER: 136,
  SHOW_KEY: 104,
  SOUND_ON: 148,
  PREV_HIDDEN: 179,
  NEXT_HIDDEN: 180,
  GO_HELP: 183,
  ZAP_NEW_LINE: 69,
  RE_ALERT: 70,
  ZAP_NEW_LINE_TOK: 71,
  RENAME: 154,
  ZAP_NEW_CONFIG: 182,
  GOTO_LINE: 76,
  INFOS: 83,
  SET_BUFFER: 114,
  PRINT_PROGRAM: 146,
  PRINT_BLOCK: 86,
  ABOUT: 150,
  ABOUT_EXT: 149,
  ETAT_UP: 13,
  ETAT_DOWN: 14,
  BAS_UP: 15,
  BAS_DOWN: 16,
  TEST: 78,
  CHECK_13: 147,
  INDENT: 79,
  PROC_OPEN: 87,
  PROC_ML: 151,
  RUN: 77,
  ESCAPE: 28,
  RUN_HIDDEN: 111,
  WORKBENCH: 105,
  PROCS_OPEN: 89,
  PROCS_CLOSE: 90,
  CONFIG_SAVE_DEFAULT: 137,
  CONFIG_SAVE_AS: 138,
  CONFIG_LOAD_DEFAULT: 139,
  CONFIG_LOAD_AS: 140,
  QUIT_OPTIONS: 141,
  SET_AUTOSAVE: 142,
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
  // past the table is not an error: `Ed_FCall` reads the byte whatever the
  // number is, and ./keymap.gen.ts says what it finds there
  const f = FLAG_FONC[cmd - 1] ?? FLAG_FONC_PAST[cmd - 1 - FLAG_FONC.length]
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
      // `Ed_GetPlace` (:9915), whose Cancel is not one: `.GtPl2` clears
      // `Prg_Change` so the program is not offered for saving, and falls into
      // the Set Buffer Size requester with the size the file needs already in
      // the field. Either way the load is tried again
      if (confirm(e, { which: 37, count: r.needs }) === 1) {
        e.prog.chgTTexte(r.needs)
      } else {
        e.prog.changed = false
        edSB(e, r.needs)
      }
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
 * `BlToA0` (:6541) and `BlToA1` under it: the block as lines of text.
 *
 * A record that holds nothing produces no line at all (`.1Vide`), so a block
 * that starts at the end of a line does not begin with a blank one.
 */
function blockLines(e: Edit, b: BlockView): string[] {
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
  return lines
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
  const lines = blockLines(e, b)
  const out = lines.length === 0 ? '' : lines.join('\n') + '\n'
  if (!fs.writeFile(e.name1, bytes(out))) throw new DiskError()
}




/* ---- 149 and 150: the two About boxes ----------------------------------- */

/** `VersionN` (+B.s:354), which is " Version " and the `Version` macro after it */
export const ED_VERSION = ' Version 2.00'

/**
 * `UserReg` (+B.s:314) and `UserName` (:328) as the assembler lays them out:
 * a length word and fourteen bytes, each XORed with its own key.
 *
 * The two sit sixteen bytes apart, which is what `lea 16(a0),a0` in `Ed_About`
 * steps over. Install.AMOS writes the buyer's details over both. What is in
 * the shipped source is what a copy that was never installed shows, and the
 * placeholders are the evidence: "REGISTRATION #" where the number belongs and
 * "Not Installed!" where the name does.
 */
const USER_SECU = ((): Uint8Array => {
  const b = new Uint8Array(32)
  const put = (at: number, text: string, key: number): void => {
    b[at + 1] = text.length
    for (let i = 0; i < text.length; i++) b[at + 2 + i] = text.charCodeAt(i) ^ key
  }
  put(0, 'REGISTRATION #', 0x73)
  put(16, 'Not Installed!', 0xa5)
  return b
})()

/**
 * `Sys_UnCode` (+B.s:595): the length word straight through, then every byte
 * XORed with d0.
 *
 * It answers the sum of the DECODED bytes in d0, a checksum both callers here
 * throw away. `Sys_VerInstall` (:585) does not read it either; it tests the
 * length words alone, and both ship as 14.
 */
export function sysUnCode(src: Uint8Array, at: number, key: number): string {
  const n = (src[at]! << 8) | src[at + 1]!
  let out = ''
  for (let i = 0; i < n; i++) out += String.fromCharCode(src[at + 2 + i]! ^ key)
  return out
}

/**
 * `Ed_About` (+Edit.s:4580), `JFonc` 150.
 *
 * Four of `Ed_VDialogues`'s sixteen slots, and requester 0, which is the same
 * `EdD_Title` the editor puts up when it starts. The count is over
 * `AdTokens+4` with `moveq #26-1,d0`, so the core token table at `AdTokens`
 * itself is not one of the twenty-six.
 */
function about(e: Edit): void {
  let count = 0
  for (const t of e.editor.extensions) if (t !== null) count++
  confirm(e, {
    which: 0, // EdD_Title
    values: [undefined, count],
    strings: [ED_VERSION, undefined, sysUnCode(USER_SECU, 16, 0xa5), sysUnCode(USER_SECU, 0, 0x73)],
  })
}

/**
 * `.Next` (:4650): the next slot with a library in it, and the slot it was
 * already on when there is none.
 *
 * The walk writes d3 and a3 only when it finds something, so a failed step
 * leaves them where they were and `.Loop` shows the same extension again.
 * Nothing tells the user the end has been reached; the button simply stops
 * doing anything.
 */
function extNext(list: readonly (string | null)[], from: number): number {
  let n = from
  while (n < 26) {
    n++
    if (list[n - 1] !== null) return n
  }
  return from
}

/** `.Prev` (:4640), the same walk upwards, which stops at slot 1 */
function extPrev(list: readonly (string | null)[], from: number): number {
  let n = from
  while (n > 1) {
    n--
    if (list[n - 1] !== null) return n
  }
  return from
}

/**
 * `Ed_AboutExt` (:4609), `JFonc` 149: one extension at a time, with Previous
 * and Next.
 *
 * The requester is put up again from inside the routine rather than from
 * `Ed_Loop`, so the whole browse is one command. Answer 1 is Previous, 2 is
 * Next, and anything else ends it. With no extensions loaded at all the first
 * `.Next` finds nothing, d3 stays zero, and the box never appears.
 */
function aboutExt(e: Edit): void {
  const list = e.editor.extensions
  let at = extNext(list, 0)
  if (at === 0) return
  for (;;) {
    // `LB_Title(a0)` of zero is `.Empty dc.w 0`, an Interface string with no
    // characters, so a library with no title shows a blank line and a number
    const answer = confirm(e, { which: 55, values: [at], strings: [undefined, list[at - 1] ?? ''] })
    if (answer === 1) at = extPrev(list, at)
    else if (answer === 2) at = extNext(list, at)
    else return
  }
}

/* ---- 13 to 16: the status bar's four arrows ----------------------------- */

/**
 * `Ed_RShLimits` (+Edit.s:1439): how far the TOP separator of `w` may go.
 *
 * `Edt_WMaxSize` is asked with a limit of zero, so `min` is where the top
 * would be with every window above it emptied of text. `max` is the other end,
 * less the height of whatever the drag carries with it: a window in the middle
 * of the list takes its own bar, its text and its bottom bar along, and the
 * last window in the list takes only its top bar because its bottom cannot
 * move.
 */
function shLimits(e: Edit): { min: number; max: number } {
  const editor = e.editor
  const { min, max } = editor.wMaxSize(e, 0)
  if (e.last) return { min, max: max - (ED_ETAT_SY + ED_BAS_SY) }
  return { min, max: max - (e.windTy * ED_ROW_SY + ED_ETAT_SY + ED_BAS_SY) }
}

/** `Ed_RSbLimits` (:1479): the same for the BOTTOM separator */
function sbLimits(e: Edit): { min: number; max: number } {
  const { min, max } = e.editor.wMaxSize(e, 0)
  return { min: min + ED_ETAT_SY, max }
}

/**
 * `Ed_EtatMove` (:1512) and `Ed_BasMove` (:1535), which are the same routine
 * twice over.
 *
 * `delta` is the `moveq #-8` or `moveq #8` the four entry points supply, so a
 * keypress moves one text row. Both bounds are exclusive: `bls` refuses a
 * position at the minimum and `bge` one at the maximum, so the separator stops
 * one row short of squeezing something to nothing.
 *
 * The first window has no top separator and the last has no bottom one, and
 * each refuses before it works anything out.
 */
function sepMove(e: Edit, delta: number, bottom: boolean): void {
  e.tokCur()
  if (bottom ? e.last : e.first) return
  const { min, max } = bottom ? sbLimits(e) : shLimits(e)
  const to = (bottom ? e.editor.basY(e) : e.editor.topY(e)) + delta
  if (to <= min || to >= max) return
  const moved = bottom ? e.editor.wChangeBas(e, to) : e.editor.wChangeHaut(e, to)
  if (!moved) return
  // `Edt_WVideNext` before `Ed_DrawWindows`, so the window the cursor is in
  // has rows again by the time anything is drawn
  e.editor.videNext()
  drawWindows(e.editor)
}

/* ---- 86 and 146: the printer, which is Par: ----------------------------- */

/**
 * `Ed_PRTOpen` (+Edit.s:13974), and what the name it opens turns out to be.
 *
 * `moveq #43,d0 / JJsr L_Sys_GetMessage` reaches `Par:`, not `PRT:`
 * (+Interpreter_Config.s:153). The editor writes to the parallel port raw,
 * past printer.device and past whatever Preferences was told, so a driver, a
 * page size and a character set are all beside the point.
 */
function prtOpen(e: Edit): (data: Uint8Array) => boolean {
  const sink = e.editor.printer
  if (sink === null) throw new EditorAlert(216) // Ed_PErr
  return sink
}

/**
 * `Ed_PRTPrint` (:13987): one zero-terminated string to the printer.
 *
 * The loop rewrites the string over itself. A 13 whose next byte is a 10 is
 * REPLACED by that 10 when `PI_PrtRet` is clear, so a printer that supplies
 * its own line feed is sent one character where the editor wrote two.
 */
function prtPrint(e: Edit, sink: (data: Uint8Array) => boolean, text: string): void {
  const buf = new Uint8Array(text.length + 1)
  for (let i = 0; i < text.length; i++) buf[i] = text.charCodeAt(i) & 0xff
  let a0 = 0
  let a1 = 0
  for (;;) {
    const d0 = buf[a0++]!
    buf[a1++] = d0
    if (d0 === 0) break
    if (d0 !== 13) continue
    if (e.editor.prtRet !== 0) continue
    if (buf[a0] !== 10) continue
    buf[a1 - 1] = buf[a0++]!
  }
  // DEFECT: `.Ip2` measures how far a0 got, which counts the INPUT, and
  // writes that many bytes from the front of the buffer. Every carriage
  // return the loop dropped leaves one byte of the old contents past what it
  // built, and that byte goes to the printer too. With one line ending per
  // call it is the terminating zero. `PRT_Print` (+Lib.s:5451) does the same
  // arithmetic, so `Lprint` sends it as well.
  if (!sink(buf.subarray(0, a0 - 1))) throw new EditorAlert(216)
}

/**
 * `Ed_AverMess` (:7665) and `Ed_AverFin` (:7699): a box in front of the text
 * that says what is happening, and is taken down when it stops.
 *
 * Nothing waits on it. `Dia_RunQuick` draws and returns, and the count is the
 * Interface block number, so a second warning stacks on the first.
 */
function averMess(e: Edit, message: number): void {
  e.editor.avert.push(message)
}

function averFin(e: Edit): void {
  e.editor.avert.pop()
}

/**
 * `Ed_PrgPrint` (:6463), `JFonc` 146: the whole listing, one line per write.
 *
 * `bclr #BitControl-8,T_Actualise(a5)` at the head of the loop reads the
 * Control key and clears it in the same instruction, so holding Control stops
 * the job wherever it is and the pages already sent stay sent.
 */
function prgPrint(e: Edit): void {
  e.tokCur()
  if (confirm(e, { which: 61 }) !== 1) notDone(e) // EdD_PProg
  averMess(e, 217) // "Printing program"
  try {
    const sink = prtOpen(e)
    let at = e.prog.findLine(0)
    while (at.found) {
      if (e.abort) {
        e.abort = false
        break
      }
      prtPrint(e, sink, detokLineBytes(e.prog.bytes, at.at, e.table, e.opts) + '\r\n')
      at = e.prog.nextLine(at.at)
    }
  } finally {
    averFin(e)
  }
}

/**
 * `Ed_BlocPrint` (:6504), `JFonc` 86, over the same `BlToA0`/`BlToA1` walk
 * Save Block Ascii uses.
 *
 * The 13 and the 10 are poked past each line before the write rather than
 * between writes, so the last line gets an ending too.
 */
function blocPrint(e: Edit): void {
  e.tokCur()
  const b = e.block.read()
  if (b === null) throw new EditorAlert(6) // Ed_BlocWhat
  if (confirm(e, { which: 60 }) !== 1) notDone(e) // EdD_PBloc
  averMess(e, 157) // "Printing block"
  try {
    const sink = prtOpen(e)
    for (const line of blockLines(e, b)) {
      if (e.abort) {
        e.abort = false
        break
      }
      prtPrint(e, sink, line + '\r\n')
    }
  } finally {
    averFin(e)
  }
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

/* ---- 38, 61, 81, 84, 88, 91 to 96, 102, 103, 112, 113 and 153: the windows -- */

/** `PI_DefSize` (+Interpreter_Config.s:38): 32K, the buffer a new window gets */
const DEF_SIZE = 1024 * 32

/** `HiddenCommands` (+Edit.s:3262) and `HiddenCall` (:3263) */
const HIDDEN_COMMANDS = 184
const HIDDEN_CALL = 111

/** `Ed_NotDone` (:9825), which redraws the window before it gives up */
function notDone(e: Edit): never {
  e.fill()
  throw new EditorAlert(206)
}

/**
 * `Edt_OpWindow` (:11244): one more window on the list.
 *
 * `prog` is what `Prg_NewStructure` would have made. The machine passes a
 * buffer size in d1, and a NEGATIVE size means "no program structure at all",
 * which is what Split View asks for because it is about to point the new
 * window at the old one's program. Here that is the same thing as handing this
 * the program to share: either way `Prg_Edited` counts one more window.
 *
 * DEFECT: `Edt_New` at the end of this calls `Prg_UndoCreate` and
 * `Prg_MarkRaz`, and both work on a6. The split path never loaded a6 with
 * anything, so a6 is still the CALLER's program: splitting a view frees that
 * program's undo history and clears all ten of its marks. Nothing in
 * `Ed_SplitWindow` puts either back.
 */
function opWindow(from: Edit, visible: boolean, prog: ProgramBuffer): Edit {
  const editor = from.editor
  // `sub.l a0,a0 / bsr Edt_WCount / cmp.w Ed_WMax(a5),d0 / bcc .Rate`
  if (visible && editor.count() >= editor.wMax) throw new EditorAlert(3, 127) // Ed_2ManyWindow
  const w = new Edit(prog, new EditBuffer(0), new UndoBuffer(from.undo.length), from.table, from.opts, editor)
  w.hidden = 2 // "2 car aucune zone creee"
  if (visible) {
    w.hidden = 0
    editor.current = w
    editor.schrinkAll(1)
    w.windTy = editor.maxSize(w, -1)
  }
  edtNew(w, prog === from.prog ? from : w)
  return w
}

/**
 * `Edt_New` (:10910): the window's own fields back to zero.
 *
 * Every word from `Edt_SInit` to `Edt_EInit` is cleared and then -1 goes back
 * into the two block fields, which is why a new window has no block rather
 * than a block on line 0. `owner` is the window whose program a6 was pointing
 * at when this ran, and it is not always this one: see `opWindow`.
 */
function edtNew(w: Edit, owner: Edit): void {
  w.xPos = 0
  w.yPos = 0
  w.xCu = 0
  w.yCu = 0
  w.edited = 0
  w.yBloc = -1
  w.yOldBloc = -1
  owner.undo.raz() // Prg_UndoCreate (:1977)
  owner.prog.marks.fill(0) // Prg_MarkRaz (:4183)
}

/**
 * `Ed_DrawWindows` (:11594), as much of it as means anything without pixels.
 *
 * The order is the machine's: take the screen areas down, number the visible
 * windows, work out which is first and which is last, then walk the list
 * putting each cursor back inside its window and refilling its rows. What is
 * dropped is the geometry, `Edt_Y` and a slider and three buttons per window.
 * `Edt_Window` survives because it is the zone number a click comes back as,
 * and `Edt_GetAd` is what turns one into a window again.
 *
 * `Edt_First` and `Edt_Last` are worked out here and nowhere else, so a window
 * that has never been drawn does not know whether it is alone. The machine
 * draws at boot (`Ed_OpenIt` :313) and a host of this port has to do the same.
 */
export function drawWindows(editor: Editor): void {
  editor.effWindows()
  editor.orderWindows()
  editor.firstLast()
  for (const w of editor.list) {
    if (w.hidden !== 0) continue
    // a cursor past the end of the program goes back to the top, whole
    if (w.yCu + w.yPos > w.prog.lineCount) {
      w.yCu = 0
      w.yPos = 0
    }
    // `.Sl`: and one below the last row scrolls the window instead
    const bottom = w.windTy - 1
    if (bottom >= 0 && w.yCu > bottom) {
      w.yPos += w.yCu - bottom
      w.yCu = bottom
    }
    w.window = w.order * 8
    w.fill()
  }
}

/**
 * `Edt_Active` (:12079): make `w` current, if it has any rows.
 *
 * The only test is `Edt_WindTy`. `Ed_TokCur` before it works on a4, the window
 * being left, and not on the one being entered.
 */
function activate(w: Edit): boolean {
  w.editor.current?.tokCur()
  if (w.windTy === 0) return false
  w.editor.current = w
  w.fill()
  return true
}

/** `Ed_OpenWindow` (:11228): a new window with an empty program in it */
function openWindow(e: Edit): void {
  e.tokCur()
  opWindow(e, true, ProgramBuffer.create(DEF_SIZE))
  drawWindows(e.editor)
}

/**
 * `Ed_RLoadHidden` (:13345): a window nobody can see, with a file in it.
 *
 * `Prg_Load` is called with -1, "adapter la taille du buffer", so there is no
 * EdD_TooSmall here and no retry: the buffer is made to fit the file. The
 * window goes into `Ed_WindowToDel`, and whether it survives is decided by
 * whether its caller clears that.
 */
function rLoadHidden(e: Edit): Edit {
  const fs = disc(e)
  const bytes = fs.readFile(e.name1)
  if (bytes === null) throw new DiskError(205)
  const r = readProgramFile(bytes)
  if (r.error === PRG.NOT_AMOS) throw new EditorAlert(207) // Ed_PaAMOS
  if (r.error !== PRG.OK) throw new DiskError()
  const f = r.file!
  const w = opWindow(e, false, ProgramBuffer.load(f.source, r.needs))
  e.editor.windowToDel = w
  w.prog.pro = f.pro
  w.prog.mathFlags = f.mathFlags
  w.prog.banks = f.banks
  w.prog.name = e.name1
  w.prog.changed = false
  // `move.b #1,Prg_StModif(a6)`, "force le test", the same as a visible load
  w.prog.modified = true
  return w
}

/** `Ed_New` (:10896): Ed_TokCur, Ed_Saved, and then the program emptied */
function newCmd(e: Edit): void {
  e.tokCur()
  saved(e)
  newProgram(e)
}

/**
 * `Ed_CloseWindow` (:11393) and `Ed_CloseWindowQuit` (:11388) above it, which
 * is the same routine entered with a word pushed.
 *
 * A window that is not half of a split gets a New first, so the program in it
 * is offered for saving. A split half does not, because the program is still
 * open in the other half.
 *
 * The last window on the screen is never closed: closing it is how AMOS
 * Professional is left, and `Ed_DoQuit` (:4383) takes over. Without the quit
 * word, and under the ZAP remote control, the command simply does nothing.
 */
function closeWindow(e: Edit, w: Edit, quit: boolean): void {
  const editor = e.editor
  w.tokCur()
  if (w.linkPrev === null && w.linkNext === null) newCmd(w)
  if (w.first && w.last) {
    if (!quit || editor.zappeuse) return
    // `btst #0,Ed_QuitFlags(a5)`: ask first, and any answer but the first
    // button leaves the editor open
    if ((editor.quitFlags & 1) !== 0 && confirm(e, { which: 62 }) !== 1) return // EdD_WQuit
    editor.quit = true
    return
  }
  editor.effWindows()
  editor.delWindow(w)
  const now = editor.current
  if (now !== null) now.windTy = editor.maxSize(now, -1)
  drawWindows(editor)
}

/**
 * `Ed_WindowHide` (:11306): the current window off the screen, program and all.
 *
 * A split view cannot be hidden. The loop above `.PaLink` closes every window
 * linked to this one first, one at a time, so hiding half of a split closes
 * the other half and then hides what is left.
 */
function windowHide(e: Edit): void {
  const editor = e.editor
  e.tokCur()
  for (;;) {
    const link = e.linkPrev ?? e.linkNext
    if (link === null) break
    closeWindow(e, link, false)
    editor.current = e
  }
  if (editor.alone(e)) throw new EditorAlert(2) // Ed_NoHide
  editor.delLinkScroll(e)
  e.hidden = 1
  // any open window will do, and if none will have it, one with no rows will
  const now = editor.wAutre(e, 1) ?? editor.wAutre(e, 0)
  if (now !== null) now.windTy = editor.maxSize(now, -1)
  drawWindows(editor)
}

/**
 * `Ed_SplitWindow` (:2448): a second view on the SAME program.
 *
 * The new window goes into a chain of its own, `Edt_LinkPrev` and
 * `Edt_LinkNext`, which is what tells the rest of the editor that these two
 * are halves of one thing. Then nine words of cursor state are copied across,
 * `Edt_SSplit` to `Edt_ESplit`, so the new half opens on exactly what the old
 * half was looking at. It is also the new current window.
 */
function splitWindow(e: Edit): void {
  const w = opWindow(e, true, e.prog)
  w.linkPrev = e
  w.linkNext = e.linkNext
  e.linkNext = w
  if (w.linkNext !== null) w.linkNext.linkPrev = w
  w.xPos = e.xPos
  w.yPos = e.yPos
  w.xCu = e.xCu
  w.yCu = e.yCu
  w.edited = e.edited
  drawWindows(e.editor)
}

/**
 * `Ed_LinkCursor` (:2342): this window scrolls when another one does.
 *
 * One link per window and it is not symmetric: the window picked is the one
 * that FOLLOWS this one. `Edt_LinkYOld` remembers where this cursor was, so
 * the follower can be moved by the difference rather than to a line number.
 */
function linkCursor(e: Edit): void {
  e.tokCur()
  e.linkScroll = null
  if (e.dialogues === null) notDone(e)
  const zone = e.dialogues.pickWindow()
  if (zone === 0 || zone === e.window) notDone(e)
  const target = e.editor.getAd(zone)
  if (target === null) notDone(e)
  e.editor.delLinkScroll(target)
  e.linkScroll = target
  e.linkYOld = e.line
}

/**
 * `Ed_LinkeScroll` (:2384): move every window that follows this one.
 *
 * `Ed_Loop` calls it after a command, not the command itself. Each window in
 * the chain works out its own delta from its own `Edt_LinkYOld`, so the move
 * propagates down a chain of any length, and only `Edt_YPos` changes: the
 * follower's cursor stays on the screen row it was on.
 *
 * `Edt_LinkFlag` is the whole of the recursion guard, and it is raised on the
 * window doing the moving and tested on the one being moved. So a ring of
 * linked windows moves once round and stops.
 */
export function linkScroll(e: Edit): void {
  const follower = e.linkScroll
  if (follower === null) return
  const now = e.line
  if (now === e.linkYOld) return
  const by = now - e.linkYOld
  e.linkYOld = now
  e.linkFlag = true
  try {
    if (follower.linkFlag) return
    let top = follower.yPos + by
    if (top < 0) top = 0
    if (top + follower.yCu >= follower.prog.lineCount) {
      const fit = follower.prog.lineCount - follower.yCu
      if (fit < 0) {
        follower.yCu = follower.prog.lineCount
        top = 0
      } else top = fit
    }
    follower.yPos = top
    if (follower.windTy !== 0) follower.fill()
    linkScroll(follower)
  } finally {
    e.linkFlag = false
  }
}

/**
 * `Ed_SchrinkWindow` (:12188): this window down to `min` rows, the rest to
 * whoever is next.
 *
 * The rows come off this window and go to the one below it, or to the one
 * above when there is nothing below. There is no test on that second answer
 * and none is needed: `Edt_WAlone` has already refused the only case where
 * both would be empty.
 */
function schrinkWindow(e: Edit, min: number): void {
  const editor = e.editor
  e.tokCur()
  if (editor.alone(e)) return
  const was = e.windTy
  if (min >= was) return
  e.windTy = min
  const other = editor.wNext(e) ?? editor.wPrev(e)
  if (other !== null) other.windTy += was - min
  // `Edt_WVideNext` (:11953): a current window with no rows hands over
  const now = editor.current
  if (now !== null && now.windTy === 0) editor.wAutre(now, 1)
  drawWindows(editor)
}

/**
 * `Ed_FlipSizeWindow` (:12138): roll the window up to its two bars, or back
 * out again.
 *
 * Rolled out, it asks the windows BELOW it for the rows first and the ones
 * above only for what is still missing, then takes whatever it could not get
 * off its own height. A window alone on the screen cannot be rolled up at all,
 * because `Ed_SchrinkWindow` refuses.
 */
function flipSizeWindow(e: Edit): void {
  const editor = e.editor
  e.tokCur()
  if (e.windTy !== 0) {
    e.windOldTy = e.windTy
    schrinkWindow(e, 0)
    return
  }
  let want = e.windOldTy
  if (want === 0) want = editor.maxSize(e, 1)
  e.windTy = want
  let short = editor.placeBas(e, want, 1)
  if (short !== 0) short = editor.placeHaut(e, short, 1)
  if (short !== 0) e.windTy -= short
  drawWindows(editor)
}

/**
 * `Ed_NextWindow` (:12098) and `Ed_PrevWindow` (:12114): the next open window.
 *
 * DEFECT: both wraps go to an END OF THE LIST rather than to a visible window.
 * Next takes `Edt_List`, the head, and Prev walks `Edt_WNext` until it stops
 * and then uses a0, which the walk left on the last element of the list and
 * not on the last VISIBLE one. `Edt_Active` then tests nothing but
 * `Edt_WindTy`, and a window hidden by Hide Project keeps the height it had.
 * So with a hidden window at either end of the list, wrapping round makes it
 * current, and the editor is looking at a window with no screen area.
 */
function nextWindow(e: Edit): void {
  const editor = e.editor
  e.tokCur()
  let at = e
  for (;;) {
    at = editor.wNext(at) ?? editor.list[0]!
    if (at === e) return
    if (activate(at)) return
  }
}

function prevWindow(e: Edit): void {
  const editor = e.editor
  e.tokCur()
  let at = e
  for (;;) {
    let back = editor.wPrev(at)
    if (back === null) {
      if (e.last) return
      back = editor.list[editor.list.length - 1]!
    }
    if (back === e) return
    at = back
    if (activate(back)) return
  }
}

/**
 * `Ed_Merge` (:13446): another program's tokens dropped in at the cursor.
 *
 * The file is loaded into a hidden window and its whole source is stored as
 * one block, which is `Ed_StoBlock` and no tokenising at all. What makes it a
 * merge rather than a load is what happens next: `Ed_WindowToDel` is left set,
 * so `Ed_Loop` (:915) deletes the window on the way back and the program that
 * was read is gone. `Ed_LoadHidden` runs the same load and clears the field.
 *
 * `Edt_ClearVar` (:3035) comes first on the machine and frees the interpreter's
 * variables to make room. There are none to free here.
 */
function merge(e: Edit): void {
  e.tokCur()
  if (!selectFile(e, 78)) notDone(e)
  e.block.free() // Ed_BlocFree
  e.undo.raz() // Prg_UndoRaz
  const from = rLoadHidden(e)
  const to = e.editor.current ?? e
  const src = programSource(from.prog)
  if (src.length !== 0) {
    const lines = from.prog.lineCount
    const at = to.line
    const r = to.prog.storeBlock(at, src)
    if (r.error !== 0) throw new EditorAlert(202, 200) // Ed_OofBuf
    to.prog.marksChange(at, lines)
  }
  to.prog.countLines()
  to.fill()
}

/** `Ed_LoadHidden` (:13370): the same load, kept */
function loadHidden(e: Edit): void {
  e.tokCur()
  if (!selectFile(e, 66)) notDone(e)
  rLoadHidden(e)
  e.editor.windowToDel = null
}

/** `Ed_EditHidden` (:11468): a hidden program back on the screen */
function editHidden(e: Edit, n: number): void {
  const editor = e.editor
  e.tokCur()
  const w = editor.getHidden(n)
  if (w === null) notDone(e)
  if (editor.count() >= editor.wMax) throw new EditorAlert(3, 127) // Ed_2ManyWindow
  editor.current = w
  w.hidden = 0
  editor.schrinkAll(1)
  w.windTy = editor.maxSize(w, -1)
  w.undo.raz() // Prg_UndoCreate
  drawWindows(editor)
}

/** `Ed_NewHidden` (:11434): a hidden program offered for saving, then dropped */
function newHidden(e: Edit, n: number): void {
  e.tokCur()
  const w = e.editor.getHidden(n)
  if (w === null) notDone(e)
  saved(w)
  e.editor.delWindow(w)
}

/**
 * `Ed_NewAllHidden` (:11448): every hidden program, one requester for the lot.
 *
 * `.In` asks for hidden program 0 every time round, so the list walks itself
 * down as each one goes. The per-program "not saved. Save?" still comes up, so
 * the one Yes at the top is not the last question.
 */
function newAllHidden(e: Edit): void {
  e.tokCur()
  if (confirm(e, { which: 3 }) !== 1) return // EdD_NAll
  for (;;) {
    const w = e.editor.getHidden(0)
    if (w === null) return
    saved(w)
    e.editor.delWindow(w)
  }
}

/**
 * `Ed_CloseName` (:11207): close every window holding the file in `Name1`.
 *
 * It loops because two windows can hold the same program, and it stops at the
 * first one that is RUNNING rather than skipping it, so a running accessory
 * leaves the windows behind it open too.
 */
function closeName(e: Edit): void {
  for (;;) {
    const w = e.editor.accAdr(e.name1)
    if (w === null) return
    if (e.editor.dejaRunned(w.prog)) return // `L_Prg_DejaRunned / bne .Fini`
    closeWindow(e, w, false)
  }
}

/* ---- 78, 79, 87, 89 and 90: the Test pass, and the folds ---------------- */

/**
 * `Ed_VaTester` (+Edit.s:8567) and `Prg_TestIt` (+Verif.s:4406) under it.
 *
 * The verifier is not a syntax checker the editor runs for reassurance. It
 * WRITES: it fills the link words, promotes names, and puts the size of every
 * procedure body into the `Procedure` line at offset 4. That last one is why
 * three of the commands below have to test before they do anything, because a
 * fold that has never been tested carries a zero size and closing it steps 14
 * bytes into the middle of the line's own name record.
 *
 * `Prg_StModif` is what decides whether there is anything to do, and it is
 * cleared BELOW the call to `PTest` (+Verif.s:4426-4427). An error never reaches
 * that instruction, so a program that fails Test stays modified and the next
 * command tests it again.
 *
 * DEVIATION: `PTest` pokes the program where it lies, so a failed test leaves
 * behind every poke it had made before it stopped. `verify()` works on a copy
 * and hands it back whole, so here a failed test changes nothing.
 *
 * `Prg_TestIt` copies two verdicts out of the verifier when it is done:
 * `VerNot1.3` into `Prg_Not1.3` (+Verif.s:4428), which is what decides
 * whether the next Save writes an `AMOS Basic v134` header, and `MathFlags`
 * into `Prg_MathFlags`.
 *
 * DEVIATION: only the first is taken here. This port's verifier tracks double
 * precision, which is bit 7, and not the two "some maths happened" bits below
 * it, so `Prg_MathFlags` keeps whatever the file said.
 */
function vaTester(e: Edit, check13 = false, always = false): void {
  // `tst.b Prg_StModif(a6) / beq.s .Ok` (:8568) is `Ed_VaTester`'s and not the
  // Test pass's. `Prg_RunIt` calls `PTest` outright, so a Run always tests
  if (!always && !e.prog.modified) return
  const src = programSource(e.prog)
  let out: Uint8Array
  const stats = { instructions: 0, not13: false }
  try {
    out = verify(src, { stats, check13, bankNumbers: bankNumbers(e.prog) })
  } catch (err) {
    if (!(err instanceof VerifyError)) throw err
    // `Prg_JError`, which PTest longjmps to: the cursor goes to the error
    // and the command that asked for the test is abandoned
    errTest(e, err.at)
    throw err
  }
  e.prog.bytes.set(out, e.prog.stBas)
  e.prog.modified = false
  e.prog.pro = stats.not13
  e.editor.verNInst = stats.instructions
}

/**
 * `Cur_Banks` as numbers, for `PTest`'s bank test (+Verif.s:188).
 *
 * DEVIATION: the machine holds the banks as a linked list it built when the
 * program loaded, and reads the number out of each header at offset 8. This
 * port keeps the `AmBs` block as bytes, so the numbers come back out of it
 * every time. A sprite bank is 1 and an icon bank is 2 by definition, and
 * neither can reach the 17 the test is looking for.
 */
function bankNumbers(prog: ProgramBuffer): number[] {
  // "AmBs" and a count word, which is the whole block when the count is zero
  if (prog.banks.length < 6) return []
  if (((prog.banks[4]! << 8) | prog.banks[5]!) === 0) return []
  return parseAmosFile(prog.banks).banks.map((b) =>
    b.kind === 'memory' ? b.number : b.kind === 'icons' ? 2 : 1,
  )
}

/**
 * `Ed_Check1.3` (+Edit.s:8441): will this program run under AMOS 1.3?
 *
 * `VerCheck1.3` turns `SetNot1.3` from a flag into a stop, so the first thing
 * 1.3 does not have ends the test with error 47 on its own line and the alert
 * below is never reached. `PTest` clears the flag at :186, above the bank
 * walk, so message 48 can only ever be about banks and message 49 means the
 * walk found nothing at all.
 *
 * `Prg_StModif` is forced because the verdict is not kept anywhere a second
 * call could read: without it, asking twice in a row would answer from a test
 * that never ran.
 */
function check13(e: Edit): void {
  e.tokCur()
  e.prog.modified = true
  vaTester(e, true)
  // `moveq #49,d0 / tst.b VerNot1.3 / beq .Go / moveq #48,d0`, and the 127 in
  // front of `bra Ed_Alert` is the duration and not a message number
  const msg = e.prog.pro ? 48 : 49
  throw new EditorAlert(msg, 127, ED_TST_MESSAGES[msg - 1] ?? `test message ${msg}`)
}

/**
 * `Ed_SetXY` (:10157): the cursor onto the byte at `at`, wherever that is.
 *
 * When the byte turns out to be inside a CLOSED procedure the cursor cannot go
 * there, so the column is dropped to 0 and the real one is kept in
 * `Prg_XEProc` against the fold being opened. `clr.w (sp)` is the whole of
 * that decision.
 */
function setXY(e: Edit, at: number, column: number): void {
  e.prog.adEProc = 0
  e.prog.eProcStale = false
  e.prog.xEProc = column
  const f = e.prog.findAddress(at)
  let x = column
  if (f.proc >= 0) {
    e.prog.adEProc = f.start
    x = 0
  }
  setY(e, f.line)
  setX(e, x)
  e.fill()
}

/**
 * `Ed_ErrTest` (:8246): where a failed Test leaves the cursor.
 *
 * `VerPos` is the byte the verifier stopped on. `Detok` is run over the line
 * it falls in with that address to watch for, and the column it reports is
 * where the token's text begins.
 *
 * `Ed_ErrTest` is two instructions and a `bra Ed_Errr`, which is the same
 * dispatch a stopped PROGRAM comes back through. `edRunReturn` below is the
 * rest of it.
 */
function errTest(e: Edit, at: number): void {
  const target = e.prog.stBas + at
  setXY(e, target, errLine(e, target).column)
}

/**
 * `bsr Detok` over the line an address falls in, watching for that address.
 *
 * Two callers want the same three answers: `Ed_ErrTest` wants the column,
 * `Ed_Ligne` (:8362) wants the line number and the text as well.
 */
function errLine(e: Edit, target: number): { line: number; text: string; column: number } {
  const f = e.prog.findAddress(target)
  const watch: DetokWatch = { at: target, column: -1 }
  const text = detokLineBytes(e.prog.bytes, f.start, e.table, e.opts, watch)
  return { line: f.line, text, column: Math.max(0, watch.column) }
}

/**
 * `Ed_ClEProc` (:8861): stop the auto-centring, one command at a time.
 *
 * `Ed_FCall` runs this before every command body. The first one after a failed
 * Test raises bit 31 of the stored address and still has the address to work
 * with; the second finds the bit up and clears the long. So opening the fold
 * and being taken to the error is worth exactly one command.
 */
function clEProc(e: Edit): void {
  if (e.prog.adEProc === 0) return
  if (e.prog.eProcStale) {
    e.prog.adEProc = 0
    e.prog.eProcStale = false
    return
  }
  e.prog.eProcStale = true
}

/**
 * `Ed_ProcOpen` (:8807): fold the procedure the cursor is in, or unfold it.
 *
 * `Edt_DebProc` is what the line walk left behind, so this works from inside
 * an open procedure's body as well as from its header, and a cursor on
 * `End Proc` has no procedure at all: `Fnd8` clears it on the way past.
 *
 * Bit 14 of the flags word is the LOCK, and a locked procedure is silently
 * left alone -- `.Out` skips straight to the redraw with no message.
 *
 * Closing runs the Test pass first, because the fold is stepped over by the
 * size the verifier writes. Opening does not, and there is nothing to be
 * gained by testing to unfold.
 */
function procOpen(e: Edit): void {
  e.tokCur()
  const at = e.prog.findLine(e.line).proc
  if (at < 0) throw new EditorAlert(203) // Ed_FoE, "Not a procedure."
  if ((e.prog.procFlags(at) & PROTECTED_PROC) !== 0) {
    e.fill()
    return
  }
  // `btst #7,10(a2) / bne .PaOu`: only a close is worth a test
  if ((e.prog.procFlags(at) & PROC_CLOSED) === 0) vaTester(e)
  e.prog.marksToAddress()
  e.prog.setProcClosed(at, (e.prog.procFlags(at) & PROC_CLOSED) === 0)
  e.prog.marksToNumber()
  e.prog.countLines()
  if ((e.prog.procFlags(at) & PROC_CLOSED) !== 0) {
    // `.Skip`: it is closed now, so the cursor goes onto the fold's own line
    setY(e, e.prog.findAddress(at).line)
  } else if (e.prog.adEProc !== 0) {
    // it is open and a Test failed inside it, so the cursor goes to the error
    // DEVIATION: `Ed_RAlert` (:7580) puts the message that test left back on
    // the status line, out of the second half of `Ed_BufT`. This port keeps
    // the code in `Edit.testError` and has nothing to put back.
    setX(e, e.prog.xEProc)
    setY(e, e.prog.findAddress(e.prog.adEProc).line)
  }
  e.fill()
}

/**
 * `Ed_Procs` (:8627): every procedure in the program, folded or unfolded.
 *
 * The cursor keeps looking at the same PHYSICAL line rather than the same line
 * number: the address is taken before the walk and turned back into a number
 * after it, because folding anything above changes every number below.
 *
 * Closing steps over each fold as it makes it, so the size has to be right
 * before the walk starts, not during it.
 */
function procs(e: Edit, close: boolean): void {
  e.tokCur()
  if (close) vaTester(e)
  e.prog.marksToAddress()
  const was = e.prog.findLine(e.line).at
  let f = e.prog.findLine(0)
  while (f.found) {
    const at = f.at
    if (e.prog.isProc(at) && (e.prog.procFlags(at) & PROTECTED_PROC) === 0) {
      // `bclr #7` then `bset #7` if closing, so a locked one is not even
      // opened and everything else is written whether it needs it or not
      e.prog.setProcClosed(at, close)
    }
    f = e.prog.nextLine(at)
  }
  e.prog.countLines()
  e.prog.marksToNumber()
  setY(e, e.prog.findAddress(was).line)
  e.fill()
}

/**
 * `Ed_Indent` (:8465): the indent byte of every line, worked out again.
 *
 * ./indent.ts is the walk. What is here is the Test pass in front of it, which
 * the indenter needs for the same reason the folds do: it steps over a closed
 * procedure by the size at offset 4.
 */
function indentCmd(e: Edit): void {
  e.tokCur()
  vaTester(e)
  indentBytes(e.prog.bytes, e.prog.stBas, e.tabs)
  e.fill()
}

/**
 * `Ed_Test` (:8424): the Test pass, and the message that says it passed.
 *
 * DEVIATION: the machine chooses between "No errors" and the precision warning
 * on `Ver_SPConst` and `Ver_DPConst`, two flags a constant of the wrong
 * precision raises. This port's verifier does not keep them, so Test only ever
 * answers 197.
 */
function testCmd(e: Edit): void {
  e.tokCur()
  vaTester(e)
  throw new EditorAlert(197) // Ed_Al100, "No errors"
}

/* ---- 151: a procedure whose body is 68k --------------------------------- */

/**
 * `.GetH` (:8790) and the two loops that call it (:8710): the code hunk of an
 * AmigaDOS load file, read four bytes at a time into `Buffer(a5)`.
 *
 * DEFECT: `.Plo0` (:8713) reads longs one after another until one equals
 * $3E9, and never looks at the hunk table it is walking over. A load file
 * whose first hunk is 1001 longs holds $000003E9 as that hunk's SIZE, `.Plo0`
 * stops on it, and the long after it becomes the code length. `Pload` reads
 * the table size and skips it (`extractCodeHunk` in src/runtime/runtime.ts),
 * so the two disagree about the same file.
 *
 * Running off the end is `Ed_Read` (:13943) answering short, which is `bne
 * Ed_DError` and a disc error. Only the first long is ever tested against
 * $3F3, so message 182 is for a file that does not begin like an executable
 * and for nothing else.
 */
function mlHunk(e: Edit): Uint8Array {
  const bytes = disc(e).readFile(e.name1)
  if (bytes === null) throw new DiskError(205)
  let p = 0
  const long = (): number => {
    if (p + 4 > bytes.length) throw new DiskError()
    const v = bytes[p]! * 0x1000000 + (bytes[p + 1]! << 16) + (bytes[p + 2]! << 8) + bytes[p + 3]!
    p += 4
    return v
  }
  if (long() !== HUNK_HEADER) throw new EditorAlert(182, 250) // .NoGood (:8799)
  while (long() !== HUNK_CODE) {
    // .Plo0
  }
  const len = long() * 4
  if (p + len > bytes.length) throw new DiskError()
  return bytes.subarray(p, p + len)
}

/**
 * `.Cp1` (:8730) to `.Par` (:8744): the fake program, built in a temporary
 * buffer 512 bytes bigger than the code.
 *
 * The `Procedure` line is copied byte for byte and two bits then go into the
 * flags word at offset 10, `or.w #%0101000000000000,10(a3)`: bit 14 the lock
 * and bit 12 machine language. A machine-code procedure is a locked one
 * always, which is what keeps `Ed_ProcOpen` from unfolding it and showing
 * 68k where lines should be.
 *
 * After it comes a three-word line holding `@_apml_@` and one word: how far
 * back the parameter list is from that word. `lea 10+6(a3),a0` (:8735) is the
 * length byte of the procedure's own name record, `lea 2+2(a0,d0.w),a0` steps
 * the name and the token behind it, and `cmp.w #_TkBra1,-2(a0)` is that
 * token. No `[` and the offset is written as zero.
 *
 * The block ends with a bare `End Proc`, and `sub.l #14,d0` (:8760) is the
 * size long at offset 4: `Tk_SizeL` adds 12+2 back to step the fold.
 */
function mlBlock(e: Edit, at: number, code: Uint8Array): Uint8Array {
  const src = e.prog.bytes
  const line = src[at]! * 2
  const block = new Uint8Array(line + 6 + code.length + 6)
  block.set(src.subarray(at, at + line), 0)
  const put16 = (w: number, v: number): void => {
    block[w] = (v >> 8) & 0xff
    block[w + 1] = v & 0xff
  }
  put16(10, ((block[10]! << 8) | block[11]!) | PROTECTED_PROC | MACHINE_CODE_PROC)
  put16(line, 0x0301) // three words, indented one space
  put16(line + 2, TK.ML)
  // `move.l a0,d0 / sub.l a1,d0`, which is negative on every real procedure:
  // the parameters are back inside the header line and the word is ahead of it
  const after = 18 + block[16]!
  const bra1 = ((block[after]! << 8) | block[after + 1]!) === TK.BRA1
  put16(line + 4, bra1 ? (after + 2 - (line + 4)) & 0xffff : 0)
  block.set(code, line + 6)
  const end = line + 6 + code.length
  put16(end, 0x0301)
  put16(end + 2, TK.END_PROC)
  put16(end + 4, 0)
  const size = block.length - 14
  block[4] = (size >>> 24) & 0xff
  block[5] = (size >>> 16) & 0xff
  block[6] = (size >>> 8) & 0xff
  block[7] = size & 0xff
  return block
}

/**
 * `Ed_ProcML` (:8681), Insert Machine Language: the procedure the cursor is in
 * gets an AmigaDOS load file for a body.
 *
 * `.Reloop` (:8691) refuses to work on an open procedure and does not say so.
 * It folds it with `Ed_ProcOpen` and walks again, because what is deleted
 * below is a single `Ed_NextL` step and only a fold makes a whole procedure
 * one line.
 *
 * DEFECT: `Ed_ProcOpen` leaves a LOCKED procedure as it found it (`btst
 * #6,10(a2) / bne .Out`, :8819), so a locked procedure that is not folded
 * sends `.Reloop` round for ever. No editor command clears bit 14 or writes
 * it without bit 15, so such a procedure has to come off disc.
 *
 * There is no `Ed_NewBuf` at the end. The window still holds the text of the
 * old `Procedure` line, and `StoClo` (:11047) refuses to write anything over
 * a closed procedure, so the stale buffer cannot get back in.
 *
 * `Ed_AverFin` (:8786) has no `Ed_AverMess` in front of it anywhere in this
 * command. It is guarded by `move.w Ed_Avert(a5),d1 / beq.s .Out` (:7701), so it
 * does nothing unless another command left a warning up.
 */
function procML(e: Edit): void {
  e.tokCur()
  if (!selectFile(e, 178)) notDone(e)
  let at = 0
  for (;;) {
    at = e.prog.findLine(e.line).proc
    if (at < 0) throw new EditorAlert(203) // Ed_FoE, "Not a procedure."
    if ((e.prog.procFlags(at) & PROC_CLOSED) !== 0) break
    procOpen(e)
  }
  const block = mlBlock(e, at, mlHunk(e))
  // `Ed_StDelChunk` over one `Ed_NextL` step, then the block at the same line
  // number. Neither routine moves the marks and this one does not fix them,
  // so a mark inside the old procedure now points at 68k
  e.prog.deleteChunk(e.line, e.prog.nextLine(at).at - at)
  e.prog.storeBlock(e.line, block)
  e.prog.countLines()
  averFin(e)
}

/* ---- 77, 105 and 111: running the program ------------------------------- */

/**
 * `Ed_TestMessage` (:8578), the patch table `Prg_RunIt` is handed in a2.
 *
 * It is three `bra`s rather than three addresses, which is why the calls are
 * `jsr (a2)`, `jsr 4(a2)` and `jsr 8(a2)`. The first runs before `ClearVar`,
 * the second after the Test pass, and the third between `DefRun1` and
 * `DefRun2` where the editor's display comes down.
 *
 * The box only goes up for a program of 4K or more: `move.l Prg_StHaut(a6),d0
 * / sub.l Prg_StBas(a6),d0 / cmp.l #1024*4,d0 / bcs .Non` (:8583). A short
 * program is tested with nothing on screen to say so.
 */
function testMesOn(e: Edit, w: Edit): void {
  e.editor.tstMesOn = false
  if (w.prog.stHaut - w.prog.stBas < 1024 * 4) return
  e.editor.tstMesOn = true
  averMess(e, 198) // "...Testing..."
}

/** `Ed_Test2` (:8600), which takes it down again and only if it went up */
function testMesOff(e: Edit): void {
  if (!e.editor.tstMesOn) return
  e.editor.tstMesOn = false
  averFin(e)
}

/**
 * `Prg_RunIt` (+Verif.s:4336): the editor's half of starting a program.
 *
 * The order matters and it is not the order the labels suggest. `Ed_Run`
 * frees the block, razes every undo ring, takes the menus down and writes
 * `Edt_Runned` BEFORE it calls, and `Prg_DejaRunned` is the first thing
 * inside. So asking to run a program that is already running still costs the
 * clipboard and every undo in every window.
 *
 * `PTest` here is not `Ed_VaTester`. There is no `Prg_StModif` test in front
 * of it, so a Run tests a program that was tested a moment ago, and the flag
 * is cleared afterwards rather than consulted.
 *
 * Answers `Prg_RunIt`'s d0 as a yes or no: false is `.Deja`, which is the only
 * one of its two returns this port can reach. `.Omm` is `Prg_Push` failing to
 * get memory, and nothing here allocates.
 */
function prgRunIt(e: Edit, w: Edit, accessory: boolean, hidden: boolean, commandLine: string): boolean {
  const editor = e.editor
  editor.runned = w
  e.block.free() // Ed_BlocFree (:5913)
  // `Prg_RazUndos` (:1964) walks `Prg_List` and razes every program's ring,
  // not just the one about to run. Undo is per WINDOW here, and a split view
  // shares one buffer between two, so the walk is over the windows
  for (const other of editor.list) other.undo.raz()
  editor.runnedHidden = hidden
  if (editor.dejaRunned(w.prog)) {
    editor.runned = null // `clr.l Edt_Runned(a5)`, on the way out of both callers
    return false
  }
  testMesOn(e, w) // `jsr (a2)`
  vaTester(w, false, true) // ClearVar and PTest
  testMesOff(e) // `jsr 4(a2)`
  const run = editor.runProgram
  if (run === null) {
    // DEVIATION: with no host there is nobody to run it, so the command ends
    // where `JJmp L_New_ChrGet` does and nothing is pushed onto `Prg_Runned`
    return true
  }
  editor.running.unshift(w.prog) // Prg_Push
  run({ window: w, accessory, hidden, commandLine })
  return true
}

/**
 * `Ed_Run` (:8165): the current window's program, as a normal program.
 *
 * DEFECT: `bra Ed_OMm` takes EVERY return from `Prg_RunIt`, so a program that
 * is already running reports "Out of memory." here. `Ed_RunHidden` sixty
 * lines above tests d0 and says "Program already run." for the same state.
 */
function edRun(e: Edit): void {
  e.tokCur()
  if (!prgRunIt(e, e, false, false, '')) throw new EditorAlert(204, 120) // Ed_OMm
}

/**
 * `Ed_RunHidden` (:8105): one of the hidden windows, as an accessory.
 *
 * `moveq #1,d0` is the accessory flag, and `.PRun` in `Prg_RunIt` tests
 * `Prg_Accessory(a5)` under it: asking for an accessory does not make the
 * program one, it only lets a program that already is take the accessory
 * path. `Ed_RunnedHidden` is what tells the return path the editor is still
 * up behind it.
 */
function runHidden(e: Edit, n: number): void {
  e.tokCur()
  const w = e.editor.getHidden(n)
  if (w === null) notDone(e)
  // `beq Ed_OMm / bra Ed_AlRunned`: the out-of-memory arm needs `Prg_Push` to
  // fail, so only the second is reachable here
  if (!prgRunIt(e, w, true, true, '')) throw new EditorAlert(12, 100) // Ed_AlRunned
}

/**
 * `Ed_Wb` (:11201): `EcCalD AMOS_WB,0`, and that is the whole routine.
 *
 * The same call `Amos To Back` makes (+Lib.s:11337), so the menu entry that
 * says Workbench does not open Workbench: it puts the AMOS display behind
 * whatever is already there. Nothing brings it forward again from here.
 */
function edWb(e: Edit): void {
  e.editor.amosToBack?.()
}

/* ---- 28: the escape screen ---------------------------------------------- */

/**
 * `Ed_SamPlay` (:4799): the editor's own noise, one letter of it.
 *
 * Two guards, and both matter. `Ed_Sounds` is the configuration byte the
 * Sounds menu entry flips, and `Ed_Zappeuse` is the ZAP remote control: a
 * program driving the editor does not get to make it beep.
 */
function samPlay(e: Edit, letter: string): void {
  if (!e.editor.config.sounds) return
  if (e.editor.zappeuse) return
  e.editor.playSample?.(letter)
}

/** `Ed_Hide` (:9579), as much of it as is not the slide down the screen */
function edHide(e: Edit): void {
  if (e.editor.esFlag) return
  e.editor.esFlag = true
  e.editor.avert.length = 0 // Ed_AllAverFin
}

/** `Ed_Appear` (:9646), the same in reverse */
function edAppear(e: Edit): void {
  if (!e.editor.esFlag) return
  e.editor.esFlag = false
}

/**
 * `Ed_Escape` (:8876), the Escape key: the editor goes away and the escape
 * screen comes up over whatever the program is displaying.
 *
 * It is the same shape as `Ed_Run`. Four instructions of editor work and then
 * `Esc_Loop`, which is not a call either: `move.l BasSp(a5),sp` (:8887) throws
 * the editor's stack away, and the editor comes back through `Esc_Esc` (:9125)
 * and nowhere else.
 *
 * DEVIATION: `Esc_Appear` is the host's, for the reason `Editor.escapeScreen`
 * gives. With nobody listening the editor hides and there is nothing to hide
 * behind, which is why the flag is what a host reads to know.
 */
function edEscape(e: Edit): void {
  samPlay(e, 'E')
  e.tokCur()
  edHide(e)
  if (e.editor.escape) return // `tst.w Direct(a5) / bne .Out`
  e.editor.escape = true
  e.editor.escapeScreen?.(true)
}

/**
 * `Esc_Esc` (:9125): the Escape key again, from the other side.
 *
 * `clr.w Edt_EtMess(a4)` between the two halves is the countdown on the status
 * line's alert, so whatever the editor was saying when it went away is not
 * still counting down when it comes back.
 */
export function edEscapeReturn(e: Edit): number {
  const alert = run(e, () => {
    samPlay(e, 'E')
    if (e.editor.escape) {
      e.editor.escape = false
      e.editor.escapeScreen?.(false)
    }
    e.alertTime = 0 // clr.w Edt_EtMess(a4)
    edAppear(e)
  })
  return edLoop(e, alert)
}

/* ---- the way back, when a program stops --------------------------------- */

/**
 * `Ed_GetError` (:8323): the run's d0 and a0 turned into a message.
 *
 * An a0 that is not zero is an extension's own text and is kept as it stands,
 * and so is a code of 256 or more, which is not a message number: 1000, 1001
 * and 1002 are Edit, Direct and System and the caller has branched on them
 * already.
 *
 * Below that the SIGN picks the table. Zero or less is a Test message at
 * `-d0`, and the code comes back positive. One to 255 is a run-time message at
 * `d0+1`, which is why 10 is "End of program" and not the tenth entry.
 */
function getError(code: number, text: string | null): { code: number; text: string } {
  if (text !== null) return { code, text }
  if (code >= 256) return { code, text: '' }
  if (code <= 0) return { code: -code, text: ED_TST_MESSAGES[-code - 1] ?? '' }
  return { code, text: ED_RUN_MESSAGES[code] ?? '' }
}

/**
 * `Ed_Ligne` (:8344): the requester that asks whether to go to Direct mode or
 * back to the editor, for a program that stopped with a run-time error.
 *
 * Five `Ed_VDialogues` slots go in: the message, the line number the error is
 * on, and the line itself split at the error. The fifth is a redraw routine
 * rather than a value.
 *
 * The split is a window around the error and not the head of the line.
 * `moveq #60,d4 / add.w d3,d4` cuts the tail 60 characters past it, and
 * `sub.w #73,d4` then starts the head 13 characters BEFORE it, or at 0 when
 * the line is shorter than that. So a fault in column 200 is shown with 13
 * characters of what led up to it.
 *
 * Answers `Ed_Dialogue`'s d0, and `cmp.w #1,d1` is the only test the caller
 * makes: button 1 is Direct and everything else is the editor.
 */
function edLigne(e: Edit, w: Edit, at: number, message: string): number {
  const f = at >= 0 ? errLine(w, w.prog.stBas + at) : { line: 0, text: '', column: 0 }
  const col = f.column
  const head = f.text.slice(Math.max(0, col - 13), col)
  const tail = f.text.slice(col, col + 60)
  return confirm(e, {
    which: 59, // EdD_Ligne (:15377)
    values: [undefined, f.line + 1],
    strings: [message, undefined, head, tail],
  })
}

/**
 * `Ed_ErrEdit` (:8275): the editor comes back and the cursor goes to the byte
 * the program stopped on.
 *
 * `Ed_OpenEditor / Esc_Hide / Ed_Appear` in front of it are the display.
 *
 * Three codes go straight back to `Ed_Loop` with nothing shown: a negative
 * one, 10 which is End, and 1000 which is Edit. Everything else positions the
 * cursor and puts the message up with a "." on the end, for 200 frames.
 *
 * DEVIATION: `Ed_Alert` is given a POINTER here and not a message number, so
 * the alert this port raises carries the error's own code instead. Nothing on
 * the machine has a number to carry.
 */
function errEdit(w: Edit, code: number, at: number, text: string | null): void {
  const got = getError(code, text)
  if (got.code >= 0 && (got.code === 10 || got.code === 1000)) return
  if (at >= 0) errTest(w, at)
  throw new EditorAlert(got.code, 200, got.text + '.')
}

/**
 * `Ed_ErrRunHidden` (:8331): the same return, for a program that was running
 * behind the editor rather than in front of it.
 *
 * There is no cursor to move. The error is in another program, so the message
 * goes up with editor message 9 in front of it and that is all. `Edt_PrgDelete`
 * is what `Ed_PrgCommand` sets when the window was only borrowed to hold the
 * program, and the window goes with it.
 *
 * 1002 is here as well as in `Ed_Errr`, and 1001 is not: a hidden program that
 * asks for Direct mode is answered like any other error.
 */
function errRunHidden(e: Edit, w: Edit, code: number, text: string | null): void {
  const editor = e.editor
  editor.runnedHidden = false
  const got = getError(code, text)
  // `Edt_ClearVar` (:3035) frees the interpreter's variables; there are none
  if (w.prgDelete) editor.delWindow(w)
  if (got.code >= 0) {
    if (got.code === 10 || got.code === 1000) return
    if (got.code === 1002) {
      editor.quit = true // Ed_System
      return
    }
  }
  throw new EditorAlert(got.code, 200, (ED_MESSAGES[8] ?? '') + got.text + '.')
}

/**
 * `Ed_ErrDirect` (:9293): the escape screen goes up and the message is
 * printed on it.
 *
 * DEVIATION: `Ed_Escape` (28) is not ported, so there is no escape screen for
 * a message to be printed on. What is left of the routine is what it does to
 * editor state, which is to clear `Edt_Runned` and nothing else. The three
 * codes it tests are all handled before they can reach here.
 */
function errDirect(e: Edit): void {
  e.editor.runned = null
}

/** `Ed_Errr` (:8261), which `Ed_ErrTest` and `Ed_ErrRun` both fall into */
function errr(e: Edit, w: Edit, code: number, at: number, text: string | null): void {
  if (code >= 0 && code !== 1000) {
    if (code === 1001) return errDirect(e)
    if (code === 1002) {
      e.editor.quit = true // Ed_System (:249)
      return
    }
    // the code is not one of the three, so the user is asked which they want
    if (edLigne(e, w, at, getError(code, text).text) === 1) return errDirect(e)
  }
  errEdit(w, code, at, text)
}

/**
 * `Ed_ErrRun` (:8252): where `Prg_JError` lands when the program stops.
 *
 * `code` is d0 and `text` is a0, which is null for everything but an
 * extension's own error message. `at` is `VerPos(a5)` as an offset into the
 * program's text, or -1 when there is no position to go to.
 *
 * The answer is the alert number, the same as `edCall`'s, because the machine
 * ends this in `bra Ed_Loop` either way.
 */
export function edRunReturn(e: Edit, code: number, at = -1, text: string | null = null): number {
  const alert = run(e, () => {
    const editor = e.editor
    editor.running.shift() // Prg_Pull, which `rErr1` (+ILib.s:1372) does first
    const w = editor.runned ?? e
    if (editor.runnedHidden) {
      editor.runned = null
      errRunHidden(e, w, code, text)
      return
    }
    editor.runned = null
    if (w.prog.reloaded) {
      // `Run "file"` inside the program loaded over this window's own text, so
      // the block anchor is a line number into text that is gone
      w.prog.reloaded = false
      w.yBloc = -1
    }
    errr(e, w, code, at, text)
  })
  return edLoop(e, alert)
}

/* ---- 137 to 142: the configuration -------------------------------------- */

/**
 * `Sys_GetMessage 7` (+Interpreter_Config.s:113), which is where the default
 * config is written and read.
 *
 * DEVIATION: the machine takes it from `Sys_Messages`, the INTERPRETER's text
 * block, and this port has not generated that one. The macro commands take
 * their filename from `Ed_Systeme` message 46, which is generated, so the two
 * defaults do not come from the same place here.
 */
const CONFIG_NAME = 'AMOSPro_Editor_Config'

/** `EdC_LoadIt` (:4915) */
function configLoad(e: Edit): void {
  const fs = disc(e)
  const bytes = fs.readFile(e.name1)
  if (bytes === null) throw new EditorAlert(139) // .Err, "Cannot load configuration."
  const r = readConfig(bytes)
  if (r.error !== CFG.OK) throw new EditorAlert(139)
  e.editor.config = r.config!
  // `EdC_Redraw` (:4933) takes the whole editor down and opens it again, with
  // `EdC_Modified` raised so `Ed_OpenIt` reconciles the window heights against
  // the new `Ed_Sy`. Nothing here draws, so what is left of it is the sizes
  const now = e.editor.current
  if (now !== null) now.windTy = e.editor.maxSize(now, -1)
  drawWindows(e.editor)
}

/** `EdC_SaveIt` (:4878) */
function configSave(e: Edit): void {
  const fs = disc(e)
  if (!fs.writeFile(e.name1, writeConfig(e.editor.config))) throw new EditorAlert(139)
  e.editor.configChanged = 0
}

/**
 * `EdC_Saved` (:4944): offer to save a config the USER changed.
 *
 * `cmp.b #1,EdC_Changed(a5)` and nothing else, so a config that was loaded
 * from a file carries 2 and is never offered. Only `Ed_QuitOptions` and
 * `Ed_SetAutoSave` write the 1.
 */
function configSaved(e: Edit): void {
  if (e.editor.configChanged !== 1) return
  const answer = confirm(e, { which: 46 }) // EdD_CSaved
  if (answer === 2) return
  if (answer !== 1) throw new EditorAlert(206)
  configSaveAs(e)
}

/** `EdC_SaveAs` (:4871) */
function configSaveAs(e: Edit): void {
  if (!selectFile(e, 130)) notDone(e)
  saveOver(e, disc(e))
  configSave(e)
}

/**
 * `Ed_QuitOptions` (:4555): the four quit flags, as four gadgets.
 *
 * `Dia_SetVFlags` puts the byte into the requester and `Dia_GetVFlags` takes
 * it back out, so the requester's answer IS `Ed_QuitFlags`. A cancel goes to
 * `Ed_Loca` rather than `Ed_NotDone`, so there is no message either way.
 */
function quitOptions(e: Edit): void {
  e.tokCur()
  if (e.dialogues === null) return
  const answer = e.dialogues.confirm({ which: 49, count: e.editor.quitFlags }) // EdD_OQuit
  if (answer < 0) return
  e.editor.quitFlags = answer
  e.editor.configChanged = 1
}

/**
 * `Ed_SetAutoSave` (:5355): how many minutes between autosaves.
 *
 * The minutes are kept in `Ed_AutoSaveMn` and the interval is worked out from
 * them in VERTICAL BLANKS, `minutes * 60 * 50` on a PAL machine and `* 60` on
 * an NTSC one. Only this command does that sum, so a config written on one and
 * loaded on the other keeps the frame count it was given.
 *
 * DEVIATION: `EcCall NTSC` asks the display. This port has no editor screen to
 * ask, so it takes PAL, which is what the machines these files came off were.
 */
function setAutoSave(e: Edit): void {
  e.tokCur()
  if (e.dialogues === null) notDone(e)
  const answer = e.dialogues.confirm({ which: 48, count: e.editor.config.autoSaveMn }) // EdD_ASave
  if (answer !== 1) notDone(e)
  // zone 3, the requester's one field. `moveq #3,d1` at :5368
  const minutes = e.dialogues.value(3)
  if (minutes === e.editor.config.autoSaveMn) return
  e.editor.config.autoSaveMn = minutes
  e.editor.config.autoSave = minutes * 50 * 60
  e.editor.autoSaveRef = -1
  e.editor.configChanged = 1
}

/**
 * `Ed_FCall`'s `.Prg` arm (:2612): the command has a program bound to it.
 *
 * `Ed_AutoLoad` holds three bytes for each of the 184 commands and the first
 * of them being non-zero is what makes the entry live. The shipped config
 * binds 37 commands to `AMOSPro_Help.AMOS`, and three of those -- 152, 153 and
 * 154 -- are real editor commands, so Save As Name from a MENU runs Help and
 * the same number from the ZAP remote control saves the program. `.Prg` tests
 * `Ed_Zappeuse` before it branches, and that is the whole of the difference.
 *
 * A macro being recorded takes the same exit as the ZAP: `tst.w EdMa_Tape(a5)
 * / beq Ed_PrgCommand` falls through to `.NoMacro` when one is running, so a
 * bound command cannot be taped either.
 */
function autoLoad(e: Edit, cmd: number): PrgCommand | null {
  if (e.editor.zappeuse) return null
  const at = (cmd - 1) * 3
  const table = e.editor.config.autoLoad
  const flags = table[at]
  if (flags === undefined || flags === 0) return null
  const list = messages(e.editor.config.texts.programs)
  const name = (n: number): string | null => (n === 0 ? null : (list[n - 1] ?? null))
  return {
    command: cmd,
    flags,
    program: name(table[at + 1]!) ?? '',
    line: name(table[at + 2]!),
  }
}

/* ---- 73, 74, 135 and 136: editing the menu itself ----------------------- */

/**
 * `Mn_GetOption` (:5733): the requester, and then a click on a menu entry.
 *
 * Zero is "no choice", which every caller turns into `Ed_NotDone`. The number
 * is 1-based here; the machine's d2 is one less, because `Ed_MnGere` (:1674)
 * subtracts one on the way out and a separator, whose command is 0, goes
 * negative and is refused there.
 */
function pickMenu(e: Edit, which: number): number {
  if (e.dialogues === null) notDone(e)
  const cmd = e.dialogues.pickMenu(which)
  if (cmd <= 0) notDone(e)
  return cmd
}

/**
 * `Ed_Key2Menu` (:5645): put a keystroke on a menu entry.
 *
 * The old shortcut goes first, `[1][0]` over the first record of the command's
 * list (./keymap.ts), and the menu is rebuilt before the key is even asked
 * for. So cancelling the keystroke requester leaves the entry with no shortcut
 * at all: the clearing is not undone.
 *
 * A key already on another command is not refused, only questioned. EdD_KyMn3
 * asks and a Yes writes the key onto BOTH, which the first-match-wins search
 * in `Ed_Ky2Fonc` then resolves in favour of the lower-numbered command.
 *
 * The table written is `Ed_Config`'s own, because `Ed_KFonc` is 552 bytes
 * inside `Ed_DConfig`. `ED_KFONC` in ./keymap.gen.ts is the assembled default,
 * so a host that hands `edKey` that instead will not see a shortcut this
 * command changed.
 */
function key2Menu(e: Edit): void {
  e.tokCur()
  const cmd = pickMenu(e, 24) // EdD_KyMn1
  if (cmd >= HIDDEN_COMMANDS) {
    confirm(e, { which: 26 }) // EdD_KyMnE, "this menu option cannot be affected"
    return
  }
  const map = e.editor.config.keyMap
  if (!setKey(cmd, 1, 0, map)) {
    confirm(e, { which: 26 })
    return
  }
  const key = pressKey(e, 27) // EdD_KyMn2, which waits for a keystroke
  if (key === 0) notDone(e)
  const k = unpackKey(key)
  const stroke: EdKey = { ch: String.fromCharCode(k.ascii), scan: k.scan, shift: k.shift }
  if (keyToFunc(stroke, map) !== 0) {
    e.editor.configChanged = 1
    if (confirm(e, { which: 28 }) !== 1) notDone(e) // EdD_KyMn3, "already assigned"
  }
  const { id, shift } = encodeKey(stroke)
  setKey(cmd, id, shift, map)
}

/**
 * `Ed_Prg2Menu` (:5533): put an AMOS program on a menu entry.
 *
 * This is the editor for `Ed_AutoLoad`, the table `Ed_FCall` reads before it
 * reaches `JFonc` at all. The program's name and its command line are two
 * messages of `Ed_MnPrograms`, and the three bytes of the table point at them.
 *
 * The range test is odd and literal: hidden slots are refused, and so is
 * everything from 153 to 181, which the author's comments call "pas un menu
 * HELP ou CONFIG". 182 and 183 fall through it and are allowed.
 *
 * A `move.w d2,d3` at :5548 is overwritten by `moveq #0,d3` on the line after
 * it, so the option number never reaches the variable that carries it.
 */
function prg2Menu(e: Edit): void {
  e.tokCur()
  const cmd = pickMenu(e, 30) // EdD_PrgMn1
  if (cmd >= HIDDEN_COMMANDS || (cmd >= 153 && cmd < 182)) {
    confirm(e, { which: 33 }) // EdD_PrgMnE
    return
  }
  const editor = e.editor
  editor.configChanged = 1
  const table = editor.config.autoLoad
  const at = (cmd - 1) * 3
  let answer = 0
  if (table[at] !== 0 && table[at + 1] !== 0) {
    // EdD_PrgMn2: there is one already. 1 replaces it, 2 clears it, 3 gives up
    answer = e.dialogues === null ? 1 : e.dialogues.confirm({ which: 31 })
    if (answer === 3) notDone(e)
    clearProgram(e, table[at + 1]!)
    clearProgram(e, table[at + 2]!)
  }
  table[at] = 0
  table[at + 1] = 0
  table[at + 2] = 0
  if (answer === 2) return
  if (!selectFile(e, 100)) notDone(e)
  if (confirm(e, { which: 32 }) !== 1) notDone(e) // EdD_PrgMn3
  // `Dia_GetVFlags` over slots 4 to 6, and `or.b #$80,d0`: the top bit is what
  // makes the entry live at all
  table[at] = (e.dialogues === null ? 0 : e.dialogues.flags(4, 3)) | 0x80
  table[at + 1] = putProgram(e, e.name1)
  const line = e.dialogues === null ? '' : e.dialogues.text(7)
  if (line === '') return
  table[at + 2] = putProgram(e, line)
}

/** one message of `Ed_MnPrograms` emptied, which is how a binding is removed */
function clearProgram(e: Edit, n: number): void {
  if (n === 0) return
  e.editor.config.texts.programs = changeMessage(e.editor.config.texts.programs, n, '')
}

/** `Ed_GetFsMessage` and then `EdC_ChangeTexte`: a message into the first free slot */
function putProgram(e: Edit, text: string): number {
  const block = e.editor.config.texts.programs
  const n = firstFreeMessage(block)
  e.editor.config.texts.programs = changeMessage(block, n, text)
  return n
}

/**
 * `Ed_AddUser` (:5422): one more entry on the User menu.
 *
 * The entries are twenty messages of `EdM_User` and twenty `JFonc` slots, 115
 * to 134, whose whole body is the requester saying they do nothing. What makes
 * one do something is the two commands this runs straight afterwards: Program
 * To Menu and then Key To Menu, so adding an entry walks you through binding
 * it without asking whether you wanted to.
 */
function addUser(e: Edit): void {
  e.tokCur()
  const editor = e.editor
  const n = firstFreeMessage(editor.config.texts.userMenus)
  if (n >= EDM_USER_MAX) {
    confirm(e, { which: 42 }) // EdD_MnUs2, "too many options"
    return
  }
  editor.configChanged = 1
  if (confirm(e, { which: 40, values: [undefined, undefined, 0, EDM_USER_LONG] }) !== 1) {
    notDone(e) // EdD_MnUsA
  }
  const label = e.dialogues === null ? '' : e.dialogues.text(3)
  if (label === '') notDone(e)
  editor.config.texts.userMenus = changeMessage(editor.config.texts.userMenus, n, label)
  prg2Menu(e)
  key2Menu(e)
}

/**
 * `Ed_DelUser` (:5469): an entry off the User menu, and everything on it.
 *
 * Three things go, in this order: the label becomes an empty message, which is
 * what `Ed_GetFsMessage` will find again as a free slot; the `Ed_AutoLoad`
 * entry and the one or two `Ed_MnPrograms` messages it points at are cleared;
 * and the keyboard shortcut is poked back to `[1][0]`.
 *
 * The number is `d2 - (EdM_UserCommands-1-1)`, so command 115 is user message
 * 1. Anything outside 115 to 134 is refused.
 */
function delUser(e: Edit): void {
  e.tokCur()
  const cmd = pickMenu(e, 41) // EdD_MnUsD
  if (cmd < EDM_USER_COMMANDS || cmd >= EDM_USER_COMMANDS + EDM_USER_MAX) {
    confirm(e, { which: 43 }) // EdD_MnUsE
    return
  }
  const editor = e.editor
  editor.configChanged = 1
  const n = cmd - EDM_USER_COMMANDS + 1
  editor.config.texts.userMenus = changeMessage(editor.config.texts.userMenus, n, '')
  const table = editor.config.autoLoad
  const at = (cmd - 1) * 3
  if (table[at] !== 0) {
    clearProgram(e, table[at + 1]!)
    clearProgram(e, table[at + 2]!)
    table[at] = 0
    table[at + 1] = 0
    table[at + 2] = 0
  }
  setKey(cmd, 1, 0, editor.config.keyMap)
}

/* ---- 27, 104, 148, 179, 180, 183 and the 46 user slots: the menus -------- */

/**
 * `Ed_UserMenu` (:5414): the body 46 of the 184 `JFonc` entries share.
 *
 * Twenty of them, 115 to 134, are the user menu's own slots; the rest are
 * places the CONFIGURATION is expected to fill. Its whole body is a requester
 * saying the option does nothing, which is what an unconfigured slot does.
 *
 * `Ed_FCall` reads `Ed_AutoLoad` before it reaches this table, so a slot with
 * a program bound to it never arrives here. The shipped configuration binds
 * 27 to `AMOSPro_Help.AMOS` and 172 to 178 to the setup accessories, and the
 * assembler's own comments beside those seven entries name them: Interpretor
 * Setup, Editor Setup, Editor Menus, Editor Dialogs, Test-Time, Run-Time and
 * Colour Palette.
 */
function userMenu(e: Edit): void {
  e.tokCur()
  confirm(e, { which: 44 }) // EdD_MnUs
}

/**
 * `Ed_GoHelp` (:2636): `moveq #26,d2 / bra Ed_FCall`, and d2 is 0-based.
 *
 * So F5 runs command 27, which is a user-menu slot with nothing of its own to
 * do. The Help accessory appears because `Ed_AutoLoad` binds a program to that
 * slot, and unbinding it leaves F5 putting up "this option is not assigned".
 */
function goHelp(e: Edit): void {
  edCall(e, 27)
}

/**
 * `Ed_ShowKey` (:12998): show the key beside each menu entry, or stop.
 *
 * `not.b EdM_Keys(a5)` and then the whole menu is built again, because the key
 * is part of the label: `EdM_ObCree` (:13108) pads the string by `L_KDef+1`
 * characters and writes the key into them, and only when `EdM_Keys` is set.
 * `Ed_Fonc2Ky` is what turns the command back into a keystroke.
 */
function showKey(e: Edit): void {
  e.tokCur()
  e.editor.config.menuKeys = !e.editor.config.menuKeys
}

/**
 * `Ed_SamOn` (:5786): the editor's sounds on or off.
 *
 * `Ed_SamPlay` is called with a letter at eight places -- "B" on the way out,
 * "E" into the escape screen, "F" on a cursor move, "G" on an alert -- and
 * this byte is what it tests first. `EdC_Changed` goes up, so Quit offers to
 * save it.
 *
 * DEVIATION: `EdM_MarkAll` puts the tick beside the menu entry and
 * `Ed_SamChanged` loads or frees `AMOSPro_Editor_Samples.Abk`. There is no
 * menu to tick here and no sample bank behind it.
 */
function samOn(e: Edit): void {
  e.editor.config.sounds = !e.editor.config.sounds
  e.editor.configChanged = 1
}

/**
 * `EdM_PrevHidden` (:12739) and `EdM_NextHidden` (:12751).
 *
 * The step is `EdM_HiddenMax-1`, eleven, while the page shows twelve, so the
 * pages overlap by one entry. Only Prev has a bound of its own: it refuses at
 * zero and floors at zero, and Next simply adds. What stops Next is
 * `EdM_BranchAMOS`, which pulls the position back to `count - 12` every time
 * it rebuilds the branch (./menus.ts).
 */
function prevHidden(e: Edit): void {
  e.tokCur()
  if (e.editor.posHidden === 0) notDone(e)
  e.editor.posHidden = Math.max(0, e.editor.posHidden - (EDM_HIDDEN_MAX - 1))
  hiddenPage(e.editor)
}

function nextHidden(e: Edit): void {
  e.tokCur()
  e.editor.posHidden += EDM_HIDDEN_MAX - 1
  hiddenPage(e.editor)
}

/* ---- 69, 70, 71, 154 and 182: what the remote control writes ------------ */

/**
 * `EdZ_NewLine` (:2776): the line under the cursor replaced with `Name1`.
 *
 * It writes into the EDIT BUFFER and not into the program: `Ed_LCourant`
 * hands back the current display row and the string goes there with its own
 * length in front of it, then `Edt_LEdited` is raised so the next `Ed_TokCur`
 * tokenises it back. So the accessory hands over TEXT, and the editor's own
 * cycle turns it into a line.
 */
function zapNewLine(e: Edit): void {
  e.buf.setText(e.yCu, e.name1)
  e.edited++
}

/** `EdZ_NewLineTok` (:2772): the same, and tokenised there and then */
function zapNewLineTok(e: Edit): void {
  zapNewLine(e)
  e.tokCur()
}

/**
 * `Ed_RAlert` (:7580): the last alert put back on the status line.
 *
 * `Ed_Alert` copied its message into `Ed_BufT+256` behind `$FFFE0102`, and
 * this checks that long before it believes what follows. The duration is 150
 * rather than the 100 most alerts use, so a message asked for again stays
 * half as long again.
 */
function reAlert(e: Edit): void {
  const saved = e.editor.alertSaved
  if (saved === 0) return
  e.alert = saved
  e.alertText = e.editor.alertSavedText
  e.alertTime = 150
}

/**
 * `Ed_Rename` (:13596): the program renamed, without touching the disc.
 *
 * `Prg_Change` is raised, so the program is now unsaved under a name no file
 * has yet. That is the point of it: the accessory names the program and the
 * next Save writes it there.
 */
function rename(e: Edit): void {
  e.prog.name = e.name1
  e.prog.changed = true
}

/**
 * `EdZ_NewConfig` (:2748): one message of one text block replaced.
 *
 * `Ed_ZapParam` picks the block by its place in the run of pointers at
 * +Equ.s:1673, which the assembler comment marks "ne pas changer l'ordre":
 * 0 is `Sys_Messages`, the INTERPRETER's block, and 1 to 5 are the editor's
 * system strings, menu strings, dialogue messages, test errors and run errors.
 * `cmp.l #5,d0 / bhi .Skip` is the bound, so the three blocks after those --
 * the menu programs, the user menus and the menu definitions -- cannot be
 * reached even though they are loaded from the same file and sit in the same
 * run of pointers.
 *
 * `Name1` carries the message NUMBER as its first long and the text after it.
 * A number above the block's count is refused rather than appended, which is
 * what makes `EdC_ChangeTexte`'s `.New` arm unreachable from here.
 *
 * DEVIATION: param 0 is the interpreter's own text block. This port has not
 * generated `Sys_Messages`, so 0 changes nothing and raises the two flags,
 * which is what an out-of-range block does.
 */
function zapNewConfig(e: Edit): void {
  const editor = e.editor
  // `move.l Ed_ZapParam(a5),d0`, not the command's own argument: every ZAP
  // command that wants a number reads it out of a5
  const param = editor.zapParam
  const at = param - 1
  const name = TEXT_BLOCKS[at]
  if (param >= 1 && param <= 5 && name !== undefined) {
    const n = zapNumber(e.name1)
    const text = e.name1.slice(4)
    const block = editor.config.texts[name]
    if (n >= 1 && n <= messages(block).length) {
      editor.config.texts[name] = changeMessage(block, n, text)
    }
  }
  // `EdC_Modified` and `EdC_Changed` go up whatever happened, including for a
  // block number nothing here can reach
  editor.configChanged = 1
}

/** `move.l (a1)+,d0`: the message number, as the first four bytes of `Name1` */
function zapNumber(s: string): number {
  let n = 0
  for (let i = 0; i < 4; i++) n = (n << 8) | (s.charCodeAt(i) & 0xff)
  return n >>> 0
}

/* ---- 26, 76, 83 and 114: the requesters that ask one thing --------------- */

/**
 * `Dia_GetValue` on the field every one-question requester puts its number in.
 *
 * Zone 3, from `moveq #3,d1` at the six call sites that read a number. With no
 * requester installed there is nothing to have typed into, and the machine's
 * answer would be whatever the field opened on.
 */
function fieldValue(e: Edit, opened: number): number {
  return e.dialogues === null ? opened : e.dialogues.value(3)
}

/**
 * `Ed_STab` (:3716): how many columns Tab moves.
 *
 * The one requester whose Cancel is not a cancel. `Ed_Dialogue`'s answer is
 * never looked at: the value is read out of the field and stored whatever the
 * user clicked, and `EdC_Changed` is raised so Quit offers to save it.
 */
function setTab(e: Edit): void {
  e.tokCur()
  if (e.dialogues === null) return
  const was = e.tabs
  e.dialogues.confirm({ which: 38, values: [undefined, undefined, was] }) // EdD_SetTab
  e.tabs = fieldValue(e, was) & 0xffff
  e.editor.configChanged = 1
}

/**
 * `Ed_GotoL` (:6937): the cursor to a line the user names.
 *
 * The number is 1-based and `subq.l #1` turns it into the editor's, so Goto
 * Line 0 goes negative and is `Ed_NotDone`. Above the end it stops at the line
 * PAST the last, which is the one a program grows onto.
 *
 * Under the ZAP remote control there is no requester: `Ed_Dialogue` answers
 * `Ed_ZapParam` for everything, and this is the one command that uses that
 * answer as a number rather than as a button.
 */
function gotoLine(e: Edit): void {
  e.tokCur()
  let line: number
  if (e.editor.zappeuse) {
    line = e.editor.zapParam
  } else {
    if (confirm(e, { which: 35 }) !== 1) notDone(e) // EdD_GotoL
    line = fieldValue(e, 0)
  }
  line -= 1
  if (line < 0) notDone(e)
  // `cmp.w Prg_NLigne(a6),d0` compares the LOW WORD of a long, so a line
  // number past 65,535 wraps out of the clamp. `Ed_GotoY` catches it anyway
  if ((line & 0xffff) >= e.prog.lineCount) line = e.prog.lineCount
  autoMarks(e)
  gotoY(e, line)
}

/**
 * `Ed_Infos` (:4665): six numbers about the program, in a box.
 *
 * `Ed_VaTester` runs first, because two of the six are what the Test pass
 * counts. The box is messages 166 to 174, which name them: free chip, free
 * fast, text length, bank length, visible lines, instructions.
 *
 * Three of the writes into `Ed_VDialogues` are dead. The bank call hands back
 * Bobs in d1 and Icons in d2, and both are stored -- Bobs into slot 5 and
 * Icons into slot 6 -- but slot 5 is written twice more before the requester
 * opens, first with `BMenage` and then with `VerNInst`, and slot 6 has no
 * message beside it. The box has six lines and the routine fills eight.
 *
 * DEVIATION: three of the six are not measurements here. Free chip and free
 * fast come from `AvailMem` on a machine with a real allocator, and this
 * editor has ./windows.ts's pool figures. `Bnk.GetLength` walks the bank list
 * and adds up what each bank OCCUPIES; there is no bank reader here, so what
 * is counted is the `AmBs` block as it came off disc, less the six bytes every
 * program carries whether it has banks or not.
 */
function infos(e: Edit): void {
  e.tokCur()
  vaTester(e)
  const values = [
    e.editor.chipFree,
    e.editor.fastFree,
    e.prog.stHaut - e.prog.stBas,
    Math.max(0, e.prog.banks.length - EMPTY_BANKS.length),
    e.prog.lineCount,
    e.editor.verNInst,
  ]
  confirm(e, { which: 54, values }) // EdD_Infos
}

/**
 * `Ed_SB` (:9951): the buffer resized, which is two different commands.
 *
 * GROWING keeps the program: the machine stacks the four buffer pointers,
 * clears `Prg_StTTexte` so `Prg_ChgTTexte` does not free the block it is
 * about to copy out of, allocates, and puts the text back with `Ed_StoBlock`.
 * SHRINKING cannot, so `.PaCop` offers the program for saving and then throws
 * it away: Set Buffer Size to something smaller is New with a question in
 * front of it.
 *
 * The number is rounded down to even and refused below 1,024. Asking for
 * exactly what the buffer already is is `Ed_NotDone` as well, which is why
 * clicking Ok on an unchanged box does nothing at all.
 */
function edSB(e: Edit, opened: number): void {
  if (confirm(e, { which: 36, values: [undefined, undefined, opened] }) !== 1) notDone(e) // EdD_SetBuf
  const size = fieldValue(e, opened) & ~1
  if (size < 1024) notDone(e)
  const now = e.prog.bytes.length
  if (size === now) notDone(e)
  if (size > now) {
    e.prog.chgTTexte(size, programSource(e.prog))
  } else {
    saved(e)
    newProgram(e)
    e.prog.chgTTexte(size)
  }
  e.fill() // Ed_NewBufAff
}

/** `Ed_SetBuffer` (:9946), the command, which opens the box on the size it has */
function setBuffer(e: Edit): void {
  e.tokCur()
  // `Edt_ClearVar` (:3035) hands the program's variables and banks back first,
  // which is the interpreter's memory and not the editor's
  edSB(e, e.prog.bytes.length)
}

/* ---- 82: Quit, and the session file ------------------------------------- */

/** `EdC_SaveDef` (:4863): the config to its default name, with nothing asked */
function configSaveDef(e: Edit): void {
  e.name1 = addPath(e, CONFIG_NAME)
  configSave(e)
}

/** `EdMa_SaveDef` (:6669), which is `EdMa_SaveDefault` with no instruction of its own */
function macroSaveDef(e: Edit): void {
  e.name1 = addPath(e, ED_SYSTEME[45]!)
  macroSave(e)
}

/**
 * `Ed_Quit` (:4371): the command, which is a question and then `Ed_DoQuit`.
 *
 * Bit 0 of `Ed_QuitFlags` is what puts EdD_Quit up, and any answer but the
 * first button goes back to `Ed_Loop` with nothing done. The close button on
 * the last window (:11413) reads the same bit and asks a different question,
 * EdD_WQuit, before it lands here.
 */
function quitCmd(e: Edit): void {
  e.tokCur()
  if ((e.editor.quitFlags & 1) !== 0 && confirm(e, { which: 2 }) !== 1) return // EdD_Quit
  doQuit(e)
}

/**
 * `Ed_DoQuit` (:4383): the four things quitting does, in the order the flags
 * are tested.
 *
 * Bit 1 saves the config, bit 2 the macros, and both are skipped when the
 * thing has not been changed, so a quit writes nothing it does not have to.
 * Bit 3 is the one that changes what the OTHER two mean: with it up, nothing
 * is asked and every program is written out under a name Quit invents if it
 * has none, plus the session file that says where they all were. With it down
 * the editor asks about each changed program in turn and forgets the layout.
 *
 * DEVIATION: two steps of it are not here. `Edt_ClearVar` (:3035) hands the
 * program's variables and banks back, which is the interpreter's memory rather
 * than the editor's, and `Ed_SamPlay "B"` plays the goodbye sample out of
 * `AMOSPro_Editor_Samples.Abk`. Neither is state a later session can observe.
 */
export function doQuit(e: Edit): void {
  const editor = e.editor
  e.tokCur()
  if ((editor.quitFlags & 2) !== 0 && editor.configChanged !== 0) configSaveDef(e)
  if ((editor.quitFlags & 4) !== 0 && editor.macroChanged) macroSaveDef(e)
  if ((editor.quitFlags & 8) !== 0) {
    if (!savAll(e)) return
  } else {
    // `.SLoop` (:4451) walks the WINDOWS, so a split view asks twice about one
    // program -- and the second time only if the first answer was No, because
    // saving clears `Prg_Change` and `Ed_Saved` starts by testing it
    for (const w of [...editor.list]) saved(w)
  }
  editor.quit = true // Ed_System (:249)
}

/**
 * `.SavAll` (:4468): every program to disc, then the list of them.
 *
 * The three tests decide what happens to each window, and the middle one is
 * the surprise. A window that is half of a split is skipped outright, on
 * `Edt_LinkPrev`, so the program behind it is written once. A NAMED program is
 * skipped when `Prg_Change` is clear, which is the ordinary "already saved".
 * An UNNAMED one is never skipped: `.NoName` is reached before `Prg_Change` is
 * looked at, so an empty untouched window is written out as `New_Project_1`
 * and reloaded next time.
 *
 * The number in that name is `d7`, which counts every window the walk passes
 * including the ones it skips, so the names follow the window order and not
 * the count of files written.
 *
 * False is `.Err`: the disc refused, the editor stays open, and EdD_NoWarm
 * says the layout was not saved.
 */
function savAll(e: Edit): boolean {
  const editor = e.editor
  const fs = e.fs
  if (fs === null) return quitFailed(e)
  let n = 1
  for (const w of editor.list) {
    const prog = w.prog
    if (w.linkPrev === null) {
      if (prog.name === '') {
        // `addq.b #1,Prg_NoNamed(a6)`, the flag that makes the reload throw
        // the name away again
        prog.noNamed++
        e.name1 = addPath(e, NEW_PROJECT + n + AMOS_EXT)
        if (!saveQuiet(w)) return quitFailed(e)
      } else if (prog.changed) {
        prog.noNamed = 0
        e.name1 = addPath(e, prog.name)
        if (!saveQuiet(w)) return quitFailed(e)
      }
    }
    n++
  }
  if (!fs.writeFile(addPath(e, SESSION_NAME), writeSession(editor))) return quitFailed(e)
  return true
}

/** `L_Prg_Save` on its own: no `.Bak`, no icon, and a disc error is not a throw */
function saveQuiet(w: Edit): boolean {
  try {
    savePrg(w, false)
    return true
  } catch (err) {
    if (err instanceof DiskError) return false
    throw err
  }
}

/** `.Err` (:4525): close the file, say so, and leave the editor standing */
function quitFailed(e: Edit): false {
  confirm(e, { which: 51 }) // EdD_NoWarm
  return false
}

/**
 * `Ed_WarmStart` (:487): the session file read back, and the editor rebuilt
 * around it.
 *
 * NOT a `JFonc` command. `Ed_OpenIt` (:313) calls it once at boot, after the
 * first window exists, which is why the first thing it does is delete that
 * window: the file describes the whole list and there is no room in it for one
 * the editor made on its own.
 *
 * `e` is that boot window, and what this borrows from it is the token table,
 * the detokenise options and the undo size, because the file records none of
 * the three.
 *
 * The two phases are the machine's. The first rebuilds both lists and relinks
 * every pointer; the second reloads each program from the name in its
 * structure. Phase 1 failing leaves nothing behind. Phase 2 failing is
 * `.Err`, which throws BOTH lists away, opens one empty window and puts
 * EdD_WarmErr up: a warm start is all or nothing.
 *
 * True means the session was restored. False is a missing file, which is the
 * ordinary case and says nothing went wrong.
 */
export function warmStart(e: Edit): boolean {
  const editor = e.editor
  const fs = e.fs
  if (fs === null) return false
  const path = addPath(e, SESSION_NAME)
  const bytes = fs.readFile(path)
  if (bytes === null) return false
  const table = e.table
  const opts = e.opts
  const undoSize = e.undo.length
  const fresh = (prog: ProgramBuffer): Edit =>
    new Edit(prog, new EditBuffer(0), new UndoBuffer(undoSize), table, opts, editor)
  editor.delWindow(e)
  const session = readSession(bytes)
  if (session === null) {
    fs.deleteFile(path)
    return warmFailed(e, fresh, 51) // .Err0, and EdD_NoWarm
  }
  const progs = session.programs.map((p) => ProgramBuffer.create(Math.max(p.size, 4)))
  const made: Edit[] = []
  for (const rec of session.windows) {
    const prog = progs[rec.prog]
    if (prog === undefined) return warmFailed(e, fresh, 52) // an Edt_Prg .Linke cannot resolve
    const w = fresh(prog)
    editor.current = w
    made.push(w)
    w.order = rec.order
    w.window = rec.window
    w.windTx = rec.windTx
    w.windTy = rec.windTy
    w.windOldTy = rec.windOldTy
    w.alert = rec.alert
    w.alertTime = rec.alertTime
    w.xPos = rec.xPos
    w.yPos = rec.yPos
    w.xCu = rec.xCu
    w.yCu = rec.yCu
    w.edited = rec.edited
    w.xBloc = rec.xBloc
    w.yBloc = rec.yBloc
    w.yOldBloc = rec.yOldBloc
    w.linkYOld = rec.linkYOld
    w.hidden = rec.hidden
    w.linkFlag = rec.linkFlag
    w.first = rec.first
    w.last = rec.last
    w.etatAff = rec.etatAff
    w.prgDelete = rec.prgDelete
  }
  // `.Linke` (:658), once the whole list exists to be looked up in
  session.windows.forEach((rec, i) => {
    const w = made[i]!
    w.linkPrev = made[rec.linkPrev] ?? null
    w.linkNext = made[rec.linkNext] ?? null
    w.linkScroll = made[rec.linkScroll] ?? null
  })
  editor.current = made[session.current] ?? made[0] ?? null
  // PHASE 2 (:596): the programs themselves, which the file does not carry
  for (let i = 0; i < progs.length; i++) {
    const rec = session.programs[i]!
    const prog = progs[i]!
    // `.CLoop` (:597) copies the structure's own name into Name1 and loads
    // through that, which is why a program whose file has been deleted since
    // the quit takes the whole warm start down
    e.name1 = rec.name
    const file = fs.readFile(rec.name)
    if (file === null) return warmFailed(e, fresh, 52)
    const r = readProgramFile(file, prog.bytes.length)
    if (r.error !== PRG.OK) return warmFailed(e, fresh, 52)
    const loaded = ProgramBuffer.load(r.file!.source, prog.bytes.length)
    for (const w of made) if (w.prog === prog) w.prog = loaded
    progs[i] = loaded
    editor.delProgram(prog)
    editor.addProgram(loaded)
    loaded.pro = r.file!.pro
    loaded.mathFlags = r.file!.mathFlags
    loaded.banks = r.file!.banks
    // `Prg_Load`'s own tail (+Verif.s:4869): the name out of Name1, the line
    // count recomputed and `Prg_Change` cleared. `Prg_StModif` is not among
    // them, so the modified flag is the one the structure carried
    loaded.name = rec.name
    loaded.changed = false
    loaded.modified = rec.modified
    loaded.edited = rec.edited
    loaded.xEProc = rec.xEProc
    rec.marks.forEach((m, at) => (loaded.marks[at] = m))
    if (rec.noNamed !== 0) {
      // `.Name` (:620): the name was Quit's invention, so take it off the
      // program, mark it unsaved again and delete the file it came out of
      loaded.name = ''
      loaded.noNamed = 0
      loaded.changed = true
      fs.deleteFile(rec.name)
    }
  }
  fs.deleteFile(path) // `.DelFichier` (:643)
  drawWindows(editor)
  return true
}

/**
 * `.Err` (:673) and `.Err0` under it: both lists gone, one empty window in
 * their place, and a requester saying which failure it was.
 *
 * The machine frees every structure it has built and then reopens a window
 * with `Edt_OpWindow`. What it does not do is put the boot window back, which
 * it deleted before it opened the file: a failed warm start still costs the
 * session that was on screen, and there was none to lose at boot.
 */
function warmFailed(e: Edit, fresh: (prog: ProgramBuffer) => Edit, which: number): false {
  const editor = e.editor
  editor.delWindows()
  editor.programs.length = 0
  const w = fresh(ProgramBuffer.create(DEF_SIZE))
  editor.current = w
  w.windTy = editor.maxSize(w, -1)
  drawWindows(editor)
  confirm(e, { which })
  return false
}

/* ---- the table ---------------------------------------------------------- */

/** every command this port runs, by its 1-based `JFonc` number */
export const COMMANDS: Record<number, (e: Edit, arg: number) => void> = {
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
  38: windowHide,
  61: (e) => {
    // Ed_OpenLoad (:11221) is `bsr Ed_OpenWindow / bra Ed_Load`, and the load
    // runs in the window that was just opened
    openWindow(e)
    COMMANDS[ED.LOAD]!(e.editor.current ?? e, 0)
  },
  81: (e) => {
    // Ed_CloseWindowQuit (:11388): the ZAP remote control closes without ever
    // being offered the chance to quit
    closeWindow(e, e, !e.editor.zappeuse)
  },
  26: setTab,
  76: gotoLine,
  73: key2Menu,
  74: prg2Menu,
  69: zapNewLine,
  70: reAlert,
  71: zapNewLineTok,
  78: testCmd,
  82: quitCmd,
  83: infos,
  79: indentCmd,
  84: merge,
  87: procOpen,
  151: procML,
  77: edRun,
  28: edEscape,
  111: (e, n) => runHidden(e, n),
  105: edWb,
  88: loadHidden,
  89: (e) => procs(e, false),
  90: (e) => procs(e, true),
  104: showKey,
  114: setBuffer,
  147: check13,
  146: prgPrint,
  86: blocPrint,
  150: about,
  149: aboutExt,
  13: (e) => sepMove(e, -ED_ROW_SY, false),
  14: (e) => sepMove(e, ED_ROW_SY, false),
  15: (e) => sepMove(e, -ED_ROW_SY, true),
  16: (e) => sepMove(e, ED_ROW_SY, true),
  137: (e) => {
    // EdC_SaveDefault (:4857), which asks first
    e.tokCur()
    if (confirm(e, { which: 45 }) !== 1) notDone(e) // EdD_SvConf
    configSaveDef(e)
  },
  138: (e) => {
    // EdC_SaveAs (:4871)
    e.tokCur()
    configSaveAs(e)
  },
  139: (e) => {
    // EdC_LoadDefault (:4893)
    e.tokCur()
    configSaved(e)
    e.name1 = addPath(e, CONFIG_NAME)
    configLoad(e)
    // `move.b #2,EdC_Changed(a5)`: loaded, so never offered for saving
    e.editor.configChanged = 2
  },
  140: (e) => {
    // EdC_LoadAs (:4905)
    e.tokCur()
    configSaved(e)
    if (!selectFile(e, 134)) notDone(e)
    configLoad(e)
    e.editor.configChanged = 2
  },
  141: quitOptions,
  142: setAutoSave,
  91: prevWindow,
  92: nextWindow,
  93: flipSizeWindow,
  95: splitWindow,
  96: linkCursor,
  102: newAllHidden,
  103: openWindow,
  112: (e, n) => editHidden(e, n),
  113: (e, n) => newHidden(e, n),
  153: closeName,
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
    macroSaveDef(e)
  },
  135: addUser,
  136: delUser,
  148: samOn,
  154: rename,
  179: prevHidden,
  180: nextHidden,
  183: goHelp,
  182: zapNewConfig,
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

// The 46 `Ed_UserMenu` entries, taken from the routine names ./keymap.gen.ts
// reads out of `JFonc` rather than listed here: 27, 115 to 134, 155 to 178 and
// 184, and no comment can go stale about which.
ED_ROUTINES.forEach((name, i) => {
  if (name === 'Ed_UserMenu') COMMANDS[i + 1] = userMenu
})

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
export function edCall(e: Edit, cmd: number, param = 0): number {
  // `bsr Ed_ClEProc` is the first instruction of `Ed_FCall` (:2572)
  clEProc(e)
  const flags = flagsOf(cmd)
  // `cmp.w #HiddenCommands-1,d2` (:2595): 184 and up are the hidden-program
  // menu, three entries per hidden program, and they decode into Run, Edit and
  // New with the program's index carried in d1. The flag byte above was read
  // BEFORE this, off the raw number
  let call = cmd
  let arg = param
  if (cmd >= HIDDEN_COMMANDS) {
    const n = cmd - HIDDEN_COMMANDS
    call = HIDDEN_CALL + (n % 3)
    arg = Math.floor(n / 3) + e.editor.posHidden
  }
  // `.Fonc` (:2610): a command with a program bound to it never reaches the
  // table, and the branch is above the macro test rather than below it
  const bound = cmd < HIDDEN_COMMANDS ? autoLoad(e, cmd) : null
  if (bound !== null && e.macroTape === null) {
    clearAlert(e)
    e.callFlags = flags
    e.editor.prgCommand?.(bound)
    return 0
  }
  const fn = COMMANDS[call]
  if (fn === undefined) throw new RangeError(`editor command ${call} (${routineOf(call)}) is not ported`)
  if (e.macroTape !== null && (flags & FLAG.MACRO) === 0) {
    // `.NoMacro` (:2624): the key that got here has already been taped, so
    // the refusal rewinds over it. The command does not run, `Ed_SCallFlags`
    // is not written, and `bra Ed_Loop` is the end of it
    e.macroTape.at -= 3
    clearAlert(e)
    confirm(e, { which: 15 }) // EdD_Macro3, "This function cannot be used in a macro!"
    return 0
  }
  e.callFlags = flags
  const alert = run(e, () => {
    if ((flags & FLAG.CLOSED) !== 0) mustEdit(e)
    e.yOldBloc = e.line
    fn(e, arg)
  })
  return edLoop(e, alert)
}

/**
 * The top of `Ed_Loop` (:915), which every command comes back through and so
 * does every program that stops.
 */
function edLoop(e: Edit, alert: number): number {
  // the window the command left behind. A hidden one is deleted outright and a
  // visible one goes through Close, which is what makes Merge throw its
  // program away and Run A Program keep its window
  const del = e.editor.windowToDel
  if (del !== null) {
    e.editor.windowToDel = null
    if (del.hidden !== 0) e.editor.delWindow(del)
    else closeWindow(e, del, false)
  }
  // `bsr Ed_AllAverFin` (:933), which is why an unmatched `Ed_AverMess` costs
  // one command and not the session: every warning left up comes down here
  e.editor.avert.length = 0
  // `bsr Ed_LinkeScroll` (:964), after the command and not inside it
  const now = e.editor.current
  if (now !== null) linkScroll(now)
  return alert
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
 * Above it is the macro layer, and it is here: the tape is written first, and
 * a live key is looked up in `EdMa_List` before the map sees it.
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
/** what `Ed_Loop` clears before it lets a command run */
function clearAlert(e: Edit): void {
  e.alert = 0
  e.alertTime = 0
  e.alertText = ''
}

function run(e: Edit, fn: () => void): number {
  clearAlert(e)
  e.diskError = -1
  e.testError = -1
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
    // the same shape again: `Ed_ErrTest` has already moved the cursor, and
    // the message it puts up comes from `Ed_TstMessages` rather than the
    // editor's own table, so what is kept here is the code
    if (err instanceof VerifyError) {
      e.testError = err.code
      return 0
    }
    if (!(err instanceof EditorAlert)) throw err
    e.alert = err.code
    e.alertTime = err.duration
    e.alertText = err.text
    if (e.editor.zappeuse) {
      // `Ed_ZapAlert` (:7614): the message the status line would have shown is
      // the remote call's answer instead, and the magic buffer is not written
      e.editor.zapError = -1
      e.editor.zapMessage = err.code
    } else {
      e.editor.alertSaved = err.code
      e.editor.alertSavedText = err.text
    }
  }
  return e.alert
}
