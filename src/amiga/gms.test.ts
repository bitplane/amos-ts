/**
 * The recorded GMS tables against the modules themselves.
 *
 * `./gms.ts` writes down what `fixtures/gms/` says, and `fixtures/` is
 * gitignored — so without this the tables are a transcription nobody checks.
 * The walk here is the one that produced them: a module header points at a
 * list of {code, name} pairs, the names carry their own register signatures,
 * and the list ends at a null pair.
 *
 * Skipped where the fixtures are absent, as the ADF, diskfont and citation
 * tests are. That is a real limitation and the same one they carry: the check
 * runs for whoever has the material, which is whoever could act on a failure.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadHunks } from './hunk'
import {
  GMS_BLITTER_LVO,
  GMS_COLOURS_LVO,
  GMS_MODULES,
  GMS_MOD_BLITTER,
  GMS_MOD_COLOURS,
  GMS_MOD_SCREENS,
  GMS_MOD_SOUND,
  GMS_SCREENS_LVO,
  gmsEntry,
  gmsLvo,
} from './gms'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const GMS = join(root, 'fixtures', 'gms')
const mod = (name: string): string => join(GMS, 'System', `${name}.mod`)

/**
 * A module's `struct Function` list, as names. The header sits at the top of
 * the first hunk — `MOD` and a version byte — and carries the list pointer at
 * +24, which is where its own published source puts it.
 */
function functionList(file: string): string[] {
  const l = loadHunks(new Uint8Array(readFileSync(file)))
  const img = l.image
  const dv = new DataView(img.buffer, img.byteOffset, img.byteLength)
  expect(String.fromCharCode(img[0]!, img[1]!, img[2]!)).toBe('MOD')
  const str = (addr: number): string => {
    let s = ''
    for (let i = addr - l.base; i < img.length && img[i] !== 0; i++) s += String.fromCharCode(img[i]!)
    return s
  }
  const out: string[] = []
  for (let p = dv.getUint32(24, false) - l.base; ; p += 8) {
    const code = dv.getUint32(p, false)
    const name = dv.getUint32(p + 4, false)
    if (code === 0 || name === 0) break
    out.push(str(name))
    expect(out.length).toBeLessThan(200)
  }
  return out
}

describe('the LVO arithmetic', () => {
  it('is 1-based and six bytes apart', () => {
    expect(gmsLvo(0)).toBe(-6)
    expect(gmsLvo(4)).toBe(-30)
  })

  it('names an entry from its LVO, and nothing from a bad one', () => {
    expect(gmsEntry(GMS_COLOURS_LVO, -6)).toMatch(/^BlurArea\(/)
    expect(gmsEntry(GMS_COLOURS_LVO, -30)).toMatch(/^CopyPalette\(/)
    expect(gmsEntry(GMS_COLOURS_LVO, -7)).toBeUndefined()
    expect(gmsEntry(GMS_COLOURS_LVO, 6)).toBeUndefined()
    expect(gmsEntry(GMS_COLOURS_LVO, -6000)).toBeUndefined()
  })

  /** the four TGE opens, by their position in dpkernel's own table */
  it('numbers the modules TGE opens', () => {
    expect(GMS_MODULES[GMS_MOD_BLITTER - 1]).toBe('blitter')
    expect(GMS_MODULES[GMS_MOD_SOUND - 1]).toBe('sound')
    expect(GMS_MODULES[GMS_MOD_SCREENS - 1]).toBe('screens')
    expect(GMS_MODULES[GMS_MOD_COLOURS - 1]).toBe('colours')
    expect(GMS_MODULES).toHaveLength(20)
  })
})

describe.skipIf(!existsSync(GMS))('the recorded tables match the modules', () => {
  it.each([
    ['screens', GMS_SCREENS_LVO],
    ['blitter', GMS_BLITTER_LVO],
    ['colours', GMS_COLOURS_LVO],
  ])('%s.mod', (name, recorded) => {
    expect(functionList(mod(name))).toEqual([...recorded])
  })

  /**
   * The `.ref` files each state their own `ModNumber`, which is a second and
   * independent source for the numbering — dpkernel's name run is the first.
   */
  it('agrees with every .ref file about its module number', () => {
    const refs = join(GMS, 'System', 'References')
    if (!existsSync(refs)) return
    const checked: string[] = []
    for (const [file, expected] of [
      ['bitmap.ref', 'blitter'],
      ['sound.ref', 'sound'],
      ['screen.ref', 'screens'],
      ['cardset.ref', 'cards'],
      ['objectfile.ref', 'objects'],
      ['joydata.ref', 'joyports'],
      ['segment.ref', 'files'],
      ['keyboard.ref', 'keyboard'],
      ['picture.ref', 'pictures'],
      ['music.ref', 'music'],
    ] as const) {
      const path = join(refs, file)
      if (!existsSync(path)) continue
      const text = readFileSync(path, 'latin1')
      const n = Number(/ModNumber\s*=\s*(\d+)/.exec(text)?.[1])
      expect(GMS_MODULES[n - 1], file).toBe(expected)
      checked.push(file)
    }
    expect(checked.length).toBeGreaterThan(0)
  })

  /**
   * The keywords already ported reach these three, and a wrong LVO here would
   * be a wrong reading in thegame.ts. `=G Blur` is the one that can be
   * checked against published source at both ends.
   */
  it('names the entries thegame.ts cites', () => {
    expect(gmsEntry(GMS_COLOURS_LVO, -0x06)).toMatch(/^BlurArea\(a0l,d0w,d1w,d2w,d3w,d4w\)$/)
    expect(gmsEntry(GMS_COLOURS_LVO, -0x1e)).toMatch(/^CopyPalette\(/)
    expect(gmsEntry(GMS_SCREENS_LVO, -0x1e)).toBe('ChangeColours')
    expect(gmsEntry(GMS_SCREENS_LVO, -0x8a)).toBe('UpdateColour')
    expect(gmsEntry(GMS_SCREENS_LVO, -0x90)).toBe('UpdatePalette')
    expect(gmsEntry(GMS_BLITTER_LVO, -0xc0)).toMatch(/^SetRGBPen\(a0l,d0l\)$/)
  })
})
