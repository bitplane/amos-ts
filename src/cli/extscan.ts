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
 * Run: npm run cli -- src/cli/extscan.ts <dir|file>... [--json out.json]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { collectUsage, identifySlot, type SlotUsage } from '../ext/identify'
import { allExtensions } from '../ext/registry'

const args = process.argv.slice(2)
const jsonAt = args.indexOf('--json')
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined
const roots = args.filter((a, i) => !a.startsWith('--') && !(jsonAt >= 0 && i === jsonAt + 1))
if (roots.length === 0) {
  console.error('usage: extscan <dir|file>... [--json out.json]')
  process.exit(1)
}

function* walk(p: string): Generator<string> {
  let st
  try {
    st = statSync(p)
  } catch {
    return
  }
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) yield* walk(join(p, e))
  } else if (/\.amos$/i.test(p)) {
    yield p
  }
}

const core = new TokenTable(CORE_TOKENS)
const pool = allExtensions()

/** Merged evidence per slot, plus which programs contributed it. */
const merged = new Map<number, SlotUsage & { programs: Set<string> }>()
let scanned = 0
let failed = 0

for (const root of roots) {
  for (const file of walk(root)) {
    let lines
    try {
      const amos = parseAmosFile(readFileSync(file))
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
  const label =
    id.best === undefined
      ? `?? (${id.confidence})`
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
