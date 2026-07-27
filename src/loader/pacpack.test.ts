import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseAmosFile } from './amosfile'
import { SCREEN_HEADER_SIZE, packBitmap, packScreen, parsePacPic } from './pacpic'
import type { MemoryBank } from './amosfile'

const FIXTURES = join(__dirname, '..', '..', 'fixtures')

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) yield* walk(p)
    else yield p
  }
}

/** every .Abk in the corpus whose single bank is a packed picture */
function pacPicBanks(): Array<{ path: string; bank: MemoryBank }> {
  const out: Array<{ path: string; bank: MemoryBank }> = []
  if (!existsSync(FIXTURES)) return out
  for (const p of walk(FIXTURES)) {
    if (!p.toLowerCase().endsWith('.abk')) continue
    let banks
    try {
      banks = parseAmosFile(readFileSync(p)).banks
    } catch {
      continue
    }
    for (const b of banks) if (b.kind === 'memory' && b.name.startsWith('Pac.Pic')) out.push({ path: p, bank: b })
  }
  return out
}

/** rebuild the planar bitmap a screen of this shape would hold */
function toPlanar(pixels: Uint8Array, width: number, height: number, nPlanes: number): {
  planar: Uint8Array
  planeSize: number
  rowBytes: number
  nPlanes: number
} {
  const rowBytes = ((width + 15) >> 4) << 1
  const planeSize = rowBytes * height
  const planar = new Uint8Array(planeSize * nPlanes)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = pixels[y * width + x]!
      if (v === 0) continue
      const byteOff = y * rowBytes + (x >> 3)
      const mask = 0x80 >> (x & 7)
      for (let p = 0; p < nPlanes; p++) if (v & (1 << p)) planar[p * planeSize + byteOff] = planar[p * planeSize + byteOff]! | mask
    }
  }
  return { planar, planeSize, rowBytes, nPlanes }
}

describe.skipIf(!existsSync(FIXTURES))('the Pac.Pic packer (Pack/Spack, +Compact.s:478)', () => {
  const banks = pacPicBanks()

  it('finds packed pictures in the corpus to test against', () => {
    expect(banks.length).toBeGreaterThan(5)
  })

  it('re-packs every corpus picture to the identical bytes', () => {
    // The real test of an encoder: decode a picture the original Compact
    // extension produced, pack it again and demand the same bytes back —
    // including the square size GetSize settled on and the trailing padding.
    const mismatched: string[] = []
    for (const { path, bank } of banks) {
      const pic = parsePacPic(bank.data)
      const bmpOff = pic.screen ? SCREEN_HEADER_SIZE : 0
      const src = toPlanar(pic.pixels, pic.width, pic.height, pic.nPlanes)
      const repacked = packBitmap(src, pic.x >> 3, pic.y, pic.width >> 3, pic.height)
      const original = bank.data.subarray(bmpOff)
      // the bank may be a couple of bytes longer than the picture (banks are
      // reserved to an even size); compare the packed picture itself
      const same =
        repacked.length <= original.length &&
        repacked.every((b, i) => b === original[i])
      if (!same) mismatched.push(`${path} (${repacked.length} vs ${original.length})`)
    }
    expect(mismatched).toEqual([])
  })

  it('re-packs the screen definition Spack writes in front', () => {
    const withScreen = banks.filter((b) => parsePacPic(b.bank.data).screen !== null)
    expect(withScreen.length).toBeGreaterThan(0)
    for (const { path, bank } of withScreen) {
      const pic = parsePacPic(bank.data)
      const sc = pic.screen!
      const header = packScreen(
        {
          width: sc.width,
          height: sc.height,
          nColors: sc.nColors,
          nPlanes: sc.nPlanes,
          mode: sc.mode,
          awX: sc.awX,
          awY: sc.awY,
          // AWTx/AWTy and AVx/AVy are the display window, which the decoder
          // does not keep — take them from the bank to compare the rest
          awTX: (bank.data[12]! << 8) | bank.data[13]!,
          awTY: (bank.data[14]! << 8) | bank.data[15]!,
          avX: (bank.data[16]! << 8) | bank.data[17]!,
          avY: (bank.data[18]! << 8) | bank.data[19]!,
          palette: sc.palette,
        },
        new Uint8Array(0),
      )
      expect([path, [...header]]).toEqual([path, [...bank.data.subarray(0, SCREEN_HEADER_SIZE)]])
    }
  })
})
