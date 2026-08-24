/**
 * `Ed_Block` (+Edit.s:5867): the editor's one clipboard, and its shape.
 *
 * A block is not a rectangle and it is not a run of lines. It is a run of
 * TEXT between two points, and because a program is tokens and only the line
 * being edited is text, it has to be kept as three different things at once:
 *
 * - the first line's tail, as characters, from the anchor column on;
 * - the lines between, as raw program tokens, copied byte for byte;
 * - the last line's head, as characters, up to the cursor column.
 *
 * The middle is tokens rather than text because that is what makes a paste
 * cheap: `Ed_StoBlock` (:10925) opens the gap and copies it in one move, with
 * no tokenising at all. The two ends have to be text because they are halves
 * of lines, and half a line does not tokenise.
 *
 * ## The layout
 *
 * ```
 *  0  y0      first line
 *  2  y1      last line
 *  4  x0      first column
 *  6  flags   bit 15 the first line is a closed procedure, bit 14 one line only
 *  8  x1      last column
 * 10  [len:2][chars] the first line's tail, padded to an even length
 *     [lines:2][size:4][tokens] the middle          -- absent when SINGLE
 *     [len:2][chars] the last line's head           -- absent when SINGLE
 * ```
 *
 * `movem.w d4-d6,(a1)` puts the three words down and `move.l d7,(a1)+` puts
 * the flags and the last column down as one long, which is why the flags sit
 * in the middle of the numbers rather than at the front.
 *
 * A single-line block stops after the first record: `.Pc1` tests bit 30 and
 * branches past both the middle and the last line, so there is nothing there
 * to read and nothing writes it.
 */

/** the two flags `Ed_BlockCopyA0` sets in the top half of d7 */
export const BF = {
  /** `bset #31,d7`: the block opens on a closed procedure, so the first record is empty */
  PROC_FIRST: 0x8000,
  /** `bset #30,d7` (`.Sl2`): the whole block is on one line */
  SINGLE: 0x4000,
} as const

/** what a block holds, once the layout has been walked */
export interface BlockView {
  /** the first and last lines it covers, and the columns on each */
  y0: number
  y1: number
  x0: number
  x1: number
  flags: number
  /** the first line's tail */
  first: Uint8Array
  /** how many whole lines the middle holds */
  lines: number
  /** those lines as program tokens */
  middle: Uint8Array
  /** the last line's head */
  last: Uint8Array
}

/** the parts a copy has gathered, before they are laid out */
export type BlockParts = Omit<BlockView, 'flags'> & { flags: number }

const u16 = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!
const put16 = (b: Uint8Array, at: number, n: number): void => {
  b[at] = (n >>> 8) & 0xff
  b[at + 1] = n & 0xff
}

/** `Pair` (+Equ.s:2360): `addq.l #1 / and.w #$FFFE` */
const pair = (n: number): number => (n + 1) & ~1

/**
 * The editor's clipboard.
 *
 * DEVIATION: on the machine this is `Ed_Block(a5)`, one pointer for the whole
 * editor, so every window cuts and pastes through the same block. Here it is
 * an object, and `Edit` makes one each. Two windows that should share it can
 * be handed the same instance; nothing does yet, because nothing opens two.
 */
export class Block {
  /** `Ed_Block`, null when there is none. `Ed_BlocWhat` is what reads it */
  bytes: Uint8Array | null = null

  get empty(): boolean {
    return this.bytes === null
  }

  /** `Ed_BlocFree` (:5913) */
  free(): void {
    this.bytes = null
  }

  /** the layout walked, or null when there is no block */
  read(): BlockView | null {
    const b = this.bytes
    if (b === null) return null
    const flags = u16(b, 6)
    const firstLen = u16(b, 10)
    const first = b.subarray(12, 12 + firstLen)
    const view: BlockView = {
      y0: u16(b, 0),
      y1: u16(b, 2),
      x0: u16(b, 4),
      x1: u16(b, 8),
      flags,
      first,
      lines: 0,
      middle: new Uint8Array(0),
      last: new Uint8Array(0),
    }
    if ((flags & BF.SINGLE) !== 0) return view
    const mid = pair(12 + firstLen)
    const size = (u16(b, mid + 2) << 16) | u16(b, mid + 4)
    view.lines = u16(b, mid)
    view.middle = b.subarray(mid + 6, mid + 6 + size)
    const lastAt = mid + 6 + size
    view.last = b.subarray(lastAt + 2, lastAt + 2 + u16(b, lastAt))
    return view
  }

  /** lay the parts out and keep them, which is `.Reserve` through `.Sc2` */
  write(p: BlockParts): void {
    const single = (p.flags & BF.SINGLE) !== 0
    const mid = pair(12 + p.first.length)
    const size = single ? 0 : mid + 6 + p.middle.length + 2 + p.last.length
    const b = new Uint8Array(single ? 12 + p.first.length : size)
    put16(b, 0, p.y0)
    put16(b, 2, p.y1)
    put16(b, 4, p.x0)
    put16(b, 6, p.flags)
    put16(b, 8, p.x1)
    put16(b, 10, p.first.length)
    b.set(p.first, 12)
    if (!single) {
      put16(b, mid, p.lines)
      put16(b, mid + 2, (p.middle.length >>> 16) & 0xffff)
      put16(b, mid + 4, p.middle.length & 0xffff)
      b.set(p.middle, mid + 6)
      const lastAt = mid + 6 + p.middle.length
      put16(b, lastAt, p.last.length)
      b.set(p.last, lastAt + 2)
    }
    this.bytes = b
  }
}
