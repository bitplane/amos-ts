/**
 * The THX sequencer, against the two shipped replayers and against modules
 * built to reach one command each.
 *
 * The period table is held to BOTH libraries because they carry the same 168
 * bytes and were built independently — jotre-1.0 at $1690 and thx-0.6 at $f28.
 * Two replayers agreeing on every word is a better check than either one
 * alone, and it is the only part of this file that reads a binary.
 *
 * Everything else drives `ThxPlayer` through `NullAudio` and reads the event
 * stream, which is the same oracle `protracker.test.ts` uses.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NullAudio } from './paula'
import { thxParse, type ThxModule } from './thx'
import { THX_PERIODS, ThxPlayer } from './thxplay'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const libs = [
  { id: 'jotre-1.0', file: 'AMOSPro_Jotre.Lib', at: 0x1690 },
  { id: 'thx-0.6', file: 'AMOSPRO_THX.lib', at: 0xf28 },
] as const
const pathOf = (l: (typeof libs)[number]): string => join(root, 'fixtures', 'extensions', l.id, l.file)

/* ---- a module with one track, built to order ---- */

interface Step {
  note?: number
  ins?: number
  cmd?: number
  arg?: number
}

/**
 * One position, one track, `rows.length` rows, one instrument.
 *
 * Channel 0 gets track 1 and the other three get track 0, which the file omits
 * — so only channel 0 plays and the assertions stay readable.
 */
function tinyModule(rows: Step[], opts: { positions?: number; restart?: number } = {}): ThxModule {
  const trackLen = rows.length
  const positions = opts.positions ?? 1
  const body: number[] = []
  for (let p = 0; p < positions; p++) body.push(1, 0, 0, 0, 0, 0, 0, 0)
  for (const r of rows) {
    const word = ((r.note ?? 0) << 10) | ((r.ins ?? 0) << 4) | (r.cmd ?? 0)
    body.push(word >> 8, word & 0xff, r.arg ?? 0)
  }
  // 22 instrument bytes: byte 0 is the volume, byte 1 the wave length, no playlist
  const ins = [0x40, 0x05, 1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  body.push(...ins)
  const nameOffset = 14 + body.length
  const songLength = positions
  const head = [
    0x54, 0x48, 0x58, 0,
    nameOffset >> 8, nameOffset & 0xff,
    (0x8000 | songLength) >>> 8, songLength & 0xff,
    (opts.restart ?? 0) >> 8, (opts.restart ?? 0) & 0xff,
    trackLen, 1, 1, 0,
  ]
  return thxParse(Uint8Array.from([...head, ...body, 0, 0]))
}

/** a player wired to a recording sink, ready to step */
function player(m: ThxModule): { p: ThxPlayer; audio: NullAudio } {
  const audio = new NullAudio()
  const p = new ThxPlayer(() => audio)
  p.load(m)
  return { p, audio }
}

const run = (p: ThxPlayer, frames: number): void => {
  for (let i = 0; i < frames; i++) p.tick()
}

describe('the THX period table', () => {
  for (const l of libs) {
    const present = existsSync(pathOf(l))
    it.skipIf(!present)(`is the 60 notes ${l.id} carries at $${l.at.toString(16)}`, () => {
      const b = new Uint8Array(readFileSync(pathOf(l)))
      // the code hunk starts at file offset 32: four longs of header, then the
      // hunk-code longword and its size
      const image = b.subarray(32)
      const w = (at: number): number => (image[at]! << 8) | image[at + 1]!
      // the lookup base is the table start + 12 --- `lea $169c(pc),a3` against
      // a shared run that begins at $1690
      for (let n = 1; n <= 60; n++) expect(w(l.at + 12 + n * 2)).toBe(THX_PERIODS[n])
    })
  }

  it('is 61 entries, and index 0 is the one no lookup reaches', () => {
    expect(THX_PERIODS.length).toBe(61)
    expect(THX_PERIODS[0]).toBe(0)
    // 3424 is 856 * 4, so the top octave is ProTracker's
    expect(THX_PERIODS[1]).toBe(3424)
    expect(THX_PERIODS[25]).toBe(856)
    expect(THX_PERIODS[60]).toBe(113)
  })

  it('falls monotonically, which a mistyped digit would break', () => {
    for (let n = 2; n <= 60; n++) expect(THX_PERIODS[n]!).toBeLessThan(THX_PERIODS[n - 1]!)
  })
})

describe('the THX sequencer', () => {
  it('plays a row every `speed` frames', () => {
    const { p } = player(tinyModule([{ note: 25, ins: 1 }, {}, {}, {}]))
    expect(p.row).toBe(0)
    run(p, 5)
    expect(p.row).toBe(0)
    p.tick()
    expect(p.row).toBe(1)
    run(p, 6)
    expect(p.row).toBe(2)
  })

  it('advances the position when the track runs out, and not before', () => {
    const { p } = player(tinyModule([{}, {}], { positions: 3 }))
    run(p, 6)
    expect([p.position, p.row]).toEqual([0, 1])
    run(p, 6)
    expect([p.position, p.row]).toEqual([1, 0])
    run(p, 12)
    expect([p.position, p.row]).toEqual([2, 0])
  })

  it('sets the end flag on the wrap and RESTARTS, because the replayer does', () => {
    const { p } = player(tinyModule([{}], { positions: 2, restart: 1 }))
    expect(p.ended).toBe(false)
    run(p, 6)
    expect([p.position, p.ended]).toEqual([1, false])
    run(p, 6)
    // the guide: "The replayer will restart the module automatically"
    expect([p.position, p.ended, p.playing]).toEqual([1, true, true])
  })

  it('does not count a tick down while stopped', () => {
    const { p } = player(tinyModule([{}, {}]))
    p.stop()
    const before = p.tickCount
    run(p, 20)
    expect([p.tickCount, p.row]).toEqual([before, 0])
  })

  it('silences all four voices when stopped', () => {
    const { p, audio } = player(tinyModule([{}]))
    p.tick()
    audio.events.length = 0
    p.stop()
    expect(audio.events.map((e) => [e.kind, e.voice])).toEqual([
      ['stop', 0],
      ['stop', 1],
      ['stop', 2],
      ['stop', 3],
    ])
  })
})

describe('the track commands', () => {
  it('F sets the speed, and writes only the low byte of the word', () => {
    const { p } = player(tinyModule([{ cmd: 0xf, arg: 3 }, {}, {}, {}]))
    p.tick()
    expect(p.speed).toBe(3)
    run(p, 2)
    expect(p.row).toBe(1)
  })

  it('8 writes a byte that nothing in either replayer reads', () => {
    const { p, audio } = player(tinyModule([{ note: 25, ins: 1, cmd: 8, arg: 0x20 }, {}]))
    p.tick()
    expect(p.masterVolume).toBe(0x20)
    // $0(a6) is not one of the five terms of the chain at $148e, so the
    // command cannot be heard --- AUDxVOL is the instrument's $40 either way
    expect(audio.events.filter((e) => e.kind === 'volume' && e.voice === 0)[0]!.volume).toBe(0x40)
  })

  it('B jumps to a DECIMAL position', () => {
    // $23 reads as twenty-three, not as 35
    const { p } = player(tinyModule([{ cmd: 0xb, arg: 0x23 }, {}], { positions: 40 }))
    run(p, 6)
    expect(p.position).toBe(23)
  })

  it('D breaks to a decimal ROW of the next position', () => {
    const { p } = player(tinyModule([{ cmd: 0xd, arg: 0x02 }, {}, {}, {}], { positions: 3 }))
    run(p, 6)
    expect([p.position, p.row]).toEqual([1, 2])
  })

  it('D past the end of the track starts at row 0 instead', () => {
    // `cmp.w $3b8(a6),d6 / bgt / clr.w` --- 9 is past a four-row track
    const { p } = player(tinyModule([{ cmd: 0xd, arg: 0x09 }, {}, {}, {}], { positions: 3 }))
    run(p, 6)
    expect([p.position, p.row]).toEqual([1, 0])
  })

  it('0 writes the next position and the ordinary advance throws it away', () => {
    // `move.w $448(a6),$3b6(a6) / addi.w #$1` at $b1e overwrites it, so a
    // command 0 alone moves nothing. It only survives a row that also carries
    // a B or a D, which is what makes it command B's hundreds digit.
    const { p } = player(tinyModule([{ cmd: 0, arg: 0x05 }, {}], { positions: 9 }))
    run(p, 12)
    expect(p.position).toBe(1)
  })

  it('B reads the position command 0 left behind as its hundreds digit', () => {
    // $c5a is `move.w $3b6(a6),d5 / mulu.w #$64,d5` --- 1 * 100 + 23
    const { p } = player(tinyModule([{ cmd: 0, arg: 0x01 }, { cmd: 0xb, arg: 0x23 }], { positions: 200 }))
    run(p, 12)
    expect(p.position).toBe(123)
  })

  describe('C is three ranges over one byte', () => {
    it('sets the channel volume at or below $40', () => {
      const { p } = player(tinyModule([{ cmd: 0xc, arg: 0x30 }]))
      p.tick()
      expect(p.channels[0]!.volume).toBe(0x30)
    })

    it('broadcasts $21(a0) to all four channels from $50', () => {
      const { p } = player(tinyModule([{ cmd: 0xc, arg: 0x60 }]))
      p.tick()
      expect(p.channels.map((c) => c.volumeC)).toEqual([0x10, 0x10, 0x10, 0x10])
      // and leaves $1d, the first range's field, alone
      expect(p.channels[0]!.volume).toBe(0)
    })

    it('sets $21(a0) on this channel alone from $a0', () => {
      const { p } = player(tinyModule([{ cmd: 0xc, arg: 0xb0 }]))
      p.tick()
      expect(p.channels.map((c) => c.volumeC)).toEqual([0x10, 0, 0, 0])
    })

    it('does nothing in the gaps the two subtractions leave', () => {
      const { p } = player(tinyModule([{ cmd: 0xc, arg: 0x4a }]))
      p.tick()
      expect(p.channels.map((c) => c.volumeC)).toEqual([0, 0, 0, 0])
      expect(p.channels[0]!.volume).toBe(0)
    })
  })

  describe('E is two sub-commands bounded by the speed', () => {
    it('takes a note cut inside the row', () => {
      const { p } = player(tinyModule([{ cmd: 0xe, arg: 0xc3 }]))
      p.tick()
      expect([p.channels[0]!.cutTick, p.channels[0]!.cutting]).toEqual([3, true])
    })

    it('ignores a tick the row will never reach', () => {
      // speed 6, so tick 9 never happens --- `cmp.b $3af(a6),d6 / bge`
      const { p } = player(tinyModule([{ cmd: 0xe, arg: 0xc9 }]))
      p.tick()
      expect(p.channels[0]!.cutting).toBe(false)
    })

    it('cancels a note delay that is already in flight rather than restarting it', () => {
      const { p } = player(tinyModule([{ cmd: 0xe, arg: 0xd2 }, { cmd: 0xe, arg: 0xd2 }]))
      p.tick()
      expect(p.channels[0]!.delaying).toBe(true)
      run(p, 6)
      expect(p.channels[0]!.delaying).toBe(false)
    })
  })
})

describe('what reaches the sink', () => {
  it('writes AUDxPER once for a note and not again while it holds', () => {
    const { p, audio } = player(tinyModule([{ note: 25, ins: 1 }, {}, {}, {}]))
    run(p, 24)
    const freqs = audio.events.filter((e) => e.kind === 'freq')
    expect(freqs.length).toBe(1)
    // note 25 is period 856, the middle C every Amiga tracker shares
    expect(freqs[0]!.freq).toBeCloseTo(3546895 / 856, 6)
  })

  it('writes AUDxVOL on a change and not on every frame', () => {
    const { p, audio } = player(tinyModule([{ note: 25, ins: 1 }, {}, {}, {}]))
    run(p, 30)
    const vols = audio.events.filter((e) => e.kind === 'volume' && e.voice === 0)
    // one write at the first frame, and nothing after it
    expect(vols.length).toBe(1)
    expect(vols[0]!.volume).toBe(0x40)
  })

  it('does not call play(), because THX never restarts a voice', () => {
    const { p, audio } = player(tinyModule([{ note: 25, ins: 1 }, { note: 30, ins: 1 }]))
    run(p, 24)
    expect(audio.events.some((e) => e.kind === 'play')).toBe(false)
  })

  it('takes the instrument volume on a note, over whatever command C set', () => {
    const { p } = player(tinyModule([{ cmd: 0xc, arg: 0x10 }, { note: 25, ins: 1 }]))
    p.tick()
    expect(p.channels[0]!.volume).toBe(0x10)
    run(p, 6)
    // `move.b $0(a3),$1d(a0)` at $d46 --- byte 0 of the instrument, $40 here
    expect(p.channels[0]!.volume).toBe(0x40)
  })
})
