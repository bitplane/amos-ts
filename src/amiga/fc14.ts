/**
 * FutureComposer 1.4 — the format and its replay, off `DME_FC1.4.library`.
 *
 * FC is a sequence-and-envelope player rather than a tracker: a pattern holds
 * notes, and what each note SOUNDS like comes from two byte sequences that run
 * per tick, one picking the waveform and bending the pitch and one shaping the
 * volume. That is why a 15KB module can hold a whole tune with three samples
 * in it, and why the replayer is 4,260 bytes where SoundFX's is 1,516.
 *
 * ## Evidence
 *
 * `DME_FC1.4.library`, 5,684 bytes loaded at $210000, hunk 0 the veneer
 * ($210000+1424) and hunk 1 the replayer ($210590+4260). The romtag at
 * $210004 reads "DME_FC1.4.library 2.0 (28. October 97) DOOM Productions
 * 1997".
 *
 * The veneer is the SAME wrapper `DME_SoundFX1.3.library` carries, down to the
 * state block: four vu bytes, the end flag at +$4, the master at +$6, the
 * saved master at +$8 and four voice enables from +$a. DOOM Productions wrote
 * it once and wrapped every lifted replayer in it. The vectors are settled
 * against the extension's own `jsr` offsets, not their order:
 *
 *   -30 $21017c  Play        routine 159 `jsr -$1e(a6)`
 *   -36 $21019e  Stop        routine 157 `jsr -$24(a6)`
 *   -42 $2101cc  Cont        routine 162 `jsr -$2a(a6)`
 *   -48 $2101f0  Song Pos    routine 164 `jsr -$30(a6)`
 *   -54 $210278  Next Patt   routine 165 `jsr -$36(a6)`
 *   -60 $210210  Prev Patt   routine 166 `jsr -$3c(a6)`
 *   -66 $2102ec  Vu          routine 167 `jsr -$42(a6)`
 *   -72 $210308  End         routine 168 `jsr -$48(a6)`
 *   -78 $21032a  Volume      routine 169 `jsr -$4e(a6)`
 *   -84 $210344  Voice       no keyword reaches it
 *
 * ## The file
 *
 * `InitModule` at $2105c0 reads the whole header in twenty instructions:
 *
 *   $00  "FC14"
 *   $04  long  the sequence, in BYTES --- 13 to a step
 *   $08  long  where the patterns start, and $0c how many bytes of them
 *   $10  long  the frequency sequences, $14 their length
 *   $18  long  the volume sequences, $1c their length
 *   $20  long  the sample data
 *   $24  long  the wavetable data
 *   $28  10 x 6  sample headers: length and repeat length in WORDS, repeat
 *                start in BYTES
 *   $64  80 bytes  the wavetable lengths, in words
 *   $b4  the sequence itself
 *
 * A sequence step is thirteen bytes: four voices of (pattern, transpose, sound
 * transpose), then the speed. A pattern is 64 bytes, 32 rows of two: the note
 * and then the instrument. A frequency or volume sequence is 64 bytes.
 *
 * The sample and wavetable tables are ONE table of 90 sixteen-byte entries at
 * $211092, samples 0 to 9 and wavetables 10 to 89, indexed with `lsl.w #$4,d0`
 * off the byte a sequence command carries. So a "sample number" of 20 is
 * wavetable 10, and the synthesis is just a sample swap.
 *
 * Samples are laid end to end with a two-byte gap: `d1 += len*2 + 2` at
 * $21063c. Wavetables are laid end to end without one ($210668), and each
 * loops over the whole of itself.
 *
 * ## The tick
 *
 * $210784. The speed counter at $210f58 is ALSO the play flag --- `tst.w
 * $8(a5)` returns when it is zero, and it is never zero while playing because
 * the reload happens the instant it hits zero. Stop clears it.
 *
 * On the tick the counter reaches zero, all four voices step a pattern row
 * ($2109ce); on every tick all four run their sequences ($210b02), which
 * returns a period in the high word and a volume in the low byte.
 *
 * The speed byte of a sequence step is taken through a shared counter at
 * $210f52 that every voice bumps and that fires at five ($210a16). It starts
 * at zero and resets to ONE, so after the first step the voice that fires it
 * is always voice 0 --- which matters, because the read is `$c(a2)` with a2
 * already carrying that voice's three-byte offset into the step. Voice 0 lands
 * on the speed byte. Any other voice would land on a transpose.
 *
 * ## The frequency sequence
 *
 * One byte a tick, with $e0-$ea as commands ($210b1c):
 *
 *   $e0 nn     jump to offset nn & $3f
 *   $e1        stop here and hold
 *   $e2 nn     set sample nn AND restart the DMA
 *   $e3 aa bb  vibrato speed aa, depth bb
 *   $e4 nn     set sample nn without restarting --- the wavetable swap
 *   $e7 nn     switch to frequency sequence nn and start it over
 *   $e8 nn     wait nn ticks
 *   $e9 nn mm  sub-sample mm of an "SSMP" container in sample nn
 *   $ea aa bb  portamento step aa for bb ticks
 *
 * Anything else is a note offset added to the pattern's note and the step's
 * transpose --- unless bit 7 is set, when it is the period index whole.
 *
 * ## The volume sequence
 *
 * Its first five bytes are a header rather than data: speed, which frequency
 * sequence to use, vibrato speed, vibrato depth, vibrato delay. From byte five
 * it is one volume a tick with three commands ($210cca): `$e0 nn` jumps (to
 * `nn & $3f` MINUS FIVE, because the pointer already skipped the header),
 * `$e1` holds, `$e8 nn` waits and `$ea aa bb` slides by aa for bb ticks.
 */

import type { AudioSink } from './host'
import { clampVolume, PAULA_CLOCK, periodToHz } from './paula'

/** `cmpi.l #$46433134,(a2)` in routine 155 --- the extension's only tag test */
export const FC14_MAGIC = 'FC14'
/** four voices of (pattern, transpose, sound transpose), then the speed */
export const FC14_STEP_BYTES = 13
/** `lsl.w d6,d1` with d6 = 6 */
export const FC14_PATTERN_BYTES = 64
export const FC14_SEQUENCE_BYTES = 64
/** where the sequence starts, and so how long the header is */
export const FC14_HEADER_BYTES = 0xb4
/** ten real samples, then eighty wavetables, in one sixteen-byte-entry table */
export const FC14_SAMPLES = 10
export const FC14_WAVES = 80
/** `cmpi.b #$49,(a1)` at $2109d6: the byte that ends a pattern early */
export const FC14_PATTERN_END = 0x49
/** `cmpi.w #$70,d0` and `#$d60` at $210e0c --- the replayer's own period clamp */
export const FC14_MIN_PERIOD = 0x71
export const FC14_MAX_PERIOD = 0xd60

/**
 * The 128-word period table at $210f8a.
 *
 * Five octaves from 1712 down to 113, twelve copies of 113 as the clamp, and
 * then THREE more ranges: an octave up (3424..1812), two up (6848..3624) and a
 * repeat of the first (1712..143). A frequency-sequence byte with bit 7 set
 * indexes this whole thing directly, which is how a module reaches the top two.
 */
export const FC14_PERIODS: readonly number[] = [
  1712, 1616, 1524, 1440, 1356, 1280, 1208, 1140, 1076, 1016, 960, 906,
  856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453,
  428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226,
  214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113,
  113, 113, 113, 113, 113, 113, 113, 113, 113, 113, 113, 113,
  3424, 3232, 3048, 2880, 2712, 2560, 2416, 2280, 2152, 2032, 1920, 1812,
  6848, 6464, 6096, 5760, 5424, 5120, 4832, 4560, 4304, 4064, 3840, 3624,
  1712, 1616, 1524, 1440, 1356, 1280, 1208, 1140, 1076, 1016, 960, 906,
  856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453,
  428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226,
  214, 202, 190, 180, 170, 160, 151, 143,
]

/** one of the ninety entries of the table at $211092 */
export interface Fc14Sample {
  /** the bytes, sliced out of the module */
  pcm: Int8Array
  /** the AUDxLEN a trigger writes, in words */
  words: number
  /** the repeat start, in BYTES --- `adda.w $40(a0),a1` adds it to a pointer */
  repeatStart: number
  /** the repeat length, in words */
  repeatWords: number
}

export interface Fc14Song {
  /** the whole module, because "SSMP" containers are read out of it live */
  data: Uint8Array
  /** ninety: ten samples then eighty wavetables */
  samples: Fc14Sample[]
  /** the sequence, 13 bytes a step */
  sequence: Uint8Array
  /** `divu.w #$d` of the length field, so a trailing part-step is dropped */
  steps: number
  patterns: Uint8Array
  freqSequences: Uint8Array
  volSequences: Uint8Array
  /** the speed byte of step 0, or 3 when it is zero ($210676) */
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
 * `InitModule` at $2105c0, over a buffer instead of over chip RAM.
 *
 * The sample chain is the part worth watching: nothing in the file says where
 * sample n starts. Only sample 0 has an offset, and every one after it is the
 * previous plus `len * 2 + 2`. Get the two wrong and the module still parses.
 */
export function parseFc14(data: Uint8Array): Fc14Song | null {
  if (data.length < FC14_HEADER_BYTES) return null
  if (String.fromCharCode(...data.subarray(0, 4)) !== FC14_MAGIC) return null

  const steps = Math.floor(rd32(data, 4) / FC14_STEP_BYTES)
  const sequence = data.slice(FC14_HEADER_BYTES, FC14_HEADER_BYTES + steps * FC14_STEP_BYTES)
  const patterns = data.slice(rd32(data, 8), rd32(data, 8) + rd32(data, 0x0c))
  const freqSequences = data.slice(rd32(data, 0x10), rd32(data, 0x10) + rd32(data, 0x14))
  const volSequences = data.slice(rd32(data, 0x18), rd32(data, 0x18) + rd32(data, 0x1c))

  const samples: Fc14Sample[] = []
  let at = rd32(data, 0x20)
  for (let i = 0; i < FC14_SAMPLES; i++) {
    const words = rd16(data, 0x28 + i * 6)
    samples.push({
      pcm: slice(data, at, words * 2),
      words,
      repeatStart: rd16(data, 0x2a + i * 6),
      repeatWords: rd16(data, 0x2c + i * 6),
    })
    // `addq.l #$2,d1` at $21063c: two bytes of gap between samples
    at += words * 2 + 2
  }
  at = rd32(data, 0x24)
  for (let i = 0; i < FC14_WAVES; i++) {
    const words = data[0x64 + i] ?? 0
    // $21065c writes the length into BOTH the length and the repeat length and
    // leaves the repeat start zero, so a wavetable loops over the whole of it
    samples.push({ pcm: slice(data, at, words * 2), words, repeatStart: 0, repeatWords: words })
    at += words * 2
  }

  const speed = sequence[0x0c] ?? 0
  return { data, samples, sequence, steps, patterns, freqSequences, volSequences, speed: speed === 0 ? 3 : speed }
}

/** the $4a-byte block at $210e28 + voice * $4a */
interface Voice {
  /** `(a0)`: where in the sequence this voice reads its step */
  seqAt: number
  /** `$04` and `$05`: the portamento step and how many ticks are left of it */
  portaStep: number
  portaCount: number
  /** `$06`: the byte offset of the NEXT step, so 13 means step 0 is current */
  seqNext: number
  /** `$08` and `$09`: the pattern row's two bytes */
  note: number
  instrument: number
  /** `$0a` and `$10`: the volume sequence and how far into it */
  volSeq: number
  volAt: number
  /** `$0e` and `$0f`: the volume slide's step and its count */
  volSlide: number
  volSlideCount: number
  /** `$12` and `$32`: the frequency sequence and how far into it */
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
  /** `$26`, `$27`, `$2a`: three `not.b` toggles, each halving a rate */
  toggleVol: number
  togglePorta: number
  toggleSlide: number
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
  sample: Fc14Sample | null
  /** `$48`: three at a trigger, and the relatch happens when it reaches two */
  relatch: number
}

const newVoice = (): Voice => ({
  seqAt: 0, portaStep: 0, portaCount: 0, seqNext: FC14_STEP_BYTES,
  note: 0, instrument: 0, volSeq: 0, volAt: 0, volSlide: 0, volSlideCount: 0,
  freqSeq: 0, freqAt: 0, soundTranspose: 0, transpose: 0,
  volSpeed: 1, volSpeedReload: 1, volWait: 0, freqWait: 0,
  vibSpeed: 0, vibDepth: 0, vibValue: 0, vibDelay: 0,
  pattern: 0, patternAt: 0, toggleVol: 0, togglePorta: 0, toggleSlide: 0,
  freqValue: 0, volume: 0, vibFlags: 0, patternPorta: 0,
  seqEnd: 0, portaPeriod: 0, repeatStart: 0, repeatWords: 0, sample: null, relatch: 0,
})

/** signed and unsigned byte views, because the replayer leans on both */
const s8 = (n: number): number => (n << 24) >> 24
const u8 = (n: number): number => n & 0xff

/**
 * The replay: one `tick()` is one interrupt, which is $210784.
 *
 * DEVIATION: the tick runs from the frame loop at 50Hz. The library hangs it
 * off a CIA timer set up at $2103c4, exactly as `DME_SoundFX1.3.library` does,
 * and there is no interrupt here to hang one off.
 */
export class Fc14 {
  song: Fc14Song | null = null
  readonly voices: Voice[] = [newVoice(), newVoice(), newVoice(), newVoice()]

  /** `$210f58`: the tick counter, and zero means stopped */
  counter = 0
  /** `$210f56`: what the counter reloads to */
  speed = 3
  /**
   * `$210f52`: counts to five so the step's speed byte is read once a step.
   *
   * It starts at ZERO in the library's data and `InitModule` never touches it,
   * which is what makes voice 0 the one that fires the gate --- and so what
   * makes `$c(a2)` land on the step's own speed byte rather than nine bytes
   * further on. Not reset by `load()`, because the binary does not reset it.
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
  load(song: Fc14Song): void {
    this.song = song
    this.speed = song.speed
    this.counter = 1
    this.end = false
    this.vu.fill(0)
    for (let v = 0; v < 4; v++) {
      const ch = newVoice()
      // $2106b8: each voice reads its own three bytes of the step, and the
      // word that gives the offset also gives the voice number when divided
      // by three
      ch.seqAt = v * 3
      ch.seqEnd = song.steps * FC14_STEP_BYTES + v * 3
      ch.pattern = (song.sequence[ch.seqAt] ?? 0) * FC14_PATTERN_BYTES
      ch.transpose = song.sequence[ch.seqAt + 1] ?? 0
      ch.soundTranspose = song.sequence[ch.seqAt + 2] ?? 0
      this.voices[v] = ch
      this.sink?.stop(v)
    }
  }

  /** LVO -36 at $21019e: the counter cleared, the voices silenced, the master saved */
  stop(): void {
    this.counter = 0
    for (let v = 0; v < 4; v++) this.sink?.stop(v)
    this.savedMaster = this.master
    if (this.master === 0) this.master = 0x40
  }

  /** LVO -42 at $2101cc: the master back and the counter to one, position untouched */
  cont(): void {
    this.master = this.savedMaster
    this.counter = 1
  }

  /** LVO -48 at $2101f0: `$6(a0)` over thirteen, less one, and never below zero */
  get position(): number {
    const n = Math.floor(this.voices[0]!.seqNext / FC14_STEP_BYTES)
    return n === 0 ? 0 : n - 1
  }

  /**
   * LVO -60 at $210210 (Prev) and -54 at $210278 (Next).
   *
   * Both write the SAME four fields on all four voices: the sequence offset
   * and $28, the pattern byte offset, set to $40 --- which is one past the end
   * of a pattern, so the next row pass takes the step rather than a note.
   */
  private seek(step: number): void {
    const at = step * FC14_STEP_BYTES
    for (const v of this.voices) {
      v.patternAt = 0x40
      v.seqNext = at
    }
  }

  /**
   * `Fc14 Next Patt` does not go anywhere.
   *
   * $21029c is `subq.w #$1,d1` immediately followed by `addq.w #$1,d1`, a pair
   * that cancels, so the position it writes back is the position it read. All
   * it does is clamp to zero when the position is already past the end and set
   * `$28` to $40, which makes the next row pass RE-TAKE the current step. The
   * `Prev` twin two vectors along has the same pair with a real `subq` after
   * it, which is what the missing instruction here would have looked like.
   */
  nextPattern(): void {
    const song = this.song
    if (!song) return
    const total = Math.floor(rd32(song.data, 4) / FC14_STEP_BYTES)
    let n = Math.floor(this.voices[0]!.seqNext / FC14_STEP_BYTES)
    if (n >= total) n = 0
    this.seek(n)
  }

  prevPattern(): void {
    let n = Math.floor(this.voices[0]!.seqNext / FC14_STEP_BYTES)
    n = n === 0 ? 0 : n - 1
    if (n !== 0) n -= 1
    this.seek(n)
  }

  /** LVO -84 at $210344, the same shape as SoundFX's */
  setVoices(mask: number): void {
    this.enabled = mask
    for (let v = 0; v < 4; v++) {
      if (mask & (1 << v)) continue
      this.sink?.setVolume(v, 0)
    }
  }

  /** LVO -66 at $2102ec: read and cleared */
  readVu(channel: number): number {
    const n = this.vu[channel] ?? 0
    if (channel >= 0 && channel < 4) this.vu[channel] = 0
    return n
  }

  /** LVO -72 at $210308, read and cleared, and 255 rather than -1 */
  readEnd(): boolean {
    const was = this.end
    this.end = false
    return was
  }

  /** one interrupt: $210784 */
  tick(): void {
    if (!this.song) return
    if (this.counter === 0) return
    this.counter -= 1
    if (this.counter === 0) {
      this.counter = this.speed
      for (let v = 0; v < 4; v++) this.rowPass(v)
    }
    for (let v = 0; v < 4; v++) {
      if (!(this.enabled & (1 << v))) continue
      const ch = this.voices[v]!
      const out = this.sequencePass(v, ch)
      this.sink?.setFrequency(v, periodToHz(Math.max(1, out.period), PAULA_CLOCK))
      // $2107fa: the volume is capped at 64 and then scaled by the master, and
      // the same number is the vu byte
      const scaled = (Math.min(0x40, out.volume) * this.master) >> 6
      this.vu[v] = scaled & 0xff
      this.sink?.setVolume(v, clampVolume(scaled))
      if (ch.relatch !== 0) ch.relatch -= 1
    }
  }

  /* ---- the row, $2109ce ---- */

  private rowPass(v: number): void {
    const song = this.song!
    const ch = this.voices[v]!
    const at = ch.pattern + ch.patternAt
    if ((song.patterns[at] ?? 0) === FC14_PATTERN_END || ch.patternAt === FC14_PATTERN_BYTES) {
      ch.patternAt = 0
      let seq = ch.seqNext + v * 3
      if (seq === ch.seqEnd) {
        this.end = true
        ch.seqNext = 0
        seq = v * 3
      }
      ch.seqAt = seq
      // $210a0e: one shared counter for all four voices, so the speed byte is
      // taken once per sequence step rather than four times
      this.stepGate = u8(this.stepGate + 1)
      if (this.stepGate === 5) {
        this.stepGate = 1
        // `move.b $c(a2),d1` with a2 already carrying the voice's own three-byte
        // offset, so the byte is twelve past THAT. Voice 0 is the one that gets
        // here, which is the only reason it reads the speed and not a transpose
        const s = song.sequence[ch.seqNext + v * 3 + 0x0c] ?? 0
        if (s !== 0) this.speed = s
      }
      ch.pattern = (song.sequence[seq] ?? 0) * FC14_PATTERN_BYTES
      ch.transpose = song.sequence[seq + 1] ?? 0
      ch.soundTranspose = song.sequence[seq + 2] ?? 0
      ch.seqNext += FC14_STEP_BYTES
    }

    const row = ch.pattern + ch.patternAt
    let d0 = song.patterns[row] ?? 0
    const d1 = song.patterns[row + 1] ?? 0
    if (d0 !== 0) {
      ch.portaPeriod = 0
      ch.patternPorta = 0
      if (d1 & 0x80) ch.patternPorta = song.patterns[row + 3] ?? 0
    } else if ((d1 & 0xc0) !== 0) {
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
    // $210a84: the DMA is only cut when ALL FOUR enables are set. Disable one
    // voice and the other three stop retriggering cleanly
    if ((this.enabled & 0b1111) === 0b1111) this.sink?.stop(v)

    const volSeq = u8((d1 & 0x3f) + ch.soundTranspose) * FC14_SEQUENCE_BYTES
    ch.volAt = 0
    ch.volSpeed = song.volSequences[volSeq] ?? 0
    ch.volSpeedReload = ch.volSpeed
    const freq = song.volSequences[volSeq + 1] ?? 0
    ch.vibSpeed = song.volSequences[volSeq + 2] ?? 0
    ch.volume = 0x40
    ch.vibDepth = song.volSequences[volSeq + 3] ?? 0
    ch.vibValue = ch.vibDepth
    ch.vibDelay = song.volSequences[volSeq + 4] ?? 0
    ch.vibFlags = 0x40
    ch.volSeq = volSeq + 5
    ch.freqSeq = freq * FC14_SEQUENCE_BYTES
    ch.freqAt = 0
    ch.volWait = 0
    ch.freqWait = 0
    ch.patternAt += 2
  }

  /* ---- the two sequences and the period, $210b02 ---- */

  private sequencePass(v: number, ch: Voice): { period: number; volume: number } {
    this.frequencySequence(v, ch)
    this.volumeSequence(ch)
    return { period: this.period(ch), volume: ch.volume }
  }

  private frequencySequence(v: number, ch: Voice): void {
    const song = this.song!
    // a wait is spent before anything is read, and $e8 comes back here
    for (let guard = 0; guard < 64; guard++) {
      if (ch.freqWait !== 0) {
        ch.freqWait -= 1
        return
      }
      const at = ch.freqSeq + ch.freqAt
      let d0 = song.freqSequences[at] ?? 0
      if (d0 === 0xe1) return
      if (d0 === 0xe0) {
        const to = (song.freqSequences[at + 1] ?? 0) & 0x3f
        ch.freqAt = to
        d0 = song.freqSequences[ch.freqSeq + to] ?? 0
      }
      const arg = (n: number): number => song.freqSequences[ch.freqSeq + ch.freqAt + n] ?? 0
      if (d0 === 0xe2 || d0 === 0xe4) {
        this.setSample(v, ch, arg(1), d0 === 0xe2)
        if (d0 === 0xe2) {
          ch.volAt = 0
          ch.volSpeed = 1
        }
        ch.freqAt += 2
      } else if (d0 === 0xe9) {
        this.setSubSample(v, ch, arg(1), arg(2))
        ch.freqAt += 3
      } else if (d0 === 0xe7) {
        ch.freqSeq = arg(1) * FC14_SEQUENCE_BYTES
        ch.freqAt = 0
        continue
      } else if (d0 === 0xea) {
        ch.portaStep = arg(1)
        ch.portaCount = arg(2)
        ch.freqAt += 3
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
      ch.freqValue = song.freqSequences[ch.freqSeq + ch.freqAt] ?? 0
      ch.freqAt += 1
      return
    }
  }

  /** $210b48 and $210b98: point the channel at a sample, with or without a restart */
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
   * $210bd4, the `$e9` arm: a sample whose data is an "SSMP" container of
   * sixteen-byte records, each an offset and a length pair, with the audio
   * itself $140 bytes further on.
   *
   * NOT MODELLED: `move.l $4(a2),$4(a3)` writes FOUR bytes at AUDxLEN, so it
   * lands AUDxPER as well. Nothing in the container makes that a sensible
   * period and no module here uses the command, so this sets the length alone.
   */
  private setSubSample(v: number, ch: Voice, n: number, sub: number): void {
    const song = this.song!
    const s = song.samples[n]
    if (!s || s.pcm.length < 4) return
    if (String.fromCharCode(...new Uint8Array(s.pcm.buffer, s.pcm.byteOffset, 4)) !== 'SSMP') return
    const base = s.pcm.byteOffset - song.data.byteOffset + 4
    const rec = base + sub * 16
    const from = base + 0x140 + rd32(song.data, rec)
    const words = rd16(song.data, rec + 4)
    ch.sample = { pcm: slice(song.data, from, words * 2), words, repeatStart: rd16(song.data, rec + 6), repeatWords: rd16(song.data, rec + 8) }
    ch.repeatStart = ch.sample.repeatStart
    ch.repeatWords = ch.sample.repeatWords
    ch.relatch = 3
    ch.volAt = 0
    ch.volSpeed = 1
    this.trigger(v, ch, true)
  }

  /**
   * What the DMA does with the pointers the two commands wrote.
   *
   * `$e2` writes DMACON first, so the channel restarts from sample 0. `$e4`
   * does not: the running sample plays out and the NEW pointers take effect at
   * the loop, which is exactly the buffer swap `setWaveform` was added for and
   * is the whole of FC's wavetable synthesis.
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
    this.sink?.play(v, pcm, periodToHz(Math.max(1, this.period(ch)), PAULA_CLOCK), clampVolume((Math.min(0x40, ch.volume) * this.master) >> 6), loopStart, loopEnd)
  }

  /** $210ca8: the volume sequence, its slide, and the two toggles that halve them */
  private volumeSequence(ch: Voice): void {
    const song = this.song!
    if (ch.volWait !== 0) {
      ch.volWait -= 1
      return
    }
    if (ch.volSlideCount === 0) {
      ch.volSpeed = u8(ch.volSpeed - 1)
      if (ch.volSpeed !== 0) return
      ch.volSpeed = ch.volSpeedReload
      for (let guard = 0; guard < 64; guard++) {
        const at = ch.volSeq + ch.volAt
        const d0 = song.volSequences[at] ?? 0
        if (d0 === 0xe1) return
        if (d0 === 0xea) {
          ch.volSlide = song.volSequences[at + 1] ?? 0
          ch.volSlideCount = song.volSequences[at + 2] ?? 0
          ch.volAt += 3
          break
        }
        if (d0 === 0xe8) {
          ch.volAt += 2
          ch.volWait = song.volSequences[at + 1] ?? 0
          return
        }
        if (d0 === 0xe0) {
          // MINUS FIVE, because `$a(a0)` already skipped the five-byte header
          ch.volAt = u8(((song.volSequences[at + 1] ?? 0) & 0x3f) - 5)
          continue
        }
        ch.volume = d0
        ch.volAt += 1
        return
      }
    }
    // $210d1a: `not.b` alternates, so a slide moves on every other tick
    ch.toggleVol = u8(~ch.toggleVol)
    if (ch.toggleVol === 0) return
    ch.volSlideCount = u8(ch.volSlideCount - 1)
    ch.volume = u8(ch.volume + ch.volSlide)
    // `bpl` --- past 127 the slide is abandoned and the voice goes silent
    if (ch.volume & 0x80) {
      ch.volSlideCount = 0
      ch.volume = 0
    }
  }

  /** $210d42: the note, the vibrato, the two portamentos and the clamp */
  private period(ch: Voice): number {
    let index = ch.freqValue
    // bit 7 makes it the table index whole rather than an offset from the note
    if ((index & 0x80) === 0) index = u8(index + ch.note + ch.transpose)
    index &= 0x7f
    let period = FC14_PERIODS[index] ?? 0
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
        d1 = (((d1 * 2) << 16) >> 16)
        d5 += 0x18
      }
      period += d1
    }
    ch.vibFlags = u8(flags ^ 0x01)

    ch.togglePorta = u8(~ch.togglePorta)
    if (ch.togglePorta !== 0 && ch.patternPorta !== 0) {
      let d1 = ch.patternPorta
      if (d1 > 0x1f) d1 = -(d1 & 0x1f)
      ch.portaPeriod -= d1
    }
    ch.toggleSlide = u8(~ch.toggleSlide)
    if (ch.toggleSlide !== 0 && ch.portaCount !== 0) {
      ch.portaCount = u8(ch.portaCount - 1)
      ch.portaPeriod -= s8(ch.portaStep)
    }
    period += ch.portaPeriod
    if (period <= 0x70) period = FC14_MIN_PERIOD
    if (period > FC14_MAX_PERIOD) period = FC14_MAX_PERIOD
    return period
  }
}
