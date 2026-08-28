/**
 * OctaMED's 1-to-64 channel mixer, off `DME_OctaMix.library` at $210000.
 *
 * This is the third of the three OctaMED replayers DME ships and the only one
 * that is not Paula-shaped. `runtime/med.ts` drives medplayer (four voices on a
 * CIA timer) and octaplayer (eight tracks mixed two to a voice, `mmd2mix.ts`);
 * this one sums up to 64 channels in software at a rate the caller picks and
 * hands Paula a finished stream. The SEQUENCER is the same OctaMED sequencer as
 * the other two, which is why this file holds the parts that differ rather than
 * a second copy of the parts that do not.
 *
 * ## Evidence
 *
 * `DME_OctaMix.library`, 22,984 bytes at $210000: hunk 0 code ($210000+924),
 * hunk 1 code ($21039c+13216), hunk 2 data ($21373c+8836), hunk 3 eight bytes.
 * The romtag at $210004 reads "DME_OctaMix.library 2.0 (06. September 97) DOOM
 * Productions 1997". Sixteen library functions, -30 to -120.
 *
 *   -30  $212cae  relocate the module in place
 *   -36  $212e5c  what kind of module this is, and `mmd2.ts`'s `mmdMixType`
 *   -54  $2130f4  play, entered with d0 set
 *   -60  $213052  initialise
 *   -66  $213062  free everything
 *   -72  $2130b6  stop
 *   -78  $2130e0  continue, the SAME routine as play with d0 clear
 *   -84  $21022c  the subsong number, a plain store to $2159c4
 *   -90  $21023c  the buffer, a plain store to $215918
 *   -96  $21024c  the mixing frequency, a plain store to $21591c
 *   -102 $21025c  the 14-bit flag, a plain store to $215920
 *   -108 $21026c  the next pattern
 *   -114 $2102d4  the previous pattern
 *   -120 $21033e  a channel's vu byte
 *
 * ## Nothing here is checked against a module
 *
 * DEVIATION: every other format in this port was read out of a library AND
 * played back against a module somebody wrote. This one has no module. LVO -36
 * demands bit 7 of `flags2` and none of the 202 MMD files across the corpus and
 * `fixtures/` carries it, so the numbers below are checked against the
 * instructions that produce them and against arithmetic that has to hold --- an
 * octave ratio of two, a tempo that comes out at the rate MED is known to run
 * at --- and against nothing that was ever heard. Where that leaves a real
 * question the comment says so rather than implying more confidence than there
 * is.
 *
 * ## The note table is generated, not stored
 *
 * $2132ba allocates $900 bytes at library-open time and fills it with SIXTEEN
 * tables of $90: 72 words each, one table per finetune step from -8 to +7. The
 * generator is $211d18 (integer) or $211d5a (the same thing in the FPU, chosen
 * on AttnFlags bit 4 at $213302), and it is a recurrence rather than a table:
 *
 *   v = 68,616,340 + finetune * 510,940       $2132ec, SMult32 then add
 *   entry[n] = v >> 16                        $211d2e, stored BEFORE the step
 *   v = (v * 69,433) >> 16                    $211d32, two UMult32 halves
 *
 * and 69,433 / 65,536 is 1.0594635, which is 2^(1/12) to seven figures. So the
 * table is 72 ascending semitones and the finetune shifts its base LINEARLY,
 * 0.745% a step, which is about an eighth of a semitone.
 *
 * The result is the classic Amiga range read as frequencies rather than
 * periods. Entry 12 is 2090, and $369e99 / 2090 is 1712.7; entry 24 gives
 * 856.6, entry 36 gives 428.3, entry 48 gives 214.1. Those are ProTracker's
 * C-1, C-2, C-3 and C-4 to within a unit, which is the accumulated truncation
 * of 36 fixed-point multiplies and is what the machine plays.
 *
 * ## Two of the 1,152 entries wrap
 *
 * $211d2e is `move.w`, and at the two highest finetunes the recurrence has
 * outgrown a word by the time it reaches the top note. Finetune +6 stores 474
 * where the run of the table wants about 66,100, and finetune +7 stores 808.
 * Note 71 at those two settings therefore plays about seven octaves BELOW
 * where it was asked for, and no other entry in the sixteen tables is wrong at
 * all. It is a real edge and this port reproduces it, because the alternative
 * is to invent a value the library cannot hold.
 *
 * ## Where the NTSC clock does and does not matter
 *
 * `$369e99` is 3,579,545, the NTSC colour clock, and $213610 and $21365c use it
 * where a PAL machine wants 3,546,895. `mmd2mix.ts` records that as a flat
 * 0.92% error and this file can be more exact about where it lands.
 *
 * In the PITCH path it CANCELS. $21218e turns a table value into a period by
 * dividing the clock by it and $21219a turns the period back into a table value
 * the same way, so the constant is on both sides. What does NOT cancel is the
 * truncation between them: both are `divu.w`, and at the top of the table the
 * period is small enough that throwing away its fraction moves the value a lot.
 * A zero bend on entry 71 returns 63,920 where it was handed 63,111, which is
 * 1.3% or about a fifth of a semitone. It is not cumulative --- `$26(a5)` keeps
 * the table value and every tick recomputes from it --- so the effect is that
 * the top of the range is quantised to whole periods, which is what a
 * period-driven Amiga replayer does anyway.
 *
 * What does not cancel at all is $213610, which asks Paula for
 * `3,579,545 / rate` and gets a whole number. Paula clocks that against
 * 3,546,895, so two errors land on top of each other: the 0.912% between the
 * clocks, and the fraction the period threw away.
 *
 * Below a rate of 32,840 the period is coarse enough that the clock always
 * wins and the stream is always slow --- 0.81% at 8,000, 0.65% at the default
 * 15,000, 0.26% at 28,000. Above 32,840 the rounding can outweigh the clock
 * and the stream runs FAST instead, worst at 65,083 and by 0.92%. `mmd2mix.ts`
 * records a flat 0.92% for this library, which is the clock on its own; what a
 * listener would measure moves with the rate and changes sign.
 */
import { MMD_FLAG2_BMASK, MMD_FLAG2_BPM } from './mmd2'

/** `move.l #$369e99,d0` at $21218e and $213610: the NTSC colour clock */
export const OMIX_CLOCK = 0x369e99

/** 72 words a table: six octaves of twelve */
export const OMIX_NOTES = 72
/** finetune -8 to +7, and `$900 / $90` is where the sixteen comes from */
export const OMIX_FINETUNES = 16
export const OMIX_TABLE_BYTES = 0x90

/** `addi.l #$4168094,d0` at $2132f6, and 68,616,340 >> 16 is 1046 */
export const OMIX_TABLE_BASE = 0x4168094
/** `move.l #$7c7dc,d1` at $2132ec, multiplied by the finetune at $2132f2 */
export const OMIX_TABLE_STEP = 0x7c7dc
/** `move.l #$10f39,d1` at $21330e: 69,433, which is 2 ** (1 / 12) << 16 */
export const OMIX_SEMITONE = 0x10f39

/** `cmp.w #$71,d5 / bhi / moveq #$71,d5` at $2121a2: a floor, not a ceiling */
export const OMIX_MIN_NOTE_VALUE = 0x71

/** `move.l #$72bf0,d0` at $2115f2: 470,000 */
export const OMIX_TEMPO_NUMERATOR = 0x72bf0
/** `divu.w #$ad30,d0` at $211602: 44,336, and 16 * 44,336 is 709,376 */
export const OMIX_TEMPO_DIVISOR = 0xad30

/** the defaults in hunk 2, at $21591c and $215918 before anything writes them */
export const OMIX_DEFAULT_RATE = 15000
export const OMIX_DEFAULT_BUFFER = 1024

/** $705a: `cmp.l #$3e8,d0 / blt` and `cmp.l #$ffff,d0 / bhi` */
export const OMIX_MIN_RATE = 1000
export const OMIX_MAX_RATE = 0xffff
/** $709a: `cmp.l #$4,d0 / blt` and `cmp.l #$7ffc,d0 / bhi` */
export const OMIX_MIN_BUFFER = 4
export const OMIX_MAX_BUFFER = 0x7ffc

/** `cmp.l #$40,d7 / bcc` at $71f8: `=Omix Vu` takes 0 to 63 */
export const OMIX_MAX_CHANNELS = 64

/**
 * $211d32's step, as the library computes it.
 *
 * Two `UMult32` calls and an `addx.w`, which is `(v * 69433) >> 16` with every
 * intermediate truncated to 32 bits. The truncation is not decorative: the top
 * of the table is within one step of overflowing, and reproducing the shift in
 * 64-bit arithmetic would diverge from the machine exactly where the highest
 * notes are.
 */
function omixStepValue(v: number): number {
  const hi = Math.floor(v / 0x10000)
  const lo = v & 0xffff
  // UMult32 keeps the low 32 bits of the product and nothing else
  const p1 = (hi * OMIX_SEMITONE) >>> 0
  const p2 = (OMIX_SEMITONE * lo) >>> 0
  let low = (p2 >>> 16) + (p1 & 0xffff)
  const carry = low > 0xffff ? 1 : 0
  low &= 0xffff
  const high = ((p1 >>> 16) + carry) & 0xffff
  return high * 0x10000 + low
}

/**
 * $211d18: one finetune's 72 words.
 *
 * `finetune` is -8 to 7, which is the `d2 - 8` at $2132e4 rather than a field
 * anyone stores that way; `omixNoteTables` indexes them 0 to 15.
 */
export function omixNoteTable(finetune: number): Uint16Array {
  let v = (OMIX_TABLE_BASE + finetune * OMIX_TABLE_STEP) >>> 0
  const out = new Uint16Array(OMIX_NOTES)
  for (let n = 0; n < OMIX_NOTES; n++) {
    // $211d2e stores the high word FIRST and steps afterwards, so entry 0 is
    // the base itself and not the base times the ratio. It is a `move.w`, so
    // the two highest finetunes wrap at note 71 rather than saturating
    out[n] = Math.floor(v / 0x10000) & 0xffff
    v = omixStepValue(v)
  }
  return out
}

/** the sixteen tables $2132e0 builds, in the order it builds them */
export function omixNoteTables(): Uint16Array[] {
  return [...Array(OMIX_FINETUNES)].map((_, i) => omixNoteTable(i - 8))
}

/**
 * $21218e and $21219a: a table value bent by `bend` period units.
 *
 * The bend is in PERIODS and the table is in frequencies, so the library goes
 * one way and back: `period = clock / value`, `period += bend`, `value = clock
 * / period`. Both divides truncate and the clock cancels, so a bend of zero is
 * not quite the identity --- it is the value put through two truncating
 * divides, which is where a held note can drift by a unit.
 *
 * $2121a2 then floors the result at $71. That is a floor on the VALUE, so it is
 * a ceiling on the period: a note bent far enough down stops at 3,579,545 / 113
 * and goes no lower.
 */
export function omixBend(value: number, bend: number): number {
  let out = value & 0xffff
  // $21218c: a value of zero skips BOTH divides and still lands on the clamp,
  // so a silent channel comes back as $71 rather than as nothing
  if (out !== 0) {
    // $212196 is `add.w`, so the sum wraps at sixteen bits before the test
    const period = (Math.floor(OMIX_CLOCK / out) + bend) & 0xffff
    // $212198: a period of zero leaves the value alone rather than dividing
    if (period !== 0) out = Math.floor(OMIX_CLOCK / period)
  }
  return out > OMIX_MIN_NOTE_VALUE ? out : OMIX_MIN_NOTE_VALUE
}

/**
 * `$211a08` and `$211a0a`, the samples a tick is worth, as 16.16.
 *
 * $2115be picks the mode on bit 5 of `flags2`, and the two arms do not agree
 * about precision: the BPM one keeps a fraction and the plain one throws it
 * away, because $211608 stores a zero into the low word on purpose.
 *
 * Plain ($2115f2), which is MED's own tempo scale:
 *
 *   floor(floor(470000 / tempo) * rate / 16 / 44336)
 *
 * At tempo 33 and any rate that comes out at 49.8 ticks a second, which is the
 * 50 Hz MED has always run at. `divu.w` gives a 16-bit quotient, so a tempo
 * below 8 overflows the first divide --- 470,000 / 7 is 67,142 and does not
 * fit. The library does not check, and what a real 68000 does there is take an
 * exception; this returns 0 instead, which is a DEVIATION and the only sane
 * answer for a tempo nothing can play.
 *
 * BPM ($2115c6):
 *
 *   10 * ((rate << 16) / ((flags2 & $1f) + 1) / tempo)
 *
 * `$211684` is read as a LONG here and as a WORD at $2115fc, which is the whole
 * trick: the rate sits in the high half so `UDivMod32` returns 16.16. The ten
 * is `lsl.l #$3` plus two adds at $2115e4. Dimensionally it is
 * `lines/second = beats/minute * lines/beat / 10 * ...`, and at 120 BPM with
 * four lines to the beat and six ticks to the line it comes out at eight lines
 * a second, which is 120 beats a minute exactly.
 */
export function omixSamplesPerTick(rate: number, tempo: number, flags2: number): number {
  if (tempo <= 0) return 0
  if ((flags2 & MMD_FLAG2_BPM) !== 0) {
    const lines = (flags2 & MMD_FLAG2_BMASK) + 1
    const divisor = lines * tempo
    if (divisor === 0) return 0
    return Math.floor((10 * Math.floor((rate * 0x10000) / divisor)) / 0x10000)
  }
  const q = Math.floor(OMIX_TEMPO_NUMERATOR / tempo)
  // divu.w cannot return a quotient past 65,535, and $2115f8 does not check
  if (q > 0xffff) return 0
  return Math.floor(Math.floor((q * rate) / 16) / OMIX_TEMPO_DIVISOR)
}

/**
 * The same thing without the truncation to whole samples, for a caller that
 * wants the tick RATE rather than a buffer length.
 *
 * The BPM arm really does keep sixteen fractional bits; the plain arm really
 * does not, so this is exact for one and rounded for the other in the same way
 * the library is.
 */
export function omixTickHz(rate: number, tempo: number, flags2: number): number {
  const per = omixSamplesPerTickFixed(rate, tempo, flags2)
  return per > 0 ? (rate * 0x10000) / per : 0
}

/** the 16.16 value the library stores, rather than its integer part */
export function omixSamplesPerTickFixed(rate: number, tempo: number, flags2: number): number {
  if (tempo <= 0) return 0
  if ((flags2 & MMD_FLAG2_BPM) !== 0) {
    const lines = (flags2 & MMD_FLAG2_BMASK) + 1
    const divisor = lines * tempo
    if (divisor === 0) return 0
    return (10 * Math.floor((rate * 0x10000) / divisor)) >>> 0
  }
  const q = Math.floor(OMIX_TEMPO_NUMERATOR / tempo)
  if (q > 0xffff) return 0
  return Math.floor(Math.floor((q * rate) / 16) / OMIX_TEMPO_DIVISOR) * 0x10000
}

/**
 * $213610: AUDxPER, and the one place the NTSC constant is not cancelled.
 *
 * `3,579,545 / rate` is the period the library hands Paula. On a PAL machine
 * Paula clocks that period against 3,546,895, so the stream is played 0.92%
 * slower than the mixer built it.
 */
export function omixPaulaPeriod(rate: number): number {
  return rate > 0 ? Math.floor(OMIX_CLOCK / rate) : 0
}
