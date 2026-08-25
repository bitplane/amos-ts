/**
 * `Ed_ZapIn` (+Edit.s:2645) and `Ed_ZapFonction` (:2700): the editor driven by
 * a program instead of by a person.
 *
 * An AMOS accessory reaches the editor through two keywords, and this is the
 * far side of both. `Call Editor` hands over a command number and a parameter
 * and the editor runs the command as if a key had been pressed; `Ask Editor`
 * asks one of eleven questions about the program being edited. Neither is a
 * back door: the accessory has to be an accessory, and the command has to be
 * one the table marks as safe to run without a person watching.
 *
 * ## Ed_Zappeuse is what makes a requester answer itself
 *
 * `Ed_Dialogue` (:3108) tests it before it draws anything and returns
 * `Ed_ZapParam` instead, so every question the editor would ask has the same
 * answer, the number the accessory sent. `Ed_GotoL` is the one command that
 * reads that answer as a number rather than as a button, which is how Call
 * Editor 76 with a parameter goes to a line.
 *
 * `Ed_Alert` (:7595) tests it too and becomes `Ed_ZapAlert`: the message that
 * would have gone on the status line is returned as error -1 instead.
 *
 * ## Two of the thirteen functions cannot be called
 *
 * `EdZ_Jump` (:2826) has thirteen entries and `EdZ_NFonc equ 11` below it, and
 * `Ed_ZapFonction`'s `cmp.l #EdZ_NFonc,d0 / bcc .IlFonc` is the only bound
 * check there is. So `EdZ_Token` (12), which tokenises a line, and
 * `EdZ_GetConfig` (13), which hands back the address of `Ed_Config`, are
 * written, assembled, and unreachable from any program.
 */
import type { Edit } from './edit'
import { detokLineBytes } from '../tokens/edtok'
import { FLAG, edCall, flagsOf } from './commands'
import { ED_MESSAGES } from '../runtime/edmessages.gen'

/** `EdZ_Jump`'s entries, by the number `Ask Editor` sends */
export const ZAP = {
  LINE: 1,
  NAME: 2,
  X: 3,
  Y: 4,
  LINES: 5,
  BLOCK_X1: 6,
  BLOCK_Y1: 7,
  BLOCK_X2: 8,
  BLOCK_Y2: 9,
  FREE: 10,
  STRUCTURE: 11,
  /** `EdZ_Token`, past `EdZ_NFonc` and unreachable */
  TOKENISE: 12,
  /** `EdZ_GetConfig`, the same */
  CONFIG: 13,
} as const

/** `EdZ_NFonc equ 11` (:2840): how many of the thirteen the bound check allows */
export const ZAP_FUNCTIONS = 11

/** `Ed_ZapError` and the message `Ed_ZapMessage` points at, as its number */
export interface ZapAnswer {
  error: number
  message: number
  /** the characters, which is what `ZapReturn` puts in `Param$` */
  text: string
}

/** what a function answers: d0, a0 and d2, where d2 of 2 means the string is it */
export interface ZapValue {
  value: number
  text: string
  kind: 0 | 2
}

/**
 * `Ed_ZapIn` (:2645): run an editor command on behalf of a program.
 *
 * `command` is 1-based, the way `JFonc` is numbered everywhere else in this
 * port; the machine's d2 is one less and every test below is written against
 * that. `line` is `Name1`, the command string, and null is a caller that did
 * not supply one.
 *
 * The four refusals, in the order they are made:
 *
 * - -6, message 15. The window running the accessory IS the current window, or
 *   the program is not an accessory at all. `Edt_Runned` against `Edt_Current`
 *   is the first instruction of the routine, and it is what stops an accessory
 *   from driving itself.
 * - -4, message 13. `FlagFonc` bit 7 is clear, so the command is not one that
 *   may run without a person watching.
 * - -5, message 14. Bit 6 says the command needs a string and `Name2`'s length
 *   word is zero, so an empty string is refused as hard as no string.
 * - -1, and the alert's own message. The command ran and raised one.
 *
 * `Ed_Zappeuse` is saved and put back around the call rather than cleared,
 * because on the machine it is part of the INTERPRETER's state: `Prg_DataNew`
 * (+Verif.s:4625) clears it along with `Prg_Accessory` on the way in, and
 * `Prg_DataLoad` restores whatever the accessory had on the way out, which is
 * nothing. Those two calls are the only writes to it in the whole system
 * besides `.Branch`'s.
 *
 * DEVIATION: the rest of what the machine does around the call is not editor
 * state. It saves the accessory's own program (`Prg_DataSave`), points the
 * banks at the edited program, brings the editor screen to the front, and then
 * runs `Ed_Loop` five more times before `Ed_ZapOut` -- `Ed_ZapCounter` (:1141)
 * counting them, so the display has settled before the accessory gets control
 * back. This port's editor has no interpreter behind it and nothing to draw.
 */
export function zapCall(e: Edit, command: number, param: number, line: string | null): ZapAnswer {
  const editor = e.editor
  if (editor.runned === null || editor.runned === editor.current || !editor.accessory) {
    return fail(editor, -6, 15)
  }
  editor.zapParam = param
  editor.zapError = 0
  editor.zapMessage = 0
  editor.zapText = ''
  const d2 = command - 1
  // `cmp.w #HiddenCommands,d2 / bcc .PaCom`, which is 184 and not 183: the
  // last hidden slot is inside the table by one
  if (d2 < 0 || d2 >= 184) return fail(editor, -4, 13)
  const flags = flagsOf(command)
  if ((flags & FLAG.ZAP) === 0) return fail(editor, -4, 13)
  if ((flags & FLAG.COMMAND) !== 0 && (line === null || line === '')) {
    return fail(editor, -5, 14)
  }
  if (line !== null) e.name1 = line
  const was = editor.zappeuse
  // `and.b #$F0,d1 / move.b d1,Ed_Zappeuse(a5)`: the high nibble of the flags,
  // which is never zero here because bit 7 is what got the command this far
  editor.zappeuse = true
  try {
    edCall(e, command)
  } finally {
    editor.zappeuse = was
  }
  return { error: editor.zapError, message: editor.zapMessage, text: editor.zapText }
}

function fail(editor: Edit['editor'], error: number, message: number): ZapAnswer {
  editor.zapError = error
  editor.zapMessage = message
  // `bsr Ed_GetMessage / move.l a0,Ed_ZapMessage(a5)` on all four arms
  editor.zapText = ED_MESSAGES[message - 1] ?? ''
  return { error, message, text: editor.zapText }
}

/**
 * `Ed_ZapFonction` (:2700): one of the eleven questions an accessory may ask.
 *
 * Every coordinate comes back 1-BASED, because `EdZ_Coo` adds one to all six
 * of them on the way out. The block corners are the exception that proves it:
 * `EdZ_Bloc`'s `.No` arm pops its own return address off the stack
 * (`addq.l #4,sp`) and answers -1 from the function itself, so a window with
 * no block gives -1 rather than the 0 the addition would have made.
 *
 * `n` counts from 1. Anything above `EdZ_NFonc` is -7 and message 16, which is
 * what puts `EdZ_Token` and `EdZ_GetConfig` out of reach.
 */
export function zapFunction(e: Edit, n: number, param = 0): ZapValue | ZapAnswer {
  const editor = e.editor
  if (!editor.accessory) return fail(editor, -6, 15)
  if (n < 1 || n > ZAP_FUNCTIONS) return fail(editor, -7, 16)
  const w = editor.current
  if (w === null) return fail(editor, -6, 15)
  const num = (value: number): ZapValue => ({ value, text: '', kind: 0 })
  const str = (text: string): ZapValue => ({ value: 0, text, kind: 2 })
  switch (n) {
    case ZAP.LINE:
      return str(zapLine(w, param))
    case ZAP.NAME:
      return str(w.prog.name)
    case ZAP.X:
      return num(w.xCu + 1)
    case ZAP.Y:
      return num(w.yPos + w.yCu + 1)
    case ZAP.LINES:
      return num(w.prog.lineCount)
    case ZAP.FREE:
      return num(w.prog.stBas - w.prog.stMini)
    default:
      break
  }
  if (n === ZAP.STRUCTURE) {
    // DEVIATION: `EdZ_GetStruc` answers the ADDRESS of the `Edt_` structure,
    // for an accessory that intends to read the editor's memory directly.
    // There are no addresses here, so the answer is zero and a program that
    // pokes through it will find nothing rather than the wrong thing
    return num(0)
  }
  const b = zapBlock(w)
  if (b === null) return num(-1)
  return num([b.x1, b.y1, b.x2, b.y2][n - ZAP.BLOCK_X1]! + 1)
}

/**
 * `EdZ_GetLine` (:2890): a line as text, detokenised.
 *
 * `param` is 1-based and anything at or below zero means the line the cursor
 * is on. The bound test compares the number the caller sent against
 * `Prg_NLigne` AFTER subtracting one from its own copy, so line `NLigne` is
 * allowed and answers the last line, and anything past that answers the empty
 * string rather than an error.
 */
function zapLine(w: Edit, param: number): string {
  let n: number
  if (param <= 0) {
    n = w.yCu + w.yPos
  } else {
    if (param > w.prog.lineCount) return ''
    n = param - 1
  }
  const f = w.prog.findLine(n)
  if (!f.found) return ''
  return detokLineBytes(w.prog.bytes, f.at, w.table, w.opts)
}

/**
 * `EdZ_Bloc` (:2917): the block's two corners, in the order they are on screen.
 *
 * The anchor and the cursor are compared as a PAIR: the line decides, and the
 * column only when the two are on the same line. Null is `Edt_YBloc` negative,
 * which is a window with no block.
 */
function zapBlock(w: Edit): { x1: number; y1: number; x2: number; y2: number } | null {
  if (w.yBloc < 0) return null
  const y1 = w.yBloc
  const y2 = w.yCu + w.yPos
  const x1 = w.xBloc
  const x2 = w.xCu
  if (y2 > y1 || (y2 === y1 && x2 >= x1)) return { x1, y1, x2, y2 }
  return { x1: x2, y1: y2, x2: x1, y2: y1 }
}
