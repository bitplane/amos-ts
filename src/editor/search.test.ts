import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { detokLineBytes, tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, edCall } from './commands'
import {
  SM,
  schBack,
  schBuffer,
  schFront,
  type Confirm,
  type DialogueAnswer,
  type EditorDialogues,
  type SearchDialogue,
} from './search'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)
const PROG = 'Print "one"\nPrint "two"\nPrint "one"'

function open(text = PROG, rows = 8): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text)), new EditBuffer(rows), new UndoBuffer(50), table)
  e.fill()
  return e
}

/** the program as the editor would list it */
const listing = (e: Edit): string[] =>
  Array.from({ length: e.prog.lineCount }, (_, i) => detokLineBytes(e.prog.bytes, e.prog.findLine(i).at, table))

/** a program whose second line is a folded procedure */
function folded(): Edit {
  const e = open('Print 1\nProcedure P\nPrint 2\nEnd Proc\nPrint 3')
  const at = e.prog.findLine(1).at
  const flags = e.prog.bytes[at + 10]!
  e.prog.bytes[at + 10] = flags | 0x80
  e.prog.countLines()
  e.fill()
  return e
}

/** a requester that answers with whatever this test hands it */
const requester = (
  answer: (d: SearchDialogue) => DialogueAnswer,
  confirm: (c: Confirm) => number = () => 1,
  select: (which: number, name: string) => string | null = (_w, name) => name,
  pressKey: (which: number) => number = () => 0,
): EditorDialogues => ({ ask: answer, confirm, select, pressKey })

describe('SchBuffer', () => {
  it('never finds an empty string, because the terminator is the first letter', () => {
    // `move.b (a1)+,d0` reads the zero and `.RSe1` then hunts for a zero byte
    expect(schBuffer('abc', '', 0)).toBe(-1)
  })

  it('folds case only when bit 0 says to', () => {
    expect(schBuffer('Hello', 'hello', 0)).toBe(-1)
    expect(schBuffer('Hello', 'hello', SM.CASE)).toBe(0)
    expect(schBuffer('HELLO', 'hello', SM.CASE)).toBe(0)
  })

  it('folds only a to z, so it is ASCII and not a locale', () => {
    // `cmp.b #"a" / bcs` and `cmp.b #"z" / bhi`, sub $20 in between
    expect(schBuffer('\xe9', '\xc9', SM.CASE)).toBe(-1)
  })

  it('restarts one past the first letter rather than past the whole attempt', () => {
    // `move.l d2,a0`: d2 was saved before the second letter was read, so a
    // failed match that started on an overlap is retried from inside itself
    expect(schBuffer('aaab', 'aab', 0)).toBe(1)
  })

  it('stops at the end of the line instead of reading into the next one', () => {
    // `.RSe2` reads the terminator and compares it with a needle byte, which
    // is the one comparison that cannot succeed
    expect(schBuffer('ab', 'abc', 0)).toBe(-1)
  })
})

describe('a forward search', () => {
  it('skips the column it starts on, which is what makes Search Next move', () => {
    // `addq.w #1,d6` is the first instruction of Ed_SchFront
    const e = open()
    e.schBuf = 'Print'
    expect(schFront(e, 0, 0, 32000, 32000, 0)).toEqual({ y: 1, x: 0 })
    expect(schFront(e, 0, -1, 32000, 32000, 0)).toEqual({ y: 0, x: 0 })
  })

  it('starts the next line at column 0 without the skip', () => {
    // `.Srch2` sets d6 to zero and re-enters at `.SrchL`, past the addq
    const e = open()
    e.schBuf = 'Print'
    expect(schFront(e, 0, 40, 32000, 32000, 0)).toEqual({ y: 1, x: 0 })
  })

  it('gives up at the line and column it was told to stop at', () => {
    const e = open()
    e.schBuf = 'one'
    expect(schFront(e, 0, 0, 32000, 32000, 0)).toEqual({ y: 0, x: 7 })
    expect(schFront(e, 0, 7, 2, 32000, 0)).toEqual({ y: 2, x: 7 })
    // `.Srch3` refuses a match it has already found rather than looking on
    expect(schFront(e, 0, 7, 2, 6, 0)).toBe(null)
    expect(schFront(e, 0, 7, 1, 32000, 0)).toBe(null)
  })

  it('cannot see inside a closed procedure', () => {
    // `Tk_FindN` steps over the whole fold, so Detok only ever gets the
    // `Procedure` header. There is no editable check anywhere in Ed_SchFront
    const e = folded()
    expect(listing(e)).toEqual(['Print 1', 'Procedure P', 'Print 3'])
    e.schBuf = '2'
    expect(edCall(e, ED.SEARCH_NEXT)).toBe(205) // Not found.
    e.schBuf = 'Procedure'
    expect(edCall(e, ED.SEARCH_NEXT)).toBe(0)
    expect([e.line, e.xCu]).toEqual([1, 0])
  })

  it('stops on Ctrl-C, and eats the keypress on its way past', () => {
    // `bclr #BitControl-8,T_Actualise(a5)` clears whether it was set or not
    const e = open()
    e.schBuf = 'one'
    e.abort = true
    expect(schFront(e, 0, 20, 32000, 32000, 0)).toBe(null)
    expect(e.abort).toBe(false)
    expect(schFront(e, 0, 20, 32000, 32000, 0)).toEqual({ y: 2, x: 7 })
  })

  it('cannot be interrupted while it stays on one line', () => {
    // the test is at `.Srch2`, on the way to the next line, and nowhere else
    const e = open()
    e.schBuf = 'one'
    e.abort = true
    expect(schFront(e, 0, 0, 32000, 32000, 0)).toEqual({ y: 0, x: 7 })
    expect(e.abort).toBe(true)
  })
})

describe('a backward search', () => {
  it('is a forward search from line 0, kept and repeated', () => {
    const e = open()
    e.schBuf = 'one'
    e.yCu = 2
    e.xCu = 11
    expect(schBack(e, e.line, e.xCu, 0)).toEqual({ y: 2, x: 7 })
    expect(schBack(e, 1, 0, 0)).toEqual({ y: 0, x: 7 })
  })

  it('takes the limit to column 255 of the line above when the cursor is at 0', () => {
    // `move.w #255,d3 / subq.w #1,d4` -- a column past any line the editor holds
    const e = open()
    e.schBuf = 'one'
    expect(schBack(e, 0, 0, 0)).toBe(null)
    expect(schBack(e, 2, 0, 0)).toEqual({ y: 0, x: 7 })
  })

  it('DEFECT: steps two columns a round and loses an overlapping match', () => {
    // `.Loop` does `addq.w #1,d6` and Ed_SchFront does it again, so the next
    // pass begins two past the match. `aaaa` holds `aa` at 7, 8 and 9; from a
    // cursor at column 9 the last match before it is at 8, and this says 7
    const e = open('Print "aaaa"')
    e.schBuf = 'aa'
    expect(schBack(e, 0, 9, 0)).toEqual({ y: 0, x: 7 })
    expect(schBuffer('aaaa', 'aa', 0)).toBe(0) // 7, 8 and 9 all match
    expect(schBack(e, 0, 10, 0)).toEqual({ y: 0, x: 9 })
  })
})

describe('Search', () => {
  it('moves the cursor to the match and pushes where it was onto the marks', () => {
    const e = open()
    e.schBuf = 'two'
    expect(edCall(e, ED.SEARCH_NEXT)).toBe(0)
    expect([e.line, e.xCu]).toEqual([1, 7])
    expect(e.prog.getMark(0)).toEqual({ line: 0, column: 0 })
  })

  it('says Not found and leaves the cursor alone', () => {
    const e = open()
    e.schBuf = 'nothing'
    expect(edCall(e, ED.SEARCH_NEXT)).toBe(205)
    expect([e.line, e.xCu]).toEqual([0, 0])
  })

  it('walks backwards with Search Previous whatever the mode says', () => {
    // `and.w #%0001,d5 / bset #1,d5` -- the gadget cannot turn this one round
    const e = open()
    e.schBuf = 'one'
    e.schMode = 0
    e.yCu = 2
    e.xCu = 11
    expect(edCall(e, ED.SEARCH_PREV)).toBe(0)
    expect([e.line, e.xCu]).toEqual([2, 7])
    expect(edCall(e, ED.SEARCH_PREV)).toBe(0)
    expect([e.line, e.xCu]).toEqual([0, 7])
  })

  it('falls into the requester when there is nothing to look for', () => {
    // `tst.b Ed_SchBuf(a5) / beq.s Ed_Search`
    const e = open()
    let asked = 0
    e.dialogues = requester((d) => {
      asked++
      return { ...d, search: 'two', ok: true }
    })
    expect(edCall(e, ED.SEARCH_NEXT)).toBe(0)
    expect(asked).toBe(1)
    expect([e.line, e.xCu]).toEqual([1, 7])
  })

  it('says Not done when the requester is cancelled', () => {
    const e = open()
    e.dialogues = requester((d) => ({ ...d, ok: false }))
    expect(edCall(e, ED.SEARCH)).toBe(206)
  })

  it('keeps what was typed into a requester that was then cancelled', () => {
    // the copy back sits between `move.w d0,-(sp)` and `move.w (sp)+,d0`, so
    // the button is not looked at until after the buffers have been written
    const e = open()
    e.dialogues = requester((d) => ({ ...d, search: 'two', mode: SM.CASE, ok: false }))
    expect(edCall(e, ED.SEARCH)).toBe(206)
    expect(e.schBuf).toBe('two')
    expect(e.schMode).toBe(SM.CASE)
  })

  it('drops the two turbo gadgets, so All Occurences in the Search box does nothing', () => {
    // `and.w #%0011,d5` keeps case and direction and throws the rest away
    const e = open()
    e.schBuf = 'one'
    e.schMode = SM.ALL | SM.BLOCK
    expect(edCall(e, ED.SEARCH)).toBe(0)
    expect([e.line, e.xCu]).toEqual([0, 7])
    expect(listing(e)).toEqual(PROG.split('\n'))
  })
})

describe('Replace', () => {
  it('splices the line and leaves the cursor past what it put in', () => {
    const e = open()
    e.schBuf = 'one'
    e.repBuf = 'ONCE'
    expect(edCall(e, ED.REPLACE_NEXT)).toBe(0)
    expect(listing(e)[0]).toBe('Print "ONCE"')
    expect([e.line, e.xCu]).toEqual([0, 11])
  })

  it('walks backwards with Replace Previous', () => {
    const e = open()
    e.schBuf = 'one'
    e.repBuf = 'X'
    e.yCu = 2
    e.xCu = 11
    expect(edCall(e, ED.REPLACE_PREV)).toBe(0)
    expect(listing(e)[2]).toBe('Print "X"')
  })

  it('goes back to the requester when either buffer is empty', () => {
    // `tst.b Ed_SchBuf(a5) / beq Ed_Replace` in Ed_RSR, twice over
    const e = open()
    const seen: number[] = []
    e.dialogues = requester((d) => {
      seen.push(d.which)
      return { ...d, search: 'one', replace: 'X', ok: true }
    })
    expect(edCall(e, ED.REPLACE_NEXT)).toBe(0)
    expect(seen).toEqual([6])
    expect(listing(e)[0]).toBe('Print "X"')
  })

  it('says nothing at all when its requester is cancelled', () => {
    // `cmp.w #1,(sp)+ / bne Ed_Loop` -- no alert, where Search says Not done
    const e = open()
    e.schBuf = 'one'
    e.repBuf = 'X'
    e.dialogues = requester((d) => ({ ...d, ok: false }))
    expect(edCall(e, ED.REPLACE)).toBe(0)
    expect(listing(e)).toEqual(PROG.split('\n'))
  })

  it('stops rather than spinning when no requester is installed', () => {
    // DEVIATION: the machine loops back to a dialogue that is not here
    const e = open()
    expect(edCall(e, ED.REPLACE_NEXT)).toBe(206)
  })

  it('cannot be undone, because the record is written after the splice', () => {
    // Ed_SR writes into the slot and calls Ed_TokCur, and Ed_TokCur's "old"
    // half is the slot as it stands. The line before the replacement was
    // never anywhere an undo record could reach
    const e = open()
    e.schBuf = 'one'
    e.repBuf = 'X'
    edCall(e, ED.REPLACE_NEXT)
    expect(listing(e)[0]).toBe('Print "X"')
    expect(edCall(e, ED.UNDO)).toBe(0)
    e.tokCur()
    expect(listing(e)[0]).toBe('Print "X"')
  })

  it('refuses a replacement that would leave the line too long', () => {
    // `cmp.w #252,d1` on a length that counts the terminator, so 250 stands
    // and 251 does not
    const room = 250 - 'Print ""'.length
    const e = open('Print "' + 'x'.repeat(room - 1) + 'Q"')
    e.schBuf = 'Q'
    e.repBuf = 'yy'
    expect(edCall(e, ED.REPLACE_NEXT)).toBe(199)
    // the cursor moved to the match before RepBuffer was called, so a refused
    // replacement still leaves it sitting on what it refused
    expect(e.xCu).toBe(7 + room - 1)
    e.xCu = 0
    e.repBuf = 'y'
    expect(edCall(e, ED.REPLACE_NEXT)).toBe(0)
    expect(e.buf.text(0).length).toBe(250)
  })
})

describe('Replace All', () => {
  it('changes every match and reports the count', () => {
    const e = open()
    e.schBuf = 'Print'
    e.repBuf = 'Cls'
    e.schMode = SM.ALL
    let told = 0
    e.dialogues = requester(
      (d) => ({ ...d, ok: true }),
      (c) => {
        if (c.which === 10) told = c.count ?? 0
        return 1
      },
    )
    expect(edCall(e, ED.REPLACE)).toBe(0)
    expect(told).toBe(2)
  })

  it('DEFECT: misses a match at column 0 of the first line it looks at', () => {
    // `.Loop`'s `subq.w #1,d6 / bpl .Pos / moveq #0,d6` takes 0 back to 0 and
    // Ed_SchFront's addq takes it to 1. Every later line comes in through
    // `.Srch2` at column 0 with no addq, so only the first line is short
    const e = open()
    e.schBuf = 'Print'
    e.repBuf = 'Cls'
    e.schMode = SM.ALL
    expect(edCall(e, ED.REPLACE)).toBe(0)
    expect(listing(e)).toEqual(['Print "one"', 'Cls "two"', 'Cls "one"'])
  })

  it('keeps inside the block, end column and all', () => {
    const e = open()
    e.schBuf = 'one'
    e.repBuf = 'X'
    e.schMode = SM.BLOCK
    e.yBloc = 0
    e.xBloc = 5
    e.yCu = 2
    e.xCu = 9
    expect(edCall(e, ED.REPLACE)).toBe(0)
    // line 2's match starts at column 7 and the limit is column 8, so it goes
    expect(listing(e)).toEqual(['Print "X"', 'Print "two"', 'Print "X"'])
  })

  it('says Not found when the pass changed nothing', () => {
    const e = open()
    e.schBuf = 'nothing'
    e.repBuf = 'X'
    e.schMode = SM.ALL
    expect(edCall(e, ED.REPLACE)).toBe(205)
  })

  it('is stopped by a Not on the confirmation', () => {
    // EdD_WText, and `cmp.w #1,d0 / bne Ed_NotDone`
    const e = open()
    e.schBuf = 'Print'
    e.repBuf = 'Cls'
    e.schMode = SM.ALL
    e.dialogues = requester(
      (d) => ({ ...d, ok: true }),
      (c) => (c.which === 9 ? 0 : 1),
    )
    expect(edCall(e, ED.REPLACE)).toBe(206)
    expect(listing(e)).toEqual(PROG.split('\n'))
  })

  it('DEFECT: calls a closed procedure Out of buffer space', () => {
    // `bsr Ed_Stocke / bne .Outb` tests neither sign nor value, and StoClo
    // answers -1. The fold's header is the one line a search can match on and
    // a store cannot write to
    const e = folded()
    e.schBuf = 'Procedure'
    e.repBuf = 'Rem'
    e.schMode = SM.ALL
    expect(edCall(e, ED.REPLACE)).toBe(202)
  })

  it('leaves the undo ring alone, because Ed_TokCur is never reached', () => {
    const e = open()
    e.schBuf = 'one'
    e.repBuf = 'X'
    e.schMode = SM.ALL
    const before = e.undo.position
    expect(edCall(e, ED.REPLACE)).toBe(0)
    expect(e.undo.position).toBe(before)
    expect(edCall(e, ED.UNDO)).toBe(4) // No more Undo.
  })
})
