import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { ICON_MAGIC, ICON_VERSION, iconToolTypes } from './icon'

describe('iconToolTypes: what is not an icon', () => {
  it('rejects anything without the $E310 magic, and anything too short', () => {
    expect(iconToolTypes(new Uint8Array(0))).toBeNull()
    expect(iconToolTypes(new Uint8Array(200))).toBeNull() // all zero: no magic
    const short = new Uint8Array(40)
    new DataView(short.buffer).setUint16(0, ICON_MAGIC)
    expect(iconToolTypes(short)).toBeNull()
  })

  it('requires WB_DISKVERSION 1 as icon.library 34.2 does', () => {
    const b = new Uint8Array(78)
    const dv = new DataView(b.buffer)
    dv.setUint16(0, ICON_MAGIC)
    expect(iconToolTypes(b)).toBeNull()
    dv.setUint16(2, ICON_VERSION)
    expect(iconToolTypes(b)).toEqual([])
    dv.setUint16(2, 2)
    expect(iconToolTypes(b)).toBeNull()
  })

  it('a truncated icon is null, not an icon with no tool types', () => {
    // magic and a non-zero do_ToolTypes, but the file stops before the array
    const b = new Uint8Array(78)
    const dv = new DataView(b.buffer)
    dv.setUint16(0, ICON_MAGIC)
    dv.setUint16(2, ICON_VERSION)
    dv.setUint32(0x36, 0x1234)
    expect(iconToolTypes(b)).toBeNull()
  })

  it('a DiskObject with a null do_ToolTypes has none, which is not the same as null', () => {
    const b = new Uint8Array(78)
    const dv = new DataView(b.buffer)
    dv.setUint16(0, ICON_MAGIC)
    dv.setUint16(2, ICON_VERSION)
    expect(iconToolTypes(b)).toEqual([])
  })
})

/**
 * The real proof. A hand-built icon would only show that this reader agrees
 * with whatever built it; these are icons written by Workbench on real Amigas,
 * shipped on the AMOS discs and the PD library CD.
 */
const CORPUS = '/home/gaz/src/tmp/amos'
// the paths come back as raw BYTES and are not all UTF-8 -- the archive has
// AmigaDOS filenames in latin-1 ("PW_Fran\xe7ais.guide.info"), which decoding
// as UTF-8 would corrupt into a path that no longer opens
const icons: Buffer[] = existsSync(CORPUS)
  ? execSync(`find ${CORPUS} -iname '*.info' -not -name '.info' 2>/dev/null | head -4000`, { maxBuffer: 1 << 28 })
      .toString('latin1')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((f) => Buffer.from(f, 'latin1'))
  : []

describe.skipIf(icons.length < 100)('against real Workbench icons', () => {
  it('walks essentially every icon in the archive', () => {
    let decoded = 0
    let rejected = 0
    for (const f of icons) {
      const t = iconToolTypes(new Uint8Array(readFileSync(f)))
      if (t === null) rejected++
      else decoded++
    }
    // the walk is exact or it is not: a wrong image or string size desynchronises
    // the whole chain and shows up as a rejection, so a high pass rate over
    // thousands of independently written files is the check
    expect(decoded / (decoded + rejected)).toBeGreaterThan(0.99)
  })

  it('reads the tool types Workbench actually wrote', () => {
    const found = new Map<string, string[]>()
    for (const f of icons) {
      const t = iconToolTypes(new Uint8Array(readFileSync(f)))
      if (t?.length) found.set(f.toString('latin1').split('/').pop()!, t)
    }
    expect(found.size).toBeGreaterThan(100)

    // FILETYPE= is the commonest real tool type in this archive, and it is
    // plain ASCII, so a mis-walk cannot produce it by accident
    const filetypes = [...found.values()].flat().filter((t) => t.startsWith('FILETYPE='))
    expect(filetypes.length).toBeGreaterThan(50)

    // every string is NUL-terminated within its count, so none may contain one
    for (const [name, types] of found) for (const t of types) expect(`${name}:${t.includes('\0')}`).toContain(':false')
  })
})
