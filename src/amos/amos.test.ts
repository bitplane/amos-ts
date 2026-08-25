import { describe, expect, it } from 'vitest'
import { ED } from '../editor/commands'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'
import { Amos } from './amos'
import type { Confirm, DialogueAnswer, EditorDialogues, SearchDialogue } from '../editor/search'

/** a program, and somewhere for what it prints to go */
function boot(src: string): { amos: Amos; out: () => string } {
  const text: string[] = []
  const amos = new Amos(src, { onText: (t) => text.push(t), rows: 12 })
  return { amos, out: () => text.join('').replace(/\s+/g, ' ').trim() }
}

/** a requester that answers `button`, since `Ed_Ligne` asks before every error */
const asks = (button: number): EditorDialogues => ({
  ask: (d: SearchDialogue): DialogueAnswer => ({ ...d, ok: true }),
  confirm: (_c: Confirm) => button,
  select: (_w, name) => name,
  pressKey: () => 0,
  pickWindow: () => 0,
  pickMenu: () => 0,
  text: () => '',
  flags: () => 0,
  value: () => 0,
})

describe('Run, from the editor all the way through the interpreter', () => {
  it('runs the program the window holds and comes back quietly', () => {
    const { amos, out } = boot('Print "one"\nPrint "two"')
    expect(amos.call(ED.RUN)).toBe(0)
    expect(out()).toBe('one two')
    // the walk ran off the end, which is `End`: `Ed_Errr` sends 10 to Ed_Loop
    expect(amos.editor.runned).toBe(null)
    expect(amos.editor.running).toEqual([])
  })

  it('can run the same program twice, because Prg_Pull happened', () => {
    const { amos, out } = boot('Print "again"')
    expect(amos.call(ED.RUN)).toBe(0)
    expect(amos.call(ED.RUN)).toBe(0)
    expect(out()).toBe('again again')
  })

  it('treats Edit as a quiet return and System as the end of the session', () => {
    const a = boot('Print "x"\nEdit')
    expect(a.amos.call(ED.RUN)).toBe(0)
    expect(a.amos.done).toBe(false)

    const b = boot('Print "x"\nSystem')
    expect(b.amos.call(ED.RUN)).toBe(0)
    expect(b.amos.done).toBe(true)
  })

  it('shows a run-time error on the status line, with a full stop', () => {
    const { amos } = boot('Print "before"\nOpen In 1,"nothing:here"\nPrint "after"')
    amos.editor.dialogues = asks(2) // Ed_Ligne: anything but 1 is the editor
    const alert = amos.call(ED.RUN)
    expect(alert).toBeGreaterThan(0)
    expect(amos.alert.text).toBe(`${ED_RUN_MESSAGES[alert]!}.`)
  })

  it('puts the cursor on the line the program stopped at', () => {
    const { amos } = boot('Print "a"\nPrint "b"\nOpen In 1,"nothing:here"')
    amos.editor.dialogues = asks(2)
    amos.call(ED.RUN)
    expect(amos.window.line).toBe(2)
  })

  it('asks Direct or Edit first, and says nothing when the answer is Direct', () => {
    const { amos } = boot('Open In 1,"nothing:here"')
    amos.editor.dialogues = asks(1) // `cmp.w #1,d1 / beq Ed_ErrDirect`
    expect(amos.call(ED.RUN)).toBe(0)
    expect(amos.alert.text).toBe('')
  })

  it('leaves the program tested, so the editor can save it as one', () => {
    const { amos } = boot('Print "x"')
    amos.window.prog.modified = true // as an edit would leave it
    amos.call(ED.RUN)
    // `clr.b Prg_StModif(a6)` after PTest, inside Prg_RunIt
    expect(amos.window.prog.modified).toBe(false)
  })
})
