/**
 * ScreamTracker 3 — the module format, off `DME_ScreamTracker.library`.
 *
 * The first DOS format in this port, and it shows: every multi-byte field is
 * LITTLE-ENDIAN, and the replayer spends an instruction swapping each one
 * (`ror.w #$8,d0` at $211756 and everywhere after it). Offsets are given in
 * PARAGRAPHS of sixteen bytes, so a pointer has to be shifted left four before
 * it means anything.
 *
 * ## Evidence
 *
 * `DME_ScreamTracker.library`, 13,108 bytes at $210000: hunk 0 code
 * ($210000+9260), hunk 1 code ($21242c+3844), hunk 2 four bytes of data. The
 * romtag at $210004 reads "DME_ScreamTracker.library 2.0 (14. September 97)
 * DOOM Productions 1997", the earliest of the eleven.
 *
 * The header parse is $21174a, forty instructions, and it is where all of the
 * layout below comes from.
 *
 *   $00  28 bytes  the song name
 *   $1c  byte      $1a, the DOS end-of-file the format keeps
 *   $1d  byte      the type, $10 for a module
 *   $20  word      how many orders, ROUNDED UP TO EVEN for what follows
 *   $22  word      how many instruments
 *   $24  word      how many patterns
 *   $26  word      flags
 *   $28  word      the tracker version
 *   $2a  word      the sample format: 1 signed, 2 unsigned
 *   $2c  4 bytes   "SCRM", and the only thing the extension checks
 *   $30  byte      the global volume
 *   $31  byte      the speed, and SIX when it is zero ($2117d8)
 *   $32  byte      the tempo, and 125 when it is 32 OR LESS ($2117e8)
 *   $33  byte      the master volume
 *   $40  32 bytes  the channel settings, $ff for one that is off
 *   $60  the orders, then the instrument and pattern parapointers
 *
 * `lea $60(a0),a1` then `d0 = orders + (orders & 1)` at $21179c is the round
 * up: an odd order count is padded so the parapointer tables land on a word.
 *
 * ## Two things the replayer does that a reader would not
 *
 * A LOOPING SAMPLE HAS ITS LENGTH OVERWRITTEN. $21180a tests bit 0 of the
 * instrument's flags and, when the loop end past $18 is greater than two,
 * copies it over the length at $10. Any bytes after the loop end are gone
 * before a note plays, and this port drops them too rather than keeping what
 * the machine threw away.
 *
 * The module in `fixtures/` does not exercise it: all five of its looping
 * samples already have a length equal to their loop end, so the overwrite is
 * a no-op there. It is reproduced on the instruction's word, not on a
 * measurement.
 *
 * The version test at $211788 compares the SAMPLE FORMAT word against $1301
 * and sets a flag when it is not greater. The field holds 1 or 2, so the
 * comparison is true for every real module and the flag is always set. It
 * reads like a test meant for the tracker version two bytes earlier.
 *
 * ## Channels
 *
 * The 32 bytes at $40 are ScreamTracker's pan-and-enable map: $ff is a channel
 * that is off, and anything else is on with the low nibble giving its side.
 * The module in `fixtures/` enables twelve of them, which is why this format
 * needs a mixer where SoundFX, FutureComposer and SoundMon did not.
 *
 * ## The mixer
 *
 * Twelve channels do not fit in four Paula voices, so this replayer sums them
 * itself at 28,000 Hz and hands Paula a finished stream. `s3mmix.ts` holds it,
 * along with the two tables that decide how it sounds and the byte-swapped
 * 16.16 accumulator its per-sample body is built around.
 *
 * The one thing worth reading here rather than there: the clock is
 * ScreamTracker's own, `$369d80` = 14,317,056 / 4 at $211874, and the period
 * at `$10(a4)` is the one $211ac6 computes from the module's `c2spd`. Nothing
 * in the pitch path is an Amiga number.
 *
 * ## The sequencer
 *
 * `s3mplay.ts` holds it. Two things belong here rather than there, because
 * they are facts about the FORMAT as this library reads it: a row is 32
 * channels wide and indexed by the raw channel, because $211946 masks the
 * lead byte with $1f and multiplies by the channel block's $38; and $211978
 * DROPS a command byte with bit 7 set while keeping its parameter, so a cell
 * can carry a parameter that belongs to the command before it.
 */

/** `cmpi.l #$5343524d,$2c(a2)` in routine 64 --- the extension's only test */
export const S3M_MAGIC = 'SCRM'
export const S3M_MAGIC_AT = 0x2c
/** `move.b $1d(a0)`: $10 is a module */
export const S3M_TYPE_MODULE = 0x10
/** the orders begin here, and the two parapointer tables follow them */
export const S3M_ORDERS_AT = 0x60
/** ScreamTracker's fixed maximum, and the width of the table at $40 */
export const S3M_CHANNELS = 32
/** `moveq #$6,d0` at $2117de */
export const S3M_DEFAULT_SPEED = 6
/** `cmp.w #$20,d0 / bhi` at $2117e8: 32 or less is not a tempo */
export const S3M_MIN_TEMPO = 0x20
export const S3M_DEFAULT_TEMPO = 125
/** a pattern is 64 rows, however many channels it names */
export const S3M_ROWS = 64
/** `$ff` in the table at $40 */
export const S3M_CHANNEL_OFF = 0xff

/** one of the `insNum` entries, after the loop-end overwrite */
export interface S3mSample {
  name: string
  /** the bytes, sliced out of the module and converted to signed */
  pcm: Int8Array
  /** `$10`, and the loop end when the sample loops ($211824) */
  length: number
  loopStart: number
  loopEnd: number
  loops: boolean
  /** `$1c`, 0..64 */
  volume: number
  /** `$20`: the rate the sample was recorded at, which sets the period */
  c2spd: number
}

/** one cell of one row */
export interface S3mCell {
  /** 0 for none, $ff for a note-off, otherwise octave in the high nibble */
  note: number
  instrument: number
  /** 0..64, or -1 when the row does not set one */
  volume: number
  /** 0 for none, otherwise 1..26 for A..Z */
  command: number
  param: number
}

export interface S3mSong {
  name: string
  /** the orders, with the $ff terminator and any $fe markers left in */
  orders: number[]
  samples: S3mSample[]
  /** `[pattern][row][channel]`, unpacked from the byte stream */
  patterns: S3mCell[][][]
  /** which of the 32 are on, in order */
  channels: number[]
  /** the 32 bytes at $40 as they stand, which is what the pan scan at $211530 reads */
  settings: Uint8Array
  speed: number
  tempo: number
  globalVolume: number
  masterVolume: number
  /** `$2a`: 1 signed, 2 unsigned. Unsigned samples are converted on the way in */
  sampleFormat: number
}

const rd16 = (d: Uint8Array, a: number): number => (d[a] ?? 0) | ((d[a + 1] ?? 0) << 8)
const rd32 = (d: Uint8Array, a: number): number =>
  ((d[a] ?? 0) | ((d[a + 1] ?? 0) << 8) | ((d[a + 2] ?? 0) << 16) | ((d[a + 3] ?? 0) << 24)) >>> 0

const str = (d: Uint8Array, at: number, n: number): string => {
  let s = ''
  for (let i = at; i < Math.min(at + n, d.length); i++) {
    const c = d[i]!
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s.trimEnd()
}

const empty = (): S3mCell => ({ note: 0, instrument: 0, volume: -1, command: 0, param: 0 })

/**
 * One packed pattern into `[row][channel]`.
 *
 * Every row is a run of cells ended by a zero byte. The lead byte carries the
 * channel in its low five bits and three flags above it: $20 a note and an
 * instrument, $40 a volume, $80 a command and its parameter.
 *
 * A row is all 32 channels wide, not just the enabled ones, because the lead
 * byte names a RAW channel: $211946 masks it with $1f and multiplies by the
 * channel block's $38, so a module whose enabled channels have gaps still
 * lands its cells where the replayer looks for them.
 */
function unpackPattern(d: Uint8Array, at: number): S3mCell[][] {
  const rows: S3mCell[][] = []
  // the pattern opens with its own packed length, and the data starts after it
  const end = Math.min(d.length, at + 2 + rd16(d, at))
  let p = at + 2
  for (let r = 0; r < S3M_ROWS; r++) {
    const row: S3mCell[] = [...Array(S3M_CHANNELS)].map(empty)
    for (;;) {
      if (p >= end) break
      const lead = d[p++] ?? 0
      if (lead === 0) break
      const ch = lead & 0x1f
      const cell = row[ch]!
      if (lead & 0x20) {
        cell.note = d[p++] ?? 0
        cell.instrument = d[p++] ?? 0
      }
      if (lead & 0x40) cell.volume = d[p++] ?? 0
      if (lead & 0x80) {
        cell.command = d[p++] ?? 0
        cell.param = d[p++] ?? 0
      }
    }
    rows.push(row)
  }
  return rows
}

/**
 * The header parse at $21174a, over a buffer instead of over chip RAM.
 *
 * Unsigned sample data is converted to signed here rather than at every read,
 * because Paula has no unsigned mode and the field exists only to say which
 * the file used.
 */
export function parseS3m(data: Uint8Array): S3mSong | null {
  if (data.length < S3M_ORDERS_AT) return null
  if (str(data, S3M_MAGIC_AT, 4) !== S3M_MAGIC) return null

  const orderCount = rd16(data, 0x20)
  const insCount = rd16(data, 0x22)
  const patCount = rd16(data, 0x24)
  const sampleFormat = rd16(data, 0x2a)

  const orders = [...data.subarray(S3M_ORDERS_AT, S3M_ORDERS_AT + orderCount)]
  // $21179c: an odd order count is padded so the tables land on a word
  const insAt = S3M_ORDERS_AT + orderCount + (orderCount & 1)
  const patAt = insAt + insCount * 2

  const channels: number[] = []
  for (let c = 0; c < S3M_CHANNELS; c++) if ((data[0x40 + c] ?? S3M_CHANNEL_OFF) !== S3M_CHANNEL_OFF) channels.push(c)

  const samples: S3mSample[] = []
  for (let i = 0; i < insCount; i++) {
    const h = rd16(data, insAt + i * 2) << 4
    const flags = data[h + 0x1f] ?? 0
    const loops = (flags & 1) !== 0
    const loopStart = rd32(data, h + 0x14)
    const loopEnd = rd32(data, h + 0x18)
    // $211824: a looping sample's length becomes its loop end, and the bytes
    // after it are gone before anything plays
    let length = rd32(data, h + 0x10)
    if (loops && loopEnd > 2) length = loopEnd
    // the sample pointer is three bytes: a high byte then a little-endian word
    const seg = ((data[h + 0x0d] ?? 0) << 16) | rd16(data, h + 0x0e)
    const from = Math.min(data.length, seg << 4)
    const to = Math.min(data.length, from + length)
    const raw = data.subarray(from, to)
    const pcm = new Int8Array(raw.length)
    // `$2a` is 1 for signed and 2 for unsigned, and ST3 wrote unsigned
    for (let k = 0; k < raw.length; k++) pcm[k] = sampleFormat === 1 ? (raw[k]! << 24) >> 24 : raw[k]! - 128
    samples.push({
      name: str(data, h + 0x30, 28),
      pcm,
      length,
      loopStart,
      loopEnd,
      loops,
      volume: data[h + 0x1c] ?? 0,
      c2spd: rd32(data, h + 0x20),
    })
  }

  const patterns: S3mCell[][][] = []
  for (let p = 0; p < patCount; p++) {
    const at = rd16(data, patAt + p * 2) << 4
    const blank = (): S3mCell[] => [...Array(S3M_CHANNELS)].map(empty)
    patterns.push(at === 0 ? [...Array(S3M_ROWS)].map(blank) : unpackPattern(data, at))
  }

  const speed = data[0x31] ?? 0
  const tempo = data[0x32] ?? 0
  return {
    name: str(data, 0, 28),
    orders,
    samples,
    patterns,
    channels,
    settings: data.slice(0x40, 0x40 + S3M_CHANNELS),
    speed: speed === 0 ? S3M_DEFAULT_SPEED : speed,
    tempo: tempo <= S3M_MIN_TEMPO ? S3M_DEFAULT_TEMPO : tempo,
    globalVolume: data[0x30] ?? 0,
    masterVolume: data[0x33] ?? 0,
    sampleFormat,
  }
}
