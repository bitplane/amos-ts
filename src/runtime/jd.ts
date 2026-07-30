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
import { AmosError, VF, VI, VS, int, num, str, type Value } from '../interp/values'
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

  const sarg = (a: Value[], i: number): string => str(a[i]!)

  /**
   * THE STRING KEYWORDS SHARE ONE SHAPE, and it is worth stating once.
   *
   * An AMOS string is a length word, the bytes, then a NUL. Each routine
   * allocates a result with `getmem`, copies the length word across and fills
   * the body. When the input is empty, or the allocation fails, they jump to
   * `g_err` (equ 34, +|jd.s:2174) — which despite the name is not an error at
   * all: it calls `err_get` (equ 41, :2459) to copy the INPUT into a fresh
   * buffer and returns that. So the failure mode across this whole region is
   * "hand the argument back unchanged", never an AMOS error.
   */
  const unchangedOnEmpty = (v: string, f: (s: string) => string): string => (v === '' ? v : f(v))

  /**
   * Jd Compare's pattern engine (routine 3, +|jd.s:841), which Jd Find reuses.
   *
   * `fpattype` classifies the pattern by where its asterisks are and stores a
   * case word; `search` then runs one of six comparisons. It is not a general
   * glob — the classifier scans for the first `*` and at most one more, so
   * these six are the whole language:
   *
   *   *        all       anything matches
   *   xxx      one       the whole string, `?` matching any one character
   *   *xxx     suffix    ends with
   *   xxx*     prefix    starts with
   *   *xxx*    midfix    contains
   *   xxx*yyy  pre_suffix starts with xxx and ends with yyy
   *
   * A third asterisk is not special: pre_suffix copies everything after the
   * first `*` as the suffix, asterisks and all, and compares it literally.
   * `?` matches one character in every case (five comparison sites, :968-1049).
   */
  const litMatch = (text: string, pat: string): boolean => {
    if (text.length !== pat.length) return false
    for (let i = 0; i < pat.length; i++) if (pat[i] !== '?' && pat[i] !== text[i]) return false
    return true
  }
  const jdCompare = (text: string, pat: string): boolean => {
    const first = pat.indexOf('*')
    if (pat === '' || pat === '*') return true
    if (first < 0) return litMatch(text, pat)
    if (first === 0) {
      const rest = pat.slice(1)
      if (rest === '') return true
      const second = rest.indexOf('*')
      if (second < 0) {
        // *xxx — ends with
        return text.length >= rest.length && litMatch(text.slice(text.length - rest.length), rest)
      }
      // *xxx* — contains
      const mid = rest.slice(0, second)
      for (let i = 0; i + mid.length <= text.length; i++) {
        if (litMatch(text.slice(i, i + mid.length), mid)) return true
      }
      return false
    }
    const pre = pat.slice(0, first)
    const suf = pat.slice(first + 1)
    if (suf === '') return text.length >= pre.length && litMatch(text.slice(0, pre.length), pre)
    // xxx*yyy — both ends, and they may not overlap
    return (
      text.length >= pre.length + suf.length &&
      litMatch(text.slice(0, pre.length), pre) &&
      litMatch(text.slice(text.length - suf.length), suf)
    )
  }

  return {
    ...out,

    /**
     * =Jd Change$(s) — routine 13 (+|jd.s:1512). Swaps the case of every
     * A-Z/a-z by EOR #$20 and leaves everything else alone. Note it is a SWAP,
     * not an upper- or lower-casing: "Test" comes back "tEST".
     */
    'jd change$'(_, a): Value {
      return VS(
        unchangedOnEmpty(sarg(a, 0), (v) =>
          [...v].map((c) => (/[A-Za-z]/.test(c) ? String.fromCharCode(c.charCodeAt(0) ^ 0x20) : c)).join(''),
        ),
      )
    },

    /**
     * =Jd Firstup$(s) — routine 14 (+|jd.s:1551). Capitalises the first letter
     * of each word, and its idea of a word boundary is specific: after the
     * first character, it stays inside the word until a byte BELOW '0' or
     * ABOVE 'z' turns up (`nf2`, :1607). So a space, a comma or a full stop
     * starts a new word, but a colon, an `@` or a backslash does not — they
     * sit inside the '0'..'z' range. Only a lowercase letter is flipped, so an
     * already-capital initial is left as it is rather than being lowered.
     */
    'jd firstup$'(_, a): Value {
      return VS(
        unchangedOnEmpty(sarg(a, 0), (v) => {
          let out2 = ''
          let atWordStart = true
          for (const c of v) {
            const code = c.charCodeAt(0)
            if (atWordStart) {
              out2 += /[a-z]/.test(c) ? String.fromCharCode(code ^ 0x20) : c
              // a space keeps the next character a word start too
              atWordStart = c === ' '
              continue
            }
            out2 += c
            if (code < 0x30 || code > 0x7a) atWordStart = true
          }
          return out2
        }),
      )
    },

    /**
     * =Jd Skip$(s) — routine 15 (+|jd.s:1592). Strips leading and trailing
     * SPACES, byte $20 only: the loops compare against ' ' and nothing else,
     * so a tab survives at either end.
     */
    'jd skip$'(_, a): Value {
      return VS(unchangedOnEmpty(sarg(a, 0), (v) => v.replace(/^ +/, '').replace(/ +$/, '')))
    },

    /**
     * =Jd Cut$(s,pos,count) — routine 39 (+|jd.s:2346). Deletes `count`
     * characters from `pos` (1-based). The manual: Cut$("Test",2,2) = "Tt".
     *
     * `cutter` (:2362) clamps by decrementing the COUNT until pos+count-1
     * fits, so cutting past the end trims what is there rather than failing.
     * An empty string, a zero position or a zero count each return the input.
     */
    'jd cut$'(_, a): Value {
      const [v, pos] = [sarg(a, 0), int(a[1]!)]
      let count = int(a[2]!)
      if (v === '' || pos === 0 || count === 0) return VS(v)
      while (count > 0 && pos + count - 1 > v.length) count--
      return VS(v.slice(0, pos - 1) + v.slice(pos - 1 + count))
    },

    /**
     * =Jd Insert$(s,pos,ins) — routine 40 (+|jd.s:2400). Inserts before the
     * character at `pos`. The manual: Insert$("Tt",2,"es") = "Test".
     *
     * `inl0` (:2417) clamps the position down until it is at most len+1, so an
     * insert past the end appends. Empty target, empty insert or pos 0 return
     * the target unchanged.
     */
    'jd insert$'(_, a): Value {
      const [v, ins] = [sarg(a, 0), sarg(a, 2)]
      let pos = int(a[1]!)
      if (v === '' || ins === '' || pos === 0) return VS(v)
      if (pos > v.length + 1) pos = v.length + 1
      return VS(v.slice(0, pos - 1) + ins + v.slice(pos - 1))
    },

    /**
     * =Jd Paste$(s,find,replace) — routine 9 (+|jd.s:1382). Replaces EVERY
     * occurrence, not one: `palo` walks the string and `_instr` (:1438) either
     * emits the replacement and skips the match, or copies one character and
     * moves on. The manual: Paste$("Test","es","a") = "Tat".
     *
     * Because the skip is exactly the match length, replacements are not
     * rescanned — replacing "a" with "aa" terminates.
     */
    'jd paste$'(_, a): Value {
      const [v, find, rep] = [sarg(a, 0), sarg(a, 1), sarg(a, 2)]
      if (v === '' || find === '') return VS(v)
      let outStr = ''
      for (let i = 0; i < v.length; ) {
        if (v.startsWith(find, i)) {
          outStr += rep
          i += find.length
        } else {
          outStr += v[i]
          i++
        }
      }
      return VS(outStr)
    },

    /**
     * =Jd Extend$(s,len,kind) — routine 18 (+|jd.s:1714). Pads with spaces to
     * `len`: kind 0 centres, kind > 0 pads on the LEFT (right-justified) and
     * kind < 0 pads on the right. The manual's three examples pin all of it:
     * Extend$("Test",8,0) = "  Test  ", (…,1) = "    Test", (…,-1) = "Test    ".
     *
     * It only ever extends. A length not greater than the string returns the
     * string (`eerr`, :1740), so this cannot truncate.
     */
    'jd extend$'(_, a): Value {
      const v = sarg(a, 0)
      const want = int(a[1]!)
      const kind = int(a[2]!)
      if (v === '' || want <= v.length) return VS(v)
      const pad = want - v.length
      if (kind === 0) {
        // (want-len)/2 on the left by `lsr.l #1` — an odd remainder goes right
        const left = pad >> 1
        return VS(' '.repeat(left) + v + ' '.repeat(pad - left))
      }
      return VS(kind > 0 ? ' '.repeat(pad) + v : v + ' '.repeat(pad))
    },

    /**
     * =Jd Exval$(n,len[,pad$]) — routines 19 and 20 (+|jd.s:1810). The number
     * as a string, padded on the left to `len`. The manual: Exval$(12,4,"0") =
     * "0012".
     *
     * The three-argument form looks at the FIRST BYTE of pad$ only: '0' pads
     * with zeros, anything else with spaces (:1815).
     *
     * DEVIATION, and it is the original's: the two-argument form does not set
     * the pad at all — it branches straight into the shared routine, so it
     * inherits whatever the last three-argument call left behind, and on a
     * fresh library that is zero-padding. Reproducing a stale global across
     * calls would be faithful to a bug that no program can be relying on
     * deliberately; this uses the initial state ('0') for the two-argument
     * form every time, which is what a program sees unless it has already
     * asked for spaces.
     */
    'jd exval$'(_, a): Value {
      const n = int(a[0]!)
      const want = int(a[1]!)
      const padArg = a.length > 2 ? sarg(a, 2) : '0'
      const pad = padArg.startsWith('0') ? '0' : ' '
      const text = String(n)
      return VS(text.length >= want ? text : pad.repeat(want - text.length) + text)
    },

    /**
     * =Jd Rol$(s) and =Jd Ror$(s) — routines 49 and 48 (+|jd.s:2926, :2903).
     * One character round: Rol$ moves the first to the end, Ror$ the last to
     * the front.
     *
     * DEVIATION on the empty string. The routines do not check for one: Ror$
     * reads `(a0,d0.w)` with d0 = -1, which is the high byte of the length
     * word, and then runs a dbra from -2 — 65,535 iterations over whatever
     * follows. That is a crash, not a behaviour, so an empty string comes back
     * empty here.
     */
    'jd rol$'(_, a): Value {
      const v = sarg(a, 0)
      return VS(v.length < 2 ? v : v.slice(1) + v[0])
    },
    'jd ror$'(_, a): Value {
      const v = sarg(a, 0)
      return VS(v.length < 2 ? v : v[v.length - 1] + v.slice(0, -1))
    },

    /**
     * =Jd Count(s,find) — routine 8 (+|jd.s:1341). How many times `find`
     * appears in `s`, counting OVERLAPS: on a match it advances the search
     * position by one character (`ny`, :1364), not by the match length. So
     * Count("aaa","aa") is 2.
     */
    'jd count'(_, a): Value {
      const [v, find] = [sarg(a, 0), sarg(a, 1)]
      if (v === '' || find === '') return VI(0)
      let n = 0
      for (let i = 0; i + find.length <= v.length; i++) if (v.startsWith(find, i)) n++
      return VI(n)
    },

    /**
     * =Jd Compare(s,pattern) — routine 3 (+|jd.s:841). 1 when the pattern
     * fits. See jdCompare above for the six cases the classifier allows.
     */
    'jd compare'(_, a): Value {
      return VI(jdCompare(sarg(a, 0), sarg(a, 1)) ? 1 : 0)
    },

    /**
     * =Jd Linstr(s,find) — routine 82 (+|jd.s:3910). The position of the LAST
     * occurrence, 1-based, or 0. The manual: Linstr("tester","te") = 4.
     */
    'jd linstr'(_, a): Value {
      const [v, find] = [sarg(a, 0), sarg(a, 1)]
      if (v === '' || find === '') return VI(0)
      return VI(v.lastIndexOf(find) + 1)
    },

    /**
     * =Jd Ninstr(s,notfind[,pos]) — routines 155 and 156 (+|jd.s:6082). The
     * first position from `pos` whose character is NOT the first character of
     * `notfind`; 0 when there is none. The one-argument-shorter form pushes a
     * position of 1 and falls through, and a position of 0 is treated as 1
     * (`ninsok`, :6098).
     *
     * Only notfind's FIRST byte is used — `move.b (a1)+,d4` reads one
     * character and the loop compares against it, so "ab" and "az" behave
     * identically. An empty notfind answers 1, an empty string 0.
     */
    'jd ninstr'(_, a): Value {
      const [v, notFind] = [sarg(a, 0), sarg(a, 1)]
      let pos = a.length > 2 ? int(a[2]!) : 1
      if (pos === 0) pos = 1
      if (v === '') return VI(0)
      if (notFind === '') return VI(1)
      if (pos > v.length) return VI(0)
      const ch = notFind[0]
      for (let i = pos - 1; i < v.length; i++) if (v[i] !== ch) return VI(i + 1)
      return VI(0)
    },

    /**
     * =Jd Detab(s,width) — routine 139 (+|jd.s:5813). Replaces tabs with
     * enough spaces to reach the next multiple of `width`.
     */
    'jd detab'(_, a): Value {
      const v = sarg(a, 0)
      const width = Math.max(1, int(a[1]!))
      let outStr = ''
      for (const c of v) {
        if (c === '\t') outStr += ' '.repeat(width - (outStr.length % width))
        else outStr += c
      }
      return VS(outStr)
    },

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
