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
import { ED, USER_SECU, drawWindows, edCall, sysUnCode } from './commands'
import { PORT_ABOUT_LINES, PORT_ABOUT_SCRIPT, PORT_MENU_LABELS, PORT_VERSION } from './branding'
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

  it('puts the name in slot 0 and the count in slot 1', () => {
    const e = open()
    e.editor.extensions[0] = 'AMOSPro Music extension V 2.00'
    e.editor.extensions[5] = ''
    edCall(e, ED.ABOUT)
    expect(shown[0]!.strings![0]).toBe('amos-ts')
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

  it('fills a slot for every line the replaced label prints', () => {
    // The shipped label composes its text out of `Ed_Messages`; this one
    // takes it from the variables, so every `nVA` the script prints has to be
    // a slot the command filled. Slot 1 is the count, which the script builds
    // from the number in it.
    const e = open()
    edCall(e, ED.ABOUT)
    const printed = new Set([...PORT_ABOUT_SCRIPT.matchAll(/(\d+)VA/g)].map((m) => Number(m[1])))
    printed.delete(1)
    for (const slot of printed) expect(shown[0]!.strings![slot], `slot ${slot}`).toBeTruthy()
  })

  it('names this port, and carries the notice AMOS asks to see', () => {
    // The AMOS Professional source was published under MIT, and its README
    // asks for the copyright notice "in both the modified source code and the
    // boot screen of the application". Its LICENSE file is where these two
    // lines come from, verbatim; ../../LICENSE carries all three.
    const lines = [...PORT_ABOUT_LINES.values()]
    expect(lines).toContain('amos-ts')
    expect(lines).toContain('amos.bitplane.net')
    expect(lines).toContain('Based on AMOS Professional')
    // the years are the release's, not ours to round: its LICENSE says 1992
    // for Europress and 2020 for the source Francois Lionet published
    expect(lines).toContain('(c) 1992 Europress Software')
    expect(lines).toContain('(c) 2020 Francois Lionet')
    expect(lines).toContain('(c) 2026 Gareth Davidson')
    expect(lines).toContain(`version: ${PORT_VERSION}`)
    expect(lines).toContain('This program is free software')
    expect(lines).toContain('see LICENSE at')
    expect(lines).toContain('https://github.com/bitplane/amos-ts')
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
