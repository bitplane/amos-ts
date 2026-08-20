/**
 * Browser runner: load a .AMOS file (or plain-text listing), run it on the
 * Runtime at 50 frames a second, composite to a canvas, feed it keys and
 * mouse. `npm run dev` and open the page.
 *
 * The page is four tabs over one machine. Panels are built once and hidden,
 * never unmounted, because a program keeps running while you are looking at
 * something else — see ./ui/tabs.ts.
 */
import { createPlayer, isAmosProgram, VERSION, type JoyKeys, type PortSource } from './player'
import { baseName, deleteEntry, moveEntry, newDrawer, relabelVolume, renameEntry, type FsResult } from './filemanager'
import type { AmigaAudioModel } from '../amiga/mixer'
/**
 * The browser's pad string, trimmed to something that fits a row.
 *
 * Chrome hands back "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e
 * Product: 0b13)" and Firefox uses a different shape entirely, so the vendor
 * and product ids come off and the rest is left alone. Trimming rather than
 * matching, because a table of known pads would be wrong for the next one.
 */
function shortPadName(id: string): string {
  const trimmed = id.replace(/\s*\((?:STANDARD GAMEPAD\s*)?Vendor:.*?\)\s*$/i, '').trim()
  return trimmed === '' ? id : trimmed
}

import { isAdf } from '../amiga/adf'
import { Keyboard } from '../amiga/keyboard'
import { Mouse } from '../amiga/mouse'
import { mountTabs } from './ui/tabs'
import { createStrip } from './ui/strip'
import { createHardwareTab } from './ui/hardware'
import type { InputSource } from './ui/catalogue'
import { createExtensionsTab } from './ui/extensions'
import { createProgramIndex } from './ui/programs'
import { createLibsTab } from './ui/libs'
import { createBrowseTab } from './ui/browse'
import { createLibraryLoader, type OpenSource } from './library'
import { popupMenu } from './ui/menu'

const fileEl = document.getElementById('file') as HTMLInputElement

// Which build the page is running. Small and out of the way, but it is the
// only thing that distinguishes a fresh deploy from a CDN still handing out
// the previous /v/latest/ bundle. See src/version.ts.
document.getElementById('version')!.textContent = `v${VERSION}`

// The strip is built from the machine, which the player owns, so it cannot
// exist before the player does. Status messages emitted during construction
// are held rather than dropped.
let statusEl: HTMLElement | null = null
let held = ''
function setStatus(text: string): void {
  held = text
  if (statusEl) statusEl.textContent = text
}

// The standalone page is a thin host over the same player the site publishes:
// it adds a file picker, drag-and-drop, a filesystem panel and the joystick
// dropdowns, and the player itself is exactly what an embedder gets.
const player = createPlayer(document.getElementById('player')!, {
  autoplay: true,
  onStatus: setStatus,
  onError: (m) => setStatus(`error: ${m}`),
})
const vfs = player.vfs

// Under `npm run dev` only: a handle on the player from the console and from
// a browser-driving script. Browser bugs need a browser, and the alternative
// is reading pixels off the canvas and guessing which statement drew them.
if (import.meta.env.DEV) (globalThis as unknown as { amos: unknown }).amos = player

const DEMO = `Curs Off : Cls 0
For C=1 To 15
   Ink C : Circle 160,100,C*6
Next
Pen 2 : Paper 0
Locate 0,1 : Centre "amos-ts"
Locate 0,23 : Centre "drop a .AMOS file above"
Do
   For C=1 To 15
      Colour C,Rnd($FFF)
   Next
   Wait 10
Loop`

/**
 * A dropped archive goes through the player, which mounts it, finds the
 * program and makes its drawer the current directory. Here we only report it
 * and refresh the panel.
 */
async function mountArchive(bytes: Uint8Array, name: string): Promise<void> {
  await player.loadArchive(bytes, name)
  detectAmosInstall()
}

/**
 * A real AMOS Pro install creates assigns like AMOSPro_Accessories: for
 * every drawer next to APSystem — accessories load their data through
 * them (e.g. the Help reader opens AMOSPro_Accessories:AMOSPro_Help/...).
 * If a dropped tree contains an APSystem/APSystemAGA drawer, treat its
 * parent as the install root, create the standard assigns and pick up the
 * default resource bank from the install itself.
 */
function detectAmosInstall(): void {
  const join = (base: string, name: string): string => (base.endsWith(':') ? base + name : base + '/' + name)
  const findRoot = (dir: string, depth: number): { dir: string; sys: string } | null => {
    const entries = (vfs.listDir(dir) ?? []).filter((e) => e.isDir)
    const sys = entries.find((e) => /^APSystem(AGA)?$/i.test(e.name))
    if (sys) return { dir, sys: sys.name }
    if (depth >= 2) return null
    for (const e of entries) {
      const r = findRoot(join(dir, e.name), depth + 1)
      if (r) return r
    }
    return null
  }
  // every mounted volume, because a dropped drawer is now a volume of its own
  // and an install dropped whole is no longer under DH0:
  let root: { dir: string; sys: string } | null = null
  for (const vol of vfs.volumeNames()) {
    root = findRoot(`${vol}:`, 0)
    if (root) break
  }
  if (!root) return
  /*
   * An assign must never shadow a real volume of the same name.
   *
   * `resolve` expands assigns BEFORE volumes, so assigning AMOSPro_System to
   * `AMOSPro_System:APSystem` makes the name refer to a path beginning with
   * itself, and the expansion spins until the cycle guard stops it. Every
   * path on the disk then reads as missing, which looks like an empty disk
   * rather than a broken assign: mounting the real AMOS Pro System floppy
   * left the whole thing unreadable and reported "holds no AMOS program".
   *
   * These assigns are what a HARD DISK install has, where the drawer sits
   * under DH0: and nothing is called AMOSPro_System. Off the floppies the
   * labels already ARE the names, so there is nothing to add.
   */
  const volumes = new Set(vfs.volumeNames().map((v) => v.toLowerCase()))
  const assign = (name: string, target: string): void => {
    if (!volumes.has(name.toLowerCase())) vfs.assign(name, target)
  }
  assign('AMOSPro', root.dir)
  assign('AMOSPro_System', join(root.dir, root.sys))
  for (const e of (vfs.listDir(root.dir) ?? []).filter((x) => x.isDir)) {
    assign(`AMOSPro_${e.name}`, join(root.dir, e.name))
    assign(e.name, join(root.dir, e.name))
  }
  const res = vfs.read(join(join(root.dir, root.sys), 'AMOSPro_Default_Resource.Abk'))
  if (res) player.setSystemResource(res)
  setStatus(`AMOS Pro install detected at ${root.dir}, assigns created`)
}

/** a dropped drawer named "fonts" becomes the FONTS: assign AvailFonts
 * scans — real Amiga diskfonts render Text/menus with true metrics */
/**
 * FONTS: points at the RUNNING PROGRAM's own drawer first.
 *
 * Every Amiga game assigns it from its own startup-sequence, so a disk with
 * a `fonts` drawer means that disk's fonts. Taking whichever mounted volume
 * happened to be scanned first gave Demolition Mission — seven faces of its
 * own, `Set Font 3/4/5/7` down its title screen — the fonts of an unrelated
 * game somebody had opened earlier in the session.
 */
function detectFontsDrawer(): void {
  const findFonts = (dir: string, depth: number): string | null => {
    const entries = (vfs.listDir(dir) ?? []).filter((e) => e.isDir)
    const hit = entries.find((e) => e.name.toLowerCase() === 'fonts')
    if (hit) return dir.endsWith(':') ? dir + hit.name : dir + '/' + hit.name
    if (depth >= 2) return null
    for (const e of entries) {
      const r = findFonts(dir.endsWith(':') ? dir + e.name : dir + '/' + e.name, depth + 1)
      if (r) return r
    }
    return null
  }
  const here = vfs.currentDir.split(':')[0] ?? ''
  const names = vfs.volumeNames()
  const order = here === '' ? names : [here, ...names.filter((v) => v.toLowerCase() !== here.toLowerCase())]
  let found: string | null = null
  for (const vol of order) {
    found = findFonts(`${vol}:`, 0)
    if (found) break
  }
  if (found) {
    vfs.assign('Fonts', found)
    const rt = player.runtime
    if (rt) rt.discFontCache = null
  }
}
// The AMOS Pro resource bank (dialogs, Fsel$) is part of the machine but is not
// ours to ship, so it is picked up from fixtures/ when running locally. It is
// never deployed, so on the public site this fetch was a guaranteed 404 in the
// console of every page load — noise that trains people to ignore the console.
// import.meta.env.DEV is the dev-server-only guard.
if (import.meta.env.DEV) {
  void fetch('fixtures/official-amos/APSystem/AMOSPro_Default_Resource.Abk')
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((buf) => {
      if (buf) player.setSystemResource(new Uint8Array(buf))
    })
    .catch(() => {})
}

/**
 * Take one incoming file (picker or drop). `dir` is the relative folder
 * path inside DH0: (from folder drops), so a dropped game directory keeps
 * its layout and relative loads work. Auto-runs a .AMOS only when asked.
 */
async function receiveFile(
  name: string,
  bytes: Uint8Array,
  dir: string[],
  autoRun: boolean,
  vol = 'DH0',
): Promise<void> {
  if (/\.(zip|tar|gz|tgz|adf)$/i.test(name)) {
    await mountArchive(bytes, name)
  } else {
    vfs.writeTo(vol, [...dir, name], bytes)
    setStatus(`stored ${vol}:${[...dir, name].join('/')}`)
    if (autoRun && /\.amos$/i.test(name)) {
      vfs.currentDir = dir.length > 0 ? `${vol}:${dir.join('/')}` : `${vol}:`
      player.loadProgram(bytes, name, dir, vol)
      detectFontsDrawer()
    }
  }
  refreshFiles()
}

/**
 * A dropped DRAWER becomes a volume of its own name.
 *
 * Which is what it is. `AMOSPro_Examples/Examples/H-2/Help_26.AMOS` opens with
 * `Load "AMOSPro_Examples:OBJECTS/BOBS.abk"`, and an Amiga program says
 * `Volume:` because that is how it reaches its own data --- the name is part
 * of the path the author wrote, not an accident of where somebody filed it.
 *
 * Flattening every drop into DH0: made that path resolve to nothing, so the
 * bank never loaded and the program ran on with no images. Nothing errored:
 * `Load` of a missing file is not fatal, so the screen just came up empty,
 * which is the worst kind of wrong.
 *
 * Only the TOP level becomes a volume. Drawers inside it are drawers.
 */
function volumeNameFor(name: string): string {
  // AmigaDOS volume names take spaces and most punctuation; a colon and a
  // slash are the two that would re-split the path this is used to build
  const clean = name.replace(/[:/]/g, '_').trim()
  return clean === '' ? 'DH0' : clean
}

fileEl.addEventListener('change', () => {
  for (const f of Array.from(fileEl.files ?? [])) {
    void f.arrayBuffer().then((buf: ArrayBuffer) => receiveFile(f.name, new Uint8Array(buf), [], true))
  }
})
// The emulator bar is gone. Everything that was on it belongs to something
// the page already lists: restart is the power light, turbo is a mode of the
// CPU, the serial grant is what you attach to the serial port, and the file
// picker sits with the filesystem.

// ---- drag and drop (files, folders, zips) ----

async function dropEntry(
  entry: FileSystemEntry,
  dir: string[],
  single: boolean,
  vol = 'DH0',
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
    await receiveFile(entry.name, new Uint8Array(await file.arrayBuffer()), dir, single, vol)
  } else if (entry.isDirectory) {
    // the outermost drawer of a drop is a volume; everything below it is a
    // path inside that volume
    const own = dir.length === 0 && vol === 'DH0' ? volumeNameFor(entry.name) : vol
    const under = own === vol ? [...dir, entry.name] : dir
    if (own !== vol) vfs.mountMemory(own)
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // readEntries returns batches of <=100 until empty
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
      if (batch.length === 0) break
      for (const e of batch) await dropEntry(e, under, false, own)
    }
  }
}

// these are for files arriving from the desktop; a drag that started inside
// the Files panel is a move, and the panel's own rows handle it
document.addEventListener('dragover', (e) => {
  if (dragging !== null) return
  e.preventDefault()
  document.body.classList.add('dragging')
})
document.addEventListener('dragleave', (e) => {
  if (e.target === document.body || (e as DragEvent).relatedTarget === null) document.body.classList.remove('dragging')
})
document.addEventListener('drop', (e) => {
  document.body.classList.remove('dragging')
  if (dragging !== null) return
  e.preventDefault()
  const items = Array.from(e.dataTransfer?.items ?? [])
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => x != null)
  const single = entries.length === 1 && entries[0]!.isFile
  void (async () => {
    for (const entry of entries) await dropEntry(entry, [], single)
    // a folder drop doesn't auto-run, so show the tree and say why
    if (!single && entries.length > 0) {
      detectAmosInstall()
      detectFontsDrawer()
      tabs.select('files')
      refreshFiles()
      setStatus(`${held}. Pick a .AMOS in the tree to run it`)
    }
  })()
})

// ---- the file manager panel ----

const filesPanel = document.getElementById('panel-files')!
const fstreeEl = document.getElementById('fstree')!

/**
 * Can this entry be clicked?
 *
 * Anything ./library.ts can open, which is anything the player can: a
 * program, a floppy image, or an archive. The tree used to offer only
 * programs, so an .lha sitting in a drawer was inert while the very same
 * file, dropped on the window, mounted fine. Same rule everywhere now, and
 * the rule lives in one place.
 *
 * By header OR by name, because a plain-text listing has no header to
 * identify it and a tokenised program may have no extension.
 */
const OPENABLE = /\.(amos|adf|lha|lzh|zip|tar|tar\.gz|tgz)$/i
function isOpenable(name: string, bytes: Uint8Array | null): boolean {
  if (bytes === null || bytes.length === 0) return false
  return isAmosProgram(bytes) || isAdf(bytes) || OPENABLE.test(name)
}

/** directories the user has expanded; volumes default open, subdirs closed */
const openDirs = new Set<string>()

/** the entry being dragged inside the tree — set while a move is in flight
 * so the page-wide file-drop handling stays out of the way */
let dragging: string | null = null
const DRAG_TYPE = 'application/x-amos-path'

/** report an operation and redraw; expanded paths that no longer exist
 * (renamed, moved, deleted) drop out of the open set here */
function applied(r: FsResult): void {
  setStatus(r.message)
  for (const p of [...openDirs]) if (vfs.exists(p) !== 'dir') openDirs.delete(p)
  refreshFiles()
}

const askRename = (path: string): void => {
  const to = prompt(`Rename ${baseName(path)} to:`, baseName(path))
  if (to !== null) applied(renameEntry(vfs, path, to))
}
const askDelete = (path: string, isDir: boolean): void => {
  const inside = isDir ? (vfs.listDir(path) ?? []).length : 0
  const what = baseName(path)
  if (confirm(inside > 0 ? `Delete ${what} and the ${inside} item(s) in it?` : `Delete ${what}?`)) {
    applied(deleteEntry(vfs, path, inside > 0))
  }
}
const askNewDrawer = (dir: string): void => {
  const name = prompt(`New drawer in ${dir}`, 'New')
  if (name !== null) applied(newDrawer(vfs, dir, name))
}
const askRelabel = (vol: string): void => {
  const to = prompt(`Rename the volume ${vol}: to:`, vol)
  if (to !== null) applied(relabelVolume(vfs, vol, to))
}

interface RowOptions {
  cls?: string
  onClick?: (() => void) | undefined
  /** this row can be dragged elsewhere */
  drag?: string
  /** this row accepts a drop, moving the dragged entry into this drawer */
  drop?: string
  /** right-click on the row */
  menu?: (e: MouseEvent) => void
  actions?: [label: string, title: string, run: () => void][]
}

function refreshFiles(): void {
  // the tree is rebuilt from the filesystem, so there is no point doing it for
  // a panel nobody is looking at; the tab's show() catches up on the way in
  if (filesPanel.hidden) return
  fstreeEl.textContent = ''
  const addLine = (depth: number, text: string, o: RowOptions = {}): void => {
    const line = document.createElement('div')
    line.appendChild(document.createTextNode('  '.repeat(depth)))
    const el: HTMLElement = document.createElement(o.onClick ? 'a' : 'span')
    el.textContent = text
    if (o.cls) el.className = o.cls
    if (o.onClick) el.addEventListener('click', o.onClick)
    if (o.menu) {
      const menu = o.menu
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        menu(e)
      })
    }
    if (o.drag !== undefined) {
      const from = o.drag
      el.draggable = true
      el.addEventListener('dragstart', (e) => {
        dragging = from
        e.dataTransfer?.setData(DRAG_TYPE, from)
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
      })
      el.addEventListener('dragend', () => (dragging = null))
    }
    line.appendChild(el)
    for (const [label, title, run] of o.actions ?? []) {
      const b = document.createElement('a')
      b.className = 'act'
      b.textContent = label
      b.title = title
      b.addEventListener('click', run)
      line.appendChild(b)
    }
    if (o.drop !== undefined) {
      const into = o.drop
      // only our own rows: a file dragged in from the desktop still goes to
      // the page-wide handler that uploads it
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
        applied(moveEntry(vfs, from, into))
      })
    }
    fstreeEl.appendChild(line)
  }
  const walk = (base: string, dir: string[], depth: number): void => {
    const path = base + dir.join('/')
    const entries = vfs.listDir(path) ?? []
    entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
    for (const e of entries) {
      const full = base + [...dir, e.name].join('/')
      if (e.isDir) {
        const open = openDirs.has(full)
        addLine(depth, `${open ? '▾' : '▸'} ${e.name}/`, {
          cls: 'dir',
          onClick: () => {
            if (open) openDirs.delete(full)
            else openDirs.add(full)
            refreshFiles()
          },
          drag: full,
          drop: full,
          actions: [
            ['+', 'new drawer inside', () => askNewDrawer(full)],
            ['ren', 'rename', () => askRename(full)],
            ['del', 'delete', () => askDelete(full, true)],
          ],
        })
        if (open) walk(base, [...dir, e.name], depth + 1)
      } else {
        const openable = isOpenable(e.name, vfs.read(full))
        addLine(depth, openable ? e.name : `${e.name}  (${e.size})`, {
          onClick: openable
            ? () => {
                const bytes = vfs.read(full)
                if (!bytes) return
                /*
                 * `at` is the half that used to be missing. `loadProgram`
                 * defaults to DH0:, and every drop landed a copy there as
                 * well, so the wrong answer happened to work. A library disk
                 * is mounted as a floppy and copied nowhere, so the same
                 * click set the current directory to a path on a volume the
                 * program is not on. Nothing errored: relative loads simply
                 * found nothing, which is what `Td Load "car1"` reports as
                 * "Object file not found".
                 *
                 * It also decides what a leading colon means. `:` is the
                 * root of the CURRENT VOLUME, and the AMOS 3D demos are
                 * written that way throughout.
                 */
                void openThing({ name: e.name, bytes, at: { vol: base.slice(0, -1), dir } })
              }
            : undefined,
          menu: (ev) => {
            // only a disk image has a drive to go in; an archive has no
            // label and no filesystem of its own
            const bytes = vfs.read(full)
            if (!bytes || !isAdf(bytes)) return
            popupMenu(
              ev.clientX,
              ev.clientY,
              player.machine.drives.map((d, unit) => ({
                label: `Put in DF${unit}:`,
                detail: d?.medium?.label || (d?.medium ? '(no label)' : 'empty'),
                run: () => void openThing({ name: e.name, bytes, at: { vol: base.slice(0, -1), dir }, drive: unit }),
              })),
            )
          },
          drag: full,
          actions: [
            ['ren', 'rename', () => askRename(full)],
            ['del', 'delete', () => askDelete(full, false)],
          ],
        })
      }
    }
  }
  for (const vol of vfs.volumeNames()) {
    const root = vol + ':'
    openDirs.add(root) // volumes always expanded
    addLine(0, root, {
      cls: 'vol',
      drop: root,
      actions: [
        ['+', 'new drawer inside', () => askNewDrawer(root)],
        ['ren', 'rename this volume', () => askRelabel(vol)],
      ],
    })
    walk(root, [], 1)
  }
}

// ---- the half of the hardware that is the browser's ----
// The gameport mappings and the Web Serial grant both live here rather than on
// the machine, and both are chosen on the hardware tab now, on the row they
// apply to. The player has setters and no getters, so the current state is
// remembered alongside.
const joyKeys: Record<0 | 1, JoyKeys> = { 0: 'none', 1: 'none' }
const host = {
  keys: (port: 0 | 1): JoyKeys => joyKeys[port],
  setKeys: (port: 0 | 1, keys: JoyKeys): void => {
    joyKeys[port] = keys
    player.setJoystick(port, keys)
  },
  // What can drive a gameport in a browser: the keyboard, and every pad the
  // Gamepad API can see, named by the string it gives us. An empty pad list is
  // a real answer and the row says so rather than offering "gamepad" whether
  // or not one is plugged in, which is the state that used to be invisible.
  sources: (): InputSource[] => [
    { id: 'keyboard', label: 'keyboard', make: () => ({ kind: 'keyboard' }) },
    ...player.gamepads().map((pad) => ({
      id: `pad:${pad.index}`,
      label: shortPadName(pad.id),
      make: (): PortSource => ({ kind: 'gamepad', index: pad.index }),
    })),
  ],
  sourceOf: (port: 0 | 1): string => {
    const src = player.portSource(port)
    return src.kind === 'keyboard' ? 'keyboard' : `pad:${src.index}`
  },
  setSource: (port: 0 | 1, source: InputSource): void => {
    const chosen = source.make()
    player.setPortSource(port, chosen)
    // a port moving to a pad gives its keys back, or the arrows would go on
    // driving a stick nobody is looking at
    if (chosen.kind === 'keyboard') {
      if (player.portSource(port).kind === 'keyboard' && joyKeys[port] === 'none') {
        joyKeys[port] = port === 0 ? 'arrows' : 'wasd'
      }
      player.setJoystick(port, joyKeys[port])
      player.setPortSource(port, chosen)
    } else {
      joyKeys[port] = 'none'
    }
  },
  serialSupported: player.serialSupported,
  requestSerial: (): void => {
    void player.requestSerialPort().then((ok) => {
      setStatus(ok ? 'serial port granted' : 'no serial port granted')
    })
  },
  setIgnoreClock: (on: boolean): void => player.setTurbo(on),
  setAudioModel: (model: AmigaAudioModel): void => player.setAudioModel(model),
  // The chip keeps its own wall time as an offset from the host's, so reading
  // it is the host clock plus that skew. A DateStamp is wall time with no
  // zone and so is this, which is why both ends work in UTC.
  clockTime: (): Date | null => player.clockTime(),
  setClockTime: (when: Date): void => player.setClockTime(when),
}

// Both ports come up as keyboard sticks, so a program that polls a joystick
// finds one whichever it asks for: `Joy(1)` is what nearly every game reads
// and `Joy(0)` is what the rest do, and there is no way to know which from
// here. They take DIFFERENT keys, or one keyboard standing in for two sticks
// would move both at once and a two-player game would be unplayable.
//
// The cost of the default is real and known --- a program that reads the
// keyboard AND polls a stick sees one keypress twice --- and the way out is
// the hardware tab, where a port can be a gamepad stick or nothing at all.
host.setKeys(0, 'arrows')
host.setKeys(1, 'wasd')

// The machine boots with a generic keyboard and mouse, because `src/amiga` has
// no idea what is supplying them. This page does: it is a browser, so it says
// so, and the hardware rows stop reading "keyboard" in a row already labelled
// keyboard.
player.machine.attach('keyboard', new Keyboard('browser'))
player.machine.attach('mouse', new Mouse('browser'))

// ---- the library ----
/**
 * Disks published to /library/, which is a different repository and a
 * different job: bitplane/amos-library pushes them and their index, and a
 * release of the player never touches them.
 *
 * The rules for putting one in the machine are in ./library.ts. What is left
 * here is what only a page can do: say what happened, and decide which tab
 * you end up looking at.
 */
const loader = createLibraryLoader({
  vfs,
  drives: player.machine.drives,
  loadProgram: (bytes, name, dir, vol) => {
    // after, not before: loadProgram is what makes the program's own drawer
    // current, and that is where the fonts search starts
    player.loadProgram(bytes, name, dir, vol)
    detectFontsDrawer()
  },
  loadArchive: (bytes, name) => player.loadArchive(bytes, name),
  mounted: () => {
    detectAmosInstall()
    detectFontsDrawer()
  },
})

/**
 * Open one thing and say what happened.
 *
 * The only part of this a page owns: which tab you end up looking at, and
 * what the status line says. Everything about WHAT to do with the bytes is
 * ./library.ts, and both the tree and the Browse tab come through here.
 */
async function openThing(src: OpenSource): Promise<void> {
  const r = await loader.open(src)
  if (r.ran !== null) {
    tabs.select('play')
    return
  }
  // Nothing to start. A system disk is not a game and this port has no
  // AmigaDOS to boot one, so say what arrived and show it, rather than
  // handing over to a canvas still running whatever was there before.
  const where = r.volume === null ? src.name : `${r.volume}:`
  setStatus(
    r.programs.length === 0
      ? `${where} is in, and holds no AMOS program`
      : `${where} is in, ${r.programs.length} programs, pick one`,
  )
  tabs.select('files')
  refreshFiles()
}

const browse = createBrowseTab({
  onStatus: setStatus,
  onOpen: (item, bytes, drive) =>
    openThing({ name: item.disk.path.split('/').pop() ?? item.name, bytes, ...(drive === undefined ? {} : { drive }) }),
  drives: () => player.machine.drives.map((d) => d?.medium?.label || (d?.medium ? '(no label)' : null)),
})
document.getElementById('panels')!.append(browse.panel)

// ---- the tabs ----
// Built last, because the strip and the hardware panel read the machine and
// the machine belongs to the player.

const strip = createStrip(player.machine, {
  isRunning: () => player.isRunning(),
  programName: () => player.programName,
  onReset: () => {
    player.restart()
    setStatus(`reset ${player.programName}`)
    tabs.select('play')
  },
})
document.getElementById('strip-host')!.appendChild(strip.root)
statusEl = strip.status
statusEl.textContent = held

const hardware = createHardwareTab(player.machine, host)

// Reads every .AMOS the filesystem gains and works out which extensions it
// uses, so each extension row lists real programs that exercise it. Driven by
// `AmigaFS.watch`, so dropping an archive costs one parse per program and
// looking at the tab costs none.
const programs = createProgramIndex(vfs)
const extensions = createExtensionsTab(programs, (path) => {
  const bytes = vfs.read(path)
  if (!bytes) return
  const segs = path.split(':')[1]?.split('/') ?? []
  player.loadProgram(bytes, segs[segs.length - 1] ?? path, segs.slice(0, -1))
  detectFontsDrawer()
  tabs.select('play')
})
const libs = createLibsTab()
document.getElementById('panels')!.append(hardware.panel, extensions.panel, libs.panel)

const tabs = mountTabs(document.getElementById('tabbar')!, [
  // Browse first, so it is what the page opens on: a visitor with no .AMOS
  // file of their own has something to run in one click. `mountTabs` takes
  // the first tab as the default and the URL fragment overrides it, so
  // #play still lands on the player.
  { id: 'browse', label: 'Browse', panel: browse.panel, show: () => browse.show() },
  {
    id: 'play',
    label: 'Play',
    panel: document.getElementById('panel-emulator')!,
    // the key handlers live on the player element and need focus, so a tab
    // switch that did not take it left the arrows scrolling the page while a
    // keyboard joystick sat there doing nothing
    show: () => player.focus(),
  },
  { id: 'hardware', label: 'Hardware', panel: hardware.panel, frame: hardware.frame },
  { id: 'files', label: 'Files', panel: filesPanel, show: refreshFiles },
  {
    id: 'extensions',
    label: 'Extensions',
    panel: extensions.panel,
    show: () => extensions.refresh(),
    frame: () => extensions.refresh(),
  },
  { id: 'libs', label: 'Libs', panel: libs.panel },
])

// The page's own loop, which is not the machine's: the player runs the Runtime
// on its 50Hz clock and this only redraws what is on screen. The strip runs on
// every tab because the machine keeps going while you are looking elsewhere.
const tick = (): void => {
  strip.frame()
  tabs.frame()
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

/*
 * The boot demo is a FILE, and it starts the way any other file does.
 *
 * It used to be handed straight to `loadProgram`, which meant the one program
 * the page always runs was the one program you could not look at, re-run or
 * edit. Now it lives at RAM:amos_ts.amos, so it is in the file tree with
 * everything else and clicking it there does exactly what booting did.
 *
 * `loader.open` and not `openThing`, because the tab is not ours to choose at
 * boot: the URL fragment decides, and mountTabs has already read it.
 */
const demo = new TextEncoder().encode(DEMO)
vfs.writeTo('RAM', ['amos_ts.amos'], demo)
void loader.open({ name: 'amos_ts.amos', bytes: demo, at: { vol: 'RAM', dir: [] } })
