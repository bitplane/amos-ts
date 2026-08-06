/**
 * The ProTracker replay — four channels, sixteen effects, one engine.
 *
 * ## Why this exists
 *
 * There are five module formats in this port and, before this file, exactly
 * two of them made a sound. `music.ts` steps AMOS's own `.ABK` tracker and
 * `med.ts` steps MMD0/MMD1. The other three did not:
 *
 *   - **AMCAF's ProTracker.** `Pt Play` validates the `M.K.` signature, caches
 *     the module, resets speed to 6 and 125 bpm, and sets `playing = true`.
 *     Nothing then advanced a row. Its 24 keywords were faithful about
 *     everything except the fact that the music never started: `Pt Cpos` and
 *     `Pt Cpattern` answered 0 forever, and four keyword notes in
 *     `coverage/status.ts` say "this port does not step patterns" as an
 *     APPROXIMATED caveat on a routine that was otherwise exact.
 *   - **P61.** `amiga/p61.ts` unpacks a Player 6.1A module completely — the
 *     delta-coded samples, the back-referenced note streams, the lot — and
 *     nothing consumed the result. Nine faithful keywords, no audio.
 *   - **THX/AHX**, which is synthesis rather than sample replay and is a
 *     different engine again (#230).
 *
 * A P61 module IS a ProTracker module: same four channels, same note and
 * effect encoding, packed differently. So the two silent sample formats want
 * ONE replay between them, and this is it.
 *
 * ## Evidence
 *
 * SOURCE tier, and unusually good for a replayer. `610.2_devpac3.asm` — 2,483
 * lines, "Player 6.1A, Version 610.2, (c) 1992-95 Jarno Paananen" — ships
 * inside the AMOS P61 distribution beside the wrapper that drives it. Every
 * effect below is transcribed from a named routine in it: `P61_Music` is the
 * tick, `P61_jtab` the row-time effect table, `P61_jtab2` the between-tick
 * one, `P61_etab`/`P61_etab2` the two halves of the E commands.
 *
 * DEVIATION: **AMCAF's replayer is not this code**, and it is the one that
 * matters here. AMCAF carries its own at `$9bac` of `AMOSPro_AMCAF.Lib`, which
 * has not been disassembled. Player 6.1A is a faithful ProTracker replayer and
 * AMCAF's claims to be one too, so they agree on the format and on all sixteen
 * effects; where they differ in some corner, this port follows Paananen.
 * Driving AMCAF from a replayer read off another binary is a smaller error
 * than not driving it at all, but it is an error, and it is recorded here and
 * in `status.ts` rather than left for someone to discover.
 *
 * ## The two tables, checked against the shipped binary
 *
 * The source `incbin`s both of them — `data/p61a.periods` and
 * `data/p61a.vibtab` — and the distribution does not include the data
 * directory, so neither table is in the source at all. Both were read out of
 * the assembled `AMOSPro_P61.Lib` instead: the period table at file offset
 * `$aa8` and the vibrato table at `$17a6`. `protracker.test.ts` re-extracts
 * both from the library and compares, so the transcription cannot rot.
 */
import { PAULA_CLOCK, clampVolume, periodToHz } from './paula'
import type { AudioSink } from './host'

/**
 * The finetuned period table: sixteen rows of thirty-seven words, at `$aa8`.
 *
 * Rows 0 to 7 are finetune 0 to +7 and rows 8 to 15 are -8 to -1, which is the
 * order the finetune nibble already has — `E5x` and a MOD sample header both
 * store the value as a four-bit two's-complement number, so the nibble indexes
 * this straight without a sign fixup.
 *
 * The thirty-seventh word is why this is flat rather than a 16x36 array.
 * Entry 0 of each row DUPLICATES entry 1 (856, 856, 808, ... and 850, 850,
 * 802, ...), and both the arpeggio and the note lookup index it as one long
 * table, so a note near the top of the range plus an arpeggio offset reads
 * into the NEXT finetune row rather than off the end. That overflow is
 * audible — an arpeggio on B-3 detunes instead of transposing — and keeping
 * the shape means it happens here for the same reason it happens there.
 *
 * `AMIGA_PERIODS` in `paula.ts` is row 0 without its duplicate, and
 * `protracker.test.ts` checks the two still agree.
 */
export const PT_PERIODS_PER_ROW = 37

const PERIOD_ROWS: readonly (readonly number[])[] = [
  [856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453, 428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226, 214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113],
  [850, 802, 757, 715, 674, 637, 601, 567, 535, 505, 477, 450, 425, 401, 379, 357, 337, 318, 300, 284, 268, 253, 239, 225, 213, 201, 189, 179, 169, 159, 150, 142, 134, 126, 119, 113],
  [844, 796, 752, 709, 670, 632, 597, 563, 532, 502, 474, 447, 422, 398, 376, 355, 335, 316, 298, 282, 266, 251, 237, 224, 211, 199, 188, 177, 167, 158, 149, 141, 133, 125, 118, 112],
  [838, 791, 746, 704, 665, 628, 592, 559, 528, 498, 470, 444, 419, 395, 373, 352, 332, 314, 296, 280, 264, 249, 235, 222, 209, 198, 187, 176, 166, 157, 148, 140, 132, 125, 118, 111],
  [832, 785, 741, 699, 660, 623, 588, 555, 524, 495, 467, 441, 416, 392, 370, 350, 330, 312, 294, 278, 262, 247, 233, 220, 208, 196, 185, 175, 165, 156, 147, 139, 131, 124, 117, 110],
  [826, 779, 736, 694, 655, 619, 584, 551, 520, 491, 463, 437, 413, 390, 368, 347, 328, 309, 292, 276, 260, 245, 232, 219, 206, 195, 184, 174, 164, 155, 146, 138, 130, 123, 116, 109],
  [820, 774, 730, 689, 651, 614, 580, 547, 516, 487, 460, 434, 410, 387, 365, 345, 325, 307, 290, 274, 258, 244, 230, 217, 205, 193, 183, 172, 163, 154, 145, 137, 129, 122, 115, 109],
  [814, 768, 725, 684, 646, 610, 575, 543, 513, 484, 457, 431, 407, 384, 363, 342, 323, 305, 288, 272, 256, 242, 228, 216, 204, 192, 181, 171, 161, 152, 144, 136, 128, 121, 114, 108],
  [907, 856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453, 428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226, 214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120],
  [900, 850, 802, 757, 715, 675, 636, 601, 567, 535, 505, 477, 450, 425, 401, 379, 357, 337, 318, 300, 284, 268, 253, 238, 225, 212, 200, 189, 179, 169, 159, 150, 142, 134, 126, 119],
  [894, 844, 796, 752, 709, 670, 632, 597, 563, 532, 502, 474, 447, 422, 398, 376, 355, 335, 316, 298, 282, 266, 251, 237, 223, 211, 199, 188, 177, 167, 158, 149, 141, 133, 125, 118],
  [887, 838, 791, 746, 704, 665, 628, 592, 559, 528, 498, 470, 444, 419, 395, 373, 352, 332, 314, 296, 280, 264, 249, 235, 222, 209, 198, 187, 176, 166, 157, 148, 140, 132, 125, 118],
  [881, 832, 785, 741, 699, 660, 623, 588, 555, 524, 494, 467, 441, 416, 392, 370, 350, 330, 312, 294, 278, 262, 247, 233, 220, 208, 196, 185, 175, 165, 156, 147, 139, 131, 123, 117],
  [875, 826, 779, 736, 694, 655, 619, 584, 551, 520, 491, 463, 437, 413, 390, 368, 347, 328, 309, 292, 276, 260, 245, 232, 219, 206, 195, 184, 174, 164, 155, 146, 138, 130, 123, 116],
  [868, 820, 774, 730, 689, 651, 614, 580, 547, 516, 487, 460, 434, 410, 387, 365, 345, 325, 307, 290, 274, 258, 244, 230, 217, 205, 193, 183, 172, 163, 154, 145, 137, 129, 122, 115],
  [862, 814, 768, 725, 684, 646, 610, 575, 543, 513, 484, 457, 431, 407, 384, 363, 342, 323, 305, 288, 272, 256, 242, 228, 216, 203, 192, 181, 171, 161, 152, 144, 136, 128, 121, 114],
]

/** the table as the replayer indexes it: `fine * 37 + note`, note 1..36 */
export const PT_PERIODS: Int16Array = ((): Int16Array => {
  const t = new Int16Array(16 * PT_PERIODS_PER_ROW)
  for (let r = 0; r < 16; r++) {
    const row = PERIOD_ROWS[r]!
    t[r * PT_PERIODS_PER_ROW] = row[0]! // the duplicate entry 0
    for (let n = 0; n < 36; n++) t[r * PT_PERIODS_PER_ROW + 1 + n] = row[n]!
  }
  return t
})()

/**
 * ProTracker's sine, the 32 points a vibrato or tremolo walks.
 *
 * The replayer never uses this directly. `P61_vibtab` is 16 x 32 BYTES of
 * `(sine * depth) >> 7` precomputed, because a `mulu` per channel per tick was
 * worth avoiding on a 7MHz machine — and this port derives it rather than
 * carrying 512 constants, having first checked the derivation is byte-exact
 * against the table in the shipped library at `$17a6`.
 */
export const PT_SINE: readonly number[] = [
  0, 24, 49, 74, 97, 120, 141, 161, 180, 197, 212, 224, 235, 244, 250, 253,
  255, 253, 250, 244, 235, 224, 212, 197, 180, 161, 141, 120, 97, 74, 49, 24,
]

/** `P61_vibtab`: the sine scaled by depth, 16 rows of 32 */
export const PT_VIBRATO: Uint8Array = ((): Uint8Array => {
  const t = new Uint8Array(16 * 32)
  for (let d = 0; d < 16; d++) for (let p = 0; p < 32; p++) t[d * 32 + p] = (PT_SINE[p]! * d) >> 7
  return t
})()

/**
 * `P61_FunkTable` — the sixteen speeds of EFx, invert loop.
 *
 * The obscurest thing ProTracker does: it walks a pointer through the sample's
 * repeat region and one's-complements the byte it lands on, permanently
 * altering the sample in memory. Reproduced, including the destruction.
 */
const FUNK_TABLE: readonly number[] = [0, 5, 6, 7, 8, 10, 11, 13, 16, 19, 22, 26, 32, 43, 64, 128]

/**
 * `P61_mulutab` — 0, 74, 148, ... 1110, the finetune nibble scaled to a BYTE
 * offset into the period table. 74 bytes is 37 words, which is one row, so
 * the nibble and the row index are the same number and this port stores the
 * row. Kept as a constant because it is the check that the table's stride is
 * 37 and not 36.
 */
export const FINETUNE_STRIDE_BYTES = 74

/**
 * One sample.
 *
 * `loopStart` and `loopLen` are in BYTES where the file stores words, because
 * that is what `AudioSink` takes and what every caller has to convert to
 * anyway. A loop length of 2 bytes or less is ProTracker's "no repeat".
 */
export interface PtSample {
  pcm: Int8Array
  loopStart: number
  loopLen: number
  /** 0..64 */
  volume: number
  /** 0..15, the row of `PT_PERIODS` — already in the table's own order */
  finetune: number
}

/** one cell: `note` is 1..36 into a period row, 0 for none */
export interface PtRow {
  note: number
  instrument: number
  command: number
  info: number
}

/**
 * A song, whatever format it arrived in.
 *
 * `pattern` is a function rather than an array because P61 stores its patterns
 * as four back-referenced byte streams and decoding one is not free; a MOD
 * hands back a slice it already has. Either way the engine asks for
 * `[row][channel]` and does not care which.
 */
export interface PtSong {
  /** instrument N is `samples[N - 1]`; a hole is a null */
  samples: readonly (PtSample | null)[]
  positions: readonly number[]
  pattern(n: number): readonly (readonly PtRow[])[]
  /**
   * Whether `Axy`, `5xy` and `6xy` carry a PRE-SIGNED delta rather than a
   * nibble pair — see `volumeSlide`. A P61 stream does, a MOD does not, and
   * the difference is a property of the file rather than of the replay, so it
   * travels with the song instead of being set on the engine by whoever
   * happened to load it.
   */
  signedSlide?: boolean
}

/** every ProTracker pattern is 64 rows */
export const PT_ROWS = 64

/** the empty cell, and the one a channel starts on */
const EMPTY_ROW: PtRow = { note: 0, instrument: 0, command: 0, info: 0 }

/**
 * Read an `M.K.` module.
 *
 * The layout is fixed and public: 20 bytes of song name, 31 sample headers of
 * 30 (a 22-byte name, the length in WORDS, finetune, volume, repeat point and
 * repeat length), the song length, the restart byte, a 128-entry pattern
 * order, four magic bytes, then the patterns at 1024 bytes each and finally
 * the sample data in header order.
 *
 * A pattern cell stores a PERIOD, not a note index, so this maps each one back
 * through the finetune-0 row — which is what ProTracker's own replayer does,
 * and why a module whose periods have been hand-edited off the grid loses its
 * note. An unmatched period becomes note 0.
 */
export function parseMod(data: Uint8Array): PtSong | null {
  if (data.length < 1084) return null
  const sig = String.fromCharCode(...data.subarray(1080, 1084))
  if (sig !== 'M.K.' && sig !== 'M!K!') return null

  const rd = (o: number): number => ((data[o] ?? 0) << 8) | (data[o + 1] ?? 0)

  const songLen = Math.min(128, data[950] ?? 0)
  const order: number[] = []
  for (let i = 0; i < songLen; i++) order.push(data[952 + i] ?? 0)
  let patterns = 0
  // the pattern COUNT is the whole 128-byte table's maximum, not the song
  // length's — a module may carry patterns its order never reaches, and the
  // sample data starts after all of them
  for (let i = 0; i < 128; i++) patterns = Math.max(patterns, (data[952 + i] ?? 0) + 1)

  let at = 1084 + patterns * 1024
  const samples: (PtSample | null)[] = []
  for (let i = 0; i < 31; i++) {
    const h = 20 + i * 30
    const len = rd(h + 22) * 2
    const finetune = (data[h + 24] ?? 0) & 0xf
    const volume = Math.min(64, data[h + 25] ?? 0)
    const loopStart = rd(h + 26) * 2
    const loopLen = rd(h + 28) * 2
    const end = Math.min(at + len, data.length)
    const pcm = len > 0 ? new Int8Array(data.buffer, data.byteOffset + at, Math.max(0, end - at)) : null
    at += len
    samples.push(pcm ? { pcm, loopStart, loopLen, volume, finetune } : null)
  }

  // period -> note index, off the finetune-0 row the file's periods are on
  const byPeriod = new Map<number, number>()
  for (let n = 1; n <= 36; n++) byPeriod.set(PT_PERIODS[n]!, n)

  const cache = new Map<number, PtRow[][]>()
  const pattern = (n: number): PtRow[][] => {
    const hit = cache.get(n)
    if (hit) return hit
    const rows: PtRow[][] = []
    const base = 1084 + n * 1024
    for (let r = 0; r < PT_ROWS; r++) {
      const cells: PtRow[] = []
      for (let c = 0; c < 4; c++) {
        const o = base + (r * 4 + c) * 4
        const b0 = data[o] ?? 0
        const b1 = data[o + 1] ?? 0
        const b2 = data[o + 2] ?? 0
        const period = ((b0 & 0xf) << 8) | b1
        cells.push({
          note: period === 0 ? 0 : (byPeriod.get(period) ?? 0),
          instrument: (b0 & 0xf0) | (b2 >> 4),
          command: b2 & 0xf,
          info: data[o + 3] ?? 0,
        })
      }
      rows.push(cells)
    }
    cache.set(n, rows)
    return rows
  }

  return { samples, positions: order.length ? order : [0], pattern }
}

/** one channel's live state — `P61_temp0` through `P61_temp3` */
export interface PtChannel {
  /** 1..36, the index into a period row; 0 = nothing playing */
  note: number
  /** `P61_Fine`, already divided by 74: the period ROW, 0..15 */
  fine: number
  period: number
  /** `P61_ToPeriod`, the 3xx target; 0 when the slide has arrived */
  toPeriod: number
  tpSpeed: number
  /** `P61_Volume`, 0..64, before the master fade */
  volume: number
  /** `P61_Shadow`, what the fade pass scales — vibrato-modulated, not stored */
  shadow: number
  instrument: number
  sample: PtSample | null
  vibCmd: number
  vibPos: number
  treCmd: number
  trePos: number
  retrig: number
  offset: number
  lOffset: number
  funkSpeed: number
  funkOffset: number
  funkWave: number
  command: number
  info: number
  /** `P61_OnOff`: false for an empty row, which skips the whole effect path */
  on: boolean
}

function newChannel(): PtChannel {
  return {
    note: 0, fine: 0, period: 0, toPeriod: 0, tpSpeed: 0,
    volume: 0, shadow: 0, instrument: 0, sample: null,
    vibCmd: 0, vibPos: 0, treCmd: 0, trePos: 0, retrig: 0,
    offset: 0, lOffset: 0, funkSpeed: 0, funkOffset: 0, funkWave: 0,
    command: 0, info: 0, on: false,
  }
}

/**
 * The replay.
 *
 * `tick()` is one call of `P61_Music`: at 50Hz for VBL timing, or at whatever
 * rate the caller runs it for CIA timing. It either steps the effects between
 * rows or plays a new row, and finishes with the master-volume pass.
 *
 * The engine drives an `AudioSink` and nothing else — no banks, no keywords,
 * no AMOS. What a caller reads back out is `pos`, `patt`, `row` and the four
 * `channels`, which is exactly what `Pt Cpos`, `Pt Cpattern`, `Pt Cnote`,
 * `Pt Cinstr` and `Pt Cfreq` were written against and could not answer.
 */
export class Protracker {
  song: PtSong | null = null
  readonly channels: PtChannel[] = [newChannel(), newChannel(), newChannel(), newChannel()]

  /** `P61_Play`: false silences the tick entirely, without touching the voices */
  playing = false
  /** `P61_cn`, the tick within the row */
  counter = 0
  /** `P61_speed`, ticks a row — 6 out of `P61_Init` */
  speed = 6
  /** the CIA tempo, in bpm; VBL timing ignores it */
  bpm = 125
  /** `P61_Tempo`: with it false, a speed of 32 or more is still a speed */
  ciaTempo = true

  /** `P61_Pos`, `P61_Patt`, `P61_CRow` */
  pos = 0
  patt = 0
  row = 0

  /** `P61_Master` / `P61_FadeTo` / `P61_FadeSpeed` / `P61_FadeCount`, all 0..64 */
  master = 64
  fadeTo = 64
  fadeSpeed = 1
  fadeCount = 0

  /** `P61_E8`, the E8x mailbox — and -2 when the song has wrapped */
  e8 = 0

  /** which voices the music may use; a caller's sound effect takes the rest */
  voices = 0b1111

  /** set by a position jump or a pattern break, so `advance` does not add to it */
  private broke = false
  private patternDelay = 0
  private patternDelayFlag = false
  private loopRow = 0
  private loopCount = 0
  private loopSet = false
  private loopJump = false
  /** the loaded song's `signedSlide`, cached because `volumeSlide` runs per tick */
  private signedSlide = false
  private rowsOfPattern: readonly (readonly PtRow[])[] = []
  /** what the sink was last told, so a tick only writes on a change */
  private readonly lastFreq = [0, 0, 0, 0]
  private readonly lastVol = [-1, -1, -1, -1]

  /**
   * The sink is reached through a function, not held, because a Runtime's
   * `host.audio` can be replaced between frames — the same reason `MedPlayer`
   * takes a host with a getter rather than an `AudioSink`.
   */
  constructor(private readonly sinkOf: () => AudioSink | undefined) {}

  private get sink(): AudioSink | undefined {
    return this.sinkOf()
  }

  /**
   * Load a song and reset, which is `P61_Init` plus the tail of AMCAF's
   * selector-1 arm: speed 6, 125 bpm, row 0, all four channels cleared, and
   * the song position the caller asked for.
   */
  load(song: PtSong, position = 0): void {
    this.song = song
    this.signedSlide = song.signedSlide === true
    this.pos = position < song.positions.length ? position : 0
    this.patt = song.positions[this.pos] ?? 0
    this.rowsOfPattern = song.pattern(this.patt)
    this.row = 0
    this.counter = 0
    this.speed = 6
    this.bpm = 125
    this.e8 = 0
    this.patternDelay = 0
    this.patternDelayFlag = false
    this.loopRow = 0
    this.loopCount = 0
    this.loopSet = false
    this.loopJump = false
    this.broke = false
    for (let i = 0; i < 4; i++) {
      this.channels[i] = newChannel()
      this.lastFreq[i] = 0
      this.lastVol[i] = -1
    }
  }

  /**
   * Forget what the sink was last told.
   *
   * `lastFreq`/`lastVol` exist only so a tick does not repeat a write that
   * changes nothing — on the machine `P61_mfade` stores AUDxVOL every tick
   * regardless. So anything that writes the voices BEHIND the replay, as
   * `P61 Pause` does when it zeroes the four volume registers itself, has to
   * say so, or the next tick will believe the hardware already agrees.
   */
  forget(): void {
    for (let v = 0; v < 4; v++) {
      this.lastFreq[v] = 0
      this.lastVol[v] = -1
    }
  }

  /** `P61_End` minus the hardware teardown: silence the voices the music holds */
  stop(): void {
    this.playing = false
    for (let v = 0; v < 4; v++) if (this.voices & (1 << v)) this.sink?.stop(v)
  }

  /**
   * `P61_SetPosition`. "Starts from the beginning if out of limits" — an
   * `blo` against the song length, so a position past the end is 0 rather
   * than an error.
   */
  setPosition(p: number): void {
    if (!this.song) return
    this.loopSet = false
    const n = p & 0xff
    this.pos = n < this.song.positions.length ? n : 0
    this.patt = this.song.positions[this.pos] ?? 0
    this.rowsOfPattern = this.song.pattern(this.patt)
    this.row = 0
  }

  /**
   * One call of `P61_Music`.
   *
   * `tst P61_Play / bne` is the first thing it does and an `rts` is the
   * second, BEFORE the fade pass is pushed — so a stopped replayer does not
   * even run the master volume, and a fade that was in flight freezes rather
   * than completing.
   */
  tick(): void {
    if (!this.playing || !this.song) return
    this.counter = (this.counter + 1) & 0xffff
    // `cmp P61_speed(pc),d4 / beq` is an EQUALITY test on a word, and `F00`
    // stores a speed of 0 that the rising counter can never equal — so the
    // row tick stops firing and the song freezes on its last row, playing on.
    // Reproduced: it is how a module ends without silence.
    if (this.speed > 0 && this.counter >= this.speed) {
      this.counter = 0
      this.playRow()
    } else {
      this.tickEffects()
    }
    this.fadePass()
  }

  /* ---- the row tick: P61_playtime ---- */

  private playRow(): void {
    // `P61_pattdelay`: EEx holds the pattern for x more rows, and every one of
    // them runs the between-tick effects instead
    if (this.patternDelayFlag) {
      if (this.patternDelay > 0) {
        this.patternDelay--
        this.tickEffects()
        return
      }
      this.patternDelayFlag = false
    }

    const cells = this.rowsOfPattern[this.row] ?? []
    for (let v = 0; v < 4; v++) {
      const ch = this.channels[v]!
      const cell = cells[v] ?? EMPTY_ROW
      ch.on = !(cell.note === 0 && cell.instrument === 0 && cell.command === 0 && cell.info === 0)
      ch.command = cell.command
      ch.info = cell.info
      if (cell.instrument !== 0) {
        // `P61_dko`, and the LONG move is the point:
        //
        //     move.l  P61_SampleVolume(a1),P61_Volume(a5)
        //     move.l  P61_RepeatOffset(a1),P61_Wave(a5)
        //     clr     P61_Offset(a5)
        //
        // volume and finetune are adjacent words in both the sample block and
        // the channel block, so ONE longword sets both. An instrument number
        // with no note still resets them, which is why `1 ... C20` and
        // `... C20` are different rows and every module depends on it. The
        // invert-loop pointer goes home and the sample offset is cleared.
        const s = this.song!.samples[cell.instrument - 1] ?? null
        ch.instrument = cell.instrument
        ch.sample = s
        if (s) {
          ch.volume = s.volume
          ch.shadow = s.volume
          ch.fine = s.finetune
          ch.funkWave = s.loopStart
        }
        ch.offset = 0
      }
      if (ch.on) this.rowEffect(v, ch, cell)
      else this.writePeriod(v, ch.period)
      // `P61_nocha`, which every channel reaches at the end of its row pass:
      //
      //     move  P61_Period(a5),6(a4)
      //     move  P61_Volume(a5),P61_Shadow(a5)
      //
      // so the shadow the master-volume pass scales is re-seeded from the
      // channel volume once a row. It is what undoes a tremolo when the row
      // that asked for it ends.
      ch.shadow = ch.volume
      this.funk(ch)
    }
    this.advance()
  }

  /** `P61_jtab` — what a command does on the tick its row arrives */
  private rowEffect(v: number, ch: PtChannel, cell: PtRow): void {
    switch (ch.command) {
      case 0x3: // 3xy tone portamento: set the speed, aim at the note, DON'T retrigger
        if (ch.info !== 0) ch.tpSpeed = ch.info
        this.setToneTarget(v, ch, cell)
        return
      case 0x5: // 5xy tone portamento + volume slide: the aim, without the speed
        this.setToneTarget(v, ch, cell)
        return
      case 0x4: // 4xy vibrato: each nibble is kept when zero
        if (ch.info !== 0) ch.vibCmd = mergeNibbles(ch.vibCmd, ch.info)
        break
      case 0x7: // 7xy tremolo, the same merge
        if (ch.info !== 0) ch.treCmd = mergeNibbles(ch.treCmd, ch.info)
        break
      case 0x9: // 9xx sample offset
        this.sampleOffset(v, ch, cell)
        return
      case 0xb: // Bxx position jump, which FALLS THROUGH into the pattern break
        this.positionJump(ch.info)
        return
      case 0xc: // Cxx set volume
        ch.volume = ch.info
        break
      case 0xd: // Dxx pattern break
        this.patternBreak(ch.info)
        return
      case 0xe:
        this.rowECommand(v, ch, cell)
        return
      case 0xf: // Fxx speed or tempo
        this.setSpeed(ch.info)
        break
      default:
        break
    }
    this.triggerIfNote(v, ch, cell)
  }

  /** `P61_fxdone` then `P61_zample`: take the note, then retrigger the sample */
  private triggerIfNote(v: number, ch: PtChannel, cell: PtRow): void {
    if (cell.note === 0) {
      this.writePeriod(v, ch.period)
      return
    }
    ch.vibPos = 0
    ch.trePos = 0
    ch.note = cell.note
    ch.period = this.periodOf(ch)
    this.trigger(v, ch, ch.offset)
    this.writePeriod(v, ch.period)
  }

  /** `P61_settoneport` — the target note, with no retrigger and no vibrato reset */
  private setToneTarget(v: number, ch: PtChannel, cell: PtRow): void {
    if (cell.note !== 0) {
      ch.note = cell.note
      ch.toPeriod = this.periodOf(ch)
    }
    this.writePeriod(v, ch.period)
  }

  /**
   * `P61_sampleoffse` — 9xx, and the comment in the source is the interesting
   * part. `add d1,P61_Offset(a5)` runs TWICE for a row that carries a note,
   * once before the note test and once after, and Paananen labels the second
   * `; THIS IS A PT-FEATURE!` — so a repeated `9xx` on consecutive rows walks
   * further into the sample each time. Reproduced, defect and all.
   *
   * `move #$ff00,d1 / and 2(a5),d1` reads the offset from the info byte
   * shifted up; a zero info reuses the last one, which is the `.deq` arm.
   */
  private sampleOffset(v: number, ch: PtChannel, cell: PtRow): void {
    let d1 = ch.info << 8
    if (d1 === 0) d1 = ch.lOffset
    ch.lOffset = d1
    ch.offset += d1
    if (cell.note === 0) {
      // no note: the pending offset still applies to whatever is playing
      this.trigger(v, ch, ch.offset)
      this.writePeriod(v, ch.period)
      return
    }
    const start = ch.offset
    ch.offset += d1
    ch.vibPos = 0
    ch.trePos = 0
    ch.note = cell.note
    ch.period = this.periodOf(ch)
    this.trigger(v, ch, start)
    this.writePeriod(v, ch.period)
  }

  /** `P61_etab` — the E commands, at row time */
  private rowECommand(v: number, ch: PtChannel, cell: PtRow): void {
    const arg = ch.info & 0xf
    switch (ch.info >> 4) {
      case 0x0: // E0x filter: bit 1 of CIA-A PRA, exactly as Led On/Off drives it
        this.sink?.setFilter((arg & 1) === 0)
        this.triggerIfNote(v, ch, cell)
        return
      case 0x1: // E1x fine slide up, clamped at 113 — the note is taken FIRST
        this.takeNote(ch, cell)
        ch.period = Math.max(113, ch.period - arg)
        if (cell.note !== 0) this.trigger(v, ch, ch.offset)
        this.writePeriod(v, ch.period)
        return
      case 0x2: // E2x fine slide down, clamped at 856
        this.takeNote(ch, cell)
        ch.period = Math.min(856, ch.period + arg)
        if (cell.note !== 0) this.trigger(v, ch, ch.offset)
        this.writePeriod(v, ch.period)
        return
      case 0x5: // E5x set finetune — `P61_mulutab[arg]` is arg rows of 74 bytes
        ch.fine = arg
        break
      case 0x6: // E6x pattern loop
        this.patternLoop(arg)
        break
      case 0x8: // E8x — a mailbox for the program, and nothing else
        this.e8 = arg
        break
      case 0x9: // E9x set retrigger
        ch.retrig = arg
        break
      case 0xa: // EAx fine volume up
        ch.volume = Math.min(64, ch.volume + arg)
        break
      case 0xb: // EBx fine volume down
        ch.volume = Math.max(0, ch.volume - arg)
        break
      case 0xd: // EDx note delay: take the note but do NOT trigger it yet
        if (cell.note !== 0) {
          ch.vibPos = 0
          ch.trePos = 0
          ch.note = cell.note
          ch.period = this.periodOf(ch)
          ch.shadow = ch.volume
        }
        return
      case 0xe: // EEx pattern delay
        this.patternDelay = arg
        this.patternDelayFlag = true
        break
      case 0xf: // EFx invert loop
        ch.funkSpeed = arg
        break
      default:
        break
    }
    this.triggerIfNote(v, ch, cell)
  }

  /** the `P61_getnote` macro: take the note without retriggering the sample */
  private takeNote(ch: PtChannel, cell: PtRow): void {
    if (cell.note === 0) return
    ch.vibPos = 0
    ch.trePos = 0
    ch.note = cell.note
    ch.period = this.periodOf(ch)
  }

  /* ---- the between-row ticks: P61_delay / P61_jtab2 ---- */

  private tickEffects(): void {
    for (let v = 0; v < 4; v++) {
      const ch = this.channels[v]!
      if (!ch.on) {
        this.funk(ch)
        continue
      }
      switch (ch.command) {
        case 0x0: // 0xy arpeggio — see `arpeggio` for why P61 files store it as 8
          this.arpeggio(v, ch)
          break
        case 0x1: // 1xx portamento up
          ch.period = Math.max(113, ch.period - ch.info)
          this.writePeriod(v, ch.period)
          break
        case 0x2: // 2xx portamento down
          ch.period = Math.min(856, ch.period + ch.info)
          this.writePeriod(v, ch.period)
          break
        case 0x3:
          this.tonePortamento(v, ch)
          break
        case 0x4:
          this.vibrato(v, ch)
          break
        case 0x5: // 5xy: the volume slide first, then the portamento
          this.volumeSlide(ch)
          this.tonePortamento(v, ch)
          break
        case 0x6: // 6xy: the volume slide, then the vibrato
          this.volumeSlide(ch)
          this.vibrato(v, ch)
          break
        case 0x7:
          this.tremolo(ch)
          break
        case 0xa: // Axy volume slide
          this.volumeSlide(ch)
          break
        case 0xe:
          this.tickECommand(v, ch)
          break
        default:
          break
      }
      this.funk(ch)
    }
  }

  /**
   * `P61_arpeggio` — three notes a row, `0,1,-1` repeated from `P61_arplist`.
   *
   * The list is indexed by the TICK counter and is 32 entries long, so a
   * speed above 32 would read past it; the source ships exactly 32 and so does
   * this. Tick 0 is the base note, tick 1 the high nibble, tick 2 the low.
   *
   * NOTE: a P61 file stores arpeggio as command **8**, not 0. `P61_jtab2` has
   * `P61_arpeggio` at index 8 and nothing at index 0, the swap being the
   * packer's — command 0 with info 0 is the commonest cell in a module and is
   * worth packing as "no command at all". The engine uses ProTracker's
   * numbering and `p61Song` does the swap on the way in, so a MOD's arpeggio
   * and a P61's reach the same place.
   */
  private arpeggio(v: number, ch: PtChannel): void {
    const step = [0, 1, -1][this.counter % 3]!
    if (step === 0) {
      this.writePeriod(v, PT_PERIODS[ch.fine * PT_PERIODS_PER_ROW + ch.note] ?? ch.period)
      return
    }
    const semis = step > 0 ? ch.info >> 4 : ch.info & 0xf
    // the index runs off the end of its finetune row into the next one, which
    // is why `PT_PERIODS` keeps the 37-word shape
    const idx = ch.fine * PT_PERIODS_PER_ROW + ch.note + semis
    this.writePeriod(v, PT_PERIODS[idx] ?? ch.period)
  }

  /** `P61_toneport` — slide toward `toPeriod`, and clear it on arrival */
  private tonePortamento(v: number, ch: PtChannel): void {
    if (ch.toPeriod === 0) return
    if (ch.toPeriod < ch.period) {
      ch.period -= ch.tpSpeed
      if (ch.period <= ch.toPeriod) {
        ch.period = ch.toPeriod
        ch.toPeriod = 0
      }
    } else {
      ch.period += ch.tpSpeed
      if (ch.period >= ch.toPeriod) {
        ch.period = ch.toPeriod
        ch.toPeriod = 0
      }
    }
    this.writePeriod(v, ch.period)
  }

  /**
   * `P61_volslide` — Axy, and the arithmetic says what the packer did.
   *
   * The routine is one subtraction for both directions:
   *
   *     move.b  P61_Info(a5),d0
   *     sub.b   d0,P61_Volume+1(a5)
   *     bpl.b   .test                  ; negative -> silence
   *     clr     P61_Volume(a5)
   *   .test moveq #64,d0
   *     cmp     P61_Volume(a5),d0
   *     bge.b   .ncs                   ; over 64 -> 64
   *
   * Read literally against a ProTracker `Axy`, `A50` — slide UP by five —
   * arrives as $50, eighty, and takes any volume straight to zero. No module
   * would survive that, so the info byte reaching this routine is not an
   * `Axy` pair: it is a SIGNED delta, and the P61 packer is what normalises
   * it when it builds the streams. `A50` becomes -5 and the `sub.b` adds five.
   *
   * A P61 song therefore sets `signedSlide` and reaches the `sub.b` with the
   * byte its own stream holds. A MOD's pair is raw, so it is folded down to
   * the same delta first — `x` if the high nibble is set, else `-y`, which is
   * ProTracker's own precedence. Either way the byte arithmetic below is the
   * routine's, including the two clamps and the order they are tested in.
   *
   * `5xy` and `6xy` share this: `P61_tpochvslide:1135` and
   * `P61_vibochvslide:2093` each open with the same two instructions before
   * branching into the portamento or the vibrato.
   */
  private volumeSlide(ch: PtChannel): void {
    const up = ch.info >> 4
    const delta = this.signedSlide ? (ch.info << 24) >> 24 : up !== 0 ? -up : ch.info & 0xf
    const signed = ((ch.volume - delta) << 24) >> 24
    if (signed < 0) {
      ch.volume = 0
      ch.shadow = 0
      return
    }
    ch.volume = signed > 64 ? 64 : signed
    ch.shadow = ch.volume
  }

  /** `P61_vib2` — the period is modulated for the tick, not stored */
  private vibrato(v: number, ch: PtChannel): void {
    const depth = ch.vibCmd & 0xf
    const amp = PT_VIBRATO[depth * 32 + ((ch.vibPos >> 2) & 0x1f)] ?? 0
    // `tst.b P61_VibPos(a5) / bmi` — the sign of the BYTE picks the half
    const p = (ch.vibPos << 24) >> 24 < 0 ? ch.period - amp : ch.period + amp
    this.writePeriod(v, p)
    ch.vibPos = (ch.vibPos + (((ch.vibCmd >> 2) & 0x3c) | 0)) & 0xff
  }

  /** `P61_tremo` — the same walk on the volume, clamped both ends */
  private tremolo(ch: PtChannel): void {
    const depth = ch.treCmd & 0xf
    const amp = PT_VIBRATO[depth * 32 + ((ch.trePos >> 2) & 0x1f)] ?? 0
    let d1 = (ch.trePos << 24) >> 24 < 0 ? ch.volume - amp : ch.volume + amp
    if (d1 > 64) d1 = 64
    if (d1 < 0) d1 = 0
    ch.shadow = d1
    ch.trePos = (ch.trePos + (((ch.treCmd >> 2) & 0x3c) | 0)) & 0xff
  }

  /** `P61_etab2` — the four E commands with a between-tick half */
  private tickECommand(v: number, ch: PtChannel): void {
    const arg = ch.info & 0xf
    switch (ch.info >> 4) {
      case 0x1: // E1x fine slide up: `tst (a3) / bne` — tick 0 ONLY
        if (this.counter !== 0) return
        ch.period = Math.max(113, ch.period - arg)
        this.writePeriod(v, ch.period)
        return
      case 0x2:
        if (this.counter !== 0) return
        ch.period = Math.min(856, ch.period + arg)
        this.writePeriod(v, ch.period)
        return
      case 0x9: // E9x retrigger: count down, and re-arm on the trigger
        if (--ch.retrig !== 0) return
        this.trigger(v, ch, ch.offset)
        ch.retrig = arg
        return
      case 0xa:
        if (this.counter !== 0) return
        ch.volume = Math.min(64, ch.volume + arg)
        ch.shadow = ch.volume
        return
      case 0xb:
        if (this.counter !== 0) return
        ch.volume = Math.max(0, ch.volume - arg)
        ch.shadow = ch.volume
        return
      case 0xc: // ECx note cut: on the named tick, and it zeroes both volumes
        if (arg !== this.counter) return
        ch.volume = 0
        ch.shadow = 0
        return
      case 0xd: // EDx note delay: the trigger the row tick withheld
        if (arg !== this.counter) return
        if (ch.note === 0) return
        this.trigger(v, ch, ch.offset)
        this.writePeriod(v, ch.period)
        return
      default:
        return
    }
  }

  /**
   * `P61_funk2` — EFx, invert loop.
   *
   * A pointer walks the sample's repeat region and each step one's-complements
   * the byte it lands on, so the sample is permanently altered in memory.
   * That is the original's behaviour and it is reproduced: for a MOD the PCM
   * is a view onto the bank, exactly as it was a view onto chip RAM.
   */
  private funk(ch: PtChannel): void {
    if (ch.funkSpeed === 0) return
    const s = ch.sample
    if (!s || s.loopLen <= 2) return
    ch.funkOffset += FUNK_TABLE[ch.funkSpeed]!
    if (ch.funkOffset < 128) return
    ch.funkOffset = 0
    ch.funkWave++
    if (ch.funkWave >= s.loopStart + s.loopLen) ch.funkWave = s.loopStart
    if (ch.funkWave < s.pcm.length) s.pcm[ch.funkWave] = ~s.pcm[ch.funkWave]!
  }

  /* ---- song position ---- */

  /**
   * `P61_posjmp` — Bxx.
   *
   * "Starts from the beginning if out of limits" applies here too: an unsigned
   * `cmp P61_slen / blo` against the song length, and a position past the end
   * is 0 rather than a stop.
   *
   * NOTE: in the original this stores the position and then FALLS THROUGH into
   * `P61_pattbreak`, which does `addq #1,P61_Pos` before reading the pattern
   * from the stream pointer `posjmp` just moved. So the pattern that plays is
   * the one asked for and `P61_Pos` reports one MORE than that — a bookkeeping
   * artifact of the fallthrough, visible only through P61's own status word.
   * Not reproduced: this engine also answers AMCAF's `Pt Cpattern`, whose
   * replayer is different code, and duplicating the off-by-one would be
   * copying a second library's accident into the first library's reading.
   */
  private positionJump(to: number): void {
    if (!this.song) return
    this.jumpTo(to < this.song.positions.length ? to : 0)
  }

  /**
   * `P61_pattbreak` — Dxx.
   *
   * NOTE: the routine reads no argument at all. `moveq #64,d0 / move
   * d0,P61_rowpos / clr P61_CRow` and straight on to the next position, so a
   * P61 module always breaks to row 0 where ProTracker breaks to the row Dxx
   * names. The packer is what makes that safe — it resolves the destination
   * when it builds the streams — and a MOD fed in raw would lose the row. The
   * argument is honoured here, which is a DEVIATION from this source in the
   * direction of the format being read; P61 modules carry zero in it and get
   * the same answer either way.
   *
   * The destination is two DECIMAL digits, not a byte: `D10` is row ten.
   */
  private patternBreak(info: number): void {
    const to = (info >> 4) * 10 + (info & 0xf)
    this.jumpTo(this.pos + 1)
    this.row = to < PT_ROWS ? to : 0
  }

  /** move to a song position, load its pattern, and land on row 0 */
  private jumpTo(next: number): void {
    if (!this.song) return
    if (next >= this.song.positions.length) {
      this.pos = 0
      this.e8 = -2 // `move.w #-2,P61_E8` — the song has wrapped
    } else {
      this.pos = next
    }
    this.patt = this.song.positions[this.pos] ?? 0
    this.rowsOfPattern = this.song.pattern(this.patt)
    this.row = 0
    this.loopJump = false
    this.broke = true
  }

  /**
   * `P61_patternloop` — E6x.
   *
   * `E60` marks the row; `E6x` jumps back to it x times. The count lives on
   * the SONG, not the channel (`P61_plcount` is beside `P61_cn`), so two
   * channels both carrying E6x share one counter — which is ProTracker's own
   * behaviour and the reason a loop written on two channels runs half as long.
   */
  private patternLoop(arg: number): void {
    if (arg === 0) {
      if (this.loopSet) return
      this.loopRow = this.row
      return
    }
    if (!this.loopSet) {
      this.loopCount = arg
      this.loopSet = true
    }
    if (this.loopCount === 0) {
      this.loopSet = false
      return
    }
    this.loopJump = true
    this.loopCount--
  }

  /**
   * `P61_ohittaa`: the next row, or the next pattern when this one runs out.
   *
   * A break or a jump has already placed the row, and in the original the
   * decrement that follows is absorbed by `rowpos` having been set to 64 —
   * one PAST the end — rather than 63. `broke` is that absorption.
   */
  private advance(): void {
    if (this.broke) {
      this.broke = false
      return
    }
    if (this.loopJump) {
      this.loopJump = false
      this.row = this.loopRow
      return
    }
    this.row++
    if (this.row < PT_ROWS) return
    this.jumpTo(this.pos + 1)
    this.broke = false
  }

  /**
   * `P61_cspeed` — Fxx, and the split is at 32 rather than at 31.
   *
   * `cmp.b #32,d0 / bhs P61_STempo` sends 32 and above to the CIA timer and
   * anything below to the speed, so F20 is a speed of 32 and F1F is a speed of
   * 31. With `P61_Tempo` clear the tempo arm is skipped entirely and every
   * value is a speed. F00 is left alone by both arms: `cmp.b #1,d0` and the
   * `subq.b #1` below it, so a speed of 0 becomes -1 and the row tick never
   * fires again. Reproduced — it is how a module stops itself.
   */
  private setSpeed(n: number): void {
    if (this.ciaTempo && n >= 32) {
      this.bpm = n
      return
    }
    this.speed = n
  }

  /* ---- the hardware side ---- */

  /** `P61_zample`: DMA off, point at the sample, DMA on */
  private trigger(v: number, ch: PtChannel, offsetBytes: number): void {
    if (!(this.voices & (1 << v))) return
    const s = ch.sample
    if (!s || s.pcm.length === 0) return
    const off = Math.max(0, offsetBytes)
    const loop = s.loopLen > 2 ? s.loopStart : -1
    if (off >= s.pcm.length) {
      // `move.l -4(a1),(a4) / moveq #1,d0` — past the end, the repeat pointer
      // with a length of one word
      const start = loop >= 0 ? loop : 0
      this.sink?.play(v, s.pcm.subarray(start, Math.min(s.pcm.length, start + 2)), this.hz(ch.period), this.mix(ch), -1)
      return
    }
    const pcm = off > 0 ? s.pcm.subarray(off) : s.pcm
    this.sink?.play(v, pcm, this.hz(ch.period), this.mix(ch), loop >= 0 ? Math.max(0, loop - off) : -1,
      loop >= 0 ? Math.max(0, loop - off) + s.loopLen : undefined)
    this.lastFreq[v] = this.hz(ch.period)
    this.lastVol[v] = this.mix(ch)
  }

  /** `move P61_Period(a5),6(a4)` — AUDxPER, without retriggering */
  private writePeriod(v: number, period: number): void {
    if (!(this.voices & (1 << v))) return
    if (period <= 0) return
    const hz = this.hz(period)
    if (hz === this.lastFreq[v]) return
    this.lastFreq[v] = hz
    this.sink?.setFrequency(v, hz)
  }

  private hz(period: number): number {
    return periodToHz(Math.max(1, period), PAULA_CLOCK)
  }

  /** what AUDxVOL ends up holding: the channel's volume through the master */
  private mix(ch: PtChannel): number {
    return clampVolume((ch.shadow * this.master) >> 6)
  }

  /**
   * `P61_mfade` — the master volume pass, pushed as `P61_Music`'s return
   * address so it runs after everything else on every tick.
   *
   * The fade walk is two instructions and reads oddly on purpose:
   *
   *     cmp.w d1,d0 / beq .skip / blt .add
   *     subq.w #2,d0
   *   .add addq.w #1,d0
   *
   * so falling through the `blt` subtracts 2 and then adds 1 — a step of -1 —
   * while taking it adds 1. One shared `addq` for both directions.
   *
   * `mulu d0,d1 / lsr #6,d1` is then the channel volume times the master over
   * 64, which is the only place the two meet.
   */
  private fadePass(): void {
    let m = this.master
    if (m !== this.fadeTo) {
      const next = m < this.fadeTo ? m + 1 : m - 1
      if (--this.fadeCount <= 0) {
        this.fadeCount = this.fadeSpeed
        this.master = next
        m = next
      }
    }
    for (let v = 0; v < 4; v++) {
      if (!(this.voices & (1 << v))) continue
      const want = this.mix(this.channels[v]!)
      if (want === this.lastVol[v]) continue
      this.lastVol[v] = want
      this.sink?.setVolume(v, want)
    }
  }

  private periodOf(ch: PtChannel): number {
    return PT_PERIODS[ch.fine * PT_PERIODS_PER_ROW + ch.note] ?? 0
  }
}

/** `4xy`/`7xy`: a zero nibble keeps what was there, each side independently */
function mergeNibbles(old: number, info: number): number {
  let out = old
  if ((info & 0xf) !== 0) out = (out & 0xf0) | (info & 0xf)
  if ((info & 0xf0) !== 0) out = (out & 0x0f) | (info & 0xf0)
  return out
}
