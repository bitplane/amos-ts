/**
 * `Ed_ALigne` (+Edit.s:10331) and the status line: what the editor puts on
 * screen, worked out without a screen.
 *
 * The machine prints straight into an AMOS text window with `WiCall Print`
 * and switches to inverse video with the escape sequences in `Ed_Systeme`
 * (messages 17 and 18). None of that decides anything: the window's contents
 * are `Edt_BufE` clipped to `Edt_XPos` and `Edt_WindTx`, and the highlight is
 * the block, and both are already in the editor's state. So this module reads
 * the state and answers what would be drawn, and putting characters on a
 * screen is the caller's.
 *
 * That split is the reason there are tests for the block highlight at all.
 * `Ed_ALigne`'s five arms -- before the block, the first line of it, the
 * middle, the last line, and a block that starts and ends on one line -- are
 * ordinary arithmetic on four numbers, and every one of them is checkable.
 */
import { ED_MESSAGES, ED_SYSTEME } from '../runtime/edmessages.gen'
import type { Edit } from './edit'

/** one run of characters drawn the same way */
export interface Run {
  /** where it starts in `text`, not in the line */
  from: number
  to: number
}

/** one row of the window, ready to be put down at column 0 */
export interface Row {
  /** the visible characters: the slot clipped to `Edt_XPos` and the width */
  text: string
  /** the parts of `text` the block covers, drawn in inverse video */
  inverse: Run[]
  /**
   * `.End`: the row is shorter than the window, so what is left of the old
   * row has to be cleared (`WiCalD ChrOut,7`).
   *
   * `Ed_ALigne` never sets it and `Ed_EALigne` always does, so it says which
   * of the two entries the machine would have used. A full-width row clears
   * it again at `.Sz`, because there is nothing left to erase.
   */
  erase: boolean
}

/**
 * `Ed_ALigne`: display row `row`, clipped and with the block marked.
 *
 * `erase` starts true, which is `Ed_EALigne`'s entry (`moveq #-1,d6`, and the
 * `move.w d1,d6` under it leaves the top word alone so bit 31 survives).
 */
export function renderRow(e: Edit, row: number): Row {
  const slot = e.buf.text(row)
  const len = slot.length
  const from = e.xPos
  if (from >= len) return { text: '', inverse: [], erase: true }
  const to = Math.min(from + e.windTx, len)
  const text = slot.slice(from, to)
  const erase = to - from < e.windTx
  return { text, inverse: blockRuns(e, e.yPos + row, from, to), erase }
}

/**
 * The block arms of `Ed_ALigne`, from `.Sz` to `.NoBloc`.
 *
 * The block runs between its anchor `Edt_XBloc`/`Edt_YBloc` and the cursor,
 * either way round, and `.Sw` puts them in order. An anchor equal to the
 * cursor is no block at all rather than an empty one, so pressing Block twice
 * without moving leaves nothing highlighted.
 */
function blockRuns(e: Edit, line: number, from: number, to: number): Run[] {
  if (e.yBloc < 0) return []
  let y0 = e.yBloc
  let y1 = e.yPos + e.yCu
  let x0 = e.xBloc
  let x1 = e.xCu
  if (y1 < y0 || (y1 === y0 && x1 < x0)) {
    ;[y0, y1] = [y1, y0]
    ;[x0, x1] = [x1, x0]
  } else if (y1 === y0 && x1 === x0) {
    return []
  }
  // .Sk2: the end column is clipped to what is visible, the start is not
  x1 = Math.min(x1, to)

  const run = (a: number, b: number): Run[] => (b > a ? [{ from: a - from, to: b - from }] : [])

  if (line < y0 || line > y1) return []
  if (line > y0 && line < y1) return run(from, to) // the middle, all inverse
  if (y0 === y1) {
    // .DEBloc: one line, so both columns are on it
    if (x0 >= to) return []
    return run(Math.max(x0, from), Math.max(x1, from))
  }
  // .DBloc: the first line runs from the anchor to the right edge
  if (line === y0) return x0 >= to ? [] : run(Math.max(x0, from), to)
  // .EBloc: the last runs from the left edge to the cursor
  return run(from, Math.max(x1, from))
}

/** `Ed_AffBuf` (:10308): every row, and where the cursor sits among them */
export function renderWindow(e: Edit): { rows: Row[]; cursor: { x: number; y: number } } {
  const rows: Row[] = []
  for (let row = 0; row < e.buf.rows; row++) rows.push(renderRow(e, row))
  // Ed_Loca (:10202): the column is relative to the scroll, the row is not
  return { rows, cursor: { x: e.xCu - e.xPos, y: e.yCu } }
}

/**
 * `Ed_EtXX` (:5023): where each field starts, read off system message 1.
 *
 * The message is a line of digits at the columns their fields go in, and the
 * loader turns it into seven offsets by looking for '1' to '7'. Changing the
 * status line's layout means editing that string and nothing else, which is
 * why the positions are derived here rather than written down.
 */
export const ET_XX: readonly number[] = (() => {
  const out = Array(8).fill(0)
  const s = ED_SYSTEME[0]!
  for (let i = 0; i < s.length; i++) {
    const d = s.charCodeAt(i) - 0x30
    if (d >= 0 && d < 8) out[d] = i
  }
  return out
})()

/** what the status line has to be told, none of which the window knows */
export interface StatusOptions {
  /** `Edt_Order`, which window this is */
  order?: number
  /** `Prg_NamePrg`, empty for a program that was never saved */
  name?: string
  /** `Edt_LinkPrev`/`Edt_LinkNext`: this window's cursor is linked to another */
  split?: boolean
  /** `Edt_WindESx / 8`, the status window's width in characters */
  width?: number
}

/**
 * `Et_Chiffre` (:7482): a number left-aligned in a fixed field.
 *
 * The buffer is filled with spaces first and the digits written over them, so
 * a number that shrinks erases what it was. Then `clr.b 0(a1,d7.w)` cuts the
 * field at its width, which means a number too big for its field is printed
 * with its TAIL missing: 100,000 free bytes in a 5-wide field reads 10000.
 */
function figure(n: number, width: number): string {
  return (String(n) + ' '.repeat(width)).slice(0, width)
}

/**
 * `Ed_Etat` (:7740): the line above the window.
 *
 * An alert takes the whole line while it lasts, centred, and the fields come
 * back when it goes. Otherwise message 2 is the background and the seven
 * fields are written into it at the columns message 1 marks.
 *
 * The machine only redraws the fields `Edt_EtatAff` says are stale. Here the
 * whole line is built every time: tracking seven bits saves nothing when the
 * answer is a 68-character string.
 *
 * Line and column are printed from 1 and held from 0.
 */
/** `WiCall Centre`, which is what an alert and a recording both end in */
function centred(msg: string, width: number): string {
  const pad = Math.max(0, (width - msg.length) >> 1)
  return (' '.repeat(pad) + msg + ' '.repeat(width)).slice(0, width)
}

export function statusLine(e: Edit, opts: StatusOptions = {}): string {
  const width = opts.width ?? 68
  // .Skip0 (:7740): an alert takes the whole line, centred, until it times out
  if (e.alert !== 0) {
    return centred(e.alertText || (ED_MESSAGES[e.alert - 1] ?? `editor message ${e.alert}`), width)
  }
  // and a recording takes it after that (:7761), in the current window only,
  // which is where "Click mouse button to end." is the only way out
  if (e.macroTape !== null) return centred(ED_MESSAGES[29]!, width)
  const chars = (ED_SYSTEME[1]! + ' '.repeat(width)).slice(0, width).split('')
  const put = (at: number, s: string): void => {
    for (let i = 0; i < s.length && at + i < width; i++) chars[at + i] = s.charAt(i)
  }

  put(ET_XX[1]!, figure(opts.order ?? 0, 2))
  // Ed_EtIns (:7504): message 5 is 'O' and 6 is 'I', and the flag is inverted
  put(ET_XX[2]!, e.insert ? ED_SYSTEME[5]! : ED_SYSTEME[4]!)
  put(ET_XX[3]!, figure(e.line + 1, 5))
  put(ET_XX[4]!, figure(e.xCu + 1, 3))
  put(ET_XX[5]!, figure(e.prog.free(), 7))
  // Ed_EtNom (:7520): message 3 is ' Edit' and 4 'Split', then the name
  put(ET_XX[6]!, opts.split === true ? ED_SYSTEME[3]! : ED_SYSTEME[2]!)
  const room = width - ET_XX[7]! - 1
  const name = opts.name === undefined || opts.name === '' ? ED_SYSTEME[6]! : opts.name
  put(ET_XX[7]!, (name + ' '.repeat(room)).slice(0, room))

  return chars.join('')
}
