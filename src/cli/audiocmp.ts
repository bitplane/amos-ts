/**
 * Compare two rendered WAVs: same notes, same balance, same tempo?
 *
 *   npm run cli -- src/cli/audiocmp.ts <a.wav> <b.wav> [--hop MS] [--window S]
 *
 * The other half of `renderaudio.ts`. A is the reference by convention and B
 * is this port, which only matters for the sign of the numbers.
 *
 * Nothing here expects the two to match sample for sample and they never will:
 * a reference player interpolates where Paula holds a byte for a period, and
 * every player picks its own output gain. What the three measurements ask is
 * narrower and answerable.
 *
 * - **Pitch classes.** Fold the spectrum onto the twelve semitones and take
 *   the cosine. It ignores octave-independent timbre and gain and is brutal
 *   about wrong notes. MED's two-octave bug read 0.9176 where the fix reads
 *   0.9989, so the useful range is the top two percent and anything under 0.99
 *   is worth opening.
 * - **Octave bands.** Where the energy sits, in dB relative. Below 1600 Hz two
 *   readings of the same module agree within a dB; above it they part company
 *   over interpolation and filtering, which is a difference about the machine
 *   rather than about the module.
 * - **Tempo ratio and lag.** The loudness envelopes are matched over a search
 *   of both a time scale and an offset. A lag that WALKS is a tempo ratio, and
 *   the ratio is the interesting number: 1.0038 between this port and
 *   libopenmpt on a MED module is 50.000/49.809, which is openmpt rounding the
 *   tempo to the PAL frame where this port takes the CIA timer period.
 */
import { readFileSync } from 'node:fs'

export interface Wav {
  rate: number
  left: Float32Array
  right: Float32Array
}

export function readWav(bytes: Buffer): Wav {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file')
  }
  let at = 12
  let rate = 44100
  let channels = 2
  let bits = 16
  let data = -1
  let length = 0
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('ascii', at, at + 4)
    const size = bytes.readUInt32LE(at + 4)
    if (id === 'fmt ') {
      channels = bytes.readUInt16LE(at + 10)
      rate = bytes.readUInt32LE(at + 12)
      bits = bytes.readUInt16LE(at + 22)
    } else if (id === 'data') {
      data = at + 8
      length = Math.min(size, bytes.length - data)
      break
    }
    at += 8 + size + (size & 1)
  }
  if (data < 0) throw new Error('no data chunk')
  if (bits !== 16) throw new Error(`only 16-bit PCM here, not ${bits}`)
  const step = 2 * channels
  const n = Math.floor(length / step)
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    left[i] = bytes.readInt16LE(data + i * step) / 32768
    right[i] = channels > 1 ? bytes.readInt16LE(data + i * step + 2) / 32768 : left[i]!
  }
  return { rate, left, right }
}

export const mono = (w: Wav): Float32Array => {
  const m = new Float32Array(w.left.length)
  for (let i = 0; i < m.length; i++) m[i] = (w.left[i]! + w.right[i]!) / 2
  return m
}

/** RMS per window of `win` samples */
export function envelope(x: Float32Array, win: number): Float32Array {
  const n = Math.floor(x.length / win)
  const e = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 0; k < win; k++) s += x[i * win + k]! ** 2
    e[i] = Math.sqrt(s / win)
  }
  return e
}

/** Pearson's r between a and b[i * ratio + lag], sampled linearly */
export function correlate(a: Float32Array, b: Float32Array, ratio: number, lag: number): number {
  let n = 0
  let sa = 0
  let sb = 0
  const at = (i: number): number => {
    const t = i * ratio + lag
    const k = Math.floor(t)
    if (k < 0 || k + 1 >= b.length) return NaN
    return b[k]! + (b[k + 1]! - b[k]!) * (t - k)
  }
  for (let i = 0; i < a.length; i++) {
    const v = at(i)
    if (Number.isNaN(v)) continue
    sa += a[i]!
    sb += v
    n++
  }
  if (n < 8) return 0
  const ma = sa / n
  const mb = sb / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    const v = at(i)
    if (Number.isNaN(v)) continue
    const x = a[i]! - ma
    const y = v - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
}

/**
 * The time scale and offset that line the two envelopes up best.
 *
 * Coarse over ratio then fine around the winner, because the useful resolution
 * is about one part in ten thousand and a flat search at that step would be
 * four hundred passes over the whole file.
 */
export function bestAlignment(
  a: Float32Array,
  b: Float32Array,
  maxLag: number,
): { ratio: number; lag: number; r: number } {
  let best = { ratio: 1, lag: 0, r: -1 }
  const sweep = (from: number, to: number, step: number): void => {
    for (let ratio = from; ratio <= to + 1e-9; ratio += step) {
      for (let lag = -maxLag; lag <= maxLag; lag++) {
        const r = correlate(a, b, ratio, lag)
        if (r > best.r) best = { ratio, lag, r }
      }
    }
  }
  sweep(0.97, 1.03, 0.002)
  const around = best.ratio
  sweep(around - 0.002, around + 0.002, 0.0001)
  return best
}

/** in-place radix-2 FFT */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!
      const ti = im[i]!
      re[i] = re[j]!
      im[i] = im[j]!
      re[j] = tr
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const half = len / 2
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(ang * k)
        const wi = Math.sin(ang * k)
        const ur = re[i + k]!
        const ui = im[i + k]!
        const vr = re[i + k + half]! * wr - im[i + k + half]! * wi
        const vi = re[i + k + half]! * wi + im[i + k + half]! * wr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + half] = ur - vr
        im[i + k + half] = ui - vi
      }
    }
  }
}

export const FFT_SIZE = 4096

/** average magnitude spectrum, Hann windowed, non-overlapping */
export function spectrum(x: Float32Array, size = FFT_SIZE): Float64Array {
  const acc = new Float64Array(size / 2)
  let frames = 0
  const window = Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size))
  for (let o = 0; o + size <= x.length; o += size) {
    const re = new Float32Array(size)
    const im = new Float32Array(size)
    for (let i = 0; i < size; i++) re[i] = x[o + i]! * window[i]!
    fft(re, im)
    for (let i = 0; i < size / 2; i++) acc[i]! += Math.hypot(re[i]!, im[i]!)
    frames++
  }
  if (frames > 0) for (let i = 0; i < acc.length; i++) acc[i]! /= frames
  return acc
}

/** the twelve semitones, as a fraction of the energy between 60 and 5000 Hz */
export function chroma(spec: Float64Array, rate: number, size = FFT_SIZE): number[] {
  const c = Array<number>(12).fill(0)
  for (let i = 2; i < spec.length; i++) {
    const hz = (i * rate) / size
    if (hz < 60 || hz > 5000) continue
    const midi = Math.round(69 + 12 * Math.log2(hz / 440))
    c[((midi % 12) + 12) % 12]! += spec[i]!
  }
  const total = c.reduce((s, v) => s + v, 0)
  return total > 0 ? c.map((v) => v / total) : c
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let la = 0
  let lb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    la += a[i]! ** 2
    lb += b[i]! ** 2
  }
  return la > 0 && lb > 0 ? dot / Math.sqrt(la * lb) : 0
}

export const BANDS = [0, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 22050]

/** each band's share of the total, so the comparison survives a gain difference */
export function bands(spec: Float64Array, rate: number, size = FFT_SIZE): number[] {
  const total = spec.reduce((s, v) => s + v, 0)
  return BANDS.slice(0, -1).map((lo, i) => {
    const hi = BANDS[i + 1]!
    let sum = 0
    for (let k = Math.floor((lo * size) / rate); k < Math.min(spec.length, Math.floor((hi * size) / rate)); k++) {
      sum += spec[k]!
    }
    return total > 0 ? sum / total : 0
  })
}

const db = (x: number): string => (x > 0 ? (20 * Math.log10(x)).toFixed(2) : '-inf')

if (process.argv[1]?.endsWith('audiocmp.ts')) {
  const args = process.argv.slice(2)
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const taken = new Set([opt('--hop'), opt('--window')].filter((v) => v !== undefined))
  const files = args.filter((a) => !a.startsWith('--') && !taken.has(a))
  if (files.length !== 2) {
    console.error('usage: audiocmp <reference.wav> <ours.wav> [--hop MS] [--window S]')
    process.exit(1)
  }
  const A = readWav(readFileSync(files[0]!))
  const B = readWav(readFileSync(files[1]!))
  const hopMs = Number(opt('--hop') ?? 10)
  const win = Math.round((A.rate * hopMs) / 1000)
  const ma = mono(A)
  const mb = mono(B)
  const rms = (x: Float32Array): number => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length))

  console.log(`A ${files[0]}  ${(ma.length / A.rate).toFixed(2)}s  RMS ${db(rms(ma))}dB`)
  console.log(`B ${files[1]}  ${(mb.length / B.rate).toFixed(2)}s  RMS ${db(rms(mb))}dB`)

  const sa = spectrum(ma)
  const sb = spectrum(mb)
  const ca = chroma(sa, A.rate)
  const cb = chroma(sb, B.rate)
  console.log(`\npitch-class cosine  ${cosine(ca, cb).toFixed(4)}`)
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  console.log(names.map((n, i) => `${n} ${(ca[i]! * 100).toFixed(1)}/${(cb[i]! * 100).toFixed(1)}`).join('  '))

  const ba = bands(sa, A.rate)
  const bb = bands(sb, B.rate)
  console.log('\nband            A        B     diff')
  BANDS.slice(0, -1).forEach((lo, i) => {
    console.log(
      `${String(lo).padStart(5)}-${String(BANDS[i + 1]).padEnd(6)} ` +
        `${(ba[i]! * 100).toFixed(2).padStart(6)}%  ${(bb[i]! * 100).toFixed(2).padStart(6)}%  ` +
        `${db(bb[i]! / Math.max(1e-12, ba[i]!)).padStart(7)} dB`,
    )
  })

  const ea = envelope(ma, win)
  const eb = envelope(mb, win)
  const n = Math.min(ea.length, eb.length)
  const whole = bestAlignment(ea.subarray(0, n), eb.subarray(0, n), Math.round(500 / hopMs))
  console.log(
    `\nenvelope: ratio ${whole.ratio.toFixed(4)}  lag ${(whole.lag * hopMs).toFixed(0)}ms  r ${whole.r.toFixed(3)}` +
      `   (r ${correlate(ea.subarray(0, n), eb.subarray(0, n), 1, 0).toFixed(3)} at ratio 1, lag 0)`,
  )
  const windowSec = Number(opt('--window') ?? 5)
  const per = Math.round((windowSec * 1000) / hopMs)
  for (let s = 0; s + per <= n; s += per) {
    const w = bestAlignment(ea.subarray(s, s + per), eb.subarray(s, s + per), Math.round(300 / hopMs))
    console.log(
      `  ${((s * hopMs) / 1000).toFixed(0)}-${(((s + per) * hopMs) / 1000).toFixed(0)}s  ` +
        `r ${w.r.toFixed(3)}  ratio ${w.ratio.toFixed(4)}  lag ${(w.lag * hopMs).toFixed(0)}ms`,
    )
  }
}
