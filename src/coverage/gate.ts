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
 * Every entry is a keyword we assert was verified against the 68k source but
 * which nothing in the suite runs, so the claim rests on code review alone.
 * Delete entries as tests land — never add one to make the build pass.
 */
export const ALLOWED_UNPROVEN = new Set<string>([
  'acos', 'amal freeze', 'amal off', 'amalerr', 'anim freeze', 'anim off', 'asin', 'atan',
  'auto view on', 'bank to menu', 'bclr', 'bob clear', 'bob draw', 'bob off', 'bob update',
  'bob update on', 'boom', 'border', 'break off', 'break on', 'cdown', 'chanan', 'clear key',
  'cleft', 'cline', 'cmove$', 'command line$', 'comp test', 'cos', 'cright', 'cup', 'curs on',
  'curs pen', 'def scroll', 'default', 'del block', 'del cblock', 'del icon', 'del sprite',
  'dfree', 'dialog freeze', 'dialog unfreeze', 'dir', 'erase all', 'every off', 'every on',
  'exp', 'fn', 'get bob palette', 'get cblock', 'get icon', 'get icon palette',
  'get rom fonts', 'get sprite', 'get sprite palette', 'hcos', 'hide on', 'htan', 'hzone',
  'i bob', 'icon base', 'ins icon', 'ins sprite', 'inverse off', 'jdown', 'jright', 'laced',
  'line input', 'make icon mask', 'make mask', 'med cont', 'med midi on', 'menu active',
  'menu bar', 'menu called', 'menu del', 'menu item static', 'menu line', 'menu link',
  'menu mouse off', 'menu mouse on', 'menu movable', 'menu off', 'menu once', 'menu separate',
  'menu static', 'menu tline', 'menu to bank', 'mouse screen', 'move freeze', 'move y',
  'mubase', 'multi wait', 'no icon mask', 'no mask', 'not', 'on menu del', 'on menu off',
  'paper$', 'paste icon', 'prg next$', 'priority off', 'priority on', 'priority reverse off',
  'priority reverse on', 'proc', 'put bob', 'put cblock', 'radian', 'rainbow del', 'repeat$',
  'reserve as chip data', 'reset zone', 'resume', 'resume label', 'rol.w', 'ror.l', 'ror.w',
  'sam loop off', 'scin', 'screen close', 'screen offset', 'screen show', 'scroll',
  'scroll on', 'set curs', 'set input', 'set menu', 'set sprite buffer', 'set tab',
  'shade off', 'shade on', 'shift down', 'shift off', 'sprite col', 'sprite off',
  'sprite update on', 'spritebob col', 'synchro', 'synchro off', 'synchro on', 'tan',
  'title bottom', 'track loop of', 'under off', 'unpack', 'update every', 'update on', 'vrev',
  'wind move', 'x hard', 'x mouse', 'x screen', 'xgr', 'y hard', 'y menu', 'y mouse',
  'y screen', 'ygr', 'zdialog',
])

export function setup(): void {
  if (!process.env.AMOS_COVERAGE_GATE) return
  rmSync(PROBE_DIR, { recursive: true, force: true })
  mkdirSync(PROBE_DIR, { recursive: true })
}

export function teardown(): void {
  if (!process.env.AMOS_COVERAGE_GATE) return
  const dispatched = new Set<string>()
  if (existsSync(PROBE_DIR)) {
    for (const f of readdirSync(PROBE_DIR)) {
      for (const n of JSON.parse(readFileSync(join(PROBE_DIR, f), 'utf8')) as string[]) {
        dispatched.add(n)
      }
    }
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
