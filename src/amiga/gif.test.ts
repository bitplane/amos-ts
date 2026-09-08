import { describe, expect, it } from 'vitest'
import { encodeGif } from '../web/gif'
import { decodeGif } from './gif'
import { decodePicture } from '../web/picture'

describe('GIF picture datatype', () => {
  it('decodes the GIF writer used for ANIM exports', () => {
    const rgba = new Uint8ClampedArray(16 * 16 * 4)
    for (let i = 0; i < 256; i++) {
      rgba[i * 4] = i & 0xe0
      rgba[i * 4 + 1] = (i << 3) & 0xe0
      rgba[i * 4 + 2] = (i << 6) & 0xc0
      rgba[i * 4 + 3] = 255
    }
    const image = decodeGif(encodeGif([{ width: 16, height: 16, rgba, delay: 1 }]))
    expect(image).toMatchObject({ width: 16, height: 16, depth: 8 })
    expect(image?.pixels).toEqual(Uint8Array.from({ length: 256 }, (_, i) => i))
    expect(decodePicture(encodeGif([{ width: 16, height: 16, rgba, delay: 1 }]), 'GIF')).toMatchObject({ width: 16, height: 16 })
  })

  it('honours GIF89a transparency', () => {
    const bytes = Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'))
    const image = decodeGif(bytes)
    expect(image).toMatchObject({ width: 1, height: 1 })
    expect(image?.alpha?.[0]).toBe(0)
  })

  it('rejects truncated and non-GIF data', () => {
    expect(decodeGif(new TextEncoder().encode('not a gif'))).toBeNull()
    expect(decodeGif(new TextEncoder().encode('GIF89a'))).toBeNull()
  })
})
