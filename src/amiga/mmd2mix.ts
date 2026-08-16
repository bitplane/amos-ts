/**
 * octaplayer's mixer: eight tracks into four Paula voices, and the tick IS the
 * DMA buffer.
 *
 * `runtime/med.ts` plays MMD0 and MMD1 through medplayer.library, which sounds
 * four voices whatever the block holds. This is its 5-8 channel sibling.
 * Tracks 4 to 7 do not get voices of their own; each is ADDED, one signed byte
 * at a time, on top of track n-4, and the four sums are what Paula plays.
 *
 * The part that took longest to see is that there is no timer here at all.
 * $211648 turns the module's primary tempo into a buffer LENGTH, $211bb6
 * writes that length into AUDxLEN, and the AUD0 interrupt at the end of the
 * buffer is the replay's tick. Tempo is buffer size. That is why the tempo
 * range collapses: the shortest buffer the table offers is 110 words, so this
 * player's tempo 1 is 71 Hz where medplayer's is 293.
 *
 * ## Evidence
 *
 * `DME_OctaMed.library`, 23,824 bytes at $210000, romtag "DME_OctaMed.library
 * 2.0 (04. September 97) DOOM Productions 1997". It shares 69.2% of its bytes
 * with `medplayer-1f2ca57f.library`, which is the same replay wearing a
 * different front end, and the sixteen period tables at $2123e2 are 3,264
 * bytes byte-identical to medplayer's at $211fca.
 *
 * Two other builds corroborate. `octaplayer-b27d6bb2.library` off MEDExt71
 * carries this mixer at $210688 with every constant the same, and
 * `octaplayer-a30420ff.library` off the AMOS PD Library CD 1994 carries an
 * EARLIER one: a fixed 400-byte buffer (`mulu.w #$640,d2` at $210796), no HQ
 * mode, and 400 straight-line copies of the mix with no loop at all. The
 * tempo-sized buffer and the 20-wide loop are the later revision.
 *
 * ## The buffer, and what a tempo is worth
 *
 * $211648 clamps the primary tempo to 1..9 and sends everything else,
 * including 0 and everything from 10 up, to one shared slowest entry:
 *
 *   tst.w d0 / ble / cmp.w #$9,d0 / bls / moveq #$a,d0 / addi.b #$9,d0
 *
 * so the index into the table at $212346 is `tempo + 9` for 1..9 and 19 for
 * the rest. Two rows of ten bytes live there, and which one is read and
 * whether it doubles is decided at $21166c:
 *
 *   flags bit 7 set     row 0, doubled     FLAG_SLOWHQ, at 15,625 Hz
 *   HQ on               row 1, doubled     at 28,604 Hz
 *   neither             row 0              at 15,625 Hz
 *
 * The result is AUDxLEN in words, so the buffer is twice that in bytes, and
 * $211696's `asl.w #$3` keeps a second copy multiplied by eight, which is
 * `bytes * 4` and only makes sense if the whole buffer is produced.
 *
 * A module with `deftempo` 13 and one with 33 therefore play at exactly the
 * same speed on this library, 39 Hz, and both of the OctaMED Professional 6
 * modules in `fixtures/` are in that position.
 *
 * ## The two rates
 *
 * $211ba8 writes AUDxPER $e3 and $211bae writes $7c, which are 15,625 Hz and
 * 28,604 Hz off the PAL clock. The step numerators follow from them exactly:
 * $38c000 is 227 << 14 and $1f0000 is 124 << 14, so `(D / period) * 4 / 65536`
 * is `227 / period` output samples per input byte and the mixer resamples to
 * whichever rate the buffer is playing at.
 *
 * ## The position, byte-swapped
 *
 * $210974 keeps the fraction in the HIGH word and the sample index in the LOW
 * one, and propagates the carry with `add.l d1,d6 / addx.w d0,d6` and d0 held
 * at zero. `s3mmix.ts` describes the same trick under ScreamTracker; two
 * unrelated 1990s mixers reached for it because it is one instruction pair.
 *
 * ## Volume is per PAIR, not per track
 *
 * There is no volume table and no scaling in the loop: `move.b (a3,d6.w),d3 /
 * add.b (a4,d7.w),d3 / move.b d3,(a1)+` is a raw signed byte add that WRAPS,
 * and the only volume anywhere is the four bytes $210858 copies into AUDxVOL.
 * One byte per Paula channel, shared by the two tracks mixed into it, and a
 * loud pair wraps rather than clips. This is a large part of what OctaMED's
 * 5-8 channel mode sounds like.
 *
 * DEVIATION: nothing in either octaplayer build ever writes those four bytes
 * at `$172(a6)`. `clr.l $172(a6)` at $211a60 is the only instruction that
 * touches the offset, so a literal reading has AUDxVOL fall to zero on the
 * first interrupt after `$211c08` set it to 64, and the player is silent. The
 * caller supplies the four levels here instead.
 *
 * ## Looping is quantised to the buffer
 *
 * $2108f4 asks whether the pointer plus a WHOLE buffer's advance has passed
 * the end, and restarts at the loop point for the entire buffer if it has.
 * A sample that would run out a third of the way through therefore repeats up
 * to a buffer early, which at tempo 6 is 20 ms.
 *
 * ## The other mixer, which is not here
 *
 * `DME_OctaMix.library` is octamixplayer, the 1-to-64 channel one behind the
 * fifteen `omix` keywords, and it is a different machine rather than a bigger
 * version of this. It is mapped and not ported, so the map is here:
 *
 *   $2130f4  Play, and `tst.b $300(a1) / bpl` refuses a module without
 *            FLAG2_MIX. That is why none of OctaMED Professional 6's 187
 *            modules will load: all 187 are MMD2 and none has the bit.
 *   $213610  AUDxPER from `$369e99 / freq`, and $369e99 is 3,579,545, the
 *            NTSC Paula clock. It appears eight times and the PAL clock
 *            appears nowhere, so on a PAL machine every rate and every pitch
 *            is 0.92% low. medplayer asks ExecBase which machine it is on at
 *            $2116ce; this library never asks.
 *   $21364c  14-bit: AUD0 and AUD1 stay at volume 64, AUD2 and AUD3 drop to
 *            1, and the converter at $21171c shifts each sample's low byte
 *            right two to fit the 6 bits that leaves.
 *   $211612  `btst #$0,$213(a0)` on flags3 chooses stereo, and $218/$219 are
 *            the echo type and depth. Four interrupt-and-convert pairs at
 *            $21169a, $2116ec, $211752 and $2117b4 cover mono and stereo
 *            against 8-bit and 14-bit.
 *   $2115f2  samples per tick: `(470000 / tempo) * rate / 709376`, where
 *            709376 is `16 * $ad30` and the CIA clock is 709,379. It uses
 *            that divide for EVERY tempo, where medplayer's $2111e0 table
 *            covers 1 to 10, so tempo 6 is 9 Hz here and 49 Hz there.
 *   $2115c6  and in BPM mode `10 * rate / (linesPerBeat * tempo)`, in 16.16.
 *   $21039c  the per-channel mix, which needs a 68020: `mulu.l d3,d0:d1` and
 *            `divu.l d1,d0`. Each channel is $4c bytes and `jsr (a4)` at
 *            $2103ec enters one of a set of specialised inner loops.
 *
 * The mixer is not ported because nothing on this machine or in the corpus
 * holds a module it would accept, so there would be nothing to check it
 * against but the instructions.
 */

import { PAULA_CLOCK_PAL } from './paula'

/** AUDxPER at $211ba8: 3,546,895 / 227 */
export const OMED_PERIOD_NORMAL = 0xe3
/** AUDxPER at $211bae: 3,546,895 / 124 */
export const OMED_PERIOD_HQ = 0x7c
/** `move.l #$38c000,d3` at $210876 --- 227 << 14 */
export const OMED_STEP_NORMAL = 0x38c000
/** `move.l #$1f0000,d3` at $21086e --- 124 << 14 */
export const OMED_STEP_HQ = 0x1f0000
/** row 0 of the table at $212346, AUDxLEN in words for primary tempos 1 to 9 */
export const OMED_TEMPO_WORDS = Uint8Array.of(110, 120, 130, 140, 150, 160, 170, 180, 190, 200)
/** row 1, ten bytes further on, and only ever read doubled */
export const OMED_TEMPO_WORDS_HQ = Uint8Array.of(101, 110, 119, 128, 137, 146, 156, 165, 174, 183)
/** `flags` bit 7, FLAG_SLOWHQ, tested by `tst.b $2ff(a0) / bmi` at $21166c */
export const OMED_FLAG_SLOWHQ = 0x80
/** $2130e0 to $2149e0: four channels, two buffers each, $320 bytes apiece */
export const OMED_BUFFER_BYTES = 0x320
export const OMED_BUFFERS = 8
/** eight tracks, and track n is added onto track n-4 */
export const OMED_TRACKS = 8
export const OMED_PAULA_VOICES = 4
/** bytes per turn of the loop at $210974, and of the HQ one at $210afe */
export const OMED_UNROLL = 20
export const OMED_UNROLL_HQ = 4

/**
 * AUDxLEN in words, which is also what decides the tick rate.
 *
 * `tempo` is `deftempo` at $2fc of the song header, `slowHq` is bit 7 of
 * `flags` at $2ff, and `hq` is the byte `Omed Hq On` writes through LVO -$54.
 */
export function omedBufferWords(tempo: number, hq: boolean, slowHq: boolean): number {
  const i = tempo >= 1 && tempo <= 9 ? tempo - 1 : 9
  if (slowHq) return OMED_TEMPO_WORDS[i]! * 2
  if (hq) return OMED_TEMPO_WORDS_HQ[i]! * 2
  return OMED_TEMPO_WORDS[i]!
}

/** the output rate the DMA runs at, 15,625 Hz or 28,604 Hz */
export function omedMixRate(hq: boolean): number {
  return PAULA_CLOCK_PAL / (hq ? OMED_PERIOD_HQ : OMED_PERIOD_NORMAL)
}

/**
 * How often the replay steps, in Hz: one buffer, one tick.
 *
 * FLAG_SLOWHQ doubles the buffer without changing the rate, so it halves the
 * tempo. That is what makes it slow, and the name is the author's.
 */
export function omedTickHz(tempo: number, hq: boolean, slowHq: boolean): number {
  return omedMixRate(hq) / (2 * omedBufferWords(tempo, hq, slowHq))
}

/**
 * The 16.16 step, already byte-swapped for the accumulator.
 *
 * $2108e0's `divu.w d6,d2` takes the 16-bit quotient and $2108e6 shifts it
 * left twice, so the step is `(D / period) * 4` read as 16.16.
 *
 * DEVIATION: a period under 57 overflows `divu.w`. The 68000 sets V and
 * leaves the destination alone rather than trapping, so the quotient is the
 * low word of D itself: $c000 at the normal rate, which is a fixed step of
 * three, and 0 in HQ, which freezes the side on one byte. That is modelled
 * because it is reachable --- MED's `$19` command slides the period under
 * anything Paula would accept.
 */
export function omedStep(period: number, hq: boolean): number {
  const d = hq ? OMED_STEP_HQ : OMED_STEP_NORMAL
  const quot = period === 0 ? 0 : Math.floor(d / period)
  const q = quot > 0xffff ? d & 0xffff : quot
  return swapWords(((q * 4) & 0xffffffff) >>> 0)
}

/** the whole-buffer advance $2108f4 tests the end against */
export function omedAdvance(period: number, samples: number, hq: boolean): number {
  const d = hq ? OMED_STEP_HQ : OMED_STEP_NORMAL
  const quot = period === 0 ? 0 : Math.floor(d / period)
  const q = quot > 0xffff ? d & 0xffff : quot
  // mulu.w takes the low words of both, and $574(a6) is the buffer in bytes times four
  return Math.floor(((q & 0xffff) * ((samples * 4) & 0xffff)) / 0x10000)
}

/** what `swap` does, and the reason the carry propagates in one instruction */
export function swapWords(v: number): number {
  return (((v << 16) | (v >>> 16)) & 0xffffffff) >>> 0
}

/**
 * One track's contribution to a Paula channel, named by its offset in the
 * per-channel block at $82(a6) so the arms below read against $2108d6.
 *
 * The second track of a pair is the same fields $78 further on, which is why
 * eight tracks fit four blocks of $1e bytes.
 */
export interface OmedSide {
  /** `(a2)`: where in `pcm` this track is playing, and 0 for silent */
  at: number
  /** `$c(a2)`: one past the last byte */
  end: number
  /** `$10(a2)`: where a finished sample restarts, and 0 for one-shot */
  loop: number
  /** `$6(a2)`: AUDxPER, and 0 silences the side */
  period: number
}

/**
 * $210b66's silence source, `lea $7e(a6),a3` with a zero step: one byte of
 * the state block, read for the whole buffer.
 */
const SILENCE = 0

/**
 * $2108d6: two tracks into one Paula buffer.
 *
 * `out` is the DMA buffer, and its length is the tick. Both sides are advanced
 * in place, and a side that has run out is either restarted at its loop point
 * or muted for good by having its pointer cleared, exactly as $210902 does.
 *
 * DEVIATION: the real loop runs `$578(a6) + 1` turns of 20 bytes, and $578 is
 * a word no instruction in DME_OctaMed, octaplayer-b27d6bb2 or the 1994 build
 * ever writes. Read literally it is zero, so 20 bytes of a 220-to-800 byte
 * buffer are produced and the rest is whatever the previous pass left. The
 * port fills the whole buffer, because the pointer advance three instructions
 * earlier --- `mulu.w $574(a6)`, with $574 held at four times the buffer in
 * bytes --- is only correct if it is. The HQ arm at $210af6 derives its own
 * count from $576 and has no such gap.
 */
export function omedMix(out: Int8Array, pcm: Int8Array, a: OmedSide, b: OmedSide, hq: boolean): void {
  const n = out.length
  const sa = prepare(a, n, hq)
  const sb = prepare(b, n, hq)
  let pa = 0
  let pb = 0
  for (let i = 0; i < n; i++) {
    const ba = sa.base < 0 ? SILENCE : (pcm[sa.base + (pa & 0xffff)] ?? 0)
    const bb = sb.base < 0 ? SILENCE : (pcm[sb.base + (pb & 0xffff)] ?? 0)
    out[i] = ((ba + bb) << 24) >> 24
    pa = bump(pa, sa.step)
    pb = bump(pb, sb.step)
  }
  // $210ae0: the fraction is dropped and only the whole bytes reach the pointer
  if (sa.base >= 0) a.at = sa.base + (pa & 0xffff)
  if (sb.base >= 0) b.at = sb.base + (pb & 0xffff)
}

/** `add.l d1,d6 / addx.w d0,d6`, with d0 zero */
function bump(pos: number, step: number): number {
  const sum = pos + step
  const carry = sum > 0xffffffff ? 1 : 0
  return ((sum & 0xffff0000) | (((sum & 0xffff) + carry) & 0xffff)) >>> 0
}

/**
 * $2108d8 through $210914: the step, the end test and the loop switch, all of
 * which happen once for the whole buffer.
 *
 * A base of -1 means the side reads the silence byte for this tick.
 */
function prepare(side: OmedSide, samples: number, hq: boolean): { base: number; step: number } {
  if (side.period === 0 || side.at === 0) return { base: -1, step: 0 }
  const advance = omedAdvance(side.period, samples, hq)
  if (side.at + advance - side.end >= 0) {
    if (side.loop === 0) {
      side.at = 0
      return { base: -1, step: 0 }
    }
    side.at = side.loop
  }
  return { base: side.at, step: omedStep(side.period, hq) }
}
