/**
 * The synthesized address space, as a registry of regions.
 *
 * This is the ONE path by which an address becomes a buffer and an offset.
 * Every keyword in every extension that takes an address -- and there are
 * eighty-odd call sites across twelve files -- reaches it through
 * `Runtime.resolveAddr` or `resolveWrite`, which are two lines each over
 * `resolveInto`, which is `findRegion` over the single `memRegions` table.
 * Nothing else resolves an address, and a port that tried to would have no
 * way to see the screen mirrors or the bank scan.
 *
 * It lives in src/amiga rather than src/runtime because there is no AMOS in
 * it: a region table, a lookup and an overlap invariant, with no imports at
 * all. The REGIONS are AMOS's and stay in runtime.ts, handed in as data --
 * the same split as Volume and AmosFS. If a real memory model ever replaces
 * the synthesized map, this is the file it replaces, and the layer test is
 * what keeps it from growing a dependency on its own caller in the meantime.
 *
 * A real AMOS program reaches things by address: Peek/Poke, Leek/Loke,
 * `Bload ...,Font Data`, `Cop Logic` patching, `Varptr`, `Screen Base`. The
 * port has no flat 68k memory to hand them, so it maps each thing a program
 * can legitimately address into its own region of a 32-bit space and resolves
 * an address to a (buffer, offset) pair on the way through.
 *
 * The regions used to be an if-chain inside Runtime.resolveInto, which meant
 * the map only existed as the order of eleven `if (a >= …)` tests: nothing
 * named a region, nothing could list them, and nothing checked that two of
 * them did not claim the same addresses. Here they are data.
 *
 * Two extents, and the difference matters:
 *
 *  - `reserved` is what the region *claims* in the map. Regions must never
 *    overlap on it (`regionOverlaps`), because an address in two regions
 *    resolves to whichever test happens to come first — a bug that already
 *    happened once, when the extension data blocks were first based at
 *    0x50000000, the copper's address, and every read answered from the
 *    copper buffer instead.
 *  - `live()` is what it maps *right now*. An unallocated buffer maps nothing,
 *    and an address in a region that maps nothing falls through to the bank
 *    scan rather than failing, which is what the if-chain did.
 */
export interface Resolved {
  data: Uint8Array
  off: number
}

export interface MemRegion {
  /** for the region map, the overlap check and diagnostics */
  readonly name: string
  /** first address of the region */
  readonly base: number
  /** addresses claimed in the map, allocated or not; no two regions may share one */
  readonly reserved: number
  /** addresses mapped right now; below `reserved` when the backing is unallocated */
  live(): number
  /** resolve an offset within the live extent, or null if this region cannot serve it */
  resolve(off: number, write: boolean): Resolved | null
}

/**
 * The region an address is currently mapped by, or null. Order-independent by
 * construction: `regionOverlaps` is what keeps at most one region matching.
 *
 * Subtracts rather than adding `base + live()` so a region reaching the top of
 * the space is not lost to 32-bit wraparound.
 */
export function findRegion(regions: readonly MemRegion[], a: number): MemRegion | null {
  for (const r of regions) if (a >= r.base && a - r.base < r.live()) return r
  return null
}

/** pairs of regions whose reserved claims intersect; must be empty */
export function regionOverlaps(regions: readonly MemRegion[]): string[] {
  const bad: string[] = []
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i]!
      const b = regions[j]!
      if (a.base < b.base + b.reserved && b.base < a.base + a.reserved) {
        bad.push(`${a.name} and ${b.name}`)
      }
    }
  }
  return bad
}

/**
 * A region backed by one buffer that may not exist yet — the temp buffer,
 * Personnal's two AllocMem blocks, the Music vumeter bytes. `reserved` is the
 * slot the map gives it; the buffer's own length is what it maps.
 */
export function bufferRegion(
  name: string,
  base: number,
  reserved: number,
  get: () => Uint8Array | null,
): MemRegion {
  return {
    name,
    base,
    reserved,
    live: () => get()?.length ?? 0,
    resolve: (off) => {
      const data = get()
      return data ? { data, off } : null
    },
  }
}

/**
 * A region that claims its whole span whether or not the buffer behind it
 * exists yet — the synthesized sprite and icon bank images. An address inside
 * the claim is unambiguously this region's, so a missing or short buffer
 * resolves to null rather than falling through to the bank scan.
 */
export function claimedRegion(
  name: string,
  base: number,
  reserved: number,
  get: () => Uint8Array | null,
): MemRegion {
  return {
    name,
    base,
    reserved,
    live: () => reserved,
    resolve: (off) => {
      const data = get()
      return data ? within(data, off) : null
    },
  }
}

/**
 * A region divided into fixed slots, one per screen / copper buffer /
 * extension block. The whole span is live: an unallocated slot resolves to
 * null rather than falling through, because the address is unambiguously
 * this region's.
 */
export function slottedRegion(
  name: string,
  base: number,
  slot: number,
  count: number,
  resolveSlot: (index: number, off: number, write: boolean) => Resolved | null,
): MemRegion {
  const reserved = slot * count
  return {
    name,
    base,
    reserved,
    live: () => reserved,
    resolve: (off, write) => resolveSlot(Math.floor(off / slot), off % slot, write),
  }
}

/**
 * A one-byte hardware register: read through a function, written through
 * another.
 *
 * Every other region here is backed by a buffer that IS the thing. A chip
 * register is not: CIA-A PRA is six pins and two latched bits, so reading it
 * runs a composition and writing it lands on two of the eight. The region
 * used to hand back a freshly built `Uint8Array` per read, which answered
 * reads correctly and swallowed every write, so `Poke $BFE001,x` went into a
 * buffer nobody would look at again. On the machine that Poke is `bchg #1`,
 * which is `Change Led`.
 *
 * The write goes through a Proxy on the indexed trap, the same technique the
 * Varptr arena uses to push a write back into an AMOS variable. `read()` runs
 * before every resolve so a read-modify-write sees the current pins.
 */
export function byteRegister(
  name: string,
  base: number,
  read: () => number,
  write: (v: number) => void,
): MemRegion {
  const buf = new Uint8Array(1)
  const view = new Proxy(buf, {
    set(t, prop, v): boolean {
      if (prop === '0') {
        write(Number(v) & 0xff)
        // read back: the bits the chip did not accept are still the pins'
        t[0] = read()
        return true
      }
      ;(t as unknown as Record<string | symbol, unknown>)[prop] = v
      return true
    },
  }) as Uint8Array
  return {
    name,
    base,
    reserved: 1,
    live: () => 1,
    resolve: (off, w) => {
      buf[0] = read()
      return { data: w ? view : buf, off }
    },
  }
}

/**
 * A read-only hardware register, one or two bytes, big-endian.
 *
 * POTGOR and the two JOYxDAT counters: the chip drives them and a write goes
 * to a different address entirely (POTGO at $DFF034), so there is nothing to
 * honour and a write lands in a buffer the next read overwrites. That is the
 * same silent loss `byteRegister` exists to stop, and it is correct here for
 * the one reason it was wrong there: on the machine the write does nothing
 * either.
 */
export function readOnlyRegister(name: string, base: number, size: 1 | 2, read: () => number): MemRegion {
  const buf = new Uint8Array(size)
  return {
    name,
    base,
    reserved: size,
    live: () => size,
    resolve: (off) => {
      const v = read()
      if (size === 2) {
        buf[0] = (v >> 8) & 0xff
        buf[1] = v & 0xff
      } else buf[0] = v & 0xff
      return { data: buf, off }
    },
  }
}

/** bound a resolved pair by its buffer, the check every slot resolver repeats */
export function within(data: Uint8Array, off: number): Resolved | null {
  return off < data.length ? { data, off } : null
}
