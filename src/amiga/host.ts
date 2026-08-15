/**
 * The host boundary: everything the virtual Amiga needs from the world
 * outside itself.
 *
 * This is one object rather than a scattering of options for a reason that
 * matters more than tidiness. The corpus census has to be reproducible, and
 * that guarantee is only as good as the weakest keyword handler — one stray
 * `Date.now()` anywhere in the runtime silently breaks it. Collecting every
 * outside-world capability here turns "is a headless run reproducible?" into
 * a question answered by reading a single file, and by checking that the
 * census pins the one capability that varies (the clock).
 *
 * It also names the emulation boundary explicitly, and that list is the same
 * list as the `n/a` keyword classifications — they are two views of one fact.
 * A keyword is n/a because it needs something the host cannot give it.
 */
import type { AmosFS } from './fs'

import { dateToStamp, type DateStamp } from './datestamp'

export type { DateStamp } from './datestamp'
import type { ProcessHost } from './process'
import type { Language } from './language'
export type { ProcessHost, ExecuteRequest, LaunchRequest } from './process'

/**
 * Where sound goes. Paula's four voices, as the outside world has to receive
 * them: signed 8-bit PCM with a period-derived rate, a volume and a loop
 * region.
 *
 * A host capability like `clock` and `serial`, and here for the same reason —
 * a headless run records the event stream, a browser feeds Web Audio, and the
 * runtime cannot tell which it has. The implementations live with their
 * callers: `NullAudio` in ./paula.ts records for the player tests,
 * the browser one in ../web/audio.ts.
 */
export interface AudioSink {
  /**
   * (Re)trigger voice 0-3: signed 8-bit PCM at freqHz, volume 0-63. After
   * the first pass, playback repeats [loopStart, loopEnd) (AUDxLC/LEN
   * relatch); loopStart -1 = one-shot. loopEnd defaults to pcm.length.
   */
  play(voice: number, pcm: Int8Array, freqHz: number, volume63: number, loopStart: number, loopEnd?: number): void
  stop(voice: number): void
  setVolume(voice: number, volume63: number): void
  /** per-tick rate change (AUDxPER write) without retriggering */
  setFrequency(voice: number, freqHz: number): void
  /** re-point the repeat region of the playing sample; loopStart -1 = play out and stop */
  setLoop(voice: number, loopStart: number, loopEnd?: number): void
  /**
   * Replace the bytes of the LOOPING sample without restarting it.
   *
   * What a synth replayer does every frame: THX keeps a 640-byte chip buffer
   * per voice looping forever and overwrites its contents when the waveform
   * changes, so the phase runs on unbroken (`$1618` of `AMOSPro_Jotre.Lib`
   * rewrites the buffer in place and never touches the DMA bit). `play()`
   * cannot express that — it restarts from sample 0, which at fifty waveform
   * changes a second is a click each time.
   *
   * Optional because only `thxplay.ts` needs it. A sink that leaves it out
   * gets the sequencing and the volumes and a waveform that never changes,
   * which is wrong but not silent.
   */
  setWaveform?(voice: number, pcm: Int8Array): void
  /**
   * Run output forward to `t` seconds, so that the writes after this call
   * happen THEN and not at the top of the frame.
   *
   * Every other method here says what changed and none said when, which is
   * enough for a sink that hands four voices to somebody else's mixer and not
   * enough for one that renders. MED's CIA interrupt fires between 24 and 500
   * times a second (`runtime/med.ts`), so a frame holds anywhere from a
   * fraction of a tick to ten of them, and the sound is different depending on
   * where inside the frame each one landed.
   *
   * `t` is seconds since the run started, monotonic and shared by every
   * caller. A replayer with sub-frame timing names each tick's instant;
   * `Runtime.frame()` closes the frame at the end. A time already passed is a
   * no-op, which is what happens when two interrupts write out of order.
   *
   * Optional, and absent means the old behaviour exactly: everything in a
   * frame happens at once. `WebAudioSink` schedules Web Audio nodes and has
   * its own clock, so it does not implement this.
   */
  runTo?(t: number): void
  /** the power-LED low-pass filter ($BFE001 bit 1); on = filter engaged */
  setFilter(on: boolean): void
}

/**
 * Wall-clock time. Deliberately separate from AMOS's `Timer`, which counts
 * vertical blanks and is already deterministic.
 */
export interface Clock {
  now(): DateStamp
}

/**
 * A frozen clock, for callers that need a reproducible run — the corpus
 * census passes one. NOT the default: see defaultHost().
 *
 * The date is a plausible one rather than the epoch on purpose: with days=0
 * every date path formats as 780101 and the interesting code — month and
 * year rollover, two-digit year truncation — never runs. This is 12 July
 * 1994, 14:30:00, comfortably inside the era the corpus comes from.
 */
export const FIXED_DATE: DateStamp = { days: 6036, mins: 870, ticks: 0 }

export const fixedClock = (at: DateStamp = FIXED_DATE): Clock => ({ now: () => ({ ...at }) })

/** A real clock. The default — see defaultHost(). */
export const systemClock = (): Clock => ({
  now: (): DateStamp => dateToStamp(new Date()),
})

/**
 * The language locale.library answers from, or `null` for english.
 *
 * A machine-level setting and not a per-program one, exactly like `clock`:
 * on an Amiga it is Locale prefs, set once and read by everything. English is
 * the default because it is the one language this port has WITHOUT a file --
 * localelib.gen.ts carries it, extracted from AROS -- so a host that says
 * nothing behaves as it always has.
 *
 * Deliberately a parsed `Language` and not a name or a path. Resolving
 * "deutsch" to `LOCALE:Languages/deutsch.language` is the caller's business,
 * the way choosing a clock is; this layer only needs the words. See
 * ./language.ts for the reader.
 *
 * NOT taken from `navigator.language`, and that is the whole point of putting
 * it here. host.ts exists so a census run is reproducible, and a date that
 * moved with the machine running the suite would break exactly what this
 * boundary protects. A user who wants their own locale sets it explicitly.
 */
export type { Language } from './language'

/**
 * Why a capability is unavailable — the distinction the `n/a` classification
 * could not previously express.
 *
 * `impossible` means no host could supply it here: raw exec device I/O
 * against trackdisk.device, an ARexx message port, launching a 68k
 * executable. `absent` means this particular host does not, but another
 * could — printer output means nothing headless yet a browser could open a
 * print dialog, and Web Serial exists.
 */
export type Unavailable = 'impossible' | 'absent'

export interface Host {
  /** file provider (Load Iff, Open In, the LDos channels, ...) */
  fs?: AmosFS
  /** sound output; defaults to a recording NullAudio */
  audio?: AudioSink
  /** mirror of all console text, for transcripts and CLIs */
  onText?: (text: string) => void
  /** wall-clock time; a real one by default, see defaultHost() */
  clock: Clock
  /**
   * the language locale.library answers from; english when absent, and never
   * inferred from the browser — see the note above `Unavailable`
   */
  language?: Language | null
  /**
   * Printer sink. AMOS's Lprint/Ldir and JD's 63 Prt keywords write here.
   * Absent rather than impossible: there is no printer in a headless run,
   * but a browser could open a print dialog.
   */
  printer?: (text: string) => void
  /**
   * Graphics printer sink — a rendered page from `Printer Dump`.
   *
   * Separate from `printer` above because they are genuinely different
   * devices' worth of work: that one is a character stream (Lprint, JD's Prt
   * keywords), this is printer.device's PRD_DUMPRPORT, which rasterises a
   * screen region. A host that can do one may not do the other.
   *
   * Absent rather than impossible: nothing to print to headless, but a
   * browser can render the page to a canvas and open the print dialog.
   */
  printerPage?: (page: PrinterPage) => void
  /**
   * Real serial ports, when the host has any (Web Serial in the browser).
   *
   * Optional at two levels, and that is deliberate. A host may have no
   * serial support at all, and a host that does may have no port granted
   * yet — `open` returns null for the second case. Neither makes `Serial
   * Open` fail, because on a real Amiga serial.device opens whether or not
   * a cable is plugged in; without a port the modelled one stands in and
   * the program sees a connection with nothing on the other end.
   */
  serial?: SerialHost
  /**
   * Starting a program that is not this one — `Execute()` a shell command, or
   * LoadSeg+CreateProc a binary. See ./process.ts for the two calls and the
   * six keywords that want them.
   *
   * Absent rather than impossible, and by some distance the clearest case of
   * that distinction in this interface: a browser tab has no subprocesses at
   * all, while the CLI tools and the census run under Node, where it is an
   * ordinary thing to do. Nothing supplies one today, and every caller takes
   * its own failure branch when nothing does.
   */
  process?: ProcessHost
  /**
   * A public exec message port another task published, found by name.
   *
   * One caller so far and it is a whole extension: MAXS Door Handler 0.20's
   * `M_PortOpen(node)` does `FindPort("DoorControlN")` and every one of its
   * other twenty keywords is a `PutMsg`/`WaitPort`/`GetMsg` round trip on
   * whatever it found. Nothing else on this machine publishes a port, so a
   * host without this is an Amiga with the BBS not running — which the
   * extension's author specified completely, since every routine tests
   * `MAXDoorPort` for zero and returns zero without sending.
   *
   * The name is the whole address, as `FindPort` takes it. `send` gets the
   * message BYTES and replies in place, because that is what a reply is here:
   * the sender's own 106 bytes come back with `Command` and `Data` written
   * over.
   */
  ports?: PortHost
}

/** Public message ports, by the name `FindPort` looks them up under. */
export interface PortHost {
  /** `FindPort(name)` — undefined when no task has published that name */
  find?(name: string): PortHandle | undefined
}

/** A public port that will take a message and reply to it. */
export interface PortHandle {
  /**
   * `PutMsg` then the sender's `WaitPort`/`GetMsg`, as one call.
   *
   * Splitting them would model a wait this port cannot perform: there is one
   * thread here and it has to return to the frame loop, which is the same
   * limit MUI's `Wait()` runs into. A door blocks on its reply and does
   * nothing else while it waits, so collapsing the round trip loses nothing a
   * program could observe.
   */
  send(message: Uint8Array): void
}

/** A serial port the host has opened on the program's behalf. */
export interface SerialPortHandle {
  /**
   * Queue bytes for transmission. Deliberately not a promise: AMOS's Serial
   * Send goes through Dev.SendIO and returns before the transfer completes,
   * so fire-and-forget is the faithful shape rather than a convenience.
   */
  write(bytes: Uint8Array): void
  /** Take everything that has arrived since the last call. */
  read(): number[]
  /** SDCMD_SETPARAMS — Serial Speed/Bits/Parity/X/Buf/Fast/Slow all land here. */
  setParams(params: SerialLineParams): void
  close(): void
}

/**
 * The line settings, in the vocabulary both sides share. AMOS pokes these
 * into an IOExtSer request; Web Serial takes them as `port.open()` options.
 */
export interface SerialLineParams {
  baud: number
  dataBits: number
  stopBits: number
  parity: 'none' | 'even' | 'odd' | 'space' | 'mark'
  /** SERB_7WIRE — RTS/CTS handshaking */
  rtsCts: boolean
  /** IO_RBUFLEN */
  bufLen: number
}

export interface SerialHost {
  /**
   * Open the unit'th port the user has already granted, or null if there is
   * none. Must not prompt: a program calling Serial Open has no user gesture
   * behind it, and Web Serial's requestPort() requires one. Granting is the
   * host UI's job, and getPorts() afterwards needs no gesture.
   */
  open(unit: number, params: SerialLineParams): SerialPortHandle | null
}

/**
 * One `Printer Dump`, rasterised and ready for a page.
 *
 * The geometry is reported as the source computes it rather than resolved
 * here, because how a dump lands on paper is the printer driver's decision
 * on a real machine too — SPECIAL_FRACCOLS means "this fraction of the
 * printable width", and only the driver knows how wide that is.
 */
export interface PrinterPage {
  /** the region's pixels, RGBA, `width` * `height` * 4 */
  pixels: Uint8ClampedArray
  width: number
  height: number
  /** where on the screen the region came from */
  srcX: number
  srcY: number
  /**
   * printer.device's `special` word: ASPECT $80, FULLROWS $08, FULLCOLS $04,
   * FRACROWS $20, FRACCOLS $10, CENTER $40, MILROWS $02, MILCOLS $01.
   */
  special: number
  /**
   * destCols/destRows as the source leaves them. With FRACCOLS/FRACROWS set
   * these are 16.16 fixed point — the top word is the fraction of the page —
   * which is why they are handed over raw rather than as pixel counts.
   */
  destCols: number
  destRows: number
}

/**
 * Every capability at its default.
 *
 * The clock is a REAL one. A machine whose calendar is stuck in 1994 is a
 * broken machine, and the default has to be right for the person embedding
 * the runtime rather than for our own test harness.
 *
 * Who actually reads it is narrower than it looks: core AMOS Professional
 * has no date or time keyword at all -- `Timer` counts vertical blanks and
 * is deterministic by nature. The clock reaches BASIC only through LDos
 * (`Lsys Stamp`, `Lsys Time`, `Ldate`) and through file datestamps. So this
 * matters to a program using LDos or listing a directory, and to nothing
 * else.
 *
 * Reproducibility is still required, but it belongs to the tool that needs
 * it rather than to everybody else: src/cli/runreport.ts passes fixedClock()
 * explicitly, because a census whose results depend on the day it ran is
 * worthless. That used to be arranged by making the default frozen, which
 * got it backwards -- the census was silently relying on a global default,
 * and every other caller paid for it.
 *
 * Everything else stays absent by default, since a capability the host does
 * not have cannot be conjured.
 */
export function defaultHost(): Host {
  return { clock: systemClock() }
}
