/**
 * The THX replay.
 *
 * Two halves that run at different rates. The SONG is positions, rows, the
 * speed counter and the sixteen track commands, and it steps once every
 * `speed` frames. The VOICE is the envelope, the playlist, the modulations and
 * the waveform, and it steps every frame — which is why a THX instrument can
 * sweep a filter under a note that was struck six frames ago.
 *
 * See `./thx.ts` for the module format this steps and `./thxwaves.ts` for the
 * 410,760 bytes it plays out of.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier, from `AMOSPro_Jotre.Lib`. THX Sound System BinaryPlayer
 * 2.00 is the reference here rather than the smaller replayer thx-0.6 embeds,
 * because it is the later build and the superset. Its per-frame routine is at
 * $a3a and its row handler at $b60, and every citation below is one of those.
 *
 * The two replayers agree on all of it. thx-0.6's tick is at $666 and its row
 * handler at $760, and the code is the same instructions over a smaller state
 * block — channels of $5c bytes against Jotre's $e8, the tick counter at $17e
 * against $3aa, the position at $216 against $448. Where this file cites one
 * address it could cite either; where they DIVERGE it says so, and the whole
 * list of divergences is three items:
 *
 *   - command $d carries a row argument in Jotre and none in thx-0.6
 *   - Jotre null-checks the instrument pointer at $cd8 and thx-0.6 does not
 *   - Jotre's command 4 is gated on a flag at $43e(a6) that thx-0.6 lacks
 *
 * ## The frame
 *
 * `$aec-$af8` runs the between-tick pass for all four channels, then `$afc`
 * decrements the counter and only on zero does the song advance. So a THX
 * frame is one VBL and `speed` frames make a row, which is ProTracker's
 * arrangement with the test at the other end.
 *
 * Rows do NOT advance where you would expect. `$b06` tests the break flag
 * FIRST, and the ordinary path at `$b0e` increments the row and compares it
 * against the track length for EQUALITY. Both paths then fall into the same
 * `$b2a`, which takes the next position and row out of `$3b6`/`$3b8` and
 * clears them. One exit, two ways in.
 *
 * ## What the sink is told, and why `play()` is not called
 *
 * `$1618` is the per-channel hardware write, and it is the reason this port
 * needs `AudioSink.setWaveform`:
 *
 *     tst.b  $27(a0) / bne  -> move.w #$0,$8(a3)    disabled: AUDxVOL = 0
 *     tst.b  $26(a0) / beq
 *     move.w $64(a0),$6(a3)                         AUDxPER, on a note only
 *     tst.b  $22(a0) / beq
 *     ... rewrite the waveform buffer IN PLACE ...
 *     move.w $66(a0),$8(a3)                         AUDxVOL, every frame
 *
 * The DMA is never restarted. A voice is a 640-byte chip buffer looping
 * forever, and a waveform change overwrites the bytes under it. So `play()` is
 * called exactly ONCE a voice, to start the loop the way `$1de` starts the DMA
 * at init, and every change after that is `setWaveform()`. A voice that has
 * never had a waveform is a voice whose DMA has not been switched on.
 *
 * The buffer is 640 bytes whatever the waveform length: the tiling loop at
 * $1658 runs `(1 << waveLength)` longs `(1 << (5 - waveLength)) * 5` times, and
 * those cancel to 4 * 5 * 32 for every length. Noise is the exception and is
 * copied whole at $1676, 80 iterations of eight bytes.
 */
import { clampVolume, periodToHz, PAULA_CLOCK } from './paula'
import type { AudioSink } from './host'
import type { ThxInstrument, ThxModule, ThxStep } from './thx'
import { thxSubSongPosition } from './thx'
import {
  THX_FILTER_COUNT,
  THX_OFF_NOISE,
  THX_OFF_SAWTOOTHS,
  THX_OFF_SQUARES,
  THX_SET_BYTES,
  thxFilterBank,
  thxSine,
} from './thxwaves'

/** 16-bit signed, which is what every `move.w` into the channel truncates to */
const word = (v: number): number => (Math.trunc(v) << 16) >> 16

/** 8-bit signed */
const byte = (v: number): number => (Math.trunc(v) << 24) >> 24

/**
 * The bank and the sine, built once.
 *
 * 410,760 bytes and about a hundred thousand filter steps, so not at module
 * load: a Runtime that never plays a THX module should not pay for it. Every
 * player shares the one copy, which is right — on the machine InitPlayer
 * builds it once for the whole system too.
 */
let bank: Uint8Array | null = null
let sine: Int16Array | null = null
const waveBank = (): Uint8Array => (bank ??= thxFilterBank())
const waveSine = (): Int16Array => (sine ??= thxSine())

/** the byte offset of each family's `waveLength` member, `$13f8`: 4+8+16+32+64 summed */
const WAVE_LENGTH_OFFSET: readonly number[] = [0, 4, 12, 28, 60, 124]

/** what `$1618` copies into the chip buffer, whatever the waveform's own length */
export const THX_VOICE_BYTES = 640

/**
 * The period table, `$169c` in Jotre and `$f28 + 12` in thx-0.6.
 *
 * Index 0 is never read — every lookup is guarded by a `beq` on the note — and
 * it is 0 in the file, so it is 0 here. Notes 1 to 60 are five octaves ending
 * on ProTracker's own top three: 856, 808, 762 ... 127, 120, 113 are the last
 * thirty-six, and 3424 is 856 * 4.
 *
 * The 168 bytes holding this are BYTE-IDENTICAL between the two libraries,
 * which is two independently built replayers agreeing on every word.
 * `thxplay.test.ts` reads them back out of both.
 */
export const THX_PERIODS: readonly number[] = [
  0, 3424, 3232, 3048, 2880, 2712, 2560, 2416, 2280, 2152, 2032, 1920, 1812, 1712, 1616, 1524, 1440, 1356, 1280,
  1208, 1140, 1076, 1016, 960, 906, 856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453, 428, 404, 381, 360,
  339, 320, 302, 285, 269, 254, 240, 226, 214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113,
]

/** the highest note a track can carry: six bits, and the table stops here */
export const THX_MAX_NOTE = 60

/**
 * One voice.
 *
 * The field names are this port's; the offsets are Jotre's, and every one of
 * them is written by the row handler at $b60, stepped by the between-tick pass
 * at $f40, or read by the hardware pass at $1618.
 */
export interface ThxChannel {
  /** $0(a0) — the track this position gives the channel */
  track: number
  /** $2(a0) — the NEXT position's track, which $ab6 preloads for the hard cut */
  nextTrack: number
  /** $1(a0) — the position's transpose, signed */
  transpose: number
  /** $18(a0) — 1..60 into THX_PERIODS, 0 for none */
  note: number
  /** $1d(a0) — the channel's own volume, 0..$40 */
  volume: number
  /**
   * $21(a0) — the fourth term of the volume chain, and $40 at StartSong.
   *
   * `move.w #$40,$20(a1)` at $950 is one of only three things the per-channel
   * reset puts back after clearing all $e8 bytes; the other two are `off` and
   * the chip buffer pointer. So a channel starts at unity here and only
   * command C's upper ranges or playlist command 6's third range move it.
   */
  volumeC: number
  /** $26(a0) — a note was struck, so AUDxPER wants writing */
  noteStruck: boolean
  /** $27(a0) — the channel is off: $1694 writes AUDxVOL = 0 and skips the row */
  off: boolean
  /** $29/$2a(a0) — command 5 and A's slide nibbles, applied every frame */
  slideUp: number
  slideDown: number
  /** $2e(a0) — commands 1, 2 and 3's slide speed */
  slideSpeed: number
  /** $34/$35(a0) — sliding at all, and whether there is a target */
  sliding: boolean
  slideDir: boolean
  /** $44(a0) — command 9's waveform offset, already shifted */
  waveOffset: number
  /** $58/$59(a0) — command E-D, note delay: the tick and its flag */
  delayTick: number
  delaying: boolean
  /** $5a/$5b(a0) — command E-C, note cut */
  cutTick: number
  cutting: boolean
  /** $50(a0) — a filter position command 4 left pending for command 0 */
  filterTarget: number
  /** $44(a0) — the pulse width, 1..63, folded about 32 when it is read */
  squareTarget: number
  /** the instrument the last note took, 1-based; 0 for none */
  instrument: number
  /** $15(a0) — the instrument's wave length, a shift count */
  waveLength: number

  /* ---- the envelope, $4-$e ---- */
  /** $4(a0) — the running volume, 8.8, and the first term of the chain */
  envVolume: number
  /** $6/$7/$8/$9 — attack, decay, sustain and release frames, counted down */
  attackFrames: number
  decayFrames: number
  sustainFrames: number
  releaseFrames: number
  /** $a/$c/$e — the per-frame ramps, signed */
  attackRamp: number
  decayRamp: number
  releaseRamp: number
  /** what the note is playing; null before the first one */
  ins: ThxInstrument | null

  /* ---- the note, $16-$1a ---- */
  /** $16(a0) — the PLAYLIST's note, which is an offset onto the track's */
  playNote: number
  /** $28(a0) — bit 6 of a playlist word: take the playlist note as it stands */
  fixedNote: boolean
  /** $1a(a0) — the vibrato's period offset */
  vibrato: number
  /** $1e/$1f(a0) — the note volume, $40 at note-on; term three of the chain */
  noteVolume: number

  /* ---- the waveform, $14-$24 ---- */
  /** $14(a0) — 0 triangle, 1 sawtooth, 2 square, 3 noise */
  waveKind: number
  /** $22(a0) — the buffer wants rewriting */
  waveChanged: boolean
  /** $23(a0) — the square wants rebuilding out of the bank */
  squareChanged: boolean
  /** $24(a0) — the pulse width folded past 32, so the wave is mirrored */
  squareMirrored: boolean
  /** $25(a0) — swallow the next playlist command 3 */
  squareSkip: boolean
  /** the 128 bytes $68(a0) holds: the square, resampled to the wave length */
  squareBuffer: Int8Array

  /* ---- the hard cut, $2b-$2d ---- */
  /** $2b(a0) — instrument byte $e bits 4-6: cut this many frames before the next note */
  hardCut: number
  /** $2c(a0) — bit 7 of the same byte: release into it rather than stopping dead */
  hardCutRelease: boolean
  /** $2d(a0) — how many frames the release has */
  hardCutFrames: number

  /* ---- the slides, $30-$3a ---- */
  /** $30(a0) — the tone portamento's running offset */
  slideOffset: number
  /** $32(a0) — where it is heading */
  slideTarget: number
  /** $36/$38/$3a — the playlist's own period slide */
  periodSlide: number
  periodOffset: number
  periodSliding: boolean

  /* ---- the vibrato, $3b-$3e ---- */
  vibratoDelay: number
  vibratoPos: number
  vibratoDepth: number
  vibratoSpeed: number

  /* ---- square modulation, $3f-$46 ---- */
  squareMod: boolean
  squareModInit: boolean
  squareModCount: number
  squareMin: number
  squareMax: number
  squarePos: number
  squareStep: number
  squareFlip: boolean

  /* ---- filter modulation, $47-$50 ---- */
  filterMod: boolean
  filterModInit: boolean
  filterModCount: number
  filterMin: number
  filterMax: number
  /** $4c(a0) — 1..63 with 32 dry, and what picks the set out of the bank */
  filterPos: number
  filterStep: number
  /** $4e(a0) — the speed nibble, plus bit 5 and bit 6 out of bytes $c and $13 */
  filterFlags: number
  filterFlip: boolean

  /* ---- the playlist, $51-$54 ---- */
  playPos: number
  playSpeed: number
  playCount: number

  /** $64/$66(a0) — what $1618 writes to AUDxPER and AUDxVOL */
  period: number
  outVolume: number
  /** what the sink was last told, so a frame only writes on a change */
  lastFreq: number
  lastVol: number
  lastWave: Int8Array | null
}

const newChannel = (): ThxChannel => ({
  track: 0,
  nextTrack: 0,
  transpose: 0,
  note: 0,
  volume: 0,
  volumeC: 0x40,
  noteStruck: false,
  off: false,
  slideUp: 0,
  slideDown: 0,
  slideSpeed: 0,
  sliding: false,
  slideDir: false,
  waveOffset: 0,
  delayTick: 0,
  delaying: false,
  cutTick: 0,
  cutting: false,
  filterTarget: 0,
  squareTarget: 0,
  instrument: 0,
  waveLength: 0,
  envVolume: 0,
  attackFrames: 0,
  decayFrames: 0,
  sustainFrames: 0,
  releaseFrames: 0,
  attackRamp: 0,
  decayRamp: 0,
  releaseRamp: 0,
  ins: null,
  playNote: 0,
  fixedNote: false,
  vibrato: 0,
  noteVolume: 0,
  waveKind: 0,
  waveChanged: false,
  squareChanged: false,
  squareMirrored: false,
  squareSkip: false,
  squareBuffer: new Int8Array(128),
  hardCut: 0,
  hardCutRelease: false,
  hardCutFrames: 0,
  slideOffset: 0,
  slideTarget: 0,
  periodSlide: 0,
  periodOffset: 0,
  periodSliding: false,
  vibratoDelay: 0,
  vibratoPos: 0,
  vibratoDepth: 0,
  vibratoSpeed: 0,
  squareMod: false,
  squareModInit: false,
  squareModCount: 0,
  squareMin: 0,
  squareMax: 0,
  squarePos: 0,
  squareStep: 0,
  squareFlip: false,
  filterMod: false,
  filterModInit: false,
  filterModCount: 0,
  filterMin: 0,
  filterMax: 0,
  filterPos: 32,
  filterStep: 0,
  filterFlags: 0,
  filterFlip: false,
  playPos: 0,
  playSpeed: 0,
  playCount: 0,
  period: 0,
  outVolume: 0,
  lastFreq: -1,
  lastVol: -1,
  lastWave: null,
})

export class ThxPlayer {
  private module: ThxModule | null = null

  /** $4(a6) — the flag the frame routine returns on at $a52 */
  playing = false
  /** $3(a6) — set at $b4c when the position wraps, and what `Thx End` reads */
  ended = false
  /** $448(a6) */
  position = 0
  /** $446(a6) */
  row = 0
  /** $3aa(a6), counted DOWN at $afc */
  tickCount = 0
  /** $3ae(a6) — the reload, and command F writes its low byte */
  speed = 6
  /**
   * $0(a6) — what command 8 writes, and NOTHING READS.
   *
   * `clr.b $0(a6)` in StartSong and `move.b $2(a1,d0.l),$0(a6)` in the row
   * handler are the only two instructions in either library that touch it. The
   * volume chain at $148e does not, and neither does anything else: grepping
   * both disassemblies for the byte finds two writes and no read at all.
   *
   * So command 8 is dead. It is kept because a program can still issue it and
   * because saying "written and never read" needs somewhere to say it, but it
   * takes no part in `writeVoices`.
   */
  masterVolume = 0
  /**
   * $1(a6) — the GLOBAL volume, which is a different byte from the master.
   *
   * `move.b #$40,$1(a6)` at Jotre's $776 sets it and only an extension keyword
   * writes it afterwards: thx-0.6's `Thx Volume` at $1140 and Jotre's `Volume
   * Thx`. It is the last multiply of the chain at $149c, which is
   *
   *     mulu.w $1e(a0),d0 / lsr.w #$6,d0      the envelope
   *     mulu.w $20(a0),d0 / lsr.w #$6,d0      the per-channel scale
   *     mulu.w $1(a6),d0  / lsr.w #$6,d0      this
   *     move.w d0,$66(a0)                     and $1618 writes it to AUDxVOL
   *
   * so it scales everything and 64 is unity. The two middle terms are
   * synthesis state and arrive with stage 4.
   */
  playerVolume = 0x40

  /** $3ac(a6) — the next frame takes a new row from the position table */
  private newRow = true
  /** $3b0(a6) — a break is pending, so the row counter is not consulted */
  private breaking = false
  /** $3b6/$3b8(a6) — where $b2a takes the next position and row from */
  private nextPosition = 0
  private nextRow = 0

  readonly channels: ThxChannel[] = [newChannel(), newChannel(), newChannel(), newChannel()]

  /** as `Protracker` does, because a Runtime's `host.audio` can be replaced between frames */
  constructor(private readonly sinkOf: () => AudioSink | undefined) {}

  private get sink(): AudioSink | undefined {
    return this.sinkOf()
  }

  /**
   * `StartSong` at $8d0 — the subsong resolves through the module's table and
   * everything else resets.
   *
   * The constants are the routine's: `move.w #$6,$3ae(a6)` is a speed of six,
   * `st.b $3ac(a6)` arms the first row, and `clr.w $446(a6)` starts on row
   * zero. `sf.b $3(a6)` is what clears a previous run's end flag.
   */
  load(module: ThxModule, subSong = 0): void {
    this.module = module
    this.position = thxSubSongPosition(module, subSong)
    this.row = 0
    this.tickCount = 0
    this.speed = 6
    // `clr.b $0(a6)` at $90c --- and note it CLEARS rather than restoring $40,
    // which costs nothing only because nothing reads it
    this.masterVolume = 0
    this.ended = false
    this.newRow = true
    this.breaking = false
    this.nextPosition = 0
    this.nextRow = 0
    // `$93c` clears $e8 bytes a channel and puts back exactly three things:
    // $27 (off), $5c (the chip buffer) and $20 = $40. So a muted channel stays
    // muted across a StartSong, which is why `off` is carried over here.
    for (let v = 0; v < 4; v++) {
      const wasOff = this.channels[v]?.off ?? false
      this.channels[v] = newChannel()
      this.channels[v]!.off = wasOff
    }
    this.playing = true
  }

  /** `StopSong` at $962, minus the hardware teardown: silence the four voices */
  stop(): void {
    this.playing = false
    for (let v = 0; v < 4; v++) this.sink?.stop(v)
  }

  /**
   * One frame, which is `$a3a`.
   *
   * `tst.w $4(a6) / beq` returns before anything when the song is not playing,
   * so a stopped replayer does not even count its tick down.
   */
  tick(): void {
    if (!this.playing || !this.module) return

    // $a74: only when the counter has run out does a row happen
    if (this.tickCount === 0) {
      if (this.newRow) this.takePosition()
      for (let v = 0; v < 4; v++) this.playRow(v)
      // `move.w $3ae(a6),$3aa(a6)` --- reload from the speed
      this.tickCount = this.speed
    }

    // $aec: the between-tick pass runs on EVERY frame, row or not
    for (let v = 0; v < 4; v++) this.tickChannel(v)

    // $afc: `subi.w #$1,$3aa(a6) / bne` --- the advance runs only on the last tick
    this.tickCount = (this.tickCount - 1) & 0xffff
    if (this.tickCount === 0) this.advance()

    this.writeVoices()
  }

  /**
   * `$a84-$ace` — hand each channel its track and transpose for this position.
   *
   * The position entry is eight bytes and the channels are read out in order,
   * which is the `lsl.w #$3,d2` this port's parser already follows.
   */
  private takePosition(): void {
    const m = this.module!
    const pos = m.positions[this.position]
    // `$a8c-$a98`: the NEXT position too, wrapping at the song length, because
    // the hard-cut lookahead needs a track for the row after the last one
    let next = this.position + 1
    if (next === m.songLength) next = 0
    const nextPos = m.positions[next]
    for (let v = 0; v < 4; v++) {
      const p = pos?.[v]
      this.channels[v]!.track = p?.track ?? 0
      this.channels[v]!.transpose = p?.transpose ?? 0
      this.channels[v]!.nextTrack = nextPos?.[v]?.track ?? 0
    }
    this.newRow = false
  }

  /** the step this channel's track holds at the current row, or an empty one */
  private stepFor(ch: ThxChannel): ThxStep {
    const m = this.module!
    const track = m.tracks[ch.track]
    return track?.[this.row] ?? { note: 0, instrument: 0, command: 0, data: 0 }
  }

  /**
   * The row handler at `$b60`, for one channel.
   *
   * `tst.b $27(a0) / bne $f3e` is the first instruction: a channel that is off
   * reads no row at all, so its commands do not run and its note does not
   * strike. Reproduced.
   */
  private playRow(v: number): void {
    const ch = this.channels[v]!
    if (ch.off) return
    // `clr.b $29(a0) / clr.b $2a(a0)` --- the slide nibbles clear every row
    ch.slideUp = 0
    ch.slideDown = 0

    const step = this.stepFor(ch)
    const cmd = step.command
    const arg = step.data

    // $ba2: command E is two sub-commands in the argument's high nibble, and
    // both are bounded by the SPEED --- `cmp.b $3af(a6),d6 / bge` skips a tick
    // number the row will never reach. $3af is the low byte of the speed word.
    if (cmd === 0xe) {
      const sub = arg >> 4
      const at = arg & 0xf
      if (sub === 0xc && at < (this.speed & 0xff)) {
        ch.cutTick = at
        if (at !== 0) ch.cutting = true
      }
      if (sub === 0xd) {
        // `tst.b $59(a0) / bne` --- a delay already in flight CANCELS rather
        // than restarting, and $bec returns before the note is even read
        if (ch.delaying) {
          ch.delaying = false
          return
        }
        if (at < (this.speed & 0xff)) {
          ch.delayTick = at
          if (at !== 0) ch.delaying = true
          return
        }
      }
    }

    // $bf2: command 0 with a low nibble of 1..9 writes the NEXT POSITION. Not
    // arpeggio --- both replayers write `$3b6(a6)` and neither touches a note.
    //
    // On its own it does nothing, and that is not a bug here. The ordinary
    // advance at $b1e is `move.w $448(a6),$3b6(a6) / addi.w #$1` and it
    // overwrites the value unconditionally, so the only way the write survives
    // is for something in the SAME row to set the break flag, which only
    // commands B and D do. What it is really for is seeding command B: $c5a
    // reads `$3b6(a6)` back and multiplies it by 100, so a command 0 on an
    // earlier channel supplies the hundreds digit of a later channel's jump.
    if (cmd === 0 && arg !== 0 && (arg & 0xf) <= 9) this.nextPosition = arg & 0xf

    // $c0e --- the master, which command C's middle range also writes
    if (cmd === 8) this.masterVolume = arg

    // $c1a: break to a row, and the argument is DECIMAL --- `lsr.b #$4 /
    // mulu.w #$a / add.b` reads $23 as twenty-three, not as $23
    if (cmd === 0xd) {
      this.nextPosition = (this.position + 1) & 0xffff
      const r = (arg >> 4) * 10 + (arg & 0xf)
      // `cmp.w $3b8(a6),d6 / bgt / clr.w` --- past the track, start at 0
      this.nextRow = this.module!.trackLength > r ? r : 0
      this.breaking = true
    }

    // $c54: position jump, decimal again and built on whatever $3b6 already
    // held --- `move.w $3b6(a6),d5 / mulu.w #$64,d5` makes it three digits
    if (cmd === 0xb) {
      this.nextPosition = (this.nextPosition * 100 + (arg >> 4) * 10 + (arg & 0xf)) & 0xffff
      this.breaking = true
    }

    // $c82: `move.b d5,$3af(a6)` writes the LOW BYTE of the speed word, so a
    // speed above 255 is not expressible and 0 stops the row clock dead
    if (cmd === 0xf) this.speed = (this.speed & 0xff00) | arg

    // $c8e: 5 and A both load the slide nibbles; 5 additionally continues a
    // tone portamento, which is why it appears twice
    if (cmd === 5 || cmd === 0xa) {
      ch.slideUp = arg >> 4
      ch.slideDown = arg & 0xf
    }

    this.takeInstrument(ch, step)

    // $e20: command 9 shifts by the instrument's wave length, so the offset
    // means the same fraction of the waveform whatever its size
    if (cmd === 9) ch.waveOffset = arg >>> Math.max(0, 5 - ch.waveLength)

    // $e3e: command 4 splits at $40 --- below is one target, above is the
    // other with $40 taken off. Jotre gates the whole command on a flag at
    // $43e(a6) that thx-0.6 has no equivalent of.
    if (cmd === 4) {
      if (arg < 0x40) ch.squareTarget = arg
      else ch.filterTarget = arg - 0x40
    }

    this.takeNote(ch, step, cmd, arg)

    // $ec6 and $ee0: portamento up NEGATES and portamento down does not, and
    // both clear the direction flag that command 3 sets
    if (cmd === 1) {
      ch.slideSpeed = (-arg) & 0xffff
      ch.sliding = true
      ch.slideDir = false
    }
    if (cmd === 2) {
      ch.slideSpeed = arg
      ch.sliding = true
      ch.slideDir = false
    }

    // $ef8: command C is THREE ranges over one byte
    if (cmd === 0xc) this.commandC(v, arg)
  }

  /**
   * `$cae-$cd4` — the note's instrument, six bits and one-based.
   *
   * `bmi` on the decremented value is how instrument 0 means "keep playing the
   * one already there", and Jotre adds `tst.l a3 / beq` at $cd8 so an
   * instrument number past the end of the module is ignored rather than
   * followed into whatever the pointer array happened to hold. thx-0.6 has no
   * such test and would take the jump.
   *
   * The envelope is NOT run here. Stage 4 of #117 is what reads the ramps the
   * parser already names.
   */
  private takeInstrument(ch: ThxChannel, step: ThxStep): void {
    if (step.instrument === 0) return
    const ins = this.module!.instruments[step.instrument - 1]
    if (!ins) return
    ch.instrument = step.instrument
    ch.ins = ins
    ch.waveLength = ins.waveLength
    const h = ins.header
    // `move.w #$40,$1e(a0)` at $cba, then `clr.w $2e / $30 / $32` --- the note
    // volume goes to full and the three slide accumulators clear
    ch.noteVolume = 0x40
    ch.slideSpeed = 0
    ch.slideOffset = 0
    ch.slideTarget = 0
    ch.sliding = false
    ch.slideDir = false
    // `clr.w $4(a0)` at $cd4 --- the envelope starts SILENT and climbs, which
    // is why a THX note has an attack even when its first frame says $40
    ch.envVolume = 0
    // the ADSR: a frame count and a target level a stage, `(next - prev) << 8
    // / frames` a ramp. Frames of zero would divide by zero on the machine
    // too; `|| 1` keeps the arithmetic finite and the stage still ends at once.
    ch.attackFrames = h[2]!
    ch.attackRamp = word((h[3]! << 8) / (h[2]! || 1))
    ch.decayFrames = h[4]!
    ch.decayRamp = word(((h[5]! - h[3]!) << 8) / (h[4]! || 1))
    ch.sustainFrames = h[6]!
    ch.releaseFrames = h[7]!
    ch.releaseRamp = word(((h[8]! - h[5]!) << 8) / (h[7]! || 1))
    // `move.b $0(a3),$1d(a0)` at $d46, and $1d is the same byte command C's
    // first range writes at $f3a. So the instrument's byte 0 IS its volume,
    // and a note-on reloads it over whatever command C last set.
    ch.volume = h[0]!
    // `move.b $e(a3),d6 / btst #$7 / sne $2c(a0) / andi.b #$70 / lsr.b #$4`
    ch.hardCutRelease = (h[0xe]! & 0x80) !== 0
    ch.hardCut = (h[0xe]! & 0x70) >> 4
    ch.vibratoDepth = h[0xe]! & 0xf
    ch.vibratoDelay = h[0xd]!
    ch.vibratoSpeed = h[0xf]!
    ch.vibratoPos = 0
    ch.vibrato = 0
    ch.squareSkip = false
    ch.squareFlip = false
    ch.squareModCount = 0
    ch.squarePos = 0
    // bytes $10 and $11 are the pulse-width limits, shifted like command 9 and
    // then SORTED --- `cmp.b d4,d3 / ble / exg.l d3,d4`, so an instrument that
    // names them the wrong way round still sweeps
    const shift = Math.max(0, 5 - ins.waveLength)
    const sqA = h[0x10]! >>> shift
    const sqB = h[0x11]! >>> shift
    ch.squareMin = Math.min(sqA, sqB)
    ch.squareMax = Math.max(sqA, sqB)
    ch.filterMod = false
    ch.filterModInit = false
    ch.filterModCount = 0
    ch.filterFlip = false
    ch.squareMod = false
    ch.squareModInit = false
    // `move.b $1(a3),d6 / lsr.b #$3,d6`, then bit 7 of byte $c becomes bit 5
    // and bit 7 of byte $13 becomes bit 6 --- one nibble of speed with two
    // flags stacked on top of it
    let flags = h[1]! >>> 3
    if ((h[0xc]! & 0x80) !== 0) flags |= 0x20
    if ((h[0x13]! & 0x80) !== 0) flags |= 0x40
    ch.filterFlags = flags
    // and the filter limits are the same pair-and-sort, low seven bits
    const fA = h[0xc]! & 0x7f
    const fB = h[0x13]! & 0x7f
    ch.filterMin = Math.min(fA, fB)
    ch.filterMax = Math.max(fA, fB)
    // `move.b #$20,$4c(a0)` --- 32 is the DRY set, the middle of the bank
    ch.filterPos = 0x20
    ch.filterTarget = 0
    // `move.b $14(a3),$52(a0)` --- frames a playlist entry, and the playlist
    // restarts from its first
    ch.playSpeed = h[0x14]!
    ch.playCount = 0
    ch.playPos = 0
  }

  /**
   * `$e66-$ec4` — the note, which commands 3 and 5 turn into a TARGET.
   *
   * The ordinary path at $eb6 is `rol.w #$6,d1 / andi.w #$3f,d1`, the same six
   * bits the parser reads, and a note of 0 leaves the channel where it is.
   *
   * Under 3 or 5 the note is not taken at all: $e8c looks the CURRENT and the
   * target periods up and stores their difference, so the channel slides
   * rather than jumps. That difference is stored and not acted on here.
   */
  private takeNote(ch: ThxChannel, step: ThxStep, cmd: number, arg: number): void {
    if (cmd === 3 || cmd === 5) {
      // `tst.b / beq` --- command 3 with a zero argument keeps the old speed
      if (cmd === 3 && arg !== 0) ch.slideSpeed = arg
      if (step.note !== 0) {
        ch.sliding = true
        ch.slideDir = true
      }
      return
    }
    if (step.note === 0) return
    ch.note = step.note
    ch.noteStruck = true
  }

  /**
   * `$ef8-$f3a` — command C, three ranges reached by subtracting $50 twice.
   *
   *     <= $40            $1d(a0), this channel's volume
   *     $50..$90          $21(a0) of ALL FOUR channels
   *     $a0..$e0          $21(a0) of this one
   *
   * The two upper ranges write the same field, which is why they are one
   * keyword: $29, $111, $1f9 and $2e1 are the four channel bases $e8 apart
   * plus $21, so the middle range is a broadcast of what the third range sets
   * on its own channel.
   *
   * The gaps are real. $41..$4f, $91..$9f and anything above $e0 fall out of
   * the `bmi`/`bgt` pairs and do nothing at all.
   */
  private commandC(v: number, arg: number): void {
    if (arg <= 0x40) {
      this.channels[v]!.volume = arg
      return
    }
    let d = arg - 0x50
    if (d < 0) return
    if (d <= 0x40) {
      for (let i = 0; i < 4; i++) this.channels[i]!.volumeC = d
      return
    }
    d -= 0x50
    if (d < 0 || d > 0x40) return
    this.channels[v]!.volumeC = d
  }

  /**
   * `$b06-$b56` — the row and position advance.
   *
   * The break flag is tested BEFORE the row counter, so a command B or D in
   * the row that was about to end does not have its jump overwritten by the
   * ordinary wrap. Both arms meet at $b2a.
   *
   * The equality test at $b16 is the same shape as P61's speed compare: a
   * track length the row counter steps past rather than reaches would never
   * end the track. It cannot happen here, because the row only ever rises by
   * one, and it is written as it is because that is what the routine does.
   */
  private advance(): void {
    const m = this.module!
    if (!this.breaking) {
      this.row = (this.row + 1) & 0xffff
      if (m.trackLength !== this.row) return
      this.nextPosition = (this.position + 1) & 0xffff
    }
    this.breaking = false
    this.row = this.nextRow
    this.nextRow = 0
    this.position = this.nextPosition
    this.nextPosition = 0
    // $b42: the wrap sets the flag `Thx End` reads and then RESTARTS, so a
    // song that has ended is still playing --- the guide says so too: "The
    // replayer will restart the module automatically"
    if (this.position === m.songLength) {
      this.ended = true
      this.position = m.restart
    }
    this.newRow = true
  }

  /**
   * The between-tick pass at `$f40`, for one channel. Every frame, row or not.
   *
   * The order is the routine's and it matters in at least two places: the note
   * delay at $1008 calls the ROW HANDLER from inside here, so a delayed note
   * lands mid-frame with the envelope already advanced; and the playlist runs
   * after the envelope, so a playlist entry's volume command applies from the
   * next frame rather than this one.
   */
  private tickChannel(v: number): void {
    const ch = this.channels[v]!
    if (ch.off) return

    this.hardCutLookahead(ch)
    this.hardCutRun(ch)

    // $1008: the note the row handler postponed. `bsr $b60` --- it re-enters
    // the row handler, which finds `delaying` already set and clears it.
    if (ch.delaying) {
      if (ch.delayTick !== 0) ch.delayTick--
      else this.playRow(v)
    }

    this.envelope(ch)

    // $1098: the slide nibbles apply to the CHANNEL volume every frame and
    // accumulate into it, so a command A holds its slope until the next note
    ch.volume = Math.max(0, Math.min(0x40, ch.volume - ch.slideDown + ch.slideUp))

    this.portamento(ch)
    this.vibratoStep(ch)
    this.playlist(ch)

    // $11ea: the playlist's own period slide, which SUBTRACTS
    if (ch.periodSliding) {
      ch.periodOffset = word(ch.periodOffset - ch.periodSlide)
      if (ch.periodOffset !== 0) ch.noteStruck = true
    }

    this.squareModulation(ch)
    this.filterModulation(ch)
    this.buildSquare(ch)
    const wave = this.pickWaveform(ch)
    if (wave) this.pending[v] = wave
    this.computePeriod(ch)
    this.computeVolume(ch)
  }

  /**
   * `$f48-$fb0` — look one row ahead and schedule a cut before the next note.
   *
   * The instrument's byte $e high nibble says how many frames early to stop,
   * and the lookahead reads the NEXT row of this channel's track to find out
   * whether there IS a next note. When the row wraps it reads the next
   * POSITION's track instead, which is why `$ab6` preloads that into the
   * channel at $2 — the only reason that field exists.
   *
   * Only the instrument bits are tested (`andi.w #$3f0,d1`), not the note. So
   * a row that changes instrument without striking a note still triggers a cut.
   */
  private hardCutLookahead(ch: ThxChannel): void {
    if (ch.hardCut === 0) return
    const m = this.module!
    let track = ch.track
    let row = this.row + 1
    if (row === m.trackLength) {
      row = 0
      track = ch.nextTrack
    }
    const step = m.tracks[track]?.[row]
    if (!step || step.instrument === 0) return
    // `move.w $3ae(a6),d1 / sub.b $2b(a0),d1 / bpl / moveq #$0,d1`
    let at = this.speed - ch.hardCut
    if (at < 0) at = 0
    if (!ch.cutting) {
      ch.cutting = true
      ch.cutTick = at
      // `sub.b $3af(a6),d1 / neg.b d1` --- the frames the release then gets
      ch.hardCutFrames = byte(-(at - (this.speed & 0xff)))
    }
    ch.hardCut = 0
  }

  /**
   * `$fb4-$1002` — the cut itself, when its tick arrives.
   *
   * Two shapes, on bit 7 of instrument byte $e. With it set the envelope is
   * rewritten to RELEASE into the instrument's release level over the frames
   * the lookahead measured; without it `move.w #$0,$1c(a0)` zeroes the channel
   * volume outright, which is a hard stop and audibly a click.
   */
  private hardCutRun(ch: ThxChannel): void {
    if (!ch.cutting) return
    if (ch.cutTick !== 0) {
      ch.cutTick = byte(ch.cutTick - 1)
      return
    }
    ch.cutting = false
    if (!ch.hardCutRelease) {
      ch.volume = 0
      return
    }
    const target = (ch.ins?.header[8] ?? 0) << 8
    const frames = ch.hardCutFrames
    ch.releaseFrames = frames
    ch.releaseRamp = word(-Math.trunc((ch.envVolume - target) / (frames || 1)))
    ch.attackFrames = 0
    ch.decayFrames = 0
    ch.sustainFrames = 0
  }

  /**
   * `$1020-$1094` — the ADSR, one stage at a time.
   *
   * Each stage adds its ramp to the 8.8 accumulator and counts a frame off;
   * when the count reaches zero the accumulator is SNAPPED to the stage's
   * declared level rather than left wherever the integer ramp got to. That
   * snap is why an instrument's levels are exact and its slopes are not.
   */
  private envelope(ch: ThxChannel): void {
    const h = ch.ins?.header
    if (!h) return
    if (ch.attackFrames !== 0) {
      ch.envVolume = word(ch.envVolume + ch.attackRamp)
      if (--ch.attackFrames === 0) ch.envVolume = word(h[3]! << 8)
      return
    }
    if (ch.decayFrames !== 0) {
      ch.envVolume = word(ch.envVolume + ch.decayRamp)
      if (--ch.decayFrames === 0) ch.envVolume = word(h[5]! << 8)
      return
    }
    if (ch.sustainFrames !== 0) {
      ch.sustainFrames--
      return
    }
    if (ch.releaseFrames !== 0) {
      ch.envVolume = word(ch.envVolume + ch.releaseRamp)
      if (--ch.releaseFrames === 0) ch.envVolume = word(h[8]! << 8)
    }
  }

  /**
   * `$10b6-$10f0` — the tone portamento, which is where commands 1, 2 and 3
   * all end up.
   *
   * Commands 1 and 2 slide with no target and just accumulate. Command 3 has
   * one, and the overshoot test is the neat part: `d3 = offset - target;
   * d3 += step; d3 ^= (offset - target)` and a set bit 15 means the
   * subtraction changed sign, so the step went past. It snaps to the target
   * rather than oscillating.
   */
  private portamento(ch: ThxChannel): void {
    if (!ch.sliding) return
    let d0 = ch.slideOffset
    let step = ch.slideSpeed
    if (ch.slideDir) {
      const target = ch.slideTarget
      const diff = word(d0 - target)
      if (diff === 0) return
      if (diff >= 0) step = word(-step)
      const crossed = (word(diff + step) ^ diff) & 0x8000
      d0 = crossed !== 0 ? target : word(ch.slideOffset + step)
    } else {
      d0 = word(d0 + step)
    }
    ch.slideOffset = d0
    ch.noteStruck = true
  }

  /**
   * `$10f4-$113c` — vibrato, off the 64-word sine the player built at init.
   *
   * `muls.w` then `asr.w #$7` and the SIGN put back by hand out of the
   * product's high word: the shift is a word operation on a longword product,
   * so it loses the sign, and `or.w d2,d1` with `$8000` restores it. That is
   * not the same as dividing by 128 — a negative product comes back with the
   * magnitude of its low sixteen bits — and it is reproduced rather than
   * tidied, because it is audible on a deep vibrato.
   */
  private vibratoStep(ch: ThxChannel): void {
    const depth = ch.vibratoDepth
    if (depth === 0) return
    if (ch.vibratoDelay !== 0) {
      ch.vibratoDelay = byte(ch.vibratoDelay - 1)
      return
    }
    const product = Math.imul(waveSine()[ch.vibratoPos]!, depth)
    const sign = (product >> 16) & 0x8000
    ch.vibrato = word((word(product) >> 7) | sign)
    ch.noteStruck = true
    // `andi.b #$3f` --- the table is 64 words and the position wraps in it
    ch.vibratoPos = (ch.vibratoPos + ch.vibratoSpeed) & 0x3f
  }

  /**
   * `$113c-$11ea` — one playlist entry, every `playSpeed` frames.
   *
   * A four-byte entry, and the first word is packed four ways:
   *
   *     bits 0-5    a note, ADDED to the track's rather than replacing it
   *     bit 6       take it as an absolute note instead
   *     bits 7-9    the waveform, one-based; 0 leaves it alone
   *     bits 10-12  command A, argument in byte 2
   *     bits 13-15  command B, argument in byte 3
   *
   * The playlist STOPS at its last entry rather than looping — `cmp.b
   * $51(a0),d5 / beq` at $114a compares the position against the instrument's
   * playlist length and falls into a branch that only runs the frame counter
   * down. Looping is what command 5 is for.
   */
  private playlist(ch: ThxChannel): void {
    const ins = ch.ins
    if (!ins) return
    const entries = ins.header[0x15]!
    if (ch.playPos === entries) {
      // $11d8: past the end, and the counter still ticks so a command 5 that
      // jumps back lands on the right frame
      if (ch.playCount === 0) ch.periodSlide = 0
      else ch.playCount = byte(ch.playCount - 1)
      return
    }
    ch.playCount = byte(ch.playCount - 1)
    if (ch.playCount > 0) return

    const at = ch.playPos * 4
    const pl = ins.playlist
    const w = ((pl[at] ?? 0) << 8) | (pl[at + 1] ?? 0)

    // $1160: the waveform, one-based so that zero can mean "keep the last"
    const kind = (w >> 7) & 7
    if (kind !== 0) {
      ch.waveKind = kind - 1
      ch.waveChanged = true
      ch.periodSlide = 0
      ch.periodOffset = 0
    }
    ch.periodSliding = false

    // $1188: command A out of bits 10-12, then command B out of 13-15
    this.playCommand(ch, (w >> 10) & 7, pl[at + 2] ?? 0)
    this.playCommand(ch, (w >> 13) & 7, pl[at + 3] ?? 0)

    // $11a8: the note LAST, so a command in the same entry has already run
    const note = w & 0x3f
    if (note !== 0) {
      ch.playNote = note
      ch.noteStruck = true
      ch.fixedNote = (w & 0x40) !== 0
    }
    ch.playPos++
    ch.playCount = ch.playSpeed
  }

  /**
   * `$14c8-$1616` — the eight playlist commands, dispatched by a chain of
   * `subq.w #$1,d0`.
   *
   *     0  set the filter position, honouring one command 4 left pending
   *     1  slide the period up      2  slide it down
   *     3  set the pulse width      4  toggle square and filter modulation
   *     5  jump to an entry         6  a volume, in the same three ranges as
   *                                    track command C
   *     7  set the playlist speed
   *
   * Command 0 and half of command 4 are gated on `$43e(a6)`, a flag the player
   * sets when it has filter data. It always does here — ../amiga/thxwaves.ts
   * builds the bank unconditionally — so the gate is always open and the
   * cache-file path that could leave it shut is not modelled.
   */
  private playCommand(ch: ThxChannel, cmd: number, arg: number): void {
    switch (cmd) {
      case 0: {
        // $14d2: an argument of zero does nothing at all
        if (arg === 0) return
        // and a pending position from command 4 wins over the argument
        const want = ch.filterTarget !== 0 ? ch.filterTarget : arg
        ch.filterTarget = 0
        ch.filterPos = want
        ch.waveChanged = true
        return
      }
      case 1:
        ch.periodSlide = arg
        ch.periodSliding = true
        return
      case 2:
        ch.periodSlide = word(-arg)
        ch.periodSliding = true
        return
      case 3:
        // $1520: a pending skip swallows this one and clears itself
        if (ch.squareSkip) {
          ch.squareSkip = false
          return
        }
        ch.squareTarget = arg >>> Math.max(0, 5 - ch.waveLength)
        return
      case 4: {
        // $1546: with no argument it is a plain square-modulation toggle
        if (arg === 0) {
          ch.squareMod = !ch.squareMod
          ch.squareModInit = ch.squareMod
          ch.squareStep = 1
          return
        }
        const low = arg & 0xf
        if (low !== 0) {
          ch.squareMod = !ch.squareMod
          ch.squareModInit = ch.squareMod
          ch.squareStep = 1
          // $f in the nibble means start the sweep the other way
          if (low === 0xf) ch.squareStep = -1
        }
        const high = arg >> 4
        if (high !== 0) {
          ch.filterMod = !ch.filterMod
          ch.filterModInit = ch.filterMod
          ch.filterStep = 1
          if (high === 0xf) ch.filterStep = -1
        }
        return
      }
      case 5:
        // $15b0: one-based, and the position is set one BEHIND so the next
        // pass reads the entry the argument names
        ch.playPos = byte(arg - 1)
        return
      case 6: {
        // the same three ranges as track command C, and the same two
        // subtractions --- but the middle range writes $1f and not $21
        if (arg <= 0x40) {
          ch.volume = arg
          return
        }
        let d = arg - 0x50
        if (d < 0) return
        if (d <= 0x40) {
          ch.noteVolume = d
          return
        }
        d -= 0x50
        if (d < 0 || d > 0x40) return
        ch.volumeC = d
        return
      }
      case 7:
        ch.playSpeed = arg
        ch.playCount = arg
        return
      default:
        return
    }
  }

  /**
   * `$1202-$1282` — the pulse width walking between its two limits.
   *
   * Only on a square, and only while the modulation flag is on. The limits
   * came off instrument bytes $10 and $11 already sorted, and the walk
   * reverses at each end. `squareFlip` is what stops it reversing twice on the
   * frame it arrives: the init pass sets it, and the first end-hit spends it.
   */
  private squareModulation(ch: ThxChannel): void {
    if (ch.waveKind !== 2) return
    if (!ch.squareMod) return
    ch.squareModCount = byte(ch.squareModCount - 1)
    if (ch.squareModCount > 0) return
    const min = ch.squareMin
    const max = ch.squareMax
    let pos = ch.squarePos
    if (ch.squareModInit) {
      ch.squareModInit = false
      if (pos <= min) {
        ch.squareFlip = true
        ch.squareStep = 1
      } else if (pos >= max) {
        ch.squareFlip = true
        ch.squareStep = -1
      }
    }
    if (pos === min || pos === max) {
      if (ch.squareFlip) ch.squareFlip = false
      else ch.squareStep = byte(-ch.squareStep)
    }
    pos = byte(pos + ch.squareStep)
    ch.squarePos = pos
    ch.squareChanged = true
    // `move.b $12(a3),$41(a0)` --- instrument byte $12 is the modulation speed
    ch.squareModCount = ch.ins?.header[0x12] ?? 0
  }

  /**
   * `$1282-$1318` — the filter position walking between ITS two limits.
   *
   * Same shape as the square, with one difference that matters: it can step
   * more than once per update. `moveq #$4,d5 / sub.b d4,d5` makes the inner
   * `dbra` run `5 - speed` times when the speed nibble is below 4, so a fast
   * filter sweep moves several positions a frame rather than waiting fewer
   * frames. The reload is `max(1, speed - 3)` on the other side of the same
   * number.
   */
  private filterModulation(ch: ThxChannel): void {
    if (!ch.filterMod) return
    ch.filterModCount = byte(ch.filterModCount - 1)
    if (ch.filterModCount > 0) return
    const min = ch.filterMin
    const max = ch.filterMax
    let pos = ch.filterPos
    if (ch.filterModInit) {
      ch.filterModInit = false
      if (pos <= min) {
        ch.filterFlip = true
        ch.filterStep = 1
      } else if (pos >= max) {
        ch.filterFlip = true
        ch.filterStep = -1
      }
    }
    const speed = ch.filterFlags
    const steps = speed < 4 ? 4 - speed : 0
    for (let i = 0; i <= steps; i++) {
      if (pos === min || pos === max) {
        if (ch.filterFlip) ch.filterFlip = false
        else ch.filterStep = byte(-ch.filterStep)
      }
      pos = byte(pos + ch.filterStep)
    }
    ch.filterPos = pos
    ch.waveChanged = true
    ch.filterModCount = Math.max(1, byte(speed - 3))
  }

  /**
   * `$1318-$13a6` — resample the chosen pulse width down to the instrument's
   * wave length.
   *
   * The bank stores every square at 128 bytes, and an instrument that wants a
   * 4-byte waveform takes every 32nd sample of one. `d5 = $20 >> waveLength`
   * is that stride and `d6 = (1 << waveLength) - 1` the longword count, so the
   * result is `4 << waveLength` bytes covering the same 128.
   *
   * The width FOLDS at 32: the bank holds duty 1/64 to 32/64 and a wider pulse
   * is the same wave upside down, so `move.w #$40,d2 / sub.w d1,d2` mirrors it
   * and sets a flag that nothing here reads back.
   */
  private buildSquare(ch: ThxChannel): void {
    if (ch.waveKind !== 2 && !ch.squareChanged) return
    const set = (ch.filterPos - 0x20 + THX_FILTER_COUNT) * THX_SET_BYTES
    let width = word(ch.squareTarget << Math.max(0, 5 - ch.waveLength))
    if (width > 0x20) {
      width = word(0x40 - width)
      ch.squareMirrored = true
    }
    width = Math.max(0, width - 1)
    const base = set + THX_OFF_SQUARES + width * 128
    const b = waveBank()
    const stride = 0x20 >>> ch.waveLength
    const longs = 1 << ch.waveLength
    let at = base
    let out = 0
    for (let i = 0; i < longs; i++) {
      for (let k = 0; k < 4; k++) {
        ch.squareBuffer[out++] = (b[at] ?? 0) << 24 >> 24
        at += stride
      }
    }
    ch.waveChanged = true
    ch.squareChanged = false
  }

  /**
   * `$13aa-$1432` — which bytes the voice plays.
   *
   * Four families reached through the pointer table at `$556`, then the
   * filtered set picked by `(filterPos - 32) * 6520` — which is the whole
   * reason the bank is laid out with the dry set in the middle. A square skips
   * that step because `buildSquare` already applied the filter when it copied.
   *
   * Noise is re-pointed EVERY frame from a running pseudo-random offset masked
   * to $4ff, which is why $13b2 forces the changed flag for it. That is what
   * stops a THX noise instrument sounding like a 640-byte loop.
   */
  private pickWaveform(ch: ThxChannel): Int8Array | null {
    if (ch.waveKind === 3) ch.waveChanged = true
    if (!ch.waveChanged) return null
    const b = waveBank()
    const dry = (ch.filterPos - 0x20 + THX_FILTER_COUNT) * THX_SET_BYTES
    const out = new Int8Array(THX_VOICE_BYTES)
    if (ch.waveKind === 2) {
      // the square is already filtered and already the right length
      const len = 4 << ch.waveLength
      for (let i = 0; i < THX_VOICE_BYTES; i++) out[i] = ch.squareBuffer[i % len]!
      return out
    }
    if (ch.waveKind === 3) {
      // `andi.w #$4ff,d1` then the LCG at $1416 --- 1,280 possible starts in a
      // 1,920-byte table, so the 640 bytes taken never run off the end
      const off = this.noiseRng & 0x4ff
      this.stepNoiseRng()
      const at = dry + THX_OFF_NOISE + off
      for (let i = 0; i < THX_VOICE_BYTES; i++) out[i] = (b[at + i] ?? 0) << 24 >> 24
      return out
    }
    const family = ch.waveKind === 0 ? 0 : THX_OFF_SAWTOOTHS
    const at = dry + family + (WAVE_LENGTH_OFFSET[ch.waveLength] ?? 0)
    const len = 4 << ch.waveLength
    for (let i = 0; i < THX_VOICE_BYTES; i++) out[i] = (b[at + (i % len)] ?? 0) << 24 >> 24
    return out
  }

  /**
   * `$1436-$148a` — the note, and everything that bends it.
   *
   * The playlist's note is an OFFSET onto the track's, not a replacement:
   * `$16(a0) + transpose + ($18(a0) - 1)`. Bit 6 of the playlist word turns
   * that off and takes the playlist note alone, which is how a drum kit plays
   * one pitch whatever the track says.
   *
   * The clamp is to the period table's own ends, 113 and 3424, so a slide can
   * run off neither.
   */
  private computePeriod(ch: ThxChannel): void {
    let n = ch.playNote
    if (!ch.fixedNote) n = word(n + ch.transpose + (ch.note - 1))
    if (n > THX_MAX_NOTE) n = THX_MAX_NOTE
    if (n < 0) n = 0
    let p = THX_PERIODS[n] ?? 0
    if (!ch.fixedNote) p = word(p + ch.slideOffset)
    p = word(p + ch.periodOffset + ch.vibrato)
    if (p > 0xd60) p = 0xd60
    if (p < 0x71) p = 0x71
    ch.period = p
  }

  /**
   * `$148e-$14b6` — five terms, each divided by 64.
   *
   * The envelope's own volume is the high byte of the 8.8 accumulator, and it
   * starts at ZERO on a note-on, so a THX voice really is silent until its
   * attack has run. That is the thing stage 1 could not model and this can.
   */
  private computeVolume(ch: ThxChannel): void {
    let d = (ch.envVolume >> 8) & 0xff
    d = (d * ch.volume) >> 6
    d = (d * ch.noteVolume) >> 6
    d = (d * ch.volumeC) >> 6
    d = (d * this.playerVolume) >> 6
    ch.outVolume = clampVolume(d)
  }

  /**
   * The waveform `pickWaveform` built this frame, waiting for `writeVoices`.
   *
   * Split in two because the routine is: `$13aa` chooses the bytes and sets
   * the flag, and `$1618` is what copies them into the chip buffer. Keeping
   * that order means an off channel picks a waveform it never plays, exactly
   * as the machine does.
   */
  private readonly pending: (Int8Array | null)[] = [null, null, null, null]

  /** `$3ba(a6)` — the noise pointer's own generator, stepped at $1416 */
  private noiseRng = 0

  private stepNoiseRng(): void {
    let d = (this.noiseRng + 0x222b98) | 0
    d = ((d >>> 8) | (d << 24)) | 0
    d = (d + 0xbeff3) | 0
    d = (d & ~0xff) | ((d ^ 0x4b) & 0xff)
    d = (d - 0x1a4f) | 0
    this.noiseRng = d
  }

  /**
   * `$1618` — what the four voices are actually told.
   *
   * AUDxVOL is written every frame on the machine; here it is written only on
   * a change, because `NullAudio` records every call and a test reading the
   * event stream wants the changes rather than fifty identical writes a
   * second. `lastVol` is what makes that safe, exactly as in `protracker.ts`.
   *
   * The volume is TWO of the chain's five terms. `$148e` is
   *
   *     move.b $4(a0),d0        the envelope's own volume
   *     mulu.w $1c(a0),d1 / lsr.w #$6      this channel's volume
   *     mulu.w $1e(a0),d1 / lsr.w #$6      the note's
   *     mulu.w $20(a0),d1 / lsr.w #$6      command C's other two ranges
   *     mulu.w $1(a6),d1  / lsr.w #$6      the global
   *
   * and the first, third and fourth are synthesis state that stage 4 of #117
   * fills in. Until then they stand at unity rather than at what the machine
   * would hold, which is NOT the same thing: `$4(a0)` starts at zero on the
   * machine, so a real THX voice is silent until its attack runs. A note here
   * is at full volume the frame it strikes.
   */
  private writeVoices(): void {
    const sink = this.sink
    if (!sink) return
    for (let v = 0; v < 4; v++) {
      const ch = this.channels[v]!

      // `tst.b $26(a0) / beq / move.w $64(a0),$6(a3)` --- AUDxPER, on a note
      if (ch.noteStruck) {
        ch.noteStruck = false
        if (ch.period > 0) {
          const hz = periodToHz(ch.period, PAULA_CLOCK)
          if (hz !== ch.lastFreq) {
            ch.lastFreq = hz
            sink.setFrequency(v, hz)
          }
        }
      }

      // `tst.b $22(a0) / beq` --- and then the buffer is rewritten UNDER the
      // running DMA, which is what `setWaveform` is for
      if (ch.waveChanged) {
        ch.waveChanged = false
        const wave = this.pending[v]
        if (wave) {
          this.pending[v] = null
          if (!ch.lastWave) {
            // the voice has nothing playing yet, so this one has to start it.
            // Loops over the whole buffer, which is the chip buffer's own
            // arrangement --- AUDxLC and AUDxLEN never move after this.
            sink.play(v, wave, ch.lastFreq > 0 ? ch.lastFreq : periodToHz(ch.period || 1, PAULA_CLOCK),
              ch.outVolume, 0, wave.length)
            ch.lastVol = ch.outVolume
          } else {
            sink.setWaveform?.(v, wave)
          }
          ch.lastWave = wave
        }
      }

      // `move.w $66(a0),$8(a3)` --- AUDxVOL, and `tst.b $27(a0)` makes an off
      // channel silent rather than stopped
      const vol = ch.off ? 0 : ch.outVolume
      if (vol !== ch.lastVol) {
        ch.lastVol = vol
        sink.setVolume(v, vol)
      }
    }
  }
}
