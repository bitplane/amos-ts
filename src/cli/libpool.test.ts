import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { libAsExtension, scanLibraries } from './libpool'
import { identifySlot, type SlotUsage } from '../ext/identify'

const ch = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))

/**
 * A minimal legacy extension library: an Amiga hunk executable whose first
 * code hunk starts with the jump-table size, then the token table 10 bytes
 * past 8+jumpSize (parseAmosLibOld, verified against Ldos/TURBO/GUI).
 */
function fakeLegacyLib(keywords: [name: string, spec: string][]): Uint8Array {
  const table: number[] = [0, 1, 0, 2, 0x80, 0xff] // null entry
  for (const [name, spec] of keywords) {
    const n = ch(name)
    n[n.length - 1]! |= 0x80
    const entry = [0, 3, 0, 4, ...n, ...ch(spec), 0xff]
    if (entry.length % 2 !== 0) entry.push(0)
    table.push(...entry)
  }
  table.push(0, 0) // terminator
  const jumpSize = 4
  const code = [0, 0, 0, jumpSize, 0, 0, 0, 0, ...new Array(jumpSize).fill(0), ...new Array(10).fill(0), ...table]
  while (code.length % 4 !== 0) code.push(0)
  const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
  return Uint8Array.from([
    ...u32(0x3f3), // HUNK_HEADER
    ...u32(0), // no resident library names
    ...u32(1), // one hunk
    ...u32(0),
    ...u32(0), // first, last
    ...u32(code.length / 4), // size table
    ...u32(0x3e9), // HUNK_CODE
    ...u32(code.length / 4),
    ...code,
  ])
}

function tree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'libscan-'))
  mkdirSync(join(dir, 'sub'), { recursive: true })
  return dir
}

describe('scanLibraries', () => {
  it('reads a legacy extension table and keeps one entry per distinct table', () => {
    const dir = tree()
    const lib = fakeLegacyLib([
      ['map do', 'I0'],
      ['map bank', 'I0'],
    ])
    writeFileSync(join(dir, 'Tome.Lib'), lib)
    writeFileSync(join(dir, 'sub', 'TOME.LIB'), lib) // same table, second copy
    writeFileSync(join(dir, 'other.txt'), lib) // not a .Lib — ignored

    const { libs, unreadable } = scanLibraries([dir])
    expect(unreadable).toEqual([])
    expect(libs).toHaveLength(1)
    expect(libs[0]!.format).toBe('legacy')
    expect(libs[0]!.copies).toHaveLength(2)
    expect(libs[0]!.tokens.map((t) => t.name)).toEqual(['', 'map do', 'map bank'])
    expect(libs[0]!.named).toBe(2)
  })

  it('reports .Lib files neither layout can read', () => {
    const dir = tree()
    writeFileSync(join(dir, 'W.Lib'), Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))
    const { libs, unreadable } = scanLibraries([dir])
    expect(libs).toEqual([])
    expect(unreadable).toHaveLength(1)
  })

  it('identifies a slot from a library found beside the programs', () => {
    // the whole point of --libs: a collection carrying both halves resolves
    // its own slot numbers, since a token id is an offset into one table
    const dir = tree()
    writeFileSync(join(dir, 'Tome.Lib'), fakeLegacyLib([['map do', 'I0'], ['map bank', 'I0']]))
    const { libs } = scanLibraries([dir])
    const ids = libs[0]!.tokens.filter((t) => t.name !== '').map((t) => t.id)
    const usage: SlotUsage = { slot: 12, uses: new Map(ids.map((i) => [i, new Set([1])])), count: 2 }

    // against the registry alone nothing explains it; with the library, it does
    expect(identifySlot(usage).best).toBeUndefined()
    const found = identifySlot(usage, libs.map(libAsExtension))
    expect(found.confidence).toBe('exact')
    expect(found.best!.name).toBe('Tome.Lib')
    expect(found.unresolvedIds).toEqual([])
  })

  it('marks a scanned candidate as unregistered, and its evidence as the binary it was read from', () => {
    // a matching table says which table the slot held — not the extension's
    // name, version, licence or behaviour, and the id base is only assumed.
    // The tier is the one thing a scan DOES establish: the input is a .Lib,
    // so the binary is in hand and `disassembly` is what the registry rule
    // requires. It read `table` once, which is the one tier a library
    // scanner can never be entitled to.
    const dir = tree()
    writeFileSync(join(dir, 'Mystery.Lib'), fakeLegacyLib([['zap', 'I0']]))
    const ext = libAsExtension(scanLibraries([dir]).libs[0]!)
    expect(ext.evidence).toBe('disassembly')
    expect(ext.idBaseEvidence).toBe('assumed')
    expect(ext.observedSlots).toEqual([])
    expect(ext.provenance).toMatch(/^scanned from /)
    expect(ext.notes).toMatch(/not a registry entry/)
  })
})
