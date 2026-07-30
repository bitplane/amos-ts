/**
 * Survey extension usage across a tree of .AMOS programs.
 *
 * Every program that uses an extension names it only by slot number, which is
 * an index into the interpreter config of the machine it was saved on. This
 * walks a collection, asks the registry what each PROGRAM's slots held, and
 * aggregates the answers.
 *
 * Per program, not per slot, and the difference is the whole tool. A slot
 * number belongs to a machine, so two programs in one collection can hold
 * different extensions — or different versions of one — at the same slot.
 * Merging their token ids into a single fingerprint and identifying that
 * fingerprint asks a question nothing has to answer, and the merged residue
 * reads as a missing extension when the real answer is "these two programs
 * disagree". Slot 12 of the local archive is the case that proved it: merged,
 * 39 of 110 ids went unexplained and it looked like a fourth TURBO build; per
 * program it is 105 programs on TURBO 1.9, 48 on 1.0 and one on 2.15, with
 * nothing missing at all.
 *
 * The point is the unidentified rows. A slot the registry cannot explain is a
 * concrete, actionable request — "find the extension whose token table has an
 * entry at offset $04d2 taking one argument" — and `--json` writes exactly that
 * out as a wanted list, so working through a large archive is mechanical rather
 * than a matter of recognising keyword names by eye.
 *
 * `--libs <dir>` answers those requests from the collection itself. Anything
 * that ships programs alongside the `.Lib` files they needed can identify its
 * own slots: libscan reads the libraries, and they  the registry as
 * identification candidates for this run only. A hit is a lead to write up by
 * hand, not a registry entry — see docs/extensions/README.md.
 *
 * Run: npm run cli -- src/cli/extscan.ts <dir|file>... [--json out.json] [--libs dir]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { walkMatching } from './walk'
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { collectUsage, identifySlot } from '../ext/identify'
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

/** What one program's slot was identified as, or the ids that stopped it. */
interface Seen {
  /** identity -> programs that resolve to it */
  identities: Map<string, { label: string; programs: string[] }>
  /** programs whose slot nothing explains, with the ids that did the ruling out */
  stuck: Array<{ program: string; ids: number[] }>
  programs: number
  uses: number
  ids: Set<number>
  /** arities seen per id, for the wanted list */
  arities: Map<number, Set<number>>
}
const slots = new Map<number, Seen>()
let scanned = 0
let failed = 0

for (const root of roots) {
  for (const { file: entry, path: file } of walkMatching(root, /\.amos$/i)) {
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
      let m = slots.get(slot)
      if (!m) {
        slots.set(
          slot,
          (m = { identities: new Map(), stuck: [], programs: 0, uses: 0, ids: new Set(), arities: new Map() }),
        )
      }
      m.programs++
      m.uses += usage.count
      for (const [id, npars] of usage.uses) {
        m.ids.add(id)
        let a = m.arities.get(id)
        if (!a) m.arities.set(id, (a = new Set()))
        for (const n of npars) a.add(n)
      }
      const id = identifySlot(usage, pool)
      if (id.best === undefined) {
        m.stuck.push({ program: file, ids: id.unresolvedIds })
        continue
      }
      // a scanned library is a lead from this collection, not a registry
      // entry: it names the table a slot held and nothing else
      const key = `${id.best.id} [${id.confidence}]`
      const label = scannedIds.has(id.best.id)
        ? `${id.best.name} [${id.confidence}, UNREGISTERED lead from ${id.best.provenance.replace(/^scanned from /, '')}]`
        : `${id.best.id} [${id.confidence}, ${id.best.evidence}-evidence]`
      let e = m.identities.get(key)
      if (!e) m.identities.set(key, (e = { label, programs: [] }))
      e.programs.push(file)
    }
  }
}

console.log(`scanned ${scanned} programs (${failed} unreadable) from ${roots.join(', ')}`)
if (slots.size === 0) {
  console.log('no extension keywords used')
  process.exit(0)
}

interface WantedSlot {
  slot: number
  /** only the programs nothing could identify — the rest are answered */
  programs: string[]
  distinctIds: number
  uses: number
  /** ids that appear ONLY in programs no candidate explains */
  unexplained: Array<{ id: string; arities: number[]; programs: number }>
}

const wanted: WantedSlot[] = []
console.log()
for (const [slot, m] of [...slots].sort((a, b) => a[0] - b[0])) {
  const markers = new Set<number>()
  for (const s2 of m.arities.values()) for (const v of s2) markers.add(v)
  const fmt = markers.has(0xff) && markers.size === 1 ? 'AP20' : 'legacy'
  console.log(
    `slot ${String(slot).padStart(2)}  ${String(m.ids.size).padStart(4)} ids  ` +
      `${String(m.uses).padStart(6)} uses  ${String(m.programs).padStart(4)} progs  ${fmt}`,
  )
  for (const [, e] of [...m.identities].sort((a, b) => b[1].programs.length - a[1].programs.length)) {
    console.log(`         ${String(e.programs.length).padStart(5)}  ${e.label}`)
  }
  if (m.stuck.length > 0) {
    console.log(`         ${String(m.stuck.length).padStart(5)}  ?? unidentified`)
    // the ids that only unidentified programs use: those, and only those, are
    // what this collection is actually missing
    const only = new Map<number, number>()
    for (const st of m.stuck) for (const id of st.ids) only.set(id, (only.get(id) ?? 0) + 1)
    for (const [id, n] of [...only].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      console.log(`                  $${id.toString(16).padStart(4, '0')} in ${n} of them`)
    }
    wanted.push({
      slot,
      programs: m.stuck.map((st) => st.program).slice(0, 20),
      distinctIds: m.ids.size,
      uses: m.uses,
      unexplained: [...only]
        .sort((a, b) => a[0] - b[0])
        .map(([id, n]) => ({
          id: `$${id.toString(16).padStart(4, '0')}`,
          arities: [...(m.arities.get(id) ?? [])].filter((v) => v !== 0xff).sort((a, b) => a - b),
          programs: n,
        })),
    })
  }
}

if (wanted.length > 0) {
  const total = wanted.reduce((n, w) => n + w.unexplained.length, 0)
  const progs = wanted.reduce((n, w) => n + w.programs.length, 0)
  console.log(`\n${total} token ids across ${wanted.length} slot(s) are not explained by the registry,`)
  console.log(`in ${progs} program(s) of ${scanned}. Each is a request for a specific missing`)
  console.log('extension — see docs/extensions/README.md.')
}
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ scanned, failed, wanted }, null, 2))
  console.log(`wanted list written to ${jsonOut}`)
}
