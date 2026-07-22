import type { AudioSink } from '../runtime/audio'

/** WebAudio implementation of the 4-voice Amiga output. */
export class WebAudioSink implements AudioSink {
  private ctx: AudioContext | null = null
  private voices: Array<{ src: AudioBufferSourceNode | null; gain: GainNode | null }> = [
    { src: null, gain: null },
    { src: null, gain: null },
    { src: null, gain: null },
    { src: null, gain: null },
  ]

  /** browsers require a user gesture before audio — call from input handlers */
  unlock(): void {
    this.ctx ??= new AudioContext()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  private voiceGain(v: number, volume63: number): GainNode | null {
    if (!this.ctx) return null
    const slot = this.voices[v]!
    if (!slot.gain) {
      slot.gain = this.ctx.createGain()
      slot.gain.connect(this.ctx.destination)
    }
    slot.gain.gain.value = (volume63 / 63) * 0.4
    return slot.gain
  }

  play(voice: number, pcm: Int8Array, freqHz: number, volume63: number, loopStart: number): void {
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
    }
    const gain = this.voiceGain(voice, volume63)
    if (!gain) return
    src.connect(gain)
    src.start()
    this.voices[voice]!.src = src
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

  setVolume(voice: number, volume63: number): void {
    this.voiceGain(voice, volume63)
  }
}
