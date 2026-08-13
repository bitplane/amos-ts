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
import { isThxModule, thxParse, thxWalkEnd } from './thx'

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
