/**
 * ScreamTracker 3's software mixer, off `DME_ScreamTracker.library` at $210000.
 *
 * Twelve channels do not fit in four Paula voices, so this replayer sums them
 * itself at a fixed 28,000 Hz and hands Paula a finished stream. Everything
 * below is read out of the mixer routines rather than inferred from how the
 * output sounds.
 *
 * ## The whole mixer works in unsigned bytes
 *
 * A sample byte indexes a 65x256 table and comes out biased by $80, the
 * accumulator adds those biased bytes as words, and the second table takes the
 * bias back off. Silence is $80 per channel, which is what $210dd2 fills a
 * dead channel's span with (`move.l #$800080,d0`). Nothing in the mix path
 * ever holds a signed value.
 *
 * ## The position is a byte-swapped 16.16 accumulator
 *
 * `$14(a4)` holds the play position with the FRACTION IN THE HIGH HALF and the
 * integer index in the low half, which is the whole reason the per-sample body
 * is four instructions:
 *
 *   move.b (a0,d0.w),d2   the low half is the index, so no shifting
 *   movea.l d2,a1
 *   move.b (a1),d3
 *   add.l  d4,d0          fraction and integer in one add
 *   move.w d3,(a2)+
 *   addx.w d5,d0          d5 is zero: the fraction's carry out of bit 31
 *
 * `swap d4` at $210c80 puts the step into the same order, so `add.l` adds the
 * fractional step into the high half and the integer step into the low half at
 * once. A fraction overflow leaves bit 31 and lands in X, and `addx.w #0`
 * carries it into the index. `swap d0` at $210cb2 is the proof: it puts the
 * position back the right way up before subtracting it from `length << 16`.
 *
 * Sign extension in `(a0,d0.w)` never bites, because $210d9e folds the integer
 * index into the base pointer and clears it at the end of every run. A run is
 * at most `$4e(a5)` samples --- 560 at 28,000 Hz and 125 BPM --- so the index
 * stays in the low hundreds.
 *
 * ## The clock is ScreamTracker's, not Paula's
 *
 * `$c2(a5)` is `$369d80` = 3,579,264 = 14,317,056 / 4, set at $211874. That is
 * ScreamTracker's own constant, and the /4 is undone by the shifts: the step
 * is `((clock / period) << 14) / (rate >> 4)`, which is `14317056 << 16 /
 * (period * rate)` before truncation. Splitting it that way keeps the
 * intermediate inside 32 bits; the two truncations cost about 0.04%, and this
 * port keeps them.
 *
 * ## Where the sound is decided
 *
 * `$2115f8` builds the volume table, `$21158c` the level table, and $210c46
 * and $210e48 are the store-first and add-the-rest mixers that $2109 8a walks
 * the 32 channels with. Only channels that actually contributed bump
 * `$ba(a5)` ($210fd2), and that count picks the level table's row --- so the
 * bias taken off matches the number of channels that put one on.
 */

/** `move.l #$369d80,$c2(a5)` at $211874: 14,317,056 / 4 */
export const S3M_CLOCK = 0x369d80
/** `move.l #$6d60,$21274a` at $21018e */
export const S3M_MIX_RATE = 28000
/** `mulu.w #$20ab,d0` at $211ac6: ScreamTracker's reference rate */
export const S3M_C2SPD = 8363
/** 65 volumes, 0 to 64 inclusive (`cmp.w #$41,d3` at $21162a) */
export const S3M_VOLUMES = 65
/** one row of the volume table, and the alignment $2102d4 rounds up to */
export const S3M_VOL_ROW = 256
/** `move.l #$1000,d0 / move.l d0,$44(a5)` at $2101bc */
export const S3M_BUFFER_BYTES = 0x1000
/** `move.l #$800080,d0` at $210dd2: one silent channel's contribution */
export const S3M_SILENCE = 0x80

/**
 * The twelve words at $2123d2, one per note of an octave.
 *
 * ScreamTracker's own table, and the values are the ones its documentation
 * publishes. Shipped rather than fitted: they are a tempered scale rounded by
 * hand in 1994, and no generator reproduces all twelve.
 */
export const S3M_NOTE_PERIODS = Uint16Array.of(
  1712, 1616, 1524, 1440, 1356, 1280, 1208, 1140, 1076, 1016, 960, 907,
)

/**
 * The thirty words at $211886, indexed by the last enabled channel less four.
 *
 * `$140` and a further `$40` every two entries, which is exact for all thirty
 * so the table is generated rather than shipped. Thirty covers a last channel
 * of 4 to 33, and the format's ceiling is 32. Only bits 7 and up are ever
 * used: $211866 shifts the word right seven to get the headroom the divisor
 * gives away.
 */
export const S3M_BOOSTS = 30
export function s3mBoostWord(index: number): number {
  return 0x140 + 0x40 * (index >> 1)
}

/**
 * How much smaller the level table's divisor is than the channel count.
 *
 * `$6a(a5)` is built at $211862 as a long whose halves come from the same
 * word, and only the low half survives: $2115b2 subtracts the long but
 * $2115b6 and $2115ca both read `d3` as a WORD, so the high half's borrow is
 * discarded. The port does the low-word arithmetic the divide actually sees.
 *
 * `last` is `$bc(a5)`, the one-based index of the last channel the module
 * enables.
 *
 * DEVIATION: a module whose last enabled channel is below four indexes before
 * the table and reads the `moveq`/`rts` at $211882 as data, which gives a
 * divisor far below one and so the clamp. This port clamps the index instead,
 * which reaches the same divisor by a route that can be written down.
 */
export function s3mBoost(last: number): number {
  const i = Math.min(S3M_BOOSTS - 1, Math.max(0, last - 4))
  return s3mBoostWord(i) >> 7
}

/** `$b90(a5)`: what the pan scan at $211530 leaves for one channel */
export const S3M_PAN_OFF = 0
export const S3M_PAN_LEFT = 1
export const S3M_PAN_RIGHT = 0xff

export interface S3mSides {
  /** 32 bytes of $0, $1 or $ff, in channel order */
  pan: Uint8Array
  left: number
  right: number
  /** `$be(a5)`: the busier side, and never less than two ($2107f6) */
  channels: number
  /** `$bc(a5)`: the one-based index of the last channel that is on */
  last: number
}

/**
 * The pan scan at $211530, over the module's 32 bytes at $40.
 *
 * `cmp.b #$8,d2` splits the sides: under eight is left, eight and over is
 * right, and a byte with bit 7 set ($ff) is a channel that is off. The count
 * kept is the LARGER side, which is what sizes the level table --- a module
 * panned entirely one way gets a table for all of its channels.
 */
export function s3mSides(settings: Uint8Array): S3mSides {
  const pan = new Uint8Array(32)
  let left = 0
  let right = 0
  let last = 1
  for (let i = 0; i < 32; i++) {
    const b = settings[i] ?? S3M_PAN_RIGHT
    if (b & 0x80) continue
    if (b >= 8) {
      pan[i] = S3M_PAN_RIGHT
      right++
    } else {
      pan[i] = S3M_PAN_LEFT
      left++
    }
    last = i + 1
  }
  return { pan, left, right, channels: Math.max(2, left, right), last }
}

/**
 * `$4c(a5)`, the samples one tick lasts, off $21086e.
 *
 * `rate * 5 / (tempo * 2)`, then `addq.w #1` and `andi.w #$fffe` --- rounded
 * UP to even, because the buffer is filled a long at a time. 28,000 Hz at 125
 * BPM is 560.
 */
export function s3mSamplesPerTick(rate: number, tempo: number): number {
  const q = Math.trunc((rate * 5) / (tempo * 2)) & 0xffff
  return (q + 1) & 0xfffe
}

/**
 * ScreamTracker's note-to-period, off $211aa6.
 *
 * `note` is the packed byte: octave in the high nibble, note in the low. The
 * shift is by the octave, so a higher octave is a SMALLER period, and the
 * divide by `c2spd` is what makes a sample recorded at its own rate play at
 * pitch.
 */
export function s3mPeriod(note: number, c2spd: number): number {
  if (c2spd === 0) return 0
  const octave = (note >> 4) & 0xf
  const step = S3M_NOTE_PERIODS[note & 0xf] ?? 0
  return Math.trunc(((step * S3M_C2SPD * 16) >>> octave) / c2spd) & 0xffff
}

/**
 * The 16.16 step, right way up, off $210c64.
 *
 * `swap` it before adding it to a position: `s3mMix` does that itself.
 */
export function s3mStep(period: number, rate: number): number {
  if (period === 0 || rate < 16) return 0
  const hz = Math.trunc(S3M_CLOCK / period)
  // `lsl.l #$8,d4 / lsl.l #$6,d4` drops what leaves bit 31, and a period of one
  // or two is short enough to reach that
  return Math.trunc(((hz * 0x4000) >>> 0) / Math.trunc(rate / 16)) >>> 0
}

/** exchange the halves of a long, as the 68000's `swap` does */
export function swap32(v: number): number {
  return (((v << 16) | (v >>> 16)) & 0xffffffff) >>> 0
}

/**
 * The 65x256 volume table at `$38(a5)`, built by $2115f8.
 *
 * `((source - 128) * volume) >> 6` biased back up by 128, where `source` is
 * the module's byte read the way its `$2a` field says it was stored. The two
 * arms differ only in how they reach a signed value: the unsigned arm at
 * $211610 subtracts $80 in 16-bit two's complement and lets `mulu.w` treat the
 * result as a large positive, which comes out identical once the low byte is
 * taken. The shift is arithmetic, so it rounds towards minus infinity.
 */
export function s3mVolumeTable(signedSource: boolean): Uint8Array {
  const out = new Uint8Array(S3M_VOLUMES * S3M_VOL_ROW)
  for (let vol = 0; vol < S3M_VOLUMES; vol++) {
    for (let b = 0; b < 256; b++) {
      const s = signedSource ? (b << 24) >> 24 : b - 0x80
      out[vol * S3M_VOL_ROW + b] = ((s * vol) >> 6) + 0x80
    }
  }
  return out
}

export interface S3mLevels {
  /** every row end to end, which is how the mixer's single base pointer works */
  data: Int8Array
  /** `$d0(a5)`: where row r starts, r being one less than the channels that sounded */
  rows: Int32Array
}

/**
 * The level table at `$bd8(a5)`, built by $21158c.
 *
 * Row r holds `256 * (r + 1)` entries, which is exactly the range a sum of
 * `r + 1` biased bytes can reach, so a row is never indexed past its end. The
 * entry is `(index - (r + 1) * 128) / divisor`, clamped to a signed byte: the
 * subtraction takes off the bias the volume table put on, once per channel
 * that contributed, and the divisor is the same for every row.
 *
 * That divisor is `channels - boost`, floored at one, and `boost` is large
 * enough to be deliberate --- twelve channels split six a side give a divisor
 * of two, so six channels at full volume clip rather than fit. The clamp at
 * $2115cc is the policy, not an accident.
 */
export function s3mLevelTable(channels: number, boost: number): S3mLevels {
  const n = Math.max(1, channels)
  let total = 0
  for (let r = 0; r < n; r++) total += S3M_VOL_ROW * (r + 1)
  const data = new Int8Array(total)
  const rows = new Int32Array(n)
  // $2115b2 subtracts a long but $2115b6 and $2115ca both read a word
  let div = (n - boost) << 16 >> 16
  if (div < 1) div = 1
  let at = 0
  for (let r = 0; r < n; r++) {
    rows[r] = at
    const bias = (r + 1) * 128
    for (let i = 0; i < S3M_VOL_ROW * (r + 1); i++) {
      const v = Math.trunc((i - bias) / div)
      data[at++] = v > 127 ? 127 : v < -128 ? -128 : v
    }
  }
  return { data, rows }
}

/** `$810(a5)` plus `$1c` per channel: one voice of the mixer */
export interface S3mVoice {
  /** `(a4)`: where in `pcm` this run reads from, rebased at the end of every run */
  at: number
  /** `$4(a4)`: bytes left before the sample or the current loop pass ends */
  left: number
  /** `$8(a4)`: where a loop restarts */
  loopAt: number
  /** `$c(a4)`: how long a loop pass is */
  loopLength: number
  /** `$10(a4)`: ScreamTracker's period, and zero for a voice that is not sounding */
  period: number
  /** `$12(a4)`: 0..64 */
  volume: number
  /** `$14(a4)`: the position, fraction in the HIGH half and index in the low */
  pos: number
  /** `$18(a4)` */
  loops: boolean
  /** `$19(a4)`: set once a sample that does not loop has run out */
  ended: boolean
}

export function s3mVoice(): S3mVoice {
  return { at: 0, left: 0, loopAt: 0, loopLength: 0, period: 0, volume: 0, pos: 0, loops: false, ended: false }
}

/**
 * One channel into the accumulator: $210c46 when `store`, $210e48 otherwise.
 *
 * Returns whether the channel contributed, which is what $210fd2's
 * `addq.w #$1,$ba(a5)` counts and what picks the level table's row. A channel
 * with no period or a finished sample contributes nothing in the adding
 * path and a span of $80 in the storing one, because the storing path has to
 * leave the buffer defined.
 *
 * `master` is `$78(a5)`, and the row used is `(volume * master) >> 6` --- the
 * shift is a word one at $210c8e, so a product over $ffff wraps rather than
 * saturating. Both fields are 0..64 in practice.
 */
export function s3mMix(
  out: Uint16Array,
  count: number,
  voice: S3mVoice,
  pcm: Uint8Array,
  volumes: Uint8Array,
  master: number,
  rate: number,
  store: boolean,
): boolean {
  const put = (from: number, n: number): void => {
    for (let i = from; i < from + n; i++) out[i] = store ? S3M_SILENCE : ((out[i] ?? 0) + S3M_SILENCE) & 0xffff
  }
  // $210c4c and $210e4e. The storing path has to leave the buffer defined, so
  // it writes silence; the adding path just returns, and is the one case where
  // $210fd2 does not count the channel.
  if (voice.period === 0 || voice.ended) {
    if (store) put(0, count)
    return store
  }

  const step = s3mStep(voice.period, rate)
  const swapped = swap32(step)
  // a volume of zero needs no special case: row 0 of the table is $80 throughout,
  // which is what $210dea's position-only loop writes anyway
  const row = (((voice.volume * master) & 0xffff) >> 6) * S3M_VOL_ROW
  let pos = voice.pos >>> 0
  let n = count
  let at = 0

  for (;;) {
    if (voice.left !== 0) {
      // $210cae: how many samples until this segment runs out
      let far = voice.left >>> 0
      if (far > 0xffff) far = ((far & 0xffff0000) | 0xffff) >>> 0
      far = (swap32(far) - swap32(pos)) >>> 0
      // $210cc2 adds one, which is right when the divide truncated and one too
      // many when it came out exact: a sample whose end falls on a step
      // boundary is read one byte past. Kept, because it is a single sample at
      // the moment a note ends and the byte after it is the next sample's.
      //
      // DEVIATION: a step of zero traps the 68020's `divu.l` at $210cba. A
      // period long enough to truncate to zero would take the machine down
      // rather than play slowly, so this port runs the segment out instead.
      let run = step === 0 ? count : Math.trunc(far / step) + 1

      while (n > 0 && run > 0) {
        // the eight-way unrolled body at $210cee, one sample at a time
        const b = volumes[row + (pcm[voice.at + (pos & 0xffff)] ?? S3M_SILENCE)] ?? S3M_SILENCE
        out[at] = store ? b : ((out[at] ?? 0) + b) & 0xffff
        at++
        // add.l d4,d0 then addx.w d5,d0 with d5 zero: the fraction's carry out
        // of bit 31 lands in the index, and the index's carry out of bit 15 is
        // dropped rather than reaching the fraction back
        const sum = pos + swapped
        pos = (((sum & 0xffff0000) | (((sum & 0xffff) + (sum > 0xffffffff ? 1 : 0)) & 0xffff)) >>> 0)
        n--
        run--
      }
      if (n === 0) break
    }

    // $210d68: the segment ended before the tick did
    if (!voice.loops) {
      voice.ended = true
      put(at, n)
      // $14(a4) is not written on this path, and the retrigger clears it
      return true
    }
    // $210d74: the overshoot carries into the loop
    const over = (pos & 0xffff) - voice.left
    voice.at = voice.loopAt + over
    voice.left = voice.loopLength - over
    pos = pos & 0xffff0000
  }

  // $210d9e: fold the integer index into the base and clear it, so the next
  // run starts at index zero and `(a0,d0.w)` never reaches its sign bit
  const idx = pos & 0xffff
  voice.at += idx
  voice.left -= idx
  voice.pos = (pos & 0xffff0000) >>> 0
  if (voice.left < 0) {
    if (!voice.loops) voice.ended = true
    else {
      // $210dbe as written: `suba.l (a4),a0` zeroes the pointer it has just
      // stored, so the restart lands a whole loop BEFORE the loop start rather
      // than the overshoot after it. Kept, because the run above can only
      // undershoot and this path is what the library does when it does not.
      voice.at = voice.loopAt - voice.loopLength
      voice.left += voice.loopLength
    }
  }
  return true
}

/**
 * The accumulator back to signed bytes, off $210aa8.
 *
 * `sounded` is `$ba(a5)`, one for the storing channel and one more for every
 * adding channel that ran, so `rows[sounded - 1]` is the row whose bias
 * matches. The lookup is a plain byte read, and the table has already done the
 * bias, the divide and the clamp.
 */
export function s3mLevel(out: Int8Array, acc: Uint16Array, count: number, levels: S3mLevels, sounded: number): void {
  const base = levels.rows[Math.max(0, sounded - 1)] ?? 0
  for (let i = 0; i < count; i++) out[i] = levels.data[base + acc[i]!] ?? 0
}
