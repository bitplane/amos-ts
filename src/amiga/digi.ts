/**
 * DigiBooster 1.x — the module format, off `DME_DigiBooster.library`.
 *
 * The format only. The replay is not here yet and the header says at the
 * bottom exactly what it will take, because the answer turned out to decide
 * the shape of the whole thing.
 *
 * ## Evidence
 *
 * `DME_DigiBooster.library`, 194,752 bytes loaded at $210000: hunk 0 the
 * veneer ($210000+1072), hunk 1 the replayer ($210430+10704) and hunk 2 a BSS
 * block of 182,976 bytes. That third hunk is the whole story, and the
 * "Contents" note below says why. The romtag at $210004 reads
 * "DME_DigiBooster.library 2.0 (24. October 97) DOOM Productions 1997".
 *
 * The veneer is NOT the one `DME_SoundFX1.3.library`, `DME_FC1.4.library` and
 * `DME_FC1.3.library` share. It has sixteen vectors rather than ten, no vu
 * bytes at all, and its state block at $21033a is three words: the end flag,
 * the master and the saved master. Song position and pattern position are
 * separate bytes at $210958 and $210959 that the tick maintains, where the
 * other three ask the replayer.
 *
 * ## The file
 *
 * `InitModule` at $2105fa, over a header the extension checks at offset zero
 * with `cmpi.l #$44494749` --- "DIGI".
 *
 *   $00  20 bytes  "DIGI Booster module" and a NUL
 *   $14  4 bytes   the tracker's own tag, "TAP!" in the module here
 *   $18  byte      the version, BCD: $10 is 1.0 and $13 is 1.3
 *   $19  byte      how many channels, and it is EIGHT in the module here
 *   $1a  byte      nonzero when the patterns are packed
 *   $1b  19 bytes  unread
 *   $2e  byte      the HIGHEST pattern number, so the count is one more
 *   $2f  byte      the song length --- `move.b $2f(a2),d3` is `=Db Song Length`
 *   $30  128 bytes the pattern order
 *   $b0  31 x long  sample lengths in BYTES
 *   $12c 31 x long  repeat starts in bytes
 *   $1a8 31 x long  repeat lengths in bytes
 *   $224 31 bytes   volumes, 0..64
 *   $243 31 bytes   finetunes
 *   $262 32 bytes   the song name
 *   $282 31 x 30    sample names
 *   $624 the patterns, and the samples end to end after the last of them
 *
 * Nothing in the file says where the samples start: $210764 takes the address
 * one past the last pattern and chains from there on the lengths at $b0.
 *
 * A VERSION BELOW 1.0 OR ABOVE 1.3 KEEPS ITS FINETUNES; 1.0 to 1.3 have theirs
 * zeroed. $210790 tests $18 against $10, $11, $12 and $13 and only those four
 * reach the loop at $2107b2 that clears all 31 bytes at $243. The extension
 * calls the format "DigiBooster V1.x" in its own error string, so the versions
 * it means are exactly the ones whose finetunes it throws away.
 *
 * ## The patterns
 *
 * Both layouts hold 64 rows of `channels` cells, and a cell is the ordinary
 * ProTracker four bytes: `sample_hi period_hi | period_lo | sample_lo effect |
 * param`. Row 0 of pattern 1 in the module here is `00 d6 2f 04`, which is
 * period 214 on sample 2 with effect F04.
 *
 * UNPACKED ($1a zero) is CHANNEL-MAJOR, which is the part that surprises: the
 * unroll at $210a1c reads a row's eight cells from `row*4` plus 0, $400, $100,
 * $500, $200, $600, $300 and $700. So channel c's block of 64 cells starts at
 * `c * $100` for the first four and `$400 + (c - 4) * $100` for the rest, and
 * a whole pattern is $800 bytes.
 *
 * PACKED ($1a nonzero) is a length word, then 64 mask bytes, then only the
 * cells that exist:
 *
 *   $210a30  addq.w #$2,a1        the length word, which counts the rest
 *   $210a32  lea (a1),a6          the 64 masks
 *   $210a34  lea $40(a1),a5       the cells
 *   $210ab0  moveq #$7,d7 / btst.l d7,(a1)
 *
 * `btst` walks d7 from 7 down, so CHANNEL 0 IS BIT 7 of the mask byte and
 * channel 7 is bit 0. The eighteen patterns in the module here come to 634,
 * 258, 258, 538 ... bytes, and every one of them is 2 + 64 + 4n exactly, which
 * is the arithmetic agreeing with the instructions.
 *
 * Reaching row N means counting the set bits of masks 0 to N-1, so $210a40
 * caches the last row it did at $21095d and its cell pointer at $210962 and
 * skips the walk when the next row is the one after it.
 *
 * ## What the replay will take, which is not what it looked like
 *
 * DigiBooster does not drive Paula with sample pointers. $2107c0 points all
 * four voices at BSS buffers ($21ce00, $226e00, $230e00, $212e00), sets AUDxLEN
 * to $a6 words and AUDxPER to $d6, and every voice block carries a SECOND
 * buffer at `$5a` that the row pass swaps in at `$56`. Period 214 is
 * 3,546,895/214 = 16,574 Hz, and 332 bytes at that rate is 20.03ms, one frame.
 *
 * So the four Paula voices are streaming DACs, the eight module channels are
 * summed into them in software at 16.6 kHz, and that ceiling is most of what
 * DigiBooster sounds like. `mixer.ts` renders Paula's four voices and has no
 * way to express it. Feeding eight voices straight into a widened `PaulaMixer`
 * would be a cleaner sound than the machine ever made, so the replay wants
 * DigiBooster's own mixer modelled rather than bypassed --- which is the same
 * thing octaplayer.library and octamixplayer.library want (#132), so it is
 * worth building once.
 *
 * The tempo is real too. $2105ba divides 1,775,101 by the word at $210974
 * (125 at reset), where SoundFX and both FutureComposers throw the module's
 * divisor away and run at a fixed 50Hz.
 */

/** `cmpi.l #$44494749,(a2)` in routine 104 --- the extension's only tag test */
export const DIGI_MAGIC = 'DIGI'
/** the full twenty bytes `InitModule` expects, NUL included */
export const DIGI_BANNER = 'DIGI Booster module\0'
/** the bank `Db Load` reserves ($4e02), tested as "Digi" and "Mod " ($50de) */
export const DIGI_ROWS = 64
/** 31, as every ProTracker descendant has */
export const DIGI_SAMPLES = 31
/** a cell is the ordinary ProTracker four bytes */
export const DIGI_CELL_BYTES = 4
/** `lea $624(a5),a1` at $21073a */
export const DIGI_PATTERNS_AT = 0x624
/** an unpacked pattern is $800 bytes whatever the channel count */
export const DIGI_UNPACKED_BYTES = 0x800
/** the four versions $210790 tests for, and so the ones whose finetunes go */
export const DIGI_1X_VERSIONS = [0x10, 0x11, 0x12, 0x13]

/** one of the 31 entries, chained off the end of the last pattern */
export interface DigiSample {
  /** the bytes, sliced out of the module */
  pcm: Int8Array
  /** the length in BYTES, which is how the file states it */
  length: number
  repeatStart: number
  repeatLength: number
  /** 0..64 */
  volume: number
  /** zeroed by `InitModule` on versions 1.0 to 1.3 */
  finetune: number
  name: string
}

/** one four-byte cell, unpacked */
export interface DigiCell {
  period: number
  sample: number
  effect: number
  param: number
}

export interface DigiSong {
  /** $18, BCD: $10 is 1.0 */
  version: number
  /** $19, and eight in the module here */
  channels: number
  packed: boolean
  /** $2e is the highest pattern number, so this is one more than it */
  patternCount: number
  /** $2f, which is what `=Db Song Length` answers */
  songLength: number
  /** the first `songLength` bytes of the 128 at $30 */
  order: number[]
  /** `[pattern][row][channel]`, both layouts flattened to the same shape */
  patterns: DigiCell[][][]
  samples: DigiSample[]
  name: string
}

const rd32 = (d: Uint8Array, a: number): number =>
  (((d[a] ?? 0) << 24) | ((d[a + 1] ?? 0) << 16) | ((d[a + 2] ?? 0) << 8) | (d[a + 3] ?? 0)) >>> 0
const rd16 = (d: Uint8Array, a: number): number => ((d[a] ?? 0) << 8) | (d[a + 1] ?? 0)

/** a NUL-terminated fixed field, with the author's bytes left as they are */
const str = (d: Uint8Array, at: number, n: number): string => {
  const end = Math.min(at + n, d.length)
  let s = ''
  for (let i = at; i < end; i++) {
    const c = d[i]!
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

const cell = (d: Uint8Array, at: number): DigiCell => {
  const b0 = d[at] ?? 0
  const b1 = d[at + 1] ?? 0
  const b2 = d[at + 2] ?? 0
  return {
    period: ((b0 & 0x0f) << 8) | b1,
    sample: (b0 & 0xf0) | (b2 >> 4),
    effect: b2 & 0x0f,
    param: d[at + 3] ?? 0,
  }
}

const emptyRow = (channels: number): DigiCell[] =>
  [...Array(channels)].map(() => ({ period: 0, sample: 0, effect: 0, param: 0 }))

/**
 * `InitModule` at $2105fa, over a buffer instead of over chip RAM.
 *
 * Returns null on anything that is not a DIGI module. The extension checks
 * only the four bytes at zero, so the twenty-byte banner is checked here as
 * well and a module that fails it is refused rather than mis-parsed.
 */
export function parseDigi(data: Uint8Array): DigiSong | null {
  if (data.length < DIGI_PATTERNS_AT) return null
  if (str(data, 0, 20) !== DIGI_BANNER.slice(0, 19)) return null

  const version = data[0x18] ?? 0
  const channels = data[0x19] ?? 0
  if (channels < 1 || channels > 8) return null
  const packed = (data[0x1a] ?? 0) !== 0
  const patternCount = (data[0x2e] ?? 0) + 1
  const songLength = data[0x2f] ?? 0
  const order = [...data.subarray(0x30, 0x30 + songLength)]

  const patterns: DigiCell[][][] = []
  let at = DIGI_PATTERNS_AT
  for (let p = 0; p < patternCount; p++) {
    const rows: DigiCell[][] = []
    if (!packed) {
      for (let r = 0; r < DIGI_ROWS; r++) {
        // $210a1c: channel-major in two halves of $400, not row-major
        rows.push([...Array(channels)].map((_, c) =>
          cell(data, at + (c < 4 ? c * 0x100 : 0x400 + (c - 4) * 0x100) + r * DIGI_CELL_BYTES)))
      }
      at += DIGI_UNPACKED_BYTES
    } else {
      const bytes = rd16(data, at)
      const masks = at + 2
      let ev = masks + DIGI_ROWS
      for (let r = 0; r < DIGI_ROWS; r++) {
        const m = data[masks + r] ?? 0
        const row = emptyRow(channels)
        for (let c = 0; c < channels; c++) {
          // `moveq #$7,d7 / btst.l d7,(a1)` counts DOWN, so channel 0 is bit 7
          if (!(m & (0x80 >> c))) continue
          row[c] = cell(data, ev)
          ev += DIGI_CELL_BYTES
        }
        rows.push(row)
      }
      at += bytes + 2
    }
    patterns.push(rows)
  }

  // $210764: the samples begin one past the last pattern and chain on length
  const samples: DigiSample[] = []
  // 1.0 to 1.3 have every finetune cleared at $2107b2
  const keepsFinetune = !DIGI_1X_VERSIONS.includes(version)
  for (let i = 0; i < DIGI_SAMPLES; i++) {
    const length = rd32(data, 0xb0 + i * 4)
    const from = Math.max(0, Math.min(at, data.length))
    const to = Math.max(from, Math.min(at + length, data.length))
    samples.push({
      pcm: new Int8Array(data.buffer, data.byteOffset + from, to - from),
      length,
      repeatStart: rd32(data, 0x12c + i * 4),
      repeatLength: rd32(data, 0x1a8 + i * 4),
      volume: data[0x224 + i] ?? 0,
      finetune: keepsFinetune ? (data[0x243 + i] ?? 0) : 0,
      name: str(data, 0x282 + i * 30, 30),
    })
    at += length
  }

  return { version, channels, packed, patternCount, songLength, order, patterns, samples, name: str(data, 0x262, 32) }
}
