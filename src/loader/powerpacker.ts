/**
 * PowerPacker (PP20) crunch/decrunch, plus the AMOS "PPbk" bank wrapper used
 * by Ppload/Ppsave (+CompExt.s:455-767).
 *
 * IMPORTANT: the actual crunch/decrunch is powerpacker.library — a ROM library
 * that is NOT part of the AMOS source (AMOS only calls ppDecrunchBuffer /
 * ppWriteDataHeader). This is therefore a from-the-documented-format
 * implementation, not a source port, and there is no real PowerPacker-produced
 * vector in the tree to check against. The encoder and decoder here are exact
 * mirrors, so they round-trip within amos-ts and the container is standard
 * PP20 layout — but bit-exact compatibility with data crunched by the *real*
 * PowerPacker is UNVERIFIED. See the NOTES on `ppload`.
 *
 * PP20 file: "PP20", 4 efficiency bytes (offset bit-widths), the crunched
 * 32-bit words, then a trailer of a 24-bit big-endian decrunched length and a
 * one-byte count of padding bits in the first word read. The decoder reads the
 * words BACKWARD, rebuilding the output from its end; matches reference a
 * position ahead (already reconstructed).
 */
import { AmosError } from '../interp/values'

const PP20 = 0x50503230 // "PP20"
const DEFAULT_EFFICIENCY = [9, 10, 12, 13] as const

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
  if (n >= 1 << 24) throw new AmosError('Illegal function call', 23)

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
    } else {
      lits.push(data[p - 1]!)
      p -= 1
    }
  }
  if (lits.length > 0) {
    putBit(0)
    emitLiterals(lits)
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
  if (file.length < 12 || ((file.length - 12) & 3) !== 0) throw new AmosError('Not a powerpacked block', 23)
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength)
  if (dv.getUint32(0) !== PP20) throw new AmosError('Not a powerpacked block', 23)
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
      if (pos < 8) throw new AmosError('Not a powerpacked block', 23)
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
        if (p <= 0) throw new AmosError('Not a powerpacked block', 23)
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
      if (p <= 0 || p - 1 + dist >= n) throw new AmosError('Not a powerpacked block', 23)
      out[p - 1] = out[p - 1 + dist]!
      p--
    }
  }
  return out
}

// ---- AMOS "PPbk" bank container (+CompExt.s:686-767 / 492-553) -------------

export interface PpBank {
  /** the bank number recorded in the header */
  number: number
  /** the AMOS bank flag word (Bnk_Bit* bits) */
  flags: number
  /** the decrunched bank payload */
  data: Uint8Array
}

/** Parse a PPbk file: header + a PP20-crunched payload. */
export function parsePpBank(file: Uint8Array): PpBank {
  if (file.length < 16) throw new AmosError('Not a powerpacked bank', 23)
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength)
  if (String.fromCharCode(file[0]!, file[1]!, file[2]!, file[3]!) !== 'PPbk') {
    throw new AmosError('Not a powerpacked bank', 23)
  }
  const number = dv.getUint16(4)
  const flags = dv.getUint16(6)
  // header: PPbk(4) number(2) flags(2) bankLen(4) ppLen(4) then the PP20 file
  const data = pp20Decrunch(file.subarray(16))
  return { number, flags, data }
}

/** Build a PPbk file wrapping a PP20-crunched payload. */
export function writePpBank(bank: PpBank, eff: readonly number[] = DEFAULT_EFFICIENCY): Uint8Array {
  const pp = pp20Crunch(bank.data, eff)
  const out = new Uint8Array(16 + pp.length)
  const dv = new DataView(out.buffer)
  out[0] = 0x50 // 'P'
  out[1] = 0x50 // 'P'
  out[2] = 0x62 // 'b'
  out[3] = 0x6b // 'k'
  dv.setUint16(4, bank.number & 0xffff)
  dv.setUint16(6, bank.flags & 0xffff)
  dv.setUint32(8, bank.data.length) // decrunched bank length
  dv.setUint32(12, pp.length) // crunched PP20 length
  out.set(pp, 16)
  return out
}
