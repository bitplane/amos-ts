/**
 * A suite over something that might not be on this machine.
 *
 * ## The trap this exists to close
 *
 * `describe.skipIf(cond)` skips the TESTS. It still runs the factory, because
 * that is how the tests get collected in the first place. So this, which
 * reads perfectly:
 *
 *     describe.skipIf(!bank)('a real module', () => {
 *       const song = parseSmon(bank!)!
 *       it('has 105 steps', () => expect(song.steps).toBe(105))
 *     })
 *
 * calls `parseSmon(null)` on a machine with no corpus, at collection time,
 * and the whole FILE fails to load. Every test in it is lost, including the
 * ones that needed no fixture at all.
 *
 * That is exactly what happened: twelve files, ten of them this shape, all
 * green here and all failing in CI, because the corpus and `fixtures/` are on
 * this machine and neither is in the repository. The suite passed locally for
 * as long as anyone tested it locally.
 *
 * ## What this does instead
 *
 * The body only runs when there is something to run it on, so a missing
 * fixture can never be dereferenced. When there is not, a single skipped test
 * stands in, so the run REPORTS the gap rather than silently containing one
 * suite fewer. A plain `if (x) describe(...)` closes the same trap and loses
 * that, which is worse: a machine without the corpus should be able to see
 * what it did not check.
 */
import { describe, it } from 'vitest'

/**
 * `body` receives the value, non-null, and is never called without one.
 *
 * The `why` is printed as the name of the standing-in test, so the reason a
 * suite did not run is in the output rather than in someone's memory.
 */
export function describeWith<T>(name: string, value: T | null | undefined, body: (value: T) => void, why = 'not on this machine'): void {
  if (value === null || value === undefined) {
    describe(name, () => {
      it.skip(why, () => {})
    })
    return
  }
  describe(name, () => body(value))
}

/**
 * The same, for a suite whose inputs are several files rather than one value.
 *
 * `load` runs only when `have` is true, so a `readFileSync` of a path that is
 * not there never happens. It is separate from `describeWith` because the
 * common shape at the call sites is a boolean already computed by
 * `existsSync`, and threading that through a value would mean building the
 * value first, which is the thing being avoided.
 */
export function describeIf(name: string, have: boolean, body: () => void, why = 'not on this machine'): void {
  describeWith(name, have ? true : null, body, why)
}
