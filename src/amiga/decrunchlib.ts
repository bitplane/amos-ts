/**
 * `decrunch.library` — DecrunchLib 35.237, © 1992,1993 Georg Hörmann.
 *
 * Explode calls four functions of it, for two keywords: `Dpk Name$` answers
 * WHICH cruncher packed a bank, and `Dpk Unpack` unpacks one. Both go through
 * the same identification, and this file is that identification in full,
 * driven by the tables ../cli/gendecrunch.ts extracts from the library
 * itself — 16 data magics, 76 executable signatures, one scan.
 *
 * ## What is here and what is not
 *
 * Identification is COMPLETE: every format the library knows, in the order it
 * tries them, answering the name it answers. `Dpk Name$` therefore behaves as
 * the original does.
 *
 * Decrunching is NOT complete. The library is roughly seventy decrunchers in
 * 27KB, and the dispatch at $1060 is a jump table with a distinct routine
 * behind almost every id. This port decrunches the ONE data format it already
 * had a compatible decruncher for — PowerPacker, id $48, via
 * ./powerpacker.ts — and refuses the rest. That is a finite porting backlog,
 * not undocumented behaviour: each missing algorithm is present in the
 * machine code. Returning no output is the safe substitute because Explode
 * already handles `dlDecrunch` returning zero by leaving the bank alone.
 *
 * The gap is stateable rather than vague. `DL_DECRUNCHES` is the set of ids
 * this file will act on; every other id in ./decrunchlib.gen.ts identifies
 * and does not unpack. Widening it means porting a decruncher, not editing a
 * comment.
 *
 * ## The three stages, in order
 *
 * The order is part of the answer, because each stage stops at its first
 * match and a file can satisfy more than one.
 *
 *   1. `$274` — the source's first longword against the data magics. These
 *      all carry subid 2, and subid 2 is what `dlDecrunch` tests at $1066 to
 *      take the data path instead of the executable one. An AMOS bank holding
 *      packed data lands here.
 *   2. `$240` then `$4b2` — step over an AmigaDOS hunk header if there is
 *      one, then the signature table: three (offset, longword) probes per
 *      record, ALL of which must match.
 *   3. `$202` — the one format with no signature, found by looking for three
 *      instructions in sequence.
 *
 * ## What the item is
 *
 * `dlAllocItem` ($13c) AllocMems 44 bytes MEMF_PUBLIC|MEMF_CLEAR, writes the
 * word "CI" and the size, and returns a pointer to the 40 bytes AFTER that
 * four-byte prefix; `dlFreeItem` ($162) checks the "CI" back before freeing.
 * The fields Explode uses are 0 = source address, 4 = name, 8 = decrunched
 * buffer, 12 = its length, 16 = the allocation's length, 22 = source length.
 * None of that survives into TypeScript, where the item is just a value, but
 * it is why `Dpk Unpack` has three separate lengths to keep straight.
 *
 * LICENCEWARE, and not redistributed. No decompression code is copied from
 * it: what this file reproduces is which byte patterns mean which format.
 */
import { DL_DATA_MAGICS, DL_SCAN, DL_SIGNATURES } from './decrunchlib.gen'
import { pp20Decrunch } from './powerpacker'

/** Resident metadata and every public LVO in the held 35.237 binary. */
export const DECRUNCH_NAME = 'decrunch.library'
export const DECRUNCH_VERSION = 35
export const DECRUNCH_REVISION = 237
export const DL_LVO = {
  dlAllocItem: -30,
  dlFreeItem: -36,
  dlInitItem: -42,
  dlDecrunch: -48,
  /** The unnamed ninth vector: load and relocate a crunched executable. */
  dlLoadExecutable: -54,
} as const

/** what `dlInitItem` fills in when it recognises something */
export interface DlItem {
  /** the id `dlDecrunch` dispatches on */
  id: number
  /** 2 for a data file, 0 or 1 for an executable */
  subId: number
  /** the name `Dpk Name$` returns */
  name: string
}

/** the ids ./decrunchlib.ts will actually unpack — see the header */
export const DL_DECRUNCHES: ReadonlySet<number> = new Set([0x48])

const u16 = (d: Uint8Array, at: number): number => ((d[at] ?? 0) << 8) | (d[at + 1] ?? 0)

const u32 = (d: Uint8Array, at: number): number =>
  (((d[at] ?? 0) << 24) | ((d[at + 1] ?? 0) << 16) | ((d[at + 2] ?? 0) << 8) | (d[at + 3] ?? 0)) >>> 0

/**
 * Whether a longword at `at` equals `value`, with a bounds check the original
 * does not have.
 *
 * DEVIATION: `cmp.l (a0,d0.w),d1` on a 68000 reads whatever is at the address
 * whether or not the file extends that far, and one signature probes 418
 * bytes in. A short buffer therefore gets compared against unrelated memory,
 * which can in principle match. Here a probe past the end is a miss. The
 * difference only shows on a buffer too short to hold the probe, where the
 * original's answer depended on what happened to be in RAM.
 */
const probeMatches = (d: Uint8Array, at: number, value: number): boolean =>
  at >= 0 && at + 4 <= d.length && u32(d, at) === value

/**
 * Step over an AmigaDOS hunk header, landing on the first hunk's data.
 *
 * `$240`. Not a hunk file — anything not opening `$3f3` — is returned
 * unchanged, which is why the signature table gets applied to raw data too.
 */
export function dlSkipHunkHeader(data: Uint8Array, from = 0): number {
  if (from + 4 > data.length || u32(data, from) !== 0x3f3) return from
  // the resident library list, each entry a length in longwords, zero-ended
  let at = from + 4
  for (;;) {
    if (at + 4 > data.length) return from
    const n = u32(data, at)
    at += 4
    if (n === 0) break
    at += n * 4
  }
  // then table_size, first_hunk, last_hunk, and one size longword per hunk
  if (at + 12 > data.length) return from
  const hunks = u32(data, at + 8) - u32(data, at + 4) + 1
  // `lea $14(a0,d0.l),a0` — past the size table, and past the first hunk's
  // own type and size longwords
  return at + 20 + hunks * 4
}

/** stage one: the data magics, in table order */
function identifyData(data: Uint8Array): DlItem | null {
  if (data.length < 2) return null
  const first = data.length >= 4 ? u32(data, 0) : -1
  for (const m of DL_DATA_MAGICS) {
    const hit = m.width === 4 ? first === m.magic : u16(data, 0) === m.magic
    if (!hit) continue
    if (m.also && !probeMatches(data, m.also.at, m.also.value)) continue
    return { id: m.id, subId: m.subId, name: m.name }
  }
  return null
}

/** stage two: three probes per record, all of which must match */
function identifySignature(data: Uint8Array, code: number): DlItem | null {
  for (const s of DL_SIGNATURES) {
    if (s.probes.every(([at, value]) => probeMatches(data, code + at, value))) {
      return { id: s.id, subId: s.subId, name: s.name }
    }
  }
  return null
}

/**
 * Stage three: `lea d16(pc),a2` within the first 101 words, then
 * `move.l (a2)+,d1` within the next 21, then `move.l (a2)+,d2` immediately.
 *
 * A shape rather than a signature, which is presumably why this one format
 * needed it — the constants it would be identified by move about.
 */
function identifyScan(data: Uint8Array, code: number): DlItem | null {
  let at = code
  let found = -1
  for (let i = 0; i < DL_SCAN.leadTries; i++, at += 2) {
    if (at + 2 > data.length) return null
    if (u16(data, at) === DL_SCAN.lead) {
      found = at + 2
      break
    }
  }
  if (found < 0) return null
  for (let i = 0; i < DL_SCAN.thenTries; i++, found += 2) {
    if (found + 2 > data.length) return null
    if (u16(data, found) !== DL_SCAN.then) continue
    if (u16(data, found + 2) !== DL_SCAN.third) return null
    return { id: DL_SCAN.id, subId: DL_SCAN.subId, name: DL_SCAN.name }
  }
  return null
}

/**
 * `dlInitItem`, LVO -42 at $182: identify, or `null` for "not recognised".
 *
 * The library's own answer is d0 = 0/1 with the item filled in on 1, and both
 * of Explode's callers test it before reading anything back.
 */
export function dlInitItem(data: Uint8Array): DlItem | null {
  if (data.length === 0) return null
  const asData = identifyData(data)
  if (asData) return asData
  const code = dlSkipHunkHeader(data)
  return identifySignature(data, code) ?? identifyScan(data, code)
}

/**
 * `dlDecrunch`, LVO -48 at $1060 — for the ids in `DL_DECRUNCHES` only.
 *
 * `srcLen` is the length the caller declared, and it is not the buffer's
 * length: the PowerPacker handler at $121e reads its decrunched size from
 * `(src + srcLen) - 4`, so a bank with slack after its payload would give the
 * wrong answer if the buffer were measured instead.
 *
 * Anything else answers `null`, which is what the library answers for a
 * format it recognised but could not unpack — the error word at item+26 says
 * which of the seven reasons it was, and Explode reads it for none of them.
 */
export function dlDecrunch(data: Uint8Array, srcLen: number, item: DlItem): Uint8Array | null {
  // `cmpi.b #2,$15(a5)`: anything else is an executable and needs the loader
  if (item.subId !== 2 || !DL_DECRUNCHES.has(item.id)) return null
  if (srcLen < 12 || srcLen > data.length) return null
  try {
    const out = pp20Decrunch(data.subarray(0, srcLen))
    // A PP20 trailer declaring zero bytes: `bsr $120e` AllocMems that many
    // and `move.l d0,$8(a5) / beq` treats what comes back as the failure the
    // routine's whole success test is ($1096, `tst.l $8(a5)`). Answering an
    // empty array instead would send `Dpk Unpack` into a zero-length
    // `Bnk.Reserve`, which in this port is error 23 — an error the original
    // raises nowhere on this path.
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}
