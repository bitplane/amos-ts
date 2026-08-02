import { volumeGain } from '../amiga/paula'
import type { AudioSink } from '../amiga/paula'

/**
 * WebAudio implementation of the 4-voice Amiga output. Best-effort: the
 * faithful contract lives in the runtime (which computes rates, volumes
 * and loop regions); this sink renders them with buffer sources. The
 * power-LED low-pass filter is a ~3.3kHz biquad (the A500 RC filter).
 */
export class WebAudioSink implements AudioSink {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private lowpass: BiquadFilterNode | null = null
  private filterOn = true
  private voices: Array<{
    src: AudioBufferSourceNode | null
    gain: GainNode | null
    rate: number
    length: number
  }> = [
    { src: null, gain: null, rate: 0, length: 0 },
    { src: null, gain: null, rate: 0, length: 0 },
    { src: null, gain: null, rate: 0, length: 0 },
    { src: null, gain: null, rate: 0, length: 0 },
  ]

  /** browsers require a user gesture before audio — call from input handlers */
  unlock(): void {
    this.ctx ??= new AudioContext()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  private output(): AudioNode | null {
    if (!this.ctx) return null
    if (!this.master) {
      this.master = this.ctx.createGain()
      this.lowpass = this.ctx.createBiquadFilter()
      this.lowpass.type = 'lowpass'
      this.lowpass.frequency.value = 3300
      this.routeFilter()
    }
    return this.master
  }

  private routeFilter(): void {
    if (!this.ctx || !this.master || !this.lowpass) return
    this.master.disconnect()
    this.lowpass.disconnect()
    if (this.filterOn) {
      this.master.connect(this.lowpass)
      this.lowpass.connect(this.ctx.destination)
    } else {
      this.master.connect(this.ctx.destination)
    }
  }

  /**
   * AUDxVOL is 0..64, and 64 is unity — not 63.
   *
   * This divided by 63, which came from AMOS's own range: its keywords stop
   * at 63 and never reach full scale on the machine either. MED does not —
   * `med.ts` computes `Math.min(64, ...)`, which is right for the chip — so a
   * MED voice at full volume asked for 64/63 of unity and every AMOS voice
   * was rendered one step too loud. `volumeGain` is the chip's scale.
   */
  private voiceGain(v: number, volume: number): GainNode | null {
    const out = this.output()
    if (!this.ctx || !out) return null
    const slot = this.voices[v]!
    if (!slot.gain) {
      slot.gain = this.ctx.createGain()
      slot.gain.connect(out)
    }
    slot.gain.gain.value = volumeGain(volume) * 0.4
    return slot.gain
  }

  play(voice: number, pcm: Int8Array, freqHz: number, volume: number, loopStart: number, loopEnd?: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return
    this.stop(voice)
    const rate = Math.max(8000, Math.min(96000, freqHz))
    const buffer = this.ctx.createBuffer(1, pcm.length, rate)
    const ch = buffer.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 128
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = freqHz / rate
    if (loopStart >= 0) {
      src.loop = true
      src.loopStart = loopStart / rate
      src.loopEnd = (loopEnd ?? pcm.length) / rate
    }
    const gain = this.voiceGain(voice, volume)
    if (!gain) return
    src.connect(gain)
    src.start()
    const slot = this.voices[voice]!
    slot.src = src
    slot.rate = rate
    slot.length = pcm.length
  }

  stop(voice: number): void {
    const slot = this.voices[voice]!
    if (slot.src) {
      try {
        slot.src.stop()
      } catch {
        // already stopped
      }
      slot.src = null
    }
  }

  setVolume(voice: number, volume: number): void {
    this.voiceGain(voice, volume)
  }

  setFrequency(voice: number, freqHz: number): void {
    const slot = this.voices[voice]!
    if (slot.src && slot.rate > 0) slot.src.playbackRate.value = freqHz / slot.rate
  }

  setLoop(voice: number, loopStart: number, loopEnd?: number): void {
    const slot = this.voices[voice]!
    if (!slot.src || slot.rate <= 0) return
    if (loopStart < 0) {
      slot.src.loop = false
    } else {
      slot.src.loop = true
      slot.src.loopStart = loopStart / slot.rate
      slot.src.loopEnd = (loopEnd ?? slot.length) / slot.rate
    }
  }

  setFilter(on: boolean): void {
    this.filterOn = on
    if (this.master) this.routeFilter()
  }
}
