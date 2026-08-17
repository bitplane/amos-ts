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

import { Keyboard } from '../amiga/keyboard'
import { Mouse } from '../amiga/mouse'
import { mountTabs } from './ui/tabs'
import { createStrip } from './ui/strip'
import { createHardwareTab } from './ui/hardware'
import type { InputSource } from './ui/catalogue'
import { createLibsTab } from './ui/libs'

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
const dh0 = player.dh0

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
  const root = findRoot('DH0:', 0)
  if (!root) return
  vfs.assign('AMOSPro', root.dir)
  vfs.assign('AMOSPro_System', join(root.dir, root.sys))
  for (const e of (vfs.listDir(root.dir) ?? []).filter((x) => x.isDir)) {
    vfs.assign(`AMOSPro_${e.name}`, join(root.dir, e.name))
    vfs.assign(e.name, join(root.dir, e.name))
  }
  const res = vfs.read(join(join(root.dir, root.sys), 'AMOSPro_Default_Resource.Abk'))
  if (res) player.setSystemResource(res)
  setStatus(`AMOS Pro install detected at ${root.dir}, assigns created`)
}

/** a dropped drawer named "fonts" becomes the FONTS: assign AvailFonts
 * scans — real Amiga diskfonts render Text/menus with true metrics */
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
  const found = findFonts('DH0:', 0)
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
async function receiveFile(name: string, bytes: Uint8Array, dir: string[], autoRun: boolean): Promise<void> {
  if (/\.(zip|tar|gz|tgz|adf)$/i.test(name)) {
    await mountArchive(bytes, name)
  } else {
    dh0.write([...dir, name], bytes)
    setStatus(`stored DH0:${[...dir, name].join('/')}`)
    if (autoRun && /\.amos$/i.test(name)) {
      vfs.currentDir = dir.length > 0 ? `DH0:${dir.join('/')}` : 'DH0:'
      player.loadProgram(bytes, name, dir)
    }
  }
  refreshFiles()
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

async function dropEntry(entry: FileSystemEntry, dir: string[], single: boolean): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
    await receiveFile(entry.name, new Uint8Array(await file.arrayBuffer()), dir, single)
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // readEntries returns batches of <=100 until empty
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
      if (batch.length === 0) break
      for (const e of batch) await dropEntry(e, [...dir, entry.name], false)
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

/** an AMOS program by content, not name (some are extensionless on disk) */
/**
 * Can this entry be clicked to run?
 *
 * By header OR by name, which is the same rule the archive loader and the
 * file drop use — a plain-text listing has no header to identify it, so the
 * `.amos` extension is all there is to go on. Testing the header alone made
 * a listing look like inert data in the tree while the very same file, when
 * dropped on the window, ran fine.
 */
function isRunnable(name: string, bytes: Uint8Array | null): boolean {
  return isAmosProgram(bytes) || (/\.amos$/i.test(name) && bytes !== null && bytes.length > 0)
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
        const runnable = isRunnable(e.name, vfs.read(full))
        addLine(depth, runnable ? e.name : `${e.name}  (${e.size})`, {
          onClick: runnable
            ? () => {
                const bytes = vfs.read(full)
                if (!bytes) return
                // run with the program's own directory current, like a disk boot
                player.loadProgram(bytes, e.name, dir)
                // and show it: a program started from the tree was otherwise
                // running behind the panel you started it from
                tabs.select('play')
              }
            : undefined,
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

// ---- the tabs ----
// Built last, because the strip and the hardware panel read the machine and
// the machine belongs to the player.

const strip = createStrip(player.machine, {
  onReset: () => {
    player.restart()
    setStatus('reset')
    tabs.select('play')
  },
})
document.getElementById('strip-host')!.appendChild(strip.root)
statusEl = strip.status
statusEl.textContent = held

const hardware = createHardwareTab(player.machine, host)
const libs = createLibsTab()
document.getElementById('panels')!.append(hardware.panel, libs.panel)

const tabs = mountTabs(document.getElementById('tabbar')!, [
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

player.loadProgram(new TextEncoder().encode(DEMO), 'demo')
