/**
 * The DigiBooster 1.x format, against the one real module: bank 3 of
 * `DigiBooster_Example.amos`, named "DigiMod" and 127,244 bytes.
 *
 * The arithmetic is what most of these check. A packed pattern says its own
 * length, and 2 + 64 + 4n has to come out exact for all eighteen or the mask
 * layout is wrong; the samples have no offsets at all and chain off the end of
 * the last pattern, so getting either wrong still parses and plays noise.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseAmosFile } from '../loader/amosfile'
import { corpusFile, haveCorpus } from '../cli/corpus'
import {
  DIGI_1X_VERSIONS,
  DIGI_CELL_BYTES,
  DIGI_PATTERNS_AT,
  DIGI_ROWS,
  DIGI_SAMPLES,
  DIGI_UNPACKED_BYTES,
  parseDigi,
} from './digi'

/** sources/kyzer-dme/files/amospro_dme_v2.0/examples/DigiBooster_Example.amos */
const EXAMPLE = '60ff9c70ecebff35aa5e3709a32b4f7bdcae920ac9429c24f7ac5ef308dafb10'

function exampleBank(): Uint8Array | null {
  if (!haveCorpus()) return null
  const path = corpusFile(EXAMPLE)
  if (!path) return null
  const file = parseAmosFile(new Uint8Array(readFileSync(path)))
  const found = file?.banks.find((b) => 'data' in b && (b as { number?: number }).number === 3)
  return found && 'data' in found ? (found.data as Uint8Array) : null
}

describe('the header', () => {
  it('refuses anything without the twenty-byte banner', () => {
    expect(parseDigi(new Uint8Array(0x800))).toBeNull()
    const d = new Uint8Array(0x800)
    for (const [i, c] of [...'DIGI Booster module'].entries()) d[i] = c.charCodeAt(0)
    // still no channel count, and `InitModule` has no arm for zero
    expect(parseDigi(d)).toBeNull()
    d[0x19] = 4
    expect(parseDigi(d)).not.toBeNull()
  })

  it('keeps a finetune only outside 1.0 to 1.3, which is the range the name means', () => {
    const build = (version: number): Uint8Array => {
      const d = new Uint8Array(DIGI_PATTERNS_AT + DIGI_UNPACKED_BYTES)
      for (const [i, c] of [...'DIGI Booster module'].entries()) d[i] = c.charCodeAt(0)
      d[0x18] = version
      d[0x19] = 4
      d[0x243] = 7
      return d
    }
    // $210790 tests exactly four values and clears all 31 bytes at $243
    for (const v of DIGI_1X_VERSIONS) expect(parseDigi(build(v))!.samples[0]!.finetune).toBe(0)
    expect(parseDigi(build(0x14))!.samples[0]!.finetune).toBe(7)
  })
})

const bank = exampleBank()

describe.skipIf(!bank)('bank 3 of DigiBooster_Example.amos', () => {
  const data = bank!
  const song = parseDigi(data)!

  it('is 127,244 bytes of version 1.0, eight channels, packed', () => {
    expect(data.length).toBe(127244)
    expect(song.version).toBe(0x10)
    expect(song.channels).toBe(8)
    expect(song.packed).toBe(true)
    expect(song.patternCount).toBe(18)
    expect(song.songLength).toBe(27)
  })

  it('orders 27 steps over 18 patterns, and names one of them twice running', () => {
    expect(song.order).toHaveLength(27)
    expect(Math.max(...song.order)).toBe(17)
    expect(song.order.slice(0, 4)).toEqual([1, 2, 1, 2])
  })

  it('makes every packed pattern come out to 2 + 64 + 4n exactly', () => {
    // the check that the mask layout is right: one byte a row, one bit a
    // channel, and only the cells whose bit is set
    let at = DIGI_PATTERNS_AT
    for (let p = 0; p < song.patternCount; p++) {
      const bytes = ((data[at]! << 8) | data[at + 1]!) + 2
      expect((bytes - 2 - DIGI_ROWS) % DIGI_CELL_BYTES).toBe(0)
      const cells = (bytes - 2 - DIGI_ROWS) / DIGI_CELL_BYTES
      // and it is the number of set bits across the pattern's 64 masks
      let bits = 0
      for (let r = 0; r < DIGI_ROWS; r++) {
        for (let b = 0; b < 8; b++) if (data[at + 2 + r]! & (1 << b)) bits++
      }
      expect(bits).toBe(cells)
      at += bytes
    }
  })

  it('accounts for every byte: header, patterns, then 31 chained samples', () => {
    let at = DIGI_PATTERNS_AT
    for (let p = 0; p < song.patternCount; p++) at += ((data[at]! << 8) | data[at + 1]!) + 2
    expect(at).toBe(0x26c4)
    const used = song.samples.reduce((a, s) => a + s.length, 0)
    // nine bytes over, which is the bank rounded up rather than sample data
    expect(data.length - (at + used)).toBe(9)
    expect(song.samples.filter((s) => s.length > 0)).toHaveLength(14)
  })

  it('gives every sample a volume inside 0..64 and no finetune, this being 1.0', () => {
    for (const s of song.samples) {
      expect(s.volume).toBeGreaterThanOrEqual(0)
      expect(s.volume).toBeLessThanOrEqual(64)
      expect(s.finetune).toBe(0)
    }
  })

  it('slices each sample to its own length, and the loops stay inside it', () => {
    for (const s of song.samples) {
      expect(s.pcm.length).toBe(s.length)
      if (s.repeatLength > 0) expect(s.repeatStart + s.repeatLength).toBeLessThanOrEqual(s.length)
    }
  })

  it('reads the first row as a ProTracker cell: period 214, sample 2, F04', () => {
    // `00 d6 2f 04` --- the packing is `sample_hi period_hi | period_lo |
    // sample_lo effect | param`, unchanged from ProTracker
    const row = song.patterns[1]![0]!
    expect(row[0]).toEqual({ period: 214, sample: 2, effect: 0xf, param: 4 })
    // and channel 0 is bit 7 of the mask, so a mask of $88 fills 0 and 4
    expect(row[4]).toEqual({ period: 214, sample: 2, effect: 0xc, param: 0x20 })
    for (const c of [1, 2, 3, 5, 6, 7]) expect(row[c]!.period).toBe(0)
  })

  it('names 64 rows of eight in every pattern, packed or not', () => {
    expect(song.patterns).toHaveLength(song.patternCount)
    for (const p of song.patterns) {
      expect(p).toHaveLength(DIGI_ROWS)
      for (const r of p) expect(r).toHaveLength(song.channels)
    }
  })

  it('never names a sample outside the 31 the header has room for', () => {
    for (const p of song.patterns) {
      for (const r of p) for (const c of r) expect(c.sample).toBeLessThanOrEqual(DIGI_SAMPLES)
    }
  })
})
