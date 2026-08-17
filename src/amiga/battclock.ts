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
 * ## It runs, as an offset from the host clock
 *
 * The chip counts on its own crystal, so setting it does not stop it. A write
 * therefore stores the DIFFERENCE between what the registers now say and what
 * the host clock says, and every later read is the host clock plus that
 * offset. Set it back an hour and it is an hour behind for good, ticking.
 * Until the first write there is no offset and reads come straight off the
 * host, which is what every reader of an unset chip wanted.
 *
 * One case cannot run, and it is reachable rather than theoretical. A program
 * may write registers that are not a time: `Set Hard Time "??:00:00"` puts 15
 * in both hour registers, and ../runtime/jd.ts records how `Jd Setclock`
 * transposes the seconds. Sixty-five seconds is a value the chip's counter
 * chain cannot reach and has no defined way out of, so there is no honest
 * answer to what it counts up to. Those registers are held exactly as written
 * instead, which is also what keeps the round trip through
 * `addi.w #"0",d2` visible: nibble 15 goes in and "?" comes back out.
 */
import { DAY_MS, STAMP_EPOCH, type Civil, type DateStamp, civilFromStamp, stampToDate } from './datestamp'
import type { Device } from './device'

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
/**
 * What the registers read with no board fitted.
 *
 * DEVIATION: zeros are a CHOICE and not a measurement. Nothing vendored here
 * says what $DC0000 answers on a machine with no clock: the address decodes to
 * a chip that is not in the socket, so a real A500 returns whatever the bus
 * floats, which depends on the last cycle and on the machine. Zeros were
 * picked because they surface as 00:00:00 on the 1st, which reads as obviously
 * broken rather than as a plausible wrong time, and a caller that cannot tell
 * "no clock" from "midnight" is the failure worth avoiding.
 *
 * Frozen, because it is handed to callers that expect `read()`'s live array.
 */
export const NO_BATTCLOCK: Uint8Array = new Uint8Array(BATTCLOCK_REGISTERS)

export class BattClock implements Device {
  readonly kind = 'clock' as const
  /**
   * The A501's, because that is the board a 512K A500 got the clock on. A
   * later machine has the same registers soldered to the motherboard, and
   * nothing a program can read tells the two apart.
   */
  /**
   * The board, not the function.
   *
   * A hardware page puts this in a row already labelled "battery clock", so
   * repeating that says nothing; what a reader does not know is WHICH board,
   * and on a 512K A500 it is the A501 in the trapdoor. A later machine has the
   * same registers soldered to the motherboard and nothing a program can read
   * tells the two apart, which is why every one of them answers this.
   */
  readonly name = 'A501'

  readonly description =
    'Sixteen four-bit registers at $DC0000, on their own battery and crystal, ' +
    'so the date survives the power being off. Nothing reads it except the ' +
    'boot: SetClock LOAD copies it into the system time once, and DateStamp ' +
    'answers from there afterwards.'

  /** the sixteen registers, low nibble each */
  readonly regs = new Uint8Array(BATTCLOCK_REGISTERS)

  /**
   * Whether a program has written a register.
   *
   * False is "this chip is showing the machine's real time", which is the state
   * it is in until something sets it.
   */
  written = false

  /**
   * Milliseconds between this chip and the host clock, or null when the
   * registers hold something no calendar does and the chip cannot run.
   */
  private offset: number | null = null

  /**
   * Set the chip to a wall time, as a host would rather than as a program can.
   *
   * The battery clock keeps its OWN time and nothing makes it agree with the
   * machine it is in; a real one drifts, and one out of a drawer is years out.
   * That is a state worth being able to reach, because `SetClock LOAD` in the
   * startup-sequence is the only thing that copies this chip into the system
   * time, and a program that reads it gets what the chip says.
   *
   * Same mechanism a write through the registers uses: an offset from the host
   * clock, so the chip goes on ticking rather than freezing at the value set.
   */
  setTo(when: Date, now: DateStamp): void {
    this.written = true
    this.offset = when.getTime() - stampToDate(now).getTime()
    this.read(now)
  }

  /**
   * Milliseconds this chip is ahead of the host, 0 when it has never been set.
   *
   * Ahead of the HOST STAMP, which is not the same as ahead of `Date.now()`:
   * a DateStamp is wall time with no zone, so the two differ by the host's
   * zone offset. Anything wanting the time this chip reads should call
   * `wallTime` rather than doing the arithmetic, which is a mistake this port
   * made once already.
   */
  get skewMs(): number {
    return this.offset ?? 0
  }

  /** the wall time this chip is showing, as a Date whose UTC fields are it */
  wallTime(now: DateStamp): Date {
    return new Date(stampToDate(now).getTime() + this.skewMs)
  }

  /**
   * The registers, as a reader sees them.
   *
   * The array is the live one, so a caller reads it and does not keep it.
   */
  read(now: DateStamp): Uint8Array {
    if (!this.written) this.seed(civilFromStamp(now.days, now.mins, now.ticks))
    else if (this.offset !== null) {
      // all of this is UTC, deliberately. `stampToDate` reads a DateStamp's
      // fields as UTC and `dateToStamp` writes them back as LOCAL, so a round
      // trip through the pair moves the clock by the host's zone offset. A
      // DateStamp is wall time with no zone, and so is this chip.
      const ms = stampToDate(now).getTime() + this.offset
      const d = new Date(ms)
      const days = Math.floor((ms - STAMP_EPOCH) / DAY_MS)
      this.seed({
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: d.getUTCHours(),
        min: d.getUTCMinutes(),
        sec: d.getUTCSeconds(),
        weekday: ((days % 7) + 7) % 7,
      })
    }
    return this.regs
  }

  /**
   * One register, the way `move.b d1,(a1)` reaches it.
   *
   * The value is masked to four bits because the register IS four bits. That is
   * not tidying: Explode's `Set Hard Time "1A:00:00"` computes `'A' - '0'` = 17
   * and hands it over, and the chip keeps 1.
   *
   * `now` is here because setting a running clock is a change of OFFSET and
   * not of value. A caller writes its six registers one at a time, so this
   * recomputes after each; only the state after the last one is ever read.
   */
  write(reg: number, value: number, now: DateStamp): void {
    if (reg < 0 || reg >= BATTCLOCK_REGISTERS) return
    this.written = true
    this.regs[reg] = value & 15
    this.offset = this.deltaFrom(now)
  }

  /**
   * `ResetBattClock` (-6): every register zero.
   *
   * Which is not a date. There is no month 0 and no day 0, so a reset chip
   * holds its zeros until something sets it, the same as one fresh out of the
   * packet.
   */
  reset(): void {
    this.written = true
    this.offset = null
    this.regs.fill(0)
  }

  /**
   * What the registers say, less what the host clock says, in milliseconds.
   *
   * Null when the twelve digits are not a time the chip could have counted to.
   * The year is two digits, so the century comes from the host: a machine
   * running in 1994 reads a written 94 as 1994.
   */
  private deltaFrom(now: DateStamp): number | null {
    const r = this.regs
    const pair = (at: number): number => r[at + 1]! * 10 + r[at]!
    const [sec, min, hour] = [pair(0), pair(2), pair(4)]
    const [day, month, yy] = [pair(6), pair(8), pair(10)]
    if (sec > 59 || min > 59 || hour > 23) return null
    if (day < 1 || day > 31 || month < 1 || month > 12) return null
    const host = civilFromStamp(now.days, now.mins, now.ticks)
    const at = Date.UTC(Math.floor(host.year / 100) * 100 + yy, month - 1, day, hour, min, sec)
    // Date.UTC rolls a day the month does not have into the next one, so 31
    // April comes back as 1 May. That is a date the chip cannot hold either.
    if (new Date(at).getUTCDate() !== day) return null
    return at - stampToDate(now).getTime()
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
