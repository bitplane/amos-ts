/**
 * The DEVIATION / DEFECT markers, and the one rule about where they may live.
 *
 * `src/runtime/README.md` settles what the two words mean: DEVIATION is us
 * differing from the original, DEFECT is the original being wrong and us
 * keeping it. They are opposites, they are one letter apart in intent, and
 * before this test they were written five different ways — "DEVIATION,",
 * "DEVIATION on", "NOTE, and it is a defect of the library's rather than a
 * deviation:" — none of which a grep finds together.
 *
 * So the spelling is fixed here, and the isolation the markers exist for is
 * checked: no reproduced defect may sit in src/amiga. That layer holds shared
 * mechanism, and a bug belonging to one release of one library is the least
 * shareable thing in the codebase.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const self = fileURLToPath(import.meta.url)
const src = join(self, '..', '..')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...sources(p))
    // this file is the one place that has to write the markers malformed, to
    // say what malformed means
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.gen.ts') && p !== self) out.push(p)
  }
  return out.sort()
}

interface Marker {
  file: string
  line: number
  word: string
  text: string
}

/**
 * Every DEVIATION/DEFECT in the tree, however it is spelled.
 *
 * Deliberately case-sensitive and deliberately loose about what follows the
 * word: this has to see the malformed ones to be able to reject them. The
 * word must stand alone, so "deviation" in running prose and `DEVIATIONS` are
 * both invisible to it.
 */
function markers(): Marker[] {
  const out: Marker[] = []
  for (const file of sources(src)) {
    const rel = relative(src, file)
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/\b(DEVIATION|DEFECT)\b(.?)/g)) {
        out.push({ file: rel, line: i + 1, word: m[1]!, text: m[2]! })
      }
    })
  }
  return out
}

/** where the marker sits, as `file:line`, for a failure message worth reading */
const at = (m: Marker): string => `${m.file}:${m.line}`

describe('deviation and defect markers', () => {
  const all = markers()

  it('there are some — this test is not silently scanning nothing', () => {
    expect(all.length).toBeGreaterThan(20)
  })

  /**
   * The exact form is `WORD: `. Anything else — `DEVIATION,`, `DEVIATION on`,
   * `DEFECT.` — is the drift this test exists to stop, because a grep for
   * `DEFECT:` has to find all of them or the catalogue is a lie.
   */
  it('every marker is spelled `WORD: `', () => {
    const bad = all.filter((m) => m.text !== ':').map((m) => `${at(m)} — ${m.word}${m.text}`)
    expect(bad).toEqual([])
  })

  /**
   * The rule from src/amiga/README.md, in the form a machine can check.
   *
   * DEVIATION is allowed there and DEFECT is not: the modelled machine
   * genuinely differs from the real one and saying where is the point, but a
   * bug belonging to one library's one release is a caller's policy, and the
   * moment it lands in a subsystem every other caller inherits behaviour it
   * has no source for.
   */
  it('no reproduced defect lives in the shared OS layer', () => {
    const stray = all.filter((m) => m.word === 'DEFECT' && m.file.startsWith('amiga/')).map(at)
    expect(stray).toEqual([])
  })

  /**
   * Both markers explain themselves in place. A bare `DEFECT:` with the
   * argument somewhere else is how these stop being readable — the whole
   * point is that someone hitting the line knows on sight that the wrongness
   * was chosen.
   */
  it('every marker is followed by prose', () => {
    const bare = all
      .filter((m) => {
        const line = readFileSync(join(src, m.file), 'utf8').split('\n')[m.line - 1]!
        return line.slice(line.indexOf(`${m.word}:`) + m.word.length + 1).trim().length < 8
      })
      .map(at)
    expect(bare).toEqual([])
  })
})
