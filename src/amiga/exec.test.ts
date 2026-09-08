import { describe, expect, it } from 'vitest'
import {
  A1200_POOLS, ExecPool, LibraryRegistry, MEMF, MemPool, availMem, closeLibrary, copyMem, libraryPresent, libraryRevision, libraryVersion,
  modelledLibraryAt, openLibrary,
} from './exec'

describe('exec: AvailMem', () => {
  const empty = { chip: 0, fast: 0 }

  it('reports each pool against what is used', () => {
    expect(availMem(A1200_POOLS, empty, MEMF.CHIP)).toBe(2 * 1024 * 1024)
    expect(availMem(A1200_POOLS, { chip: 1024, fast: 0 }, MEMF.CHIP)).toBe(2 * 1024 * 1024 - 1024)
    expect(availMem(A1200_POOLS, { chip: 0, fast: 4096 }, MEMF.FAST)).toBe(8 * 1024 * 1024 - 4096)
  })

  it('MEMF_ANY reports both pools, as exec does', () => {
    expect(availMem(A1200_POOLS, empty)).toBe(10 * 1024 * 1024)
    expect(availMem(A1200_POOLS, empty, MEMF.ANY)).toBe(10 * 1024 * 1024)
  })

  it('never goes negative when a caller over-allocates', () => {
    // a program can hand back more usage than the pool holds — Reserve does
    // not consult AvailMem before allocating, so the figure has to floor
    expect(availMem(A1200_POOLS, { chip: 99 << 20, fast: 0 }, MEMF.CHIP)).toBe(0)
  })

  it('MEMF_LARGEST equals the total, because nothing fragments', () => {
    // not an oversight: with no holes the largest block IS everything free.
    // A caller wanting a smaller answer owns that decision — LDos's
    // Llargest Free caps it, and says so at the call site
    const used = { chip: 512, fast: 512 }
    expect(availMem(A1200_POOLS, used, MEMF.CHIP | MEMF.LARGEST)).toBe(
      availMem(A1200_POOLS, used, MEMF.CHIP),
    )
  })

  it('the pools are an A1200, which other keywords depend on', () => {
    // Jd Cpu, Jd Chipset and Cpu Info all derive the machine's identity from
    // these two numbers; changing them changes answers that are not about
    // memory at all
    expect(A1200_POOLS.chip).toBe(2 * 1024 * 1024)
    expect(A1200_POOLS.fast).toBe(8 * 1024 * 1024)
  })
})

describe('exec: memory operations', () => {
  it('copies arbitrary byte lengths between unaligned regions', () => {
    const source = new Uint8Array([1, 2, 3, 4, 5])
    const destination = new Uint8Array(6)
    copyMem(source, 1, destination, 2, 3)
    expect([...destination]).toEqual([0, 0, 2, 3, 4, 0])
  })

  it('reports native memory attributes for every byte of a live allocation', () => {
    const pool = new MemPool(0x1000, 0x1000)
    const chip = pool.alloc(9, { chip: true })
    const fast = pool.alloc(8)
    expect(pool.typeOfMem(chip + 8)).toBe(MEMF.PUBLIC | MEMF.CHIP)
    expect(pool.typeOfMem(fast)).toBe(MEMF.PUBLIC | MEMF.FAST)
    expect(pool.typeOfMem(0xdead)).toBe(0)
    pool.freeMem(chip)
    expect(pool.typeOfMem(chip)).toBe(0)
  })
})

describe('exec: OpenLibrary', () => {
  it('answers a non-zero base for a library that is modelled', () => {
    expect(openLibrary('locale.library', 38)).toBeGreaterThan(0)
    expect(libraryPresent('locale.library')).toBe(true)
  })

  it('opens the modelled descriptor half of datatypes.library at V40', () => {
    expect(openLibrary('datatypes.library', 40)).toBeGreaterThan(0)
    expect(openLibrary('datatypes.library', 41)).toBe(0)
  })

  it('opens each concrete native GUI/graphics backend at OS DevKit V36', () => {
    for (const name of [
      'graphics.library', 'intuition.library', 'gadtools.library', 'icon.library', 'layers.library', 'workbench.library',
    ]) {
      expect(openLibrary(name, 36), name).toBeGreaterThan(0)
      expect(openLibrary(name, 41), name).toBe(0)
    }
  })

  it('is case-insensitive, as AmigaDOS names are', () => {
    expect(openLibrary('LOCALE.LIBRARY', 38)).toBe(openLibrary('locale.library', 38))
  })

  it('gives each library a distinct base', () => {
    expect(openLibrary('locale.library')).not.toBe(openLibrary('dos.library'))
  })

  it('answers 0 for a library nothing models', () => {
    // the honest answer, and the one that matters most as more extensions
    // arrive: BSDSocket wants bsdsocket.library and there are no sockets here
    for (const name of ['bsdsocket.library', 'octaplayer.library.old', 'octamixplayer.library.old']) {
      expect(openLibrary(name, 0), name).toBe(0)
      expect(libraryPresent(name), name).toBe(false)
    }
  })

  it('models the three BUtility opens, at the versions it asks for', () => {
    // routine 0 of BUtility.Lib is `OpenLibrary` three times and nothing
    // else, and each base it stores is tested by every keyword that uses it.
    // All three are modelled: the XPK master is a real port of the stream
    // format, and AMOS's own selector and dialog engine stand in for the two
    // requester libraries. See runtime/requester.ts
    expect(openLibrary('xpkmaster.library', 4)).toBeGreaterThan(0)
    expect(openLibrary('reqtools.library', 38)).toBeGreaterThan(0)
    expect(openLibrary('asl.library', 37)).toBeGreaterThan(0)
    // and the version rule still bites, which is what keeps the arms real
    expect(openLibrary('reqtools.library', 39)).toBe(0)
    expect(openLibrary('xpkmaster.library', 5)).toBe(0)
  })

  it('refuses a version newer than the one answered for', () => {
    // exec's own contract, and the check a well-written extension makes
    // before giving up politely
    expect(openLibrary('locale.library', 38)).toBeGreaterThan(0)
    expect(openLibrary('locale.library', 45)).toBe(0)
  })

  it('closing is safe and releases nothing', () => {
    expect(() => closeLibrary(openLibrary('locale.library', 38))).not.toThrow()
  })

  it('resolves synthetic bases for OS DevKit library version/revision reads', () => {
    const base = openLibrary('locale.library', 38)
    expect(modelledLibraryAt(base)?.name).toBe('locale.library')
    expect(libraryVersion(base)).toBe(38)
    expect(libraryRevision(base)).toBe(0)
    expect(modelledLibraryAt(0)).toBeNull()
    expect(libraryVersion(0)).toBe(0)
  })

  it('owns OpenLibrary counts per emulated Exec instance', () => {
    const a = new LibraryRegistry(), b = new LibraryRegistry()
    const base = a.open('locale.library', 38)
    expect(a.open('LOCALE.LIBRARY', 0)).toBe(base)
    expect(a.openCount(base)).toBe(2)
    expect(b.openCount(base)).toBe(0)
    a.close(base); expect(a.openCount(base)).toBe(1)
    a.close(base); expect(a.openCount(base)).toBe(0)
  })
})

describe('exec: V39 pooled allocation', () => {
  it('keeps requirements and clears/attributes each allocation', () => {
    const pool = new ExecPool(0x6000, 0x1000, MEMF.PUBLIC | MEMF.CHIP | MEMF.CLEAR, 4096, 256)
    const a = pool.alloc(13)
    expect(a).toBeGreaterThan(0)
    expect(pool.memory.sizeOf(a)).toBe(16)
    expect(pool.memory.chip(a)).toBe(true)
    expect([...pool.memory.buffer.subarray(a - pool.memory.base, a - pool.memory.base + 13)])
      .toEqual(new Array(13).fill(0))
    expect(pool.puddleSize).toBe(4096)
    expect(pool.thresholdSize).toBe(256)
  })

  it('frees individual blocks and DeletePool invalidates the whole lifetime', () => {
    const pool = new ExecPool(0x7000, 0x1000, MEMF.PUBLIC, 4096, 256)
    const a = pool.alloc(8)
    const b = pool.alloc(8)
    pool.free(a, 8)
    expect(pool.memory.sizeOf(a)).toBe(0)
    expect(pool.memory.sizeOf(b)).toBe(8)
    pool.delete()
    expect(pool.memory.sizeOf(b)).toBe(0)
    expect(pool.alloc(8)).toBe(0)
    expect(() => pool.delete()).not.toThrow()
  })
})
