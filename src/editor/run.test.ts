import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { TK, detokLineBytes, tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, drawWindows, edCall, edEscapeReturn, edRunReturn } from './commands'
import { UN } from './undo'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'
import { ED_MESSAGES, ED_TST_MESSAGES } from '../runtime/edmessages.gen'
import type { RunRequest } from './windows'
import type { Confirm, DialogueAnswer, EditorDialogues, SearchDialogue } from './search'

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

/** a requester that answers `button` and records what it was shown */
function asks(e: Edit, button: number): { seen: Confirm[] } {
  const seen: Confirm[] = []
  const d: EditorDialogues = {
    ask: (q: SearchDialogue): DialogueAnswer => ({ ...q, ok: true }),
    confirm: (c) => {
      seen.push(c)
      return button
    },
    select: (_w, name) => name,
    pressKey: () => 0,
    pickWindow: () => 0,
    pickMenu: () => 0,
    text: () => '',
    flags: () => 0,
    value: () => 0,
  }
  e.dialogues = d
  return { seen }
}

/** run the program, then stop it with `code` */
function stop(e: Edit, code: number, at = -1, text: string | null = null): number {
  host(e)
  edCall(e, ED.RUN)
  return edRunReturn(e, code, at, text)
}

describe('when the program stops', () => {
  it('says nothing for End, and lets the program be run again', () => {
    const e = open()
    expect(stop(e, 10)).toBe(0)
    expect(e.editor.runned).toBe(null)
    expect(e.editor.running).toEqual([]) // Prg_Pull
    expect(edCall(e, ED.RUN)).toBe(0)
  })

  it('says nothing for Edit, which is 1000', () => {
    const e = open()
    expect(stop(e, 1000)).toBe(0)
  })

  it('ends the session for System, which is 1002', () => {
    const e = open()
    expect(stop(e, 1002)).toBe(0)
    expect(e.editor.quit).toBe(true)
  })

  it('goes to Direct for 1001, which this port has nowhere to put', () => {
    const e = open()
    expect(stop(e, 1001)).toBe(0)
    expect(e.editor.runned).toBe(null)
  })

  it('asks Direct or Edit for a run-time error, and a port with no requester says Direct', () => {
    const e = open()
    // `Ed_Ligne` is reached for every code that is not 10, 1000, 1001 or 1002,
    // and `cmp.w #1,d1` makes button 1 Direct. A missing requester answers 1
    expect(stop(e, 81)).toBe(0)
  })

  it('shows the message with a full stop when the requester says Edit', () => {
    const e = open()
    const { seen } = asks(e, 2)
    expect(stop(e, 81)).toBe(81)
    expect(e.alertText).toBe(ED_RUN_MESSAGES[81]! + '.')
    expect(e.alertTime).toBe(200)
    expect(seen[0]!.which).toBe(59) // EdD_Ligne
    expect(seen[0]!.strings?.[0]).toBe(ED_RUN_MESSAGES[81])
  })

  it('puts the cursor on the byte the program stopped at', () => {
    const e = open()
    asks(e, 2)
    // the string token of `Print "three"`, which detokenises at column 6
    const at = e.prog.findLine(2).at + 4 - e.prog.stBas
    stop(e, 81, at)
    expect([e.line, e.xCu]).toEqual([2, 6])
  })

  it('shows an extension error text as it stands, table or no table', () => {
    const e = open()
    asks(e, 2)
    expect(stop(e, 1, -1, 'Nothing there')).toBe(1)
    expect(e.alertText).toBe('Nothing there.')
  })

  it('reads a code of zero or less out of the TEST table', () => {
    const e = open()
    // a negative code skips the requester: `tst.l d0 / bmi Ed_ErrEdit`
    expect(stop(e, -3)).toBe(3)
    expect(e.alertText).toBe(ED_TST_MESSAGES[2]! + '.')
  })

  it('shows a window around the error rather than the start of the line', () => {
    const e = open(`Print "${'-'.repeat(40)}" : Print "${'='.repeat(70)}"`)
    const { seen } = asks(e, 2)
    // the SECOND `Print` on the line, which is far enough along that both
    // halves have to be cut
    const start = e.prog.findLine(0).at
    const end = start + e.prog.bytes[start]! * 2
    let at = -1
    for (let p = start + 4; p < end; p += 2) {
      if (((e.prog.bytes[p]! << 8) | e.prog.bytes[p + 1]!) === TK.PRINT) {
        at = p - e.prog.stBas
        break
      }
    }
    expect(at).toBeGreaterThan(0)
    stop(e, 81, at)
    const head = seen[0]!.strings![2]!
    const tail = seen[0]!.strings![3]!
    // `moveq #60,d4 / add.w d3,d4` then `sub.w #73,d4`: 60 after, 13 before
    expect(head.length).toBe(13)
    expect(tail.length).toBe(60)
    expect(detokLineBytes(e.prog.bytes, start, table).indexOf(head + tail)).toBeGreaterThan(0)
  })

  it('drops the block anchor when the program reloaded itself', () => {
    const e = open()
    e.yBloc = 1
    host(e)
    edCall(e, ED.RUN)
    e.prog.reloaded = true // `Run "file"` from inside it
    edRunReturn(e, 10)
    expect(e.yBloc).toBe(-1)
    expect(e.prog.reloaded).toBe(false)
  })
})

describe('when a hidden program stops', () => {
  it('says which program it was, and moves no cursor', () => {
    const e = open()
    hidden(e)
    host(e)
    edCall(e, ED.RUN_HIDDEN, 0)
    expect(e.editor.runnedHidden).toBe(true)
    expect(edRunReturn(e, 81)).toBe(81)
    expect(e.alertText).toBe(ED_MESSAGES[8]! + ED_RUN_MESSAGES[81]! + '.')
    expect(e.line).toBe(0)
    expect(e.editor.runnedHidden).toBe(false)
  })

  it('is quiet for End, and there is no requester on this path', () => {
    const e = open()
    hidden(e)
    host(e)
    edCall(e, ED.RUN_HIDDEN, 0)
    expect(edRunReturn(e, 10)).toBe(0)
  })

  it('ends the session for System, which Ed_Errr handles for the other path', () => {
    const e = open()
    hidden(e)
    host(e)
    edCall(e, ED.RUN_HIDDEN, 0)
    expect(edRunReturn(e, 1002)).toBe(0)
    expect(e.editor.quit).toBe(true)
  })

  it('deletes the window when it was only borrowed to hold the program', () => {
    const e = open()
    const w = hidden(e)
    w.prgDelete = true
    host(e)
    edCall(e, ED.RUN_HIDDEN, 0)
    const was = e.editor.list.length
    edRunReturn(e, 10)
    expect(e.editor.list.length).toBe(was - 1)
  })
})

describe('Escape', () => {
  it('hides the editor and asks the host for the escape screen', () => {
    const e = open()
    const seen: boolean[] = []
    e.editor.escapeScreen = (up) => seen.push(up)
    expect(edCall(e, ED.ESCAPE)).toBe(0)
    expect(seen).toEqual([true])
    expect(e.editor.esFlag).toBe(true)
    expect(e.editor.escape).toBe(true)
  })

  it('still flips both flags with nobody listening', () => {
    const e = open()
    edCall(e, ED.ESCAPE)
    expect([e.editor.esFlag, e.editor.escape]).toEqual([true, true])
  })

  it('asks twice for nothing, because Esc_Appear tests Direct first', () => {
    const e = open()
    const seen: boolean[] = []
    e.editor.escapeScreen = (up) => seen.push(up)
    edCall(e, ED.ESCAPE)
    edCall(e, ED.ESCAPE)
    expect(seen).toEqual([true])
  })

  it('comes back through Esc_Esc, which stops the alert counting down', () => {
    const e = open()
    const seen: boolean[] = []
    e.editor.escapeScreen = (up) => seen.push(up)
    edCall(e, ED.ESCAPE)
    e.alertTime = 100
    expect(edEscapeReturn(e)).toBe(0)
    expect(seen).toEqual([true, false])
    expect(e.alertTime).toBe(0) // clr.w Edt_EtMess(a4)
    expect([e.editor.esFlag, e.editor.escape]).toEqual([false, false])
  })

  it('takes the warning boxes down on the way, and the ZAP driver hears nothing', () => {
    const e = open()
    const heard: string[] = []
    e.editor.playSample = (c) => heard.push(c)
    e.editor.config.sounds = true
    e.editor.avert.push(198)
    edCall(e, ED.ESCAPE)
    expect(e.editor.avert).toEqual([]) // Ed_AllAverFin, inside Ed_Hide
    expect(heard).toEqual(['E'])

    heard.length = 0
    e.editor.zappeuse = true
    edEscapeReturn(e)
    expect(heard).toEqual([])
  })
})

describe('Ed_GoMonitor, which is the editor half of a separate program', () => {
  /**
   * `Ed_GoMonitor` (+Edit.s:7837) is twenty-three instructions and every one
   * of them is about giving memory back before `Mon_Load` asks for it.
   */
  it('says "Monitor not found." when there is nothing to load', () => {
    const e = open()
    // `Mon_Load` (+B.s:383) answers -2 when D_Open fails, and `.Load` turns
    // anything that is not -1 into message 222
    expect(edCall(e, ED.MONITOR)).toBe(222)
    expect(e.alertText).toBe('Monitor not found.')
    // `.Err` reopens before it reports, so the editor is back
    expect(e.editor.opened).toBe(true)
    expect(e.editor.esFlag).toBe(false)
  })

  it('says "Out of memory." for -1 and nothing else does', () => {
    const e = open()
    e.editor.loadMonitor = () => -1
    expect(edCall(e, ED.MONITOR)).toBe(204)
    expect(e.alertText).toBe('Out of memory.')

    e.editor.loadMonitor = () => -99
    expect(edCall(e, ED.MONITOR)).toBe(222)
  })

  it('gives back the undo, the block and the warnings first', () => {
    const e = open()
    e.editor.avert.push(198)
    e.xCu = 4
    edCall(e, ED.DELETE_WORD)
    e.yBloc = 0
    edCall(e, ED.BLOCK_CUT)
    expect(e.block.empty).toBe(false)
    e.editor.loadMonitor = () => -1
    edCall(e, ED.MONITOR)
    // Ed_CloseIt: Prg_FreeUndos, Ed_AllAverFin, Ed_BlocFree
    expect(e.undo.undo()).toBe(null)
    expect(e.editor.avert).toEqual([])
    expect(e.block.empty).toBe(true)
  })

  it('clears the variables before it closes, because HELP loads over them', () => {
    const e = open()
    let cleared = 0
    e.editor.clearVars = () => cleared++
    edCall(e, ED.MONITOR)
    expect(cleared).toBe(1)
  })

  it('does not come back, so the way out is Ed_ErrRun', () => {
    const e = open()
    let entered = 0
    e.editor.loadMonitor = () => 0
    e.editor.monitor = () => {
      entered++
      throw new Error('the monitor does not return')
    }
    expect(() => edCall(e, ED.MONITOR)).toThrow(/does not return/)
    expect(entered).toBe(1)
    // `move.l a4,Edt_Runned(a5)` before the jump, and `Ed_ErrRun` reads it
    expect(e.editor.runned).toBe(e)
    expect(e.editor.opened).toBe(false)

    // and the way back in is the same one a Run uses. 1000 is Edit, which
    // `Ed_Errr` sends straight to `Ed_ErrEdit` without asking
    expect(edRunReturn(e, 1000)).toBe(0)
    expect(e.editor.runned).toBe(null)
    expect(e.editor.opened).toBe(true)
  })

  it('treats a hook that DOES return as the one arm the machine has back', () => {
    // `clr.l Edt_Runned(a5)` under `JJsr L_Mon_In_Editor`, commented
    // "Revient >>> Out of memory!"
    const e = open()
    e.editor.loadMonitor = () => 0
    e.editor.monitor = () => {}
    expect(edCall(e, ED.MONITOR)).toBe(204)
    expect(e.editor.runned).toBe(null)
    expect(e.editor.opened).toBe(true)
  })
})
