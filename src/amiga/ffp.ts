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
 * NOT what AMOS does to a literal you type. Seven of the 53 distinct float
 * literals in the corpus come out one mantissa step from what the file holds,
 * "0.9" among them: $E6666740 stored against the $E6666640 this gives, 15099495
 * against 15099494. Use `ascToFfp` (../interp/numfmt.ts) for a literal.
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

// ---------------------------------------------------------------------------
// The arithmetic
//
// AMOS links a copy of the Motorola single-precision routines rather than
// opening mathffp.library, and +Lib.s carries them at $284xx-$285xx with a
// compiled-C wrapper apiece: L28212 add, L28232 compare, L28250 divide,
// L28270 int to float, L28300 float to int, L28388 multiply, L283A8 negate,
// L283C4 subtract. The wrappers take their two arguments on the stack and hand
// them to the assembler in d7 and d6, so `ffpMul(a, b)` here is `d7 * d6`
// there and the argument order is the one the callers use.
//
// These are ported for `ascToFfp` (../interp/numfmt.ts), which is the editor's
// route from a typed literal to the four bytes a program stores. Correct
// rounding does not reproduce those bytes: the conversion multiplies by a
// power of ten it builds ten at a time, and the answer carries every step's
// error. Nothing else can reproduce it either, so the arithmetic itself has to
// be here.
//
// DEVIATION: the interpreter still evaluates float expressions in double
// precision and rounds the result once (../interp/values.ts). AMOS rounds at
// every operation, through exactly these routines. Moving the interpreter onto
// them is a separate change with its own test churn.
// ---------------------------------------------------------------------------

/** the sign/exponent byte read the way `TST.B` and `CMP.B` read it, as signed */
function signedByte(bits: number): number {
  const b = bits & 0xff
  return b >= 0x80 ? b - 256 : b
}

/**
 * Negate. `L28406`: zero has no sign to flip, and flipping it would make a
 * long that is not the format's only zero, so the byte is tested first.
 */
export function ffpNeg(a: number): number {
  const x = a >>> 0
  return (x & 0xff) === 0 ? x : (x ^ 0x80) >>> 0
}

/**
 * Compare, returning -1, 0 or 1 the way the C wrappers read the flags.
 *
 * `L283E4` compares the sign/exponent bytes as SIGNED bytes and only falls
 * through to the full long when they are equal, which orders any negative
 * below any positive for free. Two negatives are compared the other way round,
 * so a bigger mantissa reads as smaller.
 */
export function ffpCmp(a: number, b: number): number {
  const x = a >>> 0
  const y = b >>> 0
  const xb = signedByte(x)
  const yb = signedByte(y)
  if (xb < 0 && yb < 0) {
    if (xb !== yb) return yb < xb ? -1 : 1
    return x === y ? 0 : y < x ? -1 : 1
  }
  if (xb !== yb) return xb < yb ? -1 : 1
  return x === y ? 0 : x < y ? -1 : 1
}

/**
 * A signed long to FFP. `L28270`, and it truncates: the mantissa holds 24 bits
 * and anything past 2^24 is shifted out by the `ASR.L #1` at $282A0.
 *
 * DEVIATION: `Flt(-2147483648)` returns 0 here and hangs on the machine.
 * `NEG.L` leaves $80000000 unchanged, bits 24-30 are then clear so the
 * right-shift loop does not run, and the left-shift loop at $282B6 shifts the
 * one bit out and spins on zero. Hanging is not worth reproducing.
 */
export function ffpFlt(value: number): number {
  const signed = value | 0
  const neg = signed < 0
  let m = (neg ? -signed : signed) >>> 0
  if (m === 0) return 0
  let e = 24
  while ((m & 0x7f000000) !== 0) {
    m = m >>> 1
    e++
  }
  while ((m & 0x00800000) === 0) {
    m = (m << 1) >>> 0
    if (m === 0) return 0
    e--
  }
  return (((m << 8) >>> 0) | ((e + 64) & 0x7f) | (neg ? 0x80 : 0)) >>> 0
}

/**
 * FFP to a signed long, truncating toward zero. `L28300`. Anything under 1
 * gives 0, and past 2^31 it saturates rather than wrapping.
 */
export function ffpFix(a: number): number {
  const x = a >>> 0
  let e = (x & 0x7f) - 64
  if (x === 0 || e < 0) return 0
  const neg = (x & 0x80) !== 0
  if (e > 31) return neg ? -0x80000000 : 0x7fffffff
  let m = x >>> 8
  e -= 24
  while (e < 0) {
    m = m >>> 1
    e++
  }
  while (e > 0) {
    m = (m << 1) >>> 0
    e--
  }
  return neg ? -m | 0 : m | 0
}

/** the largest magnitude the add and multiply saturate to: $FFFFFF7F or its negative */
function saturate(sign: number): number {
  return (0xffffff7f | (sign & 0x80)) >>> 0
}

/**
 * Shift a 32-bit accumulator left until bit 31 is set, dropping the exponent
 * by one each time. `L284AA`, which uses the exponent byte as the `DBMI`
 * counter as well, so running out of exponent and running out of loop are the
 * same event.
 *
 * The `SWAP` at $284B6 is the 16-place shortcut, taken when the top 17 bits
 * are clear. It runs at most once because the smallest non-zero difference two
 * 24-bit mantissas can leave is $100 after the guard byte is cleared.
 */
function normalise(acc: number, byte: number): number {
  let v = (acc & 0xffffff00) >>> 0
  let b = byte
  if (v === 0) return 0
  b = (b - 1) & 0xff
  if (v <= 0x7fff) {
    v = ((v << 16) | (v >>> 16)) >>> 0
    b = (b - 0x10) & 0xff
  }
  for (;;) {
    v = (v << 1) >>> 0
    if ((v & 0x80000000) !== 0) break
    b = (b - 1) & 0xff
  }
  // the borrow reaching bit 7 is the underflow test at $284C2
  if (((b ^ byte) & 0x80) !== 0) return 0
  return b === 0 ? 0 : ((v & 0xffffff00) | b) >>> 0
}

/**
 * Add. `L28422`, entered with the addend in d6.
 *
 * The smaller operand's mantissa is shifted right by the exponent difference
 * and 24 or more places gives the larger back untouched. The larger's own
 * sign/exponent byte is overwritten with $80 first, at $28440, so a half is
 * always added in and the sum rounds to nearest without a second pass.
 */
export function ffpAdd(a: number, b: number): number {
  const x = a >>> 0
  const y = b >>> 0
  const xb = x & 0xff
  const yb = y & 0xff
  if (yb === 0) return x
  if (xb === 0) return y
  const sameSign = (xb & 0x80) === (yb & 0x80)
  const diff = signedByte(((xb & 0x7f) - (yb & 0x7f)) & 0xff)

  if (sameSign) {
    if (diff >= 0) {
      if (diff >= 24) return x
      const shifted = (y & 0xffffff00) >>> diff
      const sum = ((x & 0xffffff00) >>> 0) + 0x80 + shifted
      return carryOut(sum, xb)
    }
    if (diff <= -24) return y
    const shifted = (x & 0xffffff00) >>> -diff
    const sum = ((y & 0xffffff00) >>> 0) + 0x80 + shifted
    return carryOut(sum, yb)
  }

  if (diff === 0) {
    const d = ((x & 0xffffff00) >>> 0) - ((y & 0xffffff00) >>> 0)
    if (d === 0) return 0
    if (d > 0) return normalise(d, xb)
    return normalise(-d, yb)
  }
  if (diff > 0) {
    if (diff >= 24) return x
    const acc = (((x & 0xffffff00) | 0x80) >>> 0) - ((y & 0xffffff00) >>> diff)
    if ((acc & 0x80000000) !== 0) return ((acc & 0xffffff00) | xb) >>> 0
    return normalise(acc, xb)
  }
  if (diff <= -24) return y
  const acc = (((y & 0xffffff00) | 0x80) >>> 0) - ((x & 0xffffff00) >>> -diff)
  if ((acc & 0x80000000) !== 0) return ((acc & 0xffffff00) | yb) >>> 0
  return normalise(acc, yb)
}

/**
 * The carry out of the add at $28446. `ROXR.L` puts the lost bit back at the
 * top and the exponent goes up one; if that byte overflows, $28454 returns the
 * largest magnitude the format holds rather than wrapping.
 */
function carryOut(sum: number, byte: number): number {
  if (sum <= 0xffffffff) return ((sum & 0xffffff00) | byte) >>> 0
  const shifted = (((sum >>> 0) >>> 1) | 0x80000000) >>> 0
  const raised = (byte & 0x7f) + 1
  if (raised > 0x7f) return saturate(byte)
  return ((shifted & 0xffffff00) | (byte & 0x80) | raised) >>> 0
}

/** Subtract. `L28410` negates its addend and joins the add at the same dispatch. */
export function ffpSub(a: number, b: number): number {
  return ffpAdd(a, ffpNeg(b))
}

/**
 * Multiply. `L2858A`.
 *
 * The exponents are added as DOUBLED signed bytes so that `BVS` catches a sum
 * outside -64..63 one bit early, leaving room for the normalisation step to
 * put one back. The mantissas go through three `MULU`s and one `ADDX.B` to
 * keep the carry, which works out to `floor(Am * Bm / 2^16)` exactly. The
 * product of two normalised mantissas lands in [0.25, 1), so one place of
 * renormalisation is all it can ever need.
 *
 * Rounding is the `ADD.L #$80` at $285D6, or `#$40` before the shift at
 * $285EE. Round half up, on a truncated product, once.
 */
export function ffpMul(a: number, b: number): number {
  const x = a >>> 0
  const y = b >>> 0
  if ((x & 0xff) === 0) return x
  if ((y & 0xff) === 0) return 0
  const sign = (x ^ y) & 0x80
  const exp = (x & 0x7f) - 64 + ((y & 0x7f) - 64)
  if (exp > 63) return saturate(sign)
  if (exp < -64) return 0

  const am = x >>> 8
  const bm = y >>> 8
  const product = Math.floor((am * bm) / 0x10000)

  if ((product & 0x80000000) !== 0) {
    const rounded = (product + 0x80) % 0x100000000
    const byte = sign | ((exp + 64) & 0x7f)
    return byte === 0 ? 0 : ((rounded & 0xffffff00) | byte) >>> 0
  }
  // bit 31 clear, so the exponent comes down one and the mantissa goes up one
  const lowered = exp - 1
  if (lowered < -64) return 0
  const bumped = product + 0x40
  if (bumped >= 0x80000000) {
    // the round carried into bit 31, so `ADD.L D7,D7` carries out and $285F0
    // rotates it straight back with the X bit and puts the exponent back
    const byte = sign | ((exp + 64) & 0x7f)
    return byte === 0 ? 0 : ((bumped & 0xffffff00) | byte) >>> 0
  }
  const shifted = (bumped * 2) % 0x100000000
  const byte = sign | ((lowered + 64) & 0x7f)
  return byte === 0 ? 0 : ((shifted & 0xffffff00) | byte) >>> 0
}

/**
 * Divide. `L28518`.
 *
 * Two `DIVU`s, sixteen bits of quotient each. The dividend is halved first
 * when its top word is not below the divisor's, at $2853C, because that is
 * exactly the condition under which the first `DIVU` would overflow. The
 * remainder correction at $28560 runs at most once, which is the usual
 * shortcut and is safe here only because the divisor is normalised.
 *
 * NOTE the second `DIVU` at $2856C can still overflow, when the remainder
 * lands in [BH*2^16, BH*2^16 + BL). The 68000 leaves the operands untouched
 * and sets V, which the routine does not test, so the low sixteen bits of the
 * quotient come out as zero. Reproduced, because a divide is a divide and
 * every caller sees it.
 */
export function ffpDiv(a: number, b: number): number {
  const x = a >>> 0
  const y = b >>> 0
  const sign = (x ^ y) & 0x80
  if ((y & 0xff) === 0) {
    // the machine takes a zero-divide trap at $284F4 and, if it comes back,
    // saturates. There is nothing to trap into here.
    return saturate(sign)
  }
  if (x === 0) return 0
  let exp = (x & 0x7f) - (y & 0x7f)
  if (exp > 63) return saturate(sign)
  if (exp < -64) return 0

  const am = x >>> 8
  const bm = y >>> 8
  const ah = am >>> 8
  const bh = bm >>> 8
  const bl = (bm & 0xff) << 8

  let dividend: number
  if (ah >= bh) {
    exp += 1
    if (exp > 63) return saturate(sign)
    dividend = am * 128
  } else {
    dividend = am * 256
  }

  let q = Math.floor(dividend / bh)
  const r = dividend - q * bh
  let rem = r * 0x10000 - q * bl
  if (rem < 0) {
    rem += bm * 256
    q = (q - 1) & 0xffff
  }
  const high = rem - (rem % 0x10000)
  let q2 = Math.floor(high / bh)
  if (q2 > 0xffff) q2 = high % 0x10000

  let acc = q * 0x10000 + q2
  let byte = sign | ((exp + 64) & 0x7f)
  if ((q & 0x8000) === 0) {
    acc = (acc * 2) % 0x100000000
    // `SUBQ.B #1,D4` at $28574, with no overflow test, so a zero exponent
    // field borrows into the sign bit exactly as it does on the machine
    byte = (byte - 1) & 0xff
  }
  const rounded = (acc + 0x80) % 0x100000000
  return byte === 0 ? 0 : ((rounded & 0xffffff00) | byte) >>> 0
}
