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
import { tokenize } from '../tokens/source'
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
    // flag bit 2 is Bnk_BitBob, and an object bank carries no name
    expect(back.name).toBeUndefined()
  })

  it('carries a memory bank\'s name in the PAYLOAD, where +CompExt.s puts it', () => {
    const data = Uint8Array.from([1, 2, 3, 4])
    const file = writePpBank({ number: 6, flags: 0x0001, name: 'Data', data })
    const back = parsePpBank(file)
    expect(back.name).toBe('Data')
    expect(Array.from(back.data)).toEqual([1, 2, 3, 4])
    // the header's length field counts the name too: it is B_Length's answer,
    // which for a memory bank is the node length less eight
    expect(new DataView(file.buffer).getUint32(8)).toBe(4 + 8)
  })
})

describe('Ppsave / Ppload keywords (+CompExt.s)', () => {
  const table = new TokenTable(CORE_TOKENS)
  const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs, true)]))
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

  it('a POSITIVE number appends to the object bank, and no number overwrites', () => {
    /*
     * `tst.l d5 / ble .Over` then `Bnk.GetBobs / beq .Over / moveq #1,d0 ...
     * add.w d5,d1` (+CompExt.s:551-560). The argument is not a bank number
     * for a bob or icon bank at all: any positive value means append.
     */
    // one 16x2 one-plane image, then the 32 palette words
    const body = new Uint8Array(2 + 10 + 4 + 64)
    const dv = new DataView(body.buffer)
    dv.setUint16(0, 1) // count
    dv.setUint16(2, 1) // width in words
    dv.setUint16(4, 2) // height
    dv.setUint16(6, 1) // depth
    const file = writePpBank({ number: 1, flags: 0x0004, data: body }) // Bnk_BitBob
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    fs.writeFile('DH0:logo.pp', file)
    const boot = ['Screen Open 0,320,200,2,0', 'Get Bob 1,0,0 To 8,8', 'Get Bob 2,0,0 To 8,8']
    const load = (src: string): Runtime => {
      const rt = new Runtime(tokenize([...boot, src].join('\n'), table, extensions), table, { extensions, fs, maxSteps: 300_000 })
      mustFinish(rt.runHeadless(1_000))
      return rt
    }
    expect(load('Ppload "DH0:logo.pp",1').spriteBank!.images.length).toBe(3)
    expect(load('Ppload "DH0:logo.pp"').spriteBank!.images.length).toBe(1)
  })

  it('and the name rides along, because Ppload never sets one', () => {
    // ppBnk_Load pokes the number and the flags into the node and stops
    // (+CompExt.s:539-548). Every other byte of the header, the name
    // included, came out of the cruncher.
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    const rt = new Runtime(
      tokenize(['Reserve As Data 6,64', 'Ppsave "DH0:b.pp",6', 'Ppload "DH0:b.pp",7'].join('\n'), table, extensions),
      table,
      { extensions, fs, maxSteps: 300_000 },
    )
    mustFinish(rt.runHeadless(1_000))
    expect(rt.memBanks.get(7)!.name).toBe(rt.memBanks.get(6)!.name)
    expect(rt.memBanks.get(7)!.name.trimEnd()).toBe('Data')
  })
})
