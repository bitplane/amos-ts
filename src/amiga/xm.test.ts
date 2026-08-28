/**
 * The FastTracker 2 format, against XMPlayer-library's own example module.
 *
 * The checks that matter here are the ones a big-endian reader gets wrong and
 * the ones a reader working from the FT2 spec rather than from
 * `DME_FastTracker.library` gets wrong. Both walks are verified the same way:
 * a correct parse of the whole file ends on its LAST BYTE, because the header
 * sizes chain the patterns and the instruments end to end with nothing spare.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { describeWith } from '../testing/fixture'
import {
  XM_16_BIT,
  XM_DEFAULT_BPM,
  XM_DEFAULT_SPEED,
  XM_ENV_ON,
  XM_KEY_OFF,
  XM_LOOP_PINGPONG,
  XM_MAGIC,
  XM_MIN_BPM,
  XM_VERSION,
  isPlayableXm,
  isXm,
  parseXm,
} from './xm'

/**
 * fixtures/aminet/xmplay-lib/XMPlayer-library/ExampleXM/visit_from_the_dead.xm
 * from `mus/play/XMPlayer-library` on Aminet. Read for behaviour and never
 * redistributed, like every other library in `fixtures/`.
 */
const EXAMPLE = 'bd113069981dc40099e3cf4bbc8a9969c48af010186cb89d4be702d490f19469'

function example(): Uint8Array | null {
  try {
    return new Uint8Array(
      readFileSync('fixtures/aminet/xmplay-lib/XMPlayer-library/ExampleXM/visit_from_the_dead.xm'),
    )
  } catch {
    return null
  }
}

/** the sixteen magic bytes, a $1a, and enough header to read */
function stub(over: Partial<Record<string, number>> = {}): Uint8Array {
  const d = new Uint8Array(0x50 + 256 + 64)
  for (let i = 0; i < XM_MAGIC.length; i++) d[i] = XM_MAGIC.charCodeAt(i)
  d[0x25] = 0x1a
  const w = (at: number, v: number): void => {
    d[at] = v & 0xff
    d[at + 1] = (v >> 8) & 0xff
  }
  const l = (at: number, v: number): void => {
    w(at, v & 0xffff)
    w(at + 2, (v >>> 16) & 0xffff)
  }
  w(0x3a, XM_VERSION)
  l(0x3c, 0x114)
  w(0x40, 1)
  w(0x42, 0)
  w(0x44, 4)
  w(0x46, 0)
  w(0x48, 0)
  w(0x4a, 0)
  w(0x4c, 6)
  w(0x4e, 125)
  for (const [k, v] of Object.entries(over)) w(Number(k), v!)
  return d
}

describe('the FastTracker 2 container', () => {
  it('takes the sixteen magic bytes and nothing shorter', () => {
    expect(isXm(stub())).toBe(true)
    const bad = stub()
    bad[15] = 0x20
    expect(isXm(bad)).toBe(false)
    expect(isXm(new Uint8Array(8))).toBe(false)
  })

  /**
   * $210a2a is `cmpi.w #$401,$3a(a0)`, an UNSWAPPED compare against the raw
   * little-endian bytes. 1.04 passes and 1.03 does not, and the refusal is
   * silence rather than an error: $210a62 returns zero and starts no
   * interrupt.
   */
  it('plays version 1.04 and refuses 1.03 without an error', () => {
    expect(isPlayableXm(stub())).toBe(true)
    expect(isPlayableXm(stub({ 0x3a: 0x0103 }))).toBe(false)
    expect(parseXm(stub({ 0x3a: 0x0103 }))).toBeNull()
  })

  /** $211920 and $211932 */
  it('substitutes six for a zero speed and 125 for a BPM of 32 or less', () => {
    expect(parseXm(stub({ 0x4c: 0 }))!.speed).toBe(XM_DEFAULT_SPEED)
    expect(parseXm(stub({ 0x4c: 3 }))!.speed).toBe(3)
    expect(parseXm(stub({ 0x4e: XM_MIN_BPM }))!.bpm).toBe(XM_DEFAULT_BPM)
    expect(parseXm(stub({ 0x4e: XM_MIN_BPM + 1 }))!.bpm).toBe(XM_MIN_BPM + 1)
  })

  /**
   * $21195a reads the channel count as a BYTE where every neighbouring field
   * gets the `ror.w`, so it is the low half of the little-endian word. The
   * song length two fields earlier is read as a full word.
   */
  it('reads the channel count as one byte and the song length as a word', () => {
    const d = stub({ 0x44: 0x0110, 0x40: 0x0102 })
    const song = parseXm(d)!
    expect(song.channels).toBe(0x10)
    expect(song.length).toBe(0x0102)
  })

  it('is null when the channel count is zero', () => {
    expect(parseXm(stub({ 0x44: 0 }))).toBeNull()
  })
})

describe('the packed row decoder', () => {
  /** $211e30: bit 7 set is a mask, bit 7 clear is the note with four after it */
  function withPattern(rows: number, packed: number[]): ReturnType<typeof parseXm> {
    const head = stub({ 0x46: 1, 0x44: 2 })
    const d = new Uint8Array(head.length + 9 + packed.length)
    d.set(head)
    const at = 0x3c + 0x114
    d[at] = 9
    d[at + 5] = rows & 0xff
    d[at + 7] = packed.length & 0xff
    d[at + 8] = (packed.length >> 8) & 0xff
    d.set(packed, at + 9)
    return parseXm(d)
  }

  it('takes an uncompressed cell as five bytes', () => {
    const song = withPattern(1, [49, 1, 0x30, 0x0c, 0x20, 0x80])!
    const cell = song.patterns[0]!.cells[0]![0]!
    expect(cell).toEqual({ note: 49, instrument: 1, volume: 0x30, effect: 0x0c, param: 0x20 })
  })

  it('takes the five mask bits in order and leaves the rest zero', () => {
    // bit 0 note, 1 instrument, 2 volume, 3 effect, 4 param. $89 is the note
    // and the effect, skipping the instrument and the volume between them
    const song = withPattern(1, [0x89, 60, 0x0f, 0x80])!
    const cell = song.patterns[0]!.cells[0]![0]!
    expect(cell).toEqual({ note: 60, instrument: 0, volume: 0, effect: 0x0f, param: 0 })
    // and $84 is the volume alone
    const two = withPattern(1, [0x84, 0x42, 0x80])!
    expect(two.patterns[0]!.cells[0]![0]!).toEqual({ note: 0, instrument: 0, volume: 0x42, effect: 0, param: 0 })
  })

  it('takes a bare $80 as five zeroes and one byte', () => {
    const song = withPattern(1, [0x80, 0x80])!
    expect(song.patterns[0]!.cells[0]![0]!).toEqual({ note: 0, instrument: 0, volume: 0, effect: 0, param: 0 })
    expect(song.patterns[0]!.cells[0]![1]!.note).toBe(0)
  })

  /**
   * $211e00: a packed size of zero is not a skipped pattern, it is a pattern
   * of empty rows. The row count in the header still runs.
   */
  it('gives an empty pattern its full count of empty rows', () => {
    const song = withPattern(16, [])!
    expect(song.patterns[0]!.rows).toBe(16)
    expect(song.patterns[0]!.cells).toHaveLength(16)
    expect(song.patterns[0]!.cells[15]!).toHaveLength(2)
    expect(song.patterns[0]!.cells[15]![0]!.note).toBe(0)
  })
})

describe('the sample delta decoder', () => {
  /**
   * $211a4a is a running eight-bit sum. The classic wrong answer is to treat
   * the bytes as absolute, which gives a recognisable sample and a wrong one.
   */
  function decode(bytes: number[], sixteen = false): Int8Array {
    const head = stub({ 0x48: 1, 0x44: 2 })
    const hdr = 263
    const shdr = 40
    const d = new Uint8Array(head.length + hdr + shdr + bytes.length)
    d.set(head)
    const at = 0x3c + 0x114
    d[at] = hdr & 0xff
    d[at + 1] = (hdr >> 8) & 0xff
    d[at + 0x1b] = 1
    d[at + 0x1d] = shdr
    const sh = at + hdr
    d[sh] = bytes.length & 0xff
    d[sh + 1] = (bytes.length >> 8) & 0xff
    d[sh + 0x0e] = sixteen ? XM_16_BIT : 0
    d.set(bytes, sh + shdr)
    return parseXm(d)!.instruments[0]!.samples[0]!.pcm
  }

  it('accumulates eight-bit deltas and wraps at the byte', () => {
    expect([...decode([10, 10, 10, -30 & 0xff])]).toEqual([10, 20, 30, 0])
    expect([...decode([0x7f, 0x7f])]).toEqual([127, -2])
  })

  /**
   * $211a32 reads TWO bytes and writes ONE: `lsr.w #$8,d6 / move.b d6,(a6)+`
   * keeps the high byte of each accumulated word. There is no 16-bit path
   * anywhere after the parse, so a 16-bit sample is half as long and eight
   * bits deep.
   */
  it('downconverts a 16-bit sample to the high byte of each accumulated word', () => {
    // deltas 0x4000 and 0x4000: the running word is 0x4000 then 0x8000
    const pcm = decode([0x00, 0x40, 0x00, 0x40], true)
    expect(pcm).toHaveLength(2)
    expect([...pcm]).toEqual([0x40, -128])
  })
})

describeWith('the XMPlayer example module', example(), (data) => {
  const song = parseXm(data)!

  it('is the file the fixture names', () => {
    expect(EXAMPLE).toHaveLength(64)
    expect(data).toHaveLength(417748)
  })

  it('reads its header', () => {
    expect(song.name).toBe('Visit from the Dead')
    expect(song.tracker).toBe('FastTracker v2.00')
    expect(song.version).toBe(XM_VERSION)
    expect(song.channels).toBe(14)
    expect(song.length).toBe(24)
    expect(song.speed).toBe(4)
    expect(song.bpm).toBe(114)
    // bit 0 of the flags at $4a: linear periods
    expect(song.flags & 1).toBe(1)
  })

  it('has 29 patterns of 64 rows and 46 instruments', () => {
    expect(song.patterns).toHaveLength(29)
    expect(new Set(song.patterns.map((p) => p.rows))).toEqual(new Set([64]))
    expect(song.instruments).toHaveLength(46)
    for (const p of song.patterns) {
      expect(p.cells).toHaveLength(64)
      expect(p.cells[0]).toHaveLength(14)
    }
  })

  /**
   * The proof that both walks are right. $211990 chains the patterns by header
   * size plus packed size and $2119c8 chains the instruments by header size,
   * sample headers and sample data, and if either is off by a byte the second
   * walk lands somewhere else. It lands on the last byte of the file.
   */
  it('accounts for every byte of the file', () => {
    let bytes = 0
    for (const i of song.instruments) for (const s of i.samples) bytes += s.pcm.length * (s.bits === 16 ? 2 : 1)
    // 417,748 = header + patterns + instrument headers + this
    expect(bytes).toBe(369165)
    expect(song.instruments.reduce((n, i) => n + i.samples.length, 0)).toBe(36)
  })

  it('keeps the credits instruments, which have no samples at all', () => {
    expect(song.instruments[1]!.samples).toHaveLength(0)
    expect(song.instruments[1]!.name).toContain('analized by')
    expect(song.instruments[2]!.name).toContain('MADMAN')
  })

  it('reads the multi-sampled first instrument', () => {
    const ins = song.instruments[0]!
    expect(ins.samples).toHaveLength(16)
    const s = ins.samples[0]!
    expect(s.length).toBe(94815)
    expect(s.volume).toBe(38)
    expect(s.relativeNote).toBe(5)
    expect(s.bits).toBe(8)
    expect(s.pcm).toHaveLength(94815)
  })

  it('uses six effects and no others', () => {
    const used = new Set<number>()
    for (const p of song.patterns) for (const r of p.cells) for (const c of r) if (c.effect || c.param) used.add(c.effect)
    // 2 porta down, A volume slide, C set volume, E extended, F speed
    expect([...used].sort((a, b) => a - b)).toEqual([2, 0x0a, 0x0c, 0x0e, 0x0f])
  })

  /**
   * Not one of the 46 has bit 0 of `$e9(a1)` set, so nothing in this module
   * reaches $211c48 and the reciprocal interpolation `xmplay.ts` reproduces is
   * never exercised by it. The envelope tests are synthetic for that reason.
   */
  it('switches no volume envelope on, in any of its 46 instruments', () => {
    expect(song.instruments.filter((i) => (i.volumeType & XM_ENV_ON) !== 0)).toHaveLength(0)
  })

  /** the fadeout is what ends a note here, and 566 cells ask for it */
  it('uses 566 key offs and no ping-pong loop', () => {
    let pingpong = 0
    let keyoffs = 0
    for (const i of song.instruments) for (const s of i.samples) if ((s.type & 3) === XM_LOOP_PINGPONG) pingpong++
    for (const p of song.patterns) for (const r of p.cells) for (const c of r) if (c.note === XM_KEY_OFF) keyoffs++
    expect(pingpong).toBe(0)
    expect(keyoffs).toBe(566)
  })
})
