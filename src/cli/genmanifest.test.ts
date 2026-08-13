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
import { MANIFEST, buildManifest, manifestSummary, printable } from './genmanifest'

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

  it('is a TEXT file, which one keyword name nearly cost it', () => {
    /*
     * `intuiextend-2.01b` id 2154 begins with a NUL. Writing it raw made this
     * file binary as far as git is concerned -- no diff, no blame, and `grep`
     * silently refusing to match anything in it -- for one byte in 7,362
     * keywords. genmanifest escapes control characters now; this is the
     * invariant, because a second such name would break it the same way and
     * nothing else would notice.
     */
    const bytes = readFileSync(MANIFEST)
    const bad: string[] = []
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!
      if (b === 0x09 || b === 0x0a || b === 0x0d) continue
      if (b < 0x20 || b === 0x7f) bad.push(`offset ${i}: 0x${b.toString(16)}`)
    }
    expect(bad).toEqual([])
  })

  it('shows a broken name rather than tidying it away', () => {
    // Escaped, not stripped: ` rwb get menu adr` would read as a name with a
    // leading space, which is a different and wrong claim about the table.
    //
    // Tested through `printable` rather than through the rendered file. The
    // manifest lists gaps only, and `intuiextend-2.01b` reads 0%, so the one
    // name in the tree with a control byte is not currently printed anywhere.
    // The escaping still has to be right for the day it is.
    expect(printable('\x00rwb get menu adr')).toBe('\\x00rwb get menu adr')
    expect(printable('\x7f')).toBe('\\x7f')
    expect(printable('bank as work')).toBe('bank as work')
  })
})
