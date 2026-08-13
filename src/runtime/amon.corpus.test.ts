/**
 * AMon's two lookup tables, held to the shipped bytes.
 *
 * `amon.ts` states one of them as a rule and transcribes the other, and the
 * only thing that makes either claim checkable is reading the library back.
 * The arctan table is 2,500 bytes that `floor(degrees(atan2(dx,dy)) *
 * 576/360)` reproduces exactly, so the port computes it; the sine table is 91
 * words that `round(sin(deg) * 65535)` reproduces at 90 of the 91, so the
 * port carries the numbers. Getting that choice the wrong way round would be
 * invisible without this file — a 1-in-65536 error at one angle out of
 * ninety-one is not something a behaviour test would notice.
 *
 * It also pins the zone offsets, which is how the releases were told apart:
 * 1.04 put the two Count Colour words at +$9d4 and pushed the sine table from
 * +$9d4 to +$9e2, and that four-word shift is the ONLY difference between the
 * two libraries' copies of Mul Sin.
 *
 * Reads the corpus at `../amos-files`, which is not part of this repository,
 * so the suite skips when it is absent.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { firstCodeHunk } from '../tokens/libtok'
import { corpusFile, haveCorpus } from '../cli/corpus'
import { extensionById } from '../ext/registry'
import { AMON_SINE, amonAtan } from './amon'

const have = haveCorpus()

/** where each release's routine 0 puts its `lea (pc)`, and where the sine table sits in the zone */
const RELEASES = [
  { id: 'amon-1.04', zone: 0x294, sine: 0x9e2 },
  { id: 'amon-1.03', zone: 0x23c, sine: 0x9d4 },
] as const

// runs at COLLECTION, even under describe.skipIf -- see ../cli/corpus.ts
function codeOf(id: string): Uint8Array | null {
  const ext = extensionById(id)
  if (!ext) return null
  const file = corpusFile(ext.sha256)
  if (file === null) return null
  return firstCodeHunk(new Uint8Array(readFileSync(file)))
}

describe.skipIf(!have)('AMon: the two tables against the shipped libraries', () => {
  for (const r of RELEASES) {
    describe(r.id, () => {
      const code = codeOf(r.id)

      it.skipIf(!code)('carries the sine table this port transcribed, word for word', () => {
        const view = new DataView(code!.buffer, code!.byteOffset, code!.byteLength)
        const got = Array.from({ length: AMON_SINE.length }, (_, i) => view.getUint16(r.zone + r.sine + i * 2, false))
        expect(got).toEqual([...AMON_SINE])
      })

      it.skipIf(!code)('and the table is NOT the rule — 30 degrees is the entry that proves it', () => {
        const rule = (d: number): number => Math.round(Math.sin((d * Math.PI) / 180) * 65535)
        const off = AMON_SINE.map((v, d) => [d, v, rule(d)] as const).filter(([, v, r2]) => v !== r2)
        // one, and it is the exact rounding of 32767.5 that IEEE cannot reach
        expect(off).toEqual([[30, 32768, 32767]])
      })

      it.skipIf(!code)('and the arctan table this port computes, cell for cell', () => {
        const t = amonAtan()
        const bad: string[] = []
        for (let i = 0; i < t.length; i++) {
          if (code![r.zone + i] !== t[i]) bad.push(`${i % 50},${Math.floor(i / 50)}`)
        }
        expect(bad).toEqual([])
      })

      it.skipIf(!code)('576 units to the circle, so a quadrant is 144 and dy=0 is a flat row', () => {
        const t = amonAtan()
        // every cell with dy = 0 is straight across, and the degenerate
        // origin is stored as 144 too rather than left at zero
        for (let dx = 0; dx < 50; dx++) expect(t[dx], `dx=${dx}`).toBe(144)
        expect(t[25 + 25 * 50]).toBe(72) // the 45-degree diagonal, half a quadrant
      })
    })
  }
})
