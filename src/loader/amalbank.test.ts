import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAmosFile } from './amosfile'
import { parseAmalBank } from './amalbank'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from '../runtime/runtime'
import type { MemoryBank } from './amosfile'

const table = new TokenTable(CORE_TOKENS)

/**
 * The bank the Play/Amplay tutorial loads:
 *   Load "AmosPro_Tutorial:Tutorials/Amal/PLay_Data.abk"   (AMAL_5.AMOS)
 * It holds one recorded path, and the empty program table the AMAL accessory
 * writes alongside it.
 */
const PLAY_DATA = join(
  __dirname,
  '..',
  '..',
  'fixtures',
  'official-amos',
  'Tutorial',
  'Tutorials',
  'AMAL',
  'PLay_Data.Abk',
)

function playDataBank(): MemoryBank {
  const bank = parseAmosFile(readFileSync(PLAY_DATA)).banks[0]!
  if (bank.kind !== 'memory') throw new Error('expected a memory bank')
  return bank
}

describe('the AMAL bank (bank 4, "Amal")', () => {
  it('is bank 4 named Amal, which is what makes it the AMAL bank', () => {
    const bank = playDataBank()
    expect(bank.number).toBe(4)
    expect(bank.name).toBe('Amal')
  })

  it('reads the movement table AmPli walks (+W.s:8663)', () => {
    const b = playDataBank()
    const amal = parseAmalBank(b.data)
    // count word at payload+4, then a 1-based word-offset table; this bank
    // has room for 48 recordings but only number 1 was ever made
    expect(amal.movements.length).toBe(49)
    expect(amal.movements.filter(Boolean).length).toBe(1)
    const mv = amal.movements[1]!
    expect(mv.speed).toBe(2)
    // the record's own header says Y sits 273 bytes in; X starts five bytes
    // in, right after the tempo word, the Y-offset word and a 0 byte
    const base = 4 + 289 * 2
    expect(mv.xStart).toBe(base + 5)
    expect(mv.yStart).toBe(base + 273 + 1)
  })

  it('brackets each stream with the zero bytes a backwards replay needs', () => {
    const { data, movements } = parseAmalBank(playDataBank().data)
    const mv = movements[1]!
    expect(data[mv.xStart - 1]).toBe(0)
    expect(data[mv.yStart - 1]).toBe(0)
    const runTo0 = (from: number): number => {
      let i = from
      while (data[i] !== 0) i++
      return i - from
    }
    // X ends one byte before Y's leading terminator: the two streams are
    // packed nose to tail, which is why the Y offset is 5 + len(X) + 1
    expect(runTo0(mv.xStart)).toBe(267)
    expect(mv.xStart + 267 + 1).toBe(mv.yStart - 1)
    expect(runTo0(mv.yStart)).toBe(260)
  })

  it('reads the program-string table through the long at +0', () => {
    const amal = parseAmalBank(playDataBank().data)
    // 64 slots (indices 0..63, the count word says 63), all still empty —
    // this bank was recorded for PLay, not written as Amal source
    expect(amal.programs.length).toBe(64)
    expect(amal.programs.every((p) => p === '')).toBe(true)
  })

  it('drives a real object down the recorded path', () => {
    const rt = new Runtime(
      tokenize(['Channel 0 To Sprite 0', 'Sprite 0,100,50,1', 'Amal 0,"PL 1"', 'Amal On'].join('\n'), table),
      table,
      { maxSteps: 100_000 },
    )
    rt.memBanks.set(4, playDataBank())
    rt.runHeadless(1_000)
    // both streams open with $84 — a four-tick pause — and the tempo is 2,
    // so nothing moves for ten frames and the first step lands on the
    // eleventh: $7f in X (-1, signed on bit 6) and 1 in Y
    for (let i = 0; i < 10; i++) {
      rt.frame()
      expect([rt.hwSprites.get(0)!.x, rt.hwSprites.get(0)!.y]).toEqual([100, 50])
    }
    rt.frame()
    expect([rt.hwSprites.get(0)!.x, rt.hwSprites.get(0)!.y]).toEqual([99, 51])
  })
})
