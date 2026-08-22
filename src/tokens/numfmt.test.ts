/**
 * AMOS's number routines, both directions, against the arithmetic in +Lib.s.
 *
 * The digit counts are the whole point, so each case names the branch it
 * exercises rather than just asserting a string.
 *
 * The strong test is the last one. Every distinct float literal in the corpus
 * is detokenised and typed back in, and has to come back as the same four
 * bytes AMOS itself wrote in 1992. That fixed point is what lets the editor
 * retokenise a line nobody edited.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { decodeFfp, encodeFfp } from '../amiga/ffp'
import { parseAmosFile } from '../loader/amosfile'
import { TokenTable, parseSource } from './stream'
import { CORE_TOKENS } from './tables.gen'
import { ascToFfp, ascToFloat, floatToAsc, longToBin, longToDec, longToHex } from './numfmt'

describe('the integer routines', () => {
  it('LongToDec is proportional and signed', () => {
    expect(longToDec(0)).toBe('0')
    expect(longToDec(1)).toBe('1')
    expect(longToDec(-42)).toBe('-42')
    // `neg.l` leaves $80000000 where it is and the subtraction loop is
    // unsigned, so the most negative long prints in full
    expect(longToDec(-2147483648)).toBe('-2147483648')
  })

  it('LongToHex and LongToBin lead with their sigil and drop leading zeros', () => {
    expect(longToHex(0)).toBe('$0')
    expect(longToHex(255)).toBe('$FF')
    expect(longToHex(0xdeadbeef | 0)).toBe('$DEADBEEF')
    expect(longToBin(0)).toBe('%0')
    expect(longToBin(5)).toBe('%101')
  })
})

describe('FloatToAsc, the proportional arm Detok uses', () => {
  const f = (bits: number): string => floatToAsc(decodeFfp(bits))

  it('leaves `7 - a0` decimals, where a0 counts the point', () => {
    // one integer digit: a0 = 2, so five decimals and six significant figures
    expect(f(0xc90fdb42)).toBe('3.14159') // Pi
    expect(f(0xadf85442)).toBe('2.71828') // E
    // two integer digits: a0 = 3, four decimals
    expect(f(0xaa8f5c43)).toBe('5.33')
    expect(f(0xa3d70a47)).toBe('81.92')
    // three: a0 = 4, three decimals
    expect(f(0xb3599948)).toBe('179.35')
  })

  it('Clean cuts at the last non-zero decimal, taking the point with it', () => {
    // 128.000 comes back as "128" with no point at all; Detok is what puts
    // the ".0" back, so Print shows an integral float as an integer
    expect(f(0x80000048)).toBe('128')
    expect(f(0x80000041)).toBe('1')
    expect(f(0)).toBe('0')
    expect(f(0xc0000041)).toBe('1.5')
  })

  it('the probe width comes off the exponent byte alone', () => {
    // under 1.0 the count is the leading-zero run plus six
    expect(f(0xcccccd3d)).toBe('0.1') // one zero run of 0, so 7 decimals
    expect(f(0xa3d70a3a)).toBe('0.01')
    expect(f(0x83126e39)).toBe('0.004')
  })

  it('goes exponential at seven integer digits, and drops the point when bare', () => {
    // `cmp.w #8,a0 / bcc ExFix1`, and Exf5 writes the E over the point
    expect(floatToAsc(2 ** 30)).toBe('1.07374E+09')
    expect(floatToAsc(1e7)).toBe('1E+07')
    expect(floatToAsc(-1e7)).toBe('-1E+07')
  })

  it('goes exponential under 0.0001, where the zero run reaches four', () => {
    expect(floatToAsc(0.000123)).toBe('1.23E-04')
    expect(floatToAsc(0.0000456)).toBe('4.56E-05')
    // and 0.00456 has only two leading zeros, so it stays fixed
    expect(floatToAsc(0.00456)).toBe('0.00456')
  })

  it('NOTE a value just under a power of ten reports the exponent below it', () => {
    // ExVir1 counts the leading zeros ONCE, off the probe string, and then
    // formats again with six more decimals. 1e-5 is $8637BD37, which is
    // 9.9999997e-6, so the probe has five zeros and the exponent is settled at
    // -06 --- and the second format rounds that 9.999999 up to 1.000000,
    // leaving "1E-06" for a number that is 1E-05. Nothing re-derives the
    // exponent from the digits it ended up with.
    //
    // Derived from the source, not observed: no float in the corpus reaches
    // either exponential arm, so this arm is ported and unverified.
    expect(floatToAsc(0.00001)).toBe('1E-06')
  })

  it('keeps the sign and never writes a bare point', () => {
    expect(f(0x800000c1)).toBe('-1')
    expect(floatToAsc(-1.5)).toBe('-1.5')
  })
})

describe('AscToFloat', () => {
  const h = (n: number): string => '$' + (n >>> 0).toString(16).padStart(8, '0')

  it('reads the digits as one integer and scales once', () => {
    expect(h(ascToFfp('1'))).toBe('$80000041')
    expect(h(ascToFfp('1.5'))).toBe('$c0000041')
    expect(h(ascToFfp('0.5'))).toBe('$80000040')
    expect(h(ascToFfp('10'))).toBe('$a0000044')
    expect(h(ascToFfp('100'))).toBe('$c8000047')
    expect(h(ascToFfp('65536'))).toBe('$80000051')
  })

  it('is not a correctly rounded conversion, and 0.9 is where that shows', () => {
    // 9 * 10^-1, and 10^-1 is one FFP divide of one by ten. The error in that
    // divide is in the answer: mantissa 15099495 where the correctly rounded
    // value is 15099494. Programs in the corpus hold $E6666740 six times.
    expect(h(ascToFfp('0.9'))).toBe('$e6666740')
    expect(h(encodeFfp(0.9)!)).toBe('$e6666640')
  })

  it('is low even on a value binary can hold exactly', () => {
    // 73.875 is 591/8. AscToFloat gets there as 73875 * 10^-3, and 10^-3 is
    // three divides deep, so the answer lands one step below a value the
    // format could have held on the nose. The corpus stores $93BFFF47.
    expect(h(ascToFfp('73.875'))).toBe('$93bfff47')
    expect(h(encodeFfp(73.875)!)).toBe('$93c00047')
  })

  it('takes the sign off the front and puts it back on the end', () => {
    expect(ascToFfp('-0.9')).toBe((ascToFfp('0.9') | 0x80) >>> 0)
    expect(h(ascToFfp('  -1'))).toBe('$800000c1')
    expect(h(ascToFfp('+1'))).toBe('$80000041')
  })

  it('counts the point rather than placing it, so E and decimals combine', () => {
    // 1.5E-3 is 15 * 10^(-3-1), one power of ten and one multiply
    expect(ascToFfp('1.5E-3')).toBe(ascToFfp('15E-4'))
    expect(ascToFfp('1E10')).toBe(ascToFfp('10000000000'))
    expect(ascToFloat('1E10')).toBe(1e10)
  })

  it('gives zero for a string with no digits in it', () => {
    expect(ascToFfp('')).toBe(0)
    expect(ascToFfp('.')).toBe(0)
    expect(ascToFfp('0')).toBe(0)
  })

  it('makes a negative zero the format has no room for', () => {
    // $28026 ORs the sign in without looking at what it is signing, so a
    // leading minus over no digits leaves $00000080: mantissa zero, which is
    // the one value FFP says is zero, with bit 7 set. Nothing in the corpus
    // holds it, and it would not survive a round trip if it did, because
    // FloatToAsc writes "0" and this reads that back as $00000000.
    expect(h(ascToFfp('-'))).toBe('$00000080')
    expect(h(ascToFfp('-0'))).toBe('$00000080')
    expect(floatToAsc(decodeFfp(0x80))).toBe('0')
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
        for (const tok of line.tokens) if (tok.kind === 'float') seen.add(tok.raw >>> 0)
      }
    } catch {
      // a program this suite cannot parse is corpus.test.ts's business
    }
  }
  return [...seen].sort((a, b) => a - b)
}

const floats = corpusFloats()

describe.skipIf(floats.length === 0)('the editor fixed point, over every corpus literal', () => {
  it('found some, so an empty sweep cannot pass for a clean one', () => {
    expect(floats.length).toBeGreaterThan(40)
  })

  it('detokenises and retokenises to the identical four bytes', () => {
    const wrong: string[] = []
    for (const raw of floats) {
      const text = floatToAsc(decodeFfp(raw))
      const back = ascToFfp(text)
      if (back !== raw) {
        wrong.push(`${text}: $${raw.toString(16)} -> $${back.toString(16)}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('and correct rounding does not, which is why the arithmetic is ported', () => {
    const differ = floats.filter((raw) => encodeFfp(parseFloat(floatToAsc(decodeFfp(raw)))) !== raw)
    expect(differ.map((raw) => floatToAsc(decodeFfp(raw)))).toEqual([
      '0.004',
      '2.1',
      '1.07',
      '73.875',
      '0.043',
      '179.35',
      '0.9',
    ])
  })
})
