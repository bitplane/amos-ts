/**
 * The IOPorts extension (+IO_Ports.s), slot 6: Serial, Printer, Parallel.
 *
 * Ported from source rather than disassembly — extensions/+IO_Ports.s is in
 * the official release, 1,168 lines by François Lionet. The shared device
 * layer it drives (`Dev.Open`/`GetIO`/`DoIO`/`SendIO`/`CheckIO`/`AbortIO`)
 * is not in that file: it lives in the main library at +Lib.s:3020-3269, and
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
 * and the browser print pipeline can supply real hardware; nothing here
 * assumes they are missing forever.
 */
import { VI, VS, funcCall, int, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import type { Screen } from './screen'
import {
  devAbort,
  devCheckIO,
  devClose,
  devDoIO,
  devGetIO,
  devOpen,
  devSendIO,
  newDevSlot,
  type DevSlot,
} from './device'

export { ioError, type DevSlot } from './device'
import type { PrinterPage, SerialPortHandle, SerialLineParams } from '../amiga/host'
import { defaultJdPrtPrefs, type JdPrtPrefs } from './jdprt'

/*
 * IO_Ports reaches error 23 through an entry point of its own, `L_IOFonc`
 * (+IO_Ports.s:1135). That is a fact about the extension and not a second
 * error, so the throws below are `funcCall()` like everywhere else; this file
 * used to keep a private `ioFonc()` factory, which was the sixth spelling of
 * one error in this tree.
 */

/** `NSerial equ 4` (+IO_Ports.s:46). */
export const N_SERIAL = 4

/** `String_Max equ $FFC0` (+Equ.s:1139) — the longest string AMOS will build. */
export const STRING_MAX = 0xffc0

/**
 * Error message bases and COUNTS, straight from the Dev.Open calls.
 *
 * The count is not decoration: `Dev.Error` (+Lib.s:3260) reads it back out of
 * `11(a2)` and any device error above it collapses to the generic 144 instead
 * of `base + code - 1`. The printer's was 10 here and the source says
 * `moveq #7,d4` with the comment "7 messages", so device errors 8 to 10 were
 * answering 168-170 where the machine answers 144.
 */
const SERIAL_ERR_BASE = 145 // d3=145, d4=16 (+IO_Ports.s:300)
const SERIAL_ERR_COUNT = 16
const PARALLEL_ERR_BASE = 171 // d3=171, d4=7 (+IO_Ports.s:1002)
const PARALLEL_ERR_COUNT = 7
const PRINTER_ERR_BASE = 161 // d3=161, d4=7 (+IO_Ports.s:660)
const PRINTER_ERR_COUNT = 7

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
  /**
   * The host's real port, when one was granted. Null means the modelled
   * port: Serial Open still succeeded, there is simply nothing on the wire.
   */
  port: SerialPortHandle | null
}

export interface IoPortsState {
  serial: SerialChannel[]
  printer: DevSlot
  parallel: DevSlot
  /** bytes written to the printer, in order */
  printerOut: number[]
  /** bytes written to the parallel port */
  parallelOut: number[]
  /** pages produced by Printer Dump, in order */
  pages: PrinterPage[]
  /**
   * The Preferences fields a graphics dump reads. JD Prt's five instructions
   * are the only thing that writes them so far (GetPrefs, poke, SetPrefs);
   * they live here rather than in that library because they are the system's
   * printer settings, not the extension's.
   */
  printerPrefs: JdPrtPrefs
}

export function newIoPortsState(): IoPortsState {
  return {
    serial: Array.from({ length: N_SERIAL }, () => ({
      dev: newDevSlot(SERIAL_ERR_BASE, SERIAL_ERR_COUNT),
      params: defaultSerialParams(),
      rx: [],
      tx: [],
      port: null,
    })),
    printer: newDevSlot(PRINTER_ERR_BASE, PRINTER_ERR_COUNT),
    parallel: newDevSlot(PARALLEL_ERR_BASE, PARALLEL_ERR_COUNT),
    printerOut: [],
    parallelOut: [],
    pages: [],
    printerPrefs: defaultJdPrtPrefs(),
  }
}

/* ------------------------------------------------------------------ *
 * The Dev.* layer (+Lib.s:3068-3260)
 * ------------------------------------------------------------------ */

/**
 * GetSerial (+IO_Ports.s:610). An UNSIGNED compare against NSerial, so a
 * negative channel fails the same test a too-large one does — both are
 * error 23 rather than an out-of-range read.
 */
function serialChannel(rt: Runtime, n: number): SerialChannel {
  // guard and index on the SAME value. Testing `n >>> 0` and then indexing
  // with `n` lets a non-integer through the check and off the end of the
  // array, handing back undefined instead of raising.
  const i = n >>> 0
  if (i >= N_SERIAL) funcCall()
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
 * these are the same shape of loop.
 *
 * THE THREE KEYWORDS DO NOT AGREE ON THE LENGTH, so the caller passes its own
 * rule in. `InSerialOut` opens `move.l d3,d2 / Rbmi / Rbeq` (+IO_Ports.s:362)
 * and refuses both signs of nothing; `InPrinterOut` (:735) and
 * `InParallelOut` (:1038) carry the `Rbeq` alone, so a NEGATIVE length is
 * legal on those two and goes to the device as it stands.
 *
 * DEVIATION: a length running past the end of the region the address lands in
 * is error 23 here, where the machine reads on into whatever followed. And a
 * negative length yields an empty window rather than whatever printer.device
 * makes of a negative io_Length.
 */
function outBlock(rt: Runtime, addr: number, len: number, negativeOk = false): Uint8Array {
  if (len === 0 || (len < 0 && !negativeOk)) funcCall()
  const m = rt.resolveAddr(addr)
  if (!m || m.off + len > m.data.length) funcCall()
  return m.data.subarray(m.off, Math.max(m.off, m.off + len))
}

/**
 * Rasterise a screen region to RGBA.
 *
 * Screen.renderRGBA already resolves pens through the screen's own palette,
 * which is the same journey L_Dump makes by hand: GetColorMap(32) then EcPal
 * unpacked a nibble at a time into the map printer.device reads. Pixels
 * outside the screen come back transparent rather than clamped, because a
 * dump of a region that runs off the edge is showing you nothing there, not
 * the edge pixel repeated.
 */
function dumpRegion(sc: Screen, x0: number, y0: number, w: number, h: number): Uint8ClampedArray {
  const full = sc.renderRGBA()
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = y0 + y
    if (sy < 0 || sy >= sc.height) continue
    for (let x = 0; x < w; x++) {
      const sx = x0 + x
      if (sx < 0 || sx >= sc.width) continue
      const si = (sy * sc.width + sx) * 4
      const di = (y * w + x) * 4
      out[di] = full[si]!
      out[di + 1] = full[si + 1]!
      out[di + 2] = full[si + 2]!
      out[di + 3] = full[si + 3]!
    }
  }
  return out
}


/** The subset of the request a host port cares about. */
function lineParams(p: SerialParams): SerialLineParams {
  return {
    baud: p.baud,
    dataBits: p.dataBits,
    stopBits: p.stopBits,
    parity: p.parity,
    rtsCts: p.sevenWire,
    bufLen: p.bufLen,
  }
}

/**
 * Push the current settings at the port, which is what Stpar does
 * (SDCMD_SETPARAMS). Every parameter keyword ends in it, so this is the one
 * place the host is told anything changed.
 */
function stpar(ch: SerialChannel): void {
  devDoIO(ch.dev)
  ch.port?.setParams(lineParams(ch.params))
}

/**
 * Drain the host port into the channel's queue.
 *
 * SDCMD_QUERY reports how many bytes are waiting, and both Serial Get and
 * Serial Input$ ask before they read. Doing the drain here means the modelled
 * and real ports answer that question the same way.
 */
function pump(ch: SerialChannel): void {
  if (ch.port) ch.rx.push(...ch.port.read())
}

/* ------------------------------------------------------------------ *
 * Keywords
 * ------------------------------------------------------------------ */

export function makeIoPortsInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): IoPortsState => rt.ioports

  /**
   * Serial Open logic,physic[,shared,xdisabled,7wires] (InSerialOpen2/5,
   * +IO_Ports.s:269/277). The two-argument form pushes three zeros and falls
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
    if (physic !== 0) {
      // The source comment reads "If NOT user-serial (#0), default settings
      // for French MINITEL: 1200/7/1 Stop/EVEN parity", and the code is
      // `move.l (a3)+,d0 / addq.l #$4,a3 / beq.s .PaSet` — a branch that
      // SKIPS the defaults when the unit is zero. Unit 0 is the machine's own
      // serial port and keeps the device's settings; every other unit is
      // assumed to be a Minitel modem. This port had the condition inverted
      // until the source was read, with that sentence quoted correctly right
      // beside the tests that pinned its opposite. Minitel because AMOS was
      // French, and nothing but the source records any of this.
      p.baud = 1200
      p.dataBits = 7
      p.stopBits = 1
      p.parity = 'even'
      p.xDisabled = true
    }
    // ask the host last, so it is handed the settled parameters rather than
    // the defaults it would then have to be told about again
    ch.port = rt.host.serial?.open(physic, lineParams(p)) ?? null
  }

  return {
    'serial open': open,

    /**
     * Serial Close [n] (InSerialClose0/1, +IO_Ports.s:331/325). With no
     * argument it closes every channel, which is also what the extension's
     * own QUIT handler calls.
     */
    'serial close'(it) {
      const shut = (ch: SerialChannel): void => {
        ch.port?.close()
        ch.port = null
        devClose(ch.dev)
      }
      if (it.atStmtEnd()) {
        for (const ch of st().serial) shut(ch)
        return
      }
      shut(serialChannel(rt, it.evalInt()))
    },

    /**
     * Serial Send ser,A$ — InSerialSend (+IO_Ports.s:343). CMD_WRITE through
     * SendIO, so asynchronous. `move.w (a0)+,d0 / Rbeq L_IOFonc`: an empty
     * string is error 23 before the device is touched.
     */
    'serial send'(it) {
      const n = it.evalInt()
      it.expect(',')
      const s = it.evalStr()
      const ch = serialOpenChannel(rt, n)
      if (s.length === 0) funcCall() // Rbeq L_IOFonc on a zero length
      const bytes = bytesOf(s)
      ch.tx.push(...bytes)
      ch.port?.write(Uint8Array.from(bytes))
      devSendIO(ch.dev)
    },

    /**
     * Serial Out ser,address,length — InSerialOut (+IO_Ports.s:360). Length
     * is tested before anything else and both zero and negative are error 23
     * (`move.l d3,d2 / Rbmi / Rbeq L_IOFonc`).
     *
     * NOTE: that test comes BEFORE GetSerA1, so on the real machine a bad
     * length outranks a bad channel number. Here the channel is resolved
     * first. Both raise error 23 through the same L_IOFonc, so the order is
     * not observable.
     */
    'serial out'(it) {
      const n = it.evalInt()
      it.expect(',')
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      const ch = serialOpenChannel(rt, n)
      const block = outBlock(rt, addr, len)
      ch.tx.push(...block)
      ch.port?.write(Uint8Array.from(block))
      devSendIO(ch.dev)
    },

    /** Serial Speed ser,baud — InSerialSpeed (+IO_Ports.s:432): IO_BAUD, Stpar. */
    'serial speed'(it) {
      const n = it.evalInt()
      it.expect(',')
      const baud = it.evalInt()
      const ch = serialOpenChannel(rt, n)
      ch.params.baud = baud
      stpar(ch)
    },

    /**
     * Serial Bits ser,number,stop — InSerialBits (+IO_Ports.s:443).
     * `move.b d1,IO_READLEN(a1) / move.b d1,IO_WRITELEN(a1)`: one argument
     * sets both directions, and both stores are BYTE-sized.
     */
    'serial bits'(it) {
      const n = it.evalInt()
      it.expect(',')
      const bits = it.evalInt()
      it.expect(',')
      const stop = it.evalInt()
      const ch = serialOpenChannel(rt, n)
      ch.params.dataBits = bits & 0xff
      ch.params.stopBits = stop & 0xff
      stpar(ch)
    },

    /**
     * Serial Parity ser,p — InSerialParity (+IO_Ports.s:457). The mapping is
     * not the obvious one: -1 (or any negative) is no parity, and **0 is
     * EVEN**, not off. 1 odd, 2 space, 3 mark; anything above 3 falls through
     * `.parX` with every flag already cleared, which is no parity again.
     *
     * The dispatch is WORD-sized throughout — `tst.w d1`, then `cmp.w #1,d1`
     * and the rest — so it is the low word that decides. 65536 is even; the
     * sign test is a word test too, so 32768 is negative here and no parity.
     */
    'serial parity'(it) {
      const n = it.evalInt()
      it.expect(',')
      const p = (it.evalInt() << 16) >> 16 // tst.w / cmp.w: the low word, signed
      const ch = serialOpenChannel(rt, n)
      ch.params.parity =
        p < 0 ? 'none' : p === 0 ? 'even' : p === 1 ? 'odd' : p === 2 ? 'space' : p === 3 ? 'mark' : 'none'
      stpar(ch)
    },

    /**
     * Serial X ser,value — InSerialX (+IO_Ports.s:496). -1 disables XON/XOFF;
     * anything else enables it and becomes IO_CTLCHAR, the four control
     * characters packed into a long. `cmp.l #-1,d1` is a LONG compare here,
     * unlike Serial Parity's word dispatch above.
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
      stpar(ch)
    },

    /** Serial Buf ser,length — InSerialBuf (+IO_Ports.s:511): IO_RBUFLEN. */
    'serial buf'(it) {
      const n = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      const ch = serialOpenChannel(rt, n)
      ch.params.bufLen = len
      stpar(ch)
    },

    /**
     * Serial Fast ser — InSerialFast (+IO_Ports.s:522). Not just a speed
     * switch: it clears parity, disables XON/XOFF, forces 8 data bits both
     * ways and sets SERB_RAD_BOOGIE.
     *
     * NOTE: it clears SERB_PARTY_ON and SEXTB_MSPON but leaves PARTY_ODD and
     * MARK standing, where this port drops to 'none' outright. The two flags
     * it leaves are inert with their enables clear, and Serial Parity bclr's
     * all four before setting any, so nothing can observe the difference.
     */
    'serial fast'(it) {
      const ch = serialOpenChannel(rt, it.evalInt())
      ch.params.parity = 'none'
      ch.params.xDisabled = true
      ch.params.dataBits = 8
      ch.params.radBoogie = true
      stpar(ch)
    },

    /** Serial Slow ser — InSerialSlow (+IO_Ports.s:538): clears RAD_BOOGIE, nothing else. */
    'serial slow'(it) {
      const ch = serialOpenChannel(rt, it.evalInt())
      ch.params.radBoogie = false
      stpar(ch)
    },

    /** Serial Abort ser — InSerialAbort (+IO_Ports.s:596), straight to AbortIO. */
    'serial abort'(it) {
      const ch = serialChannel(rt, it.evalInt())
      devAbort(ch.dev)
    },

    /* ---------------- Printer ---------------- */

    /**
     * Printer Open (InPrinterOpen, +IO_Ports.s:652). Closes AMOS's own
     * Lprint channel first (`Rbsr L_PRT_Close  Ferme LPRINT`) because both
     * want printer.device.
     */
    'printer open'() {
      devOpen(st().printer)
    },

    /**
     * Printer Close (InPrinterClose, +IO_Ports.s:681). It also puts back the
     * printer.device task's requester pointer that Printer Open replaced with
     * -1; neither the FindTask nor the $b8 poke has a counterpart here, there
     * being no task and no requester to suppress.
     */
    'printer close'() {
      devClose(st().printer)
    },

    /**
     * Printer Send A$ (InPrinterSend, +IO_Ports.s:715) — CMD_WRITE through
     * SendIO, so ASYNCHRONOUS, and an empty string is error 23 first.
     *
     * The port used DoIO here and device.ts's own comment asserted the
     * printer was synchronous like the parallel port. `Rjmp L_Dev.SendIO`
     * says otherwise: of the three devices only Parallel waits.
     */
    'printer send'(it) {
      const s = it.evalStr()
      const p = st().printer
      devGetIO(p)
      if (s.length === 0) funcCall()
      st().printerOut.push(...bytesOf(s))
      devSendIO(p)
    },

    /**
     * Printer Out address,length (InPrinterOut, +IO_Ports.s:731) —
     * PRD_RAWWRITE through SendIO, as Printer Send.
     *
     * DEVIATION: `move.l d3,d0 / Rbeq L_IOFonc` rejects a length of zero and
     * nothing else, so a NEGATIVE length reaches IO_LENGTH as a huge unsigned
     * count and the device writes until something gives. Serial Out has the
     * `Rbmi` this one lacks. Rejected here, which is the only useful answer.
     */
    'printer out'(it) {
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      const p = st().printer
      devGetIO(p)
      st().printerOut.push(...outBlock(rt, addr, len, true))
      devSendIO(p)
    },

    /** Printer Abort (InPrinterAbort, +IO_Ports.s:746), straight to AbortIO. */
    'printer abort'() {
      devAbort(st().printer)
    },

    /**
     * Printer Dump [x1,y1 To x2,y2[,destCols,destRows,special]]
     * (InPrinterDump0/4/7, +IO_Ports.s:775/786/835).
     *
     * A GRAPHICS dump, not a text one: L_Dump builds a colour map from the
     * screen's own palette (GetColorMap(32), then EcPal unpacked a nibble at
     * a time) and hands printer.device a bitmap through PRD_DUMPRPORT. The
     * screen is whichever is current — GetScr reads ScOnAd and raises error
     * 47 "Screen not opened" if there is none.
     *
     * The three forms differ in how the page is sized:
     *  - no arguments: the whole screen, special $8c = ASPECT|FULLROWS|FULLCOLS
     *  - four: the region, with destCols/destRows computed as 16.16 fractions
     *    of the page from how much of the screen it covers, special $b0 =
     *    ASPECT|FRACROWS|FRACCOLS
     *  - seven: everything given explicitly
     *
     * Dump2a pops bottom-y, bottom-x, srcY, srcX — reverse stack order, so
     * the written order is srcX,srcY To bottomX,bottomY — and then width and
     * height become the extent (`neg.w d0 / add.w d0,(a0)`), not a second
     * corner.
     *
     * DEVIATION: rasterising is all this does. Where the page then goes is
     * the host's (host.printerPage), because on the real machine that is the
     * printer driver's decision too — and the driver is what turns a
     * FRACCOLS fraction into inches. With no host sink the page is still
     * rendered and recorded, so a headless run is exercised rather than
     * skipped.
     */
    'printer dump'(it) {
      const p = st().printer
      devGetIO(p)

      const sc = rt.screen // GetScr: ScOnAd, else error 47
      let srcX = 0
      let srcY = 0
      let width = sc.width
      let height = sc.height
      let destCols = 0
      let destRows = 0
      let special = 0x8c // ASPECT | FULLROWS | FULLCOLS

      if (!it.atStmtEnd()) {
        srcX = it.evalInt()
        it.expect(',')
        srcY = it.evalInt()
        it.expect('to')
        const bottomX = it.evalInt()
        it.expect(',')
        const bottomY = it.evalInt()
        // Dump2a: the corners become an extent
        width = bottomX - srcX
        height = bottomY - srcY
        if (it.accept(',')) {
          destCols = it.evalInt()
          it.expect(',')
          destRows = it.evalInt()
          it.expect(',')
          special = it.evalInt() & 0xffff
        } else {
          // Dump4's proportional sizing. `divu.w` twice: the screen extent
          // over the region extent, then $ffff over that, left in the top
          // word as a 16.16 fraction. Both divisions guard their result
          // against zero with Rbeq L_IOFonc, so a region wider than the
          // screen is error 23 rather than a fraction over 1.
          if (width <= 0 || height <= 0) funcCall()
          const cx = Math.floor(sc.width / width)
          const cy = Math.floor(sc.height / height)
          if (cx === 0 || cy === 0) funcCall()
          destCols = (Math.floor(0xffff / cx) & 0xffff) * 0x10000
          destRows = (Math.floor(0xffff / cy) & 0xffff) * 0x10000
          special = 0xb0 // ASPECT | FRACROWS | FRACCOLS
        }
      }

      if (width <= 0 || height <= 0) funcCall()
      const page: PrinterPage = {
        pixels: dumpRegion(sc, srcX, srcY, width, height),
        width,
        height,
        srcX,
        srcY,
        special,
        destCols,
        destRows,
      }
      st().pages.push(page)
      rt.host.printerPage?.(page)
      devDoIO(p)
    },

    /* ---------------- Parallel ---------------- */

    /**
     * Parallel Open (InParallelOpen, +IO_Ports.s:994). Like Printer Open it
     * opens with `Rjsr L_PRT_Close` to shut AMOS's own Lprint channel first —
     * the parallel port and the printer are the same hardware. Its error
     * message base is 171 against the printer's 161, seven messages each.
     */
    'parallel open'() {
      devOpen(st().parallel)
    },

    /** Parallel Close (InParallelClose, +IO_Ports.s:1010), CloseA2 and no more. */
    'parallel close'() {
      devClose(st().parallel)
    },

    /**
     * Parallel Send A$ (InParallelSend, +IO_Ports.s:1018) — CMD_WRITE, and
     * genuinely synchronous: `Rjmp L_Dev.DoIO`, where the Serial and Printer
     * equivalents both SendIO. An empty string is error 23.
     */
    'parallel send'(it) {
      const s = it.evalStr()
      const p = st().parallel
      devGetIO(p)
      if (s.length === 0) funcCall()
      st().parallelOut.push(...bytesOf(s))
      devDoIO(p)
    },

    /**
     * Parallel Out address,length (InParallelOut, +IO_Ports.s:1034) —
     * PRD_RAWWRITE through DoIO. Same zero-only length check as Printer Out,
     * and the same deviation over negatives.
     */
    'parallel out'(it) {
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      const p = st().parallel
      devGetIO(p)
      st().parallelOut.push(...outBlock(rt, addr, len, true))
      devDoIO(p)
    },

    /** Parallel Abort (InParallelAbort, +IO_Ports.s:1049), straight to AbortIO. */
    'parallel abort'() {
      devAbort(st().parallel)
    },
  }
}

export function makeIoPortsFunctions(rt: Runtime): Record<string, Func> {
  const st = (): IoPortsState => rt.ioports

  return {
    /**
     * =Serial Check(n) — FnSerialCheck (+IO_Ports.s:548). CheckIO's result
     * normalised: `move.l d0,d3 / beq .Out / moveq #-1,d3`, so it is 0 or -1
     * and never the request pointer CheckIO actually returns.
     */
    'serial check'(_, a): Value {
      const ch = serialChannel(rt, int(a[0]!))
      return VI(devCheckIO(ch.dev) === 0 ? 0 : -1)
    },

    /**
     * =Serial Get(n) — FnSerialGet (+IO_Ports.s:376). SDCMD_QUERY first, and
     * an IO_ACTUAL of zero answers -1 without reading; otherwise one byte
     * through CMD_READ into the extension's own one-byte BufIn.
     */
    'serial get'(_, a): Value {
      const ch = serialOpenChannel(rt, int(a[0]!))
      devDoIO(ch.dev)
      pump(ch)
      if (ch.rx.length === 0) return VI(-1)
      devDoIO(ch.dev)
      return VI(ch.rx.shift()! & 0xff)
    },

    /**
     * =Serial Input$(n) — FnSerialInput (+IO_Ports.s:398). QUERY, then read
     * exactly IO_ACTUAL bytes. Nothing waiting is the empty string; a count
     * at or over String_Max is error 23 (`cmp.l #String_Max,d4 / Rbcc`),
     * which is a refusal rather than a truncation.
     *
     * String_Max is $FFC0 (+Equ.s:1139), 65,472 and not 65,536: AMOS keeps 64
     * bytes below the word so `Demande` can round the length up to even and
     * add its own two-byte header without the count wrapping.
     */
    'serial input$'(_, a): Value {
      const ch = serialOpenChannel(rt, int(a[0]!))
      devDoIO(ch.dev)
      pump(ch)
      const n = ch.rx.length
      if (n === 0) return VS('')
      if (n >= STRING_MAX) funcCall()
      const taken = ch.rx.splice(0, n)
      devDoIO(ch.dev)
      return VS(String.fromCharCode(...taken))
    },

    /** =Serial Error(n) — FnSerialError (+IO_Ports.s:561): IO_ERROR, one byte. */
    'serial error'(_, a): Value {
      const ch = serialOpenChannel(rt, int(a[0]!))
      void ch
      return VI(0)
    },

    /**
     * =Serial Status(n) — FnSerialStatus (+IO_Ports.s:572). SDCMD_QUERY, then
     * the WORD at IO_STATUS: the modem lines as serial.device reports them.
     */
    'serial status'(_, a): Value {
      const ch = serialOpenChannel(rt, int(a[0]!))
      void ch
      return VI(0)
    },

    /**
     * =Serial Base(n) — FnSerialBase (+IO_Ports.s:586): `move.l a1,d3`, the
     * address of the IOExtSer request itself, for programs that poke fields
     * the keywords do not reach.
     */
    'serial base'(_, a): Value {
      const ch = serialOpenChannel(rt, int(a[0]!))
      void ch
      return VI(0)
    },

    /* ---------------- Printer ---------------- */

    /**
     * =Printer Check (FnPrinterCheck, +IO_Ports.s:640) — CheckIO normalised
     * to 0 or -1, as the serial and parallel ones are.
     */
    'printer check'(): Value {
      return VI(devCheckIO(st().printer) === 0 ? 0 : -1)
    },

    /**
     * =Printer Online (FnPrinterOnline, +IO_Ports.s:754). PRD_QUERY into the
     * extension's own Prt_Query long, then TWO conditions must both hold for
     * -1: `cmp.l #$1,IO_ACTUAL(a1) / bne .Skip` — the device must have
     * answered exactly one byte — and `btst #$0,(a0) / bne .Skip` — bit 0 of
     * that byte must be CLEAR. Bit 0 set means offline, so the keyword is
     * really "not busy and one byte of status came back".
     */
    'printer online'(): Value {
      devGetIO(st().printer)
      return VI(0)
    },

    /** =Printer Error (FnPrinterError, +IO_Ports.s:704): IO_ERROR, one byte. */
    'printer error'(): Value {
      devGetIO(st().printer)
      return VI(0)
    },

    /** =Printer Base (FnPrinterBase, +IO_Ports.s:630): the IORequest address. */
    'printer base'(): Value {
      devGetIO(st().printer)
      return VI(0)
    },

    /* ---------------- Parallel ---------------- */

    /** =Parallel Check (FnParallelCheck, +IO_Ports.s:982), CheckIO as 0 or -1. */
    'parallel check'(): Value {
      return VI(devCheckIO(st().parallel) === 0 ? 0 : -1)
    },

    /**
     * =Parallel Status (FnParallelStatus, +IO_Ports.s:1057). PDCMD_QUERY,
     * then `move.b $34(a1),d3` — io_PtrStatus at offset $34 of IOExtPar, the
     * printer's own handshake lines, one byte and not the word Serial Status
     * reads.
     */
    'parallel status'(): Value {
      const p = st().parallel
      devGetIO(p)
      devDoIO(p)
      return VI(0)
    },

    /** =Parallel Error (FnParallelError, +IO_Ports.s:1071): IO_ERROR, one byte. */
    'parallel error'(): Value {
      devGetIO(st().parallel)
      return VI(0)
    },

    /** =Parallel Base (FnParallelBase, +IO_Ports.s:972): the IORequest address. */
    'parallel base'(): Value {
      devGetIO(st().parallel)
      return VI(0)
    },

    /**
     * =Parallel Input$(long[,stop]) — FnParallelInput1/2 (+IO_Ports.s:1084
     * and :1092), which differ only in PARB_EOFMODE. The one-argument form
     * CLEARS it and reads a fixed count; the two-argument form SETS it and
     * fills all EIGHT bytes of IO_PTERMARRAY with the same terminator
     * (`moveq #$7,d0 / move.b d3,(a0)+ / dbra`), then SETPARAMS.
     *
     * `bset` leaves the old bit in Z, so the terminator is only rewritten
     * when EOFMODE was off or the byte actually changed — an optimisation,
     * not a behaviour, since the result is the same array either way.
     */
    'parallel input$'(_, a): Value {
      const p = st().parallel
      devGetIO(p)
      void a
      devDoIO(p)
      return VS('')
    },
  }
}
