/**
 * FastTracker 2's replay, off `DME_FastTracker.library` at $210000.
 *
 * The sequencer walks 32 channel blocks of $38 bytes from `$114(a5)` and drives
 * the 32 voice blocks of $1c bytes from `$814(a5)` that `xmmix.ts` mixes. `a5`
 * is $215600 throughout, and every offset below is against one of those three.
 * `s3mplay.ts` describes the same skeleton for ScreamTracker, six weeks older
 * and by the same author.
 *
 * ## The tick, and the pass that follows every tick
 *
 * $211b78 bumps `$b0(a5)` and compares it against the speed at `$ac(a5)`. Equal
 * means a new row at $211ddc; anything else runs the tick handlers. Either way
 * $211b74 has already pushed $211bf4 as the return address, so a THIRD pass
 * runs after both: the envelopes, the fadeout, the global volume, and the two
 * writes that hand the voice its period and its volume.
 *
 * That third pass is the most important thing in this file, because of what it
 * overwrites.
 *
 * ## Arpeggio, vibrato and tremolo do nothing
 *
 * Three handlers compute a result and store it straight into the voice:
 *
 *   $2123e4  arpeggio   `move.w d0,$10(a4)`   3940 0010
 *   $2124ec  vibrato    `move.w d0,$10(a4)`   3940 0010
 *   $212558  tremolo    `move.w d0,$12(a4)`   3940 0012
 *
 * and the pass at $211bf4 then rewrites both registers unconditionally:
 *
 *   $211d90  `move.w d0,$12(a4)`      3940 0012   the volume, off `$16(a2)`
 *   $211dc8  `move.w $18(a2),$10(a4)` 396a 0018 0010
 *
 * So the pitch bend and the tremolo are computed, stored, and thrown away
 * before Paula sees anything. The effects that DO work are the ones that write
 * the channel's own period at `$c(a2)` and mirror it into `$18(a2)` — the two
 * portamentos at $212432 and the tone portamento at $212466 — and the volume
 * slides, which write `$e(a2)` and `$16(a2)` at $21257e.
 *
 * The phases still advance. `$22(a2)` counts up by the vibrato speed every
 * tick whether or not anyone reads it, so a module that leans on vibrato plays
 * in tune and flat rather than falling apart. This port reproduces all of it:
 * the handlers run, the state moves, and the post-pass wins. The bytes above
 * were read rather than the mnemonics, because a store one register off is
 * exactly the kind of thing that survives a port.
 *
 * This is not the sibling library's bug. ScreamTracker's vibrato reads the
 * command byte instead of the parameter ($211f5c there); this one reads the
 * right byte, does the right arithmetic, and writes to a register with a two
 * hundred instruction lifetime.
 *
 * ## Vibrato and tremolo share one parameter and one phase
 *
 * `$21(a2)` is the speed in its high nibble and the depth in its low one, and
 * `$22(a2)` is the phase with the sign in bit 5. $21250a — tremolo — reads and
 * writes both of them, where FT2 keeps a second pair. A `4xy` followed by a
 * `7xy` therefore rewrites the vibrato's own settings. Since neither effect
 * reaches the mixer it changes nothing audible, but the state is shared and
 * this port shares it.
 *
 * The two differ in one number: $2124d8 shifts the vibrato product right five
 * and $212544 shifts the tremolo's right six.
 *
 * ## The volume column's `Ax` sets the depth, not the speed
 *
 * $212488 masks the parameter to four bits and ORs it into the LOW nibble of
 * `$21(a2)`, which is where the depth lives. FT2's `Ax` is "set vibrato
 * speed", and the speed is the high nibble at $2124f4. So `A4` and `B4` both
 * come out as a depth of four.
 *
 * ## The envelope interpolates a reciprocal
 *
 * $211cc0 is `muls.w d4,d1` where d1 is `position - previous.x` and d4 is
 * `next.x - previous.x`, and $211cc4 is `divs.w d1,d5` where d5 is
 * `(next.y - previous.y) << 8`. That computes
 *
 *   dy / (t * dx)     where it wanted     dy * t / dx
 *
 * so the value between two envelope points is a hyperbola falling away from
 * the first one instead of a ramp climbing to the second. The two agree at
 * `t = 1` and nowhere else: a 0 to 64 rise over sixteen ticks reads 1024 at
 * t = 1, which is right, and 128 at t = 8, where a ramp would give 8192.
 *
 * The NODES are exact. $211c7a takes a separate branch when the position lands
 * on a point and uses its y directly, so an envelope with a point per tick is
 * played correctly and one with long segments dips between them. Reproduced,
 * with the arithmetic in the order the two instructions do it.
 *
 * ## What the two dispatch tables do not list
 *
 * The tick table at $2137aa has 33 entries and the row table at $213762 has 32,
 * both indexed by the effect number, and both send everything they do not name
 * to the `rts` at $21229c:
 *
 *   on a row    B C D E F G K L R T, and T's entry IS the rts
 *   on a tick   0 1 2 3 4 5 6 7 A E H R T, and T's entry IS the rts
 *
 * So TREMOR DOES NOTHING, on either pass, the way it does nothing in
 * ScreamTracker. `P`, the panning slide, is in neither table. `X`, extra fine
 * portamento, is effect 33 and both tables stop below it — $212120 is
 * `cmp.b #$20,d0 / bcc` and $211bc4 is `cmp.b #$20,d0 / bhi`, which is also why
 * the two tables are a different length.
 *
 * The E table at $2137f2 leaves out E3 glissando, E4 vibrato waveform and E5
 * set finetune. E1 and E2 route into the SAME handlers as the full-width
 * portamentos at $2123ea and $2123f2, which multiply by four, so a fine
 * portamento moves as far in one row as a coarse one does in one tick.
 *
 * ## Panning is read and never used
 *
 * The panning envelope is tracked at `$2e(a2)` and `$37(a2)`, the sample's own
 * panning byte is parsed, and `8xx` and the volume column's `Cx` are in neither
 * dispatch table. `xmmix.ts` pans LRRL by channel number and nothing else
 * reaches it.
 *
 * ## The quiet check
 *
 * $212262 runs after every order advance: a channel whose volume has been zero
 * for eight consecutive rows has its voice killed outright at $212284. It is
 * the counter at `$1e(a2)`, and it is why a module that fades a channel to
 * nothing frees the voice rather than mixing silence forever.
 */
import type { AudioSink } from './host'
import type { XmInstrument, XmSample, XmSong } from './xm'
import { XM_ENV_LOOP, XM_ENV_ON, XM_ENV_SUSTAIN, XM_KEY_OFF, XM_LINEAR_PERIODS, XM_MIN_LOOP } from './xm'
import {
  XM_MIX_RATE,
  XM_VOICES,
  xmAmigaPeriod,
  xmLevel,
  xmLevelTable,
  xmLinearPeriod,
  xmLinearTable,
  xmMix,
  xmSamplesPerTick,
  xmSides,
  xmVoice,
  xmVolumeTable,
  type XmLevels,
  type XmVoice,
} from './xmmix'

/** $211a7a: `move.w #$40,$ca(a5)` */
export const XM_MAX_VOLUME = 0x40

/** $212284: eight rows of silence and the voice goes */
export const XM_QUIET_ROWS = 8

/** the 32-byte sine at $21462a, which is ProTracker's */
export const XM_SINE = Uint8Array.from([
  0, 24, 49, 74, 97, 120, 141, 161, 180, 197, 212, 224, 235, 244, 250, 253, 255, 253, 250, 244, 235, 224, 212, 197,
  180, 161, 141, 120, 97, 74, 49, 24,
])

/** one $38-byte block at `$114(a5)` */
interface XmChannel {
  /** the five cell bytes at $0 to $4 */
  note: number
  instrumentNo: number
  volumeColumn: number
  effect: number
  param: number
  /** `$6(a2)`: which instrument is loaded, -1 for none */
  instrument: number
  /** `$c(a2)` and `$18(a2)`: the period, and the copy the voice is given */
  period: number
  outPeriod: number
  /** `$e(a2)` and `$16(a2)`: the volume, and the copy the envelope reads */
  volume: number
  outVolume: number
  /** `$10(a2)`: the last note that was not zero */
  lastNote: number
  /** `$11(a2)`: the parameter memory, shared by every effect */
  memory: number
  /** `$12(a2)` and `$14(a2)`: the tone portamento's target and speed */
  portaTarget: number
  portaSpeed: number
  /** `$1a(a2)`: counts down from $ffff once the key is off */
  fade: number
  /** `$1c(a2)` and `$1d(a2)`: both set by a key off, and only $1d gates sustain */
  keyOff: boolean
  keyOff2: boolean
  /** `$1e(a2)`: rows of silence */
  quiet: number
  /** `$20(a2)`: E9 and R count down here */
  retrig: number
  /** `$21(a2)` and `$22(a2)`: shared by vibrato and tremolo */
  vibrato: number
  vibratoPhase: number
  /** `$23(a2)`: 9xx remembers its offset */
  offset: number
  /** `$24(a2)`, `$26(a2)`, `$2d(a2)`: the volume envelope */
  envOn: boolean
  envPos: number
  envHeld: boolean
  /** `$2e(a2)` and `$37(a2)`: the panning envelope, tracked and never read */
  panEnvOn: boolean
  panEnvHeld: boolean
  /** `$b6(a2)` and `$ba(a2)`: E6's counter and the row it jumps back to */
  loopCount: number
  loopRow: number
  /** which sample of the instrument the last note chose */
  sample: number
}

function newChannel(): XmChannel {
  return {
    note: 0,
    instrumentNo: 0,
    volumeColumn: 0,
    effect: 0,
    param: 0,
    instrument: -1,
    period: 0,
    outPeriod: 0,
    volume: 0,
    outVolume: 0,
    lastNote: 0,
    memory: 0,
    portaTarget: 0,
    portaSpeed: 0,
    fade: 0xffff,
    keyOff: false,
    keyOff2: false,
    quiet: 0,
    retrig: 0,
    vibrato: 0,
    vibratoPhase: 0,
    offset: 0,
    envOn: false,
    envPos: 0,
    envHeld: false,
    panEnvOn: false,
    panEnvHeld: false,
    loopCount: 0,
    loopRow: 0,
    sample: -1,
  }
}

export class XmPlayer {
  song: XmSong | null = null
  readonly channels: XmChannel[] = [...Array(XM_VOICES)].map(newChannel)
  readonly voices: XmVoice[] = [...Array(XM_VOICES)].map(() => xmVoice())

  /** `$ac(a5)` and `$b0(a5)` */
  speed = 6
  tick = 0
  /** `$ae(a5)` */
  bpm = 125
  /** `$a4(a5)`, `$a6(a5)`, `$a8(a5)`, `$aa(a5)` */
  row = 0
  /**
   * `$d0(a5)`, as a row index rather than a byte pointer.
   *
   * The library reads a row by walking a POINTER through the packed data and
   * bumping the row counter separately ($211e86 and $212168), and $211de0
   * skips the walk while a pattern delay is pending. So the two are not the
   * same number: `EEx` leaves the pointer one row ahead of the counter for the
   * rest of the pattern, and indexing the cells by `row` instead would replay
   * the delayed row forever. $2121fc puts them back in step on every order
   * change, by seeking the pointer forward `$a4(a5)` rows.
   */
  private cursor = 0
  pendingRow = 0
  breaking = false
  loopPending = false
  /** `$b4(a5)`: EE */
  patternDelay = 0
  /** `$cc(a5)` and `$ce(a5)` */
  order = 0
  rows = 0
  /** `$ca(a5)` and `$78(a5)` */
  globalVolume = XM_MAX_VOLUME
  master = XM_MAX_VOLUME
  /** `$72(a5)`: set when the order list wraps or `F00` runs */
  ended = false
  /** `$76(a5)`: what `Xm Song Pos` reports, which tracks the order */
  position = 0
  /**
   * `$2104c0`: 32 bytes, written on a trigger by $211f88 and CLEARED by the
   * read at $2104b6. An `Xm Vu` that is never called keeps its last peak.
   */
  readonly vu = new Uint8Array(XM_VOICES)
  playing = false
  /** `$4c(a5)`, and `Fxx` above $20 rewrites it */
  samplesPerTick = xmSamplesPerTick(XM_MIX_RATE, 125)
  /** `$a3(a5)` bit 0 */
  private linear = false
  private channelCount = 0

  private volumes = xmVolumeTable()
  private levels: XmLevels = xmLevelTable(4)
  private readonly linearTable = xmLinearTable()
  private pan: Uint8Array = new Uint8Array(0)
  private accLeft = new Uint16Array(0)
  private accRight = new Uint16Array(0)
  private outLeft = new Int8Array(0)
  private outRight = new Int8Array(0)

  constructor(private readonly sinkOf: () => AudioSink | undefined) {}

  private get sink(): AudioSink | undefined {
    return this.sinkOf()
  }

  /** $2118f0 and $210a66: the counters cleared and the module's own speed taken */
  load(song: XmSong, order = 0): void {
    this.song = song
    this.channelCount = Math.min(XM_VOICES, song.channels)
    this.linear = (song.flags & XM_LINEAR_PERIODS) !== 0
    this.levels = xmLevelTable(this.channelCount)
    this.pan = xmSides(this.channelCount)
    this.speed = song.speed
    this.bpm = song.bpm
    this.tick = 0
    this.row = 0
    this.pendingRow = 0
    this.breaking = false
    this.loopPending = false
    this.patternDelay = 0
    this.order = Math.max(0, Math.min(song.length - 1, order))
    this.globalVolume = XM_MAX_VOLUME
    this.ended = false
    this.position = this.order
    this.cursor = 0
    this.playing = true
    this.samplesPerTick = xmSamplesPerTick(XM_MIX_RATE, song.bpm)
    for (let c = 0; c < XM_VOICES; c++) {
      this.channels[c] = newChannel()
      this.voices[c] = xmVoice()
    }
    this.rows = this.rowsOf(this.order)
    this.resize()
    for (let v = 0; v < 4; v++) this.sink?.stop(v)
  }

  /** LVO -36 at $210312: the DMA off and the interrupt server gone */
  stop(): void {
    this.playing = false
    for (let v = 0; v < 4; v++) this.sink?.stop(v)
  }

  /** LVO -48 at $21039e, whose `mulu #$40 / lsr #$6` is the identity */
  setMaster(volume: number): void {
    this.master = Math.max(0, Math.min(XM_MAX_VOLUME, volume))
  }

  /** LVO -66 at $2104a4: the byte and the clear in one go */
  readVu(channel: number): number {
    const v = this.vu[channel] ?? 0
    if (channel >= 0 && channel < XM_VOICES) this.vu[channel] = 0
    return v
  }

  /** $2107c2: the order forward, the row to zero, and a re-seek */
  nextPattern(): void {
    const song = this.song
    if (!song) return
    this.order++
    this.row = 0
    this.cursor = 0
    if (this.order >= song.length) this.order = song.restart
    this.position = this.order
    this.rows = this.rowsOf(this.order)
  }

  /**
   * $210838: the order back, and `tst.w $cc(a5) / bgt` means order 1 lands on
   * the RESTART position rather than on order 0. The `move.w d0,$76(a5)` two
   * instructions later is dead: $210860 overwrites it from `$cc(a5)`.
   */
  prevPattern(): void {
    const song = this.song
    if (!song) return
    this.row = 0
    this.cursor = 0
    this.order--
    if (this.order <= 0) this.order = song.restart
    this.position = this.order
    this.rows = this.rowsOf(this.order)
  }

  private resize(): void {
    const n = this.samplesPerTick
    if (this.accLeft.length === n) return
    this.accLeft = new Uint16Array(n)
    this.accRight = new Uint16Array(n)
    this.outLeft = new Int8Array(n)
    this.outRight = new Int8Array(n)
  }

  /** $2121d6: an order naming a pattern the module has not got is SKIPPED */
  private patternOf(order: number): number {
    const song = this.song
    if (!song) return -1
    for (let i = 0; i < song.length + 1; i++) {
      const at = (order + i) % Math.max(1, song.length)
      const n = song.orders[at] ?? 0xff
      if (n < song.patterns.length) return n
    }
    return -1
  }

  private rowsOf(order: number): number {
    const n = this.patternOf(order)
    return n < 0 ? 0 : (this.song?.patterns[n]?.rows ?? 0)
  }

  private instrumentOf(ch: XmChannel): XmInstrument | null {
    return ch.instrument >= 0 ? (this.song?.instruments[ch.instrument] ?? null) : null
  }

  private sampleOf(ch: XmChannel): XmSample | null {
    const ins = this.instrumentOf(ch)
    if (!ins || ch.sample < 0) return null
    return ins.samples[ch.sample] ?? null
  }

  // ------------------------------------------------------------------ the row

  /** $211ddc */
  private doRow(): void {
    const song = this.song
    if (!song) return
    this.tick = 0
    const pattern = this.patternOf(this.order)
    const cells = pattern < 0 ? null : (song.patterns[pattern]?.cells[this.cursor] ?? null)

    // $211de0: a pattern delay keeps the cells that are already loaded, and
    // leaves the pointer where it is
    if (this.patternDelay === 0) {
      this.cursor++
      for (let c = 0; c < this.channelCount; c++) {
        const ch = this.channels[c]!
        const cell = cells?.[c]
        ch.note = cell?.note ?? 0
        ch.instrumentNo = cell?.instrument ?? 0
        ch.volumeColumn = cell?.volume ?? 0
        ch.effect = cell?.effect ?? 0
        ch.param = cell?.param ?? 0
      }
    }

    for (let c = 0; c < this.channelCount; c++) this.rowChannel(this.channels[c]!, this.voices[c]!, c)

    // $21215a: the delay is counted down after the row, not before it
    if (this.patternDelay !== 0) {
      this.patternDelay--
      return
    }
    this.advance()
  }

  /** $211e98 through $212156 */
  private rowChannel(ch: XmChannel, voice: XmVoice, index: number): void {
    // $211e98 skips only the TRIGGER while a pattern delay is pending: it
    // branches to $2120dc, which is the volume column, so the columns and the
    // effects run again on every delayed pass
    if (this.patternDelay === 0 && (ch.note !== 0 || ch.instrumentNo !== 0)) this.trigger(ch, voice, index)

    // $2120dc: the volume column, $10..$50 a level and $60 and up a command
    const v = ch.volumeColumn
    if (v >= 0x10 && v <= 0x50) ch.volume = v - 0x10
    else if (v >= 0x60) this.volumeColumnRow(ch, v)

    // $212116: below $20 only, and a non-zero parameter is remembered
    if (ch.effect < 0x20) {
      if (ch.param !== 0) ch.memory = ch.param
      this.rowEffect(ch, voice, ch.effect, ch.memory)
    }
    // $212142 and $212148: the two mirrors the envelope pass reads
    ch.outVolume = ch.volume
    ch.outPeriod = ch.period
  }

  /** $211ea6 through $2120d8 */
  private trigger(ch: XmChannel, voice: XmVoice, index: number): void {
    const song = this.song!
    // $211ea6: a cell with no note reuses the last one
    const note = ch.note !== 0 ? ch.note : ch.lastNote
    ch.lastNote = note

    // $211eb4: an instrument number past the count leaves the old one loaded
    if (ch.instrumentNo !== 0 && ch.instrumentNo <= song.instruments.length) ch.instrument = ch.instrumentNo - 1
    else if (ch.instrument < 0) return

    // $211ee0: `ED` at row time is a note delay, and the trigger is skipped
    if ((ch.effect & 0x0f) === 0x0e && (ch.param & 0xf0) === 0xd0) return

    const ins = this.instrumentOf(ch)
    if (!ins) return
    // $21229e: the sample map, and no samples at all kills the voice
    const sampleNo = ins.sampleFor[Math.max(0, Math.min(95, note - 1))] ?? 0
    if (ins.samples.length === 0) {
      voice.ended = true
      return
    }
    ch.sample = Math.min(ins.samples.length - 1, sampleNo)
    const sample = ins.samples[ch.sample]!

    if (ch.instrumentNo !== 0) {
      // $211f0c: a new instrument resets the fadeout and both envelopes
      ch.fade = 0xffff
      ch.keyOff = false
      ch.keyOff2 = false
      if ((ins.volumeType & XM_ENV_ON) !== 0) {
        ch.envPos = 0
        ch.envOn = true
        ch.envHeld = false
      } else ch.envOn = false
      if ((ins.panningType & XM_ENV_ON) !== 0) {
        ch.panEnvOn = true
        ch.panEnvHeld = false
      } else ch.panEnvOn = false

      // $211f54: `move.b $c(a1),$f(a2)` writes the LOW byte of the volume word
      ch.volume = (ch.volume & 0xff00) | (sample.volume & 0xff)
      // $211f64: the VU byte is the sample volume scaled by the master
      this.vu[index] = ((Math.min(0x3f, sample.volume) * this.master) >> 6) & 0xff
      if (ch.volume > XM_MAX_VOLUME) ch.volume = XM_MAX_VOLUME
      ch.outVolume = ch.volume

      // $211fa2 is `tst.b (a2) / beq`, so the loop setup needs the NOTE as
      // well as the instrument. Without that guard an instrument-only cell
      // would set `$19(a4)` on a one-shot sample and mute a voice that is
      // still sounding, which is most of this module's fade-ins.
      if (ch.note !== 0) {
        // $211fa6: the loop, and one boolean for a two-bit field
        const loopLen = sample.loopLength
        if (loopLen <= XM_MIN_LOOP) {
          voice.looping = false
          voice.ended = true
        } else voice.looping = (sample.type & 3) !== 0
      }
    }

    if (ch.note === 0) return

    // $212006: note 97 is a key off and never a pitch
    if (ch.note === XM_KEY_OFF) {
      if (ch.envOn) {
        ch.envHeld = false
        ch.keyOff = true
        ch.keyOff2 = true
      } else if (ch.instrumentNo === 0) ch.volume = 0
      return
    }

    const period = this.periodFor(note, sample)
    // $212012: 3 and 5 make the note a TARGET rather than a pitch
    if (ch.effect === 3 || ch.effect === 5) {
      ch.portaTarget = period
      return
    }
    ch.period = period
    ch.outPeriod = period
    voice.position = 0

    // $212032: a looping sample runs to its loop END, a one-shot to its length
    let length = sample.length
    if (voice.looping && sample.loopStart + sample.loopLength > XM_MIN_LOOP) {
      length = sample.loopStart + sample.loopLength
    }

    // $21207a: 9xx in BYTES, halved with the length when the file was 16-bit
    let start = 0
    if (ch.effect === 9) {
      let off = ch.param
      if (off === 0) off = ch.offset
      ch.offset = off
      const bytes = off << 8
      length -= bytes
      if (length < 0) {
        voice.ended = true
        return
      }
      start = sample.bits === 16 ? bytes >> 1 : bytes
      if (sample.bits === 16) length = length >> 1
    }

    voice.pcm = sample.pcm
    voice.loopStart = sample.loopStart
    voice.length = Math.min(sample.pcm.length, start + length)
    voice.position = start << 16
    voice.ended = false
  }

  /** $212312 and $212346: whichever frequency table the header asked for */
  private periodFor(note: number, sample: XmSample): number {
    // $212318: the relative note, clamped to 0..118
    let n = note + sample.relativeNote
    if (n < 0) n = 0
    if (n > 0x76) n = 0x76
    if (this.linear) {
      // $212336: 7680 - note * 64 - finetune / 2
      return (0x1e40 - (n << 6) - (sample.finetune >> 1)) & 0xffff
    }
    return xmAmigaPeriod(n, sample.finetune)
  }

  // -------------------------------------------------------------- the columns

  /** $212102: the row table at $213832, indexed by `(v >> 4) - 6` */
  private volumeColumnRow(ch: XmChannel, v: number): void {
    const arg = v & 0x0f
    switch (v >> 4) {
      case 0x8:
        this.volumeDown(ch, arg)
        break
      case 0x9:
        this.volumeUp(ch, arg)
        break
      case 0xa:
        // $212488: the LOW nibble, which is the depth and not the speed
        if (arg !== 0) ch.vibrato = (ch.vibrato & 0xf0) | arg
        break
      default:
        break
    }
  }

  /** $211ba2: the tick table at $213846 */
  private volumeColumnTick(ch: XmChannel, voice: XmVoice, v: number): void {
    const arg = v & 0x0f
    switch (v >> 4) {
      case 0x6:
        this.volumeDown(ch, arg)
        break
      case 0x7:
        this.volumeUp(ch, arg)
        break
      case 0xb:
        // $21249e, and its result goes to a register $211dc8 rewrites
        this.doVibrato(ch, voice, arg)
        break
      case 0xf:
        this.tonePorta(ch, 0)
        break
      default:
        break
    }
  }

  /** $21256c */
  private volumeUp(ch: XmChannel, by: number): void {
    ch.volume += by
    if (ch.volume > XM_MAX_VOLUME) ch.volume = XM_MAX_VOLUME
    ch.outVolume = ch.volume
  }

  /** $21258c */
  private volumeDown(ch: XmChannel, by: number): void {
    ch.volume -= by
    if (ch.volume < 0) {
      ch.volume = 0
      ch.outVolume = 0
      return
    }
    ch.outVolume = ch.volume
  }

  // -------------------------------------------------------------- the effects

  /** $21213e: the row table at $213762 */
  private rowEffect(ch: XmChannel, voice: XmVoice, effect: number, param: number): void {
    switch (effect) {
      case 0x0:
        this.arpeggio(ch, voice)
        break
      case 0xb:
        // $21259c: jumping to here or backwards flags the song as ended
        if (param <= this.order) this.ended = true
        this.order = param - 1
        this.pendingRow = 0
        this.breaking = true
        break
      case 0xc:
        ch.volume = Math.min(XM_MAX_VOLUME, param)
        break
      case 0xd:
        // $2125ca: the parameter is DECIMAL, `hi * 10 + lo`
        this.breaking = true
        this.pendingRow = (param >> 4) * 10 + (param & 0x0f)
        break
      case 0xe:
        this.extendedRow(ch, param >> 4, param & 0x0f)
        break
      case 0xf:
        // $2128e8
        if (param < 0x20) {
          if (param === 0) this.ended = true
          else this.speed = param
        } else {
          this.bpm = param
          this.samplesPerTick = xmSamplesPerTick(XM_MIX_RATE, param)
        }
        break
      case 0x10:
        this.globalVolume = Math.min(XM_MAX_VOLUME, param)
        break
      case 0x14:
        // $212958: K
        ch.envHeld = false
        ch.keyOff = true
        ch.keyOff2 = true
        break
      case 0x15:
        // $212966: L, and only when the volume envelope is on
        if (ch.envOn && this.instrumentOf(ch)) {
          const ins = this.instrumentOf(ch)!
          if ((ins.volumeType & XM_ENV_ON) !== 0) {
            ch.envPos = param
            ch.envOn = true
            ch.envHeld = false
          }
        }
        break
      case 0x1b:
        // $212a68: R keeps only the low nibble
        ch.retrig = param & 0x0f
        break
      default:
        // T is here, and its entry is the rts at $212a72
        break
    }
  }

  /** $211bb6: the tick table at $2137aa */
  private tickEffect(ch: XmChannel, voice: XmVoice, effect: number, param: number): void {
    switch (effect) {
      case 0x0:
        this.arpeggio(ch, voice)
        break
      case 0x1:
        this.portaUp(ch, param)
        break
      case 0x2:
        this.portaDown(ch, param)
        break
      case 0x3:
        this.tonePorta(ch, param)
        break
      case 0x4:
        this.doVibrato(ch, voice, param)
        break
      case 0x5:
        // $2124fc: the tone portamento with no new speed, then the slide
        this.tonePorta(ch, 0)
        this.volumeSlide(ch, param)
        break
      case 0x6:
        this.doVibrato(ch, voice, 0)
        this.volumeSlide(ch, param)
        break
      case 0x7:
        this.tremolo(ch, voice, param)
        break
      case 0xa:
        this.volumeSlide(ch, param)
        break
      case 0xe:
        this.extendedTick(ch, voice, param >> 4, param & 0x0f)
        break
      case 0x11:
        // $21292e: H
        if (param >> 4 !== 0) this.globalVolume = Math.min(XM_MAX_VOLUME, this.globalVolume + (param >> 4))
        else this.globalVolume = Math.max(0, this.globalVolume - (ch.memory & 0x0f))
        break
      case 0x1b:
        this.multiRetrig(ch, voice)
        break
      default:
        break
    }
  }

  /** $2125e8: the E tables, and only three entries in the tick one */
  private extendedRow(ch: XmChannel, hi: number, lo: number): void {
    switch (hi) {
      case 0x1:
        this.portaUp(ch, lo)
        break
      case 0x2:
        this.portaDown(ch, lo)
        break
      case 0x6:
        // $212602
        if (lo === 0) ch.loopRow = this.row
        else {
          if (ch.loopCount === 0) ch.loopCount = lo
          else if (--ch.loopCount === 0) break
          this.pendingRow = ch.loopRow
          this.loopPending = true
        }
        break
      case 0x9:
        ch.retrig = lo
        break
      case 0xa:
        this.volumeUp(ch, lo)
        break
      case 0xb:
        this.volumeDown(ch, lo)
        break
      case 0xc:
        if (this.tick === lo) {
          ch.volume = 0
          ch.outVolume = 0
        }
        break
      case 0xe:
        // $2128dc: only when nothing is pending
        if (this.patternDelay === 0) this.patternDelay = lo
        break
      default:
        // E0, E3, E4, E5, E7, E8, ED and EF are the rts at $21229c
        break
    }
  }

  private extendedTick(ch: XmChannel, voice: XmVoice, hi: number, lo: number): void {
    switch (hi) {
      case 0x9:
        // $21262c
        if (ch.retrig !== 0 && --ch.retrig === 0) {
          this.retrigger(ch, voice)
          ch.retrig = lo
        }
        break
      case 0xc:
        if (this.tick === lo) {
          ch.volume = 0
          ch.outVolume = 0
        }
        break
      case 0xd:
        // $21270a: the delayed trigger, on the tick the parameter names
        if (this.tick === lo) {
          const saved = ch.effect
          ch.effect = 0
          this.trigger(ch, voice, this.channels.indexOf(ch))
          ch.effect = saved
        }
        break
      default:
        break
    }
  }

  /** $2123ea: `d2 << 2`, then clamped by frequency table */
  private portaUp(ch: XmChannel, by: number): void {
    ch.period -= by << 2
    ch.period = this.clampPeriod(ch.period)
    ch.outPeriod = ch.period
  }

  /** $2123f2 */
  private portaDown(ch: XmChannel, by: number): void {
    ch.period += by << 2
    ch.period = this.clampPeriod(ch.period)
    ch.outPeriod = ch.period
  }

  /** $2123fc: $80..$1e40 linear, $40..$7fff Amiga */
  private clampPeriod(p: number): number {
    if (this.linear) return Math.max(0x80, Math.min(0x1e40, p))
    return Math.max(0x40, Math.min(0x7fff, p))
  }

  /** $212438 */
  private tonePorta(ch: XmChannel, speed: number): void {
    if (speed !== 0) ch.portaSpeed = speed
    const target = ch.portaTarget
    if (target === 0) return
    const by = ch.portaSpeed << 2
    if (target >= ch.period) {
      ch.period += by
      if (ch.period > target) {
        ch.period = target
        ch.portaTarget = 0
      }
    } else {
      ch.period -= by
      if (ch.period < target) {
        ch.period = target
        ch.portaTarget = 0
      }
    }
    ch.outPeriod = ch.period
  }

  /**
   * $21249e. The result goes into `$10(a4)`, which $211dc8 rewrites before the
   * mixer runs, so this moves the phase and nothing else.
   */
  private doVibrato(ch: XmChannel, voice: XmVoice, param: number): void {
    if ((param & 0xf0) !== 0) ch.vibrato = (ch.vibrato & 0x0f) | (param & 0xf0)
    if ((param & 0x0f) !== 0) ch.vibrato = (ch.vibrato & 0xf0) | (param & 0x0f)
    const d = (XM_SINE[ch.vibratoPhase & 0x1f]! * (ch.vibrato & 0x0f)) >> 5
    voice.period = (ch.vibratoPhase & 0x20) !== 0 ? ch.period - d : ch.period + d
    ch.vibratoPhase = (ch.vibratoPhase + (ch.vibrato >> 4)) & 0xff
  }

  /** $21250a, sharing `$21(a2)` and `$22(a2)` with the vibrato, and shifting six */
  private tremolo(ch: XmChannel, voice: XmVoice, param: number): void {
    if ((param & 0xf0) !== 0) ch.vibrato = (ch.vibrato & 0x0f) | (param & 0xf0)
    if ((param & 0x0f) !== 0) ch.vibrato = (ch.vibrato & 0xf0) | (param & 0x0f)
    const d = (XM_SINE[ch.vibratoPhase & 0x1f]! * (ch.vibrato & 0x0f)) >> 6
    voice.volume = (ch.vibratoPhase & 0x20) !== 0 ? ch.volume - d : ch.volume + d
    ch.vibratoPhase = (ch.vibratoPhase + (ch.vibrato >> 4)) & 0xff
  }

  /** $212568: the high nibble up, and the low one down when it is zero */
  private volumeSlide(ch: XmChannel, param: number): void {
    const up = param >> 4
    if (up !== 0) this.volumeUp(ch, up)
    else this.volumeDown(ch, ch.memory & 0x0f)
  }

  /**
   * $21239e. Two ticks in three add a semitone offset to the period and store
   * it in `$10(a4)`, which $211dc8 rewrites. The `divu.w #$3` on `$b0(a5)` is
   * still run, so this costs a divide per channel per tick and produces
   * nothing.
   */
  private arpeggio(ch: XmChannel, voice: XmVoice): void {
    if (ch.param === 0) return
    if (ch.lastNote === 0) return
    const sample = this.sampleOf(ch)
    if (!sample) return
    const phase = this.tick % 3
    let note = ch.lastNote
    if (phase === 1) note += ch.memory >> 4
    else if (phase === 2) note += ch.memory & 0x0f
    voice.period = this.periodFor(note, sample)
  }

  /** $21298a: the retrigger, minus the volume nibbles $212a2x applies */
  private multiRetrig(ch: XmChannel, voice: XmVoice): void {
    if (ch.retrig === 0) return
    if (--ch.retrig !== 0) return
    this.retrigger(ch, voice)
    ch.retrig = ch.memory & 0x0f
  }

  /** $212652: the same reset a fresh instrument gets, and the position to zero */
  private retrigger(ch: XmChannel, voice: XmVoice): void {
    const sample = this.sampleOf(ch)
    if (!sample) return
    voice.position = 0
    ch.fade = 0xffff
    ch.keyOff = false
    ch.keyOff2 = false
    const ins = this.instrumentOf(ch)
    if (ins) {
      if ((ins.volumeType & XM_ENV_ON) !== 0) {
        ch.envPos = 0
        ch.envOn = true
        ch.envHeld = false
      } else ch.envOn = false
      if ((ins.panningType & XM_ENV_ON) !== 0) {
        ch.panEnvOn = true
        ch.panEnvHeld = false
      } else ch.panEnvOn = false
    }
    voice.pcm = sample.pcm
    voice.loopStart = sample.loopStart
    voice.length =
      voice.looping && sample.loopStart + sample.loopLength > XM_MIN_LOOP
        ? Math.min(sample.pcm.length, sample.loopStart + sample.loopLength)
        : sample.pcm.length
    voice.ended = false
  }

  // ------------------------------------------------------- the envelope pass

  /** $211bf4: the envelope, the fadeout, the global volume, and the two stores */
  private envelopes(): void {
    for (let c = 0; c < this.channelCount; c++) {
      const ch = this.channels[c]!
      const voice = this.voices[c]!
      const ins = this.instrumentOf(ch)
      if (!ins) {
        // $211c06: no instrument, and only the period is written
        voice.period = this.outPeriodOf(ch)
        continue
      }
      let vol = ch.outVolume
      if (ch.envOn) {
        // $211c18: the fadeout multiplies before the envelope does
        if (ch.keyOff) {
          vol = (vol * ch.fade) >>> 16
          if (ch.fade !== 0) ch.fade = Math.max(0, ch.fade - ins.fadeout)
        }
        const value = this.envelopeValue(ins, ch)
        vol = (vol * value) >> 14
        if (vol < 0) vol = 0
        if (vol > XM_MAX_VOLUME) vol = XM_MAX_VOLUME
        if (!ch.envHeld) this.advanceEnvelope(ins, ch)
      }
      // $211d82
      if (this.globalVolume !== XM_MAX_VOLUME) vol = (vol * this.globalVolume) >> 6
      voice.volume = vol
      voice.period = this.outPeriodOf(ch)
    }
  }

  /** $211d94 and $211dc8 */
  private outPeriodOf(ch: XmChannel): number {
    if (!this.linear) return ch.outPeriod
    return xmLinearPeriod(ch.outPeriod, this.linearTable)
  }

  /**
   * $211c48 to $211cc6. The exact hit at $211c7a is a separate branch and is
   * right; everything between two points is the reciprocal described at the
   * top of this file.
   */
  private envelopeValue(ins: XmInstrument, ch: XmChannel): number {
    const pts = ins.volumeEnvelope
    if (pts.length === 0) return 0
    let i = 0
    while (i < pts.length - 1 && pts[i]!.x < ch.envPos) i++
    const here = pts[i]!
    if (here.x === ch.envPos) return here.y << 8
    if (i === 0) return here.y << 8
    const prev = pts[i - 1]!
    const dx = here.x - prev.x
    const dy = here.y - prev.y
    const t = ch.envPos - prev.x
    const d1 = (t * dx) & 0xffff
    let out = prev.y << 8
    // $211cc2: a zero product skips the divide and leaves the previous y
    if (d1 !== 0) out += ((dy << 8) / ((d1 << 16) >> 16)) | 0
    return out
  }

  /** $211ce4 to $211d7e: the loop first, then the sustain, then the plain step */
  private advanceEnvelope(ins: XmInstrument, ch: XmChannel): void {
    const pts = ins.volumeEnvelope
    if (pts.length === 0) return
    // $211cec: `bmi` on the point count, so a count above 127 never advances
    const last = pts[pts.length - 1]!
    if ((ins.volumeType & XM_ENV_ON) !== 0 && last.x > ch.envPos) ch.envPos++

    if ((ins.volumeType & XM_ENV_LOOP) !== 0) {
      const end = pts[ins.volumeLoopEnd]
      const start = pts[ins.volumeLoopStart]
      if (end && start && end.x <= ch.envPos) ch.envPos = start.x
    }
    if ((ins.volumeType & XM_ENV_SUSTAIN) !== 0 && !ch.keyOff2) {
      const sus = pts[ins.volumeSustain]
      if (sus && sus.x === ch.envPos) ch.envHeld = true
    }
  }

  // ------------------------------------------------------------- the advance

  /** $212168 */
  private advance(): void {
    const song = this.song!
    this.row++
    if (this.loopPending) {
      this.row = this.pendingRow
      this.pendingRow = 0
    }
    if (this.row < this.rows && !this.breaking && !this.loopPending) {
      this.quietCheck()
      return
    }
    // $212194: a pattern loop re-seeks inside the same order, so the pointer
    // is put back in step with the counter
    if (this.row < this.rows && this.loopPending && !this.breaking) {
      this.loopPending = false
      this.breaking = false
      this.cursor = this.row
      this.quietCheck()
      return
    }
    this.row = this.pendingRow
    this.pendingRow = 0
    this.order++
    if (this.order >= song.length) {
      this.order = song.restart
      this.ended = true
    }
    this.position = this.order
    this.rows = this.rowsOf(this.order)
    if (this.row >= this.rows) this.row = 0
    // $212218: the pointer is walked forward `$a4(a5)` rows into the new
    // pattern, which is where the two go back into step
    this.cursor = this.row
    this.breaking = false
    this.loopPending = false
    this.quietCheck()
  }

  /** $212262: eight rows of nothing and the voice is freed */
  private quietCheck(): void {
    for (let c = 0; c < this.channelCount; c++) {
      const ch = this.channels[c]!
      if (ch.volume !== 0) {
        ch.quiet = 0
        continue
      }
      if (ch.quiet < XM_QUIET_ROWS) ch.quiet++
      else this.voices[c]!.ended = true
    }
  }

  // ---------------------------------------------------------------- the output

  /** $211b6a: one tick of the sequencer, the envelope pass, and one buffer */
  vbl(): void {
    if (!this.playing || !this.song) return
    this.tick++
    if (this.tick === this.speed) this.doRow()
    else {
      for (let c = 0; c < this.channelCount; c++) {
        const ch = this.channels[c]!
        const voice = this.voices[c]!
        if (ch.volumeColumn >= 0x60) this.volumeColumnTick(ch, voice, ch.volumeColumn)
        if (ch.effect <= 0x20) {
          if (ch.param !== 0) ch.memory = ch.param
          this.tickEffect(ch, voice, ch.effect, ch.memory)
        }
      }
    }
    this.envelopes()
    this.render()
  }

  /** $210bfc: the first sounding voice on a side stores, the rest add */
  private render(): void {
    if (!this.song) return
    this.resize()
    const n = this.samplesPerTick
    for (const [side, acc, out] of [
      [1, this.accLeft, this.outLeft],
      [0xff, this.accRight, this.outRight],
    ] as [number, Uint16Array, Int8Array][]) {
      let sounded = 0
      let store = true
      for (let c = 0; c < this.channelCount; c++) {
        if (this.pan[c] !== side) continue
        const ran = xmMix(acc, n, this.voices[c]!, this.volumes, this.master, XM_MIX_RATE, store)
        // $210c1e sets the count to one on the store, $211244 bumps it per
        // voice that reaches the end of the add
        if (store) sounded = 1
        else if (ran) sounded++
        store = false
      }
      if (store) acc.fill(0x80, 0, n)
      xmLevel(out, acc, n, this.levels, Math.max(1, sounded))
    }
    // $2154b4: mode 3 puts the left buffer on AUD0 and AUD2 and the right on
    // AUD1 and AUD3, all four at volume 64
    this.sink?.play(0, this.outLeft, XM_MIX_RATE, this.master, 0, n)
    this.sink?.play(1, this.outRight, XM_MIX_RATE, this.master, 0, n)
  }
}
