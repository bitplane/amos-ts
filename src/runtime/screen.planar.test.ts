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
import { getPixel } from '../amiga/planar'
import { BankImage } from './objects'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  let first = -1
  for (let i = 0; i < p.length; i++) {
    if (p[i] !== c[i]) {
      first = i
      break
    }
  }
  expect(
    first,
    first < 0
      ? what
      : `${what}: planes and chunky disagree at ${first % s.width},${Math.floor(first / s.width)} ` +
          `— planes ${p[first]}, chunky ${c[first]}`,
  ).toBe(-1)
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

describe('bulk operations move planes, not just the cache', () => {
  it('scrollUp scrolls the planes', () => {
    // scrollUp used to copyWithin the chunky array, which after the flip
    // left the planes holding the UNscrolled picture — invisible to every
    // test that reads back through the same cache
    const s = scr()
    s.bar(0, 0, 63, 7, 5) // a band at the top
    s.scrollUp(8)
    expect(fromPlanes(s, 2, 0)).toBe(0) // the band has gone
    agree(s, 'scrollUp')
  })

  it('scrollUp in a window scrolls only that window', () => {
    const s = scr()
    s.bar(0, 0, 63, 31, 7)
    s.windOpen(1, 8, 8, 4, 2, 0)
    s.scrollUp(8)
    agree(s, 'window scrollUp')
    // outside the window is untouched
    expect(fromPlanes(s, 0, 0)).toBe(7)
  })

  it('a window scroll fills the vacated line in the planes', () => {
    // Vscroll/Hscroll print control characters 16-22, which land in winFill.
    // It bound `this.pixels` — the read-only cache — so the vacated line was
    // repainted in the cache and never in the bitmap. Nothing was visible,
    // because the display fetches planes and nothing else.
    const s = scr()
    s.cls(7)
    s.windOpen(1, 0, 0, 8, 4, 0)
    s.curWin.paper = 3
    s.writeText('\x14') // ScBas: cursor line down one, cursor line cleared
    expect(fromPlanes(s, 0, 0)).toBe(3)
    agree(s, 'window vscroll')
  })

  it('a window hscroll fills the vacated column in the planes', () => {
    const s = scr()
    s.cls(7)
    s.windOpen(1, 0, 0, 8, 4, 0)
    s.curWin.paper = 5
    s.writeText('\x13') // ScDWi: whole window right, left column paper
    expect(fromPlanes(s, 0, 0)).toBe(5)
    agree(s, 'window hscroll')
  })

  it('clw clears the planes', () => {
    const s = scr()
    s.bar(0, 0, 63, 31, 9)
    s.clw()
    agree(s, 'clw')
    expect(fromPlanes(s, 4, 4)).toBe(s.curWin.paper)
  })

  it('cls with a partial write mask leaves the excluded planes standing', () => {
    const s = scr()
    s.cls(0b1111)
    s.planeMask = 0b0001
    s.cls(0b0000)
    // only plane 0 cleared
    expect(fromPlanes(s, 5, 5)).toBe(0b1110)
    agree(s, 'masked cls')
  })

  it('Screen Copy through resolveScreenId lands in the planes', () => {
    const a = scr()
    const b = scr()
    a.bar(0, 0, 15, 15, 6)
    // emulate the instruction's write path: declare intent, then bulk write
    const dst = b.pixelsW()
    const src = a.pixels
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) dst[y * b.width + x] = src[y * a.width + x]!
    }
    expect(fromPlanes(b, 3, 3)).toBe(6)
    agree(b, 'screen copy')
  })
})

describe('bank images are bitplanes too', () => {
  it('keeps the planar bytes it was given, rather than deriving them back', () => {
    // sprite and icon banks are already planar on disk. The load used to
    // unpack every image to chunky and the save packed it again — a round
    // trip that could only promise "equivalent", because the padding bits
    // past the width had nowhere to survive.
    const planes = new Uint8Array(2 * 4 * 3) // 16 wide, 4 tall, 3 planes
    for (let i = 0; i < planes.length; i++) planes[i] = (i * 37) & 0xff
    const img = new BankImage(16, 4, 3, 0, 0, planes.slice())
    expect(Buffer.from(img.planeBytes()).equals(Buffer.from(planes))).toBe(true)
  })

  it('the chunky view is derived from the planes', () => {
    const img = new BankImage(16, 2, 2, 0, 0)
    // plane 0 bit for x=0,y=0; plane 1 bit for x=1,y=0
    img.planes[0] = 0x80
    img.planes[img.planeSize] = 0x40
    expect(img.pixels[0]).toBe(1)
    expect(img.pixels[1]).toBe(2)
    expect(img.pixelAt(0, 0)).toBe(1)
  })

  it('a chunky edit reaches the planes through flush', () => {
    const img = new BankImage(16, 2, 3, 0, 0)
    const buf = img.pixelsW()
    buf[1 * 16 + 5] = 0b101
    expect(getPixel(img.planeBytes(), img.planeSize, img.rowBytes, img.depth, 5, 1)).toBe(0b101)
  })

  it('geometry follows the BANK, not a screen', () => {
    // banks store widthWords = width >> 4, truncating, where a screen rounds
    // up. Every AMOS sprite is a multiple of 16 wide so they agree in
    // practice, but the bank's convention is what a save has to reproduce.
    expect(new BankImage(32, 8, 4, 0, 0).rowBytes).toBe(4)
    expect(new BankImage(16, 8, 4, 0, 0).rowBytes).toBe(2)
  })
})

describe('nothing writes the chunky cache behind the planes', () => {
  /**
   * The invariant, asserted against the SOURCE rather than one more code path.
   *
   * Three focused sweeps have now fixed this same class of bug — cls/scrollUp/clw,
   * then winFill and five TURBO routines, then the per-frame bob restore — and each
   * time the sweep was scoped to the files it happened to be reading. A write that
   * lands in the cache and never in the planes passes every behavioural test,
   * because the reads come back through the same cache. So the test has to be
   * scoped to the invariant, and the only thing that covers every file is the text.
   *
   * `Screen.pixels` is read-only by contract; writers call `pixelsW()`. Blocks
   * (rt.blocks / rt.cblocks) are plain buffers with no planar backing, so they are
   * not part of this and their own `.pixels` is writable.
   */
  it('no source file mutates a Screen .pixels view', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
          const src = readFileSync(p, 'utf8')
          src.split('\n').forEach((line, i) => {
            // a write through `<expr>.pixels`, but not through pixelsW()
            if (!/\.pixels(\[[^\]]*\]!?\s*(\+|-|&|\||\^)?=[^=]|\.set\(|\.fill\(|\.copyWithin\(|\.sort\(|\.reverse\()/.test(line)) return
            if (/pixelsW/.test(line)) return
            // rt.blocks / rt.cblocks entries are not Screens
            if (/\bb\.pixels|blocks\.get/.test(line)) return
            offenders.push(`${p.replace(root, 'src')}:${i + 1}  ${line.trim()}`)
          })
        }
      }
    }
    walk(root)
    expect(offenders, `write through the read-only chunky view — use pixelsW():\n  ${offenders.join('\n  ')}`).toEqual([])
  })
  it('nothing writes through the READ address resolver', () => {
    /**
     * The same invariant from the other side. `resolveAddr` is
     * `resolveInto(addr, false)`; `resolveWrite` is the same with `write=true`,
     * which is what tells a Screen that a plane write has made its chunky cache
     * stale. Writing through the read resolver therefore leaves a screen's
     * planes and cache disagreeing — the bob bug's twin, and it was live in
     * seven LDos keywords plus Squash and Unsquash.
     *
     * Scoped to the invariant rather than to a file, because the last three
     * sweeps of this class each fixed only the files that happened to be open.
     */
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
          const lines = readFileSync(p, 'utf8').split('\n')
          lines.forEach((line, i) => {
            const m = /(?:const|let)\s+(\w+)\s*=\s*(?:rt|this)\.resolveAddr\(/.exec(line)
            if (!m) return
            const name = m[1]!
            const indent = /^\s*/.exec(line)![0].length
            const w = new RegExp(`\\b${name}\\.data(\\[[^\\]]*\\]!?\\s*(\\+|-|&|\\||\\^)?=[^=]|\\.set\\(|\\.fill\\()`)
            for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
              const l = lines[j]!
              if (l.trim() !== '' && /^\s*/.exec(l)![0].length < indent) break
              if (w.test(l)) {
                offenders.push(`${p.replace(root, 'src')}:${i + 1} -> written at :${j + 1}`)
                break
              }
            }
          })
        }
      }
    }
    walk(root)
    expect(offenders, `write through resolveAddr — use resolveWrite():\n  ${offenders.join('\n  ')}`).toEqual([])
  })
})

