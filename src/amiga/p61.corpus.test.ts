/**
 * Three real P61 modules, which this file's own header used to say did not
 * exist. A signature search found none because the signature is OPTIONAL —
 * `cmp.l #"P61A",(a0)+ / beq / subq.l #4,a0` rewinds when it is absent — and
 * not one of the three has it. They are memory banks inside AMOS programs:
 *
 *   DOOM Productions' P61_Example.amos, bank 3 "P61mod", 7,244 bytes
 *   8ohms_11.AMOS, banks 5 and 6, both named "Tracker", 204,736 and 8,408
 *
 * The second program was found by sweeping the corpus for the invariant this
 * file tests below rather than for a name or a magic number, which is the only
 * thing that works on a format with neither.
 *
 * They matter because the decoder was written from `610.2_devpac3.asm` and
 * checked against nothing but that reading. Two bugs came out of listening to
 * the first of them: the sample flags, and then `decodeChannel` inserting a
 * row at every back-reference, which moved 63.5% of the module's cells.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseAmosFile } from '../loader/amosfile'
import { corpusFile, haveCorpus } from '../cli/corpus'
import { decodePattern, p61Song, p61ToMod, parseP61, type P61Module } from './p61'
import { parseMod } from './protracker'

/** sources/kyzer-dme/files/amospro_dme_v2.0/examples/P61_Example.amos */
const DOOM = '7c5a772011d90cc995974a126fcc058fccd21f7133955b24650247664e54c609'
/** sources/aminet-amos-elsewhere/files/8ohms_11_src/8ohms_11.AMOS */
const EIGHT_OHMS = 'd2f9b4cc1c6d3b69a2d0d9550bfef45c8cea8ae395e2d8409bf754cf0ec85652'

function bankOf(sha: string, want: number): Uint8Array | null {
  if (!haveCorpus()) return null
  const path = corpusFile(sha)
  if (!path) return null
  const file = parseAmosFile(new Uint8Array(readFileSync(path)))
  const found = file?.banks.find((b) => 'data' in b && (b as { number?: number }).number === want)
  return found && 'data' in found ? (found.data as Uint8Array) : null
}

const bank = bankOf(DOOM, 3)
const others: Array<[string, Uint8Array | null]> = [
  ['8ohms bank 5', bankOf(EIGHT_OHMS, 5)],
  ['8ohms bank 6', bankOf(EIGHT_OHMS, 6)],
]

describe.skipIf(!bank)('the P61 module in P61_Example.amos', () => {
  const data = bank!
  const module = parseP61(data)!

  it('is a headerless P61 of 7,244 bytes, which is why no signature search found it', () => {
    expect(data.length).toBe(7244)
    expect(String.fromCharCode(...data.subarray(0, 4))).not.toBe('P61A')
    expect(module).not.toBeNull()
  })

  it('reads its own structure: 20 patterns, 9 samples, 21 positions', () => {
    expect(module.patternOffsets).toHaveLength(20)
    expect(module.samples).toHaveLength(9)
    expect(module.positions).toHaveLength(21)
    // the song revisits pattern 14, which is what a position list is for
    expect(module.positions).toEqual([11, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 18, 19, 0, 13, 14, 15, 14, 16, 17])
  })

  it('is buffered rather than delta-coded in place, which are different bits', () => {
    // byte 3 is $49: bit 6 set (a sample buffer is wanted), bit 7 clear (no
    // in-place running difference), and nine in the low five
    expect(data[3]).toBe(0x49)
    expect(module.buffered).toBe(true)
    expect(module.packedSamples).toBe(false)
  })

  /**
   * The measurement that settles the whole reading.
   *
   * A four-bit packed sample costs `words` BYTES and yields `words * 2`; an
   * unpacked one costs `words * 2`. Add up what the table asks for and it has
   * to land inside the file. Reading the pack flag off byte 3 instead of off
   * each sample's finetune byte asked for 9,600 bytes of a 7,244-byte file,
   * and every sample past the second was zeros.
   */
  it('accounts for the file to within nine bytes', () => {
    const start = (data[0]! << 8) | data[1]!
    const consumed = module.samples.reduce((n, s) => n + (s.packed ? s.words : s.words * 2), 0)
    expect(start).toBe(4868)
    expect(start + consumed).toBe(7235)
    expect(start + consumed).toBeLessThanOrEqual(data.length)
    expect(data.length - (start + consumed)).toBeLessThan(16)
  })

  it('decodes nine waveforms rather than nine stretches of noise', () => {
    for (const [i, s] of module.samples.entries()) {
      const pcm = s.pcm!
      let sum = 0
      for (let k = 1; k < pcm.length; k++) sum += Math.abs(pcm[k]! - pcm[k - 1]!)
      const step = sum / Math.max(1, pcm.length - 1)
      // uniform random bytes average about 85 between neighbours; PCM at these
      // rates stays under 25, and the packed stream read raw came out at 60+
      expect(step, `sample ${i} mean step`).toBeLessThan(30)
    }
  })

  it('decodes patterns with notes on every channel', () => {
    const rows = decodePattern(module, module.positions[0]!)
    expect(rows).toHaveLength(4)
    for (const channel of rows) expect(channel.length).toBeGreaterThan(0)
    const notes = rows.flat().filter((r) => r.note !== 0)
    expect(notes.length).toBeGreaterThan(8)
    // every note has to land in the period table the replay indexes with it
    for (const r of notes) expect(r.note).toBeLessThanOrEqual(0x7e)
  })

  /**
   * The only way this module gets a second opinion: no player on this machine
   * reads P61, so the unpacked patterns go out as a MOD and libopenmpt reads
   * that. Rendered and compared, the two agree to a pitch-class cosine of
   * 0.9983 and an envelope correlation of 0.999 for the first five seconds.
   *
   * They part company after 6.48 seconds, and it is not a defect on either
   * side: that row carries `E60` on channel 0 and `E61` on channel 1 at once,
   * and P61 keeps ONE loop counter for the whole song where ProTracker gives
   * each channel its own. This module has 32 pattern loops.
   */
  it('writes back out as a MOD another player can read', () => {
    const mod = p61ToMod(module)
    expect(String.fromCharCode(...mod.subarray(1080, 1084))).toBe('M.K.')
    expect(mod[950]).toBe(21) // the song length, where a MOD keeps it
    const back = parseMod(mod)!
    expect(back.positions).toEqual(module.positions)
    // every note the P61 stream held survives the trip through periods
    const ours = p61Song(module).pattern(11)
    const theirs = back.pattern(11)
    const notes = (rows: readonly (readonly { note: number }[])[]): number[] =>
      rows.flatMap((r) => r.map((c) => c.note))
    expect(notes(theirs)).toEqual(notes(ours))
  })

  it('becomes a song the shared ProTracker replay can load', () => {
    const song = p61Song(module)
    expect(song.positions).toHaveLength(21)
    expect(song.samples).toHaveLength(9)
    expect(song.pattern(0).length).toBeGreaterThan(0)
  })
})

/**
 * The two checks that do not come from the reading that produced the decoder.
 *
 * A sample table has to account for the buffer it sits in, and tracker music
 * is quantised: a note lands on an even row far more often than an odd one,
 * because that is what an eighth note is. A decode that has slipped scores
 * about a half, which is what you get from putting notes down at random.
 */
describe.skipIf(!bank || others.some(([, b]) => !b))('every P61 module in the corpus', () => {
  const all: Array<[string, P61Module]> = [
    ['P61_Example bank 3', parseP61(bank!)!],
    ...others.map(([name, d]) => [name, parseP61(d!)!] as [string, P61Module]),
  ]
  const sizes = new Map<string, number>([
    ['P61_Example bank 3', bank!.length],
    ['8ohms bank 5', others[0]![1]!.length],
    ['8ohms bank 6', others[1]![1]!.length],
  ])

  it('parses all three, none of them signed', () => {
    expect(all).toHaveLength(3)
    for (const [name, m] of all) {
      expect(m.patternOffsets.length, name).toBeGreaterThan(0)
      expect(m.positions.length, name).toBeGreaterThan(0)
      expect(m.positions.every((p) => p < m.patternOffsets.length), name).toBe(true)
    }
  })

  it('accounts for every file to within 32 bytes', () => {
    for (const [name, m] of all) {
      const data = name === 'P61_Example bank 3' ? bank! : others.find(([n]) => n === name)![1]!
      const start = (data[0]! << 8) | data[1]!
      const consumed = m.samples.reduce((n, s) => n + (s.aliasOf !== null ? 0 : s.packed ? s.words : s.words * 2), 0)
      expect(start + consumed, `${name} sample area`).toBeLessThanOrEqual(sizes.get(name)!)
      expect(sizes.get(name)! - (start + consumed), `${name} slack`).toBeLessThanOrEqual(32)
    }
  })

  it('puts more than half its notes on even rows, which is what quantised music does', () => {
    for (const [name, m] of all) {
      let even = 0
      let notes = 0
      for (let p = 0; p < m.patternOffsets.length; p++) {
        for (const channel of decodePattern(m, p)) {
          for (const [row, cell] of channel.entries()) {
            if (cell.note === 0) continue
            notes++
            if (row % 2 === 0) even++
          }
        }
      }
      expect(notes, `${name} notes`).toBeGreaterThan(200)
      // 56% to 71% measured; the decoder that inserted a row at every
      // back-reference scored 43%, 50% and 48% -- at or below chance
      expect(even / notes, `${name} on even rows`).toBeGreaterThan(0.55)
    }
  })

  it('writes each one out as a MOD another player can read', () => {
    for (const [name, m] of all) {
      const mod = p61ToMod(m)
      expect(String.fromCharCode(...mod.subarray(1080, 1084)), name).toBe('M.K.')
      expect(parseMod(mod)!.positions, name).toEqual(m.positions)
    }
  })
})
