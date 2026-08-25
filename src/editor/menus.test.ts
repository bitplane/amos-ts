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
import { EDM_HIDDEN_MAX, MENU_RECORD, hiddenPage, readMenuDefs } from './menus'
import { ED_ROUTINES } from './keymap.gen'
import type { Confirm, DialogueAnswer, EditorDialogues, SearchDialogue } from './search'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)

let shown: Confirm | null = null

const requester = (): EditorDialogues => ({
  ask: (d: SearchDialogue): DialogueAnswer => ({ ...d, ok: true }),
  confirm: (c) => {
    shown = c
    return 1
  },
  select: (_w, name) => name,
  pressKey: () => 0,
  pickWindow: () => 0,
  value: () => 0,
})

function open(): Edit {
  const e = new Edit(ProgramBuffer.load(tested('Print "one"')), new EditBuffer(8), new UndoBuffer(50), table)
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  fs.mountMemory('AMOSPro_System')
  e.fs = fs
  e.dialogues = requester()
  drawWindows(e.editor)
  return e
}

/** one definition record, with every field stored the way the block stores it */
const rec = (command: number, inkB: number, inkA: number, spare: number, ...path: number[]): number[] => {
  const p = [...path, 0, 0, 0, 0].slice(0, 4)
  return [command + 48, inkB + 48, inkA + 48, spare + 48, ...p.map((n) => n + 48)]
}

const STAR = [0x2a, 0, 0, 0, 0, 0, 0, 0]

describe('the definition block', () => {
  it('is eight bytes a record with every field offset by 48', () => {
    const defs = Uint8Array.from([...rec(150, 3, 0, 1, 2, 1)])
    const [section] = readMenuDefs(defs, ['About'])
    expect(section).toEqual([
      { command: 150, inkA: 0, inkB: 3, path: [2, 1], label: 'About', active: true, title: false },
    ])
    expect(MENU_RECORD).toBe(8)
  })

  it('reads a separator as command 0, which is also what makes it inactive', () => {
    const defs = Uint8Array.from([...rec(0, 3, 2, 0, 2, 5)])
    const [section] = readMenuDefs(defs, ['------'])
    expect(section![0]!.command).toBe(0)
    expect(section![0]!.active).toBe(false)
    // `320` in the shipped block: a separator is drawn in ink 2
    expect(section![0]!.inkA).toBe(2)
  })

  it('reads a byte below "0" as a title, which never shows a key', () => {
    const defs = Uint8Array.from([0x20, 51, 48, 49, 50, 48, 48, 48])
    const [section] = readMenuDefs(defs, [' AMOS '])
    expect(section![0]!.title).toBe(true)
    expect(section![0]!.command).toBe(-16)
  })

  it('cuts the path at the first zero, so the depth is the length', () => {
    const defs = Uint8Array.from([...rec(1, 3, 0, 1, 7, 2, 0, 0)])
    const [section] = readMenuDefs(defs, ['x'])
    expect(section![0]!.path).toEqual([7, 2])
  })

  it('breaks a section on a star, which takes no label with it', () => {
    const defs = Uint8Array.from([...rec(1, 3, 0, 1, 2), ...STAR, ...rec(2, 3, 0, 1, 3)])
    const sections = readMenuDefs(defs, ['first', 'second'])
    expect(sections.length).toBe(2)
    expect(sections[0]!.map((m) => m.label)).toEqual(['first'])
    expect(sections[1]!.map((m) => m.label)).toEqual(['second'])
    expect(sections[1]![0]!.command).toBe(2)
  })
})

describe('the AMOS branch', () => {
  /** `count` hidden windows, which is what `Edt_CountHidden` walks */
  function hidden(e: Edit, count: number): void {
    for (let i = 0; i < count; i++) {
      const w = new Edit(ProgramBuffer.create(1024), new EditBuffer(0), new UndoBuffer(50), table, {}, e.editor)
      w.hidden = 2
      w.prog.name = `RAM:p${i}.AMOS`
    }
  }

  it('shows nothing, and no arrows, with no hidden programs', () => {
    const e = open()
    expect(hiddenPage(e.editor)).toEqual({ from: 0, previous: false, next: false, programs: [] })
  })

  it('shows twelve at a time and puts the next arrow up when there are more', () => {
    const e = open()
    hidden(e, 13)
    const page = hiddenPage(e.editor)
    expect(page.programs.length).toBe(EDM_HIDDEN_MAX)
    expect(page.next).toBe(true)
    expect(page.previous).toBe(false)
    expect(page.programs[0]).toBe(e.editor.list.filter((w) => w.hidden !== 0)[0])
  })

  it('clears the position when everything fits', () => {
    const e = open()
    hidden(e, 3)
    e.editor.posHidden = 7
    expect(hiddenPage(e.editor).from).toBe(0)
    expect(e.editor.posHidden).toBe(0)
  })

  it('pulls the position back to the last full page', () => {
    const e = open()
    hidden(e, 20)
    e.editor.posHidden = 99
    expect(hiddenPage(e.editor).from).toBe(8) // 20 - 12
    expect(hiddenPage(e.editor).next).toBe(false)
    expect(hiddenPage(e.editor).previous).toBe(true)
  })
})

describe('the commands over it', () => {
  it('steps by eleven while the page shows twelve', () => {
    const e = open()
    for (let i = 0; i < 40; i++) {
      const w = new Edit(ProgramBuffer.create(1024), new EditBuffer(0), new UndoBuffer(50), table, {}, e.editor)
      w.hidden = 2
    }
    edCall(e, ED.NEXT_HIDDEN)
    expect(e.editor.posHidden).toBe(11)
    edCall(e, ED.NEXT_HIDDEN)
    expect(e.editor.posHidden).toBe(22)
    edCall(e, ED.PREV_HIDDEN)
    expect(e.editor.posHidden).toBe(11)
  })

  it('refuses Previous at the top, and floors at zero from a short step', () => {
    const e = open()
    expect(edCall(e, ED.PREV_HIDDEN)).toBe(206) // Ed_NotDone
    e.editor.posHidden = 5
    edCall(e, ED.PREV_HIDDEN)
    expect(e.editor.posHidden).toBe(0)
  })

  it('lets Next run past the end, and the rebuild is what pulls it back', () => {
    const e = open()
    for (let i = 0; i < 14; i++) {
      const w = new Edit(ProgramBuffer.create(1024), new EditBuffer(0), new UndoBuffer(50), table, {}, e.editor)
      w.hidden = 2
    }
    edCall(e, ED.NEXT_HIDDEN)
    edCall(e, ED.NEXT_HIDDEN)
    expect(e.editor.posHidden).toBe(2) // 14 - 12, not 22
  })

  it('says an unassigned menu option does nothing', () => {
    const e = open()
    shown = null
    edCall(e, ED.USER_MENU)
    expect(shown!.which).toBe(44) // EdD_MnUs
  })

  it('gives 45 of the 46 Ed_UserMenu slots that same body', () => {
    const slots = ED_ROUTINES.map((n, i) => (n === 'Ed_UserMenu' ? i + 1 : 0)).filter(Boolean)
    expect(slots.length).toBe(46)
    expect(slots[0]).toBe(27)
    for (const n of slots) {
      if (n === 184) continue
      const e = open()
      shown = null
      edCall(e, n)
      expect([n, shown!.which]).toEqual([n, 44])
    }
  })

  it('cannot reach the 46th, because 184 is where the hidden programs start', () => {
    // `cmp.w #HiddenCommands-1,d2 / bcs.s .Fonc` (:2596) with d2 one less than
    // the command: 184 fails the test and is decoded as a hidden-program
    // command instead, so the last `Ed_UserMenu` entry of `JFonc` is assembled
    // and unreachable
    expect(ED_ROUTINES[183]).toBe('Ed_UserMenu')
    const e = open()
    expect(() => edCall(e, 184)).toThrow(/Ed_RunHidden/)
  })

  it('sends F5 to command 27, which is a user slot and not a Help routine', () => {
    const e = open()
    expect(ED_ROUTINES[26]).toBe('Ed_UserMenu')
    shown = null
    edCall(e, ED.GO_HELP)
    expect(shown!.which).toBe(44)
  })

  it('toggles the key shortcuts and the sounds', () => {
    const e = open()
    const keys = e.editor.config.menuKeys
    edCall(e, ED.SHOW_KEY)
    expect(e.editor.config.menuKeys).toBe(!keys)
    const sounds = e.editor.config.sounds
    edCall(e, ED.SOUND_ON)
    expect(e.editor.config.sounds).toBe(!sounds)
    // only one of the two is worth saving, and it is not the one the menu draws
    expect(e.editor.configChanged).toBe(1)
  })
})
