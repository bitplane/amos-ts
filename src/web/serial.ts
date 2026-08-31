/**
 * Web Serial, behind the Host.serial capability.
 *
 * AMOS's Serial keywords and Web Serial line up almost exactly — IO_BAUD is
 * baudRate, IO_READLEN/WRITELEN is dataBits, IO_STOPBITS is stopBits, the
 * SERB_PARTY_* flags are parity, SERB_7WIRE is hardware flow control. What
 * does not line up is the permission model and the async model, and those
 * are what this file is for.
 *
 * PERMISSION. navigator.serial.requestPort() needs transient user
 * activation, and a program reaching Serial Open has none — it is halfway
 * through a BASIC listing. getPorts() has no such requirement, so the split
 * is: a button in the host UI calls requestPort() once, and from then on
 * open() finds the port with getPorts() and Serial Open works silently. A
 * program run before anything is granted gets the modelled port, which is
 * the same thing a real Amiga gives you with no cable in the socket.
 *
 * ASYNC. Web Serial reads and writes through streams; AMOS reads a byte at a
 * time from a device that has already buffered them. So a read loop runs in
 * the background filling an array, and read() drains it — which is what
 * serial.device's own read buffer (IO_RBUFLEN, Serial Buf) does anyway.
 *
 * Availability: Chromium desktop over HTTPS. Firefox, Safari and mobile have
 * no Web Serial, and `available()` says so rather than throwing later.
 */
import type { SerialHost, SerialLineParams, SerialPortHandle } from '../amiga/host'

/** The slice of the Web Serial API this uses, so the DOM lib is not required. */
interface WebSerialPort {
  open(options: {
    baudRate: number
    dataBits?: number
    stopBits?: number
    parity?: 'none' | 'even' | 'odd'
    bufferSize?: number
    flowControl?: 'none' | 'hardware'
  }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  getSignals(): Promise<{
    dataCarrierDetect: boolean
    clearToSend: boolean
    dataSetReady: boolean
    ringIndicator: boolean
  }>
}

interface WebSerial {
  getPorts(): Promise<WebSerialPort[]>
  requestPort(): Promise<WebSerialPort>
}

function api(): WebSerial | null {
  const nav = navigator as unknown as { serial?: WebSerial }
  return nav.serial ?? null
}

/** Whether this browser has Web Serial at all. */
export function available(): boolean {
  return api() !== null
}

/**
 * Web Serial takes none/even/odd only. AMOS also offers space and mark
 * (SEXTB_MSPON / SEXTB_MARK), which no browser exposes; they degrade to no
 * parity rather than refusing the open, because the alternative is a program
 * that works on the Amiga and dies here over a setting almost nothing uses.
 */
function parityOf(p: SerialLineParams['parity']): 'none' | 'even' | 'odd' {
  return p === 'even' || p === 'odd' ? p : 'none'
}

function openOptions(p: SerialLineParams): Parameters<WebSerialPort['open']>[0] {
  return {
    baudRate: p.baud,
    dataBits: p.dataBits === 7 ? 7 : 8,
    stopBits: p.stopBits === 2 ? 2 : 1,
    parity: parityOf(p.parity),
    bufferSize: Math.max(256, Math.min(p.bufLen | 0, 1 << 20)),
    // SERB_7WIRE is the full RS-232 handshake. XON/XOFF (SERB_XDISABLED and
    // IO_CTLCHAR) has no Web Serial equivalent at all and is not applied —
    // a program relying on software flow control will not get it.
    flowControl: p.rtsCts ? 'hardware' : 'none',
  }
}

/**
 * One granted port, opened lazily.
 *
 * Every method is synchronous because the Host contract is, and the contract
 * is synchronous because AMOS is: Serial Send goes through Dev.SendIO and
 * returns before the bytes leave. So writes queue and the promise chain is
 * kept privately; failures land in `failed` rather than propagating into the
 * middle of a BASIC statement.
 */
class WebSerialHandle implements SerialPortHandle {
  private buf: number[] = []
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  /** set if the port failed; the channel then behaves like the modelled one */
  failed = false
  /** serial.device IO_STATUS, initially the disconnected active-low state */
  private lineStatus = 0x00f8
  private pollingSignals = false

  constructor(
    private readonly port: WebSerialPort,
    params: SerialLineParams,
  ) {
    this.tail = port
      .open(openOptions(params))
      .then(() => {
        this.pollSignals()
        return this.pump()
      })
      .catch(() => {
        this.failed = true
      })
  }

  /** Drain the readable stream into `buf` until the port closes. */
  private async pump(): Promise<void> {
    const stream = this.port.readable
    if (!stream) return
    const reader = stream.getReader()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done || this.closed) break
        if (value) for (const b of value) this.buf.push(b)
      }
    } catch {
      this.failed = true
    } finally {
      reader.releaseLock()
    }
  }

  write(bytes: Uint8Array): void {
    if (this.closed || this.failed) return
    this.tail = this.tail
      .then(async () => {
        if (!this.writer) {
          const w = this.port.writable
          if (!w) return
          this.writer = w.getWriter()
        }
        await this.writer.write(bytes)
      })
      .catch(() => {
        this.failed = true
      })
  }

  read(): number[] {
    if (this.buf.length === 0) return []
    const out = this.buf
    this.buf = []
    return out
  }

  /** Refresh Web Serial's async modem inputs and return the cached word. */
  status(): number {
    this.pollSignals()
    return this.lineStatus
  }

  private pollSignals(): void {
    if (this.closed || this.failed || this.pollingSignals) return
    this.pollingSignals = true
    void this.port
      .getSignals()
      .then((s) => {
        // Inputs are active low in IO_STATUS. Web Serial reports positive
        // logic. Bit 2 is the A500/A2000 ring-indicator connection.
        let v = this.lineStatus & ~0x003c
        if (s.ringIndicator) v |= 0x0004
        if (!s.dataSetReady) v |= 0x0008
        if (!s.clearToSend) v |= 0x0010
        if (!s.dataCarrierDetect) v |= 0x0020
        this.lineStatus = v
      })
      .catch(() => {})
      .finally(() => {
        this.pollingSignals = false
      })
  }

  /**
   * Re-opening is the only way to change the line settings — Web Serial has
   * no equivalent of SDCMD_SETPARAMS on a live port. Anything already
   * buffered survives, because the bytes arrived before the change and a
   * program that set the speed after reading should still see them.
   */
  setParams(params: SerialLineParams): void {
    if (this.closed || this.failed) return
    this.tail = this.tail
      .then(async () => {
        this.writer?.releaseLock()
        this.writer = null
        await this.port.close()
        await this.port.open(openOptions(params))
        this.pollSignals()
        void this.pump()
      })
      .catch(() => {
        this.failed = true
      })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.tail = this.tail.then(() => this.port.close()).catch(() => {})
  }
}

/**
 * A SerialHost over the ports the user has already granted.
 *
 * The grants are collected once at construction and refreshed by
 * `requestAccess`, because open() must not await — it is called from inside
 * a running BASIC statement.
 */
export class WebSerialHost implements SerialHost {
  private ports: WebSerialPort[] = []

  constructor() {
    void this.refresh()
  }

  private async refresh(): Promise<void> {
    const s = api()
    if (!s) return
    try {
      this.ports = await s.getPorts()
    } catch {
      this.ports = []
    }
  }

  /** How many ports are available to programs right now. */
  get granted(): number {
    return this.ports.length
  }

  /**
   * Prompt for a port. MUST be called from a user gesture — a click handler,
   * not a program. Returns whether a port was granted.
   */
  async requestAccess(): Promise<boolean> {
    const s = api()
    if (!s) return false
    try {
      await s.requestPort()
      await this.refresh()
      return this.ports.length > 0
    } catch {
      // the user dismissed the chooser, which is not an error
      return false
    }
  }

  open(unit: number, params: SerialLineParams): SerialPortHandle | null {
    // AMOS's physical unit numbers the ports; a machine with one serial
    // socket has unit 0, and unit 0 is also what Serial Open n,0 asks for
    const port = this.ports[unit] ?? this.ports[0]
    if (!port) return null
    return new WebSerialHandle(port, params)
  }
}
