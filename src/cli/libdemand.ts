/**
 * Rank extensions by how many PROGRAMS identify to them, one program at a time.
 *
 * Run: npm run cli -- src/cli/libdemand.ts <progs-dir> [--libs dir] [--wanted]
 *
 * Why per-program rather than per-slot: a slot number is a property of the
 * machine a program was saved on, so two programs can hold different
 * extensions in the same slot. Unioning the token ids seen in slot 1 across
 * 1,943 programs therefore describes no real library at all, and one program
 * with something else installed there is enough to make every genuine
 * candidate look wrong by a few ids. `extscan` reports per slot, which is the
 * right question for one collection; this is the right question for a corpus
 * assembled from many machines.
 *
 * Identification is `identifySlot`, unchanged — so a candidate has to account
 * for every observed id AND land those ids on named entries with agreeing
 * arities, and it reports a confidence. That last part matters: a naive
 * "does this table have an entry at every id" test rewards big tables, because
 * a 1,048-entry library has an id at almost every offset and so explains
 * anything. Coincidental numeric fit is the trap this measure exists to avoid,
 * and `ambiguous` results are reported rather than resolved by guessing.
 */
import { readFileSync } from 'node:fs'
import { walkFiles, hostPath } from './walk'
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { collectUsage, identifySlot, type Confidence } from '../ext/identify'
import { allExtensions } from '../ext/registry'
import { libAsExtension, scanLibraries } from './libpool'

const args = process.argv.slice(2)
const wantWanted = args.includes('--wanted')
const libsAt = args.indexOf('--libs')
const libsDir = libsAt >= 0 ? args[libsAt + 1] : undefined
const positional = args.filter((a, i) => !a.startsWith('--') && !(libsAt >= 0 && i === libsAt + 1))
const progDir = positional[0]
if (!progDir) {
  console.error('usage: libdemand <progs-dir> [--libs dir] [--wanted]')
  process.exit(1)
}

const scanned = libsDir === undefined ? [] : scanLibraries([libsDir]).libs
const pool = [...allExtensions(), ...scanned.map(libAsExtension)]
if (libsDir !== undefined) console.log(`${scanned.length} distinct library table(s) read from ${libsDir}`)

const registered = new Set(allExtensions().map((e) => e.id))
const table = new TokenTable(CORE_TOKENS)

/** extension id -> programs, split by the confidence they were identified with */
const hits = new Map<string, Map<Confidence, Set<string>>>()
/** slot -> ids nothing in the pool explains */
const wanted = new Map<number, Set<number>>()
let read = 0
let unreadable = 0
let usingExt = 0

for (const f of walkFiles(progDir)) {
  const path = hostPath(f)
  if (!/\.amos$/i.test(path)) continue
  let usage
  try {
    const amos = parseAmosFile(readFileSync(f))
    if (!amos.source.length) continue
    read++
    usage = collectUsage(parseSource(amos.source, table))
  } catch {
    unreadable++
    continue
  }
  if (usage.size === 0) continue
  usingExt++
  for (const [slot, use] of usage) {
    const id = identifySlot(use, pool)
    if (id.best && id.confidence !== 'unknown') {
      const key = id.best.id
      if (!hits.has(key)) hits.set(key, new Map())
      const byConf = hits.get(key)!
      if (!byConf.has(id.confidence)) byConf.set(id.confidence, new Set())
      byConf.get(id.confidence)!.add(path)
    } else {
      if (!wanted.has(slot)) wanted.set(slot, new Set())
      for (const i of id.unresolvedIds.length > 0 ? id.unresolvedIds : use.uses.keys()) {
        wanted.get(slot)!.add(i)
      }
    }
  }
}

const total = (m: Map<Confidence, Set<string>>): number =>
  new Set([...m.values()].flatMap((s) => [...s])).size

console.log(`\n${read} programs read, ${unreadable} unreadable, ${usingExt} use at least one extension\n`)
console.log('extensions ranked by programs identified to them:')
console.log('  progs  exact  prob  ambig   status        extension')
for (const [key, byConf] of [...hits].sort((a, b) => total(b[1]) - total(a[1]))) {
  const n = (c: Confidence): number => byConf.get(c)?.size ?? 0
  const status = registered.has(key) ? 'registered' : 'UNREGISTERED'
  console.log(
    `  ${String(total(byConf)).padStart(5)}  ${String(n('exact')).padStart(5)}  ${String(n('probable')).padStart(4)}  ${String(n('ambiguous')).padStart(5)}   ${status.padEnd(12)}  ${key}`,
  )
}

if (wantWanted && wanted.size > 0) {
  console.log('\nunexplained token ids — the wanted list:')
  for (const [slot, ids] of [...wanted].sort((a, b) => b[1].size - a[1].size)) {
    const list = [...ids].sort((a, b) => a - b).map((i) => '$' + i.toString(16).padStart(4, '0'))
    console.log(`  slot ${String(slot).padStart(2)}: ${ids.size} ids — ${list.slice(0, 16).join(' ')}${ids.size > 16 ? ' ...' : ''}`)
  }
}
