/**
 * What is plugged into the machine.
 *
 * The port already models a battery clock, a keyboard, a mouse and two
 * controllers, and until now each one lived wherever its first caller put it:
 * the clock on `Machine`, the keyboard byte and the mouse coordinates inside
 * `InputState` on the interpreter, the controllers in a tuple beside them.
 * Nothing said what the machine HAS, so nothing could be removed, and a
 * hardware page had nothing to list.
 *
 * This is the join. A `Slot` is a connector, soldered on and always there; a
 * `Device` is what is in it, and a slot with `null` in it is an empty socket
 * rather than a missing feature. That distinction is the point of the file.
 * An empty gameport is already expressible and always was, as `CTRL_NONE`;
 * an unfitted battery clock is not, because `Machine.battclock` is
 * non-optional, and an A500 with no A501 expansion is the commonest Amiga
 * there was. Making it removable needs an answer to what `$DC0000` reads with
 * no chip behind it, which nothing here has yet.
 *
 * ## Why the slot list is not a registry
 *
 * `hardware()` returns a description for a caller that wants to draw the
 * tree. It is not where the devices live. The typed fields on `Machine` are,
 * because a drive is reached as `machine.drives[0]` by code that needs a
 * drive, and a lookup by string would let the two disagree. The list is a
 * view, in the same way `InputState.joy` is a view of `ports[1]`.
 *
 * ## What a kind is for
 *
 * `takes` says what fits, so a caller cannot put a mouse in the disk drive.
 * The kinds are the machine's own connectors and not a taxonomy: there is no
 * `'audio'` because nothing plugs into Paula, and no `'expansion'` because
 * nothing here models a Zorro card.
 */

/** the connectors this machine has */
export type DeviceKind =
  /** the battery-backed clock, on the A501 trapdoor board or a later motherboard */
  | 'clock'
  /** the keyboard's serial line into CIA-A */
  | 'keyboard'
  /** gameport 0 or 1: a mouse, a joystick, a CD32 pad, or nothing */
  | 'gameport'
  /** a floppy, DF0: to DF3: */
  | 'floppy'
  /** the 25-pin serial port, on CIA-B port A and Paula's SERDAT */
  | 'serial'
  /** the 25-pin parallel port, on CIA-A port B */
  | 'parallel'

export interface Device {
  /** which connector it fits. A mouse and a joystick are both `gameport`. */
  readonly kind: DeviceKind
  /**
   * What a hardware page prints for the device itself, not for the socket.
   *
   * The name is the device's, so two floppies read the same here and are told
   * apart by the slot they are in. Free text: a host that knows it has a
   * Chinon FZ-357A says so, and one that does not says "floppy drive".
   */
  readonly name: string
}

/**
 * A connector, and what is in it.
 *
 * `device` is read-only here because this is a description. Attaching and
 * detaching go through `Machine`, which owns the typed field the device
 * actually lives in.
 */
export interface Slot {
  /** the connector's name on the machine: `clock`, `port0`, `df0`, `ser` */
  readonly id: string
  /** what a hardware page prints for the connector */
  readonly label: string
  /** what fits in it */
  readonly takes: DeviceKind
  /** what is in it, or null for an empty socket */
  readonly device: Device | null
}

/** is anything in it? */
export const fitted = (s: Slot): boolean => s.device !== null
