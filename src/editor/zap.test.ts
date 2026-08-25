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
import { ED, FLAG, drawWindows, edCall, flagsOf } from './commands'
import { messages } from './config'
import { ZAP, ZAP_FUNCTIONS, zapCall, zapFunction, type ZapValue } from './zap'
import { ED_ROUTINES } from './keymap.gen'
import type { DialogueAnswer, EditorDialogues, SearchDialogue } from './search'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)
const PROG = 'Print "one"\nPrint "two"\nPrint "three"'

const requester = (button = 1): EditorDialogues => ({
  ask: (d: SearchDialogue): DialogueAnswer => ({ ...d, ok: true }),
  confirm: () => button,
  select: (_w, name) => name,
  pressKey: () => 0,
  pickWindow: () => 0,
  value: () => 0,
})

/**
 * The editor with an accessory driving it: one window being edited, a second
 * holding the accessory, and `Edt_Runned` on the second.
 */
function driven(text = PROG): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text), 4096), new EditBuffer(8), new UndoBuffer(50), table)
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  fs.mountMemory('AMOSPro_System')
  e.fs = fs
  e.dialogues = requester()
  drawWindows(e.editor)
  // the accessory's own window, which is not the one being edited
  const acc = new Edit(
    ProgramBuffer.create(1024),
    new EditBuffer(0),
    new UndoBuffer(50),
    table,
    {},
    e.editor,
  )
  acc.hidden = 2
  e.editor.runned = acc
  e.editor.current = e
  e.editor.accessory = true
  drawWindows(e.editor)
  return e
}

const listing = (e: Edit): string[] =>
  Array.from({ length: e.prog.lineCount }, (_, i) =>
    detokLineBytes(e.prog.bytes, e.prog.findLine(i).at, table),
  )

const value = (v: ZapValue | { error: number }): number => (v as ZapValue).value
const text = (v: ZapValue | { error: number }): string => (v as ZapValue).text

describe('who may drive', () => {
  it('refuses a program that is not an accessory', () => {
    const e = driven()
    e.editor.accessory = false
    expect(zapCall(e, ED.CUR_DOWN, 0, null)).toEqual({ error: -6, message: 15 })
    expect(zapFunction(e, ZAP.X)).toEqual({ error: -6, message: 15 })
  })

  it('refuses an accessory that is the current window', () => {
    const e = driven()
    e.editor.runned = e.editor.current
    expect(zapCall(e, ED.CUR_DOWN, 0, null)).toEqual({ error: -6, message: 15 })
  })

  it('refuses a command FlagFonc does not mark zappable', () => {
    const e = driven()
    expect(flagsOf(ED.QUIT) & FLAG.ZAP).toBe(0)
    expect(zapCall(e, ED.QUIT, 0, null)).toEqual({ error: -4, message: 13 })
    expect(e.editor.quit).toBe(false)
  })

  it('refuses an empty string as hard as no string', () => {
    const e = driven()
    expect(flagsOf(ED.RENAME) & FLAG.COMMAND).toBe(FLAG.COMMAND)
    expect(zapCall(e, ED.RENAME, 0, null)).toEqual({ error: -5, message: 14 })
    expect(zapCall(e, ED.RENAME, 0, '')).toEqual({ error: -5, message: 14 })
    expect(e.prog.name).toBe('')
  })

  it('marks 90 of the 184 zappable, and four of those needing a string', () => {
    const zap: number[] = []
    const needs: string[] = []
    for (let n = 1; n <= 184; n++) {
      const f = flagsOf(n)
      if ((f & FLAG.ZAP) === 0) continue
      zap.push(n)
      if ((f & FLAG.COMMAND) !== 0) needs.push(`${n}:${ED_ROUTINES[n - 1]}`)
    }
    expect(zap.length).toBe(90)
    expect(needs).toEqual([
      '152:Ed_SaveAsName',
      '153:Ed_CloseName',
      '154:Ed_Rename',
      '182:EdZ_NewConfig',
    ])
    // `Ed_RAlert` lives among the remote-control routines and is not one: an
    // accessory cannot put a message back on the status line
    expect(flagsOf(ED.RE_ALERT) & FLAG.ZAP).toBe(0)
  })
})

describe('Ed_Zappeuse', () => {
  it('makes a requester answer with the parameter instead of drawing', () => {
    const e = driven()
    let asked = 0
    e.dialogues = { ...requester(), confirm: () => (asked++, 1) }
    // Goto Line under the remote control reads Ed_ZapParam as the line
    expect(zapCall(e, ED.GOTO_LINE, 3, null)).toEqual({ error: 0, message: 0 })
    expect(asked).toBe(0)
    expect(e.line).toBe(2)
  })

  it('turns an alert into the answer, and leaves the saved one alone', () => {
    const e = driven()
    e.editor.alertSaved = 0
    // Top of text with the cursor already there: message 197, an alert that is
    // not an error
    const r = zapCall(e, ED.CUR_UP, 0, null)
    expect(r.error).toBe(-1)
    expect(r.message).toBeGreaterThan(0)
    expect(e.editor.alertSaved).toBe(0)
  })

  it('is put back to what the accessory had, not cleared', () => {
    const e = driven()
    expect(e.editor.zappeuse).toBe(false)
    zapCall(e, ED.CUR_DOWN, 0, null)
    expect(e.editor.zappeuse).toBe(false)
  })
})

describe('the eleven questions', () => {
  it('answers coordinates 1-based, because EdZ_Coo adds one to all of them', () => {
    const e = driven()
    e.xCu = 4
    e.yCu = 1
    e.yPos = 1
    expect(value(zapFunction(e, ZAP.X))).toBe(5)
    expect(value(zapFunction(e, ZAP.Y))).toBe(3)
  })

  it('answers the line count and the free space as they stand', () => {
    const e = driven()
    expect(value(zapFunction(e, ZAP.LINES))).toBe(3)
    expect(value(zapFunction(e, ZAP.FREE))).toBe(e.prog.stBas - e.prog.stMini)
  })

  it('detokenises the line the cursor is on when the parameter is not positive', () => {
    const e = driven()
    e.yCu = 1
    expect(text(zapFunction(e, ZAP.LINE, 0))).toBe('Print "two"')
    expect(text(zapFunction(e, ZAP.LINE, -1))).toBe('Print "two"')
  })

  it('takes a line number 1-based, and answers nothing past the end', () => {
    const e = driven()
    expect(text(zapFunction(e, ZAP.LINE, 1))).toBe('Print "one"')
    expect(text(zapFunction(e, ZAP.LINE, 3))).toBe('Print "three"')
    expect(text(zapFunction(e, ZAP.LINE, 4))).toBe('')
  })

  it('answers the program name, empty until it has one', () => {
    const e = driven()
    expect(text(zapFunction(e, ZAP.NAME))).toBe('')
    e.prog.name = 'RAM:one.AMOS'
    expect(text(zapFunction(e, ZAP.NAME))).toBe('RAM:one.AMOS')
  })

  it('orders the block corners, and answers -1 when there is no block', () => {
    const e = driven()
    expect(value(zapFunction(e, ZAP.BLOCK_X1))).toBe(-1)
    expect(value(zapFunction(e, ZAP.BLOCK_Y2))).toBe(-1)
    // the anchor below the cursor, so the two ends come back swapped
    e.yBloc = 2
    e.xBloc = 5
    e.yCu = 0
    e.xCu = 1
    expect(value(zapFunction(e, ZAP.BLOCK_X1))).toBe(2)
    expect(value(zapFunction(e, ZAP.BLOCK_Y1))).toBe(1)
    expect(value(zapFunction(e, ZAP.BLOCK_X2))).toBe(6)
    expect(value(zapFunction(e, ZAP.BLOCK_Y2))).toBe(3)
  })

  it('cannot reach EdZ_Token or EdZ_GetConfig', () => {
    const e = driven()
    expect(ZAP_FUNCTIONS).toBe(11)
    expect(zapFunction(e, ZAP.TOKENISE)).toEqual({ error: -7, message: 16 })
    expect(zapFunction(e, ZAP.CONFIG)).toEqual({ error: -7, message: 16 })
    expect(zapFunction(e, 0)).toEqual({ error: -7, message: 16 })
  })
})

describe('what the remote control writes', () => {
  it('replaces the line under the cursor with the string it was given', () => {
    const e = driven()
    e.yCu = 1
    expect(zapCall(e, ED.ZAP_NEW_LINE_TOK, 0, 'Print "other"')).toEqual({ error: 0, message: 0 })
    expect(listing(e)).toEqual(['Print "one"', 'Print "other"', 'Print "three"'])
  })

  it('leaves the line as text until something tokenises it', () => {
    const e = driven()
    zapCall(e, ED.ZAP_NEW_LINE, 0, 'Print "other"')
    expect(e.edited).toBeGreaterThan(0)
    expect(listing(e)[0]).toBe('Print "one"')
    e.tokCur()
    expect(listing(e)[0]).toBe('Print "other"')
  })

  it('renames the program without writing anything', () => {
    const e = driven()
    zapCall(e, ED.RENAME, 0, 'RAM:new.AMOS')
    expect(e.prog.name).toBe('RAM:new.AMOS')
    expect(e.prog.changed).toBe(true)
    expect((e.fs as AmigaFS).readFile('RAM:new.AMOS')).toBe(null)
  })

  it('puts the last alert back, at 150 rather than 100', () => {
    const e = driven()
    const alert = edCall(e, ED.CUR_UP) // Top of text, with the cursor on it
    expect(alert).toBeGreaterThan(0)
    edCall(e, ED.CUR_DOWN)
    expect(e.alert).toBe(0)
    edCall(e, ED.RE_ALERT)
    expect(e.alert).toBe(alert)
    expect(e.alertTime).toBe(150)
  })

  it('has nothing to put back before an alert has been raised', () => {
    const e = driven()
    e.editor.alertSaved = 0
    edCall(e, ED.RE_ALERT)
    expect(e.alert).toBe(0)
  })
})

describe('EdZ_NewConfig', () => {
  /** `Name1` is the message number as a long, then the text */
  const arg = (n: number, s: string): string =>
    String.fromCharCode((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff) + s

  it('replaces one message of the block the parameter names', () => {
    const e = driven()
    const block = e.editor.config.texts
    block.messages = Uint8Array.from([0, 3, 65, 66, 67, 0, 2, 68, 69, 0, 0xff])
    expect(messages(block.messages)).toEqual(['ABC', 'DE'])
    zapCall(e, ED.ZAP_NEW_CONFIG, 3, arg(2, 'Longer than it was'))
    expect(messages(e.editor.config.texts.messages)).toEqual(['ABC', 'Longer than it was'])
    expect(e.editor.configChanged).toBe(1)
  })

  it('refuses a message number past the end of the block', () => {
    const e = driven()
    e.editor.config.texts.messages = Uint8Array.from([0, 3, 65, 66, 67, 0, 0xff])
    zapCall(e, ED.ZAP_NEW_CONFIG, 3, arg(9, 'nowhere'))
    expect(messages(e.editor.config.texts.messages)).toEqual(['ABC'])
    // the two flags go up anyway
    expect(e.editor.configChanged).toBe(1)
  })

  it('cannot reach the last three blocks, which are loaded from the same file', () => {
    const e = driven()
    const was = Uint8Array.from([0, 3, 65, 66, 67, 0, 0xff])
    e.editor.config.texts.programs = Uint8Array.from(was)
    zapCall(e, ED.ZAP_NEW_CONFIG, 6, arg(1, 'changed'))
    expect(e.editor.config.texts.programs).toEqual(was)
  })
})
