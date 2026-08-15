/**
 * DigiBooster 1.x — the replay, off `DME_DigiBooster.library`.
 *
 * The format is `digi.ts` and the mixer is `digimix.ts`; this is the
 * sequencer, the effects and the pairing that joins the two.
 *
 * ## What it is underneath
 *
 * ProTracker with eight channels and a software pair-mix. The cell packing,
 * the effect set, the finetune table and the vibrato sine are all
 * ProTracker's, unchanged --- `notes.ts` already holds the last two and this
 * file reuses them rather than shipping a second copy, having first checked
 * that all 576 entries of the library's table at $212980 are `PT_PERIODS`
 * reordered, and that the 32 bytes at $212092 are `PT_SINE` exactly.
 *
 * What DigiBooster adds is the eighth channel, an extra octave, a bigger
 * sample offset, and the pairing.
 *
 * ## Evidence
 *
 * `DME_DigiBooster.library` at $210000, hunk 1 ($210430+10704). The tick is
 * $21097e and runs off a CIA timer at $210430, and unlike SoundFX and both
 * FutureComposers THE TEMPO IS REAL: $2105ba divides 1,775,101 by the word at
 * $210974, which `Fxx` above $1f writes.
 *
 * The layout of the state is worth stating once. There are FOUR voice blocks
 * at $23f710, $6c apart, one per Paula voice, and each holds TWO module
 * channels in parallel fields --- `$e`/`$f` the two volumes, `$3e`/`$3f` and
 * `$40`/`$41` the two portamento memories, `$4a`/`$50` the two tone-portamento
 * blocks. `lea $8(a1),a1` at $210d1c steps the row buffer two cells a block,
 * so channels 0 and 1 are Paula voice 0, 2 and 3 voice 1, and so on. Which of
 * the pair a shared effect routine is working on is `$21096a`, zero for the
 * first.
 *
 * That pairing is modelled here as eight independent channels plus a mix at
 * the end, because nothing in the effects depends on the block layout and
 * pretending otherwise would make every routine take a side.
 *
 * ## The tick
 *
 * $21097e, and it is off by one from where a ProTracker reader expects it.
 * `$21095b` counts 1 to `$21095a` (the speed) and the ROW IS PROCESSED ON THE
 * TICK WHERE IT REACHES THE SPEED ($210ed2), after which $210b6a advances the
 * row and $210b76 puts the counter back to 1. So the first note of a module
 * sounds `speed` ticks in, and the per-tick effects between notes run on the
 * effect words saved in the block at `$26`/`$2e` rather than on the cell,
 * which by then is already the next row's.
 *
 * ## The last tick of a row
 *
 * $2112f4 filters the effect word when `$21095b` reaches `speed - 1`: every
 * effect except 0, 3, 4, 8, `E9x` and `ECx` is cleared for that tick, and
 * effect 5 becomes a plain 3. So a volume slide gets one fewer step than the
 * speed suggests and a tone portamento does not.
 *
 * ## The finetune, which flattens every 1.x module
 *
 * Every sample in a version 1.0 to 1.3 module plays a finetune step flat,
 * about twelve cents, and the two halves of the cause are eight hundred bytes
 * apart. `../runtime/dme.ts` carries the marker for it, on `Db Play`.
 *
 * $2107b2 clears all 31 finetune bytes for exactly the versions $10 to $13.
 * $210f60 then reads one back and does `subq.b #$1,d2` before using it, so
 * DigiBooster's stored finetune is ONE-BASED and a cleared byte means -1
 * rather than neutral. The lookup at $210f96 duly picks row 7 of the sixteen
 * at $212980, which is finetune -1, for every sample of every module the
 * extension will load.
 *
 * It is uniform, so it transposes a tune rather than detuning it against
 * itself, which is presumably why it shipped. Reproduced: an independent
 * player reads the same file a finetune step sharper, and that gap is this
 * library rather than this port.
 */

import type { AudioSink } from './host'
import { DIGI_ROWS, DIGI_SAMPLES, type DigiSample, type DigiSong } from './digi'
import { digiStep, digiVolumeTable, mixPair, type MixSide } from './digimix'
import { PT_PERIODS, PT_PERIODS_PER_ROW, PT_SINE } from './notes'
import { clampVolume, PAULA_CLOCK, periodToHz } from './paula'

/** `cmp.w #$71,d0` at $211872 and `#$358` at $211dae */
export const DIGI_MIN_PERIOD = 0x71
export const DIGI_MAX_PERIOD = 0x358
/** `move.w #$7d,$210974.l` at $21060c */
export const DIGI_DEFAULT_BPM = 125
/** `move.b #$6,$21095a.l` at $210718 */
export const DIGI_DEFAULT_SPEED = 6
/** `move.w #$40,$210978` and `#$4b,$21097a` in the library's data */
export const DIGI_BASE_VOLUME = 0x40
export const DIGI_DEFAULT_BOOST = 75
/** `move.l #$888c0e,d3 / divu.l d7,d3 / divu.w d0,d3 / addq.w #$1,d3` at $2120c2 */
export const DIGI_SPAN_NUMERATOR = 0x888c0e
/** `cmp.w #$7f,d7` at $211b8a: how far `Bxx` may jump */
export const DIGI_MAX_POSITION = 0x7f

/**
 * `$21291c`: `Dxx`'s parameter read as two decimal digits.
 *
 * Ten entries then six zeros then ten more, so $00-$09 are rows 0-9 and
 * $10-$19 rows 10-19, the same BCD break ProTracker has.
 */
const BREAK_ROW = ((): Uint8Array => {
  const t = new Uint8Array(0x64)
  for (let hi = 0; hi < 10; hi++) for (let lo = 0; lo < 10; lo++) t[hi * 16 + lo] = hi * 10 + lo
  return t
})()

/** how many bytes of a sample one tick consumes, $2120b2 */
export function digiSpan(bpm: number, period: number): number {
  if (bpm <= 0 || period <= 0) return 0
  return Math.trunc(Math.trunc(DIGI_SPAN_NUMERATOR / bpm) / period) + 1
}

/** the state a module channel keeps, split out of the paired blocks */
interface Channel {
  /** the sample the last note named, 1..31, and 0 for none yet */
  sample: number
  /** where the DMA is, in bytes, and one past where it may read */
  pos: number
  end: number
  /** the sample it is reading, sliced by the loop */
  pcm: Int8Array | null
  loopStart: number
  loopEnd: number
  /** `$e(a6)`: 0..64, before the boost */
  volume: number
  /** the period the row set, and the one the tick's effects produced */
  period: number
  out: number
  /** the twelve bits of the cell's effect: nibble in the high byte */
  effect: number
  /** `$3e(a6)` and `$40(a6)`: the two portamento memories */
  portaUp: number
  portaDown: number
  /** `$10(a6)`: the volume slide's memory */
  slide: number
  /** `$4a(a6)`: tone portamento --- speed, direction, current, target */
  tpSpeed: number
  tpDown: boolean
  tpPeriod: number
  tpTarget: number
  /** `$42(a6)`: vibrato --- the parameter, the position and its memory */
  vibParam: number
  vibPos: number
  /** `$14(a6)`: `E8x`'s high nibble of the sample offset */
  offsetHi: number
  /** `$16(a6)`: `E9x`'s counter */
  retrig: number
  /** `$30(a6)`: `E6x`'s row, position and counter */
  loopRow: number
  loopPos: number
  loopCount: number
  /** `$62(a6)`: `E50` mutes the channel and `E51` lets it back */
  muted: boolean
  /** whether a note is sounding at all */
  live: boolean
}

const newChannel = (): Channel => ({
  sample: 0, pos: 0, end: 0, pcm: null, loopStart: 0, loopEnd: 0,
  volume: 0, period: 0, out: 0, effect: 0,
  portaUp: 0, portaDown: 0, slide: 0,
  tpSpeed: 0, tpDown: false, tpPeriod: 0, tpTarget: 0,
  vibParam: 0, vibPos: 0, offsetHi: 0, retrig: 0,
  loopRow: 0, loopPos: 0, loopCount: 0, muted: false, live: false,
})

const u8 = (n: number): number => n & 0xff

/**
 * The replay: one `tick()` is one CIA interrupt.
 *
 * DEVIATION: the caller drives it. `tickHz` says how fast, off the module's
 * own BPM, and `runtime/dme.ts` runs it against the mixer's clock the way MED
 * does rather than once a frame, because `Fxx` above $1f really does change
 * the rate here.
 */
export class DigiPlayer {
  song: DigiSong | null = null
  readonly channels: Channel[] = [...Array(8)].map(newChannel)

  /** `$21095a`, `$21095b`, `$210958`, `$210959` */
  speed = DIGI_DEFAULT_SPEED
  counter = 1
  position = 0
  row = 0
  /** `$210974`, and `$210976` is folded into `tickHz` */
  bpm = DIGI_DEFAULT_BPM
  /** `$210960`: `EEx`'s delay, in ticks */
  delay = 0
  /** `$21033a`: the end flag, the master and its saved copy */
  end = false
  master = DIGI_BASE_VOLUME
  savedMaster = DIGI_BASE_VOLUME
  /** `$21097a` and `$21097c` */
  boost = DIGI_DEFAULT_BOOST
  mixing = true
  playing = false
  /** `$bfe001` bit 1, which `E00` and `E01` really do drive */
  filter = true

  private readonly table = digiVolumeTable()
  private readonly buffers: Int8Array[] = [0, 1, 2, 3].map(() => new Int8Array(0))

  constructor(private readonly sinkOf: () => AudioSink | undefined) {}

  private get sink(): AudioSink | undefined {
    return this.sinkOf()
  }

  /** what the CIA is set to: `1775101 / bpm` ticks of a 709379Hz clock */
  get tickHz(): number {
    return 709379 / Math.max(1, Math.trunc(1775101 / Math.max(1, this.bpm)))
  }

  /** LVO -30 at $210194: `InitModule` and then the timer */
  load(song: DigiSong): void {
    this.song = song
    this.speed = DIGI_DEFAULT_SPEED
    this.counter = 1
    this.position = 0
    this.row = 0
    this.bpm = DIGI_DEFAULT_BPM
    this.delay = 0
    this.end = false
    this.playing = true
    for (let i = 0; i < 8; i++) this.channels[i] = newChannel()
    for (let v = 0; v < 4; v++) this.sink?.stop(v)
  }

  /** LVO -36 at $2101ca, and LVO -48 at $210226 which also cuts the volumes */
  stop(): void {
    this.playing = false
    for (let v = 0; v < 4; v++) this.sink?.stop(v)
    this.savedMaster = this.master
    if (this.master === 0) this.master = DIGI_BASE_VOLUME
  }

  /** LVO -54 at $210276: the master back and the flag up, position untouched */
  cont(): void {
    this.master = this.savedMaster
    this.playing = true
  }

  /** LVO -90 at $2102fe and -96 at $210316: the position, and the row cleared */
  nextPattern(): void {
    this.position = u8(this.position + 1)
    this.row = 0
  }

  prevPattern(): void {
    this.position = this.position > 0 ? this.position - 1 : 0
    this.row = 0
  }

  /** LVO -78 at $2102dc, read and cleared, and 255 rather than -1 */
  readEnd(): boolean {
    const was = this.end
    this.end = false
    return was
  }

  /** one CIA interrupt: $21097e */
  tick(): void {
    const song = this.song
    if (!song || !this.playing) return

    const rowTick = this.counter >= this.speed
    if (rowTick && this.speed !== 0) {
      // $2109a6: the row runs off the end and takes the position with it
      if (this.row === DIGI_ROWS) {
        this.row = 0
        this.position = u8(this.position + 1)
      }
      // $2109c8 is `bge`, so the wrap only fires once the position is PAST
      // the length. order[songLength] therefore plays before the end flag
      if (song.songLength < this.position) {
        this.end = true
        this.position = 0
        this.row = 0
      }
    }

    const pattern = song.patterns[song.order[this.position] ?? 0] ?? song.patterns[0]!
    const cells = pattern[this.row % DIGI_ROWS] ?? []

    // $210eb8, once per channel where the library does it once per pair
    for (let c = 0; c < song.channels; c++) {
      const ch = this.channels[c]!
      const cell = cells[c]
      if (!cell) continue
      if (rowTick && this.delay === 0) this.rowPass(ch, cell.period, cell.sample, (cell.effect << 8) | cell.param)
    }
    // $2112f4: the last tick of a row keeps only a few of them
    if (this.counter === this.speed - 1) {
      for (let c = 0; c < song.channels; c++) this.channels[c]!.effect = lastTickEffect(this.channels[c]!.effect)
    }
    for (let c = 0; c < song.channels; c++) {
      const ch = this.channels[c]!
      this.clampPeriod(ch)
      if (!rowTick || this.delay !== 0) this.tickEffects(ch)
      this.clampPeriod(ch)
      ch.out = ch.period
    }

    this.emit()

    // $210b50: the counter resets and the row moves at the END of the tick
    if (rowTick) {
      this.counter = 0
      if (this.delay > 0) this.delay -= 1
      else this.row += 1
    }
    this.counter += 1
  }

  /* ---- the row, $210eb8 ---- */

  private rowPass(ch: Channel, period: number, sample: number, effect: number): void {
    const song = this.song!
    ch.effect = effect
    const nibble = effect >> 8
    const param = effect & 0xff

    if (sample !== 0) {
      ch.sample = sample
      const s = song.samples[sample - 1]
      if (s) ch.volume = s.volume
    }

    if (period !== 0 && !ch.muted) {
      // $210f60: the stored finetune is ONE-BASED, so a 1.x module's cleared
      // byte is -1 and every note comes out a step flat. See the header
      const s = song.samples[ch.sample - 1]
      const fine = ((s?.finetune ?? 0) - 1) | 0
      const tuned = finetunePeriod(period, fine)
      // $2110b4 and $2110ac: a tone portamento takes the note as a TARGET and
      // leaves the sample where it is
      if (nibble === 0x3 || nibble === 0x5) {
        ch.tpTarget = tuned
        if (ch.tpPeriod === 0) ch.tpPeriod = ch.period
      } else {
        ch.period = tuned
        ch.tpPeriod = tuned
        ch.tpTarget = tuned
        this.trigger(ch)
        // $211bcc: `9xx` and the nibble `E8x` left behind make one offset
        if (nibble === 0x9) {
          const at = ch.offsetHi * 0x10000 + param * 0x100
          ch.pos = at
        }
        ch.vibPos = 0
      }
    }

    switch (nibble) {
      case 0xb: // $211b7e
        this.row = 0xff
        this.position = Math.min(param, DIGI_MAX_POSITION)
        break
      case 0xd: { // $211b9c
        const n = Math.min(param, 0x63)
        if (this.row !== 0xff) this.position = u8(this.position + 1)
        this.row = (BREAK_ROW[n] ?? 0) - 1
        break
      }
      case 0xc: // $211dd6, and no clamp until the mixer takes it
        ch.volume = param
        break
      case 0xf: // $211bfa
        if (param <= 0x1f) {
          this.speed = param
          this.counter = param
        } else {
          this.bpm = param
        }
        break
      case 0xe:
        this.extended(ch, param)
        break
      default:
        break
    }
  }

  /** the `Exy` arms that run on the row tick */
  private extended(ch: Channel, param: number): void {
    const x = param >> 4
    const y = param & 0x0f
    switch (x) {
      case 0x0: // $211c4a and $211c54: the LED filter, and it really is CIA-A
        if (y === 0) this.filter = false
        else if (y === 1) this.filter = true
        break
      case 0x1: // $211e3c
        ch.period = Math.max(DIGI_MIN_PERIOD, ch.period - y)
        break
      case 0x2: // $211e0e
        ch.period = Math.min(DIGI_MAX_PERIOD, ch.period + y)
        break
      case 0x5: // $211c2a and $211c32, which mute rather than finetune
        if (y === 0) ch.muted = true
        else if (y === 1) ch.muted = false
        break
      case 0x6: { // $211b00
        if (y === 0) {
          ch.loopRow = this.row - 1
          ch.loopPos = this.position
        } else if (ch.loopCount === 0) {
          ch.loopCount = y
          this.row = ch.loopRow
          this.position = ch.loopPos
        } else if (--ch.loopCount !== 0) {
          this.row = ch.loopRow
          this.position = ch.loopPos
        }
        break
      }
      case 0x8: // $211bf0: the high nibble of `9xx`'s offset
        ch.offsetHi = y
        break
      case 0xa: // $211e6a
        ch.volume = Math.min(0x40, ch.volume + y)
        break
      case 0xb: // $211e8c
        ch.volume = Math.max(0, ch.volume - y)
        break
      case 0xe: // $211b5a
        if (y !== 0) this.delay = y
        break
      default:
        break
    }
  }

  /* ---- the effects that run every tick, $211a02 ---- */

  private tickEffects(ch: Channel): void {
    const nibble = ch.effect >> 8
    const param = ch.effect & 0xff
    switch (nibble) {
      case 0x0:
        if (param !== 0) this.arpeggio(ch, param)
        break
      case 0x1: // $211d52
        if (param !== 0) ch.portaUp = param
        ch.period = Math.max(DIGI_MIN_PERIOD, ch.period - ch.portaUp)
        break
      case 0x2: // $211d94
        if (param !== 0) ch.portaDown = param
        ch.period = Math.min(DIGI_MAX_PERIOD, ch.period + ch.portaDown)
        break
      case 0x3: // $211eaa
        this.tonePorta(ch, param)
        break
      case 0x4: // $211fe4
        this.vibrato(ch, param)
        break
      case 0x5: // $211f74: the slide first, then a tone portamento with no speed
        this.volumeSlide(ch, param)
        this.tonePorta(ch, 0)
        break
      case 0x6: // $211fac
        this.volumeSlide(ch, param)
        this.vibrato(ch, 0)
        break
      case 0xa: // $211dda
        this.volumeSlide(ch, param)
        break
      case 0xe: {
        const x = param >> 4
        const y = param & 0x0f
        if (x === 0x9) { // $211c5e
          if (this.counter === 1) ch.retrig = 0
          if (y - 1 === ch.retrig) {
            this.trigger(ch)
            ch.retrig = 0
          } else ch.retrig += 1
        } else if (x === 0xc && y === this.counter) { // $211ca2
          ch.volume = 0
        }
        break
      }
      default:
        break
    }
  }

  /** $211ce2, over the 0/1/2 table at $211cb4 */
  private arpeggio(ch: Channel, param: number): void {
    const phase = (this.counter - 1) % 3
    if (phase === 0) return
    const step = phase === 2 ? param & 0x0f : param >> 4
    // the lookup walks the 37-word row, so a note near the top reads into the
    // next finetune row rather than off the end --- which `notes.ts` keeps
    const row = PT_PERIODS
    let found = -1
    for (let i = 0; i < 0x25; i++) {
      if (row[i] !== undefined && row[i]! <= ch.period) { found = i; break }
    }
    if (found < 0) return
    const to = Math.min(found + step, PT_PERIODS.length - 1)
    ch.period = PT_PERIODS[to] ?? ch.period
  }

  /** $211eaa, and $2118a0's `$4a(a6)` block */
  private tonePorta(ch: Channel, param: number): void {
    if (param !== 0) ch.tpSpeed = param
    if (ch.tpTarget === 0) return
    if (ch.tpPeriod === 0) ch.tpPeriod = ch.period
    if (ch.tpPeriod < ch.tpTarget) {
      ch.tpPeriod = Math.min(ch.tpTarget, ch.tpPeriod + ch.tpSpeed)
    } else if (ch.tpPeriod > ch.tpTarget) {
      ch.tpPeriod = Math.max(ch.tpTarget, ch.tpPeriod - ch.tpSpeed)
    }
    ch.period = ch.tpPeriod
  }

  /** $21200c: ProTracker's sine, `(sine * depth) >> 7`, position by speed * 4 */
  private vibrato(ch: Channel, param: number): void {
    if (param !== 0) ch.vibParam = param
    const depth = ch.vibParam & 0x0f
    const speed = ch.vibParam >> 4
    const value = ((PT_SINE[(ch.vibPos >> 2) & 0x1f] ?? 0) * depth) >> 7
    ch.period += (ch.vibPos & 0x80) !== 0 ? -value : value
    ch.vibPos = u8(ch.vibPos + ((speed << 2) & 0x3c))
  }

  /** $211dda: up on the high nibble, down on the low, memory at `$10(a6)` */
  private volumeSlide(ch: Channel, param: number): void {
    const p = param !== 0 ? param : ch.slide
    ch.slide = p
    if (p >= 0x10) ch.volume = Math.min(0x40, ch.volume + (p >> 4))
    else ch.volume = Math.max(0, ch.volume - (p & 0x0f))
  }

  /** $211872, and a period of zero silences the channel outright */
  private clampPeriod(ch: Channel): void {
    if (ch.period !== 0 && ch.period < DIGI_MIN_PERIOD) ch.period = DIGI_MIN_PERIOD
    if (ch.period > DIGI_MAX_PERIOD) ch.period = DIGI_MAX_PERIOD
  }

  /** point the channel at its sample and rewind it, $2110b4 */
  private trigger(ch: Channel): void {
    const s: DigiSample | undefined = this.song!.samples[ch.sample - 1]
    if (!s || s.length === 0 || ch.sample > DIGI_SAMPLES) {
      ch.live = false
      ch.pcm = null
      return
    }
    ch.pcm = s.pcm
    ch.pos = 0
    ch.live = true
    if (s.repeatLength > 2) {
      ch.loopStart = s.repeatStart
      ch.loopEnd = Math.min(s.length, s.repeatStart + s.repeatLength)
      ch.end = ch.loopEnd
    } else {
      ch.loopStart = -1
      ch.loopEnd = 0
      ch.end = s.length
    }
  }

  /* ---- the pairing, $210c70 and $2115d4 ---- */

  private emit(): void {
    const sink = this.sink
    for (let v = 0; v < 4; v++) {
      const a = this.channels[v * 2]
      const b = this.channels[v * 2 + 1]
      const aLive = !!a && a.live && !a.muted && a.out > 0 && !!a.pcm
      const bLive = !!b && b.live && !b.muted && b.out > 0 && !!b.pcm
      if (!aLive && !bLive) {
        sink?.setVolume(v, 0)
        continue
      }
      // $210bec and $210c1c both write AUDxPER from the channel's own period,
      // and the lead is the first of the pair when it is sounding
      const lead = aLive ? a! : b!
      const other = aLive ? (bLive ? b! : null) : null
      const span = digiSpan(this.bpm, lead.out)
      if (span <= 0) continue
      let buf = this.buffers[v]!
      if (buf.length !== span) buf = this.buffers[v] = new Int8Array(span)
      const A: MixSide = { pcm: lead.pcm, pos: lead.pos, end: lead.end, volume: this.scaled(lead) }
      const B: MixSide = other
        ? { pcm: other.pcm, pos: other.pos, end: other.end, volume: this.scaled(other) }
        : { pcm: null, pos: 0, end: 0, volume: 0 }
      const n = other ? digiSpan(this.bpm, other.out) : 0
      mixPair(buf, A, B, digiStep(span, n), this.table)
      this.wrap(lead, A.pos)
      if (other) this.wrap(other, B.pos)
      // the buffer holds exactly one tick, so playing it from the top each
      // tick IS the swap the library does between `$56(a6)` and `$5e(a6)`
      sink?.play(v, buf, periodToHz(lead.out, PAULA_CLOCK), clampVolume(this.master), 0, span)
    }
  }

  /** $211396: the base of 64 through the boost rate, then over 64 again */
  private scaled(ch: Channel): number {
    const gain = Math.trunc((DIGI_BASE_VOLUME * this.boost) / 100)
    return Math.max(0, Math.min(0x40, (Math.min(0x40, ch.volume) * gain) >> 6))
  }

  /** the wrap the mixer leaves to its caller */
  private wrap(ch: Channel, pos: number): void {
    ch.pos = pos
    if (ch.pos < ch.end) return
    if (ch.loopStart < 0) {
      ch.live = false
      return
    }
    const len = ch.loopEnd - ch.loopStart
    if (len <= 0) {
      ch.live = false
      return
    }
    ch.pos = ch.loopStart + ((ch.pos - ch.loopStart) % len)
  }
}

/** $2112f4: what survives the last tick of a row */
function lastTickEffect(effect: number): number {
  const nibble = effect >> 8
  if (nibble === 0x8 || nibble === 0x3 || nibble === 0x4 || nibble === 0) return effect
  if (nibble === 0x5) return 0x300
  const ext = effect >> 4
  if (ext === 0xec || ext === 0xe9) return effect
  return 0
}

/**
 * $210f76 and $210fac: the same note in another finetune row, or a multiply
 * when the period is not one of the 36.
 */
export function finetunePeriod(period: number, fine: number): number {
  if (fine === 0) return period
  if (fine >= -8 && fine <= 7) {
    for (let n = 0; n < 0x24; n++) {
      // row 0 of PT_PERIODS is finetune 0, and its entry 0 is the duplicate
      if (PT_PERIODS[1 + n] === period) {
        const row = fine & 0x0f
        return PT_PERIODS[row * PT_PERIODS_PER_ROW + 1 + n] ?? period
      }
    }
  }
  // `mulu.w #$ffff,d2` is a negate, and `divu.w #$8c` is over 140
  const delta = Math.trunc((period * Math.abs(fine)) / 0x8c)
  return fine < 0 ? period + delta : period - delta
}
