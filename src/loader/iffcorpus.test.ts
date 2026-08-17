import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseIlbm, encodeIlbm } from '../amiga/ilbm'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures')

function* walk(p: string): Generator<string> {
  for (const e of readdirSync(p)) {
    const f = join(p, e)
    if (statSync(f).isDirectory()) yield* walk(f)
    else if (/\.(iff|ilbm|pic)$/i.test(f)) yield f
  }
}

const files = existsSync(fixtures) ? [...walk(fixtures)] : []

/**
 * The 68k loader's own structural rules (IffForm* +Lib.s:6861-7500): a row is
 * padded to a whole word, planes are stored one after another per row, and
 * BODY must supply exactly rowBytes * planes bytes for every row. Anything
 * that decodes to a different size means our ByteRun1 unpacker drifted, which
 * is the failure a "renders fine by eye" check would never catch.
 */
describe.skipIf(files.length === 0)('every IFF picture in the corpus decodes exactly', () => {
  it('has pictures to check', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  for (const f of files) {
    const name = f.slice(fixtures.length + 1)
    it(`decodes ${name}`, () => {
      const img = parseIlbm(readFileSync(f))
      // A palette-only ILBM is a real thing in this corpus: the Plasma
      // procedures ship BMHD 0x0 with 0 planes and nothing but a CMAP, to
      // hand a program a palette without an image. It must decode to an
      // empty picture with its colours intact, not be mistaken for damage.
      if (img.width === 0) {
        expect(img.height).toBe(0)
        expect(img.depth).toBe(0)
        expect(img.pixels.length).toBe(0)
        expect(img.palette.length).toBeGreaterThan(0)
        return
      }
      expect(img.height, 'height').toBeGreaterThan(0)
      expect(img.depth, 'depth').toBeGreaterThan(0)
      expect(img.depth, 'depth').toBeLessThanOrEqual(8)
      // the chunky buffer is exactly one byte per pixel, fully populated
      expect(img.pixels.length).toBe(img.width * img.height)
      // every pixel index is representable in the declared plane count. HAM
      // and EHB use the extra planes as control bits, so allow the full 8.
      const ham = (img.mode & 0x800) !== 0
      const ehb = (img.mode & 0x80) !== 0
      const max = ham || ehb ? 255 : (1 << img.depth) - 1
      let worst = 0
      for (const p of img.pixels) if (p > worst) worst = p
      expect(worst, 'largest pixel index').toBeLessThanOrEqual(max)
      // the palette covers the planes (EHB declares 32 and mirrors to 64)
      if (!ham) expect(img.palette.length).toBeGreaterThanOrEqual(Math.min(1 << img.depth, 32))
      for (const c of img.palette) expect(c & ~0xfff).toBe(0) // RGB4 only
    })
  }

  // 20 seconds rather than the default five: this decodes, re-encodes and
  // re-decodes every picture in the corpus, which is ~1.5s on an idle machine
  // and several times that when the rest of the suite is running beside it.
  // It was inside the default budget by luck and started timing out when the
  // suite grew; the work it does has not changed.
  it('round-trips every picture through our own encoder', () => {
    // encodeIlbm is the inverse of parseIlbm; if the unpacker drifted, a
    // re-encode/re-decode would not land back on the same pixels
    for (const f of files) {
      const a = parseIlbm(readFileSync(f))
      if (a.width === 0) continue // palette-only, no BODY to round-trip
      const b = parseIlbm(encodeIlbm(a))
      expect(b.width, f).toBe(a.width)
      expect(b.height, f).toBe(a.height)
      expect(b.depth, f).toBe(a.depth)
      expect(Array.from(b.pixels), f).toEqual(Array.from(a.pixels))
      expect(b.palette.slice(0, a.palette.length), f).toEqual(a.palette)
    }
  }, 20_000)
})
