/**
 * Keyword-dispatch probe.
 *
 * `FAITHFUL` in ./status.ts claims a keyword's behaviour was checked against
 * the original 68k source *and* that the test suite cites it. The first half is
 * a judgement; the second half is a fact, and facts should be enforced rather
 * than remembered. This records which keywords the suite actually dispatches so
 * ./gate.ts can fail the build when a FAITHFUL keyword is never run.
 *
 * It deliberately measures dispatch of the *keyword*, not of the routine behind
 * it. A pixel-perfect unit test of a decoder says nothing about whether the
 * keyword that calls it marshals its arguments correctly, handles its arity
 * variants, or raises the right error — which is where AMOS's quirks live.
 *
 * Nothing installs a probe outside the test suite, so in normal use (including
 * the browser build) this stays `undefined` and the call sites cost one
 * optional-chain check. It is a live binding rather than a value captured at
 * import time because vitest loads the module graph before its setup files run.
 */
export let KEYWORD_PROBE: Set<string> | undefined

export function setKeywordProbe(probe: Set<string> | undefined): void {
  KEYWORD_PROBE = probe
}

/** Where workers drop what they saw, for ./gate.ts to aggregate. */
export const PROBE_DIR = 'node_modules/.cache/amos-keyword-probe'
