/**
 * Test-only helpers. Not part of the package — tsconfig.build.json excludes
 * this directory, the way it excludes the coverage gate and the CLI.
 */
import type { RunResult } from '../interp/interp'

/**
 * Insist that a test's program actually ran to completion.
 *
 * `runHeadless` returns rather than throws when a program blocks on input,
 * runs out of steps, or dies — so a test that only inspects the OUTPUT of a
 * program that never reached its last line passes happily on an empty string.
 * That is the same failure the coverage gate exists to catch one level up: a
 * green test proving nothing.
 *
 * `stopped` counts as finished. It is what `Edit`, `End` and a `Direct` return
 * produce, and several suites end their programs that way deliberately.
 *
 * Written out by hand in 68 places before this existed, and already spelled
 * two different ways — which is the whole argument. A test file that simply
 * OMITS the check looks identical to one that has it, so the value of naming
 * it is that its absence becomes visible.
 */
export function mustFinish<T extends { status: RunResult['status'] }>(r: T): T {
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return r
}
