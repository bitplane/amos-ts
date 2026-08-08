/**
 * lowlevel.library — the joyport half.
 *
 * The library AmigaOS 3.1 added for games: one call that says what is in a
 * gameport and what it is doing, so that a program need not decode JOY0DAT's
 * quadrature or clock a CD32 pad's buttons out by hand. AMOS extensions reach
 * for it exactly where the raw hardware runs out — AMCAF's `Xfire` reads
 * buttons 0 and 1 off CIA-A and POTINP and sends 2 to 6 here, and
 * GameSupport's controller keywords use it for the whole job.
 *
 * ## Evidence
 *
 * Written against AROS: `compiler/include/libraries/lowlevel.h` for the
 * constants and `arch/m68k-amiga/lowlevel/readjoyport.c` for the behaviour.
 * The same tier and the same checkout as `localelib.ts`, and for the same
 * reason — there is no Commodore binary here to outrank it, and AROS is a
 * reimplementation that had to satisfy the programs.
 *
 * What AROS's m68k `ReadJoyPort` does, in order:
 *
 *  - a port other than 0 or 1 answers `JP_TYPE_NOTAVAIL`.
 *  - `llPortOpen` autosenses once per port and remembers the answer in
 *    `llad_PortType`. It polls for a game controller; if that fails it settles
 *    on `JP_TYPE_JOYSTK`. `SetJoyPortAttrs`'s `SJA_Type` forces the answer and
 *    `SJA_Reinitialize` puts it back to autosense.
 *  - a game controller is read by putting pin 5 into shift mode and clocking
 *    nine bits out through CIA-A PRA, then `bits &= ~3; bits <<= 15`, which is
 *    what lands the seven buttons on bits 17 to 23. The low two bits are a
 *    marker: `(bits & 3) != 2` means the shift found nothing that answers like
 *    a pad, and the port reverts to autosense.
 *  - a joystick's red is /FIRn on CIA-A PRA and its blue is pin 9 on POTINP,
 *    both active low; the directions come out of JOYnDAT as
 *    `right = bit 1`, `left = bit 9`, `down = bit 0 ^ bit 1`, `up = bit 8 ^ bit 9`.
 *  - the mouse path is not implemented on m68k AROS at all: a port that
 *    autosenses to anything but pad or stick answers `JP_TYPE_UNKNOWN`.
 *
 * ## The deviation, which is the whole point of ./controller.ts
 *
 * None of that register traffic happens here. The host hands over a decoded
 * `Controller` — type, directions, buttons — so this file is the ENCODING half
 * of `ReadJoyPort` and nothing else: the same answer, without the nine clock
 * pulses that produced it. That is the same trade `../interp/gameport.ts`
 * makes for AMOS's five bits, and it is why the shift protocol is written out
 * above rather than implemented: a later reader wanting to model POTGO for its
 * own sake needs to know what the pulses were for.
 *
 * One consequence worth stating: autosense cannot fail here. A real pad
 * detection can come back stuck and be wrong; a `Controller` says what it is.
 * `CTRL_UNKNOWN` exists so a host can still say "something, but not something
 * I can describe", which is the case `JP_TYPE_UNKNOWN` was for.
 */
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
  CTRL_MOUSE,
  CTRL_NONE,
  type Controller,
} from './controller'

/** `ReadJoyPort` answers for ports 0 and 1 and nothing else */
export const MAX_JOYPORT = 1

// -- return value, from libraries/lowlevel.h ------------------------------

export const JP_TYPE_NOTAVAIL = 0 << 28
export const JP_TYPE_GAMECTLR = 1 << 28
export const JP_TYPE_MOUSE = 2 << 28
export const JP_TYPE_JOYSTK = 3 << 28
export const JP_TYPE_UNKNOWN = 4 << 28
export const JP_TYPE_MASK = 15 << 28

/** JPB_BUTTON_*, the bit NUMBERS — the pad's seven, at 17 to 23 */
export const JPB_BUTTON_PLAY = 17
export const JPB_BUTTON_REVERSE = 18
export const JPB_BUTTON_FORWARD = 19
export const JPB_BUTTON_GREEN = 20
export const JPB_BUTTON_YELLOW = 21
export const JPB_BUTTON_RED = 22
export const JPB_BUTTON_BLUE = 23

export const JPF_BUTTON_PLAY = 1 << JPB_BUTTON_PLAY
export const JPF_BUTTON_REVERSE = 1 << JPB_BUTTON_REVERSE
export const JPF_BUTTON_FORWARD = 1 << JPB_BUTTON_FORWARD
export const JPF_BUTTON_GREEN = 1 << JPB_BUTTON_GREEN
export const JPF_BUTTON_YELLOW = 1 << JPB_BUTTON_YELLOW
export const JPF_BUTTON_RED = 1 << JPB_BUTTON_RED
export const JPF_BUTTON_BLUE = 1 << JPB_BUTTON_BLUE

export const JP_BUTTON_MASK =
  JPF_BUTTON_PLAY |
  JPF_BUTTON_REVERSE |
  JPF_BUTTON_FORWARD |
  JPF_BUTTON_GREEN |
  JPF_BUTTON_YELLOW |
  JPF_BUTTON_RED |
  JPF_BUTTON_BLUE

/**
 * JPF_JOY_*, which are the same values ./controller.ts holds directions in.
 *
 * That identity is why `readJoyPort` can mask `c.dirs` straight through
 * instead of translating. It is deliberate and `lowlevel.test.ts` asserts it,
 * because it is exactly the kind of coincidence that stops being one when
 * somebody renumbers the controller's bits.
 */
export const JPF_JOY_RIGHT = 1 << 0
export const JPF_JOY_LEFT = 1 << 1
export const JPF_JOY_DOWN = 1 << 2
export const JPF_JOY_UP = 1 << 3
export const JP_DIRECTION_MASK = JPF_JOY_RIGHT | JPF_JOY_LEFT | JPF_JOY_DOWN | JPF_JOY_UP

/** mouse position reports, valid for JP_TYPE_MOUSE */
export const JP_MHORZ_MASK = 255 << 0
export const JP_MVERT_MASK = 255 << 8
export const JP_MOUSE_MASK = JP_MHORZ_MASK | JP_MVERT_MASK

// -- SetJoyPortAttrs, from libraries/lowlevel.h ---------------------------

export const SJA_TYPE_AUTOSENSE = 0
export const SJA_TYPE_GAMECTLR = 1
export const SJA_TYPE_MOUSE = 2
export const SJA_TYPE_JOYSTK = 3

/**
 * Every button, paired with where `ReadJoyPort` puts it.
 *
 * A table rather than seven `if`s because the two orderings are unrelated —
 * the controller numbers them from 0 in the order the pad's own documentation
 * lists them, and the return value has them at 17 to 23 in a different order
 * again — so the only safe form is the one where both appear together.
 */
const BUTTONS: ReadonlyArray<readonly [ctrl: number, jpf: number]> = [
  [BTN_PLAY, JPF_BUTTON_PLAY],
  [BTN_REVERSE, JPF_BUTTON_REVERSE],
  [BTN_FORWARD, JPF_BUTTON_FORWARD],
  [BTN_GREEN, JPF_BUTTON_GREEN],
  [BTN_YELLOW, JPF_BUTTON_YELLOW],
  [BTN_RED, JPF_BUTTON_RED],
  [BTN_BLUE, JPF_BUTTON_BLUE],
]

/** the buttons a type is allowed to report */
function buttonsFor(c: Controller): number {
  let bits = 0
  for (const [ctrl, jpf] of BUTTONS) if ((c.buttons & ctrl) !== 0) bits |= jpf
  if (c.type === CTRL_GAMEPAD) return bits
  // a stick has red and blue and no more: red is /FIRn, blue is POTINP pin 9,
  // and there is no third line on the connector to read a third button from
  return bits & (JPF_BUTTON_RED | JPF_BUTTON_BLUE)
}

/**
 * `ULONG ReadJoyPort(ULONG port)`.
 *
 * `ports` is indexed the way the hardware is — 0 is the mouse port, 1 the
 * joystick port — which is also `Joy()`'s numbering.
 */
export function readJoyPort(ports: readonly Controller[], port: number): number {
  if (port < 0 || port > MAX_JOYPORT) return JP_TYPE_NOTAVAIL
  const c = ports[port]
  if (!c || c.type === CTRL_NONE) return JP_TYPE_NOTAVAIL

  switch (c.type) {
    case CTRL_GAMEPAD:
      return (JP_TYPE_GAMECTLR | (c.dirs & JP_DIRECTION_MASK) | buttonsFor(c)) >>> 0
    case CTRL_JOYSTICK:
      return (JP_TYPE_JOYSTK | (c.dirs & JP_DIRECTION_MASK) | buttonsFor(c)) >>> 0
    case CTRL_MOUSE:
      // AROS's m68k build never answers this — llPortOpen autosenses to pad or
      // stick and anything else falls to JP_TYPE_UNKNOWN. Answered here
      // because a host CAN say a mouse is in the port, and the buttons are
      // real: red is the left button, blue the right, play the middle. The
      // position bits stay 0, which is what a caller reading JP_MOUSE_MASK
      // gets from a mouse that has not moved.
      return (JP_TYPE_MOUSE | buttonsFor(c)) >>> 0
    default:
      return JP_TYPE_UNKNOWN
  }
}

/**
 * `SetJoyPortAttrs(port, SJA_Type, ...)` — force what a port reports.
 *
 * Autosense is the only thing this replaces, and autosense here is just the
 * host's own answer, so forcing a type is a plain assignment. `SJA_TYPE_
 * AUTOSENSE` puts back the joystick that `newController` starts with, which is
 * where AROS's failed pad-poll lands too.
 */
export function setJoyPortType(ports: readonly Controller[], port: number, sja: number): boolean {
  if (port < 0 || port > MAX_JOYPORT) return false
  const c = ports[port]
  if (!c) return false
  switch (sja) {
    case SJA_TYPE_GAMECTLR:
      c.type = CTRL_GAMEPAD
      return true
    case SJA_TYPE_MOUSE:
      c.type = CTRL_MOUSE
      return true
    case SJA_TYPE_JOYSTK:
    case SJA_TYPE_AUTOSENSE:
      c.type = CTRL_JOYSTICK
      return true
    default:
      return false
  }
}

// -- the timer half -------------------------------------------------------

/**
 * `ULONG ElapsedTime(struct EClockVal *context)` — LVO -102.
 *
 * The LVO is off `lowlevel_lib.fd`, which ships in this repo's own AMOS tree
 * at `amos-files/.../gui210/GUI2/Tools/FD/lowlevel_lib.fd`: bias 30, and
 * ElapsedTime is the fourteenth entry, 30 + 13*6 = 108... except that the fd
 * carries `lowlevelPrivate1` as its third slot, which is the entry a reader
 * counting only the public names loses. Counting every slot puts ElapsedTime
 * at -102, and that is where GameSupport's `Gstimer` calls it (routine 3,
 * $1dc0: `lea $4a(a2), a0 / jsr -$66(a6)`). `ReadJoyPort` at -30 confirms the
 * bias from the other end.
 *
 * The call returns the time since the LAST call in **1/65536 of a second**,
 * and overwrites the caller's context with the current reading. A context of
 * zero therefore measures from whenever the clock was zero, which is why
 * GameSupport's manual says *"The first time this call is used, the result
 * will be garbage"* — it is not garbage, it is the uptime, and the extension
 * never initialises its context (the block at $1c1a+$4a is file zeros).
 *
 * DEVIATION: on the machine this reads the CIA E clock, a continuous counter
 * at about 709 kHz, and the manual claims roughly 200 microseconds of
 * accuracy. The caller here supplies `now` from whatever clock it has, and in
 * this port that is the vertical blank counter — 20 ms of granularity, not
 * 200 us. Totals over any real interval are right; a program timing something
 * shorter than a frame gets 0 where hardware would give it a number.
 */
export function elapsedTime(context: { last: number }, now: number): number {
  const d = now - context.last
  context.last = now
  return d
}
