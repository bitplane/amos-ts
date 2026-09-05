import { describe, expect, it } from 'vitest'
import { newNativeRasInfo, setRasInfo } from './osgraphicsstruct'

describe('OS DevKit native graphics structures', () => {
  it('writes every pointer and signed word of the 12-byte RasInfo', () => {
    const info = newNativeRasInfo()
    setRasInfo(info, -1, -2, 0xffff, 0x8001)
    expect(info).toEqual({
      next: 0xffff_ffff, bitMap: 0xffff_fffe, xOffset: -1, yOffset: -32767,
    })
  })
})
