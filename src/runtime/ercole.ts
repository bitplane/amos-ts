/**
 * Ercole 1.7 — Ercole Spiteri's game-port extras, at slot 10.
 *
 * Eleven keywords reaching hardware AMOS itself never exposes: the second and
 * third buttons on a console pad, the two extra joysticks on a parallel-port
 * four-player adaptor, analogue paddles on the POT lines — plus three that
 * have nothing to do with any of that (`Cli`, `Library Open`, `Library
 * Close`), which the readme groups as "System Commands".
 *
 * ## Evidence
 *
 * DISASSEMBLY tier. `AMOSPro_Ercole.Lib`, a 1,812-byte code hunk, every
 * routine of it read, plus `Ercole_ext.readme` beside it. The readme is the
 * author's own and describes ten of the eleven (it never mentions `Prop On`
 * and `Prop Off` as a pair count).
 *
 * ## Identity, off the binary
 *
 * `Ercole extension V 1.7` and `$VER: 1.7` sit at $70e and $725. Routine 0 is
 * 70 bytes that store NOTHING into a5 — the extension keeps no per-slot data
 * — and ends `moveq #$9,d0`, which is the slot LESS ONE, so the slot is 10.
 * The readme agrees and is unusually blunt about it: *"Place this extension as
 * extension 10 otherwise it won`t work"*.
 *
 * `ExtAdr` is settled by +Equ.s:1176-1183 rather than by calibration, which
 * this port had only inferred before: `VblRout: rs.l 8`, `AdTokens: rs.l 27`,
 * `AdTTokens: rs.l 27` puts `ExtAdr` at 32+108+108 = 248 = **$f8**, with
 * `rs.l 26*4` — sixteen bytes a slot, twenty-six slots. So an extension's
 * `move.l a3,$XXX(a5)` gives `(XXX - $f8)/16 + 1`, and routine 0's return
 * value is the same number zero-based.
 *
 * ## What routine 0 actually does
 *
 *     bset.b #$e, $dff034      OUTRY  right port pin 9
 *     bset.b #$f, $dff034      DATRY
 *     bset.b #$c, $dff034      OUTRX  right port pin 5
 *     bset.b #$d, $dff034      DATRX
 *
 * POTGO, arming the right port's two pot pins as outputs held high. That is
 * the pull-up a console pad's second and third buttons pull DOWN, which is why
 * `Xfire` and `Yfire` read a button as PRESSED when the bit is CLEAR.
 *
 * ## Prop On is a VBL hook
 *
 * `Prop On` (routine 1) is `lea $10a(pc),a0 / move.l a0,$4(a5)` and `Prop Off`
 * (routine 2) is `clr.l $4(a5)`. `$4(a5)` is `VblRout[1]` (+Equ.s:1177), one
 * of the eight per-frame routine slots AMOS calls at the vertical blank. The
 * hook itself is nine instructions:
 *
 *     move.w $dff012, d1 / move.w d1, (a2)        POT0DAT -> the buffer
 *     move.w $dff014, d1 / move.w d1, $4(a2)      POT1DAT
 *     move.w #$1, $dff034                         POTGO, START the next
 *
 * so `Paddle` reads a snapshot taken one frame earlier, not the live register,
 * and reads nothing at all until `Prop On` has run.
 *
 * ## Nothing is plugged in, and that is an answer
 *
 * Three of these read hardware this port has no source for, and all three
 * already have a settled answer here:
 *
 *   - the four-player adaptor on CIA-A PRB and CIA-B PRA. Sticks models the
 *     same registers and answers "no adaptor"; AMCAF's `Pjoy` family does the
 *     same. `Ext Joy` and `Ext Fire` agree with them.
 *   - paddles on POT0DAT/POT1DAT. Sticks' `Stick X`/`Stick Y` read the same
 *     two registers and answer 0 because no conversion ever starts.
 *   - the pot-pin buttons. Sticks' `Multi Joy` says only button A can report
 *     pressed, for want of the adaptor those pins want.
 *
 * An unattached line reads as nothing-pressed on the machine too, so these are
 * the same answer rather than a pretence. The ARGUMENT CHECKS are real, and
 * they are what a program actually notices: every one of the six raises the
 * library's own "This peripheral does not exist" out of range.
 *
 * ## The readme's own known bug, reproduced by not fixing it
 *
 * *"Due to a bug in Amos, paddles 0 and 1 and an analog joystick in port 0
 * will not work ... AMOS basic continually writes to the registers of port 0
 * to be able to read the mouse right and middle buttons"* — and the author
 * says outright that he left port 0 enabled anyway, hoping for a future AMOS
 * command. So `Paddle(0)` and `Paddle(1)` are accepted and answer the buffer,
 * which is what this does.
 *
 * ## Contested names
 *
 * `Xfire` is also AMCAF's, at slot 8, and AMCAF is ported — so this one is
 * registered `qualified` and resolves as `ext10:xfire`.
 *
 * `Library Open` and `Library Close` are also Range's, at slot 9. They were
 * plain here until Range became a ported product; both are qualified now, so
 * these resolve as `ext10:<name>` and Range's own will take `ext9:` when the
 * slice implementing them lands.
 *
 * NOTE: `Ercole_ext.readme` carries the author's home address and two phone
 * numbers. Deliberately not copied here or into any commit.
 */
import { AmosError, VI, VS, int, str } from '../interp/values'
import type { Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { openLibrary } from '../amiga/exec'
import { DOSTRUE, execute } from '../amiga/process'
import { JPF_BUTTON_BLUE, readJoyPort } from '../amiga/lowlevel'
import { CIAF_PRTRBUSY, CIAF_PRTRSEL } from '../amiga/cia'

/**
 * Routine 17's message table at $656 — four NUL-separated strings, indexed
 * 0-based by d0, delivered through `Rjmp L_ErrorExt` with `moveq #$9,d2`, the
 * slot zero-based, and `moveq #$0,d1`, which makes it trappable — see
 * ../runtime/extimpl.ts's `errors` for the reading.
 *
 * Message 3 is built in place and the trailing spaces are load-bearing:
 * "Cli error = " runs to $6bb and the 32-byte buffer `Cli` reads the output
 * file into starts at $6bc, so the message carries AmigaDOS's own complaint
 * appended to the extension's. Routine 3 fills the first four bytes of that
 * buffer with `$20202020` before every call.
 */
export const ERCOLE_ERRORS = [
  'Unable to execute this command',
  'Unable to open this library',
  'This peripheral does not exist',
  'Cli error = ',
]

/** routine 17 ($646) — raise one, by the index the caller puts in d0 */
const ercoleErr = (n: number, extra = ''): never => {
  throw new AmosError((ERCOLE_ERRORS[n] ?? `Ercole error ${n}`) + extra)
}

export interface ErcoleState {
  /** VblRout[1]: `Prop On` installs the POT sampler, `Prop Off` clears it */
  prop: boolean
  /** the buffer at $3c0 the hook fills — POT0DAT then POT1DAT, one frame old */
  pot0: number
  pot1: number
}

/**
 * Routine 0 ($e6): four POTGO bits and a return value, no allocation and no
 * per-slot data. Everything below is this port's own bookkeeping.
 */
export const newErcoleState = (): ErcoleState => ({ prop: false, pot0: 0, pot1: 0 })

/**
 * The hook at $10a, run from `Runtime.frame()` while `Prop On` is in force.
 *
 * NOTE: no paddle is attached, so POTGO's START bit begins a conversion that
 * never completes and both registers stay 0 — the same reason Sticks' `Stick
 * Scan` is observably nothing. The sampling is modelled anyway because the
 * ONE-FRAME DELAY is observable without any hardware: a program that reads
 * `Paddle` before the first vbl after `Prop On` gets the previous value.
 */
export function ercoleVbl(st: ErcoleState | undefined): void {
  if (!st?.prop) return
  st.pot0 = 0
  st.pot1 = 0
}

/** `cmp.l #$N,d0 / Rbcc routine 16` — the range check six keywords share */
function peripheral(n: number, limit: number): number {
  if ((n >>> 0) >= limit) ercoleErr(2)
  return n
}

export function makeErcoleInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Prop On — routine 1 ($12c). `move.l a0,$4(a5)`, installing the POT
     * sampler as VblRout[1]. The readme: *"Starts Paddles testing"*.
     */
    'prop on'() {
      rt.ercole.prop = true
    },

    /** Prop Off — routine 2 ($13e). `clr.l $4(a5)`, and nothing else. */
    'prop off'() {
      rt.ercole.prop = false
    },

    /**
     * Cli command$, input, output$ — routine 3 ($14c), 468 bytes and the only
     * large one here.
     *
     * `movem.l (a3)+,d2/a0` pops output$ first (arguments come off in reverse
     * source order), then the input handle, then command$. The sequence is
     *
     *     OpenLibrary("dos.library", 0)          -$228 on ExecBase
     *     Open(output$, MODE_NEWFILE)            -$1e, d2 = $3ee = 1006
     *     Execute(command$, input, output)       -$de
     *     Close(output)                          -$24
     *     Open(output$, MODE_OLDFILE) / Read 32  -$1e with d2 = $3ed, then -$2a
     *     DeleteFile(output$)                    -$48, only for the temp
     *     CloseLibrary                           -$19e on ExecBase
     *
     * An EMPTY output$ is not an error: `cmp.w #$0,d4 / bne` substitutes
     * `"ram:test"` and sets a flag at $2f2 to -1, which is what the DeleteFile
     * at the end tests. A caller-named file is left behind.
     *
     * Then the error detection, which is a hack worth stating plainly. The
     * first four bytes read back are compared two ways: against the first WORD
     * of command$, and against the long `"Bad "`. Either match is error 3,
     * because a shell that could not run the command writes its name or a
     * "Bad ..." complaint into the output. Only after those does `tst.l d0`
     * on Execute's own result raise error 0.
     *
     * NOTE: this port has no shell. `execute()` (../amiga/process.ts) answers
     * DOSFALSE with no process capability, so the output file is created and
     * stays empty, neither text check fires, and the routine lands on its own
     * error 0 — which is the branch it takes on an Amiga where the command
     * could not be run. Nothing is invented.
     */
    'cli'(it) {
      const command = it.evalStr()
      it.expect(',')
      const input = it.evalInt()
      it.expect(',')
      const output = it.evalStr()
      // `cmp.w #$0,d4 / bne` --- the empty name becomes a temp file that the
      // DeleteFile at the end removes; a named one is left where it is
      const temp = output === ''
      const path = temp ? 'ram:test' : output
      rt.vfs?.writeFile(path, new Uint8Array(0))
      const ran = execute(rt.host.process, {
        command,
        // Execute's d2 is the caller's handle and d3 the file just opened, so
        // neither is the console: a 0 handle is AmigaDOS's NIL
        io: { input: input === 0 ? null : 'console', output: null },
      })
      // `bsr $27c` --- reopen and Read 32 bytes over a buffer pre-filled with
      // four spaces, then copy the first four out to $302 for the two tests
      const back = rt.vfs?.readFile(path) ?? new Uint8Array(0)
      const head = String.fromCharCode(back[0] ?? 0x20, back[1] ?? 0x20, back[2] ?? 0x20, back[3] ?? 0x20)
      if (temp) rt.vfs?.deleteFile(path)
      if (head.slice(0, 2) === command.slice(0, 2) || head === 'Bad ') ercoleErr(3, head)
      if (ran !== DOSTRUE) ercoleErr(0)
    },

    /**
     * Library Close base — routine 5 ($346). `movea.l (a3)+,a1` then
     * CloseLibrary (-$19e on ExecBase), with no check of any kind: closing
     * zero, or a number that was never a base, is the caller's problem on the
     * machine and cannot be told apart here.
     */
    'library close'(it) {
      it.evalInt()
    },
  }
}

export function makeErcoleFunctions(rt: Runtime): Record<string, Func> {
  const st = (): ErcoleState => rt.ercole

  return {
    /**
     * =Library Open(name$) — routine 4 ($320). `moveq #$0,d0` then
     * OpenLibrary, so ANY version will do, and a zero result is error 1.
     *
     * The readme's use for it: *"Functions of the library can be called by
     * using the Call command eg Call A-30"*. `Call` is n/a here under the rule
     * that 68k machine code is never executed, so the base is only ever a
     * number a program can test — which is exactly what `../amiga/exec.ts`
     * hands back, a synthetic base for the libraries this port models and 0
     * for the rest.
     */
    'library open': (_, a): Value => {
      const base = openLibrary(str(a[0] ?? VS('')), 0)
      if (base === 0) ercoleErr(1)
      return VI(base)
    },

    /**
     * =Paddle(n) — routine 6 ($35c). n is 0..3 and `cmp.l #$4,d0 / Rbcc`
     * sends anything else to error 2, UNSIGNED, so a negative fails too.
     *
     * The pairing is not the obvious one: n<2 reads the POT0DAT snapshot and
     * n>=2 the POT1DAT one, and within each pair the ODD number takes the LOW
     * byte (`andi.w #$ff`) while the even one shifts down from the high
     * (`lsr.w #$8`). One POT register holds two axes, X low and Y high, so
     * paddle 0 is port 0's Y line, 1 its X, 2 port 1's Y and 3 its X.
     *
     * The readme's range is *"(1-255)"*, which is the pot count and not
     * something the routine enforces; it returns whatever the byte holds.
     */
    'paddle': (_, a): Value => {
      const n = peripheral(int(a[0]!), 4)
      const w = n < 2 ? st().pot0 : st().pot1
      return VI(n === 1 || n === 3 ? w & 0xff : (w >> 8) & 0xff)
    },

    /**
     * =Pad Fire(n) — routine 7 ($3c8), n 0..3 or error 2.
     *
     * Four separate arms rather than a computation, and the bits are the
     * joystick counters rather than a fire line: JOY0DAT ($dff00a) bit 9 for
     * paddle 0 and bit 1 for paddle 1, JOY1DAT ($dff00c) bit 9 for paddle 2
     * and bit 1 for paddle 3. A paddle's button is wired to a direction line,
     * which is why. -1 when the bit is SET.
     *
     * NOTE: no paddle, so no counter movement and no button.
     */
    'pad fire': (_, a): Value => {
      peripheral(int(a[0]!), 4)
      return VI(0)
    },

    /**
     * =Ext Joy(n) — routine 8 ($482), n 0..1 or error 2.
     *
     *     move.b $bfe101, d3 / not.b d3
     *     n = 0: andi.b #$f      n = 1: lsr.b #$4
     *
     * CIA-A PRB, the parallel port's eight data lines, inverted and split into
     * two nibbles — the four-player adaptor, one joystick per nibble. The
     * readme calls it *"the parallel port 4 player adapter lead"*, which the
     * register agrees with; Sticks' manual calls the same hardware the serial
     * port and is wrong.
     *
     * NOTE: no adaptor. The lines idle high, `not.b` makes that zero, and zero
     * is no direction — the same answer Sticks and AMCAF's `Pjoy` give, and
     * now the same REGISTER, so all three change together if one is attached.
     */
    'ext joy': (_, a): Value => {
      const n = peripheral(int(a[0]!), 2)
      const b = ~rt.machine.cia.prb() & 0xff
      return VI(n === 0 ? b & 0xf : b >> 4)
    },

    /**
     * =Ext Fire(n) — routine 9 ($4b8), n 0..1 or error 2.
     *
     * CIA-B PRA ($bfd000), bit 2 for joystick 3 and bit 0 for joystick 4 —
     * the parallel port's BUSY and POUT handshake lines. -1 when the bit is
     * CLEAR, which is a button pulling a pulled-up line down.
     *
     * NOTE: no adaptor, so both lines idle high and both answer 0.
     */
    'ext fire': (_, a): Value => {
      const n = peripheral(int(a[0]!), 2)
      const v = rt.machine.ciab.pra()
      return VI((v & (n === 0 ? CIAF_PRTRSEL : CIAF_PRTRBUSY)) === 0 ? -1 : 0)
    },

    /**
     * =Xfire(n) — routine 10 ($516), n 0..1 or error 2. The SECOND button.
     *
     *     n = 1: btst #$e, $dff016      DATRY, right port pin 9
     *     n = 0: btst #$a, $dff016      DATLY, left port pin 9
     *
     * POTINP, and -1 when the bit is CLEAR. The re-arm is the part worth
     * keeping: on the pressed path only, it `bset`s the matching OUT and DAT
     * bits in POTGO ($e/$f for the right port, $a/$b for the left) before
     * returning, restoring the pull-up the button just discharged. Routine 0
     * does the same four bsets for the right port at startup.
     *
     * Pin 9 is what `lowlevel.library` calls BLUE — AROS's joystick path reads
     * the same line, `((potinp >> (port ? 14 : 10)) & 1) ? 0 : JPF_BUTTON_BLUE`
     * — so this is that button and nothing else. It used to answer 0 always,
     * because nothing could say a second button was down; a controller can.
     *
     * `n` is Ercole's own port numbering and happens to match the hardware's:
     * 0 is the left (mouse) port, 1 the right (joystick) port.
     */
    'xfire': (_, a): Value => {
      const n = peripheral(int(a[0]!), 2)
      return VI((readJoyPort(rt.input.ports, n) & JPF_BUTTON_BLUE) !== 0 ? -1 : 0)
    },

    /**
     * =Yfire(n) — routine 11 ($59c), the THIRD button, and routine 10 again
     * with the X pot pins: bit $c (DATRX, right port pin 5) for n = 1 and bit
     * $8 (DATLX, left port pin 5) for n = 0, re-arming $c/$d and $8/$9.
     */
    'yfire': (_, a): Value => {
      peripheral(int(a[0]!), 2)
      return VI(0)
    },
  }
}
