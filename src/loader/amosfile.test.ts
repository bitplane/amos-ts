import { describe, expect, it } from 'vitest'
import { parseAmosFile } from './amosfile'

/**
 * A minimal `AmBk` bank file: the four-character magic, then one bank.
 *
 * `parseBankList` reads `AmBk`, a word bank number, a word memory type, a
 * longword length, eight characters of name and then the data. Small enough
 * to write by hand, which is the point — the property under test is about the
 * TYPE of the argument rather than about any real file.
 */
function bankFile(payload: number[]): Uint8Array {
  const head = [...'AmBk'].map((c) => c.charCodeAt(0))
  const n = payload.length + 8
  return new Uint8Array([
    ...head,
    0,
    5, // bank 5
    0,
    0, // memory type
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
    ...[...'Testing '].map((c) => c.charCodeAt(0)),
    ...payload,
  ])
}

describe('parseAmosFile: the argument is normalised', () => {
  /**
   * The reader hands out `subarray` views of what it was given, so the
   * argument's `.slice()` has to COPY. `Uint8Array`'s does. Node's `Buffer`
   * extends `Uint8Array` and overrides `slice` as an alias of `subarray`, so
   * it does not — and TypeScript sees a `Uint8Array` and says nothing.
   *
   * That is not hypothetical. `readFileSync` answers a Buffer, so `amosrun`
   * handed one straight in while every test wrapped it in `new Uint8Array`;
   * EasyLife's `Tag List$` patches a copy of a template and the copy was the
   * bank, so the first expansion of a template worked, corrupted it, and the
   * second walked a patched pointer chain off the end of the body. Green
   * tests, crashing CLI.
   *
   * A Buffer stand-in is enough to pin it: any subclass of `Uint8Array` whose
   * `slice` aliases would do, and this is one.
   */
  class AliasingArray extends Uint8Array {
    override slice(begin?: number, end?: number): AliasingArray {
      return this.subarray(begin, end) as AliasingArray
    }
  }

  it('a subclass whose slice aliases cannot reach the banks', () => {
    const raw = bankFile([1, 2, 3, 4])
    const a = new AliasingArray(raw.length)
    a.set(raw)
    // the premise: this argument's own slice really does alias
    const probe = a.slice(0, 2)
    probe[0] = 0x7f
    expect(a[0]).toBe(0x7f)
    a[0] = raw[0]!

    const f = parseAmosFile(a)
    const bank = f.banks[0]!
    expect(bank.kind).toBe('memory')
    if (bank.kind !== 'memory') return

    // and the property: slicing the bank the reader handed back copies
    const part = bank.data.slice(0, 2)
    part[0] = 0x55
    expect(bank.data[0]).not.toBe(0x55)
  })

  it('a plain Uint8Array is passed through rather than copied', () => {
    const raw = bankFile([9, 8, 7, 6])
    const f = parseAmosFile(raw)
    const bank = f.banks[0]!
    if (bank.kind !== 'memory') throw new Error('expected a memory bank')
    // still a view of the caller's bytes, which is what makes loading cheap
    expect(bank.data.buffer).toBe(raw.buffer)
  })
})

describe('sprite bank hot spots', () => {
  /**
   * An `AmSp` sprite bank holding one 16x1, one-plane image.
   *
   * A sprite bank is its own top-level magic rather than an `AmBk` carrying a
   * name, which is what `parseBankList` dispatches on.
   */
  function spriteBank(hotX: number, hotY: number): Uint8Array {
    const w = (v: number): number[] => [(v >>> 8) & 0xff, v & 0xff]
    return new Uint8Array([
      ...[...'AmSp'].map((c) => c.charCodeAt(0)),
      ...w(1), // one image
      ...w(1), // width in words
      ...w(1), // height
      ...w(1), // depth
      ...w(hotX & 0xffff),
      ...w(hotY & 0xffff),
      0xff,
      0x00, // one row of plane data
      ...Array.from({ length: 32 }, () => [0, 0]).flat(), // the palette
    ])
  }

  it('reads a hot spot outside the image as the negative it is', () => {
    // `Hot Spot n,x,y` takes negatives and they are useful: a shot fired from
    // the nose of a ship wants its origin ahead of the sprite. Read unsigned,
    // -1 came back as 65535, which positions the image about a thousand
    // screens away and looks like "the sprite vanished" rather than like an
    // off-by-one, so nothing would have pointed at this line.
    //
    // X is fourteen bits of the word, so -1 is $3fff and $ffff is the same
    // coordinate with both flip flags set.
    const f = parseAmosFile(spriteBank(-1, -8))
    const bank = f.banks[0]!
    if (bank.kind !== 'sprites') throw new Error('expected a sprite bank')
    expect([bank.sprites[0]!.hotX, bank.sprites[0]!.hotY]).toEqual([-1, -8])
  })

  it('sign-extends the hot spot X from bit 13, because the top two bits are flags', () => {
    // `Hot Spot n,x,y` pokes the field as `and.w #$C000,6(a1) / and.w
    // #$3FFF,d2 / or.w d2,6(a1)` (Spo4, +W.s:627) --- "Poke, en respectant
    // les FLAGS". It preserves the top two bits instead of writing them, so
    // they are not part of the coordinate, and `HsSet` reads it back with
    // `lsl.w #2,d0 / asr.w #2,d0` (+W.s:11570).
    //
    // The flags record which way the image is currently mirrored, which only
    // `Retourne` (+W.s:1680) sets, and which is a different thing from the
    // flip a program asks for through `Hrev()`/`Vrev()` on the image NUMBER.
    // Taking them as coordinate put a mirrored image 32,768 pixels away.
    const f = parseAmosFile(spriteBank(0x8007, 10))
    const bank = f.banks[0]!
    if (bank.kind !== 'sprites') throw new Error('expected a sprite bank')
    expect([bank.sprites[0]!.hotX, bank.sprites[0]!.hotY]).toEqual([7, 10])
  })

  it('still reads an ordinary hot spot inside the image', () => {
    const f = parseAmosFile(spriteBank(7, 10))
    const bank = f.banks[0]!
    if (bank.kind !== 'sprites') throw new Error('expected a sprite bank')
    expect([bank.sprites[0]!.hotX, bank.sprites[0]!.hotY]).toEqual([7, 10])
  })
})
