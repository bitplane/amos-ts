/**
 * The corpus index, and the one rule about reading it from a test.
 *
 * `../amos-files` is 45,743 files that are not part of this repository, and
 * CI checks out without them. Anything that reads the index has to ANSWER
 * when it is absent rather than throw.
 *
 * Guarding the suite is not enough, and this is the trap that took CI down
 * from 2026-08-12: `describe.skipIf(cond)` still RUNS the suite factory. It
 * only marks the tests inside as skipped. A `readFileSync` at the top of a
 * skipped `describe` still fires, and a throw there fails collection, which
 * is a failed suite and a red build however many tests were skipped.
 *
 * So the guard belongs in the reader, not at the call site. `corpusIndex()`
 * returns an empty map rather than throwing, and every caller degrades to
 * "found nothing" on its own.
 */
import { existsSync, readFileSync } from 'node:fs'

const ROOT = '../amos-files'
const CHECKSUMS = `${ROOT}/index/checksums.sha256`

/** whether the corpus is on this machine at all */
export const haveCorpus = (): boolean => existsSync(CHECKSUMS)

/**
 * sha256 to path, over the whole index.
 *
 * The first line for a checksum wins: a library that ships on six disks is
 * still one library, and every copy of it is byte-identical by definition.
 * An absent corpus gives an empty map.
 */
export function corpusIndex(): Map<string, string> {
  const index = new Map<string, string>()
  if (!haveCorpus()) return index
  for (const line of readFileSync(CHECKSUMS, 'utf8').split('\n')) {
    const m = /^([0-9a-f]{64})\s+(.*)$/.exec(line)
    if (m && !index.has(m[1]!)) index.set(m[1]!, `${ROOT}/${m[2]!}`)
  }
  return index
}

/** the path holding this checksum, or null when neither the index nor the file is there */
export function corpusFile(sha256: string, index: Map<string, string> = corpusIndex()): string | null {
  const path = index.get(sha256)
  return path !== undefined && existsSync(path) ? path : null
}

/**
 * The MIT-released AMOS Professional assembler sources, by file name.
 *
 * There are two checkouts of them on this machine and their line numbers
 * differ by 28 or 29: the release inside the corpus is what every
 * `+Edit.s:NNNN` in this port cites, and `../AMOS-Professional-Official` is a
 * different revision of the same release. `src/cli/genedres.ts` reads a
 * BINARY out of the second one, where the numbering does not matter.
 *
 * The guard is here rather than at the call site, for the reason at the top of
 * this file: an absent checkout answers null.
 */
const AMOS_SOURCES: Record<'corpus' | 'other', string> = {
  corpus: `${ROOT}/sources/aminet-dev-amos/files/AMOSProfessional/AMOSProfessional`,
  other: '../AMOS-Professional-Official',
}

/**
 * The subdirectories a `+Name.s` may sit in, after the checkout root.
 *
 * The interpreter's own files are at the root, but `+Music.s`, `+IO_Ports.s`
 * and `+Compact.s` are under `extensions/` and `+CompExt.s`, `+CLib.s` and
 * `+APComp.s` under `compiler/`. Resolving only the root made every citation
 * into those files answer null, which the two sweeps in
 * `../ext/citations.test.ts` read as "nothing to check" rather than as a
 * failure: 284 of them went unchecked, and 149 were numbered for the other
 * checkout.
 */
const SOURCE_DIRS = ['', 'extensions/', 'compiler/', 'AMOSPro Sources/']

const sourceCache = new Map<string, string[] | null>()

/** one assembler file's lines, 0-indexed, or null when that checkout is absent */
export function amosSource(file: string, checkout: 'corpus' | 'other' = 'corpus'): string[] | null {
  const key = `${checkout}/${file}`
  const had = sourceCache.get(key)
  if (had !== undefined) return had
  const root = AMOS_SOURCES[checkout]
  const path = SOURCE_DIRS.map((d) => `${root}/${d}${file}`).find((p) => existsSync(p))
  // the sources read as binary (see CLAUDE.md), so latin1 rather than utf8
  const lines = path !== undefined ? readFileSync(path, 'latin1').split('\n') : null
  sourceCache.set(key, lines)
  return lines
}
