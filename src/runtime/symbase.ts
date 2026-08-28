/**
 * SymBase 0.94 and DBench 0.42 — Lázár Zoltán's xBase engine, at slot 21.
 *
 * One product at two ages. DBench's 23 named keywords are SymBase's first 23
 * in the same order; 0.94 added 28 more and renumbered two ids doing it (see
 * the registry note). Both binaries claim slot 21 in their own routine 0,
 * which is what successive builds should do, and only one is ever loaded.
 *
 * The file format is in ./dbf.ts. This is the engine over it: channels, the
 * bank each one lives in, and the record pointer.
 *
 * ## Batch 2 of four
 *
 * Channels and navigation. The field accessors are #143 and the record
 * operations #144; until those land the row reads 0%, which is what an
 * extension row is supposed to read while it is being built.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier over `AmosPro_SymBase.Lib` (the archive's `SBASE_EX`,
 * renamed by its own Installer: `(set #libname "SBASE_EX")` then
 * `(set #newlibname "AmosPro_SymBase.Lib")`), with two AmigaGuides beside it.
 * `Comp/SymBase/Docs/SymBase.guide` is 0.94's, 47 nodes and mostly Hungarian;
 * `DataBench.Guide` is 0.42's, 18,902 bytes and English apart from the two
 * format nodes. Both document the formats and neither documents the code, so
 * every citation below is an address in the 5,524-byte hunk.
 *
 * Where they disagree the binary wins, and it wins three times here. The
 * guide's `db_use` node promises `Db Goto Db Reccount+1` appends a record;
 * routine 26 refuses it. Its `db_close` node lists "No file is used!" as an
 * error; routine 7 returns silently. And its "Dbase" bank name is "Xbase".
 *
 * ## The data zone
 *
 * `$238(a5)` — `ExtAdr` is $f8 with sixteen bytes a slot (+Equ.s:1185), so
 * ($238-$f8)/16+1 = 21. It is a static block in the library's own hunk at
 * $518, and its first sixteen bytes are the same in both binaries:
 *
 *     +$00  $0000012c   the bank number channel 1 lives in, less one
 *     +$04  $00000001   the current channel, which starts at 1
 *     +$08  $00000000   how many channels are open
 *     +$0c  $00000032   50, and nothing read so far uses it
 *     +$17              Db Setdeleted, a byte
 *     +$24              the record number Db Goto and Db Skip ask for
 *     +$30              Db Cutspace, a byte, and $ff at boot in 0.94
 *
 * A CHANNEL IS AN AMOS BANK. `Db State` is `L_Bnk_GetAdr` on
 * `$4(a2) + $0(a2)` and nothing else ($984), so channel n is bank 300+n and
 * "is this channel in use" means "does that bank exist". Erasing the bank
 * behind the extension's back closes the database, and that is reproduced
 * here by reserving a real one.
 *
 * ## Two things routine 85 does that no guide would tell you
 *
 * It seeks TWICE. `Seek(fh, (n-1)*RecLe + HeadLe, OFFSET_BEGINNING)`, then
 * `Read`, then the same seek again from the saved registers ($1414-$1420) —
 * so after reading a record the file position sits back at that record's
 * START. That is what lets routine 84's flush be a bare `Write` with no seek
 * of its own, and it is why the flush in `Db Goto` can happen BEFORE the
 * seek to the new record.
 *
 * And the record offset is a 32-bit multiply done in two halves — `mulu.w`
 * on the low word, `swap`, `mulu.w` again, `swap`, `add.l` — because the
 * 68000 has no 32-bit multiply. A database past 65,535 records needs it.
 */
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { fromFFP, toFFP } from './runtime'
import { AmosError, funcCall, int, str, VF, VI, VS } from '../interp/values'
import type { Dbf } from './dbf'
import {
  BANK_HEAD,
  DBF_DELETED,
  DBF_EOF,
  DBF_FLOAT_LEN,
  DBF_LIVE,
  DbfError,
  cutSpace,
  dbfBankSize,
  parseDbf,
} from './dbf'

/**
 * `$0(a2)` is $12c and the channel is added to it, so channel 1 is bank 301.
 * A program can `Bank Erase 301` and `Db State` goes false, which is the
 * behaviour and not an accident of the numbering.
 */
export const DB_BANK_BASE = 0x12c
/** `L_Bnk_Reserve` is given the name at data+$94, and it is not the guide's "Dbase" */
export const DB_BANK_NAME = 'Xbase'

/**
 * The extension's own error table, at $14b2 and raised through routine 98:
 * `moveq #$0,d1 / moveq #$14,d2 / moveq #$0,d3 / Rjmp L_ErrorExt`. d2 is 20,
 * the slot zero-based; d1 is 0, so every one of them is trappable.
 *
 * Seven strings are there and four are reachable from the routines read so
 * far. "Not implemented yet :(" is the author's own placeholder and is left
 * in the table because it is in his.
 */
export const SYMBASE_ERRORS = [
  'Channel already used!',
  'Not a Dbase file!',
  'No database is used!',
  'String is longer than the field!',
  'Not implemented yet :(',
  "Can't allocate memory!",
  'Database is corrupt!',
]

const err = (n: number): never => {
  throw new AmosError(SYMBASE_ERRORS[n] ?? `SymBase error ${n}`)
}

/** one open channel: the bank, the file behind it, and where we are in it */
export interface SymBaseChannel {
  /** the AMOS bank number, `DB_BANK_BASE + channel` */
  bank: number
  /** the path `Db Use` opened, after `L_Dsk_PathIt` */
  path: string
  /** the file as it stands on disc, patched record by record */
  image: Uint8Array
  /** the header and field descriptors, read once by `Db Use` */
  db: Dbf
  /** the one buffered record the bank has room for, `DB_RecSt` */
  record: Uint8Array
  /** `DB_RecNum`. Authoritative once the file is open: `Db Append` and
   * `Db Pack` move it, and `db.records` is only what `Db Use` parsed */
  count: number
  /** `DB_CurRec`, one-based; 0 before the first `Db Goto` */
  current: number
  /** `DB_SAVED`: false means the buffer differs from the file */
  saved: boolean
  /** `DB_Order`, the sorted field, 0 for natural order */
  order: number
  /** `DB_Indexhd` — the .ndx `Db Order` opened, by name; nothing reads it */
  index: string | null
  /** data+$44: `Db Header Update Off` suppresses the count write-back */
  headerUpdateOff: boolean
}

export interface SymBaseState {
  channels: Map<number, SymBaseChannel>
  /** data+$04 */
  sel: number
  /** data+$30, and $ff in the shipped 0.94 image */
  cutspace: boolean
  /** data+$17 */
  setdeleted: boolean
  /** data+$31, which `Db Found` sign-extends */
  found: number
  /** data+$34 and data+$32: the needle `Db Locate` copied and its length */
  needle: string
  /** data+$3c: where the last compare started, which routine 40 leaves stale */
  matchAt: number
  /** data+$24: `Db Get`'s StrToLong destination, kept when the parse fails */
  strToLong: number
  /** the mapped address `Db Address` answers */
  base: number
  /** the data zone's own bytes, so `Db Address` has something behind it */
  zone: Uint8Array
}

/**
 * Routine 9 ($878) — a field's LENGTH, and 0 when the number is past the
 * count. `move.b $11(a0,d4.w),d3 / swap / move.b $10(a0,d4.w),d3` builds
 * `(decimals << 16) | length`, and every caller then does `andi.l #$ff,d3`,
 * so the decimals half is computed and thrown away by all four of them.
 */
const fieldLen = (c: SymBaseChannel, f: number): number =>
  f >= 1 && f <= c.db.fields.length ? c.db.fields[f - 1]!.length : 0

/**
 * Routine 73 ($11bc) — where a field's bytes are.
 *
 * `movea.l $a(a0),a2 / addq.l #$1,a2` is DB_RecSt PLUS ONE, so the deleted
 * flag is stepped over here rather than in the computed table `Db Use` built
 * — which is why that table's first entry is 0.
 */
const fieldAt = (c: SymBaseChannel, f: number): number => c.db.fields[f - 1]!.offset

/** the raw bytes of field f in the buffered record */
function fieldRaw(c: SymBaseChannel, f: number): string {
  const at = fieldAt(c, f)
  const n = fieldLen(c, f)
  let out = ''
  for (let i = 0; i < n; i++) out += String.fromCharCode(c.record[at + i] ?? 0)
  return out
}

export function newSymBaseState(rt: Runtime): SymBaseState {
  const zone = new Uint8Array(0x100)
  // the shipped image, so a program peeking through Db Address sees what it
  // would see before Db Use is ever called
  zone[0x02] = 0x01
  zone[0x03] = 0x2c
  zone[0x07] = 0x01
  zone[0x0f] = 0x32
  zone[0x30] = 0xff
  return {
    channels: new Map(),
    sel: 1,
    cutspace: true,
    setdeleted: false,
    found: 0,
    needle: '',
    matchAt: 0,
    strToLong: 0,
    base: rt.extBlockBase('symbase-0.94', zone),
    zone,
  }
}

export function makeSymBaseInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): SymBaseState => rt.symbase

  /** the bank a channel lives in, and whether AMOS still has it */
  const bankLive = (channel: number): boolean =>
    rt.memBanks.has(DB_BANK_BASE + channel) && st().channels.has(channel)

  /**
   * Routine 86 ($143a): the current channel's bank, or "No database is used!"
   * through routine 87. Every navigation keyword opens with it.
   */
  const chan = (): SymBaseChannel => {
    const s = st()
    if (!bankLive(s.sel)) err(2)
    return s.channels.get(s.sel)!
  }

  /**
   * Routine 84 ($1392) — write the buffered record back.
   *
   * A bare `Write` of `DB_RecLe` bytes at wherever the file position is,
   * which routine 85 left at this record's start. DEVIATION: there is no open
   * file handle here, so the record is patched into the image and the image
   * written. The bytes that land on disc are the same ones and in the same
   * place; what differs is that the whole file is rewritten, so a second
   * program editing the same file between two records would lose its change
   * where the original would keep it.
   */
  const flush = (c: SymBaseChannel): void => {
    if (c.saved || c.current < 1) return
    const at = c.db.headerLength + (c.current - 1) * c.db.recordLength
    if (at + c.db.recordLength <= c.image.length) {
      c.image.set(c.record, at)
      // the header is NOT rewritten: routine 84 writes RecLe bytes and
      // nothing else, and DB_RecNum only reaches the file through
      // `Db Header Update`
      if (!rt.vfs?.writeFile(c.path, c.image)) throw new AmosError('disc is write protected', 84)
    }
    c.saved = true
  }

  /**
   * Routine 85 ($13c0) — seek, read, seek back, and remember which record.
   *
   * The second seek is the point; see the file comment. A read that fails
   * leaves `DB_CurRec` alone, which is the `beq $1430` arm.
   */
  const readRecord = (c: SymBaseChannel, n: number): void => {
    const at = c.db.headerLength + (n - 1) * c.db.recordLength
    if (at + c.db.recordLength > c.image.length) return
    c.record.set(c.image.subarray(at, at + c.db.recordLength))
    c.current = n
    c.saved = true
  }

  /** `Db Deleted`'s test, which `Db Skip` needs before the keyword exists (batch 4) */
  const isDeleted = (c: SymBaseChannel): boolean => c.record[0] === DBF_DELETED

/**
   * Routine 40 ($e1c) — compare, skip, repeat.
   *
   * `cmpm.b (a2)+,(a1)+` over `Len(needle)` bytes from the field's start. A
   * match sets data+$31 to $ff. A mismatch calls `Db Skip` and comes back;
   * when the skip cannot move (d0 zero, the last record) the search is over.
   */
  const locateHere = (c: SymBaseChannel): void => {
    const s = st()
    for (;;) {
      const at = s.matchAt
      let i = 0
      for (; i < s.needle.length; i++) {
        if (c.record[at + i] !== (s.needle.charCodeAt(i) & 0xff)) break
      }
      if (i >= s.needle.length) {
        s.found = -1
        s.zone[0x31] = 0xff
        return
      }
      if (c.current >= c.count) {
        /**
         * DEFECT: the not-found arm never reloads a2, so the store lands at
         * `fieldAddress + compared + $31` in the record buffer rather than at
         * data+$31 --- `Db Found` keeps its previous value and a byte of the
         * bank is cleared instead. `Db Locate`'s own block has the reading.
         */
        const stray = at + i + 1 + 0x31
        if (stray >= 0 && stray < c.record.length) c.record[stray] = 0
        return
      }
      flush(c)
      readRecord(c, c.current + 1)
    }
  }

  const locate = (c: SymBaseChannel, f: number): void => {
    st().matchAt = fieldAt(c, f)
    locateHere(c)
  }

  /** the file's data region: the header, then `count` records, then `$1a` */
  const resize = (c: SymBaseChannel): void => {
    const want = c.db.headerLength + c.count * c.db.recordLength + 1
    if (c.image.length === want) return
    const next = new Uint8Array(want)
    next.set(c.image.subarray(0, Math.min(c.image.length, want)))
    c.image = next
  }

  /** where record n starts in the image */
  const recAt = (c: SymBaseChannel, n: number): number =>
    c.db.headerLength + (n - 1) * c.db.recordLength

  /**
   * Routine 75 ($1220) — the record count back into the file header.
   *
   * Four `lsr.l`/`lsl.l` pairs turn DB_RecNum round into the header copy at
   * bank+$84, then `Seek(fh, 0, OFFSET_BEGINNING)` and a write. Guarded by
   * `tst.l $44(a2) / bne rts`, which is what `Db Header Update Off` sets.
   */
  const headerUpdate = (c: SymBaseChannel): void => {
    if (c.headerUpdateOff) return
    c.image[4] = c.count & 0xff
    c.image[5] = (c.count >> 8) & 0xff
    c.image[6] = (c.count >> 16) & 0xff
    c.image[7] = (c.count >> 24) & 0xff
    write(c)
  }

  /** routine 76 ($126e): one byte from data+$68, which is the `$1a` a file ends with */
  const writeEof = (c: SymBaseChannel): void => {
    if (c.image.length > 0) c.image[c.image.length - 1] = DBF_EOF
  }

  const write = (c: SymBaseChannel): void => {
    if (!rt.vfs?.writeFile(c.path, c.image)) throw new AmosError('disc is write protected', 84)
  }

  /** the one-based field number, or AMOS error 23 (`Rble routine 90`) */
  const field = (c: SymBaseChannel, f: number): number => {
    if (f <= 0 || f > c.db.fields.length) funcCall()
    return f
  }

  /**
   * Routine 82 ($1306) — put the buffer on the end.
   *
   * `Seek(fh, RecNum * RecLe + HeadLe, OFFSET_BEGINNING)`, write the record
   * (routine 84), write the `$1a` (76), RecNum + 1, header update (75), then
   * `DB_CurRec = RecNum` and a seek back so the buffer is the new record.
   */
  const appendBuffer = (c: SymBaseChannel): void => {
    c.count += 1
    resize(c)
    c.image.set(c.record, recAt(c, c.count))
    writeEof(c)
    c.current = c.count
    c.saved = true
    headerUpdate(c)
    write(c)
  }

  return {
    /**
     * Db Use f$ — routine 6 ($5fc), 498 bytes and the only one that reads a
     * file. In order:
     *
     *     L_Bnk_GetAdr on the channel's bank / Rbne routine 91
     *     the name, capped at $80 with `cmpi.w #$80,d0 / Rbcc routine 90`
     *     L_Dsk_PathIt
     *     Open(name, $3ed)                      MODE_OLDFILE
     *     Read(fh, zone+$48, 32)                the header
     *     cmpi.b #$3,$48(a2) / bne              and $03 alone
     *     six rol.w to turn three little-endian numbers round
     *     L_Bnk_Reserve                         a Work bank named "Xbase"
     *     Read(fh, bank+$80, HeadLe)            the header and descriptors again
     *     the computed field table, sixteen bytes each
     *     addq.l #$1,$8(a2)                     one more channel open
     *
     * A CHANNEL ALREADY IN USE IS AN ERROR, not a reopen: `Rbne routine 91`
     * is message 0, "Channel already used!". A name of 128 characters or more
     * is AMOS error 23.
     *
     * The last thing it does is the interesting one. `tst.l $10(a0)` is
     * DB_RecNum, and an EMPTY database takes `move.l #$0,$1c(a0)` — current
     * record 0 — where one with records falls into routine 85 with `d4 = 1`.
     * So `Db Use` on a file with rows leaves you on row one, and on an empty
     * file leaves `Db Recno` at zero.
     */
    'db use'(it) {
      const s = st()
      const name = it.evalStr()
      if (bankLive(s.sel)) err(0)
      // `move.w (a0)+,d0 / subq.w #$1,d0 / cmpi.w #$80,d0 / Rbcc routine 90`
      if (name.length - 1 >= 0x80) funcCall()
      const path = name
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      // Open() returning 0 is routine 89, AMOS error 94
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      let db: Dbf
      try {
        db = parseDbf(bytes)
      } catch (e) {
        if (e instanceof DbfError) err(1)
        throw e
      }
      const size = dbfBankSize(db.headerLength, db.recordLength)
      const bank = DB_BANK_BASE + s.sel
      rt.reserveBank(bank, size, DB_BANK_NAME, false, false)
      const c: SymBaseChannel = {
        bank,
        path,
        image: Uint8Array.from(bytes),
        db,
        record: new Uint8Array(db.recordLength),
        count: db.records.length,
        current: 0,
        saved: true,
        order: 0,
        index: null,
        headerUpdateOff: false,
      }
      s.channels.set(s.sel, c)
      // the bank's own bytes, as far as a program peeking into it can see:
      // the file header and the descriptors land at +$80
      const bk = rt.memBanks.get(bank)
      if (bk) bk.data.set(bytes.subarray(0, Math.min(db.headerLength, bk.data.length - BANK_HEAD)), BANK_HEAD)
      // `tst.l $10(a0) / bne` --- records means record one, none means zero
      if (c.count > 0) readRecord(c, 1)
    },

    /**
     * Db Close — routine 7 ($7ee).
     *
     * Closes the index handle if there is one (routine 74), flushes an
     * unsaved record (routine 77 into 84), `Close(fh)`, `L_Bnk_Eff` and one
     * off the open count.
     *
     * NO ERROR ON AN UNUSED CHANNEL. `L_Bnk_GetAdr / beq $836` returns
     * silently, where DBench's guide lists "No file is used!" as an error of
     * this keyword. The binary is what programs ran against.
     */
    'db close'() {
      const s = st()
      if (!bankLive(s.sel)) return
      const c = s.channels.get(s.sel)!
      flush(c)
      rt.eraseBank(c.bank)
      s.channels.delete(s.sel)
    },

    /**
     * Db Select n — routine 15 ($916), four instructions: `move.l (a3)+,d0 /
     * Rble routine 90 / move.l d0,$4(a2)`.
     *
     * Zero or negative is AMOS error 23 and there is NO upper bound: the
     * guide's *"you can open up to 65000 file at a time"* is a claim about
     * banks, not a check this keyword makes. Selecting a channel with nothing
     * in it is legal; `Db State` is how a program asks.
     */
    'db select'(it) {
      const n = it.evalInt()
      if (n <= 0) funcCall()
      st().sel = n
    },

    /**
     * Db Select First — routine 18 ($95a): the first channel that IS in use.
     *
     * `cmpi.l #$0,$8(a2) / Rbeq routine 87` — with nothing open at all it
     * raises "No database is used!" rather than doing nothing. Then it counts
     * up from 1 and stops on the first bank that exists.
     */
    'db select first'() {
      const s = st()
      if (s.channels.size === 0) err(2)
      for (let n = 1; ; n++) {
        if (bankLive(n)) {
          s.sel = n
          return
        }
      }
    },

    /**
     * Db Select Next — routine 17 ($932): the first channel that is NOT in
     * use, counting from 1.
     *
     * The guide's wording reads backwards and is right: *"Db Select First -
     * selects the first used channel"*, *"Db Select Next - selects the first
     * unused channel"*. Next is what a program calls before `Db Use`, and it
     * always starts its scan at 1 rather than at the current channel, so it
     * finds holes a close has left.
     */
    'db select next'() {
      const s = st()
      let n = 1
      while (bankLive(n)) n++
      s.sel = n
    },

    /**
     * Db Goto n — routine 26 ($b0c).
     *
     *     Rbsr routine 86              the bank, or "No database is used!"
     *     move.l (a3)+,$24(a2)         the number, kept in the data zone
     *     Rbsr routine 77              flush the current record if unsaved
     *     Rble routine 90              n <= 0 is AMOS error 23
     *     cmp.l $1c(a0),d4 / beq       already there: do nothing at all
     *     cmp.l $10(a0),d4 / Rble      within the file: read it
     *     Rbra routine 90              past the end is AMOS error 23
     *
     * THE FLUSH HAPPENS BEFORE THE RANGE CHECK, so `Db Goto 0` still writes
     * the pending record out and then raises.
     *
     * AND IT WILL NOT APPEND. DBench's guide says *"If n=Db Reccount+1, then
     * a new empty record will be added to the end of file"* and its own Bugs
     * node then says *"The current version can't add new record to the file.
     * (V 0.42)"*. 0.94 still cannot: `cmp.l $10(a0),d4 / Rble / Rbra routine
     * 90` refuses anything past the count. `Db Append` is what 0.94 added
     * instead, and it is batch 4.
     */
    'db goto'(it) {
      const c = chan()
      const n = it.evalInt()
      st().zone[0x27] = n & 0xff
      flush(c)
      if (n <= 0) funcCall()
      if (n === c.current) return
      if (n > c.count) funcCall()
      readRecord(c, n)
    },


    /**
     * Db Put$ text$, f — routine 28 ($b58), and DBench's `Db Put`, which is
     * the same routine under the name 0.94 renamed.
     *
     * The copy is `move.b (a1)+,(a2)+ / dbeq d3,$b80`, so it stops at the
     * field's width OR at a NUL in the source, then backs up one and pads the
     * rest of the field with `$20`. An empty string skips the copy entirely
     * (`move.w (a1)+,d0 / beq`) and blanks the field.
     *
     * IT DOES NOT RAISE. The table carries "String is longer than the field!"
     * as message 3 and this routine never reaches it: a long string is
     * truncated to the field and the rest is dropped. The guide says *"The
     * string must be equal or shorter as the field length"* and nothing
     * enforces it.
     */
    'db put$'(it) {
      const text = it.evalStr()
      it.expect(',')
      const c = chan()
      const f = field(c, it.evalInt())
      c.saved = false
      const at = fieldAt(c, f)
      const n = fieldLen(c, f)
      let i = 0
      if (text.length > 0) {
        for (; i < n; i++) {
          const b = text.charCodeAt(i) & 0xff
          c.record[at + i] = b
          if (b === 0 || Number.isNaN(text.charCodeAt(i))) break
        }
      }
      for (; i < n; i++) c.record[at + i] = DBF_LIVE
    },

    /**
     * Db Put text$, f — DBench 0.42's name for routine 27, which 0.94
     * renamed `Db Put$` and moved from token id $0174 to $0190. One handler
     * answers both because dispatch is by name and only one of the two
     * tables is ever bound.
     */
    'db put'(it) {
      const text = it.evalStr()
      it.expect(',')
      const c = chan()
      const f = field(c, it.evalInt())
      c.saved = false
      const at = fieldAt(c, f)
      const n = fieldLen(c, f)
      let i = 0
      if (text.length > 0) {
        for (; i < n; i++) {
          const b = text.charCodeAt(i) & 0xff
          c.record[at + i] = b
          if (b === 0) break
        }
      }
      for (; i < n; i++) c.record[at + i] = DBF_LIVE
    },

    /**
     * Db Putn n, f — routine 51 ($100e), the same shape with routine 72 doing
     * the number.
     *
     * Routine 72 is a right-aligned decimal render into the field's width: it
     * finds the first power of ten the value clears, pads the front with
     * spaces, and lays the digits down. A NEGATIVE value takes `tst.l d0 /
     * bmi $1198` at the very first instruction, which is a separate arm.
     */
    'db putn'(it) {
      const v = it.evalInt()
      it.expect(',')
      const c = chan()
      const f = field(c, it.evalInt())
      const n = fieldLen(c, f)
      if (n === 0) funcCall()
      c.saved = false
      const text = String(v)
      const at = fieldAt(c, f)
      const pad = Math.max(0, n - text.length)
      for (let i = 0; i < n; i++) {
        c.record[at + i] = i < pad ? DBF_LIVE : (text.charCodeAt(i - pad) & 0xff)
      }
    },

    /**
     * Db Putf x, f — routine 58 ($10c4): `move.l (a3)+,(a2)`.
     *
     * One longword, straight into the field, and it is the AMOS float's own
     * FFP bits rather than any text. That is what an `F` field holds, and it
     * is why `Db Flen` answers a flat sixteen for one ($842) where only the
     * first four bytes carry the number.
     */
    'db putf'(it) {
      const v = it.evalNum()
      it.expect(',')
      const c = chan()
      const f = field(c, it.evalInt())
      if (fieldLen(c, f) === 0) funcCall()
      c.saved = false
      const bits = toFFP(v) >>> 0
      const at = fieldAt(c, f)
      c.record[at] = (bits >>> 24) & 0xff
      c.record[at + 1] = (bits >>> 16) & 0xff
      c.record[at + 2] = (bits >>> 8) & 0xff
      c.record[at + 3] = bits & 0xff
    },

    /** Db Saved On — routine 11 ($8b6), `move.l #$ffffffff,$34(a0)`: the buffer matches the file */
    'db saved on'() {
      chan().saved = true
    },
    /**
     * Db Saved Off — routine 12 ($8c4), the same store with 0.
     *
     * The guide's example is the point of it: `Db Goto 10 / Db Put "123",2 /
     * Db Saved On / Db Close` and *"The above don't change the 2nd field of
     * the 10th record"* — saying the record is already saved is how a program
     * throws an edit away.
     */
    'db saved off'() {
      chan().saved = false
    },

    /** Db Cutspace On — routine 44 ($ea6), `move.b #$ff,$30(a0)`, and $ff is what the shipped image holds */
    'db cutspace on'() {
      st().cutspace = true
      st().zone[0x30] = 0xff
    },
    /** Db Cutspace Off — routine 45 ($eb2), the same byte cleared */
    'db cutspace off'() {
      st().cutspace = false
      st().zone[0x30] = 0
    },

    /** Db Setdeleted On — routine 42 ($e8e), `move.b #$ff,$17(a0)`: Db Skip steps over deleted records */
    'db setdeleted on'() {
      st().setdeleted = true
      st().zone[0x17] = 0xff
    },
    /** Db Setdeleted Off — routine 43 ($e9a) */
    'db setdeleted off'() {
      st().setdeleted = false
      st().zone[0x17] = 0
    },

    /**
     * Db Delete — routine 31 ($c28): `move.b #$2a,$0(a1)` on the buffered
     * record and `DB_SAVED = 0`.
     *
     * It marks and nothing else. The `*` reaches the file at the next flush,
     * which is the next `Db Goto`, `Db Skip` or `Db Close` — so a delete
     * followed by `Db Saved On` never happens.
     */
    'db delete'() {
      const c = chan()
      c.record[0] = DBF_DELETED
      c.saved = false
    },

    /** Db Recall — routine 32 ($c40), the same store with `$20`: the mark comes off */
    'db recall'() {
      const c = chan()
      c.record[0] = DBF_LIVE
      c.saved = false
    },

    /**
     * Db Append — routine 81 ($12ee): flush, force the flag live, and put the
     * buffer on the end. What is appended is whatever the buffer holds, so
     * the idiom is `Db Goto n / Db Append` to copy a record.
     */
    'db append'() {
      const c = chan()
      flush(c)
      c.record[0] = DBF_LIVE
      appendBuffer(c)
    },

    /**
     * Db Append Blank — routine 79 ($12c8): the same, with the WHOLE buffer
     * filled with `$20` first — `move.w $8(a0),d0 / subq.w #$1,d0` is RecLe
     * bytes, the deleted flag included, so the blank record is live.
     */
    'db append blank'() {
      const c = chan()
      flush(c)
      c.record.fill(DBF_LIVE)
      appendBuffer(c)
    },

    /**
     * Db Append From n, ... — routine 80 ($12ea), which is one instruction:
     * `Rbra routine 94`, and routine 94 is `moveq #$4,d0 / Rbra routine 98`.
     *
     * Message 4 is "Not implemented yet :(" in the author's own hand. The
     * keyword is in the table, has a spec, and raises the moment it is
     * called. DEFECT is the wrong word for it — it is unfinished, and it says
     * so.
     */
    'db append from'(it) {
      void it.evalInt()
      if (it.accept(',')) void it.evalExpr()
      err(4)
    },

    /**
     * Db Swap a, b — routine 29 ($b98) into routine 30 ($bc6).
     *
     * Both numbers are checked against 1..RecNum and equal numbers are a
     * no-op (`cmp.l d1,d2 / Rbne routine 30`). The swap itself borrows RecLe
     * bytes of fast memory, repoints `DB_RecSt` at it to read the second
     * record without losing the first, and writes each back — so the buffered
     * record ends up holding record `a`.
     */
    'db swap'(it) {
      const c = chan()
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      if (a <= 0 || a > c.count || b <= 0 || b > c.count) {
        funcCall()
      }
      if (a === b) return
      const ra = c.image.slice(recAt(c, a), recAt(c, a) + c.db.recordLength)
      const rb = c.image.slice(recAt(c, b), recAt(c, b) + c.db.recordLength)
      c.image.set(rb, recAt(c, a))
      c.image.set(ra, recAt(c, b))
      write(c)
      // routine 30 leaves the buffer holding record `a`, which is the last
      // one it read back through DB_RecSt
      c.record.set(c.image.subarray(recAt(c, a), recAt(c, a) + c.db.recordLength))
      c.current = a
      c.saved = true
    },

    /**
     * Db Pack — routine 34 ($c80): drop every deleted record and shorten the
     * file.
     *
     * The write cursor starts at ZERO and only becomes a record number when
     * the first deleted record is met (`move.l $28(a2),$24(a2)`, $d22), so a
     * file with nothing deleted is walked and then left alone —
     * `tst.l $24(a2) / bne / rts`. After the compaction it is
     * `RecNum = cursor - 1`, `SetFileSize` at the cursor, the `$1a` (routine
     * 76) and a header update (75).
     */
    'db pack'() {
      const c = chan()
      flush(c)
      let dest = 0
      for (let src = 1; src <= c.count; src++) {
        const at = recAt(c, src)
        if (c.image[at] === DBF_DELETED) {
          if (dest === 0) dest = src
          continue
        }
        if (dest !== 0) {
          c.image.copyWithin(recAt(c, dest), at, at + c.db.recordLength)
          dest += 1
        }
      }
      if (dest === 0) return
      c.count = dest - 1
      resize(c)
      writeEof(c)
      headerUpdate(c)
      write(c)
    },

    /**
     * Db Zap — routine 35 ($d2c): every record, gone.
     *
     * `clr.l $10(a0) / clr.l $1c(a0)`, a header update, a seek to record ONE
     * and `SetFileSize`. Note what it does NOT do: there is no routine 76
     * here, so a zapped file ends at its header with no `$1a` where `Db Pack`
     * leaves one.
     */
    'db zap'() {
      const c = chan()
      c.count = 0
      c.current = 0
      c.saved = true
      c.image = c.image.slice(0, c.db.headerLength)
      headerUpdate(c)
      write(c)
    },

    /**
     * Db Order name$ — routine 52 ($1034).
     *
     * Closes any index already open (routine 74), caps the name at $80,
     * `L_Dsk_PathIt`, `Open(name, MODE_OLDFILE)` and stores the handle in
     * `DB_Indexhd`. A file that will not open is AMOS error 94.
     *
     * AND NOTHING READS IT. `$2c(a0)` is touched by exactly three places in
     * the whole library — this, routine 74 which closes it, and the test at
     * the top of this routine. No navigation keyword consults the index, so
     * in 0.94 `Db Order` opens a file and changes nothing about how records
     * are read. The guide documents an `Index_head` format for it.
     */
    'db order'(it) {
      const name = it.evalStr()
      const c = chan()
      if (name.length - 1 >= 0x80) funcCall()
      const bytes = rt.vfs?.readFile(name) ?? rt.fs?.read(name) ?? null
      if (!bytes) throw new AmosError(`file not found: ${name}`, 94)
      c.index = name
    },

    /**
     * Db Sort f, a To b — routine 53 ($108a) into routine 54 ($1094), and the
     * one-argument form is routine 54 on its own.
     *
     * Together they are five instructions: three pops, `Rbsr routine 86`, and
     * an `rts`. **`Db Sort` DOES NOTHING.** It takes its arguments, checks a
     * database is open, and returns — no sort, no error, not even the "Not
     * implemented yet :(" that `Db Append From` raises. A program calling it
     * gets its records in the order they were already in.
     */
    'db sort'(it) {
      void it.evalInt()
      if (it.accept(',')) {
        void it.evalInt()
        if (it.accept('to')) void it.evalInt()
      }
      chan()
    },

    /** Db Header Update Off — routine 55 ($109c), `move.l #$ffffffff,$44(a2)` */
    'db header update off'() {
      chan().headerUpdateOff = true
    },
    /**
     * Db Header Update — routine 56 ($10aa): clear the suppression AND write
     * the count out now. `move.l #$0,$44(a2) / Rbsr routine 75`, in that
     * order, so it is both the switch and the flush.
     */
    'db header update'() {
      const c = chan()
      c.headerUpdateOff = false
      headerUpdate(c)
    },

    /**
     * Db Notify — routine 47 ($f34): close the file and open it again at the
     * same position.
     *
     * `Seek(fh, 0, OFFSET_CURRENT)` for where we are, 80 bytes of fast
     * memory, `NameFromFH` to recover the file's own name, `Close`, `Open`
     * with MODE_OLDFILE, then `Seek` back. Every failure frees the buffer and
     * raises AMOS error 94; a failed allocation is "Can't allocate memory!".
     *
     * What it is FOR is the round trip: the writes this program has made are
     * committed and anything another program changed becomes visible. That is
     * what it does here, minus the handle there is no model for.
     */
    'db notify'() {
      const c = chan()
      flush(c)
      const bytes = rt.vfs?.readFile(c.path) ?? rt.fs?.read(c.path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${c.path}`, 94)
      c.image = Uint8Array.from(bytes)
      const n = c.current
      if (n >= 1 && n <= c.count) readRecord(c, n)
    },

    /**
     * Db Locate f, text$[, from[, ?]] — routine 36 ($d62) and its two shorter
     * arities (37 at $d78 and 38 at $d8c), all three into routine 39.
     *
     * The four-argument form starts at a given record: it pops the last
     * argument, stores it at data+$38 and goes through `Db Goto`. The others
     * clear data+$38 and start where they are.
     *
     * Routine 39 copies the needle into fast memory with its length, resolves
     * the field's address through routine 73, and hands off to routine 40 —
     * `cmpm.b (a2)+,(a1)+` over the needle's length, with a `Db Skip` and
     * another go on a mismatch. So it is a LINEAR scan comparing the field's
     * first `Len(text$)` bytes, not a substring search and not a whole-field
     * match: `Db Locate 1,"Ad"` finds "Ada" because only two bytes are read.
     *
     * DEFECT: one instruction apart. The FOUND path reloads a2 from the
     * data zone before writing the flag (`movea.l $238(a5),a2 / move.b
     * #$ff,$31(a2)`, $e38). The NOT-FOUND path does not: a2 is still the
     * field pointer that `cmpm.b` has been walking, so `move.b #$0,$31(a2)`
     * at $e4e stores a zero into the record buffer at
     * `fieldAddress + compared + $31` instead. Two things follow, and both
     * are reproduced: `Db Found` keeps its PREVIOUS value after a search that
     * fails, and a byte of the bank is quietly cleared.
     */
    'db locate'(it) {
      const c = chan()
      const s = st()
      const f = it.evalInt()
      it.expect(',')
      const text = it.evalStr()
      let from = 0
      if (it.accept(',')) {
        from = it.evalInt()
        if (it.accept(',')) void it.evalInt()
      }
      s.needle = text
      if (from > 0) {
        flush(c)
        if (from <= 0 || from > c.count) funcCall()
        if (from !== c.current) readRecord(c, from)
      }
      field(c, f)
      s.matchAt = fieldAt(c, f)
      locate(c, f)
    },

    /**
     * Db Continue — routine 50 ($ff6): one more record, then the same compare
     * loop (routine 40).
     *
     * It reads data+$38 and branches on it to the very next instruction
     * either way (`tst.l $38(a2) / beq.w $1002` where the fall-through is
     * $1002), so the test does nothing at all. What follows is a `Db Skip`
     * and routine 40 — which means `Db Continue` before any `Db Locate`
     * compares against whatever needle is left in the data zone, and at the
     * start of a run that is an empty one.
     */
    'db continue'() {
      const c = chan()
      const s = st()
      if (c.current >= c.count) {
        // Db Skip could not move, so routine 40's not-found arm runs at once
        s.zone[0x31] = 0
        return
      }
      flush(c)
      readRecord(c, c.current + 1)
      locateHere(c)
    },

    /**
     * Db Skip — routine 41 ($e56): forward one record, and no further.
     *
     *     cmp.l $10(a0),d0 / beq       already on the last record: nothing
     *     addq.l #$1,d0 / routine 27   read the next
     *     tst.b $17(a0) / beq          unless Db Setdeleted is on, done
     *     routine 33 / tst.l d3 / beq  a live record, done
     *     Rbsr routine 41              a deleted one: skip again
     *
     * The last line is a real recursive call, so a run of deleted records at
     * the end of a file nests as deep as the run is long. It terminates
     * because the first test stops at the last record.
     *
     * There is no `Db Skip -1` and no argument at all: the spec is `I`.
     */
    'db skip'() {
      const c = chan()
      for (;;) {
        if (c.current >= c.count) return
        flush(c)
        readRecord(c, c.current + 1)
        if (!st().setdeleted) return
        if (!isDeleted(c)) return
      }
    },
  }
}

export function makeSymBaseFunctions(rt: Runtime): Record<string, Func> {
  const st = (): SymBaseState => rt.symbase
  const bankLive = (channel: number): boolean =>
    rt.memBanks.has(DB_BANK_BASE + channel) && st().channels.has(channel)
  const chan = (): SymBaseChannel => {
    const s = st()
    if (!bankLive(s.sel)) err(2)
    return s.channels.get(s.sel)!
  }

  return {
    /**
     * =Db Address — routine 4 ($5e6), three instructions: `movea.l $238(a5),a0
     * / move.l a0,d3`. The data zone itself, which the guide calls *"the
     * address of the extension's internal data zone"* and which a program
     * Peeks through to reach the fields no keyword exposes.
     */
    'db address': () => VI(st().base | 0),

    /** =Db Sel — routine 5 ($5f0), `move.l $4(a0),d3`: the current channel */
    'db sel': () => VI(st().sel),

    /**
     * =Db Opencount — routine 16 ($926), `move.l $8(a0),d3`.
     *
     * The COUNTER at data+$08, which `Db Use` increments and `Db Close`
     * decrements — not a scan. A program that erases a channel's bank itself
     * leaves this reading one too many, and the guide's own example loop
     * (`For i=1 to Db Opencount / Db Select First / Db Close / Next i`)
     * depends on the counter being right.
     */
    'db opencount': () => VI(st().channels.size),

    /**
     * =Db State — routine 19 ($984): `L_Bnk_GetAdr` on this channel's bank,
     * -1 if it is there and 0 if it is not.
     *
     * It asks AMOS, not the extension, which is why erasing bank 300+n from a
     * program turns the channel off.
     */
    'db state': () => VI(bankLive(st().sel) ? -1 : 0),

    /** =Db Reccount — routine 20 ($9aa), `move.l $10(a0),d3`: DB_RecNum */
    'db reccount': () => VI(chan().count),

    /** =Db Recno — routine 21 ($9b6), `move.l $1c(a0),d3`: DB_CurRec, zero on an empty file */
    'db recno': () => VI(chan().current),

    /**
     * =Db Recle — routine 22 ($9c2): `move.w $8(a0),d3 / subi.w #$1,d3`.
     *
     * MINUS ONE. The stored `DB_RecLe` counts the deleted flag — *"a hosszba
     * beleszámít a deleted flag byte is"* — and this keyword takes it back
     * off, so what a program gets is the width of the data. For Book.dbf that
     * is 129 where the file's own header says 130.
     */
    'db recle': () => VI(chan().db.recordLength - 1),

    /** =Db Fieldno — routine 10 ($8a8), `move.w $e(a0),d3`: DB_FieldNum */
    'db fieldno': () => VI(chan().db.fields.length),
/**
     * =Db Ftype(f) — routine 14 ($8e0): the descriptor's byte 11, as a
     * number. A program compares against `Asc("C")`.
     *
     * The range test is `ble` on zero and `cmp.w $e(a0),d3 / bgt`, so a field
     * number outside 1..Db Fieldno is AMOS error 23.
     */
    'db ftype': (_, a) => {
      const c = chan()
      const f = int(a[0]!)
      if (f <= 0 || f > c.db.fields.length) funcCall()
      return VI(c.db.fields[f - 1]!.type.charCodeAt(0))
    },

    /**
     * =Db Flen(f) — routine 8 ($83a).
     *
     * It asks `Db Ftype` FIRST and short-circuits: `cmpi.b #$46,d3 / bne`,
     * so an `F` field answers a flat sixteen and its own length byte is never
     * read. Everything else is `move.b $10(a0,d4.w),d3`, the descriptor's
     * DBF_FieldLe.
     */
    'db flen': (_, a) => {
      const c = chan()
      const f = int(a[0]!)
      if (f <= 0 || f > c.db.fields.length) funcCall()
      const fd = c.db.fields[f - 1]!
      return VI(fd.type === 'F' ? DBF_FLOAT_LEN : fd.length)
    },

    /**
     * =Db Field$(f) — routine 23 ($9d4): the field's NAME.
     *
     * It walks up to ten bytes for a NUL and raises "Database is corrupt!"
     * (routine 96) if it does not find one — a descriptor whose name fills
     * all ten bytes with no terminator is a corrupt file by this reading,
     * which is stricter than the format is.
     */
    'db field$': (_, a) => {
      const c = chan()
      const f = int(a[0]!)
      if (f <= 0 || f > c.db.fields.length) funcCall()
      const name = c.db.fields[f - 1]!.name
      if (name.length > 10) err(6)
      return VS(name)
    },

    /**
     * =Db Field(n$) — routine 24 ($a3c): the NUMBER of the field with that
     * name, or -1.
     *
     * It walks the descriptors BACKWARDS from the last one and compares the
     * name bytes backwards too (`dbra d2` down from the length), so with two
     * fields of the same name it answers the LATER one. An empty string is
     * AMOS error 23 (`move.w (a1)+,d0 / Rbeq routine 90`).
     */
    'db field': (_, a) => {
      const c = chan()
      const n = str(a[0]!)
      if (n.length === 0) funcCall()
      for (let i = c.db.fields.length - 1; i >= 0; i--) {
        if (c.db.fields[i]!.name === n) return VI(i + 1)
      }
      return VI(-1)
    },

    /**
     * =Db Get$(f) — routine 25 ($a98), the one every program uses.
     *
     * Routine 9 for the width, routine 73 for the address, then the cutspace
     * walk if data+$30 is set: `cmpi.b #$20,-(a1) / dbne` back from the end,
     * with `cmpi.w #$ffff,d4` catching a field of nothing but spaces and
     * answering the empty string. Only `$20` counts, so NUL padding survives.
     */
    'db get$': (_, a) => {
      const c = chan()
      const f = int(a[0]!)
      if (f <= 0) funcCall()
      if (f > c.db.fields.length) funcCall()
      const raw = fieldRaw(c, f)
      return VS(st().cutspace ? cutSpace(raw) : raw)
    },

    /**
     * =Db Found$(f) — routine 49 ($ff0), which is `Rbsr routine 25` and an
     * `rts`. It IS `Db Get$`, byte for byte, under a second name: there is no
     * separate buffer for a found record because the found record is the
     * current one.
     */
    'db found$': (_, a) => {
      const c = chan()
      const f = int(a[0]!)
      if (f <= 0 || f > c.db.fields.length) funcCall()
      const raw = fieldRaw(c, f)
      return VS(st().cutspace ? cutSpace(raw) : raw)
    },

    /**
     * =Db Get(f) — routine 46 ($ebe): the field as a NUMBER.
     *
     * A LOGICAL field is its own path: `cmpi.b #$4c,d4` on the type, then
     * `cmpi.b #$54,(a2)` — a literal 'T' is -1 and anything else is 0, so
     * 'Y', 't' and '1' all read false.
     *
     * Everything else goes through dos `StrToLong` (-$330), and the way it
     * gets a C string out of a fixed-width field is worth keeping: it saves
     * the byte just past the field, writes a NUL over it, converts, and puts
     * the byte back. THE RESULT IS NOT CHECKED. `StrToLong` answers -1 on a
     * field it cannot parse and this routine returns data+$24 regardless, so
     * a non-numeric field answers whatever the last successful conversion
     * left there.
     */
    'db get': (_, a) => {
      const c = chan()
      const s = st()
      const f = int(a[0]!)
      if (f <= 0 || f > c.db.fields.length) funcCall()
      const fd = c.db.fields[f - 1]!
      if (fd.type === 'L') return VI(c.record[fd.offset] === 0x54 ? -1 : 0)
      const text = fieldRaw(c, f)
      const m = /^\s*[+-]?\d+/.exec(text)
      if (m) s.strToLong = Number(m[0]) | 0
      return VI(s.strToLong)
    },

    /**
     * =Db Getf(f) — routine 59 ($10e6): `move.l (a2),d3` with `d2 = 1`, a
     * FLOAT result.
     *
     * Four bytes read as AMOS's own FFP, not as text. Nothing checks that the
     * field is type `F`, so this reads any field's first longword as a float.
     */
    'db getf': (_, a) => {
      const c = chan()
      const f = int(a[0]!)
      if (f <= 0 || f > c.db.fields.length) funcCall()
      const at = c.db.fields[f - 1]!.offset
      const bits =
        ((c.record[at]! << 24) | (c.record[at + 1]! << 16) | (c.record[at + 2]! << 8) | c.record[at + 3]!) >>> 0
      return VF(fromFFP(bits))
    },

    /**
     * =Db Recsaved — routine 13 ($8d2), `move.l $34(a0),d3`: DB_SAVED.
     *
     * The guide has it the right way round — *"If this is True, then the
     * record's current data is saved"* — so false is the state a `Db Put$`
     * leaves behind and the next positioning writes.
     */
    'db recsaved': () => VI(chan().saved ? -1 : 0),

    /**
     * =Db Deleted — routine 33 ($c58): `$2a` is -1 and `$20` is 0.
     *
     * ANY OTHER BYTE IS AN ERROR. `cmpi.b #$20,d0 / Rbne routine 96` raises
     * "Database is corrupt!", so a record whose flag is neither space nor
     * star stops the program rather than being guessed at.
     */
    'db deleted': () => {
      const c = chan()
      const flag = c.record[0]
      if (flag === DBF_DELETED) return VI(-1)
      if (flag !== DBF_LIVE) err(6)
      return VI(0)
    },

    /**
     * =Db Found — routine 48 ($fde): `move.b $31(a2),d3 / extb.l d3`, one
     * sign-extended byte.
     *
     * A search that FAILED does not clear it, for the reason `Db Locate`
     * gives: the not-found arm stores through the wrong register. So this
     * answers -1 after a hit and keeps answering -1 after the next miss.
     */
    'db found': () => VI(st().found),

    /**
     * =Db Alias(n) — routine 57 ($10bc), four instructions:
     * `move.l (a3)+,d3 / moveq #$0,d2 / illegal #$4afc / rts`.
     *
     * It pops its argument, sets up an integer return and then executes
     * ILLEGAL, the 68000's debugger trap. Whatever the author meant it to do,
     * what it does is stop the machine — the same instruction TURBO's
     * `Debug`, `Pdebug` and `Jd Private` use, and n/a here for the same
     * reason: deliberately crashing the interpreter is not a service.
     */
  }
}
