/**
 * The Imploder (`IMP!`) — explode, a stored implode, and a real one.
 *
 * `explode.library` was one of those Amiga libraries everyone assumed was in
 * `LIBS:`. The corpus bears that out: the same 1,876-byte v6.0.64 "Executable
 * Explode Wedge" turns up md5-identical (0a4496de…) in three unrelated
 * drawers, and Workbench 3.0 ships its own. So the codec belongs here beside
 * ../amiga/powerpacker.ts rather than in any one extension.
 *
 * Two readings sit behind this file, and they agree.
 *
 * `explode` and `implode` came from the format alone. No Imploder source
 * exists in the corpus and none was used; the layout was read out of AMCAF's
 * own decruncher, routine 374 ($8562, 336 bytes), which both `Imploder Load`
 * and `Imploder Unpack` tail into. Worth saying plainly because it is easy to
 * assume otherwise: AMCAF does NOT call explode.library for those keywords.
 * It carries its own inlined copy of the algorithm.
 *
 * `turboImplode` is a port of a shipped binary, `xpkIMPL.library` 0.18.77
 * (26-Sep-92), the 4,052-byte sub-library the AMOS PD Library CD carries in
 * `COMPRESSORS/`. Its decruncher at `$d60` reads the same tables at the same
 * offsets AMCAF's does, which is the first independent confirmation this
 * file's format notes have had. Addresses below prefixed `IMPL` are offsets
 * into its 3,824-byte code hunk loaded at base 0.
 *
 * ## The format
 *
 * Decrunching is BACKWARDS and IN PLACE, which is what most of the layout is
 * for. The crunched file is loaded at the bottom of a buffer the size of the
 * decrunched data; the read pointer walks down from the end of the crunched
 * bytes while the write pointer walks down from the end of the buffer, and
 * because the reader is always below the writer they never collide.
 *
 *     +$00  'IMP!'
 *     +$04  decrunched length          a4 starts here (write, descending)
 *     +$08  offset of the tail block   a3 starts here (read, descending)
 *     +$0c  the bitstream, read from the tail end downwards to +$00
 *
 * and the tail block, read FORWARDS:
 *
 *     +$00  three longs   the twelve bytes the header displaced
 *     +$0c  long          the first literal run
 *     +$10  word          the initial bit buffer; bit 15 clear backs a3 up one
 *     +$12  28 bytes      the offset tables, below
 *
 * The three longs are the point of the whole arrangement. The bitstream
 * genuinely starts at offset 0, so the twelve bytes the header sits on are
 * real stream data; they are stashed in the tail and put back before decoding
 * begins. They are then overwritten by output at the very end — after the
 * reader has passed them.
 *
 * ## The bit reader
 *
 * A byte with a travelling sentinel, which is why the buffer is never empty:
 *
 *     add.b   d3,d3          ; C = bit 7, and the byte shifts up
 *     bne.b   ok             ; still bits left
 *     move.b  -(a3),d3       ; exhausted: the 1 that fell out was the sentinel
 *     addx.b  d3,d3          ; C = bit 7 of the new byte, sentinel into bit 0
 *   ok:
 *
 * ## The codes
 *
 * A match length by unary prefix, then extra bits for the NEXT literal run,
 * then the offset:
 *
 *     0        len 1, table 0        11110 1      len = byte - 1, table 3
 *     10       len 2, table 1        11110 0      len = 3 bits + 5, table 3
 *     110      len 3, table 2
 *     1110     len 4, table 3
 *
 * Both the literal-run count and the offset then use the same two-bit shape —
 * `0` take the base as 0, `10` take a fixed base, `11` take it from a table —
 * with the bit count read from a table indexed by the match's table number.
 * The literal side's tables are constants in the library; the offset side's
 * come from the FILE, which is what the 28 bytes are.
 */

/**
 * Implode — STORED, and deliberately so.
 *
 * This is compatibility, not compression: nothing in AMOS needs a good
 * ratio, it needs a file the exploder above (and the real one) will read.
 * The format has a literal run built into it, so the whole file is one run
 * and no bit is ever read — which makes this a dozen lines that cannot
 * disagree with the decoder about a code it never emits.
 *
 * `turboImplode` below is the compressor, and it is not a replacement for
 * this: it needs 64 bytes to start and refuses input it cannot shrink, where
 * this writes a file for anything from twelve bytes up.
 *
 * The trick is `tailAt == outLen`: the read and write pointers then start
 * together and the literal loop is a self-copy walking down, so the buffer
 * already holds the answer. A real match-finder can be added later without
 * changing anything here except which codes get emitted.
 *
 * Costs 46 bytes over the input. Twelve bytes is the floor — below that the
 * header has nothing to displace and there is no valid file to write.
 */
export function implode(data: Uint8Array): Uint8Array {
  if (data.length < 12) throw new Error('implode needs at least 12 bytes')
  const n = data.length
  const out = new Uint8Array(n + TAIL_BYTES)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, IMP_MAGIC)
  dv.setUint32(4, n)
  // the tail sits exactly at the decrunched length, so src and dst start
  // level and the literal run copies each byte over itself
  dv.setUint32(8, n)
  out.set(data.subarray(12), 12)
  // the twelve displaced bytes, in the order the decoder puts them back:
  // it walks DOWN from +$c, so the first long written is the one at +$8
  let t = n
  for (const at of [8, 4, 0]) {
    dv.setUint32(t, (data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!)
    t += 4
  }
  dv.setUint32(t, n) // one literal run covering everything
  t += 4
  // bit 15 set, so the reader does NOT back up a byte and the pointers stay
  // level; the buffer itself is never consulted because no code is read
  dv.setUint16(t, 0x8000)
  // and 28 bytes of offset tables left zero, for the same reason
  return out
}

/** the four length bases at $86a2, for the `11` arm */
const LEN_BASE = [6, 10, 10, 18] as const
/**
 * The twelve length bit counts at $86a6, three groups of four.
 *
 * `xpkIMPL.library` holds the same twelve bytes at IMPL `$ee4`, with the same
 * four bases in the four bytes immediately before them at IMPL `$ee0`, so the
 * two binaries agree byte for byte on both tables. Its packer keeps a second
 * copy of the bit counts at IMPL `$4c8`.
 */
const LEN_BITS = [1, 1, 1, 1, 2, 3, 3, 4, 4, 5, 7, 14] as const

/** `IMP!` */
export const IMP_MAGIC = 0x494d5021
/** three longs + run + seed + 28 table bytes */
export const TAIL_BYTES = 12 + 4 + 2 + 28

/** whether a buffer opens with the Imploder's magic */
export function isImploded(data: Uint8Array): boolean {
  return data.length >= 12 && data[0] === 0x49 && data[1] === 0x4d && data[2] === 0x50 && data[3] === 0x21
}

/**
 * Explode an `IMP!` buffer.
 *
 * Throws on anything it cannot read rather than returning a short buffer: a
 * truncated decrunch that looks like success is the failure mode worth
 * refusing, since the caller is about to hand it to a program as a bank.
 */
export function explode(file: Uint8Array): Uint8Array {
  return explodeCore(file).out
}

/**
 * Explode, and insist the reader landed exactly on the first byte.
 *
 * IMPL `$dd8` compares the read pointer against the base and answers
 * "corrupt" for anything else, which is a whole-stream integrity test the
 * format otherwise has none of: a wrong bit anywhere leaves the reader short
 * or long. AMCAF's decruncher does not make that test and neither does
 * `explode`, so this is a separate entry point rather than a change to it.
 */
export function explodeChecked(file: Uint8Array): Uint8Array {
  const { out, src } = explodeCore(file)
  if (src !== 0) throw new Error(`IMP! stream ended at ${src}, not 0`)
  return out
}

function explodeCore(file: Uint8Array): { out: Uint8Array; src: number } {
  if (!isImploded(file)) throw new Error('not an IMP! file')
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const outLen = dv.getUint32(4)
  const tailAt = dv.getUint32(8)
  if (tailAt + TAIL_BYTES > file.length || tailAt < 12 || outLen < 12) throw new Error('IMP! header out of range')

  // in place: the crunched bytes go to the bottom of a decrunched-size buffer
  const out = new Uint8Array(outLen)
  out.set(file.subarray(0, Math.min(file.length, outLen)))

  // the tail, forwards
  let t = tailAt
  const rd32 = (): number => {
    const v = dv.getUint32(t)
    t += 4
    return v
  }
  // The twelve bytes the header displaced, back where the stream expects
  // them — and BACKWARDS, because the routine walks the destination down
  // (`move.l (a2)+,-(a0)` three times from a0 = base+12). The first long in
  // the tail is the one at +$8.
  for (let i = 8; i >= 0; i -= 4) {
    const v = rd32()
    out[i] = (v >>> 24) & 0xff
    out[i + 1] = (v >>> 16) & 0xff
    out[i + 2] = (v >>> 8) & 0xff
    out[i + 3] = v & 0xff
  }
  let run = rd32()
  const seed = dv.getUint16(t)
  t += 2
  const offBase = [0, 0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < 8; i++) offBase[i] = dv.getInt16(t + i * 2)
  const offBits = [...file.subarray(t + 16, t + 28)]

  let src = tailAt
  let dst = outLen
  let buf = seed & 0xff
  // `bmi` on the seed WORD: a clear top bit backs the reader up one byte
  if ((seed & 0x8000) === 0) src--

  const bit = (): number => {
    let c = (buf >> 7) & 1
    buf = (buf << 1) & 0xff
    if (buf === 0) {
      if (src <= 0) throw new Error('IMP! stream underrun')
      buf = out[--src]!
      c = (buf >> 7) & 1
      buf = ((buf << 1) | 1) & 0xff
    }
    return c
  }
  const bits = (n: number): number => {
    let v = 0
    for (let i = 0; i < n; i++) v = (v * 2 + bit()) >>> 0
    return v
  }

  for (;;) {
    // the literal run, straight bytes from the stream
    while (run-- > 0 && dst > 0) {
      if (src <= 0) throw new Error('IMP! stream underrun in literals')
      out[--dst] = out[--src]!
    }
    if (dst <= 0) break

    // Match length by unary prefix — the count of leading 1s, up to four,
    // picks both the length and the table. Written as a loop rather than a
    // chain of `if (!bit())` because each call consumes a bit and a reader
    // (human or lint) is entitled to read repeated identical conditions as a
    // mistake.
    //
    // The counter is a `dbra`, so every arm copies one MORE byte than the
    // register holds: the shortest match is two.
    let ones = 0
    while (ones < 4 && bit() === 1) ones++
    let len: number
    const tab = Math.min(ones, 3)
    if (ones < 4) {
      len = ones + 2
    } else if (bit() === 1) {
      // a raw byte, not bits
      if (src <= 0) throw new Error('IMP! stream underrun')
      len = out[--src]!
    } else {
      len = bits(3) + 6
    }

    // the NEXT literal run: base, then a counted field
    let base = 0
    let idx = tab
    if (bit()) {
      if (bit()) {
        base = LEN_BASE[tab]!
        idx = tab + 8
      } else {
        base = 2
        idx = tab + 4
      }
    }
    run = bits(LEN_BITS[idx]!) + base

    // the offset, the same shape against the file's own tables
    let off = 0
    let oidx = tab
    if (bit()) {
      if (bit()) {
        off = offBase[tab + 4]!
        oidx = tab + 8
      } else {
        off = offBase[tab]!
        oidx = tab + 4
      }
    }
    off += bits(offBits[oidx]!) + 1

    // The last code of a file routinely runs past the start, and on the
    // machine that is harmless: `dbra` keeps writing below the buffer and the
    // loop then exits because the write pointer has gone under the base. The
    // bytes are never read. Here the write is simply dropped.
    let from = dst + off
    for (let i = 0; i < len && dst > 0; i++) {
      if (from <= 0 || from > outLen) throw new Error('IMP! match out of range')
      out[--dst] = out[--from]!
    }
  }
  return { out, src }
}

/**
 * IMPL `$4dc`, the twelve window sizes an effort index picks from.
 *
 * The effort index is also the index into IMP_OFFBITS, and the two tables are
 * matched: the widest offset the last table can encode is 135680, which is
 * this table's last entry to the byte.
 */
const IMP_WINDOW = [128, 256, 512, 1024, 1792, 3328, 5376, 9472, 20736, 37376, 67840, 135680] as const

/**
 * IMPL `$50c`, twelve offset-bit tables of twelve entries, one per window.
 *
 * Read as three groups of four, the same shape the length side has: entries
 * 0..3 size the `0` arm, 4..7 the `10` arm and 8..11 the `11` arm, each arm
 * picking its group by the match's table number. The bases are derived rather
 * than stored, at IMPL `$ab8`: `1 << bits`, then every entry from 4 up adds
 * the one four places below it, which is what makes the three arms cover a
 * contiguous run of offsets with no gap and no overlap.
 */
const IMP_OFFBITS = [
  [5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6],
  [5, 6, 7, 7, 6, 6, 6, 6, 7, 7, 6, 6],
  [5, 6, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8],
  [5, 6, 7, 8, 7, 7, 8, 8, 8, 8, 9, 9],
  [6, 7, 7, 8, 7, 8, 9, 9, 8, 9, 10, 10],
  [6, 7, 7, 8, 7, 9, 9, 10, 8, 10, 11, 11],
  [6, 7, 8, 8, 7, 9, 9, 10, 8, 10, 11, 12],
  [6, 7, 8, 8, 7, 9, 9, 10, 9, 10, 12, 13],
  [6, 7, 7, 8, 7, 9, 9, 12, 9, 10, 12, 14],
  [6, 7, 8, 9, 7, 9, 10, 12, 9, 11, 13, 15],
  [6, 7, 8, 8, 7, 10, 11, 11, 9, 12, 13, 16],
  [6, 8, 8, 9, 7, 11, 12, 12, 9, 13, 14, 17],
] as const

/**
 * IMPL `$4b0`, twelve words the literal-run field is measured against.
 *
 * The first eight are the bases the decoder knows as 2 and LEN_BASE. The last
 * four are the caps, and they are what makes a run of 16402 or more
 * unencodable at any table: `$934` gives up on the whole match rather than
 * shortening the run, which is why `$b5c` stops matching at 16402 and lets the
 * rest of the chunk go out as one final run in the tail.
 */
const IMP_RUN = [2, 2, 2, 2, ...LEN_BASE, 22, 42, 138, 16402] as const

/** IMPL `$4d2` and `$4d6`, the whole length code for lengths two to five */
const IMP_SHORT_LEN = [0, 0, 0, 2, 6, 14] as const
const IMP_SHORT_BITS = [0, 0, 1, 2, 3, 4] as const

/**
 * Implode for real, ported from `xpkIMPL.library` 0.18's `$a30`.
 *
 * `effort` is 0..11 and picks a window out of IMP_WINDOW; anything else is
 * taken as 0 (IMPL `$a58`). `null` is the library's `d0 = 0`, which
 * `XpkPackChunk` turns into XPKERR_EXPANSION: input under 64 bytes (IMPL
 * `$a44`), a crunched stream under twelve bytes, or one that did not save
 * more than 54 bytes and so has nowhere to put its own 46-byte tail.
 *
 * ## Which way a match points
 *
 * Forwards, which is the thing to hold on to. The decoder walks the output
 * DOWN from the end, so a match copies from ABOVE the write pointer, meaning
 * later in the file. The encoder therefore searches ahead of the read
 * pointer, and the offset it stores is how far ahead.
 *
 * That also settles the bit order. The encoder writes bits LSB-first into a
 * byte filling from bit 7 down (`$886`), and appends bytes upwards; the
 * decoder takes bytes downwards and bits MSB-first. The whole stream is read
 * backwards, so the last field written is the first field read, and within a
 * field the encoder's last bit out is the decoder's first bit in.
 *
 * ## The eight candidates
 *
 * Both finders fill the same eight slots (IMPL `$3e` lengths, `$46` offsets):
 * one slot per match length from two to eight, and a last slot for anything
 * longer. A slot is written only by a match strictly longer than every match
 * before it in the scan, so what survives is the FIRST match found at each
 * length, and `$9ca` then costs all eight and keeps the one that saves most
 * bits. A longer match losing to a shorter one is normal here: the offset
 * field is priced by the match's own table number, so a distant five-byte
 * match can cost more than a near three-byte one.
 */
export function turboImplode(data: Uint8Array, effort: number): Uint8Array | null {
  const inLen = data.length
  if (inLen < 0x40) return null // $a44

  const buf = new Uint8Array(inLen)
  buf.set(data)
  // DEVIATION: `$81e` compares one byte past InLen when the scan reaches the
  // last position in the buffer, and on the machine that byte is whatever
  // OutBuf happened to hold. It decides only whether a length-two candidate
  // at that one position is recorded, since every longer arm clamps to the
  // end at `$830` and is then rejected for being no longer than the best so
  // far. Modelled as zero.
  const at = (i: number): number => buf[i] ?? 0

  const eff = effort >= 0 && effort < 12 ? effort : 0
  const window = IMP_WINDOW[eff]! + 1 <= inLen ? IMP_WINDOW[eff]! + 1 : inLen - 1
  // $a92: back from the window to the table that covers it, which is `eff`
  // again unless a short chunk clamped the window above
  let group = 0
  while (window - 1 > IMP_WINDOW[group]!) group++
  const offBits = IMP_OFFBITS[group]!
  const offBase = offBits.map((b) => 1 << b)
  for (let i = 4; i < 12; i++) offBase[i]! += offBase[i - 4]!

  // $b04: the hash chains are only built above 2048 bytes, and below that the
  // brute-force scan at `$7a4` runs instead. They do NOT find the same
  // matches, so which one ran is visible in the output.
  const useHash = inLen > 0x800

  let readPtr = 0
  let writePtr = 0
  let run = 0
  let bitBuf = 0
  let bitCnt = 7

  /** `$87a`: `count` bits of `value`, low bit first, into a byte filling from bit 7 */
  const emit = (count: number, value: number): void => {
    let v = value
    for (let n = count; n > 0; n--) {
      bitBuf = ((v & 1) << 7) | (bitBuf >> 1)
      v >>>= 1
      if (--bitCnt < 0) {
        bitCnt = 7
        buf[writePtr++] = bitBuf
        bitBuf = 0
      }
    }
  }

  // the three fields of a code, as `$8a6` builds them and `$9ca` keeps them
  let tOffBits = 0
  let tOffVal = 0
  let tLenBits = 0
  let tLenVal = 0
  let tRunBits = 0
  let tRunVal = 0
  let cOffBits = 0
  let cOffVal = 0
  let cLenBits = 0
  let cLenVal = 0
  let cRunBits = 0
  let cRunVal = 0

  /**
   * `$8a6`: price one (length, offset) against the run standing behind it.
   *
   * False is the library's `d0 = 0` from `$934` or `$99c`, and it means this
   * candidate cannot be written at all rather than that it is a poor deal.
   */
  const price = (len: number, off: number): boolean => {
    let tab: number
    if (len > 13) {
      // $8dc: five ones and then the length as a whole BYTE, which `$c0a`
      // drops into the buffer byte-aligned rather than through the bit writer
      tLenVal = 0x1f00 | len
      tLenBits = 13
      tab = 3
    } else if (len > 5) {
      tLenVal = 0xf0 | (len - 6)
      tLenBits = 8
      tab = 3
    } else {
      tLenVal = IMP_SHORT_LEN[len]!
      tLenBits = IMP_SHORT_BITS[len]!
      tab = len - 2
    }

    let arm: number
    let bits: number
    let base: number
    if (run < IMP_RUN[tab]!) {
      bits = LEN_BITS[tab]!
      arm = 0
      base = 0
      tRunBits = bits + 1
    } else if (run < IMP_RUN[tab + 4]!) {
      bits = LEN_BITS[tab + 4]!
      arm = 2
      base = IMP_RUN[tab]!
      tRunBits = bits + 2
    } else if (run >= IMP_RUN[tab + 8]!) {
      return false
    } else {
      bits = LEN_BITS[tab + 8]!
      arm = 3
      base = IMP_RUN[tab + 4]!
      tRunBits = bits + 2
    }
    tRunVal = ((arm << bits) | (run - base)) & 0xffff

    if (off < offBase[tab]!) {
      bits = offBits[tab]!
      arm = 0
      base = 0
      tOffBits = bits + 1
    } else if (off < offBase[tab + 4]!) {
      bits = offBits[tab + 4]!
      arm = 2
      base = offBase[tab]!
      tOffBits = bits + 2
    } else if (off >= offBase[tab + 8]!) {
      return false
    } else {
      bits = offBits[tab + 8]!
      arm = 3
      base = offBase[tab + 4]!
      tOffBits = bits + 2
    }
    tOffVal = ((arm << bits) | (off - base)) >>> 0
    return true
  }

  const candLen = new Uint8Array(8)
  const candOff = new Int32Array(8)
  let matchLen = 0

  /** `$9ca`: cost all eight candidates, keep the one that saves most bits */
  const choose = (): boolean => {
    let best = 0
    matchLen = 0
    for (let i = 0; i < 8; i++) {
      const len = candLen[i]!
      if (len === 0) continue
      if (!price(len, candOff[i]!)) continue
      const gain = (len << 3) - (tLenBits + tOffBits + tRunBits)
      // $9fe and $a04: a negative saving is thrown out, and `bcc` on the tie
      // means the LAST candidate at the winning score is the one kept
      if (gain < 0 || gain < best) continue
      best = gain
      matchLen = len
      cOffBits = tOffBits
      cLenBits = tLenBits
      cRunBits = tRunBits
      cOffVal = tOffVal
      cLenVal = tLenVal
      cRunVal = tRunVal
    }
    return matchLen !== 0
  }

  /** `$846` and `$862`: slots 0..6 are lengths two to eight, slot 7 is the rest */
  const record = (n: number, off: number): boolean => {
    if (n <= 8) {
      // $846 guards a slot that already holds something. It cannot fire: the
      // caller only gets here on a length strictly greater than every length
      // before it, so no slot is ever offered twice in one scan.
      if (candLen[n - 2] !== 0) return false
      candLen[n - 2] = n
      candOff[n - 2] = off
      return false
    }
    candLen[7] = n & 0xff
    candOff[7] = off
    return (n & 0xff) === 0xff // $870: 255 is the longest code, so stop looking
  }

  /** `$7a4`: every position in the window, first byte first */
  const findBrute = (): void => {
    candLen.fill(0)
    const a5 = readPtr
    const limit = a5 + window <= inLen ? a5 + window : inLen
    const first = at(a5)
    let best = 1
    for (let m = a5 + 1; m + 1 < limit; m++) {
      if (at(m) !== first) continue
      let a0 = a5 + 1
      let a1 = m + 1
      if (at(a0++) !== at(a1++)) continue
      if (at(a0++) === at(a1++)) {
        if (at(a0++) === at(a1++)) {
          // $826: the `dbne` runs 252 more times, so 255 is the ceiling
          for (let k = 0; k < 252; k++) {
            if (at(a0++) !== at(a1++)) break
          }
        }
        if (a1 > inLen) a1 = inLen // $830
      }
      // every comparison advanced a1, including the one that failed, so this
      // counts the matching bytes and not one more
      const n = a1 - m - 1
      if (best >= n) continue
      best = n
      if (record(n, m - a5 - 1)) return
    }
  }

  // $5d2: one node per window position, and a bucket per two-byte key. The
  // key is the whole two bytes, so a chain never holds a false match and the
  // compare can start at the third byte.
  const nodeNext = new Int32Array(useHash ? window : 0)
  const nodePos = new Int32Array(useHash ? window : 0)
  const hash = new Int32Array(useHash ? 0x10000 : 0).fill(-1)
  if (useHash) {
    // $648: the pool is carved from the top of each block down while the
    // position walks down from base+window, so node k holds position
    // window-k. A node's stored position is one PAST the match: `$716` reads
    // it and steps back to compare, which is what makes `$78a` and `$bc2`
    // store an incremented pointer.
    for (let k = 0; k < window; k++) {
      const pos = window - k
      nodePos[k] = pos
      const key = (at(pos - 1) << 8) | at(pos)
      const head = hash[key]!
      if (head < 0) {
        nodeNext[k] = k
        hash[key] = k
      } else {
        // the bucket is NOT repointed here, so it keeps the highest position
        // and its `next` is the lowest: exactly the node `$6f0` recycles
        nodeNext[k] = nodeNext[head]!
        nodeNext[head] = k
      }
    }
  }

  /** `$78c` and `$bc6`: the recycled node re-enters at the far edge of the window */
  const reinsert = (node: number, pos: number): void => {
    const key = (at(pos) << 8) | at(pos + 1)
    nodePos[node] = pos + 1
    const head = hash[key]!
    if (head < 0) nodeNext[node] = node
    else {
      nodeNext[node] = nodeNext[head]!
      nodeNext[head] = node
    }
    hash[key] = node
  }

  /**
   * `$6ee`: unlink the oldest node of a key's ring and hand it back.
   *
   * DEVIATION: `$6ee` reads through the bucket without testing it, so an
   * empty one is a read of address 0. It is reachable from `$b92`, where a
   * match longer than the window slides over positions the table never
   * indexed and the two bytes there may appear nowhere else in the window.
   * On the machine that reads whatever sits at 0; here it recycles nothing
   * and leaves the ring alone, which is the least destructive reading.
   */
  const recycle = (key: number): number => {
    const head = hash[key]!
    if (head < 0) return -1
    const victim = nodeNext[head]!
    if (victim === head) hash[key] = -1
    else nodeNext[head] = nodeNext[victim]!
    return victim
  }

  /** `$6d2`: one walk of the current key's ring, then slide the window on by one */
  const findHash = (): boolean => {
    const a5 = readPtr
    const key = (at(a5) << 8) | at(a5 + 1)
    const third = at(a5 + 2)
    const victim = recycle(key)
    let best = 1
    // $6fa: a ring of one holds only the node just recycled, so there is
    // nothing left to compare against and the candidates keep their old
    // contents. The caller never looks at them, because best stays 1.
    if (victim >= 0 && hash[key]! >= 0) {
      candLen.fill(0)
      const start = nodeNext[victim]!
      let n = start
      do {
        const pos = nodePos[n]!
        let a1 = pos + 1
        if (at(a1++) === third) {
          let a0 = a5 + 3
          // $72a: 253 iterations here against the brute scan's 252, because
          // that one spent an extra unrolled compare getting here
          for (let k = 0; k < 253; k++) {
            if (at(a0++) !== at(a1++)) break
          }
          if (a1 > inLen) a1 = inLen // $730
        }
        const len = a1 - pos
        if (best < len) {
          best = len
          if (record(len, pos - a5 - 2)) break
        }
        n = nodeNext[n]!
      } while (n !== start)
    }
    // $76a: and the node comes back in at readPtr+window, unless the window
    // has already run off the end of the chunk
    if (victim >= 0 && a5 + 2 + window < inLen) reinsert(victim, a5 + window)
    return best !== 1
  }

  /** `$b74`: a match skips positions, and every one of them has to slide too */
  const slide = (len: number): void => {
    let a2 = readPtr + 1
    let a3 = readPtr + 1 + window
    let room = inLen - a3 - 1
    if (room < 0) room = 0
    for (let n = len - 1; n > 0; n--) {
      const victim = recycle((at(a2) << 8) | at(a2 + 1))
      a2++
      if (--room < 0) continue
      if (victim < 0) continue
      reinsert(victim, a3)
      a3++
    }
  }

  // $b18: match while there are three bytes left, then flush
  while (inLen - 2 > readPtr) {
    let got = false
    if (useHash) got = findHash() && choose()
    else {
      findBrute()
      got = choose()
    }
    if (!got) {
      buf[writePtr++] = buf[readPtr++]!
      run++
      // $b5c: no run field can hold 16402, so stop and let the tail carry it
      if (run >= 0x4012) break
      continue
    }
    run = 0
    if (useHash) slide(matchLen)
    readPtr += matchLen
    // $be4: offset, then run, then length. Backwards, which is forwards for
    // a decoder reading the stream from its far end.
    emit(cOffBits, cOffVal)
    emit(cRunBits, cRunVal)
    if (cLenBits === 13) {
      buf[writePtr++] = cLenVal & 0xff
      emit(5, 0x1f)
    } else emit(cLenBits, cLenVal)
  }
  // $c20
  while (readPtr !== inLen) {
    buf[writePtr++] = buf[readPtr++]!
    run++
  }

  let clen = writePtr
  if (clen < 0xc) return null // $c5e
  if (inLen - clen <= 0x36) return null // $c6e
  // $c86: the tail is read as longwords, so an odd stream gets a pad byte,
  // and bit 15 of the seed word tells the decoder whether to step over it
  let even = 0xff00
  if ((clen & 1) !== 0) {
    even = 0
    buf[clen++] = 0
  }

  const t = clen
  const put32 = (atOff: number, v: number): void => {
    buf[atOff] = (v >>> 24) & 0xff
    buf[atOff + 1] = (v >>> 16) & 0xff
    buf[atOff + 2] = (v >>> 8) & 0xff
    buf[atOff + 3] = v & 0xff
  }
  const get32 = (atOff: number): number =>
    ((buf[atOff]! << 24) | (buf[atOff + 1]! << 16) | (buf[atOff + 2]! << 8) | buf[atOff + 3]!) >>> 0
  // $c92: the twelve bytes the header is about to sit on go to the tail
  // first, and DOWNWARDS, because the decoder puts them back walking down
  // from base+12
  put32(t + 8, get32(0))
  put32(0, IMP_MAGIC)
  put32(t + 4, get32(4))
  put32(4, inLen)
  put32(t, get32(8))
  put32(8, clen)
  put32(t + 12, run)
  // $cc0: the last partial byte, with a sentinel set just under the bits it
  // holds. The decoder shifts until the byte empties and that 1 is what
  // tells it to fetch another.
  const seed = (((bitBuf & 0xfe) | (1 << bitCnt)) | even) & 0xffff
  buf[t + 16] = (seed >>> 8) & 0xff
  buf[t + 17] = seed & 0xff
  for (let i = 0; i < 8; i++) {
    buf[t + 18 + i * 2] = (offBase[i]! >>> 8) & 0xff
    buf[t + 19 + i * 2] = offBase[i]! & 0xff
  }
  for (let i = 0; i < 12; i++) buf[t + 34 + i] = offBits[i]!
  return buf.slice(0, clen + TAIL_BYTES)
}
