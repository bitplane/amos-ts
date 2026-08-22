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
 * `LongToDec` :25659, `LongToHex` :25718, `LongToBin` :25754 and `FloatToAsc`
 * :25923 (into `fldeb`, `F2a` and the `Clean`/`ExFix1`/`ExVir1` tails).
 */
import { decodeFfp, encodeFfp } from '../amiga/ffp'

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
 */
function expAtLeastOne(value: number, n: number): string {
  const exponent = n - 2
  const width = Math.min(n, 7)
  const s = ffpToFixed(value, 9 - width)
  const sign = s[0] === '-' ? '-' : ''
  const digits = (sign ? s.slice(1) : s).replace('.', '')
  const kept = digits.slice(1, 6).replace(/0+$/, '')
  const point = kept === '' ? '' : '.'
  return `${sign}${digits[0]}${point}${kept}E+${expDigits(exponent)}`
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
  return `${sign}${head}${point}${kept}E-${expDigits(run)}`
}
