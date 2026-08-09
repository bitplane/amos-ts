/**
 * ARexx public message ports.
 *
 * ## What this is
 *
 * An ARexx program talks to an application by sending a `RexxMsg` to a public
 * message port the application registered by name. The application takes the
 * message, reads its argstrings, does the work and replies with a return code
 * and — if the sender asked for one — a result string. That handshake is all
 * AMOS's `Arexx *` keywords and LDos's `Lrexx *` keywords do, and it is
 * exec's message ports underneath, so it lives here rather than in
 * `src/runtime`.
 *
 * ## What is NOT here, and why it is not a gap
 *
 * There is no ARexx *language*. `rexxmast` is a separate resident program on
 * the machine, and an Amiga without it running has exactly the behaviour this
 * port has: `FindPort("REXX")` answers nothing, so a command sent to the REXX
 * port cannot be delivered and every keyword that would run a script reports
 * the failure it reports there. The absent arm is the machine's own, not a
 * stub — the same reasoning `src/amiga/exec.ts` applies to a library it does
 * not model.
 *
 * A host CAN supply the other side. `post` is public so an embedder that
 * wants to drive an AMOS program from outside registers nothing and simply
 * sends to the port the program opened, and `open` is public so a host can
 * register `REXX` itself and answer commands.
 */

/** `rm_Action` bit: the sender wants a result string back, not just a code */
export const RXFF_RESULT = 1 << 17

/** one message on a port, and the reply slot it carries back */
export interface RexxMessage {
  /** `rm_Action` — only RXFF_RESULT is read by anything here */
  action: number
  /**
   * `rm_Args`, up to sixteen argstrings. Argument 0 is the command line for a
   * command message, which is what both AMOS and LDos read first.
   */
  args: string[]
  /** `rm_Result1` — the return code, 0 for success */
  result1: number
  /** `rm_Result2` — the result string, only meaningful with RXFF_RESULT */
  result2: string
  /** whether the application has replied yet */
  replied: boolean
}

export function rexxMessage(command: string, wantsResult = false): RexxMessage {
  return {
    action: wantsResult ? RXFF_RESULT : 0,
    args: [command],
    result1: 0,
    result2: '',
    replied: false,
  }
}

/**
 * The public port list.
 *
 * Names are case-SENSITIVE, as exec's `FindPort` is: ARexx convention is to
 * upper-case a port name, and a program that opens "myport" is not found by a
 * script addressing "MYPORT".
 */
export class RexxPorts {
  private readonly ports = new Map<string, RexxMessage[]>()

  /** `FindPort` — whether a port of this name is registered */
  exists(name: string): boolean {
    return this.ports.has(name)
  }

  /**
   * `AddPort` — register a name, or answer false if it is already taken.
   * exec would happily add a second port of the same name and leave FindPort
   * returning the first; refusing is the behaviour every caller here wants
   * and the one both libraries' error arms are written for.
   */
  open(name: string): boolean {
    if (this.ports.has(name)) return false
    this.ports.set(name, [])
    return true
  }

  /** `RemPort` — and anything still queued goes with it, unanswered */
  close(name: string): void {
    this.ports.delete(name)
  }

  /**
   * `PutMsg` — deliver to a port, or answer false when nothing is listening.
   * This is the seam a host drives an AMOS program through.
   */
  post(name: string, msg: RexxMessage): boolean {
    const q = this.ports.get(name)
    if (!q) return false
    q.push(msg)
    return true
  }

  /** `GetMsg` — take the next message, or null when the port is quiet */
  take(name: string): RexxMessage | null {
    return this.ports.get(name)?.shift() ?? null
  }

  /** how many are waiting, for a host that wants to know */
  pending(name: string): number {
    return this.ports.get(name)?.length ?? 0
  }

  /** every registered name, for a host listing what a program has opened */
  names(): string[] {
    return [...this.ports.keys()]
  }
}
