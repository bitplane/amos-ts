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
import { LH_POS_CODE, LH_POS_EXTRA } from './lh'

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
