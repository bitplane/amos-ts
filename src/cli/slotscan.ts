/**
 * Survey extension slot assignments across a tree, by name.
 *
 * src/cli/extscan.ts answers "what was in slot 12 of this program?" from the
 * token ids the program calls, which is inference: it can only name an
 * extension the registry already holds. This answers the same question from
 * the interpreter config a compiled AMOS program carries, which is testimony.
 * The config states the FILENAME the machine loaded into every slot, so an
 * extension nothing in the registry explains still arrives with a name.
 *
 * src/cli/slottab.ts does the reading and records why message 46 is what the
 * table is found by. This walks a tree, aggregates the answers per filename,
 * and matches them against the registry.
 *
 * Three things come out of it, in rising order of value:
 *
 *   - the popular slot for each extension, over real installations rather
 *     than over what its manual recommended;
 *   - `observedSlots` evidence for registered extensions, which is exactly
 *     what identifySlot scores candidates with;
 *   - NAMES for extensions the registry does not hold, which is the point.
 *     A slot the token-id scan can only describe as "an entry at $04d2 taking
 *     one argument" becomes `MaxMap.lib`, and a name is searchable.
 *
 * A slot is a property of the machine a program was saved on, so every row
 * here is one author's configuration and not a rule. That is the same kind of
 * evidence `observedSlots` already holds, and the registry header is emphatic
 * about the distinction.
 *
 * Run: npm run cli -- src/cli/slotscan.ts <dir|file>... [--json out.json] [--files]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { walkFiles, hostPath } from './walk'
import { configSlots, mainLibrary, readConfigTables } from './slottab'
import { REGISTRY } from '../ext/registry'

const args = process.argv.slice(2)
const jsonAt = args.indexOf('--json')
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined
const showFiles = args.includes('--files')
const roots = args.filter((a, i) => !a.startsWith('--') && !(jsonAt >= 0 && i === jsonAt + 1))
if (roots.length === 0) {
  console.error('usage: slotscan <dir|file>... [--json out.json] [--files]')
  process.exit(1)
}

/** The comparable part of a name: `AMOSPro_TURBO_Plus` and `Turbo Plus` both give `turboplus`. */
function stem(text: string): string {
  return text
    .replace(/^amos_?pro_?/i, '')
    .replace(/^amos_?/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

/**
 * The library a config entry names, reduced for comparison.
 *
 * An entry is a filename and then a command line, split at the first space by
 * Sys_AddPathCom (+B.s:515-530), which hands the tail to the library:
 * `AMOSPro_3D.Lib -fWork:AMOS_Pro/APSystem/` is AMOS 3D being told where its
 * data lives. The filename half may be a full AmigaDOS path, as it is in the
 * twenty configs that load SymBase out of `AmosPro_Tutorial:Extensions/`.
 * Both are stripped, and so is a version somebody appended after the suffix
 * (`AMOSPro_JD.Lib5.9`).
 */
const configKey = (entry: string): string =>
  stem(
    entry
      .split(' ')[0]!
      .replace(/^.*[/:]/, '')
      .replace(/\.lib(rary)?[\d._]*$/i, ''),
  )

/** An extension id without its version, so `jd-colour-2.0` gives `jdcolour`. */
function idKey(id: string): string {
  const parts = id.split('-')
  while (parts.length > 1) {
    const last = parts[parts.length - 1]!
    if (!/^\d/.test(last) && last !== 'demo') break
    parts.pop()
  }
  return stem(parts.join(''))
}

/** normalised name -> registry ids answering to it */
const registered = new Map<string, string[]>()
for (const e of REGISTRY) {
  for (const k of new Set([stem(e.name), idKey(e.id)])) {
    if (k === '') continue
    const at = registered.get(k)
    if (at) at.push(e.id)
    else registered.set(k, [e.id])
  }
}

/** Slots the registry already claims for an id, from any of its three sources. */
function claimedSlots(id: string): Set<number> {
  const e = REGISTRY.find((x) => x.id === id)
  const out = new Set<number>(e?.observedSlots ?? [])
  if (e?.defaultSlot !== undefined) out.add(e.defaultSlot)
  if (e?.statedSlot !== undefined) out.add(e.statedSlot)
  return out
}

interface Seen {
  /** the filename as it was spelled, first spelling wins for display */
  name: string
  /** slot -> how many configs put it there */
  slots: Map<number, number>
  files: string[]
}

const seen = new Map<string, Seen>()
const mains = new Map<string, number>()
let filesRead = 0
let tablesFound = 0
let filesWithTable = 0
let ambiguous = 0

for (const root of roots) {
  for (const file of walkFiles(root)) {
    let data: Uint8Array
    try {
      data = readFileSync(file)
    } catch {
      continue
    }
    filesRead++
    const tables = readConfigTables(data)
    if (tables.length === 0) continue
    filesWithTable++
    tablesFound += tables.length
    const path = hostPath(file)
    // Two configs in one file are normal: a compiled program embeds the one
    // it was built with, and an installer may ship another alongside it. Two
    // READINGS of the same config are not, and get counted separately.
    const offsets = new Set(tables.map((t) => t.offset))
    if (offsets.size !== tables.length) ambiguous++
    for (const t of tables) {
      const main = mainLibrary(t)
      mains.set(main, (mains.get(main) ?? 0) + 1)
      for (const [slot, name] of configSlots(t)) {
        const k = configKey(name)
        let row = seen.get(k)
        if (!row) {
          row = { name, slots: new Map(), files: [] }
          seen.set(k, row)
        }
        row.slots.set(slot, (row.slots.get(slot) ?? 0) + 1)
        if (!row.files.includes(path)) row.files.push(path)
      }
    }
  }
}

const total = (r: Seen): number => [...r.slots.values()].reduce((a, b) => a + b, 0)
const slotList = (r: Seen): string =>
  [...r.slots.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([s, n]) => `${s}${n > 1 ? `x${n}` : ''}`)
    .join(' ')

const rows = [...seen.entries()].sort((a, b) => total(b[1]) - total(a[1]) || a[0].localeCompare(b[0]))
const known = rows.filter(([k]) => registered.has(k))
const unknown = rows.filter(([k]) => !registered.has(k))

console.log(
  `${filesRead} files read, ${tablesFound} config table(s) in ${filesWithTable} file(s)` +
    (ambiguous > 0 ? `, ${ambiguous} ambiguous` : ''),
)
console.log(
  `main library: ${[...mains.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([n, c]) => `${n === '' ? '(empty)' : n} x${c}`)
    .join(', ')}`,
)

const width = Math.min(34, Math.max(...rows.map(([, r]) => r.name.length), 10))
const line = (r: Seen, tail: string): void => {
  console.log(`  ${r.name.padEnd(width)}  ${String(total(r)).padStart(4)}  ${slotList(r).padEnd(18)}  ${tail}`)
  if (showFiles) for (const f of r.files.slice(0, 20)) console.log(`      ${f}`)
}

console.log(`\nREGISTERED (${known.length})`)
for (const [k, r] of known) {
  const ids = registered.get(k)!
  const fresh = [...r.slots.keys()].filter((s) => !ids.some((id) => claimedSlots(id).has(s)))
  line(r, ids.join(' ') + (fresh.length > 0 ? `  NEW SLOT ${fresh.sort((a, b) => a - b).join(',')}` : ''))
}

/**
 * Registered ids whose name merely OVERLAPS this one. `AMOSPro_Prt.Lib` and
 * `jd-prt-1.4` are the same extension under two spellings, and so are
 * `AMOSPro_DOOM_Music.lib` and `dme-2.0`; `AMOSPro_Game.Lib` and
 * `gamesupport-1.2` may well not be. Reported as a lead, never as a match.
 */
function overlapping(k: string): string[] {
  const out = new Set<string>()
  for (const [rk, ids] of registered) {
    if (rk.length < 3 || k.length < 3) continue
    if (rk.includes(k) || k.includes(rk)) for (const id of ids) out.add(id)
  }
  return [...out]
}

console.log(`\nNOT IN THE REGISTRY (${unknown.length})`)
for (const [k, r] of unknown) {
  const near = overlapping(k)
  line(r, near.length > 0 ? `maybe ${near.join(' ')}` : '')
}

if (jsonOut !== undefined) {
  writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        filesRead,
        tablesFound,
        libraries: rows.map(([k, r]) => ({
          name: r.name,
          key: k,
          registered: registered.get(k) ?? null,
          slots: Object.fromEntries([...r.slots.entries()].sort((a, b) => a[0] - b[0])),
          files: r.files,
        })),
      },
      null,
      2,
    ),
  )
  console.log(`\n${jsonOut} written`)
}
