/**
 * Detokenise an AMOS program to plain-text source on stdout — a
 * preprocessor for `rg --pre` so you can grep the real source (keywords
 * and all, not just the ASCII string literals) across a whole tree of
 * tokenised .AMOS files.
 *
 * Contract for rg --pre: the file path is argv[2]; write the transformed
 * bytes to stdout and exit 0. Anything that isn't a tokenised AMOS
 * program (IFF, .abk, plain text, a real binary) is passed through
 * unchanged, so a single `rg --pre amoscat PATTERN tree/` searches
 * everything.
 *
 * Usage:
 *   rg --pre <path-to>/amoscat -a "December 199" ~/amos-games
 *   amoscat one.AMOS            # just print its source
 */
import { readFileSync } from 'node:fs'
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable } from '../tokens/stream'
import { detokSource } from '../tokens/detok'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { extensionTablesFor } from '../ext/identify'

const file = process.argv[2]
if (!file) {
  process.stderr.write('usage: amoscat <file>\n')
  process.exit(1)
}

const raw = readFileSync(file)

function passthrough(): never {
  process.stdout.write(raw)
  process.exit(0)
}

try {
  const amos = parseAmosFile(raw)
  if (amos.source.length === 0) passthrough() // not a tokenised program
  const table = new TokenTable(CORE_TOKENS)
  const lines = parseSource(amos.source, table)
  const extensions = extensionTablesFor(lines)
  // a leading comment banner naming the file helps when grepping -l
  process.stdout.write(detokSource(lines, table, { extensions }))
  process.stdout.write('\n')
} catch {
  passthrough() // unparseable: let rg search the raw bytes
}
