/**
 * The Imploder (`IMP!`) — explode, and a minimal implode.
 *
 * `explode.library` was one of those Amiga libraries everyone assumed was in
 * `LIBS:`. The corpus bears that out: the same 1,876-byte v6.0.64 "Executable
 * Explode Wedge" turns up md5-identical (0a4496de…) in three unrelated
 * drawers, and Workbench 3.0 ships its own. So the codec belongs here beside
 * ../amiga/powerpacker.ts rather than in any one extension.
 *
 * Like PowerPacker, this is a FROM-THE-FORMAT reimplementation and not a
 * source port: no Imploder source exists in the corpus and none was used. The
 * format was read out of AMCAF's own decruncher — routine 374 ($8562, 336
 * bytes), which both `Imploder Load` and `Imploder Unpack` tail into. Worth
 * saying plainly because it is easy to assume otherwise: AMCAF does NOT call
 * explode.library for those keywords. It carries its own inlined copy of the
 * algorithm, and that copy is what this file reproduces.
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
/** the twelve length bit counts at $86a6, three groups of four */
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
  return out
}
