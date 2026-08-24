import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { detokLineBytes, tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { BF, Block } from './block'
import { ED, edCall } from './commands'

const table = new TokenTable(CORE_TOKENS)
const PROG = 'Print "one"\nPrint "two"\nPrint "three"\nPrint "four"'
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)

function open(text = PROG, rows = 10): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text)), new EditBuffer(rows), new UndoBuffer(50), table)
  e.fill()
  return e
}

const listing = (e: Edit): string[] =>
  Array.from({ length: e.prog.lineCount }, (_, i) => detokLineBytes(e.prog.bytes, e.prog.findLine(i).at, table))

const str = (b: Uint8Array): string => String.fromCharCode(...b)

/** drop the anchor at one point and put the cursor at another */
function select(e: Edit, y0: number, x0: number, y1: number, x1: number): void {
  e.yBloc = -1 // Block On is a toggle, so anything left down would go up
  e.yPos = 0
  e.yCu = y0
  e.xCu = x0
  edCall(e, ED.BLOCK_ON)
  e.yCu = y1
  e.xCu = x1
}

describe('the anchor', () => {
  it('goes down on the first press and comes up on the second', () => {
    const e = open()
    expect(e.yBloc).toBe(-1)
    e.yCu = 1
    e.xCu = 3
    edCall(e, ED.BLOCK_ON)
    expect([e.yBloc, e.xBloc]).toEqual([1, 3])
    edCall(e, ED.BLOCK_ON)
    expect(e.yBloc).toBe(-1)
  })

  it('takes the whole program when All is asked for', () => {
    // Ed_BlocAll (:5854) anchors at the line PAST the last and puts the
    // cursor at 0,0, so the block runs backwards and .Sw sorts it out
    const e = open()
    edCall(e, ED.BLOCK_ALL)
    expect([e.yBloc, e.xBloc]).toEqual([4, 0])
    expect([e.line, e.xCu]).toEqual([0, 0])
    expect(edCall(e, ED.BLOCK_STORE)).toBe(7) // "Block stored in memory."
    // line 0 is the first RECORD, as text, and only 1 to 3 are the middle:
    // a block always holds its two end lines as characters
    const b = e.block.read()!
    expect(str(b.first)).toBe('Print "one"')
    expect(b.lines).toBe(3)
    expect(b.last.length).toBe(0)
  })
})

describe('what a copy gathers', () => {
  it('splits into a tail, whole lines of tokens, and a head', () => {
    const e = open()
    select(e, 0, 6, 2, 5)
    expect(edCall(e, ED.BLOCK_STORE)).toBe(7)
    const b = e.block.read()!
    expect([b.y0, b.x0, b.y1, b.x1]).toEqual([0, 6, 2, 5])
    expect(str(b.first)).toBe('"one"')
    expect(b.lines).toBe(1) // line 1 only
    expect(str(b.last)).toBe('Print')
    // the middle is program tokens, not text: it is what Ed_StoBlock copies
    // straight into the gap without tokenising anything
    expect(b.middle.length).toBe(e.prog.sizeOfLine(e.prog.findLine(1).at))
  })

  it('keeps one line in one record and says so with a flag', () => {
    const e = open()
    select(e, 1, 6, 1, 11)
    edCall(e, ED.BLOCK_STORE)
    const b = e.block.read()!
    expect(b.flags & BF.SINGLE).toBe(BF.SINGLE)
    expect(str(b.first)).toBe('"two"')
    expect(b.lines).toBe(0)
    expect(b.last.length).toBe(0)
  })

  it('is no block at all when the two corners are the same', () => {
    // `.Seul`: `sub.w d6,d0 / beq .NoBloc`
    const e = open()
    select(e, 1, 4, 1, 4)
    expect(edCall(e, ED.BLOCK_STORE)).toBe(6) // "What block?"
    expect(e.block.empty).toBe(true)
  })

  it('clamps a column past the end of its line instead of refusing', () => {
    const e = open()
    select(e, 0, 200, 1, 200)
    edCall(e, ED.BLOCK_STORE)
    const b = e.block.read()!
    expect(b.x0).toBe('Print "one"'.length)
    expect(b.x1).toBe('Print "two"'.length)
    expect(str(b.first)).toBe('')
    expect(str(b.last)).toBe('Print "two"')
  })

  it('takes the corners either way round', () => {
    const e = open()
    select(e, 2, 5, 0, 6)
    edCall(e, ED.BLOCK_STORE)
    const b = e.block.read()!
    expect([b.y0, b.x0, b.y1, b.x1]).toEqual([0, 6, 2, 5])
  })

  it('reads the line under the cursor out of the slot, not the program', () => {
    // the characters typed but not yet tokenised are only in Edt_BufE
    const e = open()
    e.yCu = 1
    e.buf.setText(1, 'Print "TYPED"')
    e.edited = 1
    select(e, 1, 6, 1, 13)
    edCall(e, ED.BLOCK_STORE)
    expect(str(e.block.read()!.first)).toBe('"TYPED"')
  })
})

describe('cut and paste', () => {
  it('takes a whole line out and puts it back somewhere else', () => {
    const e = open()
    select(e, 1, 0, 2, 0)
    expect(edCall(e, ED.BLOCK_CUT)).toBe(7)
    e.tokCur()
    expect(listing(e)).toEqual(['Print "one"', 'Print "three"', 'Print "four"'])
    e.yCu = 3
    e.xCu = 0
    expect(edCall(e, ED.BLOCK_PASTE)).toBe(0)
    e.tokCur()
    expect(listing(e)).toEqual(['Print "one"', 'Print "three"', 'Print "four"', 'Print "two"'])
  })

  it('puts a run of lines back in one move', () => {
    const e = open()
    select(e, 1, 0, 3, 0)
    edCall(e, ED.BLOCK_CUT)
    e.tokCur()
    expect(listing(e)).toEqual(['Print "one"', 'Print "four"'])
    // at line 1, because paste goes in AT the cursor and the block came from
    // in front of "four"
    e.yCu = 1
    e.xCu = 0
    edCall(e, ED.BLOCK_PASTE)
    e.tokCur()
    expect(listing(e)).toEqual(PROG.split('\n'))
  })

  it('cuts part of a line and joins what is left', () => {
    const e = open()
    select(e, 0, 5, 1, 5)
    edCall(e, ED.BLOCK_CUT)
    e.tokCur()
    expect(listing(e)).toEqual(['Print "two"', 'Print "three"', 'Print "four"'])
    expect(str(e.block.read()!.first)).toBe(' "one"')
    expect(str(e.block.read()!.last)).toBe('Print')
  })

  it('pastes part of a line back into the middle of another', () => {
    const e = open('Print "a"\nPrint "b"')
    select(e, 0, 6, 0, 9)
    edCall(e, ED.BLOCK_STORE)
    expect(str(e.block.read()!.first)).toBe('"a"')
    e.yCu = 1
    e.xCu = 9
    edCall(e, ED.BLOCK_PASTE)
    e.tokCur()
    expect(listing(e)[1]).toBe('Print "b""a"')
  })

  it('leaves the block in memory after a cut, so it can be pasted twice', () => {
    const e = open()
    select(e, 1, 0, 2, 0)
    edCall(e, ED.BLOCK_CUT)
    e.yCu = 2
    e.xCu = 0
    edCall(e, ED.BLOCK_PASTE)
    e.tokCur()
    e.yCu = 3
    e.xCu = 0
    edCall(e, ED.BLOCK_PASTE)
    e.tokCur()
    expect(listing(e).filter((l) => l === 'Print "two"').length).toBe(2)
  })

  it('takes the anchor down after a store or a cut', () => {
    // Ed_BlocHide, so the highlight goes as soon as the block is taken
    const e = open()
    select(e, 0, 0, 1, 0)
    edCall(e, ED.BLOCK_STORE)
    expect(e.yBloc).toBe(-1)
  })
})

describe('the clipboard', () => {
  it('says What block? when there is nothing to paste or forget', () => {
    const e = open()
    expect(edCall(e, ED.BLOCK_PASTE)).toBe(6)
    expect(edCall(e, ED.BLOCK_FORGET)).toBe(6)
    expect(edCall(e, ED.BLOCK_STORE)).toBe(6) // no anchor either
  })

  it('empties on Forget and says which', () => {
    const e = open()
    select(e, 0, 0, 1, 0)
    edCall(e, ED.BLOCK_STORE)
    expect(e.block.empty).toBe(false)
    expect(edCall(e, ED.BLOCK_FORGET)).toBe(8) // "Block deleted from memory."
    expect(e.block.empty).toBe(true)
  })

  it('can be shared by two windows, which is what the machine does', () => {
    // `Ed_Block` is one pointer for the whole editor, so this is the shape
    // the machine always has; see the note on `Edit.block`
    const shared = new Block()
    const a = open()
    const b = open('Print "other"')
    a.block = shared
    b.block = shared
    select(a, 0, 0, 1, 0)
    edCall(a, ED.BLOCK_STORE)
    b.yCu = 1
    edCall(b, ED.BLOCK_PASTE)
    b.tokCur()
    expect(listing(b)).toEqual(['Print "other"', 'Print "one"'])
  })
})

describe('undo after a block', () => {
  it('is thrown away, because the author never came back to it', () => {
    // `bsr Prg_UndoRaz` with "Illegal: remettre plus tard!" beside it in both
    // Ed_BlocCut and Ed_BlocPaste
    const e = open()
    e.xCu = 11
    e.pKey('X')
    e.xCu++
    expect(e.undo.undo()).not.toBeNull()
    e.undo.redo()
    select(e, 1, 0, 2, 0)
    edCall(e, ED.BLOCK_CUT)
    expect(edCall(e, ED.UNDO)).toBe(4) // No more Undo.
  })
})

describe('the marks after a cut', () => {
  it('are left pointing one block too far down', () => {
    // DEFECT: `.NoMi` writes the line into d1 twice where it means d0, and
    // the second write clobbers the first, so Ed_MarksChange is handed
    // whatever Ed_DelChunk left in d0 -- Tk_FindL's `move.w (a0),d0`, the
    // found line's length and indent bytes. That is a number in the
    // thousands, no mark is below it, and nothing moves
    const e = open('Print 1\nPrint 2\nPrint 3\nPrint 4\nPrint 5')
    e.prog.setMark(4, 4, 0)
    expect(e.prog.getMark(4)).toEqual({ line: 4, column: 0 })
    select(e, 1, 0, 3, 0)
    edCall(e, ED.BLOCK_CUT)
    e.tokCur()
    expect(listing(e)).toEqual(['Print 1', 'Print 4', 'Print 5'])
    // two lines went, so the mark should read 2. The join at the end of the
    // delete takes one off correctly, through Ed_DeLigne, and the chunk's own
    // shift is the one that is lost -- so it reads 3
    expect(e.prog.getMark(4)).toEqual({ line: 3, column: 0 })
  })

  it('do move when the block opens on a closed procedure', () => {
    // `.Proc1` twenty lines below writes `move.w d4,d0` and gets it right
    const e = open('Print 1\nProcedure P\nPrint 2\nEnd Proc\nPrint 3\nPrint 4')
    const proc = e.prog.findLine(1).at
    e.prog.bytes[proc + 10] = e.prog.bytes[proc + 10]! | 0x80 // close P
    e.prog.countLines()
    e.fill()
    expect(e.prog.lineCount).toBe(4) // the fold counts as one line
    e.prog.setMark(4, 3, 0)
    select(e, 1, 0, 2, 0)
    edCall(e, ED.BLOCK_CUT)
    expect(e.prog.getMark(4)).toEqual({ line: 2, column: 0 })
  })
})

describe('a closed procedure in a block', () => {
  it('is taken whole, and only from column 0', () => {
    // `.Proc1`: `tst.w d6 / bne Ed_NotEdit` -- half a fold is not a thing
    const e = open('Print 1\nProcedure P\nPrint 2\nEnd Proc\nPrint 3')
    const proc = e.prog.findLine(1).at
    e.prog.bytes[proc + 10] = e.prog.bytes[proc + 10]! | 0x80
    e.prog.countLines()
    e.fill()
    select(e, 1, 3, 2, 0)
    expect(edCall(e, ED.BLOCK_STORE)).toBe(183) // Line not editable
    select(e, 1, 0, 2, 0)
    expect(edCall(e, ED.BLOCK_STORE)).toBe(7)
    const b = e.block.read()!
    expect(b.flags & BF.PROC_FIRST).toBe(BF.PROC_FIRST)
    expect(b.first.length).toBe(0)
    expect(b.lines).toBe(1) // the fold IS the middle
  })
})

describe('the layout', () => {
  it('puts the flags between the numbers, where movem left room for them', () => {
    // `movem.w d4-d6,(a1)` then `move.l d7,(a1)+`, so the long carrying the
    // flags and the last column lands at offset 6
    const b = new Block()
    b.write({ y0: 1, y1: 2, x0: 3, x1: 4, flags: BF.SINGLE, first: Uint8Array.of(65), lines: 0, middle: new Uint8Array(0), last: new Uint8Array(0) })
    expect(Array.from(b.bytes!.slice(0, 13))).toEqual([0, 1, 0, 2, 0, 3, 0x40, 0, 0, 4, 0, 1, 65])
  })

  it('pads the first record to an even length before the middle', () => {
    // `Pair` (+Equ.s:2360), because the middle is copied a WORD at a time
    const b = new Block()
    const mid = Uint8Array.of(2, 0, 0, 0)
    b.write({ y0: 0, y1: 1, x0: 0, x1: 0, flags: 0, first: Uint8Array.of(65), lines: 1, middle: mid, last: Uint8Array.of(66) })
    const v = b.read()!
    expect(str(v.first)).toBe('A')
    expect(Array.from(v.middle)).toEqual([2, 0, 0, 0])
    expect(str(v.last)).toBe('B')
  })

  it('reads back what it wrote for a three-part block', () => {
    const e = open()
    select(e, 0, 6, 3, 5)
    edCall(e, ED.BLOCK_STORE)
    const v = e.block.read()!
    expect(str(v.first)).toBe('"one"')
    expect(v.lines).toBe(2)
    expect(str(v.last)).toBe('Print')
  })
})
