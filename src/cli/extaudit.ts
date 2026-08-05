/**
 * What an extension port can SHOW, as opposed to what it covers.
 *
 * KEYWORDS.md counts handlers that exist. This counts readings that happened:
 * for every keyword, whether the doc block governing its handler cites code --
 * a jump-table routine, an engine address, or a line of AMOS source. The gap
 * between the two numbers is the work #198 is about.
 *
 * Run:  npx tsx src/cli/extaudit.ts <extension-id>
 *       npx tsx src/cli/extaudit.ts --all
 *
 * This was AMCAF-only for its first life, and silently so: it took an argument
 * and ignored it, importing makeAmcafInstructions directly and reading
 * '../runtime/amcaf.ts' by name, so `extaudit locale` printed an AMCAF report.
 * A tool that answers confidently about the wrong subject is the same class of
 * error as a stale citation, which is what this tool exists to find.
 *
 * KNOWN LIMIT: the citation measure is anchored on a handler written as a
 * literal key in the source, which is how `findAnchors` locates it. A port that
 * BUILDS its table in a loop has no such anchor -- jdprt.ts registers five
 * keywords literally and generates the other fifty-eight from the token table,
 * so it audits as a five-keyword port with fifty-eight approximations. The
 * "generated" line below says so rather than leaving the shape to be puzzled
 * over; those handlers still need reading, they just cannot be counted here.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { findAnchors } from '../ext/citations'
import { FAITHFUL, NA, noteFor } from '../coverage/status'
import { extensionById } from '../ext/registry'
import { Runtime } from '../runtime/runtime'
import type { ExtensionImpl } from '../runtime/extimpl'
import { extensionImpls, makeAllInstructions, makeAllFunctions } from '../runtime/instr'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'

const t = new TokenTable(CORE_TOKENS)
const rt = new Runtime(tokenize('Rem', t, new Map()), t, {})
const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime')
const SOURCES = readdirSync(RUNTIME_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

/** Every layer's answer, for the MISSING test below. */
const answered = new Set([...Object.keys(makeAllInstructions(rt)), ...Object.keys(makeAllFunctions(rt))])

const CITES = /\broutines?\s+\d{1,4}|\$[0-9a-fA-F]{3,6}\b|\+\|?[\w.]+\.s:\d+/

const plain = (n: string): string => n.replace(/^ext\d+:/, '')

export interface Audit {
  id: string
  ids: readonly string[]
  file: string
  names: number
  implemented: number
  na: number
  missing: string[]
  elsewhere: string[]
  faithful: number
  approximated: string[]
  anchors: number
  cited: Set<string>
  uncited: string[]
}

/**
 * Audit one port.
 *
 * The unit is the PORT and not the release: `impl.ids` is the set of identities
 * one body of code serves, so the token tables of all of them are merged the
 * way AMCAF's 1.40 and 1.50 were. Auditing a single release would report every
 * keyword the other release adds as missing.
 */
export function audit(impl: ExtensionImpl): Audit | null {
  const have = new Set(
    [...Object.keys(impl.instructions?.(rt) ?? {}), ...Object.keys(impl.functions?.(rt) ?? {})].map(plain),
  )
  if (have.size === 0) return null

  const all = new Set(
    impl.ids
      .flatMap((id) => extensionById(id)?.tokens ?? [])
      .map((k) => k.name.replace(/^!/, '').trim().toLowerCase())
      .filter(Boolean),
  )

  /**
   * A release may spell a keyword differently from the one the port was written
   * against -- JD's printer companion renamed all 58 between 1.1 and 1.3. The
   * port implements one spelling and declares the other in `aliases`, so an
   * alias whose target IS implemented is implemented, and counting it as
   * missing would invent a gap the size of a whole release.
   */
  const aliased = new Map<string, string>()
  for (const map of Object.values(impl.aliases ?? {}))
    for (const [alias, canonical] of Object.entries(map)) if (have.has(canonical)) aliased.set(alias, canonical)

  const covers = (n: string): boolean => have.has(n) || aliased.has(n)

  // the file holding this port's handlers: whichever has the most of them
  let file = ''
  let anchors: ReturnType<typeof findAnchors> = []
  for (const f of SOURCES) {
    const found = findAnchors(readFileSync(join(RUNTIME_DIR, f), 'utf8'), (n) => have.has(n))
    if (found.length > anchors.length) {
      anchors = found
      file = f
    }
  }
  if (!file) return null

  const txt = readFileSync(join(RUNTIME_DIR, file), 'utf8')
  const blocks = [...txt.matchAll(/\/\*[\s\S]*?\*\//g)]

  /**
   * The doc block that GOVERNS a handler. A block documents the handler after
   * it and every sibling that follows before the next block -- `object name$`,
   * `object date` and four more share one block that cites the whole run of
   * them at once, and crediting only the first would report five phantom gaps.
   */
  const docFor = (at: number): string | null => {
    const b = blocks.filter((m) => m.index! + m[0].length <= at).pop()
    return b ? b[0] : null
  }

  /**
   * A reading counts wherever it was written down. Several keywords carry the
   * routine in their status.ts NOTE rather than in the doc block above the
   * handler -- `command name$` is one, and reading only the doc block called it
   * unread when its NOTE opens by naming the routine and address it was read
   * from. Both places are evidence; only "neither" is a gap.
   */
  const uncited: string[] = []
  const cited = new Set<string>()
  for (const a of anchors) {
    const d = docFor(a.at)
    const note = noteFor(a.name)
    if ((d && CITES.test(d)) || (note && CITES.test(note))) cited.add(a.name)
    else uncited.push(a.name)
  }

  const impls = [...all].filter(covers)
  return {
    id: impl.ids[0]!,
    ids: impl.ids,
    file,
    names: all.size,
    implemented: impls.length,
    na: [...all].filter((n) => NA.has(n)).length,
    /**
     * A keyword is only MISSING if NO layer answers it. Comparing an
     * extension's own handler table against its token table reports a gap
     * wherever another layer legitimately owns the name -- which is how this
     * script once claimed Sload and Ssave were unimplemented when the core has
     * had them, off Music's source, all along.
     */
    missing: [...all].filter((n) => !covers(n) && !answered.has(n) && !NA.has(n)),
    elsewhere: [...all].filter((n) => !covers(n) && answered.has(n) && !NA.has(n)),
    faithful: impls.filter((n) => FAITHFUL.has(n)).length,
    approximated: impls.filter((n) => !FAITHFUL.has(n) && !NA.has(n)),
    anchors: anchors.length,
    cited,
    uncited,
  }
}

function report(a: Audit): void {
  console.log(`${a.ids.join(' + ')}: ${a.names} keyword names, in ${a.file}`)
  console.log(`  implemented        ${a.implemented}`)
  console.log(`  n/a (no handler)   ${a.na}`)
  console.log(`  MISSING            ${a.missing.length}${a.missing.length ? ' -> ' + a.missing.join(', ') : ''}`)
  console.log(
    `  answered elsewhere ${a.elsewhere.length}${a.elsewhere.length ? ' -> ' + a.elsewhere.join(', ') : ''}`,
  )
  console.log(`  FAITHFUL           ${a.faithful}`)
  console.log(`  APPROXIMATED       ${a.approximated.length}`)
  console.log()
  console.log(`Handlers found in ${a.file}: ${a.anchors}`)
  if (a.implemented > a.anchors)
    console.log(`  (${a.implemented - a.anchors} more are GENERATED, not literal keys -- not measurable here)`)
  console.log(`  with a code citation in their own doc block: ${a.cited.size}`)
  console.log(`  WITHOUT one:                                 ${a.uncited.length}`)
  console.log()
  console.log('--- APPROXIMATED, split by whether it was actually read ---')
  const read = a.approximated.filter((n) => a.cited.has(n))
  const unread = a.approximated.filter((n) => !a.cited.has(n))
  console.log(`read (cites its routine), value approximated: ${read.length}`)
  for (const n of read) console.log(`   ${n}${noteFor(n) ? '' : '   [no NOTE]'}`)
  console.log(`NOT read (no citation anywhere in its block):  ${unread.length}`)
  for (const n of unread) console.log(`   ${n}${noteFor(n) ? '' : '   [no NOTE]'}`)
  console.log()
  console.log('--- every uncited handler, approximated or not ---')
  for (const n of a.uncited) console.log(`   ${n}${FAITHFUL.has(n) ? '  (marked FAITHFUL!)' : ''}`)
}

const arg = process.argv[2]
const impls = extensionImpls()

if (arg === '--all' || arg === undefined) {
  const rows = impls.map(audit).filter((a): a is Audit => a !== null)
  // worst first: the share of handlers with no reading behind them
  rows.sort((x, y) => y.uncited.length / y.anchors - x.uncited.length / x.anchors)
  console.log(
    'extension'.padEnd(22),
    'kw'.padStart(4),
    'cited'.padStart(6),
    'unread'.padStart(7),
    'appr'.padStart(5),
    'miss'.padStart(5),
    '  file',
  )
  for (const a of rows)
    console.log(
      a.id.padEnd(22),
      String(a.anchors).padStart(4),
      String(a.cited.size).padStart(6),
      String(a.uncited.length).padStart(7),
      String(a.approximated.length).padStart(5),
      String(a.missing.length).padStart(5),
      '  ' + a.file,
    )
  const unread = rows.reduce((n, a) => n + a.uncited.length, 0)
  console.log(`\n${rows.length} ports, ${rows.reduce((n, a) => n + a.anchors, 0)} handlers, ${unread} with no reading`)
} else {
  const impl = impls.find((i) => i.ids.includes(arg))
  if (!impl) {
    console.error(`no port serves "${arg}". Known: ${impls.flatMap((i) => i.ids).sort().join(', ')}`)
    process.exit(1)
  }
  const a = audit(impl)
  if (!a) {
    console.error(`"${arg}" is registered but implements nothing`)
    process.exit(1)
  }
  report(a)
}
