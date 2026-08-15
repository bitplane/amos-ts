/**
 * The browser sink that renders, rather than handing four voices to Web Audio.
 *
 * `WebAudioSink` beside this one schedules an `AudioBufferSourceNode` per
 * voice. Two things it cannot express, and both of them matter:
 *
 * - **A waveform swapped under a running note.** THX rewrites its 640-byte
 *   chip buffer up to fifty times a second and never touches the DMA bit, so
 *   the phase runs on unbroken. A buffer source restarts from sample 0, which
 *   is a click each time. `AudioSink.setWaveform` exists for this and that
 *   sink can only approximate it.
 * - **A register write partway through a frame.** MED's CIA fires between 24
 *   and 500 times a second and `AudioSink.runTo` says when each one landed.
 *   Nodes scheduled per frame cannot hear the difference.
 *
 * `PaulaMixer` does both because it renders the samples itself. What is left
 * is getting its blocks to the audio device, and that is the whole of this
 * file.
 *
 * ## The split, and why it is where it is
 *
 * The worklet cannot be tested here: there is no browser in this repo and
 * `AudioWorkletProcessor` does not exist in Node. So the processor is kept
 * deliberately stupid — a queue of blocks, a read cursor, and a depth report —
 * and every decision lives in `AudioQueue` on this side, where the suite can
 * reach it. The part that can be wrong is the part that is covered.
 *
 * ## Why a Blob and not a file
 *
 * `addModule` wants a URL. This package is published to npm, so a separate
 * asset would have to survive a consumer's bundler and their server's MIME
 * types. The processor source is a string in this bundle and becomes a Blob
 * URL at unlock, which needs neither.
 */
import { PaulaMixer } from '../amiga/mixer'
import type { AudioSink } from '../amiga/paula'
import { WebAudioSink } from './audio'

/**
 * How much rendered audio to keep ahead of the device, in milliseconds.
 *
 * The frame loop in `player.ts` is driven by requestAnimationFrame and caps
 * its debt at a single frame, so a hitch DROPS simulated time rather than
 * replaying it. That is right for the display and it means the audio clock and
 * the simulation clock drift apart under load. The buffer is what absorbs it,
 * and 120ms is about six frames.
 */
export const TARGET_MS = 120
/**
 * Where the buffer is declared too deep and gets trimmed back to the target.
 *
 * Turbo is the case this exists for: `player.ts` runs twenty frames in one
 * animation frame, which renders 400ms of audio in one go and would otherwise
 * leave the sound running a second behind the picture for as long as the
 * buffer took to drain.
 */
export const MAX_MS = 260

/** what to do with a block that has just been rendered */
export interface QueueAction {
  send: boolean
  /** frames to trim the far end of the queue back to, or null to leave it */
  trim: number | null
}

/**
 * The main thread's model of how much audio the worklet is holding.
 *
 * It is a model rather than a measurement because the two sides only talk by
 * message: the worklet reports its depth after each drain and this counts what
 * has been sent since. Both numbers are frames.
 */
export class AudioQueue {
  /** frames believed to be queued in the worklet */
  depth = 0
  /** frames dropped because the queue was already too deep */
  dropped = 0
  /** how many times the queue has been trimmed back */
  trims = 0
  readonly target: number
  readonly max: number

  constructor(rate: number, targetMs = TARGET_MS, maxMs = MAX_MS) {
    this.target = Math.round((rate * targetMs) / 1000)
    this.max = Math.round((rate * maxMs) / 1000)
  }

  /** a block of `frames` has been rendered: send it, or drop it and trim */
  offer(frames: number): QueueAction {
    if (this.depth + frames <= this.max) {
      this.depth += frames
      return { send: true, trim: null }
    }
    this.dropped += frames
    // Trim only when the queue is over the mark on its own, not merely with
    // this block added. A block that would just tip it over is dropped and
    // nothing already queued is disturbed.
    if (this.depth > this.max) {
      this.trims++
      this.depth = this.target
      return { send: false, trim: this.target }
    }
    return { send: false, trim: null }
  }

  /** the worklet's own count, which supersedes the estimate */
  report(depth: number): void {
    this.depth = depth
  }
}

/**
 * The processor. Kept to a queue, a cursor and a counter on purpose — see the
 * note at the top of this file about where the decisions live.
 *
 * `process` returns true forever: an AudioWorklet whose processor returns
 * false is torn down, and this one has to survive silence.
 */
export const MIXER_WORKLET_SOURCE = `
class AmosMixer extends AudioWorkletProcessor {
  constructor() {
    super()
    this.blocks = []
    this.at = 0
    this.depth = 0
    this.since = 0
    this.port.onmessage = (e) => {
      const m = e.data
      if (m.pcm) {
        this.blocks.push(m.pcm)
        this.depth += m.pcm.length >> 1
      }
      if (typeof m.trim === 'number') {
        while (this.depth > m.trim && this.blocks.length > 1) {
          const head = this.blocks.shift()
          this.depth -= (head.length >> 1) - this.at
          this.at = 0
        }
      }
      if (m.gain !== undefined) this.gain = m.gain
    }
    this.gain = 0.4
  }

  process(inputs, outputs) {
    const out = outputs[0]
    const left = out[0]
    const right = out[1] || out[0]
    const n = left.length
    for (let i = 0; i < n; i++) {
      const head = this.blocks[0]
      if (head === undefined) {
        left[i] = 0
        right[i] = 0
        continue
      }
      left[i] = head[this.at] * this.gain
      right[i] = head[this.at + 1] * this.gain
      this.at += 2
      this.depth--
      if (this.at >= head.length) {
        this.blocks.shift()
        this.at = 0
      }
    }
    this.since += n
    // about every 50ms, so the estimate on the other side stays honest
    if (this.since >= 2048) {
      this.since = 0
      this.port.postMessage({ depth: this.depth })
    }
    return true
  }
}
registerProcessor('amos-mixer', AmosMixer)
`

/** what the old sink multiplied a voice by; a channel here is two voices */
export const MASTER_GAIN = 0.4

/**
 * `AudioSink` over `PaulaMixer`, out through an AudioWorklet.
 *
 * Falls back to `WebAudioSink` and forwards everything to it when the worklet
 * cannot be started — an old browser, a blocked Blob URL, an `addModule` that
 * throws. Losing the mixer costs the two things at the top of this file;
 * losing the sound entirely would cost the rest.
 */
export class MixerSink implements AudioSink {
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private mixer: PaulaMixer | null = null
  private queue: AudioQueue | null = null
  private fallback: WebAudioSink | null = null
  private starting = false
  /** the mixer's clock has not been put on the runtime's yet */
  private needsStart = false

  /** browsers require a user gesture before audio — call from input handlers */
  unlock(): void {
    if (this.fallback) {
      this.fallback.unlock()
      return
    }
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    if (this.starting) return
    this.starting = true
    void this.start()
  }

  private async start(): Promise<void> {
    try {
      const ctx = new AudioContext()
      if (!ctx.audioWorklet) throw new Error('no AudioWorklet')
      const url = URL.createObjectURL(new Blob([MIXER_WORKLET_SOURCE], { type: 'application/javascript' }))
      try {
        await ctx.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      const node = new AudioWorkletNode(ctx, 'amos-mixer', { numberOfInputs: 0, outputChannelCount: [2] })
      node.port.onmessage = (e: MessageEvent): void => {
        const depth = (e.data as { depth?: number }).depth
        if (typeof depth === 'number') this.queue?.report(depth)
      }
      node.port.postMessage({ gain: MASTER_GAIN })
      node.connect(ctx.destination)
      // the mixer runs at the DEVICE's rate, which is 48000 as often as 44100
      this.mixer = new PaulaMixer({ rate: ctx.sampleRate, onBlock: (b) => this.push(b) })
      this.queue = new AudioQueue(ctx.sampleRate)
      this.node = node
      this.ctx = ctx
      this.needsStart = true
      if (ctx.state === 'suspended') void ctx.resume()
    } catch (e) {
      console.warn('amos-ts: AudioWorklet unavailable, falling back to buffer sources', e)
      this.fallback = new WebAudioSink()
      this.fallback.unlock()
    }
  }

  private push(block: Float32Array): void {
    const node = this.node
    const queue = this.queue
    if (!node || !queue) return
    const action = queue.offer(block.length >> 1)
    if (action.trim !== null) node.port.postMessage({ trim: action.trim })
    if (action.send) node.port.postMessage({ pcm: block }, [block.buffer])
  }

  /** how deep the queue is running, for anyone who wants to show it */
  get status(): { depth: number; dropped: number; trims: number; worklet: boolean } {
    return {
      depth: this.queue?.depth ?? 0,
      dropped: this.queue?.dropped ?? 0,
      trims: this.queue?.trims ?? 0,
      worklet: this.node !== null,
    }
  }

  // ---- AudioSink, forwarded to whichever of the two is live ---------------

  play(voice: number, pcm: Int8Array, freqHz: number, volume: number, loopStart: number, loopEnd?: number): void {
    if (this.fallback) return this.fallback.play(voice, pcm, freqHz, volume, loopStart, loopEnd)
    this.mixer?.play(voice, pcm, freqHz, volume, loopStart, loopEnd)
  }

  stop(voice: number): void {
    if (this.fallback) return this.fallback.stop(voice)
    this.mixer?.stop(voice)
  }

  setVolume(voice: number, volume: number): void {
    if (this.fallback) return this.fallback.setVolume(voice, volume)
    this.mixer?.setVolume(voice, volume)
  }

  setFrequency(voice: number, freqHz: number): void {
    if (this.fallback) return this.fallback.setFrequency(voice, freqHz)
    this.mixer?.setFrequency(voice, freqHz)
  }

  setLoop(voice: number, loopStart: number, loopEnd?: number): void {
    if (this.fallback) return this.fallback.setLoop(voice, loopStart, loopEnd)
    this.mixer?.setLoop(voice, loopStart, loopEnd)
  }

  setWaveform(voice: number, pcm: Int8Array): void {
    if (this.fallback) return this.fallback.setWaveform?.(voice, pcm)
    this.mixer?.setWaveform(voice, pcm)
  }

  setFilter(on: boolean): void {
    if (this.fallback) return this.fallback.setFilter(on)
    this.mixer?.setFilter(on)
  }

  /**
   * The frame's end, from `Runtime.frame()`.
   *
   * Before the first gesture there is no context and so no rate to render at,
   * and the mixer's clock starts when it is built rather than at zero — so the
   * first `runTo` after unlock would otherwise ask for however many minutes
   * the program had already been running.
   */
  runTo(t: number): void {
    if (this.fallback || !this.mixer) return
    if (this.needsStart) {
      this.mixer.startAt(t)
      this.needsStart = false
      return
    }
    this.mixer.runTo(t)
  }
}
