import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { detokLineBytes, tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UN, UndoBuffer } from './undo'
import { Edit, EditorAlert } from './edit'

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

/** type a run of characters, moving the cursor the way `Ed_CDroite` would */
function type(e: Edit, s: string, insert = true): void {
  for (const c of s) {
    e.pKey(c, insert)
    e.xCu++
  }
}

describe('the window onto the program', () => {
  it('is filled from Edt_YPos and the cursor line is the sum', () => {
    const e = open()
    expect(Array.from({ length: 6 }, (_, r) => e.buf.text(r))).toEqual([
      'Print "one"', 'Procedure DEMO', '  Print "in"', 'End Proc', 'Print "two"', '',
    ])
    e.yPos = 2
    e.yCu = 1
    expect(e.line).toBe(3)
    e.fill()
    expect(e.buf.text(1)).toBe('End Proc')
  })
})

describe('typing', () => {
  it('goes in and comes back out through the program', () => {
    const e = open()
    e.xCu = e.buf.length(0)
    type(e, ' : Print 1+1')
    expect(e.edited).toBeGreaterThan(0)
    e.tokCur()
    expect(e.edited).toBe(0)
    expect(listing(e)[0]).toBe('Print "one" : Print 1+1')
  })

  it('a cursor past the end of the text is pulled back to it', () => {
    // `cmp.w d0,d1 / bls .EdL10a / move.w d0,d1`
    const e = open()
    e.xCu = 40
    e.pKey('!')
    expect(e.xCu).toBe(11)
    expect(e.buf.text(0)).toBe('Print "one"!')
  })

  it('overwrite covers a character and insert opens a gap', () => {
    const e = open()
    e.xCu = 0
    e.pKey('Z', false)
    expect(e.buf.text(0)).toBe('Zrint "one"')
    e.xCu = 0
    e.pKey('Y', true)
    expect(e.buf.text(0)).toBe('YZrint "one"')
  })

  it('will not touch a closed procedure', () => {
    const src = tested(PROG)
    src[14 + 10] = src[14 + 10]! | 0x80
    const e = new Edit(ProgramBuffer.load(src), new EditBuffer(6), new UndoBuffer(20), table)
    e.fill()
    e.yCu = 1
    expect(() => e.pKey('x')).toThrow(EditorAlert)
    expect(() => e.pKey('x')).toThrow(/can't be modified/)
  })

  it('below space does nothing at all', () => {
    const e = open()
    e.pKey('\t')
    expect(e.edited).toBe(0)
    expect(e.buf.text(0)).toBe('Print "one"')
  })
})

describe('the character limit', () => {
  /** a line already at `R_InsChar`'s 250, put there rather than typed */
  const full = (): Edit => {
    const e = open()
    e.buf.setText(0, 'x'.repeat(250))
    return e
  }

  it('inserting in the middle of a full line is Line too long', () => {
    // `cmp.w #250,d0 / bcc Ed_LToLong` -- and `R_InsChar` at the same 250
    // quietly inserts what fits instead
    const e = full()
    e.xCu = 10
    expect(() => e.pKey('z')).toThrow(/Line too long/)
  })

  it('DEFECT: the refused keystroke still leaves an undo record', () => {
    // `Un_Debut` runs at `.EdL10a`, before the `cmp.w #250` in `.EdL11`. So
    // undoing a keystroke that never happened deletes a real character.
    const e = full()
    e.xCu = 10
    expect(() => e.pKey('z')).toThrow()
    expect(e.undo.undo()).toMatchObject({ code: UN.CHAR, x: 10, b5: 'z'.charCodeAt(0) })
  })

  it('appending to a full line raises nothing, and inserts nothing either', () => {
    // at the end both modes go down `.EdL13`, so the 250 check is never
    // reached -- and then `R_InsChar` declines to grow the line, quietly
    const e = full()
    e.xCu = 250
    e.pKey('z')
    expect(e.buf.length(0)).toBe(250)
    expect(e.buf.text(0).endsWith('x')).toBe(true)
  })
})

describe('deleting', () => {
  it('takes the character under the cursor', () => {
    const e = open()
    e.xCu = 5
    e.deleteChar()
    expect(e.buf.text(0)).toBe('Print"one"')
  })

  it('does nothing when there is no character there', () => {
    // `sub.w Edt_XCu(a4),d0 / subq.w #1,d0 / bmi CFin`
    const e = open()
    e.xCu = 11
    e.deleteChar()
    expect(e.edited).toBe(0)
    expect(e.buf.text(0)).toBe('Print "one"')
  })
})

describe('storing the line back', () => {
  it('does nothing at all when the line was not touched', () => {
    const e = open()
    const before = e.prog.text().slice()
    e.tokCur()
    expect([...e.prog.text()]).toEqual([...before])
  })

  it('replaces what the user typed with what AMOS calls it', () => {
    // the redisplay `Detok` is not cosmetic: it is the spelling that gets
    // stored and the one the next edit starts from
    const e = open()
    e.buf.setText(0, 'print   "one"')
    e.edited = 1
    e.tokCur()
    expect(e.buf.text(0)).toBe('Print "one"')
    expect(listing(e)[0]).toBe('Print "one"')
  })

  it('a line past the end is added only when there is something on it', () => {
    // `cmp.w Prg_NLigne(a6),d1 / bne .Rien / tst.w d2 / beq .Rien`
    const e = open()
    e.yCu = 5
    e.edited = 1
    e.tokCur()
    expect(e.prog.lineCount).toBe(5)
    type(e, 'Print "new"')
    e.tokCur()
    expect(e.prog.lineCount).toBe(6)
    expect(listing(e)[5]).toBe('Print "new"')
  })

  it('records both spellings and the line it added', () => {
    const e = open()
    e.yCu = 5
    type(e, 'print 1')
    e.tokCur()
    const r = e.undo.undo()!
    expect(r.code).toBe(UN.TOKEN)
    expect(r.y).toBe(5)
    const b = r.block!
    expect((b[0]! << 8) | b[1]!).toBe(1) // one line added
    const oldLen = b[2]!
    expect(String.fromCharCode(...b.subarray(3, 3 + oldLen))).toBe('print 1')
    const newLen = b[3 + oldLen]!
    expect(String.fromCharCode(...b.subarray(4 + oldLen, 4 + oldLen + newLen))).toBe('Print 1')
  })

  it('a keystroke records the character, and what it covered', () => {
    const e = open()
    e.xCu = 0
    e.pKey('Z', false)
    expect(e.undo.undo()).toMatchObject({ code: UN.CHAR, b4: 'P'.charCodeAt(0), b5: 'Z'.charCodeAt(0) })
    e.xCu = 0
    e.pKey('Y', true)
    // `move.b #-1,4(a2)` is the insert marker `Un_Char` branches on
    expect(e.undo.undo()).toMatchObject({ code: UN.CHAR, b4: 0xff, b5: 'Y'.charCodeAt(0) })
  })
})
