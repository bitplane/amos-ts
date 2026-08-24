import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { detokLineBytes, tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer, UN } from './undo'
import { Edit } from './edit'
import { COMMANDS, ED, FLAG, edCall, flagsOf, routineOf } from './commands'
import { ED_ROUTINES } from './keymap.gen'

const table = new TokenTable(CORE_TOKENS)
const PROG = 'Print "one"\nProcedure DEMO\n  Print "in"\nEnd Proc\nPrint "two"'
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)

function open(text = PROG, rows = 10): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text)), new EditBuffer(rows), new UndoBuffer(50), table)
  e.fill()
  return e
}

/** the program as the editor would list it */
const listing = (e: Edit): string[] =>
  Array.from({ length: e.prog.lineCount }, (_, i) => detokLineBytes(e.prog.bytes, e.prog.findLine(i).at, table))

/** the window, which is text and not tokens */
const window = (e: Edit, n = 6): string[] => Array.from({ length: n }, (_, r) => e.buf.text(r))

describe('the table', () => {
  it('agrees with JFonc about what each number is', () => {
    expect(routineOf(ED.CUR_UP)).toBe('Ed_CHaut')
    expect(routineOf(ED.RETURN)).toBe('Ed_Return')
    expect(routineOf(ED.DELETE_TO_START)).toBe('Ed_DelDebut')
    expect(routineOf(ED.GOTO_MARK_0 + 9)).toBe('Ed_GMark9')
  })

  it('reads FlagFonc for the bits Ed_FCall acts on', () => {
    // every movement command is %10100000: ZAP-able, macro-able, no redraw
    for (const c of [1, 2, 3, 4, 11, 12]) expect(flagsOf(c)).toBe(0xa0)
    // the ones that touch the line ask for it back
    expect(flagsOf(ED.RETURN) & FLAG.BUFFER).not.toBe(0)
    expect(flagsOf(ED.DELETE) & FLAG.CLOSED).not.toBe(0)
    expect(flagsOf(ED.DELETE_WORD) & FLAG.CLOSED).not.toBe(0)
    // Escape, Help and Quit are none of those things
    for (const c of [27, 28, 82]) expect(flagsOf(c)).toBe(0)
  })

  it('says which commands are not ported rather than doing nothing', () => {
    const e = open()
    expect(() => edCall(e, 66)).toThrow(/command 66 \(Ed_Search\) is not ported/)
    expect(COMMANDS[66]).toBeUndefined()
  })

  it('has an entry for everything ED names', () => {
    for (const [name, cmd] of Object.entries(ED)) {
      expect(COMMANDS[cmd], `${name} is ${ED_ROUTINES[cmd - 1]}`).toBeTypeOf('function')
    }
  })
})

describe('the cursor', () => {
  it('walks down and stops on the line PAST the last', () => {
    // `cmp.w Prg_NLigne(a6),d0 / bcc Ed_CBasE`, so line 5 of a 5-line
    // program is reachable and line 6 is not. That line is where a program
    // grows: typing on it and moving off appends
    const e = open()
    for (let i = 0; i < 5; i++) expect(edCall(e, ED.CUR_DOWN)).toBe(0)
    expect(e.line).toBe(5)
    expect(e.prog.lineCount).toBe(5)
    expect(edCall(e, ED.CUR_DOWN)).toBe(201) // Bottom of text.
    expect(e.line).toBe(5)
  })

  it('says Top of text rather than going above line 0', () => {
    const e = open()
    expect(edCall(e, ED.CUR_UP)).toBe(200)
    expect(e.line).toBe(0)
  })

  it('scrolls the window rather than the cursor once it fills', () => {
    // Ed_CBasT: `cmp.w d1,d0 / bcc .CBs1` -- at the last ROW it moves YPos
    const e = open(Array.from({ length: 20 }, (_, i) => `Print ${i}`).join('\n'), 4)
    for (let i = 0; i < 3; i++) edCall(e, ED.CUR_DOWN)
    expect([e.yPos, e.yCu]).toEqual([0, 3])
    edCall(e, ED.CUR_DOWN)
    expect([e.yPos, e.yCu]).toEqual([1, 3])
    // and the row that scrolled in was detokenised, not left behind
    expect(window(e, 4)).toEqual(['Print 1', 'Print 2', 'Print 3', 'Print 4'])
    // and back up: three moves the cursor, the fourth is at the top row and
    // scrolls instead, so the cursor stays where it is (`CHt1`)
    for (let i = 0; i < 4; i++) edCall(e, ED.CUR_UP)
    expect([e.yPos, e.yCu]).toEqual([0, 0])
    expect(window(e, 4)).toEqual(['Print 0', 'Print 1', 'Print 2', 'Print 3'])
  })

  it('scrolls sideways at 70 and at 15, not at the window width', () => {
    // Ed_CDroite compares against `WiTx-10`, and WiTx is the window
    // structure's own offset 80 (+Equ.s:668). Ed_CGauche uses a bare 15
    const e = open()
    e.buf.setText(0, 'x'.repeat(120))
    for (let i = 0; i < 70; i++) edCall(e, ED.CUR_RIGHT)
    expect([e.xCu, e.xPos]).toEqual([70, 1])
    for (let i = 0; i < 10; i++) edCall(e, ED.CUR_RIGHT)
    expect([e.xCu, e.xPos]).toEqual([80, 11])
    // left scrolls once the cursor is within 15 of the window's left edge
    while (e.xCu > 26) edCall(e, ED.CUR_LEFT)
    expect([e.xCu, e.xPos]).toEqual([26, 11])
    edCall(e, ED.CUR_LEFT)
    expect([e.xCu, e.xPos]).toEqual([25, 10])
  })

  it('will not walk right past 250, where a line stops', () => {
    const e = open()
    e.xCu = 249
    edCall(e, ED.CUR_RIGHT)
    expect(e.xCu).toBe(250)
    edCall(e, ED.CUR_RIGHT)
    expect(e.xCu).toBe(250)
  })

  it('goes to the ends of the line without leaving it', () => {
    const e = open()
    edCall(e, ED.LINE_END)
    expect(e.xCu).toBe('Print "one"'.length)
    edCall(e, ED.LINE_START)
    expect(e.xCu).toBe(0)
  })
})

describe('words', () => {
  const at = (text: string, col: number, cmd: number): number => {
    const e = open()
    e.buf.setText(0, text)
    e.xCu = col
    edCall(e, cmd)
    return e.xCu
  }

  it('goes left to the start of the word behind the cursor', () => {
    expect(at('one two three', 13, ED.WORD_LEFT)).toBe(8)
    expect(at('one two three', 8, ED.WORD_LEFT)).toBe(4)
    expect(at('one two three', 3, ED.WORD_LEFT)).toBe(0)
    expect(at('one two three', 0, ED.WORD_LEFT)).toBe(0)
  })

  it('steps back over the spaces first, then over the word', () => {
    // .MGo1 eats the run of spaces, .MGo2 the letters
    expect(at('one     two', 8, ED.WORD_LEFT)).toBe(0)
  })

  it('goes right to the start of the next word', () => {
    expect(at('one two three', 0, ED.WORD_RIGHT)).toBe(4)
    expect(at('one two three', 4, ED.WORD_RIGHT)).toBe(8)
    expect(at('one two three', 8, ED.WORD_RIGHT)).toBe(13)
  })

  it('counts digits and accented letters as part of a word', () => {
    // Une_Lettre (:4152): 0-9, A-Z, a-z and everything from 128 up
    expect(at('a1b2 next', 0, ED.WORD_RIGHT)).toBe(5)
    expect(at('caf\xe9s next', 0, ED.WORD_RIGHT)).toBe(6)
  })

  it('answers the end of the line for a cursor past it', () => {
    // `cmp.w d0,d1 / bls .MGo0 / move.w d0,d1` -- nothing is looked at
    expect(at('abc', 40, ED.WORD_LEFT)).toBe(3)
  })
})

describe('editing the line', () => {
  it('deletes a word and keeps it for undo', () => {
    const e = open()
    e.buf.setText(0, 'one two three')
    e.xCu = 4
    edCall(e, ED.DELETE_WORD)
    expect(e.buf.text(0)).toBe('one three')
    const r = e.undo.undo()
    expect(r?.code).toBe(UN.CLEAR)
    expect(new TextDecoder('latin1').decode(r!.block!)).toBe('two ')
  })

  it('raises Edt_LEdited, so the delete reaches the program', () => {
    // `R_DelChar` bumps the flag at `.Del2` and none of its three callers
    // does. Without it the window changes and the program does not
    const e = open()
    e.xCu = 6
    edCall(e, ED.DELETE_TO_START)
    expect(e.edited).toBeGreaterThan(0)
    e.tokCur()
    expect(listing(e)[0]).toBe('"one"')
  })

  it('backs over a word by moving to its start and deleting forward', () => {
    const e = open()
    e.buf.setText(0, 'one two three')
    e.xCu = 7
    edCall(e, ED.BACK_WORD)
    expect(e.buf.text(0)).toBe('one three')
    expect(e.xCu).toBe(4)
  })

  it('clears to the end of the line and to the start of it', () => {
    const e = open()
    e.buf.setText(0, 'one two three')
    e.xCu = 7
    edCall(e, ED.DELETE_TO_END)
    expect(e.buf.text(0)).toBe('one two')
    e.xCu = 4
    edCall(e, ED.DELETE_TO_START)
    expect(e.buf.text(0)).toBe('two')
    expect(e.xCu).toBe(0)
  })

  it('clears the whole line without taking it out of the program', () => {
    const e = open()
    edCall(e, ED.CLEAR_LINE)
    expect(e.buf.text(0)).toBe('')
    expect(e.prog.lineCount).toBe(5)
    expect(listing(e)[0]).toBe('Print "one"') // until Ed_TokCur runs
  })

  it('indents the whole line, not the text at the cursor', () => {
    // Ed_Tab (:3659) opens Ed_Tabs spaces at column 0 whatever column the
    // cursor is in, and takes the cursor with it
    const e = open()
    e.xCu = 6
    edCall(e, ED.TAB)
    expect(e.buf.text(0)).toBe('   Print "one"')
    expect(e.xCu).toBe(9)
    edCall(e, ED.SHIFT_TAB)
    expect(e.buf.text(0)).toBe('Print "one"')
    expect(e.xCu).toBe(6)
  })

  it('takes off fewer spaces than a tab when there are fewer', () => {
    const e = open()
    e.buf.setText(0, ' Print 1')
    e.xCu = 0
    edCall(e, ED.SHIFT_TAB)
    expect(e.buf.text(0)).toBe('Print 1')
    expect(e.xCu).toBe(0)
  })

  it('refuses a tab that would push the line past 250', () => {
    // `cmp.w #250,d0 / bcc Ed_LToLong` -- refused, where R_InsChar trims
    const e = open()
    e.buf.setText(0, 'x'.repeat(248))
    expect(edCall(e, ED.TAB)).toBe(199)
    expect(e.buf.length(0)).toBe(248)
  })
})

describe('lines going in and out', () => {
  it('inserts an empty line in front of the cursor', () => {
    const e = open()
    edCall(e, ED.CUR_DOWN)
    edCall(e, ED.INSERT_LINE)
    expect(e.prog.lineCount).toBe(6)
    expect(listing(e)).toEqual(['Print "one"', '', 'Procedure DEMO', '  Print "in"', 'End Proc', 'Print "two"'])
    expect(e.undo.undo()?.code).toBe(UN.ILINE)
  })

  it('deletes the line and closes the window over it', () => {
    const e = open()
    edCall(e, ED.DELETE_LINE)
    expect(e.prog.lineCount).toBe(4)
    expect(listing(e)[0]).toBe('Procedure DEMO')
    // .RetV1: the rows below came up, and the last was refilled
    expect(window(e, 5)).toEqual(['Procedure DEMO', '  Print "in"', 'End Proc', 'Print "two"', ''])
    const r = e.undo.undo()
    expect(r?.code).toBe(UN.DLINE)
    expect(new TextDecoder('latin1').decode(r!.block!)).toBe('Print "one"')
  })

  it('will not delete a closed procedure, and Ed_FCall is what stops it', () => {
    // FlagFonc bit 2 is checked before the command is reached at all
    const e = open()
    const proc = e.prog.findLine(1).at
    e.prog.bytes[proc + 10] = e.prog.bytes[proc + 10]! | 0x80 // close DEMO
    e.prog.countLines()
    e.fill()
    edCall(e, ED.CUR_DOWN)
    expect(e.buf.editable(1)).toBe(false)
    expect(edCall(e, ED.DELETE_LINE)).toBe(183)
    expect(e.prog.lineCount).toBe(3) // the fold is one line, and still there
  })

  it('splits a line at the cursor', () => {
    const e = open()
    e.xCu = 6
    edCall(e, ED.RETURN)
    expect(e.prog.lineCount).toBe(6)
    expect([e.line, e.xCu]).toEqual([1, 0])
    // the carried half is in the window and reaches the program on the way out
    expect(e.buf.text(1)).toBe('"one"')
    // the split leaves ONE record, not one per step: Ed_FUndo is raised over
    // the tokenise and the insert inside it
    expect(e.undo.undo()?.code).toBe(UN.SPLIT)
    e.undo.redo()
    e.tokCur()
    expect(listing(e).slice(0, 3)).toEqual(['Print ', '"one"', 'Procedure DEMO'])
  })

  it('at column 0 opens a line above instead of splitting', () => {
    const e = open()
    edCall(e, ED.RETURN)
    expect(e.prog.lineCount).toBe(6)
    expect(listing(e)[0]).toBe('')
    expect([e.line, e.xCu]).toEqual([1, 0])
  })

  it('joins onto the line above when Backspace is at column 0', () => {
    const e = open()
    edCall(e, ED.CUR_DOWN)
    expect(e.xCu).toBe(0)
    edCall(e, ED.BACKSPACE)
    expect(e.buf.text(0)).toBe('Print "one"Procedure DEMO')
    expect(e.xCu).toBe(11)
    expect(e.prog.lineCount).toBe(4)
    expect(e.undo.undo()?.code).toBe(UN.JOIN)
  })

  it('does nothing at all when Backspace is at the top ROW', () => {
    // `tst.w Edt_YCu(a4) / beq .Out` -- Ed_Join never scrolls to find the
    // line above, so a join at the top of the window is not a join
    const e = open(Array.from({ length: 20 }, (_, i) => `Print ${i}`).join('\n'), 4)
    e.yPos = 5
    e.fill()
    expect(e.line).toBe(5)
    edCall(e, ED.BACKSPACE)
    expect(e.prog.lineCount).toBe(20)
    expect(e.buf.text(0)).toBe('Print 5')
  })

  it('refuses a join that would make a line too long', () => {
    const e = open('Print 1\nPrint 2')
    e.buf.setText(0, 'x'.repeat(200))
    e.buf.setText(1, 'y'.repeat(60))
    e.yCu = 1
    e.xCu = 0
    expect(edCall(e, ED.BACKSPACE)).toBe(199)
    expect(e.prog.lineCount).toBe(2)
  })

  it('backspaces a character when it is not at column 0', () => {
    const e = open()
    e.xCu = 5
    edCall(e, ED.BACKSPACE)
    expect(e.buf.text(0)).toBe('Prin "one"')
    expect(e.xCu).toBe(4)
  })
})

describe('the long jumps', () => {
  it('goes to the top and says so', () => {
    const e = open(Array.from({ length: 40 }, (_, i) => `Print ${i}`).join('\n'), 8)
    e.yPos = 20
    e.yCu = 3
    e.fill()
    expect(edCall(e, ED.TEXT_TOP)).toBe(200) // Top of text.
    expect([e.yPos, e.yCu, e.xPos, e.xCu]).toEqual([0, 0, 0, 0])
    expect(e.buf.text(0)).toBe('Print 0')
  })

  it('goes to the bottom and leaves half a window of it showing', () => {
    // Ed_BTex: `lsr.w #1,d1` off Edt_WindTy, and the comment beside it reads
    // `*XXX EdTy-EdTY/3`, so the author was not sure either
    const e = open(Array.from({ length: 40 }, (_, i) => `Print ${i}`).join('\n'), 8)
    expect(edCall(e, ED.TEXT_BOTTOM)).toBe(201)
    expect([e.yPos, e.yCu]).toEqual([36, 4])
    expect(e.line).toBe(40) // the line past the last, again
  })

  it('pages by a window less two rows, so two lines carry over', () => {
    const e = open(Array.from({ length: 40 }, (_, i) => `Print ${i}`).join('\n'), 8)
    edCall(e, ED.PAGE_DOWN)
    expect(e.yPos).toBe(6)
    expect(e.buf.text(0)).toBe('Print 6')
    edCall(e, ED.PAGE_UP)
    expect(e.yPos).toBe(0)
  })

  it('puts the cursor on the last row, or on the last line if that is nearer', () => {
    const e = open(PROG, 10)
    edCall(e, ED.BOTTOM_PAGE)
    expect(e.yCu).toBe(5) // 10 rows, 5 lines
    edCall(e, ED.TOP_PAGE)
    expect(e.yCu).toBe(0)
  })

  it('finds the label or procedure either side of the cursor', () => {
    const e = open('Print 1\nMYLAB:\nPrint 2\nProcedure P\nEnd Proc\nPrint 3')
    e.yCu = 2
    expect(edCall(e, ED.NEXT_LABEL)).toBe(0)
    expect(e.line).toBe(3)
    e.yPos = 0
    e.yCu = 2
    expect(edCall(e, ED.PREV_LABEL)).toBe(0)
    expect(e.line).toBe(1)
  })
})

describe('marks', () => {
  it('sets one where the cursor is and goes back to it', () => {
    const e = open(Array.from({ length: 40 }, (_, i) => `Print ${i}`).join('\n'), 8)
    e.yPos = 10
    e.yCu = 2
    e.xCu = 4
    expect(edCall(e, ED.SET_MARK_0 + 5)).toBe(64) // Mark set.
    expect(e.prog.getMark(5)).toEqual({ line: 12, column: 4 })
    edCall(e, ED.TEXT_TOP)
    expect(edCall(e, ED.GOTO_MARK_0 + 5)).toBe(0)
    expect([e.line, e.xCu]).toEqual([12, 4])
  })

  it('says so when the mark was never set', () => {
    const e = open()
    expect(edCall(e, ED.GOTO_MARK_0 + 9)).toBe(65) // Mark not defined.
  })

  it('pushes where the cursor was onto marks 0 to 3 on every long jump', () => {
    // Ed_AutoMarks (:4192) is four deep, so the first four marks are a
    // jump-back history that Set Mark shares whether it means to or not
    const e = open(Array.from({ length: 40 }, (_, i) => `Print ${i}`).join('\n'), 8)
    e.yPos = 20
    e.yCu = 1
    edCall(e, ED.TEXT_TOP)
    expect(e.prog.getMark(0)).toEqual({ line: 21, column: 0 })
    e.yPos = 30
    edCall(e, ED.TEXT_BOTTOM)
    expect(e.prog.getMark(0)).toEqual({ line: 30, column: 0 })
    expect(e.prog.getMark(1)).toEqual({ line: 21, column: 0 })
  })
})

describe('insert mode', () => {
  it('is one flag and flipping it is the whole command', () => {
    const e = open()
    expect(e.insert).toBe(true)
    edCall(e, ED.FLIP_INSERT)
    expect(e.insert).toBe(false)
    edCall(e, ED.FLIP_INSERT)
    expect(e.insert).toBe(true)
  })
})
