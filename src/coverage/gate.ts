/**
 * vitest globalSetup: the faithfulness gate.
 *
 * A keyword in FAITHFUL claims two things — that its behaviour was checked
 * against the original, and that the suite exercises it. This enforces the
 * second. On teardown it aggregates what every worker dispatched (see
 * ./probe.ts) and fails the run if a FAITHFUL keyword was never executed.
 *
 * Only enforced when AMOS_COVERAGE_GATE is set, which `npm test` does. Running
 * a single test file would otherwise "fail" for the 590 keywords that file
 * quite reasonably does not touch.
 *
 * ALLOWED_UNPROVEN below is the backlog, and it is meant to shrink. Adding a
 * keyword to it is a deliberate act that shows up in review; forgetting to
 * write a test is not.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FAITHFUL } from './status'
import { PROBE_DIR } from './probe'

/**
 * FAITHFUL keywords with no test that dispatches them.
 *
 * Empty, and it should stay that way: every keyword classified FAITHFUL is
 * executed by the suite. An entry here is a keyword we assert was verified
 * against the 68k source but which nothing runs, so the claim would rest on
 * code review alone. If you are about to add one, write the test instead.
 */
export const ALLOWED_UNPROVEN = new Set<string>([])

export function setup(): void {
  if (!process.env.AMOS_COVERAGE_GATE) return
  rmSync(PROBE_DIR, { recursive: true, force: true })
  mkdirSync(PROBE_DIR, { recursive: true })
}

/**
 * `fixtures/` is gitignored — the AMOS libraries and the commercial extensions
 * are not ours to redistribute — so a fresh clone, and CI, have most of the
 * suite skipped. The coverage question is then unanswerable rather than
 * answered "no": asking whether every FAITHFUL keyword is exercised only makes
 * sense when the tests that exercise them can run. Without this the gate
 * accuses ~200 keywords of being unproven, which is the first thing a new
 * contributor would see and is not true.
 *
 * But "unanswerable" is not the same as "assert nothing", which is what this
 * used to do — and since CI never has fixtures, the gate was inert in the only
 * place it runs automatically. 19 test files gate themselves on the corpus with
 * `describe.skipIf`, so a harness break that stops them collecting is invisible:
 * a skipped suite and a suite that silently stopped existing look identical.
 *
 * So both modes assert a FLOOR on how many distinct keywords actually reached a
 * handler. Measured on 2026-07-30: 1080 with the corpus, 998 without. The floors
 * sit a little under each, low enough not to trip on ordinary churn and high
 * enough that a collapse — a setupFiles regression, a describe block that stops
 * running, tests that no longer import the runtime — fails the run instead of
 * passing quietly. Raise them when the real numbers move up.
 */
const FIXTURES = join(process.cwd(), 'fixtures')
const DISPATCH_FLOOR_WITH_CORPUS = 1050
const DISPATCH_FLOOR_NO_CORPUS = 970

/** every distinct keyword name the probe saw reach a handler */
function readProbe(): Set<string> {
  const dispatched = new Set<string>()
  if (existsSync(PROBE_DIR)) {
    for (const f of readdirSync(PROBE_DIR)) {
      if (!f.endsWith('.json') || f === 'report.json') continue
      for (const n of JSON.parse(readFileSync(join(PROBE_DIR, f), 'utf8')) as string[]) {
        dispatched.add(n)
      }
    }
  }
  return dispatched
}

export function teardown(): void {
  if (!process.env.AMOS_COVERAGE_GATE) return
  if (!existsSync(FIXTURES)) {
    const seen = readProbe()
    console.warn(
      `faithfulness gate: fixtures/ is absent, so most of the suite was skipped ` +
        `and keyword coverage cannot be judged. ${seen.size} keywords still reached ` +
        `a handler; the gate is only fully meaningful in a checkout with the corpus.`,
    )
    if (seen.size < DISPATCH_FLOOR_NO_CORPUS) {
      throw new Error(
        `faithfulness gate: only ${seen.size} keywords reached a handler, below the ` +
          `no-corpus floor of ${DISPATCH_FLOOR_NO_CORPUS}. The suite has shrunk rather ` +
          `than been skipped — check setupFiles and that the non-corpus tests still run.`,
      )
    }
    return
  }
  const dispatched = readProbe()
  if (dispatched.size < DISPATCH_FLOOR_WITH_CORPUS) {
    throw new Error(
      `faithfulness gate: only ${dispatched.size} keywords reached a handler, below the ` +
        `floor of ${DISPATCH_FLOOR_WITH_CORPUS}. Tests are not running, not merely failing.`,
    )
  }
  if (dispatched.size === 0) {
    throw new Error(
      'faithfulness gate: the keyword probe recorded nothing. Is probe.setup.ts still in setupFiles?',
    )
  }

  const unproven = [...FAITHFUL].filter((k) => !dispatched.has(k)).sort()
  const missing = unproven.filter((k) => !ALLOWED_UNPROVEN.has(k))
  const fixed = [...ALLOWED_UNPROVEN].filter((k) => dispatched.has(k)).sort()

  // Report progress so the backlog cannot quietly stop shrinking.
  writeFileSync(
    join(PROBE_DIR, 'report.json'),
    JSON.stringify({ dispatched: dispatched.size, faithful: FAITHFUL.size, unproven }, null, 2),
  )

  const problems: string[] = []
  if (missing.length > 0) {
    problems.push(
      `${missing.length} keyword(s) are classified FAITHFUL but no test dispatches them:\n` +
        `  ${missing.join(', ')}\n` +
        `Write a test that runs the keyword and cites the 68k routine it was verified against.\n` +
        `Do not add them to ALLOWED_UNPROVEN in src/coverage/gate.ts to silence this.`,
    )
  }
  if (fixed.length > 0) {
    problems.push(
      `${fixed.length} keyword(s) in ALLOWED_UNPROVEN are now covered — remove them from the ` +
        `backlog in src/coverage/gate.ts:\n  ${fixed.join(', ')}`,
    )
  }
  if (problems.length > 0) throw new Error(`\n\n${problems.join('\n\n')}\n`)
}
