import { describe, expect, it } from 'vitest'
import { encodeGif } from './gif'

describe('animated GIF export', () => {
  it('writes GIF89a with one image per frame and the loop extension', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255])
    const gif = encodeGif([
      { width: 2, height: 1, rgba, delay: 2 },
      { width: 2, height: 1, rgba, delay: 4 },
    ])
    expect(new TextDecoder().decode(gif.subarray(0, 6))).toBe('GIF89a')
    expect(new TextDecoder().decode(gif).includes('NETSCAPE2.0')).toBe(true)
    expect(gif.length).toBeGreaterThan(800)
    expect(gif.at(-1)).toBe(0x3b)
  })
})
