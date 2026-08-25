import { describe, expect, it } from 'vitest'
import { TokenTable, PROTECTED_PROC } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { detokLineBytes, tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { PROC_CLOSED, ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, edCall } from './commands'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)
const PROG = 'Print "one"\nProcedure DEMO\n  Print "in"\nEnd Proc\nPrint "two"'

/** a window on `text`, already tested, which is what Ed_VaTester leaves */
function open(text = PROG, rows = 10): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text)), new EditBuffer(rows), new UndoBuffer(50), table)
  e.fill()
  return e
}

/** the same, straight off the tokeniser: every procedure size is still zero */
function untested(text = PROG, rows = 10): Edit {
  const e = new Edit(
    ProgramBuffer.load(tokeniseSource(text, table).slice(0, -2)),
    new EditBuffer(rows),
    new UndoBuffer(50),
    table,
  )
  e.prog.modified = true
  e.fill()
  return e
}

const listing = (e: Edit): string[] =>
  Array.from({ length: e.prog.lineCount }, (_, i) => detokLineBytes(e.prog.bytes, e.prog.findLine(i).at, table))

const closed = (e: Edit, at: number): boolean => (e.prog.procFlags(at) & PROC_CLOSED) !== 0

describe('Open / Close', () => {
  it('folds the procedure the cursor is on, and unfolds it again', () => {
    const e = open()
    e.yCu = 1
    expect(edCall(e, ED.PROC_OPEN)).toBe(0)
    expect(listing(e)).toEqual(['Print "one"', 'Procedure DEMO', 'Print "two"'])
    expect(e.prog.lineCount).toBe(3)
    expect(edCall(e, ED.PROC_OPEN)).toBe(0)
    expect(listing(e)).toEqual(['Print "one"', 'Procedure DEMO', '  Print "in"', 'End Proc', 'Print "two"'])
  })

  it('works from inside the body, because Edt_DebProc is what it reads', () => {
    const e = open()
    e.yCu = 2
    edCall(e, ED.PROC_OPEN)
    expect(e.prog.lineCount).toBe(3)
    // the cursor ends up on the fold's own line, which is where the body went
    expect(e.line).toBe(1)
  })

  it('says Not a procedure outside one, and End Proc is still inside', () => {
    const e = open()
    e.yCu = 0
    expect(edCall(e, ED.PROC_OPEN)).toBe(203)
    e.yCu = 4
    expect(edCall(e, ED.PROC_OPEN)).toBe(203)
    // `Fnd8` clears Edt_DebProc on the way PAST an End Proc, and the walk
    // never tests the line it lands on, so a cursor sitting on End Proc still
    // reports the procedure it closes
    e.yCu = 3
    expect(edCall(e, ED.PROC_OPEN)).toBe(0)
    expect(e.prog.lineCount).toBe(3)
  })

  it('leaves a locked procedure alone, and says nothing about it', () => {
    const e = open()
    const at = e.prog.findLine(1).at
    e.prog.bytes[at + 10] = e.prog.bytes[at + 10]! | PROTECTED_PROC >> 8
    e.yCu = 1
    expect(edCall(e, ED.PROC_OPEN)).toBe(0)
    expect(closed(e, at)).toBe(false)
    expect(e.prog.lineCount).toBe(5)
  })

  it('tests before it closes, because the fold is stepped by the size', () => {
    const e = untested()
    const at = e.prog.findLine(1).at
    // straight off the tokeniser the size is zero, and `Fnd4` would step 14
    // bytes into the middle of the Procedure line's own name record
    expect(e.prog.procFlags(at)).toBe(0)
    e.yCu = 1
    expect(edCall(e, ED.PROC_OPEN)).toBe(0)
    expect(e.prog.modified).toBe(false)
    expect(listing(e)).toEqual(['Print "one"', 'Procedure DEMO', 'Print "two"'])
  })

  it('does not test to open, because nothing needs the size for that', () => {
    const e = open()
    e.yCu = 1
    edCall(e, ED.PROC_OPEN)
    e.prog.modified = true
    edCall(e, ED.PROC_OPEN)
    // `btst #7,10(a2) / bne .PaOu` jumps over the test when it is already
    // closed, so opening a fold leaves the program untested
    expect(e.prog.modified).toBe(true)
  })

  it('keeps the marks pointing at the same lines across a fold', () => {
    const e = open()
    e.prog.setMark(0, 4, 3)
    e.yCu = 1
    edCall(e, ED.PROC_OPEN)
    expect(e.prog.getMark(0)).toEqual({ line: 2, column: 3 })
    edCall(e, ED.PROC_OPEN)
    expect(e.prog.getMark(0)).toEqual({ line: 4, column: 3 })
  })
})

describe('Open All and Close All', () => {
  // not ONE and TWO: the tokeniser takes the `On` out of ONE and what is
  // left is a syntax error, which is its own lesson about keyword matching
  const TWO = 'Print "a"\nProcedure ALPHA\nPrint 1\nEnd Proc\nProcedure BETA\nPrint 2\nEnd Proc\nPrint "b"'

  it('fold and unfold every procedure at once', () => {
    const e = open(TWO)
    expect(edCall(e, ED.PROCS_CLOSE)).toBe(0)
    expect(listing(e)).toEqual(['Print "a"', 'Procedure ALPHA', 'Procedure BETA', 'Print "b"'])
    expect(edCall(e, ED.PROCS_OPEN)).toBe(0)
    expect(e.prog.lineCount).toBe(8)
  })

  it('leave the cursor on the same line of text, not the same number', () => {
    const e = open(TWO)
    e.yCu = 7 // Print "b"
    edCall(e, ED.PROCS_CLOSE)
    // two folds above it, four lines gone
    expect(e.line).toBe(3)
    expect(listing(e)[e.line]).toBe('Print "b"')
    edCall(e, ED.PROCS_OPEN)
    expect(e.line).toBe(7)
  })

  it('skip a locked procedure in both directions', () => {
    const e = open(TWO)
    const at = e.prog.findLine(1).at
    e.prog.bytes[at + 10] = e.prog.bytes[at + 10]! | PROTECTED_PROC >> 8
    edCall(e, ED.PROCS_CLOSE)
    expect(closed(e, at)).toBe(false)
    expect(e.prog.lineCount).toBe(6)
  })
})

describe('Test', () => {
  it('answers No errors and leaves the program tested', () => {
    const e = untested()
    expect(edCall(e, ED.TEST)).toBe(197)
    expect(e.prog.modified).toBe(false)
    expect(e.testError).toBe(-1)
  })

  it('puts the cursor on the byte the walk stopped at', () => {
    const e = untested('Print "one"\nPrint "two" : Next I')
    expect(edCall(e, ED.TEST)).toBe(0)
    // 34 is "NEXT without FOR" in Ed_TstMessages
    expect(e.testError).toBe(34)
    expect(e.line).toBe(1)
    expect(e.xCu).toBe('Print "two" : '.length)
    // `clr.b Prg_StModif` is below `bsr PTest`, so the error never reached it
    expect(e.prog.modified).toBe(true)
  })

  it('is run again by the next command that needs it', () => {
    const e = untested('Print "one"\nNext I')
    expect(edCall(e, ED.TEST)).toBe(0)
    expect(edCall(e, ED.TEST)).toBe(0)
    expect(e.testError).toBe(34)
  })

  it('does nothing at all when the program has not changed', () => {
    const e = open()
    const before = e.prog.bytes.slice()
    expect(edCall(e, ED.TEST)).toBe(197)
    expect(e.prog.bytes).toEqual(before)
  })
})

describe('an error inside a closed procedure', () => {
  /**
   * A program whose fold is correct and whose body no longer verifies.
   *
   * The label is defined and jumped to inside the procedure, so it tests and
   * folds cleanly; changing the DEFINITION's last letter in place leaves every
   * size right and the `Goto` with nothing to reach.
   */
  function broken(): Edit {
    const e = open('Print "one"\nProcedure DEMO\nLOSTX:\nGoto LOSTX\nEnd Proc\nPrint "two"')
    e.yCu = 1
    edCall(e, ED.PROC_OPEN)
    expect(e.prog.lineCount).toBe(3)
    const at = Buffer.from(e.prog.bytes).indexOf(Buffer.from('lostx', 'latin1'))
    e.prog.bytes[at + 4] = 'y'.charCodeAt(0)
    e.prog.modified = true
    return e
  }

  it('keeps the address, and drops the cursor to column 0', () => {
    const e = broken()
    e.yCu = 0
    expect(edCall(e, ED.TEST)).toBe(0)
    expect(e.testError).toBe(41) // Undefined label
    // `clr.w (sp)` in Ed_SetXY: the cursor cannot go inside a fold, so it
    // lands on the fold's line at column 0 and the real column is kept
    expect(e.line).toBe(1)
    expect(e.xCu).toBe(0)
    expect(e.prog.adEProc).not.toBe(0)
    expect(e.prog.xEProc).toBe('Goto '.length)
  })

  it('takes the cursor to the error when the fold is opened', () => {
    const e = broken()
    edCall(e, ED.TEST)
    e.yCu = 1
    expect(edCall(e, ED.PROC_OPEN)).toBe(0)
    expect(e.line).toBe(3)
    expect(e.xCu).toBe('Goto '.length)
  })

  it('lives for exactly one command after the test', () => {
    const e = broken()
    edCall(e, ED.TEST)
    const at = e.prog.adEProc
    // `Ed_ClEProc` runs before the command body: the first one raises bit 31
    // and the address is still there for it to use, the second finds the bit
    // already up and clears the long
    edCall(e, ED.CUR_DOWN)
    expect(e.prog.adEProc).toBe(at)
    expect(e.prog.eProcStale).toBe(true)
    edCall(e, ED.CUR_UP)
    expect(e.prog.adEProc).toBe(0)
  })

  it('is gone by the second command, so the fold opens on its own line', () => {
    const e = broken()
    edCall(e, ED.TEST)
    edCall(e, ED.CUR_DOWN)
    edCall(e, ED.CUR_UP)
    e.yCu = 1
    expect(edCall(e, ED.PROC_OPEN)).toBe(0)
    expect(e.line).toBe(1)
    expect(e.xCu).toBe(0)
  })
})

describe('Indent', () => {
  it('runs the Test pass first, then rewrites every indent byte', () => {
    const e = untested('Print 1\nFor I=0 To 9\nPrint 2\nNext I')
    expect(edCall(e, ED.INDENT)).toBe(0)
    expect(e.prog.modified).toBe(false)
    expect(listing(e)).toEqual(['Print 1', 'For I=0 To 9', '   Print 2', 'Next I'])
  })
})
