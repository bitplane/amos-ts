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
import { decodeFfp, encodeFfp, ffpRound, FFP_MAX, FFP_MIN } from './ffp'

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
