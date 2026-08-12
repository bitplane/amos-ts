/**
 * `lh.library`'s decoder, against streams whose bits are worked out here
 * rather than produced by an encoder of mine.
 *
 * The trap this file is built to avoid is the one ./bytekiller.test.ts walked
 * into: an encoder written from the same reading as the decoder agrees with
 * itself all the way to a wrong answer. So the Huffman paths below are
 * computed from the tree's DEFINING RECURRENCE — node n's parent is
 * `317 + (n >> 1)`, which falls out of the second init loop — and not from
 * ./lh.ts's own tree.
 *
 * What that covers: the tree's shape, the walk, the leaf encoding, the
 * literal and length dispatch, and the position decode. What it cannot cover
 * is the update loop after the first symbol, because predicting the tree's
 * second state means implementing the update. ./lh.corpus.test.ts pins the
 * tables and constants against the shipped binary; between them that is as
 * far as this can be taken without a real LH18 stream, and the corpus has
 * none — the magic is Explode's own wrapper, so only a program that ran
 * `Lpk Pack` would ever have written one.
 */
import { describe, expect, it } from 'vitest'
import { lhDecode, lhMatchLength, lhUnpackBank } from './lh'

const N_CHAR = 317
const ROOT = 2 * N_CHAR - 2

/**
 * The path to symbol `s` in the INITIAL tree, most significant bit first.
 *
 * Straight from the init loop: `for j = N_CHAR..R` pairs nodes `2k` and
 * `2k+1` under node `N_CHAR + k`, so node n's parent is `317 + (n >> 1)` and
 * which child it is is `n & 1`. Symbol s is leaf node s.
 */
function initialPath(s: number): number[] {
  const bits: number[] = []
  let n = s
  while (n !== ROOT) {
    bits.push(n & 1)
    n = N_CHAR + (n >> 1)
  }
  return bits.reverse()
}

/** bits into big-endian 16-bit words, which is how the decoder reads them */
function pack(bits: number[]): Uint8Array {
  const words = Math.ceil(bits.length / 16)
  const out = new Uint8Array(words * 2)
  bits.forEach((b, i) => {
    if (b) out[(i >> 4) * 2 + ((i >> 3) & 1)] = out[(i >> 4) * 2 + ((i >> 3) & 1)]! | (0x80 >> (i & 7))
  })
  return out
}

/** an n-bit field, most significant first */
const field = (v: number, n: number): number[] => Array.from({ length: n }, (_, i) => (v >> (n - 1 - i)) & 1)

describe('lh.library: the initial tree', () => {
  it('is balanced, so every symbol costs eight or nine bits before adaptation', () => {
    const lens = Array.from({ length: N_CHAR }, (_, s) => initialPath(s).length)
    expect(Math.min(...lens)).toBe(8)
    expect(Math.max(...lens)).toBe(9)
  })

  it('and the decoder walks it to the symbol the recurrence says', () => {
    // one literal, then the END symbol -- but the tree has already moved by
    // the time END is read, so stop the output with `limit` instead
    for (const s of [0, 1, 65, 200, 255]) {
      const out = lhDecode(pack(initialPath(s)), 1)
      expect([s, [...out]]).toEqual([s, [s]])
    }
  })

  it('symbol 316 ends the stream, and produces nothing', () => {
    expect([...lhDecode(pack(initialPath(316)), 8)]).toEqual([])
  })
})

describe('lh.library: the length symbols, which is the computed jump', () => {
  /*
   * The claim that cost the most to establish, and the one a reader would
   * most likely take from LZHUF instead of from the binary: the shortest
   * match this format can name is ONE byte, not three.
   *
   * It is not a table lookup in the library and it is not one here. The
   * length falls out of where `jmp $4a4(pc,d7.w)` lands in an unrolled run of
   * sixty `move.b`, and both ends of that run are held to the shipped bytes
   * in ./lh.corpus.test.ts -- which is what makes the arithmetic below more
   * than an assertion about itself.
   */
  it('symbol 256 copies one byte, where LZHUF has no symbol below three', () => {
    expect(lhMatchLength(256)).toBe(1)
    expect(lhMatchLength(257)).toBe(2)
  })

  it('and symbol 315 copies sixty, one per move in the unrolled run', () => {
    expect(lhMatchLength(315)).toBe(60)
    // sixty lengths and 256 literals and an end marker is the whole alphabet
    expect(315 - 256 + 1 + 256 + 1).toBe(N_CHAR)
  })

  it('a length symbol decodes as a match rather than a literal', () => {
    // no END symbol follows -- the tree has moved by then and its path
    // cannot be computed here -- so the limit is what stops it. The point is
    // that the output is a MATCH's worth of bytes and not one literal
    const stream = pack([...initialPath(256 + 9), ...field(0, 8), 0])
    expect(lhDecode(stream, 10).length).toBe(10)
  })
})

describe('lh.library: what LhDecode does with what it produced', () => {
  it('stops at the limit rather than running on', () => {
    // three copies of the same literal path would need the updated tree, so
    // the limit is what a short stream is checked against
    const out = lhDecode(pack(initialPath(65)), 1)
    expect(out.length).toBe(1)
  })

  it('and a stream that never ends is bounded by the limit, not by trust', () => {
    // all-zero input decodes to something; the point is that it terminates
    const out = lhDecode(new Uint8Array(64), 32)
    expect(out.length).toBeLessThanOrEqual(32)
  })
})

describe('lh.library: Explode’s LH18 wrapper', () => {
  function bank(magic: string, len: number, body: Uint8Array): Uint8Array {
    const out = new Uint8Array(8 + body.length)
    out.set([...magic].map((c) => c.charCodeAt(0)))
    out[4] = (len >>> 24) & 0xff
    out[5] = (len >>> 16) & 0xff
    out[6] = (len >>> 8) & 0xff
    out[7] = len & 0xff
    out.set(body, 8)
    return out
  }

  it('reads the length out of the header and decodes to it', () => {
    const out = lhUnpackBank(bank('LH18', 1, pack(initialPath(90))))
    expect(out && [...out]).toEqual([90])
  })

  it('and refuses anything that is not the library’s own version stamp', () => {
    // "LH18" is "LH" plus "1.8" -- a version, not a format id, so no other
    // LZH tool writes it
    expect(lhUnpackBank(bank('LH17', 1, pack(initialPath(90))))).toBe(null)
    expect(lhUnpackBank(bank('-lh5', 1, pack(initialPath(90))))).toBe(null)
    expect(lhUnpackBank(new Uint8Array(4))).toBe(null)
  })
})
