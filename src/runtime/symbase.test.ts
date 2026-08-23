/**
 * SymBase 0.94 batch 2 — channels and navigation, over a real .dbf.
 *
 * Every case runs against `Book.dbf` where the fixture is present, and
 * against a small file built here where it is not, so the shapes are covered
 * either way and the artifact adds its own numbers on top.
 *
 * What is worth asserting about a database engine is the edges, and this one
 * has good ones: a channel IS an AMOS bank, so erasing the bank closes the
 * database; `Db Goto` flushes before it range-checks; `Db Recle` reports one
 * less than the file does; and `Db Goto Db Reccount+1` raises where the guide
 * promises an append.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
// `db append from`'s spec is `I0,`, a parameter list ending in a separator.
// `VerI` (+Verif.s:2989) only writes a separator when another argument
// follows and an omitted one still counts as `0`, so the string it builds can
// never end in a comma and the entry matches nothing. AMOS Pro cannot reach
// routine 80 either; this gets past the refusal to test what it does.
import { tokenize, tokenizeUnchecked } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { Runtime } from './runtime'
import { DBF_HEADER_LEN, DBF_TERMINATOR, writeDbf } from './dbf'
import { DB_BANK_BASE, DB_BANK_NAME, SYMBASE_ERRORS } from './symbase'

const table = new TokenTable(CORE_TOKENS)
/**
 * Slot 21, off routine 0's `move.l a3,$238(a5)` and `moveq #$14,d0`, and off
 * the archive's own Installer: *"The SymBase extension developed to use the
 * 21th extension slot."* Author's spelling kept.
 */
const symbase = extensionById('symbase-0.94')!
/** 0.42, whose routine 0 makes the same `move.l a3,$238(a5)` store */
const dbench = extensionById('dbench-0.42')!

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BOOK = join(root, 'fixtures', 'extensions', 'symbase-0.94', 'Book.dbf')
const book = existsSync(BOOK) ? new Uint8Array(readFileSync(BOOK)) : null

/** three C fields and four records, built the way writeDbf writes one */
function tiny(): Uint8Array {
  const fields = [
    { name: 'name', type: 'C', length: 8, decimals: 0, offset: 1 },
    { name: 'town', type: 'C', length: 6, decimals: 0, offset: 9 },
  ]
  const recordLength = 1 + 8 + 6
  const rows = ['Ada     London', 'Grace   Boston', 'Alan    Wilmslo', 'Edsger  Utrech']
  const records = rows.map((r) => {
    const b = new Uint8Array(recordLength).fill(0x20)
    for (let i = 0; i < recordLength - 1 && i < r.length; i++) b[i + 1] = r.charCodeAt(i)
    b[0] = 0x20
    return b
  })
  return writeDbf({
    date: [0, 0, 0],
    fields,
    headerLength: DBF_HEADER_LEN + fields.length * DBF_HEADER_LEN + 1,
    recordLength,
    records,
  })
}

let printed = ''

function boot(
  src: string[],
  files: Record<string, Uint8Array> = {},
  tok: typeof tokenize = tokenize,
): { rt: Runtime; fs: AmigaFS } {
  const exts = new Map([[21, symbase.table]])
  const fs = new AmigaFS()
  const vol = fs.mountMemory('Work')
  for (const [name, bytes] of Object.entries(files)) vol.write([name], bytes)
  fs.currentDir = 'Work:'
  printed = ''
  const rt = new Runtime(tok(src.join('\n'), table, exts), table, {
    extensions: exts,
    extBindings: new Map([[21, symbase]]),
    maxSteps: 500_000,
    onText: (t) => (printed += t),
    fs,
  })
  return { rt, fs }
}

function run(src: string[], files: Record<string, Uint8Array> = {}): { rt: Runtime; fs: AmigaFS } {
  const b = boot(src, files)
  mustFinish(b.rt.runHeadless(2000))
  return b
}

/** for the one keyword whose spec no argument list can match */
function runUnchecked(src: string[], files: Record<string, Uint8Array> = {}): void {
  mustFinish(boot(src, files, tokenizeUnchecked).rt.runHeadless(2000))
}

const out = (): string[] => printed.trim().split('\n').map((s) => s.trim())

const TINY = { 'a.dbf': tiny() }
const USE = 'Db Use "Work:a.dbf"'

describe('Db Use — routine 6', () => {
  it('opens a channel as an AMOS bank named Xbase, not the guide\'s Dbase', () => {
    // `L_Bnk_Reserve` takes the name at data+$94, which is "Xbase   ".
    // DBench's db_use node says "A work type memory bank with Dbase name"
    const { rt } = run([USE], TINY)
    const bank = rt.memBanks.get(DB_BANK_BASE + 1)
    expect(bank).toBeDefined()
    expect(bank!.name.trim()).toBe(DB_BANK_NAME)
  })

  it('the bank is the size routine 6 computes, to the byte', () => {
    // 128 head + (HeadLe and $fff0) + fields*16 + RecLe, rounded up to even
    const { rt } = run([USE], TINY)
    // two fields, HeadLe 97 -> masked 96, RecLe 15
    expect(rt.memBanks.get(DB_BANK_BASE + 1)!.data.length).toBe(128 + 96 + 2 * 16 + 15 + 1)
  })

  it('a second Db Use on the same channel is "Channel already used!"', () => {
    // `L_Bnk_GetAdr / Rbne routine 91`, message 0 --- not a reopen
    expect(() => run([USE, USE], TINY)).toThrow(SYMBASE_ERRORS[0])
  })

  it('two channels are two banks and two open counts', () => {
    const { rt } = run([USE, 'Db Select 2', USE, 'Print Db Opencount'], TINY)
    expect(out()).toEqual(['2'])
    expect(rt.memBanks.has(DB_BANK_BASE + 1)).toBe(true)
    expect(rt.memBanks.has(DB_BANK_BASE + 2)).toBe(true)
  })

  it('a file that is not $03 is "Not a Dbase file!"', () => {
    const bad = tiny()
    bad[0] = 0x83 // which DBench's guide allows and routine 6 does not
    expect(() => run([USE], { 'a.dbf': bad })).toThrow(SYMBASE_ERRORS[1])
  })

  it('leaves the record pointer on row one, and on zero for an empty file', () => {
    expect(run([USE, 'Print Db Recno'], TINY).rt && out()).toEqual(['1'])
    // `tst.l $10(a0) / bne` --- no records means DB_CurRec stays 0
    const empty = tiny()
    empty[4] = 0
    run([USE, 'Print Db Recno'], { 'a.dbf': empty })
    expect(out()).toEqual(['0'])
  })
})

describe('the channel is a bank, and that is the whole of Db State', () => {
  it('Db State asks AMOS, so erasing the bank closes the database', () => {
    // routine 19 is `L_Bnk_GetAdr` and a -1 or a 0, with no state of its own
    run([USE, 'Print Db State', `Erase ${DB_BANK_BASE + 1}`, 'Print Db State'], TINY)
    expect(out()).toEqual(['-1', '0'])
  })

  it('an unopened channel reads 0 and answers nothing else', () => {
    run(['Db Select 7', 'Print Db State', 'Print Db Sel'], TINY)
    expect(out()).toEqual(['0', '7'])
  })

  it('and every reader on an unopened channel raises "No database is used!"', () => {
    // routine 86 into routine 87, message 2
    for (const kw of ['Db Reccount', 'Db Recno', 'Db Recle', 'Db Fieldno']) {
      expect(() => run([`Print ${kw}`], TINY)).toThrow(SYMBASE_ERRORS[2])
    }
  })
})

describe('Db Select and its two scanners', () => {
  it('Db Select refuses zero and below, and has no upper bound', () => {
    expect(() => run(['Db Select 0'], TINY)).toThrow()
    expect(() => run(['Db Select -1'], TINY)).toThrow()
    run(['Db Select 64000', 'Print Db Sel'], TINY)
    expect(out()).toEqual(['64000'])
  })

  it('Db Select First finds the first channel in USE', () => {
    run(['Db Select 3', USE, 'Db Select 9', USE, 'Db Select 5', 'Db Select First', 'Print Db Sel'], TINY)
    expect(out()).toEqual(['3'])
  })

  it('Db Select First with nothing open raises rather than doing nothing', () => {
    // `cmpi.l #$0,$8(a2) / Rbeq routine 87`
    expect(() => run(['Db Select First'], TINY)).toThrow(SYMBASE_ERRORS[2])
  })

  it('Db Select Next finds the first channel NOT in use, scanning from 1', () => {
    // it always starts at 1, so a hole a close left is what it finds
    run([USE, 'Db Select 2', USE, 'Db Select Next', 'Print Db Sel'], TINY)
    expect(out()).toEqual(['3'])
    run([USE, 'Db Select 2', USE, 'Db Select 1', 'Db Close', 'Db Select Next', 'Print Db Sel'], TINY)
    expect(out()).toEqual(['1'])
  })
})

describe('Db Close — routine 7', () => {
  it('frees the bank and the count', () => {
    const { rt } = run([USE, 'Db Close', 'Print Db Opencount', 'Print Db State'], TINY)
    expect(out()).toEqual(['0', '0'])
    expect(rt.memBanks.has(DB_BANK_BASE + 1)).toBe(false)
  })

  it('on an unused channel it returns silently, whatever the guide says', () => {
    // `L_Bnk_GetAdr / beq $836 / rts`. DBench's db_close node lists
    // "No file is used!" as an error of this keyword and there is no such arm
    expect(() => run(['Db Close', 'Db Close'], TINY)).not.toThrow()
  })
})

describe('Db Goto — routine 26', () => {
  it('moves the record pointer and reads', () => {
    run([USE, 'Db Goto 3', 'Print Db Recno'], TINY)
    expect(out()).toEqual(['3'])
  })

  it('refuses zero and below, and refuses past the end', () => {
    expect(() => run([USE, 'Db Goto 0'], TINY)).toThrow()
    expect(() => run([USE, 'Db Goto -1'], TINY)).toThrow()
    // `cmp.l $10(a0),d4 / Rble / Rbra routine 90`. DBench's db_goto node
    // promises "If n=Db Reccount+1, then a new empty record will be added"
    // and its own Bugs node then says the version cannot; 0.94 still cannot
    expect(() => run([USE, 'Db Goto 5'], TINY)).toThrow()
  })

  it('going to the record you are already on does nothing at all', () => {
    // `cmp.l $1c(a0),d4 / beq $b34` --- no seek, no read
    run([USE, 'Db Goto 2', 'Db Goto 2', 'Print Db Recno'], TINY)
    expect(out()).toEqual(['2'])
  })
})

describe('Db Skip — routine 41', () => {
  it('goes forward one, and stops dead on the last record', () => {
    run([USE, 'Db Skip', 'Print Db Recno', 'Db Goto 4', 'Db Skip', 'Print Db Recno'], TINY)
    expect(out()).toEqual(['2', '4'])
  })

  it('takes no argument: the spec is `I`', () => {
    // a number after it is a syntax error, not a step count
    expect(() => run([USE, 'Db Skip 2'], TINY)).toThrow(/syntax error/i)
  })
})

describe('Db Recle reports one less than the file does', () => {
  it('the deleted flag is in DB_RecLe and Db Recle takes it back off', () => {
    // `move.w $8(a0),d3 / subi.w #$1,d3` (routine 22, $9c6)
    run([USE, 'Print Db Recle', 'Print Db Fieldno'], TINY)
    expect(out()).toEqual(['14', '2'])
  })
})

describe('Db Address', () => {
  it('is the data zone, and the zone holds the shipped defaults', () => {
    const { rt } = run([USE, 'Print Db Address'], TINY)
    expect(out()).toEqual([String(rt.symbase.base | 0)])
    // $12c at +$00, channel 1 at +$04, and cutspace $ff at +$30
    const m = rt.resolveAddr(rt.symbase.base)!
    expect((m.data[m.off + 2]! << 8) | m.data[m.off + 3]!).toBe(DB_BANK_BASE)
    expect(m.data[m.off + 0x30]).toBe(0xff)
  })
})

describe('Book.dbf — the artifact, through the keywords', () => {
  it.skipIf(!book)('reads 24 records of five fields, and 129 not 130', () => {
    run(['Db Use "Work:Book.dbf"', 'Print Db Reccount', 'Print Db Fieldno', 'Print Db Recle', 'Print Db Recno'], {
      'Book.dbf': book!,
    })
    expect(out()).toEqual(['24', '5', '129', '1'])
  })

  it.skipIf(!book)('walks the whole file with Db Skip and stops on the last row', () => {
    run(['Db Use "Work:Book.dbf"', 'For I=1 To 40 : Db Skip : Next I', 'Print Db Recno'], { 'Book.dbf': book! })
    expect(out()).toEqual(['24'])
  })

  it.skipIf(!book)('the bank is the size the file asks for', () => {
    const { rt } = run(['Db Use "Work:Book.dbf"'], { 'Book.dbf': book! })
    // 128 + 192 + 5*16 + 130 = 530
    expect(rt.memBanks.get(DB_BANK_BASE + 1)!.data.length).toBe(530)
  })

  it.skipIf(!book)('the bank carries the file header where a program can Peek it', () => {
    const { rt } = run(['Db Use "Work:Book.dbf"'], { 'Book.dbf': book! })
    const bank = rt.memBanks.get(DB_BANK_BASE + 1)!.data
    // the file's own 32-byte header lands at +$80, descriptors after it
    expect(bank[0x80]).toBe(3)
    expect(bank[0x80 + 32 + 5 * 32]).toBe(DBF_TERMINATOR)
  })
})

/** the four rows tiny() writes, as `Db Get$` with cutspace on would read them */
const NAMES = ['Ada', 'Grace', 'Alan', 'Edsger']

describe('the field accessors — batch 3', () => {
  it('Db Field$ and Db Field are the two directions of the same table', () => {
    run([USE, 'Print Db Field$(1)', 'Print Db Field$(2)', 'Print Db Field("town")'], TINY)
    expect(out()).toEqual(['name', 'town', '2'])
  })

  it('Db Field answers -1 for a name that is not there, and raises on an empty one', () => {
    run([USE, 'Print Db Field("nope")'], TINY)
    expect(out()).toEqual(['-1'])
    // `move.w (a1)+,d0 / Rbeq routine 90`
    expect(() => run([USE, 'Print Db Field("")'], TINY)).toThrow()
  })

  it('Db Flen and Db Ftype read the descriptor, and F is the one special case', () => {
    run([USE, 'Print Db Flen(1)', 'Print Db Ftype(1)'], TINY)
    // 8 characters, and 'C' as a number
    expect(out()).toEqual(['8', String('C'.charCodeAt(0))])
  })

  it('every field reader refuses a number outside 1..Db Fieldno', () => {
    for (const kw of ['Db Flen(0)', 'Db Ftype(3)', 'Db Field$(9)', 'Db Get$(0)', 'Db Get(3)']) {
      expect(() => run([USE, `Print ${kw}`], TINY)).toThrow()
    }
  })

  it('Db Get$ trims trailing spaces while Db Cutspace is on, and it is on at boot', () => {
    run([USE, 'Print Db Get$(1)', 'Db Cutspace Off', 'Print Len(Db Get$(1))'], TINY)
    expect(out()).toEqual([NAMES[0]!, '8'])
  })

  it('Db Found$ IS Db Get$, which is what routine 49 being one Rbsr means', () => {
    run([USE, 'Print Db Found$(1)', 'Print Db Get$(1)'], TINY)
    expect(out()).toEqual([NAMES[0]!, NAMES[0]!])
  })

  it('Db Put$ pads the field out with spaces and marks the record unsaved', () => {
    run([USE, 'Print Db Recsaved', 'Db Put$ "Bob",1', 'Print Db Recsaved', 'Print Db Get$(1)', 'Print Len(Db Get$(1))'], TINY)
    expect(out()).toEqual(['-1', '0', 'Bob', '3'])
  })

  it('a string longer than the field is TRUNCATED, not refused', () => {
    // the table carries "String is longer than the field!" as message 3 and
    // routine 28 never reaches it
    run([USE, 'Db Cutspace Off', 'Db Put$ "Bartholomew",1', 'Print Db Get$(1)'], TINY)
    expect(out()).toEqual(['Bartholo'])
  })

  it('an empty string blanks the field, which is the `beq` before the copy', () => {
    // `out()` trims, so the padding is measured rather than printed
    run([USE, 'Db Put$ "",1', 'Print Len(Db Get$(1))', 'Db Cutspace Off', 'Print Len(Db Get$(1))', 'Print Asc(Db Get$(1))'], TINY)
    expect(out()).toEqual(['0', '8', '32'])
  })

  it('Db Putn right-aligns into the field', () => {
    run([USE, 'Db Cutspace Off', 'Db Putn 42,1', 'Print Len(Db Get$(1))', 'Print Asc(Db Get$(1))', 'Db Cutspace On', 'Print Db Get$(1)'], TINY)
    // eight wide, six spaces then "42"
    expect(out()).toEqual(['8', '32', '42'])
  })

  it('Db Putf and Db Getf are the field as four bytes of FFP, not as text', () => {
    run([USE, 'Db Putf 3.5,1', 'Print Db Getf(1)'], TINY)
    expect(out()[0]).toMatch(/^3\.5/)
  })

  it('Db Saved On throws an edit away, which is the guide\'s own example', () => {
    // "Db Goto 10 / Db Put "123",2 / Db Saved On / Db Close" and "The above
    // don't change the 2nd field of the 10th record"
    const { fs } = run([USE, 'Db Put$ "Zed",1', 'Db Saved On', 'Db Goto 2', 'Db Goto 1', 'Print Db Get$(1)'], TINY)
    expect(out()).toEqual([NAMES[0]!])
    expect(fs.readFile('Work:a.dbf')).toBeTruthy()
  })

  it('and without it the edit reaches the file at the next positioning', () => {
    const { fs } = run([USE, 'Db Put$ "Zed",1', 'Db Goto 2', 'Db Goto 1', 'Print Db Get$(1)'], TINY)
    expect(out()).toEqual(['Zed'])
    const back = fs.readFile('Work:a.dbf')!
    expect(String.fromCharCode(...back.subarray(97 + 1, 97 + 4))).toBe('Zed')
  })
})

describe('records — batch 4', () => {
  it('Db Delete marks and Db Recall unmarks, and Db Deleted reads the flag', () => {
    run([USE, 'Print Db Deleted', 'Db Delete', 'Print Db Deleted', 'Db Recall', 'Print Db Deleted'], TINY)
    expect(out()).toEqual(['0', '-1', '0'])
  })

  it('a flag that is neither space nor star is "Database is corrupt!"', () => {
    // `cmpi.b #$20,d0 / Rbne routine 96`
    const bad = tiny()
    bad[97] = 0x58 // an 'X' where the deleted flag goes
    expect(() => run([USE, 'Print Db Deleted'], { 'a.dbf': bad })).toThrow(SYMBASE_ERRORS[6])
  })

  it('Db Setdeleted On makes Db Skip step over deleted records', () => {
    run([USE, 'Db Goto 2', 'Db Delete', 'Db Goto 1', 'Db Setdeleted On', 'Db Skip', 'Print Db Recno'], TINY)
    expect(out()).toEqual(['3'])
    run([USE, 'Db Goto 2', 'Db Delete', 'Db Goto 1', 'Db Skip', 'Print Db Recno'], TINY)
    expect(out()).toEqual(['2'])
  })

  it('Db Append puts the buffer on the end and lands on it', () => {
    run([USE, 'Db Goto 2', 'Db Append', 'Print Db Reccount', 'Print Db Recno', 'Print Db Get$(1)'], TINY)
    expect(out()).toEqual(['5', '5', NAMES[1]!])
  })

  it('Db Append Blank fills the WHOLE record, deleted flag included, so it is live', () => {
    run([USE, 'Db Append Blank', 'Print Db Reccount', 'Print Db Deleted', 'Print Len(Db Get$(1))'], TINY)
    expect(out()).toEqual(['5', '0', '0'])
  })

  it('the appended record and the new count reach the file', () => {
    const { fs } = run([USE, 'Db Append Blank'], TINY)
    const back = fs.readFile('Work:a.dbf')!
    expect(back[4]).toBe(5)
    expect(back.length).toBe(97 + 5 * 15 + 1)
    expect(back[back.length - 1]).toBe(0x1a)
  })

  /**
   * DEFECT: `Db Append From` cannot be called in any form.
   *
   * $01c6's spec is `"I0,"` --- an integer, a separator, and then the $FF
   * terminator where the second parameter's type should be. `VerC`
   * (+Verif.s:3120) walks the built argument string against it: one argument
   * runs out at the "," and takes VerC3, two arguments match "0" and "," and
   * then meet the terminator at VerC4, and $FF is not -2, so both fall into
   * VerSynt. The routine behind it is one branch to "Not implemented yet :(",
   * which is presumably why nobody noticed.
   */
  it('Db Append From cannot be typed, because its spec ends in a separator', () => {
    for (const src of ['Db Append From 1,2', 'Db Append From 1', 'Db Append From 1,', 'Db Append From']) {
      expect(() => run([USE, src], TINY), src).toThrow(/syntax error/i)
    }
    // the entry in front of it is written properly and still works
    expect(() => run([USE, 'Db Append'], TINY)).not.toThrow()
    // and routine 80 itself, reached the only way anything could reach it
    expect(() => runUnchecked([USE, 'Db Append From 1,2'], TINY)).toThrow(SYMBASE_ERRORS[4])
  })

  it('Db Swap exchanges two records and leaves the buffer on the first', () => {
    run([USE, 'Db Swap 1,3', 'Print Db Recno', 'Print Db Get$(1)', 'Db Goto 3', 'Print Db Get$(1)'], TINY)
    expect(out()).toEqual(['1', NAMES[2]!, NAMES[0]!])
  })

  it('Db Swap refuses a number outside the file and ignores a self-swap', () => {
    expect(() => run([USE, 'Db Swap 0,1'], TINY)).toThrow()
    expect(() => run([USE, 'Db Swap 1,9'], TINY)).toThrow()
    run([USE, 'Db Swap 2,2', 'Print Db Get$(1)'], TINY)
    expect(out()).toEqual([NAMES[0]!])
  })

  it('Db Pack drops the deleted records and shortens the file', () => {
    const { fs } = run([USE, 'Db Goto 2', 'Db Delete', 'Db Goto 3', 'Db Pack', 'Print Db Reccount'], TINY)
    expect(out()).toEqual(['3'])
    const back = fs.readFile('Work:a.dbf')!
    expect(back[4]).toBe(3)
    expect(back.length).toBe(97 + 3 * 15 + 1)
  })

  it('a file with nothing deleted is walked and then left alone', () => {
    // the write cursor stays 0, and `tst.l $24(a2) / bne / rts` is the exit
    run([USE, 'Db Pack', 'Print Db Reccount'], TINY)
    expect(out()).toEqual(['4'])
  })

  it('Db Zap empties the file down to its header, and leaves no $1a', () => {
    const { fs } = run([USE, 'Db Zap', 'Print Db Reccount', 'Print Db Recno'], TINY)
    expect(out()).toEqual(['0', '0'])
    const back = fs.readFile('Work:a.dbf')!
    // no routine 76 here, where Db Pack has one
    expect(back.length).toBe(97)
    expect(back[4]).toBe(0)
  })

  it('Db Header Update Off holds the count back until Db Header Update', () => {
    const { fs } = run([USE, 'Db Header Update Off', 'Db Append Blank'], TINY)
    expect(fs.readFile('Work:a.dbf')![4]).toBe(4)
    const after = run([USE, 'Db Header Update Off', 'Db Append Blank', 'Db Header Update'], TINY)
    expect(after.fs.readFile('Work:a.dbf')![4]).toBe(5)
  })
})

describe('the search — Db Locate and its defect', () => {
  it('finds a record and sets Db Found', () => {
    run([USE, 'Db Locate 1,"Alan"', 'Print Db Found', 'Print Db Recno'], TINY)
    expect(out()).toEqual(['-1', '3'])
  })

  it('compares only Len(text$) bytes, so a prefix matches', () => {
    // `cmpm.b (a2)+,(a1)+` runs for the needle's length and no further
    run([USE, 'Db Locate 1,"Ed"', 'Print Db Recno'], TINY)
    expect(out()).toEqual(['4'])
  })

  it('and it is anchored at the field start, so an inner substring does not', () => {
    run([USE, 'Db Locate 1,"lan"', 'Print Db Recno'], TINY)
    expect(out()).toEqual(['4'])
  })

  it('the four-argument form starts from a given record', () => {
    run([USE, 'Db Locate 1,"A",3,0', 'Print Db Recno'], TINY)
    expect(out()).toEqual(['3'])
  })

  it('Db Continue takes the search on by one record', () => {
    run([USE, 'Db Locate 1,"A"', 'Print Db Recno', 'Db Continue', 'Print Db Recno'], TINY)
    expect(out()).toEqual(['1', '3'])
  })

  it('DEFECT: a failed search does NOT clear Db Found', () => {
    // routine 40's not-found arm stores through a2 without reloading it, so
    // data+$31 keeps the -1 the previous hit put there ($e4e against $e38)
    run([USE, 'Db Locate 1,"Alan"', 'Print Db Found', 'Db Goto 1', 'Db Locate 1,"Zoe"', 'Print Db Found'], TINY)
    expect(out()).toEqual(['-1', '-1'])
  })

  it('and a search that never hits leaves it at its boot value', () => {
    run([USE, 'Db Locate 1,"Zoe"', 'Print Db Found'], TINY)
    expect(out()).toEqual(['0'])
  })

  it('a failed search runs to the last record', () => {
    run([USE, 'Db Locate 1,"Zoe"', 'Print Db Recno'], TINY)
    expect(out()).toEqual(['4'])
  })
})

describe('the two the author left unfinished', () => {
  it('Db Sort does nothing at all, and does not say so', () => {
    // routines 53 and 54 are three pops, an `Rbsr routine 86` and an `rts`
    run([USE, 'Db Sort 1,1 To 4', 'Print Db Get$(1)', 'Print Db Reccount'], TINY)
    expect(out()).toEqual([NAMES[0]!, '4'])
    expect(() => run([USE, 'Db Sort 1'], TINY)).not.toThrow()
  })

  it('but it still needs a database open, which is the one thing it checks', () => {
    expect(() => run(['Db Sort 1'], TINY)).toThrow(SYMBASE_ERRORS[2])
  })

  it('Db Order opens an index file and changes nothing about the reads', () => {
    const idx = { 'a.dbf': tiny(), 'a.ndx': Uint8Array.from([1, 2, 3, 4]) }
    run([USE, 'Db Order "Work:a.ndx"', 'Print Db Recno', 'Db Skip', 'Print Db Recno'], idx)
    expect(out()).toEqual(['1', '2'])
    expect(() => run([USE, 'Db Order "Work:none.ndx"'], TINY)).toThrow()
  })
})

describe('Db Notify', () => {
  it('commits the buffer and picks the file up again', () => {
    const { fs } = run([USE, 'Db Put$ "Zed",1', 'Db Notify', 'Print Db Get$(1)', 'Print Db Recno'], TINY)
    expect(out()).toEqual(['Zed', '1'])
    expect(String.fromCharCode(...fs.readFile('Work:a.dbf')!.subarray(98, 101))).toBe('Zed')
  })
})

describe('the three switches, both ways', () => {
  it('Db Saved Off makes the buffer dirty again (routine 12, $8c4)', () => {
    run([USE, 'Db Saved On', 'Print Db Recsaved', 'Db Saved Off', 'Print Db Recsaved'], TINY)
    expect(out()).toEqual(['-1', '0'])
  })

  it('Db Setdeleted Off puts Db Skip back on every record (routine 43, $e9a)', () => {
    run([USE, 'Db Goto 2', 'Db Delete', 'Db Goto 1', 'Db Setdeleted On', 'Db Setdeleted Off', 'Db Skip', 'Print Db Recno'], TINY)
    expect(out()).toEqual(['2'])
  })

  it("DBench's Db Put is 0.94's Db Put$ under the name it had at token $0174", () => {
    // `db put` is in DBench's table and not in SymBase's, so this one binds
    // 0.42. One handler answers both, because dispatch is by name and only
    // one of the two tables is ever loaded
    const exts = new Map([[21, dbench.table]])
    const fs = new AmigaFS()
    fs.mountMemory('Work').write(['a.dbf'], tiny())
    fs.currentDir = 'Work:'
    printed = ''
    const rt = new Runtime(
      tokenize([USE, 'Db Put "Bob",1', 'Print Db Get$(1)'].join('\n'), table, exts),
      table,
      {
        extensions: exts,
        extBindings: new Map([[21, dbench]]),
        maxSteps: 500_000,
        onText: (t) => (printed += t),
        fs,
      },
    )
    mustFinish(rt.runHeadless(2000))
    expect(out()).toEqual(['Bob'])
  })
})
