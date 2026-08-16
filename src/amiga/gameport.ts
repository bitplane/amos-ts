/**
 * JOY0DAT and JOY1DAT ($dff00a/$dff00c) — the gameport counter registers.
 *
 * ## Why this file exists now and did not before
 *
 * `src/interp/gameport.ts` opens by explaining its own absence:
 *
 * > It was planned as `src/amiga/gameport.ts`, and it does not qualify. [...]
 * > The genuinely AmigaOS half — decoding JOYxDAT's quadrature into
 * > directions, POTGO conversions, gameport.device — had **no caller** when
 * > this was written.
 *
 * It has callers now. GameSupport's `Gsmousedx`/`Gsmousedy` read JOY1DAT's
 * two bytes as counters and difference them frame to frame (routines 4 and 5,
 * $1dec and $1e74), and its cold start seeds all four halves from both
 * registers. Ercole's `Pad Fire` reads bit 9 and bit 1 of each. So the
 * register itself — not AMOS's five-bit packing of it — is now shared, and it
 * is unambiguously hardware, which is both halves of `README.md`'s rule.
 *
 * What this does NOT hold is AMOS's `Joy()` packing or the translation to it.
 * That stays in `src/interp/gameport.ts`, where it belongs: it is AMOS's
 * surface, and none of its numbers appear below.
 *
 * ## The register
 *
 * One 16-bit word per port, two 8-bit counters inside it:
 *
 *     bits 15-8   Y counter, the vertical axis
 *     bits  7-0   X counter, the horizontal axis
 *
 * A **mouse** drives them as free-running counters: each quadrature step
 * increments or decrements, and they wrap through 8 bits with no notion of a
 * limit. Software reads the byte, subtracts what it read last time, and
 * sign-extends the difference through 8 bits — which is exactly what
 * GameSupport does, and why moving faster than 127 counts between two reads
 * is misreported. Its manual warns about it: *"This routine should be called
 * as often as possible, preferably once every vblank, otherwise very fast
 * mouse movements will be misinterpreted."*
 *
 * A **digital joystick** pulls four of those same sixteen lines, and because
 * they are quadrature lines the encoding is not one bit per direction. From
 * the Hardware Reference Manual:
 *
 *     bit 1   right
 *     bit 9   left
 *     bit 0   right XOR down
 *     bit 8   left  XOR up
 *
 * so a reader recovers down as `bit0 ^ bit1` and up as `bit8 ^ bit9`. The
 * four bits live in the low two bits of each counter byte, which is why a
 * program written for a mouse and handed a joystick sees small values
 * jittering between 0 and 3 rather than nothing at all. That is a real
 * behaviour and this file reproduces it rather than answering zero.
 */
import { BTN_BLUE, BTN_PLAY, DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, type Controller } from './controller'

/** the two counter registers, `custom.i`:23-24 */
export const JOY0DAT = 0x00df_f00a
export const JOY1DAT = 0x00df_f00c

/** the horizontal counter — the low byte of either register */
export const joyDatX = (w: number): number => w & 0xff

/** the vertical counter — the high byte */
export const joyDatY = (w: number): number => (w >> 8) & 0xff

/**
 * The register a **digital controller** puts on the port.
 *
 * Only the four quadrature lines above; every other bit stays low, because a
 * stick has nothing wired to them. A pad's extra buttons are not here at all
 * — those are POTINP and CIA-A PRA, which `./lowlevel.ts` reads.
 */
export function joyDatOf(c: Controller): number {
  const right = (c.dirs & DIR_RIGHT) !== 0 ? 1 : 0
  const left = (c.dirs & DIR_LEFT) !== 0 ? 1 : 0
  const down = (c.dirs & DIR_DOWN) !== 0 ? 1 : 0
  const up = (c.dirs & DIR_UP) !== 0 ? 1 : 0
  return ((left ^ up) << 8) | (left << 9) | (right ^ down) | (right << 1)
}

/**
 * The register a **mouse** puts on the port, from a position.
 *
 * The counters are free-running and 8 bits wide, so a position is all that is
 * needed to produce them: the counter IS the position, modulo 256. Callers
 * difference two readings and sign-extend, which recovers the movement
 * whenever it was under 128 counts — the same arithmetic, and the same
 * failure past that, as the hardware.
 */
export const mouseDat = (x: number, y: number): number => ((y & 0xff) << 8) | (x & 0xff)

/**
 * Difference two counter readings the way a gameport reader must.
 *
 * `now - prev` through 8 bits, sign-extended: a result at or above $80 has
 * wrapped downward and a result below -$80 upward. GameSupport spells this
 * out three times over ($1e3a, $1ec0, $1be2) and every one of them is these
 * two comparisons against $80 and -$80.
 */
export function counterDelta(now: number, prev: number): number {
  const d = now - prev
  if (d >= 0x80) return d - 0x100
  if (d < -0x80) return d + 0x100
  return d
}

// -- POTGOR, the other half of the same nine pins -------------------------

/**
 * POTGOR at $DFF016, the pot-port input register.
 *
 * Pins 5 and 9 of each connector, which a digital stick uses for its second
 * and third buttons and a mouse for its right and middle. The first button is
 * not here: that is pin 6, and pin 6 goes to CIA-A (`./cia.ts`).
 *
 * Two bits per pin, an OUT and a DATA, in that order upward. The OUT bits are
 * whatever POTGO at $DFF034 last drove and read back as 1 here, because
 * nothing in this port writes POTGO. The DATA bits are ACTIVE LOW like every
 * other button line on the machine.
 *
 * The address is `Consts.s`:102 on APD336 of the AMOS PD Library CD. The bit
 * positions are the Hardware Reference Manual's and are NOT citable from
 * anything vendored here, so what pins them down is a reader: CRAFT's
 * `=Hw Mouse Key` (routine 190, $313a) does `btst #$a` for the right button
 * and `btst #$8` for the middle, both on port 0, which fixes DATLY and DATLX.
 * Port 1's pair sits four bits up and has no reader yet.
 */
export const POTGOR = 0x00df_f016

/** port 0 pin 9, the second button */
export const POTGOR_DATLY = 1 << 10
/** port 0 pin 5, the third button */
export const POTGOR_DATLX = 1 << 8
/** port 1 pin 9 */
export const POTGOR_DATRY = 1 << 14
/** port 1 pin 5 */
export const POTGOR_DATRX = 1 << 12

/**
 * The word a program reads, from each port's held buttons in
 * `./controller.ts`'s packing.
 *
 * RED is absent on purpose: it is pin 6 and it is CIA-A's. A caller passing a
 * mouse's buttons maps them first, which `./mouse.ts` does, because a mouse
 * and a pad number their buttons differently and the pins do not care.
 */
export function potgor(port0Buttons: number, port1Buttons: number): number {
  let v = 0xffff
  if ((port0Buttons & BTN_BLUE) !== 0) v &= ~POTGOR_DATLY
  if ((port0Buttons & BTN_PLAY) !== 0) v &= ~POTGOR_DATLX
  if ((port1Buttons & BTN_BLUE) !== 0) v &= ~POTGOR_DATRY
  if ((port1Buttons & BTN_PLAY) !== 0) v &= ~POTGOR_DATRX
  return v
}
