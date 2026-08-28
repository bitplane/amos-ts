/**
 * IntuiExtend 2.01b, the system and miscellaneous group — 50 keywords.
 *
 * The arithmetic half of the extension. Most of these touch no library at all,
 * which makes the disassembly the only thing that can settle what they do:
 * there is no source, and the guide gives a synopsis and a sentence. Where the
 * guide says what a value SHOULD be it is quoted; where the routine disagrees
 * with it, the routine wins and the difference is recorded.
 *
 * Five of them are broken in ways a caller can see, and four of those come
 * from the same habit. The 68000's `not.w`, `andi.w`, `move.w` and `asl.w`
 * write the LOW WORD of a data register and leave the high word alone, and
 * AMOS reads a function's result out of the whole of d3. So a routine that
 * builds a colour in d3's low word while something else is sitting in the
 * high word returns that something else too:
 *
 *   Pal Negativ  the sign extension of `0 - colour`, so every colour but 0
 *                comes back as $ffff0nnn
 *   Pal Antiq    the remainder of the `divu.w #3`, so two colours in three
 *                come back with 1 or 2 in the high word
 *   Int Sqr      an `ext.l` at the end, so a root of 32768 or more is negative
 *   Wb Date      a month table written as bytes and read as longs
 *
 * The fifth is `What Is`, whose RIFF arm has no branch, so every RIFF file is
 * a WAVE. See each keyword.
 *
 * Sourced from `AMOSPro_IntuiExtend.lib`, the same 23,084-byte hunk
 * ./intuiextend.ts works from, with the static workspace at $1d28.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, VS, int, str, type Value } from '../interp/values'
import { bltBitMap } from '../amiga/blitter'
import { BOB_BANK } from './banks'
import type { IntuiextendState } from './intuiextend'

/** sizeof(struct Image) — `move.l #$14,-(a3)` at $35a4 */
export const IE_IMAGE_SIZEOF = 20

/* ------------------------------------------------------------------ *
 * 68000 word arithmetic
 *
 * Written out rather than inlined because the whole point of this group is
 * that these instructions do NOT touch the high word, and a port that quietly
 * did would lose four of the five defects above.
 * ------------------------------------------------------------------ */

/** the low word, signed — what every `muls.w` and `cmp.w` operand is */
const lo = (v: number): number => (v << 16) >> 16

/** `not.w Dn` — invert the low word, leave the high word standing */
export const notW = (v: number): number => ((v & ~0xffff) | (~v & 0xffff)) | 0

/** `andi.w #m,Dn` */
export const andiW = (v: number, m: number): number => ((v & ~0xffff) | (v & m & 0xffff)) | 0

/** `asl.w #n,Dn` */
export const aslW = (v: number, n: number): number =>
  ((v & ~0xffff) | ((v << n) & 0xffff)) | 0

/** `move.w src,Dn` — replace the low word only */
export const moveW = (dst: number, src: number): number =>
  ((dst & ~0xffff) | (src & 0xffff)) | 0

/** `add.w src,Dn` */
export const addW = (dst: number, src: number): number =>
  ((dst & ~0xffff) | ((dst + src) & 0xffff)) | 0

/**
 * `divu.w #d,Dn` — quotient in the low word, REMAINDER in the high word.
 *
 * The remainder is the whole reason `Pal Antiq` misbehaves, so it is carried
 * rather than discarded.
 */
export const divuW = (v: number, d: number): number => {
  const n = v >>> 0
  const q = Math.floor(n / d)
  const r = n % d
  if (q > 0xffff) return v // overflow: the 68000 leaves the destination alone
  return (((r & 0xffff) << 16) | (q & 0xffff)) | 0
}

/* ------------------------------------------------------------------ *
 * the palette four
 * ------------------------------------------------------------------ */

/** a 12-bit colour split the way routines 69 and 70 split it, low nibble first */
const nibbles = (c: number): [number, number, number] => {
  // `move.b d0,d1 / andi.b #$f,d1` then `asr.l #$4,d0` twice; the shift is
  // ARITHMETIC, so a negative argument drags ones down from the top
  const b = c & 0x0f
  const g = (c >> 4) & 0x0f
  const r = (c >> 8) & 0x0f
  return [r, g, b]
}

/**
 * =Pal Grey(colour) — routine 69 ($308e).
 *
 * The one member of this family that is clean. It averages the three nibbles
 * with `divu.w #3` and rebuilds `avg * $111` with two `asl.w #4`, and because
 * d3 was cleared by `moveq` and never carries anything else, the high word
 * stays zero.
 */
export function iePalGrey(c: number): number {
  const [r, g, b] = nibbles(c)
  const sum = (r + g + b) & 0xffff
  const avg = divuW(sum, 3) & 0xffff
  let d3 = moveW(0, avg)
  let d0 = aslW(avg, 4)
  d3 = addW(d3, d0)
  d0 = aslW(d0, 4)
  return addW(d3, d0)
}

/**
 * The sepia ramp at workspace+$58, sixteen words.
 *
 * `$000 $100 $200 $310 $420 $531 $642 $753 $864 $975 $a86 $b97 $ca8 $db9
 * $eca $fdb` — red is the index, green two below it and blue four, each held
 * at zero rather than going negative. Generated, because sixteen words of
 * shipped data are a function with the working out thrown away.
 */
export function ieAntiqTable(): Int16Array {
  const t = new Int16Array(16)
  for (let i = 0; i < 16; i++) {
    t[i] = (i << 8) | (Math.max(0, i - 2) << 4) | Math.max(0, i - 4)
  }
  return t
}

/**
 * =Pal Antiq(colour) — routine 70 ($30c6).
 *
 * DEFECT: it returns the division's remainder in the high word. `divu.w #$3`
 * at $30e8 leaves the remainder in the top half of d3, `asl.w #$1` at $30ec
 * shifts only the bottom half, and `move.w (a0,d3.w),d3` at $30f6 overwrites
 * only the bottom half again. So a colour whose nibbles sum to a multiple of
 * three comes back clean and the other two thirds come back as $0001_0nnn or
 * $0002_0nnn.
 *
 * Invisible in the guide's own example, `Colour 0,Pal Antiq(Colour(0))`,
 * because Colour takes the low twelve bits. `Print Pal Antiq(...)` shows it.
 */
export function iePalAntiq(c: number, table: Int16Array): number {
  const [r, g, b] = nibbles(c)
  let d3 = moveW(0, r)
  d3 = addW(d3, b)
  d3 = addW(d3, g)
  d3 = divuW(d3 & 0xffff, 3)
  d3 = aslW(d3, 1)
  const idx = (d3 & 0xffff) >> 1
  return moveW(d3, table[idx & 0x0f] ?? 0)
}

/**
 * =Pal Negativ(colour) — routine 71 ($30fe), four instructions.
 *
 * DEFECT: two of them, and they compound.
 *
 * The routine never loads its argument. `sub.l (a3)+,d3` at $30fe SUBTRACTS
 * it from whatever d3 already held, where every other function in the
 * extension starts `moveq #$0,d3` or `move.l (a3)+,d3`. Taking d3 as zero on
 * entry, that leaves `0 - colour`, whose high word is $ffff for any colour
 * above zero.
 *
 * Then `not.w` and `andi.w #$fff` both work on the low word alone, so the
 * $ffff is still there when AMOS reads the whole of d3 back. `Pal Negativ(5)`
 * is $ffff0004, which prints as -65532.
 *
 * And the low word is not the complement either: `not.w (0 - c)` is `c - 1`,
 * one short of the 4095 - c a negative wants. Black inverts to $fff correctly
 * and nothing else does. Feeding it straight to `Colour` as the guide's
 * example does hides both halves of this, because Colour masks to twelve bits
 * and being one off is not visible on screen.
 */
export function iePalNegativ(c: number, d3In = 0): number {
  let d3 = (d3In - c) | 0
  d3 = notW(d3)
  return andiW(d3, 0xfff)
}

/** =Pal Filter(colour,filter) — routine 243 ($4b26): `and.w`, and nothing else */
export function iePalFilter(c: number, filter: number): number {
  return ((c & ~0xffff) | (c & filter & 0xffff)) | 0
}

/* ------------------------------------------------------------------ *
 * arithmetic
 * ------------------------------------------------------------------ */

/**
 * =Int Sqr(n) — routine 276 ($50ac).
 *
 * The classic bit-pair square root: d2 walks $40000000 down to 1 by `asr.l
 * #$2`, and each step tests whether the running answer plus that bit still
 * fits. Sixteen iterations, no division, and a final `cmp.l d3,d0` that rounds
 * up when the remainder has reached the root.
 *
 * DEFECT: `ext.l d3` at $50ce sign-extends the low word, so a root of 32768
 * or more comes back negative. `Int Sqr(1073741824)` is 32768 and answers
 * -32768. Roots below that are unaffected, which is every argument up to
 * 1,073,676,289.
 *
 * The rounding step fires at zero too: with the remainder and the root both
 * zero the `blt` does not take, so `Int Sqr(0)` is 1. `Wb Distance` inherits
 * it and reports two identical points as one apart.
 */
export function ieIntSqr(n: number): number {
  let d0 = n | 0
  let d3 = 0
  let d2 = 0x40000000
  while (d2 !== 0) {
    const d4 = (d3 + d2) | 0
    d3 = d3 >> 1
    if (d0 > d4) {
      d0 = (d0 - d4) | 0
      d3 = d3 | d2
    }
    d2 = d2 >> 2
  }
  if (d0 >= d3) d3 = (d3 + 1) | 0
  return lo(d3) // ext.l
}

/**
 * =Wb Distance(x1,y1 To x2,y2) — routine 257 ($4d04).
 *
 * `Int Sqr(dx*dx + dy*dy)`, with a detour: the routine opens
 * `mathtrans.library` and caches the base at workspace+$4, then never calls
 * it. The two squares go through mathffp `SPFlt`, `SPAdd` and `SPFix`
 * (`$2c4(a5)`, AMOS's own maths base, which it borrows by overwriting a5) and
 * come back as the integer they started as. Then `Rbsr` into routine 276.
 *
 * Both differences are squared with `muls.w`, so only their low words count.
 */
export function ieDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dy = Math.imul(lo(y1 - y2), lo(y1 - y2))
  const dx = Math.imul(lo(x1 - x2), lo(x1 - x2))
  return ieIntSqr((dx + dy) | 0)
}

/**
 * =Wb Depth To Colour(depth) — routine 316 ($58e4).
 *
 * `bset` every bit from depth-1 down to 0 and add one, which is 2^depth.
 *
 * A depth of 0 does not answer 1. d2 starts at -1, the `dbra` runs 65,536
 * times rather than none, and `bset` takes its bit number modulo 32, so every
 * bit of d3 ends up set and the `addq` wraps it to zero.
 */
export function ieDepthToColour(depth: number): number {
  let d3 = 0
  let d2 = lo(depth - 1)
  for (;;) {
    d3 = (d3 | (1 << (d2 & 31))) | 0
    if (d2 === 0) break
    d2 = lo(d2 - 1)
    if (d2 === -1) break
  }
  return (d3 + 1) | 0
}

/* ------------------------------------------------------------------ *
 * strings
 * ------------------------------------------------------------------ */

/** the digits at $36c4, which the linear disassembler reads as instructions */
const HEX = '0123456789ABCDEF'

/**
 * =Wb Fast Hex(n) — routine 112 ($36a4). Eight hex digits, most significant
 * first, built by `rol.l #$4` and a table lookup.
 *
 * DEFECT: it writes nine characters into an eight-character string. `dbeq d1`
 * at $36bc counts a d1 loaded from the allocated string's own length word, so
 * the body runs length+1 times, and the ninth `move.b` lands one byte past the
 * text. The value is right because AMOS reports the length word, not the
 * bytes; the ninth character is the first one over again.
 *
 * The `dbeq` looks like it should stop at the first zero nibble, and does not:
 * the `move.b` that precedes it sets Z from the CHARACTER written, and no
 * character in the table is zero.
 */
export function ieFastHex(n: number): string {
  let d0 = n | 0
  let out = ''
  for (let i = 0; i < 8; i++) {
    d0 = ((d0 << 4) | (d0 >>> 28)) | 0 // rol.l #4
    out += HEX[d0 & 0x0f]
  }
  return out
}

/**
 * =Wb Encrypt(a$) — routine 164 ($3c38), and =Wb Decrypt(a$) — 165 ($3c5e).
 *
 * One `ror.b #$1` per byte, and one `rol.b #$1` to undo it. Not a cipher in
 * any useful sense; it is a rotation with no key, which is what the extension
 * offers and what a program using it will have written to disk.
 */
export function ieRotateBytes(s: string, right: boolean): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const b = s.charCodeAt(i) & 0xff
    out += String.fromCharCode(right ? ((b >>> 1) | (b << 7)) & 0xff : ((b << 1) | (b >>> 7)) & 0xff)
  }
  return out
}

/**
 * =Wb Tag(tag,data) — routine 259 ($4d72).
 *
 * A TagItem as an AMOS string: eight bytes, the tag then the data, so a
 * program can build a taglist by concatenation and hand the result to a
 * keyword that wants one.
 *
 * DEVIATION: the library keeps the pair in ten bytes of static storage at
 * $4d84 and returns its address, so two calls in flight share one buffer.
 * Here a string is a value and cannot be aliased, so the collision the 68000
 * version can produce has nowhere to happen.
 */
export function ieTag(tag: number, data: number): string {
  const put = (v: number): string =>
    String.fromCharCode((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
  return put(tag) + put(data)
}

/* ------------------------------------------------------------------ *
 * =What Is
 * ------------------------------------------------------------------ */

export interface WhatIsRule {
  /** `[offset, size in bytes, value]`, all of which must match */
  readonly when: readonly (readonly [number, number, number])[]
  /** the four-character code, `'self'` for the magic itself, or a field to echo */
  readonly code: number | 'self' | { field: number }
}

/**
 * Routine 22 ($268c), in order, first match winning.
 *
 * Seventy-two arms of `cmpi` and `bne` reading a file's first bytes, read out
 * of the binary rather than transcribed: sixty magic numbers is where a digit
 * goes wrong. Each returns a four-character code as a longword, and -1 when
 * nothing matches.
 *
 * Two arms are worth knowing about.
 *
 * DEFECT: the RIFF arm has no branch. $2944 compares offset 8 against `WAVE`
 * and $294c falls into `move.l #$57617665,d3` whatever the answer, so every
 * RIFF file is reported as a WAVE.
 *
 * And `TDDD` at offset 8 appears twice, at $29cc and again at $2b20. The
 * first echoes the field and the second returns the constant, so the second
 * can never run.
 */
export const IE_WHAT_IS: readonly WhatIsRule[] = [
  { when: [[1080, 4, 0x4d2e4b2e]], code: 0x53544d6f }, // "M.K." -> "STMo"
  { when: [[2, 2, 0x3f3]], code: 0x45584543 }, // an executable's hunk id -> "EXEC"
  { when: [[0, 4, 0x4d4d4431]], code: 0x4d656431 }, // "MMD1" -> "Med1"
  { when: [[0, 4, 0xffd8ffe0]], code: 0x4a504547 }, // JPEG SOI -> "JPEG"
  { when: [[0, 2, 0xe310], [48, 1, 0x1]], code: 0x49636e30 },
  { when: [[0, 2, 0xe310], [48, 1, 0x2]], code: 0x49636e31 },
  { when: [[0, 2, 0xe310], [48, 1, 0x3]], code: 0x49636e32 },
  { when: [[0, 2, 0xe310], [48, 1, 0x4]], code: 0x49636e33 },
  { when: [[0, 2, 0xe310], [48, 1, 0x5]], code: 0x49636e34 },
  { when: [[0, 2, 0xe310]], code: 0x49636e3f }, // a Workbench icon -> "Icn?"
  { when: [[0, 4, 0x33444731]], code: 0x47656f31 }, // "3DG1" -> "Geo1"
  { when: [[0, 4, 0x464f524d], [8, 4, 0x494c424d]], code: 0x49666650 }, // FORM ILBM
  { when: [[0, 4, 0x464f524d], [8, 4, 0x574f574f]], code: 0x49666654 },
  { when: [[0, 4, 0x464f524d], [8, 4, 0x43544c47]], code: 0x43617467 },
  { when: [[0, 4, 0x464f524d], [8, 4, 0x50524546]], code: 0x50726566 },
  { when: [[0, 4, 0x464f524d]], code: 0x4966663f }, // any other IFF -> "Iff?"
  { when: [[0, 4, 0x414d4f53], [4, 4, 0x2050726f]], code: 0x4150726f }, // "AMOS Pro"
  { when: [[0, 4, 0x414d4f53], [4, 4, 0x20426173]], code: 0x41426173 }, // "AMOS Bas"
  { when: [[0, 4, 0x414d4f53]], code: 0x413f3f3f },
  { when: [[0, 4, 0x50503230]], code: 0x50504461 }, // "PP20" -> "PPDa"
  { when: [[0, 4, 0x416d5370]], code: 0x414d5370 }, // "AmSp"
  { when: [[0, 4, 0x414d4943]], code: 0x414d4943 }, // "AMIC"
  { when: [[0, 4, 0x416d426b], [12, 4, 0x4d656e75]], code: 0x41424d65 }, // AmBk Menu
  { when: [[0, 4, 0x416d426b], [12, 4, 0x4d757369]], code: 0x41424d75 },
  { when: [[0, 4, 0x416d426b], [12, 4, 0x576f726b]], code: 0x4142576b },
  { when: [[0, 4, 0x416d426b], [12, 4, 0x44617461]], code: 0x41424474 },
  { when: [[0, 4, 0x416d426b], [12, 4, 0x53616d70]], code: 0x41425370 },
  { when: [[0, 4, 0x416d426b], [12, 4, 0x5061632e]], code: 0x41506163 },
  { when: [[0, 4, 0x416d426b]], code: 0x41426b3f },
  { when: [[0, 4, 0x50445046]], code: 0x50447277 }, // "PDPF" -> "PDrw"
  { when: [[0, 4, 0x4d4d4430]], code: 0x4d656430 }, // "MMD0" -> "Med0"
  { when: [[2, 4, 0x2d6c6835]], code: 0x4c686135 }, // "-lh5" -> "Lha5"
  { when: [[2, 4, 0x2d6c6831]], code: 0x4c686131 },
  { when: [[0, 4, 0x50583230]], code: 0x50504372 }, // "PX20" -> "PPCr"
  { when: [[0, 4, 0x47494638], [4, 2, 0x3761]], code: 0x47696637 }, // GIF87a
  { when: [[0, 4, 0x47494638], [4, 2, 0x3961]], code: 0x47696639 }, // GIF89a
  { when: [[0, 4, 0x47494638]], code: 0x4769663f },
  { when: [[0, 2, 0x424d], [6, 4, 0x0], [28, 1, 0x1]], code: 0x424d5031 },
  { when: [[0, 2, 0x424d], [6, 4, 0x0], [28, 1, 0x4]], code: 0x424d5034 },
  { when: [[0, 2, 0x424d], [6, 4, 0x0], [28, 1, 0x8]], code: 0x424d5038 },
  { when: [[0, 4, 0x52494646]], code: 0x57617665 }, // every RIFF, WAVE or not
  { when: [[0, 4, 0x4d746864]], code: 0x4d494449 }, // "MThd" -> "MIDI"
  { when: [[0, 4, 0xd7cdc69a]], code: 0x2e574d46 }, // -> ".WMF"
  { when: [[0, 4, 0x57617270]], code: 'self' }, // "Warp"
  { when: [[0, 4, 0x5a4f4f4d]], code: 'self' }, // "ZOOM"
  { when: [[0, 4, 0x504b0304]], code: 0x2e5a4950 }, // -> ".ZIP"
  { when: [[0, 4, 0x5041434b]], code: 0x53545367 }, // "PACK" -> "STSg"
  { when: [[0, 4, 0xa050108]], code: 0x2e504358 }, // -> ".PCX"
  { when: [[0, 4, 0x474c424c]], code: 0x4d506c6e }, // "GLBL" -> "MPln"
  { when: [[8, 4, 0x54444444]], code: { field: 8 } }, // "TDDD"
  { when: [[0, 4, 0x44544844]], code: 0x44547970 }, // "DTHD" -> "DTyp"
  { when: [[0, 4, 0x414d504b]], code: 'self' }, // "AMPK"
  { when: [[0, 4, 0x89504e47]], code: 0x50474e20 }, // PNG -> "PGN " (the author's typo)
  { when: [[0, 4, 0x50504c53]], code: 0x50504c53 }, // "PPLS"
  { when: [[120, 4, 0xfe864cdf], [124, 4, 0x7fff4e75]], code: 0x50503430 },
  { when: [[0, 4, 0x40646174], [4, 4, 0x61626173]], code: 0x41476465 }, // "@database"
  { when: [[44, 2, 0x5346], [46, 1, 0x58]], code: 0x5346582e },
  { when: [[0, 4, 0xf7593647]], code: 0x54657846 },
  { when: [[0, 4, 0xf7020183]], code: 0x54657844 },
  { when: [[0, 4, 0x444d5321]], code: 0x444d532e }, // "DMS!" -> "DMS."
  { when: [[0, 4, 0x646a6721]], code: 0x4d444d50 },
  { when: [[0, 2, 0x35d2]], code: 0x4d444247 },
  { when: [[0, 4, 0x7231988]], code: 0x50504d2e },
  { when: [[0, 4, 0x4d454404]], code: 0x4d454434 }, // "MED\x04" -> "MED4"
  { when: [[0, 4, 0xa00], [4, 4, 0x0], [8, 4, 0x0], [12, 4, 0x8002e001]], code: 0x54617267 },
  { when: [[0, 2, 0x4d4d], [2, 2, 0x2a00]], code: 0x54696647 }, // TIFF, big endian
  { when: [[0, 2, 0x4d4d]], code: 0x5469663f },
  { when: [[8, 4, 0x54444444]], code: 0x54444444 }, // unreachable; see the header
  { when: [[0, 4, 0x59a66a95]], code: 0x53756e52 },
  { when: [[0, 4, 0x43414c42]], code: 0x43616c67 }, // "CALB" -> "Calg"
  { when: [[0, 4, 0x1f8b0800]], code: 0x475a6970 }, // gzip -> "GZip"
  { when: [[0, 4, 0x41470100]], code: 0x474c416e },
]

/** what routine 22 answers for the bytes at an address; -1 when nothing matches */
export function ieWhatIs(read: (at: number, size: number) => number): number {
  for (const rule of IE_WHAT_IS) {
    let ok = true
    for (const [at, size, want] of rule.when) {
      if (read(at, size) !== (want >>> 0)) {
        ok = false
        break
      }
    }
    if (!ok) continue
    if (rule.code === 'self') return read(0, 4) | 0
    if (typeof rule.code === 'object') return read(rule.code.field, 4) | 0
    return rule.code | 0
  }
  return -1
}

/* ------------------------------------------------------------------ *
 * =Wb Date
 * ------------------------------------------------------------------ */

/** `move.l #$7ba,d1` at $3fe8 — AmigaDOS counts days from 1 January 1978 */
export const IE_DATE_EPOCH_YEAR = 1978

/**
 * =Wb Date — routine 181 ($3fd0), formatted as `DD/MM/YYYY`.
 *
 * DEFECT: it can only ever report January, February or March. The month
 * lengths at workspace+$1d2 are written as two LONGWORDS and then as BYTES:
 *
 *     00 00 00 1f  00 00 00 1c  1f 1e 1f 1e 1f 1f 1e 1f 1e 1f
 *     |--- 31 ---| |--- 28 ---| |- 31,30,31,30,31,31,30,31,30,31 -|
 *
 * and the loop at $403c reads them all with `move.l (a1)+`. January and
 * February come out right. The third read takes `1f 1e 1f 1e` as one
 * longword, 522,067,742 days, which no remaining day count can reach, so the
 * loop always stops there with the month at 3 and the day holding every day
 * left in the year. 31 December 1994 is "334/3/1994".
 *
 * The leap rule is a bare `andi.w #$3` on the year with no century
 * correction, the same one AMCAF's `Cd Year` has, so 2100 is wrong too.
 *
 * The day-of-week accumulator in d2 is dead: it is built across the year loop
 * and then overwritten by `move.l d1,d2` at $4054 with the year.
 */
export function ieDateString(days: number): string {
  let rest = days | 0
  let year = IE_DATE_EPOCH_YEAR
  for (;;) {
    const leap = (year & 3) === 0 ? 1 : 0
    if (rest - leap - 365 < 0) break
    rest = rest - leap - 365
    year = (year + 1) & 0xffff
  }
  const leap = (year & 3) === 0 ? 1 : 0
  // the month walk: 31, then 28 plus the leap day, then a longword that ends it
  let month = 1
  let day = rest
  if (day - 31 >= 0) {
    day -= 31
    month = 2
    if (day - (28 + leap) >= 0) {
      day -= 28 + leap
      month = 3
      // the third entry is $1f1e1f1e; nothing reaches it
    }
  }
  day += 1
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`)
  return `${pad(day)}/${pad(month)}/${year}`
}

/* ------------------------------------------------------------------ *
 * the keywords
 * ------------------------------------------------------------------ */

/**
 * The modelled machine, as the rest of the port already answers for it.
 *
 * AMCAF's `Cpu` reports 68020 and its `Fpu` zero; the screens are AGA. The
 * guide's own tables name the values these four keywords give for that
 * machine: "53 - AA Alice PAL" and "8 - AA Lisa", a CPU of "40, 30, 20, 10 ou
 * 0", and a maths coprocessor of "881 ou 882" with the example treating a
 * zero as none fitted.
 */
export const IE_SYS_AGNUS = 53
export const IE_SYS_CHIP = 8
export const IE_SYS_CPU = 20
export const IE_SYS_MATH = 0
/** ExecBase+$212 and +$213 on a PAL machine, which is what beamcon0 models */
export const IE_VBL_FREQ = 50
export const IE_POWER_FREQ = 50
/**
 * IntuitionBase's LIB_VERSION, which is all `Sys Kickstart` compares against.
 *
 * 40 because ../amiga/exec.ts models `lowlevel.library` at version 40, and
 * lowlevel 40 is Kickstart 3.1. There is no OS version constant on the
 * machine yet; when there is, this should read it rather than restate it.
 */
export const IE_KICKSTART_VERSION = 40

export function makeIntuiextendSysInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): IntuiextendState => rt.intuiextend

  const word = (at: number): number => {
    const m = rt.resolveWrite(at >>> 0)
    if (!m) return 0
    return ((((m.data[m.off] ?? 0) << 8) | (m.data[m.off + 1] ?? 0)) << 16) >> 16
  }
  const putWord = (at: number, v: number): void => {
    const m = rt.resolveWrite(at >>> 0)
    if (!m) return
    m.data[m.off] = (v >>> 8) & 0xff
    m.data[m.off + 1] = v & 0xff
  }
  const long = (at: number): number => {
    const l = rt.longsAt(at >>> 0, false)
    return l ? l.get(0) : 0
  }
  const putLong = (at: number, v: number): void => {
    const l = rt.longsAt(at >>> 0, true)
    if (l) l.set(0, v)
  }
  const byte = (at: number): number => {
    const m = rt.resolveAddr(at >>> 0)
    return m ? (m.data[m.off] ?? 0) : 0
  }
  const putByte = (at: number, v: number): void => {
    const m = rt.resolveWrite(at >>> 0)
    if (m) m.data[m.off] = v & 0xff
  }
  const two = (it: Parameters<Instr>[0]): [number, number] => {
    const a = it.evalInt()
    it.expect(',')
    return [a, it.evalInt()]
  }

  return {
    /** Adr Inc addr — routine 232 ($4a42): `addq.w #$1,(a0)`, a WORD */
    'adr inc'(it) {
      const a = it.evalInt()
      putWord(a, addW(word(a), 1))
    },
    /** Adr Dec addr — routine 234 ($4a50) */
    'adr dec'(it) {
      const a = it.evalInt()
      putWord(a, addW(word(a), -1))
    },
    /** Adr Add addr To n — routine 233 ($4a48): `add.w d0,(a0)` */
    'adr add'(it) {
      const a = it.evalInt()
      it.expect('to')
      putWord(a, addW(word(a), it.evalInt()))
    },
    /** Adr Sub addr To n — routine 235 ($4a56) */
    'adr sub'(it) {
      const a = it.evalInt()
      it.expect('to')
      putWord(a, addW(word(a), -it.evalInt()))
    },
    /** Adr Swap.b a To b — routine 236 ($4a5e) */
    'adr swap.b'(it) {
      const a = it.evalInt()
      it.expect('to')
      const b = it.evalInt()
      const t = byte(a)
      putByte(a, byte(b))
      putByte(b, t)
    },
    /** Adr Swap.w a To b — routine 237 ($4a6a) */
    'adr swap.w'(it) {
      const a = it.evalInt()
      it.expect('to')
      const b = it.evalInt()
      const t = word(a)
      putWord(a, word(b))
      putWord(b, t)
    },
    /** Adr Swap.l a To b — routine 238 ($4a76) */
    'adr swap.l'(it) {
      const a = it.evalInt()
      it.expect('to')
      const b = it.evalInt()
      const t = long(a)
      putLong(a, long(b))
      putLong(b, t)
    },

    /**
     * Switch Pal — routine 72 ($310a): `move.w #$20,$dff1dc`, BEAMCON0.
     * Personnal's `Set Pal` writes the same register with the same value.
     */
    'switch pal'() {
      rt.beamcon0 = 0x0020
    },
    /** Switch Ntsc — routine 73 ($3114): BEAMCON0 = 0 */
    'switch ntsc'() {
      rt.beamcon0 = 0x0000
    },
    /**
     * Switch 72 — routine 290 ($5572): BEAMCON0 = $80, which is VARVBLANK.
     * The keyword is named for the 72Hz VGA mode a productivity monitor
     * wants; the register write is all there is to it.
     */
    'switch 72'() {
      rt.beamcon0 = 0x0080
    },

    /**
     * Wb Locker n — routine 99 ($3526): `move.w d0,-$90(a5)`, one AMOS
     * variable and no other effect in the routine.
     */
    'wb locker'(it) {
      st().locker = lo(it.evalInt())
    },

    /** Str Free addr — routine 247 ($4bba): frees the block Str Store made */
    'str free'(it) {
      st().heap.freeMem(it.evalInt() >>> 0)
    },

    /** Wb Free Image addr — routine 102 ($35ee), the 20 bytes back, ignoring 0 */
    'wb free image'(it) {
      const a = it.evalInt()
      if (a !== 0) st().heap.freeMem(a >>> 0)
    },

    /**
     * Wb Setchip Rev n — routine 179 ($3f18), graphics `SetChipRev` at -$378.
     *
     * DEVIATION: the modelled machine is already AGA, so asking the graphics
     * library to promote itself has nothing to do. The request is recorded.
     */
    'wb setchip rev'(it) {
      st().chipRev = it.evalInt() | 0
    },

    /**
     * Wb Gauge P,CJ,CF,X1,Y1 To X2,Y2 — routine 242 ($4aba).
     *
     * Two `RectFill`s in the current AMOS RastPort, split at
     * `X1 + (X2 - X1) * P / 100`: the left part in CJ, from split+1 to X2 in
     * CF. The guide: "CJ,CF=Couleur de la jauge et du fond."
     *
     * Neither half is drawn when it would be empty — `cmp.w d0,d3 / bge` and
     * `cmp.w d2,d5 / blt` — so P=0 leaves the bar entirely in CF and P=100
     * entirely in CJ. The percentage goes through `mulu.w` and `divu.w #$64`
     * on words, so a bar wider than 655 pixels at a high percentage overflows
     * the divide.
     */
    'wb gauge'(it) {
      const p = it.evalInt()
      it.expect(',')
      const cj = it.evalInt()
      it.expect(',')
      const cf = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      const scr = rt.screen
      if (!scr) return
      const split = lo(lo(x1) + divuW((lo(x2) - lo(x1)) * lo(p), 100))
      if (lo(x1) < split) scr.rp.rectFill(lo(x1), lo(y1), split, lo(y2), lo(cj))
      if (lo(x2) >= split + 1) scr.rp.rectFill(split + 1, lo(y1), lo(x2), lo(y2), lo(cf))
    },

    /**
     * Quick Scroll x,y To w,h,dx,dy — routine 282 ($5426).
     *
     * `BltBitMapRastPort` at -$25e with minterm $c0, a straight copy, from the
     * current RastPort's own BitMap back into the RastPort at an offset. The
     * source rectangle is (x, y, w, h) and it lands at (x + dx, y + dy).
     *
     * The one keyword in this group the guide never mentions. Its argument
     * order is the routine's: `move.l (a3)+,d3` takes dy first, and the two
     * `add.w` at $5434 and $5438 are what make the destination relative.
     */
    'quick scroll'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect('to')
      const w = it.evalInt()
      it.expect(',')
      const h = it.evalInt()
      it.expect(',')
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      const scr = rt.screen
      if (!scr) return
      const bm = scr.rp.bitMap
      bltBitMap(bm, lo(x), lo(y), bm, lo(x) + lo(dx), lo(y) + lo(dy), lo(w), lo(h))
    },

    /**
     * Load Seg name$ — routine 23 ($2b76), dos `LoadSeg` at -$96.
     *
     * DEVIATION: this port has no 68000 to run a loaded segment on, so the
     * load is refused and the slot at workspace+$84 takes the -1 the routine
     * writes when `LoadSeg` returns zero. `Segment Base` then reports -1,
     * which is what a program checking for failure looks at.
     */
    'load seg'(it) {
      it.evalStr()
      st().segment = -1
    },
    /** Unload Seg base — routine 24 ($2ba0), `UnLoadSeg` at -$9c and the slot back to -1 */
    'unload seg'(it) {
      it.evalInt()
      st().segment = -1
    },

    /**
     * Set Taskpri task,pri — routine 38 ($2d22), exec `SetTaskPri` at -$12c.
     *
     * DEVIATION: one modelled task and no scheduler, so the priority is
     * recorded and the previous one handed back. Nothing here is preemptible
     * for it to matter to.
     */
    'set taskpri'(it) {
      const [, pri] = two(it)
      st().taskPri = lo(pri)
    },

    /**
     * Task Name name$ To task — routine 106 ($3638).
     *
     * `move.l a1,$a(a0)` — it points tc_Node.ln_Name at the AMOS string's
     * text and does not copy it, so the name lives exactly as long as the
     * string does.
     */
    'task name'(it) {
      const name = it.evalStr()
      it.expect('to')
      it.evalInt()
      st().taskName = name
    },

    /**
     * Wb Reset — routine 4 ($247a).
     *
     * A cold reboot. On Kickstart 2.0 or later (`cmpi.w #$24,$14(a6)`, a
     * LIB_VERSION of 36) it is `jmp -$2d6(ExecBase)`; below that the routine
     * does it by hand, walking back from $1000000 to the ROM's entry and
     * executing the 68000 `reset` instruction with the return address already
     * loaded.
     *
     * The seventh extension in the port to ship one of these, and the same
     * two techniques as the six ../amiga/machine.ts already lists. Recorded
     * on the machine and the program ENDS, which is what AMCAF's `Reset
     * Computer` does and for the reason given there: performing the reset
     * would mean building the Runtime that is being torn down.
     */
    'wb reset'(it) {
      rt.machine.requestReset('cold', 'wb reset')
      it.halt('ended')
      return 'jumped'
    },
  }
}

export function makeIntuiextendSysFunctions(rt: Runtime): Record<string, Func> {
  const st = (): IntuiextendState => rt.intuiextend
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0)) | 0
  const s0 = (a: Value[], n: number): string => str(a[n] ?? VS(''))

  const readAt = (base: number) => (at: number, size: number): number => {
    let v = 0
    for (let i = 0; i < size; i++) {
      const m = rt.resolveAddr((base + at + i) >>> 0)
      v = ((v << 8) | (m ? (m.data[m.off] ?? 0) : 0)) >>> 0
    }
    return v
  }

  return {
    /** =Pal Grey(colour) — routine 69 ($308e) */
    'pal grey': (_, a) => VI(iePalGrey(i0(a, 0))),
    /** =Pal Antiq(colour) — routine 70 ($30c6); see iePalAntiq for the high word */
    'pal antiq': (_, a) => VI(iePalAntiq(i0(a, 0), st().antiq)),
    /** =Pal Negativ(colour) — routine 71 ($30fe); see iePalNegativ for both defects */
    'pal negativ': (_, a) => VI(iePalNegativ(i0(a, 0))),
    /** =Pal Filter(colour,filter) — routine 243 ($4b26) */
    'pal filter': (_, a) => VI(iePalFilter(i0(a, 0), i0(a, 1))),

    /** =Int Sqr(n) — routine 276 ($50ac) */
    'int sqr': (_, a) => VI(ieIntSqr(i0(a, 0))),
    /** =Wb Distance(x1,y1 To x2,y2) — routine 257 ($4d04) */
    'wb distance': (_, a) => VI(ieDistance(i0(a, 0), i0(a, 1), i0(a, 2), i0(a, 3))),
    /** =Wb Depth To Colour(depth) — routine 316 ($58e4) */
    'wb depth to colour': (_, a) => VI(ieDepthToColour(i0(a, 0))),

    /** =Wb Fast Hex(n) — routine 112 ($36a4) */
    'wb fast hex': (_, a) => VS(ieFastHex(i0(a, 0))),
    /** =Wb Encrypt(a$) — routine 164 ($3c38), `ror.b #$1` a byte at a time */
    'wb encrypt': (_, a) => VS(ieRotateBytes(s0(a, 0), true)),
    /** =Wb Decrypt(a$) — routine 165 ($3c5e), `rol.b #$1` */
    'wb decrypt': (_, a) => VS(ieRotateBytes(s0(a, 0), false)),
    /** =Wb Tag(tag,data) — routine 259 ($4d72) */
    'wb tag': (_, a) => VS(ieTag(i0(a, 0), i0(a, 1))),

    /** =What Is(addr) — routine 22 ($268c), 72 arms and -1 for no match */
    'what is': (_, a) => VI(ieWhatIs(readAt(i0(a, 0)))),

    /**
     * =Search(start,end,byte) — routine 21 ($265e).
     *
     * A byte scan that returns the address BEFORE the match — `move.l a0,d3`
     * after the post-increment, then `subq.w #$1,d3`, which borrows within the
     * low word rather than the whole address. -1 when it reaches `end`.
     *
     * Two things the routine does that no synopsis would suggest. It writes
     * the low word of the address it has reached to COLOR00 ($dff180) on
     * every byte, so the background flickers through the search; and it tests
     * the left mouse button at $bfe001 each time round and, if it is down,
     * leaves by the SAME exit a match uses. A user resting on the button gets
     * an address back that matched nothing.
     *
     * DEVIATION: the flicker is one write here, of the last address examined,
     * rather than one per byte. What a program can read back afterwards is
     * the same value; what a person would have seen is not.
     *
     * DEVIATION: `start` equal to `end` answers -1 here. The routine's only
     * end test is `cmpa.l a1,a0` AFTER the post-increment has moved past the
     * first byte, so on the machine that call scans until it wraps or the
     * mouse is pressed. Reproducing a hang is not worth the fidelity.
     */
    search: (_, a) => {
      const start = i0(a, 0) >>> 0
      const end = i0(a, 1) >>> 0
      const want = i0(a, 2) & 0xff
      let at = start
      let found = -1
      while (at !== end) {
        const m = rt.resolveAddr(at)
        const b = m ? (m.data[m.off] ?? 0) : 0
        at = (at + 1) >>> 0
        if (b === want) {
          found = at | 0
          break
        }
        if (at === end) break
      }
      rt.copRegs.pal[0] = at & 0xfff
      if (found < 0) return VI(-1)
      return VI(((found & ~0xffff) | ((found - 1) & 0xffff)) | 0)
    },

    /** =Sys Agnus — routine 239 ($4a82), VPOSR bits 8-14 */
    'sys agnus': () => VI(IE_SYS_AGNUS),
    /** =Sys Chip — routine 231 ($4a30), the low nibble of DENISEID at $dff07d */
    'sys chip': () => VI(IE_SYS_CHIP),
    /** =Sys Cpu — routine 229 ($49e2), AttnFlags bits 3..0 mapped to 40/30/20/10/0 */
    'sys cpu': () => VI(IE_SYS_CPU),
    /** =Sys Math — routine 275 ($5088), AttnFlags bits 4 and 5 for 881 and 882 */
    'sys math': () => VI(IE_SYS_MATH),
    /**
     * =Sys Kickstart(version) — routine 230 ($4a12).
     *
     * Compares the argument with IntuitionBase's LIB_VERSION and answers the
     * sign of the difference: 0 equal, 1 when the machine is newer, -1 when
     * it is older. Not the version itself.
     */
    'sys kickstart': (_, a) => {
      const want = lo(i0(a, 0))
      return VI(
        IE_KICKSTART_VERSION === want ? 0 : IE_KICKSTART_VERSION > want ? 1 : -1,
      )
    },
    /** =Vbl Freq — routine 67 ($306e), ExecBase+$212 */
    'vbl freq': () => VI(IE_VBL_FREQ),
    /** =Power Freq — routine 68 ($3080), ExecBase+$213 */
    'power freq': () => VI(IE_POWER_FREQ),
    /**
     * =Shires — routine 27 ($2be0). `move.l #$20,d3`, a constant.
     *
     * Not a test of anything: the routine reads no register and takes no
     * argument. $20 is the BEAMCON0 PAL bit, the same value `Switch Pal`
     * writes.
     */
    shires: () => VI(0x20),

    /** =My Task — routine 17 ($25da), the task pointer AMOS keeps at -$1c(a5) */
    'my task': () => VI(st().task),

    /**
     * =Wb Open — routine 14 ($25a6), intuition `OpenWorkBench` at -$d2, and
     * =Wb Close — routine 15 ($25b8), `CloseWorkBench` at -$4e.
     *
     * Both hand the library's own return value straight back: a Screen
     * pointer or zero from the first, a success flag from the second. The
     * guide names them WBPTR and SUCCES.
     */
    'wb open': () => VI(rt.intuition.openWorkBench() | 0),
    'wb close': () => VI(rt.intuition.closeWorkBench() ? 1 : 0),

    /**
     * =Wb Depth(rp) — routine 273 ($5062).
     *
     * `tst.l (a0)` is the RastPort's Layer, and a RastPort with none answers
     * zero rather than reading on. Otherwise `movea.l $4(a0),a0` is
     * rp_BitMap and `move.b $5(a0),d3` is bm_Depth.
     *
     * DEVIATION: RastPorts are objects here and not addresses, so the only
     * one this can answer for is the current AMOS screen's. Any other
     * argument reads no structure and gives zero, which is what the Layer
     * test gives for anything that is not a live RastPort.
     */
    'wb depth': (_, a) => {
      const rp = i0(a, 0)
      const scr = rt.screen
      if (rp === 0 || !scr) return VI(0)
      return VI(scr.rp.bitMap.depth)
    },

    /**
     * =Wb Bob Image(bob) — routine 101 ($3590).
     *
     * Wraps one image of the Bob bank in a 20-byte Intuition Image so it can
     * be handed to a gadget or a menu. The bank's image blocks are
     * `widthWords, height, depth, hotX, hotY` and then the planar data, which
     * is why the routine reads `(a2)`, `$2(a2)` and `$4(a2)` and points
     * ImageData at `a2 + $a`; the width is stored in words and `asl.w #$4`
     * turns it into pixels.
     *
     * PlanePick is 3 and PlaneOnOff is left at zero, so a two-plane image is
     * what this expects however deep the bob really is.
     *
     * Zero for a missing bank, a bob number of zero, or a failed allocation.
     */
    'wb bob image': (_, a) => {
      const n = i0(a, 0)
      const bank = rt.spriteBank
      if (!bank || n === 0) return VI(0)
      const img = bank.images[n - 1]
      if (!img) return VI(0)
      const addr = st().heap.alloc(IE_IMAGE_SIZEOF, { clear: true })
      if (addr === 0) return VI(0)
      const put16 = (at: number, v: number): void => {
        const m = rt.resolveWrite(at >>> 0)
        if (!m) return
        m.data[m.off] = (v >>> 8) & 0xff
        m.data[m.off + 1] = v & 0xff
      }
      put16(addr + 4, img.width) // already pixels; the routine's asl.w #$4
      put16(addr + 6, img.height)
      put16(addr + 8, img.depth)
      // ImageData points at the planar bytes inside the Bob bank, which is
      // `widthWords, height, depth, hotX, hotY` and then the data for each
      // image in turn -- the same block shape the routine walks
      let off = 2
      for (let i = 0; i < n - 1; i++) {
        const p = bank.images[i]
        if (!p) break
        off += 10 + (p.width >> 4) * 2 * p.height * p.depth
      }
      const l = rt.longsAt(addr + 10, true)
      if (l) l.set(0, (rt.bankBase(BOB_BANK) + off + 10) | 0)
      const m = rt.resolveWrite((addr + 14) >>> 0)
      if (m) m.data[m.off] = 3 // PlanePick
      return VI(addr | 0)
    },
    /** =Segment Base — routine 25 ($2bbe), workspace+$84 */
    'segment base': () => VI(st().segment),

    /**
     * =Wb Date — routine 181 ($3fd0); see `ieDateString` for the month table.
     *
     * DEVIATION: there is no calendar on this machine. Nothing sets a wall
     * clock and `defaultMeta` in ../amiga/vfs.ts stamps every file day 0, so
     * `DateStamp` answers the epoch and this answers 01/01/1978. The
     * formatting and the month defect are in `ieDateString`, which takes the
     * day count, so both are testable without one.
     */
    'wb date': () => VS(ieDateString(0)),

    /**
     * =Str Store(a$) — routine 246 ($4b82).
     *
     * Copies an AMOS string into an AllocMem block of length+3 bytes and
     * returns the block: the length word, the text, and a terminating zero,
     * so the result reads as a C string from base+2. -1 when the allocation
     * fails.
     */
    'str store': (_, a) => {
      const s = s0(a, 0)
      const addr = st().heap.alloc(s.length + 3, { clear: true })
      if (addr === 0) return VI(-1)
      const put = (at: number, v: number): void => {
        const m = rt.resolveWrite(at >>> 0)
        if (m) m.data[m.off] = v & 0xff
      }
      put(addr, (s.length >>> 8) & 0xff)
      put(addr + 1, s.length & 0xff)
      for (let i = 0; i < s.length; i++) put(addr + 2 + i, s.charCodeAt(i))
      return VI(addr | 0)
    },
  }
}
