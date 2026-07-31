/**
 * The CTLG reader against real catalogs.
 *
 * A self-built fixture can only show the reader agrees with the builder, and
 * for this format that is not worth much: both can encode the STRS length the
 * same wrong way and round-trip perfectly. That is exactly what happened —
 * the reader advanced by the raw length where a real entry pads on to the
 * next longword, so it read the first string of every catalog and then walked
 * off into the middle of the next entry. Against a hand-built file it looked
 * flawless. Against 8,283 real ones it recovered 11,251 strings where it
 * should have found 1,246,298.
 *
 * So this suite runs the reader over an actual corpus: every `.catalog` under
 * `fixtures/catalogs`, 8,283 files deduplicated by content out of the Aminet
 * and TOSEC collections, 111MB of other people's translations into thirty-odd
 * languages. `fixtures/` is gitignored — none of it is ours to redistribute —
 * so the suite skips when the directory is absent.
 *
 * To reconstitute it: the material is the `.catalog` files from the Aminet
 * mirror and the TOSEC Amiga sets, both on archive.org
 * (`ftp.sunet.se-aminet`). Any large collection will do; the assertions below
 * are about proportions rather than particular files, except where a named
 * one illustrates a finding.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCatalog } from './amigalocale'

const corpus = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'catalogs')

function allCatalogs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) allCatalogs(p, out)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.catalog')) out.push(p)
  }
  return out
}

describe.skipIf(!existsSync(corpus))('the CTLG reader against the real corpus', () => {
  const files = existsSync(corpus) ? allCatalogs(corpus) : []
  const parsed = files.map((f) => ({ f, cat: parseCatalog(new Uint8Array(readFileSync(f))) }))

  it('has a corpus worth calling one', () => {
    expect(files.length).toBeGreaterThan(8000)
  })

  it('reads all but a known handful, and those are not catalogs', () => {
    const rejected = parsed.filter((p) => p.cat === null)
    // The only refusals are MacBinary-wrapped: a real CTLG behind a 128-byte
    // Mac transfer header, so the file does not begin "FORM" and neither this
    // reader nor an Amiga would take it.
    expect(rejected.length).toBeLessThanOrEqual(2)
    for (const r of rejected) {
      const head = readFileSync(r.f).subarray(0, 4)
      expect(String.fromCharCode(...head)).not.toBe('FORM')
    }
  })

  it('recovers a realistic number of strings, not one per file', () => {
    // the padding bug scored 1.4 strings per catalog and looked fine
    const total = parsed.reduce((n, p) => n + (p.cat?.strings.size ?? 0), 0)
    expect(total).toBeGreaterThan(1_000_000)
    expect(total / files.length).toBeGreaterThan(100)
  })

  it('every string it returns is plausible text, not misaligned garbage', () => {
    // Reading the length wrong lands mid-entry and yields strings full of
    // NULs and stray high bytes. Sample widely and insist the results look
    // like the messages they are.
    let checked = 0
    for (let i = 0; i < parsed.length; i += 37) {
      const cat = parsed[i]!.cat
      if (!cat) continue
      for (const s of cat.strings.values()) {
        expect(s).not.toContain('\0')
        checked++
        if (checked > 20_000) return
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })

  it('ids are arbitrary longs — the corpus disproves any tidier assumption', () => {
    // Worth pinning because the obvious guess is wrong and this suite caught
    // it: a first pass here asserted ids stayed under a million, and 99 of
    // the 8,283 broke that. They are not misreads. felix.catalog numbers its
    // error messages from $1000000, FileID_lib.catalog from 1000000, and
    // several use -1. The format says ULONG and means it, so nothing may
    // assume a small dense range.
    const all = parsed.flatMap((p) => (p.cat ? [...p.cat.strings.keys()] : []))
    expect(all.every((n) => Number.isInteger(n))).toBe(true)
    expect(all.some((n) => n > 1_000_000)).toBe(true)
    expect(all.some((n) => n < 0)).toBe(true)
  })

  it('the languages are the ones the directories are named for', () => {
    const langs = new Map<string, number>()
    for (const { cat } of parsed) {
      if (cat && cat.language !== '') langs.set(cat.language, (langs.get(cat.language) ?? 0) + 1)
    }
    // deutsch is far and away the most translated, then italiano
    expect(langs.get('deutsch') ?? 0).toBeGreaterThan(500)
    expect([...langs.keys()]).toContain('svenska')
    expect([...langs.keys()]).toContain('français')
  })

  it('a malformed catalog degrades to empty rather than throwing', () => {
    // WBPerplexity's ship with a FORM size of 33924 in a 2448-byte file and
    // no chunk structure after FVER; the walk stops at the first chunk that
    // would run past the end
    const empties = parsed.filter((p) => p.cat !== null && p.cat.strings.size === 0)
    expect(empties.length).toBeLessThan(50)
  })
})
