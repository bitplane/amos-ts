/**
 * TFMX's replay, off `DME_TFMX.library`.
 *
 * `tfmx.ts` is the container and the mdat; this is the machine that reads
 * them. It is the one format in DME that is not a tracker at all. Eight
 * tracks step through a table of pattern numbers, a pattern runs note and
 * control commands, and a note names a MACRO rather than a sample. The macro
 * is the instrument: it can loop, wait, sweep a period, swap the sample under
 * a playing voice, arpeggio, and start another macro.
 *
 * ## Evidence
 *
 * `DME_TFMX.library`, 9,236 bytes at $210000 and the smallest of the eleven,
 * its romtag reading "DME_TFMX.library 1.0 (08. April 97) DOOM Productions
 * 1997". All ten custom LVOs are veneer over one jump structure at $21056c:
 * a word of 5,000 and then sixteen `bra.w`s from $210570.
 *
 * DOOM Productions did not write the replay. 564 contiguous bytes are
 * byte-identical to `TFMXPRO.OBJ` in `Ripped TFMX-Player V1.7` on Aminet
 * (`mus/play/TFMX.lha`) --- a different build of the same replayer, which
 * corroborates and does not raise the tier.
 *
 * Three dispatch tables carry the whole format, and every one of them is
 * transcribed here entry by entry rather than approximated:
 *
 *   $210776  sixteen pattern commands, for a lead byte of $f0 to $ff
 *   $210bb0  FORTY-TWO macro commands, guarded by `cmp.w #$a8,d0 / bcc`
 *   $210968  five trackstep escapes, reached through the $effe marker
 *
 * ## The clock is CIA-B, and a tempo means two things
 *
 * $2113f4 writes the halves of `$24(a6)` to $bfd700 and $bfd600, which are
 * CIA-B's TBHI and TBLO, and $210228 starts it with bit 0 of CRB at $bfdf00.
 * The default is $376c on a 50 Hz machine and $37f0 on a 60 Hz one, both of
 * which are 50.0 Hz against their own CIA clock.
 *
 * A subsong's tempo word at $180 is read twice over. $211a6a compares it with
 * 15: at 15 or below it is a SPEED, the number of interrupts a trackstep row
 * lasts, and the CIA keeps its 50 Hz. Above 15 it is a DIVISOR, `$1b51f8 /
 * tempo`, and the speed keeps whatever it already had --- which `SetModule`
 * left at 5. One word, two meanings, chosen by a threshold.
 *
 * DEVIATION: $211bda's two arms disagree with each other in two ways, and
 * both are reproduced. The 50 Hz arm sets `$24(a6)` when bit 1 of the mdat's
 * byte $b is SET and the 60 Hz arm sets it when the same bit is CLEAR. And
 * the 60 Hz arm writes $37f0 to the CIA and $37ee to `$24(a6)`, two counts
 * apart, so the period the timer starts with is not the one every later tick
 * rewrites.
 *
 * ## Sixteen voice slots for four voices
 *
 * $211d0a is a table of sixteen pointers and a note command picks from it
 * with `$1a(a6) & $f`. $211bba fills it by copying four entries back on
 * itself twelve times, so slots 4 to 15 repeat voices 0 to 3 in order. A
 * pattern that addresses voice 9 gets voice 1, silently.
 *
 * ## What a note is
 *
 * $2115f4 takes the whole four-byte command. Byte 0 under $80 is a note and
 * the other three are the macro, the channel with a volume nibble, and a
 * detune. Byte 0 from $c0 to $f4 is a portamento to that note. $f5, $f6, $f7
 * and $fc are the kill, vibrato, envelope and key-on lock, and $fc is the
 * only one that runs while the lock is up.
 */

import type { AudioSink } from './host'
import { PAULA_CLOCK, VBL_HZ, clampVolume, periodToHz } from './paula'
import { TFMX_TRACKS, type TfmxSong } from './tfmx'

/** `move.l #$1b51f8,d1 / divu.w d0,d1` at $211a76 and $210aba */
export const TFMX_CIA_NUM = 0x1b51f8
/** the CIA-B period $211bf4 writes on a 50 Hz machine, and $211c18's on a 60 */
export const TFMX_CIA_PAL = 0x376c
export const TFMX_CIA_NTSC = 0x37f0
/** what $211c34 puts in `$24(a6)` on a 60 Hz machine, which is not what it
 *  gave the timer */
export const TFMX_CIA_NTSC_LATCH = 0x37ee
/** CIA-B's own clock, PAL. `TFMX_CIA_PAL` against it is 50.0 Hz exactly */
export const TFMX_CIA_CLOCK = PAULA_CLOCK / 5
/** `cmp.w #$f,d2 / bls` at $211a6a: at or below this a tempo is a speed */
export const TFMX_SPEED_MAX = 15
/** `move.w #$5,$6(a5)` at $211b7c */
export const TFMX_DEFAULT_SPEED = 5
/** four voices, and $211bba makes sixteen slots out of them */
export const TFMX_VOICES = 4
export const TFMX_VOICE_SLOTS = 16
/** `move.w #$1f,d0` at $211b86: one saved trackstep, speed and timer a subsong */
export const TFMX_SUBSONG_SLOTS = 32
/** the marker $210950 tests a trackstep row's first word for */
export const TFMX_TRACKSTEP_ESCAPE = 0xeffe
/** a trackstep row is eight words and the escape puts its own data in them */
export const TFMX_TRACKSTEP_BYTES = 16

/**
 * The 64 period words at $212380, five octaves and a bit.
 *
 * The table repeats its last octave twice over: entries 48 to 63 are entries
 * 40 to 47 again, which is what a note above the top plays. Read out of the
 * binary rather than derived, because it is not ProTracker's and not MED's.
 */
export const TFMX_PERIODS = Uint16Array.of(
  0x06ae, 0x064e, 0x05f4, 0x059e, 0x054d, 0x0501, 0x04b9, 0x0475,
  0x0435, 0x03f9, 0x03c0, 0x038c, 0x0358, 0x032a, 0x02fc, 0x02d0,
  0x02a8, 0x0282, 0x025e, 0x023b, 0x021b, 0x01fd, 0x01e0, 0x01c6,
  0x01ac, 0x0194, 0x017d, 0x0168, 0x0154, 0x0140, 0x012f, 0x011e,
  0x010e, 0x00fe, 0x00f0, 0x00e3, 0x00d6, 0x00ca, 0x00bf, 0x00b4,
  0x00aa, 0x00a0, 0x0097, 0x008f, 0x0087, 0x007f, 0x0078, 0x0071,
  0x00d6, 0x00ca, 0x00bf, 0x00b4, 0x00aa, 0x00a0, 0x0097, 0x008f,
  0x0087, 0x007f, 0x0078, 0x0071, 0x00d6, 0x00ca, 0x00bf, 0x00b4,
)

/**
 * What the AM's slew starts each tick from.
 *
 * $211262 reads it from the absolute address $43, which on the machine is one
 * byte of the 68000's vector 16 and holds whatever the ROM left there. Zero
 * here, because this port has no vector table for it to read.
 */
export const TFMX_SLEW_SEED = 0

/** the lead bytes $2115f4 handles before it decides a byte is a note */
export const TFMX_NOTE_LOCK = 0xfc
export const TFMX_NOTE_ENVELOPE = 0xf7
export const TFMX_NOTE_VIBRATO = 0xf6
export const TFMX_NOTE_KILL = 0xf5
/** `cmp.b #$bf,d0 / bcc` at $21169e: $c0 and up is a portamento */
export const TFMX_NOTE_PORTA = 0xc0

/** one of the eight tracks, named by its offset in the block at $2121ca */
interface TfmxTrack {
  /** `$28`, where in the mdat this track's pattern is */
  pattern: number
  /** `$48`, the pattern number, and $ff means the track is dead */
  number: number
  /** `$49`, added to every note the pattern plays */
  transpose: number
  /** `$4a`, the pattern-loop counter */
  loop: number
  /** `$68`, how far into the pattern it is */
  pos: number
  /** `$6a`, rows still to wait */
  wait: number
  /** `$88` and `$a8`, where a `$f8` left off */
  savedPattern: number
  savedPos: number
}

const newTrack = (): TfmxTrack => ({
  pattern: 0, number: 0xff, transpose: 0, loop: 0, pos: 0, wait: 0,
  savedPattern: 0, savedPos: 0,
})

/**
 * One voice, named by its offset in the $90-byte block at $211d4a.
 *
 * Every field here is one the disassembly writes, and the names are what the
 * code does with them rather than what TFMX's own source might have called
 * them. There is no TFMX source in the corpus.
 */
interface TfmxVoice {
  /** `$0`, whether the macro runner should look at this voice at all */
  live: boolean
  /** `$1`, set by the DMA-on command and read by the tick before it does anything */
  started: number
  /** `$3` and `$1b`, the add-to-begin counter and its reload */
  addBeginCount: number
  addBeginReload: number
  /** `$4` and `$5`, the note before this one and this one */
  prevNote: number
  note: number
  /** `$6`, ticks until the key comes up */
  keyDown: number
  /** `$8`, the note the volume commands scale by three */
  noteScale: number
  /** `$9`, the volume nibble the note command carried */
  velocity: number
  /** `$a`, the detune the note command carried */
  detune: number
  /** `$c`, `$10` and `$12`: the macro, where it is, and how long it waits */
  macro: number
  pc: number
  wait: number
  /** `$18`, the volume that reaches AUDxVOL */
  volume: number
  /** `$1a`, the macro loop counter */
  loop: number
  /** `$1c` to `$1f`: the envelope's speed, counter, target and step */
  envSpeed: number
  envCount: number
  envTarget: number
  envStep: number
  /** `$20` to `$27`: the vibrato's step, counter, and the portamento beside it */
  vibStep: number
  vibCount: number
  portaSpeed: number
  portaCount: number
  vibAcc: number
  vibLen: number
  vibHalf: number
  /** `$28`, the period the macros compute, before vibrato */
  period: number
  /** `$2c` and `$34`: AUDxLC as an offset into the sample bank, and AUDxLEN */
  begin: number
  len: number
  /** `$30` and `$32`: the portamento's rate and where it has got to */
  portaRate: number
  portaAt: number
  /** `$36`, whether the key is still down */
  keyOn: boolean
  /** `$37`, the mask the random arpeggio takes against the random byte */
  arpMask: number
  /** `$38` and `$40`, where a `gosub` left off */
  savedMacro: number
  savedPc: number
  /** `$3c`, `$3d` and `$3e`: the key-on lock and its countdown */
  lock: number
  lockNote: number
  lockCount: number
  /** `$42`, which track last claimed this voice */
  owner: number
  /** `$43`, written per voice and read from somewhere else entirely */
  amLast: number
  /** `$48` to `$53`: the arpeggio, which runs beside the macro that started it */
  arpSpeed: number
  arpFlags: number
  arpCount: number
  arpEnable: number
  arpTable: number
  arpPc: number
  arpMacro: number
  arpKeyed: number
  /** `$5c`, the signed word the add-to-begin command steps by */
  addBeginStep: number
  /** `$60`, where in the bank this voice's AM buffer is */
  offset: number
  /** `$64` and `$68`: where the AM reads from, and the mask it wraps with */
  amSrc: number
  amMask: number
  /** `$6a`, how many bytes the AM writes each tick, less one */
  amCount: number
  /** `$6c`, `$70`, `$72`, `$74`: the read window and the sweep that moves it */
  amAcc: number
  amAccCount: number
  amAccReload: number
  amAccStep: number
  /** `$78`, `$84`, `$86`, `$82`: the per-byte step and the sweep on IT */
  amStep: number
  amStepCount: number
  amStepReload: number
  amStepStep: number
  /** `$76`, `$7c`, `$7e`, `$80`: the slew limit, and the sweep on that */
  amSlew: number
  amSlewCount: number
  amSlewReload: number
  amSlewStep: number
  /** `$88`, the note command the track handed over and the macro runner takes */
  pending: number
  /** the DMACON bits `$48(a6)` and `$4a(a6)` hold until the end of the tick */
  pendingOn: boolean
  pendingOff: boolean
  /** `$4a(a6)` again: a DMA-off the interrupt defers to its own start */
  deferOff: boolean
  /** `$8c`, AUDxPER */
  outPeriod: number
  /** `$8e`, set when the macro runner has already run this voice this tick */
  ranThisTick: boolean
  /** where AUDxLC points, which the AM commands move off the sample begin */
  playFrom: number

  /** what reached the sink last, so a tick that changes nothing writes nothing */
  sentPeriod: number
  sentVolume: number
  sounding: boolean
  /** where the pcm handed to the sink starts, so a relatch can be a loop write */
  sentBegin: number
}

const newVoice = (): TfmxVoice => ({
  live: false, started: 0, addBeginCount: 0, addBeginReload: 0,
  prevNote: 0, note: 0, keyDown: 0, noteScale: 0, velocity: 0, detune: 0,
  macro: 0, pc: 0, wait: 0, volume: 0, loop: 0xff,
  envSpeed: 0, envCount: 0, envTarget: 0, envStep: 0,
  vibStep: 0, vibCount: 0, portaSpeed: 0, portaCount: 0,
  vibAcc: 0, vibLen: 0, vibHalf: 0,
  period: 0, begin: 0, len: 0, portaRate: 0, portaAt: 0,
  keyOn: false, arpMask: 0, savedMacro: 0, savedPc: 0,
  lock: 0, lockNote: 0, lockCount: 0, owner: 0xff, amLast: 0,
  arpSpeed: 0, arpFlags: 0, arpCount: 0, arpEnable: 0,
  arpTable: 0, arpPc: 0, arpMacro: 0, arpKeyed: 0,
  addBeginStep: 0, offset: 4,
  amSrc: 0, amMask: 0, amCount: 0,
  amAcc: 0, amAccCount: 0, amAccReload: 0, amAccStep: 0,
  amStep: 0, amStepCount: 0, amStepReload: 0, amStepStep: 0,
  amSlew: 0, amSlewCount: 0, amSlewReload: 0, amSlewStep: 0,
  pending: 0, pendingOn: false, pendingOff: false, deferOff: false,
  outPeriod: 0, ranThisTick: false, playFrom: -1,
  sentPeriod: -1, sentVolume: -1, sounding: false, sentBegin: -1,
})

/** what one subsong left behind, so `Tfmx Cont` can put it back ($212292) */
interface TfmxSaved {
  step: number
  speed: number
  timer: number
}

export class TfmxPlayer {
  private sink: () => AudioSink | undefined

  private song: TfmxSong | null = null
  private mdat: Uint8Array<ArrayBufferLike> = new Uint8Array(0)
  private smpl: Int8Array<ArrayBufferLike> = new Int8Array(0)
  /** `$38`, `$3c` and `$40`: the trackstep, pattern and macro tables */
  private tracksteps = 0
  private patterns = 0
  private macros = 0

  private tracks: TfmxTrack[] = [...Array(TFMX_TRACKS)].map(newTrack)
  private voices: TfmxVoice[] = [...Array(TFMX_VOICES)].map(newVoice)
  private saved: TfmxSaved[] = [...Array(TFMX_SUBSONG_SLOTS)].map(() => ({
    step: 0,
    speed: TFMX_DEFAULT_SPEED,
    timer: 0,
  }))

  /** `$0(a5)`, `$2(a5)`, `$4(a5)` and `$6(a5)` of the block at $2121ca */
  private first = 0
  private last = 0
  private step = 0
  private speed = TFMX_DEFAULT_SPEED

  /** `$1c(a6)`, the interrupts left before the next trackstep row */
  private stepCount = 0
  /** `$1e(a6)`, whether the interrupt does anything */
  private on = false
  /** `$2d(a6)` and `$10(a6)`: the subsong asked for and the one running */
  private subsong = 0
  private running = -1
  /** `$24(a6)`, the CIA-B period every tick rewrites */
  private timer = TFMX_CIA_PAL
  /** `$30(a6)` to `$33(a6)`, the master volume and its fade */
  private master = 0x40
  private fadeTo = 0x40
  private fadeCount = 0
  private fadeReload = 0
  private fadeDir = 0
  /** `$2e(a6)`, cleared by `$fe` and by a start, so the eighth track stops */
  private eighth = 1
  /** `$d(a6)`, which sends the track walk round again */
  private again = false
  /** `$18(a6)`, the four bytes every handler below reads its operands from */
  private cmd = 0
  /** `$12(a6)`, the word $2115da stirs, and the interrupts it is stirred with */
  private rnd = 0
  private ticks = 0
  /** `$8(a6)`, where the AM writes, which jump entry $211bca can move */
  private amBase = 0
  /** the four words at $212370 the `$fd` and macro 32 commands write */
  readonly signals = new Int16Array(4)

  /** seconds of frame owed to a timer that is not the frame's: 50 Hz by
   *  default and up to 500 when a subsong names a divisor */
  private owed = 0

  constructor(sink: () => AudioSink | undefined) {
    this.sink = sink
  }

  // ---- the mdat ----------------------------------------------------------

  private b(at: number): number {
    return this.mdat[at] ?? 0
  }

  private w(at: number): number {
    return ((this.mdat[at] ?? 0) << 8) | (this.mdat[at + 1] ?? 0)
  }

  private l(at: number): number {
    return (
      (((this.mdat[at] ?? 0) << 24) |
        ((this.mdat[at + 1] ?? 0) << 16) |
        ((this.mdat[at + 2] ?? 0) << 8) |
        (this.mdat[at + 3] ?? 0)) >>>
      0
    )
  }

  /**
   * LVO -$24, $2101be: the module, and the second subsong walk beside it.
   *
   * $211afa is where the three table pointers are settled. `$1d0` decides:
   * present, the three longs there are offsets from the mdat; absent, the
   * player falls back to $800, $400 and $600, which is the layout every
   * pre-1990 rip has. `tfmx.ts` reads the same fork.
   */
  load(song: TfmxSong): void {
    this.song = song
    this.mdat = song.mdat
    // the sample bank is written as well as read: the AM commands rewrite the
    // waveform under a playing voice, which is what $211288 does
    this.smpl = new Int8Array(song.smpl.buffer, song.smpl.byteOffset, song.smpl.length)
    this.tracksteps = song.tracksteps
    this.patterns = song.patterns
    this.macros = song.macros
    // $211b18 clears the first long of the sample bank, so a macro that never
    // set a begin plays silence rather than whatever the loader left
    for (let i = 0; i < 4 && i < this.smpl.length; i++) this.smpl[i] = 0
    this.master = 0x40
    this.fadeTo = 0x40
    this.fadeDir = 0
    this.speed = TFMX_DEFAULT_SPEED
    this.saved = [...Array(TFMX_SUBSONG_SLOTS)].map(() => ({
      step: 0,
      speed: TFMX_DEFAULT_SPEED,
      timer: 0,
    }))
    this.running = -1
    this.tracks = [...Array(TFMX_TRACKS)].map(newTrack)
    this.voices = [...Array(TFMX_VOICES)].map(newVoice)
  }

  // ---- starting and stopping ---------------------------------------------

  /** LVO -$2a, $210200 into jump entry +$c: start a subsong from the top */
  play(subsong: number): void {
    this.begin(subsong & 0x1f, 0, false)
  }

  /** LVO -$30, $210236 into +$40: the same, with the saved position put back */
  cont(subsong: number): void {
    this.begin(subsong & 0x1f, 0, true)
  }

  /** LVO -$1e, $210178: silence every voice and stop the timer */
  stop(): void {
    this.on = false
    this.allOff()
  }

  /** LVO -$54 and -$4e, $210312 and $210336, both through $211960 */
  seek(delta: number): void {
    let target = this.step + delta
    // $210388 clamps against the subsong's own bounds rather than the song's
    const first = this.w(0x100 + this.subsong * 2)
    const last = this.w(0x140 + this.subsong * 2)
    if (target > last) target = last
    if (target < first) target = first
    this.begin(this.subsong, target || 1, false)
    this.step = target
  }

  /** LVO -$36, $210260: `mulu.w #$40 / lsr.w #$6` is a round trip, so 0..63 */
  set volume(v: number) {
    const n = ((v * 0x40) >> 6) & 0xffff
    this.master = n
    this.fadeTo = n
    this.fadeDir = 0
  }

  get volume(): number {
    return this.master
  }

  /** LVO -$42, $2102e0: where in the subsong the trackstep pointer has got to */
  get position(): number {
    return this.step - this.w(0x100 + this.subsong * 2)
  }

  /** LVO -$48, $21035a: the end word less the start word */
  get length(): number {
    return this.w(0x140 + this.subsong * 2) - this.w(0x100 + this.subsong * 2)
  }

  get playing(): boolean {
    return this.on
  }

  /**
   * $2119aa, which every one of start, continue and seek goes through.
   *
   * `fresh` is $2119aa's d3: zero for a start and non-zero for a seek, and it
   * decides whether the voices are silenced and whether the tempo word is read
   * again. `resume` is bit 0 of `$2c(a6)`, which `Tfmx Cont` sets.
   */
  private begin(subsong: number, at: number, resume: boolean): void {
    if (!this.song) return
    if (at === 0) this.allOff()
    this.on = false
    this.eighth = 0
    this.subsong = subsong
    // $2119d0: the subsong that WAS running gets its place saved first
    if (this.running >= 0) {
      const s = this.saved[this.running & 0x1f]!
      s.step = this.step
      s.speed = this.speed
      s.timer = this.timer
    }
    this.setTimerDefault()

    this.first = this.w(0x100 + subsong * 2)
    this.last = this.w(0x140 + subsong * 2)
    this.step = at !== 0 ? at : this.first
    let tempo = at !== 0 ? this.speed : this.w(0x180 + subsong * 2)

    if (at === 0) {
      if (resume) {
        const s = this.saved[subsong]!
        this.step = s.step
        tempo = s.speed
        if (s.timer !== 0) {
          this.timer = s.timer
          s.timer = 0
        }
      } else if (tempo > TFMX_SPEED_MAX) {
        // $211a70: the word is a CIA divisor and the speed keeps what it had
        this.timer = Math.floor(TFMX_CIA_NUM / tempo)
        tempo = this.speed
      }
      // $211a94: every track pointed at the dummy pattern at $212378, which is
      // an $ff lead byte, so a track no trackstep row names plays nothing
      for (const t of this.tracks) {
        t.pattern = -1
        t.number = 0xff
        t.transpose = 0
        t.pos = 0
        t.wait = 0
      }
      this.speed = tempo
    }

    if (subsong < 0x80) this.loadTrackstep()
    this.again = false
    this.stepCount = 0
    this.running = subsong
    this.signals.fill(0)
    this.owed = 0
    this.on = true
  }

  /** $211bda, and the two arms that disagree with each other */
  private setTimerDefault(): void {
    // this port models a PAL machine, so it is the 50 Hz arm that runs. The
    // 60 Hz one is here because its two differences are the finding: it tests
    // the same bit the other way round, and it hands the timer $37f0 while
    // latching $37ee for every tick after the first.
    const pal = true
    const bit = (this.b(0xb) & 0x2) !== 0
    this.timer = pal ? TFMX_CIA_PAL : TFMX_CIA_NTSC
    if (pal) {
      if (bit) this.timer = TFMX_CIA_PAL
    } else if (!bit) this.timer = TFMX_CIA_NTSC_LATCH
  }

  // ---- the clock ---------------------------------------------------------

  /** the interrupt rate CIA-B timer B is running at */
  get tickHz(): number {
    return this.timer > 0 ? TFMX_CIA_CLOCK / this.timer : 0
  }

  /**
   * One frame's worth of CIA interrupts.
   *
   * The timer runs at 50 Hz by default and at up to 500 Hz when a subsong
   * names a divisor, so each interrupt is placed at the instant it happens
   * rather than counted into the frame, the same way `runtime/med.ts` places
   * MED's.
   */
  vbl(): void {
    if (!this.on) return
    this.owed += 1 / VBL_HZ
    for (let guard = 0; guard < 64 && this.owed > 0; guard++) {
      this.tick()
      const hz = this.tickHz
      if (hz <= 0) {
        this.owed = 0
        return
      }
      this.owed -= 1 / hz
    }
  }

  /**
   * $2105d0, the CIA interrupt.
   *
   * The order matters and is the library's: the DMA the last tick asked to
   * stop goes off first, then the macros run, then the song, then every
   * voice's period reaches AUDxPER, and only then does the DMA the macros
   * asked for come on.
   */
  tick(): void {
    if (!this.on) return
    this.ticks = (this.ticks + 1) & 0xffff
    // $2105dc: whatever `$4a(a6)` collected last interrupt goes off first
    for (let i = 0; i < TFMX_VOICES; i++) {
      const v = this.voices[i]!
      if (v.deferOff) {
        v.deferOff = false
        this.voiceOff(i)
      }
      if (v.pendingOff) this.voiceOff(i)
    }
    this.runMacros()
    if (this.running >= 0 && this.running < 0x80) this.runSong()
    for (let v = 0; v < TFMX_VOICES; v++) this.writeVoice(v)
  }

  // ---- the trackstep table -----------------------------------------------

  /**
   * $21093a: one row of the trackstep table, eight words sixteen bytes apart.
   *
   * A row whose first word is $effe is not eight track slots but a command,
   * and its second word chooses one of the five at $210968.
   */
  private loadTrackstep(): void {
    for (let guard = 0; guard < 256; guard++) {
      const at = this.tracksteps + this.step * TFMX_TRACKSTEP_BYTES
      if (this.w(at) !== TFMX_TRACKSTEP_ESCAPE) {
        for (let i = 0; i < TFMX_TRACKSTEP_BYTES / 2; i++) {
          // $210a44: the eighth slot is skipped while `$2e(a6)` is set, which
          // is what an `$fe` in a pattern turns on
          if (i === 7 && this.eighth !== 0) break
          const word = this.w(at + i * 2)
          const t = this.tracks[i]!
          t.number = (word >> 8) & 0xff
          t.transpose = (word << 24) >> 24
          if ((word & 0x8000) !== 0) continue
          t.pattern = this.l(this.patterns + ((word >> 8) & 0x7f) * 4)
          t.pos = 0
          t.wait = 0
          t.loop = 0xff
        }
        return
      }
      const kind = this.w(at + 2)
      if (kind >= 5) return this.escapeStop()
      const a = this.w(at + 4)
      const b = this.w(at + 6)
      switch (kind) {
        case 0: // $210a6c: the song is over
          this.on = false
          return
        case 1: // $210a76: a counted jump, and `$36(a6)` holds the count
          if (this.loopCount === 0) {
            this.loopCount = -1
            this.step++
          } else {
            if (this.loopCount < 0) this.loopCount = b - 1
            else this.loopCount--
            this.step = a
          }
          break
        case 2: // $210aa4: the speed, and a tempo that fits sets the timer
          this.speed = a
          this.stepCount = a
          if ((b & 0x8000) === 0 && (b & 0x1ff) !== 0) this.timer = Math.floor(TFMX_CIA_NUM / (b & 0x1ff))
          this.step++
          break
        default: // $210ace: the fade, which is command 3 and command 4 alike
          this.step++
          this.startFade(this.b(at + 5), this.b(at + 7))
          break
      }
    }
  }

  private loopCount = -1

  private escapeStop(): void {
    this.on = false
  }

  /** $2108a4 and $210ae4, which are the same nine instructions twice over */
  private startFade(target: number, speed: number): void {
    this.fadeTo = target
    this.fadeCount = speed
    this.fadeReload = speed
    if (speed === 0) {
      this.master = target
      this.fadeDir = 0
      return
    }
    this.fadeDir = this.master > target ? -1 : 1
    if (this.master === target) this.fadeDir = 0
  }

  // ---- the eight tracks --------------------------------------------------

  /**
   * $21067c: the song, once every `speed` interrupts.
   *
   * The eight tracks are walked in order and any of them may set `$d(a6)`,
   * which sends the walk back to track 0 --- that is how a `$f0` that loads
   * the next trackstep row takes effect on the same interrupt.
   */
  private runSong(): void {
    if (--this.stepCount >= 0) return
    this.stepCount = this.speed
    for (let round = 0; round < 16; round++) {
      this.again = false
      for (let i = 0; i < TFMX_TRACKS; i++) {
        this.runTrack(i)
        if (this.again) break
      }
      if (!this.again) return
    }
  }

  /** $2106da: one track, and $2106e2's `$fe` is the only lead byte it knows */
  private runTrack(i: number): void {
    const t = this.tracks[i]!
    if (t.number >= 0x90) {
      if (t.number === 0xfe) {
        // $2106ea: kill the voice this track's transpose names
        t.number = 0xff
        this.voiceOffSlot(t.transpose & 0xff)
      }
      return
    }
    if (t.wait !== 0) {
      t.wait--
      return
    }
    for (let guard = 0; guard < 512; guard++) {
      if (t.pattern < 0) return
      this.cmd = this.l(t.pattern + t.pos * 4)
      const lead = (this.cmd >>> 24) & 0xff
      if (lead >= 0xf0) {
        if (this.pattern(i, lead & 0xf)) return
        continue
      }
      // $210726: a note. $210734 takes the track's wait out of BYTE 3 and
      // zeroes it, so the same byte cannot also be a detune
      const carries = lead >= 0x80 && lead < 0xc0
      if (carries) {
        t.wait = this.cmd & 0xff
        this.cmd = (this.cmd & 0xffffff00) >>> 0
      }
      // $21073e adds the transpose, and only a lead under $c0 is masked
      let note = (lead + t.transpose) & 0xff
      if (lead < 0xc0) note &= 0x3f
      this.cmd = (((note << 24) >>> 0) | (this.cmd & 0x00ffffff)) >>> 0
      this.noteCommand(this.cmd)
      t.pos++
      if (carries) return
    }
  }

  /**
   * $210776: the sixteen commands a lead byte of $f0 to $ff selects.
   *
   * Returns true when the track has done all it is going to this interrupt.
   */
  private pattern(i: number, op: number): boolean {
    const t = this.tracks[i]!
    const b1 = (this.cmd >>> 16) & 0xff
    const b23 = this.cmd & 0xffff
    switch (op) {
      case 0x0: // $2107ba: end of pattern, and the trackstep moves
        t.number = 0xff
        if (this.step === this.last) this.step = this.first
        else this.step++
        this.loadTrackstep()
        this.again = true
        return true
      case 0x1: // $2107de: loop, with $ff meaning "take the count from b1"
        if (t.loop === 0) {
          t.loop = 0xff
          t.pos++
          return false
        }
        if (t.loop === 0xff) t.loop = (b1 - 1) & 0xff
        else t.loop--
        t.pos = b23
        return false
      case 0x2: // $21080c: another pattern, from the top
        t.number = b1
        t.pattern = this.l(this.patterns + b1 * 4)
        t.pos = b23
        return false
      case 0x3: // $210830: wait this many rows
        t.wait = b1
        t.pos++
        return true
      case 0x4: // $210840
      case 0xe: // $21083c, which also lets the eighth track back in
        if (op === 0xe) this.eighth = 0
        t.number = 0xff
        return true
      case 0x5:
      case 0x6:
      case 0x7:
      case 0xc: // $210846: four lead bytes, one handler, straight to the note
        this.noteCommand(this.cmd)
        t.pos++
        return false
      case 0x8: // $210852: call a pattern, keeping where to come back to
        t.savedPattern = t.pattern
        t.savedPos = t.pos
        t.number = b1
        t.pattern = this.l(this.patterns + b1 * 4)
        t.pos = b23
        return false
      case 0x9: // $210882: and come back
        t.pattern = t.savedPattern
        t.pos = t.savedPos
        t.pos++
        return false
      case 0xa: // $210892: the fade, refused while one is already running
        t.pos++
        if (this.fadeDir === 0) this.startFade(this.cmd & 0xff, b1)
        return false
      case 0xd: // $2108e6: one of the four signal words
        this.signals[b1 & 3] = (b23 << 16) >> 16
        t.pos++
        return false
      case 0xb: // $2108fe: point another track at a pattern
        this.startTrack(this.cmd)
        t.pos++
        return false
      default: // $2107b2, which is $ff: nothing but a step
        t.pos++
        return false
    }
  }

  /** $2108fe: `$fb` hands a pattern to whichever track its low nibble names */
  private startTrack(cmd: number): void {
    const which = ((cmd >>> 8) & 0x7) & 0xffff
    const t = this.tracks[which]!
    const num = (cmd >>> 16) & 0xff
    t.number = num
    t.transpose = ((cmd & 0xff) << 24) >> 24
    t.pattern = this.l(this.patterns + (num & 0x7f) * 4)
    t.pos = 0
    t.wait = 0
    t.loop = 0xff
  }

  // ---- notes -------------------------------------------------------------

  /**
   * $2115f4: a four-byte command, and the voice its third byte names.
   *
   * $211600's table has sixteen slots for four voices, so `& $f` cannot miss
   * and a pattern addressing voice 9 gets voice 1.
   */
  private noteCommand(cmd: number): void {
    const lead = (cmd >>> 24) & 0xff
    const b1 = (cmd >>> 16) & 0xff
    const b2 = (cmd >>> 8) & 0xff
    const b3 = cmd & 0xff
    const v = this.voices[(b2 & 0xf) % TFMX_VOICES]!

    if (lead === TFMX_NOTE_LOCK) {
      v.lock = b1
      v.lockCount = b3
      return
    }
    if (v.lock !== 0) return
    if (lead >= 0x80) {
      if (lead === TFMX_NOTE_ENVELOPE) {
        v.envStep = b1
        v.envCount = ((b2 >> 4) + 1) & 0xff
        v.envSpeed = v.envCount
        v.envTarget = b3
        return
      }
      if (lead === TFMX_NOTE_VIBRATO) {
        v.vibLen = b1 & 0xfe
        v.vibHalf = (b1 & 0xfe) >> 1
        v.vibStep = b3
        v.vibCount = 1
        v.vibAcc = 0
        return
      }
      if (lead === TFMX_NOTE_KILL) {
        v.keyOn = false
        return
      }
      if (lead >= TFMX_NOTE_PORTA) {
        // $211718: a portamento to the note in the low six bits
        v.portaSpeed = b1
        v.portaCount = 1
        if (v.portaRate === 0) v.portaAt = v.period
        v.portaRate = b3
        const n = lead & 0x3f
        v.note = n
        v.period = TFMX_PERIODS[n]!
        return
      }
    }
    // $2116a4: a note-on
    v.detune = (b3 << 24) >> 24
    v.velocity = (b2 >> 4) & 0xf
    v.prevNote = v.note
    v.note = lead
    v.macro = this.l(this.macros + b1 * 4)
    v.pc = 0
    v.wait = 0
    v.started = 0
    v.loop = 0xff
    v.live = true
    v.keyDown = 0
    v.keyOn = true
    // $2116f8 clears this voice's INTENA and INTREQ bits and nothing else: a
    // note-on does NOT stop the DMA, the macro's first command does
  }

  // ---- the macro runner --------------------------------------------------

  /** $210b28: four voices, in order, and each may run many commands a tick */
  private runMacros(): void {
    for (let i = 0; i < TFMX_VOICES; i++) this.runMacro(i)
  }

  /** $210b3e: the countdowns first, then the pending note, then the commands */
  private runMacro(i: number): void {
    const v = this.voices[i]!
    v.ranThisTick = false
    if (v.lockCount >= 0 && v.lock !== 0) {
      if (--v.lockCount < 0) {
        v.lock = 0
        v.lockNote = 0
      }
    }
    if (v.pending !== 0) {
      const pend = v.pending
      v.pending = 0
      const keep = v.lock
      v.lock = 0
      this.noteCommand(pend)
      v.lock = keep
    }
    if (!v.live) return this.voiceTick(i)
    if (v.wait !== 0) {
      v.wait--
      return this.voiceTick(i)
    }
    for (let guard = 0; guard < 512; guard++) {
      this.cmd = this.l(v.macro + v.pc * 4)
      const op = (this.cmd >>> 24) & 0xff
      this.cmd &= 0x00ffffff
      if (op >= 42) {
        // $210c58: an unknown command runs the voice once and gives up
        if (v.ranThisTick) {
          v.pc++
          return this.voiceTick(i)
        }
        v.ranThisTick = true
        v.pc++
        continue
      }
      const more = this.macro(i, op)
      if (!more) return this.voiceTick(i)
    }
    this.voiceTick(i)
  }

  /**
   * $210bb0: forty-two commands, and the return says whether the runner reads
   * another one this interrupt.
   */
  private macro(i: number, op: number): boolean {
    const v = this.voices[i]!
    const b1 = (this.cmd >>> 16) & 0xff
    const b2 = (this.cmd >>> 8) & 0xff
    const b3 = this.cmd & 0xff
    const b23 = this.cmd & 0xffff
    const step = (): boolean => {
      v.pc++
      return true
    }
    switch (op) {
      case 0: // $210c72: DMA off, and everything the voice was doing with it
        v.envSpeed = 0
        v.arpEnable = 0
        v.portaRate = 0
        v.arpEnable = 0
        v.amCount = 0
        return this.macro(i, 19)
      case 19: // $210c86: DMA off on its own, which is where 0 ends up
        v.pc++
        if (b1 === 0) {
          // straight to DMACON, and the runner reads the next command
          v.pendingOff = true
          return true
        }
        // or into `$4a(a6)`, which the NEXT interrupt applies before anything
        v.deferOff = true
        v.ranThisTick = false
        return false
      case 1: // $210cac: DMA on
        v.started = b1
        v.pc++
        v.pendingOn = true
        return true
      case 2: // $210cd2: the sample this voice plays
        v.addBeginCount = 0
        v.begin = this.cmd
        return step()
      case 3: // $210d4a: and how much of it
        v.len = b23
        return step()
      case 4: // $210d5e: wait, and bit 0 of b1 waits for the key instead
        if ((b1 & 1) !== 0) {
          if (v.arpKeyed !== 0) return step()
          v.arpKeyed = 1
          return this.macro(i, 19)
        }
        v.wait = b23
        v.pc++
        return false
      case 5: // $210e42: loop, and $ff takes the count from b1 the first time
        if (v.loop === 0) {
          v.loop = 0xff
          return step()
        }
        if (v.loop === 0xff) v.loop = (b1 - 1) & 0xff
        else v.loop--
        v.pc = b23
        return true
      case 16: // $210e76: the same loop, but only while the key is down
        if (!v.keyOn) return step()
        return this.macro(i, 5)
      case 6: // $211048: another macro, from a given step
        v.macro = this.l(this.macros + (b1 & 0x7f) * 4)
        v.pc = b23
        v.loop = 0xff
        return true
      case 21: // $21103c: the same, keeping where to come back to
        v.savedMacro = v.macro
        v.savedPc = v.pc
        return this.macro(i, 6)
      case 22: // $211074: and come back
        v.macro = v.savedMacro
        v.pc = v.savedPc
        return step()
      case 7: // $210e84: the voice is finished
        v.live = false
        return false
      case 8: // $210f20: a note off the one playing
        return this.noteFrom(i, v.note, b1, b2, b3)
      case 9: // $210f18: a note off nothing
        return this.noteFrom(i, 0, b1, b2, b3)
      case 31: // $210f0e: a note off the one BEFORE the one playing
        return this.noteFrom(i, v.prevNote, b1, b2, b3)
      case 23: // $210f60: the period itself, no table
        v.period = b23
        if (v.portaRate === 0) v.outPeriod = b23
        return step()
      case 10: // $210fee: forget every effect
        v.arpEnable = 0
        v.amCount = 0
        v.addBeginCount = 0
        v.envSpeed = 0
        v.arpEnable = 0
        v.portaRate = 0
        return step()
      case 11: // $210f78: portamento
        v.portaSpeed = b1
        v.portaCount = 1
        if (v.portaRate === 0) v.portaAt = v.period
        v.portaRate = b23
        return step()
      case 12: // $210f9a: vibrato, and its counter is half its length
        v.vibLen = b1 & 0xfe
        v.vibHalf = (b1 & 0xfe) >> 1
        v.vibStep = b3
        v.vibCount = 1
        if (v.portaRate === 0) v.outPeriod = v.period
        v.vibAcc = 0
        return this.macro(i, 19)
      case 13: // $210e8c: three times `$8(a5)`, plus the word
        if (b2 === 0xfe) this.noteFrom(i, v.note, b1, 0, b3, true)
        v.volume = (v.noteScale * 3 + b23) & 0xff
        return step()
      case 14: // $210ec6: the volume outright, and the same $fe prefix
        if (b2 === 0xfe) this.noteFrom(i, v.note, b1, 0, b3, true)
        v.volume = b3
        return step()
      case 15: // $210fce: the envelope
        v.envSpeed = b2
        v.envStep = b1
        v.envCount = b2
        v.envTarget = b3
        return step()
      case 17: // $210cec: walk the sample begin, and the AM source with it
        v.addBeginCount = b1
        v.addBeginReload = b1
        v.addBeginStep = (b23 << 16) >> 16
        v.begin = (v.begin + v.addBeginStep) | 0
        if (v.amCount !== 0) v.amSrc = v.begin
        return step()
      case 18: // $210d1e: and the length, which is the AM's mask when it runs
        v.len = (v.len + ((b23 << 16) >> 16)) & 0xffff
        if (v.amCount !== 0) v.amMask = v.len
        return step()
      case 20: // $21100a: loop until the key comes up
        if (!v.keyOn) return step()
        if (v.loop === 0) {
          v.loop = 0xff
          return step()
        }
        if (v.loop === 0xff) v.loop = (b3 - 1) & 0xff
        else v.loop--
        return this.macro(i, 19)
      case 24: // $211084: the loop half of a sample
        v.begin = (v.begin + this.cmd) | 0
        v.len = (v.len - ((this.cmd >>> 1) & 0xffff)) & 0xffff
        return step()
      case 25: // $2110a4: one word of silence, which is how a note ends
        v.addBeginCount = 0
        v.begin = 0
        v.len = 1
        return step()
      case 26: // $210d82: how long the key stays down, then stop reading
        v.keyDown = b23
        v.live = false
        v.pendingOff = true
        return this.macro(i, 19)
      case 27: // $210e18: start the arpeggio beside this macro
        v.arpMacro = b1
        v.arpSpeed = b2
        v.arpFlags = b3
        v.arpCount = 1
        v.arpEnable = 1
        v.arpKeyed = 1
        this.runArpeggio(i)
        return step()
      case 28: // $210dec: skip unless the note is at least b1
        if (b1 >= v.note) return step()
        v.pc = b23
        return true
      case 29: // $210e02: skip unless the volume is at least b1
        if (b1 >= v.volume) return step()
        v.pc = b23
        return true
      case 30: // $210e38: the mask the random arpeggio takes
        v.arpMask = b1
        return step()
      case 32: // $2110c6: one of the four signal words
        this.signals[b1 & 3] = (b23 << 16) >> 16
        return step()
      case 33: // $210ef2: play the note this voice already has, again
        this.noteCommand(
          ((((v.note & 0xff) << 24) >>> 0) | (((v.velocity << 4) | (b2 & 0xf)) << 8) | b3) >>> 0,
        )
        return step()
      case 34: // $2110de: where the AM reads from, and where the voice plays
        v.addBeginCount = 0
        v.amSrc = this.cmd
        v.begin = this.cmd
        v.playFrom = v.offset
        return step()
      case 35: // $211104: how long the AM buffer is, and how much of it to fill
        v.len = ((b1 === 0 ? 0x100 : b1) >> 1) & 0xffff
        v.amCount = (b1 - 1) & 0xff
        v.amMask = b23
        return step()
      case 36: // $211136: where in the source the window starts, times 256
        v.amAcc = ((this.cmd << 8) & 0xffffffff) >>> 0
        return step()
      case 38: // $211148: how far the read moves between one byte and the next
        v.amStep = this.cmd
        return step()
      case 37: // $211156: how fast the window itself slides, and when it turns
        v.amAccCount = b1
        v.amAccReload = b1
        v.amAccStep = (b23 << 16) >> 16
        return step()
      case 39: // $211170: the same sweep, applied to the per-byte step
        v.amStepCount = b1
        v.amStepReload = b1
        v.amStepStep = (b23 << 16) >> 16
        return step()
      case 40: // $21118a: the slew limit, and the sweep that opens and shuts it
        v.amSlew = b3
        v.amSlewStep = (((b2 << 24) >> 24) << 4) & 0xffff
        v.amSlewCount = b1
        v.amSlewReload = b1
        return step()
      case 41: // $2111b0: forget the AM, and b1 decides how much of it
        v.pc++
        v.amCount = 0
        if (b1 === 0) return true
        v.amAcc = 0
        v.amAccCount = 0
        v.amAccReload = 0
        v.amAccStep = 0
        v.amStep = 0
        v.amStepCount = 0
        v.amStepReload = 0
        v.amStepStep = 0
        v.amSlew = 0
        v.amSlewCount = 0
        v.amSlewReload = 0
        v.amSlewStep = 0
        return true
      default:
        return step()
    }
  }

  /**
   * $210f28: the note-to-period arithmetic the three note macros share.
   *
   * The detune at `$a(a5)` and the command's own word are added together and
   * used as an 8.8 multiplier over $100, so zero is unity and the table entry
   * passes through untouched. A note that lands on zero after the mask keeps
   * whatever period the voice had.
   */
  private noteFrom(i: number, base: number, add: number, hi: number, lo: number, quiet = false): boolean {
    const v = this.voices[i]!
    const n = (add + base) & 0x3f
    let period = TFMX_PERIODS[n]!
    const mul = (v.detune + ((((hi << 8) | lo) << 16) >> 16)) & 0xffff
    if (mul !== 0) period = ((period * ((mul + 0x100) & 0xffff)) >>> 8) & 0xffff
    v.period = period
    if (v.portaRate === 0) v.outPeriod = period
    if (!quiet) v.pc++
    return true
  }

  // ---- the per-voice tick ------------------------------------------------

  /**
   * $2111f4: what happens to a voice on every interrupt, macro or no macro.
   *
   * The order is the library's and nothing here reorders it: the sample walk,
   * the AM, the vibrato, the portamento, the envelope, then the arpeggio.
   * `$1(a5)` gates the lot, and it is the byte the DMA-on command set --- a
   * voice whose macro has not turned DMA on yet does none of this.
   */
  private voiceTick(i: number): void {
    const v = this.voices[i]!
    if (v.started === 0) {
      v.started = 1
      return
    }
    // $211206: the sample begin walks, and turns round when the count runs out
    if (v.addBeginCount !== 0) {
      v.begin = (v.begin + v.addBeginStep) | 0
      if (v.amCount !== 0) v.amSrc = v.begin
      if (((--v.addBeginCount) & 0xff) === 0) {
        v.addBeginCount = v.addBeginReload
        v.addBeginStep = -v.addBeginStep
      }
    }
    if (v.amCount !== 0) this.runAm(v)
    // $2112f8: the vibrato, whose counter is half its length so it turns twice
    if (v.amCount === 0 && v.vibLen !== 0) {
      v.vibAcc = (v.vibAcc + ((v.vibStep << 24) >> 24)) & 0xffff
      let period = v.period
      const acc = (v.vibAcc << 16) >> 16
      if (acc !== 0) period = (((period & 0xffff) * ((acc + 0x800) & 0xffff)) << 5) >>> 16
      if (v.portaRate === 0) v.outPeriod = period & 0xffff
      if (((--v.vibHalf) & 0xff) === 0) {
        v.vibHalf = v.vibLen
        v.vibStep = (-((v.vibStep << 24) >> 24)) & 0xff
      }
    }
    // $211342: the portamento, which multiplies rather than adds
    if (v.portaRate !== 0 && ((--v.portaCount) & 0xff) === 0) {
      v.portaCount = v.portaSpeed
      const want = v.period
      let at = v.portaAt & 0xffff
      if (at === want) {
        v.portaRate = 0
        at = want
      } else if (at > want) {
        const d2 = (0x100 - v.portaRate) & 0xffff
        at = ((at * d2) >>> 8) & 0xffff
        if (at <= want) {
          v.portaRate = 0
          at = want
        }
      } else {
        const d2 = (v.portaRate + 0x100) & 0xffff
        at = ((at * d2) >>> 8) & 0xffff
        if (at >= want) {
          v.portaRate = 0
          at = want
        }
      }
      v.portaAt = at & 0x7ff
      v.outPeriod = v.portaAt
    }
    // $2113a0: the envelope, which walks the volume towards its target
    if (v.envSpeed !== 0) {
      if (v.envCount !== 0) v.envCount--
      else {
        v.envCount = v.envSpeed
        const target = v.envTarget
        if (target > v.volume) {
          v.volume = (v.volume + v.envStep) & 0xff
          if (v.volume >= target) {
            v.volume = target
            v.envSpeed = 0
          }
        } else {
          v.volume = (v.volume - v.envStep) & 0xff
          if (v.volume <= target || v.volume > 0x80) {
            v.volume = target
            v.envSpeed = 0
          }
        }
      }
    }
    if (v.arpEnable !== 0) this.runArpeggio(i)
    if (v.keyDown !== 0 && --v.keyDown === 0) v.keyOn = false
  }

  /**
   * $211240: the AM, which rewrites the bytes the voice is playing.
   *
   * This is the one place a replayer here writes into a sample bank, and it is
   * the whole of TFMX's synthesis: a window of the source is copied into the
   * buffer the voice is looping, `$76(a5)` limits how far one byte may move
   * from the last, and three sweeps walk the window, the step and the limit.
   * Sweeping the limit sweeps a filter.
   *
   * The slew's running value is written to `$43(a5)` at $2112a0 and read from
   * `$00000043` at $211262 --- `12 39 00 00 00 43` is an absolute long, not a
   * displacement. So every voice writes its own and every voice reads one byte
   * of the 68000's exception vector table, which is inside vector 16 and holds
   * whatever the ROM left there. The per-voice field is dead.
   *
   * DEVIATION: this port has no vector table for it to read, so the seed is
   * the constant `TFMX_SLEW_SEED`. Reproducing the read would mean modelling
   * low chip RAM for one byte, and the byte is not a decision the library made
   * --- it is one it lost.
   */
  private runAm(v: TfmxVoice): void {
    const src = v.amSrc
    const dst = this.amBase + v.offset
    let acc = v.amAcc >>> 0
    const step = v.amStep >>> 0
    const mask = v.amMask & 0xffff
    const slew = v.amSlew & 0xff
    // $211262 reads the previous byte from address $43 and not from the voice
    let last = TFMX_SLEW_SEED
    let carry = 0
    for (let k = 0; k <= (v.amCount & 0xffff); k++) {
      acc = (acc + step) >>> 0
      // $21126a: the index is carried in the OTHER half of a register that is
      // swapped either side of the add, so it feeds back into itself
      carry = ((((carry << 16) | (carry >>> 16)) >>> 0) + acc) >>> 0
      carry = (((carry << 16) | (carry >>> 16)) >>> 0) & 0xffffffff
      carry = (((carry & 0xffff0000) >>> 0) | ((carry & 0xffff) & mask)) >>> 0
      const s = this.smpl[src + (carry & 0xffff)] ?? 0
      if (slew !== 0) {
        if (s > last) last = Math.min(s, last + slew)
        else if (s < last) last = Math.max(s, last - slew)
        else last = s
      } else last = s
      const at = dst + k
      if (at >= 0 && at < this.smpl.length) this.smpl[at] = (last << 24) >> 24
    }
    v.amLast = last
    // $2112a4: the three sweeps, each with its own counter and each negating
    if (slew !== 0) {
      v.amSlew = (v.amSlew + v.amSlewStep) & 0xffff
      if (((--v.amSlewCount) & 0xffff) === 0) {
        v.amSlewCount = v.amSlewReload
        v.amSlewStep = (-v.amSlewStep) & 0xffff
      }
    }
    v.amAcc = (v.amAcc + ((v.amAccStep << 16) >> 16)) >>> 0
    if (((--v.amAccCount) & 0xffff) === 0) {
      v.amAccCount = v.amAccReload
      if (v.amAccReload !== 0) v.amAccStep = (-v.amAccStep) & 0xffff
    }
    v.amStep = (v.amStep + ((v.amStepStep << 16) >> 16)) >>> 0
    if (((--v.amStepCount) & 0xffff) === 0) {
      v.amStepCount = v.amStepReload
      if (v.amStepReload !== 0) v.amStepStep = (-v.amStepStep) & 0xffff
    }
  }

  /**
   * $211404: the arpeggio, a second macro pointer running beside the first.
   *
   * A byte of the table is added to the note and looked up in the period
   * table, and a zero that is not the first entry sends the pointer back to
   * the top. Bit 0 of the flags makes it a RANDOM arpeggio instead: $2115da
   * stirs a word with `$dff006`, the raster position, and the low byte of that
   * masked by `$37(a5)` becomes the next index.
   *
   * DEVIATION: this port has no raster to read at this layer, so the stir uses
   * the tick count in its place. The sequence is therefore deterministic where
   * the machine's is not, which is the right way round for a test.
   */
  private runArpeggio(i: number): void {
    const v = this.voices[i]!
    if (v.arpEnable === 1) {
      v.arpTable = this.l(this.macros + (v.arpMacro & 0x7f) * 4)
      v.arpPc = 0
      v.arpEnable = 0xff
      if ((v.arpFlags & 1) !== 0) this.pickRandom(v)
    }
    if (((--v.arpCount) & 0xff) !== 0) return
    v.arpCount = v.arpSpeed
    for (let guard = 0; guard < 4; guard++) {
      const n = this.b(v.arpTable + v.arpPc)
      if (n === 0) {
        if (v.arpPc === 0) return
        v.arpPc = 0
        continue
      }
      const note = (n + v.note) & 0x3f
      if (note === 0) return this.pickRandom(v)
      let period = TFMX_PERIODS[note]!
      if (v.detune !== 0) period = ((period * ((v.detune + 0x100) & 0xffff)) >>> 8) & 0xffff
      if ((v.arpFlags & 1) === 0) {
        v.period = period
        if (v.portaRate === 0) v.outPeriod = period
        if ((n & 0x80) !== 0) v.arpKeyed = 0
        v.arpPc++
        return
      }
      // $2114c2: the random arm, which only takes the note some of the time
      this.stir()
      const take = (v.arpFlags & 4) !== 0 || (v.arpPc & 3) !== 0 || (this.rnd & 0xff) > 0x10
      if (take) {
        if ((n & 0x80) !== 0) v.arpKeyed = 0
        v.period = period
        if (v.portaRate === 0) v.outPeriod = period
      }
      v.arpPc++
      if ((n & 0x40) === 0) return
      this.stir()
      if ((this.rnd & 0xff) >= 6) return
      this.pickRandom(v)
      return
    }
  }

  /** $21151c: the random arpeggio's next index, masked by `$37(a5)` */
  private pickRandom(v: TfmxVoice): void {
    this.stir()
    v.arpPc = (this.rnd & 0xff) & v.arpMask
  }

  /** $2115da, with the tick count where the raster position was */
  private stir(): void {
    this.rnd = (this.rnd ^ this.ticks) & 0xffff
    this.rnd = (this.rnd + 0x4335) & 0xffff
  }

  // ---- what reaches Paula ------------------------------------------------

  /** $2115ba: the master volume, and bit 6 of it means "already scaled" */
  private scaled(v: TfmxVoice): number {
    const m = this.master & 0xff
    if ((m & 0x40) !== 0) return clampVolume(v.volume & 0x7f)
    return clampVolume((((v.volume & 0xff) * 4 * m) >>> 8) & 0xff)
  }

  private writeVoice(i: number): void {
    const v = this.voices[i]!
    const audio = this.sink()
    if (!audio) return
    if (v.pendingOn) {
      v.pendingOn = false
      this.startVoice(i)
    }
    if (!v.sounding) return
    const period = v.outPeriod & 0x7ff
    if (period !== v.sentPeriod && period > 0) {
      v.sentPeriod = period
      audio.setFrequency(i, periodToHz(period))
    }
    const vol = this.scaled(v)
    if (vol !== v.sentVolume) {
      v.sentVolume = vol
      audio.setVolume(i, vol)
    }
    // $211590: the fade steps the master by one every `$33(a6)` interrupts
    if (this.fadeDir !== 0 && --this.fadeCount === 0) {
      this.fadeCount = this.fadeReload
      this.master = (this.master + this.fadeDir) & 0xff
      if (this.master === this.fadeTo) this.fadeDir = 0
    }
  }

  /** the DMA the macro asked for, as a buffer rather than as a register */
  private startVoice(i: number): void {
    const v = this.voices[i]!
    const audio = this.sink()
    if (!audio) return
    const bytes = (v.len & 0xffff) * 2
    if (bytes <= 0 || v.begin >= this.smpl.length) {
      this.voiceOff(i)
      return
    }
    // the whole bank from the begin point, so a later relatch inside it can be
    // a loop write rather than a restart. Paula latches AUDxLC and AUDxLEN at
    // the end of a pass, which is exactly what `sampleloop` is written for.
    const pcm = this.smpl.subarray(v.begin, Math.min(this.smpl.length, v.begin + bytes))
    v.sentBegin = v.begin
    v.sounding = true
    v.sentPeriod = v.outPeriod & 0x7ff
    v.sentVolume = this.scaled(v)
    audio.play(i, pcm, periodToHz(v.sentPeriod || 1), v.sentVolume, 0, pcm.length)
  }

  private voiceOff(i: number): void {
    const v = this.voices[i]!
    v.pendingOff = false
    v.sounding = false
    v.sentPeriod = -1
    v.sentVolume = -1
    this.sink()?.stop(i)
  }

  private voiceOffSlot(slot: number): void {
    this.voiceOff(slot % TFMX_VOICES)
  }

  /** $2118f6: everything down, which is what a start and a stop both do */
  private allOff(): void {
    for (let i = 0; i < TFMX_VOICES; i++) {
      const v = this.voices[i]!
      v.live = false
      v.macro = 0
      v.amCount = 0
      v.arpEnable = 0
      this.voiceOff(i)
    }
  }
}
