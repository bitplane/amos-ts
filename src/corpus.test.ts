import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseAmosFile } from './loader/amosfile'
import { parseSource, TokenTable } from './tokens/stream'
import { detokSource } from './tokens/detok'
import { CORE_TOKENS, EXTENSION_TOKENS } from './tokens/tables.gen'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(amos|abk)$/i.test(name)) yield p
  }
}

describe.skipIf(!existsSync(fixtures))('fixture corpus', () => {
  it('parses every .AMOS and .Abk file, source and banks', () => {
    const table = new TokenTable(CORE_TOKENS)
    let files = 0
    for (const path of walk(fixtures)) {
      files++
      const amos = parseAmosFile(readFileSync(path))
      expect(amos.diagnostics, path).toEqual([])
      if (amos.source.length > 0) parseSource(amos.source, table)
    }
    expect(files).toBeGreaterThan(400)
  })

  it('detokenizes a known example faithfully', () => {
    const file = join(fixtures, 'official-amos', 'Examples', 'Examples', 'H-1', 'Help_19.AMOS')
    const amos = parseAmosFile(readFileSync(file))
    const table = new TokenTable(CORE_TOKENS)
    const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)]))
    const listing = detokSource(parseSource(amos.source, table), table, { extensions })
    expect(listing).toContain('Screen Open 0,320,200,16,Lowres')
    expect(listing).toContain('For D=1 To 8')
    expect(listing).toContain('Set Curs L(1),L(2),L(3),L(4),L(5),L(6),L(7),L(8)')
  })
})
