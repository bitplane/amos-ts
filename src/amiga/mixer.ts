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
 * - **Point sampling.** The DMA fetches one byte per period and holds it, so
 *   the output is a stair-step and the harmonics that puts above Nyquist are
 *   the analog filter's business. Interpolating here would be a nicer sound
 *   and a different machine.
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

/** a one-pole low-pass, twice, per channel */
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
}

/**
 * Paula as something that produces sound.
 *
 * Drop-in for `NullAudio`: same interface, and it keeps the same per-voice
 * state a player test reads. What it adds is `render`, and the clock that
 * makes rendering mean anything.
 */
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

  private readonly onBlock: ((stereo: Float32Array) => void) | undefined
  private readonly lp: FilterState
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
    this.lp = { a: 1 - Math.exp((-2 * Math.PI * LED_FILTER_HZ) / this.rate), z: [0, 0, 0, 0] }
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
    if (this.filter) this.applyFilter(out, n)
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
      out[i * 2 + ch]! += pcm[pos | 0]! * V.gain
      pos += V.step
    }
    V.pos = pos
  }

  /** two one-poles per channel, state carried between blocks */
  private applyFilter(out: Float32Array, n: number): void {
    const a = this.lp.a
    const z = this.lp.z
    let [l0, l1, r0, r1] = z
    for (let i = 0; i < n; i++) {
      l0 += a * (out[i * 2]! - l0)
      l1 += a * (l0 - l1)
      out[i * 2] = l1
      r0 += a * (out[i * 2 + 1]! - r0)
      r1 += a * (r0 - r1)
      out[i * 2 + 1] = r1
    }
    this.lp.z = [l0, l1, r0, r1]
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
    V.loopEnd = loopEnd ?? pcm.length
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
    V.loopEnd = loopEnd ?? V.pcm?.length ?? 0
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
