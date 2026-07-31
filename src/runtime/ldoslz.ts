/**
 * The LDos 2.6 packer — `Lcompress` (routine 83, $382c) and `Ldecompress`
 * (routine 84, $39d8), read out of `AMOSPro_LDos.Lib`.
 *
 * LZ77 with a run-length case, over a 16-bit control-word bitstream. The
 * manual describes what the keywords are for and nothing of the format, so
 * everything below is the disassembly.
 *
 * ## The stream
 *
 * A control word, then up to 16 items, then the next control word, and so on.
 * The word is big-endian and its bits are read from 15 down to 0. A clear bit
 * is one literal byte. A set bit is a token whose first byte splits into two
 * nibbles, and the high nibble picks the form:
 *
 *   high 0   short run   run = low + 3          (3..18), then the byte
 *   high 1   long run    run = low + (b<<4) + 19, then the byte
 *   high 2   long match  dist = (b<<4) + low + 3, then len = b2 + 16
 *   high 3+  short match len = high (3..15), dist = (b<<4) + low + 3
 *
 * A match distance is at most 4098 (`cmp.l #$1002,d4`, $3974) and reaches back
 * into what has already been written, so runs longer than the distance repeat
 * — the copy is byte by byte. The decoder's longword copies (`move.l (a6)+,
 * (a4)+`, $3ae6) are an alignment optimisation taken only when the distance is
 * even, never a change of meaning.
 *
 * ## Where it stops, and the tail that follows
 *
 * The decoder tests the source pointer ONLY after refilling a control word
 * (`cmpa.l a5,a3`, $3a20). Between refills it runs all sixteen items, whatever
 * the source pointer is doing.
 *
 * DEFECT: `Lcompress` does not pad its last group, so a stream almost always
 * ends part-way through one — and `Ldecompress` decodes the rest of that group
 * anyway, from bytes past the end of the compressed data. The result is up to
 * fifteen extra bytes written after the real output, and an OUTLEN that
 * counts them. Reproduced; the manual's "you must keep track of how large this
 * bank need to be yourself, since Lcompress saves no information about this"
 * is exactly the warning that goes with it.
 *
 * DEVIATION: on the Amiga those trailing bytes are whatever memory followed
 * the compressed data, so their VALUES are undefined; here the reads past the
 * end give zero. The count matches, the contents cannot. A program that trusts
 * anything past the length it compressed was reading uninitialised memory on
 * the real machine too.
 *
 * ## The matcher
 *
 * One candidate per position, from a 4,096-slot table of last-seen offsets
 * indexed by a 12-bit hash of the next three bytes ($3942-$3962). The table is
 * the $4000 bytes `Lcompress` allocates MEMF_CLEAR and frees on the way out;
 * a slot still zero gives a distance larger than 4098, which is how "no
 * candidate" is spelled. The hash is reproduced exactly here, `asr.b` sign
 * extension and all, because the byte a program gets out of `Lcompress` is
 * decided by it.
 *
 * Three identical bytes at the position are taken as a run instead, and the
 * run scan does NOT touch the table.
 */

/** the largest distance a match may reach back, `cmp.l #$1002,d4` */
const MAX_DIST = 0x1002
/** run scan limit, `move.w #$100f,d2` — 4,111 bytes beyond the first three */
const RUN_LIMIT = 0x100f
/** match scan limit, `move.w #$10f,d2` — 271 bytes */
const MATCH_LIMIT = 0x10f
/** `Lcompress` stops this far short of the end of the destination */
export const DEST_MARGIN = 0x30

/**
 * Ldecompress. Returns the bytes written, and never reads past `src.length`
 * even where the original would (see "Where it stops").
 */
export function ldecompress(src: Uint8Array, out: Uint8Array): number {
  let p = 0
  let o = 0
  let ctrl = 0
  let bit = 0
  const byteAt = (): number => {
    const v = p < src.length ? src[p]! : 0
    p++
    return v
  }
  for (;;) {
    bit--
    if (bit < 0) {
      ctrl = (byteAt() << 8) | byteAt()
      bit = 15
      if (p >= src.length) return o
    }
    if ((ctrl & (1 << bit)) === 0) {
      out[o++] = byteAt()
      continue
    }
    const token = byteAt()
    const high = token >> 4
    const low = token & 0x0f
    if (high >= 3) {
      const dist = (byteAt() << 4) + low + 3
      for (let i = 0; i < high; i++, o++) out[o] = out[o - dist]!
    } else if (high === 0) {
      const run = low + 3
      const b = byteAt()
      for (let i = 0; i < run; i++) out[o++] = b
    } else if (high === 1) {
      const run = low + (byteAt() << 4) + 19
      const b = byteAt()
      for (let i = 0; i < run; i++) out[o++] = b
    } else {
      const dist = (byteAt() << 4) + low + 3
      const len = byteAt() + 16
      for (let i = 0; i < len; i++, o++) out[o] = out[o - dist]!
    }
  }
}

/**
 * Lcompress. Writes into `out` and returns the compressed length, or 0 if the
 * data would not fit — which is the manual's "data could not be compressed",
 * and means the caller should keep the source.
 *
 * `limit` is the usable end of the destination, already reduced by the
 * library's margin.
 */
export function lcompress(src: Uint8Array, out: Uint8Array, limit: number): number {
  // the hash table, cleared: a zero slot is "nothing seen here yet", which
  // yields a distance past MAX_DIST and so is rejected like any other
  const table = new Int32Array(0x1000)

  let ctrlAt = 0 // a0, the reserved control-word slot
  let o = 2 // a2, where item data goes
  let ctrl = 0 // d3
  let bitsLeft = 16 // d0, one more than the first bit index
  let bit = 15
  let p = 0 // a1
  const end = src.length // a3

  const flush = (): void => {
    out[ctrlAt] = (ctrl >> 8) & 0xff
    out[ctrlAt + 1] = ctrl & 0xff
  }

  for (;;) {
    if (p >= end) {
      flush()
      return o
    }
    // 16 items to a control word; the 17th trip starts a new one
    bitsLeft--
    if (bitsLeft < 0) {
      flush()
      ctrl = 0
      bitsLeft = 15
      bit = 15
      ctrlAt = o
      o += 2
      if (o > limit) return 0
    } else {
      bit = bitsLeft
    }

    const at = p
    const b0 = src[at]!
    let emitted = false

    // three identical bytes at the position: a run, and the table is not
    // touched for it
    if (at + 2 < end && src[at + 1] === b0 && src[at + 2] === b0) {
      let extra = 0
      while (extra < RUN_LIMIT && at + 3 + extra < end && src[at + 3 + extra] === b0) extra++
      p = at + 3 + extra
      if (extra <= 15) {
        out[o++] = extra
        out[o++] = b0
      } else {
        const n = extra - 16
        out[o++] = 0x10 | (n & 0x0f)
        out[o++] = (n >> 4) & 0xff
        out[o++] = b0
      }
      emitted = true
    } else if (at + 2 < end) {
      // a match candidate, from the last position with the same three bytes
      const h = hash3(src, at)
      const prev = table[h]!
      table[h] = at
      const dist = at - prev
      if (prev !== 0 && dist <= MAX_DIST) {
        // `cmpa.l a5,a4; bcs` ($3986) stops the scan once the source of the
        // copy reaches the position being coded, so this encoder never emits
        // a match longer than its own distance even though the decoder would
        // happily repeat one
        let len = 0
        while (
          len < MATCH_LIMIT &&
          at + len < end &&
          prev + len <= at &&
          src[prev + len] === src[at + len]
        ) {
          len++
        }
        if (len >= 3) {
          p = at + len
          const d = dist - 3
          if (len <= 15) {
            out[o++] = (len << 4) | (d & 0x0f)
            out[o++] = (d >> 4) & 0xff
          } else {
            out[o++] = 0x20 | (d & 0x0f)
            out[o++] = (d >> 4) & 0xff
            out[o++] = len - 16
          }
          emitted = true
        }
      }
    }

    if (emitted) {
      ctrl |= 1 << bit
    } else {
      out[o++] = b0
      p = at + 1
    }
  }
}

/**
 * The 12-bit hash of the three bytes at `at`, exactly as $3942-$3962 computes
 * it. `asr.b #4,d7` is an ARITHMETIC shift of a byte, so a first byte of $80
 * or above brings ones down from the sign — reproduced, because it decides
 * which candidate the matcher finds and therefore what the output looks like.
 */
function hash3(src: Uint8Array, at: number): number {
  const b0 = src[at]!
  const b1 = src[at + 1]!
  const b2 = src[at + 2]!
  const lo = ((b0 & 0x0f) << 8) | b1
  const hi = (((b0 >> 4) | (b0 & 0x80 ? 0xf0 : 0)) | (b2 << 4)) & 0xffff
  return (lo ^ hi) & 0x0fff
}
