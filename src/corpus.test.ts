import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseAmosFile } from './loader/amosfile'
import { parseSource, TokenTable } from './tokens/stream'
import { detokSource } from './tokens/detok'
import { CORE_TOKENS } from './tokens/tables.gen'
import { extensionTablesFor } from './ext/identify'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(amos|abk)$/i.test(name)) yield p
  }
}

/**
 * Whether a file carries one of the signatures `parseAmosFile` knows.
 *
 * The editor saves listings as plain ASCII as well as tokenised, and the
 * extension does not say which: GMS's `Source/AMOS/Moire.amos` is a listing,
 * and handing it to the parser reads a source length out of the banner text
 * and asks for 538MB. AMOS's own loader sniffs the signature first and so
 * does this — but the test then insists the skipped file really is text, so
 * that a truncated or damaged binary is still a failure and not a quiet
 * exclusion.
 */
const SIGNED = /^(AMOS (Basic|Pro)|AmSp|AmIc|AmBk|AmBs)/
const signature = (b: Uint8Array): string => String.fromCharCode(...b.subarray(0, 16))
/** latin-1 text, the same rule citations.test.ts uses: an Amiga listing's
 *  comment banners are drawn out of high-byte box characters */
const isText = (b: Uint8Array): boolean => {
  for (const c of b) if (c !== 9 && c !== 10 && c !== 13 && (c < 32 || (c > 126 && c < 160))) return false
  return true
}

describe.skipIf(!existsSync(fixtures))('fixture corpus', () => {
  it('parses every .AMOS and .Abk file, source and banks', () => {
    const table = new TokenTable(CORE_TOKENS)
    let files = 0
    let listings = 0
    for (const path of walk(fixtures)) {
      const bytes = readFileSync(path)
      if (!SIGNED.test(signature(bytes))) {
        expect(isText(bytes), `${path} has no AMOS signature and is not a listing`).toBe(true)
        listings++
        continue
      }
      files++
      const amos = parseAmosFile(bytes)
      expect(amos.diagnostics, path).toEqual([])
      if (amos.source.length > 0) parseSource(amos.source, table)
    }
    expect(files).toBeGreaterThan(400)
    // and the exclusion stays small enough to notice if the sniff goes wrong
    expect(listings).toBeLessThan(10)
  })

  it('detokenizes a known example faithfully', () => {
    const file = join(fixtures, 'official-amos', 'Examples', 'Examples', 'H-1', 'Help_19.AMOS')
    const amos = parseAmosFile(readFileSync(file))
    const table = new TokenTable(CORE_TOKENS)
    const lines = parseSource(amos.source, table)
    const listing = detokSource(lines, table, { extensions: extensionTablesFor(lines) })
    expect(listing).toContain('Screen Open 0,320,200,16,Lowres')
    expect(listing).toContain('For D=1 To 8')
    expect(listing).toContain('Set Curs L(1),L(2),L(3),L(4),L(5),L(6),L(7),L(8)')
  })
})
