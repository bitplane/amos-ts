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
import { allItems, indexLibrary, type LibraryFolder } from './genlibrary'
import { itemPath } from '../web/route'

/** the folder at a slash-separated path of directory names, for the assertions */
function at(root: LibraryFolder, path: string): LibraryFolder {
  let f = root
  for (const seg of path.split('/').filter((s) => s !== '')) {
    const next = f.folders.find((c) => c.name === seg)
    if (!next) throw new Error(`no folder ${path}; ${f.name || 'root'} has ${f.folders.map((c) => c.name)}`)
    f = next
  }
  return f
}

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
  // three levels down, which the old two-level walk could not reach at all
  mkdirSync(join(root, 'Games', 'Shooters'), { recursive: true })
  mkdirSync(join(root, 'Games', 'Shooters', 'Deep Set'))
  mkdirSync(join(root, 'Empty'))
  writeFileSync(join(root, 'README.md'), '# not a folder\n')
  writeFileSync(join(root, 'Games.png'), 'png')
  writeFileSync(join(root, 'Games', 'Solo.adf'), makeAdf('SoloDisk', true))
  writeFileSync(join(root, 'Games', 'Solo.png'), 'png')
  writeFileSync(join(root, 'Games', 'Shooters', 'Blaster.adf'), makeAdf('Blaster', true))
  writeFileSync(join(root, 'Games', 'Shooters', 'Deep Set', 'one.adf'), makeAdf('DeepOne', true))
  // deliberately NOT in insertion order on disk: b sorts first and is the
  // one that boots, so the default order has to reorder them
  writeFileSync(join(root, 'Games', 'Two Disker', 'a-data.adf'), makeAdf('Data', false))
  writeFileSync(join(root, 'Games', 'Two Disker', 'b-boot.adf'), makeAdf('Boot', true))
  writeFileSync(join(root, 'Games', 'Two Disker.png'), 'png')
  // an item with no image and a broken disk, which must not stop the walk
  writeFileSync(join(root, 'Games', 'Truncated.adf'), new Uint8Array(1024))
  // the two names a link has to spell right: an underscore, which survives,
  // and an apostrophe, which does not
  writeFileSync(join(root, 'Games', 'AMOSPro_System.adf'), makeAdf('AMOSPro_System', true))
  writeFileSync(join(root, 'Games', "Draw 'n' draw.adf"), makeAdf('Draw', true))
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('indexLibrary', () => {
  it('makes a folder of every drawer and an item of every archive', () => {
    const { library } = indexLibrary(root)
    // Empty/ holds nothing, so it is pruned; README.md is not a folder either
    expect(library.root.folders.map((f) => f.name)).toEqual(['Games'])
    expect(at(library.root, 'Games').image).toBe('Games.png')
    // Solo boots, so it sorts before the one that does not
    expect(at(library.root, 'Games').items.map((i) => i.name)).toEqual([
      'AMOSPro_System',
      "Draw 'n' draw",
      'Solo',
      'Truncated',
    ])
    expect(at(library.root, 'Games').folders.map((f) => f.name)).toEqual(['Shooters', 'Two Disker'])
  })

  it('nests as deep as the library does', () => {
    // Every drawer is a folder and every archive in it is an item. No rule
    // anywhere looks at what a drawer holds to decide which it is, which is
    // what lets six AMOS Professional disks and a drawer of twenty-eight
    // extensions go through the same walk.
    const { library } = indexLibrary(root)
    const shooters = at(library.root, 'Games/Shooters')
    expect(shooters.items.map((i) => i.name)).toEqual(['Blaster'])
    expect(at(library.root, 'Games/Shooters/Deep Set').items.map((i) => i.name)).toEqual(['one'])
    expect(
      allItems(library.root)
        .map((i) => i.id)
        .sort(),
    ).toEqual([
      'games/amospro_system',
      'games/draw-n-draw',
      'games/shooters/blaster',
      'games/shooters/deep-set/one',
      'games/solo',
      'games/truncated',
      'games/two-disker/a-data',
      'games/two-disker/b-boot',
    ])
  })

  it('spells an id the way ../web/route.ts writes a link', () => {
    /*
     * The id and the page's link are the same string produced twice, and the
     * page matches an incoming link loosely enough that a stale id would go
     * unnoticed here and land on the right disk anyway. What would show is
     * the link the page HANDS BACK, so the rule is asserted at both ends.
     *
     * The underscore is the case that matters. It is in the name of every
     * AMOS Professional disk and is legal in a URL as it stands, so dropping
     * it would put `%20`-free but wrong spellings in front of every reader.
     */
    const { library } = indexLibrary(root)
    const ids = new Map(allItems(library.root).map((i) => [i.name, i.id]))
    expect(ids.get('AMOSPro_System')).toBe('games/amospro_system')
    expect(ids.get("Draw 'n' draw")).toBe('games/draw-n-draw')
    for (const item of allItems(library.root)) {
      expect(item.id).toBe(itemPath(item).join('/'))
    }
  })

  it('derives the id from the whole path, not from the filename alone', () => {
    const { library } = indexLibrary(root)
    const item = at(library.root, 'Games/Two Disker').items.find((i) => i.name === 'b-boot')!
    expect(item.id).toBe('games/two-disker/b-boot')
    // no b-boot.png, so it wears the drawer's own picture
    expect(item.image).toBe('Games/Two Disker.png')
  })

  it('falls back to the nearest picture above an item that has none', () => {
    // Blaster.adf has no Blaster.png, so it wears Games.png rather than a
    // placeholder. A picture dropped at the top covers everything under it.
    const { library } = indexLibrary(root)
    const shooters = at(library.root, 'Games/Shooters')
    expect(shooters.image).toBe('Games.png')
    expect(shooters.items.map((i) => i.image)).toEqual(['Games.png'])
    // and it keeps going down: Deep Set has none either
    expect(at(library.root, 'Games/Shooters/Deep Set').items[0]!.image).toBe('Games.png')
  })

  it('reads the volume label off the root block', () => {
    const { library } = indexLibrary(root)
    const solo = at(library.root, 'Games').items.find((i) => i.name === 'Solo')!
    expect(solo.disk.label).toBe('SoloDisk')
    expect(solo.disk.filesystem).toBe('OFS')
    expect(solo.disk.size).toBe(901_120)
    // the card would show DF0: as this, so a wrong one is visible before
    // anybody clicks the item
    expect(solo.disk.path).toBe('Games/Solo.adf')
  })

  it('puts the disks that boot at the front of a shelf', () => {
    const { library } = indexLibrary(root)
    // b-boot.adf sorts second by name and first by boot block, which is the
    // only thing an image says about where to start
    expect(at(library.root, 'Games/Two Disker').items.map((i) => i.disk.label)).toEqual(['Boot', 'Data'])
  })

  it('records nothing that is not the filename or read off the disk', () => {
    // The library holds files and no metadata beside them. Every field of an
    // item is either its own name or something the indexer opened the image
    // to find out, so there is nothing here that can go stale against the
    // disks it describes.
    const { library } = indexLibrary(root)
    const item = allItems(library.root).find((i) => i.id === 'games/two-disker/b-boot')!
    expect(Object.keys(item).sort()).toEqual(['disk', 'id', 'image', 'name'])
    expect(Object.keys(item.disk).sort()).toEqual([
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
    const item = at(library.root, 'Games').items.find((i) => i.name === 'Truncated')!
    expect(item.disk.label).toBeNull()
    // no Truncated.png, so it inherits Games.png the way Blaster does
    expect(item.image).toBe('Games.png')
    // A truncated download is the failure this catches: 7-Zip has produced
    // short files here twice while reporting success, and an 880K image is
    // told from a bad one by its exact byte count.
    expect(warnings.map((w) => w.message)).toContain('1024 bytes is not an Amiga disk image, truncated?')
  })

  it('counts the programs on a disk rather than listing them', () => {
    const { library } = indexLibrary(root)
    // an empty root block resolves to an empty directory, not to an error
    expect(at(library.root, 'Games').items.find((i) => i.name === 'Solo')!.disk.programs).toBe(0)
  })
})
