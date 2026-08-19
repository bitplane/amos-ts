/**
 * What clicking a thing does to the machine.
 *
 * The failures this guards are quiet ones: a disk mounts, nothing starts, and
 * the canvas goes on showing whatever the last one left there. Or a program
 * runs with the wrong volume current, and every relative load it makes finds
 * nothing without erroring. Neither looks like a fault from the outside.
 *
 * The disks are built by ../testing/disk.ts rather than fetched, so the whole
 * thing runs with no corpus and no server.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { AmigaFS } from '../amiga/vfs'
import { FloppyDrive } from '../amiga/trackdisk'
import { DiskBuilder, ROOT_BLOCK } from '../testing/disk'
import { createLibraryLoader, programsIn, type LibraryHost } from './library'

const text = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))

/** recognised by name here; the header is not read */
const PROGRAM = text('a listing')

/** a disk with a label and the named .AMOS files in its root */
function disk(label: string, programs: string[] = []): Uint8Array {
  const d = new DiskBuilder(false, label)
  programs.forEach((name, i) => d.file(ROOT_BLOCK, i, 800 + i * 10, name, PROGRAM))
  return d.bytes
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

/** which drive each disk ended up in, by label */
const inDrives = (): (string | null)[] => drives.map((d) => d?.medium?.label ?? null)

describe('opening a disk', () => {
  it('puts it in the first empty drive and answers to its own label', async () => {
    const r = await createLibraryLoader(host).open({ name: 'boot.adf', bytes: disk('Boot') })
    expect(r).toMatchObject({ kind: 'disk', volume: 'Boot' })
    // both names, which is what a drive with a disk in it contributes to a
    // real device list
    expect(vfs.volumeNames()).toEqual(expect.arrayContaining(['DF0', 'Boot']))
  })

  it('lets a second disk join the first rather than replacing it', async () => {
    // This is the whole multi-disk story. Nothing in the port knows what a
    // two-disk game is; you put the second disk in the second drive, which is
    // what you would do at the machine.
    const loader = createLibraryLoader(host)
    await loader.open({ name: 'a.adf', bytes: disk('DiskA') })
    await loader.open({ name: 'b.adf', bytes: disk('DiskB') })
    expect(inDrives()).toEqual(['DiskA', 'DiskB', null, null])
    expect(vfs.exists('DiskA:')).toBe('dir')
    expect(vfs.exists('DiskB:')).toBe('dir')
  })

  it('does not fill a second drive with a disk that is already in one', async () => {
    const loader = createLibraryLoader(host)
    await loader.open({ name: 'a.adf', bytes: disk('DiskA', ['Go.AMOS']) })
    loaded.length = 0
    await loader.open({ name: 'a.adf', bytes: disk('DiskA', ['Go.AMOS']) })
    expect(inDrives()).toEqual(['DiskA', null, null, null])
    // clicking it again runs what is on it, which is what clicking it looks
    // like it should do
    expect(loaded).toEqual([{ name: 'Go.AMOS', dir: [], vol: 'DiskA' }])
  })

  it('swaps the last drive once all four are full', async () => {
    const loader = createLibraryLoader(host)
    for (const n of ['A', 'B', 'C', 'D', 'E']) await loader.open({ name: `${n}.adf`, bytes: disk(`Disk${n}`) })
    // DF0: is the one a program is most likely to be reading from, so the
    // one that gives way is the far end
    expect(inDrives()).toEqual(['DiskA', 'DiskB', 'DiskC', 'DiskE'])
    expect(vfs.exists('DiskD:')).toBeNull()
  })

  it('mounts an unlabelled disk under its filename', async () => {
    // they exist, and a disk with no VOLUME node has nothing else to be
    // reached by
    const r = await createLibraryLoader(host).open({ name: 'no name.adf', bytes: disk('') })
    expect(r.volume).toBe('no_name')
    expect(vfs.exists('no_name:')).toBe('dir')
  })

  it('runs the one program on it and says where it came from', async () => {
    const r = await createLibraryLoader(host).open({ name: 'game.adf', bytes: disk('GameDisk', ['Game.AMOS']) })
    expect(r.ran).toBe('GameDisk:Game.AMOS')
    expect(loaded).toEqual([{ name: 'Game.AMOS', dir: [], vol: 'GameDisk' }])
    // DF0:, DH0: and HD0: all point at the drawer it came from, so a game
    // that says DF0: and one that says DH0: both find their own data
    expect(vfs.read('DH0:Game.AMOS')).not.toBeNull()
    expect(vfs.read('DF0:Game.AMOS')).not.toBeNull()
  })

  it('starts nothing when the disk holds several, and reports the count', async () => {
    const r = await createLibraryLoader(host).open({
      name: 'demos.adf',
      bytes: disk('Demos', ['One.AMOS', 'Two.AMOS', 'Three.AMOS']),
    })
    // Guessing between three would start the wrong one two times in three.
    // The page sends you to the file tree instead.
    expect(r.ran).toBeNull()
    expect(r.programs).toHaveLength(3)
    expect(loaded).toEqual([])
  })

  it('starts nothing when there is nothing to start', async () => {
    // A system disk is not a game, and this port has no AmigaDOS to boot one.
    const r = await createLibraryLoader(host).open({ name: 'sys.adf', bytes: disk('Workbench') })
    expect(r).toMatchObject({ ran: null, programs: [], volume: 'Workbench' })
  })
})

describe('opening an archive or a program', () => {
  it('hands an archive to the player, which has its own rules for one', async () => {
    // An .lha is most of Aminet and so most of the extensions. The tree used
    // to leave them inert while the very same file, dropped on the window,
    // mounted fine.
    const r = await createLibraryLoader(host).open({ name: 'AMCAF150Final.lha', bytes: text('-lh5- not a disk') })
    expect(r.kind).toBe('archive')
    expect(archives).toEqual(['AMCAF150Final.lha'])
  })

  it('runs a program on the volume it was read from, not on DH0:', async () => {
    /*
     * The bug this pins. `loadProgram` defaults to DH0:, and the file tree
     * used to call it without saying otherwise. Every drop also landed a copy
     * in DH0:, so the wrong answer worked by accident; a library disk is
     * mounted as a floppy and copied nowhere, so the current directory ended
     * up naming a volume the program is not on. Relative loads then found
     * nothing without erroring, which is what `Td Load "car1"` reports as
     * "Object file not found".
     */
    const r = await createLibraryLoader(host).open({
      name: 'Car_Race.AMOS',
      bytes: PROGRAM,
      at: { vol: 'AMOS_3D', dir: ['Files', 'AMOS_3D_demos'] },
    })
    expect(r.kind).toBe('program')
    expect(loaded).toEqual([{ name: 'Car_Race.AMOS', dir: ['Files', 'AMOS_3D_demos'], vol: 'AMOS_3D' }])
  })
})

describe('programsIn', () => {
  it('finds programs in drawers, not only in the root', async () => {
    const d = new DiskBuilder(false, 'Deep')
    const sub = d.dir(ROOT_BLOCK, 0, 900, 'Games')
    d.file(sub, 0, 910, 'Inside.AMOS', PROGRAM)
    d.file(ROOT_BLOCK, 1, 920, 'Outside.AMOS', PROGRAM)
    await createLibraryLoader(host).open({ name: 'deep.adf', bytes: d.bytes })
    expect(programsIn(vfs, 'Deep').sort()).toEqual(['Deep:Games/Inside.AMOS', 'Deep:Outside.AMOS'])
  })
})
