import { describe, expect, it } from 'vitest'
import { TokenTable, parseSource } from './stream'
import type { Tok } from './stream'
import { CORE_TOKENS } from './tables.gen'
import { tokenize } from './source'
import { verify } from './verify'
import { tokeniseSource } from './edtok'
import { SYSTEM_EQUATES } from './equates.gen'

const table = new TokenTable(CORE_TOKENS)

/** every equate payload a line came out carrying, in order */
function payloads(text: string, equates?: string): Array<{ value: number; type: number; resolved: boolean }> {
  const src = equates === undefined ? tokenize(text, table) : parseSource(verify(tokeniseSource(text, table), { equates }), table)
  const out: Array<{ value: number; type: number; resolved: boolean }> = []
  for (const line of src) {
    for (const t of line.tokens as Tok[]) if (t.kind === 'core' && t.equ) out.push(t.equ)
  }
  return out
}

const one = (text: string): { value: number; type: number; resolved: boolean } => payloads(text)[0]!

describe('the shipped equates file', () => {
  it('opens with the newline every key is anchored to', () => {
    // `Equ_Nul dc.b 10,0` (+Verif.s:4312) is a newline and a terminator, so
    // the key is "\nNAME:" and the first entry is only findable because the
    // file starts with one
    expect(SYSTEM_EQUATES.charCodeAt(0)).toBe(10)
    expect(SYSTEM_EQUATES.split('\n').filter((l) => l !== '').length).toBe(2505)
  })

  it('reads a value and its type out of the file', () => {
    expect(one('X=Equ("AEd_Up")')).toEqual({ value: 1, type: 7, resolved: true })
    expect(one('X=Equ("CTF_UPPER")')).toEqual({ value: 64, type: 7, resolved: true })
    expect(one('X=Struc(0,"LN_NAME")')).toEqual({ value: 10, type: 6, resolved: true })
  })

  it('`Lvo` is `Equ` with _LVO in front of the name', () => {
    // `Ope_LVO` (+Verif.s:2957) differs from `Ope_Equ` by the header alone
    expect(one('X=Lvo("Open")')).toEqual({ value: -30, type: 7, resolved: true })
    expect(one('X=Equ("_LVOOpen")')).toEqual({ value: -30, type: 7, resolved: true })
  })

  it('names are matched case-sensitively, as a byte search must be', () => {
    // `L_InstrFind` (+Lib.s:13829) is `cmpm.b`, and nothing folds case first
    expect(() => payloads('X=Equ("aed_up")')).toThrow(/Equate not defined/)
  })

  it('keeps the FIRST of two lines with the same name', () => {
    // the file gives AEdAsk_X twice, as 3 and as 4. InstrFind stops at the
    // first match, so the second line cannot be reached by any spelling
    expect(SYSTEM_EQUATES).toContain('\nAEdAsk_X:3,7\nAEdAsk_X:4,7\n')
    expect(one('X=Equ("AEdAsk_X")').value).toBe(3)
  })

  it('DEFECT: `AEd_WordRight` cannot be read, because its line has two commas', () => {
    // "AEd_WordRight:8,,7" -- `move.b (a0),d0 / sub.b #"0",d0 / cmp.b #7,d0 /
    // bhi .Bad` reads the second comma as the type digit and gets 252
    expect(SYSTEM_EQUATES).toContain('\nAEd_WordRight:8,,7')
    expect(() => payloads('X=Equ("AEd_WordRight")')).toThrow(/Bad format in equate file/)
  })

  it('a missing name is 51 and a missing file is 52', () => {
    expect(() => payloads('X=Equ("NoSuchThing")')).toThrow(/Equate not defined/)
    expect(() => payloads('X=Equ("AEd_Up")', '')).toThrow(/Cannot load equate file/)
  })

  it('takes a file the program brought with it', () => {
    // DBench carries equates that are in nobody else's file, and 123 corpus
    // lines use names the shipped one does not hold
    expect(payloads('X=Equ("DE_BankHead")', '\nDE_BankHead:$2A,7\n')[0]).toEqual({ value: 0x2a, type: 7, resolved: true })
  })
})

describe('what the four spellings will accept', () => {
  it('`Struc` takes types 0 to 6 and `Struc$` only 6', () => {
    // VerStruI `cmp.b #7,d2 / bcc EquType`, VerStruIS `cmp.b #6,d2 / bne`
    expect(one('Struc(0,"LN_TYPE")=1').type).toBe(3)
    expect(() => payloads('Struc(0,"AEd_Up")=1')).toThrow(/Equate not of the right type/)
    expect(one('Struc$(0,"LN_NAME")="x"').type).toBe(6)
    expect(() => payloads('Struc$(0,"LN_TYPE")="x"')).toThrow(/Equate not of the right type/)
  })

  it('the reading forms refuse the same thing with a different error', () => {
    // `Ope_Struc` (:2936) branches to VerType where `VerStruI` branches to
    // EquType. A difference in the shipped code, not in this port.
    expect(() => payloads('X=Struc(0,"AEd_Up")')).toThrow(/Type mismatch/)
    expect(() => payloads('X$=Struc$(0,"LN_TYPE")')).toThrow(/Type mismatch/)
  })

  it('the base address is an integer expression and the name a constant', () => {
    expect(one('X=Struc(A+4*2,"LN_NAME")').value).toBe(10)
    expect(() => payloads('X=Struc("s","LN_NAME")')).toThrow(/Type mismatch/)
    expect(() => payloads('X=Equ(A$)')).toThrow(/Syntax error/)
  })

  it('an assignment has to match the equate, not the variable', () => {
    expect(() => payloads('Struc(0,"LN_TYPE")="x"')).toThrow(/Type mismatch/)
    expect(() => payloads('Struc$(0,"LN_NAME")=1')).toThrow(/Type mismatch/)
  })
})

describe('a poked equate is never looked up again', () => {
  it('runs with no equates file at all once the value is in the source', () => {
    // Equates.Doc: "once the program has been tested, AMOS Pro will not need
    // to load the Equate file", which is what lets a program reach someone
    // who has never had one
    const poked = verify(tokeniseSource('X=Equ("AEd_Up")', table), {})
    // the same bytes again, through a verifier with nothing to read
    const again = verify(poked, { equates: '' })
    const tok = parseSource(again, table)
      .flatMap((l) => l.tokens)
      .find((t) => t.kind === 'core' && t.equ)
    expect(tok).toBeDefined()
    expect((tok as { equ: { value: number } }).equ.value).toBe(1)
    expect(again).toEqual(poked)
  })
})
