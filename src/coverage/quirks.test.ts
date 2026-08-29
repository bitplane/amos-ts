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
import { NOTES, SHARED_NOTES } from './status'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const self = fileURLToPath(import.meta.url)
const src = join(self, '..', '..')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    // src/cli/tmp/ is gitignored and .gitignore calls it "throwaway one-off
    // scripts while reading a binary". Scanning it means anyone who has one
    // open fails the suite on a file that will never be committed
    if (e.isDirectory() && e.name !== 'tmp') out.push(...sources(p))
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
 * A marker OPENS a comment line — that is how every one of them is written,
 * and it is what makes the set greppable. Mid-sentence the same word is
 * ordinary prose: a test that says "see the DEVIATION above" is citing one,
 * not declaring one, and demanding a colon there would only teach people to
 * stop citing them.
 *
 * Deliberately case-sensitive and deliberately loose about what follows the
 * word: this has to see the malformed ones to be able to reject them.
 */
function markers(): Marker[] {
  const out: Marker[] = []
  for (const file of sources(src)) {
    const rel = relative(src, file)
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const m = /^\s*(?:\*|\/\/)?\s*(DEVIATION|DEFECT)\b(.?)/.exec(line)
      if (m) out.push({ file: rel, line: i + 1, word: m[1]!, text: m[2]! })
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
  /**
   * A NUL byte anywhere in a source file makes grep call the whole file
   * binary, and a binary file matches SILENTLY --- no output, no count, no
   * error. Every search over it comes back empty and reads as "not there".
   *
   * Two files had one, both deliberate and both written as a raw byte where
   * an escape was meant: sln.ts's `?? '\u0000'` and this suite's sibling
   * extimpl.test.ts, which joins an id to a name with one. sln.ts is 2,373
   * lines answering 69 keywords, and for as long as the byte was in it every
   * `grep 's disk state' src/runtime/sln.ts` answered nothing --- which is
   * indistinguishable from the keyword being unimplemented, and was read that
   * way. `\u0000` is the same character to the compiler and an ordinary line
   * to grep.
   *
   * The AMOS sources have the same property for a different reason and
   * CLAUDE.md says to pass `-a` when reading them. This tree should not need
   * the flag.
   */
  it('no source file contains a NUL, which would make grep skip it', () => {
    const withNul = sources(src)
      .filter((f) => readFileSync(f).includes(0))
      .map((f) => relative(src, f))
    expect(withNul).toEqual([])
  })

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

describe('quotations in the coverage notes', () => {
  /*
   * A note with an odd number of quote marks is either a quotation that opens
   * and never closes, or a tail that closes one never opened. Both publish a
   * FRAGMENT of an author's prose as if it were the whole of it, which is the
   * "quotes must be verifiable" rule broken in the quietest possible way —
   * nothing looks wrong, the sentence just stops.
   *
   * Nine of them existed. Closing them found two things worth more than the
   * tidiness: `st erase` had CORRECTED the author, quoting "It is OK if your
   * graph contains cycles" where EasyLifeSTRUCT.guide says "If is OK"; and
   * `med counter` was quoting one line of a three-line node whose other two
   * lines are the joke that makes it worth quoting at all.
   *
   * There is no legitimate odd count. A note that needs a bare quote mark —
   * an inch sign, a lone double-prime — can spell it some other way.
   */
  const all = [...Object.entries(NOTES), ...Object.entries(SHARED_NOTES)]

  it('are balanced, every one of them', () => {
    const odd = all.filter(([, v]) => ((v.match(/"/g) ?? []).length & 1) === 1).map(([k]) => k)
    expect(odd).toEqual([])
  })

  it('and there are enough notes here for that to mean something', () => {
    // guards against the check passing because the import broke
    expect(all.length).toBeGreaterThan(1300)
    expect(all.filter(([, v]) => v.includes('"')).length).toBeGreaterThan(200)
  })
})
