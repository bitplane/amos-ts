import { describe, expect, it } from 'vitest'
import { allocColorMap, freeColorMap, getRgb4, getRgb32, setRgb4ColorMap, setRgb32ColorMap } from './oscolormap'

describe('OS DevKit graphics.library ColorMap operations', () => {
  it('allocates cleared entries and makes freed maps inert', () => {
    const map = allocColorMap(2)
    expect(map.components).toEqual(new Uint32Array(6))
    freeColorMap(map)
    setRgb32ColorMap(map, 0, -1, -1, -1)
    expect(getRgb4(map, 0)).toBe(0)
    expect(getRgb32(map, 0, 1)).toEqual(new Uint32Array())
  })

  it('round-trips RGB4 through left-justified ColorMap components', () => {
    const map = allocColorMap(2)
    setRgb4ColorMap(map, 1, 0xa, 0xb, 0xc)
    expect(getRgb4(map, 1)).toBe(0xabc)
    expect(getRgb32(map, 1, 1)).toEqual(new Uint32Array([0xaaaa_aaaa, 0xbbbb_bbbb, 0xcccc_cccc]))
  })

  it('stores RGB32 unsigned and derives RGB4 from its high nibbles', () => {
    const map = allocColorMap(3)
    setRgb32ColorMap(map, 1, 0x89ab_cdef, 0x1234_5678, 0xfedc_ba98)
    expect(getRgb32(map, 1, 5)).toEqual(new Uint32Array([0x89ab_cdef, 0x1234_5678, 0xfedc_ba98, 0, 0, 0]))
    expect(getRgb4(map, 1)).toBe(0x81f)
  })
})
