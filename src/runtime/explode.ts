/**
 * Explode 2.01 — Volker Stepprath, Testaware, 1995-2002. 131 keywords at
 * slot 7.
 *
 * A toolbox rather than a theme: packers for five formats, bank and file
 * handling, a numbered structure allocator, bitplane surgery, fonts, and a
 * scattering of system calls. The name is the packers' — most of the library
 * is about getting data in and out of AMOS banks compressed.
 *
 * ## Evidence
 *
 * SOURCE tier, and unusually so for a third-party extension this size. The
 * archive ships `AMOSPro_Explode_Lib.s`, 90,716 bytes and 4,639 lines of the
 * author's own commented assembler — his labels, his structure offsets, his
 * comments in German — alongside the 15,168-byte library it built and a 65KB
 * manual with an entry per keyword. `extdis explode-2.01` opens the binary;
 * the source is what actually gets read, and citations below name the routine
 * NUMBER and its address in that binary so both can be checked.
 *
 * The slot is the source's own: `ExtNb equ 7-1` on line 16, where the
 * registration previously had 7 from ExoticA's wiki.
 *
 * ## Register convention, as this library writes it
 *
 * The usual AMOS one — arguments pop right-to-left off `(a3)+`, `d3` is the
 * return value and `d2` the return type, 0 integer and 2 string. Two of the
 * author's own helpers appear throughout and are worth naming once:
 *
 *   `L_GetSpace`   D3 <= byte length, A1 => string pointer, D3 => the string
 *   `L_IFunc`      AMOS error 23, Illegal function call
 *
 * A string argument arrives as a POINTER to an AMOS string block: a length
 * word, then the characters, so the first character is at `2(a0)`.
 */
import type { Func } from '../interp/builtins'
import type { Runtime } from './runtime'
import { VI, VS, funcCall, int, str, type Value } from '../interp/values'

/**
 * The characters of an AMOS string as bytes, padded with zeros.
 *
 * `=Word($)` reads two bytes and `=Long($)` four, with no check that the
 * string is that long: on the machine a short one reads on into whatever the
 * string heap holds next. DEVIATION: there is no string heap here to read
 * into, so a missing byte is zero. The alternative would be inventing a
 * neighbour, which is worse than being short.
 */
function chars(s: string, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i < s.length ? s.charCodeAt(i) & 0xff : 0))
}

/**
 * `lsl`/`lsr` with a register count, at one of the three widths.
 *
 * THE WIDTH IS NOT A ROUNDING — it is the whole behaviour. `lsl.b d2,d3`
 * shifts the low BYTE of d3 and leaves the other twenty-four bits exactly
 * where they were, and the routine then returns the whole of d3. So
 * `Lsl.b(1,$1234)` is $1268 and not $2468: the $12 is untouched and only the
 * $34 moves. Reproducing that is the point of there being three keywords per
 * direction rather than one.
 *
 * The count is taken modulo 64 by the 68k, and a count at or above the width
 * shifts every bit out, so the field ends up zero rather than unchanged.
 */
function shifted(value: number, count: number, bits: number, left: boolean): number {
  const n = count & 63
  const mask = bits === 32 ? 0xffff_ffff : (1 << bits) - 1
  const whole = value >>> 0
  // NOT `whole & mask` at the .l width: `&` is an int32 operator in JS, so
  // masking $80000000 with $ffffffff gives -2147483648 and the divide below
  // then produces a negative field. That was a real failure, not a
  // hypothetical one
  const field = bits === 32 ? whole : whole & mask
  // multiply and divide rather than shift: JS's << and >>> are 32-bit and
  // SIGNED at the top end, which gets the .l width wrong for exactly the
  // values that make it interesting
  const out = n >= bits ? 0 : left ? (field * 2 ** n) % 2 ** bits : Math.floor(field / 2 ** n)
  // the bits above the field keep their old value, and the answer is the
  // whole longword, signed
  return ((whole & (mask ^ 0xffff_ffff)) | out) | 0
}

export function makeExplodeFunctions(_rt: Runtime): Record<string, Func> {
  /** the shared body of Lsl.b/.w/.l and Lsr.b/.w/.l — routines 65 to 70 */
  const shift = (bits: number, left: boolean): Func =>
    (_, a): Value => VI(shifted(int(a[1]!), int(a[0]!), bits, left))

  return {
    /**
     * =Byte($) — routine 59 ($163a). `move.b 2(a0),d3` over a zeroed d3, so
     * the FIRST character of the string as an unsigned 0..255.
     *
     * NOTE: the author's inline comment on this routine reads `;Byte$` and
     * the one below it `;Byte`, which is the pair the wrong way round —
     * routine 59 is what the token table binds to `byte` and it consumes a
     * string. The specs settle it: `byte` is `02` and `byte$` is `20`.
     */
    byte: (_, a): Value => VI(chars(str(a[0]!), 1)[0]!),

    /** =Byte$(#) — routine 60 ($1646): one character out of the low byte */
    'byte$': (_, a): Value => VS(String.fromCharCode(int(a[0]!) & 0xff)),

    /** =Word($) — routine 61 ($1654): two characters, big-endian, UNSIGNED */
    word: (_, a): Value => {
      const c = chars(str(a[0]!), 2)
      return VI((c[0]! << 8) | c[1]!)
    },

    /** =Word$(#) — routine 62 ($1660): two characters, big-endian */
    'word$': (_, a): Value => {
      const v = int(a[0]!)
      return VS(String.fromCharCode((v >> 8) & 0xff, v & 0xff))
    },

    /**
     * =Long($) — routine 63 ($166e): four characters, big-endian, and SIGNED.
     *
     * The one asymmetry in the group: Byte and Word zero d3 first and Long
     * does not, so `move.l 2(a0),d3` fills the register and a leading
     * character above $7f gives a negative answer.
     */
    long: (_, a): Value => {
      const c = chars(str(a[0]!), 4)
      return VI(((c[0]! << 24) | (c[1]! << 16) | (c[2]! << 8) | c[3]!) | 0)
    },

    /** =Long$(#) — routine 64 ($1678): four characters, big-endian */
    'long$': (_, a): Value => {
      const v = int(a[0]!)
      return VS(String.fromCharCode((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff))
    },

    /** =Lsl.b(#,var) — routine 65 ($1684), and the five below it to $16b6 */
    'lsl.b': shift(8, true),
    'lsl.w': shift(16, true),
    'lsl.l': shift(32, true),
    'lsr.b': shift(8, false),
    'lsr.w': shift(16, false),
    'lsr.l': shift(32, false),

    /** =Even(#) — routine 71 ($16c0): `btst #0`, -1 when the bit is CLEAR */
    even: (_, a): Value => VI((int(a[0]!) & 1) === 0 ? -1 : 0),
    /** =Odd(#) — routine 72 ($16d0): the same test the other way up */
    odd: (_, a): Value => VI((int(a[0]!) & 1) !== 0 ? -1 : 0),

    /**
     * =Align(var,#) — routine 73 ($16e0): round UP to a multiple.
     *
     * `divs d0,d1 / swap d1 / andi.l #$FFFF,d1` takes the remainder, and a
     * non-zero one is added away: `var + align - (var mod align)`. An
     * alignment of zero is AMOS error 23, `tst.l d0 / Rbeq L_IFunc`.
     *
     * NOTE: `divs` is a 32-by-16 SIGNED divide, so the alignment is used as a
     * word and a quotient that will not fit in sixteen bits overflows. On the
     * 68k an overflowing DIVS leaves its registers alone and sets V, which
     * this routine never tests, so the answer would be the unaligned value
     * with a stale remainder folded in. Not reproduced: it needs |var/align|
     * at or above 32768 and there is nothing to be faithful to.
     */
    align: (_, a): Value => {
      const v = int(a[0]!)
      const n = int(a[1]!)
      if (n === 0) funcCall()
      const rem = (v % n) & 0xffff
      return VI(rem === 0 ? v : (v + n - rem) | 0)
    },
  }
}
