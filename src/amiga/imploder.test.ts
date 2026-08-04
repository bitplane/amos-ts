import { describe, expect, it } from 'vitest'
import { explode, implode, isImploded, TAIL_BYTES } from './imploder'

/**
 * The exploder was checked against the twenty real `IMP!` files in the local
 * corpus — every one decrunched to its declared length, with `mod.hawkeye`
 * opening "hawkeye" and carrying "M.K." at 1080, `IntroAnim1.dat` opening
 * "FORM" and `AMCAFAdvert.Abk` opening "AmBs". None of that can live here:
 * the corpus is not in the repo and is not ours to redistribute. What is
 * testable in-tree is that we agree with ourselves.
 */
const bytes = (n: number, f: (i: number) => number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => f(i) & 0xff)

describe('Imploder round trips', () => {
  const cases: Array<[string, Uint8Array]> = [
    ['exactly the twelve-byte floor', bytes(12, (i) => i * 17)],
    ['thirteen, one past it', bytes(13, (i) => i * 17)],
    ['a kilobyte of counting', bytes(1024, (i) => i)],
    ['highly repetitive', bytes(4096, (i) => (i >> 5) & 3)],
    ['all one byte', new Uint8Array(2000).fill(0xa7)],
    ['all zero', new Uint8Array(777)],
    ['a plausible pseudo-random spread', bytes(5000, (i) => (i * 2654435761) >>> 13)],
  ]

  for (const [name, data] of cases) {
    it(name, () => {
      const packed = implode(data)
      expect(isImploded(packed)).toBe(true)
      expect(packed.length).toBe(data.length + TAIL_BYTES)
      expect([...explode(packed)]).toEqual([...data])
    })
  }

  it('every length from 12 to 200 survives', () => {
    for (let n = 12; n <= 200; n++) {
      const data = bytes(n, (i) => i * 31 + n)
      expect([...explode(implode(data))], `length ${n}`).toEqual([...data])
    }
  })

  it('refuses fewer than twelve bytes, which cannot carry a header', () => {
    expect(() => implode(new Uint8Array(11))).toThrow(/at least 12/)
  })

  it('rejects anything that is not IMP!', () => {
    expect(isImploded(new Uint8Array([0x50, 0x50, 0x32, 0x30]))).toBe(false)
    expect(() => explode(new Uint8Array([0x50, 0x50, 0x32, 0x30, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow(/not an IMP!/)
  })

  it('rejects a header pointing outside the file', () => {
    const bad = implode(bytes(64, (i) => i))
    new DataView(bad.buffer).setUint32(8, 0xffff)
    expect(() => explode(bad)).toThrow(/out of range/)
  })
})
