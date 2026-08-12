/**
 * `lh.library` 1.8 — LhDecode.
 *
 *     lh.library 1.8 (16 Dec 1990)
 *     Copyright 1990 by Holger P. Krekel & Olaf Barthel, all rights reserved.
 *
 * One of the libraries everyone on the Amiga assumed was in `LIBS:`, and the
 * corpus agrees: 2,864 bytes, six copies across three AMOS PD Library
 * volumes and the `LIBS:` of three different Workbench installs, every one
 * byte-identical. Explode 2.01's `Lpk Pack` and `Lpk Unpack` are the only
 * things in this port that want it. Vendored at `fixtures/libs/lh.library`.
 *
 * A FROM-THE-BINARY reimplementation: no source for this library is in the
 * corpus. Everything below was read out of the disassembly — `LhDecode` at
 * LVO -48 ($1f6), its body at $2a8, and the 256-word table at $428.
 *
 * ## It is LZHUF
 *
 * Haruhiko Okumura's LZHUF, near enough unmodified: LZSS with a 4KB window
 * over an ADAPTIVE HUFFMAN code that reshapes itself after every symbol. The
 * position table at $428 settles it beyond argument — 32 entries of code 0,
 * then sixteens, then eights, then fours, then twos, then singles, which is
 * LZHUF's `d_code[]` exactly, packed one word per entry as
 * `(d_code << 8) | (d_len - 3)`.
 *
 * The parameters are this library's own, and two of them are not LZHUF's:
 *
 *     N_CHAR  317    256 literals, 60 match lengths, and an END symbol
 *     T       633    2 * N_CHAR - 1, the whole tree
 *     R       632    T - 1, the root
 *     THRESHOLD 1    the shortest match, where LZHUF's is 3
 *     F        60    the longest
 *
 * ## The tables, which are all BYTE OFFSETS
 *
 * Everything the tree code touches is a byte offset rather than an index,
 * which is why the numbers below are all even and why `son` can be negative:
 *
 *     freq[k]   at  work + 2k          k = 0..T, and freq[T] is $ffff
 *     son[k]    at  work + $c60 + 2k
 *     prnt[v]   at  work + $76e + v    v SIGNED — see below
 *
 * A LEAF IS A NEGATIVE `son`. Symbol s has the value -(2s + 2), so the walk
 * can test for a leaf with nothing but the N flag the `move.w` already set —
 * `dbmi d5,$334` both counts the bit budget down and stops on a leaf in one
 * instruction. Recovering the symbol is `neg / lsr #1 / subq #1`.
 *
 * `prnt` is indexed by that same signed value, so it is addressed from a base
 * in the middle of itself: leaves land below `work + $76e` and internal nodes
 * above it.
 *
 * ## The one real divergence from LZHUF
 *
 * LZHUF's `update()` opens with `if (freq[R] == MAX_FREQ) reconst()` — halve
 * every frequency and rebuild the tree. THIS LIBRARY HAS NO `reconst`. The
 * test is there at $35e, `cmpi.w #$8000,$4f0(a5)`, and when it fires the
 * routine branches straight past the update to the symbol dispatch. So the
 * tree simply STOPS ADAPTING once the root count reaches $8000 and stays
 * frozen for the rest of the stream.
 *
 * That is a real difference and not a reading error — there is no
 * reconstruction anywhere in the 2,728-byte hunk. It costs a little ratio on
 * long streams and nothing else, because the encoder in the same library
 * necessarily freezes at the same moment. A file this library packed is not
 * an LZHUF file, and LZHUF will not read it once either side passes $8000.
 */

/** `N_CHAR` — 256 literals, 60 lengths, one end marker */
const N_CHAR = 317
/** `T` — every node of the tree */
const T = 2 * N_CHAR - 1
/** `R` — the root, which is the last internal node */
const R = T - 1
/** `MAX_FREQ`, where this library stops adapting instead of rebuilding */
const MAX_FREQ = 0x8000
/**
 * The shortest match a length symbol can mean, and it is ONE.
 *
 * Not a guess and not LZHUF's 3. The length is chosen by a computed jump into
 * an unrolled run of `move.b (a2)+,(a1)+` — `jmp $4a4(pc,d7.w)` at $424, with
 * d7 still holding the leaf value -(2s + 2). The run is exactly 60 moves,
 * $22c to $2a3, with a `bra.w` back to the loop at $2a4. Symbol 315 enters at
 * $22c and copies all 60; symbol 256 enters at $2a2 and copies one. So the
 * length is `s - 255`, and the first two symbols of the range mean matches of
 * one and two bytes that LZHUF has no way to express.
 *
 * Whether the encoder ever emits them is the encoder's business and is not
 * settled here; the decoder will honour them.
 */
const THRESHOLD = 1
/** the symbol that ends the stream — the last one, above every match length */
const END_SYMBOL = N_CHAR - 1

/**
 * What a length symbol copies, which is decided by ARITHMETIC ON A JUMP
 * TARGET rather than by a table.
 *
 * `jmp $4a4(pc,d7.w)` at $424, with d7 still the leaf value -(2s + 2), lands
 * in a run of 60 `move.b (a2)+,(a1)+` between $22c and $2a3. Symbol 315 lands
 * on the first and copies all sixty; symbol 256 lands on the last and copies
 * one. Both ends are pinned against the shipped bytes in ./lh.corpus.test.ts.
 */
export const lhMatchLength = (symbol: number): number => symbol - 256 + THRESHOLD

/**
 * `d_code` and `d_len - 3`, the 256 words at $428.
 *
 * Built rather than transcribed, because the run lengths ARE the table: 32
 * entries of code 0, then 16 each up to code 3, then 8 each, then 4, then 2,
 * then one apiece, with the extra-bit count going up by one at each step.
 * The construction is checked against all 512 shipped bytes in
 * ./lh.corpus.test.ts, which is the only honest way to claim it matches.
 */
function positionTable(): { code: Uint8Array; extra: Uint8Array } {
  /**
   * How many CODES share a slot count, and the extra bits that go with it.
   *
   * Read down the column: one code covering 32 table slots, then three
   * covering 16 each, then eight covering 8, and so on to sixteen codes with
   * a slot apiece. 64 codes and 256 slots, which is the whole table — the
   * nearer the match, the more precisely its position is worth naming, so the
   * bands narrow as the distance grows.
   */
  const bands: Array<[codes: number, slots: number, extra: number]> = [
    [1, 32, 0],
    [3, 16, 1],
    [8, 8, 2],
    [12, 4, 3],
    [24, 2, 4],
    [16, 1, 5],
  ]
  const code = new Uint8Array(256)
  const extra = new Uint8Array(256)
  let i = 0
  let c = 0
  for (const [codes, slots, ex] of bands) {
    for (let n = 0; n < codes; n++, c++) {
      for (let k = 0; k < slots; k++, i++) {
        code[i] = c
        extra[i] = ex
      }
    }
  }
  return { code, extra }
}

const POSITION = positionTable()

/** the code half of the shipped table, for the corpus test to check */
export const LH_POS_CODE: Uint8Array = POSITION.code
/** the extra-bit half, which is `d_len - 3` */
export const LH_POS_EXTRA: Uint8Array = POSITION.extra

/**
 * The adaptive Huffman tree, in the same three arrays the library keeps in
 * its work buffer — and in the same units, byte offsets, because the update
 * loop's swaps are much easier to follow that way.
 */
class Tree {
  /** `freq[k]` by node byte offset / 2 */
  readonly freq = new Uint16Array(T + 1)
  /** `son[k]` — negative for a leaf, the child's byte offset otherwise */
  readonly son = new Int16Array(T)
  /**
   * `prnt`, indexed by a SIGNED son value biased into an array.
   *
   * The library addresses this from `work + $76e` with a signed offset, so
   * leaves sit below the base and internal nodes above it. Here the same
   * thing is done with an explicit bias.
   */
  private readonly bias = N_CHAR * 2 + 2
  /**
   * Wide enough for BOTH sides of the bias, which is easy to get wrong.
   *
   * Leaf values run down to -(2 * N_CHAR) and internal-node offsets up to
   * 2 * R, so the span is the two added together. Sizing it to the tree alone
   * drops every internal node's parent silently — a typed array ignores an
   * out-of-range write and hands back `undefined` on the read — and the
   * update loop then spins on `node !== 0` forever.
   */
  private readonly prntArr = new Int16Array(N_CHAR * 2 + 2 + 2 * R + 2)

  constructor() {
    // init loop 1 ($2c4): every symbol a leaf of frequency one
    for (let i = 0; i < N_CHAR; i++) {
      this.freq[i] = 1
      this.son[i] = -(2 * i + 2)
      this.setPrnt(-(2 * i + 2), 2 * i)
    }
    // init loop 2 ($2f0): pair them up into internal nodes
    let i = 0
    for (let j = N_CHAR; j <= R; j++) {
      this.freq[j] = this.freq[i]! + this.freq[i + 1]!
      this.son[j] = 2 * i
      this.setPrnt(2 * i, 2 * j)
      this.setPrnt(2 * (i + 1), 2 * j)
      i += 2
    }
    // `move.w d1,(a1)` with d1 at -1, and `clr.w $c5e(a6)`
    this.freq[T] = 0xffff
    this.setPrnt(2 * R, 0)
  }

  prnt(v: number): number {
    return this.prntArr[v + this.bias]!
  }
  setPrnt(v: number, to: number): void {
    this.prntArr[v + this.bias] = to
  }

  /** `son[]` by byte offset, which is how the update loop indexes it */
  sonAt(off: number): number {
    return this.son[off >> 1]!
  }
  setSonAt(off: number, v: number): void {
    this.son[off >> 1] = v
  }
  freqAt(off: number): number {
    return this.freq[off >> 1]!
  }
  setFreqAt(off: number, v: number): void {
    this.freq[off >> 1] = v
  }

  /**
   * `update(c)` — the loop at $368, and LZHUF's without the `reconst`.
   *
   * Walk from the symbol's leaf to the root adding one to every frequency on
   * the way, and wherever that breaks the ordering, swap the node with the
   * last one of equal-or-lower count so the array stays sorted.
   */
  update(leafValue: number): void {
    // `cmpi.w #$8000,$4f0(a5) / beq` — the frozen tree, see the file header
    if (this.freq[R] === MAX_FREQ) return
    let node = this.prnt(leafValue)
    while (node !== 0) {
      const bumped = this.freqAt(node) + 1
      this.setFreqAt(node, bumped)
      // `cmp.w (a2)+,d1 / bls` — already in order, just climb
      if (bumped <= this.freqAt(node + 2)) {
        node = this.prnt(node)
        continue
      }
      // `$37a cmp.w (a2)+,d1 / bhi` — find where it belongs
      let swap = node + 2
      while (bumped > this.freqAt(swap + 2)) swap += 2
      this.setFreqAt(node, this.freqAt(swap))
      this.setFreqAt(swap, bumped)
      // and exchange the two subtrees, fixing both sets of parent links
      const sonNode = this.sonAt(node)
      if (sonNode >= 0) this.setPrnt(sonNode + 2, swap)
      this.setPrnt(sonNode, swap)
      const sonSwap = this.sonAt(swap)
      if (sonSwap >= 0) this.setPrnt(sonSwap + 2, node)
      this.setSonAt(swap, sonNode)
      this.setPrnt(sonSwap, node)
      this.setSonAt(node, sonSwap)
      node = this.prnt(swap)
    }
  }
}

/**
 * Decode an `LhEncode` stream.
 *
 * `limit` bounds the output the way `Lpk Unpack` does — the "LH18" header
 * carries the original length and the bank is reserved to it. The library
 * itself has no limit: it decodes until the END symbol and reports how far
 * it got, which is what the wrapper at $210 turns into `lh_DstSize`.
 */
export function lhDecode(src: Uint8Array, limit: number): Uint8Array {
  const tree = new Tree()
  const out = new Uint8Array(limit)
  let dst = 0

  let at = 0
  let buf = 0
  let have = 0

  /** `move.w (a0)+,d6` — sixteen bits at a time, and zeros past the end */
  const refill = (): void => {
    buf = ((src[at] ?? 0) << 8) | (src[at + 1] ?? 0)
    at += 2
    have = 16
  }

  /** `add.w d6,d6` — the top bit of the buffer */
  const bit = (): number => {
    if (have === 0) refill()
    const b = (buf >> 15) & 1
    buf = (buf << 1) & 0xffff
    have--
    return b
  }

  /** the eight-bit read at $3cc, which is these eight bits and no others */
  const byte = (): number => {
    let v = 0
    for (let i = 0; i < 8; i++) v = (v << 1) | bit()
    return v
  }

  refill()

  /** the tree walk at $330, ending on a negative `son` */
  const symbol = (): number => {
    let node = tree.sonAt(2 * R)
    while (node >= 0) node = tree.sonAt(node + (bit() ? 2 : 0))
    tree.update(node)
    // `neg.w / lsr.w #1 / subq.w #1` — the leaf value back to a symbol
    return (-node >> 1) - 1
  }

  /**
   * The position decode at $3cc: eight bits into the table for the top six,
   * then `d_len - 2` more bits for the bottom six.
   */
  const position = (): number => {
    const i = byte()
    const top = POSITION.code[i]! << 6
    let acc = i
    // `dbra d2` runs `extra + 1` times, which is LZHUF's `d_len - 2`
    for (let n = 0; n <= POSITION.extra[i]!; n++) acc = (acc << 1) | bit()
    return top | (acc & 0x3f)
  }

  for (;;) {
    const s = symbol()
    if (s === END_SYMBOL) break
    if (s < 256) {
      if (dst >= limit) break
      out[dst++] = s
      continue
    }
    // symbols 256.. are lengths, and the computed `jmp` into the unrolled
    // copy at $22c is what turns one into a byte count
    const len = lhMatchLength(s)
    // `lea (a1),a2 / suba.w d1,a2` — the distance is the position itself,
    // not the position plus one that LZHUF uses
    const from = dst - position()
    for (let n = 0; n < len; n++) {
      if (dst >= limit) break
      // a byte at a time, so an overlapping match repeats as it goes
      out[dst] = from + n >= 0 ? out[from + n]! : 0
      dst++
    }
  }
  return dst === limit ? out : out.subarray(0, dst)
}

/** Explode's own wrapper: "LH18", the original length, then the stream */
export const LH_MAGIC = 0x4c483138

/**
 * `Lpk Unpack`'s view of a bank — the eight-byte header `Lpk Pack` writes in
 * front of what `LhEncode` produced, and the stream after it.
 *
 * The magic is the LIBRARY'S VERSION, not a format identifier: "LH" and
 * "1.8". Nothing else writes it, so nothing else is readable here.
 */
export function lhUnpackBank(bank: Uint8Array): Uint8Array | null {
  if (bank.length < 8) return null
  const magic = ((bank[0]! << 24) | (bank[1]! << 16) | (bank[2]! << 8) | bank[3]!) >>> 0
  if (magic !== LH_MAGIC) return null
  const len = ((bank[4]! << 24) | (bank[5]! << 16) | (bank[6]! << 8) | bank[7]!) >>> 0
  return lhDecode(bank.subarray(8), len)
}
