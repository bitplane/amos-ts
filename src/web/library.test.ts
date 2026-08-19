/**
 * What clicking a library cover does to the machine.
 *
 * The failure this guards is quiet: an item mounts, nothing starts, and the
 * canvas goes on showing whatever the last one left there. Or worse, it
 * starts the wrong program off a disk with two hundred on it. Neither errors,
 * so both look like the page working.
 *
 * The disks are built by ../testing/disk.ts rather than fetched, so the whole
 * thing runs with no corpus and no server.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { AmigaFS } from '../amiga/vfs'
import { FloppyDrive } from '../amiga/trackdisk'
import { DiskBuilder, ROOT_BLOCK } from '../testing/disk'
import { createLibraryLoader, programsIn, type LibraryHost } from './library'
import type { FetchedDisk } from './ui/browse'

const text = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))

/** an AMOS program is recognised by name here; the header is not read */
const PROGRAM = text('AMOS Pro   dummy listing')

/** a disk with a label and the named .AMOS files in its root */
function disk(label: string, programs: string[]): Uint8Array {
  const d = new DiskBuilder(false, label)
  programs.forEach((name, i) => d.file(ROOT_BLOCK, i, 800 + i * 10, name, PROGRAM))
  return d.bytes
}

function fetched(name: string, bytes: Uint8Array): FetchedDisk {
  return { name, bytes, disk: { path: name, size: bytes.length, label: null, filesystem: null, bootable: false, programs: 0 } }
}

interface Loaded {
  name: string
  dir: string[]
  vol: string
}

let vfs: AmigaFS
let drives: (FloppyDrive | null)[]
let loaded: Loaded[]
let archives: string[]
let host: LibraryHost

beforeEach(() => {
  vfs = new AmigaFS()
  drives = [0, 1, 2, 3].map((unit) => new FloppyDrive(unit))
  vfs.drives = drives
  loaded = []
  archives = []
  host = {
    vfs,
    drives,
    loadProgram: (_bytes, name, dir, vol) => loaded.push({ name, dir, vol }),
    loadArchive: async (_bytes, name) => {
      archives.push(name)
    },
  }
})

describe('opening a library item', () => {
  it('puts the disks in the drives, in the order the index gave them', async () => {
    const r = await createLibraryLoader(host).open([
      fetched('boot.adf', disk('Boot', [])),
      fetched('data.adf', disk('Data', [])),
    ])
    expect(r.volumes).toEqual(['Boot', 'Data'])
    // and each is reachable by BOTH names, which is what a drive with a disk
    // in it contributes to a real device list
    expect(vfs.volumeNames()).toEqual(expect.arrayContaining(['DF0', 'Boot', 'DF1', 'Data']))
  })

  it('runs the one program on the disks and says where it came from', async () => {
    const r = await createLibraryLoader(host).open([fetched('game.adf', disk('GameDisk', ['Game.AMOS']))])
    expect(r.ran).toBe('GameDisk:Game.AMOS')
    expect(loaded).toEqual([{ name: 'Game.AMOS', dir: [], vol: 'GameDisk' }])
    // DF0:, DH0: and HD0: all point at the drawer it came from, so a game
    // that says DF0: and one that says DH0: both find their own data
    expect(vfs.read('DH0:Game.AMOS')).not.toBeNull()
    expect(vfs.read('DF0:Game.AMOS')).not.toBeNull()
  })

  it('starts nothing when the disks hold several, and reports the count', async () => {
    const r = await createLibraryLoader(host).open([
      fetched('a.adf', disk('Demos', ['One.AMOS', 'Two.AMOS', 'Three.AMOS'])),
    ])
    // Guessing between three would start the wrong one two times in three.
    // The page sends you to the file tree instead.
    expect(r.ran).toBeNull()
    expect(r.programs).toHaveLength(3)
    expect(loaded).toEqual([])
  })

  it('starts nothing when there is nothing to start', async () => {
    // A system disk is not a game, and this port has no AmigaDOS to boot one.
    const r = await createLibraryLoader(host).open([fetched('sys.adf', disk('Workbench', []))])
    expect(r).toMatchObject({ ran: null, programs: [], volumes: ['Workbench'] })
  })

  it('mounts the fifth disk of a set by name, since there are four drive lines', async () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => fetched(`${n}.adf`, disk(`Disk${n.toUpperCase()}`, [])))
    const r = await createLibraryLoader(host).open(six)
    expect(r.volumes).toEqual(['DiskA', 'DiskB', 'DiskC', 'DiskD', 'DiskE', 'DiskF'])
    // the first four are in drives and the last two are not, but every one
    // of the six resolves. That is the point: AMOS Professional is six disks
    // and a program on the sixth still has to load its own data.
    expect(vfs.exists('DiskF:')).toBe('dir')
    expect(vfs.volumeNames().filter((v) => /^DF\d$/.test(v))).toEqual(['DF0', 'DF1', 'DF2', 'DF3'])
  })

  it('takes the last item out before putting the next one in', async () => {
    const loader = createLibraryLoader(host)
    const five = ['a', 'b', 'c', 'd', 'e'].map((n) => fetched(`${n}.adf`, disk(`Old${n.toUpperCase()}`, [])))
    await loader.open(five)
    expect(vfs.exists('OldE:')).toBe('dir')
    await loader.open([fetched('new.adf', disk('NewDisk', []))])
    // both kinds have to go: the four in drives, and the fifth that was
    // mounted by name. A left-behind volume shadows a later disk of the same
    // name, and the shadowed one is unreachable with nothing to say so.
    expect(vfs.exists('OldE:')).toBeNull()
    expect(vfs.exists('OldA:')).toBeNull()
    expect(vfs.exists('NewDisk:')).toBe('dir')
  })

  it('hands a zip to the player, which has its own rules for one', async () => {
    const r = await createLibraryLoader(host).open([fetched('thing.zip', text('PK not a disk'))])
    expect(archives).toEqual(['thing.zip'])
    expect(r.volumes).toEqual([])
  })
})

describe('programsIn', () => {
  it('finds programs in drawers, not only in the root', async () => {
    const d = new DiskBuilder(false, 'Deep')
    const sub = d.dir(ROOT_BLOCK, 0, 900, 'Games')
    d.file(sub, 0, 910, 'Inside.AMOS', PROGRAM)
    d.file(ROOT_BLOCK, 1, 920, 'Outside.AMOS', PROGRAM)
    await createLibraryLoader(host).open([fetched('deep.adf', d.bytes)])
    expect(programsIn(vfs, 'Deep').sort()).toEqual(['Deep:Games/Inside.AMOS', 'Deep:Outside.AMOS'])
  })
})
