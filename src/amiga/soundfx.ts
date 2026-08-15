/**
 * SoundFX 1.3 — the format and its replay, off `DME_SoundFX1.3.library`.
 *
 * SoundFX is one of the oldest Amiga tracker formats: four channels, fifteen
 * instruments, $400-byte patterns of 64 rows, and an effect set of six
 * commands. This is the first of DME 2.0's ELEVEN external replayers to be
 * read, and it is the smallest of them at 3,476 bytes.
 *
 * ## Evidence
 *
 * `DME_SoundFX1.3.library`, 2,960 bytes loaded at $210000 by `loadHunks`, one
 * $5a4-byte code hunk and one 1,516-byte DATA hunk. The romtag at $210004
 * reads "DME_SoundFX1.3.library 2.0 (25. October 97) DOOM Productions 1997".
 *
 * The interesting half is in the DATA hunk. Hunk 0 is the library veneer: ten
 * LVOs from -30 to -84, each a `movem` around one of the replayer's entry
 * points. Everything from $2105a4 on is the replayer proper, assembled as data
 * because it is a lifted third-party binary rather than the author's own code.
 *
 * The ten vectors, settled against the DME extension's own `jsr` offsets
 * rather than guessed from their order:
 *
 *   -30 $210188  Play        `Sfx13 Play`, routine 127 `jsr -$1e(a6)`
 *   -36 $2101aa  Stop        routine 125 `jsr -$24(a6)`
 *   -42 $2101fc  Song Pos    routine 132 `jsr -$2a(a6)`
 *   -48 $21020c  Vu          routine 135 `jsr -$30(a6)`, channel in d1
 *   -54 $210228  Volume      routine 137 `jsr -$36(a6)`, 0..64 in d0
 *   -60 $21029a  End         routine 136 `jsr -$3c(a6)`
 *   -66 $210242  Next Patt   routine 133 `jsr -$42(a6)`
 *   -72 $210274  Prev Patt   routine 134 `jsr -$48(a6)`
 *   -78 $2101d8  Cont        routine 130 `jsr -$4e(a6)`
 *   -84 $2102bc  Voice       routine 138 `jsr -$54(a6)`, mask in d0
 *
 * `Sfx13 Song Length` calls no vector at all: routine 131 reads the byte out
 * of the module itself.
 *
 * ## The file
 *
 * `InitModule` at $2105a4 is the whole layout in twenty instructions. It sets
 * a0 to module+$3c and works from there, so every displacement below is that
 * $3c plus what the code writes.
 *
 *   $000  15 longs   sample lengths in BYTES, in order
 *   $03c  4 bytes    "SONG", and the only thing `Sfx13 Load` checks
 *   $040  word       the CIA divisor --- stored at $210b02 and NEVER READ
 *   $048  15 x 30    the instrument records, the FIRST of which is unused
 *   $212  byte       how many entries of the sequence are the song
 *   $214  128 bytes  the sequence: which pattern plays at each position
 *   $294  n x $400   the patterns, 64 rows of 4 channels of 4 bytes
 *   ...              the sample data, one run per non-empty length
 *
 * An instrument record is thirty bytes and the code indexes it ONE-BASED off
 * module+$48 (`mulu.w #$1e,d4` with d4 the note's nibble, at $210966), so
 * instrument 1's fields are at $66 and record 0 is never reached. Its name
 * field is what sits at $50 --- the eight bytes before instrument 1's fields
 * are instrument 1's name, and the name of the last instrument runs off the
 * end of the table into the song-length byte. That is the file's own layout,
 * not a misreading: 15 records of 30 bytes from $48 is $1c2, landing exactly
 * on $20a, and the four fields the code reads are the LAST eight bytes of
 * each record.
 *
 *   +$00  22 bytes  name
 *   +$16  word      AUDxLEN for the note-on, in WORDS: the one-shot part
 *   +$18  word      volume, 0..64
 *   +$1a  word      repeat start, in BYTES
 *   +$1c  word      repeat length, in WORDS
 *
 * The one-shot length is not the sample length. For a looped instrument it is
 * the repeat start over two ($108f against a repeat start of $211e in DME's
 * own example); for an unlooped one it is the whole sample in words minus one,
 * with a repeat start of 0 and a repeat length of 1. So an unlooped sample
 * ends by looping its first WORD forever, which is the ordinary Amiga
 * convention and audible only if the composer did not start the sample with
 * two zero bytes.
 *
 * The library means to zero those first four bytes itself and cannot: the loop
 * at $21061e guards `clr.l (a1)` with `cmpa.l $210b0a.l,a1 / bge`, and nothing
 * in the binary ever writes $210b0a. It stays zero, every sample pointer is
 * above it, and the branch is always taken.
 *
 * ## A row
 *
 * Four bytes a channel, read whole with `move.l (a0,d1.l),(a6)` at $21093a:
 *
 *   bytes 0-1  the period, an ordinary Amiga period. 0 is "no note"
 *   byte 2     high nibble the instrument 1..15, low nibble the command
 *   byte 3     the command's parameter
 *
 * Two period values are markers rather than periods, both tested at $210942
 * and $2109f4:
 *
 *   $fffd  leave the voice alone AND clear this channel's command word
 *   $fffe  retrigger with AUDxVOL zero, which is a note off
 *
 * ## The commands
 *
 * Six, and they split across two dispatch points because three of them run
 * once at the row and three run on every tick between rows.
 *
 * At the row ($2109ae), and only when the row names an instrument:
 *
 *   5  volume up   the instrument's own volume plus the parameter, capped 64
 *   6  volume down the same minus it, floored at 0
 *
 * Between rows ($210722), and only while no slide is running:
 *
 *   1  arpeggio    the two nibbles as semitone offsets
 *   2  pitch bend  high nibble adds to the period, else the low nibble subtracts
 *   7  slide down  by the low nibble, toward the high nibble in semitones
 *   8  slide up    the same, upward
 *
 * The arpeggio is NOT ProTracker's. Its jump table at $210a4a is five longs
 * indexed by the tick, and it reads base, x, y, base, y, x over the six ticks
 * of a row rather than the 0,x,y,0,x,y everything else does.
 *
 * ## The tempo
 *
 * Six ticks a row, counted at $210690 (`cmpi.w #$6,$210afa`), and the tick
 * comes from CIA timer A at $21041a: `move.l #$1b19fd,d7 / divu.w #$7d,d7`,
 * which is 1,775,101 over 125 = 14,200. The module's own divisor at +$40 is
 * read into $210b02 by `InitModule` and no instruction anywhere reads it back,
 * so every SoundFX module in this library plays at one fixed rate whatever it
 * asked for. A scan of the relocated image for the address finds the one
 * write at $2105bc and nothing else.
 *
 * That is why the frame loop is a faithful clock here rather than an
 * approximation: the library's own rate is fixed and within a tenth of a
 * percent of 50Hz.
 *
 * It is also the one place this port and libopenmpt disagree, and the
 * disagreement was measured rather than argued. `src/cli/audiocmp.ts` over
 * twenty seconds of DME's own example puts the pitch-class cosine at 0.9997 --
 * the notes are the same -- and the envelope ratio at 0.9808, a 2% tempo gap.
 * That module's divisor is $38a4, which is 709,379/14,500 = 48.92Hz, and
 * re-rendering this side at 48.92Hz instead of 50 moves the ratio to 1.0023.
 * So libopenmpt honours the field and this library does not, which is the
 * explanation confirmed rather than assumed.
 */

import type { AudioSink } from './host'
import { clampVolume, PAULA_CLOCK, periodToHz } from './paula'

/** "SONG" at $3c, and `Sfx13 Load` tests this and nothing else */
export const SFX_MAGIC = 'SONG'
/** where the magic sits */
export const SFX_MAGIC_AT = 0x3c
/** module+$3c+$1d6, the byte `Sfx13 Song Length` reads */
export const SFX_LENGTH_AT = 0x212
/** module+$3c+$1d8, 128 bytes */
export const SFX_SEQUENCE_AT = 0x214
/** module+$3c+$258, where the patterns begin */
export const SFX_PATTERNS_AT = 0x294
/** `lsl.l #$a,d1` at $21085e: one pattern is 64 rows of 4 channels of 4 bytes */
export const SFX_PATTERN_BYTES = 0x400
/** `addi.l #$10,$210af2` at $2108ea */
export const SFX_ROW_BYTES = 0x10
/** `cmpi.w #$6,$210afa` at $210696 */
export const SFX_TICKS_PER_ROW = 6
/** how many instrument records, and how many sample-length longwords */
export const SFX_INSTRUMENTS = 15
/** `mulu.w #$1e,d4` at $210966 */
export const SFX_RECORD_BYTES = 30
/** the record table's base, one-based, so record 0 is never indexed */
export const SFX_RECORDS_AT = 0x48

/**
 * The period table at $210b2e: thirty-six periods from 856 down to 113, then
 * TWELVE more copies of 113, then $ffff.
 *
 * The twelve are the clamp. An arpeggio or a slide that walks up past the top
 * lands on one of them and stops rising rather than reading the terminator as
 * a period, which is what the search loop at $2107e4 would otherwise hand back.
 */
export const SFX_PERIODS: readonly number[] = [
  856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453,
  428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226,
  214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113,
  113, 113, 113, 113, 113, 113, 113, 113, 113, 113, 113, 113,
]

/** the period the row uses to say "leave this voice running, drop its command" */
export const SFX_NOTE_HOLD = 0xfffd
/** the period the row uses to say "note off": retrigger at volume zero */
export const SFX_NOTE_OFF = 0xfffe

export interface SfxSample {
  name: string
  /** the sample's own bytes, sized by its longword in the table at $000 */
  pcm: Int8Array
  /** the record's +$16: AUDxLEN at the note-on, in words */
  oneShotWords: number
  /** the record's +$18, 0..64 */
  volume: number
  /** the record's +$1a, in BYTES */
  repeatStart: number
  /** the record's +$1c, in words; 1 means the sample does not really loop */
  repeatWords: number
}

export interface SfxSong {
  /** fifteen, one-based when a row names them */
  samples: SfxSample[]
  /** the word at +$40 --- stored by `InitModule` and read by nothing */
  delay: number
  /** the byte at +$212: how many sequence entries are the song */
  length: number
  /** the 128 bytes at +$214 */
  sequence: Uint8Array
  /** the pattern block at +$294, `patterns` x $400 bytes */
  patternData: Uint8Array
  /** one more than the largest sequence entry the song reaches ($2105ec) */
  patterns: number
}

const rd16 = (d: Uint8Array, a: number): number => ((d[a] ?? 0) << 8) | (d[a + 1] ?? 0)
const rd32 = (d: Uint8Array, a: number): number =>
  (((d[a] ?? 0) << 24) | ((d[a + 1] ?? 0) << 16) | ((d[a + 2] ?? 0) << 8) | (d[a + 3] ?? 0)) >>> 0

/**
 * `InitModule` at $2105a4, run over a buffer instead of over chip RAM.
 *
 * The pattern count is $2105ec: walk `length` bytes of the sequence, keep the
 * largest, add one, times $400. Note what that means for the sample base --- a
 * sequence entry PAST the song length is never counted, so a module carrying
 * an unused high pattern number has its samples in a different place than a
 * naive "count the patterns" reader would put them.
 *
 * NOT MODELLED: a song length of zero. `subq.w #$1,d2 / dbra` at $2105fe
 * underflows to $ffff and scans 65,536 bytes past the sequence, which puts
 * the samples wherever the largest byte in that stretch says. Here it gives
 * no patterns and no sound.
 */
export function parseSfx(data: Uint8Array): SfxSong | null {
  if (data.length < SFX_PATTERNS_AT) return null
  if (String.fromCharCode(...data.subarray(SFX_MAGIC_AT, SFX_MAGIC_AT + 4)) !== SFX_MAGIC) return null

  const length = data[SFX_LENGTH_AT] ?? 0
  const sequence = data.slice(SFX_SEQUENCE_AT, SFX_SEQUENCE_AT + 0x80)
  let highest = 0
  for (let i = 0; i < length; i++) highest = Math.max(highest, sequence[i] ?? 0)
  const patterns = length === 0 ? 0 : highest + 1
  const patternBytes = patterns * SFX_PATTERN_BYTES
  const patternData = data.slice(SFX_PATTERNS_AT, SFX_PATTERNS_AT + patternBytes)

  const samples: SfxSample[] = []
  let at = SFX_PATTERNS_AT + patternBytes
  for (let i = 0; i < SFX_INSTRUMENTS; i++) {
    const bytes = rd32(data, i * 4)
    const rec = SFX_RECORDS_AT + (i + 1) * SFX_RECORD_BYTES
    const end = Math.min(data.length, at + bytes)
    samples.push({
      name: String.fromCharCode(...data.subarray(rec - 22, rec)).replace(/\0.*$/, ''),
      pcm: new Int8Array(data.buffer, data.byteOffset + Math.min(at, data.length), Math.max(0, end - at)),
      oneShotWords: rd16(data, rec),
      volume: rd16(data, rec + 2),
      repeatStart: rd16(data, rec + 4),
      repeatWords: rd16(data, rec + 6),
    })
    at += bytes
  }
  return { samples, delay: rd16(data, 0x40), length, sequence, patternData, patterns }
}

/** one voice's state: the $16-byte block at $210a5e and the 8 bytes at $21079e */
export interface SfxChannel {
  /** `(a6)`, the row's period word, which command 2 edits in place */
  period: number
  /** `$2(a6)` and `$3(a6)`, the command and its parameter */
  command: number
  param: number
  /** `$10(a6)`, the period a note-on latched, which the arpeggio walks from */
  base: number
  sample: SfxSample | null
  /** `$12(a6)`, the instrument's volume before commands 5 and 6 */
  volume: number
  /** `(a4)`: the slide's step per tick, signed; 0 is no slide */
  slideStep: number
  /** `$2(a4)` and `$4(a4)` */
  slideNow: number
  slideTo: number
}

const newChannel = (): SfxChannel => ({
  period: 0, command: 0, param: 0, base: 0,
  sample: null, volume: 0, slideStep: 0, slideNow: 0, slideTo: 0,
})

/**
 * The replay: one `tick()` is one CIA interrupt, which is $21068c.
 *
 * It drives an `AudioSink` and nothing else. What the caller reads back is
 * `pos`, `end` and `vu`, which is what the four `Sfx13` functions want.
 *
 * DEVIATION: the tick runs from the frame loop, at 50Hz. On the machine it is
 * CIA timer A at 14,200, which the library fixes for every module (see the
 * header) and which works out at just under 50Hz. Nothing in the format can
 * change it, so nothing is lost by not modelling the timer.
 */
export class SoundFx {
  song: SfxSong | null = null
  readonly channels: SfxChannel[] = [newChannel(), newChannel(), newChannel(), newChannel()]

  /** `$210b00`: $ffff plays, 0 does not. Set by Play and Cont, cleared by Stop */
  playing = false
  /** `$210afa`, 0..5 */
  counter = 0
  /** `$210af6`, the sequence index */
  pos = 0
  /** `$210af2`, the byte offset into the pattern, stepping by $10 */
  rowOffset = 0
  /** `$6(a2)`, 0..64, and `$8(a2)` is what Stop saves and Cont restores */
  master = 0x40
  savedMaster = 0x40
  /** the four words at `$a(a2)`..`$10(a2)` as a mask, which `Sfx13 Voice` writes */
  voices = 0b1111
  /** the four bytes at `$21032a`, written by the volume routine and cleared by the read */
  readonly vu = new Uint8Array(4)
  /** `$4(a2)`, set to $ff when the position wraps past the song length */
  end = false

  /**
   * What AUDxVOL currently holds, which is NOT the vu byte.
   *
   * $21033c writes the same number to both, and then `Sfx13 Vu` clears the vu
   * byte and leaves the register alone. A note-on that names no instrument
   * restarts the DMA without touching AUDxVOL, so this is what it plays at.
   */
  private readonly audVol = [0, 0, 0, 0]

  constructor(private readonly sinkOf: () => AudioSink | undefined) {}

  private get sink(): AudioSink | undefined {
    return this.sinkOf()
  }

  /**
   * LVO -30 at $210188: store the module, `InitModule`, then $210636 --- which
   * sets the play flag, kills all four voices and puts the position back to 0.
   */
  load(song: SfxSong): void {
    this.song = song
    this.pos = 0
    this.rowOffset = 0
    this.counter = 0
    this.end = false
    this.vu.fill(0)
    for (let v = 0; v < 4; v++) {
      this.channels[v] = newChannel()
      this.audVol[v] = 0
      this.sink?.stop(v)
    }
    this.playing = true
  }

  /**
   * LVO -36 at $2101aa: $210668 clears the flag, zeroes all four AUDxVOL and
   * writes DMACON $000f.
   *
   * It then saves the master volume and, if that was zero, leaves 64 behind
   * (`tst.w $6(a2) / bne / move.w #$40,$6(a2)`). Cont puts the saved value
   * back, so the 64 is only ever visible while nothing is playing.
   */
  stop(): void {
    this.playing = false
    for (let v = 0; v < 4; v++) {
      this.audVol[v] = 0
      this.sink?.stop(v)
    }
    this.savedMaster = this.master
    if (this.master === 0) this.master = 0x40
  }

  /** LVO -78 at $2101d8: the saved volume back, the flag on, and NOT the position */
  cont(): void {
    this.master = this.savedMaster
    this.playing = true
  }

  /** LVO -66 at $210242. Note it does NOT raise the end flag on the wrap */
  nextPattern(): number {
    this.rowOffset = 0
    this.pos += 1
    if (this.pos === (this.song?.length ?? 0)) this.pos = 0
    return this.pos
  }

  /** LVO -72 at $210274: `subq.l #$1,(a0) / bge`, so 0 goes to length-1 */
  prevPattern(): number {
    this.rowOffset = 0
    this.pos -= 1
    if (this.pos < 0) this.pos = Math.max(0, (this.song?.length ?? 0) - 1)
    return this.pos
  }

  /**
   * LVO -84 at $2102bc: a clear bit zeroes that channel's AUDxVOL and its
   * enable word, and then the whole mask goes to DMACON with bit 15 set.
   *
   * Nothing masks the value first, so a mask above 15 reaches DMACON's other
   * fields. The DME extension does not clamp it either.
   *
   * The write is `ori.w #$8000,d0`, bit 15 SET, so it only ever turns DMA on.
   * A disabled channel keeps its DMA running and is silenced by the AUDxVOL
   * write alone, which is why `stop()` is not called here.
   */
  setVoices(mask: number): void {
    this.voices = mask
    for (let v = 0; v < 4; v++) {
      if (mask & (1 << v)) continue
      this.audVol[v] = 0
      this.sink?.setVolume(v, 0)
    }
  }

  /** LVO -48 at $21020c: `move.b (a2,d7.w),d1 / clr.b (a2,d7.w)` */
  readVu(channel: number): number {
    const n = this.vu[channel] ?? 0
    if (channel >= 0 && channel < 4) this.vu[channel] = 0
    return n
  }

  /** LVO -60 at $21029a: `cmpi.w #$ff,$4(a2)`, and the read clears it */
  readEnd(): boolean {
    const was = this.end
    this.end = false
    return was
  }

  /** one CIA interrupt: $21068c counts to six and either steps a row or runs the commands */
  tick(): void {
    if (!this.song) return
    this.counter += 1
    if (this.counter === SFX_TICKS_PER_ROW) {
      this.counter = 0
      this.step()
      return
    }
    this.effects()
  }

  /* ---- the row, $21083a ---- */

  private step(): void {
    const song = this.song
    if (!song) return
    const base = (song.sequence[this.pos] ?? 0) * SFX_PATTERN_BYTES + this.rowOffset
    for (let v = 0; v < 4; v++) {
      if (!(this.voices & (1 << v))) continue
      this.rowChannel(v, base + v * 4)
    }
    if (!this.playing) return
    this.rowOffset += SFX_ROW_BYTES
    if (this.rowOffset < SFX_PATTERN_BYTES) return
    this.rowOffset = 0
    this.pos += 1
    // `cmp.w d0,d1 / bne` at $210914 --- the wrap is an EQUALITY against the
    // song length, so a position pushed past it by `Sfx13 Next Patt` runs on
    if (this.pos !== song.length) return
    this.pos = 0
    this.end = true
  }

  /**
   * $210930, one channel of one row.
   *
   * The event is cleared first and only read when the flag says play, which
   * is how a stopped replayer still runs the whole loop and does nothing.
   */
  private rowChannel(v: number, at: number): void {
    const ch = this.channels[v]!
    const song = this.song!
    let period = 0
    let command = 0
    let param = 0
    if (this.playing) {
      period = rd16(song.patternData, at)
      command = song.patternData[at + 2] ?? 0
      param = song.patternData[at + 3] ?? 0
    }
    ch.period = period
    ch.command = command & 0xf
    ch.param = param

    if (period !== SFX_NOTE_HOLD) {
      const instrument = (command & 0xf0) >> 4
      if (instrument !== 0) {
        const s = song.samples[instrument - 1] ?? null
        ch.sample = s
        ch.volume = s?.volume ?? 0
        let volume = ch.volume
        // $2109ae: the row commands, and both clamp
        if (ch.command === 5) volume = Math.min(0x40, volume + param)
        else if (ch.command === 6) volume = Math.max(0, volume - param)
        this.writeVolume(v, volume)
      }
    }

    if (period === SFX_NOTE_HOLD) {
      // `clr.w $2(a6)` at $2109fa clears BOTH the command and its parameter
      ch.command = 0
      ch.param = 0
      return
    }
    if (period === 0) return

    ch.slideStep = 0
    ch.base = period
    if (period === SFX_NOTE_OFF) {
      // the DMA still restarts, with AUDxLC and AUDxLEN untouched --- audible
      // only if something raised the volume again without a note, and nothing
      // in this replayer can
      this.audVol[v] = 0
      this.sink?.setVolume(v, 0)
      return
    }
    this.trigger(v, ch, period)
  }

  /** `move.l $4(a6),$0(a5) / move.w $8(a6),$4(a5) / move.w $0(a6),$6(a5)` at $210a2c */
  private trigger(v: number, ch: SfxChannel, period: number): void {
    const s = ch.sample
    if (!s || s.pcm.length === 0) return
    const oneShot = Math.min(s.pcm.length, s.oneShotWords * 2)
    const loopStart = Math.min(s.pcm.length, s.repeatStart)
    const loopEnd = Math.min(s.pcm.length, loopStart + s.repeatWords * 2)
    // the sink plays [0, pcm.length) and then repeats [loopStart, loopEnd).
    // The repeat begins exactly where the one-shot ends, so handing it the
    // longer of the two is the same audio the relatch at $2108cc gives
    const end = Math.max(oneShot, loopEnd)
    this.sink?.play(v, s.pcm.subarray(0, end), this.hz(period), clampVolume(this.audVol[v] ?? 0), loopStart, loopEnd)
  }

  /* ---- the commands between rows, $2106ec ---- */

  private effects(): void {
    for (let v = 0; v < 4; v++) {
      if (!(this.voices & (1 << v))) continue
      const ch = this.channels[v]!
      if (ch.slideStep !== 0) {
        this.slide(v, ch)
        continue
      }
      switch (ch.command) {
        case 1: this.arpeggio(v, ch); break
        case 2: this.bend(v, ch); break
        case 7: this.startSlide(ch, true); break
        case 8: this.startSlide(ch, false); break
        default: break
      }
    }
  }

  /**
   * $2106f2 and $21070e, the two arms of the running slide.
   *
   * They clamp with different compares --- `bhi` upward and `blt` downward ---
   * which would matter if a period could be negative. None can: the table
   * stops at 113 and command 2 is the only thing that can leave it.
   */
  private slide(v: number, ch: SfxChannel): void {
    ch.slideNow += ch.slideStep
    if (ch.slideStep > 0) {
      if (!(ch.slideTo > ch.slideNow)) ch.slideNow = ch.slideTo
    } else {
      if (!(ch.slideTo < ch.slideNow)) ch.slideNow = ch.slideTo
    }
    this.writePeriod(v, ch.slideNow)
  }

  /**
   * $210748, shared by commands 7 and 8 with `d4` telling them apart.
   *
   * The low nibble is the step per tick and the high nibble is how many
   * semitones away to stop. Command 7 steps the period UP, which is downward
   * in pitch, and reads the target BACKWARD through the table to match.
   *
   * A period the table does not hold ends at $210794, which makes the target
   * the period itself --- so the slide arrives on its first tick and stops.
   */
  private startSlide(ch: SfxChannel, down: boolean): void {
    ch.slideNow = ch.period
    const step = ch.param & 0xf
    ch.slideStep = down ? step : -step
    const semitones = (ch.param >> 4) & 0xf
    const i = SFX_PERIODS.indexOf(ch.period)
    if (i < 0) {
      ch.slideTo = ch.period
      return
    }
    ch.slideTo = SFX_PERIODS[down ? i - semitones : i + semitones] ?? ch.period
  }

  /**
   * $2107be. The jump table at $210a4a is indexed by the tick MINUS ONE, and
   * holds $2107f0, $2107fa, $210806, $2107fa, $2107f0 --- so over the six
   * ticks of a row the note reads base, x, y, base, y, x.
   *
   * DEVIATION: the search at $2107e4 walks the table until it matches, with
   * no test for the $ffff terminator that the slide's search at $210772 does
   * have, so a period the table does not hold walks off the end of the data
   * hunk and arpeggiates over whatever follows. There is no result there to
   * reproduce. This stops on the base period instead, and the library's bug is
   * catalogued on `Sfx13 Play` in ../runtime/dme.ts because this directory
   * carries deviations and never defects (README.md).
   */
  private arpeggio(v: number, ch: SfxChannel): void {
    let semitones: number
    switch (this.counter) {
      case 1: case 5: semitones = (ch.param >> 4) & 0xf; break
      case 2: case 4: semitones = ch.param & 0xf; break
      default: this.writePeriod(v, ch.base); return
    }
    const i = SFX_PERIODS.indexOf(ch.base)
    if (i < 0) {
      this.writePeriod(v, ch.base)
      return
    }
    this.writePeriod(v, SFX_PERIODS[i + semitones] ?? ch.base)
  }

  /**
   * $210810: the high nibble adds to the period and the low nibble subtracts,
   * and the high nibble wins because it is tested first.
   *
   * It edits `(a6)`, the row's own period word, so the bend accumulates across
   * the ticks of a row and survives into the next row's `$fffd`.
   */
  private bend(v: number, ch: SfxChannel): void {
    const up = (ch.param >> 4) & 0xf
    if (up !== 0) {
      ch.period = (ch.period + up) & 0xffff
      this.writePeriod(v, ch.period)
      return
    }
    const downBy = ch.param & 0xf
    if (downBy === 0) return
    ch.period = (ch.period - downBy) & 0xffff
    this.writePeriod(v, ch.period)
  }

  /* ---- the hardware side ---- */

  /**
   * $21033c, and the whole of it.
   *
   * `andi.w #$7f,d3` then `mulu.w $6(a0),d3 / lsr.w #$6,d3` is the channel
   * volume through the master, and the result is BOTH the vu byte and AUDxVOL.
   *
   * `tst.w d3 / bne` at $2103b0 zeroes all FOUR AUDxVOL registers when the
   * scaled volume comes out zero, not just this channel's. A note that lands
   * on volume 0 --- or any note at all while the master is 0 --- silences every
   * voice until each one is triggered again. Reproduced, and catalogued on
   * `Sfx13 Volume` in ../runtime/dme.ts.
   */
  private writeVolume(v: number, volume: number): void {
    let d3 = volume & 0x7f
    if (!(this.voices & (1 << v))) d3 = 0
    d3 = (d3 * this.master) >> 6
    this.vu[v] = d3 & 0xff
    if (d3 === 0) {
      for (let i = 0; i < 4; i++) {
        this.audVol[i] = 0
        this.sink?.setVolume(i, 0)
      }
    }
    this.audVol[v] = clampVolume(d3)
    this.sink?.setVolume(v, clampVolume(d3))
  }

  /** `move.w d0,$6(a5)` --- AUDxPER, without retriggering */
  private writePeriod(v: number, period: number): void {
    if (period <= 0) return
    this.sink?.setFrequency(v, this.hz(period))
  }

  private hz(period: number): number {
    return periodToHz(Math.max(1, period), PAULA_CLOCK)
  }
}
