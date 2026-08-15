/**
 * BP SoundMon 2.0 — the module format, off `DME_SoundMon2.0.library`.
 *
 * Brian Postma's SoundMon is a synth tracker in the same family as THX: an
 * instrument is either a sampled one or a SYNTH, and a synth carries no audio
 * at all, only three modulator scripts that walk 64-byte waveform tables. The
 * example module here is 7,368 bytes and every one of its fifteen instruments
 * is a synth, which is the whole reason it is that size.
 *
 * ## Evidence
 *
 * `DME_SoundMon2.0.library`, 4,392 bytes at $210000: hunk 0 code
 * ($210000+3340), hunk 1 data ($210d0c+532) and hunk 2 a 520-byte BSS. No
 * mixing buffers anywhere, because SoundMon is four channels straight onto
 * Paula. The romtag at $210004 reads "DME_SoundMon2.0.library 2.0 (22. October
 * 97) DOOM Productions 1997".
 *
 * `InitModule` is $2105f8 and it is forty instructions, which is where all of
 * the layout below comes from.
 *
 * ## The file
 *
 *   $00  26 bytes  the song name
 *   $1a  3 bytes   "V.2", and $210610 checks all three
 *   $1d  byte      how many 64-byte WAVEFORM TABLES follow the patterns
 *   $1e  word      how many song steps
 *   $20  15 x 32   the instrument records
 *   $200 steps x 16  the song: four voices of four bytes
 *        pats x 48   the patterns, 16 rows of three bytes
 *        waves x 64  the waveform tables the synths walk
 *        the samples, chained on the sampled records' word lengths
 *
 * How many patterns there are is not stated anywhere: $210634 walks all
 * `steps * 4` song entries and takes the LARGEST pattern number it finds. So a
 * module whose highest-numbered pattern is unreferenced has that pattern's
 * bytes counted as sample data, and one referenced only past the song length
 * still counts.
 *
 * The extension's own tag test is looser than the library's. Routine 139
 * ($5564) reads the LONG at $1a and clears its low byte before comparing with
 * "V.2\0", so the byte at $1d --- the waveform count --- is not part of it.
 *
 * ## The song and the patterns
 *
 * A song step is sixteen bytes, four per voice: a pattern number as a WORD
 * (one-based, `subq.w #$1` then `mulu.w #$30` at $210800), then a SOUND
 * TRANSPOSE byte and a NOTE TRANSPOSE byte. Both are added to what the pattern
 * says, and `Axy` is the one command that can suppress them.
 *
 * A pattern cell is three bytes: the note, then the instrument in the high
 * nibble with the command in the low one, then the command's parameter.
 *
 * ## The instrument record
 *
 * Thirty-two bytes, and $ff at byte 0 marks a SYNTH ($2109d0). The two kinds
 * share the record and disagree about what most of it means, which is why the
 * offsets below are split. `$18` is the sharpest case: a sampled instrument's
 * length in words, and a synth's waveform-shape speed.
 */

/** `cmpi.w #$562e,$1a(a1)` and `cmpi.b #$32,$1c(a1)` at $21060a */
export const SMON_MAGIC = 'V.2'
export const SMON_MAGIC_AT = 0x1a
/** `lea $20(a1)` at $210676: fifteen records of thirty-two bytes */
export const SMON_INSTRUMENTS = 15
export const SMON_RECORD_BYTES = 0x20
export const SMON_RECORDS_AT = 0x20
/** `move.l #$200,d0` at $210622 */
export const SMON_SONG_AT = 0x200
/** four voices of four bytes */
export const SMON_STEP_BYTES = 16
/** `mulu.w #$30,d2` at $210802: sixteen rows of three */
export const SMON_PATTERN_BYTES = 0x30
export const SMON_ROWS = 16
export const SMON_CELL_BYTES = 3
/** `lsl.l #$6,d3` everywhere the synth indexes one */
export const SMON_WAVE_BYTES = 0x40
/** `cmpi.b #$ff,(a3,d7.w)` at $2109d0 */
export const SMON_SYNTH = 0xff

/** one of the fifteen, as a synth reads it */
export interface SmonSynth {
  /** `$01`: which waveform table the voice starts on */
  wave: number
  /** `$02`: the length in words, which is AUDxLEN */
  words: number
  /** `$04`, `$05`, `$06`, `$08`: the volume modulator */
  volOn: number
  volTable: number
  volLength: number
  volSpeed: number
  /** `$09`, `$0a`, `$0b`, `$0c`, `$0e`, `$10`: the pitch modulator */
  pitchOn: number
  pitchTable: number
  /** `$0b`, and a zero here means "do not divide" ($210c40) */
  pitchDivide: number
  pitchLength: number
  pitchDelay: number
  pitchSpeed: number
  /** `$11`, `$12`, `$13`, `$14`, `$16`, `$18`: the waveform-shape modulator */
  shapeOn: number
  shapeTable: number
  shapeWidth: number
  shapeLength: number
  shapeDelay: number
  shapeSpeed: number
  /** `$19`: the volume a note starts on when the cell does not say */
  volume: number
}

/** one of the fifteen, as a sampled instrument reads it */
export interface SmonSample {
  /** the bytes, sliced out of the module */
  pcm: Int8Array
  /** `$18`: the length in WORDS, which is also what the chain advances by */
  words: number
  /** `$1a`: the repeat start, in bytes, added to the pointer at $210a1e */
  repeatStart: number
  /** `$1c`: the repeat length, in words */
  repeatWords: number
}

export interface SmonInstrument {
  /** `$ff` at byte 0 */
  synth: boolean
  /** the eight bytes a sampled instrument opens with */
  name: string
  sample: SmonSample | null
  synthesis: SmonSynth | null
}

/** one three-byte cell */
export interface SmonCell {
  /** 0 for none, and otherwise a one-based index into the period table */
  note: number
  /** the high nibble of byte 1, 0 for "the one before" */
  instrument: number
  /** the low nibble of byte 1 */
  command: number
  param: number
}

/** one voice of one song step */
export interface SmonSlot {
  /** one-based in the file, and zero here means the step names no pattern */
  pattern: number
  soundTranspose: number
  noteTranspose: number
}

export interface SmonSong {
  name: string
  /** `$1e`, and the position wraps when it reaches this ($21097e) */
  steps: number
  /** four slots a step */
  sequence: SmonSlot[][]
  /** `[pattern][row]`, and pattern 0 of the file is index 0 here */
  patterns: SmonCell[][]
  /** `$1d` of them, 64 bytes each */
  waves: Int8Array[]
  instruments: SmonInstrument[]
}

const rd16 = (d: Uint8Array, a: number): number => ((d[a] ?? 0) << 8) | (d[a + 1] ?? 0)
const s8 = (n: number): number => (n << 24) >> 24

const str = (d: Uint8Array, at: number, n: number): string => {
  let s = ''
  for (let i = at; i < Math.min(at + n, d.length); i++) {
    const c = d[i]!
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

const slice = (d: Uint8Array, at: number, len: number): Int8Array => {
  const from = Math.max(0, Math.min(at, d.length))
  const to = Math.max(from, Math.min(at + len, d.length))
  return new Int8Array(d.buffer, d.byteOffset + from, to - from)
}

/**
 * `InitModule` at $2105f8, over a buffer instead of over chip RAM.
 *
 * The pattern count is DERIVED, because nothing in the file states it: the
 * scan at $210634 takes the largest pattern number any song slot names.
 */
export function parseSmon(data: Uint8Array): SmonSong | null {
  if (data.length < SMON_SONG_AT) return null
  if (str(data, SMON_MAGIC_AT, 3) !== SMON_MAGIC) return null

  const waveCount = data[0x1d] ?? 0
  const steps = rd16(data, 0x1e)
  if (steps <= 0) return null

  // $210634: `moveq #$1,d2` starts the maximum at one, so a song of nothing
  // but zeroes still counts one pattern
  let maxPattern = 1
  const sequence: SmonSlot[][] = []
  for (let s = 0; s < steps; s++) {
    const step: SmonSlot[] = []
    for (let v = 0; v < 4; v++) {
      const at = SMON_SONG_AT + s * SMON_STEP_BYTES + v * 4
      const pattern = rd16(data, at)
      if (pattern > maxPattern) maxPattern = pattern
      step.push({ pattern, soundTranspose: s8(data[at + 2] ?? 0), noteTranspose: s8(data[at + 3] ?? 0) })
    }
    sequence.push(step)
  }

  const patternsAt = SMON_SONG_AT + steps * SMON_STEP_BYTES
  const patterns: SmonCell[][] = []
  for (let p = 0; p < maxPattern; p++) {
    const rows: SmonCell[] = []
    for (let r = 0; r < SMON_ROWS; r++) {
      const at = patternsAt + p * SMON_PATTERN_BYTES + r * SMON_CELL_BYTES
      const b1 = data[at + 1] ?? 0
      rows.push({ note: data[at] ?? 0, instrument: b1 >> 4, command: b1 & 0x0f, param: data[at + 2] ?? 0 })
    }
    patterns.push(rows)
  }

  const wavesAt = patternsAt + maxPattern * SMON_PATTERN_BYTES
  const waves: Int8Array[] = []
  for (let w = 0; w < waveCount; w++) waves.push(slice(data, wavesAt + w * SMON_WAVE_BYTES, SMON_WAVE_BYTES))

  // $21067c: the samples chain off the end of the waveform tables, and only a
  // SAMPLED record moves the pointer
  let at = wavesAt + waveCount * SMON_WAVE_BYTES
  const instruments: SmonInstrument[] = []
  for (let i = 0; i < SMON_INSTRUMENTS; i++) {
    const r = SMON_RECORDS_AT + i * SMON_RECORD_BYTES
    const synth = (data[r] ?? 0) === SMON_SYNTH
    if (synth) {
      instruments.push({
        synth: true,
        name: '',
        sample: null,
        synthesis: {
          wave: data[r + 0x01] ?? 0,
          words: rd16(data, r + 0x02),
          volOn: data[r + 0x04] ?? 0,
          volTable: data[r + 0x05] ?? 0,
          volLength: rd16(data, r + 0x06),
          volSpeed: data[r + 0x08] ?? 0,
          pitchOn: data[r + 0x09] ?? 0,
          pitchTable: data[r + 0x0a] ?? 0,
          pitchDivide: data[r + 0x0b] ?? 0,
          pitchLength: rd16(data, r + 0x0c),
          pitchDelay: rd16(data, r + 0x0e),
          pitchSpeed: data[r + 0x10] ?? 0,
          shapeOn: data[r + 0x11] ?? 0,
          shapeTable: data[r + 0x12] ?? 0,
          shapeWidth: data[r + 0x13] ?? 0,
          shapeLength: rd16(data, r + 0x14),
          shapeDelay: rd16(data, r + 0x16),
          shapeSpeed: data[r + 0x18] ?? 0,
          volume: data[r + 0x19] ?? 0,
        },
      })
      continue
    }
    const words = rd16(data, r + 0x18)
    instruments.push({
      synth: false,
      name: str(data, r, 8),
      sample: {
        pcm: slice(data, at, words * 2),
        words,
        repeatStart: rd16(data, r + 0x1a),
        repeatWords: rd16(data, r + 0x1c),
      },
      synthesis: null,
    })
    at += words * 2
  }

  return { name: str(data, 0, 26), steps, sequence, patterns, waves, instruments }
}
