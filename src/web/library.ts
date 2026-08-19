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
 * - a floppy image goes into DF0: AND is mounted under its own label, and
 *   the label STAYS mounted after the next disk pushes it out of the drive.
 *   The drive is the convenience; the label is the truth. A two-disk game
 *   whose first disk asks for `Disk2:data` finds it without anyone swapping
 *   anything, because every disk that has ever been put in is still there
 *   under its own name. Four drives was the hardware's limit and is not the
 *   filesystem's, so nothing is evicted to make room for anything.
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
  /**
   * For an archive: the player unpacks it, mounts it and picks its program.
   * Answers everything it found and which one it started, because neither is
   * visible from out here: an archive holding fifteen programs and one
   * holding none both came back empty, and the page said "no AMOS program"
   * for both.
   */
  loadArchive(bytes: Uint8Array, name: string): Promise<{ programs: string[]; ran: string | null }>
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
  /**
   * Which drive to put a disk in. DF0: unless the caller says otherwise.
   *
   * Only a program that addresses `DF1:` by name needs anything else, and
   * only the person clicking knows that it does, which is why this comes
   * from a menu and not from a rule.
   */
  drive?: number
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
   * Put a disk in, and say what it answers to.
   *
   * Two things happen and they are separate. The disk goes in a DRIVE, DF0:
   * unless the caller was told otherwise, which is what a program reading
   * `DF0:` expects to find. And it is MOUNTED under its own volume label,
   * which is permanent: the next disk replaces it in the drive and leaves
   * the label alone. That is the whole multi-disk story, and no code
   * anywhere knows what a multi-disk set is.
   *
   * An unlabelled disk has no VOLUME node to be reached by, and they exist,
   * so it is mounted under its filename instead.
   */
  function insert(adf: AdfVolume, file: string, unit = 0): string {
    const volume = adf.info.label === '' ? fallbackName(file) : adf.info.label
    host.vfs.mount(volume, adf)
    host.drives[unit]?.insert(adf)
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
      const volume = insert(new AdfVolume(src.bytes), src.name, src.drive ?? 0)
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
    // archive path handles it, DH0: copy and all. It picks the program too,
    // and what it picked has to come back out: reporting `ran: null` for an
    // archive that DID start something sent the page to the file tree saying
    // "holds no AMOS program" while the thing ran behind it.
    const found = await host.loadArchive(src.bytes, src.name)
    host.mounted?.()
    return { kind: 'archive', volume: null, programs: found.programs, ran: found.ran }
  }

  return { open }
}
