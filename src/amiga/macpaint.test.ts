import { describe, expect, it } from 'vitest'
import { decodeMacPaint } from './macpaint'

describe('MacPaint PackBits bitmap', () => {
  it('decodes the fixed 576 by 720 monochrome canvas', () => {
    const file = new Uint8Array(512 + 405 * 2)
    for (let at = 512; at < file.length; at += 2) file.set([0x81, 0xff], at)
    const image = decodeMacPaint(file)!
    expect([image.width, image.height, image.pixels.length]).toEqual([576, 720, 576 * 720])
    expect(image.pixels.every((p) => p === 1)).toBe(true)
  })

  it('rejects a zero-prefixed binary that does not make a complete bitmap', () => {
    expect(decodeMacPaint(new Uint8Array(5000))).toBeNull()
  })
})
