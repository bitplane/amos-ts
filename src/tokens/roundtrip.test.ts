/**
 * Every line of every program in `fixtures/`, out through the editor and back.
 *
 * This is the test the byte-level pair exists for. `Detok` and `Tokenise` are
 * run against each other over 124,000 real lines, and what comes back has to
 * be the bytes that went in, up to the fields the verifier owns.
 * roundtrip.ts explains which fields those are and why the comparison cannot
 * be a bare one.
 *
 * What is left over is 65 lines in 124,468, and each one is a case where the
 * TEXT does not carry enough to choose. roundtrip.corpus.test.ts runs the
 * same sweep over programs this project did not choose, which is where most
 * of those cases were found. Set AMOS_RT_REPORT to print the counts.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { emptyResult, report, sweepProgram } from './roundtrip'

const fixtures = join(process.cwd(), 'fixtures')

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walk(p)
    else if (/\.amos$/i.test(name)) yield p
  }
}

const result = emptyResult()
if (existsSync(fixtures)) {
  for (const path of walk(fixtures)) sweepProgram(new Uint8Array(readFileSync(path)), path, result)
}
report('fixtures', result)

describe.skipIf(result.programs === 0)('every line of fixtures, out and back', () => {
  it('read enough programs that an empty sweep cannot pass for a clean one', () => {
    expect(result.programs).toBeGreaterThan(400)
    expect(result.lines).toBeGreaterThan(100_000)
  })

  it('leaves nothing unexplained', () => {
    expect(result.unexplained).toEqual([])
  })

  it('changes fewer than one line in a thousand, verifier fields aside', () => {
    expect(result.byteDiffer / result.lines).toBeLessThan(0.001)
  })

  it('settles after one pass, which is what the editor needs', () => {
    // a line the user merely walks past goes through both halves, so a round
    // trip that kept changing the line would rewrite a program by being read
    expect(result.unstable).toBe(0)
  })

  it('shows the same text again for all but the lines it cannot', () => {
    // the 1.7% are the empty lines the editor inserted with an indent
    // Tokenise cannot produce, plus the byte cases above
    expect(result.textDiffer / result.lines).toBeLessThan(0.02)
  })
})
