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
 * Every routine's offset within the code hunk, routine 0 first.
 *
 * The layout is computed from the two size longs the hunk opens with rather
 * than searched for: jump-table size, token-table size, ten bytes of header,
 * the jump table, the token table, and then the routines.
 *
 * The array has one entry per JUMP TABLE slot, not per keyword, and the
 * difference is the point: a keyword's routine is very often a six-byte
 * trampoline into a shared worker no token names, and those workers are the
 * ones a port ends up reading. AMCAF's replayer is routine 381 of 399 and no
 * keyword names it.
 *
 * Returns an empty array if the header does not describe a plausible library
 * — a caller reading arbitrary files should not get a confident answer.
 */
export function routineAddresses(code: Uint8Array): number[] {
  if (code.length < 18) return []
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength)
  const jumpSize = view.getUint32(0, false)
  const tokenSize = view.getUint32(4, false)
  const first = 18 + jumpSize + tokenSize
  // a jump table has to fit between the header and the token table, and
  // routine 0 has to be inside the hunk
  if (jumpSize < 2 || jumpSize % 2 !== 0 || first >= code.length) return []
  const addr: number[] = [first]
  for (let i = 0; i + 1 < jumpSize / 2; i++) {
    const next = addr[i]! + view.getUint16(18 + i * 2, false) * 2
    addr.push(next)
  }
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
