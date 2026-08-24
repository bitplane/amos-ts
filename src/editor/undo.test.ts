import { describe, expect, it } from 'vitest'
import { UN, UndoBuffer } from './undo'

/** the six bytes of record `i`, for a test that wants to see the ring itself */
const raw = (u: UndoBuffer, i: number): number[] => [...u.bytes.subarray(i * 6, i * 6 + 6)]

describe('the ring', () => {
  it('is Ed_NUndo plus three records, with a sentinel at each end', () => {
    // `Prg_UndoCreate` (+Edit.s:1977): `addq.l #3,d0 / mulu #6,d0`, then
    // $FF at the base and again at -12 from record 1
    const u = new UndoBuffer(4)
    expect(u.length).toBe(7 * 6)
    expect(u.bytes[0]).toBe(0xff)
    expect(u.bytes[6 * 6]).toBe(0xff)
    expect(u.position).toBe(1)
    expect(u.slots).toBe(5)
  })

  it('Ed_NUndo really buys that many undos', () => {
    // one sentinel at each end and one record always empty ahead of the
    // position: three, which is the `addq.l #3`
    const u = new UndoBuffer(4)
    for (let i = 1; i <= 9; i++) u.record(UN.CHAR, i, i)
    const seen: number[] = []
    for (let r = u.undo(); r !== null; r = u.undo()) seen.push(r.x)
    expect(seen).toEqual([9, 8, 7, 6])
  })

  it('Ed_NUndo of zero is undo turned off, not a ring of nothing', () => {
    const u = new UndoBuffer(0)
    expect(u.enabled).toBe(false)
    expect(u.record(UN.CHAR, 0, 0)).toBe(false)
    expect(u.undo()).toBeNull()
    expect(u.redo()).toBeNull()
  })

  it('wraps forward off the high sentinel and back off the low one', () => {
    const u = new UndoBuffer(2) // records 1, 2 and 3 usable
    for (let i = 0; i < 3; i++) u.record(UN.CHAR, i, i)
    // the third step landed on the high sentinel and came round to 1
    expect(u.position).toBe(1)
    u.record(UN.CHAR, 9, 9)
    expect(u.position).toBe(2)
    expect(u.undo()).toMatchObject({ x: 9, y: 9 })
    // and stepping back off record 1 lands on the last usable record
    expect(u.undo()).toMatchObject({ x: 2 })
    expect(u.position).toBe(3)
  })

  it('the oldest record is what a full ring loses', () => {
    const u = new UndoBuffer(2)
    for (let i = 1; i <= 5; i++) u.record(UN.CHAR, i, i)
    const seen: number[] = []
    for (;;) {
      const r = u.undo()
      if (r === null) break
      seen.push(r.x)
      if (seen.length > 6) break
    }
    // three usable records, and `Un_Avance` clears the one ahead, so two
    // survive: the fifth is where the position sits and the fourth behind it
    expect(seen).toEqual([5, 4])
  })
})

describe('recording', () => {
  it('writes the cursor, then steps past and clears what is ahead', () => {
    // `Un_Debut` (:2259) then `Un_Avance` (:2283)
    const u = new UndoBuffer(4)
    u.record(UN.DELETE, 7, 0x0102, 0, 65)
    expect(raw(u, 1)).toEqual([UN.DELETE, 7, 0x01, 0x02, 0, 65])
    expect(raw(u, 2)).toEqual([0, 0, 0, 0, 0, 0])
    expect(u.position).toBe(2)
  })

  it('a redo straight after an edit has nothing to find', () => {
    // which is why `Un_Avance` clears ahead of the position
    const u = new UndoBuffer(4)
    u.record(UN.CHAR, 1, 1)
    expect(u.redo()).toBeNull()
  })

  it('undo steps back before reading and redo reads before stepping on', () => {
    const u = new UndoBuffer(4)
    u.record(UN.CHAR, 3, 10, 0xff, 65)
    expect(u.undo()).toEqual({ code: UN.CHAR, owns: false, x: 3, y: 10, b4: 0xff, b5: 65, block: null })
    expect(u.undo()).toBeNull()
    expect(u.redo()).toMatchObject({ code: UN.CHAR, x: 3, y: 10 })
    expect(u.redo()).toBeNull()
  })

  it('records nothing while an undo is being applied', () => {
    // `tst.b Ed_FUndo(a5) / bne .OutNo`, and it is a counter because the
    // operations nest
    const u = new UndoBuffer(4)
    u.suppressed++
    expect(u.record(UN.CHAR, 1, 1)).toBe(false)
    u.suppressed++
    u.suppressed--
    expect(u.record(UN.CHAR, 1, 1)).toBe(false)
    u.suppressed--
    expect(u.record(UN.CHAR, 1, 1)).toBe(true)
  })
})

describe('a record that owns a block', () => {
  const text = Uint8Array.from([72, 73])

  it('moves the line word into the block and puts the pointer in its place', () => {
    // `Un_CLine` (:2230): `move.w 2(a2),2(a0)` then `move.l a0,2(a2)`
    const u = new UndoBuffer(4)
    u.recordLine(UN.CLEAR, 5, 0x0203, text)
    expect(u.bytes[6]).toBe(UN.CLEAR | 0x80)
    expect(raw(u, 1).slice(2, 6)).toEqual([0, 0, 0, 0])
    const r = u.undo()!
    expect(r.owns).toBe(true)
    expect(r.y).toBe(0x0203)
    expect([...r.block!]).toEqual([72, 73])
  })

  it('is stamped by its caller, not by Un_CLine', () => {
    // `Un_CLine` always writes $83 and its five callers write their own code
    // over it: $84 at :10524, $87 at :10646, $88 at :10617
    const u = new UndoBuffer(4)
    u.recordLine(UN.DLINE, 0, 1, text)
    expect(u.undo()!.code).toBe(UN.DLINE)
  })

  it('counts its bytes in and out again', () => {
    // `add.l d0,Prg_TUndo(a6)` at :2242, `sub.l d0,Prg_TUndo(a6)` at :2301
    const u = new UndoBuffer(2)
    u.recordLine(UN.CLEAR, 0, 0, text)
    expect(u.total).toBe(4 + text.length)
    u.raz()
    expect(u.total).toBe(0)
  })

  it('gives the bytes back when the ring comes round onto it', () => {
    const u = new UndoBuffer(2)
    for (let i = 0; i < 3; i++) u.recordLine(UN.CLEAR, 0, i, text)
    const held = u.total
    for (let i = 0; i < 3; i++) u.recordLine(UN.CLEAR, 0, i, text)
    expect(u.total).toBe(held)
  })

  it('the tokenise record carries both spellings and the count delta', () => {
    // built by hand at :10801, not by `Un_CLine`: [delta:2][oldLen][old]
    // [newLen][new], and `Un_Token` (:2130) takes the delta off Prg_NLigne
    const u = new UndoBuffer(4)
    const before = Uint8Array.from([1, 2, 3])
    const after = Uint8Array.from([9])
    u.recordToken(2, 40, 1, before, after)
    const r = u.undo()!
    expect(r.code).toBe(UN.TOKEN)
    expect(r.y).toBe(40)
    expect([...r.block!]).toEqual([0, 1, 3, 1, 2, 3, 1, 9])
  })
})

describe('clearing', () => {
  it('empties every record and brings the position back to one', () => {
    // `Prg_UndoRaz` (:2001) walks from record 1 to the high sentinel
    const u = new UndoBuffer(3)
    u.record(UN.CHAR, 1, 1)
    u.recordLine(UN.CLEAR, 2, 2, Uint8Array.from([1]))
    u.raz()
    expect(u.position).toBe(1)
    expect(u.undo()).toBeNull()
    expect(u.bytes[0]).toBe(0xff)
    expect(u.bytes[u.length - 6]).toBe(0xff)
  })
})
