/**
 * Survey extension usage across a tree of .AMOS programs.
 *
 * Every program that uses an extension names it only by slot number, which is
 * an index into the interpreter config of the machine it was saved on. This
 * walks a collection, groups the (slot, token id, argument count) evidence, and
 * asks the registry what each slot most plausibly held.
 *
 * The point is the unidentified rows. A slot the registry cannot explain is a
 * concrete, actionable request — "find the extension whose token table has an
 * entry at offset $04d2 taking one argument" — and `--json` writes exactly that
 * out as a wanted list, so working through a large archive is mechanical rather
 * than a matter of recognising keyword names by eye.
 *
 * `--libs <dir>` answers those requests from the collection itself. Anything
 * that ships programs alongside the `.Lib` files they needed can identify its
 * own slots: libscan reads the libraries, and they join the registry as
 * identification candidates for this run only. A hit is a lead to write up by
 * hand, not a registry entry — see docs/extensions/README.md.
 *
 * Run: npm run cli -- src/cli/extscan.ts <dir|file>... [--json out.json] [--libs dir]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { hostPath, walkFiles } from './walk'
import { join } from 'node:path'
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { collectUsage, identifySlot, type SlotUsage } from '../ext/identify'
import { allExtensions } from '../ext/registry'
import { libAsExtension, scanLibraries } from './libpool'

const args = process.argv.slice(2)
const jsonAt = args.indexOf('--json')
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined
const libsAt = args.indexOf('--libs')
const libsDir = libsAt >= 0 ? args[libsAt + 1] : undefined
const consumed = new Set([jsonAt + 1, libsAt + 1].filter((i) => i > 0))
const roots = args.filter((a, i) => !a.startsWith('--') && !consumed.has(i))
if (roots.length === 0) {
  console.error('usage: extscan <dir|file>... [--json out.json] [--libs dir]')
  process.exit(1)
}

const core = new TokenTable(CORE_TOKENS)
// Registered extensions always; libraries found in the collection as well,
// when asked. Scanned candidates are marked as such in the output so a lead
// is never mistaken for a registered identification.
const scannedLibs = libsDir === undefined ? [] : scanLibraries([libsDir]).libs
const scannedIds = new Set(scannedLibs.map((l) => l.id))
const pool = [...allExtensions(), ...scannedLibs.map(libAsExtension)]
if (libsDir !== undefined) {
  console.log(`${scannedLibs.length} distinct library table(s) read from ${libsDir}`)
}

/** Merged evidence per slot, plus which programs contributed it. */
const merged = new Map<number, SlotUsage & { programs: Set<string> }>()
let scanned = 0
let failed = 0

for (const root of roots) {
  for (const entry of walkFiles(root)) {
    const file = hostPath(entry)
    if (!/\.amos$/i.test(file)) continue
    let lines
    try {
      const amos = parseAmosFile(readFileSync(entry))
      if (amos.source.length === 0) continue
      lines = parseSource(amos.source, core)
      scanned++
    } catch {
      failed++
      continue
    }
    for (const [slot, usage] of collectUsage(lines)) {
      let m = merged.get(slot)
      if (!m) merged.set(slot, (m = { slot, uses: new Map(), count: 0, programs: new Set() }))
      m.programs.add(file)
      m.count += usage.count
      for (const [id, npars] of usage.uses) {
        let s = m.uses.get(id)
        if (!s) m.uses.set(id, (s = new Set()))
        for (const n of npars) s.add(n)
      }
    }
  }
}

console.log(`scanned ${scanned} programs (${failed} unreadable) from ${roots.join(', ')}`)
if (merged.size === 0) {
  console.log('no extension keywords used')
  process.exit(0)
}

interface WantedSlot {
  slot: number
  programs: string[]
  distinctIds: number
  uses: number
  confidence: string
  identified?: string
  /** ids no registered extension explains, with the arities seen for each */
  unexplained: Array<{ id: string; arities: number[] }>
}

const wanted: WantedSlot[] = []
console.log()
for (const [slot, usage] of [...merged].sort((a, b) => a[0] - b[0])) {
  const id = identifySlot(usage, pool)
  const markers = new Set<number>()
  for (const s of usage.uses.values()) for (const v of s) markers.add(v)
  const fmt = markers.has(0xff) && markers.size === 1 ? 'AP20' : 'legacy'
  // a scanned library is a lead from this collection, not a registry entry:
  // it names the table a slot held and nothing else about the extension
  const label =
    id.best === undefined
      ? `?? (${id.confidence})`
      : scannedIds.has(id.best.id)
        ? `${id.best.name} [${id.confidence}, UNREGISTERED lead from ${id.best.provenance.replace(/^scanned from /, '')}]`
        : `${id.best.id} [${id.confidence}, ${id.best.evidence}-evidence]`
  console.log(
    `slot ${String(slot).padStart(2)}  ${String(usage.uses.size).padStart(4)} ids  ` +
      `${String(usage.count).padStart(6)} uses  ${String(usage.programs.size).padStart(4)} progs  ` +
      `${fmt.padEnd(6)} -> ${label}`,
  )
  if (id.best === undefined) {
    // show the runners-up so it is clear why nothing matched
    for (const c of id.candidates.slice(0, 3)) {
      console.log(`            ruled out ${c.ext.id}: ${c.rejected ?? 'tied with others'}`)
    }
  }
  if (id.unresolvedIds.length > 0) {
    wanted.push({
      slot,
      programs: [...usage.programs].slice(0, 20),
      distinctIds: usage.uses.size,
      uses: usage.count,
      confidence: id.confidence,
      ...(id.best ? { identified: id.best.id } : {}),
      unexplained: id.unresolvedIds.map((i) => ({
        id: `$${i.toString(16).padStart(4, '0')}`,
        arities: [...(usage.uses.get(i) ?? [])].filter((n) => n !== 0xff).sort((a, b) => a - b),
      })),
    })
  }
}

if (wanted.length > 0) {
  const total = wanted.reduce((n, w) => n + w.unexplained.length, 0)
  console.log(`\n${total} token ids across ${wanted.length} slot(s) are not explained by the registry.`)
  console.log('Each is a request for a specific missing extension — see docs/extensions/README.md.')
}
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ scanned, failed, wanted }, null, 2))
  console.log(`wanted list written to ${jsonOut}`)
}
