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
import { AmosError, VI } from '../interp/values'
import type { Dbf } from './dbf'
import {
  BANK_HEAD,
  DBF_DELETED,
  DbfError,
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
  /** `DB_CurRec`, one-based; 0 before the first `Db Goto` */
  current: number
  /** `DB_SAVED`: false means the buffer differs from the file */
  saved: boolean
  /** `DB_Order`, the sorted field, 0 for natural order */
  order: number
}

export interface SymBaseState {
  channels: Map<number, SymBaseChannel>
  /** data+$04 */
  sel: number
  /** data+$30, and $ff in the shipped 0.94 image */
  cutspace: boolean
  /** data+$17 */
  setdeleted: boolean
  /** the mapped address `Db Address` answers */
  base: number
  /** the data zone's own bytes, so `Db Address` has something behind it */
  zone: Uint8Array
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
      if (!rt.vfs?.writeFile(c.path, c.image)) throw new AmosError('disc is write protected')
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
      if (name.length - 1 >= 0x80) throw new AmosError('Illegal function call', 23)
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
        current: 0,
        saved: true,
        order: 0,
      }
      s.channels.set(s.sel, c)
      // the bank's own bytes, as far as a program peeking into it can see:
      // the file header and the descriptors land at +$80
      const bk = rt.memBanks.get(bank)
      if (bk) bk.data.set(bytes.subarray(0, Math.min(db.headerLength, bk.data.length - BANK_HEAD)), BANK_HEAD)
      // `tst.l $10(a0) / bne` --- records means record one, none means zero
      if (db.records.length > 0) readRecord(c, 1)
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
      if (n <= 0) throw new AmosError('Illegal function call', 23)
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
      if (n <= 0) throw new AmosError('Illegal function call', 23)
      if (n === c.current) return
      if (n > c.db.records.length) throw new AmosError('Illegal function call', 23)
      readRecord(c, n)
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
        if (c.current >= c.db.records.length) return
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
    'db reccount': () => VI(chan().db.records.length),

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
  }
}
