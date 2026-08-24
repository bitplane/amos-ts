import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { detokLineBytes, tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { ED_MESSAGES } from '../runtime/edmessages.gen'
import { AmigaFS } from '../amiga/vfs'
import { corpusFile } from '../cli/corpus'
import { describeWith } from '../testing/fixture'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, edCall, edKey, edMacroStep, macroStop } from './commands'
import { statusLine } from './display'
import {
  MACRO_HEAD,
  findMacro,
  macroKey,
  macroKeys,
  newTape,
  packKey,
  readMacroFile,
  stopTape,
  tapeKey,
  unpackKey,
  writeMacroFile,
} from './macros'
import type { Confirm, DialogueAnswer, EditorDialogues, SearchDialogue } from './search'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)
const PROG = 'Print "one"\nPrint "two"\nPrint "three"\nPrint "four"'

function open(text = PROG, rows = 8): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text)), new EditBuffer(rows), new UndoBuffer(50), table)
  e.fill()
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  fs.assign('AMOSPro_System', 'RAM:')
  e.fs = fs
  return e
}

const listing = (e: Edit): string[] =>
  Array.from({ length: e.prog.lineCount }, (_, i) => detokLineBytes(e.prog.bytes, e.prog.findLine(i).at, table))

/** run a macro to its end, and answer how many keystrokes it had */
function play(e: Edit): number {
  let n = 0
  while (e.macroPlay !== null) {
    if (edMacroStep(e) === null) break
    n++
  }
  return n
}

const requester = (
  confirm: (c: Confirm) => number = () => 1,
  pressKey: (which: number) => number = () => 0,
): EditorDialogues => ({
  ask: (d: SearchDialogue): DialogueAnswer => ({ ...d, ok: true }),
  confirm,
  select: (_w, name) => name,
  pressKey,
})

/** record `keys` under `key`, and keep it */
function record(e: Edit, key: number, keys: { ch?: string; scan?: number; shift?: number }[]): number {
  e.lastKey = key
  edCall(e, ED.MACRO_NEW)
  for (const k of keys) edKey(e, k)
  return macroStop(e)
}

describe('a keystroke', () => {
  it('is the Inkey long, qualifiers first and ASCII last', () => {
    // the simulated Ctrl-C at :1579 is `move.l #$08330043,d1`
    expect(unpackKey(0x08330043)).toEqual({ shift: 0x08, scan: 0x33, ascii: 0x43 })
    expect(packKey({ shift: 0x08, scan: 0x33, ascii: 0x43 })).toBe(0x08330043)
  })

  it('goes into a macro as three bytes, ASCII first, with one thrown away', () => {
    const tape = newTape(0)
    tapeKey(tape, 0x08330043)
    expect([...tape.buf.subarray(4, 7)]).toEqual([0x43, 0x33, 0x08])
  })
})

describe('the tape', () => {
  it('counts 1 and then three a key, which is what EdMa_Tape holds', () => {
    const tape = newTape(0x00110022)
    expect(tape.at).toBe(1)
    tapeKey(tape, 1)
    tapeKey(tape, 2)
    expect(tape.at).toBe(7)
    expect(macroKey(stopTape(tape)!)).toBe(0x00110022)
  })

  it('takes 339 keys and then stops without saying so', () => {
    // `.2Big bra .EndMac`: the key still runs, it just is not recorded
    const tape = newTape(0)
    let taken = 0
    for (let i = 0; i < 400; i++) if (tapeKey(tape, 0x41)) taken++
    expect(taken).toBe(339)
    expect(tape.at).toBe(1 + 339 * 3)
  })

  it('leaves three zero bytes on the end of every macro it makes', () => {
    // `moveq #8,d0 / add.w d2,d0` asks for eight bytes past the key and five
    // are written
    const tape = newTape(0)
    tapeKey(tape, 0x41)
    tapeKey(tape, 0x42)
    const m = stopTape(tape)!
    expect(m.size).toBe(14)
    expect([...m.data]).toEqual([0, 0, 0, 0, 0x41, 0, 0, 0x42, 0, 0, 0xff, 0, 0, 0])
  })

  it('throws away a macro with no keys in it', () => {
    expect(stopTape(newTape(0x1234))).toBe(null)
  })
})

describe('the file', () => {
  it('is the linked list as it stood in memory, header and all', () => {
    const one = { size: 14, data: Uint8Array.from([0, 1, 0, 0, 9, 9, 9, 0xff, 0, 0, 0, 0, 0, 0]) }
    const out = writeMacroFile([one])
    expect(String.fromCharCode(...out.subarray(0, 4))).toBe(MACRO_HEAD)
    // `[next:4][size:4][payload]`, and eight zero bytes to end it
    expect([...out.subarray(4, 12)]).toEqual([0, 0, 0, 0, 0, 0, 0, 14])
    expect([...out.subarray(-8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(readMacroFile(out).list).toEqual([one])
  })

  it('says which way it failed', () => {
    expect(readMacroFile(Uint8Array.from([0x41, 0x70])).error).toBe(1)
    expect(readMacroFile(Uint8Array.from([0x46, 0x4f, 0x52, 0x4d, 0, 0, 0, 0])).error).toBe(2)
    // a size that runs past the end of the file is a short read
    const bad = writeMacroFile([{ size: 14, data: new Uint8Array(14) }]).subarray(0, 16)
    expect(readMacroFile(bad).error).toBe(1)
  })

  it('comes back in the other order, because Ed_ListeNew links at the front', () => {
    const a = { size: 12, data: Uint8Array.from([0, 0, 0, 1, 1, 1, 1, 0xff, 0, 0, 0, 0]) }
    const b = { size: 12, data: Uint8Array.from([0, 0, 0, 2, 2, 2, 2, 0xff, 0, 0, 0, 0]) }
    expect(readMacroFile(writeMacroFile([a, b])).list).toEqual([b, a])
  })
})

describeWith(
  'the macros AMOS Professional ships',
  corpusFile('9178a8fe39628920dcb6c261dcddfd3a918b844bcaf0489ac54a30a2a17cade0'),
  (path) => {
    const bytes = new Uint8Array(readFileSync(path))

    it('is two macros in 56 bytes', () => {
      const r = readMacroFile(bytes)
      expect(r.error).toBe(0)
      expect(r.list.length).toBe(2)
      expect(bytes.length).toBe(56)
    })

    it('puts Top of page and Bottom of page on two keys nothing else claims', () => {
      // `1e 4c 01` is ASCII $1e, rawkey $4c, left shift, which the key map
      // answers with Ed_HPage; `1f 4d 01` is Ed_BPage. Both twice over
      const [top, bottom] = readMacroFile(bytes).list
      expect(unpackKey(macroKey(top!))).toEqual({ shift: 0, scan: 0x7a, ascii: 0 })
      expect(unpackKey(macroKey(bottom!))).toEqual({ shift: 0, scan: 0x7b, ascii: 0 })
      expect([...macroKeys(top!)]).toEqual([0x1e, 0x4c, 1, 0x1e, 0x4c, 1, 0xff, 0, 0, 0])
      expect([...macroKeys(bottom!)]).toEqual([0x1f, 0x4d, 1, 0x1f, 0x4d, 1, 0xff, 0, 0, 0])
    })

    it('carries a live Amiga heap address the loader throws away', () => {
      // `move.l 4(a2),d3 / addq.l #8,d3` writes the whole node header out,
      // link and all. $4031B168 is where the first macro sat on the machine
      // the file was made on
      expect([...bytes.subarray(4, 8)]).toEqual([0x40, 0x31, 0xb1, 0x68])
      expect([...bytes.subarray(0x1a, 0x1e)]).toEqual([0, 0, 0, 0]) // and the last is null
    })

    it('comes back the same length, with the pointer gone and the pair swapped', () => {
      const out = writeMacroFile(readMacroFile(bytes).list)
      expect(out.length).toBe(bytes.length)
      const differ = [...out].map((v, i) => (v === bytes[i] ? -1 : i)).filter((i) => i >= 0)
      // four bytes of pointer, and the two records in the other order
      expect(differ.slice(0, 4)).toEqual([4, 5, 6, 7])
      expect(differ.length).toBe(14)
    })
  },
)

describe('recording', () => {
  it('keeps the keys and plays them back', () => {
    const e = open()
    expect(record(e, 0x00500000, [{ scan: 0x4d }, { scan: 0x4d }])).toBe(45) // Macro successfully recorded.
    expect(ED_MESSAGES[44]).toBe('Macro successfully recorded.')
    expect(e.macros.length).toBe(1)
    e.yCu = 0
    // `.UneMac` ends in `bra Ed_Key`, so the first keystroke runs at once
    expect(edKey(e, { scan: 0x50 })).toBe(0)
    expect(e.line).toBe(1)
    expect(play(e)).toBe(1)
    expect(e.line).toBe(2)
  })

  it('says Not done for a macro nobody typed anything into', () => {
    const e = open()
    e.lastKey = 0x00500000
    edCall(e, ED.MACRO_NEW)
    expect(macroStop(e)).toBe(206)
    expect(e.macros.length).toBe(0)
  })

  it('takes the whole status line while it runs', () => {
    const e = open()
    e.lastKey = 0x00500000
    edCall(e, ED.MACRO_NEW)
    expect(statusLine(e).trim()).toBe('Recording your macro. Click mouse button to end.')
    macroStop(e)
    e.alert = 0
    expect(statusLine(e).slice(0, 7)).toBe('Window-')
  })

  it('records typed characters as well as commands', () => {
    const e = open('Print "one"')
    record(e, 0x007a0000, [{ ch: 'X' }, { ch: 'Y' }])
    // the keys ran as they were recorded, which is the only way the tape
    // could see them
    expect(e.buf.text(0)).toBe('XYPrint "one"')
    e.buf.setText(0, 'Print "one"')
    e.xCu = 0
    e.edited = 0
    edKey(e, { scan: 0x7a })
    play(e)
    expect(e.buf.text(0)).toBe('XYPrint "one"')
  })

  it('rewinds over a command it will not record, and does not run it', () => {
    // `.NoMacro` (:2624): `subq.w #3,EdMa_Tape(a5)` then EdD_Macro3 and
    // `bra Ed_Loop`. Ed_Search's flag byte is %10000000, no macro bit
    const e = open()
    const asked: number[] = []
    e.dialogues = requester(
      (c) => {
        asked.push(c.which)
        return 1
      },
      () => 0x007a0000,
    )
    edCall(e, ED.MACRO_NEW)
    edKey(e, { scan: 0x4d })
    const was = e.macroTape!.at
    e.schBuf = 'one'
    expect(edKey(e, { ch: 'F', shift: 0xc0 })).toBe(0) // Amiga-F, Ed_Search
    expect(e.macroTape!.at).toBe(was) // the key is off the tape again
    expect([e.line, e.xCu]).toEqual([1, 0]) // and the search did not happen
    expect(asked).toContain(15) // EdD_Macro3
  })

  it('records a key that is itself a macro rather than expanding it', () => {
    // the tape arm ends in `bra .EndMac`, which steps over `.UneMac`
    const e = open()
    record(e, 0x007a0000, [{ scan: 0x4d }])
    record(e, 0x007b0000, [{ scan: 0x7a }, { scan: 0x7a }])
    const outer = findMacro(e.macros, 0x007b0000)!
    expect([...macroKeys(outer)].slice(0, 6)).toEqual([0, 0x7a, 0, 0, 0x7a, 0])
    // the first record moved the cursor down once. Had the two $7a presses
    // expanded, they would have moved it twice more
    expect(e.line).toBe(1)
  })

  it('does not expand a macro key that comes out of a macro either', () => {
    // playback jumps straight to `.EndMac`, so a macro can neither record
    // itself nor call another one
    const e = open()
    record(e, 0x007a0000, [{ scan: 0x4d }, { scan: 0x4d }])
    e.yCu = 0
    record(e, 0x007b0000, [{ scan: 0x7a }])
    e.yCu = 0
    edKey(e, { scan: 0x7b }) // runs the one key of the outer macro, which is $7a
    expect(play(e)).toBe(0)
    // rawkey $7a is not a key the map claims and its ASCII is zero, so
    // nothing happens at all
    expect(e.line).toBe(0)
    expect(listing(e)).toEqual(PROG.split('\n'))
  })

  it('DEFECT: a key whose ASCII is $FF ends the macro it is in', () => {
    // the terminator lives in the ASCII slot, and nothing keeps a real
    // keystroke out of it
    const e = open('Print "one"')
    record(e, 0x007a0000, [{ ch: '\xff' }, { ch: 'X' }])
    expect(e.buf.text(0)).toBe('\xffXPrint "one"') // both keys went in
    e.buf.setText(0, 'Print "one"')
    e.xCu = 0
    e.edited = 0
    edKey(e, { scan: 0x7a })
    expect(e.macroPlay).toBe(null)
    expect(e.buf.text(0)).toBe('Print "one"')
  })
})

describe('the macro commands', () => {
  it('asks before taking a key that already has a macro', () => {
    const e = open()
    record(e, 0x00500000, [{ scan: 0x4d }])
    const asked: number[] = []
    e.dialogues = requester((c) => {
      asked.push(c.which)
      return c.which === 14 ? 0 : 1
    }, () => 0x00500000)
    expect(edCall(e, ED.MACRO_NEW)).toBe(206) // Not done.
    expect(asked).toEqual([14]) // EdD_Macro2
    expect(e.macros.length).toBe(1)
  })

  it('deletes one, and says so when the key has none', () => {
    const e = open()
    record(e, 0x00500000, [{ scan: 0x4d }])
    const asked: number[] = []
    e.dialogues = requester((c) => {
      asked.push(c.which)
      return 1
    }, () => 0x00510000)
    expect(edCall(e, ED.MACRO_DEL)).toBe(0)
    expect(asked).toEqual([19]) // EdD_MacroNA, and not an alert
    expect(e.macros.length).toBe(1)
    e.lastKey = 0x00500000
    e.dialogues = null
    expect(edCall(e, ED.MACRO_DEL)).toBe(0)
    expect(e.macros.length).toBe(0)
  })

  it('says This is not a macro when there are none at all', () => {
    const e = open()
    const asked: number[] = []
    e.dialogues = requester((c) => {
      asked.push(c.which)
      return 1
    })
    expect(edCall(e, ED.MACRO_DEL)).toBe(0)
    expect(edCall(e, ED.MACRO_DEL_ALL)).toBe(0)
    expect(asked).toEqual([22, 22]) // EdD_MacroNo, twice
  })

  it('writes and reads the default file under the system path', () => {
    const e = open()
    record(e, 0x00500000, [{ scan: 0x4d }])
    expect(edCall(e, ED.MACRO_SAVE_DEFAULT)).toBe(0)
    expect(e.name1).toBe('AMOSPro_System:AMOSPro_Editor_Macros')
    e.macros = []
    expect(edCall(e, ED.MACRO_LOAD_DEFAULT)).toBe(0)
    expect(e.macros.length).toBe(1)
    expect(macroKey(e.macros[0]!)).toBe(0x00500000)
  })

  it('says This is not a macro file, without an alert', () => {
    const e = open()
    ;(e.fs as AmigaFS).writeFile('RAM:X', Uint8Array.from([0x46, 0x4f, 0x52, 0x4d, 0, 0, 0, 0]))
    e.name1 = 'RAM:X'
    const asked: number[] = []
    e.dialogues = requester((c) => {
      asked.push(c.which)
      return 1
    })
    expect(edCall(e, ED.MACRO_LOAD_AS)).toBe(0)
    expect(asked).toContain(23) // EdD_MacroPas
  })

  it('throws the old macros away before it opens the file, so a bad load loses them', () => {
    // `EdMa_Load` opens with `bsr EdMa_End`. The requester that asks about
    // it is one level up in `EdMa_LoadIt` and does not know what happens next
    const e = open()
    record(e, 0x00500000, [{ scan: 0x4d }])
    e.name1 = 'RAM:MISSING'
    expect(edCall(e, ED.MACRO_LOAD_AS)).toBe(0)
    expect(e.diskError).toBe(205)
    expect(e.macros.length).toBe(0)
  })
})

describe('the two change flags', () => {
  it('DEFECT: recording sets the one Quit does not read', () => {
    // `EdMa_Change` (+Equ.s:1713) is set by EdMa_Stop, EdMa_Del and
    // EdMa_DelAll. `Ed_DoQuit` (:4402) reads `EdMa_Changed` (+Equ.s:1704),
    // one letter away, so a macro recorded and not saved by hand is lost
    const e = open()
    record(e, 0x00500000, [{ scan: 0x4d }])
    expect(e.macroChange).toBe(true)
    expect(e.macroChanged).toBe(false)
  })

  it('and deleting sets it too, both of them', () => {
    const e = open()
    record(e, 0x00500000, [{ scan: 0x4d }])
    e.macroChange = false
    e.lastKey = 0x00500000
    edCall(e, ED.MACRO_DEL)
    expect(e.macroChange).toBe(true)
    expect(e.macroChanged).toBe(false)
  })

  it('only a Load As raises the flag that Quit acts on', () => {
    const e = open()
    record(e, 0x00500000, [{ scan: 0x4d }])
    edCall(e, ED.MACRO_SAVE_DEFAULT)
    e.name1 = 'AMOSPro_System:AMOSPro_Editor_Macros'
    expect(edCall(e, ED.MACRO_LOAD_AS)).toBe(0)
    expect(e.macroChanged).toBe(true)
    // and the default load puts it back down again
    expect(edCall(e, ED.MACRO_LOAD_DEFAULT)).toBe(0)
    expect(e.macroChanged).toBe(false)
  })
})
