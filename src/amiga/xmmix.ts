/**
 * FastTracker 2's software mixer, off `DME_FastTracker.library` at $210000.
 *
 * Thirty-two channels do not fit in four Paula voices, so this replayer sums
 * them itself at 28,149 Hz and hands Paula a finished stream. It is the same
 * machine as `s3mmix.ts` — same author, six weeks later — and where the two
 * agree the agreement is stated once and cited in both.
 *
 * ## The rate is asked for and then rounded twice
 *
 * $2101aa writes 28,000 into `$62(a5)`, which is a REQUEST rather than a rate.
 * $215390 turns it into a Paula period and then back:
 *
 *   period = 3,546,895 / 28,000  = 126
 *   rate   = 3,546,895 / 126     = 28,149
 *
 * and 126 is what goes into AUD0PER at $215492. So the mixer runs 149 Hz above
 * what it asked for, and every step below is computed against 28,149.
 * ScreamTracker asked for the same 28,000 and got its own answer; the two
 * libraries do not run at the same rate.
 *
 * ## The clock is FastTracker's, quartered
 *
 * `$c6(a5)` is `$369de4` = 3,579,364, written at $211ade, and that is
 * 14,317,456 / 4 — FT2's own 8363 x 1712. The /4 is undone by the shift
 * arrangement at $210ee4:
 *
 *   step = ((clock / period) << 14) / (rate >> 4)
 *
 * which is `noteRate << 16 / rate` before the three truncations. Those cost
 * 0.02% at C-4 --- 8361 Hz where the exact ratio gives 8363 --- and reach
 * 0.33% at the bottom of the note range, where `floor(clock / period)` throws
 * away the same fraction of a smaller quotient. Kept, the same decision
 * `s3mmix.ts` records for ScreamTracker.
 *
 * ## The whole mix path works in unsigned bytes
 *
 * $21177e builds a 65 x 256 table at `$38(a5)`: row v, entry b is
 * `((signed b) * v) >> 6 + $80`. The accumulator adds those biased bytes as
 * words, and a second table takes the bias back off. Silence is $80 per
 * channel, which is what $211044 fills a dead channel's span with (`move.l
 * #$800080,d0`).
 *
 * The signed read is conditional: $21178a takes an UNSIGNED branch when
 * `$a0(a5)` is anything but 1, and $211ae6 sets `$a0(a5)` to 1 for every XM.
 * The unsigned arm is the MOD engine's, and the two formats disagree about
 * what a sample byte means, which is the whole reason the flag exists.
 *
 * ## The level tables, and the count that picks one
 *
 * $211712 builds `$c2(a5)` tables at `$d4(a5)`, one per number of channels
 * that actually sounded on a side. Table r has 256 x (r+1) entries and maps an
 * accumulator value i to `clamp((i - 128 * (r + 1)) / divisor, -128, 127)`,
 * which is exactly "take off the r+1 biases and scale".
 *
 * The divisor is the headroom, and it comes out of a table at $211b2e indexed
 * by `channels - 4`:
 *
 *   divisor = max(1, pairs - (table[channels - 4] >> 7))
 *
 * with `pairs` = `$c2(a5)` = (channels + 1) / 2. The table is 30 words,
 * `64 * (channels / 2 + 3)`, covering 4 to 33 channels. Four channels get a
 * divisor of 1 and thirty-two get 7, so a big module is quieter per voice and
 * a small one is not attenuated at all.
 *
 * $210c1e sets the count to 1 after the first voice on a side stores, and
 * $211244 bumps it once per voice that reaches the END of the add mixer. A
 * voice that exits early — no frequency, no volume, or finished — does not
 * count, so the bias taken off matches the number of channels that put one on.
 *
 * ## Channels 4 to 33, but the table is read from index -2
 *
 * `move.w $c0(a5),d0 / subq.w #$4,d0` at $211a82 does not check its lower
 * bound. A two-channel module indexes -2 and reads $211b2a, which is the
 * `moveq #$0,d0` two instructions earlier, $7000; a three-channel one reads
 * the `rts` at $211b2c, $4e75. Both are enormous once shifted right seven, so
 * the divisor clamps to 1 and nothing audible goes wrong. The two words are
 * spelled out in `XM_HEADROOM` rather than special-cased, because they are
 * what the machine reads.
 *
 * ## LRRL
 *
 * $211abe walks the channels with a counter mod 4 and writes $01 to the status
 * byte for 0 and 3 and $ff for 1 and 2. Left, right, right, left, repeating,
 * which is the Amiga convention and not FT2's per-channel panning. The
 * panning byte in a sample header and the `8xx` and `Cx` commands that set it
 * are read and then never used by anything.
 *
 * ## The position is a byte-swapped 16.16 accumulator
 *
 * `$14(a4)` holds the play position with the FRACTION IN THE HIGH HALF, which
 * is what makes the per-sample body six instructions at $210f60:
 *
 *   move.b (a0,d0.w),d2   the low half is the index, so no shifting
 *   movea.l d2,a1
 *   move.b (a1),d3        the volume table
 *   add.l  d4,d0          fraction and integer in one add
 *   move.w d3,(a2)+       store, or `add.w d3,(a2)+` at $21116a
 *   addx.w d5,d0          d5 is zero: the fraction's carry out of bit 31
 *
 * The loop is unrolled eight wide and entered by `jmp $210f50(pc,d1.w)` on the
 * remainder. This port keeps the arithmetic and drops the unrolling, which is
 * a speed trick and not a sound one.
 */

/** `move.l #$369de4,$c6(a5)` at $211ade: 14,317,456 / 4 */
export const XM_CLOCK = 0x369de4

/** `move.l #$361f0f,$86(a5)` at $21536c: the PAL colour clock */
export const XM_PAL_CLOCK = 0x361f0f

/** `move.l #$6d60,$215662` at $2101aa: what $215390 asks for, not what it gets */
export const XM_REQUESTED_RATE = 0x6d60

/** $215390: `3,546,895 / 28,000`, and AUD0PER at $215492 */
export const XM_PAULA_PERIOD = Math.floor(XM_PAL_CLOCK / XM_REQUESTED_RATE)

/** $215394: `3,546,895 / 126`, and every step is against this */
export const XM_MIX_RATE = Math.floor(XM_PAL_CLOCK / XM_PAULA_PERIOD)

/** $2154a8: AUDxVOL, and the mix is scaled before it ever reaches Paula */
export const XM_PAULA_VOLUME = 0x40

/** 32 voice blocks of $1c bytes at `$814(a5)` */
export const XM_VOICES = 32

/** the volume table's 65 rows at `$38(a5)`, one per 0..64 */
export const XM_VOLUME_ROWS = 65

/** $211abe: 0 and 3 left, 1 and 2 right */
export const XM_LEFT = 1
export const XM_RIGHT = 0xff

/**
 * $211b2e, thirty words, `64 * (channels / 2 + 3)` for four channels to 33.
 *
 * The first two entries are NOT part of it. $211a82 subtracts four from the
 * channel count without a floor, so two and three channels read the two words
 * before the table, which are the tail of $21096a's `moveq #$0,d0 / rts`.
 * They are here at indices 0 and 1 so `xmHeadroom` can index this array with
 * `channels - 2` and never go out of bounds.
 */
export const XM_HEADROOM = Uint16Array.from([
  0x7000, 0x4e75, 320, 320, 384, 384, 448, 448, 512, 512, 576, 576, 640, 640, 704, 704, 768, 768, 832, 832, 896, 896,
  960, 960, 1024, 1024, 1088, 1088, 1152, 1152, 1216, 1216,
])

/**
 * The Amiga period table. $212346 indexes it from $212aa2 with
 * `(note % 12) * 8 + finetune / 16`, and that index is -8 to 95 rather than 0
 * to 95: a C note with any negative finetune reaches below the label. Eight
 * more words are there for it, 960 down to 914, so the table really runs from
 * $212a92 and is 104 words — one octave in 1/8-semitone steps, 960 to 457,
 * and 960/457 is 2.10 rather than 2 because the low eight are the run-up.
 *
 * `XM_PERIOD_BASE` is where index 0 sits in this array.
 */
export const XM_PERIODS = Uint16Array.from([
  960, 954, 948, 940, 934, 926, 920, 914, 907, 900, 894, 887, 881, 875, 868, 862, 856, 850, 844, 838, 832, 826, 820,
  814, 808, 802, 796, 791, 785, 779, 774, 768, 762, 757, 752, 746, 741, 736, 730, 725, 720, 715, 709, 704, 699, 694,
  689, 684, 678, 675, 670, 665, 660, 655, 651, 646, 640, 636, 632, 628, 623, 619, 614, 610, 604, 601, 597, 592, 588,
  584, 580, 575, 570, 567, 563, 559, 555, 551, 547, 543, 538, 535, 532, 528, 524, 520, 516, 513, 508, 505, 502, 498,
  494, 491, 487, 484, 480, 477, 474, 470, 467, 463, 460, 457,
])

/** $212aa2 is eight words into `XM_PERIODS` */
export const XM_PERIOD_BASE = 8

/**
 * The word the interpolation reads when it runs one past the TOP of the table.
 *
 * $212374 looks up `(note % 12) * 8 + finetune / 16` and then the neighbour one
 * step further out. For the twelfth semitone with a positive finetune that
 * second index is 96, and 96 words past $212aa2 is $212b62 — the first long of
 * the linear frequency table, whose high word is 8. A B note with a finetune of
 * 112 or more therefore interpolates 457 against 8 and comes out around thirty,
 * which is a period no oscillator was asked for. Below the table the author
 * put real data; above it he did not.
 */
export const XM_PERIOD_OVERRUN = 8

/**
 * $212b62: 768 longs, `floor(8363 * 64 * 2 ** (-n / 768))`.
 *
 * TRUNCATED, not rounded. Rounding reproduces 400 of the 768 and is off by one
 * on the other 368; the floor is exact on all 768. `xmmix.test.ts` checks the
 * generator against the binary rather than shipping the three kilobytes.
 */
export function xmLinearTable(): Int32Array {
  const out = new Int32Array(768)
  for (let n = 0; n < 768; n++) out[n] = Math.floor(8363 * 64 * 2 ** (-n / 768))
  return out
}

/** `move.l #$da7790,d0` at $211db8: 8363 * 1712 */
export const XM_LINEAR_NUMERATOR = 0xda7790

/**
 * $211d94: a linear period becomes an Amiga-shaped one.
 *
 * `divu.w #$300,d0` splits the period into an octave and a remainder, the
 * remainder indexes the table, the octave shifts it right, and $211db8 divides
 * 8363 x 1712 by the result. What comes out is a period, so the mixer's
 * `clock / period` at $210ee0 does not care which frequency table the module
 * asked for.
 */
export function xmLinearPeriod(period: number, table: Int32Array): number {
  const octave = Math.floor(period / 0x300)
  const rem = period - octave * 0x300
  const v = (table[rem] ?? 0) >>> octave
  if (v === 0) return 0
  return Math.floor(XM_LINEAR_NUMERATOR / v)
}

/**
 * $212346: the Amiga period for a note, interpolated between two finetune
 * steps. `note` is already relative-note-adjusted and clamped to 0..118 by
 * $21231e, and `finetune` is the sample's signed byte.
 */
export function xmAmigaPeriod(note: number, finetune: number): number {
  const octave = Math.floor(note / 12)
  const semi = (note - octave * 12) * 8
  const step = finetune >> 4
  const at = (i: number): number =>
    i === XM_PERIODS.length - XM_PERIOD_BASE ? XM_PERIOD_OVERRUN : (XM_PERIODS[i + XM_PERIOD_BASE] ?? 0)
  const lo = at(semi + step)
  // $212368: the neighbour is one step further from zero, and the weight is
  // the finetune's low nibble either way
  const hi = at(semi + step + (finetune < 0 ? -1 : 1))
  const w = finetune < 0 ? -finetune & 0xf : finetune & 0xf
  let v = lo * (16 - w) + hi * w
  // $212390: `subq.w #$1,d0 / bmi` — octave 0 DOUBLES rather than shifting
  if (octave - 1 < 0) v = v * 2
  else v = v >>> (octave - 1)
  return v & 0xffff
}

/** $211712's divisor: `pairs - (table >> 7)`, floored at one */
export function xmHeadroom(channels: number): number {
  const pairs = (channels + 1) >> 1
  const word = XM_HEADROOM[Math.max(0, Math.min(XM_HEADROOM.length - 1, channels - 2))] ?? 0
  const d = pairs - (word >> 7)
  return d < 1 ? 1 : d
}

/** $2101aa's `$c2(a5)`: (channels + 1) / 2, and how many level tables there are */
export function xmPairs(channels: number): number {
  return (channels + 1) >> 1
}

/**
 * $21177e: 65 rows of 256, `((signed b) * v) >> 6 + $80`.
 *
 * `asr.l #$6` is an arithmetic shift of a negative product, so a quiet
 * negative sample rounds toward minus infinity rather than toward zero. That
 * is a half-bit of asymmetry per voice and it is kept.
 */
export function xmVolumeTable(): Uint8Array {
  const out = new Uint8Array(XM_VOLUME_ROWS * 256)
  for (let v = 0; v < XM_VOLUME_ROWS; v++) {
    for (let b = 0; b < 256; b++) {
      const s = (b << 24) >> 24
      out[v * 256 + b] = ((s * v) >> 6) + 0x80
    }
  }
  return out
}

export type XmLevels = Int8Array[]

/** $211712: one table per sounding count, each `256 * (r + 1)` entries */
export function xmLevelTable(channels: number): XmLevels {
  const pairs = xmPairs(channels)
  const divisor = xmHeadroom(channels)
  const out: XmLevels = []
  for (let r = 0; r < pairs; r++) {
    const n = 256 * (r + 1)
    const row = new Int8Array(n)
    for (let i = 0; i < n; i++) {
      // divs truncates toward zero, which is what `| 0` does here
      let v = ((i - 128 * (r + 1)) / divisor) | 0
      if (v > 127) v = 127
      if (v < -128) v = -128
      row[i] = v
    }
    out.push(row)
  }
  return out
}

/** $210d70: the accumulator through the table for the count that sounded */
export function xmLevel(out: Int8Array, acc: Uint16Array, n: number, levels: XmLevels, sounded: number): void {
  const row = levels[Math.min(levels.length, Math.max(1, sounded)) - 1] ?? levels[0]!
  const last = row.length - 1
  for (let i = 0; i < n; i++) out[i] = row[Math.min(last, acc[i]!)]!
}

/** $211abe: 0 and 3 left, 1 and 2 right, repeating */
export function xmSides(channels: number): Uint8Array {
  const out = new Uint8Array(channels)
  for (let c = 0; c < channels; c++) out[c] = (c & 3) === 0 || (c & 3) === 3 ? XM_LEFT : XM_RIGHT
  return out
}

/** $210ac4: `(rate * 5) / (bpm * 2)`, rounded UP to even at $210ad2 */
export function xmSamplesPerTick(rate: number, bpm: number): number {
  const n = Math.floor((rate * 5) / (bpm * 2)) + 1
  return n & ~1
}

/** $210ed6: `((clock / period) << 14) / (rate >> 4)`, all three truncated */
export function xmStep(period: number, rate: number): number {
  if (period <= 0) return 0
  const hz = Math.floor(XM_CLOCK / period)
  const den = rate >> 4
  if (den === 0) return 0
  return Math.floor((hz * 0x4000) / den)
}

/** one of the 32 blocks of $1c bytes at `$814(a5)` */
export interface XmVoice {
  /** `(a4)`: the sample */
  pcm: Int8Array
  /** `$4(a4)`: the length in frames, halved already for a 16-bit sample */
  length: number
  /** `$8(a4)`: where a loop restarts */
  loopStart: number
  /** `$14(a4)`: the position, and the fraction is 16 bits of it */
  position: number
  /** `$10(a4)`: the period, whichever frequency table produced it */
  period: number
  /** `$12(a4)`: 0..64 */
  volume: number
  /** `$18(a4)`: one boolean, so a ping-pong loop is a forward one */
  looping: boolean
  /** `$19(a4)`: set when a one-shot runs out, and nothing mixes after it */
  ended: boolean
}

export function xmVoice(): XmVoice {
  return { pcm: new Int8Array(0), length: 0, loopStart: 0, position: 0, period: 0, volume: 0, looping: false, ended: true }
}

/**
 * $210eb8 and $2110ba: one voice into the accumulator, storing or adding.
 *
 * Returns whether the voice contributed, which is the test $211244 makes
 * before bumping the sounding count. A silent voice on the STORE pass still
 * fills its span with $80 ($211044), because there is nothing underneath it.
 */
export function xmMix(
  acc: Uint16Array,
  n: number,
  voice: XmVoice,
  volumes: Uint8Array,
  master: number,
  rate: number,
  store: boolean,
): boolean {
  const silent = voice.period === 0 || voice.ended || voice.volume === 0 || voice.length <= 0
  if (silent) {
    if (store) acc.fill(0x80, 0, n)
    return false
  }
  // $210ef8: the voice volume is scaled by the master before it picks a row
  const row = (((voice.volume * master) >> 6) & 0xff) * 256
  const step = xmStep(voice.period, rate)
  const pcm = voice.pcm
  let pos = voice.position
  const len = voice.length << 16
  const loopLen = (voice.length - voice.loopStart) << 16
  for (let i = 0; i < n; i++) {
    if (pos >= len) {
      // $210fda: `tst.b $18(a4)` decides between a wrap and a dead voice
      if (!voice.looping) {
        voice.ended = true
        // $211044: the rest of the span is filled with $80 on the store pass,
        // and left alone on the add pass because something is under it
        if (store) acc.fill(0x80, i, n)
        break
      }
      // $210fe6: back by one loop length, however far past the end it went
      if (loopLen <= 0) pos = voice.loopStart << 16
      else while (pos >= len) pos -= loopLen
    }
    const b = pcm[pos >>> 16] ?? 0
    const v = volumes[row + (b & 0xff)]!
    if (store) acc[i] = v
    else acc[i] = (acc[i]! + v) & 0xffff
    pos += step
  }
  voice.position = pos
  return true
}
