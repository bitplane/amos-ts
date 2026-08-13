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
  // 22 instrument bytes, then ONE playlist entry.
  //
  // Byte 0 is the volume, byte 1 the wave length, 2..8 the ADSR, $14 the
  // playlist speed and $15 its length. The entry is note 1, waveform 1
  // (triangle), no commands: a THX instrument with no playlist entry never
  // writes $16(a0), so its note comes out a semitone flat forever --- which
  // is what the machine does and not something to build a test on.
  const ins = [0x40, 0x05, 1, 0x40, 1, 0x40, 100, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]
  body.push(...ins)
  // bits 0-5 note = 1, bits 7-9 waveform = 1
  const entry = (1 << 7) | 1
  body.push(entry >> 8, entry & 0xff, 0, 0)
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
    const { p } = player(tinyModule([{ note: 25, ins: 1, cmd: 8, arg: 0x20 }, {}]))
    p.tick()
    expect(p.masterVolume).toBe(0x20)
    // $0(a6) is not one of the five terms of the chain at $148e, so the
    // command cannot be heard --- the voice comes up at full scale either way
    expect(p.channels[0]!.outVolume).toBe(0x40)
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
    })

    it('sets $21(a0) on this channel alone from $a0', () => {
      const { p } = player(tinyModule([{ cmd: 0xc, arg: 0xb0 }]))
      p.tick()
      // the other three keep the $40 that `move.w #$40,$20(a1)` gave them
      expect(p.channels.map((c) => c.volumeC)).toEqual([0x10, 0x40, 0x40, 0x40])
    })

    it('does nothing in the gaps the two subtractions leave', () => {
      const { p } = player(tinyModule([{ cmd: 0xc, arg: 0x4a }]))
      p.tick()
      expect(p.channels.map((c) => c.volumeC)).toEqual([0x40, 0x40, 0x40, 0x40])
    })
  })

  describe('E is two sub-commands bounded by the speed', () => {
    it('takes a note cut inside the row', () => {
      // the row handler sets it to 3 and the between-tick pass, later in the
      // SAME frame, has already counted one off
      const { p } = player(tinyModule([{ cmd: 0xe, arg: 0xc3 }]))
      p.tick()
      expect([p.channels[0]!.cutTick, p.channels[0]!.cutting]).toEqual([2, true])
    })

    it('ignores a tick the row will never reach', () => {
      // speed 6, so tick 9 never happens --- `cmp.b $3af(a6),d6 / bge`
      const { p } = player(tinyModule([{ cmd: 0xe, arg: 0xc9 }]))
      p.tick()
      expect(p.channels[0]!.cutting).toBe(false)
    })

    it('cancels a note delay that is already in flight rather than restarting it', () => {
      // the delay fires inside the between-tick pass at $1008, which calls the
      // row handler back --- and THAT is what clears the flag, at $bee
      const { p } = player(tinyModule([{ cmd: 0xe, arg: 0xd2 }, {}, {}, {}]))
      p.tick()
      expect([p.channels[0]!.delaying, p.channels[0]!.delayTick]).toEqual([true, 1])
      run(p, 2)
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

  it('holds AUDxVOL steady once the envelope has settled', () => {
    // attack 1 frame to $40, decay 1 frame back to $40, then 100 of sustain
    const { p, audio } = player(tinyModule([{ note: 25, ins: 1 }, {}, {}, {}]))
    run(p, 30)
    const vols = audio.events.filter((e) => e.kind === 'volume' && e.voice === 0)
    // the first value arrives with play(); after that only changes are written
    expect(p.channels[0]!.outVolume).toBe(0x40)
    expect(vols.length).toBeLessThanOrEqual(1)
  })

  it('starts a voice with play() ONCE and changes it with setWaveform after', () => {
    // `$1de` switches the DMA on at init and `$1618` only ever rewrites the
    // buffer under it, so a second play() would be a restart the machine never
    // does. A filter sweep changes the waveform every frame.
    const { p, audio } = player(tinyModule([{ note: 25, ins: 1 }, { note: 30, ins: 1 }]))
    run(p, 24)
    const v0 = audio.events.filter((e) => e.voice === 0)
    expect(v0.filter((e) => e.kind === 'play').length).toBe(1)
    // and it comes after the period, which is the order $1618 writes them:
    // `move.w $64(a0),$6(a3)` is AUDxPER and the buffer copy follows it
    expect(v0.slice(0, 2).map((e) => e.kind)).toEqual(['freq', 'play'])
    expect(v0[1]!.length).toBe(640)
    // every later change is a rewrite under the running DMA
    expect(v0.filter((e) => e.kind === 'waveform').length).toBeGreaterThan(0)
  })

  it('gives every voice a 640-byte buffer, whatever the wave length', () => {
    const { p, audio } = player(tinyModule([{ note: 25, ins: 1 }, {}, {}, {}]))
    run(p, 12)
    for (const e of audio.events) {
      if (e.kind === 'play' || e.kind === 'waveform') expect(e.length).toBe(640)
    }
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

/**
 * The synthesis half: the envelope, the playlist and the waveform.
 *
 * `insModule` builds a module whose single instrument can be dictated field by
 * field, because every one of these is a property of the instrument rather
 * than of the song.
 */
function insModule(header: Partial<Record<number, number>>, entries: number[][] = [[1, 1, 0, 0]]): ThxModule {
  const body: number[] = [1, 0, 0, 0, 0, 0, 0, 0]
  // one row: note 25, instrument 1
  const w = (25 << 10) | (1 << 4)
  body.push(w >> 8, w & 0xff, 0, 0, 0, 0)
  const ins = new Array<number>(22).fill(0)
  ins[0] = 0x40 // volume
  ins[1] = 5 // wave length
  ins[0x14] = 1 // one frame an entry
  for (const [k, v] of Object.entries(header)) ins[Number(k)] = v!
  ins[0x15] = entries.length
  body.push(...ins)
  for (const [note, wave, cmdA, cmdB] of entries) {
    // bits 0-5 note, bit 6 "absolute", bits 7-9 waveform, 10-12 command A,
    // 13-15 command B. The note is masked to 0x7f so bit 6 survives.
    const word0 = (note! & 0x7f) | ((wave! & 7) << 7) | (((cmdA! >> 8) & 7) << 10) | (((cmdB! >> 8) & 7) << 13)
    body.push(word0 >> 8, word0 & 0xff, cmdA! & 0xff, cmdB! & 0xff)
  }
  const nameOffset = 14 + body.length
  return thxParse(Uint8Array.from([
    0x54, 0x48, 0x58, 0, nameOffset >> 8, nameOffset & 0xff, 0x80, 1, 0, 0, 2, 1, 1, 0, ...body, 0, 0,
  ]))
}

describe('the envelope', () => {
  it('starts SILENT and climbs, which is why a THX note has an attack', () => {
    // attack: 4 frames up to $40
    const { p } = player(insModule({ 2: 4, 3: 0x40, 4: 1, 5: 0x40, 6: 100 }))
    const ch = p.channels[0]!
    expect(ch.envVolume).toBe(0)
    const seen: number[] = []
    for (let i = 0; i < 5; i++) {
      p.tick()
      seen.push(ch.envVolume >> 8)
    }
    // (0x40 << 8) / 4 = $1000 a frame, so $10, $20, $30 then the SNAP to $40
    expect(seen).toEqual([0x10, 0x20, 0x30, 0x40, 0x40])
  })

  it('snaps to the declared level rather than wherever the ramp got to', () => {
    // 3 frames to $40 is $1555 a frame, which lands on $3f.xx and not $40
    const { p } = player(insModule({ 2: 3, 3: 0x40, 4: 1, 5: 0x40, 6: 100 }))
    const ch = p.channels[0]!
    p.tick()
    p.tick()
    expect(ch.envVolume >> 8).toBe(0x2a)
    p.tick()
    // the third frame would reach $3f, and the snap makes it exactly $40
    expect(ch.envVolume).toBe(0x40 << 8)
  })

  it('runs attack, decay, sustain and release in that order', () => {
    const { p } = player(insModule({ 2: 1, 3: 0x40, 4: 1, 5: 0x20, 6: 2, 7: 1, 8: 0 }))
    const ch = p.channels[0]!
    const seen: number[] = []
    for (let i = 0; i < 6; i++) {
      p.tick()
      seen.push(ch.envVolume >> 8)
    }
    // attack to $40, decay to $20, two frames of sustain holding it, release to 0
    expect(seen).toEqual([0x40, 0x20, 0x20, 0x20, 0, 0])
  })
})

describe('the playlist', () => {
  it('picks the waveform, one-based so zero can mean "keep the last"', () => {
    const { p } = player(insModule({}, [[1, 1, 0, 0], [1, 0, 0, 0], [1, 4, 0, 0]]))
    const ch = p.channels[0]!
    p.tick()
    expect(ch.waveKind).toBe(0)
    p.tick()
    expect(ch.waveKind).toBe(0)
    p.tick()
    expect(ch.waveKind).toBe(3)
  })

  it('adds its note to the track\'s rather than replacing it', () => {
    // the track plays note 25; a playlist note of 1 is no offset at all
    const plain = player(insModule({}, [[1, 1, 0, 0]]))
    plain.p.tick()
    expect(plain.p.channels[0]!.period).toBe(THX_PERIODS[25])
    // and 13 is twelve semitones up, one octave
    const up = player(insModule({}, [[13, 1, 0, 0]]))
    up.p.tick()
    expect(up.p.channels[0]!.period).toBe(THX_PERIODS[37])
  })

  it('takes the note absolutely when bit 6 is set', () => {
    // note 1 with the fixed bit is note 1, not the track's note
    const m = insModule({}, [[1 | 0x40, 1, 0, 0]])
    const { p } = player(m)
    p.tick()
    expect(p.channels[0]!.fixedNote).toBe(true)
    expect(p.channels[0]!.period).toBe(THX_PERIODS[1])
  })

  it('STOPS at its last entry rather than looping', () => {
    const { p } = player(insModule({}, [[1, 1, 0, 0], [1, 4, 0, 0]]))
    const ch = p.channels[0]!
    p.tick()
    p.tick()
    expect([ch.waveKind, ch.playPos]).toEqual([3, 2])
    // ten more frames and it is still on the last waveform
    run(p, 10)
    expect([ch.waveKind, ch.playPos]).toEqual([3, 2])
  })

  it('loops when command 5 jumps back, which is the only way it does', () => {
    // The argument is the ZERO-based entry to resume at. `$15c0` stores
    // `arg - 1` and `$15c8` points four bytes short, and the `addi.b #$1` and
    // `addi.l #$4` at the end of the same pass put both back --- so command 5
    // with 0 goes to the first entry and with its OWN index sticks on itself.
    const { p } = player(insModule({}, [[1, 1, 0, 0], [1, 4, 0x500, 0]]))
    const ch = p.channels[0]!
    p.tick()
    expect(ch.waveKind).toBe(0)
    p.tick()
    expect(ch.waveKind).toBe(3)
    p.tick()
    expect(ch.waveKind).toBe(0)
  })

  it('command 5 pointing at its own entry is a one-entry loop, not a jump back', () => {
    const { p } = player(insModule({}, [[1, 1, 0, 0], [1, 4, 0x501, 0]]))
    const ch = p.channels[0]!
    run(p, 6)
    expect(ch.waveKind).toBe(3)
    expect(ch.playPos).toBe(1)
  })

  it('command 7 sets the frames an entry lasts', () => {
    const { p } = player(insModule({}, [[1, 1, 0x703, 0], [1, 4, 0, 0]]))
    const ch = p.channels[0]!
    p.tick()
    expect(ch.playSpeed).toBe(3)
    run(p, 2)
    // still the first entry's waveform: the second is three frames away
    expect(ch.waveKind).toBe(0)
    p.tick()
    expect(ch.waveKind).toBe(3)
  })
})

describe('the waveform that reaches the sink', () => {
  it('is the triangle of the instrument\'s own wave length, tiled to 640', () => {
    const { p, audio } = player(insModule({ 1: 1 }, [[1, 1, 0, 0]]))
    p.tick()
    const wave = audio.voiceState[0]!.pcm!
    expect(wave.length).toBe(640)
    // wave length 1 is the 8-byte triangle, and 640 is 80 whole copies of it
    expect(Array.from(wave.subarray(0, 8))).toEqual([0, 64, 127, 64, 0, -64, -128, -64])
    expect(Array.from(wave.subarray(8, 16))).toEqual([0, 64, 127, 64, 0, -64, -128, -64])
  })

  it('is a different 640 bytes every frame for noise', () => {
    const { p, audio } = player(insModule({}, [[1, 4, 0, 0]]))
    p.tick()
    const first = Array.from(audio.voiceState[0]!.pcm!)
    p.tick()
    const second = Array.from(audio.voiceState[0]!.pcm!)
    expect(first).not.toEqual(second)
    expect(second.length).toBe(640)
  })

  it('changes when the filter position moves, and that is the whole point', () => {
    // playlist command 0 sets the filter position outright
    const dark = player(insModule({}, [[1, 1, 0x001, 0]]))
    dark.p.tick()
    const a = Array.from(dark.audio.voiceState[0]!.pcm!.subarray(0, 8))
    const bright = player(insModule({}, [[1, 1, 0x03f, 0]]))
    bright.p.tick()
    const b = Array.from(bright.audio.voiceState[0]!.pcm!.subarray(0, 8))
    expect(a).not.toEqual(b)
    // and neither is the dry triangle
    expect(a).not.toEqual([0, 127, 0, -128, 0, 127, 0, -128])
  })
})
