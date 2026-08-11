import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SOLARIS_TAG,
  SOLARIS_MAX_LITERALS,
  isSolaris,
  solarisCrunch,
  solarisDecrunch,
  solarisLength,
} from './solaris'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PACKED = join(root, 'fixtures', 'extensions', 'craft-1.0', 'CRAFT_Help.AMOS.packed')

const bytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0))
const text = (b: Uint8Array): string => String.fromCharCode(...b)
const roundTrip = (b: Uint8Array): Uint8Array => solarisDecrunch(solarisCrunch(b))

describe('the \\SOLARIS/ codec', () => {
  it('round-trips a single byte, which is the whole format in miniature', () => {
    // one literal run of one, a sentinel in the first longword, a checksum
    // and a length: 21 bytes to carry one, and the shortest legal stream
    const packed = solarisCrunch(bytes('A'))
    expect(isSolaris(packed)).toBe(true)
    expect(solarisLength(packed)).toBe(1)
    expect(text(solarisDecrunch(packed))).toBe('A')
  })

  it('keeps a literal run the right way round', () => {
    /*
     * The decoder fills the output DOWNWARD, so a run's first stored byte is
     * its last byte in the file. Getting that backwards round-trips 'A' and
     * 1,000 identical bytes and mirrors everything else, which is exactly how
     * it survived the first pass here — the cases either side of this one both
     * passed while `ABCDEFGH` came back `HGFEDCBA`.
     */
    expect(text(roundTrip(bytes('ABCDEFGH')))).toBe('ABCDEFGH')
    expect(text(roundTrip(bytes('ABCDEFGHI')))).toBe('ABCDEFGHI')
  })

  it('uses the 3-bit count up to eight literals and the 8-bit count above it', () => {
    // the two literal opcodes are one code path with different operands, so
    // the boundary between them is the thing worth pinning
    for (const n of [1, 7, 8, 9, 10, SOLARIS_MAX_LITERALS, SOLARIS_MAX_LITERALS + 1]) {
      const src = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 0xff)
      expect(roundTrip(src), `${n} literals`).toEqual(src)
    }
  })

  it('round-trips inputs that drive it onto every match opcode', () => {
    const cases: Array<[string, Uint8Array]> = [
      ['two-byte repeats', bytes('abab'.repeat(20))],
      ['three-byte repeats', bytes('abcabcabcabcabcabc')],
      ['a long identical run', new Uint8Array(1000).fill(0x2a)],
      ['counting bytes', new Uint8Array(300).map((_, i) => i & 0xff)],
      ['English with repeats', bytes('the turtle draws, the turtle draws, the turtle draws home')],
    ]
    for (const [what, src] of cases) expect(roundTrip(src), what).toEqual(src)
  })

  it('survives 400 pseudo-random inputs across a range of alphabet sizes', () => {
    // a fixed LCG, so a failure is reproducible rather than a flake
    let seed = 12345
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fff_ffff)
    for (let t = 0; t < 400; t++) {
      const src = new Uint8Array(1 + (rnd() % 900))
      for (let i = 0; i < src.length; i++) src[i] = rnd() % (1 + (t % 7))
      expect(roundTrip(src), `case ${t}, ${src.length} bytes`).toEqual(src)
    }
  })

  it('reads a stream with or without the installer tag', () => {
    const packed = solarisCrunch(bytes('turtle'))
    expect(text(packed.subarray(0, SOLARIS_TAG.length))).toBe(SOLARIS_TAG)
    const bare = packed.subarray(SOLARIS_TAG.length)
    expect(isSolaris(bare)).toBe(false)
    expect(text(solarisDecrunch(bare))).toBe('turtle')
  })

  it('refuses a stream whose checksum does not fold to zero', () => {
    // the format's only integrity check, and it covers every longword
    const packed = solarisCrunch(bytes('the quick brown fox jumps over the lazy dog'))
    const at = packed.length - 6
    packed[at] = packed[at]! ^ 0x40
    expect(() => solarisDecrunch(packed)).toThrow(/checksum failed/)
  })

  it('refuses a trailer that is missing, empty or absurd', () => {
    expect(() => solarisDecrunch(new Uint8Array(6))).toThrow(/too short/)
    expect(() => solarisDecrunch(new Uint8Array(16))).toThrow(/declares an empty file/)
    const huge = solarisCrunch(bytes('x'))
    new DataView(huge.buffer).setUint32(huge.length - 4, 0x0fff_ffff, false)
    expect(() => solarisDecrunch(huge)).toThrow(/declares 268435455 bytes/)
  })
})

/*
 * Read inside each test, not at the top of the describe body: `skipIf` marks
 * the tests skipped but vitest still executes the body to collect them, so a
 * hoisted readFileSync throws where the corpus is absent instead of skipping.
 */
const loadPacked = (): Uint8Array => new Uint8Array(readFileSync(PACKED))

describe.skipIf(!existsSync(PACKED))('against the CRAFT installer disk', () => {
  /** the installer's container: a total, then [path, size] until they add up */
  const entries = (raw: Uint8Array): { names: Array<[string, number]>; stream: Uint8Array } => {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    const total = dv.getUint32(0)
    const names: Array<[string, number]> = []
    let at = 4
    let seen = 0
    while (seen < total) {
      let end = at
      while (raw[end] !== 0) end++
      const size = dv.getUint16(end + 1)
      names.push([text(raw.subarray(at, end)), size])
      seen += size
      at = end + 3
    }
    return { names, stream: raw.subarray(at) }
  }

  it('unpacks CRAFT_Help.AMOS to the size the container declares', () => {
    const { names, stream } = entries(loadPacked())
    expect(names).toEqual([['RAM:CRAFT_Help.AMOS', 51856]])
    expect(isSolaris(stream)).toBe(true)
    expect(solarisLength(stream)).toBe(51856)

    // the container and the packed trailer are independent statements of the
    // size, written by different halves of the installer, and they agree
    expect(solarisDecrunch(stream).length).toBe(names[0]![1])
  })

  it('unpacks it to a real AMOS Professional program carrying the help text', () => {
    const out = solarisDecrunch(entries(loadPacked()).stream)
    expect(text(out.subarray(0, 12))).toBe('AMOS Pro101V')
    // Janne Kalliola's hypertext reader, whose Data bank IS the manual
    expect(text(out).includes('CRAFT Help v1.0 by Janne Kalliola')).toBe(true)
  })
})
