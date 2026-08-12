/**
 * `decrunch.library`'s identification, on buffers built here.
 *
 * The tables are extracted from the library and ./decrunchlib.corpus.test.ts
 * holds them to it; what this file checks is the WALK — that the three stages
 * run in the right order, that each stops at its first match, that a hunk
 * header is stepped over before the executable signatures are applied, and
 * that "not recognised" is answered rather than guessed at.
 *
 * The buffers are minimal: enough bytes at the right offsets to satisfy one
 * record and nothing else. That is deliberate. A real crunched file would
 * make the tests read like a demonstration and prove less, because it would
 * satisfy its record for reasons the test never states.
 */
import { describe, expect, it } from 'vitest'
import { DL_DATA_MAGICS, DL_SCAN, DL_SIGNATURES } from './decrunchlib.gen'
import { DL_DECRUNCHES, dlDecrunch, dlInitItem, dlSkipHunkHeader } from './decrunchlib'
import { pp20Crunch } from './powerpacker'

/** a buffer of `len` bytes with longwords written at the given offsets */
function buf(len: number, at: Record<number, number>): Uint8Array {
  const d = new Uint8Array(len)
  for (const [o, v] of Object.entries(at)) {
    const i = Number(o)
    d[i] = (v >>> 24) & 0xff
    d[i + 1] = (v >>> 16) & 0xff
    d[i + 2] = (v >>> 8) & 0xff
    d[i + 3] = v & 0xff
  }
  return d
}

const magic = (name: string) => DL_DATA_MAGICS.find((m) => m.name === name)!
const sig = (name: string) => DL_SIGNATURES.find((s) => s.name === name)!

/** a buffer that satisfies one signature record and is otherwise zero */
function fromSignature(name: string, extra = 0): Uint8Array {
  const s = sig(name)
  const end = Math.max(...s.probes.map(([o]) => o)) + 4
  const d = buf(end + extra, Object.fromEntries(s.probes.map(([o, v]) => [o + extra, v])))
  return d
}

describe('decrunch.library: the data magics', () => {
  it('names PowerPacker data from its first longword alone', () => {
    const d = buf(16, { 0: magic('PowerPacker D').magic })
    expect(dlInitItem(d)).toEqual({ id: 0x48, subId: 2, name: 'PowerPacker D' })
  })

  it('and DragPack from a WORD, which is the one entry that is not four bytes', () => {
    const m = magic('DragPack 2.52 D')
    expect(m.width).toBe(2)
    const d = new Uint8Array(16)
    d[0] = (m.magic >> 8) & 0xff
    d[1] = m.magic & 0xff
    expect(dlInitItem(d)?.name).toBe('DragPack 2.52 D')
  })

  it('TurtleSmasher needs its second longword too, and is refused without it', () => {
    const m = magic('TurtleSmasher 2.00 D')
    expect(dlInitItem(buf(16, { 0: m.magic }))).toBe(null)
    expect(dlInitItem(buf(16, { 0: m.magic, 4: m.also!.value }))?.name).toBe('TurtleSmasher 2.00 D')
  })

  it('every data magic answers subid 2, which is the whole reason they matter', () => {
    // `cmpi.b #2,$15(a5)` at $1066 sends subid 2 straight to a decruncher and
    // everything else through the executable loader first
    for (const m of DL_DATA_MAGICS) expect([m.name, m.subId]).toEqual([m.name, 2])
  })

  it('a magic beats a signature, because stage one runs first', () => {
    // ByteKiller 2.0's probes, with a PP20 magic laid over the front
    const d = fromSignature('ByteKiller 2.0')
    d.set([0x50, 0x50, 0x32, 0x30])
    expect(dlInitItem(d)?.name).toBe('PowerPacker D')
  })
})

describe('decrunch.library: the executable signatures', () => {
  it('all three probes have to match, not just the first', () => {
    const s = sig('ByteKiller 3.0')
    const d = fromSignature('ByteKiller 3.0')
    expect(dlInitItem(d)?.name).toBe('ByteKiller 3.0')
    // break the last one only
    d[s.probes[2]![0] + 3] = (d[s.probes[2]![0] + 3]! ^ 0xff) & 0xff
    expect(dlInitItem(d)?.name).not.toBe('ByteKiller 3.0')
  })

  it('a probe that runs off the end of the buffer is a miss, not a crash', () => {
    // the divergence ./decrunchlib.ts records: the original reads whatever is
    // at the address. One signature probes 418 bytes in.
    const s = sig('PowerPacker 2.x')
    expect(Math.max(...s.probes.map(([o]) => o))).toBeGreaterThan(400)
    expect(() => dlInitItem(fromSignature('PowerPacker 2.x').subarray(0, 64))).not.toThrow()
  })

  it('the table is tried in order, so the first matching record wins', () => {
    // PP 4.0 Overlayed and PP 4.0 Overlay/Lib share their first two probes
    const a = sig('PP 4.0 Overlayed')
    const b = sig('PP 4.0 Overlay/Lib')
    expect([a.probes[0], a.probes[1]]).toEqual([b.probes[0], b.probes[1]])
    expect(DL_SIGNATURES.indexOf(a)).toBeLessThan(DL_SIGNATURES.indexOf(b))
    const d = fromSignature('PP 4.0 Overlayed')
    expect(dlInitItem(d)?.name).toBe('PP 4.0 Overlayed')
  })

  it('nothing recognisable answers null rather than a guess', () => {
    expect(dlInitItem(new Uint8Array(0))).toBe(null)
    expect(dlInitItem(new Uint8Array(512))).toBe(null)
    expect(dlInitItem(buf(64, { 0: 0xdeadbeef }))).toBe(null)
  })
})

describe('decrunch.library: the hunk header', () => {
  /** HUNK_HEADER, no resident list, one hunk of `words` longwords */
  function exeHeader(words: number): number[] {
    return [0x3f3, 0, 1, 0, 0, words, 0x3e9, words]
  }

  it('is stepped over, so a signature is applied to the code and not the header', () => {
    const head = exeHeader(64)
    const body = fromSignature('ByteKiller 2.0')
    const d = new Uint8Array(head.length * 4 + body.length)
    head.forEach((v, i) => {
      d[i * 4] = (v >>> 24) & 0xff
      d[i * 4 + 1] = (v >>> 16) & 0xff
      d[i * 4 + 2] = (v >>> 8) & 0xff
      d[i * 4 + 3] = v & 0xff
    })
    d.set(body, head.length * 4)
    expect(dlSkipHunkHeader(d)).toBe(head.length * 4)
    expect(dlInitItem(d)?.name).toBe('ByteKiller 2.0')
  })

  it('and a buffer that is not an executable is walked from its own first byte', () => {
    const d = fromSignature('ByteKiller 2.0')
    expect(dlSkipHunkHeader(d)).toBe(0)
    expect(dlInitItem(d)?.name).toBe('ByteKiller 2.0')
  })

  it('a truncated header is left alone rather than skipped into nowhere', () => {
    expect(dlSkipHunkHeader(buf(8, { 0: 0x3f3 }))).toBe(0)
    expect(dlSkipHunkHeader(buf(4, { 0: 0x3f3 }))).toBe(0)
  })
})

describe('decrunch.library: the scan, which is stage three', () => {
  /** `lea d16(pc),a2` at word `lead`, then the two moves */
  function scanned(lead: number, gap: number): Uint8Array {
    const d = new Uint8Array((lead + gap + 4) * 2)
    const put = (w: number, v: number): void => {
      d[w * 2] = (v >> 8) & 0xff
      d[w * 2 + 1] = v & 0xff
    }
    put(lead, DL_SCAN.lead)
    put(lead + 1 + gap, DL_SCAN.then)
    put(lead + 2 + gap, DL_SCAN.third)
    return d
  }

  it('finds CrunchMania A by shape when no signature matched', () => {
    expect(dlInitItem(scanned(10, 0))).toEqual({ id: DL_SCAN.id, subId: DL_SCAN.subId, name: 'CrunchMania A' })
  })

  it('the third instruction must follow the second immediately', () => {
    // `cmpi.w #$241a,(a0)+ / bne` -- one chance, unlike the two searches
    // before it
    const d = scanned(10, 0)
    d[(10 + 2) * 2] = (d[(10 + 2) * 2] ?? 0) ^ 0xff
    expect(dlInitItem(d)).toBe(null)
  })

  it('and both searches are bounded, so a file that merely contains the bytes misses', () => {
    expect(dlInitItem(scanned(DL_SCAN.leadTries, 0))).toBe(null)
    expect(dlInitItem(scanned(10, DL_SCAN.thenTries))).toBe(null)
  })
})

describe('decrunch.library: what this port will actually unpack', () => {
  it('PowerPacker data, and it round-trips', () => {
    const src = new Uint8Array(600)
    for (let i = 0; i < src.length; i++) src[i] = i & 15
    const packed = pp20Crunch(src)
    const item = dlInitItem(packed)
    expect(item?.name).toBe('PowerPacker D')
    expect([...dlDecrunch(packed, packed.length, item!)!]).toEqual([...src])
  })

  it('the declared length is what finds the trailer, not the buffer length', () => {
    // `movea.l (a5),a0 / adda.l $16(a5),a0 / move.l -(a0),d0` at $121e: a bank
    // with slack after its payload would read the wrong longword if the
    // buffer were measured instead
    const src = Uint8Array.from({ length: 120 }, (_, i) => i & 7)
    const packed = pp20Crunch(src)
    const padded = new Uint8Array(packed.length + 8)
    padded.set(packed)
    const item = dlInitItem(padded)!
    expect([...dlDecrunch(padded, packed.length, item)!]).toEqual([...src])
    expect(dlDecrunch(padded, padded.length, item)).toBe(null)
  })

  it('and everything else identifies without unpacking', () => {
    // not a gap to be papered over: the library has roughly seventy
    // decrunchers and this port has one of them
    expect([...DL_DECRUNCHES]).toEqual([0x48])
    const d = fromSignature('ByteKiller 2.0')
    const item = dlInitItem(d)!
    expect(item.name).toBe('ByteKiller 2.0')
    expect(dlDecrunch(d, d.length, item)).toBe(null)
  })

  it('an executable is refused even when its id is one this port knows', () => {
    // `cmpi.b #2,$15(a5)`: subid 0 and 1 need the loader at $6798 first
    expect(dlDecrunch(new Uint8Array(64), 64, { id: 0x48, subId: 0, name: 'PowerPacker 3.0' })).toBe(null)
  })

  it('and a corrupt stream answers null rather than throwing', () => {
    const d = buf(64, { 0: magic('PowerPacker D').magic })
    expect(dlDecrunch(d, d.length, dlInitItem(d)!)).toBe(null)
  })
})
