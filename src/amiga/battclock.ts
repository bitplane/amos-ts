/**
 * The battery-backed clock at $DC0000.
 *
 * A real piece of kit, and an optional one. It has its own crystal and its own
 * battery, so it keeps time with the machine switched off, and a stock A500 or
 * an A1000 has none fitted at all. The corpus says so in a startup-sequence's
 * own comment: "SetClock load ;load system time from real time clock (A1000
 * owners should" / "replace the SetClock load with Date"
 * (`sources/amos-pd-library-cd-1994/files/S/Startup1.3:12`).
 *
 * ## Not timer.device, and not the system time
 *
 * Three separate things are routinely confused here, and only one of them is
 * this file. `timer.device` is software: an exec device holding the system time
 * in RAM, ticked by the CIA 8520s, answering `GetSysTime` at -66 and
 * `ReadEClock` at -60. `dos.library`'s `DateStamp` at -192 is what a program
 * actually calls for the date, and it asks timer.device. Neither of those ever
 * reads this chip.
 *
 * The only bridge is the boot: `SetClock LOAD` in the startup-sequence copies
 * this chip into the system time, once. So writing here does NOT change what
 * `DateStamp` returns, and that is exactly the behaviour that makes the two
 * distinguishable in this port. See ../runtime/jd.ts, where `Jd Time$` reads
 * this chip and `Jd Date$` reads DateStamp.
 *
 * (LVOs read out of `battclock_lib.fd`, `timer_lib.fd` and `dos_lib.fd` under
 * the GUI 2.10 sources, not recalled. AmigaOS reaches this chip through
 * battclock.resource, which is a RESOURCE and not a library: `OpenResource`,
 * and three entries at bias 6, `ResetBattClock` -6, `ReadBattClock` -12,
 * `WriteBattClock(time)(d0)` -18. Its job is to hide which RTC part is fitted.
 * Neither extension here uses it. Both go straight to the chip.)
 *
 * ## The register layout, from two independent implementations
 *
 * Sixteen 4-bit registers, one per longword from $DC0000, value in the low
 * nibble. Registers 0 to 11 are the calendar:
 *
 *      0  S1    seconds, units    $DC0000      6  D1    day, units     $DC0018
 *      1  S10   seconds, tens     $DC0004      7  D10   day, tens      $DC001C
 *      2  MI1   minutes, units    $DC0008      8  MO1   month, units   $DC0020
 *      3  MI10  minutes, tens     $DC000C      9  MO10  month, tens    $DC0024
 *      4  H1    hours, units      $DC0010     10  Y1    year, units    $DC0028
 *      5  H10   hours, tens       $DC0014     11  Y10   year, tens     $DC002C
 *
 * 12 is the weekday and 13 to 15 are control. Nothing in this port reads them.
 *
 * Both AMOS extensions that touch the chip agree on that map, which is why it
 * can be stated rather than guessed. Explode reads six longwords from $DC0000
 * for the time and from $DC0018 for the date, `move.l (a0)+,d2 / andi.w #15,d2`
 * (routine 166, AMOSPro_Explode_Lib.s:3905), and writes DOWNWARD from $DC0017
 * and $DC002F, `move.b d1,(a1) / lea -4(a1),a1` (routine 176, :4158). JD writes
 * upward from $dc0000 and $dc0018, `move.w d0,(a1)+ / add.l #2,a1`
 * (+|jd.s:1086, :1161).
 *
 * They disagree about WHICH BYTE of the longword, and that is the useful part.
 * JD's word write at $dc0000 puts the nibble in $dc0001; Explode's byte write
 * lands at $dc0003. Both shipped and both worked, so the chip's register select
 * does not decode A0 and A1: all four bytes of a longword are the same
 * register. That is why this file holds registers rather than an address space.
 *
 * ## DEVIATION: the chip does not run
 *
 * On the machine this counts on its own, off its own crystal. Here it holds
 * what it was given. Until a program writes a register the read reseeds from
 * the host clock, so a program that only reads sees the real time, which is
 * what every existing reader wanted. After a write it holds the written value
 * for good, so `Set Hard Time` then `=Hard Time$` a minute later reports the
 * same second where hardware would have moved on.
 *
 * The alternative was to advance the written value by the elapsed real time,
 * and it cannot be done honestly: a program is free to write 65 seconds
 * (../runtime/jd.ts records how `Jd Setclock` does exactly that), and there is
 * no reading of the chip that says what nonsense counts up to.
 */
import { type Civil, type DateStamp, civilFromStamp } from './datestamp'

/** where the chip is decoded, and the longword stride between its registers */
export const BATTCLOCK_BASE = 0x00dc_0000
export const BATTCLOCK_STRIDE = 4

/** every register, 4 bits each. 0 to 11 are the calendar, 12 the weekday */
export const BATTCLOCK_REGISTERS = 16

/** the first register of the date half, which is Explode's and JD's `$DC0018` */
export const BATTCLOCK_DATE_REG = 6

/**
 * The chip.
 *
 * One of these belongs to the Machine and not to a Runtime, for the reason the
 * hardware exists at all: it survives a power cycle, so it has to outlive the
 * environment. See ./machine.ts.
 */
export class BattClock {
  /** the sixteen registers, low nibble each */
  readonly regs = new Uint8Array(BATTCLOCK_REGISTERS)

  /**
   * Whether a program has written a register.
   *
   * False is "this chip is showing the machine's real time", which is the state
   * every reader saw before writes were modelled at all.
   */
  written = false

  /**
   * The registers, as a reader sees them.
   *
   * Reseeded from `now` until a program writes one. The array is the live one,
   * so a caller reads it and does not keep it.
   */
  read(now: DateStamp): Uint8Array {
    if (!this.written) this.seed(civilFromStamp(now.days, now.mins, now.ticks))
    return this.regs
  }

  /**
   * One register, the way `move.b d1,(a1)` reaches it.
   *
   * The value is masked to four bits because the register IS four bits. That is
   * not tidying: Explode's `Set Hard Time "1A:00:00"` computes `'A' - '0'` = 17
   * and hands it over, and the chip keeps 1.
   */
  write(reg: number, value: number): void {
    if (reg < 0 || reg >= BATTCLOCK_REGISTERS) return
    this.written = true
    this.regs[reg] = value & 15
  }

  /** `ResetBattClock` (-6): every register zero, and it stays that way */
  reset(): void {
    this.written = true
    this.regs.fill(0)
  }

  /** the twelve calendar registers from a civil time, units digit first */
  private seed(c: Civil): void {
    const r = this.regs
    r[0] = c.sec % 10
    r[1] = Math.floor(c.sec / 10)
    r[2] = c.min % 10
    r[3] = Math.floor(c.min / 10)
    r[4] = c.hour % 10
    r[5] = Math.floor(c.hour / 10)
    r[6] = c.day % 10
    r[7] = Math.floor(c.day / 10)
    r[8] = c.month % 10
    r[9] = Math.floor(c.month / 10)
    r[10] = c.year % 10
    r[11] = Math.floor(c.year / 10) % 10
    r[12] = c.weekday
  }
}
