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
import { JOY_DOWN, JOY_FIRE, JOY_LEFT, JOY_RIGHT, JOY_UP, applyJoyBits } from '../interp/gameport'
import {
  BTN_BLUE,
  BTN_FORWARD,
  BTN_GREEN,
  BTN_PLAY,
  BTN_RED,
  BTN_REVERSE,
  BTN_YELLOW,
  CTRL_GAMEPAD,
  CTRL_JOYSTICK,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  DIR_UP,
  type Controller,
} from '../amiga/controller'
import { AmigaFS, MemoryVolume } from '../amiga/vfs'
import { AdfVolume, isAdf } from '../amiga/adf'
import { readArchive, volumeFromEntries } from '../runtime/archive'
import { systemClock } from '../amiga/host'
import { Machine, type ResetKind } from '../amiga/machine'
import { WebAudioSink } from './audio'
import { MixerSink } from './mixersink'
import { SerialCable } from '../amiga/serialport'
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
export const KB_ARROWS: Record<string, number> = {
  ArrowUp: JOY_UP,
  ArrowDown: JOY_DOWN,
  ArrowLeft: JOY_LEFT,
  ArrowRight: JOY_RIGHT,
  Space: JOY_FIRE,
}
export const KB_WASD: Record<string, number> = {
  KeyW: JOY_UP,
  KeyS: JOY_DOWN,
  KeyA: JOY_LEFT,
  KeyD: JOY_RIGHT,
  ShiftLeft: JOY_FIRE,
}

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
  /**
   * Take the old buffer-source sink instead of rendering through `PaulaMixer`.
   *
   * An escape hatch, not a preference: the mixer is the faithful one, and it
   * already falls back on its own when the AudioWorklet will not start. This
   * is for the case where the worklet starts and is WORSE than a fallback —
   * an underrunning device, a browser whose Blob URLs are blocked by a policy
   * that does not throw. Nothing in this repo sets it.
   */
  bufferSourceAudio?: boolean
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
  /** rebuild the environment, keeping the filesystem: a cold reset */
  restart(): void
  /**
   * Reset the machine from outside, the way a front-panel button would.
   * `restart()` is this with `'cold'`; see ../amiga/machine.ts for what the
   * two kinds mean and why they currently do the same thing.
   */
  reset(kind?: ResetKind): void
  /** power and pending-reset state, shared by every Runtime this builds */
  readonly machine: Machine
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
  // PaulaMixer through an AudioWorklet, which is the only way a waveform
  // swapped mid-note and a register write partway through a frame survive to
  // the speaker. `MixerSink` falls back to `WebAudioSink` on its own if the
  // worklet will not start, so nothing here has to choose. See mixersink.ts.
  const audio = opts.bufferSourceAudio === true ? new WebAudioSink() : new MixerSink()
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
  /**
   * The machine every Runtime here runs on.
   *
   * Made once, at player construction, and never replaced -- a reset destroys
   * the environment and not the machine, and this is what makes that true
   * rather than merely said. It is also what a reset keyword reaches to ask
   * for one. See ../amiga/machine.ts.
   */
  const machine = new Machine()

  /**
   * Put a cable in the serial connector once the page has a real port.
   *
   * Without this the machine's serial slot reads empty while `Serial Open` is
   * talking to actual hardware, and CIA-B's three handshake lines answer
   * "nothing plugged in" at $bfd000. Called after a grant rather than every
   * frame; a port the browser had already granted to this origin shows up
   * when `WebSerialHost`'s startup refresh finishes, which is why the frame
   * loop asks as well.
   */
  function syncSerialSlot(): void {
    const has = serialHost.granted > 0
    if (has === (machine.serial !== null)) return
    if (has) machine.attach('ser', new SerialCable('host serial port'))
    else machine.detach('ser')
  }

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
    rt.keyDown(scan)
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
    rt.keyUp(scan)
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
  /**
   * A browser gamepad, as a CD32 pad.
   *
   * The seven buttons map onto the standard gamepad layout in the order the
   * pad's own labels suggest — face buttons first, then the two shoulders,
   * then Start for play/pause. Anything reading `lowlevel.library` sees a
   * `JP_TYPE_GAMECTLR` port with these held; anything reading `Joy()` sees the
   * directions and red, because that is all five bits can say.
   *
   * With no gamepad attached the port stays a one-button joystick driven by
   * the keyboard preset, which is what it has always been.
   */
  const PAD_BUTTONS: ReadonlyArray<readonly [index: number, button: number]> = [
    [0, BTN_RED],
    [1, BTN_BLUE],
    [2, BTN_YELLOW],
    [3, BTN_GREEN],
    [4, BTN_REVERSE],
    [5, BTN_FORWARD],
    [9, BTN_PLAY],
  ]

  function setPort(c: Controller, kb: number, gp: Gamepad | null): void {
    // the keyboard preset first: it is a one-button stick, and assigning the
    // five bits assigns the whole of one
    applyJoyBits(c, kb)
    if (!gp) {
      c.type = CTRL_JOYSTICK
      return
    }
    c.type = CTRL_GAMEPAD
    const ax = gp.axes
    if ((ax[1] ?? 0) < -0.5 || gp.buttons[12]?.pressed) c.dirs |= DIR_UP
    if ((ax[1] ?? 0) > 0.5 || gp.buttons[13]?.pressed) c.dirs |= DIR_DOWN
    if ((ax[0] ?? 0) < -0.5 || gp.buttons[14]?.pressed) c.dirs |= DIR_LEFT
    if ((ax[0] ?? 0) > 0.5 || gp.buttons[15]?.pressed) c.dirs |= DIR_RIGHT
    for (const [i, button] of PAD_BUTTONS) if (gp.buttons[i]?.pressed) c.buttons |= button
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
        // one machine, many Runtimes: it is what a reset destroys the
        // environment ON, so it outlives every environment built here
        machine,
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
    const label = adf?.label.replace(/[:/]/g, '_').trim() ?? ''
    const vol = label || fromName
    if (adf) {
      // A floppy image goes into DRIVE 0, which is what makes `DF0:` and the
      // disk's own label both resolve to it: one disk, two names, the way
      // AmigaDOS keeps a DEVICE node and a VOLUME node for the same drive.
      // See ../amiga/trackdisk.ts.
      machine.drives[0]!.insert(adf)
      // An unlabelled disk has no VOLUME node to be reached by, and they
      // exist. The host's filename is the only name it has, so it is mounted
      // under that as well and the assigns below have something to point at.
      if (label === '') vfs.mount(vol, adf)
    } else {
      vfs.mount(vol, volumeFromEntries(entries))
    }
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

  /**
   * Carry out a reset: build the machine's environment again.
   *
   * The filesystem is deliberately NOT rebuilt. A reset clears memory, not
   * disks, so `vfs` and `dh0` survive both kinds and a program that wrote a
   * high-score file before rebooting still finds it -- which is what happens
   * on the Amiga, where the write went to a floppy.
   *
   * NOTE: cold and warm do the same thing here. What they differ over on the
   * machine is RAM that is BUILT to survive a reset -- the resident list, a
   * recoverable RAM disk -- and this port has none, so there is nothing for
   * the warm one to keep. The distinction is carried rather than invented: the
   * keywords already ask for the right kind, so the day there is something to
   * preserve, only this function changes.
   */
  function reboot(kind: ResetKind): void {
    void kind
    if (lastBytes) loadProgram(lastBytes, lastName, lastDir)
  }

  // ---- the 50Hz loop ----
  let acc = 0
  let last = performance.now()
  let raf = 0
  let alive = true

  function loop(now: number): void {
    if (!alive) return
    raf = requestAnimationFrame(loop)
    syncSerialSlot()
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
    setPort(rt.input.ports[1], kbJoy[1]!, pads[0] ?? null)
    setPort(rt.input.ports[0], kbJoy[0]!, pads[1] ?? null)
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
    // A reset keyword records the request and stops the program; carrying it
    // out is this loop's job, because it means building a new Runtime and the
    // keyword was running inside the old one. Read AFTER the frames, so the
    // program that asked has already stopped.
    const req = machine.takeReset()
    if (req) {
      reboot(req.kind)
      return
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
      reboot('cold')
    },
    reset(kind: ResetKind = 'cold'): void {
      reboot(kind)
    },
    get machine() {
      return machine
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
    async requestSerialPort(): Promise<boolean> {
      const got = await serialHost.requestAccess()
      syncSerialSlot()
      return got
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
