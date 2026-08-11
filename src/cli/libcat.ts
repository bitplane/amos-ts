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

/**
 * `renumbered` is the fourth verdict and the one that took real data to find.
 *
 * A `variant` shares the match's TABLE: keywords sit at the same ids, because
 * an id is a byte offset and appending entries does not move the ones in front
 * of them. That is what a later release usually looks like, and it is why one
 * registry entry can cover several of them.
 *
 * `renumbered` shares the NAMES and not the ids — the table was rebuilt, so
 * every id a program recorded means something else now. IntuiExtend 1.6
 * against 2.01b is the case: 294 entries, and only 45 of them still at the id
 * 2.01b uses. Both have to be registered separately or a program tokenised
 * against one detokenises to nonsense under the other, which is exactly the
 * failure the `variant` label would hide.
 */
type Verdict = 'known' | 'variant' | 'renumbered' | 'new'

interface Row {
  lib: ScannedLib
  verdict: Verdict
  /** the registered extension this is, or is closest to */
  match?: string | undefined
  /** share of this table's entries the match has at the SAME id, 0..1 */
  overlap: number
  /** share of this table's names the match has anywhere in its table, 0..1 */
  nameOverlap: number
  /** keywords this table has that the match does not have at the same id */
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
const entrySet = (tokens: readonly { id: number; name: string }[]): Set<string> =>
  new Set(tokens.filter((t) => /[a-z]/i.test(t.name)).map((t) => `${t.id}:${t.name.trim().toLowerCase()}`))

const registered = [
  {
    id: 'AMOS Pro core (not an extension)',
    hash: tableHash(CORE_TOKENS),
    names: nameSet(CORE_TOKENS),
    entries: entrySet(CORE_TOKENS),
  },
  ...allExtensions().map((e) => ({
    id: e.id,
    hash: tableHash(e.tokens),
    names: nameSet(e.tokens),
    entries: entrySet(e.tokens),
  })),
]

const rows: Row[] = libs.map((lib) => {
  const hash = tableHash(lib.tokens)
  const exact = registered.find((r) => r.hash === hash)
  const { ver, banner } = identityStrings(lib.file)
  if (exact) {
    return { lib, verdict: 'known', match: exact.id, overlap: 1, nameOverlap: 1, extra: 0, ver, banner }
  }
  const mine = nameSet(lib.tokens)
  const mineEntries = entrySet(lib.tokens)
  /*
   * Scored on (id, name) pairs rather than on names alone, which is what this
   * used to do and what the new tables broke.
   *
   * THX 0.6 is six keywords, `thx play` through `thx end`, and DME 2.0 spells
   * all six. On names that is 100% and reads as a variant; on ids it is ZERO,
   * because they are different libraries by different authors that happen to
   * share a prefix. Meanwhile Dump 1.0 is two of Dump 1.1's eight and would
   * fail any symmetric score, but both of its entries sit at the ids 1.1 uses,
   * which is what actually makes it an earlier release of the same table.
   *
   * The name score is kept beside it, because the two disagreeing is itself
   * the signal — see `renumbered` on the Verdict type.
   */
  let best = { id: '', overlap: 0, nameOverlap: 0, extra: mineEntries.size, same: false }
  for (const r of registered) {
    if (r.entries.size === 0 || mineEntries.size === 0) continue
    let shared = 0
    for (const e of mineEntries) if (r.entries.has(e)) shared++
    const overlap = shared / mineEntries.size
    if (overlap <= best.overlap) continue
    let sharedNames = 0
    for (const n of mine) if (r.names.has(n)) sharedNames++
    best = {
      id: r.id,
      overlap,
      nameOverlap: mine.size ? sharedNames / mine.size : 0,
      extra: mineEntries.size - shared,
      // every entry at the same id under the same name, and no entry either
      // side lacks. The hash above cannot see this for an `amostools` stub,
      // because the scrub replaced the routine numbers the hash covers -- so
      // 87 tables that ARE ours would otherwise report as variants of
      // themselves at 100%
      same: overlap === 1 && r.entries.size === mineEntries.size,
    }
  }
  if (best.same) {
    return { lib, verdict: 'known', match: best.id, overlap: 1, nameOverlap: 1, extra: 0, ver, banner }
  }
  // when the ids do not agree, ask the names before calling it new: a rebuilt
  // table is a different table but not a different product
  let byName = { id: '', nameOverlap: 0 }
  for (const r of registered) {
    if (r.names.size === 0 || mine.size === 0) continue
    let shared = 0
    for (const n of mine) if (r.names.has(n)) shared++
    const nameOverlap = shared / mine.size
    if (nameOverlap > byName.nameOverlap) byName = { id: r.id, nameOverlap }
  }
  // half the entries in common is a low bar deliberately: a later release that
  // renamed its prefix (EasyLife's `znsx` -> `elznsx`) still shares plenty,
  // and calling that "new" would bury the interesting rows
  if (best.overlap >= 0.5) {
    return { lib, verdict: 'variant', match: best.id, overlap: best.overlap, nameOverlap: best.nameOverlap, extra: best.extra, ver, banner }
  }
  if (byName.nameOverlap >= 0.5) {
    return { lib, verdict: 'renumbered', match: byName.id, overlap: best.overlap, nameOverlap: byName.nameOverlap, extra: mineEntries.size, ver, banner }
  }
  return { lib, verdict: 'new', match: undefined, overlap: best.overlap, nameOverlap: byName.nameOverlap, extra: mineEntries.size, ver, banner }
})

rows.sort((a, b) => {
  const rank = { new: 0, renumbered: 1, variant: 2, known: 3 }
  return rank[a.verdict] - rank[b.verdict] || b.lib.named - a.lib.named
})

// ---- report ----------------------------------------------------------------

const pct = (x: number): string => `${Math.round(x * 100)}%`
const short = (p: string): string => p.replace(/^.*?\/files\//, '')

const counts = { new: 0, renumbered: 0, variant: 0, known: 0 }
for (const r of rows) counts[r.verdict]++

console.log(
  `${libs.length} distinct token table(s) from ${rows.reduce((n, r) => n + r.lib.copies.length, 0)} .Lib file(s)`,
)
console.log(
  `  new        ${counts.new}\n  renumbered ${counts.renumbered}\n  variant    ${counts.variant}\n  known      ${counts.known}`,
)
if (unreadable.length > 0) console.log(`  ${unreadable.length} .Lib file(s) parsed as neither layout`)
console.log('')

for (const r of rows) {
  if (!showAll && r.verdict === 'known') continue
  const tag =
    r.verdict === 'known'
      ? `= ${r.match}`
      : r.verdict === 'variant'
        ? `~ ${r.match} (${pct(r.overlap)} shared, ${r.extra} extra)`
        : r.verdict === 'renumbered'
          ? `# ${r.match} (${pct(r.nameOverlap)} of the names, ${pct(r.overlap)} of the ids)`
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
            : r.verdict === 'renumbered'
              ? `renumbered \`${r.match}\` (${pct(r.nameOverlap)} names, ${pct(r.overlap)} ids)`
              : '**new**'
      return `| ${r.lib.named} | ${r.lib.format} | ${v} | ${r.ver ?? ''} | \`${short(r.lib.file)}\` |`
    }),
  ]
  writeFileSync(mdOut, lines.join('\n') + '\n')
  console.log(`\nmarkdown written to ${mdOut}`)
}
