import { describe, expect, it } from 'vitest'
import { explode, explodeChecked, implode, isImploded, TAIL_BYTES, turboImplode } from './imploder'

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

/**
 * The compressor, ported from `xpkIMPL.library` 0.18.
 *
 * Its output is checked two ways. `explode` above reads it back, and that is
 * the weak check: both halves are in this file and could be wrong together.
 * The strong one is in ../amiga/xpkmaster.test.ts, where `ancient` decodes
 * IMPL streams this encoder wrote without having read any of it.
 */
describe('turboImplode', () => {
  const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)
  const noise = (n: number, seed = 1): Uint8Array => {
    let x = seed >>> 0
    return Uint8Array.from({ length: n }, () => {
      x ^= x << 13
      x >>>= 0
      x ^= x >>> 17
      x ^= x << 5
      x >>>= 0
      return (x >>> 16) & 0xff
    })
  }

  const cases: Array<[string, Uint8Array]> = [
    ['a short repeat, under the hash threshold', ascii('AMOS Professional '.repeat(40))],
    ['the same repeat, over it', ascii('AMOS Professional '.repeat(400))],
    ['English, whose matches are short and scattered', ascii(
      'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium ' +
        'doloremque laudantium, totam rem aperiam eaque ipsa quae ab illo inventore. '.repeat(50),
    )],
    ['a run longer than any code can hold', new Uint8Array(70_000).fill(0x5a)],
    ['a period wider than the smallest window', bytes(9000, (i) => (i % 300) & 0x7f)],
    ['compressible then not', Uint8Array.from([...ascii('AMOS '.repeat(2000)), ...noise(6000)])],
    ['not compressible then very', Uint8Array.from([...noise(6000), ...new Uint8Array(9000)])],
  ]

  for (const [name, data] of cases) {
    it(name, () => {
      for (let eff = 0; eff < 12; eff++) {
        const packed = turboImplode(data, eff)
        if (packed === null) continue
        expect(isImploded(packed), `effort ${eff}`).toBe(true)
        expect(packed.length, `effort ${eff}`).toBeLessThan(data.length)
        expect([...explodeChecked(packed)], `effort ${eff}`).toEqual([...data])
      }
    })
  }

  it('every length from 64 to 400 either packs and reads back, or refuses', () => {
    for (let n = 64; n <= 400; n++) {
      const data = bytes(n, (i) => (i * 31 + n) & 0x0f)
      const packed = turboImplode(data, 5)
      if (packed === null) continue
      expect([...explodeChecked(packed)], `length ${n}`).toEqual([...data])
    }
  })

  it('takes an effort outside 0..11 as zero, the way $a58 does', () => {
    const body = ascii('Turbo Implode '.repeat(500))
    const zero = turboImplode(body, 0)!
    for (const eff of [12, 99, -1, 1000]) {
      expect([...turboImplode(body, eff)!], `effort ${eff}`).toEqual([...zero])
    }
  })

  it('picks a wider window for a bigger effort, and it shows in the ratio', () => {
    // the repeat is 150 bytes, well past effort 0's 129-byte window, so the
    // smallest setting cannot see it at all and the next one up can
    const body = ascii(('Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium ' +
      'doloremque laudantium, totam rem aperiam eaque ipsa quae ab illo inventore. ').repeat(120))
    expect(turboImplode(body, 0)!.length).toBeGreaterThan(body.length / 2)
    expect(turboImplode(body, 1)!.length).toBeLessThan(body.length / 40)
  })

  it('explodeChecked catches a stream that describes more than it declares', () => {
    // IMPL $dd8 tests that the read pointer landed on byte zero. AMCAF's
    // decruncher does not, so `explode` is left alone and this is a second
    // door: shorten the declared length and the codes now describe more
    // output than the header asks for, the writer stops early, and the
    // reader is left holding bytes nobody wanted.
    const body = ascii('The quick brown fox jumps over the lazy dog. '.repeat(200))
    const packed = turboImplode(body, 4)!
    const short = Uint8Array.from(packed)
    new DataView(short.buffer).setUint32(4, body.length - 500)
    expect(explode(short).length).toBe(body.length - 500)
    expect(() => explodeChecked(short)).toThrow(/ended at 3, not 0/)
  })

  it('but neither of them is a checksum, and the test says which', () => {
    // Over 140 single-byte flips in the crunched stream, `explode` throws on
    // 66 and returns wrong data on 74. The end test adds nothing to that: a
    // corrupted parse runs OUT of stream, which `explode` already refuses,
    // rather than finishing with stream to spare. The number is here so that
    // nobody reads the check above as protection it does not give.
    const body = ascii('The quick brown fox jumps over the lazy dog. '.repeat(200))
    const packed = turboImplode(body, 4)!
    const survives = (f: (b: Uint8Array) => Uint8Array): number => {
      let n = 0
      for (let i = 12; i < 152; i++) {
        const bent = Uint8Array.from(packed)
        bent[i] = bent[i]! ^ 0xff
        try {
          f(bent)
          n++
        } catch {
          // a throw is the wanted answer here
        }
      }
      return n
    }
    expect(survives(explode)).toBe(74)
    expect(survives(explodeChecked)).toBe(74)
  })
})
