/**
 * TFMX — the module format, off `DME_TFMX.library` and the extension around it.
 *
 * Chris Hülsbeck's format, and the one in this extension that is not a tracker
 * at all. A TFMX song is a program: sixteen tracks step through a table of
 * pattern numbers, patterns run note and control commands, and a note names a
 * MACRO rather than a sample. The macro is what shapes the sound, and it can
 * loop, wait, sweep a period, change the sample under a playing voice and
 * start another macro.
 *
 * ## Evidence
 *
 * `DME_TFMX.library`, 9,236 bytes at $210000 in one code hunk — the smallest
 * of the eleven and the earliest, its romtag reading "DME_TFMX.library 1.0
 * (08. April 97) DOOM Productions 1997".
 *
 * DOOM Productions did not write the replay. $21056c is a table of sixteen
 * `bra.w`s, which is how the TFMX replayers of the period were all entered,
 * and 564 contiguous bytes of the library are byte-identical to `TFMXPRO.OBJ`
 * in `Ripped TFMX-Player V1.7` on Aminet (`mus/play/TFMX.lha`). The jump
 * tables differ, so it is not the same build, but it is the same replayer.
 * That object is an independent copy of the same code rather than a source, so
 * it corroborates and does not raise the tier.
 *
 * ## Two files in one bank
 *
 * TFMX normally ships as a PAIR: `mdat.name` and `smpl.name`. TFMX.DOC says
 * so in the author's own words --- "You need BOTH files to play a song !" ---
 * and an AMOS bank holds one thing, so the extension takes a container:
 *
 *   $00  4 bytes  "TFHD"
 *   $04  long     where the mdat starts, from the top of the container
 *   $08  byte     the type, and only the low seven bits are tested ($48d8)
 *   $0a  long     how long the mdat is, which is also where the smpl starts
 *   $0e  long     how long the smpl is
 *
 * The type decides how hard the loader looks. Type 0 must have "TFMX" and
 * "SONG" at the head of its mdat, checked at $48fc by a trick worth reading:
 * `move.l $6(a0),d0 / move.b $5(a0),d0 / ror.l #$8,d0` builds "SONG" out of
 * bytes 5 to 8, skipping the hyphen at 4. Types 1 and 2 skip the test
 * altogether, and anything else is message 29.
 *
 * ## What the replayer is given
 *
 * $49fc hands the library three things and no more: `mdat`, `smpl`, and the
 * subsong. Everything below that comes out of the mdat itself.
 *
 *   $0000  "TFMX-SONG "
 *   $0010  six lines of forty characters, which nothing in this library reads
 *   $0100  32 words: where each subsong starts in the trackstep table
 *   $0140  32 words: where it ends
 *   $0180  32 words: its tempo
 *   $01d0  three longs: the trackstep, pattern and macro tables
 *   $0200  the data
 *
 * Those three longs are the newer layout. $211b20 tests the first for zero and
 * falls back to $800, $400 and $600 when it is absent, which is the layout
 * every pre-1990 rip has.
 *
 * ## The subsong count is loose
 *
 * $2101e8 walks up to 31 words from $100 and stops after the SECOND zero it
 * sees, wherever the two fall. It answers one less than the index of that
 * second zero, which is the right count for a table ending `..., 0, 0` and
 * wrong for anything else: `moveq #$fe,d0` starts at minus two and
 * `addq.l #$1,d0` runs before each test.
 *
 * A subsong that legitimately starts at trackstep 0 is therefore one of the
 * two zeroes it is counting, and every song after it is lost. The module in
 * `fixtures/` has exactly that --- a zero at index 2 with six live songs after
 * it --- and the walk answers SEVEN, which is neither the eight songs the
 * table holds nor the two the terminator would imply.
 */

/** `cmpi.l #$54464844,(a2)` at $48c4 */
export const TFHD_MAGIC = 'TFHD'
/** `cmpi.l #$54464d58,(a0)` at $4900, then "SONG" out of bytes 5 to 8 */
export const TFMX_BANNER = 'TFMX-SONG '
/** six lines of forty, $10 to $100. No routine here reads them; the editor wrote them */
export const TFMX_TEXT_AT = 0x10
export const TFMX_TEXT_LINES = 6
export const TFMX_TEXT_COLS = 40
/** the two longs `Tfmx Play` compares at $49da and $49e6 */
export const TFMX_BANK_NAME = 'TFMXMod '
/** `andi.l #$7f,d0` at $48d8: 0 is checked, 1 and 2 are taken on trust */
export const TFMX_TYPES = [0, 1, 2] as const
/** 32 subsongs, and `moveq #$1e,d2` at $2101e6 walks 31 of them */
export const TFMX_SUBSONGS = 32
export const TFMX_SONGSTART_AT = 0x100
export const TFMX_SONGEND_AT = 0x140
export const TFMX_TEMPO_AT = 0x180
/** the three longs at $211b20, and what $211b50 uses when the first is zero */
export const TFMX_TABLES_AT = 0x1d0
export const TFMX_DEFAULT_TRACKSTEP = 0x800
export const TFMX_DEFAULT_PATTERNS = 0x400
export const TFMX_DEFAULT_MACROS = 0x600
/** `addi.l #$200,d0` at $211b44 */
export const TFMX_DATA_AT = 0x200
/** a trackstep row is eight words, one per track */
export const TFMX_TRACKS = 8

export interface TfmxSong {
  /** the six lines at $10, trailing spaces kept, as the author left them */
  text: string[]
  /** where each subsong starts, ends, and how fast it runs */
  start: number[]
  end: number[]
  tempo: number[]
  /** how many the replayer's own walk finds, which is not always how many there are */
  subsongs: number
  /** absolute offsets into `mdat` */
  tracksteps: number
  patterns: number
  macros: number
  /** true when the three came out of $1d0 rather than out of the fallbacks */
  explicit: boolean
  /** the music data and the sample data, sliced out of the container */
  mdat: Uint8Array
  smpl: Uint8Array
  /** `$8` of the container, whole, before the mask */
  type: number
}

const rd16 = (d: Uint8Array, a: number): number => ((d[a] ?? 0) << 8) | (d[a + 1] ?? 0)
const rd32 = (d: Uint8Array, a: number): number =>
  (((d[a] ?? 0) << 24) | ((d[a + 1] ?? 0) << 16) | ((d[a + 2] ?? 0) << 8) | (d[a + 3] ?? 0)) >>> 0

const str = (d: Uint8Array, at: number, n: number): string => {
  let s = ''
  for (let i = at; i < Math.min(at + n, d.length); i++) {
    const c = d[i]!
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

/** `Tfmx Load`'s test at $48fc, which skips the hyphen rather than matching it */
export function hasTfmxBanner(mdat: Uint8Array): boolean {
  if (str(mdat, 0, 4) !== 'TFMX') return false
  // move.l $6(a0),d0 / move.b $5(a0),d0 / ror.l #$8,d0
  let d0 = rd32(mdat, 6)
  d0 = ((d0 & 0xffffff00) | (mdat[5] ?? 0)) >>> 0
  d0 = ((d0 >>> 8) | (d0 << 24)) >>> 0
  return d0 === 0x534f4e47
}

/**
 * `Tfmx Play`'s reads at $49fc through $4a12, over a bank rather than chip RAM.
 *
 * Returns null for anything the loader would have refused: a missing "TFHD", a
 * type outside 0..2, or a type 0 whose mdat does not carry the banner.
 */
export function parseTfmx(data: Uint8Array): TfmxSong | null {
  if (data.length < 0x12) return null
  if (str(data, 0, 4) !== TFHD_MAGIC) return null

  const type = data[8] ?? 0
  const kind = type & 0x7f
  if (kind !== 0 && kind !== 1 && kind !== 2) return null

  const mdatAt = rd32(data, 4)
  const mdatLen = rd32(data, 0xa)
  const smplLen = rd32(data, 0xe)
  if (mdatAt + mdatLen > data.length) return null

  const mdat = data.subarray(mdatAt, mdatAt + mdatLen)
  const smpl = data.subarray(mdatAt + mdatLen, Math.min(data.length, mdatAt + mdatLen + smplLen))
  if (kind === 0 && !hasTfmxBanner(mdat)) return null
  if (mdat.length < TFMX_DATA_AT) return null

  const words = (at: number): number[] =>
    [...Array(TFMX_SUBSONGS)].map((_, i) => rd16(mdat, at + i * 2))

  const explicit = rd32(mdat, TFMX_TABLES_AT) !== 0
  const tracksteps = explicit ? rd32(mdat, TFMX_TABLES_AT) : TFMX_DEFAULT_TRACKSTEP
  const patterns = explicit ? rd32(mdat, TFMX_TABLES_AT + 4) : TFMX_DEFAULT_PATTERNS
  const macros = explicit ? rd32(mdat, TFMX_TABLES_AT + 8) : TFMX_DEFAULT_MACROS

  return {
    text: [...Array(TFMX_TEXT_LINES)].map((_, i) =>
      String.fromCharCode(...mdat.subarray(TFMX_TEXT_AT + i * TFMX_TEXT_COLS, TFMX_TEXT_AT + (i + 1) * TFMX_TEXT_COLS)),
    ),
    start: words(TFMX_SONGSTART_AT),
    end: words(TFMX_SONGEND_AT),
    tempo: words(TFMX_TEMPO_AT),
    subsongs: countSubsongs(mdat),
    tracksteps,
    patterns,
    macros,
    explicit,
    mdat,
    smpl,
    type,
  }
}

/**
 * The walk at $2101e8, reproduced including what it gets wrong.
 *
 * `moveq #$fe,d0` starts the count at minus two and `addq.l #$1,d0` runs
 * before each test, so the answer is one LESS than the index of the second
 * zero. `dbeq` ends the loop when that zero drops the counter to zero or when
 * 31 words have gone by, whichever comes first, and 31 words with no second
 * zero answers 29.
 */
export function countSubsongs(mdat: Uint8Array): number {
  let d0 = -2
  let left = 2
  for (let i = 0; i <= 0x1e; i++) {
    d0++
    if (rd16(mdat, TFMX_SONGSTART_AT + i * 2) === 0) {
      left--
      if (left === 0) break
    }
  }
  return d0
}
