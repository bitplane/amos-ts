/**
 * The ScreamTracker 3 format, against bank 3 of `ScreamTracker_Example.amos`.
 *
 * The first DOS format here, so the checks that matter are the ones a
 * big-endian reader gets wrong: every word is little-endian, every pointer is
 * in sixteen-byte paragraphs, and the order table is padded to even before the
 * two pointer tables start.
 */
import { describe, expect, it } from 'vitest'
import { describeWith } from '../testing/fixture'
import { readFileSync } from 'node:fs'
import { parseAmosFile } from '../loader/amosfile'
import { corpusFile, haveCorpus } from '../cli/corpus'
import {
  S3M_CHANNEL_OFF,
  S3M_DEFAULT_SPEED,
  S3M_DEFAULT_TEMPO,
  S3M_MAGIC,
  S3M_MAGIC_AT,
  S3M_MIN_TEMPO,
  S3M_ORDERS_AT,
  S3M_ROWS,
  parseS3m,
} from './s3m'

/** sources/kyzer-dme/files/amospro_dme_v2.0/examples/ScreamTracker_Example.amos */
const EXAMPLE = '70b76be108ab6d3dc66971dc819735253bfa66dd5285d286899fbcfbae2f5474'

function fixture(): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync('fixtures/modules/dme/st.s3m'))
  } catch {
    return null
  }
}

/** the corpus copy, so the fixture can be re-taken if it ever drifts */
function corpusBank(): Uint8Array | null {
  if (!haveCorpus()) return null
  const path = corpusFile(EXAMPLE)
  if (!path) return null
  const file = parseAmosFile(new Uint8Array(readFileSync(path)))
  const found = file?.banks.find((b) => 'data' in b && (b as { number?: number }).number === 3)
  return found && 'data' in found ? (found.data as Uint8Array) : null
}

describe('the header', () => {
  const stub = (): Uint8Array => {
    const d = new Uint8Array(0x400)
    for (const [i, c] of [...S3M_MAGIC].entries()) d[S3M_MAGIC_AT + i] = c.charCodeAt(0)
    return d
  }

  it('wants "SCRM" at $2c, which is the only thing the extension checks', () => {
    expect(parseS3m(new Uint8Array(0x400))).toBeNull()
    expect(parseS3m(stub())).not.toBeNull()
  })

  it('defaults a zero speed to six and a tempo of 32 or less to 125', () => {
    // $2117d8 and $2117e8, and the tempo test is `bhi` so 32 itself defaults
    const d = stub()
    expect(parseS3m(d)!.speed).toBe(S3M_DEFAULT_SPEED)
    expect(parseS3m(d)!.tempo).toBe(S3M_DEFAULT_TEMPO)
    d[0x31] = 3
    d[0x32] = S3M_MIN_TEMPO
    expect(parseS3m(d)!.speed).toBe(3)
    expect(parseS3m(d)!.tempo).toBe(S3M_DEFAULT_TEMPO)
    d[0x32] = S3M_MIN_TEMPO + 1
    expect(parseS3m(d)!.tempo).toBe(S3M_MIN_TEMPO + 1)
  })

  it('reads every word LITTLE-endian, which is what the ror.w chain undoes', () => {
    const d = stub()
    d[0x20] = 2 // two orders, low byte first
    d[0x21] = 0
    d[0x22] = 1 // one instrument
    expect(parseS3m(d)!.orders).toHaveLength(2)
    // a big-endian reader would see 512 orders here
    d[0x20] = 0
    d[0x21] = 2
    expect(parseS3m(d)!.orders).toHaveLength(512)
  })

  it('pads an ODD order count before the two pointer tables', () => {
    // $21179c: `d1 = d0 & 1 / d0 += d1`, so three orders occupy four bytes
    const d = stub()
    d[0x20] = 3
    d[0x22] = 1
    // the instrument pointer lands at $60 + 4, not $60 + 3
    d[S3M_ORDERS_AT + 4] = 0x10 // paragraph $10 = byte $100
    d[0x100 + 0x1c] = 40 // its volume
    expect(parseS3m(d)!.samples[0]!.volume).toBe(40)
  })
})

const data = fixture()

describeWith('the module in fixtures', data, (mod) => {
  const song = parseS3m(mod)!

  it('is "Aryx by Kuki": 44 orders, 9 instruments, 12 patterns', () => {
    expect(mod.length).toBe(20808)
    expect(song.name).toBe('Aryx by Kuki')
    expect(song.orders).toHaveLength(44)
    expect(song.samples).toHaveLength(9)
    expect(song.patterns).toHaveLength(12)
    expect(song.speed).toBe(2)
    expect(song.tempo).toBe(95)
  })

  it('enables TWELVE channels, which is why this format needs a mixer', () => {
    expect(song.channels).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    // the rest of the 32 are switched off with $ff
    expect(mod[0x40 + 12]).toBe(S3M_CHANNEL_OFF)
  })

  it('accounts for the sample data, eleven bytes short of the file', () => {
    let last = 0
    for (const s of song.samples) last = Math.max(last, s.pcm.length)
    const used = song.samples.reduce((a, s) => a + s.pcm.length, 0)
    expect(used).toBe(5131)
    expect(last).toBeGreaterThan(0)
    // the paragraph pointers put the final sample eleven bytes from the end
    expect(song.samples.filter((s) => s.pcm.length > 0)).toHaveLength(8)
  })

  it('converts unsigned sample bytes, because Paula has no unsigned mode', () => {
    expect(song.sampleFormat).toBe(2)
    // an unsigned file's silence is $80, which must come out as zero
    const raw = mod
    const anyLoud = song.samples.some((s) => [...s.pcm].some((b) => b < 0))
    expect(anyLoud).toBe(true)
    expect(raw[0x2a]).toBe(2)
  })

  it('leaves every looping sample already equal to its loop end', () => {
    // so $211824's overwrite is a no-op here and this module cannot show it
    for (const s of song.samples) {
      if (!s.loops) continue
      expect(s.length).toBe(s.loopEnd)
      expect(s.loopStart).toBeLessThan(s.loopEnd)
    }
  })

  it('unpacks 64 rows of twelve from every pattern', () => {
    for (const p of song.patterns) {
      expect(p).toHaveLength(S3M_ROWS)
      // 32 wide, because the lead byte names a raw channel and can skip
      for (const r of p) expect(r).toHaveLength(32)
    }
  })

  it('reads the packed cell: a lead byte, then only the fields it flags', () => {
    // pattern 3 row 0 channel 0 is C-4 on instrument 1, volume 20, A02
    const c = song.patterns[3]![0]![0]!
    expect(c).toEqual({ note: 48, instrument: 1, volume: 20, command: 1, param: 2 })
    // channel 1 carries T5f, the tempo command, on the same row
    expect(song.patterns[3]![0]![1]!.command).toBe(20)
    expect(song.patterns[3]![0]![1]!.param).toBe(95)
    // and $fe is a note-off, which a cell with no note must not be given
    expect(song.patterns[3]![0]![5]!.note).toBe(0xfe)
    expect(song.patterns[3]![1]![11]!.volume).toBe(-1)
  })

  it('names no instrument the header does not have', () => {
    for (const p of song.patterns) {
      for (const r of p) for (const c of r) expect(c.instrument).toBeLessThanOrEqual(song.samples.length)
    }
  })
})

describe.skipIf(!corpusBank())('against the corpus copy', () => {
  it('is the same bytes the fixture holds', () => {
    expect([...corpusBank()!]).toEqual([...fixture()!])
  })
})
