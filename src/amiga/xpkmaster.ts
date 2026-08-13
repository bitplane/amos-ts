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
 * corpus. Zero XPKF files do.** So the kind-2 container below is read off the
 * binary in both directions and is mutually consistent — the writer at `$1260`
 * lays down exactly what the reader at `$e04` takes apart — but no shipped
 * artefact confirms it, and a round-trip test only proves this file agrees
 * with itself. That is a weaker claim than the rest of this directory makes
 * and it is deliberately stated rather than buried.
 *
 * The XPKF count was re-checked on 2026-08-13 rather than assumed. Twenty-one
 * corpus files contain those four bytes and not one is a stream: the master
 * itself in six copies, `C/STP` in three, Explode's library, source and Dok,
 * the checksum index, and seven AMOS programs and banks that carry the string
 * as data. `spinvaders.AMOS` opens "AMOS Basic V1.00", `mus1.abk` opens
 * "AmBs", `files.mod` opens `$000003f3`.
 *
 * ## The compressors that are here
 *
 * `XPK_PACKERS` is the registry standing in for `LIBS:Compressors/`, and both
 * entries in it are ported whole from the binary rather than stubbed.
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
 * Every other method resolves through `OpenLibrary("compressors/xpk%.4s.library")`
 * at `$c9a`, and when that fails the master sets XPKERR_MISSINGLIB and gives
 * up. That is what this port does for NUKE, HUFF, BLZW, FEAL, IDEA, IMPL and
 * CBR0, and it is not a shortcut — it is what a real Amiga does with an empty
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
  /** the human name the master would have read out of the packer's XpkInfo */
  readonly longName: string
  /** largest chunk this packer accepts, if it narrows the master's 32768 */
  readonly maxChunk?: number
  /** `null` means XPKERR_EXPANSION — store this chunk raw instead */
  packChunk(data: Uint8Array, mode: number, password?: string): Uint8Array | null
  unpackChunk(data: Uint8Array, uLen: number, password?: string): Uint8Array
}

/**
 * `xpkNONE.library` 1.0, whole.
 *
 * `XpkPackerInfo` (`$17c`) points at a static XpkInfo in its data hunk; the
 * two entries the master calls are the entire algorithm.
 */
const XPK_NONE: XpkPacker = {
  name: 'NONE',
  longName: 'No compression',
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
  // XpkInfo+$1c and +$24, both 32000. The master reads +$24 as the chunk size
  // it wants ($a7e, falling back to $8000 when zero) and then clamps it to
  // +$1c ($ac2). +$20, the minimum, is zero.
  maxChunk: 32000,
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
 * The modelled `LIBS:Compressors/`.
 *
 * A caller may add to this. Anything absent gets XPKERR_MISSINGLIB, which is
 * what `$c9a` sets when its `OpenLibrary` returns zero.
 */
export const XPK_PACKERS = new Map<string, XpkPacker>([
  [XPK_NONE.name, XPK_NONE],
  [XPK_RLEN.name, XPK_RLEN],
])

/**
 * The packers that have no cipher, and answer XPKERR_NOCRYPT to a password.
 *
 * Read from the code rather than from a flag word: NONE's whole pack entry is
 * `moveq #$ef,d0 / rts`, and RLEN's touches nothing in XpkSubParams past
 * `$c(a2)` — no password pointer is ever fetched by either. XpkInfo carries
 * a flags longword ($18 into the struct, 9 for RLEN) whose bit assignments
 * this port has not established, so it is not what this decision rests on.
 */
const XPK_NO_CRYPT = new Set([XPK_NONE.name, XPK_RLEN.name])

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
 * NOTE: the master takes its chunk size from the packer's XpkInfo when that
 * is narrower than its own 32768 (`$abe`). NONE does not narrow it, so this
 * writes 32768-byte chunks and stays in the word-length header form -- which
 * is the shape the reader above is exercised on.
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

  const chunk = Math.min(XPK_DEFAULT_CHUNK, packer.maxChunk ?? XPK_DEFAULT_CHUNK)
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
