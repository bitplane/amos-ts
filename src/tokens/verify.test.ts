/**
 * Pass one of the verifier, on programs small enough to read as bytes, and
 * then on every program in `fixtures/`.
 *
 * The unit tests all go the same way: tokenise a line of text with the port's
 * own tokeniser, verify it, and read the token id back. That is the pair the
 * editor uses, so a promotion the verifier gets wrong shows up as the wrong
 * two bytes rather than as a behaviour nobody can point at.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { T, TokenTable, decipheredSource, parseSource } from './stream'
import type { TokenLine } from './stream'
import { CORE_TOKENS } from './tables.gen'
import { TK, detokLineBytes, tokeniseLine, tokeniseSource } from './edtok'
import { opaqueRanges } from './roundtrip'
import { parseAmosFile } from '../loader/amosfile'
import { extensionAp20For, extensionTablesFor } from '../ext/identify'
import { VerifyError, verify } from './verify'
import { LineTooLongError, SourceVerifyError, tokenize } from './source'

const table = new TokenTable(CORE_TOKENS)
const idAt = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!
const run = (text: string, ext?: Map<number, TokenTable>): Uint8Array => {
  const opts = ext === undefined ? {} : { extensions: ext }
  return verify(tokeniseSource(text, table, opts), opts)
}

describe('the instruction a line really holds', () => {
  /**
   * `Cls` is one keyword and three instructions. The tokeniser can only ever
   * write $0BAE, the entry the name is on, and `VerC4` (+Verif.s:3158) walks
   * the $FE chain behind it until the argument count fits.
   */
  it('swaps an instruction for the variant its arguments fit', () => {
    expect(idAt(run('Cls'), 2)).toBe(0x0bae)
    expect(idAt(run('Cls 0'), 2)).toBe(0x0bb8)
    expect(idAt(run('Cls 0,0,0 To 0,0'), 2)).toBe(0x0bc0)
  })

  /**
   * `Add` picks between two tokens rather than walking a chain: `VerAdd`
   * (:1213) writes $0458 over the instruction and changes its mind to $0462
   * when a third argument turns up.
   */
  it('gives Add the token its argument count asks for', () => {
    expect(idAt(run('ADD A,1'), 2)).toBe(0x0458)
    expect(idAt(run('ADD A,1,2 To 3'), 2)).toBe(0x0462)
  })

  it('refuses an argument of the wrong type without trying the next variant', () => {
    // VerC1's `.Comp cmp.b d0,d1 / bne VerType` is not a fallthrough
    expect(() => run('Cls "x"')).toThrow(VerifyError)
    expect(() => run('Cls "x"')).toThrow(/Type mismatch/)
  })
})

describe('what a bare name turns out to be', () => {
  /**
   * The tokeniser writes $0006 for every name it reads. Only the verifier
   * knows which of them is a jump target, a procedure call or a variable, and
   * it decides from what follows rather than from the name.
   */
  it('makes a name with nothing after it a procedure call', () => {
    const b = run('MYPROC\nProcedure MYPROC\nEnd Proc')
    expect(idAt(b, 2)).toBe(T.PROC_CALL)
    // `or.b #$80,3(a6)` (:3277), the bit that says the record is a call
    expect(b[7]).toBe(0x80)
  })

  it('makes the name behind a Goto a line-number reference', () => {
    expect(idAt(run('Goto FOO\nFOO:'), 4)).toBe(T.LABEL_REF)
  })

  /**
   * `VerX` (:496) resolves the names in a second walk, because a label is
   * usually below the line that jumps to it. What is left over at the end is
   * an error, not a zero.
   */
  it('refuses a jump to a label nobody defined', () => {
    expect(() => run('Goto NOWHERE')).toThrow(/Undefined label/)
    expect(() => run('NOSUCHPROC')).toThrow(/Undefined procedure/)
  })

  /**
   * `V1_GoLabel` (:3362) reads the token AFTER the name to decide. Anything
   * that is not a comma or the end of the statement makes it an expression,
   * so a computed `Goto` stays a variable.
   */
  it('leaves a name a variable when an expression follows it', () => {
    expect(idAt(run('Goto FOO+1\nFOO:'), 4)).toBe(T.VARIABLE)
  })

  it('leaves an assignment alone', () => {
    expect(idAt(run('A=1'), 2)).toBe(T.VARIABLE)
  })
})

/**
 * A synthetic extension, because the point is the shape of the table and not
 * which library it came from: one keyword and a chain of nameless entries
 * behind it, which is how every extension writes argument counts.
 */
const zap = new TokenTable(
  [
    { id: 0x0000, name: '', spec: '', instr: 1, func: 1 },
    { id: 0x0006, name: 'zap', spec: 'I0', end: 0xfe, instr: 2, func: 0xffff },
    { id: 0x0010, name: '', spec: 'I0,0', end: 0xfe, instr: 2, func: 0xffff },
    { id: 0x001c, name: '', spec: 'I0,0,0', end: 0xfe, instr: 2, func: 0xffff },
    { id: 0x002a, name: '', spec: 'I0,0,0,0,0,0,0,0,0,0', instr: 2, func: 0xffff },
  ],
  true,
)
const slot3 = new Map([[3, zap]])

describe('the byte behind an extension slot', () => {
  it('holds the argument count, and the token becomes the matching variant', () => {
    const one = run('Zap 1', slot3)
    expect(idAt(one, 6)).toBe(0x0006)
    expect(one[5]).toBe(1)
    const two = run('Zap 1,2', slot3)
    expect(idAt(two, 6)).toBe(0x0010)
    expect(two[5]).toBe(2)
  })

  /**
   * `Ver_Extension` (:429) pokes $FF instead when `LBF_20` is set, because an
   * AP20 library counts its own arguments. src/ext/identify.ts reads that byte
   * back the other way, to work out which library a slot really held.
   */
  it('holds $FF for an AP20 library, whatever the count was', () => {
    const b = verify(tokeniseSource('Zap 1,2', table, { extensions: slot3 }), {
      extensions: slot3,
      ap20: new Set([3]),
    })
    expect(b[5]).toBe(0xff)
    expect(idAt(b, 6)).toBe(0x0010)
  })

  /**
   * `VerI` builds its argument string in twenty bytes and stops the index at
   * 18, so the eleventh argument onwards is written over the tenth. Twelve
   * arguments come out as ten and a count of nine, which is not a rounding
   * error: `Ipalette` with sixteen colours is stored exactly that way in
   * intuition-1.3b's own inttest1.amos.
   */
  it('stops counting at ten arguments, the way the twenty-byte buffer does', () => {
    const b = run('Zap 1,2,3,4,5,6,7,8,9,10,11,12', slot3)
    expect(idAt(b, 6)).toBe(0x002a)
    expect(b[5]).toBe(9)
  })
})

describe('the words pass two dokes back', () => {
  /**
   * A variable's link is its offset in the buffer, six bytes apart and handed
   * out in the order the names first appear. `V2_StoVar` (:3634) reads it back
   * out of the name record, so it is settled the moment the name is created.
   */
  it('gives each name its offset in the variable buffer', () => {
    const b = run('A=1 : B=2 : A=3')
    expect(idAt(b, 4)).toBe(0)
    expect(idAt(b, 22)).toBe(6)
    expect(idAt(b, 40)).toBe(0)
  })

  /**
   * A label reference carries `(record + 4) - LabHaut`, and the table grows
   * down, so it is negative. The first record starts eight bytes plus the name
   * below `LabBas`, and `LabBas` itself starts two below `LabHaut`
   * (`ResVarBuf` :4059 writes an end marker there first). A four-letter label
   * is therefore -10, and the next one -22.
   */
  it('gives each label reference its distance below the top of the table', () => {
    const b = run('Goto ZFOO\nZFOO:\nZBAR:\nGoto ZBAR')
    expect(idAt(b, 6)).toBe(0xfff6)
    expect(idAt(b, 50)).toBe(0xffea)
  })

  /**
   * `PTest` (:130) pokes the phase's `VarLong` into the Procedure record when
   * the phase is over, which is how much space the interpreter reserves for
   * the call. `Shared A` reaches the global A, so only B is local here.
   */
  it("gives a procedure the size of its own variables", () => {
    const b = run('A=1\nProcedure P\nShared A\nA=2\nB=3\nEnd Proc')
    expect(idAt(b, 28)).toBe(6)
    // and the shared name links to the global buffer, which is -(offset + 1)
    expect(idAt(b, 60)).toBe(0xffff)
  })
})

describe('the branch links pass two fills in', () => {
  /**
   * `For` carries the distance to the end of its `Next`, and `Doke_Distance`
   * (+Verif.s:2434) makes it `target - slot - 2`. The target is what
   * `Find_End` (:2444) hands back: the line after the `Next`, or the `Next`
   * itself when nothing follows it.
   */
  it('gives For the distance to its Next', () => {
    expect(idAt(run('For I=0 To 9\nNext I'), 4)).toBe(38)
  })

  /**
   * `If` branches to just past its `Else`'s own link, and the `Else` to the
   * end of the `End If`. Bit 0 of the word says the branch lands on an
   * `Else If`, which has a test of its own to run.
   */
  it('gives If and Else the distance to what closes them', () => {
    const b = run('If A=1\nPrint 1\nElse \nPrint 2\nEnd If')
    expect(idAt(b, 4)).toBe(36)
    expect(idAt(b, 40)).toBe(18)
  })

  /**
   * `Exit` carries two words: the distance out and how much interpreter stack
   * to drop, which is `TDoLoop` for a `Do` and `TForNxt` for a `For`
   * (+Equ.s:2368).
   */
  it('gives Exit the distance out and the stack to unwind', () => {
    const b = run('Do\nExit 1\nLoop')
    expect(idAt(b, 4)).toBe(22)
    expect(idAt(b, 12)).toBe(12)
    expect(idAt(b, 14)).toBe(10)
  })

  it('refuses a structure nothing closes', () => {
    expect(() => run('For I=0 To 9')).toThrow(/FOR without matching NEXT/)
    expect(() => run('Next I')).toThrow(/NEXT without FOR/)
    expect(() => run('Do')).toThrow(/DO without LOOP/)
    expect(() => run('If A=1')).toThrow(/IF without ENDIF/)
  })
})

describe('the errors the verifier raises', () => {
  it('names them by the code +Editor_Config.s gives them', () => {
    // 38-Array not dimensioned: `bne VerNDim` after V1_StoVar created it
    const e = (() => {
      try {
        run('A(1)=2')
        return null
      } catch (err) {
        return err as VerifyError
      }
    })()
    expect(e?.code).toBe(38)
    expect(e?.message).toMatch(/Array not dimensioned/)
  })

  it('accepts the same array once Dim has been past', () => {
    expect(() => run('Dim A(10)\nA(1)=2')).not.toThrow()
  })

  it('refuses a second Dim of the same array', () => {
    expect(() => run('Dim A(10)\nDim A(10)')).toThrow(/Array already dimensioned/)
  })

  /** `V1_EndProc` (:1676) is `tst.w Phase(a5) / beq VerPNo` */
  it('refuses End Proc outside a procedure', () => {
    expect(() => run('End Proc')).toThrow(/Procedure not opened/)
  })
})

/* ---- the sweep ----------------------------------------------------------- */

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walk(p)
    else if (/\.amos$/i.test(name)) yield p
  }
}

/**
 * The two things a listing cannot carry, cleared on both sides.
 *
 * An empty line's indent is the editor's and not the tokeniser's: `TokVide`
 * never reaches `TokT1`, so it writes a zero where the editor's own blank line
 * carries a one. And a Procedure's flags word is state the editor keeps about
 * the procedure -- folded, locked, cannot be opened -- which no listing shows
 * and `Tokenise` therefore cannot put back.
 */
function clearEditorState(x: Uint8Array): Uint8Array {
  let q = 0
  while (q + 2 <= x.length) {
    const w = x[q]!
    if (w === 0) break
    if (w === 2) x[q + 1] = 0
    if (((x[q + 2]! << 8) | x[q + 3]!) === TK.PROCEDURE) {
      x[q + 10] = 0
      x[q + 11] = 0
    }
    q += w * 2
  }
  return x
}

/** every line of a verified block back out through the editor and in again */
function retokenise(
  a: Uint8Array,
  src: Uint8Array,
  lines: TokenLine[],
  opts: { extensions: Map<number, TokenTable> },
): Uint8Array | null {
  const opaque = opaqueRanges(src, lines)
  const parts: Uint8Array[] = []
  let p = 0
  while (p + 2 <= a.length) {
    const w = a[p]!
    if (w === 0) break
    const range = opaque.find(([x, y]) => p >= x && p < y)
    if (range) {
      parts.push(a.subarray(range[0], range[1]))
      p = range[1]
      continue
    }
    try {
      parts.push(tokeniseLine(detokLineBytes(a, p, table, opts), table, opts))
    } catch {
      return null
    }
    p += w * 2
  }
  let n = 0
  for (const q of parts) n += q.length
  // a line that came back a different length is roundtrip.test.ts's business
  if (n !== a.length) return null
  const out = new Uint8Array(n)
  let o = 0
  for (const q of parts) {
    out.set(q, o)
    o += q.length
  }
  return out
}

const fixtures = join(process.cwd(), 'fixtures')
const sweep = { programs: 0, verified: 0, codes: [] as number[] }
const fixedPoint = { compared: 0, same: 0, differ: [] as string[] }
if (existsSync(fixtures)) {
  for (const path of walk(fixtures)) {
    let src: Uint8Array
    let lines
    try {
      const file = parseAmosFile(new Uint8Array(readFileSync(path)))
      if (file.source.length === 0) continue
      lines = parseSource(file.source, table)
      src = decipheredSource(file.source, table)
    } catch {
      continue
    }
    sweep.programs++
    const opts = { extensions: extensionTablesFor(lines), ap20: extensionAp20For(lines) }
    let a: Uint8Array
    try {
      a = verify(src, opts)
      sweep.verified++
    } catch (e) {
      sweep.codes.push(e instanceof VerifyError ? e.code : -1)
      continue
    }
    const t = retokenise(a, src, lines, opts)
    if (t === null) continue
    let b: Uint8Array
    try {
      b = verify(t, opts)
    } catch {
      continue
    }
    fixedPoint.compared++
    clearEditorState(a)
    clearEditorState(b)
    let at = -1
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        at = i
        break
      }
    }
    if (at < 0) fixedPoint.same++
    else fixedPoint.differ.push(`${path}@${at}`)
  }
}

describe.skipIf(sweep.programs === 0)('every program in fixtures, walked', () => {
  it('read enough programs that an empty sweep cannot pass for a clean one', () => {
    expect(sweep.programs).toBeGreaterThan(400)
  })

  /**
   * Six do not, and the reasons are countable rather than a gap in the walk.
   * Two name an extension slot no library on this machine answers for, which
   * is error 5, the one AMOS raises as well.
   *
   * Two are `Header_AMOS.AMOS`, the template the compiler fills in. Its
   * `||apcmp||` sits in a procedure whose flags word is $8000, folded and
   * nothing else, and `V1_Procedure` only steps over a machine-code body when
   * bit 12 is set. So AMOS reads it as an instruction too, and class $57 is
   * `bra VerSynt`. A template is not a program.
   *
   * The last two are AMAL_Editor.AMOS, whose `On Error Goto _GREG` jumps into
   * a `Do` from outside it. `Goto_Loops` (:2462) forbids that, and the file
   * carries a link word for the jump anyway. See the note in verify.ts.
   *
   * The eight that used to stop at `Equ(...)` or `Lvo(...)` now walk through:
   * the equate is already poked into the source, so nothing has to be read.
   */
  it('walks all but six to the end', () => {
    expect(sweep.programs - sweep.verified).toBe(6)
    const counted = new Map<number, number>()
    for (const c of sweep.codes) counted.set(c, (counted.get(c) ?? 0) + 1)
    expect([...counted].sort((a, b) => a[0] - b[0])).toEqual([
      [5, 2],
      [9, 2],
      [35, 2],
    ])
  })
})

/**
 * The invariant the whole exercise was for.
 *
 * A program the verifier has been through, listed line by line and typed back
 * in, and verified again, is the SAME BYTES. Not "the same up to the fields
 * the verifier owns", which is what roundtrip.ts has to settle for: the same
 * bytes, because this side now writes those fields too.
 *
 * That is what the editor rests on. Every line the cursor leaves goes back
 * through `Tokenise`, and the program is the token stream, so a round trip
 * that moved a byte would rewrite a program by being read.
 */
describe.skipIf(fixedPoint.compared === 0)('a verified program, listed and retyped', () => {
  it('compares enough programs that an empty sweep cannot pass', () => {
    expect(fixedPoint.compared).toBeGreaterThan(400)
  })

  it('comes back byte for byte', () => {
    expect(fixedPoint.differ).toEqual([])
    expect(fixedPoint.same).toBe(fixedPoint.compared)
  })
})

/**
 * What a caller gets back when the Test pass refuses a line.
 *
 * `Ed_Test` (+Edit.s:8424) takes the position the verifier stopped at, seeks
 * the line containing it and puts the cursor there, so on an Amiga the
 * offending text is already on screen. There is no screen here, and a byte
 * offset into a token stream is not something a caller can act on, so
 * `tokenize` maps it back to the line it was tokenised from.
 */
describe('a refused line names itself', () => {
  const table = new TokenTable(CORE_TOKENS)

  it('carries the source line number and the text', () => {
    let caught: unknown
    try {
      tokenize('A=1\nPrint "ok"\nShift Up 1,1,3\n', table)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(SourceVerifyError)
    const e = caught as SourceVerifyError
    expect(e.line).toBe(3)
    expect(e.text.trim()).toBe('Shift Up 1,1,3')
    expect(e.cause).toBeInstanceOf(VerifyError)
    expect(e.cause.code).toBe(35)
    expect(e.message).toMatch(/Syntax error .*line 3: Shift Up 1,1,3/)
  })

  it('counts blank lines, which tokenise to nothing', () => {
    let line = -1
    try {
      tokenize('\n\n\nSet Accessory 1', table)
    } catch (e) {
      line = (e as SourceVerifyError).line
    }
    expect(line).toBe(4)
  })

  it('a line the format cannot hold is loud rather than dropped', () => {
    // `Tokenise` answers -1 at 510 bytes and the editor leaves the line on
    // screen; silence is right there and wrong for a caller with no screen
    const long = `A$="${'x'.repeat(600)}"`
    expect(() => tokenize(long, table)).toThrow(LineTooLongError)
    expect(() => tokenize(long, table)).toThrow(/line 1 is 510 bytes or more/)
  })
})
