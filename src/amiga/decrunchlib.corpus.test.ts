/**
 * `decrunch.library` against the shipped binary.
 *
 * ./decrunchlib.gen.ts is generated FROM this file's fixture, so a test that
 * only re-extracted the tables would prove nothing. What is checked here is
 * the part the generator has to assume: that the addresses it reads from are
 * the instructions it thinks they are, that the walk it performs is the walk
 * the library performs, and that the tables end where it stops. A future
 * copy of the library that differs anywhere in that structure fails here
 * rather than silently producing a shorter table.
 *
 * Skipped when the fixture is absent; `fixtures/` is gitignored and
 * DecrunchLib is LICENCEWARE, so it is not redistributed.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DL_DATA_MAGICS, DL_ID_STRING, DL_SCAN, DL_SIGNATURES } from './decrunchlib.gen'
import { DECRUNCH_NAME, DECRUNCH_REVISION, DECRUNCH_VERSION, DL_LVO } from './decrunchlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const path = join(root, 'fixtures', 'libs', 'decrunch.library')
const present = existsSync(path)

/** the one code hunk, at file offset 32 */
function hunk(): Uint8Array {
  const raw = new Uint8Array(readFileSync(path))
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  return raw.subarray(32, 32 + dv.getUint32(20) * 4)
}

const at = (c: Uint8Array, o: number): number => c[o] ?? 0
const w16 = (c: Uint8Array, o: number): number => (at(c, o) << 8) | at(c, o + 1)
const i16 = (c: Uint8Array, o: number): number => (w16(c, o) << 16) >> 16
const l32 = (c: Uint8Array, o: number): number =>
  ((at(c, o) << 24) | (at(c, o + 1) << 16) | (at(c, o + 2) << 8) | at(c, o + 3)) >>> 0

describe.skipIf(!present)('decrunch.library 35.237, as shipped', () => {
  it('is the library the id string says it is', () => {
    const raw = readFileSync(path)
    expect(raw.length).toBe(26892)
    // the umlaut and the copyright sign are the author's own bytes, latin-1
    expect(raw.toString('latin1')).toContain(DL_ID_STRING)
    expect(DL_ID_STRING).toContain('Georg Hörmann')
    expect(DL_ID_STRING).toContain('LICENCEWARE')
    expect(DECRUNCH_NAME).toBe('decrunch.library')
    expect(DL_ID_STRING).toContain(`${DECRUNCH_VERSION}.${DECRUNCH_REVISION}`)
  })

  it('exports its functions through a WORD-relative vector table', () => {
    const c = hunk()
    // rt_Init -> the RTF_AUTOINIT table -> the vectors
    const autoinit = l32(c, 26)
    expect(autoinit).toBe(0x1e)
    expect(l32(c, autoinit)).toBe(0x28) // 40-byte library data area
    const vec = l32(c, autoinit + 4)
    expect(vec).toBe(0xc2)
    // $ffff as the first WORD, not a longword vector -- offsets follow
    expect(w16(c, vec)).toBe(0xffff)
    const lvo = (n: number): number => vec + w16(c, vec + (n / 6) * 2)
    // Open, Close, Expunge, the reserved null
    expect([lvo(6), lvo(12), lvo(18), lvo(24)]).toEqual([0xd8, 0xe6, 0xfa, 0x138])
    // and Explode's own equates at source lines 78-81, in ITS order:
    // dlAllocItem, dlFreeItem, dlInitItem, dlDecrunch
    expect([lvo(30), lvo(36), lvo(42), lvo(48)]).toEqual([0x13c, 0x162, 0x182, 0x1060])
    expect(Object.values(DL_LVO)).toEqual([-30, -36, -42, -48, -54])
  })

  it('and a ninth function Explode never names, which is the executable loader', () => {
    const c = hunk()
    const vec = 0xc2
    expect(vec + w16(c, vec + 9 * 2)).toBe(0x6798)
    expect(w16(c, vec + 10 * 2)).toBe(0xffff) // the table ends after it
    // `bsr.w $6798` is what dlDecrunch calls for anything that is not subid 2
    expect([at(c, 0x1076), at(c, 0x1077)]).toEqual([0x61, 0x00])
    expect(0x1078 + i16(c, 0x1078)).toBe(0x6798)
  })

  it('dlAllocItem hands back a 40-byte item behind a four-byte guard', () => {
    const c = hunk()
    // AllocMem 44 bytes, MEMF_PUBLIC|MEMF_CLEAR
    expect(l32(c, 0x144)).toBe(0x10001)
    expect([at(c, 0x148), at(c, 0x149)]).toEqual([0x70, 0x2c])
    // `move.w #$4349,(a0)+` -- "CI" -- then the size, then the pointer
    expect(w16(c, 0x154)).toBe(0x30fc)
    expect(w16(c, 0x156)).toBe(0x4349)
    // `move.w #$2c,(a0)+` -- the guard records the whole allocation, so what
    // the caller holds is the 44 minus those four bytes
    expect([w16(c, 0x158), w16(c, 0x15a)]).toEqual([0x30fc, 0x2c])
    // and dlFreeItem checks the same word back before it frees
    expect(w16(c, 0x172)).toBe(0x4349)
  })

  it('the data magics are the chain dlInitItem tries first, in order', () => {
    const c = hunk()
    // `move.l (a0),d0` at $274, then `cmp.l #imm,d0 / beq.b` sixteen times
    expect(w16(c, 0x274)).toBe(0x2010)
    const seen: number[] = []
    // TurtleSmasher is the special first one: two longwords
    expect(w16(c, 0x276)).toBe(0xb0bc)
    seen.push(l32(c, 0x278))
    expect(w16(c, 0x27e)).toBe(0x0ca8) // cmpi.l #imm,d16(a0)
    expect(l32(c, 0x280)).toBe(0x322e3030) // "2.00"
    expect(i16(c, 0x284)).toBe(4)
    let o = 0x288
    while (w16(c, o) === 0xb0bc) {
      seen.push(l32(c, o + 2))
      expect(at(c, o + 6)).toBe(0x67)
      o += 8
    }
    // the last test is a WORD against memory, which is why DragPack's entry
    // is two bytes wide and every other one is four
    expect(w16(c, o)).toBe(0x0c50)
    seen.push(w16(c, o + 2))
    o += 6
    // then `moveq #0,d0 / rts` -- not recognised
    expect([w16(c, o), w16(c, o + 2)]).toEqual([0x7000, 0x4e75])

    expect(seen).toEqual(DL_DATA_MAGICS.map((m) => m.magic))
    expect(DL_DATA_MAGICS.filter((m) => m.width === 2)).toHaveLength(1)
    expect(DL_DATA_MAGICS.filter((m) => m.also)).toHaveLength(1)
  })

  it('and every one of them carries subid 2, which is what selects the data path', () => {
    const c = hunk()
    expect(DL_DATA_MAGICS.every((m) => m.subId === 2)).toBe(true)
    // `cmpi.b #2,$15(a5)` at $1066: anything else goes through the loader
    expect(w16(c, 0x1066)).toBe(0x0c2d)
    expect(at(c, 0x1069)).toBe(0x02)
    expect(w16(c, 0x106a)).toBe(0x0015)
  })

  it('the signature table walk lands on exactly the records that were extracted', () => {
    const c = hunk()
    // `lea $4b2(pc),a1` at $1ac
    expect(w16(c, 0x1ac)).toBe(0x43fa)
    const table = 0x1ae + i16(c, 0x1ae)
    expect(table).toBe(0x4b2)

    // the walk, done here from the instructions rather than from the
    // generator: three (word, long) probes, id, subid, a length byte, and a
    // NUL-terminated name padded to an even record
    let rec = table
    let n = 0
    for (; i16(c, rec) >= 0; n++) {
      const s = DL_SIGNATURES[n]
      expect([n, s !== undefined]).toEqual([n, true])
      expect([n, i16(c, rec), l32(c, rec + 2)]).toEqual([n, ...s!.probes[0]!])
      expect([n, i16(c, rec + 6), l32(c, rec + 8)]).toEqual([n, ...s!.probes[1]!])
      expect([n, i16(c, rec + 12), l32(c, rec + 14)]).toEqual([n, ...s!.probes[2]!])
      expect([n, at(c, rec + 18), at(c, rec + 19)]).toEqual([n, s!.id, s!.subId])
      expect([n, at(c, rec + 20)]).toEqual([n, s!.name.length])
      // `move.b (a1),d0 / addq.w #3,d0 / bclr #0,d0`
      rec += 20 + ((s!.name.length + 3) & ~1)
    }
    expect(n).toBe(DL_SIGNATURES.length)
    expect(n).toBe(76)
    // `bmi` on a negative first offset is what ends it
    expect(w16(c, rec)).toBe(0xffff)
  })

  it('the hunk-header skipper is what the table offsets are relative to', () => {
    const c = hunk()
    // `cmpi.l #$3f3,(a0)` at $240 -- a file that is not an executable is
    // walked from its own first byte instead
    expect(w16(c, 0x240)).toBe(0x0c90)
    expect(l32(c, 0x242)).toBe(0x3f3)
    // `lea $14(a0,d0.l),a0`: past the size table AND past the first hunk's
    // type and size longwords
    expect(w16(c, 0x260)).toBe(0x41f0)
    expect(at(c, 0x263)).toBe(0x14)
  })

  it('the scan is three instructions in sequence, and it names CrunchMania A', () => {
    const c = hunk()
    // moveq #$64,d0 then cmpi.w #$45fa,(a0)+ -- `lea d16(pc),a2`
    expect([at(c, 0x206), at(c, 0x207)]).toEqual([0x70, DL_SCAN.leadTries - 1])
    expect(w16(c, 0x20a)).toBe(DL_SCAN.lead)
    // then move.l (a2)+,d1 within twenty-one more words
    expect([at(c, 0x214), at(c, 0x215)]).toEqual([0x70, DL_SCAN.thenTries - 1])
    expect(w16(c, 0x218)).toBe(DL_SCAN.then)
    // and move.l (a2)+,d2 immediately after it, with no second chance
    expect(w16(c, 0x224)).toBe(DL_SCAN.third)
    expect([at(c, 0x22b), at(c, 0x231)]).toEqual([DL_SCAN.id, DL_SCAN.subId])
    expect(DL_SCAN.name).toBe('CrunchMania A')
  })

  it('93 names in total, and every one of them came out of the binary', () => {
    const names = [...DL_DATA_MAGICS.map((m) => m.name), ...DL_SIGNATURES.map((s) => s.name), DL_SCAN.name]
    expect(names).toHaveLength(93)
    const text = readFileSync(path).toString('latin1')
    for (const n of names) expect([n, text.includes(`${n}\0`)]).toEqual([n, true])
    // and no two records answer the same name
    expect(new Set(names).size).toBe(93)
  })
})
