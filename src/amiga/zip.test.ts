import { describe, expect, it } from 'vitest'
import { crc32, readZip, readZipDirectory, writeZip } from './zip'
import { unarchive } from './xadmaster'

const text = (s: string): Uint8Array => new TextEncoder().encode(s)
const read = (d: Uint8Array): string => new TextDecoder().decode(d)

describe('CRC-32, which every zip entry carries', () => {
  it('matches the published check value', () => {
    // the standard check: CRC-32 of "123456789" is $cbf43926, and it is the
    // one number that tells a reflected implementation from an unreflected one
    expect(crc32(text('123456789'))).toBe(0xcbf43926)
  })

  it('is zero for nothing', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('writing a zip', () => {
  it('reads back through this file own reader', async () => {
    const zip = await writeZip([
      { path: 'hello.txt', data: text('hello') },
      { path: 'drawer/inner.txt', data: text('inside') },
    ])
    const back = await readZip(zip)
    expect(back.map((e) => e.path)).toEqual(['hello.txt', 'drawer/inner.txt'])
    expect(read(back[0]!.data)).toBe('hello')
    expect(read(back[1]!.data)).toBe('inside')
  })

  it('reads back through xadmaster, which is the other reader on the machine', async () => {
    // A different entry point with its own recogniser. A zip only this file
    // can open is not a zip the host will open either.
    const zip = await writeZip([{ path: 'a.bin', data: new Uint8Array([1, 2, 3, 4]) }])
    const { files } = await unarchive(zip)
    expect(files.map((f) => f.path)).toEqual(['a.bin'])
    expect([...files[0]!.data]).toEqual([1, 2, 3, 4])
  })

  it('stores rather than deflates when deflate would grow the file', async () => {
    // Most of what goes through here is already crunched: an Amiga module,
    // an LhA, a PowerPacked bank. Deflate adds bytes to all of them.
    //
    // A seeded xorshift rather than Math.random, so a failure here is the
    // same failure tomorrow. `i * 7919 & 0xff` was the first try and deflate
    // shrank it by three quarters: the low byte of a multiple has a short
    // cycle, which is a pattern however unlikely the number looks.
    const noise = new Uint8Array(4096)
    let x = 0x2545f491
    for (let i = 0; i < noise.length; i++) {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      noise[i] = x & 0xff
    }
    const zip = await writeZip([{ path: 'noise.bin', data: noise }])
    const dir = readZipDirectory(zip)
    expect(dir[0]!.method).toBe(0)
    expect(dir[0]!.packedSize).toBe(noise.length)
  })

  it('deflates what deflate helps', async () => {
    const flat = new Uint8Array(4096) // all zeroes
    const zip = await writeZip([{ path: 'flat.bin', data: flat }])
    const dir = readZipDirectory(zip)
    expect(dir[0]!.method).toBe(8)
    expect(dir[0]!.packedSize).toBeLessThan(flat.length)
    expect(read(await readZip(zip).then((e) => e[0]!.data))).toBe('\0'.repeat(4096))
  })

  it('carries the file own AmigaDOS date rather than today', async () => {
    // 5479 days after 1 January 1978 is 1 January 1993: fifteen years of 365
    // plus the leap days of 1980, 1984, 1988 and 1992. 13:30 is 810 minutes.
    const zip = await writeZip([
      { path: 'old.txt', data: text('x'), stamp: { days: 5479, mins: 810, ticks: 100 } },
    ])
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    const time = v.getUint16(10, true)
    const date = v.getUint16(12, true)
    expect(((date >> 9) & 0x7f) + 1980).toBe(1993)
    expect((date >> 5) & 0xf).toBe(1)
    expect(date & 0x1f).toBe(1)
    expect((time >> 11) & 0x1f).toBe(13)
    expect((time >> 5) & 0x3f).toBe(30)
    // seconds are in units of two, so 100 ticks is 2s and reads back as 1
    expect(time & 0x1f).toBe(1)
  })

  it('cannot say a date before 1980, so it says the earliest one it can', async () => {
    // AmigaDOS counts from 1978 and MS-DOS from 1980. A file stamped in the
    // two years between has no representation at all in a zip.
    const zip = await writeZip([{ path: 'ancient', data: text('x'), stamp: { days: 10, mins: 0, ticks: 0 } }])
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    const date = v.getUint16(12, true)
    expect((date >> 9) & 0x7f).toBe(0)
    expect((date >> 5) & 0xf).toBe(1)
    expect(date & 0x1f).toBe(1)
  })

  it('writes an empty archive that still reads as one', async () => {
    // A drawer with nothing in it is a real thing to download
    const zip = await writeZip([])
    expect(zip.length).toBe(22)
    expect(await readZip(zip)).toEqual([])
  })

  it('says the name is UTF-8 rather than leaving a reader to guess', async () => {
    const zip = await writeZip([{ path: 'Über.mod', data: text('x') }])
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(v.getUint16(6, true) & 0x0800).toBe(0x0800)
    expect((await readZip(zip))[0]!.path).toBe('Über.mod')
  })
})
