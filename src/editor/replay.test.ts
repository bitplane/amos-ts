import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { detokLineBytes, tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { ED_MESSAGES } from '../runtime/edmessages.gen'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, edCall, edKey, typeChar } from './commands'

const table = new TokenTable(CORE_TOKENS)
const PROG = 'Print "one"\nPrint "two"\nPrint "three"'
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)

function open(text = PROG, rows = 8): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text)), new EditBuffer(rows), new UndoBuffer(50), table)
  e.fill()
  return e
}

/** the program as the editor would list it */
const listing = (e: Edit): string[] =>
  Array.from({ length: e.prog.lineCount }, (_, i) => detokLineBytes(e.prog.bytes, e.prog.findLine(i).at, table))

const undo = (e: Edit): number => edCall(e, ED.UNDO)
const redo = (e: Edit): number => edCall(e, ED.REDO)

describe('a character', () => {
  it('goes back out again, and comes back on redo', () => {
    const e = open()
    e.xCu = 5
    typeChar(e, 'X')
    expect(e.buf.text(0)).toBe('PrintX "one"')
    expect(e.xCu).toBe(6)
    expect(undo(e)).toBe(0)
    expect(e.buf.text(0)).toBe('Print "one"')
    expect(e.xCu).toBe(5)
    expect(redo(e)).toBe(0)
    expect(e.buf.text(0)).toBe('PrintX "one"')
  })

  it('puts back what it covered when it was typed over something', () => {
    // b4 is -1 for an insert and the covered character otherwise, so one byte
    // decides which way back it is
    const e = open()
    e.insert = false
    e.xCu = 0
    typeChar(e, 'X')
    expect(e.buf.text(0)).toBe('Xrint "one"')
    undo(e)
    expect(e.buf.text(0)).toBe('Print "one"')
    redo(e)
    expect(e.buf.text(0)).toBe('Xrint "one"')
  })

  it('undoes a run of them one at a time, back to front', () => {
    const e = open()
    e.xCu = 11
    for (const c of ' : End') typeChar(e, c)
    expect(e.buf.text(0)).toBe('Print "one" : End')
    for (let i = 0; i < 6; i++) expect(undo(e)).toBe(0)
    expect(e.buf.text(0)).toBe('Print "one"')
    expect(undo(e)).toBe(4) // No more Undo.
  })

  it('puts a deleted character back in insert mode whatever mode is set', () => {
    // `moveq #1,d6` in Un_Delete, so undoing a Delete never overwrites
    const e = open()
    e.insert = false
    e.xCu = 5
    edCall(e, ED.DELETE)
    expect(e.buf.text(0)).toBe('Print"one"')
    undo(e)
    expect(e.buf.text(0)).toBe('Print "one"')
    redo(e)
    expect(e.buf.text(0)).toBe('Print"one"')
  })
})

describe('a run of characters', () => {
  it('comes back where it was cleared from', () => {
    const e = open()
    e.xCu = 5
    edCall(e, ED.DELETE_TO_END)
    expect(e.buf.text(0)).toBe('Print')
    undo(e)
    expect(e.buf.text(0)).toBe('Print "one"')
    redo(e)
    expect(e.buf.text(0)).toBe('Print')
  })

  it('comes back after a whole line was cleared', () => {
    const e = open()
    edCall(e, ED.CLEAR_LINE)
    expect(e.buf.text(0)).toBe('')
    undo(e)
    expect(e.buf.text(0)).toBe('Print "one"')
  })

  it('comes back after a word was deleted', () => {
    const e = open()
    e.buf.setText(0, 'one two three')
    e.xCu = 4
    edCall(e, ED.DELETE_WORD)
    expect(e.buf.text(0)).toBe('one three')
    undo(e)
    expect(e.buf.text(0)).toBe('one two three')
  })
})

describe('a line', () => {
  it('comes back into the program after Delete Line', () => {
    const e = open()
    edCall(e, ED.CUR_DOWN)
    edCall(e, ED.DELETE_LINE)
    expect(listing(e)).toEqual(['Print "one"', 'Print "three"'])
    expect(undo(e)).toBe(0)
    // Un_DLine inserts an empty line and puts the characters back into it,
    // so the text is in the window and reaches the program on the way out
    expect(e.buf.text(1)).toBe('Print "two"')
    e.tokCur()
    expect(listing(e)).toEqual(PROG.split('\n'))
  })

  it('goes back out again after Insert Line', () => {
    const e = open()
    edCall(e, ED.CUR_DOWN)
    edCall(e, ED.INSERT_LINE)
    expect(e.prog.lineCount).toBe(4)
    expect(listing(e)[1]).toBe('')
    expect(undo(e)).toBe(0)
    expect(e.prog.lineCount).toBe(3)
    expect(listing(e)).toEqual(PROG.split('\n'))
    expect(redo(e)).toBe(0)
    expect(e.prog.lineCount).toBe(4)
  })
})

describe('a tokenise', () => {
  it('goes back to what was typed, not to what AMOS called it', () => {
    // the record holds both spellings: `print   "x"` as typed and `Print "x"`
    // as Detok wrote it back
    const e = open()
    e.buf.setText(0, 'print   "x"')
    e.edited = 1
    e.tokCur()
    expect(e.buf.text(0)).toBe('Print "x"')
    expect(listing(e)[0]).toBe('Print "x"')
    expect(undo(e)).toBe(0)
    expect(e.buf.text(0)).toBe('print   "x"')
  })

  it('takes back the line the tokenise added', () => {
    // Un_Token: `move.w 4(a2),d0 / sub.w d0,Prg_NLigne(a6)`
    const e = open()
    e.yCu = 3 // the line past the end
    e.buf.setText(3, 'Print "four"')
    e.edited = 1
    e.tokCur()
    expect(e.prog.lineCount).toBe(4)
    undo(e)
    expect(e.prog.lineCount).toBe(3)
    redo(e)
    expect(e.prog.lineCount).toBe(4)
    expect(listing(e)[3]).toBe('Print "four"')
  })
})

describe('a split and a join', () => {
  it('un-splits a line back into one', () => {
    const e = open()
    e.xCu = 5
    edCall(e, ED.RETURN)
    expect(e.prog.lineCount).toBe(4)
    expect([e.line, e.xCu]).toEqual([1, 0])
    expect(undo(e)).toBe(0)
    expect(e.prog.lineCount).toBe(3)
    expect(e.buf.text(0)).toBe('Print "one"')
    expect([e.line, e.xCu]).toEqual([0, 5])
    e.tokCur()
    expect(listing(e)).toEqual(PROG.split('\n'))
  })

  it('un-joins a line back into two', () => {
    const e = open()
    edCall(e, ED.CUR_DOWN)
    edCall(e, ED.BACKSPACE)
    expect(e.buf.text(0)).toBe('Print "one"Print "two"')
    expect(e.prog.lineCount).toBe(2)
    expect(undo(e)).toBe(0)
    expect(e.buf.text(0)).toBe('Print "one"')
    expect(e.buf.text(1)).toBe('Print "two"')
    expect(e.prog.lineCount).toBe(3)
  })

  it('shares one routine each way: Re_Join is Un_Split and Re_Split is Un_Join', () => {
    // the two labels sit on the same `bsr` sequence (:2158, :2170), so a
    // split undone and a join redone are the same three instructions
    const e = open()
    e.xCu = 5
    edCall(e, ED.RETURN)
    undo(e)
    expect(e.prog.lineCount).toBe(3)
    expect(redo(e)).toBe(0)
    expect(e.prog.lineCount).toBe(4)
    expect(e.buf.text(1)).toBe(' "one"')
  })
})

describe('the ring', () => {
  it('says so at either end, and keeps the typo it says it with', () => {
    // "No mode Redo." is what +Editor_Config.s holds. The author's mistake
    // stays in, per the quotation rule
    const e = open()
    expect(undo(e)).toBe(4)
    expect(ED_MESSAGES[3]).toBe('No more Undo.')
    expect(redo(e)).toBe(5)
    expect(ED_MESSAGES[4]).toBe('No mode Redo.')
  })

  it('does not record the replay as more work to undo', () => {
    // `addq.b #1,Ed_FUndo(a5)` brackets the jsr, which is what stops
    // Un_Join's own Return from recording a split and going round in circles
    const e = open()
    e.xCu = 5
    typeChar(e, 'X')
    const before = e.undo.position
    undo(e)
    redo(e)
    undo(e)
    expect(e.undo.position).toBe(before - 1)
    expect(e.buf.text(0)).toBe('Print "one"')
  })

  it('walks a whole session back to where it started', () => {
    const e = open()
    e.xCu = 11
    for (const c of ' : Cls') typeChar(e, c)
    e.tokCur()
    edCall(e, ED.CUR_DOWN)
    edCall(e, ED.DELETE_LINE)
    edCall(e, ED.INSERT_LINE)
    // `Cls ` keeps its trailing space: its spec starts I, and Detok puts one
    // after an instruction spelled that way
    expect(listing(e)).toEqual(['Print "one" : Cls ', '', 'Print "three"'])
    let n = 0
    while (undo(e) === 0) n++
    e.tokCur()
    expect(n).toBeGreaterThan(6)
    expect(listing(e)).toEqual(PROG.split('\n'))
  })
})

describe('a keystroke that nobody claimed', () => {
  it('is typed, because that is the only other thing it can be', () => {
    // `.Char` at :1622 -- there is no list of printable keys, only the key
    // map and what falls through it
    const e = open()
    e.xCu = 11
    expect(edKey(e, { ch: '!', scan: 0x38 })).toBe(0)
    expect(e.buf.text(0)).toBe('Print "one"!')
    expect(e.xCu).toBe(12)
  })

  it('runs the command when the map does claim it', () => {
    const e = open()
    expect(edKey(e, { scan: 0x4d })).toBe(0) // cursor down
    expect(e.line).toBe(1)
    expect(edKey(e, { ch: 'u', shift: 0x08 })).toBe(4) // Ctrl-U, No more Undo.
  })

  it('drops a control character without moving the cursor', () => {
    // `cmp.b #32,d7 / bcs .EdL15` goes straight to the redraw, past Ed_CDroite
    const e = open()
    e.xCu = 4
    expect(edKey(e, { ch: '\x07', scan: 0x22 })).toBe(0)
    expect(e.buf.text(0)).toBe('Print "one"')
    expect(e.xCu).toBe(4)
  })
})
