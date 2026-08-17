import { describe, expect, it } from 'vitest'
import { FIXED_DATE } from './host'
import { BATTCLOCK_BASE, BATTCLOCK_DATE_REG, BATTCLOCK_STRIDE, BattClock } from './battclock'
import { dateToStamp, stampToDate, type DateStamp } from './datestamp'

/** FIXED_DATE is Tuesday 12 July 1994, 14:30:00 */
const SEEDED = [0, 0, 0, 3, 4, 1, 2, 1, 7, 0, 4, 9]

describe('the battery clock at $DC0000', () => {
  it('reseeds from the host clock until a program writes it', () => {
    const bc = new BattClock()
    expect(bc.written).toBe(false)
    expect([...bc.read(FIXED_DATE).slice(0, 12)]).toEqual(SEEDED)
    // seconds units, seconds tens, minutes units... the order the chip's
    // registers run in, which is why every caller reads them backwards
    expect([...bc.read({ ...FIXED_DATE, mins: 871 }).slice(2, 4)]).toEqual([1, 3])
  })

  it('register 12 is the weekday, which nothing in this port reads', () => {
    // 1 January 1978 was a Sunday, so the weekday is a plain remainder and
    // 12 July 1994 comes out Tuesday
    expect(new BattClock().read(FIXED_DATE)[12]).toBe(2)
  })

  it('a written register is four bits', () => {
    const bc = new BattClock()
    bc.read(FIXED_DATE)
    bc.write(0, 7, FIXED_DATE)
    expect(bc.written).toBe(true)
    // Explode's `Set Hard Time "1A:00:00"` hands over `'A' - '0'` = 17, and a
    // four-bit register keeps 1
    bc.write(1, 17, FIXED_DATE)
    expect([bc.regs[0], bc.regs[1]]).toEqual([7, 1])
  })

  it('a set clock keeps running, an hour behind for good', () => {
    const bc = new BattClock()
    bc.read(FIXED_DATE)
    // 13:30:00 against the host's 14:30, so the offset is minus an hour
    bc.write(4, 3, FIXED_DATE)
    bc.write(5, 1, FIXED_DATE)
    expect([...bc.read(FIXED_DATE).slice(0, 6)]).toEqual([0, 0, 0, 3, 3, 1])
    // an hour on the host clock, and the chip has moved by an hour too
    expect([...bc.read({ ...FIXED_DATE, mins: 930 }).slice(0, 6)]).toEqual([0, 0, 0, 3, 4, 1])
    // and the date comes with it: at 00:30 on the 13th the host has crossed
    // midnight and the chip, an hour behind, has not
    const past = bc.read({ days: 6037, mins: 30, ticks: 0 })
    expect([...past.slice(0, 6)]).toEqual([0, 0, 0, 3, 3, 2])
    expect([...past.slice(6, 12)]).toEqual([2, 1, 7, 0, 4, 9])
  })

  it('registers no calendar could hold are kept exactly, and do not run', () => {
    const bc = new BattClock()
    bc.read(FIXED_DATE)
    // Explode's `Set Hard Time "??:00:00"`: "?" - "0" is 15, twice, so the
    // hour reads 165 and the chip's counter chain has no way out of it
    bc.write(4, 15, FIXED_DATE)
    bc.write(5, 15, FIXED_DATE)
    expect([...bc.read({ ...FIXED_DATE, mins: 930 }).slice(4, 6)]).toEqual([15, 15])
    // JD's transposed seconds are the other way in: 65 is not a second
    const jd = new BattClock()
    jd.read(FIXED_DATE)
    jd.write(0, 5, FIXED_DATE)
    jd.write(1, 6, FIXED_DATE)
    expect([...jd.read({ ...FIXED_DATE, mins: 930 }).slice(0, 2)]).toEqual([5, 6])
  })

  it('a day the month does not have cannot be counted from either', () => {
    const bc = new BattClock()
    bc.read(FIXED_DATE)
    // 31 April: Date.UTC would roll it into 1 May, and the chip would not
    bc.write(6, 1, FIXED_DATE)
    bc.write(7, 3, FIXED_DATE)
    bc.write(8, 4, FIXED_DATE)
    bc.write(9, 0, FIXED_DATE)
    expect([...bc.read({ ...FIXED_DATE, mins: 930 }).slice(6, 10)]).toEqual([1, 3, 4, 0])
  })

  it('a write outside the sixteen registers is dropped, and does not count', () => {
    const bc = new BattClock()
    bc.write(16, 3, FIXED_DATE)
    bc.write(-1, 3, FIXED_DATE)
    expect(bc.written).toBe(false)
  })

  it('ResetBattClock zeroes it and it stays zeroed', () => {
    const bc = new BattClock()
    bc.reset()
    expect([...bc.read(FIXED_DATE)]).toEqual(new Array<number>(16).fill(0))
  })

  it('the date half starts at register 6, which is the $DC0018 both callers use', () => {
    expect(BATTCLOCK_BASE + BATTCLOCK_DATE_REG * BATTCLOCK_STRIDE).toBe(0x00dc_0018)
    // and Explode's `lea $DC002F,a1` is the last byte of register 11, the top
    // of the date half, which is where routine 176 starts writing downward
    expect(BATTCLOCK_BASE + 11 * BATTCLOCK_STRIDE + 3).toBe(0x00dc_002f)
  })
})

describe('setting the clock from outside', () => {
  /** the twelve digits as one string, highest unit last: the order the chip runs in */
  const digits = (bc: BattClock, now: DateStamp): string =>
    [...bc.read(now).slice(0, 12)].join('')

  it('keeps running from the time it was set to, rather than freezing', () => {
    // the same mechanism a register write uses: an offset from the host clock,
    // so a chip set to 1994 is still in 1994 a minute of host time later
    const bc = new BattClock()
    const t0 = dateToStamp(new Date(Date.UTC(2026, 7, 17, 12, 0, 0)))
    bc.setTo(new Date(Date.UTC(1994, 6, 12, 14, 30, 0)), t0)
    expect(digits(bc, t0)).toBe(SEEDED.join(''))

    const t1 = dateToStamp(new Date(Date.UTC(2026, 7, 17, 12, 1, 0)))
    // one minute on: the minutes digit moves and nothing else does
    expect(digits(bc, t1)).toBe([0, 0, 1, 3, 4, 1, 2, 1, 7, 0, 4, 9].join(''))
  })

  it('reports how far it is from the host, which is zero until it is set', () => {
    const bc = new BattClock()
    expect(bc.skewMs).toBe(0)
    // an hour behind the HOST STAMP, which is not an hour behind Date.now():
    // a DateStamp carries no zone, so the two differ by the host's offset
    const now = dateToStamp(new Date(Date.UTC(2026, 7, 17, 12, 0, 0)))
    bc.setTo(new Date(stampToDate(now).getTime() - 3600_000), now)
    expect(bc.skewMs).toBe(-3600_000)
    expect(bc.wallTime(now).getTime()).toBe(stampToDate(now).getTime() - 3600_000)
  })
})
