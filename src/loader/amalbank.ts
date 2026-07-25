/**
 * The AMAL bank (memory bank 4, named "Amal") holds two unrelated things,
 * and the interpreter reaches them by two different paths:
 *
 *  - **AMAL program strings**, used by `Amal n,#` / `Anim n,#` / `Move X n,#`.
 *    `InAmal2` (+Lib.s:11857-11877) follows the long at payload+0 to a
 *    section of length-prefixed strings.
 *  - **Movement recordings**, used by the AMAL `PLay` instruction. `AmPli`
 *    (+W.s:8661) reads a count word at payload+4 and a 1-based word-offset
 *    table straight after it — no indirection at all.
 *
 * Both sections' offsets are in *words*, and both are relative to the byte
 * just past their own count word, which is why the two bases differ by two.
 *
 * Verified against `Tutorial/Tutorials/AMAL/PLay_Data.Abk` (the bank the
 * Play/Amplay tutorial AMAL_5.AMOS loads).
 */

/**
 * One recorded movement. The stream offsets are absolute indices into the
 * bank payload, because the 68k walks them as bare pointers in both
 * directions: playing backwards runs down onto a 0 byte that sits *before*
 * the first step (`data[xStart-1]`, written for exactly that purpose).
 */
export interface AmalMovement {
  /** the record's own tempo word, loaded into R0 by AmPli (+W.s:8674) */
  speed: number
  /** first X step byte; the backward terminator is the byte before it */
  xStart: number
  /** first Y step byte; likewise preceded by its terminator */
  yStart: number
}

export interface AmalBank {
  /** the whole bank payload — movement pointers index into this */
  data: Uint8Array
  /** `Amal n,#` programs, indexed 0..count as InAmal2 indexes them */
  programs: string[]
  /** movements indexed 1..count; index 0 and unused slots are null */
  movements: Array<AmalMovement | null>
}

const u16 = (d: Uint8Array, a: number): number => (a + 1 < d.length ? ((d[a]! << 8) | d[a + 1]!) : 0)
const u32 = (d: Uint8Array, a: number): number =>
  a + 3 < d.length ? ((d[a]! << 24) | (d[a + 1]! << 16) | (d[a + 2]! << 8) | d[a + 3]!) >>> 0 : 0

export function parseAmalBank(data: Uint8Array): AmalBank {
  return { data, programs: parsePrograms(data), movements: parseMovements(data) }
}

/**
 * InAmal2 +Lib.s:11857: `add.l (a0),a0` — a long at payload+0 points at the
 * string section; 0 means the bank holds no programs (the keyword then
 * raises a function call error, which is the caller's job, not ours). The
 * section is a count word followed by word offsets, and `cmp.w (a0)+,d0 /
 * Rbhi` admits indices 0..count, so there are count+1 slots. An offset of 0
 * is not an error: it yields ChVide, the empty string.
 */
function parsePrograms(d: Uint8Array): string[] {
  const sec = u32(d, 0)
  if (sec === 0 || sec + 2 > d.length) return []
  const count = u16(d, sec)
  const table = sec + 2
  const out: string[] = []
  for (let n = 0; n <= count; n++) {
    const off = u16(d, table + n * 2)
    if (off === 0) {
      out.push('')
      continue
    }
    const rec = table + off * 2
    const len = u16(d, rec)
    let s = ''
    for (let i = 0; i < len && rec + 2 + i < d.length; i++) s += String.fromCharCode(d[rec + 2 + i]!)
    out.push(s)
  }
  return out
}

/**
 * AmPli +W.s:8663: count word at payload+4, then a word-offset table whose
 * entry for movement n sits at payload+4+n*2 — so entry 1 is the word right
 * after the count and index 0 is the count itself, which is why `lsl.w #1,d3
 * / beq AmMvX` rejects 0. Offsets are word counts from payload+4.
 *
 * Record layout at `base` (all verified against PLay_Data.Abk movement 1:
 * speed 2, Y at +273, X stream 267 bytes ending exactly one byte before the
 * Y terminator):
 *   +0  word  tempo → R0
 *   +2  word  offset of the Y terminator, from base
 *   +4  byte  0 — the X stream's backward terminator
 *   +5   bytes X steps, 0-terminated
 *   +yoff byte 0 — the Y stream's backward terminator
 *   +yoff+1   bytes Y steps, 0-terminated
 */
function parseMovements(d: Uint8Array): Array<AmalMovement | null> {
  const count = u16(d, 4)
  const out: Array<AmalMovement | null> = [null]
  for (let n = 1; n <= count; n++) {
    const off = u16(d, 4 + n * 2)
    if (off === 0) {
      out.push(null)
      continue
    }
    const base = 4 + off * 2
    if (base + 4 > d.length) {
      out.push(null)
      continue
    }
    out.push({ speed: u16(d, base), xStart: base + 5, yStart: base + u16(d, base + 2) + 1 })
  }
  return out
}
