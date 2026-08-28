/**
 * The PSID header, against `CheckModule` and against the one real module.
 *
 * The module is bank 3 of DME 2.0's own `PlaySid_Example.amos`, named "PSid"
 * and 38,054 bytes, reached by sha256 out of the corpus because a third-party
 * module is not ours to keep in the tree. It is Matt Gray's "Last Ninja 2",
 * which is a useful accident: twelve songs, so the song-count paths have
 * something to refuse past the end of.
 *
 * The synthetic headers below check `CheckModule`'s three tests, and they are
 * built here because what they check is the arithmetic at $2102f2 rather than
 * any file.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { describeWith } from '../testing/fixture'
import { parseAmosFile } from '../loader/amosfile'
import { corpusFile, haveCorpus } from '../cli/corpus'
import { PSID_HEADER_SIZE, checkPsid, parsePsid, psidSongUsesCia } from './psid'

/** sources/kyzer-dme/files/amospro_dme_v2.0/examples/PlaySid_Example.amos */
const EXAMPLE = 'e8eac620ee8442a237deb7e0d6e5df67d2ddc82f182900e0c291b4af9461e9e9'

function exampleBank(): Uint8Array | null {
  if (!haveCorpus()) return null
  const path = corpusFile(EXAMPLE)
  if (!path) return null
  const file = parseAmosFile(new Uint8Array(readFileSync(path)))
  const found = file?.banks.find((b) => 'data' in b && (b as { number?: number }).number === 3)
  return found && 'data' in found ? (found.data as Uint8Array) : null
}

/** A minimal version 2 header, which every test below then breaks one field of. */
function header(over: Partial<Record<string, number>> = {}): Uint8Array {
  const b = new Uint8Array(PSID_HEADER_SIZE + 16)
  const w = (at: number, v: number): void => {
    b[at] = (v >> 8) & 0xff
    b[at + 1] = v & 0xff
  }
  b.set([0x50, 0x53, 0x49, 0x44], 0) // 'PSID'
  w(4, over.version ?? 2)
  w(6, over.dataOffset ?? PSID_HEADER_SIZE)
  w(8, over.loadAddress ?? 0x1000)
  w(0x0a, over.initAddress ?? 0x1000)
  w(0x0c, over.playAddress ?? 0x1003)
  w(0x0e, over.songs ?? 3)
  w(0x10, over.defaultSong ?? 1)
  w(0x76, over.flags ?? 0)
  return b
}

describe('CheckModule, $2102f2', () => {
  it('accepts a plain version 2 header', () => {
    expect(checkPsid(header())).toBe(true)
  })

  it('refuses a null pointer rather than reading through it', () => {
    // `move.l a0,d0 / beq $210314` is the first instruction of the routine.
    expect(checkPsid(null)).toBe(false)
    expect(checkPsid(undefined)).toBe(false)
  })

  it('refuses anything whose first long is not PSID', () => {
    const b = header()
    b[0] = 0x52 // 'R', for the RSID variant the library predates
    expect(checkPsid(b)).toBe(false)
  })

  it('refuses a data offset past the header, which is $7c and not a round number', () => {
    // `cmp.w #$7c,d0 / bhi` at $210302. $7c is `sizeof(SIDHeader)` exactly.
    expect(checkPsid(header({ dataOffset: PSID_HEADER_SIZE }))).toBe(true)
    expect(checkPsid(header({ dataOffset: PSID_HEADER_SIZE + 1 }))).toBe(false)
  })

  it('accepts versions 1 and 2 and refuses 3', () => {
    // `cmpi.w #$2,$4(a0) / bhi` at $210308.
    expect(checkPsid(header({ version: 1 }))).toBe(true)
    expect(checkPsid(header({ version: 2 }))).toBe(true)
    expect(checkPsid(header({ version: 3 }))).toBe(false)
  })

  it('says nothing about the song count, which StartSong refuses later', () => {
    // The routine never reads $0e, so a header claiming forty songs over an
    // empty body passes here and fails at $21038e with SID_NOSONG.
    expect(checkPsid(header({ songs: 40 }))).toBe(true)
  })
})

describe('the header fields', () => {
  it('reads flags only at version 2, because $21035c branches around it', () => {
    expect(parsePsid(header({ version: 2, flags: 1 }))!.flags).toBe(1)
    expect(parsePsid(header({ version: 1, flags: 1 }))!.flags).toBe(0)
  })

  it('is big-endian throughout', () => {
    const h = parsePsid(header({ loadAddress: 0x1234, initAddress: 0xabcd }))!
    expect(h.loadAddress).toBe(0x1234)
    expect(h.initAddress).toBe(0xabcd)
  })
})

describe('the speed bitmap, $2103d2', () => {
  it('is one bit per song, and clear means the raster', () => {
    const h = parsePsid(header())!
    h.speed = 0b0110
    expect(psidSongUsesCia(h, 0)).toBe(false)
    expect(psidSongUsesCia(h, 1)).toBe(true)
    expect(psidSongUsesCia(h, 2)).toBe(true)
    expect(psidSongUsesCia(h, 3)).toBe(false)
  })

  it('wraps at 32, because `btst.l` on a register is modulo 32', () => {
    const h = parsePsid(header())!
    h.speed = 1
    expect(psidSongUsesCia(h, 0)).toBe(true)
    expect(psidSongUsesCia(h, 32)).toBe(true)
  })
})

describeWith('DME 2.0\'s own PlaySid module', exampleBank(), (bank) => {
  const h = parsePsid(bank)!

  it('is a version 2 PSID whose data starts at the end of the header', () => {
    expect(checkPsid(bank)).toBe(true)
    expect(h.version).toBe(2)
    expect(h.dataOffset).toBe(PSID_HEADER_SIZE)
  })

  it('is Matt Gray\'s Last Ninja 2, in three 32-byte fields', () => {
    expect(h.name).toBe('Last Ninja 2')
    expect(h.author).toBe('Matt Gray')
    expect(h.copyright).toBe('1988 System 3')
  })

  it('has twelve songs, and =Sid Songs reads the low byte of that', () => {
    expect(h.songs).toBe(12)
    // Routine 268 reads $0f, so the two agree only while the count is small.
    expect(bank[0x0f]).toBe(12)
  })

  it('names both entry points, so neither of the zero rules applies to it', () => {
    // $2107a0 and $2107c0 are the load-address-from-data and init-equals-load
    // fallbacks; this module needs neither.
    expect(h.loadAddress).not.toBe(0)
    expect(h.initAddress).not.toBe(0)
    expect(h.playAddress).not.toBe(0)
  })

  it('is a raster tune: every one of its twelve songs has its speed bit clear', () => {
    expect(h.speed).toBe(0)
    for (let i = 0; i < h.songs; i++) expect(psidSongUsesCia(h, i)).toBe(false)
  })
})
