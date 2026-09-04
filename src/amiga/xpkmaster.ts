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
 * Two disagreements survive and are recorded rather than settled, and both
 * are in `ancient`'s identify path rather than in a codec.
 *
 * A stream of NOTHING. `xpkPack` of an empty input is a header and an END
 * chunk, 44 bytes in the short header form and 48 in the long one, well
 * formed by every test here — `xsh_CLen` is $24, the header XORs to zero, and
 * `xpkExamine` reads it back as ULen 0. `ancient` will not identify it under
 * any method. The master's probe at `$450` tests the magic, the checksum and
 * the flags, and has no ULen test in it that this port has found.
 *
 * A BLZW, HUFF or IMPL stream whose chunks all came back RAW. `ancient
 * identify` calls it `<invalid>` where NONE, RLEN, NUKE and CBR0 all name
 * themselves off the same header, and then `ancient verify` decodes the very
 * same file and matches. So it is the naming that fails, not the reading.
 *
 * One thing `ancient` cannot check at all, and it is worth saying where.
 * HUFF ships its code table inside the chunk, so any consistent tree decodes
 * and the oracle has no opinion on whether the tree is the one the library
 * would have built. The two tie-breaks at `$4b8` and `$53c` are read off the
 * disassembly and checked only against a textbook Huffman's total bit count.
 *
 * ## The compressors that are here
 *
 * `XPK_PACKERS` is the registry standing in for `LIBS:Compressors/`, and all
 * seven entries in it are ported whole from the binary rather than stubbed.
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
 * chunk in reverse. See `XPK_NUKE`, the one worth reading first.
 *
 * `CBR0`, from `xpkCBR0.library` 1.0, 1,208 bytes: byte-run coding with both
 * counts biased and no terminator, and the first one whose chunks are big
 * enough to make the master write long headers. See `XPK_CBR0`.
 *
 * `BLZW`, from `xpkBLZW.library` 3.0, 1,940 bytes: LZW with `compress`'s
 * ratio-triggered dictionary reset, and the only one that reads `xsp_Mode`.
 * See `XPK_BLZW`.
 *
 * `HUFF`, from `xpkHUFF.library` 0.61, 2,560 bytes: static Huffman with the
 * code table shipped in the chunk, and the only one of the nine with a
 * cipher. See `XPK_HUFF`.
 *
 * `IMPL`, from `xpkIMPL.library` 0.18.77, 3,824 bytes and the largest of the
 * nine: the Imploder, wrapped. A packed chunk is a whole `IMP!` file, magic
 * and header and tail, so the codec sits in ./imploder.ts next to the
 * exploder AMCAF carries and `XPK_IMPL` is the wrapper over it. Nineteen
 * vectors, nine more than XPK asks for, and the extra four are the crunch and
 * decrunch entry points with and without the header.
 *
 * Every other method resolves through `OpenLibrary("compressors/xpk%.4s.library")`
 * at `$c9a`, and when that fails the master sets XPKERR_MISSINGLIB and gives
 * up. That is what this port does for FEAL and IDEA, and it is not a
 * shortcut. It is what a real Amiga does with an empty
 * `LIBS:Compressors/`, which is the machine EasyLife's own guide describes:
 * "the XPK libraries are not included in this distribution, you must obtain
 * the XPK compression archive separately".
 *
 * The two that are left are a CHOICE and not a limit, which was stated
 * wrongly here until 2026-08-12: nine of those sub-libraries are held, 1,040
 * to 4,052 bytes apiece, in `COMPRESSORS/` on all three Library volumes of
 * the AMOS PD Library CD 1994. Seven are ported. FEAL and IDEA are block
 * ciphers rather than compressors and are out of scope for a BASIC runtime,
 * so they stay MISSINGLIB with their binaries sitting right there.
 *
 * ## The errors are plain Errors
 *
 * Same rule as `./powerpacker.ts`: a codec does not get to name AMOS error
 * numbers. `XpkError` carries the library's own code (-1..-32, the table at
 * `$2c52`) and the caller decides what that means. EasyLife's `Elxpk Error`
 * hands the raw number straight back to the program, so the number IS the
 * interface there.
 */
import { explodeChecked, turboImplode } from './imploder'
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
  /** `XpkInfo+2`, the newest stream format version this sub-library reads */
  readonly version?: number
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
 * Every packer here declares a default, which is why this is not the
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
 * `xpkCBR0.library` 1.0, whole. 1,208 bytes of code, and the first one here
 * that is compiled C rather than hand-written assembler: it has a redundant
 * `jsr` to an empty routine in it (`$266` calls `$27c`, which is one `rts`),
 * and it uses `bhi` in one bounds test and `bls` in the next for the same
 * comparison.
 *
 * Its `$VER` string at `$4` separates almost every word with $a0, a Latin-1
 * non-breaking space, and reads "$VER:\xa0xpkCBR0.library\xa0V1.0 \xa9\xa0by
 * \xa0Bilbo\xa01st\xa0of\xa0Hypenosis\xa0on\xa023-Aug-1992." -- his
 * spelling of Hypenosis, kept.
 *
 * Its XpkInfo is not a static. `XpkPackerInfo` at `$15e` is `move.l a6,d0 /
 * addi.l #$28,d0`, and `$358` fills the struct in at library base + $28
 * during init, so the strings are only reachable through the `lea`s at `$372`,
 * `$37a` and `$382`. It calls itself "Cmp Byte Run 0 Packer V1.0" and offers
 * one mode, "normal".
 *
 * Byte-run length coding, which is RLEN's idea with three differences that
 * matter. The control byte is signed, as RLEN's is, but the counts are
 * biased and there is no terminator:
 *
 *     0..127     that many PLUS ONE literal bytes follow
 *     -1..-127   one byte follows, repeated (1 - n) times, so 2 to 128
 *     -128       never emitted; the one hole in the encoding
 *
 * So a chunk decodes until its input runs out rather than until a zero byte,
 * which is why `$1b8` spends two bytes on a lone trailing byte (`00 <byte>`)
 * where RLEN would have folded it into a literal run.
 *
 * The third difference is the one with consequences elsewhere. CBR0 declares
 * `xpi_DefChunk` 65532, over the master's 65000 at `$aec`, so it is the only
 * packer here whose streams carry TWELVE-byte chunk headers and the
 * XPKSTREAMF_LONGHDRS flag. Nothing else exercises that half of the writer.
 *
 * The packer gives up the moment its output reaches the input length (`$1cc`
 * tests the write cursor against `OutBuf + InLen` on every literal byte), so
 * unlike RLEN it can never hand back a chunk that grew.
 */
const XPK_CBR0: XpkPacker = {
  name: 'CBR0',
  longName: 'Cmp Byte Run 0 Packer V1.0',
  maxChunk: 0xfffc,
  defaultChunk: 0xfffc,
  packChunk: (data) => cbr0Pack(data),
  unpackChunk: (data, uLen) => cbr0Unpack(data, uLen),
}

/**
 * `$168`, XpkPackChunk.
 *
 * Two limits ride along the whole way. `d2` is `OutBuf + xsp_OutBufLen + 256`
 * and raises SMALLBUF; `d3` is `OutBuf + InLen` and raises EXPANSION. Since
 * the master always hands over a buffer at least as long as the input, `d3`
 * is reached first and the SMALLBUF path is unreachable through the master.
 * It is here because a direct caller is not the master.
 */
const cbr0Pack = (data: Uint8Array): Uint8Array | null => {
  const inLen = data.length
  // $252: an empty chunk is a SUCCESS with a zero-length result, not EXPANSION
  if (inLen === 0) return new Uint8Array(0)
  // $17a: its own xpi_MaxChunk, checked again on the way in
  if (inLen > 0xfffc) throw new XpkError(XPKERR_BIGBUF)

  const outBufLen = xpkPackBufLen(inLen)
  const out = new Uint8Array(outBufLen)
  const hard = outBufLen + 0x100 // d2
  const exp = inLen // d3
  let i = 0 // a1
  let o = 0 // a2

  for (;;) {
    // $198
    if (i >= inLen) break
    let b = at(data, i)

    if (i + 1 >= inLen) {
      // $1a8: the last byte of the chunk, spent as a one-byte literal run
      if (o + 2 > hard) throw new XpkError(XPKERR_SMALLBUF)
      if (o + 2 > exp) return null
      out[o++] = 0
      out[o++] = b
      break
    }

    if (at(data, i + 1) === b) {
      // $202: a run, and the count is written WITHOUT the negate the literal
      // side applies, which is what makes it come out negative
      if (o + 2 > hard) throw new XpkError(XPKERR_SMALLBUF)
      if (o + 2 > exp) return null
      let d4 = 0x7f
      let last = false
      for (;;) {
        const eq = at(data, i) === b
        i++
        if (!eq) {
          // $22a: the byte that broke the run is put back
          out[o++] = (d4 - 0x7e) & 0xff
          out[o++] = b
          i--
          break
        }
        if (i >= inLen) {
          // $238, and this one does NOT loop: it falls into the exit at $242.
          // The `subq.w #$1,a1` that follows the store is dead, which is how
          // the routine avoids emitting the run's last byte a second time.
          out[o++] = (d4 - 0x7f) & 0xff
          out[o++] = b
          last = true
          break
        }
        // $21a's dbra, which falls through at 128 bytes
        if (--d4 === -1) {
          out[o++] = (d4 - 0x7e) & 0xff
          out[o++] = b
          break
        }
      }
      if (last) break
      continue
    }

    // $1c4: a literal run, with the count byte held back at `o` until the
    // length is known and the bytes going down one past it
    let w = o + 1
    let d4 = 0x7f
    let done = false
    for (;;) {
      // $1cc and $1d2, both `bls` where the run path above used `bhi`
      if (hard <= w) throw new XpkError(XPKERR_SMALLBUF)
      if (exp <= w) return null
      // $1d8: stop BEFORE the byte that starts a run, so the run path gets it
      if (at(data, i + 1) === b) break
      out[w++] = at(data, i++)
      if (i >= inLen) {
        // $1f6, one less decrement than the other exit has had
        out[o] = -((d4 - 0x7f) & 0xff) & 0xff
        o = w
        done = true
        break
      }
      b = at(data, i)
      if (--d4 === -1) break
    }
    if (done) break
    // $1ea
    out[o] = -((d4 - 0x7e) & 0xff) & 0xff
    o = w
  }
  return out.subarray(0, o)
}

/**
 * `$27e`, XpkUnpackChunk.
 *
 * `moveq #$0,d3 / move.b (a1)+,d3` leaves the control byte UNSIGNED in `d3`
 * and tests the sign with `bmi` off the move, so the run branch then reads
 * the count back with `neg.b`: $ff becomes 1 and a `dbra` of 1 copies twice.
 */
const cbr0Unpack = (data: Uint8Array, uLen: number): Uint8Array => {
  const out = new Uint8Array(uLen)
  if (data.length === 0) return out
  if (data.length > 0xfffc) throw new XpkError(XPKERR_BIGBUF)
  let i = 0
  let o = 0
  // DEVIATION: the library guards the output at `OutBuf + $c(a0) + 256`, and
  // on the unpack side the master sets `$c(a0)` to the unpacked length, so it
  // will write 256 bytes into XPK_MARGIN before raising SMALLBUF. Here the
  // output is exactly `uLen` and a stream claiming more is truncated, which
  // is the same choice RLEN's unpacker made.
  while (i < data.length && o < uLen) {
    const c = at(data, i++)
    if ((c & 0x80) !== 0) {
      const v = at(data, i++)
      const n = -c & 0xff
      for (let k = 0; k <= n && o < uLen; k++) out[o++] = v
    } else {
      for (let k = 0; k <= c && o < uLen; k++) out[o++] = at(data, i++)
    }
  }
  return out
}

/**
 * The hash table sizes, `$65e`, one word per code width from 9 to 15.
 *
 * Each is a prime a little over 1.25 times `1 << bits`, so the table is at
 * most four fifths full when the dictionary fills. `$66c` multiplies the
 * entry count by six, because a slot is three words: the character, the
 * prefix code, and the code the pair was given.
 */
export const BLZW_HASH = [641, 1283, 2579, 5147, 10243, 20483, 40961]

/**
 * `xpkBLZW.library` 3.0, whole. 1,940 bytes of code, Bryan Ford, 1992.
 *
 * LZW, and the first packer here whose two halves are genuinely different
 * programs rather than one algorithm run backwards. It calls itself "Bryan's
 * turbo-charged LZW" and describes itself as "Fast compression and
 * decompression, ratio much like 'compress' or 'zoo'", which is fair: the
 * dictionary reset at `$5c6` is the `compress` ratio heuristic, transcribed.
 *
 * A chunk opens with two words that the encoder writes LAST, at `$636..$64a`:
 *
 *     +0  the widest code the stream ever reaches
 *     +2  the longest string the encoder built, rounded up to four
 *
 * `$786` turns those into one allocation, `(4 << maxbits) + stackSize`, which
 * is the decoder's dictionary with its output stack sitting underneath.
 *
 * The mode is the only sub-library setting in this file that changes the
 * output. `$2f6` is `mode * 7 / 100 + 9` clamped to 9..15, so "BLZW" is
 * nine-bit codes and "BLZW.99" is fifteen.
 *
 * Codes 256, 257 and 258 are END, RESET and WIDEN. The decoder stores them as
 * dictionary entries `$8000`, `$8001` and `$8002` at `$6ba..$6c4`, alongside
 * the 256 leaves it wrote as `$ff00+i`, and then tells the four kinds apart
 * with the overflow flag rather than a comparison. `subq.w #$3,d7` overflows
 * only for `$8000..$8002`; two `addq.w #$1,d7 / bvc` pairs walk those three
 * apart. It is the neatest thing in any of these nine libraries.
 *
 * `xpi_Flags` is `$8009` where NONE, RLEN, NUKE and CBR0 all read 9. IMPL is
 * the only other one with the top bit set, and what it means is not settled
 * here.
 */
const XPK_BLZW: XpkPacker = {
  name: 'BLZW',
  longName: "Bryan's turbo-charged LZW",
  maxChunk: 0x7fffffff,
  minChunk: 128,
  defaultChunk: 131072,
  packChunk: (data, mode) => blzwPack(data, mode),
  unpackChunk: (data, uLen) => blzwUnpack(data, uLen),
}

/** `$2f6`, the mode to a code width. `mulu.w` reads the low word of `xsp_Mode` and no more. */
const blzwMaxBits = (mode: number): number => {
  const n = Math.floor(((mode & 0xffff) * 7) / 100) + 9
  return n < 9 ? 9 : n > 15 ? 15 : n
}

/**
 * `$448`, XpkPackChunk's worker.
 *
 * The output buffer doubles as the expansion guard. `$45e` rounds the input
 * length down to 32, `$484` clears that many bytes of output with a `movem.l`
 * of eight zeroed registers, and `$582` gives up the moment the write cursor
 * reaches eight bytes short of the end. So the packer can never return a
 * chunk longer than the input, and the clear is what lets the writer OR each
 * code into place instead of masking.
 *
 * The hash is `(char << (maxbits - 8)) ^ prefix` as a word (`$4f6..$4fc`),
 * and a miss rehashes by `slot - entries + 1` wrapping (`$516`), not by one.
 * That step is never zero and never a multiple of a prime table size, so the
 * probe reaches every slot, and BLZW_HASH keeps a fifth of them free.
 */
const blzwPack = (data: Uint8Array, mode: number): Uint8Array | null => {
  const inLen = data.length
  // $450: 128 bytes is the floor, and xpi_MinChunk declares the same number
  if (inLen <= 0x7f) return null

  const maxbits = blzwMaxBits(mode)
  const entries = BLZW_HASH[maxbits - 9]!
  const shift = maxbits - 8 // a6

  const outCap = inLen & ~31 // $45e
  const out = new Uint8Array(outCap) // $484
  const limit = outCap - 8 // $464

  const hChar = new Int16Array(entries) // word0, -1 is empty
  const hPrev = new Uint16Array(entries) // word1, the prefix code
  const hCode = new Uint16Array(entries) // word2, the code this pair was given

  let cursor = 4 // a1, past the two header words
  let bitPos = 32 // d2
  let maxLen = 0 // $e(a7)
  let headWidth = 0 // out[0..1], written only when the dictionary fills
  let bust = false

  // $4d2 and $4ce and $4d6, which $5f0 comes back to
  let width = 9 // a3
  let next = 0x103 // d3
  let threshold = 0x200 // $0(a7)
  let best = 0 // $2(a7)
  let markIn = 0 // $14(a7)
  let markOut = 0 // $18(a7)
  let ip = 0 // a0
  let full = false

  /** `$57c`. `d2 + width` never exceeds 32, so the shifted code always fits the longword. */
  const emit = (code: number): void => {
    bitPos -= width
    if (bitPos < 0) {
      cursor += 2
      // $582, and $8(a7) inside the subroutine is $4(a7) outside it: the bsr
      // pushed four bytes. The bail at $576 pops them before giving up.
      if (cursor >= limit) {
        bust = true
        return
      }
      bitPos += 16
    }
    put32(out, cursor, (u32(out, cursor) | ((code << bitPos) >>> 0)) >>> 0)
  }

  // $4bc, which is also where a reset lands
  for (;;) {
    hChar.fill(-1) // $4c6
    width = 9
    next = 0x103
    threshold = 0x200
    full = false

    let prefix = at(data, ip++) // $4de
    let strLen = 4 // $4e2, so it counts the length plus three
    let restart = false

    while (ip < inLen) {
      const ch = at(data, ip++) // $4f4
      let slot = ((ch << shift) ^ prefix) & 0xffff
      const step = slot - entries + 1 // $518, in slots rather than the library's bytes
      let hit = false
      while (hChar[slot]! >= 0) {
        if (hPrev[slot] === prefix && hChar[slot] === ch) {
          // $4ea: the string extends, so the code it already has becomes the prefix
          prefix = hCode[slot]!
          strLen++
          hit = true
          break
        }
        slot += step
        if (slot < 0) slot += entries
      }
      if (hit) continue

      // $53a: an empty slot, so this string is new
      if (strLen > maxLen) maxLen = strLen
      hCode[slot] = next & 0xffff // $548

      if (full) {
        // $5c6: `subq.b #$1,d3` counts the low byte of a d3 that $5b6 set to
        // -1, so the ratio is measured once every 256 new strings.
        next = (next & ~0xff) | ((next - 1) & 0xff)
        if ((next & 0xff) === 0) {
          // $5ca: (input since the mark) * 256 / (output since the mark)
          const num = (ip - markIn) * 0x100
          const den = cursor - markOut
          const q = Math.floor(num / den)
          // DEVIATION: `divu.w` leaves d6 untouched and sets V when the
          // quotient will not fit a word, and nothing here tests V. The
          // worst case the master can hand over is a whole xpi_DefChunk of
          // one repeated byte, and that peaks at 57573 out of 65535, so the
          // overflow is out of reach through xpkPack.
          const ratio = q > 0xffff ? num & 0xffff : q
          if (ratio >= best) {
            // $5e0: still improving, so move the mark up
            markIn = ip
            markOut = cursor
            best = ratio
          } else if (inLen - ip > 0x7f) {
            // $5f0: the ratio fell. Flush both live codes, say RESET, and
            // start the dictionary again. $5f2 will not bother for a tail of
            // 127 bytes or fewer.
            emit(prefix)
            if (bust) return null
            emit(ch)
            if (bust) return null
            emit(0x101)
            if (bust) return null
            restart = true
            break
          }
        }
      } else {
        hPrev[slot] = prefix // $54c
        hChar[slot] = ch // $54e
        next++
        if (next >= threshold) {
          // $592
          if (width === maxbits) {
            // $5ae: the dictionary is full for good. The header takes the
            // width here, because a later reset walks `width` back to nine.
            headWidth = maxbits
            full = true
            next = 0xffffffff
            markIn = ip
            markOut = cursor
            best = 0
          } else if (prefix >= threshold) {
            // $598: hold the widen back until a code actually needs it
            emit(0x102)
            if (bust) return null
            width++
            threshold = (threshold << 1) & 0xffff
          }
        }
      }

      // $558
      const code = prefix
      prefix = ch
      emit(code)
      if (bust) return null
      strLen = 4
    }

    if (restart) continue

    // $612
    if (prefix >= threshold) {
      emit(0x102)
      if (bust) return null
      width++
    }
    emit(prefix)
    if (bust) return null
    emit(0x100)
    if (bust) return null
    cursor += 4 // $634
    break
  }

  // $63e: the decoder's stack only ever holds the string minus its first
  // character, and strLen counted the length plus three, so this is a round
  // up to four and not a fudge.
  put16(out, 2, maxLen & 0xfffc)
  // $646: zero means the dictionary never filled, and the width it stopped at
  // is all the decoder needs to size itself
  put16(out, 0, headWidth === 0 ? width : headWidth)
  return out.subarray(0, cursor)
}

/**
 * `$690`, XpkUnpackChunk's worker.
 *
 * One dictionary of four-byte entries and one stack that grows down into the
 * bytes below it. An entry is either a leaf, whose first word is negative and
 * whose low byte is the character, or a pair: the character in the first word
 * and TWICE the prefix code in the second, so `$70a` can index with one
 * `adda.l` instead of a shift.
 *
 * `$6f6` compares the code against the free pointer and pushes the last
 * character when it runs past. That is the KwKwK case, and it is only ever
 * taken at the moment the dictionary fills, because everywhere else the entry
 * the encoder is about to name has already been built at the top of the loop.
 */
const blzwUnpack = (data: Uint8Array, uLen: number): Uint8Array => {
  const maxbits = u16(data, 0) // $694
  const stackSize = u16(data, 2) // $6a4
  // DEVIATION: the library asks AllocMem for `(4 << maxbits) + stackSize` and
  // answers XPKERR_NOMEM when that fails, so a header claiming 31 bits is a
  // failed allocation on a real machine. Here it is a rejected header, which
  // reaches the same answer without asking for two gigabytes first.
  if (maxbits < 9 || maxbits > 15) throw new XpkError(XPKERR_NOMEM)

  const slots = 1 << maxbits
  const dChar = new Int16Array(slots) // word0
  const dPrev = new Uint16Array(slots) // word1, twice the prefix code
  for (let i = 0; i < 0x100; i++) dChar[i] = 0xff00 | i // $6b0, a leaf carrying its own character
  dChar[0x100] = -0x8000 // $6ba, `move.w #$8000,(a2)`, END
  dChar[0x101] = -0x7fff // $6be, $8001, RESET
  dChar[0x102] = -0x7ffe // $6c4, $8002, WIDEN

  const out = new Uint8Array(uLen)
  const stack = new Uint8Array(stackSize)
  let o = 0
  let sp = stackSize // a4, and a4 back at a5 is an empty stack

  let bitPos = 32 // the low word of d0
  let ip = 4 // a0, which the two `move.w (a0)+` header reads left past the header
  let width = 9 // a2, a code width kept in an address register
  let mask = 0x1ff // d2
  let free = 0x103 // a6
  let room = slots - 0x103 // d1, out of the high word of d0
  let prev = 0 // d4, kept as a plain code where the library doubles it
  let firstCh = 0 // d6, the first character of the string just written

  /** `$6de`, MSB first, out of a longword window whose cursor only ever moves by two */
  const read = (): number => {
    bitPos -= width
    if (bitPos < 0) {
      ip += 2
      bitPos += 16
    }
    return (u32(data, ip) >>> bitPos) & mask
  }
  const push = (b: number): void => {
    // DEVIATION: the library has no floor here and would write below its own
    // allocation. A stream whose header understates the stack is corrupt, and
    // this catches it here rather than in the caller's heap.
    if (sp === 0) throw new XpkError(XPKERR_CORRUPTPKD)
    stack[--sp] = b
  }
  const emit = (b: number): void => {
    // DEVIATION: the library writes past the end and lets $376 notice after
    // the fact. Stopping here reaches the same XPKERR_CORRUPTPKD.
    if (o >= uLen) throw new XpkError(XPKERR_CORRUPTPKD)
    out[o++] = b
  }

  // $6d4 enters at the reset, so the chunk starts the same way it restarts
  let advance = false
  let store = false
  let code = 0
  for (let started = false; ; ) {
    if (started) {
      if (advance) {
        // $6d8: the entry the previous code earned, built now that the
        // string after it has given up its first character
        if (store) {
          dChar[free] = firstCh
          dPrev[free] = prev * 2
          free++
        }
        prev = code // $6dc
      }
      code = read()
      let idx = code
      if (code >= free) {
        // $6f6: the encoder named an entry this side has not built yet
        push(firstCh)
        idx = prev
      }
      let w0 = dChar[idx]!
      if (w0 >= 0) {
        // $706: walk the prefix chain, stacking a character a link
        do {
          push(w0 & 0xff)
          idx = dPrev[idx]! >>> 1
          w0 = dChar[idx]!
        } while (w0 >= 0)
        emit(w0 & 0xff) // $714, the leaf, which goes out first
        firstCh = w0 & 0xff
        while (sp < stackSize) emit(stack[sp++]!) // $718
      } else if (w0 < -0x7ffd) {
        // $728: `subq.w #$3,d7` overflows for $8000, $8001 and $8002 alone
        if (w0 === -0x8000) break // $74e, END
        if (w0 === -0x7ffe) {
          // $746, WIDEN. `bra $6de` skips both the entry store and the
          // prefix update, so the code after it lands on the prefix the code
          // before it left.
          width++
          mask = mask * 2 + 1
          advance = false
          continue
        }
        advance = false // $752, RESET
        started = false
        continue
      } else {
        // a leaf on the first read, so the stack holds one pushed byte at most
        emit(w0 & 0xff) // $72e
        firstCh = w0 & 0xff
        if (sp < stackSize) emit(stack[sp++]!) // $736
      }
      // $71e and $738, both `dbra d1`: the store stops when the slots do
      advance = true
      room--
      store = room >= 0
      if (!store) room = 0
      continue
    }

    // $752
    started = true
    width = 9
    mask = 0x1ff
    free = 0x103
    room = slots - 0x103
    code = read() // $76e
    prev = code
    firstCh = code
    emit(code & 0xff) // $77a
    advance = false
    store = false
  }

  // $376: the library decodes into the master's buffer and only then checks
  // that it produced exactly what the chunk header promised
  if (o !== uLen) throw new XpkError(XPKERR_CORRUPTPKD)
  return out
}

/**
 * `xpkHUFF.library` 0.61, whole. 2,560 bytes of code, M. Zimmermann, 8 August
 * 1992, and the only one of the nine with a cipher in it.
 *
 * Static Huffman over the 256 byte values, with the code table shipped in the
 * chunk. It calls itself "Huffman V\xa00.61" -- with a Latin-1 non-breaking
 * space, as CBR0's author also used -- and "Dynamic huffman crunch
 * algorithm, cache optimized byte decrunch algorithm". The second half of
 * that is literal: `$8a0` unrolls all eight bits of an input byte into
 * straight-line code, sixteen `movea.l`/`move.w`/`bpl` triples with no loop
 * around them.
 *
 * A chunk opens with six bytes:
 *
 *     +0  a zero word. `$784` rejects anything else with XPKERR_SUBTOOOLD,
 *         so it is a format version and this is version zero.
 *     +2  the password check, `$abadcafe` when there is no password
 *
 * Then 256 table entries, one per byte value: `$ff` for a value that never
 * occurs, otherwise a length byte holding bits-1 followed by `ceil(bits/8)`
 * bytes of code, MSB first and the last byte left-shifted so the bits sit at
 * the top. Then the body, the same bits back to back.
 *
 * Everything from offset 6 on is enciphered when a password is given. Neither
 * the version word nor the check longword is.
 *
 * `xpi_Flags` is `$a009`. That is BLZW's `$8009` plus bit 13, and HUFF is the
 * only one of the five here that ever fetches `xsp_Password` at `$20(a2)`, so
 * bit 13 marking a cipher is the reading this port takes. `xpi_MaxChunk` and
 * `xpi_DefChunk` are both 65534, over the 65000 at `$aec`, which makes HUFF
 * the third long-header packer.
 */
const XPK_HUFF: XpkPacker = {
  name: 'HUFF',
  longName: 'Huffman V\u00a00.61',
  maxChunk: 0xfffe,
  minChunk: 1,
  defaultChunk: 0xfffe,
  packChunk: (data, _mode, password) => huffPack(data, password),
  unpackChunk: (data, uLen, password) => huffUnpack(data, uLen, password),
}

/** the password as the library sees it: Latin-1 bytes, and a NUL ends it */
const huffKey = (password: string): Uint8Array => {
  const end = password.indexOf('\0')
  const s = end < 0 ? password : password.slice(0, end)
  return Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)
}

/**
 * `$5ec` in the packer and `$798` in the unpacker, the same eleven
 * instructions twice.
 *
 * Two passes over the password. `d1` is seeded `$c0de` and only its low byte
 * is ever reloaded, so every character enters the arithmetic as `$c000 + ch`
 * rather than as itself. The `swap` between the passes is what puts the first
 * pass's result in the high word and hands the second pass `$abad`.
 */
const huffCheck = (key: Uint8Array): number => {
  let hi = 0xabad
  let lo = 0xcafe
  for (const ch of key) lo = (lo + 0xc000 + ch) & 0xffff
  ;[hi, lo] = [lo, hi]
  for (const ch of key) {
    lo ^= 0xc000 | ch
    lo = ((lo << 8) | (lo >>> 8)) & 0xffff // rol.w #$8,d0
  }
  return ((hi << 16) | lo) >>> 0
}

/**
 * `$6ca` enciphers and `$7d2` undoes it, over everything from offset 6 on.
 *
 * The keystream is the password repeated, and each byte then chains off the
 * CIPHER byte before it. `$6de` and `$7da` both seed that chain with the
 * password's first character read without advancing, so the first plaintext
 * byte is not simply XORed.
 */
const huffCrypt = (buf: Uint8Array, from: number, to: number, key: Uint8Array, encipher: boolean): void => {
  let k = 0
  let prev = key[0] ?? 0
  for (let i = from; i < to; i++) {
    // $6e6 and $7e2: the NUL is what wraps the key, so an empty password
    // gives a keystream of zeroes rather than dividing by nothing
    if (k >= key.length) k = 0
    const ks = key[k++] ?? 0
    if (encipher) {
      const c = (((buf[i]! ^ ks) & 0xff) + prev) & 0xff
      buf[i] = c
      prev = c
    } else {
      const c = buf[i]!
      buf[i] = ((c - prev) ^ ks) & 0xff
      prev = c
    }
  }
}

/**
 * `$414`, XpkPackChunk's worker.
 *
 * The tree is built the slow, obvious way, and the order it does it in is the
 * whole of the format. Leaves go into the array at `$220` in symbol order,
 * one per byte value that occurs. `$4a6` then sorts them by repeatedly
 * scanning for the largest remaining frequency and pushing it onto the front
 * of a list, which leaves the list ascending. The comparison at `$4b8` is
 * `bhi`, so a tie keeps the LAST node scanned, and pushing reverses that:
 * within one frequency the list runs lowest symbol first.
 *
 * `$4f4` then takes the two at the head, gives the first branch 0 and the
 * second branch 1, and re-inserts their parent. `$53c` is `bhi` again, so the
 * new parent goes in FRONT of every node it ties with. Get either tie-break
 * backwards and the codes still decode, they are just not the codes the
 * library writes.
 */
const huffPack = (data: Uint8Array, password?: string): Uint8Array | null => {
  const inLen = data.length
  const outBufLen = xpkPackBufLen(inLen)
  const key = password === undefined ? null : huffKey(password)
  /** `$71a`: an encrypted chunk cannot be stored raw, so it cannot answer EXPANSION */
  const giveUp = (): null => {
    if (key !== null) throw new XpkError(XPKERR_SMALLBUF)
    return null
  }
  // $5d4, which the master's own buffer size can never fail
  if (outBufLen <= 6) return giveUp()

  // $450: 256 words, and the count is a word so it wraps at 65536. xpi_MaxChunk
  // is 65534, so through the master it cannot.
  const freq = new Uint16Array(256)
  for (const b of data) freq[b] = (freq[b]! + 1) & 0xffff

  // node arrays, standing in for the 32-byte records at $220 and $2240
  const NIL = -1
  const LOOSE = -2 // the library's -1 at record+0, before the node joins the list
  const nFreq = new Int32Array(512)
  const nSym = new Int32Array(512)
  const nNext = new Int32Array(512).fill(NIL)
  const nUp = new Int32Array(512).fill(NIL)
  const nSide = new Int32Array(512).fill(-1)

  // $46c: a leaf per byte value that occurs, in symbol order
  let leaves = 0
  for (let sym = 0; sym < 256; sym++) {
    if (freq[sym] === 0) continue
    nSym[leaves] = sym
    nFreq[leaves] = freq[sym]!
    nNext[leaves] = LOOSE
    leaves++
  }
  if (leaves === 0) return giveUp()

  // $4a6: extract the largest still loose, push it on the front, repeat
  let head = NIL
  for (;;) {
    let best = NIL
    let bestFreq = 0
    for (let i = 0; i < leaves; i++) {
      if (nNext[i] === LOOSE && nFreq[i]! >= bestFreq) {
        bestFreq = nFreq[i]!
        best = i
      }
    }
    if (best === NIL) break
    nNext[best] = head
    head = best
  }

  let free = leaves // the arena the library puts at $2240
  let root: number
  if (nNext[head] === NIL) {
    // $4de: one distinct byte value in the whole chunk, so the tree is a
    // parent with one child and the code is a single 0 bit
    nSide[head] = 0
    nUp[head] = free
    root = free++
  } else {
    let a0 = head
    for (;;) {
      if (nNext[a0] === NIL) {
        root = a0
        break
      }
      const a2 = free++
      const a1 = nNext[a0]!
      nSide[a0] = 0
      nSide[a1] = 1
      nFreq[a2] = (nFreq[a0]! + nFreq[a1]!) & 0xffff
      nUp[a0] = a2
      nUp[a1] = a2
      a0 = nNext[a1]!
      // $530..$560, the re-insert, and every branch of it ends with a0 at the
      // head of what is left
      if (a0 === NIL) {
        a0 = a2
      } else if (nFreq[a2]! <= nFreq[a0]!) {
        nNext[a2] = a0
        a0 = a2
      } else {
        let a3 = a0
        for (;;) {
          if (nNext[a3] === NIL) {
            nNext[a3] = a2
            break
          }
          const a4 = a3
          a3 = nNext[a3]!
          if (nFreq[a2]! > nFreq[a3]!) continue
          nNext[a4] = a2
          nNext[a2] = a3
          break
        }
      }
    }
  }
  nSide[root] = -1 // $56a, the $ffff that stops the walk up

  // $574: one code per leaf, read off the sides on the way to the root
  const codeLen = new Int32Array(256)
  const codeBits: Array<Uint8Array | null> = new Array(256).fill(null)
  for (let i = 0; i < leaves; i++) {
    const bits: number[] = []
    for (let p = i; nSide[p]! >= 0; p = nUp[p]!) bits.push(nSide[p]!)
    bits.reverse() // the library pushes on the stack and pops, which is this
    const packed = new Uint8Array((bits.length + 7) >> 3)
    for (let k = 0; k < bits.length; k++) if (bits[k] === 1) packed[k >> 3]! |= 0x80 >> (k & 7)
    codeLen[nSym[i]!] = bits.length
    codeBits[nSym[i]!] = packed
  }

  const out = new Uint8Array(outBufLen)
  let o = 0
  // $5e4 and $616, the six bytes that are never enciphered
  put16(out, 0, 0)
  put32(out, 2, key === null ? 0xabadcafe : huffCheck(key))
  o = 6

  // $618: the table, and $636 checks the expansion limit after every byte
  const limit = inLen // a4 = OutBuf + InLen
  for (let sym = 0; sym < 256; sym++) {
    const bits = codeBits[sym] ?? null
    if (bits === null) {
      out[o++] = 0xff // $650, and no code can be 256 bits long so this is free
      if (o >= limit) return giveUp()
      continue
    }
    out[o++] = codeLen[sym]! - 1
    if (o >= limit) return giveUp()
    for (const b of bits) {
      out[o++] = b
      if (o >= limit) return giveUp()
    }
  }

  // $65c: the body
  let acc = 0
  let held = 0
  for (const sym of data) {
    const bits = codeBits[sym]!
    const n = codeLen[sym]!
    for (let k = 0; k < n; k++) {
      acc = ((acc << 1) | ((bits[k >> 3]! >> (7 - (k & 7))) & 1)) & 0xff
      if (++held === 8) {
        out[o++] = acc
        held = 0
        if (o >= limit) return giveUp()
      }
    }
  }
  if (held !== 0) {
    // $6a6: the tail bits go to the TOP of the byte, which is what lets the
    // decoder read them with the same shift-left it uses everywhere else
    if (o >= limit) return giveUp()
    out[o++] = (acc << (8 - held)) & 0xff
  }

  if (key !== null) huffCrypt(out, 6, o, key, true)
  return out.subarray(0, o)
}

/**
 * `$73e`, XpkUnpackChunk's worker.
 *
 * The code table is turned back into a binary trie of ten-byte nodes at
 * `$26`, and the arena is exactly 511 of them, which is the most a code over
 * 256 values can need. A node's first word is `$ff00 | symbol` on a leaf and
 * zero on a fork, so `move.w (a2),d3 / bpl` reads the symbol and tests for a
 * leaf in one go.
 */
const huffUnpack = (data: Uint8Array, uLen: number, password?: string): Uint8Array => {
  // $784, before the password is looked at
  if (u16(data, 0) !== 0) throw new XpkError(XPKERR_SUBTOOOLD)

  let body = data.subarray(6)
  if (password !== undefined) {
    const key = huffKey(password)
    // $7ba: the check is over the password alone, so a wrong one is caught
    // before a byte is decoded
    if (huffCheck(key) !== u32(data, 2)) throw new XpkError(XPKERR_BADPASSWORD)
    body = body.slice()
    huffCrypt(body, 0, body.length, key, false)
  }

  // $802: 511 nodes, node 0 being the root
  const NODES = 511
  const left = new Int32Array(NODES).fill(-1)
  const right = new Int32Array(NODES).fill(-1)
  const leaf = new Int32Array(NODES).fill(-1)
  let free = 1
  let p = 0
  for (let sym = 0; sym < 256; sym++) {
    const n = at(body, p++)
    if (n === 0xff) continue // $824, a byte value the chunk never uses
    let node = 0
    let acc = 0
    let held = 0
    for (let k = 0; k <= n; k++) {
      if (held === 0) {
        acc = at(body, p++)
        held = 8
      }
      const kid = (acc & 0x80) !== 0 ? right : left
      acc = (acc << 1) & 0xff
      held--
      if (kid[node] === -1) {
        // DEVIATION: the library has no ceiling here and a table asking for a
        // 512th node writes over the buffer it decrypted into. This is where
        // that stops, and a table that deep cannot have come from $574.
        if (free >= NODES) throw new XpkError(XPKERR_CORRUPTPKD)
        kid[node] = free
        node = free++
      } else {
        node = kid[node]!
      }
    }
    leaf[node] = sym // $872
  }

  const out = new Uint8Array(uLen)
  let o = 0
  let node = 0
  /** one bit down the trie, answering whether it landed on a leaf */
  const step = (bit: number): boolean => {
    node = (bit !== 0 ? right : left)[node]!
    if (node < 0) throw new XpkError(XPKERR_CORRUPTPKD)
    if (leaf[node]! < 0) return false
    // DEVIATION: $8a0 has no bound at all and leans on XPK_MARGIN. Stopping
    // here turns an overrun into the CORRUPTPKD the master would raise anyway.
    if (o >= uLen) throw new XpkError(XPKERR_CORRUPTPKD)
    out[o++] = leaf[node]!
    node = 0
    return true
  }

  // $88a: all but the last body byte, eight bits at a time and no counting
  for (let i = p; i < body.length - 1; i++) {
    const b = at(body, i)
    for (let k = 7; k >= 0; k--) step((b >> k) & 1)
  }

  // $9a4: and the last byte by symbol count instead, because its low bits are
  // the padding $6a6 shifted in. `d0` there is the shortfall the fast loop
  // left, and the `dbra` counts symbols out rather than bits.
  const missing = uLen - o
  let held = 0
  let acc = 0
  let q = Math.max(p, body.length - 1)
  for (let n = 0; n < missing; n++) {
    for (;;) {
      if (held === 0) {
        // a well formed chunk always finishes inside its last byte, so a
        // second refill here means the body was cut short
        if (q > body.length) throw new XpkError(XPKERR_CORRUPTPKD)
        acc = at(body, q++)
        held = 8
      }
      held--
      if (step((acc >> held) & 1)) break
    }
  }
  return out
}

/**
 * `xpkIMPL.library` 0.18.77, the Imploder wearing an XPK coat.
 *
 * Alone among the six, this one does not carry a codec at all. Both entry
 * points copy InBuf to OutBuf (`$1ee`, `CopyMemQuick` and then the odd bytes
 * by hand) and work IN PLACE from there, and a packed chunk is a complete
 * `IMP!` file down to the magic, which `$d60` tests before it will decode.
 * So the codec lives in ../amiga/imploder.ts beside the AMCAF-derived
 * exploder that reads the same format, and this is the wrapper.
 *
 * `xpi_DefChunk` is 65536, over the master's 65000 threshold, so IMPL is the
 * fourth packer here whose streams carry long chunk headers.
 */
const XPK_IMPL: XpkPacker = {
  name: 'IMPL',
  longName: 'Turbo Implode 0.18',
  maxChunk: 524288,
  minChunk: 64,
  defaultChunk: 65536,
  packChunk: (data, mode) => turboImplode(data, implEffort(data.length, mode)),
  unpackChunk: (data, uLen) => implUnpack(data, uLen),
}

/**
 * `$168`, the mode and the chunk length to one of twelve effort levels.
 *
 * Two tables and two rules, and the input length decides as much as the mode
 * does. Both tables descend and both are scanned for the first entry the
 * length reaches, giving an index of 0 for a short chunk and 11 for a long
 * one, so a big chunk gets a wide window whatever the caller asked for.
 *
 * Mode 100 takes the coarser table at `$43a` and is then left alone. Every
 * other mode takes the finer one at `$46a` and is scaled by `mode + 1` per
 * cent, which is why mode 99 and mode 100 are not neighbours: 99 scales an
 * index off one table, 100 reads the other table raw.
 */
const implEffort = (inLen: number, mode: number): number => {
  const pct = mode & 0xffff
  // $43a and $46a. The last entry of each is never compared: the loop runs
  // eleven times and gives up with the index at 0.
  const table =
    pct === 100
      ? [500_000, 195_000, 90_000, 42_000, 19_000, 10_500, 6000, 3400, 1800, 800, 380]
      : [84_224, 45_568, 24_832, 11_520, 6400, 3840, 2048, 1152, 576, 288, 144]
  let n = 0
  for (let i = 0; i < 11; i++) {
    // $1ae is `bcc` and $17c is `bhi`, so mode 100 takes an entry it equals
    // and the others do not
    if (pct === 100 ? inLen >= table[i]! : inLen > table[i]!) {
      n = 11 - i
      break
    }
  }
  // $18a: the split multiply is only there to keep a 32-bit product out of a
  // `mulu.w`, and with n at most 11 the quotient never leaves the low word
  return pct === 100 ? n : Math.floor((n * (pct + 1)) / 100)
}

/** `$224`, which is `$1ee` and then IMPL `$d60` over the copy */
const implUnpack = (data: Uint8Array, uLen: number): Uint8Array => {
  let out: Uint8Array
  try {
    out = explodeChecked(data)
  } catch {
    // $23e: one error for a bad magic, a bad code and a reader that stopped
    // in the wrong place alike
    throw new XpkError(XPKERR_CORRUPTPKD)
  }
  if (out.length !== uLen) throw new XpkError(XPKERR_CORRUPTPKD)
  return out
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
  [XPK_CBR0.name, XPK_CBR0],
  [XPK_BLZW.name, XPK_BLZW],
  [XPK_HUFF.name, XPK_HUFF],
  [XPK_IMPL.name, XPK_IMPL],
])

/**
 * The packers that have no cipher, and answer XPKERR_NOCRYPT to a password.
 *
 * Read from the code rather than from a flag word: NONE's whole pack entry is
 * `moveq #$ef,d0 / rts`, RLEN's touches nothing in XpkSubParams past `$c(a2)`,
 * NUKE's reads `$34(a2)` and then only `(a2)`, `$4`, `$8` and `$c`, and CBR0's
 * reads those same four and nothing else. BLZW adds `$1c(a2)`, the mode, and
 * stops there, and IMPL reads the mode too and then hands `(a2)`, `$4`, `$8`
 * and `$c` to a compressor that takes no key. No password pointer, at
 * `$20(a2)`, is ever fetched by any of them.
 *
 * XpkInfo carries a flags longword ($18 into the struct) whose bit
 * assignments this port has not established. It reads 9 for NONE, RLEN, NUKE
 * and CBR0, $8009 for BLZW and IMPL, and $a009 for HUFF. Bit 13 sits with
 * the one packer here that has a cipher and with none of the six that do not,
 * which is the only reading of that word with evidence behind it.
 */
const XPK_NO_CRYPT = new Set([
  XPK_NONE.name,
  XPK_RLEN.name,
  XPK_NUKE.name,
  XPK_CBR0.name,
  XPK_BLZW.name,
  XPK_IMPL.name,
])

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
    // $648..$660: xsh_SubVrs is the minimum sub-library format version. The
    // master's probe compares it with XpkInfo+2 immediately after opening the
    // method and reports SUBTOOOLD before returning the fib. All bundled
    // packers implement version 1; custom registry entries may say otherwise.
    if (at(data, 34) > (packer.version ?? 1)) throw new XpkError(XPKERR_SUBTOOOLD)
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
  let flags = chunk > XPK_LONGHDR_ABOVE ? XPKSTREAMF_LONGHDRS : 0
  // $10f6: the stream has to say it is encrypted, or nothing on the read side
  // will ask for the password. HUFF is the only packer here that gets this far
  // with one, since XPK_NO_CRYPT turned the other four away above.
  if (password !== undefined) flags |= XPKSTREAMF_PASSWORD
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
  header[34] = packer.version ?? 1 // xsh_SubVrs -- the version of the sub-library this needs
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
