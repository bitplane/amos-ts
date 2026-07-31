/**
 * The layer boundary, as a rule rather than a habit.
 *
 * `src/amiga` models AmigaOS and `src/runtime` is AMOS, which is its CALLER.
 * The dependency therefore runs one way: runtime may import amiga, amiga may
 * not import runtime. That was the whole premise when the layer was created,
 * and nothing checked it — by the time this test was written `vfs.ts` and
 * `host.ts` had both drifted back across, reaching into `runtime/fs.ts` and
 * `runtime/audio.ts` for the two interfaces they are defined against.
 *
 * They were type-only imports with no cost at runtime, which is exactly why
 * they survived: nothing failed, nothing was slower, and the layer quietly
 * stopped being a layer. A boundary no one can violate by accident is worth
 * more than one everybody remembers to respect.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = join(fileURLToPath(new URL('.', import.meta.url)))

/**
 * Source files only.
 *
 * A TEST may reach across — `vfs.test.ts` builds a whole Runtime to check that
 * a mounted archive is readable from AMOS, which is the right way to test a
 * filesystem and impossible without the caller. What must not happen is the
 * shipped layer depending on its own caller.
 */
function sources(): string[] {
  return readdirSync(here)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
}

/** every module specifier a file imports or re-exports from */
function specifiers(file: string): string[] {
  const text = readFileSync(join(here, file), 'utf8')
  return [...text.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!)
}

describe('the src/amiga layer boundary', () => {
  it('has some source files — this test is not scanning an empty directory', () => {
    expect(sources().length).toBeGreaterThan(4)
  })

  it('nothing in src/amiga imports from src/runtime', () => {
    const crossings: string[] = []
    for (const file of sources()) {
      for (const spec of specifiers(file)) {
        if (/(^|\/)\.\.\/runtime\//.test(spec) || spec.startsWith('../runtime')) {
          crossings.push(`${file} -> ${spec}`)
        }
      }
    }
    expect(crossings, 'src/amiga models the OS; src/runtime is its caller').toEqual([])
  })

  /**
   * `src/interp` is the AMOS interpreter's value and error layer — `AmosError`
   * carries an AMOS error NUMBER, which is caller policy, not OS mechanism.
   * The README's rule about `stampToYmd` not clamping is the same rule: a
   * shared module must not bake in one caller's idea of what went wrong.
   */
  it('nothing in src/amiga imports from src/interp', () => {
    const crossings: string[] = []
    for (const file of sources()) {
      for (const spec of specifiers(file)) {
        if (spec.startsWith('../interp')) crossings.push(`${file} -> ${spec}`)
      }
    }
    expect(crossings, 'an AMOS error number is policy; throw a plain Error').toEqual([])
  })

  /**
   * What it MAY reach for: `../loader/binreader` is a leaf byte-reader with no
   * imports of its own, already shared by `src/tokens` and `src/runtime`. It
   * is plumbing, not AMOS, and duplicating it to keep the directory listing
   * tidy would be the wrong trade. Recorded here so the allowance is a
   * decision rather than an oversight.
   */
  it('reaches outside the layer only for the shared byte reader', () => {
    const allowed = new Set(['../loader/binreader'])
    const outside: string[] = []
    for (const file of sources()) {
      for (const spec of specifiers(file)) {
        if (spec.startsWith('../') && !allowed.has(spec)) outside.push(`${file} -> ${spec}`)
      }
    }
    // an allowlist rather than an exact set: the layer is allowed to grow
    // without touching this test, but not to acquire a new outward dependency
    // without someone deciding to add it here
    expect(outside).toEqual([])
  })
})
