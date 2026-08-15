/**
 * The xBase format, against the artifact that comes with it.
 *
 * `Comp/SymBase/Examples/Book.dbf` ships in the SymBase archive and is the
 * reason this layer can be judged rather than believed: every constant in
 * dbf.ts is either an instruction from routine 6 or a number this file
 * produces, and the two have to agree. Where the guide and the binary
 * disagree the binary wins, and one of these tests is that disagreement.
 *
 * The fixture is optional the way every corpus test here is optional —
 * `fixtures/` is gitignored — so the file-backed cases skip when it is
 * absent and the arithmetic cases always run.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DBF_EOF,
  DBF_FLOAT_LEN,
  DBF_ID,
  DBF_TERMINATOR,
  DbfError,
  cutSpace,
  dbfBankSize,
  dbfCFieldOffset,
  dbfFieldCount,
  dbfRecordOffset,
  parseDbf,
  writeDbf,
} from './dbf'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BOOK = join(root, 'fixtures', 'extensions', 'symbase-0.94', 'Book.dbf')
const book = existsSync(BOOK) ? new Uint8Array(readFileSync(BOOK)) : null

describe('the xBase header, as routine 6 reads it', () => {
  it('the field count is masked, which is what covers both terminator forms', () => {
    // `andi.b #$f0,d3 / lsr.w #$5,d3 / subq.w #$1,d3` ($6a6). A file whose
    // descriptors end with $0D has HeadLe 33 + 32n and one ending $0D $00 has
    // 34 + 32n, and $f0 masks both to 32 + 32n
    for (let n = 1; n < 8; n++) {
      expect(dbfFieldCount(32 + n * 32 + 1)).toBe(n)
      expect(dbfFieldCount(32 + n * 32 + 2)).toBe(n)
    }
  })

  it('the bank size is the six instructions that compute it', () => {
    // 128 head + 192 header-and-descriptors + 5*16 computed + 130 record
    expect(dbfBankSize(194, 130)).toBe(530)
    expect(dbfCFieldOffset(194)).toBe(0x80 + 192)
    expect(dbfRecordOffset(194, 130)).toBe(530 - 130)
    // `btst.b #$0,d2 / addq.w #$1` --- an odd total is rounded up
    expect(dbfBankSize(194, 131) & 1).toBe(0)
    expect(dbfBankSize(194, 131)).toBe(532)
  })

  it('refuses a file that is not $03, including the $83 the guide allows', () => {
    // DBench's db_use node says the id "must be $03 or $83", and routine 6 is
    // `cmpi.b #$3,$48(a2) / bne` ($674) --- one value, not two. $83 is dBase
    // III WITH a memo file, and 0.94 has the bank fields for one and no code
    const head = new Uint8Array(64)
    head[0] = 0x83
    expect(() => parseDbf(head)).toThrow(DbfError)
    head[0] = DBF_ID
    // still bad: no fields
    expect(() => parseDbf(head)).toThrow(DbfError)
  })
})

describe('Book.dbf — the artifact', () => {
  it.skipIf(!book)('parses as the Dbhead node describes it', () => {
    const db = parseDbf(book!)
    expect(db.headerLength).toBe(194)
    expect(db.recordLength).toBe(130)
    expect(db.records.length).toBe(24)
    expect(db.fields.map((f) => [f.name, f.type, f.length])).toEqual([
      ['title', 'C', 40],
      ['otitle', 'C', 40],
      ['author', 'C', 40],
      ['year', 'N', 5],
      ['kind', 'N', 4],
    ])
  })

  it.skipIf(!book)('the record length accounts for the fields plus the deleted flag', () => {
    const db = parseDbf(book!)
    const sum = db.fields.reduce((a, f) => a + f.length, 0)
    // "a hosszba beleszámít a deleted flag byte is" --- the flag is in the length
    expect(sum + 1).toBe(db.recordLength)
    expect(db.fields[0]!.offset).toBe(1)
    expect(db.fields[4]!.offset).toBe(1 + 40 + 40 + 40 + 5)
  })

  it.skipIf(!book)('the header is authoritative, and the file is longer than it', () => {
    const db = parseDbf(book!)
    const end = db.headerLength + db.records.length * db.recordLength
    expect(end).toBe(3314)
    expect(book!.length).toBe(3786)
    // the $1a sits exactly where the header's arithmetic ends the data, and
    // 472 bytes of slack follow it. A reader sizing itself by the file would
    // invent three and a half records
    expect(book![end]).toBe(DBF_EOF)
    expect((book!.length - end) / db.recordLength).toBeGreaterThan(3)
  })

  it.skipIf(!book)('uses the two-byte terminator, which is why the mask is needed', () => {
    const db = parseDbf(book!)
    const at = 32 + db.fields.length * 32
    expect(at).toBe(192)
    expect(book![at]).toBe(DBF_TERMINATOR)
    expect(book![at + 1]).toBe(0)
    // 193 would be the one-byte form; this file says 194
    expect(db.headerLength).toBe(at + 2)
  })

  it.skipIf(!book)('every record carries a legal deleted flag', () => {
    const db = parseDbf(book!)
    for (const r of db.records) expect([0x20, 0x2a]).toContain(r[0])
  })

  it.skipIf(!book)('round-trips through the writer, header and records alike', () => {
    const db = parseDbf(book!)
    const out = writeDbf(db)
    const back = parseDbf(out)
    expect(back.headerLength).toBe(db.headerLength)
    expect(back.recordLength).toBe(db.recordLength)
    expect(back.fields).toEqual(db.fields)
    expect(back.records.length).toBe(db.records.length)
    for (let i = 0; i < db.records.length; i++) expect(Array.from(back.records[i]!)).toEqual(Array.from(db.records[i]!))
    // the written file ends at the $1a; the sample's 472 bytes of slack are
    // an accident of whatever wrote it, not part of the format
    expect(out.length).toBe(3314 + 1)
    expect(out[3314]).toBe(DBF_EOF)
  })

  it.skipIf(!book)('a field reads out of the record at its computed offset', () => {
    const db = parseDbf(book!)
    const rec = db.records[0]!
    const f = db.fields[0]!
    const raw = String.fromCharCode(...rec.slice(f.offset, f.offset + f.length))
    expect(raw.length).toBe(40)
    // C fields are space-padded, which is what Db Cutspace On exists for
    expect(cutSpace(raw).length).toBeLessThan(40)
    expect(cutSpace(raw)).toBe(raw.trimEnd())
  })
})

describe('Db Cutspace, as routine 25 walks it', () => {
  it('takes trailing spaces and nothing else', () => {
    expect(cutSpace('Amiga   ')).toBe('Amiga')
    expect(cutSpace('  Amiga')).toBe('  Amiga')
    // `cmpi.b #$20,-(a1)` tests $20 alone, so a NUL-padded field keeps its NULs
    expect(cutSpace('Amiga\0\0')).toBe('Amiga\0\0')
  })

  it('a field of nothing but spaces is empty, which is the dbne running past the start', () => {
    // `cmpi.w #$ffff,d4 / bne` ($ace): the counter wrapping is how the routine
    // knows it never found a non-space, and it answers zero length
    expect(cutSpace('    ')).toBe('')
    expect(cutSpace('')).toBe('')
  })
})

describe('the F field, which is the one type with its own rule', () => {
  it('Db Flen answers sixteen for it whatever the descriptor says', () => {
    // `cmpi.b #$46,d3 / bne / move.l #$10,d3` (routine 8, $842) --- 'F', and
    // the descriptor's own length byte is never read
    expect(DBF_FLOAT_LEN).toBe(16)
  })
})
