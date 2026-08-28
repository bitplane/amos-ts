import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseAmosFile } from './amosfile'
import { BITMAP_MAGIC, SCREEN_HEADER_SIZE, SCREEN_MAGIC, packBitmap, packScreen, parsePacPic } from './pacpic'
import type { MemoryBank } from './amosfile'
import { rowBytesFor } from '../amiga/planar'
import { corpusIndex, haveCorpus } from '../cli/corpus'

/**
 * Every .Abk in the CORPUS holding a packed picture.
 *
 * These three tests say "corpus" throughout and used to walk `fixtures/`,
 * which is gitignored, behind `describe.skipIf(!existsSync(FIXTURES))` --- so
 * the only check this port has on its Pac.Pic ENCODER ran nowhere but a
 * machine that had put the files there by hand. The index holds 4,391 .Abk
 * files and answers empty when the corpus is absent, which is the guard the
 * skipIf was reaching for.
 *
 * The filter is the MAGIC and not the bank name. A bank name is eight
 * characters the program picked, and three banks in
 * `aminet-amos-elsewhere/files/RoboDemo/RoboData1.abk` are called
 * "Pac.Pic." while holding something else: 17,276, 16,554 and 17,826 bytes
 * that start $d393bf09, $01a0e95c and $f91f6530, with 249 to 252 distinct
 * values in their first kilobyte. That is crunched data, and `Unpack` would
 * answer "Not a packed bitmap" for all three on the machine. 537 banks
 * carry the name and 534 carry a picture.
 */
function pacPicBanks(): Array<{ path: string; bank: MemoryBank }> {
  const out: Array<{ path: string; bank: MemoryBank }> = []
  for (const p of corpusIndex().values()) {
    if (!p.toLowerCase().endsWith('.abk')) continue
    let banks
    try {
      banks = parseAmosFile(readFileSync(p)).banks
    } catch {
      continue
    }
    for (const b of banks) {
      if (b.kind !== 'memory' || b.data.length < 4) continue
      const magic = ((b.data[0]! << 24) | (b.data[1]! << 16) | (b.data[2]! << 8) | b.data[3]!) >>> 0
      if (magic === BITMAP_MAGIC || magic === SCREEN_MAGIC) out.push({ path: p, bank: b })
    }
  }
  return out
}

/**
 * Rebuild a screen bitmap with this picture sitting at its packed origin.
 *
 * The origin matters. `packWith` reads from `p*planeSize + dy*rowBytes + dx`
 * and ALSO writes dx and dy into the header, so a caller that hands it a
 * buffer holding nothing but the picture and then asks for it at (dx,dy)
 * gets zero-fill from past the end of the buffer --- which is what this
 * harness used to do. Of the 534 packed pictures in the corpus, 502 have
 * dx=0 and dy=0 and round-tripped anyway; the other 32 were being compared
 * against a bitmap they were never packed from.
 */
function toPlanar(pixels: Uint8Array, width: number, height: number, nPlanes: number, dx = 0, dy = 0): {
  planar: Uint8Array
  planeSize: number
  rowBytes: number
  nPlanes: number
} {
  const rowBytes = dx + rowBytesFor(width)
  const planeSize = rowBytes * (dy + height)
  const planar = new Uint8Array(planeSize * nPlanes)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = pixels[y * width + x]!
      if (v === 0) continue
      const byteOff = (dy + y) * rowBytes + dx + (x >> 3)
      const mask = 0x80 >> (x & 7)
      for (let p = 0; p < nPlanes; p++) if (v & (1 << p)) planar[p * planeSize + byteOff] = planar[p * planeSize + byteOff]! | mask
    }
  }
  return { planar, planeSize, rowBytes, nPlanes }
}

/**
 * How far the data stream's cursor lands from PkPoint2, walking the bit
 * streams the way `UnPack_Bitmap` (+Lib.s:25538) does but counting only.
 *
 * Every byte the decoder takes out of PkDatas1 is one the packer put there,
 * so a picture in step ends exactly on PkPoint2 --- which is where the packer
 * stopped writing. This is deliberately its own loop and not parsePacPic's:
 * a decoder cannot check itself.
 */
function streamDrift(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const off = v.getUint32(0) === SCREEN_MAGIC ? SCREEN_HEADER_SIZE : 0
  const tx = v.getUint16(off + 8)
  const ty = v.getUint16(off + 10)
  const tcar = v.getUint16(off + 12)
  const nPlanes = v.getUint16(off + 14)
  const rleOff = off + v.getUint32(off + 16)
  const pointsOff = off + v.getUint32(off + 20)
  let a4 = off + 25 // PkDatas1, past the byte the packer pre-cleared
  let a5 = rleOff
  let a6 = pointsOff
  let rleBit = 7
  let pointsBit = 6
  let rleByte = bytes[a5++] ?? 0
  if ((bytes[a6] ?? 0) & 0x80) rleByte = bytes[a5++] ?? 0
  for (let i = 0; i < nPlanes * ty * tx * tcar; i++) {
    if (((rleByte >> rleBit) & 1) === 1) a4++
    if (--rleBit < 0) {
      rleBit = 7
      if (((bytes[a6] ?? 0) >> pointsBit) & 1) rleByte = bytes[a5++] ?? 0
      if (--pointsBit < 0) {
        pointsBit = 7
        a6++
      }
    }
  }
  return a4 - pointsOff
}

describe.skipIf(!haveCorpus())('the Pac.Pic packer (Pack/Spack, +Compact.s:452)', () => {
  const banks = pacPicBanks()

  it('finds packed pictures in the corpus to test against', () => {
    expect(banks.length).toBeGreaterThan(100)
  })

  it('every picture but one ends its stream exactly on its own PkPoint2', () => {
    // 534 of the 535 do. The one that does not is Mf2titles.abk under
    // TOME4_AMOSPro/...-.extracted/MAGIC_FOREST2/, whose data stream overruns
    // by 4,037 bytes: its header says 320x256 in four planes and its three
    // pointers are inside the bank, but the bit streams do not agree with
    // them. AMOS would unpack it too, and to the same noise --- UnPack_Bitmap
    // checks the magic, the plane count and the fit, and never the pointers.
    // It is a damaged input, so the byte-exact test below leaves it out.
    const drifted = banks.filter(({ bank }) => streamDrift(bank.data) !== 0)
    expect(drifted.map(({ path }) => path.split('/').pop())).toEqual(['Mf2titles.abk'])
    expect(banks.length - drifted.length).toBeGreaterThan(500)
  })

  it('re-packs every corpus picture to the identical bytes', () => {
    // The real test of an encoder: decode a picture the original Compact
    // extension produced, pack it again and demand the same bytes back ---
    // including the square size GetSize settled on and the trailing padding.
    //
    // One byte can differ, and it is the defect marked in `packWith`. Pack sizes
    // the intermediate flag table `(tcar*tx*ty*nplan)/8 + 2` bytes and takes
    // it from MemFast (+Compact.s:467-479), which does not clear it. The
    // packing loop clears each byte as it reaches it and the wrap past the
    // last bit clears one more, so every byte but the LAST is defined --- and
    // that last one is then compressed along with the rest at :551. A
    // non-zero value there sets one extra bit in the stored bit table and
    // appends one byte to the second data stream. It is the Amiga's free
    // memory, arriving in a saved file: 30 of the 534 pictures here carry a
    // non-zero one, and the byte is always at PkPoint2 + (interSize-1)/8.
    const mismatched: string[] = []
    let identical = 0
    let leaked = 0
    for (const { path, bank } of banks) {
      if (streamDrift(bank.data) !== 0) continue
      const pic = parsePacPic(bank.data)
      const bmpOff = pic.screen ? SCREEN_HEADER_SIZE : 0
      const src = toPlanar(pic.pixels, pic.width, pic.height, pic.nPlanes, pic.x >> 3, pic.y)
      const repacked = packBitmap(src, pic.x >> 3, pic.y, pic.width >> 3, pic.height)
      const original = bank.data.subarray(bmpOff)
      // the bank may be a couple of bytes longer than the picture (banks are
      // reserved to an even size); compare the packed picture itself
      if (repacked.length > original.length) {
        mismatched.push(`${path} (${repacked.length} vs ${original.length})`)
        continue
      }
      const v = new DataView(repacked.buffer)
      const interSize =
        ((v.getUint16(12) * v.getUint16(8) * v.getUint16(10) * v.getUint16(14)) >>> 3) + 2
      const leak = v.getUint32(20) + ((interSize - 1) >>> 3)
      const extra = 1 << (7 - ((interSize - 1) & 7))
      const diffs: number[] = []
      for (let i = 0; i < repacked.length; i++) if (repacked[i] !== original[i]) diffs.push(i)
      if (diffs.length === 0) {
        identical++
        continue
      }
      // the leaked byte, and the one data-stream byte it adds at the end
      const explained =
        diffs.every((i) => i === leak || i >= repacked.length - 2) &&
        (!diffs.includes(leak) || original[leak] === (repacked[leak]! | extra))
      if (explained) leaked++
      else mismatched.push(`${path} (${diffs.length} bytes from ${diffs[0]}, leak at ${leak})`)
    }
    expect(mismatched).toEqual([])
    // pinned so that a change which merely widened the tolerance still fails
    expect(identical).toBeGreaterThan(500)
    expect(leaked).toBeGreaterThan(20)
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
