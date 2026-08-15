/**
 * FutureComposer 1.0-1.3's forty-seven built-in waveforms, generated.
 *
 * An FC 1.3 module carries no samples. Ours is 4,936 bytes and all ten of its
 * sample-header lengths are zero: every instrument in the tune is one of the
 * waveforms the REPLAYER owns, named by index. That is the whole reason a
 * finished FC tune fits in five kilobytes.
 *
 * `DME_FC1.3.library` holds them as 1,344 bytes of PCM at $211200, and this
 * port does not ship other people's binaries. So the table is not copied here.
 * It is REGENERATED: the shapes turned out to be four parametric families that
 * a script could fit exactly, which is what the 1989 author must have run
 * offline before pasting the output into his replayer. He precomputed because
 * a 7MHz 68000 could not synthesise a waveform every frame. Nothing here has
 * that problem, so the generator is what ships and the table is what it makes.
 *
 * FORTY-FIVE OF THE FORTY-SEVEN COME OUT BYTE-EXACT. `fc13waves.test.ts`
 * checks that against the library when it is present, which is the only claim
 * worth making about a reconstruction.
 *
 * ## The families
 *
 * The lengths and the count are format, not content: a module says "waveform
 * 23" and the table has to be 47 entries at these exact sizes or the index
 * means something else. What each one CONTAINS is arithmetic.
 *
 *   0-15   32 bytes  a triangle with a pulse-width step
 *   16-31  32 bytes  a two-level pulse, width 16 to 31
 *   32-39  16 bytes  a two-level pulse, width 8 down to 1
 *   40     32 bytes  a rising sawtooth
 *   41     16 bytes  the same, twice as coarse
 *   42-43  32 bytes  a decay. THE TWO THAT ARE NOT EXACT
 *   44-45  16 bytes  a triangle, stored twice
 *   46     48 bytes  40 and 41 end to end
 *
 * ## The rule that runs through all of them
 *
 * Every waveform has its SECOND sample overwritten with its first. It shows up
 * as the doubled value every one of them opens with, and it is the ordinary
 * Amiga precaution: Paula fetches the first word of a looping sample during
 * the relatch, so a waveform that changes underneath a running voice wants its
 * first two bytes to agree.
 *
 * It is also what makes waveforms 38 and 39 identical, and 44 and 45. Their
 * generated widths are 2 and 1, and 1 becomes 2 once the overwrite lands.
 * Two pairs of duplicates that look like padding are a side effect of one rule.
 *
 * ## Where it is not exact
 *
 * 42 and 43 are the only two that are not a primitive: both rise to +125 in
 * three samples and then fall monotonically for twenty-nine, on a curve with
 * no equation behind it. Digitised, most likely. They are approximated by a
 * fall of the same contour between the same endpoints.
 *
 * DEVIATION: those two waveforms are this port's shape, not the library's. Any
 * FC 1.3 instrument that names 42 or 43 has a timbre close to the original's
 * rather than equal to it. Every other instrument is the original's samples.
 */

/** the count is format: a module names a waveform by its index into this */
export const FC13_WAVES = 47
/** the two the fit could not reach, and so the two this port only approximates */
export const FC13_APPROXIMATED: readonly number[] = [42, 43]

/**
 * Paula fetches the first word of a looping sample during the relatch, so
 * every one of these has its second sample overwritten with its first.
 */
const relatchGuard = (w: number[]): number[] => {
  if (w.length > 1) w[1] = w[0]!
  return w
}

/**
 * A triangle over `n` samples: up from `-mid` to the peak, down to the trough,
 * back. `step` is what it moves per sample.
 */
const triangle = (n: number, step: number, from: number): number[] => {
  const quarter = n / 4
  return [...Array(n)].map((_, i) => {
    const v = i <= quarter ? from + step * i
      : i <= 3 * quarter ? from + step * quarter - step * (i - quarter)
      : from - step * quarter + step * (i - 3 * quarter)
    return Math.max(-128, Math.min(127, v))
  })
}

/** two levels, `lo` until `width` and `hi` after it */
const pulse = (n: number, width: number, lo: number, hi: number): number[] =>
  [...Array(n)].map((_, i) => (i < width ? lo : hi))

/** a rising ramp from -128 by `step`, optionally ending on full scale */
const sawtooth = (n: number, step: number, endsFull: boolean): number[] => {
  const w = [...Array(n)].map((_, i) => Math.max(-128, Math.min(127, -128 + step * i)))
  if (endsFull) w[n - 1] = 127
  return w
}

/**
 * The two irregulars, approximated rather than fitted.
 *
 * Both open 69, 69, 121, 125 and then fall monotonically for twenty-eight
 * samples, 42 to -118 and 43 to -125. Here that fall is a straight line
 * between the same endpoints. Fitting their curve more tightly was possible
 * and is not the job: a close fit is their data recovered by another route,
 * where a plain ramp is a shape of this port's own with the same attack, the
 * same span and the same place in the family.
 */
const decay = (to: number): number[] => {
  const head = [69, 69, 121, 125]
  const n = 32 - head.length
  const tail = [...Array(n)].map((_, i) =>
    Math.max(-128, Math.min(127, Math.round(125 + ((to - 125) * (i + 1)) / n))))
  return head.concat(tail)
}

/**
 * All forty-seven, in index order.
 *
 * Fresh arrays every call, because a caller hands them to an `AudioSink` that
 * may hold onto the buffer.
 */
export function fc13Waves(): Int8Array[] {
  const out: number[][] = []

  // 0-15: one triangle, and a DC step of +127 from sample 16+k onward. The
  // triangle sits at -64 with an amplitude of 64, so the stepped half runs
  // from -1 to 63 and the unstepped from -128 to 0
  for (let k = 0; k < 16; k++) {
    const base = triangle(32, 8, -64)
    out.push(relatchGuard(base.map((v, i) => (i < 16 + k ? v : v + 127))))
  }
  // 16-31: a full-scale pulse of 32, the low half growing one sample at a time.
  // The last two sit one lower than the rest, which is the table as it is
  for (let k = 0; k < 16; k++) out.push(relatchGuard(pulse(32, 16 + k, k < 14 ? -127 : -128, 127)))
  // 32-39: the same idea at half the length and the other way round. Width 1
  // becomes width 2 once the relatch guard lands, so 38 and 39 come out equal
  for (let k = 0; k < 8; k++) out.push(relatchGuard(pulse(16, 8 - k, -128, 127)))

  out.push(relatchGuard(sawtooth(32, 8, true))) // 40
  out.push(relatchGuard(sawtooth(16, 16, false))) // 41
  out.push(relatchGuard(decay(-118))) // 42
  out.push(relatchGuard(decay(-125))) // 43
  out.push(relatchGuard(triangle(16, 32, 0))) // 44
  out.push(relatchGuard(triangle(16, 32, 0))) // 45
  // 46 is 40 and 41 laid end to end, which the offsets in the library's own
  // table say outright: 46 starts where 40 does and runs 48 bytes
  out.push(out[40]!.concat(out[41]!))

  return out.map((w) => Int8Array.from(w))
}

/**
 * The ten module samples and then the forty-seven, which is the table a
 * frequency sequence indexes with `lsl.w #$4,d0`... except FC 1.3 uses ten
 * bytes an entry rather than sixteen (`d0 * 2 + d0 * 8` at $210b84).
 */
export const FC13_MODULE_SAMPLES = 10
