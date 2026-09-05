/**
 * Which AmigaOS library functions does an extension actually call?
 *
 * The question this answers is the one that sizes an OS port: not "how big is
 * intuition.library" (74 functions in V34, 143 in AROS's V50 list) but "how
 * many of them does anything here reach". For EasyLife the answer is six.
 *
 * ## How a library base gets into a register
 *
 * AMOS keeps the bases of the libraries it opens in its own workspace, at
 * fixed negative offsets from a5 — `-$18a6` is IntuitionBase and `-$18ae`
 * GfxBase — and an extension is free to use them directly. EasyLife does:
 *
 *     movea.l -$18a6(a5),a6 / jsr -$d2(a6)          OpenWorkBench
 *
 * but that is not the only shape, and assuming it was is what made the first
 * version of this scan report zero for JD-Int. JD-Int copies the bases into
 * its OWN data block at init (routine 0, $376-$39e): the block is registered
 * at `$208(a5)`, IntuitionBase is stashed at block+$14 and GfxBase at
 * block+$18, so every later call is two steps —
 *
 *     movea.l $208(a5),a3 / movea.l $14(a3),a6 / jsr -$d2(a6)
 *
 * Both are handled. The scan groups by the CHAIN that loaded the register
 * (`a5-6310`, or `a5+520>+20`), which identifies the library without anyone
 * having to say in advance which library it is — the slot is the identity.
 *
 * ## What it cannot see
 *
 * A base held in a register across a call boundary, or computed. Nothing in
 * the extensions scanned so far does that, and a call whose base cannot be
 * traced is reported under `?` rather than dropped, so the total is honest.
 *
 * An extension that ships no binary reports nothing, and that is the right
 * answer rather than a failure: `intuition-1.3b` is the whole of #71 and it
 * ships only `itokens.s`, a token table with the routines named as `L_`
 * labels and defined nowhere.
 *
 * Run: npm run cli -- src/cli/oscalls.ts <extension-id>... [--fd DIR]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { firstCodeHunk } from '../amiga/hunk'
import { libraryForChain, scanOsCalls } from '../ext/oscalls'
import { REGISTRY, extensionById } from '../ext/registry'

/** `intuition_lib.fd` and friends: one function per line, LVO -30 downwards */
function fdNames(dir: string): Record<string, Record<number, string>> {
  const out: Record<string, Record<number, string>> = {}
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    const m = /^(.+)_lib\.fd$/i.exec(f)
    if (!m) continue
    const names: Record<number, string> = {}
    let lvo = -30
    for (const line of readFileSync(join(dir, f), 'latin1').split('\n')) {
      // `##bias` may move the first LVO; every FD here uses the default 30
      const b = /^##bias\s+(\d+)/.exec(line)
      if (b) lvo = -Number(b[1])
      const fn = /^([A-Za-z_][A-Za-z0-9_]*)\(/.exec(line)
      if (fn) {
        names[lvo] = fn[1]!
        lvo -= 6
      }
    }
    out[`${m[1]!.toLowerCase()}.library`] = names
  }
  return out
}

const libFiles = (dir: string): string[] => {
  const out: string[] = []
  const walk = (d: string): void => {
    if (!existsSync(d)) return
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.lib$/i.test(n)) out.push(p)
    }
  }
  walk(dir)
  return out
}


const args = process.argv.slice(2)
const fdAt = args.indexOf('--fd')
const fdDir = fdAt >= 0 ? args[fdAt + 1]! : 'fixtures/amigaos/FD1.3'
const ids = args.filter((a, i) => !a.startsWith('--') && !(fdAt >= 0 && i === fdAt + 1))
if (ids.length === 0) {
  console.error('usage: oscalls <extension-id>... [--fd DIR]')
  console.error(`known: ${REGISTRY.map((e) => e.id).join(', ')}`)
  process.exit(1)
}

const NAMES = fdNames(fdDir)

for (const id of ids) {
  if (!extensionById(id)) {
    console.error(`unknown extension: ${id}`)
    process.exit(1)
  }
  const files = libFiles(join('fixtures/extensions', id))
  if (files.length === 0) {
    console.log(`\n${id}: no .Lib in the fixture — nothing to scan`)
    continue
  }
  const groups = new Map<string, Map<number, number>>()
  for (const p of files) {
    let code: Uint8Array
    try {
      code = firstCodeHunk(readFileSync(p))
    } catch {
      continue
    }
    for (const c of scanOsCalls(code)) {
      if (!groups.has(c.chain)) groups.set(c.chain, new Map())
      const g = groups.get(c.chain)!
      g.set(c.lvo, (g.get(c.lvo) ?? 0) + 1)
    }
  }
  console.log(`\n${id}`)
  for (const [chain, g] of [...groups].sort((a, b) => b[1].size - a[1].size)) {
    const lib = libraryForChain(chain)
    console.log(`  ${chain}${lib ? `  = ${lib}` : ''}  — ${g.size} distinct LVOs`)
    for (const lvo of [...g.keys()].sort((a, b) => b - a)) {
      const nm = lib ? (NAMES[lib]?.[lvo] ?? '') : ''
      console.log(`      ${String(lvo).padStart(5)}  ${nm.padEnd(20)} x${g.get(lvo)}`)
    }
  }
}
