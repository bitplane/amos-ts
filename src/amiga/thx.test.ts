/**
 * The THX parser against modules built here, byte by byte.
 *
 * Every module in the corpus omits track 0 and declares no subsongs, so two of
 * the three rules `thx.ts` reads off the replayer have nothing real to check
 * them. They are checked here instead, on files assembled to exercise exactly
 * those branches. The nine real modules are in `thx.corpus.test.ts`, and what
 * they prove is different: that the reading walks a file the THX editor wrote.
 */
import { describe, expect, it } from 'vitest'
import { isThxModule, thxParse, thxSubSongPosition, thxWalkEnd } from './thx'

interface Build {
  version?: number
  songLength: number
  restart?: number
  trackLength: number
  /** the HIGHEST track number, as +11 stores it */
  highestTrack: number
  trackZeroStored?: boolean
  subSongs?: number[]
  /** four `[track, transpose]` pairs a position */
  positions: number[][][]
  /** the STORED tracks, in file order, each `[note, instrument, command, data]` */
  tracks: number[][][]
  /** 22 header bytes and a playlist, whose length goes into byte 21 */
  instruments: { header: number[]; playlist: number[] }[]
  names: string[]
}

/** assemble one, in the order `InitModule` at $4c6 walks */
function build(b: Build): Uint8Array {
  const body: number[] = []
  for (const s of b.subSongs ?? []) body.push(s >> 8, s & 0xff)
  for (const pos of b.positions) for (const [track, transpose] of pos) body.push(track!, transpose! & 0xff)
  for (const track of b.tracks) {
    for (const [note, inst, cmd, data] of track) {
      const word = (note! << 10) | (inst! << 4) | cmd!
      body.push(word >> 8, word & 0xff, data!)
    }
  }
  for (const ins of b.instruments) {
    const header = [...ins.header]
    header[21] = ins.playlist.length / 4
    body.push(...header, ...ins.playlist)
  }

  const nameOffset = 14 + body.length
  const head = [
    0x54,
    0x48,
    0x58,
    b.version ?? 0,
    nameOffset >> 8,
    nameOffset & 0xff,
    ((b.trackZeroStored ?? false ? 0 : 0x8000) | b.songLength) >>> 8,
    b.songLength & 0xff,
    (b.restart ?? 0) >> 8,
    (b.restart ?? 0) & 0xff,
    b.trackLength,
    b.highestTrack,
    b.instruments.length,
    (b.subSongs ?? []).length,
  ]
  const names: number[] = []
  for (const n of b.names) names.push(...[...n].map((c) => c.charCodeAt(0)), 0)
  return Uint8Array.from([...head, ...body, ...names])
}

/** 22 bytes with the envelope in 2..8 and something recognisable everywhere else */
const header = (envelope: number[]): number[] => [0x11, 0x05, ...envelope, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 0]

const ONE_TRACK: Build = {
  songLength: 1,
  trackLength: 2,
  highestTrack: 1,
  positions: [
    [
      [1, 0],
      [1, -12],
      [0, 0],
      [1, 24],
    ],
  ],
  tracks: [
    [
      [60, 63, 15, 0xff],
      [0, 0, 0, 0],
    ],
  ],
  instruments: [{ header: header([1, 2, 3, 4, 5, 6, 7]), playlist: [0xa, 0xb, 0xc, 0xd] }],
  names: ['Song', 'Instrument'],
}

describe('the THX module format', () => {
  it('recognises the magic and nothing else about the header', () => {
    expect(isThxModule(Uint8Array.from([0x54, 0x48, 0x58, 0]))).toBe(true)
    // the version byte is NOT part of the test here --- see thx.ts on why the
    // two extensions disagree about it
    expect(isThxModule(Uint8Array.from([0x54, 0x48, 0x58, 0x99]))).toBe(true)
    expect(isThxModule(Uint8Array.from([0x54, 0x48, 0x59, 0]))).toBe(false)
    expect(isThxModule(Uint8Array.from([0x54, 0x48]))).toBe(false)
    expect(() => thxParse(Uint8Array.from([0x54, 0x48, 0x59, 0]))).toThrow(/not a THX module/)
  })

  it('reads the header fields at the offsets InitModule stores them from', () => {
    const m = thxParse(build({ ...ONE_TRACK, version: 3, restart: 7 }))
    expect(m.version).toBe(3)
    expect(m.songLength).toBe(1)
    expect(m.restart).toBe(7)
    expect(m.trackLength).toBe(2)
    expect(m.trackZeroStored).toBe(false)
    expect(m.name).toBe('Song')
    expect(m.instruments[0]!.name).toBe('Instrument')
  })

  it('unpacks a step as 6 bits of note, 6 of instrument, 4 of command and a byte', () => {
    const m = thxParse(build(ONE_TRACK))
    // track 1, because track 0 is not stored
    expect(m.tracks[1]![0]).toEqual({ note: 60, instrument: 63, command: 15, data: 0xff })
    expect(m.tracks[1]![1]).toEqual({ note: 0, instrument: 0, command: 0, data: 0 })
  })

  it('splits the instrument number across both bytes, the way $884 reassembles it', () => {
    // instrument 63 is $3f: two bits in byte 0 and a nibble in byte 1
    const raw = build(ONE_TRACK)
    // 14 of header, no subsongs, one position of 8, and the tracks begin
    const at = 14 + 8
    expect(raw[at]).toBe((60 << 2) | (63 >> 4))
    expect(raw[at + 1]).toBe(((63 & 0xf) << 4) | 15)
  })

  it('sign-extends the transpose, which `ext.w d2` at $da0 makes signed', () => {
    const m = thxParse(build(ONE_TRACK))
    expect(m.positions[0]!.map((p) => p.transpose)).toEqual([0, -12, 0, 24])
    expect(m.positions[0]!.map((p) => p.track)).toEqual([1, 1, 0, 1])
  })

  it('names the seven envelope bytes and keeps all 22 verbatim', () => {
    const m = thxParse(build(ONE_TRACK))
    const ins = m.instruments[0]!
    expect(ins.envelope).toEqual({
      attackFrames: 1,
      attackVolume: 2,
      decayFrames: 3,
      decayVolume: 4,
      sustainFrames: 5,
      releaseFrames: 6,
      releaseVolume: 7,
    })
    // `andi.b #$7,d1` at $90c --- three bits of the second byte, so 5 not $05
    expect(ins.waveLength).toBe(5)
    expect(ins.header.length).toBe(22)
    expect(ins.header[0]).toBe(0x11)
    expect(ins.header[21]).toBe(1)
    expect(Array.from(ins.playlist)).toEqual([0xa, 0xb, 0xc, 0xd])
  })

  it('does not alias the caller, because Jotre writes into the module it is handed', () => {
    const raw = build(ONE_TRACK)
    const m = thxParse(raw)
    const before = m.instruments[0]!.header[0]
    raw.fill(0xee)
    expect(m.instruments[0]!.header[0]).toBe(before)
  })

  describe('track 0', () => {
    it('is silence when the file omits it, and still sits at index 0', () => {
      const m = thxParse(build(ONE_TRACK))
      expect(m.trackZeroStored).toBe(false)
      expect(m.tracks.length).toBe(2)
      expect(m.tracks[0]).toEqual([
        { note: 0, instrument: 0, command: 0, data: 0 },
        { note: 0, instrument: 0, command: 0, data: 0 },
      ])
    })

    it('is read from the file when bit 15 is clear, and one more track is stored', () => {
      const stored = build({
        ...ONE_TRACK,
        trackZeroStored: true,
        tracks: [
          [
            [1, 1, 0, 0],
            [0, 0, 0, 0],
          ],
          [
            [60, 63, 15, 0xff],
            [0, 0, 0, 0],
          ],
        ],
      })
      const m = thxParse(stored)
      expect(m.trackZeroStored).toBe(true)
      expect(m.tracks.length).toBe(2)
      expect(m.tracks[0]![0]).toEqual({ note: 1, instrument: 1, command: 0, data: 0 })
      expect(m.tracks[1]![0]!.note).toBe(60)
      // the two files differ by exactly one track: 2 rows of 3 bytes
      expect(stored.length - build(ONE_TRACK).length).toBe(6)
    })
  })

  describe('subsongs', () => {
    const withSubs = build({ ...ONE_TRACK, subSongs: [0, 4, 9] })

    it('are one word each, and shift everything after them', () => {
      const m = thxParse(withSubs)
      expect(m.subSongs).toEqual([0, 4, 9])
      expect(withSubs.length - build(ONE_TRACK).length).toBe(6)
      // and the rest still reads, which is the point of the shift
      expect(m.tracks[1]![0]!.note).toBe(60)
    })

    it('resolve the way StartSong at $570 resolves them', () => {
      const m = thxParse(withSubs)
      // 0 never touches the table
      expect(thxSubSongPosition(m, 0)).toBe(0)
      // and the rest are ONE-based into it --- `subq.w #$1,d0`
      expect(thxSubSongPosition(m, 1)).toBe(0)
      expect(thxSubSongPosition(m, 2)).toBe(4)
      expect(thxSubSongPosition(m, 3)).toBe(9)
      // bit 15 says the argument IS a position
      expect(thxSubSongPosition(m, 0x8000 | 12)).toBe(12)
    })
  })

  describe('a short file', () => {
    const full = build(ONE_TRACK)
    const cases = [
      ['the position table', 14 + 4],
      ['the tracks', 14 + 8 + 3],
      ['the tracks', 14 + 8 + 5],
    ] as const

    for (const [what, len] of cases) {
      it(`is refused where the replayer would walk off the bank: ${what} at ${String(len)}`, () => {
        expect(() => thxParse(full.subarray(0, len))).toThrow(/short/)
      })
    }

    it('is refused mid-instrument too, which is where the playlist length lives', () => {
      // 14 header + 8 position + 6 track = 28, then 22 of instrument
      expect(() => thxParse(full.subarray(0, 28 + 10))).toThrow(/instrument 1/)
      expect(() => thxParse(full.subarray(0, 28 + 24))).toThrow(/instrument 1's playlist/)
    })
  })

  it('walks to the name offset the header declares', () => {
    for (const m of [build(ONE_TRACK), build({ ...ONE_TRACK, subSongs: [4] }), build({ ...ONE_TRACK, trackZeroStored: true, tracks: [ONE_TRACK.tracks[0]!, ONE_TRACK.tracks[0]!] })]) {
      expect(thxWalkEnd(m)).toBe((m[4]! << 8) | m[5]!)
    }
  })
})
