import { describe, expect, it } from 'vitest'
import {
  newNativeBorder, setBorderCorner, setBorderDots, setBorderDraw, setPropInfo, setStringBuffers,
  newNativeImage, pointInImage, setImageBody, setImagePlanes, setStringInfo,
  type NativePropInfo, type NativeStringInfo,
} from './osintuitionstruct'

describe('OS DevKit native Intuition structures', () => {
  it('writes Border bytes/words/longs exactly as routines 1370-1373', () => {
    const b = newNativeBorder()
    setBorderDraw(b, 0x101, 0x202, 0x303)
    setBorderCorner(b, -1, 0x12345)
    setBorderDots(b, 0x104, 0x8765_4321)
    b.next = 0x1234_5678
    expect(b).toEqual({
      left: 0xffff, top: 0x2345, frontPen: 1, backPen: 2, drawMode: 3,
      count: 4, dots: 0x8765_4321, next: 0x1234_5678,
    })
  })

  it('sets only the first five PropInfo words and preserves calculated fields', () => {
    const p: NativePropInfo = {
      flags: 0, horizPot: 0, vertPot: 0, horizBody: 0, vertBody: 0,
      width: 6, height: 7, horizInc: 8, vertInc: 9, left: 10, top: 11,
    }
    setPropInfo(p, 1, 2, 3, 4, 5)
    expect(p).toEqual({
      flags: 1, horizPot: 2, vertPot: 3, horizBody: 4, vertBody: 5,
      width: 6, height: 7, horizInc: 8, vertInc: 9, left: 10, top: 11,
    })
  })

  it('matches the partial and full StringInfo setters at offsets 0..$20', () => {
    const s: NativeStringInfo = {
      buffer: 0, undoBuffer: 0, bufferPos: 0, maxChars: 0, dispPos: 0,
      undoPos: 6, numChars: 7, dispCount: 8, cLeft: 9, cTop: 10,
      extension: 0, longInt: 0, keyMap: 0,
    }
    setStringBuffers(s, 1, 2, 3, 4, 5)
    expect([s.undoPos, s.numChars, s.dispCount, s.cLeft, s.cTop]).toEqual([6, 7, 8, 9, 10])
    setStringInfo(s, 11, 12, 13, 14, 15, 16, -17, 18)
    expect(s).toMatchObject({
      buffer: 11, undoBuffer: 12, bufferPos: 13, maxChars: 14, dispPos: 15,
      extension: 16, longInt: -17, keyMap: 18,
    })
  })

  it('writes every native Image field and tests points against its offset box', () => {
    const image = newNativeImage()
    setImageBody(image, -2, 3, 10, 5, 2, 0x1234_5678)
    setImagePlanes(image, 0x1ff, 0x102)
    image.next = 0x8765_4321
    expect(image).toMatchObject({
      left: 0xfffe, top: 3, width: 10, height: 5, depth: 2, data: 0x1234_5678,
      planePick: 0xff, planeOnOff: 2, next: 0x8765_4321,
    })
    expect(pointInImage(image, -2, 3)).toBe(true)
    expect(pointInImage(image, 7, 7)).toBe(true)
    expect(pointInImage(image, 8, 7)).toBe(false)
    expect(pointInImage(image, 7, 8)).toBe(false)
  })
})
