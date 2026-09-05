import { describe, expect, it } from 'vitest'
import {
  newNativeBorder, setBorderCorner, setBorderDots, setBorderDraw, setPropInfo, setStringBuffers,
  newNativeImage, pointInImage, setImageBody, setImagePlanes, setStringInfo,
  nativeIntuiMessage, notifyRequest, notifyUserData,
  newNativeIntuiText, setIntuiText, setIntuiTextCorner, setIntuiTextDraw,
  newNativeTextAttr, setTextAttr,
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

  it('retains every IntuiMessage field with the worker reads signed exactly', () => {
    expect(nativeIntuiMessage({
      class: -1, code: -2, qualifier: 0x12345, iaddress: -3,
      mouseX: 0xffff, mouseY: 0x8001, seconds: -4, micros: -5,
      idcmpWindow: -6,
    })).toEqual({
      class: 0xffff_ffff, code: 0xfffe, qualifier: 0x2345, iaddress: 0xffff_fffd,
      mouseX: -1, mouseY: -32767, seconds: 0xffff_fffc, micros: 0xffff_fffb,
      idcmpWindow: 0xffff_fffa,
    })
  })

  it('reads the NotifyMessage request pointer at its native width', () => {
    expect(notifyRequest({ request: -1 })).toBe(0xffff_ffff)
  })

  it('reads NotifyRequest user data as an unsigned pointer-sized field', () => {
    expect(notifyUserData({ userData: -1 })).toBe(0xffff_ffff)
  })

  it('writes every byte, word and pointer of the 20-byte IntuiText record', () => {
    const text = newNativeIntuiText()
    setIntuiTextDraw(text, 0x101, 0x202, 0x303)
    setIntuiTextCorner(text, -1, 0x12345)
    expect(text).toMatchObject({ frontPen: 1, backPen: 2, drawMode: 3, left: 0xffff, top: 0x2345 })
    setIntuiText(text, 4, 5, 6, -7, -8, -9, -10, -11)
    expect(text).toEqual({
      frontPen: 4, backPen: 5, drawMode: 6, left: 0xfff9, top: 0xfff8,
      font: 0xffff_fff7, text: 0xffff_fff6, next: 0xffff_fff5,
    })
  })

  it('writes every field of the eight-byte TextAttr record at native widths', () => {
    const attr = newNativeTextAttr()
    setTextAttr(attr, -1, 0x12345, 0x102, 0x203)
    expect(attr).toEqual({ name: 0xffff_ffff, ySize: 0x2345, style: 2, flags: 3 })
  })
})
