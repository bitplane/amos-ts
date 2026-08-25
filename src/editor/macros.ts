/**
 * `EdMa_` (+Edit.s:6620 to 6930): the editor's macros.
 *
 * A macro is a recorded run of keystrokes under one key. `Ed_Key` (:1552)
 * reads the tape before it reads the keyboard, writes to it while one is
 * recording, and looks a live keystroke up in the list before it does anything
 * else with it. All three of those are above the key map, so a macro can hold
 * anything a person could type.
 *
 * ## A keystroke is a long
 *
 * `Inkey` answers `[qualifiers][scancode][unused][ascii]`, most significant
 * byte first, which is how `Ed_Ky2Fonc` (:2470) takes it apart: `move.b d1,d7`
 * for the ASCII, `swap` then `move.b d1,d6` for the scancode, `lsr.w #8` for
 * the qualifiers. The simulated Ctrl-C at :1579 is `$08330043` and reads the
 * same way: Ctrl, rawkey $33, ASCII `C`.
 *
 * A macro keeps three of those four bytes, ASCII first, and drops the unused
 * one. `$FF` in the ASCII slot ends the run, so a macro cannot hold a key
 * whose ASCII is $FF.
 *
 * ## The file is a memory dump
 *
 * `EdMa_Save` (:6753) writes each node's whole eight-byte header, the link
 * pointer included, so an AMOS macro file carries live Amiga heap addresses
 * that the loader reads and throws away. The one AMOS Professional ships,
 * `AMOS/APSystem/AMOSPro_Editor_Macros`, has `$4031B168` in it.
 *
 * `Ed_ListeNew` links at the FRONT, so a file loaded and saved again comes
 * back in the opposite order. Two macros swap places on every trip.
 */

/** `EdMa_Head` (+Equ.s:1709) */
export const MACRO_HEAD = 'ApMa'

/** what `Ed_ListeNew` (+Edit.s:2986) puts in a list node, for one macro */
export interface Macro {
  /** `4(a1)`: the payload size, which is what the file carries and can exceed the data */
  size: number
  /** `8(a1)` onward: `[key:4][keystrokes, three bytes each][$FF]`, zero-padded */
  data: Uint8Array
}

/** what `Inkey` answers and `Dia_LastKey` keeps: one keystroke, packed */
export interface KeyLong {
  ascii: number
  scan: number
  shift: number
}

/**
 * The 1024-byte node `EdMa_New` reserves to record into.
 *
 * DEVIATION: on the machine this is a list node like any other, sitting at the
 * head of `EdMa_List` until `EdMa_Stop` copies it into a right-sized one and
 * frees it. Here it is its own thing, because a half-recorded macro in the
 * list would be findable by `EdMa_Adr` and on the machine it never is:
 * `.UneMac` is not reached while the tape is running.
 */
export interface MacroTape {
  /** the key it will answer to, already in the payload's first four bytes */
  key: number
  /** the payload: `[key:4][keystrokes]`, with a long of -1 at 1020 */
  buf: Uint8Array
  /** `EdMa_Tape(a5)` itself. 1 to start with, and 3 more for every key */
  at: number
}

/** `move.l #1024,d0` in `EdMa_New` (:6851) */
const TAPE_BYTES = 1024

/** `move.l #-1,8-4(a1,d1.w)`: the four bytes that say the buffer is full */
const TAPE_FULL = TAPE_BYTES - 4

const u32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0

const put32 = (b: Uint8Array, at: number, n: number): void => {
  b[at] = (n >>> 24) & 0xff
  b[at + 1] = (n >>> 16) & 0xff
  b[at + 2] = (n >>> 8) & 0xff
  b[at + 3] = n & 0xff
}

/** the three fields of an `Inkey` long, packed the way `Inkey` packs them */
export function packKey(k: KeyLong): number {
  return (((k.shift & 0xff) << 24) | ((k.scan & 0xff) << 16) | (k.ascii & 0xff)) >>> 0
}

/** and back, which is `Ed_Ky2Fonc`'s first five instructions */
export function unpackKey(n: number): KeyLong {
  return { shift: (n >>> 24) & 0xff, scan: (n >>> 16) & 0xff, ascii: n & 0xff }
}

/** `8(a1)`: the key a macro answers to */
export const macroKey = (m: Macro): number => u32(m.data, 0)

/** `lea 12(a1),a1`: the keystrokes, `$FF` and all */
export const macroKeys = (m: Macro): Uint8Array => m.data.subarray(4)

/** `EdMa_Adr` (:6904): the FIRST macro on the list with this key */
export function findMacro(list: readonly Macro[], key: number): Macro | null {
  for (const m of list) if (macroKey(m) === key) return m
  return null
}

/** `.Skip` in `EdMa_New` (:6851): a buffer to record into */
export function newTape(key: number): MacroTape {
  const buf = new Uint8Array(TAPE_BYTES)
  put32(buf, 0, key)
  buf.fill(0xff, TAPE_FULL)
  return { key, buf, at: 1 }
}

/**
 * The tape half of `Ed_Key` (:1593): one keystroke recorded.
 *
 * `lea 8+4-1(a0,d0.w),a0` puts the write at payload offset `EdMa_Tape + 3`,
 * and the $FF long at 1020 is what stops it. That leaves room for 339
 * keystrokes, and the 339th writes over the first byte of the sentinel: the
 * three behind it are what the next test reads.
 *
 * False back is `.2Big`, which says nothing and runs the key anyway.
 */
export function tapeKey(tape: MacroTape, key: number): boolean {
  const at = tape.at + 3
  if (tape.buf[at] === 0xff) return false
  tape.buf[at] = key & 0xff
  tape.buf[at + 1] = (key >>> 16) & 0xff
  tape.buf[at + 2] = (key >>> 24) & 0xff
  tape.at += 3
  return true
}

/**
 * `EdMa_Stop` (:6868): the tape copied into a node of its own size.
 *
 * Null back is `.Vide`, a macro with no keys in it, which is thrown away.
 *
 * `moveq #8,d0 / add.w d2,d0` asks for eight bytes more than the keystrokes
 * and only five are written, so every macro AMOS makes ends in three zero
 * bytes. The shipped file has them.
 */
export function stopTape(tape: MacroTape): Macro | null {
  const bytes = tape.at - 1
  if (bytes === 0) return null
  const size = 8 + bytes
  const data = new Uint8Array(size)
  data.set(tape.buf.subarray(0, 4 + bytes), 0)
  data[4 + bytes] = 0xff
  return { size, data }
}

/** `EdMa_Load`'s d0 (:6700) */
export interface MacroFile {
  /** 0 read it, 1 disc error, 2 not a macro file, -1 out of memory */
  error: 0 | 1 | 2 | -1
  list: Macro[]
}

/**
 * `EdMa_Load` (:6700) without the disc.
 *
 * The eight bytes in front of every macro are a list node's header as it stood
 * in memory. Only the size half is read; the link is written back over by
 * `Ed_ListeNew` and is never looked at.
 */
export function readMacroFile(bytes: Uint8Array): MacroFile {
  const fail = (error: 1 | 2): MacroFile => ({ error, list: [] })
  if (bytes.length < 4) return fail(1)
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== MACRO_HEAD) return fail(2)
  const list: Macro[] = []
  let at = 4
  for (;;) {
    if (at + 8 > bytes.length) return fail(1)
    const size = u32(bytes, at + 4)
    // `move.l 4(a2),d3 / beq .End`: a zero SIZE ends the file, and the zero
    // link beside it is not what is tested
    if (size === 0) return { error: 0, list }
    at += 8
    if (at + size > bytes.length) return fail(1)
    // Ed_ListeNew links at the front, so the list comes out reversed
    list.unshift({ size, data: bytes.slice(at, at + size) })
    at += size
  }
}

/**
 * `EdMa_Save` (:6753), head of the list first.
 *
 * DEVIATION: the link pointer goes down as zero. The machine writes whatever
 * was in memory, which is an address on the Amiga it was saved on; nothing
 * reads it back, and there is nothing here to put there.
 */
export function writeMacroFile(list: readonly Macro[]): Uint8Array {
  let size = 4 + 8
  for (const m of list) size += 8 + m.data.length
  const out = new Uint8Array(size)
  out.set(Uint8Array.from(MACRO_HEAD, (c) => c.charCodeAt(0)), 0)
  let at = 4
  for (const m of list) {
    put32(out, at + 4, m.size)
    out.set(m.data, at + 8)
    at += 8 + m.data.length
  }
  // `clr.l (a0)+` twice, then eight bytes written: a node header of nothing
  return out
}
