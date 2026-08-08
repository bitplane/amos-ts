/**
 * Sticks 1.01b (shareware) — multi-player joystick and multi-mouse input, by
 * Nigel Critten. Sixteen keywords.
 *
 * Evidence: the extension's own AutoDoc manual (Docs/Sticks.Doc on the AMOS PD
 * CD, one entry per command) plus every routine in the 3,856-byte code hunk
 * disassembled with `extdis sticks-1.01b`. Where the two disagree the binary
 * wins, and both disagreements are recorded below.
 *
 * ## What this extension actually is
 *
 * Raw hardware, all of it. The routines read the custom chips and both CIAs
 * directly:
 *
 *   $dff00c/$dff00a  JOY1DAT/JOY0DAT   digital joystick directions
 *   $dff016          POTINP            the second/third/fourth buttons
 *   $dff034          POTGO             starts an analog (paddle) conversion
 *   $dff012/$dff014  POT0DAT/POT1DAT   analog X in the low byte, Y in the high
 *   $bfe001          CIA-A PRA         fire buttons on the two normal ports
 *   $bfe101          CIA-A PRB         parallel-port DATA lines
 *   $bfd000          CIA-B PRA         parallel-port handshake lines
 *
 * So there are three quite different input paths, and they matter here because
 * only one of them has a host equivalent:
 *
 *  1. **The two normal ports** — mouse port and joystick port. `Multi Joy`,
 *     `Multi Fire` and `Mouse Button` read these. The port itself maps onto
 *     the host's mouse and joystick, so these work.
 *  2. **A parallel-port adaptor** for players three and four. Every `Stick *`
 *     direction and fire keyword reads it. The manual calls it the "serial
 *     port"; the registers say otherwise — CIA-A PRB is the parallel data
 *     register and CIA-B PRA bits 0-1 are BUSY and POUT, also parallel. There
 *     is no adaptor here, so these report an unused port, exactly as IOPorts
 *     reports a serial port with no cable in it.
 *  3. **Analog paddles** on POTnDAT, via `Stick Scan`/`Stick X`/`Stick Y`.
 *     Nothing is attached to those either.
 *
 * The `Mouse *` family is the interesting part, and it is NOT AMOS's pointer.
 * The manual is explicit: "This function does not alter or read the AMOS
 * pointer position to do so you should use the X Mouse function." It is a
 * second, independent position per mouse, held in the extension's own block at
 * $1f8(a5) — `Mouse X n,v` writes +$c for mouse 0 and +$14 for mouse 1
 * (routine 22, $b16), and `Mouse Area` reads the pair at +$c/+$e or +$14/+$16
 * before calling AMOS's own zone test (routine 28, $c96). That state, its
 * clipping and its zone lookup are all reproducible, so they are reproduced.
 *
 * The tracked position is in AMOS **hardware** coordinates, the same space as
 * `X Mouse` and `Sprite`. The author's own Sticks-Demos/Mouse.AMOS settles it:
 * it reads the pair and passes it straight to `Sprite 1,X,Y,1`, and clamps it
 * to 142..434 by 64..236 — hardware ranges, not screen ones. The same demo
 * loops "until the value changes", so mouse 0 genuinely follows the physical
 * mouse; it is aliased to the host pointer here.
 *
 * DEVIATION: on the real machine each mouse is a separate accumulator fed from
 * its own port, so mouse 0's position and the AMOS pointer can drift apart —
 * the manual stresses they are different things. There is one pointer here, so
 * they cannot diverge. Mouse 1 needs a second mouse in the joystick port and
 * has nothing driving it, so it holds wherever a program puts it.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, funcCall, int, type Value } from '../interp/values'
import { MAX_PORT, PORT_JOYSTICK, PORT_MOUSE, joyDirections, joyFire } from '../interp/gameport'
import { JPF_BUTTON_BLUE, JPF_BUTTON_RED, readJoyPort } from '../amiga/lowlevel'

/** one of the two mice: a tracked position and the box it is held inside */
interface StickMouse {
  x: number
  y: number
  x1: number
  y1: number
  x2: number
  y2: number
  /** false until Mouse Clip or a screen has set a real box */
  clipped: boolean
}

export interface SticksState {
  mice: [StickMouse, StickMouse]
}

const newMouse = (): StickMouse => ({ x: 0, y: 0, x1: 0, y1: 0, x2: 0, y2: 0, clipped: false })

export function newSticksState(): SticksState {
  return { mice: [newMouse(), newMouse()] }
}

export function makeSticksInstructions(rt: Runtime): Record<string, Instr> {
  /** every routine validates the port with `blt`/`bgt` against 0 and 1 */
  const port = (n: number): number => {
    if (n < 0 || n > MAX_PORT) funcCall()
    return n
  }

  /**
   * The clip defaults to "the current screen", which is what the manual says
   * of both Mouse Clip's one-argument form and the initial state: "defaults to
   * the default screen size".
   */
  const clipOf = (m: StickMouse): { x1: number; y1: number; x2: number; y2: number } => {
    if (m.clipped) return m
    // hardware coordinates, so the default box is where the screen is DISPLAYED
    const s = rt.screen
    const w = s.hires ? s.width / 2 : s.width
    return {
      x1: s.displayX,
      y1: s.displayY,
      x2: s.displayX + w - 1,
      y2: s.displayY + s.height - 1,
    }
  }

  const setPos = (m: StickMouse, x: number | null, y: number | null): void => {
    const c = clipOf(m)
    if (x !== null) m.x = Math.max(c.x1, Math.min(c.x2, x))
    if (y !== null) m.y = Math.max(c.y1, Math.min(c.y2, y))
  }

  return {
    /**
     * Mouse X n,v and Mouse Y n,v — routines 22 ($b16) and 23 ($b46), 48 bytes
     * each and the same shape:
     *
     *     movea.l $1f8(a5), a0       the extension's data block
     *     move.l  (a3)+, d1          popped in reverse: the VALUE first
     *     move.l  (a3)+, d0          ...then the mouse number
     *     cmp.w   #$0, d0 / blt -> error
     *     cmp.w   #$1, d0 / bgt -> error
     *     move.w  d1, $e(a0)         mouse 0   ($16 for mouse 1)
     *
     * so the position is a WORD per mouse per axis, and the pair are setters
     * despite reading like the core's `X Mouse`. The manual's own BUGS entry
     * corrects an earlier edition on exactly that: "instead of 'Mouse X =
     * value' (as stated) use 'Mouse X Mouse Number,value'", which is the form
     * the token spec has.
     */
    'mouse x'(it) {
      const n = port(it.evalInt())
      it.expect(',')
      const v = it.evalInt()
      setPos(rt.sticks.mice[n]!, v, null)
    },
    'mouse y'(it) {
      const n = port(it.evalInt())
      it.expect(',')
      const v = it.evalInt()
      setPos(rt.sticks.mice[n]!, null, v)
    },
    'mouse clip'(it) {
      // Mouse Clip n,minx,miny To maxx,maxy, or Mouse Clip n on its own —
      // routine 19 ($a66). The short form means "the current screen size",
      // which is also the default, so it clears the box rather than storing one.
      const n = port(it.evalInt())
      const m = rt.sticks.mice[n]!
      if (!it.accept(',')) {
        m.clipped = false
        setPos(m, m.x, m.y)
        return
      }
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      // "This will Limit the mouse to an area on the screen or even beyond the
      // screen if you want" — so the box is not itself clamped to the screen
      m.x1 = Math.min(x1, x2)
      m.y1 = Math.min(y1, y2)
      m.x2 = Math.max(x1, x2)
      m.y2 = Math.max(y1, y2)
      m.clipped = true
      setPos(m, m.x, m.y)
    },
    'stick scan'() {
      // Stick Scan — routine 6 ($4ea), two instructions: `move.w #$1,$34(a0)`,
      // a POTGO write that starts the paddle conversion whose result Stick X
      // and Stick Y read one frame later. With no paddle attached there is no
      // conversion to start, so this is observably nothing.
    },
  }
}

export function makeSticksFunctions(rt: Runtime): Record<string, Func> {
  const port = (n: number): number => {
    if (n < 0 || n > MAX_PORT) funcCall()
    return n
  }
  /** the host's state for one of the two real ports */
  const joyBits = (n: number): number => (n === PORT_MOUSE ? rt.input.joy0 : rt.input.joy)

  /**
   * The two button lines a normal port has, through lowlevel.library.
   *
   * Routines 3 and 4 read exactly two wires per port and read each of them
   * TWICE, with `move.w #$e000,$34(a6)` -- a POTGO write -- in between:
   *
   *     port 1    A/C  btst.b #$7, $bfe001     CIA-A PRA bit 7, /FIR1
   *               B/D  btst.b #$6, $16(a6)     POTINP bit 14, DATRY, pin 9
   *     port 0    A/C  btst.b #$6, $bfe001     /FIR0
   *               B/D  btst.b #$2, $16(a6)     POTINP bit 10, DATLY, pin 9
   *
   * That double read is the four-button adaptor's multiplex: POTGO drives the
   * pot pins to select which pair the connector is presenting. With no adaptor
   * the wires carry the same thing both times, so **A and C are one button and
   * B and D are another** -- which is what this answers.
   *
   * `/FIRn` is what lowlevel.library calls RED and pin 9 is what it calls
   * BLUE, the same two lines Ercole's Xfire and AMCAF's Xfire read, so all
   * three go through `../amiga/lowlevel.ts` and cannot disagree.
   */
  const buttons = (n: number): { red: boolean; blue: boolean } => {
    const jp = readJoyPort(rt.input.ports, n)
    return { red: (jp & JPF_BUTTON_RED) !== 0, blue: (jp & JPF_BUTTON_BLUE) !== 0 }
  }

  return {
    'multi joy'(_, a): Value {
      // =Multi Joy(jport) — routine 3 ($260). Directions come from JOYxDAT
      // through a decode table at $2e6(pc); the buttons are OR'd in above
      // them: $80 from CIA-A PRA bit 7, then $40/$20/$10 from POTINP.
      //
      // The manual contradicts itself here and the binary settles it. Its
      // diagram reads "76543210 / ABCDUDLR", which would put the directions in
      // the low nibble in the order U,D,L,R from bit 3 down — but its value
      // table says 1=up, 2=down, 4=left, 8=right, 16=D, 32=C, 64=B, 128=A.
      // The code ORs $80/$40/$20/$10 for the buttons, so the value table is
      // right and the diagram is written backwards.
      const n = port(int(a[0]!))
      // direction bits are the same encoding AMOS's own Joy() uses
      let v = joyDirections(joyBits(n))
      // A ($80) and C ($20) are one wire read twice, B ($40) and D ($10) the
      // other -- see `buttons`. Note the remap: AMOS's single fire is $10,
      // which is button D's bit here.
      const { red, blue } = buttons(n)
      if (red) v |= 0x80 | 0x20
      if (blue) v |= 0x40 | 0x10
      return VI(v)
    },
    'multi fire'(_, a): Value {
      // =Multi Fire(jport,button) — routine 4 ($368). Note which argument is
      // checked: the routine pops button into d4 and jport into d5, and only
      // d5 gets the `blt`/`bgt` pair. An out-of-range BUTTON therefore falls
      // through every `cmp.w` and returns 0 rather than raising.
      const button = int(a[0]!)
      const n = port(int(a[1]!))
      const { red, blue } = buttons(n)
      // 1 and 3 test the fire wire, 2 and 4 the pot wire; anything else falls
      // through every `cmp.w` and answers 0 rather than raising
      if (button === 1 || button === 3) return VI(red ? -1 : 0)
      if (button === 2 || button === 4) return VI(blue ? -1 : 0)
      return VI(0)
    },
    'stick joy'(_, a): Value {
      // =Stick Joy(jport) — routine 5 ($432), reading CIA-A PRB ($bfe101)
      // bits 0-3 for the directions. That is the parallel-port data register:
      // this is the four-player adaptor, not a normal joystick port.
      port(int(a[0]!))
      return VI(0)
    },
    /**
     * =Stick Left / Right / Up / Down(jport) — routines 12 ($7ee), 13 ($826),
     * 14 ($85e) and 15 ($896), 56 bytes each and identical but for one bit
     * number. Up is the whole shape:
     *
     *     move.l (a3)+, d1
     *     cmp.w  #$0, d1 / blt  -> the error tail at $de6
     *     cmp.w  #$1, d1 / bgt  -> the same
     *     cmp.w  #$1, d1 / beq  .one
     *     btst.b #$0, $bfe101.l      port 0
     *     bne.b  .out
     *     moveq  #$ff, d3            clear means PRESSED
     *  .one: btst.b #$4, $bfe101.l   port 1
     *
     * so port 0 takes bits 0..3 of CIA-A PRB and port 1 bits 4..7, active low.
     * That is the same register and the same split AMCAF's Pjup reads through
     * its own routine 14 — two extensions by different authors, read
     * independently, agreeing bit for bit. The range check is `cmp.w` on a long
     * that was popped whole, so only the low word is examined.
     *
     * NOTE: nothing drives the parallel port here, and an unused one floats
     * high, which is "not pressed" on every line. Answering 0 is what the
     * hardware would give, not a stand-in for it.
     */
    'stick up'(_, a): Value {
      port(int(a[0]!))
      return VI(0)
    },
    'stick down'(_, a): Value {
      port(int(a[0]!))
      return VI(0)
    },
    'stick left'(_, a): Value {
      port(int(a[0]!))
      return VI(0)
    },
    'stick right'(_, a): Value {
      port(int(a[0]!))
      return VI(0)
    },
    'stick fire'(_, a): Value {
      // =Stick Fire(jport) — routine 16 ($8ce), CIA-B PRA bits 0 and 1, which
      // are the parallel port's BUSY and POUT lines.
      //
      // The two-argument form is a deliberate dead end, and the manual owns up
      // to it: "I shouldn't really tell you this ... but if you enter =Stick
      // Fire(Jport,button) it will return an error (This command has been
      // provided so it can be easily updated to handle more buttons in later
      // version)". The binary carries the matching string, "Command not
      // available in this version". So the error is the shipped behaviour, not
      // a gap in this port.
      if (a.length > 1) funcCall()
      port(int(a[0]!))
      return VI(0)
    },
    /**
     * =Stick X / Stick Y(jport) — routines 7 ($4f8) and 8 ($520), and they are
     * not joystick reads at all. Both compute the register the same way:
     *
     *     movea.l #$dff000, a0
     *     move.l  (a3)+, d0
     *     andi.l  #$1, d0            the port, MASKED and not range-checked
     *     asl.l   #$1, d0
     *     addi.l  #$12, d0           $dff012 POT0DAT, $dff014 POT1DAT
     *     move.w  (a0, d0.w), d3
     *
     * and then Stick X keeps the low byte (`andi.l #$ff`) while Stick Y shifts
     * first (`asr.l #$8`). One paddle register holds both axes, X in the low
     * byte and Y in the high, so these are ANALOGUE paddle positions rather
     * than the digital directions Stick Up and friends read off CIA-A PRB.
     *
     * The masking is worth noting because it is the exception: every other
     * keyword here range-checks its port and errors, and these two silently
     * take `jport AND 1`.
     *
     * NOTE: no paddles, so no counts. Both read 0.
     */
    'stick x'(_, a): Value {
      void int(a[0]!)
      return VI(0)
    },
    'stick y'(_, a): Value {
      void int(a[0]!)
      return VI(0)
    },
    'mouse button'(_, a): Value {
      // =Mouse Button(jport) — routine 21 ($ab4). A bitmask, not a button
      // number: `ori.b #$1` for one line and `ori.b #$2` for the other, so 3
      // means BOTH are down. The manual's table calls 3 "Middle Button
      // Pressed", which the code does not support — there is no third line
      // read anywhere in the routine.
      const n = port(int(a[0]!))
      if (n !== 0) {
        // port 1 is the joystick port: its fire lines, not a mouse
        return VI(joyFire(joyBits(PORT_JOYSTICK)) ? 1 : 0)
      }
      return VI(rt.input.mouseK & 3)
    },
    /**
     * =Mouse X(n) and =Mouse Y(n) — the reading forms, against the setters at
     * routines 22 ($b16) and 23 ($b46) which write the same two words at
     * $e(a0) and $16(a0) of the extension's data block.
     *
     * Mouse 0 is the mouse port, so it follows the host pointer; mouse 1 would
     * need a second mouse in the joystick port and holds wherever it was put.
     */
    'mouse x'(_, a): Value {
      const n = port(int(a[0]!))
      if (n === 0) return VI(rt.input.mouseX)
      return VI(rt.sticks.mice[1]!.x)
    },
    'mouse y'(_, a): Value {
      const n = port(int(a[0]!))
      if (n === 0) return VI(rt.input.mouseY)
      return VI(rt.sticks.mice[1]!.y)
    },
    'mouse area'(_, a): Value {
      // =Mouse Area(n) — routine 28 ($c96): reads the tracked pair for that
      // mouse and calls AMOS's own zone test at $48 off the library base.
      // "This function is the same as Mouse Zone in AMOS except Mouse Zone can
      // only read one mouse", so it goes through the same zone lookup here.
      const n = port(int(a[0]!))
      const s = rt.screen
      const mx = n === 0 ? rt.input.mouseX : rt.sticks.mice[1]!.x
      const my = n === 0 ? rt.input.mouseY : rt.sticks.mice[1]!.y
      return VI(rt.hardZoneAt(s, mx, my))
    },
  }
}
