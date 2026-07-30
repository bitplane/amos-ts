/**
 * JD 5.3 / 5.9 — a general-purpose utility library by Joerg Dommermuth, 1993-94.
 * 130 keywords in 5.3, 133 in 5.9.
 *
 * ## Evidence: the author's own source
 *
 * `APD599/SOURCES/|jd.s` is the complete commented assembler, 122 KB, with a
 * label and a routine number per keyword (`L_per equ 61`, `L_reddim equ 148`).
 * It ships PowerPacked, which is why nothing had read it — `pp20Decrunch`
 * (../loader/powerpacker.ts) unpacks it, the same decruncher JD itself exposes
 * as `Jd Ppdecrunch`. The fixture keeps both: `jd.s` as distributed and
 * `jd.s.unpacked` derived from it, and every citation below is a line in the
 * unpacked file.
 *
 * Its header settles two things the manifest could not:
 *
 *   ; JD extension source code, V4.8  Last change 04.09.1993
 *   ; By Joerg Dommermuth
 *   ; This file is public domain
 *   ExtNb equ 22-1
 *
 * The SOURCE is public domain — that is the author's statement about this
 * file, not about the shipped binary, whose redistribution terms remain
 * unverified. And slot 22 comes from the author's own build rather than from
 * our fingerprinting of the corpus.
 *
 * There is also a per-keyword English manual (`JD_Manual.eng`: name,
 * parameters, function, result, syntax, example). Where the two disagree the
 * source wins, and the disagreements are recorded at the keyword.
 *
 * ## One port, two identities
 *
 * 5.9 renumbered the token table wholesale — 39 of the 47 ids the corpus uses
 * differ — but the VOCABULARY barely moved: five keywords added (`jd pattern`,
 * `jd dpath`, `jd cpu`, `jd chipset`, `jd fpu`) and two dropped (`jd compare`,
 * `jd screen resolution`). Dispatch is by name, so one implementation serves
 * both and the renumbering matters only to identification, which identify.ts
 * already handles.
 *
 * ## Argument order
 *
 * AMOS pushes arguments left to right and the routines pop them off, so the
 * FIRST pop is the LAST argument. `movem.l (a3)+,d0-d2` therefore loads d0
 * with the third argument, d1 with the second and d2 with the first. This is
 * easy to get backwards and the manual's own parameter lists are the check:
 * `Jd Limit(Z,Z1,Z2)` pops d0=Z2, d1=Z1, d2=Z, and tests d0 < d2 for "above
 * the top".
 *
 * ## Errors
 *
 * The library raises exactly two AMOS errors: 23 (Illegal function call) from
 * `L_outdim` (equ 150), which 26 call sites share for every out-of-range
 * argument, and 24 (Out of memory) from `L_nomem` (equ 100).
 */
import { AmosError, VF, VI, int, num, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import { decodeFFP } from '../tokens/stream'
import type { Runtime } from './runtime'

/**
 * The two errors the library raises, by AMOS error number (L_outdim equ 150,
 * L_nomem equ 100). Declared on the ExtensionImpl so the set is answerable
 * from the identity.
 */
export const JD_ERRORS = ['Illegal function call', 'Out of memory']

/** L_outdim (+|jd.s:6027): `moveq #23,d0` then L_Error — 26 call sites share it */
function outdim(): never {
  throw new AmosError('illegal function call', 23)
}

/**
 * The eight shift and rotate keywords are one routine shape (+|jd.s:3718-3800):
 *
 *   move.l (a3)+,d3      the VALUE  (second argument)
 *   move.l (a3)+,d2      the COUNT  (first argument)
 *   sub.l  #1,d2
 *   loop:  <op>.l #1,d3
 *          dbra d2,loop
 *
 * Two consequences worth being exact about, because both are reachable from
 * BASIC and neither is in the manual:
 *
 *  - A COUNT OF ZERO SHIFTS ONCE. `dbra` tests after decrementing, and the
 *    operation sits before it, so the body always runs at least once; with
 *    count 0 the pre-decrement makes d2 = -1 and the loop exits after that
 *    first shift.
 *  - The count is not masked. `lsl.l #1` thirty-three times really is
 *    thirty-three shifts, so a large count zeroes an lsl/lsr/asl and saturates
 *    an asr, where a single 68k `lsl.l #n,dn` would take n mod 64.
 */
function shiftLoop(count: number, value: number, step: (v: number, x: number) => [number, number]): number {
  let v = value | 0
  // `sub.l #1,d2` also sets X, which roxl/roxr rotate through: a count of 0
  // borrows and leaves X set, any other count clears it
  let x = count === 0 ? 1 : 0
  let n = count === 0 ? 1 : count
  // a negative count is a huge dbra loop on the real machine; refuse rather
  // than hang, which is the one place this cannot follow the 68k
  if (n < 0) outdim()
  while (n-- > 0) [v, x] = step(v, x)
  return v | 0
}

export function makeJdFunctions(rt: Runtime): Record<string, Func> {
  void rt
  const arg = (a: Value[], i: number): number => int(a[i]!)

  /** the four rotates and four shifts, in the order their routines appear */
  const shifts: Record<string, (v: number, x: number) => [number, number]> = {
    // rol.l #1: bit 31 wraps to bit 0 (routine 70, +|jd.s:3718)
    'jd rol': (v) => [((v << 1) | ((v >>> 31) & 1)) | 0, 0],
    // ror.l #1: bit 0 wraps to bit 31 (routine 71, :3728)
    'jd ror': (v) => [((v >>> 1) | (v << 31)) | 0, 0],
    // roxl.l #1: 33-bit rotate THROUGH X — X becomes bit 31, the old X the
    // new bit 0 (routine 72, :3738)
    'jd roxl': (v, x) => [((v << 1) | x) | 0, (v >>> 31) & 1],
    // roxr.l #1: the other way (routine 73, :3749)
    'jd roxr': (v, x) => [((v >>> 1) | (x << 31)) | 0, v & 1],
    // lsl/lsr are unsigned, asl is lsl, asr keeps the sign (74-77, :3760-3800)
    'jd lsl': (v) => [(v << 1) | 0, (v >>> 31) & 1],
    'jd lsr': (v) => [(v >>> 1) | 0, v & 1],
    'jd asl': (v) => [(v << 1) | 0, (v >>> 31) & 1],
    'jd asr': (v) => [v >> 1, v & 1],
  }
  const out: Record<string, Func> = {}
  for (const [name, step] of Object.entries(shifts)) {
    // spec 00,0 — =Jd Xxx(quantity, number), the manual's own parameter order
    out[name] = (_, a): Value => VI(shiftLoop(arg(a, 0), arg(a, 1), step))
  }

  return {
    ...out,

    /**
     * =Jd Limit(z,z1,z2) — routine 10 (+|jd.s:1464). 1 when z1 <= z <= z2.
     * `movem.l (a3)+,d0-d2` puts z2 in d0, z1 in d1 and z in d2; the tests are
     * `cmp.l d2,d0 / blt` (top below the value) and `cmp.l d2,d1 / bgt`
     * (bottom above it). The manual's example agrees: Limit(-3,-8,10) = 1.
     */
    'jd limit'(_, a): Value {
      const [z, z1, z2] = [arg(a, 0), arg(a, 1), arg(a, 2)]
      return VI(z2 < z || z1 > z ? 0 : 1)
    },

    /**
     * =Jd Odd(n) — routine 58 (+|jd.s:3190), and it answers 1 for an EVEN
     * number. The routine clears bit 0 and compares with the original: equal
     * means the bit was already clear, and THAT is the path returning 1. The
     * label on it reads `is_odd` and the manual's prose reads "0/1 =
     * even/odd", so two things say the opposite of what the code does — but
     * the manual's own example, `A=Jd Odd(2) -> A=1`, agrees with the code.
     * The source wins, and here it also has the example on its side.
     */
    'jd odd'(_, a): Value {
      return VI((arg(a, 0) & 1) === 0 ? 1 : 0)
    },

    /**
     * =Jd Percent(value,divisor) — routine 61 (+|jd.s:3306). value must be
     * 0..65535 and divisor 1..100, each bound its own error 23. The result is
     * value*divisor/100 computed in the Amiga's FFP library (jsr -36 to
     * convert, -84 to divide), so it is a FLOAT at FFP precision, not an
     * integer percentage.
     */
    'jd percent'(_, a): Value {
      const [value, divisor] = [arg(a, 0), arg(a, 1)]
      if (value > 65535 || value < 0 || divisor > 100 || divisor < 1) outdim()
      return VF(rt.interp.ffp((value * divisor) / 100))
    },

    /**
     * =Jd Imp(a,b) and =Jd Eqv(a,b) — routines 78 and 79 (+|jd.s:3803, :3838).
     *
     * Both are written as self-modifying loops that walk bit 31 down to 0 by
     * patching their own `btst #n` operand in place, which is a 1993 way of
     * saying "for each bit". Implication sets the result bit unless a is set
     * and b is clear; equivalence sets it when the two agree.
     */
    'jd imp'(_, a): Value {
      return VI((~arg(a, 0) | arg(a, 1)) | 0)
    },
    'jd eqv'(_, a): Value {
      return VI(~(arg(a, 0) ^ arg(a, 1)) | 0)
    },

    /**
     * =Jd Pi# and =Jd E# — routines 128 and 86 (+|jd.s:5502, :4163). Both are
     * a single `move.l #<constant>,d3` with d2=1 to mark the result a float,
     * and the constants are Motorola FFP words, not IEEE: $c90fdb42 and
     * $adf85442. Decoding them is what makes these agree with a real AMOS to
     * the last bit it can represent, where Math.PI would not.
     */
    'jd pi#'(): Value {
      return VF(decodeFFP(0xc90fdb42))
    },
    'jd e#'(): Value {
      return VF(decodeFFP(0xadf85442))
    },

    /**
     * =Jd Distance(x1,y1 To x2,y2) — routine 127 (+|jd.s:5470). Plain
     * Pythagoras: dy and dx are squared with SPPow against the FFP constant
     * $80000042 (2.0), summed and rooted.
     *
     * Both this and Arcus open mathtrans.library first and have a fallback for
     * when it is missing, which returns x1 unchanged (`no_math`, :5496). There
     * is no library to be missing here, so that path is unreachable rather
     * than unimplemented.
     */
    'jd distance'(_, a): Value {
      const [x1, y1, x2, y2] = [num(a[0]!), num(a[1]!), num(a[2]!), num(a[3]!)]
      return VF(rt.interp.ffp(Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)))
    },

    /**
     * =Jd Arcus(x1,y1 To x2,y2) — routine 129 (+|jd.s:5508). The angle from
     * the first point to the second, as a whole number of degrees.
     *
     * Implemented as the source computes it rather than as the geometry it is
     * reaching for, because the two are not quite the same thing:
     *
     *   dx = x2-x1, dy = y2-y1
     *   dy = 0            ->  90, or 270 when dx < 0        (a separate branch)
     *   deg = SPFix(atan(dx/dy) * 180/pi)                   ($e52f1a46 is 180/pi)
     *   deg < 0           ->  deg + 360
     *   deg += 180 when dy >= 0, 0 otherwise
     *   deg >= 360        ->  deg - 360
     *
     * WHICH WAY ROUND THE DIVISION GOES is the one thing the instruction
     * sequence alone does not settle — SPDiv takes its operands in d0 and d1
     * and the source loads dx into one and dy into the other. The structure
     * settles it: the dy = 0 case has a branch of its own, which is only
     * necessary if dy is the DIVISOR. So it is atan(dx/dy), and with that
     * reading straight up is 0 and straight down is 180, which is also the
     * only reading under which the two constants either side of the branch
     * mean anything.
     *
     * The branch and the formula still disagree for a horizontal line — the
     * formula's limit there is 270 where the branch says 90 — so the branch is
     * the author's own correction of his formula rather than a shortcut for
     * it. Reproduced as written, both halves.
     *
     * SPFix truncates toward zero, so 44.9 degrees is 44.
     */
    'jd arcus'(_, a): Value {
      const [x1, y1, x2, y2] = [arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3)]
      const dx = x2 - x1
      const dy = y2 - y1
      if (dy === 0) return VI(dx < 0 ? 270 : 90)
      let deg = Math.trunc(Math.atan(dx / dy) * (180 / Math.PI))
      if (deg < 0) deg += 360
      deg += dy >= 0 ? 180 : 0
      if (deg >= 360) deg -= 360
      return VI(deg)
    },
  }
}

export function makeJdInstructions(rt: Runtime): Record<string, Instr> {
  void rt
  return {}
}
