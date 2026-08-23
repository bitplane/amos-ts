/**
 * AMOS's own number-to-text routines, from `+Lib.s`.
 *
 * These are not general formatters and must not be replaced by JavaScript's.
 * The editor detokenises a line and retokenises it every time the cursor
 * leaves, so whatever `FloatToAsc` writes has to come back through
 * `AscToFloat` as the same four bytes --- and where it does not, a program
 * changes under an edit nobody made. That fixed point only holds if both
 * halves are the machine's, which is why an approximation here is not a
 * smaller version of the right answer but a different one.
 *
 * `LongToDec` :25659, `LongToHex` :25718, `LongToBin` :25754, `FloatToAsc`
 * :25923 (into `fldeb`, `F2a` and the `Clean`/`ExFix1`/`ExVir1` tails) and
 * `AscToFloat` :25912 (into `a2ffp` :26774), which is the other half of that
 * fixed point.
 */
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
} from '../amiga/ffp'

/**
 * `LongToDec` ($25659), which is `LongToAsc` with `d3 = -1` and `d4 = 0`:
 * proportional, so no leading zeros, and no leading space for a positive.
 *
 * The digit loop runs the ten powers of ten and always emits on the LAST one,
 * which is how zero prints as "0" rather than as nothing. `neg.l` leaves
 * $80000000 alone and the subtraction loop is unsigned, so -2147483648 prints
 * in full rather than wrapping.
 */
export function longToDec(v: number): string {
  return String(v | 0)
}

/**
 * `LongToHex` ($25718) --- a `$` and up to eight uppercase digits.
 *
 * NOTE the caller decides between fixed and proportional through `d3`, and
 * `Detok` never sets it: `DtkC4` calls straight in with whatever the loop left
 * there, which is the spec character of the last keyword it wrote. `neg.l d3 /
 * add.l #8,d3` turns anything above 8 negative, and a spec character is ASCII,
 * so the answer is proportional every time but not by intent. Only a `d3` of 0
 * to 8 would pad, and the first token of a line reaches this with the caller's
 * own `d3`.
 */
export function longToHex(v: number): string {
  return '$' + (v >>> 0).toString(16).toUpperCase()
}

/** `LongToBin` ($25754) --- a `%` and up to 32 digits, proportional the same way */
export function longToBin(v: number): string {
  return '%' + (v >>> 0).toString(2)
}

/**
 * `ffp2a` ($26226) --- an FFP value to exactly `decimals` decimal places.
 *
 * The routine itself is 550 lines of decompiled C doing decimal fixed-point
 * long division. What it computes is the exact value rounded to `decimals`
 * places, and since every FFP value is exactly representable as a double,
 * `toFixed` computes the same thing from the same exact value. The digit
 * COUNTS, which is where the interesting behaviour lives, are ported line by
 * line below and are not this function's business.
 */
function ffpToFixed(v: number, decimals: number): string {
  return v.toFixed(Math.max(0, Math.min(100, decimals)))
}

/**
 * `Clean` ($26070): copy up to the point, then keep only as far as the last
 * non-zero decimal --- and the cut is AT the point when every decimal is zero,
 * so 128.000 comes back as "128" with no point at all. `Detok` puts the ".0"
 * back afterwards (`DtkC8`), which is why an integer-valued float reads
 * "128.0" and not "128." or "128".
 */
function clean(s: string): string {
  const dot = s.indexOf('.')
  if (dot < 0) return s
  let last = dot
  for (let i = dot + 1; i < s.length; i++) if (s[i] !== '0') last = i + 1
  return s.slice(0, last)
}

/** `Exf6` ($26147): a two-digit exponent built by incrementing a '0' ten at a time */
function expDigits(n: number): string {
  let tens = 0
  let rest = n
  while (rest >= 10) {
    tens++
    rest -= 10
  }
  return String.fromCharCode(0x30 + tens) + String.fromCharCode(0x30 + rest)
}

/**
 * `FloatToAsc` ($25923) as `Detok` calls it: `d4 = -1`, `d5 = 0`, so the
 * proportional arm `PaFix` and never the fixed one.
 *
 * PaFix formats once to find out how big the number is, decides how many
 * decimals that leaves it, then formats again and trims. The probe width comes
 * from the exponent byte alone: 7 decimals at or above 1.0, 10 down to about
 * 2^-16, and 22 below that, "if between -1 and 1, ask for 16 digits".
 *
 * The count that matters is `7 - n` where `n` counts the digits before the
 * point AND the point itself, so a two-digit integer part leaves 4 decimals,
 * not 5. That is six significant digits, not seven, and it is the reason a
 * value like $93BFFF47 (73.874992) prints as "73.875" --- which is a different
 * FFP value. See `numfmt.test.ts`.
 */
export function floatToAsc(v: number): string {
  const bits = encodeFfp(v)
  if (bits === null) return String(v)
  const value = decodeFfp(bits)
  const expField = bits & 0x7f
  const probe = expField >= 0x41 ? 7 : expField >= 0x31 ? 10 : 22
  // PaFix counts on the magnitude: a1 steps over the '-' before it looks
  const body = ffpToFixed(Math.abs(value), probe)

  if (body[0] !== '0') {
    // PaFix2: digits before the point, counting the point
    const dot = body.indexOf('.')
    const n = dot < 0 ? body.length : dot + 1
    if (n >= 8) return expAtLeastOne(value, n)
    return clean(ffpToFixed(value, Math.min(7 - n, 5)))
  }

  // PaFix5: how many zeros follow "0.", plus the character that stopped the walk
  const after = body.slice(2)
  let zeros = 0
  while (zeros < after.length && after[zeros] === '0') zeros++
  const run = zeros + 1
  if (run >= 22) return clean(ffpToFixed(value, 12)) // a real zero
  if (run >= 4) return expUnderOne(value, run)
  return clean(ffpToFixed(value, run + 6))
}

/**
 * `ExFix1` ($26094): one digit, a point, up to five more, then `E+nn`.
 *
 * `Exf5` writes the "E" AT `a2`, and `a2` is the address of the point itself
 * until a non-zero decimal moves it. So a value with nothing after the point
 * loses the point as well and reads "1E+10", not "1.E+10".
 *
 * Whether the point survived also decides the space `fldeb` puts in front of
 * the E, which is why `spaceBeforeE` takes the trimmed decimals rather than
 * the value.
 */
function expAtLeastOne(value: number, n: number): string {
  const exponent = n - 2
  const width = Math.min(n, 7)
  const s = ffpToFixed(value, 9 - width)
  const sign = s[0] === '-' ? '-' : ''
  const digits = (sign ? s.slice(1) : s).replace('.', '')
  const kept = digits.slice(1, 6).replace(/0+$/, '')
  const point = kept === '' ? '' : '.'
  return `${sign}${digits[0]}${point}${kept}${spaceBeforeE(kept)}E+${expDigits(exponent)}`
}

/**
 * The space `fldeb` writes in front of the E, at $25960.
 *
 * `F2a` leaves the whole number in `DeFloat` and `fldeb` copies it out again
 * one character at a time. `p1` copies until it meets a point, and a mantissa
 * that kept no decimals has none, so the loop runs to the terminator and
 * returns from `p7` having never seen `p5`. A mantissa WITH a point falls out
 * of `p1` at `p1a`, and `p5` then tests the character it stopped on and writes
 * a space if it is an "E".
 *
 * So the space tracks the point, not the exponent: "1E+17" has neither and
 * "9.22337 E+18" has both. Kyzer's amostools prints the same two forms in
 * `test/sources/Numbers.Asc`, from a reading of AMOS this port did not share.
 */
function spaceBeforeE(kept: string): string {
  return kept === '' ? '' : ' '
}

/** `ExVir1` ($26162): the same shape under 1.0, with `E-nn` */
function expUnderOne(value: number, run: number): string {
  const s = ffpToFixed(value, run + 6)
  const sign = s[0] === '-' ? '-' : ''
  const digits = (sign ? s.slice(1) : s).replace('.', '')
  let first = 0
  while (first < digits.length && digits[first] === '0') first++
  // Exv3: nothing significant left, so the digit is a literal '0'
  const head = first < digits.length ? digits[first]! : '0'
  const kept = digits.slice(first + 1, first + 7).replace(/0+$/, '')
  // Exv8 falls into Exf5, so the point goes the same way it does above
  const point = kept === '' ? '' : '.'
  return `${sign}${head}${point}${kept}${spaceBeforeE(kept)}E-${expDigits(run)}`
}

/** the `CMPI.B #$30 / CMPI.B #$39` pair the digit loops open with */
function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9'
}

/** `$80000041`, the FFP one that `L28040` and `L28116` count from */
const FFP_ONE = 0x80000041
/** `$A0000044`, the FFP ten every power of ten is built out of */
const FFP_TEN = 0xa0000044
/** `$80000042` and `$80000040`, the two and the half `L28116` normalises with */
const FFP_TWO = 0x80000042
const FFP_HALF = 0x80000040
/** `$80000059`, two to the twenty-fourth */
const FFP_2P24 = 0x80000059

/**
 * `L280A8` --- the digits of a number read left to right as one FFP integer,
 * `acc = acc * 10 + digit`, stopping at the first character that is not 0-9.
 *
 * Every step goes through the FFP multiply and add, so a number needing more
 * than 24 bits of mantissa is already inexact before the decimal point is
 * accounted for. The add is called as `add(digit, acc)` and the argument order
 * decides which operand keeps the guard byte, so it is kept.
 */
function digitsToFfp(text: string, at: number): number {
  let acc = 0
  let i = at
  while (isDigit(text[i])) {
    acc = ffpMul(acc, FFP_TEN)
    acc = ffpAdd(ffpFlt(text.charCodeAt(i) - 0x30), acc)
    i++
  }
  return acc
}

/**
 * `L28040` --- ten to the n, built by repeated FFP multiply or divide from
 * one.
 *
 * This is the whole reason `ascToFfp` cannot be a correctly rounded decimal
 * conversion. Ten is exact in FFP and so are the first few powers, but 10^8
 * needs 27 bits and every step from there rounds again on top of the last
 * one's error. 10^-1 is worse: the first divide is already inexact.
 */
function powerOfTen(n: number): number {
  let acc = FFP_ONE
  let e = (n << 16) >> 16
  if (e < 0) {
    while (e < 0) {
      acc = ffpDiv(acc, FFP_TEN)
      e++
    }
    return acc
  }
  while (e > 0) {
    acc = ffpMul(acc, FFP_TEN)
    e--
  }
  return acc
}

/**
 * `L28116` --- pull a value apart into a mantissa in [0.5, 1) and an exponent,
 * then put it back together.
 *
 * It is a no-op on every value the format can hold, because scaling by two and
 * by 2^24 is exact in FFP and `L28300` then truncates an integer that is
 * already whole. Kept because it is on the path and because a divergence here
 * would be silent: if the loops ever ran on something the multiply had left
 * denormal, this is where the difference would show.
 */
function rebuild(a: number): number {
  let x = a >>> 0
  if (ffpCmp(x, 0) === 0) return 0
  let neg = false
  if (ffpCmp(x, 0) < 0) {
    x = ffpNeg(x)
    neg = true
  }
  let e = 0
  while (ffpCmp(x, FFP_ONE) >= 0) {
    e++
    x = ffpDiv(x, FFP_TWO)
  }
  while (ffpCmp(x, FFP_HALF) < 0) {
    e--
    x = ffpMul(x, FFP_TWO)
  }
  const m = ffpFix(ffpMul(x, FFP_2P24))
  return ((((m << 8) >>> 0) | ((e + 64) & 0x7f)) | (neg ? 0x80 : 0)) >>> 0
}

/** `L28654` --- the exponent's digits as a 16-bit signed integer, `MULS #10` and all */
function ascToWord(text: string): number {
  let i = 0
  let neg = false
  if (text[i] === '+') i++
  else if (text[i] === '-') {
    i++
    neg = true
  }
  let v = 0
  while (isDigit(text[i])) {
    v = (((v * 10) << 16) >> 16) + (text.charCodeAt(i) - 0x30)
    v = (v << 16) >> 16
    i++
  }
  return neg ? (-v << 16) >> 16 : v
}

/**
 * `AscToFloat` ($25912, which jumps straight to `a2ffp` at $26774): the four
 * bytes AMOS stores for a float literal you type.
 *
 * The shape is digits, then a scale. Every digit before and after the point is
 * accumulated into one FFP integer, the point only being counted, and the
 * count is then subtracted from any `E` exponent to give a single power of ten
 * to multiply by. So `0.9` is `9 * 10^-1`, and `10^-1` is one FFP divide by
 * ten, which is not 0.1. That is why the stored mantissa is 15099495 where
 * correct rounding gives 15099494, and why `encodeFfp` cannot stand in here.
 *
 * The sign is taken off the front and put back on at the end, so a leading
 * minus never reaches the arithmetic. $28026 ORs it in without looking at what
 * it is signing, so "-0" comes out as $00000080: a zero mantissa, which is the
 * only thing FFP calls zero, wearing a sign bit. It does not survive a round
 * trip, because `floatToAsc` writes that back as "0".
 *
 * DEVIATION: the digit buffer at `-$14(a6)` is twenty bytes inside the stack
 * frame and nothing bounds the copy loop at $27F32, so a literal with 21 or
 * more digits writes over the saved `a6` and returns into nothing. There is no
 * frame here to overwrite.
 *
 * DEFECT: a constant can lose a mantissa step every time its line is listed
 * and read back. Type `0.875` and $28040 divides 1.0 by ten three times and
 * multiplies, landing on $DFFFFF40 rather than the $E0000040 that 0.875 has
 * exactly. `floatToAsc` then reports that honestly as "0.8749999", and reading
 * "0.8749999" back gives $DFFFFC40, three steps lower again. The editor
 * retokenises any line the cursor leaves, so the constant walks down every
 * time the line is touched. 126 lines of the 3,873 programs in the corpus are
 * caught mid-walk, `XFIN#=0.8749999` and `KC#=0.004499999` among them, each
 * one a value someone typed as 0.875 or 0.0045. See
 * `roundtrip.ts:driftingFloat` and the named test in `numfmt.test.ts`.
 */
export function ascToFfp(text: string): number {
  let i = 0
  while (text[i] === ' ' || text[i] === '\t') i++
  const neg = text[i] === '-'
  if (text[i] === '-' || text[i] === '+') i++

  // digits, with the point counted rather than placed
  let digits = ''
  let decimals = 0
  let seenPoint = false
  while (i < text.length && text[i] !== 'e' && text[i] !== 'E') {
    if (text[i] === '.') seenPoint = true
    else {
      digits += text[i]
      if (seenPoint) decimals = (decimals + 1) & 0xffff
    }
    i++
  }

  // an E and its own sign, read separately
  let expNeg = false
  let expText = ''
  if (text[i] === 'e' || text[i] === 'E') {
    i++
    expNeg = text[i] === '-'
    if (text[i] === '-' || text[i] === '+') i++
    expText = text.slice(i)
  }

  const mantissa = digitsToFfp(digits, 0)
  const written = ascToWord(expText)
  const scale = ((expNeg ? -written : written) - decimals) & 0xffff
  const bits = rebuild(ffpMul(powerOfTen((scale << 16) >> 16), mantissa))
  return neg ? (bits | 0x80) >>> 0 : bits
}

/** `AscToFloat`'s answer as a JavaScript number, for callers that want the value */
export function ascToFloat(text: string): number {
  return decodeFfp(ascToFfp(text))
}
