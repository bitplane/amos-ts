/**
 * What a link to a disk has to survive.
 *
 * A link leaves the page and comes back through a chat window, a mail
 * client, somebody's memory and somebody else's keyboard, and every one of
 * those alters it. The rules that let it still land are all in ./route.ts and
 * are all string comparisons, so they are testable without a browser, an
 * index or a server, and they are the whole of what a broken link means here.
 *
 * The tree below is shaped like the real library: a folder per author, disks
 * under it, and names with the punctuation the disks actually carry.
 */
import { describe, expect, it } from 'vitest'
import type { LibraryFolder, LibraryItem } from '../cli/genlibrary'
import { canonical, itemPath, joinFragment, loose, resolve, slugPath, splitFragment } from './route'

/** an item whose only interesting parts are where it is and what it is called */
function item(path: string): LibraryItem {
  const name = (path.split('/').pop() ?? path).replace(/\.[^.]*$/, '')
  return {
    id: slugPath(path.replace(/\.[^.]*$/, '')),
    name,
    image: null,
    disk: { path, size: 901_120, label: null, filesystem: null, bootable: false, programs: 1 },
  }
}

function folder(name: string, folders: LibraryFolder[], items: LibraryItem[]): LibraryFolder {
  return { name, id: slugPath(name), image: null, folders, items }
}

const LIBRARY = folder(
  '',
  [
    folder('bitplane.net', [], [item('bitplane.net/Egg It.adf'), item("bitplane.net/Draw 'n' draw.adf")]),
    folder(
      'AMOS',
      [folder('Extras', [], [item('AMOS/Extras/Egg It.lha')])],
      [item('AMOS/AMOSPro_System.adf'), item('AMOS/AMOS 3D.adf')],
    ),
  ],
  [item('Ant Wars.adf')],
)

describe('canonical', () => {
  it('lowercases and hyphenates punctuation', () => {
    expect(canonical('Egg It')).toBe('egg-it')
    expect(canonical("Draw 'n' draw")).toBe('draw-n-draw')
    expect(canonical('bitplane.net')).toBe('bitplane-net')
  })

  it('keeps the underscore the AMOS disks are named with', () => {
    expect(canonical('AMOSPro_System')).toBe('amospro_system')
    expect(canonical('AMOSPro_Examples')).toBe('amospro_examples')
  })

  it('runs of punctuation are one hyphen, and the ends carry none', () => {
    expect(canonical('bitplane.....net')).toBe('bitplane-net')
    expect(canonical('  Egg   It!!! ')).toBe('egg-it')
    expect(canonical('(Demo)')).toBe('demo')
  })

  it('strips the diacritic rather than the letter under it', () => {
    expect(canonical('Über Wolf')).toBe('uber-wolf')
  })
})

describe('loose', () => {
  it('keys every spelling of one name the same way', () => {
    const keys = ['Egg It', 'egg-it', 'egg_it', 'EGG  IT', 'e.g.g.i.t'].map(loose)
    expect(new Set(keys)).toEqual(new Set(['eggit']))
  })

  it('erases the hyphen canonical adds, so both forms compare equal', () => {
    expect(loose(canonical('AMOSPro_System'))).toBe(loose('AMOSPro System'))
  })
})

describe('itemPath', () => {
  it('is the disk path down from the library root, canonically spelled', () => {
    expect(itemPath(item('bitplane.net/Egg It.adf'))).toEqual(['bitplane-net', 'egg-it'])
    expect(itemPath(item('AMOS/AMOSPro_System.adf'))).toEqual(['amos', 'amospro_system'])
  })

  it('takes the whole extension off a double one', () => {
    // `.tar.gz` is one archive and two dots; stripping by the last dot would
    // leave `thing-tar` in every link to it
    const it2 = item('Games/Thing.tar.gz')
    it2.name = 'Thing'
    expect(itemPath(it2)).toEqual(['games', 'thing'])
  })
})

describe('the fragment', () => {
  it('splits on slashes and undoes the escaping', () => {
    expect(splitFragment('#play/bitplane.net/egg%20it')).toEqual(['play', 'bitplane.net', 'egg it'])
    expect(splitFragment('#browse')).toEqual(['browse'])
    expect(splitFragment('')).toEqual([])
  })

  it('a stray percent is a typo, not a throw', () => {
    expect(splitFragment('#play/100%/egg-it')).toEqual(['play', '100%', 'egg-it'])
  })

  it('a canonical path needs no escaping to survive the round trip', () => {
    const path = ['play', 'bitplane-net', 'draw-n-draw']
    expect(joinFragment(path)).toBe('#play/bitplane-net/draw-n-draw')
    expect(splitFragment(joinFragment(path))).toEqual(path)
  })
})

describe('resolve', () => {
  const found = (...path: string[]): string => {
    const f = resolve(LIBRARY, path)
    if (f === null) return 'nothing'
    return `${f.kind} ${f.path.join('/')}`
  }

  it('finds a disk by its canonical path', () => {
    expect(found('bitplane-net', 'egg-it')).toBe('item bitplane-net/egg-it')
  })

  it('finds it through the spelling somebody actually types', () => {
    expect(found('bitplane.net', 'Egg It')).toBe('item bitplane-net/egg-it')
    expect(found('BITPLANE_NET', 'eggit')).toBe('item bitplane-net/egg-it')
    expect(found('bitplane.....net', 'egg it')).toBe('item bitplane-net/egg-it')
  })

  it('finds a folder', () => {
    expect(found('amos')).toBe('folder amos')
    expect(found('AMOS', 'Extras')).toBe('folder amos/extras')
  })

  it('takes a path with the front cut off it', () => {
    // `#play/amospro_system` is what is left when somebody shortens a link by
    // hand, and only one disk in the library answers to it
    expect(found('amospro_system')).toBe('item amos/amospro_system')
    expect(found('extras', 'egg-it')).toBe('item amos/extras/egg-it')
  })

  it('a name that two disks answer to resolves to neither', () => {
    // Egg It is in bitplane.net and in AMOS/Extras. Opening the wrong game is
    // worse than saying so.
    expect(found('egg-it')).toBe('nothing')
  })

  it('finds a disk sitting at the root', () => {
    expect(found('ant-wars')).toBe('item ant-wars')
  })

  it('an empty path and a name nothing carries both answer nothing', () => {
    expect(found()).toBe('nothing')
    expect(found('nosuchgame')).toBe('nothing')
    expect(found('amos', 'nosuchgame')).toBe('nothing')
  })

  it('the whole path beats a suffix, so a folder cannot shadow a disk', () => {
    // `amos/amos-3d` is exact; `amos-3d` alone would also match it by suffix,
    // and the exact pass has to run first or the two would be a coin toss
    expect(found('amos', 'amos-3d')).toBe('item amos/amos-3d')
    expect(found('amos-3d')).toBe('item amos/amos-3d')
  })
})
