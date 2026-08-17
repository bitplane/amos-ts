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
 * The POSITION is here too, and it took a second look to see why. A mouse has
 * no position: it has two quadrature counters in JOY0DAT that wrap through
 * eight bits, and the pointer's coordinates are Intuition's, kept by counting
 * the deltas. So position looked like AMOS's business and buttons like the
 * machine's.
 *
 * Except that three extensions read JOY0DAT as a counter and every one of
 * them derives it from this position: GameSupport's `Gsmousedx`, AMON's, and
 * The Game's, each with its own private copy of
 * `port === 0 ? mouseDat(mouseX, mouseY) : joyDatOf(ports[1])`. The counter
 * IS the position modulo 256 (see `mouseDat`), so the position is what the
 * register is made of, and holding it anywhere else means holding it three
 * more times. The units are the host's, which are AMOS's hardware coordinate,
 * a lowres pixel plus a 128/50 origin.
 *
 * DEVIATION: a real mouse reports movement and the counters wrap freely
 * through their own eight bits. This one is handed an absolute position that
 * the host has already clipped to the screen, so a program that keeps
 * differencing the counters sees the movement stop at the edge rather than
 * run on. `counterDelta` recovers the right answer for every step under 128
 * counts either way, which is the same bound the hardware has.
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
import { BTN_BLUE, BTN_PLAY, BTN_RED } from './controller'
import type { Device } from './device'
import { mouseDat } from './gameport'

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
  /**
   * What is moving the pointer, since the slot already says "mouse".
   *
   * Same reasoning as `../amiga/keyboard.ts`: the connector is named by the
   * machine and what is on the end of it is the host's to say.
   */
  readonly name: string

  readonly description =
    'Two quadrature counters read as JOY0DAT, which is why the position is ' +
    'the count modulo 256 and wraps. The buttons are pins on two chips: left ' +
    'on CIA-A PRA bit 6, right and middle on POTGOR bits 10 and 8.'

  constructor(name = 'mouse') {
    this.name = name
  }

  /** `MOUSE_*` bits held down */
  buttons = 0

  /**
   * Where the host says the pointer is, in AMOS hardware coordinates.
   *
   * The boot position is the middle of a 320x200 screen at the standard
   * origin, which is where AMOS puts the pointer before a program has moved
   * it.
   */
  x = 128 + 160
  y = 50 + 100

  /** is a button down? */
  down(b: number): boolean {
    return (this.buttons & b) !== 0
  }

  /** JOY0DAT: the two counters, which are the position through eight bits */
  dat(): number {
    return mouseDat(this.x, this.y)
  }
}

/**
 * The mouse's three buttons in `./controller.ts`'s packing, so the pins do
 * not have to know which of the two is plugged in.
 *
 * The mapping is the one `controller.ts` states from `libraries/lowlevel.h`'s
 * comments: RED is "Select; Left Mouse; Joystick Fire", BLUE is the right
 * button, PLAY is the middle. The numbers differ, which is why this exists:
 * `MOUSE_MIDDLE` is 4 and `BTN_PLAY` is 64, so passing the mouse's byte
 * straight to a pin reader would report the yellow pad button instead.
 */
export function mouseAsButtons(m: Mouse): number {
  let b = 0
  if (m.down(MOUSE_LEFT)) b |= BTN_RED
  if (m.down(MOUSE_RIGHT)) b |= BTN_BLUE
  if (m.down(MOUSE_MIDDLE)) b |= BTN_PLAY
  return b
}
