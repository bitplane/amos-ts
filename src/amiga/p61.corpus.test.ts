/**
 * A real P61 module, which this file's own header used to say did not exist.
 *
 * The claim was that no P61 module is in the corpus because nothing in it
 * carries the `P61A` signature. The signature is OPTIONAL — `cmp.l #"P61A",
 * (a0)+ / beq / subq.l #4,a0` rewinds when it is absent — and DOOM
 * Productions' own `P61_Example.amos` carries one without it, in memory bank
 * 3, named `P61mod`. Seven thousand bytes of module that a signature search
 * cannot see.
 *
 * It matters because the decoder was written from `610.2_devpac3.asm` and
 * checked against nothing but that reading, and the reading had the sample
 * flags wrong. What caught it was listening: the rhythm was right and the
 * instruments were noise. What PROVES it is the arithmetic below, where the
 * sample area lands nine bytes short of the end of the file instead of 2,356
 * bytes past it.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseAmosFile } from '../loader/amosfile'
import { corpusFile, haveCorpus } from '../cli/corpus'
import { decodePattern, p61Song, p61ToMod, parseP61 } from './p61'
import { parseMod } from './protracker'

/** sources/kyzer-dme/files/amospro_dme_v2.0/examples/P61_Example.amos */
const EXAMPLE = '7c5a772011d90cc995974a126fcc058fccd21f7133955b24650247664e54c609'

const bank = ((): Uint8Array | null => {
  if (!haveCorpus()) return null
  const path = corpusFile(EXAMPLE)
  if (!path) return null
  const file = parseAmosFile(new Uint8Array(readFileSync(path)))
  const found = file?.banks.find((b) => 'data' in b && b.name === 'P61mod')
  return found && 'data' in found ? (found.data as Uint8Array) : null
})()

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
