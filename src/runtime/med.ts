/**
 * The MED/OctaMED player behind Med Load/Play/Stop/Cont.
 *
 * The AMOS side (+Music.s:4456-4745) is thin plumbing over the external
 * medplayer.library (_MEDPlayModule and friends), which is NOT part of
 * the AMOS source. The keyword semantics here are ported faithfully —
 * bank handling, MMD0/MMD1 magic check with bank erase on failure
 * (error 189), Med Play stopping samples/tracker/med first, Med Cont
 * resuming only when stopped, MedCheck killing the music when the bank
 * vanishes — but the replay itself is a REIMPLEMENTATION from the
 * public MMD0/MMD1 module format:
 *
 * - playseq/blocks stepped at tempo2 ticks per line; the primary tempo
 *   is scaled as ticks-per-vbl (33 = one tick per PAL vbl; the BPM
 *   flag maps 125 BPM to one tick per vbl), approximating the
 *   library's CIA timer with vbl granularity
 * - sampled instruments only — synthsounds and hybrids (negative type)
 *   are silent; IFF multi-octave samples play their first octave
 * - the common effect subset: 0 arpeggio, 1/2 period slides,
 *   3 portamento, 4 vibrato, 9 secondary tempo, A/D volume slide,
 *   B position jump, C volume, F break / primary tempo / FE stop
 * - track volumes and master volume are applied; MIDI is not (Med Midi
 *   On stores its flag only)
 */

import { AmosError } from '../interp/values'
import { AMIGA_PERIODS, periodToHz } from '../amiga/paula'
import type { AudioSink } from '../amiga/paula'


const SINUS = [
  0, 24, 49, 74, 97, 120, 141, 161, 180, 197, 212, 224, 235, 244, 250, 253,
  255, 253, 250, 244, 235, 224, 212, 197, 180, 161, 141, 120, 97, 74, 49, 24,
]

interface MedVoice {
  period: number
  vol: number
  note: number
  instr: number
  cmd: number
  data: number
  portTarget: number
  portSpeed: number
  vibPos: number
  vibCmd: number
}

export interface MedHost {
  audio: AudioSink
  tick: () => number
  getBank: (n: number) => { name: string; data: Uint8Array } | null
}

export class MedPlayer {
  private host: MedHost
  /** Med_Bank (+Music.s:2274): default 7 */
  bank = 7
  /** Med_Midi flag — stored only, no MIDI output exists in the port */
  midi = false
  on = false
  /** Med_Adr: a module is loaded/positioned (Med Cont resumes it) */
  private data: Uint8Array | null = null
  private bankNum = 7
  private song = 0 // song section offset
  private blockarr = 0
  private smplarr = 0
  private numblocks = 0
  private songlen = 0
  private tempo = 33 // primary tempo (deftempo)
  private bpm = false
  private tempo2 = 6 // ticks per line
  private transp = 0 // playtransp
  private mastervol = 64
  private seqPos = 0
  private line = 0
  private tickCount = 0
  private acc = 0
  private breakFlag = false
  private voices: MedVoice[] = [0, 1, 2, 3].map(() => ({
    period: 0, vol: 0, note: 0, instr: 0, cmd: 0, data: 0,
    portTarget: 0, portSpeed: 0, vibPos: 0, vibCmd: 0,
  }))

  constructor(host: MedHost) {
    this.host = host
  }

  private w(off: number): number {
    const d = this.data
    if (!d || off < 0 || off + 2 > d.length) return 0
    return (d[off]! << 8) | d[off + 1]!
  }

  private l(off: number): number {
    const d = this.data
    if (!d || off < 0 || off + 4 > d.length) return 0
    return ((d[off]! << 24) | (d[off + 1]! << 16) | (d[off + 2]! << 8) | d[off + 3]!) >>> 0
  }

  private b(off: number): number {
    return this.data?.[off] ?? 0
  }

  get mmd1(): boolean {
    return this.data !== null && this.data[3] === 0x31
  }

  /**
   * The four live fields medplayer.library writes back into the MMD header
   * while a module plays — `pblock` ($2a), `pline` ($2c), `pseqnum` ($2e) and
   * `counter` ($32) — plus the static `extra_songs` ($33).
   *
   * They are here because MED 7.1's `Med Pblock`, `Med Pline`, `Med Seq Num`,
   * `Med Counter` and `Med Get Sub Songs` are literally `move.w $2a(a0),d0`
   * and friends over the loaded module: the extension does not ask the library
   * anything, it reads the struct the library maintains. This port's replayer
   * keeps that state in fields rather than in the module bytes, so it answers
   * for them here instead. See medext.ts.
   */
  get hdrPblock(): number {
    return this.data ? this.b(this.song + 508 + Math.min(this.seqPos, 255)) : 0
  }

  get hdrPline(): number {
    return this.line
  }

  get hdrPseqnum(): number {
    return this.seqPos
  }

  get hdrCounter(): number {
    return this.tickCount
  }

  /** `extra_songs` at $33 — static header data, not playback state */
  get extraSongs(): number {
    return this.b(0x33)
  }

  /**
   * The primary tempo, as MED 7.1's `Med Set Tempo` sets it.
   *
   * The AMOS core has no keyword for this — the Music extension's `Med Play`
   * takes whatever `deftempo` the module carries — so nothing needed a setter
   * until the third-party extension arrived with one.
   */
  setTempo(t: number): void {
    this.tempo = t
  }

  /** the bank verification half of InMedPlay2 (+Music.s:4628-4634) */
  checkBank(bankArg: number | null): number {
    let n = bankArg ?? this.bank
    if (n >= 0x01000000) n = Math.floor((n - 0x01000000) / 0x00100000)
    const bank = this.host.getBank(n)
    if (!bank || !bank.name.startsWith('Med')) throw new AmosError('not a med module')
    return n
  }

  /** InMedPlay2 (+Music.s:4614): module positioned and started */
  play(n: number, modnum: number): void {
    const bank = this.host.getBank(n)!
    this.stop()
    this.bankNum = n
    this.data = bank.data
    // MEDSetModnum: multi-module files chain through expdata->nextmod
    let base = 0
    for (let i = 0; i < modnum; i++) {
      const exp = this.l(base + 0x20)
      const next = exp ? this.l(exp) : 0
      if (!next) break
      base = next
    }
    this.song = this.l(base + 8)
    this.blockarr = this.l(base + 0x10)
    this.smplarr = this.l(base + 0x18)
    const s = this.song
    this.numblocks = this.w(s + 504)
    this.songlen = Math.max(1, this.w(s + 506))
    this.tempo = this.w(s + 0x2fc) || 33
    this.transp = (this.b(s + 0x2fe) << 24) >> 24
    this.bpm = (this.b(s + 0x300) & 0x20) !== 0 // flags2 FLAG2_BPM
    this.tempo2 = this.b(s + 0x301) || 6
    this.mastervol = this.b(s + 0x312) || 64
    this.seqPos = 0
    this.line = 0
    this.tickCount = 0
    this.acc = 0
    this.breakFlag = false
    for (const V of this.voices) {
      V.period = V.vol = V.note = V.instr = V.cmd = V.data = 0
      V.portTarget = V.vibPos = 0
    }
    this.on = true
  }

  /** InMedStop (+Music.s:4588) */
  stop(): void {
    if (!this.on) return
    this.on = false
    for (let v = 0; v < 4; v++) this.host.audio.stop(v)
  }

  /** InMedCont (+Music.s:4732): only when positioned and stopped */
  cont(): void {
    if (this.data && !this.on) this.on = true
  }

  /** MedClose (+Music.s:4711) */
  close(): void {
    this.stop()
    this.midi = false
    this.data = null
  }

  vbl(): void {
    if (!this.on) return
    // MedCheck (+Music.s:4567): the bank vanished or was replaced
    const bank = this.host.getBank(this.bankNum)
    if (!bank || bank.data !== this.data || !bank.name.startsWith('Med')) {
      this.stop()
      this.data = null
      return
    }
    // CIA timer approximated at vbl granularity
    this.acc += this.bpm ? this.tempo / 125 : this.tempo / 33
    while (this.acc >= 1) {
      this.acc -= 1
      this.tick()
    }
  }

  private tick(): void {
    if (this.tickCount === 0) {
      this.playLine()
    } else {
      for (let v = 0; v < 4; v++) this.tickEffects(v)
    }
    if (++this.tickCount >= this.tempo2) {
      this.tickCount = 0
      this.line++
      const lines = this.blockLines(this.currentBlock())
      if (this.line > lines || this.breakFlag) {
        this.line = 0
        this.breakFlag = false
        if (++this.seqPos >= this.songlen) this.seqPos = 0
      }
    }
  }

  private currentBlock(): number {
    const seq = this.b(this.song + 508 + Math.min(this.seqPos, 255))
    if (seq >= this.numblocks) return 0
    return this.l(this.blockarr + seq * 4)
  }

  private blockLines(blk: number): number {
    return this.mmd1 ? this.w(blk + 2) : this.b(blk + 1)
  }

  private blockTracks(blk: number): number {
    return this.mmd1 ? this.w(blk) : this.b(blk)
  }

  private playLine(): void {
    const blk = this.currentBlock()
    if (!blk) return
    const tracks = this.blockTracks(blk)
    const head = this.mmd1 ? 8 : 2
    const esize = this.mmd1 ? 4 : 3
    for (let v = 0; v < Math.min(4, tracks); v++) {
      const off = blk + head + (this.line * tracks + v) * esize
      let note: number
      let instr: number
      let cmd: number
      let data: number
      if (this.mmd1) {
        note = this.b(off) & 0x7f
        instr = this.b(off + 1) & 0x3f
        cmd = this.b(off + 2)
        data = this.b(off + 3)
      } else {
        const b0 = this.b(off)
        const b1 = this.b(off + 1)
        note = b0 & 0x3f
        instr = ((b0 & 0xc0) >> 2) | (b1 >> 4)
        cmd = b1 & 0x0f
        data = this.b(off + 2)
      }
      const V = this.voices[v]!
      V.cmd = cmd
      V.data = data
      if (instr !== 0) V.instr = instr
      if (note !== 0) {
        if (cmd === 3) {
          // portamento target
          const per = this.notePeriod(note, V.instr)
          if (per > 0) V.portTarget = per
          if (data !== 0) V.portSpeed = data
        } else {
          this.trigger(v, note)
        }
      }
      this.lineEffects(v)
    }
  }

  private notePeriod(note: number, instr: number): number {
    const strans = (this.b(this.song + (instr - 1) * 8 + 7) << 24) >> 24
    let idx = note - 1 + strans + this.transp
    if (idx < 0) idx = 0
    if (idx >= AMIGA_PERIODS.length) idx = AMIGA_PERIODS.length - 1
    return AMIGA_PERIODS[idx]!
  }

  private trigger(v: number, note: number): void {
    const V = this.voices[v]!
    const instr = V.instr
    if (instr === 0 || instr > 63) return
    const ptr = this.l(this.smplarr + (instr - 1) * 4)
    if (!ptr) return
    const length = this.l(ptr)
    const type = (this.w(ptr + 4) << 16) >> 16
    if (type < 0 || length === 0) return // synthsound/hybrid: silent
    const d = this.data!
    const start = ptr + 6
    const end = Math.min(d.length, start + length)
    if (start >= end) return
    const pcm = new Int8Array(d.buffer, d.byteOffset + start, end - start)
    const rec = this.song + (instr - 1) * 8
    const rep = this.w(rec) * 2
    const replen = this.w(rec + 2) * 2
    const svol = this.b(rec + 6)
    V.note = note
    V.period = this.notePeriod(note, instr)
    V.vol = Math.min(64, svol)
    V.vibPos = 0
    let loopStart = -1
    let loopEnd = pcm.length
    if (replen > 2 && rep + replen <= pcm.length) {
      loopStart = rep
      loopEnd = rep + replen
    }
    this.host.audio.play(v, pcm, periodToHz(V.period), this.scaledVol(v), loopStart, loopEnd)
  }

  private scaledVol(v: number): number {
    const trkvol = this.b(this.song + 0x302 + v) || 64
    return Math.min(64, (((this.voices[v]!.vol * trkvol) >> 6) * this.mastervol) >> 6)
  }

  /** effects applied on the row tick */
  private lineEffects(v: number): void {
    const V = this.voices[v]!
    switch (V.cmd) {
      case 0x9:
        if (V.data >= 1 && V.data <= 32) this.tempo2 = V.data
        break
      case 0xb:
        this.seqPos = Math.min(V.data, this.songlen - 1) - 1
        this.breakFlag = true
        break
      case 0xc: {
        V.vol = Math.min(64, V.data & 0x7f)
        this.host.audio.setVolume(v, this.scaledVol(v))
        break
      }
      case 0xf:
        if (V.data === 0) this.breakFlag = true
        else if (V.data === 0xfe) this.stop()
        else if (V.data < 0xf1) this.tempo = V.data
        break
    }
  }

  /** effects applied on non-row ticks */
  private tickEffects(v: number): void {
    const V = this.voices[v]!
    if (V.period <= 0) return
    switch (V.cmd) {
      case 0x0: {
        if (V.data === 0) break
        const sel = this.tickCount % 3
        const half = sel === 1 ? V.data >> 4 : sel === 2 ? V.data & 0xf : 0
        const idx = Math.max(0, Math.min(AMIGA_PERIODS.length - 1, V.note - 1 + half + this.transp))
        this.host.audio.setFrequency(v, periodToHz(AMIGA_PERIODS[idx]!))
        break
      }
      case 0x1:
        V.period = Math.max(113, V.period - V.data)
        this.host.audio.setFrequency(v, periodToHz(V.period))
        break
      case 0x2:
        V.period = Math.min(856, V.period + V.data)
        this.host.audio.setFrequency(v, periodToHz(V.period))
        break
      case 0x3: {
        if (!V.portTarget) break
        if (V.period < V.portTarget) {
          V.period = Math.min(V.portTarget, V.period + V.portSpeed)
        } else {
          V.period = Math.max(V.portTarget, V.period - V.portSpeed)
        }
        if (V.period === V.portTarget) V.portTarget = 0
        this.host.audio.setFrequency(v, periodToHz(V.period))
        break
      }
      case 0x4: {
        if (V.data !== 0) V.vibCmd = V.data
        const delta = (SINUS[(V.vibPos >> 2) & 0x1f]! * (V.vibCmd & 0xf)) >> 7
        this.host.audio.setFrequency(v, periodToHz(V.period + (V.vibPos & 0x80 ? -delta : delta)))
        V.vibPos = (V.vibPos + ((V.vibCmd >> 2) & 0x3c)) & 0xff
        break
      }
      case 0xa:
      case 0xd: {
        const up = V.data >> 4
        V.vol = up !== 0 ? Math.min(64, V.vol + up) : Math.max(0, V.vol - (V.data & 0xf))
        this.host.audio.setVolume(v, this.scaledVol(v))
        break
      }
    }
  }
}
