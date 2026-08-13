/**
 * PowerPacker (PP20) crunch/decrunch — the codec only.
 *
 * The AMOS "PPbk" bank header that `Ppload`/`Ppsave` wrap around a crunched
 * payload used to live here too, and does not belong: PP20 is a format a ROM
 * library defines, PPbk is sixteen bytes AMOS invented to carry a bank number,
 * defined in AMOS's own source (+CompExt.s:686-767). It is in
 * ../runtime/ppbank.ts.
 *
 * IMPORTANT: the actual crunch/decrunch is powerpacker.library — a ROM library
 * that is NOT part of the AMOS source (AMOS only calls ppDecrunchBuffer /
 * ppWriteDataHeader), so this is a from-the-format reimplementation, not a
 * source port. Its correctness is established three independent ways (see
 * powerpacker.test.ts):
 *   1. `pp20Decrunch` matches the MilkyTracker and amigadepack reference
 *      decoders line-by-line (bit reader, literal/match grammar, efficiency
 *      table, skip bits, 24-bit trailer).
 *   2. It decodes a GENUINE PowerPacker-crunched file (a real AmigaGuide) to
 *      byte-correct plaintext — real-world data, not a self-produced vector.
 *   3. Teemu Suutari's `ancient`, which read the format independently,
 *      decodes what `pp20Crunch` writes. That is a check on the ENCODER, and
 *      it is the one the other two cannot make.
 *
 * Point 3 arrived late and it caught a real bug. Until it ran, the encoder
 * was checked only by `pp20Decrunch`, and the two shared a misreading: a
 * stream ending on a match needs one more flag bit than the decoder here
 * demands, so `pp20Crunch` wrote files real powerpacker.library could not
 * open. See the note at the end of `pp20Crunch`. Five keywords went through
 * it, `Ppsave` among them.
 *
 * The decoder is faithful to real PowerPacker output. The *encoder* now emits
 * streams `ancient` accepts, but it is not bit-identical to
 * powerpacker.library's crunch choices (it compresses differently), which is
 * why Ppsave stays marked approximated.
 *
 * `pp20Decrunch` is still the more forgiving of the two, and deliberately.
 * It stops as soon as the output is full, so it reads a match-terminated
 * stream that lacks that final flag bit where the real library would run off
 * the end of the buffer. Nothing real is rejected by being lenient here, and
 * the encoder no longer produces such a stream.
 *
 * PP20 file: "PP20", 4 efficiency bytes (offset bit-widths), the crunched
 * 32-bit words, then a trailer of a 24-bit big-endian decrunched length and a
 * one-byte count of padding bits in the first word read. The decoder reads the
 * words BACKWARD, rebuilding the output from its end; matches reference a
 * position ahead (already reconstructed). A stream that finishes on a match
 * carries one further flag bit, set, which the real decruncher reads before it
 * notices the output is full.
 *
 * ## The errors are plain Errors, deliberately
 *
 * These used to be `AmosError('Not a powerpacked block', 23)` — AMOS error
 * number 23, raised from inside a library AMOS merely calls. That is caller
 * policy in a mechanism module, the same mistake as a shared `stampToYmd` that
 * clamps because one of its callers documents a clamp (see ./README.md).
 *
 * It also was not what most callers wanted. Of the three, LDos's
 * `Lpp Decrunch` and JD's `Jd Ppdecrunch` both catch and return quietly —
 * their own documentation says no check is made and the caller is on their
 * own — so only AMOS's own `Ppload` ever let it reach a program, and it
 * raises error 23 itself one line later for the bank kinds it will not load.
 * Translating there costs one try/catch and keeps the number where the
 * decision about it lives.
 */

const PP20 = 0x50503230 // "PP20"
export const DEFAULT_EFFICIENCY = [9, 10, 12, 13] as const

/** split `v` into groups of `bits` bits, all but the last equal to `cont`. */
function countGroups(v: number, cont: number, _bits: number): number[] {
  const out: number[] = []
  while (v >= cont) {
    out.push(cont)
    v -= cont
  }
  out.push(v)
  return out
}

/** largest match distance we will search (2^13, the widest offset field). */
const MAX_DIST = 1 << 13

/** offset ceilings per match length, from the efficiency table. */
function usableLen(dist: number, len: number, eff: readonly number[]): number {
  if (len < 2) return 0
  if (dist <= 1 << eff[0]!) return len // any length fits
  if (dist <= 1 << eff[1]!) return len >= 3 ? len : 0
  if (dist <= 1 << eff[2]!) return len >= 4 ? len : 0
  if (dist <= 1 << eff[3]!) return len >= 5 ? len : 0
  return 0
}

/** Crunch a block into a PP20 file. */
export function pp20Crunch(data: Uint8Array, eff: readonly number[] = DEFAULT_EFFICIENCY): Uint8Array {
  const n = data.length
  if (n >= 1 << 24) throw new Error('pp20: length exceeds the 24-bit header field')

  // R is the bit sequence the decoder will consume, in read order. We build it
  // by walking the input backward (the order the decoder produces output).
  const R: number[] = []
  const putBit = (b: number): void => {
    R.push(b & 1)
  }
  const putBits = (val: number, nb: number): void => {
    for (let i = nb - 1; i >= 0; i--) R.push((val >>> i) & 1)
  }
  const emitLiterals = (bytes: number[]): void => {
    for (const g of countGroups(bytes.length - 1, 3, 2)) putBits(g, 2)
    for (const b of bytes) putBits(b, 8)
  }
  const emitMatch = (dist: number, len: number): void => {
    const off = dist - 1
    if (len === 2) {
      putBits(0, 2)
      putBits(off, eff[0]!)
    } else if (len === 3) {
      putBits(1, 2)
      putBits(off, eff[1]!)
    } else if (len === 4) {
      putBits(2, 2)
      putBits(off, eff[2]!)
    } else {
      putBits(3, 2)
      if (dist <= 128) {
        putBit(0)
        putBits(off, 7)
      } else {
        putBit(1)
        putBits(off, eff[3]!)
      }
      for (const g of countGroups(len - 5, 7, 3)) putBits(g, 3)
    }
  }

  let p = n
  let lits: number[] = []
  let endedWithMatch = false
  while (p > 0) {
    let bestLen = 0
    let bestDist = 0
    const maxDist = Math.min(MAX_DIST, n - p) // source must stay in bounds
    for (let dist = 1; dist <= maxDist; dist++) {
      let l = 0
      while (p - 1 - l >= 0 && data[p - 1 - l] === data[p - 1 - l + dist]) l++
      const u = usableLen(dist, l, eff)
      if (u > bestLen) {
        bestLen = u
        bestDist = dist
      }
    }
    if (bestLen >= 2) {
      putBit(lits.length > 0 ? 0 : 1)
      if (lits.length > 0) emitLiterals(lits)
      emitMatch(bestDist, bestLen)
      lits = []
      p -= bestLen
      endedWithMatch = true
    } else {
      lits.push(data[p - 1]!)
      p -= 1
      endedWithMatch = false
    }
  }
  if (lits.length > 0) {
    putBit(0)
    emitLiterals(lits)
  } else if (endedWithMatch) {
    // A stream whose last operation is a match carries one more flag bit, and
    // it is a 1. Real PowerPacker reads the literal/match flag at the top of
    // every pass and only tests for completion after the literal branch, so
    // the final pass consumes a bit it does not need. Of the 23 crunched files
    // in the corpus, 15 end on a match; every one of them leaves exactly one
    // bit unread, and in all 15 that bit is 1. The 6 that end on a literal run
    // leave none.
    //
    // Omitting it wrote streams `pp20Decrunch` was happy with and
    // powerpacker.library was not, which is the failure a self-checking
    // encoder cannot see. `ancient` refused all 92 match-ending streams in a
    // 120-body sweep and accepted all 28 literal-ending ones.
    putBit(1)
  }

  // pad to a whole number of 32-bit words; the decoder discards `skip` bits
  const skip = (32 - (R.length % 32)) % 32
  const bits = new Array<number>(skip).fill(0).concat(R)
  const nWords = bits.length / 32
  const words = new Array<number>(nWords)
  for (let c = 0; c < nWords; c++) {
    let w = 0
    for (let i = 0; i < 32; i++) w = (w | (bits[c * 32 + i]! << i)) >>> 0
    words[c] = w >>> 0
  }
  // chunk 0 is read first => it is the LAST word in the file
  const out = new Uint8Array(8 + nWords * 4 + 4)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, PP20)
  out[4] = eff[0]!
  out[5] = eff[1]!
  out[6] = eff[2]!
  out[7] = eff[3]!
  for (let c = 0; c < nWords; c++) dv.setUint32(8 + (nWords - 1 - c) * 4, words[c]!)
  const trailer = 8 + nWords * 4
  out[trailer] = (n >>> 16) & 0xff
  out[trailer + 1] = (n >>> 8) & 0xff
  out[trailer + 2] = n & 0xff
  out[trailer + 3] = skip
  return out
}

/** Decrunch a PP20 file back to the original block. */
export function pp20Decrunch(file: Uint8Array): Uint8Array {
  if (file.length < 12 || ((file.length - 12) & 3) !== 0) throw new Error('pp20: not a powerpacked block')
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength)
  if (dv.getUint32(0) !== PP20) throw new Error('pp20: not a powerpacked block')
  const eff = [file[4]!, file[5]!, file[6]!, file[7]!]
  const end = file.length
  const n = (file[end - 4]! << 16) | (file[end - 3]! << 8) | file[end - 2]!
  const skip = file[end - 1]!

  let pos = end - 4 // exclusive end of the crunched words
  let word = 0
  let left = 0
  const getBit = (): number => {
    if (left === 0) {
      pos -= 4
      if (pos < 8) throw new Error('pp20: not a powerpacked block')
      word = dv.getUint32(pos) >>> 0
      left = 32
    }
    const b = word & 1
    word = word >>> 1
    left--
    return b
  }
  const getBits = (nb: number): number => {
    let v = 0
    for (let i = 0; i < nb; i++) v = ((v << 1) | getBit()) >>> 0
    return v
  }
  for (let i = 0; i < skip; i++) getBit() // discard the padding bits

  const out = new Uint8Array(n)
  let p = n
  while (p > 0) {
    if (getBit() === 0) {
      let cnt = 1
      let t: number
      do {
        t = getBits(2)
        cnt += t
      } while (t === 3)
      while (cnt-- > 0) {
        if (p <= 0) throw new Error('pp20: not a powerpacked block')
        out[--p] = getBits(8)
      }
      if (p === 0) break
    }
    const b = getBits(2)
    let dist: number
    let len: number
    if (b < 3) {
      dist = getBits(eff[b]!) + 1
      len = b + 2
    } else {
      dist = getBits(getBit() ? eff[3]! : 7) + 1
      len = 5
      let t: number
      do {
        t = getBits(3)
        len += t
      } while (t === 7)
    }
    while (len-- > 0) {
      if (p <= 0 || p - 1 + dist >= n) throw new Error('pp20: not a powerpacked block')
      out[p - 1] = out[p - 1 + dist]!
      p--
    }
  }
  return out
}
