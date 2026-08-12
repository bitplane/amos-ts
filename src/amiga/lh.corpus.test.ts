/**
 * `lh.library` against the shipped binary — the only check that can say the
 * reading is right rather than merely self-consistent.
 *
 * ./lh.ts builds its position table from the band structure instead of
 * transcribing 512 bytes, which is the readable choice and would be the wrong
 * one if the bands were even slightly off. So the construction is held here to
 * every byte the library actually carries, and the layout constants are read
 * back out of the binary rather than restated.
 *
 * Skipped when the fixture is absent; `fixtures/` is gitignored and the
 * library is not redistributed.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LH_P_CODE, LH_P_LEN, LH_POS_CODE, LH_POS_EXTRA } from './lh'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const path = join(root, 'fixtures', 'libs', 'lh.library')
const present = existsSync(path)

/** the one code hunk, at file offset 32 — 682 longwords of it */
function hunk(): Uint8Array {
  return new Uint8Array(readFileSync(path).subarray(32, 32 + 682 * 4))
}

describe.skipIf(!present)('lh.library 1.8, as shipped', () => {
  it('is the library the header says it is', () => {
    const text = readFileSync(path).toString('latin1')
    expect(text).toContain('lh.library 1.8 (16 Dec 1990)')
    expect(text).toContain('Holger P. Krekel & Olaf Barthel')
    // 2,864 bytes, and six byte-identical copies across the corpus
    expect(readFileSync(path).length).toBe(2864)
  })

  it('exports the four functions Explode names, at the LVOs it names them by', () => {
    const c = hunk()
    const long = (o: number): number => ((c[o]! << 24) | (c[o + 1]! << 16) | (c[o + 2]! << 8) | c[o + 3]!) >>> 0
    // romtag rt_Init -> the RTF_AUTOINIT table -> the vector table
    const vectors = long(0x94 + 4)
    expect(vectors).toBe(0xa4)
    // Open, Close, Expunge, a null, then the four real ones, then -1
    const at = (n: number): number => long(vectors + n * 4)
    expect([at(0), at(1), at(2), at(3)]).toEqual([0xf4, 0x102, 0x116, 0x14e])
    // _LVOCreateBuffer -30, DeleteBuffer -36, LhEncode -42, LhDecode -48,
    // which are Explode's own equates at source lines 98-101
    expect([at(4), at(5), at(6), at(7)]).toEqual([0x152, 0x1aa, 0x1ce, 0x1f6])
    expect(at(8)).toBe(0xffffffff)
  })

  it('CreateBuffer asks for 40000 bytes to encode with and 4500 to decode', () => {
    const c = hunk()
    const long = (o: number): number => ((c[o]! << 24) | (c[o + 1]! << 16) | (c[o + 2]! << 8) | c[o + 3]!) >>> 0
    // `move.l #$1194,d0` on the non-zero arm and `#$9c40` on the zero one
    expect(long(0x160)).toBe(0x1194)
    expect(long(0x168)).toBe(0x9c40)
    // and the struct it hands back is 28 bytes -- `moveq #$1c,d0`
    expect(c[0x17f]).toBe(0x1c)
  })

  it('and the position table is exactly the one lh.ts builds, all 512 bytes', () => {
    const c = hunk()
    for (let i = 0; i < 256; i++) {
      const w = (c[0x428 + i * 2]! << 8) | c[0x428 + i * 2 + 1]!
      expect([i, w >> 8, w & 0xff]).toEqual([i, LH_POS_CODE[i], LH_POS_EXTRA[i]])
    }
  })

  it('the table is d_code and d_len - 3, which is what makes it LZHUF', () => {
    const c = hunk()
    const extraAt = (i: number): number => c[0x428 + i * 2 + 1]!
    const codeAt = (i: number): number => c[0x428 + i * 2]!
    // 32 slots for the nearest offsets, then the bands halve
    expect(codeAt(0)).toBe(0)
    expect(codeAt(31)).toBe(0)
    expect(codeAt(32)).toBe(1)
    expect(codeAt(255)).toBe(63)
    // d_len runs 3 to 8, so the stored count runs 0 to 5
    expect(extraAt(0)).toBe(0)
    expect(extraAt(255)).toBe(5)
    expect(new Set(Array.from({ length: 256 }, (_, i) => extraAt(i))).size).toBe(6)
  })

  it('THERE IS NO reconst: the tree freezes at MAX_FREQ instead of rebuilding', () => {
    const c = hunk()
    // `cmpi.w #$8000,$4f0(a5)` at $35e, and the branch that follows skips the
    // whole update rather than entering a reconstruction
    expect([c[0x35e], c[0x35f]]).toEqual([0x0c, 0x6d])
    expect([c[0x360], c[0x361]]).toEqual([0x80, 0x00])
    expect([c[0x362], c[0x363]]).toEqual([0x04, 0xf0])
    // beq.w to $3bc -- the symbol dispatch, which is where the update would
    // have fallen through to anyway
    expect([c[0x364], c[0x365]]).toEqual([0x67, 0x00])
    const disp = (c[0x366]! << 8) | c[0x367]!
    expect(0x366 + disp).toBe(0x3bc)
  })

  it('the unrolled copy is 60 moves, which is what sets the longest match', () => {
    const c = hunk()
    // `move.b (a2)+,(a1)+` is $12da, $22c up to the `bra.w` at $2a4
    for (let o = 0x22c; o < 0x2a4; o += 2) {
      expect([o, c[o], c[o + 1]]).toEqual([o, 0x12, 0xda])
    }
    expect((0x2a4 - 0x22c) / 2).toBe(60)
    // and the bra goes back to the top of the decode loop
    expect([c[0x2a4], c[0x2a5]]).toEqual([0x60, 0x00])
    expect(0x2a6 + (((c[0x2a6]! << 8) | c[0x2a7]!) << 16) / 65536).toBe(0x330)
  })

  it('and the computed jump into it makes the shortest match ONE byte', () => {
    const c = hunk()
    // `jmp $4a4(pc,d7.w)` -- 4efb, then a brief extension word for d7.w
    expect([c[0x424], c[0x425]]).toEqual([0x4e, 0xfb])
    const ext = (c[0x426]! << 8) | c[0x427]!
    expect((ext >> 12) & 7).toBe(7) // d7
    expect(0x426 + ((ext << 24) >> 24)).toBe(0x4a4)
    // symbol 315 has the leaf value -632 and enters at the first move;
    // symbol 256 has -514 and enters at the last one
    expect(0x4a4 - (2 * 315 + 2)).toBe(0x22c)
    expect(0x4a4 - (2 * 256 + 2)).toBe(0x2a2)
  })
})

describe.skipIf(!present)('lh.library 1.8: the encoder half', () => {
  it('LhEncode is at LVO -42 and its body is the routine at $628', () => {
    const c = hunk()
    // the entry checks a0, lh_Src, lh_SrcSize and lh_Dst and jumps; there is
    // no check on lh_DstSize, which is the whole of the defect below
    expect([c[0x1dc], c[0x1dd]]).toEqual([0x20, 0x10]) // move.l (a0),d0
    expect([c[0x1e0], c[0x1e1], c[0x1e3]]).toEqual([0x20, 0x28, 0x04]) // 4(a0)
    expect([c[0x1e6], c[0x1e7], c[0x1e9]]).toEqual([0x20, 0x28, 0x08]) // 8(a0)
    expect([c[0x1ec], c[0x1ed]]).toEqual([0x4e, 0xf9]) // jmp.l
    const long = (o: number): number => ((c[o]! << 24) | (c[o + 1]! << 16) | (c[o + 2]! << 8) | c[o + 3]!) >>> 0
    expect(long(0x1ee)).toBe(0x628)
  })

  it('DEFECT: lh_DstSize is written with the result and read nowhere', () => {
    const c = hunk()
    // `suba.l $8(a0),a1` then `move.l a1,$c(a0)` at $634..$640 -- the length
    // produced, stored into the field a caller would have used as a bound.
    // Explode's Lpk Pack allocates SrcSize + SrcSize/8 and this respects it
    // by not knowing about it.
    expect([c[0x634], c[0x635], c[0x637]]).toEqual([0x93, 0xe8, 0x08])
    expect([c[0x640], c[0x641], c[0x643]]).toEqual([0x21, 0x49, 0x0c])
    // and $c(a0) appears nowhere as a source in the whole encoder
    for (let o = 0x628; o < 0xaa8; o += 2) {
      const w = (c[o]! << 8) | c[o + 1]!
      // `move.l $c(a0),Dn` would be $20e8/$22e8/... with $000c following
      const isReadOfC = (w & 0xf1ff) === 0x2028 && ((c[o + 2]! << 8) | c[o + 3]!) === 0x000c
      expect([o.toString(16), isReadOfC]).toEqual([o.toString(16), false])
    }
  })

  it('the encoder freezes at MAX_FREQ exactly where the decoder does', () => {
    const c = hunk()
    // `cmpi.w #$8000,-$2cda(a3)` at $7f8. a3 is the lson base, aux + $31ca,
    // so this reads aux + $4f0 -- freq[R], the same word the decoder tests at
    // $35e. If only one half froze, a long stream would decode correctly up
    // to the byte where the root count crossed and then diverge.
    expect([c[0x7f8], c[0x7f9]]).toEqual([0x0c, 0x6b])
    expect([c[0x7fa], c[0x7fb]]).toEqual([0x80, 0x00])
    const disp = (((c[0x7fc]! << 8) | c[0x7fd]!) << 16) >> 16
    expect(0x31ca + disp).toBe(0x4f0)
    expect(2 * 632).toBe(0x4f0)
  })

  it('a two-byte match is coded as a match, not as two literals', () => {
    const c = hunk()
    // `cmpi.w #$2,d6 / bcs` at $964: only 0 and 1 take the literal path, and
    // LZHUF's threshold is 3
    expect([c[0x964], c[0x965]]).toEqual([0x0c, 0x46])
    expect([c[0x966], c[0x967]]).toEqual([0x00, 0x02])
    expect([c[0x968], c[0x969]]).toEqual([0x65, 0x00])
  })

  it('and the length symbol is the match length plus 255', () => {
    const c = hunk()
    // `addi.w #$ff,d0` at $972, straight into EncodeChar -- the exact inverse
    // of the decoder's computed jump
    expect([c[0x972], c[0x973]]).toEqual([0x06, 0x40])
    expect([c[0x974], c[0x975]]).toEqual([0x00, 0xff])
    expect(315).toBe(255 + 60)
  })

  it('the search is 60 word compares, and running out of them gives 61', () => {
    const c = hunk()
    // two explicit, then `moveq #$39,d2` and `dbne d2` for 58 more
    expect([c[0x6b2], c[0x6b3]]).toEqual([0x74, 0x39])
    expect(2 + (0x39 + 1)).toBe(60)
    // `neg.w d2 / addi.w #$3c,d2` -- with d2 = -1 that is 61, which only the
    // main loop's clamp to `len` keeps in range
    expect([c[0x6bc], c[0x6bd]]).toEqual([0x44, 0x42])
    expect([c[0x6be], c[0x6bf], c[0x6c0], c[0x6c1]]).toEqual([0x06, 0x42, 0x00, 0x3c])
  })

  it('the work areas are where the buffer sizes say they have to be', () => {
    const c = hunk()
    const long = (o: number): number => ((c[o]! << 24) | (c[o + 1]! << 16) | (c[o + 2]! << 8) | c[o + 3]!) >>> 0
    // CreateBuffer(0) is the 40000-byte encode buffer
    expect(long(0x168)).toBe(0x9c40)
    // text_buf $1152, lson $31ca, rson $51cc, hash heads $71ce, dad $73ce --
    // and the gaps between them ARE the array lengths
    expect((0x31ca - 0x1152) / 2).toBe(4096 + 60) // N + F words, one byte each
    expect((0x51cc - 0x31ca) / 2).toBe(4097) // lson
    expect((0x71ce - 0x51cc) / 2).toBe(4097) // rson up to the heads
    expect((0x73ce - 0x71ce) / 2).toBe(256) // one head per first byte
    // dad is 4097 -- indexed by a node OR by NIL itself, which the delete
    // walk relies on -- and the library NILs only the first 4096
    expect((0x93d0 - 0x73ce) / 2).toBe(4097)
    expect(0x93d0 + 4).toBeLessThan(0x9c40)
  })

  it('and the encoder’s position table is the same six bands, all 128 bytes', () => {
    const c = hunk()
    for (let i = 0; i < 64; i++) {
      expect([i, c[0x9b2 + i * 2], c[0x9b2 + i * 2 + 1]]).toEqual([i, LH_P_CODE[i], LH_P_LEN[i]])
    }
    // it is the canonical code, which is why building it works: 3 bits for
    // the nearest band and 8 for the farthest, the same 1/3/8/12/24/16 split
    expect(LH_P_LEN[0]).toBe(3)
    expect(LH_P_LEN[63]).toBe(8)
    expect([...LH_P_LEN].filter((l) => l === 5)).toHaveLength(8)
    // and it inverts the decoder's: reading a p_code back through d_code
    // gives the index it was made for
    for (let i = 0; i < 64; i++) expect([i, LH_POS_CODE[LH_P_CODE[i]!]]).toEqual([i, i])
  })
})
