/**
 * `RastPort.flood` — graphics.library's Flood (-330), both modes.
 *
 * The mode is the whole of it and the two are not symmetric. Mode 0 spreads
 * over pixels that MATCH the seed's colour, which is a paint bucket. Mode 1
 * spreads over pixels that are NOT `rp_AOlPen`, which is a fill bounded by an
 * outline someone drew in that pen — and it is the one jd-int uses, with
 * `moveq #$1,d2`.
 *
 * The visited set is the reason this file exists. In mode 1 a pixel that has
 * just been filled is still not the outline pen, so it still qualifies to
 * spread and the walk never terminates on its own. That is exactly why Flood
 * needs a TmpRas on the machine and why `InitTmpRas` is mandatory: the scratch
 * bitmap is one flag bit per pixel, and it is the visited map rather than
 * scratch for the fill itself.
 */
import { describe, expect, it } from 'vitest'
import { BitMap, RastPort } from './graphics'

const rp = (w = 32, h = 16): RastPort => new RastPort(new BitMap(w, h, 4, Math.ceil(w / 16) * 2))

/** the whole bitmap as rows of digits, which is easier to read than an index */
const shot = (r: RastPort, w: number, h: number): string[] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => String(r.point(x, y))).join(''))

describe('RastPort.flood', () => {
  it('mode 1 stops at the AOlPen and nowhere else', () => {
    const r = rp(8, 5)
    r.setRast(3)
    r.aOlPen = 0
    // a vertical wall of the outline pen down the middle
    for (let y = 0; y < 5; y++) r.plot(3, y, 0)
    r.flood(1, 0, 0, 7)
    expect(shot(r, 8, 5)[0]).toBe('77703333')
    // the far side is untouched: the wall bounded it
    expect(r.point(5, 2)).toBe(3)
  })

  it('mode 1 terminates, which needs the visited set the machine keeps in TmpRas', () => {
    // the fill colour is itself "not the outline pen", so without a visited
    // set every filled pixel re-qualifies and the walk never ends
    const r = rp(16, 8)
    r.setRast(2)
    r.aOlPen = 0
    r.flood(1, 8, 4, 5)
    expect(r.point(0, 0)).toBe(5)
    expect(r.point(15, 7)).toBe(5)
  })

  it('mode 0 spreads over the seed colour and leaves every other colour alone', () => {
    const r = rp(8, 3)
    r.setRast(1)
    r.plot(4, 1, 2)
    r.flood(0, 0, 0, 6)
    expect(r.point(0, 0)).toBe(6)
    expect(r.point(7, 2)).toBe(6)
    expect(r.point(4, 1)).toBe(2) // the odd pixel out is not the seed's colour
  })

  it('is four-connected: a diagonal gap does not leak', () => {
    const r = rp(5, 5)
    r.setRast(1)
    r.aOlPen = 0
    // a diagonal wall from the top-right to the bottom-left
    for (let i = 0; i < 5; i++) r.plot(4 - i, i, 0)
    r.flood(1, 0, 0, 7)
    expect(r.point(0, 0)).toBe(7) // above the diagonal
    expect(r.point(4, 4)).toBe(1) // below it, and unreachable four-connected
  })

  it('respects the clip rectangle', () => {
    const r = rp(10, 4)
    r.setRast(1)
    r.aOlPen = 0
    r.clip = { x1: 2, y1: 1, x2: 5, y2: 2 }
    r.flood(1, 3, 1, 4)
    expect(r.point(3, 1)).toBe(4)
    expect(r.point(5, 2)).toBe(4)
    expect(r.point(6, 2)).toBe(1) // outside the clip
    expect(r.point(3, 0)).toBe(1)
  })

  it('a seed already on the stopping colour fills nothing', () => {
    const r = rp(6, 3)
    r.setRast(1)
    r.aOlPen = 1 // the ground IS the outline pen
    r.flood(1, 2, 1, 5)
    expect(r.point(2, 1)).toBe(1)
    // and in mode 0 a seed outside the clip is the same no-op
    r.clip = { x1: 0, y1: 0, x2: 1, y2: 1 }
    r.flood(0, 4, 2, 5)
    expect(r.point(4, 2)).toBe(1)
  })
})
