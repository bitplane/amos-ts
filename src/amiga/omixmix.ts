/**
 * OctaMix's mixer proper: the volume tables, the step, and the inner loop.
 *
 * `omix.ts` holds the note tables and the tempo, which are decided before a
 * module is loaded. This holds the parts that depend on the song --- how many
 * channels it mixes, how loud, and what a sample byte turns into.
 *
 * ## Two families of inner loop, and they do not sound alike
 *
 * $21062c mixes an EIGHT-bit sample by indexing a 256-word table:
 *
 *   move.b (a6,d2.l),d3        the sample byte
 *   move.w (a3,d3.w*2),d1      the channel's volume table
 *   add.w  d1,(a2)+            into the accumulator
 *   add.w  d6,d4               the fraction
 *   addx.l d5,d2               and the carry into the index
 *
 * $210556 mixes a SIXTEEN-bit one by shifting:
 *
 *   move.w (a6,d2.l*2),d1
 *   asr.w  d3,d1               `$34(a5)`, a shift and not a multiply
 *   add.w  d1,(a2)+
 *
 * So an 8-bit sample gets all 64 volume steps and a 16-bit one gets powers of
 * two and nothing between. A `C30` on a 16-bit instrument lands on the same
 * shift as a `C20`. That is not a rounding difference, it is the whole volume
 * resolution, and it is why this file keeps the two paths separate rather than
 * scaling both through one table.
 *
 * ## The position is an index and a fraction, not a 16.16
 *
 * `$8(a5)` is a LONG index into the sample and `$c(a5)` is a 16-bit fraction
 * beside it, stepped by `add.w d6,d4 / addx.l d5,d2`. That is why the sample
 * can be longer than 65,536 frames where the byte-swapped 16.16 accumulators in
 * `s3mmix.ts` and `xmmix.ts` cannot: those two fold the index into 16 bits and
 * this one does not.
 *
 * ## The step is the note value over the rate
 *
 * $211142 divides the note value by `$211684`, the rate `omix.ts` calls the
 * actual rate, and stores the quotient at `$12(a0)` and the remainder-derived
 * fraction at `$16(a0)`. Both are `divu.w`, so a note above the rate --- which
 * the top of the note table reaches at any rate below about 63 kHz --- keeps
 * only what fits in sixteen bits.
 *
 * $211140 is the other end of it: a note value of zero does not set a step of
 * zero, it sets bit 7 of `$38(a0)` and takes the channel out of the mix.
 */
import { MMD_FLAG3_STEREO } from './mmd2'

/** `move.b #$40,$38(a0)` at $2111b4: the flags a fresh sample gets */
export const OMIX_FLAG_LOOP = 0x40
/** `bset #$7,$38(a0)` at $21117c: dead, and $2103b0's `bmi` skips it */
export const OMIX_FLAG_OFF = 0x80
/** `bset #$5,$38(a0)` at $21116a: restart the sample rather than continue it */
export const OMIX_FLAG_RESTART = 0x20
/** `btst #$3,$38(a5)` at $2103c2: playing backwards */
export const OMIX_FLAG_BACKWARD = 0x08
/** `btst #$0,$38(a5)` at $210422: the loop turns round rather than wrapping */
export const OMIX_FLAG_PINGPONG = 0x01

/** 64 volumes of 256 words, which is the $8000 $213374 allocates */
export const OMIX_VOLUMES = 64
/** `mulu.w #$1900,d2` at $2133c4 */
export const OMIX_VOLUME_SCALE = 0x1900

/** the neutral `voladj`, against which $213448 and $213464 measure */
export const OMIX_VOLADJ_NEUTRAL = 100

/**
 * $211142: the 16.16 step, as two `divu.w`.
 *
 * `value` is the note table's frequency-shaped number and `rate` is the integer
 * half of `omixActualRate`. The quotient goes to `$12(a0)` and the fraction,
 * taken from the first divide's remainder, to `$16(a0)`.
 */
export function omixStep(value: number, rate: number): number {
  if (rate <= 0) return 0
  const q = Math.floor(value / rate)
  const rem = value - q * rate
  const frac = Math.floor((rem * 0x10000) / rate)
  // both halves are words on the machine, so a step past 65,535 keeps its low
  // half and nothing warns
  return ((q & 0xffff) << 16) | (frac & 0xffff)
}

/**
 * $2133c4: the 64 x 256 word table an 8-bit sample is mixed through.
 *
 * The entry is `(signed b) * 256 * (volume + 1) * voladj / (channels * 6400)`,
 * with `channels` halved first when the song is stereo without bit 1 of flags3
 * and has more than one channel ($2133b4). The divide is `SDivMod32` at
 * $2133e4, so it truncates toward zero and a quiet negative sample rounds up.
 *
 * The `volume + 1` at $2133d6 is not a rounding nicety: it means volume 0 is
 * not silence. A channel at volume 0 still contributes `b * 256 * voladj /
 * (channels * 6400)`, which at the default `voladj` of 100 and four channels
 * is `b / 256` --- inaudible, but present, and the reason a muted channel is
 * muted by `$38`'s bit 7 rather than by its volume.
 */
export function omixVolumeTable(channels: number, voladj: number, flags3 = 0): Int16Array {
  let c = channels
  // $2133b4: stereo without bit 1 halves the load, because each side carries
  // half the channels
  if ((flags3 & MMD_FLAG3_STEREO) !== 0 && (flags3 & 2) === 0 && c > 1) c = c >>> 1
  const divisor = c * OMIX_VOLUME_SCALE
  const out = new Int16Array(OMIX_VOLUMES * 256)
  if (divisor === 0) return out
  for (let v = 0; v < OMIX_VOLUMES; v++) {
    const scale = (v + 1) * voladj
    for (let b = 0; b < 256; b++) {
      // `move.b d4,d0 / lsl.w #$8,d0 / muls.w d5,d0` puts the byte in the high
      // half of a WORD and multiplies it signed, so $80..$ff are negative
      const signed = (((b << 8) & 0xffff) << 16) >> 16
      out[v * 256 + b] = Math.trunc((signed * scale) / divisor)
    }
  }
  return out
}

/**
 * $2133fa: the shift a 16-bit sample is scaled by, at `$34(a5)`.
 *
 * The base is `ceil(log2(channels))` written out as a ladder, then stereo takes
 * one off and `voladj` moves it either way. There is no interpolation anywhere
 * in it: this is the entire volume resolution a 16-bit instrument gets.
 */
export function omixShift(channels: number, voladj: number, flags3 = 0): number {
  let d5: number
  if (channels < 2) d5 = 0
  else if (channels === 2) d5 = 1
  else {
    d5 = 2
    if (channels > 4) d5++
    if (channels > 8) d5++
    if (channels > 16) d5++
    if (channels > 32) d5++
  }
  // $21342a: stereo without bit 1, and only when there is a shift to give back
  if ((flags3 & MMD_FLAG3_STEREO) !== 0 && (flags3 & 2) === 0 && d5 !== 0) d5--
  // $213448: a loud voladj buys headroom back, one step at 200, 400 and 800
  if (d5 !== 0 && voladj >= 200) {
    d5--
    if (d5 !== 0 && voladj >= 400) {
      d5--
      if (d5 !== 0 && voladj >= 800) d5--
    }
  }
  // $213464: and a quiet one spends it, at 100, 50, 25, 13, 7, 4 and 2
  for (const at of [100, 50, 25, 13, 7, 4, 2]) {
    if (voladj >= at) break
    d5++
  }
  return d5
}

/** $212f2e: `trackvol * mastervol >> 4`, which octaplayer does not do at all */
export function omixTrackScale(trackVolume: number, masterVolume: number): number {
  return (trackVolume * masterVolume) >>> 4
}

/** $212b8c: the channel volume scaled by that, before the table is chosen */
export function omixChannelVolume(volume: number, trackScale: number): number {
  return (volume * trackScale) >>> 8
}

/** one $4c block from `$215950`, as the mixer reads it */
export interface OmixVoice {
  /** `$0(a5)`: where the sample starts, as an index into the module */
  sample: number
  /** `$8(a5)` and `$c(a5)`: the index and its 16-bit fraction */
  position: number
  fraction: number
  /** `$10(a5)` low word and `$14(a5)` low word: the step, integer and fraction */
  step: number
  /** `$1c(a5)`: where this run of the sample ends */
  end: number
  /** `$20(a5)`: the loop length, subtracted at $21042a to wrap */
  loopLength: number
  /** `$38(a5)`: the flag byte the four constants above index */
  flags: number
  /** `$2c(a5)`: the 256-word table an 8-bit sample goes through */
  volumeTable: Int16Array | null
  /** `$34(a5)`: the shift a 16-bit sample gets instead */
  shift: number
  /** whether the instrument said sixteen bits, which picks the inner loop */
  sixteenBit: boolean
}

export function omixVoice(): OmixVoice {
  return {
    sample: 0,
    position: 0,
    fraction: 0,
    step: 0,
    end: 0,
    loopLength: 0,
    flags: OMIX_FLAG_OFF,
    volumeTable: null,
    shift: 0,
    sixteenBit: false,
  }
}

/**
 * $21062c and $210556: one voice into the accumulator for `n` samples.
 *
 * `pcm` is the module, because the mixer reads the bank in place; `voice.sample`
 * is an index into it. The accumulator is words, which is what the converters at
 * $2116c6 and $21171c read back two bytes at a time.
 *
 * Returns whether anything was added, which is what $2103b0's `bmi` decides by
 * looking at bit 7.
 */
export function omixMix(acc: Int16Array, n: number, voice: OmixVoice, pcm: Int8Array): boolean {
  if ((voice.flags & OMIX_FLAG_OFF) !== 0 || n <= 0) return false
  const stepInt = (voice.step >>> 16) & 0xffff
  const stepFrac = voice.step & 0xffff
  if (stepInt === 0 && stepFrac === 0) return false
  const table = voice.volumeTable
  if (!voice.sixteenBit && !table) return false

  let pos = voice.position
  let frac = voice.fraction
  let added = false
  for (let i = 0; i < n; i++) {
    // read afresh each iteration: a ping-pong wrap flips bit 3 mid-span
    let back = (voice.flags & OMIX_FLAG_BACKWARD) !== 0
    // $2103de: the run ends when the index reaches `$1c(a5)`. The wrap works
    // on the block's own field, so the running index has to be put back first
    if ((!back && pos >= voice.end) || (back && pos < 0)) {
      voice.position = pos
      if (!wrap(voice)) break
      pos = voice.position
      back = (voice.flags & OMIX_FLAG_BACKWARD) !== 0
    }
    // Int16Array assignment truncates to sixteen bits and wraps, which is
    // exactly what `add.w d1,(a2)+` does; the accumulator is not saturated
    // anywhere in this library
    if (voice.sixteenBit) {
      const at = voice.sample + pos * 2
      // a 16-bit frame, big-endian, as the module stores it
      const s = ((((pcm[at] ?? 0) << 8) | ((pcm[at + 1] ?? 0) & 0xff)) << 16) >> 16
      // `asr.w d3,d1` at $210568, so a negative sample rounds toward minus one
      acc[i] = acc[i]! + (s >> voice.shift)
    } else {
      acc[i] = acc[i]! + table![(pcm[voice.sample + pos] ?? 0) & 0xff]!
    }
    added = true
    frac += stepFrac
    const carry = frac > 0xffff ? 1 : 0
    frac &= 0xffff
    pos += back ? -(stepInt + carry) : stepInt + carry
  }
  voice.position = pos
  voice.fraction = frac
  return added
}

/**
 * $21041a: what happens when a run reaches its end.
 *
 * Bit 6 clear is a one-shot and sets bit 7. Bit 0 set turns the direction round
 * at $210464 rather than wrapping; otherwise $21042a takes one loop length off
 * the index and carries on.
 */
function wrap(voice: OmixVoice): boolean {
  if ((voice.flags & OMIX_FLAG_LOOP) === 0) {
    voice.flags |= OMIX_FLAG_OFF
    return false
  }
  if ((voice.flags & OMIX_FLAG_PINGPONG) !== 0) {
    // $210472 flips bit 3 and $21047c reflects the index back inside the run,
    // `sub / neg / add` against the end
    voice.flags ^= OMIX_FLAG_BACKWARD
    const end = voice.end
    const back = (voice.flags & OMIX_FLAG_BACKWARD) !== 0
    voice.position = back ? end - (voice.position - end) - 1 : -voice.position
    if (voice.position < 0) voice.position = 0
    if (voice.position >= end) voice.position = end - 1
    return true
  }
  if (voice.loopLength <= 0) {
    voice.flags |= OMIX_FLAG_OFF
    return false
  }
  if ((voice.flags & OMIX_FLAG_BACKWARD) !== 0) voice.position += voice.loopLength
  else voice.position -= voice.loopLength
  return true
}

/**
 * The volume table's row for a channel volume, which is what `$2c(a5)` points
 * at rather than the whole table.
 */
export function omixVolumeRow(table: Int16Array, volume: number): Int16Array {
  const v = Math.max(0, Math.min(OMIX_VOLUMES - 1, volume))
  return table.subarray(v * 256, v * 256 + 256)
}

// ---------------------------------------------------------------- the echo

/** `move.l #$3e8,d1` at $2134c0: `mix_echolen` is in MILLISECONDS */
export const OMIX_ECHO_MS = 1000

/**
 * $2134b4: how many frames of delay `mix_echolen` buys.
 *
 * `length * rate / 1000`, with `UDivMod32`, and then $2134cc doubles the byte
 * count once for mono and twice for stereo. So the field really is a time and
 * the buffer follows the rate.
 */
export function omixEchoFrames(echoLengthMs: number, rate: number): number {
  if (rate <= 0) return 0
  return Math.floor((echoLengthMs * rate) / OMIX_ECHO_MS)
}

/**
 * $211a0c: a feedback delay, three ways.
 *
 * The core is four instructions and it is the same in all three:
 *
 *   move.w (a1),d0      the delayed sample
 *   asr.w  d6,d0        `mix_echodepth`, a shift
 *   add.w  d0,(a0)      into the output
 *   move.w (a0)+,(a1)+  and the SUM goes back into the line
 *
 * Writing the sum back rather than the input is what makes it recirculate: the
 * line holds signal that has already been echoed, so it decays by `2 ** -depth`
 * a lap rather than repeating once.
 *
 * `type` 2 with stereo is the cross-feed at $211adc, which adds the right
 * delayed sample to the LEFT output and the left to the right. Everything else
 * runs each side through its own tap.
 *
 * `pos` walks the line in frames and wraps at `frames` ($211a50), and the mix
 * buffer is consumed in the same units, which is why a delay shorter than a
 * buffer is spliced across several passes rather than being one memcpy.
 */
export function omixEcho(
  acc: Int16Array,
  n: number,
  line: Int16Array,
  pos: number,
  depth: number,
  stereo: boolean,
  type: number,
): number {
  const frames = stereo ? line.length >>> 1 : line.length
  if (frames <= 0 || n <= 0) return pos
  const cross = stereo && type === 2
  let p = pos
  for (let i = 0; i < n; i++) {
    // $211a50: the read position wraps before the frame, not after it
    if (p >= frames) p = 0
    if (stereo) {
      const l = acc[i * 2]!
      const r = acc[i * 2 + 1]!
      const dl = line[p * 2]!
      const dr = line[p * 2 + 1]!
      if (cross) {
        acc[i * 2] = l + (dr >> depth)
        acc[i * 2 + 1] = r + (dl >> depth)
      } else {
        acc[i * 2] = l + (dl >> depth)
        acc[i * 2 + 1] = r + (dr >> depth)
      }
      line[p * 2] = acc[i * 2]!
      line[p * 2 + 1] = acc[i * 2 + 1]!
    } else {
      acc[i] = acc[i]! + (line[p]! >> depth)
      line[p] = acc[i]!
    }
    p++
  }
  return p
}

// -------------------------------------------------------- the stereo spread

/** $211bd2 and $211c30: the shift is five either side of the separation */
export const OMIX_SPREAD_BASE = 5

/**
 * $211bc4: `mix_stereosep` as a two-by-two matrix on the finished frames.
 *
 * A positive separation WIDENS by subtracting a shifted copy of the other side,
 * a negative one narrows by adding it, and the shift is `5 - sep` or `sep + 5`.
 * So a separation of 5 subtracts the whole of the other channel and a
 * separation of -5 adds it, which is hard left-right and mono respectively.
 *
 * Both sides are read before either is written ($211bda and $211bdc), so it is
 * a matrix and not two sequential subtractions. Getting that wrong would make
 * the right channel depend on the already-widened left.
 *
 * $2119ee gates the whole thing on the field being non-zero AND bit 0 of
 * flags3, so a mono song never reaches it whatever the separation says.
 */
export function omixStereoSpread(acc: Int16Array, n: number, separation: number): void {
  if (separation === 0 || n <= 0) return
  const widen = separation > 0
  // `asr.w` takes its count modulo 64, so a separation past five wraps into an
  // enormous shift rather than clamping. Reproduced by masking the same way.
  const shift = (widen ? OMIX_SPREAD_BASE - separation : separation + OMIX_SPREAD_BASE) & 63
  for (let i = 0; i < n; i++) {
    const l = acc[i * 2]!
    const r = acc[i * 2 + 1]!
    if (widen) {
      acc[i * 2] = l - (r >> shift)
      acc[i * 2 + 1] = r - (l >> shift)
    } else {
      acc[i * 2] = l + (r >> shift)
      acc[i * 2 + 1] = r + (l >> shift)
    }
  }
}
