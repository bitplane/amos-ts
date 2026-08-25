/**
 * `Ed_Search` (+Edit.s:7000) to `RepBuffer` (:7364): find a string, and put
 * another one where it was.
 *
 * Six commands (`JFonc` 66 to 68 and 99 to 101) come down to one routine,
 * `Ed_SR` (:7031), and a mode word. Everything the six disagree about is a
 * bit in `Ed_SchMode`: which way to walk, whether case counts, and whether
 * the run is one match or all of them.
 *
 * ## The search is over the program, not the window
 *
 * `Ed_SchFront` detokenises each line into `Ed_BufT` and runs `SchBuffer`
 * over the characters. So the editor never searches tokens, it searches the
 * listing, and what it finds is what a person reading the screen would find.
 * The line the cursor is on has already gone back through `Ed_TokCur` by
 * then, which is why every one of the six commands starts with it.
 *
 * A closed procedure detokenises to its `Procedure` header and nothing else,
 * because `Tk_FindN` steps over the fold in one move. Text inside a folded
 * procedure cannot be found and cannot be replaced.
 *
 * ## Backwards is forwards, repeatedly
 *
 * `Ed_SchBack` (:7154) has no reverse scan in it. It searches FORWARD from
 * line 0 column 0, keeps the last match before the cursor, and stops when
 * the next forward search runs past the limit. On a long program that is
 * quadratic, and on the Amiga it is why Search Previous near the end of a
 * file takes a visible moment.
 */
import { detokLineBytes } from '../tokens/edtok'
import type { Edit } from './edit'
import { EditorAlert } from './edit'

/**
 * `Ed_SchMode` (+Equ.s:1810). Bits 0 to 3 are the dialogue's four flag
 * gadgets, read back by `Dia_GetVFlags` (+Lib.s:20926) in gadget order.
 */
export const SM = {
  /** message 28, `[F2] Upper Case = Lower Case`. `.MajS` upper-cases both sides */
  CASE: 0b0001,
  /** message 35, `[F1] Backward` */
  BACK: 0b0010,
  /** message 32, `All in Marked Block` */
  BLOCK: 0b0100,
  /** message 34, `All Occurences`, spelled the way the author spelled it */
  ALL: 0b1000,
  /**
   * `or.w #$8000,d5` in `Ed_ReplaceNext` (:7344). Not a gadget: it is how the
   * one shared routine is told this run replaces as well as finds.
   */
  REPLACE: 0x8000,
} as const

/** `and.w #%1100,d0 / bne .Turbo` (:7256): either of the two runs the whole thing */
export const SM_TURBO = SM.BLOCK | SM.ALL

/** where a search stopped: a program line and a column on it */
export interface Hit {
  y: number
  x: number
}

/** `.MajS` (:7220), which only folds case when bit 0 says to */
const maj = (c: number, mode: number): number =>
  (mode & SM.CASE) !== 0 && c >= 0x61 && c <= 0x7a ? c - 0x20 : c

const at = (s: string, i: number): number => s.charCodeAt(i) & 0xff

/**
 * `SchBuffer` (:7188): the offset of `needle` in `hay`, or -1.
 *
 * An empty needle is never found. `move.b (a1)+,d0` takes the terminator as
 * the letter to look for and `.RSe1` then hunts for a zero byte in the
 * haystack, which is the haystack's own terminator, so it falls straight out
 * at `.RSeN`. That is what stops `Ed_ReplaceNext`'s empty-buffer check from
 * being the only thing between the user and a search for nothing.
 */
export function schBuffer(hay: string, needle: string, mode: number): number {
  if (needle.length === 0) return -1
  const first = maj(at(needle, 0), mode)
  for (let i = 0; i < hay.length; i++) {
    if (maj(at(hay, i), mode) !== first) continue
    let j = 1
    let k = i + 1
    // `.RSe2` reads one byte past a haystack that runs out and compares the
    // terminator against a needle byte, which cannot match
    while (j < needle.length && k < hay.length && maj(at(hay, k), mode) === maj(at(needle, j), mode)) {
      j++
      k++
    }
    if (j === needle.length) return i
    // `move.l d2,a0` puts the scan back to one past the first letter rather
    // than past the whole failed match, so overlapping matches are seen
  }
  return -1
}

/**
 * `Ed_SchFront` (:7096): forward from line `y` column `x`, no further than
 * line `yMax` column `xMax`.
 *
 * `addq.w #1,d6` is the first instruction, so the column the cursor is on is
 * skipped. That is what makes Search Next move: without it every search would
 * find the match it is already sitting on. It also means a search can never
 * find a match at the column it starts from, which `Ed_Replace`'s turbo loop
 * pays for at column 0 of its first line.
 *
 * The Ctrl-C test is at `.Srch2`, on the way to the next line, so a search
 * that never leaves one line cannot be interrupted. `bclr` clears the bit
 * whether it was set or not, which is how a stray Ctrl-C is eaten.
 */
export function schFront(e: Edit, y: number, x: number, yMax: number, xMax: number, mode: number): Hit | null {
  let line = y
  let col = x + 1
  let found = e.prog.findLine(line)
  if (!found.found) return null
  for (;;) {
    // .SrchL
    if (line > yMax) return null
    if (line === yMax && col > xMax) return null
    // .Srch1
    const text = detokLineBytes(e.prog.bytes, found.at, e.table, e.opts)
    if (col < text.length) {
      const off = schBuffer(text.slice(col), e.schBuf, mode)
      if (off >= 0) {
        // .Srch3: the end column is only tested once there is something to test
        const hit = col + off
        if (line === yMax && hit > xMax) return null
        return { y: line, x: hit }
      }
    }
    // .Srch2
    col = 0
    const interrupted = e.abort
    e.abort = false
    if (interrupted) return null
    const next = e.prog.nextLine(found.at)
    if (!next.found) return null
    found = next
    line++
  }
}

/**
 * `Ed_SchBack` (:7154): the last match before line `y` column `x`.
 *
 * A cursor at column 0 takes the limit to column 255 of the line above, which
 * is past the end of any line the editor will hold.
 *
 * DEFECT: `.Loop` steps the start column on by one and `Ed_SchFront` steps it
 * on again, so the next forward pass begins two columns past the match rather
 * than one. Overlapping matches one column apart are stepped over, and the
 * "last match" this answers with is then not the last one there is. Searching
 * backwards through `aaaa` for `aa` reports column 1 with a match at column 2
 * sitting between it and the cursor.
 */
export function schBack(e: Edit, y: number, x: number, mode: number): Hit | null {
  let yMax = y
  let xMax = x - 1
  if (xMax < 0) {
    xMax = 255
    yMax = y - 1
    if (yMax < 0) return null
  }
  let best: Hit | null = null
  let line = 0
  let col = 0
  for (;;) {
    const hit = schFront(e, line, col, yMax, xMax, mode)
    if (hit === null) return best
    best = hit
    line = hit.y
    col = hit.x + 1
  }
}

/**
 * `RepBuffer` (:7364): `schLen` characters at `at` become `rep`.
 *
 * `cmp.w #252,d1` is measured on the length INCLUDING the terminator, so the
 * longest line a replacement may leave behind is 250 characters, the same
 * number `Ed_PKey` refuses to type past.
 *
 * `.RChg3` is a `dbra` over `Ed_RepLong` with no zero check, so an empty
 * replacement would copy 65,535 bytes over the line. It never runs: every
 * caller tests `Ed_RepBuf` first and sends an empty one back to the dialogue.
 */
export function repBuffer(line: string, at: number, schLen: number, rep: string): string {
  if (rep.length === 0) throw new RangeError('RepBuffer with an empty Ed_RepBuf would run 65,535 times')
  const out = line.slice(0, at) + rep + line.slice(at + schLen)
  if (out.length + 1 >= 252) throw new EditorAlert(199, 50) // Ed_LToLong
  return out
}

/**
 * What `Ed_DiaS` (:6962) and `Ed_Replace`'s own requester ask for.
 *
 * The three fields ARE the dialogue: `move.l a1,(a2)+` hands it the buffer to
 * edit, `Dia_SetVFlags` hands it the four flag gadgets, and `Dia_GetVFlags`
 * plus a copy loop read both back. `replace` is only asked for by EdD_Replace
 * (6); EdD_Search (4) leaves it alone.
 */
export interface SearchDialogue {
  /** EdD_Search (4) or EdD_Replace (6), which is `Ed_Dialogue`'s d0 */
  which: 4 | 6
  /** `Ed_SchBuf`, at most 32 characters */
  search: string
  /** `Ed_RepBuf`, likewise */
  replace: string
  /** `Ed_SchMode`'s bits 0 to 3 */
  mode: number
}

/** what came back out of it */
export interface DialogueAnswer extends SearchDialogue {
  /** `Ed_Dialogue`'s d0: `cmp.w #1,d0` is Ok and anything else is Cancel */
  ok: boolean
}

/**
 * What `Ed_Dialogue` (+Edit.s:3107) is asked, for the requesters that are not
 * the search one.
 *
 * `which` is the EdD_ number from the table at :15333, so it names the
 * requester in the source. What it shows beyond its own text is one variable,
 * and only ever a name or a count.
 */
export interface Confirm {
  which: number
  /** `Ed_VDialogues`'s first variable, when the requester names a file */
  name?: string
  /** ... or a number, which only EdD_Changes does */
  count?: number
}

/** the requesters the editor puts up, and what it does with them */
export interface EditorDialogues {
  /**
   * The string requester. A Cancel still answers with the fields, because the
   * machine reads them out of the requester before it looks at the button.
   */
  ask(d: SearchDialogue): DialogueAnswer
  /**
   * Everything else, answering `Ed_Dialogue`'s d0: 1 is the first button, 2
   * the second, anything else a close. Most callers test `cmp.w #1,d0` and
   * treat every other answer alike; `Ed_Saved` (:13315) is the one that reads
   * all three, because Yes, No and Cancel are three different things when a
   * program is about to be thrown away.
   */
  confirm(c: Confirm): number
  /**
   * `Ed_File_Selector` (:14059): four messages in, a path back, null for
   * Cancel. `which` is the first of the four message numbers, so 70 is Load
   * and 74 is Save.
   */
  select(which: number, name: string): string | null
  /**
   * EdD_Macro1 (13) and EdD_MacroD (18), which wait for a KEYSTROKE rather
   * than a button. The answer is `Dia_LastKey` as an `Inkey` long, and zero is
   * both "nothing pressed" and "cancelled": `EdMa_New` (:6837) tests the
   * button with `tst.w d0 / bne Ed_NotDone` and the key with `beq
   * Ed_NotDone`, and both go to the same place.
   */
  pressKey(which: number): number
  /**
   * DEVIATION: `Ed_LinkCursor` (:2342) waits for a MOUSE CLICK, not a
   * requester. It spins on `MouseKey` until button 1 goes down, reads
   * `GetZone`, and refuses anything that is not another editor window's zone.
   *
   * There is no mouse here, so the host answers the `Edt_Window` number the
   * click landed on. Zero is "not a window", which is what the three `bne
   * Ed_NotDone` guards around the click come to.
   */
  pickWindow(): number
  /**
   * `Dia_GetValue` (+Lib.s:24312): a number the user typed into a requester.
   *
   * `Ed_SetAutoSave` (:5364) is the only caller in the editor and it asks for
   * gadget 1 of dialogue 3. `which` is that gadget number.
   */
  value(which: number): number
}
