import { describe, expect, it } from 'vitest'
import { parseSampleBank } from '../runtime/audio'
import { decode8svx, voice8svxSampleBank } from './iff8svx'

const id = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))
const be32 = (n: number): number[] => [n >>> 24, n >>> 16, n >>> 8, n].map((v) => v & 255)
const chunk = (name: string, body: number[]): number[] => [...id(name), ...be32(body.length), ...body, ...(body.length & 1 ? [0] : [])]
const file = (body: number[]): Uint8Array => new Uint8Array([...id('FORM'), ...be32(body.length + 4), ...id('8SVX'), ...body])
const vhdr = (compression = 0): number[] => chunk('VHDR', [...be32(4), ...be32(2), ...be32(0), 0x1f, 0x40, 1, compression, ...be32(0x10000)])

describe('IFF 8SVX', () => {
  it('reads chunks, padding and signed PCM', () => {
    const voice = decode8svx(file([...chunk('NAME', id('Hit')), ...vhdr(), ...chunk('BODY', [0, 127, 128, 255])]))
    expect(voice).toMatchObject({ name: 'Hit', rate: 8000, channels: 1, oneShot: 4, repeat: 2 })
    expect([...voice!.left]).toEqual([0, 127, -128, -1])
  })

  it('decodes Fibonacci deltas and turns the voice into an AMOS Samples bank', () => {
    const voice = decode8svx(file([...vhdr(1), ...chunk('BODY', [0, 0, 0x9a, 0xbc])]))!
    expect([...voice.left]).toEqual([1, 3, 6, 11])
    expect(parseSampleBank(voice8svxSampleBank(voice))[0]).toMatchObject({ freq: 8000, pcm: voice.left })
  })

  it('splits CHAN stereo and mixes it for Sam Play preview', () => {
    const voice = decode8svx(file([...vhdr(), ...chunk('CHAN', be32(6)), ...chunk('BODY', [10, 20, 30, 40])]))!
    expect([...voice.left]).toEqual([10, 20])
    expect([...voice.right!]).toEqual([30, 40])
    expect([...parseSampleBank(voice8svxSampleBank(voice))[0]!.pcm]).toEqual([20, 30])
  })
})
