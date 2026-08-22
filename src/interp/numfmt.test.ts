/**
 * AMOS's number-to-text routines, against the arithmetic in +Lib.s.
 *
 * The digit counts are the whole point, so each case names the branch it
 * exercises rather than just asserting a string.
 */
import { describe, expect, it } from 'vitest'
import { decodeFfp } from '../amiga/ffp'
import { floatToAsc, longToBin, longToDec, longToHex } from './numfmt'

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
