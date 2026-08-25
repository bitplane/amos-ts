/**
 * `Ed_EtatMove` (+Edit.s:1512) and `Ed_BasMove` (:1535): the four arrows on
 * the status bar, which drag a window's separators a text row at a time.
 *
 * The arithmetic is in PIXELS on the machine, through `Edt_Y` and
 * `Edt_BasY`. This port keeps neither, because `Edt_WMaxSize`'s own walk
 * shows both are a running sum over the window list.
 */
import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, drawWindows, edCall } from './commands'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)
const PROG = 'Print "one"\nPrint "two"\nPrint "three"'

function open(rows = 8): Edit {
  const e = new Edit(ProgramBuffer.load(tested(PROG)), new EditBuffer(rows), new UndoBuffer(50), table)
  drawWindows(e.editor)
  return e
}

/** another window at the END of the list, since one links in after the current */
function extra(e: Edit, rows = 4): Edit {
  const ed = e.editor
  const was = ed.current
  ed.current = ed.list[ed.list.length - 1] ?? null
  const w = new Edit(ProgramBuffer.load(tested(PROG)), new EditBuffer(rows), new UndoBuffer(50), table, {}, ed)
  ed.current = was
  drawWindows(ed)
  return w
}

const rows = (e: Edit): number[] => e.editor.list.map((w) => w.windTy)

describe('where a window is, without storing where it is', () => {
  it('adds the title bar and everything above it up', () => {
    const e = open(8)
    const w2 = extra(e, 4)
    const ed = e.editor
    // `Ed_TitreSy` is 16, and a window's own bars are 11 above and 5 below
    expect(ed.topY(e)).toBe(16)
    expect(ed.basY(e)).toBe(16 + 11 + 8 * 8)
    expect(ed.topY(w2)).toBe(16 + 16 + 8 * 8)
    expect(ed.basY(w2)).toBe(ed.topY(w2) + 11 + 4 * 8)
  })

  it('leaves Edt_BasY five below a multiple of eight, as the rounding assumes', () => {
    const e = open(8)
    extra(e, 4)
    for (const w of e.editor.list) expect((e.editor.basY(w) + 5) % 8).toBe(0)
  })
})

describe('the top separator', () => {
  it('gives the row above to the window below', () => {
    const e = open(8)
    const w2 = extra(e, 4)
    e.editor.current = w2
    edCall(w2, ED.ETAT_UP)
    expect(rows(e)).toEqual([7, 5])
  })

  it('takes it back again', () => {
    const e = open(8)
    const w2 = extra(e, 4)
    e.editor.current = w2
    edCall(w2, ED.ETAT_DOWN)
    expect(rows(e)).toEqual([9, 3])
  })

  /** `tst.b Edt_First(a4) / bne .NoMve` is the routine's second instruction */
  it('does nothing on the first window, which has none', () => {
    const e = open(8)
    extra(e, 4)
    expect(edCall(e, ED.ETAT_UP)).toBe(0)
    expect(edCall(e, ED.ETAT_DOWN)).toBe(0)
    expect(rows(e)).toEqual([8, 4])
  })

  /**
   * `cmp.w d1,d3 / bls.s .NoMve`: the minimum is refused rather than allowed,
   * so the window above keeps one row and is never emptied by an arrow.
   */
  it('stops one row short of emptying the window above', () => {
    const e = open(8)
    const w2 = extra(e, 4)
    e.editor.current = w2
    for (let i = 0; i < 60; i++) edCall(w2, ED.ETAT_UP)
    expect(rows(e)).toEqual([1, 11])
  })
})

/**
 * `Edt_WSchrinkAll(1)` before `Edt_WMaxSize(-1)` (:2015) is what makes Split
 * View hand the new window everything that is left, so after one the windows
 * tile `Ed_Sy` exactly. That is the state both bounds were written for.
 */
describe('on a screen the windows fill', () => {
  const split = (): { e: Edit; w2: Edit } => {
    const e = open(8)
    edCall(e, ED.SPLIT)
    return { e, w2: e.editor.list[1]! }
  }

  it('leaves nothing spare once the view is split', () => {
    const { e } = split()
    expect(rows(e)).toEqual([1, 25])
    // the title bar, two windows' bars, and 26 rows of text
    expect(16 + 2 * 16 + 26 * 8).toBe(e.editor.sy)
  })

  it('refuses both ends rather than emptying either window', () => {
    const { e, w2 } = split()
    e.editor.current = w2
    expect(edCall(w2, ED.ETAT_UP)).toBe(0)
    expect(rows(e)).toEqual([1, 25])
    for (let i = 0; i < 60; i++) edCall(w2, ED.ETAT_DOWN)
    expect(rows(e)).toEqual([25, 1])
  })
})

describe('the bottom separator', () => {
  it('is the same separator as the top of the window below', () => {
    const a = open(8)
    const b = extra(a, 4)
    edCall(a, ED.BAS_DOWN)
    expect(rows(a)).toEqual([9, 3])
    a.editor.current = b
    edCall(b, ED.ETAT_UP)
    expect(rows(a)).toEqual([8, 4])
  })

  it('does nothing on the last window, which has none', () => {
    const e = open(8)
    const w2 = extra(e, 4)
    e.editor.current = w2
    expect(edCall(w2, ED.BAS_UP)).toBe(0)
    expect(edCall(w2, ED.BAS_DOWN)).toBe(0)
    expect(rows(e)).toEqual([8, 4])
  })
})

/**
 * `Edt_WChangeHaut`'s `.Last` arm (:12238). The last window cannot hand its
 * rows downwards, so its bottom stays put and its height changes instead, and
 * the top is allowed to arrive at the bottom and leave it with no text.
 */
describe('the last window in the list', () => {
  it('loses its own rows rather than moving its bottom', () => {
    const e = open(8)
    const w2 = extra(e, 4)
    const bottom = e.editor.basY(w2)
    e.editor.current = w2
    edCall(w2, ED.ETAT_DOWN)
    expect(e.editor.basY(w2)).toBe(bottom)
    expect(rows(e)).toEqual([9, 3])
  })

  /**
   * `Edt_WVideNext` (:11953) runs before `Ed_DrawWindows`, so a window
   * squeezed to nothing does not stay current with the cursor in it.
   */
  it('hands the cursor on when it is squeezed to nothing', () => {
    const e = open(8)
    const w2 = extra(e, 4)
    e.editor.current = w2
    for (let i = 0; i < 40; i++) edCall(w2, ED.ETAT_DOWN)
    expect(w2.windTy).toBe(0)
    expect(e.editor.current).toBe(e)
  })
})

/**
 * Every arrow conserves the screen. Whatever one window gains another loses,
 * which is what makes storing `Edt_Y` unnecessary.
 */
describe('the rows are conserved', () => {
  it('keeps the total the same through a long walk', () => {
    const e = open(8)
    const w2 = extra(e, 4)
    const w3 = extra(e, 6)
    const total = rows(e).reduce((a, b) => a + b, 0)
    e.editor.current = w2
    const moves = [ED.ETAT_UP, ED.BAS_DOWN, ED.ETAT_DOWN, ED.BAS_UP, ED.ETAT_UP, ED.ETAT_UP]
    for (const m of moves) edCall(w2, m)
    expect(rows(e).reduce((a, b) => a + b, 0)).toBe(total)
    e.editor.current = w3
    for (const m of moves) edCall(w3, m)
    expect(rows(e).reduce((a, b) => a + b, 0)).toBe(total)
    // and the tops still follow one another down the screen
    let y = 16
    for (const w of e.editor.list) {
      expect(e.editor.topY(w)).toBe(y)
      y += 16 + w.windTy * 8
    }
  })
})
