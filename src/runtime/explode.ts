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

/**
 * `Pdef$`'s twenty-four constant bytes — routine 39 ($1240), assembled as
 * three longwords and read out here as what they are.
 *
 *     ESC I 0   inverse off      ESC B 0   paper 0
 *     ESC S 0   shade off        ESC D 3   cursor colour 3
 *     ESC U 0   underline off    ESC W 0   writing mode 0
 *     ESC P 1   pen 1            ESC C 1   cursor on
 *
 * So "default" is the author's idea of it rather than AMOS's boot state, and
 * it sets two things no other keyword in the group can reach — the pen and
 * the paper.
 */
const PDEF = '\x1bI0\x1bS0\x1bU0\x1bP1\x1bB0\x1bD3\x1bW0\x1bC1'

/**
 * exec's `RawDoFmt` (-522), enough of it for `Format$`.
 *
 * The extension does not format anything itself: routine 40 hands the string
 * and a data pointer straight to exec and copies back what lands in AMOS's
 * scratch buffer. So the specification is exec's, and the part that matters
 * is the ARGUMENT WIDTH — `%d` takes a WORD off the buffer and `%ld` a
 * longword, which is why the author's own example feeds it `Rs Word` and not
 * `Rs Long`:
 *
 *     A$="Extension:%s Version:%d.%d Datum:%x-%x-%x"
 *     Print Format$(A$,Rs Start(0))
 *
 * `%s` takes a longword POINTER to NUL-terminated characters, which is what
 * `Rs Aptr` puts in the buffer.
 */
function rawDoFmt(rt: Runtime, fmt: string, base: number): string {
  let out = ''
  let off = 0
  const word = (): number => {
    const v = readWord(rt, base + off)
    off += 2
    return v
  }
  const long = (): number => {
    const v = readLong(rt, base + off)
    off += 4
    return v
  }
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] !== '%') {
      out += fmt[i]
      continue
    }
    i++
    if (fmt[i] === '%') {
      out += '%'
      continue
    }
    let left = false
    let pad = ' '
    if (fmt[i] === '-') {
      left = true
      i++
    }
    if (fmt[i] === '0') {
      pad = '0'
      i++
    }
    let width = ''
    while (fmt[i] !== undefined && fmt[i]! >= '0' && fmt[i]! <= '9') width += fmt[i++]
    let limit = ''
    if (fmt[i] === '.') {
      i++
      while (fmt[i] !== undefined && fmt[i]! >= '0' && fmt[i]! <= '9') limit += fmt[i++]
    }
    const isLong = fmt[i] === 'l'
    if (isLong) i++
    const type = fmt[i] ?? ''
    let text: string
    switch (type) {
      case 'd':
        text = String(isLong ? long() | 0 : ((word() << 16) >> 16))
        break
      case 'u':
        text = String((isLong ? long() : word()) >>> 0)
        break
      case 'x':
        text = ((isLong ? long() : word()) >>> 0).toString(16)
        break
      case 'c':
        text = String.fromCharCode((isLong ? long() : word()) & 0xff)
        break
      case 's':
        text = cstring(rt, long())
        break
      default:
        // exec copies an unrecognised specifier through untouched
        out += `%${type}`
        continue
    }
    if (limit !== '' && type === 's') text = text.slice(0, Number(limit))
    const w = Number(width || 0)
    if (text.length < w) text = left ? text.padEnd(w, ' ') : text.padStart(w, pad)
    out += text
  }
  return out
}

/** a word out of the address space, big-endian */
function readWord(rt: Runtime, addr: number): number {
  const m = rt.resolveAddr(addr >>> 0)
  if (!m) return 0
  return ((m.data[m.off] ?? 0) << 8) | (m.data[m.off + 1] ?? 0)
}

/** a longword out of the address space, big-endian */
function readLong(rt: Runtime, addr: number): number {
  const v = rt.longsAt(addr, false)
  return v ? v.get(0) : 0
}

/** NUL-terminated characters at an address, bounded so a bad pointer cannot hang */
function cstring(rt: Runtime, addr: number): string {
  const m = rt.resolveAddr(addr >>> 0)
  if (!m) return ''
  let s = ''
  for (let i = m.off; i < m.data.length && m.data[i] !== 0 && s.length < 4096; i++) {
    s += String.fromCharCode(m.data[i]!)
  }
  return s
}

export function makeExplodeFunctions(rt: Runtime): Record<string, Func> {
  /**
   * Routine 163 ($3841 in the source, `L_PrtSeq`), which all six of the
   * Pxxx$ keywords tail into: three bytes, ESC then the routine's own letter
   * then `arg + "0"`.
   *
   * The addition is a BYTE add, so an argument of 10 gives ":" rather than
   * being rejected, and one of 208 wraps back round to "0". The console then
   * reads whatever character arrived; nothing here range-checks.
   */
  const seq = (letter: string): Func =>
    (_, a): Value => VS(`\x1b${letter}${String.fromCharCode((int(a[0]!) + 0x30) & 0xff)}`)

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

    /*
     * The print sequences — routines 33 to 38 ($1210 to $1238), one letter
     * each into the shared builder.
     *
     * These build STRINGS for AMOS's own Print and change nothing themselves,
     * which is what makes them worth having: `Inverse On` is an instruction
     * and cannot happen in the middle of a Print, where `Pinv$(1)` can. The
     * manual's example is exactly that shape:
     *
     *     Print "Ein ";Pinv$(1);" negativ ";Pinv$(0);" Beispiel"
     *
     * THREE OF THE SIX ESCAPES DID NOT EXIST IN THIS PORT until they were
     * written for this batch. The console handled ESC P, B, C, D, W and six
     * more, and ignored I, S and U — so a program of the shape above printed
     * the escape bytes as characters. Added to ../runtime/screen.ts against
     * the same three window fields `Inverse On`, `Shade On` and `Under On`
     * set. That is a gap in the CORE, found by porting an extension.
     */
    'pinv$': seq('I'),
    'psad$': seq('S'),
    'pund$': seq('U'),
    'pcpn$': seq('D'),
    'pjam$': seq('W'),
    'pcsr$': seq('C'),

    /** =Pdef$ — routine 39 ($1240): the eight-sequence constant above */
    'pdef$': (): Value => VS(PDEF),

    /**
     * =Format$("fmt",buffer) — routine 40 ($1264).
     *
     * `Rjsr L_Bnk.OrAdr` on the second argument, so it is a bank number or an
     * address, and then the whole job goes to exec: `EXE RawDoFmt` with the
     * format string, the buffer as the argument stream and a two-instruction
     * callback that appends a byte. The result is measured, a string is
     * reserved and it is copied in.
     *
     * So the formatter is exec's, not the author's, and the widths are
     * exec's too -- `%d` eats a WORD. See `rawDoFmt`.
     */
    'format$': (_, a): Value => {
      const fmt = str(a[0]!)
      const where = int(a[1]!)
      // bankOrAddr raises 'bank not reserved' for a bank that is not there,
      // which is what L_Bnk.OrAdr does
      const m = rt.bankOrAddr(where)
      if (!m) return VS('')
      // the arguments are walked by ADDRESS rather than through `m`, because
      // %s follows a pointer that may land in another region entirely
      return VS(rawDoFmt(rt, fmt, where >= 0 && where < 0x10000 ? rt.bankBase(where) : where))
    },
  }
}
