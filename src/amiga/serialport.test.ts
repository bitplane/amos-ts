/**
 * The serial port's three input handshake lines, with and without a cable.
 *
 * All three carry the asterisk in `cia.i`:124-126, so they read LOW when
 * asserted. An empty connector reads all three HIGH, which is the same byte
 * as a cable reporting nothing.
 */
import { describe, expect, it } from 'vitest'
import { CIAF_COMCD, CIAF_COMCTS, CIAF_COMDSR } from './cia'
import { Machine } from './machine'
import { SerialCable } from './serialport'

describe('the serial connector', () => {
  it('reads all three lines inactive with nothing plugged in', () => {
    const v = new Machine().ciab.pra()
    expect(v & CIAF_COMCD).toBe(CIAF_COMCD)
    expect(v & CIAF_COMCTS).toBe(CIAF_COMCTS)
    expect(v & CIAF_COMDSR).toBe(CIAF_COMDSR)
  })

  it('asserts DSR and CTS for a cable to a running peer, and not DCD', () => {
    const m = new Machine()
    m.serial = new SerialCable()
    const v = m.ciab.pra()
    expect(v & CIAF_COMDSR).toBe(0)
    expect(v & CIAF_COMCTS).toBe(0)
    // no modem, so no carrier
    expect(v & CIAF_COMCD).toBe(CIAF_COMCD)
  })

  it('takes its lines from the far end, which a host can change', () => {
    const m = new Machine()
    const cable = new SerialCable('host serial port')
    m.serial = cable
    cable.carrierDetect = true
    cable.clearToSend = false
    expect(m.ciab.pra() & CIAF_COMCD).toBe(0)
    expect(m.ciab.pra() & CIAF_COMCTS).toBe(CIAF_COMCTS)
    expect(cable.name).toBe('host serial port')
  })
})
