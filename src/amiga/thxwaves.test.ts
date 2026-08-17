/**
 * The waveform bank, against the library that generates the same one.
 *
 * The check that carries this file is the filter start values. `thxwaves.ts`
 * transcribes ninety instructions of generator and twenty of filter, and the
 * only reason to believe any of it is that the 1,395 words the library ships
 * at $1738 and $221e all fall out of it. Sizes agree by construction; those do
 * not.
 *
 * Skipped when the fixtures are absent — `fixtures/` is gitignored and neither
 * library is redistributed.
 */
import { describe, expect, it } from 'vitest'
import { describeIf } from '../testing/fixture'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  THX_BANK_BYTES,
  THX_FILTER_COUNT,
  THX_NOISE_BYTES,
  THX_OFF_NOISE,
  THX_OFF_SAWTOOTHS,
  THX_OFF_SQUARES,
  THX_SET_BYTES,
  THX_SINE_SEEDS,
  THX_SQUARE_COUNT,
  thxFilterBank,
  thxFilterCoefficient,
  thxFilterStartWords,
  thxGroups,
  thxSine,
  thxWaveSet,
} from './thxwaves'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const jotrePath = join(root, 'fixtures', 'extensions', 'jotre-1.0', 'AMOSPro_Jotre.Lib')
const thxPath = join(root, 'fixtures', 'extensions', 'thx-0.6', 'AMOSPRO_THX.lib')
const haveJotre = existsSync(jotrePath)

/** the one code hunk, at file offset 32 */
const image = (path: string): Uint8Array => new Uint8Array(readFileSync(path)).subarray(32)
const word = (b: Uint8Array, at: number): number => {
  const v = (b[at]! << 8) | b[at + 1]!
  return v >= 0x8000 ? v - 0x10000 : v
}

describe('the THX waveform set', () => {
  const set = thxWaveSet()

  it('is 6,520 bytes, which is the allocation and the cache file both', () => {
    expect(set.length).toBe(THX_SET_BYTES)
    // `move.l #$64488,d3` --- what InitPlayer reads from S:thxWaves
    expect(THX_BANK_BYTES).toBe(0x64488)
    // `move.l #$649f0,d0` --- the AllocMem, which is $568 of state and the bank
    expect(0x568 + THX_BANK_BYTES).toBe(0x649f0)
    expect(THX_BANK_BYTES).toBe(63 * THX_SET_BYTES)
  })

  it('lays the four families out where the pointer stores say', () => {
    // `lea $31af0(a6,d7.w),a0 / move.l a0,$556(a6)` and its two neighbours,
    // against the base of $31af0
    expect(THX_OFF_SAWTOOTHS).toBe(0x31bec - 0x31af0)
    expect(THX_OFF_SQUARES).toBe(0x31ce8 - 0x31af0)
    expect(THX_OFF_NOISE).toBe(0x32ce8 - 0x31af0)
    expect(THX_SET_BYTES).toBe(0x33468 - 0x31af0)
  })

  it('builds triangles that peak and trough where a triangle should', () => {
    // the 8-byte one, second in the set: up to $7f, down through 0 to $80
    expect(Array.from(set.subarray(4, 12))).toEqual([0, 64, 127, 64, 0, -64, -128, -64])
    // and the 4-byte one before it
    expect(Array.from(set.subarray(0, 4))).toEqual([0, 127, 0, -128])
  })

  it('builds sawtooths that climb once across their length', () => {
    const saw8 = Array.from(set.subarray(THX_OFF_SAWTOOTHS + 4, THX_OFF_SAWTOOTHS + 12))
    expect(saw8[0]).toBe(-128)
    for (let i = 1; i < 8; i++) expect(saw8[i]!).toBeGreaterThan(saw8[i - 1]!)
    // `floor(255 / (n-1))` is 36 for n=8, so it stops short of 127
    expect(saw8[7]).toBe(-128 + 7 * 36)
  })

  it('builds thirty-two pulse widths, all 128 bytes, duty 1/64 up to 1/2', () => {
    for (let w = 1; w <= THX_SQUARE_COUNT; w++) {
      const at = THX_OFF_SQUARES + (w - 1) * 128
      const high = Array.from(set.subarray(at, at + 128)).filter((v) => v === 0x7f).length
      expect(high).toBe(w * 2)
    }
    // the last is a true square and the first is a very thin spike
    expect(Array.from(set.subarray(THX_OFF_SQUARES + 31 * 128, THX_OFF_SQUARES + 31 * 128 + 128))
      .filter((v) => v === 0x7f).length).toBe(64)
  })

  it('builds noise that is about half hard rails, which is the bit-8 branch', () => {
    const n = Array.from(set.subarray(THX_OFF_NOISE, THX_OFF_NOISE + THX_NOISE_BYTES))
    expect(n.length).toBe(THX_NOISE_BYTES)
    const rails = n.filter((v) => v === 0x7f || v === -128).length
    // `btst #$8,d0` fires about half the time and saturates when it does
    expect(rails).toBeGreaterThan(THX_NOISE_BYTES * 0.4)
    expect(rails).toBeLessThan(THX_NOISE_BYTES * 0.6)
    // and it is deterministic, so a second call is the same table
    expect(Array.from(thxWaveSet().subarray(THX_OFF_NOISE))).toEqual(n)
  })

  it('sums to the group table the filter walks it with', () => {
    const groups = thxGroups()
    expect(groups.length).toBe(45)
    expect(groups.reduce((a, b) => a + b, 0)).toBe(THX_SET_BYTES)
  })
})

describeIf('against the shipped Jotre library', haveJotre, () => {
  const jotre = image(jotrePath)

  it('walks the set in the 45 group lengths at $3c2', () => {
    // stored minus one, for the `dbra`
    const shipped = Array.from({ length: 45 }, (_, i) => word(jotre, 0x3c2 + i * 2) + 1)
    expect(thxGroups()).toEqual(shipped)
  })

  /**
   * The one that matters. 1,395 filter start values, each a 16-bit word out of
   * somebody else's binary, all reproduced by running the filter three times
   * from zero — which is only possible if the generator, the filter and the
   * group walk are all right together.
   */
  it('reproduces every one of the 1,395 filter start pairs at $1738 and $221e', () => {
    const set = thxWaveSet()
    const groups = thxGroups()
    const wrong: string[] = []
    for (let f = 0; f < THX_FILTER_COUNT; f++) {
      const coeff = thxFilterCoefficient(f)
      let at = 0
      for (let g = 0; g < groups.length; g++) {
        const [a, b] = thxFilterStartWords(set, at, groups[g]!, coeff)
        const wantA = word(jotre, 0x1738 + (f * 45 + g) * 2)
        const wantB = word(jotre, 0x221e + (f * 45 + g) * 2)
        if (a !== wantA || b !== wantB) wrong.push(`filter ${f} group ${g}: ${a},${b} not ${wantA},${wantB}`)
        at += groups[g]!
      }
    }
    expect(wrong.slice(0, 5)).toEqual([])
    // and the two tables really are $ae6 apart, 1395 words each
    expect(0x221e - 0x1738).toBe(0xae6)
    expect(1395 * 2).toBe(0xae6)
  })

  it('takes its coefficients from 25 up in nines', () => {
    // `move.l #$19,d5` and `addi.l #$9,d5`, thirty-one times
    expect(thxFilterCoefficient(0)).toBe(0x19)
    expect(thxFilterCoefficient(THX_FILTER_COUNT - 1)).toBe(25 + 30 * 9)
    // `cmpi.w #$1f,$566(a6) / blt`
    expect(THX_FILTER_COUNT).toBe(0x1f)
  })

  it('carries the seventeen sine seeds at $1716', () => {
    const shipped = Array.from({ length: 17 }, (_, i) => word(jotre, 0x1716 + i * 2))
    expect(THX_SINE_SEEDS).toEqual(shipped)
  })
})

describe.skipIf(!existsSync(thxPath))('the sine seeds are in thx-0.6 too', () => {
  it('at $fae, the same seventeen words', () => {
    const t = image(thxPath)
    expect(Array.from({ length: 17 }, (_, i) => word(t, 0xfae + i * 2))).toEqual(THX_SINE_SEEDS)
  })
})

describe('the sine table', () => {
  it('is 64 words: a half period, then its negative', () => {
    const s = thxSine()
    expect(s.length).toBe(64)
    expect(s[0]).toBe(0)
    expect(s[16]).toBe(255)
    // the second half is `neg.w (a1)+` over the first
    // `|| 0` because negating the zero at index 0 gives -0, which Object.is
    // separates from 0 and nothing else here cares about
    for (let i = 0; i < 32; i++) expect(s[32 + i]).toBe(-s[i]! || 0)
  })

  it('is symmetric about its peak, which is what the backward walk builds', () => {
    const s = thxSine()
    for (let i = 1; i < 16; i++) expect(s[16 + i]).toBe(s[16 - i])
  })
})

describe('the filter bank', () => {
  it('is 63 sets with the dry one in the middle', () => {
    const bank = thxFilterBank()
    expect(bank.length).toBe(THX_BANK_BYTES)
    const dry = THX_FILTER_COUNT * THX_SET_BYTES
    const set = thxWaveSet()
    expect(Array.from(bank.subarray(dry, dry + 32))).toEqual(
      Array.from(new Uint8Array(set.buffer, set.byteOffset, 32)),
    )
  })

  it('darkens toward set 0 and brightens toward set 62', () => {
    const bank = thxFilterBank()
    const dry = THX_FILTER_COUNT * THX_SET_BYTES
    // measured on the noise table, which is the only broadband thing in the set
    const step = (base: number): number => {
      let sum = 0
      for (let i = 1; i < THX_NOISE_BYTES; i++) {
        const a = (bank[base + THX_OFF_NOISE + i]! << 24) >> 24
        const b = (bank[base + THX_OFF_NOISE + i - 1]! << 24) >> 24
        sum += Math.abs(a - b)
      }
      return Math.round(sum / THX_NOISE_BYTES)
    }
    // the low-pass end: cutoff rises with the index, so 0 is the darkest
    const low = [0, 5, 15, 30].map((f) => step(f * THX_SET_BYTES))
    expect(low).toEqual([2, 9, 30, 71])
    for (let i = 1; i < low.length; i++) expect(low[i]!).toBeGreaterThan(low[i - 1]!)
    expect(step(dry)).toBe(116)
    // the high-pass end runs the other way and never goes quiet
    const high = [0, 5, 15, 30].map((f) => step(dry + THX_SET_BYTES + f * THX_SET_BYTES))
    expect(high).toEqual([108, 108, 117, 148])
  })
})
