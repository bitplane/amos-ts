/**
 * Putting a library item into the machine.
 *
 * The disks arrive from ./ui/browse.ts, which fetched them from `/library/`.
 * What happens to them here is the whole difference between this and dropping
 * a file on the page: a library item is mounted as FLOPPIES. The disks go
 * into DF0: upwards and answer to their own volume labels, so a game written
 * to `Load "MyDisk:pic.iff"` finds it and `Dir` reads the disk rather than a
 * flattened copy of it.
 *
 * Split out of main.ts because it is the part with rules in it. Which disk
 * goes in which drive, what happens past the fourth, which program runs.
 * main.ts is a page, and a page cannot be tested.
 */
import type { AmigaFS } from '../amiga/vfs'
import type { FloppyDrive } from '../amiga/trackdisk'
import type { FetchedDisk } from './ui/browse'
import { AdfVolume, isAdf } from '../amiga/adf'

export interface LibraryHost {
  vfs: AmigaFS
  /** the machine's four drive positions; a null is a line with no drive on it */
  drives: readonly (FloppyDrive | null)[]
  loadProgram(bytes: Uint8Array, name: string, dir: string[], vol: string): void
  /** for an item that is a zip rather than a disk image */
  loadArchive(bytes: Uint8Array, name: string): Promise<void>
  /** run after the disks are in and before a program is picked: assign detection */
  mounted?(): void
}

export interface OpenResult {
  /** the volume names the item is reachable by, in insertion order */
  volumes: string[]
  /** every .AMOS found on them */
  programs: string[]
  /** the one that was started, or null when none was */
  ran: string | null
}

/** how deep to walk a disk looking for programs */
const MAX_DEPTH = 6

/** every .AMOS on a mounted volume, as full paths */
export function programsIn(vfs: AmigaFS, vol: string): string[] {
  const out: string[] = []
  const walk = (path: string, depth: number): void => {
    // deep enough for AMOSPro_Examples:Examples/H-2/, and a floor under a
    // damaged disk whose directory blocks point back at themselves
    if (depth > MAX_DEPTH) return
    for (const e of vfs.listDir(path) ?? []) {
      const full = path.endsWith(':') ? path + e.name : `${path}/${e.name}`
      if (e.isDir) walk(full, depth + 1)
      else if (/\.amos$/i.test(e.name)) out.push(full)
    }
  }
  walk(`${vol}:`, 0)
  return out
}

/** `Vol:Dir/Name.AMOS` -> the three things loadProgram wants */
function splitPath(path: string): { vol: string; dir: string[]; name: string } {
  const vol = path.split(':')[0] ?? 'DH0'
  const segs = (path.split(':')[1] ?? '').split('/').filter((s) => s !== '')
  return { vol, dir: segs.slice(0, -1), name: segs[segs.length - 1] ?? path }
}

/**
 * The loader keeps one piece of state: what the last item mounted outside a
 * drive, so the next one can take it away again. Drives are cleared by
 * ejecting them, which takes their labels off the device list with them.
 */
export function createLibraryLoader(host: LibraryHost) {
  const mounted = new Set<string>()

  async function open(disks: FetchedDisk[]): Promise<OpenResult> {
    for (const d of host.drives) d?.eject()
    for (const name of mounted) host.vfs.unmount(name)
    mounted.clear()

    const volumes: string[] = []
    let unit = 0
    for (const d of disks) {
      if (!isAdf(d.bytes)) {
        // a zip is not a disk: it has no label and no filesystem, so the
        // player's own archive path handles it, DH0: copy and all
        await host.loadArchive(d.bytes, d.name)
        continue
      }
      const adf = new AdfVolume(d.bytes)
      const label = adf.info.label
      const drive = host.drives[unit]
      if (drive) {
        drive.insert(adf)
        unit++
        volumes.push(label === '' ? `DF${drive.unit}` : label)
      } else {
        /*
         * Four /SELn lines is four drives, and AMOS Professional is six
         * disks. The rest are mounted by name with no drive behind them:
         * every path still resolves, and what is lost is `Drive State` and
         * the disk-change line, neither of which a program can usefully ask
         * about a disk nobody is going to swap.
         */
        const name = label === '' ? d.name.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_]/g, '_') : label
        host.vfs.mount(name, adf)
        mounted.add(name)
        volumes.push(name)
      }
    }

    host.mounted?.()

    // One program on the disks is not a choice, so it runs. Several is, and
    // there is nothing in the library that could name which: it holds disk
    // images and covers, and no metadata beside them. So the page hands you
    // the file tree rather than starting the wrong one of two hundred.
    const programs = volumes.flatMap((v) => programsIn(host.vfs, v))
    const pick = programs.length === 1 ? programs[0] : undefined
    if (pick === undefined) return { volumes, programs, ran: null }

    const { vol, dir, name } = splitPath(pick)
    // DF0:, DH0: and HD0: all point at the drawer it came from, because a
    // game that shipped on a floppy says DF0: and one installed to a hard
    // disk says DH0: for the same directory
    host.vfs.assignDrives(dir.length > 0 ? `${vol}:${dir.join('/')}` : `${vol}:`)
    const bytes = host.vfs.read(pick)
    if (!bytes) return { volumes, programs, ran: null }
    host.loadProgram(bytes, name, dir, vol)
    return { volumes, programs, ran: pick }
  }

  return { open }
}
