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
 * All four are modelled, because all four turned out to have readers. Port A
 * of CIA-A carries the LED and the fire buttons; the other three carry a
 * four-player adaptor, a printer and the floppy drives, and eleven keywords
 * across five extensions read them:
 *
 *     ciaa PRB   Sticks' `Stick Joy` and its four direction keywords,
 *                Ercole's `Ext Joy`, AMCAF's `Pjoy`
 *     ciab PRA   Sticks' `Stick Fire`, Ercole's `Ext Fire`, Range's
 *                `=Busy Printer` and `=No Paper`
 *     ciab PRB   Misc's `Dled On`/`Off`, Delta's motor pair, JD's `Jd Dled`
 *                pair, all six of which are the same four instructions
 *
 * Every one of those answered a constant before this file, worked out in
 * prose from what an unattached port reads. They compute it now, which is the
 * same answer today and a different one the moment something is attached.
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

/**
 * The register addresses this port maps.
 *
 * `cia.i`:22-36 gives the offsets, $100 apart, and the header says where the
 * two chips sit: *"_ciaa is on an ODD address (e.g. the low byte) -- $bfe001"*
 * and *"_ciab is on an EVEN address (e.g. the high byte) -- $bfd000"*. So a
 * register's address is the chip's base plus its offset, and the odd/even
 * split is what lets a `move.w` reach both chips in one instruction.
 */
export const CIAA_PRA = 0x00bf_e001
/** ciaa port B: the parallel port's eight data lines */
export const CIAA_PRB = 0x00bf_e101
/** ciasdr, `$0c00` up from ciapra: the byte the keyboard clocked in */
export const CIAA_SDR = 0x00bf_ec01
/** ciab port A: serial handshake and printer status */
export const CIAB_PRA = 0x00bf_d000
/** ciab port B: drive select, motor, step and side */
export const CIAB_PRB = 0x00bf_d100
/** ciab's data direction register for port B, which six keywords write */
export const CIAB_DDRB = 0x00bf_d300

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
 * ciab port A bit masks, `cia.i`:154-161.
 *
 * Five serial handshake lines and three printer status lines. Note which
 * carry the include file's active-low asterisk and which do not: every serial
 * line does, and NONE of the printer three do. So an unattached printer port
 * floats high and that reads as busy, out of paper and selected all at once,
 * which is exactly what Range's `=Busy Printer` and `=No Paper` answer.
 */
export const CIAF_PRTRBUSY = 1 << 0
export const CIAF_PRTRPOUT = 1 << 1
export const CIAF_PRTRSEL = 1 << 2
export const CIAF_COMDSR = 1 << 3
export const CIAF_COMCTS = 1 << 4
export const CIAF_COMCD = 1 << 5
export const CIAF_COMRTS = 1 << 6
export const CIAF_COMDTR = 1 << 7

/** DTR and RTS are the machine's to drive; the other six are pins */
export const CIAB_PRA_OUTPUTS = CIAF_COMRTS | CIAF_COMDTR

/**
 * ciab port B bit masks, `cia.i`:164-171. The floppy control lines, and all
 * eight active low.
 *
 * Every bit is an output, which is why this register has a data direction
 * register that six keywords across three extensions write: releasing the
 * lines lets them float inactive through their pull-ups, and that is how
 * `Dled On` stops a motor without changing the data register at all.
 */
export const CIAF_DSKSTEP = 1 << 0
export const CIAF_DSKDIREC = 1 << 1
export const CIAF_DSKSIDE = 1 << 2
export const CIAF_DSKSEL0 = 1 << 3
export const CIAF_DSKSEL1 = 1 << 4
export const CIAF_DSKSEL2 = 1 << 5
export const CIAF_DSKSEL3 = 1 << 6
export const CIAF_DSKMOTOR = 1 << 7

/** the four unit-select lines, low to high */
export const DSKSEL = [CIAF_DSKSEL0, CIAF_DSKSEL1, CIAF_DSKSEL2, CIAF_DSKSEL3] as const

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

/**
 * The parallel port's eight data lines, as whatever is on the end drives
 * them.
 *
 * The one thing this port has evidence for is the four-player adaptor, which
 * puts a joystick on each nibble: Sticks' routine 5 does
 * `move.b $bfe101,d3 / not.b d3` and takes the low nibble for port 0, and
 * Ercole's `Ext Joy` is the same two instructions. `not.b` is there because
 * the lines are pulled up and a switch pulls one DOWN, so an unattached port
 * reads $ff and inverts to no directions at all.
 */
export interface ParallelLines {
  /** the byte on the eight data pins, before any reader inverts it */
  data: number
  /** printer BUSY, and ACTIVE HIGH: `cia.i`:129 carries no asterisk */
  busy: boolean
  /** printer paper out, active high */
  paperOut: boolean
  /** printer SELECT, active high */
  selected: boolean
}

/** the three serial input handshake lines, all active low */
export interface SerialLines {
  carrierDetect: boolean
  clearToSend: boolean
  dataSetReady: boolean
}

/** everything CIA-A reads that CIA-A does not own */
export interface CiaAWires {
  /** gameport 0 pin 6 held down. A mouse's left button, a stick's only fire. */
  fire0(): boolean
  /** gameport 1 pin 6 held down */
  fire1(): boolean
  /** the selected drive's lines, or null when no drive is selected */
  disk(): DiskLines | null
  /** what is on the parallel port, or null for an empty connector */
  parallel(): ParallelLines | null
}

/** everything CIA-B reads that CIA-B does not own */
export interface CiaBWires {
  /** the parallel port again: PRA carries its three status lines */
  parallel(): ParallelLines | null
  /** what is on the serial port, or null for an empty connector */
  serial(): SerialLines | null
}

/** wires for a machine with nothing plugged in: no buttons, no drive, no cables */
export const idleWires = (): CiaAWires => ({
  fire0: () => false,
  fire1: () => false,
  disk: () => null,
  parallel: () => null,
})

/** the same for CIA-B */
export const idleWiresB = (): CiaBWires => ({
  parallel: () => null,
  serial: () => null,
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

  /**
   * Port B: the parallel port's eight data lines, floating high when nothing
   * is on the end of the cable.
   *
   * Read-only here, because the machine only ever reads it in this port. A
   * program printing would drive it, and printing goes through
   * `printer.device` rather than through the register, so there is no writer
   * to model until one appears.
   */
  prb(): number {
    return this.wires.parallel()?.data ?? 0xff
  }
}

/**
 * CIA-B: the serial and printer handshake lines on port A, and the floppy
 * control lines on port B.
 *
 * Port B is the interesting one, because it is entirely OUTPUTS and six
 * keywords in three extensions drive it. Misc 1.0's `Dled On`, Delta's
 * `Delta Drive Motor On` and JD's `Jd Dled Off` are the same four
 * instructions:
 *
 *     move.b #$7f,$bfd100      /MTR low, no drive selected
 *     move.b #$77,$bfd100      /MTR low and /SEL0 low: latch it into drive 0
 *     move.b #$00,$bfd300      DDRB all INPUTS  -- the lines float, motor off
 *     move.b #$ff,$bfd300      DDRB all OUTPUTS -- the $77 is driven, motor on
 *
 * The data register is identical in both directions and the DIRECTION
 * register is what differs, which is why all three extensions have the pair
 * named backwards. `../runtime/miscext.ts` carries the defect with its
 * author's own source and its manual's bafflement.
 */
export class CiaB {
  /** what was last written to port B's latch. All eight bits are outputs. */
  private outB = 0xff

  /**
   * Which of port B's lines the chip is actually driving.
   *
   * $ff at boot: trackdisk.device wants every one of them driven and leaves
   * DDRB that way, which is the state all six keywords above assume when they
   * write $77 and expect it to reach the motor.
   */
  ddrb = 0xff

  /** DTR and RTS, the two the machine drives on port A */
  private outA = 0xff

  constructor(private readonly wires: CiaBWires = idleWiresB()) {}

  /** port A: three printer lines, three serial inputs, two driven outputs */
  pra(): number {
    let v = this.outA & CIAB_PRA_OUTPUTS
    const p = this.wires.parallel()
    // the printer three are ACTIVE HIGH, so an empty port reads all of them
    if (!p || p.busy) v |= CIAF_PRTRBUSY
    if (!p || p.paperOut) v |= CIAF_PRTRPOUT
    if (!p || p.selected) v |= CIAF_PRTRSEL
    const s = this.wires.serial()
    if (!s || !s.dataSetReady) v |= CIAF_COMDSR
    if (!s || !s.clearToSend) v |= CIAF_COMCTS
    if (!s || !s.carrierDetect) v |= CIAF_COMCD
    return v
  }

  writePra(v: number): void {
    this.outA = v & CIAB_PRA_OUTPUTS
  }

  /**
   * Port B as a program reads it back: the latch where DDRB drives, and a
   * pulled-up high where it does not.
   */
  prb(): number {
    return ((this.outB & this.ddrb) | ~this.ddrb) & 0xff
  }

  writePrb(v: number): void {
    this.outB = v & 0xff
  }

  /** what the drives actually see, which is `prb()` and not the latch */
  private lines(): number {
    return this.prb()
  }

  /** is /MTR asserted? Active low, and only meaningful while DDRB drives it. */
  get motorLine(): boolean {
    return (this.lines() & CIAF_DSKMOTOR) === 0
  }

  /**
   * The unit whose /SELn is low, or null when none is.
   *
   * The lowest-numbered wins if two are somehow asserted at once. On the
   * machine that is a bus fight rather than a defined result, and picking one
   * beats answering null for a state a program can reach.
   */
  get selected(): number | null {
    const v = this.lines()
    for (let n = 0; n < DSKSEL.length; n++) if ((v & DSKSEL[n]!) === 0) return n
    return null
  }

  /**
   * /SIDE, /DIR and /STEP, as asserted-or-not and no further.
   *
   * Which surface a low /SIDE picks and which way a low /DIR seeks are in the
   * Hardware Reference Manual and in nothing vendored here, so this stops at
   * the line. A drive is where that becomes a head and a cylinder, and there
   * is no drive yet. `cia.i` gives the bit and the asterisk, which is all
   * three of these claim.
   */
  get sideLine(): boolean {
    return (this.lines() & CIAF_DSKSIDE) === 0
  }

  get directionLine(): boolean {
    return (this.lines() & CIAF_DSKDIREC) === 0
  }

  /** a drive moves on the falling edge of this, not on the level */
  get stepLine(): boolean {
    return (this.lines() & CIAF_DSKSTEP) === 0
  }
}
