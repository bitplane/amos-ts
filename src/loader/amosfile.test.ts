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
