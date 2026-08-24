import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { ED_SYSTEME } from '../runtime/edmessages.gen'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, edCall } from './commands'
import { ET_XX, renderRow, renderWindow, statusLine } from './display'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)

function open(text: string, rows = 6): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text)), new EditBuffer(rows), new UndoBuffer(50), table)
  e.fill()
  return e
}

/** the block runs as columns of the row, which is what a renderer paints */
const marks = (e: Edit, row: number): string => {
  const r = renderRow(e, row)
  const out = Array(r.text.length).fill('.')
  for (const run of r.inverse) for (let i = run.from; i < run.to; i++) out[i] = '#'
  return out.join('')
}

const LINES = 'Print 1\nPrint 22\nPrint 333\nPrint 4444'

describe('one row', () => {
  it('is the slot, clipped to the scroll and the window width', () => {
    const e = open('Print "' + 'x'.repeat(200) + '"')
    e.windTx = 20
    expect(renderRow(e, 0).text).toBe('Print "xxxxxxxxxxxxx')
    e.xPos = 100
    expect(renderRow(e, 0).text.length).toBe(20)
    e.xPos = 200
    expect(renderRow(e, 0).text).toBe('xxxxxxx"')
  })

  it('is empty once the scroll has passed the end of the line', () => {
    // `cmp.w d0,d4 / bcc .End` -- nothing is printed and the row is erased
    const e = open(LINES)
    e.xPos = 40
    expect(renderRow(e, 0)).toEqual({ text: '', inverse: [], erase: true })
  })

  it('asks for an erase only when it does not fill the window', () => {
    // `.Sz`: a row as wide as the window has nothing left of the old one to
    // clear, so `bclr #31,d6`
    const e = open('Print "' + 'x'.repeat(60) + '"')
    e.windTx = 20
    expect(renderRow(e, 0).erase).toBe(false)
    e.windTx = 200
    expect(renderRow(e, 0).erase).toBe(true)
  })
})

describe('the block', () => {
  it('is nothing at all until an anchor is dropped', () => {
    const e = open(LINES)
    expect(e.yBloc).toBe(-1)
    expect(renderRow(e, 0).inverse).toEqual([])
  })

  it('is nothing when the anchor is exactly where the cursor is', () => {
    // `cmp.w d2,d3 / beq .NoBloc` -- an empty block is no block
    const e = open(LINES)
    e.yBloc = 0
    e.xBloc = 3
    e.xCu = 3
    expect(renderRow(e, 0).inverse).toEqual([])
  })

  it('covers one run when it starts and ends on the same line', () => {
    const e = open(LINES)
    e.yBloc = 1
    e.xBloc = 2
    e.yCu = 1
    e.xCu = 6
    expect(marks(e, 1)).toBe('..####..')
    expect(marks(e, 0)).toBe('.......')
    expect(marks(e, 2)).toBe('.........')
  })

  it('reads the same either way round, because .Sw sorts the ends', () => {
    const e = open(LINES)
    e.yBloc = 2
    e.xBloc = 5
    e.yCu = 1
    e.xCu = 2
    expect(marks(e, 1)).toBe('..######')
    expect(marks(e, 2)).toBe('#####....')
  })

  it('runs to the right edge on the first line and from the left on the last', () => {
    const e = open(LINES)
    e.yBloc = 1
    e.xBloc = 4
    e.yCu = 3
    e.xCu = 6
    expect(marks(e, 0)).toBe('.......') // above it
    expect(marks(e, 1)).toBe('....####') // .DBloc
    expect(marks(e, 2)).toBe('#########') // the middle, all of it
    expect(marks(e, 3)).toBe('######....') // .EBloc
  })

  it('clips the end column to what is visible and lets the start fall off', () => {
    // `.Sk2` clamps d3 to d5 and nothing clamps d2, which is why the two ends
    // are handled by separate arms rather than one
    const e = open('Print "' + 'x'.repeat(40) + '"')
    e.windTx = 10
    e.xPos = 8
    e.yBloc = 0
    e.xBloc = 2
    e.yCu = 0
    e.xCu = 30
    expect(marks(e, 0)).toBe('##########')
  })
})

describe('the window', () => {
  it('puts the cursor where the scroll left it', () => {
    // Ed_Loca (:10202): `sub.w Edt_XPos(a4),d1` on the column, nothing on
    // the row, because the edit buffer is indexed by row and not by line
    const e = open(LINES)
    e.xPos = 3
    e.xCu = 5
    e.yCu = 2
    const w = renderWindow(e)
    expect(w.cursor).toEqual({ x: 2, y: 2 })
    expect(w.rows.length).toBe(6)
    expect(w.rows.map((r) => r.text)).toEqual(['nt 1', 'nt 22', 'nt 333', 'nt 4444', '', ''])
  })
})

describe('the status line', () => {
  it('reads its field positions off system message 1', () => {
    // `.Loop1` at :5023 looks for '1' to '7' in the first message and keeps
    // the column each was found at
    expect(ED_SYSTEME[0]).toBe('       1  2   3       4        5       6     7')
    expect(ET_XX).toEqual([0, 7, 10, 14, 22, 31, 39, 45])
  })

  it('writes the seven fields into message 2', () => {
    const e = open(LINES)
    e.yCu = 2
    e.xCu = 7
    const s = statusLine(e, { order: 1, name: 'DEMO.AMOS' })
    expect(s.slice(0, 7)).toBe('Window-')
    expect(s.slice(ET_XX[1]!, ET_XX[1]! + 2)).toBe('1 ')
    expect(s.slice(ET_XX[3]!, ET_XX[3]! + 5)).toBe('3    ') // line, printed from 1
    expect(s.slice(ET_XX[4]!, ET_XX[4]! + 3)).toBe('8  ') // column, likewise
    expect(s.slice(ET_XX[7]!)).toMatch(/^DEMO\.AMOS +$/)
  })

  it('says I for insert and O for overwrite', () => {
    // Ed_EtIns (:7504): messages 5 and 6, and the flag picks the second
    const e = open(LINES)
    expect(statusLine(e).charAt(ET_XX[2]!)).toBe('I')
    edCall(e, ED.FLIP_INSERT)
    expect(statusLine(e).charAt(ET_XX[2]!)).toBe('O')
  })

  it('calls an unsaved program New project', () => {
    const e = open(LINES)
    expect(statusLine(e).slice(ET_XX[7]!).trimEnd()).toBe('New project')
  })

  it('truncates a number that will not fit, tail first', () => {
    // `clr.b 0(a1,d7.w)` cuts the field after the digits are written, so a
    // 6-digit line number in a 5-wide field loses its LAST digit
    const e = open(LINES)
    e.yPos = 123455
    expect(statusLine(e).slice(ET_XX[3]!, ET_XX[3]! + 5)).toBe('12345')
  })

  it('erases what a shrinking number left behind', () => {
    const e = open(LINES)
    e.xCu = 99
    expect(statusLine(e).slice(ET_XX[4]!, ET_XX[4]! + 3)).toBe('100')
    e.xCu = 0
    expect(statusLine(e).slice(ET_XX[4]!, ET_XX[4]! + 3)).toBe('1  ')
  })

  it('gives the whole line to an alert while one is up', () => {
    // `.Skip0` (:7740): `Et_Print 8` then `WiCall Centre`, and the fields do
    // not come back until it times out
    const e = open(LINES)
    expect(edCall(e, ED.CUR_UP)).toBe(200)
    const s = statusLine(e)
    expect(s.trim()).toBe('Top of text.')
    expect(s.length).toBe(68)
    e.alert = 0
    expect(statusLine(e).slice(0, 7)).toBe('Window-')
  })
})
