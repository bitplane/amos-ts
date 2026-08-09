/**
 * AMOS's device layer — `Dev.Open` / `GetIO` / `DoIO` / `SendIO` / `CheckIO`
 * / `AbortIO`, from +Lib.s:3068-3260.
 *
 * ## Why this is here and not in src/amiga
 *
 * It looks like OS and it is not. These are `Lib_Def Dev.Open` and its
 * neighbours in AMOS's OWN main library: a thin wrapper AMOS wrote over
 * exec's OpenDevice/DoIO/SendIO, with its own 12-byte slot structure and its
 * own error numbering. exec is underneath it, but what is modelled here is
 * AMOS's wrapper, so by the rule in src/amiga/README.md — that layer is
 * AmigaOS, not AMOS — it stays on this side of the line.
 *
 * What it is NOT is IOPorts'. It lived inside `ioports.ts` because IOPorts
 * was the first port to need it, which is the same way `dospattern.ts` spent
 * its life called `ldospat.ts`. Serial, Printer and Parallel each own a slot,
 * and anything else that later drives a device through AMOS gets the same
 * behaviour rather than a second reading of it.
 *
 * ## The state byte is the interesting part
 *
 * `9(a2)` is 0 when no function has ever been issued, 1 when one completed,
 * and 2 when one was launched and not yet waited for. Both DoIO and SendIO
 * wait first when it is 2, which is how a second write blocks behind an
 * unfinished one — and why Serial Send (SendIO) and Parallel Send (DoIO)
 * differ in a way a program can observe through Serial Check.
 */
import { AmosError } from '../interp/values'
import type { SerialLineParams, SerialPortHandle } from '../amiga/host'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'

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

/** a slot for a device whose error block starts at `errBase` */
export function newDevSlot(errBase: number, errCount: number): DevSlot {
  return { open: false, state: 0, errBase, errCount }
}

/**
 * Dev.Open (+Lib.s:3068). Opening a device that is already open is error
 * 140 — it does NOT silently succeed, and it does not reset the parameters.
 */
export function devOpen(slot: DevSlot): void {
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
export function devGetIO(slot: DevSlot): void {
  if (!slot.open) throw ioError(141)
}

/** Dev.CloseA2. Closing a device that is not open is not an error. */
export function devClose(slot: DevSlot): void {
  slot.open = false
  slot.state = 0
}

/**
 * Dev.DoIO (+Lib.s:3213) — synchronous. Waits for any outstanding request
 * first, then runs this one to completion, leaving state 1.
 */
export function devDoIO(slot: DevSlot): void {
  devGetIO(slot)
  slot.state = 1
}

/**
 * Dev.SendIO (+Lib.s:3187) — asynchronous, leaving state 2. Serial Send/Out
 * and PRINTER Send/Out both end `Rjmp L_Dev.SendIO`; only the Parallel pair
 * uses DoIO. This comment used to claim the printer was synchronous like the
 * parallel port, which +IO_Ports.s:741 and :757 contradict, and ioports.ts
 * had been written to match the comment rather than the source.
 *
 * DEVIATION: with no real port behind it the transfer completes instantly,
 * so the observable difference from DoIO is the state byte, which is what
 * Serial Check reads. On hardware the two genuinely differ in timing.
 */
export function devSendIO(slot: DevSlot): void {
  devGetIO(slot)
  slot.state = 2
}

/**
 * Dev.CheckIO (+Lib.s:3235). GetIO first — so a closed device errors — then
 * "no function ever issued" is reported as TRUE (-1), and otherwise the
 * request is asked whether it has finished.
 */
export function devCheckIO(slot: DevSlot): number {
  devGetIO(slot)
  if (slot.state === 0) return -1
  // every modelled transfer completes immediately, so CheckIO always finds
  // the request done
  return -1
}

/** Dev.AbortIO. */
export function devAbort(slot: DevSlot): void {
  devGetIO(slot)
  slot.state = 1
}

// ---- the Dev * keyword family (+Lib.s:3300-3385) -------------------------

/**
 * `Dev_Max equ 7` with `Dev_List rs.b 12*Dev_Max` (+Equ.s:1421).
 *
 * DEFECT: the two disagree by one. `Dev.GetA2` admits a channel with
 * `cmp.l #Dev_Max,d0 / Rbhi L_FonCall`, so 0 to 7 inclusive pass, and
 * `Dev.Close` sweeps `moveq #Dev_Max,d2` down through zero -- eight channels
 * either way. The table is only seven slots of twelve bytes, so channel 7
 * reads and writes the twelve bytes AFTER it, which belong to whatever
 * +Equ.s declares next. Eight slots are kept here: the arithmetic a program
 * can see is the same, and there is nothing beyond the table for it to
 * corrupt.
 */
export const DEV_MAX = 7

/** the devices this port has something behind */
export const DEV_MODELLED: ReadonlyMap<string, string> = new Map([
  // trackdisk is the one with a real back end: an ADF *is* the sector image
  // it serves, which amiga/adf.ts exposes and SLN's S Disk Read already uses
  ['trackdisk.device', 'the mounted ADF, through AdfVolume.image'],
  // serial.device is modelled by amiga/host.ts's SerialPortHandle, which
  // runtime/lserial.ts drives end to end
  ['serial.device', 'the host serial port, through amiga/host.ts'],
  // printer and parallel are modelled at the AMOS level by IOPorts
  ['printer.device', 'IOPorts, through runtime/ioports.ts'],
  ['parallel.device', 'IOPorts, through runtime/ioports.ts'],
])

/**
 * What a bare `Dev Open "serial.device"` gets before the program pokes its
 * own IOExtSer fields in. exec's OpenDevice does not set a line speed either;
 * these are the port's defaults for a handle that has not been configured.
 */
export const DEV_SERIAL_DEFAULTS: SerialLineParams = {
  baud: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  rtsCts: false,
  bufLen: 512,
}

/** one `Dev Open` channel: the slot, the request buffer, and what it opened */
export interface DevChannel {
  slot: DevSlot
  name: string
  unit: number
  flags: number
  /** where this channel's IORequest is mapped, which `=Dev Base(n)` answers */
  addr: number
  /** the structure length the caller asked for */
  len: number
  /** a real host port, for the one modelled device that has one */
  serial?: SerialPortHandle
}

export interface DevState {
  channels: Map<number, DevChannel>
  /** the IORequest buffers, one region for all eight channels */
  io: Uint8Array
}

/** every channel gets the same slice, which is what makes Dev Base arithmetic work */
export const DEV_IO_STRIDE = 256

export const newDevState = (): DevState => ({
  channels: new Map(),
  io: new Uint8Array(DEV_IO_STRIDE * (DEV_MAX + 1)),
})

/**
 * `Dev.GetA2` (+Lib.s:3049): the channel number is bounds-checked and nothing
 * else. An unopened channel is not an error HERE -- it becomes one in
 * `Dev.GetIO`, which is why `=Dev Base(n)` on a channel that was never opened
 * answers the slot's zeroed first long rather than raising.
 */
export function devSlotOf(st: DevState, n: number): DevChannel | null {
  if (n < 0 || n > DEV_MAX) throw new AmosError('function call error')
  return st.channels.get(n) ?? null
}
