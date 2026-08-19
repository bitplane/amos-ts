/**
 * Index a disk library into the `index.json` the Browse tab reads.
 *
 * The library is a separate repository, bitplane/amos-library, holding one
 * archive per thing you can run and a 4:3 picture beside it. This walks that
 * tree and writes a manifest of it; the two are published to the same site
 * from different jobs, because a new game should not need a release of the
 * player and a release of the player should not re-push the disks.
 *
 * ## The layout it reads
 *
 * A directory is a FOLDER or an ITEM, and which one it is depends on what is
 * in it. It is an item when it holds disks of its own and nothing below it
 * does; otherwise it is a folder and the walk goes into it. That is the only
 * rule, and it nests as deep as the library does.
 *
 *     Games/                     a folder
 *     Games.png                  its picture, beside it
 *     Games/Shoot/               a folder inside a folder
 *     Games/Shoot/Thing.adf      one disk, and an item called "Thing"
 *     Games/Shoot/Thing.png      that item's picture
 *     Games/Shoot/Big Thing/     holds archives, so it is a MULTI-DISK item
 *     Games/Shoot/Big Thing/A.adf
 *     Games/Shoot/Big Thing.png
 *
 * A picture is always a sibling `<name>.png`, whether `<name>` is a file or a
 * directory. An item with none inherits its folder's, and a folder with none
 * inherits ITS folder's, so a picture dropped at the top covers everything
 * under it until something nearer overrides it.
 *
 * The library repository holds FILES and nothing else. There is no metadata
 * file to go stale beside them, so everything in the index is either a
 * filename or something read out of the image itself.
 *
 * ## Why this lives here and not in the library repo
 *
 * It opens every disk with ../amiga/adf.ts and records the volume LABEL off
 * the root block, which is the name the disk answers to once mounted.
 * `AMOSPro_System:`, not the host filename somebody happened to save it
 * under. A program that loads `MyDisk:data/pic.iff` needs the label to be
 * right, so the card shows it and a wrong one is visible before anybody
 * clicks.
 *
 * Opening the image also catches the truncated download. `isAdf` accepts
 * three geometries by exact byte count, so a half-fetched 880K image fails
 * here rather than mounting empty and looking like a bad emulator.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { AdfVolume, isAdf } from '../amiga/adf'

/** the archive kinds a library item may be made of, as the player mounts them */
const ARCHIVE = /\.(adf|zip|tar|tar\.gz|tgz)$/i

/** the picture kinds, in the order a sibling is looked for */
const PICTURES = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

/** one disk or archive of an item */
export interface LibraryDisk {
  /** path relative to the library root, as the browser fetches it */
  path: string
  /** bytes on disk, so the tab can show a download size before fetching */
  size: number
  /** the volume label off the root block; null when it is not an ADF */
  label: string | null
  /** 'OFS' or 'FFS'; null when it is not an ADF */
  filesystem: 'OFS' | 'FFS' | null
  /**
   * Does the boot block hold code?
   *
   * Bytes 12..1023 of an unbootable Amiga floppy are zero, and the checksum
   * at +4 is zero with them. This is the only thing in the image that says
   * which disk of a set goes in DF0:, so it sorts first. It does not always
   * decide it, since AMOS Professional ships six disks of which two boot.
   */
  bootable: boolean
  /**
   * How many .AMOS files are on it.
   *
   * A count and not the list. The listing is what makes the walk worth doing,
   * since it proves every directory block on the disk resolves, but naming
   * all 195 of AMOS Professional's put 18 kB in the index for three items,
   * and Browse is the first thing the page fetches.
   */
  programs: number
}

export interface LibraryItem {
  /** the slugged path, so `AMOS/AMOS 3D` is `amos/amos-3d` */
  id: string
  /** the filename, less its extension */
  name: string
  /** its own picture, or the nearest one above it; null if there is none */
  image: string | null
  disks: LibraryDisk[]
}

export interface LibraryFolder {
  /** the directory name; empty at the root */
  name: string
  /** the slugged path; empty at the root */
  id: string
  /** its own picture, or the nearest one above it; null if there is none */
  image: string | null
  folders: LibraryFolder[]
  items: LibraryItem[]
}

export interface Library {
  /** bumped when the shape changes, so an old page can say so rather than break */
  version: 2
  root: LibraryFolder
}

/** what the walk emits alongside the index, for the job log */
export interface LibraryWarning {
  path: string
  message: string
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** `AMOS/AMOS 3D` -> `amos/amos-3d`; punctuation out, spaces to hyphens */
function slug(text: string): string {
  return text
    .split('/')
    .map((seg) =>
      seg
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .join('/')
}

/** count the .AMOS files on a mounted disk, walking every drawer on it */
function programsOn(vol: AdfVolume): number {
  let found = 0
  const walk = (segs: string[], depth: number): void => {
    if (depth > 6) return
    for (const e of vol.list(segs) ?? []) {
      if (e.isDir) walk([...segs, e.name], depth + 1)
      // By name, not by header. Reading every file to sniff it would
      // decompress the whole disk to count them, and the player picks the
      // program properly at load time anyway. This is for the card.
      else if (/\.amos$/i.test(e.name)) found++
    }
  }
  walk([], 0)
  return found
}

function readDisk(root: string, rel: string, warn: LibraryWarning[]): LibraryDisk {
  const bytes = new Uint8Array(readFileSync(join(root, rel)))
  const disk: LibraryDisk = {
    path: rel,
    size: bytes.length,
    label: null,
    filesystem: null,
    bootable: false,
    programs: 0,
  }
  if (!/\.adf$/i.test(rel)) return disk
  if (!isAdf(bytes)) {
    warn.push({ path: rel, message: `${bytes.length} bytes is not an Amiga disk image, truncated?` })
    return disk
  }
  // the boot block holds code: bytes 12 up are zero on a disk that has none
  disk.bootable = bytes.subarray(12, 1024).some((b) => b !== 0)
  try {
    const vol = new AdfVolume(bytes)
    disk.label = vol.info.label
    disk.filesystem = vol.info.filesystem
    disk.programs = programsOn(vol)
    if (disk.label === '') warn.push({ path: rel, message: 'the disk has no volume label' })
  } catch (e) {
    warn.push({ path: rel, message: e instanceof Error ? e.message : String(e) })
  }
  return disk
}

/**
 * Order the disks of a set: bootable first, then by name.
 *
 * The boot block is the only thing an image says about which disk of a set is
 * disk one, and it does not always decide it. AMOS Professional ships two
 * disks that boot, and both carry an `s/startup-sequence`, so nothing in the
 * images separates System from Productivity2. Every disk is mounted under its
 * own label whatever order they go in, so nothing becomes unreachable, and
 * the way to fix an order that matters is to name the files so they sort.
 */
function orderDisks(disks: LibraryDisk[]): LibraryDisk[] {
  return [...disks].sort(
    (a, b) => Number(b.bootable) - Number(a.bootable) || basename(a.path).localeCompare(basename(b.path)),
  )
}

/** the sibling picture for `<dir>/<base>`, or null */
function pictureFor(names: readonly string[], dir: string, base: string): string | null {
  for (const ext of PICTURES) {
    if (names.includes(base + ext)) return dir === '' ? base + ext : `${dir}/${base}${ext}`
  }
  return null
}

/** are there archives at or below this directory? */
function archivesBelow(path: string): boolean {
  let names: string[]
  try {
    names = readdirSync(path)
  } catch {
    return false
  }
  return names.some((f) => (isDir(join(path, f)) ? archivesBelow(join(path, f)) : ARCHIVE.test(f)))
}

/**
 * Is this directory ONE item, or a folder of them?
 *
 * It is an item when it holds disks of its own and nothing under it holds
 * disks. That second half is what makes `AMOS/` a folder: it has a loose
 * `AMOS.adf` in it, but `AMOS 3D/` and `AMOS Professional/` are down there
 * with disks of their own, so it cannot be one item. `Big Game/` with two
 * disks and a `screenshots/` drawer stays one item, because the drawer has
 * no disks in it.
 */
function isItemDir(path: string): boolean {
  const names = readdirSync(path)
  if (!names.some((f) => ARCHIVE.test(f) && !isDir(join(path, f)))) return false
  return !names.some((f) => isDir(join(path, f)) && archivesBelow(join(path, f)))
}

function buildItem(
  root: string,
  rel: string,
  name: string,
  diskPaths: string[],
  image: string | null,
  warn: LibraryWarning[],
): LibraryItem {
  const disks = orderDisks(diskPaths.map((p) => readDisk(root, p, warn)))
  if (disks.length === 0) warn.push({ path: rel, message: 'no disks, so the item is skipped' })
  if (image === null) warn.push({ path: rel, message: 'no picture here or above it' })
  return { id: slug(rel), name, image, disks }
}

/**
 * Walk one directory.
 *
 * `inherited` is the nearest picture above this point, which is what anything
 * without one of its own shows. Empty folders are pruned on the way back up:
 * a directory holding nothing but a README is not somewhere the tab should
 * let you navigate into.
 */
function scan(root: string, rel: string, name: string, inherited: string | null, warn: LibraryWarning[]): LibraryFolder {
  const names = readdirSync(join(root, rel)).sort((a, b) => a.localeCompare(b))
  const parentDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  const own = rel === '' ? null : pictureFor(readdirSync(join(root, parentDir)), parentDir, basename(rel))
  const image = own ?? inherited

  const folders: LibraryFolder[] = []
  const items: LibraryItem[] = []
  for (const entry of names) {
    if (entry.startsWith('.')) continue
    const childRel = rel === '' ? entry : `${rel}/${entry}`
    if (isDir(join(root, childRel))) {
      if (isItemDir(join(root, childRel))) {
        const disks = readdirSync(join(root, childRel))
          .filter((f) => ARCHIVE.test(f))
          .map((f) => `${childRel}/${f}`)
        items.push(buildItem(root, childRel, entry, disks, pictureFor(names, rel, entry) ?? image, warn))
      } else {
        const child = scan(root, childRel, entry, image, warn)
        if (child.folders.length > 0 || child.items.length > 0) folders.push(child)
      }
    } else if (ARCHIVE.test(entry)) {
      const base = entry.replace(ARCHIVE, '')
      // a directory of the same name already claimed this item, and the loose
      // archive beside it would make a second one under the same id
      if (isDir(join(root, rel === '' ? base : `${rel}/${base}`))) {
        warn.push({ path: childRel, message: `ignored: ${base}/ is already the item of that name` })
        continue
      }
      const itemRel = rel === '' ? base : `${rel}/${base}`
      items.push(buildItem(root, itemRel, base, [childRel], pictureFor(names, rel, base) ?? image, warn))
    }
  }
  return { name, id: slug(rel), image, folders, items: items.filter((i) => i.disks.length > 0) }
}

/** Walk a library checkout and build its index. */
export function indexLibrary(root: string): { library: Library; warnings: LibraryWarning[] } {
  const warnings: LibraryWarning[] = []
  return { library: { version: 2, root: scan(root, '', '', null, warnings) }, warnings }
}

/** every item in the tree, for counting and for the job log */
export function allItems(folder: LibraryFolder): LibraryItem[] {
  return [...folder.items, ...folder.folders.flatMap(allItems)]
}

/** every folder below this one, not counting itself */
function countFolders(folder: LibraryFolder): number {
  return folder.folders.length + folder.folders.reduce((n, c) => n + countFolders(c), 0)
}

function main(argv: string[]): number {
  const args = argv.filter((a) => !a.startsWith('-'))
  const root = args[0]
  if (root === undefined) {
    process.stderr.write('usage: genlibrary <library-dir> [out.json]\n')
    return 2
  }
  const out = args[1] ?? join(root, 'index.json')
  const { library, warnings } = indexLibrary(root)
  writeFileSync(out, JSON.stringify(library, null, 2) + '\n')
  const items = allItems(library.root)
  const disks = items.reduce((n, i) => n + i.disks.length, 0)
  for (const w of warnings) process.stderr.write(`warning: ${w.path}: ${w.message}\n`)
  process.stderr.write(`${out}: ${countFolders(library.root)} folders, ${items.length} items, ${disks} disks\n`)
  // A warning is not a failure. A game with no cover art yet still belongs in
  // the library, and a job that refused to publish over it would mean the
  // whole site waits for one picture.
  return 0
}

if (process.argv[1]?.endsWith('genlibrary.ts')) process.exit(main(process.argv.slice(2)))
