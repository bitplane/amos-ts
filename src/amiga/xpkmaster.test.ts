import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHECKED, HAS_ANCIENT, ORACLE, ORACLE_REQUIRED } from '../testing/oracle'
import { loadHunks } from './hunk'
import { pp20Crunch } from './powerpacker'
import {
  XPKCHUNK_END,
  XPKCHUNK_PACKED,
  XPKCHUNK_RAW,
  XPKERR_CHECKSUM,
  XPKERR_CORRUPTPKD,
  XPKERR_MISSINGLIB,
  XPKERR_NOCRYPT,
  XPKERR_NOMEM,
  XPKERR_SMALLBUF,
  XPKERR_SUBTOOOLD,
  XPKERR_BADPASSWORD,
  XPKERR_PASSWORD,
  XPKERR_TRUNCATED,
  XPK_DEFAULT_CHUNK,
  XPK_MAGIC,
  XPK_MARGIN,
  XPK_MESSAGES,
  XPK_PACKERS,
  XpkError,
  xpkChunkChecksum,
  xpkErrorText,
  xpkExamine,
  xpkHeaderChecksum,
  xpkPack,
  xpkParseMethod,
  xpkUnpack,
  BLZW_HASH,
  NUKE_BITS,
  NUKE_BASE,
  NUKE_GROUP,
  NUKE_WINDOW,
  XPKERR_BIGBUF,
  XPKSTREAMF_LONGHDRS,
  XPKSTREAMF_PASSWORD,
  XPK_LONGHDR_ABOVE,
} from './xpkmaster'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '..', '..', 'fixtures')
const PP_FIXTURE = join(fixtures, 'powerpacker', 'OctaMEDPlayer.guide.pp')

const bytes = (...v: number[]): Uint8Array => new Uint8Array(v)
/** one byte, and never `undefined` -- these tests index fixed-size headers */
const at = (b: Uint8Array, i: number): number => b[i] ?? 0
const rd16 = (b: Uint8Array, o: number): number => (at(b, o) << 8) | at(b, o + 1)
const rd32 = (b: Uint8Array, o: number): number =>
  ((at(b, o) << 24) | (at(b, o + 1) << 16) | (at(b, o + 2) << 8) | at(b, o + 3)) >>> 0
const ascii = (s: string): Uint8Array =>
  new Uint8Array([...s].map((c) => c.charCodeAt(0)))
/**
 * Bytes no packer here can shrink.
 *
 * A xorshift and not `i * 2654435761`, which is what the NUKE tests use: that
 * multiply loses precision in a double and comes out compressible to a tenth,
 * which is fine for those tests and useless for BLZW's expansion guard.
 */
const noise = (n: number, seed = 1): Uint8Array => {
  let x = seed >>> 0
  return Uint8Array.from({ length: n }, () => {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return (x >>> 16) & 0xff
  })
}

/**
 * Total bits an optimal Huffman code spends on these counts.
 *
 * Textbook, with no tie-break rule at all: join the two smallest, repeat. The
 * total is the same whatever order ties come out in, which is why this can
 * check `xpkHUFF`'s tree without matching its `bhi` comparisons.
 */
const huffmanBits = (freq: Int32Array): number => {
  type Node = { f: number; kids: [Node, Node] | null; sym: number }
  const pool: Node[] = []
  for (let s = 0; s < 256; s++) if (freq[s]! > 0) pool.push({ f: freq[s]!, kids: null, sym: s })
  if (pool.length === 0) return 0
  // the one-value chunk, where $4de hands out a single 0 bit and a textbook
  // Huffman would hand out none
  if (pool.length === 1) return freq[pool[0]!.sym]!
  while (pool.length > 1) {
    pool.sort((a, b) => a.f - b.f)
    const x = pool.shift()!
    const y = pool.shift()!
    pool.push({ f: x.f + y.f, kids: [x, y], sym: -1 })
  }
  let total = 0
  const walk = (n: Node, d: number): void => {
    if (n.kids === null) {
      total += n.f * d
      return
    }
    walk(n.kids[0], d + 1)
    walk(n.kids[1], d + 1)
  }
  walk(pool[0]!, 0)
  return total
}

/** the code an XpkError carried, or a marker when nothing threw */
const codeOf = (fn: () => unknown): number => {
  try {
    fn()
  } catch (e) {
    return e instanceof XpkError ? e.code : NaN
  }
  return 0
}

describe('the checksums', () => {
  it('$2558 is a byte XOR', () => {
    expect(xpkHeaderChecksum(bytes(1, 2, 3), 0, 3)).toBe(1 ^ 2 ^ 3)
    expect(xpkHeaderChecksum(bytes(0xff, 0xff), 0, 2)).toBe(0)
    expect(xpkHeaderChecksum(bytes(9, 9, 9), 0, 0)).toBe(0) // len 0 folds nothing
  })

  it('$257e is a longword XOR folded onto its own low half', () => {
    // one longword: $11223344 -> $1122 ^ $3344
    expect(xpkChunkChecksum(bytes(0x11, 0x22, 0x33, 0x44), 0, 1)).toBe(0x1122 ^ 0x3344)
    // two identical longwords cancel
    expect(xpkChunkChecksum(bytes(1, 2, 3, 4, 1, 2, 3, 4), 0, 2)).toBe(0)
    // the high bit survives the fold rather than turning the accumulator negative
    expect(xpkChunkChecksum(bytes(0x80, 0, 0, 0), 0, 1)).toBe(0x8000)
  })
})

describe('the error table', () => {
  it('has all 32 codes the library ships strings for', () => {
    expect(XPK_MESSAGES.length).toBe(32)
    expect(xpkErrorText(-1)).toBe('Feature not implemented in selected library')
    expect(xpkErrorText(-15)).toBe("Can't find required XPK library")
    expect(xpkErrorText(-32)).toBe('Password incorrect')
  })

  it('names a code XPK never defined rather than returning undefined', () => {
    expect(xpkErrorText(-99)).toBe('XPK error -99')
    expect(new XpkError(-5).message).toBe('Check sum failure')
    expect(new XpkError(-5).code).toBe(-5)
  })
})

describe('xpkExamine, the three stream kinds of routine $450', () => {
  it('kind 1: anything unrecognised is raw, and its own length', () => {
    const fib = xpkExamine(ascii('hello, world'))
    expect(fib.kind).toBe('raw')
    expect(fib.type).toBe('----')
    expect(fib.uLen).toBe(12)
    expect(fib.cLen).toBe(12)
  })

  it('kind 3: PP20 length comes from the top three bytes of the last longword', () => {
    // $78a: asr.l #8 drops the skip-bits byte, leaving a 24-bit length.
    const f = new Uint8Array(16)
    f.set(ascii('PP20'))
    f[12] = 0x00
    f[13] = 0x12
    f[14] = 0x34
    f[15] = 0x07 // seven skip bits, not part of the length
    const fib = xpkExamine(f)
    expect(fib.kind).toBe('pp20')
    expect(fib.type).toBe('PP20')
    expect(fib.uLen).toBe(0x001234)
    expect(fib.cLen).toBe(16)
  })

  it('a file too short for its magic is truncated, not raw', () => {
    expect(codeOf(() => xpkExamine(bytes(1, 2, 3)))).toBe(XPKERR_TRUNCATED)
    expect(codeOf(() => xpkExamine(ascii('XPKF')))).toBe(XPKERR_TRUNCATED)
    expect(codeOf(() => xpkExamine(ascii('PP20')))).toBe(XPKERR_TRUNCATED)
  })
})

describe('xpkExamine on a real XPKF header', () => {
  /** a well-formed 36-byte stream header with the checksum settled */
  const header = (type: string, uLen: number, flags = 0): Uint8Array => {
    const h = new Uint8Array(36)
    h.set(ascii('XPKF'))
    h.set(ascii(type), 8)
    h[12] = (uLen >>> 24) & 0xff
    h[13] = (uLen >>> 16) & 0xff
    h[14] = (uLen >>> 8) & 0xff
    h[15] = uLen & 0xff
    h[32] = flags
    h[34] = 1
    h[35] = 1
    h[33] = xpkHeaderChecksum(h, 0, 36)
    return h
  }

  it('the 36 bytes XOR to zero once the checksum byte is in place', () => {
    expect(xpkHeaderChecksum(header('NONE', 100), 0, 36)).toBe(0)
  })

  it('a corrupt header byte fails the checksum, not the magic', () => {
    const h = header('NONE', 100)
    h[20] = at(h, 20) ^ 0x40
    expect(codeOf(() => xpkExamine(h))).toBe(XPKERR_CHECKSUM)
  })

  it('demands a password when the flags say the stream is encrypted, before decoding', () => {
    const h = header('NONE', 100, 2)
    expect(codeOf(() => xpkExamine(h))).toBe(XPKERR_PASSWORD)
    // $576 only tests that a password was SUPPLIED, not that it is right
    expect(xpkExamine(h, 'hunter2').flags).toBe(2)
  })

  it('an uninstalled compressor fails at examine, not at the first chunk', () => {
    // $608 opens compressors/xpkIDEA.library during the probe; $cf4 turns the
    // failure into MISSINGLIB. Nothing has been decoded at this point.
    expect(codeOf(() => xpkExamine(header('IDEA', 100)))).toBe(XPKERR_MISSINGLIB)
    expect(codeOf(() => xpkExamine(header('FEAL', 100)))).toBe(XPKERR_MISSINGLIB)
    // RLEN, NUKE, CBR0, BLZW, HUFF and IMPL used to be on this list and are
    // now installed, which is the point of keeping it
    expect(codeOf(() => xpkExamine(header('RLEN', 100)))).toBe(0)
    expect(codeOf(() => xpkExamine(header('NUKE', 100)))).toBe(0)
    expect(codeOf(() => xpkExamine(header('CBR0', 100)))).toBe(0)
    expect(codeOf(() => xpkExamine(header('BLZW', 100)))).toBe(0)
    expect(codeOf(() => xpkExamine(header('HUFF', 100)))).toBe(0)
  })

  it('reads the lengths and versions the master reads', () => {
    const fib = xpkExamine(header('NONE', 4321))
    expect(fib).toEqual({
      kind: 'xpk',
      type: 'NONE',
      uLen: 4321,
      cLen: 0, // this hand-built header leaves xsh_CLen zero
      flags: 0,
      subVrs: 1,
      masVrs: 1,
    })
  })
})

describe('xpkNONE.library, ported whole', () => {
  const NONE = XPK_PACKERS.get('NONE')

  it('shares LIBS:Compressors/ with the six packers that pack', () => {
    expect([...XPK_PACKERS.keys()]).toEqual(['NONE', 'RLEN', 'NUKE', 'CBR0', 'BLZW', 'HUFF', 'IMPL'])
  })

  it('LVO -36 XpkPackChunk always refuses: moveq #$ef,d0', () => {
    expect(NONE?.packChunk(ascii('aaaaaaaaaaaa'), 50)).toBe(null)
    expect(NONE?.packChunk(new Uint8Array(0), 0)).toBe(null)
  })

  it('LVO -54 XpkUnpackChunk is a CopyMem, and copies rather than aliases', () => {
    const src = ascii('abc')
    const out = NONE?.unpackChunk(src, 3)
    expect(Array.from(out ?? [])).toEqual([97, 98, 99])
    src[0] = 0
    expect(out?.[0]).toBe(97)
  })
})

describe('xpkPack writes the stream $1092/$1260 write', () => {
  const body = ascii('The quick brown fox jumps over the lazy dog. '.repeat(4))

  it('lays down XPKF, the method, the unpacked length and CLen = total - 8', () => {
    const s = xpkPack(body, 'NONE')
    expect(rd32(s, 0)).toBe(XPK_MAGIC)
    expect(String.fromCharCode(at(s, 8), at(s, 9), at(s, 10), at(s, 11))).toBe('NONE')
    const uLen = rd32(s, 12)
    expect(uLen).toBe(body.length)
    const cLen = rd32(s, 4)
    expect(cLen).toBe(s.length - 8) // $13f6
  })

  it('copies the first sixteen bytes into xsh_Initial', () => {
    const s = xpkPack(body, 'NONE')
    expect(Array.from(s.subarray(16, 32))).toEqual(Array.from(body.subarray(0, 16)))
  })

  it('stays in the word-length header form, because 32000 is under 65000', () => {
    const s = xpkPack(body, 'NONE')
    expect(at(s, 32) & 1).toBe(0) // XPKSTREAMF_LONGHDRS clear
    // $aec picks the header width off the settled chunk size, and no packer
    // held here asks for anything near it
    expect(XPK_DEFAULT_CHUNK).toBeLessThan(65000)
  })

  it("makes every chunk RAW, because NONE's answer is EXPANSION", () => {
    // $11de: the master clears the error and stores the input unchanged.
    const s = xpkPack(body, 'NONE')
    expect(at(s, 36)).toBe(XPKCHUNK_RAW)
    expect(at(s, 36)).not.toBe(XPKCHUNK_PACKED)
  })

  it('ends with a type-15 header and nothing after it', () => {
    const s = xpkPack(body, 'NONE')
    expect(at(s, s.length - 8)).toBe(XPKCHUNK_END)
    expect(xpkHeaderChecksum(s, s.length - 8, 8)).toBe(0)
  })

  it('zeroes the pad bytes so the chunk checksum is over defined data', () => {
    // $1248 writes four zeroes past the body before folding.
    const odd = ascii('abcde') // 5 bytes -> padded to 8
    const s = xpkPack(odd, 'NONE')
    expect(Array.from(s.subarray(36 + 8 + 5, 36 + 8 + 8))).toEqual([0, 0, 0])
  })

  it("splits at 32000, NONE's own xpi_DefChunk, not at the master's 32768", () => {
    // $a7e reads the packer's default FIRST and only falls back to $8000 when
    // it is zero. NONE's XpkInfo at data+$96 asks for 32000, so even the
    // packer that does nothing moves the chunk boundary.
    const big = new Uint8Array(32000 + 1000)
    for (let i = 0; i < big.length; i++) big[i] = (i * 7) & 0xff
    const s = xpkPack(big, 'NONE')
    expect(at(s, 36)).toBe(XPKCHUNK_RAW)
    expect(xpkHeaderChecksum(s, 36, 8)).toBe(0)
    const second = 36 + 8 + 32000
    expect(at(s, second)).toBe(XPKCHUNK_RAW)
    expect(xpkHeaderChecksum(s, second, 8)).toBe(0)
    expect((at(s, second + 4) << 8) | at(s, second + 5)).toBe(1000)
    expect(XPK_DEFAULT_CHUNK).toBe(32768)
  })

  it('refuses a method with no library, and NONE refuses to encrypt', () => {
    expect(codeOf(() => xpkPack(body, 'IDEA'))).toBe(XPKERR_MISSINGLIB)
    expect(codeOf(() => xpkPack(body, 'NONE', 'secret'))).toBe(XPKERR_NOCRYPT)
  })
})

describe('xpkUnpack', () => {
  it('kind 1 hands raw bytes back, copied not aliased', () => {
    const src = ascii('not packed at all')
    const out = xpkUnpack(src)
    expect(Array.from(out)).toEqual(Array.from(src))
    src[0] = 0
    expect(at(out, 0)).toBe(110)
  })

  it('kind 3 goes through powerpacker.library', () => {
    const plain = ascii('PowerPacker through XPK. '.repeat(40))
    const crunched = pp20Crunch(plain)
    expect(xpkExamine(crunched).kind).toBe('pp20')
    expect(xpkExamine(crunched).uLen).toBe(plain.length)
    expect(Array.from(xpkUnpack(crunched))).toEqual(Array.from(plain))
  })

  it('kind 3 on a mangled PP20 body reports CORRUPTPKD, not a raw throw', () => {
    const crunched = pp20Crunch(ascii('abcabcabcabcabcabc'.repeat(20)))
    crunched[8] = at(crunched, 8) ^ 0xff
    crunched[9] = at(crunched, 9) ^ 0xff
    const code = codeOf(() => xpkUnpack(crunched))
    expect([0, XPKERR_CORRUPTPKD]).toContain(code) // may still decode to garbage
  })

  it('round-trips an XPKF stream through the container', () => {
    for (const n of [0, 1, 3, 4, 5, 255, 4096, XPK_DEFAULT_CHUNK, XPK_DEFAULT_CHUNK + 1]) {
      const src = new Uint8Array(n)
      for (let i = 0; i < n; i++) src[i] = (i * 31 + 7) & 0xff
      expect(Array.from(xpkUnpack(xpkPack(src, 'NONE')))).toEqual(Array.from(src))
    }
  })

  it('catches a flipped bit in the chunk body through the chunk checksum', () => {
    const s = xpkPack(ascii('abcdefghijklmnop'), 'NONE')
    s[36 + 8 + 3] = at(s, 36 + 8 + 3) ^ 0x01
    expect(codeOf(() => xpkUnpack(s))).toBe(XPKERR_CHECKSUM)
  })

  it('catches a flipped bit in a chunk header the same way', () => {
    const s = xpkPack(ascii('abcdefghijklmnop'), 'NONE')
    s[36 + 4] = at(s, 36 + 4) ^ 0x01
    expect(codeOf(() => xpkUnpack(s))).toBe(XPKERR_CHECKSUM)
  })

  it('rejects a chunk type that is neither 0, 1 nor 15', () => {
    const s = xpkPack(ascii('abcdefghijklmnop'), 'NONE')
    s[36] = 7
    s[37] = 0
    s[37] = xpkHeaderChecksum(s, 36, 8) // keep the header checksum honest
    expect(codeOf(() => xpkUnpack(s))).toBe(XPKERR_CORRUPTPKD)
  })

  it('stops on a stream whose final chunk was cut off', () => {
    const s = xpkPack(ascii('abcdefghijklmnop'), 'NONE')
    expect(codeOf(() => xpkUnpack(s.subarray(0, s.length - 4)))).toBe(XPKERR_TRUNCATED)
  })
})

describe('xpkParseMethod', () => {
  it("splits EasyLife's seven-character METHOD$", () => {
    expect(xpkParseMethod('HUFF.23')).toEqual({ name: 'HUFF', mode: 23 })
    expect(xpkParseMethod('NUKE.00')).toEqual({ name: 'NUKE', mode: 0 })
    expect(xpkParseMethod('NONE')).toEqual({ name: 'NONE', mode: 0 })
  })

  it('upper-cases the id and survives a junk efficiency', () => {
    expect(xpkParseMethod('none.50')).toEqual({ name: 'NONE', mode: 50 })
    expect(xpkParseMethod('NONE.xx')).toEqual({ name: 'NONE', mode: 0 })
  })
})

describe('against the real xpkmaster.library 2.2', () => {
  // The AMOS PD Library CD 1994 ships six byte-identical copies; the archive is
  // local-only, so this skips when the tree is absent.
  const LIB = join(
    here,
    '..',
    '..',
    '..',
    'amos-files',
    'sources',
    'amos-pd-library-cd-1994',
    'files',
    'Library3.0',
    'XPKMASTER.LIBRARY',
  )

  it.skipIf(!existsSync(LIB))('is version 2.2, and its own strings are the error table', () => {
    const image = loadHunks(new Uint8Array(readFileSync(LIB)), 0).image
    const text = new TextDecoder('latin1').decode(image)
    expect(text).toContain('$VER: xpkmaster.library 2.2 (Aug  7 1992)')
    // the table at $2c52, in code order, is what XPK_MESSAGES holds
    for (const m of XPK_MESSAGES) expect(text).toContain(m)
  })

  it.skipIf(!existsSync(LIB))('carries the constants this port reads off it', () => {
    const image = loadHunks(new Uint8Array(readFileSync(LIB)), 0).image
    const dv = new DataView(image.buffer, image.byteOffset, image.byteLength)
    // $512  cmpi.l #'XPKF',(a0)
    expect(dv.getUint32(0x514)).toBe(XPK_MAGIC)
    // $720  cmpi.l #'PP20',(a0)
    expect(String.fromCharCode(...image.subarray(0x722, 0x726))).toBe('PP20')
    // $8aa  move.l #'----',$18(a0) -- $217c, so the immediate starts at $8ac
    expect(String.fromCharCode(...image.subarray(0x8ac, 0x8b0))).toBe('----')
    // $a8c  move.l #$8000,d0 -- the chunk size before a packer narrows it
    expect(dv.getUint32(0xa8e)).toBe(XPK_DEFAULT_CHUNK)
    // $332  moveq #$40,d0 / lsl.l #$2,d0 -- XPK_MARGIN, built rather than stored
    expect(image[0x333]).toBe(0x40)
    expect(0x40 << 2).toBe(XPK_MARGIN)
    // the sub-library path it would have opened
    expect(new TextDecoder('latin1').decode(image)).toContain('compressors/xpk%.4s.library')
  })

  it.skipIf(!existsSync(PP_FIXTURE))('examines a genuine PowerPacker file', () => {
    const file = new Uint8Array(readFileSync(PP_FIXTURE))
    const fib = xpkExamine(file)
    expect(fib.kind).toBe('pp20')
    expect(fib.uLen).toBe(7907) // the file's own 24-bit trailer
    expect(fib.cLen).toBe(file.length)
    const out = xpkUnpack(file)
    expect(out.length).toBe(7907)
    expect(new TextDecoder('latin1').decode(out).startsWith('@DATABASE')).toBe(true)
  })
})

describe('xpkRLEN.library, ported whole', () => {
  const RLEN = XPK_PACKERS.get('RLEN')!
  const pack = (b: Uint8Array): number[] => Array.from(RLEN.packChunk(b, 50) ?? [])
  const fill = (n: number, v: number): Uint8Array => new Uint8Array(n).fill(v)

  it('emits a run as a negated count and one byte', () => {
    // "aaabbbb": $294 counts from three, then one per byte that repeats the
    // last, and $2b6 writes `neg.l d6` as a byte before the byte itself
    expect(pack(ascii('aaabbbb'))).toEqual([0xfd, 97, 0xfc, 98, 0])
  })

  it('emits anything shorter than three equal bytes as a literal, even when it grows', () => {
    // the lookahead at $1f2 wants a0[0] == a0[1] == a0[2]; two is not enough
    expect(pack(ascii('abcdef'))).toEqual([6, 97, 98, 99, 100, 101, 102, 0])
    expect(pack(ascii('aab'))).toEqual([3, 97, 97, 98, 0])
  })

  it('caps a run at 127 and starts another', () => {
    // `moveq #$7f,d0 / cmp.l d0,d6 / bge` stops the count at 127
    expect(pack(fill(200, 97))).toEqual([0x81, 97, 0xb7, 97, 0])
  })

  it('caps a literal at 127 and starts another', () => {
    // `moveq #$7f,d2 / cmp.l d2,d1 / beq $244` flushes at exactly 127
    const distinct = Uint8Array.from({ length: 130 }, (_, i) => i)
    const out = pack(distinct)
    expect(out[0]).toBe(127)
    expect(out[128]).toBe(3)
    expect(out).toHaveLength(1 + 127 + 1 + 3 + 1)
    expect(out[out.length - 1]).toBe(0)
  })

  it('terminates an empty chunk with the zero byte and nothing else', () => {
    expect(pack(new Uint8Array(0))).toEqual([0])
  })

  it('round-trips through the unpacker at $2f8', () => {
    const cases = [
      ascii(''),
      ascii('a'),
      ascii('aa'),
      ascii('aaa'),
      ascii('The quick brown fox. '.repeat(40)),
      fill(5000, 0),
      Uint8Array.from({ length: 3000 }, (_, i) => (i * 7919) & 0xff),
    ]
    for (const src of cases) {
      const packed = RLEN.packChunk(src, 50)!
      expect(packed, `packing ${src.length} bytes`).not.toBeNull()
      expect(Array.from(RLEN.unpackChunk(packed, src.length))).toEqual(Array.from(src))
    }
  })

  it('compresses repetition and only grows incompressible data by 1 in 127', () => {
    // 30000 = 236 runs of 127 and one of 28, two bytes each, then the zero
    expect(pack(fill(30_000, 0x5a))).toHaveLength(237 * 2 + 1)
    const noise = Uint8Array.from({ length: 30_000 }, (_, i) => (i * 2654435761) >>> 24)
    expect(RLEN.packChunk(noise, 50)!.length).toBeLessThan(30_000 + 30_000 / 127 + 8)
  })

  it('narrows the master chunk to 32000, which is its XpkInfo default AND its maximum', () => {
    // $a7e reads XpkInfo+$24 for the size it wants and $ac2 clamps to +$1c;
    // both are 32000 here, against the master's own $8000 fallback at $a8c
    expect(RLEN.maxChunk).toBe(32000)
    expect(XPK_DEFAULT_CHUNK).toBeGreaterThan(RLEN.maxChunk!)
    const s = xpkPack(fill(70_000, 1), 'RLEN')
    expect(xpkExamine(s).uLen).toBe(70_000)
    expect(Array.from(xpkUnpack(s))).toEqual(Array.from(fill(70_000, 1)))
  })

  it('has no cipher, so a password is NOCRYPT rather than ignored', () => {
    expect(codeOf(() => xpkPack(ascii('secret'), 'RLEN', 'hunter2'))).toBe(XPKERR_NOCRYPT)
  })

  it('packs a real stream the master can read back', () => {
    const body = ascii('aaaaaaaaaa bbbbbbbbbb cccccccccc '.repeat(300))
    const s = xpkPack(body, 'RLEN')
    expect(String.fromCharCode(at(s, 8), at(s, 9), at(s, 10), at(s, 11))).toBe('RLEN')
    expect(s.length).toBeLessThan(body.length / 2)
    expect(Array.from(xpkUnpack(s))).toEqual(Array.from(body))
  })
})

describe('against the real xpkRLEN.library 1.0', () => {
  const LIB = join(fixtures, 'libs', 'xpkrlen.library')

  it.skipIf(!existsSync(LIB))('is what its own XpkInfo says it is', () => {
    const raw = new Uint8Array(readFileSync(LIB))
    const hunks = loadHunks(raw, 0)
    const data = hunks.hunks.find((h) => h.kind === 'data')!
    const img = hunks.image
    const u32 = (o: number): number => ((at(img, o) << 24) | (at(img, o + 1) << 16) | (at(img, o + 2) << 8) | at(img, o + 3)) >>> 0
    // XpkPackerInfo at $17e is `lea $3a(a6),a4 / lea $88(a4),a0`, and $3a is
    // where routine 0 copies the data hunk to. So XpkInfo is data + $88.
    const info = data.base + 0x88
    const str = (rel: number): string => {
      let s = ''
      for (let k = data.base + rel; at(img, k) !== 0; k++) s += String.fromCharCode(at(img, k))
      return s
    }
    expect(img[info + 1]).toBe(1) // xi_Version
    expect(img[info + 5]).toBe(0) // the master version it needs, tested at $d20
    expect(str(u32(info + 8))).toBe('RLEN')
    expect(str(u32(info + 0xc))).toBe(XPK_PACKERS.get('RLEN')!.longName)
    expect(str(u32(info + 0x10))).toBe('Fast and simple compression usable for simple data')
    expect(u32(info + 0x1c)).toBe(XPK_PACKERS.get('RLEN')!.maxChunk) // max
    expect(u32(info + 0x20)).toBe(0) // min
    expect(u32(info + 0x24)).toBe(32000) // default
    expect(new TextDecoder('latin1').decode(img)).toContain('xpkRLEN.library')
  })
})

describe('xpkNUKE.library, ported whole', () => {
  const NUKE = XPK_PACKERS.get('NUKE')!
  const fill = (n: number, v: number): Uint8Array => new Uint8Array(n).fill(v)
  const trip = (b: Uint8Array): Uint8Array | null => {
    const packed = NUKE.packChunk(b, 50)
    return packed === null ? null : NUKE.unpackChunk(packed, b.length)
  }

  it('stores literals BACKWARDS, so the chunk ends with the byte it starts with', () => {
    // $46a writes each literal with `move.b (a0)+,-(a1)` from the top of the
    // buffer down, and $984 slides that block to sit right after the codes.
    // The decoder reads it with `move.b -(a4),(a0)+`. So the LAST byte of a
    // packed chunk is the FIRST literal emitted, which is always input byte 0
    // -- there is nothing for the first position to match against.
    for (const body of [ascii('hello, and hello again, and hello once more'), fill(4000, 0x5a)]) {
      const packed = NUKE.packChunk(body, 50)!
      expect(packed).not.toBeNull()
      expect(packed[packed.length - 1]).toBe(body[0])
    }
  })

  it('pads with $fb until the chunk is a whole number of longwords', () => {
    // $97e. The decoder pulls the nibble stream with `move.l (a5)+,d4`, so the
    // packed length has to be a multiple of four whatever the code and literal
    // halves came to.
    for (let n = 1; n < 400; n += 7) {
      const packed = NUKE.packChunk(fill(n, 0x41), 50)
      if (packed !== null) expect(packed.length % 4, `${n} bytes in`).toBe(0)
    }
  })

  it('round-trips across the length boundaries the encoder switches on', () => {
    // 3 and 4 change the distance group ($36c); 6 leaves the two-bit code for
    // the nibble escape at $764; 21 and 22 are where that escape needs a
    // second nibble ($792 subtracts fifteen at a time)
    const cases: Uint8Array[] = [new Uint8Array(0), ascii('a'), ascii('ab')]
    for (const len of [2, 3, 4, 5, 6, 7, 20, 21, 22, 23, 36, 37, 300]) {
      // a phrase, a gap, then the same phrase, so the match is exactly `len`
      const s = 'x'.repeat(len)
      cases.push(ascii(`${s}<gap>${s}`), ascii(`${s} qwertyuiop ${s}`))
    }
    for (const src of cases) {
      const out = trip(src)
      if (out === null) continue // EXPANSION is a legal answer for short input
      expect(Array.from(out), `${src.length} bytes`).toEqual(Array.from(src))
    }
  })

  it('answers EXPANSION rather than growing a chunk, which $2f4 also insists on', () => {
    // the guard is `cmp.l $4(a2),d0 / ble`, so a tie is accepted and only a
    // genuine expansion is refused
    expect(NUKE.packChunk(new Uint8Array([0x42]), 50)).toBe(null)
    expect(NUKE.packChunk(new Uint8Array(0), 50)).toBe(null)
    const noise = Uint8Array.from({ length: 30_000 }, (_, i) => (i * 2654435761) >>> 24)
    const packed = NUKE.packChunk(noise, 50)
    if (packed !== null) expect(packed.length).toBeLessThanOrEqual(noise.length)
  })

  it('beats RLEN on text, which is the whole reason it exists', () => {
    const body = ascii('the quick brown fox jumps over the lazy dog. '.repeat(400))
    const nuke = NUKE.packChunk(body, 50)!
    const rlen = XPK_PACKERS.get('RLEN')!.packChunk(body, 50)!
    // RLEN cannot see a repeat it is not sitting on, so it stores the lot
    expect(rlen.length).toBeGreaterThan(body.length)
    expect(nuke.length).toBeLessThan(body.length / 20)
  })

  it('narrows the master chunk to 30000 and declares the only minimum here', () => {
    // XpkInfo+$1c, +$20 and +$24. NUKE is the first packer in this registry
    // with a floor, and $a9e applies it BEFORE $ac2 applies the ceiling.
    expect(NUKE.maxChunk).toBe(30_000)
    expect(NUKE.minChunk).toBe(10)
    expect(NUKE.defaultChunk).toBe(30_000)
    const body = Uint8Array.from({ length: 70_000 }, (_, i) => (i >> 5) & 0xff)
    const s = xpkPack(body, 'NUKE')
    // three chunks: 30000, 30000, 10000
    expect((at(s, 36 + 6) << 8) | at(s, 36 + 7)).toBe(30_000)
    expect(Array.from(xpkUnpack(s))).toEqual(Array.from(body))
  })

  it('never looks further back than its own NUKE_BASE[15]', () => {
    // $8a6 reads the window straight out of the last distance base, so bucket
    // 15 is unreachable from this encoder however far apart the repeats are.
    // A copy at 20,000 bytes' distance is stored twice rather than referenced.
    expect(NUKE_WINDOW).toBe(NUKE_BASE[15]! - 1)
    const tag = ascii('a distinctive run of bytes nothing else will match')
    const body = new Uint8Array(20_000 + tag.length * 2)
    body.set(tag, 0)
    body.set(tag, 20_000)
    const packed = NUKE.packChunk(body, 50)!
    expect(Array.from(NUKE.unpackChunk(packed, body.length))).toEqual(Array.from(body))
  })

  it('has no cipher, so a password is NOCRYPT rather than ignored', () => {
    expect(codeOf(() => xpkPack(ascii('secret'), 'NUKE', 'hunter2'))).toBe(XPKERR_NOCRYPT)
  })
})

describe('against the real xpkNUKE.library 1.0', () => {
  const LIB = join(fixtures, 'libs', 'xpknuke.library')
  const load = (): { img: Uint8Array; code: number; data: number } => {
    const hunks = loadHunks(new Uint8Array(readFileSync(LIB)), 0)
    return {
      img: hunks.image,
      code: hunks.hunks.find((h) => h.kind === 'code')!.base,
      data: hunks.hunks.find((h) => h.kind === 'data')!.base,
    }
  }

  it.skipIf(!existsSync(LIB))('is what its own XpkInfo says it is', () => {
    const { img, data } = load()
    const u32 = (o: number): number =>
      ((at(img, o) << 24) | (at(img, o + 1) << 16) | (at(img, o + 2) << 8) | at(img, o + 3)) >>> 0
    // XpkPackerInfo is `lea $3a(a6),a4 / lea $a6(a4),a0`, so XpkInfo is data + $a6
    const info = data + 0xa6
    const str = (rel: number): string => {
      let s = ''
      for (let k = data + rel; at(img, k) !== 0; k++) s += String.fromCharCode(at(img, k))
      return s
    }
    expect(img[info + 1]).toBe(1) // xi_Version
    expect(img[info + 5]).toBe(0) // the master version it needs, tested at $d20
    expect(str(u32(info + 8))).toBe('NUKE')
    expect(str(u32(info + 0xc))).toBe(XPK_PACKERS.get('NUKE')!.longName)
    expect(str(u32(info + 0x10))).toBe('A relatively efficient packer that unpacks very quickly')
    expect(u32(info + 0x1c)).toBe(XPK_PACKERS.get('NUKE')!.maxChunk)
    expect(u32(info + 0x20)).toBe(XPK_PACKERS.get('NUKE')!.minChunk)
    expect(u32(info + 0x24)).toBe(XPK_PACKERS.get('NUKE')!.defaultChunk)
  })

  it.skipIf(!existsSync(LIB))('carries the three decode tables this port reads off it', () => {
    const { img, code } = load()
    const w = (o: number): number => (at(img, code + o) << 8) | at(img, code + o + 1)
    for (let i = 0; i < 16; i++) {
      expect(w(0x3d4 + i * 2), `bits[${i}]`).toBe(NUKE_BITS[i])
      expect(w(0x3f4 + i * 2), `base[${i}]`).toBe(NUKE_BASE[i])
      // $414 holds a jump offset into the copy chain at $9fc, and the three
      // values in it are what make the nibble a length as well as a bucket
      expect(w(0x414 + i * 2), `jmp[${i}]`).toBe(i < 4 ? 0x20 : i < 10 ? 0x1e : 0)
    }
  })

  it.skipIf(!existsSync(LIB))("carries the encoder's four tables, and they agree with the decoder's", () => {
    const { img, code } = load()
    const w = (o: number): number => (at(img, code + o) << 8) | at(img, code + o + 1)
    // $36c, indexed by min(length - 1, 3)
    for (let i = 0; i < 4; i++) expect(w(0x36c + i * 2), `group[${i}]`).toBe(NUKE_GROUP[i])
    for (let i = 0; i < 16; i++) {
      // $374 is a bucket width, and it is 1 << the decoder's bit count. That
      // is not assumed here, it is the reason NUKE_SIZE is not a table.
      expect(w(0x374 + i * 2), `size[${i}]`).toBe(1 << NUKE_BITS[i]!)
      expect(w(0x394 + i * 2), `bits[${i}]`).toBe(NUKE_BITS[i])
      // $3b4 maps a bucket to its nibble, and it is the identity
      expect(w(0x3b4 + i * 2), `nibble[${i}]`).toBe(i)
    }
    // and every base is the one below it plus that bucket's width, inside
    // each of the three groups
    for (const [lo, hi] of [
      [0, 3],
      [4, 9],
      [10, 15],
    ] as const) {
      expect(NUKE_BASE[lo]).toBe(0)
      for (let i = lo; i < hi; i++) expect(NUKE_BASE[i + 1]).toBe(NUKE_BASE[i]! + (1 << NUKE_BITS[i]!))
    }
    // $8a6: the encoder's window IS the last base, read at run time
    expect(w(0x412)).toBe(NUKE_BASE[15])
    expect(NUKE_WINDOW).toBe(w(0x412) - 1)
  })
})

describe('xpkCBR0.library, ported whole', () => {
  const CBR0 = XPK_PACKERS.get('CBR0')!
  const pack = (b: Uint8Array): number[] | null => {
    const p = CBR0.packChunk(b, 0)
    return p === null ? null : Array.from(p)
  }
  const fill = (n: number, v: number): Uint8Array => new Uint8Array(n).fill(v)

  it('biases both counts, so 0 is one literal and -1 is two repeats', () => {
    // $1ea writes `neg(d4 - $7e)` for literals and $22a writes `d4 - $7e`
    // straight, which is what makes one positive and the other negative.
    // "aaabbbb" is a run of three then a run of four, and nothing else.
    expect(pack(ascii('aaabbbb'))).toEqual([0xfe, 97, 0xfd, 98])
    expect(pack(ascii('aaa'))).toEqual([0xfe, 97])
  })

  it('has no terminator, unlike RLEN, so a chunk decodes until its input ends', () => {
    // RLEN's $274 spends a byte on a zero; CBR0's $2a6 loops on `a1 < InEnd`
    expect(pack(ascii('aaa'))).not.toContain(0)
    expect(CBR0.unpackChunk(Uint8Array.from([0xfe, 97]), 3)).toEqual(fill(3, 97))
  })

  it('caps a run at 128, not RLEN 127, and spends two bytes on a lone last byte', () => {
    // the dbra at $21a starts from 127 and falls through on the 128th match
    expect(pack(fill(128, 97))).toEqual([0x81, 97])
    // 129 is that run plus $1a8's `00 <byte>`, the only place a count of 0 is
    // written. Getting $238 wrong makes this emit the run's last byte twice,
    // which no round-trip notices because both decoders stop at ULen.
    expect(pack(fill(129, 97))).toEqual([0x81, 97, 0, 97])
    expect(pack(fill(256, 97))).toEqual([0x81, 97, 0x81, 97])
  })

  it('stops a literal run before the byte that starts a run', () => {
    // $1d8 tests a1[1] against a1[0] and breaks out BEFORE copying, so the
    // first byte of the repeat belongs to the run and not to the literals
    expect(pack(ascii('abcdeffffffff'))).toEqual([4, 97, 98, 99, 100, 101, 0xf9, 102])
  })

  it('gives up the moment the output reaches the input length', () => {
    // $1cc tests the write cursor against OutBuf + InLen on every literal
    // byte, so unlike RLEN it can never return a chunk that grew
    expect(pack(ascii('abcde'))).toBe(null)
    expect(pack(ascii('a'))).toBe(null)
    const noise = Uint8Array.from({ length: 20_000 }, (_, i) => (i * 2654435761) >>> 24)
    expect(pack(noise)).toBe(null)
  })

  it('packs an empty chunk to an empty result, which is a SUCCESS not EXPANSION', () => {
    // $252: clr.l $10(a0) / moveq #0,d0. NONE would have said EXPANSION here.
    expect(pack(new Uint8Array(0))).toEqual([])
  })

  it('refuses more than $fffc bytes with BIGBUF, its own declared maximum', () => {
    // $17a, and again at $28e on the way back out
    expect(codeOf(() => CBR0.packChunk(fill(0xfffd, 0), 0))).toBe(XPKERR_BIGBUF)
    expect(CBR0.packChunk(fill(0xfffc, 0), 0)).not.toBe(null)
  })

  it('round-trips, including the counts either side of every cap', () => {
    const cases: Uint8Array[] = [new Uint8Array(0), ascii('aaa')]
    for (const n of [1, 2, 3, 127, 128, 129, 255, 256, 257]) {
      cases.push(fill(n, 0x5a), ascii(`${'q'.repeat(n)}z${'q'.repeat(n)}`))
      cases.push(Uint8Array.from({ length: n }, (_, i) => (i >> 3) & 0xff))
    }
    for (const src of cases) {
      const packed = CBR0.packChunk(src, 0)
      if (packed === null) continue
      expect(Array.from(CBR0.unpackChunk(packed, src.length)), `${src.length} bytes`).toEqual(Array.from(src))
    }
  })

  it('was the first packer here to make the master write LONG chunk headers', () => {
    // xpi_DefChunk is 65532 and $aec switches to twelve-byte headers over
    // 65000. CBR0 is what opened that half of the writer up; BLZW has since
    // joined it from the other side, with a default of 131072.
    expect(CBR0.defaultChunk).toBe(0xfffc)
    expect(CBR0.defaultChunk!).toBeGreaterThan(XPK_LONGHDR_ABOVE)
    const body = Uint8Array.from({ length: 200_000 }, (_, i) => (i >> 8) & 0xff)
    const s = xpkPack(body, 'CBR0')
    expect(xpkExamine(s).flags & XPKSTREAMF_LONGHDRS).toBe(XPKSTREAMF_LONGHDRS)
    expect(rd32(s, 36 + 8)).toBe(65_532) // xch_ULen, a longword in this form
    expect(Array.from(xpkUnpack(s))).toEqual(Array.from(body))
    // and the three under 65000 stay in the short form
    for (const m of ['NONE', 'RLEN', 'NUKE']) {
      expect(xpkExamine(xpkPack(body, m)).flags & XPKSTREAMF_LONGHDRS, m).toBe(0)
    }
  })

  it('has no cipher, so a password is NOCRYPT rather than ignored', () => {
    expect(codeOf(() => xpkPack(ascii('secret'), 'CBR0', 'hunter2'))).toBe(XPKERR_NOCRYPT)
  })
})

describe('against the real xpkCBR0.library 1.0', () => {
  const LIB = join(fixtures, 'libs', 'xpkcbr0.library')

  it.skipIf(!existsSync(LIB))('names itself, and hangs its entries off a word-relative table', () => {
    const img = loadHunks(new Uint8Array(readFileSync(LIB)), 0).image
    const u16 = (o: number): number => (at(img, o) << 8) | at(img, o + 1)
    const u32 = (o: number): number =>
      ((at(img, o) << 24) | (at(img, o + 1) << 16) | (at(img, o + 2) << 8) | at(img, o + 3)) >>> 0
    const str = (o: number): string => {
      let s = ''
      for (let k = o; at(img, k) !== 0; k++) s += String.fromCharCode(at(img, k))
      return s
    }
    // the RomTag is at $4c, not $4 as in the other three: find it by the
    // match word pointing back at itself
    let tag = -1
    for (let o = 0; o + 26 <= img.length; o += 2) if (u16(o) === 0x4afc && u32(o + 2) === o) tag = o
    expect(tag).toBe(0x4c)
    expect(str(u32(tag + 14))).toBe('xpkCBR0.library')
    // $a0, a Latin-1 non-breaking space, is this author's word separator and
    // it is left exactly as he wrote it -- here, and in the $VER string at $4
    // where he also spells it "Hypenosis"
    expect(str(u32(tag + 18))).toBe('xpkCBR0\u00a0V1.0 (23-Aug-1992)')
    expect(str(4)).toBe(
      '$VER:\u00a0xpkCBR0.library\u00a0V1.0 \u00a9\u00a0by\u00a0Bilbo\u00a01st\u00a0of' +
        '\u00a0Hypenosis\u00a0on\u00a023-Aug-1992.',
    )

    // RTF_AUTOINIT's second form: the vector table opens with $ffff and the
    // entries are word offsets from the table, where NONE, RLEN and NUKE all
    // use longword pointers
    const vectors = u32(u32(tag + 22) + 4)
    expect(u16(vectors)).toBe(0xffff)
    const lvo = (n: number): number => vectors + u16(vectors + 2 + (n / 6 - 1) * 2)
    expect(lvo(30)).toBe(0x15e) // XpkPackerInfo
    expect(lvo(36)).toBe(0x168) // XpkPackChunk
    expect(lvo(54)).toBe(0x27e) // XpkUnpackChunk
    expect(u16(vectors + 2 + 10 * 2)).toBe(0xffff) // ten entries, then the end
  })

  it.skipIf(!existsSync(LIB))('builds its XpkInfo in code, and $358 holds the numbers', () => {
    const img = loadHunks(new Uint8Array(readFileSync(LIB)), 0).image
    const u32 = (o: number): number =>
      ((at(img, o) << 24) | (at(img, o + 1) << 16) | (at(img, o + 2) << 8) | at(img, o + 3)) >>> 0
    const str = (o: number): string => {
      let s = ''
      for (let k = o; at(img, k) !== 0; k++) s += String.fromCharCode(at(img, k))
      return s
    }
    // XpkPackerInfo is `move.l a6,d0 / addi.l #$28,d0 / rts`, so the struct is
    // at library base + $28 and there is nothing static to read. $358 onward
    // is a run of `move.l #imm,off(a1)` filling it, and these are the
    // immediates -- each sits two bytes into its instruction.
    expect(u32(0x38c)).toBe(0x43425230) // xi_ID, 'CBR0'
    expect(u32(0x394)).toBe(9) // xi_Flags, the same 9 all four declare
    expect(u32(0x39c)).toBe(XPK_PACKERS.get('CBR0')!.maxChunk)
    expect(u32(0x3a4)).toBe(0) // xi_MinChunk
    expect(u32(0x3ac)).toBe(XPK_PACKERS.get('CBR0')!.defaultChunk)
    // and the three strings it lea's in at $372, $37a and $382
    expect(str(0x410)).toBe('CBR0')
    expect(str(0x418)).toBe(XPK_PACKERS.get('CBR0')!.longName)
    expect(str(0x434)).toBe('fast and simple compression of data containing many repeating equal bytes')
  })
})

describe('xpkBLZW.library, ported whole', () => {
  const BLZW = XPK_PACKERS.get('BLZW')!
  const pack = (b: Uint8Array, mode = 0): Uint8Array | null => BLZW.packChunk(b, mode)
  const width = (p: Uint8Array): number => (p[0]! << 8) | p[1]!
  const stack = (p: Uint8Array): number => (p[2]! << 8) | p[3]!
  /** something that fills the dictionary at every one of the seven widths */
  const FILLS = Uint8Array.from({ length: 131_072 }, (_, i) => ((i * 2654435761) >>> 24) & (i & 0x3f ? 0xff : 0x0f))

  it('refuses 127 bytes and takes 128, which is also its xpi_MinChunk', () => {
    // $450 is `moveq #$7f,d2 / cmp.l d2,d0 / bls $65a`, and $65a returns zero,
    // which $336 turns into XPKERR_EXPANSION
    expect(pack(new Uint8Array(127).fill(3))).toBe(null)
    expect(pack(new Uint8Array(128).fill(3))).not.toBe(null)
    expect(BLZW.minChunk).toBe(128)
  })

  it('takes its code width from the mode, and it is the only packer here that reads one', () => {
    // $2f6 is `mode * 7 / 100 + 9` clamped to 9..15, so the seven widths sit
    // on boundaries at 15, 29, 43, 58, 72 and 86. The header word shows it
    // only once the dictionary has filled, because $5ae is what writes it.
    for (const [mode, bits] of [
      [0, 9],
      [14, 9],
      [15, 10],
      [28, 10],
      [29, 11],
      [42, 11],
      [43, 12],
      [57, 12],
      [58, 13],
      [71, 13],
      [72, 14],
      [85, 14],
      [86, 15],
      [99, 15],
    ] as const) {
      expect(width(pack(FILLS, mode)!), `mode ${mode}`).toBe(bits)
    }
    // and the clamp holds at both ends, since `mulu.w` reads the low word only
    expect(width(pack(FILLS, 0x10000)!)).toBe(9)
    expect(width(pack(FILLS, 65_535)!)).toBe(15)
  })

  it('opens a chunk with two words it writes last, at $636', () => {
    // 200 bytes of one character is the whole of LZW in miniature: a literal,
    // then every code the encoder has just built. 65, 259, 260, 261 and up.
    // The strings run 1, 2, 3 ... 19 characters, which is 190 bytes, and the
    // last 10 go out as the code for a ten-character run.
    expect(Array.from(pack(new Uint8Array(200).fill(65))!)).toEqual([
      0x00, 0x09, 0x00, 0x14, 0x20, 0xc0, 0xe0, 0x90, 0x58, 0x34, 0x1e, 0x11, 0x09, 0x85, 0x42, 0xe1, 0x90, 0xd8,
      0x74, 0x3e, 0x21, 0x11, 0x89, 0x44, 0xe2, 0x90, 0xb8, 0x00,
    ])
    // $63e rounds the longest string down to four after $53a counted it as
    // the length plus three, which makes it a round UP to four: the longest
    // string here is 19 characters and the decoder stacks 18 of them.
    expect(stack(pack(new Uint8Array(200).fill(65))!)).toBe(20)
  })

  it('never grows a chunk, because the output buffer IS the expansion guard', () => {
    // $45e rounds the input length down to 32 and allocates that much, $484
    // clears it, and $582 gives up eight bytes short of the end. So the only
    // two answers are a chunk shorter than the input and XPKERR_EXPANSION.
    for (const n of [128, 1000, 40_000]) expect(pack(noise(n)), `${n}`).toBe(null)
    // and where it does pack, it is always under the input length
    for (const n of [130, 1000, 40_000]) {
      const p = pack(ascii('AMOS '.repeat(n)).subarray(0, n))!
      expect(p.length, `${n}`).toBeLessThan(n)
    }
  })

  it('round-trips through every path the format has', () => {
    const cases: Array<[string, Uint8Array]> = [
      ['one repeated byte', new Uint8Array(5000).fill(0x5a)],
      ['text', ascii('the quick brown fox jumps over the lazy dog. '.repeat(300))],
      // KwKwK: the encoder names the entry it built one code ago
      ['runs that outrun the dictionary', Uint8Array.from({ length: 30_000 }, (_, i) => (i % 300 < 290 ? 1 : i & 0xff))],
      // fills the dictionary and then walks the ratio down until $5f0 resets it
      ['compressible then not', FILLS.slice(0, 60_000)],
      ['incompressible tail', (() => {
        const good = ascii('AMOS Professional 2.0 '.repeat(2000))
        const b = new Uint8Array(good.length + 20_000)
        b.set(good)
        b.set(noise(20_000), good.length)
        return b
      })()],
    ]
    for (const [name, body] of cases) {
      for (const mode of [0, 43, 99]) {
        const p = pack(body, mode)
        if (p === null) continue
        expect(Array.from(BLZW.unpackChunk(p, body.length)), `${name} / ${mode}`).toEqual(Array.from(body))
      }
    }
  })

  it('resets the dictionary when its own ratio falls, which is $5c6', () => {
    // The heuristic `compress` uses, transcribed: once the dictionary is full,
    // every 256th new string measures (input << 8) / output since the last
    // mark and starts over when that has dropped. Good data followed by bad
    // is what makes it fire, and at nine bits it fires forty times over this
    // input. The length is pinned because `ancient` cannot see an encoder
    // that emits too MUCH: both decoders stop at ULen. Thirty-four resets
    // went into this number.
    const good = ascii('AMOS Professional 2.0 '.repeat(3000))
    const bad = noise(40_000)
    const body = new Uint8Array(good.length + bad.length)
    body.set(good)
    body.set(bad, good.length)
    const p = pack(body)!
    expect(p.length).toBe(51_210)
    expect(width(p)).toBe(9)
    expect(Array.from(BLZW.unpackChunk(p, body.length))).toEqual(Array.from(body))
  })

  it('is the second packer that makes the master write LONG chunk headers', () => {
    // xpi_DefChunk 131072 is over the 65000 that $aec switches on, and unlike
    // CBR0 there is no xpi_MaxChunk pulling it back: $7fffffff is the ceiling.
    expect(BLZW.defaultChunk).toBe(131_072)
    expect(BLZW.maxChunk).toBe(0x7fffffff)
    expect(BLZW.defaultChunk!).toBeGreaterThan(XPK_LONGHDR_ABOVE)
    const body = ascii('AMOS Professional '.repeat(20_000))
    const s = xpkPack(body, 'BLZW')
    expect(xpkExamine(s).flags & XPKSTREAMF_LONGHDRS).toBe(XPKSTREAMF_LONGHDRS)
    expect(rd32(s, 36 + 8)).toBe(131_072) // xch_ULen, a longword in this form
    expect(Array.from(xpkUnpack(s))).toEqual(Array.from(body))
  })

  it('rejects a header claiming a width it could never have written', () => {
    // $786 is the reason the port deviates here. The library turns the header
    // word straight into an AllocMem of `(4 << maxbits) + stackSize` and
    // answers XPKERR_NOMEM when that fails. Rejecting the width reaches the
    // same answer without asking for two gigabytes first.
    const p = pack(new Uint8Array(500).fill(1))!
    for (const bad of [0, 8, 16, 31]) {
      const broken = p.slice()
      broken[0] = bad >> 8
      broken[1] = bad & 0xff
      expect(codeOf(() => BLZW.unpackChunk(broken, 500)), `${bad}`).toBe(XPKERR_NOMEM)
    }
  })

  it('reports a chunk that decodes to the wrong length, which $376 is', () => {
    const p = pack(new Uint8Array(500).fill(1))!
    expect(codeOf(() => BLZW.unpackChunk(p, 499))).toBe(XPKERR_CORRUPTPKD)
    expect(codeOf(() => BLZW.unpackChunk(p, 501))).toBe(XPKERR_CORRUPTPKD)
  })

  it('has no cipher, so a password is NOCRYPT rather than ignored', () => {
    expect(codeOf(() => xpkPack(ascii('secret'), 'BLZW', 'hunter2'))).toBe(XPKERR_NOCRYPT)
  })
})

describe('against the real xpkBLZW.library 3.0', () => {
  const LIB = join(fixtures, 'libs', 'xpkblzw.library')
  const load = (): Uint8Array => loadHunks(new Uint8Array(readFileSync(LIB)), 0).image

  it.skipIf(!existsSync(LIB))('names itself, and hangs ten entries off a longword table', () => {
    const img = load()
    const u16 = (o: number): number => (at(img, o) << 8) | at(img, o + 1)
    const u32 = (o: number): number =>
      ((at(img, o) << 24) | (at(img, o + 1) << 16) | (at(img, o + 2) << 8) | at(img, o + 3)) >>> 0
    const str = (o: number): string => {
      let s = ''
      for (let k = o; at(img, k) !== 0; k++) s += String.fromCharCode(at(img, k))
      return s
    }
    // the RomTag is at $36, so find it the way the CBR0 test does rather than
    // assuming $4: the match word points back at itself
    let tag = -1
    for (let o = 0; o + 26 <= img.length; o += 2) if (u16(o) === 0x4afc && u32(o + 2) === o) tag = o
    expect(tag).toBe(0x36)
    expect(at(img, tag + 11)).toBe(3) // rt_Version, and it says 3 where NUKE says 1
    expect(str(u32(tag + 14))).toBe('xpkBLZW.library')
    expect(str(u32(tag + 18))).toBe('xpkBLZW.library V3.0 - Copyright 1992 Bryan Ford')
    expect(str(4)).toBe('xpkBLZW.library V3.0 - Copyright 1992 Bryan Ford')

    // and it uses the longword form, not CBR0's word-relative one
    const vectors = u32(u32(tag + 22) + 4)
    expect(vectors).toBe(0x60)
    const lvo = (n: number): number => u32(vectors + (n / 6 - 1) * 4)
    expect(lvo(30)).toBe(0x11a) // XpkPackerInfo
    expect(lvo(36)).toBe(0x2ec) // XpkPackChunk
    expect(lvo(54)).toBe(0x352) // XpkUnpackChunk
    // -42 and -60 share one entry, and -48 shares $116 with -24
    expect(lvo(42)).toBe(lvo(60))
    expect(lvo(48)).toBe(lvo(24))
    expect(u32(vectors + 10 * 4)).toBe(0xffffffff) // ten entries, then the end
  })

  it.skipIf(!existsSync(LIB))('keeps a static XpkInfo at $122, which $11a lea\'s', () => {
    const img = load()
    const u16 = (o: number): number => (at(img, o) << 8) | at(img, o + 1)
    const u32 = (o: number): number =>
      ((at(img, o) << 24) | (at(img, o + 1) << 16) | (at(img, o + 2) << 8) | at(img, o + 3)) >>> 0
    const str = (o: number): string => {
      let s = ''
      for (let k = o; at(img, k) !== 0; k++) s += String.fromCharCode(at(img, k))
      return s
    }
    const BLZW = XPK_PACKERS.get('BLZW')!
    // XpkPackerInfo is `lea $122(pc),a0 / move.l a0,d0 / rts`, three
    // instructions and no init code, where CBR0 fills its struct in at run time
    const info = 0x122
    expect(u16(0x11a)).toBe(0x41fa) // lea d16(pc),a0
    expect(0x11a + 2 + u16(0x11c)).toBe(info)
    expect(u16(info)).toBe(1)
    expect(u16(info + 4)).toBe(0) // the master version it needs, tested at $d20
    // the word at +2 reads 3 where NUKE and NONE both read 0. What the master
    // does with it is not settled here.
    expect(u16(info + 2)).toBe(3)
    expect(str(u32(info + 8))).toBe('BLZW 3.0')
    expect(str(u32(info + 0xc))).toBe(BLZW.longName)
    expect(str(u32(info + 0x10))).toBe(
      "Fast compression and decompression, ratio much like 'compress' or 'zoo'",
    )
    expect(u32(info + 0x14)).toBe(0x424c5a57) // xi_ID, 'BLZW'
    // $8009 where NONE, RLEN, NUKE and CBR0 all read 9. IMPL reads the same
    // $8009 and HUFF $a009, and only bit 13 lines up with anything.
    expect(u32(info + 0x18)).toBe(0x8009)
    expect(u32(info + 0x1c)).toBe(BLZW.maxChunk)
    expect(u32(info + 0x20)).toBe(BLZW.minChunk)
    expect(u32(info + 0x24)).toBe(BLZW.defaultChunk)
  })

  it.skipIf(!existsSync(LIB))('carries the hash table sizes and the mode arithmetic this port reads off it', () => {
    const img = load()
    const u16 = (o: number): number => (at(img, o) << 8) | at(img, o + 1)
    // $65e, seven words, one per code width, and $66c multiplies by six
    for (let i = 0; i < 7; i++) {
      expect(u16(0x65e + i * 2), `bits ${9 + i}`).toBe(BLZW_HASH[i])
      // each is a prime just over 1.25 times the code space, which is what
      // leaves the rehash at $516 a fifth of the table to land in
      expect(BLZW_HASH[i]! / (1 << (9 + i))).toBeGreaterThan(1.25)
      expect(BLZW_HASH[i]! / (1 << (9 + i))).toBeLessThan(1.26)
    }
    // $2f6..$302, the three immediates that turn xsp_Mode into a code width
    expect(u16(0x2f6)).toBe(0xc4fc) // mulu.w #imm,d2
    expect(u16(0x2f8)).toBe(7)
    expect(u16(0x2fa)).toBe(0x84fc) // divu.w #imm,d2
    expect(u16(0x2fc)).toBe(100)
    expect(u16(0x2fe)).toBe(0xd47c) // add.w #imm,d2
    expect(u16(0x300)).toBe(9)
    // $6ba..$6c4, END, RESET and WIDEN as three dictionary entries whose sign
    // bit is what the `subq.w #$3,d7 / bvs` at $728 picks out
    expect(u16(0x6bc)).toBe(0x8000)
    expect(u16(0x6c0)).toBe(0x8001)
    expect(u16(0x6c6)).toBe(0x8002)
    // and the slot counter at $69a, `(1 << maxbits) - $103`
    expect(u16(0x69c)).toBe(0x103)
  })
})

describe('xpkHUFF.library, ported whole', () => {
  const HUFF = XPK_PACKERS.get('HUFF')!
  const pack = (b: Uint8Array, pw?: string): Uint8Array | null => HUFF.packChunk(b, 0, pw)
  /** 200 As, 120 Bs and 80 Cs, three distinct frequencies so no tie-break can hide */
  const ABC = Uint8Array.from({ length: 400 }, (_, i) => (i < 200 ? 65 : i < 320 ? 66 : 67))

  it('opens a chunk with a version word and a password check', () => {
    const p = pack(ABC)!
    // $5e4 writes the zero word and $616 the check longword, and $6ca leaves
    // both of them in clear. With no password the check is the seed itself.
    expect(Array.from(p.subarray(0, 6))).toEqual([0x00, 0x00, 0xab, 0xad, 0xca, 0xfe])
  })

  it('ships the code table, 256 entries, and $ff for a byte value that never occurs', () => {
    const p = pack(ABC)!
    // $650: one $ff per unused value. A code cannot be 256 bits long over 256
    // values, so $ff can never be a real length byte.
    expect(Array.from(p.subarray(6, 6 + 65)).every((b) => b === 0xff)).toBe(true)
    // A is the commonest, so it takes the one-bit code, and B and C take two.
    // $5a6 stores bits MINUS ONE, and $5c6 left-shifts the tail so the bits
    // sit at the top of the byte.
    expect(Array.from(p.subarray(6 + 65, 6 + 65 + 6))).toEqual([0, 0b10000000, 1, 0b01000000, 1, 0b00000000])
    // 253 unused values at a byte each, three used at two bytes, then
    // 200 one-bit codes and 200 two-bit codes, which is 75 whole bytes
    expect(p.length).toBe(6 + 253 + 6 + 75)
  })

  it('gives a chunk of one byte value a single-bit code, which is $4de', () => {
    // the list has one node, so there is no pair to join: the library hangs
    // that leaf off a parent as the 0 branch and calls the parent the root
    const p = pack(new Uint8Array(500).fill(65))!
    expect(p[6 + 65]).toBe(0) // bits - 1
    expect(p[6 + 65 + 1]).toBe(0) // and the bit itself is 0
    expect(Array.from(HUFF.unpackChunk(p, 500))).toEqual(Array.from(new Uint8Array(500).fill(65)))
  })

  it('spends exactly as many bits as an independent Huffman would', () => {
    // `ancient` cannot check this one. HUFF ships its table, so ANY consistent
    // tree decodes and the oracle has nothing to object to in a worse one.
    // What IS checkable is that the tree is optimal, so this weighs the total
    // bits the port spends against a plain textbook Huffman over the same
    // counts. Different tie-breaks move which symbol gets which length; they
    // cannot move the total.
    for (const body of [ABC, ascii('the quick brown fox. '.repeat(400)), FREQ_SKEW, new Uint8Array(900).fill(9)]) {
      const freq = new Int32Array(256)
      for (const b of body) freq[b]!++
      const p = pack(body)!
      let ours = 0
      let o = 6
      for (let s = 0; s < 256; s++) {
        if (p[o] === 0xff) {
          o++
          continue
        }
        const bits = p[o]! + 1
        ours += bits * freq[s]!
        o += 1 + ((bits + 7) >> 3)
      }
      const best = huffmanBits(freq)
      expect(ours).toBe(best)
    }
  })

  const FREQ_SKEW = Uint8Array.from({ length: 20_000 }, (_, i) => (i % 100 < 90 ? 32 : (i * 7) & 0xff))

  it('is the only packer here with a cipher, and says so in the stream', () => {
    // $a009 against BLZW's $8009 and the other three's 9, and HUFF is the only
    // one that ever fetches xsp_Password at $20(a2)
    const body = ascii('the quick brown fox jumps over the lazy dog. '.repeat(400))
    const s = xpkPack(body, 'HUFF', 'hunter2')
    expect(xpkExamine(s, 'hunter2').flags & XPKSTREAMF_PASSWORD).toBe(XPKSTREAMF_PASSWORD)
    expect(Array.from(xpkUnpack(s, 'hunter2'))).toEqual(Array.from(body))
    // the four without one still refuse, which is what XPK_NO_CRYPT is for
    for (const m of ['NONE', 'RLEN', 'NUKE', 'CBR0', 'BLZW']) {
      expect(codeOf(() => xpkPack(body, m, 'hunter2')), m).toBe(XPKERR_NOCRYPT)
    }
  })

  it('will not read an encrypted chunk with the wrong password, or none', () => {
    const body = ascii('the quick brown fox jumps over the lazy dog. '.repeat(400))
    const s = xpkPack(body, 'HUFF', 'hunter2')
    // $7ba tests the check longword before a byte is decoded
    expect(codeOf(() => xpkUnpack(s, 'hunter3'))).toBe(XPKERR_BADPASSWORD)
    // and the master's own probe at $576 gets there first when there is none
    expect(codeOf(() => xpkUnpack(s))).toBe(XPKERR_PASSWORD)
    // xsh_Initial would otherwise hand back sixteen bytes of the plaintext
    expect(Array.from(s.subarray(16, 32)).every((b) => b === 0)).toBe(true)
  })

  it('enciphers everything past the six-byte head and nothing before it', () => {
    const clear = pack(ABC)!
    const sealed = pack(ABC, 'k')!
    expect(sealed.length).toBe(clear.length)
    expect(Array.from(sealed.subarray(0, 2))).toEqual([0, 0])
    expect(rd32(sealed, 2)).not.toBe(0xabadcafe)
    // $6ea chains each byte off the CIPHER byte before it, so one plaintext
    // run does not come out as one ciphertext run
    expect(Array.from(sealed.subarray(6, 40))).not.toEqual(Array.from(clear.subarray(6, 40)))
    expect(Array.from(HUFF.unpackChunk(sealed, 400, 'k'))).toEqual(Array.from(ABC))
  })

  it('rejects a version word it does not know, which is $784', () => {
    const p = pack(ABC)!
    for (const bad of [1, 0x100, 0xffff]) {
      const broken = p.slice()
      broken[0] = bad >> 8
      broken[1] = bad & 0xff
      expect(codeOf(() => HUFF.unpackChunk(broken, 400)), `${bad}`).toBe(XPKERR_SUBTOOOLD)
    }
  })

  it('round-trips, enciphered and not, at every shape the tree can take', () => {
    const cases: Array<[string, Uint8Array]> = [
      ['one value', new Uint8Array(2000).fill(0)],
      ['two values', Uint8Array.from({ length: 5000 }, (_, i) => (i % 3 ? 1 : 2))],
      ['all 256, flat', Uint8Array.from({ length: 20_000 }, (_, i) => i & 0xff)],
      ['skewed', FREQ_SKEW],
      ['text', ascii('the quick brown fox jumps over the lazy dog. '.repeat(400))],
      ['incompressible', noise(30_000)],
    ]
    for (const [name, body] of cases) {
      for (const pw of [undefined, '', 'k', 'a passphrase longer than most chunks care about']) {
        // $730 splits the one overrun exit two ways: EXPANSION with no
        // password, SMALLBUF with one, because an enciphered chunk cannot be
        // handed back raw
        let p: Uint8Array | null = null
        try {
          p = pack(body, pw)
        } catch (e) {
          expect((e as XpkError).code, `${name} / ${pw}`).toBe(XPKERR_SMALLBUF)
          expect(pw, `${name}`).not.toBeUndefined()
          continue
        }
        if (p === null) {
          expect(pw, `${name}`).toBeUndefined()
          continue
        }
        expect(Array.from(HUFF.unpackChunk(p, body.length, pw)), `${name} / ${pw}`).toEqual(Array.from(body))
      }
    }
  })

  it('answers SMALLBUF rather than EXPANSION once a password is set', () => {
    // $71a frees and then splits on xsp_Password: an enciphered chunk cannot
    // be handed back raw, so there is nothing for the master to fall back to
    expect(pack(noise(30_000))).toBe(null)
    expect(codeOf(() => pack(noise(30_000), 'k'))).toBe(XPKERR_SMALLBUF)
  })

  it('is the third packer that makes the master write LONG chunk headers', () => {
    expect(HUFF.maxChunk).toBe(0xfffe)
    expect(HUFF.defaultChunk).toBe(0xfffe)
    expect(HUFF.minChunk).toBe(1)
    expect(HUFF.defaultChunk!).toBeGreaterThan(XPK_LONGHDR_ABOVE)
    const body = ascii('AMOS Professional '.repeat(20_000))
    const s = xpkPack(body, 'HUFF')
    expect(xpkExamine(s).flags & XPKSTREAMF_LONGHDRS).toBe(XPKSTREAMF_LONGHDRS)
    expect(rd32(s, 36 + 8)).toBe(0xfffe) // xch_ULen, a longword in this form
    expect(Array.from(xpkUnpack(s))).toEqual(Array.from(body))
  })
})

describe('against the real xpkHUFF.library 0.61', () => {
  const LIB = join(fixtures, 'libs', 'xpkhuff.library')
  const load = (): Uint8Array => loadHunks(new Uint8Array(readFileSync(LIB)), 0).image

  it.skipIf(!existsSync(LIB))('names itself, and hangs ten entries off a longword table', () => {
    const img = load()
    const u16 = (o: number): number => (at(img, o) << 8) | at(img, o + 1)
    const u32 = (o: number): number =>
      ((at(img, o) << 24) | (at(img, o + 1) << 16) | (at(img, o + 2) << 8) | at(img, o + 3)) >>> 0
    const str = (o: number): string => {
      let s = ''
      for (let k = o; at(img, k) !== 0; k++) s += String.fromCharCode(at(img, k))
      return s
    }
    let tag = -1
    for (let o = 0; o + 26 <= img.length; o += 2) if (u16(o) === 0x4afc && u32(o + 2) === o) tag = o
    expect(tag).toBe(0xc4)
    expect(str(u32(tag + 14))).toBe('xpkHUFF.library')
    // rt_IdString ends in the author's university email address, so only the
    // part in front of it is written out here. The $a0 after "$DATE:" is a
    // Latin-1 non-breaking space, as in CBR0's strings. Three of them here,
    // at 15, 17 and 30, and they are left exactly where he put them -- along
    // with the double space before the 8.
    const id = str(u32(tag + 18))
    expect(id.startsWith('xpkHUFF.library\u00a0V\u00a00.61 ($DATE:\u00a0Sat Aug  8 19:58:02 1992 by M.Zimmermann (')).toBe(
      true,
    )
    expect(id.endsWith('))')).toBe(true)
    expect(id.length).toBe(105)

    const vectors = u32(u32(tag + 22) + 4)
    expect(vectors).toBe(0x170)
    const lvo = (n: number): number => u32(vectors + (n / 6 - 1) * 4)
    expect(lvo(30)).toBe(0x3e0) // XpkPackerInfo
    expect(lvo(36)).toBe(0x3ea) // XpkPackChunk
    expect(lvo(54)).toBe(0x3fa) // XpkUnpackChunk
    // -42 XpkPackFree and -48 XpkPackReset are one `rts` each
    expect(at(img, lvo(42))).toBe(0x4e)
    expect(at(img, lvo(42) + 1)).toBe(0x75)
    expect(lvo(48)).toBe(lvo(42) + 2)
    expect(u32(vectors + 10 * 4)).toBe(0xffffffff)
  })

  it.skipIf(!existsSync(LIB))('fills its XpkInfo in at $224, at library base + $26', () => {
    const img = load()
    const u16 = (o: number): number => (at(img, o) << 8) | at(img, o + 1)
    const u32 = (o: number): number =>
      ((at(img, o) << 24) | (at(img, o + 1) << 16) | (at(img, o + 2) << 8) | at(img, o + 3)) >>> 0
    const str = (o: number): string => {
      let s = ''
      for (let k = o; at(img, k) !== 0; k++) s += String.fromCharCode(at(img, k))
      return s
    }
    const HUFF = XPK_PACKERS.get('HUFF')!
    // XpkPackerInfo is `move.l a6,d0 / addi.l #$26,d0 / rts`, so there is no
    // static to read: $224 onward is the run of moves that builds it
    expect(u32(0x3e4)).toBe(0x26) // the immediate of the `addi.l #$26,d0`
    expect(str(0x2d4)).toBe('HUFF')
    // "Huffman\xa0V\xa00.61", non-breaking spaces and all
    expect(str(0x2dc)).toBe(HUFF.longName)
    expect(HUFF.longName.charCodeAt(9)).toBe(0xa0)
    expect(str(0x2ec)).toBe('Dynamic huffman crunch algorithm, cache optimized byte decrunch algorithm')
    expect(u32(0x258)).toBe(0x48554646) // xpi_ID, 'HUFF'
    // $a009: BLZW's $8009 with bit 13 added, and HUFF is the only one here
    // that reads xsp_Password
    expect(u32(0x260)).toBe(0xa009)
    expect(u32(0x268)).toBe(HUFF.maxChunk)
    expect(u32(0x270)).toBe(HUFF.minChunk)
    expect(u32(0x278)).toBe(HUFF.defaultChunk)
    // the four progress strings, and then xpi_DefMode
    expect(str(0x338)).toBe('Crunching')
    expect(str(0x344)).toBe('Decrunching')
    expect(str(0x350)).toBe('Crunched')
    expect(str(0x35c)).toBe('Decrunched')
    expect(u16(0x2a0)).toBe(50)
  })

  it.skipIf(!existsSync(LIB))('sizes both work buffers to exactly what the format needs', () => {
    const img = load()
    const u32 = (o: number): number =>
      ((at(img, o) << 24) | (at(img, o + 1) << 16) | (at(img, o + 2) << 8) | at(img, o + 3)) >>> 0
    const HUFF = XPK_PACKERS.get('HUFF')!
    // $418, the packer's AllocMem. $220 leaves, $2240 internal nodes, $4220
    // the root pointer, $4224 the 256 code pointers, $5224 the codes.
    const pack = u32(0x41a)
    expect(pack).toBe(0x7324)
    expect(0x2240 - 0x220).toBeGreaterThanOrEqual(256 * 0x20) // room for every leaf
    expect(0x4220 - 0x2240).toBeGreaterThanOrEqual(255 * 0x20) // and every join
    expect(0x5224 - 0x4224).toBeGreaterThanOrEqual(256 * 4) // one pointer a value
    // a code over 256 values runs to 255 bits, so 32 bytes plus its length
    expect(pack - 0x5224).toBe(256 * 33)

    // $742, the unpacker's. $26 is the trie and $141c the buffer it deciphers
    // into, and both come out exact.
    const unpack = u32(0x744)
    expect(unpack).toBe(0x1141a)
    expect(0x141c - 0x26).toBe(511 * 10) // 256 leaves and 255 forks, ten bytes each
    expect(unpack - 0x141c).toBe(HUFF.maxChunk)

    // and the two cipher seeds, $abadcafe and $c0de, in both halves
    expect(u32(0x5ee)).toBe(0xabadcafe)
    expect(u32(0x79a)).toBe(0xabadcafe)
    expect((at(img, 0x5fa) << 8) | at(img, 0x5fb)).toBe(0xc0de)
    expect((at(img, 0x7a0) << 8) | at(img, 0x7a1)).toBe(0xc0de)
  })
})

describe('xpkIMPL.library, ported whole', () => {
  const IMPL = XPK_PACKERS.get('IMPL')!
  const pack = (b: Uint8Array, mode = 0): Uint8Array | null => IMPL.packChunk(b, mode)
  const trip = (b: Uint8Array, mode = 0): number[] => {
    const p = pack(b, mode)
    return p === null ? [...b] : [...IMPL.unpackChunk(p, b.length)]
  }

  it('says it is Turbo Implode 0.18 and asks for a 65536 chunk', () => {
    expect(IMPL.longName).toBe('Turbo Implode 0.18')
    expect(IMPL.maxChunk).toBe(524_288)
    expect(IMPL.minChunk).toBe(64)
    expect(IMPL.defaultChunk).toBe(65_536)
  })

  it('writes a whole IMP! file into the chunk, magic and all', () => {
    // $c96 lays the magic down over the first four bytes of the crunched
    // stream, and $d60 refuses to decode a chunk that does not open with it.
    // No other packer here ships a container inside the container.
    const p = pack(ascii('AMOS Professional '.repeat(200)))!
    expect(String.fromCharCode(...p.subarray(0, 4))).toBe('IMP!')
    expect(rd32(p, 4)).toBe(3600) // the unpacked length, again
    // and the tail sits at the crunched length, 46 bytes short of the end
    expect(rd32(p, 8) + 46).toBe(p.length)
  })

  it('refuses anything under 64 bytes, which is its own xpi_MinChunk', () => {
    // $a44, and the master never sends a smaller chunk because $a9e raises
    // the chunk size to xpi_MinChunk first
    expect(pack(new Uint8Array(63).fill(7))).toBe(null)
    expect(pack(ascii('AMOS Professional '.repeat(20)).subarray(0, 200))).not.toBe(null)
  })

  it('refuses input it cannot beat by 54 bytes, tail included', () => {
    // $c6e. The 46-byte tail is written INTO the input buffer past the
    // crunched stream, so a chunk that saved less than that has nowhere to
    // put it.
    expect(pack(noise(4000))).toBe(null)
    expect(pack(noise(200))).toBe(null)
  })

  it('also refuses input it compressed TOO well, which reads like a bug', () => {
    // $c5e turns down a crunched stream under twelve bytes, because the
    // twelve the header displaces have to come from somewhere. 400 zeros go
    // out in two matches and about six bytes, so they are unpackable; a
    // thousand of them reach twelve on the nose and pack to 58.
    expect(pack(new Uint8Array(400))).toBe(null)
    const long = pack(new Uint8Array(1000))!
    expect(long.length).toBe(58)
    expect(rd32(long, 8)).toBe(12)
  })

  it('round-trips runs, text, ramps and the boundary sizes', () => {
    for (const n of [64, 65, 127, 128, 2047, 2048, 2049, 5000]) {
      expect(trip(new Uint8Array(n).fill(0x5a)), `run ${n}`).toEqual([...new Uint8Array(n).fill(0x5a)])
      const text = ascii('The quick brown fox jumps over the lazy dog. '.repeat(n)).subarray(0, n)
      expect(trip(text), `text ${n}`).toEqual([...text])
      const ramp = Uint8Array.from({ length: n }, (_, i) => i & 0x3f)
      expect(trip(ramp), `ramp ${n}`).toEqual([...ramp])
    }
  })

  it('crosses the 2048-byte line where it stops scanning and starts hashing', () => {
    // $b04: above $800 the library builds 65536 buckets and a node per window
    // position and walks chains at $6d2; at or below it, $7a4 compares every
    // position in the window against the current byte. They are different
    // searches, so the output differs across the line even though the input
    // barely does.
    const body = (n: number): Uint8Array => ascii('AMOS Pro '.repeat(400)).subarray(0, n)
    const under = pack(body(2048))!
    const over = pack(body(2049))!
    expect(under.length).toBeLessThan(2048)
    expect(over.length).toBeLessThan(2049)
    expect([...IMPL.unpackChunk(under, 2048)]).toEqual([...body(2048)])
    expect([...IMPL.unpackChunk(over, 2049)]).toEqual([...body(2049)])
  })

  it('reads the mode and the length together, so a big chunk gets a wide window', () => {
    // $168. Mode 0 scales the table index by one per cent and floors it away,
    // so the smallest window wins; mode 99 keeps the index whole. The two
    // land on different offset tables and so on different output.
    const body = ascii('Sed ut perspiciatis unde omnis iste natus error sit voluptatem. '.repeat(300))
    const lazy = pack(body, 0)!
    const keen = pack(body, 99)!
    // the twelve offset-bit counts are the last twelve bytes of the file
    expect([...lazy.subarray(lazy.length - 12)]).not.toEqual([...keen.subarray(keen.length - 12)])
    expect([...IMPL.unpackChunk(lazy, body.length)]).toEqual([...body])
    expect([...IMPL.unpackChunk(keen, body.length)]).toEqual([...body])
  })

  it('mode 100 reads a different table and is not mode 99 plus one', () => {
    // $170 branches on the mode being exactly 100 and takes the coarser table
    // at $43a with no scaling at all, so the two modes are not neighbours.
    const body = ascii('Turbo Implode '.repeat(1200))
    const a = pack(body, 99)!
    const b = pack(body, 100)!
    expect([...a.subarray(a.length - 12)]).not.toEqual([...b.subarray(b.length - 12)])
  })

  it('derives its offset bases so the three arms leave no gap', () => {
    // $ab8: base = 1 << bits, then every entry from four up adds the one four
    // places below. That is what makes arm `0`, arm `10` and arm `11` cover a
    // contiguous run of offsets, and the last four bases -- which are
    // computed and then never written to the file -- come out at the window.
    // mode 100 and 600,000 bytes is the only way to the twelfth table: $1a8
    // wants half a million before it hands out the top index
    const body = new Uint8Array(600_000).fill(3)
    const p = pack(body, 100)!
    const bits = [...p.subarray(p.length - 12)]
    const base = bits.map((b) => 1 << b)
    for (let i = 4; i < 12; i++) base[i]! += base[i - 4]!
    for (let tab = 0; tab < 4; tab++) {
      expect(rd16(p, p.length - 28 + tab * 2), `arm 0 cap, table ${tab}`).toBe(base[tab])
      expect(rd16(p, p.length - 28 + 8 + tab * 2), `arm 10 cap, table ${tab}`).toBe(base[tab + 4])
    }
    // 135680 is IMP_WINDOW's last entry, and table 3 is the only one that
    // reaches it
    expect(base[11]).toBe(135_680)
  })

  it('pads an odd stream and says so in bit 15 of the seed word', () => {
    // $c86: the tail is read as longwords, so an odd crunched length gets a
    // zero byte and the decoder is told to step back over it. Both parities
    // turn up across a spread of run lengths.
    const seen = new Set<boolean>()
    for (let n = 64; n < 400; n++) {
      const p = pack(Uint8Array.from({ length: n }, (_, i) => (i * i) & 0x1f))
      if (p === null) continue
      const tail = rd32(p, 8)
      expect(tail % 2).toBe(0)
      seen.add((rd16(p, tail + 16) & 0x8000) !== 0)
    }
    expect([...seen].sort()).toEqual([false, true])
  })

  it('answers CORRUPTPKD for a chunk that is not an IMP! file', () => {
    // $d66 falls straight to `moveq #0,d0` on a bad magic, and $23e turns
    // that into $f2
    expect(codeOf(() => IMPL.unpackChunk(new Uint8Array(64).fill(9), 64))).toBe(XPKERR_CORRUPTPKD)
  })

  it('answers CORRUPTPKD when the reader does not land exactly on byte zero', () => {
    // $dd8, the one whole-stream integrity test the format has: a corrupted
    // bit leaves the read pointer short or long, and anything but zero is a
    // refusal. AMCAF's own decruncher makes no such test.
    const body = ascii('AMOS Professional '.repeat(300))
    const p = pack(body)!
    const bent = Uint8Array.from(p)
    bent[20] = bent[20]! ^ 0x55
    expect(codeOf(() => IMPL.unpackChunk(bent, body.length))).toBe(XPKERR_CORRUPTPKD)
  })

  it('goes through xpkPack whole, in long-header chunks', () => {
    // 65536 is over the master's 65000 line at $aec, so IMPL is the fourth
    // packer here whose streams carry twelve-byte chunk headers
    const body = ascii('AMOS Professional 2.0 '.repeat(9000))
    const s = xpkPack(body, 'IMPL')
    expect(xpkExamine(s).flags & XPKSTREAMF_LONGHDRS).toBe(XPKSTREAMF_LONGHDRS)
    expect(xpkExamine(s).uLen).toBe(body.length)
    expect(s.length).toBeLessThan(body.length / 20)
    expect([...xpkUnpack(s)]).toEqual([...body])
  })

  it('has no cipher, and says so', () => {
    // nothing in $15e or $224 fetches xsp_Password at $20(a2)
    expect(codeOf(() => xpkPack(new Uint8Array(200), 'IMPL', 'secret'))).toBe(XPKERR_NOCRYPT)
  })
})

describe('against the real xpkIMPL.library 0.18', () => {
  const LIB = join(fixtures, 'libs', 'xpkimpl.library')
  const load = (): Uint8Array => loadHunks(new Uint8Array(readFileSync(LIB)), 0).image

  it.skipIf(!existsSync(LIB))('exports nineteen vectors, nine more than the XPK API asks for', () => {
    const img = load()
    const u16 = (o: number): number => (at(img, o) << 8) | at(img, o + 1)
    const u32 = (o: number): number =>
      ((at(img, o) << 24) | (at(img, o + 1) << 16) | (at(img, o + 2) << 8) | at(img, o + 3)) >>> 0
    const str = (o: number): string => {
      let s = ''
      for (let k = o; at(img, k) !== 0; k++) s += String.fromCharCode(at(img, k))
      return s
    }
    let tag = -1
    for (let o = 0; o + 26 <= img.length; o += 2) if (u16(o) === 0x4afc && u32(o + 2) === o) tag = o
    expect(tag).toBe(4)
    expect(str(u32(tag + 14))).toBe('xpkIMPL.library')
    // plain spaces throughout, unlike CBR0 and HUFF, and it ends in a CR LF
    expect(str(u32(tag + 18))).toBe('xpkIMPL 0.18.77 (26-Sep-92 15:15:23)\r\n')

    const vectors = u32(u32(tag + 22) + 4)
    expect(vectors).toBe(0x6c)
    const lvo = (n: number): number => u32(vectors + (n / 6 - 1) * 4)
    expect(lvo(30)).toBe(0x156) // XpkPackerInfo
    expect(lvo(36)).toBe(0x15e) // XpkPackChunk
    expect(lvo(54)).toBe(0x224) // XpkUnpackChunk
    // and then the codec itself, which nothing in XPK reaches. $4a6 is what
    // XpkPackChunk calls after copying the input, $d60 what XpkUnpackChunk
    // does; $49c and $da0 are the same two with the IMP! header left off.
    expect(lvo(96)).toBe(0x49c)
    expect(lvo(102)).toBe(0xda0)
    expect(lvo(108)).toBe(0x4a6)
    expect(lvo(114)).toBe(0xd60)
    expect(u32(vectors + 19 * 4)).toBe(0xffffffff)
  })

  it.skipIf(!existsSync(LIB))('keeps a static XpkInfo at $270', () => {
    const img = load()
    const u16 = (o: number): number => (at(img, o) << 8) | at(img, o + 1)
    const u32 = (o: number): number =>
      ((at(img, o) << 24) | (at(img, o + 1) << 16) | (at(img, o + 2) << 8) | at(img, o + 3)) >>> 0
    const str = (o: number): string => {
      let s = ''
      for (let k = o; at(img, k) !== 0; k++) s += String.fromCharCode(at(img, k))
      return s
    }
    const IMPL = XPK_PACKERS.get('IMPL')!
    // XpkPackerInfo is `lea $270(pc),a0 / move.l a0,d0 / rts`
    expect(str(u32(0x278))).toBe('IMPL')
    expect(str(u32(0x27c))).toBe(IMPL.longName)
    expect(str(u32(0x280))).toBe('A well-known compressor with dynamic compression modes')
    expect(u32(0x284)).toBe(0x494d504c) // xpi_ID, 'IMPL'
    expect(u32(0x288)).toBe(0x8009) // BLZW's flags exactly, and no bit 13
    expect(u32(0x28c)).toBe(IMPL.maxChunk)
    expect(u32(0x290)).toBe(IMPL.minChunk)
    expect(u32(0x294)).toBe(IMPL.defaultChunk)
    // the four progress strings, in packing / unpacking / packed / unpacked
    // order, and then xpi_DefMode
    expect(str(u32(0x298))).toBe('Imploding')
    expect(str(u32(0x29c))).toBe('Exploding')
    expect(str(u32(0x2a0))).toBe('Imploded')
    expect(str(u32(0x2a4))).toBe('Exploded')
    expect(u16(0x2a8)).toBe(100)
    // six modes, 10 30 50 75 99 100, each 42 bytes with its label inline
    let m = u32(0x2ac)
    const upto: number[] = []
    for (let i = 0; i < 8 && m !== 0; i++) {
      upto.push(u32(m + 4))
      m = u32(m)
    }
    expect(upto).toEqual([10, 30, 50, 75, 99, 100])
    // and the label is inline in the struct rather than a pointer, which is
    // what makes each one 42 bytes
    expect(str(u32(0x2ac) + 0x20)).toBe('0.1 * max')
  })

  it.skipIf(!existsSync(LIB))('carries the same code tables the exploder reads out of the file', () => {
    const img = load()
    // IMPL $ee0 and $ee4: LEN_BASE and LEN_BITS, byte for byte what
    // ../amiga/imploder.ts read out of AMCAF's inlined decruncher at $86a2
    expect([...img.subarray(0xee0, 0xee4)]).toEqual([6, 10, 10, 18])
    expect([...img.subarray(0xee4, 0xef0)]).toEqual([1, 1, 1, 1, 2, 3, 3, 4, 4, 5, 7, 14])
    // and the packer's own copy at $4c8, with the run bases and caps in front
    // of it as twelve words at $4b0
    expect([...img.subarray(0x4c8, 0x4d4)]).toEqual([1, 1, 1, 1, 2, 3, 3, 4, 4, 5, 7, 14])
    const words: number[] = []
    for (let i = 0; i < 12; i++) words.push((at(img, 0x4b0 + i * 2) << 8) | at(img, 0x4b0 + i * 2 + 1))
    expect(words).toEqual([2, 2, 2, 2, 6, 10, 10, 18, 22, 42, 138, 16402])
    // the twelve length codes, value at $4d2 and bit count at $4d6
    expect([...img.subarray(0x4d4, 0x4d8)]).toEqual([0, 2, 6, 14])
    expect([...img.subarray(0x4d8, 0x4dc)]).toEqual([1, 2, 3, 4])
  })

  it.skipIf(!existsSync(LIB))('sizes its window table to its offset tables, exactly', () => {
    const img = load()
    const u32 = (o: number): number =>
      ((at(img, o) << 24) | (at(img, o + 1) << 16) | (at(img, o + 2) << 8) | at(img, o + 3)) >>> 0
    // $4dc, twelve window sizes, and $50c, twelve offset-bit tables. The
    // widest offset table `k` can encode is what window `k` is, to the byte,
    // which is what says the two tables are a matched pair and not two
    // guesses. It only comes out for table 3: the shorter matches never
    // reach the far end of the window.
    for (let k = 0; k < 12; k++) {
      const bits = [...img.subarray(0x50c + k * 12, 0x50c + k * 12 + 12)]
      const base = bits.map((b) => 1 << b)
      for (let i = 4; i < 12; i++) base[i]! += base[i - 4]!
      expect(base[11], `table ${k}`).toBe(u32(0x4dc + k * 4))
    }
    // 65536 buckets of a longword each, keyed on two whole bytes, which is
    // why $71e can start comparing at the third. $5dc builds the size as
    // `moveq #4,d0 / swap d0` rather than an immediate, so the number itself
    // is only readable where $694 frees it again.
    expect([at(img, 0x5dc), at(img, 0x5dd), at(img, 0x5de), at(img, 0x5df)]).toEqual([0x70, 0x04, 0x48, 0x40])
    expect(u32(0x696)).toBe(0x40000)
  })
})

/**
 * `ancient` as an independent reader, which is the only check this file has
 * ever had that is not itself.
 *
 * Everything above proves the port agrees with the binary as this port read
 * it, or that the writer and reader here agree with each other. Neither
 * catches a misreading, and the header says so: no XPKF stream exists in the
 * corpus, so there is no artefact. Teemu Suutari's `ancient` implements the
 * XPK container and 72 methods, RLEN and NONE among them, from its own
 * reading. When our stream decodes correctly under it, the container and the
 * codec are confirmed by somebody who did not read our disassembly.
 */
describe('against ancient, an independent XPK implementation', () => {
  // The probe, the version list and the AMOS_ORACLE gate are shared with the
  // PowerPacker and StoneCracker suites: ../testing/oracle.ts.
  //
  // What this describe pins is observed output, not documented output. `Files
  // match!`, `XPK-<method>` and the `<invalid>` disagreement below are all
  // quirks of the identify path rather than promises, which is why CHECKED
  // lists the builds they have been seen on. CI installed 2.1.0 and every
  // test here passed unaltered, `<invalid>` included, while CHECKED still
  // held 2.3.0 alone and failed by name. Version drift therefore reads as
  // version drift, and the codecs still get checked while it is sorted out.
  it('is installed wherever it is required', () => {
    if (!ORACLE_REQUIRED) return
    expect(HAS_ANCIENT, 'AMOS_ORACLE=1 but `ancient` is not on PATH').toBe(true)
  })

  it.skipIf(!HAS_ANCIENT)('records which build produced the evidence', () => {
    expect(ORACLE, 'ancient --version said nothing this could parse').not.toBe(null)
    expect(CHECKED, `ancient ${ORACLE} has not been checked against the expectations in this file`).toContain(ORACLE)
  })

  const CASES: Array<[string, Uint8Array]> = [
    ['one byte', new Uint8Array([65])],
    ['a run past the 127 cap', new Uint8Array(400).fill(0x5a)],
    ['a literal past the 127 cap', Uint8Array.from({ length: 300 }, (_, i) => i & 0xff)],
    ['incompressible', noise(40_000)],
    ['one long run', new Uint8Array(100_000)],
    ['several chunks', Uint8Array.from({ length: 90_000 }, (_, i) => i % 251)],
    ['runs and literals mixed', Uint8Array.from({ length: 65_536 }, (_, i) => (i % 97 < 60 ? 7 : (i * 31) & 0xff))],
    ['good then bad, which resets BLZW', (() => {
      const good = ascii('AMOS Professional 2.0 '.repeat(3000))
      const b = new Uint8Array(good.length + 40_000)
      b.set(good)
      b.set(noise(40_000), good.length)
      return b
    })()],
  ]

  /** whether any chunk in the stream came back type 1, XPKCHUNK_PACKED */
  const anyPacked = (s: Uint8Array): boolean => {
    const long = (xpkExamine(s).flags & XPKSTREAMF_LONGHDRS) !== 0
    for (let o = 36; o < s.length; ) {
      const type = at(s, o)
      if (type === XPKCHUNK_END) return false
      if (type === XPKCHUNK_PACKED) return true
      const [cLen, uLen] = long ? [rd32(s, o + 4), rd32(s, o + 8)] : [(at(s, o + 4) << 8) | at(s, o + 5), 0]
      void uLen
      o += (long ? 12 : 8) + ((cLen + 3) & ~3)
    }
    return false
  }

  it.skipIf(!HAS_ANCIENT)('decodes every stream xpkPack writes, for every installed method', () => {
    const dir = mkdtempSync(join(tmpdir(), 'amos-xpk-'))
    for (const [name, body] of CASES) {
      const raw = join(dir, 'raw')
      writeFileSync(raw, body)
      for (const method of ['NONE', 'RLEN', 'NUKE', 'CBR0', 'BLZW', 'HUFF', 'IMPL']) {
        const packed = join(dir, method)
        const stream = xpkPack(body, method)
        writeFileSync(packed, stream)
        const id = execFileSync('ancient', ['identify', packed], { encoding: 'utf8' })
        // ancient will not NAME a BLZW, HUFF or IMPL stream whose chunks all
        // came back raw, though the next line shows it decodes one perfectly
        // well. NONE, RLEN, NUKE and CBR0 all name themselves off the header
        // alone. Recorded, not settled: it is ancient's identify path, and
        // the streams themselves are fine.
        if (method !== 'NONE' && method !== 'RLEN' && method !== 'NUKE' && method !== 'CBR0' && !anyPacked(stream)) {
          expect(id, `${name} / ${method}`).toContain('<invalid>')
        } else {
          expect(id, `${name} / ${method}`).toContain(`XPK-${method}`)
        }
        const out = execFileSync('ancient', ['verify', packed, raw], { encoding: 'utf8' })
        expect(out, `${name} / ${method}`).toContain('Files match!')
      }
    }
  })

  it.skipIf(!HAS_ANCIENT)('and disagrees about exactly one thing: a stream of nothing', () => {
    // 36 bytes of header and an END chunk, well formed -- the header XORs to
    // zero and xpkExamine reads it back as ULen 0. ancient will not identify
    // it under ANY method, so this is the container and not one codec. The
    // master's probe at $450 tests the magic, the checksum and the flags and
    // has no ULen test in it that this port has found, so the disagreement is
    // recorded rather than settled. It holds for the twelve-byte header form
    // CBR0, BLZW, HUFF and IMPL ask for too.
    const dir = mkdtempSync(join(tmpdir(), 'amos-xpk-'))
    for (const method of ['NONE', 'RLEN', 'NUKE', 'CBR0', 'BLZW', 'HUFF', 'IMPL']) {
      const stream = xpkPack(new Uint8Array(0), method)
      const long = (xpkExamine(stream).flags & XPKSTREAMF_LONGHDRS) !== 0
      expect(stream.length, method).toBe(36 + (long ? 12 : 8))
      expect(long, method).toBe(method !== 'NONE' && method !== 'RLEN' && method !== 'NUKE')
      expect(xpkExamine(stream).uLen).toBe(0)
      expect(xpkUnpack(stream).length).toBe(0)
      const packed = join(dir, method)
      writeFileSync(packed, stream)
      // the refusal goes to stderr, where a successful identify goes to stdout
      const r = spawnSync('ancient', ['identify', packed], { encoding: 'utf8' })
      expect(r.stdout).toBe('')
      expect(r.stderr).toContain('Unknown or invalid compression format')
    }
  })
})
