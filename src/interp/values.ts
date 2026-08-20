/**
 * AMOS values: 32-bit signed integers, floats and strings.
 * Variable type is part of the name: A (int), A# (float), A$ (string).
 */
import { ED_RUN_MESSAGES } from './errors.gen'

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
 * The AMOS runtime error table (.Error1 in +Editor_Config.s:849): Errn
 * returns the number, Err$ returns the message.
 *
 * Generated from the assembler source rather than transcribed, so it is the
 * whole table — 201 records, where the hand-written version carried the 73 that
 * had come up.
 *
 * THE INDEX IS THE ERROR NUMBER, with no offset anywhere. Record 0 is the
 * empty one the block opens with, and after that every `EdT n` lands on n.
 * Six independent anchors agree, spread across the whole range: `Rn_NoF moveq
 * #81` on "File not found" and `.DErr moveq #101` on "Disc error" (both
 * +ILib.s:1524-8), `PRun_Acc moveq #102` on "Instruction not allowed here"
 * (+ILib.s:1605), +IO_Ports.s opening serial with `move.w #145,d3` and
 * parallel with `#171` on the first message of each device's block, and
 * Dev.GetIO's 140 and 141 on "Device already opened" and "Device not opened".
 *
 * This map used to shift everything from index 126 up by 14, which was a
 * correction fitted to the wrong fault. The table itself was short: the
 * generator's line pattern required the record to END at its closing `>`, and
 * twenty-nine records carry an unmarked comment after it — among them the
 * fourteen AmigaDOS-mapped disc errors, `EdT 80,<Directory not found>  204`
 * and its neighbours. Fourteen dropped records shortened the block by
 * fourteen, so the device messages came out 14 low and shifting them back up
 * hid it. Everything BETWEEN — 94 "I/O error" through 139 — stayed wrong, and
 * that is the range Explode's own error table raises from.
 */
export const AMOS_ERRORS: Record<number, string> = Object.fromEntries(
  ED_RUN_MESSAGES.map((m, i) => [i, m]).filter(([, m]) => m !== ''),
)

/**
 * The AMOS error numbers `Errn` reports, and what `amosErrorCode` maps a
 * thrown message onto. NOT used at throw sites — see amosErrorCode for why
 * the message strings are load-bearing and this table is the recovery.
 */
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
  /**
   * DEBase+2. `DiskError` (+Lib.s:12841) reads IoErr and indexes `ErDisk`,
   * whose third word is 205 = ERROR_OBJECT_NOT_FOUND, so a failed Open on a
   * missing file lands on 79+2. `Rn_NoF moveq #81` (+ILib.s:1524) anchors it.
   */
  FILE_NOT_FOUND: 81,
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

/**
 * AMOS's catch-all fault, and the single most common throw in this port.
 *
 * The 68k spelling is `moveq #23,d0 / Rbra L_GoError` and the ports write it
 * out inline the same way. This exists because five of them had grown a
 * private `funcCall()` of their own — tome, sticks, powerbobs, turbo, p61 —
 * which is five places for the message string to drift, and the string is
 * load-bearing: `amosErrorCode` recovers the number from it whenever a throw
 * site omits the code.
 */
export function funcCall(): never {
  throw new AmosError('Illegal function call', ERR.FUNC_CALL)
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
  if (m.includes('file not found')) return ERR.FILE_NOT_FOUND
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
