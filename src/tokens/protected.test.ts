import { describe, expect, it } from 'vitest'
import {
  ENCIPHERED_PROC,
  MACHINE_CODE_PROC,
  PROTECTED_PROC,
  TokenTable,
  parseSource,
} from './stream'
import { procode } from './procode'
import { CORE_TOKENS } from './tables.gen'
import { Runtime } from '../runtime/runtime'

const table = new TokenTable(CORE_TOKENS)

const PROCEDURE = 0x0376
const END_PROC = 0x0390
const VARIABLE = 0x0006
const PRINT = 0x0476
const INT = 0x003e

/**
 * One `Procedure NAME` ... `End Proc` block, body included, in the layout
 * every .AMOS in the corpus uses (Cycron.AMOS on APD217 is the worked
 * example). The Procedure line is
 *
 *   len indent | $0376 | size:u32 | word | flags | $0006 0000 len flags name | 0
 *
 * where `size` is the byte distance from just past the size field to the
 * start of the End Proc line, which is what locates the body's end.
 *
 * Blocks nest, which is what the nested-lock test needs: one block's bytes
 * are another's `body`. Names are four characters so that the header stays
 * twelve words.
 */
function procBlock(name: string, flags: number, body: number[], endProcTail = 0): number[] {
  const out: number[] = []
  const w = (v: number): void => void out.push((v >> 8) & 0xff, v & 0xff)

  const procWords = 12 // header, token, size(2), word, flags, $0006, 0, len/flags, name(2), EOL
  const size = procWords * 2 + body.length - 8

  out.push(procWords, 1)
  w(PROCEDURE)
  w((size >> 16) & 0xffff)
  w(size & 0xffff)
  w(0) // the per-procedure word the editor keeps
  w(flags)
  w(VARIABLE)
  w(0) // runtime link
  out.push(name.length, 0x80)
  for (const c of name) out.push(c.charCodeAt(0))
  w(0) // EOL

  out.push(...body)

  out.push(3, 1)
  w(END_PROC)
  w(endProcTail)
  return out
}

const programWith = (flags: number, body: number[], endProcTail = 0): Uint8Array =>
  Uint8Array.from(procBlock('DEMO', flags, body, endProcTail))

/** a token line: the length/indent word, the given words, then EOL */
function line(...words: number[]): number[] {
  const out: number[] = [words.length + 2, 2]
  for (const v of words) out.push((v >> 8) & 0xff, v & 0xff)
  out.push(0, 0)
  return out
}
const printLine = (n: number): number[] => line(PRINT, INT, (n >> 16) & 0xffff, n & 0xffff)

/** three words that are not a token line under any reading */
const CIPHERTEXT = [0x04, 0x01, 0xd6, 0xb0, 0x6b, 0x47, 0x35, 0xda]

/**
 * Cycron's own flags: bit 15 folded, bit 14 locked, bit 13 enciphered, and a
 * low byte that differs per procedure because the locker randomises it.
 */
const LOCKED = 0xe08e

describe('locked procedures are deciphered (ProCode, +Verif.s:5195)', () => {
  const body = [...printLine(42), ...printLine(7)]

  it('an enciphered body comes back as the lines it was', () => {
    const locked = programWith(LOCKED, body)
    expect(procode(locked, 0)).toBe(true)
    // the body really is gone at this point, header and End Proc token apart
    expect([...locked.subarray(24, 24 + body.length)]).not.toEqual(body)

    const got = parseSource(locked, table)
    const want = parseSource(programWith(0x8000, body), table)
    expect(got.length).toBe(4) // Procedure, two Prints, End Proc
    // everything but the Procedure line itself, whose bit 13 is now clear
    expect(got.slice(1).map((l) => l.tokens)).toEqual(want.slice(1).map((l) => l.tokens))
  })

  it('the cipher is symmetric — the same routine locks and unlocks', () => {
    const there = programWith(LOCKED, body)
    procode(there, 0)
    const back = Uint8Array.from(there)
    procode(back, 0)
    expect(back).toEqual(programWith(LOCKED, body))
  })

  it('and it reaches one line PAST the body, into End Proc', () => {
    // End Proc keeps its length, indent and token in clear; its EOL word goes
    // with the body, which is why 1,540 of the 1,554 in the corpus have a
    // non-zero word where a terminator belongs
    const locked = programWith(LOCKED, body)
    const before = Uint8Array.from(locked)
    procode(locked, 0)
    const endProc = 24 + body.length
    expect([...locked.subarray(endProc, endProc + 4)]).toEqual([
      ...before.subarray(endProc, endProc + 4),
    ])
    expect([...locked.subarray(endProc + 4, endProc + 6)]).not.toEqual([0, 0])
  })

  it('bit 13 is cleared and bit 14 kept: closed to the editor, open to the runtime', () => {
    const locked = programWith(LOCKED, body)
    procode(locked, 0)
    const proc = parseSource(locked, table)[0]!.tokens[0]!
    if (proc.kind !== 'proc') throw new Error('not a proc')
    expect(proc.flags & PROTECTED_PROC).toBeTruthy()
    expect(proc.flags & ENCIPHERED_PROC).toBeFalsy()
    expect(proc.protectedBody).toBeUndefined()
  })

  it('a locked procedure nested inside one comes out in the same pass', () => {
    // TUSTMC.AMOS is the corpus case: the inner header is itself inside the
    // outer cipher, so it can only be read once the outer one is undone
    const inner = procBlock('INNR', LOCKED, printLine(7))
    const outer = Uint8Array.from(procBlock('OUTR', LOCKED, inner))
    expect(procode(outer, 24)).toBe(true) // inner first, as the locker would
    expect(procode(outer, 0)).toBe(true)

    const got = parseSource(outer, table)
    // Procedure OUTR, Procedure INNR, Print, End Proc, End Proc
    expect(got.length).toBe(5)
    expect(got.every((l) => l.tokens.every((t) => t.kind !== 'proc' || !t.protectedBody))).toBe(true)
  })

  it('the call is honoured, where before it was refused', () => {
    const locked = programWith(LOCKED, body)
    procode(locked, 0)
    const rt = new Runtime(parseSource(locked, table), table, { maxSteps: 10_000 })
    expect(() => rt.interp.callProc('demo', [])).not.toThrow()
  })
})

describe('a body that will not decipher is still not lost', () => {
  it('an unreadable body is taken whole and the program keeps its structure', () => {
    // the cipher is unauthenticated, so a wrong key yields bytes rather than
    // an error; what rejects this is the body failing to read as token lines
    const src = programWith(LOCKED, CIPHERTEXT, 0x79ab)
    const lines = parseSource(src, table)
    expect(lines.length).toBe(2)
    const proc = lines[0]!.tokens.find((t) => t.kind === 'proc')!
    if (proc.kind !== 'proc') throw new Error('not a proc')
    expect(proc.flags & ENCIPHERED_PROC).toBeTruthy()
    expect(proc.protectedBody).toEqual(Uint8Array.from(CIPHERTEXT))
    // and the End Proc line survives, so the program structure balances
    expect(lines[1]!.tokens.length).toBe(1)
  })

  it('the junk word left where End Proc ends is tolerated', () => {
    const withJunk = parseSource(programWith(LOCKED, CIPHERTEXT, 0x79ab), table)
    const withZero = parseSource(programWith(LOCKED, CIPHERTEXT, 0x0000), table)
    expect(withJunk.length).toBe(withZero.length)
  })

  it('a machine-code procedure is the same skip, marked differently', () => {
    // Ed_ProcML (+Edit.s:8759) sets bits 14 and 12 together, and ProCode
    // returns at once on bit 12 — a 68k image is not enciphered
    const flags = PROTECTED_PROC | MACHINE_CODE_PROC | 0x8000
    const lines = parseSource(programWith(flags, [0x4e, 0x75, 0x4e, 0x71]), table)
    expect(lines.length).toBe(2)
    const proc = lines[0]!.tokens[0]!
    if (proc.kind !== 'proc') throw new Error('not a proc')
    expect(proc.flags & MACHINE_CODE_PROC).toBeTruthy()
    expect(proc.protectedBody).toBeTruthy()
  })

  it('the flag is what does it — the same bytes unflagged still fail', () => {
    expect(() => parseSource(programWith(0x8000, CIPHERTEXT, 0x79ab), table)).toThrow()
  })

  it('a bad End Proc target is refused rather than skipped past', () => {
    const src = programWith(LOCKED, CIPHERTEXT, 0x79ab)
    // corrupt the size field so endTarget lands beyond the source
    src[6] = 0xff
    expect(() => parseSource(src, table)).toThrow(/protected procedure/)
  })
})

describe('calling a procedure whose body never arrived', () => {
  const run = (flags: number): string => {
    const src = programWith(flags, CIPHERTEXT, flags & MACHINE_CODE_PROC ? 0 : 0x79ab)
    const rt = new Runtime(parseSource(src, table), table, { maxSteps: 10_000 })
    try {
      rt.interp.callProc('demo', [])
      return 'called'
    } catch (e) {
      return (e as Error).message
    }
  }

  it('refuses rather than returning as though it had run', () => {
    // falling through to End Proc would report success from a procedure that
    // did none of its work
    expect(run(LOCKED)).toMatch(/DEMO is a protected procedure \(locked\)/)
    expect(run(PROTECTED_PROC | MACHINE_CODE_PROC | 0x8000)).toMatch(/\(machine code\)/)
  })
})
