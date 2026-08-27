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

/**
 * Something appearing in or leaving the filesystem.
 *
 * A path ending in a colon is a whole VOLUME. Nothing else carries a payload:
 * a listener that cares what changed reads it back, because the filesystem
 * holds the bytes and duplicating them into an event would only create a
 * second copy to disagree with.
 */
export interface FsEvent {
  kind: 'add' | 'remove'
  /** `DH0:Games/thing.amos`, or `DF0:` for a volume */
  path: string
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
   * Blocks to report as free, or null for "nobody has said".
   *
   * RAM: on an Amiga is exactly as big as the memory left, so a filesystem
   * has no capacity of its own to report and this one has no memory model to
   * ask. A caller that HAS one — the Runtime knows its own pools — can set
   * this and the number becomes meaningful.
   *
   * Null rather than zero, because zero is a measurement: it says the volume
   * is FULL. It was zero, and `=Dfree` on the browser's own DH0: answered 0
   * bytes free the moment that keyword started reporting what volumes said —
   * a writable store that never refuses a write, claiming there was no room
   * in it. The interface above already draws this line: a volume without a
   * geometry declines the question rather than inventing a floppy's worth of
   * blocks, and this is that decline.
   */
  freeBlocks: number | null = null

  /**
   * A memory volume knows what is IN it, but its capacity is the host's and
   * not its own, so the geometry is only reported once someone supplies the
   * free count. Null until then — see `freeBlocks`.
   */
  dosInfo(extraBytes = 0): VolumeInfo | null {
    if (this.freeBlocks === null) return null
    return this.measured(extraBytes, this.freeBlocks)
  }

  private measured(extraBytes: number, freeBlocks: number): VolumeInfo {
    let bytes = extraBytes
    const walk = (d: MemDir): void => {
      for (const f of d.files.values()) bytes += f.data.length
      for (const sub of d.dirs.values()) walk(sub)
    }
    walk(this.root)
    const used = Math.ceil(bytes / FFS_BLOCK_DATA)
    return {
      numBlocks: used + freeBlocks,
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

  /**
   * Told when something appears or goes away, if anybody asked.
   *
   * On the VOLUME rather than on `AmigaFS`, because there are two ways in and
   * only this one is common to both: `AmigaFS.writeFile` lands in the overlay,
   * which is one of these, and a host writing a dropped file calls
   * `volume.write` on a mounted one directly. A listener on the filesystem's
   * own methods would miss every file the page puts there.
   */
  onChange: ((segs: readonly string[], kind: 'add' | 'remove') => void) | null = null

  write(segs: string[], data: Uint8Array): void {
    const dir = this.walk(segs.slice(0, -1), true)!
    const name = segs[segs.length - 1]!
    dir.files.set(name.toLowerCase(), { name, data })
    this.onChange?.(segs, 'add')
  }

  mkdir(segs: string[]): void {
    this.walk(segs, true)
  }

  delete(segs: string[]): boolean {
    const dir = this.walk(segs.slice(0, -1))
    if (!dir) return false
    const key = segs[segs.length - 1]!.toLowerCase()
    const gone = dir.files.delete(key) || dir.dirs.delete(key)
    if (gone) this.onChange?.(segs, 'remove')
    return gone
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
  private readonly watchers = new Set<(e: FsEvent) => void>()

  constructor() {
    // The overlay is where every write a PROGRAM makes lands, so it has to be
    // heard from as well as the mounted volumes. Missing this was the whole
    // event system covering dropped files and nothing a running program did.
    // Its segs already carry the volume in front, which is the shape `join`
    // takes.
    this.overlay.onChange = (segs, kind) => this.emit(kind, AmigaFS.join(segs))
  }
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
   * A deviation, and NOT what an Amiga does: InDirD (+Lib.s:4799) locks the
   * path and branches to L_DiskError when it cannot, so the real machine
   * stops the program. Hosts that want a game to run turn this on; anything
   * measuring fidelity leaves it alone.
   */
  strayVolume: 'error' | 'currentDir' = 'error'

  /**
   * Where a path names a volume that is not mounted, before the answer is no.
   *
   * On the machine this is the one filesystem failure that ASKS. `Lock()` on
   * a path whose volume is absent does not fail: the handler puts a requester
   * up and the process sits in the call until the disk turns up or the user
   * cancels, and only then does `Lock()` answer. `pr_WindowPtr` of -1 turns
   * it off, which is what AMOS's `L_NoReq` writes and why `Exist` can ask
   * about a disk without stopping the program (`FnExist`,
   * ../runtime/instr.ts).
   *
   * Null is `pr_WindowPtr = -1`: no requester, the path simply does not
   * resolve. A hook that wants the caller to wait THROWS -- the interpreter's
   * block signal unwinds however deep the expression was -- and one that
   * returns normally leaves the answer null, which is a Cancel.
   *
   * The name is passed as the path spelled it, not lower-cased, because it is
   * going in front of a person.
   */
  missingVolume: ((name: string) => void) | null = null

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

  /**
   * Be told when a file appears or goes away.
   *
   * Returns its own unsubscribe, because a caller that stops caring has to be
   * able to say so without knowing what else is listening.
   *
   * A whole volume arriving is ONE event, with the volume root as its path.
   * Mounting an ADF makes several hundred files appear at once, and finding
   * out which would mean the walk a listener subscribed to avoid; the listener
   * knows the path ends in a colon and can decide for itself.
   */
  watch(fn: (e: FsEvent) => void): () => void {
    this.watchers.add(fn)
    return () => this.watchers.delete(fn)
  }

  /**
   * Tell the watchers, with the volume spelled the way it is mounted.
   *
   * The two write routes disagreed about case: a mounted volume reports under
   * the name it was mounted with, and the overlay is keyed by the lowercased
   * lookup key, so one file could arrive as `DH0:x` or `dh0:x` depending on
   * which door it came through. A listener keying a map on the path would
   * hold both and delete neither.
   */
  private emit(kind: 'add' | 'remove', path: string): void {
    const colon = path.indexOf(':')
    const vol = colon < 0 ? '' : path.slice(0, colon)
    const named = this.volumes.get(vol.toLowerCase())?.name
    const out = named === undefined ? path : named + path.slice(colon)
    for (const fn of this.watchers) fn({ kind, path: out })
  }

  /** `['DH0', 'Games', 'x.amos']` -> `DH0:Games/x.amos` */
  private static join(segs: readonly string[]): string {
    const [vol, ...rest] = segs
    return `${vol ?? ''}:${rest.join('/')}`
  }

  mount(name: string, vol: Volume): void {
    const bare = name.replace(/:$/, '')
    this.volumes.set(bare.toLowerCase(), { name: bare, vol })
    if (this.currentDir === '') this.currentDir = `${bare}:`
    // a writable volume reports its own traffic, which is the half `writeFile`
    // never sees. The segs it hands over are relative to the volume.
    if (vol instanceof MemoryVolume && vol !== this.overlay) {
      vol.onChange = (segs, kind) => this.emit(kind, AmigaFS.join([bare, ...segs]))
    }
    this.emit('add', `${bare}:`)
  }

  /** take a volume away, so a drive going empty is one event and not hundreds */
  unmount(name: string): boolean {
    const key = name.toLowerCase().replace(/:$/, '')
    const had = this.volumes.get(key)
    if (!had) return false
    if (had.vol instanceof MemoryVolume) had.vol.onChange = null
    this.volumes.delete(key)
    this.emit('remove', `${had.name}:`)
    return true
  }

  /** create an empty writable volume */
  mountMemory(name: string): MemoryVolume {
    const vol = new MemoryVolume()
    this.mount(name, vol)
    return vol
  }

  /**
   * `SYS:` with a `Libs` drawer in it, and `LIBS:` assigned to that drawer.
   *
   * A machine that answers `OpenLibrary("reqtools.library")` has to answer
   * `Exist("LIBS:reqtools.library")` as well, because that is how a program
   * asks whether the library is there before it uses it. AMOSPro_Delta's demo
   * is the case: `If Exist("libs:reqtools.library")` guards the requester and
   * the else arm says "Reqtools.library not found", which is what it said here
   * while `../amiga/reqtools.ts` sat underneath fully ported.
   *
   * DEVIATION: the files are EMPTY. What is modelled is a library, not a file
   * containing one, and no byte of the real thing is ours to invent -- so what
   * goes in `LIBS:` is a marker saying the machine has it. Anything that reads
   * one as data gets nothing, which is the honest answer to a question this
   * port cannot take seriously.
   *
   * `LIBS:` is an assign on a real machine and not a volume, so it is one
   * here: `Devices` lists SYS: and `Assigns` lists LIBS:, the way they do on
   * an Amiga rather than a made-up disk called LIBS.
   */
  mountSystem(names: readonly string[]): void {
    const found = this.volumeOf('sys')
    const sys = found instanceof MemoryVolume ? found : this.mountMemory('SYS')
    sys.mkdir(['Libs'])
    for (const name of names) sys.write(['Libs', name], new Uint8Array(0))
    this.assign('LIBS', 'SYS:Libs')
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
    const out: string[] = []
    // A name appears once. The same disk can be reachable as a mounted
    // volume AND as the label of the disk in a drive, which is the normal
    // state once a host mounts what it inserts; `entryOf` resolves the drive
    // either way, so the second listing was a duplicate row and nothing else.
    const seen = new Set<string>()
    const add = (name: string): void => {
      const key = name.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      out.push(name)
    }
    for (const v of this.volumes.values()) add(v.name)
    for (const d of this.drives) {
      const medium = d?.medium
      if (!d || !medium) continue
      add(`DF${d.unit}`)
      if (medium.label !== '') add(medium.label)
    }
    return out
  }

  /**
   * Devices that are handlers rather than filesystems.
   *
   * AmigaDOS keeps ONE device list and a handler sits in it beside the
   * drives: `SPEAK:` is `L:Speak-Handler` behind a Mountlist entry, not a
   * disc. It answers `Open` and nothing else --- no directory to list, no
   * file to stat --- so it is a name here rather than a Volume.
   *
   * Deliberately not part of `volumeNames`, which has a second job: three
   * places in the web page and the program index walk it to READ each volume,
   * and a device with no filesystem behind it has nothing for them. The
   * device list is the one caller that wants both, and it joins them itself.
   *
   * Only the handlers this port answers for. `SER:`, `PAR:` and `PRT:` are
   * reached through their own keywords rather than through `Open`, so naming
   * them would put devices in the list that `Open` would then refuse.
   */
  handlerNames(): string[] {
    return ['SPEAK']
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
    if (!vol) {
      // the path names a volume that is not here, which is the one failure
      // AmigaDOS asks about rather than reporting. The hook may throw.
      this.missingVolume?.(bm[1]!)
      return null
    }
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
   * The floppy drives, when this filesystem is attached to a machine.
   *
   * Empty for a filesystem with no machine behind it, which is most of them:
   * the CLI, the census and nearly every test mount a tree and never touch a
   * drive. See `driveOf` for what having them changes. A null is a unit with
   * no drive on its /SELn line, which is not the same as a drive with no disk
   * in it and matches nothing here either way.
   */
  drives: readonly (FloppyDrive | null)[] = []

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
    for (const d of this.drives) if (d && `df${d.unit}` === key && d.medium) return d
    for (const d of this.drives) {
      const label = d?.medium?.label.toLowerCase()
      if (d && label !== undefined && label !== '' && label === key) return d
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

  /**
   * What a LOCK on this volume answers with, which is never the device name.
   *
   * `entryOf` above echoes back the name a path was WRITTEN with, and that is
   * right for a path: `DF0:s/startup-sequence` prints as it was typed. A lock
   * is a different object. `AskDir2` (+B.s:1153) is `NameFromLock` written out
   * by hand -- walk `ParentDir` up until it answers 0, then come back down
   * `Examine`-ing each lock and appending `fib_FileName`, the first with a
   * `:` after it and the rest with `/`. `Examine` on a ROOT lock gives the
   * VOLUME's name, because a lock belongs to a volume and not to the DEVICE
   * node the caller happened to reach it through. There is no way to get
   * "DF0" back out of one.
   *
   * `Dir$ = path` and `Disc Info$` are the two that go through a lock:
   * `InDirD` (+Lib.s:4799) locks, Examines, calls `AskDir2` and copies THAT,
   * and `FnDiscInfo` (:4995) reads id_VolumeNode from the Info structure and
   * takes dl_Name off it at offset $28.
   *
   * A disk with no label has no VOLUME node to name, so the unit stands in.
   * They exist -- see the `label === ''` fallback in the web player's mount.
   */
  volumeNodeName(key: string): string | null {
    const drive = this.driveOf(key)
    const medium = drive?.medium
    if (drive && medium) return medium.label !== '' ? medium.label : `DF${drive.unit}`
    return this.volumes.get(key)?.name ?? null
  }

  /**
   * A resolved path spelled the way a lock on it would answer, not the way it
   * was typed. See `volumeNodeName`.
   */
  lockPath(r: ResolvedPath): string {
    const vol = this.volumeNodeName(r.volume)
    if (vol === null) return r.canonical
    return `${vol}:${r.segs.join('/')}`
  }

  /**
   * Is this name a volume at all? A drive with no disk in it is NOT.
   *
   * Public because `missingVolume` above hands a name to a host, and the host
   * has to be able to ask whether the disk has since turned up.
   */
  hasVolume(key: string): boolean {
    return this.volumeOf(key.toLowerCase()) !== null
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

  /**
   * Put a file INTO a mounted volume, rather than into the overlay.
   *
   * The difference from `writeFile` is where it lands, and both are wanted.
   * `writeFile` is what a running program does: every write in this filesystem
   * shadows the volume rather than modifying it, so an ADF is not edited under
   * a program's feet. This is a host FILLING a volume it created, which is a
   * different act --- an archive being unpacked into DH0: is that volume's
   * contents, not an overlay on top of nothing.
   *
   * It exists so that act goes through the filesystem too. Both callers used
   * to hold the `MemoryVolume` and write to it directly, which worked and left
   * two doors into one house: anything watching the filesystem saw a program's
   * writes and never saw the three hundred files a dropped archive brought.
   */
  writeTo(volume: string, segs: readonly string[], data: Uint8Array): boolean {
    const key = volume.toLowerCase().replace(/:$/, '')
    const target = this.volumes.get(key)?.vol
    if (!(target instanceof MemoryVolume)) return false
    if (this.protectedDisk(key)) return false
    // the event comes from the volume, which is what makes it unbypassable:
    // a caller that still reaches past this is seen anyway
    target.write([...segs], data)
    return true
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
   * Kill (InKill +Lib.s:4873) is AmigaDOS DeleteFile(), which takes a file
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
   * Rename (InRename +Lib.s:4886) is AmigaDOS Rename(), so it also *moves*
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

  /**
   * `Dir$ = path`, which stores what a LOCK says and not what was typed.
   *
   * `InDirD` (+Lib.s:4799) is `LockGet / Examine / AskDir2 / LockFree /
   * CopyPath`: the path it keeps is the one derived from the lock, so
   * `Dir$="Df0:"` leaves `Dir$` reading `AMOSPro_System:`. AMOS Pro's own
   * `Install.AMOS` turns that into a "which disc is in this drive" probe --
   * `_GET_DISC` walks DF0: to DF2:, assigns each to `Dir$` and compares the
   * result against `"AMOSPro_System:"` -- so echoing the device name back
   * made every drive the wrong disc and the installer asked for a disk that
   * was already in.
   */
  setCurrentDir(path: string): boolean {
    const r = this.resolve(path)
    if (!r || this.exists(path) !== 'dir') return false
    this.currentDir = this.lockPath(r)
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
 * Fs_Parent (+Lib.s:18297) walks back over a trailing '/' and then to the
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
 * in AMOS is `Joker` (+Lib.s:6602), which is neither this nor dos.library's
 * grammar — `*` stops at a dot, `?` will not match one, `/` separates
 * alternatives and `#` is an ordinary character. It is a Lib_Def routine in
 * AMOS's own main library, so it belongs on the AMOS side of the line:
 * ../runtime/joker.ts. `dospattern.ts` here stays what it always was, the
 * real ParsePattern/MatchPattern behind LDos's Lmatch and JD-K3's Jd Match.
 *
 * Being in this directory is part of what made the old one look like a
 * subset of dos.library rather than a different language.
 */
