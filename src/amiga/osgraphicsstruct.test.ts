import { describe, expect, it } from 'vitest'
import { newNativeRasInfo, newNativeView, setOsDevKitView, setRasInfo } from './osgraphicsstruct'

describe('OS DevKit native graphics structures', () => {
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
})
