/**
 * Audio: the 4-voice Amiga sound layer, abstracted behind AudioSink.
 * The runtime computes what to play (sample PCM, frequency, volume,
 * looping); sinks render it — WebAudio in the browser, a recording
 * NullAudio headless.
 */

export interface AudioSink {
  /** signed 8-bit PCM at freqHz on voice 0-3; loop from loopStart (-1 = one-shot) */
  play(voice: number, pcm: Int8Array, freqHz: number, volume63: number, loopStart: number): void
  stop(voice: number): void
  setVolume(voice: number, volume63: number): void
}

export interface AudioEvent {
  kind: 'play' | 'stop' | 'volume'
  voice: number
  freq?: number
  length?: number
  volume?: number
  loop?: boolean
}

/** headless sink: records everything for tests/censuses */
export class NullAudio implements AudioSink {
  events: AudioEvent[] = []

  play(voice: number, pcm: Int8Array, freqHz: number, volume63: number, loopStart: number): void {
    this.events.push({ kind: 'play', voice, freq: freqHz, length: pcm.length, volume: volume63, loop: loopStart >= 0 })
  }

  stop(voice: number): void {
    this.events.push({ kind: 'stop', voice })
  }

  setVolume(voice: number, volume63: number): void {
    this.events.push({ kind: 'volume', voice, volume: volume63 })
  }
}

// ---- the Samples bank (bank 5, "Samples") ---------------------------------

export interface SampleEntry {
  name: string
  /** default playback rate in Hz */
  freq: number
  pcm: Int8Array
}

/**
 * Format (from GetSam in +Music.s): u16 count, then count u32 offsets
 * (relative to bank start), each pointing at { name[8], freq: u16,
 * length: u32, signed 8-bit PCM }.
 */
export function parseSampleBank(data: Uint8Array): SampleEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data.length < 2) return []
  const count = view.getUint16(0)
  const out: SampleEntry[] = []
  for (let i = 0; i < count; i++) {
    const tableOff = 2 + i * 4
    if (tableOff + 4 > data.length) break
    const off = view.getUint32(tableOff)
    if (off === 0 || off + 14 > data.length) {
      out.push({ name: '', freq: 0, pcm: new Int8Array(0) })
      continue
    }
    let name = ''
    for (let k = 0; k < 8; k++) name += String.fromCharCode(data[off + k]!)
    const freq = view.getUint16(off + 8)
    const length = view.getUint32(off + 10)
    const end = Math.min(off + 14 + length, data.length)
    out.push({
      name: name.trim(),
      freq,
      pcm: new Int8Array(data.buffer, data.byteOffset + off + 14, Math.max(0, end - (off + 14))),
    })
  }
  return out
}

// ---- built-in effects (Bell / Boom / Shoot) -------------------------------

/** deterministic noise, so tests and replays are stable */
function noise(seedStart: number, length: number, shape: (i: number, r: number) => number): Int8Array {
  const pcm = new Int8Array(length)
  let seed = seedStart
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const r = (seed >>> 16) / 32768 - 1 // -1..1
    pcm[i] = Math.max(-128, Math.min(127, Math.round(shape(i, r) * 127)))
  }
  return pcm
}

const RATE = 8363 // classic sample rate

/** Bell pitch: sine with exponential decay. */
export function bellPcm(pitch: number): { pcm: Int8Array; freq: number } {
  const len = Math.floor(RATE * 0.4)
  const hz = 110 * Math.pow(2, (pitch - 24) / 12) // pitch 60 ≈ 880Hz-ish
  const pcm = new Int8Array(len)
  for (let i = 0; i < len; i++) {
    const env = Math.exp((-4 * i) / len)
    pcm[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / RATE) * env * 110)
  }
  return { pcm, freq: RATE }
}

/** Shoot: short bright noise burst. */
export function shootPcm(): { pcm: Int8Array; freq: number } {
  const len = Math.floor(RATE * 0.18)
  return { pcm: noise(0xbeef, len, (i, r) => r * Math.exp((-6 * i) / len)), freq: RATE }
}

/** Boom: long low rumble (noise through a crude one-pole lowpass). */
export function boomPcm(): { pcm: Int8Array; freq: number } {
  const len = Math.floor(RATE * 0.7)
  let acc = 0
  return {
    pcm: noise(0xcafe, len, (i, r) => {
      acc += (r - acc) * 0.08
      return acc * 4 * Math.exp((-5 * i) / len)
    }),
    freq: RATE,
  }
}
