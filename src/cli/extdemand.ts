/**
 * Rank extensions by how many programs actually need them.
 *
 * This is the prioritisation input for implementing extension keywords, and
 * it deliberately asks a different question from extscan. extscan merges the
 * token ids seen in a slot across the whole collection and identifies the
 * result — the right thing to do when the goal is to identify a slot, since
 * more evidence narrows the candidates. But it assumes every program using
 * slot 12 used the same library, and that assumption is exactly the one the
 * slot model breaks: a slot is an index into the interpreter config of
 * whichever machine saved the file.
 *
 * So this identifies each program *separately*, from its own ids only, and
 * counts programs per extension. A program whose slot cannot be pinned to one
 * extension is counted as ambiguous rather than being assigned to a guess.
 *
 * The per-keyword table matters as much as the per-extension one: extensions
 * have long tails, and the handful of keywords everyone calls is a far
 * smaller job than the full surface.
 *
 * Run: npm run cli -- src/cli/extdemand.ts <dir>... [--libs dir] [--top N]
 */
import { readFileSync } from 'node:fs'
import { hostPath, walkFiles } from './walk'
import { join } from 'node:path'
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { collectUsage, identifySlot } from '../ext/identify'
import { allExtensions, type Extension } from '../ext/registry'
import { libAsExtension, scanLibraries } from './libpool'

const args = process.argv.slice(2)
const libsAt = args.indexOf('--libs')
const topAt = args.indexOf('--top')
const top = topAt >= 0 ? Number(args[topAt + 1]) : 15
const consumed = new Set([libsAt + 1, topAt + 1].filter((i) => i > 0))
const roots = args.filter((a, i) => !a.startsWith('--') && !consumed.has(i))
if (roots.length === 0) {
  console.error('usage: extdemand <dir>... [--libs dir] [--top N]')
  process.exit(1)
}

const core = new TokenTable(CORE_TOKENS)
const scanned = libsAt >= 0 ? scanLibraries([args[libsAt + 1]!]).libs.map(libAsExtension) : []
const pool: Extension[] = [...allExtensions(), ...scanned]

/** programs needing each extension, and how often each keyword is called */
const progs = new Map<string, Set<string>>()
const calls = new Map<string, number>()
const keywords = new Map<string, Map<string, { progs: Set<string>; uses: number }>>()
let files = 0
let failed = 0
let withExt = 0
let ambiguous = 0

for (const root of roots) {
  for (const entry of walkFiles(root)) {
    const file = hostPath(entry)
    if (!/\.amos$/i.test(file)) continue
    let lines
    try {
      const amos = parseAmosFile(readFileSync(entry))
      if (amos.source.length === 0) continue
      lines = parseSource(amos.source, core)
    } catch {
      failed++
      continue
    }
    files++
    const usage = [...collectUsage(lines)]
    if (usage.length > 0) withExt++
    for (const [, u] of usage) {
      // identify from THIS program's evidence alone
      const id = identifySlot(u, pool)
      if (id.best === undefined) {
        ambiguous++
        continue
      }
      const key = id.best.id
      if (!progs.has(key)) progs.set(key, new Set())
      progs.get(key)!.add(file)
      calls.set(key, (calls.get(key) ?? 0) + u.count)
      if (!keywords.has(key)) keywords.set(key, new Map())
      const kw = keywords.get(key)!
      for (const [tokenId, npars] of u.uses) {
        // fold argument-count variants into the keyword they belong to, so
        // "used" counts keywords rather than token entries
        const name =
          id.best.table.name(tokenId)?.trim().replace(/^!/, '') || `$${tokenId.toString(16).padStart(4, '0')}`
        if (!kw.has(name)) kw.set(name, { progs: new Set(), uses: 0 })
        const k = kw.get(name)!
        k.progs.add(file)
        k.uses += npars.size
      }
    }
  }
}

console.log(
  `${files} programs scanned (${failed} unreadable), ${withExt} use an extension` +
    (ambiguous > 0 ? `, ${ambiguous} slot-use(s) could not be pinned to one extension` : ''),
)

const ranked = [...progs.entries()].sort((a, b) => b[1].size - a[1].size)
console.log(`\nextensions by programs that need them:\n`)
console.log(`${'extension'.padEnd(24)} ${'progs'.padStart(6)} ${'calls'.padStart(8)}  ${'tier'.padEnd(7)} keywords used / total`)
for (const [id, set] of ranked) {
  const ext = pool.find((e) => e.id === id)!
  const total = ext.tokens.filter((t) => /[a-z]/i.test(t.name)).length
  // ids that resolve to no name are argument-count variants in the low-id
  // range, where the variant-folding rule does not apply; they belong to a
  // keyword already counted
  const used = [...(keywords.get(id)?.keys() ?? [])].filter((n) => !n.startsWith('$')).length
  console.log(
    `${id.slice(0, 23).padEnd(24)} ${String(set.size).padStart(6)} ${String(calls.get(id) ?? 0).padStart(8)}  ${ext.evidence.padEnd(7)} ${String(used).padStart(4)} / ${total}`,
  )
}

console.log(`\nmost-called keywords (the short head of each long tail):\n`)
for (const [id] of ranked.slice(0, top)) {
  const kw = [...(keywords.get(id) ?? new Map())].sort((a, b) => b[1].progs.size - a[1].progs.size)
  if (kw.length === 0) continue
  const line = kw.slice(0, 12).map(([n, v]) => `${n}(${v.progs.size})`).join(' ')
  console.log(`${id}\n   ${line}${kw.length > 12 ? ` … +${kw.length - 12} more` : ''}`)
}
