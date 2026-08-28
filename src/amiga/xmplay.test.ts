/**
 * FastTracker 2's replay.
 *
 * Most of what is worth checking here is what the library does NOT do. Three
 * effects are computed and overwritten, one dispatch entry is an `rts`, and
 * the envelope interpolates a reciprocal; a port that quietly fixed any of
 * them would sound better and be wrong. The modules are built by hand so each
 * test drives exactly one of those paths.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { describeWith } from '../testing/fixture'
import { XM_MAGIC, XM_VERSION, parseXm, type XmSong } from './xm'
import { XM_MAX_VOLUME, XM_QUIET_ROWS, XM_SINE, XmPlayer } from './xmplay'
import { XM_MIX_RATE, xmSamplesPerTick } from './xmmix'

function example(): Uint8Array | null {
  try {
    return new Uint8Array(
      readFileSync('fixtures/aminet/xmplay-lib/XMPlayer-library/ExampleXM/visit_from_the_dead.xm'),
    )
  } catch {
    return null
  }
}

interface Cell {
  note?: number
  instrument?: number
  volume?: number
  effect?: number
  param?: number
}

/**
 * One instrument of one 64-frame sample, one pattern, and whatever cells are
 * asked for. `linear` picks the frequency table, `envelope` switches the
 * volume envelope on with the points given.
 */
function build(
  rows: Cell[][],
  opts: { channels?: number; speed?: number; linear?: boolean; envelope?: [number, number][]; fadeout?: number } = {},
): XmSong {
  const channels = opts.channels ?? Math.max(1, rows[0]?.length ?? 1)
  const rowCount = rows.length
  const packed: number[] = []
  for (const row of rows) {
    for (let c = 0; c < channels; c++) {
      const cell = row[c] ?? {}
      packed.push(cell.note ?? 0, cell.instrument ?? 0, cell.volume ?? 0, cell.effect ?? 0, cell.param ?? 0)
    }
  }

  const hdrSize = 0x114
  const patHdr = 9
  const insHdr = 263
  const smpHdr = 40
  const pcm = 64
  const d = new Uint8Array(0x3c + hdrSize + patHdr + packed.length + insHdr + smpHdr + pcm)
  for (let i = 0; i < XM_MAGIC.length; i++) d[i] = XM_MAGIC.charCodeAt(i)
  d[0x25] = 0x1a
  const w = (at: number, v: number): void => {
    d[at] = v & 0xff
    d[at + 1] = (v >> 8) & 0xff
  }
  w(0x3a, XM_VERSION)
  w(0x3c, hdrSize)
  w(0x40, 1)
  w(0x42, 0)
  w(0x44, channels)
  w(0x46, 1)
  w(0x48, 1)
  w(0x4a, opts.linear === false ? 0 : 1)
  w(0x4c, opts.speed ?? 1)
  w(0x4e, 125)

  let p = 0x3c + hdrSize
  w(p, patHdr)
  d[p + 5] = rowCount
  w(p + 7, packed.length)
  d.set(packed, p + patHdr)
  p += patHdr + packed.length

  w(p, insHdr)
  w(p + 0x1b, 1)
  w(p + 0x1d, smpHdr)
  // every note plays sample 0, which the zeroed map already says
  if (opts.envelope) {
    for (const [i, [x, y]] of opts.envelope.entries()) {
      w(p + 0x81 + i * 4, x)
      w(p + 0x81 + i * 4 + 2, y)
    }
    d[p + 0xe1] = opts.envelope.length
    d[p + 0xe9] = 1
  }
  w(p + 0xef, opts.fadeout ?? 0)
  const sh = p + insHdr
  w(sh, pcm)
  d[sh + 0x0c] = 64
  // a square wave, as deltas: +64 then flat, so the decoded sample is 64
  d[sh + smpHdr] = 64
  return parseXm(d)!
}

/**
 * Run n ticks and return the player.
 *
 * $210a66 clears `$b0(a5)` and $211b78 bumps it BEFORE the compare, so the
 * first row lands on the `speed`th tick and the ticks before it play nothing.
 * Every test below counts from there.
 */
function run(song: XmSong, ticks: number): XmPlayer {
  const p = new XmPlayer(() => undefined)
  p.load(song)
  for (let i = 0; i < ticks; i++) p.vbl()
  return p
}

/** run to the tick on which row `n` is PROCESSED, counting from a fresh load */
function toRow(p: XmPlayer, n: number): void {
  for (let i = 0; i < p.speed * (n + 1); i++) p.vbl()
}

/** and then n more ticks, which are the tick handlers for the row just read */
function ticks(p: XmPlayer, n: number): void {
  for (let i = 0; i < n; i++) p.vbl()
}

describe('the tick and the row', () => {
  it('takes the module speed and BPM', () => {
    const p = run(build([[{}]], { speed: 6 }), 0)
    expect(p.speed).toBe(6)
    expect(p.bpm).toBe(125)
    expect(p.samplesPerTick).toBe(xmSamplesPerTick(XM_MIX_RATE, 125))
  })

  /** $2128e8: below $20 is the speed, $20 and up is the BPM */
  it('splits Fxx at $20 into a speed and a BPM', () => {
    const speed = run(build([[{ effect: 0x0f, param: 4 }]], { speed: 1 }), 1)
    expect(speed.speed).toBe(4)
    const bpm = run(build([[{ effect: 0x0f, param: 200 }]], { speed: 1 }), 1)
    expect(bpm.bpm).toBe(200)
    expect(bpm.samplesPerTick).toBe(xmSamplesPerTick(XM_MIX_RATE, 200))
  })

  /** $2128f2: `F00` is the end of the song and not a speed of zero */
  it('treats F00 as the end of the song', () => {
    const p = run(build([[{ effect: 0x0f, param: 0 }]], { speed: 1 }), 1)
    expect(p.ended).toBe(true)
    expect(p.speed).toBe(1)
  })

  /** $2125ca: the parameter is DECIMAL, so D16 breaks to row 16 and not 22 */
  it('reads a pattern break parameter as two decimal digits', () => {
    const rows: Cell[][] = [[{ effect: 0x0d, param: 0x16 }]]
    for (let i = 0; i < 31; i++) rows.push([{}])
    const p = run(build(rows, { speed: 1 }), 1)
    expect(p.row).toBe(16)
  })

  /** $2128dc: EE holds the row, and the delay counts down after it */
  it('repeats a row for the pattern delay', () => {
    const song = build([[{ effect: 0x0e, param: 0xe2 }], [{}], [{}]], { speed: 1 })
    const p = new XmPlayer(() => undefined)
    p.load(song)
    // $212160 decrements on the very row that armed it, so this reads 1
    p.vbl()
    expect(p.patternDelay).toBe(1)
    expect(p.row).toBe(0)
    p.vbl()
    expect(p.patternDelay).toBe(0)
    expect(p.row).toBe(0)
    // and the third pass advances, having read the NEXT row's cells while the
    // counter still said 0 --- the pointer at `$d0(a5)` runs one ahead
    p.vbl()
    expect(p.row).toBe(1)
  })
})

describe('the effects that reach the mixer', () => {
  /** $2123ea and $2123f2: `d2 << 2`, and the period mirrors into the voice */
  it('slides the period by four times the parameter', () => {
    const song = build([[{ note: 49, instrument: 1 }], [{ effect: 0x02, param: 3 }], [{}]], { speed: 4 })
    const p = new XmPlayer(() => undefined)
    p.load(song)
    toRow(p, 1)
    const before = p.channels[0]!.period
    // `2` is in the tick table only, so the row itself moves nothing
    expect(p.channels[0]!.period).toBe(before)
    ticks(p, 3)
    expect(p.channels[0]!.period).toBe(before + 3 * 12)
  })

  /** $212568: the high nibble up, the low one down when the high is zero */
  it('slides the volume up on the high nibble and down on the low', () => {
    const up = build([[{ note: 49, instrument: 1, volume: 0x10 }], [{ effect: 0x0a, param: 0x30 }], [{}]], {
      speed: 4,
    })
    const p = new XmPlayer(() => undefined)
    p.load(up)
    toRow(p, 1)
    expect(p.channels[0]!.volume).toBe(0)
    ticks(p, 3)
    // three ticks of +3
    expect(p.channels[0]!.volume).toBe(9)
  })

  /** $2125bc, and the clamp at 64 */
  it('sets and clamps the volume with Cxx', () => {
    const p = run(build([[{ note: 49, instrument: 1, effect: 0x0c, param: 99 }]], { speed: 1 }), 1)
    expect(p.channels[0]!.volume).toBe(XM_MAX_VOLUME)
  })

  /** $212920 and $21292e */
  it('sets and slides the global volume', () => {
    const p = run(build([[{ effect: 0x10, param: 32 }]], { speed: 1 }), 1)
    expect(p.globalVolume).toBe(32)
  })
})

describe('the three effects that are thrown away', () => {
  /**
   * $2124ec stores the bent period into `$10(a4)` and $211dc8 rewrites that
   * register from `$18(a2)` in the pass that runs after every tick. The phase
   * still moves, so this checks BOTH: the state advances and the voice does
   * not.
   */
  it('advances the vibrato phase and leaves the voice period alone', () => {
    const song = build([[{ note: 49, instrument: 1 }], [{ effect: 0x04, param: 0x48 }], [{}]], { speed: 4 })
    const p = new XmPlayer(() => undefined)
    p.load(song)
    toRow(p, 1)
    const period = p.voices[0]!.period
    ticks(p, 3)
    expect(p.channels[0]!.vibrato).toBe(0x48)
    // three ticks at a speed of four in the high nibble
    expect(p.channels[0]!.vibratoPhase).toBe(12)
    expect(p.voices[0]!.period).toBe(period)
  })

  /** $212558 into `$12(a4)`, which $211d90 rewrites */
  it('advances the tremolo phase and leaves the voice volume alone', () => {
    const song = build([[{ note: 49, instrument: 1 }], [{ effect: 0x07, param: 0x48 }], [{}]], { speed: 4 })
    const p = new XmPlayer(() => undefined)
    p.load(song)
    toRow(p, 1)
    const volume = p.voices[0]!.volume
    ticks(p, 3)
    expect(p.channels[0]!.vibratoPhase).toBe(12)
    expect(p.voices[0]!.volume).toBe(volume)
  })

  /**
   * $21250a reads and writes `$21(a2)` and `$22(a2)`, the same two bytes
   * $21249e uses. FT2 keeps a second pair; this library does not, so a tremolo
   * rewrites the vibrato's settings.
   */
  it('lets a tremolo overwrite the vibrato parameter', () => {
    const song = build(
      [[{ note: 49, instrument: 1 }], [{ effect: 0x04, param: 0x48 }], [{ effect: 0x07, param: 0x21 }], [{}]],
      { speed: 4 },
    )
    const p = new XmPlayer(() => undefined)
    p.load(song)
    toRow(p, 1)
    ticks(p, 3)
    expect(p.channels[0]!.vibrato).toBe(0x48)
    // row 2, and one tick of its tremolo
    ticks(p, 2)
    expect(p.channels[0]!.vibrato).toBe(0x21)
  })

  /** $2123e4, and the divide by three that costs a cycle and buys nothing */
  it('runs the arpeggio and leaves the voice period alone', () => {
    const song = build([[{ note: 49, instrument: 1 }], [{ effect: 0x00, param: 0x47 }], [{}]], { speed: 4 })
    const p = new XmPlayer(() => undefined)
    p.load(song)
    toRow(p, 1)
    const period = p.voices[0]!.period
    ticks(p, 3)
    expect(p.voices[0]!.period).toBe(period)
  })

  /** both dispatch tables send T to the `rts` at $212a72 */
  it('does nothing at all for a tremor', () => {
    const song = build([[{ note: 49, instrument: 1, volume: 0x10 + 40 }], [{ effect: 0x1d, param: 0x44 }], [{}]], {
      speed: 4,
    })
    const p = new XmPlayer(() => undefined)
    p.load(song)
    toRow(p, 1)
    const v = p.channels[0]!.volume
    expect(v).toBe(40)
    ticks(p, 3)
    expect(p.channels[0]!.volume).toBe(v)
  })
})

describe('the volume envelope', () => {
  /**
   * $211c7a is a separate branch for a position that lands exactly on a point,
   * and it is the only place the envelope is right. A point per tick therefore
   * plays correctly.
   */
  it('is exact on a point', () => {
    const song = build([[{ note: 49, instrument: 1 }], [{}], [{}], [{}]], {
      speed: 1,
      envelope: [
        [0, 0],
        [1, 64],
        [2, 32],
      ],
    })
    const p = new XmPlayer(() => undefined)
    p.load(song)
    p.vbl()
    // the envelope position starts at 0 and the value is taken before the step
    expect(p.voices[0]!.volume).toBe(0)
    p.vbl()
    expect(p.voices[0]!.volume).toBe(XM_MAX_VOLUME)
    p.vbl()
    expect(p.voices[0]!.volume).toBe(32)
  })

  /**
   * $211cc0 multiplies where a ramp would divide, so a long segment reads
   * `dy / (t * dx)` and falls away from the first point instead of climbing to
   * the second. At t = 1 the two agree, and after that they do not.
   */
  it('interpolates a reciprocal between two points, not a ramp', () => {
    const rows: Cell[][] = [[{ note: 49, instrument: 1 }]]
    for (let i = 0; i < 12; i++) rows.push([{}])
    const song = build(rows, {
      speed: 1,
      envelope: [
        [0, 0],
        [16, 64],
      ],
    })
    const p = new XmPlayer(() => undefined)
    p.load(song)
    const seen: number[] = []
    for (let i = 0; i < 10; i++) {
      p.vbl()
      seen.push(p.voices[0]!.volume)
    }
    // a ramp would climb 0, 4, 8, 12 ...; the reciprocal peaks at t = 1 and
    // falls away, and the two agree only at that one point
    expect(seen[0]).toBe(0)
    expect(seen[1]).toBe(4)
    expect(seen[2]).toBeLessThan(seen[1]!)
    expect(seen[8]).toBeLessThan(seen[2]!)
    expect(seen[8]).toBe(0)
  })
})

describe('the order walk', () => {
  /** $212284: eight rows with a zero volume and the voice is freed */
  it('kills a voice after eight silent rows', () => {
    const rows: Cell[][] = [[{ note: 49, instrument: 1, effect: 0x0c, param: 0 }]]
    for (let i = 0; i < 12; i++) rows.push([{}])
    const p = new XmPlayer(() => undefined)
    p.load(build(rows, { speed: 1 }))
    for (let i = 0; i < XM_QUIET_ROWS; i++) p.vbl()
    expect(p.voices[0]!.ended).toBe(false)
    for (let i = 0; i < 4; i++) p.vbl()
    expect(p.voices[0]!.ended).toBe(true)
  })

  /**
   * $2121b2: past the last order the walk takes the module's RESTART position
   * and raises the end flag, which is what `=Xm Song Pos` then reports from.
   */
  it('wraps to the restart position and raises the end flag', () => {
    const p = new XmPlayer(() => undefined)
    p.load(build([[{}], [{}]], { speed: 1 }))
    expect(p.ended).toBe(false)
    p.vbl()
    p.vbl()
    expect(p.ended).toBe(true)
    expect(p.order).toBe(0)
  })
})

describe('the sine table', () => {
  /** the 32 bytes at $21462a, which are ProTracker's */
  it('is ProTracker half-cycle, 0 to 255 and back', () => {
    expect(XM_SINE).toHaveLength(32)
    expect(XM_SINE[0]).toBe(0)
    expect(XM_SINE[16]).toBe(255)
    expect(XM_SINE[8]).toBe(180)
    // symmetric about the peak
    for (let i = 1; i < 16; i++) expect(XM_SINE[16 + i]).toBe(XM_SINE[16 - i])
  })
})

describeWith('the XMPlayer example module', example(), (data) => {
  const song = parseXm(data)!

  /**
   * The end-to-end check. Fourteen channels, linear periods, and the first
   * pattern is a two-voice fade-in, so this catches the guard at $211fa2: an
   * instrument-only cell must not kill a one-shot that is still sounding.
   */
  it('keeps two voices alive through the fade-in', () => {
    const p = new XmPlayer(() => undefined)
    p.load(song)
    for (let i = 0; i < 30; i++) p.vbl()
    const live = p.voices.filter((v) => !v.ended && v.period > 0)
    expect(live.length).toBeGreaterThanOrEqual(2)
    expect(p.voices[0]!.position).toBeGreaterThan(0)
    expect(p.voices[1]!.position).toBeGreaterThan(0)
  })

  it('walks into the second order and keeps its position reportable', () => {
    const p = new XmPlayer(() => undefined)
    p.load(song)
    for (let i = 0; i < 300; i++) p.vbl()
    expect(p.order).toBeGreaterThan(0)
    expect(p.position).toBe(p.order)
  })

  it('takes the module tempo, not the default', () => {
    const p = new XmPlayer(() => undefined)
    p.load(song)
    expect(p.speed).toBe(4)
    expect(p.bpm).toBe(114)
    expect(p.samplesPerTick).toBe(618)
  })
})
