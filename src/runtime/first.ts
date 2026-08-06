/**
 * First 0.1 — Pedro Gil's four-keyword extension, at slot 22.
 *
 * The whole library is 248 bytes and the readme is honest about why: *"this
 * extension only have 4 new commands, but this is my first extension for Amos
 * pro. ;^)"*. Three of the four are one CIA-A PRA access each.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier, and the disassembly is short enough to quote whole. A
 * 212-byte code hunk holding seven routines, of which routine 0 is two
 * instructions and three of the keywords are three. Plus `FirstExt.readme`.
 *
 * ## Identity, off the binary
 *
 * `AMOSPro First Extension by Pedro Gil v0.1` at $9a and `$VER: 0.1` at $c4
 * (the file has `0.1` twice running, the `$VER` string and the version it
 * quotes). Routine 0 is
 *
 *     moveq #$15, d0
 *     rts
 *
 * — no data block, no hooks, nothing stored into a5 at all — and $15 is 21,
 * the slot less one, so slot 22. The readme says the same: *"put on slot 22
 * this name: AmosPro_First.lib"*.
 *
 * ## CIA-A PRA, three times
 *
 * $BFE001 is CIA-A's port A: bit 1 drives the power LED and the audio
 * low-pass filter together, bit 6 is the left mouse button and bit 7 is
 * port 1's fire, both active LOW.
 *
 *     Change Led   bchg.b #$1, $bfe001
 *     Wait Mouse   btst.b #$6, $bfe001 / beq (done) / bra (again)
 *     Wait Joy     btst.b #$7, $bfe001 / beq (done) / bra (again)
 *
 * The two waiters spin until their bit reads CLEAR, which is the button
 * pressed. Note what that means and what the readme does not say: they are
 * bare busy loops with no vertical-blank wait, no multitasking break and no
 * escape — a program that calls `Wait Mouse` cannot be stopped by Control-C,
 * because the loop never reaches AMOS's interrupt handler.
 */
import type { Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { JOY_FIRE } from '../interp/gameport'

export function makeFirstInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Change Led — routine 3 ($6c), `bchg.b #$1,$bfe001`.
     *
     * The readme: *"Swap Led status"*. One bit does two things on this
     * machine — the power LED's brightness and Paula's audio low-pass filter
     * — and `bchg` toggles whatever it was, so this is `Led On`/`Led Off`
     * without needing to know which it currently is.
     *
     * The core Music extension's `Led On` and `Led Off` drive the same bit
     * (InLedOn/Of +Music.s:3917), so this reads the filter state back through
     * the same place they set it.
     */
    'change led'() {
      rt.ledFilter = !rt.ledFilter
      rt.audio.setFilter(rt.ledFilter)
    },

    /**
     * Wait Mouse — routine 4 ($76). Spin until CIA-A PRA bit 6 reads clear,
     * which is the LEFT mouse button held down.
     *
     * DEVIATION: the original is a bare `btst / beq / bra` with nothing in it
     * — no vbl wait, no break check — so on the machine it burns the CPU and
     * cannot be interrupted. This blocks the interpreter the way every other
     * waiting keyword in this port does, which is what makes the program
     * stoppable and the display keep updating. Reproducing the spin would
     * hang the browser and prove nothing.
     */
    'wait mouse'(it) {
      if ((rt.input.mouseK & 1) === 0) it.block({ type: 'wait', until: it.tick + 1 }, true)
    },

    /**
     * Wait Joy — routine 5 ($84), the same loop on bit 7: port 1's fire
     * button. The readme: *"Wait to push Joystick button"*.
     */
    'wait joy'(it) {
      if ((rt.input.joy & JOY_FIRE) === 0) it.block({ type: 'wait', until: it.tick + 1 }, true)
    },

    /**
     * Clear Banks — routine 6 ($92), which is one AMOS call and an rts:
     *
     *     Rjsr  routine 1107
     *     rts
     *
     * NOTE: that number cannot be named from the evidence held here.
     * 1107 is `L_Bnk_EffAll` — erase every bank — and it is the call that
     * settled the whole numbering. It is past the end of `+lib_Labels.s`,
     * which stops at `L_End_Externes: set 1040`, because that file is AMOS
     * Pro 2.0's list and an extension is numbered against the 1.34 / Pro 1.0
     * developer kit. AMOS Pro 2.0 rewrites 1107 to 803 as it relocates the
     * library (`Ext_Convert`, +B.s:2698), and 803 - 500 is 303, which
     * `+lib_Labels.s` calls `L_Bnk.EffAll`. Same routine, three numbers.
     *
     * The readme says the same thing from the outside — *"Clear Banks ->
     * Erase all banks from memory"* — so the name, the conversion table and
     * the author's own description agree. This calls the core's `Erase All`
     * rather than keeping a second copy.
     */
    'clear banks'() {
      // InEraseAll +Lib.s, the same three lines the core `Erase All` runs
      rt.memBanks.clear()
      rt.spriteBank = null
      rt.iconBank = null
    },
  }
}
