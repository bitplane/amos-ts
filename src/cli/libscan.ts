/**
 * Inventory the AMOS extension libraries in a collection.
 *
 * The companion to extscan. Where extscan reads *programs* and reports which
 * slot numbers they use, this reads the `.Lib` files themselves and reports
 * what each one's token table contains — every keyword the extension has,
 * not just the ones some program happened to call.
 *
 * That difference is the point. A corpus only ever reveals the keywords its
 * programs used; the library is the complete list, and it is what turns a
 * slot full of unexplained token ids into a named extension. Run both over a
 * collection that carries programs and libraries together and the collection
 * identifies itself:
 *
 *   npm run cli -- src/cli/libscan.ts /path/to/collection
 *   npm run cli -- src/cli/extscan.ts /path/to/collection --libs /path/to/collection
 *
 * What comes out is a lead, not a registry entry. A matching token table
 * establishes which table a slot held; it says nothing about the extension's
 * name, version, author, licence or behaviour, and the id base is assumed
 * rather than calibrated. Registering it properly is a manual step —
 * see docs/extensions/README.md.
 *
 * `--gap` answers the other question a collection raises: which of these
 * tables does the registry not already have? That is the acquisition backlog,
 * and it is worth measuring rather than inferring from the registry's own size.
 *
 * Run: npm run cli -- src/cli/libscan.ts <dir|file>... [--json out.json] [--all] [--gap]
 */
import { writeFileSync } from 'node:fs'
import { scanLibraries } from './libpool'
import { allExtensions } from '../ext/registry'
import type { TokenEntry } from '../tokens/libtok'

const args = process.argv.slice(2)
const jsonAt = args.indexOf('--json')
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined
const showAll = args.includes('--all')
const showGap = args.includes('--gap')
const roots = args.filter((a, i) => !a.startsWith('--') && !(jsonAt >= 0 && i === jsonAt + 1))
if (roots.length === 0) {
  console.error('usage: libscan <dir|file>... [--json out.json] [--all] [--gap]')
  process.exit(1)
}

/**
 * A table's identity for comparison: its NAMED entries, as id-to-name pairs.
 *
 * Named entries are what identification resolves against and what dispatch
 * keys on, so two tables agreeing on all of them are interchangeable to a
 * program even if they differ elsewhere. Comparing whole id sets instead
 * reports a difference for an extra unnamed padding entry, which is how the
 * real Intuition.lib first looked mismatched against our source-assembled
 * table when in fact all 183 named keywords agreed.
 */
const namedKey = (tokens: readonly TokenEntry[]): string =>
  tokens
    .filter((t) => /[a-z]/i.test(t.name))
    .map((t) => `${t.id}:${t.name.trim()}`)
    .sort()
    .join(',')

const { libs, unreadable } = scanLibraries(roots)
libs.sort((a, b) => b.tokens.length - a.tokens.length)

console.log(
  `${libs.length} distinct token table(s) from ${roots.join(', ')}` +
    ` (${unreadable.length} .Lib file(s) neither layout could read)`,
)
if (libs.length === 0) process.exit(0)

console.log()
for (const lib of libs) {
  const names = lib.tokens.filter((t) => /[a-z]/i.test(t.name)).map((t) => t.name.trim().replace(/^!/, ''))
  const shown = showAll ? names : names.slice(0, 10)
  console.log(
    `${String(lib.tokens.length).padStart(4)} entries  ${String(lib.named).padStart(4)} named  ` +
      `${lib.format.padEnd(6)}  ${lib.file}` +
      (lib.copies.length > 1 ? `  (+${lib.copies.length - 1} copies)` : ''),
  )
  console.log(`      ${shown.join(', ')}${shown.length < names.length ? `, ... (+${names.length - shown.length})` : ''}`)
}

if (showGap) {
  const registered = new Map<string, string[]>()
  for (const e of allExtensions()) {
    const k = namedKey(e.tokens)
    registered.set(k, [...(registered.get(k) ?? []), e.id])
  }

  const missing: typeof libs = []
  const matched: Array<{ lib: (typeof libs)[number]; as: string[]; sameIds: boolean }> = []
  for (const lib of libs) {
    const as = registered.get(namedKey(lib.tokens))
    if (!as) {
      missing.push(lib)
      continue
    }
    // the named keywords agree; note when the raw id sets still do not, so a
    // reader is not left wondering why two "identical" tables differ in size
    const ours = allExtensions().find((e) => e.id === as[0])!
    matched.push({ lib, as, sameIds: ours.tokens.length === lib.tokens.length })
  }

  console.log(
    `\nregistry gap: ${matched.length} of ${libs.length} table(s) match a registered extension` +
      ` on every named keyword, ${missing.length} do not`,
  )
  const padded = matched.filter((m) => !m.sameIds)
  if (padded.length > 0) {
    console.log(
      `  ${padded.length} of the matches differ only in unnamed padding entries: ` +
        padded.map((m) => m.as.join('/')).join(', '),
    )
  }
  if (missing.length > 0) {
    console.log('\nnot in the registry, largest first:')
    for (const l of [...missing].sort((a, b) => b.named - a.named)) {
      console.log(
        `  ${String(l.named).padStart(4)} named  ${String(l.copies.length).padStart(3)} copies  ` +
          l.file.replace(/^.*\//, ''),
      )
      console.log(`        ${l.file}`)
    }
  }

  const covered = new Set(matched.flatMap((m) => m.as))
  const absent = allExtensions()
    .map((e) => e.id)
    .filter((id) => !covered.has(id))
  if (absent.length > 0) {
    console.log(`\nregistered but no matching table here (${absent.length}):`)
    console.log(`  ${absent.join(', ')}`)
  }
}

// The unreadable list matters as much as the readable one: the AMOS 1.3 core
// libraries (W.Lib, AMOS.Lib) and non-AMOS .lib files land here, and so would
// any extension layout we cannot yet parse.
if (unreadable.length > 0 && showAll) {
  console.log(`\nunreadable:`)
  for (const f of unreadable) console.log(`  ${f}`)
}

if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        roots,
        libs: libs.map((l) => ({
          id: l.id,
          file: l.file,
          copies: l.copies,
          format: l.format,
          sha256: l.sha256,
          entries: l.tokens.length,
          named: l.named,
          tokens: l.tokens,
        })),
        unreadable,
      },
      null,
      2,
    ),
  )
  console.log(`\ntables written to ${jsonOut}`)
}
