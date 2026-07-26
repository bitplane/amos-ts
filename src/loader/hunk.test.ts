import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HUNK_CODE, HUNK_DATA, HUNK_END, HUNK_HEADER, HUNK_RELOC32, hunkAt, loadHunks, readPtr } from './hunk'

/** build a hunk file from a list of longs, for the synthetic cases */
function file(longs: number[]): Uint8Array {
  const b = new Uint8Array(longs.length * 4)
  const v = new DataView(b.buffer)
  longs.forEach((n, i) => v.setUint32(i * 4, n >>> 0, false))
  return b
}

describe('AmigaDOS hunk loading (RKRM "AmigaDOS Object File Format")', () => {
  // two hunks: code holding one pointer into data, then the data itself
  const twoHunks = file([
    HUNK_HEADER,
    0, // no resident library names
    2, // table size
    0, // first hunk
    1, // last hunk
    2, // hunk 0: two longs
    2, // hunk 1: two longs
    HUNK_CODE,
    2,
    0x0000_0004, // the pointer to relocate: data hunk + 4
    0xdead_beef,
    HUNK_RELOC32,
    1, // one entry...
    1, // ...into hunk 1
    0, // at offset 0 of hunk 0
    0, // end of the relocation list
    HUNK_END,
    HUNK_DATA,
    2,
    0x1111_1111,
    0x2222_2222,
    HUNK_END,
  ])

  it('places the hunks in order and applies RELOC32', () => {
    const l = loadHunks(twoHunks, 0x0021_0000)
    expect(l.hunks.map((h) => [h.kind, h.base, h.length])).toEqual([
      ['code', 0x0021_0000, 8],
      ['data', 0x0021_0008, 8],
    ])
    // the stored 4 became "hunk 1's base plus 4"
    expect(readPtr(l, 0x0021_0000)).toBe(0x0021_000c)
    // and the long beside it was left alone
    expect(readPtr(l, 0x0021_0004)).toBe(0xdead_beef)
  })

  it('rebases when asked, so relocated pointers follow', () => {
    const l = loadHunks(twoHunks, 0x0100_0000)
    expect(readPtr(l, 0x0100_0000)).toBe(0x0100_000c)
  })

  it('gives BSS hunks their length without any content', () => {
    const withBss = file([HUNK_HEADER, 0, 1, 0, 0, 4, 0x3eb, 4, HUNK_END])
    const l = loadHunks(withBss)
    expect(l.hunks[0]!.kind).toBe('bss')
    expect(l.hunks[0]!.length).toBe(16)
    expect(readPtr(l, l.base)).toBe(0)
  })

  it('locates the hunk an address falls in', () => {
    const l = loadHunks(twoHunks, 0x0021_0000)
    expect(hunkAt(l, 0x0021_0009)?.index).toBe(1)
    expect(hunkAt(l, 0x0021_ffff)).toBeNull()
  })

  it('refuses something that is not a hunk file', () => {
    expect(() => loadHunks(file([0x1234_5678]))).toThrow(/not an Amiga hunk file/)
  })
})

// AMOS 3D's engine is the reason this loader exists; fixtures/ is gitignored,
// so this only runs where the library is present.
const c3d = 'fixtures/extensions/amos3d-1.0/engine/c3d.lib'
describe.skipIf(!existsSync(c3d))('AMOS 3D engine (c3d.lib)', () => {
  it('relocates all 29 hunks and exposes the jump table at hunk0+$d0', () => {
    const l = loadHunks(new Uint8Array(readFileSync(c3d)))
    expect(l.hunks.length).toBe(29)
    expect(l.hunks[0]!.kind).toBe('code')
    // The engine's init (hunk0+2) ends `lea $d0(pc),a0 : movea.l a4,a1 : rts`,
    // handing the stub's dispatcher a table of 32-bit function pointers. Each
    // filled entry must land inside the image, which is only true once the
    // relocations have been applied — before that they are small offsets. The
    // table has gaps (d1=112 is zero), so a null slot is not a failure, and
    // it ends soon after the highest d1 any trampoline uses.
    let filled = 0
    for (let d1 = 0; d1 <= 0x80; d1 += 4) {
      const p = readPtr(l, l.base + 0xd0 + d1)
      if (p === 0) continue
      filled++
      expect(hunkAt(l, p), `entry at d1=${d1} points outside the image`).not.toBeNull()
    }
    expect(filled).toBeGreaterThan(25)
    // Td Move is d1=40 and Td Load d1=20 (read off their trampolines in
    // 3d.lib); both must resolve into code, and to different routines.
    const move = readPtr(l, l.base + 0xd0 + 40)
    const load = readPtr(l, l.base + 0xd0 + 20)
    expect(hunkAt(l, move)!.kind).toBe('code')
    expect(move).not.toBe(load)
  })
})
