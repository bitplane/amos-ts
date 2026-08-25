/**
 * `SetNot1.3` (+Verif.s:214) and the thirteen `bsr`s that reach it.
 *
 * The verdict is not a version stamp on the file. It is the answer to one
 * question the walk asks of every token: is there anything here AMOS 1.3
 * cannot do. `Prg_TestIt` (:4428) copies it into `Prg_Not1.3`, which is what
 * decides whether the next Save writes an `AMOS Basic v134` header.
 */
import { describe, expect, it } from 'vitest'
import { TokenTable } from './stream'
import { CORE_TOKENS } from './tables.gen'
import { tokeniseSource } from './edtok'
import { VerifyError, verify } from './verify'

const table = new TokenTable(CORE_TOKENS)

/** the verdict on one program, and the bytes the walk left behind */
function walk(text: string | Uint8Array, check13 = false): { not13: boolean; out: Uint8Array } {
  const stats = { instructions: 0, not13: false }
  const src = typeof text === 'string' ? tokeniseSource(text, table) : text
  const out = verify(src, { stats, check13 })
  return { not13: stats.not13, out }
}

const not13 = (text: string): boolean => walk(text).not13

describe('what still runs under 1.3', () => {
  it.each([
    ['Print "hi"', 'a print'],
    ['Cls', 'an instruction with no arguments'],
    ['A=1', 'an assignment'],
    ['For I=0 To 9 : Next I', 'a loop'],
    ['Dim T(4) : X=Match(T(0),1)', '=Match, which is the routine =Array falls into'],
    ['Dir', '51-Dir, which goes to the plain Ver_Normal'],
    ['Return', '53-Return'],
    ['Pop', '54-Pop'],
    ['A=Btst(0,1)', '56-Bset/Bchg/Ror, Pro spellings of a 1.3 idea'],
  ])('%s is compatible: %s', (text) => {
    expect(not13(text)).toBe(false)
  })
})

describe('what needs AMOS Professional', () => {
  it.each([
    ['Include "x"', '29-AMOSPro'],
    ['Erase Temp', '29-AMOSPro'],
    ['Resource Bank 1', '50-Dialogues'],
    ['Vdialog(0,0)=1', '2C-Variable reservee AMOSPro'],
    ['Vdialog$(0,0)="x"', '2C again, the string half'],
    ['Set Double Precision', 'VerDPre (:775)'],
    ['Set Accessory', 'VerSetA (:825)'],
    ['A=Equ("AEd_Up")', 'Equ_Verif (:1309)'],
    ['A=Lvo("Open")', 'the same routine, with _LVO in front of the name'],
    ['Dim T(4) : X=Array(T(0))', 'Ope_Array (:2844)'],
  ])('%s refuses 1.3: %s', (text) => {
    expect(not13(text)).toBe(true)
  })

  /**
   * `VerTrap` (:2260) raises the flag with its first instruction and only
   * then calls `Finie`, so under Check 1.3 a bare `Trap` is reported as
   * incompatible rather than as the syntax rule it also breaks.
   */
  it('flags Trap before it looks at what follows it', () => {
    expect(not13('Trap Cls')).toBe(true)
    expect(() => walk('Trap', true)).toThrow(/not compatible with AMOS 1.3/)
    expect(() => walk('Trap')).toThrow(/immediately followed by an instruction/)
  })

  /**
   * The eight tokens on class 2A are what a first Test leaves behind:
   * `Call Editor` is promoted to $268A and the promoted form carries the
   * verdict on its own, which is what makes a re-Test of a saved program
   * answer the same as the first.
   */
  it('keeps the verdict when the instruction has already been promoted', () => {
    const first = walk('Call Editor 1,1')
    expect(first.not13).toBe(true)
    expect((first.out[2]! << 8) | first.out[3]!).toBe(0x268a)
    expect(walk(first.out).not13).toBe(true)
  })
})

/**
 * `Ope_ConstDFl` (:2837). This port's `valRout` never writes one -- the
 * routine in the library decides on the digits and always answers `_TkFl` for
 * anything typed -- so the eight-byte constant is spliced in here instead of
 * being typed.
 */
describe('a double-precision constant', () => {
  it('refuses 1.3 on the token alone', () => {
    const src = tokeniseSource('A#=1.5', table)
    const at = src.findIndex((b, i) => i > 2 && b === 0x00 && src[i + 1] === 0x46)
    expect(at).toBeGreaterThan(0)
    const out = new Uint8Array(src.length + 4)
    out.set(src.subarray(0, at))
    out[at] = 0x2b // _TkDFl
    out[at + 1] = 0x6a
    out.set(src.subarray(at + 2, at + 6), at + 2)
    out.set(src.subarray(at + 6), at + 10)
    out[0] = src[0]! + 2 // the line is four bytes longer, and byte 0 is length/2
    expect(walk(out).not13).toBe(true)
  })
})

/**
 * `.NoPar` (:1578): the AMOS Pro compiler writes its output as a machine-code
 * procedure whose body opens with `||apcmp||`, and it is the relocation the
 * verifier then runs over that block that 1.3 has no code for.
 */
describe('a compiled procedure', () => {
  /** a Procedure header, a body of raw words, and an End Proc after it */
  function mlProc(body: number[]): Uint8Array {
    const out: number[] = []
    const w = (v: number): void => void out.push((v >> 8) & 0xff, v & 0xff)
    // `lea 12(a0,d0.l),a6` lands on the line AFTER End Proc, the same place
    // `.EndP` does, so the size covers the header and the End Proc line too
    const size = 24 + body.length + 6 - 14
    out.push(12, 1)
    w(0x0376) // Procedure
    w((size >> 16) & 0xffff)
    w(size & 0xffff)
    w(0) // the variable-space word the verifier fills in
    w(0x1000) // bit 4 of the high byte: langage machine
    w(0x0006) // Variable
    w(0) // runtime link
    out.push(4, 0x80, 0x44, 0x45, 0x4d, 0x4f) // len, flag, "DEMO"
    w(0) // end of the header line
    out.push(...body)
    out.push(3, 1)
    w(0x0390) // End Proc
    w(0)
    return Uint8Array.from(out)
  }

  /** a token line: the length/indent pair, the words, then the terminator */
  const bodyLine = (...words: number[]): number[] => {
    const out: number[] = [words.length + 2, 1]
    for (const v of words) out.push((v >> 8) & 0xff, v & 0xff)
    out.push(0, 0)
    return out
  }

  it('refuses 1.3 when the body opens with ||apcmp||', () => {
    expect(walk(mlProc(bodyLine(0x2bf4, 0, 0))).not13).toBe(true)
  })

  it('says nothing about a hand-written machine-code procedure', () => {
    expect(walk(mlProc(bodyLine(0x4e75, 0, 0))).not13).toBe(false)
  })
})

/**
 * `PTest` clears `VerCheck1.3` at :186, above the bank loop, so the last of
 * the thirteen tests can raise the flag and can never raise the error.
 */
describe('the banks', () => {
  const banked = (numbers: number[]): { not13: boolean } => {
    const stats = { instructions: 0, not13: false }
    verify(tokeniseSource('Print 1', table), { stats, bankNumbers: numbers, check13: true })
    return stats
  }

  it('takes bank 16 and refuses bank 17', () => {
    // `cmp.l #16,8(a0) / bhi.s .Non`
    expect(banked([1, 2, 16]).not13).toBe(false)
    expect(banked([17]).not13).toBe(true)
  })

  it('does not raise error 47 for a bank, even under Check 1.3', () => {
    expect(() => banked([17])).not.toThrow()
  })
})

describe('Check 1.3 as a stop rather than a flag', () => {
  it('reports 47 at the construct instead of walking on', () => {
    expect(() => walk('Print 1\nSet Accessory\nPrint 2', true)).toThrow(VerifyError)
    expect(() => walk('Print 1\nSet Accessory\nPrint 2', true)).toThrow(/not compatible with AMOS 1.3/)
  })

  it('lets a program 1.3 can run through untouched', () => {
    const plain = walk('Print 1\nCls\nFor I=0 To 9 : Next I')
    const checked = walk('Print 1\nCls\nFor I=0 To 9 : Next I', true)
    expect(checked.not13).toBe(false)
    expect(checked.out).toEqual(plain.out)
  })
})
