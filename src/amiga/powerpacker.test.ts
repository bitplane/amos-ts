import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHECKED, HAS_ANCIENT, ORACLE, ORACLE_REQUIRED, ancientIdentify, ancientVerify } from '../testing/oracle'
import { pp20Crunch, pp20Decrunch } from './powerpacker'

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s
  }
}

/**
 * An INDEPENDENT PP20 decoder — a transcription of amigadepack 0.02's
 * ppDecrunch, using a byte-backward, LSB-accumulating bit reader that is
 * structurally unlike powerpacker.ts's 32-bit-word reader. Because it shares no
 * code with our codec, a decode through it that matches proves our encoder
 * emits real-format PP20 (not merely something our own decoder can read), and
 * rules out any encoder/decoder bug that would cancel out in a self round-trip.
 */
function refDecrunch(file: Uint8Array): Uint8Array {
  const eff = [file[4]!, file[5]!, file[6]!, file[7]!]
  const n = file.length
  const declen = (file[n - 4]! << 16) | (file[n - 3]! << 8) | file[n - 2]!
  const skip = file[n - 1]!
  const out = new Uint8Array(declen)
  let src = n - 4 // one past the last crunched byte
  let buf = 0
  let left = 0
  const read = (nb: number): number => {
    while (left < nb) {
      buf |= file[--src]! << left // accumulate a byte at the low end
      left += 8
    }
    let r = 0
    for (let i = 0; i < nb; i++) {
      r = (r << 1) | (buf & 1) // pull bits LSB-first, assemble MSB-first
      buf >>>= 1
      left--
    }
    return r
  }
  read(skip)
  let dst = declen
  while (dst > 0) {
    if (read(1) === 0) {
      let cnt = 1
      let t: number
      do {
        t = read(2)
        cnt += t
      } while (t === 3)
      while (cnt-- > 0) out[--dst] = read(8)
      if (dst === 0) break
    }
    const b = read(2)
    let dist: number
    let len: number
    if (b < 3) {
      dist = read(eff[b]!) + 1
      len = b + 2
    } else {
      dist = read(read(1) ? eff[3]! : 7) + 1
      len = 5
      let t: number
      do {
        t = read(3)
        len += t
      } while (t === 7)
    }
    while (len-- > 0) {
      out[dst - 1] = out[dst - 1 + dist]!
      dst--
    }
  }
  return out
}

function roundtrip(bytes: number[] | Uint8Array): void {
  const input = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
  const packed = pp20Crunch(input)
  expect((packed.length - 12) & 3).toBe(0) // header + whole words + trailer
  expect(Array.from(pp20Decrunch(packed))).toEqual(Array.from(input))
}

describe('PowerPacker PP20 codec (documented format — self-consistent)', () => {
  it('emits a standard PP20 container', () => {
    const packed = pp20Crunch(new Uint8Array(400).fill(0x2a))
    expect(String.fromCharCode(packed[0]!, packed[1]!, packed[2]!, packed[3]!)).toBe('PP20')
    expect([packed[4], packed[5], packed[6], packed[7]]).toEqual([9, 10, 12, 13]) // efficiency
    // last 4 bytes: 24-bit decrunched length + skip count
    expect((packed[packed.length - 4]! << 16) | (packed[packed.length - 3]! << 8) | packed[packed.length - 2]!).toBe(400)
  })

  it('round-trips repetitive, structured and text data', () => {
    roundtrip(new Uint8Array(3000).fill(0x55))
    roundtrip('ABCABCABC'.repeat(300).split('').map((c) => c.charCodeAt(0)))
    const txt = 'PowerPacker crunches Amiga data well. '.repeat(100)
    roundtrip([...txt].map((c) => c.charCodeAt(0)))
  })

  it('round-trips long matches beyond the near-offset window', () => {
    // a block, then a far copy of it (distance > 128 forces the wide offset)
    const a: number[] = []
    const rnd = lcg(99)
    for (let k = 0; k < 500; k++) a.push(rnd() & 0xff)
    a.push(...new Array(300).fill(0x00))
    a.push(...a.slice(0, 500))
    roundtrip(a)
  })

  it('round-trips pseudo-random data across seeds', () => {
    for (const seed of [1, 7, 42, 0xbeef, 0x1234abcd]) {
      const rnd = lcg(seed)
      const len = 1200 + (rnd() % 900)
      const data = new Uint8Array(len)
      for (let i = 0; i < len; i++) data[i] = rnd() % 5 === 0 ? rnd() & 0xff : data[Math.max(0, i - (1 + (rnd() % 60)))] ?? 0
      roundtrip(data)
    }
  })

  it('handles trailing-literal tails (data ends incompressible)', () => {
    const rnd = lcg(3)
    const a = new Array(200).fill(0x41) // compressible head
    for (let k = 0; k < 30; k++) a.push(rnd() & 0xff) // random tail -> literals
    roundtrip(a)
  })

  it('rejects a non-PP20 buffer', () => {
    expect(() => pp20Decrunch(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(/powerpacked/i)
  })
})

describe('PP20 verified against an independent reference decoder (amigadepack)', () => {
  // Our encoder emits real-format PP20 iff a foreign decoder can read it.
  function crossCheck(bytes: number[] | Uint8Array): void {
    const input = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
    const packed = pp20Crunch(input)
    expect(Array.from(refDecrunch(packed))).toEqual(Array.from(input)) // foreign decoder
    expect(Array.from(pp20Decrunch(packed))).toEqual(Array.from(input)) // and ours agree
  }

  it('a foreign decoder reproduces our crunched output across seeds', () => {
    for (const seed of [1, 7, 42, 0xbeef, 0x1234abcd, 999, 55555]) {
      const rnd = lcg(seed)
      const len = 400 + (rnd() % 3000)
      const data = new Uint8Array(len)
      for (let i = 0; i < len; i++) data[i] = rnd() % 5 === 0 ? rnd() & 0xff : (data[Math.max(0, i - (1 + (rnd() % 70)))] ?? 0)
      crossCheck(data)
    }
  })

  it('a foreign decoder handles every match class we emit', () => {
    crossCheck(new Uint8Array(3000).fill(0x55)) // long class-3 matches
    const far: number[] = []
    const rnd = lcg(5)
    for (let k = 0; k < 500; k++) far.push(rnd() & 0xff)
    far.push(...new Array(300).fill(0), ...far.slice(0, 500)) // far offset -> eff[3]
    crossCheck(far)
    crossCheck([...'ABABAB'.repeat(400)].map((c) => c.charCodeAt(0))) // short len-2/3 matches
  })
})

describe('PP20 decoder vs GENUINE PowerPacker output', () => {
  // A real PowerPacker-crunched AmigaGuide (PP20, efficiency "Best" = 09 0a 0c
  // 0d), lifted from an Amiga workbench partition. Local-only, like every other
  // fixture in this repo — the test skips when the tree is absent.
  const fixture = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'powerpacker', 'OctaMEDPlayer.guide.pp')

  it.skipIf(!existsSync(fixture))('decrunches a real crunched file to correct plaintext', () => {
    const file = new Uint8Array(readFileSync(fixture))
    expect(String.fromCharCode(file[0]!, file[1]!, file[2]!, file[3]!)).toBe('PP20')
    expect([file[4], file[5], file[6], file[7]]).toEqual([9, 10, 12, 13]) // "Best"

    const out = pp20Decrunch(file)
    expect(out.length).toBe(7907) // the file's own 24-bit trailer length
    const txt = new TextDecoder('latin1').decode(out)
    expect(txt.startsWith('@DATABASE OctaMEDPlayer Guide')).toBe(true) // valid AmigaGuide
    expect(txt).toContain('@NODE Main')
    expect(txt.trimEnd().endsWith('@ENDNODE')).toBe(true)

    // and the independent decoder agrees byte-for-byte on real data
    expect(Array.from(refDecrunch(file))).toEqual(Array.from(out))
  })
})

/**
 * The one rule `pp20Decrunch` does not enforce, and the bug that hid behind it.
 *
 * Real powerpacker.library reads the literal/match flag at the top of every
 * pass and only tests whether the output is full AFTER the literal branch. A
 * stream that finishes on a match therefore has one more flag bit than the
 * data needs, and it is set. `pp20Decrunch` stops as soon as the output is
 * full, so it never reads that bit and never misses it.
 *
 * For a long time `pp20Crunch` did not write it. The pair agreed with each
 * other and the files were unreadable to the real library, which is the exact
 * failure a self-checking encoder cannot see. The genuine fixture above did
 * not catch it either: it ends on a literal run, the one case where no extra
 * bit is due.
 *
 * The corpus settles what real PowerPacker does. Of its 23 crunched files, 15
 * end on a match and every one leaves exactly one bit unread, set in all 15.
 * The 6 that end on a literal run leave none.
 */
describe('PP20: the trailing flag bit a match-terminated stream owes', () => {
  /**
   * A decoder with real PowerPacker's loop shape rather than ours: the flag
   * comes first, the done-test comes after the literals. Running out of bits
   * throws, which is what the library would do by reading off the buffer.
   */
  function strictDecrunch(file: Uint8Array): Uint8Array {
    const dv = new DataView(file.buffer, file.byteOffset, file.byteLength)
    const eff = [file[4]!, file[5]!, file[6]!, file[7]!]
    const end = file.length
    const n = (file[end - 4]! << 16) | (file[end - 3]! << 8) | file[end - 2]!
    let pos = end - 4
    let word = 0
    let left = 0
    const getBit = (): number => {
      if (left === 0) {
        pos -= 4
        if (pos < 8) throw new Error('pp20: ran out of bits')
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
    for (let i = 0; i < file[end - 1]!; i++) getBit()

    const out = new Uint8Array(n)
    let p = n
    for (;;) {
      if (getBit() === 0) {
        let cnt = 1
        let t: number
        do {
          t = getBits(2)
          cnt += t
        } while (t === 3)
        while (cnt-- > 0) {
          if (p <= 0) throw new Error('pp20: literal past the start')
          out[--p] = getBits(8)
        }
      }
      if (p === 0) return out
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
        if (p <= 0 || p - 1 + dist >= n) throw new Error('pp20: match past the end')
        out[p - 1] = out[p - 1 + dist]!
        p--
      }
    }
  }

  /** three zero bytes is the shortest input whose stream finishes on a match */
  const MATCH_ENDING = new Uint8Array(3)
  /** a byte that matches nothing forces the last pass to be a literal run */
  const LITERAL_ENDING = Uint8Array.from([0xaa, 0, 0, 0, 0, 0, 0, 0, 0])

  it('writes the bit, so the real loop shape decodes what we produce', () => {
    for (const body of [MATCH_ENDING, LITERAL_ENDING, new Uint8Array(3000), Uint8Array.from({ length: 5000 }, (_, i) => i & 0x3f)]) {
      expect(Array.from(strictDecrunch(pp20Crunch(body)))).toEqual(Array.from(body))
    }
  })

  it('and the bit is the only thing between the two loop shapes', () => {
    // one literal, then a two-byte match at distance one: 22 bits, then the
    // owed flag. One word, 9 bits of padding, and the flag is the last bit
    // read, which is why it lands in the top bit of the word.
    const packed = pp20Crunch(MATCH_ENDING)
    expect(Array.from(packed)).toEqual([
      0x50, 0x50, 0x32, 0x30, // PP20
      0x09, 0x0a, 0x0c, 0x0d, // efficiency, "Best"
      0x80, 0x00, 0x00, 0x00, // the stream, the owed flag in bit 31
      0x00, 0x00, 0x03, 0x09, // 3 bytes out, 9 bits of padding
    ])
    expect(Array.from(pp20Decrunch(packed))).toEqual([0, 0, 0])

    // and the same stream as it was written before this was understood: no
    // flag, so one fewer bit of data and one more of padding. Our decoder
    // reads it perfectly. The real loop shape reaches for a bit that is not
    // there, which is a read off the end of the buffer on the machine.
    const asItWas = Uint8Array.from([
      0x50, 0x50, 0x32, 0x30, 0x09, 0x0a, 0x0c, 0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x0a,
    ])
    expect(Array.from(pp20Decrunch(asItWas))).toEqual([0, 0, 0])
    expect(() => strictDecrunch(asItWas)).toThrow(/ran out of bits/)
  })

  it('owes nothing when the stream finishes on a literal run', () => {
    const packed = pp20Crunch(LITERAL_ENDING)
    expect(Array.from(strictDecrunch(packed))).toEqual(Array.from(LITERAL_ENDING))
    expect(Array.from(pp20Decrunch(packed))).toEqual(Array.from(LITERAL_ENDING))
  })

  const fixture = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'powerpacker', 'OctaMEDPlayer.guide.pp')
  it.skipIf(!existsSync(fixture))('reads the genuine file under the strict loop too', () => {
    const file = new Uint8Array(readFileSync(fixture))
    expect(strictDecrunch(file).length).toBe(7907)
  })
})

/**
 * `ancient` as an outside reader of `pp20Crunch`.
 *
 * The amigadepack transcription above is independent of our codec but not of
 * this repo: both it and `pp20Decrunch` were written here, from the same
 * understanding of the format, and both missed the trailing flag bit for the
 * same reason. `ancient` was written by somebody who never saw either.
 */
describe('PowerPacker against ancient, an independent implementation', () => {
  const CASES: Array<[string, Uint8Array]> = [
    ['one byte', new Uint8Array([65])],
    ['three zeros, the shortest match-ending stream', new Uint8Array(3)],
    ['a long run', new Uint8Array(3000)],
    ['text', Uint8Array.from('AMOS Professional '.repeat(600), (c) => c.charCodeAt(0) & 0xff)],
    ['incompressible', Uint8Array.from({ length: 20_000 }, (_, i) => (Math.imul(i + 1, 2654435761) >>> 16) & 0xff)],
    ['a ramp, which is all short matches', Uint8Array.from({ length: 5000 }, (_, i) => i & 0x3f)],
    ['a far offset, which reaches eff[3]', (() => {
      const b = new Uint8Array(1300)
      for (let i = 0; i < 500; i++) b[i] = (Math.imul(i + 7, 2246822519) >>> 13) & 0xff
      b.set(b.subarray(0, 500), 800)
      return b
    })()],
  ]

  it('is installed wherever it is required', () => {
    if (!ORACLE_REQUIRED) return
    expect(HAS_ANCIENT, 'AMOS_ORACLE=1 but `ancient` is not on PATH').toBe(true)
  })

  it.skipIf(!HAS_ANCIENT)('records which build produced the evidence', () => {
    expect(CHECKED, `ancient ${ORACLE} has not been checked against this file`).toContain(ORACLE)
  })

  it.skipIf(!HAS_ANCIENT)('decodes every stream pp20Crunch writes', () => {
    for (const [name, body] of CASES) {
      const packed = pp20Crunch(body)
      expect(ancientIdentify(packed), name).toContain('PP: PowerPacker')
      expect(ancientVerify(packed, body), name).toContain('Files match!')
    }
  })

  it.skipIf(!HAS_ANCIENT)('and refuses the streams written before the flag bit was understood', () => {
    // the same three zeros, one bit short. Proof that the check above is
    // reaching the thing it claims to: without the fix it fails, with it it
    // passes, and `pp20Decrunch` cannot tell the two apart.
    const asItWas = Uint8Array.from([
      0x50, 0x50, 0x32, 0x30, 0x09, 0x0a, 0x0c, 0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x0a,
    ])
    expect(ancientIdentify(asItWas)).toContain('PP: PowerPacker')
    expect(ancientVerify(asItWas, new Uint8Array(3))).not.toContain('Files match!')
  })
})
