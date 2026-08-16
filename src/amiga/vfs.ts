import type { AmosFS } from './fs'
import { FFS_BLOCK_DATA, ID_DOS_DISK, ID_VALIDATED, ID_WRITE_PROTECTED } from './dos'
import type { FloppyDrive } from './trackdisk'

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

/**
 * What `Info()` can say about a mounted volume — `struct InfoData`'s four
 * interesting fields, in ./dos.ts's terms.
 *
 * The hook is `dosInfo` rather than `info` because AdfVolume already carries
 * an `info` of its own — the label and filesystem it shows a user. This is
 * dos.library's, and the two are not the same question.
 *
 * A volume answers this only if it HAS a geometry. A disk image does: the
 * block count is its size and the free count is in its bitmap. A directory
 * on the host or a tree built in memory does not, and says so by not
 * implementing `info` at all, because inventing a floppy's worth of blocks
 * for one would be a number a caller could not tell from a measured one.
 */
export interface VolumeInfo {
  /** id_NumBlocks — the volume's capacity, less the boot blocks */
  numBlocks: number
  /** id_NumBlocksUsed */
  numBlocksUsed: number
  /** id_BytesPerBlock, 512 on every Amiga filesystem this models */
  bytesPerBlock: number
  /** id_DiskState — ID_WRITE_PROTECTED, ID_VALIDATING or ID_VALIDATED */
  diskState: number
  /** id_DiskType — ID_DOS_DISK, ID_FFS_DISK, ... */
  diskType: number
}

/** a pluggable read side; MemoryVolume also supports writes */
export interface Volume {
  read(segs: string[]): Uint8Array | null
  list(segs: string[]): DirEntry[] | null
  exists(segs: string[]): 'file' | 'dir' | null
  /**
   * The volume's geometry, for volumes that have one. Absent means the
   * question cannot be answered — which is what `Info()` failing looks like
   * from AmigaDOS, and is a better answer than a guess.
   *
   * `extraBytes` is what the write overlay is holding for this volume, since
   * every write in this filesystem lands there rather than in the volume. How
   * that counts is the VOLUME's business and the two answers differ: a disk
   * image is a fixed size, so the extra comes out of its free space, while a
   * memory volume grows and its free count is unaffected.
   */
  dosInfo?(extraBytes: number): VolumeInfo | null
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

  /**
   * Blocks to report as free. Zero by default, and that is a real statement
   * rather than a placeholder: RAM: on an Amiga is exactly as big as the
   * memory left, so a filesystem has no capacity to report and this one has
   * no memory model to ask. A caller that HAS one — the Runtime knows its own
   * pools — can set this and the number becomes meaningful.
   */
  freeBlocks = 0

  /**
   * A memory volume has no geometry, but it does know what is in it, so the
   * used count and the block size are measured and the free count is whatever
   * `freeBlocks` was told. DEVIATION: an unset `freeBlocks` makes the volume
   * look full to anything that asks how much room is left.
   */
  dosInfo(extraBytes = 0): VolumeInfo {
    let bytes = extraBytes
    const walk = (d: MemDir): void => {
      for (const f of d.files.values()) bytes += f.data.length
      for (const sub of d.dirs.values()) walk(sub)
    }
    walk(this.root)
    const used = Math.ceil(bytes / FFS_BLOCK_DATA)
    return {
      numBlocks: used + this.freeBlocks,
      numBlocksUsed: used,
      bytesPerBlock: FFS_BLOCK_DATA,
      diskState: ID_VALIDATED,
      diskType: ID_DOS_DISK,
    }
  }

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

  /**
   * Every volume name a program can reach.
   *
   * A drive with a disk in it contributes TWO: `DF0` and the disk's own
   * label, which is what a real device list holds and why both resolve. An
   * empty drive contributes nothing, because a DEVICE node with no volume
   * behind it is not somewhere a path can go.
   */
  volumeNames(): string[] {
    const out = [...this.volumes.values()].map((v) => v.name)
    for (const d of this.drives) {
      const medium = d.medium
      if (!medium) continue
      out.push(`DF${d.unit}`)
      if (medium.label !== '') out.push(medium.label)
    }
    return out
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
      if (this.strayVolume === 'currentDir' && !this.hasVolume(dev)) {
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
    const vol = this.entryOf(volKey)
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
    const vol = this.entryOf(volKey)
    if (!vol) return null
    const segs = bm[2]!.split('/').filter((s) => s !== '')
    for (const seg of rest.split('/')) if (seg !== '') segs.push(seg)
    const r = { volume: volKey, segs, canonical: `${vol.name}:${segs.join('/')}` }
    return this.existsResolved(r) !== null ? r : null
  }

  /**
   * The four floppy drives, when this filesystem is attached to a machine.
   *
   * Empty for a filesystem with no machine behind it, which is most of them:
   * the CLI, the census and nearly every test mount a tree and never touch a
   * drive. See `driveOf` for what having them changes.
   */
  drives: readonly FloppyDrive[] = []

  /**
   * The drive a volume name reaches, if any.
   *
   * Two names find one disk, and AmigaDOS keeps two node kinds for exactly
   * that (`dosextens.i`:279-281): the DEVICE node is `DF0` and is there with
   * the drive empty, and the VOLUME node is the disk's own label and is there
   * only while the disk is. So `DF0:` matches by unit and `Workbench3.1:`
   * matches by label, and both land on the same medium.
   *
   * An EMPTY drive matches nothing, including its own unit name: a DEVICE
   * node with no volume behind it is not somewhere a path can go, and the
   * name falls through to the mount table instead. That fall-through is what
   * lets a caller with no machine still mount a tree under `DF0` and have it
   * work, which is what the CLI and most tests do.
   *
   * A label wins over a mounted volume of the same name, because a disk
   * physically in the drive is the more specific answer. Nothing in this port
   * produces that collision yet.
   */
  private driveOf(key: string): FloppyDrive | null {
    for (const d of this.drives) if (`df${d.unit}` === key && d.medium) return d
    for (const d of this.drives) {
      const label = d.medium?.label.toLowerCase()
      if (label !== undefined && label !== '' && label === key) return d
    }
    return null
  }

  /**
   * The volume a name reaches, and the spelling to echo back for it.
   *
   * The name matters because it is what a canonical path is built from: a
   * disk reached as `df0` must print as `DF0:` and the same disk reached by
   * its label must print as the label, exactly as a real machine does with
   * its two node kinds.
   */
  private entryOf(key: string): { name: string; vol: Volume } | null {
    const drive = this.driveOf(key)
    const medium = drive?.medium
    if (drive && medium) {
      const unit = `df${drive.unit}` === key
      return { name: unit ? `DF${drive.unit}` : medium.label, vol: medium }
    }
    return this.volumes.get(key) ?? null
  }

  private volumeOf(key: string): Volume | null {
    return this.entryOf(key)?.vol ?? null
  }

  /** is this name a volume at all? A drive with no disk in it is NOT. */
  private hasVolume(key: string): boolean {
    return this.volumeOf(key) !== null
  }

  /**
   * The Volume mounted under a device name, or null.
   *
   * Public because raw-device access has to go round the filesystem entirely:
   * SLN's `S Disk Read` is `trackdisk.device` CMD_READ at a byte offset, and
   * the only thing that can serve it is the sector image the volume is made
   * of — `AdfVolume.image`. Nothing else needs this, and nothing that reads
   * FILES should use it.
   */
  /**
   * `Info()` on a volume, by name with or without the colon.
   *
   * Null where the volume is not mounted OR where it has no geometry to
   * report, and the caller cannot tell those apart — neither can a program
   * on a real machine, which gets a failed `Info()` either way.
   */
  volumeInfo(name: string): VolumeInfo | null {
    const key = name.toLowerCase().replace(/:$/, '')
    const vol = this.volumeOf(key)
    if (!vol?.dosInfo) return null
    // the write-protect tab is the DRIVE's, which is why AdfVolume declines
    // to answer and reports the validation state instead. With a drive
    // underneath there is finally somewhere for it to come from, and
    // ID_WRITE_PROTECTED outranks ID_VALIDATED: a protected disk is still a
    // valid one, and the field holds one value.
    const protectedBy = this.driveOf(key)?.writeProtected === true
    let bytes = 0
    const dir = this.overlay.root.dirs.get(key)
    if (dir) {
      const walk = (d: MemDir): void => {
        for (const f of d.files.values()) bytes += f.data.length
        for (const sub of d.dirs.values()) walk(sub)
      }
      walk(dir)
    }
    const info = vol.dosInfo(bytes)
    if (info && protectedBy) return { ...info, diskState: ID_WRITE_PROTECTED }
    return info
  }

  volume(name: string): Volume | null {
    return this.volumeOf(name.toLowerCase().replace(/:$/, ''))
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

  /**
   * Is this volume behind a write-protected drive?
   *
   * Every write in this filesystem lands in the overlay rather than in the
   * volume, so nothing was ever refused for being read-only. A tab is
   * different: the DRIVE refuses, before the filesystem sees the request, and
   * a program gets its error rather than a write that quietly goes nowhere
   * observable.
   */
  private protectedDisk(volumeKey: string): boolean {
    return this.driveOf(volumeKey)?.writeProtected === true
  }

  writeFile(path: string, data: Uint8Array): boolean {
    const r = this.resolve(path)
    if (!r) return false
    if (this.protectedDisk(r.volume)) return false
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
    if (!r || r.segs.length === 0 || this.protectedDisk(r.volume)) return false
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
    if (this.protectedDisk(r.volume)) return false
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
    if (a.volume !== b.volume || this.protectedDisk(a.volume)) return false
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
    if (!r || this.protectedDisk(r.volume)) return false
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
