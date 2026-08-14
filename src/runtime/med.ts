/**
 * The MED/OctaMED player behind Med Load/Play/Stop/Cont.
 *
 * The AMOS side (+Music.s:4456-4745) is thin plumbing over the external
 * medplayer.library (_MEDPlayModule and friends), which is not part of
 * the AMOS source but IS in the corpus, in sixteen places and three
 * builds. docs/medplayer/README.md is the read; src/cli/libdis.ts gets
 * from an LVO in +Music.s:2281-2293 to the code behind it, and the
 * addresses in this file are that build loaded at $210000.
 *
 * The keyword semantics come from +Music.s: bank handling, the MMD0/MMD1
 * magic check with bank erase on failure (error 189), Med Play stopping
 * samples/tracker/med first, Med Cont resuming only when stopped,
 * MedCheck killing the music when the bank vanishes.
 *
 * The replay is the library's. Both dispatch tables are ported entry by
 * entry: the row-tick table at $2109fe, 32 wide because MMD1 stores five
 * bits of command, and the per-tick table at $210daa. The pieces that are
 * NOT here, each because the machinery is missing rather than the reading:
 *
 * - MIDI. $210d4c sends a track marked MIDI to a second set of handlers,
 *   and $210d54 sends every track from index 4 up there as well, so this
 *   library sounds four Paula voices whatever the block holds. That part
 *   is faithful. The MIDI handlers themselves have nowhere to send a
 *   message, so `Med Midi On` still stores its flag and stops.
 * - Synthsounds and hybrids, the negative-type instruments, are silent.
 *   $211072 and $21107e call the synth step when $26(a5) is set; #124 is
 *   the two bytecode interpreters behind it.
 * - The audio filter, F$f8 and F$f9, which is a bit of $bfe001.
 */

import { AmosError } from '../interp/values'
import { PT_PERIODS, PT_PERIODS_PER_ROW } from '../amiga/notes'
import { PAULA_CLOCK_PAL, periodToHz } from '../amiga/paula'
import type { AudioSink } from '../amiga/paula'

/**
 * The CIA timer periods for primary tempos 1 to 10, read out of the table at
 * $2111e0 of medplayer-1f2ca57f. `MEDSetTempo` ($2111a4) indexes it with
 * `cmp.w #$a,d0 / bhi` and sends 11 upward to a divide instead.
 *
 * The line the table follows is `tempo * 14500/6`, so each tempo is that many
 * times the rate of tempo 1, and nine of the ten entries sit within four
 * counts of it. The ninth is 21436 where the line says 21750. It is 314 low,
 * nothing derives it, and a replay written from the published MMD format gets
 * that one tempo wrong with no way to find out.
 */
const TEMPO_TIMER = [2417, 4833, 7250, 9666, 12083, 14500, 16916, 19332, 21436, 24163]

/** $c2(a6). $2116ce swaps in 474326 when `ExecBase+$212` is not 50, so this is PAL. */
const TEMPO_CLOCK = 470000
/** $53a(a6), the BPM numerator. 1789772 on NTSC, by the same swap. */
const BPM_CLOCK = 1773447

/**
 * The CIA clock, which is the one number this arithmetic needs and the
 * library never states.
 *
 * Its own NTSC switch is the proof that this is the right identification:
 * `Math.round(470000 * PAULA_CLOCK_NTSC / PAULA_CLOCK_PAL)` is 474326 and the
 * same scaling of 1773447 is 1789772, which are exactly the two constants
 * $2116ce writes. Both PAL constants are the NTSC ones divided by the Paula
 * clock ratio, so the divisor is the Paula clock over five and the resulting
 * tick rate is the same on either machine. `med.test.ts` asserts both.
 */
const CIA_CLOCK = PAULA_CLOCK_PAL / 5

/** one runtime frame; `vbl()` is called from the 50Hz step (runtime.ts) */
const VBL_HZ = 50

/**
 * Ticks a single frame may run, so a nonsense tempo cannot spin `vbl()`.
 * The real ceiling is 5.9, at tempo 1, and 15.4 in BPM mode at 240 beats
 * over 32 lines.
 */
const MAX_TICKS_PER_VBL = 32

/**
 * The CIA timer period `MEDSetTempo` writes: low byte through $11c(a6), high
 * byte through $120(a6), which is a 16-bit period however it was reached.
 *
 * `linesPerBeat` is read even outside BPM mode because the caller has it; the
 * non-BPM branches never look at it.
 */
export function medTimer(tempo: number, bpm: boolean, linesPerBeat: number): number {
  // $2111f4: `andi.w #$1f / addq.b #1 / mulu.w / divu.w`. The multiply cannot
  // reach 16 bits here, since tempo tops out at 240 and lines-per-beat at 32.
  if (bpm) return Math.floor(BPM_CLOCK / (tempo * linesPerBeat))
  if (tempo >= 1 && tempo <= 10) return TEMPO_TIMER[tempo - 1]!
  return Math.floor(TEMPO_CLOCK / tempo)
}

/**
 * How often the replay steps, in Hz.
 *
 * The tick is the CIA clock over the timer period, and in BPM mode over four
 * more. $2108a2 is where that four comes from: `$538(a6)` is set by `seq`
 * when `Med Play` reads `flags2` ($211638), so it holds $ff outside BPM mode
 * and `bmi` jumps the gate entirely. In BPM mode it holds 0, the gate counts
 * down and reloads with 4, and three interrupts in every four return having
 * done nothing. That four is what makes 125 beats over 4 lines come out at
 * 50.01 Hz rather than 200.
 */
export function medTickHz(tempo: number, bpm: boolean, linesPerBeat: number): number {
  // DEVIATION: tempo 0 runs `subq.b #1,d0` to $ff and reads 510 bytes past
  // the table ($2111be), and a tempo big enough to divide to 0 asks the CIA
  // for a period it has no encoding for. Neither is a rate, so both stop the
  // clock here rather than inventing one.
  const timer = medTimer(tempo, bpm, linesPerBeat)
  if (!Number.isFinite(timer) || timer <= 0) return 0
  return CIA_CLOCK / timer / (bpm ? 4 : 1)
}

/**
 * The vibrato and tremolo waveform, 32 SIGNED bytes at $21087a.
 *
 * This was ProTracker's `PT_SINE` on the reasoning that a four-channel MMD
 * replay would use the shared one, since medplayer.library was thought
 * unreadable. It is readable and it disagrees: a full symmetric sine peaking
 * at +/-127, where ProTracker's is an unsigned quarter-wave peaking at 255.
 * The same 32 bytes are in all three medplayer builds and in octaplayer and
 * octamixplayer, so one table serves the family.
 */
export const MED_SINUS: readonly number[] = [
  0, 25, 49, 71, 90, 106, 117, 125, 127, 125, 117, 106, 90, 71, 49, 25,
  0, -25, -49, -71, -90, -106, -117, -125, -127, -125, -117, -106, -90, -71, -49, -25,
]

/**
 * The period a note plays at, and it is a five-octave table rather than
 * ProTracker's three.
 *
 * The library keeps sixteen of them at $212088, 192 bytes apart, and picks
 * one with the track's finetune ($21035c). Row 0 is ProTracker's row 0 with
 * its first octave multiplied by four and its second by two, which this
 * derives and `med.test.ts` checks against the binary to the word.
 *
 * DEVIATION: rows 1 to 15 are NOT ProTracker's finetuned rows. MED computed
 * its own and they part company by up to 13 counts, 0.45%, or about eight
 * cents at the extreme. Carrying the library's 1,536 words would mean copying
 * its data, so the finetuned rows come from `PT_PERIODS` and the error above
 * is what a program can hear. Finetune 0, which is every note in every module
 * that never sets one, is exact.
 */
export function medPeriod(note: number, finetune: number): number {
  // $21033a wraps by whole octaves until the note is 0..62, then $210370
  // indexes with no adjustment at all.
  let n = note
  while (n < 0) n += 12
  if (n > 62) n -= 12
  const row = (finetune & 0xf) * PT_PERIODS_PER_ROW + 1
  // 60 real entries and then 36 more, which are the top octave three times
  // over, so the three notes the wrap still allows fold back an octave
  if (n >= 60) n = 48 + ((n - 60) % 12)
  if (n < 12) return PT_PERIODS[row + n]! * 4
  if (n < 24) return PT_PERIODS[row + n - 12]! * 2
  return PT_PERIODS[row + n - 24]!
}

/**
 * One track, named by its offset in the library's own per-track block so the
 * handlers below can be read against the disassembly.
 */
interface MedVoice {
  note: number // (a5)
  instr: number // $1
  /** $2, already scaled by the track and master volumes */
  vol: number
  cmd: number // $4
  data: number // $5
  /** $7, the hold counter; negative means hold forever */
  hold: number
  holdSet: number // $8
  decaySet: number // $9
  strans: number // $a
  finetune: number // $b
  period: number // $14
  /** $c, an 8.8 offset the `$19` command adds under the period */
  periodFine: number
  vibShift: number // $22
  vibSpeed: number // $23
  vibDepth: number // $24
  portTarget: number // $20
  portSpeed: number // $52
  /** $54, and $55 is the copy that counts the note down */
  decay: number
  decayRun: number
  vibPos: number // $5c
  tremPos: number // $5d
  tremDepth: number // $5e
  tremSpeed: number // $60
  /** $61, the tremolo's volume for one tick; negative means none pending */
  tremVol: number
  /** the last period and volume handed to the sink, so a tick that changes
   *  nothing writes nothing */
  outPeriod: number
  outVol: number
}

const newVoice = (): MedVoice => ({
  note: 0, instr: 0, vol: 0, cmd: 0, data: 0,
  hold: -1, holdSet: 0, decaySet: 0, strans: 0, finetune: 0,
  period: 0, periodFine: 0, vibShift: 5, vibSpeed: 0, vibDepth: 0,
  portTarget: 0, portSpeed: 0, decay: 0, decayRun: 0,
  vibPos: 0, tremPos: 0, tremDepth: 0, tremSpeed: 0, tremVol: -1,
  outPeriod: -1, outVol: -1,
})

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
  /** flags2 low five bits plus one ($2111f8); only BPM mode reads it */
  private lpb = 4
  private tempo2 = 6 // ticks per line
  private transp = 0 // playtransp
  private mastervol = 64
  private seqPos = 0
  private line = 0
  private tickCount = 0
  private acc = 0
  /**
   * $52a: 0 for none, 1 for a break that advances the position, and -1 when
   * `Bxx` has already written the position ($210c5c tests the sign).
   * $52b keeps the line number across the break.
   */
  private breakKind = 0
  private keepLine = false
  /** $530, one past the line to resume at, so 0 means "no target" */
  private lineJump = 0
  private loopLine = 0 // $532
  private loopCount = 0 // $534
  private lineDelay = 0 // $536
  private flags = 0 // song flags at $2ff
  private voices: MedVoice[] = [0, 1, 2, 3].map(newVoice)

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
    // DEVIATION: deftempo 0 is the off-the-table read medTickHz describes, so
    // it is replaced here with a tempo that ticks at about a PAL frame.
    this.tempo = this.w(s + 0x2fc) || 33
    this.transp = (this.b(s + 0x2fe) << 24) >> 24
    const flags2 = this.b(s + 0x300)
    this.bpm = (flags2 & 0x20) !== 0 // FLAG2_BPM, $2111b0 `btst #5,$300(a0)`
    this.lpb = (flags2 & 0x1f) + 1
    this.tempo2 = this.b(s + 0x301) || 6
    this.mastervol = this.b(s + 0x312) || 64
    this.flags = this.b(s + 0x2ff)
    this.seqPos = 0
    this.line = 0
    this.tickCount = 0
    this.acc = 0
    this.breakKind = 0
    this.keepLine = false
    this.lineJump = this.loopLine = this.loopCount = this.lineDelay = 0
    this.voices = [0, 1, 2, 3].map(newVoice)
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
    // The CIA fires between frames, so the fraction is carried rather than
    // rounded: tempo 33 is 49.81 Hz, not 50, and the two part company after
    // four minutes of a module that never changes tempo.
    this.acc = Math.min(this.acc + medTickHz(this.tempo, this.bpm, this.lpb) / VBL_HZ, MAX_TICKS_PER_VBL)
    while (this.acc >= 1) {
      this.acc -= 1
      this.tick()
    }
  }

  /**
   * One CIA interrupt, which is $2108a2 with the BPM gate already spent.
   *
   * `$2108d8` counts to the secondary tempo, and on the tick that wraps it
   * plays the row. The per-track effect pass runs on EVERY tick including
   * that one: the row path falls into it at $210d30 with the counter freshly
   * cleared, which is the only way the handlers' `tst.b d3` tick-0 branches
   * are ever reached.
   */
  private tick(): void {
    let hold = false
    if (this.tickCount === 0) {
      // $2108f0: a pending line delay holds the row without replaying it
      if (this.lineDelay !== 0) {
        this.lineDelay--
        hold = this.lineDelay !== 0
      }
      if (!hold) this.playLine()
    }
    for (let v = 0; v < 4; v++) this.tickEffect(v)
    if (++this.tickCount >= this.tempo2) {
      this.tickCount = 0
      if (!hold) this.advanceLine()
    }
  }

  /**
   * $210c28, which decides the next line and, when the block runs out, the
   * next position.
   *
   * `lineJump` is one past the target, so zero means nothing set it. The
   * position advances by one unless `Bxx` already wrote it, which is what
   * `$52a` holding $ff rather than 1 distinguishes ($210c5c, `bmi`).
   */
  private advanceLine(): void {
    let target = this.lineJump !== 0 ? this.lineJump - 1 : this.line + 1
    this.lineJump = 0
    if (target <= this.blockLines(this.currentBlock()) && this.breakKind === 0) {
      this.line = target
      return
    }
    if (!this.keepLine) target = 0
    let pos = this.seqPos
    if (this.breakKind >= 0) pos++
    if (pos >= this.songlen) pos = 0
    this.seqPos = pos
    this.breakKind = 0
    this.keepLine = false
    this.line = target
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

  /**
   * The row: instrument, then the command through the row-tick table at
   * $2109fe, then the note.
   *
   * Only four tracks are read. `$210d54` sends track index 4 and up to the
   * MIDI handler whatever the block holds, so an eight-track MMD is four
   * Paula voices in this library and the rest is note data for a synthesiser
   * that is not here.
   */
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
      if (this.mmd1) {
        note = this.b(off) & 0x7f
        instr = this.b(off + 1) & 0x3f
        cmd = this.b(off + 2) & 0x1f // $210996
        this.voices[v]!.data = this.b(off + 3)
      } else {
        const b0 = this.b(off)
        const b1 = this.b(off + 1)
        note = b0 & 0x3f
        instr = ((b0 & 0xc0) >> 2) | (b1 >> 4)
        cmd = b1 & 0x0f
        this.voices[v]!.data = this.b(off + 2)
      }
      const V = this.voices[v]!
      if (instr !== 0) this.setInstrument(v, instr)
      V.cmd = cmd
      if (cmd !== 0 && this.rowEffect(v, note)) continue
      if (note !== 0) {
        V.note = note
        this.trigger(v, note)
      }
    }
  }

  /**
   * $2109a8: an instrument number loads the whole per-track note context
   * before the command runs, which is why `C40` on a row with an instrument
   * is that instrument's volume scaled and not the last one's.
   *
   * The three defaults at $53e(a6), $57d(a6) and $5bc(a6) are hold, decay and
   * finetune per instrument. Nothing in AMOS writes them, so they are zero
   * here and only the `8` and `$15` commands move them.
   */
  private setInstrument(v: number, instr: number): void {
    const V = this.voices[v]!
    const rec = this.song + (instr - 1) * 8
    V.instr = instr
    V.holdSet = 0
    V.decaySet = 0
    V.finetune = 0
    V.vol = (this.b(rec + 6) * this.trackScale(v)) >> 8
    V.strans = (this.b(rec + 7) << 24) >> 24
  }

  /** $211484: (trackvol * mastervol) >> 4, so 64 against 64 is 256, unity */
  private trackScale(v: number): number {
    return (this.b(this.song + 0x302 + v) * this.mastervol) >> 4
  }

  /**
   * The period for a note as the row and the effects compute it: the note
   * number less one, plus the song's `playtransp` and the instrument's own
   * `strans` ($210bda, $210e78).
   */
  private notePeriod(v: number, note: number): number {
    return medPeriod(note - 1 + this.transp + this.voices[v]!.strans, this.voices[v]!.finetune)
  }

  /**
   * The row-tick half of a command. Returns true when the note must NOT
   * retrigger, which is the `bra $210c1c` exit that `3`, `F$f2` and `F$fd`
   * take.
   */
  private rowEffect(v: number, note: number): boolean {
    const V = this.voices[v]!
    const d = V.data
    switch (V.cmd) {
      case 0x3: // $210bd0: portamento target, and the note never restarts
        if (note !== 0) {
          const idx = note - 1 + this.transp + V.strans
          if (idx >= 0) V.portTarget = medPeriod(idx, V.finetune)
        }
        if (d !== 0) V.portSpeed = d
        return true
      case 0x8: // $210b98: high nibble decay, low nibble hold
        V.decaySet = d >> 4
        V.holdSet = d & 0xf
        return false
      case 0x9: // $210b2a: five bits, and zero means 32
        this.tempo2 = (d & 0x1f) || 32
        return false
      case 0xb: // $210bb2: position jump, which sets the position itself
        if (d <= this.songlen) {
          this.seqPos = d
          this.breakKind = -1
        }
        return false
      case 0xc:
        this.setVolume(v, d)
        return false
      case 0xe: // $210ad4: MIDI preset for this track, tracks 0..3 only
        return false
      case 0xf:
        return this.commandF(v, note)
      case 0x15: // $210b3a: finetune, signed, and outside -8..+7 it is ignored
        if (d <= 7 || d >= 0xf8) V.finetune = d & 0xf
        return false
      case 0x16: // $210b52: block loop
        if (d === 0) {
          this.loopLine = this.line
        } else if (this.loopCount !== 0) {
          if (--this.loopCount !== 0) this.lineJump = this.loopLine + 1
        } else {
          this.loopCount = d
          this.lineJump = this.loopLine + 1
        }
        return false
      case 0x19: // $210baa: the fine period offset a slide adds to
        V.periodFine = (d << 8) & 0xffff
        return false
      case 0x1c: // $210b82: MIDI preset in the instrument record
        return false
      case 0x1d: // $210bc2: break to line d of the next position
        this.breakKind = 1
        this.keepLine = true
        this.lineJump = d + 1
        return false
      default:
        return false
    }
  }

  /**
   * `C` ($210ae4). The data is DECIMAL unless the song's flags say hex, so
   * `C40` is 40 and not 64 in most modules, and bit 7 aims the same value at
   * the instrument's stored volume instead of the track's.
   *
   * DEFECT: the bit 7 path writes the instrument record and then falls into
   * the track-volume store at $210b1c anyway, so `C$c0` sets both.
   */
  private setVolume(v: number, data: number): void {
    let n = data
    if ((data & 0x80) !== 0) {
      n = data & 0x7f
      if (n > 64) return
      const rec = this.song + (this.voices[v]!.instr - 1) * 8 + 6
      if (this.data && rec >= 0 && rec < this.data.length) this.data[rec] = n
    } else {
      if ((this.flags & 0x10) === 0) n = (n >> 4) * 10 + (n & 0xf)
      if (n > 64) return
    }
    this.voices[v]!.vol = (n * this.trackScale(v)) >> 8
  }

  /**
   * `F` ($210a3e). One to $f0 is the primary tempo and everything above it is
   * a separate command.
   */
  private commandF(v: number, note: number): boolean {
    const V = this.voices[v]!
    const d = V.data
    if (d === 0) {
      this.breakKind = 1 // $210aca
      return false
    }
    if (d <= 0xf0) {
      this.tempo = d // $210a4e, then straight into MEDSetTempo
      return false
    }
    switch (d) {
      case 0xf2: // $210a5a: note delay, the note is held rather than played
        if (note !== 0) V.note = note
        V.hold = V.holdSet !== 0 ? V.holdSet : -1
        return true
      case 0xfd: // $210a92: retune without restarting the sample
        if (note !== 0) V.period = this.notePeriod(v, note)
        return true
      case 0xfe: // $210a76: stop the whole player
        this.stop()
        return true
      case 0xf8: // $211190/$21119a: the audio filter, which has no sound here
      case 0xf9:
        return false
      default:
        return false
    }
  }

  /**
   * A note starts: $210298 through $2104ca. The hold counter is loaded from
   * $8(a5) and a zero there means $ff, hold forever ($210c0c).
   */
  private trigger(v: number, note: number): void {
    const V = this.voices[v]!
    const instr = V.instr
    if (instr === 0 || instr > 63) return
    const ptr = this.l(this.smplarr + (instr - 1) * 4)
    if (!ptr) return
    const length = this.l(ptr)
    const type = (this.w(ptr + 4) << 16) >> 16
    if (type < 0 || length === 0) return // synthsound/hybrid: silent, see #124
    const d = this.data!
    const start = ptr + 6
    const end = Math.min(d.length, start + length)
    if (start >= end) return
    const pcm = new Int8Array(d.buffer, d.byteOffset + start, end - start)
    const rec = this.song + (instr - 1) * 8
    const rep = this.w(rec) * 2
    const replen = this.w(rec + 2) * 2
    V.period = this.notePeriod(v, note)
    V.periodFine = 0
    V.vibPos = 0 // $210324
    V.decayRun = 0 // $21031a
    V.decay = V.decaySet // $21031e
    V.hold = V.holdSet !== 0 ? V.holdSet : -1
    let loopStart = -1
    let loopEnd = pcm.length
    if (replen > 2 && rep + replen <= pcm.length) {
      loopStart = rep
      loopEnd = rep + replen
    }
    V.outPeriod = V.period
    V.outVol = V.vol
    this.host.audio.play(v, pcm, periodToHz(V.period), V.vol, loopStart, loopEnd)
  }

  /**
   * The per-track tick pass: the hold and decay counters at $210d5c, then the
   * command through the tick table at $210daa, then the period and volume
   * write at $21108e.
   */
  private tickEffect(v: number): void {
    const V = this.voices[v]!
    // $210d5c: the hold runs out, the decay starts, and with no decay the
    // voice's DMA is simply switched off
    if (V.hold >= 0 && --V.hold < 0) {
      V.decayRun = V.decay
      if (V.decayRun === 0) {
        this.host.audio.stop(v)
        V.outPeriod = V.outVol = -1
        V.period = 0
      }
    }
    if (V.decayRun !== 0) {
      V.vol -= V.decayRun
      if (V.vol < 0) {
        V.vol = 0
        V.decayRun = 0
      }
    }
    if (V.period <= 0) return
    const period = this.tickCommand(v)
    this.writeVoice(v, period)
  }

  /**
   * The tick table at $210daa, which is 32 entries wide because MMD1 stores
   * five bits of command. It returns the period to sound: the handlers that
   * reach $21107e compute a temporary one, and the rest fall through to
   * $21108a and the stored period.
   */
  private tickCommand(v: number): number {
    const V = this.voices[v]!
    const d = V.data
    const t = this.tickCount
    switch (V.cmd) {
      case 0x0: {
        // $210e52: remainder 0 is the LOW nibble, 1 the high, 2 the base note,
        // where ProTracker runs base, high, low
        if (d === 0) break
        const r = t % 3
        const half = r === 0 ? d & 0xf : r === 1 ? d >> 4 : 0
        const idx = V.note - 1 + half + this.transp + V.strans
        if (idx < 0) break
        return medPeriod(idx, V.finetune)
      }
      case 0x1: // $210dea, clamped at 113 and nowhere else
        if (t === 0 && this.stSlide()) break
        V.period = Math.max(0x71, V.period - d)
        break
      case 0x2: // $210e26, and there is no upper clamp at all
        if (t === 0 && this.stSlide()) break
        V.period += d
        break
      case 0x11: // $210e14: the fine slides move once, on the row tick
        if (t === 0) V.period -= d
        break
      case 0x12:
        if (t === 0) V.period += d
        break
      case 0x13: // $211014: slides for the first three ticks only
        if (t < 3) return V.period - d
        break
      case 0x3: // $210fd4
        if (t === 0 && this.stSlide()) break
        this.portamento(v)
        break
      case 0x5: // $210fc2: portamento and volume slide together
        if (t === 0 && this.stSlide()) break
        this.volumeSlide(v)
        this.portamento(v)
        break
      case 0x4: // $210e98, depth shifted by five
        V.vibShift = 5
        return this.vibrato(v, t !== 0)
      case 0x14: // $210e90, the same with six, so half the depth
        V.vibShift = 6
        return this.vibrato(v, t !== 0)
      case 0x6: // $210ef0: vibrato and volume slide, no parameter reload
        if (t === 0 && this.stSlide()) break
        this.volumeSlide(v)
        return this.vibrato(v, true)
      case 0x7:
        return this.tremolo(v)
      case 0xa:
      case 0xd: // $210f62: one handler for both
        if (t === 0 && this.stSlide()) break
        this.volumeSlide(v)
        break
      case 0x1a: // $210f9e: fine volume slide up, once
        if (t === 0) V.vol = Math.min(64, V.vol + d)
        break
      case 0x1b: // $210fb0
        if (t === 0) V.vol = Math.max(0, V.vol - d)
        break
      case 0x18: // $21103c: cut the note on tick d
        if (t === d) V.vol = 0
        break
      case 0x1e: // $21102e: hold the line, set once
        if (this.lineDelay === 0) this.lineDelay = d + 1
        break
      case 0x1f: {
        // $211046: high nibble delays the note, low nibble retriggers it
        const delay = d >> 4
        if (delay !== 0 && t < delay) break
        if (delay !== 0 && t === delay) this.trigger(v, V.note)
        const every = d & 0xf
        if (every !== 0 && t % every === 0) this.trigger(v, V.note)
        break
      }
      default:
        break
    }
    return V.period + (V.periodFine >> 8)
  }

  /** song flags bit 5: slides skip the row tick, the way ProTracker's do */
  private stSlide(): boolean {
    return (this.flags & 0x20) !== 0
  }

  /** $210fe2, shared by 3 and 5 */
  private portamento(v: number): void {
    const V = this.voices[v]!
    if (V.portTarget === 0) return
    if (V.period <= V.portTarget) {
      V.period += V.portSpeed
      if (V.period >= V.portTarget) {
        V.period = V.portTarget
        V.portTarget = 0
      }
    } else {
      V.period -= V.portSpeed
      if (V.period <= V.portTarget) {
        V.period = V.portTarget
        V.portTarget = 0
      }
    }
  }

  /**
   * $210f76, the worker behind A, D, 5 and 6. A zero high nibble slides DOWN
   * by the whole byte, which is the low nibble, and anything else slides up
   * by the high nibble. It works on the already-scaled volume.
   */
  private volumeSlide(v: number): void {
    const V = this.voices[v]!
    const up = V.data & 0xf0
    if (up === 0) V.vol = Math.max(0, V.vol - V.data)
    else V.vol = Math.min(64, V.vol + (up >> 4))
  }

  /** $210e9e and the body at $210ec0 */
  private vibrato(v: number, skipParams: boolean): number {
    const V = this.voices[v]!
    if (!skipParams && V.data !== 0) {
      const depth = V.data & 0xf
      if (depth !== 0) V.vibDepth = depth
      const speed = V.data & 0xf0
      if (speed !== 0) V.vibSpeed = (speed >> 3) & 0x3e
    }
    const delta = (MED_SINUS[(V.vibPos >> 2) & 0x1f]! * V.vibDepth) >> V.vibShift
    V.vibPos = (V.vibPos + V.vibSpeed) & 0xff
    return V.period + delta
  }

  /**
   * $210f02. The position steps by three bits rather than the vibrato's two,
   * so the same nibble is twice the speed, and the result is a volume for one
   * tick rather than a period.
   *
   * DEFECT: `$210f18` branches to $210ec0 when the speed nibble is zero, and
   * $210ec0 is the VIBRATO body. So `7x0` bends the pitch with the vibrato's
   * depth and speed instead of shaking the volume.
   */
  private tremolo(v: number): number {
    const V = this.voices[v]!
    if (this.tickCount === 0 && V.data !== 0) {
      const depth = V.data & 0xf
      if (depth !== 0) V.tremDepth = depth
      if ((V.data & 0xf0) === 0) return this.vibrato(v, true)
      V.tremSpeed = ((V.data & 0xf0) >> 2) & 0x3e
    }
    const delta = (MED_SINUS[(V.tremPos >> 3) & 0x1f]! * V.tremDepth) >> 7
    V.tremPos = (V.tremPos + V.tremSpeed) & 0xff
    V.tremVol = Math.max(0, Math.min(64, V.vol + delta))
    return V.period
  }

  /**
   * $21108e: period to AUDxPER, then volume to AUDxVOL unless the period came
   * out zero. The tremolo's volume at $61(a5) wins for exactly one tick and
   * is spent by the write.
   */
  private writeVoice(v: number, period: number): void {
    const V = this.voices[v]!
    if (period !== V.outPeriod) {
      V.outPeriod = period
      if (period > 0) this.host.audio.setFrequency(v, periodToHz(period))
    }
    if (period === 0) return
    const vol = V.tremVol >= 0 ? V.tremVol : V.vol
    V.tremVol = -1
    if (vol !== V.outVol) {
      V.outVol = vol
      this.host.audio.setVolume(v, vol)
    }
  }
}
