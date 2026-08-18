/**
 * LHA, against synthetic headers and against `lhasa`.
 *
 * The oracle half is in `./lha.corpus.test.ts`, which needs real archives.
 * This file is the part that runs anywhere: the header walk's three levels,
 * the two traps that cost real debugging, and the method table read off
 * xadmaster.library.
 */
import { describe, expect, it } from 'vitest'
import { DECODES, WINDOW_BITS, decode, readLha, readLhaHeaders } from './lha'

/** a level-0 header, which is the one nearly every Amiga archive uses */
function level0(name: string, method: string, packed: Uint8Array, size: number): Uint8Array {
  const nameBytes = [...name].map((c) => c.charCodeAt(0))
  const headerLen = 22 + nameBytes.length + 2 - 2
  const h = new Uint8Array(2 + headerLen + packed.length)
  h[0] = headerLen
  h[1] = 0 // checksum, not verified here
  h.set([...method].map((c) => c.charCodeAt(0)), 2)
  const put32 = (at: number, v: number): void => {
    h[at] = v & 0xff
    h[at + 1] = (v >> 8) & 0xff
    h[at + 2] = (v >> 16) & 0xff
    h[at + 3] = (v >>> 24) & 0xff
  }
  put32(7, packed.length)
  put32(11, size)
  put32(15, 0)
  h[19] = 0x20
  h[20] = 0
  h[21] = nameBytes.length
  h.set(nameBytes, 22)
  h.set(packed, 2 + headerLen)
  return h
}

describe('the method table', () => {
  /**
   * Read out of xadmaster.library's dispatch at $13290, where each arm sets
   * $8(a4) to a bit count. The header quotes the instruction for every row.
   */
  it('is the one xadmaster.library sets', () => {
    expect(WINDOW_BITS['-lh5-']).toBe(13)
    expect(WINDOW_BITS['-lh4-']).toBe(12)
    expect(WINDOW_BITS['-lh6-']).toBe(15)
    expect(WINDOW_BITS['-lh7-']).toBe(16)
    expect(WINDOW_BITS['-lh8-']).toBe(17)
    expect(WINDOW_BITS['-lzs-']).toBe(11)
    expect(WINDOW_BITS['-lz5-']).toBe(12)
    // lh2 and lh3 share lh5's default, which is what falling through means
    expect(WINDOW_BITS['-lh2-']).toBe(WINDOW_BITS['-lh5-'])
    expect(WINDOW_BITS['-lh3-']).toBe(WINDOW_BITS['-lh5-'])
  })

  /** the window is 1 << bits, from `bset d0,d1` at $133b6 */
  it('gives lh5 an 8K window and lh7 a 64K one', () => {
    expect(1 << WINDOW_BITS['-lh5-']!).toBe(8192)
    expect(1 << WINDOW_BITS['-lh7-']!).toBe(65536)
  })

  /**
   * lh8 is recorded and refused. The binary sets 17 bits for it and nothing
   * else here corroborates that, so decoding one would be guessing at a
   * format no archive on this machine uses.
   */
  it('knows lh8 without decoding it', () => {
    expect(WINDOW_BITS['-lh8-']).toBe(17)
    expect(DECODES.has('-lh8-')).toBe(false)
    expect(decode(new Uint8Array(64), '-lh8-', 16)).toBeNull()
  })

  it('refuses a method it has never heard of', () => {
    expect(decode(new Uint8Array(64), '-lhz-', 16)).toBeNull()
  })
})

describe('the header walk', () => {
  const HELLO = Uint8Array.from([...'hello, world'].map((c) => c.charCodeAt(0)))

  it('reads a stored member back whole', () => {
    const a = level0('greet.txt', '-lh0-', HELLO, HELLO.length)
    const heads = readLhaHeaders(a)
    expect(heads).toHaveLength(1)
    expect(heads[0]!.path).toBe('greet.txt')
    expect(heads[0]!.method).toBe('-lh0-')
    expect(heads[0]!.level).toBe(0)
    expect([...readLha(a)[0]!.data]).toEqual([...HELLO])
  })

  it('walks straight from one member to the next', () => {
    const a = level0('one.txt', '-lh0-', HELLO, HELLO.length)
    const b = level0('two.txt', '-lh0-', HELLO, HELLO.length)
    const both = new Uint8Array(a.length + b.length)
    both.set(a)
    both.set(b, a.length)
    expect(readLhaHeaders(both).map((h) => h.path)).toEqual(['one.txt', 'two.txt'])
  })

  /**
   * The trap that made MED_7.1.lha decode perfectly and match nothing: an
   * AmigaDOS writer puts the file's COMMENT in the name field behind a NUL,
   * so every path in that archive was a name, a NUL and "HF3" or "Ram Disk".
   */
  it('drops the comment an Amiga writer hides behind a NUL', () => {
    const a = level0('MED.Lib\0MED Extension V7.0 by Haiko Lemser', '-lh0-', HELLO, HELLO.length)
    expect(readLhaHeaders(a)[0]!.path).toBe('MED.Lib')
  })

  it('turns backslashes into slashes, since MS-DOS writers use them', () => {
    const a = level0('xfd_User\\C\\xfdDecrunch', '-lh0-', HELLO, HELLO.length)
    expect(readLhaHeaders(a)[0]!.path).toBe('xfd_User/C/xfdDecrunch')
  })

  it('stops at the terminator rather than reading past it', () => {
    const a = level0('one.txt', '-lh0-', HELLO, HELLO.length)
    const withEnd = new Uint8Array(a.length + 8)
    withEnd.set(a)
    expect(readLhaHeaders(withEnd)).toHaveLength(1)
  })

  it('ends the walk on a truncated archive rather than throwing', () => {
    const a = level0('one.txt', '-lh0-', HELLO, HELLO.length)
    for (let n = 1; n < a.length; n++) {
      expect(() => readLhaHeaders(a.subarray(0, n)), `${n} bytes`).not.toThrow()
    }
    // the last byte missing means the data does not fit, so nothing is claimed
    expect(readLhaHeaders(a.subarray(0, a.length - 1))).toHaveLength(0)
  })

  it('skips directory members, which are empty and end in a separator', () => {
    const dir = level0('drawer/', '-lh0-', new Uint8Array(0), 0)
    const file = level0('drawer/f.txt', '-lh0-', HELLO, HELLO.length)
    const both = new Uint8Array(dir.length + file.length)
    both.set(dir)
    both.set(file, dir.length)
    expect(readLhaHeaders(both)).toHaveLength(2)
    expect(readLha(both).map((f) => f.path)).toEqual(['drawer/f.txt'])
  })

  it('leaves a member it cannot decode out of readLha but not out of the headers', () => {
    const a = level0('x.dat', '-lh1-', new Uint8Array(16), 32)
    expect(readLhaHeaders(a)).toHaveLength(1)
    expect(readLha(a)).toHaveLength(0)
  })
})
