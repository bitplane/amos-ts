/**
 * exec.library — the memory pools and the library list.
 *
 * Deliberately not the whole of exec. There is one task here, so Forbid and
 * Permit have nothing to forbid and stay n/a where they are; message ports,
 * signals and Wait have no second task to talk to. Modelling them now would be
 * inventing machinery to sit unused, and the two things AMOS and its
 * extensions genuinely ask exec for are how much memory is free and whether a
 * library is present.
 *
 * ## What lives here and what does not
 *
 * The POOL SIZES and the arithmetic are exec's. What is *in* them is not: a
 * bank's chip-ness comes from an AMOS bank flag, a screen's bitplanes are
 * charged to chip because AMOS put them there, and only the Runtime knows what
 * it has allocated. So `availMem` takes usage as an argument rather than
 * reaching for it. The layer holds mechanism; the accounting stays with the
 * caller doing the accounting.
 *
 * That split matters for one non-obvious reason. `Jd Cpu`, `Jd Chipset` and
 * TURBO's `Cpu Info` all derive the machine's identity from these numbers —
 * 2MB of chip plus a fast board is what makes the answer "A1200" rather than
 * "A500". The pool sizes are load-bearing for questions that are not about
 * memory at all, which is an argument for their having one home.
 */

/**
 * exec's memory requirement flags (exec/memory.i).
 *
 * These existed only as bare hex in the callers — `$10002` in TURBO, `$20004`
 * in JD, `MEMF_CLEAR` as a word in three comments — which is how a reader ends
 * up checking a bit twice to be sure which pool a keyword meant.
 */
export const MEMF = {
  ANY: 0,
  PUBLIC: 1 << 0,
  CHIP: 1 << 1,
  FAST: 1 << 2,
  LOCAL: 1 << 8,
  /** zero the block before returning it */
  CLEAR: 1 << 16,
  /** report the largest single free block rather than the total */
  LARGEST: 1 << 17,
} as const

export interface MemoryPools {
  readonly chip: number
  readonly fast: number
}

/**
 * The machine this port claims to be.
 *
 * A constant would be worse than useless: a program that reserves banks until
 * `Chip Free` runs out never stops. These are generous enough that "have I
 * room for this?" passes, while still falling as the program allocates.
 */
export const A1200_POOLS: MemoryPools = {
  chip: 2 * 1024 * 1024,
  fast: 8 * 1024 * 1024,
}

/** What the caller has allocated out of each pool. */
export interface MemoryInUse {
  chip: number
  fast: number
}

/**
 * AvailMem(flags) — free bytes in the pool the flags name.
 *
 * MEMF_LARGEST returns the same figure as the total. That is not laziness: it
 * is the honest answer for an allocator that does not fragment, since with no
 * holes the largest block IS everything free. A caller that wants to model
 * fragmentation has to decide what its own ceiling is, and that decision
 * belongs to the caller — LDos's `Llargest Free` is the one that does.
 *
 * MEMF_ANY (neither CHIP nor FAST) reports both pools together, as exec does.
 */
export function availMem(pools: MemoryPools, used: MemoryInUse, flags: number = MEMF.ANY): number {
  const chip = Math.max(0, pools.chip - used.chip)
  const fast = Math.max(0, pools.fast - used.fast)
  if (flags & MEMF.CHIP) return chip
  if (flags & MEMF.FAST) return fast
  return chip + fast
}

// ---- the library list ------------------------------------------------------

/**
 * Libraries this port models, and the version each answers for.
 *
 * `OpenLibrary` is the gate every extension passes through before it does
 * anything, and until now nothing represented it: `locale.library` was
 * "modelled as present" by a comment, and the base pointer was a constant in
 * the extension's own state. That works for one library and stops working at
 * two, because the interesting answer is increasingly *no* — BSDSocket wants
 * bsdsocket.library, BUtility wants reqtools, asl and xpkmaster, and a port
 * that cannot say "absent" has to pretend instead.
 */
const MODELLED: ReadonlyMap<string, number> = new Map([
  // catalogs, FormatDate, collation and case — ../amiga/localelib.ts
  ['locale.library', 38],
  // the filesystem, pattern matching and the DateStamp calendar
  ['dos.library', 37],
])

/**
 * Synthetic library bases.
 *
 * A base only ever has to be non-zero and distinguishable: nothing here
 * dereferences one, because a library call is a TypeScript function call in
 * this port rather than a jump through a negative offset. The range is high
 * and obviously synthetic so a base that escapes into a program's variable is
 * recognisable in a bug report rather than looking like a plausible address.
 */
const BASE_ORIGIN = 0x7f10_0000
const BASE_STRIDE = 0x0001_0000

/**
 * OpenLibrary(name, version) — a base, or 0 when it cannot be opened.
 *
 * Zero for a library not modelled at all, and zero when the caller demands a
 * version newer than the one answered for, which is exactly exec's contract
 * and the check every well-written extension makes before giving up politely.
 */
export function openLibrary(name: string, version = 0): number {
  const key = name.toLowerCase()
  const have = MODELLED.get(key)
  if (have === undefined || version > have) return 0
  return BASE_ORIGIN + [...MODELLED.keys()].indexOf(key) * BASE_STRIDE
}

/** Whether a library is modelled at all, regardless of version. */
export function libraryPresent(name: string): boolean {
  return MODELLED.has(name.toLowerCase())
}

/**
 * CloseLibrary — nothing to release.
 *
 * Present so a port can spell the pairing it actually performs; open/close
 * counting would be modelling bookkeeping no program can observe.
 */
export function closeLibrary(_base: number): void {
  /* nothing to release */
}
