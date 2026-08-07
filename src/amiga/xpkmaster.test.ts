import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
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
} from './xpkmaster'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '..', '..', 'fixtures')
const PP_FIXTURE = join(fixtures, 'powerpacker', 'OctaMEDPlayer.guide.pp')

const bytes = (...v: number[]): Uint8Array => new Uint8Array(v)
/** one byte, and never `undefined` -- these tests index fixed-size headers */
const at = (b: Uint8Array, i: number): number => b[i] ?? 0
const rd32 = (b: Uint8Array, o: number): number =>
  ((at(b, o) << 24) | (at(b, o + 1) << 16) | (at(b, o + 2) << 8) | at(b, o + 3)) >>> 0
const ascii = (s: string): Uint8Array =>
  new Uint8Array([...s].map((c) => c.charCodeAt(0)))

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
    // $608 opens compressors/xpkNUKE.library during the probe; $cf4 turns the
    // failure into MISSINGLIB. Nothing has been decoded at this point.
    expect(codeOf(() => xpkExamine(header('NUKE', 100)))).toBe(XPKERR_MISSINGLIB)
    expect(codeOf(() => xpkExamine(header('HUFF', 100)))).toBe(XPKERR_MISSINGLIB)
    expect(codeOf(() => xpkExamine(header('RLEN', 100)))).toBe(XPKERR_MISSINGLIB)
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

  it('is the only compressor installed', () => {
    expect([...XPK_PACKERS.keys()]).toEqual(['NONE'])
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

  it('stays in the word-length header form, because 32768 is under 65000', () => {
    const s = xpkPack(body, 'NONE')
    expect(at(s, 32) & 1).toBe(0) // XPKSTREAMF_LONGHDRS clear
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

  it('splits at 32768 bytes and each chunk carries its own checksum', () => {
    const big = new Uint8Array(XPK_DEFAULT_CHUNK + 1000)
    for (let i = 0; i < big.length; i++) big[i] = (i * 7) & 0xff
    const s = xpkPack(big, 'NONE')
    expect(at(s, 36)).toBe(XPKCHUNK_RAW)
    expect(xpkHeaderChecksum(s, 36, 8)).toBe(0)
    const second = 36 + 8 + XPK_DEFAULT_CHUNK
    expect(at(s, second)).toBe(XPKCHUNK_RAW)
    expect(xpkHeaderChecksum(s, second, 8)).toBe(0)
    expect((at(s, second + 4) << 8) | at(s, second + 5)).toBe(1000)
  })

  it('refuses a method with no library, and NONE refuses to encrypt', () => {
    expect(codeOf(() => xpkPack(body, 'NUKE'))).toBe(XPKERR_MISSINGLIB)
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
