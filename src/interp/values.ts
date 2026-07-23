/**
 * AMOS values: 32-bit signed integers, floats and strings.
 * Variable type is part of the name: A (int), A# (float), A$ (string).
 */

export type Value =
  | { k: 'int'; n: number }
  | { k: 'float'; n: number }
  | { k: 'str'; s: string }

export const VI = (n: number): Value => ({ k: 'int', n: n | 0 })
export const VF = (n: number): Value => ({ k: 'float', n })
export const VS = (s: string): Value => ({ k: 'str', s })

// ---- Motorola Fast Floating Point (mathffp.library) ----
//
// AMOS floats default to single-precision FFP: a 24-bit mantissa (identical
// to IEEE float32, so Math.fround gives the exact precision) with a 7-bit
// excess-64 exponent — a smaller range than float32. Values at/above 2^63
// overflow; tiny values underflow to 0 (FFP has no infinities or
// denormals). Set Double Precision switches to raw IEEE doubles.
const FFP_MAX = 2 ** 63 // ~9.22e18
const FFP_MIN = 2 ** -65 // ~2.7e-20, the smallest normalised magnitude

/** Round a double to the nearest representable FFP value (raises Overflow). */
export function ffpRound(n: number): number {
  if (!Number.isFinite(n)) throw new AmosError('Overflow')
  if (n === 0) return 0
  const f = Math.fround(n)
  const a = Math.abs(f)
  if (a >= FFP_MAX) throw new AmosError('Overflow')
  if (a < FFP_MIN) return 0
  return f
}

/**
 * The AMOS runtime error table (.Error1 in +Editor_Config.s:844): Errn
 * returns the number, Err$ returns the message. Codes match the original.
 */
export const AMOS_ERRORS: Record<number, string> = {
  1: 'RETURN without GOSUB',
  2: 'POP without GOSUB',
  3: 'Error not resumed',
  4: "Can't resume to a label",
  5: 'No ON ERROR PROC before this instruction',
  6: 'Resume label not defined',
  7: 'Resume without error',
  8: 'Error procedure must RESUME to end',
  9: 'Program interrupted',
  10: 'End of program',
  11: 'Out of variable space',
  13: 'Out of stack space',
  15: 'User function not defined',
  16: 'Illegal user function call',
  17: 'Illegal direct mode',
  20: 'Division by zero',
  21: 'String too long',
  22: 'Syntax error',
  23: 'Illegal function call',
  24: 'Out of memory',
  25: 'Address error',
  27: 'Non dimensioned array',
  28: 'Array already dimensioned',
  29: 'Overflow',
  30: 'Bad IFF format',
  31: 'IFF compression not recognised',
  32: "Can't fit picture in current screen",
  33: 'Out of data',
  34: 'Type mismatch',
  35: 'Bank already reserved',
  36: 'Bank not reserved',
  37: 'Fonts not examined',
  38: 'Menu not opened',
  39: 'Menu item not defined',
  40: 'Label not defined',
  41: 'No data after this label',
  44: 'Font not available',
}

/** AMOS error codes used at throw sites (Errn / Err$ / Error). */
export const ERR = {
  RETURN_NO_GOSUB: 1,
  POP_NO_GOSUB: 2,
  RESUME_NO_ERROR: 7,
  DIV_ZERO: 20,
  STRING_TOO_LONG: 21,
  SYNTAX: 22,
  FUNC_CALL: 23,
  OUT_OF_MEMORY: 24,
  ADDRESS: 25,
  NO_ARRAY: 27,
  ALREADY_DIM: 28,
  OVERFLOW: 29,
  BAD_IFF: 30,
  OUT_OF_DATA: 33,
  TYPE_MISMATCH: 34,
  BANK_RESERVED: 35,
  NO_BANK: 36,
  LABEL: 40,
} as const

export class AmosError extends Error {
  /** the AMOS error number (Errn), when known */
  constructor(
    message: string,
    readonly code = 0,
  ) {
    super(message)
  }
}

/** Map a thrown error to its AMOS number (explicit code, else by message). */
export function amosErrorCode(e: AmosError): number {
  if (e.code) return e.code
  const m = e.message.toLowerCase()
  if (m.includes('division by zero') || m.includes('divide')) return ERR.DIV_ZERO
  if (m.includes('overflow')) return ERR.OVERFLOW
  if (m.includes('type mismatch')) return ERR.TYPE_MISMATCH
  if (m.includes('function call')) return ERR.FUNC_CALL
  if (m.includes('bank not reserved') || m.includes('bank not present')) return ERR.NO_BANK
  if (m.includes('already reserved') || m.includes('already dimensioned')) return ERR.ALREADY_DIM
  if (m.includes('not dimensioned')) return ERR.NO_ARRAY
  if (m.includes('out of data')) return ERR.OUT_OF_DATA
  if (m.includes('string too long') || m.includes('too long')) return ERR.STRING_TOO_LONG
  if (m.includes('return without gosub')) return ERR.RETURN_NO_GOSUB
  if (m.includes('pop without gosub')) return ERR.POP_NO_GOSUB
  if (m.includes('resume without error')) return ERR.RESUME_NO_ERROR
  if (m.includes('illegal') && (m.includes('screen') || m.includes('sprite'))) return ERR.FUNC_CALL
  if (m.includes('address')) return ERR.ADDRESS
  if (m.includes('label')) return ERR.LABEL
  if (m.includes('iff')) return ERR.BAD_IFF
  return ERR.FUNC_CALL // AMOS's catch-all for a generic runtime fault
}

/** Numeric value of v; strings are a type mismatch. */
export function num(v: Value): number {
  if (v.k === 'str') throw new AmosError('Type mismatch')
  return v.n
}

/** Integer value of v (fraction truncated, like AMOS int conversion). */
export function int(v: Value): number {
  return Math.trunc(num(v)) | 0
}

export function str(v: Value): string {
  if (v.k !== 'str') throw new AmosError('Type mismatch')
  return v.s
}

export function truthy(v: Value): boolean {
  return num(v) !== 0
}

/** 0 = int, 1 = float, 2 = string — matches variable token flag bits. */
export type VarType = 0 | 1 | 2

export function varType(flags: number): VarType {
  if (flags & 0x01) return 1
  if (flags & 0x02) return 2
  return 0
}

export function typeSuffix(t: VarType): string {
  return t === 1 ? '#' : t === 2 ? '$' : ''
}

export function defaultValue(t: VarType): Value {
  return t === 2 ? VS('') : t === 1 ? VF(0) : VI(0)
}

/** Coerce a value for storage into a variable of type t. */
export function coerce(t: VarType, v: Value): Value {
  if (t === 2) return VS(str(v))
  if (t === 1) return VF(num(v))
  return VI(int(v))
}

/**
 * Display form, as used by Print and Str$: non-negative numbers get a
 * leading space, negatives a '-' (LongToAsc in +Lib.s writes a space when
 * called "avec signe" — both Print and Str$ do). Floats round to 7
 * significant digits, the precision of the original FFP format.
 */
export function display(v: Value): string {
  if (v.k === 'str') return v.s
  const n = v.k === 'int' ? v.n : parseFloat(v.n.toPrecision(7))
  return n < 0 ? String(n) : ' ' + String(n)
}
