import { describe, expect, it } from 'vitest'
import { decodeBmp, decodeIco } from './windowsbitmap'

const put16 = (d: Uint8Array, at: number, n: number): void => new DataView(d.buffer).setUint16(at, n, true)
const put32 = (d: Uint8Array, at: number, n: number): void => new DataView(d.buffer).setUint32(at, n, true)

function dib(target: Uint8Array, at: number, height: number): void {
  put32(target, at, 40); put32(target, at + 4, 2); put32(target, at + 8, height)
  put16(target, at + 12, 1); put16(target, at + 14, 1); put32(target, at + 32, 2)
  target.set([0, 0, 0, 0, 0xff, 0xff, 0xff, 0], at + 40)
}

describe('Windows bitmap datatypes', () => {
  it('decodes a bottom-up indexed BMP with padded rows', () => {
    const bmp = new Uint8Array(14 + 40 + 8 + 8)
    bmp.set([0x42, 0x4d]); put32(bmp, 2, bmp.length); put32(bmp, 10, 62)
    dib(bmp, 14, 2)
    bmp.set([0x40, 0, 0, 0, 0x80, 0, 0, 0], 62)
    expect(decodeBmp(bmp)).toMatchObject({ width: 2, height: 2, depth: 1, pixels: new Uint8Array([1, 0, 0, 1]) })
  })

  it('uses an ICO AND mask for transparency', () => {
    const ico = new Uint8Array(6 + 16 + 40 + 8 + 4 + 4)
    put16(ico, 2, 1); put16(ico, 4, 1)
    ico.set([2, 1, 2, 0], 6); put16(ico, 10, 1); put16(ico, 12, 1)
    put32(ico, 14, ico.length - 22); put32(ico, 18, 22)
    dib(ico, 22, 2)
    ico.set([0x40, 0, 0, 0], 70)
    ico.set([0x80, 0, 0, 0], 74)
    const image = decodeIco(ico)
    expect(image?.pixels).toEqual(new Uint8Array([0, 1]))
    expect(image?.alpha).toEqual(new Uint8Array([0, 255]))
  })
})
