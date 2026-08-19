/**
 * The library index is fed to a page that has no way to complain.
 *
 * Browse fetches `index.json` and renders whatever it holds; a group that
 * silently lost its items, or a disk set whose boot disk ended up second,
 * looks like a working site with the wrong content on it. So the walk is
 * exercised against a tree built here, disks and all.
 *
 * The disks are synthesised rather than fixtured. An ADF is 901,120 bytes and
 * `fixtures/` is gitignored, so a test that needed a real image would skip on
 * CI, which is the same colour as passing. Three blocks of a real one is
 * enough: "DOS\0" at zero, and a root block at 880 with a BCPL name in it,
 * which is exactly what ../amiga/adf.ts reads the label out of.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { indexLibrary } from './genlibrary'

const BSIZE = 512
const ROOT = 880

/** a DD floppy image with a root block, and boot code only if asked for */
function makeAdf(label: string, bootable: boolean): Uint8Array {
  const b = new Uint8Array(901_120)
  b.set([0x44, 0x4f, 0x53, 0x00]) // "DOS\0", OFS
  if (bootable) b[12] = 0x43 // any nonzero byte in the boot block is code
  const root = ROOT * BSIZE
  new DataView(b.buffer).setUint32(root + 0, 2) // T_HEADER
  new DataView(b.buffer).setInt32(root + 508, 1) // ST_ROOT
  b[root + 432] = label.length // BCPL: length byte, then the characters
  for (let i = 0; i < label.length; i++) b[root + 433 + i] = label.charCodeAt(i)
  return b
}

let root = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'amoslib-'))
  mkdirSync(join(root, 'Games'))
  mkdirSync(join(root, 'Games', 'Two Disker'))
  mkdirSync(join(root, 'Empty'))
  writeFileSync(join(root, 'README.md'), '# not a group\n')
  writeFileSync(join(root, 'Games.png'), 'png')
  writeFileSync(join(root, 'Games', 'Solo.adf'), makeAdf('SoloDisk', true))
  writeFileSync(join(root, 'Games', 'Solo.png'), 'png')
  // deliberately NOT in insertion order on disk: b sorts first and is the
  // one that boots, so the default order has to reorder them
  writeFileSync(join(root, 'Games', 'Two Disker', 'a-data.adf'), makeAdf('Data', false))
  writeFileSync(join(root, 'Games', 'Two Disker', 'b-boot.adf'), makeAdf('Boot', true))
  writeFileSync(join(root, 'Games', 'Two Disker.png'), 'png')
  // an item with no image and a broken disk, which must not stop the walk
  writeFileSync(join(root, 'Games', 'Truncated.adf'), new Uint8Array(1024))
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('indexLibrary', () => {
  it('makes a group of each root drawer and an item of each archive in it', () => {
    const { library } = indexLibrary(root)
    expect(library.version).toBe(1)
    // Empty/ holds nothing, so it is not a group; README.md is not one either
    expect(library.groups.map((g) => g.name)).toEqual(['Games'])
    expect(library.groups[0]!.image).toBe('Games.png')
    expect(library.groups[0]!.items.map((i) => i.name)).toEqual(['Solo', 'Truncated', 'Two Disker'])
  })

  it('derives the id from the group and the item, not from the filename', () => {
    const { library } = indexLibrary(root)
    const item = library.groups[0]!.items.find((i) => i.name === 'Two Disker')!
    expect(item.id).toBe('games/two-disker')
    expect(item.group).toBe('Games')
    expect(item.image).toBe('Games/Two Disker.png')
  })

  it('reads the volume label off the root block', () => {
    const { library } = indexLibrary(root)
    const solo = library.groups[0]!.items.find((i) => i.name === 'Solo')!
    expect(solo.disks[0]!.label).toBe('SoloDisk')
    expect(solo.disks[0]!.filesystem).toBe('OFS')
    expect(solo.disks[0]!.size).toBe(901_120)
    // the card would show DF0: as this, so a wrong one is visible before
    // anybody clicks the item
    expect(solo.disks[0]!.path).toBe('Games/Solo.adf')
  })

  it('puts the bootable disk of a set first', () => {
    const { library } = indexLibrary(root)
    const item = library.groups[0]!.items.find((i) => i.name === 'Two Disker')!
    expect(item.disks.map((d) => d.label)).toEqual(['Boot', 'Data'])
  })

  it('records nothing that is not the filename or read off the disk', () => {
    // The library holds files and no metadata beside them. Every field of an
    // item is either its own name or something the indexer opened the image
    // to find out, so there is nothing here that can go stale against the
    // disks it describes.
    const { library } = indexLibrary(root)
    const item = library.groups[0]!.items.find((i) => i.id === 'games/two-disker')!
    expect(Object.keys(item).sort()).toEqual(['disks', 'group', 'id', 'image', 'name'])
    expect(Object.keys(item.disks[0]!).sort()).toEqual([
      'bootable',
      'filesystem',
      'label',
      'path',
      'programs',
      'size',
    ])
  })

  it('warns about a disk that is not an image, and indexes it anyway', () => {
    const { library, warnings } = indexLibrary(root)
    const item = library.groups[0]!.items.find((i) => i.name === 'Truncated')!
    expect(item.disks[0]!.label).toBeNull()
    expect(item.image).toBeNull()
    // A truncated download is the failure this catches: 7-Zip has produced
    // short files here twice while reporting success, and an 880K image is
    // told from a bad one by its exact byte count.
    expect(warnings.map((w) => w.message)).toContain('1024 bytes is not an Amiga disk image, truncated?')
  })

  it('counts the programs on a disk rather than listing them', () => {
    const { library } = indexLibrary(root)
    // an empty root block resolves to an empty directory, not to an error
    expect(library.groups[0]!.items.find((i) => i.name === 'Solo')!.disks[0]!.programs).toBe(0)
  })
})
