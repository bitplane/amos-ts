/**
 * Baseline JPEG — ISO/IEC 10918-1, Huffman, 8-bit tables.
 *
 * This exists for `opal.library`, whose `SaveJPEG24` writes one and whose
 * `LoadImage24` reads one, but nothing in it knows about OpalVision: it is a
 * plain image codec over RGB triples, so it sits here beside ../amiga/imploder.ts
 * and ../amiga/powerpacker.ts rather than in the extension.
 *
 * ## What the library actually is
 *
 * `opal.library` version 4.3's JPEG code is the Independent JPEG Group's
 * library, v4-era, compiled with SAS/C into the fourth hunk. It is recognisable
 * on sight and then confirmed in detail:
 *
 * - hunk 2 carries the Annex K quantization tables as 16-bit words in zigzag
 *   order, luma at $d41a and chroma at $d49a in the file, byte-identical to the
 *   standard's;
 * - hunk 2 carries all four Annex K Huffman tables, BITS then HUFFVAL, at $d27b;
 * - hunk 3 $2668 is `jpeg_set_quality` to the instruction — clamp to 1..100,
 *   `5000/q` below 50 and `200-2q` at or above it;
 * - hunk 3 $25da is `jpeg_add_quant_table` — `(base*scale + 50)/100`, floor of
 *   1, ceiling of 32767, and a further ceiling of 255 when baseline is forced,
 *   which the caller always does.
 *
 * So the encoder here is not guesswork about a format. Everything the library
 * chooses is read off its own code and reproduced: the tables, the quality law,
 * 4:2:0 sampling, the marker order, and the two odd things it does (below). The
 * one part deliberately NOT reproduced is the forward DCT. Matching IJG's
 * integer DCT bit for bit would make output byte-identical and buys nothing —
 * nothing in this port reads a JPEG back except the decoder below, and both are
 * conformant either way — so `fdct` is a plain separable float transform and
 * output differs from a real Amiga's in the low bits of some coefficients.
 *
 * ## Two things the library does that a reader has to live with
 *
 * The APP0 thumbnail is not a JFIF thumbnail. JFIF says XThumbnail and
 * YThumbnail are followed by `3n` bytes of packed RGB; hunk 3 $1c44 writes 48
 * and 30 and then puts out the four bytes `OVTN` followed by 4320 bytes of
 * OpalVision planar data. The segment length is right — 16 + 4 + 4320 — so a
 * decoder skips it correctly and only the thumbnail image is nonsense. That is
 * why the thumbnail is passed in here as opaque bytes with its own declared
 * size rather than as a picture.
 *
 * And the scan header emits a DHT for every component's DC and AC table rather
 * than for every distinct table, so the two chrominance components redefine
 * tables 1 and 1 twice over: six DHT markers where four would do, about 426
 * bytes of them. Harmless, since a decoder simply loads the same table again.
 * Both are reproduced; ../runtime/opal.ts catalogues them.
 *
 * ## The decoder
 *
 * Wider than the encoder, because it reads other people's files. Baseline and
 * extended sequential, any sampling factors, restart intervals, one component
 * or three, and Y'CbCr, RGB or greyscale as source colour space — which is
 * exactly the AutoDoc's list: *"a baseline loader as specified in the draft
 * standard ISO/IEC Bis 10918-1 it supports only 8 bit quantization tables and
 * Huffman entropy compression. It can load files with source colour space of Y
 * Cb Cr, RGB and Grey scale. It does not support non interleaved files,
 * progressive, hierarchical or lossless modes."* Anything outside that answers
 * null and the caller turns it into an error code.
 */

/** an image the decoder produced, or the encoder consumes: three bytes a pixel */
export interface JpegImage {
  width: number
  height: number
  /** `width * height * 3` bytes, red first */
  pixels: Uint8Array
}

/**
 * The APP0 thumbnail, as bytes rather than as a picture.
 *
 * JFIF wants `3 * x * y` bytes of RGB here and Opal writes something else, so
 * neither the width nor the length is derivable from the other.
 */
export interface App0Thumbnail {
  /** XThumbnail, the byte JFIF puts at APP0+14 */
  x: number
  /** YThumbnail, the byte after it */
  y: number
  /** whatever follows, written and returned untouched */
  data: Uint8Array
}

export interface JpegOptions {
  /** *"(0...100) This determines the amount of loss allowed"* */
  quality: number
  thumbnail?: App0Thumbnail
}

/* -- the tables ----------------------------------------------------------- */

/**
 * Zigzag order: the position in natural row-major order of each successive
 * coefficient in the encoded sequence. Table K.6 of the standard, and the order
 * the library's own quantization tables are stored in.
 */
export const ZIGZAG: readonly number[] = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]

/** Table K.1 — the luminance quantization table, natural order */
export const STD_LUMA_QUANT: readonly number[] = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
]

/** Table K.2 — the chrominance quantization table, natural order */
export const STD_CHROMA_QUANT: readonly number[] = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
]

/** BITS and HUFFVAL for a Huffman table, as the standard's Annex K lists them */
export interface HuffSpec {
  /** sixteen counts: how many codes of each length 1..16 */
  bits: readonly number[]
  values: readonly number[]
}

/** Table K.3 — DC luminance */
export const STD_DC_LUMA: HuffSpec = {
  bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}

/** Table K.4 — DC chrominance */
export const STD_DC_CHROMA: HuffSpec = {
  bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}

/** Table K.5 — AC luminance */
export const STD_AC_LUMA: HuffSpec = {
  bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  values: [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ],
}

/** Table K.6 — AC chrominance */
export const STD_AC_CHROMA: HuffSpec = {
  bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  values: [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
    0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
    0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
    0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
    0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
    0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ],
}

/* -- quality -------------------------------------------------------------- */

/**
 * `jpeg_set_quality`'s scale factor, hunk 3 $2668.
 *
 * *"A factor of 100 corresponds to a quantization table of all 1's and hence
 * has no quantization loss. A value of 50 corresponds to the quantization
 * tables suggested by the draft standard"*, which is what `200 - 2q` gives at
 * 50: a scale of 100, and `(base*100 + 50)/100` is `base`.
 */
export function qualityScale(quality: number): number {
  let q = Math.trunc(quality)
  if (q <= 0) q = 1
  if (q > 100) q = 100
  return q < 50 ? Math.floor(5000 / q) : 200 - q * 2
}

/**
 * `jpeg_add_quant_table`, hunk 3 $25da: scale a base table and clamp it.
 *
 * The 32767 ceiling is the one the routine applies first and it never bites,
 * because the 255 that follows it is unconditional here — the only caller
 * passes `force_baseline` as 1, which is `notb d0` on a zero register.
 */
export function quantTable(base: readonly number[], scale: number): Uint8Array {
  const out = new Uint8Array(64)
  for (let i = 0; i < 64; i++) {
    let v = Math.floor((base[i]! * scale + 50) / 100)
    if (v <= 0) v = 1
    if (v > 32767) v = 32767
    if (v > 255) v = 255
    out[i] = v
  }
  return out
}

/* -- Huffman -------------------------------------------------------------- */

/** the code and its length for each symbol, indexed by symbol value */
interface HuffEncoder {
  codes: Int32Array
  sizes: Int32Array
}

/**
 * Annex C's code assignment: walk the lengths in order, incrementing the code
 * at each symbol and shifting left at each new length.
 */
function buildEncoder(spec: HuffSpec): HuffEncoder {
  const codes = new Int32Array(256)
  const sizes = new Int32Array(256)
  let code = 0
  let k = 0
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < spec.bits[len - 1]!; i++) {
      const sym = spec.values[k++]!
      codes[sym] = code++
      sizes[sym] = len
    }
    code <<= 1
  }
  return { codes, sizes }
}

/**
 * The decoder's form: `mincode`/`maxcode`/`valptr` per length, which is Annex F's
 * DECODE procedure without building a tree. `maxcode` of -1 means no code of
 * that length exists.
 */
interface HuffDecoder {
  mincode: Int32Array
  maxcode: Int32Array
  valptr: Int32Array
  values: Uint8Array
}

function buildDecoder(bits: Uint8Array, values: Uint8Array): HuffDecoder {
  const mincode = new Int32Array(17)
  const maxcode = new Int32Array(17).fill(-1)
  const valptr = new Int32Array(17)
  let code = 0
  let k = 0
  for (let len = 1; len <= 16; len++) {
    const n = bits[len - 1]!
    if (n > 0) {
      valptr[len] = k
      mincode[len] = code
      code += n
      k += n
      maxcode[len] = code - 1
    }
    code <<= 1
  }
  return { mincode, maxcode, valptr, values }
}

/* -- the transform -------------------------------------------------------- */

/** `COS[u][x] = c(u)/2 * cos((2x+1)u*pi/16)`, the separable 8-point kernel */
const COS: Float64Array[] = (() => {
  const t: Float64Array[] = []
  for (let u = 0; u < 8; u++) {
    const row = new Float64Array(8)
    const c = u === 0 ? Math.SQRT1_2 : 1
    for (let x = 0; x < 8; x++) row[x] = (c / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
    t.push(row)
  }
  return t
})()

/** the forward DCT of one level-shifted block, rows then columns */
function fdct(block: Float64Array, out: Float64Array): void {
  const tmp = new Float64Array(64)
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let s = 0
      for (let x = 0; x < 8; x++) s += block[y * 8 + x]! * COS[u]![x]!
      tmp[y * 8 + u] = s
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let s = 0
      for (let y = 0; y < 8; y++) s += tmp[y * 8 + u]! * COS[v]![y]!
      out[v * 8 + u] = s
    }
  }
}

/** its inverse, same shape */
function idct(block: Float64Array, out: Float64Array): void {
  const tmp = new Float64Array(64)
  for (let v = 0; v < 8; v++) {
    for (let x = 0; x < 8; x++) {
      let s = 0
      for (let u = 0; u < 8; u++) s += block[v * 8 + u]! * COS[u]![x]!
      tmp[v * 8 + x] = s
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let s = 0
      for (let v = 0; v < 8; v++) s += tmp[v * 8 + x]! * COS[v]![y]!
      out[y * 8 + x] = s
    }
  }
}

/* -- colour --------------------------------------------------------------- */

const clamp8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v)

/* -- the encoder ---------------------------------------------------------- */

/** a stream of bits, MSB first, with JPEG's `FF 00` stuffing */
class BitWriter {
  private acc = 0
  private n = 0

  constructor(private readonly out: number[]) {}

  put(code: number, size: number): void {
    for (let i = size - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((code >> i) & 1)
      if (++this.n === 8) {
        const b = this.acc & 0xff
        this.out.push(b)
        // "a X'00' byte is stuffed after any X'FF' byte" -- F.1.2.3
        if (b === 0xff) this.out.push(0x00)
        this.acc = 0
        this.n = 0
      }
    }
  }

  /** pad the last byte with 1 bits, as the standard requires */
  flush(): void {
    while (this.n !== 0) this.put(1, 1)
  }
}

/** how many bits a coefficient needs, which is also its Huffman category */
function category(v: number): number {
  let a = v < 0 ? -v : v
  let n = 0
  while (a !== 0) {
    a >>= 1
    n++
  }
  return n
}

/**
 * Encode one block's zigzagged coefficients and answer the new DC predictor.
 *
 * A negative value is sent as its one's complement in `size` bits, which is
 * what `v - 1` gives once masked.
 */
function encodeBlock(
  bw: BitWriter,
  zz: Int32Array,
  dcTbl: HuffEncoder,
  acTbl: HuffEncoder,
  prevDc: number,
): number {
  const diff = zz[0]! - prevDc
  const dcSize = category(diff)
  bw.put(dcTbl.codes[dcSize]!, dcTbl.sizes[dcSize]!)
  if (dcSize > 0) bw.put((diff < 0 ? diff - 1 : diff) & ((1 << dcSize) - 1), dcSize)

  let last = 0
  for (let k = 63; k >= 1; k--) {
    if (zz[k] !== 0) {
      last = k
      break
    }
  }
  let run = 0
  for (let k = 1; k <= last; k++) {
    const v = zz[k]!
    if (v === 0) {
      run++
      continue
    }
    while (run > 15) {
      bw.put(acTbl.codes[0xf0]!, acTbl.sizes[0xf0]!)
      run -= 16
    }
    const size = category(v)
    const sym = (run << 4) | size
    bw.put(acTbl.codes[sym]!, acTbl.sizes[sym]!)
    bw.put((v < 0 ? v - 1 : v) & ((1 << size) - 1), size)
    run = 0
  }
  if (last < 63) bw.put(acTbl.codes[0]!, acTbl.sizes[0]!)
  return zz[0]!
}

/**
 * `SaveJPEG24`'s file, as bytes.
 *
 * Three components at 4:2:0 — hunk 3 $2740 fills the component array with
 * `{id 1, quant 0, 2x2, tables 0/0}`, `{id 2, quant 1, 1x1, tables 1/1}` and
 * `{id 3, quant 1, 1x1, tables 1/1}` — so an MCU is sixteen pixels square and
 * carries four luminance blocks and one of each chrominance.
 *
 * Edge MCUs are filled by replicating the last real column and row, and the
 * decoder throws the padding away again on the strength of the SOF dimensions.
 */
export function encodeJpeg(
  pixels: Uint8Array,
  width: number,
  height: number,
  opts: JpegOptions,
): Uint8Array {
  const out: number[] = []
  const put = (...b: number[]): void => {
    for (const v of b) out.push(v & 0xff)
  }
  const put16 = (v: number): void => {
    out.push((v >>> 8) & 0xff, v & 0xff)
  }
  const marker = (code: number): void => put(0xff, code)

  const scale = qualityScale(opts.quality)
  const qLuma = quantTable(STD_LUMA_QUANT, scale)
  const qChroma = quantTable(STD_CHROMA_QUANT, scale)

  marker(0xd8) // SOI

  // APP0. The length counts itself, the twelve fixed bytes and the thumbnail,
  // and the thumbnail is whatever the caller handed over -- see the header
  marker(0xe0)
  const thumb = opts.thumbnail
  put16(16 + (thumb ? thumb.data.length : 0))
  put(0x4a, 0x46, 0x49, 0x46, 0x00) // "JFIF\0"
  put(1, 1) // version 1.1
  put(0) // density_unit: none
  put16(1) // X_density
  put16(1) // Y_density
  put(thumb ? thumb.x : 0, thumb ? thumb.y : 0)
  if (thumb) for (const b of thumb.data) out.push(b)

  // DQT, one table to a marker, in table-number order
  for (const [id, table] of [
    [0, qLuma],
    [1, qChroma],
  ] as const) {
    marker(0xdb)
    put16(67)
    put(id) // Pq = 0, eight-bit, in the high nibble
    for (let i = 0; i < 64; i++) put(table[ZIGZAG[i]!]!)
  }

  // SOF0
  marker(0xc0)
  put16(8 + 3 * 3)
  put(8) // sample precision
  put16(height)
  put16(width)
  put(3)
  put(1, 0x22, 0) // Y, 2x2, quantization table 0
  put(2, 0x11, 1) // Cb, 1x1, table 1
  put(3, 0x11, 1) // Cr, 1x1, table 1

  // DHT. Per component and not per table, so tables 1 and 1 go out three times
  // between them -- reproduced from hunk 3 $1dba; see the header
  const specs: ReadonlyArray<readonly [number, number, HuffSpec]> = [
    [0, 0, STD_DC_LUMA],
    [1, 0, STD_AC_LUMA],
    [0, 1, STD_DC_CHROMA],
    [1, 1, STD_AC_CHROMA],
    [0, 1, STD_DC_CHROMA],
    [1, 1, STD_AC_CHROMA],
  ]
  for (const [cls, id, spec] of specs) {
    marker(0xc4)
    put16(2 + 1 + 16 + spec.values.length)
    put((cls << 4) | id)
    for (const b of spec.bits) put(b)
    for (const v of spec.values) put(v)
  }

  // SOS
  marker(0xda)
  put16(6 + 2 * 3)
  put(3)
  put(1, 0x00) // Y: DC table 0, AC table 0
  put(2, 0x11)
  put(3, 0x11)
  put(0, 63, 0) // Ss, Se, Ah/Al

  const dcLuma = buildEncoder(STD_DC_LUMA)
  const acLuma = buildEncoder(STD_AC_LUMA)
  const dcChroma = buildEncoder(STD_DC_CHROMA)
  const acChroma = buildEncoder(STD_AC_CHROMA)

  // Y at full resolution, Cb and Cr box-averaged 2x2, both padded out to whole
  // MCUs by edge replication before anything else touches them
  const mcusX = Math.ceil(width / 16)
  const mcusY = Math.ceil(height / 16)
  const padW = mcusX * 16
  const padH = mcusY * 16
  const y = new Float64Array(padW * padH)
  const cb = new Float64Array((padW >> 1) * (padH >> 1))
  const cr = new Float64Array((padW >> 1) * (padH >> 1))
  for (let j = 0; j < padH; j++) {
    const sy = j < height ? j : height - 1
    for (let i = 0; i < padW; i++) {
      const sx = i < width ? i : width - 1
      const p = (sy * width + sx) * 3
      const r = pixels[p] ?? 0
      const g = pixels[p + 1] ?? 0
      const b = pixels[p + 2] ?? 0
      y[j * padW + i] = 0.299 * r + 0.587 * g + 0.114 * b
      const half = (j >> 1) * (padW >> 1) + (i >> 1)
      cb[half] = (cb[half] ?? 0) + (-0.168736 * r - 0.331264 * g + 0.5 * b + 128) / 4
      cr[half] = (cr[half] ?? 0) + (0.5 * r - 0.418688 * g - 0.081312 * b + 128) / 4
    }
  }

  const bw = new BitWriter(out)
  const block = new Float64Array(64)
  const coefs = new Float64Array(64)
  const zz = new Int32Array(64)
  let dcY = 0
  let dcCb = 0
  let dcCr = 0

  const doBlock = (
    plane: Float64Array,
    stride: number,
    x0: number,
    y0: number,
    q: Uint8Array,
    dc: HuffEncoder,
    ac: HuffEncoder,
    prev: number,
  ): number => {
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) block[j * 8 + i] = plane[(y0 + j) * stride + x0 + i]! - 128
    }
    fdct(block, coefs)
    for (let k = 0; k < 64; k++) {
      const n = ZIGZAG[k]!
      zz[k] = Math.round(coefs[n]! / q[n]!)
    }
    return encodeBlock(bw, zz, dc, ac, prev)
  }

  const halfW = padW >> 1
  for (let my = 0; my < mcusY; my++) {
    for (let mx = 0; mx < mcusX; mx++) {
      for (let by = 0; by < 2; by++) {
        for (let bx = 0; bx < 2; bx++) {
          dcY = doBlock(y, padW, mx * 16 + bx * 8, my * 16 + by * 8, qLuma, dcLuma, acLuma, dcY)
        }
      }
      dcCb = doBlock(cb, halfW, mx * 8, my * 8, qChroma, dcChroma, acChroma, dcCb)
      dcCr = doBlock(cr, halfW, mx * 8, my * 8, qChroma, dcChroma, acChroma, dcCr)
    }
  }
  bw.flush()

  marker(0xd9) // EOI
  return Uint8Array.from(out)
}

/* -- the decoder ---------------------------------------------------------- */

interface Component {
  id: number
  h: number
  v: number
  quant: number
  dcTbl: number
  acTbl: number
  /** the component's own sample grid, `blocksX*8` by `blocksY*8` */
  samples: Uint8Array
  blocksX: number
  blocksY: number
  pred: number
}

/**
 * Walk a JPEG's markers without decoding it, answering the APP0 thumbnail if
 * there is one.
 *
 * `DisplayThumbnail24` needs this and nothing else, and it needs the bytes
 * exactly as written, because what Opal puts there is an `OVTN` chunk and not
 * the RGB the segment claims.
 */
export function findApp0Thumbnail(data: Uint8Array): App0Thumbnail | null {
  if (data[0] !== 0xff || data[1] !== 0xd8) return null
  let p = 2
  while (p + 4 <= data.length) {
    if (data[p] !== 0xff) return null
    const code = data[p + 1]!
    if (code === 0xd8 || code === 0xd9 || (code >= 0xd0 && code <= 0xd7)) {
      p += 2
      continue
    }
    const len = ((data[p + 2]! << 8) | data[p + 3]!) >>> 0
    if (len < 2 || p + 2 + len > data.length) return null
    if (code === 0xe0 && len > 16) {
      const at = p + 4
      const jfif = data[at] === 0x4a && data[at + 1] === 0x46 && data[at + 2] === 0x49
      if (jfif && data[at + 3] === 0x46 && data[at + 4] === 0x00) {
        const x = data[at + 12]!
        const y = data[at + 13]!
        if (x !== 0 && y !== 0) {
          return { x, y, data: data.slice(at + 14, p + 2 + len) }
        }
      }
    }
    // no thumbnail can appear after the scan starts
    if (code === 0xda) return null
    p += 2 + len
  }
  return null
}

/**
 * Decode a baseline JPEG to RGB, or null if it is one this cannot read.
 *
 * Null covers every restriction in the AutoDoc's list and the malformed cases
 * with it, because the caller has only the one error code to answer with.
 */
export function decodeJpeg(data: Uint8Array): JpegImage | null {
  if (data[0] !== 0xff || data[1] !== 0xd8) return null

  const quant: (Uint16Array | null)[] = [null, null, null, null]
  const dcTables: (HuffDecoder | null)[] = [null, null, null, null]
  const acTables: (HuffDecoder | null)[] = [null, null, null, null]
  let frameW = 0
  let frameH = 0
  let comps: Component[] = []
  let restartInterval = 0
  /** the Adobe APP14 colour transform, -1 when the marker is absent */
  let adobe = -1
  let progressive = false

  let p = 2
  while (p + 2 <= data.length) {
    if (data[p] !== 0xff) return null
    const code = data[p + 1]!
    p += 2
    if (code === 0xd9) break
    if (code === 0x01 || (code >= 0xd0 && code <= 0xd7)) continue
    if (p + 2 > data.length) return null
    const len = (data[p]! << 8) | data[p + 1]!
    if (len < 2 || p + len > data.length) return null
    const at = p + 2
    const end = p + len

    switch (code) {
      case 0xdb: {
        // DQT. "supports only 8 bit quantization tables"
        let q = at
        while (q < end) {
          const pq = data[q]! >> 4
          const tq = data[q]! & 15
          q++
          if (pq !== 0 || tq > 3) return null
          if (q + 64 > end) return null
          const t = new Uint16Array(64)
          for (let i = 0; i < 64; i++) t[ZIGZAG[i]!] = data[q + i]!
          quant[tq] = t
          q += 64
        }
        break
      }
      case 0xc4: {
        // DHT
        let q = at
        while (q + 17 <= end) {
          const tc = data[q]! >> 4
          const th = data[q]! & 15
          q++
          if (tc > 1 || th > 3) return null
          const bits = data.slice(q, q + 16)
          q += 16
          let total = 0
          for (const b of bits) total += b
          if (total > 256 || q + total > end) return null
          const values = data.slice(q, q + total)
          q += total
          const table = buildDecoder(bits, values)
          if (tc === 0) dcTables[th] = table
          else acTables[th] = table
        }
        break
      }
      case 0xdd:
        restartInterval = (data[at]! << 8) | data[at + 1]!
        break
      case 0xee:
        // Adobe APP14: the last byte is the colour transform
        if (len >= 14 && String.fromCharCode(...data.slice(at, at + 5)) === 'Adobe') {
          adobe = data[end - 1]!
        }
        break
      case 0xc0:
      case 0xc1: {
        // SOF0 baseline, SOF1 extended sequential -- both Huffman, both read
        if (data[at] !== 8) return null // "8 bit quantization tables", 8-bit samples
        frameH = (data[at + 1]! << 8) | data[at + 2]!
        frameW = (data[at + 3]! << 8) | data[at + 4]!
        const n = data[at + 5]!
        if (frameW === 0 || frameH === 0 || (n !== 1 && n !== 3)) return null
        comps = []
        for (let i = 0; i < n; i++) {
          const o = at + 6 + i * 3
          const h = data[o + 1]! >> 4
          const v = data[o + 1]! & 15
          if (h < 1 || h > 4 || v < 1 || v > 4) return null
          comps.push({
            id: data[o]!,
            h,
            v,
            quant: data[o + 2]!,
            dcTbl: 0,
            acTbl: 0,
            samples: new Uint8Array(0),
            blocksX: 0,
            blocksY: 0,
            pred: 0,
          })
        }
        break
      }
      case 0xc2:
      case 0xc3:
      case 0xc5:
      case 0xc6:
      case 0xc7:
      case 0xc9:
      case 0xca:
      case 0xcb:
      case 0xcd:
      case 0xce:
      case 0xcf:
        // progressive, lossless, hierarchical and the arithmetic-coded forms
        progressive = true
        break
      case 0xda: {
        if (progressive || comps.length === 0) return null
        const ns = data[at]!
        // "It does not support non interleaved files"
        if (ns !== comps.length) return null
        for (let i = 0; i < ns; i++) {
          const cs = data[at + 1 + i * 2]!
          const c = comps.find((x) => x.id === cs)
          if (!c) return null
          c.dcTbl = data[at + 2 + i * 2]! >> 4
          c.acTbl = data[at + 2 + i * 2]! & 15
        }
        const scanned = decodeScan(
          data,
          end,
          comps,
          quant,
          dcTables,
          acTables,
          frameW,
          frameH,
          restartInterval,
        )
        if (scanned === null) return null
        return assemble(comps, frameW, frameH, adobe)
      }
      default:
        break
    }
    p = end
  }
  return null
}

/**
 * The entropy-coded segment.
 *
 * Every component gets a sample plane rounded up to whole MCUs; the trimming
 * back to the frame's real width and height happens in `assemble`.
 */
function decodeScan(
  data: Uint8Array,
  start: number,
  comps: Component[],
  quant: (Uint16Array | null)[],
  dcTables: (HuffDecoder | null)[],
  acTables: (HuffDecoder | null)[],
  frameW: number,
  frameH: number,
  restartInterval: number,
): true | null {
  let hMax = 1
  let vMax = 1
  for (const c of comps) {
    if (c.h > hMax) hMax = c.h
    if (c.v > vMax) vMax = c.v
  }
  const mcusX = Math.ceil(frameW / (hMax * 8))
  const mcusY = Math.ceil(frameH / (vMax * 8))
  for (const c of comps) {
    c.blocksX = mcusX * c.h
    c.blocksY = mcusY * c.v
    c.samples = new Uint8Array(c.blocksX * 8 * c.blocksY * 8)
    c.pred = 0
  }

  let p = start
  let bitBuf = 0
  let bitCount = 0

  /** one bit of the entropy stream, unstuffing `FF 00` and stopping at a marker */
  const bit = (): number => {
    if (bitCount === 0) {
      if (p >= data.length) return 0
      let b = data[p++]!
      if (b === 0xff) {
        const next = data[p] ?? 0xd9
        if (next === 0x00) p++
        else {
          // a real marker: leave it where it is and feed zeroes from here on,
          // which is how a truncated or over-read scan degrades quietly
          p--
          b = 0
        }
      }
      bitBuf = b
      bitCount = 8
    }
    bitCount--
    return (bitBuf >> bitCount) & 1
  }
  const bits = (n: number): number => {
    let v = 0
    for (let i = 0; i < n; i++) v = (v << 1) | bit()
    return v
  }
  const decode = (t: HuffDecoder): number => {
    let code = bit()
    let len = 1
    while (len <= 16) {
      if (t.maxcode[len]! >= 0 && code <= t.maxcode[len]!) {
        return t.values[t.valptr[len]! + code - t.mincode[len]!] ?? 0
      }
      code = (code << 1) | bit()
      len++
    }
    return 0
  }
  /** F.2.2.1's EXTEND: sign-extend an `n`-bit magnitude */
  const extend = (v: number, n: number): number =>
    n === 0 ? 0 : v < 1 << (n - 1) ? v - (1 << n) + 1 : v

  const coefs = new Float64Array(64)
  const out = new Float64Array(64)

  let sinceRestart = 0
  for (let my = 0; my < mcusY; my++) {
    for (let mx = 0; mx < mcusX; mx++) {
      if (restartInterval !== 0 && sinceRestart === restartInterval) {
        // byte-align, step over RSTn, and reset every predictor
        bitCount = 0
        while (
          p + 1 < data.length &&
          data[p] === 0xff &&
          data[p + 1]! >= 0xd0 &&
          data[p + 1]! <= 0xd7
        ) {
          p += 2
        }
        for (const c of comps) c.pred = 0
        sinceRestart = 0
      }
      sinceRestart++
      for (const c of comps) {
        const q = quant[c.quant]
        const dc = dcTables[c.dcTbl]
        const ac = acTables[c.acTbl]
        if (!q || !dc || !ac) return null
        for (let by = 0; by < c.v; by++) {
          for (let bx = 0; bx < c.h; bx++) {
            coefs.fill(0)
            const t = decode(dc)
            const diff = t === 0 ? 0 : extend(bits(t), t)
            c.pred += diff
            coefs[0] = c.pred * q[0]!
            let k = 1
            while (k < 64) {
              const rs = decode(ac)
              const r = rs >> 4
              const s = rs & 15
              if (s === 0) {
                if (r !== 15) break
                k += 16
                continue
              }
              k += r
              if (k > 63) break
              const n = ZIGZAG[k]!
              coefs[n] = extend(bits(s), s) * q[n]!
              k++
            }
            idct(coefs, out)
            const px = (mx * c.h + bx) * 8
            const py = (my * c.v + by) * 8
            const stride = c.blocksX * 8
            for (let j = 0; j < 8; j++) {
              for (let i = 0; i < 8; i++) {
                c.samples[(py + j) * stride + px + i] = clamp8(Math.round(out[j * 8 + i]! + 128))
              }
            }
          }
        }
      }
    }
  }
  return true
}

/**
 * Upsample every component to the frame grid and convert to RGB.
 *
 * Upsampling is replication, which is what a baseline decoder is expected to
 * do and what the standard's own informative text describes.
 *
 * Three components are Y'CbCr unless the file says otherwise: an Adobe APP14
 * transform of 0 means the samples are already RGB, and so do component ids
 * 'R', 'G' and 'B', which is how a JFIF-less RGB file identifies itself.
 */
function assemble(comps: Component[], width: number, height: number, adobe: number): JpegImage {
  const pixels = new Uint8Array(width * height * 3)
  let hMax = 1
  let vMax = 1
  for (const c of comps) {
    if (c.h > hMax) hMax = c.h
    if (c.v > vMax) vMax = c.v
  }
  const sample = (c: Component, x: number, y: number): number => {
    const sx = Math.min(((x * c.h) / hMax) | 0, c.blocksX * 8 - 1)
    const sy = Math.min(((y * c.v) / vMax) | 0, c.blocksY * 8 - 1)
    return c.samples[sy * c.blocksX * 8 + sx]!
  }

  if (comps.length === 1) {
    const c = comps[0]!
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = sample(c, x, y)
        const o = (y * width + x) * 3
        pixels[o] = v
        pixels[o + 1] = v
        pixels[o + 2] = v
      }
    }
    return { width, height, pixels }
  }

  const rgb =
    adobe === 0 || (comps[0]!.id === 0x52 && comps[1]!.id === 0x47 && comps[2]!.id === 0x42)
  const [c0, c1, c2] = comps as [Component, Component, Component]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = sample(c0, x, y)
      const b = sample(c1, x, y)
      const c = sample(c2, x, y)
      const o = (y * width + x) * 3
      if (rgb) {
        pixels[o] = a
        pixels[o + 1] = b
        pixels[o + 2] = c
      } else {
        const cb = b - 128
        const cr = c - 128
        pixels[o] = clamp8(Math.round(a + 1.402 * cr))
        pixels[o + 1] = clamp8(Math.round(a - 0.344136 * cb - 0.714136 * cr))
        pixels[o + 2] = clamp8(Math.round(a + 1.772 * cb))
      }
    }
  }
  return { width, height, pixels }
}
