/**
 * ByteKiller, against streams built BY HAND from the format ../amiga/
 * bytekiller.ts documents.
 *
 * Hand-built rather than round-tripped through a cruncher of my own, and
 * deliberately: a cruncher written from the same reading would share any
 * misreading with the decruncher and the pair would agree with each other all
 * the way to a wrong answer. Laying the bits out here means the test knows
 * what the stream says independently of what the decoder thinks.
 *
 * No real ByteKiller file is in the corpus to check against, which is the
 * limit of this file and is worth saying plainly. That is now measured
 * rather than assumed: every corpus file under 8MB went through `ancient
 * identify`, and it named 115 PowerPacker files, no ByteKiller and no
 * StoneCracker.
 *
 * `ancient` cannot stand in for the missing file either, and the reason is
 * worth writing down so nobody tries it twice. It does implement ByteKiller,
 * from 2.3.0 on, but what it recognises is a ByteKiller FILE. What this port
 * decodes is a bank payload behind the twelve-byte header Explode's
 * `L_BpkUnpack` expects, three longwords with no magic in them, and `ancient
 * identify` answers "Unknown or invalid compression format" for one. Working
 * out what framing it wants would mean reading its source, which is the one
 * thing this repo will not do with a third-party implementation.
 *
 * So of the four codecs in ../amiga that had only themselves to check
 * against, this is the one the oracle does not reach. PowerPacker,
 * StoneCracker and the Imploder are all confirmed from outside now.
 */
import { describe, expect, it } from 'vitest'
import { bpkDecrunch, bpkLength } from './bytekiller'

/**
 * A bitstream, laid out the way the packer has to lay it out.
 *
 * THE FIRST LONGWORD READ IS NOT LIKE THE OTHERS, and getting that wrong is
 * what this helper got wrong first time. The register is primed with a raw
 * `move.l` and drains until it reaches zero, so that longword needs a
 * sentinel the packer wrote and carries only the bits below it. Every reload
 * after it goes through `roxr.l #1,d0` with X set, which INJECTS a 1 at bit
 * 31 — so those longwords need no sentinel of their own and carry a full
 * thirty-two data bits.
 *
 * Longwords are read from the END of the file downwards, so the first word
 * read is written last.
 */
function stream(bits: number[]): Uint8Array {
  const n = bits.length
  // the primed word takes the remainder, 0 to 31 bits under its sentinel
  const first = n % 32
  const words: number[] = []
  let at = first
  while (at < n) {
    let w = 0
    for (let j = 0; j < 32; j++) if (bits[at + j]) w = (w | (1 << j)) >>> 0
    words.push(w >>> 0)
    at += 32
  }
  // ...and it goes last in the file, because the reader walks down
  let head = 0
  for (let j = 0; j < first; j++) if (bits[j]) head = (head | (1 << j)) >>> 0
  words.reverse()
  words.push((head | (1 << first)) >>> 0)
  const out = new Uint8Array(words.length * 4)
  words.forEach((w, i) => {
    out[i * 4] = (w >>> 24) & 0xff
    out[i * 4 + 1] = (w >>> 16) & 0xff
    out[i * 4 + 2] = (w >>> 8) & 0xff
    out[i * 4 + 3] = w & 0xff
  })
  return out
}

/** the twelve-byte header in front of a stream */
function file(body: Uint8Array, outLen: number, checksum = 0x12345678): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const put = (at: number, v: number): void => {
    out[at] = (v >>> 24) & 0xff
    out[at + 1] = (v >>> 16) & 0xff
    out[at + 2] = (v >>> 8) & 0xff
    out[at + 3] = v & 0xff
  }
  put(0, body.length)
  put(4, outLen)
  put(8, checksum)
  out.set(body, 12)
  return out
}

/** a byte as eight bits, most significant first — what `Bk8` reads */
const byte = (v: number): number[] => Array.from({ length: 8 }, (_, i) => (v >> (7 - i)) & 1)
/** an n-bit field, most significant first */
const field = (v: number, n: number): number[] => Array.from({ length: n }, (_, i) => (v >> (n - 1 - i)) & 1)

const text = (b: Uint8Array): string => String.fromCharCode(...b)

describe('ByteKiller: the short literal run', () => {
  it('writes its bytes BACKWARDS, which is the whole shape of the format', () => {
    // 0 0 + 3 bits (n=2) then three bytes: the decoder walks down from the
    // end of the output, so the first byte in the stream is the LAST byte out
    const bits = [0, 0, ...field(2, 3), ...byte(0x43), ...byte(0x42), ...byte(0x41)]
    expect(text(bpkDecrunch(file(stream(bits), 3)))).toBe('ABC')
  })

  it('a three-bit count reaches eight bytes and no further', () => {
    const eight = [...'HGFEDCBA'].flatMap((c) => byte(c.charCodeAt(0)))
    const bits = [0, 0, ...field(7, 3), ...eight]
    expect(text(bpkDecrunch(file(stream(bits), 8)))).toBe('ABCDEFGH')
  })

  it('and one byte is a count of zero, not a special case', () => {
    const bits = [0, 0, ...field(0, 3), ...byte(0x5a)]
    expect(text(bpkDecrunch(file(stream(bits), 1)))).toBe('Z')
  })
})

describe('ByteKiller: the long literal run', () => {
  it('1 11 + eight bits, and the count starts at NINE', () => {
    // `moveq #8,d4` before Bk2 adds eight to the three-bit case's own +1
    const nine = [...'IHGFEDCBA'].flatMap((c) => byte(c.charCodeAt(0)))
    const bits = [1, ...field(3, 2), ...field(0, 8), ...nine]
    expect(text(bpkDecrunch(file(stream(bits), 9)))).toBe('ABCDEFGHI')
  })

  it('so a count byte of 255 is 264 bytes', () => {
    const body = Array.from({ length: 264 }, (_, i) => 0x41 + (i % 26))
    const bits = [1, ...field(3, 2), ...field(255, 8), ...body.flatMap(byte)]
    const out = bpkDecrunch(file(stream(bits), 264))
    expect(out.length).toBe(264)
    // written backwards, so the stream's first byte is the output's last
    expect(out[263]).toBe(0x41)
    expect(out[0]).toBe(body[263])
  })
})

describe('ByteKiller: the matches, which copy DOWN from a higher address', () => {
  /**
   * Four literals "WXYZ", and they have to come FIRST in the stream.
   *
   * A match reads from `dst + offset` — above the write position — and the
   * decoder fills the output from its end downwards, so the bytes a match
   * copies are ones an earlier code already wrote. A stream that opens with a
   * match is reading memory it has not filled, which is what the first draft
   * of these tests did.
   */
  const tail = [0, 0, ...field(3, 3), ...byte(0x5a), ...byte(0x59), ...byte(0x58), ...byte(0x57)]

  it('0 1 + eight bits is two bytes', () => {
    const bits = [...tail, 0, 1, ...field(2, 8)]
    expect(text(bpkDecrunch(file(stream(bits), 6)))).toBe('WXWXYZ')
  })

  it('1 00 + nine bits is three, and 1 01 + ten bits is four', () => {
    const three = [...tail, 1, ...field(0, 2), ...field(3, 9)]
    expect(text(bpkDecrunch(file(stream(three), 7)))).toBe('WXYWXYZ')
    const four = [...tail, 1, ...field(1, 2), ...field(4, 10)]
    expect(text(bpkDecrunch(file(stream(four), 8)))).toBe('WXYZWXYZ')
  })

  it('1 10 + a count byte + twelve bits is any length', () => {
    // count 5 is six bytes, and an offset of 4 makes the four literals repeat
    const bits = [...tail, 1, ...field(2, 2), ...field(5, 8), ...field(4, 12)]
    expect(text(bpkDecrunch(file(stream(bits), 10)))).toBe('YZWXYZWXYZ')
  })

  it('and an offset of one repeats a single byte, because it copies one at a time', () => {
    const bits = [...tail, 1, ...field(2, 2), ...field(3, 8), ...field(1, 12)]
    expect(text(bpkDecrunch(file(stream(bits), 8)))).toBe('WWWWWXYZ')
  })
})

describe('ByteKiller: several codes in a row', () => {
  it('runs until the output is full and stops there', () => {
    const bits = [0, 0, ...field(1, 3), ...byte(0x42), ...byte(0x41), 0, 1, ...field(2, 8)]
    expect(text(bpkDecrunch(file(stream(bits), 4)))).toBe('ABAB')
  })

  it('and a stream deep enough to reload mid-code carries on through it', () => {
    // twelve literals is well past the first longword's thirty-one bits
    const twelve = [...'LKJIHGFEDCBA'].flatMap((c) => byte(c.charCodeAt(0)))
    const bits = [1, ...field(3, 2), ...field(3, 8), ...twelve]
    expect(text(bpkDecrunch(file(stream(bits), 12)))).toBe('ABCDEFGHIJKL')
  })
})

describe('ByteKiller: bpkLength, which is a sniff and not a magic number', () => {
  const bare = file(stream([0, 0, ...field(0, 3), ...byte(0x5a)]), 1)

  it('takes the decrunched length off a header that passes every test', () => {
    expect(bpkLength(bare)).toBe(1)
  })

  it('refuses a HUNK_HEADER, which is an executable and not crunched data', () => {
    const hunk = Uint8Array.from(bare)
    hunk.set([0, 0, 0x03, 0xf3])
    expect(bpkLength(hunk)).toBe(0)
  })

  it('refuses a crunched length of sixteen megabytes or more', () => {
    const big = Uint8Array.from(bare)
    big[0] = 1
    expect(bpkLength(big)).toBe(0)
  })

  it('refuses a zero checksum, the one field it insists on', () => {
    const nosum = file(stream([0, 0, ...field(0, 3), ...byte(0x5a)]), 1, 0)
    expect(bpkLength(nosum)).toBe(0)
  })

  it('and refuses anything that decrunches to 64KB or more', () => {
    // `tst.b 5(a0)`, which tests bits 16-23 of the DECRUNCHED length. The
    // byte above it would have meant "under sixteen megabytes"; this one
    // rejects the files the packer exists for
    expect(bpkLength(file(stream([0, 0]), 0xffff))).toBe(0xffff)
    expect(bpkLength(file(stream([0, 0]), 0x1_0000))).toBe(0)
  })

  it('and reads a self-extractor from its stub instead', () => {
    // "ave2" at $4c, the length at 238, the stream at 234
    const exe = new Uint8Array(234 + bare.length)
    exe.set([0x61, 0x76, 0x65, 0x32], 0x4c)
    exe.set(bare, 234)
    expect(bpkLength(exe)).toBe(1)
    expect(text(bpkDecrunch(exe))).toBe('Z')
  })
})
