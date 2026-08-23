/**
 * Every line in the corpus that uses a keyword, as its author wrote it.
 *
 * A keyword is a token id and not text, so `grep` over `.AMOS` files finds
 * only the ones that happen to appear inside a string. This detokenises each
 * program with the extension tables its own slots name, then matches the
 * text, which is what a program actually said.
 *
 * The point is settling argument lists. `keyspec` gives what the token table
 * accepts and this gives what people wrote, and where the two disagree one of
 * them is a manual repeating itself.
 *
 * Run:  npx tsx src/cli/keygrep.ts 'Field '
 *       npx tsx src/cli/keygrep.ts --fixtures 'Shift Up'
 *
 * Matching is case-insensitive substring, so the trailing space in `'Field '`
 * is what keeps `Starfield` out.
 */
import { readFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkMatching } from './walk'
import { haveCorpus, corpusIndex } from './corpus'
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { detokSource } from '../tokens/edtok'
import { extensionTablesFor } from '../ext/identify'

const args = process.argv.slice(2)
const fixturesOnly = args.includes('--fixtures')
const needle = args.filter((a) => !a.startsWith('--')).join(' ').toLowerCase()
if (needle === '') {
  console.error("usage: keygrep [--fixtures] 'Field '")
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const table = new TokenTable(CORE_TOKENS)

let paths: (Buffer | string)[]
if (fixturesOnly) paths = [...walkMatching(join(root, 'fixtures'), /\.amos$/i)].map((f) => f.file)
else if (haveCorpus()) paths = [...corpusIndex().values()]
else {
  console.error('no corpus index; try --fixtures')
  process.exit(1)
}

let read = 0
let hits = 0
for (const path of paths) {
  const shown = typeof path === 'string' ? path : path.toString('latin1')
  if (!/\.amos$/i.test(shown)) continue
  let text: string[]
  try {
    const parsed = parseAmosFile(readFileSync(path))
    if (parsed.source === undefined) continue
    const lines = parseSource(parsed.source, table)
    text = detokSource(lines, table, { extensions: extensionTablesFor(lines) }).split('\n')
  } catch {
    continue
  }
  read++
  for (let i = 0; i < text.length; i++) {
    if (!text[i]!.toLowerCase().includes(needle)) continue
    hits++
    console.log(`${relative(root, shown)}:${i + 1}: ${text[i]!.trim()}`)
  }
}
console.error(`${hits} lines in ${read} programs`)
