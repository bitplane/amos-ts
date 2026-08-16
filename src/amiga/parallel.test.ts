/**
 * The parallel port with something on the end of it.
 *
 * The bit positions and polarities are `cia.i` and are tested in ./cia.test.ts.
 * What is tested here is the CABLE: which pin each of two extra joysticks
 * reaches, and the fact that a printer and an adaptor drive the same three
 * status lines because they are the same three pins.
 */
import { describe, expect, it } from 'vitest'
import { CIAF_PRTRBUSY, CIAF_PRTRPOUT, CIAF_PRTRSEL } from './cia'
import { BTN_RED, DIR_LEFT, DIR_UP } from './controller'
import { Machine } from './machine'
import { FourPlayerAdaptor, Printer } from './parallel'

describe('an empty connector', () => {
  it('reads $ff on the data lines and all three status lines set', () => {
    const m = new Machine()
    expect(m.cia.prb()).toBe(0xff)
    const v = m.ciab.pra()
    expect(v & CIAF_PRTRBUSY).toBe(CIAF_PRTRBUSY)
    expect(v & CIAF_PRTRPOUT).toBe(CIAF_PRTRPOUT)
    expect(v & CIAF_PRTRSEL).toBe(CIAF_PRTRSEL)
  })
})

describe('the four-player adaptor', () => {
  const fitted = (): { m: Machine; a: FourPlayerAdaptor } => {
    const m = new Machine()
    const a = new FourPlayerAdaptor()
    m.parallel = a
    return { m, a }
  }

  it('idles at $ff with neither stick touched, same as no cable', () => {
    const { m } = fitted()
    expect(m.cia.prb()).toBe(0xff)
  })

  it('puts player 3 on the low nibble and player 4 on the high one', () => {
    // up is bit 0 and left bit 2 of each nibble, off AMCAF's routines 14 and
    // 12 and Sticks' Stick Up / Stick Left. CLEAR is pressed.
    const { m, a } = fitted()
    a.sticks[0]!.dirs = DIR_UP
    a.sticks[1]!.dirs = DIR_LEFT
    expect(m.cia.prb()).toBe(0xff & ~0x01 & ~0x40)
  })

  it('puts player 3 fire on SELECT and player 4 fire on BUSY', () => {
    // AMCAF routine 16 and Ercole's =Ext Fire, which agree; Sticks reads BUSY
    // and POUT instead and so does not see these two the same way
    const { m, a } = fitted()
    a.sticks[0]!.buttons = BTN_RED
    expect(m.ciab.pra() & CIAF_PRTRSEL).toBe(0)
    expect(m.ciab.pra() & CIAF_PRTRBUSY).toBe(CIAF_PRTRBUSY)
    a.sticks[0]!.buttons = 0
    a.sticks[1]!.buttons = BTN_RED
    expect(m.ciab.pra() & CIAF_PRTRSEL).toBe(CIAF_PRTRSEL)
    expect(m.ciab.pra() & CIAF_PRTRBUSY).toBe(0)
  })

  it('never drives POUT, so a paper-out reader still says there is no paper', () => {
    const { m, a } = fitted()
    a.sticks[0]!.buttons = BTN_RED
    a.sticks[1]!.buttons = BTN_RED
    expect(m.ciab.pra() & CIAF_PRTRPOUT).toBe(CIAF_PRTRPOUT)
  })
})

describe('a printer', () => {
  it('reads online, with paper and not busy, on the same three pins', () => {
    const m = new Machine()
    m.parallel = new Printer()
    const v = m.ciab.pra()
    expect(v & CIAF_PRTRSEL).toBe(CIAF_PRTRSEL)
    expect(v & CIAF_PRTRBUSY).toBe(0)
    expect(v & CIAF_PRTRPOUT).toBe(0)
  })

  it('leaves the data lines idle, because nothing here drives a print stream', () => {
    const m = new Machine()
    m.parallel = new Printer()
    expect(m.cia.prb()).toBe(0xff)
  })

  it('drops SELECT when taken offline and raises BUSY while it is busy', () => {
    const m = new Machine()
    const p = new Printer()
    m.parallel = p
    p.online = false
    p.busy = true
    expect(m.ciab.pra() & CIAF_PRTRSEL).toBe(0)
    expect(m.ciab.pra() & CIAF_PRTRBUSY).toBe(CIAF_PRTRBUSY)
  })
})
