import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseIlbm } from './iff'
import { parsePacPic } from './pacpic'
import { parseAmosFile } from './amosfile'
import { decodeSprite } from '../runtime/objects'
import type { Sprite } from './amosfile'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures')

describe.skipIf(!existsSync(fixtures))('IFF ILBM', () => {
  it('decodes a real picture with palette', () => {
    const img = parseIlbm(readFileSync(join(fixtures, 'official-amos', 'Tutorial', 'Iff', 'Window.Iff')))
    expect([img.width, img.height, img.depth]).toEqual([320, 256, 3])
    expect(img.palette).toHaveLength(8)
    expect(img.pixels).toHaveLength(320 * 256)
    // something non-background must be drawn
    expect(img.pixels.some((p) => p !== 0)).toBe(true)
  })

  it('accepts palette-only IFFs', () => {
    const img = parseIlbm(
      readFileSync(join(fixtures, 'official-amos', 'Productivity2', 'Procedures', 'Plasma', 'Plasma1_pal.IFF')),
    )
    expect(img.width).toBe(0)
    expect(img.palette.length).toBeGreaterThan(0)
  })
})

describe.skipIf(!existsSync(fixtures))('Pac.Pic', () => {
  it("unpacks File O' Fax's packed screen", () => {
    const amos = parseAmosFile(readFileSync(join(fixtures, 'official-amos', 'Productivity1', "Fileo'fax.AMOS")))
    const bank = amos.banks.find((b) => b.kind === 'memory' && /pac\.?pic/i.test(b.name))
    expect(bank).toBeDefined()
    if (bank?.kind !== 'memory') return
    const pic = parsePacPic(bank.data)
    expect(pic.screen).not.toBeNull()
    expect([pic.width, pic.height]).toEqual([640, 256])
    expect(pic.nPlanes).toBe(4)
    expect(pic.pixels.some((p) => p !== 0)).toBe(true)
  })
})

describe('sprite decoding', () => {
  it('converts planar bank images to chunky', () => {
    // 16x2, 2 planes: plane0 = leftmost pixel each row, plane1 = rightmost
    const s: Sprite = {
      width: 16,
      height: 2,
      depth: 2,
      hotX: 3,
      hotY: 4,
      data: new Uint8Array([
        0x80, 0x00, 0x80, 0x00, // plane 0, rows 0-1
        0x00, 0x01, 0x00, 0x01, // plane 1, rows 0-1
      ]),
    }
    const img = decodeSprite(s)
    expect([img.width, img.height, img.hotX, img.hotY]).toEqual([16, 2, 3, 4])
    expect(img.pixels[0]).toBe(1) // plane 0 bit
    expect(img.pixels[15]).toBe(2) // plane 1 bit
    expect(img.pixels[1]).toBe(0)
    expect(img.pixels[16]).toBe(1) // second row
  })
})
