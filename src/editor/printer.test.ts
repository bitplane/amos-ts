/**
 * `Ed_PrgPrint` (+Edit.s:6463) and `Ed_BlocPrint` (:6504), and the routine
 * under both of them.
 *
 * The interesting part is not the loop. It is where the output goes: system
 * message 43 is `Par:`, so the editor writes to the parallel port raw and
 * printer.device never sees it.
 */
import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { SYS_MESSAGES } from '../runtime/runtime'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, drawWindows, edCall } from './commands'
import type { Confirm, DialogueAnswer, EditorDialogues, SearchDialogue } from './search'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)
const PROG = 'Print "one"\nPrint "two"\nPrint "three"'

/** every write the printer was given, kept apart so the line count is visible */
let writes: Uint8Array[] = []
let asked: Confirm | null = null

const requester = (button = 1): EditorDialogues => ({
  ask: (d: SearchDialogue): DialogueAnswer => ({ ...d, ok: true }),
  confirm: (c) => {
    asked = c
    return button
  },
  select: (_w, name) => name,
  pressKey: () => 0,
  pickWindow: () => 0,
  pickMenu: () => 0,
  text: () => '',
  flags: () => 0,
  value: () => 0,
})

function open(text = PROG, button = 1, ready = true): Edit {
  writes = []
  asked = null
  const e = new Edit(ProgramBuffer.load(tested(text), 4096), new EditBuffer(8), new UndoBuffer(50), table)
  e.dialogues = requester(button)
  if (ready) {
    e.editor.printer = (data) => {
      writes.push(data.slice())
      return true
    }
  }
  drawWindows(e.editor)
  return e
}

const printed = (): string => writes.map((w) => String.fromCharCode(...w)).join('')

/** the block the two-line forms need: from line 0 column 0 to line 1 column 5 */
function markBlock(e: Edit, y0: number, x0: number, y1: number, x1: number): void {
  e.yPos = 0
  e.yCu = y0
  e.xCu = x0
  edCall(e, ED.BLOCK_ON)
  e.yCu = y1
  e.xCu = x1
  edCall(e, ED.BLOCK_STORE)
}

describe('where the editor prints to', () => {
  it('opens Par:, not PRT:', () => {
    // `moveq #43,d0 / JJsr L_Sys_GetMessage` (+Edit.s:13976)
    expect(SYS_MESSAGES[43]).toBe('Par:')
  })
})

describe('Ed_PrgPrint', () => {
  it('asks first and does nothing when the answer is not 1', () => {
    const e = open(PROG, 2)
    expect(edCall(e, ED.PRINT_PROGRAM)).toBe(206) // Ed_NotDone
    expect(asked!.which).toBe(61) // EdD_PProg
    expect(writes).toEqual([])
  })

  it('writes one line per write, each ending CR LF', () => {
    const e = open()
    expect(edCall(e, ED.PRINT_PROGRAM)).toBe(0)
    expect(writes).toHaveLength(3)
    expect(printed()).toBe('Print "one"\r\nPrint "two"\r\nPrint "three"\r\n')
  })

  /** `Ed_AverMess` puts message 217 up and `Ed_AverFin` takes it down again */
  it('stands a warning box in front of the text while it runs', () => {
    const e = open()
    const seen: number[][] = []
    e.editor.printer = (data) => {
      seen.push([...e.editor.avert])
      writes.push(data.slice())
      return true
    }
    edCall(e, ED.PRINT_PROGRAM)
    expect(seen[0]).toEqual([217])
    expect(e.editor.avert).toEqual([])
  })

  /**
   * `bclr #BitControl-8,T_Actualise(a5)` reads the Control key and clears it
   * in the same instruction, so the flag is consumed whether or not the job
   * was going to stop.
   */
  it('stops where Control was pressed and clears the flag', () => {
    const e = open()
    e.editor.printer = (data) => {
      writes.push(data.slice())
      e.abort = true
      return true
    }
    edCall(e, ED.PRINT_PROGRAM)
    expect(writes).toHaveLength(1)
    expect(e.abort).toBe(false)
  })

  it('reports 216 when the printer will not open', () => {
    const e = open(PROG, 1, false)
    expect(edCall(e, ED.PRINT_PROGRAM)).toBe(216) // Printer not ready.
    expect(e.editor.avert).toEqual([])
  })

  it('reports 216 when a write fails part way through', () => {
    const e = open()
    e.editor.printer = (data) => {
      writes.push(data.slice())
      return writes.length < 2
    }
    expect(edCall(e, ED.PRINT_PROGRAM)).toBe(216)
    expect(writes).toHaveLength(2)
  })
})

describe('Ed_BlocPrint', () => {
  it('refuses without a block', () => {
    const e = open()
    expect(edCall(e, ED.PRINT_BLOCK)).toBe(6) // What block?
    expect(asked).toBeNull()
  })

  it('prints the marked lines and nothing else', () => {
    const e = open()
    markBlock(e, 0, 0, 1, 11)
    expect(edCall(e, ED.PRINT_BLOCK)).toBe(0)
    expect(asked!.which).toBe(60) // EdD_PBloc
    expect(printed()).toBe('Print "one"\r\nPrint "two"\r\n')
  })

  it('does not open with a blank line when the block starts at a line end', () => {
    const e = open()
    markBlock(e, 0, 11, 1, 11)
    edCall(e, ED.PRINT_BLOCK)
    expect(printed()).toBe('Print "two"\r\n')
  })
})

/**
 * `Ed_PRTPrint` (:13987). `PI_PrtRet` ships as 1, so the shipped editor sends
 * both characters and the arithmetic below never bites.
 */
describe('what PI_PrtRet does to a line ending', () => {
  it('sends CR LF as they were written when PrtRet is set', () => {
    const e = open('Print "one"')
    edCall(e, ED.PRINT_PROGRAM)
    expect([...writes[0]!]).toEqual([...'Print "one"'].map((c) => c.charCodeAt(0)).concat([13, 10]))
  })

  /**
   * DEFECT: `.Ip2` measures the input rather than what the loop built, so the
   * dropped carriage return costs one byte at the end. That byte is the
   * string's own terminating zero, and it goes to the printer.
   */
  it('drops the carriage return and sends a zero in its place when PrtRet is clear', () => {
    const e = open('Print "one"')
    e.editor.prtRet = 0
    edCall(e, ED.PRINT_PROGRAM)
    expect([...writes[0]!]).toEqual([...'Print "one"'].map((c) => c.charCodeAt(0)).concat([10, 0]))
    // the write is as long as the editor's own string, one byte longer than
    // the text it meant to send
    expect(writes[0]!.length).toBe('Print "one"\r\n'.length)
  })
})
