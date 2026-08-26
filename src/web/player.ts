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
import { Amos } from '../amos/amos'
import { ED } from '../editor/commands'
import { EditorDialogues } from '../amos/dialogue'
import { EditorScreen } from '../amos/screen'
import { QUAL, type EdKey } from '../editor/keymap'
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
  CTRL_NONE,
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
import type { AmigaAudioModel } from '../amiga/mixer'
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
  /*
   * The numeric keypad and Help, which only the editor asks for.
   *
   * Read off `.Ed_KFonc` rather than recalled: the ten Ctrl-numpad records
   * run commands 49 to 58 in order, which are Set Mark 0 to Set Mark 9, so
   * the codes ARE the digits and their order settles the layout. Help is
   * `$5f`, the last row of `Cla_Special` (+W.s:12917), where it stores ASCII
   * 0 with its scancode.
   */
  Numpad0: 0x0f, Numpad1: 0x1d, Numpad2: 0x1e, Numpad3: 0x1f, Numpad4: 0x2d,
  Numpad5: 0x2e, Numpad6: 0x2f, Numpad7: 0x3d, Numpad8: 0x3e, Numpad9: 0x3f,
  // no browser sends a Help key, and Insert is where an Amiga keyboard's is
  Help: 0x5f, Insert: 0x5f,
}

/**
 * AMOS ASCII for the special keys (Cla_Special +W.s:12912): the cursor keys
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

/**
 * What is driving one gameport.
 *
 * The SOURCE, not the device: whether the Amiga sees a joystick or a CD32 pad
 * is `Controller.type` over on the machine, and it is a fact about what you
 * plugged in. This is where the pulses come from.
 *
 * A union rather than a boolean because the list grows. A touch overlay and a
 * remote player are both sources, and outside a browser an OS adapter is one
 * too, so nothing here should be spelled "keyboard or not".
 */
export type PortSource = { kind: 'keyboard' } | { kind: 'gamepad'; index: number }

/** a gamepad the browser can see, as a host page lists it */
export interface GamepadInfo {
  index: number
  /** the browser's own string, usually naming the make and the USB ids */
  id: string
}

function joyMap(k: JoyKeys | undefined): Record<string, number> {
  if (k === 'arrows') return KB_ARROWS
  if (k === 'wasd') return KB_WASD
  if (k === undefined || k === 'none') return {}
  return k
}

/** what an archive turned out to hold, and what was started from it */
export interface ArchiveResult {
  /** every AMOS program in the archive, by path inside it */
  programs: string[]
  /** the one that was started, or null when the choice was not obvious */
  ran: string | null
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
   * The editor holding the loaded program, or null for one it would not take.
   *
   * `Amos.call` runs an editor command, `Amos.key` a keystroke, and both come
   * back with the alert the editor would have shown. A host page that wants
   * to drive the editor from its own buttons uses this.
   */
  readonly editor: Amos | null
  /**
   * Mount an archive and run the program in it. Directories are preserved and
   * the current directory becomes the drawer holding the program, so its
   * relative loads resolve — which is how most games find their data.
   *
   * Answers what it found: every AMOS program in the archive, and which one
   * it started. A caller cannot work either out for itself, and a host that
   * guessed reported "holds no AMOS program" for an archive holding fifteen.
   */
  loadArchive(bytes: Uint8Array, name: string, run?: string): Promise<ArchiveResult>
  /** run one program, with `dir` as its drawer inside DH0: */
  loadProgram(bytes: Uint8Array, name: string, dir?: string[], vol?: string): void
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
  /**
   * Change a port's keyboard mapping after construction.
   *
   * Kept for embedders, and it still says both things at once: a real mapping
   * puts the port on the keyboard, and `'none'` hands it back to a gamepad.
   * A host that wants to be explicit calls `setPortSource`.
   */
  setJoystick(port: 0 | 1, keys: JoyKeys): void
  /** which source drives a port, and which pad when it is a pad */
  portSource(port: 0 | 1): PortSource
  setPortSource(port: 0 | 1, source: PortSource): void
  /**
   * The gamepads the browser can see right now.
   *
   * A live poll rather than a cached list, because `navigator.getGamepads()`
   * returns a fresh snapshot and a pad that has been unplugged leaves a null
   * in the array rather than shortening it. Indexes are therefore stable and
   * are what `PortSource` names.
   */
  gamepads(): GamepadInfo[]
  /** run flat out instead of at 50Hz — a development aid, not a feature */
  setTurbo(on: boolean): void
  /** which board's fixed output filter, ../amiga/audio.ts */
  setAudioModel(model: AmigaAudioModel): void
  /**
   * The wall time the battery clock is showing, or null with no board fitted.
   *
   * Through the chip rather than `Date.now()` plus its skew: the skew is
   * measured against a DateStamp, which carries no zone, so the arithmetic
   * done outside would be the host's zone offset out.
   */
  clockTime(): Date | null
  setClockTime(when: Date): void
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
  /**
   * The name of the program that is loaded, or '' before there is one.
   *
   * Survives a reset and survives the program ending, which is the point: a
   * host that shows only a transient status line loses track of WHICH demo is
   * on screen the moment anything else is worth saying.
   */
  readonly programName: string
  /**
   * Is a program still going?
   *
   * False once it runs off the end or hits `End`, and false before one is
   * loaded. A host showing "running" whether or not anything is happening is
   * the state this exists to distinguish.
   */
  isRunning(): boolean
  /**
   * Put AMOS's escape screen up, or take it down (Esc_Appear +Edit.s:9356).
   *
   * The program stops while it is there, but frames keep turning for a typed
   * line, because that is what direct mode is: a program going nowhere and a
   * line typed at it that runs. The Escape key does this; a host wanting its
   * own button calls it.
   */
  toggleDirect(): void
  readonly directOpen: boolean
  /** is a granted host port on the serial slot? */
  serialGranted(): boolean
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
/**
 * Where a keystroke goes: to the line editor, to Escape's flip, to the editor
 * or to the program.
 *
 * Escape flips, the way it does on the machine. `Ed_Escape` (+Edit.s:8876) is
 * entry 28 of the editor's own command table and runs `Ed_Hide` then
 * `Esc_Appear`; `Esc_Esc` (:9125) is `Esc_Hide` then `Ed_Appear`. One key,
 * both directions, and the second half is already `DirectScreen.key`'s.
 *
 * The flip is between the escape screen and the EDITOR, which is what
 * `Ed_Appear` puts back. A player with no editor -- a program the editor
 * would not take -- has nothing on the other side, so Escape uncovers the
 * program's own display instead. `editorUp` is which of the two this is.
 *
 * And only once the program has stopped. A running one owns the keyboard:
 * Escape is an ordinary key a game reads, `Esc_Appear` is reached from
 * `Ed_Loop` and `Esc_Loop` and from nowhere the interpreter runs, and there
 * is no AMOS in which a game is interrupted with it. Ctrl-C is the key that
 * does that, and it is handled a few lines above.
 */
export function keyRoute(
  escapeScreenUp: boolean,
  programDone: boolean,
  code: string,
  scan: number,
  editorUp = false,
): 'line' | 'escape' | 'editor' | 'program' {
  if (escapeScreenUp) return 'line'
  if (editorUp) return 'editor'
  if (programDone && (code === 'Escape' || scan === 0x45)) return 'escape'
  return 'program'
}

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
  vfs.mountMemory('CLIPS') // the clipboard handler, which GUI 2.10 opens as CLIPS:0
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
  /**
   * The editor, holding whatever program was loaded.
   *
   * `Prg_RunIt` (+Verif.s:4336) is a jump: the editor's stack is thrown away
   * and the interpreter never returns to it. So a program running here is the
   * editor's `Runtime` and not a second one, and the way back is
   * `Amos.finishRun`, which is `Prg_JError`.
   */
  let amos: Amos | null = null
  let systemResource = opts.systemResource
  let lastBytes: Uint8Array | null = null
  let lastName = ''
  let lastDir: string[] = []
  /** the volume the last program came from, so a reset reloads it from there */
  let lastVol = 'DH0'
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
  // one clock for the machine, so the battery clock can be read and set
  // without a Runtime existing: a host page draws its hardware before the
  // first program is loaded
  const hostClock = systemClock()

  function syncSerialSlot(): void {
    const has = serialHost.granted > 0
    if (has === (machine.serial !== null)) return
    if (has) machine.attach('ser', new SerialCable('host serial port'))
    else machine.detach('ser')
  }

  /**
   * Whether a granted host port is on the slot.
   *
   * A host page drives the socket from its own hardware list now, so this only
   * reports. It used to run every frame and put the cable back, which fought
   * anyone choosing "nothing" on that row: the pick took, and a fiftieth of a
   * second later the cable was in again.
   */
  function serialGranted(): boolean {
    return serialHost.granted > 0
  }

  let error = ''
  /** has this program's ending already been reported? */
  let ended = false
  let running = opts.autoplay !== false
  let focused = false
  let turbo = false


  // ---- keyboard, scoped to focus ----
  const KB_PORT: [Record<string, number>, Record<string, number>] = [
    joyMap(opts.joystick?.port0),
    joyMap(opts.joystick?.port1),
  ]
  const kbJoy = [0, 0]

  /**
   * Which source drives each port.
   *
   * A gamepad index rather than "the first one", so unplugging pad 0 does not
   * silently hand pad 1 the port a player had chosen. An index that no longer
   * answers reads as nothing held down, which is what an unplugged stick does.
   */
  const portSource: [PortSource, PortSource] = [{ kind: 'gamepad', index: 1 }, { kind: 'gamepad', index: 0 }]

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!focused || !rt) return
    audio.unlock()
    // Ctrl-C is the break key, and only while a program is running. In the
    // editor it is an ordinary shortcut: `.Ed_KFonc` gives it to `Ed_BlocCut`
    // like any other letter with a qualifier, and there is nothing to break.
    if (e.ctrlKey && e.code === 'KeyC' && amos?.display?.isOpen !== true) {
      rt.interp.requestBreak()
      e.preventDefault()
      return
    }
    const scan = SCAN[e.code] ?? 0
    const ch = SPECIAL_CH[e.code] ?? (e.key.length === 1 ? e.key : '')
    // A requester owns the keyboard while it is up. `Ed_DoDialog` is inside
    // `Dia_RunProgram` and does not come back until a button is pressed, and
    // `Dia_Tests` (+Lib.s:24177) is what reads the keys: a `KY` record is how
    // the RETURN on `Editor [RETURN]` works at all.
    if (dialogues?.busy === true) {
      // straight onto the queue rather than through `pressKey`, which derives
      // the shift byte from the scancodes it has seen held: the qualifier
      // keys never reached `keyDown` on this path
      if (ch !== '' || scan !== 0) rt.input.keyQueue.push({ ch, scan, shift: qualifiers(e) })
      e.preventDefault()
      return
    }
    // A qualifier is held, not typed. `Cla_Event` (+W.s:12813) is
    //
    //     cmp.b #$68,d0 / bcc.s .RawK
    //     cmp.b #$40,d0 / bcs.s .RawK
    //     cmp.b #$60,d0 / bcc .Cont
    //
    // and `.Cont` records the key in `T_ClTable` without `Cla_Stocke`:
    // "Shifts>>> pas stockes", the source's own comment. Sending Shift to
    // `Ed_Key` made it a keystroke with no command and no ASCII, and the
    // editor moved the cursor on for it.
    if (scan >= 0x60 && scan < 0x68) {
      rt.keyDown(scan)
      return
    }
    const editorUp = amos?.display?.isOpen === true && !amos.inEscape
    const route = keyRoute(rt.directScreen.isOpen, rt.interp.done, e.code, scan, editorUp)
    if (route === 'line') {
      // Escape here is `Esc_Esc`, which is `Esc_Hide` then `Ed_Appear`, so
      // the editor comes back. `Amos.key` routes it: the escape screen owns
      // the keyboard while it is up and Escape is the one key both sides
      // want.
      if (amos !== null) {
        toEditor(amos.key(edKeyOf(e, ch, scan)))
      } else {
        rt.directScreen.key(ch, scan, e.shiftKey)
      }
      e.preventDefault()
      return
    }
    if (route === 'editor') {
      toEditor(amos!.key(edKeyOf(e, ch, scan)))
      e.preventDefault()
      return
    }
    if (route === 'escape') {
      // `Ed_Escape` (+Edit.s:8876), entry 28 of the editor's own table
      if (amos !== null) toEditor(amos.call(ED.ESCAPE))
      else rt.directScreen.open()
      e.preventDefault()
      return
    }
    rt.keyDown(scan)
    for (let p = 0; p < 2; p++) if (KB_PORT[p]![e.code] !== undefined) kbJoy[p]! |= KB_PORT[p]![e.code]!
    if (ch !== '') rt.pressKey(ch, scan)
    // only swallow the browser's own use of a key once we have the keyboard
    if (e.code === 'Space' || e.code === 'Backspace' || e.code === 'Tab' || e.code.startsWith('Arrow')) {
      e.preventDefault()
    }
  }
  /**
   * A browser key event as `Ed_Key` wants it.
   *
   * `.Ed_KFonc` (+Editor_Config.s) is 184 three-byte records of scancode and
   * qualifiers, so the editor matches on the SCANCODE and the browser is the
   * first host this port has had that supplies one. `e.code` is a physical
   * key and `SCAN` maps it to the Amiga's own number.
   */
  function edKeyOf(e: KeyboardEvent, ch: string, scan: number): EdKey {
    return { ch, scan, shift: qualifiers(e) }
  }

  /** the four qualifier GROUPS (+Equ.s:775-778), as the CIA delivers them */
  function qualifiers(e: KeyboardEvent): number {
    let shift = 0
    if (e.shiftKey) shift |= QUAL.SHIFT
    if (e.ctrlKey) shift |= QUAL.CTRL
    if (e.altKey) shift |= QUAL.ALT
    if (e.metaKey) shift |= QUAL.AMIGA
    return shift
  }

  /**
   * The editor's requesters, running as the Interface programs they are.
   *
   * Made per `Amos`, because the channel is opened on that machine's dialogue
   * table and `Edt_ClearVar` throws the machine away.
   */
  let dialogues: EditorDialogues | null = null

  /**
   * `Ed_Dialogue` (+Edit.s:3107): put the question up, or answer it here.
   *
   * A requester that draws takes as many frames as the user does, so the loop
   * below finishes it; one this port cannot draw is answered on the spot with
   * its first button, which is `Ed_Zappeuse`'s answer.
   */
  function askEditor(): void {
    if (amos === null) return
    const ask = amos.pendingAsk
    if (ask === null) return
    dialogues ??= new EditorDialogues(() => amos!.runtime!, EditorScreen.EC_EDIT)
    const now = dialogues.start(ask)
    if (now !== undefined) toEditor(amos.answer(now))
    // a question this port cannot put up is answered with its first button,
    // which is `Ed_Zappeuse`'s answer
    else if (!dialogues.busy) toEditor(amos.answer(1))
  }

  /** whatever the editor answered, and whatever it asked for afterwards */
  function toEditor(alert: number): void {
    void alert
    if (amos === null) return
    if (amos.pendingAsk !== null) {
      askEditor()
      return
    }
    if (amos.pendingRun !== null) {
      ended = false
      amos.display?.close()
      rt = amos.startRun()
      return
    }
    if (amos.inEscape) rt?.directScreen.open()
    else if (rt?.directScreen.isOpen === true) rt.directScreen.close()
    if (!amos.inEscape) amos.openDisplay()
    rt = amos.runtime ?? rt
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
  /** `Ed_MkCpt(a5)`: how many polls this mouse button has been held for */
  let heldFor = -1
  /** which button that is, since `Ed_Mouse` reads `and.w #3,d7` and branches on it */
  let heldButton = 0
  const onMove = (e: MouseEvent): void => {
    if (!rt) return
    const r = canvas.getBoundingClientRect()
    rt.input.mouseX = 128 + Math.floor(((e.clientX - r.left) / r.width) * 320)
    rt.input.mouseY = Runtime.COMPOSITE_TOP + Math.floor(((e.clientY - r.top) / r.height) * Runtime.COMPOSITE_LINES)
    // a held button drags the cursor through the text, which is how a block
    // is made with the mouse: `Ed_Mouse` is called again every poll and
    // `Ed_MkCpt` is what tells the two apart
    if (heldFor >= 0) {
      heldFor++
      editorClick(heldButton, heldFor)
    }
  }

  /** `Ed_Mouse` (+Edit.s:1206), with the pointer converted to the editor screen */
  function editorClick(button: number, count: number): void {
    const d = amos?.display
    if (d?.isOpen !== true || amos!.inEscape || !rt) return
    const s = d.screen
    if (s === null) return
    // the routine reads `XyMou` and then `XyScr`, so the click it acts on is
    // in the editor SCREEN's coordinates and not the display's
    toEditor(amos!.mouse(s.hardToScreenX(rt.input.mouseX), s.hardToScreenY(rt.input.mouseY), button, count))
  }
  const btn = (e: MouseEvent): number => (e.button === 2 ? 2 : e.button === 1 ? 4 : 1)
  const onDown = (e: MouseEvent): void => {
    container.focus()
    audio.unlock()
    if (!rt) return
    rt.input.mouseK |= btn(e)
    e.preventDefault()
    heldFor = 0
    heldButton = btn(e)
    editorClick(heldButton, 0)
  }
  const onUp = (e: MouseEvent): void => {
    if (rt) rt.input.mouseK &= ~btn(e)
    heldFor = -1
    heldButton = 0
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

  /**
   * Feed one gameport from the source the host chose for it.
   *
   * `c.type` is NOT written here, and used to be. The old code set
   * CTRL_GAMEPAD whenever a real pad was plugged into the user's computer and
   * CTRL_JOYSTICK when it was not, which made `lowlevel.library`'s
   * `ReadJoyPort` report the PLAYER's hardware instead of the machine's. It
   * also meant a port could never be empty: `Machine.detach` sets CTRL_NONE
   * and the next frame put a stick straight back.
   *
   * An empty port takes nothing at all, which is the state a program checking
   * for a connected controller has to be able to see.
   */
  function setPort(c: Controller, port: 0 | 1, pads: readonly (Gamepad | null)[]): void {
    if (c.type === CTRL_NONE) return
    const src = portSource[port]
    if (src.kind === 'keyboard') {
      // a keyboard stick is a one-button stick, and assigning the five bits
      // assigns the whole of one
      applyJoyBits(c, kbJoy[port]!)
      return
    }
    applyJoyBits(c, 0)
    const gp = pads[src.index] ?? null
    if (!gp) return
    const ax = gp.axes
    if ((ax[1] ?? 0) < -0.5 || gp.buttons[12]?.pressed) c.dirs |= DIR_UP
    if ((ax[1] ?? 0) > 0.5 || gp.buttons[13]?.pressed) c.dirs |= DIR_DOWN
    if ((ax[0] ?? 0) < -0.5 || gp.buttons[14]?.pressed) c.dirs |= DIR_LEFT
    if ((ax[0] ?? 0) > 0.5 || gp.buttons[15]?.pressed) c.dirs |= DIR_RIGHT
    for (const [i, button] of PAD_BUTTONS) if (gp.buttons[i]?.pressed) c.buttons |= button
  }

  // ---- loading ----
  function loadProgram(bytes: Uint8Array, name: string, dir: string[] = [], vol = 'DH0'): void {
    ended = false
    lastBytes = bytes
    lastName = name
    lastDir = dir
    lastVol = vol
    error = ''
    // Silence the four voices first. The sink is made once and shared by every
    // Runtime, the way `machine` is, so building a new one leaves whatever was
    // playing still playing --- a reset stopped the program and the music
    // carried on forever. On the machine a reset clears DMACON, and the audio
    // DMA bits go with it.
    for (let v = 0; v < 4; v++) audio.stop(v)
    // the program's own drawer becomes current, so its relative loads
    // resolve --- and on the VOLUME it came from, since a dropped drawer is
    // mounted as one and `Load "Examples:x"` is how its author wrote it
    vfs.currentDir = dir.length > 0 ? `${vol}:${dir.join('/')}` : `${vol}:`
    // one machine, many Runtimes: it is what a reset destroys the environment
    // ON, so it outlives every environment built here
    const shared = {
      machine,
      onUnimplemented: 'skip' as const,
      audio,
      fs: vfs,
      host: { clock: hostClock, printer: printText, printerPage: printPage, serial: serialHost },
    }
    amos = null
    dialogues = null
    try {
      amos = intoEditor(bytes, shared)
    } catch (e) {
      // The editor could not hold it, so there is no editing this one. That
      // is the Test pass or `Prg_Load` refusing it, and the interpreter is
      // more forgiving than either, so the program still runs.
      console.warn('amos-ts: the editor would not take this program:', e)
    }
    try {
      if (amos !== null) {
        // This host HAS a display, so `Ed_OpenEditor` has something to open.
        // It is not opened yet: `Ed_Run` hides the editor and the program
        // owns the screen until it stops.
        amos.useDisplay()
        // `Ed_Run` (+Edit.s:8165), which Tests the program and then jumps.
        // `hostFrames` leaves it waiting rather than running it here.
        const alert = amos.call(ED.RUN)
        if (amos.pendingRun !== null) {
          rt = amos.startRun()
        } else if (amos.pendingAsk !== null) {
          // `Ed_Run` asked something before it got to `Prg_RunIt`. The loop
          // draws the requester and the answer starts the program.
          rt = amos.openDisplay().screen === null ? null : (amos.runtime ?? null)
          if (rt === null) throw new Error('the editor has no machine to ask on')
        } else {
          // It refused, and said why on the status line. The program still
          // runs: the interpreter is more forgiving than the editor and a
          // player that will not play is worse than one that cannot edit.
          // `Ed_FCall` answers 0 for a failed Test pass the same as for a
          // success, so the reason is in `Ed_ErrTest`'s code and not in the
          // alert. This is the one a program hits: the interpreter runs
          // things the Test pass will not have.
          const t = amos.testError
          const why = t.code >= 0 ? `the Test pass refused it: ${t.text}` : amos.alert.text || `Ed_Run answered ${alert}`
          console.warn(`amos-ts: ${why}; running it unedited`)
          status(`${name} runs, but the editor will not take it (${why})`)
          amos = null
          dialogues = null
        }
      }
      if (amos === null) {
        const c = compileProgram(bytes, table)
        rt = new Runtime(c.lines, table, {
          ...shared,
          extensions: c.extensions,
          extBindings: c.bindings,
          banks: c.amos?.banks ?? [],
        })
      }
      if (rt === null) throw new Error('nothing to run this program on')
      if (systemResource) rt.loadSystemResource(systemResource)
      status(`running ${name}`)
      if (!running) overlay.style.display = 'flex'
    } catch (e) {
      rt = null
      amos = null
      error = e instanceof Error ? e.message : String(e)
      fail(error)
      console.error('amos-ts: failed to load program:', e)
    }
  }

  /** `Prg_Load` into a window, with the host's machine under whatever it runs */
  function intoEditor(bytes: Uint8Array, shared: Record<string, unknown>): Amos {
    return new Amos(bytes, {
      table,
      hostFrames: true,
      fs: vfs as never,
      runtime: shared as never,
    })
  }


  async function loadArchive(bytes: Uint8Array, name: string, run?: string): Promise<ArchiveResult> {
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
    // every extension the archive reader claims, or an .lha mounts as
    // `MiscExt_lha:` because the dot was mangled instead of stripped
    const fromName = name.replace(/\.(adf|lha|lzh|zip|tar|tar\.gz|tgz)$/i, '').replace(/[^A-Za-z0-9_]/g, '_')
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
      if (segs.length > 0) vfs.writeTo('DH0', segs, e.data)
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
      return { programs, ran: null }
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
    assignAmosPro(vol)
    const file = entries.find((e) => e.path === pick.path)!
    loadProgram(file.data, segs[segs.length - 1]!, dir)
    return { programs, ran: pick.path }
  }

  /**
   * The four assigns an AMOS Professional install makes.
   *
   * `AMOSPro_Accessories:`, `AMOSPro_System:`, `AMOSPro_Tutorial:` and
   * `AMOSPro_Compiler:` are how the editor's own configuration names things:
   * `.Ed_AutoLoad` (+Editor_Config.s:67) binds 37 commands to programs under
   * them, and every path in it starts with one. On the machine they are made
   * by the startup script against the AMOSPro drawer; here the drawer is
   * whatever archive was dropped in, so they point at its root.
   *
   * Unconditional. An assign to a drawer that is not there simply does not
   * resolve, which is what a machine without the accessories installed does,
   * and testing first would mean guessing which of several layouts is the
   * install.
   */
  function assignAmosPro(vol: string): void {
    for (const part of ['Accessories', 'System', 'Tutorial', 'Compiler']) {
      vfs.assign(`AMOSPro_${part}`, `${vol}:${part}`)
    }
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
    if (lastBytes) loadProgram(lastBytes, lastName, lastDir, lastVol)
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
    // The escape screen does NOT stall this loop. `Runtime.frame` holds the
    // interpreter on its own and lets the rest of the machine run, which is
    // what a stopped program leaves behind: the audio clock keeps turning, so
    // the 0.7 seconds of PCM a typed `Say` hands over actually gets rendered.
    // Stalling here starved the mixer and made speech silent.
    let frames = 0
    if (turbo) {
      frames = 20
      acc = 0
    } else if (acc >= FRAME_MS) {
      frames = 1
      acc -= FRAME_MS
    }
    const pads = navigator.getGamepads?.() ?? []
    setPort(rt.input.ports[1], 1, pads)
    setPort(rt.input.ports[0], 0, pads)
    for (let i = 0; i < frames; i++) {
      // Say so, ONCE. A finished program looks exactly like a running one
      // that is drawing nothing --- the canvas keeps its last frame and the
      // loop keeps turning --- so there was no way to tell "the End ran" from
      // "it has hung" or "it drew nothing".
      if (rt.interp.done) {
        if (!ended) {
          ended = true
          opts.onStatus?.('program ended')
          if (amos !== null) {
            // `RunErr` (+ILib.s:1267) is one exit with a number in d0, and
            // `Ed_Errr` (+Edit.s:8261) branches on it and nothing else: 10 is
            // End and goes to `Ed_Ligne`, 1000 is Edit, 1001 is Direct and
            // opens the escape screen, 1002 is System. Where a stopped
            // program leaves you is that routine's answer and not this
            // loop's.
            // `Ed_Errr` (+Edit.s:8261) is what opens the editor, or does not:
            // `Ed_Ligne` and `Ed_ErrEdit` both call `Ed_OpenEditor` and
            // `Ed_ErrDirect` opens the escape screen over it
            amos.finishRun(rt.interp.endCode)
            rt = amos.runtime ?? rt
            if (amos.inEscape) rt.directScreen.open()
          } else {
            // Where a finished program leaves you with no editor. AMOS has no
            // way to reach direct mode from a running one --- Escape is an
            // ordinary key a game can read --- so the escape screen goes up
            // when the program stops and not before.
            rt.directScreen.open()
          }
        }
        // and the machine has to keep turning under it: the line editor
        // draws, a typed line runs over as many frames as it takes, and the
        // audio clock advances. `Runtime.frame` runs no statements for a
        // program that is done, so this costs nothing when nothing is typed.
        if (!rt.directScreen.isOpen && amos === null) break
        // `Ed_MnGere` (+Edit.s:1639): the menu bar is built when it is not
        // there and a pick goes to `Ed_FCall`. `stepMenus` ran it in
        // `rt.frame()` above and latched the path.
        if (amos !== null && dialogues?.busy !== true) toEditor(amos.pollMenu())
        // a requester on the screen is answered by the user over as many
        // frames as they take; `Dia_Tests` runs in `Runtime.frame` above.
        // The loop puts it up as well as taking it down, because a command
        // can be run from outside a keystroke.
        const ask = amos?.pendingAsk ?? null
        if (ask !== null) {
          if (dialogues?.busy !== true) askEditor()
          else {
            const got = dialogues.step(ask)
            if (got !== undefined) toEditor(amos!.answer(got))
          }
        }
        // `Ed_Run` again, from the editor this time
        const again = amos?.pendingRun ?? null
        if (again !== null) {
          ended = false
          amos!.display?.close()
          rt = amos!.startRun()
          continue
        }
        if (!rt.directScreen.isOpen && !(amos?.display?.isOpen ?? false)) break
      }
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
    toggleDirect(): void {
      if (!rt) return
      if (rt.directScreen.isOpen) rt.directScreen.close()
      else rt.directScreen.open()
    },
    get directOpen() {
      return rt?.directScreen.isOpen ?? false
    },
    get runtime() {
      return rt
    },
    get editor() {
      return amos
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
      // an empty mapping is the caller saying "not the keyboard", and the only
      // other source this player has is a pad
      portSource[port] =
        Object.keys(KB_PORT[port]!).length > 0 ? { kind: 'keyboard' } : { kind: 'gamepad', index: port === 1 ? 0 : 1 }
    },
    portSource(port: 0 | 1): PortSource {
      return portSource[port]
    },
    setPortSource(port: 0 | 1, source: PortSource): void {
      portSource[port] = source
      kbJoy[port] = 0
    },
    gamepads(): GamepadInfo[] {
      const pads = navigator.getGamepads?.() ?? []
      const out: GamepadInfo[] = []
      for (const [index, pad] of pads.entries()) if (pad) out.push({ index, id: pad.id })
      return out
    },
    setTurbo(on: boolean): void {
      turbo = on
      acc = 0
      // the machine's CPU is where the mode lives, so a hardware page reading
      // `machine.cpu.ignoreClock` and this setter cannot disagree
      machine.cpu.ignoreClock = on
    },
    clockTime(): Date | null {
      return machine.battclock?.wallTime(hostClock.now()) ?? null
    },
    setClockTime(when: Date): void {
      machine.battclock?.setTo(when, hostClock.now())
    },
    setAudioModel(model: AmigaAudioModel): void {
      machine.audio.model = model
      if (audio instanceof MixerSink) audio.setModel(model)
    },
    setSystemResource(bytes: Uint8Array): void {
      systemResource = bytes
      if (rt) rt.loadSystemResource(bytes)
    },
    focus(): void {
      container.focus()
    },
    serialSupported: serialAvailable(),
    get programName(): string {
      return lastName
    },
    isRunning(): boolean {
      return rt !== null && !rt.interp.done && error === ''
    },
    serialGranted,
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
