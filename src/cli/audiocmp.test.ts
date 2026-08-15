/**
 * The measuring half of #130, checked on signals whose answer is known.
 *
 * These matter more than most tool tests: the numbers they produce are what
 * decides whether a replayer agrees with an independent player, so a bug here
 * would either hide a real difference or invent one. Every case below has an
 * analytic answer rather than a recorded one.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BANDS, bands, bestAlignment, chroma, correlate, cosine, envelope, mono, readWav, spectrum } from './audiocmp'
import { detectEngine, renderModule, wavBytes } from './renderaudio'

const RATE = 44100

/** n seconds of a sine at `hz`, full scale */
function sine(hz: number, seconds: number, rate = RATE): Float32Array {
  const x = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * hz * i) / rate)
  return x
}

describe('the WAV pair', () => {
  it('reads back what renderaudio writes, sample for sample', () => {
    const pcm = new Float32Array([1, -1, 0.5, -0.5, 0, 0])
    const w = readWav(wavBytes(pcm, RATE, 1))
    expect(w.rate).toBe(RATE)
    // both rails land one step inside, because the scale is 32767 rather than
    // 32768: it costs a step of headroom and avoids the asymmetric clip
    expect(w.left[0]).toBeCloseTo(1, 4)
    expect(w.right[0]).toBeCloseTo(-1, 4)
    expect([w.left[1], w.left[2]]).toEqual([0.5, 0])
  })

  it('applies the gain before the clamp, which is what the headroom is for', () => {
    // a channel is two voices, so PaulaMixer's full scale is 2.0
    const w = readWav(wavBytes(new Float32Array([2, -2]), RATE, 0.5))
    expect(w.left[0]).toBeCloseTo(1, 3)
    expect(w.right[0]).toBeCloseTo(-1, 3)
  })

  it('refuses a file that is not a RIFF/WAVE', () => {
    expect(() => readWav(Buffer.from('not a wav at all, really'))).toThrow(/RIFF/)
  })
})

describe('the envelope alignment', () => {
  /** something with structure at several scales, so the search has work to do */
  const shape = (t: number): number => 1 + Math.sin(t / 7) + 0.4 * Math.sin(t / 2.3) + 0.2 * Math.sin(t / 1.1)

  it('recovers a time scale and an offset that were put there on purpose', () => {
    const a = Float32Array.from({ length: 900 }, (_, i) => shape(i))
    const ratio = 1.005
    const lag = 3
    const b = Float32Array.from({ length: 900 }, (_, k) => shape((k - lag) / ratio))
    const got = bestAlignment(a, b, 20)
    expect(got.ratio).toBeCloseTo(ratio, 3)
    expect(got.lag).toBe(lag)
    expect(got.r).toBeGreaterThan(0.999)
  })

  it('reports 1 and 0 when the two are already the same', () => {
    const a = Float32Array.from({ length: 400 }, (_, i) => shape(i))
    const got = bestAlignment(a, a, 20)
    expect(got.lag).toBe(0)
    expect(got.ratio).toBeCloseTo(1, 4)
  })

  it('correlates a signal with itself at 1 and with noise at nothing much', () => {
    const a = Float32Array.from({ length: 400 }, (_, i) => shape(i))
    const flat = new Float32Array(400).fill(1)
    expect(correlate(a, a, 1, 0)).toBeCloseTo(1, 6)
    expect(correlate(a, flat, 1, 0)).toBe(0)
  })

  it('is the RMS of each window, so silence reads zero and full scale reads one', () => {
    const x = new Float32Array(300)
    x.fill(1, 100, 200)
    const e = envelope(x, 100)
    expect([...e].map((v) => Math.round(v * 100) / 100)).toEqual([0, 1, 0])
  })
})

describe('the pitch-class fold', () => {
  it('puts a 440Hz sine on A and nowhere else', () => {
    const c = chroma(spectrum(sine(440, 1)), RATE)
    expect(c.indexOf(Math.max(...c))).toBe(9) // C C# D D# E F F# G G# A
    expect(c[9]!).toBeGreaterThan(0.9)
  })

  it('reads an octave apart as the same class, which is why an octave bug needs the bands too', () => {
    const low = chroma(spectrum(sine(220, 1)), RATE)
    const high = chroma(spectrum(sine(440, 1)), RATE)
    expect(cosine(low, high)).toBeGreaterThan(0.99)
    // and the bands are where it shows: 220 is in one, 440 in the next
    const bl = bands(spectrum(sine(220, 1)), RATE)
    const bh = bands(spectrum(sine(440, 1)), RATE)
    expect(bl.indexOf(Math.max(...bl))).toBe(BANDS.indexOf(200))
    expect(bh.indexOf(Math.max(...bh))).toBe(BANDS.indexOf(400))
  })

  it('separates a fifth from a unison', () => {
    const a = chroma(spectrum(sine(440, 1)), RATE)
    const e = chroma(spectrum(sine(659.26, 1)), RATE)
    expect(cosine(a, e)).toBeLessThan(0.1)
  })
})

describe('engine detection', () => {
  const magic = (s: string, at = 0, size = at + 16): Uint8Array => {
    const d = new Uint8Array(size)
    for (let i = 0; i < s.length; i++) d[at + i] = s.charCodeAt(i)
    return d
  }

  it('names an engine from the bytes at the front, and MOD from the tag at 1080', () => {
    expect(detectEngine(magic('MMD0'))).toBe('med')
    expect(detectEngine(magic('MMD1'))).toBe('med')
    expect(detectEngine(magic('THX\0'))).toBe('thx')
    expect(detectEngine(magic('P61A'))).toBe('p61')
    expect(detectEngine(magic('M.K.', 1080, 1084 + 4))).toBe('mod')
  })

  it('says nothing rather than guessing', () => {
    expect(detectEngine(magic('junk'))).toBeNull()
    expect(detectEngine(new Uint8Array(4))).toBeNull()
  })
})

/**
 * The shipped AMOS example, which is a plain ProTracker module: `Mod.Tracker`
 * from Examples/Music. It is not redistributed here, so this skips without it.
 *
 * Two engines, one module, and they have to agree: `protracker.ts` is AMCAF's
 * port of Player 6.1A and `music.ts` is AMOS's own tracker out of +Music.s.
 * Both were written from their own sources and neither has ever been compared
 * with the other.
 */
const MOD = join(__dirname, '../../fixtures/official-amos/Examples/Music/Mod.Tracker')

describe.skipIf(!existsSync(MOD))('two replayers on one module', () => {
  const render = (engine: 'mod' | 'track'): Float32Array =>
    renderModule(new Uint8Array(readFileSync(MOD)), engine, {
      seconds: 6,
      rate: 22050,
      filter: false,
    })

  it('both make sound, and the same notes', () => {
    const pt = render('mod')
    const amos = render('track')
    const wav = (x: Float32Array): { left: Float32Array; right: Float32Array; rate: number } =>
      readWav(wavBytes(x, 22050, 0.5))
    const a = mono(wav(pt))
    const b = mono(wav(amos))
    const peak = (x: Float32Array): number => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    expect(peak(a)).toBeGreaterThan(0.1)
    expect(peak(b)).toBeGreaterThan(0.1)
    expect(cosine(chroma(spectrum(a), 22050), chroma(spectrum(b), 22050))).toBeGreaterThan(0.99)
  })

  it('start one frame apart, because Track Play runs inside a frame and the direct arm does not', () => {
    const first = (x: Float32Array): number => {
      for (let i = 0; i < x.length; i += 2) if (Math.abs(x[i]!) > 0.004) return i / 2
      return -1
    }
    // 610.2_devpac3.asm:764 is `beq`, and the counter starts at 0, so row 0
    // plays on the SIXTH tick: 100ms in, not at zero
    expect(first(render('mod')) / 22050).toBeCloseTo(0.1, 2)
    expect(first(render('track')) / 22050).toBeCloseTo(0.12, 2)
  })
})
