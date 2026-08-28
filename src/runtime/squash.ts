/**
 * The ST "Squasher II" codec, ported from the Squash / UnSquash routines in
 * the AMOS Pro Compiler extension (+CompExt.s:1027-1558).
 *
 * It is a forward-referencing, bit-packed LZ. The compressed data is a run of
 * 32-bit big-endian words that the DECODER reads BACKWARD, rebuilding the
 * output from its end toward its start; a match copies from a position AHEAD
 * of the current one (already reconstructed, since we move backward). Each
 * word carries a single moving "guard" marker bit, which makes the bitstream
 * self-delimiting, and a running XOR of every data word is stored as an
 * integrity checksum. Two trailer longs follow the words: the checksum, then
 * the original (decompressed) length.
 *
 * The token grammar (bit fields, read backward — MSB of each field first):
 *   0 1              -> match, length 2, 8-bit offset
 *   0 0 <3-bit n>    -> n+1 literal bytes (1..8)
 *   1 00 <9-bit off> -> match, length 3, 9-bit offset
 *   1 01 <10 off>    -> match, length 4, 10-bit offset
 *   1 10 <8 len><12 off> -> match, length len+1 (2..256), 12-bit offset
 *   1 11 <8-bit n>   -> n+9 literal bytes (9..264)
 * An "offset" is the forward distance to an identical region.
 */
import { AmosError } from '../interp/values'

const notSquashed = (): never => {
  // maps to UnSquash's -1 (bad checksum) / -2 (out of bounds) error returns
  throw new AmosError('Not a squashed block', 23)
}

/** Decompress a Squasher block (UnSquash, +CompExt.s:1468). */
export function unsquash(buf: Uint8Array): Uint8Array {
  if ((buf.length & 3) !== 0 || buf.length < 12) notSquashed()

  // A0 walks the compressed words backward from the end.
  let a0 = buf.length
  const rdLong = (): number => {
    if (a0 < 4) notSquashed()
    a0 -= 4
    return ((buf[a0]! << 24) | (buf[a0 + 1]! << 16) | (buf[a0 + 2]! << 8) | buf[a0 + 3]!) >>> 0
  }

  const origLen = rdLong()
  // A length of zero is not a squashed block, and this used to RETURN one --
  // an empty Uint8Array, before the checksum was so much as looked at. Any
  // file ending in a zero longword decoded "successfully" to nothing, which
  // three of APD426's IFF 8SVX sample banks do. The checksum cannot catch it
  // either: their tails are zeros, so the stored checksum and the first bit
  // word are both zero and they cancel. What settles it is that `squash`
  // below refuses to emit anything that is not at least 33 bytes smaller than
  // its input, so no encoder ever produces a block whose original length is 0.
  if (origLen === 0) notSquashed()
  const out = new Uint8Array(origLen)
  let a2 = origLen // output write cursor, moves backward
  let d5 = rdLong() // checksum accumulator (seeded with the stored checksum)
  let d0 = rdLong() // current bit-word
  // and every bit word carries a guard bit, so a zero one is not a bit word.
  // This is the same test one step earlier: it rejects a run of zeros before
  // the decoder starts walking off the end of the buffer looking for tokens.
  if (d0 === 0) notSquashed()
  d5 = (d5 ^ d0) >>> 0

  // pull one bit from the low end of d0; refill from the previous word when
  // the guard bit is reached (d0 becomes 0) — the mirror of add_d0_bits
  const bit = (): number => {
    const c = d0 & 1
    d0 = d0 >>> 1
    if (d0 !== 0) return c
    d0 = rdLong()
    d5 = (d5 ^ d0) >>> 0
    const b = d0 & 1
    d0 = (0x80000000 | (d0 >>> 1)) >>> 0
    return b
  }
  const bits = (n: number): number => {
    let v = 0
    for (let i = 0; i < n; i++) v = ((v << 1) | bit()) >>> 0
    return v
  }
  const literal = (byte: number): void => {
    if (a2 <= 0) notSquashed()
    out[--a2] = byte & 0xff
  }
  const copy = (count: number, offBits: number): void => {
    const off = bits(offBits)
    for (let c = 0; c < count; c++) {
      if (--a2 < 0) notSquashed()
      out[a2] = out[a2 + off]!
    }
  }

  for (;;) {
    if (bit() === 0) {
      if (bit() === 1) copy(2, 8)
      else for (let n = bits(3) + 1; n > 0; n--) literal(bits(8))
    } else {
      const cat = bits(2)
      if (cat < 2) copy(cat + 3, 9 + cat)
      else if (cat === 2) copy(bits(8) + 1, 12)
      else for (let n = bits(8) + 9; n > 0; n--) literal(bits(8))
    }
    if (a2 <= 0) break
  }
  if (d5 !== 0) notSquashed() // checksum mismatch => corrupt data
  return out
}

/** category offset ceilings (code_table/o0-o6, +CompExt.s:1139): 256/512/1024/4096 */
function usableLen(off: number, len: number): number {
  if (len < 2) return 0
  if (off < 256) return len // length 2+ all fit
  if (off < 512) return len >= 3 ? len : 0
  if (off < 1024) return len >= 4 ? len : 0
  return len >= 5 ? len : 0 // off < 4096
}

/**
 * Compress a block (Squash, +CompExt.s:1049). Returns the compressed bytes, or
 * null when the result is not at least 33 bytes smaller than the input — the
 * original's "inefficient compression" case (returns -1). `window` is the
 * forward match-search reach (the keyword's `speed`).
 *
 * This emits a standard Squasher stream (our faithful unsquash — and the
 * original — decode it), but uses a plain greedy longest-forward-match search
 * rather than porting ST Squasher's pre-scan/cost heuristics, so the exact
 * byte output may differ from the original encoder's.
 */
export function squash(input: Uint8Array, window = 4096): Uint8Array | null {
  const n = input.length
  const words: number[] = []
  let d2 = 1 // guard bit
  let d7 = 0 // checksum

  // append `nbits` of `value`, low bit first, flushing a word when the guard
  // rolls out of the top (add_d0_bits_from_d3 / insert_next_long)
  const emit = (nbits: number, value: number): void => {
    let d3 = value >>> 0
    let d0 = (nbits - 1) & 0xffff
    for (;;) {
      const b = d3 & 1
      d3 = d3 >>> 1
      const carry = (d2 >>> 31) & 1
      d2 = ((d2 << 1) | b) >>> 0
      if (carry) {
        words.push(d2 >>> 0)
        d7 = (d7 ^ d2) >>> 0
        d2 = 1
      }
      if (d0 === 0) break
      d0 = (d0 - 1) & 0xffff
    }
  }
  const flushWord = (): void => {
    words.push(d2 >>> 0)
    d7 = (d7 ^ d2) >>> 0
    d2 = 1
  }
  const flushRun = (count: number): void => {
    if (count === 0) return
    if (count < 9) emit(5, count - 1) // 1..8 literals
    else emit(11, ((count - 9) & 0xff) | 0x700) // 9..264 literals
  }
  const emitMatch = (len: number, off: number): void => {
    // order: offset, [length], prefix — so the decoder reads prefix first
    if (len === 2) {
      emit(8, off)
      emit(2, 1)
    } else if (len === 3) {
      emit(9, off)
      emit(3, 4)
    } else if (len === 4) {
      emit(10, off)
      emit(3, 5)
    } else {
      emit(12, off)
      emit(8, len - 1)
      emit(3, 6)
    }
  }

  const maxOff = Math.min(window, 4095)
  let pending = 0
  let i = 0
  while (i < n) {
    let bestLen = 0
    let bestOff = 0
    for (let off = 1; off <= maxOff && i + off < n; off++) {
      const cap = Math.min(256, n - i, n - (i + off))
      let l = 0
      while (l < cap && input[i + l] === input[i + off + l]) l++
      const u = usableLen(off, l)
      if (u > bestLen) {
        bestLen = u
        bestOff = off
      }
    }
    if (bestLen >= 2) {
      flushRun(pending)
      pending = 0
      emitMatch(bestLen, bestOff)
      i += bestLen
    } else {
      emit(8, input[i]!)
      i++
      if (++pending === 264) {
        flushRun(pending)
        pending = 0
      }
    }
  }
  flushRun(pending)
  flushWord()
  words.push(d7 >>> 0) // checksum
  words.push(n >>> 0) // original length

  const out = new Uint8Array(words.length * 4)
  for (let w = 0; w < words.length; w++) {
    const v = words[w]! >>> 0
    out[w * 4] = (v >>> 24) & 0xff
    out[w * 4 + 1] = (v >>> 16) & 0xff
    out[w * 4 + 2] = (v >>> 8) & 0xff
    out[w * 4 + 3] = v & 0xff
  }
  // "Squashed >= Normal": the original needs a >32 byte win (ok_squash 1244)
  return n > out.length + 32 ? out : null
}
