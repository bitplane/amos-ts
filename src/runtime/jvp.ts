/**
 * JVP-NoKids 1.01 — Jens Vang Petersen, dated 20 January 1998, "MailWare".
 * Eleven keywords at slot 25: a tree sort, six-field string formatting, and a
 * message-bank catalogue for localising a program.
 *
 * ## Evidence
 *
 * Source tier, and unusually complete for a third-party extension: the author
 * shipped `source/AMOSPro_JVP.Lib.s`, 26KB of commented assembler, beside the
 * 2,892-byte `AMOSPro_JVP.Lib` and a 21KB `JVP_Extension.doc` that documents
 * every keyword and the bank format down to the byte. Line references below
 * are into that source; where the binary and the source disagree the binary
 * wins, and the one place they do is called out under Jvp Str$.
 *
 * The doc fixes the slot — "The extension is supposed to be at slot nr. 25" —
 * and the source agrees (`ExtNb equ 25-1`).
 *
 * ## The workspace
 *
 * `MB` (source:130) is the extension's data block, reached through
 * `$278(a5)`, the per-slot extension data pointer for slot 25 — the same
 * field TFT uses, since both sit at 25. Its layout, confirmed against the
 * binary's own offsets:
 *
 *   +$00  StrLen, six words          (`cmpi.w #$0,(a1,d1.w)`)
 *   +$0c  StrAdj, six bytes          "Not implemented yet", always zero
 *   +$12  StrSep, six bytes          (`cmpi.b #$0,$12(a1,d1.w)`)
 *   +$18  BinSortType, one byte
 *   +$1a  MsgAdr, one long           (`movea.l $1a(a0),a0`)
 *
 * `DefRou` (source:106) resets all of it on Run: lengths 20, separators 32,
 * sort type 0, no message bank — which the doc restates under "What happens
 * when". That is exactly `newJvpState()`.
 */
import { AmosError, VI, VS, int, str } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'

/** "MSGB", the message bank's identifier (`cmpi.l #$4d534742,(a0)`) */
const MSGB = 0x4d534742

/**
 * The extension's error table. One entry, and the author knew it: "These
 * commands are curently the only ones which includes errortexts".
 * `ErrMess` at source:943, raised through `L_Custom` with d1 = 0, so it is
 * trappable.
 */
export const JVP_ERRORS: readonly string[] = ['Not a Message bank']

export interface JvpState {
  /** +$18, a byte. 0 = DOS strings, anything else = AMOS strings */
  sortType: number
  /** +$00, six words */
  strLen: number[]
  /** +$12, six bytes */
  strSep: number[]
  /** +$1a — 0 until Jvp Set Msg Bank accepts one */
  msgAdr: number
}

export const newJvpState = (): JvpState => ({
  sortType: 0,
  strLen: [20, 20, 20, 20, 20, 20],
  strSep: [32, 32, 32, 32, 32, 32],
  msgAdr: 0,
})

// ---- memory ---------------------------------------------------------------

/** a region the runtime resolved, addressed relative to `off` */
interface Block {
  data: Uint8Array
  off: number
}

const rdB = (m: Block | null, i: number): number =>
  m !== null && i >= 0 && m.off + i < m.data.length ? m.data[m.off + i]! : 0
const rdW = (m: Block | null, i: number): number => (rdB(m, i) << 8) | rdB(m, i + 1)
/** the same read as `cmp.w (a1),d0` sees it: a SIGNED word */
const rdWs = (m: Block | null, i: number): number => (rdW(m, i) << 16) >> 16
const rdL = (m: Block | null, i: number): number =>
  ((rdB(m, i) << 24) | (rdB(m, i + 1) << 16) | (rdB(m, i + 2) << 8) | rdB(m, i + 3)) | 0

const wrL = (m: Block | null, i: number, v: number): void => {
  if (m === null || i < 0 || m.off + i + 4 > m.data.length) return
  m.data[m.off + i] = (v >>> 24) & 0xff
  m.data[m.off + i + 1] = (v >>> 16) & 0xff
  m.data[m.off + i + 2] = (v >>> 8) & 0xff
  m.data[m.off + i + 3] = v & 0xff
}

const latin1 = (b: Uint8Array): string => {
  let s = ''
  for (const c of b) s += String.fromCharCode(c)
  return s
}

const bytesOf = (s: string): number[] => [...s].map((c) => c.charCodeAt(0) & 0xff)

/**
 * `Bnk.OrAdr` (+Lib.s:8082) as an ADDRESS rather than a block: a small value
 * is a bank number and resolves to that bank's start, anything else is
 * already an address. Going through the runtime's own bankOrAddr first keeps
 * the unreserved-bank error (`Rbeq L_BkNoRes`) identical.
 */
function bankOrAddress(rt: Runtime, n: number): number {
  rt.bankOrAddr(n)
  return n >= 0 && n < 0x10000 ? rt.bankBase(n) : n
}

/**
 * A guard the library does not have.
 *
 * Both loops below chase indices held in the caller's workspace, and the
 * library trusts them completely — "This command has been optimized for
 * speed, and contains no error-checking at all. You MUST make sure that the
 * memory needed is present". A workspace shorter than (ANT+3)*16 makes those
 * reads answer from outside it, and a cycle in what comes back is a hang
 * rather than the crash a real machine would give. NOTE'd in status.ts.
 */
const CHASE_LIMIT = (ant: number): number => 8 * Math.max(ant, 0) + 64

// ---- Jvp Bin Sort ---------------------------------------------------------

/**
 * `SO_sams` / `SO_sams2` (source:324, 349) — compare two strings through the
 * translation map, returning the pair of map values the caller then tests
 * with `cmp.l d1,d0`.
 *
 * Both loops leave d0 and d1 holding the values from the LAST character pair
 * they looked at, and both exit on the shorter string running out WITHOUT
 * touching them again. So a string compares EQUAL to any string it is a
 * prefix of: "AB" against "ABC" exits with d0 = d1 = map("B"). The doc never
 * says so; the code is unambiguous, and it is why the port returns the pair
 * rather than an ordering.
 */
function sams(a: number[], b: number[], map: (c: number) => number, amos: boolean): [number, number] {
  let d0 = 0
  let d1 = 0
  if (!amos) {
    // DOS strings: run to the first control character, "[<Chr$(32)]"
    for (let i = 0; ; i++) {
      const d2 = a[i] ?? 0
      const d3 = b[i] ?? 0
      if (d2 <= 31 || d3 <= 31) break
      d0 = map(d2)
      d1 = map(d3)
      if (d0 !== d1) break
    }
    return [d0, d1]
  }
  // AMOS strings: the leading length word governs, one countdown each
  let la = a.length
  let lb = b.length
  for (let i = 0; ; i++) {
    if (la === 0 || lb === 0) break
    d0 = map(a[i] ?? 0)
    d1 = map(b[i] ?? 0)
    la--
    lb--
    if (d0 !== d1) break
  }
  return [d0, d1]
}

// ---- Jvp Str$ / Jvp Cstr$ -------------------------------------------------

/**
 * The shared body of `Jvp Str$` (source:439) and `Jvp Cstr$` (source:539) —
 * the two routines are the same code with a different inner copy loop.
 *
 * Six fields, each padded or truncated to StrLen and followed by StrSep. A
 * length of 0 drops the field AND its separator; a separator of 0 emits
 * nothing. The result is pre-filled with spaces, so a short source pads.
 *
 * ## The off-by-one, which is the library's
 *
 * The copy loop is `addq.w #1,d7 / cmp.w StrLen(a1,d1),d7 / ble` — it
 * continues while d7 is still EQUAL to the field width, so a source longer
 * than its field writes one character PAST it. Where a separator follows,
 * the separator immediately overwrites that byte and nothing shows. Where it
 * does not, the byte survives into the next field's first position and is
 * only overwritten if that field actually copies something. So
 * `Jvp Set Str Len 3,3 : Jvp Set Str Sep 0,0` over "ABCDEF" and "" yields
 * "ABCD  " where the lengths promise "ABC   ". Reproduced, and the buffer is
 * one byte longer than the string so the last field's stray write has
 * somewhere to land — as it does on the Amiga, inside the allocation but
 * past the length word that governs what AMOS reads.
 */
function combine(st: JvpState, src: (i: number) => number[] | null, dos: boolean): string {
  // ST_IN1: the total, computed exactly as the routine adds it up
  let total = 0
  for (let i = 0; i < 6; i++) {
    const len = st.strLen[i]! & 0xffff
    if (len === 0) continue
    total = (total + len) & 0xffff
    if ((st.strSep[i]! & 0xff) === 0) continue
    total = (total + 1) & 0xffff
  }
  // NOTE. The loop runs `cmp.w #12,d7 / ble`, so it reads SEVEN words: one
  // past StrLen, into StrAdj. StrAdj is the never-implemented adjustment
  // table and DefRou zeroes it, so the seventh field is always empty and
  // contributes nothing. Nothing in the library ever writes it.

  const out = new Uint8Array(total + 1)
  out.fill(32, 0, total)
  let p = 0
  for (let i = 0; i < 6; i++) {
    const len = st.strLen[i]! & 0xffff
    if (len === 0) continue // ST_ME: no field, and no separator either
    const s = src(i)
    // `cmpa.l #$0,a3 / beq` — Str$ skips a null address, Cstr$ has the same
    // test commented out in the source and would follow it
    if (s !== null) {
      let left = s.length
      for (let d7 = 0; ; d7++) {
        if (dos) {
          if ((s[d7] ?? 0) <= 31) break
        } else if (left <= 0) break
        out[p + d7] = s[d7] ?? 0
        left--
        if (d7 + 1 > len) break
      }
    }
    p += len
    const sep = st.strSep[i]! & 0xff
    if (sep === 0) continue
    out[p] = sep
    p++
  }
  return latin1(out.subarray(0, total))
}

// ---- the message bank -----------------------------------------------------

/**
 * `L_GetMsg` (source:898). Walks group -> subgroup -> item, every pointer
 * relative to the bank start, every list a count word followed by longwords.
 * Returns a negative code, or the item pointer (still relative), or 0 for a
 * defined-but-empty slot.
 *
 * NOTE. Each level checks only the UPPER bound (`cmp.w (a1),d0 / bgt`), and
 * the index scales through `lsl #2` and `2(a1,d0.w)` — both word-sized and
 * signed. A negative coordinate therefore passes the check and indexes
 * backwards out of the structure. That is reproduced as written; what keeps
 * it from reading the port's own memory is that every access here is bounded
 * by the bank, answering 0 outside it.
 */
function getMsg(m: Block, g: number, sg: number, item: number): number {
  const w = (x: number): number => (x << 16) >> 16
  /** `lsl #2,dn` then `2(a1,dn.w)`: the scaled index wraps in a word */
  const idx = (x: number): number => ((w(x) * 4) << 16) >> 16

  let a1 = rdL(m, 8) // the group list, "Normaly 20/$14"
  if (w(g) > rdWs(m, a1)) return -1
  a1 = rdL(m, a1 + 2 + idx(g))
  if (w(sg) > rdWs(m, a1)) return -2
  a1 = rdL(m, a1 + 2 + idx(sg))
  if (w(item) > rdWs(m, a1)) return -3
  return rdL(m, a1 + 2 + idx(item))
}

/** an AMOS string structure: "Length of string" then "The string itselve" */
function readAmosStr(m: Block, off: number): string {
  const n = rdW(m, off)
  const b = new Uint8Array(n)
  for (let i = 0; i < n; i++) b[i] = rdB(m, off + 2 + i)
  return latin1(b)
}

// ---- dispatch -------------------------------------------------------------

export function makeJvpInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): JvpState => rt.jvp

  return {
    /**
     * Jvp Bin Sort Type VAL (source:782) — `move.b d0,BinSortType`. A byte,
     * and the doc's "VAL can take values between 0 and 255, if you enter
     * anything else that 0 then the sort will asume AMOS strings" is exactly
     * the `cmp.b #0,d0 / bne` the sort does with it.
     */
    'jvp bin sort type'(it) {
      st().sortType = it.evalInt() & 0xff
    },

    /**
     * Jvp Set Str Len s1,s2,s3,s4,s5,s6 (source:387). Six words, stored back
     * to front because the parameters come off the stack in reverse.
     */
    'jvp set str len'(it) {
      const v: number[] = []
      for (let i = 0; i < 6; i++) {
        if (i > 0) it.expect(',')
        v.push(it.evalInt() & 0xffff)
      }
      st().strLen = v
    },

    /**
     * Jvp Set Str Sep — three token forms sharing one name (`!jvp set str
     * sep` and the two unnamed entries that follow it), routines 4, 5 and 6.
     * No argument sets every separator back to 32, one sets them all to it,
     * six set them individually. Dispatch here is by name, so the three
     * collapse into one handler that reads what is actually there.
     */
    'jvp set str sep'(it) {
      if (it.atStmtEnd()) {
        st().strSep = [32, 32, 32, 32, 32, 32]
        return
      }
      const first = it.evalInt() & 0xff
      if (!it.accept(',')) {
        st().strSep = [first, first, first, first, first, first]
        return
      }
      const v = [first]
      for (let i = 1; i < 6; i++) {
        if (i > 1) it.expect(',')
        v.push(it.evalInt() & 0xff)
      }
      st().strSep = v
    },

    /**
     * Jvp Set Msg Bank NR (source:791). Takes a bank number or an address,
     * and refuses anything not starting "MSGB" — the library's only error.
     */
    'jvp set msg bank'(it) {
      const ad = bankOrAddress(rt, it.evalInt())
      const m = rt.resolveAddr(ad)
      if (m === null || rdL(m, 0) !== MSGB) throw new AmosError(JVP_ERRORS[0]!)
      st().msgAdr = ad
    },

    /**
     * Jvp Bin Sort SRC,ANT,MAP to DEST,WORK (source:156) — the reason the
     * extension exists. The author wrote it after a database sort of 2,000
     * records crawled on a friend's A2000.
     *
     * It is a binary tree sort held entirely in the caller's workspace, as
     * four parallel arrays of ANT longwords each: foer (left child), efter
     * (right child), hoved (parent) and skrevet (already emitted), all
     * indexed by element*4 and all pre-filled with -1. Element 0 is the root
     * and is never inserted; elements 1.. are, each first tested against the
     * running minimum and maximum so an already-ordered list inserts in O(1)
     * a time, and only otherwise walked down from the root.
     *
     * The read-out is a destructive in-order traversal: it clears each link
     * as it follows it and climbs back through hoved, which is why the
     * workspace is documented as ERASED and why no recursion stack is
     * needed. DEST receives the ORIGINAL INDEX of each string in sorted
     * order — "you won't get any adresses or strings back, but an index-
     * number", to be used as the doc's `String$=T$(n(nr))`.
     *
     * DEFECT: the traversal never emits element 0 when element 0 is the
     * list's MAXIMUM. Its exit test (source:312, binary $3e2) climbs to the
     * parent and, on finding itself back at the root, checks only foer[0] and
     * efter[0] — never skrevet[0]. The root is therefore emitted solely by
     * the branch that descends into a right child, and the maximum has none.
     * DEST is left one entry short, always the last one, since a maximum
     * sorts last. It hides on a real machine because DEST is normally a
     * fresh bank or an integer array — both zero — and the value that goes
     * missing is index 0, so the last row of a sorted listing silently shows
     * the first record. Reproduced: nothing here writes that slot either.
     *
     * DEFECT: a second one, in the same keyword. The insert loop runs before
     * its own bound is tested (`SO_LE1` adds 4 to d6 and only then compares), so
     * ANT of 0 or 1 still inserts a phantom element 1, read from four bytes
     * past the address list. The tree then holds two nodes and the traversal
     * writes TWO longwords into a DEST the doc sizes at 4*ANT. Reproduced;
     * here the stray read answers 0 and the stray write lands outside the
     * resolved region and is dropped, where on the Amiga both are whatever
     * happened to be next in memory.
     */
    'jvp bin sort'(it) {
      const srcAd = it.evalInt()
      it.expect(',')
      const ant = it.evalInt()
      it.expect(',')
      const mapAd = it.evalInt()
      it.expect('to')
      const destAd = it.evalInt()
      it.expect(',')
      const workAd = it.evalInt()

      // the library's own order: workspace, destination, map, then the
      // address list, which it resolves only after clearing the workspace
      const work = rt.resolveWrite(bankOrAddress(rt, workAd))
      const dest = rt.resolveWrite(bankOrAddress(rt, destAd))
      const map = rt.resolveAddr(bankOrAddress(rt, mapAd))
      const amos = st().sortType !== 0

      const ant4 = (ant * 4) | 0
      const FOER = 0
      const EFTER = ant4
      const HOVED = 2 * ant4
      const SKREVET = 3 * ant4
      // SO_LI1: -1 through all four arrays, and one longword past them
      for (let i = 0; i <= ant4 * 4; i += 4) wrL(work, i, -1)

      const src = rt.resolveAddr(bankOrAddress(rt, srcAd))

      /** "SortValue=Peek(MAP+Asc(Char$))" — a 256-byte translation table */
      const mapped = (c: number): number => rdB(map, c & 0xff)

      /** each element's characters, read once; the list cannot move mid-sort */
      const cache = new Map<number, number[]>()
      const elem = (i: number): number[] => {
        const hit = cache.get(i)
        if (hit !== undefined) return hit
        const ad = rdL(src, i * 4)
        const m = ad === 0 ? null : rt.resolveAddr(ad)
        const out: number[] = []
        if (m !== null) {
          if (amos) {
            // "MUST point to the start of an AMOS-String definition, NOT the
            // first character" — Varptr(n$)-2, or Array(n$(0))+6
            const n = rdW(m, 0)
            for (let k = 0; k < n; k++) out.push(rdB(m, 2 + k))
          } else {
            // "MUST point at the FIRST character", terminated by <Chr$(32)
            for (let k = 0; k < 0x10000; k++) {
              const c = rdB(m, k)
              if (c <= 31) break
              out.push(c)
            }
          }
        }
        cache.set(i, out)
        return out
      }
      const cmp2 = (offA: number, offB: number): [number, number] =>
        sams(elem(offA >> 2), elem(offB >> 2), mapped, amos)

      // ---- build the tree
      let d4 = 0 // the running minimum, as a byte offset
      let d5 = 0 // the running maximum
      let d6 = 4 // the element being inserted
      do {
        const [m0, m1] = cmp2(d5, d6)
        if (!(m0 > m1)) {
          // at or after the maximum: append, no walk needed
          wrL(work, EFTER + d5, d6)
          wrL(work, HOVED + d6, d5)
          d5 = d6
          continue
        }
        const [n0, n1] = cmp2(d4, d6)
        if (n0 > n1) {
          // before the minimum: prepend
          wrL(work, FOER + d4, d6)
          wrL(work, HOVED + d6, d4)
          d4 = d6
          continue
        }
        let d7 = 0
        for (let guard = CHASE_LIMIT(ant); guard > 0; guard--) {
          const [c0, c1] = cmp2(d7, d6)
          const side = c0 > c1 ? FOER : EFTER
          const next = rdL(work, side + d7)
          if (next === -1) {
            wrL(work, side + d7, d6)
            wrL(work, HOVED + d6, d7)
            break
          }
          d7 = next
        }
      } while ((d6 += 4) < ant4)

      // ---- read it back out, clearing links as it goes
      let d0 = 0
      let d1 = 0
      for (let guard = CHASE_LIMIT(ant); guard > 0; guard--) {
        const left = rdL(work, FOER + d1)
        if (left !== -1) {
          wrL(work, FOER + d1, -1)
          d1 = left
          continue
        }
        const right = rdL(work, EFTER + d1)
        if (right !== -1) {
          wrL(dest, d0, d1 >> 2)
          wrL(work, SKREVET + d1, 1)
          wrL(work, EFTER + d1, -1)
          d1 = right
          d0 += 4
          continue
        }
        if (rdL(work, SKREVET + d1) === -1) {
          wrL(dest, d0, d1 >> 2)
          wrL(work, SKREVET + d1, 1)
          d0 += 4
        }
        // climb to the parent; back at the root with both links gone is done
        d1 = rdL(work, HOVED + d1)
        if (d1 >> 2 !== 0) continue
        if (rdL(work, FOER) !== -1) continue
        if (rdL(work, EFTER) !== -1) continue
        break
      }
    },
  }
}

export function makeJvpFunctions(rt: Runtime): Record<string, Func> {
  const st = (): JvpState => rt.jvp

  /** the bank every Msg keyword reads, or the library's one error */
  const msgBank = (): { m: Block; base: number } => {
    const base = st().msgAdr
    const m = rt.resolveAddr(base)
    if (m === null || rdL(m, 0) !== MSGB) throw new AmosError(JVP_ERRORS[0]!)
    return { m, base }
  }

  return {
    /**
     * =Jvp Version (source:774) — `moveq #$65,d3` in the binary, which is
     * 101. "returns the versionnumber*100", and the author's note that this
     * "should be in all extensions, I've seen too many that didn't have it".
     */
    'jvp version'() {
      return VI(101)
    },

    /**
     * =Jvp Str$(ad1..ad6) (source:439) — six DOS strings AT ADDRESSES, each
     * "terminated by <chr$(32)". An address of 0 leaves that field blank.
     *
     * NOTE — a defect in the shipped binary that a program cannot observe, so
     * it carries neither marker (see ./README.md). The
     * length pass reads the StrLen table through `adda.l $0.l,a0`
     * (binary $558) — absolute address 0, not the workspace: the source's
     * `add.l StrLen-MB,a0` (source:451) has StrLen-MB = 0 and assembled as
     * an absolute read of location $0 instead of the intended `adda.l a1,a0`.
     * On a booted Amiga location 0 holds 0 (ExecBase lives at 4, and the
     * reset vectors below it are dead once the ROM overlay is off), so a0
     * lands on the workspace and the routine works — by luck, not design.
     * The second pass reads the same table through a1 correctly. This port
     * implements the intent, which is what the instruction does on the
     * machine it shipped for.
     */
    'jvp str$'(_, a) {
      return VS(
        combine(
          st(),
          (i) => {
            const ad = int(a[i] ?? VI(0))
            if (ad === 0) return null
            const m = rt.resolveAddr(ad)
            if (m === null) return null
            const out: number[] = []
            for (let k = 0; k < 0x10000; k++) {
              const c = rdB(m, k)
              if (c <= 31) break
              out.push(c)
            }
            return out
          },
          true,
        ),
      )
    },

    /**
     * =Jvp Cstr$(s1$..s6$) (source:539) — the same formatting over AMOS
     * strings, which "do NOT need to be terminated by anything special".
     * The routine reads the length word and counts down, so an embedded
     * control character is copied rather than ending the field.
     */
    'jvp cstr$'(_, a) {
      return VS(combine(st(), (i) => bytesOf(str(a[i] ?? VS(''))), false))
    },

    /**
     * =Jvp Msg Bank (source:869) — "Returns the number of the current
     * MsgBank, 0 if none is active". The library reads `-$10(a0)`, the
     * longword sixteen bytes before the bank's data, which is the bank
     * NUMBER in AMOS's bank list node (+Lib.s:7920, `cmp.l 8(a1),d0` against
     * a data address of node+24).
     *
     * NOTE. Banks here have no such node in front of them, so the number is
     * recovered by finding which reserved bank the stored address falls in.
     * That answers the same for a bank, and 0 rather than adjacent memory
     * for a program that handed Set Msg Bank a raw address instead.
     */
    'jvp msg bank'() {
      const base = st().msgAdr
      const m = rt.resolveAddr(base)
      if (m === null || rdL(m, 0) !== MSGB) return VI(0)
      for (const [n, bank] of rt.memBanks) {
        const b = rt.bankBase(n)
        if (base >= b && base < b + bank.data.length) return VI(n)
      }
      return VI(0)
    },

    /**
     * =Jvp Msg Exists(G,SG,IT) (source:808). -1, -2 and -3 for a group,
     * subgroup or item out of range, 0 for a slot with no message in it,
     * and otherwise the address of the string structure.
     */
    'jvp msg exists'(_, a) {
      const { m, base } = msgBank()
      const p = getMsg(m, int(a[0] ?? VI(0)), int(a[1] ?? VI(0)), int(a[2] ?? VI(0)))
      return VI(p <= 0 ? p : (base + p) | 0)
    },

    /**
     * =Jvp Msg$ — two token forms under one name again (`!jvp msg$` and the
     * unnamed `20,0,0` after it), routines 15 and 16.
     *
     * With no arguments it is the bank's title field at +4 (source:827),
     * empty when that pointer is 0. With three it is that message, and the
     * `cmp.l a0,a1 / bgt` guard (source:857) turns every failure — the three
     * negative codes and the undefined-slot 0 alike — into the empty string,
     * which is what the doc promises: "if no message have been defined or
     * the numbers are out of range, you'll get an empty string".
     */
    'jvp msg$'(_, a) {
      const { m } = msgBank()
      if (a.length === 0) {
        const title = rdL(m, 4)
        return VS(title === 0 ? '' : readAmosStr(m, title))
      }
      const p = getMsg(m, int(a[0] ?? VI(0)), int(a[1] ?? VI(0)), int(a[2] ?? VI(0)))
      return VS(p <= 0 ? '' : readAmosStr(m, p))
    },
  }
}
