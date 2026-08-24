/**
 * The editor's undo, which is a ring of six-byte records.
 *
 * `Prg_UndoCreate` (+Edit.s:1977) allocates `(Ed_NUndo + 3) * 6` bytes and
 * writes $FF into the first record and the last. Those two sentinels are the
 * whole wrap mechanism: `Un_Next` (:2318) steps forward and, if it lands on
 * an $FF, jumps to record 1; `Un_Prev` (:2306) steps back and, if it lands on
 * one, jumps to the record before the high sentinel. `Ed_NUndo` ships at 1000
 * (+Editor_Config.s:41).
 *
 * The three extra records are exactly accounted for: one sentinel at each end,
 * and one that is always empty because `Un_Avance` clears the record ahead of
 * the position. So `Ed_NUndo` of 1000 buys 1001 slots and 1000 undos, and the
 * `addq.l #3` is not slack.
 *
 * ## Where the position sits
 *
 * `Un_Debut` (:2259) writes the cursor into the record at `Prg_PUndo` and
 * then advances PAST it, clearing what it lands on. So `Prg_PUndo` is always
 * one beyond the last thing recorded, which is why `Ed_Undo` steps back
 * before it reads and `Ed_Redo` reads before it steps forward, and why a
 * redo straight after an edit finds a zero code and refuses.
 *
 * ## The record
 *
 * Six bytes: the action code, the cursor column, the cursor line as a word,
 * and two bytes the action reads how it likes. Bit 7 of the code means the
 * record owns a separately allocated block of text, and then the line word is
 * NOT in the record any more -- `Un_CLine` (:2230) copies it into the block
 * and overwrites bytes 2 to 5 with the pointer. `Un_XYSto` (:2205) is the
 * reader that knows this.
 *
 * DEVIATION: the blocks are held beside the ring rather than pointed at from
 * inside it, because this port has no heap to allocate them from. The record
 * bytes are otherwise the machine's, sentinels and all, so the wrap, the
 * position and the codes are testable as bytes.
 *
 * ## The counter nobody reads
 *
 * `Prg_TUndo` is added to when a block is allocated and subtracted from when
 * one is freed, in four places, and read in none of them -- not in +Edit.s,
 * not in +Monitor.s, nowhere. So the undo buffer is capped at 1000 RECORDS
 * and not at any number of bytes, and 1000 undos of a 500-character line hold
 * half a megabyte that nothing will notice. It is kept here because it is the
 * only measure of what undo is costing, and because a reader may yet want it.
 */

/** the eight actions, in the order `JUndo` (+Edit.s:2030) branches to them */
export const UN = {
  /** a typed character; b4 is -1 for insert or the character overwritten */
  CHAR: 1,
  /** Delete; b5 is the character that went */
  DELETE: 2,
  /** a line cleared, or cleared to the end; the block holds what went */
  CLEAR: 3,
  /** a line taken out of the program; the block holds it */
  DLINE: 4,
  /** a line tokenised; the block holds both spellings and the count delta */
  TOKEN: 5,
  /** a line put into the program; no payload at all */
  ILINE: 6,
  /** one line split into two */
  SPLIT: 7,
  /** two lines joined into one */
  JOIN: 8,
} as const

/** the bit that says this record allocated something */
const OWNS = 0x80

/** how many records `Ed_NUndo` of them really needs, and where the ends are */
const RECORD = 6
const SENTINEL = 0xff

/** what a record holds, once the pointer has been followed */
export interface UndoRecord {
  /** 1 to 8; the code with bit 7 masked off */
  code: number
  /** whether the record owns a block */
  owns: boolean
  /** `Edt_XCu`, low byte only */
  x: number
  /** `Edt_YPos + Edt_YCu`, out of the block when there is one */
  y: number
  /** bytes 4 and 5, which mean something different for every action */
  b4: number
  b5: number
  /** the payload `Un_CLine` copied, without the length and line words */
  block: Uint8Array | null
}

export class UndoBuffer {
  /** `Prg_Undo`: the ring, or empty when `Ed_NUndo` is zero and undo is off */
  readonly bytes: Uint8Array
  /** `Prg_LUndo` */
  readonly length: number
  /** `Prg_PUndo`, as a byte offset into the ring */
  private p = RECORD
  /** the blocks bytes 2 to 5 would point at, by record index */
  private blocks: (Uint8Array | null)[]
  /** `Prg_TUndo`, which nothing on the machine ever reads */
  total = 0
  /**
   * `Ed_FUndo(a5)`, raised around anything that must not record itself.
   *
   * It is a counter and not a flag because the operations nest: `Ed_Return`
   * raises it, and the `Ed_DelLiCu` inside it would otherwise record a
   * deletion the user never asked for.
   *
   * DEVIATION: on the machine this is one counter for the whole editor and
   * here it is one per program. Nothing can tell while only one program is
   * open, and when a second can be it moves out.
   */
  suppressed = 0

  constructor(count = 1000) {
    this.length = count === 0 ? 0 : (count + 3) * RECORD
    this.bytes = new Uint8Array(this.length)
    this.blocks = Array(count === 0 ? 0 : count + 3).fill(null)
    if (this.length === 0) return
    // `move.b #$FF,(a1)` at the base, and again at `-12(a1,d1.l)` from
    // record 1, which is the last record of all
    this.bytes[0] = SENTINEL
    this.bytes[this.length - RECORD] = SENTINEL
  }

  /** whether there is a buffer at all: `Ed_NUndo` of zero turns undo off */
  get enabled(): boolean {
    return this.length !== 0
  }

  /** how many records the ring can actually hold, which is `Ed_NUndo` + 1 */
  get slots(): number {
    return this.length === 0 ? 0 : this.length / RECORD - 2
  }

  /** `Prg_PUndo` as a record index, for a test that wants to see the ring turn */
  get position(): number {
    return this.p / RECORD
  }

  /** `Prg_UndoRaz` (:2001): every record cleared and the position back to 1 */
  raz(): void {
    if (!this.enabled) return
    let at = RECORD
    while (this.bytes[at] !== SENTINEL) {
      this.del(at)
      at += RECORD
    }
    this.p = RECORD
  }

  /** `Un_Del` (:2294): give the block back and clear the code */
  private del(at: number): void {
    const i = at / RECORD
    const block = this.blocks[i]
    if ((this.bytes[at]! & OWNS) !== 0 && block !== null && block !== undefined) {
      this.total -= block.length
      this.blocks[i] = null
    }
    this.bytes[at] = 0
  }

  /** `Un_Next` (:2318) */
  private next(at: number): number {
    const to = at + RECORD
    return this.bytes[to] === SENTINEL ? RECORD : to
  }

  /** `Un_Prev` (:2306) */
  private prev(at: number): number {
    const to = at - RECORD
    return to < 0 || this.bytes[to] === SENTINEL ? this.length - 2 * RECORD : to
  }

  /**
   * `Un_Debut` (:2259): the cursor into the current record, then step past it.
   *
   * Returns the offset of the record the caller should stamp, or -1 when
   * nothing is being recorded. `Un_Avance` (:2283) clears the record it lands
   * on, so what is ahead of the position is always empty and a redo there
   * finds a zero.
   */
  private begin(x: number, y: number): number {
    if (this.suppressed !== 0 || !this.enabled) return -1
    const at = this.p
    this.del(at)
    this.bytes[at + 1] = x & 0xff
    this.bytes[at + 2] = (y >>> 8) & 0xff
    this.bytes[at + 3] = y & 0xff
    const to = this.next(at)
    this.del(to)
    this.p = to
    return at
  }

  /** a record with no block: `Ed_Delete` (:3565) writes one of these */
  record(code: number, x: number, y: number, b4 = 0, b5 = 0): boolean {
    const at = this.begin(x, y)
    if (at < 0) return false
    this.bytes[at] = code
    this.bytes[at + 4] = b4 & 0xff
    this.bytes[at + 5] = b5 & 0xff
    return true
  }

  /**
   * `Un_CLine` (:2230): a record whose payload is a run of characters.
   *
   * The machine allocates `count + 4` bytes, puts the length in the first
   * word and the cursor line in the second, and then overwrites the record's
   * own line word with the pointer. `Un_CLine` always stamps $83, and its
   * five callers stamp their own code over it afterwards -- so the code comes
   * in here rather than being fixed.
   */
  recordLine(code: number, x: number, y: number, payload: Uint8Array): boolean {
    const at = this.begin(x, y)
    if (at < 0) return false
    this.bytes[at] = code | OWNS
    this.attach(at, y, payload)
    return true
  }

  /**
   * The tokenise record, built by hand at :10801 rather than by `Un_CLine`.
   *
   * Its block is eight bytes plus both spellings of the line: the length, the
   * cursor line, the number of lines the tokenise added, and then the old text
   * and the new text each behind a length BYTE. `Un_Token` (:2130) reads the
   * old one back and takes the delta off `Prg_NLigne`.
   */
  recordToken(x: number, y: number, added: number, before: Uint8Array, after: Uint8Array): boolean {
    const at = this.begin(x, y)
    if (at < 0) return false
    this.bytes[at] = UN.TOKEN | OWNS
    const payload = new Uint8Array(2 + 1 + before.length + 1 + after.length)
    payload[0] = (added >>> 8) & 0xff
    payload[1] = added & 0xff
    payload[2] = before.length
    payload.set(before, 3)
    payload[3 + before.length] = after.length
    payload.set(after, 4 + before.length)
    this.attach(at, y, payload)
    return true
  }

  /** the block as the machine lays it out, length word and line word included */
  private attach(at: number, y: number, payload: Uint8Array): void {
    const block = new Uint8Array(4 + payload.length)
    block[0] = ((4 + payload.length) >>> 8) & 0xff
    block[1] = (4 + payload.length) & 0xff
    block[2] = (y >>> 8) & 0xff
    block[3] = y & 0xff
    block.set(payload, 4)
    this.blocks[at / RECORD] = block
    this.total += block.length
    // `move.l a0,2(a2)` puts the pointer where the line word was
    this.bytes[at + 2] = 0
    this.bytes[at + 3] = 0
  }

  /** the record at a ring offset, with the block followed */
  private read(at: number): UndoRecord | null {
    const raw = this.bytes[at]!
    if (raw === 0 || raw === SENTINEL) return null
    const block = this.blocks[at / RECORD] ?? null
    const owns = (raw & OWNS) !== 0
    return {
      code: raw & 0x7f,
      owns,
      x: this.bytes[at + 1]!,
      // `Un_XYSto`: the line comes out of the block when there is one
      y: owns && block ? (block[2]! << 8) | block[3]! : (this.bytes[at + 2]! << 8) | this.bytes[at + 3]!,
      b4: this.bytes[at + 4]!,
      b5: this.bytes[at + 5]!,
      block: owns && block ? block.subarray(4) : null,
    }
  }

  /**
   * `Ed_Undo` (+Edit.s:1905): back one, then read.
   *
   * Null is `Ed_NoUndo`, which is a beep and a message rather than an error.
   * The caller applies the record and must raise `suppressed` while it does,
   * exactly as `addq.b #1,Ed_FUndo(a5)` brackets the `jsr`.
   */
  undo(): UndoRecord | null {
    if (!this.enabled) return null
    const at = this.prev(this.p)
    const rec = this.read(at)
    if (rec === null) return null
    this.p = at
    return rec
  }

  /** `Ed_Redo` (:1921): read, then forward one */
  redo(): UndoRecord | null {
    if (!this.enabled) return null
    const rec = this.read(this.p)
    if (rec === null) return null
    this.p = this.next(this.p)
    return rec
  }
}
