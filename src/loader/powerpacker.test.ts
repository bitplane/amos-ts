import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS, EXTENSION_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from '../runtime/runtime'
import { AmigaFS } from '../runtime/vfs'
import { pp20Crunch, pp20Decrunch, parsePpBank, writePpBank } from './powerpacker'

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s
  }
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

describe('AMOS "PPbk" bank wrapper (+CompExt.s:686-767)', () => {
  it('wraps and unwraps a bank with its number and flags', () => {
    const rnd = lcg(11)
    const data = new Uint8Array(1024)
    for (let i = 0; i < data.length; i++) data[i] = i % 7 === 0 ? rnd() & 0xff : 0x20
    const file = writePpBank({ number: 6, flags: 0x0004, data })
    expect(String.fromCharCode(file[0]!, file[1]!, file[2]!, file[3]!)).toBe('PPbk')
    const back = parsePpBank(file)
    expect(back.number).toBe(6)
    expect(back.flags).toBe(0x0004)
    expect(Array.from(back.data)).toEqual(Array.from(data))
  })
})

describe('Ppsave / Ppload keywords (+CompExt.s)', () => {
  const table = new TokenTable(CORE_TOKENS)
  const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)]))
  function run(src: string): string {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    let out = ''
    const rt = new Runtime(tokenize(src, table, extensions), table, { extensions, fs, maxSteps: 300_000, onText: (t) => (out += t) })
    const r = rt.runHeadless(1_000)
    if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
    return out
  }

  it('crunches a bank to disc and loads it back byte-identical', () => {
    const prog = [
      'Reserve As Data 6,1024',
      'For I=0 To 1023 : Poke Start(6)+I,65+(I mod 4) : Next I', // "ABCDABCD..."
      'Ppsave "DH0:bank.pp",6',
      'Reserve As Data 6,1024', // wipe it
      'Ppload "DH0:bank.pp",7', // load to a new bank number
      'Print Peek$(Start(7),8);Length(7)',
    ].join('\n')
    expect(run(prog)).toBe('ABCDABCD 1024\n')
  })
})
