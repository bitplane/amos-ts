/**
 * `Indent` (+Edit.s:8471): the whole program's indent bytes, rewritten.
 *
 * The indent is not text. Every line carries it as byte 1, one more than the
 * number of leading spaces `Detok` will write, and this walks the token stream
 * and pokes that byte on every line. Nothing else about the program changes,
 * which is why Indent is cheap and why it cannot fail.
 *
 * ## Two counters, not one
 *
 * `d5` is THIS line's indent and `d6` is the NEXT line's, and the difference
 * between them is the whole design. A `For` puts the next line in but leaves
 * its own alone; an `Else` pulls its own line out but leaves the next one in.
 * `Next` does both, and only when the loop it closes was not opened on the
 * same line: `d7` counts the openers this line has seen, and `IndMns` takes
 * the tab off `d5` as well only when that count has gone negative.
 *
 * So `For I=0 To 9 : Next I` on one line nets out to nothing, and the two
 * halves of the same construct on two lines move both.
 *
 * ## Then, and the Else that does nothing
 *
 * `Then` falls THROUGH into `IndMns` (:8541), so a one-line `If ... Then` is
 * outdented again the moment it is indented, and it sets `d4`. `Else` reads
 * `d4` and does nothing at all when it is set, because a one-line
 * `If ... Then ... Else ...` has nothing to line up.
 *
 * ## A closed procedure is skipped whole
 *
 * `IndPro` puts the `Procedure` line at column 0 and the body one tab in. If
 * the fold is CLOSED it instead sets the next line's indent to 0 and steps
 * over the whole body by the size at offset 4, so the lines inside a fold keep
 * whatever indent they had. Fold a procedure, indent, unfold it, and the body
 * is untouched.
 *
 * The indent byte is clamped to 1 at the bottom and 128 at the top: `IndFL`
 * floors `d5` at zero, caps it at 127 and writes `d5 + 1`.
 */
import { TK, skipToken } from '../tokens/edtok'

/** bit 15 of the flags word at offset 10, the same fold bit `Tk_FindL` reads */
const PROC_CLOSED = 0x8000

/** `IndPls`: one tab further in on the NEXT line */
const OPENS = new Set<number>([TK.FOR, TK.REPEAT, TK.WHILE, TK.DO, TK.IF])

/** `IndMns`: one tab back out, and on this line too if nothing here opened it */
const CLOSES = new Set<number>([TK.END_IF, TK.NEXT, TK.UNTIL, TK.WEND, TK.LOOP])

/**
 * Rewrite every indent byte from `at` to the terminating zero word.
 *
 * @param tab `Ed_Tabs`, the config's three spaces
 * @returns how many lines were written, which the machine does not count
 */
export function indentBytes(src: Uint8Array, at: number, tab: number): number {
  const u16 = (p: number): number => (src[p]! << 8) | src[p + 1]!
  let p = at
  /** d6, the indent the NEXT line starts with */
  let next = 0
  let lines = 0
  for (;;) {
    const line = p
    // `tst.w (a0)+`: the length and indent word, and zero is the end
    if (u16(line) === 0) return lines
    /** d5, this line's own indent */
    let here = next
    /** d7, the loop openers this line has seen */
    let depth = 0
    /** d4, raised by `Then` so that `Else` knows to do nothing */
    let oneLineIf = false
    p = line + 2
    for (;;) {
      const id = u16(p)
      p += 2
      // `move.w (a0)+,d0 / beq IndFL`: the zero word ends the line, and a0 is
      // already standing on the next one, so nothing reads the length again
      if (id === 0) break
      p = skipToken(src, p, id)
      if (id === TK.PROCEDURE) {
        here = 0
        next = tab
        if ((u16(line + 10) & PROC_CLOSED) !== 0) {
          next = 0
          // `lea 12+2(a1,d0.l),a0`, the same step over a fold `Fnd4` makes
          p = line + 14 + (((u16(line + 4) << 16) | u16(line + 6)) >>> 0)
          break
        }
      } else if (id === TK.END_PROC) {
        here = 0
        next = 0
      } else if (OPENS.has(id)) {
        depth++
        next += tab
      } else if (id === TK.THEN || CLOSES.has(id)) {
        if (id === TK.THEN) oneLineIf = true
        // `IndMns`: this line moves out as well only when the closer had no
        // opener on it, which is what the counter going negative means
        if (--depth < 0) {
          depth = 0
          here -= tab
        }
        next -= tab
      } else if (id === TK.ELSE || id === TK.ELSE_IF) {
        // `IndElse`: nothing at all inside a one-line If
        if (!oneLineIf) here -= tab
      }
    }
    // `IndFL`: floored at 0, capped at 127, and stored one higher
    if (here < 0) here = 0
    if (here > 127) here = 127
    src[line + 1] = here + 1
    lines++
  }
}
