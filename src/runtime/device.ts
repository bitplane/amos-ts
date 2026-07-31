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
 * Dev.SendIO (+Lib.s:3187) — asynchronous, leaving state 2. Serial Send and
 * Serial Out use this where the Parallel and Printer equivalents use DoIO,
 * so a serial write returns before it has gone out.
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
