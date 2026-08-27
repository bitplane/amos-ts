import { describe, expect, it, vi } from 'vitest'
import { viewsFor, type ViewHost } from './views'

/**
 * The banks are built here rather than imported from anywhere.
 *
 * `../modplay.ts` writes the same shapes and a shared helper would make this
 * test agree with that file by construction. Two independent spellings of the
 * format is the point: if they disagree, one of them is wrong about what AMOS
 * writes, and that is worth finding out.
 */
const be = (n: number, bytes: number): number[] =>
  Array.from({ length: bytes }, (_, i) => (n >>> ((bytes - 1 - i) * 8)) & 0xff)

const ascii = (s: string, pad = s.length): number[] =>
  [...s.padEnd(pad)].map((c) => c.charCodeAt(0))

function memoryBank(number: number, name: string, data: Uint8Array): number[] {
  return [
    ...ascii('AmBk'),
    ...be(number, 2),
    ...be(1, 2),
    ...be(data.length + 8, 4),
    ...ascii(name, 8),
    ...data,
  ]
}

/** one sprite, `widthWords` by `height`, plus the 32 shared colours */
function spriteBank(kind: 'AmSp' | 'AmIc'): number[] {
  const widthWords = 1
  const height = 2
  const depth = 2
  const planes = [0xf0, 0x00, 0xcc, 0x00, 0xa0, 0x00, 0x50, 0x00]
  const palette: number[] = []
  for (let i = 0; i < 32; i++) palette.push(...be(i === 3 ? 0xfff : i * 0x111, 2))
  return [
    ...ascii(kind),
    ...be(1, 2), // one image
    ...be(widthWords, 2),
    ...be(height, 2),
    ...be(depth, 2),
    ...be(0, 2), // hot X
    ...be(0, 2), // hot Y
    ...planes,
    ...palette,
  ]
}

/** a Samples bank: a count, an offset table, then name/freq/length/pcm */
function samplesBank(): Uint8Array {
  const head = 2 + 4
  const rec = [...ascii('BOOM', 8), ...be(8363, 2), ...be(4, 4), 10, 20, 30, 40]
  return new Uint8Array([...be(1, 2), ...be(head, 4), ...rec])
}

/** a ProTracker module, only as much of one as `detectModule` looks at */
function modBank(): Uint8Array {
  const d = new Uint8Array(1100)
  d.set(ascii('M.K.'), 1080)
  return d
}

/** the whole file: a Pro header, a source length, the source, then the banks */
function amosFile(source: Uint8Array, banks: number[][]): Uint8Array {
  const list = banks.length === 0 ? [] : [...ascii('AmBs'), ...be(banks.length, 2), ...banks.flat()]
  return new Uint8Array([
    ...ascii('AMOS Pro V1.00  ', 16),
    ...be(source.length, 4),
    ...source,
    ...list,
  ])
}

const host = (): ViewHost => ({ playModule: vi.fn(), playSample: vi.fn(), onStatus: vi.fn() })

/** the tokenised `Print "hi"` a listing needs to be non-empty */
const someSource = new Uint8Array([0, 4, 0, 0])

describe('what a file can be looked at as', () => {
  it('gives a program its listing', () => {
    const views = viewsFor(amosFile(someSource, []), host())
    expect(views?.map((v) => v.id)).toEqual(['listing'])
  })

  it('gives a bank a tab of its own, numbered as AMOS numbers it', () => {
    const views = viewsFor(amosFile(someSource, [memoryBank(6, 'Tracker', modBank())]), host())
    expect(views?.map((v) => v.label)).toEqual(['Listing', '6. Music'])
  })

  it('knows a module by its bytes rather than by the name of its bank', () => {
    // DME parks a THX module in a bank called `THX` and Jotre parks one in a
    // bank called whatever the author typed, so the name cannot be the test
    const odd = viewsFor(amosFile(someSource, [memoryBank(9, 'whatever', modBank())]), host())
    expect(odd?.[1]?.label).toBe('9. Music')
  })

  it('lists the samples in a Samples bank, and counts them', () => {
    const views = viewsFor(amosFile(someSource, [memoryBank(5, 'Samples', samplesBank())]), host())
    expect(views?.[1]?.label).toBe('5. Samples')
    expect(views?.[1]?.count).toBe(1)
  })

  it('shows the images in a sprite bank and in an icon bank', () => {
    const sprites = viewsFor(amosFile(new Uint8Array(0), [spriteBank('AmSp')]), host())
    expect(sprites?.[0]?.label).toBe('1. Sprites')
    expect(sprites?.[0]?.count).toBe(1)
    const icons = viewsFor(amosFile(new Uint8Array(0), [spriteBank('AmIc')]), host())
    expect(icons?.[0]?.label).toBe('1. Icons')
  })

  it('falls through to hex for a bank nothing here reads', () => {
    const views = viewsFor(
      amosFile(someSource, [memoryBank(12, 'Menu', new Uint8Array([1, 2, 3, 4]))]),
      host(),
    )
    // named after the bank, because "Hex" twice tells a reader nothing about
    // which of two unknown banks they are looking at
    expect(views?.[1]?.label).toBe('12. Menu')
    expect(views?.[1]?.id).toBe('bank0')
  })

  it('keeps every bank, so a tab never silently goes missing', () => {
    const file = amosFile(someSource, [
      memoryBank(5, 'Samples', samplesBank()),
      memoryBank(6, 'Tracker', modBank()),
      memoryBank(12, 'Menu', new Uint8Array([9])),
      spriteBank('AmSp'),
    ])
    const views = viewsFor(file, host())
    expect(views?.map((v) => v.label)).toEqual([
      'Listing',
      '5. Samples',
      '6. Music',
      '12. Menu',
      '4. Sprites',
    ])
    // ids are unique, or the viewer shows one tab and hides another
    expect(new Set(views!.map((v) => v.id)).size).toBe(views!.length)
  })

  it('says nothing rather than showing an empty tab bar', () => {
    expect(viewsFor(new Uint8Array([1, 2, 3]), host())).toBeNull()
  })
})
