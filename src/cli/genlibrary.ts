/**
 * Index a disk library into the `index.json` the Browse tab reads.
 *
 * The library is a separate repository, bitplane/amos-library, holding one
 * archive per thing you can run and a 4:3 image beside it. This walks that
 * tree and writes a manifest of it; the two are published to the same site
 * from different jobs, because a new game should not need a release of the
 * player and a release of the player should not re-push the disks.
 *
 * ## The layout it reads
 *
 *     Games/                     a directory at the root is a GROUP
 *     Games.png                  the group's image, beside it
 *     Games/Thing.adf            one disk: an ITEM called "Thing"
 *     Games/Thing.png            that item's image
 *     Games/Big Thing/           a directory inside a group is a MULTI-DISK item
 *     Games/Big Thing/Disk1.adf
 *     Games/Big Thing.png
 *
 * Two levels, fixed: group then item. Nothing nests further, so an item is
 * always addressed as `<group>/<item>` and the id can be derived rather than
 * declared.
 *
 * The library repository holds FILES and nothing else. There is no metadata
 * file to go stale beside them, so everything in the index is either the
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
   * decide it, since AMOS Professional ships two bootable disks. That is
   * what the `disks` override exists for.
   */
  bootable: boolean
  /**
   * How many .AMOS files are on it.
   *
   * A count and not the list. The listing is what makes the walk worth doing
   * -- it proves every directory block on the disk resolves -- but naming
   * all 195 of AMOS Professional's put 18 kB in the index for three items,
   * and the Browse tab is the first thing the page fetches. The player finds
   * the programs itself once the disk is mounted.
   */
  programs: number
}

export interface LibraryItem {
  /** `<group>/<item>`, lowercased and hyphenated */
  id: string
  /** the filename, less its extension */
  name: string
  group: string
  /** the 4:3 image, relative to the library root; null when there is none yet */
  image: string | null
  disks: LibraryDisk[]
}

export interface LibraryGroup {
  name: string
  image: string | null
  items: LibraryItem[]
}

export interface Library {
  /** bumped when the shape changes, so an old page can say so rather than break */
  version: 1
  groups: LibraryGroup[]
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
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
 * The boot block is the only thing an image says about which disk of a set
 * is disk one, and it does not always decide it. AMOS Professional ships six
 * disks of which two boot, and both carry an `s/startup-sequence`, so
 * nothing in the images separates System from Productivity2 and this puts
 * the second one in DF0:. Every disk is still mounted under its own label,
 * so nothing becomes unreachable, and the way to fix an order that matters
 * is to name the files so they sort.
 */
function orderDisks(disks: LibraryDisk[]): LibraryDisk[] {
  return [...disks].sort(
    (a, b) => Number(b.bootable) - Number(a.bootable) || basename(a.path).localeCompare(basename(b.path)),
  )
}

function buildItem(
  root: string,
  group: string,
  name: string,
  diskPaths: string[],
  imageRel: string | null,
  warn: LibraryWarning[],
): LibraryItem {
  const disks = orderDisks(diskPaths.map((p) => readDisk(root, p, warn)))
  if (disks.length === 0) warn.push({ path: `${group}/${name}`, message: 'no disks, so the item is skipped' })
  if (imageRel === null) warn.push({ path: `${group}/${name}`, message: 'no image; the card gets a placeholder' })
  return { id: `${slug(group)}/${slug(name)}`, name, group, image: imageRel, disks }
}

/** Walk a library checkout and build its index. */
export function indexLibrary(root: string): { library: Library; warnings: LibraryWarning[] } {
  const warnings: LibraryWarning[] = []
  const groups: LibraryGroup[] = []
  const rootNames = readdirSync(root).sort((a, b) => a.localeCompare(b))
  for (const group of rootNames) {
    if (group.startsWith('.') || !isDir(join(root, group))) continue
    const image = rootNames.includes(`${group}.png`) ? `${group}.png` : null
    const names = readdirSync(join(root, group)).sort((a, b) => a.localeCompare(b))
    const items: LibraryItem[] = []
    for (const entry of names) {
      if (entry.startsWith('.')) continue
      const rel = `${group}/${entry}`
      if (isDir(join(root, rel))) {
        // a drawer inside a group is a multi-disk set
        const disks = readdirSync(join(root, rel))
          .filter((f) => ARCHIVE.test(f))
          .map((f) => `${rel}/${f}`)
        const png = names.includes(`${entry}.png`) ? `${rel}.png` : null
        const item = buildItem(root, group, entry, disks, png, warnings)
        if (item.disks.length > 0) items.push(item)
      } else if (ARCHIVE.test(entry)) {
        const base = entry.replace(ARCHIVE, '')
        // a drawer of the same name already claimed this item, and the loose
        // archive beside it would make a second one under the same id
        if (isDir(join(root, group, base))) {
          warnings.push({ path: rel, message: `ignored: ${base}/ is already the item of that name` })
          continue
        }
        const png = names.includes(`${base}.png`) ? `${group}/${base}.png` : null
        items.push(buildItem(root, group, base, [rel], png, warnings))
      }
    }
    if (items.length > 0) groups.push({ name: group, image, items })
    else warnings.push({ path: group, message: 'no items in this group' })
  }
  return { library: { version: 1, groups }, warnings }
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
  const items = library.groups.reduce((n, g) => n + g.items.length, 0)
  const disks = library.groups.reduce((n, g) => n + g.items.reduce((m, i) => m + i.disks.length, 0), 0)
  for (const w of warnings) process.stderr.write(`warning: ${w.path}: ${w.message}\n`)
  process.stderr.write(`${out}: ${library.groups.length} groups, ${items} items, ${disks} disks\n`)
  // A warning is not a failure. A game with no cover art yet still belongs in
  // the library, and a job that refused to publish over it would mean the
  // whole site waits for one PNG.
  return 0
}

if (process.argv[1]?.endsWith('genlibrary.ts')) process.exit(main(process.argv.slice(2)))
