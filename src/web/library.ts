/**
 * Putting a thing into the machine.
 *
 * ONE entry point, `open()`, for everything a person can click: a disk off
 * the Browse tab, an archive in the file tree, a program in the file tree.
 * They differ only in where the bytes came from, and that is an argument.
 * Two code paths for "open the thing" is how the Files tab ended up able to
 * run a program but not to open the archive sitting next to it.
 *
 * What it does with the bytes:
 *
 * - a floppy image goes into the first EMPTY drive, under its own volume
 *   label, and nothing is ejected to make room until all four are full. That
 *   is what you would physically do with a two-disk game, and it is why
 *   there is no special case for multi-disk sets anywhere in this port.
 * - an archive is unpacked by the player, which mounts it and copies it into
 *   DH0: so relative loads resolve.
 * - a program is compiled and run with its own drawer current, on its own
 *   volume, which is what decides what a leading colon means.
 *
 * A disk already in a drive is not inserted twice. Clicking it again runs
 * what is on it, which is what clicking it looks like it should do.
 */
import type { AmigaFS } from '../amiga/vfs'
import type { FloppyDrive } from '../amiga/trackdisk'
import { AdfVolume, isAdf } from '../amiga/adf'
import { isAmosProgram } from '../loader/program'

export interface LibraryHost {
  vfs: AmigaFS
  /** the machine's four drive positions; a null is a line with no drive on it */
  drives: readonly (FloppyDrive | null)[]
  loadProgram(bytes: Uint8Array, name: string, dir: string[], vol: string): void
  /** for an archive: the player unpacks it, mounts it and finds its program */
  loadArchive(bytes: Uint8Array, name: string): Promise<void>
  /** run once the disk is in: assign detection, and anything else the page does */
  mounted?(): void
}

/** one thing to open, and where it came from if it came from the filesystem */
export interface OpenSource {
  /** the filename, which is what an unlabelled disk is named after */
  name: string
  bytes: Uint8Array
  /** the volume and drawer it was read from, for a program run out of the tree */
  at?: { vol: string; dir: string[] }
}

export interface OpenResult {
  /** what it turned out to be */
  kind: 'disk' | 'archive' | 'program'
  /** the volume it is reachable by, for a disk */
  volume: string | null
  /** every .AMOS found on it */
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

/** an unlabelled disk is reachable only by the name it was stored under */
function fallbackName(file: string): string {
  return file.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_]/g, '_')
}

export function createLibraryLoader(host: LibraryHost) {
  /**
   * Put a disk in a drive and say which one it answers to.
   *
   * The first EMPTY drive, so a second disk joins the first rather than
   * replacing it: that is how a two-disk game gets both halves in, with no
   * code anywhere that knows what a two-disk game is. When all four are full
   * the last is swapped, because something has to give and DF0: is the one a
   * program is most likely to be reading from.
   */
  function insert(adf: AdfVolume, file: string): string {
    const label = adf.info.label
    const volume = label === '' ? fallbackName(file) : label
    // already in a drive: clicking it again means run it, not fill a second
    // drive with the same disk
    if (label !== '' && host.drives.some((d) => d?.medium?.label === label)) return volume
    const free = host.drives.find((d) => d !== null && d.medium === null)
    const drive = free ?? [...host.drives].reverse().find((d) => d !== null)
    if (!drive) return volume
    drive.insert(adf)
    // an unlabelled disk has no VOLUME node to be reached by, and they exist,
    // so it is mounted under the filename as well
    if (label === '') host.vfs.mount(volume, adf)
    return volume
  }

  /**
   * Start the one program, if there is exactly one.
   *
   * Several is a choice, and there is nothing in the library that could name
   * which: it holds archives and pictures and no metadata beside them. So the
   * page hands you the file tree rather than starting the wrong one of two
   * hundred.
   */
  function runOne(programs: string[]): string | null {
    if (programs.length !== 1) return null
    const pick = programs[0]!
    const { vol, dir, name } = splitPath(pick)
    // DF0:, DH0: and HD0: all point at the drawer it came from, because a
    // game that shipped on a floppy says DF0: and one installed to a hard
    // disk says DH0: for the same directory
    host.vfs.assignDrives(dir.length > 0 ? `${vol}:${dir.join('/')}` : `${vol}:`)
    const bytes = host.vfs.read(pick)
    if (!bytes) return null
    host.loadProgram(bytes, name, dir, vol)
    return pick
  }

  async function open(src: OpenSource): Promise<OpenResult> {
    if (isAdf(src.bytes)) {
      const volume = insert(new AdfVolume(src.bytes), src.name)
      host.mounted?.()
      const programs = programsIn(host.vfs, volume)
      return { kind: 'disk', volume, programs, ran: runOne(programs) }
    }
    // A program, by header OR by name: a plain-text listing has no header to
    // identify it, and a tokenised one may have no extension.
    if (isAmosProgram(src.bytes) || /\.amos$/i.test(src.name)) {
      const at = src.at ?? { vol: 'DH0', dir: [] }
      host.loadProgram(src.bytes, src.name, at.dir, at.vol)
      const full = `${at.vol}:${[...at.dir, src.name].join('/')}`
      return { kind: 'program', volume: at.vol, programs: [full], ran: full }
    }
    // zip, lha, tar: no label and no filesystem of its own, so the player's
    // archive path handles it, DH0: copy and all
    await host.loadArchive(src.bytes, src.name)
    host.mounted?.()
    return { kind: 'archive', volume: null, programs: [], ran: null }
  }

  return { open }
}
