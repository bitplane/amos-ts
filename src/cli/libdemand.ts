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
import { walkMatching } from './walk'
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { collectUsage, identifySlot, type Confidence } from '../ext/identify'
import { allExtensions } from '../ext/registry'
import { libAsExtension, scanLibraries } from './libpool'
import { Runtime } from '../runtime/runtime'
import { tokenize } from '../tokens/tokenizer'
import { extensionImpls } from '../runtime/instr'
import { makeAllInstructions, makeAllFunctions, makeRawFunctions } from '../runtime/instr'
import { NA } from '../coverage/status'
import { writeFileSync, readFileSync as readFile } from 'node:fs'
import { mdTable } from './mdtable'

const args = process.argv.slice(2)
const wantWanted = args.includes('--wanted')
const mdAt = args.indexOf('--md')
const mdOut = mdAt >= 0 ? args[mdAt + 1] : undefined
const libsAt = args.indexOf('--libs')
const libsDir = libsAt >= 0 ? args[libsAt + 1] : undefined
const positional = args.filter(
  (a, i) => !a.startsWith('--') && !(libsAt >= 0 && i === libsAt + 1) && !(mdAt >= 0 && i === mdAt + 1),
)
const progDir = positional[0]
if (!progDir) {
  console.error('usage: libdemand <progs-dir> [--libs dir] [--wanted] [--md README.md]')
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

for (const { file: f, path } of walkMatching(progDir, /\.amos$/i)) {
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

/**
 * PORTED, not merely identified. An extension can be registered (we hold its
 * token table and can name its keywords) without a line of it being
 * implemented, and that difference is the whole point of a priority list: the
 * ranking below is programs BLOCKED, not programs seen.
 *
 * A keyword counts as implemented when the dispatch has a handler under its
 * name — slot-qualified handlers implement the keyword after the colon, the
 * same rule genmanifest applies — or when status.ts marks it n/a, which means
 * it cannot apply to a browser and never will.
 */
const portedIds = new Set(extensionImpls().flatMap((i) => [...i.ids]))
const rtForDispatch = new Runtime(tokenize('', table), table, {})
const unqualify = (n: string): string => n.replace(/^ext\d+:/, '')
const dispatched = new Set(
  [
    ...Object.keys(makeAllInstructions(rtForDispatch)),
    ...Object.keys(makeAllFunctions(rtForDispatch)),
    ...Object.keys(makeRawFunctions(rtForDispatch)),
  ].map(unqualify),
)
/** how many of an extension's named keywords the port answers for */
function coverage(id: string): { done: number; total: number } | null {
  const ext = allExtensions().find((e) => e.id === id)
  if (!ext) return null
  const names = new Set<string>()
  for (const t of ext.tokens) {
    const n = t.name.replace(/^!/, '').trim().toLowerCase()
    if (n !== '') names.add(n)
  }
  let done = 0
  for (const n of names) if (dispatched.has(n) || NA.has(n)) done++
  return { done, total: names.size }
}

if (mdOut !== undefined) {
  const rows: string[][] = []
  for (const [key, byConf] of [...hits].sort((a, b) => total(b[1]) - total(a[1]))) {
    const cov = coverage(key)
    // "port" is where the answers come from, not whether a file exists: an
    // extension whose whole table duplicates core keywords (Compact's three)
    // is fully answered with no port of its own, and saying "table only"
    // there would read as a gap that is not one
    const port = !registered.has(key)
      ? 'UNREGISTERED lead'
      : portedIds.has(key)
        ? 'module'
        : cov === null || cov.done === 0
          ? '—'
          : cov.done === cov.total
            ? 'core'
            : 'part'
    const kw = cov === null ? '—' : `${cov.done} / ${cov.total}`
    rows.push([String(total(byConf)), `\`${key}\``, port, kw])
  }
  const table = mdTable(['programs', 'extension', 'port', 'keywords answered'], rows, [
    'right',
    'left',
    'left',
    'right',
  ])
  const body = [
    '<!-- BEGIN demand: generated by src/cli/libdemand.ts, do not edit by hand -->',
    '',
    `Programs identified to each extension across ${read} readable programs`,
    `(${usingExt} of them use an extension at all), one program at a time.`,
    '',
    `${unreadable} further program(s) could not be parsed and are not counted here.`,
    'That loss is not evenly spread — it concentrates in one AMOS Basic release —',
    'so the counts are sound at the top of the table and should not be read as',
    'decisive between two neighbouring rows near the bottom.',
    '',
    table,
    '',
    '`port`: **module** = a dedicated port (`EXT_IMPLS` in `src/runtime/instr.ts`),',
    '**core** = every keyword it has is answered by core AMOS anyway, **part** =',
    'some are, **—** = none. `keywords answered` counts named entries in that',
    "extension's own token table that the dispatch answers for, n/a included.",
    '',
    'The next port is argued from the top row that is not already answered: a high',
    'program count against a low keyword count. Program counts come from a corpus',
    'assembled from many machines, so they are per program, never per slot — see',
    'the phase 2 measurements above for why that distinction is not cosmetic.',
    '',
    '<!-- END demand -->',
  ].join('\n')
  // utf8: the doc has em-dashes and so does this table. latin1 round-trips
  // the existing bytes fine but silently drops anything new above U+00FF.
  const src = readFile(mdOut, 'utf8')
  const re = /<!-- BEGIN demand[\s\S]*?<!-- END demand -->/
  if (!re.test(src)) {
    console.error(`no <!-- BEGIN demand --> ... <!-- END demand --> block in ${mdOut}`)
    process.exit(1)
  }
  writeFileSync(mdOut, src.replace(re, body), 'utf8')
  console.log(`\ndemand table written into ${mdOut}`)
}
