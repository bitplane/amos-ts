/**
 * The digital gameport as AMOS reads it: two ports, four directions, a fire.
 *
 * ## Why this is here and NOT in `src/amiga`
 *
 * It was planned as `src/amiga/gameport.ts`, and it does not qualify. The
 * layer's rule is that a module has to be shared **and AmigaOS**, and what is
 * actually shared here is the packing `Joy()` returns — `1` up, `2` down, `4`
 * left, `8` right, `16` fire. That is AMOS's surface, not the hardware's: the
 * machine has JOY0DAT/JOY1DAT holding quadrature counters and CIA-A PRA
 * holding the fire buttons active low, and none of those numbers appear in
 * it. Same call as AMOS's device layer, which is shared by every port that
 * drives a device and still lives in `src/runtime/device.ts`.
 *
 * The genuinely AmigaOS half — decoding JOYxDAT's quadrature into directions,
 * `POTGO` conversions, `gameport.device` — had **no caller** when this was
 * written. `input.joy` already arrived in this packing from the host, and
 * `sticks.ts` documents the registers while reading the same field. Writing a
 * register model for nobody is the machinery-to-sit-unused that
 * `src/amiga/README.md` warns against, so it was absent, and this file records
 * what the hardware really does so the next reader does not mistake the
 * packing for it.
 *
 * **That changed.** `src/amiga/controller.ts` now holds the device — its type
 * and its seven buttons — because two things needed more than five bits could
 * say: AMCAF's `Xfire` buttons 2 to 6, which had always read as not pressed,
 * and `lowlevel.library`'s `ReadJoyPort`. The register traffic is still
 * absent, for the reason above; what exists is the decoded device. This file
 * keeps AMOS's packing and owns the translation, which is the one place the
 * two orderings meet.
 *
 * ## What it replaces
 *
 * The five bits had no name anywhere and were spelled out as bare literals in
 * five places: `InputState`'s comment, `builtins.ts`'s `Joy()`, `sticks.ts`'s
 * `Multi Joy` (`j & 0x0f`, `j & 0x10`), and `web/player.ts` twice over — once
 * in each keyboard preset and again in the gamepad reader.
 *
 * ## The ports
 *
 * Port 0 is the mouse port and port 1 the joystick port, and `Joy()` errors
 * above 1 (FJ +Lib.s:13716). Both are real players: a two-player game reads
 * `Joy(0)` and `Joy(1)`, which is why the host tracks two sets of bits.
 */

import { BTN_RED, DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, type Controller } from '../amiga/controller'

/** the mouse port — a second player, when something digital is plugged in */
export const PORT_MOUSE = 0
/** the joystick port, which is what nearly every game reads */
export const PORT_JOYSTICK = 1
/** `Joy()` raises on anything above this */
export const MAX_PORT = 1

export const JOY_UP = 1
export const JOY_DOWN = 2
export const JOY_LEFT = 4
export const JOY_RIGHT = 8
export const JOY_FIRE = 16

/**
 * The direction nibble alone.
 *
 * Worth naming because it is the part two different packings agree on:
 * Sticks' `Multi Joy` returns these same four bits and then puts its buttons
 * at $10/$20/$40/$80, where AMOS's single fire is $10. A port translating
 * between the two masks the directions across and remaps the button.
 */
export const JOY_DIRECTIONS = JOY_UP | JOY_DOWN | JOY_LEFT | JOY_RIGHT

/** the directions, with any button bits dropped */
export function joyDirections(bits: number): number {
  return bits & JOY_DIRECTIONS
}

/** is the port's fire button down? */
export function joyFire(bits: number): boolean {
  return (bits & JOY_FIRE) !== 0
}

// -- the device, and AMOS's view of it ------------------------------------

/**
 * The direction swap, written once.
 *
 * AMOS counts up/down/left/right from bit 0; `lowlevel.library` — and so
 * `../amiga/controller.ts` — counts right/left/down/up. The two nibbles are
 * bit-reversed with respect to each other, which is the kind of fact that is
 * obviously true until someone writes `dirs & 0x0f` and ships it. Both
 * directions of the mapping come off this one table.
 */
const DIRS: ReadonlyArray<readonly [amos: number, dev: number]> = [
  [JOY_UP, DIR_UP],
  [JOY_DOWN, DIR_DOWN],
  [JOY_LEFT, DIR_LEFT],
  [JOY_RIGHT, DIR_RIGHT],
]

/**
 * A controller, as `Joy()` sees it.
 *
 * Fire is the pad's RED, because red is what a one-button stick's fire line
 * is: `libraries/lowlevel.h` names it "Select; Left Mouse; Joystick Fire".
 */
export function joyBitsOf(c: Controller): number {
  let bits = 0
  for (const [amos, dev] of DIRS) if ((c.dirs & dev) !== 0) bits |= amos
  if ((c.buttons & BTN_RED) !== 0) bits |= JOY_FIRE
  return bits
}

/**
 * Put AMOS's five bits back onto a controller.
 *
 * The five bits describe a one-button stick completely, so assigning them
 * assigns the whole digital state — RED included, and the other six buttons
 * cleared. Anything wanting a pad's extra buttons sets them on the controller
 * afterwards, or sets the controller directly; there is no way to reach them
 * through a packing that has no room for them, and pretending otherwise by
 * preserving them would make `input.joy = 0` fail to release a button.
 */
export function applyJoyBits(c: Controller, bits: number): void {
  let dirs = 0
  for (const [amos, dev] of DIRS) if ((bits & amos) !== 0) dirs |= dev
  c.dirs = dirs
  c.buttons = (bits & JOY_FIRE) !== 0 ? BTN_RED : 0
}
