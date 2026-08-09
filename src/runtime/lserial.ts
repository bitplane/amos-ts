/**
 * LSerial 2.1 — Niklas Sjöberg, fifteen keywords at slot 11, read off the
 * binary and against the shipped `HELP.DOC`.
 *
 * A serial.device wrapper written because AMOS's own did not work: *"AMOS's
 * serial didn't work in 1.0/1.1, in 1.2/1.3 it worked, but only sometimes and
 * only a little :-) The main 1.3-bug seems to be when one tries to open the
 * device after closing it once and then trying to open it again."* Twelve of
 * the fifteen are a thin, honest layer over exec's `DoIO`/`SendIO`/`CheckIO`;
 * the other three are `Linkey$`, `Lser Status` and `Lxpr`, which is a whole
 * XPR host in one keyword.
 *
 * ## Evidence
 *
 * BINARY tier with a thorough .DOC, and the two agree everywhere. `LSerial.LIB`
 * is a 10,532-byte code hunk with 19 jump-table entries, 15 of them keywords;
 * `extdis lserial-2.1` disassembles it. `LserialV21.DOC` gives the argument
 * order and meaning of every keyword, the full `Lser Status` bit table and the
 * whole of the XPR contract, and marks what each release added.
 *
 * The slot is the doc's, in unusually plain terms — *"you MUST place LSerial as
 * extension number eleven (11) ... If you MUST or NEED to have it configured as
 * another number then send me a disk full of nice programs"* — and routine 0
 * agrees: the data zone goes to `$198(a5)`, which is `($198-$f8)/16+1 = 11`.
 *
 * ## What it keeps
 *
 * Three exec IORequests and two message ports, in one block:
 *
 *     +$000  IOExtSer   the READ request, and the one every status query uses
 *     +$052  MsgPort    its reply port
 *     +$074  IOExtSer   the WRITE request — Lser Send and Lser Mulsend
 *     +$0c6  MsgPort
 *     +$0e8  MsgPort
 *     +$10a  IOExtSer   the third request, opened alongside
 *     +$132  char[]     the device name Lser Open copies out of its argument
 *     +$1a2  APTR       intuition.library, for the shareware nag
 *
 * The IOExtSer offsets are the reason this reads cleanly: `$1c` is io_Command,
 * `$20` io_Actual, `$24` io_Length, `$28` io_Data, `$34` io_RBufLen, `$38`
 * io_ExtFlags, `$3c` io_Baud, `$40` io_BrkTime, `$4c`/`$4d` io_ReadLen and
 * io_WriteLen, `$4e` io_StopBits, `$4f` io_SerFlags and `$50` io_Status. Every
 * keyword here is one or two of those fields and a `DoIO`.
 *
 * ## The nag
 *
 * This build is the unregistered one — its `$VER` cookie says
 * `LSerial_V21_UnRegistered` — and every error path flashes COLOR00 and
 * BPLCON1 white in a `dbra` loop, flips to the Workbench screen, prints
 * *" UNREGISTERED SHAREWARE version of LSerial!  Author really should
 * register!"*, flips back, and only then raises the error. The string is in
 * the binary ten times, once per raise site.
 *
 * DEVIATION: the flash and the message are not reproduced. They are a
 * shareware nag attached to an error that IS reproduced, and rendering them
 * would mean driving the Workbench screen from inside a keyword that is about
 * to raise.
 *
 * ## Lxpr
 *
 * One keyword, 7,220 bytes, and the whole of an XPR host: twenty-two callbacks
 * — `xpr_fopen`, `xpr_sread`, `xpr_update`, `xpr_chkabort` and the rest — which
 * an `xpr*.library` calls back into while it runs a file transfer. The
 * dispatch on its fourth argument is exact and is reproduced; what cannot be
 * is a transfer, because no `xpr*.library` is modelled. See the keyword.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { AmosError, VI, VS, int, str } from '../interp/values'
import type { SerialLineParams, SerialPortHandle } from '../amiga/host'
import { openLibrary } from '../amiga/exec'

/**
 * The extension's own error table, in the order the strings sit in the binary
 * at $280c — which is the order `L_ErrorExt`'s index puts them in, since every
 * raise site sets d0 to the index and the messages are consecutive.
 */
export const LSERIAL_ERRORS = [
  'Serial already open!',
  'Invalid devicename!',
  'Unable to open device!',
  'Overflow in string buffer!',
  'Invalid read size!',
  'Command need NULL-terminated string!',
  "You can't call with empty argument!",
  'Invalid XPR-customstring (a-m)',
  'Non valid XPR-command',
]

const lserError = (n: number): never => {
  throw new AmosError(LSERIAL_ERRORS[n] ?? `LSerial error ${n}`)
}

/** `cmp.l #$fa00,d4 / bcs` — the most `Lser Read` will build a string from */
const READ_LIMIT = 0xfa00

/** The one open device, and everything `Lser Params` and `Lser Baud` poke into it. */
export interface LSerialDevice {
  name: string
  unit: number
  /** io_Baud, io_ReadLen/io_WriteLen, io_StopBits, io_RBufLen, io_BrkTime */
  baud: number
  dataBits: number
  stopBits: number
  bufLen: number
  brkTime: number
  /** io_SerFlags and io_ExtFlags, kept as the bytes the keywords write */
  serFlags: number
  extFlags: number
  /** io_Status, the sixteen bits `Lser Status` and `Lcarrier` read */
  status: number
  /** bytes waiting, which is what SDCMD_QUERY reports in io_Actual */
  rx: number[]
  /** everything written, so a test or a host can see it */
  tx: number[]
  /** the host's port when one was granted; null is the modelled one */
  port: SerialPortHandle | null
}

export interface LSerialState {
  dev: LSerialDevice | null
  /** whether a `Lser Mulsend` SendIO is still outstanding */
  mulBusy: boolean
  /** the xpr*.library base `Lxpr(...,XPROPEN)` took — always 0 here */
  xprBase: number
}

export const newLSerialState = (): LSerialState => ({ dev: null, mulBusy: false, xprBase: 0 })

/**
 * io_Status as serial.device leaves it, in the doc's own table.
 *
 * Bits 3 to 7 (DSR, CTS, CD, RTS, DTR) are ACTIVE LOW, so the quiet state has
 * them SET; bit 2 (ring indicator) is active high. With nothing on the wire the
 * modem lines are all inactive, which is every active-low bit set and nothing
 * else — and `Lcarrier`, which tests bit 5, therefore answers 0. Handing back
 * zero instead would claim carrier, DSR and CTS on a port with no cable.
 */
const IDLE_STATUS = 0b1111_1000

const lineParams = (d: LSerialDevice): SerialLineParams => ({
  baud: d.baud,
  dataBits: d.dataBits,
  stopBits: d.stopBits,
  // SERB_PARTY_ON is bit 1 of io_SerFlags, SERB_PARTY_ODD bit 2
  parity: d.serFlags & 0x40 ? (d.serFlags & 0x20 ? 'odd' : 'even') : 'none',
  // SERB_7WIRE is bit 2 of io_SerFlags as the header numbers them, $04
  rtsCts: (d.serFlags & 0x04) !== 0,
  bufLen: d.bufLen,
})

/** Latin-1 bytes, which is what the device carries */
const bytesOf = (s: string): number[] => [...s].map((c) => c.charCodeAt(0) & 0xff)

/** the device, or the raise every read/write path makes when there is none */
function device(rt: Runtime): LSerialDevice {
  const d = rt.lserial.dev
  // The doc is explicit that this is the program's job and not the library's:
  // "If you for instance try to call Lser Send as the first instruction in
  // your program it will hang OR crash the computer! Always use Lser Open!"
  // There is no check in the routine; a crash is not reproducible, so the
  // extension's own "Unable to open device!" stands in for it.
  if (d === null) lserError(2)
  return d!
}

/**
 * SDCMD_QUERY — drain the host port into the queue and answer io_Actual.
 *
 * Every status keyword issues it, which is why `Lcarrier` and `Lser Status`
 * see fresh modem lines and `Lser Read` sees fresh bytes: on the machine the
 * query IS the refresh.
 */
function query(d: LSerialDevice): number {
  if (d.port) d.rx.push(...d.port.read())
  return d.rx.length
}

/** CMD_READ of exactly n bytes, as far as the queue goes */
function take(d: LSerialDevice, n: number): string {
  const got = d.rx.splice(0, n)
  return String.fromCharCode(...got)
}

function write(d: LSerialDevice, s: string): void {
  const bytes = bytesOf(s)
  d.tx.push(...bytes)
  d.port?.write(Uint8Array.from(bytes))
}

export function makeLSerialInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Routine 1 — `Lser Open BAUD,RWLEN,STOP,BUFSIZE,BRKTIME,FLAGS,UNIT,NAME$`.
     *
     * The pops run right to left, so the name comes first and the baud rate
     * last. In order:
     *
     *     tst.l $e(a4) / bne -> error 0        already open
     *     CreatePort x2, CreateStdIO x2        the request block
     *     name: length 0 -> error 1            "Invalid devicename!"
     *     move.b FLAGS,$4f(a1)                 io_SerFlags
     *     OpenDevice(name, UNIT, req, 0)
     *     tst.l d0 / bne -> error 2            "Unable to open device!"
     *     BRKTIME->$40  BUFSIZE->$34  STOP->$4e  RWLEN->$4c/$4d  BAUD->$3c
     *     SDCMD_SETPARAMS
     *
     * NOTE: `FLAGS` is written into io_SerFlags BEFORE `OpenDevice`, which is
     * the only way to choose shared or exclusive access — the doc says so:
     * *"According to C= Autodocs it is always best to decide if access shall be
     * shared or exclusive when opening the device."* Everything else is set
     * afterwards and can be changed later with `Lser Params`.
     *
     * The doc's own advice about `BUF_SIZE` — *"MUST be >512 bytes"* — is not
     * checked anywhere in the routine.
     */
    'lser open'(it) {
      const st = rt.lserial
      const baud = it.evalInt()
      it.expect(',')
      const dataBits = it.evalInt()
      it.expect(',')
      const stopBits = it.evalInt()
      it.expect(',')
      const bufLen = it.evalInt()
      it.expect(',')
      const brkTime = it.evalInt()
      it.expect(',')
      const serFlags = it.evalInt()
      it.expect(',')
      const unit = it.evalInt()
      it.expect(',')
      const name = it.evalStr()

      if (st.dev !== null) lserError(0)
      if (name.length === 0) lserError(1)
      const dev: LSerialDevice = {
        name,
        unit,
        baud,
        dataBits,
        stopBits,
        bufLen,
        brkTime,
        serFlags: serFlags & 0xff,
        extFlags: 0,
        status: IDLE_STATUS,
        rx: [],
        tx: [],
        port: null,
      }
      // A device this port does not model is "Unable to open device!", which
      // is exactly what a machine without it answers. serial.device is the
      // one there is a back-end for.
      if (name.toLowerCase() !== 'serial.device') lserError(2)
      dev.port = rt.host.serial?.open(unit, lineParams(dev)) ?? null
      st.dev = dev
      st.mulBusy = false
    },

    /**
     * Routine 2 — `Lser Close`.
     *
     * `RemPort` on the reply ports and `CloseDevice` on the requests, each
     * guarded by a `tst.l` so that closing when nothing is open does nothing.
     * That guard is the doc's *"It is safe to call Lser Close even though no
     * device is open, so it might be a good idea to always do this before your
     * program exists"* — and, given why this extension exists at all, the
     * close-then-reopen path is the one it was written to get right.
     */
    'lser close'() {
      const st = rt.lserial
      st.dev?.port?.close()
      st.dev = null
      st.mulBusy = false
    },

    /**
     * Routine 3 — `Lser Send A$`: io_Length and io_Data from the string,
     * `CMD_WRITE` through `DoIO`, so it does not come back until the whole
     * string has gone. An empty string is skipped before the request is even
     * filled in.
     *
     * NOTE: it uses the SECOND request, at +$74, where every read and every
     * status query uses the one at +0. That is what lets `Lser Mulsend` be
     * outstanding while a read happens.
     */
    'lser send'(it) {
      const s = it.evalStr()
      if (s.length === 0) return
      write(device(rt), s)
    },

    /**
     * Routine 7 — `Lser Mulsend A$`: the same request and the same command
     * through `SendIO` instead, so control comes straight back.
     *
     * DEVIATION: the write completes immediately here, because the host port
     * is fire-and-forget by design (see `SerialPortHandle.write`). So
     * `Lser Mulcheck` answers true on the very next statement, where a real
     * one at 300 baud would not. The doc's warning is about the gap this port
     * does not have: *"If you try to send any more data before Mulsend has
     * completed only garbage will be output."*
     */
    'lser mul send'(it) {
      const s = it.evalStr()
      if (s.length === 0) return
      write(device(rt), s)
      rt.lserial.mulBusy = false
    },

    /**
     * Routine 11 — `Lser Brk`: `SDCMD_BREAK`, whose length was set once by
     * `Lser Open`'s BRKTIME argument and can be changed by `Lser Params`.
     *
     * DEVIATION: nothing is sent. A break is a line condition rather than a
     * byte — the transmit line held low for io_BrkTime microseconds — and
     * neither the modelled port nor Web Serial has a way to express one.
     */
    'lser brk'() {
      device(rt)
    },

    /**
     * Routine 12 — `Lser Baud NEWRATE`: io_Baud and `SDCMD_SETPARAMS` on BOTH
     * requests, the read one and the write one, which is the only keyword here
     * that touches both. *"NOTE! This command has been here all along, I've
     * just missed it in the documentation! Sorry.."*
     */
    'lser baud'(it) {
      const d = device(rt)
      d.baud = it.evalInt()
      d.port?.setParams(lineParams(d))
    },

    /**
     * Routine 15 — `Lser Params RWLEN,STOP,BUFSIZE,BRKTIME,EXTFLAGS,FLAGS`.
     *
     * Six fields poked straight into the read request and one
     * `SDCMD_SETPARAMS`, and the pops give the doc's order exactly: FLAGS to
     * io_SerFlags ($4f), EXTFLAGS to io_ExtFlags ($38), BRKTIME to io_BrkTime
     * ($40), BUFSIZE to io_RBufLen ($34), STOP to io_StopBits ($4e), and RWLEN
     * to io_ReadLen AND io_WriteLen ($4c and $4d), which is why the doc calls
     * it "number of bits when read/write" rather than naming two.
     *
     * `EXTFLAGS` is the release's own addition: *"Bit 24 'if mark-space, use
     * mark'. Bit 25, use mark-space. These flags where added mostly due to
     * future compability."*
     */
    'lser params'(it) {
      const d = device(rt)
      const dataBits = it.evalInt()
      it.expect(',')
      const stopBits = it.evalInt()
      it.expect(',')
      const bufLen = it.evalInt()
      it.expect(',')
      const brkTime = it.evalInt()
      it.expect(',')
      const extFlags = it.evalInt()
      it.expect(',')
      const serFlags = it.evalInt()
      d.dataBits = dataBits
      d.stopBits = stopBits
      d.bufLen = bufLen
      d.brkTime = brkTime
      d.extFlags = extFlags
      d.serFlags = serFlags & 0xff
      d.port?.setParams(lineParams(d))
    },
  }
}

export function makeLSerialFunctions(rt: Runtime): Record<string, Func> {
  return {
    /**
     * Routine 6 — `=Lser Query`: `SDCMD_QUERY` and io_Actual, so the number of
     * characters the device has buffered. The doc's advice for every other
     * read: *"A good advise is to use Lser Query or Lcarrier before trying to
     * read anything."*
     */
    'lser query': () => VI(query(device(rt))),

    /**
     * Routine 4 — `=Lser Read`: query, then `CMD_READ` of everything waiting.
     *
     *     move.l $20(a1),d4 / beq -> the empty string
     *     cmp.l #$fa00,d4 / bcc -> error 3     "Overflow in string buffer!"
     *
     * 64000 is the ceiling, and it is a real one rather than a formality — the
     * doc's own warning is *"WARNING If there are VERY many characters to read
     * AMOS may crash"*, and the check is what stands between the program and
     * that. Nothing waiting gives AMOS's shared empty string, `$68a(a5)`.
     */
    'lser read': () => {
      const d = device(rt)
      const n = query(d)
      if (n === 0) return VS('')
      if (n >= READ_LIMIT) lserError(3)
      return VS(take(d, n))
    },

    /**
     * Routine 9 — `=Lser Get(N)`: `CMD_READ` of exactly N characters, and it
     * does not come back until they arrive.
     *
     *     cmp.l #$0,d3 / bhi -> ok             UNSIGNED
     *
     * DEFECT: the guard is unsigned, so it refuses N of zero — error 4,
     * "Invalid read size!" — and lets a NEGATIVE N through as a number near
     * four billion, which then asks AMOS for a string of that length. The doc
     * says only *"N Is the number of characters you wish to read"*.
     *
     * DEVIATION: on the machine this blocks inside `DoIO` with interrupts
     * running, which the doc warns about — *"This can cause AMOS to hang if
     * you haven't any CARRIER and no data appears"*. Here it yields the frame
     * and re-runs the statement, so a program that never receives N characters
     * waits for ever, which is what it would do on the machine, while
     * everything else keeps running, which is not.
     */
    'lser get': (it, a) => {
      const d = device(rt)
      const n = int(a[0]!)
      if ((n >>> 0) === 0) lserError(4)
      if (query(d) < n >>> 0) {
        it.block({ type: 'wait', until: Math.floor(it.tick) + 1 }, true)
        return VS('')
      }
      return VS(take(d, n >>> 0))
    },

    /**
     * Routine 8 — `=Lser Mulcheck`: `CheckIO` on the write request, and any
     * non-zero answer becomes -1. True means the send has finished.
     */
    'lser mul check': () => VI(rt.lserial.mulBusy ? 0 : -1),

    /**
     * Routine 10 — `=Lcarrier`: `SDCMD_QUERY`, then `btst #$5` on io_Status.
     *
     * Bit 5 is Carrier Detect and it is ACTIVE LOW, so the bit being CLEAR is
     * carrier present — which is why the routine answers -1 on `beq` and 0 on
     * `bne`, the opposite way round from how it reads. The doc: *"You can use
     * Lcarrier to check for carrier instead of using Lser Status (Lcarrier is
     * faster)."*
     */
    'lcarrier': () => {
      const d = device(rt)
      query(d)
      return VI(d.status & 0x20 ? 0 : -1)
    },

    /**
     * Routine 16 — `=Lser Status`: `SDCMD_QUERY` and io_Status as an unsigned
     * word, which is the doc's thirteen-line bit table. Bits 3 to 7 — DSR,
     * CTS, CD, RTS, DTR — are active LOW; bits 2 and 8 to 12 active high; the
     * rest reserved, and *"16-31 Always zero"*, which the `moveq #$0,d3` before
     * the `move.w` makes true.
     */
    'lser status': () => VI(device(rt).status & 0xffff),

    /**
     * Routine 14 — `=Linkey$`, the ANSI translator.
     *
     * `SyCall Inkey` hands back a longword: the ASCII in bits 0-7, the raw key
     * code in 8-15 and the QUALIFIER byte in 24-31 — which is what makes the
     * whole routine work, because `asr.w #$8,d1` shifts the raw code down into
     * the low byte and leaves the qualifiers untouched above it.
     *
     *     tst.w d1 / beq             nothing pressed -> the empty string
     *     tst.b d1 / beq             no ASCII -> asr.w #8, use the raw code
     *     cmp.b #$1c / #$1f          the four cursor keys -> "ESC [ x"
     *     btst #$1b,d1               bit 27 = CTRL in the qualifier byte
     *     cmp.b #$68 / beq           'h' with CTRL -> $7f, DEL
     *     'A'..'Y' -> +$20 -> -$60   CTRL-A is 1
     *
     * The cursor mapping is 28 to `ESC[C`, 29 to `ESC[D`, 30 to `ESC[A` and 31
     * to `ESC[B` — right, left, up and down, which is AMOS's own numbering
     * turned into ANSI's.
     *
     * DEFECT: `cmp.b #$5a,d1 / bcc` skips the lowercase fold for 'Z' as well
     * as for everything above it, so CTRL with a SHIFTED Z gives `Chr$(250)`
     * where every other shifted letter gives 1 to 25. Unshifted Ctrl-Z is
     * fine, because lowercase 'z' never needed the fold.
     *
     * NOTE: 'h' with CTRL is the one letter singled out, and it becomes DEL
     * rather than backspace — which is what a VT100 host expects and what the
     * doc means by *"Always use this instead of Inkey$ if you are to be able to
     * communicate with another (ANSI/VT100) terminal."*
     */
    'linkey$': (it) => {
      // SyCall Inkey, which this port keeps as a queue rather than a register
      const k = it.inp.keyQueue.shift()
      if (k === undefined) return VS('')
      it.inp.lastScan = k.scan
      it.inp.lastShift = k.shift ?? 0
      const ascii = k.ch.length > 0 ? k.ch.charCodeAt(0) & 0xff : 0
      if (((k.scan & 0xff) << 8 | ascii) === 0) return VS('')
      // bit 27 of the longword is bit 3 of the qualifier byte, raw key $63
      const ctrl = ((k.shift ?? 0) & 0x08) !== 0
      let c = ascii
      if (c === 0) c = k.scan & 0xff
      else if (c >= 0x1c && c <= 0x1f) {
        return VS('\x1b[' + { 0x1c: 'C', 0x1d: 'D', 0x1e: 'A', 0x1f: 'B' }[c])
      }
      if (!ctrl) return VS(String.fromCharCode(c))
      if (c === 0x68) return VS('\x7f')
      if (c < 0x41) return VS(String.fromCharCode(c))
      // `bcc` on $5a, so 'Z' itself skips the fold and lands on 250
      if (c < 0x5a) c += 0x20
      return VS(String.fromCharCode((c - 0x60) & 0xff))
    },

    /**
     * Routine 13 — `=Lxpr(FILENAME$,SETUP$,LIBRARY$,FUNCTION)`, 7,220 bytes and
     * the whole of an XPR host.
     *
     * XPR — eXternal PRotocol, *"invented by W.G.J Langevald in 1989"* — puts
     * the protocol in a library and the plumbing in the program: the library
     * runs the transfer and calls back for every read, write, file operation
     * and progress update. This keyword is those twenty-two callbacks, which is
     * why it is one keyword and not eight: *"the AMOS compiler treats all
     * functions as local, as it datas"*, so splitting them would have linked
     * the whole XPR block into every program that used any of the others.
     *
     * The dispatch is eight `cmp.b`s on the fourth argument, and it is exact:
     *
     *     5 XPRREAD    6 XPRWRITE   2 XPROPEN    3 XPRCLOSE
     *     4 XPRSETUP   0 XPRSEND    1 XPRRECEIVE 7 XPRCUSTOMIZE
     *     anything else -> error 8, "Non valid XPR-command"
     *
     * READ and WRITE are checked FIRST, which the doc explains: *"XPRREAD and
     * XPRWRITE are always checked for first, guaranteeing you as fast as
     * possible reads and writes to/from the device."*
     *
     * APPROXIMATED, and here is the line. Every arm that does not need a
     * library is reproduced exactly: XPROPEN is `OldOpenLibrary` on the name
     * given and answers `"OK"` or the empty string, and since no
     * `xpr*.library` is modelled — see ../amiga/exec.ts — it answers the empty
     * string, which is what a machine without one does. XPRCLOSE with nothing
     * open returns without touching anything, exactly as the routine's
     * `tst.l (a1) / beq` does. XPRREAD and XPRWRITE fall through to a plain
     * `SDCMD_QUERY`+`CMD_READ` and `CMD_WRITE` when no library has asked for
     * `XProtocolHostMon`, which is the same code `Lser Read` and `Lser Send`
     * run. What cannot happen is a TRANSFER: XPRSEND, XPRRECEIVE, XPRSETUP and
     * XPRCUSTOMIZE all need a library that opened, and none can.
     *
     * NOTE: the doc is emphatic that FILENAME$ and SETUP$ must be
     * NUL-terminated by the program — *"WARNING! FILENAME\$ MUST BE
     * NULLTERMINATED! (FILENAME\$=FILENAME\$+Chr\$(0))"* — and the routine
     * checks: `cmpi.b #$0,(a1,d0.w)` on the last character, error 5 if not.
     * That check is reproduced, because it fires before the library is needed.
     */
    'lxpr': (_it, a) => {
      const st = rt.lserial
      const filename = str(a[0]!)
      const setup = str(a[1]!)
      const library = str(a[2]!)
      const fn = int(a[3]!) & 0xff

      const nulTerminated = (s: string): void => {
        if (s.length === 0) lserError(6)
        if (s.charCodeAt(s.length - 1) !== 0) lserError(5)
      }

      switch (fn) {
        case 5: {
          // XPRREAD: no library has asked for HostMon, so it is Lser Read
          const d = device(rt)
          const n = query(d)
          return VS(n === 0 ? '' : take(d, n))
        }
        case 6:
          // XPRWRITE: and likewise UserMon, so it is Lser Send
          write(device(rt), filename)
          return VS('')
        case 2:
          if (library.length === 0) return VS('')
          st.xprBase = openLibrary(library.replace(/\0+$/, ''))
          return VS(st.xprBase === 0 ? '' : 'OK')
        case 3:
          // XProtocolCleanup then CloseLibrary, and nothing at all when the
          // base is zero
          st.xprBase = 0
          return VS('')
        case 0:
        case 1:
          nulTerminated(filename)
          return VS('')
        case 4:
          nulTerminated(setup)
          return VS('')
        case 7:
          return VS('')
        default:
          return lserError(8)
      }
    },
  }
}
