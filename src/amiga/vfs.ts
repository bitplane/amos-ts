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
  /**
   * The AmigaDOS metadata the volume carries in its own filesystem, for
   * volumes that have one. A real disk image does: the protection bits, the
   * FileNote and the DateStamp are in the header block beside the name. A zip
   * or an uploaded tree does not, so this is optional and absent means "no
   * opinion" — `AmigaFS.meta` falls back to `defaultMeta()`, and an explicit
   * `setMeta` always outranks whatever the volume says.
   */
  meta?(segs: string[]): Partial<FileMeta> | null
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


/**
 * AmigaDOS file metadata: the comment, protection bits and datestamp every
 * file and directory carries alongside its contents.
 *
 * Kept beside the data rather than in it, because most volumes here are
 * read-only (an ADF, a zip) and the metadata has to be settable regardless.
 */
export interface FileMeta {
  /** the FileNote, up to 79 characters; empty when unset */
  comment: string
  /**
   * `fib_Protection`. The high nibble is active HIGH (bit 7 hidden, 6 script,
   * 5 pure, 4 archived) and the low nibble is active LOW (bit 3 readable,
   * 2 writable, 1 executable, 0 deleteable) — a set bit in the low nibble
   * *denies* the permission. 0 is therefore the default `----rwed`.
   *
   * The flags themselves are `FIBF_*` in `./dos.ts`, with `permits()` for the
   * inverted nibble; this field is just where the byte is kept.
   */
  protection: number
  /** days since 1 Jan 1978 */
  days: number
  /** minutes since midnight */
  mins: number
  /** ticks (1/50 s) elapsed in the current minute */
  ticks: number
}

export const defaultMeta = (): FileMeta => ({ comment: '', protection: 0, days: 0, mins: 0, ticks: 0 })

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
  /** AmigaDOS metadata per path; absent means the defaults */
  private metadata = new Map<string, FileMeta>()
  currentDir = ''

  /**
   * What to do with a path naming a volume that is not mounted.
   *
   * `'error'` is the machine's own answer and the default: DH1: is not
   * there, so the path does not resolve. The census depends on this — a
   * missing file has to look like a missing file or the oracle is blind.
   *
   * `'currentDir'` is for running a program away from the machine it was
   * written on. A 1997 game says `Dir$="dh1:amos/amos_saves"` and then loads
   * everything by bare name; that volume is gone and is never coming back,
   * but the files are sitting right beside the program. The stray volume is
   * dropped and the rest of the path resolved against the current directory,
   * falling back to the last component alone when the drawers in between do
   * not exist either — which is what makes a flat archive of a game's drawer
   * just work.
   *
   * A deviation, and NOT what an Amiga does: InDirD (+Lib.s:4828) locks the
   * path and branches to L_DiskError when it cannot, so the real machine
   * stops the program. Hosts that want a game to run turn this on; anything
   * measuring fidelity leaves it alone.
   */
  strayVolume: 'error' | 'currentDir' = 'error'

  /**
   * The Amiga's drive names, which cannot exist in a browser.
   *
   * DF0: to DF3: are the four floppy units trackdisk.device supports — four
   * is the real ceiling, there was never a DF7:. DH0:/HD0: upward are the
   * hard-disk conventions; the number is whatever the mountlist said, so a
   * few is enough to cover what programs actually name.
   *
   * A game that shipped on a floppy says DF0: because that is where it was.
   * Pointing these at the drawer the program came from is compatibility for
   * free, with nothing edited inside the game.
   */
  static readonly DRIVES: readonly string[] = [
    'DF0', 'DF1', 'DF2', 'DF3',
    'DH0', 'DH1', 'DH2', 'DH3',
    'HD0', 'HD1', 'HD2', 'HD3',
  ]

  /**
   * Point every Amiga drive name at one directory.
   *
   * The target must NOT itself sit under a drive name: assigns are expanded
   * before volumes, so `assignDrives('DH0:game')` makes DH0 refer to a path
   * beginning DH0: and the expansion spins until the cycle guard stops it.
   * Pass a volume that is not in DRIVES.
   */
  assignDrives(target: string): void {
    const dev = /^([^:/]*):/.exec(target.trim())?.[1]?.toUpperCase()
    if (dev !== undefined && AmigaFS.DRIVES.includes(dev)) {
      throw new Error(`assignDrives: ${target} is itself under a drive name`)
    }
    for (const d of AmigaFS.DRIVES) this.assign(d, target)
  }

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

  /**
   * Relabel a volume. Host-side only — no AMOS keyword renames a device —
   * but the overlay, the tombstones, the assigns and the current directory
   * are all keyed by volume, so they have to come along. Assigns and the
   * current dir follow the volume rather than break, which is what happens
   * on the Amiga where both hold a lock rather than a name.
   */
  renameVolume(from: string, to: string): boolean {
    const oldKey = from.replace(/:$/, '').toLowerCase()
    const name = to.replace(/:$/, '')
    const newKey = name.toLowerCase()
    if (!this.volumes.has(oldKey) || name === '' || /[:/]/.test(name)) return false
    if (newKey !== oldKey && this.volumes.has(newKey)) return false

    // rebuilt in place so the panel's volume order doesn't jump
    const rebuilt = new Map<string, { name: string; vol: Volume }>()
    for (const [k, v] of this.volumes) rebuilt.set(k === oldKey ? newKey : k, k === oldKey ? { name, vol: v.vol } : v)
    this.volumes = rebuilt

    const over = this.overlay.root.dirs.get(oldKey)
    if (over) {
      this.overlay.root.dirs.delete(oldKey)
      over.name = name
      this.overlay.root.dirs.set(newKey, over)
    }
    const retarget = (p: string): string => (p.replace(/:.*/s, '').toLowerCase() === oldKey ? name + p.slice(oldKey.length) : p)
    for (const key of [...this.deleted]) {
      if (key.slice(0, oldKey.length + 1) === oldKey + ':') {
        this.deleted.delete(key)
        this.deleted.add(newKey + key.slice(oldKey.length))
      }
    }
    for (const [k, target] of this.assigns) this.assigns.set(k, retarget(target))
    this.currentDir = retarget(this.currentDir)
    return true
  }

  // ---- path resolution ----

  /** resolve an Amiga path against the current dir and assigns */
  resolve(path: string): ResolvedPath | null {
    let p = path.trim()
    const absolute = /^[^:/]*:/.test(p)
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
      if (this.strayVolume === 'currentDir' && !this.volumes.has(dev)) {
        // the volume is gone; try what is left against where we are
        const rest = m[2]!.replace(/^\/+/, '')
        const here = this.resolveIn(this.currentDir, rest)
        if (here) return here
        const leaf = rest.split('/').filter((s2) => s2 !== '').pop()
        if (leaf !== undefined) {
          const byLeaf = this.resolveIn(this.currentDir, leaf)
          if (byLeaf) return byLeaf
        }
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
    const out = { volume: volKey, segs, canonical: `${vol.name}:${segs.join('/')}` }
    // Last chance for an absolute path that leads nowhere: try shorter and
    // shorter tails of it against the current directory. The drawers a 1997
    // program names are its author's own — "dh0:amos_pro/saves/space_game/
    // gfx/moon_screen.iff" is a whole hard disk's layout wrapped around one
    // file that is really just in "gfx/". Dropping leading components until
    // something matches finds it while keeping as much of the author's own
    // structure as still exists; the last thing tried is the bare filename.
    //
    // Nothing is invented: a tail is accepted only when a real file is
    // sitting at it, so a genuinely missing file stays missing.
    if (
      this.strayVolume === 'currentDir' &&
      absolute &&
      segs.length > 1 &&
      this.existsResolved(out) === null
    ) {
      for (let from = 1; from < segs.length; from++) {
        const tail = this.resolveIn(this.currentDir, segs.slice(from).join('/'))
        if (tail) return tail
      }
    }
    return out
  }

  /** resolve `rest` under `base`, but only if something is actually there */
  private resolveIn(base: string, rest: string): ResolvedPath | null {
    const bm = /^([^:/]*):(.*)$/.exec(base)
    if (!bm) return null
    const volKey = bm[1]!.toLowerCase()
    const vol = this.volumes.get(volKey)
    if (!vol) return null
    const segs = bm[2]!.split('/').filter((s) => s !== '')
    for (const seg of rest.split('/')) if (seg !== '') segs.push(seg)
    const r = { volume: volKey, segs, canonical: `${vol.name}:${segs.join('/')}` }
    return this.existsResolved(r) !== null ? r : null
  }

  private volumeOf(key: string): Volume | null {
    return this.volumes.get(key)?.vol ?? null
  }

  // ---- tombstones ----
  //
  // Deleting something that lives in a read-only volume can't actually
  // remove it, so the path is recorded here and the read-only layer is
  // masked from that point down — a deleted directory takes its whole
  // subtree with it, which is why lookups test the ancestors too. The
  // overlay is never masked: writing into a deleted drawer recreates it
  // with only what has been written since, not with the old contents back.

  /** the tombstone key for a resolved path (`dh0:games/zybex`) */
  private tomb(r: ResolvedPath): string {
    return `${r.volume}:${r.segs.join('/').toLowerCase()}`
  }

  /** is the read-only layer masked at or above this path? */
  private hidden(r: ResolvedPath): boolean {
    for (let i = r.segs.length; i > 0; i--) {
      if (this.deleted.has(`${r.volume}:${r.segs.slice(0, i).join('/').toLowerCase()}`)) return true
    }
    return false
  }

  // ---- file API ----

  readFile(path: string): Uint8Array | null {
    const r = this.resolve(path)
    if (!r) return null
    const over = this.overlay.read([r.volume, ...r.segs])
    if (over !== null) return over
    return (this.hidden(r) ? null : this.volumeOf(r.volume)?.read(r.segs)) ?? null
  }

  writeFile(path: string, data: Uint8Array): boolean {
    const r = this.resolve(path)
    if (!r) return false
    this.overlay.write([r.volume, ...r.segs], data)
    return true
  }

  exists(path: string): 'file' | 'dir' | null {
    const r = this.resolve(path)
    return r ? this.existsResolved(r) : null
  }

  private existsResolved(r: ResolvedPath): 'file' | 'dir' | null {
    return (
      this.overlay.exists([r.volume, ...r.segs]) ??
      (this.hidden(r) ? null : this.volumeOf(r.volume)?.exists(r.segs)) ??
      null
    )
  }

  /**
   * Kill (InKill +Lib.s:4902) is AmigaDOS DeleteFile(), which takes a file
   * or an *empty* directory and fails on anything else — so a directory
   * with contents is refused here rather than silently taking them along.
   */
  deleteFile(path: string): boolean {
    const r = this.resolve(path)
    if (!r || r.segs.length === 0) return false
    const kind = this.exists(path)
    if (kind === null) return false
    if (kind === 'dir' && (this.listDir(path) ?? []).length > 0) return false
    this.erase(r)
    return true
  }

  /** delete a directory and everything under it — host-side (the file
   * manager), not something any AMOS keyword does */
  deleteAll(path: string): boolean {
    const r = this.resolve(path)
    if (!r || r.segs.length === 0 || this.exists(path) === null) return false
    this.erase(r)
    return true
  }

  private erase(r: ResolvedPath): void {
    this.overlay.delete([r.volume, ...r.segs])
    this.deleted.add(this.tomb(r))
    // metadata belongs to the object, not the name: it goes with it, and
    // takes a deleted directory's whole subtree along
    const under = this.tomb(r) + '/'
    for (const k of [...this.metadata.keys()]) {
      if (k === this.tomb(r) || k.startsWith(under)) this.metadata.delete(k)
    }
  }

  /**
   * Rename (InRename +Lib.s:4915) is AmigaDOS Rename(), so it also *moves*
   * within a volume and works on directories. It fails when the target
   * exists (ERROR_OBJECT_EXISTS) and when the two paths are on different
   * devices (ERROR_RENAME_ACROSS_DEVICES) — no copying across volumes.
   */
  rename(from: string, to: string): boolean {
    const a = this.resolve(from)
    const b = this.resolve(to)
    if (!a || !b || a.segs.length === 0 || b.segs.length === 0) return false
    if (a.volume !== b.volume) return false
    const kind = this.exists(a.canonical)
    if (kind === null) return false
    const sameName = this.tomb(a) === this.tomb(b)
    if (!sameName && this.exists(b.canonical) !== null) return false
    // no moving a directory inside itself
    if (kind === 'dir' && !sameName && this.tomb(b).startsWith(this.tomb(a) + '/')) return false
    if (kind === 'file') {
      const data = this.readFile(a.canonical)
      if (data === null) return false
      const meta = this.metadata.get(this.tomb(a))
      this.erase(a)
      if (!this.writeFile(b.canonical, data)) return false
      if (meta) this.metadata.set(this.tomb(b), meta)
      return true
    }
    // a directory goes with everything under it; the contents are read out
    // before the source is erased, since the two can overlap in case-only
    // renames and the read side is layered
    const { dirs, files } = this.contents(a.canonical)
    const moved = files.map((f) => ({ path: joinAmigaPath(b.canonical, f.rel.join('/')), data: f.data }))
    // metadata is keyed by path, so re-key the whole subtree before erasing
    const metaFrom = this.tomb(a)
    const carried = [...this.metadata].filter(([k]) => k === metaFrom || k.startsWith(metaFrom + '/'))
    this.erase(a)
    this.mkdir(b.canonical)
    for (const d of dirs) this.mkdir(joinAmigaPath(b.canonical, d.join('/')))
    for (const f of moved) this.writeFile(f.path, f.data)
    const metaTo = this.tomb(b)
    for (const [k, v] of carried) this.metadata.set(metaTo + k.slice(metaFrom.length), v)
    return true
  }

  /** everything under a directory, as segments relative to it */
  private contents(path: string): { dirs: string[][]; files: { rel: string[]; data: Uint8Array }[] } {
    const dirs: string[][] = []
    const files: { rel: string[]; data: Uint8Array }[] = []
    const walk = (dir: string, rel: string[]): void => {
      for (const e of this.listDir(dir) ?? []) {
        const child = joinAmigaPath(dir, e.name)
        if (e.isDir) {
          dirs.push([...rel, e.name])
          walk(child, [...rel, e.name])
        } else {
          const data = this.readFile(child)
          if (data !== null) files.push({ rel: [...rel, e.name], data })
        }
      }
    }
    walk(path, [])
    return { dirs, files }
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
    const disk = (this.hidden(r) ? null : this.volumeOf(r.volume)?.list(r.segs)) ?? null
    const over = this.overlay.list([r.volume, ...r.segs])
    if (disk === null && over === null) return null
    // a deleted name is only really gone while nothing has been written
    // back over it, so the overlay goes on top of the filter, not under it
    const prefix = `${this.tomb(r)}${r.segs.length === 0 ? '' : '/'}`
    const byName = new Map<string, DirEntry>()
    for (const e of disk ?? []) {
      if (!this.deleted.has(prefix + e.name.toLowerCase())) byName.set(e.name.toLowerCase(), e)
    }
    for (const e of over ?? []) byName.set(e.name.toLowerCase(), e)
    return [...byName.values()]
  }

  // ---- AmigaDOS metadata ----

  /**
   * The comment, protection bits and datestamp for a path. Files that have
   * never had any set read back as defaults rather than as absent, which is
   * what AmigaDOS does — every file has protection bits.
   */
  meta(path: string): FileMeta {
    const r = this.resolve(path)
    if (!r) return defaultMeta()
    return { ...defaultMeta(), ...this.volumeMeta(r), ...this.metadata.get(this.tomb(r)) }
  }

  /**
   * What the mounted volume itself says about a path, under anything set
   * here. Layered exactly like the read side: the overlay wins, because a
   * file written over a mounted floppy is a new file and does not inherit
   * the image's protection bits or its 1992 DateStamp, and a tombstone hides
   * the volume outright.
   */
  private volumeMeta(r: ResolvedPath): Partial<FileMeta> | null {
    if (this.overlay.exists([r.volume, ...r.segs]) !== null) return null
    if (this.hidden(r)) return null
    return this.volumeOf(r.volume)?.meta?.(r.segs) ?? null
  }

  /** set part of a path's metadata; returns false if the path is unresolvable */
  setMeta(path: string, patch: Partial<FileMeta>): boolean {
    const r = this.resolve(path)
    if (!r) return false
    const key = this.tomb(r)
    this.metadata.set(key, { ...defaultMeta(), ...this.metadata.get(key), ...patch })
    return true
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

/** append a name to a directory path, in Amiga form */
export function joinAmigaPath(path: string, name: string): string {
  if (path === '' || path.endsWith(':') || path.endsWith('/')) return path + name
  return `${path}/${name}`
}

/**
 * Fs_Parent (+Lib.s:18326) walks back over a trailing '/' and then to the
 * previous '/' or ':'. Note the original does nothing at all unless the path
 * ends in '/', which the caller reproduces.
 */
export function parentAmigaPath(path: string): string {
  const noSlash = path.replace(/\/$/, '')
  const i = noSlash.lastIndexOf('/')
  if (i >= 0) return noSlash.slice(0, i)
  const c = noSlash.indexOf(':')
  return c >= 0 ? noSlash.slice(0, c + 1) : noSlash
}

/**
 * FillSort's ordering key (+Lib.s): case-insensitive, and the '*' that marks
 * a directory sorts before every printable character so drawers head the
 * list. Shared by Dir First$ and the file selector, which walk the same
 * Fill-File records.
 */
export function fillSortKey(s: string): string {
  let k = ''
  for (const c of s) k += c === '*' ? '\x01' : c.toUpperCase()
  return k
}

/*
 * `amigaPattern` used to live here: twenty lines compiling `#?` / `*` / `?`
 * to a case-insensitive RegExp, and every AMOS-side glob went through it.
 *
 * It is gone, and nothing replaces it in this directory. Filename filtering
 * in AMOS is `Joker` (+Lib.s:6631), which is neither this nor dos.library's
 * grammar — `*` stops at a dot, `?` will not match one, `/` separates
 * alternatives and `#` is an ordinary character. It is a Lib_Def routine in
 * AMOS's own main library, so it belongs on the AMOS side of the line:
 * ../runtime/joker.ts. `dospattern.ts` here stays what it always was, the
 * real ParsePattern/MatchPattern behind LDos's Lmatch and JD-K3's Jd Match.
 *
 * Being in this directory is part of what made the old one look like a
 * subset of dos.library rather than a different language.
 */
