/**
 * The mouse, which on this machine is three pins and nothing else.
 *
 * ## Why the buttons are here and the pointer is not
 *
 * A mouse in gameport 0 puts its three buttons on three different registers,
 * and every one of them is hardware a program reads directly:
 *
 *     left     CIA-A PRA bit 6, FIR0        `cia.i`:111, active low
 *     right    POTGOR bit 10, DATLY         active low
 *     middle   POTGOR bit 8,  DATLX         active low
 *
 * CRAFT's `=Hw Mouse Key` (routine 190, $313a) reads the first from $bfe001
 * and the other two from $dff016 rather than asking the operating system,
 * which is the point of the keyword: it works whether or not an AMOS screen
 * is up. Those bits have to come from somewhere, and until this file they
 * came from a field on the interpreter.
 *
 * The POSITION does not. The mouse has no position: it has two quadrature
 * counters in JOY0DAT that wrap through eight bits (see ./gameport.ts), and
 * the pointer's coordinates are Intuition's, maintained by counting the
 * deltas. What this port holds is neither, it is AMOS's hardware coordinate
 * (lowres pixel plus a 128/50 origin) delivered whole by the host, and that
 * is AMOS's coordinate space rather than the machine's. It stays on the AMOS
 * side of the line, which is `./README.md`'s rule about `Set Bob`'s minterm
 * applied to an input instead of an output.
 *
 * ## DEVIATION: gameport 0 holds two things at once
 *
 * A real port has one connector and one device in it. This machine keeps a
 * mouse AND `ports[0]` at the same time, so `Mouse Key` and `Joy(0)` read
 * separate state for what is physically pin 6. CIA-A's FIR0 is therefore the
 * OR of the two, which is what the pin would do if both were somehow wired
 * to it, and which at least means one register cannot disagree with itself.
 *
 * It is a deviation and not a design: the fix is for the hardware page to
 * choose what is in port 0, at which point the mouse becomes the device in
 * that slot and the OR goes away. `Controller.type` already has `CTRL_MOUSE`
 * waiting for it.
 */
import type { Device } from './device'

/**
 * The button bits, in the order AMOS's `Mouse Key` returns them.
 *
 * These are not the register's bits and are not `controller.ts`'s either.
 * `Mouse Key` answers 1 for left, 2 for right and 3 for both (FnMsKey
 * +Lib.s), so this is the packing the port already had, named.
 */
export const MOUSE_LEFT = 1
export const MOUSE_RIGHT = 2
export const MOUSE_MIDDLE = 4

/**
 * A two-button mouse, which is what an Amiga shipped with.
 *
 * The middle button is modelled because POTGOR has a pin for it and a
 * three-button mouse plugged into that pin works, but no host reports one,
 * so it is always up.
 */
export class Mouse implements Device {
  readonly kind = 'gameport' as const
  readonly name = 'mouse'

  /** `MOUSE_*` bits held down */
  buttons = 0

  /** is a button down? */
  down(b: number): boolean {
    return (this.buttons & b) !== 0
  }
}
