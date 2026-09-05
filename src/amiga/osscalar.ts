/** OS DevKit 1.61's local register/string conversion workers. */

/** routine 1752: swap d3; move.w d0,d3; swap d3 */
export function joinWord(current: number, stacked: number): number {
  return (((stacked & 0xffff) << 16) | ((current >>> 16) & 0xffff)) | 0
}

/** routine 1757: ext.w followed by ext.l, therefore sign-extend the byte. */
export const extendByte = (value: number): number => (value << 24) >> 24

/** routine 1758: ext.w alone preserves d3's upper word. */
export function extendWithinWord(value: number): number {
  return ((value & 0xffff_0000) | (((value << 24) >> 24) & 0xffff)) | 0
}

/** routine 1759: ext.l sign-extends the low word. */
export const extendWord = (value: number): number => (value << 16) >> 16

/** routines 26/27: encode a long or word as an AMOS binary string, big-endian. */
export const chrLong = (value: number): string => String.fromCharCode(
  (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff,
)

export const chrWord = (value: number): string => String.fromCharCode((value >>> 8) & 0xff, value & 0xff)

const byte = (value: string, at: number): number => (value.charCodeAt(at) || 0) & 0xff

/** routines 28/29: read the bytes after an AMOS string's length word. */
export const valLong = (value: string): number =>
  ((byte(value, 0) << 24) | (byte(value, 1) << 16) | (byte(value, 2) << 8) | byte(value, 3)) | 0

export const valWord = (value: string): number => (byte(value, 0) << 8) | byte(value, 1)

/** The d0-d7/a0-a7 frame used by `_dreg`, `_areg`, `_call` and `_lib call`. */
export class OsRegisterFrame {
  readonly d = new Int32Array(8)
  readonly a = new Int32Array(8)

  setData(register: number, value: number): void { if (register >= 0 && register < 8) this.d[register] = value | 0 }
  data(register: number): number { return register >= 0 && register < 8 ? this.d[register]! : 0 }
  setAddress(register: number, value: number): void { if (register >= 0 && register < 8) this.a[register] = value | 0 }
  address(register: number): number { return register >= 0 && register < 8 ? this.a[register]! : 0 }
}

/** Routine 1478's private editor/library name: a tilde plus at most 31 bytes. */
export function osAmosName(name: string): string {
  return '~' + name.slice(0, 31)
}
