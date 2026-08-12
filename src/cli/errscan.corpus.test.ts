/**
 * `L_ErrorExt`'s calling convention, held to the binaries that use it.
 *
 * The account lives on `ExtensionImpl.errors` in ../runtime/extimpl.ts and was
 * settled from AMOS's own sources: the interpreter (`+ILib.s`), the compiled
 * runtime (`_LIB.S`) and the Voodoo 3D extension's commented skeleton. This
 * suite is the other side of it — the claim measured against every registered
 * library that raises an error of its own.
 *
 * It earns its place because the ports got this wrong five separate times, and
 * every one of those readings was made from ONE disassembly, where the shape
 * genuinely is ambiguous: with a table of one message you cannot tell d0 the
 * index from d3 the print flag, and with `d1 = 0` at every site you cannot see
 * that d1 is a threshold rather than a boolean. Forty-nine libraries at once
 * settle all of it.
 *
 * The scan reads the corpus at `../amos-files`, which is not part of this
 * repository, so the suite skips when it is absent.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sitesIn } from './errscan'
import { allExtensions } from '../ext/registry'

const CHECKSUMS = '../amos-files/index/checksums.sha256'
const have = existsSync(CHECKSUMS)

interface Scanned {
  id: string
  slot: number | undefined
  sites: ReturnType<typeof sitesIn>
}

function scan(): Scanned[] {
  const index = new Map<string, string>()
  for (const line of readFileSync(CHECKSUMS, 'utf8').split('\n')) {
    const m = /^([0-9a-f]{64})\s+(.*)$/.exec(line)
    if (m && !index.has(m[1]!)) index.set(m[1]!, `../amos-files/${m[2]!}`)
  }
  const out: Scanned[] = []
  for (const ext of allExtensions()) {
    const file = index.get(ext.sha256)
    if (file === undefined || !existsSync(file)) continue
    const sites = sitesIn(ext.id, new Uint8Array(readFileSync(file)))
    if (sites.length > 0) out.push({ id: ext.id, slot: ext.defaultSlot, sites })
  }
  return out
}

describe.skipIf(!have)('L_ErrorExt across every registered binary', () => {
  const all = scan()
  const sites = all.flatMap((e) => e.sites)

  it('is scanning a real census and not two files', () => {
    expect(all.length).toBeGreaterThan(40)
    expect(sites.length).toBeGreaterThan(80)
  })

  /**
   * d1 is a THRESHOLD — `cmp.w d1,d0 / bcs rErr1` at +ILib.s:1297 — and every
   * extension passes 0, so nothing of theirs is below it and all of it can be
   * trapped. GameSupport's shipped source comments that exact instruction
   * `* Can be trapped`. A site passing anything else would be an extension
   * deliberately making an error fatal, as AMOS does to itself with `#512`.
   */
  it('no extension makes its own errors untrappable', () => {
    const bad = sites.filter((s) => s.d1 !== undefined && s.d1 !== 0)
    expect(bad.map((s) => `${s.id} +$${s.at.toString(16)} d1=${s.d1}`)).toEqual([])
  })

  /** d3 selects print (0) or no-print (-1); the compiled runtime only tests it against zero */
  it('d3 is only ever 0 or -1', () => {
    const bad = sites.filter((s) => s.d3 !== undefined && s.d3 !== 0 && s.d3 !== -1)
    expect(bad.map((s) => `${s.id} +$${s.at.toString(16)} d3=${s.d3}`)).toEqual([])
  })

  /**
   * The slot, from the binary rather than from a manual.
   *
   * d2 is the extension number zero-based, so a library that raises its own
   * errors states its own slot. Most `defaultSlot` values come from Andrew
   * Burton's extensions list or an install note; this is independent of both,
   * and all 34 that have a manifest slot agree with it.
   */
  it('d2 + 1 is the slot the manifest records, wherever it records one', () => {
    const bad: string[] = []
    for (const e of all) {
      const stated = new Set(e.sites.map((s) => s.d2).filter((v): v is number => v !== undefined))
      if (stated.size > 1) bad.push(`${e.id}: sites disagree — d2 = ${[...stated].join(', ')}`)
      const only = [...stated][0]
      if (only === undefined || e.slot === undefined) continue
      if (only + 1 !== e.slot) bad.push(`${e.id}: manifest slot ${e.slot}, d2 says ${only + 1}`)
    }
    expect(bad).toEqual([])
  })

  /**
   * The skeleton ships a PAIR — print and no-print — and most libraries have
   * both untouched. The six that do not are listed because each is a fact
   * about that library rather than about the convention: five can show no
   * message of their own at all, and Jotre has nothing for a program compiled
   * with `-E0` to call.
   */
  it('the exceptions to the two-site shape are the six known ones', () => {
    const odd = all.filter((e) => e.sites.length !== 2).map((e) => e.id)
    expect(odd.sort()).toEqual([
      'ctext-1.0',
      'intuiextend-2.01b',
      'jotre-1.0',
      'range-1.0',
      'tome-3.1',
      'tome-4.23',
    ])
  })
})
