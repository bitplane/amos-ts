/**
 * The keyboard's serial line, and the byte it leaves in CIA-A.
 *
 * The Amiga keyboard is not memory-mapped. It is a separate microcontroller
 * that clocks one byte at a time into CIA-A's serial data register at
 * `$bfec01`, and the byte it sends is NOT the keycode: the keycode is rotated
 * left one bit and then inverted. Every reader on the machine therefore has to
 * undo that, and the canonical undo is two instructions:
 *
 *     move.b  $bfec01,d0
 *     not.b   d0
 *     ror.b   #1,d0        ->  the keycode, bit 7 set if this was a release
 *
 * ## Why this is modelled rather than shortcut
 *
 * A port can hand a keyword the scancode it "obviously" wants, and three
 * extensions in this tree read the register directly rather than asking AMOS:
 * TURBO's `Raw Key` and `Is Raw Key` (routines 22 and 171), JD's `Jd Moff Key`
 * (routine 142), and Range's `Key Scan` (routine 75). They exist *because*
 * they bypass the OS — TURBO's survives `Multi No`, JD's survives Forbid —
 * so what they see is the register, not AMOS's key state.
 *
 * They also do not agree with each other. TURBO does the full `not`/`ror` and
 * gets a real scancode. Range does neither:
 *
 *     move.b $bfec01.l,d3 / btst.b #$0,d3 / beq .none
 *     lsr.w  #$1,d3
 *
 * Work that through the encoding and Range's answer is `127 - scancode` on a
 * press and 0 on a release, which is a bug it has never been possible to see
 * from the outside. Handing it a scancode would have hidden the bug and made
 * the port agree with a machine it does not match. Modelling the byte lets
 * each reader be exactly as right as it is.
 *
 * ## What is NOT modelled
 *
 * The handshake. After receiving a byte the machine is supposed to pull the
 * clock line low for 85µs by toggling CIA-A's CRA bit 6, which is what
 * TURBO's routine 22 spends a `dbra` loop doing. Nothing here is clocking a
 * real keyboard, so there is no line to hold and the loop is time passing.
 * Nor is the SP interrupt (ICR bit 3): the byte is simply latched when the
 * host reports the event, which is the observable part.
 */
import type { Device } from './device'

/**
 * The keyboard itself: which keys are held, and the byte each event clocks
 * out.
 *
 * The device holds no register. `sdr` is CIA-A's, not the keyboard's, so it
 * lives on ./cia.ts and arrives there through `onByte`, which is the serial
 * line drawn as a callback. That split is why `press` and `release` are
 * methods rather than two lines at the call site: the port used to set
 * `input.keys` and `input.sdr` next to each other in the Runtime, and a
 * caller that updated one and forgot the other left the two disagreeing about
 * a key that was down.
 */
export class Keyboard implements Device {
  readonly kind = 'keyboard' as const
  /**
   * What is supplying the keystrokes.
   *
   * Free text and settable, because the slot is already labelled "keyboard"
   * and the interesting half is what is on the end of the ribbon: a browser
   * today, a shell or a script later. The default is for a caller that has no
   * opinion, which is every test.
   */
  readonly name: string

  readonly description =
    'Clocks one byte into CIA-A\'s serial register at $BFEC01 on every press ' +
    'AND every release, with the scancode inverted and rotated. A key going ' +
    'down and the same key coming up are different bytes.'

  constructor(name = 'keyboard') {
    this.name = name
  }

  /** Amiga scancodes currently down. What `Key State` reads. */
  readonly held = new Set<number>()

  /** where a clocked byte goes. `Machine` wires this to CIA-A's SDR. */
  onByte: ((sdr: number) => void) | null = null

  press(scancode: number): void {
    this.held.add(scancode)
    this.onByte?.(keyboardSdr(scancode, true))
  }

  release(scancode: number): void {
    this.held.delete(scancode)
    this.onByte?.(keyboardSdr(scancode, false))
  }
}

/**
 * The byte the keyboard puts in SDR for one key event: rotate the keycode
 * left one, then invert.
 *
 * `down` is the direction of the event. The Amiga marks a release by setting
 * bit 7 of the keycode before sending, so a release and a press of the same
 * key produce different bytes — which is what TURBO's manual means by
 * "beware! it gives different values if the key is pressed or released".
 */
export function keyboardSdr(scancode: number, down: boolean): number {
  const code = (scancode & 0x7f) | (down ? 0 : 0x80)
  const rolled = ((code << 1) | (code >> 7)) & 0xff
  return ~rolled & 0xff
}

/**
 * Undo it: the keycode, with bit 7 set if the event was a release.
 *
 * This is `not.b` then `ror.b #1`. The two commute — a rotation permutes bits
 * and a complement is bitwise, so they pass through each other — which is why
 * code in the wild writes the pair both ways round and both are right.
 */
export function sdrKeycode(sdr: number): number {
  const n = ~sdr & 0xff
  return ((n >> 1) | ((n & 1) << 7)) & 0xff
}

/** true if the byte in SDR came from a key going down rather than coming up. */
export function sdrIsPress(sdr: number): boolean {
  return (sdrKeycode(sdr) & 0x80) === 0
}
