/**
 * The embeddable player.
 *
 * `createPlayer(container, opts)` builds a self-contained AMOS machine inside
 * an element: a canvas, a 50Hz loop, a virtual filesystem and the input
 * devices. It owns nothing outside its container and reads nothing from the
 * page, so several can coexist and a host can put one in the middle of an
 * article without the article changing shape around it.
 *
 * Two decisions in here are about being a guest on someone else's page rather
 * than about AMOS:
 *
 * **Keys are captured only while focused.** The listeners are on the container
 * and the container is focusable; a page with a game halfway down it must not
 * eat the arrow keys and space bar of a reader who is only scrolling past.
 * Click on it and it takes the keyboard; click away and it gives it back,
 * which is what every other embedded game does and what a reader expects.
 *
 * **Nothing runs until a gesture.** Browsers will not start audio without one
 * anyway, and a page holding three games should not start three AMOS programs
 * at once. The overlay is the gesture, and it doubles as the thing that tells
 * a reader this is playable rather than a screenshot.
 */
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { isAmosProgram, loadProgram as compileProgram } from '../loader/program'
import { VERSION } from '../version'
import { Runtime } from '../runtime/runtime'
import { AmosRuntimeError } from '../interp/interp'
import { AmigaFS, MemoryVolume } from '../amiga/vfs'
import { AdfVolume, isAdf } from '../amiga/adf'
import { readArchive, volumeFromEntries } from '../runtime/archive'
import { systemClock } from '../amiga/host'
import { WebAudioSink } from './audio'
import { WebSerialHost, available as serialAvailable } from './serial'

/** the release this player was built from; 'dev' outside a release build */
export { VERSION }

/** the Amiga vertical blank: 50Hz PAL */
export const FRAME_MS = 20

/** DOM code -> Amiga rawkey scancode (the ones games poll) */
export const SCAN: Record<string, number> = {
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

/**
 * AMOS ASCII for the special keys (Cla_Special +W.s:12941): the cursor keys
 * are Chr$(30)/(31)/(28)/(29), Backspace 8, Tab 9, Return 13, Esc 27, and Del
 * stores ASCII 0 with its scancode.
 */
export const SPECIAL_CH: Record<string, string> = {
  Backspace: '\x08', Tab: '\x09', Enter: '\r', NumpadEnter: '\r', Escape: '\x1b', Delete: '\x00',
  ArrowUp: '\x1e', ArrowDown: '\x1f', ArrowRight: '\x1c', ArrowLeft: '\x1d',
}

/** joystick bits: 1 up, 2 down, 4 left, 8 right, 16 fire */
export const KB_ARROWS: Record<string, number> = { ArrowUp: 1, ArrowDown: 2, ArrowLeft: 4, ArrowRight: 8, Space: 16 }
export const KB_WASD: Record<string, number> = { KeyW: 1, KeyS: 2, KeyA: 4, KeyD: 8, ShiftLeft: 16 }

/** a keyboard-to-joystick mapping: a preset name, or DOM code -> bits */
export type JoyKeys = 'arrows' | 'wasd' | 'none' | Record<string, number>

function joyMap(k: JoyKeys | undefined): Record<string, number> {
  if (k === 'arrows') return KB_ARROWS
  if (k === 'wasd') return KB_WASD
  if (k === undefined || k === 'none') return {}
  return k
}

export interface PlayerOptions {
  /**
   * Keyboard to joystick, per hardware port. Port 1 is `Joy(1)`, which is
   * what nearly every game reads.
   *
   * Off by default, and deliberately: a program that reads the keyboard AND
   * a joystick would otherwise see phantom input from the same keypress. A
   * host embedding a specific game knows which it wants; a general player
   * does not, so it asks.
   */
  joystick?: { port1?: JoyKeys; port0?: JoyKeys }
  /** run as soon as a program is loaded, rather than showing the start overlay */
  autoplay?: boolean
  /** text for the start overlay */
  startLabel?: string
  /**
   * The AMOS Pro default resource bank — the dialog engine and Fsel$ read
   * their layouts from it. Part of the machine rather than of a program, and
   * not ours to redistribute, so a host supplies it if it has one. Programs
   * that do not open a dialog never notice its absence.
   */
  systemResource?: Uint8Array
  /** progress and state, for a host that wants to show it */
  onStatus?: (text: string) => void
  onError?: (message: string) => void
}

export interface Player {
  readonly canvas: HTMLCanvasElement
  readonly vfs: AmigaFS
  /** the writable volume the player mounts programs into */
  readonly dh0: MemoryVolume
  /** the live machine, or null before a program loads / after an error */
  readonly runtime: Runtime | null
  /**
   * Mount an archive and run the program in it. Directories are preserved and
   * the current directory becomes the drawer holding the program, so its
   * relative loads resolve — which is how most games find their data.
   */
  loadArchive(bytes: Uint8Array, name: string, run?: string): Promise<void>
  /** run one program, with `dir` as its drawer inside DH0: */
  loadProgram(bytes: Uint8Array, name: string, dir?: string[]): void
  restart(): void
  /** change a port's keyboard mapping after construction */
  setJoystick(port: 0 | 1, keys: JoyKeys): void
  /** run flat out instead of at 50Hz — a development aid, not a feature */
  setTurbo(on: boolean): void
  /** supply the AMOS Pro resource bank once it has been fetched */
  setSystemResource(bytes: Uint8Array): void
  /** take the keyboard (what clicking on it does) */
  focus(): void
  /**
   * Ask the user for a serial port, so `Serial Open` can reach real
   * hardware. MUST be called from a user gesture — Web Serial's chooser
   * requires one, which is exactly why a program cannot do this itself.
   * Resolves false where there is no Web Serial, or if the user dismissed
   * the chooser. Programs run without it get the modelled port.
   */
  requestSerialPort(): Promise<boolean>
  /** whether this browser has Web Serial at all (Chromium desktop, HTTPS) */
  readonly serialSupported: boolean
  /** stop the loop and remove every listener; the container is left empty */
  destroy(): void
}

/** an AMOS program by content, not by name — plenty are extensionless */
export { isAmosProgram }

/**
 * Pick the program to run out of an archive's entries.
 *
 * An explicit choice always wins. Otherwise the shallowest `.AMOS` wins,
 * because a game's own program sits beside its data while anything bundled
 * with it tends to be further down. A tie is reported rather than guessed:
 * picking one of two at random gives a host no way to know it happened.
 */
export function pickProgram(paths: string[], run?: string): { path?: string; ambiguous?: string[] } {
  if (run !== undefined) {
    const want = run.toLowerCase()
    const hit = paths.find((p) => p.toLowerCase() === want || p.toLowerCase().endsWith('/' + want))
    return hit ? { path: hit } : { ambiguous: paths }
  }
  if (paths.length === 0) return {}
  const depth = (p: string): number => p.split('/').length
  const min = Math.min(...paths.map(depth))
  const top = paths.filter((p) => depth(p) === min)
  return top.length === 1 ? { path: top[0]! } : { ambiguous: top }
}

export function createPlayer(container: HTMLElement, opts: PlayerOptions = {}): Player {
  const table = new TokenTable(CORE_TOKENS)
  const audio = new WebAudioSink()
  // one per player. Constructing it is free and prompts nothing — it only
  // collects the ports the user has already granted to this origin.
  const serialHost = new WebSerialHost()
  const status = opts.onStatus ?? ((): void => {})
  const fail = opts.onError ?? ((): void => {})

  // ---- the machine's filesystem ----
  const vfs = new AmigaFS()
  // A game packaged as a zip is being run away from the machine it was
  // written on, so a path naming that machine's second hard drive resolves
  // against the drawer the program is in instead of failing. See
  // AmigaFS.strayVolume — it is off by default and deliberately not on for
  // the census, which needs a missing file to look like one.
  vfs.strayVolume = 'currentDir'
  const dh0 = vfs.mountMemory('DH0')
  vfs.mountMemory('RAM') // the ram-handler is part of every AMOS machine
  vfs.mountMemory('ENV') // global environment variables live here
  vfs.currentDir = 'DH0:'

  // ---- the display ----
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = Runtime.COMPOSITE_LINES * 2
  canvas.className = 'amos-screen'
  // the AMOS pointer is composited like the machine's own hardware sprite 0
  canvas.style.cursor = 'none'
  canvas.style.imageRendering = 'pixelated'
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.background = '#000'
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(640, Runtime.COMPOSITE_LINES * 2)

  container.classList.add('amos-player')
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
  container.tabIndex = 0
  container.style.outline = 'none'
  container.appendChild(canvas)

  const overlay = document.createElement('button')
  overlay.type = 'button'
  overlay.className = 'amos-start'
  overlay.textContent = opts.startLabel ?? '▶ play'
  Object.assign(overlay.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    display: 'none', alignItems: 'center', justifyContent: 'center',
    font: 'inherit', fontSize: '1.5rem', color: '#fff', cursor: 'pointer',
    background: 'rgba(0,0,0,.55)', border: '0',
  })
  container.appendChild(overlay)

  let rt: Runtime | null = null
  let systemResource = opts.systemResource
  let lastBytes: Uint8Array | null = null
  let lastName = ''
  let lastDir: string[] = []
  let error = ''
  let running = opts.autoplay !== false
  let focused = false
  let turbo = false

  // ---- keyboard, scoped to focus ----
  const KB_PORT: [Record<string, number>, Record<string, number>] = [
    joyMap(opts.joystick?.port0),
    joyMap(opts.joystick?.port1),
  ]
  const kbJoy = [0, 0]

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!focused || !rt) return
    audio.unlock()
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
    // only swallow the browser's own use of a key once we have the keyboard
    if (e.code === 'Space' || e.code === 'Backspace' || e.code === 'Tab' || e.code.startsWith('Arrow')) {
      e.preventDefault()
    }
  }
  const onKeyUp = (e: KeyboardEvent): void => {
    if (!rt) return
    const scan = SCAN[e.code] ?? 0
    if (scan) rt.input.keys.delete(scan)
    for (let p = 0; p < 2; p++) if (KB_PORT[p]![e.code] !== undefined) kbJoy[p]! &= ~KB_PORT[p]![e.code]!
  }
  const onFocus = (): void => {
    focused = true
    container.classList.add('amos-focus')
  }
  const onBlur = (): void => {
    focused = false
    container.classList.remove('amos-focus')
    // a key held as focus left would otherwise stick down forever
    if (rt) rt.input.keys.clear()
    kbJoy[0] = 0
    kbJoy[1] = 0
  }
  container.addEventListener('keydown', onKeyDown)
  container.addEventListener('keyup', onKeyUp)
  container.addEventListener('focus', onFocus)
  container.addEventListener('blur', onBlur)

  // ---- mouse ----
  const onMove = (e: MouseEvent): void => {
    if (!rt) return
    const r = canvas.getBoundingClientRect()
    rt.input.mouseX = 128 + Math.floor(((e.clientX - r.left) / r.width) * 320)
    rt.input.mouseY = Runtime.COMPOSITE_TOP + Math.floor(((e.clientY - r.top) / r.height) * Runtime.COMPOSITE_LINES)
  }
  const btn = (e: MouseEvent): number => (e.button === 2 ? 2 : e.button === 1 ? 4 : 1)
  const onDown = (e: MouseEvent): void => {
    container.focus()
    audio.unlock()
    if (!rt) return
    rt.input.mouseK |= btn(e)
    e.preventDefault()
  }
  const onUp = (e: MouseEvent): void => {
    if (rt) rt.input.mouseK &= ~btn(e)
  }
  const noMenu = (e: Event): void => e.preventDefault()
  canvas.addEventListener('mousemove', onMove)
  canvas.addEventListener('mousedown', onDown)
  canvas.addEventListener('mouseup', onUp)
  canvas.addEventListener('contextmenu', noMenu)

  const onStart = (): void => {
    running = true
    overlay.style.display = 'none'
    audio.unlock()
    container.focus()
  }
  overlay.addEventListener('click', onStart)

  // ---- gamepads ----
  function padBits(gp: Gamepad | null): number {
    if (!gp) return 0
    let b = 0
    const ax = gp.axes
    if ((ax[1] ?? 0) < -0.5) b |= 1
    if ((ax[1] ?? 0) > 0.5) b |= 2
    if ((ax[0] ?? 0) < -0.5) b |= 4
    if ((ax[0] ?? 0) > 0.5) b |= 8
    if (gp.buttons[12]?.pressed) b |= 1
    if (gp.buttons[13]?.pressed) b |= 2
    if (gp.buttons[14]?.pressed) b |= 4
    if (gp.buttons[15]?.pressed) b |= 8
    if (gp.buttons[0]?.pressed || gp.buttons[1]?.pressed) b |= 16
    return b
  }

  // ---- loading ----
  function loadProgram(bytes: Uint8Array, name: string, dir: string[] = []): void {
    lastBytes = bytes
    lastName = name
    lastDir = dir
    error = ''
    try {
      const { lines, extensions, bindings, amos } = compileProgram(bytes, table)
      vfs.currentDir = dir.length > 0 ? `DH0:${dir.join('/')}` : 'DH0:'
      rt = new Runtime(lines, table, {
        extensions,
        extBindings: bindings,
        onUnimplemented: 'skip',
        banks: amos?.banks ?? [],
        audio,
        fs: vfs,
        host: { clock: systemClock(), printer: printText, printerPage: printPage, serial: serialHost },
      })
      if (systemResource) rt.loadSystemResource(systemResource)
      status(`running ${name}`)
      if (!running) overlay.style.display = 'flex'
    } catch (e) {
      rt = null
      error = e instanceof Error ? e.message : String(e)
      fail(error)
      console.error('amos-ts: failed to load program:', e)
    }
  }

  async function loadArchive(bytes: Uint8Array, name: string, run?: string): Promise<void> {
    const entries = await readArchive(bytes)
    /**
     * A floppy image is mounted as itself rather than flattened: it has a
     * real filesystem, so it keeps its own name, its protection bits, its
     * FileNote and its DateStamp, and its files are read when asked for.
     * Everything else here is a flat archive with none of that.
     *
     * The label is what the disk was called, which is what a program written
     * to load `MyDisk:data/pic.iff` is looking for — the host filename it
     * happens to be stored under today is not. An unlabelled disk (they
     * exist) falls back to the filename, mangled as before.
     */
    const adf = isAdf(bytes) ? new AdfVolume(bytes) : null
    const fromName = name.replace(/\.(zip|tar|tar\.gz|tgz|adf)$/i, '').replace(/[^A-Za-z0-9_]/g, '_')
    const vol = adf?.label.replace(/[:/]/g, '_').trim() || fromName
    vfs.mount(vol, adf ?? volumeFromEntries(entries))
    // and into DH0: as well, keeping the layout, so a program's own relative
    // loads resolve exactly as they did on the machine it was written on
    for (const e of entries) {
      const segs = e.path.split('/').filter((s) => s !== '' && s !== '.')
      if (segs.length > 0) dh0.write(segs, e.data)
    }
    const programs = entries
      .filter((e) => /\.amos$/i.test(e.path) || isAmosProgram(e.data))
      .map((e) => e.path)
    const pick = pickProgram(programs, run)
    if (pick.path === undefined) {
      const why =
        programs.length === 0
          ? `no AMOS program in ${name}`
          : `${name} holds ${pick.ambiguous?.length ?? 0} programs — name one: ${(pick.ambiguous ?? []).join(', ')}`
      error = why
      fail(why)
      return
    }
    const segs = pick.path.split('/').filter((s) => s !== '' && s !== '.')
    const dir = segs.slice(0, -1)
    // Every Amiga drive name points at the drawer the program came from. A
    // game written to load off DF0: was written to load off the floppy it
    // shipped on, and that floppy is now this archive; DH0:/HD0: likewise for
    // one installed to a hard disk. Nothing inside the game has to change.
    //
    // The target is the ARCHIVE volume, not the DH0: copy — assigning DH0 to
    // a path that starts "DH0:" is self-referential, and resolve() expands
    // assigns before volumes, so it would spin until the cycle guard gave up.
    vfs.assignDrives(dir.length > 0 ? `${vol}:${dir.join('/')}` : `${vol}:`)
    const file = entries.find((e) => e.path === pick.path)!
    loadProgram(file.data, segs[segs.length - 1]!, dir)
  }

  // ---- the 50Hz loop ----
  let acc = 0
  let last = performance.now()
  let raf = 0
  let alive = true

  function loop(now: number): void {
    if (!alive) return
    raf = requestAnimationFrame(loop)
    // Never catch up. The debt is capped at a single frame, so a hitch costs
    // time rather than being replayed at speed afterwards — running a burst
    // to clear a deficit is what throws a player across the screen.
    acc += Math.min(now - last, FRAME_MS)
    last = now
    if (!rt || !running) return
    let frames = 0
    if (turbo) {
      frames = 20
      acc = 0
    } else if (acc >= FRAME_MS) {
      frames = 1
      acc -= FRAME_MS
    }
    const pads = navigator.getGamepads?.() ?? []
    rt.input.joy = kbJoy[1]! | padBits(pads[0] ?? null)
    rt.input.joy0 = kbJoy[0]! | padBits(pads[1] ?? null)
    for (let i = 0; i < frames; i++) {
      if (rt.interp.done) break
      try {
        rt.frame()
      } catch (e) {
        error = e instanceof AmosRuntimeError ? e.message : String(e)
        fail(error)
        console.error('amos-ts: program error:', e)
        rt = null
        return
      }
    }
    rt.composite(img.data as unknown as Uint8ClampedArray)
    ctx.putImageData(img, 0, 0)
  }
  raf = requestAnimationFrame(loop)

  return {
    canvas,
    vfs,
    dh0,
    get runtime() {
      return rt
    },
    loadArchive,
    loadProgram,
    restart(): void {
      if (lastBytes) loadProgram(lastBytes, lastName, lastDir)
    },
    setJoystick(port: 0 | 1, keys: JoyKeys): void {
      KB_PORT[port] = joyMap(keys)
      kbJoy[port] = 0 // a bit held under the old mapping would stick
    },
    setTurbo(on: boolean): void {
      turbo = on
      acc = 0
    },
    setSystemResource(bytes: Uint8Array): void {
      systemResource = bytes
      if (rt) rt.loadSystemResource(bytes)
    },
    focus(): void {
      container.focus()
    },
    serialSupported: serialAvailable(),
    requestSerialPort(): Promise<boolean> {
      return serialHost.requestAccess()
    },
    destroy(): void {
      alive = false
      cancelAnimationFrame(raf)
      container.removeEventListener('keydown', onKeyDown)
      container.removeEventListener('keyup', onKeyUp)
      container.removeEventListener('focus', onFocus)
      container.removeEventListener('blur', onBlur)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('contextmenu', noMenu)
      overlay.removeEventListener('click', onStart)
      rt = null
      container.textContent = ''
    },
  }
}

/**
 * Printer Dump, on paper.
 *
 * The page arrives as RGBA at the screen's own resolution, which is tiny by
 * paper standards, so it goes into an off-screen canvas and is scaled up
 * with smoothing off — an Amiga screen dumped to A4 should look like big
 * square pixels, not a blurred photograph of them.
 *
 * SPECIAL_ASPECT is honoured by not honouring it: the source asks the driver
 * to correct for the printer's own pixel aspect, and a browser's print
 * pipeline has no such distortion to correct. Lowres pixels were wide on a
 * real monitor, and that is reproduced by the 2:1 scale below rather than by
 * the printer.
 *
 * The window is opened and printed rather than using a print stylesheet on
 * the player itself, because the player is a canvas the size of a screen and
 * the page is a separate document — and because printing must not disturb a
 * program that is still running.
 */
/**
 * Open a printable document in its own window and raise the print dialog.
 *
 * A separate document rather than a print stylesheet on the player, for two
 * reasons: the player is a canvas the size of an Amiga screen and a page is
 * not, and printing must not disturb a program that is still running. The
 * dialog also gives Save as PDF for free, so "print it" and "keep it" are
 * the same button.
 */
function printDocument(body: string, title: string): void {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(`<!doctype html><title>${title}</title>${body}`)
  win.document.close()
  const el = win.document.querySelector('img')
  if (el) el.onload = (): void => win.print()
  else win.print()
}

/**
 * The TEXT printer: Lprint, and JD's Prt keywords.
 *
 * A real printer holds a page until something feeds it, and this does the
 * same. Form feed (chr$ 12) ends a page immediately; otherwise an idle timer
 * flushes, because a program that prints five lines and stops should still
 * get paper rather than nothing. Without that a listing would sit in the
 * buffer forever, which is the silent failure this whole thing replaces.
 *
 * The text goes into a <pre>: AMOS printer output is column-aligned by
 * spaces, and a proportional font would destroy every table anyone ever
 * printed from it.
 */
const PRINTER_IDLE_MS = 1500
let printerBuf = ''
let printerTimer: ReturnType<typeof setTimeout> | null = null

function flushPrinterText(): void {
  if (printerTimer !== null) {
    clearTimeout(printerTimer)
    printerTimer = null
  }
  const text = printerBuf
  printerBuf = ''
  if (text.length === 0) return
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  printDocument(
    `<style>@page{margin:1.5cm}body{margin:0}` +
      `pre{font:12px/1.25 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;margin:0}</style>` +
      `<pre>${esc}</pre>`,
    'Printer',
  )
}

function printText(text: string): void {
  for (const ch of text) {
    if (ch === '\f') {
      // form feed: the page is finished, send it now
      flushPrinterText()
      continue
    }
    printerBuf += ch
  }
  if (printerBuf.length === 0) return
  if (printerTimer !== null) clearTimeout(printerTimer)
  printerTimer = setTimeout(flushPrinterText, PRINTER_IDLE_MS)
}

function printPage(page: import('../amiga/host').PrinterPage): void {
  const cv = document.createElement('canvas')
  cv.width = page.width
  cv.height = page.height
  const cx = cv.getContext('2d')
  if (!cx) return
  // createImageData then set, rather than new ImageData(pixels, ...) — the
  // constructor overload wants an ArrayBuffer-backed array specifically
  const img = cx.createImageData(page.width, page.height)
  img.data.set(page.pixels)
  cx.putImageData(img, 0, 0)

  // lowres pixels were twice as wide as they were tall
  const wide = page.width <= 400
  const w = page.width * (wide ? 2 : 1)
  const url = cv.toDataURL('image/png')
  printDocument(
    `<style>@page{margin:1cm}html,body{margin:0;padding:0}` +
      `img{width:100%;max-width:${w * 2}px;image-rendering:pixelated;display:block}</style>` +
      `<img src="${url}">`,
    'Printer Dump',
  )
}
