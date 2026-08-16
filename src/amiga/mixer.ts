/**
 * The four voices summed into PCM: `AudioSink` that renders rather than
 * records.
 *
 * ## Why this exists, and why it did not before
 *
 * `paula.ts` carried the line "Mixing is absent, deliberately" for as long as
 * every replayer here was a four-channel one. `AudioSink.play()` hands a
 * buffer, a rate, a volume and a loop region to whoever is listening, and a
 * ProTracker voice maps onto that one to one, so a browser could let Web Audio
 * do the rendering and a test could read the arguments back.
 *
 * Two things that mapping cannot express:
 *
 * - **More voices than Paula has.** octaplayer.library plays MMD2 on five to
 *   eight channels and octamixplayer.library plays MMD3 on up to 64, both by
 *   summing into Paula's four in software. Rendering is the whole mechanism
 *   rather than a back end for it.
 * - **Output as a thing to check.** A test over the event stream asserts that
 *   the replayer asked for period 428 at volume 40. It cannot tell whether the
 *   sample that came out is the one the module names, because nothing here had
 *   ever turned a period and a buffer into a number.
 *
 * ## The clock
 *
 * A mixer needs to know WHEN a register write happened, not just that it did,
 * and `AudioSink` had no time on it at all. `runTo(t)` is that time: the sink
 * renders forward to `t` seconds, and every call after it lands at `t`. A
 * replayer with sub-frame timing names each tick's instant (MED's CIA fires at
 * 24 to 500 Hz, `runtime/med.ts`), and `Runtime.frame()` closes the frame.
 *
 * The frame count comes off the absolute clock rather than off each span, so
 * an instant that is not a whole sample cannot accumulate. A MED tick at 293.5
 * Hz is 150.28 frames at 44100, and summing 587 of those spans lands a whole
 * frame short of a second.
 *
 * ## What the chip does that this does
 *
 * - **The stair-step.** The DMA fetches one byte per period and holds it, so
 *   the output is a stair-step and the harmonics that puts above Nyquist are
 *   the analog filter's business. Interpolating between source bytes would be
 *   a nicer sound and a different machine, and this does not do it.
 *
 *   What it does do is READ that stair-step correctly. Each output frame is
 *   the average of the held bytes across the period it covers, weighted by how
 *   long each one is held inside it, which is what a meter on the jack would
 *   measure. Poking at one point per frame instead folds the step edges back
 *   down into the audible band, and how much depends on how close the source
 *   rate is to a factor of the output rate --- nothing the machine has any
 *   say in. OctaMED's 5-8 channel mode is what found it: everything it plays
 *   comes out of one buffer clocked at 15,625 Hz, 44,100 is 2.8224 of those,
 *   and point sampling put 7 dB of broadband hash above 12.8 kHz that a render
 *   at 62,500 --- an exact four times 15,625 --- did not have.
 * - **The stereo pairing.** Voices 0 and 3 are the left channel, 1 and 2 the
 *   right. Not a preference: they are separate DACs wired to separate jacks.
 * - **Volume is instant.** AUDxVOL takes effect at the next sample, and a
 *   tracker cutting a note from 64 to 0 in one write gets the click the
 *   machine gives it.
 * - **A voice at volume 0 still runs.** The pointer keeps moving, so the
 *   sample a voice resumes at is where the DMA got to and not where it was
 *   silenced.
 *
 * ## Full scale
 *
 * One voice at AUDxVOL 64 on the deepest sample byte (-128) renders -1.0, so a
 * channel with both its voices there reaches -2.0. The sum is handed over
 * unscaled and unclipped, because how much headroom to leave is the output
 * device's decision: `web/audio.ts` has been multiplying by 0.4 for years, and
 * a caller writing a WAV wants to know it clipped rather than to be protected
 * from it.
 */
import type { AudioSink } from './host'
import { MAX_VOLUME, clampVolume } from './paula'

/** the coefficient of a one-pole low-pass at `hz`, sampled at `rate` */
export function onePole(hz: number, rate: number): number {
  return 1 - Math.exp((-2 * Math.PI * hz) / rate)
}

/** frames per second of output. 44100 unless the host names its own. */
export const DEFAULT_MIX_RATE = 44100

/**
 * Which channel each voice is wired to: 0 and 3 left, 1 and 2 right.
 *
 * The pairing is why a four-channel module sounds hard-panned on the machine
 * and why every Amiga tracker orders its channels 1-4 rather than left-right.
 */
export const VOICE_CHANNEL: readonly number[] = [0, 1, 1, 0]

/**
 * The corner the LED filter is usually quoted at.
 *
 * DEVIATION: the machine's is a two-pole Butterworth around an op-amp, and no
 * schematic was read for this. Two one-poles in series give the same 12dB per
 * octave slope with the wrong Q, so the knee is softer than the real one. It
 * is switched by the same bit the machine switches it with ($BFE001 bit 1),
 * which is the part a program can observe.
 */
export const LED_FILTER_HZ = 3300

/**
 * Which machine's output stage, because the LED filter is not the only one.
 *
 * Every Amiga has a fixed RC low-pass after the DAC that no program can
 * switch, and it is not the same part in every model. This mattered the
 * moment a format arrived that plays everything through one buffer clocked at
 * 15,625 Hz: OctaMED's 5-8 channel mode puts Paula's images from 12.8 kHz up,
 * and with only the LED filter above them there is nothing else to take them
 * out.
 *
 * MODELLED, and this file's least defensible pair of numbers. No schematic
 * was read for either. The corners are the ones the community quotes, and the
 * RC pairs that produce them are 360R with 0.1uF for the older machines and
 * about 680R with 6800pF for AGA. Distrust these before you distrust anything
 * else here.
 */
export type AmigaAudioModel = 'a500' | 'a1200'

/**
 * The fixed pole, in Hz, one per model.
 *
 * The AGA number is high enough to be nearly nothing --- a one-pole at 30 kHz
 * is 1 dB down at 15 kHz --- which is why an A1200 playing 8-channel OctaMED
 * is bright and an A500 playing the same file is not.
 */
export const FIXED_FILTER_HZ: Readonly<Record<AmigaAudioModel, number>> = { a500: 4400, a1200: 30000 }

interface MixVoice {
  pcm: Int8Array | null
  /** where the DMA is, in samples, fractional because the rates disagree */
  pos: number
  /** samples of source per frame of output */
  step: number
  /** sample byte to output units: volume/64 over 128 */
  gain: number
  playing: boolean
  loopStart: number
  loopEnd: number
  /** the end of the pass being played now, which is the buffer until it loops */
  end: number
}

/** a one-pole low-pass per channel, and the LED's is two of them in series */
interface FilterState {
  a: number
  z: [number, number, number, number]
}

export interface MixerOptions {
  /** output frames per second */
  rate?: number
  /**
   * Where a rendered block goes. `runTo` calls it with interleaved stereo,
   * left first, so a browser can queue it and a test can keep it.
   */
  onBlock?: (stereo: Float32Array) => void
  /** the LED filter's starting state; the machine boots with it engaged */
  filter?: boolean
  /**
   * Which machine's fixed output pole. Defaults to `a1200`, which is what
   * this port rendered for years before the pole was modelled at all: at 30
   * kHz it barely moves anything, so nothing that was signed off by ear
   * changed under it.
   */
  model?: AmigaAudioModel
}

/**
 * Paula as something that produces sound.
 *
 * Drop-in for `NullAudio`: same interface, and it keeps the same per-voice
 * state a player test reads. What it adds is `render`, and the clock that
 * makes rendering mean anything.
 */
/**
 * A loop end the sample can actually reach.
 *
 * Paula takes AUDxLEN in words and does not know how long the caller's sample
 * is: point it past the end and the DMA reads whatever chip RAM follows,
 * which on the machine is somebody else's data and audible garbage. There is
 * no memory after the buffer HERE, so the read came back `undefined`,
 * `undefined * gain` was NaN, and the NaN then sat in the LED filter's state
 * for the rest of the render — one bad sample silenced everything after it.
 *
 * Found by rendering DME 2.0's own ProTracker example, whose loops run past
 * their samples: 2,403 NaN samples with the filter off and 1,019,349 with it
 * on, from 6.886s onward. `setWaveform` had this clamp from the start and the
 * other two entry points did not.
 */
const clampLoopEnd = (loopEnd: number, length: number): number =>
  loopEnd > length ? length : loopEnd < 0 ? 0 : loopEnd

export class PaulaMixer implements AudioSink {
  readonly rate: number
  /** the LED filter, which is CIA-A's PRA bit 1 rather than Paula's own */
  filter: boolean
  /** seconds rendered so far, which is what `runTo` runs to */
  time = 0
  /** frames rendered so far, counting from wherever `startAt` put the clock */
  frames = 0
  /**
   * Where the clock was started, in FRAMES rather than seconds: subtracting
   * two nearby times before the multiply is what loses the sample. At 600
   * seconds, `(600.02 - 600) * 44100` is 881.99999 and floors to 881.
   */
  private originFrames = 0

  /** which machine's fixed pole, and it is not switchable on the machine */
  readonly model: AmigaAudioModel

  private readonly onBlock: ((stereo: Float32Array) => void) | undefined
  private readonly lp: FilterState
  private readonly fixed: FilterState
  private readonly voices: MixVoice[] = [0, 1, 2, 3].map(() => ({
    pcm: null,
    pos: 0,
    step: 0,
    gain: 0,
    playing: false,
    loopStart: -1,
    loopEnd: 0,
    end: 0,
  }))

  constructor(opts: MixerOptions = {}) {
    this.rate = opts.rate ?? DEFAULT_MIX_RATE
    this.filter = opts.filter ?? true
    this.onBlock = opts.onBlock
    this.model = opts.model ?? 'a1200'
    this.lp = { a: onePole(LED_FILTER_HZ, this.rate), z: [0, 0, 0, 0] }
    this.fixed = { a: onePole(FIXED_FILTER_HZ[this.model], this.rate), z: [0, 0, 0, 0] }
  }

  // ---- the clock ---------------------------------------------------------

  /**
   * Render forward to `t` seconds. Every write after this call lands there.
   *
   * A time already passed renders nothing rather than throwing: two replayers
   * on separate interrupts can name instants out of order, and the machine's
   * answer to that is that the later write wins, not that the sound stops.
   */
  runTo(t: number): void {
    if (!(t > this.time)) return
    this.time = t
    // against the absolute clock, not against the last call. Summing 587
    // deltas of 1/587 lands a whole frame short at 44100, because each one is
    // a binary fraction that is not quite what it says.
    const n = Math.floor(t * this.rate) - this.originFrames - this.frames
    if (n <= 0) return
    const block = this.render(n)
    this.onBlock?.(block)
  }

  /**
   * Put the clock at `t` without rendering the gap.
   *
   * A browser has no audio device until the first user gesture, and a program
   * can have been running for minutes by then. Without this the first `runTo`
   * after the device appears asks for every sample since the program started.
   */
  startAt(t: number): void {
    this.originFrames = Math.floor(t * this.rate)
    this.time = t
    this.frames = 0
  }

  /**
   * `n` frames of interleaved stereo, left first.
   *
   * Public because a caller with its own clock — a WAV writer, an audio
   * worklet asking for the block it needs now — should not have to go through
   * `runTo` to get one.
   */
  render(n: number): Float32Array {
    const out = new Float32Array(n * 2)
    for (let v = 0; v < 4; v++) this.mixVoice(this.voices[v]!, VOICE_CHANNEL[v]!, out, n)
    this.frames += n
    // the LED filter first because that is the order the board has them in,
    // though two filters in series do not care
    if (this.filter) this.applyFilter(out, n, this.lp, 2)
    this.applyFilter(out, n, this.fixed, 1)
    return out
  }

  private mixVoice(V: MixVoice, ch: number, out: Float32Array, n: number): void {
    const pcm = V.pcm
    if (!V.playing || !pcm) return
    let pos = V.pos
    for (let i = 0; i < n; i++) {
      if (pos >= V.end) {
        // the buffer ran out: AUDxLC and AUDxLEN relatch, or the DMA idles
        const len = V.loopEnd - V.loopStart
        if (V.loopStart < 0 || len <= 0) {
          V.playing = false
          V.pos = pos
          return
        }
        pos = V.loopStart + ((pos - V.end) % len)
        V.end = V.loopEnd
      }
      // the stair-step across this output frame, weighted by how long each
      // byte is held inside it. A step of 1 or more cannot happen on a legal
      // period -- MIN_PERIOD 124 is 28,604 Hz against a 44,100 output -- so
      // the frame spans at most two source bytes and the closed form is exact.
      const idx = pos | 0
      const held = idx + 1 - pos
      let value = pcm[idx]!
      if (V.step > held && V.step <= 1) {
        // the byte after this one, which at the end of a pass is whatever the
        // DMA relatches to rather than a repeat of the last byte
        const wrap = V.loopStart >= 0 && V.loopEnd > V.loopStart ? V.loopStart : idx
        const next = idx + 1 >= V.end ? wrap : idx + 1
        value = (value * held + pcm[next]! * (V.step - held)) / V.step
      }
      out[i * 2 + ch]! += value * V.gain
      pos += V.step
    }
    V.pos = pos
  }

  /** `poles` one-poles per channel, state carried between blocks */
  private applyFilter(out: Float32Array, n: number, f: FilterState, poles: 1 | 2): void {
    const a = f.a
    let [l0, l1, r0, r1] = f.z
    for (let i = 0; i < n; i++) {
      l0 += a * (out[i * 2]! - l0)
      r0 += a * (out[i * 2 + 1]! - r0)
      if (poles === 1) {
        out[i * 2] = l0
        out[i * 2 + 1] = r0
        continue
      }
      l1 += a * (l0 - l1)
      r1 += a * (r0 - r1)
      out[i * 2] = l1
      out[i * 2 + 1] = r1
    }
    f.z = [l0, l1, r0, r1]
  }

  // ---- the registers -----------------------------------------------------

  play(voice: number, pcm: Int8Array, freqHz: number, volume: number, loopStart: number, loopEnd?: number): void {
    const V = this.voices[voice]
    if (!V) return
    V.pcm = pcm
    V.pos = 0
    V.end = pcm.length
    V.step = Math.max(0, freqHz) / this.rate
    V.gain = clampVolume(volume) / MAX_VOLUME / 128
    V.loopStart = loopStart
    V.loopEnd = clampLoopEnd(loopEnd ?? pcm.length, pcm.length)
    V.playing = pcm.length > 0
  }

  stop(voice: number): void {
    const V = this.voices[voice]
    if (!V) return
    V.playing = false
    V.pcm = null
  }

  setVolume(voice: number, volume: number): void {
    const V = this.voices[voice]
    if (V) V.gain = clampVolume(volume) / MAX_VOLUME / 128
  }

  setFrequency(voice: number, freqHz: number): void {
    const V = this.voices[voice]
    if (V) V.step = Math.max(0, freqHz) / this.rate
  }

  /**
   * The repeat region for the NEXT relatch, which is what writing AUDxLC and
   * AUDxLEN does. The pass being played now runs to its own end first, and
   * that one-buffer delay is why a tracker can set the loop on the frame after
   * the note without hearing it.
   */
  setLoop(voice: number, loopStart: number, loopEnd?: number): void {
    const V = this.voices[voice]
    if (!V) return
    V.loopStart = loopStart
    V.loopEnd = clampLoopEnd(loopEnd ?? V.pcm?.length ?? 0, V.pcm?.length ?? 0)
  }

  /**
   * New bytes under a running voice, phase untouched — the synth trackers'
   * per-frame waveform swap. See `AudioSink.setWaveform`.
   *
   * The position is wrapped rather than reset when the new buffer is shorter,
   * because the DMA has already fetched past that address and the machine
   * carries on from wherever the new LEN puts it.
   */
  setWaveform(voice: number, pcm: Int8Array): void {
    const V = this.voices[voice]
    if (!V || pcm.length === 0) return
    V.pcm = pcm
    V.end = Math.min(V.end === 0 ? pcm.length : V.end, pcm.length)
    if (V.loopEnd > pcm.length) V.loopEnd = pcm.length
    if (V.pos >= V.end) V.pos = V.pos % V.end
  }

  setFilter(on: boolean): void {
    this.filter = on
  }
}
