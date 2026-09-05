import { describe, expect, it } from 'vitest'
import {
  newNativeBorder, setBorderCorner, setBorderDots, setBorderDraw, setPropInfo, setStringBuffers,
  newNativeImage, pointInImage, setImageBody, setImagePlanes, setStringInfo,
  nativeIntuiMessage, notifyRequest, notifyUserData,
  allocDots, setDot, newNativeBooleanInfo, setBooleanInfo,
  newNativeGadget, setGadgetBody, setGadgetFlags, setGadgetRender, setGadgetUser,
  newNativeScreenDefinition, setScreenDefinitionBody, nativeScreenFields, NativeScreenDrawInfoPens,
  newNativeWindowDefinition, nativeWindowDefinition, nativeWindowFields, type NativeWindowFields,
  newNativeIntuiText, setIntuiText, setIntuiTextCorner, setIntuiTextDraw,
  newNativeTextAttr, setTextAttr,
  type NativePropInfo, type NativeStringInfo,
} from './osintuitionstruct'

describe('OS DevKit native Intuition structures', () => {
  it('retains the V1 and V2 DrawInfo pen words exactly as routines 3005-3006', () => {
    const defaults = new NativeScreenDrawInfoPens()
    defaults.defineV1([0x10001, 2, 3, 4, 5, 6, 7, 8, -1])
    defaults.defineV2([10, 11, 0x1000c])
    expect([...defaults.pens]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0xffff, 10, 11, 12])
  })

  it('applies every NewWindow field width used by routines 1219-1229 and 1301-1318', () => {
    const d = newNativeWindowDefinition()
    for (const key of Object.keys(d) as Array<keyof typeof d>) d[key] = -1
    const got = nativeWindowDefinition(d)
    expect([got.left, got.height, got.minWidth, got.maxHeight, got.type]).toEqual(Array(5).fill(0xffff))
    expect([got.detailPen, got.blockPen]).toEqual([0xff, 0xff])
    expect([got.idcmp, got.firstGadget, got.bitMap]).toEqual(Array(3).fill(0xffff_ffff))
  })

  it('applies the public Window pointer, unsigned and signed field reads of routines 1257-1300', () => {
    const input = Object.fromEntries([
      'next', 'left', 'top', 'width', 'height', 'mouseY', 'mouseX', 'minWidth', 'minHeight', 'maxWidth',
      'maxHeight', 'flags', 'menuStrip', 'title', 'firstRequest', 'dmRequest', 'requestCount', 'screen',
      'rastPort', 'borderLeft', 'borderTop', 'borderRight', 'borderBottom', 'firstGadget', 'parent',
      'descendant', 'pointer', 'pointerHeight', 'pointerWidth', 'pointerXOffset', 'pointerYOffset', 'idcmp',
      'userPort', 'windowPort', 'intuiMessage', 'detailPen', 'blockPen', 'image', 'screenTitle', 'extData',
      'userData', 'layer', 'font',
    ].map((key) => [key, -2])) as unknown as NativeWindowFields
    const got = nativeWindowFields(input)
    expect([got.mouseX, got.mouseY]).toEqual([-2, -2])
    expect([got.left, got.width, got.requestCount]).toEqual(Array(3).fill(0xfffe))
    expect([got.borderLeft, got.pointerYOffset, got.detailPen]).toEqual(Array(3).fill(0xfe))
    expect([got.next, got.rastPort, got.userData]).toEqual(Array(3).fill(0xffff_fffe))
  })

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

  it('stores Dots as signed word pairs at four-byte strides', () => {
    const dots = allocDots(2)
    setDot(dots, 1, 0xffff, 0x8001)
    expect(dots).toEqual([{ x: 0, y: 0 }, { x: -1, y: -32767 }])
  })

  it('stores the packed BooleanInfo word and unaligned long at native widths', () => {
    const info = newNativeBooleanInfo()
    setBooleanInfo(info, 0x12345, -1)
    expect(info).toEqual({ flags: 0x2345, mask: 0xffff_ffff })
  })

  it('stores all exposed Gadget words and pointers at their native widths', () => {
    const g = newNativeGadget()
    setGadgetBody(g, -1, 0x12345, 0x23456, 0x34567)
    setGadgetFlags(g, 0x45678, 0x56789, 0x6789a)
    setGadgetRender(g, -1, -2)
    setGadgetUser(g, 0x789ab, -3)
    g.next = 1
    g.text = 2
    g.specialInfo = 3
    expect(g).toMatchObject({
      next: 1, left: 0xffff, top: 0x2345, width: 0x3456, height: 0x4567,
      flags: 0x5678, activation: 0x6789, type: 0x789a,
      render: 0xffff_ffff, selectRender: 0xffff_fffe, text: 2,
      specialInfo: 3, id: 0x89ab, userData: 0xffff_fffd,
    })
  })

  it('stores the retained NewScreen definition and public Screen widths', () => {
    const d = newNativeScreenDefinition()
    setScreenDefinitionBody(d, -1, 0x12345, 0x23456, 0x34567, 0x45678)
    d.detailPen = 0x101
    d.blockPen = 0x202
    d.viewModes = 0x56789
    expect(d).toMatchObject({
      left: 0xffff, top: 0x2345, width: 0x3456, height: 0x4567, depth: 0x5678,
      detailPen: 0x101, blockPen: 0x202, viewModes: 0x56789,
    })
    expect(nativeScreenFields({
      next: -1, firstWindow: -2, title: -3, defaultTitle: -4, font: -5, bitMap: -6, layer: -7,
      width: -8, height: -9, depth: -10, detailPen: -11, blockPen: -12,
      mouseX: 0xffff, mouseY: 0x8001, barHeight: -13, viewModes: -14, type: -15,
    })).toMatchObject({
      next: 0xffff_ffff, width: 0xfff8, height: 0xfff7, depth: 0xf6,
      detailPen: 0xf5, blockPen: 0xf4, mouseX: -1, mouseY: -32767,
      barHeight: 0xf3, viewModes: 0xfff2, type: 0xfff1,
    })
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
