/**
 * The Files panel: a drawer tree, and what is in the drawer you picked.
 *
 * It used to be one indented list built by hand in ../main.ts, with two-space
 * strings for depth and `ren` and `del` as bare links. That shape had a
 * ceiling: a row could say a name and a size and nothing else, and every
 * question a file manager asks about a file (what IS this, what is in it,
 * what does it look like) had nowhere to be answered.
 *
 * Two panes instead. The left is drawers only, which is the part that is a
 * tree. The right is one drawer's contents, which is a flat list, and a flat
 * list is exactly what ./list.ts renders: an icon, a name, what it is, a
 * badge, some buttons and a disclosure body. The other three tabs already
 * look like that, so the Files panel stops being the one that does not.
 *
 * The body is where the new answers go. A picture decodes into it, an archive
 * lists its members into it, a bank names its banks. None of that costs
 * anything until somebody opens the row, which matters because a mounted
 * AMOS Pro install is a few thousand files.
 *
 * ## What is not here
 *
 * Deciding what to DO with a file. `../library.ts` owns that and has since
 * the tab could run a program but not open the archive beside it. This panel
 * hands it bytes and a place they came from.
 */
import type { AmigaFS } from '../../amiga/vfs'
import { joinAmigaPath } from '../../amiga/vfs'
import { identify, type Kind, type KindGroup } from '../kinds'
import { writeZip, type ZipInput } from '../../amiga/zip'
import { readZipDirectory } from '../../amiga/zip'
import { readLhaHeaders } from '../../amiga/lha'
import { readTar } from '../../amiga/tar'
import { AdfVolume, isAdf } from '../../amiga/adf'
import { parseAmosFile } from '../../loader/amosfile'
import { civilFromStamp } from '../../amiga/datestamp'
import { createList, facts, type Action, type RowSpec } from './list'
import { popupMenu } from './menu'
import { baseName } from '../filemanager'
import { decodePicture } from '../picture'
import type { ModFormat } from '../../amiga/modformat'

export interface FilesOptions {
  vfs: AmigaFS
  /** give the machine a file: run it, mount it, unpack it. ../library.ts decides which */
  open(name: string, bytes: Uint8Array, at: { vol: string; dir: string[] }, drive?: number): void
  /** play a module, which stops whatever the machine is doing */
  play?(name: string, bytes: Uint8Array, format: ModFormat): void
  /** what is in each drive now, for the menu that offers them */
  drives(): readonly (string | null)[]
  onStatus(text: string): void
  /** rename, delete, new drawer, relabel: ../filemanager.ts through ../main.ts */
  ops: {
    rename(path: string): void
    remove(path: string, isDir: boolean): void
    newDrawer(dir: string): void
    relabel(vol: string): void
    move(from: string, into: string): void
  }
}

export interface FilesTab {
  /** rebuild from the filesystem; cheap enough to call on every tab switch */
  refresh(): void
  /** show this drawer, for a caller that has just mounted something */
  goTo(path: string): void
  /**
   * Is a row being dragged right now?
   *
   * The page listens for drops anywhere, because dropping a game on the
   * window is how most things get in. A drag that STARTED in here is a move
   * inside the filesystem and the page has to stand off it, or a file dragged
   * onto a drawer would also be uploaded to DH0:.
   */
  dragging(): boolean
}

/** 901120 -> "880K", the way a disk was always described */
function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} b`
  const k = bytes / 1024
  return k >= 1024 ? `${(k / 1024).toFixed(1)}M` : `${Math.round(k)}K`
}

/** one glyph per kind, in ./catalogue.ts's alphabet */
const ICONS: Readonly<Record<KindGroup, string>> = {
  drawer: '📁',
  program: '📜',
  disk: '💾',
  archive: '🗜️',
  packed: '🗜️',
  music: '🎵',
  picture: '🖼️',
  sound: '🔊',
  text: '📄',
  document: '📄',
  bank: '🧰',
  icon: '🔶',
  data: '⬜',
}

/**
 * `fib_Protection` as AmigaDOS prints it.
 *
 * The high nibble is active HIGH and the low nibble is active LOW, so a set
 * bit in the low half DENIES the permission. 0 is therefore `----rwed`, which
 * is why the default reads as full access rather than as none.
 */
function protectionText(bits: number): string {
  const high = 'hspa'
  const low = 'rwed'
  let out = ''
  for (let i = 0; i < 4; i++) out += bits & (0x80 >> i) ? high[i]! : '-'
  for (let i = 0; i < 4; i++) out += bits & (0x08 >> i) ? '-' : low[i]!
  return out
}

/** a DateStamp as a line, or '' for a file that has never had one set */
function dateText(m: { days: number; mins: number; ticks: number }): string {
  if (m.days === 0 && m.mins === 0 && m.ticks === 0) return ''
  const c = civilFromStamp(m.days, m.mins, m.ticks)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${c.year}-${two(c.month)}-${two(c.day)} ${two(c.hour)}:${two(c.min)}`
}

/** what is inside a container, without putting it into the machine */
function membersOf(kind: Kind, bytes: Uint8Array): { path: string; size: number }[] | null {
  if (kind.group === 'disk' && isAdf(bytes)) {
    const out: { path: string; size: number }[] = []
    const vol = new AdfVolume(bytes)
    const walk = (segs: string[], depth: number): void => {
      // deep enough for AMOSPro_Examples:Examples/H-2/, and a floor under a
      // damaged disk whose directory blocks point back at themselves
      if (depth > 6) return
      for (const e of vol.list(segs) ?? []) {
        const here = [...segs, e.name]
        if (e.isDir) walk(here, depth + 1)
        else out.push({ path: here.join('/'), size: e.size })
      }
    }
    walk([], 0)
    return out
  }
  if (kind.group === 'archive') {
    const lha = readLhaHeaders(bytes)
    if (lha.length > 0) return lha.map((h) => ({ path: h.path, size: h.size }))
    const zip = readZipDirectory(bytes)
    if (zip.length > 0) return zip.map((e) => ({ path: e.path, size: e.size }))
    const tar = readTar(bytes)
    if (tar.length > 0) return tar.map((e) => ({ path: e.path, size: e.data.length }))
    return []
  }
  if (kind.group === 'bank') {
    // A bank file's members are its banks, which is the same question one
    // level down: `Load "x.abk"` puts these in numbered slots.
    try {
      // A memory bank knows its own number and name; a sprite or icon bank is
      // identified by BEING one, because AMOS gives them fixed slots (`Sprite
      // Bank` is 1 and `Icon Bank` is 2) rather than storing a number.
      return parseAmosFile(bytes).banks.map((b) =>
        b.kind === 'memory'
          ? { path: `${b.number}: ${b.name.trim()}`, size: b.data.length }
          : { path: `${b.kind}, ${b.sprites.length} of them`, size: 0 },
      )
    } catch {
      return []
    }
  }
  return null
}

export function createFilesTab(host: HTMLElement, opts: FilesOptions): FilesTab {
  const { vfs } = opts

  const wrap = document.createElement('div')
  wrap.className = 'fm'
  const treeEl = document.createElement('nav')
  treeEl.className = 'fm-tree'
  const paneEl = document.createElement('div')
  paneEl.className = 'fm-pane'
  const crumbEl = document.createElement('div')
  crumbEl.className = 'fm-crumbs'
  const listEl = document.createElement('div')
  paneEl.append(crumbEl, listEl)
  wrap.append(treeEl, paneEl)
  host.textContent = ''
  host.appendChild(wrap)

  const list = createList(listEl)

  /** the drawer the right pane is showing */
  let cwd = ''
  /** drawers the reader has opened in the left tree */
  const openDirs = new Set<string>()
  /** the entry being dragged, so ../main.ts's page-wide drop handler stands off */
  let dragging: string | null = null

  /**
   * What each file turned out to be, keyed by path and size.
   *
   * `identify` wants the whole file and the pane redraws on every operation,
   * so without this a repaint of a mounted install reads every byte on the
   * volume. Size is in the key because a file written over is a different
   * file, and that is the one change a path alone cannot see.
   */
  const kinds = new Map<string, { size: number; kind: Kind }>()
  function kindOf(path: string, size: number, name: string): Kind {
    const had = kinds.get(path)
    if (had && had.size === size) return had.kind
    const kind = identify(name, vfs.read(path))
    kinds.set(path, { size, kind })
    return kind
  }

  /** `DH0:Games/Zybex` -> the volume and the segments under it */
  function split(path: string): { vol: string; dir: string[] } {
    const [vol = '', rest = ''] = path.split(':')
    return { vol, dir: rest.split('/').filter((s) => s !== '') }
  }

  /**
   * Hand the host a file.
   *
   * An anchor with `download` and an object URL, which is the only way a page
   * can put a file on the machine it is running on. The URL is revoked on the
   * next turn of the event loop rather than immediately: Firefox has not
   * started reading it when `click()` returns.
   */
  function save(name: string, bytes: Uint8Array, mime = 'application/octet-stream'): void {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    opts.onStatus(`saved ${name}, ${sizeText(bytes.length)}`)
  }

  /** every file under a drawer, as the zip writer wants them */
  function collect(dir: string, prefix: string, into: ZipInput[]): void {
    for (const e of vfs.listDir(dir) ?? []) {
      const full = joinAmigaPath(dir, e.name)
      if (e.isDir) {
        collect(full, `${prefix}${e.name}/`, into)
        continue
      }
      const data = vfs.read(full)
      if (data === null) continue
      const m = vfs.meta(full)
      into.push({ path: prefix + e.name, data, stamp: { days: m.days, mins: m.mins, ticks: m.ticks } })
    }
  }

  async function saveDrawer(path: string): Promise<void> {
    const name = baseName(path) || path.replace(/:$/, '')
    opts.onStatus(`packing ${name}…`)
    const files: ZipInput[] = []
    collect(path, '', files)
    save(`${name}.zip`, await writeZip(files), 'application/zip')
  }

  // ---- the left pane, which is drawers and nothing else ----

  function drawerLine(path: string, name: string, depth: number, isVolume: boolean): HTMLElement {
    const line = document.createElement('div')
    line.className = 'fm-node'
    if (path === cwd) line.classList.add('here')
    line.style.paddingLeft = `${depth * 0.85 + 0.2}rem`

    const kids = (vfs.listDir(path) ?? []).filter((e) => e.isDir)
    const twist = document.createElement('button')
    twist.type = 'button'
    twist.className = 'fm-twist'
    twist.textContent = kids.length === 0 ? '' : openDirs.has(path) ? '▾' : '▸'
    twist.addEventListener('click', (e) => {
      e.stopPropagation()
      if (kids.length === 0) return
      if (openDirs.has(path)) openDirs.delete(path)
      else openDirs.add(path)
      refresh()
    })

    const label = document.createElement('button')
    label.type = 'button'
    label.className = isVolume ? 'fm-vol' : 'fm-dir'
    label.textContent = isVolume ? path : name
    label.addEventListener('click', () => {
      cwd = path
      openDirs.add(path)
      refresh()
    })

    // a drawer takes a drop from the right pane, which is what moving is
    line.addEventListener('dragover', (e) => {
      if (dragging === null) return
      e.preventDefault()
      e.stopPropagation()
      line.classList.add('over')
    })
    line.addEventListener('dragleave', () => line.classList.remove('over'))
    line.addEventListener('drop', (e) => {
      line.classList.remove('over')
      if (dragging === null) return
      e.preventDefault()
      e.stopPropagation()
      const from = dragging
      dragging = null
      opts.ops.move(from, path)
    })

    line.append(twist, label)
    return line
  }

  function paintTree(): void {
    treeEl.textContent = ''
    const walk = (path: string, depth: number): void => {
      for (const e of (vfs.listDir(path) ?? []).filter((x) => x.isDir).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = joinAmigaPath(path, e.name)
        treeEl.appendChild(drawerLine(full, e.name, depth, false))
        if (openDirs.has(full)) walk(full, depth + 1)
      }
    }
    for (const vol of vfs.volumeNames()) {
      const root = `${vol}:`
      treeEl.appendChild(drawerLine(root, root, 0, true))
      if (openDirs.has(root)) walk(root, 1)
    }
  }

  // ---- the right pane ----

  function crumbs(): void {
    crumbEl.textContent = ''
    const { vol, dir } = split(cwd)
    if (vol === '') return
    const add = (text: string, path: string | null): void => {
      const el = document.createElement(path === null ? 'span' : 'button')
      el.textContent = text
      if (path !== null) {
        ;(el as HTMLButtonElement).type = 'button'
        el.addEventListener('click', () => {
          cwd = path
          refresh()
        })
      }
      crumbEl.appendChild(el)
    }
    add(`${vol}:`, dir.length === 0 ? null : `${vol}:`)
    dir.forEach((seg, i) => {
      const sep = document.createElement('span')
      sep.className = 'slash'
      sep.textContent = '/'
      sep.setAttribute('aria-hidden', 'true')
      crumbEl.appendChild(sep)
      add(seg, i === dir.length - 1 ? null : `${vol}:${dir.slice(0, i + 1).join('/')}`)
    })

    const actions = document.createElement('span')
    actions.className = 'fm-crumb-actions'
    const newer = document.createElement('button')
    newer.type = 'button'
    newer.className = 'act'
    newer.textContent = 'new drawer'
    newer.addEventListener('click', () => opts.ops.newDrawer(cwd))
    actions.appendChild(newer)
    const get = document.createElement('button')
    get.type = 'button'
    get.className = 'act'
    get.textContent = 'download'
    get.title = 'this drawer and everything under it, as a zip'
    get.addEventListener('click', () => void saveDrawer(cwd))
    actions.appendChild(get)
    if (dir.length === 0) {
      const label = document.createElement('button')
      label.type = 'button'
      label.className = 'act'
      label.textContent = 'relabel'
      label.addEventListener('click', () => opts.ops.relabel(vol))
      actions.appendChild(label)
    }
    crumbEl.appendChild(actions)
  }

  /** what a picture row shows when you open it */
  function pictureBody(body: HTMLElement, bytes: Uint8Array, kind: Kind): void {
    const pic = decodePicture(bytes, kind.name)
    if (pic === null) {
      body.appendChild(facts([['picture', `${kind.name}, which nothing here decodes yet`]]))
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = pic.width
    canvas.height = pic.height
    canvas.className = 'fm-shot'
    // A lowres Amiga pixel is twice as wide as it is tall. The picture is
    // drawn at its own size and stretched by CSS, so the pixels stay square
    // in the buffer and the browser does the doubling.
    canvas.style.aspectRatio = `${pic.width * (pic.wide ? 2 : 1)} / ${pic.height}`
    const cx = canvas.getContext('2d')
    if (cx) {
      const img = cx.createImageData(pic.width, pic.height)
      img.data.set(pic.pixels)
      cx.putImageData(img, 0, 0)
    }
    body.appendChild(canvas)
    body.appendChild(
      facts([
        ['size', `${pic.width} x ${pic.height}`],
        ['depth', pic.depth === 0 ? 'true colour' : `${pic.depth} planes, ${1 << pic.depth} colours`],
        ...(pic.mode === '' ? [] : ([['mode', pic.mode]] as [string, string][])),
      ]),
    )
  }

  /** what a container row shows when you open it */
  function membersBody(body: HTMLElement, members: { path: string; size: number }[]): void {
    if (members.length === 0) {
      body.appendChild(facts([['holds', 'nothing this can read']]))
      return
    }
    const table = document.createElement('div')
    table.className = 'fm-members'
    // A cap rather than the lot: an AMOS Pro disk holds hundreds and a
    // disclosure body is a peek, not a second file manager. The count says
    // what was left out rather than the list quietly stopping.
    const SHOWN = 100
    for (const m of members.slice(0, SHOWN)) {
      const row = document.createElement('div')
      const name = document.createElement('span')
      name.textContent = m.path
      const size = document.createElement('span')
      size.className = 'fm-member-size'
      size.textContent = m.size > 0 ? sizeText(m.size) : ''
      row.append(name, size)
      table.appendChild(row)
    }
    body.appendChild(
      facts([['holds', members.length === 1 ? '1 file' : `${members.length} files`]]),
    )
    body.appendChild(table)
    if (members.length > SHOWN) {
      const more = document.createElement('p')
      more.className = 'fm-more'
      more.textContent = `and ${members.length - SHOWN} more, which open it to see`
      body.appendChild(more)
    }
  }

  /** the first lines of a text file, which is what a text file has to show */
  function textBody(body: HTMLElement, bytes: Uint8Array): void {
    // Latin-1 and not UTF-8: a listing saved out of the AMOS editor is one
    // byte per character and the pound sign is $a3 in both AmigaDOS and
    // Latin-1, which UTF-8 would reject
    const text = new TextDecoder('latin1').decode(bytes.subarray(0, 4096))
    const pre = document.createElement('pre')
    pre.className = 'fm-text'
    pre.textContent = text
    body.appendChild(pre)
    if (bytes.length > 4096) {
      const more = document.createElement('p')
      more.className = 'fm-more'
      more.textContent = `first 4K of ${sizeText(bytes.length)}`
      body.appendChild(more)
    }
  }

  /** the drive menu, which only a disk image has anywhere to go in */
  function driveMenu(e: MouseEvent, name: string, bytes: Uint8Array, at: { vol: string; dir: string[] }): void {
    popupMenu(
      e.clientX,
      e.clientY,
      opts.drives().map((held, unit) => ({
        label: `Put in DF${unit}:`,
        detail: held ?? 'empty',
        run: () => opts.open(name, bytes, at, unit),
      })),
    )
  }

  function fileRow(name: string, size: number): RowSpec {
    const full = joinAmigaPath(cwd, name)
    const at = split(cwd)
    const kind = kindOf(full, size, name)
    const meta = vfs.meta(full)
    const when = dateText(meta)

    const actions: Action[] = []
    if (kind.openable) {
      actions.push({
        label: 'open',
        title: kind.group === 'disk' ? 'mount it' : kind.group === 'archive' ? 'unpack it' : 'run it',
        run: () => {
          const bytes = vfs.read(full)
          if (bytes) opts.open(name, bytes, at)
        },
      })
    }
    if (kind.group === 'music' && opts.play) {
      actions.push({
        label: '▶ play',
        title: `play it through this port's ${kind.name} replayer`,
        run: () => {
          const bytes = vfs.read(full)
          if (bytes && kind.format) opts.play?.(name, bytes, kind.format)
        },
      })
    }
    actions.push({
      label: 'get',
      title: 'save it on this computer',
      run: () => {
        const bytes = vfs.read(full)
        if (bytes) save(name, bytes)
      },
    })
    actions.push({ label: 'ren', title: 'rename', run: () => opts.ops.rename(full) })
    actions.push({ label: 'del', title: 'delete', run: () => opts.ops.remove(full, false) })

    const chips: NonNullable<RowSpec['chips']> = []
    if (kind.group === 'packed') chips.push({ text: 'packed', tone: 'warn', title: kind.name })

    // Which rows earn a body, and none of them reads a byte until it is opened
    const wants =
      kind.group === 'picture' || kind.container || kind.group === 'text' || kind.group === 'program'

    return {
      key: full,
      icon: ICONS[kind.group],
      label: name,
      detail: [kind.name, sizeText(size), when].filter((s) => s !== '').join(' · '),
      chips,
      actions,
      mount: (rowEl) => {
        rowEl.draggable = true
        rowEl.addEventListener('dragstart', (e) => {
          dragging = full
          e.dataTransfer?.setData('application/x-amos-path', full)
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
        })
        rowEl.addEventListener('dragend', () => (dragging = null))
        if (kind.group === 'disk') {
          rowEl.addEventListener('contextmenu', (ev) => {
            ev.preventDefault()
            const bytes = vfs.read(full)
            if (bytes) driveMenu(ev, name, bytes, at)
          })
        }
      },
      ...(wants
        ? {
            body: (bodyEl: HTMLElement): void => {
              const bytes = vfs.read(full)
              if (bytes === null) {
                bodyEl.appendChild(facts([['gone', 'this file is no longer there']]))
                return
              }
              const note = meta.comment.trim()
              if (note !== '') bodyEl.appendChild(facts([['comment', note]]))
              if (kind.group === 'picture') return pictureBody(bodyEl, bytes, kind)
              if (kind.container) {
                const members = membersOf(kind, bytes)
                if (members !== null) return membersBody(bodyEl, members)
              }
              if (kind.group === 'text' || kind.group === 'program') return textBody(bodyEl, bytes)
              bodyEl.appendChild(facts([['protection', protectionText(meta.protection)]]))
            },
          }
        : {}),
    }
  }

  function drawerRow(name: string): RowSpec {
    const full = joinAmigaPath(cwd, name)
    const inside = vfs.listDir(full) ?? []
    return {
      key: full,
      icon: ICONS.drawer,
      label: name,
      detail: inside.length === 1 ? '1 item' : `${inside.length} items`,
      go: () => {
        cwd = full
        openDirs.add(full)
        refresh()
      },
      actions: [
        { label: 'get', title: 'this drawer, as a zip', run: () => void saveDrawer(full) },
        { label: 'ren', title: 'rename', run: () => opts.ops.rename(full) },
        { label: 'del', title: 'delete', run: () => opts.ops.remove(full, true) },
      ],
      mount: (rowEl) => {
        rowEl.draggable = true
        rowEl.addEventListener('dragstart', (e) => {
          dragging = full
          e.dataTransfer?.setData('application/x-amos-path', full)
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
        })
        rowEl.addEventListener('dragend', () => (dragging = null))
        rowEl.addEventListener('dragover', (e) => {
          if (dragging === null || dragging === full) return
          e.preventDefault()
          e.stopPropagation()
          rowEl.classList.add('over')
        })
        rowEl.addEventListener('dragleave', () => rowEl.classList.remove('over'))
        rowEl.addEventListener('drop', (e) => {
          rowEl.classList.remove('over')
          if (dragging === null) return
          e.preventDefault()
          e.stopPropagation()
          const from = dragging
          dragging = null
          opts.ops.move(from, full)
        })
      },
    }
  }

  function paintPane(): void {
    crumbs()
    const entries = vfs.listDir(cwd) ?? []
    entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
    list.render(entries.map((e) => (e.isDir ? drawerRow(e.name) : fileRow(e.name, e.size))))
    if (entries.length === 0) {
      const p = document.createElement('p')
      p.className = 'fm-empty'
      p.textContent = cwd === '' ? 'nothing is mounted' : 'this drawer is empty'
      listEl.appendChild(p)
    }
  }

  function refresh(): void {
    // A volume that has gone takes the current directory with it, and the
    // first mounted one is where a panel with nowhere to be belongs
    const vols = vfs.volumeNames()
    if (cwd === '' || vfs.exists(cwd) !== 'dir') {
      cwd = vols.length > 0 ? `${vols[0]}:` : ''
    }
    for (const v of vols) openDirs.add(`${v}:`)
    for (const p of [...openDirs]) if (vfs.exists(p) !== 'dir') openDirs.delete(p)
    paintTree()
    paintPane()
  }

  return {
    refresh,
    dragging: (): boolean => dragging !== null,
    goTo(path: string): void {
      const dir = vfs.exists(path) === 'dir' ? path : path.replace(/[^:/]*$/, '').replace(/\/$/, '')
      if (vfs.exists(dir) === 'dir') {
        cwd = dir
        openDirs.add(dir)
      }
      refresh()
    },
  }
}
