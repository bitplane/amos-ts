import { describe, expect, it } from 'vitest'
import { LayerInfo, Region, rect, rectArea, rectSubtract } from './layers'

describe('rectangles are inclusive at both ends', () => {
  it('a 1x1 rectangle has MinX == MaxX', () => {
    expect(rectArea(rect(5, 5, 5, 5))).toBe(1)
    expect(rectArea(rect(0, 0, 9, 9))).toBe(100)
    // inverted is empty, which is how layers.library says "nothing"
    expect(rectArea(rect(5, 5, 4, 4))).toBe(0)
  })

  it('subtracting a hole out of the middle leaves four disjoint pieces', () => {
    const parts = rectSubtract(rect(0, 0, 9, 9), rect(3, 3, 6, 6))
    expect(parts).toHaveLength(4)
    expect(parts.reduce((n, r) => n + rectArea(r), 0)).toBe(100 - 16)
    // disjoint: no pixel is in two pieces
    const seen = new Set<number>()
    for (const p of parts)
      for (let y = p.minY; y <= p.maxY; y++)
        for (let x = p.minX; x <= p.maxX; x++) {
          expect(seen.has(y * 100 + x)).toBe(false)
          seen.add(y * 100 + x)
        }
  })

  it('subtracting something that misses leaves the whole rectangle', () => {
    expect(rectSubtract(rect(0, 0, 9, 9), rect(20, 20, 30, 30))).toEqual([rect(0, 0, 9, 9)])
  })

  it('subtracting something that covers leaves nothing', () => {
    expect(rectSubtract(rect(2, 2, 5, 5), rect(0, 0, 9, 9))).toEqual([])
  })
})

describe('Region (graphics.library: NewRegion -516 and friends)', () => {
  it('OrRectRegion of two overlapping rectangles counts the overlap once', () => {
    const g = new Region()
    g.orRect(rect(0, 0, 9, 9))
    g.orRect(rect(5, 5, 14, 14))
    expect(g.area()).toBe(100 + 100 - 25)
    expect(g.contains(7, 7)).toBe(true)
    expect(g.contains(12, 2)).toBe(false)
  })

  it('the rectangle list stays disjoint however it is built', () => {
    const g = new Region()
    for (let i = 0; i < 6; i++) g.orRect(rect(i, i, i + 10, i + 10))
    let sum = 0
    for (const r of g.rects) sum += rectArea(r)
    expect(sum).toBe(g.area())
  })

  it('ClearRectRegion and AndRectRegion', () => {
    const g = Region.fromRect(rect(0, 0, 9, 9))
    g.clearRect(rect(0, 0, 4, 9))
    expect(g.area()).toBe(50)
    expect(g.contains(2, 2)).toBe(false)
    expect(g.contains(7, 2)).toBe(true)
    g.andRect(rect(0, 0, 9, 4))
    expect(g.area()).toBe(25)
  })

  it('XorRectRegion keeps what is in one but not both', () => {
    const g = Region.fromRect(rect(0, 0, 9, 9))
    g.xorRect(rect(5, 5, 14, 14))
    // the 5x5 overlap goes; both remainders stay
    expect(g.area()).toBe(75 + 75)
    expect(g.contains(7, 7)).toBe(false)
    expect(g.contains(2, 2)).toBe(true)
    expect(g.contains(12, 12)).toBe(true)
  })

  it('equals compares the SET, not the cutting-up', () => {
    const a = Region.fromRect(rect(0, 0, 9, 9))
    const b = new Region()
    b.orRect(rect(0, 0, 9, 4))
    b.orRect(rect(0, 5, 9, 9))
    expect(a.rects.length).not.toBe(b.rects.length)
    expect(a.equals(b)).toBe(true)
  })

  it('bounds of an empty region is empty, not a point at the origin', () => {
    expect(rectArea(new Region().bounds())).toBe(0)
  })
})

describe('the layer chain: visible = rect minus everything in front', () => {
  const li = (): LayerInfo => new LayerInfo(320, 200)

  it('one layer sees all of itself', () => {
    const l = li().createUpfrontLayer(rect(10, 10, 109, 109))
    expect(l.clip.area()).toBe(100 * 100)
  })

  it('a layer in front takes a bite out of the one behind', () => {
    const i = li()
    const back = i.createUpfrontLayer(rect(0, 0, 99, 99))
    const front = i.createUpfrontLayer(rect(50, 50, 149, 149))
    expect(front.clip.area()).toBe(100 * 100)
    expect(back.clip.area()).toBe(100 * 100 - 50 * 50)
    expect(back.clip.contains(60, 60)).toBe(false)
    expect(back.clip.contains(40, 60)).toBe(true)
  })

  it('is clipped to the bitmap — a layer dragged off the edge is not visible there', () => {
    const i = li()
    const l = i.createUpfrontLayer(rect(280, 180, 379, 279))
    // only the 40x20 corner inside 320x200 is real
    expect(l.clip.area()).toBe(40 * 20)
  })

  it('UpfrontLayer and BehindLayer swap who is obscured', () => {
    const i = li()
    const a = i.createUpfrontLayer(rect(0, 0, 99, 99))
    const b = i.createUpfrontLayer(rect(50, 50, 149, 149))
    expect(a.clip.area()).toBeLessThan(100 * 100)
    i.upfrontLayer(a)
    expect(a.clip.area()).toBe(100 * 100)
    expect(b.clip.area()).toBe(100 * 100 - 50 * 50)
    i.behindLayer(a)
    expect(a.clip.area()).toBe(100 * 100 - 50 * 50)
  })

  it('MoveLayerInFrontOf puts it directly in front of the named one', () => {
    const i = li()
    const a = i.createUpfrontLayer(rect(0, 0, 9, 9))
    const b = i.createUpfrontLayer(rect(0, 0, 9, 9))
    const c = i.createUpfrontLayer(rect(0, 0, 9, 9))
    expect(i.layers).toEqual([a, b, c])
    i.moveLayerInFrontOf(a, b)
    expect(i.layers).toEqual([b, a, c])
    i.moveLayerInFrontOf(b, c)
    expect(i.layers).toEqual([a, c, b])
  })

  it('WhichLayer finds the frontmost, not just any', () => {
    const i = li()
    i.createUpfrontLayer(rect(0, 0, 99, 99))
    const front = i.createUpfrontLayer(rect(50, 50, 149, 149))
    expect(i.whichLayer(60, 60)).toBe(front)
    expect(i.whichLayer(200, 200)).toBeNull()
  })

  it('DeleteLayer gives the area back to whatever was under it', () => {
    const i = li()
    const back = i.createUpfrontLayer(rect(0, 0, 99, 99))
    const front = i.createUpfrontLayer(rect(50, 50, 149, 149))
    expect(i.deleteLayer(front)).toBe(true)
    expect(back.clip.area()).toBe(100 * 100)
    expect(i.deleteLayer(front)).toBe(false)
  })
})

describe('damage — the one thing that separates the three refresh types', () => {
  const li = (): LayerInfo => new LayerInfo(320, 200)

  it('a SIMPLE layer is damaged exactly where it was uncovered', () => {
    const i = li()
    const back = i.createUpfrontLayer(rect(0, 0, 99, 99), 'simple')
    back.damage.clear() // the first exposure damages everything; start clean
    const front = i.createUpfrontLayer(rect(50, 50, 149, 149))
    expect(back.damage.isEmpty()).toBe(true) // covering damages nothing
    i.deleteLayer(front)
    expect(back.damage.area()).toBe(50 * 50)
    expect(back.damage.contains(60, 60)).toBe(true)
    expect(back.damage.contains(10, 10)).toBe(false)
  })

  it('a SMART layer is never damaged — its pixels were kept', () => {
    const i = li()
    const back = i.createUpfrontLayer(rect(0, 0, 99, 99), 'smart')
    const front = i.createUpfrontLayer(rect(50, 50, 149, 149))
    i.deleteLayer(front)
    expect(back.damage.isEmpty()).toBe(true)
    expect(back.clip.area()).toBe(100 * 100)
  })

  it('nor a SUPER layer, which has a complete bitmap of its own', () => {
    const i = li()
    const back = i.createUpfrontLayer(rect(0, 0, 99, 99), 'super')
    const front = i.createUpfrontLayer(rect(50, 50, 149, 149))
    i.deleteLayer(front)
    expect(back.damage.isEmpty()).toBe(true)
  })

  it('a newly created simple layer is damaged over the whole of itself', () => {
    const l = li().createUpfrontLayer(rect(10, 10, 109, 109), 'simple')
    expect(l.damage.area()).toBe(100 * 100)
  })

  it('SizeLayer damages only the new area, not what was already drawn', () => {
    const i = li()
    const l = i.createUpfrontLayer(rect(0, 0, 99, 99), 'simple')
    l.damage.clear()
    i.sizeLayer(l, 20, 0)
    expect(l.damage.area()).toBe(20 * 100)
    expect(l.damage.contains(110, 50)).toBe(true)
    expect(l.damage.contains(50, 50)).toBe(false)
  })

  it('coming forward damages what the layer in front had been hiding', () => {
    const i = li()
    const a = i.createUpfrontLayer(rect(0, 0, 99, 99), 'simple')
    i.createUpfrontLayer(rect(50, 50, 149, 149))
    a.damage.clear()
    i.upfrontLayer(a)
    expect(a.damage.area()).toBe(50 * 50)
  })

  it('ScrollLayer damages the strip that scrolled into view', () => {
    const i = li()
    const l = i.createUpfrontLayer(rect(0, 0, 99, 99), 'simple')
    l.damage.clear()
    i.scrollLayer(l, 10, 0) // contents left, right edge exposed
    expect(l.damage.area()).toBe(10 * 100)
    expect(l.damage.contains(95, 50)).toBe(true)
    expect(l.damage.contains(5, 50)).toBe(false)
    expect(l.scrollX).toBe(10)
  })

  it('and a smart layer does not scroll into damage', () => {
    const i = li()
    const l = i.createUpfrontLayer(rect(0, 0, 99, 99), 'smart')
    i.scrollLayer(l, 10, 0)
    expect(l.damage.isEmpty()).toBe(true)
  })
})

describe('BeginUpdate / EndUpdate', () => {
  const li = (): LayerInfo => new LayerInfo(320, 200)

  it('BeginUpdate narrows the clip to the damage; EndUpdate(TRUE) clears it', () => {
    const i = li()
    const back = i.createUpfrontLayer(rect(0, 0, 99, 99), 'simple')
    back.damage.clear()
    const front = i.createUpfrontLayer(rect(50, 50, 149, 149))
    i.deleteLayer(front)
    back.beginUpdate()
    expect(back.clip.area()).toBe(50 * 50) // only the uncovered corner
    back.endUpdate(true)
    expect(back.clip.area()).toBe(100 * 100)
    expect(back.damage.isEmpty()).toBe(true)
  })

  it('EndUpdate(FALSE) leaves the damage to be asked for again', () => {
    const i = li()
    const l = i.createUpfrontLayer(rect(0, 0, 99, 99), 'simple')
    l.beginUpdate()
    l.endUpdate(false)
    expect(l.damage.area()).toBe(100 * 100)
    expect(l.clip.area()).toBe(100 * 100)
  })

  /**
   * The case that made `fullClip` necessary: if the chain measured "gained"
   * against the NARROWED clip, every ClipRect outside the damage would read
   * as newly gained and the layer would re-damage itself in full, so the
   * update could never converge.
   */
  it('a chain change during an update does not re-damage the whole layer', () => {
    const i = li()
    const a = i.createUpfrontLayer(rect(0, 0, 99, 99), 'simple')
    const b = i.createUpfrontLayer(rect(50, 50, 149, 149), 'simple')
    a.damage.clear()
    i.deleteLayer(b)
    expect(a.damage.area()).toBe(50 * 50)
    a.beginUpdate()
    // something else opens and closes while a is mid-redraw
    const c = i.createUpfrontLayer(rect(200, 0, 299, 99))
    i.deleteLayer(c)
    expect(a.damage.area()).toBe(50 * 50)
    a.endUpdate(true)
    expect(a.damage.isEmpty()).toBe(true)
    expect(a.clip.area()).toBe(100 * 100)
  })
})

describe('InstallClipRegion', () => {
  it('cuts the layer down further, in LAYER coordinates', () => {
    const i = new LayerInfo(320, 200)
    const l = i.createUpfrontLayer(rect(100, 100, 199, 199))
    expect(l.visible().area()).toBe(100 * 100)
    // the owner's own interior: 10,10 to 89,89 within its window
    const old = i.installClipRegion(l, Region.fromRect(rect(10, 10, 89, 89)))
    expect(old).toBeNull()
    expect(l.visible().area()).toBe(80 * 80)
    // ... which lands at 110,110 on the bitmap, not at 10,10
    expect(l.visible().contains(110, 110)).toBe(true)
    expect(l.visible().contains(105, 105)).toBe(false)
    expect(l.clip.area()).toBe(100 * 100) // the ClipRects themselves are untouched
  })

  it('returns the region it replaced, and null puts it back', () => {
    const i = new LayerInfo(320, 200)
    const l = i.createUpfrontLayer(rect(0, 0, 99, 99))
    const r = Region.fromRect(rect(0, 0, 9, 9))
    i.installClipRegion(l, r)
    expect(i.installClipRegion(l, null)).toBe(r)
    expect(l.visible().area()).toBe(100 * 100)
  })
})

/**
 * The region algebra, against a pixel grid.
 *
 * Everything above tests the Region against itself, which proves only that it
 * agrees with the way it is built. This walks a 24x24 grid of booleans
 * through the same operations and compares pixel for pixel — the only check
 * here that could catch a wrong rectangle decomposition, an inclusive/
 * exclusive slip in rectSubtract, or a lost overlap in orRect.
 *
 * The sequence is fixed rather than random, because a randomised oracle that
 * fails once and passes on the retry tells you nothing.
 */
describe('Region against a brute-force pixel grid', () => {
  const N = 24
  type Grid = boolean[]
  const blank = (): Grid => new Array<boolean>(N * N).fill(false)
  const paint = (g: Grid, r: ReturnType<typeof rect>, v: boolean): void => {
    for (let y = Math.max(0, r.minY); y <= Math.min(N - 1, r.maxY); y++)
      for (let x = Math.max(0, r.minX); x <= Math.min(N - 1, r.maxX); x++) g[y * N + x] = v
  }
  const same = (g: Grid, reg: Region): boolean => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g[y * N + x] !== reg.contains(x, y)) return false
    return true
  }

  // deliberately overlapping, touching, nested and disjoint
  const R = [
    rect(2, 2, 11, 11),
    rect(8, 8, 17, 17),
    rect(0, 0, 23, 3),
    rect(12, 0, 12, 23),
    rect(4, 4, 6, 6),
    rect(13, 13, 13, 13),
    rect(18, 2, 23, 9),
    rect(6, 10, 15, 12),
  ]

  it('OrRectRegion matches painting the pixels', () => {
    const g = blank()
    const reg = new Region()
    for (const r of R) {
      paint(g, r, true)
      reg.orRect(r)
      expect(same(g, reg)).toBe(true)
    }
    expect(reg.area()).toBe(g.filter(Boolean).length)
  })

  it('ClearRectRegion matches erasing them', () => {
    const g = blank()
    const reg = new Region()
    paint(g, rect(0, 0, N - 1, N - 1), true)
    reg.orRect(rect(0, 0, N - 1, N - 1))
    for (const r of R) {
      paint(g, r, false)
      reg.clearRect(r)
      expect(same(g, reg)).toBe(true)
    }
    expect(reg.area()).toBe(g.filter(Boolean).length)
  })

  it('AndRectRegion and XorRectRegion match too', () => {
    for (const r of R) {
      const g = blank()
      const reg = new Region()
      for (const q of R.slice(0, 4)) {
        paint(g, q, true)
        reg.orRect(q)
      }
      const gA = g.map((v, i) => {
        const x = i % N
        const y = (i / N) | 0
        return v && x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY
      })
      const regA = reg.clone()
      regA.andRect(r)
      expect(same(gA, regA)).toBe(true)

      const gX = g.slice()
      for (let y = Math.max(0, r.minY); y <= Math.min(N - 1, r.maxY); y++)
        for (let x = Math.max(0, r.minX); x <= Math.min(N - 1, r.maxX); x++) gX[y * N + x] = !gX[y * N + x]
      const regX = reg.clone()
      regX.xorRect(r)
      expect(same(gX, regX)).toBe(true)
    }
  })

  it('a layer chain clips exactly like painting the rectangles back to front', () => {
    const li = new LayerInfo(N, N)
    const ls = R.slice(0, 5).map((r) => li.createUpfrontLayer(r))
    // walk front to back: a pixel belongs to the frontmost layer covering it
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let owner = -1
        for (let i = ls.length - 1; i >= 0; i--) {
          const r = R[i]!
          if (x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY) {
            owner = i
            break
          }
        }
        for (let i = 0; i < ls.length; i++) expect(ls[i]!.clip.contains(x, y)).toBe(i === owner)
      }
  })
})
