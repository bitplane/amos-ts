/**
 * Every `L_ErrorExt` call site in every registered binary, with the registers
 * the caller sets up — and the slot each one proves.
 *
 * ## What this is for
 *
 * Extension call 1025 is how a library raises a message of its own, and the
 * account of it lives on `ExtensionImpl.errors` in ../runtime/extimpl.ts. This
 * is the evidence behind that account: run over the whole registry, the shape
 * is not a guess about one extension but a census of all of them.
 *
 * It exists because the ports disagreed. Four called `L_ErrorExt` a requester,
 * one called it "a REQUESTER, not a trappable AMOS error" — which is backwards
 * on both halves, since `d1 = 0` is precisely what makes an extension error
 * trappable — and one called `d3` "the index", which is `d0`. Every one of
 * those was written from a single extension's disassembly, where the shape is
 * ambiguous. Forty-nine of them at once are not.
 *
 * ## The slot column is the useful part
 *
 * `d2` is the extension number, zero-based, so a library that raises its own
 * errors STATES ITS OWN SLOT in the binary. That is independent of the manuals
 * and wiki lists most `defaultSlot` values come from — and for the eleven
 * releases whose manifest has no slot at all, it is the only evidence there is.
 * A disagreement here is a real finding; there are none today.
 *
 * That number is no longer only here. ../cli/genext.ts calls `sitesIn` below
 * and writes the answer into the registry as `statedSlot`, so it survives a
 * checkout with no `fixtures/` and can be read without running anything. The
 * manifests were deliberately NOT edited to fill in the eleven: `defaultSlot`
 * means "somebody recommended this" and copying binary evidence into it would
 * destroy the distinction the two fields exist to make.
 *
 * This tool stays because it is the wider net — it reports every call site and
 * its registers, walks any file in the corpus index rather than only the
 * registered fixtures, and answers the question `statedSlot` reduces to one
 * number.
 *
 * Usage:
 *   npm run cli -- src/cli/errscan.ts [--quiet]
 *
 * `--quiet` prints only the summary and any disagreement.
 */
import { readFileSync } from 'node:fs'
import { allExtensions } from '../ext/registry'

const CHECKSUMS = '../amos-files/index/checksums.sha256'
const ROOT = '../amos-files/'
const quiet = process.argv.includes('--quiet')

/** the six line-F escapes this tree has seen; `fe XX` then a routine number */
const ESCAPES: Record<number, string> = {
  0x01: 'Rjmp',
  0x21: 'Rbra',
  0x31: 'Rbsr',
  0x41: 'Rbeq',
  0x91: 'Rbge',
  0xe1: 'Rbmi',
}

export interface Site {
  id: string
  /** byte offset into the FILE, not the code hunk */
  at: number
  escape: string
  /** the moveq value found for each register, walking back 44 bytes */
  d0?: number
  d1?: number
  d2?: number
  d3?: number
  /** a `lea` into a0 precedes it, so a message table is being passed */
  table: boolean
}

let index: Map<string, string> | null = null
function pathFor(sha: string): string | undefined {
  if (index === null) {
    index = new Map()
    for (const line of readFileSync(CHECKSUMS, 'utf8').split('\n')) {
      const m = /^([0-9a-f]{64})\s+(.*)$/.exec(line)
      if (m && !index.has(m[1]!)) index.set(m[1]!, ROOT + m[2]!)
    }
  }
  return index.get(sha)
}

/**
 * Walk back from a call site over `moveq #imm,dN`, taking the NEAREST setting
 * of each register.
 *
 * Nearest and not first, because the skeleton's two halves sit next to each
 * other and EasyLife 1.09's are twelve bytes apart — reading forward from the
 * top of the routine would give the second site the first one's registers.
 * Forty-four bytes is the longest genuine preamble in the registry (five
 * moveqs and a `lea`), and stopping there is what keeps one site's setup out
 * of its neighbour's.
 */
export function sitesIn(id: string, d: Uint8Array): Site[] {
  const out: Site[] = []
  const be16 = (i: number): number => (d[i]! << 8) | d[i + 1]!
  for (let i = 0; i + 6 <= d.length; i += 2) {
    if (d[i] !== 0xfe) continue
    const escape = ESCAPES[d[i + 1]!]
    if (escape === undefined || be16(i + 4) !== 1025) continue
    const site: Site = { id, at: i, escape, table: false }
    for (let j = i - 2; j >= Math.max(0, i - 44); j -= 2) {
      const w = be16(j)
      if ((w & 0xf100) === 0x7000) {
        const reg = `d${(w >> 9) & 7}` as 'd0' | 'd1' | 'd2' | 'd3'
        if (reg in site === false || site[reg] === undefined) site[reg] = ((w & 0xff) << 24) >> 24
      }
      // lea (d16,pc),a0 and lea (abs).L,a0 — the two forms the skeleton uses
      if (w === 0x41fa || w === 0x41f9) site.table = true
    }
    out.push(site)
  }
  return out
}

function report(): void {
  const rows: Site[] = []
  const disagree: string[] = []
  const noSlot: string[] = []

  for (const ext of allExtensions()) {
    const file = pathFor(ext.sha256)
    if (file === undefined) continue
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(readFileSync(file))
    } catch {
      continue
    }
    const found = sitesIn(ext.id, bytes)
    if (found.length === 0) continue
    rows.push(...found)

    const stated = new Set(found.map((s) => s.d2).filter((v): v is number => v !== undefined))
    if (stated.size !== 1) {
      disagree.push(`${ext.id}: its own sites disagree about d2 — ${[...stated].join(', ')}`)
      continue
    }
    const slot = [...stated][0]! + 1
    if (ext.defaultSlot === undefined) noSlot.push(`${ext.id}: no manifest slot; d2 says ${slot}`)
    else if (ext.defaultSlot !== slot) {
      disagree.push(`${ext.id}: manifest says slot ${ext.defaultSlot}, d2 says ${slot}`)
    }

    if (quiet) continue
    console.log(`${ext.id}  slot ${ext.defaultSlot ?? '—'}${ext.defaultSlot === undefined ? ` (d2 says ${slot})` : ''}`)
    for (const s of found) {
      const regs = (['d0', 'd1', 'd2', 'd3'] as const).map((r) => `${r}=${s[r] ?? '?'}`.padEnd(6)).join(' ')
      console.log(`    +$${s.at.toString(16).padStart(5)} ${s.escape.padEnd(5)} ${regs} ${s.table ? 'a0=table' : ''}`)
    }
  }

  const ids = new Set(rows.map((r) => r.id))
  const pairs = [...ids].filter((id) => rows.filter((r) => r.id === id).length === 2)
  console.log(`\n${rows.length} call sites in ${ids.size} binaries; ${pairs.length} ship the skeleton's usual two`)
  // d1 undefined is not a violation: AMOS's own Voodoo 3D leaves d1 and d2 to
  // the CALLER and its `ErrCustomMsg` sets only a0 and d3, so the preamble walk
  // finds nothing. What would matter is a site setting d1 to something other
  // than zero, which would make that extension's error untrappable.
  const nonZeroD1 = rows.filter((r) => r.d1 !== undefined && r.d1 !== 0)
  console.log(`sites setting d1 to anything but 0: ${nonZeroD1.length}`)
  const nonZeroD3 = rows.filter((r) => r.d3 !== undefined && r.d3 !== 0 && r.d3 !== -1)
  console.log(`sites setting d3 to anything but 0 or -1: ${nonZeroD3.length}`)
  if (noSlot.length > 0) console.log(`\nslot known only from d2 (${noSlot.length}):\n  ${noSlot.join('\n  ')}`)
  console.log(disagree.length === 0 ? '\nno slot disagrees with d2' : `\nDISAGREE:\n  ${disagree.join('\n  ')}`)
}

if (process.argv[1]?.endsWith('errscan.ts')) report()
