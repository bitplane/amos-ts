/**
 * Scan every .AMOS/.Abk file under fixtures/, parse containers and token
 * streams, and report a census: success rate, signatures, bank types,
 * unknown tokens, failures with hexdump context.
 * Run: npm run cli -- src/cli/scan.ts [--freq] [--verbose]
 */
import { readFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { hostPath, walkFiles } from './walk'
import { fileURLToPath } from 'node:url'
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable, TokenStreamError } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { extensionTablesFor } from '../ext/identify'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixtures = join(root, 'fixtures')
const verbose = process.argv.includes('--verbose')
const freq = process.argv.includes('--freq')

const table = new TokenTable(CORE_TOKENS)

let files = 0
let sourceOk = 0
let sourceFail = 0
const signatures = new Map<string, number>()
const bankNames = new Map<string, number>()
const tokenFreq = new Map<string, number>()
const extUse = new Map<string, number>()
const failures: string[] = []
const diagnostics = new Map<string, number>()

for (const entry of walkFiles(fixtures)) {
  const path = hostPath(entry)
  if (!/\.(amos|abk)$/i.test(path)) continue
  const rel = relative(fixtures, path)
  files++
  let amos
  try {
    amos = parseAmosFile(readFileSync(entry))
  } catch (e) {
    failures.push(`${rel}: container: ${e instanceof Error ? e.message : e}`)
    continue
  }
  signatures.set(amos.signature, (signatures.get(amos.signature) ?? 0) + 1)
  for (const d of amos.diagnostics) diagnostics.set(d.replace(/\d+/g, 'N'), (diagnostics.get(d.replace(/\d+/g, 'N')) ?? 0) + 1)
  for (const b of amos.banks) {
    bankNames.set(b.kind === 'memory' ? `AmBk:${b.name}` : b.kind, (bankNames.get(b.kind === 'memory' ? `AmBk:${b.name}` : b.kind) ?? 0) + 1)
  }
  if (amos.source.length === 0) continue
  try {
    // there was a retry against the AGA release's core table here; it was
    // byte-identical to this one, so the retry could never succeed
    const used = table
    const lines = parseSource(amos.source, table)
    sourceOk++
    // resolve each slot from the program's own evidence, not a fixed map
    const extTables = extensionTablesFor(lines)
    for (const line of lines) {
      for (const tok of line.tokens) {
        if (tok.kind === 'core') {
          const name = used.get(tok.id)?.name.trim() ?? `$${tok.id.toString(16)}`
          tokenFreq.set(name, (tokenFreq.get(name) ?? 0) + 1)
        } else if (tok.kind === 'ext') {
          const name = extTables.get(tok.ext)?.name(tok.id)?.trim()
          const key = `ext${tok.ext}:${name ?? '$' + tok.id.toString(16)}`
          extUse.set(key, (extUse.get(key) ?? 0) + 1)
        }
      }
    }
  } catch (e) {
    sourceFail++
    if (e instanceof TokenStreamError) {
      const hex = [...e.lineBytes.slice(0, 48)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
      failures.push(`${rel}: ${e.message}\n    ${hex}`)
    } else {
      failures.push(`${rel}: ${e instanceof Error ? e.message : e}`)
    }
  }
}

console.log(`files: ${files}, with source ok: ${sourceOk}, failed: ${sourceFail}`)
console.log('signatures:', Object.fromEntries(signatures))
console.log('banks:', Object.fromEntries([...bankNames.entries()].sort((a, b) => b[1] - a[1])))
console.log('diagnostics:', Object.fromEntries(diagnostics))
console.log('extension token use:', Object.fromEntries([...extUse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)))
if (freq) {
  console.log('top tokens:')
  for (const [name, n] of [...tokenFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) {
    console.log(`  ${String(n).padStart(6)}  ${name}`)
  }
}
const shown = verbose ? failures : failures.slice(0, 15)
for (const f of shown) console.log('FAIL', f)
if (failures.length > shown.length) console.log(`... and ${failures.length - shown.length} more failures`)
