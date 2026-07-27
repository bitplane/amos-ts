/**
 * Browser runner: load a .AMOS file (or plain-text listing), run it on the
 * Runtime at 50 frames a second, composite to a canvas, feed it keys and
 * mouse. `npm run dev` and open the page.
 */
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable } from '../tokens/stream'
import { tokenize } from '../tokens/tokenizer'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { extensionTablesFor } from '../ext/identify'
import { Runtime } from '../runtime/runtime'
import { AmosRuntimeError } from '../interp/interp'
import { WebAudioSink } from './audio'
import { AmigaFS } from '../runtime/vfs'
import { readArchive, volumeFromEntries } from '../runtime/archive'
import { systemClock } from '../runtime/host'
import { baseName, deleteEntry, moveEntry, newDrawer, relabelVolume, renameEntry, type FsResult } from './filemanager'

const table = new TokenTable(CORE_TOKENS)

const canvas = document.getElementById('screen') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const statusEl = document.getElementById('status')!
const fileEl = document.getElementById('file') as HTMLInputElement
const turboEl = document.getElementById('turbo') as HTMLInputElement
const img = ctx.createImageData(640, Runtime.COMPOSITE_LINES * 2)

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

const audio = new WebAudioSink()
// one persistent filesystem across program loads: DH0: is writable and
// holds uploads; archives mount as their own volumes too
const vfs = new AmigaFS()
const dh0 = vfs.mountMemory('DH0')
// RAM: is part of every AMOS machine (the ram-handler) — writable, empty
vfs.mountMemory('RAM')
// global environment variables are files in ENV: on a real machine, and
// AMOS programs (and LDos) read and write them there
vfs.mountMemory('ENV')
vfs.currentDir = 'DH0:'

async function mountArchive(bytes: Uint8Array, name: string): Promise<void> {
  const entries = await readArchive(bytes)
  const volName = name.replace(/\.(zip|tar|tar\.gz|tgz|adf)$/i, '').replace(/[^A-Za-z0-9_]/g, '_')
  vfs.mount(volName, volumeFromEntries(entries))
  // also merge into DH0: so relative paths find resources
  for (const e of entries) {
    const segs = e.path.split('/').filter((s2) => s2 !== '' && s2 !== '.')
    if (segs.length > 0) dh0.write(segs, e.data)
  }
  statusEl.textContent = `mounted ${volName}: (${entries.length} files) — also merged into DH0:`
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
  if (res) {
    systemResource = res
    if (rt) rt.loadSystemResource(res)
  }
  statusEl.textContent = `AMOS Pro install detected at ${root.dir} — assigns created`
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
    if (rt) rt.discFontCache = null
  }
}
document.addEventListener('pointerdown', () => audio.unlock())
document.addEventListener('keydown', () => audio.unlock())

let rt: Runtime | null = null
let lastBytes: Uint8Array | null = null
let lastName = ''
let error = ''

// the system default resource bank (dialogs, Fsel$) — part of the machine
let systemResource: Uint8Array | null = null
void fetch('fixtures/official-amos/APSystem/AMOSPro_Default_Resource.Abk')
  .then((r) => (r.ok ? r.arrayBuffer() : null))
  .then((buf) => {
    if (buf) systemResource = new Uint8Array(buf)
    if (rt && systemResource) rt.loadSystemResource(systemResource)
  })
  .catch(() => {})

// the machine mouse bank: pointer shapes + system fill patterns
let mouseBank: Uint8Array | null = null
void fetch('fixtures/machine/AMOSPro_Mouse.abk')
  .then((r) => (r.ok ? r.arrayBuffer() : null))
  .then((buf) => {
    if (buf) mouseBank = new Uint8Array(buf)
    if (rt && mouseBank) rt.loadMouseBank(mouseBank)
  })
  .catch(() => {})

function load(bytes: Uint8Array, name: string): void {
  lastBytes = bytes
  lastName = name
  error = ''
  try {
    const isAmos = /^AMOS (Basic|Pro)/.test(new TextDecoder('latin1').decode(bytes.subarray(0, 16)))
    const amos = isAmos ? parseAmosFile(bytes) : null
    const lines = amos ? parseSource(amos.source, table) : tokenize(new TextDecoder('latin1').decode(bytes), table)
    rt = new Runtime(lines, table, { extensions: extensionTablesFor(lines), onUnimplemented: 'skip', banks: amos?.banks ?? [], audio, fs: vfs, host: { clock: systemClock() } })
    if (systemResource) rt.loadSystemResource(systemResource)
    if (mouseBank) rt.loadMouseBank(mouseBank)
  } catch (e) {
    rt = null
    error = e instanceof Error ? e.message : String(e)
    console.error('amos-ts: failed to load program:', e)
  }
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
    statusEl.textContent = `stored DH0:${[...dir, name].join('/')}`
    if (autoRun && /\.amos$/i.test(name)) {
      vfs.currentDir = dir.length > 0 ? `DH0:${dir.join('/')}` : 'DH0:'
      load(bytes, name)
    }
  }
  refreshFiles()
}

fileEl.addEventListener('change', () => {
  for (const f of Array.from(fileEl.files ?? [])) {
    void f.arrayBuffer().then((buf: ArrayBuffer) => receiveFile(f.name, new Uint8Array(buf), [], true))
  }
})
document.getElementById('restart')!.addEventListener('click', () => {
  if (lastBytes) load(lastBytes, lastName)
})

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
    // a folder drop doesn't auto-run: point the user at the file panel
    if (!single && entries.length > 0) {
      detectAmosInstall()
      detectFontsDrawer()
      filesEl.open = true
      refreshFiles()
      statusEl.textContent += ' — pick a .AMOS in the Files panel to run it'
    }
  })()
})

// ---- the file manager panel ----

const filesEl = document.getElementById('files') as HTMLDetailsElement
const fstreeEl = document.getElementById('fstree')!

/** an AMOS program by content, not name (some are extensionless on disk) */
function isRunnable(bytes: Uint8Array | null): boolean {
  if (!bytes || bytes.length < 16) return false
  return /^AMOS (Basic|Pro)/.test(new TextDecoder('latin1').decode(bytes.subarray(0, 16)))
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
  statusEl.textContent = r.message
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
  if (!filesEl.open) return
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
        const runnable = isRunnable(vfs.read(full))
        addLine(depth, runnable ? e.name : `${e.name}  (${e.size})`, {
          onClick: runnable
            ? () => {
                const bytes = vfs.read(full)
                if (!bytes) return
                // run with the program's own directory current, like a disk boot
                vfs.currentDir = base + dir.join('/')
                load(bytes, e.name)
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
filesEl.addEventListener('toggle', refreshFiles)

// ---- input ----

// DOM code → Amiga rawkey scancode (the common ones games poll)
const SCAN: Record<string, number> = {
  Escape: 0x45, Space: 0x40, Enter: 0x44, Backspace: 0x41, Tab: 0x42, Delete: 0x46,
  ArrowUp: 0x4c, ArrowDown: 0x4d, ArrowRight: 0x4e, ArrowLeft: 0x4f,
  ShiftLeft: 0x60, ShiftRight: 0x61, ControlLeft: 0x63, AltLeft: 0x64, AltRight: 0x65,
  KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15, KeyU: 0x16, KeyI: 0x17, KeyO: 0x18, KeyP: 0x19,
  KeyA: 0x20, KeyS: 0x21, KeyD: 0x22, KeyF: 0x23, KeyG: 0x24, KeyH: 0x25, KeyJ: 0x26, KeyK: 0x27, KeyL: 0x28,
  KeyZ: 0x31, KeyX: 0x32, KeyC: 0x33, KeyV: 0x34, KeyB: 0x35, KeyN: 0x36, KeyM: 0x37,
  Digit1: 0x01, Digit2: 0x02, Digit3: 0x03, Digit4: 0x04, Digit5: 0x05,
  Digit6: 0x06, Digit7: 0x07, Digit8: 0x08, Digit9: 0x09, Digit0: 0x0a,
  F1: 0x50, F2: 0x51, F3: 0x52, F4: 0x53, F5: 0x54, F6: 0x55, F7: 0x56, F8: 0x57, F9: 0x58, F10: 0x59,
}
// Joystick input is the two hardware ports (Joy(1)/Joy(0)). Real gamepads
// drive them faithfully (polled each frame). The keyboard does NOT touch
// the ports unless the user opts in per port via the Controls dropdown —
// otherwise a game that uses those keys AND reads a joystick would get
// phantom input (flight sims etc.). Bits: 1 up, 2 down, 4 left, 8 right,
// 16 fire.
/** which keys count as which port's directions, keyed by port. Empty
 * (faithful default) until the user assigns a keyboard→joystick mode. */
const KB_PORT: [Record<string, number>, Record<string, number>] = [{}, {}]
const KB_ARROWS: Record<string, number> = { ArrowUp: 1, ArrowDown: 2, ArrowLeft: 4, ArrowRight: 8, Space: 16 }
const KB_WASD: Record<string, number> = { KeyW: 1, KeyS: 2, KeyA: 4, KeyD: 8, ShiftLeft: 16 }
// live keyboard-joystick bits per port (only set while a mode is assigned)
const kbJoy = [0, 0]
// Controls dropdowns: opt a port into an arrows/WASD keyboard mapping
for (const [id, port] of [
  ['kb1', 1],
  ['kb0', 0],
] as const) {
  const sel = document.getElementById(id) as HTMLSelectElement
  const apply = (): void => {
    KB_PORT[port] = sel.value === 'arrows' ? KB_ARROWS : sel.value === 'wasd' ? KB_WASD : {}
    kbJoy[port] = 0 // clear stale held bits when the mapping changes
  }
  sel.addEventListener('change', apply)
  apply()
}

// AMOS ASCII codes for special keys (Cla_Special +W.s:12941): cursor keys
// are Chr$(30)/(31)/(28)/(29), Backspace 8, Tab 9, Return 13, Esc 27,
// Del stores ASCII 0 with its scancode
const SPECIAL_CH: Record<string, string> = {
  Backspace: '\x08', Tab: '\x09', Enter: '\r', NumpadEnter: '\r', Escape: '\x1b', Delete: '\x00',
  ArrowUp: '\x1e', ArrowDown: '\x1f', ArrowRight: '\x1c', ArrowLeft: '\x1d',
}
document.addEventListener('keydown', (e) => {
  if (!rt) return
  // Ctrl-C = the AMOS break (BitControl); On Break Proc handlers fire
  if (e.ctrlKey && e.code === 'KeyC') {
    rt.interp.requestBreak()
    e.preventDefault()
    return
  }
  const scan = SCAN[e.code] ?? 0
  if (scan) rt.input.keys.add(scan)
  for (let p = 0; p < 2; p++) if (KB_PORT[p]![e.code] !== undefined) kbJoy[p]! |= KB_PORT[p]![e.code]!
  const ch = SPECIAL_CH[e.code] ?? (e.key.length === 1 ? e.key : '')
  if (ch !== '') rt.pressKey(ch, scan)
  if (e.code === 'Space' || e.code === 'Backspace' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault()
})
document.addEventListener('keyup', (e) => {
  if (!rt) return
  const scan = SCAN[e.code] ?? 0
  if (scan) rt.input.keys.delete(scan)
  for (let p = 0; p < 2; p++) if (KB_PORT[p]![e.code] !== undefined) kbJoy[p]! &= ~KB_PORT[p]![e.code]!
})

/** poll real gamepads and merge with any opted-in keyboard bits, then
 * write the two ports. Gamepad 0 → Joy(1), gamepad 1 → Joy(0). */
function updateJoysticks(): void {
  if (!rt) return
  const pads = navigator.getGamepads?.() ?? []
  const padBits = (gp: Gamepad | null): number => {
    if (!gp) return 0
    let b = 0
    const ax = gp.axes
    if ((ax[1] ?? 0) < -0.5) b |= 1
    if ((ax[1] ?? 0) > 0.5) b |= 2
    if ((ax[0] ?? 0) < -0.5) b |= 4
    if ((ax[0] ?? 0) > 0.5) b |= 8
    // d-pad buttons 12..15 on the standard mapping
    if (gp.buttons[12]?.pressed) b |= 1
    if (gp.buttons[13]?.pressed) b |= 2
    if (gp.buttons[14]?.pressed) b |= 4
    if (gp.buttons[15]?.pressed) b |= 8
    if (gp.buttons[0]?.pressed || gp.buttons[1]?.pressed) b |= 16
    return b
  }
  rt.input.joy = kbJoy[1]! | padBits(pads[0] ?? null)
  rt.input.joy0 = kbJoy[0]! | padBits(pads[1] ?? null)
}
canvas.addEventListener('mousemove', (e) => {
  if (!rt) return
  const r = canvas.getBoundingClientRect()
  rt.input.mouseX = 128 + Math.floor(((e.clientX - r.left) / r.width) * 320)
  rt.input.mouseY = Runtime.COMPOSITE_TOP + Math.floor(((e.clientY - r.top) / r.height) * Runtime.COMPOSITE_LINES)
})
canvas.addEventListener('mousedown', (e) => {
  if (!rt) return
  rt.input.mouseK |= e.button === 2 ? 2 : e.button === 1 ? 4 : 1
  e.preventDefault()
})
canvas.addEventListener('mouseup', (e) => {
  if (rt) rt.input.mouseK &= ~(e.button === 2 ? 2 : e.button === 1 ? 4 : 1)
})
canvas.addEventListener('contextmenu', (e) => e.preventDefault())

// ---- the 50Hz loop ----

/** the Amiga vertical blank: 50Hz PAL */
const FRAME_MS = 20
let acc = 0
let last = performance.now()
function loop(now: number): void {
  requestAnimationFrame(loop)
  // Never catch up. The debt is capped at a single frame, so a hitch — a
  // long GC, a hidden tab, a slow machine — costs time rather than being
  // replayed at speed afterwards. Running a burst to make up the deficit is
  // what makes a game lurch: the emulation is nominally correct and the
  // player is thrown across the screen. Slightly slow and steady is the
  // right failure, and on a machine that keeps up this is exactly 50Hz.
  acc += Math.min(now - last, FRAME_MS)
  last = now
  if (!rt) return
  let frames = 0
  if (turboEl.checked) {
    frames = 20
    acc = 0
  } else if (acc >= FRAME_MS) {
    frames = 1
    acc -= FRAME_MS
  }
  updateJoysticks()
  let status = ''
  for (let i = 0; i < frames; i++) {
    if (rt.interp.done) break
    try {
      rt.frame()
    } catch (e) {
      error = e instanceof AmosRuntimeError ? e.message : String(e)
      console.error('amos-ts: program error:', e)
      rt = null
      break
    }
  }
  if (rt) {
    rt.composite(img.data as unknown as Uint8ClampedArray)
    ctx.putImageData(img, 0, 0)
    const b = rt.interp.blocked
    status = rt.interp.done
      ? 'ended'
      : b
        ? b.type === 'input'
          ? 'waiting for Input — type on the screen'
          : b.type
        : `running · ${lastName}`
    const skipped = rt.interp.unimplemented.size
    if (skipped > 0) status += ` · ${skipped} skipped: ${[...rt.interp.unimplemented.keys()].slice(0, 4).join(', ')}`
  }
  statusEl.textContent = error !== '' ? `error: ${error}` : status
}

load(new TextEncoder().encode(DEMO), 'demo')
requestAnimationFrame(loop)
