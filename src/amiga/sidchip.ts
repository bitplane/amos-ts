/**
 * The MOS 6581/8580 SID: its 29 registers, three voices and their envelopes.
 *
 * This is the chip a PSID file thinks it is writing to. `mos6502.ts` runs the
 * tune's code, `playsid.ts` points that code's $D400 writes here, and what
 * comes out is three oscillators with an amplitude each. Turning those into
 * something Paula can play is `playsid.ts`'s job, because that part is
 * `playsid.library`'s design rather than the chip's.
 *
 * ## What is modelled and what is not
 *
 * The register file, the three oscillators, the ADSR envelopes, ring
 * modulation, oscillator sync, the test bit and the noise LFSR. All of that
 * is the 6581 data sheet, which is the right evidence for a chip: this
 * directory ranks a shipped binary over a manual for AMOS libraries because
 * the binary is the thing being ported, and here the thing being ported is a
 * chip whose own documentation is primary.
 *
 * DEVIATION: **the filter is not modelled.** The 6581's multimode filter is
 * the one part of it that is analogue, varies between chips and was never
 * specified in a way that can be ported. `playsid.library` does not model it
 * either, which is the reason this omission is faithful rather than merely
 * convenient: `SetChannelEnable` is the only per-voice control the library
 * exposes, `DisplayData` in playsidbase.h carries `Sample`, `Length`,
 * `Period` and `Enve` per voice and nothing about a filter, and the "filter"
 * switch in `PlaySID.doc` is the AMIGA's LED filter rather than the SID's.
 * A tune that routes a voice through the filter is louder here than on a
 * C64, and that is what it was on an Amiga in 1994 too. `filterVoices` and
 * `filterCutoff` are still decoded, because a caller that wants to know is
 * better served than one that has to re-read $D417.
 *
 * ## The envelope rates
 *
 * From the 6581 data sheet's attack table, in milliseconds for a full
 * 0 to 255 sweep. Decay and release use the same sixteen values times three,
 * which is the data sheet's own relation and not an approximation.
 */

/** $D400 to $D41C, and the 32-byte stride the chip is mirrored on. */
export const SID_REGISTERS = 0x1d
export const SID_MIRROR = 0x20

/** The C64's φ2 clock, which is what the frequency registers are counted in. */
export const C64_CLOCK_PAL = 985248
export const C64_CLOCK_NTSC = 1022727

/** Control register bits, $D404 and its two siblings. */
export const CTRL_GATE = 0x01
export const CTRL_SYNC = 0x02
export const CTRL_RING = 0x04
export const CTRL_TEST = 0x08
export const CTRL_TRIANGLE = 0x10
export const CTRL_SAWTOOTH = 0x20
export const CTRL_PULSE = 0x40
export const CTRL_NOISE = 0x80

/**
 * Attack times in milliseconds, rate 0 to 15, off the 6581 data sheet.
 * Decay and release are three times these.
 */
export const ATTACK_MS = [2, 8, 16, 24, 38, 56, 68, 80, 100, 250, 500, 800, 1000, 3000, 5000, 8000] as const

export type EnvPhase = 'release' | 'attack' | 'decay' | 'sustain'

export interface SidVoice {
  /** $D400/$D401, the 16-bit oscillator frequency. */
  freq: number
  /** $D402/$D403, twelve bits of duty cycle out of 4096. */
  pulseWidth: number
  /** $D404. */
  control: number
  /** $D405 high and low nibble. */
  attack: number
  decay: number
  /** $D406 high and low nibble. */
  sustain: number
  release: number

  /** The envelope, 0 to 255, which is what `Enve[]` reports. */
  env: number
  phase: EnvPhase
  /** The oscillator's phase accumulator, 0 to 1. */
  phaseAcc: number
  /** The noise LFSR, 23 bits, reset to a non-zero seed by the test bit. */
  lfsr: number
}

function newVoice(): SidVoice {
  return {
    freq: 0,
    pulseWidth: 0,
    control: 0,
    attack: 0,
    decay: 0,
    sustain: 0,
    release: 0,
    env: 0,
    phase: 'release',
    phaseAcc: 0,
    lfsr: 0x7ffff8,
  }
}

/** Hz for a frequency register value, at the given φ2 clock. */
export function sidFreqHz(freq: number, clock = C64_CLOCK_PAL): number {
  return (freq * clock) / 16777216
}

export class SidChip {
  /** The register file as written. Reads of $D419 and up come from elsewhere. */
  readonly regs = new Uint8Array(SID_REGISTERS)
  readonly voices: SidVoice[] = [newVoice(), newVoice(), newVoice()]

  /** $D418 low nibble, the master volume 0 to 15. */
  volume = 15
  /** $D415/$D416, eleven bits. Decoded, not applied: see the header. */
  filterCutoff = 0
  /** $D417 low three bits, which voices are routed through the filter. */
  filterVoices = 0
  /** $D418 bit 7: voice 3 is disconnected from the output. */
  voice3Off = false

  /**
   * $D41D. Not a SID register at all: PlaySID's sample extension, which the
   * library clears at the top of every play call (`clr.b $1d(a5)`, $210738)
   * and then tests for $FF, $FE, $FD and $FC at $21183e. A tune sets it to
   * ask for digitised sample playback on the fourth Paula voice.
   */
  sampleMode = 0

  constructor(readonly clock = C64_CLOCK_PAL) {}

  reset(): void {
    this.regs.fill(0)
    for (let i = 0; i < 3; i++) this.voices[i] = newVoice()
    this.volume = 15
    this.filterCutoff = 0
    this.filterVoices = 0
    this.voice3Off = false
    this.sampleMode = 0
  }

  /**
   * A write to $D400 + `reg`.
   *
   * The caller folds the mirror: `$2126c6` fills the map for $D400 to $D800
   * with a repeating 32-byte pattern, so $D420 is $D400 and so on up.
   */
  write(reg: number, value: number): void {
    const r = reg & 0x1f
    const v = value & 0xff
    if (r < SID_REGISTERS) this.regs[r] = v

    if (r < 0x15) {
      const voice = this.voices[Math.floor(r / 7)]!
      switch (r % 7) {
        case 0: voice.freq = (voice.freq & 0xff00) | v; break
        case 1: voice.freq = (voice.freq & 0x00ff) | (v << 8); break
        case 2: voice.pulseWidth = (voice.pulseWidth & 0x0f00) | v; break
        case 3: voice.pulseWidth = (voice.pulseWidth & 0x00ff) | ((v & 0x0f) << 8); break
        case 4: this.setControl(voice, v); break
        case 5:
          voice.attack = v >> 4
          voice.decay = v & 0x0f
          break
        case 6:
          voice.sustain = v >> 4
          voice.release = v & 0x0f
          break
      }
      return
    }

    switch (r) {
      case 0x15: this.filterCutoff = (this.filterCutoff & 0x7f8) | (v & 0x07); break
      case 0x16: this.filterCutoff = (this.filterCutoff & 0x007) | (v << 3); break
      case 0x17: this.filterVoices = v & 0x07; break
      case 0x18:
        this.volume = v & 0x0f
        this.voice3Off = (v & 0x80) !== 0
        break
      case 0x1d: this.sampleMode = v; break
    }
  }

  /**
   * The gate bit is the only one with an edge: setting it starts the attack,
   * clearing it starts the release, and writing the same value again does
   * neither. The test bit holds the oscillator at zero and reseeds the noise
   * register, which is how a tune gets a repeatable noise burst.
   */
  private setControl(voice: SidVoice, v: number): void {
    const wasGate = (voice.control & CTRL_GATE) !== 0
    const isGate = (v & CTRL_GATE) !== 0
    voice.control = v
    if (isGate && !wasGate) voice.phase = 'attack'
    else if (!isGate && wasGate) voice.phase = 'release'
    if (v & CTRL_TEST) {
      voice.phaseAcc = 0
      voice.lfsr = 0x7ffff8
    }
  }

  /**
   * A read of $D400 + `reg`.
   *
   * Only $D419 and $D41A return anything on a real chip: the paddle inputs,
   * which are open here, and then $D41B and $D41C, voice 3's oscillator and
   * envelope. Tunes read those two constantly, as a random number generator
   * and as a modulation source, and `$211308` and `$211318` are the library
   * feeding them. Everything else reads as zero, and this returns 0 rather
   * than the last value written, because the SID is write-only below $D419.
   */
  read(reg: number): number {
    const r = reg & 0x1f
    if (r === 0x1b) return Math.floor(this.oscillatorOutput(2) * 255) & 0xff
    if (r === 0x1c) return this.voices[2]!.env & 0xff
    return 0
  }

  /**
   * Step every envelope forward by `dt` seconds.
   *
   * The chip's envelope counter runs off φ2 and this runs off the frame, so
   * one call per play routine is one frame's worth. That is the granularity
   * `playsid.library` works at too: its envelope is whatever the interrupt
   * left behind, and `DisplayData.Enve` is one word per voice per frame.
   */
  tickEnvelopes(dt: number): void {
    for (const v of this.voices) {
      switch (v.phase) {
        case 'attack': {
          v.env += (255 * dt * 1000) / ATTACK_MS[v.attack]!
          if (v.env >= 255) {
            v.env = 255
            v.phase = 'decay'
          }
          break
        }
        case 'decay': {
          const target = (v.sustain * 255) / 15
          v.env -= (255 * dt * 1000) / (ATTACK_MS[v.decay]! * 3)
          if (v.env <= target) {
            v.env = target
            v.phase = 'sustain'
          }
          break
        }
        case 'sustain':
          // The sustain level tracks $D406 while the gate is held, which is
          // how a tune fades a held note without retriggering it.
          v.env = (v.sustain * 255) / 15
          break
        case 'release': {
          v.env -= (255 * dt * 1000) / (ATTACK_MS[v.release]! * 3)
          if (v.env < 0) v.env = 0
          break
        }
      }
    }
  }

  /**
   * One oscillator's output at its current phase, as -1 to 1.
   *
   * Used for $D41B and for building the waveform a Paula voice loops over.
   * Ring modulation and sync both read the PREVIOUS voice, wrapping from
   * voice 0 to voice 2, which is the chip's ring of three.
   */
  oscillatorOutput(index: number): number {
    const v = this.voices[index]!
    if (v.control & CTRL_TEST) return 0
    return this.sampleWaveform(v, v.phaseAcc, this.voices[(index + 2) % 3]!)
  }

  /**
   * The waveform at a phase from 0 to 1, as -1 to 1.
   *
   * Combining waveform bits on a real 6581 ANDs the bits together through
   * the oscillator's own output and is famously not a clean mix. Two
   * selected at once is rare and three is rarer, so this ANDs the 12-bit
   * outputs, which gets the common triangle-and-sawtooth case close and the
   * exotic ones approximately.
   */
  sampleWaveform(v: SidVoice, phase: number, prev: SidVoice): number {
    const ctrl = v.control
    if (ctrl & CTRL_TEST) return 0

    let p = phase % 1
    if (p < 0) p += 1

    // Sync: the previous oscillator's wrap resets this one. At frame
    // granularity there is no wrap to see, so what is modelled is the phase
    // relationship rather than the reset instant.
    if (ctrl & CTRL_SYNC && prev.freq !== 0) {
      p = (p * (v.freq / Math.max(1, prev.freq))) % 1
    }

    let acc = 0
    let n = 0

    if (ctrl & CTRL_TRIANGLE) {
      // Ring modulation replaces the triangle's MSB with its XOR against the
      // previous oscillator's, which is the only place ring mod applies.
      let t = p
      if (ctrl & CTRL_RING) {
        const prevMsb = prev.phaseAcc % 1 >= 0.5 ? 1 : 0
        if (prevMsb) t = (t + 0.5) % 1
      }
      acc += t < 0.5 ? t * 4 - 1 : 3 - t * 4
      n++
    }
    if (ctrl & CTRL_SAWTOOTH) {
      acc += p * 2 - 1
      n++
    }
    if (ctrl & CTRL_PULSE) {
      acc += p < v.pulseWidth / 4096 ? 1 : -1
      n++
    }
    if (ctrl & CTRL_NOISE) {
      acc += ((v.lfsr >> 11) & 0xff) / 127.5 - 1
      n++
    }
    if (n === 0) return 0
    // Two waveforms at once AND on the chip; averaging is the tractable
    // stand-in and is exact for the single-waveform case that is almost all
    // of them.
    return acc / n
  }

  /** Clock the noise LFSR, bit 22 XOR bit 17, which is the 6581's tap pair. */
  clockNoise(v: SidVoice, steps: number): void {
    for (let i = 0; i < steps; i++) {
      const bit = (((v.lfsr >> 22) ^ (v.lfsr >> 17)) & 1) >>> 0
      v.lfsr = ((v.lfsr << 1) | bit) & 0x7fffff
    }
  }
}
