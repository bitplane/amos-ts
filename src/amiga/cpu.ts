/**
 * The processor, as a thing you can name rather than a thing that runs code.
 *
 * NOTHING HERE EXECUTES ANYTHING. This port has no 68k interpreter, which is a
 * policy and not a gap: `UNIMPLEMENTED.md` puts machine-code execution last on
 * the roadmap on the grounds that not having it keeps the port honest, because
 * an interpreter would let keywords pass without anyone reading the routine
 * behind them. So a CPU here is an identity and a clock rate, and the one
 * place a program could tell the difference is a keyword that reports the
 * model.
 *
 * It is a class hierarchy for what it will hold later. When there is an
 * emulator, it goes behind `execute()` on a subclass and the rest of the
 * machine does not learn a new shape.
 *
 * ## The rates
 *
 * PAL machines clock the 68000 at 7.09379 MHz, which is the 28.37516 MHz
 * master oscillator divided by four; NTSC is 7.15909 MHz off 28.63636. The
 * number that matters to this port is the PAL one, because
 * `../amiga/paula.ts` derives its periods from the same crystal. An
 * accelerator's rate is the card's own oscillator and has nothing to do with
 * the motherboard's, which is why the faster models carry a flat figure.
 */
import type { Device } from './device'

export abstract class Cpu implements Device {
  readonly kind = 'cpu' as const
  abstract readonly name: string

  /** clock rate in Hz, for a page to print. Nothing here counts cycles. */
  abstract readonly hz: number

  get description(): string {
    const mhz = (this.hz / 1_000_000).toFixed(5).replace(/0+$/, '').replace(/\.$/, '')
    return (
      `Motorola ${this.name} at ${mhz} MHz. This port runs no 68k machine code ` +
      `at all, on purpose: an interpreter would let keywords pass without ` +
      `anyone reading the routine behind them. So the choice changes what a ` +
      `program asking the model is told, and nothing else.`
    )
  }

  /**
   * Run without waiting for the 50Hz frame clock.
   *
   * Not an accelerator and not pretending to be one. It is the host's frame
   * loop asked to stop pacing itself, which is a development aid: a program
   * that takes a minute of wall clock to draw something finishes at once. It
   * lives on the CPU because it is the only knob here that is about how fast
   * instructions get through, and it is a MODE rather than a chip so that
   * nothing reports a 68030 that is not there.
   */
  ignoreClock = false
}

/** the 68000 every stock Amiga shipped with, at the PAL rate */
export class M68000 extends Cpu {
  readonly name = '68000'
  readonly hz = 7_093_790
}

/**
 * The 68020, in an A1200 at 14.18758 MHz.
 *
 * Exactly twice the PAL 68000 rate, because the A1200 divides the same
 * 28.37516 MHz oscillator by two instead of by four.
 */
export class M68020 extends Cpu {
  readonly name = '68020'
  readonly hz = 14_187_580
}

/** the 68030 as an A4000/030 or a common accelerator, at the card's own rate */
export class M68030 extends Cpu {
  readonly name = '68030'
  readonly hz = 25_000_000
}

/** the 68040 as an A4000/040 */
export class M68040 extends Cpu {
  readonly name = '68040'
  readonly hz = 25_000_000
}
