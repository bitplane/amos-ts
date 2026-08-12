/**
 * ByteKiller — decrunch.
 *
 * One of the demo-scene crunchers of the late eighties, and the one Explode
 * 2.01 carries INLINE rather than calling out for. That is the reason this
 * file can exist at all: `L_BpkUnpack` (routine 74, $1702) is not a library
 * call but sixty-odd instructions of decruncher, labelled `Bk1` to `Bk9` in
 * the author's own commented source, and the algorithm below was read out of
 * them. Beside ../amiga/powerpacker.ts and ../amiga/imploder.ts because a
 * codec belongs here and not in a port — but unlike those two this had a
 * SOURCE to read, not a binary.
 *
 * ## The format
 *
 * Everything runs BACKWARDS: the bitstream is read from the end of the
 * crunched data downwards, and the output is written from the end of the
 * buffer downwards. A match therefore copies from a HIGHER address than it
 * writes to, which is why the offset is added rather than subtracted.
 *
 *     +$00  long   the crunched data's length, from the end of this header
 *     +$04  long   the decrunched length
 *     +$08  long   a checksum
 *     +$0c  the bitstream, read from its far end downwards
 *
 * NOTE: THE CHECKSUM IS NEVER CHECKED. The decruncher loads it into d5 and
 * dutifully `eor.l d0,d5` over every longword it reads, and then falls out of
 * the loop into `L_Bnk.HeadClone` without ever testing d5 against anything.
 * The work is done and the answer thrown away. It is reproduced here — the
 * accumulator runs and nothing reads it — because a caller cannot tell, and
 * because leaving it out would quietly make this file a different algorithm
 * from the one the source describes.
 *
 * ## The bit reader
 *
 * A longword at a time, low bit first, with a SENTINEL and no counter.
 * `lsr.l #1,d0` shifts the low bit into carry and, when the register reaches
 * zero, the bit that came out was the sentinel rather than data — so the
 * reader reloads and `roxr.l #1,d0` with X set pushes a fresh 1 into bit 31
 * while delivering the real bit.
 *
 * THE FIRST LONGWORD IS NOT LIKE THE OTHERS, and it is the one thing here
 * that a careless reading gets wrong. The register is primed with a plain
 * `move.l -(a0),d0` and drains until it hits zero, so that longword needs a
 * sentinel THE PACKER WROTE and carries only the bits beneath it — thirty-one
 * at most. Every reload after it goes through the `roxr`, which supplies the
 * terminator itself, so those longwords carry a full thirty-two data bits and
 * have no sentinel of their own.
 *
 * ## The codes
 *
 * A leading 0 bit:
 *
 *     0 0  + 3 bits n     literal run of n + 1 bytes         (1..8)
 *     0 1  + 8 bits o     match of 2 bytes at offset o
 *
 * A leading 1 bit, then two more:
 *
 *     1 00 + 9 bits o     match of 3 bytes
 *     1 01 + 10 bits o    match of 4 bytes
 *     1 10 + 8 bits n + 12 bits o   match of n + 1 bytes
 *     1 11 + 8 bits n     literal run of n + 9 bytes         (9..264)
 *
 * The literal bytes are themselves read eight bits at a time out of the same
 * bitstream rather than copied whole, so a run of literals costs its length
 * in bits and not in bytes.
 */

/** the ByteKiller header, before any bitstream */
const HEADER = 12

/**
 * `L_GetBpkLen` (routine 173, $33e8) — is this ByteKiller, and how big does
 * it decrunch to? Zero for anything it does not recognise.
 *
 * TWO shapes, and the sniff for the second is the interesting one. An
 * executable is spotted by a signature in the decruncher stub the packer
 * prepends (`cmpi.l #$61766532,$4C(a0)` — the characters "ave2") and its
 * length read from a fixed offset. Bare data has no magic AT ALL, so the
 * routine guesses from the header's shape: not a HUNK_HEADER, the top byte of
 * the crunched length clear, byte 5 clear, and a non-zero checksum.
 *
 * NOTE: `tst.b 5(a0)` is a strange test to have written. Byte 5 is bits 16-23
 * of the DECRUNCHED length, so a file that decrunches to 64KB or more is
 * rejected as not being ByteKiller at all — the packer's whole point being
 * files rather larger than that. `tst.b 4(a0)`, the byte above it, would have
 * meant "under sixteen megabytes" and is presumably what was wanted. It is
 * reproduced because `=Bpk Length` answering 0 is exactly what a program
 * would see, and a fixed version would unpack banks the library refuses.
 */
export function bpkLength(data: Uint8Array): number {
  const long = (at: number): number =>
    at + 3 < data.length ? (((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0) : 0
  // the self-extracting form: "ave2" at $4c, the length at 238
  if (long(0x4c) === 0x61766532) return long(238) | 0
  // and the bare form, by elimination
  if (long(0) === 0x3f3) return 0 // HUNK_HEADER: an executable, not crunched data
  if ((data[0] ?? 1) !== 0) return 0
  if ((data[5] ?? 1) !== 0) return 0
  if (long(8) === 0) return 0
  return long(4) | 0
}

/** where the bitstream starts, past a self-extractor's stub if there is one */
export function bpkDataStart(data: Uint8Array): number {
  const at = 0x4c
  const sig =
    at + 3 < data.length ? (((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0) : 0
  return sig === 0x61766532 ? 234 : 0
}

/**
 * Decrunch a ByteKiller stream — `Bk1` to `Bk9`, and the whole of it.
 *
 * Throws on a stream that runs off either end rather than walking into
 * whatever is next in memory, which is what the original does: there is no
 * bounds check anywhere in those sixty instructions.
 */
export function bpkDecrunch(file: Uint8Array): Uint8Array {
  const base = bpkDataStart(file)
  const data = base === 0 ? file : file.subarray(base)
  if (data.length < HEADER) throw new Error('ByteKiller: no header')

  const long = (at: number): number =>
    (((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0)

  const packed = long(0)
  const outLen = long(4)
  // d5, the accumulator nothing reads. See the note at the top of this file
  let checksum = long(8)

  const out = new Uint8Array(outLen)
  // a0, walking DOWN from the end of the crunched data; a2, down from the end
  // of the output
  let src = HEADER + packed
  let dst = outLen
  if (src > data.length) throw new Error('ByteKiller: crunched length past the end')

  /** the next longword down, checksummed on the way past */
  const nextLong = (): number => {
    src -= 4
    if (src < HEADER) throw new Error('ByteKiller: bitstream underrun')
    const v = long(src)
    checksum ^= v
    return v >>> 0
  }

  // the shift register, primed with the LAST longword of the stream. The
  // packer put the sentinel there itself -- it is that longword's highest set
  // bit -- so the priming read needs no adjustment and the first `lsr.l`
  // hands back real data
  let bits = nextLong()

  /** `lsr.l #1,d0` and the reload the source hangs off its Z flag */
  const bit = (): number => {
    const outBit = bits & 1
    bits = bits >>> 1
    if (bits !== 0) return outBit
    // the bit that just came out was the sentinel, not data: reload, push a
    // fresh sentinel into bit 31 and take the real bit out of the bottom
    const v = nextLong()
    bits = (0x8000_0000 | (v >>> 1)) >>> 0
    return v & 1
  }

  /** `Bk8` — n bits, most significant first */
  const bitsOf = (n: number): number => {
    let v = 0
    for (let i = 0; i < n; i++) v = ((v << 1) | bit()) >>> 0
    return v
  }

  /** `Bk5` — copy count bytes from dst + offset, backwards */
  const match = (count: number, offset: number): void => {
    for (let i = 0; i < count; i++) {
      dst--
      if (dst < 0 || dst + offset >= outLen) throw new Error('ByteKiller: match out of range')
      out[dst] = out[dst + offset]!
    }
  }

  /** `Bk2` — count literal bytes, each eight bits out of the stream */
  const literals = (count: number): void => {
    for (let i = 0; i < count; i++) {
      dst--
      if (dst < 0) throw new Error('ByteKiller: literal run past the start')
      out[dst] = bitsOf(8) & 0xff
    }
  }

  // `Bk6 cmpa.l a2,a1 / blt.s Bk1` -- round again while the write pointer is
  // still above the start of the output
  for (;;) {
    if (dst <= 0) break
    if (bit() === 0) {
      // `moveq #8,d1 / moveq #1,d3` are set before the second bit is read,
      // which is what makes the 0-1 case a two-byte match at an 8-bit offset
      if (bit() === 1) match(2, bitsOf(8))
      else literals(bitsOf(3) + 1)
      continue
    }
    const kind = bitsOf(2)
    if (kind < 2) {
      // 9 or 10 bits of offset, 3 or 4 bytes of match -- `add.w d2,d1` and
      // `addq.w #2,d2` off the same two-bit value
      match(kind + 3, bitsOf(9 + kind))
    } else if (kind === 2) {
      const count = bitsOf(8)
      match(count + 1, bitsOf(12))
    } else {
      literals(bitsOf(8) + 9)
    }
  }
  // the accumulator is complete and, as on the machine, unexamined
  void checksum
  return out
}
