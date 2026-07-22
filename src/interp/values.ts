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

export class AmosError extends Error {}

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
