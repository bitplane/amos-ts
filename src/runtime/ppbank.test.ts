/**
 * The AMOS side of PowerPacker: the PPbk bank container (+CompExt.s) and the
 * Ppload/Ppsave keywords that read and write it. The CODEC is
 * ../amiga/powerpacker.ts and is tested there, against two independent
 * reference decoders and a genuine PowerPacker-crunched file.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { EXTENSION_TOKENS } from '../ext/registry'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'
import { parsePpBank, writePpBank } from './ppbank'

/** a deterministic pseudo-random source, so a failure is reproducible */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s
  }
}

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
    mustFinish(r)
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
