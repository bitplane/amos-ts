/**
 * What plugs into the 25-pin serial port.
 *
 * The three input handshake lines are `cia.i`:124-126, Carrier Detect, Clear
 * to Send and Data Set Ready, all three carrying the asterisk that means
 * active low, and `./cia.ts` composes them into CIA-B port A. The two
 * outputs, DTR and RTS, are `cia.i`:122-123 and are the machine's, so they
 * are latched in the chip and not here.
 *
 * `Machine.serial` was a nullable `SerialLines` that nothing ever set, and
 * meanwhile the web player's real Web Serial connection went in through
 * `Host.serial` as a Runtime callback and never touched CIA-B. A page could
 * therefore be talking to actual hardware while $bfd000 answered "empty
 * connector" on all three lines. This is the device that stops the two
 * disagreeing.
 *
 * ## What is NOT here
 *
 * The data path. SERDAT and SERDATR are Paula's, `Serial Send` and
 * `Serial Input$` go through `serial.device`, and `../runtime/ioports.ts`
 * carries that whole port. Only the three status pins are on this connector's
 * CIA side, and only they are modelled, because only they are read off a
 * register.
 */
import type { SerialLines } from './cia'
import type { Device } from './device'

/**
 * Something on the serial connector.
 *
 * A class rather than an interface for the same reason `ParallelDevice` is:
 * `Machine.attach` checks what it was handed with `instanceof`.
 */
export abstract class SerialDevice implements Device {
  readonly kind = 'serial' as const
  abstract readonly name: string
  abstract readonly description: string
  /** the three input lines, in positive logic. `./cia.ts` inverts them. */
  abstract lines(): SerialLines
}

/**
 * A cable with something powered on the far end.
 *
 * The three lines are driven by the PEER and not by this machine, so they are
 * plain fields a host sets from whatever it knows. The defaults are a
 * null-modem lead to a running machine: DSR and CTS asserted because the far
 * end is there and ready, DCD clear because there is no modem and so no
 * carrier to detect. A host with real signals to report — Web Serial's
 * `getSignals()` returns all three — overwrites them.
 */
export class SerialCable extends SerialDevice {
  readonly name: string

  carrierDetect = false
  clearToSend = true
  dataSetReady = true

  readonly description =
    'A lead to something powered on the far end, which is what asserts DSR and ' +
    'CTS at $BFD000; DCD stays clear because there is no modem to detect a ' +
    'carrier. The handshake lines only: the data path is serial.device.'

  constructor(name = 'serial cable') {
    super()
    this.name = name
  }

  lines(): SerialLines {
    return {
      carrierDetect: this.carrierDetect,
      clearToSend: this.clearToSend,
      dataSetReady: this.dataSetReady,
    }
  }
}
