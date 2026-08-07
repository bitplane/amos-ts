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
import { REGISTRY, extensionById } from '../ext/registry'

/**
 * The a5 offsets AMOS keeps library bases at. Named where a ported keyword
 * has already pinned one against its own disassembly; the rest print raw,
 * because a guessed name is worse than a number.
 */
const A5_BASES: Record<number, string> = {
  // easylife.ts `elwb open`: `movea.l -$18a6(a5),a6 / jsr -$d2(a6)` is
  // OpenWorkBench, which is intuition.library's -210
  [-0x18a6]: 'intuition.library',
  // GfxBase, NOT DiskfontBase. easylife.ts `elopen font` builds a TextAttr
  // and calls `-$48` off this base, which is graphics OpenFont (-72), and
  // only on a miss does it OpenLibrary("diskfont.library") for OpenDiskFont
  // at that library's -30. JD-Int settles it beyond doubt: it calls
  // seventeen LVOs off this slot, down to -498, and diskfont.library has
  // FOUR functions. -240 and -246 are Move and Draw.
  [-0x18ae]: 'graphics.library',
  // Easylife.Library's SaveTree takes DOSBase from here ($2b8)
  [0x2b8]: 'dos.library',
}

/**
 * Chains an extension builds for itself. JD-Int's routine 0 ($376-$39e)
 * registers its data block at `$208(a5)` and copies the two bases it wants
 * into it — IntuitionBase from `-$18a6(a5)` to block+$14, GfxBase from
 * `-$18ae(a5)` to block+$18 — so every call site reaches them two steps out.
 */
const CHAIN_BASES: Record<string, string> = {
  'a5+520>+20': 'intuition.library',
  'a5+520>+24': 'graphics.library',
}

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

/**
 * `movea.l d16(aS),aD` is `0010 DDD 001 101 SSS` — 0x2068 | D<<9 | S.
 *
 * The top nibble matters and leaving it out is what made the first draft
 * useless: without it every opcode whose low nine bits happened to be $6D
 * read as a base load and wiped the register map, so the calls that were
 * really traceable came out as `?` and the ones that were not came out as
 * nothing at all.
 */
const moveaDest = (op: number, src: number): number =>
  (op & 0xf1ff) === (0x2068 | src) ? (op >> 9) & 7 : -1

interface Call {
  chain: string
  lvo: number
}

function scan(code: Uint8Array): Call[] {
  const dv = new DataView(code.buffer, code.byteOffset, code.byteLength)
  const calls: Call[] = []
  /** where each address register was last loaded from, as a printable chain */
  const from: Array<string | null> = [null, null, null, null, null, null, null, null]
  for (let i = 0; i + 2 <= code.length; i += 2) {
    const op = dv.getUint16(i)
    // movea.l $4.w,aD and movea.l $4.l,aD -- ExecBase, the one absolute
    // address on the machine. Both spellings ship: EasyLife writes the word
    // form, JD-Int the long one ($762: `movea.l $4.l,a6`).
    if ((op & 0xf1ff) === 0x2078 && i + 4 <= code.length && dv.getUint16(i + 2) === 4) {
      from[(op >> 9) & 7] = 'exec'
      i += 2
      continue
    }
    if ((op & 0xf1ff) === 0x2079 && i + 6 <= code.length && dv.getUint32(i + 2) === 4) {
      from[(op >> 9) & 7] = 'exec'
      i += 4
      continue
    }
    // lea d16(aS),aD -- JD-Int reaches its base slot by ADDRESS and then
    // dereferences, `lea $14(a3),a3 / movea.l (a3),a6`, so both halves have
    // to be followed or the whole extension reads as untraceable
    if ((op & 0xf1f8) === 0x41e8 && i + 4 <= code.length) {
      const s = op & 7
      const d = (op >> 9) & 7
      const off = dv.getInt16(i + 2)
      from[d] = from[s] === null ? null : `${from[s]}>${off >= 0 ? '+' : ''}${off}`
      i += 2
      continue
    }
    // movea.l (aS),aD -- the dereference that follows it
    if ((op & 0xf1f8) === 0x2050) {
      from[(op >> 9) & 7] = from[op & 7] ?? null
      continue
    }
    // movea.l d16(a5),aD -- a base straight out of AMOS's workspace
    const d5 = moveaDest(op, 5)
    if (d5 >= 0 && i + 4 <= code.length) {
      const slot = dv.getInt16(i + 2)
      from[d5] = `a5${slot >= 0 ? '+' : ''}${slot}`
      i += 2
      continue
    }
    // movea.l d16(aS),aD -- a second step off a block we already traced
    let stepped = false
    for (let s = 0; s < 8 && !stepped; s++) {
      const dD = moveaDest(op, s)
      if (dD < 0 || from[s] === null || i + 4 > code.length) continue
      const off = dv.getInt16(i + 2)
      from[dD] = `${from[s]}>${off >= 0 ? '+' : ''}${off}`
      i += 2
      stepped = true
    }
    if (stepped) continue
    // jsr d16(aN) with a NEGATIVE displacement -- a library call
    if ((op & 0xfff8) === 0x4ea8 && i + 4 <= code.length) {
      const reg = op & 7
      const d = dv.getInt16(i + 2)
      if (d < 0) calls.push({ chain: from[reg] ?? '?', lvo: d })
      i += 2
      continue
    }
    // anything that writes an address register we are not modelling
    if ((op & 0xf1c0) === 0x2040 || (op & 0xf1c0) === 0x2140) {
      const d = (op >> 9) & 7
      if ((op & 0x01c0) === 0x0040) from[d] = null
    }
  }
  return calls
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
    for (const c of scan(code)) {
      if (!groups.has(c.chain)) groups.set(c.chain, new Map())
      const g = groups.get(c.chain)!
      g.set(c.lvo, (g.get(c.lvo) ?? 0) + 1)
    }
  }
  console.log(`\n${id}`)
  for (const [chain, g] of [...groups].sort((a, b) => b[1].size - a[1].size)) {
    const slot = /^a5([+-]\d+)$/.exec(chain)
    const lib =
      chain === 'exec' ? 'exec.library' : (CHAIN_BASES[chain] ?? (slot ? A5_BASES[Number(slot[1])] : undefined))
    console.log(`  ${chain}${lib ? `  = ${lib}` : ''}  — ${g.size} distinct LVOs`)
    for (const lvo of [...g.keys()].sort((a, b) => b - a)) {
      const nm = lib ? (NAMES[lib]?.[lvo] ?? '') : ''
      console.log(`      ${String(lvo).padStart(5)}  ${nm.padEnd(20)} x${g.get(lvo)}`)
    }
  }
}
