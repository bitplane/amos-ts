import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'

const table = new TokenTable(CORE_TOKENS)
const PROG = 'Print "one"\nProcedure DEMO\n  Print "in"\nEnd Proc\nPrint "two"'
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)

describe('the slot', () => {
  it('is 256 bytes, a length word, the text, and a flag on the last byte', () => {
    // `Ed_LCourant` (+Edit.s:11181): `lsl.w #8,d0`, then `move.w (a0)+,d0`
    // for the length and `tst.b 255-2(a0)` for the flag
    const b = new EditBuffer(4)
    expect(b.bytes.length).toBe(4 * 256)
    b.setText(2, 'HI')
    expect(b.bytes[2 * 256]).toBe(0)
    expect(b.bytes[2 * 256 + 1]).toBe(2)
    expect(b.bytes[2 * 256 + 2]).toBe(72)
    expect(b.text(2)).toBe('HI')
    b.setEditable(2, false)
    expect(b.bytes[2 * 256 + 255]).toBe(0xff)
    expect(b.editable(2)).toBe(false)
  })

  it('refuses a row that is not in the window', () => {
    const b = new EditBuffer(2)
    expect(() => b.text(2)).toThrow(RangeError)
  })
})

describe('typing into a line', () => {
  it('opens a gap and puts the characters in it', () => {
    const b = new EditBuffer(1)
    b.setText(0, 'abcd')
    expect(b.insert(0, 2, 'XY')).toBe(2)
    expect(b.text(0)).toBe('abXYcd')
  })

  it('trims at 250 rather than refusing', () => {
    // `R_InsChar` (:1850): `sub.w #250,d0 / sub.w d0,d2 / move.w #250,d0`
    const b = new EditBuffer(1)
    b.setText(0, 'x'.repeat(246))
    expect(b.insert(0, 246, 'abcdefgh')).toBe(4)
    expect(b.length(0)).toBe(EditBuffer.MAX_TYPED)
    expect(b.text(0).endsWith('abcd')).toBe(true)
    expect(b.insert(0, 0, 'z')).toBe(0)
    expect(b.length(0)).toBe(250)
  })

  it('overwrite leaves the length alone', () => {
    const b = new EditBuffer(1)
    b.setText(0, 'abcd')
    b.overwrite(0, 1, 'Z')
    expect(b.text(0)).toBe('aZcd')
  })
})

describe('deleting from a line', () => {
  it('closes the gap', () => {
    const b = new EditBuffer(1)
    b.setText(0, 'abcdef')
    expect(b.delete(0, 2, 2)).toBe(true)
    expect(b.text(0)).toBe('abef')
  })

  it('does nothing when asked for more than the whole line', () => {
    const b = new EditBuffer(1)
    b.setText(0, 'abc')
    expect(b.delete(0, 0, 4)).toBe(false)
    expect(b.text(0)).toBe('abc')
  })

  it('DEFECT: the guard counts the line, not what is after the cursor', () => {
    // `cmp.w d0,d2 / bhi .Skip` compares the count against the LENGTH, so a
    // count that fits the line but not the tail shortens it anyway and moves
    // nothing. Every caller checks first, which is why it has never bitten.
    const b = new EditBuffer(1)
    b.setText(0, 'abcdefghij')
    expect(b.delete(0, 8, 5)).toBe(true)
    expect(b.text(0)).toBe('abcde')
  })
})

describe('filling from the program', () => {
  const prog = (): ProgramBuffer => ProgramBuffer.load(tested(PROG))

  it('detokenises a line into a row', () => {
    const b = new EditBuffer(8)
    const p = prog()
    b.untok(0, p, 1, table)
    expect(b.text(0)).toBe('Procedure DEMO')
    expect(b.editable(0)).toBe(true)
  })

  it('a row past the end of the program is empty and editable', () => {
    // `clr.w (a1) / clr.b 255(a1)` before the walk, so the row is not
    // whatever the last program showed there
    const b = new EditBuffer(8)
    const p = prog()
    b.setText(3, 'left over')
    b.setEditable(3, false)
    b.untok(3, p, 99, table)
    expect(b.text(3)).toBe('')
    expect(b.editable(3)).toBe(true)
  })

  it('shows a closed procedure and marks it unchangeable', () => {
    // `Tk_EditL` sets the flag and the line is detokenised either way
    const src = tested(PROG)
    src[14 + 10] = src[14 + 10]! | 0x80
    const p = ProgramBuffer.load(src)
    const b = new EditBuffer(8)
    b.fill(0, p, table)
    expect([b.text(0), b.text(1), b.text(2)]).toEqual(['Print "one"', 'Procedure DEMO', 'Print "two"'])
    expect([b.editable(0), b.editable(1), b.editable(2)]).toEqual([true, false, true])
  })

  it('fills every row of the window from the top line', () => {
    const b = new EditBuffer(4)
    b.fill(2, prog(), table)
    expect(Array.from({ length: 4 }, (_, r) => b.text(r))).toEqual(['  Print "in"', 'End Proc', 'Print "two"', ''])
  })

  it('holds 253 characters and truncates past that', () => {
    // `Detok` has no cap and would write over the flag at byte 255 and into
    // the next row. Two lines in 124,480 in fixtures pass 250, both the same
    // `Screen Copy` at 252, and none passes 253.
    const b = new EditBuffer(2)
    b.setText(0, 'x'.repeat(400))
    expect(b.length(0)).toBe(EditBuffer.MAX_HELD)
    expect(b.editable(0)).toBe(true)
    expect(b.text(1)).toBe('')
  })
})
