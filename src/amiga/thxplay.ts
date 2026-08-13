/**
 * The THX replay — the sequencer half.
 *
 * This is the song: positions, rows, the speed counter, the sixteen track
 * commands and the end-of-song flag. The SYNTHESIS is not here yet — no
 * waveform is generated and no envelope runs — so what reaches the sink is
 * period and volume and nothing else. See the header of `./thx.ts` for the
 * module format this steps, and `#117` for what is left.
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
 * forever, and a waveform change overwrites the bytes under it — which is why
 * `play()` would be wrong here and `setWaveform()` is right. The buffer is 640
 * bytes whatever the waveform length: the tiling loop at $1658 runs
 * `(1 << waveLength)` longs `(1 << (5 - waveLength)) * 5` times, and those
 * cancel to 4 * 5 * 32 for every length. Noise is the exception and is copied
 * whole at $1676, 80 iterations of eight bytes.
 */
import { clampVolume, periodToHz, PAULA_CLOCK } from './paula'
import type { AudioSink } from './host'
import type { ThxModule, ThxStep } from './thx'
import { thxSubSongPosition } from './thx'

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
 * them is written by the row handler at $b60 or read by the hardware pass at
 * $1618. The ones this file only STORES are marked — they are the synthesis
 * state, and stage 4 of #117 is what makes them do anything.
 */
export interface ThxChannel {
  /** $0(a0) — the track this position gives the channel */
  track: number
  /** $1(a0) — the position's transpose, signed */
  transpose: number
  /** $18(a0) — 1..60 into THX_PERIODS, 0 for none */
  note: number
  /** $1d(a0) — the channel's own volume, 0..$40 */
  volume: number
  /** $21(a0) — command C's third range, $a0..$e0. STORED ONLY */
  volumeC: number
  /** $26(a0) — a note was struck, so AUDxPER wants writing */
  noteStruck: boolean
  /** $27(a0) — the channel is off: $1694 writes AUDxVOL = 0 and skips the row */
  off: boolean
  /** $29/$2a(a0) — command 5 and A's slide nibbles. STORED ONLY */
  slideUp: number
  slideDown: number
  /** $2e(a0) — commands 1, 2 and 3's speed. STORED ONLY */
  slideSpeed: number
  /** $34/$35(a0) — the portamento flags. STORED ONLY */
  sliding: boolean
  slideDir: boolean
  /** $44(a0) — command 9's waveform offset, already shifted. STORED ONLY */
  waveOffset: number
  /** $58/$59(a0) — command E-D, note delay: the tick and its flag */
  delayTick: number
  delaying: boolean
  /** $5a/$5b(a0) — command E-C, note cut */
  cutTick: number
  cutting: boolean
  /** $4c/$50(a0) — command 4's two arms. STORED ONLY */
  filterTarget: number
  squareTarget: number
  /** the instrument the last note took, 1-based; 0 for none */
  instrument: number
  /** $15(a0) — the instrument's wave length, a shift count */
  waveLength: number
  /** what the sink was last told, so a frame only writes on a change */
  lastFreq: number
  lastVol: number
}

const newChannel = (): ThxChannel => ({
  track: 0,
  transpose: 0,
  note: 0,
  volume: 0,
  volumeC: 0,
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
  lastFreq: -1,
  lastVol: -1,
})

/** `move.b #$40,$1(a6)` at Jotre's $42c — the master starts at full scale */
const FULL_VOLUME = 0x40

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
  /** $0(a6) — command 8 and command C's middle range */
  masterVolume = 0x40

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
    this.masterVolume = FULL_VOLUME
    this.ended = false
    this.newRow = true
    this.breaking = false
    this.nextPosition = 0
    this.nextRow = 0
    for (let v = 0; v < 4; v++) this.channels[v] = newChannel()
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
    for (let v = 0; v < 4; v++) {
      const p = pos?.[v]
      this.channels[v]!.track = p?.track ?? 0
      this.channels[v]!.transpose = p?.transpose ?? 0
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
    ch.waveLength = ins.waveLength
    // `clr.w $2e(a0) / clr.w $30(a0) / clr.w $32(a0)` at $cc0 --- the three
    // slide accumulators clear on every note-on
    ch.slideSpeed = 0
    ch.sliding = false
    ch.slideDir = false
    // `move.b $0(a3),$1d(a0)` at $d46, and $1d is the same byte command C's
    // first range writes at $f3a. So the instrument's byte 0 IS its volume,
    // and a note-on reloads it over whatever command C last set.
    ch.volume = ins.header[0]!
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
   *     <= $40            the CHANNEL volume
   *     $50..$90          the MASTER, written into all four channels
   *     $a0..$e0          a third per-channel byte at $21(a0)
   *
   * The gaps are real. $41..$4f, $91..$9f and anything above $e0 fall out of
   * the `bmi`/`bgt` pairs and do nothing at all, which is what makes this
   * three ranges rather than one scale.
   */
  private commandC(v: number, arg: number): void {
    if (arg <= 0x40) {
      this.channels[v]!.volume = arg
      return
    }
    let d = arg - 0x50
    if (d < 0) return
    if (d <= 0x40) {
      // `move.b d1,$29(a6) / $111 / $1f9 / $2e1` --- the four channel bases,
      // $e8 apart, so the master lands in every one of them
      this.masterVolume = d
      for (let i = 0; i < 4; i++) this.channels[i]!.volume = d
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
   * `$1618` — what the four voices are actually told.
   *
   * AUDxVOL is written every frame on the machine; here it is written only on
   * a change, because `NullAudio` records every call and a test reading the
   * event stream wants the changes rather than fifty identical writes a
   * second. `lastVol` is what makes that safe, exactly as in `protracker.ts`.
   */
  private writeVoices(): void {
    const sink = this.sink
    if (!sink) return
    for (let v = 0; v < 4; v++) {
      const ch = this.channels[v]!
      // `tst.b $27(a0) / bne -> move.w #$0,$8(a3)` --- off is silent, not stopped
      const vol = ch.off ? 0 : clampVolume((ch.volume * this.masterVolume) >> 6)
      if (vol !== ch.lastVol) {
        ch.lastVol = vol
        sink.setVolume(v, vol)
      }
      if (!ch.noteStruck) continue
      ch.noteStruck = false
      const period = THX_PERIODS[Math.min(THX_MAX_NOTE, Math.max(0, ch.note))] ?? 0
      if (period <= 0) continue
      const hz = periodToHz(period, PAULA_CLOCK)
      if (hz === ch.lastFreq) continue
      ch.lastFreq = hz
      sink.setFrequency(v, hz)
    }
  }
}
