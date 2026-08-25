/**
 * The editor's program buffer, and the line table over it.
 *
 * A program being edited is not a list of lines. It is one block of tokens
 * with a zero word on the end, and every editor command that moves the cursor
 * or changes a line walks it from the top. `Prg_ChgTTexte` (+Verif.s:4758)
 * lays the block out: one allocation, `Prg_StMini` at the bottom and
 * `Prg_StHaut` at the top, a zero word written just under the top, and
 * `Prg_StBas` pointing at it. The text then grows DOWNWARD from the top, so
 * free space is `StBas - StMini` and that subtraction is what the status
 * line's free figure is (+Edit.s:7464).
 *
 * Which end grows matters, because it decides what an edit costs. Making a
 * line longer moves everything BEFORE it down (`StoI0` :11009), not
 * everything after it up. Editing line 1 moves nothing and editing the last
 * line moves the whole program.
 *
 * ## Editor line numbers are not physical lines
 *
 * `Tk_FindL` (+Verif.s:5043) is the line table, and there is no table: it
 * counts lines by walking. A CLOSED procedure is ONE line however many lines
 * its body holds -- `Fnd4` reads the size out of the Procedure line and steps
 * over the lot. An OPEN one contributes its `Procedure` line, every body
 * line, and its `End Proc`. So a fold changes every line number after it, and
 * nothing is cached that would have to be told.
 *
 * The same walk hands back `Edt_DebProc`, the open procedure the line is
 * inside, which is what `Ed_Loca` needs to draw the fold markers and what
 * decides whether a command is legal here (`FlagFonc` bit 2, +Edit.s:3341).
 */
import { TK } from '../tokens/edtok'
import { EMPTY_BANKS } from './files'

/** `_TkProc` and `_TkEndP`, the two ids the walk branches on */
const TK_PROC = TK.PROCEDURE
const TK_END_PROC = TK.END_PROC

/**
 * Bit 15 of the Procedure line's flags word at offset 10: the fold.
 *
 * `Ed_ProcOpen` is `bchg #7,10(a2)` (+Edit.s:8835) on the HIGH byte, which
 * `Tk_FindL` reads as `tst.w 10(a0) / bmi`. One bit, two spellings.
 */
export const PROC_CLOSED = 0x8000

/**
 * What a closed fold costs beyond the size word: `lea 12+2(a0,d1.l),a0` in
 * `Fnd4`. The size at offset 4 is measured from offset 8, so offset 8 plus
 * the size is where `End Proc` starts, and `End Proc` is a six-byte line.
 */
const PROC_FOLD_EXTRA = 14

/** what a line costs when it holds nothing: length byte, indent, zero word */
export const EMPTY_LINE_BYTES = 4

/** where a walk stopped, and the open procedure it stopped inside */
export interface Found {
  /** byte offset of the line, or of the terminating zero word if it ran out */
  at: number
  /** `Edt_DebProc`: the enclosing OPEN procedure's line, or -1 */
  proc: number
  /** false once the walk reached the zero word, which is `beq` on the caller */
  found: boolean
}

/**
 * What `Ed_Stocke` (+Edit.s:10940) reports back.
 *
 * `error` is its d0: 0 stored, 1 out of memory (`StoMem`), -1 the line was a
 * closed procedure and may not be touched (`StoClo`).
 */
export interface Stored {
  at: number
  error: 0 | 1 | -1
  /** d1, "une ligne de plus": the program gained a line */
  added: boolean
}

export class ProgramBuffer {
  /**
   * the one allocation; `Prg_StTTexte` is its length.
   *
   * Not readonly, because `Prg_ChgTTexte` replaces it under a structure that
   * every window on the program is still pointing at.
   */
  bytes: Uint8Array
  /** `Prg_StMini`, the low limit nothing may be written below */
  readonly stMini = 0
  /** `Prg_StBas`, the first line. Text runs from here to stHaut. */
  stBas: number
  /** `Prg_StHaut`, one past the last byte of the allocation */
  stHaut: number
  /** `Prg_NLigne`, in editor line numbers */
  lineCount = 0
  /**
   * `Prg_Marks`, ten longs.
   *
   * A set mark is `[line:2][$FF:1][column:1]` (`Ed_SMark0` +Edit.s:4238), and
   * zero means unset -- which works because the $FF is there even for line 0
   * column 0. `marksToAddress` swaps them to `[offset:3][column:1]` across an
   * operation that moves the text, and `marksToNumber` swaps them back.
   */
  readonly marks: number[] = Array(10).fill(0)
  /**
   * `Prg_Edited` (+Equ.s:1862): how many editor windows are open on this
   * program.
   *
   * `Edt_OpWindow` raises it (+Edit.s:11277) and `Edt_DelWindow` lowers it
   * (:11519); the program structure is freed only when it reaches zero. Split
   * View (:2469) is the one command that takes it above one.
   */
  edited = 0
  /**
   * `Prg_AdEProc` (+Equ.s:1872): the line the last Test failed on, 0 for none.
   *
   * `Ed_SetXY` (+Edit.s:10157) stores it only when the error turned out to be
   * inside a CLOSED procedure, because that is the one case where the cursor
   * cannot be put on the line that failed. `Ed_ProcOpen` reads it back when it
   * opens a fold, and jumps the cursor to the error.
   */
  adEProc = 0

  /**
   * Bit 31 of `Prg_AdEProc`, which the machine packs into the same long.
   *
   * `Ed_ClEProc` (+Edit.s:8861) runs BEFORE every command body: the first one
   * after the failed Test raises this and leaves the address for that command
   * to use, and the second finds the bit already up and clears the long. So
   * the recall is worth exactly one command. `Ed_ProcOpen` takes the flag off
   * with `bclr #31,d0` rather than testing it.
   */
  eProcStale = false

  /** `Prg_XEProc` (+Equ.s:1873): the column on that line, from `Detok`'s watch */
  xEProc = 0

  /** `Prg_Change`, the program wants saving */
  changed = false
  /**
   * `Prg_NoNamed` (+Equ.s:1866): the name is one Quit invented, so throw it away.
   *
   * Not a flag with two states. `Ed_DoQuit`'s `.NoName` (+Edit.s:4434) does
   * `addq.b #1,Prg_NoNamed(a6)` and then builds `New_Project_` plus the
   * window's position in the list, so the byte counts up and the file on disc
   * carries the same number. `Ed_WarmStart` (:620) reads the program back,
   * clears the name, raises `Prg_Change` and DELETES the file: an untitled
   * program survives a quit without ever acquiring a title.
   */
  noNamed = 0
  /** `Prg_StModif`, the listing has been modified since the last Test */
  modified = false
  /** `Prg_NamePrg`, the file it was loaded from or last saved to */
  name = ''
  /**
   * `Prg_Not1.3`: this program needs AMOS Professional and will not run on 1.3.
   *
   * Not a version stamp. `PTest` (+Verif.s:73) clears `VerNot1.3` and raises
   * it the moment the walk meets something 1.3 does not have, and `Prg_Test`
   * (:4359) copies the verdict here. A Pro program that uses nothing beyond
   * 1.3 is saved with an `AMOS Basic v134` header and runs under 1.3.
   *
   * `Prg_New` does NOT clear it, so a new program keeps the last one's verdict
   * until the next Test.
   */
  pro = false
  /** `Prg_MathFlags`, byte 15 of a Pro header. `MathFlags(a5)` at Test time */
  mathFlags = 0
  /**
   * `Prg_Reloaded` (+Equ.s:1865): the running program replaced what is here.
   *
   * `Run "file"` from inside a program loads over the window's own text
   * (+ILib.s:1479) and raises this. `Ed_ErrRun` (+Edit.s:8258) reads it once
   * on the way back and drops the block anchor, because the anchor is a line
   * number into text that is gone.
   */
  reloaded = false
  /**
   * DEVIATION: everything after the source in the file, `AmBs` onwards.
   *
   * The machine parses this into bank structures on the way in (`Bnk.Load`)
   * and builds it again on the way out (`Bnk.SaveAll`). There is no bank
   * writer in this port, so the bytes are kept as they arrived and written
   * back unread. A program whose banks were edited would need the real thing.
   */
  banks: Uint8Array = EMPTY_BANKS

  private constructor(size: number) {
    // `and.l #$FFFFFFFE,d0`: an odd size would leave the zero word odd
    const n = size & ~1
    this.bytes = new Uint8Array(n)
    this.stHaut = n
    this.stBas = n - 2
  }

  /**
   * `Prg_ChgTTexte` (+Verif.s:4758): a different buffer under the same
   * structure.
   *
   * The machine frees the old allocation and clears a new one, so the program
   * in it is GONE and only `Prg_NLigne` and the name survive the call. Every
   * caller that wants to keep the text copies it back afterwards, which is
   * what `keep` is: `Ed_SetBuffer`'s grow arm (+Edit.s:9948) stacks the four
   * old pointers, clears `Prg_StTTexte` so the allocation is not freed under
   * it, and puts the text back with `Ed_StoBlock`.
   *
   * The size is rounded down to even, because an odd one would leave the zero
   * word on an odd address.
   */
  chgTTexte(size: number, keep?: Uint8Array): void {
    const n = Math.max(size & ~1, 4)
    this.bytes = new Uint8Array(n)
    this.stHaut = n
    this.stBas = n - 2
    if (keep === undefined) {
      // the machine leaves `Prg_NLigne` at whatever the old program's was, and
      // every caller follows with `Ed_New2` or a load that recounts it
      this.lineCount = 0
      return
    }
    this.stBas = n - 2 - keep.length
    this.bytes.set(keep, this.stBas)
    this.countLines()
  }

  /** `Prg_ChgTTexte` again, on a structure that does not exist yet */
  static create(size: number): ProgramBuffer {
    if (size < 4) throw new Error('a program buffer holds at least a zero word')
    return new ProgramBuffer(size)
  }

  /**
   * A program's tokens dropped in below the top, the way `Prg_Load` does it.
   *
   * `.CBon` (+Verif.s:4842) is `move.l Prg_StHaut(a6),a0 / clr.w -(a0)` and
   * then reads the file to `a0 - length`. The terminating zero word is the
   * BUFFER's, written fresh every load, and the block on disc does not carry
   * one: a saved source ends with the last line's own terminator and nothing
   * after it.
   *
   * `size` is the whole allocation, so what is left over is the free space
   * the editor starts with.
   */
  static load(src: Uint8Array, size = src.length + 0x8000): ProgramBuffer {
    const p = new ProgramBuffer(Math.max(size, src.length + 4))
    p.stBas = p.stHaut - 2 - src.length
    p.bytes.set(src, p.stBas)
    p.countLines()
    return p
  }

  /**
   * `Prg_New` (+Verif.s:4726): the buffer emptied, and what survives it.
   *
   * The zero word goes back to the top, the name and `Prg_Change` are cleared
   * and `Prg_StModif` is RAISED, because an empty program has not been tested
   * either. `Prg_MathFlags` is cleared and `Prg_Not1.3` is not, so the
   * compatibility verdict outlives the program it was made about.
   *
   * The banks are `Bnk.EffAll` here. This port has none, so the tail from the
   * last load is dropped back to an empty list.
   */
  newProgram(): void {
    this.lineCount = 0
    this.stBas = this.stHaut - 2
    this.bytes[this.stBas] = 0
    this.bytes[this.stBas + 1] = 0
    this.name = ''
    this.changed = false
    this.modified = true
    this.mathFlags = 0
    this.banks = EMPTY_BANKS
  }

  /** `Prg_StBas - Prg_StMini`, which is what the editor calls free */
  free(): number {
    return this.stBas - this.stMini
  }

  /** the program as the loader would see it, from the first line to the zero word */
  text(): Uint8Array {
    return this.bytes.subarray(this.stBas, this.stHaut)
  }

  private u16(at: number): number {
    return (this.bytes[at]! << 8) | this.bytes[at + 1]!
  }

  private u32(at: number): number {
    return ((this.u16(at) << 16) | this.u16(at + 2)) >>> 0
  }

  /**
   * `move.b (a0),d1 / lsl.w #1,d1`: the line's byte length, and 0 at the end.
   *
   * DEVIATION: an offset outside the block reads as 0, which stops the walk.
   * The machine has no such check and reads whatever is next in memory; a
   * corrupt size on a folded procedure would send it somewhere and it would
   * carry on. Here that would be an `undefined` byte, a NaN pointer and a
   * loop that never ends, so out of range is the end of the program instead.
   * `verify.ts`'s `u16` takes the same position for the same reason.
   */
  rawLength(at: number): number {
    if (at < this.stMini || at + 2 > this.stHaut) return 0
    return this.bytes[at]! * 2
  }

  /** the whole line, header included, or 0 if it does not fit in the block */
  private lengthAt(at: number): number {
    const n = this.rawLength(at)
    if (n === 0) return 0
    return at + n > this.stHaut ? 0 : n
  }

  /** is the line at `at` a Procedure whose fold is closed? */
  private closedProc(at: number): boolean {
    return this.u16(at + 2) === TK_PROC && (this.u16(at + 10) & PROC_CLOSED) !== 0
  }

  /**
   * `Tk_SizeL` (+Verif.s:5085): how many bytes this line occupies.
   *
   * For a closed procedure that is the whole fold, header to `End Proc`
   * inclusive: `moveq #12+2,d0 / add.l 4(a0),d0`, where the size field at
   * offset 4 runs from just past itself to the start of `End Proc`.
   */
  sizeOfLine(at: number): number {
    const n = this.lengthAt(at)
    if (n === 0) return 0
    if (!this.closedProc(at)) return n
    return Math.min(PROC_FOLD_EXTRA + this.u32(at + 4), this.stHaut - 2 - at)
  }

  /**
   * `Tk_EditL` (:5093). A closed procedure's line is the one thing the cursor
   * may sit on and not change.
   */
  isEditable(at: number): boolean {
    return !this.closedProc(at)
  }

  /**
   * `Tk_FindL` (+Verif.s:5043): the offset of editor line `n`, counting from 0.
   *
   * `proc` comes back as the open procedure the line sits in, which the walk
   * learns on the way past a `Procedure` and forgets at its `End Proc`
   * (`Fnd8`). Landing ON a `Procedure` line sets it too (`FndT`).
   */
  findLine(n: number): Found {
    let at = this.stBas
    let proc = -1
    let left = n - 1
    if (left < 0) return this.landed(at, proc)
    for (;;) {
      const len = this.lengthAt(at)
      if (len === 0) return this.landed(at, proc)
      if (this.u16(at + 2) === TK_PROC) {
        if ((this.u16(at + 10) & PROC_CLOSED) !== 0) {
          // Fnd4: a closed fold is one line, and the body is not walked
          const skip = PROC_FOLD_EXTRA + this.u32(at + 4)
          at = at + skip > this.stHaut ? this.stHaut - 2 : at + skip
          if (left-- === 0) return this.landed(at, proc)
          continue
        }
        // Fnd5: an open one, and every line until End Proc is inside it
        proc = at
      } else if (proc >= 0 && this.u16(at + 2) === TK_END_PROC) {
        // Fnd8: the End Proc line is a line, and the last one inside
        proc = -1
      }
      at += len
      if (left-- === 0) return this.landed(at, proc)
    }
  }

  /** `FndT`: a `Procedure` landed on is its own DebProc */
  private landed(at: number, proc: number): Found {
    const len = this.lengthAt(at)
    if (len !== 0 && this.u16(at + 2) === TK_PROC) return { at, proc: at, found: true }
    return { at, proc, found: len !== 0 }
  }

  /**
   * `Tk_FindN` (:5041), which is `Tk_FindL` entered with d0 of 1.
   *
   * It starts with `sub.l a1,a1` like every other entry, so the procedure it
   * reports is only one it stepped over or landed on. One step cannot know
   * what it was already inside.
   */
  nextLine(at: number): Found {
    const len = this.lengthAt(at)
    if (len === 0) return this.landed(at, -1)
    const proc = this.u16(at + 2) === TK_PROC && !this.closedProc(at) ? at : -1
    return this.landed(at + this.sizeOfLine(at), proc)
  }

  /**
   * `Tk_FindA` (+Verif.s:5115): the editor line number an offset falls in.
   *
   * An address inside a closed fold reports the fold's line number and the
   * PHYSICAL line's offset, because that is what an error position needs: the
   * number to show and the bytes to look at. `FdA5` never touches d0.
   */
  findAddress(target: number): { line: number; start: number; proc: number } {
    let at = this.stBas
    let line = -1
    let start = at
    let proc = -1
    for (;;) {
      line++
      start = at
      const len = this.lengthAt(at)
      if (len === 0) return { line, start, proc }
      if (this.u16(at + 2) === TK_PROC && (this.u16(at + 10) & PROC_CLOSED) !== 0) {
        proc = at
        // FdA4: bit 12 is a machine-language body, which is not lines at all
        let inner = (this.u16(at + 10) & 0x1000) !== 0 ? at + this.sizeOfLine(at) : at + len
        for (;;) {
          if (inner > target) return { line, start, proc }
          start = inner
          const n = this.lengthAt(inner)
          if (n === 0) return { line, start, proc }
          if (this.u16(inner + 2) === TK_END_PROC) {
            proc = -1
            at = inner + n
            break
          }
          inner += n
        }
        if (at > target) return { line, start, proc }
        continue
      }
      at += len
      if (at > target) return { line, start, proc }
    }
  }

  /** is the line at `at` a `Procedure` header? `cmp.w #_TkProc,2(a0)` */
  isProc(at: number): boolean {
    return this.u16(at + 2) === TK_PROC
  }

  /** the flags word at offset 10 of a `Procedure` line: the fold and the lock */
  procFlags(at: number): number {
    return this.u16(at + 10)
  }

  /**
   * `bchg #7,10(a2)` (+Edit.s:8834): fold the procedure at `at`, or unfold it.
   *
   * The bit is written through the HIGH byte and read as bit 15 of the word,
   * which is one flag with two spellings all through +Edit.s and +Verif.s.
   */
  setProcClosed(at: number, closed: boolean): void {
    const b = this.bytes[at + 10]!
    this.bytes[at + 10] = closed ? b | 0x80 : b & ~0x80
  }

  /** `Prg_CptLines` (+Verif.s:4894), which is the walk with nothing to find */
  countLines(): number {
    let at = this.stBas
    let n = 0
    for (;;) {
      const size = this.sizeOfLine(at)
      if (size === 0) break
      n++
      at += size
    }
    this.lineCount = n
    return n
  }

  /**
   * `Ed_Stocke` (+Edit.s:10940): put `line` at editor line `n`.
   *
   * `insert` is its d0: without it the line replaces what is there, with it
   * the line goes in front and everything before it moves down.
   *
   * `added` is its d1, and it does NOT mean "a line was written". It means
   * the walk reached `StoI`, which is the insert path and the append path
   * both. The caller is what increments `Prg_NLigne`; this routine never
   * touches it, and only shifts the marks when it was told to insert
   * (`tst.w d7 / beq .Skip`), because appending past the last line moves
   * nothing that a mark could be pointing at.
   *
   * The one case that does nothing at all is `StoD` (:11000): storing an
   * EMPTY line over the terminating zero word, without inserting. Typing
   * nothing on the line past the end of the program leaves it the length it
   * was.
   */
  store(n: number, line: Uint8Array, insert = false): Stored {
    const size = line[0]! * 2
    const { at } = this.findLine(n)
    const old = this.lengthAt(at)

    if (old === 0) {
      // StoD: at the zero word
      if (size === EMPTY_LINE_BYTES && !insert) return { at, error: 0, added: false }
      return this.insertAt(at, size, line, n, insert)
    }
    if (insert) return this.insertAt(at, size, line, n, true)
    if (this.closedProc(at)) return { at, error: -1, added: false } // StoClo
    if (size === old) return this.copyIn(at, line)
    // StoR5 goes to StoI0 rather than StoI, so a line that merely grew is not
    // an added line
    if (size > old) return this.makeRoom(at, size - old, line)
    return this.shrink(at, old - size, line)
  }

  /**
   * `Ed_StoBlock` (:10935): a whole block in at line `n`.
   *
   * It sets d7 to zero before jumping into `StoI` -- "ne pas changer les
   * marques" -- so a paste moves the text under every mark and leaves the
   * marks where they were. The caller fixes them.
   */
  storeBlock(n: number, block: Uint8Array): Stored {
    const { at } = this.findLine(n)
    const r = this.makeRoom(at, block.length, block)
    return { ...r, added: r.error === 0 }
  }

  /** `StoI`: d5 is set, and the marks move only if this was a real insert */
  private insertAt(at: number, size: number, line: Uint8Array, n: number, insert: boolean): Stored {
    const r = this.makeRoom(at, size, line)
    if (r.error !== 0) return r
    if (insert) this.marksChange(n, 1)
    return { ...r, added: true }
  }

  /** `StoI0`: open `need` bytes at `at` by moving everything before it down */
  private makeRoom(at: number, need: number, line: Uint8Array): Stored {
    const to = this.stBas - need
    if (to <= this.stMini) return { at, error: 1, added: false } // StoMem
    this.bytes.copyWithin(to, this.stBas, at)
    this.stBas = to
    return this.copyIn(at - need, line)
  }

  /** `StoR1`: give `spare` bytes back by moving everything before it up */
  private shrink(at: number, spare: number, line: Uint8Array): Stored {
    this.bytes.copyWithin(this.stBas + spare, this.stBas, at)
    this.stBas += spare
    return this.copyIn(at + spare, line)
  }

  /** `StoCop`: the line itself, then the two flags every real store sets */
  private copyIn(at: number, line: Uint8Array): Stored {
    this.bytes.set(line, at)
    this.changed = true
    this.modified = true
    return { at, error: 0, added: false }
  }

  /**
   * `Ed_DeLigne` (+Edit.s:11072). Returns its d0: 0 deleted, 1 there was no
   * such line, -1 the line is a closed procedure.
   *
   * Unlike `Ed_Stocke` this one does keep the count and the marks itself.
   */
  deleteLine(n: number): 0 | 1 | -1 {
    const { at } = this.findLine(n)
    const len = this.lengthAt(at)
    if (len === 0) return 1
    if (this.closedProc(at)) return -1
    this.deleteRange(at, at + len)
    this.marksChange(n, -1)
    this.lineCount--
    return 0
  }

  /** `Ed_DelChunk` (:11058): `len` bytes from the start of line `n` */
  deleteChunk(n: number, len: number): void {
    const { at } = this.findLine(n)
    if (this.lengthAt(at) === 0) return
    this.deleteRange(at, at + len)
  }

  /** `Ed_StDelChunk` (:11104): close the gap by moving what is below it up */
  private deleteRange(from: number, to: number): void {
    const gap = to - from
    this.bytes.copyWithin(this.stBas + gap, this.stBas, from)
    this.stBas += gap
    this.changed = true
    this.modified = true
  }

  /* ---- marks ------------------------------------------------------------ */

  /** `Ed_MarksChange` (+Edit.s:4329): `delta` lines went in or out at `line` */
  marksChange(line: number, delta: number): void {
    for (let i = 0; i < 10; i++) {
      const m = this.marks[i]!
      if (m === 0) continue
      const at = m >>> 16
      if (delta > 0) {
        if (line <= at) this.marks[i] = m + delta * 0x10000
        continue
      }
      // .DLi: d3 is the line after the deleted run
      if (line - delta <= at) this.marks[i] = m + delta * 0x10000
      else if (line <= at) this.marks[i] = 0
    }
  }

  /** `Ed_SMark0` (:4238): mark `i` at this line and column */
  setMark(i: number, line: number, column: number): void {
    this.marks[i] = ((line & 0xffff) * 0x10000 + 0xff00 + (column & 0xff)) >>> 0
  }

  /** the line and column of mark `i`, or null if it was never set */
  getMark(i: number): { line: number; column: number } | null {
    const m = this.marks[i]!
    return m === 0 ? null : { line: m >>> 16, column: m & 0xff }
  }

  /**
   * `Ed_Marks2Adress` (:4284): every mark from a line number to an offset.
   *
   * The pair exists because a mark has to survive an operation that moves the
   * text under it. A line number does not survive a re-tokenise that folds a
   * procedure; an offset from `StBas` does. A mark whose line is gone is
   * cleared here rather than left pointing at nothing.
   */
  marksToAddress(): void {
    for (let i = 0; i < 10; i++) {
      const m = this.marks[i]!
      if (m === 0) continue
      const { at, found } = this.findLine(m >>> 16)
      if (!found) {
        this.marks[i] = 0
        continue
      }
      this.marks[i] = (((at - this.stBas) << 8) + (m & 0xff)) >>> 0
    }
  }

  /** `Ed_Marks2Number` (:4304), the way back */
  marksToNumber(): void {
    for (let i = 0; i < 10; i++) {
      const m = this.marks[i]!
      if (m === 0) continue
      const at = this.stBas + (m >>> 8)
      this.marks[i] = ((this.findAddress(at).line & 0xffff) * 0x10000 + 0xff00 + (m & 0xff)) >>> 0
    }
  }
}
