import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { EXTENSION_TOKENS } from '../ext/registry'
import { tokenize } from '../tokens/source'
import { Runtime } from './runtime'
import { squash, unsquash } from './squash'

/** deterministic PRNG so tests never touch Math.random */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s
  }
}

function roundtrip(bytes: number[] | Uint8Array): void {
  const input = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
  const packed = squash(input)
  if (packed === null) return // too small to win — nothing to decode
  expect(packed.length & 3).toBe(0) // whole 32-bit words
  const back = unsquash(packed)
  expect(Array.from(back)).toEqual(Array.from(input))
}

describe('Squasher II codec (+CompExt.s:1003-1534)', () => {
  it('round-trips highly repetitive data (long matches)', () => {
    roundtrip(new Uint8Array(2000).fill(0x41))
    roundtrip('ABCABCABCABC'.repeat(200).split('').map((c) => c.charCodeAt(0)))
  })

  it('round-trips structured runs and back-references', () => {
    const parts: number[] = []
    for (let k = 0; k < 300; k++) parts.push(k & 0xff, 0, 0, (k * 7) & 0xff)
    roundtrip(parts)
  })

  it('round-trips text with repeated phrases', () => {
    const txt = 'the quick brown fox jumps over the lazy dog. '.repeat(80)
    roundtrip([...txt].map((c) => c.charCodeAt(0)))
  })

  it('round-trips pseudo-random data across many seeds', () => {
    for (const seed of [1, 2, 42, 1337, 0xbeef, 0x1234abcd]) {
      const rnd = lcg(seed)
      // bias toward repetition so some matches form
      const len = 1500 + (rnd() % 800)
      const data = new Uint8Array(len)
      for (let i = 0; i < len; i++) data[i] = rnd() % 6 === 0 ? rnd() & 0xff : data[Math.max(0, i - (rnd() % 40))] ?? 0
      roundtrip(data)
    }
  })

  it('handles every match-length category and both literal-run sizes', () => {
    // long literal run (9..264) then a length-2..256 match family
    const a: number[] = []
    for (let k = 0; k < 100; k++) a.push((k * 13) & 0xff) // incompressible-ish -> literal runs
    a.push(...a.slice(0, 256)) // a long forward-referable region
    for (let g = 2; g <= 10; g++) {
      for (let k = 0; k < g; k++) a.push(0x55)
      a.push(0x99)
    }
    roundtrip(a)
  })

  it('reports inefficient compression as null (Squashed >= Normal)', () => {
    // random, incompressible small block cannot beat the 8-byte trailer + 32
    const rnd = lcg(7)
    const data = new Uint8Array(24)
    for (let i = 0; i < data.length; i++) data[i] = rnd() & 0xff
    expect(squash(data)).toBeNull()
  })

  it('rejects corrupt data via the stored checksum', () => {
    const packed = squash(new Uint8Array(2000).fill(7))!
    packed[0] = packed[0]! ^ 0xff // flip a bit in the first data word
    expect(() => unsquash(packed)).toThrow(/squashed/i)
  })

  it('a block that was never squashed is rejected, zeros and all', () => {
    // APD426's insert_disk_II.amos carries four IFF 8SVX sample banks. Three
    // of them end in a run of zeros, so the original length reads 0, the
    // stored checksum reads 0, the first bit word reads 0 and the checksum
    // cancels against it. Unsquash used to hand those back as an empty
    // Uint8Array and call it a success.
    const iff = new Uint8Array(64)
    iff.set([0x46, 0x4f, 0x52, 0x4d, 0, 0, 0, 0x38, 0x38, 0x53, 0x56, 0x58]) // FORM....8SVX
    expect(() => unsquash(iff)).toThrow(/squashed/i)
    // and the guard bit is what rules out the first bit word being zero, so a
    // non-zero length over a zero word is refused before the decoder walks
    const zeroWord = new Uint8Array(16)
    new DataView(zeroWord.buffer).setUint32(12, 100) // a plausible length
    expect(() => unsquash(zeroWord)).toThrow(/squashed/i)
  })

  it('keeps the checksum long and original length in the trailer', () => {
    const input = new Uint8Array(500).fill(0x20)
    const packed = squash(input)!
    const dv = new DataView(packed.buffer, packed.byteOffset, packed.byteLength)
    expect(dv.getUint32(packed.length - 4)).toBe(500) // last long = original length
  })

  it('the fixed pre-scan reach can find matches beyond a short speed window', () => {
    // An incompressible-looking block followed by an exact copy has no useful
    // matches inside 256 bytes, but is a large win at the pre-scan's reach.
    const half = new Uint8Array(700)
    let x = 0x12345678
    for (let i = 0; i < half.length; i++) {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      half[i] = x
    }
    const input = new Uint8Array(half.length * 2)
    input.set(half)
    input.set(half, half.length)
    const slow = squash(input, 256)
    const scanned = squash(input, 4095)
    expect(scanned).not.toBeNull()
    expect(scanned!.length).toBeLessThan(slow?.length ?? input.length)
    expect(unsquash(scanned!)).toEqual(input)
  })
})

describe('Squash / Unsquash keywords (+CompExt.s)', () => {
  const table = new TokenTable(CORE_TOKENS)
  const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs, true)]))
  function run(src: string): string {
    let out = ''
    const rt = new Runtime(tokenize(src, table, extensions), table, { extensions, maxSteps: 300_000, onText: (t) => (out += t) })
    const r = rt.runHeadless(1_000)
    mustFinish(r)
    return out
  }

  it('compresses a repetitive bank in place and expands it back', () => {
    const prog = [
      'Reserve As Work 6,2048',
      'For I=0 To 1023 : Poke Start(6)+I,65+(I mod 4) : Next I', // "ABCDABCD..."
      'L=Squash(Start(6),1024,-1,4095,0)',
      'Print L<1024;L>0', // compressed and a real win
      'U=Unsquash(Start(6),L)',
      'Print U', // expanded length
      'Print Peek$(Start(6),8)', // "ABCDABCD"
    ].join('\n')
    expect(run(prog)).toBe('-1-1\n 1024\nABCDABCD\n')
  })

  it('returns -1 when compression cannot win', () => {
    const prog = [
      'Reserve As Work 6,64',
      'For I=0 To 15 : Poke Start(6)+I,I*17 : Next I',
      'Print Squash(Start(6),16,-1,4095,0)',
    ].join('\n')
    expect(run(prog)).toBe('-1\n')
  })

  it('FAST uses the pre-scan reach instead of the SPEED limit', () => {
    const prog = [
      'Reserve As Work 6,1400',
      'For I=0 To 699 : Poke Start(6)+I,(I*73+I*I*19) And 255 : Next I',
      'For I=0 To 699 : Poke Start(6)+700+I,Peek(Start(6)+I) : Next I',
      'Print Squash(Start(6),1400,-1,256,0)>0',
    ].join('\n')
    expect(run(prog)).toBe('-1\n')
  })
})
