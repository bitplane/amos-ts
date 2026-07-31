/**
 * Catalogue the extension libraries in a collection: what is here, what the
 * registry already knows, and what is new.
 *
 * ## Why this is separate from extscan
 *
 * `extscan.ts` asks what PROGRAMS used — it walks `.AMOS` files and works back
 * to the extension each slot must have held. That is the right question when
 * you have programs and want the libraries behind them, and its output is a
 * wanted list of token ids nothing explains.
 *
 * This asks the other half: given a pile of `.Lib` files, what ARE they? A
 * collection can carry a library no program in it uses (Aminet's BSDSocket
 * extension arrives with three demos and nothing else), and it can carry
 * fifteen copies of one library under different names. Neither shows up in a
 * program-side scan, and both matter when deciding what to register.
 *
 * ## What counts as the same library
 *
 * The TOKEN TABLE, hashed — `libpool.tableHash` over every entry's id, name,
 * spec and handler numbers. Not the file: the same table ships under different
 * filenames, with different datestamps, inside a dozen archives, and counting
 * those separately is how a collection appears to hold forty extensions when
 * it holds twelve.
 *
 * Against the registry the same hash decides `known`. A table that is not
 * identical but shares most of its keyword NAMES is a `variant` — a different
 * release of something registered, which is the common case and the one worth
 * flagging, because a new release is usually a handful of added keywords
 * rather than a new extension. Everything else is `new`.
 *
 * Usage:
 *   npm run cli -- src/cli/libcat.ts <dir>... [--md out.md] [--all]
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { scanLibraries, type ScannedLib } from './libpool'
import { allExtensions } from '../ext/registry'
import { CORE_TOKENS } from '../tokens/tables.gen'
import type { TokenEntry } from '../tokens/libtok'

const args = process.argv.slice(2)
const mdAt = args.indexOf('--md')
const mdOut = mdAt >= 0 ? args[mdAt + 1] : undefined
const showAll = args.includes('--all')
const consumed = new Set([mdAt + 1].filter((i) => i > 0))
const roots = args.filter((a, i) => !a.startsWith('--') && !consumed.has(i))
if (roots.length === 0) {
  console.error('usage: libcat <dir>... [--md out.md] [--all]')
  process.exit(1)
}

/** the same fingerprint libpool uses, so a scanned table and a registered one compare */
function tableHash(tokens: readonly TokenEntry[]): string {
  const h = createHash('sha256')
  for (const t of tokens) h.update(`${t.id}:${t.name}:${t.spec}:${t.instr}:${t.func}\n`)
  return h.digest('hex')
}

/** keyword names in a table, lowercased, without the `!` arity marker */
function nameSet(tokens: readonly TokenEntry[]): Set<string> {
  const out = new Set<string>()
  for (const t of tokens) {
    const n = t.name.replace(/^!/, '').trim().toLowerCase()
    if (n !== '') out.add(n)
  }
  return out
}

/**
 * The `$VER:` cookie, the string the Amiga `Version` command reads.
 *
 * Read from the FILE rather than the token table, because it is the only
 * self-description most of these carry and it is what a registry entry's
 * version field should be based on. Some libraries carry a copyright banner
 * instead, and a few carry both and disagree — LDos ships a $VER saying 2.5
 * beside a banner still claiming 1.0 — so both are reported and neither is
 * silently preferred here.
 */
function identityStrings(file: string): { ver?: string | undefined; banner?: string | undefined } {
  let bytes: Buffer
  try {
    bytes = readFileSync(file)
  } catch {
    return {}
  }
  const text = bytes.toString('latin1')
  const ver = /\$VER:?\s*([^\0\r\n]{1,60})/.exec(text)?.[1]?.trim()
  const banner = /((?:AMOSPro_)?[A-Za-z][\w .+-]{2,30}\s+[Vv]?\d+\.\d+[\w.]*)/.exec(text)?.[1]?.trim()
  return { ver, banner }
}

type Verdict = 'known' | 'variant' | 'new'

interface Row {
  lib: ScannedLib
  verdict: Verdict
  /** the registered extension this is, or is closest to */
  match?: string | undefined
  /** share of this table's names the match also has, 0..1 */
  overlap: number
  /** keywords this table has that the match does not */
  extra: number
  ver?: string | undefined
  banner?: string | undefined
}

// ---- scan ------------------------------------------------------------------

const { libs, unreadable } = scanLibraries(roots)

/**
 * Registry tables, by fingerprint and by name set, for the two comparisons —
 * plus the CORE table.
 *
 * The core belongs in the pool even though it is not an extension, because a
 * collection that ships an AMOS Pro install carries `AMOSPro.Lib` itself. Left
 * out, it is the largest "new extension" in the report at 615 keywords, which
 * is both wrong and the first thing anyone would chase.
 */
const registered = [
  { id: 'AMOS Pro core (not an extension)', hash: tableHash(CORE_TOKENS), names: nameSet(CORE_TOKENS) },
  ...allExtensions().map((e) => ({
    id: e.id,
    hash: tableHash(e.tokens),
    names: nameSet(e.tokens),
  })),
]

const rows: Row[] = libs.map((lib) => {
  const hash = tableHash(lib.tokens)
  const exact = registered.find((r) => r.hash === hash)
  const { ver, banner } = identityStrings(lib.file)
  if (exact) {
    return { lib, verdict: 'known', match: exact.id, overlap: 1, extra: 0, ver, banner }
  }
  const mine = nameSet(lib.tokens)
  let best = { id: '', overlap: 0, extra: mine.size }
  for (const r of registered) {
    if (r.names.size === 0 || mine.size === 0) continue
    let shared = 0
    for (const n of mine) if (r.names.has(n)) shared++
    const overlap = shared / mine.size
    if (overlap > best.overlap) best = { id: r.id, overlap, extra: mine.size - shared }
  }
  // half the names in common is a low bar deliberately: a later release that
  // renamed its prefix (EasyLife's `znsx` -> `elznsx`) still shares plenty,
  // and calling that "new" would bury the interesting rows
  const verdict: Verdict = best.overlap >= 0.5 ? 'variant' : 'new'
  return { lib, verdict, match: best.id || undefined, overlap: best.overlap, extra: best.extra, ver, banner }
})

rows.sort((a, b) => {
  const rank = { new: 0, variant: 1, known: 2 }
  return rank[a.verdict] - rank[b.verdict] || b.lib.named - a.lib.named
})

// ---- report ----------------------------------------------------------------

const pct = (x: number): string => `${Math.round(x * 100)}%`
const short = (p: string): string => p.replace(/^.*?\/files\//, '')

const counts = { new: 0, variant: 0, known: 0 }
for (const r of rows) counts[r.verdict]++

console.log(
  `${libs.length} distinct token table(s) from ${rows.reduce((n, r) => n + r.lib.copies.length, 0)} .Lib file(s)`,
)
console.log(`  new     ${counts.new}\n  variant ${counts.variant}\n  known   ${counts.known}`)
if (unreadable.length > 0) console.log(`  ${unreadable.length} .Lib file(s) parsed as neither layout`)
console.log('')

for (const r of rows) {
  if (!showAll && r.verdict === 'known') continue
  const tag =
    r.verdict === 'known'
      ? `= ${r.match}`
      : r.verdict === 'variant'
        ? `~ ${r.match} (${pct(r.overlap)} shared, ${r.extra} extra)`
        : 'NEW'
  console.log(`${String(r.lib.named).padStart(5)} kw  ${r.lib.format.padEnd(6)} ${tag}`)
  console.log(`           ${short(r.lib.file)}`)
  if (r.ver) console.log(`           $VER: ${r.ver}`)
  if (r.lib.copies.length > 1) console.log(`           ${r.lib.copies.length} copies`)
}
if (!showAll && counts.known > 0) console.log(`\n(${counts.known} already-registered table(s) hidden; --all to show)`)

if (mdOut !== undefined) {
  const lines = [
    '| keywords | format | verdict | `$VER` | path |',
    '|---|---|---|---|---|',
    ...rows.map((r) => {
      const v =
        r.verdict === 'known'
          ? `known — \`${r.match}\``
          : r.verdict === 'variant'
            ? `variant of \`${r.match}\` (${pct(r.overlap)}, +${r.extra})`
            : '**new**'
      return `| ${r.lib.named} | ${r.lib.format} | ${v} | ${r.ver ?? ''} | \`${short(r.lib.file)}\` |`
    }),
  ]
  writeFileSync(mdOut, lines.join('\n') + '\n')
  console.log(`\nmarkdown written to ${mdOut}`)
}
