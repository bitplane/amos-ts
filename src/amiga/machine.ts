/**
 * The machine: power, reset, and what survives one.
 *
 * This is the layer *underneath* the interpreter. A `Runtime` is one running
 * AMOS environment; the machine is the thing that environment runs on, and it
 * outlives it — which is the whole point, because a reset destroys the one
 * and not the other.
 *
 * ## Why this exists
 *
 * The port already had four separate answers to "what survives", none of them
 * written down and none aware of the others:
 *
 *   - `Run "file"` chains inside one Runtime: screens survive, variables
 *     reset, banks are replaced (InRun1 +ILib.s:1475)
 *   - `Default` puts back the boot display: every screen closed, screen 0
 *     reopened, and the extensions re-initialise off it (InDefault +Lib.s:8710)
 *   - the web player's `restart()` builds a fresh Runtime and keeps the
 *     filesystem
 *   - its `destroy()` keeps nothing
 *
 * That is a lifecycle, discovered a piece at a time. This names it.
 *
 * ## Reset is a REQUEST, not an action
 *
 * On the machine a reset never returns — `RESET` pulses the line and the next
 * instruction is in Kickstart. Nothing here can do that: a keyword has to
 * unwind the interpreter it is running inside. So a reset keyword records the
 * request and stops the program, and whoever owns the frame loop acts on it.
 *
 * That split is also what keeps this file honest about the layer rule
 * (`layer.test.ts`): performing a reset means starting a program, starting a
 * program needs a Runtime, and nothing in `src/amiga/` may import one. The
 * machine holds the state and the signal; the caller holds the policy. It is
 * the same division `host.ts` already draws — the layer says what is possible,
 * the caller decides what to do about it.
 *
 * ## Cold and warm
 *
 * The distinction is not invented for this port. Craft 1.0 ships both, and its
 * two routines are byte-identical apart from one instruction:
 *
 *     hard reset (188, $3106)   Disable, Supervisor, CLR.L 4.W, RESET, JMP
 *     warm reset (189, $3122)   Disable, Supervisor,           RESET, JMP
 *
 * `clr.l $4.w` wipes ExecBase, so the ROM cannot find the warm-start marker
 * and cold-boots: resident modules, the recoverable RAM disk and anything else
 * that survives a reset are gone. Without it they stay. Misc 1.0's `Reset` is
 * the same technique with its own source to prove it (`Misc_Extension.asm:147`
 * — SuperState, Disable, `CLR.L 4.W`, `LEA $00FC0000,A0`, `RESET`, `JMP (A0)`),
 * and it wipes ExecBase, so it is a cold one.
 *
 * NOTE: the two are recorded and today produce the same observable result,
 * because this port has no reset-survivable state for a warm boot to keep —
 * no resident list, no RAD:. The distinction is modelled rather than
 * synthesised: when there is something for a warm reset to preserve, the
 * keywords already ask for the right one.
 *
 * ## The other reboot keywords
 *
 * Six extensions ship one, and all of them are the same two techniques. AMCAF,
 * Delta, Misc and JD are ported; the rest are recorded here so the next port
 * does not have to redo them:
 *
 *   amcaf 1.40 r203 / 1.50 r215  `Reset Computer`  `cmp.w #$25,d0` on
 *       LIB_VERSION: Kickstart 37+ takes `jmp -$2d6(a6)` — exec ColdReboot —
 *       and below 37 goes Supervisor and hand-rolls it, walking back from
 *       $01000000 by the ROM size at -$14, fetching the initial PC at +4,
 *       backing off two bytes so the `jmp (a0)` is already in the prefetch
 *       queue when the bus goes down, then `RESET` and `jmp (a0)`.
 *   craft 1.0 r188/r189           `Hard Reset` / `Warm Reset`  above.
 *   delta 1.4 r10                 `Delta Reset`  Misc's seven instructions
 *       exactly, ExecBase wipe and all, so cold. Five more of Delta's
 *       routines are Misc's too; see ../runtime/delta.ts.
 *   misc 1.0 r10                  `Reset`  source tier, above. Cold.
 *   jd 5.3 r67                    `Jd Reset`  one instruction, `jmp $fc00d2`
 *       (+|jd.s:3623) — an undocumented fixed address inside Kickstart, valid
 *       for the ROM its author had and nothing else. It does NOT wipe
 *       ExecBase, which is the test used throughout here, so it is the only
 *       WARM one in this list.
 *   the-game 0.9 r4               `G Reboot`  three instructions:
 *       `movea.l $4.w,a6 / jsr -$2d6(a6) / rts`. ColdReboot, no version check.
 *   os-devkit 1.61 r501           `_Cold Reboot`  NOT READ — the extension is
 *       unported and capstone was unavailable; the name and the extension's
 *       shape (thin `_`-prefixed wrappers over exec and dos) say ColdReboot,
 *       but nothing here has looked at the bytes.
 *
 * Two keywords that look like they belong here and do not, both caught by
 * reading rather than by their names: EasyLife's `Elreset` is a jump table
 * dispatcher over 25 of its own subsystems (`cmp.l #$1a` then
 * `subq.w #1 / asl.l #4 / addi.l #$fc` and `jmp (a0)`), and The Game's
 * `G Reset` closes its eight game screens and re-initialises the engine.
 *
 * ## What is plugged in
 *
 * The machine also owns its devices, and that arrived later than the reset
 * state did. The keyboard's held keys and its serial byte, the mouse buttons
 * and the two gameports were fields on `InputState` over in the interpreter,
 * named after the AMOS keywords that read them rather than after the chips
 * they are: `ledFilter` and the FIR0 bit synthesized inside the memory map
 * were two halves of one byte on CIA-A, held apart, and neither name said
 * CIA.
 *
 * `InputState` is still there and every keyword still reads it. It is a view
 * now: `sdr`, `keys`, `mouseK` and `ports` resolve to the devices below, the
 * way `joy` has always resolved to `ports[1]`. What stayed behind is the part
 * that is genuinely the program's rather than the machine's, and the two
 * separate the moment there are two programs: a keystroke exists once, and
 * `Inkey$` CONSUMING it is per program. See `../interp/interp.ts`.
 *
 * ## Not modelled yet
 *
 * Drives. "Insert a disk" is a machine event too and belongs beside these,
 * but nothing asks for it yet: the web player mounts a volume once and never
 * changes it. Adding an eject/insert event with no caller would be guessing
 * at the shape, so the seam is named here and left empty. CIA-A already has
 * the hole it fits: `disk()` answers null and the four status lines read
 * inactive, which is what a machine with no drive selected reports.
 */
import { BattClock } from './battclock'
import { CiaA, CiaB } from './cia'
import { BTN_RED, controllerDevice, newController, type Controller } from './controller'
import type { Device, Slot } from './device'
import { joyDatOf, potgor } from './gameport'
import { Keyboard } from './keyboard'
import { Mouse, mouseAsButtons } from './mouse'
import type { ParallelDevice } from './parallel'
import type { SerialDevice } from './serialport'
import { FloppyDrive, driveName, newDrives } from './trackdisk'

/**
 * What a reset destroys.
 *
 * `cold` wipes everything the machine was holding. `warm` keeps whatever is
 * built to survive a reset — see the header for why the two are distinct and
 * why nothing yet tells them apart.
 */
export type ResetKind = 'cold' | 'warm'

/** whether the machine is running at all */
export type PowerState = 'on' | 'off'

/** a reset that has been asked for and not yet carried out */
export interface ResetRequest {
  kind: ResetKind
  /**
   * What asked — a keyword name, or `'host'` when the page did. Carried so a
   * host can say why the screen went black instead of just doing it.
   */
  by: string
}

/**
 * Power state and a pending reset, and nothing else.
 *
 * One of these outlives the Runtime it is attached to. A caller that wants a
 * reset to be observable across it — the web player, which keeps its
 * filesystem — makes the machine first and hands it to each Runtime it builds.
 * A caller that does not care (the CLI, the census, most tests) gets a fresh
 * one per Runtime and never looks at it.
 */
export class Machine {
  power: PowerState = 'on'

  /** the keyboard's held keys. The byte it clocks out lands in `cia.sdr`. */
  readonly keyboard = new Keyboard()

  /** the three mouse buttons, which are pins on CIA-A and POTGOR */
  readonly mouse = new Mouse()

  /**
   * The two gameports, indexed the way the hardware is: 0 is the mouse port,
   * 1 the joystick port, which is `Joy()`'s numbering too.
   */
  readonly ports: [Controller, Controller] = [newController(), newController()]

  /**
   * CIA-A at $BFE001: the LED and audio filter bit, the two fire buttons, and
   * four floppy status lines with no floppy behind them yet.
   *
   * The wires are supplied here because the chip reads pins and the pins
   * belong to the devices above. FIR0 is the OR of the mouse's left button
   * and port 0's fire, which is a DEVIATION this machine forces by holding
   * both at once. ./mouse.ts sets out why and what removes it.
   */
  readonly cia = new CiaA({
    fire0: () => (this.portButtons(0) & BTN_RED) !== 0,
    fire1: () => (this.portButtons(1) & BTN_RED) !== 0,
    disk: () => {
      // the lines belong to whichever unit CIA-B port B has pulled low, and
      // to none of them when it has pulled none: an Amiga with every /SELn
      // high reads all four inactive. `cia.i`:133-136.
      const n = this.ciab.selected
      return n === null ? null : (this.drives[n]?.lines() ?? null)
    },
    parallel: () => this.parallel?.lines() ?? null,
  })

  /**
   * The four floppy drives, DF0: to DF3:.
   *
   * Four because CIA-B port B has four /SELn lines and a fifth drive has no
   * wire to be selected by. They are always present and usually empty, which
   * is the distinction ./trackdisk.ts exists to draw: a drive is a slot and a
   * disk is what goes in it, and the port had only ever had the disk.
   */
  readonly drives: FloppyDrive[] = newDrives()

  /**
   * CIA-B: the printer and serial handshake lines, and the four drive control
   * lines.
   *
   * Nothing reads the drive lines yet, and six keywords WRITE them. That is
   * the right way round for a slice: the register is the shared thing, and
   * what it controls arrives when there is a drive to control.
   */
  readonly ciab = new CiaB({
    parallel: () => this.parallel?.lines() ?? null,
    serial: () => this.serial?.lines() ?? null,
  })

  /**
   * What is on the parallel port, or null for an empty connector.
   *
   * A four-player joystick adaptor and a printer are both `./parallel.ts`,
   * and they are the same eleven pins read two ways: the adaptor's two extra
   * fire buttons ARE the printer's BUSY and SELECT lines.
   */
  parallel: ParallelDevice | null = null

  /** what is on the serial port, or null for an empty connector */
  serial: SerialDevice | null = null

  constructor() {
    // the keyboard's serial line into CIA-A, which is the only thing that
    // writes SDR
    this.keyboard.onByte = (b) => {
      this.cia.sdr = b
    }
  }

  /**
   * Every button held on one connector, in `./controller.ts`'s packing.
   *
   * The one place the port-0 DEVIATION is resolved: a mouse and `ports[0]`
   * are both on that connector here, so their buttons meet, and every pin
   * reader below asks this instead of picking one of the two. Which pin each
   * bit reaches is `./cia.ts` for RED and `./gameport.ts` for the rest.
   */
  portButtons(port: 0 | 1): number {
    const c = this.ports[port].buttons
    return port === 0 ? c | mouseAsButtons(this.mouse) : c
  }

  /**
   * JOY0DAT or JOY1DAT, the counters that port's device drives.
   *
   * Port 0 answers for the MOUSE and port 1 for the stick, which is a stock
   * Amiga and is what all three extensions that read these registers already
   * assumed with a private copy of this line each. The port-0 deviation shows
   * here as well: a controller in `ports[0]` drives `Joy(0)` and does not
   * appear in JOY0DAT, because the connector cannot really hold both.
   */
  joyDat(port: 0 | 1): number {
    return port === 0 ? this.mouse.dat() : joyDatOf(this.ports[1])
  }

  /** POTGOR at $DFF016: pins 5 and 9 of both connectors */
  potgor(): number {
    return potgor(this.portButtons(0), this.portButtons(1))
  }

  /**
   * What is plugged in, for a caller drawing the tree.
   *
   * A description and not a registry: the devices live in the typed fields
   * above, because code that wants a controller wants `ports[1]` and not a
   * lookup by string that could name a socket which is not there. Same
   * relationship `InputState.joy` has to `ports[1]`.
   */
  hardware(): Slot[] {
    return [
      { id: 'clock', label: 'battery clock', takes: 'clock', device: this.battclock },
      { id: 'keyboard', label: 'keyboard', takes: 'keyboard', device: this.keyboard },
      // `mouse` and `port0` are one nine-pin connector on the machine and two
      // rows here, which is the deviation ./mouse.ts describes shown rather
      // than hidden: a tree that listed one of them would be claiming a
      // choice this port has not made yet.
      { id: 'mouse', label: 'gameport 0 (mouse)', takes: 'gameport', device: this.mouse },
      { id: 'port0', label: 'gameport 0', takes: 'gameport', device: controllerDevice(this.ports[0]) },
      { id: 'port1', label: 'gameport 1', takes: 'gameport', device: controllerDevice(this.ports[1]) },
      { id: 'par', label: 'parallel port', takes: 'parallel', device: this.parallel },
      { id: 'ser', label: 'serial port', takes: 'serial', device: this.serial },
      // a drive is fitted whether or not a disk is in it, so the DEVICE is
      // the drive. What is IN it is the volume, which is the other node type
      // AmigaDOS keeps for exactly this reason -- see ./trackdisk.ts.
      ...this.drives.map((d) => ({
        id: driveName(d.unit).toLowerCase(),
        label: `${driveName(d.unit)}:`,
        takes: 'floppy' as const,
        device: d as Device,
      })),
    ]
  }

  /**
   * The battery clock at $DC0000, if one is fitted, and here one always is.
   *
   * The strongest case there is for a Machine field: the chip has its own
   * battery, so it keeps time with the power off, and a reset is not even the
   * event it is built to survive. Two extensions poke it directly, Explode's
   * four `Hard` keywords and JD's `Jd Setclock` / `Jd Setdate` / `Jd Time$`.
   * See ./battclock.ts for the register map and what does NOT read it.
   */
  readonly battclock = new BattClock()

  /**
   * `RNF_WILDSTAR` — whether `*` is a synonym for `#?` in DOS patterns.
   *
   * A GLOBAL AmigaDOS setting and not an extension's private flag, which is
   * why it lives here rather than on a port. JD-K3's `Jd Star Joker On` is
   * sixteen bytes and all of them are reaching for it:
   *
   *     movea.l $2b8(a5), a0      DOSBase
   *     movea.l $22(a0), a0       dl_Root, the RootNode
   *     bset.b  #$18, $34(a0)     rn_Flags, bit 24 -- RNF_WILDSTAR
   *
   * (`bset` on memory is byte-sized and takes the bit modulo 8, so bit 24 of
   * the longword is bit 0 of the byte at +$34, which is its most significant
   * on a big-endian machine. Off is `bclr` and nothing else.)
   *
   * Everything that parses a pattern consults it, so turning it on for JD-K3
   * turns it on for LDos's `Lwild` too -- one machine, one RootNode. It is a
   * Machine field for the same reason the power state is: it outlives the
   * Runtime, and a caller that keeps a machine across programs keeps this.
   *
   * Off at boot, which the K3 manual says of `*` in as many words: "not
   * available by default in 2.0. Available as an option that can be turned on."
   */
  wildStar = false

  private request: ResetRequest | null = null

  /**
   * Ask for a reset. The program is expected to stop immediately afterwards —
   * on the real machine the keyword never returns — but stopping it is the
   * caller's job, because that needs the interpreter.
   *
   * A second request does not replace the first. The machine is already on its
   * way down and the first one is what took it there; overwriting would let a
   * warm reset quietly downgrade a cold one that had already been asked for.
   */
  requestReset(kind: ResetKind, by: string): void {
    if (this.request === null) this.request = { kind, by }
  }

  /** what is pending, without consuming it */
  get pendingReset(): ResetRequest | null {
    return this.request
  }

  /**
   * Take the pending reset, clearing it.
   *
   * Read-and-clear rather than a callback: the owner of the frame loop decides
   * *when* the machine comes back, and a callback fired from inside a keyword
   * would tear down the interpreter that is still on the stack.
   */
  takeReset(): ResetRequest | null {
    const r = this.request
    this.request = null
    return r
  }

  /** power down: nothing comes back until a caller powers it on again */
  powerOff(by: string): void {
    this.power = 'off'
    this.requestReset('cold', by)
  }

  /** what a fresh boot looks like, for a caller reusing one machine */
  powerOn(): void {
    this.power = 'on'
    this.request = null
  }
}
