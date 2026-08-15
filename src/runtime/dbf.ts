/**
 * The xBase file, and the bank SymBase builds over it.
 *
 * SymBase 0.94 and DBench 0.42 are one product at two ages, both by Lázár
 * Zoltán, and both are a dBase III engine: *"the used database file is Xbase
 * compatible"* (SymBase.guide, `Features`). The keywords are dBase's name for
 * name — `Db Use`, `Db Select`, `Db Skip`, `Db Locate`, `Db Pack`, `Db Zap`,
 * `Db Append`, `Db Recall`, `Db Order`. This file is the part that has
 * nothing to do with AMOS: the on-disk record file, and the memory image
 * `Db Use` builds from it.
 *
 * ## Evidence
 *
 * Three sources agreeing, which is the most any format in this port has had.
 *
 * **The guide.** `SymBase.guide`'s `Dbhead` node lays the file out field by
 * field and `BANK` does the same for the memory image. Both are in Hungarian;
 * DBench's `DataBench.Guide` carries the same two nodes, also Hungarian, in a
 * guide that is otherwise English.
 *
 * **The binary**, which is what settles the disagreements — and there is one.
 * DBench's `db_use` node says the id byte *"must be $03 or $83"*; routine 6 is
 * `cmpi.b #$3,$48(a2) / bne` ($674), so **$83 is refused**. $83 is dBase III
 * with a memo file, and the bank header has `DB_MemoFilehd` and
 * `DB_MemoIFFhd` fields reserved for one, so the guide describes an intention
 * and the code describes 0.94.
 *
 * **`Examples/Book.dbf`**, 3,786 bytes, which every constant below is checked
 * against in dbf.test.ts. A byte-exact artifact is the tier a format port can
 * be judged at, and this is one.
 *
 * ## The file
 *
 *     0      DBF_Id       $03
 *     1-3    DBF_Date     last modified, yy mm dd
 *     4-7    DBF_RecNo    record count, "a byte-ok fordított sorrendben"
 *     8-9    DBF_HeadLe   where the first record starts
 *     10-11  DBF_RecLe    record length, "a hosszba beleszámít a deleted flag byte is"
 *     12-31  reserved
 *
 * then one 32-byte descriptor per field (name in 10 bytes plus a NUL, type,
 * four reserved for an address the file does not use, length, decimals), then
 * `$0D` or `$0D $00`, then the records. Every multi-byte number is
 * little-endian, which is the guide's "reversed byte order" and the reason
 * routine 6 spends six instructions on `rol.w #$8` before it can use any of
 * them.
 *
 * **The header is authoritative, not the file length.** Book.dbf ends its
 * data with `$1a` at 3,314, exactly `HeadLe + RecNo * RecLe`, and then
 * carries 472 bytes of slack. A reader sizing itself by the file would invent
 * three and a half records.
 *
 * **The field count is masked, and the mask is load-bearing.** Routine 6 is
 * `andi.b #$f0,d3 / lsr.w #$5,d3 / subq.w #$1,d3` ($6a6), so it is
 * `((HeadLe and $fff0) >> 5) - 1` rather than `(HeadLe - 33) / 32`. That is
 * how one expression handles both terminator forms: a file ending its
 * descriptors with `$0D` has HeadLe 193 and one ending with `$0D $00` has
 * 194, and the mask takes both to 192. Book.dbf is the second kind. The
 * `.b` is not a typo of the author's and it is easy to make one of: see
 * `dbfFieldCount`.
 */

/** `cmpi.b #$3,$48(a2)` (routine 6, $674) — and NOT $83, whatever the guide says */
export const DBF_ID = 0x03
/** the header, and each field descriptor, are both this long */
export const DBF_HEADER_LEN = 32
export const DBF_FIELD_LEN = 32
/** the byte after the last descriptor */
export const DBF_TERMINATOR = 0x0d
/** what a file's data ends with, at `HeadLe + RecNo * RecLe` */
export const DBF_EOF = 0x1a
/** a live record's first byte; `$2a` is `*`, deleted */
export const DBF_LIVE = 0x20
export const DBF_DELETED = 0x2a

/**
 * The field types this engine knows, and what each answers.
 *
 * `Db Ftype` returns the letter as a number, so a program compares against
 * `Asc("C")`. Only `F` gets special treatment anywhere: `Db Flen` is
 * `cmpi.b #$46,d3 / bne` and answers a flat 16 for one ($842), where every
 * other type reads `DBF_FieldLe` out of the descriptor.
 */
export const DBF_TYPES = 'CNLDMF'
/** `Db Flen` on an `F` field: sixteen characters, whatever the descriptor says */
export const DBF_FLOAT_LEN = 0x10

export interface DbfField {
  /** 10 bytes and a NUL terminator; the descriptor's first eleven */
  name: string
  /** one of DBF_TYPES, as the letter */
  type: string
  /** DBF_FieldLe, the width in characters */
  length: number
  /** DBF_FieldDec, the decimal places on a numeric field */
  decimals: number
  /** where this field starts inside a record, the deleted flag included */
  offset: number
}

export interface Dbf {
  /** the last-modified stamp, as the three bytes the file holds */
  date: [number, number, number]
  fields: DbfField[]
  /** DBF_HeadLe: where record 1 starts */
  headerLength: number
  /** DBF_RecLe, which counts the deleted flag */
  recordLength: number
  /** one entry per record, `recordLength` bytes each, flag first */
  records: Uint8Array[]
}

/** a bad file, which `Db Use` reports as "Not a dbase file!" */
export class DbfError extends Error {}

const u16 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8)
const u32 = (b: Uint8Array, o: number): number =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0

/**
 * How many fields a header of this length describes.
 *
 * `((HeadLe and $fff0) >> 5) - 1`, which is routine 6's three instructions
 * and not the arithmetic anybody would write from the format description.
 * The mask is what makes one expression cover both `$0D` and `$0D $00`; see
 * the file comment.
 *
 * IT IS `andi.b`, AND THE SIZE IS THE POINT. `andi.b #$f0,d3` clears the low
 * nibble of the LOW BYTE and leaves the high byte standing, and every use of
 * d3 after it is a word — `add.w`, `lsr.w`. So the mask is $fff0, not $f0,
 * and a file with eight or more fields (header length past 255) needs it to
 * be: `andi.w` would have been the same thing here and `& $f0` is not.
 * Written as `& 0xf0` this counted -1 fields for a seven-field file.
 */
export const dbfFieldCount = (headerLength: number): number => ((headerLength & 0xfff0) >> 5) - 1

/**
 * Read a .dbf.
 *
 * Bounded by what the HEADER says at every step, because that is what routine
 * 6 does: it reads 32 bytes, believes them, and seeks. A file shorter than
 * its header claims yields fewer records rather than throwing, which is the
 * same shape as a truncated read on the machine.
 */
export function parseDbf(bytes: Uint8Array): Dbf {
  if (bytes.length < DBF_HEADER_LEN) throw new DbfError('not a dbase file')
  if (bytes[0] !== DBF_ID) throw new DbfError('not a dbase file')
  const recNo = u32(bytes, 4)
  const headerLength = u16(bytes, 8)
  const recordLength = u16(bytes, 10)
  const n = dbfFieldCount(headerLength)
  if (n < 1 || recordLength < 1) throw new DbfError('not a dbase file')

  const fields: DbfField[] = []
  // the deleted flag is byte 0, so the first field's data starts at 1
  let offset = 1
  for (let i = 0; i < n; i++) {
    const at = DBF_HEADER_LEN + i * DBF_FIELD_LEN
    if (at + DBF_FIELD_LEN > bytes.length) throw new DbfError('not a dbase file')
    let name = ''
    for (let j = 0; j < 10 && bytes[at + j] !== 0; j++) name += String.fromCharCode(bytes[at + j]!)
    const length = bytes[at + 16]!
    fields.push({
      name,
      type: String.fromCharCode(bytes[at + 11]!),
      length,
      decimals: bytes[at + 17]!,
      offset,
    })
    offset += length
  }

  const records: Uint8Array[] = []
  for (let i = 0; i < recNo; i++) {
    const at = headerLength + i * recordLength
    if (at + recordLength > bytes.length) break
    records.push(bytes.slice(at, at + recordLength))
  }
  return { date: [bytes[1]!, bytes[2]!, bytes[3]!], fields, headerLength, recordLength, records }
}

/**
 * Write a .dbf back.
 *
 * The header is rebuilt from the records rather than carried over, so a file
 * written after `Db Pack` says how many records it now has. Two things are
 * reproduced rather than tidied: the terminator is written `$0D $00` when the
 * header length asks for it, and the data is followed by `$1a`.
 *
 * The trailing slack Book.dbf carries is NOT reproduced. It is not part of
 * the format — the header's own arithmetic ends the file at the `$1a` — and
 * writing 472 bytes of spaces to imitate one sample would be copying an
 * accident.
 */
export function writeDbf(db: Dbf): Uint8Array {
  const n = db.fields.length
  const headerLength = db.headerLength
  const out = new Uint8Array(headerLength + db.records.length * db.recordLength + 1)
  out[0] = DBF_ID
  out[1] = db.date[0]
  out[2] = db.date[1]
  out[3] = db.date[2]
  const count = db.records.length
  out[4] = count & 0xff
  out[5] = (count >> 8) & 0xff
  out[6] = (count >> 16) & 0xff
  out[7] = (count >> 24) & 0xff
  out[8] = headerLength & 0xff
  out[9] = (headerLength >> 8) & 0xff
  out[10] = db.recordLength & 0xff
  out[11] = (db.recordLength >> 8) & 0xff
  for (let i = 0; i < n; i++) {
    const f = db.fields[i]!
    const at = DBF_HEADER_LEN + i * DBF_FIELD_LEN
    for (let j = 0; j < 10 && j < f.name.length; j++) out[at + j] = f.name.charCodeAt(j) & 0xff
    out[at + 11] = f.type.charCodeAt(0) & 0xff
    out[at + 16] = f.length & 0xff
    out[at + 17] = f.decimals & 0xff
  }
  out[DBF_HEADER_LEN + n * DBF_FIELD_LEN] = DBF_TERMINATOR
  let p = headerLength
  for (const r of db.records) {
    out.set(r.subarray(0, db.recordLength), p)
    p += db.recordLength
  }
  out[p] = DBF_EOF
  return out
}

// ---- the bank Db Use builds -------------------------------------------

/**
 * `DE_BankHead`, the first 128 bytes of the Work bank named "Dbase".
 *
 * Every offset here is the `BANK` node's, and the ones routine 6 writes are
 * cited against it. The fields past $2c are SymBase's: DBench's copy of the
 * node stops at `DB_NextSel`, and 0.94 has replaced that longword with a
 * cache flag and added the index, memo and cache block below it.
 */
export const BANK_HEAD = 0x80
export const DB_FILEHD = 0x00
export const DB_HEADLE = 0x04
export const DB_RECLE = 0x08
export const DB_RECST = 0x0a
export const DB_FIELDNUM = 0x0e
export const DB_RECNUM = 0x10
export const DB_RECOFF = 0x14
export const DB_CFIELDOFF = 0x18
export const DB_CURREC = 0x1c
export const DB_ORDER = 0x20
export const DB_PREVSEL = 0x24
export const DB_CACHEVALID = 0x28
export const DB_INDEXHD = 0x2c
export const DB_DELETED = 0x30
export const DB_MEMOSIZE = 0x32
export const DB_SAVED = 0x34
export const DB_MEMOFILEHD = 0x38
export const DB_MEMOIFFHD = 0x3c
export const DB_CACHESIZE = 0x40
export const DB_CACHEMEM = 0x44

/** where the file's own 32-byte header is copied to, `$a0` less the 32 (routine 6, $6d8) */
export const BANK_DATAHEAD = BANK_HEAD
/** the first field DESCRIPTOR, which is why routine 8 indexes `(f-1)*32 + $a0` */
export const BANK_FIELDS = 0xa0
/** SIXTEEN bytes a field, not the twelve the `BANK` node says (`mulu.w #$10,d3`, $6b4) */
export const BANK_CFIELD_LEN = 0x10

/**
 * How big a bank `Db Use` reserves, as routine 6 computes it ($6a0-$6c8):
 *
 *     moveq  #$80,d2                     the bank head
 *     andi.b #$f0,d3 / add.w d3,d2       the file header and descriptors
 *     lsr.w  #$5,d3 / subq.w #$1,d3      ...which is also the field count
 *     mulu.w #$10,d3 / add.w d3,d2       sixteen computed bytes a field
 *     add.w  $52(a2),d2                  one record buffer
 *     btst.b #$0,d2 / beq / addq.w #$1   rounded up to even
 *
 * Book.dbf: 128 + 192 + 5*16 + 130 = 530, already even.
 */
export function dbfBankSize(headerLength: number, recordLength: number): number {
  const masked = headerLength & 0xfff0
  const n = (masked >> 5) - 1
  const size = BANK_HEAD + masked + n * BANK_CFIELD_LEN + recordLength
  return size & 1 ? size + 1 : size
}

/** where the computed-field table starts inside the bank */
export const dbfCFieldOffset = (headerLength: number): number => BANK_HEAD + (headerLength & 0xfff0)

/** where the one buffered record sits: the end of the bank, less its length */
export const dbfRecordOffset = (headerLength: number, recordLength: number): number =>
  dbfBankSize(headerLength, recordLength) - recordLength

/**
 * Trailing spaces off a field, as `Db Cutspace On` asks for.
 *
 * Routine 25 walks back with `cmpi.b #$20,-(a1) / dbne` ($ac6) and then tests
 * `cmpi.w #$ffff,d4` — the counter running past the start, which is a field
 * of nothing but spaces — and answers the empty string for it. Only $20
 * counts; a field padded with NULs keeps them.
 */
export function cutSpace(s: string): string {
  let n = s.length
  while (n > 0 && s.charCodeAt(n - 1) === DBF_LIVE) n--
  return s.slice(0, n)
}
