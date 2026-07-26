/**
 * The host boundary: everything the virtual Amiga needs from the world
 * outside itself.
 *
 * This is one object rather than a scattering of options for a reason that
 * matters more than tidiness. The corpus census has to be reproducible, and
 * that guarantee is only as good as the weakest keyword handler — one stray
 * `Date.now()` anywhere in the runtime silently breaks it. Collecting every
 * outside-world capability here, each with a deterministic default, turns
 * "is a headless run reproducible?" into a question answered by reading a
 * single file.
 *
 * It also names the emulation boundary explicitly, and that list is the same
 * list as the `n/a` keyword classifications — they are two views of one fact.
 * A keyword is n/a because it needs something the host cannot give it.
 */
import type { AmosFS } from './fs'
import type { AudioSink } from './audio'

/**
 * An AmigaDOS DateStamp. This is the shape AmigaDOS itself uses and the
 * currency every dated thing in the system speaks: `Lsys Stamp`, `Lsys Time`,
 * `Lset File Date` and the datestamp on every file all want exactly this.
 */
export interface DateStamp {
  /** days since 1 January 1978 */
  days: number
  /** minutes since midnight */
  mins: number
  /** ticks elapsed in the current minute, at 1/50 s — a vertical blank */
  ticks: number
}

/**
 * Wall-clock time. Deliberately separate from AMOS's `Timer`, which counts
 * vertical blanks and is already deterministic.
 */
export interface Clock {
  now(): DateStamp
}

/**
 * A fixed clock. The default, so headless runs are reproducible.
 *
 * The date is a plausible one rather than the epoch on purpose: with days=0
 * every date path formats as 780101 and the interesting code — month and
 * year rollover, two-digit year truncation — never runs. This is 12 July
 * 1994, 14:30:00, comfortably inside the era the corpus comes from.
 */
export const FIXED_DATE: DateStamp = { days: 6036, mins: 870, ticks: 0 }

export const fixedClock = (at: DateStamp = FIXED_DATE): Clock => ({ now: () => ({ ...at }) })

/** A real clock, for a host that has one (the browser wires this up). */
export const systemClock = (): Clock => ({
  now(): DateStamp {
    const d = new Date()
    const utcMidnight = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
    const days = Math.floor((utcMidnight - Date.UTC(1978, 0, 1)) / 86_400_000)
    const mins = d.getHours() * 60 + d.getMinutes()
    return { days, mins, ticks: Math.floor((d.getSeconds() * 1000 + d.getMilliseconds()) / 20) }
  },
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
  /** wall-clock time; defaults to FIXED_DATE so runs stay reproducible */
  clock: Clock
  /**
   * Printer sink. AMOS's Lprint/Ldir and JD's 63 Prt keywords write here.
   * Absent rather than impossible: there is no printer in a headless run,
   * but a browser could open a print dialog.
   */
  printer?: (text: string) => void
}

/** Every capability at its deterministic default. */
export function defaultHost(): Host {
  return { clock: fixedClock() }
}
