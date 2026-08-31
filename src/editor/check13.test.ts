/**
 * `Ed_Check1.3` (+Edit.s:8441), the one command whose whole job is to run the
 * verifier and read a flag.
 *
 * It is also the only alert in the editor whose text does not come from
 * `Ed_Messages`: `Ed_GetMessageA0` is pointed at `Ed_TstMessages` instead, so
 * message 49 here is not message 49 anywhere else.
 */
import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { ED_TST_MESSAGES } from '../runtime/edmessages.gen'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, drawWindows, edCall } from './commands'
import { statusLine } from './display'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)

function open(text: string): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text), 4096), new EditBuffer(8), new UndoBuffer(50), table)
  drawWindows(e.editor)
  return e
}

/**
 * An `AmBs` block holding one empty memory bank, so that `PTest`'s last test
 * has something to walk. `AmBk`, the number, the memory type, a length that
 * counts its own eight-byte name and header, and the name.
 */
function banked(number: number): Uint8Array {
  const out = new Uint8Array(6 + 4 + 2 + 2 + 4 + 8)
  out.set([0x41, 0x6d, 0x42, 0x73, 0, 1]) // "AmBs", one bank
  out.set([0x41, 0x6d, 0x42, 0x6b], 6) // "AmBk"
  out[10] = (number >> 8) & 0xff
  out[11] = number & 0xff
  out[17] = 8 // the length long, which is 8 for a bank with no data
  out.set([...'Test    '].map((c) => c.charCodeAt(0)), 18)
  return out
}

describe('Ed_Check1.3', () => {
  it('says the program is compatible, out of the test table', () => {
    const e = open('Print "one"\nCls\nFor I=0 To 9 : Next I')
    expect(edCall(e, ED.CHECK_13)).toBe(49)
    expect(e.alertText).toBe(ED_TST_MESSAGES[48])
    expect(e.alertText).toBe('This program is compatible with AMOS 1.3')
    expect(e.prog.pro).toBe(false)
  })

  /** `moveq #127,d0 / bra Ed_Alert`, and d0 lands in `Edt_EtMess` */
  it('leaves the message up for 127 frames, not the usual 100', () => {
    const e = open('Print "one"')
    edCall(e, ED.CHECK_13)
    expect(e.alertTime).toBe(127)
  })

  it('puts that text on the status line', () => {
    const e = open('Print "one"')
    edCall(e, ED.CHECK_13)
    expect(statusLine(e).trim()).toBe('This program is compatible with AMOS 1.3')
  })

  /**
   * `move.b #1,VerCheck1.3(a5)` turns the walk's flag into a stop, so the
   * command never reaches its own alert: the test fails with 47 on the line
   * that is at fault and `Ed_ErrTest` puts the cursor there.
   */
  it('stops at the first thing 1.3 has not got', () => {
    const e = open('Print "one"\nSet Accessory\nPrint "two"')
    // `Ed_ErrTest` (+Edit.s:8246) ends in `Ed_Alert`, so the answer is the
    // test message and not 0
    expect(edCall(e, ED.CHECK_13)).toBe(47)
    expect(e.testError).toBe(47)
    expect(ED_TST_MESSAGES[46]).toBe('Instruction not compatible with AMOS 1.3')
    expect(e.line).toBe(1)
  })

  /**
   * `PTest` clears the check at :186, above the bank loop, so a bank the flag
   * catches is reported rather than thrown. Message 48 is reachable no other
   * way: anything in the source would have stopped the walk first.
   */
  it('reports too many banks when the source itself is clean', () => {
    const e = open('Print "one"')
    e.prog.banks = banked(17)
    expect(edCall(e, ED.CHECK_13)).toBe(48)
    expect(e.alertText).toBe('This program holds too many banks for AMOS 1.3')
    expect(e.prog.pro).toBe(true)
  })

  it('takes bank 16 without complaining', () => {
    const e = open('Print "one"')
    e.prog.banks = banked(16)
    expect(edCall(e, ED.CHECK_13)).toBe(49)
    expect(e.prog.pro).toBe(false)
  })

  /**
   * `move.b #1,Prg_StModif(a6)` before the call. Without it a program tested
   * a moment ago would answer from a test that never ran, because the verdict
   * lives in the verifier and not in the program.
   */
  it('tests again even when nothing has changed since the last test', () => {
    const e = open('Print "one"')
    e.prog.banks = banked(17)
    e.prog.modified = false
    expect(edCall(e, ED.CHECK_13)).toBe(48)
  })
})

/**
 * `Prg_TestIt` (+Verif.s:4428) copies the verdict into `Prg_Not1.3` on every
 * Test, not only this one.
 */
describe('the verdict an ordinary Test leaves behind', () => {
  it('is written by Test as well as by Check 1.3', () => {
    const e = open('Set Accessory')
    e.prog.modified = true
    expect(edCall(e, ED.TEST)).toBe(197) // Ed_Test's own "Test OK"
    expect(e.prog.pro).toBe(true)
  })

  it('comes back down when the program no longer needs Pro', () => {
    const e = open('Print "one"')
    e.prog.pro = true
    e.prog.modified = true
    edCall(e, ED.TEST)
    expect(e.prog.pro).toBe(false)
  })
})
