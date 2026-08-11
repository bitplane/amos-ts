/**
 * StoneCracker 4.04 (`S404`) — decrunch and crunch.
 *
 * The library's own version string documents it as *"StoneCrackerLibrary
 * 3.322 (17 Apr 1994)"*, by *"Jouni 'Mr.Spiv' Korhonen (StoneWare
 * Soft(Un)Works) & Marcus 'Cozine' Ottosson!"*, and it is one everyone on the
 * Amiga assumed was in `LIBS:` — the copy
 * this was read from is md5-identical in three unrelated partitions of the
 * corpus machine, and it is vendored at `fixtures/libs/stc.library` because
 * two extensions call it and neither can be read without it. The Game 0.9
 * reaches it for `G Encrypt`/`G Decrypt` and again for `G Stc Pack`/`G Stc
 * Unpack`, so the codec belongs here beside ../amiga/imploder.ts and
 * ../amiga/powerpacker.ts rather than in either port.
 *
 * Like those two this is a FROM-THE-FORMAT reimplementation and not a source
 * port: no StoneCracker source is in the corpus and none was used. Everything
 * below was read out of the library's own decruncher — `Decrunch` at $936,
 * which dispatches on the magic, and the S404 arm at $a46 — and out of the
 * cruncher's header writer at $3b6 and its tail at $83a.
 *
 * ## The entry points TGE uses
 *
 *     -$2a  AllocWork    -> d0 = a $5f88-byte work buffer, +8 for its own size
 *     -$30  FreeWork     a1 = that
 *     -$36  Decrunch     a0 = destination, a1 = crunched -> d0 = 1, or 0 for
 *                        a magic it does not know
 *     -$42  FreeFileBuf  a1 = a buffer from -$6c
 *     -$48  ReadFile     a0 = a buffer from -$6c -> d0 = bytes read
 *     -$60  Crunch       a0 = a TagItem list -> d0 = the crunched length
 *     -$6c  AllocFileBuf a0 = name, d0 = slack -> a buffer with the name and
 *                        the file's size in a 122-byte header behind it
 *
 * `Decrunch` also knows `S403`, at $958, which is a different format with a
 * different bit order and a table of its own at $994. It is NOT implemented
 * here: The Game's cruncher writes `S404` unconditionally (`move.l
 * #$53343034,(a6)+` at $3b6), so nothing this port produces or is handed by
 * `G Decrypt` can be one. `G Stc Unpack` can be handed anything, and that is
 * where the gap has to be closed.
 *
 * ## The file
 *
 *     +$00  "S404"
 *     +$04  the crunch buffer's slack; the decruncher SKIPS it (`addq.w #$4`)
 *     +$08  the decrunched length
 *     +$0c  the distance from HERE to the trailer
 *     +$10  the bitstream, as words
 *     ...   the trailer: three words
 *     ...   $000003f2 — HUNK_END, written PAST the length the cruncher
 *           reports, with a word of padding in front of it when the reported
 *           length would otherwise leave it unaligned
 *
 * The trailer is what makes the whole thing readable backwards:
 *
 *     +$00  how many bits the largest offset class uses. The Game asks for 12
 *           through the crunch tag list, giving a 4,640-byte window
 *     +$02  the initial bit buffer
 *     +$04  how many of its bits are valid
 *
 * Decrunching runs BACKWARDS from both ends towards the middle: the write
 * pointer starts at the end of the destination and descends, the read pointer
 * starts at the trailer and descends a word at a time, and the last thing the
 * cruncher emitted is the first thing read. So the encoder here works on a
 * REVERSED copy of the input, where the whole thing becomes an ordinary
 * forward LZ77 and a back-reference of distance `dist + 1` is what the
 * decruncher spells as an offset of `dist`.
 *
 * ## The bitstream
 *
 * Bits come out of the top of a 16-bit buffer, most significant first. The
 * codes, from the decision tree at $a8c..$ae6:
 *
 *     0                 a literal byte, 8 bits
 *     1 1 x             a match of 2 + x
 *     1 0 1     + 2b    a match of 4 + b
 *     1 0 0 1   + 4b    a match of 8 + b, for b < 15
 *     1 0 0 1   + 1111  + 5b: a literal RUN of 14 + b bytes
 *     1 0 0 0   + 8b    a match of 23 + b, and b = 255 reads another eight
 *                       bits and adds again, without limit
 *
 * and then, for a match only, the offset:
 *
 *     1     + <trailer> bits    dist = 544 + b
 *     0 1   + 5 bits            dist = b
 *     0 0   + 9 bits            dist = 32 + b
 *
 * A match copies `len` bytes descending from `w + dist` to `w - 1`, so a
 * source byte can be one this same copy has just written — the format's RLE.
 *
 * Two details of the machine code are worth writing down because they are
 * where a reimplementation goes wrong. The match length arrives in d3 as
 * `len - 2` and the two-byte case is built by `addx.w d0,d3` on a d3 that is
 * $ffff every time control reaches it — from `moveq #$ff,d3` at $a62 and at
 * $b5a, and from the `dbra d3` that ends every copy loop leaving -1. And the
 * literal-run copier at $b60 emits TWO bytes a pass, one straight and one
 * straddling a word boundary, which is why it can leave the bit counter eight
 * short for the whole run and put it back with a single `addq.w #$8,d7` at
 * the end.
 *
 * ## What is not checked
 *
 * There is no crunched file anywhere in the corpus to test against: `S404`
 * appears only inside the four libraries that know the magic, never as data.
 * So the tests round-trip this file's own pair, which cannot catch a reading
 * that is wrong the same way twice. Two things make that unlikely and are
 * worth saying rather than assuming. The length ladder is CONTIGUOUS — 2..3,
 * 4..7, 8..22, 23 up — and so are the three offset classes, 0..31, 32..543,
 * 544 up; a misread field width would leave a gap or an overlap at one of
 * those five joins. And the trailer's third word is written by the cruncher
 * as `16 - <free bits>` at $848, which is the count of VALID bits only if the
 * buffer is read from the top, as the decruncher's `add.w d6,d6` says it is.
 */

/** `S404`, the only magic this file writes and the only one it reads */
export const STC_S404 = 0x53343034
/** `S403`, which `Decrunch` at $958 handles and this file does not */
export const STC_S403 = 0x53343033

/** the largest offset class's bit count, which The Game asks for by tag */
export const STC_OFFSET_BITS = 12
/** `lea $20(a0),a2` and `lea $220(a0),a2`: the three offset classes' bases */
const OFF_BASES = [0, 0x20, 0x220] as const
/** a match copies at most this many bytes without the 255-escape */
const MAX_MATCH = 277
/** and at least this many */
const MIN_MATCH = 2

/** whether a buffer opens with a StoneCracker magic this file can decrunch */
export function isStoneCracked(data: Uint8Array): boolean {
  return data.length >= 16 && read32(data, 0) === STC_S404
}

/** the decrunched length a crunched buffer declares, without decrunching it */
export function stcLength(data: Uint8Array): number {
  return isStoneCracked(data) ? read32(data, 8) : 0
}

const read32 = (d: Uint8Array, at: number): number =>
  (((d[at] ?? 0) << 24) | ((d[at + 1] ?? 0) << 16) | ((d[at + 2] ?? 0) << 8) | (d[at + 3] ?? 0)) >>> 0

const read16 = (d: Uint8Array, at: number): number => (((d[at] ?? 0) << 8) | (d[at + 1] ?? 0)) & 0xffff

/**
 * Decrunch an `S404` buffer, or `null` for a magic this does not know.
 *
 * `null` rather than a throw because that is what the library answers: LVO
 * -$36 tests both magics and returns d0 = 0 having done nothing, and both of
 * The Game's callers test the result. An `S403` buffer lands here too, and it
 * is worth being clear that answering null for one is a limitation of this
 * file and not of the format.
 */
export function stcDecrunch(data: Uint8Array): Uint8Array | null {
  if (data.length < 16 || read32(data, 0) !== STC_S404) return null

  const length = read32(data, 8)
  const out = new Uint8Array(length)
  // `adda.l (a1),a1` with a1 at +$0c
  const trailer = 12 + read32(data, 12)
  if (trailer + 6 > data.length) return null

  const offBits = read16(data, trailer)
  /** a1, which only ever moves in whole words and only ever downwards */
  let rp = trailer
  /** d6's low word: bits leave from the top */
  let buf = read16(data, trailer + 2)
  /** d7: how many of them are still good */
  let cnt = read16(data, trailer + 4) << 16 >> 16
  /** a0 - a5, the write pointer as an index */
  let w = length

  /** `dbra d7,... / move.w -(a1),d6 / moveq #$f,d7 / add.w d6,d6` */
  const bit = (): number => {
    cnt -= 1
    if (cnt < 0) {
      rp -= 2
      buf = read16(data, rp)
      cnt = 15
    }
    const b = (buf >>> 15) & 1
    buf = (buf << 1) & 0xffff
    return b
  }

  /** the shared getbits at $b40, straddle and all */
  const bits = (n: number): number => {
    if (cnt >= n) {
      const v = n === 0 ? 0 : buf >>> (16 - n)
      buf = (buf << n) & 0xffff
      cnt -= n
      return v
    }
    const have = cnt
    const head = have === 0 ? 0 : buf >>> (16 - have)
    const need = n - have
    rp -= 2
    const next = read16(data, rp)
    buf = (next << need) & 0xffff
    cnt = 16 - need
    return ((head << need) | (next >>> (16 - need))) >>> 0
  }

  /**
   * The escape at $ae8: add the value, and while it was $ff read another
   * eight bits and add those too. `not.b d1` is the test, so only the 8-bit
   * arms can ever escape — a 2-bit or 4-bit read cannot reach 255.
   */
  const lengthFrom = (first: number, base: number): number => {
    let acc = base
    let n = first
    for (;;) {
      const v = bits(n)
      acc += v
      if ((v & 0xff) !== 0xff) return acc
      n = 8
    }
  }

  while (w > 0) {
    if (bit() === 0) {
      out[--w] = bits(8)
      continue
    }
    let len: number
    // each of these reads its OWN bit; they are a prefix code, not a
    // repeated test, and the tree is the one in the header
    const short = bit()
    if (short === 1) {
      // `addx.w d0,d3` on the $ffff d3 always holds here
      len = 2 + bit()
    } else if (bit() === 1) {
      len = 2 + lengthFrom(2, 2)
    } else if (bit() === 0) {
      len = 2 + lengthFrom(8, 0x15)
    } else {
      const v = bits(4)
      if (v === 15) {
        // the literal run, and the only code that is not a match
        let run = 14 + bits(5)
        while (run-- > 0 && w > 0) out[--w] = bits(8)
        continue
      }
      len = 2 + 6 + v
    }

    // the offset: one bit for the big class, then one more to pick between
    // the other two
    let cls: number
    let nbits: number
    const far = bit()
    if (far === 1) {
      cls = 2
      nbits = offBits
    } else if (bit() === 1) {
      cls = 0
      nbits = 5
    } else {
      cls = 1
      nbits = 9
    }
    let src = w + OFF_BASES[cls]! + bits(nbits)
    for (let i = 0; i < len; i++) {
      if (w <= 0) break
      out[--w] = src < length ? out[src]! : 0
      src -= 1
    }
  }

  return out
}

/**
 * Crunch to `S404`.
 *
 * A greedy match-finder over a hash chain, which is a plain LZ77 encoder
 * because the reversal above turns the format into one. It will not match
 * StoneCracker's own output byte for byte — the real cruncher has a $5f88
 * work buffer and takes its time — but the file it writes is a valid `S404`
 * that stc.library's own decruncher reads, which is the property that
 * matters. ../amiga/imploder.ts makes the same call in stronger terms and
 * stores its input outright; the difference is only that this format has no
 * stored mode, so a literal-only encoder would come out BIGGER than its
 * input at nine bits a byte.
 */
export function stcCrunch(src: Uint8Array, offsetBits: number = STC_OFFSET_BITS): Uint8Array {
  const n = src.length
  /** the encoder works forwards over the reversal; see the header */
  const r = new Uint8Array(n)
  for (let i = 0; i < n; i++) r[i] = src[n - 1 - i]!

  const maxDist = 0x220 + (1 << offsetBits)
  /** the bit sequence, in the order the decruncher will consume it */
  const out: number[] = []
  const put = (value: number, width: number): void => {
    for (let i = width - 1; i >= 0; i--) out.push((value >>> i) & 1)
  }

  /** three-byte hash chains, the usual arrangement */
  const HASH = 1 << 15
  const head = new Int32Array(HASH).fill(-1)
  const prev = new Int32Array(Math.max(1, n)).fill(-1)
  const hash = (at: number): number =>
    at + 2 < n ? (Math.imul((r[at]! << 16) | (r[at + 1]! << 8) | r[at + 2]!, 0x9e3779b1) >>> 17) & (HASH - 1) : 0

  let p = 0
  const pending: number[] = []

  /** the literal run at $b7a covers 14..45 bytes; below that, one code each */
  const flush = (): void => {
    let i = 0
    while (pending.length - i >= 14) {
      const take = Math.min(45, pending.length - i)
      put(0b1001, 4)
      put(15, 4)
      put(take - 14, 5)
      for (let k = 0; k < take; k++) put(pending[i + k]!, 8)
      i += take
    }
    for (; i < pending.length; i++) {
      put(0, 1)
      put(pending[i]!, 8)
    }
    pending.length = 0
  }

  while (p < n) {
    let bestLen = 0
    let bestDist = 0
    if (p + MIN_MATCH <= n) {
      let cand = head[hash(p)]!
      let tries = 64
      while (cand >= 0 && tries-- > 0) {
        const dist = p - cand
        if (dist > maxDist) break
        let len = 0
        while (len < MAX_MATCH && p + len < n && r[cand + len] === r[p + len]) len++
        if (len > bestLen) {
          bestLen = len
          bestDist = dist
        }
        if (bestLen >= MAX_MATCH) break
        cand = prev[cand]!
      }
    }

    if (bestLen >= MIN_MATCH) {
      flush()
      const len = bestLen
      if (len <= 3) {
        put(0b11, 2)
        put(len - 2, 1)
      } else if (len <= 7) {
        put(0b101, 3)
        put(len - 4, 2)
      } else if (len <= 22) {
        put(0b1001, 4)
        put(len - 8, 4)
      } else {
        put(0b1000, 4)
        put(len - 23, 8)
      }
      // dist as the decruncher spells it: one less than the back-distance
      const d = bestDist - 1
      if (d < 0x20) {
        put(0b01, 2)
        put(d, 5)
      } else if (d < 0x220) {
        put(0b00, 2)
        put(d - 0x20, 9)
      } else {
        put(1, 1)
        put(d - 0x220, offsetBits)
      }
      for (let k = 0; k < len; k++) {
        const h = hash(p)
        prev[p] = head[h]!
        head[h] = p
        p++
      }
    } else {
      pending.push(r[p]!)
      const h = hash(p)
      prev[p] = head[h]!
      head[h] = p
      p++
    }
  }
  flush()

  // pack: the first bits of the stream live in the trailer's own word, and
  // the rest fill words that the decruncher walks DOWN from it
  const total = out.length
  const lead = total % 16
  const words = (total - lead) / 16
  // the cruncher's tail at $83a pads to a longword before writing HUNK_END,
  // and the pad is inside the length it reports
  const body = 16 + words * 2 + 6
  const size = (body + 3) & ~3
  const file = new Uint8Array(size)
  const w32 = (at: number, v: number): void => {
    file[at] = (v >>> 24) & 0xff
    file[at + 1] = (v >>> 16) & 0xff
    file[at + 2] = (v >>> 8) & 0xff
    file[at + 3] = v & 0xff
  }
  const w16 = (at: number, v: number): void => {
    file[at] = (v >>> 8) & 0xff
    file[at + 1] = v & 0xff
  }
  w32(0, STC_S404)
  // +$04 is the slack the cruncher's own output buffer had in front of it,
  // and the decruncher steps straight over it; there is no such buffer here
  w32(4, 0)
  w32(8, n)
  const trailer = 16 + words * 2
  w32(12, trailer - 12)
  let at = 0
  let seed = 0
  for (; at < lead; at++) seed = (seed << 1) | out[at]!
  w16(trailer, offsetBits)
  w16(trailer + 2, (seed << (16 - lead)) & 0xffff)
  w16(trailer + 4, lead)
  for (let k = 0; k < words; k++) {
    let v = 0
    for (let i = 0; i < 16; i++) v = (v << 1) | out[at++]!
    w16(trailer - 2 - k * 2, v)
  }
  return file
}
