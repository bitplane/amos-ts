/**
 * Where an extension's routines live in its code hunk.
 *
 * Extracted from src/cli/extdis.ts so that the disassembler and the citation
 * checker agree by construction rather than by both getting it right. The
 * reasoning behind the layout is documented at length there; the short
 * version is that AMOS's `MC` macro (+Equ.s:2258) emits
 *
 *     dc.w (L<this> - L<prev>) / 2
 *
 * so the jump table is DELTA-encoded in words, which is why searching a
 * library for absolute addresses finds nothing at all.
 */

/**
 * Where the jump table starts, which is the one thing the two library shapes
 * disagree about.
 *
 * Both open with the same four size longs, for the jump table, token table,
 * library and title, and both follow them with a zero word. The stock AMOS
 * Pro 2.0 libraries then write `"AP20"` and start the table at 22; the older and
 * third-party ones write nothing and start it at 18. `parseAmosLib` and
 * `parseAmosLibOld` in `../tokens/libtok.ts` already split on exactly this,
 * and this reads the same witness so that the three agree rather than each
 * getting it right separately.
 *
 * Of the 84 libraries in `fixtures/extensions`, two carry the magic:
 * `os-devkit-1.61` and `bsdsocket-1.1.4`. Both are unported, which is why
 * assuming 18 went unnoticed, and it does not fail loudly. OS DevKit's
 * `"AP20"` reads as the first two deltas, $4150 and $3230, so routine 0 comes
 * out 33,440 bytes long and routine 1 25,696, and every address after them is
 * wrong by their sum.
 */
function jumpTableStart(code: Uint8Array): number {
  const ap20 = code[18] === 0x41 && code[19] === 0x50 && code[20] === 0x32 && code[21] === 0x30
  return ap20 ? 22 : 18
}

/** Where a library's four blocks sit, or null if the header is not one. */
export interface LibLayout {
  /** first byte of the delta-encoded jump table: 18, or 22 behind an `AP20` */
  table: number
  /** first byte of routine 0 */
  first: number
  /** one past the last routine, which is where the title chunk starts */
  end: number
}

/**
 * The offsets the four size longs describe, checked against the hunk.
 *
 * Returns null rather than a guess. The check is the header's own arithmetic:
 * the header plus the four sizes have to account for the hunk. Across the 84
 * libraries in `fixtures/extensions` that leaves 0, 2 or 4 bytes over and
 * never more, so 4 is the bound, and it is what settles the header length.
 * OS DevKit spends 22 + 6,544 + 23,460 + 68,126 + 60 = 98,212 of its
 * 98,216-byte hunk; read with an 18-byte header the same sizes leave 8 over,
 * which no library in the corpus does.
 */
export function libLayout(code: Uint8Array): LibLayout | null {
  if (code.length < 22) return null
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength)
  const jumpSize = view.getUint32(0, false)
  const tokenSize = view.getUint32(4, false)
  const libSize = view.getUint32(8, false)
  const titleSize = view.getUint32(12, false)
  const table = jumpTableStart(code)
  const first = table + jumpSize + tokenSize
  // a jump table has to fit between the header and the token table, and
  // routine 0 has to be inside the hunk
  if (jumpSize < 2 || jumpSize % 2 !== 0 || first >= code.length) return null
  const spent = first + libSize + titleSize
  if (spent > code.length || code.length - spent > 4) return null
  return { table, first, end: first + libSize }
}

/**
 * Every routine's offset within the code hunk, routine 0 first.
 *
 * The layout is computed from the size longs the hunk opens with rather than
 * searched for: jump-table size, token-table size, the header, the jump
 * table, the token table, and then the routines.
 *
 * The array has one entry per JUMP TABLE slot, not per keyword, and the
 * difference is the point: a keyword's routine is very often a six-byte
 * trampoline into a shared worker no token names, and those workers are the
 * ones a port ends up reading. AMCAF's replayer is routine 381 of 399 and no
 * keyword names it.
 *
 * Returns an empty array if `libLayout` rejects the header. A caller reading
 * arbitrary files should not get a confident answer.
 */
export function routineAddresses(code: Uint8Array): number[] {
  const lay = libLayout(code)
  if (!lay) return []
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength)
  const jumpSize = view.getUint32(0, false)
  const addr: number[] = [lay.first]
  for (let i = 0; i + 1 < jumpSize / 2; i++) {
    const next = addr[i]! + view.getUint16(lay.table + i * 2, false) * 2
    addr.push(next)
  }
  // routines live in the library area, so the last one cannot start past it.
  // Thirteen of the 84 put it exactly on the end, an empty final slot.
  if (addr[addr.length - 1]! > lay.end) return []
  return addr
}

/**
 * The half-open range routine `n` occupies, or null if there is no such
 * routine. The last routine runs to the end of the hunk.
 *
 * Citations legitimately name an address INSIDE a routine rather than its
 * first byte — AMCAF's `AllocMem at $1c32 within routine 0`, or the
 * selector-1 arm at `$8a16` within the 4,896-byte routine 381 — so the check
 * is containment, not equality.
 */
export function routineRange(addr: number[], n: number, hunkLen: number): { from: number; to: number } | null {
  const from = addr[n]
  if (from === undefined) return null
  return { from, to: addr[n + 1] ?? hunkLen }
}
