/**
 * The Player 6.1A module format — Jarno Paananen's packed ProTracker.
 *
 * P61 is what a ProTracker module becomes after `The Player 6.1` has packed
 * it: the same four channels, notes and effects, but with the pattern data
 * compressed and the samples optionally delta-coded to four bits. Games used
 * it because a 100K mod becomes 60K and the replayer is small.
 *
 * ## Evidence
 *
 * `610.2_devpac3.asm`, 2,483 lines, shipped inside AMOSP61Ext beside the AMOS
 * wrapper that drives it: "Player 6.1A ... Version 610.2, (c) 1992-95 Jarno
 * Paananen". SOURCE tier — every field below is read off `P61_Init` and
 * `P61_takenorm` rather than inferred from a file.
 *
 * There IS a P61 module in the corpus, in memory bank 3 of DOOM Productions'
 * `P61_Example.amos`, 7,244 bytes named `P61mod`. A signature search misses it
 * because the signature is optional and this one has none, which is what the
 * note here used to conclude from. `p61.corpus.test.ts` reads it.
 *
 * That module is what showed the sample flags were being read wrong, and it
 * showed it by being LISTENED to: the rhythm was right and the instruments
 * were noise. The arithmetic then settles it, since a sample table has to
 * account for the file it sits in.
 *
 * ## The header
 *
 * A four-byte `P61A` signature is OPTIONAL: `cmp.l #"P61A",(a0)+ / beq / subq
 * .l #4,a0` steps over it when present and rewinds when not, so a module may
 * begin at either place.
 *
 *   +0  word  where the sample data starts, used only when the caller does
 *             not pass the samples separately
 *   +2  byte  low seven bits: how many PATTERNS
 *   +3  byte  bit 7  the samples carry a running difference, decoded IN PLACE
 *                    and the same size (`P61_kook`)
 *             bit 6  a separate sample buffer is wanted, and +4 is a LONG
 *                    holding how big
 *             low 5  how many SAMPLES
 *
 * The sample table follows at +8 when bit 6 is set and +4 when it is not,
 * which is exactly the room that longword takes.
 *
 * The FOUR-BIT packing is a per-sample flag and not that bit 7: it is bit 7 of
 * each entry's finetune byte, and it only unpacks on the buffered path, where
 * `.lo` reads one byte and writes two into the caller's buffer. The two
 * schemes are exclusive per sample, `tst.b (a2) / bmi` choosing between them.
 *
 * ## The replay
 *
 * There is only one, in `protracker.ts`, transcribed from this same file. What
 * remains here is the format: `p61Song` below turns a parsed module into the
 * `PtSong` that engine loads, applying the transforms the PACKER made on the
 * way in — see it for what they are.
 */

import { PT_ROWS, type PtRow, type PtSample, type PtSong } from './protracker'
import { PT_PERIODS } from './notes'

/** one entry of the sample table, six bytes in the file */
export interface P61Sample {
  /** the decoded 8-bit PCM, or null for a sample with no data of its own */
  pcm: Int8Array | null
  /** length in WORDS, as the file stores it */
  words: number
  /** repeat start in words, and the repeat length; 1 word means "no repeat" */
  repeatStart: number
  repeatWords: number
  volume: number
  /** the low nibble of the finetune byte; the replayer scales it by 74 */
  finetune: number
  /** bit 7 of the finetune byte: this sample is four-bit delta packed */
  packed: boolean
  /** for an alias entry, the sample it borrows its data from */
  aliasOf: number | null
}

/** one decoded row of one channel */
export interface P61Row {
  /**
   * 0 for none, else the note as the FILE stores it: a byte offset into a
   * table of words, so twice the note index and always even.
   * `P61_getnote` is `moveq #$7e,d0 / and.b (a5),d0 ... move (a2,d0),
   * P61_Period(a5)`, indexing `P61_periods` with it directly, and the
   * finetune is added to it in the same units. `p61Song` halves it.
   */
  note: number
  instrument: number
  /**
   * 0..15, but NOT ProTracker's numbering — arpeggio is 8 here. See
   * `p61Song`, which puts it back.
   */
  command: number
  info: number
}

export interface P61Module {
  samples: P61Sample[]
  /** the song, one pattern number per position */
  positions: number[]
  /** per pattern, the byte offset into the pattern stream for each channel */
  patternOffsets: number[][]
  /** the packed note streams */
  stream: Uint8Array
  packedSamples: boolean
  buffered: boolean
}

/**
 * The four-bit delta table, transcribed from `.table` in `P61_Init`.
 *
 * Each nibble picks a step and the running value is SUBTRACTED by it:
 * `sub.b .table(pc,d4),d5`. The high nibble comes first, then the low, so one
 * byte yields two samples.
 */
const DELTA = [0, 1, 2, 4, 8, 16, 32, 64, 128, -64, -32, -16, -8, -4, -2, -1]

const rdW = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0)
const rdSW = (b: Uint8Array, at: number): number => (rdW(b, at) << 16) >> 16

/**
 * Unpack a four-bit delta-coded sample, the way `P61_Init`'s `.lo` loop does.
 *
 * `words` is the sample's length in words, and the loop runs `words - 1`
 * times producing two bytes a pass, so the result is `words * 2` bytes with
 * the first pair coming from the first packed byte.
 */
export function unpackDelta(src: Uint8Array, at: number, words: number): Int8Array {
  const out = new Int8Array(words * 2)
  let v = 0
  let o = 0
  for (let i = 0; i < words && o + 1 < out.length; i++) {
    const b = src[at + i] ?? 0
    v = (v - DELTA[(b >> 4) & 0xf]!) << 24 >> 24
    out[o++] = v
    v = (v - DELTA[b & 0xf]!) << 24 >> 24
    out[o++] = v
  }
  return out
}

/**
 * `P61_kook`'s in-place decode: every byte but the first becomes the running
 * difference from the one before it.
 *
 *     move.b (a5)+,d2 / sub.b (a5),d2 / move.b d2,(a5)+
 *
 * Same size in as out, which is what separates it from the four-bit unpack.
 */
export function runningDifference(pcm: Int8Array): void {
  let v = pcm[0] ?? 0
  for (let i = 1; i < pcm.length; i++) {
    v = ((v - pcm[i]!) << 24) >> 24
    pcm[i] = v
  }
}

/**
 * Read a module's structure.
 *
 * `samples` is where the sample data lives when it was handed over separately;
 * with it null the word at +0 says where it starts inside `data`, which is
 * `move (a0),d0 / lea (a0,d0.l),a1` in `P61_Init`.
 */
export function parseP61(data: Uint8Array, samples: Uint8Array | null = null): P61Module | null {
  let at = 0
  // the signature is optional, and the replayer rewinds when it is absent
  if (data[0] === 0x50 && data[1] === 0x36 && data[2] === 0x31 && data[3] === 0x41) at = 4
  if (at + 8 > data.length) return null

  const flags = data[at + 3] ?? 0
  const packedSamples = (flags & 0x80) !== 0
  const buffered = (flags & 0x40) !== 0
  const nSamples = flags & 0x1f
  const nPatterns = (data[at + 2] ?? 0) & 0x7f
  if (nSamples === 0 || nPatterns === 0) return null

  let sampleData = samples
  let sampleAt = 0
  if (!sampleData) {
    sampleData = data
    sampleAt = at + rdW(data, at)
  }

  // `lea 8(a0),a2` then `subq.l #4,a2` when bit 6 is clear
  let p = at + (buffered ? 8 : 4)
  const out: P61Sample[] = []
  let pcmAt = sampleAt
  for (let i = 0; i < nSamples; i++) {
    const len = rdSW(data, p)
    const ft = data[p + 2] ?? 0
    const vol = data[p + 3] ?? 0
    const rep = rdSW(data, p + 4)
    p += 6
    if (len < 0) {
      // `bmi / neg d4` --- a negative length ALIASES an earlier sample, and
      // `lea P61_samples-16(pc),a5` indexes the table already built
      const src = out[-len - 1] ?? null
      out.push({
        pcm: src ? src.pcm : null,
        words: src ? src.words : 0,
        repeatStart: rep < 0 ? 0 : rep,
        repeatWords: rep < 0 ? 1 : (src ? src.words : 0) - rep,
        volume: vol,
        finetune: ft & 0xf,
        packed: (ft & 0x80) !== 0,
        aliasOf: -len - 1,
      })
      continue
    }
    // Two schemes, and they are chosen by two different bits.
    //
    // A BUFFERED module (bit 6 of byte 3) has every sample copied into the
    // caller's chip buffer, and bit 7 of the finetune byte says this one is
    // four-bit delta packed on the way there: `.lo` at $158 of
    // 610.2_devpac3.asm, one byte in and two out. `AMOSPro_P61A.Lib.s:166` is
    // the caller, allocating `4(a0)` bytes of MEMF_CLEAR chip for it.
    //
    // Bit 7 of byte 3 is something else entirely: a running difference over
    // the module's own bytes, in place and the same size (`P61_kook` at $12e),
    // and it applies to the samples whose finetune bit 7 is CLEAR.
    const nibblePacked = buffered && (ft & 0x80) !== 0
    let pcm: Int8Array
    if (nibblePacked) {
      pcm = unpackDelta(sampleData, pcmAt, len)
      pcmAt += len // a packed sample occupies `len` BYTES, not words
    } else {
      pcm = new Int8Array(len * 2)
      for (let k = 0; k < len * 2; k++) pcm[k] = (sampleData[pcmAt + k] ?? 0) << 24 >> 24
      // `tst.b (a2) / bmi` skips a sample whose finetune bit 7 is set, and
      // `subq #2,d0 / bmi` skips anything shorter than two words
      if (packedSamples && (ft & 0x80) === 0 && len >= 2) runningDifference(pcm)
      pcmAt += len * 2
    }
    out.push({
      pcm,
      words: len,
      repeatStart: rep < 0 ? 0 : rep,
      repeatWords: rep < 0 ? 1 : len - rep,
      volume: vol,
      finetune: ft & 0xf,
      packed: nibblePacked,
      aliasOf: null,
    })
  }

  // `move.l a2,P61_positionbase` --- the pattern table starts where the
  // sample table ended, eight bytes a pattern: one word offset per channel
  const positionBase = p
  const possiBase = positionBase + nPatterns * 8
  const patternOffsets: number[][] = []
  for (let i = 0; i < nPatterns; i++) {
    const b = positionBase + i * 8
    patternOffsets.push([rdW(data, b), rdW(data, b + 2), rdW(data, b + 4), rdW(data, b + 6)])
  }

  // `.search cmp.b (a1)+,d0 / bne` with d0 = -1 --- the song is a byte list
  // ending in $FF, and the pattern stream begins after it
  const positions: number[] = []
  let q = possiBase
  while (q < data.length && data[q] !== 0xff) positions.push(data[q++]!)
  const streamAt = q + 1

  return {
    samples: out,
    positions,
    patternOffsets,
    stream: data.subarray(streamAt),
    packedSamples,
    buffered,
  }
}

/**
 * Decode one channel's packed note stream into rows.
 *
 * Transcribed from `P61_takenorm`. A row begins with one byte whose top bits
 * choose the shape, and the four cases are tested from the widest mask down:
 *
 *   (b & $60) != $60   a FULL entry: this byte plus two more
 *   (b & $70) != $70   a COMMAND only: the low nibble, plus an info byte
 *   (b & $78) != $78   a NOTE only: three more bits plus a byte, shifted
 *   otherwise          an EMPTY row
 *
 * and in every case bit 7 of that first byte means a compression byte
 * follows. That byte's top two bits say what kind:
 *
 *   %00nnnnnn  the row repeats n more times as an empty one
 *   %10nnnnnn  the row repeats n more times unchanged
 *   %01nnnnnn  a back-reference n rows long, with a ONE-byte distance
 *   %11nnnnnn  the same with a TWO-byte distance
 *
 * The back-references are why a P61 file is small: a phrase played twice is
 * stored once and pointed at, and `sub.l d0,a2` walks the reader backwards
 * into data it has already passed.
 */
export function decodeChannel(stream: Uint8Array, start: number, rows: number): P61Row[] {
  const out: P61Row[] = []
  let at = start
  // the back-reference return address, `P61_TempPos` in the channel block
  let ret = -1
  let left = 0

  const empty = (): P61Row => ({ note: 0, instrument: 0, command: 0, info: 0 })

  while (out.length < rows && at >= 0 && at < stream.length) {
    const b0 = stream[at++]!
    let row = empty()
    if ((b0 & 0x60) !== 0x60) {
      const b1 = stream[at++] ?? 0
      const b2 = stream[at++] ?? 0
      row = {
        note: b0 & 0x7e,
        instrument: ((b0 & 1) << 4) | (b1 >> 4),
        command: b1 & 0xf,
        info: b2,
      }
    } else if ((b0 & 0x70) !== 0x70) {
      row = { note: 0, instrument: 0, command: b0 & 0xf, info: stream[at++] ?? 0 }
    } else if ((b0 & 0x78) !== 0x78) {
      // `d1 = ((b0 & 7) << 8 | next) << 4` --- the note lands in the same
      // bits of the word the full entry uses, so the mask is the same
      const w = ((((b0 & 7) << 8) | (stream[at++] ?? 0)) << 4) & 0xffff
      row = { note: (w >> 8) & 0x7e, instrument: (((w >> 8) & 1) << 4) | ((w & 0xff) >> 4), command: 0, info: 0 }
    }
    out.push(row)

    if ((b0 & 0x80) === 0) continue
    const c = stream[at++] ?? 0
    const kind = c & 0xc0
    const n = c & 0x3f
    if (kind === 0x00) {
      for (let i = 0; i < n && out.length < rows; i++) out.push(empty())
    } else if (kind === 0x80) {
      for (let i = 0; i < n && out.length < rows; i++) out.push({ ...row })
    } else {
      // a back-reference: remember where to come back to, then rewind
      let dist: number
      if (kind === 0x40) dist = stream[at++] ?? 0
      else {
        dist = ((stream[at] ?? 0) << 8) | (stream[at + 1] ?? 0)
        at += 2
      }
      ret = at
      left = n
      at -= dist
    }
    if (left > 0 && ret >= 0) {
      // the referenced run is decoded by looping round again; when it is
      // spent the reader returns to where the reference was found
      const before = out.length
      const run = decodeChannel(stream, at, Math.min(left, rows - out.length))
      for (const r of run) if (out.length < rows) out.push(r)
      if (out.length === before) break // no progress: a malformed stream
      at = ret
      ret = -1
      left = 0
    }
  }
  while (out.length < rows) out.push(empty())
  return out
}

/** every pattern is 64 rows, because they ARE ProTracker's — `moveq #63,d7` */
export const P61_ROWS = PT_ROWS

/** one pattern, four channels of rows */
export function decodePattern(m: P61Module, pattern: number): P61Row[][] {
  const offs = m.patternOffsets[pattern]
  if (!offs) return [[], [], [], []]
  return offs.map((o) => decodeChannel(m.stream, o, P61_ROWS))
}

/**
 * One P61 cell as the shared replay wants it.
 *
 * Two things move, and both are the PACKER's doing rather than the replayer's
 * — the file stores what `P61_Music` is cheapest to feed, and the packer is
 * what put it in that shape:
 *
 * **The note halves.** `P61_getnote` masks $7e out of the byte and indexes a
 * word table with it, so the stored value is twice the note index. Halving it
 * gives 1..36, which is what `PT_PERIODS` is indexed by here.
 *
 * **Arpeggio is command 8.** `P61_jtab2` (the between-rows table, :795) has
 * `P61_arpeggio` at index 8 and `P61_contfxdone` — nothing — at index 0; the
 * row-time table `P61_jtab` (:2228) agrees, with `P61_fxdone` at both. Every
 * other index matches ProTracker exactly, 3 tone portamento through F speed.
 * So the packer moved `0xy` to `8xy`, ProTracker's 8 being unused, and won a
 * free "no command at all" for the commonest cell in a module. Command 0 is
 * therefore inert in a P61 file and stays 0, which the engine reads as an
 * arpeggio with no offsets — the same nothing.
 *
 * The third transform, the pre-signed volume slide, is NOT applied here. It
 * changes what a byte MEANS rather than which field it sits in, and re-encoding
 * it as nibbles would be lossy in one direction; `signedSlide` on the song
 * hands the byte to `volumeSlide` as the `sub.b` expects it.
 */
function ptCell(r: P61Row): PtRow {
  return { note: r.note >> 1, instrument: r.instrument, command: r.command === 8 ? 0 : r.command, info: r.info }
}

/**
 * A P61 module as a `PtSong`, ready for `Protracker.load`.
 *
 * Patterns are decoded on demand and kept, because a back-referenced stream is
 * not free to walk and a song plays each pattern several times — this is the
 * reason `PtSong.pattern` is a function at all.
 *
 * The sample block is `P61_Init`'s, sixteen bytes an entry built at :167:
 * pointer, length in words, repeat pointer, repeat length in words, volume,
 * and the finetune nibble times 74. `AudioSink` wants the loop in bytes, so
 * the two word counts double; `move #1,(a4)+` for a sample whose repeat word
 * was negative is a length of one word, which is ProTracker's "no repeat" and
 * two bytes here.
 */
export function p61Song(m: P61Module): PtSong {
  const samples: (PtSample | null)[] = m.samples.map((s) =>
    s.pcm === null
      ? null
      : {
          pcm: s.pcm,
          loopStart: s.repeatStart * 2,
          loopLen: s.repeatWords * 2,
          volume: s.volume,
          finetune: s.finetune,
        },
  )
  const cache = new Map<number, PtRow[][]>()
  return {
    samples,
    positions: m.positions,
    signedSlide: true,
    pattern(n: number): readonly (readonly PtRow[])[] {
      const had = cache.get(n)
      if (had) return had
      // `decodePattern` answers per channel; the engine walks rows
      const chans = decodePattern(m, n)
      const rows: PtRow[][] = []
      for (let r = 0; r < P61_ROWS; r++) {
        rows.push(chans.map((c) => ptCell(c[r] ?? { note: 0, instrument: 0, command: 0, info: 0 })))
      }
      cache.set(n, rows)
      return rows
    },
  }
}

/**
 * Write the unpacked module back out as a plain ProTracker MOD.
 *
 * This is how a P61 module gets a second opinion. Nothing on this machine
 * reads P61 — not libopenmpt, not ffmpeg — so the only way to hear these
 * patterns through somebody else's replayer is to hand them the data in a
 * format they do read. `src/cli/renderaudio.ts --to-mod` is the caller.
 *
 * It is NOT a faithful round trip and cannot be, for a reason worth knowing:
 * P61 and ProTracker disagree about `E6x`. `P61_patternloop` at $78e keeps ONE
 * counter and one flag for the whole song (`P61_plcount`/`P61_plflag`, both
 * `-P61_cn(a3)` globals), where ProTracker gives every channel its own
 * `n_loopcount`. A module with loops on two channels at once therefore plays
 * different music under the two, and P61_Example's bank 3 has exactly that on
 * the row at 6.48 seconds. Up to there the two agree to an envelope
 * correlation of 0.999; after it they walk apart, and neither is wrong.
 *
 * Periods are written from the finetune-0 row with the finetune left in the
 * sample header, which is where a MOD carries it and what `parseMod` reads
 * back.
 */
export function p61ToMod(m: P61Module, title = 'unpacked from P61'): Uint8Array {
  const headerBytes = 20 + 31 * 30 + 1 + 1 + 128 + 4
  const patterns = m.patternOffsets.length
  const pcmBytes = m.samples.reduce((n, s) => n + (s.aliasOf === null && s.pcm ? s.pcm.length : 0), 0)
  const out = new Uint8Array(headerBytes + patterns * PT_ROWS * 4 * 4 + pcmBytes)
  const view = new DataView(out.buffer)
  for (let i = 0; i < Math.min(20, title.length); i++) out[i] = title.charCodeAt(i) & 0x7f

  m.samples.forEach((s, i) => {
    const o = 20 + i * 30
    // an alias carries no data of its own, and a MOD has no way to say so:
    // it gets a length of zero rather than a second copy of the bytes
    view.setUint16(o + 22, s.aliasOf === null && s.pcm ? s.pcm.length >> 1 : 0)
    out[o + 24] = s.finetune & 0xf
    out[o + 25] = Math.min(64, s.volume)
    view.setUint16(o + 26, s.repeatStart)
    view.setUint16(o + 28, Math.max(1, s.repeatWords))
  })

  const order = 20 + 31 * 30
  out[order] = m.positions.length
  out[order + 1] = 127 // the restart byte nothing reads
  m.positions.forEach((p, i) => {
    if (i < 128) out[order + 2 + i] = p
  })
  out.set([0x4d, 0x2e, 0x4b, 0x2e], order + 130) // "M.K."

  let at = headerBytes
  for (let p = 0; p < patterns; p++) {
    const channels = decodePattern(m, p)
    for (let r = 0; r < PT_ROWS; r++) {
      for (let c = 0; c < 4; c++) {
        const cell = ptCell(channels[c]?.[r] ?? { note: 0, instrument: 0, command: 0, info: 0 })
        const period = cell.note > 0 && cell.note <= 36 ? PT_PERIODS[cell.note]! : 0
        out[at] = (cell.instrument & 0xf0) | ((period >> 8) & 0x0f)
        out[at + 1] = period & 0xff
        out[at + 2] = ((cell.instrument & 0x0f) << 4) | (cell.command & 0xf)
        out[at + 3] = cell.info & 0xff
        at += 4
      }
    }
  }
  for (const s of m.samples) {
    if (s.aliasOf !== null || !s.pcm) continue
    out.set(new Uint8Array(s.pcm.buffer, s.pcm.byteOffset, s.pcm.length), at)
    at += s.pcm.length
  }
  return out
}
