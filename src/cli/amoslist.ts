/**
 * List a .AMOS file: banks summary and detokenized source.
 * Run: npm run cli -- src/cli/amoslist.ts <file.AMOS>
 */
import { readFileSync } from 'node:fs'
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable } from '../tokens/stream'
import { detokSource } from '../tokens/detok'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { extensionTablesFor } from '../ext/identify'

const file = process.argv[2]
if (!file) {
  console.error('usage: amoslist <file.AMOS>')
  process.exit(1)
}

const amos = parseAmosFile(readFileSync(file))
console.error(`signature: ${JSON.stringify(amos.signature)}`)
for (const d of amos.diagnostics) console.error(`note: ${d}`)
for (const b of amos.banks) {
  if (b.kind === 'memory') {
    console.error(`bank ${b.number}: "${b.name}" ${b.data.length} bytes ${b.memType ? 'chip' : 'fast'}`)
  } else {
    console.error(`${b.kind} bank: ${b.sprites.length} images`)
  }
}

if (amos.source.length > 0) {
  const table = new TokenTable(CORE_TOKENS)
  const lines = parseSource(amos.source, table)
  const extensions = extensionTablesFor(lines)
  console.log(detokSource(lines, table, { extensions }))
}
