import { describe, expect, it } from 'vitest'
import { MACHINE_CODE_PROC, PROTECTED_PROC, TokenTable, parseSource } from './stream'
import { CORE_TOKENS } from './tables.gen'
import { Runtime } from '../runtime/runtime'

const table = new TokenTable(CORE_TOKENS)

const PROCEDURE = 0x0376
const END_PROC = 0x0390
const VARIABLE = 0x0006

/**
 * Build one tokenised source with a single `Procedure DEMO` whose body is the
 * given bytes, and the flags word the Procedure line carries.
 *
 * The layout is the one every .AMOS in the corpus uses (Cycron.AMOS on APD217
 * is the worked example): a Procedure line is
 *
 *   len indent | $0376 | size:u32 | word | flags | $0006 0000 len flags name | 0
 *
 * where `size` is the byte distance from just past the size field to the
 * start of the End Proc line, which is what locates the body's end.
 */
function programWith(flags: number, body: number[], endProcTail: number): Uint8Array {
  const name = 'DEMO'
  const out: number[] = []
  const w = (v: number): void => void out.push((v >> 8) & 0xff, v & 0xff)

  const procWords = 12 // header, token, size(2), word, flags, $0006, 0, len/flags, name(2), EOL
  const endProcAt = procWords * 2 + body.length
  const size = endProcAt - 8

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
  return Uint8Array.from(out)
}

/** three words that are not a token line under any reading */
const CIPHERTEXT = [0x04, 0x01, 0xd6, 0xb0, 0x6b, 0x47, 0x35, 0xda]

describe('protected procedures', () => {
  it('a locked procedure loses its body and keeps the program', () => {
    // flags $e08e is Cycron's own: bit 15 folded, bit 14 cannot-open, bit 13,
    // and a low byte that differs per procedure
    const src = programWith(0xe08e, CIPHERTEXT, 0x79ab)
    const lines = parseSource(src, table)
    expect(lines.length).toBe(2)
    const proc = lines[0]!.tokens.find((t) => t.kind === 'proc')!
    expect(proc.kind).toBe('proc')
    if (proc.kind !== 'proc') throw new Error('not a proc')
    expect(proc.flags & PROTECTED_PROC).toBeTruthy()
    expect(proc.protectedBody).toEqual(Uint8Array.from(CIPHERTEXT))
    // and the End Proc line survives, so the program structure balances
    expect(lines[1]!.tokens.length).toBe(1)
  })

  it("the locked cipher runs one word into the End Proc line, and that is tolerated", () => {
    // 1,540 of the 1,554 protected procedures in the corpus have a non-zero
    // word where End Proc's EOL should be; the 65 machine-code ones do not
    const withJunk = parseSource(programWith(0xe08e, CIPHERTEXT, 0x79ab), table)
    const withZero = parseSource(programWith(0xe08e, CIPHERTEXT, 0x0000), table)
    expect(withJunk.length).toBe(withZero.length)
  })

  it('a machine-code procedure is the same skip, marked differently', () => {
    // Ed_ProcML (+Edit.s:8759) sets bits 14 and 12 together
    const flags = PROTECTED_PROC | MACHINE_CODE_PROC | 0x8000
    const lines = parseSource(programWith(flags, [0x4e, 0x75, 0x4e, 0x71], 0), table)
    expect(lines.length).toBe(2)
    const proc = lines[0]!.tokens[0]!
    if (proc.kind !== 'proc') throw new Error('not a proc')
    expect(proc.flags & MACHINE_CODE_PROC).toBeTruthy()
  })

  it('the flag is what does it — the same bytes unflagged still fail', () => {
    expect(() => parseSource(programWith(0x8000, CIPHERTEXT, 0x79ab), table)).toThrow()
  })

  it('a bad End Proc target is refused rather than skipped past', () => {
    const src = programWith(0xe08e, CIPHERTEXT, 0x79ab)
    // corrupt the size field so endTarget lands beyond the source
    src[6] = 0xff
    expect(() => parseSource(src, table)).toThrow(/protected procedure/)
  })
})

describe('calling a protected procedure', () => {
  const run = (flags: number): string => {
    const src = programWith(flags, CIPHERTEXT, flags & MACHINE_CODE_PROC ? 0 : 0x79ab)
    const lines = parseSource(src, table)
    // Proc DEMO, hand-built: the call is a proc-call token line
    const rt = new Runtime(lines, table, { maxSteps: 10_000 })
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
    expect(run(0xe08e)).toMatch(/DEMO is a protected procedure \(locked\)/)
    expect(run(PROTECTED_PROC | MACHINE_CODE_PROC | 0x8000)).toMatch(/\(machine code\)/)
  })
})
