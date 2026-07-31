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

/**
 * Where sound goes. Paula's four voices, as the outside world has to receive
 * them: signed 8-bit PCM with a period-derived rate, a volume and a loop
 * region.
 *
 * A host capability like `clock` and `serial`, and here for the same reason —
 * a headless run records the event stream, a browser feeds Web Audio, and the
 * runtime cannot tell which it has. The implementations live with their
 * callers: `NullAudio` in ../runtime/audio.ts records for the player tests,
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
