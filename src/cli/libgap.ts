/**
 * What token tables exist on disk that the registry does not have.
 *
 * Run: npm run cli -- src/cli/libgap.ts <libs-dir>
 *
 * The registry is a list of extensions somebody has written a manifest for.
 * A collection is a list of libraries that happen to be there. Those are not
 * the same list, and the difference is the actual acquisition backlog — which
 * is worth printing plainly rather than inferring from the registry's own size.
 *
 * Tables are compared by their token-id set, which is what identification uses
 * and what a program's fingerprint has to match. Two builds that differ only in
 * code are the same table and are reported as one.
 */
import { allExtensions } from '../ext/registry'
import { scanLibraries } from './libpool'

const dir = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!dir) {
  console.error('usage: libgap <libs-dir>')
  process.exit(1)
}

const key = (ids: number[]): string => [...new Set(ids)].sort((a, b) => a - b).join(',')

const registered = new Map<string, string[]>()
for (const e of allExtensions()) {
  const k = key(e.tokens.map((t) => t.id))
  registered.set(k, [...(registered.get(k) ?? []), e.id])
}

const { libs, unreadable } = scanLibraries([dir])
const matched: Array<{ file: string; named: number; ids: number[]; as: string[] }> = []
const missing: Array<{ file: string; named: number; ids: number[]; copies: number }> = []
for (const l of libs) {
  const k = key(l.tokens.map((t) => t.id))
  const as = registered.get(k)
  if (as) matched.push({ file: l.file, named: l.named, ids: l.tokens.map((t) => t.id), as })
  else missing.push({ file: l.file, named: l.named, ids: l.tokens.map((t) => t.id), copies: l.copies.length })
}

console.log(`registry: ${allExtensions().length} extensions, ${registered.size} distinct token tables`)
console.log(`on disk:  ${libs.length} distinct token tables (${unreadable.length} .Lib files neither layout could read)`)
console.log(`          ${matched.length} match a registered table, ${missing.length} do NOT\n`)

console.log('on disk but not in the registry, largest first:')
for (const m of missing.sort((a, b) => b.named - a.named)) {
  const name = m.file.replace(/^.*\//, '')
  console.log(`  ${String(m.named).padStart(4)} named  ${String(m.copies).padStart(3)} copies  ${name}`)
  console.log(`        ${m.file}`)
}

const covered = new Set(matched.flatMap((m) => m.as))
const absent = allExtensions()
  .map((e) => e.id)
  .filter((id) => !covered.has(id))
if (absent.length > 0) {
  console.log(`\nregistered but no matching table under ${dir} (${absent.length}):`)
  console.log(`  ${absent.join(', ')}`)
}
