/**
 * The write half of the browser Files panel: rename, move, delete, new
 * drawer, relabel a volume.
 *
 * This is host machinery, not AMOS — the real Amiga did this from
 * Workbench or the Shell, and no AMOS keyword relabels a device. What it
 * does share is the filesystem underneath, so the rules are AmigaDOS's:
 * names can't contain `/` or `:`, a move stays inside one volume, and
 * nothing silently overwrites anything.
 *
 * Kept apart from main.ts so it can be tested without a DOM.
 */
import { AmigaFS, joinAmigaPath, parentAmigaPath } from '../amiga/vfs'

/** what happened, in a form the status line can show */
export interface FsResult {
  ok: boolean
  message: string
}

const fail = (message: string): FsResult => ({ ok: false, message })
const done = (message: string): FsResult => ({ ok: true, message })

/** the last component of a path — `DH0:Games/Zybex` -> `Zybex` */
export function baseName(path: string): string {
  const noSlash = path.replace(/\/$/, '')
  const i = Math.max(noSlash.lastIndexOf('/'), noSlash.lastIndexOf(':'))
  return noSlash.slice(i + 1)
}

/** AmigaDOS allows most things in a name, but not the two separators */
function badName(name: string): string | null {
  if (name.trim() === '') return 'a name is needed'
  if (/[:/]/.test(name)) return `"${name}" can't contain : or /`
  return null
}

/** rename a file or drawer in place, keeping it where it is */
export function renameEntry(fs: AmigaFS, path: string, to: string): FsResult {
  const bad = badName(to)
  if (bad) return fail(bad)
  const kind = fs.exists(path)
  if (kind === null) return fail(`${path} is gone`)
  const target = joinAmigaPath(parentAmigaPath(path), to)
  if (fs.rename(path, target)) return done(`renamed to ${to}`)
  return fail(fs.exists(target) !== null ? `${to} already exists` : `could not rename ${baseName(path)}`)
}

/**
 * Move an entry into a drawer. AmigaDOS Rename() can't cross devices, so a
 * cross-volume move is a copy-then-delete here — the file manager is host
 * machinery and the browser has no second device to fail against, but the
 * two paths stay honest about which one happened.
 */
export function moveEntry(fs: AmigaFS, path: string, intoDir: string): FsResult {
  const kind = fs.exists(path)
  if (kind === null) return fail(`${path} is gone`)
  if (fs.exists(intoDir) !== 'dir') return fail(`${intoDir} is not a drawer`)
  const name = baseName(path)
  const target = joinAmigaPath(intoDir, name)
  if (target.toLowerCase() === path.toLowerCase()) return fail(`${name} is already there`)
  // dropping a drawer into itself (or into its own child) would eat it
  if (kind === 'dir' && target.toLowerCase().startsWith(path.toLowerCase().replace(/\/$/, '') + '/')) {
    return fail(`can't move ${name} into itself`)
  }
  if (fs.exists(target) !== null) return fail(`${name} already exists in ${intoDir}`)
  if (fs.rename(path, target)) return done(`moved ${name} to ${intoDir}`)
  // different volumes: copy across, then take the original away
  if (!copyInto(fs, path, target)) return fail(`could not move ${name}`)
  fs.deleteAll(path)
  return done(`moved ${name} to ${intoDir}`)
}

/** recursive copy, used only for the cross-volume move */
function copyInto(fs: AmigaFS, from: string, to: string): boolean {
  const kind = fs.exists(from)
  if (kind === 'file') {
    const data = fs.readFile(from)
    return data !== null && fs.writeFile(to, data)
  }
  if (kind !== 'dir') return false
  if (!fs.mkdir(to)) return false
  for (const e of fs.listDir(from) ?? []) {
    if (!copyInto(fs, joinAmigaPath(from, e.name), joinAmigaPath(to, e.name))) return false
  }
  return true
}

/**
 * Delete a file, or a drawer and everything under it. The AMOS `Kill`
 * keyword refuses a non-empty drawer (DeleteFile does); the file manager
 * is allowed to, the way Workbench is, so `recursive` says which is meant.
 */
export function deleteEntry(fs: AmigaFS, path: string, recursive: boolean): FsResult {
  const kind = fs.exists(path)
  if (kind === null) return fail(`${path} is gone`)
  const count = kind === 'dir' ? (fs.listDir(path) ?? []).length : 0
  if (kind === 'dir' && count > 0 && !recursive) return fail(`${baseName(path)} is not empty`)
  if (!(recursive ? fs.deleteAll(path) : fs.deleteFile(path))) return fail(`could not delete ${baseName(path)}`)
  return done(`deleted ${baseName(path)}`)
}

/** a new drawer inside `dir` */
export function newDrawer(fs: AmigaFS, dir: string, name: string): FsResult {
  const bad = badName(name)
  if (bad) return fail(bad)
  const target = joinAmigaPath(dir, name)
  if (fs.exists(target) !== null) return fail(`${name} already exists`)
  if (!fs.mkdir(target)) return fail(`could not create ${name}`)
  return done(`created ${target}`)
}

/** relabel a volume, assigns and current directory following it */
export function relabelVolume(fs: AmigaFS, from: string, to: string): FsResult {
  const bad = badName(to)
  if (bad) return fail(bad)
  if (!fs.renameVolume(from, to)) return fail(`could not rename ${from} to ${to}:`)
  return done(`${from.replace(/:$/, '')}: is now ${to}:`)
}
