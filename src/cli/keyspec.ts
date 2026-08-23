/**
 * What argument list does a keyword actually accept?
 *
 * The token table is the answer, and it is the one the Test pass consults:
 * `VerC` (+Verif.s:3120) matches the string `VerI` built against the entry's
 * spec, and walks the $FE chain when it does not match. So a keyword's legal
 * argument counts are its own spec plus every variant behind it, and nothing
 * else. A manual can be wrong about this and several are.
 *
 * Run:  npx tsx src/cli/keyspec.ts core field
 *       npx tsx src/cli/keyspec.ts gui-2.10 'gui open'
 *
 * The first argument is `core` or an extension id from `src/ext/registry.ts`;
 * the rest is matched against the keyword name as a substring, so a bare
 * `smp` lists the whole family.
 */
import { CORE_TOKENS } from '../tokens/tables.gen'
import { allExtensions, REGISTRY } from '../ext/registry'
import type { TokenEntry } from '../tokens/libtok'

const [which, ...words] = process.argv.slice(2)
if (which === undefined) {
  console.error('usage: keyspec <core|extension-id> <name>')
  console.error(REGISTRY.map((e) => e.id).join(' '))
  process.exit(1)
}
const needle = words.join(' ').toLowerCase()

/** `core`, one extension id, or `all` to search every registered table */
const tables: { of: string; list: readonly TokenEntry[] }[] = []
if (which === 'core' || which === 'all') tables.push({ of: 'core', list: CORE_TOKENS })
if (which !== 'core') {
  for (const e of allExtensions()) {
    if (which === 'all' || e.id === which) tables.push({ of: e.id, list: e.tokens })
  }
}
if (tables.length === 0) {
  console.error(`no extension "${which}"`)
  process.exit(1)
}

function show(t: TokenEntry, arrow: boolean): string {
  const id = `$${t.id.toString(16).padStart(4, '0')}`
  const end = t.end === undefined ? 'FF' : t.end.toString(16).toUpperCase()
  return `${arrow ? '  ->' : '    '} ${id}  ${JSON.stringify(t.name).padEnd(26)} ${JSON.stringify(t.spec).padEnd(18)} end=${end} instr=${t.instr} func=${t.func}`
}

let found = 0
for (const { of, list } of tables) {
  for (let i = 0; i < list.length; i++) {
    if (!list[i]!.name.toLowerCase().includes(needle)) continue
    found++
    console.log(of.padEnd(22) + show(list[i]!, false))
    // the $FE chain holds the other argument counts, and $FD the function
    // form. Both are nameless, so only the entry in front can reach them.
    for (let j = i + 1; j < list.length; j++) {
      const prev = list[j - 1]!.end
      if (prev === undefined || prev === 0xff) break
      console.log(' '.repeat(22) + show(list[j]!, true))
    }
  }
}
if (found === 0) console.log(`no keyword matching "${needle}"`)
