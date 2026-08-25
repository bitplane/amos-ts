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
import { ED, edCall, typeChar } from './commands'
import {
  EMPTY_BANKS,
  H_13,
  H_BLOCK,
  H_PRO,
  PRG,
  bakName,
  fileName,
  programSource,
  readProgramFile,
  writeProgramFile,
} from './files'
import type { Confirm, DialogueAnswer, EditorDialogues, SearchDialogue } from './search'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)
const PROG = 'Print "one"\nPrint "two"'
const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)
const str = (b: Uint8Array): string => String.fromCharCode(...b)

function open(text = PROG, rows = 8): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text)), new EditBuffer(rows), new UndoBuffer(50), table)
  e.fill()
  e.fs = new AmigaFS()
  ;(e.fs as AmigaFS).mountMemory('RAM')
  return e
}

const listing = (e: Edit): string[] =>
  Array.from({ length: e.prog.lineCount }, (_, i) => detokLineBytes(e.prog.bytes, e.prog.findLine(i).at, table))

const vol = (e: Edit): AmigaFS => e.fs as AmigaFS

/** a requester that answers everything the way this test says */
const requester = (
  confirm: (c: Confirm) => number = () => 1,
  select: (which: number, name: string) => string | null = (_w, name) => name,
  pressKey: (which: number) => number = () => 0,
): EditorDialogues => ({
  ask: (d: SearchDialogue): DialogueAnswer => ({ ...d, ok: true }),
  confirm,
  select,
  pressKey,
  pickWindow: () => 0,
  value: () => 0,
})

describe('the header', () => {
  it('is two constants, laid out so byte 11 is the same in both', () => {
    expect(H_13.length).toBe(16)
    expect(H_PRO.length).toBe(16)
    expect(H_13[11]).toBe('v')
    expect(H_PRO[11]).toBe('v')
  })

  it('compares ten bytes for 1.3 and eight for Pro, so the rest is decoration', () => {
    const body = ascii('\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0')
    for (const sig of ['AMOS Pro   V1.00', 'AMOS ProEd.v    ', 'AMOS Pro111v\0\0\0\0']) {
      const f = readProgramFile(new Uint8Array([...ascii(sig), ...body]))
      expect(f.error).toBe(PRG.OK)
      expect(f.file!.pro).toBe(true)
    }
    const old = readProgramFile(new Uint8Array([...ascii('AMOS Basic V1.3 '), ...body]))
    expect(old.error).toBe(PRG.OK)
    expect(old.file!.pro).toBe(false)
  })

  it('refuses anything else', () => {
    const f = readProgramFile(new Uint8Array([...ascii('FORM\0\0\0\0ILBMBMHD'), ...ascii('\0\0\0\0')]))
    expect(f.error).toBe(PRG.NOT_AMOS)
  })

  it('takes the maths flags off byte 15, and only from a Pro header', () => {
    const head = [...ascii(H_PRO)]
    head[15] = 3
    const f = readProgramFile(new Uint8Array([...head, 0, 0, 0, 0]))
    expect(f.file!.mathFlags).toBe(3)
    const old = [...ascii(H_13)]
    old[15] = 3
    expect(readProgramFile(new Uint8Array([...old, 0, 0, 0, 0])).file!.mathFlags).toBe(0)
  })

  it('writes the version it was built with, not the one it read', () => {
    // `lea H_Pro(pc),a0` -- Prg_Save writes the constant, so a 1.11 file
    // comes back out of a 1.01 editor saying 1.01
    const body = ascii('\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0')
    const f = readProgramFile(new Uint8Array([...ascii('AMOS Pro111v\0\0\0\0'), ...body])).file!
    expect(str(writeProgramFile(f).subarray(0, 12))).toBe('AMOS Pro101v')
  })

  it('says V for tested and v for not, and nothing ever reads it back', () => {
    const src = new Uint8Array(0)
    const yes = writeProgramFile({ pro: true, mathFlags: 0, tested: true, source: src, banks: EMPTY_BANKS })
    const no = writeProgramFile({ pro: true, mathFlags: 0, tested: false, source: src, banks: EMPTY_BANKS })
    expect(yes[11]).toBe(0x56)
    expect(no[11]).toBe(0x76)
    expect(readProgramFile(yes).file!.tested).toBe(true)
  })
})

describe('the body', () => {
  it('stops at the first zero-length line, so the terminator is not saved', () => {
    const e = open()
    const src = programSource(e.prog)
    expect(src.length).toBe(e.prog.stHaut - 2 - e.prog.stBas)
    expect(str(writeProgramFile({ pro: true, mathFlags: 0, tested: false, source: src, banks: EMPTY_BANKS }))
      .slice(20)
      .slice(-6)).toBe('AmBs\0\0')
  })

  it('always carries a bank list, even when there are no banks', () => {
    // `Bnk.SaveAll` writes the AmBs hunk name and a count word before it
    // counts anything, so the six bytes are on every program AMOS saves
    expect(str(EMPTY_BANKS)).toBe('AmBs\0\0')
  })

  it('keeps whatever followed the source, unread', () => {
    const banks = ascii('AmBs\0\x01whatever')
    const file = writeProgramFile({ pro: true, mathFlags: 0, tested: false, source: ascii('ab'), banks })
    expect(str(readProgramFile(file).file!.banks)).toBe(str(banks))
  })
})

describe('the backup name', () => {
  it('replaces from the last dot', () => {
    expect(bakName('DH0:Games/DEMO.AMOS')).toBe('DH0:Games/DEMO.Bak')
    expect(bakName('A.B.C')).toBe('A.B.Bak')
  })

  it('appends when there is no dot to find', () => {
    expect(bakName('RAM:DEMO')).toBe('RAM:DEMO.Bak')
  })

  it('never tests the first character, so a name that is all extension keeps it', () => {
    // `.Bak2` exits on `cmp.l Name2(a5),a0 / ble.s .Bak3` before it looks
    expect(bakName('.AMOS')).toBe('.AMOS.Bak')
  })
})

describe('the file name', () => {
  it('is what follows the last slash or colon', () => {
    expect(fileName('DH0:Games/Sub/DEMO.AMOS')).toBe('DEMO.AMOS')
    expect(fileName('RAM:DEMO.AMOS')).toBe('DEMO.AMOS')
    expect(fileName('DEMO.AMOS')).toBe('DEMO.AMOS')
  })
})

describe('Save', () => {
  it('writes the file and takes its name', () => {
    const e = open()
    e.name1 = 'RAM:X.AMOS'
    expect(edCall(e, ED.SAVE)).toBe(0)
    expect(e.prog.name).toBe('RAM:X.AMOS')
    expect(e.prog.changed).toBe(false)
    expect(str(vol(e).readFile('RAM:X.AMOS')!.subarray(0, 10))).toBe('AMOS Basic')
  })

  it('renames the old file to .Bak before writing over it', () => {
    const e = open()
    e.name1 = 'RAM:X.AMOS'
    edCall(e, ED.SAVE)
    const first = vol(e).readFile('RAM:X.AMOS')!.length
    e.xCu = 10
    typeChar(e, '!')
    e.tokCur()
    expect(listing(e)[0]).toBe('Print "one!"')
    expect(edCall(e, ED.SAVE)).toBe(0)
    // the .Bak is the program as it was, and the file is the program as it is
    expect(vol(e).readFile('RAM:X.Bak')!.length).toBe(first)
    expect(str(vol(e).readFile('RAM:X.Bak')!)).not.toBe(str(vol(e).readFile('RAM:X.AMOS')!))
  })

  it('deletes a .Bak that is already there and tries again', () => {
    // `.Bak5`: error 203 is the one failure it fixes rather than reports
    const e = open()
    e.name1 = 'RAM:X.AMOS'
    edCall(e, ED.SAVE)
    vol(e).writeFile('RAM:X.Bak', ascii('old'))
    e.prog.changed = true
    expect(edCall(e, ED.SAVE)).toBe(0)
    expect(vol(e).readFile('RAM:X.Bak')!.length).toBeGreaterThan(3)
  })

  it('leaves the program untested, so saving twice writes V then v', () => {
    // `move.b #1,Prg_StModif(a6)` sits AFTER the save, with "force le
    // menage" beside it, and the header has already gone down
    const e = open()
    e.prog.modified = false
    e.name1 = 'RAM:X.AMOS'
    edCall(e, ED.SAVE)
    expect(vol(e).readFile('RAM:X.AMOS')![11]).toBe(0x56) // V
    expect(e.prog.modified).toBe(true)
    edCall(e, ED.SAVE)
    expect(vol(e).readFile('RAM:X.AMOS')![11]).toBe(0x76) // v
  })

  it('asks for a name only when the program has none', () => {
    const e = open()
    const asked: number[] = []
    e.dialogues = requester(() => 1, (which) => {
      asked.push(which)
      return 'RAM:PICKED.AMOS'
    })
    expect(edCall(e, ED.SAVE)).toBe(0)
    expect(asked).toEqual([74])
    expect(edCall(e, ED.SAVE)).toBe(0)
    expect(asked).toEqual([74]) // the second one used the name it was given
    expect(edCall(e, ED.SAVE_AS)).toBe(0)
    expect(asked).toEqual([74, 74]) // Save As always asks
  })

  it('says Not done when the selector is cancelled', () => {
    const e = open()
    e.dialogues = requester(() => 1, () => null)
    expect(edCall(e, ED.SAVE)).toBe(206)
  })

  it('raises a disc error rather than pretending when there is no filesystem', () => {
    const e = open()
    e.fs = null
    e.name1 = 'RAM:X.AMOS'
    expect(edCall(e, ED.SAVE)).toBe(0)
    expect(e.diskError).toBe(0)
    expect(e.prog.name).toBe('')
  })

  it('keeps the program name when Save As Name writes somewhere else', () => {
    // Ed_SaveAsName stacks Prg_NamePrg over the save, because Prg_Save
    // overwrites it with Name1
    const e = open()
    e.name1 = 'RAM:REAL.AMOS'
    edCall(e, ED.SAVE)
    e.name1 = 'RAM:SHELL.AMOS'
    expect(edCall(e, ED.SAVE_AS_NAME)).toBe(0)
    expect(e.prog.name).toBe('RAM:REAL.AMOS')
    expect(vol(e).exists('RAM:SHELL.AMOS')).toBe('file')
    expect(vol(e).exists('RAM:SHELL.Bak')).toBe(null) // no backup either
  })
})

describe('Load', () => {
  it('reads the program back, with its name and its header', () => {
    const e = open()
    e.name1 = 'RAM:X.AMOS'
    edCall(e, ED.SAVE)
    edCall(e, ED.NEW)
    expect(e.prog.lineCount).toBe(0)
    e.name1 = 'RAM:X.AMOS'
    expect(edCall(e, ED.LOAD)).toBe(0)
    expect(listing(e)).toEqual(PROG.split('\n'))
    expect(e.prog.name).toBe('RAM:X.AMOS')
  })

  it('comes back untested however the file was marked', () => {
    // EdLok: `move.b #1,Prg_StModif(a6)`, "force le test"
    const e = open()
    e.prog.modified = false
    e.name1 = 'RAM:X.AMOS'
    edCall(e, ED.SAVE)
    e.prog.modified = false
    edCall(e, ED.LOAD)
    expect(e.prog.modified).toBe(true)
  })

  it('says Not an AMOS program', () => {
    const e = open()
    vol(e).writeFile('RAM:X.AMOS', ascii('FORM\0\0\0\0ILBMBMHD\0\0\0\0'))
    e.name1 = 'RAM:X.AMOS'
    expect(edCall(e, ED.LOAD)).toBe(207)
  })

  it('grows the buffer when the file will not fit, and asks first', () => {
    const e = open()
    e.name1 = 'RAM:X.AMOS'
    edCall(e, ED.SAVE)
    // a buffer that holds the program exactly is still too small: the test
    // is `cmp.l Prg_StTTexte(a6),d1 / blt .CBon`, and `.Load` then asks for
    // 256 bytes more than the file whatever happens
    e.prog = ProgramBuffer.create(programSource(e.prog).length)
    const asked: number[] = []
    e.dialogues = requester((c) => {
      asked.push(c.which)
      return 1
    })
    expect(edCall(e, ED.LOAD)).toBe(0)
    expect(asked).toContain(37) // EdD_TooSmall
    expect(listing(e)).toEqual(PROG.split('\n'))
  })

  it('offers to save a changed program first, and takes No for an answer', () => {
    const e = open()
    e.name1 = 'RAM:X.AMOS'
    edCall(e, ED.SAVE)
    e.prog.changed = true
    const asked: number[] = []
    e.dialogues = requester((c) => {
      asked.push(c.which)
      return c.which === 11 ? 2 : 1
    })
    expect(edCall(e, ED.LOAD)).toBe(0)
    expect(asked[0]).toBe(11) // EdD_Saved
  })

  it('abandons the load on anything that is not Yes or No', () => {
    // `cmp.w #2,d0 / beq .Skip` then `cmp.w #1,d0 / bne Ed_NotDone2`
    const e = open()
    e.prog.changed = true
    e.dialogues = requester((c) => (c.which === 11 ? 0 : 1))
    expect(edCall(e, ED.LOAD)).toBe(206)
  })
})

describe('New', () => {
  it('empties the program and keeps the clipboard', () => {
    // Ed_Block is in a5 and Edt_New only clears a4, so a block survives a New
    const e = open()
    e.yBloc = 0
    e.xBloc = 0
    e.yCu = 1
    e.xCu = 5
    expect(edCall(e, ED.BLOCK_STORE)).toBe(7)
    expect(edCall(e, ED.NEW)).toBe(0)
    expect(e.prog.lineCount).toBe(0)
    expect(e.prog.name).toBe('')
    expect(e.block.empty).toBe(false)
  })

  it('leaves the 1.3 verdict behind, because Prg_New does not clear it', () => {
    // `Prg_Not1.3` is written by the Test pass and by nothing else, so an
    // empty program is saved with whatever the last one turned out to be
    const e = open()
    e.prog.pro = true
    edCall(e, ED.NEW)
    expect(e.prog.pro).toBe(true)
    expect(e.prog.mathFlags).toBe(0) // this one IS cleared
    e.name1 = 'RAM:EMPTY.AMOS'
    edCall(e, ED.SAVE)
    expect(str(vol(e).readFile('RAM:EMPTY.AMOS')!.subarray(0, 8))).toBe('AMOS Pro')
  })
})

describe('Merge Ascii', () => {
  it('tokenises each line and inserts it at the cursor', () => {
    const e = open()
    vol(e).writeFile('RAM:T.ASC', ascii('Cls\nPrint "x"\n'))
    e.name1 = 'RAM:T.ASC'
    e.yCu = 1
    expect(edCall(e, ED.MERGE_ASCII)).toBe(0)
    expect(listing(e)).toEqual(['Print "one"', 'Cls ', 'Print "x"', 'Print "two"'])
  })

  it('keeps a blank line written CRLF and loses one written LF', () => {
    // `.Fin2` steps over ONE more byte when that byte is also below space,
    // and does not ask which byte it is. After a CRLF the step lands on the
    // second CR and a blank line survives; after a bare LF it eats the
    // second LF and the blank line is gone. The same two instructions
    const e = open('Print "one"')
    vol(e).writeFile('RAM:T.ASC', ascii('Cls\r\n\r\nPrint "x"'))
    e.name1 = 'RAM:T.ASC'
    expect(edCall(e, ED.MERGE_ASCII)).toBe(0)
    expect(listing(e)).toEqual(['Cls ', '', 'Print "x"', 'Print "one"'])

    const f = open('Print "one"')
    vol(f).writeFile('RAM:T.ASC', ascii('Cls\n\nPrint "x"'))
    f.name1 = 'RAM:T.ASC'
    expect(edCall(f, ED.MERGE_ASCII)).toBe(0)
    expect(listing(f)).toEqual(['Cls ', 'Print "x"', 'Print "one"'])
  })

  it('turns a tab into a space', () => {
    const e = open('Print "one"')
    vol(e).writeFile('RAM:T.ASC', ascii('\tCls\n'))
    e.name1 = 'RAM:T.ASC'
    expect(edCall(e, ED.MERGE_ASCII)).toBe(0)
    expect(listing(e)[0]).toBe(' Cls ')
  })

  it('DEFECT: calls a stray control character Line too long', () => {
    // `.Bad` and `.Long` are two labels on one instruction (:13584)
    const e = open('Print "one"')
    vol(e).writeFile('RAM:T.ASC', ascii('Cls\x07\n'))
    e.name1 = 'RAM:T.ASC'
    expect(edCall(e, ED.MERGE_ASCII)).toBe(199)
  })

  it('refuses a line of 250 characters', () => {
    const e = open('Print "one"')
    vol(e).writeFile('RAM:T.ASC', ascii('Rem ' + 'x'.repeat(246) + '\n'))
    e.name1 = 'RAM:T.ASC'
    expect(edCall(e, ED.MERGE_ASCII)).toBe(199)
  })

  it('stops on Ctrl-C and keeps what it had done', () => {
    const e = open('Print "one"')
    vol(e).writeFile('RAM:T.ASC', ascii('Cls\nCls\n'))
    e.name1 = 'RAM:T.ASC'
    e.abort = true
    expect(edCall(e, ED.MERGE_ASCII)).toBe(0)
    expect(listing(e)).toEqual(['Print "one"'])
  })
})

describe('Save Block', () => {
  it('writes it as a program under its own header', () => {
    const e = open()
    e.yBloc = 0
    e.xBloc = 0
    e.yCu = 1
    e.xCu = 11
    edCall(e, ED.BLOCK_STORE)
    e.name1 = 'RAM:B.AMOS'
    expect(edCall(e, ED.BLOCK_SAVE)).toBe(0)
    const f = vol(e).readFile('RAM:B.AMOS')!
    expect(str(f.subarray(0, 16))).toBe(H_BLOCK)
    // and it loads, because Prg_Load only compares the first eight bytes
    e.name1 = 'RAM:B.AMOS'
    expect(edCall(e, ED.LOAD)).toBe(0)
    expect(listing(e)).toEqual(PROG.split('\n'))
  })

  it('asks before writing over a file that is there', () => {
    const e = open()
    e.yBloc = 0
    e.xBloc = 0
    e.yCu = 1
    e.xCu = 11
    edCall(e, ED.BLOCK_STORE)
    vol(e).writeFile('RAM:B.AMOS', ascii('older'))
    e.name1 = 'RAM:B.AMOS'
    const asked: number[] = []
    e.dialogues = requester((c) => {
      asked.push(c.which)
      return 0 // Cancel
    })
    expect(edCall(e, ED.BLOCK_SAVE)).toBe(206)
    expect(asked).toEqual([47]) // EdD_AExist
    expect(str(vol(e).readFile('RAM:B.AMOS')!)).toBe('older')
  })

  it('says What block when there is none', () => {
    const e = open()
    expect(edCall(e, ED.BLOCK_SAVE)).toBe(6)
    expect(edCall(e, ED.BLOCK_SAVE_ASCII)).toBe(6)
  })
})

describe('Save Block as Ascii', () => {
  it('ends every line with a linefeed, the last one included', () => {
    // the 10 is poked past the text and counted in, rather than written
    // between one line and the next
    const e = open('Print "one"\nPrint "two"\nPrint "three"')
    e.yBloc = 0
    e.xBloc = 0
    e.yCu = 2
    e.xCu = 13
    edCall(e, ED.BLOCK_STORE)
    e.name1 = 'RAM:B.ASC'
    expect(edCall(e, ED.BLOCK_SAVE_ASCII)).toBe(0)
    expect(str(vol(e).readFile('RAM:B.ASC')!)).toBe('Print "one"\nPrint "two"\nPrint "three"\n')
  })

  it('writes no line at all for a record that holds nothing', () => {
    // `.1Vide` skips the length word and goes round again, so a block that
    // starts at the end of a line does not open with a blank one
    const e = open('Print "one"\nPrint "two"')
    e.yBloc = 0
    e.xBloc = 11
    e.yCu = 1
    e.xCu = 11
    edCall(e, ED.BLOCK_STORE)
    e.name1 = 'RAM:B.ASC'
    expect(edCall(e, ED.BLOCK_SAVE_ASCII)).toBe(0)
    expect(str(vol(e).readFile('RAM:B.ASC')!)).toBe('Print "two"\n')
  })
})
