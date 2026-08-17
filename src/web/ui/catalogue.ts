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
import { CTRL_GAMEPAD, CTRL_JOYSTICK, CTRL_MOUSE, Controller } from '../../amiga/controller'
import type { Device, Slot } from '../../amiga/device'
import { BattClock } from '../../amiga/battclock'
import { Keyboard } from '../../amiga/keyboard'
import { Mouse } from '../../amiga/mouse'
import { FourPlayerAdaptor, Printer } from '../../amiga/parallel'
import { SerialCable } from '../../amiga/serialport'
import { FloppyDrive, driveUnit } from '../../amiga/trackdisk'
import type { JoyKeys } from '../player'

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

/**
 * What is on the other end of the port, in the row's own words.
 *
 * The source is part of the device rather than a setting on the socket: a
 * keyboard joystick and a gamepad joystick are two different things you plug
 * in, and the Amiga sees an identical one-button stick from either. `'none'`
 * is the absence of a key layout, which is what makes a port gamepad-driven.
 */
export function sourceLabel(keys: JoyKeys): string {
  if (keys === 'none') return 'gamepad'
  const named = BINDINGS.find((b) => b.value === keys)
  return named ? `keyboard, ${named.label}` : 'keyboard, custom keys'
}

export interface Fitting {
  /** stable, and what `currentFitting` answers with */
  id: string
  label: string
  make(): Device
  /**
   * For a gameport: which keys drive it once it is in.
   *
   * A stick with nothing on the other end of it is not much use, so the
   * choice of device and the choice of what moves it are one action here.
   * Real gamepads drive every port whatever this says, so `'none'` means
   * gamepad only rather than dead.
   */
  keys?: JoyKeys
}

/**
 * Everything this page can put in the slot.
 *
 * A fixed connector still gets its list. What makes it fixed is that the row
 * adds no "nothing" to it, so the control shows what is there and offers no
 * way to empty it. Returning nothing at all for a fixed slot left the row with
 * no control, which reads as broken rather than as deliberate.
 */
export function fittings(slot: Slot): Fitting[] {
  switch (slot.takes) {
    case 'clock':
      return [{ id: 'a501', label: 'A501 battery clock', make: () => new BattClock() }]
    case 'gameport':
      // the mouse's own connector, which is fixed and holds the host pointer
      if (slot.id === 'mouse') {
        return [{ id: 'browser-mouse', label: 'browser mouse', make: () => new Mouse() }]
      }
      return [
        { id: 'joy-pad', label: 'gamepad joystick', make: () => new Controller(CTRL_JOYSTICK), keys: 'none' },
        { id: 'joy-kb', label: 'keyboard joystick', make: () => new Controller(CTRL_JOYSTICK), keys: 'arrows' },
        { id: 'cd32-pad', label: 'gamepad CD32 pad', make: () => new Controller(CTRL_GAMEPAD), keys: 'none' },
        { id: 'cd32-kb', label: 'keyboard CD32 pad', make: () => new Controller(CTRL_GAMEPAD), keys: 'arrows' },
        { id: 'mouse', label: 'mouse', make: () => new Controller(CTRL_MOUSE), keys: 'none' },
      ]
    case 'parallel':
      return [
        { id: 'fourplayer', label: 'four-player adaptor', make: () => new FourPlayerAdaptor() },
        { id: 'printer', label: 'printer', make: () => new Printer() },
      ]
    case 'serial':
      return [{ id: 'cable', label: 'serial cable', make: () => new SerialCable() }]
    case 'keyboard':
      // what supplies the keystrokes. A browser today; a shell or a script is
      // the same slot with something else on the ribbon.
      return [{ id: 'browser', label: 'browser keyboard', make: () => new Keyboard() }]
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
export function currentFitting(slot: Slot, keys: JoyKeys): string {
  const dev = slot.device
  if (!dev) return NOTHING
  if (slot.takes === 'gameport' && slot.id !== 'mouse') {
    const driver = keys === 'none' ? 'pad' : 'kb'
    if (dev.name === 'mouse') return 'mouse'
    return dev.name === 'CD32 pad' ? `cd32-${driver}` : `joy-${driver}`
  }
  if (slot.takes === 'parallel') return dev.name === 'printer' ? 'printer' : 'fourplayer'
  return fittings(slot)[0]?.id ?? ''
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
