import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, drawWindows, edCall } from './commands'
import { UN } from './undo'
import type { RunRequest } from './windows'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)
const PROG = 'Print "one"\nPrint "two"\nPrint "three"'

function open(text = PROG, rows = 8): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text), 65536), new EditBuffer(rows), new UndoBuffer(50), table)
  drawWindows(e.editor)
  return e
}

/** the same window straight off the tokeniser, so the Test pass has work to do */
function openRaw(text: string, rows = 8): Edit {
  const e = new Edit(
    ProgramBuffer.load(tokeniseSource(text, table).slice(0, -2), 65536),
    new EditBuffer(rows),
    new UndoBuffer(50),
    table,
  )
  e.prog.modified = true
  drawWindows(e.editor)
  return e
}

/** a second window, hidden, which is where `Ed_RunHidden` looks */
function hidden(e: Edit, text = PROG): Edit {
  const w = new Edit(
    ProgramBuffer.load(tested(text), 65536),
    new EditBuffer(4),
    new UndoBuffer(50),
    table,
    {},
    e.editor,
  )
  w.hidden = 1
  return w
}

/** a host that records what it was asked to run, and the state at the time */
function host(e: Edit): { calls: RunRequest[]; testing: boolean[] } {
  const calls: RunRequest[] = []
  const testing: boolean[] = []
  e.editor.runProgram = (r) => {
    calls.push(r)
    testing.push(e.editor.tstMesOn)
  }
  return { calls, testing }
}

/** a program over 4K, which is what `Ed_Test1` measures before it says so */
const big = (extra = ''): string =>
  Array.from({ length: 400 }, (_, i) => `Print "line ${i}"`).join('\n') + (extra === '' ? '' : '\n' + extra)

describe('Run', () => {
  it('hands the current window to the host as a normal program', () => {
    const e = open()
    const seen = host(e)
    expect(edCall(e, ED.RUN)).toBe(0)
    expect(seen.calls.length).toBe(1)
    expect(seen.calls[0]!.window).toBe(e)
    expect(seen.calls[0]!.accessory).toBe(false)
    expect(seen.calls[0]!.hidden).toBe(false)
    // `clr.l (a1)` on the command line: Run never gives the program one
    expect(seen.calls[0]!.commandLine).toBe('')
    expect(e.editor.runned).toBe(e)
    expect(e.editor.running).toEqual([e.prog])
  })

  it('frees the block and razes every undo ring on the way', () => {
    const e = open()
    const w = hidden(e)
    e.block.bytes = new Uint8Array(16)
    e.undo.record(UN.CHAR, 0, 0, 32, 65)
    w.undo.record(UN.CHAR, 0, 0, 32, 65)
    host(e)
    edCall(e, ED.RUN)
    expect(e.block.empty).toBe(true)
    // `Prg_RazUndos` walks the whole list, so the hidden window loses its
    // undo too even though it is not the program being run
    expect(e.undo.undo()).toBe(null)
    expect(w.undo.undo()).toBe(null)
  })

  it('tests the program even when nothing has changed', () => {
    const e = open()
    host(e)
    edCall(e, ED.RUN)
    e.editor.verNInst = 0
    e.editor.running.length = 0
    expect(e.prog.modified).toBe(false)
    edCall(e, ED.RUN)
    // `Prg_RunIt` calls `PTest` outright; only `Ed_VaTester` reads Prg_StModif
    expect(e.editor.verNInst).toBeGreaterThan(0)
  })

  it('says Out of memory when the program is already running', () => {
    const e = open()
    host(e)
    edCall(e, ED.RUN)
    // DEFECT: `bra Ed_OMm` takes both of `Prg_RunIt`'s returns, so the
    // already-running answer is reported as an allocation failure
    expect(edCall(e, ED.RUN)).toBe(204)
    expect(e.editor.runned).toBe(null)
  })

  it('still costs the block and the undos when it is already running', () => {
    const e = open()
    host(e)
    edCall(e, ED.RUN)
    e.block.bytes = new Uint8Array(16)
    e.undo.record(UN.CHAR, 0, 0, 32, 65)
    expect(edCall(e, ED.RUN)).toBe(204)
    // `Prg_DejaRunned` is the first thing INSIDE `Prg_RunIt`, and everything
    // above it has already happened
    expect(e.block.empty).toBe(true)
    expect(e.undo.undo()).toBe(null)
  })

  it('does nothing but prepare when no host is listening', () => {
    const e = open()
    expect(edCall(e, ED.RUN)).toBe(0)
    expect(e.editor.running).toEqual([])
  })
})

describe('the ...Testing... box', () => {
  it('goes up for a program of 4K or more, and comes down again', () => {
    const small = open()
    host(small)
    edCall(small, ED.RUN)
    expect(small.editor.tstMesOn).toBe(false)

    const e = open(big())
    expect(e.prog.stHaut - e.prog.stBas).toBeGreaterThanOrEqual(4096)
    host(e)
    edCall(e, ED.RUN)
    // `Ed_Test2` took it down before the program started
    expect(e.editor.tstMesOn).toBe(false)
    expect(e.editor.avert).toEqual([])
  })

  it('stays up when the test fails, because `jsr 4(a2)` is never reached', () => {
    const e = openRaw(big('Next A'))
    host(e)
    expect(edCall(e, ED.RUN)).toBe(0)
    expect(e.testError).toBeGreaterThan(0) // the walk stopped
    expect(e.editor.tstMesOn).toBe(true)
    expect(e.editor.running).toEqual([])
  })
})

describe('Run Hidden', () => {
  it('runs a hidden window as an accessory', () => {
    const e = open()
    const w = hidden(e)
    const seen = host(e)
    expect(edCall(e, ED.RUN_HIDDEN, 0)).toBe(0)
    expect(seen.calls[0]!.window).toBe(w)
    expect(seen.calls[0]!.accessory).toBe(true)
    expect(seen.calls[0]!.hidden).toBe(true)
    expect(e.editor.runnedHidden).toBe(true)
  })

  it('says Not done when there is no such hidden window', () => {
    const e = open()
    host(e)
    expect(edCall(e, ED.RUN_HIDDEN, 0)).toBe(206)
  })

  it('says Program already run rather than Out of memory', () => {
    const e = open()
    hidden(e)
    host(e)
    edCall(e, ED.RUN_HIDDEN, 0)
    expect(edCall(e, ED.RUN_HIDDEN, 0)).toBe(12)
  })
})

describe('Workbench', () => {
  it('is one call, and it puts AMOS behind rather than opening anything', () => {
    const e = open()
    let back = 0
    e.editor.amosToBack = () => {
      back++
    }
    expect(edCall(e, ED.WORKBENCH)).toBe(0)
    expect(back).toBe(1)
  })

  it('does nothing at all when no host owns a display', () => {
    const e = open()
    expect(edCall(e, ED.WORKBENCH)).toBe(0)
  })
})
