/**
 * The IOPorts extension (+IO_Ports.s), slot 6: Serial, Printer, Parallel.
 *
 * Ported from source rather than disassembly — extensions/+IO_Ports.s is in
 * the official release, 1194 lines by François Lionet. The shared device
 * layer it drives (`Dev.Open`/`GetIO`/`DoIO`/`SendIO`/`CheckIO`/`AbortIO`)
 * is not in that file: it lives in the main library at +Lib.s:3068-3260, and
 * is modelled here as `DevSlot` because its behaviour IS the behaviour of
 * most of these keywords.
 *
 * WHAT IS AND IS NOT HERE. Every keyword's state, parameters, validation and
 * error numbers are faithful. What is behind the port is the host's business:
 * a real Amiga always has serial.device, printer.device and parallel.device
 * whether or not anything is plugged into them, and that is the model — the
 * device opens, and the status reports nothing attached. Programs that poll
 * (and the corpus ones do, thousands of times) then behave exactly as they
 * would on a machine with a bare port.
 *
 * These are `absent` rather than `impossible` in host.ts terms. Web Serial
 * and the browser print pipeline can supply real hardware, and slices 2 and
 * 3 wire them up; nothing here assumes they are missing forever.
 */
import { VI, VS, AmosError, int, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { ED_RUN_MESSAGES } from './edmessages.gen'

/**
 * AMOS run-time error N, with the interpreter's own wording.
 *
 * ED_RUN_MESSAGES is generated from +Editor_Config.s and is offset by 14
 * from the numbers the assembler passes around: index 126 is error 140.
 * That offset is not a guess — the source opens serial with `move.w #145,d3`
 * and parallel with `#171`, and those land exactly on "Serial device already
 * in use" and "Parallel device already used", the first message of each
 * device's block.
 */
const MSG_OFFSET = 14

export function ioError(n: number): AmosError {
  const text = ED_RUN_MESSAGES[n - MSG_OFFSET]
  return new AmosError(text && text.length > 0 ? text : `Device error ${n}`, n)
}

/** Error 23, via L_IOFonc (+IO_Ports.s:1161). */
function ioFonc(): AmosError {
  return new AmosError('Illegal function call', 23)
}

/** `NSerial equ 4` (+IO_Ports.s:69). */
export const N_SERIAL = 4

/** Error message bases, straight from the Dev.Open calls. */
const SERIAL_ERR_BASE = 145 // d3=145, d4=16  (+IO_Ports.s:328)
const PARALLEL_ERR_BASE = 171 // d3=171, d4=7  (+IO_Ports.s:1024)
const PRINTER_ERR_BASE = 161 // d3=161        (+IO_Ports.s:689)

/**
 * The 12 bytes Dev.* operates on (+Lib.s:3068). Three longs in the source:
 * the IORequest and MsgPort pointers, then a flag byte, a state byte and the
 * two error-table bytes packed into the third long.
 */
export interface DevSlot {
  /** `8(a2)` — set once OpenDevice succeeded */
  open: boolean
  /**
   * `9(a2)` — 0 no function ever issued, 1 one completed, 2 one launched and
   * not yet waited for. Dev.SendIO and Dev.DoIO both wait first when this is
   * 2, which is how a second write blocks behind an unfinished one.
   */
  state: 0 | 1 | 2
  /** `10(a2)`/`11(a2)` — this device's error message base and count */
  errBase: number
  errCount: number
}

function newSlot(errBase: number, errCount: number): DevSlot {
  return { open: false, state: 0, errBase, errCount }
}

/**
 * The serial parameters the keywords poke into the IOExtSer request. Named
 * for the source's field names so the mapping stays checkable.
 */
export interface SerialParams {
  /** IO_BAUD */
  baud: number
  /** IO_READLEN and IO_WRITELEN, which Serial Bits always sets together */
  dataBits: number
  /** IO_STOPBITS */
  stopBits: number
  /** SERB_PARTY_ON / SERB_PARTY_ODD / SEXTB_MSPON / SEXTB_MARK */
  parity: 'none' | 'even' | 'odd' | 'space' | 'mark'
  /** SERB_XDISABLED — set means XON/XOFF is OFF */
  xDisabled: boolean
  /** IO_CTLCHAR */
  ctlChar: number
  /** IO_RBUFLEN */
  bufLen: number
  /** SERB_RAD_BOOGIE, the high-speed mode Serial Fast turns on */
  radBoogie: boolean
  /** SERB_7WIRE — RTS/CTS handshaking */
  sevenWire: boolean
  /** SERB_SHARED */
  shared: boolean
}

/**
 * serial.device's own defaults, which Serial Open uses for a *user* port.
 *
 * The other branch is the interesting one and is applied in `serialOpen`.
 */
function defaultSerialParams(): SerialParams {
  return {
    baud: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    xDisabled: true,
    ctlChar: 0x11_13_00_00,
    bufLen: 512,
    radBoogie: false,
    sevenWire: false,
    shared: false,
  }
}

export interface SerialChannel {
  dev: DevSlot
  params: SerialParams
  /** bytes waiting to be read — what SDCMD_QUERY reports in IO_ACTUAL */
  rx: number[]
  /** everything written, so a test or a host can see it */
  tx: number[]
}

export interface IoPortsState {
  serial: SerialChannel[]
  printer: DevSlot
  parallel: DevSlot
  /** bytes written to the printer, in order */
  printerOut: number[]
  /** bytes written to the parallel port */
  parallelOut: number[]
}

export function newIoPortsState(): IoPortsState {
  return {
    serial: Array.from({ length: N_SERIAL }, () => ({
      dev: newSlot(SERIAL_ERR_BASE, 16),
      params: defaultSerialParams(),
      rx: [],
      tx: [],
    })),
    printer: newSlot(PRINTER_ERR_BASE, 10),
    parallel: newSlot(PARALLEL_ERR_BASE, 7),
    printerOut: [],
    parallelOut: [],
  }
}

/* ------------------------------------------------------------------ *
 * The Dev.* layer (+Lib.s:3068-3260)
 * ------------------------------------------------------------------ */

/**
 * Dev.Open (+Lib.s:3068). Opening a device that is already open is error
 * 140 — it does NOT silently succeed, and it does not reset the parameters.
 */
function devOpen(slot: DevSlot): void {
  if (slot.open) throw ioError(140)
  slot.open = true
  slot.state = 0
}

/**
 * Dev.GetIO (+Lib.s:3178). THE routine that decides what a closed device
 * does: anything touching one raises error 141, including the Check and
 * Status functions, which call through here first. A closed port does not
 * quietly report "not ready".
 */
function devGetIO(slot: DevSlot): void {
  if (!slot.open) throw ioError(141)
}

/** Dev.CloseA2. Closing a device that is not open is not an error. */
function devClose(slot: DevSlot): void {
  slot.open = false
  slot.state = 0
}

/**
 * Dev.DoIO (+Lib.s:3213) — synchronous. Waits for any outstanding request
 * first, then runs this one to completion, leaving state 1.
 */
function devDoIO(slot: DevSlot): void {
  devGetIO(slot)
  slot.state = 1
}

/**
 * Dev.SendIO (+Lib.s:3187) — asynchronous, leaving state 2. Serial Send and
 * Serial Out use this where the Parallel and Printer equivalents use DoIO,
 * so a serial write returns before it has gone out.
 *
 * DEVIATION: with no real port behind it the transfer completes instantly,
 * so the observable difference from DoIO is the state byte, which is what
 * Serial Check reads. On hardware the two genuinely differ in timing.
 */
function devSendIO(slot: DevSlot): void {
  devGetIO(slot)
  slot.state = 2
}

/**
 * Dev.CheckIO (+Lib.s:3235). GetIO first — so a closed device errors — then
 * "no function ever issued" is reported as TRUE (-1), and otherwise the
 * request is asked whether it has finished.
 */
function devCheckIO(slot: DevSlot): number {
  devGetIO(slot)
  if (slot.state === 0) return -1
  // every modelled transfer completes immediately, so CheckIO always finds
  // the request done
  return -1
}

/** Dev.AbortIO. */
function devAbort(slot: DevSlot): void {
  devGetIO(slot)
  slot.state = 1
}

/**
 * GetSerial (+IO_Ports.s:636). An UNSIGNED compare against NSerial, so a
 * negative channel fails the same test a too-large one does — both are
 * error 23 rather than an out-of-range read.
 */
function serialChannel(rt: Runtime, n: number): SerialChannel {
  // guard and index on the SAME value. Testing `n >>> 0` and then indexing
  // with `n` lets a non-integer through the check and off the end of the
  // array, handing back undefined instead of raising.
  const i = n >>> 0
  if (i >= N_SERIAL) throw ioFonc()
  return rt.ioports.serial[i]!
}

/** GetSerA1: resolve the channel, then require it open. */
function serialOpenChannel(rt: Runtime, n: number): SerialChannel {
  const ch = serialChannel(rt, n)
  devGetIO(ch.dev)
  return ch
}

/** Latin-1 bytes, which is what the devices carry. */
function bytesOf(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff)
  return out
}

/**
 * The block a Serial/Printer/Parallel Out sends, resolved once.
 *
 * One window rather than a lookup per byte — resolving per byte is what made
 * the Personnal s32Expand pass 92M lookups and doubled the census time, and
 * these are the same shape of loop. A length running past the end of the
 * region the address lands in is error 23 here, where the real machine would
 * read on into whatever followed.
 */
function outBlock(rt: Runtime, addr: number, len: number): Uint8Array {
  if (len <= 0) throw ioFonc()
  const m = rt.resolveAddr(addr)
  if (!m || m.off + len > m.data.length) throw ioFonc()
  return m.data.subarray(m.off, m.off + len)
}

/* ------------------------------------------------------------------ *
 * Keywords
 * ------------------------------------------------------------------ */

export function makeIoPortsInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): IoPortsState => rt.ioports

  /**
   * Serial Open logic,physic[,shared,xdisabled,7wires] (InSerialOpen2/5,
   * +IO_Ports.s:295/303). The two-argument form pushes three zeros and falls
   * into the five-argument one, so the defaults are shared=0, xdisabled=0,
   * 7wires=0 rather than anything device-specific.
   */
  const open = (it: Parameters<Instr>[0]): void => {
    const logic = it.evalInt()
    it.expect(',')
    const physic = it.evalInt()
    let shared = 0
    let xdis = 0
    let sevenWire = 0
    if (it.accept(',')) {
      shared = it.evalInt()
      it.expect(',')
      xdis = it.evalInt()
      it.expect(',')
      sevenWire = it.evalInt()
    }
    const ch = serialChannel(rt, logic)
    devOpen(ch.dev)
    const p = ch.params
    p.shared = shared !== 0
    p.sevenWire = sevenWire !== 0
    // SerOpA sets XDISABLED unconditionally and the xdisabled argument
    // CLEARS it — the sense of the parameter is inverted against the flag
    p.xDisabled = xdis === 0
    if (physic === 0) {
      // "If NOT user-serial (#0), default settings for French MINITEL:
      // 1200/7/1 Stop/EVEN parity" — Minitel because AMOS was French, and
      // nothing but the source records this.
      p.baud = 1200
      p.dataBits = 7
      p.stopBits = 1
      p.parity = 'even'
      p.xDisabled = true
    }
  }

  return {
    'serial open': open,

    /**
     * Serial Close [n] (InSerialClose0/1, +IO_Ports.s:351/357). With no
     * argument it closes every channel, which is also what the extension's
     * own QUIT handler calls.
     */
    'serial close'(it) {
      if (it.atStmtEnd()) {
        for (const ch of st().serial) devClose(ch.dev)
        return
      }
      devClose(serialChannel(rt, it.evalInt()).dev)
    },

    /** Serial Send ser,A$ — CMD_WRITE through SendIO, so asynchronous. */
    'serial send'(it) {
      const n = it.evalInt()
      it.expect(',')
      const s = it.evalStr()
      const ch = serialOpenChannel(rt, n)
      if (s.length === 0) throw ioFonc() // Rbeq L_IOFonc on a zero length
      ch.tx.push(...bytesOf(s))
      devSendIO(ch.dev)
    },

    /**
     * Serial Out ser,address,length. Length is tested before anything else
     * and both zero and negative are error 23 (`Rbmi`/`Rbeq L_IOFonc`).
     */
    'serial out'(it) {
      const n = it.evalInt()
      it.expect(',')
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      const ch = serialOpenChannel(rt, n)
      ch.tx.push(...outBlock(rt, addr, len))
      devSendIO(ch.dev)
    },

    /** Serial Speed ser,baud — IO_BAUD then SDCMD_SETPARAMS (Stpar). */
    'serial speed'(it) {
      const n = it.evalInt()
      it.expect(',')
      const baud = it.evalInt()
      const ch = serialOpenChannel(rt, n)
      ch.params.baud = baud
      devDoIO(ch.dev)
    },

    /** Serial Bits ser,number,stop — READLEN and WRITELEN are set together. */
    'serial bits'(it) {
      const n = it.evalInt()
      it.expect(',')
      const bits = it.evalInt()
      it.expect(',')
      const stop = it.evalInt()
      const ch = serialOpenChannel(rt, n)
      ch.params.dataBits = bits & 0xff
      ch.params.stopBits = stop & 0xff
      devDoIO(ch.dev)
    },

    /**
     * Serial Parity ser,p. The mapping is not the obvious one: -1 (or any
     * negative) is no parity, and **0 is EVEN**, not off. 1 odd, 2 space,
     * 3 mark; anything above 3 falls through with every flag cleared, which
     * is no parity again.
     */
    'serial parity'(it) {
      const n = it.evalInt()
      it.expect(',')
      const p = it.evalInt()
      const ch = serialOpenChannel(rt, n)
      ch.params.parity =
        p < 0 ? 'none' : p === 0 ? 'even' : p === 1 ? 'odd' : p === 2 ? 'space' : p === 3 ? 'mark' : 'none'
      devDoIO(ch.dev)
    },

    /**
     * Serial X ser,value. -1 disables XON/XOFF; anything else enables it and
     * becomes IO_CTLCHAR, the four control characters packed into a long.
     */
    'serial x'(it) {
      const n = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const ch = serialOpenChannel(rt, n)
      if (v === -1) {
        ch.params.xDisabled = true
      } else {
        ch.params.xDisabled = false
        ch.params.ctlChar = v
      }
      devDoIO(ch.dev)
    },

    /** Serial Buf ser,length — IO_RBUFLEN. */
    'serial buf'(it) {
      const n = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      const ch = serialOpenChannel(rt, n)
      ch.params.bufLen = len
      devDoIO(ch.dev)
    },

    /**
     * Serial Fast ser. Not just a speed switch: it clears parity, disables
     * XON/XOFF, forces 8 data bits and sets SERB_RAD_BOOGIE.
     */
    'serial fast'(it) {
      const ch = serialOpenChannel(rt, it.evalInt())
      ch.params.parity = 'none'
      ch.params.xDisabled = true
      ch.params.dataBits = 8
      ch.params.radBoogie = true
      devDoIO(ch.dev)
    },

    /** Serial Slow ser — clears RAD_BOOGIE and nothing else. */
    'serial slow'(it) {
      const ch = serialOpenChannel(rt, it.evalInt())
      ch.params.radBoogie = false
      devDoIO(ch.dev)
    },

    /** Serial Abort ser. */
    'serial abort'(it) {
      const ch = serialChannel(rt, it.evalInt())
      devAbort(ch.dev)
    },

    /* ---------------- Printer ---------------- */

    /**
     * Printer Open (InPrinterOpen, +IO_Ports.s:678). Closes AMOS's own
     * Lprint channel first (`Rbsr L_PRT_Close  Ferme LPRINT`) because both
     * want printer.device.
     */
    'printer open'() {
      devOpen(st().printer)
    },

    'printer close'() {
      devClose(st().printer)
    },

    /** Printer Send A$ — CMD_WRITE through DoIO, synchronous. */
    'printer send'(it) {
      const s = it.evalStr()
      const p = st().printer
      devGetIO(p)
      if (s.length === 0) throw ioFonc()
      st().printerOut.push(...bytesOf(s))
      devDoIO(p)
    },

    /** Printer Out address,length — PRD_RAWWRITE. */
    'printer out'(it) {
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      const p = st().printer
      devGetIO(p)
      st().printerOut.push(...outBlock(rt, addr, len))
      devDoIO(p)
    },

    'printer abort'() {
      devAbort(st().printer)
    },

    /* ---------------- Parallel ---------------- */

    /**
     * Parallel Open. Like Printer Open it closes the Lprint channel first —
     * the parallel port and the printer are the same hardware.
     */
    'parallel open'() {
      devOpen(st().parallel)
    },

    'parallel close'() {
      devClose(st().parallel)
    },

    /** Parallel Send A$ — CMD_WRITE, synchronous (DoIO, not SendIO). */
    'parallel send'(it) {
      const s = it.evalStr()
      const p = st().parallel
      devGetIO(p)
      if (s.length === 0) throw ioFonc()
      st().parallelOut.push(...bytesOf(s))
      devDoIO(p)
    },

    /** Parallel Out address,length — PRD_RAWWRITE. */
    'parallel out'(it) {
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      const p = st().parallel
      devGetIO(p)
      st().parallelOut.push(...outBlock(rt, addr, len))
      devDoIO(p)
    },

    'parallel abort'() {
      devAbort(st().parallel)
    },
  }
}

export function makeIoPortsFunctions(rt: Runtime): Record<string, Func> {
  const st = (): IoPortsState => rt.ioports

  return {
    /**
     * =Serial Check(n). Dev.CheckIO normalised to -1/0 by the caller
     * (`beq .Skip / moveq #-1,d3`). Errors 141 on a closed channel.
     */
    'serial check'(_, a): Value {
      const ch = serialChannel(rt, int(a[0]!))
      return VI(devCheckIO(ch.dev) === 0 ? 0 : -1)
    },

    /**
     * =Serial Get(n). SDCMD_QUERY first: with nothing waiting it returns
     * **-1**, otherwise it reads exactly one byte. Note the asymmetry with
     * Serial Input$, which returns an empty string in the same situation.
     */
    'serial get'(_, a): Value {
      const ch = serialOpenChannel(rt, int(a[0]!))
      devDoIO(ch.dev)
      if (ch.rx.length === 0) return VI(-1)
      devDoIO(ch.dev)
      return VI(ch.rx.shift()! & 0xff)
    },

    /**
     * =Serial Input$(n). Reads everything SDCMD_QUERY reports waiting; an
     * empty port gives the empty string rather than -1, and a count at or
     * over String_Max is error 23 instead of a truncated read.
     */
    'serial input$'(_, a): Value {
      const ch = serialOpenChannel(rt, int(a[0]!))
      devDoIO(ch.dev)
      const n = ch.rx.length
      if (n === 0) return VS('')
      if (n >= 65_536) throw ioFonc()
      const taken = ch.rx.splice(0, n)
      devDoIO(ch.dev)
      return VS(String.fromCharCode(...taken))
    },

    /** =Serial Error(n). */
    'serial error'(_, a): Value {
      const ch = serialOpenChannel(rt, int(a[0]!))
      void ch
      return VI(0)
    },

    /** =Serial Status(n) — the modem control lines; nothing attached. */
    'serial status'(_, a): Value {
      const ch = serialOpenChannel(rt, int(a[0]!))
      void ch
      return VI(0)
    },

    /**
     * =Serial Base(n). Hands back the IORequest address. There is no such
     * structure here, so this returns 0 — see the NOTES entry.
     */
    'serial base'(_, a): Value {
      const ch = serialOpenChannel(rt, int(a[0]!))
      void ch
      return VI(0)
    },

    /* ---------------- Printer ---------------- */

    'printer check'(): Value {
      return VI(devCheckIO(st().printer) === 0 ? 0 : -1)
    },

    /**
     * =Printer Online. With no printer attached the real call reports the
     * port not ready; the source's failure path is `moveq #-1,d3`.
     */
    'printer online'(): Value {
      devGetIO(st().printer)
      return VI(0)
    },

    'printer error'(): Value {
      devGetIO(st().printer)
      return VI(0)
    },

    'printer base'(): Value {
      devGetIO(st().printer)
      return VI(0)
    },

    /* ---------------- Parallel ---------------- */

    'parallel check'(): Value {
      return VI(devCheckIO(st().parallel) === 0 ? 0 : -1)
    },

    /**
     * =Parallel Status. PDCMD_QUERY then the status byte at $34 of the
     * request. Nothing attached reads as 0.
     */
    'parallel status'(): Value {
      const p = st().parallel
      devGetIO(p)
      devDoIO(p)
      return VI(0)
    },

    'parallel error'(): Value {
      devGetIO(st().parallel)
      return VI(0)
    },

    'parallel base'(): Value {
      devGetIO(st().parallel)
      return VI(0)
    },

    /** =Parallel Input$(len[,timeout]) (FnParallelInput1/2). */
    'parallel input$'(_, a): Value {
      const p = st().parallel
      devGetIO(p)
      void a
      devDoIO(p)
      return VS('')
    },
  }
}
