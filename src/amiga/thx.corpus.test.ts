/**
 * The nine THX modules in the corpus, walked end to end.
 *
 * They ship with Kyzer's THX.lib distribution, under
 * `THX.lib/example/songs`, and they are the only THX material anywhere in the
 * 45,743 files. Eight of the nine are Pink/Abyss's own tunes, including the
 * conversions of Hawkeye's loader and Commando's highscore music, so they are
 * what the THX editor actually wrote rather than what a reading of it produces.
 *
 * The check that matters is the name offset. The replayer never reads it —
 * `addq.w #$2,a0` at $4e0 steps over the field — so it is written by the
 * editor and consumed by nothing, which makes it an independent statement of
 * where the five variable-length sections end. If the subsong stride, the
 * eight bytes a position, the three a row, the +1 for a stored track 0 or the
 * 22-plus-playlist instrument walk were wrong by ONE BYTE on any module, the
 * walk would miss it. All nine land exactly.
 *
 * Reads the corpus at `../amos-files`, which is not part of this repository,
 * so the suite skips when it is absent.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { corpusFile, corpusIndex, haveCorpus } from '../cli/corpus'
import { NullAudio } from './paula'
import { isThxModule, thxParse, thxWalkEnd } from './thx'
import { THX_MAX_NOTE, THX_PERIODS, ThxPlayer } from './thxplay'
import {
  THX_NOISE_BYTES, THX_OFF_NOISE, THX_OFF_SAWTOOTHS, THX_OFF_SQUARES, THX_OFF_TRIANGLES,
  THX_SAWTOOTH_SIZES, THX_SQUARE_BYTES, THX_SQUARE_COUNT, THX_TRIANGLE_SIZES, thxWaveSet,
} from './thxwaves'

const have = haveCorpus()

/**
 * By checksum, because the paths hold spaces and the corpus is indexed by
 * hash. Sizes are the shipped ones, so a truncated extraction reads as a
 * failure here rather than as a parse error — 7-Zip has silently shortened
 * corpus files twice.
 */
const MODULES = [
  { name: 'Back in 1986', sha: '2014b91ce44371a11a8d1e7e901a7ae1f8e8e05faf408d68019375ab55cdcfb5', size: 1364 },
  { name: 'Commando-Highscore', sha: 'd058a3fe18dffa36740726a3c75c7473a8e674400db9d6d8198a2009ea23dcd2', size: 737 },
  { name: 'Drums', sha: '630f2c49fb47a36b420c63a456907e89f1b0407f3d379e5de795567abe8fb950', size: 352 },
  { name: 'extra', sha: '400ec6bfc4bb2048742637163502a907e23af4cc5794eb1cfc29b5d9ad0c7a4d', size: 3312 },
  { name: 'Hawkeye-Loader', sha: 'c86ccab498711ca2d8de578f08a5e3de0fb129549b66813d0953ec8dd3abb51e', size: 744 },
  { name: 'Inside', sha: 'd68751edd11966e8911750565c35f46a0ded5b2417b9739858bbdd7741accea3', size: 2574 },
  { name: 'Raider of the Daim', sha: 'bdcb066445f558742abc2c920d9a47c68545c768f9e3e05cfc1d6ab6dd687de7', size: 1381 },
  { name: 'Sometimes', sha: 'df3c15d89ca7c45b704ab6c0a969bd6da729e9d502dd35a906698a104f0d623f', size: 3249 },
  { name: 'Urban Shuffle', sha: 'a64fecf89fed1dd55d84c79609d388849020c86ceb12c607a03d97d23ac1bbb1', size: 1695 },
] as const

// runs at COLLECTION, even under describe.skipIf -- see ../cli/corpus.ts
const index = have ? corpusIndex() : new Map<string, string>()
function moduleBytes(sha: string): Uint8Array | null {
  const path = corpusFile(sha, index)
  return path === null ? null : new Uint8Array(readFileSync(path))
}

describe.skipIf(!have)('the nine THX modules in the corpus', () => {
  for (const m of MODULES) {
    describe(m.name, () => {
      const bytes = moduleBytes(m.sha)

      it.skipIf(bytes === null)('is a THX module of the size the index records', () => {
        expect(bytes!.length).toBe(m.size)
        expect(isThxModule(bytes!)).toBe(true)
      })

      it.skipIf(bytes === null)('walks to the name offset exactly', () => {
        expect(thxWalkEnd(bytes!)).toBe((bytes![4]! << 8) | bytes![5]!)
      })

      it.skipIf(bytes === null)('parses, and its name block ends on the last byte of the file', () => {
        const mod = thxParse(bytes!)
        expect(mod.name).toBe(m.name)
        // one string for the song and one an instrument, and nothing after
        const strings = mod.instruments.length + 1
        let p = mod.nameOffset
        for (let i = 0; i < strings; i++) {
          const e = bytes!.indexOf(0, p)
          expect(e).toBeGreaterThanOrEqual(0)
          p = e + 1
        }
        expect(p).toBe(bytes!.length)
      })

      it.skipIf(bytes === null)('has four channels a position and every track number in range', () => {
        const mod = thxParse(bytes!)
        expect(mod.positions.length).toBe(mod.songLength)
        for (const pos of mod.positions) {
          expect(pos.length).toBe(4)
          for (const ch of pos) expect(ch.track).toBeLessThan(mod.tracks.length)
        }
      })

      /**
       * Play the whole song once.
       *
       * What this really checks is that every track number a position hands
       * out, and every instrument number a step carries, resolves. The
       * replayer indexes the track array with no bounds test at all
       * (`mulu.w d1,d0 / add.w $446(a6),d0 / mulu.w #$3,d0` at $b8c), so a
       * reading that was off by one would walk into the wrong array — here,
       * on real material, rather than in some later stage on a fixture.
       *
       * The cap is four times the nominal length, which leaves room for a
       * command F to slow the song down without leaving room for a jump loop
       * to run forever.
       */
      it.skipIf(bytes === null)('sequences the whole song without leaving the module', () => {
        const mod = thxParse(bytes!)
        const p = new ThxPlayer(() => new NullAudio())
        p.load(mod)
        const cap = mod.songLength * mod.trackLength * 6 * 4
        // collected rather than asserted per frame: `extra` runs 8,160 of them
        // and an expect() a channel would be 32,000 assertions for one song
        const bad: string[] = []
        let frames = 0
        while (!p.ended && frames < cap) {
          p.tick()
          frames++
          if (p.position >= mod.songLength) bad.push(`frame ${frames}: position ${p.position}`)
          if (p.row >= mod.trackLength) bad.push(`frame ${frames}: row ${p.row}`)
          for (const ch of p.channels) {
            if (ch.track >= mod.tracks.length) bad.push(`frame ${frames}: track ${ch.track}`)
            if (ch.instrument > mod.instruments.length) bad.push(`frame ${frames}: instrument ${ch.instrument}`)
          }
        }
        expect(bad.slice(0, 5)).toEqual([])
        expect(p.ended).toBe(true)
        // and it wrapped to the restart position rather than stopping
        expect(p.playing).toBe(true)
        expect(p.position).toBe(mod.restart)
      })

      it.skipIf(bytes === null)('names every instrument it declares', () => {
        const mod = thxParse(bytes!)
        for (const ins of mod.instruments) {
          expect(ins.header.length).toBe(22)
          expect(ins.playlist.length).toBe(ins.header[21]! * 4)
          expect(typeof ins.name).toBe('string')
        }
      })
    })
  }

  it('all omit track 0, which is why thx.test.ts has to build the other case', () => {
    const parsed = MODULES.map((m) => moduleBytes(m.sha)).filter((b) => b !== null)
    expect(parsed.length).toBe(9)
    expect(parsed.every((b) => !thxParse(b).trackZeroStored)).toBe(true)
  })

  it('all declare version 0, which is the only version THX 0.6 accepts', () => {
    // `cmpi.l #$54485800,(a0)+` at $4d2 --- see thx.ts. Jotre would take any
    // of them, and there is nothing here to tell the two apart with.
    const parsed = MODULES.map((m) => moduleBytes(m.sha)).filter((b) => b !== null)
    expect(parsed.map((b) => thxParse(b).version)).toEqual(Array(9).fill(0))
  })

  it('all declare no subsongs, so StartSong never reads the table on any of them', () => {
    const parsed = MODULES.map((m) => moduleBytes(m.sha)).filter((b) => b !== null)
    expect(parsed.every((b) => thxParse(b).subSongs.length === 0)).toBe(true)
  })

  it('use track lengths of 8, 16 and 32 and nothing else', () => {
    const parsed = MODULES.map((m) => moduleBytes(m.sha)).filter((b) => b !== null)
    expect([...new Set(parsed.map((b) => thxParse(b).trackLength))].sort((a, c) => a - c)).toEqual([8, 16, 32])
  })
})

/**
 * What can be checked when no other player exists.
 *
 * #130 gave MED, both MOD engines and P61 an independent reading to be
 * compared with. THX gets none: libopenmpt refuses the format, nothing else on
 * this machine reads it, and the one npm package named for it is an empty
 * placeholder. So these are the checks that answer to something other than the
 * reading that produced the code.
 *
 * The synthesis itself — envelopes, playlists, the filter sweep — is NOT
 * covered by any of them, and nothing here pretends otherwise.
 */
describe.skipIf(!have)('THX, checked without a second player', () => {
  const parsed = MODULES.map((m) => ({ name: m.name, bytes: moduleBytes(m.sha) })).filter((m) => m.bytes !== null)

  it('has a period table that is equal temperament, whatever the binary says', () => {
    // 84 words read out of two libraries. A mistyped one would break the ratio
    // between neighbouring semitones; integer periods alone cost 0.4% at the
    // top of the table, where one count is nearly a percent.
    let worst = 0
    for (let n = 2; n <= THX_MAX_NOTE; n++) {
      worst = Math.max(worst, Math.abs(THX_PERIODS[n - 1]! / THX_PERIODS[n]! - Math.pow(2, 1 / 12)))
    }
    expect(worst).toBeLessThan(0.005)
    expect(THX_PERIODS[1]).toBe(3424) // 856 * 4, ProTracker's C-1 two octaves down
    expect(THX_PERIODS[THX_MAX_NOTE]).toBe(113)
  })

  it('generates triangles that rise and fall in equal steps', () => {
    const set = thxWaveSet()
    let at = THX_OFF_TRIANGLES
    for (const n of THX_TRIANGLE_SIZES) {
      const w = [...set.slice(at, at + n)]
      const steps = w.slice(1).map((v, i) => v - w[i]!)
      expect(Math.max(...w), `triangle ${n} peak`).toBe(127)
      expect(Math.min(...w), `triangle ${n} trough`).toBe(-128)
      // one distinct rise and one distinct fall, give or take the wrap
      expect(new Set(steps.filter((s) => s > 0)).size, `triangle ${n} rises`).toBeLessThanOrEqual(2)
      expect(new Set(steps.filter((s) => s < 0)).size, `triangle ${n} falls`).toBeLessThanOrEqual(2)
      at += n
    }
  })

  it('generates sawtooths that are one straight line', () => {
    const set = thxWaveSet()
    let at = THX_OFF_SAWTOOTHS
    for (const n of THX_SAWTOOTH_SIZES) {
      const w = [...set.slice(at, at + n)]
      const steps = new Set(w.slice(1).map((v, i) => v - w[i]!))
      expect(w[0], `sawtooth ${n} starts at the bottom`).toBe(-128)
      expect(steps.size, `sawtooth ${n} is linear`).toBe(1)
      at += n
    }
  })

  it('generates thirty-two pulse widths, each two levels and nothing between', () => {
    const set = thxWaveSet()
    const widths: number[] = []
    for (let i = 0; i < THX_SQUARE_COUNT; i++) {
      const at = THX_OFF_SQUARES + i * THX_SQUARE_BYTES
      const w = [...set.slice(at, at + THX_SQUARE_BYTES)]
      expect(new Set(w).size, `square ${i} levels`).toBe(2)
      widths.push(w.filter((v) => v > 0).length)
    }
    // 2 to 64 of 128, rising by two: the pulse width sweep an instrument uses
    expect(widths[0]).toBe(2)
    expect(widths[THX_SQUARE_COUNT - 1]).toBe(64)
    expect(widths.every((w, i) => i === 0 || w > widths[i - 1]!)).toBe(true)
  })

  it('generates noise that changes sign about half the time', () => {
    const set = thxWaveSet()
    const noise = [...set.slice(THX_OFF_NOISE, THX_OFF_NOISE + THX_NOISE_BYTES)]
    let flips = 0
    for (let i = 1; i < noise.length; i++) if (Math.sign(noise[i]!) !== Math.sign(noise[i - 1]!)) flips++
    expect(flips / noise.length).toBeGreaterThan(0.4)
    expect(flips / noise.length).toBeLessThan(0.6)
    expect(new Set(noise).size).toBeGreaterThan(200)
  })

  /**
   * The sequencer against the parser: two readings of two different parts of
   * the format, and they have to agree about where the song is.
   *
   * The one thing that legitimately differs is command $3. Tone portamento
   * slides towards a note without taking it, so the channel keeps the note it
   * had, and every mismatch across all nine modules is one of those: 114 in
   * Urban Shuffle, 18 in Inside, 12 in Extra, none anywhere else.
   */
  it('walks all nine songs exactly where the score says, portamento aside', () => {
    for (const { name, bytes } of parsed) {
      const m = thxParse(bytes!)
      const player = new ThxPlayer(() => new NullAudio())
      player.load(m)
      let unexplained = 0
      let rows = 0
      let last = ''
      for (let frame = 0; frame < 2000 && !player.ended; frame++) {
        const at = `${player.position}:${player.row}`
        const position = player.position
        const row = player.row
        player.tick()
        if (at === last) continue
        last = at
        rows++
        for (let c = 0; c < 4; c++) {
          const where = m.positions[position]?.[c]
          const step = m.tracks[where?.track ?? 0]?.[row]
          const channel = player.channels[c]!
          expect(channel.transpose, `${name} pos ${position} ch ${c} transpose`).toBe(where?.transpose ?? 0)
          if (!step || step.note === 0 || step.command === 3) continue
          if (channel.note !== step.note) unexplained++
        }
      }
      expect(rows, `${name} rows walked`).toBeGreaterThan(30)
      expect(unexplained, `${name} notes the player did not take`).toBe(0)
    }
  })
})
