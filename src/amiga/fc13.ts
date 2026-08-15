/**
 * FutureComposer 1.0-1.3 — the format and its replay, off `DME_FC1.3.library`.
 *
 * The 1.4 replayer next door is the same machine one revision later, so this
 * file is best read as a diff against `fc14.ts`. What changed is worth stating
 * up front, because two of the three are why 1.3 modules are so small:
 *
 *   - A 1.3 module carries NO WAVETABLES. The 47 built-in waveforms belong to
 *     the replayer, at $211200, and `fc13waves.ts` regenerates them. 1.4 moved
 *     them into the file, which is why a 1.4 module is 15KB and this one 4,936
 *     bytes with all ten of its sample lengths zero.
 *   - The sample table has TEN-byte entries, not sixteen (`d0*2 + d0*8` at
 *     $210b84), and holds 57 of them: ten module samples then the 47 waves.
 *   - The frequency sequence has six commands where 1.4 has nine, and the
 *     volume sequence three where 1.4 has four. `$e9` (SSMP sub-samples) and
 *     `$ea` (portamento, in both sequences) are 1.4 additions.
 *
 * ## Evidence
 *
 * `DME_FC1.3.library`, 5,952 bytes loaded at $210000, hunk 0 the veneer
 * ($210000+1420) and hunk 1 the replayer ($21058c+4532). The romtag at
 * $210004 reads "DME_FC1.3.library 2.0 (26. October 97) DOOM Productions
 * 1997", two days before the 1.4 build.
 *
 * The veneer is the same wrapper `DME_SoundFX1.3.library` and
 * `DME_FC1.4.library` carry: four vu bytes at $2103ae, the end flag at +$4,
 * the master at +$6, the saved master at +$8 and four voice enables from +$a.
 * The vectors are settled against the extension's own `jsr` offsets:
 *
 *   -30 $21017c  Play        routine 175 `jsr -$1e(a6)`
 *   -36 $21019e  Stop        routine 173 `jsr -$24(a6)`
 *   -42 $2101c8  Cont        routine 178 `jsr -$2a(a6)`
 *   -48 $2101ec  Song Pos    routine 180 `jsr -$30(a6)`
 *   -54 $210274  Next Patt   routine 181 `jsr -$36(a6)`
 *   -60 $21020c  Prev Patt   routine 182 `jsr -$3c(a6)`
 *   -66 $2102e8  Vu          routine 183 `jsr -$42(a6)`
 *   -72 $210304  End         routine 184 `jsr -$48(a6)`
 *   -78 $210326  Volume      routine 185 `jsr -$4e(a6)`
 *   -84 $210340  Voice       routine 186 `jsr -$54(a6)`
 *
 * ## The file
 *
 * `InitModule` at $2105b4, in a hundred-byte header:
 *
 *   $00  "SMOD"
 *   $04  long  the sequence, in BYTES --- 13 to a step
 *   $08  long  where the patterns start, and $0c how many bytes of them
 *   $10  long  the frequency sequences, $14 their length
 *   $18  long  the volume sequences, $1c their length
 *   $20  long  the sample data
 *   $24  long  UNREAD. `InitModule` never touches it, and it is zero in the
 *              module here. 1.4 put the wavetable pointer in the same slot
 *   $28  10 x 6  sample headers: length and repeat length in WORDS, repeat
 *                start in BYTES
 *   $64  the sequence itself
 *
 * A sequence step is thirteen bytes: four voices of (pattern, transpose, sound
 * transpose), then the speed. A pattern is 64 bytes, 32 rows of two. A
 * frequency or volume sequence is 64 bytes.
 *
 * Samples chain from `$20` with `d1 += len * 2` at $210628 and NO gap, which
 * is the one place 1.4 differs the other way: it adds two.
 *
 * Every offset in the table is stored relative to $211200, the address of the
 * built-in waveforms ($21061c subtracts it, $210b9c adds it back). That is
 * what lets one table hold both a pointer into the module and a pointer into
 * the library.
 *
 * ## The tick
 *
 * $21075c. Unlike 1.4, the play flag at $210dbc is SEPARATE from the speed
 * counter at $210db8, so `Fc13 Cont` sets the flag and leaves the counter
 * where `Fc13 Stop` left it.
 *
 * `InitModule` loads the counter with the speed rather than with one, so the
 * first row lands on tick 8 of an eight-tick module rather than on tick 1.
 *
 * On the tick the counter reaches zero, all four voices step a pattern row
 * ($2109e0) whether or not they are enabled. Then, for the enabled ones only,
 * the sequences run ($210b22) and queue a period and a volume into the
 * sixteen-byte buffer at $210da8, which the back half of the tick unloads into
 * AUDxPER and AUDxVOL.
 *
 * ## The frequency sequence
 *
 * One byte a tick, with six commands at $210b3a:
 *
 *   $e0 nn     jump to offset nn & $3f
 *   $e1        stop here and hold
 *   $e2 nn     set sample nn AND restart the DMA
 *   $e3 aa bb  vibrato speed aa, depth bb
 *   $e4 nn     set sample nn without restarting --- the waveform swap
 *   $e7 nn     switch to frequency sequence nn and start it over
 *   $e8 nn     wait nn ticks
 *
 * Anything else is a note offset added to the pattern's note and the step's
 * transpose --- unless bit 7 is set, when it is the period index whole. The
 * period table is 84 words at $210f1e, and an index of 84 or more reads off
 * the end of it into the sample table. 1.4 has 128 words and no such edge.
 *
 * ## The volume sequence
 *
 * Its first five bytes are a header: speed, which frequency sequence to use,
 * vibrato speed, vibrato depth, vibrato delay. From byte five it is one volume
 * a tick with three commands at $210ca0: `$e0 nn` jumps (to `nn & $3f` MINUS
 * FIVE, because the pointer already skipped the header), `$e1` holds and
 * `$e8 nn` waits.
 */

import { fc13Waves } from './fc13waves'
import type { AudioSink } from './host'
import { clampVolume, PAULA_CLOCK, periodToHz } from './paula'

/** `cmpi.l #$534d4f44,(a2)` in routine 171 --- the extension's only tag test */
export const FC13_MAGIC = 'SMOD'
/** four voices of (pattern, transpose, sound transpose), then the speed */
export const FC13_STEP_BYTES = 13
/** `lsl.w #$6,d1` at $210a48 */
export const FC13_PATTERN_BYTES = 64
export const FC13_SEQUENCE_BYTES = 64
/** where the sequence starts, and so how long the header is */
export const FC13_HEADER_BYTES = 0x64
/**
 * The eight bytes at $210f16 both sequence pointers start on.
 *
 * `InitModule` points `$a(a0)` and `$12(a0)` here rather than at sequence 0,
 * so a voice that has not had a note yet runs THIS: as a frequency sequence a
 * note offset of one and then silence, as a volume sequence a volume of one
 * falling to nothing, and `$e1` at the end of both to hold there.
 */
export const FC13_IDLE_SEQUENCE = Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0xe1)

/** ten module samples, then the 47 built-ins, in one ten-byte-entry table */
export const FC13_SAMPLES = 10
/** `cmpi.w #$70,d0` and `#$6b0` at $210d8c --- the replayer's own period clamp */
export const FC13_MIN_PERIOD = 0x71
export const FC13_MAX_PERIOD = 0x6b0

/**
 * The 84-word period table at $210f1e.
 *
 * Five octaves from 1712 down to 113, twelve copies of 113 as the clamp, then
 * an octave up (3424..1812) and two up (6848..3624). 1.4's table opens with
 * these same 84 words and adds 44 more.
 */
export const FC13_PERIODS: readonly number[] = [
  1712, 1616, 1524, 1440, 1356, 1280, 1208, 1140, 1076, 1016, 960, 906,
  856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453,
  428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226,
  214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113,
  113, 113, 113, 113, 113, 113, 113, 113, 113, 113, 113, 113,
  3424, 3232, 3048, 2880, 2712, 2560, 2416, 2280, 2152, 2032, 1920, 1812,
  6848, 6464, 6096, 5760, 5424, 5120, 4832, 4560, 4304, 4064, 3840, 3624,
]

/** one of the 57 entries of the table at $210fc6 */
export interface Fc13Sample {
  /** the bytes: out of the module for 0..9, out of `fc13Waves()` for the rest */
  pcm: Int8Array
  /** the AUDxLEN a trigger writes, in words */
  words: number
  /** the repeat start, in BYTES */
  repeatStart: number
  /** the repeat length, in words */
  repeatWords: number
}

export interface Fc13Song {
  /** ten from the module, then the 47 the replayer owns */
  samples: Fc13Sample[]
  /** the sequence, 13 bytes a step */
  sequence: Uint8Array
  /** `divu.w #$d` of the length field, so a trailing part-step is dropped */
  steps: number
  patterns: Uint8Array
  freqSequences: Uint8Array
  volSequences: Uint8Array
  /** the speed byte of step 0, or 3 when it is zero ($210642) */
  speed: number
}

const rd32 = (d: Uint8Array, a: number): number =>
  (((d[a] ?? 0) << 24) | ((d[a + 1] ?? 0) << 16) | ((d[a + 2] ?? 0) << 8) | (d[a + 3] ?? 0)) >>> 0
const rd16 = (d: Uint8Array, a: number): number => ((d[a] ?? 0) << 8) | (d[a + 1] ?? 0)

const slice = (d: Uint8Array, at: number, len: number): Int8Array => {
  const from = Math.max(0, Math.min(at, d.length))
  const to = Math.max(from, Math.min(at + len, d.length))
  return new Int8Array(d.buffer, d.byteOffset + from, to - from)
}

/**
 * `InitModule` at $2105b4, over a buffer instead of over chip RAM.
 *
 * The 47 waveforms are appended to the ten module samples here because that is
 * where the library keeps them: entries 10 to 56 of the table at $210fc6 are
 * filled in at assembly time and `InitModule` only ever writes the first ten.
 */
export function parseFc13(data: Uint8Array): Fc13Song | null {
  if (data.length < FC13_HEADER_BYTES) return null
  if (String.fromCharCode(...data.subarray(0, 4)) !== FC13_MAGIC) return null

  const steps = Math.floor(rd32(data, 4) / FC13_STEP_BYTES)
  const sequence = data.slice(FC13_HEADER_BYTES, FC13_HEADER_BYTES + steps * FC13_STEP_BYTES)
  const patterns = data.slice(rd32(data, 8), rd32(data, 8) + rd32(data, 0x0c))
  const freqSequences = data.slice(rd32(data, 0x10), rd32(data, 0x10) + rd32(data, 0x14))
  const volSequences = data.slice(rd32(data, 0x18), rd32(data, 0x18) + rd32(data, 0x1c))

  const samples: Fc13Sample[] = []
  let at = rd32(data, 0x20)
  for (let i = 0; i < FC13_SAMPLES; i++) {
    const words = rd16(data, 0x28 + i * 6)
    samples.push({
      pcm: slice(data, at, words * 2),
      words,
      repeatStart: rd16(data, 0x2a + i * 6),
      repeatWords: rd16(data, 0x2c + i * 6),
    })
    // $210628 chains on `len * 2` alone. 1.4 adds two here and 1.3 does not
    at += words * 2
  }
  // entries 10 to 56, each looping over the whole of itself
  for (const pcm of fc13Waves()) {
    samples.push({ pcm, words: pcm.length >> 1, repeatStart: 0, repeatWords: pcm.length >> 1 })
  }

  const speed = sequence[0x0c] ?? 0
  return { samples, sequence, steps, patterns, freqSequences, volSequences, speed: speed === 0 ? 3 : speed }
}

/** the $4a-byte block at $210dca + voice * $4a */
interface Voice {
  /** `(a0)`: where in the sequence this voice reads its step */
  seqAt: number
  /** `$06`: the byte offset of the NEXT step, so 13 means step 0 is current */
  seqNext: number
  /** `$08` and `$09`: the pattern row's two bytes */
  note: number
  instrument: number
  /**
   * `$0a` and `$10`: the volume sequence and how far into it.
   *
   * `volData` is which BUFFER the pointer is in, because before the first note
   * it is the library's own eight idle bytes rather than the module's.
   */
  volData: Uint8Array
  volSeq: number
  volAt: number
  /** `$12` and `$32`: the frequency sequence, its buffer and how far into it */
  freqData: Uint8Array
  freqSeq: number
  freqAt: number
  /** `$16` and `$2c`: the step's sound transpose and its transpose */
  soundTranspose: number
  transpose: number
  /** `$17` and `$18`: the volume sequence's tick counter and its reload */
  volSpeed: number
  volSpeedReload: number
  /** `$19` and `$1a`: the two `$e8` waits */
  volWait: number
  freqWait: number
  /** `$1b`, `$1c`, `$1d`, `$1e`: vibrato speed, depth, value and delay */
  vibSpeed: number
  vibDepth: number
  vibValue: number
  vibDelay: number
  /** `$22` and `$28`: the pattern and the byte offset into it */
  pattern: number
  patternAt: number
  /** `$2b`: what the frequency sequence last produced */
  freqValue: number
  /** `$2d`: the volume, which is what the tick returns */
  volume: number
  /** `$2e`: the vibrato's flag byte, $40 out of the row pass */
  vibFlags: number
  /** `$2f`: the pattern's own portamento byte */
  patternPorta: number
  /** `$34`: one past the last step, as a byte offset */
  seqEnd: number
  /** `$38`: the accumulated portamento, in period units */
  portaPeriod: number
  /** `$40`, `$42`, `$44`: the repeat start, its length and the sample base */
  repeatStart: number
  repeatWords: number
  sample: Fc13Sample | null
  /**
   * `$48`: three at a trigger, and the loop pointers land when it reaches one.
   *
   * NOT MODELLED: $210bb8 drops it to two when the sample's address has a zero
   * high word, so a sample below $10000 loops a tick sooner. There are no
   * addresses here.
   */
  relatch: number
  /**
   * AUDxPER as the hardware still holds it, which is last tick's period.
   *
   * Not a field of the library's block. It exists because `$e2` restarts a
   * channel in the middle of a tick, before the period this tick computed has
   * been written, and `play()` wants a frequency at that moment.
   */
  periodOut: number
}

const newVoice = (): Voice => ({
  seqAt: 0, seqNext: FC13_STEP_BYTES,
  note: 0, instrument: 0, volData: FC13_IDLE_SEQUENCE, volSeq: 0, volAt: 0,
  freqData: FC13_IDLE_SEQUENCE, freqSeq: 0, freqAt: 0, soundTranspose: 0, transpose: 0,
  volSpeed: 1, volSpeedReload: 1, volWait: 0, freqWait: 0,
  vibSpeed: 0, vibDepth: 0, vibValue: 0, vibDelay: 0,
  pattern: 0, patternAt: 0,
  freqValue: 0, volume: 0, vibFlags: 0, patternPorta: 0,
  seqEnd: 0, portaPeriod: 0, repeatStart: 0, repeatWords: 0, sample: null, relatch: 0,
  periodOut: FC13_MAX_PERIOD,
})

/** signed and unsigned byte views, because the replayer leans on both */
const s16 = (n: number): number => (n << 16) >> 16
const u8 = (n: number): number => n & 0xff

/**
 * The replay: one `tick()` is one interrupt, which is $21075c.
 *
 * DEVIATION: the tick runs from the frame loop at 50Hz. The library hangs it
 * off a CIA timer set up at $2103c0 with the same fixed `1775101 / 125`
 * divisor `DME_SoundFX1.3.library` uses, and there is no interrupt here to
 * hang one off.
 */
export class Fc13 {
  song: Fc13Song | null = null
  readonly voices: Voice[] = [newVoice(), newVoice(), newVoice(), newVoice()]

  /** `$210dbc`: the play flag, which in 1.3 is its own word */
  playing = false
  /** `$210db8`: the tick counter, and `$210dba` what it reloads to */
  counter = 0
  speed = 3
  /**
   * `$210dc4`: counts to four so the step's speed byte is read once a step.
   *
   * It starts at zero in the library's data and `InitModule` never touches it,
   * so the fourth voice to take a step is the one that fires it. Not reset by
   * `load()`, because the binary does not reset it.
   */
  stepGate = 0
  /** `$6(a2)` and `$8(a2)` of the shared veneer block */
  master = 0x40
  savedMaster = 0x40
  /** the four enable words at `$a(a2)` as a mask */
  enabled = 0b1111
  /** the four vu bytes, read and cleared */
  readonly vu = new Uint8Array(4)
  /** `$4(a2)`, raised when a voice's sequence pointer reaches the end */
  end = false

  constructor(private readonly sinkOf: () => AudioSink | undefined) {}

  private get sink(): AudioSink | undefined {
    return this.sinkOf()
  }

  /** LVO -30 at $21017c: the module, `InitModule`, then the timer */
  load(song: Fc13Song): void {
    this.song = song
    this.speed = song.speed
    // $210646 loads the counter with the SPEED, not with one
    this.counter = song.speed
    this.playing = true
    this.end = false
    this.vu.fill(0)
    for (let v = 0; v < 4; v++) {
      const ch = newVoice()
      // $2106b4: a table of (audio register, voice * 3) pairs, and the second
      // word divided by three is the voice number the row pass bit-sets with
      ch.seqAt = v * 3
      ch.seqEnd = song.steps * FC13_STEP_BYTES + v * 3
      ch.pattern = (song.sequence[ch.seqAt] ?? 0) * FC13_PATTERN_BYTES
      ch.transpose = song.sequence[ch.seqAt + 1] ?? 0
      ch.soundTranspose = song.sequence[ch.seqAt + 2] ?? 0
      this.voices[v] = ch
      this.sink?.stop(v)
    }
  }

  /** LVO -36 at $21019e: the flag cleared, the voices silenced, the master saved */
  stop(): void {
    this.playing = false
    for (let v = 0; v < 4; v++) this.sink?.stop(v)
    this.savedMaster = this.master
    if (this.master === 0) this.master = 0x40
  }

  /** LVO -42 at $2101c8: the master back and the flag up, counter and position untouched */
  cont(): void {
    this.master = this.savedMaster
    this.playing = true
  }

  /** LVO -48 at $2101ec: `$6(a0)` over thirteen, less one, and never below zero */
  get position(): number {
    const n = Math.floor(this.voices[0]!.seqNext / FC13_STEP_BYTES)
    return n === 0 ? 0 : n - 1
  }

  /**
   * LVO -60 at $21020c (Prev) and -54 at $210274 (Next).
   *
   * Both write the SAME two fields on all four voices: the sequence offset and
   * $28, the pattern byte offset, set to $40 --- which is one past the end of
   * a pattern, so the next row pass takes a step rather than a note.
   */
  private seek(step: number): void {
    const at = step * FC13_STEP_BYTES
    for (const v of this.voices) {
      v.patternAt = 0x40
      v.seqNext = at
    }
  }

  /**
   * `Fc13 Next Patt` does not go anywhere, and neither does 1.4's.
   *
   * $210298 is `subq.w #$1,d1` immediately followed by `addq.w #$1,d1`, a pair
   * that cancels, so the position it writes back is the position it read. All
   * it does is clamp to zero when the position is already past the end and set
   * `$28` to $40, which makes the next row pass RE-TAKE the current step.
   */
  nextPattern(): void {
    const song = this.song
    if (!song) return
    let n = Math.floor(this.voices[0]!.seqNext / FC13_STEP_BYTES)
    if (n >= song.steps) n = 0
    this.seek(n)
  }

  prevPattern(): void {
    let n = Math.floor(this.voices[0]!.seqNext / FC13_STEP_BYTES)
    n = n === 0 ? 0 : n - 1
    if (n !== 0) n -= 1
    this.seek(n)
  }

  /** LVO -84 at $210340, the same shape as SoundFX's and 1.4's */
  setVoices(mask: number): void {
    this.enabled = mask
    for (let v = 0; v < 4; v++) {
      if (mask & (1 << v)) continue
      this.sink?.setVolume(v, 0)
    }
  }

  /** LVO -66 at $2102e8: read and cleared */
  readVu(channel: number): number {
    const n = this.vu[channel] ?? 0
    if (channel >= 0 && channel < 4) this.vu[channel] = 0
    return n
  }

  /** LVO -72 at $210304, read and cleared, and 255 rather than -1 */
  readEnd(): boolean {
    const was = this.end
    this.end = false
    return was
  }

  /** one interrupt: $21075c */
  tick(): void {
    if (!this.song) return
    if (!this.playing) return
    this.counter -= 1
    if (this.counter === 0) {
      this.counter = this.speed
      // the row pass runs for all four voices whether or not they are enabled
      for (let v = 0; v < 4; v++) this.rowPass(v)
    }
    // $210796 clears the DMACON accumulator AFTER the row passes, so the start
    // bit a note-on ORs into it at $210abc is thrown away and only the `$e2`
    // command below can restart a channel. The note-on's DMA STOP does land
    const queued: { period: number; volume: number }[] = []
    for (let v = 0; v < 4; v++) {
      if (!(this.enabled & (1 << v))) continue
      const ch = this.voices[v]!
      this.frequencySequence(v, ch)
      this.volumeSequence(ch)
      ch.periodOut = this.period(ch)
      queued[v] = { period: ch.periodOut, volume: ch.volume }
    }
    for (let v = 0; v < 4; v++) {
      if (!(this.enabled & (1 << v))) continue
      const ch = this.voices[v]!
      // $210890: the loop pointers land a tick or two after the trigger. The
      // sink takes both at once, so this only counts down
      if (ch.relatch !== 0) {
        ch.relatch -= 1
        if (ch.relatch === 1) ch.relatch = 0
      }
    }
    for (let v = 0; v < 4; v++) {
      const q = queued[v]
      if (!q) continue
      this.sink?.setFrequency(v, periodToHz(Math.max(1, q.period), PAULA_CLOCK))
      // $21095e: the volume is scaled by the master with no cap of its own, so
      // a sequence byte above 64 reaches AUDxVOL as it is and Paula clamps it
      const scaled = (q.volume * this.master) >> 6
      this.vu[v] = scaled & 0xff
      this.sink?.setVolume(v, clampVolume(scaled))
    }
  }

  /* ---- the row, $2109e0 ---- */

  private rowPass(v: number): void {
    const song = this.song!
    const ch = this.voices[v]!
    // a1 before the step is taken, which is what the speed read below uses
    const wasAt = ch.pattern + ch.patternAt
    if (ch.patternAt === FC13_PATTERN_BYTES) {
      let seq = ch.seqNext + v * 3
      if (seq === ch.seqEnd) {
        this.end = true
        ch.seqNext = 0
        seq = v * 3
      }
      ch.seqAt = seq
      // $210a16: one shared counter for all four voices, so the speed byte is
      // taken once per sequence step rather than four times
      this.stepGate = u8(this.stepGate + 1)
      if (this.stepGate === 4) {
        this.stepGate = 0
        // `move.b -$1(a1),d1` at $210a24, where a1 is still the OLD pattern
        // plus $40. It reads the last byte of the pattern this voice has just
        // finished, which is row 31's instrument byte. The step's own speed
        // byte, twelve into the thirteen, is what it was reaching for and 1.4
        // reads it correctly as `move.b $c(a2),d1`
        const s = song.patterns[wasAt - 1] ?? 0
        if (s !== 0) {
          this.speed = s
          this.counter = s
        }
      }
      ch.pattern = (song.sequence[seq] ?? 0) * FC13_PATTERN_BYTES
      ch.transpose = song.sequence[seq + 1] ?? 0
      ch.soundTranspose = song.sequence[seq + 2] ?? 0
      ch.patternAt = 0
      ch.seqNext += FC13_STEP_BYTES
    }

    const row = ch.pattern + ch.patternAt
    let d0 = song.patterns[row] ?? 0
    const d1 = song.patterns[row + 1] ?? 0
    if (d0 !== 0 || (d1 & 0xc0) !== 0) {
      if (d0 !== 0) ch.portaPeriod = 0
      ch.patternPorta = 0
      if (d1 & 0x80) ch.patternPorta = song.patterns[row + 3] ?? 0
    }

    d0 &= 0x7f
    if (d0 === 0) {
      ch.patternAt += 2
      return
    }
    ch.note = d0
    ch.instrument = d1
    // $210aa0: the DMA is only cut when ALL FOUR enables are set. Disable one
    // voice and the other three stop retriggering cleanly
    if ((this.enabled & 0b1111) === 0b1111) this.sink?.stop(v)

    const volSeq = u8((d1 & 0x3f) + ch.soundTranspose) * FC13_SEQUENCE_BYTES
    ch.volAt = 0
    ch.volSpeed = song.volSequences[volSeq] ?? 0
    ch.volSpeedReload = ch.volSpeed
    const freq = song.volSequences[volSeq + 1] ?? 0
    ch.vibSpeed = song.volSequences[volSeq + 2] ?? 0
    // `move.b #$40,$2e(a0)` at $210aec is the VIBRATO flag byte, not the
    // volume. A note starts on whatever volume the last one left behind
    ch.vibDepth = song.volSequences[volSeq + 3] ?? 0
    ch.vibValue = ch.vibDepth
    ch.vibDelay = song.volSequences[volSeq + 4] ?? 0
    ch.vibFlags = 0x40
    ch.volData = song.volSequences
    ch.volSeq = volSeq + 5
    ch.freqData = song.freqSequences
    ch.freqSeq = freq * FC13_SEQUENCE_BYTES
    ch.freqAt = 0
    ch.volWait = 0
    ch.freqWait = 0
    ch.patternAt += 2
  }

  /* ---- the frequency sequence, $210b22 ---- */

  private frequencySequence(v: number, ch: Voice): void {
    const song = this.song!
    const seq = ch.freqData
    // a wait is spent before anything is read, and $e8 comes back here
    for (let guard = 0; guard < 64; guard++) {
      if (ch.freqWait !== 0) {
        ch.freqWait -= 1
        return
      }
      const at = ch.freqSeq + ch.freqAt
      let d0 = seq[at] ?? 0
      if (d0 === 0xe1) return
      if (d0 === 0xe0) {
        const to = (seq[at + 1] ?? 0) & 0x3f
        ch.freqAt = to
        d0 = seq[ch.freqSeq + to] ?? 0
      }
      const arg = (n: number): number => seq[ch.freqSeq + ch.freqAt + n] ?? 0
      if (d0 === 0xe2 || d0 === 0xe4) {
        this.setSample(v, ch, arg(1), d0 === 0xe2)
        if (d0 === 0xe2) {
          // $210bc2: only the restarting arm rewinds the volume sequence
          ch.volAt = 0
          ch.volSpeed = 1
        }
        ch.freqAt += 2
      } else if (d0 === 0xe7) {
        ch.freqData = song.freqSequences
        ch.freqSeq = arg(1) * FC13_SEQUENCE_BYTES
        ch.freqAt = 0
        continue
      } else if (d0 === 0xe8) {
        ch.freqWait = arg(1)
        ch.freqAt += 2
        continue
      } else if (d0 === 0xe3) {
        ch.freqAt += 3
        ch.vibSpeed = arg(1)
        ch.vibDepth = arg(2)
      }
      // whatever the command did, the byte now under the pointer is the value
      ch.freqValue = ch.freqData[ch.freqSeq + ch.freqAt] ?? 0
      ch.freqAt += 1
      return
    }
  }

  /** $210b60 and $210bda: point the channel at a sample, with or without a restart */
  private setSample(v: number, ch: Voice, n: number, restart: boolean): void {
    const s = this.song!.samples[n]
    if (!s) return
    ch.sample = s
    ch.repeatStart = s.repeatStart
    ch.repeatWords = s.repeatWords
    ch.relatch = 3
    this.trigger(v, ch, restart)
  }

  /**
   * What the DMA does with the pointers the two commands wrote.
   *
   * `$e2` sets the channel's DMACON bit, so it restarts from sample 0. `$e4`
   * does not: the running sample plays out and the NEW pointers take effect at
   * the loop, which is the buffer swap `setWaveform` was added for and is the
   * whole of FC's synthesis.
   */
  private trigger(v: number, ch: Voice, restart: boolean): void {
    const s = ch.sample
    if (!s || s.pcm.length === 0) return
    const loopStart = Math.min(s.pcm.length, ch.repeatStart)
    const loopEnd = Math.min(s.pcm.length, loopStart + ch.repeatWords * 2)
    const end = Math.max(Math.min(s.pcm.length, s.words * 2), loopEnd)
    const pcm = s.pcm.subarray(0, end)
    if (!restart && this.sink?.setWaveform) {
      this.sink.setWaveform(v, pcm)
      this.sink.setLoop(v, loopStart, loopEnd)
      return
    }
    // AUDxPER as the tick left it. The command writes DMACON and the sample
    // pointers and nothing else, and the period this tick computes lands at
    // $210954, after the frequency sequence has finished
    this.sink?.play(
      v,
      pcm,
      periodToHz(Math.max(1, ch.periodOut), PAULA_CLOCK),
      clampVolume((ch.volume * this.master) >> 6),
      loopStart,
      loopEnd,
    )
  }

  /** $210c88: the volume sequence, which in 1.3 has no slide */
  private volumeSequence(ch: Voice): void {
    const seq = ch.volData
    outer: for (let rounds = 0; rounds < 64; rounds++) {
      if (ch.volWait !== 0) {
        ch.volWait -= 1
        return
      }
      ch.volSpeed = u8(ch.volSpeed - 1)
      if (ch.volSpeed !== 0) return
      ch.volSpeed = ch.volSpeedReload
      for (let guard = 0; guard < 64; guard++) {
        const at = ch.volSeq + ch.volAt
        const d0 = seq[at] ?? 0
        if (d0 === 0xe8) {
          ch.volAt += 2
          ch.volWait = seq[at + 1] ?? 0
          // $210cba goes back to the WAIT TEST rather than returning, so the
          // tick that sets a wait of n also spends one of it and n-1 are left
          continue outer
        }
        if (d0 === 0xe1) return
        if (d0 === 0xe0) {
          // MINUS FIVE, because `$a(a0)` already skipped the five-byte header
          ch.volAt = u8(((seq[at + 1] ?? 0) & 0x3f) - 5)
          continue
        }
        ch.volume = d0
        ch.volAt += 1
        return
      }
      return
    }
  }

  /** $210ce2: the note, the vibrato, the pattern portamento and the clamp */
  private period(ch: Voice): number {
    let index = ch.freqValue
    // bit 7 makes it the table index whole rather than an offset from the note
    if ((index & 0x80) === 0) index = u8(index + ch.note + ch.transpose)
    index &= 0x7f
    // an index of 84 or more runs off the end of the 84-word table. Nothing in
    // the module here reaches one, and the bytes it would read are the sample
    // table rather than a period
    let period = FC13_PERIODS[index] ?? 0
    let flags = ch.vibFlags

    if (ch.vibDelay !== 0) {
      ch.vibDelay = u8(ch.vibDelay - 1)
    } else {
      const scale = u8(index * 2)
      const depth = u8(ch.vibDepth * 2)
      let value = ch.vibValue
      // bit 7 halves the rate; bit 5 is the direction
      const skip = (flags & 0x80) !== 0 && (flags & 0x01) !== 0
      if (!skip) {
        // bit 5 set is the rising arm, and both compares are byte-unsigned
        if (flags & 0x20) {
          value = u8(value + ch.vibSpeed)
          if (value >= depth) {
            flags &= ~0x20
            value = depth
          }
        } else if (value < ch.vibSpeed) {
          flags |= 0x20
          value = 0
        } else {
          value -= ch.vibSpeed
        }
        ch.vibValue = u8(value)
      }
      // `sub.b d4,d1 / bcc / subi.w #$100,d1` --- the borrow is what makes it
      // signed, and the arithmetic comes out the same as a plain subtraction
      let d1 = ch.vibValue - (depth >> 1)
      // `addi.b #$a0,d5 / bcs` skips the doubling entirely, and each `addi.b
      // #$18` is one octave of the period table
      let d5 = scale + 0xa0
      while (d5 <= 0xff) {
        d1 = s16(d1 * 2)
        d5 += 0x18
      }
      period += d1
    }
    ch.vibFlags = u8(flags ^ 0x01)

    // $210d70: no `not.b` toggle in 1.3, so the pattern portamento moves every
    // tick where 1.4 moves it on every other one
    let porta = ch.patternPorta
    if (porta !== 0) {
      if (porta > 0x1f) porta = -(porta & 0x1f)
      ch.portaPeriod -= porta
    }
    period += ch.portaPeriod
    // the clamps are word-unsigned compares, so a period the vibrato drove
    // below zero comes out at the TOP of the range rather than the bottom
    period &= 0xffff
    if (period <= 0x70) period = FC13_MIN_PERIOD
    if (period > FC13_MAX_PERIOD) period = FC13_MAX_PERIOD
    return period
  }
}
