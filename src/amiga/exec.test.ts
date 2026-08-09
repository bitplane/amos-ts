import { describe, expect, it } from 'vitest'
import { A1200_POOLS, MEMF, availMem, closeLibrary, libraryPresent, openLibrary } from './exec'

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

describe('exec: OpenLibrary', () => {
  it('answers a non-zero base for a library that is modelled', () => {
    expect(openLibrary('locale.library', 38)).toBeGreaterThan(0)
    expect(libraryPresent('locale.library')).toBe(true)
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
    for (const name of ['bsdsocket.library', 'octaplayer.library', 'octamixplayer.library']) {
      expect(openLibrary(name, 0), name).toBe(0)
      expect(libraryPresent(name), name).toBe(false)
    }
  })

  it('models the three BUtility opens, at the versions it asks for', () => {
    // routine 0 of BUtility.Lib is `OpenLibrary` three times and nothing
    // else, and each base it stores is tested by every keyword that uses it.
    // These moved out of the list above when butility.ts landed: the XPK
    // master is a real port, and AMOS's own selector and dialog engine stand
    // in for the two requester libraries. See runtime/requester.ts
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
})
