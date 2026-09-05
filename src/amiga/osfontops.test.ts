import { describe, expect, it } from 'vitest'
import type { DiskFont } from './diskfont'
import { askSoftStyle, setFont, setSoftStyle } from './osfontops'

describe('OS DevKit graphics.library font operations', () => {
  it('sets the RastPort font and preserves it on a null font', () => {
    const font = { name: 'test.font' } as DiskFont
    const rastPort = { font: null as DiskFont | null, algoStyle: 0 }
    setFont(rastPort, font)
    setFont(rastPort, null)
    expect(rastPort.font).toBe(font)
  })

  it('reads and masked-replaces the algorithmic style byte', () => {
    const rastPort = { font: null, algoStyle: 0xa5 }
    expect(askSoftStyle(rastPort)).toBe(0xa5)
    expect(setSoftStyle(rastPort, 0x3c, 0x0f)).toBe(0xac)
    expect(askSoftStyle(rastPort)).toBe(0xac)
  })
})
