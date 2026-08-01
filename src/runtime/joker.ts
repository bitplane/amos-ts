/**
 * `Joker` (Lib_Def Joker, +Lib.s:6631) — AMOS's own filename filter.
 *
 * This is NOT AmigaDOS pattern matching. `dos.library`'s ParsePattern grammar
 * lives in ../amiga/dospattern.ts and is what LDos's `Lmatch` and JD-K3's
 * `Jd Match` call; this is a 45-line byte loop in AMOS's own main library,
 * and it is the one every AMOS-side glob goes through — `Dir`, `Dir First$`,
 * `Set Dir`'s negative filter, `Dev First$` and the file selector.
 *
 * It lives here rather than in ../amiga for the reason src/amiga/README.md
 * gives for keeping `device.ts` on this side: a `Lib_Def` routine in AMOS's
 * main library is AMOS's, however OS-shaped the job looks. A previous
 * approximation of it sat in ../amiga/vfs.ts as `amigaPattern`, compiling
 * `#?` / `*` / `?` to a RegExp, and the placement is part of what made that
 * look like a subset of dos.library rather than a different language.
 *
 * ## The language, from the routine
 *
 * a0 is the filter, a1 the name, and the loop is NAME-driven: JokLoop takes
 * the next name character and only then reads a filter character.
 *
 * - **Case-insensitive.** JokA/JokB fold a-z to A-Z on BOTH sides before
 *   comparing. The one rule the old approximation had right.
 * - **`?` matches any character EXCEPT `.`** (JokC: `cmp.b #".",d1 / bne
 *   JokLoop / bra ReJok`).
 * - **`*` consumes up to the next `.` and stops there** (JokE/JokF). It does
 *   not cross a dot, so `*` alone matches `readme` and NOT `readme.txt`, and
 *   `*.iff` matches `pic.iff` and NOT `my.pic.iff`.
 * - **`**` matches everything**, tested before anything else (JokE's
 *   `cmp.b #"*",(a0)`). This, not `*`, is the match-all filter.
 * - **`.` is a literal dot** (JokD).
 * - **`/` separates alternative filters.** Any failure goes to ReJok, which
 *   puts the name back to the start and restarts at the character after the
 *   next `/`, so `#?.iff/#?.abk` is two patterns tried in turn.
 * - **`#` is an ordinary character.** `#?` is dos.library's "zero or more",
 *   and means nothing here — it matches a literal `#` followed by any
 *   non-dot. The old RegExp read it as `.*`, which is the single most
 *   misleading thing it did, because `#?.iff` is exactly what an Amiga
 *   programmer writes.
 *
 * ## Not the caller's job to pass "everything"
 *
 * There is no filter that means "match anything" other than `**`, and AMOS
 * never needs one: every call site guards with `tst.b (a0) / beq` and skips
 * the match entirely when the filter string is empty (FillDev +Lib.s:6120,
 * FillNxt :6215 and :6222). `matchesJoker` keeps that guard so callers do not
 * have to, and so that nobody reaches for `'*'` as a stand-in again.
 */

const NUL = 0
const DOT = 0x2e // '.'
const SLASH = 0x2f // '/'
const STAR = 0x2a // '*'
const QUES = 0x3f // '?'

/** a NUL-terminated read: past the end of the string is the terminator */
const at = (s: string, i: number): number => (i < s.length ? s.charCodeAt(i) : NUL)

/** JokA/JokB: fold a-z to A-Z, and nothing else */
const up = (c: number): number => (c >= 0x61 && c <= 0x7a ? c - 0x20 : c)

/**
 * The routine itself, transcribed label for label.
 *
 * Written as a program counter over the original's labels rather than
 * restructured into idiomatic control flow: `*`'s jump back into the middle
 * of the filter read (JokF -> JokL0), and ReJok's restart of BOTH pointers,
 * do not survive being tidied into a while loop, and this way each case can
 * be read against the listing.
 */
export function joker(filter: string, name: string): boolean {
  let a0 = 0 // the filter
  let a1 = 0 // the name
  let d2 = 0 // start of the alternative being tried
  const d3 = 0 // start of the name; ReJok restores a1 from it
  let d0 = 0 // the filter character
  let d1 = 0 // the name character
  let pc: 'JokLoop' | 'JokL0' | 'JokC' | 'JokD' | 'JokE' | 'JokF' | 'JokX' | 'ReJok' = 'JokLoop'

  for (;;) {
    switch (pc) {
      case 'JokLoop':
        d1 = at(name, a1++)
        pc = d1 === NUL ? 'JokX' : 'JokL0'
        break

      case 'JokL0':
        d0 = at(filter, a0++)
        // the filter ran out with name left over: no restart, straight out
        if (d0 === NUL) return false
        if (d0 === SLASH) pc = 'ReJok'
        else if (d0 === QUES) pc = 'JokC'
        else if (d0 === DOT) pc = 'JokD'
        else if (d0 === STAR) pc = 'JokE'
        else pc = up(d0) === up(d1) ? 'JokLoop' : 'ReJok'
        break

      case 'JokC': // '?' — any character that is not a dot
        pc = d1 !== DOT ? 'JokLoop' : 'ReJok'
        break

      case 'JokD': // '.' — a literal dot
        pc = d1 === DOT ? 'JokLoop' : 'ReJok'
        break

      case 'JokE': // '*'
        if (at(filter, a0) === STAR) return true // '**' matches everything
        pc = 'JokF'
        break

      case 'JokF': // eat name characters up to the next dot
        if (d1 === DOT) {
          pc = 'JokL0' // back for the next filter character, dot still in d1
          break
        }
        d1 = at(name, a1++)
        pc = d1 !== NUL ? 'JokF' : 'JokX'
        break

      case 'JokX': // the name ran out; the filter (or its alternative) must too
        d0 = at(filter, a0++)
        if (d0 === NUL || d0 === SLASH) return true
        pc = 'ReJok'
        break

      case 'ReJok': {
        // this alternative failed: name back to the start, filter forward to
        // whatever follows the next '/'
        a0 = d2
        a1 = d3
        for (;;) {
          d0 = at(filter, a0++)
          if (d0 === NUL) return false // no alternative left
          if (d0 === SLASH) break
        }
        d2 = a0
        pc = 'JokLoop'
        break
      }
    }
  }
}

/**
 * A filter as the call sites apply it: an empty one matches everything
 * without the routine being entered at all.
 *
 * This is the form to use. `Dir`, `Dev First$` and the file selector all
 * write the same `tst.b (a0) / beq` guard, and a caller that substitutes some
 * match-all pattern instead is inventing one — the language has only `**`,
 * and reaching for `*` gets a filter that rejects every name with a dot in it.
 */
export function matchesJoker(filter: string, name: string): boolean {
  return filter === '' || joker(filter, name)
}
