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
import { Editor } from './windows'
import { FLAG_FONC, FLAG_FONC_PAST } from './keymap.gen'
import { ED, FLAG, drawWindows, edCall, flagsOf, linkScroll } from './commands'
import { writeProgramFile } from './files'
import type { Confirm, DialogueAnswer, EditorDialogues, SearchDialogue } from './search'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)
const PROG = 'Print "one"\nPrint "two"\nPrint "three"'

/** one window, drawn, which is the state the editor boots into */
function open(text = PROG, rows = 8): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text)), new EditBuffer(rows), new UndoBuffer(50), table)
  e.fs = new AmigaFS()
  ;(e.fs as AmigaFS).mountMemory('RAM')
  drawWindows(e.editor)
  return e
}

/**
 * Another window on the same editor, at the END of the list.
 *
 * A window links in after whichever one is current, so this puts the current
 * one at the tail first and then puts it back. What the machine does with the
 * list order is the test below.
 */
function extra(e: Edit, text = PROG, rows = 4): Edit {
  const ed = e.editor
  const was = ed.current
  ed.current = ed.list[ed.list.length - 1] ?? null
  const w = new Edit(ProgramBuffer.load(tested(text)), new EditBuffer(rows), new UndoBuffer(50), table, {}, ed)
  ed.current = was
  drawWindows(ed)
  return w
}

const listing = (e: Edit): string[] =>
  Array.from({ length: e.prog.lineCount }, (_, i) => detokLineBytes(e.prog.bytes, e.prog.findLine(i).at, table))

const vol = (e: Edit): AmigaFS => e.fs as AmigaFS

/** the window list, by identity: deep equality on an Edit is a circular walk */
function has(e: Edit, ...want: Edit[]): void {
  expect(e.editor.list.length).toBe(want.length)
  want.forEach((w, i) => expect(e.editor.list[i]).toBe(w))
}

const requester = (
  confirm: (c: Confirm) => number = () => 1,
  pickWindow: () => number = () => 0,
): EditorDialogues => ({
  ask: (d: SearchDialogue): DialogueAnswer => ({ ...d, ok: true }),
  confirm,
  select: (_w, name) => name,
  pressKey: () => 0,
  pickWindow,
  pickMenu: () => 0,
  text: () => '',
  flags: () => 0,
  value: () => 0,
})

/** a saved .AMOS of `text`, in RAM: */
function put(e: Edit, name: string, text: string): void {
  const src = tested(text)
  vol(e).writeFile(
    name,
    writeProgramFile({ pro: true, mathFlags: 0, tested: true, source: src, banks: new Uint8Array(0) }),
  )
}

describe('how many windows fit', () => {
  it('is read off the screen height and nothing else', () => {
    const ed = new Editor()
    // Ed_Ty (:394) is (Ed_Sy - 16) / 8 and Ed_WMax (:410) is (Ed_Ty - 6) / 3
    expect(ed.sy).toBe(256)
    expect(ed.ty).toBe(30)
    expect(ed.wMax).toBe(8)
  })

  it('gives a window on its own 28 rows, which is the screen less two bars', () => {
    const e = open()
    // 256 pixels, less the 16-pixel title bar, less this window's own 16
    expect(e.editor.maxSize(e, -1)).toBe(28)
  })

  it('refuses the ninth', () => {
    const e = open()
    for (let i = 0; i < 7; i++) expect(edCall(e.editor.current!, ED.OPEN_NEW)).toBe(0)
    expect(e.editor.count()).toBe(8)
    // Ed_2ManyWindow (:9859), message 3 held for 127 ticks
    expect(edCall(e.editor.current!, ED.OPEN_NEW)).toBe(3)
    expect(e.editor.current!.alertTime).toBe(127)
    expect(e.editor.count()).toBe(8)
  })

  it('shares the rows out as each one opens', () => {
    const e = open()
    edCall(e, ED.OPEN_NEW)
    // Edt_WSchrinkAll(1) takes the first window to one row, and the new one
    // gets what that leaves: 256 - 16 title - (16 + 8) - 16 = 200 pixels
    expect(e.windTy).toBe(1)
    expect(e.editor.current!.windTy).toBe(25)
  })
})

describe('the list', () => {
  it('links a new window after the current one, not at the end', () => {
    const e = open()
    edCall(e, ED.OPEN_NEW)
    const a = e.editor.current!
    e.editor.current = e
    edCall(e, ED.OPEN_NEW)
    const b = e.editor.current!
    // `move.l Edt_Next(a4),d0 / move.l a0,Edt_Next(a4)` (:11262), and a4 is
    // the current window: the second one opened goes between them
    has(e, e, b, a)
  })

  it('counts and walks only the windows with a screen area', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    const b = extra(e, 'Print "b"')
    a.hidden = 2
    expect(e.editor.count()).toBe(2)
    expect(e.editor.wNext(e)).toBe(b)
    expect(e.editor.wPrev(b)).toBe(e)
  })

  it('stops counting after the window it is asked about', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    extra(e, 'Print "b"')
    // `cmp.l d1,a0 / beq .Out` is BELOW the count, so a0 is included
    expect(e.editor.count(a)).toBe(2)
    expect(e.editor.count()).toBe(3)
  })

  it('names the top and the bottom, and both means alone', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    expect(e.first).toBe(true)
    expect(a.last).toBe(true)
    expect(e.editor.alone(e)).toBe(false)
    e.editor.delWindow(a)
    drawWindows(e.editor)
    expect(e.editor.alone(e)).toBe(true)
  })

  it('finds a window by the last part of its filename, without case', () => {
    const e = open()
    e.prog.name = 'Work:Games/Shoot.AMOS'
    const a = extra(e, 'Print "a"')
    a.prog.name = 'RAM:other.amos'
    expect(e.editor.accAdr('DF0:shoot.amos')).toBe(e)
    expect(e.editor.accAdr('OTHER.AMOS')).toBe(a)
    expect(e.editor.accAdr('nothing')).toBeNull()
  })
})

describe('Split View', () => {
  it('is two windows on one program', () => {
    const e = open()
    e.yCu = 2
    edCall(e, ED.SPLIT)
    const w = e.editor.current!
    expect(w).not.toBe(e)
    expect(w.prog).toBe(e.prog)
    expect(e.prog.edited).toBe(2)
    expect(w.linkPrev).toBe(e)
    expect(e.linkNext).toBe(w)
    // Edt_SSplit to Edt_ESplit, nine words of cursor state
    expect(w.yCu).toBe(2)
    expect(listing(w)).toEqual(listing(e))
  })

  it('throws the program away when the last view on it closes', () => {
    const e = open()
    edCall(e, ED.SPLIT)
    const w = e.editor.current!
    e.editor.delWindow(w)
    expect(e.prog.edited).toBe(1)
    e.editor.delWindow(e)
    expect(e.prog.edited).toBe(0)
  })

  it('hands the cursor to the other half when one half goes', () => {
    const e = open()
    edCall(e, ED.SPLIT)
    const w = e.editor.current!
    const other = extra(e, 'Print "elsewhere"')
    e.editor.current = w
    e.editor.delWindow(w)
    // `.Link` overrules the walk: Edt_LinkPrev wins over whatever Edt_WNext
    // found, so a split hands over to its own half and not to the neighbour
    expect(e.editor.current).toBe(e)
    expect(e.editor.current).not.toBe(other)
  })

  it('clears the marks and the undo of the program it splits', () => {
    const e = open()
    e.prog.setMark(0, 1, 0)
    e.xCu = 4
    e.pKey('!')
    e.tokCur()
    expect(e.prog.getMark(0)).not.toBeNull()
    edCall(e, ED.SPLIT)
    // DEFECT: Edt_New runs Prg_UndoCreate and Prg_MarkRaz on a6, and the
    // split path never wrote a6, so both land on the program being split
    expect(e.prog.getMark(0)).toBeNull()
    expect(e.undo.undo()).toBeNull()
  })
})

describe('Close', () => {
  it('leaves the last window alone without the quit word', () => {
    const e = open()
    e.editor.zappeuse = true
    expect(edCall(e, ED.CLOSE)).toBe(0)
    has(e, e)
    expect(e.editor.quit).toBe(false)
  })

  it('quits on the last window, and asks first when the flag says so', () => {
    const e = open()
    e.dialogues = requester(() => 2)
    e.editor.quitFlags = 1
    edCall(e, ED.CLOSE)
    expect(e.editor.quit).toBe(false)
    e.dialogues = requester(() => 1)
    edCall(e, ED.CLOSE)
    expect(e.editor.quit).toBe(true)
  })

  it('empties the program in a window that is not half of a split', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    e.editor.current = a
    edCall(a, ED.CLOSE)
    // EdClo's `bsr Ed_New` before `.Linked`
    expect(a.prog.lineCount).toBe(0)
    has(e, e)
  })

  it('does not empty a split half, because the program is still open', () => {
    const e = open()
    edCall(e, ED.SPLIT)
    const w = e.editor.current!
    edCall(w, ED.CLOSE)
    expect(e.prog.lineCount).toBe(3)
    has(e, e)
    expect(e.linkNext).toBeNull()
  })
})

describe('Hide Project', () => {
  it('refuses on the last window', () => {
    const e = open()
    // Ed_NoHide (:9866), "Cannot hide the last window."
    expect(edCall(e, ED.HIDE)).toBe(2)
    expect(e.hidden).toBe(0)
  })

  it('hides the window and gives its rows to another', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    expect(edCall(e, ED.HIDE)).toBe(0)
    expect(e.hidden).toBe(2)
    expect(e.editor.current).toBe(a)
    expect(a.windTy).toBe(28)
  })

  it('closes the other half of a split first', () => {
    const e = open()
    extra(e, 'Print "a"')
    e.editor.current = e
    edCall(e, ED.SPLIT)
    const w = e.editor.current!
    expect(edCall(w, ED.HIDE)).toBe(0)
    expect(e.editor.list.includes(e)).toBe(false)
    expect(w.hidden).toBe(2)
  })
})

describe('Next and Previous Window', () => {
  it('walk the open windows and come back round', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    edCall(e, ED.NEXT_WINDOW)
    expect(e.editor.current).toBe(a)
    edCall(a, ED.NEXT_WINDOW)
    expect(e.editor.current).toBe(e)
    edCall(e, ED.PREV_WINDOW)
    expect(e.editor.current).toBe(a)
  })

  it('wrap to an end of the LIST, so a hidden window can become current', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    const b = extra(e, 'Print "b"')
    has(e, e, a, b)
    // Hide Project leaves Edt_WindTy alone, so the hidden head still has rows
    e.hidden = 2
    drawWindows(e.editor)
    expect(e.windTy).toBe(8)
    edCall(b, ED.NEXT_WINDOW)
    // DEFECT: `move.l Edt_List(a5),a0` is the head, hidden or not, and
    // Edt_Active tests nothing but the height
    expect(e.editor.current).toBe(e)
    expect(e.editor.current!.hidden).toBe(2)
  })

  it('skip a window with no rows, because Edt_Active refuses it', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    const b = extra(e, 'Print "b"')
    a.windTy = 0
    edCall(e, ED.NEXT_WINDOW)
    expect(e.editor.current).toBe(b)
  })
})

describe('Enlarge Window', () => {
  it('rolls the window up and back out again', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    const was = e.windTy
    expect(edCall(e, ED.FLIP_SIZE)).toBe(0)
    expect(e.windTy).toBe(0)
    expect(e.windOldTy).toBe(was)
    expect(a.windTy).toBe(4 + was)
    expect(edCall(e, ED.FLIP_SIZE)).toBe(0)
    expect(e.windTy).toBe(was)
    expect(a.windTy).toBe(4)
  })

  it('does nothing to a window on its own', () => {
    const e = open()
    edCall(e, ED.FLIP_SIZE)
    expect(e.windTy).toBe(8)
  })
})

describe('Link Cursor', () => {
  it('makes another window follow this one, by the lines it moved', () => {
    const e = open('Print 1\nPrint 2\nPrint 3\nPrint 4\nPrint 5\nPrint 6\nPrint 7\nPrint 8')
    const a = extra(e, 'Print "a"\nPrint "b"\nPrint "c"\nPrint "d"\nPrint "e"')
    e.dialogues = requester(() => 1, () => a.window)
    expect(edCall(e, ED.LINK_CURSOR)).toBe(0)
    expect(e.linkScroll).toBe(a)
    e.yPos = 3
    linkScroll(e)
    expect(a.yPos).toBe(3)
  })

  it('is not done when the click misses a window', () => {
    const e = open()
    extra(e, 'Print "a"')
    e.dialogues = requester(() => 1, () => 0)
    expect(edCall(e, ED.LINK_CURSOR)).toBe(206)
    expect(e.linkScroll).toBeNull()
  })

  it('stops when the chain comes back round to where it started', () => {
    const e = open('Print 1\nPrint 2\nPrint 3\nPrint 4\nPrint 5')
    const a = extra(e, 'Print 1\nPrint 2\nPrint 3\nPrint 4\nPrint 5')
    e.linkScroll = a
    a.linkScroll = e
    e.yPos = 2
    linkScroll(e)
    // Edt_LinkFlag is raised on the mover and tested on the moved, so the
    // ring goes round once
    expect(a.yPos).toBe(2)
    expect(e.yPos).toBe(2)
  })
})

describe('the hidden windows', () => {
  it('are indexed among themselves and not in the list', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    const b = extra(e, 'Print "b"')
    a.hidden = 2
    b.hidden = 2
    expect(e.editor.getHidden(0)).toBe(a)
    expect(e.editor.getHidden(1)).toBe(b)
    expect(e.editor.getHidden(2)).toBeNull()
  })

  it('come back on the screen with Edit, one at a time', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    a.hidden = 2
    a.windTy = 0
    drawWindows(e.editor)
    expect(edCall(e, ED.EDIT_HIDDEN, 0)).toBe(0)
    expect(a.hidden).toBe(0)
    expect(e.editor.current).toBe(a)
    expect(a.windTy).toBe(25)
  })

  it('go away one at a time with New, and all at once with New All', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    const b = extra(e, 'Print "b"')
    a.hidden = 2
    b.hidden = 2
    expect(edCall(e, ED.NEW_HIDDEN, 1)).toBe(0)
    has(e, e, a)
    expect(edCall(e, ED.NEW_ALL_HIDDEN)).toBe(0)
    has(e, e)
  })

  it('are not touched when New All is answered with anything but Yes', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    a.hidden = 2
    e.dialogues = requester(() => 2)
    expect(edCall(e, ED.NEW_ALL_HIDDEN)).toBe(0)
    has(e, e, a)
  })

  it('say Not done when the index names none', () => {
    const e = open()
    expect(edCall(e, ED.EDIT_HIDDEN, 0)).toBe(206)
    expect(edCall(e, ED.NEW_HIDDEN, 0)).toBe(206)
  })
})

describe('the hidden-program menu numbers', () => {
  it('decode into Run, Edit and New with the program index', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    a.hidden = 2
    a.windTy = 0
    // 184 + 3n + action, and 185 is Edit the first hidden program
    expect(edCall(e, 185)).toBe(0)
    expect(a.hidden).toBe(0)
    expect(e.editor.current).toBe(a)
  })

  it('read their flag byte off the end of the table', () => {
    expect(FLAG_FONC.length).toBe(184)
    // 184 is the last real entry; everything above it is `Ed_Back`'s code
    expect(flagsOf(184)).toBe(0)
    expect(flagsOf(185)).toBe(0x4a)
    expect(flagsOf(186)).toBe(0x6c)
    expect(FLAG_FONC_PAST[0]).toBe(0x4a)
    // so New-the-first-hidden-program is refused on a closed procedure and
    // Edit is not, and the reason is the low byte of Edt_XCu's offset
    expect(flagsOf(186) & FLAG.CLOSED).not.toBe(0)
    expect(flagsOf(185) & FLAG.CLOSED).toBe(0)
  })
})

describe('Merge and Load Hidden', () => {
  it('are the same load, and differ in what happens to the window', () => {
    const e = open()
    put(e, 'RAM:other.AMOS', 'Print "merged"')
    e.name1 = 'RAM:other.AMOS'
    expect(edCall(e, ED.LOAD_HIDDEN)).toBe(0)
    expect(e.editor.list.length).toBe(2)
    expect(e.editor.list[1]!.hidden).toBe(2)
    expect(e.editor.windowToDel).toBeNull()
  })

  it('splice the file in at the cursor and throw the window away', () => {
    const e = open()
    put(e, 'RAM:other.AMOS', 'Print "merged"\nPrint "twice"')
    e.name1 = 'RAM:other.AMOS'
    e.yCu = 1
    expect(edCall(e, ED.MERGE)).toBe(0)
    expect(listing(e)).toEqual(['Print "one"', 'Print "merged"', 'Print "twice"', 'Print "two"', 'Print "three"'])
    // Ed_WindowToDel was left set, so Ed_Loop deleted the window on the way
    // back and the program that was read is gone
    has(e, e)
  })

  it('move the marks below the merge down by the lines it added', () => {
    const e = open()
    put(e, 'RAM:other.AMOS', 'Print "merged"')
    e.prog.setMark(0, 2, 0)
    e.name1 = 'RAM:other.AMOS'
    e.yCu = 1
    edCall(e, ED.MERGE)
    expect(e.prog.getMark(0)!.line).toBe(3)
  })
})

describe('Open + Load', () => {
  it('opens the window first and loads into it', () => {
    const e = open()
    put(e, 'RAM:next.AMOS', 'Print "loaded"')
    e.name1 = 'RAM:next.AMOS'
    expect(edCall(e, ED.OPEN_LOAD)).toBe(0)
    const w = e.editor.current!
    expect(w).not.toBe(e)
    expect(listing(w)).toEqual(['Print "loaded"'])
    expect(listing(e)).toEqual(['Print "one"', 'Print "two"', 'Print "three"'])
  })
})

describe('what a5 holds', () => {
  it('is one copy for every window, not one each', () => {
    const e = open()
    const a = extra(e, 'Print "a"')
    e.schBuf = 'needle'
    expect(a.schBuf).toBe('needle')
    a.insert = false
    expect(e.insert).toBe(false)
    expect(a.block).toBe(e.block)
  })
})
