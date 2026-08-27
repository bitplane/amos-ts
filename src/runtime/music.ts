/**
 * The AMOS music bank player — a port of the interrupt player in
 * extensions/+Music.s (MusInt/Music/MuStep/MuEvery/DoEffects,
 * lines 1091-1665), driving the AudioSink instead of Paula registers.
 *
 * The bank (number 3, "Music   ") is converted Soundtracker: three
 * sections addressed by longs at payload +0/+4/+8 (BkNew +Music.s:1017)
 * — instruments, songs, patterns. Instrument records are 32 bytes at
 * BankInst+2+n*32: sample offset.l, repeat offset.l, length.w (words),
 * repeat length.w, default volume.w, name (EtInst 1338, DoNote 1237,
 * MuEvery 1581). Songs: count.w then long offsets; each song holds four
 * word offsets to per-voice pattern lists. Patterns: count.w then a
 * word offset per (pattern, voice) into the stream data.
 *
 * Pattern stream words (MuStep 1223): $0xxx = note (period, triggers
 * the current instrument), $4xxx = old-format note (low byte = delay,
 * next word = optional note), $8000|cmd<<8|arg = command via MuJumps.
 *
 * Deviations (honest): note triggers start playback immediately instead
 * of after the one-vbl DMA-off gap (Mus3/MuEvX latch dance); a 2-byte
 * repeat region plays silence (one-shot) rather than looping whatever
 * two bytes it points at; malformed streams that would hang the Amiga
 * in the interrupt are stopped by an iteration guard.
 */

import { AmosError, funcCall } from '../interp/values'
import { PT_SINE } from '../amiga/notes'
import { AMIGA_PERIODS, PAULA_CLOCK, periodToHz, samPeriod } from '../amiga/paula'
import { MedPlayer } from './med'
import type { AudioSink } from '../amiga/paula'

/** what the player needs from the runtime */
export interface MusicHost {
  audio: AudioSink
  vuBytes: Uint8Array
  musicVolume: number
  tick: () => number
  beam: () => number
  musicBank: () => Uint8Array | null
  getBank: (n: number) => { name: string; data: Uint8Array } | null
  getSample: (n: number) => { pcm: Int8Array; freq: number }
  samLoop: () => number
  voiceVolume: (v: number) => number
}

type Effect = 'none' | 'slide' | 'arp' | 'ptone' | 'vib' | 'vsl'

interface MuVoice {
  adr: number // pattern-stream position (payload offset); -1 = FoEnd fake pattern
  deb: number // Repeat loop-back position (0 = unset)
  inst: number // instrument record offset in the payload; -1 = none
  dpat: number // song voice-list start
  pat: number // current position in the voice list
  cpt: number // step counter — only the low byte counts (VoiCpt+1)
  rep: number
  note: number // current period
  dvol: number
  vol: number
  effect: Effect
  value: number // VoiValue word (arp keeps its phase in the high byte)
  ptoTo: number
  ptone: boolean
  vib: number // vibrato phase byte
}

interface MuSong {
  voices: MuVoice[]
  cpt: number // MuCpt
  tempo: number // MuTempo
}

const TEMPO_BASE = 100 // PAL (MusDef +Music.s:852)

/**
 * Periods table (+Music.s:2150) — arpeggio semitone lookup.
 *
 * The 36 periods are the standard Amiga table, shared with every other
 * replayer (../amiga/paula.ts). The TWO ZEROS are AMOS's own: its assembled
 * table has them, and the arpeggio lookup below indexes `i + nibble`, which
 * runs past the last note and reads them. They are padding this code depends
 * on, so they stay here rather than going into the shared table.
 */
const PERIODS = [...AMIGA_PERIODS, 0, 0]

/**
 * Sinus (+Music.s:2146) — the vibrato waveform, an unsigned half-sine.
 *
 * AMOS's thirty-two bytes are the ProTracker table value for value, so it is
 * `PT_SINE` in `../amiga/notes.ts`, shared with the two tracker replays. The
 * two shift depths below are AMOS's own and stay here.
 */
const SINUS = PT_SINE

// ---- the wavetable synth tables (+Music.s:2156-2183) ----------------------

/** default envelopes (EnvDef/EnvShoot/EnvBoom/EnvBell): (duration, volume) pairs, 0 = end */
export const ENV_DEF = [1, 64, 4, 55, 5, 50, 25, 0, 0, 0, 0, 0, 0, 0, 0, 0]
export const ENV_SHOOT = [1, 64, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
export const ENV_BOOM = [1, 64, 10, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
export const ENV_BELL = [1, 64, 4, 40, 25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

/** wave buffer length: 256+128+64+32+16+8+4+2 (LWave) */
const LWAVE = 510

/** TFreq: per-octave (byte offset, length in words) into the wave mip chain */
const TFREQ: Array<[number, number]> = [
  [0, 128], [0, 128], [256, 64], [384, 32], [448, 16], [480, 8], [496, 4], [504, 2], [504, 2],
]

/** TNotes: note frequencies in Hz, indexed by note+2 */
const TNOTES = [
  0, 0, 0, 33, 35, 37, 39, 41, 44, 46, 49, 52,
  55, 58, 62, 65, 69, 73, 78, 82, 87, 92, 98, 104,
  110, 117, 123, 131, 139, 147, 156, 165, 175, 185, 196, 208,
  220, 233, 247, 262, 277, 294, 311, 330, 349, 370, 392, 415,
  440, 466, 494, 523, 554, 587, 622, 659, 698, 740, 784, 830,
  880, 932, 988, 1046, 1109, 1175, 1245, 1319, 1397, 1480, 1568, 1661,
  1760, 1865, 1986, 2093, 2217, 2349, 2489, 2637, 2794, 2960, 3136, 3322,
  3520, 3729, 3952, 4186, 4435, 4699, 4978, 5274, 5588, 5920, 6272, 6645,
  7040, 7459, 7902, 8372,
]

export interface Wave {
  /** 8 (duration, volume) pairs; 0 duration ends, negative loops */
  env: number[]
  /** the 510-byte mip chain (256+128+...+2) */
  data: Int8Array
}

/** NeWave's mip build (+Music.s:3510-3545): halve the 256-byte wave 6 times */
function waveMips(src: Int8Array): Int8Array {
  const out = new Int8Array(LWAVE)
  out.set(src.subarray(0, 256))
  let from = 0
  let to = 256
  for (let size = 128; size >= 4; size >>= 1) {
    for (let i = 0; i < size; i++) {
      out[to + i] = (out[from + i * 2]! + out[from + i * 2 + 1]!) >> 1
    }
    from = to
    to += size
  }
  return out
}

function newVoice(): MuVoice {
  return {
    adr: -1, deb: 0, inst: -1, dpat: 0, pat: 0, cpt: 0, rep: 0, note: 0,
    dvol: 0, vol: 0, effect: 'none', value: 0, ptoTo: 0, ptone: false, vib: 0,
  }
}

export class MusicPlayer {
  private host: MusicHost
  /** the music stack — up to 3 nested musics (MuBuffer/MuNumber) */
  private stack: MuSong[] = []
  /** MuDMAsk: voices the player may drive */
  dmask = 0b1111
  /** MuReStart: voices to reclaim at the next vbl */
  private restart = 0
  /** the bound bank payload (BkCheck rebinds when the bank changes) */
  private bound: Uint8Array | null = null
  private instBase = 0
  private songBase = 0
  private patBase = 0
  /** tick at which a one-shot Sam Play ends per voice (Sami end -> MuReStart) */
  samEnd = [Infinity, Infinity, Infinity, Infinity]
  /** queued Sam Swap double-buffers (Sami_radr/rlong, +Music.s:4080) */
  private samSwaps: Array<{ pcm: Int8Array; hz: number; vol: number } | null> = [null, null, null, null]
  /**
   * =Sam Swapped states (FnSamSwapped +Music.s:4055): 1 = voice's sample
   * interrupt is off, 0 = a swap is still pending, -1 = playing with the
   * swap consumed (ready for the next).
   */
  samState = [1, 1, 1, 1]
  /** last values sent to the sink, to skip per-vbl no-op writes */
  private lastFreq = [0, 0, 0, 0]
  private lastVol = [-1, -1, -1, -1]

  // ---- wavetable synth state (+Music.s waves/envelopes) ----
  /** wave list; 0 = the vbl-refreshed noise buffer, 1 = the square */
  waves = new Map<number, Wave>()
  /** Waves per voice: wave number, 0 = noise, -n = sample n (NoWave default 1) */
  voiceWave = [1, 1, 1, 1]
  /** Noise word: voices currently playing noise */
  noiseMask = 0
  private noiseSeed = 0
  private noisePos = 0
  /** per-voice ADSR machine (EnvBase entries) */
  private envs = [0, 1, 2, 3].map(() => ({
    on: false,
    pairs: ENV_DEF as number[],
    pos: 0,
    vol: 0, // EnvVol, 16.16 fixed point
    delta: 0,
    nb: 0,
  }))

  /** the MED player (its own interrupt on the Amiga; stepped from our vbl) */
  med!: MedPlayer

  constructor(host: MusicHost) {
    this.host = host
    this.med = new MedPlayer(host)
    // MusDef (+Music.s:897-917): wave 1 is a square, wave 0 is the noise
    // buffer, seeded by the same LCG the vbl refresh uses
    const square = new Int8Array(256)
    square.fill(127, 0, 128)
    square.fill(-127, 128)
    this.waves.set(0, { env: ENV_DEF.slice(), data: waveMips(square) })
    this.waves.set(1, { env: ENV_DEF.slice(), data: waveMips(square) })
    const noise = this.waves.get(0)!.data
    let seed = 0
    for (let i = 0; i + 1 < LWAVE; i += 2) {
      seed = ((seed * 0x3171) >>> 8) & 0xffff
      noise[i] = (seed >> 8) << 24 >> 24
      noise[i + 1] = (seed & 0xff) << 24 >> 24
    }
    this.noiseSeed = seed
  }

  get playing(): boolean {
    return this.stack.length > 0
  }

  // ---- bank access -------------------------------------------------------

  /** bounds-checked big-endian reads over the bank payload */
  private w(off: number): number {
    const d = this.bound
    if (!d || off < 0 || off + 2 > d.length) return 0
    return (d[off]! << 8) | d[off + 1]!
  }

  private l(off: number): number {
    const d = this.bound
    if (!d || off < 0 || off + 4 > d.length) return 0
    return ((d[off]! << 24) | (d[off + 1]! << 16) | (d[off + 2]! << 8) | d[off + 3]!) >>> 0
  }

  /**
   * BkCheck (+Music.s:987): rebind when bank 3 changes; a vanished or
   * replaced bank stops the music (MuInit) so it cannot "crash".
   */
  ensureBank(): void {
    const bank = this.host.musicBank()
    if (bank === this.bound) return
    if (this.playing) this.musicOff()
    this.bound = bank
    if (bank) {
      this.instBase = this.l(0)
      this.songBase = this.l(4)
      this.patBase = this.l(8)
    }
  }

  // ---- keywords ----------------------------------------------------------

  /** InMusic (+Music.s:3815) */
  music(n: number): void {
    if (n <= 0) funcCall()
    this.ensureBank()
    if (!this.bound) throw new AmosError('music bank not found')
    const count = this.w(this.songBase)
    if (n > count) throw new AmosError('music not defined')
    if (this.stack.length >= 3) return // no room — current music keeps playing
    const songOff = this.songBase + this.l(this.songBase + 2 + n * 4 - 4)
    const voices: MuVoice[] = []
    for (let v = 0; v < 4; v++) {
      const V = newVoice()
      V.cpt = 1 // steps at the first tick
      V.adr = -1 // FoEnd fake pattern (+Music.s:2139)
      const rel = this.w(songOff + v * 2)
      V.pat = songOff + (rel >= 0x8000 ? rel - 0x10000 : rel) // add.w sign-extends
      V.dpat = V.pat
      voices.push(V)
    }
    this.stack.push({ voices, cpt: TEMPO_BASE, tempo: 17 })
  }

  /** InMusicOff (+Music.s:3688) */
  musicOff(): void {
    this.stack = []
    this.mOff()
  }

  /** InMusicStop (+Music.s:3701): zero the counters — the next step-tick pops */
  musicStop(): void {
    const s = this.cur()
    if (!s) return
    for (const V of s.voices) V.cpt = 0
  }

  /** InTempo (+Music.s:3878): only affects the currently playing music */
  tempo(t: number): void {
    const s = this.cur()
    if (s) s.tempo = t
  }

  /** MVol (+Music.s:3727): rescale every stacked music's live volumes */
  setMusicVolume(): void {
    const mv = this.host.musicVolume
    for (const s of this.stack) {
      for (const V of s.voices) V.vol = (V.dvol * mv) >> 6
    }
  }

  /** VOnOf (+Music.s:3767): only acts while a music is playing */
  voiceOnOff(mask: number): void {
    const s = this.cur()
    if (!s) return
    const old = this.dmask
    this.dmask = mask & 15
    for (let v = 0; v < 4; v++) {
      const bit = 1 << v
      if (!(mask & bit)) {
        if (old & bit) {
          this.host.audio.stop(v)
          this.lastVol[v] = -1
          this.lastFreq[v] = 0
        }
      } else if (!(old & bit)) {
        this.restart |= bit
      }
    }
  }

  /** GoSam voice steal (+Music.s:3176): Sam Play sets the mask to the complement */
  samSteal(mask: number): void {
    this.voiceOnOff(~mask & 15)
  }

  // ---- the vbl interrupt (MusInt +Music.s:1092) --------------------------

  vbl(): void {
    this.ensureBank()
    // MusInt (+Music.s:1092): envelopes and the noise refresh run before
    // the music/tracker players
    this.envStep()
    // Sami natural end (+Music.s:1062): a queued Sam Swap buffer takes
    // over first (.swap); otherwise the voice ends and MuReStart hands
    // it back to the music
    const t = this.host.tick()
    for (let v = 0; v < 4; v++) {
      if (t >= this.samEnd[v]!) {
        const sw = this.samSwaps[v]
        if (sw) {
          this.samSwaps[v] = null
          this.samState[v] = -1
          this.host.audio.play(v, sw.pcm, sw.hz, sw.vol, -1, sw.pcm.length)
          this.samEnd[v] = t + Math.ceil((sw.pcm.length / sw.hz) * 50)
        } else {
          this.samEnd[v] = Infinity
          this.samState[v] = 1
          this.restart |= 1 << v
        }
      }
    }
    const s = this.cur()
    if (!s) {
      // "Music: beq Tracker" (+Music.s:1138) — the tracker only steps
      // while no bank music is playing
      this.trackerVbl()
    } else {
      this.muEvery(s)
      s.cpt += s.tempo
      if (s.cpt >= TEMPO_BASE) {
        s.cpt -= TEMPO_BASE
        this.stepTick(s)
      } else {
        this.doEffects(s)
      }
    }
    // the MED player runs on its own interrupt on the Amiga
    this.med.vbl()
  }

  private cur(): MuSong | null {
    return this.stack[this.stack.length - 1] ?? null
  }

  /** MuEvery (+Music.s:1576): restart reclaimed voices at their repeat region */
  private muEvery(s: MuSong): void {
    let r = this.restart & 15
    if (!r) return
    this.restart = 0
    this.dmask |= r // MuRs3 (+Music.s:1662)
    for (let v = 0; v < 4; v++) {
      if (!(r & (1 << v))) continue
      const V = s.voices[v]!
      if (V.inst < 0) continue
      // the 68k re-enables DMA on the repeat region of the current
      // instrument (AUDxLEN=2 then the MuStop relatch)
      const region = this.instrumentPcm(V.inst, true)
      if (region && V.note > 0) {
        this.play(v, region.pcm, periodToHz(V.note), V.vol, region.loopStart, region.loopEnd)
      }
    }
  }

  /** one tempo wrap: count down the voices, step those that hit zero */
  private stepTick(s: MuSong): void {
    // the deferred repeat pointers land before this frame's note work, as
    // they do at the top of the Tracker interrupt
    this.latchPendingLoops()
    let active = 0
    for (let v = 0; v < 4; v++) {
      const V = s.voices[v]!
      if (V.cpt === 0) continue
      active++
      V.cpt = (V.cpt - 1) & 0xff
      if (V.cpt === 0) this.stepVoice(s, v)
    }
    if (active === 0) this.finished()
  }

  /** MuFin/MuFini (+Music.s:1204): pop the music stack */
  private finished(): void {
    this.stack.pop()
    const prev = this.cur()
    if (prev) {
      this.restart = this.dmask // MuFin: MuReStart = MuDMAsk
    } else {
      this.mOff()
    }
  }

  /** MOff (+Music.s:2421): silence the player's voices */
  private mOff(): void {
    for (let v = 0; v < 4; v++) {
      if (!(this.dmask & (1 << v))) continue
      this.host.audio.stop(v)
      this.lastVol[v] = -1
      this.lastFreq[v] = 0
    }
  }

  // ---- one step of one voice (MuStep +Music.s:1223) ----------------------

  private stepVoice(s: MuSong, v: number): void {
    const V = s.voices[v]!
    let pos = V.adr
    // a stream with no delay would spin the 68k interrupt forever; guard
    for (let guard = 0; guard < 20000; guard++) {
      let word: number
      if (pos < 0) {
        word = 0x8000 // FoEnd: a lone "end of pattern"
        pos = 0
      } else {
        word = this.w(pos)
        pos += 2
      }
      if (!(word & 0x8000)) {
        if (word & 0x4000) {
          // OldNote (+Music.s:1259): low byte = duration, next word = note
          V.cpt = word & 0xff
          const n = this.w(pos)
          pos += 2
          if (n !== 0) {
            const per = n & 0x0fff
            V.note = per
            this.perWrite(v, per)
            this.triggerSample(s, v, per)
          }
          V.adr = pos
          return
        }
        // DoNote (+Music.s:1233)
        const per = word & 0x0fff
        this.triggerSample(s, v, per)
        if (!V.ptone) {
          V.note = per
          this.perWrite(v, per)
        } else {
          // pending Portamento: the note becomes the slide target
          V.ptone = false
          V.ptoTo = per
          V.effect = 'ptone'
        }
        continue
      }
      // command (MuJumps +Music.s:1278)
      const cmd = (word >> 8) & 0x7f
      const arg = word & 0xff
      switch (cmd) {
        case 0: {
          // EtEnd: next pattern from the voice list
          V.cpt = 0
          V.rep = 0
          V.deb = 0
          V.effect = 'none'
          const next = this.nextPattern(V, v)
          if (next < 0) return // voice halts (list end / bad pattern)
          pos = next
          continue
        }
        case 3: {
          // EtSVol
          V.dvol = Math.min(arg, 63)
          V.vol = (V.dvol * this.host.musicVolume) >> 6
          continue
        }
        case 4:
          V.effect = 'none'
          continue
        case 5: {
          // EtRep
          if (arg === 0) {
            V.deb = pos
          } else if (V.rep === 0) {
            V.rep = arg
          } else {
            V.rep = (V.rep - 1) & 0xffff
            if (V.rep !== 0 && V.deb !== 0) pos = V.deb
          }
          continue
        }
        case 6:
          this.host.audio.setFilter(true) // EtLOn
          continue
        case 7:
          this.host.audio.setFilter(false) // EtLOff
          continue
        case 8:
          s.tempo = arg // EtTemp
          continue
        case 9: {
          // EtInst
          V.inst = this.instBase + 2 + arg * 32
          V.dvol = Math.min(this.w(V.inst + 12), 63)
          V.vol = (V.dvol * this.host.musicVolume) >> 6
          continue
        }
        case 10: {
          // EtArp: arg in the low byte, phase lives in the high byte
          V.value = (V.value & 0xff00) | arg
          V.effect = 'arp'
          continue
        }
        case 11:
          // EtPort
          V.ptone = true
          V.value = arg
          V.effect = 'ptone'
          continue
        case 12:
          V.value = arg // EtVib
          V.effect = 'vib'
          continue
        case 13: {
          // EtVSl: high nibble slides up, else low nibble slides down
          const up = arg >> 4
          V.value = up !== 0 ? up : -(arg & 0x0f) & 0xffff
          V.effect = 'vsl'
          continue
        }
        case 14:
          V.value = -arg & 0xffff // EtSlU
          V.effect = 'slide'
          continue
        case 15:
          V.value = arg // EtSlD
          V.effect = 'slide'
          continue
        case 16:
          // EtDel: the step ends here; only the low byte counts
          V.cpt = arg
          V.adr = pos
          return
        case 17: {
          // EtJmp: jump into the song list, then end-of-pattern processing
          V.cpt = 0
          V.rep = 0
          V.deb = 0
          V.effect = 'none'
          V.pat = V.dpat + arg * 2
          const next = this.nextPattern(V, v)
          if (next < 0) return
          pos = next
          continue
        }
        default:
          continue // 1/2 old slides and 18-31 fall through (MuSt0)
      }
    }
    V.cpt = 0 // malformed stream: halt the voice instead of hanging
  }

  /**
   * EtEnd's pattern fetch (+Music.s:1317): read the next entry of the
   * voice list; >=0 = pattern number, -1 = halt, other negatives =
   * restart the list. Returns the new stream position or -1 to halt.
   */
  private nextPattern(V: MuVoice, v: number): number {
    for (let guard = 0; guard < 1000; guard++) {
      const raw = this.w(V.pat)
      if (raw & 0x8000) {
        if (raw === 0xffff) return -1 // -1: voice done
        V.pat = V.dpat // other negative: loop the song
        continue
      }
      V.pat += 2
      const count = this.w(this.patBase)
      if (raw > count) return -1 // EtEndX
      const off = this.w(this.patBase + 2 + (raw * 4 + v) * 2)
      if (off === 0) return -1
      return this.patBase + off
    }
    return -1
  }

  /**
   * The sample side of DoNote: vumeter byte and DMA bookkeeping always
   * (the vumeter pulses even on voices Voice-d off — DoNote runs before
   * the MuDMAsk gate), sink playback only on enabled voices.
   */
  private triggerSample(s: MuSong, v: number, per: number): void {
    const V = s.voices[v]!
    this.host.vuBytes[v] = V.vol & 0xff
    if (!(this.dmask & (1 << v))) return
    if (V.inst < 0) return
    const region = this.instrumentPcm(V.inst, false)
    if (!region) return
    const hz = periodToHz(V.ptone ? V.note || per : per)
    // The trigger sets AUDxLC/LEN to the whole sample and enables DMA; the
    // REPEAT pointers are not written until the top of the next interrupt
    // (Tracker +Music.s:1678-1688 pokes $a0/$a4 from mt_voice before calling
    // mt_music). So the first pass always plays the full sample, and looping
    // only takes hold from the following vbl.
    this.play(v, region.pcm, hz, V.vol, -1, region.pcm.length)
    this.pendingLoop[v] = region.loopStart >= 0 ? { start: region.loopStart, end: region.loopEnd } : null
  }

  /**
   * Repeat pointers waiting for the next vbl, one per voice — Paula latches
   * AUDxLC/AUDxLEN when the current pass ends, so writing them a frame late
   * is what makes the first pass play in full before the loop takes over.
   */
  private pendingLoop: Array<{ start: number; end: number } | null> = [null, null, null, null]

  /** Poke the deferred repeat pointers (the top of Tracker's interrupt). */
  private latchPendingLoops(): void {
    for (let v = 0; v < 4; v++) {
      const p = this.pendingLoop[v]
      if (!p) continue
      this.pendingLoop[v] = null
      this.host.audio.setLoop(v, p.start, p.end)
    }
  }

  /**
   * Build the playable region of an instrument: first pass [off, off+len)
   * then the repeat region loops (MuEvery relatch). repeatOnly returns
   * just the loop region (voice restart).
   */
  private instrumentPcm(rec: number, repeatOnly: boolean): { pcm: Int8Array; loopStart: number; loopEnd: number } | null {
    const d = this.bound
    if (!d) return null
    const off = this.instBase + this.l(rec)
    const len = this.w(rec + 8) * 2
    const repOff = this.instBase + this.l(rec + 4)
    const repLen = this.w(rec + 10) * 2
    const looped = repLen > 2 && repOff >= off
    const start = repeatOnly && looped ? repOff : off
    const end = Math.min(d.length, looped ? Math.max(off + len, repOff + repLen) : off + len)
    if (start >= end || start < 0) return null
    const pcm = new Int8Array(d.buffer, d.byteOffset + start, end - start)
    if (!looped) return { pcm, loopStart: -1, loopEnd: pcm.length }
    return { pcm, loopStart: repOff - start, loopEnd: repOff - start + repLen }
  }

  // ---- per-vbl effects (DoEffects +Music.s:1442) -------------------------

  private doEffects(s: MuSong): void {
    for (let v = 0; v < 4; v++) {
      const V = s.voices[v]!
      switch (V.effect) {
        case 'none':
          this.perWrite(v, V.note) // NoEffect re-writes AUDxPER every vbl
          break
        case 'slide': {
          // MuSlide (+Music.s:1466)
          const val = V.value
          if (val === 0) {
            V.effect = 'none'
            break
          }
          let per = (V.note + val) & 0xffff
          if (per < 0x71) {
            per = 0x71
            V.effect = 'none'
          }
          if (per > 0x358) {
            per = 0x358
            V.effect = 'none'
          }
          V.note = per
          this.perWrite(v, per)
          break
        }
        case 'arp': {
          // MuArp (+Music.s:1488): phase cycles low nibble, base, high nibble
          const arg = V.value & 0xff
          let phase = (V.value >> 8) & 0xff
          if (phase >= 3) phase = 2
          phase = (phase - 1) & 0xff
          V.value = (phase << 8) | arg
          if (phase === 0) {
            this.perWrite(v, V.note)
            break
          }
          const nibble = phase < 0x80 ? arg & 0x0f : arg >> 4
          for (let i = 0; i < 37; i++) {
            if (PERIODS[i]! <= V.note) {
              const per = PERIODS[i + nibble]
              if (per !== undefined && per > 0) this.perWrite(v, per)
              break
            }
          }
          break
        }
        case 'ptone': {
          // MuPTone (+Music.s:1519)
          const speed = V.value & 0xffff
          let per = V.note
          if (per === V.ptoTo) {
            V.effect = 'none'
          } else if (per < V.ptoTo) {
            per = (per + speed) & 0xffff
            if (per >= V.ptoTo) {
              per = V.ptoTo
              V.effect = 'none'
            }
          } else {
            per = (per - speed) & 0xffff
            if (per <= V.ptoTo) {
              per = V.ptoTo
              V.effect = 'none'
            }
          }
          V.note = per
          this.perWrite(v, per)
          break
        }
        case 'vib': {
          // MuVib (+Music.s:1538): modulated period is written, not stored
          const arg = V.value & 0xff
          const idx = (V.vib >> 2) & 0x1f
          const depth = arg & 0x0f
          const d2 = (SINUS[idx]! * depth) >> 6
          const per = V.vib & 0x80 ? (V.note - d2) & 0xffff : (V.note + d2) & 0xffff
          this.perWrite(v, per)
          V.vib = (V.vib + ((arg >> 2) & 0x3c)) & 0xff
          break
        }
        case 'vsl': {
          // MuVSl (+Music.s:1562): slide the default volume, rescale
          const delta = V.value >= 0x8000 ? V.value - 0x10000 : V.value
          let dv = V.dvol + delta
          if (dv < 0) dv = 0
          if (dv >= 0x40) dv = 0x3f
          V.dvol = dv
          V.vol = (dv * this.host.musicVolume) >> 6
          break
        }
      }
      this.volWrite(v, V.vol)
    }
  }

  // ---- cached sink writes ------------------------------------------------

  private play(v: number, pcm: Int8Array, hz: number, vol: number, loopStart: number, loopEnd: number): void {
    this.host.audio.play(v, pcm, hz, vol, loopStart, loopEnd)
    this.lastFreq[v] = hz
    this.lastVol[v] = vol
  }

  private sinkFreq(v: number, per: number): void {
    if (per <= 0) return
    const hz = periodToHz(per)
    if (hz === this.lastFreq[v]) return
    this.lastFreq[v] = hz
    this.host.audio.setFrequency(v, hz)
  }

  private sinkVol(v: number, vol: number): void {
    if (vol === this.lastVol[v]) return
    this.lastVol[v] = vol
    this.host.audio.setVolume(v, vol)
  }

  /** AUDxPER write — skipped for voices the mask routes to the dummy buffer */
  private perWrite(v: number, per: number): void {
    if (this.dmask & (1 << v)) this.sinkFreq(v, per)
  }

  /** AUDxVOL write, once per change */
  private volWrite(v: number, vol: number): void {
    if (this.dmask & (1 << v)) this.sinkVol(v, vol)
  }

  // ---- the wavetable synth (Play/Bell/Boom/Shoot, +Music.s:2676-3563) ----

  /**
   * GoBel (+Music.s:2822): note 0-96, steal the voices from the music,
   * start each one. forcedWave: -1 = the voice's Waves entry (Play),
   * 1 = the square (Bell), 0 = noise (Boom/Shoot via shout()).
   */
  playNote(mask: number, note: number, forcedWave = -1, forcedEnv: number[] | null = null): void {
    if (note < 0 || note > 96) funcCall()
    this.samSteal(mask & 15)
    for (let v = 0; v < 4; v++) {
      if (mask & (1 << v)) this.vPlay(v, note, forcedWave, forcedEnv)
    }
  }

  /** Shout (+Music.s:2722): rising notes voice 3 down to 0 — "a stereo effect" */
  shout(baseNote: number, env: number[]): void {
    this.voiceOnOff(0)
    let note = baseNote
    for (let v = 3; v >= 0; v--) {
      this.vPlay(v, note, 0, env)
      note++
    }
  }

  /** VPlay (+Music.s:2865): one voice — wave, noise or pitched sample */
  private vPlay(v: number, note: number, forcedWave: number, forcedEnv: number[] | null): void {
    const bit = 1 << v
    this.noiseMask &= ~bit
    this.samEnd[v] = Infinity
    if (note === 0) {
      // VSil: silence the voice, envelope off
      this.host.audio.stop(v)
      this.envs[v]!.on = false
      return
    }
    const idx = note + 2 // TNotes index (the 68k's note+3-1)
    const w = forcedWave >= 0 ? forcedWave : this.voiceWave[v]!
    if (w < 0) {
      // VPl2: sample pitched relative to A440, no envelope, Sam Loop applies
      const s = this.host.getSample(-w)
      const freq = Math.min(0xffff, Math.floor((s.freq * (TNOTES[idx] ?? 0)) / 440))
      this.envs[v]!.on = false
      const hz = periodToHz(samPeriod(freq))
      const loop = (this.host.samLoop() >> v) & 1
      this.play(v, s.pcm, hz, this.host.voiceVolume(v), loop ? 0 : -1, s.pcm.length)
      this.samEnd[v] = loop ? Infinity : this.host.tick() + Math.ceil((s.pcm.length / hz) * 50)
      return
    }
    if (w === 0) {
      // VPl4: noise — the head wave's buffer, looped, envelope-driven
      const wave0 = this.waves.get(0)!
      this.noiseMask |= bit
      const freq = Math.min(0xffff, Math.floor((2000 * (TNOTES[idx] ?? 0)) / 440))
      this.play(v, wave0.data, periodToHz(samPeriod(freq)), 0, 0, wave0.data.length)
      this.startEnv(v, forcedEnv ?? wave0.env)
      return
    }
    // VPl0: wavetable — pick the mip for the octave, loop it at the note rate
    const rec = this.waves.get(w)
    if (!rec) throw new AmosError('wave not defined')
    const [off, lenW] = TFREQ[Math.min(8, Math.floor(idx / 12))]!
    const lenBytes = lenW * 2
    const per = Math.max(124, Math.floor(PAULA_CLOCK / (lenBytes * ((TNOTES[idx] ?? 0) || 1))))
    this.play(v, rec.data.subarray(off, off + lenBytes), periodToHz(per), 0, 0, lenBytes)
    this.startEnv(v, forcedEnv ?? rec.env)
  }

  private startEnv(v: number, pairs: number[]): void {
    const e = this.envs[v]!
    e.on = true
    e.pairs = pairs
    e.pos = 0
    e.vol = 0
    this.envNext(v)
  }

  /** MuIntE (+Music.s:3638): advance to the next envelope segment */
  private envNext(v: number): void {
    const e = this.envs[v]!
    for (let guard = 0; guard < 32; guard++) {
      const dur = e.pairs[e.pos]
      if (dur === undefined || dur === 0) {
        // MuIntS: envelope finished — stop the voice, the music reclaims it
        e.on = false
        this.host.audio.stop(v)
        this.lastVol[v] = -1
        this.lastFreq[v] = 0
        this.noiseMask &= ~(1 << v)
        this.restart |= 1 << v
        return
      }
      if (dur < 0) {
        e.pos = 0 // loop to EnvDeb
        continue
      }
      const target = (this.host.voiceVolume(v) * (e.pairs[e.pos + 1] ?? 0)) >> 6
      const cur = e.vol >> 16
      e.delta = (Math.trunc(((target - cur) << 8) / dur) << 8) | 0
      e.vol = cur << 16
      e.nb = dur
      e.pos += 2
      return
    }
    e.on = false
  }

  /** the per-vbl envelope walk + noise refresh (MusInt +Music.s:1093-1134) */
  private envStep(): void {
    for (let v = 0; v < 4; v++) {
      const e = this.envs[v]!
      if (!e.on) continue
      e.vol = (e.vol + e.delta) | 0
      this.sinkVol(v, (e.vol >> 16) & 0xffff)
      if (--e.nb === 0) this.envNext(v)
    }
    if (this.noiseMask) {
      // 8 fresh random words per vbl into the head wave, beam-seeded
      const noise = this.waves.get(0)!.data
      let pos = this.noisePos
      let seed = this.noiseSeed
      for (let i = 0; i < 8; i++) {
        seed = ((((seed + this.host.beam()) & 0xffff) * 0x3171) >>> 8) & 0xffff
        noise[pos] = ((seed >> 8) << 24) >> 24
        noise[pos + 1] = ((seed & 0xff) << 24) >> 24
        pos -= 2
        if (pos < 0) pos = LWAVE - 2
      }
      this.noisePos = pos
      this.noiseSeed = seed
    }
  }

  /** EnvOff (+Music.s:3611): Play Off — stop envelopes, music reclaims */
  playOff(mask: number): void {
    let stopped = 0
    for (let v = 0; v < 4; v++) {
      const bit = 1 << v
      const e = this.envs[v]!
      if (!(mask & bit) || !e.on) continue
      e.on = false
      stopped |= bit
      this.host.audio.stop(v)
      this.lastVol[v] = -1
      this.lastFreq[v] = 0
    }
    this.restart = stopped // EnvOff overwrites MuReStart (+Music.s:3631)
  }

  /** a Sam Play on a voice kills its envelope and noise (SPl0/SPlay) */
  onSamVoice(v: number): void {
    this.envs[v]!.on = false
    this.noiseMask &= ~(1 << v)
    this.samSwaps[v] = null
    this.samState[v] = -1
  }

  /** InSamSwap (+Music.s:4080): queue the next buffer for playing voices */
  samSwap(mask: number, pcm: Int8Array): void {
    for (let v = 0; v < 4; v++) {
      if (!(mask & (1 << v))) continue
      const hz = this.lastFreq[v]! || periodToHz(samPeriod(8363))
      const vol = this.lastVol[v]! >= 0 ? this.lastVol[v]! : this.host.voiceVolume(v)
      this.samSwaps[v] = { pcm, hz, vol }
      if (this.samState[v] !== 1) this.samState[v] = 0
    }
  }

  /** InSamStop kills the interrupt: the state reads 1, swaps are dropped */
  onSamStop(v: number): void {
    this.samState[v] = 1
    this.samSwaps[v] = null
  }

  /** InSetWave/NeWave (+Music.s:3387/3488): replacing stops all envelopes */
  setWave(n: number, src: Int8Array): void {
    if (this.waves.has(n)) {
      this.playOff(0b1111)
      this.waves.delete(n)
    }
    this.waves.set(n, { env: ENV_DEF.slice(), data: waveMips(src) })
  }

  /** InDelWave (+Music.s:3405): also resets every voice to wave 1 (NoWave) */
  delWave(n: number): void {
    this.playOff(0b1111)
    if (!this.waves.has(n)) throw new AmosError('wave not defined')
    this.waves.delete(n)
    this.voiceWave = [1, 1, 1, 1]
  }

  /** InSetEnvel (+Music.s:3426): set one phase and terminate after it */
  setEnvel(wave: number, phase: number, dur: number, vol: number): void {
    const rec = this.waves.get(wave)
    if (!rec) throw new AmosError('wave not defined')
    rec.env[phase * 2] = dur
    rec.env[phase * 2 + 1] = vol
    if (phase * 2 + 2 < 16) rec.env[phase * 2 + 2] = 0
  }

  /** InWave (+Music.s:3373): Wave n To voices — the wave must exist */
  waveTo(n: number, mask: number): void {
    if (!this.waves.has(n)) throw new AmosError('wave not defined')
    for (let v = 0; v < 4; v++) if (mask & (1 << v)) this.voiceWave[v] = n
  }

  noiseTo(mask: number): void {
    for (let v = 0; v < 4; v++) if (mask & (1 << v)) this.voiceWave[v] = 0
  }

  /** InSampleTo (+Music.s:3102): Waves entry = -n */
  sampleTo(n: number, mask: number): void {
    this.host.getSample(n) // validates, GetSam errors propagate
    for (let v = 0; v < 4; v++) if (mask & (1 << v)) this.voiceWave[v] = -n
  }

  // ---- the Tracker (ProTracker MOD replay, Tracker/mt_* +Music.s:1673) ---
  // A separate player over raw modules loaded by Track Load; it only
  // steps while no bank music plays. The DMA latch dance (row: DMA off +
  // first-part LC/LEN, beam-wait, DMA on; next vbl: loop-part LC/LEN) is
  // collapsed into play() with the loop region, as with the bank player.

  mtOn = false
  /** Track_Bank (+Music.s:2298): default 6 */
  trackBank = 6
  /** Track_Loop */
  trackLoop = false
  /**
   * EME 3.0's pattern-loop mode — its own byte at $be9, which stock AMOS has
   * no equivalent of. 0 plays the song, 1 repeats the current pattern for
   * ever, 2 stops when it ends. `Patt Loop On`/`Of`/`No` set it and
   * `mtNext` is where it acts; see `eme.ts`.
   */
  pattLoop: 0 | 1 | 2 = 0
  private trackStopFlag = false
  private mtData: Uint8Array | null = null
  private mtBankNum = 6
  private mtSpeed = 6
  private mtCounter = 0
  private mtSongpos = 0
  private mtPattpos = 0
  private mtBreak = false
  /** sample start offsets by instrument number 1-31 (mt_samplestarts) */
  private mtStarts: number[] = []
  private mtVoices = [0, 1, 2, 3].map(() => ({
    note: 0, // row word 0 ((a4))
    cmd: 0, // row word 1 (2(a4))
    start: 0, // 4(a4)
    length: 0, // 8(a4), words
    loopStart: 0, // $a(a4)
    repLen: 0, // $e(a4), words
    period: 0, // $10(a4)
    volume: 0, // $13(a4)
    portDir: false, // $14(a4): true = slide down toward a lower period
    portSpeed: 0, // $15(a4)
    portTarget: 0, // $16(a4)
    vibCmd: 0, // $18(a4)
    vibPos: 0, // $19(a4)
  }))

  private mw(off: number): number {
    const d = this.mtData
    if (!d || off < 0 || off + 2 > d.length) return 0
    return (d[off]! << 8) | d[off + 1]!
  }

  /** InTrackPlay2 (+Music.s:4277); the pattern argument is unsupported there too */
  trackPlay(bankArg: number | null): void {
    let n = bankArg ?? this.trackBank
    // Bnk.OrAdr: an address inside the bank region names its bank
    if (n >= 0x01000000) n = Math.floor((n - 0x01000000) / 0x00100000)
    const bank = this.host.getBank(n)
    // Bnk.OrAdr (+Lib.s:8053) comes FIRST and raises its own error: `cmp.l
    // #1024,d0 / bge .Skip / Rbsr L_Bnk.GetAdr / Rbeq L_BkNoRes`. So a bank
    // that was never reserved is "bank not reserved", and only a bank that
    // EXISTS and is misnamed reaches the two compares below. Ant Wars 1.1
    // parks its module in bank 7 and calls a bare `Track Play`, which is bank
    // 6 -- the game's own bug, and this is the error the machine gives it.
    if (!bank) throw new AmosError('bank not reserved')
    // `cmp.l #"Trac",-8(a2)` then `cmp.l #"ker ",-4(a2)`: the whole 8-byte
    // bank name, trailing space and all, not a prefix
    if (bank.name.padEnd(8).slice(0, 8) !== 'Tracker ') throw new AmosError('not a tracker module')
    // InSamStop0 + InTrackStop before the init
    for (let v = 0; v < 4; v++) this.host.audio.stop(v)
    this.trackStop()
    this.mtBankNum = n // Track_Bank itself is only set by Track Load
    const d = bank.data
    this.mtData = d
    // mt_samplestarts: walk the 31 sample records (finetune is ignored —
    // the 68k clears the finetune bytes in the bank)
    let maxPat = 0
    for (let i = 0; i < 128; i++) maxPat = Math.max(maxPat, d[0x3b8 + i] ?? 0)
    let p = 0x43c + (maxPat + 1) * 1024
    this.mtStarts = new Array<number>(32).fill(0)
    for (let i = 1; i <= 31; i++) {
      this.mtStarts[i] = p
      p += this.mw(12 + i * 30) * 2
    }
    this.mtSpeed = 6
    this.mtCounter = 0
    this.mtSongpos = 0
    this.mtPattpos = 0
    this.mtBreak = false
    this.trackStopFlag = false
    for (const V of this.mtVoices) {
      V.note = V.cmd = V.start = V.length = V.loopStart = V.repLen = 0
      V.period = V.volume = V.portSpeed = V.portTarget = V.vibCmd = V.vibPos = 0
      V.portDir = false
    }
    this.mtOn = true
  }

  /**
   * What EME 3.0's four reporting keywords answer with.
   *
   * All four are gated on the module PLAYING, not on one being loaded: EME
   * caches the position, the length and a status byte in its own workspace at
   * $bd0/$be7/$be6, and `Track Stop` (its routine 90) clears all three. So a
   * stopped song reports 0 from every one of them, which is also what
   * `=Trstat` is documented to mean.
   */
  get trackPos(): number {
    return this.mtOn ? this.mtSongpos : 0
  }

  /** the song length byte at $3b6 of a 31-sample module */
  get trackLen(): number {
    return this.mtOn && this.mtData ? (this.mtData[0x3b6] ?? 0) : 0
  }

  /**
   * The pattern played at song position `pos` — the 128-byte order table at
   * $3b8. NOTE: `adda.w d0,a0` range-checks NOTHING and sign-extends, so on
   * the machine a position past 127 reads into the pattern data and a negative
   * one reads backwards into the sample headers. Out of range answers 0 here.
   */
  trackPattern(pos: number): number {
    if (!this.mtOn || !this.mtData) return 0
    const at = 0x3b8 + ((pos << 16) >> 16)
    return at >= 0 && at < this.mtData.length ? (this.mtData[at] ?? 0) : 0
  }

  /** EME's `Track Tempo`: the speed at $bce, and $bcf — the tick — reset with it */
  setTrackSpeed(n: number): void {
    this.mtSpeed = n & 0xff
    this.mtCounter = 0
  }

  /** mt_speed itself, which is also EME's $bce — the module's own Fxx writes it too */
  get trackSpeed(): number {
    return this.mtSpeed
  }

  /** InTrackStop (+Music.s:4229) */
  trackStop(): void {
    if (!this.mtOn) return
    this.mtOn = false
    this.trackStopFlag = false
    // EME's routine 90 clears its own workspace here, `clr.b $be9` included.
    // `Track Play` reaches this through an `Rbsr` to it, so a Play that
    // replaces a RUNNING module wipes the pattern-loop mode — and one from a
    // stopped state does not, because the guard above is the routine's own
    // `tst.b $be6(a0) / beq` and sits before the clears
    this.pattLoop = 0
    for (let v = 0; v < 4; v++) {
      this.host.audio.stop(v)
      this.lastVol[v] = -1
      this.lastFreq[v] = 0
    }
  }

  private trackerVbl(): void {
    if (!this.mtOn) return
    // TrackCheck (+Music.s:4211): the bank vanished or was replaced
    const bank = this.host.getBank(this.mtBankNum)
    if (!bank || bank.data !== this.mtData || !bank.name.startsWith('Trac')) {
      this.trackStop()
      return
    }
    // "Poke les deuxiemes parties des samples" — the deferred repeat
    // pointers go in before mt_music runs (+Music.s:1678-1688)
    this.latchPendingLoops()
    this.mtMusic()
    if (this.trackStopFlag) this.trackStop() // Tracker exit (+Music.s:1694)
  }

  /** mt_music (+Music.s:1709) */
  private mtMusic(): void {
    const d = this.mtData!
    this.mtCounter++
    if (this.mtCounter < this.mtSpeed) {
      // mt_nonew: per-tick effects
      for (let v = 0; v < 4; v++) this.mtCom(v)
      if (this.mtBreak) this.mtNext()
      return
    }
    this.mtCounter = 0
    const pat = d[0x3b8 + this.mtSongpos] ?? 0
    const rowOff = 0x43c + pat * 1024 + this.mtPattpos
    for (let v = 0; v < 4; v++) this.mtPlayVoice(v, rowOff + v * 4)
    this.mtPattpos += 16
    if (this.mtPattpos === 0x400 || this.mtBreak) this.mtNext()
  }

  /** mt_next (+Music.s:1760): advance the song position */
  private mtNext(): void {
    const d = this.mtData!
    this.mtPattpos = 0
    this.mtBreak = false
    // EME's two tests sit exactly here, between clearing mt_pattpos and the
    // `addq.b #1,mt_songpos` — see `eme.ts` for the disassembly. Mode 1 skips
    // the increment, so the same pattern comes round again; mode 2 branches
    // straight into the stop, so the song ends where the pattern does.
    if (this.pattLoop === 2) {
      this.trackStopFlag = true
      return
    }
    if (this.pattLoop === 1) return
    this.mtSongpos = (this.mtSongpos + 1) & 0x7f
    if (this.mtSongpos === (d[0x3b6] ?? 0)) {
      if (!this.trackLoop) this.trackStopFlag = true // Track_Stop
      this.mtSongpos = d[0x3b7] ?? 0 // restart byte
    }
  }

  /** mt_playvoice (+Music.s:1800): one row entry for one voice */
  private mtPlayVoice(v: number, rowOff: number): void {
    const d = this.mtData!
    const V = this.mtVoices[v]!
    const b0 = d[rowOff] ?? 0
    const b2 = d[rowOff + 2] ?? 0
    V.note = (b0 << 8) | (d[rowOff + 1] ?? 0)
    V.cmd = (b2 << 8) | (d[rowOff + 3] ?? 0)
    const inst = (b0 & 0xf0) | (b2 >> 4)
    if (inst !== 0) {
      const rec = 12 + inst * 30
      V.start = this.mtStarts[inst] ?? 0
      V.length = this.mw(rec)
      V.volume = this.mw(rec + 2) & 0xff
      const rep = this.mw(rec + 4)
      const repLen = this.mw(rec + 6)
      if (rep !== 0) {
        // looping sample: first pass covers start..(repeat+replen)
        V.loopStart = V.start + rep * 2
        V.length = rep + repLen
      } else {
        V.loopStart = V.start
      }
      V.repLen = repLen
      this.sinkVol(v, V.volume)
      this.host.vuBytes[v] = V.volume & 0xff // MuVu write (+Music.s:1838)
    }
    const per = V.note & 0xfff
    if (per !== 0) {
      if (V.length === 0) {
        this.host.audio.stop(v) // mt_stopsound
      } else {
        const fx = (V.cmd >> 8) & 0x0f
        if (fx === 3 || fx === 5) {
          // mt_setport: the note is a portamento target, no retrigger;
          // an equal target clears it AND skips the row command (rts)
          V.portTarget = per
          V.portDir = false
          if (per === V.period) {
            V.portTarget = 0
            return
          }
          if (per < V.period) V.portDir = true
        } else {
          V.period = per
          V.vibPos = 0
          this.mtTrigger(v)
        }
      }
    }
    this.mtCom2(v)
  }

  /** the retrigger: AUDxLC/LEN/PER + DMA + next-vbl loop latch, collapsed */
  private mtTrigger(v: number): void {
    const d = this.mtData!
    const V = this.mtVoices[v]!
    const first = V.length * 2
    const loopBytes = V.repLen * 2
    const end = Math.min(d.length, Math.max(V.start + first, V.loopStart + loopBytes))
    if (V.start >= end || V.start < 0) return
    const pcm = new Int8Array(d.buffer, d.byteOffset + V.start, end - V.start)
    let loopStart = -1
    let loopEnd = pcm.length
    if (loopBytes >= 2 && V.loopStart >= V.start) {
      // Paula always relatches the repeat region — a conventional 1-word
      // repeat loops two (usually silent) bytes, exactly as on the Amiga
      loopStart = V.loopStart - V.start
      loopEnd = Math.min(pcm.length, loopStart + loopBytes)
    }
    // as in the bank player: the trigger enables DMA over the whole sample
    // and the repeat pointers are poked at the top of the NEXT interrupt
    // (Tracker +Music.s:1678-1688), so the first pass always plays in full
    this.play(v, pcm, periodToHz(V.period), V.volume, -1, pcm.length)
    this.pendingLoop[v] = loopStart >= 0 ? { start: loopStart, end: loopEnd } : null
  }

  /** mt_com2 (+Music.s:2047): row commands */
  private mtCom2(v: number): void {
    const V = this.mtVoices[v]!
    const fx = (V.cmd >> 8) & 0x0f
    const arg = V.cmd & 0xff
    switch (fx) {
      case 0xe:
        // Exy: bit set = filter OFF (mt_filter pokes $BFE001 bit 1)
        this.host.audio.setFilter(!(arg & 1))
        break
      case 0xd:
        this.mtBreak = true
        break
      case 0xb:
        this.mtBreak = true
        this.mtSongpos = (arg - 1) & 0xff
        break
      case 0xc: {
        V.volume = Math.min(arg, 0x40)
        this.sinkVol(v, V.volume)
        break
      }
      case 0xf: {
        let s = Math.min(arg, 0x1f)
        if (s === 0) s = 1
        this.mtSpeed = s
        break
      }
    }
  }

  /** mt_com (+Music.s:1974): per-tick effects */
  private mtCom(v: number): void {
    const V = this.mtVoices[v]!
    if ((V.cmd & 0xfff) === 0) {
      this.sinkFreq(v, V.period) // mt_normper
      return
    }
    const fx = (V.cmd >> 8) & 0x0f
    const arg = V.cmd & 0xff
    switch (fx) {
      case 0x0:
        this.mtArp(v)
        break
      case 0x6:
        this.mtVib2(v)
        this.mtVolslide(v)
        break
      case 0x4:
        if (arg !== 0) V.vibCmd = arg // mt_vib
        this.mtVib2(v)
        break
      case 0x5:
        this.mtPort2(v)
        this.mtVolslide(v)
        break
      case 0x3:
        // mt_port: a fresh speed is stored and the arg byte cleared
        if (arg !== 0) {
          V.portSpeed = arg
          V.cmd &= 0xff00
        }
        this.mtPort2(v)
        break
      case 0x1: {
        // mt_portup: clamp at period $71
        V.period = Math.max(0x71, V.period - arg)
        this.sinkFreq(v, V.period)
        break
      }
      case 0x2: {
        // mt_portdown: clamp at period $358
        V.period = Math.min(0x358, V.period + arg)
        this.sinkFreq(v, V.period)
        break
      }
      default:
        this.sinkFreq(v, V.period)
        if (fx === 0xa) this.mtVolslide(v)
    }
  }

  /** mt_port2 (+Music.s:1891): slide toward the stored target */
  private mtPort2(v: number): void {
    const V = this.mtVoices[v]!
    if (V.portTarget === 0) return
    if (!V.portDir) {
      V.period += V.portSpeed
      if (V.portTarget <= V.period) {
        V.period = V.portTarget
        V.portTarget = 0
      }
    } else {
      V.period -= V.portSpeed
      if (V.portTarget >= V.period) {
        V.period = V.portTarget
        V.portTarget = 0
      }
    }
    this.sinkFreq(v, V.period)
  }

  /** mt_vib2 (+Music.s:1924): sine vibrato, depth>>7 (half the bank player's) */
  private mtVib2(v: number): void {
    const V = this.mtVoices[v]!
    const idx = (V.vibPos >> 2) & 0x1f
    const delta = (SINUS[idx]! * (V.vibCmd & 0x0f)) >> 7
    const per = V.vibPos & 0x80 ? V.period - delta : V.period + delta
    this.sinkFreq(v, per)
    V.vibPos = (V.vibPos + ((V.vibCmd >> 2) & 0x3c)) & 0xff
  }

  /** mt_arp (+Music.s:1950): counter-indexed 0,1,2 cycle over the period table */
  private mtArp(v: number): void {
    const V = this.mtVoices[v]!
    const sel = this.mtCounter % 3 // mt_arplist is 0,1,2 repeating
    if (sel === 0) {
      this.sinkFreq(v, V.period)
      return
    }
    const nib = sel === 2 ? V.cmd & 0x0f : (V.cmd >> 4) & 0x0f
    let i = 0
    while (i < 36 && PERIODS[i]! > V.period) i++
    const per = PERIODS[i + nib]
    if (per !== undefined && per > 0) this.sinkFreq(v, per)
  }

  /** mt_volslide (+Music.s:2027) */
  private mtVolslide(v: number): void {
    const V = this.mtVoices[v]!
    const up = (V.cmd >> 4) & 0x0f
    if (up !== 0) V.volume = Math.min(0x40, V.volume + up)
    else V.volume = Math.max(0, V.volume - (V.cmd & 0x0f))
    this.sinkVol(v, V.volume)
  }
}
