/**
 * ScreamTracker 3's replay, off `DME_ScreamTracker.library` at $210000.
 *
 * The sequencer walks 32 channel blocks of $38 bytes from `$110(a5)` and
 * drives the 32 voice blocks of $1c bytes from `$810(a5)` that `s3mmix.ts`
 * mixes. `a5` is $2126e8 throughout, and every offset below is against one of
 * those three.
 *
 * ## The tick
 *
 * $2118c2 bumps `$b4(a5)` and compares it against the speed at `$b0(a5)`. Equal
 * means a new row: $21191a clears the counter, unpacks the row in place, runs
 * one handler per channel out of the table at $211cc2, and then advances.
 * Anything else runs the tick table at $211cf8. So `$b4` is zero on the row
 * itself, which is the test twelve handlers make.
 *
 * ## Two dispatch tables, and three commands that do not work
 *
 * Both tables are 27 words of self-relative displacement indexed by the
 * command, 1..26 for A..Z, and both send everything unlisted to the `rts` at
 * $211d2e. Neither table lists I or R, so TREMOR AND TREMOLO DO NOTHING. The
 * hooks for them are still in the row pass: $211b74 skips the volume write for
 * exactly those two commands, which is what you would do if their handlers
 * wrote it themselves. They do not exist, so the volume simply freezes.
 *
 * VIBRATO READS THE WRONG BYTE. $211f5c is `move.b $3(a2),d0`, and
 * `$3(a2)` is the COMMAND, not the parameter at `$4(a2)`. So H always sees 8:
 * depth 8, speed 0, and a speed of zero never advances the phase, so `H`
 * bends nothing at all. `U` sees $15, which gives it a fixed speed of 1 and
 * depth of 5 whatever the module asks for, and `K` skips the fetch entirely
 * and reuses whatever those two left behind. The instruction is
 * `10 2a 00 03` at $211f5c and `10 2a 00 03` at $211fc8, checked against the
 * bytes rather than the mnemonic, because reading a struct field one offset
 * short is exactly the kind of thing that survives a port.
 *
 * ## What the parameter memory is
 *
 * $211b9c copies a non-zero parameter into `$11(a2)` before dispatch, and D, E
 * and F read it rather than the cell. G keeps its own at `$14(a2)` and the two
 * vibratos theirs at `$21(a2)`, so a row with no parameter continues the last
 * slide of the same kind.
 *
 * ## The order advance
 *
 * $211bd2. A pending break moves the row and $211bf6 steps the order past any
 * $fe or $ff marker. Wrapping past the last order sets `$72(a5)`, which is
 * what an end-of-song keyword reads, and puts the speed back to the module's.
 * An order naming a pattern the module does not have leaves the row pointer
 * null and plays 64 empty rows rather than failing.
 */
import type { S3mCell, S3mSample, S3mSong } from './s3m'
import { S3M_CHANNELS, S3M_DEFAULT_SPEED, S3M_ROWS } from './s3m'
import type { AudioSink } from './host'
import {
  S3M_C2SPD,
  S3M_MIX_RATE,
  S3M_NOTE_PERIODS,
  s3mBoost,
  s3mLevel,
  s3mLevelTable,
  s3mMix,
  s3mPeriod,
  s3mSamplesPerTick,
  s3mSides,
  s3mVoice,
  s3mVolumeTable,
  type S3mLevels,
  type S3mVoice,
} from './s3mmix'

/** `$fe` in a cell's note: stop the voice */
export const S3M_NOTE_OFF = 0xfe
/** `$ff`: no note, which the packed stream still spends a byte on */
export const S3M_NOTE_NONE = 0xff
/** `$3f`, and one short of the volume table's 65 rows ($211a5a, $211b4a) */
export const S3M_MAX_VOLUME = 0x3f
/** `moveq #$40,d0` at $2123c8, and `move.w #$40,$c6(a5)` at $21187c */
export const S3M_MAX_GLOBAL = 0x40
/** `cmpi.b #$8,$1e(a2)` at $211c9c: ticks at zero volume before a voice stops */
export const S3M_QUIET_TICKS = 8

/** the commands, as the two dispatch tables index them */
export const S3M_CMD = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 10, K: 11, L: 12, M: 13,
  N: 14, O: 15, P: 16, Q: 17, R: 18, S: 19, T: 20, U: 21, V: 22, W: 23, X: 24, Y: 25, Z: 26,
} as const

/**
 * The 32 bytes at $21240a, indexed by `$22(a2) & $1f` with bit 5 for the sign.
 *
 * `trunc(255 * sin(pi * i / 32))`, exact for all 32, so it is generated. The
 * test pins every byte against the library.
 */
export function s3mSine(): Uint8Array {
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = Math.trunc(255 * Math.sin((Math.PI * i) / 32))
  return out
}

/**
 * `$2123ea`: what Qxy adds to the volume, by the parameter's high nibble.
 *
 * Sixteen signed bytes, and the six that are zero are the slots the multiply
 * table at $2123fa fills instead.
 */
export const S3M_RETRIG_ADD = Int8Array.of(0, -1, -2, -4, -8, -16, 0, 0, 0, 1, 2, 4, 8, 16, 0, 0)
/** `$2123fa`: what Qxy multiplies the volume by, in sixteenths */
export const S3M_RETRIG_MUL = Uint8Array.of(0, 0, 0, 0, 0, 0, 10, 8, 0, 0, 0, 0, 0, 0, 24, 32)
/** `$211dc4`: Cxy's row is its nibbles read as decimal, so $10 is row ten */
export const S3M_BREAK_TENS = Uint8Array.of(0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150)

/** one of the 32 blocks at `$110(a5)`, $38 bytes each */
export interface S3mChannel {
  /** `$00`..`$04`, the cell as the unpack left it */
  note: number
  instrument: number
  cellVolume: number
  command: number
  param: number
  /** `$05`: $20 a note and instrument, $40 a volume, $80 a command */
  flags: number
  /** `$06`: which instrument is loaded, or -1 */
  sample: number
  /** `$0c`: the channel's period, which the slides move */
  period: number
  /** `$0e`: the volume, 0..$3f */
  volume: number
  /** `$10`: the note this channel last triggered, which J arpeggiates around */
  lastNote: number
  /** `$11`: the shared parameter memory */
  memory: number
  /** `$12`: G's target period, and zero once it is reached */
  target: number
  /** `$14`: G's own speed memory */
  portaSpeed: number
  /** `$1e`: consecutive ticks at zero volume */
  quiet: number
  /** `$20`: Q's countdown */
  retrig: number
  /** `$21`: the vibrato parameter, and `$22` its phase with bit 5 the sign */
  vibParam: number
  vibPos: number
}

function newChannel(): S3mChannel {
  return {
    note: 0, instrument: 0, cellVolume: -1, command: 0, param: 0, flags: 0,
    sample: -1, period: 0, volume: 0, lastNote: 0, memory: 0, target: 0,
    portaSpeed: 0, quiet: 0, retrig: 0, vibParam: 0, vibPos: 0,
  }
}

const u8 = (v: number): number => v & 0xff
const s8 = (v: number): number => (v << 24) >> 24
const w = (v: number): number => (v << 16) >> 16

export class S3mPlayer {
  song: S3mSong | null = null
  readonly channels: S3mChannel[] = [...Array(S3M_CHANNELS)].map(newChannel)
  readonly voices: S3mVoice[] = [...Array(S3M_CHANNELS)].map(() => s3mVoice())

  /** `$b0(a5)` and `$b4(a5)` */
  speed = S3M_DEFAULT_SPEED
  tick = 0
  /** `$a4(a5)`, `$a6(a5)`, `$a8(a5)` */
  row = 0
  pendingRow = 0
  breaking = false
  /** `$c8(a5)` */
  order = 0
  /** `$c6(a5)` at $2127ae, and `$78(a5)` */
  globalVolume = S3M_MAX_GLOBAL
  master = S3M_MAX_GLOBAL
  /** `$72(a5)`: set when the order list wraps, which is what `S3m End` reads */
  ended = false
  playing = false
  /** `$4c(a5)`, and `T` rewrites it */
  samplesPerTick = s3mSamplesPerTick(S3M_MIX_RATE, 125)
  /** `$aa(a5)`, `$ac(a5)`, `$ae(a5)`: SBx's counter, flag and row */
  private loopCount = 0
  private loopActive = false
  private loopRow = 0
  /** the packed row cursor `$cc(a5)`, as a pattern and a row rather than a pointer */
  private pattern: S3mCell[][] | null = null

  private readonly sine = s3mSine()
  private volumes = s3mVolumeTable(true)
  private levels: S3mLevels = s3mLevelTable(2, 0)
  private pan: Uint8Array = new Uint8Array(S3M_CHANNELS)
  private last = 1
  /** the two accumulators and the bytes they become */
  private accLeft = new Uint16Array(0)
  private accRight = new Uint16Array(0)
  private outLeft = new Int8Array(0)
  private outRight = new Int8Array(0)

  constructor(private readonly sinkOf: () => AudioSink | undefined) {}

  private get sink(): AudioSink | undefined {
    return this.sinkOf()
  }

  /** $211836 and $21090c: the counters cleared and the module's own speed taken */
  load(song: S3mSong): void {
    this.song = song
    const sides = s3mSides(song.settings)
    this.pan = sides.pan
    this.last = sides.last
    this.levels = s3mLevelTable(sides.channels, s3mBoost(sides.last))
    this.volumes = s3mVolumeTable(true)
    this.speed = song.speed
    this.tick = 0
    this.row = 0
    this.pendingRow = 0
    this.breaking = false
    this.order = 0
    this.globalVolume = Math.min(S3M_MAX_GLOBAL, song.globalVolume)
    this.ended = false
    this.playing = true
    this.loopCount = 0
    this.loopActive = false
    this.loopRow = 0
    this.samplesPerTick = s3mSamplesPerTick(S3M_MIX_RATE, song.tempo)
    for (let c = 0; c < S3M_CHANNELS; c++) {
      this.channels[c] = newChannel()
      this.voices[c] = s3mVoice()
    }
    this.pattern = this.patternFor(this.order)
    this.resize()
    for (let v = 0; v < 4; v++) this.sink?.stop(v)
  }

  stop(): void {
    this.playing = false
    for (let v = 0; v < 4; v++) this.sink?.stop(v)
  }

  private resize(): void {
    const n = this.samplesPerTick
    if (this.accLeft.length === n) return
    this.accLeft = new Uint16Array(n)
    this.accRight = new Uint16Array(n)
    this.outLeft = new Int8Array(n)
    this.outRight = new Int8Array(n)
  }

  /** `$211c20`: $fe and $ff are markers the order walk steps straight over */
  private patternFor(order: number): S3mCell[][] | null {
    const song = this.song
    if (!song) return null
    const n = song.orders[order] ?? 0xff
    if (n >= song.patterns.length) return null
    return song.patterns[n] ?? null
  }

  private sampleOf(ch: S3mChannel): S3mSample | null {
    return ch.sample >= 0 ? (this.song?.samples[ch.sample] ?? null) : null
  }

  // ---------------------------------------------------------------- the row

  /** $21191a: the cell into the channel block, then one handler each */
  private doRow(): void {
    const song = this.song
    if (!song) return
    this.tick = 0
    const cells = this.pattern?.[this.row] ?? null
    for (let c = 0; c < S3M_CHANNELS; c++) {
      const ch = this.channels[c]!
      ch.flags = 0
      const cell = cells?.[c]
      if (!cell) continue
      if (cell.note !== 0 || cell.instrument !== 0) {
        ch.flags |= 0x20
        ch.note = cell.note
        ch.instrument = cell.instrument
      }
      if (cell.volume >= 0) {
        ch.flags |= 0x40
        ch.cellVolume = cell.volume
      }
      // $211978 drops a command byte with bit 7 set and keeps its parameter
      if (cell.command !== 0 || cell.param !== 0) {
        ch.flags |= 0x80
        if ((cell.command & 0x80) === 0) ch.command = cell.command
        ch.param = cell.param
      }
    }

    for (let c = 0; c < this.last; c++) this.rowChannel(this.channels[c]!, this.voices[c]!)
    this.advance()
    this.quietCheck()
  }

  /** $21199c, one channel */
  private rowChannel(ch: S3mChannel, v: S3mVoice): void {
    const song = this.song
    if (!song || ch.flags === 0) return

    if (ch.flags & 0x20) {
      const n = ch.instrument
      if (n > 0 && n < 0x80) {
        if (n > song.samples.length) {
          // $211a80: an instrument the module does not have stops the voice
          v.ended = true
          return
        }
        // $2119cc: SDx defers the whole load to the tick it names
        const delayed = (ch.flags & 0x80) !== 0 && ch.command === S3M_CMD.S && (ch.param & 0xf0) === 0xd0
        if (!delayed) this.loadInstrument(ch, v, n - 1)
      }
      this.trigger(ch, v)
    }

    // $211b3c: the volume column, clamped the same way
    if (ch.flags & 0x40) ch.volume = Math.min(S3M_MAX_VOLUME, ch.cellVolume)

    // $211b58: every channel gets the period clamp except a vibrato
    if (!((ch.flags & 0x80) !== 0 && ch.command === S3M_CMD.H)) this.clampPeriod(ch, v)

    // $211b6c: I and R are skipped here because their handlers were meant to
    // write the volume themselves, and neither handler was ever written
    const frozen = (ch.flags & 0x80) !== 0 && (ch.command === S3M_CMD.R || ch.command === S3M_CMD.I)
    if (!frozen) v.volume = (ch.volume * this.globalVolume) >> 6

    if (ch.flags & 0x80) {
      if (ch.param !== 0) ch.memory = ch.param
      this.rowEffect(ch, v)
    }
  }

  /** $2119e4: the instrument's pointers into the voice, and its volume */
  private loadInstrument(ch: S3mChannel, v: S3mVoice, index: number): void {
    const s = this.song?.samples[index]
    if (!s) return
    ch.sample = index
    v.loopAt = s.loopStart
    v.loopLength = s.loopEnd - s.loopStart
    // $211a5a: $f(a2) is the low byte of the volume word, so this IS the volume
    ch.volume = Math.min(S3M_MAX_VOLUME, s.volume)
    // $211a6c: a looping sample loops only when its loop is longer than two
    v.loops = s.loops && v.loopLength > 2
  }

  /** $211a8c: the note, and what a note does not do when a portamento wants it */
  private trigger(ch: S3mChannel, v: S3mVoice): void {
    const note = u8(ch.note)
    if (note === 0 || note === S3M_NOTE_NONE) return
    if (note === S3M_NOTE_OFF) {
      v.ended = true
      return
    }
    ch.lastNote = note
    const s = this.sampleOf(ch)
    const period = s3mPeriod(note, s?.c2spd ?? S3M_C2SPD)

    // $211ad0: only Q keeps its retrigger counter across a note
    if (!((ch.flags & 0x80) !== 0 && ch.command === S3M_CMD.Q)) ch.retrig = 0
    ch.vibPos = 0

    // $211af0: G and L take the note as a target and leave the sample playing
    if ((ch.flags & 0x80) !== 0 && (ch.command === S3M_CMD.G || ch.command === S3M_CMD.L)) {
      ch.target = period
      return
    }
    ch.period = period
    v.period = period
    v.pos = 0
    if (s) {
      v.at = 0
      v.left = s.pcm.length
      v.ended = false
    }
  }

  /** $211ec4, and the two arms do not write back the same thing */
  private clampPeriod(ch: S3mChannel, v: S3mVoice): void {
    let d = ch.period
    if (this.amigaLimits) {
      if (d > 0xd60) d = 0xd60
      if (d < 0x1c4) d = 0x1c4
      ch.period = d
      v.period = d
      return
    }
    // the else arm writes only the voice, so the channel's own period keeps
    // drifting past the limit and comes back when the slide turns round
    if (d > 0x7fff) d = 0x7fff
    if (d < 0x40) d = 0x40
    v.period = d
  }

  /** `$a3(a5)` bit 4. No keyword sets it, so it is off for every module here */
  amigaLimits = false
  /** `$a3(a5)` bit 0: the shift a vibrato's depth takes, 4 when set and 5 when not */
  oldVibrato = false
  /** `$a3(a5)` bit 6: a volume slide that also runs on the row */
  fastSlides = false

  // ------------------------------------------------------------- the effects

  /** the table at $211cc2 */
  private rowEffect(ch: S3mChannel, v: S3mVoice): void {
    switch (ch.command) {
      case S3M_CMD.A: return this.cmdSpeed(ch)
      case S3M_CMD.B: return this.cmdJump(ch)
      case S3M_CMD.C: return this.cmdBreak(ch)
      case S3M_CMD.D: return this.cmdVolumeSlide(ch, v)
      case S3M_CMD.E: return this.cmdPortaDown(ch, v)
      case S3M_CMD.F: return this.cmdPortaUp(ch, v)
      case S3M_CMD.J: return this.cmdArpeggio(ch, v)
      case S3M_CMD.O: return this.cmdOffset(ch, v)
      case S3M_CMD.Q: return this.cmdRetrig(ch, v)
      case S3M_CMD.S: return this.cmdSpecial(ch, v)
      case S3M_CMD.T: return this.cmdTempo(ch)
      case S3M_CMD.V: return this.cmdGlobal(ch)
      default: return
    }
  }

  /** the table at $211cf8 */
  private tickEffect(ch: S3mChannel, v: S3mVoice): void {
    switch (ch.command) {
      case S3M_CMD.D: return this.cmdVolumeSlide(ch, v)
      case S3M_CMD.E: return this.cmdPortaDown(ch, v)
      case S3M_CMD.F: return this.cmdPortaUp(ch, v)
      case S3M_CMD.G: return this.cmdTonePorta(ch, v, true)
      case S3M_CMD.H: return this.cmdVibrato(ch, v, true)
      case S3M_CMD.J: return this.cmdArpeggio(ch, v)
      case S3M_CMD.K: {
        this.vibratoStep(ch, v)
        return this.cmdVolumeSlide(ch, v)
      }
      case S3M_CMD.L: {
        this.tonePortaStep(ch, v)
        return this.cmdVolumeSlide(ch, v)
      }
      case S3M_CMD.Q: return this.cmdRetrig(ch, v)
      case S3M_CMD.S: return this.cmdSpecial(ch, v)
      case S3M_CMD.U: return this.cmdVibrato(ch, v, false)
      default: return
    }
  }

  /** A, $211d30: a parameter of zero is an end of song rather than a speed */
  private cmdSpeed(ch: S3mChannel): void {
    if (ch.param === 0) {
      this.ended = true
      return
    }
    // `move.b` into the low byte of the speed word
    this.speed = (this.speed & 0xff00) | ch.param
  }

  /**
   * B, $211d4e.
   *
   * A BACKWARD JUMP DOES NOT GO WHERE IT IS TOLD. $211d7e takes the
   * branch only when the target is above the current order; otherwise
   * $211d86's `moveq #$0,d0` throws the target away and the song restarts
   * from order zero. So `B00` in the middle of a module restarts it, and so
   * does every other backward `Bxx`.
   */
  private cmdJump(ch: S3mChannel): void {
    this.pendingRow = 0
    this.breaking = true
    if (this.order + 1 === (this.song?.orders.length ?? 0)) this.ended = true
    let to = ch.param
    if (to <= this.order) {
      this.ended = true
      to = 0
    }
    this.order = w(to - 1)
  }

  /** C, $211d98: the nibbles are DECIMAL, and a row past 63 becomes row zero */
  private cmdBreak(ch: S3mChannel): void {
    const r = (ch.param & 0xf) + (S3M_BREAK_TENS[ch.param >> 4] ?? 0)
    this.pendingRow = s8(r) > S3M_MAX_VOLUME ? 0 : r
    this.breaking = true
  }

  /** D, $211dd4, and K and L end here too */
  private cmdVolumeSlide(ch: S3mChannel, v: S3mVoice): void {
    const p = ch.memory
    const lo = p & 0xf
    const hi = p >> 4
    const onRow = this.tick === 0
    let down = -1
    let up = -1

    if (lo === 0xf) {
      // $211e32: Dxf is a fine slide UP, and D0f a plain slide down
      if (hi === 0) down = lo
      else if (onRow) up = hi
    } else if (hi === 0xf) {
      // $211e0a: Dfx is a fine slide DOWN
      if (onRow) down = lo
    } else if (this.fastSlides || !onRow) {
      if (lo !== 0) down = lo
      else up = hi
    }

    if (down >= 0) {
      ch.volume -= down
      if (ch.volume < 0) ch.volume = 0
    } else if (up >= 0) {
      ch.volume += up
      if (ch.volume >= 0x40) ch.volume = S3M_MAX_VOLUME
    }
    v.volume = (ch.volume * this.globalVolume) >> 6
  }

  /** E, $211e54: the period grows, so the pitch falls */
  private cmdPortaDown(ch: S3mChannel, v: S3mVoice): void {
    const d = this.slideAmount(ch)
    if (d === null) return
    ch.period = w(ch.period + d)
    this.clampPeriod(ch, v)
  }

  /** F, $211e8c */
  private cmdPortaUp(ch: S3mChannel, v: S3mVoice): void {
    const d = this.slideAmount(ch)
    if (d === null) return
    ch.period = w(ch.period - d)
    this.clampPeriod(ch, v)
  }

  /**
   * The shared head of E and F: $e0 and above is fine, and only on the row.
   *
   * A coarse slide runs four times the parameter, an $Ex slide the low nibble,
   * and an $Fx slide four times it. Returning null is the `rts` that leaves
   * the period alone.
   */
  private slideAmount(ch: S3mChannel): number | null {
    const p = ch.memory
    if (this.tick !== 0) return p >= 0xe0 ? null : p << 2
    if (p <= 0xe0) return null
    return p > 0xf0 ? (p & 0xf) << 2 : p & 0xf
  }

  /** G, $211f0a: the parameter memory first, then the step */
  private cmdTonePorta(ch: S3mChannel, v: S3mVoice, takeParam: boolean): void {
    if (takeParam && ch.param !== 0) ch.portaSpeed = ch.param
    this.tonePortaStep(ch, v)
  }

  /** $211f14, which L reaches without the parameter fetch */
  private tonePortaStep(ch: S3mChannel, v: S3mVoice): void {
    const target = ch.target
    if (target === 0) {
      v.period = ch.period
      return
    }
    const d = ch.portaSpeed << 2
    if (target >= ch.period) {
      ch.period = w(ch.period + d)
      if (target <= ch.period) {
        ch.period = target
        ch.target = 0
      }
    } else {
      ch.period = w(ch.period - d)
      if (target >= ch.period) {
        ch.period = target
        ch.target = 0
      }
    }
    v.period = ch.period
  }

  /** H at $211f5c and U at $211fc8, which differ only in the shift */
  private cmdVibrato(ch: S3mChannel, v: S3mVoice, coarse: boolean): void {
    // $3(a2) is the command, so this is always 8 for H and $15 for U
    let d0 = ch.command
    if (d0 === 0) d0 = ch.vibParam
    else if ((d0 & 0xf0) === 0) d0 |= ch.vibParam & 0xf0
    ch.vibParam = u8(d0)
    this.vibratoStep(ch, v, coarse)
  }

  /** $211f7e and $211fea: the sine, the depth and the phase */
  private vibratoStep(ch: S3mChannel, v: S3mVoice, coarse = true): void {
    const depth = ch.vibParam & 0xf
    let d = ((this.sine[ch.vibPos & 0x1f] ?? 0) * depth) & 0xffff
    d >>= coarse ? (this.oldVibrato ? 4 : 5) : 7
    v.period = w(ch.vibPos & 0x20 ? ch.period - d : ch.period + d)
    ch.vibPos = u8(ch.vibPos + (ch.vibParam >> 4))
  }

  /** J, $212026: three ticks, three notes, and the octave carries */
  private cmdArpeggio(ch: S3mChannel, v: S3mVoice): void {
    const note = ch.lastNote
    if (note === 0) return
    let oct = note & 0x70
    let n = note & 0xf
    const phase = this.tick % 3
    if (phase !== 0) {
      const add = phase === 1 ? ch.memory >> 4 : ch.memory & 0xf
      n += add
      while (n >= 12) {
        n -= 12
        oct += 0x10
      }
    }
    const s = this.sampleOf(ch)
    const c2 = s?.c2spd ?? S3M_C2SPD
    if (c2 === 0) return
    const step = S3M_NOTE_PERIODS[n] ?? 0
    v.period = Math.trunc(((step * S3M_C2SPD * 16) >>> (oct >> 4)) / c2) & 0xffff
  }

  /** O, $2120b6: only with a note, and a start past the end falls into the loop */
  private cmdOffset(ch: S3mChannel, v: S3mVoice): void {
    if ((ch.flags & 0x20) === 0) return
    const note = u8(ch.note)
    if (note === 0 || note === S3M_NOTE_NONE) return
    const s = this.sampleOf(ch)
    if (!s) return
    const skip = ch.memory << 8
    const left = s.pcm.length - skip
    if (left >= 0) {
      v.at = skip
      v.left = left
    } else {
      v.at = v.loopAt
      v.left = v.loopLength
    }
  }

  /** Q, $212106: the countdown, the retrigger, and one of two volume tables */
  private cmdRetrig(ch: S3mChannel, v: S3mVoice): void {
    const next = s8(ch.retrig - 1)
    if (next > 0) {
      ch.retrig = next
      return
    }
    const s = this.sampleOf(ch)
    if (!s) return
    v.at = 0
    v.left = s.pcm.length
    v.ended = false
    v.pos = 0
    ch.retrig = ch.memory & 0xf
    const k = (ch.memory & 0xf0) >> 4
    const mul = S3M_RETRIG_MUL[k] ?? 0
    if (mul !== 0) ch.volume = ((ch.volume * mul) & 0xffff) >> 4
    else ch.volume = w(ch.volume + (S3M_RETRIG_ADD[k] ?? 0))
    if (ch.volume < 0) ch.volume = 0
    if (ch.volume >= 0x40) ch.volume = S3M_MAX_VOLUME
    v.volume = (ch.volume * this.globalVolume) >> 6
  }

  /** S, $2121aa: the only three of the sixteen sub-commands that exist */
  private cmdSpecial(ch: S3mChannel, v: S3mVoice): void {
    const kind = ch.param & 0xf0
    const n = ch.param & 0xf
    if (kind === 0xb0) return this.patternLoop(n)
    if (kind === 0xd0) return this.noteDelay(ch, v, n)
    if (kind !== 0xc0) return
    // SCx, a note cut on the tick it names
    if (n !== this.tick) return
    ch.volume = 0
    v.volume = 0
  }

  /** SBx, $2121de: the row is remembered on the row itself and nowhere else */
  private patternLoop(n: number): void {
    if (this.tick !== 0) return
    if (n === 0) {
      this.loopRow = this.row
      return
    }
    if (!this.loopActive) {
      this.loopCount = n
      this.loopActive = true
    } else {
      this.loopCount = w(this.loopCount - 1)
      if (this.loopCount === 0) {
        this.loopActive = false
        return
      }
    }
    this.pendingRow = this.loopRow
    this.order = w(this.order - 1)
    this.breaking = true
  }

  /** SDx, $212236: the note the row pass skipped, played on the tick it names */
  private noteDelay(ch: S3mChannel, v: S3mVoice, n: number): void {
    if (n !== this.tick) return
    if ((ch.flags & 0x20) === 0) return
    const i = ch.instrument
    if (i > 0 && i < 0x80 && i <= (this.song?.samples.length ?? 0)) this.loadInstrument(ch, v, i - 1)
    this.trigger(ch, v)
    v.volume = (ch.volume * this.globalVolume) >> 6
  }

  /** T, $212392: 32 or less is not a tempo, and nothing else is stored */
  private cmdTempo(ch: S3mChannel): void {
    if (ch.param <= 0x20) return
    this.samplesPerTick = s3mSamplesPerTick(S3M_MIX_RATE, ch.param)
    this.resize()
  }

  /** V, $2123bc */
  private cmdGlobal(ch: S3mChannel): void {
    this.globalVolume = Math.min(S3M_MAX_GLOBAL, ch.param)
  }

  // -------------------------------------------------------------- the advance

  /** $211bd2 */
  private advance(): void {
    const song = this.song
    if (!song) return
    if (!this.breaking) {
      this.row++
      if (this.row < S3M_ROWS) return
    }
    this.breaking = false
    this.row = this.pendingRow
    this.pendingRow = 0

    for (;;) {
      this.order = w(this.order + 1)
      if (this.order >= song.orders.length || this.order < 0) {
        this.order = 0
        this.ended = true
        this.speed = song.speed
      }
      const n = song.orders[this.order] ?? 0xff
      if (n !== 0xfe && n !== 0xff) break
    }
    this.pattern = this.patternFor(this.order)
  }

  /** $211c96: a channel eight ticks into silence has its voice stopped */
  private quietCheck(): void {
    for (let c = 0; c < this.last; c++) {
      const ch = this.channels[c]!
      if (ch.volume !== 0) {
        ch.quiet = 0
        continue
      }
      if (ch.quiet < S3M_QUIET_TICKS) ch.quiet++
      else this.voices[c]!.ended = true
    }
  }

  // ------------------------------------------------------------------- output

  /** $2118c2: one tick of the sequencer and one buffer of mix */
  vbl(): void {
    if (!this.playing || !this.song) return
    this.tick++
    if (this.tick === this.speed) this.doRow()
    else {
      for (let c = 0; c < this.last; c++) {
        const ch = this.channels[c]!
        if (ch.flags & 0x80) this.tickEffect(ch, this.voices[c]!)
      }
    }
    this.render()
  }

  /** $21098a: the first sounding channel a side stores, the rest add */
  private render(): void {
    const song = this.song
    if (!song) return
    this.resize()
    const n = this.samplesPerTick
    for (const [side, acc, out] of [
      [1, this.accLeft, this.outLeft],
      [0xff, this.accRight, this.outRight],
    ] as [number, Uint16Array, Int8Array][]) {
      let sounded = 0
      let store = true
      for (let c = 0; c < S3M_CHANNELS; c++) {
        if (this.pan[c] !== side) continue
        const s = this.sampleOf(this.channels[c]!)
        const pcm: Uint8Array = s
          ? new Uint8Array(s.pcm.buffer as ArrayBuffer, s.pcm.byteOffset, s.pcm.length)
          : new Uint8Array(0)
        const ran = s3mMix(acc, n, this.voices[c]!, pcm, this.volumes, this.master, S3M_MIX_RATE, store)
        if (store) sounded = 1
        else if (ran) sounded++
        store = false
      }
      if (store) acc.fill(0x80, 0, n)
      s3mLevel(out, acc, n, this.levels, Math.max(1, sounded))
    }
    // left on voices 0 and 3, right on 1 and 2, which is how $210310 sets the
    // four up. One of each pair carries the stream and the other repeats it.
    this.sink?.play(0, this.outLeft, S3M_MIX_RATE, this.master, 0, this.samplesPerTick)
    this.sink?.play(1, this.outRight, S3M_MIX_RATE, this.master, 0, this.samplesPerTick)
  }
}
