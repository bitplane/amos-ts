/**
 * The reconstruction, checked against the thing it reconstructs.
 *
 * The shape tests run anywhere. The one that matters needs
 * `fixtures/libs/dme/DME_FC1.3.library`, which is gitignored like every other
 * third-party binary here, so it skips when the library is absent — and says
 * so rather than passing quietly.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { loadHunks } from './hunk'
import { FC13_APPROXIMATED, FC13_WAVES, fc13Waves } from './fc13waves'

const LIB = 'fixtures/libs/dme/DME_FC1.3.library'

/** the 47 as the library holds them: offsets and lengths out of its own table */
function libraryWaves(): number[][] | null {
  if (!existsSync(LIB)) return null
  const l = loadHunks(new Uint8Array(readFileSync(LIB)))
  const at = (a: number): number => a - l.base
  const rd32 = (a: number): number =>
    ((l.image[at(a)]! << 24) | (l.image[at(a) + 1]! << 16) | (l.image[at(a) + 2]! << 8) | l.image[at(a) + 3]!) | 0
  const rd16 = (a: number): number => (l.image[at(a)]! << 8) | l.image[at(a) + 1]!
  const out: number[][] = []
  // entries 0-9 are the module's own samples; the built-in 47 follow
  for (let i = 10; i < 10 + FC13_WAVES; i++) {
    const e = 0x210fc6 + i * 10
    const off = rd32(e)
    const bytes = rd16(e + 4) * 2
    const w: number[] = []
    for (let k = 0; k < bytes; k++) w.push((l.image[at(0x211200 + off + k)]! << 24) >> 24)
    out.push(w)
  }
  return out
}

describe('the generated waveform set', () => {
  const g = fc13Waves()

  it('is 47, which is the count a module indexes into', () => {
    expect(g).toHaveLength(FC13_WAVES)
  })

  it('has the lengths the format fixes: sixteen, thirty-two and one of forty-eight', () => {
    const lengths = g.map((w) => w.length)
    expect(lengths.slice(0, 32).every((n) => n === 32)).toBe(true)
    expect(lengths.slice(32, 40).every((n) => n === 16)).toBe(true)
    expect(lengths.slice(40, 46)).toEqual([32, 16, 32, 32, 16, 16])
    expect(lengths[46]).toBe(48)
  })

  it('opens every one of them on a doubled sample, which is the relatch guard', () => {
    for (const [i, w] of g.entries()) expect([i, w[0]]).toEqual([i, w[1]])
  })

  it('makes 38 and 39 identical, and 44 and 45, out of one rule rather than two', () => {
    // the generated widths are 2 and 1, and 1 becomes 2 once the guard lands
    expect([...g[38]!]).toEqual([...g[39]!])
    expect([...g[44]!]).toEqual([...g[45]!])
  })

  it('lays 46 out as 40 and then 41', () => {
    expect([...g[46]!]).toEqual([...g[40]!, ...g[41]!])
  })

  it('stays inside a signed byte everywhere', () => {
    for (const w of g) {
      expect(Math.min(...w)).toBeGreaterThanOrEqual(-128)
      expect(Math.max(...w)).toBeLessThanOrEqual(127)
    }
  })
})

const lib = libraryWaves()

describe.skipIf(!lib)('against DME_FC1.3.library itself', () => {
  const g = fc13Waves()

  it('agrees on every length', () => {
    expect(g.map((w) => w.length)).toEqual(lib!.map((w) => w.length))
  })

  it('reproduces 45 of the 47 byte for byte', () => {
    const exact: number[] = []
    const off: number[] = []
    for (let i = 0; i < FC13_WAVES; i++) ([...g[i]!].join() === lib![i]!.join() ? exact : off).push(i)
    expect(off).toEqual([...FC13_APPROXIMATED])
    expect(exact).toHaveLength(45)
  })

  it('keeps the two approximations to the same span and the same attack', () => {
    // they are this port's shape, so the claim is about contour rather than bytes
    for (const i of FC13_APPROXIMATED) {
      const a = [...g[i]!]
      const b = lib![i]!
      expect(a.slice(0, 4)).toEqual(b.slice(0, 4))
      expect(Math.max(...a)).toBe(Math.max(...b))
      expect(a[a.length - 1]).toBe(b[b.length - 1])
      // and both fall the whole way after the attack, which is the family
      expect(a.slice(3).every((v, k, s) => k === 0 || s[k - 1]! >= v)).toBe(true)
    }
  })
})

describe.skipIf(lib !== null)('without the library', () => {
  it('says the byte-exactness check did not run', () => {
    expect(existsSync(LIB)).toBe(false)
  })
})
