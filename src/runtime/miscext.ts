/**
 * Misc 1.0 — Frank Otto's twelve odds and ends, slot 23.
 *
 * ## Evidence
 *
 * SOURCE tier and unusually complete: `Misc_Extension.asm` is the WHOLE
 * extension — its own token table, its own offset table and every routine —
 * written in DevPac 2 and placed in the public domain, alongside a `Manual.TXT`
 * that documents all twelve keywords. Line numbers below are that file.
 *
 * The slot is the extension's own, `ExtNb equ 23-1` (:26), which is also what
 * the manual tells the user to type into the interpreter config. NOTE: AMOSPro
 * Colours 1.0 bakes in the SAME number (`ExtNb equ 23-1` in its source too).
 * The two share no keyword names so nothing is contested here, but on a real
 * machine only one of them can be at 23 — which is exactly the collision the
 * registry warns about when a manual "recommends" a slot.
 *
 * ## The author's own assessment
 *
 * "Maybe you already noticed that this extension is very buggy. Some commands
 * force AMOS to crash. Maybe I'll create a new version, but why don't you?"
 * That is the manual's third paragraph, and it is accurate — see `Pal On`.
 *
 * ## The shape of the library
 *
 * Twelve keywords, all instructions, none taking an argument. The routine
 * equates run 3 to 14 and the offset table has fifteen entries, because `L1`,
 * `L2` and `L15` are bare labels with no code between them: three slots in the
 * table are empty and no token points at them.
 */
import { joyFire } from '../interp/gameport'
import type { Instr } from '../interp/builtins'
import type { Runtime } from './runtime'

/**
 * Nothing. The one thing this extension kept — the drive motor CIA-B's port B
 * leaves running — moved onto the Runtime when Delta 1.4 turned out to write
 * the same four bytes, and `Runtime.driveMotor` says so.
 */
export type MiscExtState = Record<string, never>

export const newMiscExtState = (): MiscExtState => ({})

export function makeMiscExtInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Display Off — routine 3 (:106), two instructions:
     *
     *     move.w  #$01a0,$dff096          * Monitor aus
     *     move.w  #0,$dff180
     *
     * DMACON with bit 15 CLEAR is a clear, and $1a0 is BPLEN ($100) + COPEN
     * ($80) + SPREN ($20) — bitplanes, copper and sprites off together. Then
     * COLOR00 to black, because with the bitplanes gone what shows is the
     * background colour and the copper is no longer there to keep writing it.
     *
     * `Jd Video Off` is the same two instructions from a different library, so
     * both set the one `rt.videoOff` — see its comment on the Runtime.
     */
    'display off'() {
      rt.videoOff = true
    },

    /**
     * Display On — routine 4 (:111): `move.w #$81a0,$dff096`, bit 15 SET, so
     * the same three bits come back.
     *
     * NOTE: it does NOT restore COLOR00, and that is not the bug it looks
     * like. Re-enabling COPEN puts the copper back in charge, and AMOS's list
     * carries the palette — so the black COLOR00 that `Display Off` wrote is
     * overwritten from the list on the very next frame, by the hardware rather
     * than by this routine. Nothing is left behind.
     */
    'display on'() {
      rt.videoOff = false
    },

    /**
     * Mouse Off — routine 9 (:141): `move.w #$20,$dff096`.
     *
     * Bit 15 clear again, and $20 alone is SPREN. The manual says "hides mouse
     * and sprite 0"; the register says all eight sprites, because it is the
     * DMA channel that goes and not a pointer. It also cannot be undone —
     * there is no `Mouse On` in the table, and the manual suggests the reader
     * write one: "Suggestion: If you want to expand this extension, why not
     * make a 'Mouse On' command?"
     */
    'mouse off'() {
      rt.spriteDma = false
    },

    /**
     * Dled On — routine 7 (:129) — and Dled Off, routine 8 (:135). The two
     * differ in one byte:
     *
     *     move.b  #127,$bfd100            ; %01111111
     *     move.b  #119,$bfd100            ; %01110111
     *     move.b  #0,$bfd100+512          ; On:  DDRB = all INPUTS
     *     move.b  #255,$bfd100+512        ; Off: DDRB = all OUTPUTS
     *
     * $bfd100 is CIA-B's port B, which drives the disk control lines, and
     * $bfd300 — the `+512` — is its direction register. On port B bit 7 is
     * /MTR and bit 3 is /SEL0, both active low, so 127 asserts the motor and
     * 119 asserts it while selecting drive 0. The LED follows the motor.
     *
     * DEFECT: the two keywords are the wrong way round, which is the whole
     * reason the manual is baffled by its own keyword.
     *
     * Writing 0 to the direction register makes the port INPUTS: it
     * stops driving the lines, they float high through their pull-ups, /MTR
     * goes inactive and the LED goes OUT. Writing 255 makes them outputs and
     * drives the 119 that is still sitting in the data register, so /MTR is
     * asserted and the LED comes ON. The two keywords are the wrong way round.
     *
     * The manual half-noticed: "Turns on drive led, don't ask me, where this
     * is for, but maybe when the drive led doesn't stop reading, use the next
     * command." Reproduced as read, which is why `Dled On` clears the flag.
     *
     * Delta 1.4's `Delta Drive Motor On`/`Off` are these same four writes,
     * constant for constant, and inherit the inversion with them. The flag
     * they share is `Runtime.driveMotor`; see delta.ts.
     *
     * NOTE: the direction-register reasoning is 6526 behaviour rather than
     * something the source states. The source gives the four writes; that a
     * released line reads inactive is the part supplied from the chip.
     */
    'dled on'() {
      rt.driveMotor = false
    },
    'dled off'() {
      rt.driveMotor = true
    },

    /**
     * Firewait — routine 12 (:171):
     *
     *     L12 btst    #07,$bfe001
     *         bne     L12
     *
     * CIA-A's port A bit 7 is the fire button, active low, so the loop spins
     * while the bit is SET — that is, while fire is not pressed — and falls
     * through the moment it goes down. The manual: "Nothing else than
     * `While Fire(1)=0 : Wend` but more effective, cause it's in assembler."
     *
     * A spin is a spin, but it cannot be a spin HERE — nothing else would run,
     * including whatever delivers the button. So it yields the frame and comes
     * back: `block(..., rewind)` re-runs the whole statement on resume, which
     * makes the test happen once a frame instead of once a bus cycle. A
     * program that never gets a press waits for ever, which is what it would
     * do on the machine.
     */
    'firewait'(it) {
      // port 1's bits, which is AMOS's `Fire(1)` and the joystick port
      if (joyFire(rt.input.joy)) return
      it.block({ type: 'wait', until: Math.floor(it.tick) + 1 }, true)
    },

    /**
     * Clear Ram — routine 11 (:159).
     *
     *     move.l  4,a6
     *     moveq   #0,d1
     *     move.l  #99999999,d0
     *     jsr     -198(a6)                ; AllocMem
     *     move.l  d0,a0
     *     beq.s   glbl                    ; it failed, which is the point
     *     jsr     -210(a6)                ; FreeMem
     *
     * The hundred-megabyte request is MEANT to fail. A failed AllocMem is what
     * makes exec expunge everything expungeable — unused libraries, devices
     * and fonts — so the manual's "Cleans up Memory by deleting all not-used
     * fonts, libs, etc." is a side effect of an allocation nobody wants to
     * succeed, not an operation the routine performs.
     *
     * DEVIATION: nothing here is expungeable. `amiga/exec.ts` models the pools
     * and a library list, and none of it holds a reclaimable allocation, so
     * this observably does nothing where on a machine it would free memory and
     * move `Chip Free`. Reproducing the failure faithfully IS doing nothing;
     * the difference is that a real Amiga would have had something to give
     * back.
     *
     * NOTE, unreachably: `FreeMem` would be called with d0 still holding the
     * POINTER, used as the size. `move.l d0,a0` leaves d0 alone. It can never
     * run, because the allocation cannot succeed.
     */
    'clear ram'() {
      // exec's expunge, over nothing that can be expunged
    },

    /**
     * Disk Wait — routine 13 (:176).
     *
     * Two waits, in order. First `move.b $bfe001,d0 / and.b #16,d0 / bne` —
     * spin until CIA-A port A bit 4 goes low, which is the disk-change line:
     * wait for a disk to be put in. Then a 500-iteration delay, and a loop of
     * `Disable / FindName` over ExecBase's TaskReady ($196) and TaskWait
     * ($1a4) lists looking for a task called "Validator", `Enable`, repeat
     * until it is gone: wait for the disk to finish validating.
     *
     * DEVIATION: this returns at once. There is no floppy to insert here — the
     * filesystem is `amiga/vfs.ts`, whose volumes are mounted rather than
     * inserted — and no validator task to wait on, since there is one task.
     * The alternative is to block for ever, which would hang every program
     * that uses it rather than reproducing anything.
     *
     * NOTE: the delay loop calls a subroutine that is `movem.l a0-a6/d0-d7,
     * -(sp)` immediately followed by the matching pop and an `rts` (:201). It
     * pushes sixteen registers and pops them straight back. It is a deliberate
     * burn and it does nothing else.
     */
    'disk wait'() {
      // no disk to insert, and no Validator to outlive
    },
  }
}

/** exported for the tests */
export const miscExtState = (rt: Runtime): MiscExtState => rt.miscExt
