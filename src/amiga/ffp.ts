/**
 * Motorola Fast Floating Point --- the 32-bit format `mathffp.library`
 * provides and the one AMOS keeps every single-precision value in.
 *
 * Not IEEE. One long: a 24-bit mantissa in bits 31-8, the sign in bit 7, and
 * an excess-64 exponent in bits 6-0. The mantissa is always normalised so that
 * reading it as a binary fraction gives a number in [0.5, 1), which means
 * there is no implicit leading bit and no denormals --- and no infinities, no
 * NaN, and no negative zero. Zero is the all-zero long and nothing else.
 *
 * So the value is `mantissa / 2^24 * 2^(exponent - 64)`, and 1.0 is
 * $80000041: half, times two.
 *
 * ## Why this is one module
 *
 * It was two halves that did not add up. `decodeFFP` lived in
 * ../tokens/stream.ts because that is where a float literal is read, and
 * `ffpRound` lived in ../interp/values.ts and used `Math.fround`, which is
 * IEEE single: a different exponent range, an implicit leading bit, and
 * denormals FFP does not have. Neither could encode, so a program's own
 * constants could be read and never written back.
 *
 * Here because more than one caller needs it and none of them owns it: the
 * interpreter's arithmetic, the token stream, and the editor's tokeniser,
 * which has to turn `0.1` back into the same four bytes the file held.
 */

/** the largest magnitude the format holds: exponent field 127, so just under 2^63 */
export const FFP_MAX = 2 ** 63
/** the smallest normalised magnitude: exponent field 0, so 0.5 * 2^-64 */
export const FFP_MIN = 2 ** -65

/** FFP bits to a JavaScript number. Exact: every FFP value is a double. */
export function decodeFfp(raw: number): number {
  const bits = raw >>> 0
  if (bits === 0) return 0
  const mantissa = bits >>> 8
  const sign = bits & 0x80 ? -1 : 1
  const exp = (bits & 0x7f) - 64
  return (sign * mantissa * 2 ** exp) / 2 ** 24
}

/**
 * A number to FFP bits, rounding the mantissa to nearest.
 *
 * Returns null rather than throwing when the value will not fit, because the
 * two callers want different things: the interpreter raises Overflow, and the
 * tokeniser has a syntax error to report instead. Underflow is not an error on
 * the machine either --- there are no denormals to fall back on, so anything
 * under `FFP_MIN` is simply zero.
 *
 * This is CORRECTLY ROUNDED, which is what an arithmetic result wants and is
 * NOT what AMOS does to a literal you type. `AscToFloat` (+Lib.s:25912, into
 * `a2ffp`:26774) reads the digits as an integer and multiplies by a power of
 * ten it builds by repeated FFP multiplication from $A0000044 --- so every
 * step rounds, and the answer carries the error. That is why "0.9" is stored
 * as $E6666740 and not the $E6666640 this function gives: 15099495 against the
 * correctly rounded 15099494. Seven of the 53 distinct float literals in the
 * corpus differ that way. Reproducing them needs FFP multiply and divide, not
 * a better rounding rule here.
 */
export function encodeFfp(v: number): number | null {
  if (!Number.isFinite(v)) return null
  if (v === 0) return 0
  const neg = v < 0
  const a = Math.abs(v)
  if (a >= FFP_MAX) return null
  if (a < FFP_MIN / 2) return 0
  // the exponent that puts the mantissa in [0.5, 1)
  let e = Math.floor(Math.log2(a)) + 1
  // log2 is not exact at a power of two, so settle it by comparison
  while (a / 2 ** e >= 1) e++
  while (a / 2 ** e < 0.5) e--
  let mantissa = Math.round((a / 2 ** e) * 2 ** 24)
  // rounding up out of the range renormalises, exactly as a carry out of the
  // top bit does on the machine
  if (mantissa >= 2 ** 24) {
    mantissa = 2 ** 23
    e++
  }
  const field = e + 64
  if (field > 127) return null
  if (field < 0) return 0
  return (((mantissa * 256) >>> 0) | (neg ? 0x80 : 0) | field) >>> 0
}

/**
 * Round a double to the nearest value the format can hold.
 *
 * What `Math.fround` was standing in for, and it was the wrong shape: IEEE
 * single has an implicit leading bit and denormals, so it keeps values FFP
 * cannot and rounds others to a different place. Returns null on overflow.
 */
export function ffpRound(v: number): number | null {
  const bits = encodeFfp(v)
  return bits === null ? null : decodeFfp(bits)
}
