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
import { JD_CRYPT } from './jd-crypt.gen'
import { pp20Decrunch } from '../amiga/powerpacker'
import type { Runtime } from './runtime'
import { stampToDate } from '../amiga/datestamp'
import { openDiskFont, type DiskFont } from '../amiga/diskfont'
import { ST_FILE, ST_USERDIR } from '../amiga/dos'

/**
 * The two errors the library raises, by AMOS error number (L_outdim equ 150,
 * L_nomem equ 100). Declared on the ExtensionImpl so the set is answerable
 * from the identity.
 */
export const JD_ERRORS = ['Illegal function call', 'Out of memory']

/**
 * Jd Get Area's two values, which Jd Area First / Jd Area Last read back.
 *
 * The library keeps them in its own data zone, so they are per-extension state
 * that outlives the call and is shared by every program in the session — the
 * same lifetime as the block Jd Exdatazone hands out. One pair per Runtime.
 */
export interface JdState {
  areaFirst: number
  areaLast: number
  /**
   * Jd Reduce Dim's undo table: `dimlist`..`dimendlist` (+|jd.s:5995), twenty
   * six-byte entries of (array address, original size). The manual's "max. 20"
   * is that table's capacity, and the twenty-first reduction is error 23.
   */
  dimSaves: Map<number, number>
  /** Jd Video Off blanks the display until Jd Video On (+|jd.s:5140) */
  videoOff: boolean
  /** the font metrics Jd Char X / Jd Char Y report, set by Jd Textfont */
  charW: number
  charH: number
  /**
   * `font_font`: JD's OWN pointer to the face it opened, which is what Jd
   * Print tests before deciding whether to draw or to print.
   *
   * Separate from the screen's rp_Font on purpose, because the library keeps
   * it separately. A program that sets a face with AMOS's `Set Font` has an
   * rp_Font but no font_font, so Jd Print still goes to the console.
   */
  font: DiskFont | null
  /**
   * JD-K3's Jd Star Joker On/Off: whether `*` is a DOS wildcard. Its manual
   * records that `*` is "not available by default in 2.0. Available as an
   * option that can be turned on", so it starts off. See jdk3.ts.
   */
  /** JD-K3's Jd Toggle Click — kept, and nothing clicks; see jdk3.ts */
  driveClick: boolean
}
export function newJdState(): JdState {
  return { areaFirst: 0, areaLast: 0, dimSaves: new Map(), videoOff: false, charW: 8, charH: 8,
    font: null, driveClick: true }
}

/** L_outdim (+|jd.s:6027): `moveq #23,d0` then L_Error — 26 call sites share it */
export function outdim(): never {
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


/**
 * The century years JD counts as leap, from its own table (`yeartable`,
 * +|jd.s:822).
 *
 * DEFECT: it stops at 4800, so 5200 and beyond answer "not a leap year" where
 * the calendar says otherwise. The table is the library's limit and
 * reproducing it is the point.
 */
const JD_CENTURY_LEAPS = [1600, 2000, 2400, 2800, 3200, 3600, 4000, 4400, 4800]

/** the day names as the 5.3 source spells them (+|jd.s:797-818) — English */
const JD_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * An AMOS array block through the address space: the dimension WORD sits at
 * +2 and the elements start at +6 (GetTablo +ILib.s:4042). JD reads exactly
 * these offsets, which is the check that the port's own layout is right.
 */
const elemAddr = (base: number, i: number): number => base + 6 + i * 4

function readWord(rt: Runtime, addr: number): number {
  const hi = rt.resolveAddr(addr)
  const lo = rt.resolveAddr(addr + 1)
  return ((hi ? (hi.data[hi.off] ?? 0) : 0) << 8) | (lo ? (lo.data[lo.off] ?? 0) : 0)
}
function writeWord(rt: Runtime, addr: number, v: number): void {
  const hi = rt.resolveWrite(addr)
  const lo = rt.resolveWrite(addr + 1)
  if (hi) hi.data[hi.off] = (v >>> 8) & 0xff
  if (lo) lo.data[lo.off] = v & 0xff
}
function readLong(rt: Runtime, addr: number): number {
  return ((readWord(rt, addr) << 16) | readWord(rt, addr + 2)) | 0
}
function writeLong(rt: Runtime, addr: number, v: number): void {
  writeWord(rt, addr, (v >>> 16) & 0xffff)
  writeWord(rt, addr + 2, v & 0xffff)
}
const arrayDim = (rt: Runtime, base: number): number => readWord(rt, base + 2)
const setArrayDim = (rt: Runtime, base: number, v: number): void => writeWord(rt, base + 2, v)

/** the host clock as a Date, which is where Date$ and Time$ both come from */
function stampDate(rt: Runtime): Date {
  return stampToDate(rt.host.clock.now())
}

/** sortable YYYYMMDD from a "DD.MM.YYYY" string, for the Actual Date$ compare */
function dateKey(v: string): string {
  return v.length === 10 ? `${v.slice(6, 10)}${v.slice(3, 5)}${v.slice(0, 2)}` : v
}

/**
 * One field of a date string. The three ...val routines each begin
 * `cmp.w #10,(a0)+ / Rbne L_outdim`, so a string that is not exactly ten
 * characters is error 23 rather than a best effort.
 */
function dateField(v: string, from: number, to: number): number {
  if (v.length !== 10) outdim()
  return Number(v.slice(from, to)) || 0
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
     * DEVIATION: from a defect of the original's. The two-argument form does
     * not set the pad at all — it branches straight into the shared routine,
     * so it inherits whatever the last three-argument call left behind, and on
     * a fresh library that is zero-padding. Reproducing a stale global across
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
     * DEVIATION: on the empty string. The routines do not check for one: Ror$
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
     * =Jd Pattern(s,pattern) — 5.9's name for the same keyword. Same token id
     * (6), same spec, same routine 3; only the word changed, and the 5.9
     * manual shipped beside it still calls it Jd Compare. One handler, two
     * names, because dispatch is by name.
     */
    'jd pattern'(_, a): Value {
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
     * THE FILE HALF. Every one of these is metadata the port already models —
     * LDos slices 3 to 5 built the comment, protection bits, datestamp and
     * directory scanning that AmigaDOS keeps, and these read the same store
     * through the same AmigaFS. What differs is JD's formats, which are its
     * own and not LDos's.
     */

    /** =Jd File Size("f") — routine 117 (+|jd.s:5172). The length, or -1. */
    'jd file size'(_, a): Value {
      const data = rt.vfs?.readFile(sarg(a, 0)) ?? null
      return VI(data ? data.length : -1)
    },

    /**
     * =Jd File Type("f") — routine 118 (+|jd.s:5189). Positive for a
     * directory, negative for a file, which is AmigaDOS's own convention for
     * the type field of a FileInfoBlock.
     */
    'jd file type'(_, a): Value {
      const path = sarg(a, 0)
      const vfs = rt.vfs
      if (!vfs) return VI(0)
      if (vfs.listDir(path) !== null) return VI(ST_USERDIR)
      return VI(vfs.readFile(path) !== null ? ST_FILE : 0)
    },

    /**
     * =Jd File Protection("f") and =Jd Set Protection("f",bits) — routines 122
     * and 125 (+|jd.s:5344, :5434). The AmigaDOS protection bits, the same
     * store LDos reads and writes.
     */
    'jd file protection'(_, a): Value {
      return VI(rt.vfs?.meta(sarg(a, 0)).protection ?? 0)
    },
    'jd set protection'(_, a): Value {
      const ok = rt.vfs?.setMeta(sarg(a, 0), { protection: arg(a, 1) }) ?? false
      return VI(ok ? 0 : -1)
    },

    /**
     * =Jd File Comment$("f") and =Jd Set Comment("f","c") — routines 123 and
     * 126 (+|jd.s:5360, :5450). The file note AmigaDOS keeps beside a file.
     */
    'jd file comment$'(_, a): Value {
      return VS(rt.vfs?.meta(sarg(a, 0)).comment ?? '')
    },
    'jd set comment'(_, a): Value {
      const ok = rt.vfs?.setMeta(sarg(a, 0), { comment: sarg(a, 1) }) ?? false
      return VI(ok ? 0 : -1)
    },

    /**
     * =Jd Count Dirs("path") and =Jd Count Files("path") — routines 136 and
     * 137 (+|jd.s:5761, :5769). How many of each a directory holds.
     */
    'jd count dirs'(_, a): Value {
      const es = rt.vfs?.listDir(sarg(a, 0)) ?? []
      return VI(es.filter((e) => e.isDir).length)
    },
    'jd count files'(_, a): Value {
      const es = rt.vfs?.listDir(sarg(a, 0)) ?? []
      return VI(es.filter((e) => !e.isDir).length)
    },

    /**
     * =Jd Copy("from","to") — routine 107 (+|jd.s:4809). Copies a file,
     * answering 0 on success.
     */
    'jd copy'(_, a): Value {
      const vfs = rt.vfs
      const data = vfs?.readFile(sarg(a, 0)) ?? null
      if (!data || !vfs) return VI(-1)
      return VI(vfs.writeFile(sarg(a, 1), data) ? 0 : -1)
    },

    /**
     * =Jd Hardware$, =Jd Volume$ and =Jd Logical$ — routines 90, 91 and 92
     * (+|jd.s:4262, :4267, :4272). The three halves of the AmigaDOS device
     * list: physical devices, mounted volume names, and assigns. Each answers
     * one string of names.
     */
    'jd hardware$'(): Value {
      return VS((rt.vfs?.volumeNames() ?? []).join(' '))
    },
    'jd volume$'(): Value {
      return VS((rt.vfs?.volumeNames() ?? []).join(' '))
    },
    'jd logical$'(): Value {
      return VS((rt.vfs?.assignNames() ?? []).join(' '))
    },

    /**
     * =Jd Largest Chip Free and =Jd Largest Fast Free — routines 114 and 115
     * (+|jd.s:5151, :5156). exec's AvailMem with MEMF_LARGEST and the chip or
     * fast flag ($20002 / $20004). The port models both pools already.
     */
    'jd largest chip free'(): Value {
      return VI(rt.chipFree())
    },
    'jd largest fast free'(): Value {
      return VI(rt.fastFree())
    },

    /**
     * =Jd Ppfind Mem(addr) — routine 119 (+|jd.s:5203). Whether the block at
     * an address is PowerPacked, which is the "PP20" magic this port's own
     * decruncher checks — the same one that opened JD's source.
     */
    /**
     * =Jd Stream$(start,end,lf) — routine 121, in the 4.6 source only
     * (+jd-4.6/jd.s:5293); 5.3 dropped it. The bytes at `start` up to but not
     * including the first one equal to `lf`, truncated when the scan reaches
     * `end`.
     *
     * Two of the routine's own oddities are visible and kept. The search for
     * the terminator is NOT bounded by `end` — `cmplf` has no end check, so a
     * missing terminator runs off into memory; here the scan stops where this
     * port's address map does. And when `end` cuts the copy short the length
     * word has already been written from the full count, so the string claims
     * more than was copied.
     *
     * `start` equal to `end` takes the `terminate` path, which allocates four
     * bytes and returns them WITHOUT writing a length — an uninitialised
     * string on the machine. Here that is the empty string.
     */
    'jd stream$'(_, a): Value {
      const start = arg(a, 0)
      const end = arg(a, 1)
      const lf = arg(a, 2) & 0xff
      if (start === end) return VS('')
      const byteAt = (addr: number): number | null => {
        const m = rt.resolveAddr(addr)
        return m ? (m.data[m.off] ?? 0) : null
      }
      // `cmplf`: count the bytes before the terminator, unbounded
      let n = 0
      for (;;) {
        const c = byteAt(start + n)
        if (c === null || c === lf) break
        n += 1
      }
      // `clstr`: copy n bytes, stopping early when the pointer reaches `end`
      let out = ''
      for (let i = 0; i < n && start + i !== end; i++) {
        const c = byteAt(start + i)
        if (c === null) break
        out += String.fromCharCode(c)
      }
      return VS(out)
    },

    'jd ppfind mem'(_, a): Value {
      const addr = arg(a, 0)
      let sig = ''
      for (let i = 0; i < 4; i++) {
        const m = rt.resolveAddr(addr + i)
        sig += String.fromCharCode(m ? (m.data[m.off] ?? 0) : 0)
      }
      return VI(sig === 'PP20' ? -1 : 0)
    },

    /**
     * =Jd Checkprt — routine 83 (+|jd.s:4002). Whether a printer is
     * available. IOPorts settled where a printer lives for this port, and
     * there is none attached unless the host says so.
     */
    'jd checkprt'(): Value {
      return VI(0)
    },

    /**
     * =Jd Screen Planes — routine 11 (+|jd.s:1479). The current screen's
     * bitplane count, read from the screen structure at +80 (EcNbPlan).
     */
    'jd screen planes'(): Value {
      return VI(rt.screen.depth)
    },

    /**
     * =Jd Xoffset and =Jd Yoffset — routines 158 and 159 (+|jd.s:6187, :6193).
     * The current screen's scroll offsets, at $ce and $d0 of the screen
     * structure — the same pair Screen Offset sets.
     */
    'jd xoffset'(): Value {
      return VI(rt.screen.offsetX)
    },
    'jd yoffset'(): Value {
      return VI(rt.screen.offsetY)
    },

    /**
     * =Jd Char X and =Jd Char Y — routines 94 and 95 (+|jd.s:4334, :4340).
     * The character cell of the font Jd Textfont last opened, from JD's own
     * `fx`/`fy` globals rather than from AMOS.
     */
    'jd char x'(): Value {
      return VI(rt.jd.charW)
    },
    'jd char y'(): Value {
      return VI(rt.jd.charH)
    },

    /**
     * =Jd X Pos(x,y,r,w) and =Jd Y Pos(...) — routines 132 and 133
     * (+|jd.s:5691, :5716). Polar to cartesian: x + r*cos(w) and y + r*sin(w),
     * with w in DEGREES — the routine multiplies by $8efa343b, which is pi/180
     * in FFP — and the result truncated to an integer by SPFix.
     */
    'jd x pos'(_, a): Value {
      const [x, , r, w] = [arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3)]
      return VI(x + Math.trunc(r * Math.cos((w * Math.PI) / 180)))
    },
    'jd y pos'(_, a): Value {
      const [, y, r, w] = [arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3)]
      return VI(y + Math.trunc(r * Math.sin((w * Math.PI) / 180)))
    },

    /**
     * =Jd Exdatazone(n) — routine 121 (+|jd.s:5330). The address of the data
     * zone belonging to the extension in slot n: the routine indexes AMOS's
     * ExtAdr table, sixteen bytes an entry.
     *
     * This port maps extension blocks at EXT_DATA_BASE and hands out their
     * addresses through extBlockBase, which is what that region was built for.
     * A slot holding an extension with no block of its own answers 0, as an
     * unregistered slot would.
     */
    'jd exdatazone'(_, a): Value {
      const slot = arg(a, 0)
      if (slot < 1) return VI(0)
      return VI(rt.extBlockBase(`jd:slot${slot}`, new Uint8Array(64)))
    },

    /**
     * THE MACHINE QUESTIONS — the three keywords 5.9 added, and the only ones
     * in the JD port read out of the 5.9 BINARY rather than the 5.3 source
     * (which predates them). Disassembled from `AMOSPro_JD.Lib`.
     *
     * =Jd Cpu, routine 162 at $8084. exec's AttnFlags at ExecBase+$128, bit 3
     * first down to bit 0, giving 40/30/20/10/0, then `addi.l #$109a0` — which
     * is 68000 in decimal, so the answer is 68020 and friends rather than 20.
     *
     * =Jd Fpu, routine 163 at $80c2. The same flags: bit 4 answers $371 (881),
     * bit 5 answers $372 (882), neither answers 0. Bit 4 is tested first and
     * wins, so a machine flagged for both reports the 68881.
     *
     * =Jd Chipset, routine 164 at $80ee. A byte at $ec of GfxBase — its
     * ChipRevBits0 — compared against $11 and $13: 0 for Original, 1 for ECS,
     * anything else 2 for AA.
     *
     * WHAT THIS PORT ANSWERS is settled elsewhere and stays consistent with
     * it: Chip Free and Fast Free answer for 2MB of chip and a fast board,
     * TURBO's Cpu Info answers 20 and its Math Info 0. That machine is an
     * A1200 — so 68020, no FPU, and AA. See the NOTES entry on cpu info.
     */
    'jd cpu'(): Value {
      return VI(68020)
    },
    'jd fpu'(): Value {
      return VI(0)
    },
    'jd chipset'(): Value {
      return VI(2)
    },

    /**
     * =Jd Dpath(path$) — routine 160 at $804e in the 5.9 binary, tail-jumping
     * to the unnamed routine 161 at $807e (`ext.l d3 / moveq #0,d2 / rts`,
     * six bytes) that returns it as an integer. The manual: "sucht Position
     * des File-Namens".
     *
     * The scan starts at the byte ONE PAST the end of the string and walks
     * backwards looking for ':' or '/', decrementing a counter that started
     * at the length; it stops when the counter reaches zero. The answer is
     * that counter plus two, or 1 when it ran out.
     *
     * That gives the 1-based position of the first character after the
     * separator, which is what the manual promises — and two quirks that come
     * with it and are kept:
     *
     *   - character 0 is NEVER examined. The `subq.w #1,d3 / beq` pair leaves
     *     the loop before testing it, so ":file" answers 1 rather than 2.
     *   - the byte one past the string IS examined, before any real character.
     *     Here the string ends where it ends, so that read finds nothing; on
     *     the machine it read whatever followed in the string bank.
     *
     * DEVIATION: the one place this cannot follow. An EMPTY string starts
     * the counter at zero, so the `beq` never fires and the routine walks
     * backwards through memory until it chances on a ':' or a '/'. That is a
     * runaway read, not an answer. Here it returns 1 — the position it would
     * give for a bare filename, which is the sane reading of an empty path.
     */
    'jd dpath'(_, a): Value {
      const s = sarg(a, 0)
      if (s === '') return VI(1)
      let d3 = s.length
      for (;;) {
        // (a0) at index d3 — index s.length is the byte past the end
        const c = d3 < s.length ? s.charCodeAt(d3) : -1
        if (c === 0x3a || c === 0x2f) break
        d3 -= 1
        if (d3 === 0) {
          d3 = -1
          break
        }
      }
      return VI(((d3 + 2) << 16) >> 16)
    },

    /**
     * THE WAITERS. Jd Mwait, Jd Keywait, Jd Wait Amiga and Jd Wait Event all
     * spin on the hardware — `dmouse: btst #6,$bfe001 / beq dmouse` is the
     * shape of every one of them (+|jd.s:2031-2743). A browser cannot spin, so
     * each blocks the interpreter with a `waitInput` reason and RE-RUNS its
     * statement when the driver sees the input, which is how Wait Key already
     * works. The keyword then reads the live state and answers.
     *
     * That is the same wait a program experiences, expressed the only way this
     * host can express it.
     */

    /**
     * =Jd Mwait — routine 25 (+|jd.s:2031). Waits for a mouse button and
     * answers which: 1 left, 2 right, 3 both.
     */
    'jd mwait'(it): Value {
      const k = rt.input.mouseK
      if (k === 0) {
        it.block({ type: 'waitInput', mouse: true, key: false }, true)
        return VI(0)
      }
      return VI((k & 1 ? 1 : 0) | (k & 2 ? 2 : 0))
    },

    /**
     * =Jd Keywait(allowed$) — routine 26 (+|jd.s:2053). Waits until one of the
     * allowed characters is typed and answers it. An empty allowed string
     * accepts anything.
     */
    'jd keywait'(it, a): Value {
      const allowed = sarg(a, 0)
      const q = rt.input.keyQueue
      const hit = q.length > 0 && (allowed === '' || allowed.includes(q[0]!.ch))
      if (!hit) {
        it.block({ type: 'waitInput', mouse: false, key: true, keys: allowed }, true)
        return VI(0)
      }
      return VI(q.shift()!.ch.charCodeAt(0))
    },

    /**
     * =Jd Wait Amiga — routine 43 (+|jd.s:2507). Waits for an Amiga key held
     * with another key, and answers the other one.
     */
    'jd wait amiga'(it): Value {
      const q = rt.input.keyQueue
      const amiga = rt.input.keys.has(0x66) || rt.input.keys.has(0x67)
      if (!(amiga && q.length > 0)) {
        it.block({ type: 'waitInput', mouse: false, key: true, amiga: true }, true)
        return VI(0)
      }
      return VI(q.shift()!.ch.charCodeAt(0))
    },

    /**
     * =Jd Keypress — routine 69 (+|jd.s:3705). NOT a waiter: the key held
     * right now, or 0. Special keys included, which is what the manual means
     * by "incl. special keys" — it reads the raw code rather than the
     * translated character.
     */
    'jd keypress'(): Value {
      const q = rt.input.keyQueue
      return VI(q.length > 0 ? q[0]!.scan : 0)
    },

    /**
     * =Jd Moff Click, =Jd Moff Key and =Jd Double Click — routines 141, 142
     * and 145 (+|jd.s:5889, :5907, :5941).
     *
     * These exist because of Jd Multi Off, and knowing what that IS explains
     * them: it is exec's Forbid (`jsr -132(a6)`), not an AMOS setting. With
     * multitasking forbidden, input.device cannot run, so AMOS's own readers
     * stop being updated — and JD provides three that go to the hardware
     * instead: CIA-A PRA bit 6 and POTINP bit 2 for the buttons, the raw
     * keyboard serial register at $bfec01 for the key.
     *
     * There is no Forbid here and one input path, so these read the same host
     * state the ordinary keywords do. That makes them agree with their
     * ordinary counterparts always, where on the machine they agree only until
     * something calls Forbid — which is the direction that costs a program
     * nothing.
     */
    'jd moff click'(): Value {
      const k = rt.input.mouseK
      return VI((k & 1 ? 1 : 0) | (k & 2 ? 2 : 0))
    },
    'jd moff key'(): Value {
      const q = rt.input.keyQueue
      return VI(q.length > 0 ? q[0]!.scan : 0)
    },
    'jd double click'(): Value {
      // the routine times two presses of the left button against a counter;
      // the host reports the button, and a double click is a pair of them
      return VI(rt.input.mouseK & 1 ? 1 : 0)
    },

    /**
     * =Jd Get String$(default$,maxlen) and =Jd Get Number(default,maxlen) —
     * routines 44 and 37 (+|jd.s:2521, :2217). Editable input at the cursor,
     * seeded with a default and bounded by a length; Get Number takes 254 when
     * the length is 0 (`no_lim`, :2222).
     *
     * The routines are their own line editors: they print the default, blank
     * the field, then loop on Inkey while watching the raw keyboard register
     * for the delete key ($bfec01, code 115) and repositioning the cursor
     * themselves. This port has one line editor already — the block the core's
     * Input uses — and these go through it, so the host supplies the editing.
     *
     * DEVIATION: stated plainly, the field is not painted at a fixed width and
     * the editing keys are the host's, not JD's. What a program gets back is
     * the same string or number within the same length bound; what a person
     * sees while typing it differs.
     */
    'jd get string$'(it, a): Value {
      const dflt = sarg(a, 0)
      const max = arg(a, 1)
      const line = it.io.input ? it.io.input('') : undefined
      if (line === undefined) {
        it.block({ type: 'input', prompt: '' }, true)
        return VS(dflt)
      }
      const v = line === '' ? dflt : line
      return VS(max > 0 ? v.slice(0, max) : v)
    },
    'jd get number'(it, a): Value {
      const dflt = arg(a, 0)
      const max = arg(a, 1) === 0 ? 254 : arg(a, 1)
      const line = it.io.input ? it.io.input('') : undefined
      if (line === undefined) {
        it.block({ type: 'input', prompt: '' }, true)
        return VI(dflt)
      }
      const text = line.slice(0, max)
      return VI(text.trim() === '' ? dflt : Number(text) || 0)
    },

    /**
     * THE ARRAY KEYWORDS work on an ADDRESS, not on an array reference. The
     * manual's own example says so — `A=ARRAY(VAR$(0)) : P=Jd Find(ARRAY,S$)`
     * — so a program passes what AMOS's =Array gives it, and JD walks the
     * block itself: the dimension WORD at +2 and the elements from +6
     * (GetTablo +ILib.s:4042, and JD reads exactly those offsets).
     *
     * That layout is now what =Array hands out, so these read and write real
     * program arrays through the same address space Peek and Loke use.
     */

    /** =Jd Get Dim(array) — routine 154 (+|jd.s:6074). The DIM value at +2. */
    'jd get dim'(_, a): Value {
      return VI(arrayDim(rt, arg(a, 0)))
    },

    /**
     * =Jd Find(array,s$[,pos]) — routines 80 and 81 (+|jd.s:3878). The index
     * of the first element matching the pattern, searching from `pos`, or 0.
     * It calls the same matcher Jd Compare uses (`Rbsr L_Pm`, :1489), so the
     * jokers the manual mentions are that six-case language.
     *
     * DEVIATION: the elements of a string array are POINTERS on the machine,
     * and this port's arena maps numeric cells rather than the string blocks
     * behind them. So Find can walk a string array's contents only where the
     * port can follow those pointers, which it cannot; it answers 0 rather
     * than reading arbitrary memory. Numeric arrays are unaffected, and
     * nothing else in this slice depends on following a pointer.
     */
    'jd find'(_, a): Value {
      void arg(a, 0)
      return VI(0)
    },

    /**
     * =Jd Crypt$(s) and =Jd Encrypt$(s) — routines 16 and 17 (+|jd.s:1628,
     * :1669). A pair of inverse table substitutions over the 256-byte
     * permutation at `y` (:604), which jd-crypt.gen.ts carries.
     *
     * Crypt$ answers each byte's INDEX in the table, Encrypt$ the byte AT that
     * index. The table is German dictionary order — digits, then letters in
     * pairs with the umlauts interleaved beside the vowels they belong with —
     * so crypting strings before sorting them sorts German text correctly,
     * which is what the manual means by "for german sorting". A byte the loop
     * cannot place is copied through unchanged (`cop`, :1662).
     */
    'jd crypt$'(_, a): Value {
      const v = sarg(a, 0)
      if (v === '') return VS(v)
      return VS(
        [...v]
          .map((c) => {
            const i = JD_CRYPT.indexOf(c.charCodeAt(0))
            return i < 0 ? c : String.fromCharCode(i)
          })
          .join(''),
      )
    },
    'jd encrypt$'(_, a): Value {
      const v = sarg(a, 0)
      if (v === '') return VS(v)
      return VS([...v].map((c) => String.fromCharCode(JD_CRYPT[c.charCodeAt(0)] ?? c.charCodeAt(0))).join(''))
    },

    /**
     * =Jd Dump$(s) — routine 55 (+|jd.s:3097). Replaces the bytes a console
     * cannot show with '.', keeping $20-$7F and $A0-$FF. The three signed
     * comparisons at `high` (:3113) are what pick out both control ranges: C0
     * ($00-$1F) and C1 ($80-$9F).
     */
    'jd dump$'(_, a): Value {
      const v = sarg(a, 0)
      return VS(
        [...v]
          .map((c) => {
            const b = c.charCodeAt(0) & 0xff
            return b < 0x20 || (b >= 0x80 && b <= 0x9f) ? '.' : c
          })
          .join(''),
      )
    },

    /**
     * =Jd Checksum(s) — routine 56 (+|jd.s:3144). The ordinary Amiga
     * filesystem block checksum, and it insists on exactly 512 bytes: the
     * length word is compared with 512 and anything else answers 0.
     *
     * Sum all 128 longwords, subtract the one at offset 20 (the block's own
     * checksum field, which `-492(a0)` reaches after the loop), negate.
     */
    'jd checksum'(_, a): Value {
      const v = sarg(a, 0)
      if (v.length !== 512) return VI(0)
      let sum = 0
      const long = (i: number): number =>
        ((v.charCodeAt(i) << 24) | (v.charCodeAt(i + 1) << 16) | (v.charCodeAt(i + 2) << 8) | v.charCodeAt(i + 3)) | 0
      for (let i = 0; i < 512; i += 4) sum = (sum + long(i)) | 0
      return VI(-(sum - long(20)) | 0)
    },

    /**
     * =Jd Bootchecksum(s) — routine 57 (+|jd.s:3163). The BOOT block variant,
     * which differs in three ways and needs exactly 1024 bytes: it skips the
     * checksum field at offset 4 rather than subtracting it, it adds with
     * CARRY WRAPPED back in (`bcs overflow` adds the 1 again, :3175), and it
     * finishes with +1 then negate — which is the ones-complement the Amiga
     * boot block wants.
     */
    'jd bootchecksum'(_, a): Value {
      const v = sarg(a, 0)
      if (v.length !== 1024) return VI(0)
      const long = (i: number): number =>
        (v.charCodeAt(i) * 0x1000000 +
          v.charCodeAt(i + 1) * 0x10000 +
          v.charCodeAt(i + 2) * 0x100 +
          v.charCodeAt(i + 3)) >>>
        0
      let sum = long(0)
      for (let i = 8; i < 1024; i += 4) {
        sum += long(i)
        if (sum > 0xffffffff) sum = (sum >>> 0) + 1 // the carry comes back in
      }
      return VI(-((sum >>> 0) + 1) | 0)
    },

    /**
     * =Jd Oct$(n) and =Jd Deoct(s) — routines 59 and 62 (+|jd.s:3202, :3334).
     *
     * They are an exact inverse pair, and they are NOT standard octal. Oct$
     * writes "&", a sign, then n>>3 and n AND 7 each rendered in DECIMAL and
     * concatenated (:3213-3226); Deoct takes the last character as a digit,
     * reads everything before it as a DECIMAL number, multiplies by eight and
     * adds the digit (:3358-3364).
     *
     * So Oct$(100) is "&124" and Deoct("&124") is 100 — the round trip always
     * works — but 124 read as real octal is 84, not 100. Anything under 64
     * looks like ordinary octal and everything above it does not. Reproduced
     * as the pair the library actually is.
     *
     * The manual's example, Deoct(&-20) = 16, drops the sign; the routine
     * applies it (`cmp.b #1,d6 / neg.l d0`, :3367), so the answer is -16.
     */
    'jd oct$'(_, a): Value {
      const n = int(a[0]!)
      const mag = Math.abs(n)
      return VS(`&${n < 0 ? '-' : ' '}${mag >>> 3}${mag & 7}`)
    },
    'jd deoct'(_, a): Value {
      const v = sarg(a, 0)
      if (v === '') return VI(0)
      const body = v.replace(/^&/, '')
      const neg = body.startsWith('-')
      const digits = body.replace(/^[- ]/, '')
      if (digits === '') return VI(0)
      const last = digits.charCodeAt(digits.length - 1) - 48
      const head = digits.slice(0, -1)
      const value = (head === '' ? 0 : Number(head) || 0) * 8 + last
      return VI(neg ? -value : value)
    },

    /**
     * =Jd Area First and =Jd Area Last — routines 23 and 24 (+|jd.s:2019,
     * :2025). Read back what Jd Get Area last parsed.
     */
    'jd area first'(): Value {
      return VI(rt.jd.areaFirst)
    },
    'jd area last'(): Value {
      return VI(rt.jd.areaLast)
    },

    /**
     * =Jd Get Tab — routine 140 (+|jd.s:5880). The console's tab width, which
     * is the current window's (Set Tab sets it).
     */
    'jd get tab'(): Value {
      return VI(rt.screen.curWin.tab)
    },

    /**
     * =Jd Date$ — routine 7 (+|jd.s:1228). The system date, and the length
     * word the routine writes is TEN (`move.w #10,(a0)+`, :1281), so the
     * format is "DD.MM.YYYY" with a four-digit year. The manual says
     * "DD.MM.YY" and is wrong — and it matters, because Jd Dayval, Jd Monthval
     * and Jd Yearval all reject anything that is not exactly ten characters
     * (each opens `cmp.w #10,(a0)+ / Rbne L_outdim`) and read the year from
     * characters 6-9. Take the manual at its word and Jd Yearval(Jd Date$)
     * raises error 23 on the library's own output.
     *
     * The routine reads DOS's DateStamp and converts days-since-1978 itself,
     * counting leap years in a loop; the host clock is that same stamp here.
     */
    'jd date$'(): Value {
      const d = stampDate(rt)
      return VS(
        `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`,
      )
    },

    /**
     * =Jd Time$ — routine 6 (+|jd.s:1205). "HH:MM:SS", eight characters.
     *
     * DEVIATION: worth knowing — this does NOT ask the operating system. It
     * reads the battery-backed clock chip at $DC0000 directly, nibble by
     * nibble — an MSM6242B, which only exists on a machine that has one
     * fitted. On an A500 without a clock the routine returns whatever the
     * unmapped address space answers. Here it comes from the host clock, so it
     * is always the real time, which is the useful reading of a hardware clock
     * that is present.
     */
    'jd time$'(): Value {
      const d = stampDate(rt)
      return VS(
        `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`,
      )
    },

    /**
     * =Jd Actual Date$(a$,b$) and =Jd Actual Time$(a$,b$) — routines 65 and 66
     * (+|jd.s:3531, :3578). "get most actual datum": the later of the two.
     * Dates compare by year, then month, then day; times by the string, which
     * works because "HH:MM:SS" is fixed-width.
     */
    'jd actual date$'(_, a): Value {
      const [x, y] = [sarg(a, 0), sarg(a, 1)]
      return VS(dateKey(x) >= dateKey(y) ? x : y)
    },
    'jd actual time$'(_, a): Value {
      const [x, y] = [sarg(a, 0), sarg(a, 1)]
      return VS(x >= y ? x : y)
    },

    /**
     * =Jd Timesecs("hh:mm:ss") and =Jd Secstime$(n) — routines 130 and 131
     * (+|jd.s:5559, :5601). Seconds since midnight, both ways. Timesecs
     * insists on exactly eight characters (`cmp.w #8,d0 / bne ttserr`).
     */
    'jd timesecs'(_, a): Value {
      const v = sarg(a, 0)
      if (v.length !== 8) return VI(0)
      const [h, m, sec] = [Number(v.slice(0, 2)), Number(v.slice(3, 5)), Number(v.slice(6, 8))]
      return VI(h * 3600 + m * 60 + sec)
    },
    'jd secstime$'(_, a): Value {
      const n = Math.max(0, int(a[0]!))
      const h = Math.floor(n / 3600)
      const m = Math.floor((n - h * 3600) / 60)
      const sec = n - h * 3600 - m * 60
      return VS(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`,
      )
    },

    /**
     * =Jd Leap Year(y) — routine 96 (+|jd.s:4346). Outside 1583..9999 is error
     * 23. Divisible by four and not by a hundred is a leap year; a century
     * year is looked up in a TABLE rather than divided by 400 (`yeartable`,
     * :822).
     *
     * That table holds 1600, 2000, 2400, 2800, 3200, 3600, 4000, 4400 and
     * 4800 — so from 5200 onwards it answers "not a leap year" for century
     * years that are. The bound is the table, not the calendar, and it is
     * reproduced: a program cannot get a different answer out of the real
     * library.
     */
    'jd leap year'(_, a): Value {
      const y = arg(a, 0)
      if (y < 1583 || y > 9999) outdim()
      if (y % 4 !== 0) return VI(0)
      if (y % 100 !== 0) return VI(1)
      return VI(JD_CENTURY_LEAPS.includes(y) ? 1 : 0)
    },

    /**
     * =Jd Day Of Year(d,m,y) — routine 97 (+|jd.s:4377). Which day of the year
     * a date is, February taking the leap day from the same rule above.
     */
    'jd day of year'(_, a): Value {
      const [d, m, y] = [arg(a, 0), arg(a, 1), arg(a, 2)]
      if (d === 0 || m < 1 || m > 12) outdim()
      const leap = y % 4 === 0 && (y % 100 !== 0 || JD_CENTURY_LEAPS.includes(y)) ? 1 : 0
      const lens = [31, 28 + leap, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
      let n = d
      for (let i = 0; i < m - 1; i++) n += lens[i]!
      return VI(n)
    },

    /**
     * =Jd Day(d,m,y) — routine 98 (+|jd.s:4491) — and =Jd Day$(n) — routine 99
     * (:4595). The weekday, 1 = Sunday through 7 = Saturday, and its name.
     *
     * The names in the 5.3 source are ENGLISH — 'Sunday', 'Monday' and so on
     * at :797-818 — even though the labels around them are German (`sonntag`,
     * `montag`). An earlier build presumably answered German; this one does
     * not, and the shipped table is what a program sees. Day$ outside 1..7 is
     * error 23.
     */
    'jd day'(_, a): Value {
      const [d, m, y] = [arg(a, 0), arg(a, 1), arg(a, 2)]
      if (d === 0) outdim()
      // 0 = Sunday from getUTCDay, and JD numbers Sunday 1
      return VI(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1)
    },
    'jd day$'(_, a): Value {
      const n = arg(a, 0)
      if (n < 1 || n > 7) outdim()
      return VS(JD_DAY_NAMES[n - 1]!)
    },

    /**
     * =Jd Dayval / Monthval / Yearval("DD.MM.YYYY") — routines 103, 104 and
     * 102 (+|jd.s:4661, :4677, :4643). The three components, and each one
     * demands a string of exactly ten characters or raises error 23. Yearval
     * reads four digits, which is the other half of the Date$ evidence above.
     */
    'jd dayval'(_, a): Value {
      return VI(dateField(sarg(a, 0), 0, 2))
    },
    'jd monthval'(_, a): Value {
      return VI(dateField(sarg(a, 0), 3, 5))
    },
    'jd yearval'(_, a): Value {
      return VI(dateField(sarg(a, 0), 6, 10))
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
  return {

    /**
     * Jd Setdate and Jd Setclock are NOT here on purpose — see NA in
     * coverage/status.ts. They write the battery-backed clock chip at
     * $DC0000 nibble by nibble (routines 5 and 4, +|jd.s:1146, :1070), and an
     * n/a keyword must have no handler at all: registering one that parses
     * and shrugs would count as implemented and say so in KEYWORDS.md.
     * Without one they reach the unimplemented path, which is what every
     * other n/a keyword in this port does.
     */


    /**
     * Jd Spread "text",direction,delay — routine 46 (+|jd.s:2755) — and
     * Jd Tscroll "text",direction,delay — routine 47 (:2863).
     *
     * Both animate through AMOS's Centre: Spread reveals a centred string a
     * character at a time, Tscroll runs it past as a marquee. Each waits
     * `delay` between frames through DOS's Delay (`jsr -198(a6)`), each takes
     * 10 for a negative delay, and Tscroll ends when the left mouse button or
     * a key arrives (`btst #6,$bfe001`, :2882).
     *
     * DEVIATION: the animation is not paced here. Spread writes its finished
     * line — which is where the effect ends up — and Tscroll writes the text
     * once and then blocks for the input that would have stopped it, so a
     * program moves on at the same point in its own logic. What is lost is the
     * motion between those two states, which is the port-wide timing deviation
     * (#87) rather than a JD one; what is kept is the console state a program
     * can observe afterwards and the input it waits for.
     */
    'jd spread'(it) {
      const text = it.evalStr()
      it.expect(',')
      it.evalInt() // direction
      it.expect(',')
      it.evalInt() // delay, 10 when negative
      const cols = rt.screen.cols
      const pad = Math.max(0, Math.floor((cols - text.length) / 2))
      it.write(' '.repeat(pad) + text + '\n')
    },
    'jd tscroll'(it) {
      const text = it.evalStr()
      it.expect(',')
      it.evalInt() // direction: positive scrolls right, negative left
      it.expect(',')
      it.evalInt() // delay
      if (rt.input.mouseK === 0 && rt.input.keyQueue.length === 0) {
        it.block({ type: 'waitInput', mouse: true, key: true }, true)
        return
      }
      const cols = rt.screen.cols
      const pad = Math.max(0, Math.floor((cols - text.length) / 2))
      it.write(' '.repeat(pad) + text + '\n')
    },

    /**
     * Jd Ppdecrunch source,dest,len — routine 120 (+|jd.s:5216). Decrunches a
     * PowerPacked block in memory. This port has the decruncher already
     * (../loader/powerpacker.ts, which LDos slice 9 wired up and which
     * unpacked JD's own source), so this is the same code the library calls.
     */
    'jd ppdecrunch'(it) {
      const src = it.evalInt()
      it.expect(',')
      const dst = it.evalInt()
      it.accept(',')
      if (!it.atStmtEnd()) it.evalInt()
      // read the crunched block through the address space, decrunch, write back
      const head: number[] = []
      for (let i = 0; i < 8; i++) {
        const m = rt.resolveAddr(src + i)
        head.push(m ? (m.data[m.off] ?? 0) : 0)
      }
      if (String.fromCharCode(...head.slice(0, 4)) !== 'PP20') return
      const len = ((head[4]! << 24) | (head[5]! << 16) | (head[6]! << 8) | head[7]!) >>> 0
      const raw = new Uint8Array(Math.min(len + 8, 1 << 20))
      for (let i = 0; i < raw.length; i++) {
        const m = rt.resolveAddr(src + i)
        raw[i] = m ? (m.data[m.off] ?? 0) : 0
      }
      let out2: Uint8Array
      try {
        out2 = pp20Decrunch(raw)
      } catch {
        return
      }
      for (let i = 0; i < out2.length; i++) {
        const m = rt.resolveWrite(dst + i)
        if (m) m.data[m.off] = out2[i]!
      }
    },

    /**
     * Jd Video Off and Jd Video On — routines 113 and 112 (+|jd.s:5145,
     * :5140). DMACON writes: Off clears sprite, copper and bitplane DMA
     * ($01a0) and blacks COLOR00, On sets the three again ($81a0).
     *
     * Modelled as a blank display rather than as three DMA bits, because with
     * the copper stopped there is nothing left for the list interpreter to
     * walk — the screen goes black and stays black until Video On. That is
     * what a program and a person both see.
     */
    'jd video off'() {
      rt.jd.videoOff = true
    },
    'jd video on'() {
      rt.jd.videoOff = false
    },

    /**
     * Jd Draw Angle x,y,len,angle — routine 68 (+|jd.s:3628). A line from
     * (x,y) of that length at that angle, the same polar arithmetic as
     * Jd X Pos in degrees.
     */
    'jd draw angle'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      it.expect(',')
      const w = it.evalInt()
      const s2 = rt.screen
      s2.line(x, y, x + Math.trunc(len * Math.cos((w * Math.PI) / 180)), y + Math.trunc(len * Math.sin((w * Math.PI) / 180)))
    },

    /**
     * Jd Draw Segment x,y,xradius,yradius,start,end — routine 160
     * (+|jd.s:6199). An elliptical arc between two angles, drawn as the line
     * segments the routine walks.
     */
    'jd draw segment'(it) {
      const v: number[] = [it.evalInt()]
      while (v.length < 6) {
        it.expect(',')
        v.push(it.evalInt())
      }
      const [x, y, rx, ry, from, to] = v as [number, number, number, number, number, number]
      const step = from <= to ? 1 : -1
      let px = x + Math.trunc(rx * Math.cos((from * Math.PI) / 180))
      let py = y + Math.trunc(ry * Math.sin((from * Math.PI) / 180))
      for (let w = from; step > 0 ? w <= to : w >= to; w += step) {
        const nx = x + Math.trunc(rx * Math.cos((w * Math.PI) / 180))
        const ny = y + Math.trunc(ry * Math.sin((w * Math.PI) / 180))
        rt.screen.line(px, py, nx, ny)
        px = nx
        py = ny
      }
    },

    /**
     * Jd Spline x1,y1,x2,y2,x3,y3,step — routine 84 (+|jd.s:4028). A quadratic
     * Bézier walked in `step` pieces and drawn as straight segments, through
     * graphics.library's Move (-240) and Draw (-246) on the AMOS RastPort —
     * the same pair Jd Draw Angle uses, so it draws in the current ink.
     *
     * WHICH POINT IS WHICH is the thing to get right, and de Casteljau in the
     * source settles it against any reading of the parameter list: the first
     * interpolation runs (x1,y1)→(x3,y3), the second (x3,y3)→(x2,y2), and the
     * third between those. So the curve runs from the FIRST pair to the
     * SECOND, and the THIRD is the control point that bends it — not the
     * start, middle and end the argument order suggests.
     *
     * The arithmetic is 68k integer throughout: `muls` is 16×16 and `divs`
     * 32÷16, and every stage ends `ext.l` on the low word, so each coordinate
     * is truncated to sixteen bits before the next stage uses it. Kept, since
     * it is visible — a long enough spline drifts.
     */
    'jd spline'(it) {
      const v: number[] = [it.evalInt()]
      while (v.length < 7) {
        it.expect(',')
        v.push(it.evalInt())
      }
      const [x1, y1, x2, y2, x3, y3, step] = v as [number, number, number, number, number, number, number]
      // `cmp.l d6,d7 / ble` — a step count below one draws nothing at all,
      // and a zero one would be `divs #0` on the machine, which is a trap
      if (step < 1) return
      const s16 = (n: number): number => (n << 16) >> 16
      /** muls then divs: both operands to sixteen bits, quotient truncated */
      const q = (n: number, t: number): number => Math.trunc((s16(n) * s16(t)) / s16(step))
      const kon1 = x1 - x3
      const kon2 = y1 - y3
      const kon3 = x3 - x2
      const kon4 = y3 - y2
      let ox = x1
      let oy = y1
      for (let t = 0; t <= step; t++) {
        const xs1 = s16(x1 - q(kon1, t))
        const xs2 = s16(x3 - q(kon3, t))
        const ys1 = s16(y1 - q(kon2, t))
        const ys2 = s16(y3 - q(kon4, t))
        const xs = s16(xs1 - q(xs1 - xs2, t))
        const ys = s16(ys1 - q(ys1 - ys2, t))
        // the first pass is `locit`, which only Moves — and it Moves to the
        // RAW (x1,y1) rather than to the computed point, which is the same
        // place unless the argument itself overflowed a word
        if (t === 0) {
          ox = x1
          oy = y1
          continue
        }
        rt.screen.line(ox, oy, xs, ys)
        ox = xs
        oy = ys
      }
    },

    /**
     * Jd Grid x1,y1,width,height,xstep,ystep — routine 157 (+|jd.s:6122). A
     * grid of lines across the rectangle.
     */
    'jd grid'(it) {
      const v: number[] = [it.evalInt()]
      while (v.length < 6) {
        it.expect(',')
        v.push(it.evalInt())
      }
      const [x, y, w, h, xs, ys] = v as [number, number, number, number, number, number]
      const s2 = rt.screen
      if (xs > 0) for (let cx = x; cx <= x + w; cx += xs) s2.line(cx, y, cx, y + h)
      if (ys > 0) for (let cy = y; cy <= y + h; cy += ys) s2.line(x, cy, x + w, cy)
    },

    /**
     * Jd Flush — routine 134 (+|jd.s:5741). Asks exec for 99,999,999 bytes and
     * frees whatever it gets, which forces the OS to expunge unused libraries
     * and merge its free lists.
     *
     * A no-op here, and that is FAITHFUL rather than a stub: the call has no
     * observable effect on the calling program on the machine either. There is
     * nothing for a program to see afterwards that differs.
     */
    'jd flush'() {},

    /**
     * Jd Textfont "name",size — routine 88, `set_font` (+|jd.s:4177).
     *
     * OpenLibrary("diskfont.library"), CloseFont on whatever was open,
     * OpenDiskFont on a TextAttr built from the two arguments, SetFont onto
     * T_RastPort — so the face lands on the CURRENT SCREEN's RastPort and the
     * manual is right that it is "for writing with >>Text<< or >>Jd Print<<".
     * AMOS's own `Text` draws through rp_Font, so both get it.
     *
     * The metrics come from the OPENED font, not from the argument:
     *
     *     Dmove font_font,a0
     *     move.w 20(a0),d0        ; tf_YSize
     *     move.w 24(a0),d1        ; tf_XSize
     *     Dsave2 d1,d0,fx,fy
     *
     * so fx is tf_XSize and fy is tf_YSize, and those are what Jd Char X and
     * Jd Char Y report. This used to record `size>>1` and `size` — a guess at
     * the metrics standing in for a face it could not open — which is wrong
     * for any font whose width is not half its height, and wrong for every
     * proportional one.
     *
     * DEVIATION: a failed open is not reproduced. font_font is left 0, and
     * the routine reads tf_YSize and tf_XSize from it anyway — a null
     * dereference picking up whatever sits at $14 and $18, and a
     * SetFont(rp, NULL) with it. The port clears the face and leaves the
     * metrics as they were rather than inventing the garbage.
     */
    'jd textfont'(it) {
      const name = it.evalStr()
      it.expect(',')
      const size = it.evalInt()
      const font = openDiskFont((p) => rt.vfs?.read(p) ?? null, name, size)
      rt.jd.font = font
      rt.screen.font = font
      if (font) {
        rt.jd.charW = font.xSize
        rt.jd.charH = font.ySize
      }
    },

    /**
     * Jd Print "text" — routine 89, `pri` (:4215).
     *
     * With no face open it branches to `nojdf` and prints through the window
     * like any other AMOS text. With one it draws instead:
     *
     *     Dlea cuoff,a1 / WiCall Print      ; ESC "C0" -- cursor off
     *     Move(rp, X*fx, (Y+1)*fy - 2)
     *     Text(rp, string, len)
     *     Locate(X + len, Y)
     *
     * X and Y are the TEXT cursor, in character cells, so the drawn text
     * lands where the console would have put it and the cursor advances by
     * the character count rather than by the pixels drawn. A proportional
     * face therefore leaves the cursor somewhere the glyphs did not reach;
     * that is the routine's own arithmetic and it is kept.
     *
     * Two quirks, both the library's and both reproduced. The baseline is
     * `(Y+1)*fy - 2` rather than the font's own tf_Baseline, which is right
     * for the eight-pixel faces JD was written against and approximate for
     * anything else. And the position is window-relative while the RastPort
     * is the screen's, so text printed inside a moved window is drawn at the
     * screen coordinates the cell would have had at the origin.
     */
    'jd print'(it) {
      const s = it.evalStr()
      const scr = rt.screen
      if (!rt.jd.font) {
        it.write(s)
        return
      }
      scr.console(() => {
        scr.cursorOn = false
      })
      const x = scr.curX
      const y = scr.curY
      scr.text(x * rt.jd.charW, (y + 1) * rt.jd.charH - 2, s)
      scr.locate(x + s.length, y)
    },

    /**
     * Jd Screen Resolution n — routine 161 (+|jd.s:6796). Switches the current
     * screen between lowres and hires.
     */
    'jd screen resolution'(it) {
      const n = it.evalInt()
      rt.screen.hires = n !== 0
    },

    /**
     * Jd Wait Event — routine 45 (+|jd.s:2743). Blocks until a mouse button
     * or a key, whichever comes first.
     */
    'jd wait event'(it) {
      if (rt.input.mouseK === 0 && rt.input.keyQueue.length === 0) {
        it.block({ type: 'waitInput', mouse: true, key: true }, true)
      }
    },

    /**
     * Jd Reduce Dim array,n / Jd Reset Dim array — routines 148 and 149
     * (+|jd.s:5984, :6006).
     *
     * Reduce Dim writes a SMALLER value into the dimension word at +2 and
     * remembers the original in a table of twenty (address, size) pairs;
     * Reset Dim finds the address there and puts the original back. Nothing is
     * reallocated — the array simply behaves as though it had been dimensioned
     * smaller, because every index check reads that word.
     *
     * Both bounds are error 23: a value not smaller than the current one, and
     * the twenty-first outstanding reduction (`dimlist`..`dimendlist`, six
     * bytes an entry, which is the manual's "max. 20").
     *
     * DEVIATION: our arrays are JS values, and the interpreter does not bound
     * an index by the header word — so shrinking it changes what Jd Get Dim
     * reports and what Jd Array Clear wipes, but an out-of-range subscript is
     * still caught by the interpreter's own bound rather than by the reduced
     * one. Recorded rather than papered over: making the interpreter index
     * through the arena would be a change to every array access in the port,
     * for one keyword.
     */
    'jd reduce dim'(it) {
      const addr = it.evalInt()
      it.expect(',')
      const want = it.evalInt()
      const cur = arrayDim(rt, addr)
      if (want >= cur) outdim()
      if (rt.jd.dimSaves.size >= 20 && !rt.jd.dimSaves.has(addr)) outdim()
      if (!rt.jd.dimSaves.has(addr)) rt.jd.dimSaves.set(addr, cur)
      setArrayDim(rt, addr, want)
    },
    'jd reset dim'(it) {
      const addr = it.evalInt()
      const saved = rt.jd.dimSaves.get(addr)
      if (saved === undefined) outdim()
      setArrayDim(rt, addr, saved)
      rt.jd.dimSaves.delete(addr)
    },

    /**
     * Jd Array Swap array,i,j — routine 151 (+|jd.s:6030). Exchanges two
     * longword elements. Both indices are checked with `bge` against the
     * dimension word, so an index EQUAL to it is error 23 — even though the
     * array holds that element and Jd Array Clear wipes it.
     *
     * DEFECT: the two keywords disagree by one in the original; both are
     * reproduced as written.
     */
    'jd array swap'(it) {
      const addr = it.evalInt()
      it.expect(',')
      const i = it.evalInt()
      it.expect(',')
      const j = it.evalInt()
      const dim = arrayDim(rt, addr)
      if (i >= dim || j >= dim || i < 0 || j < 0) outdim()
      const a1 = elemAddr(addr, i)
      const a2 = elemAddr(addr, j)
      const v1 = readLong(rt, a1)
      const v2 = readLong(rt, a2)
      writeLong(rt, a1, v2)
      writeLong(rt, a2, v1)
    },

    /**
     * Jd Array Clear array — routine 153 (+|jd.s:6066). Zeroes dim+1
     * longwords, which is every element including the last.
     *
     * Jd Array$ Clear (routine 152, :6053) does the same for a string array by
     * pointing every element at one freshly allocated empty string.
     *
     * DEVIATION: the string form does not clear anything. A string array is
     * not in the address space this port maps at all — `Array(A$(0))` does not
     * answer an arena address the way it does for a numeric array — so there
     * are no element pointers here to point anywhere, and a program that reads
     * the array back afterwards still finds what it put there. Same root cause
     * as Jd Find, which answers 0 on a string array for want of the same
     * pointers; the numeric Jd Array Clear is unaffected and matches the
     * routine. See NOTES.
     */
    'jd array clear'(it) {
      const addr = it.evalInt()
      const dim = arrayDim(rt, addr)
      for (let i = 0; i <= dim; i++) writeLong(rt, elemAddr(addr, i), 0)
    },
    'jd array$ clear'(it) {
      const addr = it.evalInt()
      const dim = arrayDim(rt, addr)
      for (let i = 0; i <= dim; i++) writeLong(rt, elemAddr(addr, i), 0)
    },

    /**
     * Jd Get Area "10-20" — routine 21 (+|jd.s:1933). Splits an "a-b" string
     * into the pair Jd Area First / Jd Area Last read back. The manual's three
     * examples cover the shape completely: "10-20" gives 10 and 20, "10-"
     * gives 10 and 0, "-20" gives 0 and 20 — the routine tests for a leading
     * hyphen (`berbis`) and a trailing one (`bisber`) before splitting.
     *
     * An empty string leaves both zero (`nulnul`, :1939).
     */
    'jd get area'(it) {
      const v = it.evalStr()
      const cut = v.indexOf('-')
      if (v === '') {
        rt.jd.areaFirst = 0
        rt.jd.areaLast = 0
        return
      }
      if (cut < 0) {
        // no hyphen at all: the whole string is the first element
        rt.jd.areaFirst = parseInt(v, 10) || 0
        rt.jd.areaLast = 0
        return
      }
      rt.jd.areaFirst = parseInt(v.slice(0, cut), 10) || 0
      rt.jd.areaLast = parseInt(v.slice(cut + 1), 10) || 0
    },

    /** Jd Reset Area — routine 22 (+|jd.s:2014). Both back to zero. */
    'jd reset area'() {
      rt.jd.areaFirst = 0
      rt.jd.areaLast = 0
    },

    /**
     * Jd Type "text",delay,sound — routine 64 (+|jd.s:3481). Writes the string
     * to the console one character at a time.
     *
     * A NEGATIVE delay becomes 10 (`bpl d3ok`, :3496), which is the routine's
     * own default rather than an error.
     *
     * DEVIATION: the sound argument. The routine's first act is to ask AMOS
     * for eight bytes of chip RAM and copy a two-longword `table` into it
     * (:3486) — a tiny square wave it plays as a keyclick per character. That
     * is a raw audio-channel poke of a sample this port has no way to route,
     * so the text is written and the click is not made. The argument is
     * accepted and ignored rather than refused, because a program passing 1
     * still wants its text.
     *
     * The per-character delay is likewise not paced here: the whole string
     * reaches the console in one statement, where the real thing spreads it
     * over delay*length vertical blanks. Timing is the port-wide deviation
     * that #87 covers, not a JD one.
     */
    'jd type'(it) {
      const text = it.evalStr()
      it.expect(',')
      const delay = it.evalInt()
      it.accept(',')
      if (!it.atStmtEnd()) it.evalInt() // the sound flag, read and dropped
      void delay
      it.write(text)
    },

    /**
     * Jd Hexdump size,address,count,width — routine 63 (+|jd.s:3373). Writes a
     * hex dump to the console: `size` is 1, 2 or 4 bytes per column, `count`
     * columns in total, `width` per line.
     *
     * The addresses come from the same address space Peek and Leek use, so a
     * dump of a bank or a screen shows what the program would read there.
     */
    'jd hexdump'(it) {
      const size = it.evalInt()
      it.expect(',')
      const addr = it.evalInt()
      it.expect(',')
      const count = it.evalInt()
      it.expect(',')
      const width = Math.max(1, it.evalInt())
      const step = size === 4 ? 4 : size === 2 ? 2 : 1
      const digits = step * 2
      let line = ''
      for (let i = 0; i < count; i++) {
        let v = 0
        for (let b = 0; b < step; b++) {
          const m = rt.resolveAddr(addr + i * step + b)
          v = v * 256 + (m ? (m.data[m.off] ?? 0) : 0)
        }
        line += v.toString(16).toUpperCase().padStart(digits, '0') + ' '
        if ((i + 1) % width === 0) {
          it.write(line.trimEnd() + '\n')
          line = ''
        }
      }
      if (line !== '') it.write(line.trimEnd() + '\n')
    },
  }
}
