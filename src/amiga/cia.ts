/**
 * CIA-A, the chip at $BFE001, and the six devices whose lines run through it.
 *
 * Everything below is transcribed from `hardware/cia.i` release 1.3, which
 * ships inside AMOS Professional's own sources at
 * `AMOSPro Sources/includes/hardware/cia.i`. Its port map is one screen long
 * and it is the whole hardware tree this port is growing into:
 *
 *     ciaa port A ($bfe001)   gameport fire, floppy status, LED, ROM overlay
 *     ciaa port B ($bfe101)   the parallel port                       (:119)
 *     ciab port A ($bfd000)   serial handshake and printer status     (:121)
 *     ciab port B ($bfd100)   drive select, motor, step and side      (:131)
 *
 * Only port A of CIA-A is modelled, because only port A of CIA-A has a
 * reader. The other three are cited here so the next slice starts from the
 * include file rather than from memory.
 *
 * ## Why the register and not four separate flags
 *
 * These lines had drifted into three unrelated places. The LED bit was
 * `Runtime.ledFilter`, a boolean named after the audio filter; FIR0 was
 * synthesized inside the memory map from `input.mouseK`; the four floppy
 * lines did not exist. They are one byte on one chip, and a program that
 * reads that byte gets all eight bits at once whether the port meant to
 * offer them or not.
 *
 * CRAFT's `=Hw Mouse Key` (routine 190, $313a) is `btst.b #$6,$bfe001.l`, and
 * First 0.1's `Change Led` (routine 3, $6c) is `bchg.b #$1,$bfe001` on the
 * same byte. One of them reads a mouse and one of them toggles a filter, and
 * they are two bits apart.
 *
 * ## Polarity
 *
 * Six of the eight are ACTIVE LOW, and the include file marks them with a
 * trailing asterisk: `* gameport 1, pin 6 (fire button*)`. A held fire button
 * reads 0. A drive that is ready reads 0. The two exceptions are the two
 * OUTPUT bits at the bottom, and the LED's sense is stated outright:
 *
 *     CIAB_LED	  EQU	(1)   * led light control (0==>bright)
 *
 * A bright LED is a bright LED and also Paula's low-pass filter engaged, so
 * `ledBright` here is `Runtime.ledFilter` and bit 1 is its INVERSE. The port
 * had this backwards until this file existed: the map answered $ff or $bf,
 * both of which have bit 1 set, so a program peeking the byte was told the
 * filter was off no matter what `Led On` had done.
 *
 * ## Which bits a write reaches
 *
 * Bits 0 and 1 are driven by the chip and the rest are read from the pins, so
 * a write lands on OVL and LED and evaporates on the other six. That is why
 * `writePra` keeps only two bits: it is not a simplification, it is what the
 * data direction register does. `bchg #1` therefore works, and `bchg #6` on
 * the mouse button does nothing, exactly as on the machine.
 */

/** the register addresses this port maps. $100 apart, per `cia.i`:22-36. */
export const CIAA_PRA = 0x00bf_e001
/** ciasdr, `$0c00` up from ciapra: the byte the keyboard clocked in */
export const CIAA_SDR = 0x00bf_ec01

/**
 * ciaa port A bit masks, `cia.i`:141-149.
 *
 * The include file's own names are kept. Note that its `CIAB_` prefix means
 * "bit number" and `CIAF_` means "flag", so `CIAF_GAMEPORT1` is a bit of
 * ciaa and has nothing to do with the second CIA.
 */
export const CIAF_OVERLAY = 1 << 0
export const CIAF_LED = 1 << 1
export const CIAF_DSKCHANGE = 1 << 2
export const CIAF_DSKPROT = 1 << 3
export const CIAF_DSKTRACK0 = 1 << 4
export const CIAF_DSKRDY = 1 << 5
export const CIAF_GAMEPORT0 = 1 << 6
export const CIAF_GAMEPORT1 = 1 << 7

/** the two bits the chip drives; everything else is a pin and ignores a write */
export const CIAA_PRA_OUTPUTS = CIAF_OVERLAY | CIAF_LED

/**
 * The four status lines a floppy puts on CIA-A while it is the selected
 * drive, in positive logic. `pra()` inverts them.
 *
 * Reported by whichever unit CIA-B port B has selected, and by nothing when
 * none is: an Amiga with every DSKSEL line high reads all four as 1, which is
 * "not ready, not on track 0, not write protected, no change", and is what an
 * idle machine says.
 */
export interface DiskLines {
  /** DSKRDY: the motor is up to speed and a disk is in */
  ready: boolean
  /** DSKTRACK0: the head is on cylinder 0 */
  track0: boolean
  /** DSKPROT: the write-protect tab is open */
  writeProtected: boolean
  /** DSKCHANGE: a disk has been removed since the line was last cleared by a step */
  changed: boolean
}

/** everything CIA-A port A reads that CIA-A does not own */
export interface CiaAWires {
  /** gameport 0 pin 6 held down. A mouse's left button, a stick's only fire. */
  fire0(): boolean
  /** gameport 1 pin 6 held down */
  fire1(): boolean
  /** the selected drive's lines, or null when no drive is selected */
  disk(): DiskLines | null
}

/** wires for a machine with nothing plugged in: no buttons, no drive selected */
export const idleWires = (): CiaAWires => ({
  fire0: () => false,
  fire1: () => false,
  disk: () => null,
})

/**
 * CIA-A: port A, and the serial register the keyboard clocks into.
 *
 * The chip has timers, a TOD counter and an interrupt control register too,
 * and none of them are here. Nothing reads them: AMOS's own timing is the
 * vertical blank, TFMX drives CIA-B rather than this one, and the keyboard
 * handshake this port does not perform is the only thing that would touch
 * CRA. Modelling them now is machinery to sit unused, which `./README.md`
 * warns against by name.
 */
export class CiaA {
  /**
   * What was last written to the two output bits.
   *
   * Boots with OVL clear, which is the state after the OS has run: the ROM
   * overlay is only up for the first few instructions after reset, and
   * nothing here executes those. LED bit clear, so the LED is bright and the
   * filter is engaged, which is how the machine comes up and what
   * `Runtime.ledFilter = true` already claimed.
   */
  private out = 0

  /**
   * The byte the keyboard last clocked into ciasdr, encoded the way the
   * keyboard encodes it. See ./keyboard.ts for the encoding and for the three
   * extensions that read this register directly, two of them wrongly.
   *
   * An idle machine has never received a byte, and the routines that test it
   * read 0 as "nothing", which is also what they read after a key comes up.
   */
  sdr = 0

  /**
   * Called when bit 1 changes, so that one write drives the audio filter no
   * matter which way it arrived. `Led On`, `Change Led` and a `Poke $BFE001`
   * are three routes to the same bit and they used to update the sink
   * separately, which meant the Poke did not update it at all.
   */
  onLed: ((bright: boolean) => void) | null = null

  constructor(private readonly wires: CiaAWires = idleWires()) {}

  /** is the power LED lit, and with it Paula's low-pass filter? */
  get ledBright(): boolean {
    return (this.out & CIAF_LED) === 0
  }

  set ledBright(on: boolean) {
    this.writePra(on ? this.out & ~CIAF_LED : this.out | CIAF_LED)
  }

  /** the ROM overlay bit. Clear once the machine has booted, and never set here. */
  get overlay(): boolean {
    return (this.out & CIAF_OVERLAY) !== 0
  }

  /** the whole byte a program reads: two held bits, six pins, all active low but OVL */
  pra(): number {
    let v = this.out & CIAA_PRA_OUTPUTS
    const d = this.wires.disk()
    if (!d || !d.ready) v |= CIAF_DSKRDY
    if (!d || !d.track0) v |= CIAF_DSKTRACK0
    if (!d || !d.writeProtected) v |= CIAF_DSKPROT
    if (!d || !d.changed) v |= CIAF_DSKCHANGE
    if (!this.wires.fire0()) v |= CIAF_GAMEPORT0
    if (!this.wires.fire1()) v |= CIAF_GAMEPORT1
    return v
  }

  /** a write: OVL and LED land, the six input pins ignore it */
  writePra(v: number): void {
    const was = this.ledBright
    this.out = v & CIAA_PRA_OUTPUTS
    const now = this.ledBright
    if (now !== was) this.onLed?.(now)
  }
}
