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
 * Run: npm run cli -- src/cli/libscan.ts <dir|file>... [--json out.json] [--all]
 */
import { writeFileSync } from 'node:fs'
import { scanLibraries } from './libpool'

const args = process.argv.slice(2)
const jsonAt = args.indexOf('--json')
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined
const showAll = args.includes('--all')
const roots = args.filter((a, i) => !a.startsWith('--') && !(jsonAt >= 0 && i === jsonAt + 1))
if (roots.length === 0) {
  console.error('usage: libscan <dir|file>... [--json out.json] [--all]')
  process.exit(1)
}

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
