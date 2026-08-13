/**
 * The corpus reader, and a guard against the bug that put it here.
 *
 * CI was red from 2026-08-12 to 2026-08-13 because two suites read the
 * checksum index at the top of a `describe.skipIf(!have)` block. The
 * condition was right and the suites WERE marked skipped; the factory ran
 * anyway, the `readFileSync` threw ENOENT on a checkout with no corpus, and
 * a thrown collection is a failed suite whatever the tests inside were going
 * to do.
 *
 * The fix was to move the guard into the reader. This file holds it there.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { corpusFile, corpusIndex, haveCorpus } from './corpus'

const src = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('the corpus index', () => {
  it('answers instead of throwing, whether or not the corpus is here', () => {
    expect(() => corpusIndex()).not.toThrow()
    expect(corpusIndex()).toBeInstanceOf(Map)
    // this checksum cannot exist, so it exercises the not-found path on any
    // machine, corpus or no corpus
    expect(corpusFile('0'.repeat(64))).toBe(null)
  })

  it('is either empty or big, never a handful', () => {
    // 46,453 lines in the index and 25,968 distinct checksums: getting on for
    // half the corpus is another copy of a file already in it. The bound is
    // loose because the corpus grows; it is here to catch an index that
    // parsed down to nothing.
    const n = corpusIndex().size
    expect(haveCorpus() ? n > 20_000 : n === 0).toBe(true)
  })
})

describe('nothing else opens the index itself', () => {
  it('leaves the guard in one place', () => {
    // A second copy of the read is a second chance to forget the guard, and
    // that is exactly how the two suites came to have one each. `errscan.ts`
    // is exempt: it is a CLI you run WITH the corpus, and it should fail
    // loudly when it is not there.
    const allowed = new Set(['cli/corpus.ts', 'cli/errscan.ts'])
    // assembled rather than written out, so this file is not its own offender
    const needle = ['checksums', 'sha256'].join('.')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, e.name)
        if (e.isDirectory()) walk(path)
        else if (/\.ts$/.test(e.name) && readFileSync(path, 'utf8').includes(needle)) {
          const rel = relative(src, path).split('\\').join('/')
          if (!allowed.has(rel)) offenders.push(rel)
        }
      }
    }
    walk(src)
    expect(offenders).toEqual([])
  })
})
