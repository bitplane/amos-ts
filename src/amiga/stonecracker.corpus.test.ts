/** Binary pins for the stc.library surface used by The Game. */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadHunks } from './hunk'
import { STC_LIBRARY } from './stonecracker'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const path = join(root, 'fixtures', 'libs', 'stc.library')
const present = existsSync(path)
const image = (): Uint8Array => loadHunks(new Uint8Array(readFileSync(path)), 0).image
const long = (c: Uint8Array, o: number): number =>
  ((c[o]! << 24) | (c[o + 1]! << 16) | (c[o + 2]! << 8) | c[o + 3]!) >>> 0

describe.skipIf(!present)('stc.library 3.322, as shipped', () => {
  it('pins its identity and the seven vectors The Game calls', () => {
    const file = readFileSync(path)
    expect(file.length).toBe(6368)
    expect(file.toString('latin1')).toContain('StoneCrackerLibrary 3.322 (17 Apr 1994)')
    expect(STC_LIBRARY).toMatchObject({ name: 'stc.library', version: 3, revision: 322, librarySize: 74 })
    const c = image()
    const autoinit = long(c, 4 + 22)
    const vectors = long(c, autoinit + 4)
    // FUNCARRAY_16: a -1 marker followed by signed word offsets from the
    // vector-table base, one per LVO.
    const at = (lvo: number): number => {
      const o = vectors + (-lvo / 6) * 2
      const displacement = ((c[o]! << 8) | c[o + 1]!) << 16 >> 16
      return vectors + displacement
    }
    expect(Object.fromEntries(Object.entries(STC_LIBRARY.lvo).map(([name, lvo]) => [name, at(lvo)]))).toEqual({
      allocWork: 0x8fe,
      freeWork: 0x924,
      decrunch: 0x936,
      freeFileBuffer: 0xf20,
      readFile: 0xf34,
      crunch: 0x2d0,
      allocFileBuffer: 0xe4c,
    })
  })

  it('dispatches S403 and S404 to distinct decoder arms', () => {
    const c = image()
    expect([...c.subarray(0x93c, 0x952)]).toEqual([
      0x22, 0x19, 0x0c, 0x81, 0x53, 0x34, 0x30, 0x33, 0x67, 0x12,
      0x0c, 0x81, 0x53, 0x34, 0x30, 0x34, 0x66, 0x04, 0x61, 0x00, 0x00, 0xf6,
    ])
  })

  it('carries the four S403 offset widths, masks and bases', () => {
    const c = image()
    const words = Array.from({ length: 16 }, (_, i) => (c[0x994 + i * 2]! << 8) | c[0x995 + i * 2]!)
    expect(words).toEqual([
      5, 0x1f, 1, 0,
      8, 0xff, 33, 0,
      10, 0x3ff, 289, 0,
      12, 0xfff, 1313, 0,
    ])
  })
})
