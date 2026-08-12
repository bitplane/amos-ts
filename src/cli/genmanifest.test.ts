/**
 * KEYWORDS.md is generated, committed, and read by people — which is exactly
 * the combination that rots.
 *
 * It went three commits stale during the Range port and spent that time
 * telling anyone who looked that range-2.0 was 48% done when it was finished.
 * Nothing failed, because nothing checked: the file is not an input to
 * anything, so a wrong number in it costs nothing until someone believes it.
 *
 * The check has to compare against the COMMITTED bytes without regenerating
 * them first. A test that runs the generator and then reads the file it just
 * wrote passes unconditionally and guards nothing, so `buildManifest()` is
 * separated from the write for this.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { MANIFEST, buildManifest, manifestSummary } from './genmanifest'

describe('the committed coverage manifest', () => {
  it('is what genmanifest would write today', () => {
    const committed = readFileSync(MANIFEST, 'utf8')
    const fresh = buildManifest()
    if (committed !== fresh) {
      // point at the first differing line rather than dumping 6,000 keywords
      const c = committed.split('\n')
      const f = fresh.split('\n')
      const i = c.findIndex((line, n) => line !== f[n])
      expect
        .soft(
          f[i],
          `KEYWORDS.md is stale — run \`npx tsx src/cli/genmanifest.ts\`. First difference at line ${i + 1}`,
        )
        .toBe(c[i])
    }
    expect(committed).toBe(fresh)
  })

  it('agrees with the summary the tool prints', () => {
    // the same numbers reached two ways: the table in the file, and the count
    // the CLI reports. They came apart once when the rollup changed and the
    // print line did not.
    // cells are padded to the column width now, so the separators carry runs
    // of spaces — see mdtable.ts
    const total = /^\|\s*\*\*total\*\*\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/m.exec(buildManifest())
    expect(total, 'the manifest has a **total** row').not.toBeNull()
    const [, keywords, faithful, approximated, missing] = total!.map(Number)
    const summary = manifestSummary()
    expect(summary).toContain(`${keywords} keywords`)
    expect(summary).toContain(`${faithful!} faithful`)
    expect(summary).toContain(`${missing} missing`)
    expect(summary).toContain(`${faithful! + approximated!} implemented`)
  })
})
