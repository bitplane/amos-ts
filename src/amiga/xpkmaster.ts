/**
 * `xpkmaster.library` 2.2 (Aug 7 1992) — the XPK stream format.
 *
 * XPK is a framework, not a compressor. `xpkmaster.library` owns a container
 * and delegates the actual squeezing to a per-method sub-library found at
 * `LIBS:Compressors/xpkNUKE.library` and friends, named by a four-character
 * method id carried in the stream header. The master is 13KB and none of it
 * compresses anything.
 *
 * Ported from the binary on the AMOS PD Library CD 1994 (identical copy in
 * Library1.3, Library2.0, Library3.0, WB-1.3, WB-2.1 and WB-3.0 — six copies,
 * one version). Addresses below are offsets into its 11,280-byte code hunk
 * loaded at base 0.
 *
 * ## What is here, and what is honestly not
 *
 * The master recognises THREE stream kinds and its own probe (`$450`) numbers
 * them in `$92` of its io block:
 *
 *   1  `'----'`  not packed at all — read the bytes through
 *   2  `'XPKF'`  a real XPK stream, chunked, method in the header
 *   3  `'PP20'`  PowerPacker, decoded by calling `powerpacker.library`
 *
 * Kinds 1 and 3 are complete here and both are artefact-verified: kind 1 is
 * any file, and kind 3 runs on `./powerpacker.ts`, whose decoder is already
 * checked against genuine PowerPacker output. **Forty PP20 files exist in the
 * corpus. Zero XPKF files do.** The count was re-checked on 2026-08-13 rather
 * than assumed: twenty-one corpus files contain those four bytes and not one
 * is a stream. The master itself in six copies, `C/STP` in three, Explode's
 * library, source and Dok, the checksum index, and seven AMOS programs and
 * banks carrying the string as data — `spinvaders.AMOS` opens "AMOS Basic
 * V1.00", `mus1.abk` opens "AmBs", `files.mod` opens `$000003f3`.
 *
 * So the kind-2 container is read off the binary in both directions and is
 * mutually consistent — the writer at `$1260` lays down exactly what the
 * reader at `$e04` takes apart. This file used to say that was as far as the
 * evidence went, because a round-trip only proves a file agrees with itself.
 *
 * It goes further now. Teemu Suutari's `ancient` implements the XPK container
 * and 72 methods from its own reading of the format, NONE and RLEN and NUKE
 * among them, and `ancient verify` decodes every stream `xpkPack` writes back
 * to the bytes that went in, over seven bodies and all three methods, across
 * the 127 caps, several chunks, incompressible input and a 100,000-byte run.
 * That is an independent reader agreeing with this one, which is the check no
 * artefact was available for. See the test file; it skips when `ancient` is
 * absent.
 *
 * The direction of that check is worth being clear about. `ancient` only
 * DECODES, so it verifies this file's encoders. The decoders are checked by
 * round-tripping against an encoder `ancient` has already blessed, which is
 * weaker, and it is why NUKE was written encoder first.
 *
 * One disagreement survives and is recorded rather than settled: a stream of
 * NOTHING. `xpkPack` of an empty input is 44 bytes, a header and an END chunk,
 * well formed by every test here — `xsh_CLen` is $24, the header XORs to zero,
 * and `xpkExamine` reads it back as ULen 0. `ancient` will not identify it
 * under either method. The master's probe at `$450` tests the magic, the
 * checksum and the flags, and has no ULen test in it that this port has found.
 *
 * ## The compressors that are here
 *
 * `XPK_PACKERS` is the registry standing in for `LIBS:Compressors/`, and all
 * three entries in it are ported whole from the binary rather than stubbed.
 *
 * `NONE`, from `xpkNONE.library` 1.0, 592 bytes of code of which the two the
 * master calls are 24 instructions:
 *
 *   LVO -36 XpkPackChunk    `moveq #$ef,d0; rts`  — always XPKERR_EXPANSION
 *   LVO -54 XpkUnpackChunk  `CopyMem(In, Out, InLen)`
 *
 * Refusing to pack is not a failure. When a sub-library answers EXPANSION the
 * master clears the error, sets the chunk type to RAW and stores the plain
 * bytes (`$11de`), so NONE's whole job is to say no. Its unpack is then never
 * reached for a stream it wrote — every chunk is type 0 — which is why its
 * being a bare copy costs nothing.
 *
 * `RLEN`, from `xpkRLEN.library` 1.0, 952 bytes: a signed control byte and its
 * payload, and the first entry here that actually compresses. See `XPK_RLEN`.
 *
 * `NUKE`, from `xpkNUKE.library` 1.0, 2,804 bytes: an LZ77 over four
 * interleaved bit streams whose literal bytes are stored at the back of the
 * chunk in reverse. See `XPK_NUKE`, which is the biggest of the three by a
 * long way and the one worth reading first.
 *
 * Every other method resolves through `OpenLibrary("compressors/xpk%.4s.library")`
 * at `$c9a`, and when that fails the master sets XPKERR_MISSINGLIB and gives
 * up. That is what this port does for HUFF, BLZW, FEAL, IDEA, IMPL and CBR0,
 * and it is not a shortcut. It is what a real Amiga does with an empty
 * `LIBS:Compressors/`, which is the machine EasyLife's own guide describes:
 * "the XPK libraries are not included in this distribution, you must obtain
 * the XPK compression archive separately".
 *
 * But it is a CHOICE and not a limit, which was stated wrongly here until
 * 2026-08-12: nine of those sub-libraries are held, 1,040 to 4,052 bytes
 * apiece, in `COMPRESSORS/` on all three Library volumes of the AMOS PD
 * Library CD 1994 — BLZW, CBR0, FEAL, HUFF, IDEA, IMPL, NONE, NUKE and RLEN.
 * Porting them is work nobody has done, not evidence nobody has.
 *
 * ## The errors are plain Errors
 *
 * Same rule as `./powerpacker.ts`: a codec does not get to name AMOS error
 * numbers. `XpkError` carries the library's own code (-1..-32, the table at
 * `$2c52`) and the caller decides what that means. EasyLife's `Elxpk Error`
 * hands the raw number straight back to the program, so the number IS the
 * interface there.
 */
import { pp20Crunch, pp20Decrunch } from './powerpacker'

/**
 * Bytes of slack an unpack output buffer needs beyond the unpacked length.
 *
 * `$332`: the master asks for `256 + CLen`. EasyLife's guide names the same
 * figure and its origin — "the value 256 is from the xpk.i file's XPK_MARGIN
 * equate" — and both `Elxpk Bload` and `Elxpk Load` add it to what they
 * allocate.
 */
export const XPK_MARGIN = 256

/** `move.l #$8000,d0` at `$a8c` — the chunk size before a packer narrows it. */
export const XPK_DEFAULT_CHUNK = 32768

/**
 * Above this the length fields go long and the chunk header grows to twelve
 * bytes (`$ae4`: `cmpi.l #$fde8,d0 / bls`). 65000 is the largest chunk whose
 * lengths still fit the word form, with room for the packer's own expansion.
 */
export const XPK_LONGHDR_ABOVE = 65000

/** `xsh_Pack` — 'XPKF', compared at `$512`. */
export const XPK_MAGIC = 0x58504b46
/** compared at `$720`, once XPKF has been ruled out. */
export const PP20_MAGIC = 0x50503230
/** `move.l #'----',$18(a0)` at `$8aa` — the type the master gives raw input. */
export const XPK_RAW_TYPE = '----'

/** `xsh_Flags` bit 0 — chunk lengths are longwords, header is 12 bytes. */
export const XPKSTREAMF_LONGHDRS = 1
/** bit 1 — the stream is encrypted and a password is required to read it. */
export const XPKSTREAMF_PASSWORD = 2
/** bit 2 — a word-counted extension block follows the 36-byte header. */
export const XPKSTREAMF_EXTHEADER = 4

/** `xch_Type` values, read at `$e64`/`$ec6` and written at `$1214`. */
export const XPKCHUNK_RAW = 0
export const XPKCHUNK_PACKED = 1
export const XPKCHUNK_END = 15

export const XPKERR_NOFUNC = -1
export const XPKERR_NOFILES = -2
export const XPKERR_IOERRIN = -3
export const XPKERR_IOERROUT = -4
export const XPKERR_CHECKSUM = -5
export const XPKERR_VERSION = -6
export const XPKERR_NOMEM = -7
export const XPKERR_NOTREENTRANT = -8
export const XPKERR_WRONGFORM = -9
export const XPKERR_SMALLBUF = -10
export const XPKERR_BIGBUF = -11
export const XPKERR_WRONGMODE = -12
export const XPKERR_PASSWORD = -13
export const XPKERR_CORRUPTPKD = -14
export const XPKERR_MISSINGLIB = -15
export const XPKERR_TAGERR = -16
export const XPKERR_EXPANSION = -17
export const XPKERR_NOMETHOD = -18
export const XPKERR_ABORTED = -19
export const XPKERR_TRUNCATED = -20
export const XPKERR_CPU = -21
export const XPKERR_PACKED = -22
export const XPKERR_NOTPACKED = -23
export const XPKERR_EXISTS = -24
export const XPKERR_MASTERTOOOLD = -25
export const XPKERR_SUBTOOOLD = -26
export const XPKERR_NOCRYPT = -27
export const XPKERR_NOINFO = -28
export const XPKERR_LOSSY = -29
export const XPKERR_NEEDHW = -30
export const XPKERR_HWFAILED = -31
export const XPKERR_BADPASSWORD = -32

/**
 * The library's own messages, in code order, read out of its string table at
 * `$2c52`.
 *
 * These are the master's wording, not the equate names and not EasyLife's
 * paraphrase in its guide. `Elxpk Error` returns the number and leaves the
 * text to the programmer, so nothing in the port depends on these — they are
 * here so an `XpkError` says something when it reaches a developer.
 */
export const XPK_MESSAGES: readonly string[] = [
  'Feature not implemented in selected library',
  'Function may not be used with files',
  'Error reading input',
  'Error writing output',
  'Check sum failure',
  'Library too old for this file',
  'Out of memory',
  'Library already in use',
  "Can't find decompressor for this format",
  'Output buffer too small',
  'Input buffer too large',
  'This packing mode not supported',
  'Password required',
  'Input file is corrupt',
  "Can't find required XPK library",
  'Bad internal parameters',
  'Data cannot be compressed',
  'Requested compression method not found',
  'Operation aborted by user',
  'Input file truncated',
  'MC68020 or better required',
  'Data already compressed',
  'Data not compressed',
  'Output file already exists',
  'Master library too old',
  'Sub library too old',
  'This library cannot encrypt',
  "Can't get info",
  'This compression method is lossy',
  'Compression hardware required',
  'Compression hardware failed',
  'Password incorrect',
]

/** The message for an error code, or a bare number for one XPK never defined. */
export function xpkErrorText(code: number): string {
  return XPK_MESSAGES[-code - 1] ?? `XPK error ${String(code)}`
}

/**
 * An XPK failure, carrying the library's own negative code.
 *
 * Deliberately not an `AmosError`: see the header, and `./powerpacker.ts` for
 * the same decision written out at length.
 */
export class XpkError extends Error {
  constructor(readonly code: number) {
    super(xpkErrorText(code))
    this.name = 'XpkError'
  }
}

/** `$92` of the io block: which of the three shapes the input turned out to be. */
export type XpkKind = 'raw' | 'xpk' | 'pp20'

/** What `XpkExamineTags` fills in — the fields EasyLife's `Elxpk Lof` reads. */
export interface XpkFib {
  kind: XpkKind
  /** the four-character method id, `'PP20'`, or `'----'` for unpacked input */
  type: string
  /** unpacked length: `xsh_ULen`, the PP20 trailer, or the input length */
  uLen: number
  /** packed length: `xsh_CLen`, or the input length for the other two kinds */
  cLen: number
  /** `xsh_Flags`; zero for the kinds that have no header to carry it */
  flags: number
  /** `xsh_SubVrs` — the sub-library version this stream needs */
  subVrs: number
  /** `xsh_MasVrs` — the master version this stream needs */
  masVrs: number
}

/**
 * One entry in `LIBS:Compressors/`.
 *
 * The two methods mirror the sub-library LVOs the master actually calls:
 * `jsr -$24(a6)` at `$11c0` is XpkPackChunk and `jsr -$36(a6)` at `$f68` is
 * XpkUnpackChunk. Returning `null` from `packChunk` is the EXPANSION answer,
 * which tells the master to store the chunk raw.
 */
export interface XpkPacker {
  /** the four-character id that goes in `xsh_Type` */
  readonly name: string
  /** XpkInfo+$0c, `xpi_LongName`, what the packer calls itself */
  readonly longName: string
  /** XpkInfo+$1c, `xpi_MaxChunk`; zero or absent means the packer sets no ceiling */
  readonly maxChunk?: number
  /** XpkInfo+$20, `xpi_MinChunk`, a floor the master raises the chunk size to */
  readonly minChunk?: number
  /** XpkInfo+$24, `xpi_DefChunk`; zero or absent leaves the master's 32768 */
  readonly defaultChunk?: number
  /** `null` means XPKERR_EXPANSION — store this chunk raw instead */
  packChunk(data: Uint8Array, mode: number, password?: string): Uint8Array | null
  unpackChunk(data: Uint8Array, uLen: number, password?: string): Uint8Array
}

/**
 * The chunk size the master settles on, `$a7a..$ae4`, in that order.
 *
 * Three XpkInfo longwords and one substitution, and the order is the whole of
 * it. The floor is applied BEFORE the ceiling, so a packer that declared a
 * minimum above its own maximum would end up at the maximum.
 *
 *     $a7e  chunk = xpi_DefChunk        $a8c  and 32768 when that is zero
 *     $a9e  if chunk < xpi_MinChunk, chunk = xpi_MinChunk
 *     $ac2  if xpi_MaxChunk and chunk > it, chunk = xpi_MaxChunk
 *
 * All three packers here declare a default, which is why this is not the
 * `min(32768, maxChunk)` this file used to compute: NONE asks for 32000, not
 * the master's 32768, so even the do-nothing packer moves the chunk boundary.
 */
const xpkChunkSize = (packer: XpkPacker): number => {
  let n = packer.defaultChunk ?? 0
  if (n === 0) n = XPK_DEFAULT_CHUNK
  const min = packer.minChunk ?? 0
  if (n < min) n = min
  const max = packer.maxChunk ?? 0
  if (max !== 0 && n > max) n = max
  return n
}

/**
 * `xpkNONE.library` 1.0, whole.
 *
 * `XpkPackerInfo` (`$17c`) is `lea $3a(a6),a4 / lea $96(a4),a0`, so a static
 * XpkInfo sits at `data+$96`. It calls itself "NoPacker 1.0" and "A dummy library
 * that does no compression". The two entries the master calls are the entire
 * algorithm.
 */
const XPK_NONE: XpkPacker = {
  name: 'NONE',
  longName: 'NoPacker 1.0',
  maxChunk: 32000,
  minChunk: 20,
  defaultChunk: 32000,
  // $1be: moveq #$ef,d0 / rts. XPKERR_EXPANSION, unconditionally.
  packChunk: () => null,
  // $1d0: CopyMem((a2), $8(a2), $4(a2)) then $10(a2) = $4(a2).
  unpackChunk: (data) => data.slice(),
}

/**
 * The output buffer the master hands a sub-library for one chunk, at `$1114`:
 *
 *     move.l d7,d0 / moveq #$20,d1 / jsr divide     ULen / 32
 *     move.l d7,d1 / add.l d0,d1                    ULen + ULen/32
 *     andi.w #$fffc,d1                              rounded down to four
 *     moveq #$40,d0 / lsl.l #$2,d0 / add.l d0,d1    plus 256
 *
 * A sub-library that would overrun it answers XPKERR_EXPANSION, so the size
 * is part of every packer's behaviour and not the master's private business.
 * Note the `andi.w`: the mask is a WORD operation and leaves the high half
 * alone, which is only harmless because a chunk is never 64K or more.
 */
const xpkPackBufLen = (uLen: number): number => ((uLen + ((uLen / 32) | 0)) & ~3) + 256

/**
 * `xpkRLEN.library` 1.0, whole. Its own XpkInfo calls it "Run Length 1.0" and
 * "Fast and simple compression usable for simple data".
 *
 * One control byte, read signed, then its payload:
 *
 *     0        end of stream
 *     1..127   that many literal bytes follow
 *     -1..-127 one byte follows, repeated that many times
 *
 * The unpacker at `$2f8` is nothing more than that loop, and it is the half
 * with no bounds check anywhere: no output limit, no input limit, and it
 * stops only on a zero byte. It also never writes `$10(a2)`, where NONE does
 * — the master already knows the length from the chunk header, so RLEN does
 * not bother telling it.
 *
 * Reading the packer at `$1be` is what pins the format down, because the
 * three-byte lookahead is the whole of its decision:
 *
 *     move.b $1(a0),d0 / move.b (a0),d1 / cmp.b d0,d1 / bne
 *     cmp.b  $2(a0),d0 / bne              three the same, so a run
 *
 * A literal is flushed when a run starts, when it reaches 127, or when the
 * input runs out; a run counts from three and stops at 127 or at the end of
 * the input. Worst case is one length byte per 127 literals, so a 32000-byte
 * chunk of incompressible data grows by 253 and the guard at `$21a` — output
 * plus the pending literal plus four against the end of the buffer — can
 * never fire against a buffer `xpkPackBufLen` sized. It is reproduced anyway,
 * because a caller may hand this packer a buffer the master would not.
 *
 * DEVIATION: the lookahead reads `a0[1]` and `a0[2]` with no bounds check, so
 * on the last two bytes of a chunk it reads past the input. When the bytes
 * that happen to follow match, the library emits a run of three and steps the
 * cursor three past the end. Here the lookahead is false past the input, which
 * makes those bytes a literal. Nothing else can differ: at the exact end both
 * paths flush and terminate, so only the final two positions are affected.
 */
const XPK_RLEN: XpkPacker = {
  name: 'RLEN',
  longName: 'Run Length 1.0',
  maxChunk: 32000,
  defaultChunk: 32000,
  packChunk(data) {
    const outMax = xpkPackBufLen(data.length)
    const out = new Uint8Array(outMax)
    let o = 0
    let cursor = 0
    let litStart = 0
    for (;;) {
      const run =
        cursor + 2 < data.length && data[cursor] === data[cursor + 1] && data[cursor + 1] === data[cursor + 2]
      const litLen = cursor - litStart
      // $21a: out + pending + 4 against the buffer end, before anything is written
      if (o + litLen + 4 > outMax) return null
      if (run || litLen === 127 || cursor === data.length) {
        if (litLen > 0) {
          out[o++] = litLen
          out.set(data.subarray(litStart, cursor), o)
          o += litLen
        }
        // $274: the terminator goes down only when the cursor is at the end
        if (cursor === data.length) {
          out[o++] = 0
          break
        }
        litStart = cursor
      }
      if (!run) {
        cursor++
        continue
      }
      // $294: three already, then one more for each byte that repeats the last
      let n = 3
      while (cursor + n < data.length && data[cursor + n] === data[cursor + n - 1] && n < 127) n++
      out[o++] = -n & 0xff
      out[o++] = data[cursor]!
      cursor += n
      litStart = cursor
    }
    return out.subarray(0, o)
  },
  unpackChunk(data, uLen) {
    const out = new Uint8Array(uLen)
    let p = 0
    let o = 0
    for (;;) {
      // `ext.w d6 / ext.l d6` at $316 -- the control byte is signed
      const n = ((data[p++] ?? 0) << 24) >> 24
      if (n === 0) break
      if (n > 0) {
        for (let i = 0; i < n && o < uLen; i++) out[o++] = data[p++] ?? 0
      } else {
        const b = data[p++] ?? 0
        for (let i = 0; i < -n && o < uLen; i++) out[o++] = b
      }
      // DEVIATION: the machine's loop has no output limit and no input limit
      // and would run off both. A stream that decodes to more than the chunk
      // header promised is truncated here instead.
      if (o >= uLen || p > data.length) break
    }
    return out
  },
}

/**
 * NUKE's three decode tables, `$3d4`, `$3f4` and `$414` in its 2,804-byte code
 * hunk. One nibble indexes all three, and it names a distance bucket AND a
 * match length at the same time: the third table is a jump offset into the
 * unrolled copy chain at `$9fc`, and the only three values in it are $20 (two
 * bytes, indices 0-3), $1e (three bytes, 4-9) and $0 (four or more, 10-15).
 * That is why the bases restart three times.
 *
 * The encoder reads the same tables. `$374` holds `1 << NUKE_BITS[i]` and is
 * not repeated here. Every entry was checked, and `NUKE_BASE[i+1]` is
 * `NUKE_BASE[i] + (1 << NUKE_BITS[i])` inside each of the three groups.
 */
export const NUKE_BITS = [4, 6, 8, 9, 4, 7, 9, 11, 13, 14, 5, 7, 9, 11, 13, 14]
export const NUKE_BASE = [
  0, 0x10, 0x50, 0x150, 0, 0x10, 0x90, 0x290, 0xa90, 0x2a90, 0, 0x20, 0xa0, 0x2a0, 0xaa0, 0x2aa0,
]

/** `$36c`, indexed by `min(length - 1, 3)`: which of the three groups to search */
export const NUKE_GROUP = [0, 0, 4, 10]

/**
 * `$8a6: move.w $412(pc),$2a(a4)` then `subq.w #1`. The encoder reads its own
 * window size out of `NUKE_BASE[15]`, so it never emits a distance that would
 * need bucket 15. Nothing in the format stops a distance of 27,295; this
 * encoder just declines to look further back than 10,910.
 */
export const NUKE_WINDOW = NUKE_BASE[15]! - 1

/**
 * `xpkNUKE.library` 1.0, an LZ77 whose literals run backwards.
 *
 * XpkInfo (`data+$a6`) calls it "Nuke 1.0" and "A relatively efficient packer
 * that unpacks very quickly", and the second half of that is a design, not a
 * boast. A packed chunk has the codes at the front reading forwards and the
 * literal BYTES at the back reading backwards, and the decoder's inner loop is
 * `move.b -(a4),(a0)+` against `move.b (a1)+,(a0)+`, with no shift, no mask
 * and no table lookup on the common path. The two cursors meet in the middle.
 *
 * ## Four streams, one input pointer
 *
 * There is no single bit stream. `a5` walks forward pulling 16-bit words and
 * 32-bit longwords on demand for four independent readers:
 *
 *   d2  one bit at a time   literal-or-match, then one-literal-or-more
 *   d3  two bits at a time  literal counts, and match lengths 4 to 6
 *   d4  four bits (nibbles) the distance bucket, and lengths past 6
 *   d6  a variable field    the distance within its bucket, 4 to 14 bits
 *
 * The order the words appear in the file is the order the four readers run
 * dry, which is why the encoder cannot write them as it goes. It RESERVES the
 * slot at the moment the decoder would load it and fills it sixteen bits
 * later. `$40/$44/$48/$4c` in its state block are those four pending
 * addresses, and `$862` starts all four pointing at four scratch bytes inside
 * the block so each stream's first flush is thrown away.
 *
 * d3 is read two bits at a time with only ONE sentinel test per pair (`$a04`
 * checks, `$a0e` does not). That holds because 16 is even and nothing ever
 * takes an odd number of bits from it.
 *
 * ## Token shapes
 *
 * A literal run is ALWAYS followed by a match. The decoder falls straight from
 * `$a34`/`$a62` into the distance decoder without reading another flag bit,
 * and it only tests for the end of the output there. So a NUKE chunk must end
 * on a literal run, which `$8ec` guarantees by forcing the last byte or two
 * into one.
 *
 * ## Both halves are here
 *
 * The encoder is a transcription of `$52e`, not a rewrite: same 2-byte hash
 * over 65,536 keys, same chain walk with the same one-byte lookahead reject at
 * `$614`, same `d3 < $140` rule for keeping a two-byte match, same rolling
 * chain-clear. The point of reproducing it exactly is that `ancient` can then
 * decode what it writes, and that check is worth more than a smaller encoder.
 *
 * DEVIATION: `$53e` reads the key at `d5` and `d5-1` before the loop has
 * tested anything, so a one-byte chunk reads one byte past its input and the
 * closing literal run at `$8ec` reads two more. Here those reads are zero. It
 * cannot show: any input short enough to trigger it packs to at least three
 * bytes and `$2f4` rejects that as EXPANSION.
 */
const XPK_NUKE: XpkPacker = {
  name: 'NUKE',
  longName: 'Nuke 1.0',
  maxChunk: 30000,
  minChunk: 10,
  defaultChunk: 30000,
  packChunk: (data) => nukePack(data),
  unpackChunk: (data, uLen) => {
    const out = new Uint8Array(uLen)
    nukeUnpack(data, out)
    return out
  },
}

/**
 * `$992`, and the four readers it sets up.
 *
 * Register names in the comments are the library's. `a0` is the output cursor,
 * `a2` the output end, `a5` the forward code cursor and `a4` the literal
 * cursor walking down from the end of the input.
 */
const nukeUnpack = (inp: Uint8Array, out: Uint8Array): number => {
  let ip = 0
  let lp = inp.length
  let op = 0
  const end = out.length

  const word = (): number => {
    const v = (at(inp, ip) << 8) | at(inp, ip + 1)
    ip += 2
    return v
  }

  // d2 and d3. The library holds a sentinel bit ($8000 at $99a) where this
  // holds a count; refilling when the sentinel reaches the top is the same
  // event as refilling when the count hits zero.
  let f = 0
  let fn = 0
  let c = 0
  let cn = 0
  const flagBit = (): number => {
    if (fn === 0) {
      f = word()
      fn = 16
    }
    fn--
    return (f >>> fn) & 1
  }
  const code2 = (): number => {
    if (cn === 0) {
      c = word()
      cn = 16
    }
    cn -= 2
    return (c >>> cn) & 3
  }

  // d4 with d5 as its counter. $9c4 loads a longword and $9cc rotates it right
  // four bits at a time, so the LOW nibble of a big-endian longword comes out
  // first and the eighth nibble is the one that was in the top byte.
  let nb = 0
  let nn = 0
  const nibble = (): number => {
    if (nn === 0) {
      nb = ((at(inp, ip) << 24) | (at(inp, ip + 1) << 16) | (at(inp, ip + 2) << 8) | at(inp, ip + 3)) >>> 0
      ip += 4
      nn = 8
    }
    const v = nb & 0xf
    nb = nb >>> 4
    nn--
    return v
  }

  // d6 and d7. $9d2 shifts the whole longword left and $9e6 swaps it, so the
  // pending bits sit in the low word LEFT-aligned with d7 counting them.
  let xb = 0
  let xn = 0
  const extra = (n: number): number => {
    if (n <= xn) {
      const v = (xb >>> (16 - n)) & ((1 << n) - 1)
      xb = (xb << n) & 0xffff
      xn -= n
      return v
    }
    // $9d8: the shortfall comes off the top of one fresh word, and the rest of
    // that word becomes the new buffer
    const need = n - xn
    const held = xn === 0 ? 0 : xb >>> (16 - xn)
    const w = word()
    xb = (w << need) & 0xffff
    xn = 16 - need
    return ((held << need) | (w >>> (16 - need))) >>> 0
  }

  for (;;) {
    // $a20: set means a match, clear means a literal run
    if (flagBit() === 0) {
      let n: number
      // $a2a: the second bit picks one literal, the common case, over a count
      if (flagBit() === 1) n = 1
      else {
        n = 0
        for (;;) {
          // $a42: 3 -> two, 2 -> three, 1 -> four, 0 -> three and read again
          const k = code2()
          if (k !== 0) {
            n += 5 - k
            break
          }
          n += 3
        }
      }
      for (let i = 0; i < n && op < end; i++) out[op++] = at(inp, --lp)
      // $a36 and $a62: the only end-of-output test in the decoder
      if (op >= end) break
    }

    // $9be: nibble, then the distance within its bucket
    const g = nibble()
    let src = op - (extra(NUKE_BITS[g]!) + NUKE_BASE[g]!)
    let len: number
    if (g < 4) len = 2
    else if (g < 10) len = 3
    else {
      // $a02: three bytes are already down, and a 2-bit code adds one to three
      const k = code2()
      if (k !== 0) len = 7 - k
      else {
        // $a8e: fifteen per nibble, and a nibble of zero means keep going
        len = 6
        for (;;) {
          const m = nibble()
          if (m !== 0) {
            len += 16 - m
            break
          }
          len += 15
        }
      }
    }
    // DEVIATION: the copy chain has no output test in it and the library would
    // run past the buffer on a corrupt stream. Truncated here, as in RLEN.
    for (let i = 0; i < len && op < end; i++) out[op++] = src < 0 ? 0 : out[src++]!
    if (ip > inp.length) break
  }
  return op
}

/**
 * `$52e`, the packer, with `$434` and `$862` and `$8ec` and `$950` folded in.
 *
 * Positions here are the library's `d5`, which is ONE-based: the key at `d5`
 * is the byte pair `(data[d5-1], data[d5])` and the literal at `d5` is
 * `data[d5-1]`. `d5` starts at 1 (`$8d6`), so byte 0 is only ever reachable as
 * the first literal of the first run.
 *
 * `d2` in the library is the match length LESS ONE, and it is kept that way
 * below because every table lookup and every comparison in `$68a..$806` is
 * written against that value.
 */
const nukePack = (data: Uint8Array): Uint8Array | null => {
  const inLen = data.length
  const outLen = xpkPackBufLen(inLen)
  const out = new Uint8Array(outLen)

  // $244: AllocMem($20000) and AllocMem($10000), both cleared at $1f4. The
  // second is 32,768 word entries indexed by input position, which is the
  // ceiling the declared 30,000-byte chunk sits under.
  const hash = new Uint16Array(0x1_0000)
  const next = new Uint16Array(0x8000)

  let cursor = 0 // $10(a4), where the next reserved slot comes from
  const litTop = outLen - 4 // $22(a4)
  let litCur = litTop // $14(a4), running down
  const last = inLen - 1 // $24(a4)
  let clearCur = 0 // $1c(a4)
  let pos = 1 // d5
  let litCount = -1 // $28(a4), starting $ffff for "none pending"
  let litStart = 0 // $26(a4)

  // The four deferred slots. -1 stands for the scratch longword at $50(a4).
  const SCRATCH = -1
  let s1 = 0
  let s1n = 0
  let s1at = SCRATCH
  let s2 = 0
  let s2n = 0
  let s2at = SCRATCH
  let s3 = 0
  let s3n = 0
  let s3at = SCRATCH
  let s4 = 0
  let s4n = 0
  let s4at = SCRATCH

  const putWord = (slot: number, v: number): void => {
    if (slot === SCRATCH) return
    out[slot] = (v >>> 8) & 0xff
    out[slot + 1] = v & 0xff
  }

  // $664 and $478: one bit, appended at the bottom of a word that shifts left
  const flag = (bit: number): void => {
    if (--s1n < 0) {
      putWord(s1at, s1)
      s1at = cursor
      cursor += 2
      s1n = 15
    }
    s1 = ((s1 << 1) | bit) & 0xffff
  }

  // $4ce and $736: two bits, the same way
  const pair = (v: number): void => {
    s2n -= 2
    if (s2n < 0) {
      putWord(s2at, s2)
      s2at = cursor
      cursor += 2
      s2n = 14
    }
    s2 = ((s2 << 2) | v) & 0xffff
  }

  // $6b4: a nibble, ORed in at the bottom and rotated right, so after eight of
  // them the first one is back in the low nibble where $9c8 reads it
  const nib = (v: number): void => {
    s3n -= 4
    if (s3n < 0) {
      if (s3at !== SCRATCH) put32(out, s3at, s3)
      s3at = cursor
      cursor += 4
      s3n = 28
      s3 = 0
    }
    const x = (s3 | v) >>> 0
    s3 = ((x >>> 4) | (x << 28)) >>> 0
  }

  // $6e2: an n-bit field. On overflow the accumulator is rotated so the full
  // sixteen bits land in the low word, written, and rotated back.
  const field = (v: number, n: number): void => {
    s4 = (((s4 << n) >>> 0) | v) >>> 0
    s4n -= n
    if (s4n < 0) {
      const d = -s4n
      s4 = ((s4 >>> d) | (s4 << (32 - d))) >>> 0
      putWord(s4at, s4 & 0xffff)
      s4at = cursor
      cursor += 2
      s4 = ((s4 << d) | (s4 >>> (32 - d))) >>> 0
      s4n = 16 - d
    }
  }

  // $550, $5ae, $652 and $8f2 all reach this: count one more pending literal,
  // remembering where the run began on the $ffff -> 0 step
  const countLiteral = (): void => {
    litCount++
    if (litCount === 0) litStart = pos
  }

  // $566: one stale chain entry retired per position, once the window is full
  const retire = (): void => {
    if (pos >= NUKE_WINDOW) next[clearCur++] = 0
  }

  // $434
  const flushLiterals = (): void => {
    const n = litCount
    flag(0)
    litCount = -1
    // $46a: written DOWN from the top of the buffer, so `move.b -(a4),(a0)+`
    // reads them back in the order they were emitted
    for (let i = 0; i <= n; i++) out[--litCur] = at(data, litStart - 1 + i)
    if (n === 0) {
      flag(1)
      return
    }
    flag(0)
    let k = n
    while (k > 3) {
      pair(0)
      k -= 3
    }
    // $4fc: neg and mask. 1 -> 3, 2 -> 2, 3 -> 1.
    pair(-k & 3)
  }

  // $658
  const emit = (len: number, dist: number): void => {
    if (litCount >= 0) flushLiterals()
    else flag(1)

    // $694: pick the group, then walk buckets until the residue fits
    let g = NUKE_GROUP[len < 3 ? len : 3]!
    let r = dist
    while (r >= 1 << NUKE_BITS[g]!) {
      r -= 1 << NUKE_BITS[g]!
      g++
    }
    nib(g)
    field(r, NUKE_BITS[g]!)

    if (len <= 2) return
    if (len <= 5) {
      // $72e: not and mask. 3 -> 3, 4 -> 2, 5 -> 1.
      pair(~(len - 3) & 3)
      return
    }
    pair(0)
    let k = len - 6
    while (k > 14) {
      nib(0)
      k -= 15
    }
    nib(~k & 15)
    // $806: catch the chain-clear up over the bytes the match skipped. The
    // library only does this on the long-match path, so after a short match
    // the cursor falls behind; that costs ratio, never correctness.
    if (pos >= NUKE_WINDOW) for (let i = 0; i <= len; i++) next[clearCur++] = 0
  }

  // $81e: enter every position the match covered into the chain
  const advance = (len: number, dist: number, key: number): void => {
    if (dist === 1) {
      pos += len + 1
      return
    }
    let a0 = pos + 1
    let k = key
    for (let i = 0; ; i++) {
      next[pos] = hash[k]!
      hash[k] = pos
      pos++
      if (i === len) break
      // $832: the rolling two-byte key
      k = ((k << 8) | at(data, a0++)) & 0xffff
    }
  }

  // $53c
  for (;;) {
    const key = ((at(data, pos - 1) << 8) | at(data, pos)) & 0xffff
    const head = hash[key]!

    if (head === 0) {
      // $550: this pair has never been seen, so there is nothing to search
      countLiteral()
      hash[key] = pos
      pos++
      retire()
      if (pos < last) continue
      break
    }

    let len = -1
    let dist = 0

    if (at(data, pos - 1) === at(data, pos)) {
      // $584: the pair is one byte twice, so scan the run directly instead of
      // walking a chain that is about to be thousands of entries long
      const b = at(data, pos - 1)
      let a0 = pos + 1
      let guard = last - pos
      for (;;) {
        const eq = at(data, a0) === b
        a0++
        if (!eq) break
        // $592's dbne, except that the library's counter is a word and would
        // wrap to 65535 rather than stop when it starts negative
        if (--guard < 0) break
      }
      let e = a0 > inLen ? inLen : a0
      e -= pos + 1
      if (e > 2) {
        // $5aa: distance one, and the run's first byte goes out as a literal
        dist = 1
        len = e - 1
        countLiteral()
        pos++
        retire()
      }
    }

    if (len < 0) {
      // $5d0: walk the chain for this key
      let floor = pos - NUKE_WINDOW
      if (floor < 0) floor = 0
      const base = pos + 1
      let bestEnd = pos + 2
      let bestSrcEnd = head + 2
      let cmpByte = at(data, base)
      let bias = 0 // a2, keeping `bias + cur + 1` on the byte that would extend
      let cur = head
      next[0] = pos // $5ee: the chain terminator recognised at $626

      walk: for (;;) {
        // $614: reject on one byte before paying for a compare
        if (at(data, bias + cur + 1) !== cmpByte) {
          cur = next[cur]!
          if (at(data, bias + cur + 1) !== cmpByte) {
            cur = next[cur]!
            continue
          }
        }
        if (cur === pos) break

        // $5f2. DEVIATION: `cmpm.b (a0)+,(a1)+` has no counter on it, so the
        // library compares past the end of the chunk into whatever follows and
        // stops on the first byte that differs there. This stops at the input
        // end. That is the same answer whenever that next byte differs, and
        // `$62e` clamps the winner to the input end regardless, so the length
        // this produces is identical. Only the choice between two candidates
        // that BOTH reach the end can come out differently.
        let a0 = cur + 1
        let a1 = base
        while (a1 < inLen && at(data, a0) === at(data, a1)) {
          a0++
          a1++
        }
        a0++
        a1++
        if (bestEnd >= a1) {
          cur = next[cur]!
          continue walk
        }
        // $600: a candidate older than the window ends the search outright
        if (cur <= floor) break
        bias += a1 - bestEnd
        bestEnd = a1
        bestSrcEnd = a0
        cmpByte = at(data, a1 - 1)
        cur = next[cur]!
      }

      // $62a
      dist = bestEnd - bestSrcEnd
      if (bestEnd > inLen) bestEnd = inLen
      len = bestEnd - base
      // $63c: keep it if it is three bytes or more, or if it is two bytes from
      // close enough that the nibble and its field cost less than the pair
      if (len <= 1 && dist >= 0x140) {
        next[pos] = hash[key]!
        countLiteral()
        hash[key] = pos
        pos++
        retire()
        if (pos < last) continue
        break
      }
    }

    emit(len, dist)
    advance(len, dist, key)
    if (pos >= last) break
  }

  // $8ec: force the tail into a literal run, because a match cannot end a
  // chunk. The decoder only looks for the end of the output after literals.
  if (pos !== inLen) countLiteral()
  countLiteral()
  flushLiterals()

  // $90e: the four part-full accumulators, each shifted so its bits sit where
  // its reader expects them
  putWord(s1at, (s1 << s1n) & 0xffff)
  putWord(s2at, (s2 << s2n) & 0xffff)
  if (s3at !== SCRATCH) put32(out, s3at, s3 >>> s3n)
  putWord(s4at, ((s4 & 0xffff) << s4n) & 0xffff)

  // $950: the two regions have been growing towards each other and this is the
  // only test that they did not meet
  if (litCur < cursor) return null
  const n = litTop - litCur
  let w = cursor
  // $97e: $fb until the literal block will end on a longword boundary, which
  // is what lets the decoder's `move.l (a5)+,d4` read the last nibbles
  while ((w + n) & 3) out[w++] = 0xfb
  for (let i = 0; i < n; i++) out[w++] = out[litCur + i]!

  // $2f4: the master's own EXPANSION test, and it accepts a tie
  if (w > inLen) return null
  return out.subarray(0, w)
}

/**
 * The modelled `LIBS:Compressors/`.
 *
 * A caller may add to this. Anything absent gets XPKERR_MISSINGLIB, which is
 * what `$c9a` sets when its `OpenLibrary` returns zero.
 */
export const XPK_PACKERS = new Map<string, XpkPacker>([
  [XPK_NONE.name, XPK_NONE],
  [XPK_RLEN.name, XPK_RLEN],
  [XPK_NUKE.name, XPK_NUKE],
])

/**
 * The packers that have no cipher, and answer XPKERR_NOCRYPT to a password.
 *
 * Read from the code rather than from a flag word: NONE's whole pack entry is
 * `moveq #$ef,d0 / rts`, RLEN's touches nothing in XpkSubParams past `$c(a2)`,
 * and NUKE's reads `$34(a2)` and then only `(a2)`, `$4`, `$8` and `$c`. No
 * password pointer is ever fetched by any of them. XpkInfo carries a flags
 * longword ($18 into the struct) whose bit assignments this port has not
 * established, and it reads 9 for all three, so it could not tell them apart
 * even if it were understood.
 */
const XPK_NO_CRYPT = new Set([XPK_NONE.name, XPK_RLEN.name, XPK_NUKE.name])

/** one byte, zero past the end -- a short read is a truncated file, not a crash */
const at = (b: Uint8Array, o: number): number => b[o] ?? 0
const u32 = (b: Uint8Array, o: number): number =>
  ((at(b, o) << 24) | (at(b, o + 1) << 16) | (at(b, o + 2) << 8) | at(b, o + 3)) >>> 0
const u16 = (b: Uint8Array, o: number): number => (at(b, o) << 8) | at(b, o + 1)

const put32 = (b: Uint8Array, o: number, v: number): void => {
  b[o] = (v >>> 24) & 0xff
  b[o + 1] = (v >>> 16) & 0xff
  b[o + 2] = (v >>> 8) & 0xff
  b[o + 3] = v & 0xff
}
const put16 = (b: Uint8Array, o: number, v: number): void => {
  b[o] = (v >>> 8) & 0xff
  b[o + 1] = v & 0xff
}

const fourcc = (b: Uint8Array, o: number): string =>
  String.fromCharCode(at(b, o), at(b, o + 1), at(b, o + 2), at(b, o + 3))

/**
 * `$2558` — the header checksum, a byte XOR.
 *
 * Both users store it so that the XOR of the whole header comes out zero:
 * the writer zeroes the slot, folds, and writes the result back (`$140a` for
 * the stream header, `$1276` for a chunk header).
 */
export function xpkHeaderChecksum(b: Uint8Array, off: number, len: number): number {
  let x = 0
  for (let i = 0; i < len; i++) x ^= at(b, off + i)
  return x & 0xff
}

/**
 * `$257e` — the chunk checksum: a longword XOR folded to sixteen bits.
 *
 * `d0 = d6; clr.w d0; swap d0; d1 = d6 eor d0; and #$ffff` — the high half
 * XORed onto the low. Always taken over the PADDED chunk length, which is why
 * the writer zeroes the four bytes past the data first (`$1248`).
 */
export function xpkChunkChecksum(b: Uint8Array, off: number, longs: number): number {
  let x = 0
  for (let i = 0; i < longs; i++) x = (x ^ u32(b, off + i * 4)) >>> 0
  return ((x >>> 16) ^ x) & 0xffff
}

/** the padded on-stream size of a chunk body: `d0 + 3 & $fffc` at `$e54`. */
const pad4 = (n: number): number => (n + 3) & ~3

/** eight bytes with word lengths, twelve with long ones (`$ae4`). */
const chunkHeaderSize = (flags: number): number =>
  flags & XPKSTREAMF_LONGHDRS ? 12 : 8

/**
 * `XpkExamineTags` (LVO -36, `$d54`) over its probe (`$450`).
 *
 * `password` is here because the probe is where the password is demanded: at
 * `$576`, a stream whose flags say it is encrypted fails with XPKERR_PASSWORD
 * before anything is decoded, whether or not the caller meant to decode it.
 */
export function xpkExamine(data: Uint8Array, password?: string): XpkFib {
  // $476: the first four bytes could not be read.
  if (data.length < 4) throw new XpkError(XPKERR_TRUNCATED)

  if (u32(data, 0) === XPK_MAGIC) {
    // $51c: kind 2. The header is 36 bytes and the rest of the probe assumes
    // it is all there, so a short one is a truncated file.
    if (data.length < 36) throw new XpkError(XPKERR_TRUNCATED)
    // $540: the whole 36 bytes must XOR to zero.
    if (xpkHeaderChecksum(data, 0, 36) !== 0) throw new XpkError(XPKERR_CHECKSUM)
    const flags = at(data, 32)
    if (flags & XPKSTREAMF_PASSWORD && password === undefined) {
      throw new XpkError(XPKERR_PASSWORD) // $576
    }
    const type = fourcc(data, 8)
    // $608: the sub-library is opened here, during examine, so a stream whose
    // compressor is not installed fails before a byte of it is unpacked.
    const packer = XPK_PACKERS.get(type)
    if (packer === undefined) throw new XpkError(XPKERR_MISSINGLIB) // $cf4
    return {
      kind: 'xpk',
      type,
      uLen: u32(data, 12),
      cLen: u32(data, 4),
      flags,
      subVrs: at(data, 34),
      masVrs: at(data, 35),
    }
  }

  if (u32(data, 0) === PP20_MAGIC) {
    // $72a: kind 3. The decrunched length is the top three bytes of the last
    // longword; `asr.l #8` at $78a drops the skip-bits byte under it.
    if (data.length < 12) throw new XpkError(XPKERR_TRUNCATED)
    return {
      kind: 'pp20',
      type: 'PP20',
      uLen: u32(data, data.length - 4) >>> 8,
      cLen: data.length,
      flags: 0,
      subVrs: 0,
      masVrs: 0,
    }
  }

  // $840: not packed at all. The master only allows this when the caller
  // asked for it, and EasyLife does -- its guide promises Elxpk Bload "will
  // transparently load uncrunched data". Otherwise $8f4 raises NOTPACKED.
  return {
    kind: 'raw',
    type: XPK_RAW_TYPE,
    uLen: data.length,
    cLen: data.length,
    flags: 0,
    subVrs: 0,
    masVrs: 0,
  }
}

/**
 * `XpkUnpackTags` (LVO -48, `$2ac`) and the per-chunk worker (LVO -60, `$da6`).
 *
 * The real thing streams: `$34e` asks the io hook for one chunk, `$366`
 * unpacks it and `$37e` writes the result, round and round until a chunk of
 * type 15 stops it. There is no reason to stream here — the whole input is
 * already a `Uint8Array` — so the loop below is the same walk with the buffer
 * management removed.
 */
export function xpkUnpack(data: Uint8Array, password?: string): Uint8Array {
  const fib = xpkExamine(data, password)

  // $1012: kind 1 hands the bytes straight back, 50000 at a time.
  if (fib.kind === 'raw') return data.slice()

  // $fa8: kind 3 is powerpacker.library's ppDecrunchBuffer, called with the
  // last longword as the tail pointer.
  if (fib.kind === 'pp20') {
    try {
      return pp20Decrunch(data)
    } catch {
      throw new XpkError(XPKERR_CORRUPTPKD)
    }
  }

  const packer = XPK_PACKERS.get(fib.type)
  if (packer === undefined) throw new XpkError(XPKERR_MISSINGLIB)

  const long = (fib.flags & XPKSTREAMF_LONGHDRS) !== 0
  const hdrSize = chunkHeaderSize(fib.flags)

  let p = 36
  if (fib.flags & XPKSTREAMF_EXTHEADER) {
    // $5a6: a word count, then that many bytes skipped.
    if (p + 2 > data.length) throw new XpkError(XPKERR_TRUNCATED)
    p += 2 + u16(data, p)
  }

  const out: Uint8Array[] = []
  let total = 0
  for (;;) {
    if (p + hdrSize > data.length) throw new XpkError(XPKERR_TRUNCATED)
    // $e14: the chunk header carries its own byte XOR, same rule as the
    // stream header.
    if (xpkHeaderChecksum(data, p, hdrSize) !== 0) throw new XpkError(XPKERR_CHECKSUM)
    const type = at(data, p)
    if (type === XPKCHUNK_END) break // $e04

    const cLen = long ? u32(data, p + 4) : u16(data, p + 4)
    const uLen = long ? u32(data, p + 8) : u16(data, p + 6)
    const cchk = u16(data, p + 2)
    p += hdrSize

    const cPad = pad4(cLen)
    if (p + cPad > data.length) throw new XpkError(XPKERR_TRUNCATED)
    // $e84 and $ef6: over the padded length, as longwords.
    if (xpkChunkChecksum(data, p, cPad >>> 2) !== cchk) throw new XpkError(XPKERR_CHECKSUM)

    if (type === XPKCHUNK_RAW) {
      // $eaa: the chunk data IS the output, uLen bytes of it.
      out.push(data.subarray(p, p + uLen))
    } else if (type === XPKCHUNK_PACKED) {
      const body = packer.unpackChunk(data.subarray(p, p + cLen), uLen, password)
      if (body.length !== uLen) throw new XpkError(XPKERR_CORRUPTPKD)
      out.push(body)
    } else {
      throw new XpkError(XPKERR_CORRUPTPKD) // $f92, moveq #$f2
    }
    total += uLen
    p += cPad
  }

  const buf = new Uint8Array(total)
  let w = 0
  for (const part of out) {
    buf.set(part, w)
    w += part.length
  }
  return buf
}

/**
 * Split EasyLife's `METHOD$` into a packer id and a packing mode.
 *
 * Its guide: "the first 4 letters are the name of the compressor library to
 * use. These are followed by a '.' and a two digit decimal number to indicate
 * the depth of compression -- e.g. \"HUFF.23\"". The mode reaches the packer
 * as `$1c` of its parameter block (`$11a0`, off the word at `$10a`), which is
 * why it is a plain 0..100 here and not interpreted further.
 */
export function xpkParseMethod(method: string): { name: string; mode: number } {
  const dot = method.indexOf('.')
  const name = (dot < 0 ? method : method.slice(0, dot)).toUpperCase()
  const mode = dot < 0 ? 0 : Number.parseInt(method.slice(dot + 1), 10)
  return { name, mode: Number.isFinite(mode) ? mode : 0 }
}

/**
 * `XpkPackTags` (LVO -30, `$17c`) and the per-chunk worker (LVO -90, `$1092`).
 *
 * The stream is written forwards with a placeholder header, and `$13dc` seeks
 * back to fill in `xsh_CLen` and the checksum once the total is known. Here
 * that is one buffer and two assignments at the end, which is the same thing
 * without a file pointer.
 *
 * The chunk size comes from the packer, not from here: see `xpkChunkSize`.
 * All three packers ask for well under 65000, so every stream this writes
 * stays in the word-length header form, which is the shape the reader above
 * is exercised on.
 */
export function xpkPack(data: Uint8Array, method: string, password?: string): Uint8Array {
  const { name, mode } = xpkParseMethod(method)
  const packer = XPK_PACKERS.get(name)
  if (packer === undefined) throw new XpkError(XPKERR_MISSINGLIB)
  if (password !== undefined && XPK_NO_CRYPT.has(name)) {
    // $2efc's message, and the only sensible answer from a packer that has no
    // cipher. See XPK_NO_CRYPT for how that is decided.
    throw new XpkError(XPKERR_NOCRYPT)
  }

  const chunk = xpkChunkSize(packer)
  const flags = chunk > XPK_LONGHDR_ABOVE ? XPKSTREAMF_LONGHDRS : 0
  const long = (flags & XPKSTREAMF_LONGHDRS) !== 0
  const hdrSize = chunkHeaderSize(flags)

  const parts: Uint8Array[] = []
  let total = 36

  const header = new Uint8Array(36)
  put32(header, 0, XPK_MAGIC)
  const id = (name + '    ').slice(0, 4)
  for (let i = 0; i < 4; i++) header[8 + i] = id.charCodeAt(i)
  put32(header, 12, data.length)
  // $10de: the first sixteen bytes of the original, so a tool can recognise
  // the content without decoding. Skipped entirely when a password is set,
  // which would otherwise leak the plaintext.
  if (password === undefined) header.set(data.subarray(0, 16), 16)
  header[32] = flags
  header[34] = 1 // xsh_SubVrs -- the version of the sub-library this needs
  header[35] = 1 // xsh_MasVrs -- and of the master
  parts.push(header)

  for (let off = 0; off < data.length; off += chunk) {
    const src = data.subarray(off, Math.min(off + chunk, data.length))
    const packed = packer.packChunk(src, mode, password)
    // $11de: EXPANSION is not an error. Clear it, call the chunk raw, and
    // store the input where the output would have gone.
    const type = packed === null ? XPKCHUNK_RAW : XPKCHUNK_PACKED
    const body = packed ?? src

    const cPad = pad4(body.length)
    const block = new Uint8Array(hdrSize + cPad)
    block.set(body, hdrSize) // the pad bytes stay zero, as at $1248
    if (long) {
      put32(block, 4, body.length)
      put32(block, 8, src.length)
    } else {
      put16(block, 4, body.length)
      put16(block, 6, src.length)
    }
    block[0] = type
    put16(block, 2, xpkChunkChecksum(block, hdrSize, cPad >>> 2))
    block[1] = xpkHeaderChecksum(block, 0, hdrSize)
    parts.push(block)
    total += block.length
  }

  // $13ae: a header of type 15 and nothing after it ends the stream.
  const end = new Uint8Array(hdrSize)
  end[0] = XPKCHUNK_END
  end[1] = xpkHeaderChecksum(end, 0, hdrSize)
  parts.push(end)
  total += hdrSize

  // $13f6: CLen counts everything after the first two longwords.
  put32(header, 4, total - 8)
  header[33] = xpkHeaderChecksum(header, 0, 36)

  const out = new Uint8Array(total)
  let w = 0
  for (const part of parts) {
    out.set(part, w)
    w += part.length
  }
  return out
}

/**
 * PowerPacker through the same door, for symmetry with the unpack side.
 *
 * The master does not pack PP20 — `powerpacker.library` is opened only on the
 * read path (`$80c`) — so this is not a modelled xpkmaster entry point and no
 * XPK keyword reaches it. It is exported because a caller holding an `XpkFib`
 * of kind `pp20` has nowhere else to go.
 */
export function xpkPackPP20(data: Uint8Array): Uint8Array {
  return pp20Crunch(data)
}
