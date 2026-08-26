/**
 * Every program the corpus has, offered to `Prg_Load` and the Test pass.
 *
 * This is the gate on the whole web player path, because the player loads a
 * program INTO a window and runs it with `Ed_Run` rather than handing it to
 * the interpreter directly. A program the editor will not take is one the
 * player has to fall back on, and every fallback is a program that cannot be
 * edited.
 *
 * Sampled rather than swept: `new Amos` tokenises and walks the whole
 * program, which is a hundred times what `files.corpus.test.ts` does per
 * file. One in every N, so the sample moves with the corpus rather than
 * sitting on the same head of it.
 */
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { corpusFile, corpusIndex, haveCorpus } from '../cli/corpus'
import { describeIf } from '../testing/fixture'
import { Amos } from './amos'
import { PRG, readProgramFile } from '../editor/files'

/** how many to take, which is about thirty seconds of walking */
const SAMPLE = 150

describeIf('every corpus program, offered to a window', haveCorpus(), () => {
  it('is one the editor will hold', { timeout: 300_000 }, () => {
    const index = corpusIndex()
    const paths = [...index].filter(([, p]) => /\.amos$/i.test(p))
    const step = Math.max(1, Math.floor(paths.length / SAMPLE))
    const refused: string[] = []
    let taken = 0
    /** a `.AMOS` name over something that is not one */
    let notPrograms = 0
    for (let i = 0; i < paths.length; i += step) {
      const [sha, path] = paths[i]!
      const file = corpusFile(sha, index)
      if (file === null) continue
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(readFileSync(file))
      } catch {
        continue
      }
      // Whether it is a program at all is read off the BYTES and not off the
      // name. `Prg_Load` checks the two headers and then the length word
      // against the file, and a `.AMOS` that fails either is a file wearing
      // the extension: this sample finds a 20-byte header with no body, an
      // Amiga hunk executable starting $000003F3, and `Moire.amos`, whose
      // length word claims 538,976,288 bytes over 2,059.
      if (readProgramFile(bytes).error !== PRG.OK) {
        notPrograms++
        continue
      }
      try {
        // `requesters: false` is `Ed_Zappeuse`: nothing here can draw one
        const held = new Amos(bytes, { requesters: false })
        expect(held.window.prog.lineCount).toBeGreaterThan(0)
        taken++
      } catch (e) {
        refused.push(`${path}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    // a sweep that compared nothing must not pass
    expect(taken).toBeGreaterThan(50)
    expect(notPrograms).toBeLessThan(taken)
    // one the editor refuses is a real gap, so they are named
    expect(refused).toEqual([])
  })
})
