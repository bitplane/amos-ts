import { describe, expect, it } from 'vitest'
import { decodePcx } from './pcx'

const put16 = (d: Uint8Array, at: number, n: number): void => new DataView(d.buffer).setUint16(at, n, true)

function header(width: number, height: number, bits: number, planes: number, stride: number): Uint8Array {
  const out = new Uint8Array(128)
  out.set([0x0a, 5, 1, bits])
  put16(out, 8, width - 1); put16(out, 10, height - 1)
  out[65] = planes; put16(out, 66, stride)
  for (let i = 0; i < 16; i++) out.set([i * 17, 0, 255 - i * 17], 16 + i * 3)
  return out
}

describe('PCX datatype', () => {
  it('combines one-bit planes into palette indices', () => {
    const pcx = new Uint8Array([...header(4, 1, 1, 2, 2), 0xa0, 0, 0x60, 0])
    expect(decodePcx(pcx)).toMatchObject({ width: 4, height: 1, depth: 2, pixels: new Uint8Array([1, 2, 3, 0]) })
  })

  it('reads the 256-colour palette after the RLE image', () => {
    const pcx = new Uint8Array(128 + 2 + 769)
    pcx.set(header(2, 1, 8, 1, 2)); pcx.set([1, 2], 128); pcx[130] = 0x0c
    pcx.set([0x10, 0x20, 0x30], 130 + 1 + 3)
    expect(decodePcx(pcx)).toMatchObject({ pixels: new Uint8Array([1, 2]), palette: expect.arrayContaining([0x123]) })
  })

  it('turns three eight-bit planes into indexed RGB', () => {
    const pcx = new Uint8Array([...header(1, 1, 8, 3, 1), 0xc1, 0xff, 0x80, 0x00])
    const image = decodePcx(pcx)
    expect(image).toMatchObject({ width: 1, height: 1, depth: 8 })
    expect(image!.palette[image!.pixels[0]!]!).toBe(0xf90)
  })
})
