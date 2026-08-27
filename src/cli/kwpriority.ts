/**
 * Rank the unaudited core keywords by how likely they are to hide a defect.
 *
 * The sweep costs a model call per keyword, so the order matters. Three bugs
 * have come out of it so far and all three were the same shape: the original
 * branches to an error routine on an argument the port accepts. `Break Off`,
 * `Double Buffer` and the six block keywords were each one `Rb*` in the
 * assembler with no `throw` opposite it. So the score is mostly that gap,
 * counted statically, with "never had a test" for rushed work behind it.
 *
 * It works. The first 92 keywords taken in this order came back 10% clean
 * against 48% for the unranked set, which is the whole point of the ranking.
 *
 * Run:  npx tsx src/cli/kwpriority.ts
 *       npx tsx src/cli/kwpriority.ts --min 10 --out audit/next.txt
 *
 * Writes the names one per line, which is what `kwaudit --list` reads. Never
 * pass keywords on the command line: two thirds of them are two words.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleFor, coreKeywords } from './auditctx'
import { NA, STRUCTURAL } from '../coverage/status'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
const flag = (n: string, d: string): string => {
  const i = argv.indexOf(n)
  return i >= 0 ? (argv[i + 1] ?? d) : d
}
const min = Number(flag('--min', '1'))
const out = flag('--out', join(ROOT, 'audit', 'priority.txt'))
const doneFile = flag('--done', join(ROOT, 'audit', 'core.jsonl'))

/** a keyword already answered is not worth paying for twice */
const done = new Set<string>()
try {
  for (const line of readFileSync(doneFile, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    const v = JSON.parse(line) as { keyword: string; verdict: string }
    if (v.verdict !== 'error') done.add(v.keyword)
  }
} catch {
  /* no audit yet, so everything is unaudited */
}

/** every way a keyword routine in +Lib.s reaches an error */
const ERR = /\b(?:L_FonCall|L_Syntax|L_GoError|L_OOfMem|L_EcWiErr|L_WiErr|L_BFonCall|L_WFonCall|L_IllScN|EcE\d+|WiE\d+)\b/g

interface Row {
  kw: string
  score: number
  why: string[]
}
const rows: Row[] = []
let skipped = 0

for (const t of coreKeywords()) {
  const kw = t.name.replace(/^!/, '').trim().toLowerCase()
  if (kw === '' || done.has(kw) || STRUCTURAL.has(kw) || NA.has(kw)) continue
  const b = bundleFor(kw)
  if (b === null || b.handler === null || b.classification === 'structural' || b.classification === 'n/a') {
    skipped++
    continue
  }
  const orig = b.original
    .map((o) => ('code' in o ? o.code : ''))
    .concat(b.alsoReads.map((r) => r.code))
    .join('\n')
  if (orig.trim() === '') {
    skipped++
    continue
  }
  const port = [b.handler.code, ...b.helpers.map((h) => h.code)].join('\n')
  const nonBlank = (s: string): number => s.split('\n').filter((l) => l.trim() !== '').length

  const errs = (orig.match(ERR) ?? []).length
  const throws = (port.match(/\bthrow\b/g) ?? []).length
  const origLines = nonBlank(orig)
  const portLines = nonBlank(port)
  const why: string[] = []
  let score = 0

  // the error gap, and the reason this ranking exists
  if (errs > throws) {
    score += 10 * Math.min(errs - throws, 4)
    why.push(`${errs} error branch${errs === 1 ? '' : 'es'} vs ${throws} throw${throws === 1 ? '' : 's'}`)
  }
  if (b.tests.length === 0) {
    score += 8
    why.push('no test')
  }
  // a long routine answered by a short handler dropped something
  if (origLines >= 20 && portLines * 3 < origLines) {
    score += 6
    why.push(`${origLines} asm lines vs ${portLines} port lines`)
  }
  // several forms is several routines, and the port usually implements one
  if (b.forms.length > 1) {
    score += 2 * (b.forms.length - 1)
    why.push(`${b.forms.length} forms`)
  }
  rows.push({ kw, score, why })
}

rows.sort((a, b) => b.score - a.score || a.kw.localeCompare(b.kw))
const take = rows.filter((r) => r.score >= min)

console.error(`${rows.length} unaudited and auditable, ${skipped} not auditable, ${done.size} already done`)
for (const [lo, hi] of [
  [30, Infinity],
  [20, 30],
  [10, 20],
  [1, 10],
  [0, 1],
] as const) {
  const c = rows.filter((r) => r.score >= lo && r.score < hi).length
  console.error(`  score ${lo === 30 ? '>=30' : `${lo}-${hi - 1}`}: ${c}`)
}
writeFileSync(out, take.map((r) => r.kw).join('\n') + '\n')
writeFileSync(out.replace(/\.txt$/, '') + '.tsv', rows.map((r) => `${r.score}\t${r.kw}\t${r.why.join('; ')}`).join('\n') + '\n')
console.error(`\n${take.length} at score >= ${min} -> ${out}`)
for (const r of take.slice(0, 20)) console.error(`  ${String(r.score).padStart(3)}  ${r.kw.padEnd(20)} ${r.why.join('; ')}`)
