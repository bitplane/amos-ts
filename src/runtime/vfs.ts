import type { AmosFS } from './fs'

/**
 * An Amiga-flavoured virtual filesystem:
 *
 * - paths are `Volume:dir/dir/file` with case-insensitive, case-preserving
 *   names; `:` alone roots the current volume; EMPTY path components mean
 *   parent (`/file` is "file in the parent", `a//b` climbs twice) — real
 *   AmigaDOS semantics
 * - assigns (`Assign "Data:" To "DH0:Games/Data"`) resolve recursively
 * - volumes are pluggable: an in-memory writable tree (uploads, saves)
 *   or host-backed read-only providers; all writes land in memory
 *
 * The JS side can create/fill/inspect everything: mount volumes, add
 * assigns, write files, list directories.
 */

export interface DirEntry {
  name: string
  isDir: boolean
  size: number
}

/** a pluggable read side; MemoryVolume also supports writes */
export interface Volume {
  read(segs: string[]): Uint8Array | null
  list(segs: string[]): DirEntry[] | null
  exists(segs: string[]): 'file' | 'dir' | null
}

interface MemDir {
  name: string
  dirs: Map<string, MemDir>
  files: Map<string, { name: string; data: Uint8Array }>
}

const newDir = (name: string): MemDir => ({ name, dirs: new Map(), files: new Map() })

export class MemoryVolume implements Volume {
  root = newDir('')

  private walk(segs: string[], make = false): MemDir | null {
    let cur = this.root
    for (const seg of segs) {
      const key = seg.toLowerCase()
      let next = cur.dirs.get(key)
      if (!next) {
        if (!make) return null
        next = newDir(seg)
        cur.dirs.set(key, next)
      }
      cur = next
    }
    return cur
  }

  read(segs: string[]): Uint8Array | null {
    if (segs.length === 0) return null
    const dir = this.walk(segs.slice(0, -1))
    return dir?.files.get(segs[segs.length - 1]!.toLowerCase())?.data ?? null
  }

  list(segs: string[]): DirEntry[] | null {
    const dir = this.walk(segs)
    if (!dir) return null
    const out: DirEntry[] = []
    for (const d of dir.dirs.values()) out.push({ name: d.name, isDir: true, size: 0 })
    for (const f of dir.files.values()) out.push({ name: f.name, isDir: false, size: f.data.length })
    return out
  }

  exists(segs: string[]): 'file' | 'dir' | null {
    if (segs.length === 0) return 'dir'
    if (this.read(segs) !== null) return 'file'
    return this.walk(segs) !== null ? 'dir' : null
  }

  write(segs: string[], data: Uint8Array): void {
    const dir = this.walk(segs.slice(0, -1), true)!
    const name = segs[segs.length - 1]!
    dir.files.set(name.toLowerCase(), { name, data })
  }

  mkdir(segs: string[]): void {
    this.walk(segs, true)
  }

  delete(segs: string[]): boolean {
    const dir = this.walk(segs.slice(0, -1))
    if (!dir) return false
    const key = segs[segs.length - 1]!.toLowerCase()
    return dir.files.delete(key) || dir.dirs.delete(key)
  }
}

export interface ResolvedPath {
  volume: string
  segs: string[]
  /** canonical form `Volume:seg/seg` (original volume casing) */
  canonical: string
}

export class AmigaFS implements AmosFS {
  private volumes = new Map<string, { name: string; vol: Volume }>()
  private assigns = new Map<string, string>()
  /** all writes land here, shadowing read-only volumes */
  readonly overlay = new MemoryVolume()
  private deleted = new Set<string>()
  currentDir = ''

  // ---- setup (the JS side) ----

  mount(name: string, vol: Volume): void {
    this.volumes.set(name.toLowerCase().replace(/:$/, ''), { name: name.replace(/:$/, ''), vol })
    if (this.currentDir === '') this.currentDir = `${name.replace(/:$/, '')}:`
  }

  /** create an empty writable volume */
  mountMemory(name: string): MemoryVolume {
    const vol = new MemoryVolume()
    this.mount(name, vol)
    return vol
  }

  assign(name: string, target: string): void {
    const display = name.replace(/:$/, '')
    this.assigns.set(display.toLowerCase(), target)
    this.assignDisplay.set(display.toLowerCase(), display)
  }

  /** original-case assign names for device enumeration */
  private assignDisplay = new Map<string, string>()

  volumeNames(): string[] {
    return [...this.volumes.values()].map((v) => v.name)
  }

  assignNames(): string[] {
    return [...this.assigns.keys()].map((k) => this.assignDisplay.get(k) ?? k)
  }

  // ---- path resolution ----

  /** resolve an Amiga path against the current dir and assigns */
  resolve(path: string): ResolvedPath | null {
    let p = path.trim()
    // expand device / assign, recursively (with a cycle guard)
    let base = this.currentDir
    for (let hops = 0; hops < 16; hops++) {
      const m = /^([^:/]*):(.*)$/.exec(p)
      if (!m) break
      const dev = m[1]!.toLowerCase()
      if (dev === '') {
        // ":path" — root of the current volume
        const cur = /^([^:/]*):/.exec(base)
        base = `${cur?.[1] ?? ''}:`
        p = m[2]!
        break
      }
      const assigned = this.assigns.get(dev)
      if (assigned !== undefined) {
        p = assigned.replace(/\/?$/, '/') + m[2]!
        continue
      }
      base = `${m[1]!}:`
      p = m[2]!
      break
    }
    // split the base (volume + dir segs)
    const bm = /^([^:/]*):(.*)$/.exec(base)
    if (!bm) return null
    const volKey = bm[1]!.toLowerCase()
    const vol = this.volumes.get(volKey)
    if (!vol) return null
    const segs: string[] = bm[2]!.split('/').filter((s) => s !== '')
    // apply the path: empty components climb to the parent (AmigaDOS);
    // a trailing slash is inert ("dir/" is just the dir)
    const parts = p.split('/')
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]!
      if (seg === '') {
        if (parts.length > 1 && i < parts.length - 1) segs.pop()
      } else {
        segs.push(seg)
      }
    }
    return { volume: volKey, segs, canonical: `${vol.name}:${segs.join('/')}` }
  }

  private volumeOf(key: string): Volume | null {
    return this.volumes.get(key)?.vol ?? null
  }

  // ---- file API ----

  readFile(path: string): Uint8Array | null {
    const r = this.resolve(path)
    if (!r) return null
    if (this.deleted.has(r.canonical.toLowerCase())) return null
    const over = this.overlay.read([r.volume, ...r.segs])
    if (over !== null) return over
    return this.volumeOf(r.volume)?.read(r.segs) ?? null
  }

  writeFile(path: string, data: Uint8Array): boolean {
    const r = this.resolve(path)
    if (!r) return false
    this.deleted.delete(r.canonical.toLowerCase())
    this.overlay.write([r.volume, ...r.segs], data)
    return true
  }

  exists(path: string): 'file' | 'dir' | null {
    const r = this.resolve(path)
    if (!r) return null
    if (this.deleted.has(r.canonical.toLowerCase())) return null
    return this.overlay.exists([r.volume, ...r.segs]) ?? this.volumeOf(r.volume)?.exists(r.segs) ?? null
  }

  deleteFile(path: string): boolean {
    const r = this.resolve(path)
    if (!r) return false
    const had = this.exists(path) !== null
    this.overlay.delete([r.volume, ...r.segs])
    if (had) this.deleted.add(r.canonical.toLowerCase())
    return had
  }

  rename(from: string, to: string): boolean {
    const data = this.readFile(from)
    if (data === null) return false
    this.deleteFile(from)
    return this.writeFile(to, data)
  }

  mkdir(path: string): boolean {
    const r = this.resolve(path)
    if (!r) return false
    this.overlay.mkdir([r.volume, ...r.segs])
    return true
  }

  listDir(path: string): DirEntry[] | null {
    const r = this.resolve(path)
    if (!r) return null
    const disk = this.volumeOf(r.volume)?.list(r.segs)
    const over = this.overlay.list([r.volume, ...r.segs])
    if (disk === null && over === null) return null
    const byName = new Map<string, DirEntry>()
    for (const e of disk ?? []) byName.set(e.name.toLowerCase(), e)
    for (const e of over ?? []) byName.set(e.name.toLowerCase(), e)
    const prefix = r.canonical.toLowerCase().replace(/\/?$/, '/')
    return [...byName.values()].filter((e) => !this.deleted.has(prefix + e.name.toLowerCase()))
  }

  setCurrentDir(path: string): boolean {
    const r = this.resolve(path)
    if (!r || this.exists(path) !== 'dir') return false
    this.currentDir = r.canonical
    return true
  }

  // ---- legacy AmosFS ----

  read(path: string): Uint8Array | null {
    return this.readFile(path)
  }
}

/** AmigaDOS/AMOS filename pattern (`#?`, `*`, `?`) → RegExp */
export function amigaPattern(pattern: string): RegExp {
  let rx = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!
    if (c === '#' && pattern[i + 1] === '?') {
      rx += '.*'
      i++
    } else if (c === '*') {
      rx += '.*'
    } else if (c === '?') {
      rx += '.'
    } else {
      rx += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${rx}$`, 'i')
}
