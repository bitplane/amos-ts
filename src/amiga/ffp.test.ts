/**
 * Motorola FFP, checked against values that came off real programs.
 *
 * The strong test is the last one: every distinct float literal in the 567
 * corpus programs, decoded and encoded again. Those bit patterns were written
 * by AMOS itself in 1992, so agreeing with all of them is agreeing with the
 * format rather than with this file's own arithmetic.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseAmosFile } from '../loader/amosfile'
import { TokenTable, parseSource } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import {
  decodeFfp,
  encodeFfp,
  ffpAdd,
  ffpCmp,
  ffpDiv,
  ffpFix,
  ffpFlt,
  ffpMul,
  ffpNeg,
  ffpRound,
  ffpSub,
  FFP_MAX,
  FFP_MIN,
} from './ffp'

describe('decode', () => {
  it('reads the format: half in the mantissa, excess-64 in the exponent', () => {
    expect(decodeFfp(0)).toBe(0)
    // 1.0 is a half times two, which is why the exponent field is 65
    expect(decodeFfp(0x80000041)).toBe(1)
    expect(decodeFfp(0x800000c1)).toBe(-1)
    expect(decodeFfp(0x80000040)).toBe(0.5)
    expect(decodeFfp(0xc0000041)).toBe(1.5)
    expect(decodeFfp(0xa0000044)).toBe(10)
  })
})

describe('encode', () => {
  it('is the inverse on the values the format actually holds', () => {
    for (const bits of [0x80000041, 0x800000c1, 0x80000040, 0xc0000041, 0xa0000044, 0xc3500051]) {
      expect(encodeFfp(decodeFfp(bits))).toBe(bits)
    }
  })

  it('renormalises when rounding carries out of the top bit', () => {
    // just under 1.0 by half a mantissa step rounds up to 1.0, and the
    // mantissa has to come back to $800000 with the exponent one higher
    expect(encodeFfp(1 - 2 ** -25)).toBe(0x80000041)
  })

  it('has no denormals and no infinities, so it answers 0 and null instead', () => {
    expect(encodeFfp(0)).toBe(0)
    expect(encodeFfp(FFP_MIN / 4)).toBe(0)
    expect(encodeFfp(FFP_MAX)).toBeNull()
    expect(encodeFfp(-FFP_MAX)).toBeNull()
    expect(encodeFfp(Infinity)).toBeNull()
    expect(encodeFfp(NaN)).toBeNull()
  })

  it('keeps the sign in bit 7, not in the top bit', () => {
    expect(encodeFfp(-1)! & 0x80).toBe(0x80)
    expect(encodeFfp(1)! & 0x80).toBe(0)
  })
})

describe('ffpRound', () => {
  it('rounds to the format, which is not what Math.fround does', () => {
    // IEEE single keeps an implicit leading bit and denormals; FFP has
    // neither, so a value under FFP_MIN is zero here and is not there
    expect(ffpRound(FFP_MIN / 4)).toBe(0)
    expect(Math.fround(FFP_MIN / 4)).not.toBe(0)
    expect(ffpRound(1.5)).toBe(1.5)
    expect(ffpRound(FFP_MAX)).toBeNull()
  })
})

/* ---- the corpus ---------------------------------------------------------- */

const fixtures = join(process.cwd(), 'fixtures')

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

/** every distinct float literal in the corpus, as the raw four bytes */
function corpusFloats(): number[] {
  if (!existsSync(fixtures)) return []
  const table = new TokenTable(CORE_TOKENS)
  const seen = new Set<number>()
  for (const p of walk(fixtures)) {
    try {
      const f = parseAmosFile(new Uint8Array(readFileSync(p)))
      if (f.source.length === 0) continue
      for (const line of parseSource(f.source, table)) {
        for (const tok of line.tokens) if (tok.kind === 'float') seen.add(tok.raw)
      }
    } catch {
      // a program this suite cannot parse is corpus.test.ts's business
    }
  }
  return [...seen]
}

const floats = corpusFloats()

describe.skipIf(floats.length === 0)('every float literal in the corpus', () => {
  it('found some, so an empty sweep cannot pass for a clean one', () => {
    expect(floats.length).toBeGreaterThan(40)
  })

  it('decodes and encodes back to the identical four bytes', () => {
    const wrong: string[] = []
    for (const raw of floats) {
      const back = encodeFfp(decodeFfp(raw))
      if (back !== (raw >>> 0)) {
        wrong.push(`$${raw.toString(16)} -> ${back === null ? 'null' : '$' + back.toString(16)}`)
      }
    }
    expect(wrong).toEqual([])
  })
})

/* ---- the arithmetic ------------------------------------------------------ */

const h = (n: number): string => '$' + (n >>> 0).toString(16).padStart(8, '0')

describe('flt and fix', () => {
  it('carries a long in and out again while it fits in 24 bits', () => {
    for (const v of [0, 1, 9, 10, 255, 1000, 0x7fffff, -1, -12345]) {
      expect(decodeFfp(ffpFlt(v))).toBe(v)
      expect(ffpFix(ffpFlt(v))).toBe(v)
    }
  })

  it('truncates past 24 bits, because $282A0 is a shift and not a round', () => {
    // 2^24 + 1 has no room for its bottom bit
    expect(ffpFix(ffpFlt(0x1000001))).toBe(0x1000000)
    expect(ffpFlt(0x1000001)).toBe(ffpFlt(0x1000000))
  })

  it('fix truncates toward zero and gives 0 under 1', () => {
    expect(ffpFix(encodeFfp(1.9)!)).toBe(1)
    expect(ffpFix(encodeFfp(-1.9)!)).toBe(-1)
    expect(ffpFix(encodeFfp(0.99)!)).toBe(0)
    expect(ffpFix(0)).toBe(0)
  })

  it('saturates rather than wrapping past a long', () => {
    expect(ffpFix(encodeFfp(2 ** 40)!)).toBe(0x7fffffff)
    expect(ffpFix(encodeFfp(-(2 ** 40))!)).toBe(-0x80000000)
  })
})

describe('compare', () => {
  it('orders by the sign/exponent byte first, read as signed', () => {
    expect(ffpCmp(ffpFlt(1), ffpFlt(2))).toBe(-1)
    expect(ffpCmp(ffpFlt(2), ffpFlt(1))).toBe(1)
    expect(ffpCmp(ffpFlt(2), ffpFlt(2))).toBe(0)
    // any negative sorts below any positive because bit 7 is the byte's sign
    expect(ffpCmp(encodeFfp(-1e9)!, encodeFfp(1e-9)!)).toBe(-1)
  })

  it('compares two negatives the other way round, which $283EA does by swapping', () => {
    expect(ffpCmp(encodeFfp(-2)!, encodeFfp(-1)!)).toBe(-1)
    expect(ffpCmp(encodeFfp(-0.75)!, encodeFfp(-0.5)!)).toBe(-1)
  })
})

describe('add, subtract, multiply, divide', () => {
  it('is exact where the answer fits in 24 bits', () => {
    const n = (v: number): number => decodeFfp(ffpFlt(v))
    expect(n(2) + n(3)).toBe(5)
    expect(decodeFfp(ffpAdd(ffpFlt(2), ffpFlt(3)))).toBe(5)
    expect(decodeFfp(ffpSub(ffpFlt(3), ffpFlt(2)))).toBe(1)
    expect(decodeFfp(ffpMul(ffpFlt(6), ffpFlt(7)))).toBe(42)
    expect(decodeFfp(ffpDiv(ffpFlt(42), ffpFlt(7)))).toBe(6)
    expect(decodeFfp(ffpDiv(ffpFlt(1), ffpFlt(4)))).toBe(0.25)
  })

  it('adds a half-ulp guard byte at $28440 whether or not it rounds anything', () => {
    // 0.5 - 1/3: aligning shifts the third's mantissa down one, and the $80
    // written over the larger operand's byte survives the subtraction. Two
    // places of renormalisation then carry it up to $AAAAAC where the exact
    // answer is $AAAAAA.
    const third = encodeFfp(1 / 3)!
    expect(h(third)).toBe('$aaaaab3f')
    expect(h(ffpSub(encodeFfp(0.5)!, third))).toBe('$aaaaac3e')
    expect(h(encodeFfp(0.5 - decodeFfp(third))!)).toBe('$aaaaaa3e')
  })

  it('rounds a multiply half up on a truncated product', () => {
    // the truncated product of 10^6 and 10^-6 is $7FFFFFFA, six short of the
    // top bit. Adding $40 carries into bit 31, so `ADD.L D7,D7` at $285F2
    // carries out and $285F0 rotates it straight back and puts the exponent
    // where it started, which is the difference between 1 and $FFFFFF40.
    expect(h(ffpMul(encodeFfp(1e6)!, encodeFfp(1e-6)!))).toBe('$80000041')
  })

  it('drops the sign, not the value, when zero is an operand', () => {
    expect(ffpAdd(0, ffpFlt(5))).toBe(ffpFlt(5))
    expect(ffpAdd(ffpFlt(5), 0)).toBe(ffpFlt(5))
    expect(ffpMul(ffpFlt(5), 0)).toBe(0)
    expect(ffpMul(0, ffpFlt(5))).toBe(0)
    expect(ffpDiv(0, ffpFlt(5))).toBe(0)
  })

  it('cancels to the format zero, which is the all-zero long', () => {
    expect(ffpSub(ffpFlt(7), ffpFlt(7))).toBe(0)
    expect(ffpAdd(ffpFlt(7), ffpNeg(ffpFlt(7)))).toBe(0)
    expect(ffpNeg(0)).toBe(0)
  })

  it('saturates instead of overflowing, at $28454 and $285FE', () => {
    const big = encodeFfp(2 ** 62)! // exponent field 127, the top of the range
    expect(h(ffpMul(big, ffpFlt(4)))).toBe('$ffffff7f')
    expect(h(ffpMul(big, ffpNeg(ffpFlt(4))))).toBe('$ffffffff')
    // and underflows to zero rather than to a denormal it has no room for
    expect(ffpMul(encodeFfp(2 ** -60)!, encodeFfp(2 ** -60)!)).toBe(0)
  })

  it('stays within two mantissa steps of the exact answer over a sweep', () => {
    const vals = [1, 2, 10, 0.5, 0.1, 3.14159, 1e6, 1e-6, 123456, 0.9, 7, 65535.5]
    let worst = 0
    for (const a of vals)
      for (const b of vals)
        for (const sa of [1, -1])
          for (const sb of [1, -1]) {
            const A = encodeFfp(a * sa)!
            const B = encodeFfp(b * sb)!
            const x = decodeFfp(A)
            const y = decodeFfp(B)
            for (const [f, exact] of [
              [ffpAdd, x + y],
              [ffpSub, x - y],
              [ffpMul, x * y],
              [ffpDiv, x / y],
            ] as const) {
              if (exact === 0) continue
              const got = decodeFfp(f(A, B))
              worst = Math.max(worst, Math.abs(got - exact) / Math.abs(exact))
            }
          }
    // 2^-23 is one step; the guard byte can cost a second one on a cancellation
    expect(worst).toBeLessThan(2 ** -22)
  })
})
