/**
 * CIA-A port A, against `hardware/cia.i` release 1.3 and against the two
 * keywords that read the byte from opposite ends.
 *
 * The include file is in the corpus at
 * `AMOSPro Sources/includes/hardware/cia.i`, so every bit position and every
 * polarity below is checkable rather than recalled.
 */
import { describe, expect, it } from 'vitest'
import {
  CIAA_PRA,
  CIAA_SDR,
  CIAF_DSKCHANGE,
  CIAF_DSKPROT,
  CIAF_DSKRDY,
  CIAF_DSKTRACK0,
  CIAF_GAMEPORT0,
  CIAF_GAMEPORT1,
  CIAF_LED,
  CIAF_OVERLAY,
  CIAB_PRA_OUTPUTS,
  CIAF_COMCD,
  CIAF_COMCTS,
  CIAF_DSKSEL1,
  CIAF_DSKSEL3,
  CIAF_DSKSTEP,
  CIAF_PRTRBUSY,
  CIAF_PRTRPOUT,
  CIAF_PRTRSEL,
  CiaA,
  CiaB,
  type CiaAWires,
  type DiskLines,
} from './cia'

/** wires a test can move, starting where an idle machine is */
function bench(): { cia: CiaA; w: { fire0: boolean; fire1: boolean; disk: DiskLines | null } } {
  const w = { fire0: false, fire1: false, disk: null as DiskLines | null }
  const wires: CiaAWires = {
    fire0: () => w.fire0,
    fire1: () => w.fire1,
    disk: () => w.disk,
    parallel: () => null,
  }
  return { cia: new CiaA(wires), w }
}

describe('the bit map, off cia.i:141-149', () => {
  it('is the eight masks in the order the include file lists them', () => {
    expect([
      CIAF_OVERLAY,
      CIAF_LED,
      CIAF_DSKCHANGE,
      CIAF_DSKPROT,
      CIAF_DSKTRACK0,
      CIAF_DSKRDY,
      CIAF_GAMEPORT0,
      CIAF_GAMEPORT1,
    ]).toEqual([1, 2, 4, 8, 16, 32, 64, 128])
  })

  it('puts ciasdr $0c00 up from ciapra, which is $c00 of ODD addresses', () => {
    // cia.i:22-36 spaces the registers $100 apart, and ciaa is on the odd
    // byte of a word, so the addresses differ by exactly the offset
    expect(CIAA_SDR - CIAA_PRA).toBe(0x0c00)
  })
})

describe('an idle machine', () => {
  it('reads $fc: everything inactive, and both output bits clear', () => {
    // six active-low pins all high, OVL clear because the machine has booted,
    // LED clear because a bright LED is a 0 and the filter comes up engaged
    expect(bench().cia.pra()).toBe(0xfc)
  })

  it('reports the filter engaged, which is what the port always claimed', () => {
    expect(bench().cia.ledBright).toBe(true)
  })

  it('has never received a keyboard byte', () => {
    expect(bench().cia.sdr).toBe(0)
  })
})

describe('the pins, all six active low', () => {
  it('clears bit 6 when gameport 0 fire goes down', () => {
    const { cia, w } = bench()
    w.fire0 = true
    expect(cia.pra() & CIAF_GAMEPORT0).toBe(0)
    expect(cia.pra() & CIAF_GAMEPORT1).toBe(CIAF_GAMEPORT1)
  })

  it('clears bit 7 for gameport 1, which is the other player', () => {
    const { cia, w } = bench()
    w.fire1 = true
    expect(cia.pra()).toBe(0xfc & ~CIAF_GAMEPORT1)
  })

  it('reads all four floppy lines inactive when no drive is selected', () => {
    // an Amiga with every DSKSEL line high: not ready, not on track 0, not
    // write protected, no change. That is a real state, not a placeholder.
    const v = bench().cia.pra()
    expect(v & (CIAF_DSKRDY | CIAF_DSKTRACK0 | CIAF_DSKPROT | CIAF_DSKCHANGE)).toBe(
      CIAF_DSKRDY | CIAF_DSKTRACK0 | CIAF_DSKPROT | CIAF_DSKCHANGE,
    )
  })

  it('clears the lines a selected drive asserts', () => {
    const { cia, w } = bench()
    w.disk = { ready: true, track0: true, writeProtected: false, changed: false }
    expect(cia.pra() & CIAF_DSKRDY).toBe(0)
    expect(cia.pra() & CIAF_DSKTRACK0).toBe(0)
    expect(cia.pra() & CIAF_DSKPROT).toBe(CIAF_DSKPROT)
    expect(cia.pra() & CIAF_DSKCHANGE).toBe(CIAF_DSKCHANGE)
  })
})

describe('the LED bit, cia.i:116 "led light control (0==>bright)"', () => {
  it('sets the bit when the LED goes dark', () => {
    const { cia } = bench()
    cia.ledBright = false
    expect(cia.pra() & CIAF_LED).toBe(CIAF_LED)
    expect(cia.pra()).toBe(0xfe)
  })

  it('fires onLed once per change and not on a write that changes nothing', () => {
    const { cia } = bench()
    const seen: boolean[] = []
    cia.onLed = (b) => seen.push(b)
    cia.ledBright = false
    cia.ledBright = false
    cia.ledBright = true
    expect(seen).toEqual([false, true])
  })

  it('is what a bchg reaches, which is First 0.1 routine 3', () => {
    // `bchg.b #$1,$bfe001` read back through the register rather than
    // through a boolean beside it
    const { cia } = bench()
    cia.writePra(cia.pra() ^ CIAF_LED)
    expect(cia.ledBright).toBe(false)
    cia.writePra(cia.pra() ^ CIAF_LED)
    expect(cia.ledBright).toBe(true)
  })
})

describe('what a write reaches', () => {
  it('lands on OVL and LED and evaporates on the six pins', () => {
    const { cia, w } = bench()
    cia.writePra(0xff)
    expect(cia.overlay).toBe(true)
    expect(cia.ledBright).toBe(false)
    // the mouse button is a pin: setting its bit does not stick it down, and
    // pressing it still shows through
    w.fire0 = true
    expect(cia.pra() & CIAF_GAMEPORT0).toBe(0)
  })

  it('a write of all zeroes leaves the pins reading high', () => {
    const { cia } = bench()
    cia.writePra(0x00)
    expect(cia.pra()).toBe(0xfc)
  })
})

describe('CIA-B port A: three printer lines and three serial inputs', () => {
  it('reads $ff with nothing on either cable', () => {
    // the serial three are active low and idle high; the printer three carry
    // NO asterisk in cia.i and idle high too, which reads as busy, out of
    // paper and selected at once. That is what a disconnected port is.
    expect(new CiaB().pra()).toBe(0xff)
  })

  it('clears a printer line when the printer says the opposite', () => {
    const b = new CiaB({
      parallel: () => ({ data: 0xff, busy: false, paperOut: false, selected: true }),
      serial: () => null,
    })
    expect(b.pra() & CIAF_PRTRBUSY).toBe(0)
    expect(b.pra() & CIAF_PRTRPOUT).toBe(0)
    expect(b.pra() & CIAF_PRTRSEL).toBe(CIAF_PRTRSEL)
  })

  it('clears a serial line when it IS asserted, because those are active low', () => {
    const b = new CiaB({
      parallel: () => null,
      serial: () => ({ carrierDetect: true, clearToSend: false, dataSetReady: false }),
    })
    expect(b.pra() & CIAF_COMCD).toBe(0)
    expect(b.pra() & CIAF_COMCTS).toBe(CIAF_COMCTS)
  })

  it('keeps DTR and RTS, and drops a write to the six pins', () => {
    const b = new CiaB()
    b.writePra(0x00)
    expect(b.pra()).toBe(0xff & ~CIAB_PRA_OUTPUTS)
  })
})

describe('CIA-B port B: the four floppy control lines', () => {
  it('is all outputs at boot, which is where trackdisk leaves DDRB', () => {
    const b = new CiaB()
    expect(b.ddrb).toBe(0xff)
    expect(b.prb()).toBe(0xff)
    expect(b.motorLine).toBe(false)
    expect(b.selected).toBeNull()
  })

  it('runs the four instructions six keywords share, and the motor comes on', () => {
    // move.b #$7f / #$77 / #$ff to DDRB -- Misc's `Dled Off`, Delta's
    // `Delta Drive Motor Off`, JD's `Jd Dled Off`, all identical
    const b = new CiaB()
    b.writePrb(0x7f)
    expect(b.motorLine).toBe(true)
    expect(b.selected).toBeNull()
    b.writePrb(0x77)
    expect(b.selected).toBe(0)
    b.ddrb = 0xff
    expect(b.motorLine).toBe(true)
  })

  it('and DDRB=0 releases every line, which is what stops it', () => {
    // the data register is unchanged; the chip simply stops driving, and the
    // pull-ups take the lines inactive. This is why all three extensions have
    // the pair named backwards.
    const b = new CiaB()
    b.writePrb(0x77)
    b.ddrb = 0x00
    expect(b.prb()).toBe(0xff)
    expect(b.motorLine).toBe(false)
    expect(b.selected).toBeNull()
  })

  it('picks the lowest unit when two select lines are somehow low at once', () => {
    const b = new CiaB()
    b.writePrb(0xff & ~(CIAF_DSKSEL1 | CIAF_DSKSEL3))
    expect(b.selected).toBe(1)
  })

  it('reports the three head lines as asserted or not, and no further', () => {
    const b = new CiaB()
    expect([b.sideLine, b.directionLine, b.stepLine]).toEqual([false, false, false])
    b.writePrb(0xff & ~CIAF_DSKSTEP)
    expect(b.stepLine).toBe(true)
  })
})
