/**
 * What plugs into the 25-pin parallel port.
 *
 * The port had the wires and nothing to put on the end of them. `cia.i`:119
 * puts the eight data lines on CIA-A port B and `cia.i`:127-129 puts BUSY,
 * POUT and SELECT on CIA-B port A, and `./cia.ts` has read both since it was
 * written. `Machine.parallel` was a nullable `ParallelLines` that nothing ever
 * set, so eleven keywords across three extensions read a connector that could
 * never have anything in it.
 *
 * ## The four-player adaptor
 *
 * A cable that hangs two more joysticks off the parallel port, and the one
 * peripheral this corpus has three independent readings of:
 *
 *     Sticks   =Stick Joy      routine 5  ($432)   move.b $bfe101,d3 / not.b
 *     Ercole   =Ext Joy        routine 8  ($482)   the same two instructions
 *     AMCAF    =Pjup family    routines 12-15      btst.b #n,$bfe101
 *
 * All three split the byte the same way: player 3 on bits 0-3, player 4 on
 * bits 4-7, in the order up, down, left, right, and CLEAR is pressed. That is
 * a switch pulling a pulled-up line down, so an unplugged connector reads $ff
 * and answers no direction at all. Ercole's readme names the hardware, *"the
 * parallel port 4 player adapter lead"*; Sticks' manual calls the same cable
 * the serial port and is wrong about it.
 *
 * ## Which line is whose fire, where the three disagree
 *
 * The fire buttons are not on the data byte. They are two of the printer's
 * three handshake lines, and the extensions do NOT agree about which:
 *
 *     AMCAF    routine 16 ($21d8/$21d0)   player 3 = SELECT, player 4 = BUSY
 *     Ercole   =Ext Fire, routine 9       player 3 = SELECT, player 4 = BUSY
 *     Sticks   =Stick Fire, routine 16    player 3 = BUSY,   player 4 = POUT
 *
 * Two against one, by two authors who did not read each other, so this cable
 * drives SELECT and BUSY and leaves POUT alone. The tie-breaker is not only
 * the count: Ercole's author names the peripheral correctly and Sticks' does
 * not, which is some evidence about who was looking at the cable.
 *
 * The consequence is visible rather than hidden. With an adaptor attached
 * `=Stick Fire(0)` reads BUSY and so reports PLAYER 4's button, and
 * `=Stick Fire(1)` reads POUT, which the adaptor never drives, so player 4
 * has no fire under Sticks at all. See `../runtime/sticks.ts`.
 *
 * ## One connector, two meanings
 *
 * BUSY and SELECT are a printer's status lines and the adaptor's fire
 * buttons because they are the same three pins. Attaching an adaptor
 * therefore moves Range's `=Busy Printer` and `=No Paper` as well, which is
 * not a bug in either extension: it is what putting a joystick lead into a
 * printer port does.
 */
import type { ParallelLines } from './cia'
import { DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, type Controller, BTN_RED, newController } from './controller'
import type { Device } from './device'

/**
 * Something on the parallel connector.
 *
 * A class rather than an interface so `Machine.attach` can check what it has
 * been handed with `instanceof` instead of trusting `kind` and casting.
 */
export abstract class ParallelDevice implements Device {
  readonly kind = 'parallel' as const
  abstract readonly name: string
  abstract readonly description: string
  /** what this device puts on the eleven lines `./cia.ts` reads */
  abstract lines(): ParallelLines
}

/**
 * One joystick's directions, in the nibble order the cable uses.
 *
 * Up 0, down 1, left 2, right 3, off AMCAF's four routines and Sticks'
 * `stickDir` calls, which agree bit for bit. `./controller.ts` counts the
 * other way round because `lowlevel.library` does, and the swap lives here
 * because it is the CABLE's order and not the OS's.
 */
function nibble(c: Controller): number {
  let n = 0
  if (c.dirs & DIR_UP) n |= 1
  if (c.dirs & DIR_DOWN) n |= 2
  if (c.dirs & DIR_LEFT) n |= 4
  if (c.dirs & DIR_RIGHT) n |= 8
  return n
}

/** the four-player adaptor: players 3 and 4, one per nibble */
export class FourPlayerAdaptor extends ParallelDevice {
  readonly name = 'four-player adaptor'

  readonly description =
    'Two more joysticks on the printer port. Their directions share the eight ' +
    "data lines, a nibble each, and their fire buttons ARE the printer's SELECT " +
    'and BUSY lines. Three extensions read it and they do not all agree which.'

  /**
   * The two sticks it carries, in the order the keywords number them: index
   * 0 is what every one of the eleven keywords calls port 0, which is the
   * THIRD player on the machine.
   */
  readonly sticks: [Controller, Controller] = [newController(), newController()]

  lines(): ParallelLines {
    const fire = (c: Controller): boolean => (c.buttons & BTN_RED) !== 0
    return {
      // pulled up, and a closed switch pulls its line down
      data: ~(nibble(this.sticks[0]) | (nibble(this.sticks[1]) << 4)) & 0xff,
      // the printer three are active high, so an undriven line reads true and
      // a pressed button is the line pulled low
      busy: !fire(this.sticks[1]),
      paperOut: true,
      selected: !fire(this.sticks[0]),
    }
  }
}

/**
 * A printer, which is what the three status lines are named after.
 *
 * The data byte reads idle, because nothing here drives a print stream down
 * this cable: AMOS prints through `printer.device` and reaches the host
 * through `Host.printer`, which is a stream of characters and not eight pins.
 * What this device is for is the three lines a program can ASK about —
 * Range's `=Busy Printer` and `=No Paper`, and Ercole's `=Ext Fire` reading
 * the same pins for something else entirely.
 */
export class Printer extends ParallelDevice {
  readonly name = 'printer'

  readonly description =
    'Eight data lines out, and three status lines back: SELECT for online, ' +
    'PAPEROUT and BUSY. All three are active HIGH, unlike almost everything ' +
    'else on the CIAs.'

  /** SELECT: the printer is on and has paper in it, in its own opinion */
  online = true
  paperOut = false
  busy = false

  lines(): ParallelLines {
    return { data: 0xff, busy: this.busy, paperOut: this.paperOut, selected: this.online }
  }
}
