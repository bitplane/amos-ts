import { describe, expect, it } from 'vitest'
import {
  bitMapPlane, initTmpRas, initView, initViewPort, newNativeBitMap, newNativeRasInfo, newNativeRastPort,
  newNativeSimpleSprite, newNativeTmpRas, newNativeView, newNativeViewPort, rastPortCursorX, rastPortCursorY,
  rastPortTextBaseline,
  osDevKitViewPortWidth, osDevKitViewPortY, setBitMapData, setBitMapPlane, setOsDevKitView,
  setRasInfo, setRastPortLinePattern, setRastPortMask, setRastPortOutlinePen, setRastPortPointer,
  setSimpleSpriteHeight, setSimpleSpriteNumber, setSimpleSpritePosition, setViewPortBody,
} from './osgraphicsstruct'

describe('OS DevKit native graphics structures', () => {
  it('writes the exact BitMap scalar widths and valid plane slots', () => {
    const bitMap = newNativeBitMap()
    bitMap.pad = 0x9876
    setBitMapData(bitMap, 0x10002, 0x10003, 0x104, 0x105)
    expect(bitMap).toMatchObject({ bytesPerRow: 2, rows: 3, flags: 5, depth: 4, pad: 0x9876 })
    expect(setBitMapPlane(bitMap, 3, 0xfedc_ba98)).toBe(true)
    expect(bitMapPlane(bitMap, 3)).toBe(0xfedc_ba98)
    expect(bitMapPlane(bitMap, 4)).toBe(0)
    expect(bitMapPlane(bitMap, -1)).toBe(0)
  })

  it('does not reproduce _bm set plane negative-index memory corruption', () => {
    const bitMap = newNativeBitMap()
    bitMap.depth = 2
    expect(setBitMapPlane(bitMap, -1, 0xdead_beef)).toBe(false)
    expect(bitMap.planes).toEqual(Array<number>(8).fill(0))
  })

  it('writes the three SimpleSprite fields at unsigned word width', () => {
    const sprite = newNativeSimpleSprite()
    sprite.posCtlData = 0x1234_5678
    setSimpleSpriteHeight(sprite, 0x10001)
    setSimpleSpriteNumber(sprite, 0x10002)
    setSimpleSpritePosition(sprite, -1, -2)
    expect(sprite).toEqual({ posCtlData: 0x1234_5678, height: 1, x: 0xffff, y: 0xfffe, number: 2 })
  })

  it('initializes the complete TmpRas record as two unsigned longs', () => {
    const tmpRas = newNativeTmpRas()
    initTmpRas(tmpRas, -1, 0x1_0000_0001)
    expect(tmpRas).toEqual({ rasPtr: 0xffff_ffff, size: 1 })
  })

  it('writes the local RastPort pointer, pen, line and mask fields exactly', () => {
    const rastPort = newNativeRastPort()
    setRastPortPointer(rastPort, 'layer', -1)
    setRastPortPointer(rastPort, 'bitMap', 2)
    setRastPortPointer(rastPort, 'tmpRas', 3)
    setRastPortPointer(rastPort, 'areaInfo', 4)
    setRastPortOutlinePen(rastPort, 0x105)
    setRastPortOutlinePen(rastPort, 0x8000_0000)
    setRastPortLinePattern(rastPort, 0x1_2345)
    setRastPortMask(rastPort, 0x106)
    expect(rastPort).toMatchObject({
      layer: 0xffff_ffff, bitMap: 2, tmpRas: 3, areaInfo: 4,
      outlinePen: 5, linePtrn: 0x2345, mask: 6,
    })
  })

  it('uses signed cursor words and an unsigned text-baseline word', () => {
    const rastPort = newNativeRastPort()
    rastPort.cpX = 0x8001
    rastPort.cpY = 0xffff
    rastPort.txBaseline = 0x8002
    expect(rastPortCursorX(rastPort)).toBe(-32767)
    expect(rastPortCursorY(rastPort)).toBe(-1)
    expect(rastPortTextBaseline(rastPort)).toBe(32770)
  })

  it('writes every pointer and signed word of the 12-byte RasInfo', () => {
    const info = newNativeRasInfo()
    setRasInfo(info, -1, -2, 0xffff, 0x8001)
    expect(info).toEqual({
      next: 0xffff_ffff, bitMap: 0xffff_fffe, xOffset: -1, yOffset: -32767,
    })
  })

  it('reproduces the shipped View setter overwriting Y/X instead of modes', () => {
    const view = newNativeView()
    view.lofCopper = 1
    view.shfCopper = 2
    view.modes = 0xdead_beef
    setOsDevKitView(view, -1, 10, 20, 0x9234_8001)
    expect(view).toEqual({
      viewPort: 0xffff_ffff, lofCopper: 1, shfCopper: 2,
      dyOffset: -28108, dxOffset: -32767, modes: 0xdead_beef,
    })
  })

  it('writes every ViewPort body field at its native width', () => {
    const viewPort = newNativeViewPort()
    viewPort.next = 1
    viewPort.colorMap = 2
    viewPort.rasInfo = 3
    setViewPortBody(viewPort, -1, -2, 0x10003, 0x10004, 0x10005, 0x106)
    expect(viewPort).toMatchObject({
      next: 1, colorMap: 2, rasInfo: 3, dxOffset: 0xffff, dyOffset: 0xfffe,
      dWidth: 3, dHeight: 4, modes: 5, spritePriority: 1, extendedModes: 6,
    })
  })

  it('reproduces the shipped ViewPort width and Y reader defects', () => {
    const argument = newNativeViewPort()
    const staleD0 = newNativeViewPort()
    argument.dyOffset = 7
    staleD0.dyOffset = 0x8001
    expect(osDevKitViewPortWidth(0x12345)).toBe(0x2345)
    expect(osDevKitViewPortY(staleD0)).toBe(0x8001)
    expect(osDevKitViewPortY(staleD0)).not.toBe(argument.dyOffset)
  })

  it('initializes complete View and ViewPort records', () => {
    const view = { ...newNativeView(), viewPort: 1, lofCopper: 2, modes: 3 }
    const viewPort = { ...newNativeViewPort(), next: 1, modes: 2, rasInfo: 3 }
    initView(view)
    initViewPort(viewPort)
    expect(view).toEqual(newNativeView())
    expect(viewPort).toEqual(newNativeViewPort())
  })
})
