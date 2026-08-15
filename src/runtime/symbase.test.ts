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
import { tokenize } from '../tokens/tokenizer'
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

function boot(src: string[], files: Record<string, Uint8Array> = {}): { rt: Runtime; fs: AmigaFS } {
  const exts = new Map([[21, symbase.table]])
  const fs = new AmigaFS()
  const vol = fs.mountMemory('Work')
  for (const [name, bytes] of Object.entries(files)) vol.write([name], bytes)
  fs.currentDir = 'Work:'
  printed = ''
  const rt = new Runtime(tokenize(src.join('\n'), table, exts), table, {
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
    expect(() => run([USE, 'Db Skip 2'], TINY)).toThrow()
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
