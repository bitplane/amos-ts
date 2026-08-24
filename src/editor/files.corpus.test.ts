/**
 * Every .AMOS program in the corpus, read by `Prg_Load` and written back by
 * `Prg_Save`.
 *
 * The container has no tokeniser in it, so this sweep is cheap enough to run
 * whole rather than sampled: 3,960 programs in a couple of seconds.
 *
 * What it proves is that the source and the banks come back byte for byte.
 * The header does not, and is not meant to. `Prg_Save` writes the constant it
 * was assembled with -- `lea H_Pro(pc),a0` -- so every version string in the
 * wild is rewritten to this editor's. That is 2,396 of the 3,960, and the
 * commonest by far is `AMOS Basic V1.3 ` becoming `AMOS Basic V134 `.
 */
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { corpusFile, corpusIndex, haveCorpus } from '../cli/corpus'
import { describeIf } from '../testing/fixture'
import { PRG, readProgramFile, writeProgramFile } from './files'

interface Result {
  read: number
  exact: number
  headerOnly: number
  /** anything past byte 15 that changed, which should be nothing */
  bodyDiffers: string[]
  /** the error code, for the files under a .AMOS name that are not programs */
  refused: Map<number, number>
  /** what the version strings turn into, most common first */
  headers: Map<string, number>
}

function sweep(): Result {
  const r: Result = {
    read: 0,
    exact: 0,
    headerOnly: 0,
    bodyDiffers: [],
    refused: new Map(),
    headers: new Map(),
  }
  const index = corpusIndex()
  for (const [sha, path] of index) {
    if (!/\.amos$/i.test(path)) continue
    const file = corpusFile(sha, index)
    if (file === null) continue
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(readFileSync(file))
    } catch {
      continue
    }
    const parsed = readProgramFile(bytes)
    if (parsed.error !== PRG.OK || parsed.file === null) {
      r.refused.set(parsed.error, (r.refused.get(parsed.error) ?? 0) + 1)
      continue
    }
    r.read++
    const out = writeProgramFile(parsed.file)
    const head = out.length >= 16 && out.subarray(0, 16).every((v, i) => v === bytes[i])
    const body = out.length === bytes.length && out.subarray(16).every((v, i) => v === bytes[i + 16])
    if (!body) {
      if (r.bodyDiffers.length < 20) r.bodyDiffers.push(`${file} ${bytes.length} -> ${out.length}`)
      continue
    }
    if (head) r.exact++
    else {
      r.headerOnly++
      const was = String.fromCharCode(...bytes.subarray(0, 16)).replace(/\0/g, '.')
      r.headers.set(was, (r.headers.get(was) ?? 0) + 1)
    }
  }
  return r
}

const result = haveCorpus() ? sweep() : null

describeIf('every corpus program, out and back', result !== null, () => {
  const r = result!

  it('read the whole index, so an empty sweep cannot pass for a clean one', () => {
    expect(r.read).toBeGreaterThan(3500)
  })

  it('reproduces the source and the banks byte for byte', () => {
    expect(r.bodyDiffers).toEqual([])
    expect(r.exact + r.headerOnly).toBe(r.read)
  })

  it('changes only the version string, and changes it on most of them', () => {
    // `AMOS Basic V1.3 `, `AMOS Basic V1.00`, `AMOS Pro111v` and nine others
    expect(r.headers.size).toBeGreaterThan(8)
    expect(r.headerOnly / r.read).toBeGreaterThan(0.5)
    expect(r.exact).toBeGreaterThan(1000)
  })

  it('refuses the files that are not programs, and says which way', () => {
    // ILBM pictures, hunk executables, an LHA archive and a plain text file,
    // all under a .AMOS name; and three that are cut short
    expect(r.refused.get(PRG.NOT_AMOS)).toBeGreaterThan(15)
    expect(r.refused.get(PRG.DISK)).toBeGreaterThan(0)
  })
})
