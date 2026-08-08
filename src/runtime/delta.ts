/**
 * Delta 1.4 — Łukasz "DELTA" Żelezny, twenty-six keywords at slot 15.
 *
 * *"This is small extension for AMOSPro. This is public domain file. If you
 * like it then send me post-card."* Fourteen instructions that poke the
 * hardware and twelve functions that return constants, and the interesting
 * thing about it is how much of the first half is somebody else's.
 *
 * ## Evidence
 *
 * BINARY tier with an AmigaGuide that documents every keyword — briefly. The
 * library is a 1,936-byte code hunk with 30 jump-table entries, 26 of them
 * keywords; `extdis delta-1.4` disassembles it, and its 38 `HUNK_RELOC32`
 * offsets are what settle the string functions below. The slot is the guide's
 * — *"Enter 'AMOSPro_Delta.Lib' into slot 15"* — and routine 0 agrees: it is
 * `moveq #$e,d0 / rts`, the extension number 15-1 and nothing else. There is
 * no data zone and nothing is written to `$XX(a5)`.
 *
 * ## Five keywords are Misc 1.0's, instruction for instruction
 *
 * This port already had Misc 1.0 (slot 20, Chris Hodges' `Misc_Extension.asm`
 * — SOURCE tier), and five of Delta's routines are its routines byte for byte:
 *
 *     Delta Drive Motor On/Off   =  Dled On / Dled Off      (:129, :135)
 *     Delta Mouse Off            =  Mouse Off               (:141)
 *     Delta Change Disk          =  Disk Wait               (:176)
 *     Delta Wait Fire            =  Firewait                (:171)
 *
 * Same constants, same order, same 500-iteration delay calling the same
 * push-sixteen-registers-and-pop-them-again subroutine, same `FindName` over
 * ExecBase's TaskReady and TaskWait lists for a task called "Validator". Misc
 * ships its source and Delta does not, so the two agree with a witness. Delta
 * even inherits Misc's inversion — `Delta Drive Motor On` makes CIA-B's port B
 * all INPUTS, which stops driving the motor line — see `delta drive motor on`.
 *
 * `Delta Reset` is Misc's `Reset` as well, and ../amiga/machine.ts already
 * carries the reading.
 *
 * ## Every string function writes to address zero
 *
 * The nine `$` functions share a shape, and it is wrong in a way that works:
 *
 *     movea.w (buffer).L,a0        ; twice, and both are dead
 *     movea.w (buffer).L,a1
 *     move.w  #len,(a1)+ / move.b #char,(a1)+ ...
 *     moveq   #2,d2
 *     movea.w (buffer).L,a0 / move.l a0,d3
 *
 * `movea.w` on an absolute long address reads the WORD AT the buffer and
 * sign-extends it into the register. It does not load the buffer's address —
 * that would be `lea`. The buffer is twenty bytes of zeros in the code hunk
 * (the relocation table confirms the operands are relocated, so they really do
 * point at it), so `a1` is 0, the string is built at ADDRESS ZERO, and `a0` is
 * 0 again at the end — which is the address the string was built at. The
 * caller is handed a pointer to address 0 and finds exactly the string it
 * asked for.
 *
 * DEFECT: so it works, and it works by writing over the 68000's exception
 * vectors. `Delta About$` is twenty-four bytes, which is vectors 0 to 5 — the
 * initial stack pointer and PC, bus error, address error, illegal instruction
 * and divide-by-zero. Every one of the shorter functions writes at least the
 * first eight. NOT REPRODUCED, because there is no vector table here to
 * corrupt: the strings come back, which is what the machine does too, and the
 * cost is one this port cannot charge.
 *
 * ## Two keywords that do not do what they say
 *
 * - **`Delta Inter On` does nothing at all.** INTENA is a set/clear register:
 *   bit 15 says which. `move.w #$0,$dff09a` has bit 15 clear, so it CLEARS the
 *   bits set in `$0000` — none of them. `Delta Inter Off` is `#$4000`, which
 *   really does clear INTEN, so a program can turn interrupts off and has no
 *   way back. The guide's *"CAUTION!"* is on the wrong one.
 * - **`Delta Decrunch XX` sets colour ONE.** `move.l d0,$dff180` is a LONGWORD
 *   write to COLOR00, so the high word goes to COLOR00 and the low word to
 *   COLOR01 at $dff182. The argument is a word, so COLOR00 becomes black and
 *   COLOR01 becomes the requested colour — the opposite of the guide's *"This
 *   efect using colour 0"*.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { AmosError, VF, VI, VS } from '../interp/values'
import { joyFire } from '../interp/gameport'

/**
 * The three phases of `Delta Wait Double Mouse`, which is the only keyword
 * here that has to remember anything across a frame.
 *
 * 0 waiting for the first press, 1 burning the delay, 2 waiting for the
 * second. See the keyword for why it is a field rather than a local.
 */
export interface DeltaState {
  dblPhase: 0 | 1 | 2
  /** the tick the delay ends on, while `dblPhase` is 1 */
  dblUntil: number
}

export const newDeltaState = (): DeltaState => ({ dblPhase: 0, dblUntil: 0 })

/**
 * Motorola Fast Floating Point, which is what AMOS's `#` variables are and
 * what `Delta Pi#` and `Delta E#` hand back as raw longwords.
 *
 * `MMMMMMMM MMMMMMMM MMMMMMMM SEEEEEEE`: a 24-bit mantissa in [0.5, 1), a
 * sign bit and a 7-bit exponent in excess-64. Spelled out rather than reduced
 * to two decimal literals because the POINT of both keywords is which
 * constants the author shipped, and FFP's 24 bits are why they are only
 * accurate to seven digits.
 */
export function ffp(bits: number): number {
  const mantissa = (bits >>> 8) / 0x100_0000
  const exp = (bits & 0x7f) - 64
  const sign = bits & 0x80 ? -1 : 1
  return sign * mantissa * 2 ** exp
}

/** `move.l #$c90fdb42,d3` — 3.1415925 rather than 3.14159265, and FFP is why */
const DELTA_PI = ffp(0xc90fdb42)
/** `move.l #$adf85442,d3` — 2.7182813 */
const DELTA_E = ffp(0xadf85442)

/**
 * The nine strings, byte for byte, in jump-table order.
 *
 * Every one is `move.w #len` followed by that many `move.b #char`, so there is
 * no encoding question: these are the bytes. Two carry a unit suffix that
 * `Val` will stop at, which the guide's own `Radian#=Val(Delta Radian$)` does
 * not mention — see `delta radian$`.
 */
const STRINGS: Record<string, string> = {
  'delta about$': 'Delta of Opium^Hv^Fnz!',
  'delta yard$': '0.9144',
  'delta feet$': '0.3048',
  'delta inch$': '0.0254',
  'delta english mile$': '1852',
  'delta american mile$': '1853.25',
  'delta radian$': '57.29578°',
  'delta degree$': '0.01745rd',
  'delta euler$': '0.57722',
}

export function makeDeltaInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Routine 7 — `Delta Pal`: `move.b #$20,$dff1dc`.
     *
     * Personnal's `Set Pal` writes the same register as a WORD, `move.w
     * #$0020`, and $0020 is the PAL bit. This writes a BYTE to the EVEN
     * address, which is the register's high half — so the PAL bit only arrives
     * because the 68000 duplicates a byte across both halves of the data bus
     * during a byte write, and BEAMCON0 latches $2020. Bit 13 comes with it:
     * VARBEAMEN, the variable beam counter, which nothing else here
     * configures.
     *
     * NOTE: the duplication is 68000 bus behaviour rather than something the
     * code states, and it is the whole of why this keyword works. Without it
     * `Delta Pal` would set VARBEAMEN alone and never touch PAL.
     */
    'delta pal'() {
      rt.beamcon0 = 0x2020
    },

    /** Routine 8 — `Delta Ntsc`: `move.b #$0,$dff1dc`, so BEAMCON0 is cleared outright */
    'delta ntsc'() {
      rt.beamcon0 = 0x0000
    },

    /**
     * Routine 4 — `Delta No Synchro XX`: `move.b d0,$dff1dc`, the same byte
     * write with the program's own value.
     *
     * The guide is honest about what it is: *"This is small visual efect.
     * After this command you must write Delta Pal or Delta Ntsc for back to
     * normal screen."* Setting BEAMCON0's high half turns on the variable
     * sync generators (VARVSYEN, VARHSYEN, VARBEAMEN) with none of the
     * comparators programmed, and the display loses lock.
     *
     * DEVIATION: nothing reads `beamcon0` in this port — the composite window
     * is a PAL monitor whatever the register says — so the effect is recorded
     * and not shown. Same as Personnal's two, and the register is the whole of
     * all three keywords.
     */
    'delta no synchro'(it) {
      const v = it.evalInt() & 0xff
      rt.beamcon0 = (v << 8) | v
    },

    /**
     * Routine 3 — `Delta Decrunch XX`.
     *
     *     tst.w d0 / beq   -> error 23    Illegal function call
     *     cmpi.w #$1000,d0 / bge -> error 29   Overflow
     *     move.l d0,$dff180.l
     *
     * DEFECT: `move.l` to COLOR00 writes TWO registers. The high word lands in
     * COLOR00 and the low word in COLOR01, and the argument is a word — so
     * colour 0 goes black and colour 1 becomes the value, which is the reverse
     * of the guide's *"This efect using colour 0"*.
     *
     * DEFECT: both checks are WORD tests on a longword argument. `cmpi.w
     * #$1000` is SIGNED, so a negative number passes both — `Delta Decrunch
     * -1` writes $ffffffff and lights both registers white — and 65536, whose
     * low word is zero, is refused as if it were 0.
     *
     * NOTE: the guide calls this "a small efect" and it is a single write with
     * no loop in it. On the machine the copper puts the palette back on the
     * next frame, which is what the guide is gesturing at with *"your screen
     * must be in colour or 'Colour Back' must be 0"*. Here the palette IS the
     * screen's, so the change stays until something else moves it.
     */
    'delta decrunch'(it) {
      const v = it.evalInt()
      if ((v & 0xffff) === 0) throw new AmosError('Illegal function call', 23)
      if (((v & 0xffff) << 16) >> 16 >= 0x1000) throw new AmosError('Overflow', 29)
      const pal = rt.screen.palette
      pal[0] = (v >>> 16) & 0xfff
      pal[1] = v & 0xfff
    },

    /**
     * Routine 6 — `Delta Inter On`: `move.w #$0,$dff09a`.
     *
     * DEFECT: INTENA's bit 15 chooses set or clear, and this has it clear, so
     * the write clears the bits present in $0000 — none. The keyword does
     * nothing whatever. What it needed was $c000.
     */
    'delta inter on'() {
      // `move.w #$0,$dff09a` clears no bits; there is nothing to model
    },

    /**
     * Routine 11 — `Delta Inter Off`: `move.w #$4000,$dff09a`, bit 15 clear
     * and bit 14 set, so INTEN really does go down and every interrupt with it.
     *
     * DEVIATION: not reproduced. Interrupts off means the vertical blank stops
     * and AMOS stops with it, and since `Delta Inter On` cannot put them back
     * (above) a program that ran this would never do anything again.
     * Reproducing it faithfully means hanging, which reproduces nothing a
     * reader could look at.
     */
    'delta inter off'() {
      // INTEN down, and Delta Inter On cannot bring it back up
    },

    /**
     * Routine 9 — `Delta Mouse Off`: `move.w #$20,$dff096`, SPREN cleared.
     *
     * Misc 1.0's `Mouse Off` to the instruction. It is the sprite DMA channel
     * that goes, so all eight sprites go with the pointer, and there is no
     * keyword to put it back — the guide says to press *"amiga+a"*, which is
     * AMOS's own screen swap putting the display together again.
     *
     * NOTE: two bytes of dead code follow the `rts`, `move.b d3,$3000(a5)`,
     * which nothing reaches.
     */
    'delta mouse off'() {
      rt.spriteDma = false
    },

    /**
     * Routine 15 — `Delta Drive Motor On`, and routine 12 `Delta Drive Motor
     * Off`. The two differ in one byte, and they are Misc 1.0's `Dled On` and
     * `Dled Off` exactly:
     *
     *     move.b #$7f,$bfd100      ; /MTR low, no drive selected
     *     move.b #$77,$bfd100      ; /MTR low and /SEL0 low: latch it on
     *     move.b #$00,$bfd300      ; On:  DDRB = all INPUTS
     *     move.b #$ff,$bfd300      ; Off: DDRB = all OUTPUTS
     *
     * DEFECT: they are the wrong way round, and the direction register is why.
     * Writing 0 to DDRB makes port B inputs, so the CIA stops driving the
     * lines, they float high through their pull-ups and /MTR goes inactive —
     * the motor stops. Writing $ff makes them outputs and drives the $77 still
     * sitting in the data register, so /MTR stays asserted and the motor runs.
     * See miscext.ts, where the same defect arrives with its author's source
     * to prove it and its own manual's bafflement to go with it.
     */
    'delta drive motor on'() {
      rt.driveMotor = false
    },
    'delta drive motor off'() {
      rt.driveMotor = true
    },

    /**
     * Routine 10 — `Delta Reset`.
     *
     *     movea.l $4.w,a6 / jsr -$96(a6) / jsr -$78(a6)     SuperState, Disable
     *     clr.l $4.w / lea $fc0000.l,a0 / reset / jmp (a0)
     *
     * `clr.l $4.w` wipes ExecBase, so the ROM cannot find its warm-start
     * marker and cold-boots. Misc 1.0's `Reset` is the same seven
     * instructions with its own source to say so; ../amiga/machine.ts carries
     * the reading for both, and for the five other reboot keywords in this
     * corpus.
     *
     * It asks the machine rather than doing it, exactly as AMCAF's `Reset
     * Computer` does, because performing a reset means building the Runtime
     * that is being torn down. The program ends, and whoever owns the frame
     * loop brings the machine back.
     */
    'delta reset'(it) {
      rt.machine.requestReset('cold', 'delta reset')
      it.halt('ended')
      return 'jumped'
    },

    /**
     * Routine 13 — `Delta Change Disk`, which is Misc 1.0's `Disk Wait`.
     *
     * Spin until CIA-A port A bit 4 goes low — the disk-change line, so: wait
     * for a disk to be swapped. Then a 500-iteration delay, and a loop of
     * `Disable / FindName` over ExecBase's TaskReady ($196) and TaskWait
     * ($1a4) lists looking for a task named "Validator", `Enable`, repeat
     * until it has gone: wait for the filesystem to finish validating.
     *
     * DEVIATION: returns at once, for Misc's reasons. There is no floppy to
     * insert — volumes here are mounted rather than inserted — and no
     * validator task to outlive, since there is one task. The alternative is
     * to block for ever.
     *
     * NOTE: the delay calls a subroutine that is `movem.l d0-d7/a0-a6,-(a7)`
     * followed immediately by the matching pop and an `rts`. Sixteen registers
     * pushed and popped straight back, five hundred times, and nothing else.
     */
    'delta change disk'() {
      // no disk to change, and no Validator to outlive
    },

    /**
     * Routine 14 — `Delta Wait Left Mouse`: `btst #$6,$bfe001 / bne`, CIA-A
     * port A bit 6, active low, so it spins while the button is UP.
     *
     * A spin cannot be a spin here — nothing else would run, including
     * whatever delivers the press — so it yields the frame and comes back,
     * which makes the test once a frame instead of once a bus cycle. Same
     * treatment as Misc's `Firewait`.
     */
    'delta wait left mouse'(it) {
      if (rt.input.mouseK & 1) return
      it.block({ type: 'wait', until: Math.floor(it.tick) + 1 }, true)
    },

    /**
     * Routine 28 — `Delta Wait Fire`: `btst #$7,$bfe001 / bne`, bit 7 being
     * port 1's fire button. Misc 1.0's `Firewait` to the instruction, and the
     * same yielding wait.
     */
    'delta wait fire'(it) {
      if (joyFire(rt.input.joy)) return
      it.block({ type: 'wait', until: Math.floor(it.tick) + 1 }, true)
    },

    /**
     * Routine 5 — `Delta Wait Double Mouse XX`.
     *
     *     btst #$6,$bfe001 / bne .          wait for a press
     *     d0 = XX
     *     subi.w #$1,d0 / tst.w d0 / bne .  burn it
     *     btst #$6,$bfe001 / bne .          wait for a press
     *
     * DEFECT: there is no wait for a RELEASE between the two. If the button is
     * still down when the delay runs out — and for any small XX it will be —
     * the second wait falls straight through and a single click counts as a
     * double. XX has to be long enough to outlast a human's first press for
     * the keyword to mean anything, and the guide calls it only *"delay"*.
     *
     * NOTE: `subi.w #$1,d0` on a longword argument decrements the low word, so
     * XX of 0 (or of 65536) burns 65,536 iterations rather than none.
     *
     * DEVIATION: the delay is a busy loop measured in bus cycles — about 26 a
     * turn at 7.09MHz — and this waits in FRAMES, because a frame is the
     * finest grain at which the button can change here. The phase has to live
     * on the state rather than in a local: a blocking keyword re-runs its
     * whole statement when it resumes, so there is nowhere else to remember
     * that the first press already happened.
     */
    'delta wait double mouse'(it) {
      const st = rt.delta
      const delay = it.evalInt()
      const down = (rt.input.mouseK & 1) !== 0
      const again = (): void => it.block({ type: 'wait', until: Math.floor(it.tick) + 1 }, true)

      if (st.dblPhase === 0) {
        if (!down) return again()
        const turns = ((delay - 1) & 0xffff) + 1
        st.dblPhase = 1
        // 26 cycles a turn at 7.09MHz, rounded up to whole frames
        st.dblUntil = Math.floor(it.tick) + Math.ceil((turns * 26) / (7_093_790 / 50))
        return again()
      }
      if (st.dblPhase === 1) {
        if (it.tick < st.dblUntil) return again()
        st.dblPhase = 2
        return again()
      }
      if (!down) return again()
      st.dblPhase = 0
    },
  }
}

export function makeDeltaFunctions(): Record<string, Func> {
  const out: Record<string, Func> = {
    /**
     * Routine 16 — `=Delta Brithday`, the author's own spelling.
     *
     * `moveq #$0,d2 / move.l #$15f70ad,d3` — an INTEGER, 22999213, and the
     * guide says only *"Return my birthday."* Nothing anywhere says how to
     * read it, and it is not a date in any of the obvious layouts, so it is
     * reported as the number the routine returns.
     */
    'delta brithday': () => VI(0x015f70ad),

    /** Routine 17 — `=Delta Pi#`: the FFP longword $c90fdb42, which is π to seven digits */
    'delta pi#': () => VF(DELTA_PI),

    /**
     * Routine 18 — `=Delta E#`: $adf85442. The guide calls it *"rule of
     * naturals logarithms"*, which is e, and FFP again stops it at seven
     * digits.
     */
    'delta e#': () => VF(DELTA_E),
  }

  /**
   * Routines 19 to 27 — the nine string constants.
   *
   * All one shape: build the string a byte at a time and hand back a pointer.
   * See the header for where the pointer points and why it works anyway.
   *
   * NOTE on two of them. `Delta Radian$` ends in `$b0`, the degree sign, and
   * `Delta Degree$` in "rd" — so the guide's own `Radian#=Val(Delta Radian$)`
   * relies on `Val` stopping at the first character that is not a number,
   * which AMOS's does. The values themselves are right: 0.9144 m to a yard,
   * 1852 m to an international nautical mile, 1853.25 to a US one, 57.29578°
   * to a radian, and 0.57722 for Euler's γ.
   */
  for (const [name, value] of Object.entries(STRINGS)) out[name] = () => VS(value)
  return out
}
