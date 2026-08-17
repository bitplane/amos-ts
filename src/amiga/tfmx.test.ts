/**
 * The TFMX container and mdat, against bank 3 of `TFMX_Example.amos`.
 *
 * The container is DOOM Productions' own, because TFMX ships as two files and
 * an AMOS bank holds one. Everything inside it is Chris Hülsbeck's.
 */
import { describe, expect, it } from 'vitest'
import { describeWith } from '../testing/fixture'
import { readFileSync } from 'node:fs'
import { parseAmosFile } from '../loader/amosfile'
import { corpusFile, haveCorpus } from '../cli/corpus'
import {
  TFHD_MAGIC,
  TFMX_DEFAULT_MACROS,
  TFMX_DEFAULT_PATTERNS,
  TFMX_DEFAULT_TRACKSTEP,
  TFMX_SONGSTART_AT,
  TFMX_TABLES_AT,
  TFMX_TEXT_AT,
  countSubsongs,
  hasTfmxBanner,
  parseTfmx,
} from './tfmx'

/** sources/kyzer-dme/files/amospro_dme_v2.0/examples/TFMX_Example.amos */
const EXAMPLE = 'c5ba5d261a9aa19e275618f3b2b4b4072bed2dcc6ed6beb7cf9ce245e2196231'

function fixture(): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync('fixtures/modules/dme/tfmx.tfm'))
  } catch {
    return null
  }
}

describe('the TFHD container', () => {
  const stub = (mdat: Uint8Array, type = 0): Uint8Array => {
    const out = new Uint8Array(0x12 + mdat.length)
    for (const [i, c] of [...TFHD_MAGIC].entries()) out[i] = c.charCodeAt(0)
    out[7] = 0x12
    out[8] = type
    out[0xd] = mdat.length & 0xff
    out[0xc] = (mdat.length >> 8) & 0xff
    out.set(mdat, 0x12)
    return out
  }
  const banner = (): Uint8Array => {
    const m = new Uint8Array(0x200)
    for (const [i, c] of [...'TFMX-SONG '].entries()) m[i] = c.charCodeAt(0)
    return m
  }

  it('wants "TFHD" and nothing else at the top', () => {
    expect(parseTfmx(new Uint8Array(0x400))).toBeNull()
    expect(parseTfmx(stub(banner()))).not.toBeNull()
  })

  it('checks the banner on type 0 and RELABELS rather than refusing', () => {
    // $48d8 masks the type; $48fc only runs for type 0, and $491a writes a 1
    // into $ca(a2) whether the test passed or not
    const junk = new Uint8Array(0x200)
    expect(parseTfmx(stub(junk, 0))?.label).toBe(1)
    expect(parseTfmx(stub(banner(), 0))?.label).toBe(0)
    expect(parseTfmx(stub(junk, 1))?.label).toBe(1)
    expect(parseTfmx(stub(junk, 2))?.label).toBe(1)
    // only a type outside 0..2 is message 29
    expect(parseTfmx(stub(junk, 3))).toBeNull()
  })

  it('masks the type to seven bits, so $82 is still a type 2', () => {
    expect(parseTfmx(stub(new Uint8Array(0x200), 0x82))?.type).toBe(0x82)
    expect(parseTfmx(stub(new Uint8Array(0x200), 0x83))).toBeNull()
  })

  it('builds "SONG" out of bytes 5 to 8, skipping the hyphen', () => {
    const m = banner()
    expect(hasTfmxBanner(m)).toBe(true)
    // the hyphen at 4 is never compared, so any byte does
    m[4] = '?'.charCodeAt(0)
    expect(hasTfmxBanner(m)).toBe(true)
    m[5] = 'X'.charCodeAt(0)
    expect(hasTfmxBanner(m)).toBe(false)
  })

  it('falls back to $800, $400 and $600 when $1d0 is zero', () => {
    const m = banner()
    const old = parseTfmx(stub(m, 1))!
    expect(old.explicit).toBe(false)
    expect([old.tracksteps, old.patterns, old.macros]).toEqual([
      TFMX_DEFAULT_TRACKSTEP,
      TFMX_DEFAULT_PATTERNS,
      TFMX_DEFAULT_MACROS,
    ])
    m[TFMX_TABLES_AT + 3] = 0x40
    const now = parseTfmx(stub(m, 1))!
    expect(now.explicit).toBe(true)
    expect(now.tracksteps).toBe(0x40)
  })
})

describe('the subsong walk at $2101e8', () => {
  const table = (words: number[]): Uint8Array => {
    const m = new Uint8Array(0x200)
    for (const [i, w] of words.entries()) {
      m[TFMX_SONGSTART_AT + i * 2] = (w >> 8) & 0xff
      m[TFMX_SONGSTART_AT + i * 2 + 1] = w & 0xff
    }
    return m
  }

  it('counts a table that ends in two zeroes correctly', () => {
    // which is the case it was written for, and the only one it gets right
    expect(countSubsongs(table([1, 2, 3, 0, 0]))).toBe(3)
    expect(countSubsongs(table([7, 0, 0]))).toBe(1)
  })

  it('is one less than the index of the second zero, whatever that means', () => {
    // moveq #$fe,d0 starts at minus two and addq runs before each test
    expect(countSubsongs(table([0, 0]))).toBe(0)
    expect(countSubsongs(table([1, 1, 1, 1, 0, 0]))).toBe(4)
  })

  it('stops at a zero in the middle, however many songs follow it', () => {
    expect(countSubsongs(table([5, 0, 7, 8, 9, 0, 11, 12]))).toBe(4)
  })

  it('gives up after 31 words when the second zero never comes', () => {
    expect(countSubsongs(table([...Array(32)].map(() => 9)))).toBe(29)
  })
})

const data = fixture()

describeWith('the module in fixtures', data, (mod) => {
  const song = parseTfmx(mod)!

  it('is a type 2 of 138,280 bytes: 9,712 of music and 128,542 of samples', () => {
    expect(mod.length).toBe(138280)
    expect(song.type).toBe(2)
    expect(song.mdat).toHaveLength(9712)
    expect(song.smpl).toHaveLength(128542)
    // eight bytes of the bank are past the end of both
    expect(18 + song.mdat.length + song.smpl.length).toBe(mod.length - 8)
  })

  it('carries the newer three-offset layout', () => {
    expect(song.explicit).toBe(true)
    expect([song.tracksteps, song.patterns, song.macros]).toEqual([0x308, 0x23d8, 0x24f0])
    // the three tables run to the end of the mdat and do not overlap
    expect(song.tracksteps).toBeLessThan(song.patterns)
    expect(song.patterns).toBeLessThan(song.macros)
    expect(song.macros).toBeLessThan(song.mdat.length)
  })

  it('keeps the author\'s two lines, spaces and all', () => {
    expect(song.text[0]).toBe('Date : 30.11.91                         ')
    expect(song.text[1]).toBe('Time : 01:36                            ')
    expect(song.text.slice(2).every((l) => l.trim() === '')).toBe(true)
    expect(song.mdat[TFMX_TEXT_AT]).toBe('D'.charCodeAt(0))
  })

  it('is counted as SEVEN subsongs though its table holds more', () => {
    expect(song.start.slice(0, 8)).toEqual([2, 46, 0, 1, 51, 60, 76, 76])
    expect(song.start[8]).toBe(0)
    // the zero at index 2 is the first of the two the walk is looking for
    expect(song.subsongs).toBe(7)
  })

  it('has every subsong end at or after it starts', () => {
    for (let i = 0; i < song.subsongs; i++) expect(song.end[i]).toBeGreaterThanOrEqual(song.start[i]!)
  })
})

describe.skipIf(!haveCorpus() || !data)('against the corpus copy', () => {
  it('is the same bytes the fixture holds', () => {
    const path = corpusFile(EXAMPLE)
    if (!path) return
    const file = parseAmosFile(new Uint8Array(readFileSync(path)))
    const bank = file?.banks.find((b) => 'data' in b && (b as { number?: number }).number === 3)
    expect(bank && 'data' in bank ? [...(bank.data as Uint8Array)] : null).toEqual([...data!])
  })
})
