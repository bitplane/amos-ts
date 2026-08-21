/**
 * Delta — Łukasz "DELTA" Żelezny, twenty-six keywords at slot 15 in 1.4 and
 * forty-six in 1.6.
 *
 * *"This is small extension for AMOSPro. This is public domain file. If you
 * like it then send me post-card."* Fourteen instructions that poke the
 * hardware and twelve functions that return constants, and the interesting
 * thing about it is how much of the first half is somebody else's. 1.6 adds
 * twenty that are mostly AmigaOS: reqtools requesters, Workbench, public
 * screens, tasks, and four the guide marks private.
 *
 * ## Evidence
 *
 * BINARY tier with an AmigaGuide, `amospro_delta.guide`, that documents every
 * keyword — briefly, and sometimes wrongly; where it and the code disagree
 * the code is what is written down here and the disagreement is said.
 *
 * ONE PORT SERVES BOTH RELEASES because 1.6 appended without moving an id:
 * all 26 of 1.4's token entries sit at the id 1.6 gives the same keyword, so
 * a routine NUMBER means the same thing in both. The addresses do not, and
 * the two binaries are cited at their own offsets — 1.4's code hunk is 1,936
 * bytes with 30 jump-table entries, 1.6's is 10,240 with 68.
 *
 * `extdis delta-1.4` and `extdis delta-1.6` disassemble them. 1.4's 38
 * `HUNK_RELOC32` offsets are what settle the string functions below; 1.6 has
 * 24, and their ABSENCE is evidence too — neither the `$2a` nor the `$fc0000`
 * in `Delta Hard Reset` is relocated, so both are literal addresses.
 *
 * The slot is the guide's — *"Enter 'AMOSPro_Delta.Lib' into slot 15"* — and
 * routine 0 agrees: it is `moveq #$e,d0 / rts`, the extension number 15-1 and
 * nothing else. 1.4 has no data zone and writes nothing to `$XX(a5)`. 1.6
 * READS one: six of its keywords fetch the library base from `$1d8(a5)`,
 * which is `$f8 + 14*16` and so slot 15 from the binary rather than from the
 * guide, and reach the three library-name strings at base+$512.
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
 * ## The nine string functions, and the two buffers they are ten bytes short of
 *
 * Routines 19 to 27. All nine share one shape in both releases: point a1 at a
 * buffer, `move.w #len,(a1)+` and then that many `move.b #char,(a1)+`, set d2
 * to 2 for the string type, point a0 at the buffer again and `move.l a0,d3`.
 * There is no encoding question anywhere in them — the characters are
 * immediates in the instruction stream, so `STRINGS` below is the bytes.
 *
 * The author reserved TWO ten-byte buffers, side by side, immediately before
 * code. In 1.4 they are at $480 and $48a, and 1.4's routine 20 ($494) begins
 * where the second one ends; in 1.6 they are at base+$1952 and base+$195c —
 * hunk $1e64 and $1e6e — and 1.6's routine 3 ($1e78) begins where the second
 * one ends. Every routine loads a0 with the SECOND buffer twice at the top and
 * overwrites it both times, builds into the first, and never uses the second
 * for anything. Twenty bytes, and the length word costs two of them.
 *
 * DEFECT: `Delta About$` is a 22-character string, so it writes 24 bytes into
 * 20 and the last four land on whatever follows. In 1.6 that is the first
 * longword of `Delta Decrunch`, whose `move.l (a3)+,d0 / tst.w d0` — `201b
 * 4a40` — becomes `466e 7a21`, the "Fnz!" that ends the string, and the next
 * program to decrunch executes `not.w $7a21(a6)` instead. NOT REPRODUCED:
 * there is no code memory here for a string to land in.
 *
 * DEFECT: in 1.4 only, the buffers are addressed as `movea.w (buffer).L,a1`,
 * which reads the WORD AT the buffer and sign-extends it rather than loading
 * its address — that would be `lea`. The relocation table confirms the
 * operands are relocated, so they really do point at the buffer; the buffer is
 * zeros, so a1 is 0 and the string is built at ADDRESS ZERO, over the 68000's
 * exception vectors. `Delta About$` reaches vectors 0 to 5 — the initial stack
 * pointer and PC, bus error, address error, illegal instruction and
 * divide-by-zero. It still WORKS, because the closing `movea.w (buffer).L,a0`
 * is wrong the same way and hands back 0, which is where the string is.
 *
 * 1.6 fixed it, and not deliberately: the release moved every absolute
 * reference to `movea.l $1d8(a5),a1 / adda.w #offset,a1` so that the library
 * works from its slot base, and the string functions came right on the way
 * past. Which is why the overrun above is 1.6's alone — 1.4 never reaches the
 * buffer to run off the end of it.
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
 *
 * NOTE: every OpenLibrary in this extension leaves the VERSION register
 * alone. `$23c8`, `$25ce` and `$2634` all load the name into a1 and jump to
 * `-$198(a6)` without touching d0 first, so what gets asked for is whatever
 * the interpreter left there; routine 55's own `move.l #$64,d0` lands AFTER
 * the call, on its way to rtGetLongA, which does not want it either.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { AmosError, VF, VI, VS, int, str } from '../interp/values'
import { joyFire } from '../interp/gameport'
import { REQ_MODE, RT_MAXINT, RT_MININT, type PaletteReqSetup, type ReqSetup } from '../amiga/reqtools'

/**
 * The nine messages, at $26d4 in the code hunk, NUL-separated and packed.
 *
 * Every one is raised through routine 66 at $26c4:
 *
 *     lea $26d4(pc),a0 / moveq #0,d1 / moveq #$e,d2 / moveq #0,d3
 *     Rjmp L_ErrorExt
 *
 * a0 the table base, d0 the index, d1 zero for trappable, and d2 the
 * extension slot ZERO-BASED — $e is Delta's 15, the same field FileID spells
 * `#$18` for 25 and Range `#$8` for 9. Eight of the nine have a caller and
 * each sets d0 exactly once, which is what identifies the index: routine 48
 * clears the lock flag and raises 6, landing on "already unlocked", and
 * routine 49 is the lock path and raises 5, landing on "already locked".
 *
 * DEFECT: three are unreachable. Routine 37 (2), routine 38 (3) and routine
 * 42 (4) have no caller anywhere in the file — so `Delta Change Bank` never
 * checks that its address is a bank, no keyword checks that its library
 * opened, and nothing ever fails to build an alert. The guide knows about the
 * middle one: every reqtools example is wrapped in
 * `If Exist("LIBS:reqtools.library")` and says *"Else you will have GURU."*
 *
 * Message 8 has no caller either, and names something this library does not
 * do at all.
 */
export const DELTA_ERRORS: readonly string[] = [
  'Variable is too small',
  'Variable is too large',
  'Bank is not defined',
  'Cannot create intuition alert',
  'Cannot open reqtools.library',
  'Public screen already locked',
  'Public screens already unlocked',
  'Task not found',
  'Not a tracker module',
]

const deltaError = (n: number): never => {
  throw new AmosError(DELTA_ERRORS[n] ?? `Delta error ${n}`)
}

/**
 * Whether the program bound 1.6 rather than 1.4.
 *
 * One keyword disagrees between the releases -- `Delta Decrunch`, routine 3
 * in both -- and a program can see the difference, so the port asks rather
 * than picking one. Reads the binding the way amon.ts's `isAmon103` and
 * jdprt.ts's `isPre14` do.
 *
 * Unbound, this answers false and 1.4 is what runs: 1.4 is the release
 * delta.ts was read from, and a program identified by token table alone has
 * no binding to ask about. The twenty keywords 1.6 added are not affected
 * either way -- they exist only in 1.6's table, so reaching one at all is
 * proof of which release is bound.
 */
export function isDelta16(rt: Runtime): boolean {
  for (const def of rt.extBindings?.values() ?? []) if (def.id === 'delta-1.6') return true
  return false
}

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
  /**
   * The byte at $1e62, which is the whole of the public-screen lock: `Delta
   * Lock Pub Screens` refuses unless it reads 0 and `Delta Unlock Pub
   * Screens` unless it reads 1. It is the library's own flag and not
   * Intuition's, so it starts clear and nothing else can move it.
   */
  pubLocked: boolean
  /** a reqtools requester waiting on the user, over the block and back */
  /**
   * The long at $1d06. `Delta Reqtools Get Number` writes its default there,
   * hands rtGetLongA a pointer to it, and reads the answer back out of the
   * same four bytes — so a cancelled requester returns the default.
   */
  long: number
}

export const newDeltaState = (): DeltaState => ({ dblPhase: 0, dblUntil: 0, pubLocked: false, long: 0 })

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
 * The nine strings, byte for byte, in jump-table order — routines 19 to 27,
 * each cited at both releases' addresses below.
 *
 * Read off the immediates: `move.w #$16` then 22 `move.b`, `move.w #$6` then
 * six, and so on down. See the header for the shape they share and for the
 * two defects in it.
 *
 * The values are right — 0.9144 m to a yard, 0.3048 to a foot, 0.0254 to an
 * inch, 1852 to an international nautical mile, 1853.25 to a US one, 57.29578°
 * to a radian, 0.01745 rad to a degree, and 0.57722 for Euler's γ. Two carry a
 * unit suffix that `Val` will stop at, which the guide's own
 * `Radian#=Val(Delta Radian$)` does not mention — see `delta radian$`.
 */
const STRINGS: Record<string, string> = {
  // 1.6's routine 19 ($1fdc), 1.4's 19 ($406) — `move.w #$16` and 22 characters, four more than there is room for
  'delta about$': 'Delta of Opium^Hv^Fnz!',
  // 1.6's routine 20 ($2066), 1.4's 20 ($494)
  'delta yard$': '0.9144',
  // 1.6's routine 21 ($20a8), 1.4's 21 ($4ce)
  'delta feet$': '0.3048',
  // 1.6's routine 22 ($20ea), 1.4's 22 ($508)
  'delta inch$': '0.0254',
  // 1.6's routine 23 ($212c), 1.4's 23 ($542)
  'delta english mile$': '1852',
  // 1.6's routine 24 ($2166), 1.4's 24 ($574)
  'delta american mile$': '1853.25',
  // 1.6's routine 25 ($21ac), 1.4's 25 ($5b2) — the last byte is $b0, the degree sign
  'delta radian$': '57.29578°',
  // 1.6's routine 26 ($21fa), 1.4's 26 ($5f8) — and this one ends "rd", $72 $64
  'delta degree$': '0.01745rd',
  // 1.6's routine 27 ($2248), 1.4's 27 ($63e)
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
     * Routine 3 — `Delta Decrunch XX`, and the one keyword whose two
     * releases disagree.
     *
     * 1.4 ($280, 40 bytes) raises AMOS's own numbered errors:
     *
     *     move.l (a3)+,d0
     *     tst.w d0         / beq  -> moveq #$17,d0 / Rjmp L_Error    23
     *     cmpi.w #$1000,d0 / bge  -> moveq #$1d,d0 / Rjmp L_Error    29
     *     move.l d0,$dff180.l
     *
     * 1.6 ($1e78, 24 bytes) is the same three instructions with the two
     * branches sent to its own message table instead — `Rbeq routine 34`
     * and `Rbge routine 35`, which are `moveq #0,d0` and `moveq #1,d0` in
     * front of a shared `Rbra routine 66`, the L_ErrorExt dispatcher. So the
     * messages are DELTA_ERRORS 0 and 1, "Variable is too small" and
     * "Variable is too large" — the pair `Delta Change Bank` also uses, which
     * is 1.6-only and therefore needs no test of its own.
     *
     * `isDelta16` picks between them; unbound, 1.4's numbers are the answer.
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
      const v16 = isDelta16(rt)
      if ((v & 0xffff) === 0) {
        if (v16) deltaError(0)
        throw new AmosError('Illegal function call', 23)
      }
      if (((v & 0xffff) << 16) >> 16 >= 0x1000) {
        if (v16) deltaError(1)
        throw new AmosError('Overflow', 29)
      }
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

    // ---- the twenty 1.6 adds ----

    /**
     * Routine 29 ($229a) — `Delta Hard Reset`, and the guide's whole entry is
     * *"HARD RESET! CAUTION!"*
     *
     *     movea.l $4.l,a6                 ExecBase — loaded and NEVER USED
     *     move.l  #$0,$2a.l
     *     jmp     $fc0000.l
     *
     * DEFECT: `$2a` was meant to be `$2a(a6)`. ExecBase+$2a is ColdCapture,
     * the vector the ROM jumps through on a reset, and clearing it is exactly
     * what a keyword called Hard Reset would do before jumping to the ROM —
     * which is why a6 is loaded at all. Written as an ABSOLUTE address it
     * lands in the 68000's own vector table instead, on the low word of
     * vector 10 and the high word of vector 11, and ColdCapture survives. The
     * relocation table settles it: 24 longwords are relocated and neither the
     * `$2a` nor the `$fc0000` is among them, so both are literal addresses.
     *
     * It also skips what `Delta Reset` does — no SuperState, no Disable, no
     * `reset` instruction, and ExecBase left where it is.
     *
     * Asked of the machine rather than performed, as `Delta Reset` and
     * AMCAF's `Reset Computer` are: performing a reset means building the
     * Runtime that is being torn down. Cold, because the destination is the
     * ROM's entry point.
     */
    'delta hard reset'(it) {
      rt.machine.requestReset('cold', 'delta hard reset')
      it.halt('ended')
      return 'jumped'
    },

    /**
     * Routine 30 ($22b2) — `Delta Blit Off`, which does not turn the blitter
     * off. It WAITS for it:
     *
     *     btst.b #$e,$dff002 / bne
     *
     * DMACONR bit 14 is BBUSY, and the guide agrees with the code rather than
     * with the name — *"Wait until blitter is off."* The `btst.b` on the even
     * address tests the register's high byte, where a byte operand takes the
     * bit number mod 8, so bit 14 of the word is what is read.
     *
     * A blit completes inside the keyword that started it here, so BBUSY is
     * never set when anything can look — the wait is satisfied on entry,
     * which is the same answer the machine gives for every blit that has
     * already finished.
     */
    'delta blit off'() {
      // nothing here can still be blitting
    },

    /**
     * Routine 31 ($22be) — `Delta Crash XX`, which the guide calls *"some new
     * visual effect"* and offers as `Do : Delta Crash Rnd(10000) : Loop`.
     *
     *     move.l (a3)+,d0
     *     move.l d0,$dff108.l        BPL1MOD and BPL2MOD
     *     move.l d0,$dff110.l        BPL1DAT and BPL2DAT
     *
     * Two longword writes over four word registers, the same doubling
     * `Delta Decrunch` gets on COLOR00 — the high word reaches $108/$110 and
     * the low word $10a/$112. Corrupting both bitplane modulos is what makes
     * the display shear, and the bitplane data registers are written straight
     * into the middle of a fetch.
     *
     * DEVIATION: neither register is modelled. The modulos here come from the
     * screen's own width rather than from $dff108, and nothing reads $dff110
     * at all, so the effect is evaluated and not shown — the same treatment
     * `Delta No Synchro` gets, and for the same reason.
     */
    'delta crash'(it) {
      it.evalInt()
    },

    /**
     * Routine 33 ($2300) — `Delta Beep All`. Saves a3-a6 and calls routine 32
     * ($22ce), which opens `intuition.library` and calls DisplayBeep (-96)
     * with a NULL screen: beep EVERY screen, which is where the name comes
     * from.
     *
     * DEFECT: routine 32 never checks what OpenLibrary returned — it goes
     * straight to `movea.l d0,a6` — and it never closes the library either,
     * so every call to any of the six keywords that use it leaks a reference.
     * The base is kept at $1b02 and simply overwritten each time.
     *
     * DEVIATION: no display beep is modelled. AMOS's own screens are the
     * display here and there is no Workbench flash behind them, so the
     * keyword is reached and nothing is shown.
     */
    'delta beep all'() {
      // no display beep: nothing here flashes a screen
    },

    /**
     * Routine 36 ($231a) — `Delta Change Bank Start(OLDBANK) To NEWBANK`.
     *
     *     move.l  (a3)+,d1            NEWBANK, popped first
     *     movea.l (a3)+,a0            the address
     *     tst.w d1   / Rbeq 34        "Variable is too small"
     *     tst.w d1   / Rbmi 34        and again for a negative word
     *     cmpi.w #$1000,d1 / Rbge 35  "Variable is too large"
     *     suba.l #$10,a0 / move.l d1,(a0)
     *
     * So a bank is renumbered by poking its header: AMOS keeps the bank
     * number in the longword sixteen bytes before the data `Start()` answers,
     * and this writes a new one over it.
     *
     * DEFECT: every check is a WORD test on a LONGWORD argument, and the
     * write is a longword. $10001 has a low word of 1, passes all three, and
     * is stored whole — so the bank ends up numbered 65537, which is outside
     * AMOS's own 1..65535. The upper bound is 4095 rather than 65535, and
     * signed, which is what makes the second test necessary at all.
     *
     * DEFECT: nothing checks that the address IS a bank. Routine 37 exists to
     * say "Bank is not defined" and has no caller, so the sixteen bytes below
     * any address at all are fair game.
     *
     * DEVIATION: there are no bank headers in this address space — a bank's
     * `Start()` is a synthetic base and the sixteen bytes below it belong to
     * nothing — so a matching bank is renumbered directly. An address that is
     * not a bank's start falls through to the write the machine would do,
     * which lands wherever `Loke` would land.
     *
     * NOTE: the guide says *"NEWBANK can't be number of existing bank"* and
     * the library does not enforce it. On the machine two headers then claim
     * one number and whichever the chain reaches first wins; here the map
     * cannot hold both, so the new number replaces what was there.
     */
    'delta change bank'(it) {
      const addr = it.evalInt()
      it.expect('to')
      const to = it.evalInt()
      if ((to & 0xffff) === 0 || (to & 0x8000) !== 0) deltaError(0)
      if (((to & 0xffff) << 16) >> 16 >= 0x1000) deltaError(1)
      const from = rt.bankRefs().find((b) => b.address === (addr >>> 0))
      const bank = from ? rt.memBanks.get(from.number) : undefined
      if (bank) {
        rt.memBanks.delete(from!.number)
        rt.memBanks.set(to, { ...bank, number: to })
        return
      }
      const m = rt.resolveWrite((addr - 0x10) >>> 0)
      if (m && m.off + 3 < m.data.length) {
        m.data[m.off] = (to >>> 24) & 0xff
        m.data[m.off + 1] = (to >>> 16) & 0xff
        m.data[m.off + 2] = (to >>> 8) & 0xff
        m.data[m.off + 3] = to & 0xff
      }
    },

    /**
     * Routine 39 ($234c) — `Delta Intuition Message WIDTH,Chr$(POS)+TXT$`,
     * *"some yellow message"*, which is DisplayAlert (-90) through routine 40
     * ($2362). WIDTH reaches d1, and d1 is DisplayAlert's HEIGHT.
     *
     * DEFECT: the string is stored RAW. Routine 39 is `move.l (a3)+,$1b06.l`
     * and routine 40 loads that straight into a0, so a0 points at the AMOS
     * string's LENGTH WORD rather than at its characters — where routines 41,
     * 53 and 55 all step over the length and write a NUL first. DisplayAlert's
     * format is a word of x, a byte of y, the text, a NUL and a continuation
     * byte, so the length word is read as the x position and the first
     * character as y. That is why the guide says to write `Chr$(POS)+TXT$`:
     * POS is the y the author could control, and x is whatever the string
     * happens to be long. There is no NUL either, so the text runs on until
     * some zero byte turns up in AMOS's string area.
     *
     * DEVIATION: no alert is modelled. DisplayAlert draws on the bare
     * hardware above every screen, which this port has no surface for, and
     * routine 38's "Cannot create intuition alert" has no caller so there is
     * not even a failure arm to take.
     */
    'delta intuition message'(it) {
      it.evalInt()
      it.expect(',')
      it.evalStr()
    },

    /**
     * Routine 41 ($239e) --- `Delta Reqtools Palette TITLE$`.
     *
     * NUL-terminates the title in place, stores the pointer at $1b06 and
     * calls routine 43 ($23c8), which opens `reqtools.library` and calls -102
     * with the title in a2, reqinfo in a3 and the taglist in a0, both zero.
     * That is `rtPaletteRequestA(title,reqinfo,taglist)(A2/A3,A0)` exactly ---
     * thirteenth in the FD and so at bias 30 plus twelve sixes, with the two
     * private password entries and rtFontRequestA between it and the -84 a
     * shorter list would give.
     *
     * The answer is thrown away. Routine 41 is an INSTRUCTION and routine 43
     * ends `jsr -$66(a6) / rts` with d0 untouched, so the pen the user picked
     * is unreachable and the only thing the keyword leaves behind is the
     * palette itself.
     *
     * And that palette is the WORKBENCH's. `GetReqScreen` follows RT_Screen,
     * then RT_Window's screen, then the default public screen, and a0 is zero
     * so there is neither tag --- the requester opens on Workbench and edits
     * Workbench's four colours. A program drawing on an AMOS screen sees
     * nothing change.
     *
     * `$23dc movea.l #$0,a2` is dead: a2 is loaded again from $1b06 six
     * instructions later. Left over from the template routine 54 is cut from.
     */
    'delta reqtools palette'(it) {
      const title = it.evalStr()
      if (rt.rtPalette) {
        if (!rt.rtPalette.done) {
          it.block({ type: 'rtreq' }, true)
          return
        }
        rt.rtPalette = null
        return
      }
      const setup: PaletteReqSetup = {
        title,
        // `glob->color = 1` before the tags are read, and a0 is zero so no
        // RTPA_Color arrives to move it
        color: 1,
        // filled in from the screen the requester lands on
        depth: 0,
        bits: [4, 4, 4],
      }
      if (!rt.startRtPaletteRequest(setup, null)) return
      it.block({ type: 'rtreq' }, true)
    },

    /**
     * Routine 56 ($2678) — `Delta Req Palette COLOUR`, *"number of first
     * edited colour"*. The odd one out: `req.library` rather than reqtools,
     * opened from the third name at $1d4f, with the colour in d0 and a call
     * to -90.
     *
     * NOTE: no FD for req.library is in the corpus, so -90 is recorded as an
     * offset and not named. The guide's example is `Print Delta Req Palette
     * 2`, which cannot parse — the token spec is `I0`, an instruction with
     * one integer, and there is no value to print.
     *
     * APPROXIMATED: `req.library` is a different library, and this port has
     * no more of it than `Lfreq` does. What `-90` puts on the screen is
     * unread, so the keyword is reached and nothing is edited --- which is
     * the cancel path of whatever requester the author called. The reqtools
     * one next door is real now; this one cannot be until req.library is.
     */
    'delta req palette'(it) {
      it.evalInt()
    },

    /**
     * Routine 44 ($23fa) — `Delta Wb To Front`, WBenchToFront (-342), and
     * routine 45 ($242e) `Delta Wb To Back`, WBenchToBack (-336). Both open
     * `intuition.library` first, keep the base at $1b02 and never close it.
     *
     * The names are Delta's own, so they do not contest CRAFT's `Wb To
     * Front` / `Wb To Back` — the same two calls, already modelled.
     */
    'delta wb to front'() {
      rt.intuition.wBenchToFront()
    },
    'delta wb to back'() {
      rt.intuition.wBenchToBack()
    },

    /**
     * Routine 46 ($2462) — `Delta Lock Pub Screens`, and routine 47 ($24ac)
     * `Delta Unlock Pub Screens`. LockPubScreenList (-522) and
     * UnlockPubScreenList (-528), each guarded by the byte at $1e62:
     *
     *     cmpi.b #$0,$1e62 / beq .    lock:   anything else -> routine 49
     *     cmpi.b #$1,$1e62 / beq .    unlock: anything else -> routine 48
     *
     * NOTE: the two failure arms are not symmetric, and routine 49 is the
     * interesting one. Locking twice does not simply complain — routine 49
     * opens intuition, calls UnlockPubScreenList, clears the flag and only
     * then raises "Public screen already locked". So the error leaves the
     * list UNLOCKED, and a program that traps it is in the state it started
     * in. Routine 48 just clears the flag and raises "already unlocked".
     *
     * DEVIATION: no public screen list is modelled — this port has AMOS's own
     * screens and no Intuition screen list behind them — so the flag is kept
     * and the two calls are not made. The flag is what a program can see: the
     * errors, and which of them it gets, are the whole observable behaviour.
     */
    'delta lock pub screens'() {
      const st = rt.delta
      if (st.pubLocked) {
        st.pubLocked = false
        deltaError(5)
      }
      st.pubLocked = true
    },
    'delta unlock pub screens'() {
      const st = rt.delta
      if (!st.pubLocked) deltaError(6)
      st.pubLocked = false
    },

    /**
     * Routine 51 ($2568) — `Delta Kill Task NAME$`. FindTask (-294) on the
     * name, then RemTask (-288) on what it found.
     *
     *     tst.w d0 / Rbeq 52          "Task not found"
     *
     * DEFECT: the name is NOT NUL-terminated — the routine steps over the
     * length word and hands FindTask the characters as they lie, where the
     * three reqtools keywords all write a terminator first. FindTask compares
     * against a C string, so the match runs on into whatever follows in AMOS's
     * string area.
     *
     * DEFECT: `tst.w d0` tests the low WORD of a task pointer. A task at an
     * address whose low sixteen bits are zero reports "Task not found".
     *
     * DEVIATION: there is one task here and it has no address, so FindTask
     * answers nothing and this always raises "Task not found". The guide's own
     * warning is *"Name of cannot be ' AMOS' ... if you will kill AMOS task
     * then AMOS will crash"*, and refusing every name is the safe end of that.
     */
    'delta kill task'(it) {
      it.evalStr()
      deltaError(7)
    },

    /*
     * `Jsr ADDRESS` is routine 57 ($26a6), `movea.l (a3)+,a0 / jsr (a0)`, and
     * has NO HANDLER HERE ON PURPOSE — it is n/a, and ../coverage/status.ts
     * carries the reading. It calls a 68000 subroutine at an address the
     * program supplies, which is the whole keyword rather than a step in it,
     * so there is nothing left to implement once 68k is out of scope. The
     * three `Move*` below share its "- PRIVATE -" heading in the guide and
     * are Poke, Doke and Loke, so they are implemented.
     */

    /**
     * Routines 58, 59 and 60 ($26ac, $26b4, $26bc) — `Moveb`, `Movew` and
     * `Movel DATA,ADDRESS`, the other three the guide marks private and
     * describes as *"like Poke"*, *"like Doke"* and *"like Loke"*.
     *
     *     movea.l (a3)+,a0 / move.l (a3)+,d0 / move.b d0,(a0)
     *
     * The address pops first, so it is the LAST argument: these read
     * `Moveb DATA,ADDRESS` where AMOS's own three read `Poke ADDRESS,DATA`.
     * The guide spells it that way round too, and it is the only thing about
     * them worth knowing.
     */
    'moveb'(it) {
      const v = it.evalInt()
      it.expect(',')
      const m = rt.resolveWrite(it.evalInt() >>> 0)
      if (m) m.data[m.off] = v & 0xff
    },
    'movew'(it) {
      const v = it.evalInt()
      it.expect(',')
      const m = rt.resolveWrite(it.evalInt() >>> 0)
      if (m && m.off + 1 < m.data.length) {
        m.data[m.off] = (v >> 8) & 0xff
        m.data[m.off + 1] = v & 0xff
      }
    },
    'movel'(it) {
      const v = it.evalInt()
      it.expect(',')
      const m = rt.resolveWrite(it.evalInt() >>> 0)
      if (m && m.off + 3 < m.data.length) {
        m.data[m.off] = (v >>> 24) & 0xff
        m.data[m.off + 1] = (v >>> 16) & 0xff
        m.data[m.off + 2] = (v >>> 8) & 0xff
        m.data[m.off + 3] = v & 0xff
      }
    },
  }
}

export function makeDeltaFunctions(rt: Runtime): Record<string, Func> {
  const out: Record<string, Func> = {
    /**
     * Routine 50 ($2548) — `=Delta Find Task(NAME$)`, FindTask (-294) with
     * the address it answers straight into d3. The guide: *"if ADDRESS=0 then
     * task not found."*
     *
     * DEFECT: the name is not NUL-terminated, exactly as `Delta Kill Task`
     * does not — see there.
     *
     * DEVIATION: one task, and no address for it. ../amiga/exec.ts models
     * exec with a single task on purpose, so there is no list to search and
     * every name answers 0 — which is the answer the guide tells a program to
     * test for.
     */
    'delta find task': (_it, a) => {
      str(a[0]!)
      return VI(0)
    },

    /**
     * Routine 53 ($2598) — `=Delta Reqtools Requester(TITLE$,GADGET$)`,
     * *"SELECTED - number of selected gadget"*.
     *
     * Both strings are NUL-terminated in place and stored, GADGET$ at $1b06
     * and TITLE$ at $1c06 — that order, because the arguments pop right to
     * left. Routine 54 ($25ce) then opens `reqtools.library` and calls -66
     * with a1 = TITLE$, a2 = GADGET$ and a3, a4, a0 all zero, which is
     * `rtEZRequestA(bodyfmt,gadfmt,reqinfo,argarray,taglist)(A1/A2/A3/A4,A0)`
     * to the register.
     *
     * APPROXIMATED: an Interface dialog stands in for the reqtools requester,
     * as it does for BUtility's `Binforeq`. The numbering is reqtools' own and
     * comes back unchanged — gadget 1 is the leftmost and the RIGHTMOST
     * answers 0, so the guide's `"Yes|No"` gives 1 for Yes.
     */
    'delta reqtools requester': (it, a) => {
      if (rt.rtReq) {
        if (!rt.rtReq.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtReq
        rt.rtReq = null
        return VI(r.result)
      }
      // a0 is zero at `$260c jsr -$42(a6)`, so there is no tag list: no
      // RTEZ_ReqTitle, and the title bar gets reqtools' own `Request` --- or
      // `Information` when the format names one gadget or none
      const setup: ReqSetup = {
        mode: REQ_MODE.EZREQUEST,
        body: str(a[0]!),
        gadgets: str(a[1]!),
        title: null,
        flags: 0,
        width: 0,
        // no RT_Underscore either, so `glob->underchar` stays 0 and an
        // underscore in a label is DRAWN rather than eaten
        underscore: '',
        defaultResponse: 1,
        min: RT_MININT,
        max: RT_MAXINT,
        minmax: false,
      }
      const args = { setup, buffer: '', maxLen: 0, value: 0, showDefault: true, allowEmpty: false, invisible: false }
      if (!rt.startRtRequest(args, null)) return VI(0)
      it.block({ type: 'rtreq' }, true)
      return VI(0)
    },

    /**
     * Routine 55 ($2616) — `=Delta Reqtools Get Number(TITLE$,DEF_NUMBER)`.
     *
     * DEF_NUMBER pops first and goes to the long at $1d06; TITLE$ is
     * NUL-terminated and stored at $1b06. Then `reqtools.library` and -78
     * with a1 = &$1d06, a2 = TITLE$, a3 and a0 zero — `rtGetLongA(longptr,
     * title,reqinfo,taglist)(A1/A2/A3,A0)`. The answer is read back out of
     * $1d06, so a cancelled requester returns the default it was given.
     *
     * NOTE: `move.l #$64,d0` sits between the two, and rtGetLongA takes
     * nothing in d0 — it is rtGetStringA, one entry earlier at -72, that
     * wants a maxchars there. Copied from the wrong prototype and harmless.
     *
     * APPROXIMATED: an Interface dialog again. No bounds are passed, so the
     * min and max are the widest the dialog will take.
     */
    'delta reqtools get number': (it, a) => {
      const st = rt.delta
      if (rt.rtReq) {
        if (!rt.rtReq.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtReq
        rt.rtReq = null
        // rtGetLongA edits the long at $1d06 in place and routine 55 reads it
        // straight back, so a cancel answers the default it was given
        st.long = r.value
        return VI(st.long)
      }
      st.long = int(a[1]!) | 0
      const setup: ReqSetup = {
        mode: REQ_MODE.ENTER_NUMBER,
        // no RTGL_TextFmt tag, so there is no body: `$264e movea.l $1b06.l,a2`
        // puts TITLE$ in rtGetLongA's TITLE argument, which is the title bar
        body: '',
        gadgets: '',
        title: str(a[0]!),
        flags: 0,
        width: 0,
        underscore: '',
        defaultResponse: 1,
        // and no RTGL_Min or RTGL_Max, so `req.c` leaves them at the ends of
        // a signed long and nothing the gadget will hold is out of range
        min: RT_MININT,
        max: RT_MAXINT,
        minmax: false,
      }
      const args = { setup, buffer: '', maxLen: 0, value: st.long, showDefault: true, allowEmpty: false, invisible: false }
      if (!rt.startRtRequest(args, null)) return VI(st.long)
      it.block({ type: 'rtreq' }, true)
      return VI(st.long)
    },

    /**
     * 1.6's routine 16 ($1fbe), 1.4's 16 ($3e8) — `=Delta Brithday`, the
     * author's own spelling.
     *
     * Ten bytes: `moveq #$0,d2 / move.l #$15f70ad,d3` — an INTEGER, and the
     * guide says only *"Return my birthday."* Nothing anywhere says how to
     * read it, and it is not a date in any of the obvious layouts, so it is
     * reported as the number the routine returns.
     */
    'delta brithday': () => VI(0x015f70ad),

    /** 1.6's routine 17 ($1fc8), 1.4's 17 ($3f2) — `=Delta Pi#`: FFP $c90fdb42, which is π to seven digits */
    'delta pi#': () => VF(DELTA_PI),

    /**
     * 1.6's routine 18 ($1fd2), 1.4's 18 ($3fc) — `=Delta E#`: `move.l
     * #$adf85442,d3 / moveq #$1,d2`, the same ten bytes as `Delta Pi#` with
     * the two halves swapped. The guide calls it *"rule of naturals
     * logarithms"*,
     * which is e, and FFP again stops it at seven digits.
     */
    'delta e#': () => VF(DELTA_E),
  }

  /**
   * Routines 19 to 27 — the nine string constants, read at `STRINGS` above.
   *
   * All one shape: build the string a byte at a time and hand back a pointer.
   * See the header for where the pointer points, why it works anyway in 1.4,
   * and what `Delta About$` runs off the end of in 1.6.
   *
   * NOTE on two of them. `Delta Radian$` ends in `$b0`, the degree sign, and
   * `Delta Degree$` in "rd" — so the guide's own `Radian#=Val(Delta Radian$)`
   * relies on `Val` stopping at the first character that is not a number,
   * which AMOS's does.
   */
  for (const [name, value] of Object.entries(STRINGS)) out[name] = () => VS(value)
  return out
}
