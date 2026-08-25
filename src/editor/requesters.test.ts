import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { AmigaFS } from '../amiga/vfs'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, drawWindows, edCall } from './commands'
import type { Confirm, DialogueAnswer, EditorDialogues, SearchDialogue } from './search'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)
const PROG = 'Print "one"\nPrint "two"\nPrint "three"'

function open(text = PROG): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text), 4096), new EditBuffer(8), new UndoBuffer(50), table)
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  fs.mountMemory('AMOSPro_System')
  e.fs = fs
  e.dialogues = requester()
  drawWindows(e.editor)
  return e
}

/** a program the editor has not tested yet, which is what a load leaves */
function untested(text = PROG): Edit {
  const e = open(text)
  e.prog.modified = true // `move.b #1,Prg_StModif(a6)`, what EdLok forces
  return e
}

/** what the last requester was shown, so a test can read `Ed_VDialogues` */
let shown: Confirm | null = null

const requester = (button = 1, value = 0): EditorDialogues => ({
  ask: (d: SearchDialogue): DialogueAnswer => ({ ...d, ok: true }),
  confirm: (c) => {
    shown = c
    return button
  },
  select: (_w, name) => name,
  pressKey: () => 0,
  pickWindow: () => 0,
  value: () => value,
})

describe('Ed_STab', () => {
  it('opens the field on the tab it has, and keeps what comes back', () => {
    const e = open()
    e.tabs = 3
    e.dialogues = requester(1, 8)
    edCall(e, ED.SET_TAB)
    expect(shown!.which).toBe(38) // EdD_SetTab
    expect(shown!.values![2]).toBe(3)
    expect(e.tabs).toBe(8)
    expect(e.editor.configChanged).toBe(1)
  })

  it('stores the value on a Cancel too, because the button is never read', () => {
    const e = open()
    e.dialogues = requester(2, 11)
    edCall(e, ED.SET_TAB)
    expect(e.tabs).toBe(11)
  })
})

describe('Ed_GotoL', () => {
  it('is 1-based, so the number the user types is one more than the line', () => {
    const e = open()
    e.dialogues = requester(1, 3)
    edCall(e, ED.GOTO_LINE)
    expect(shown!.which).toBe(35) // EdD_GotoL
    expect(e.line).toBe(2)
  })

  it('refuses line 0, which is what subq.l #1 makes negative', () => {
    const e = open()
    e.dialogues = requester(1, 0)
    expect(edCall(e, ED.GOTO_LINE)).toBe(206) // Ed_NotDone
    expect(e.line).toBe(0)
  })

  it('stops at the line past the last, which is where a program grows', () => {
    const e = open()
    e.dialogues = requester(1, 900)
    edCall(e, ED.GOTO_LINE)
    expect(e.line).toBe(3)
    expect(e.prog.lineCount).toBe(3)
  })

  it('does nothing on any answer but the first button', () => {
    const e = open()
    e.dialogues = requester(2, 3)
    expect(edCall(e, ED.GOTO_LINE)).toBe(206)
    expect(e.line).toBe(0)
  })

  it('takes the ZAP parameter instead of asking', () => {
    const e = open()
    e.editor.zappeuse = true
    e.editor.zapParam = 2
    shown = null
    edCall(e, ED.GOTO_LINE)
    expect(shown).toBe(null)
    expect(e.line).toBe(1)
  })

  it('pushes where the cursor was onto the automatic marks', () => {
    const e = open()
    e.dialogues = requester(1, 3)
    edCall(e, ED.GOTO_LINE)
    expect(e.prog.marks[0]).toBe(0x0000_ff00)
  })
})

describe('Ed_Infos', () => {
  it('fills the six the box has messages for', () => {
    const e = untested()
    edCall(e, ED.INFOS)
    expect(shown!.which).toBe(54) // EdD_Infos
    const v = shown!.values!
    expect(v[0]).toBe(e.editor.chipFree)
    expect(v[1]).toBe(e.editor.fastFree)
    expect(v[2]).toBe(e.prog.stHaut - e.prog.stBas)
    expect(v[3]).toBe(0)
    expect(v[4]).toBe(3)
  })

  it('counts one per statement, not one per token', () => {
    // the walk dispatches once per instruction and the instruction's own
    // routine eats its arguments, so an expression with four operands in it
    // counts the same as a bare Print
    for (const [src, want] of [
      ['Print "one"', 1],
      [PROG, 3],
      ['A=1+2*3', 1],
      ['Print "one" : Print "two"', 2],
    ] as const) {
      const e = untested(src)
      edCall(e, ED.INFOS)
      expect([src, shown!.values![5]]).toEqual([src, want])
      expect(e.editor.verNInst).toBe(want)
    }
  })

  it('does not count a procedure header twice', () => {
    const flat = untested('Print "one"\nPrint "two"')
    edCall(flat, ED.INFOS)
    const plain = flat.editor.verNInst

    const proc = untested('Print "one"\nProcedure X\nPrint "two"\nEnd Proc')
    edCall(proc, ED.INFOS)
    // `Procedure` is walked in phase 0 and again in its own phase; `subq.l
    // #1,VerNInst` takes the first one back, so it and End Proc add two
    expect(proc.editor.verNInst).toBe(plain + 2)
    expect(plain).toBe(2)
  })

  it('tests the program first, so the count is this program\'s', () => {
    const e = open()
    e.prog.modified = true
    edCall(e, ED.INFOS)
    expect(e.prog.modified).toBe(false)
  })
})

describe('Ed_SetBuffer', () => {
  it('opens the field on the buffer it has', () => {
    const e = open()
    e.dialogues = requester(2)
    edCall(e, ED.SET_BUFFER)
    expect(shown!.which).toBe(36) // EdD_SetBuf
    expect(shown!.values![2]).toBe(4096)
  })

  it('keeps the program when the buffer grows', () => {
    const e = open()
    const was = e.prog.stHaut - e.prog.stBas
    e.dialogues = requester(1, 8192)
    edCall(e, ED.SET_BUFFER)
    expect(e.prog.bytes.length).toBe(8192)
    expect(e.prog.lineCount).toBe(3)
    expect(e.prog.stHaut - e.prog.stBas).toBe(was)
  })

  it('throws the program away when it shrinks, after offering to save it', () => {
    const e = open()
    e.prog.name = 'RAM:one.AMOS'
    e.prog.changed = true
    const asked: number[] = []
    e.dialogues = {
      ...requester(1, 2048),
      confirm: (c) => {
        asked.push(c.which)
        return 1
      },
    }
    edCall(e, ED.SET_BUFFER)
    expect(asked).toEqual([36, 11]) // EdD_SetBuf, then EdD_Saved
    expect((e.fs as AmigaFS).readFile('RAM:one.AMOS')).not.toBe(null)
    expect(e.prog.bytes.length).toBe(2048)
    expect(e.prog.lineCount).toBe(0)
  })

  it('refuses anything under 1,024, and rounds an odd size down', () => {
    const e = open()
    e.dialogues = requester(1, 1023)
    expect(edCall(e, ED.SET_BUFFER)).toBe(206)
    expect(e.prog.bytes.length).toBe(4096)
    e.dialogues = requester(1, 8193)
    edCall(e, ED.SET_BUFFER)
    expect(e.prog.bytes.length).toBe(8192)
  })

  it('refuses the size it already is', () => {
    const e = open()
    e.dialogues = requester(1, 4096)
    expect(edCall(e, ED.SET_BUFFER)).toBe(206)
    expect(e.prog.lineCount).toBe(3)
  })
})
