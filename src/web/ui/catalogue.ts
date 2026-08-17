/**
 * What fits in an empty connector.
 *
 * `Machine.attach` refuses anything whose `kind` is not the slot's `takes`, so
 * this is the list that keeps a page from offering a refusal. It is a host's
 * catalogue rather than the machine's: nothing here says what an Amiga could
 * have, only what this port models well enough to plug in.
 *
 * A gameport is the interesting one. `CTRL_NONE` is not offered, because an
 * empty port is what detaching gives you and a "nothing" you attach would be
 * two ways to spell one state.
 */
import { CTRL_JOYSTICK, CTRL_MOUSE, Controller } from '../../amiga/controller'
import type { Device, Slot } from '../../amiga/device'
import { AUDIO_NAMES, PaulaAudio } from '../../amiga/audio'
import type { AmigaAudioModel } from '../../amiga/mixer'
import { BattClock } from '../../amiga/battclock'
import { M68000, M68020, M68030, M68040 } from '../../amiga/cpu'
import { Keyboard } from '../../amiga/keyboard'
import { Mouse } from '../../amiga/mouse'
import { FourPlayerAdaptor, Printer } from '../../amiga/parallel'
import { SerialCable } from '../../amiga/serialport'
import { FloppyDrive, driveUnit } from '../../amiga/trackdisk'
import type { JoyKeys, PortSource } from '../player'

/**
 * The key layouts a keyboard-driven port can carry.
 *
 * The named ones only. `JoyKeys` also takes a `Record<string, number>` of
 * arbitrary key codes, which an embedder can pass and a drop-down cannot
 * offer, so a port set that way reads as "custom keys" rather than lying.
 */
export type NamedKeys = 'none' | 'arrows' | 'wasd'

export const BINDINGS: readonly { value: NamedKeys; label: string }[] = [
  { value: 'arrows', label: 'arrow keys' },
  { value: 'wasd', label: 'WASD' },
]

/** how a keyboard-driven port describes its layout in the row */
export function keysLabel(keys: JoyKeys): string {
  const named = BINDINGS.find((b) => b.value === keys)
  return named ? named.label : 'custom keys'
}

export interface Fitting {
  /** stable, and what `currentFitting` answers with */
  id: string
  label: string
  make(): Device
  /** for a gameport: what will be driving it once it is in */
  source?: InputSource
  /**
   * Ask the host for a real serial port instead of attaching directly.
   *
   * Web Serial's chooser needs a user gesture, which a running program has not
   * got. Picking this from the row IS the gesture, which is why granting used
   * to be a button on the emulator bar and no longer needs to be.
   */
  hostSerial?: boolean
  /**
   * Which board's output stage this is.
   *
   * The mixer has to hear about it too, and the mixer is the host's, so the
   * row calls through rather than attaching: see `hostSerial` for the same
   * shape and the same reason.
   */
  audioModel?: AmigaAudioModel
}

/**
 * What can drive a gameport, as the host sees it right now.
 *
 * Host-supplied rather than listed here, because the list is not the same on
 * every browser and will not be the same outside one. A touch overlay, a
 * remote player and an OS adapter are all sources, and each is a host saying
 * what it can offer rather than this file guessing.
 */
export interface InputSource {
  /** stable within a host: `keyboard`, or `pad:0` */
  id: string
  label: string
  make(): PortSource
}

/** what the page can offer, which is not the same on every browser */
export interface CatalogueOptions {
  serialSupported: boolean
  /** empty is a real answer: no pad plugged in, and the row should say so */
  sources: readonly InputSource[]
}

/**
 * Everything this page can put in the slot.
 *
 * A fixed connector still gets its list. What makes it fixed is that the row
 * adds no "nothing" to it, so the control shows what is there and offers no
 * way to empty it. Returning nothing at all for a fixed slot left the row with
 * no control, which reads as broken rather than as deliberate.
 */
export function fittings(slot: Slot, opts: CatalogueOptions): Fitting[] {
  switch (slot.takes) {
    case 'cpu':
      // nothing here executes 68k, so these differ in name and clock rate and
      // in nothing a program can observe. ../../amiga/cpu.ts says why that is
      // a decision rather than a shortcut, and why the hierarchy exists now.
      return [
        { id: '68000', label: '68000', make: () => new M68000() },
        { id: '68020', label: '68020', make: () => new M68020() },
        { id: '68030', label: '68030', make: () => new M68030() },
        { id: '68040', label: '68040', make: () => new M68040() },
      ]
    case 'audio':
      // the model IS the device here. Both boards have a Paula and what
      // differs is the RC pair after it, so offering one "Paula" with a
      // hidden board setting would hide the only thing that varies.
      return [
        { id: 'a500', label: AUDIO_NAMES.a500, make: () => new PaulaAudio('a500'), audioModel: 'a500' },
        { id: 'a1200', label: AUDIO_NAMES.a1200, make: () => new PaulaAudio('a1200'), audioModel: 'a1200' },
      ]
    case 'clock':
      return [{ id: 'a501', label: 'A501', make: () => new BattClock() }]
    case 'gameport':
      // the mouse's own connector, which is fixed and holds the host pointer
      if (slot.id === 'mouse') {
        return [{ id: 'browser-mouse', label: 'browser', make: () => new Mouse('browser') }]
      }
      // the drop-down is the SOURCE now. Whether the Amiga sees a stick or a
      // CD32 pad is a fact about the hardware, not about where the pulses come
      // from, so it is a checkbox in the row rather than four combinations
      // here. A CD32 pad in a game that does not know about it IS a two-button
      // stick, which is why the two were never really different devices.
      return [
        ...opts.sources.map((src) => ({
          id: src.id,
          label: src.label,
          make: (): Device => new Controller(CTRL_JOYSTICK),
          source: src,
        })),
        { id: 'mouse', label: 'mouse', make: () => new Controller(CTRL_MOUSE) },
      ]
    case 'parallel':
      return [
        { id: 'fourplayer', label: 'four-player adaptor', make: () => new FourPlayerAdaptor() },
        { id: 'printer', label: 'printer', make: () => new Printer() },
      ]
    case 'serial':
      return [
        // NOT a bare cable. `SerialCable` asserts DSR and CTS, which is a lead
        // to something powered, so the label says so: a program that checks
        // the handshake before sending sees a peer that is there and ready,
        // and the bytes then go nowhere because there is no data path.
        { id: 'peer', label: 'lead to a live peer', make: () => new SerialCable('live peer') },
        // hidden where there is no Web Serial (Firefox, Safari, mobile)
        // rather than offered and failing, since nothing the user does there
        // could help
        ...(opts.serialSupported
          ? [
              {
                id: 'webserial',
                label: 'web serial',
                make: (): Device => new SerialCable('host serial port'),
                hostSerial: true,
              },
            ]
          : []),
      ]
    case 'keyboard':
      // what supplies the keystrokes. A browser today; a shell or a script is
      // the same slot with something else on the ribbon.
      return [{ id: 'browser', label: 'browser', make: () => new Keyboard('browser') }]
    case 'floppy': {
      // the unit is which /SELn line the drive answers, so it comes from the
      // slot rather than being chosen
      const unit = driveUnit(slot.id)
      return unit === null ? [] : [{ id: 'drive', label: 'floppy drive', make: () => new FloppyDrive(unit) }]
    }
    default:
      return []
  }
}

/** the id a slot's drop-down should be sitting on, or '' for none of them */
export function currentFitting(slot: Slot, sourceId: string): string {
  const dev = slot.device
  if (!dev) return NOTHING
  if (slot.takes === 'gameport' && slot.id !== 'mouse') {
    return dev.name === 'mouse' ? 'mouse' : sourceId
  }
  if (slot.takes === 'parallel') return dev.name === 'printer' ? 'printer' : 'fourplayer'
  // the two serial entries build the same class and are told apart by the name
  // the host gave it, which is the only thing that survives the attach
  if (slot.takes === 'serial') return dev.name === 'host serial port' ? 'webserial' : 'peer'
  if (slot.takes === 'cpu') return dev.name
  if (slot.takes === 'audio') return dev instanceof PaulaAudio ? dev.model : ''
  if (slot.id === 'mouse') return 'browser-mouse'
  return fittings(slot, { serialSupported: false, sources: [] })[0]?.id ?? ''
}

/** the option that empties a socket, which is what detach used to be */
export const NOTHING = 'nothing'

/**
 * The icon for a row.
 *
 * Keyed on the connector, then narrowed by what is in it, so an empty gameport
 * still looks like a gameport. The mouse and a mouse in a gameport get the same
 * one because they are the same thing in different sockets.
 */
export function iconFor(slot: Slot): string {
  if (slot.takes === 'gameport') {
    const name = slot.device?.name ?? ''
    return slot.id === 'mouse' || name === 'mouse' ? '🖱️' : '🕹️'
  }
  switch (slot.takes) {
    case 'cpu':
      return '🧠'
    case 'audio':
      return '🔊'
    case 'clock':
      return '⏰'
    case 'keyboard':
      return '⌨️'
    case 'floppy':
      return '💾'
    case 'parallel':
    case 'serial':
      return '🔌'
    default:
      return ''
  }
}
