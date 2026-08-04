/**
 * Starting something else: `Execute()`, and `LoadSeg` + `CreateProc`.
 *
 * Six keywords across the core and four extensions want to run a program that
 * is not this one, and they are all one of two dos.library calls. This models
 * both, and the *ability* to carry them out is a host capability — the same
 * division `machine.ts` draws between the state and the policy, and the one
 * `host.ts` already draws for files, audio, the printer and serial ports.
 *
 * ## Why it can be built before anything can run
 *
 * Because the failure path is the interesting one and it is fully specified.
 * Every caller checks whether the launch worked and does something particular
 * when it did not, and with no capability behind this, that is the branch they
 * take — not a stub, but the routine's own answer to "the process did not
 * start". A program that guards its `Launch` and carries on gets the behaviour
 * it would get on an Amiga that had run out of memory.
 *
 * ## The two calls
 *
 * **`Execute(command, input, output)`** (dos.library -222) hands a command
 * line to the shell. Two of the four callers differ only in the handles:
 *
 *     craft 1.0 `Cli Execute` (r165, $2dda)
 *       jsr -$3c(a6) / jsr -$36(a6)      Output(), Input()
 *       Rbsr routine 57 / jsr -$de(a6)   Execute -- inherits the console
 *
 *     easylife 1.44 `Elexec` (r150, $1e4c)
 *       moveq #$0,d2 / moveq #$0,d3      NIL in and out
 *       jsr -$de(a6)                     Execute -- runs detached
 *
 * and the AMOS core's own `Exec` (+Lib.s:3392) and LDos's `Lrun` are the same
 * call again. None of those four is implemented; they are recorded here so the
 * ports land on this rather than on four private ideas of what Execute means.
 *
 * **`LoadSeg` + `CreateProc`** (-150 and -138) starts a binary rather than a
 * command line. AMCAF's `Launch` (r221 pushing the default stack, then r222 at
 * $513a) is the worked example:
 *
 *     move.l (a3)+,d4              the stack size, $1000 by default
 *     movea.l (a3)+,a0 / Rbsr 363  the file name
 *     jsr -$96(a6)                 LoadSeg  -> d3
 *     Rbeq routine 391             failed: AmigaDOS error, AMOS error 81
 *     move.l d6,d1 / moveq #$0,d2
 *     jsr -$8a(a6)                 CreateProc(name, 0, segList, stackSize)
 *     tst.l d5 / beq / rts         started: return
 *     jsr -$9c(a6)                 UnLoadSeg
 *     moveq #$b,d0 / Rbra 397      message 11, "Couldn't launch process"
 *
 * The order matters and is reproduced: LoadSeg first, so a file that is not an
 * AmigaDOS binary fails differently from one that is but could not be started.
 * `hunk.ts` already reads that format, so the first half is real here — the
 * segment genuinely does or does not load — and only the second half is
 * capability-bound. LDos's `Lexecute` ("starts a separate executable") is
 * almost certainly this pair as well; that has not been read.
 *
 * ## What is NOT this
 *
 * `Execall`, `Doscall`, `Gfxcall`, `Intcall` and `Lib Call` are exec-library
 * function calls by LVO — 68k entry points, not processes, and n/a under the
 * rule that machine code is never executed here. The name is the only thing
 * they share with this file. `Lrexx Execute` needs an ARexx host, a message
 * port and a resident rexxmast, which is a language runtime rather than a host
 * capability. And `Amos Task`, `Command Name$`, `Amos Cli`, `Write Cli`,
 * `Cli Here` and Delta's task pair interrogate or manage the process that is
 * ALREADY running, which is a different seam again.
 */
import { loadHunks } from './hunk'

/** dos.library's DOSTRUE/DOSFALSE, which Execute returns */
export const DOSTRUE = -1
export const DOSFALSE = 0

/**
 * Where a launched command's console goes.
 *
 * `null` is AmigaDOS's NIL handle: Execute with a zero output runs the command
 * detached with nowhere to print, which is exactly what EasyLife's Elexec asks
 * for and what Craft's Cli Execute does not.
 */
export interface ExecuteIO {
  input: 'console' | null
  output: 'console' | null
}

/** what `Execute(command, input, output)` was asked to do */
export interface ExecuteRequest {
  command: string
  io: ExecuteIO
}

/** what `CreateProc(name, pri, segList, stackSize)` was asked to do */
export interface LaunchRequest {
  /** the file that was LoadSeg'd, as the program named it */
  name: string
  priority: number
  stackSize: number
}

/**
 * A host that can actually start things.
 *
 * Optional at two levels for the reason `SerialHost` is: a host may have no
 * way to run anything at all, and one that does may refuse a particular
 * command. Returning false is not an error here — it is the answer the real
 * call gives when the command could not be run, which every caller already
 * handles.
 */
export interface ProcessHost {
  /** run a shell command line; false is DOSFALSE */
  execute?(req: ExecuteRequest): boolean
  /** start a loaded binary as a process; false means CreateProc returned NULL */
  launch?(req: LaunchRequest): boolean
}

/**
 * `Execute()`. Without a host that can run something, DOSFALSE — which is what
 * dos.library answers when the command does not exist, so a program testing
 * the result sees a shape it was written to handle.
 */
export function execute(host: ProcessHost | undefined, req: ExecuteRequest): number {
  return host?.execute?.(req) ? DOSTRUE : DOSFALSE
}

/** why a launch did not happen, which decides which error the caller raises */
export type LaunchFailure =
  /** LoadSeg returned 0: no such file, or not an AmigaDOS binary */
  | 'noseg'
  /** the segment loaded and CreateProc returned NULL */
  | 'noproc'

/**
 * `LoadSeg` then `CreateProc`, in that order and reporting which one failed.
 *
 * The order is the whole point. AMCAF raises an AmigaDOS error for a segment
 * that will not load and its own requester for a process that will not start,
 * and telling those apart needs the load actually attempted — so it is, by
 * `hunk.ts`, against the bytes the caller read. A file that is not a binary
 * fails here exactly as it would on the machine.
 *
 * `null` means the process started.
 */
export function launch(
  host: ProcessHost | undefined,
  bytes: Uint8Array | null,
  req: LaunchRequest,
): LaunchFailure | null {
  if (bytes === null) return 'noseg'
  try {
    // base 0: nothing runs this image, and a load address would only invite
    // someone to believe it meant something
    loadHunks(bytes, 0)
  } catch {
    return 'noseg'
  }
  return host?.launch?.(req) ? null : 'noproc'
}
