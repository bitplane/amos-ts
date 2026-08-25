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
 *     reset, banks are replaced (InRun1 +ILib.s:1446)
 *   - `Default` puts back the boot display: every screen closed, screen 0
 *     reopened, and the extensions re-initialise off it (InDefault +Lib.s:8681)
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
 * ## Attaching and detaching
 *
 * `hardware()` describes the tree and `attach`/`detach` change it, both keyed
 * by the slot id the description carries. The typed fields stay the truth:
 * code that wants drive 2 writes `machine.drives[2]`, and the string-keyed
 * pair exists for a caller holding an id it read out of a slot — which is
 * every hardware page there will ever be.
 *
 * `Slot.fixed` marks the connectors that cannot be emptied, so a page can
 * leave the control off rather than find out by being told no. It means "this
 * machine does not run without one" and not "the host owns it": the keyboard
 * comes out, because an A500's is a separate assembly on a ribbon and every
 * other model's is on a cable.
 *
 * The processor and Paula are fixed, and both can still be SWAPPED: fixed
 * means the socket cannot be emptied, not that it cannot change, which is
 * what an accelerator is.
 *
 * ## Not modelled yet
 *
 * Change notification. Nothing here fires an event when a disk goes in or a
 * controller is swapped, so a page that draws the tree redraws it from
 * `hardware()` rather than being told. That is enough for a frame loop and it
 * is guessing at the shape for anything else.
 */
import { PaulaAudio } from './audio'
import { BattClock } from './battclock'
import { CiaA, CiaB } from './cia'
import { Cpu, M68000 } from './cpu'
import { BTN_RED, CTRL_NONE, Controller, controllerDevice, newController } from './controller'
import type { Device, Slot } from './device'
import { joyDatOf, mouseDat, potgor } from './gameport'
import { Keyboard } from './keyboard'
import { Mouse, mouseAsButtons } from './mouse'
import { ParallelDevice } from './parallel'
import { SerialDevice } from './serialport'
import { TD_UNITS, FloppyDrive, driveName, driveUnit, newDrives } from './trackdisk'

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

  /**
   * The keyboard's held keys. The byte it clocks out lands in `cia.sdr`.
   *
   * Null is a real state and not a defensive one. An A500's keyboard is a
   * separate assembly on a ribbon to the motherboard and every other model's
   * is on a cable, so unplugging one is a thing people did; and from this
   * port's side the slot holds whatever supplies the keystrokes, which is a
   * browser today and could be a shell or a script later.
   */
  keyboard: Keyboard | null = new Keyboard()

  /**
   * The mouse, or null with nothing on the connector.
   *
   * `X Mouse`, `Y Mouse` and `Mouse Key` already read this object rather than
   * a copy — `InputState`'s three accessors resolve here — so unplugging it
   * stops the pointer for the keywords and for the registers at once, which
   * is the only version of "detached" worth having.
   */
  mouse: Mouse | null = new Mouse()

  /**
   * Where the counters are, which is not the same as where the mouse is.
   *
   * A mouse sends quadrature pulses and holds no position at all; the count
   * lives in Denise and is what JOY0DAT reads. So unplugging one leaves the
   * pointer exactly where it was rather than teleporting it, and this is the
   * pair that survives. `Mouse.x`/`y` stay the host's way of driving it.
   */
  private counters: [number, number] = [128 + 160, 50 + 100]

  /** the pointer, whether or not a mouse is on the end of it */
  get mouseX(): number {
    return this.mouse ? this.mouse.x : this.counters[0]
  }

  set mouseX(v: number) {
    if (this.mouse) this.mouse.x = v
    this.counters[0] = v
  }

  get mouseY(): number {
    return this.mouse ? this.mouse.y : this.counters[1]
  }

  set mouseY(v: number) {
    if (this.mouse) this.mouse.y = v
    this.counters[1] = v
  }

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
   * The floppy drives, DF0: to DF3:, indexed by unit.
   *
   * Four positions because CIA-B port B has four /SELn lines and a fifth
   * drive has no wire to be selected by. A null is a unit with no drive on
   * its line, which is most Amigas: an A500 shipped with DF0: alone. All four
   * are fitted here because a port with every drive is the useful default and
   * `Machine.detach` is how a host says otherwise.
   *
   * A drive with no disk in it is a drive, not a null. That is the
   * distinction ./trackdisk.ts exists to draw, and the difference Explode's
   * `=Drive State` reports as 0 against -1.
   */
  readonly drives: (FloppyDrive | null)[] = newDrives()

  /**
   * CIA-B: the printer and serial handshake lines, and the four drive control
   * lines.
   *
   * Six keywords write the drive lines and now four drives listen to them:
   * a write that pulls a /SELn low hands /MTR to that unit, which is the one
   * output in `CiaBWires` and the reason `Poke $BFD100,$77` spins DF0.
   */
  readonly ciab = new CiaB({
    parallel: () => this.parallel?.lines() ?? null,
    serial: () => this.serial?.lines() ?? null,
    motor: (unit, on) => {
      const d = this.drives[unit]
      if (d) d.motorOn = on
    },
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

  /**
   * The processor.
   *
   * Never null: a machine with no CPU is not a machine with a part missing. It
   * executes nothing here, and ./cpu.ts says at length why that is a decision
   * rather than an omission.
   */
  cpu: Cpu = new M68000()

  /** Paula's audio half, and which model's analog stage is after it */
  readonly audio = new PaulaAudio()

  constructor() {
    this.wireKeyboard(this.keyboard)
  }

  /**
   * The keyboard's serial line into CIA-A, which is the only thing that writes
   * SDR.
   *
   * Unwiring on the way out matters: a caller that keeps the keyboard it
   * detached would otherwise still be clocking bytes into a machine it is no
   * longer plugged into.
   */
  private wireKeyboard(kb: Keyboard | null): void {
    if (this.keyboard && this.keyboard !== kb) this.keyboard.onByte = null
    this.keyboard = kb
    if (kb) {
      kb.onByte = (b) => {
        this.cia.sdr = b
      }
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
    return port === 0 && this.mouse ? c | mouseAsButtons(this.mouse) : c
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
    // the counters keep their value with nothing plugged in, so this reads the
    // pair rather than the device
    return port === 0 ? mouseDat(this.mouseX, this.mouseY) : joyDatOf(this.ports[1])
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
      { id: 'cpu', label: 'processor', takes: 'cpu', device: this.cpu, fixed: true },
      { id: 'audio', label: 'audio', takes: 'audio', device: this.audio, fixed: true },
      { id: 'clock', label: 'battery clock', takes: 'clock', device: this.battclock, fixed: false },
      { id: 'keyboard', label: 'keyboard', takes: 'keyboard', device: this.keyboard, fixed: false },
      // `mouse` and `port0` are one nine-pin connector on the machine and two
      // rows here, which is the deviation ./mouse.ts describes shown rather
      // than hidden: a tree that listed one of them would be claiming a
      // choice this port has not made yet.
      { id: 'mouse', label: 'gameport 0 (mouse)', takes: 'gameport', device: this.mouse, fixed: false },
      {
        id: 'port0',
        label: 'gameport 0',
        takes: 'gameport',
        device: controllerDevice(this.ports[0]),
        fixed: false,
      },
      {
        id: 'port1',
        label: 'gameport 1',
        takes: 'gameport',
        device: controllerDevice(this.ports[1]),
        fixed: false,
      },
      { id: 'par', label: 'parallel port', takes: 'parallel', device: this.parallel, fixed: false },
      { id: 'ser', label: 'serial port', takes: 'serial', device: this.serial, fixed: false },
      // a drive is fitted whether or not a disk is in it, so the DEVICE is
      // the drive. What is IN it is the volume, which is the other node type
      // AmigaDOS keeps for exactly this reason -- see ./trackdisk.ts. The
      // four rows are the four /SELn lines and are always all here; the drive
      // on the end of one is what comes and goes, because an A500 shipped
      // with DF0: alone and the other three were things you bought.
      ...Array.from({ length: TD_UNITS }, (_, unit) => ({
        id: driveName(unit).toLowerCase(),
        label: `${driveName(unit)}:`,
        takes: 'floppy' as const,
        device: (this.drives[unit] ?? null) as Device | null,
        fixed: false,
      })),
    ]
  }

  /** the connector with this id, or null if the machine has no such thing */
  slot(id: string): Slot | null {
    return this.hardware().find((s) => s.id === id) ?? null
  }

  /**
   * Put a device in a connector.
   *
   * False when there is no such connector, or when the device does not fit —
   * a `takes` of `floppy` will not accept a mouse, which is the point of the
   * field.
   *
   * `Slot.fixed` is NOT checked here, and that is the difference between the
   * two verbs. Fixed means the socket cannot be EMPTIED, not that it cannot be
   * changed: an accelerator is the processor slot with a different chip in it,
   * and refusing that would be modelling a machine nobody sold.
   * Attaching to an occupied socket REPLACES what was there, because
   * swapping a joystick for a pad is one action on the page and should not
   * need two calls.
   *
   * The typed fields stay the truth. This is the string-keyed way in, for a
   * caller holding a slot id it read out of `hardware()`; code that knows it
   * wants drive 2 still writes `machine.drives[2]`.
   */
  attach(id: string, device: Device): boolean {
    const slot = this.slot(id)
    if (!slot || device.kind !== slot.takes) return false
    if (id === 'port0' || id === 'port1') {
      if (!(device instanceof Controller)) return false
      this.ports[id === 'port0' ? 0 : 1] = device
      return true
    }
    if (id === 'par') {
      if (!(device instanceof ParallelDevice)) return false
      this.parallel = device
      return true
    }
    if (id === 'ser') {
      if (!(device instanceof SerialDevice)) return false
      this.serial = device
      return true
    }
    if (id === 'keyboard') {
      if (!(device instanceof Keyboard)) return false
      this.wireKeyboard(device)
      return true
    }
    if (id === 'clock') {
      if (!(device instanceof BattClock)) return false
      this.battclock = device
      return true
    }
    if (id === 'mouse') {
      if (!(device instanceof Mouse)) return false
      // a mouse plugged in takes the counters where they were left, because
      // that is where the pointer is on the screen
      device.x = this.counters[0]
      device.y = this.counters[1]
      this.mouse = device
      return true
    }
    // fixed, so `slot.fixed` above has already refused a detach; swapping the
    // chip for another is still allowed, which is what an accelerator is
    if (id === 'cpu') {
      if (!(device instanceof Cpu)) return false
      device.ignoreClock = this.cpu.ignoreClock
      this.cpu = device
      return true
    }
    const unit = driveUnit(id)
    if (unit === null || !(device instanceof FloppyDrive)) return false
    this.drives[unit] = device
    return true
  }

  /**
   * Empty a connector, and hand back what was in it.
   *
   * Null when there was nothing there, when the id is unknown, and when the
   * slot is fixed. A gameport empties to a `CTRL_NONE` controller rather than
   * to nothing, because something has to answer the pins and `CTRL_NONE` is
   * what an unconnected port reports.
   */
  detach(id: string): Device | null {
    const slot = this.slot(id)
    if (!slot || slot.fixed || !slot.device) return null
    const was = slot.device
    if (id === 'port0' || id === 'port1') this.ports[id === 'port0' ? 0 : 1] = new Controller(CTRL_NONE)
    else if (id === 'par') this.parallel = null
    else if (id === 'ser') this.serial = null
    else if (id === 'keyboard') this.wireKeyboard(null)
    else if (id === 'clock') this.battclock = null
    else if (id === 'mouse') {
      this.counters = [this.mouse!.x, this.mouse!.y]
      this.mouse = null
    }
    else {
      const unit = driveUnit(id)
      if (unit === null) return null
      this.drives[unit] = null
    }
    return was
  }

  /**
   * The battery clock at $DC0000, or null with no board fitted.
   *
   * Null is the commonest Amiga there was. A stock A500 has no clock at all
   * and neither does an A1000, which the corpus says in a startup-sequence's
   * own comment: "SetClock load ;load system time from real time clock (A1000
   * owners should" / "replace the SetClock load with Date"
   * (`sources/amos-pd-library-cd-1994/files/S/Startup1.3:12`). The chip has
   * its own battery, so with one fitted it keeps time through a power cut and
   * a reset is not even the event it is built to survive.
   *
   * Two extensions poke it directly, Explode's four `Hard` keywords and JD's
   * `Jd Setclock` / `Jd Setdate` / `Jd Time$`. See ./battclock.ts for the
   * register map, what does NOT read it, and what those keywords do when the
   * board is absent.
   */
  battclock: BattClock | null = new BattClock()

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
