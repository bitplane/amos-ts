import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { detokLineBytes, tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { AmigaFS } from '../amiga/vfs'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, drawWindows, edCall, warmStart } from './commands'
import { writeProgramFile } from './files'
import {
  AMOS_EXT,
  EDT_LONG,
  NEW_PROJECT,
  PRG_LONG,
  SESSION_HEAD,
  SESSION_NAME,
  readSession,
  writeSession,
} from './session'
import type { Confirm, DialogueAnswer, EditorDialogues, SearchDialogue } from './search'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)
const PROG = 'Print "one"\nPrint "two"\nPrint "three"'
const SYS = 'AMOSPro_System:'

function open(text = PROG): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text)), new EditBuffer(8), new UndoBuffer(50), table)
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  fs.mountMemory('AMOSPro_System')
  e.fs = fs
  e.dialogues = requester()
  drawWindows(e.editor)
  return e
}

const requester = (confirm: (c: Confirm) => number = () => 1): EditorDialogues => ({
  ask: (d: SearchDialogue): DialogueAnswer => ({ ...d, ok: true }),
  confirm,
  select: (_w, name) => name,
  pressKey: () => 0,
  pickWindow: () => 0,
  pickMenu: () => 0,
  text: () => '',
  flags: () => 0,
  value: () => 0,
})

const vol = (e: Edit): AmigaFS => e.fs as AmigaFS

/** a saved .AMOS of `text`, so a warm start has something to reload */
function put(e: Edit, name: string, text: string): void {
  vol(e).writeFile(
    name,
    writeProgramFile({
      pro: true,
      mathFlags: 0,
      tested: true,
      source: tested(text),
      banks: new Uint8Array(0),
    }),
  )
}

const u32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0

const listing = (e: Edit): string[] =>
  Array.from({ length: e.prog.lineCount }, (_, i) =>
    detokLineBytes(e.prog.bytes, e.prog.findLine(i).at, table),
  )

describe('the file', () => {
  it('opens with the header the loader checks, and the length after it', () => {
    const e = open()
    const file = writeSession(e.editor)
    expect(String.fromCharCode(...file.subarray(0, 4))).toBe(SESSION_HEAD)
    expect(u32(file, 4)).toBe(file.length - 8)
  })

  it('is one record per structure, and a zero long ends each list', () => {
    const e = open()
    const file = writeSession(e.editor)
    // 8 header, then [key][len][0] and 240 bytes, a zero, the same at 246, a zero
    expect(file.length).toBe(8 + (12 + PRG_LONG) + 4 + (12 + EDT_LONG) + 4)
    expect(u32(file, 8 + 4)).toBe(PRG_LONG)
    expect(u32(file, 8 + 12 + PRG_LONG)).toBe(0)
    expect(u32(file, 8 + 12 + PRG_LONG + 4 + 4)).toBe(EDT_LONG)
    expect(u32(file, file.length - 4)).toBe(0)
  })

  it('names the current window in Edt_Order, and nothing else', () => {
    const e = open()
    edCall(e, ED.OPEN_NEW)
    const windows = e.editor.list
    expect(windows.length).toBe(2)
    const s = readSession(writeSession(e.editor))!
    expect(s.current).toBe(windows.indexOf(e.editor.current!))
    expect(s.windows.filter((w) => w.order !== 0).length).toBe(1)
  })

  it('refuses a file that is not ApLC', () => {
    const e = open()
    const file = writeSession(e.editor)
    file[1] = 'X'.charCodeAt(0)
    expect(readSession(file)).toBe(null)
  })

  it('refuses a file cut short of the length in its own header', () => {
    const e = open()
    const file = writeSession(e.editor)
    expect(readSession(file.subarray(0, file.length - 1))).toBe(null)
  })

  it('carries every field back that the port keeps', () => {
    const e = open()
    e.xCu = 5
    e.yCu = 3
    e.xPos = 7
    e.yPos = 2
    e.xBloc = 4
    e.yBloc = 1
    e.yOldBloc = -1
    e.window = 8
    e.windOldTy = 6
    e.prog.name = 'RAM:one.AMOS'
    e.prog.changed = true
    e.prog.modified = false
    e.prog.pro = true
    e.prog.mathFlags = 3
    e.prog.marks[2] = 0x0004_ff09
    const s = readSession(writeSession(e.editor))!
    const w = s.windows[0]!
    expect([w.xCu, w.yCu, w.xPos, w.yPos]).toEqual([5, 3, 7, 2])
    expect([w.xBloc, w.yBloc, w.yOldBloc]).toEqual([4, 1, -1])
    expect([w.window, w.windTy, w.windOldTy]).toEqual([8, e.windTy, 6])
    const p = s.programs[0]!
    expect(p.name).toBe('RAM:one.AMOS')
    expect([p.changed, p.modified, p.pro, p.mathFlags]).toEqual([true, false, true, 3])
    expect(p.marks[2]).toBe(0x0004_ff09)
    expect(p.size).toBe(e.prog.bytes.length)
  })

  it('resolves the split chain by the addresses it invented', () => {
    const e = open()
    edCall(e, ED.SPLIT)
    const [a, b] = e.editor.list as [Edit, Edit]
    expect(b.linkPrev).toBe(a)
    const s = readSession(writeSession(e.editor))!
    expect(s.windows[1]!.linkPrev).toBe(0)
    expect(s.windows[0]!.linkNext).toBe(1)
    // one program, two views, and Prg_Edited counts the views
    expect(s.programs.length).toBe(1)
    expect(s.windows.map((w) => w.prog)).toEqual([0, 0])
    expect(s.programs[0]!.edited).toBe(2)
  })
})

describe('Prg_List', () => {
  it('is a list of programs where the window list is a list of views', () => {
    const e = open()
    expect(e.editor.programs).toEqual([e.prog])
    edCall(e, ED.SPLIT)
    expect(e.editor.list.length).toBe(2)
    expect(e.editor.programs.length).toBe(1)
    edCall(e, ED.OPEN_NEW)
    expect(e.editor.programs.length).toBe(2)
  })

  it('drops a program when the last window on it goes', () => {
    const e = open()
    edCall(e, ED.OPEN_NEW)
    const opened = e.editor.current!
    expect(e.editor.programs.length).toBe(2)
    edCall(opened, ED.CLOSE)
    expect(e.editor.programs).toEqual([e.prog])
  })
})

describe('Ed_DoQuit', () => {
  it('asks first when bit 0 is up, and does nothing on any other answer', () => {
    const e = open()
    e.editor.quitFlags = 1
    e.dialogues = requester(() => 2)
    edCall(e, ED.QUIT)
    expect(e.editor.quit).toBe(false)
    e.dialogues = requester(() => 1)
    edCall(e, ED.QUIT)
    expect(e.editor.quit).toBe(true)
  })

  it('offers each changed program in turn without bit 3', () => {
    const e = open()
    e.editor.quitFlags = 0
    e.prog.name = 'RAM:one.AMOS'
    e.prog.changed = true
    const asked: number[] = []
    e.dialogues = requester((c) => {
      asked.push(c.which)
      return 2 // "No", which is the one answer that saves nothing and goes on
    })
    edCall(e, ED.QUIT)
    expect(asked).toEqual([11]) // EdD_Saved
    expect(vol(e).readFile('RAM:one.AMOS')).toBe(null)
    expect(e.editor.quit).toBe(true)
  })

  it('abandons the quit when a program is neither saved nor abandoned', () => {
    const e = open()
    e.editor.quitFlags = 0
    e.prog.changed = true
    e.dialogues = requester(() => 3) // the close gadget: Ed_NotDone2
    edCall(e, ED.QUIT)
    expect(e.editor.quit).toBe(false)
  })

  it('writes the config and the macros only when they have been changed', () => {
    const e = open()
    e.editor.quitFlags = 2 | 4
    edCall(e, ED.QUIT)
    expect(vol(e).readFile(SYS + 'AMOSPro_Editor_Config')).toBe(null)
    e.editor.quit = false
    e.editor.configChanged = 1
    e.macroChanged = true
    edCall(e, ED.QUIT)
    expect(vol(e).readFile(SYS + 'AMOSPro_Editor_Config')).not.toBe(null)
    expect(vol(e).readFile(SYS + 'AMOSPro_Editor_Macros')).not.toBe(null)
  })
})

describe('bit 3, the whole session', () => {
  it('invents a name for a program that has none, and counts windows for it', () => {
    const e = open()
    e.editor.quitFlags = 8
    edCall(e, ED.QUIT)
    expect(vol(e).readFile(SYS + NEW_PROJECT + '1' + AMOS_EXT)).not.toBe(null)
    expect(e.prog.noNamed).toBe(1)
    expect(vol(e).readFile(SYS + SESSION_NAME)).not.toBe(null)
  })

  it('writes an unnamed program even when nothing has touched it', () => {
    const e = open()
    e.editor.quitFlags = 8
    e.prog.changed = false
    edCall(e, ED.QUIT)
    // `.NoName` is reached before Prg_Change is looked at
    expect(vol(e).readFile(SYS + NEW_PROJECT + '1' + AMOS_EXT)).not.toBe(null)
  })

  it('skips a named program that has not changed', () => {
    const e = open()
    e.editor.quitFlags = 8
    e.prog.name = 'RAM:kept.AMOS'
    e.prog.changed = false
    edCall(e, ED.QUIT)
    expect(vol(e).readFile('RAM:kept.AMOS')).toBe(null)
  })

  it('writes one file for a split, because the second half is skipped', () => {
    const e = open()
    e.editor.quitFlags = 8
    edCall(e, ED.SPLIT)
    edCall(e, ED.QUIT)
    expect(vol(e).readFile(SYS + NEW_PROJECT + '1' + AMOS_EXT)).not.toBe(null)
    expect(vol(e).readFile(SYS + NEW_PROJECT + '2' + AMOS_EXT)).toBe(null)
  })
})

describe('Ed_WarmStart', () => {
  it('answers false, and changes nothing, when there is no file', () => {
    const e = open()
    expect(warmStart(e)).toBe(false)
    expect(e.editor.list).toEqual([e])
  })

  it('puts the windows and the programs back where they were', () => {
    const e = open()
    put(e, 'RAM:one.AMOS', PROG)
    put(e, 'RAM:two.AMOS', 'Print "other"')
    e.prog.name = 'RAM:one.AMOS'
    edCall(e, ED.OPEN_NEW)
    const second = e.editor.current!
    second.prog.name = 'RAM:two.AMOS'
    second.yCu = 0
    e.yCu = 2
    e.editor.quitFlags = 8
    edCall(e, ED.QUIT)

    const boot = open()
    boot.fs = e.fs
    expect(warmStart(boot)).toBe(true)
    const list = boot.editor.list
    expect(list.length).toBe(2)
    expect(list.map((w) => w.prog.name)).toEqual(['RAM:one.AMOS', 'RAM:two.AMOS'])
    expect(boot.editor.current).toBe(list[1])
    expect(listing(list[0]!)).toEqual(['Print "one"', 'Print "two"', 'Print "three"'])
    // the program line, which is the pair and not either half: this window
    // came back one row tall, so `Ed_DrawWindows` scrolled what it could not
    // fit and moved the same cursor from row 2 to row 0 of line 2
    expect(list[0]!.yCu + list[0]!.yPos).toBe(2)
  })

  it('deletes the file it read, so a crash cannot restore twice', () => {
    const e = open()
    e.editor.quitFlags = 8
    edCall(e, ED.QUIT)
    const boot = open()
    boot.fs = e.fs
    expect(warmStart(boot)).toBe(true)
    expect(vol(boot).readFile(SYS + SESSION_NAME)).toBe(null)
  })

  it('takes an invented name off again, and deletes the file behind it', () => {
    const e = open()
    e.editor.quitFlags = 8
    edCall(e, ED.QUIT)
    const invented = SYS + NEW_PROJECT + '1' + AMOS_EXT
    expect(vol(e).readFile(invented)).not.toBe(null)

    const boot = open()
    boot.fs = e.fs
    expect(warmStart(boot)).toBe(true)
    const w = boot.editor.list[0]!
    expect(w.prog.name).toBe('')
    expect(w.prog.changed).toBe(true)
    expect(w.prog.noNamed).toBe(0)
    expect(vol(boot).readFile(invented)).toBe(null)
  })

  it('keeps the split chain across the quit', () => {
    const e = open()
    e.editor.quitFlags = 8
    edCall(e, ED.SPLIT)
    edCall(e, ED.QUIT)
    const boot = open()
    boot.fs = e.fs
    expect(warmStart(boot)).toBe(true)
    const [a, b] = boot.editor.list as [Edit, Edit]
    expect(b.linkPrev).toBe(a)
    expect(a.linkNext).toBe(b)
    expect(a.prog).toBe(b.prog)
    expect(boot.editor.programs.length).toBe(1)
  })

  it('throws the whole session away when one program will not load', () => {
    const e = open()
    e.editor.quitFlags = 8
    edCall(e, ED.QUIT)
    vol(e).deleteFile(SYS + NEW_PROJECT + '1' + AMOS_EXT)
    const boot = open()
    boot.fs = e.fs
    const asked: number[] = []
    boot.dialogues = requester((c) => {
      asked.push(c.which)
      return 1
    })
    expect(warmStart(boot)).toBe(false)
    expect(asked).toEqual([52]) // EdD_WarmErr
    expect(boot.editor.list.length).toBe(1)
    expect(boot.editor.programs.length).toBe(1)
    // one empty window, the way `Edt_OpWindow` leaves it, and not the session
    expect(boot.editor.list[0]!.prog.lineCount).toBe(0)
    expect(boot.editor.list[0]!.prog.name).toBe('')
  })
})
