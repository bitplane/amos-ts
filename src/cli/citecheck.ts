/**
 * Check every routine citation in the port against the libraries themselves.
 *
 * Three checks, and they are not the same check:
 *
 *   1. ADDRESS AGREEMENT — "routine 353 ($6f2a)" must put $6f2a inside
 *      routine 353 of that extension's jump table. Catches the numbering rot
 *      that #176's disassembler fix left behind across AMCAF, where twenty-
 *      four citations were fourteen low and one of them had led the port to
 *      copy the wrong routine's behaviour.
 *   2. AMBIGUITY — "Routines 55 and 54 ($2782)" does not say which routine
 *      the address belongs to, and this tree writes that shape both ways
 *      round. Reported rather than guessed at.
 *   3. SELF-CITATION — a keyword whose prose cites ANOTHER keyword's routine
 *      and never its own. This is the one that caught `splinters single do`,
 *      where the port had read a neighbour's routine and written up the wrong
 *      behaviour under a name that then looked sourced.
 *
 * Checks 1 and 2 are assertions and live in src/ext/citations.test.ts as
 * well, so they cannot rot. Check 3 is a REPORT and cannot be an assertion:
 * a doc block that explains a family together, or cross-refers to a sibling
 * while explaining this keyword, trips it legitimately. Ten do today, all
 * innocent. It is worth running when a port is being written or re-verified,
 * where a flag is a question worth answering rather than a build failure.
 *
 * Run: npx tsx src/cli/citecheck.ts [--self]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { firstCodeHunk } from '../tokens/libtok'
import { extensionById } from '../ext/registry'
import { routineAddresses } from '../ext/routines'
import {
  CITED_BY,
  checkCitations,
  checkSelfCitation,
  findAmbiguous,
  findAnchors,
  parseCitations,
  type Library,
} from '../ext/citations'
import { NOTES } from '../coverage/status'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const extFixtures = join(root, 'fixtures', 'extensions')
const selfOnly = process.argv.includes('--self')

if (!existsSync(extFixtures)) {
  console.error('fixtures/extensions is not present (fixtures/ is gitignored)')
  process.exit(1)
}

const cache = new Map<string, Library | null>()
function library(id: string): Library | null {
  if (cache.has(id)) return cache.get(id) ?? null
  let lib: Library | null = null
  const dir = join(extFixtures, id)
  if (existsSync(dir)) {
    /*
     * The MANIFEST names the build, and it has to: a fixture directory can
     * hold more than one library and the routine numbering moves between
     * them. CRAFT is the case that forced this -- its installer blob turned
     * out to hold the AMOS 1.3 and AMOS Pro builds side by side, whose
     * routines sit four bytes apart, and picking whichever sorted first meant
     * checking every citation against a build nobody had read.
     */
    const manifest = join(root, 'src', 'ext', 'manifests', `${id}.json`)
    const named = existsSync(manifest)
      ? (JSON.parse(readFileSync(manifest, 'utf8')) as { library?: string }).library
      : undefined
    const file = named ?? readdirSync(dir).find((f) => /\.lib$/i.test(f))
    if (file && existsSync(join(dir, file))) {
      const code = firstCodeHunk(new Uint8Array(readFileSync(join(dir, file))))
      const addr = routineAddresses(code)
      const version = /-([0-9]+\.[0-9]+[a-z0-9]*)$/.exec(id)?.[1] ?? id
      if (addr.length > 0) lib = { id, version, addr, hunkLen: code.length }
    }
  }
  cache.set(id, lib)
  return lib
}

/**
 * keyword -> its routines, and routine -> the keywords that name it, for ONE
 * version of one extension.
 *
 * Per version, not pooled, and that matters. Pooling AMCAF 1.40 and 1.50
 * reported `pt sam volume` for citing "routine 245" — which is Pt Cia Speed
 * in 1.40 and Pt Sam Volume's own two-argument form in 1.50. The numbering
 * moved between releases, so a routine number only means anything alongside
 * the version it came from.
 */
function tables(id: string): { own: Map<string, Set<number>>; named: Map<number, string[]> } {
  const own = new Map<string, Set<number>>()
  const named = new Map<number, string[]>()
  for (const t of extensionById(id)?.tokens ?? []) {
    const name = t.name.trim().replace(/^!/, '').toLowerCase()
    if (name === '') continue
    const set = own.get(name) ?? new Set<number>()
    for (const r of [t.instr, t.func]) {
      if (r === 0xffff) continue
      set.add(r)
      named.set(r, [...new Set([...(named.get(r) ?? []), name])])
    }
    own.set(name, set)
  }
  return { own, named }
}

let stale = 0
let vague = 0
let cited = 0
let questions = 0

for (const [file, ids] of Object.entries(CITED_BY)) {
  const path = join(root, file)
  if (!existsSync(path)) {
    console.log(`${file}: listed in CITED_BY but not in the tree`)
    continue
  }
  const libs = ids.map(library).filter((l): l is Library => l !== null)
  const text = readFileSync(path, 'utf8')

  if (!selfOnly && libs.length > 0) {
    const cites = parseCitations(text)
    cited += cites.length
    for (const m of checkCitations(cites, libs)) {
      stale++
      console.log(`${file}:${m.line}  ${m.text} — ${m.real}`)
    }
    for (const a of findAmbiguous(text)) {
      vague++
      console.log(`${file}:${a.line}  ${a.text} — which routine is the address for?`)
    }
  }

  // the first id is the version the port was read from; a keyword the primary
  // does not have (LDos 2.6's eight additions, say) falls through to the next
  for (const id of ids) {
    const { own, named } = tables(id)
    const anchors = findAnchors(text, (n) => own.has(n))
    const seen = new Set<string>()
    for (const q of checkSelfCitation(text, anchors, own, named)) {
      if (seen.has(`${q.name}:${q.line}`)) continue
      seen.add(`${q.name}:${q.line}`)
      questions++
      const who = q.cited.map((c) => `${c} (${named.get(c)!.join('/')})`).join(', ')
      console.log(`${file}:${q.line}  '${q.name}' cites ${who} but never its own`)
    }
    break
  }
}

if (!selfOnly) {
  // status.ts holds every extension's notes in one flat map keyed by keyword,
  // so each note's extension is resolved through the registry, per keyword
  const owners = new Map<string, string[]>()
  for (const ids of Object.values(CITED_BY)) {
    for (const id of ids) {
      for (const t of extensionById(id)?.tokens ?? []) {
        const name = t.name.trim().replace(/^!/, '').toLowerCase()
        if (name === '') continue
        const list = owners.get(name) ?? []
        if (!list.includes(id)) list.push(id)
        owners.set(name, list)
      }
    }
  }
  for (const [keyword, note] of Object.entries(NOTES)) {
    const cites = parseCitations(note)
    cited += cites.length
    const libs = (owners.get(keyword.toLowerCase()) ?? []).map(library).filter((l): l is Library => l !== null)
    if (libs.length > 0) {
      for (const m of checkCitations(cites, libs)) {
        stale++
        console.log(`NOTES['${keyword}']  ${m.text} — ${m.real}`)
      }
    }
    for (const a of findAmbiguous(note)) {
      vague++
      console.log(`NOTES['${keyword}']  ${a.text} — which routine is the address for?`)
    }
  }
}

console.log()
if (!selfOnly) console.log(`${cited} citations checked: ${stale} disagree with the binary, ${vague} ambiguous`)
console.log(`${questions} keywords cite a sibling's routine and never their own (a question, not a failure)`)
