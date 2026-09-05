/**
 * exec.library — the memory pools, the library list, and `AllocMem`.
 *
 * Deliberately not the whole of exec. There is one task here, so Forbid and
 * Permit have nothing to forbid and stay n/a where they are; message ports,
 * signals and Wait have no second task to talk to. Modelling them now would be
 * inventing machinery to sit unused, and the three things AMOS and its
 * extensions genuinely ask exec for are how much memory is free, whether a
 * library is present, and a block of memory with an address.
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
/** one entry: the newest version answered for, and what the library is */
interface Modelled {
  version: number
  about: string
}

const MODELLED: ReadonlyMap<string, Modelled> = new Map([
  // catalogs, FormatDate, collation and case — ../amiga/localelib.ts
  [
    'locale.library',
    {
      version: 38,
      about:
        'Catalogs, FormatDate, string collation and case conversion, for programs written to be ' +
        'translated. Modelled by ./localelib.ts.',
    },
  ],
  // the filesystem, pattern matching and the DateStamp calendar
  [
    'dos.library',
    {
      version: 37,
      about:
        "AmigaDOS itself: the filesystem, the #? pattern syntax, and the DateStamp calendar that " +
        'counts days from 1 January 1978. Every file keyword in AMOS ends up here.',
    },
  ],
  // OctaMED's four-channel MMD0/MMD1 replayer, modelled by runtime/med.ts.
  // Version 7 because MED 7.1 opens all three of its players with
  // `moveq #$7,d0` and takes anything below as absent.
  //
  // Its two siblings are modelled by the same sequencer in runtime/med.ts:
  // `octaplayer.library` mixes 5-8 MMD2 tracks into Paula's four voices and
  // `octamixplayer.library` mixes up to 64 MMD3 tracks into a finished stream.
  // Both replayers are in fixtures under libs/medplayer,
  // and DOOM Productions wrapped both — DME_OctaMed.library shares 73% of
  // its bytes with octaplayer and DME_OctaMix 70% with octamixplayer — so
  // each has two independent copies to read. Nor is either short of a module
  // now: both carry the same four-way accept chain medplayer does
  // (`cmpi.l #"MMD3"` down to `#"MMD0"`, at $3044 of octaplayer and $3f8e of
  // octamixplayer), so the 187 MMD2 modules OctaMED Pro 6 shipped feed both.
  // What separates the three libraries is how many tracks reach audio, not
  // which files they take. See runtime/medext.ts.
  [
    'medplayer.library',
    {
      version: 7,
      about:
        "OctaMED's replayer for four-channel MMD0 and MMD1 modules. MED 7.1 opens it with " +
        '`moveq #$7,d0` and treats anything older as absent.',
    },
  ],
  [
    'octaplayer.library',
    {
      version: 7,
      about: "OctaMED's 5-8 channel MMD2 replayer and two-tracks-per-Paula-voice mixer.",
    },
  ],
  [
    'octamixplayer.library',
    {
      version: 7,
      about: "OctaMED's software-mixed MMD3 replayer for up to 64 channels.",
    },
  ],
  // the joyport and timer halves, modelled by ../amiga/lowlevel.ts. Two ports
  // open it: GameSupport with OpenLibrary, and TFT 0.7's `Init Tick Timer`
  // with OldOpenLibrary at -408, which carries no version at all. 40 is the
  // release the library first shipped in and neither caller asks for more.
  [
    'lowlevel.library',
    {
      version: 40,
      about:
        'One call that says what is in a gameport and what it is doing, so a program need not ' +
        "decode JOY0DAT's quadrature or clock a CD32 pad's seven buttons out by hand. Added in " +
        'AmigaOS 3.1 for games.',
    },
  ],
  // the XPK compression master --- ../amiga/xpkmaster.ts is a real port of the
  // stream format and the packer registry, and EasyLife already drives it.
  // Version 4 because that is what BUtility's routine 0 asks for.
  [
    'xpkmaster.library',
    {
      version: 4,
      about:
        'The XPK compression container and the registry of packers behind it, so a program packs ' +
        'and unpacks without knowing which algorithm did it. EasyLife and BUtility both drive it.',
    },
  ],
  // reqtools' and asl's file and text requesters, modelled by runtime/fsel.ts
  // and runtime/requester.ts: AMOS's own file selector and its Interface
  // dialog engine stand in for the windows, and every requester these two
  // libraries are asked for here has one. The versions are the ones BUtility
  // opens with -- v38 and v37, which are also the versions their own
  // documentation calls the first with the tag-list API used above.
  [
    'reqtools.library',
    {
      version: 38,
      about:
        "File, font and text requesters. AMOS's own file selector and its Interface dialog engine " +
        'stand in for the windows, and every requester this library is asked for here has one.',
    },
  ],
  [
    'asl.library',
    {
      version: 37,
      about:
        "Commodore's own file and font requesters, which reqtools was written to improve on. The " +
        'same standing here, and the same substitution.',
    },
  ],
  // Text to phonemes, the first half of the machine's speech chain. `OpNar`
  // (+Music.s:2489) opens it with OpenLibrary right after OpenDevice on
  // narrator.device, and treats either failing as the same error --- 185,
  // "Can't open narrator". Version 37 is the one Workbench 2 shipped.
  //
  // narrator.device itself is NOT here, and cannot be: it is opened with
  // OpenDevice, and this map is only what OpenLibrary answers for. The port
  // implements both halves through narrator-ts (see ../runtime/speech.ts),
  // so answering for the half that is asked for this way is the honest
  // position and refusing the other half would be a lie about the rest.
  [
    'translator.library',
    {
      version: 37,
      about:
        'English text to narrator phonemes, which is what Say and the SPEAK: handler translate with. ' +
        'Modelled by narrator-ts, whose letter-to-sound rules are a rebuild from published ' +
        'phonetics rather than Commodore\'s table.',
    },
  ],
  // GMS's core, modelled by ../runtime/thegame.ts: a GMS screen is a slot in
  // the machine's own screen table and a module call is a TypeScript call, so
  // the base only has to be non-zero. Version 2 because that is what The Game
  // Extension's `G Init Gms` demands, and the vendored library is V2.1.
  [
    'dpkernel.library',
    {
      version: 2,
      about:
        "The Games Master System's core, which a GMS program drives instead of AmigaOS. A GMS " +
        "screen is a slot in the machine's own screen table here and a module call is a " +
        'TypeScript call, so the base only ever has to be non-zero.',
    },
  ],
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
  const key = basename(name)
  const have = MODELLED.get(key)
  if (have === undefined || version > have.version) return 0
  return BASE_ORIGIN + [...MODELLED.keys()].indexOf(key) * BASE_STRIDE
}

/**
 * A library name with any path in front of it taken off.
 *
 * `OpenLibrary` takes a path and not just a name — exec looks the whole string
 * up in the resident list, and when that misses, DOS loads the file and the
 * init sets `lib_Node.ln_Name` to the bare name, which is what every later
 * open finds. So a library opened as `GMS:libs/dpkernel.library` is the same
 * library another program opens as `dpkernel.library`, and this is where the
 * two names are made to agree. The Game Extension is what forced it: it opens
 * dpkernel by full path, on the assumption that a GMS: assign exists.
 */
const basename = (name: string): string => name.toLowerCase().split(/[/:]/).pop() ?? ''

/** Whether a library is modelled at all, regardless of version. */
export function libraryPresent(name: string): boolean {
  return MODELLED.has(basename(name))
}

/** one modelled library, as a page listing them wants to read it */
export interface ModelledLibrary {
  name: string
  /** the highest version `OpenLibrary` will answer for */
  version: number
  /** the synthetic base it answers with, which nothing dereferences */
  base: number
  /** what the library is, for a page listing it */
  about: string
}

/**
 * Every library `OpenLibrary` answers for.
 *
 * A view over `MODELLED` in its declaration order, which is also the order the
 * bases are assigned in. Exported so the standalone page can list what is
 * installed without keeping a second copy that drifts from this one.
 */
export function modelledLibraries(): ModelledLibrary[] {
  return [...MODELLED].map(([name, m], i) => ({
    name,
    version: m.version,
    base: BASE_ORIGIN + i * BASE_STRIDE,
    about: m.about,
  }))
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

// ---- AllocMem and FreeMem --------------------------------------------------

/**
 * `AllocMem` and `FreeMem` over one buffer, mapped somewhere in the port's
 * synthesized address space.
 *
 * Most extensions that want memory want ONE block, and a `Uint8Array` on the
 * Runtime with a region pointing at it is enough for those. This is for the
 * ones that want many at once and expect them to be laid out in a single
 * address space with real gaps between them: SLN chains its loaded samples
 * through pointers in their own headers, and Make hands a program `Ma Malloc`
 * and expects it to thread its own exec-style lists through the results. A
 * program walking either with `Leek` sees nothing at all unless the blocks
 * have distinct, ordered addresses.
 *
 * So: first fit over a free list, eight-byte granularity as `AllocMem` has,
 * coalescing on free, and no headers of its own — the bookkeeping is beside
 * the pool rather than in front of each block, because a caller that lays its
 * OWN header at the address it was given (both of them do) would otherwise
 * find it four or eight bytes further on than the Amiga puts it.
 *
 * There is one pool here where the Amiga has two, so `MEMF_CHIP` is RECORDED
 * rather than honoured: `chip()` answers `TypeOfMem` for a block that asked
 * for it, which is what a caller checking whether it may hand an address to
 * Paula actually needs. `MEMF_CLEAR` is honoured outright, because callers are
 * careful about it in both directions and it is observable through `Peek`.
 *
 * `base` and `reserved` are the caller's: the pool has to sit where that
 * caller's memory region was declared, and how much of the map it may claim is
 * that region's business. `memmap.test.ts` holds the two to agreeing.
 */
export class MemPool {
  /** what the region maps; grows by doubling, and addresses are offsets into it */
  buffer = new Uint8Array(0)
  /** the bump pointer: everything above it has never been handed out */
  private top = 0
  /** returned blocks, sorted by offset and coalesced */
  private free: Array<{ off: number; len: number }> = []
  /** what each live block was given, so callers can ask a block's size back */
  private live = new Map<number, number>()
  /** offsets that were asked for as chip memory, for `TypeOfMem` */
  private chipBlocks = new Set<number>()

  constructor(
    readonly base: number,
    readonly reserved: number,
  ) {}

  /** AllocMem: an ADDRESS, or 0. Offset 0 is never handed out, so 0 is unambiguous */
  alloc(len: number, opts: { clear?: boolean; chip?: boolean } = {}): number {
    if (len <= 0) return 0
    const need = (len + 7) & ~7
    for (let i = 0; i < this.free.length; i++) {
      const b = this.free[i]!
      if (b.len < need) continue
      const off = b.off
      if (b.len === need) this.free.splice(i, 1)
      else {
        b.off += need
        b.len -= need
      }
      return this.take(off, need, opts)
    }
    // 8 bytes of dead space at the bottom so no real block sits at offset 0
    if (this.top === 0) this.top = 8
    const off = this.top
    // the bump only happens once the block is known to fit. A request the pool
    // cannot meet must leave it exactly as it was: IntuiExtend's
    // `Wb Flush Memory` asks for 999,999,999 bytes precisely so that it will
    // fail, and a refusal that consumed the pool anyway made every later
    // allocation fail too.
    if (off + need > this.reserved) return 0
    this.top = off + need
    if (this.top > this.buffer.length) {
      let size = Math.max(this.buffer.length * 2, 0x10000)
      while (size < this.top) size *= 2
      const grown = new Uint8Array(Math.min(size, this.reserved))
      grown.set(this.buffer)
      this.buffer = grown
    }
    return this.take(off, need, opts)
  }

  private take(off: number, len: number, opts: { clear?: boolean; chip?: boolean }): number {
    this.live.set(off, len)
    if (opts.chip) this.chipBlocks.add(off)
    else this.chipBlocks.delete(off)
    if (opts.clear) this.buffer.fill(0, off, off + len)
    return (this.base + off) >>> 0
  }

  /**
   * FreeMem. The caller supplies the length on the Amiga and this ignores it,
   * deliberately: a caller that hands back the wrong block with the right
   * length is a real thing to model, and an allocator that trusted the length
   * would turn that into an arena corruption nothing could observe. What this
   * reproduces is WHICH block goes back.
   */
  freeMem(addr: number): void {
    const off = (addr >>> 0) - this.base
    const len = this.live.get(off)
    if (len === undefined) return
    this.live.delete(off)
    this.chipBlocks.delete(off)
    this.free.push({ off, len })
    this.free.sort((a, b) => a.off - b.off)
    for (let i = this.free.length - 1; i > 0; i--) {
      const prev = this.free[i - 1]!
      const here = this.free[i]!
      if (prev.off + prev.len === here.off) {
        prev.len += here.len
        this.free.splice(i, 1)
      }
    }
  }

  /** TypeOfMem: is this address inside a block that was asked for as chip? */
  chip(addr: number): boolean {
    const off = (addr >>> 0) - this.base
    for (const b of this.chipBlocks) {
      const len = this.live.get(b)
      if (len !== undefined && off >= b && off < b + len) return true
    }
    return false
  }

  /** the length a block was given, or 0 */
  sizeOf(addr: number): number {
    return this.live.get((addr >>> 0) - this.base) ?? 0
  }

  /**
   * Live bytes, split by the pool each block was asked from.
   *
   * Here rather than in the caller because `chipBlocks` and `live` are both
   * private and a caller that tracked its own totals would have two places for
   * them to disagree. D-Sam is the first to need it: its samples are real
   * megabytes of chip, and routine 64 asks `AvailMem` whether the next one
   * fits, so the machine's free figure has to fall as the pool fills.
   */
  usage(): { chip: number; fast: number } {
    let chip = 0
    let fast = 0
    for (const [off, len] of this.live) {
      if (this.chipBlocks.has(off)) chip += len
      else fast += len
    }
    return { chip, fast }
  }

  /**
   * Hand back the FRONT of a block and keep the rest.
   *
   * AmigaOS allows it — a block is not an object, it is a range on the memory
   * list — and callers that load a file with a header they then want to skip
   * do exactly this: free the first N bytes and carry on using `block + N`.
   */
  shrinkFront(addr: number, bytes: number): void {
    const off = (addr >>> 0) - this.base
    const len = this.live.get(off)
    if (len === undefined || bytes <= 0 || bytes >= len) return
    this.live.delete(off)
    const chip = this.chipBlocks.delete(off)
    this.live.set(off + bytes, len - bytes)
    if (chip) this.chipBlocks.add(off + bytes)
    this.free.push({ off, len: bytes })
    this.free.sort((a, b) => a.off - b.off)
  }
}
