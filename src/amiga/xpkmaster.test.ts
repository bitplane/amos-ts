import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  NUKE_BITS,
  NUKE_BASE,
  NUKE_GROUP,
  NUKE_WINDOW,
  XPKERR_BIGBUF,
  XPKSTREAMF_LONGHDRS,
  XPK_LONGHDR_ABOVE,
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
    // $608 opens compressors/xpkBLZW.library during the probe; $cf4 turns the
    // failure into MISSINGLIB. Nothing has been decoded at this point.
    expect(codeOf(() => xpkExamine(header('BLZW', 100)))).toBe(XPKERR_MISSINGLIB)
    expect(codeOf(() => xpkExamine(header('HUFF', 100)))).toBe(XPKERR_MISSINGLIB)
    expect(codeOf(() => xpkExamine(header('CBR0', 100)))).toBe(0)
    expect(codeOf(() => xpkExamine(header('IMPL', 100)))).toBe(XPKERR_MISSINGLIB)
    // RLEN, NUKE and CBR0 used to be on this list and are now installed,
    // which is the point of keeping it
    expect(codeOf(() => xpkExamine(header('RLEN', 100)))).toBe(0)
    expect(codeOf(() => xpkExamine(header('NUKE', 100)))).toBe(0)
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

  it('shares LIBS:Compressors/ with the three packers that pack', () => {
    expect([...XPK_PACKERS.keys()]).toEqual(['NONE', 'RLEN', 'NUKE', 'CBR0'])
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
    expect(codeOf(() => xpkPack(body, 'BLZW'))).toBe(XPKERR_MISSINGLIB)
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

  it('is the only packer here that makes the master write LONG chunk headers', () => {
    // xpi_DefChunk is 65532 and $aec switches to twelve-byte headers over
    // 65000, so CBR0 is what exercises that half of the writer at all
    expect(CBR0.defaultChunk).toBe(0xfffc)
    expect(CBR0.defaultChunk!).toBeGreaterThan(XPK_LONGHDR_ABOVE)
    const body = Uint8Array.from({ length: 200_000 }, (_, i) => (i >> 8) & 0xff)
    const s = xpkPack(body, 'CBR0')
    expect(xpkExamine(s).flags & XPKSTREAMF_LONGHDRS).toBe(XPKSTREAMF_LONGHDRS)
    expect(rd32(s, 36 + 8)).toBe(65_532) // xch_ULen, a longword in this form
    expect(Array.from(xpkUnpack(s))).toEqual(Array.from(body))
    // and the other three stay in the short form
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
  const HAS_ANCIENT = ((): boolean => {
    try {
      execFileSync('ancient', { stdio: 'pipe' })
      return true
    } catch (e) {
      // it exits non-zero with no arguments; only ENOENT means it is absent
      return (e as NodeJS.ErrnoException).code !== 'ENOENT'
    }
  })()

  const CASES: Array<[string, Uint8Array]> = [
    ['one byte', new Uint8Array([65])],
    ['a run past the 127 cap', new Uint8Array(400).fill(0x5a)],
    ['a literal past the 127 cap', Uint8Array.from({ length: 300 }, (_, i) => i & 0xff)],
    ['incompressible', Uint8Array.from({ length: 40_000 }, (_, i) => (i * 2654435761) >>> 24)],
    ['one long run', new Uint8Array(100_000)],
    ['several chunks', Uint8Array.from({ length: 90_000 }, (_, i) => i % 251)],
    ['runs and literals mixed', Uint8Array.from({ length: 65_536 }, (_, i) => (i % 97 < 60 ? 7 : (i * 31) & 0xff))],
  ]

  it.skipIf(!HAS_ANCIENT)('decodes every stream xpkPack writes, for every installed method', () => {
    const dir = mkdtempSync(join(tmpdir(), 'amos-xpk-'))
    for (const [name, body] of CASES) {
      const raw = join(dir, 'raw')
      writeFileSync(raw, body)
      for (const method of ['NONE', 'RLEN', 'NUKE', 'CBR0']) {
        const packed = join(dir, method)
        writeFileSync(packed, xpkPack(body, method))
        const id = execFileSync('ancient', ['identify', packed], { encoding: 'utf8' })
        expect(id, `${name} / ${method}`).toContain(`XPK-${method}`)
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
    // recorded rather than settled. It holds for CBR0's twelve-byte header
    // form too, which is the one thing that was new to test here.
    const dir = mkdtempSync(join(tmpdir(), 'amos-xpk-'))
    for (const method of ['NONE', 'RLEN', 'NUKE', 'CBR0']) {
      const stream = xpkPack(new Uint8Array(0), method)
      const long = (xpkExamine(stream).flags & XPKSTREAMF_LONGHDRS) !== 0
      expect(stream.length, method).toBe(36 + (long ? 12 : 8))
      expect(long, method).toBe(method === 'CBR0')
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
