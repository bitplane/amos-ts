/**
 * What is plugged into a gameport.
 *
 * The machine has two ports and no idea what is in them. A joystick, a mouse,
 * a CD32 seven-button pad and nothing at all are all the same nine pins, and
 * every reader in this port has so far had to guess: `input.joy` carries five
 * bits — four directions and one fire — which is a one-button stick and
 * cannot describe any of the others.
 *
 * This is the device itself, held once, so that the several things that read a
 * controller read the SAME controller. `lowlevel.ts` answers `ReadJoyPort`
 * from it; `../interp/gameport.ts` derives AMOS's five-bit packing from it;
 * AMCAF's `Xfire` asks it for buttons the five bits never had room for.
 *
 * ## Why here and not beside the AMOS packing
 *
 * `../interp/gameport.ts` sets out the opposite case and is still right: the
 * packing `Joy()` returns — `1` up, `2` down, `4` left, `8` right, `16` fire —
 * is AMOS's surface and belongs with AMOS. A controller's TYPE and its seven
 * named buttons are not AMOS's anything. They are what the hardware has and
 * what `lowlevel.library` reports, and an Amiga program in any language reads
 * them the same way, which is this directory's admission rule.
 *
 * That file also records why the AmigaOS half was absent: it "has no caller",
 * and writing a register model for nobody is the machinery-to-sit-unused that
 * `./README.md` warns against. It has two callers now — AMCAF's `Xfire`
 * buttons 2 to 6, which have always read as not pressed, and GameSupport's
 * controller keywords when that lands — so this is the moment that note
 * anticipated.
 *
 * ## The bit values
 *
 * The direction bits are `lowlevel.library`'s `JPF_JOY_*` and not AMOS's,
 * because this is the OS-side model and `lowlevel.ts` is the consumer that
 * must not translate. **The two nibbles are bit-reversed with respect to each
 * other** — AMOS counts up/down/left/right from bit 0, lowlevel counts
 * right/left/down/up — and `../interp/gameport.ts` owns that swap, in one
 * place, with a test either way.
 *
 * The buttons are numbered from 0 here rather than from `JPB_BUTTON_PLAY`'s
 * bit 17, so that a host setting a controller need not know where
 * `ReadJoyPort` happens to put them. `lowlevel.ts` shifts them into place.
 *
 * Nothing in this file reads hardware. There are no quadrature counters to
 * decode and no POTGO conversion to run, because the host delivers a decoded
 * controller — the same trade `../interp/gameport.ts` describes for the five
 * bits, one level richer.
 */

/** what a port reports it has, in `lowlevel.library`'s vocabulary */
export const CTRL_NONE = 0
export const CTRL_GAMEPAD = 1
export const CTRL_MOUSE = 2
export const CTRL_JOYSTICK = 3
export const CTRL_UNKNOWN = 4

/**
 * Directions, in `JPF_JOY_*` order.
 *
 * `libraries/lowlevel.h`: JPB_JOY_RIGHT 0, LEFT 1, DOWN 2, UP 3.
 */
export const DIR_RIGHT = 1
export const DIR_LEFT = 2
export const DIR_DOWN = 4
export const DIR_UP = 8
export const DIR_MASK = DIR_RIGHT | DIR_LEFT | DIR_DOWN | DIR_UP

/**
 * The seven buttons a CD32 pad has, numbered from 0.
 *
 * The names are the pad's own, off `libraries/lowlevel.h`'s comments: red is
 * Select, and it is also a joystick's only fire and a mouse's left button;
 * blue is Stop and a mouse's right button; play is grey, and a mouse's middle.
 * A plain joystick therefore uses RED, and a second-button stick RED and BLUE,
 * which is what the hardware's two lines actually are.
 */
export const BTN_RED = 1
export const BTN_BLUE = 2
export const BTN_YELLOW = 4
export const BTN_GREEN = 8
export const BTN_FORWARD = 16
export const BTN_REVERSE = 32
export const BTN_PLAY = 64
export const BTN_MASK = BTN_RED | BTN_BLUE | BTN_YELLOW | BTN_GREEN | BTN_FORWARD | BTN_REVERSE | BTN_PLAY

export interface Controller {
  /** one of the `CTRL_*` values */
  type: number
  /** `DIR_*` bits currently held */
  dirs: number
  /** `BTN_*` bits currently held */
  buttons: number
}

/**
 * An idle port with a one-button stick in it.
 *
 * `CTRL_JOYSTICK` rather than `CTRL_NONE` because that is what autosense
 * settles on: AROS's `llPortOpen` tries the gamepad shift, and when it comes
 * back with stuck bits — which is what an empty port and an ordinary stick
 * both give — it falls back to `JP_TYPE_JOYSTK`. A host that knows better
 * says so by setting `type`.
 */
export const newController = (): Controller => ({ type: CTRL_JOYSTICK, dirs: 0, buttons: 0 })

/** is this button down? */
export function buttonDown(c: Controller, button: number): boolean {
  return (c.buttons & button) !== 0
}
