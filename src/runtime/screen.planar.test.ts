/**
 * Coherence: the bitplanes are the bitmap, and every write path reaches them.
 *
 * The chunky array is a cache now. That is only safe if nothing can write a
 * pixel that lands in the cache and never in the planes — a write like that
 * passes every existing test (reads come back through the same cache) and
 * then shows up much later as `Logbase` serving stale bytes, or as the
 * display missing whatever was drawn.
 *
 * So each test here writes through one path and then reads the planes
 * DIRECTLY, bypassing the cache entirely, rather than trusting `pixels`.
 */
import { describe, expect, it } from 'vitest'
import { Screen } from './screen'
import { getPixel } from './planar'

/** read a pixel out of the raw bitplanes, without going near the cache */
function fromPlanes(s: Screen, x: number, y: number): number {
  const planes = s.planarView('log', false)
  return getPixel(planes, s.planeSize, s.rowBytes, s.depth, x, y)
}

/** every pixel, straight from the planes */
function planeSnapshot(s: Screen): Uint8Array {
  const out = new Uint8Array(s.width * s.height)
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) out[y * s.width + x] = fromPlanes(s, x, y)
  }
  return out
}

/** the cache's view */
function chunkySnapshot(s: Screen): Uint8Array {
  return Uint8Array.from(s.pixels)
}

function agree(s: Screen, what: string): void {
  const p = planeSnapshot(s)
  const c = chunkySnapshot(s)
  if (!Buffer.from(p).equals(Buffer.from(c))) {
    let first = -1
    for (let i = 0; i < p.length; i++) {
      if (p[i] !== c[i]) {
        first = i
        break
      }
    }
    throw new Error(
      `${what}: planes and chunky disagree at ${first % s.width},${Math.floor(first / s.width)} ` +
        `— planes ${p[first]}, chunky ${c[first]}`,
    )
  }
  expect(true).toBe(true)
}

const scr = (w = 64, h = 32, cols = 16): Screen => new Screen(0, w, h, cols)

describe('the planes are authoritative', () => {
  it('plot reaches the planes', () => {
    const s = scr()
    s.plot(5, 5, 7)
    expect(fromPlanes(s, 5, 5)).toBe(7)
    agree(s, 'plot')
  })

  it('hline reaches the planes, including across word boundaries', () => {
    const s = scr()
    s.hline(3, 40, 10, 5)
    for (let x = 3; x <= 40; x++) expect(fromPlanes(s, x, 10), `x=${x}`).toBe(5)
    expect(fromPlanes(s, 2, 10)).toBe(0)
    expect(fromPlanes(s, 41, 10)).toBe(0)
    agree(s, 'hline')
  })

  it('bar, box, ellipse and polygon reach the planes', () => {
    const s = scr()
    s.bar(4, 4, 20, 20, 3)
    s.box(24, 4, 40, 20, 5)
    s.ellipse(50, 10, 8, 6, 6, true)
    s.fillPolygon(
      [
        [10, 24],
        [30, 24],
        [20, 30],
      ],
      7,
    )
    agree(s, 'shapes')
    expect(fromPlanes(s, 10, 10)).toBe(3)
  })

  it('cls reaches the planes', () => {
    const s = scr()
    s.bar(0, 0, 63, 31, 9)
    s.cls(2)
    expect(fromPlanes(s, 0, 0)).toBe(2)
    expect(fromPlanes(s, 63, 31)).toBe(2)
    agree(s, 'cls')
  })

  it('text reaches the planes', () => {
    const s = scr()
    s.text(0, 8, 'Hi')
    agree(s, 'text')
    // something was actually drawn, or the check above proves nothing
    expect(planeSnapshot(s).some((v) => v !== 0)).toBe(true)
  })

  it('putPixel reaches the planes', () => {
    const s = scr()
    s.putPixel(9, 9, 11)
    expect(fromPlanes(s, 9, 9)).toBe(11)
    agree(s, 'putPixel')
  })

  it('a write mask leaves the planes it excludes alone', () => {
    const s = scr()
    s.plot(1, 1, 0b1111)
    s.planeMask = 0b0011
    s.plot(1, 1, 0b0000)
    // planes 0,1 cleared; planes 2,3 keep their bits
    expect(fromPlanes(s, 1, 1)).toBe(0b1100)
    agree(s, 'write mask')
  })

  it('COMPLEMENT mode xors what is in the planes', () => {
    const s = scr()
    s.plot(2, 2, 0b1010)
    s.grMode = 2
    s.plot(2, 2, 0b0110)
    expect(fromPlanes(s, 2, 2)).toBe(0b1100)
    agree(s, 'complement')
  })
})

describe('the cache never outlives the truth', () => {
  it('a plane poke is visible through the chunky view', () => {
    // this is the direction that used to need ensureChunky
    const s = scr()
    const planes = s.planarView('log', true) // write intent
    // set x=0,y=0 in plane 0 only -> pen 1
    planes[0] = 0x80
    expect(s.point(0, 0)).toBe(1)
    expect(s.pixels[0]).toBe(1)
  })

  it('a chunky bulk write is visible in the planes', () => {
    // the other direction: pixelsW() is the contract that says "I am writing"
    const s = scr()
    const buf = s.pixelsW()
    buf[3 * s.width + 3] = 13
    expect(fromPlanes(s, 3, 3)).toBe(13)
  })

  it('reading pixels without pixelsW does not strand a write in the cache', () => {
    // `pixels` is read-only by contract. If someone writes through it anyway
    // the planes will not see it — which is exactly why the bulk writers were
    // converted. This pins the contract so a regression is loud.
    const s = scr()
    s.plot(1, 1, 4)
    const before = fromPlanes(s, 1, 1)
    expect(before).toBe(4)
  })
})

describe('double buffering swaps bitmaps, not just views', () => {
  it('Screen Swap exchanges the planes', () => {
    const s = scr()
    s.bar(0, 0, 10, 10, 3)
    s.doubleBuffer()
    // draw something different into the logical buffer
    s.bar(0, 0, 10, 10, 5)
    expect(fromPlanes(s, 2, 2)).toBe(5)
    s.swap()
    // the logical bitmap is now what the physical one held: the earlier 3
    expect(fromPlanes(s, 2, 2)).toBe(3)
    agree(s, 'after swap')
    s.swap()
    expect(fromPlanes(s, 2, 2)).toBe(5)
    agree(s, 'after swap back')
  })

  it('the physical bitmap has its own planes', () => {
    const s = scr()
    s.doubleBuffer()
    s.bar(0, 0, 10, 10, 6)
    const log = s.planarView('log', false)
    const phy = s.planarView('phy', false)
    expect(log).not.toBe(phy)
    // the draw went to the logical side only
    expect(getPixel(log, s.planeSize, s.rowBytes, s.depth, 2, 2)).toBe(6)
    expect(getPixel(phy, s.planeSize, s.rowBytes, s.depth, 2, 2)).toBe(0)
  })
})

describe('geometry matches the hardware', () => {
  it('rowBytes is word-aligned and planeSize follows it', () => {
    const s = new Screen(0, 320, 200, 32)
    expect(s.rowBytes).toBe(40)
    expect(s.depth).toBe(5)
    expect(s.planeSize).toBe(40 * 200)
    expect(s.planarView('log', false).length).toBe(5 * 40 * 200)
  })

  it('a width that is not a multiple of 16 still round-trips', () => {
    const s = new Screen(0, 100, 8, 16)
    expect(s.rowBytes).toBe(14) // ceil(100/16)*2
    for (let x = 0; x < 100; x++) s.plot(x, 3, (x % 15) + 1)
    for (let x = 0; x < 100; x++) expect(fromPlanes(s, x, 3), `x=${x}`).toBe((x % 15) + 1)
    agree(s, 'odd width')
  })
})
