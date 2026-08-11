/**
 * `\SOLARIS/` — the packer on the CRAFT installer disk.
 *
 * Not a public Amiga cruncher and not on Aminet. SOLARIS is the Finnish house
 * that built CRAFT's install disk — its logo is one of the three pictures on
 * that disk, beside `Finnish_Dragon.iff` — and this is their in-house format.
 * It is here rather than beside the CRAFT port because it is a codec like
 * ./powerpacker.ts and ./imploder.ts, and because five files on that disk are
 * packed with it and every one of them is evidence somebody will want later.
 *
 * ## Where the format was read
 *
 * From the installer, `CRAFT_Files/Installer`, which is a COMPILED AMOS
 * program: fourteen hunks, no relocs, the last six of them AMOS memory banks
 * (`Sprites`, `Icons`, `Datas`, three `Pac.Pic.`). The decruncher is in hunk 1
 * at **$cce6..$cdac**, and the routines it calls are $cd88 (refill) and $cd94
 * (read n bits). Two false leads are worth naming so the next reader skips
 * them: the `\SOLARIS/` text at hunk 1 +$e46e is a length-prefixed AMOS string
 * literal in a table, nothing points at it PC-relative, and it is compared by
 * the BASIC half; and the `Datas` bank holds a whole second hunk file that
 * turns out to be Commodore's disk `Format`, for preparing the target disk.
 *
 * The register contract at entry is `d1` = packed length, `d3` = destination,
 * so the original decrunches IN PLACE — packed data at the bottom of a buffer
 * the size of the output, read pointer descending from the end of the packed
 * bytes, write pointer descending from the end of the buffer, the reader
 * always below the writer. This port reads and writes separate arrays, which
 * is the same computation without the aliasing.
 *
 * ## The format
 *
 * Everything is BACKWARDS. The stream is read from its end, a longword at a
 * time, and the output is filled from ITS end downward.
 *
 *     [ bitstream, longwords ][ checksum:4 ][ decrunched length:4 ]
 *
 * `checksum` is a seed: the decruncher EORs every bitstream longword into it
 * as it reads, and the fold must end at zero. That is the only integrity
 * check the format has, and it is a real one — it covers the whole stream.
 *
 * A longword feeds 32 bits, lowest bit first. When the buffer runs dry the
 * refill at $cd88 reads the next longword down and rotates it right through X
 * with X preset, which parks a sentinel 1 in bit 31; the buffer hits zero
 * exactly when those 32 bits are spent, and the sentinel is discarded rather
 * than used. The FIRST longword gets no sentinel added, so the packer has to
 * put one there itself: its topmost set bit terminates it, and only the bits
 * below that one are data.
 *
 * Six opcodes. Offsets are a distance back from the byte being written, and
 * counts are stored one short of the length:
 *
 *     0 0  nnn                 literal run, n+1 bytes    (1..8)
 *     1 11 nnnnnnnn            literal run, n+9 bytes    (9..264)
 *     0 1  oooooooo            copy 2 bytes,  8-bit offset
 *     1 00 ooooooooo           copy 3 bytes,  9-bit offset
 *     1 01 oooooooooo          copy 4 bytes, 10-bit offset
 *     1 10 nnnnnnnn oooo(x12)  copy n+1 bytes (1..256), 12-bit offset
 *
 * Literal bytes are eight bits each, MSB first, and the run count is read
 * before them. The two literal opcodes are the same code path at $cd16 with
 * different `d1`/`d4`, which is why one is under the `0` prefix and the other
 * under `1 11`: the 3-bit form was worth a shorter prefix.
 *
 * ## The cruncher here is not theirs
 *
 * `solarisCrunch` emits a conformant stream; it does not reproduce SOLARIS's
 * parse, and nothing needs it to. It exists so the decoder can be tested
 * round-trip without the corpus, the way ./stonecracker.ts and ./imploder.ts
 * are, and because a built stream is the only way to exercise an opcode the
 * five real files happen not to use.
 */

/** the tag the CRAFT installer writes in front of a packed stream */
export const SOLARIS_TAG = '\\SOLARIS/'

/** longest match the 8-bit count can express */
export const SOLARIS_MAX_MATCH = 256

/** furthest back the 12-bit offset can reach */
export const SOLARIS_MAX_OFFSET = 4095

/** longest run the 8-bit literal count can express */
export const SOLARIS_MAX_LITERALS = 264

/**
 * A port-side bound, not the format's: the trailer's length is trusted by the
 * original, which had 512K of Amiga to lose if it was wrong. Nothing on the
 * CRAFT disk comes near this.
 */
const SANE_LENGTH = 1 << 26

const tagBytes = (): Uint8Array => Uint8Array.from(SOLARIS_TAG, (c) => c.charCodeAt(0))

const beLong = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0

/** whether `data` carries the installer's `\SOLARIS/` tag */
export function isSolaris(data: Uint8Array): boolean {
  const tag = tagBytes()
  if (data.length < tag.length) return false
  return tag.every((b, i) => data[i] === b)
}

/** the stream without the installer's tag, if it has one */
const body = (data: Uint8Array): Uint8Array => (isSolaris(data) ? data.subarray(SOLARIS_TAG.length) : data)

/** the decrunched size the trailer declares, without decrunching */
export function solarisLength(data: Uint8Array): number {
  const s = body(data)
  if (s.length < 12) throw new Error('solaris: stream is too short to hold a trailer')
  return beLong(s, s.length - 4)
}

/**
 * Decrunch a `\SOLARIS/` stream, with or without the installer's tag.
 *
 * Throws on a bad checksum, because the format's one integrity check is worth
 * honouring: the original answers -1 there and its caller refuses the file.
 */
export function solarisDecrunch(data: Uint8Array): Uint8Array {
  const s = body(data)
  if (s.length < 12) throw new Error('solaris: stream is too short to hold a trailer')

  let src = s.length
  const long = (): number => {
    src -= 4
    if (src < 0) throw new Error('solaris: ran off the front of the packed data')
    return beLong(s, src)
  }

  const length = long()
  let csum = long()
  let bits = long()
  csum = (csum ^ bits) >>> 0

  if (length === 0) throw new Error('solaris: the trailer declares an empty file')
  if (length > SANE_LENGTH) throw new Error(`solaris: the trailer declares ${length} bytes`)

  const out = new Uint8Array(length)
  let dst = length

  /** one bit, lowest first; the sentinel that empties the buffer is discarded */
  const bit = (): number => {
    let c = bits & 1
    bits >>>= 1
    if (bits === 0) {
      bits = long()
      csum = (csum ^ bits) >>> 0
      c = bits & 1
      bits = ((bits >>> 1) | 0x8000_0000) >>> 0
    }
    return c
  }

  /** n bits, MSB first — $cd94, which accumulates in a WORD */
  const take = (n: number): number => {
    let v = 0
    for (let i = 0; i < n; i++) v = ((v << 1) | bit()) & 0xffff
    return v
  }

  const literals = (countBits: number, base: number): void => {
    const n = take(countBits) + base
    for (let i = 0; i <= n; i++) {
      const b = take(8)
      if (dst <= 0) throw new Error('solaris: literal run overran the start of the output')
      out[--dst] = b
    }
  }

  const copy = (offsetBits: number, n: number): void => {
    const off = take(offsetBits)
    for (let i = 0; i <= n; i++) {
      dst -= 1
      if (dst < 0) throw new Error('solaris: match overran the start of the output')
      out[dst] = out[dst + off]!
    }
  }

  // `dst` moves inside the helpers above, so the exit test is explicit
  for (;;) {
    if (dst <= 0) break
    if (bit() === 1) {
      const sel = take(2)
      if (sel < 2) copy(9 + sel, sel + 2)
      else if (sel === 3) literals(8, 8)
      else copy(12, take(8))
    } else {
      // a second bit, read only under the `0` prefix: 1 is the short match
      const short = bit()
      if (short === 1) copy(8, 1)
      else literals(3, 0)
    }
  }

  if (csum !== 0) throw new Error(`solaris: checksum failed, folded to ${csum.toString(16)}`)
  return out
}

/**
 * Pack `data` into a conformant stream, tag included.
 *
 * Greedy longest-match, which is not what SOLARIS did — see the header. The
 * point is a stream their decruncher would have accepted, so that
 * `solarisDecrunch(solarisCrunch(x))` is a real test of the decoder.
 */
export function solarisCrunch(data: Uint8Array): Uint8Array {
  if (data.length === 0) throw new Error('solaris: nothing to crunch')

  // the decoder consumes bits in this order; the packing below reverses it
  const seq: number[] = []
  const put = (v: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--) seq.push((v >>> i) & 1)
  }

  /*
   * Both the reader and the writer run from the end of the buffer downward,
   * so the encoder walks backwards too and a "match" looks FORWARD in the
   * array — out[dst + off] is a byte already written, one nearer the end.
   */
  const pending: number[] = []
  const flush = (): void => {
    while (pending.length > 0) {
      const n = Math.min(pending.length, SOLARIS_MAX_LITERALS)
      /*
       * `pending` is already in the order the decoder wants: the encoder walks
       * down, so pending[0] is the HIGHEST byte of the run, and the decoder's
       * first store of a run is the highest too (`out[--dst]`). Take from the
       * front and do not reverse — getting either wrong emits the run
       * mirrored, which round-trips one byte and 1,000 identical bytes and
       * nothing in between.
       */
      const run = pending.splice(0, n)
      if (n <= 8) {
        put(0, 1)
        put(0, 1)
        put(n - 1, 3)
      } else {
        put(1, 1)
        put(3, 2)
        put(n - 9, 8)
      }
      for (const b of run) put(b, 8)
    }
  }

  let at = data.length
  while (at > 0) {
    let bestLen = 0
    let bestOff = 0
    const maxLen = Math.min(SOLARIS_MAX_MATCH, at)
    for (let off = 1; off <= SOLARIS_MAX_OFFSET && at + off <= data.length; off++) {
      let n = 0
      while (n < maxLen && at + off - 1 - n < data.length && data[at - 1 - n] === data[at + off - 1 - n]) n++
      if (n > bestLen) {
        bestLen = n
        bestOff = off
      }
      if (bestLen >= maxLen) break
    }

    if (bestLen >= 4 && bestOff <= 1023) {
      flush()
      at -= 4
      put(1, 1)
      put(1, 2)
      put(bestOff, 10)
    } else if (bestLen >= 3 && bestOff <= 511) {
      flush()
      at -= 3
      put(1, 1)
      put(0, 2)
      put(bestOff, 9)
    } else if (bestLen >= 3) {
      flush()
      const n = Math.min(bestLen, SOLARIS_MAX_MATCH)
      at -= n
      put(1, 1)
      put(2, 2)
      put(n - 1, 8)
      put(bestOff, 12)
    } else if (bestLen >= 2 && bestOff <= 255) {
      flush()
      at -= 2
      put(0, 1)
      put(1, 1)
      put(bestOff, 8)
    } else {
      at -= 1
      pending.push(data[at]!)
      if (pending.length >= SOLARIS_MAX_LITERALS) flush()
    }
  }
  flush()

  /*
   * The first longword read carries no added sentinel, so one has to be built
   * into it: its top set bit ends it and only the bits below are data. Give it
   * the remainder, 1..31 bits, and hand every other longword a full 32.
   */
  const spare = seq.length % 32
  const head = spare === 0 ? 31 : spare
  const lead = seq.slice(0, head)
  const rest = seq.slice(head)

  const words: number[] = []
  let w = 0
  for (let i = 0; i < lead.length; i++) w |= lead[i]! << i
  words.push((w | (1 << lead.length)) >>> 0)
  for (let i = 0; i < rest.length; i += 32) {
    w = 0
    for (let k = 0; k < 32 && i + k < rest.length; k++) w |= rest[i + k]! << k
    words.push(w >>> 0)
  }

  let csum = 0
  for (const v of words) csum = (csum ^ v) >>> 0

  const tag = tagBytes()
  const out = new Uint8Array(tag.length + words.length * 4 + 8)
  out.set(tag, 0)
  const view = new DataView(out.buffer)
  // stored so that reading backwards yields words[0] first
  for (let i = 0; i < words.length; i++) {
    view.setUint32(tag.length + (words.length - 1 - i) * 4, words[i]!, false)
  }
  view.setUint32(out.length - 8, csum, false)
  view.setUint32(out.length - 4, data.length, false)
  return out
}
