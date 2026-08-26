/**
 * `Ed_About` (+Edit.s:4580) and `Ed_AboutExt` (:4609).
 *
 * The About box is where the shipped source says out loud that nobody has
 * bought this copy: `UserReg` and `UserName` (+B.s:314) hold "REGISTRATION #"
 * and "Not Installed!", each XORed with its own byte, and Install.AMOS is what
 * writes the real details over them.
 */
import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, ED_HOME, ED_PORT, ED_VERSION, USER_SECU, drawWindows, edCall, sysUnCode } from './commands'
import { PORT_MENU_LABELS, PORT_MESSAGES, PORT_VERSION } from './branding'
import type { Confirm, DialogueAnswer, EditorDialogues, SearchDialogue } from './search'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)

/** every requester the command put up, in order */
let shown: Confirm[] = []

/** the button to answer with, one per requester, then 0 for ever */
function open(buttons: number[] = []): Edit {
  shown = []
  const e = new Edit(ProgramBuffer.load(tested('Print "one"')), new EditBuffer(8), new UndoBuffer(50), table)
  const answers = [...buttons]
  const dialogues: EditorDialogues = {
    ask: (d: SearchDialogue): DialogueAnswer => ({ ...d, ok: true }),
    confirm: (c) => {
      shown.push(c)
      return answers.shift() ?? 0
    },
    select: (_w, name) => name,
    pressKey: () => 0,
    pickWindow: () => 0,
    pickMenu: () => 0,
    text: () => '',
    flags: () => 0,
    value: () => 0,
  }
  e.dialogues = dialogues
  drawWindows(e.editor)
  return e
}

describe('Sys_UnCode', () => {
  it('takes the length word straight through and XORs the rest', () => {
    const b = Uint8Array.from([0, 3, 0x41 ^ 0x73, 0x42 ^ 0x73, 0x43 ^ 0x73])
    expect(sysUnCode(b, 0, 0x73)).toBe('ABC')
  })
})

describe('Ed_About', () => {
  it('is requester 0, the same one the editor starts with', () => {
    const e = open()
    edCall(e, ED.ABOUT)
    expect(shown).toHaveLength(1)
    expect(shown[0]!.which).toBe(0) // EdD_Title
  })

  it('puts the version in slot 0 and the count in slot 1', () => {
    const e = open()
    e.editor.extensions[0] = 'Music'
    e.editor.extensions[5] = ''
    edCall(e, ED.ABOUT)
    expect(shown[0]!.strings![0]).toBe(ED_VERSION)
    // DEVIATION: the machine's is " Version 2.00". The requester builds its
    // title as `SV 0,21ME 0VA !` -- message 21 and then this -- so the box
    // reads "AMOS Professional in TypeScript", which is what it is.
    expect(ED_VERSION).toBe(' in TypeScript')
    expect(shown[0]!.values![1]).toBe(2)
  })

  /**
   * `moveq #26-1,d0` over `AdTokens+4`, so the core token table at `AdTokens`
   * itself is not one of the twenty-six and an empty editor counts none.
   */
  it('counts nothing when no extension is loaded', () => {
    const e = open()
    edCall(e, ED.ABOUT)
    expect(shown[0]!.values![1]).toBe(0)
  })

  it('still carries the placeholders a copy that was never installed has', () => {
    // `UserReg` and `UserName` ship XORed with their own byte, and
    // `Sys_UnCode` (+B.s:595) is what reads them back. Nothing shows them any
    // more -- see below -- but what the shipped bytes hold is worth keeping.
    expect(sysUnCode(USER_SECU, 0, 0x73)).toBe('REGISTRATION #')
    expect(sysUnCode(USER_SECU, 16, 0xa5)).toBe('Not Installed!')
  })

  it('leaves the buyer s two lines empty, because nobody buys this one', () => {
    // DEVIATION: slots 2 and 3 are what Install.AMOS writes, under "Registered
    // User: " and "Registration Number: " (messages 219 and 220). Both labels
    // go empty with them in ./branding.ts, so the requester prints two empty
    // strings and no gap shows.
    const e = open()
    edCall(e, ED.ABOUT)
    expect(shown[0]!.strings![2]).toBe(ED_PORT)
    expect(shown[0]!.strings![3]).toBe(ED_HOME)
    expect([ED_PORT, ED_HOME]).toEqual(['', ''])
    expect(PORT_MESSAGES.get(219)).toBe('')
    expect(PORT_MESSAGES.get(220)).toBe('')
  })

  it('says what this port is, in the messages the requester composes', () => {
    // `SV 0,21ME 0VA !` is the title, so message 21 and `ED_VERSION` make it
    // between them; 22 and 23 are the two lines under it. The Europress
    // notice moves to the second box rather than going: the licence asks for
    // it, and the escape screen -- this application's boot screen -- prints
    // messages 21 to 23 unchanged.
    expect(`${PORT_MESSAGES.get(21)}${ED_VERSION}`).toBe('amos-ts: AMOS Professional in TypeScript')
    expect(PORT_MESSAGES.get(22)).toBe('By François Lionet / Gareth Davidson')
    expect(PORT_MESSAGES.get(23)).toBe('2026 bitplane.net')
    expect(PORT_MESSAGES.get(189)).toBe('© 1992 Europress Software Ltd.')
    expect(PORT_MESSAGES.get(188)).toBe(`version ${PORT_VERSION}`)
  })

  it('names itself in the menu entry that opens the box', () => {
    // 150 is `Ed_About`, and the shipped label is " About AMOS Professionnal "
    expect(PORT_MENU_LABELS.get(150)).toBe(' About amos-ts ')
  })
})

describe('Ed_AboutExt', () => {
  const withExts = (slots: Record<number, string>, buttons: number[] = []): Edit => {
    const e = open(buttons)
    for (const [n, title] of Object.entries(slots)) e.editor.extensions[Number(n) - 1] = title
    return e
  }

  it('does not appear at all with nothing loaded', () => {
    const e = open()
    edCall(e, ED.ABOUT_EXT)
    expect(shown).toEqual([])
  })

  it('opens on the first slot that holds a library', () => {
    const e = withExts({ 4: 'Compact' })
    edCall(e, ED.ABOUT_EXT)
    expect(shown).toHaveLength(1)
    expect(shown[0]!.which).toBe(55) // EdD_AboutE
    expect(shown[0]!.values![0]).toBe(4)
    expect(shown[0]!.strings![1]).toBe('Compact')
  })

  it('walks on with 2 and back with 1, and ends on anything else', () => {
    const e = withExts({ 1: 'A', 3: 'B', 7: 'C' }, [2, 2, 1, 9])
    edCall(e, ED.ABOUT_EXT)
    expect(shown.map((c) => c.values![0])).toEqual([1, 3, 7, 3])
    expect(shown.map((c) => c.strings![1])).toEqual(['A', 'B', 'C', 'B'])
  })

  /**
   * `.Next` writes d3 only when it finds something, so the button at the end
   * of the list shows the same extension again rather than saying so.
   */
  it('shows the same one again at either end', () => {
    const e = withExts({ 2: 'A', 5: 'B' }, [2, 2, 1, 1, 0])
    edCall(e, ED.ABOUT_EXT)
    expect(shown.map((c) => c.values![0])).toEqual([2, 5, 5, 2, 2])
  })

  /** `.Empty dc.w 0`: a library whose `LB_Title` is zero still gets a box */
  it('shows a library with no title as a number and a blank line', () => {
    const e = withExts({ 9: '' })
    edCall(e, ED.ABOUT_EXT)
    expect(shown[0]!.values![0]).toBe(9)
    expect(shown[0]!.strings![1]).toBe('')
  })

  it('reaches slot 26 and stops there', () => {
    const e = withExts({ 1: 'A', 26: 'Z' }, [2, 2, 0])
    edCall(e, ED.ABOUT_EXT)
    expect(shown.map((c) => c.values![0])).toEqual([1, 26, 26])
  })
})
