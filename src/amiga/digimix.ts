/**
 * DigiBooster's software mixer: two module channels into one Paula voice.
 *
 * The thing that surprised me here is what DigiBooster does NOT do. It has no
 * fixed mixing rate and no master output stream. It pairs the module's
 * channels two to a Paula voice, and when both of a pair are sounding it
 * renders their sum into a buffer AT THE FIRST CHANNEL'S OWN SAMPLE RATE and
 * plays that buffer on the voice. When only one of a pair sounds, nothing is
 * mixed at all: Paula gets the sample directly, exactly as ProTracker would
 * have handed it over.
 *
 * So an eight-channel module is four two-channel mixes, each running at
 * whatever rate its first channel happens to want, and the second channel of
 * each pair is the one that gets resampled. That is why `$1f(a6)` selects
 * between `$56(a6)` (a sample pointer) and `$5e(a6)` (a mix buffer) at
 * $210bec and $210c1c, and why AUDxPER is written from `$1c(a6)`, the
 * channel's own period, on BOTH arms.
 *
 * ## Evidence
 *
 * `DME_DigiBooster.library` at $210000, hunk 1. Two routines decide the
 * sound and both are transcribed here rather than approximated:
 *
 *   $2128d2  the volume table, built once at InitModule
 *   $212562  the mixing loop, and the three end-guard arms beside it
 *
 * ## The volume table
 *
 * 65 volumes of 256 bytes at $23af00 --- `move.l #$23af14,d0 / andi.l
 * #$ffffff00,d0` rounds the BSS address down to a page. The generator is nine
 * instructions:
 *
 *   move.b d0,d1 / ext.w d1     the sample as a signed byte
 *   muls.w d2,d1                times the volume DOUBLED (d2 steps by two)
 *   divs.w d3,d1                over 128
 *   cmp.b #$3f,d1 / blt         and then clamped to 63
 *   cmp.b #$c0,d1 / bgt         and to -64
 *
 * `s * 2v / 128` is `s * v / 64`, so at volume 64 the table is the identity
 * ... and then CLIPS AT plus or minus 64. It does not scale the headroom
 * down, it clips it away. Two channels each bounded to +-64 sum to exactly one
 * signed byte, which is what the mix buffer is, and a loud DigiBooster module
 * distorts because the author chose loudness over headroom. That clipping is
 * a large part of what the format sounds like and it is reproduced, not fixed.
 *
 * ## The mixing loop
 *
 * $212562, and it is a zero-order-hold resampler with the FIRST channel
 * pinned at one byte per output sample:
 *
 *   move.b (a0)+,d1 / movea.l d1,a4 / move.b (a4),d1    A, through the table
 *   add.l d4,d2                                          d4 is $10000
 *   cmp.l d2,d3 / ble                                    time for a B byte?
 *   add.b d0,d1                                          no: hold the last B
 *   move.b d1,(a2)+
 *
 * Both accumulators start at the step rather than at zero ($212558), d2 gains
 * a whole 1.0 per output and d3 gains the step per B advance, so B advances
 * `1/step` times as often as A. The step itself is `(span << 16) / n` at
 * $2124b4, where n is how many of B's bytes the span is to consume --- so
 * `n / span` bytes of B per output sample, in 16.16.
 *
 * Seeding both counters with a step rather than with zero means the FIRST
 * output sample already calls for a B byte, so a span consumes n + 1 of them
 * rather than n unless the two rates are equal. That is not a slip: `move.l
 * a5,d0` at $212556 leaves the held B value as the low byte of the table
 * pointer, and the pointer is page-aligned precisely so that byte is zero.
 * There is nothing to hold until B has been read once.
 *
 * A 68000 gets the same number the long way at $2124a2, shifting by 8 and 4
 * around a 16-bit `divu.w` because it has no `divu.l`. The two paths agree.
 *
 * The three arms beside this one ($21258e, $2125ce, $2125f4) are the same loop
 * with the end tests hoisted: one for A already finished, one for B, one for
 * both finishing inside the span. They are collapsed here into the guards in
 * `mixPair`, because an arm is a way of not testing something in an inner
 * loop and this has no inner loop to protect.
 *
 * ## What is NOT here
 *
 * Looping. A channel that reaches its end goes quiet for the rest of the span
 * and the caller re-points it, which is how the library is arranged: the end
 * the loop tests is `base + repeat start + repeat length`, assembled at
 * $2124c2 from three separate tables, and the decision to wrap is taken
 * outside the span.
 *
 * Generalising this to N channels is deliberately not done. octaplayer.library
 * mixes five to eight and octamixplayer.library up to 64 (#132), and
 * `README.md` in this directory says a module earns its move when a second
 * caller appears rather than in anticipation of one. When they arrive, what
 * they share with this is the 16.16 accumulator and not the pairing.
 */

/** 0 to 64 inclusive, which is `moveq #$40,d6` plus the `dbra` */
export const DIGI_MIX_VOLUMES = 65
/** one row per possible sample byte */
export const DIGI_MIX_LEVELS = 256
/** `cmp.b #$3f,d1` and `cmp.b #$c0,d1`: half a byte each way, and it clips */
export const DIGI_MIX_CEIL = 63
export const DIGI_MIX_FLOOR = -64
/** `move.l #$10000,d4`: one whole output sample, 16.16 */
export const DIGI_MIX_ONE = 0x10000

/**
 * The 65 x 256 table at $23af00, built the way $2128d2 builds it.
 *
 * Indexed `[volume * 256 + (sample & 0xff)]`, which is the `lsl.w #$8` on the
 * volume at $212520 and the `move.b` into the low byte of the pointer at
 * $212562.
 */
export function digiVolumeTable(): Int8Array {
  const t = new Int8Array(DIGI_MIX_VOLUMES * DIGI_MIX_LEVELS)
  for (let v = 0; v < DIGI_MIX_VOLUMES; v++) {
    for (let s = 0; s < DIGI_MIX_LEVELS; s++) {
      // `move.b d0,d1 / ext.w d1` --- the index read back as a signed byte
      const signed = (s << 24) >> 24
      // `muls.w d2,d1 / divs.w d3,d1`, and DIVS truncates toward zero
      let n = Math.trunc((signed * (v * 2)) / 128)
      if (n >= DIGI_MIX_CEIL) n = DIGI_MIX_CEIL
      else if (n <= DIGI_MIX_FLOOR) n = DIGI_MIX_FLOOR
      t[v * DIGI_MIX_LEVELS + s] = n
    }
  }
  return t
}

/** one side of a pair, as the mixing loop sees it */
export interface MixSide {
  /** the sample, or null for a channel that is not sounding */
  pcm: Int8Array | null
  /** where the read is now, in BYTES. Fractional only for the second side */
  pos: number
  /** one past the last byte this side may read: base + repeat start + length */
  end: number
  /** 0..64, the row into the volume table */
  volume: number
}

/**
 * One span of the mix, $212562 and its three sibling arms.
 *
 * `out` is filled completely. `a` advances one byte per output sample and `b`
 * advances `bStep / 65536`, both clamped at `end`, and both `pos` fields are
 * left where the span finished so the caller can wrap them.
 *
 * The output is meant to be played at `a`'s own sample rate, because that is
 * the rate it was rendered at.
 */
export function mixPair(out: Int8Array, a: MixSide, b: MixSide, bStep: number, table: Int8Array): void {
  const aBase = a.volume * DIGI_MIX_LEVELS
  const bBase = b.volume * DIGI_MIX_LEVELS
  // `move.l d6,d2 / move.l d6,d3` --- both start at the step, not at zero
  let clock = bStep
  let due = bStep
  let aAt = Math.trunc(a.pos)
  let bAt = Math.trunc(b.pos)
  // the held value: B contributes its last byte until the counter calls for
  // another one, which is the whole of the resampling
  let held = 0

  for (let i = 0; i < out.length; i++) {
    let sum = 0
    if (a.pcm && aAt < a.end) sum = table[aBase + (a.pcm[aAt]! & 0xff)]!
    aAt += 1
    clock += DIGI_MIX_ONE
    if (due <= clock) {
      due += bStep
      held = b.pcm && bAt < b.end ? table[bBase + (b.pcm[bAt]! & 0xff)]! : 0
      bAt += 1
    }
    // `add.b d0,d1` --- a byte add, so the sum wraps rather than saturating.
    // It cannot: the table bounds each side to [-64, 63] and the pair fits
    sum = ((sum + held) << 24) >> 24
    out[i] = sum
  }

  a.pos = aAt
  b.pos = bAt
}

/**
 * `(span << 16) / n` at $2124b4: the 16.16 step that consumes `n` bytes of the
 * second channel while the first consumes `span`.
 *
 * Zero `n` gives zero, which holds the second channel still rather than
 * dividing by it. The library never calls it with one because the arm above
 * only runs when both sides are sounding.
 */
export function digiStep(span: number, n: number): number {
  if (n <= 0) return 0
  return Math.trunc((span * DIGI_MIX_ONE) / n)
}
