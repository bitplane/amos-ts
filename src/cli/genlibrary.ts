/**
 * Index a disk library into the `index.json` the Browse tab reads.
 *
 * The library is a separate repository, bitplane/amos-library, holding
 * archives and a 4:3 picture beside them. This walks that tree and writes a
 * manifest of it; the two are published to the same site from different jobs,
 * because a new game should not need a release of the player and a release of
 * the player should not re-push the disks.
 *
 * ## The layout it reads
 *
 * Every directory is a FOLDER and every archive in it is an ITEM. There is no
 * third case, and nothing looks at what a directory holds to decide which it
 * is. That is what lets one walk handle six AMOS Professional disks and a
 * drawer of twenty-eight extensions without either being a special case.
 *
 *     Games/                      a folder
 *     Games.png                   its picture, beside it
 *     Games/Shoot/                a folder inside a folder
 *     Games/Shoot/Thing.adf       an item
 *     Games/Shoot/Thing.png       its picture
 *     Games/Shoot/Two Disker/     a folder holding two items
 *     Games/Shoot/Two Disker/A.adf
 *     Games/Shoot/Two Disker.png  its picture, which both disks inherit
 *
 * A picture is a sibling `<name>.png` for a file or a directory alike. What
 * has none inherits its folder's, and a folder with none inherits ITS
 * folder's, so one picture at the top covers everything under it until
 * something nearer overrides it.
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
import { join } from 'node:path'
import { AdfVolume, isAdf } from '../amiga/adf'
/*
 * The naming rule, shared with the page rather than restated here.
 *
 * `id` is what a link to this disk says, and ../web/route.ts is what the
 * Browse tab writes into the address bar and matches an incoming link
 * against. Two copies of one slug rule is two chances for a generated link
 * to miss its own index, so there is one, and it lives in the file the
 * browser can import: this one opens `node:fs` and that one imports nothing.
 */
import { slugPath as slug } from '../web/route'

/**
 * What counts as an item: whatever ../runtime/archive.ts can open. A floppy
 * image, or an archive one of xadmaster's three clients claims. `.lha` is
 * most of Aminet, and so most of the extensions.
 */
const ARCHIVE = /\.(adf|lha|lzh|zip|tar|tar\.gz|tgz)$/i

/** the picture kinds, in the order a sibling is looked for */
const PICTURES = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

/** one disk or archive */
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
   * at +4 is zero with them. It sorts a shelf of disks so the ones that boot
   * come first, which is the only thing the images say about where to start.
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
  /** the slugged path, less the extension */
  id: string
  /** the filename, less its extension */
  name: string
  /** its own picture, or the nearest one above it; null if there is none */
  image: string | null
  disk: LibraryDisk
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

/**
 * No version field.
 *
 * There was one, and it was bumped twice in an afternoon, and both times all
 * it did was turn "the library republishes in a minute" into an error message
 * on a working site. The two repositories publish independently, so a page
 * and an index are ROUTINELY a few minutes out of step; a reader that refuses
 * what it is given makes that a failure instead of a wait.
 *
 * The shape is self-describing. A folder has `folders` and `items`, and a
 * page that cannot find them says so and carries on.
 */
export interface Library {
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
  // Only an ADF has any of the rest. An LHA is opened by the player when it
  // is clicked, and decompressing every one here to count what is inside
  // would unpack the whole library on every push.
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

/** the sibling picture for `<dir>/<base>`, or null */
function pictureFor(names: readonly string[], dir: string, base: string): string | null {
  for (const ext of PICTURES) {
    if (names.includes(base + ext)) return dir === '' ? base + ext : `${dir}/${base}${ext}`
  }
  return null
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
  const leaf = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel
  const own = rel === '' ? null : pictureFor(readdirSync(join(root, parentDir)), parentDir, leaf)
  const image = own ?? inherited

  const folders: LibraryFolder[] = []
  const items: LibraryItem[] = []
  for (const entry of names) {
    if (entry.startsWith('.')) continue
    const childRel = rel === '' ? entry : `${rel}/${entry}`
    if (isDir(join(root, childRel))) {
      const child = scan(root, childRel, entry, image, warn)
      if (child.folders.length > 0 || child.items.length > 0) folders.push(child)
    } else if (ARCHIVE.test(entry)) {
      const base = entry.replace(ARCHIVE, '')
      const picture = pictureFor(names, rel, base) ?? image
      if (picture === null) warn.push({ path: childRel, message: 'no picture here or above it' })
      items.push({
        id: slug(childRel.replace(ARCHIVE, '')),
        name: base,
        image: picture,
        disk: readDisk(root, childRel, warn),
      })
    }
  }
  // bootable first, then by name. On a shelf of six AMOS Professional disks
  // that puts the two that boot at the front.
  items.sort((a, b) => Number(b.disk.bootable) - Number(a.disk.bootable) || a.name.localeCompare(b.name))
  return { name, id: slug(rel), image, folders, items }
}

/** Walk a library checkout and build its index. */
export function indexLibrary(root: string): { library: Library; warnings: LibraryWarning[] } {
  const warnings: LibraryWarning[] = []
  return { library: { root: scan(root, '', '', null, warnings) }, warnings }
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
  for (const w of warnings) process.stderr.write(`warning: ${w.path}: ${w.message}\n`)
  process.stderr.write(`${out}: ${countFolders(library.root)} folders, ${allItems(library.root).length} items\n`)
  // A warning is not a failure. A game with no cover art yet still belongs in
  // the library, and a job that refused to publish over it would mean the
  // whole site waits for one picture.
  return 0
}

if (process.argv[1]?.endsWith('genlibrary.ts')) process.exit(main(process.argv.slice(2)))
