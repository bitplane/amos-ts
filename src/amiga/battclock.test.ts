import { describe, expect, it } from 'vitest'
import { FIXED_DATE } from './host'
import { BATTCLOCK_BASE, BATTCLOCK_DATE_REG, BATTCLOCK_STRIDE, BattClock } from './battclock'

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

  it('a written register is four bits and stops reseeding', () => {
    const bc = new BattClock()
    bc.read(FIXED_DATE)
    bc.write(0, 7)
    expect(bc.written).toBe(true)
    // Explode's `Set Hard Time "1A:00:00"` hands over `'A' - '0'` = 17, and a
    // four-bit register keeps 1
    bc.write(1, 17)
    expect([bc.regs[0], bc.regs[1]]).toEqual([7, 1])
    // an hour later on the host clock, and the chip has not moved
    expect([...bc.read({ ...FIXED_DATE, mins: 930 }).slice(0, 6)]).toEqual([7, 1, 0, 3, 4, 1])
  })

  it('a write outside the sixteen registers is dropped, and does not count', () => {
    const bc = new BattClock()
    bc.write(16, 3)
    bc.write(-1, 3)
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
