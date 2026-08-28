/**
 * FastTracker 2 — the module format, off `DME_FastTracker.library`.
 *
 * The second DOS format in this port after ScreamTracker, and the same rule
 * holds: every multi-byte field is LITTLE-ENDIAN and the reader spends an
 * instruction per field putting it the right way round. The library does it
 * with `ror.w #$8,d0` for a word and a `ror.l #$8` four times for a long,
 * which is $211994 and everywhere after it.
 *
 * ## Evidence
 *
 * `DME_FastTracker.library`, 27,620 bytes at $210000: hunk 0 code
 * ($210000+21316), hunk 1 code ($215344+700), hunk 2 data ($215600+3168),
 * hunk 3 bss ($216260+2432), hunk 4 four bytes of data. The romtag at $210004
 * reads "DME_FastTracker.library 1.0 (23. October 97) DOOM Productions 1997",
 * the LAST of the twelve and the only one still at version 1.
 *
 * That version number is not cosmetic. Ten of the eleven sibling libraries
 * are refused by the extension unless they open at version 2 or higher, which
 * is what nine of `DME_ERRORS`' "V2.0 or higher" messages are for. Message 44
 * is *"Can't load DME_FastTracker.library"* with no version in it, and
 * `$4384` opens it with `moveq #$1,d0`. The library shipped a major version
 * behind everything it came in the drawer with.
 *
 * ## The header, off $2118f0
 *
 *   $00  17 bytes  "Extended Module: "
 *   $11  20 bytes  the module name, trailing spaces trimmed at $211908
 *   $25  byte      $1a, the DOS end-of-file, and what stops that trim
 *   $26  20 bytes  the tracker name
 *   $3a  word      the version, and $0104 is the only one accepted ($210a2a)
 *   $3c  long      the header size, counted FROM $3c
 *   $40  word      the song length in orders
 *   $42  word      the restart position
 *   $44  word      the channel count
 *   $46  word      how many patterns
 *   $48  word      how many instruments
 *   $4a  word      the flags, and bit 0 is the linear frequency table
 *   $4c  word      the default speed, and SIX when it is zero ($211920)
 *   $4e  word      the default BPM, and 125 when it is 32 OR LESS ($211932)
 *   $50  256 bytes the order table
 *
 * `move.b $44(a0),d0` at $21195a reads the channel count as a BYTE where every
 * neighbouring field gets the `ror.w`. On a little-endian word that is the low
 * half, so it is right for 1..255 and wrong only for a count of 256, which the
 * format cannot express. The song length two fields earlier gets the full swap.
 *
 * ## Version 1.04 or nothing
 *
 * $210a2a is `cmpi.w #$401,$3a(a0)`, an unswapped compare against the raw
 * little-endian bytes, so it passes for $0104 and for nothing else. FT2 wrote
 * 1.04 from 1994 onward and the 1.02 and 1.03 modules of the year before are
 * refused here — not with an error, but by falling through to the MOD tests
 * at $21098c, failing those too, and returning 0 from a routine whose caller
 * reads that as "no format". The tune simply does not start.
 *
 * ## Patterns
 *
 * A pattern is a nine-byte header and then the packed rows:
 *
 *   $00  long  the header length, and the rows start THAT far in, not nine
 *   $04  byte  the packing type
 *   $05  word  how many rows
 *   $07  word  the packed size in bytes, and zero means an empty pattern
 *
 * $211990 walks them by adding the header length and then the packed size,
 * keeping a pointer per pattern in the bss at $216260. A row is one to five
 * bytes per channel: a lead byte with bit 7 set is a mask, and bits 0 to 4 say
 * which of note, instrument, volume, effect and parameter follow. Bit 7 clear
 * means the lead byte IS the note and all four others follow it uncompressed.
 * $211e30 is the whole decoder, twenty instructions.
 *
 * A pattern whose packed size is zero is not skipped, it is PLAYED: $211e08
 * zeroes every channel's note, instrument, volume and effect and leaves the row
 * counter to run to the length in the header. An empty pattern still costs its
 * rows of time, and the row cursor at `$d0(a5)` never moves while it does.
 *
 * ## Instruments and samples
 *
 * The instrument header is FT2's, and the two fields the replayer reads by
 * absolute offset pin it: `$e9(a1)` is the volume envelope type at 233 and
 * `$ea(a1)` the panning type at 234 ($211f24 and $211f3e).
 *
 *   $00  long      the header size, and the sample headers start THAT far in
 *   $04  22 bytes  the name
 *   $1a  byte      the type
 *   $1b  word      how many samples, and zero ends the instrument at $2119f0
 *   $1d  long      the size of ONE sample header
 *   $21  96 bytes  which sample each of notes 1..96 plays
 *   $81  48 words  the volume envelope, twelve (x, y) pairs
 *   $b1  48 words  the panning envelope
 *   $e1  byte      how many volume points
 *   $e2  byte      how many panning points
 *   $e3  byte      the volume sustain point
 *   $e4  byte      the volume loop start
 *   $e5  byte      the volume loop end
 *   $e6  byte      the panning sustain point
 *   $e7  byte      the panning loop start
 *   $e8  byte      the panning loop end
 *   $e9  byte      the volume type: bit 0 on, bit 1 sustain, bit 2 loop
 *   $ea  byte      the panning type
 *   $eb  byte      the vibrato type
 *   $ec  byte      the vibrato sweep
 *   $ed  byte      the vibrato depth
 *   $ee  byte      the vibrato rate
 *   $ef  word      the volume fadeout
 *
 * and a sample header is
 *
 *   $00  long      the length in BYTES, 16-bit samples included
 *   $04  long      the loop start, in bytes
 *   $08  long      the loop length, in bytes
 *   $0c  byte      the volume, 0..64
 *   $0d  byte      the finetune, signed
 *   $0e  byte      the type: bits 0-1 the loop, bit 4 sixteen-bit
 *   $0f  byte      the panning
 *   $10  byte      the relative note, signed
 *   $11  byte      reserved
 *   $12  22 bytes  the name
 *
 * ## The delta decode happens ONCE, in the bank
 *
 * $211a32 and $211a4a run over the sample data in place, 16-bit or 8-bit, and
 * $211b26 then sets `$84(a5)` so that the next `Xm Play` on the same bank
 * SKIPS the whole parse. Play a module twice and the second play reads samples
 * the first one already decoded; undo that and every note is a ramp.
 *
 * DEVIATION: this port decodes into arrays of its own and leaves the bank
 * exactly as the file was. A program that `Peek`s a sample after `Xm Play`
 * sees deltas here and absolute bytes on the machine, and one that pokes new
 * sample data into a bank between two plays is heard here and ignored there,
 * because $211b26's flag makes the second play skip the parse entirely.
 *
 * A sample whose byte length is zero is skipped entirely and does not advance
 * the data pointer ($211a22), so a zero-length sample between two real ones
 * costs nothing.
 *
 * ## Ping-pong loops are forward loops
 *
 * $211ff6 is `moveq #$3,d1 / and.b $e(a1),d1 / sne.b $18(a4)`, which turns the
 * two-bit loop field into ONE BOOLEAN. Type 2 is bidirectional in FT2 and this
 * library plays it forward, so a ping-pong sample loses its reflection. The
 * parse keeps the real type anyway, because it is a fact about the file, and
 * `xmplay.ts` is where it gets flattened.
 *
 * A loop is also dropped outright when its length is two bytes or less
 * ($211fe4, `cmp.l #$2,d2 / bhi`), which is the same two-byte floor Paula's
 * own replayers use for a one-shot.
 */

/** "Extended Module: ", the sixteen bytes $210980 compares four longs of */
export const XM_MAGIC = 'Extended Module:'

/** `cmpi.w #$401,$3a(a0)` at $210a2a: version 1.04, unswapped */
export const XM_VERSION = 0x0104

/** $211920: a zero default speed is six */
export const XM_DEFAULT_SPEED = 6

/** $211932: a default BPM of 32 or less is 125 */
export const XM_DEFAULT_BPM = 125

/** $211930: `cmp.w #$20,d0 / bhi`, so 32 itself is replaced */
export const XM_MIN_BPM = 0x20

/** the order table at $50, and `move.w $92(a5),d0` bounds the walk by it */
export const XM_ORDERS_AT = 0x50

/** 96 notes, and $2122a0 indexes the sample map with the raw 1..96 byte */
export const XM_NOTES = 96

/** $212006: `cmpi.b #$61,(a2)`, note 97 */
export const XM_KEY_OFF = 97

/** twelve (x, y) pairs, the count capped by the byte at $e1 */
export const XM_ENVELOPE_POINTS = 12

/** bit 0 of `$e9(a1)`/`$ea(a1)` at $211ce4 */
export const XM_ENV_ON = 1
/** bit 1, tested at $211d52 */
export const XM_ENV_SUSTAIN = 2
/** bit 2, tested at $211d10 */
export const XM_ENV_LOOP = 4

/** bit 0 of the header flags at $4a, read as `$a3(a5)` at $21232e */
export const XM_LINEAR_PERIODS = 1

/** bits 0-1 of the sample type at $e */
export const XM_LOOP_NONE = 0
export const XM_LOOP_FORWARD = 1
export const XM_LOOP_PINGPONG = 2
/** bit 4 of the sample type */
export const XM_16_BIT = 0x10

/** $211fe4: a loop of two bytes or fewer is no loop */
export const XM_MIN_LOOP = 2

/** one envelope point */
export interface XmPoint {
  x: number
  y: number
}

export interface XmSample {
  /** in FRAMES: the header's byte length, halved for a 16-bit sample */
  length: number
  loopStart: number
  loopLength: number
  /** 0..64 */
  volume: number
  /** signed, -128..127 */
  finetune: number
  /** the raw type byte at $e, ping-pong bit and all */
  type: number
  panning: number
  /** signed, -128..127 */
  relativeNote: number
  /** what the file said; the pcm is eight bits either way, see `deltaDecode` */
  bits: 8 | 16
  name: string
  /** delta-decoded, and downconverted where the file was 16-bit */
  pcm: Int8Array
}

export interface XmInstrument {
  name: string
  /** 96 entries, one per note, each an index into `samples` */
  sampleFor: Uint8Array
  volumeEnvelope: XmPoint[]
  panningEnvelope: XmPoint[]
  volumeSustain: number
  volumeLoopStart: number
  volumeLoopEnd: number
  panningSustain: number
  panningLoopStart: number
  panningLoopEnd: number
  /** the raw `$e9` byte: bit 0 on, bit 1 sustain, bit 2 loop */
  volumeType: number
  /** the raw `$ea` byte */
  panningType: number
  vibratoType: number
  vibratoSweep: number
  vibratoDepth: number
  vibratoRate: number
  fadeout: number
  samples: XmSample[]
}

/** one channel of one row, exactly the five bytes $211e30 unpacks */
export interface XmCell {
  /** 0 for none, 1..96 for a note, 97 for key off */
  note: number
  instrument: number
  /** the raw volume column byte, $10..$50 a level and $60 and up a command */
  volume: number
  effect: number
  param: number
}

export interface XmPattern {
  rows: number
  /** `rows` entries of `channels` cells; an empty pattern is still this long */
  cells: XmCell[][]
}

export interface XmSong {
  name: string
  tracker: string
  version: number
  length: number
  restart: number
  channels: number
  flags: number
  speed: number
  bpm: number
  orders: Uint8Array
  patterns: XmPattern[]
  instruments: XmInstrument[]
}

const rd8 = (d: Uint8Array, at: number): number => d[at] ?? 0
const rd16 = (d: Uint8Array, at: number): number => (d[at] ?? 0) | ((d[at + 1] ?? 0) << 8)
const rd32 = (d: Uint8Array, at: number): number =>
  ((d[at] ?? 0) | ((d[at + 1] ?? 0) << 8) | ((d[at + 2] ?? 0) << 16) | ((d[at + 3] ?? 0) << 24)) >>> 0
const sign8 = (v: number): number => (v << 24) >> 24

/** $211908 walks back over $20 bytes; the $1a at $25 is what stops it */
function trimmed(d: Uint8Array, at: number, len: number): string {
  let end = at + len
  while (end > at && (d[end - 1] === 0x20 || d[end - 1] === 0)) end--
  let s = ''
  for (let i = at; i < end; i++) s += String.fromCharCode(d[i]!)
  return s
}

/** $210974: four longs against "Extended Module:" */
export function isXm(d: Uint8Array): boolean {
  if (d.length < 0x50) return false
  for (let i = 0; i < XM_MAGIC.length; i++) if (d[i] !== XM_MAGIC.charCodeAt(i)) return false
  return true
}

/**
 * $210a2a: the magic AND `cmpi.w #$401,$3a(a0)`. A 1.02 or 1.03 module has the
 * magic and fails here, which is not an error anywhere — it is the silence the
 * header describes.
 */
export function isPlayableXm(d: Uint8Array): boolean {
  return isXm(d) && rd16(d, 0x3a) === XM_VERSION
}

/**
 * $211a32 and $211a4a: the running sum, sixteen bits or eight, and EIGHT BITS
 * either way at the end of it.
 *
 * The 16-bit loop reads two bytes and writes one. `lsr.w #$8,d6 / move.b
 * d6,(a6)+` at $211a3e keeps the high byte of each accumulated word and throws
 * the low one away, so a 16-bit sample is downconverted where it lies and the
 * length the mixer uses is halved at $2120a6. There is no 16-bit path anywhere
 * after this: the mix accumulator is bytes through a table, and Paula is eight
 * bits. The file's own depth is kept in `bits` because it decides the halving.
 */
function deltaDecode(d: Uint8Array, at: number, bytes: number, sixteen: boolean): Int8Array {
  if (sixteen) {
    const n = bytes >> 1
    const out = new Int8Array(n)
    let acc = 0
    for (let i = 0; i < n; i++) {
      acc = (acc + rd16(d, at + i * 2)) & 0xffff
      out[i] = (acc >> 8) << 24 >> 24
    }
    return out
  }
  const out = new Int8Array(bytes)
  let acc = 0
  for (let i = 0; i < bytes; i++) {
    acc = ((acc + rd8(d, at + i)) << 24) >> 24
    out[i] = acc
  }
  return out
}

/** $2119c8: one instrument, its sample headers, then all of its sample data */
function parseInstrument(d: Uint8Array, at: number): { instrument: XmInstrument; next: number } {
  const headerSize = rd32(d, at)
  const numSamples = rd16(d, at + 0x1b)
  const name = trimmed(d, at + 4, 22)

  const points = (base: number, count: number): XmPoint[] => {
    const out: XmPoint[] = []
    for (let i = 0; i < Math.min(count, XM_ENVELOPE_POINTS); i++) {
      out.push({ x: rd16(d, base + i * 4), y: rd16(d, base + i * 4 + 2) })
    }
    return out
  }

  const instrument: XmInstrument = {
    name,
    sampleFor: new Uint8Array(XM_NOTES),
    volumeEnvelope: [],
    panningEnvelope: [],
    volumeSustain: 0,
    volumeLoopStart: 0,
    volumeLoopEnd: 0,
    panningSustain: 0,
    panningLoopStart: 0,
    panningLoopEnd: 0,
    volumeType: 0,
    panningType: 0,
    vibratoType: 0,
    vibratoSweep: 0,
    vibratoDepth: 0,
    vibratoRate: 0,
    fadeout: 0,
    samples: [],
  }

  // $2119f0: zero samples ends the instrument at its header, with none of the
  // envelope fields read. The pointer still advances by the header size.
  if (numSamples === 0) return { instrument, next: at + headerSize }

  instrument.sampleFor.set(d.subarray(at + 0x21, at + 0x21 + XM_NOTES))
  instrument.volumeEnvelope = points(at + 0x81, rd8(d, at + 0xe1))
  instrument.panningEnvelope = points(at + 0xb1, rd8(d, at + 0xe2))
  instrument.volumeSustain = rd8(d, at + 0xe3)
  instrument.volumeLoopStart = rd8(d, at + 0xe4)
  instrument.volumeLoopEnd = rd8(d, at + 0xe5)
  instrument.panningSustain = rd8(d, at + 0xe6)
  instrument.panningLoopStart = rd8(d, at + 0xe7)
  instrument.panningLoopEnd = rd8(d, at + 0xe8)
  instrument.volumeType = rd8(d, at + 0xe9)
  instrument.panningType = rd8(d, at + 0xea)
  instrument.vibratoType = rd8(d, at + 0xeb)
  instrument.vibratoSweep = rd8(d, at + 0xec)
  instrument.vibratoDepth = rd8(d, at + 0xed)
  instrument.vibratoRate = rd8(d, at + 0xee)
  instrument.fadeout = rd16(d, at + 0xef)

  const sampleHeaderSize = rd32(d, at + 0x1d)
  const headers = at + headerSize
  let data = headers + sampleHeaderSize * numSamples

  for (let i = 0; i < numSamples; i++) {
    const h = headers + sampleHeaderSize * i
    const bytes = rd32(d, h)
    const type = rd8(d, h + 0x0e)
    const sixteen = (type & XM_16_BIT) !== 0
    const shift = sixteen ? 1 : 0
    const sample: XmSample = {
      length: bytes >> shift,
      loopStart: rd32(d, h + 4) >> shift,
      loopLength: rd32(d, h + 8) >> shift,
      volume: rd8(d, h + 0x0c),
      finetune: sign8(rd8(d, h + 0x0d)),
      type,
      panning: rd8(d, h + 0x0f),
      relativeNote: sign8(rd8(d, h + 0x10)),
      bits: sixteen ? 16 : 8,
      name: trimmed(d, h + 0x12, 22),
      pcm: new Int8Array(0),
    }
    // $211a22: a zero length is skipped and does NOT advance the data pointer
    if (bytes !== 0) {
      sample.pcm = deltaDecode(d, data, Math.min(bytes, Math.max(0, d.length - data)), sixteen)
      data += bytes
    }
    instrument.samples.push(sample)
  }

  return { instrument, next: data }
}

/** $211e30: bit 7 set is a mask, bit 7 clear is the note with four bytes after */
function unpackPattern(d: Uint8Array, at: number, rows: number, channels: number, bytes: number): XmPattern {
  const cells: XmCell[][] = []
  let p = at
  const end = at + bytes
  for (let r = 0; r < rows; r++) {
    const row: XmCell[] = []
    for (let c = 0; c < channels; c++) {
      const cell: XmCell = { note: 0, instrument: 0, volume: 0, effect: 0, param: 0 }
      if (bytes !== 0 && p < end) {
        const lead = d[p++]!
        if (lead & 0x80) {
          if (lead & 0x01) cell.note = d[p++] ?? 0
          if (lead & 0x02) cell.instrument = d[p++] ?? 0
          if (lead & 0x04) cell.volume = d[p++] ?? 0
          if (lead & 0x08) cell.effect = d[p++] ?? 0
          if (lead & 0x10) cell.param = d[p++] ?? 0
        } else {
          cell.note = lead
          cell.instrument = d[p++] ?? 0
          cell.volume = d[p++] ?? 0
          cell.effect = d[p++] ?? 0
          cell.param = d[p++] ?? 0
        }
      }
      row.push(cell)
    }
    cells.push(row)
  }
  return { rows, cells }
}

/**
 * $2118f0. Returns null for anything $210974 and $210a2a between them refuse,
 * which is what the caller reads as "this bank holds no module".
 */
export function parseXm(d: Uint8Array): XmSong | null {
  if (!isPlayableXm(d)) return null

  const headerSize = rd32(d, 0x3c)
  const length = rd16(d, 0x40)
  const channels = rd8(d, 0x44)
  const numPatterns = rd16(d, 0x46)
  const numInstruments = rd16(d, 0x48)
  const speedRaw = rd16(d, 0x4c)
  const bpmRaw = rd16(d, 0x4e)
  if (channels === 0) return null

  const song: XmSong = {
    name: trimmed(d, 0x11, 20),
    tracker: trimmed(d, 0x26, 20),
    version: rd16(d, 0x3a),
    length,
    restart: rd16(d, 0x42),
    channels,
    flags: rd16(d, 0x4a),
    speed: speedRaw === 0 ? XM_DEFAULT_SPEED : speedRaw,
    bpm: bpmRaw <= XM_MIN_BPM ? XM_DEFAULT_BPM : bpmRaw,
    orders: d.slice(XM_ORDERS_AT, XM_ORDERS_AT + 256),
    patterns: [],
    instruments: [],
  }

  // $211980: the patterns start `headerSize` past $3c, not past the 60 bytes
  let p = 0x3c + headerSize
  for (let i = 0; i < numPatterns; i++) {
    if (p >= d.length) break
    const patHeader = rd32(d, p)
    const rows = rd16(d, p + 5)
    const packed = rd16(d, p + 7)
    song.patterns.push(unpackPattern(d, p + patHeader, rows, channels, packed))
    p += patHeader + packed
  }

  for (let i = 0; i < numInstruments; i++) {
    if (p >= d.length) break
    const { instrument, next } = parseInstrument(d, p)
    song.instruments.push(instrument)
    p = next
  }

  return song
}
