/**
 * What an extension port can SHOW, as opposed to what it covers.
 *
 * KEYWORDS.md counts handlers that exist. This counts readings that happened:
 * for every keyword, whether the doc block governing its handler cites code --
 * a jump-table routine, an engine address, or a line of AMOS source. The gap
 * between the two numbers is the work #198 is about.
 *
 * Run: npx tsx src/cli/extaudit.ts
 */
import { readFileSync } from 'node:fs'
import { findAnchors } from '../ext/citations'
import { FAITHFUL, NA, NOTES } from '../coverage/status'
import { extensionById } from '../ext/registry'
import { Runtime } from '../runtime/runtime'
import { makeAmcafInstructions, makeAmcafFunctions } from '../runtime/amcaf'
import { makeAllInstructions, makeAllFunctions } from '../runtime/instr'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'

const t = new TokenTable(CORE_TOKENS)
const rt = new Runtime(tokenize('Rem', t, new Map()), t, {})
const have = new Set(
  [...Object.keys(makeAmcafInstructions(rt)), ...Object.keys(makeAmcafFunctions(rt))].map((n) =>
    n.replace(/^ext\d+:/, ''),
  ),
)
const all = new Set(
  [...(extensionById('amcaf-1.40')?.tokens ?? []), ...(extensionById('amcaf-1.50')?.tokens ?? [])]
    .map((k) => k.name.replace(/^!/, '').trim().toLowerCase())
    .filter(Boolean),
)

const txt = readFileSync(new URL('../runtime/amcaf.ts', import.meta.url), 'utf8')
const anchors = findAnchors(txt, (n) => have.has(n))
const blocks = [...txt.matchAll(/\/\*[\s\S]*?\*\//g)]

/**
 * The doc block that GOVERNS a handler. A block documents the handler after
 * it and every sibling that follows before the next block -- `object name$`,
 * `object date` and four more share one block citing routines 114..124, and
 * crediting only the first would report five phantom gaps.
 */
function docFor(at: number): string | null {
  const b = blocks.filter((m) => m.index! + m[0].length <= at).pop()
  return b ? b[0] : null
}

const CITES = /\broutines?\s+\d{1,4}|\$[0-9a-fA-F]{3,6}\b|\+\|?[\w.]+\.s:\d+/

const uncited: string[] = []
const cited = new Set<string>()
for (const a of anchors) {
  const d = docFor(a.at)
  if (d && CITES.test(d)) cited.add(a.name)
  else uncited.push(a.name)
}

const impl = [...all].filter((n) => have.has(n))
const approx = impl.filter((n) => !FAITHFUL.has(n) && !NA.has(n))
/**
 * A keyword is only MISSING if NO layer answers it. Comparing an extension's
 * own handler table against its token table reports a gap wherever another
 * layer legitimately owns the name -- which is how this script once claimed
 * Sload and Ssave were unimplemented when the core has had them, off Music's
 * source, all along.
 */
const answered = new Set([...Object.keys(makeAllInstructions(rt)), ...Object.keys(makeAllFunctions(rt))])
const missing = [...all].filter((n) => !have.has(n) && !answered.has(n) && !NA.has(n))
const elsewhere = [...all].filter((n) => !have.has(n) && answered.has(n) && !NA.has(n))

console.log(`AMCAF, both releases: ${all.size} keyword names`)
console.log(`  implemented        ${impl.length}`)
console.log(`  n/a (no handler)   ${[...all].filter((n) => NA.has(n)).length}`)
console.log(`  MISSING            ${missing.length}${missing.length ? ' -> ' + missing.join(', ') : ''}`)
console.log(`  answered elsewhere ${elsewhere.length}${elsewhere.length ? ' -> ' + elsewhere.join(', ') : ''}`)
console.log(`  FAITHFUL           ${impl.filter((n) => FAITHFUL.has(n)).length}`)
console.log(`  APPROXIMATED       ${approx.length}`)
console.log()
console.log(`Handlers found in amcaf.ts: ${anchors.length}`)
console.log(`  with a code citation in their own doc block: ${cited.size}`)
console.log(`  WITHOUT one:                                 ${uncited.length}`)
console.log()
console.log('--- APPROXIMATED, split by whether it was actually read ---')
const readNotVerified = approx.filter((n) => cited.has(n))
const unread = approx.filter((n) => !cited.has(n))
console.log(`read (cites its routine), value approximated: ${readNotVerified.length}`)
for (const n of readNotVerified) console.log(`   ${n}${NOTES[n] ? '' : '   [no NOTE]'}`)
console.log(`NOT read (no citation anywhere in its block):  ${unread.length}`)
for (const n of unread) console.log(`   ${n}${NOTES[n] ? '' : '   [no NOTE]'}`)
console.log()
console.log('--- every uncited handler, approximated or not ---')
for (const n of uncited) console.log(`   ${n}${FAITHFUL.has(n) ? '  (marked FAITHFUL!)' : ''}`)
