/**
 * `lh.library` 1.8 — LhDecode and LhEncode.
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
 * LVO -48 ($1f6) with its body at $2a8 and the 256-word table at $428, and
 * `LhEncode` at LVO -42 ($1ce) with its body at $628 and its own 64-pair
 * table at $9b2. Between them they are the whole library bar the four
 * housekeeping vectors.
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
 * long streams and nothing else, because the encoder freezes at the same
 * moment: `cmpi.w #$8000,-$2cda(a3)` at $7f8 reads the same `freq[R]` the
 * decoder tests at $35e. A file this library packed is not an LZHUF file, and
 * LZHUF will not read it once either side passes $8000.
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
 * `LhEncode` does emit them: its `cmpi.w #$2,d6 / bcs` at $964 sends only
 * match_length 0 and 1 down the literal path, so a TWO-byte match is coded as
 * a match. One-byte matches it never writes, and the decoder honours them
 * anyway.
 */
const THRESHOLD = 1
/** the symbol that ends the stream — the last one, above every match length */
const END_SYMBOL = N_CHAR - 1
/** `N` — the window, and the modulus every position is taken around */
const N = 4096
/** `F` — the lookahead, and the longest match the unrolled copy can do */
const F = 60
/** `NIL`, which the library writes as the byte offset $2000 */
const NIL = N

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
 * How many CODES share a slot count, and the extra bits that go with it.
 *
 * Read down the column: one code covering 32 table slots, then three covering
 * 16 each, then eight covering 8, and so on to sixteen codes with a slot
 * apiece. 64 codes and 256 slots — the nearer the match, the more precisely
 * its position is worth naming, so the bands narrow as the distance grows.
 *
 * BOTH position tables come out of this, the decoder's at $428 and the
 * encoder's at $9b2, which is a claim ./lh.corpus.test.ts checks against all
 * 640 shipped bytes rather than one this file asserts about itself.
 */
const BANDS: Array<[codes: number, slots: number, extra: number]> = [
  [1, 32, 0],
  [3, 16, 1],
  [8, 8, 2],
  [12, 4, 3],
  [24, 2, 4],
  [16, 1, 5],
]

/**
 * `d_code` and `d_len - 3`, the 256 words at $428.
 *
 * Built rather than transcribed, because the run lengths ARE the table: 32
 * entries of code 0, then 16 each up to code 3, then 8 each, then 4, then 2,
 * then one apiece, with the extra-bit count going up by one at each step.
 */
function positionTable(): { code: Uint8Array; extra: Uint8Array } {
  const bands = BANDS
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

/**
 * `p_code` and `p_len`, the 64 word pairs at $9b2 — the same six bands read
 * the other way round, for writing a position instead of reading one.
 *
 * Built rather than transcribed for the same reason the decoder's table is,
 * and it is the stronger claim of the two: the code is CANONICAL over the
 * band lengths, so the whole 128 bytes follow from the six numbers already
 * established. Start at length 3 with code 0, take the next code at each
 * step, and shift left by one every time the length grows — 0, then 2,3,4 at
 * four bits, then 10..17 at five, and so on to 240..255 at eight. Each is
 * then left-justified in a byte, which is what the emitter's `clr.b d1`
 * expects. ./lh.corpus.test.ts checks all 128 shipped bytes.
 */
function encodePositionTable(): { code: Uint8Array; len: Uint8Array } {
  const code = new Uint8Array(64)
  const len = new Uint8Array(64)
  let c = 0
  let value = 0
  let bits = 3
  for (const [codes, , ex] of BANDS) {
    value <<= ex + 3 - bits
    bits = ex + 3
    for (let n = 0; n < codes; n++, c++, value++) {
      len[c] = bits
      code[c] = value << (8 - bits)
    }
  }
  return { code, len }
}

const ENCODE_POSITION = encodePositionTable()

/** the code half of the 64 pairs at $9b2, left-justified in a byte */
export const LH_P_CODE: Uint8Array = ENCODE_POSITION.code
/** and how many of those bits count */
export const LH_P_LEN: Uint8Array = ENCODE_POSITION.len

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

/**
 * `LhEncode` — LVO -42 at $1ce, body at $628.
 *
 * The other half of the library, and the same algorithm read the other way:
 * LZHUF's encoder with binary search trees over the 4KB window, feeding the
 * same adaptive Huffman tree the decoder walks. `lh_Aux`'s 40000 bytes (where
 * decoding asks for 4500) is almost all search structure —
 *
 *     text_buf   $1152   4156 WORDS, one byte each, zero-filled
 *     lson       $31ca   4097 words
 *     rson       $51cc   4353 words, the last 256 being the hash heads
 *     dad        $73ce   4096 words, all NIL
 *
 * — plus the tree at the front, which is at exactly the offsets the decoder
 * uses, so ./Tree serves both.
 *
 * ## What had to come from the binary
 *
 *   - the tree FREEZES at MAX_FREQ here too. `cmpi.w #$8000,-$2cda(a3)` at
 *     $7f8 is the same test the decoder makes at $35e, and the encoder
 *     branching past its update is what keeps the two halves in step. Get
 *     this wrong and a long stream decodes correctly right up to the byte
 *     where the root count crosses $8000.
 *   - a TWO-byte match is worth coding. `cmpi.w #$2,d6 / bcs` at $964 sends
 *     only 0 and 1 to the literal path, where LZHUF's threshold is 3.
 *   - there is no `for (i = 1; i <= F; i++) InsertNode(r - i)` before the
 *     loop. LZHUF seeds its trees with F positions of the initial fill; this
 *     library does not, and its text_buf is zeroed rather than filled with
 *     spaces.
 *   - a full-length compare comes out of the search as SIXTY-ONE, not sixty.
 *     `dbne d2,$6b4` from 57 falls out with d2 = -1 when all 60 words match,
 *     and `neg.w d2 / addi.w #$3c,d2` turns that into 61. It is harmless only
 *     because the main loop clamps to `len`, which is never above 60.
 *
 * ## DEFECT: the destination length is never read
 *
 * `$c(a0)` — `lh_DstSize` — is WRITTEN at $640 with what was produced and
 * read nowhere. There is no bound on the output. Explode's `Lpk Pack` sizes
 * its destination `SrcSize + SrcSize/8` (source lines 3341-3347), and
 * adaptive Huffman on incompressible data goes over 112.5% easily: 60 random
 * bytes cost nine bits each before the tree learns anything, which is 12.5%
 * over on its own before a single position field. On the machine that is a
 * heap overrun with no diagnostic.
 *
 * This port cannot reproduce a heap overrun and would not want to. It grows
 * its output, and `Lpk Pack` records the divergence — see ../runtime/
 * explode.ts.
 */
export function lhEncode(src: Uint8Array): Uint8Array {
  const tree = new Tree()
  // `move.l d1,(a6)+` over $1f88 bytes, then the lookahead: one BYTE per word
  // in the library, and the high halves stay zero for the whole run, which is
  // why its word compares behave as byte compares
  const text = new Uint8Array(N + F)
  // the widths are the gaps between the arrays in the buffer: lson is
  // indexed by a node or by NIL, rson by those plus the 256 hash heads above
  // them, and dad only ever by a node or NIL -- which the delete walk leans
  // on, since `dad[rson[p]]` runs with rson[p] === NIL
  const lson = new Int16Array(N + 1)
  const rson = new Int16Array(N + 257)
  const dad = new Int16Array(N + 1)
  // only these two are initialised — `move.l #$20002000,d1` over 256 words of
  // hash head and 4096 of dad. lson and rson[0..N] are whatever CreateBuffer's
  // MEMF_CLEAR left, and InsertNode writes both before reading either.
  rson.fill(NIL, N + 1, N + 257)
  dad.fill(NIL, 0, N)

  const out: number[] = []
  /** the word being filled, and how many of its bits are still free */
  let cur = 0
  let free = 16

  /**
   * `putbits`, which both emitters end in.
   *
   * The code arrives LEFT-JUSTIFIED in sixteen bits, is rotated down into
   * place as a longword, and the half that did not fit becomes the next
   * word's head. `sub.b d3,d7 / bgt` — a count of exactly zero free bits
   * flushes, so the next word starts clean.
   *
   * DEVIATION: a code longer than sixteen bits would lose its top. The
   * library has the same limit and the same silence about it; the tree's
   * depth is what keeps it out of reach, and nothing here or there checks.
   */
  const putBits = (code: number, n: number): void => {
    const v = (code << 16) >>> 0
    const rolled = (((v << free) | (v >>> (32 - free))) >>> 0) & 0xffffffff
    cur |= rolled & 0xffff
    free -= n
    if (free > 0) return
    out.push(cur)
    cur = (rolled >>> 16) & 0xffff
    free += 16
  }

  /** `EncodeChar` at $7b8: the leaf-to-root walk, emitted root-first */
  const encodeChar = (c: number): void => {
    const leaf = -(2 * c + 2)
    let node = tree.prnt(leaf)
    let code = 0
    let len = 0
    // `btst d2,d1` on bit 1 of the byte offset — which child this node is
    do {
      code >>= 1
      if (node & 2) code |= 0x8000
      len++
      node = tree.prnt(node)
    } while (node !== 2 * R)
    putBits(code, len)
    tree.update(leaf)
  }

  /**
   * `EncodePosition` at $97a: six code bits from the table, then the low six
   * of the position.
   *
   * `ror.l #$7,d0` does both halves of the split at once — the top six bits
   * of the position fall out as the table index and the bottom six come back
   * round in the high word, already left-justified.
   */
  const encodePosition = (pos: number): void => {
    const i = pos >> 6
    const bits = LH_P_LEN[i]!
    putBits((LH_P_CODE[i]! << 8) | (((pos & 0x3f) << 10) >>> bits), bits + 6)
  }

  /** the two variables the search leaves behind, at aux + $93d0 and $93d2 */
  let matchPosition = 0
  let matchLength = 0

  /** `DeleteNode` at $734, LZHUF's unchanged */
  const deleteNode = (p: number): void => {
    if (dad[p] === NIL) return
    let q: number
    if (rson[p] === NIL) q = lson[p]!
    else if (lson[p] === NIL) q = rson[p]!
    else {
      q = lson[p]!
      if (rson[q] !== NIL) {
        do q = rson[q]!
        while (rson[q] !== NIL)
        rson[dad[q]!] = lson[q]!
        dad[lson[q]!] = dad[q]!
        lson[q] = lson[p]!
        dad[lson[p]!] = q
      }
      rson[q] = rson[p]!
      dad[rson[p]!] = q
    }
    dad[q] = dad[p]!
    if (rson[dad[p]!] === p) rson[dad[p]!] = q
    else lson[dad[p]!] = q
    dad[p] = NIL
  }

  /**
   * `InsertNode` at $64c: put position `r` into the tree, and leave the best
   * match found on the way down in `matchLength` / `matchPosition`.
   *
   * The hash is `N + 1 + text[r]`, so each first byte gets its own tree.
   */
  const insertNode = (r: number): void => {
    let cmp = 1
    let p = N + 1 + text[r]!
    lson[r] = NIL
    rson[r] = NIL
    matchLength = 0
    for (;;) {
      if (cmp >= 0) {
        if (rson[p] === NIL) {
          rson[p] = r
          dad[r] = p
          return
        }
        p = rson[p]!
      } else {
        if (lson[p] === NIL) {
          lson[p] = r
          dad[r] = p
          return
        }
        p = lson[p]!
      }
      // 60 comparisons at most, and `dbne` running out gives 61
      let i = 1
      for (; i <= F; i++) {
        cmp = text[r + i]! - text[p + i]!
        if (cmp !== 0) break
      }
      if (i > F) i = F + 1
      if (i < matchLength) continue
      if (i === matchLength) {
        // `bcc $670` — a tie only moves the position if it is NEARER
        const d = (r - p) & (N - 1)
        if (d < matchPosition) matchPosition = d
        continue
      }
      matchLength = i
      matchPosition = (r - p) & (N - 1)
      if (i < F) continue
      // a full-length match replaces the node outright
      dad[r] = dad[p]!
      lson[r] = lson[p]!
      rson[r] = rson[p]!
      dad[lson[p]!] = r
      dad[rson[p]!] = r
      if (rson[dad[p]!] === p) rson[dad[p]!] = r
      else lson[dad[p]!] = r
      dad[p] = NIL
      return
    }
  }

  // the lookahead, up to 60 bytes at text[N - F]
  let at = 0
  let len = 0
  for (; len < F && at < src.length; len++) text[N - F + len] = src[at++]!
  if (len === 0) {
    // DEVIATION: the library's loop does not terminate on an empty source --
    // `subq.w #1,$4206(a4)` takes `len` to -1 and it writes 65535 symbols of
    // rubbish before the counter wraps back to zero. `Lpk Pack` cannot reach
    // it, because a reserved bank always has a payload.
    encodeChar(END_SYMBOL)
    if (free !== 16) out.push(cur)
    return wordsToBytes(out)
  }

  let s = 0
  let r = N - F
  insertNode(r)

  do {
    if (matchLength > len) matchLength = len
    if (matchLength < 2) {
      // `moveq #1,d6` then the literal, which is text[r] and not the byte
      // just read
      matchLength = 1
      encodeChar(text[r]!)
    } else {
      encodeChar(255 + matchLength)
      encodePosition(matchPosition)
    }
    const last = matchLength
    for (let k = 0; k < last; k++) {
      deleteNode(s)
      if (at < src.length) {
        const c = src[at++]!
        text[s] = c
        // `cmpi.w #$76,d0 / bcc` — the first F-1 bytes are mirrored above the
        // window so a match can run off the end of it
        if (s < F - 1) text[s + N] = c
      } else if (--len === 0) {
        encodeChar(END_SYMBOL)
        if (free !== 16) out.push(cur)
        return wordsToBytes(out)
      }
      s = (s + 1) & (N - 1)
      r = (r + 1) & (N - 1)
      insertNode(r)
    }
  } while (len > 0)

  encodeChar(END_SYMBOL)
  if (free !== 16) out.push(cur)
  return wordsToBytes(out)
}

/** the output is a run of big-endian words, which is how the decoder reads it */
function wordsToBytes(words: number[]): Uint8Array {
  const out = new Uint8Array(words.length * 2)
  words.forEach((w, i) => {
    out[i * 2] = (w >> 8) & 0xff
    out[i * 2 + 1] = w & 0xff
  })
  return out
}

/**
 * `Lpk Pack`'s bank: "LH18", the original length, then the stream.
 *
 * The counterpart to ./lhUnpackBank, and the reason `Lpk Length` recognises
 * nothing another LZH tool wrote — the magic is the library's own version.
 */
export function lhPackBank(data: Uint8Array): Uint8Array {
  const body = lhEncode(data)
  const out = new Uint8Array(8 + body.length)
  out[0] = 0x4c
  out[1] = 0x48
  out[2] = 0x31
  out[3] = 0x38
  out[4] = (data.length >>> 24) & 0xff
  out[5] = (data.length >>> 16) & 0xff
  out[6] = (data.length >>> 8) & 0xff
  out[7] = data.length & 0xff
  out.set(body, 8)
  return out
}
