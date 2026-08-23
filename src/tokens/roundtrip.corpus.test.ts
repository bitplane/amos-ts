/**
 * The same round trip as roundtrip.test.ts, over the corpus rather than
 * `fixtures/`.
 *
 * Breadth is the whole point of running it twice. `fixtures/` is 566 programs
 * this project chose, most of them AMOS Professional; the corpus index holds
 * 3,972 distinct ones going back to AMOS 1.3, using extensions nothing here
 * loads and written by people who never saw a manual. Everything the fixtures
 * sweep has never been able to say came from here:
 *
 *   - constants walk down a mantissa step every time their line is listed and
 *     read back, so `XFIN#=0.8749999` is what happens to someone who typed
 *     0.875 and then edited the line. 125 lines are caught mid-walk. The
 *     `DEFECT:` is on `ascToFfp`.
 *   - `HÖHE=90` in `_ChartLine.AMOS`, which found `DtkV3` bounding its
 *     uppercasing at "a" and "z" where this port had reached for the whole of
 *     Latin-1 and would have rewritten the name.
 *   - `TRACKLOADED` and `LIBCALL1`, where the optional space inside a stored
 *     keyword name lets `track load` and `lib call` bite into an identifier.
 *
 * The default run samples, because the full sweep is 1,063,966 lines and 45
 * seconds where the whole suite is 35. AMOS_RT_FULL=1 sweeps every program,
 * and that run is the one the numbers here come from: 1,873 lines differ
 * after the verifier's fields are cleared, 0.18% of them, and every one is
 * accounted for structurally. 126 cannot settle, all of them constants AMOS
 * cannot spell or lines that list through a placeholder. Nothing is
 * unexplained. The sample is a sixteenth by checksum, and its count is
 * asserted below so a sweep that quietly became empty cannot pass.
 */
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { corpusFile, corpusIndex, haveCorpus } from '../cli/corpus'
import { describeIf } from '../testing/fixture'
import { emptyResult, report, sweepProgram } from './roundtrip'

/** every AMOS program in the index, once per distinct checksum */
function programs(): string[] {
  const index = corpusIndex()
  const out: string[] = []
  for (const [sha, path] of index) {
    if (!/\.amos$/i.test(path)) continue
    // a sixteenth of them, chosen by a hash nobody picked for this purpose
    if (process.env.AMOS_RT_FULL === undefined && !sha.startsWith('0')) continue
    const file = corpusFile(sha, index)
    if (file !== null) out.push(file)
  }
  return out
}

const paths = programs()
const result = emptyResult()
for (const path of paths) {
  try {
    sweepProgram(new Uint8Array(readFileSync(path)), path, result)
  } catch {
    result.unreadable++
  }
}
report(process.env.AMOS_RT_FULL === undefined ? 'corpus sample' : 'corpus', result)

describeIf('every line of the corpus, out and back', haveCorpus(), () => {
  it('read the sample it meant to, so an empty sweep cannot pass for a clean one', () => {
    // 3,972 distinct programs in the index, a sixteenth of them by checksum
    expect(paths.length).toBeGreaterThan(process.env.AMOS_RT_FULL === undefined ? 200 : 3500)
    expect(result.lines).toBeGreaterThan(process.env.AMOS_RT_FULL === undefined ? 40_000 : 900_000)
  })

  it('leaves nothing unexplained', () => {
    expect(result.unexplained).toEqual([])
  })

  it('changes fewer than three lines in a thousand, verifier fields aside', () => {
    // 0.18% on the full sweep, against 0.05% for fixtures, because more of
    // these programs predate the keywords this port tokenises them with
    expect(result.byteDiffer / result.lines).toBeLessThan(0.003)
  })

  it('settles after one pass, unless the listing is not the program', () => {
    // the two exceptions are counted separately as `drifting`: a constant
    // that walks down a step per listing, and a line whose extension is not
    // on this machine and lists as "Extension Z"
    expect(result.unstable).toBe(0)
  })
})
