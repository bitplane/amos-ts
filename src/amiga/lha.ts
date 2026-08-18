/**
 * LHA: the archive every Aminet package is, and the lh5 codec inside it.
 *
 * The thing this port needed and did not have. `../runtime/archive.ts` reads
 * ZIP, TAR and ADF, and the entire Amiga software record ships as `.lha`, so
 * loading anything off Aminet meant a shell and a tool rather than the
 * machine doing it.
 *
 * ## Where the numbers come from, and where they do not
 *
 * The WINDOW SIZES are read out of `xadmaster.library` 12.1, at
 * `fixtures/aminet/xad/xad/Libs/xadmaster.library`. Its method dispatch at
 * $13290 is one `subi.l #$2d6c6831,d0` (`-lh1`) followed by seven `subq.l
 * #$1`, and every arm sets `$8(a4)` to a BIT COUNT which $133b6 turns into a
 * length with `bset d0,d1`:
 *
 *     $13272  move.w #$d,$8(a4)   the default, so -lh2 -lh3 -lh5   8192
 *     $132dc  move.w #$c,$8(a4)   -lh1                             4096
 *     $13346  move.w #$c,$8(a4)   -lh4                             4096
 *     $1334e  move.w #$f,$8(a4)   -lh6                            32768
 *     $13356  move.w #$10,$8(a4)  -lh7                            65536
 *     $1335e  move.w #$11,$8(a4)  -lh8                           131072
 *     $13366  move.w #$b,$8(a4)   -lzs                             2048
 *     $13384  move.w #$c,$8(a4)   -lz5                             4096
 *
 * THE REST OF lh5 IS NOT PORTED FROM ANYTHING. Stöcker's decoder lives inside
 * that same binary as code rather than as tables, because lh5 carries its
 * Huffman lengths in each block and has no static table to lift. What is
 * below is the published lh5 algorithm written out, and the honest name for
 * that is an implementation rather than a port.
 *
 * That is why the tests matter more here than usual, and why they are
 * oracle tests rather than round-trips. `lha.corpus.test.ts` reads real
 * archives and compares against `lhasa`, Simon Howard's implementation, which
 * is on this machine and is not derived from this one. A round-trip against
 * our own encoder would agree with itself.
 *
 * `ancient` is NOT that oracle and cannot be. Its `LHDecompressor` is for XPK
 * sub-formats — its own strings say `XPK-LHLB` and `XPK-CRM2: Crunch-Mania
 * LZH-mode` — and it has no LHA support at all. Feeding it a bare `-lh5-`
 * stream sliced out of a real archive answers "Unknown or invalid compression
 * format", because it identifies by magic and an lh5 stream has none. Written
 * down because the obvious next idea is to reach for it.
 */

/** THRESHOLD: the shortest match, so a length symbol of 256 means three bytes */
const THRESHOLD = 3
/** the longest match */
const MAXMATCH = 256
/** NC: 256 literals plus every match length */
const NC = 255 + MAXMATCH + 2 - THRESHOLD
/** NT: the code-length alphabet, 0..18 */
const NT = 19
/** CBIT/TBIT: the widths the two table sizes are written in */
const CBIT = 9
const TBIT = 5

/**
 * Window bits per method, from the dispatch quoted above.
 *
 * `-lh8` at 17 is the one to distrust. Nothing else here documents it, no
 * LHA archive in the corpus uses it, and 131072 is twice lh7's. It is
 * recorded because the binary says so, and `decode` refuses it rather than
 * guessing at a format nothing can check.
 */
export const WINDOW_BITS: Readonly<Record<string, number>> = {
  '-lh0-': 0, // stored, no window
  '-lh1-': 12,
  '-lh2-': 13,
  '-lh3-': 13,
  '-lh4-': 12,
  '-lh5-': 13,
  '-lh6-': 15,
  '-lh7-': 16,
  '-lh8-': 17,
  '-lzs-': 11,
  '-lz4-': 0, // stored, as -lh0- is
  '-lz5-': 12,
}

/** the methods this file decodes; the rest are recognised and refused */
export const DECODES: ReadonlySet<string> = new Set(['-lh0-', '-lz4-', '-lh4-', '-lh5-', '-lh6-', '-lh7-'])

/** one member of an archive */
export interface LhaEntry {
  /** the path as stored, with its separators already turned into `/` */
  path: string
  /** the five-byte method id, "-lh5-" */
  method: string
  /** compressed length */
  packedSize: number
  /** decompressed length */
  size: number
  /** the CRC16 the header claims */
  crc: number
  /** header level, 0 1 or 2 */
  level: number
  /** where the compressed bytes start in the archive */
  dataOffset: number
  /** MS-DOS or UNIX time, as stored; not decoded here */
  timestamp: number
}

const u16 = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8)
const u32 = (b: Uint8Array, at: number): number => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0

/**
 * The stored name: separators normalised, and everything from the first NUL
 * dropped.
 *
 * That NUL is not padding. AmigaDOS LHA writers put the file's COMMENT in the
 * name field behind it, so `MEDExt71/Libs/medplayer.library\0Version 7.0` is
 * one name and one comment rather than a corrupt name. MED_7.1.lha decoded
 * perfectly and matched nothing until this was noticed, because every path
 * carried a comment: "HF3", "Ram Disk", "MED Extension V7.0 by Haiko Lemser".
 */
function pathOf(raw: string): string {
  const nul = raw.indexOf('\0')
  return (nul >= 0 ? raw.slice(0, nul) : raw).replace(/\\/g, '/')
}

/**
 * Walk an archive's headers.
 *
 * Levels 0, 1 and 2 differ in where the header ends and, for level 1, in the
 * fact that the extended headers are counted INSIDE the compressed size. That
 * last is the trap: a walker that trusts `packedSize` without subtracting
 * what the extensions took lands in the middle of the next member's data.
 *
 * A malformed archive ends the walk rather than throwing, so a truncated
 * download yields the members it did get.
 */
export function readLhaHeaders(b: Uint8Array): LhaEntry[] {
  const out: LhaEntry[] = []
  let at = 0
  while (at + 21 < b.length) {
    const level = b[at + 20]!
    const method = String.fromCharCode(...b.subarray(at + 2, at + 7))
    if (!/^-l[hz][0-9s]-$/.test(method)) break
    const packedSize = u32(b, at + 7)
    const size = u32(b, at + 11)
    const timestamp = u32(b, at + 15)

    let dataOffset: number
    let dataLen = packedSize
    let path: string

    if (level === 0 || level === 1) {
      const headerLen = b[at]!
      if (headerLen === 0) break
      const nameLen = b[at + 21]!
      path = pathOf(String.fromCharCode(...b.subarray(at + 22, at + 22 + nameLen)))
      if (level === 1) {
        /*
         * Level 1's header-size field SWALLOWS the first extension-size word,
         * so the chain begins at `at + headerLen` and not two bytes past the
         * base header the way level 0's data does. Getting this wrong lands
         * two bytes inside the first extension, reads a length out of file
         * data, and walks off into the archive: TFMX.lha, whose chain is a
         * bare terminator, listed zero members until this was fixed.
         */
        let ext = at + headerLen
        let took = 0
        for (;;) {
          if (ext + 2 > b.length) return out
          const next = u16(b, ext)
          if (next === 0) {
            // the terminator sits inside the base header, so it is NOT part
            // of the skip size; counting it leaves every member two bytes
            // short and walks the next header two bytes late
            ext += 2
            break
          }
          ext += next
          took += next
        }
        dataOffset = ext
        dataLen = packedSize - took
      } else {
        dataOffset = at + headerLen + 2
      }
    } else if (level === 2) {
      const headerLen = u16(b, at)
      if (headerLen === 0) break
      path = ''
      // the filename arrives as extended header 1, the directory as 2
      let ext = at + 24
      let dir = ''
      for (;;) {
        if (ext + 3 > b.length) break
        const next = u16(b, ext)
        if (next === 0) break
        const kind = b[ext + 2]!
        const body = String.fromCharCode(...b.subarray(ext + 3, ext + next))
        if (kind === 1) path = body
        if (kind === 2) dir = pathOf(body.replace(/\xff/g, '/'))
        ext += next
      }
      path = pathOf(dir === '' ? path : `${dir.replace(/\/$/, '')}/${path}`)
      dataOffset = at + headerLen
    } else {
      break
    }

    if (dataOffset + dataLen > b.length || dataLen < 0) break
    out.push({
      path,
      method,
      packedSize: dataLen,
      size,
      crc: level === 2 ? u16(b, at + 22) : 0,
      level,
      dataOffset,
      timestamp,
    })
    at = dataOffset + dataLen
  }
  return out
}

/** MSB-first bit reader, which is the order every LHA field is written in */
class Bits {
  private at = 0
  private bit = 0
  constructor(private readonly b: Uint8Array) {}

  /** one bit, zero past the end so a truncated stream decodes to garbage rather than throwing */
  read1(): number {
    if (this.at >= this.b.length) return 0
    const v = (this.b[this.at]! >> (7 - this.bit)) & 1
    if (++this.bit === 8) {
      this.bit = 0
      this.at++
    }
    return v
  }

  read(n: number): number {
    let v = 0
    for (let i = 0; i < n; i++) v = (v << 1) | this.read1()
    return v
  }

  /** the next `n` bits without consuming them, which read_pt_len needs */
  peek(n: number): number {
    const at = this.at
    const bit = this.bit
    const v = this.read(n)
    this.at = at
    this.bit = bit
    return v
  }

  skip(n: number): void {
    for (let i = 0; i < n; i++) this.read1()
  }
}

/**
 * A canonical Huffman decoder built from code LENGTHS.
 *
 * LHA's own `make_table` builds a flat lookup table for speed. This walks the
 * tree a bit at a time instead, which decodes the same codes because a
 * canonical code is defined by its lengths alone, and is far easier to be
 * sure of. A length of zero means the symbol is absent.
 *
 * `single` is the degenerate table LHA writes when a block uses one symbol
 * throughout: the count field is zero and the symbol follows, and every code
 * decodes to it without consuming a bit.
 */
class Huff {
  private readonly first: number[] = []
  private readonly index: number[] = []
  private readonly symbols: number[] = []
  private readonly maxLen: number

  constructor(
    lengths: readonly number[],
    private readonly single: number = -1,
  ) {
    let max = 0
    for (const l of lengths) if (l > max) max = l
    this.maxLen = max
    const count = new Array<number>(max + 1).fill(0)
    for (const l of lengths) if (l > 0) count[l]!++
    let code = 0
    let k = 0
    for (let len = 1; len <= max; len++) {
      this.first[len] = code
      this.index[len] = k
      for (let s = 0; s < lengths.length; s++) if (lengths[s] === len) this.symbols[k++] = s
      code = (code + count[len]!) << 1
    }
  }

  decode(bits: Bits): number {
    if (this.single >= 0) return this.single
    let code = 0
    for (let len = 1; len <= this.maxLen; len++) {
      code = (code << 1) | bits.read1()
      const first = this.first[len]
      if (first === undefined) continue
      const n = (this.index[len + 1] ?? this.symbols.length) - this.index[len]!
      if (n > 0 && code - first < n) return this.symbols[this.index[len]! + (code - first)]!
    }
    return -1
  }
}

/**
 * `read_pt_len`: the small table, used both for the code-length alphabet and
 * for the position alphabet.
 *
 * The three-bit lengths with an escape are the fiddly part. A value below 7
 * is the length; 7 means "keep counting ones", and every 1 after the first
 * three bits adds one before a 0 ends it. `special` is the index after which
 * a two-bit run of zero lengths is written, and is 3 for the code-length
 * table and absent for the position table.
 */
function readPtLen(bits: Bits, nn: number, nbit: number, special: number): Huff {
  const n = bits.read(nbit)
  if (n === 0) return new Huff([], bits.read(nbit))
  const len = new Array<number>(nn).fill(0)
  let i = 0
  while (i < n && i < nn) {
    let c = bits.peek(3)
    if (c !== 7) bits.skip(3)
    else {
      bits.skip(3)
      while (bits.read1() === 1) c++
    }
    len[i++] = c
    if (i === special) {
      let z = bits.read(2)
      while (z-- > 0 && i < nn) len[i++] = 0
    }
  }
  return new Huff(len)
}

/** `read_c_len`: the literal/length table, written with the table `pt` decodes */
function readCLen(bits: Bits, pt: Huff): Huff {
  const n = bits.read(CBIT)
  if (n === 0) return new Huff([], bits.read(CBIT))
  const len = new Array<number>(NC).fill(0)
  let i = 0
  while (i < n && i < NC) {
    let c = pt.decode(bits)
    if (c < 0) break
    if (c <= 2) {
      if (c === 0) c = 1
      else if (c === 1) c = bits.read(4) + 3
      else c = bits.read(CBIT) + 20
      while (c-- > 0 && i < NC) len[i++] = 0
    } else {
      len[i++] = c - 2
    }
  }
  return new Huff(len)
}

/**
 * Decode one member.
 *
 * `-lh0-` and `-lz4-` are stored and are copied. Everything in `DECODES`
 * beyond those is the lh4/5/6/7 family, which differ only in window size and
 * in how many bits the position table's count is written in: four below lh6
 * and five from lh6 up, because the alphabet outgrows sixteen entries.
 *
 * Returns null for a method this does not decode, which is a real answer: the
 * caller can still list the archive and say which members it cannot read.
 */
export function decode(data: Uint8Array, method: string, size: number): Uint8Array | null {
  if (method === '-lh0-' || method === '-lz4-') return data.subarray(0, size)
  if (!DECODES.has(method)) return null
  const bits = WINDOW_BITS[method]
  if (bits === undefined || bits === 0) return null

  const np = bits + 1
  const pbit = bits > 13 ? 5 : 4
  const out = new Uint8Array(size)
  const b = new Bits(data)

  let n = 0
  let blockLeft = 0
  let cTable: Huff | null = null
  let pTable: Huff | null = null

  while (n < size) {
    if (blockLeft === 0) {
      blockLeft = b.read(16)
      if (blockLeft === 0) break
      const pt = readPtLen(b, NT, TBIT, 3)
      cTable = readCLen(b, pt)
      pTable = readPtLen(b, np, pbit, -1)
    }
    blockLeft--
    const c = cTable!.decode(b)
    if (c < 0) break
    if (c < 256) {
      out[n++] = c
      continue
    }
    const matchLen = c - 256 + THRESHOLD
    let p = pTable!.decode(b)
    if (p < 0) break
    if (p !== 0) p = (1 << (p - 1)) + b.read(p - 1)
    let from = n - p - 1
    if (from < 0) break
    for (let i = 0; i < matchLen && n < size; i++) out[n++] = out[from++]!
  }
  return out
}

/** an archive read whole: every member it could decode */
export interface LhaFile {
  path: string
  data: Uint8Array
}

/**
 * Read an archive.
 *
 * Directories are skipped, since LHA stores them as zero-length members whose
 * name ends in a separator and nothing here wants an empty file for one.
 * Members whose method is not decoded are skipped too, and `readLhaHeaders`
 * remains the way to see that they were there.
 */
export function readLha(bytes: Uint8Array): LhaFile[] {
  const out: LhaFile[] = []
  for (const e of readLhaHeaders(bytes)) {
    if (e.path === '' || e.path.endsWith('/')) continue
    const data = decode(bytes.subarray(e.dataOffset, e.dataOffset + e.packedSize), e.method, e.size)
    if (data === null) continue
    out.push({ path: e.path, data })
  }
  return out
}
