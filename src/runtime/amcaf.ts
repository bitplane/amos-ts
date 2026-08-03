/**
 * AMCAF — Chris Hodges' extension, 281 keywords at slot 8. Freeware.
 *
 * The largest third-party extension in the archive and the best documented:
 * a 235KB AmigaGuide with a real manual entry for 234 of the 280 distinct
 * keywords, and 279 of the 281 names appearing somewhere in it.
 *
 * ## Identity: one port, two releases
 *
 * `amcaf-1.40` (26-Dec-95) and `amcaf-1.50` share **268 keyword names**.
 * 1.50 adds twelve and removes none, so it is 1.40 plus additions rather than
 * a reworking — which is exactly why the 1.50 manual documents 1.40. One port
 * serves both, the way the two Personnal releases and the three TURBOs do.
 *
 * ## Evidence tier: manual for 1.40, disassembly for what 1.50 added
 *
 * The author says so himself: *"AMCAF V1.50beta4 is the FINAL RELEASE!
 * FREEWARE!"* and, of the manual, *"Sorry, but I didn't have time to update
 * the manual. You'll have to find out the new commands since V1.40
 * yourself."*
 *
 * So the honest split is **manual tier for the 1.40 subset** and
 * **disassembly tier for the twelve 1.50 additions** — the transparency
 * group (`Trans Screen Static/Dynamic/Runtime`, `Alloc`/`Set Trans
 * Map`/`Source`), `Alloc Code Bank`, `Turbo Text`, `Pt Free Voice`, `Sload`
 * and `Ssave`. C2P is undocumented too: it appears only in the history node,
 * crediting Mikael Kalms' routine.
 *
 * Where the two disagree the binary wins. `extdis amcaf-1.50` decodes a
 * 45,532-byte code hunk, jump table at +18, 354 routines from $1c28.
 *
 * ## The 1.40 binary we hold is the DEMO build, and 1.50 is the better oracle
 *
 * Found while following the date routines. Almost every routine in 1.40 opens
 *
 *     tst.w   -$16(a5)
 *     Rbmi    routine 144
 *
 * and routine 144 is `moveq #$0,d0 / Rbra routine 379`, which puts up a
 * requester reading **"Demo Version! Nicht kompilierbar!"** — not compilable.
 * The same file carries "AMCAF Demoversion! Please register!" in its init
 * routine. **1.50 has neither string and none of the guards**: its Cd Year is
 * the identical loop with the four-byte preamble simply absent.
 *
 * So `amcaf-1.40` is the shareware release and `amcaf-1.50` the freeware final
 * the author announced. Nothing about the arithmetic differs — the two agree
 * instruction for instruction once the preamble is discounted — but citations
 * should prefer 1.50, and the guard itself is n/a: it fires only under the
 * AMOS Professional Compiler, which this port does not model.
 *
 * ## The Guide's history node is a primary source
 *
 * Unusually, the manual carries a dated changelog going back to 1993, and it
 * documents behaviour nothing else records — including bugs the author found
 * and fixed. Two examples worth having on file before the graphics slice:
 *
 * - *"Found and removed an error in the Blitter Fill commands. Blitter Fill
 *   filled the screen one line to deep -> memory got corrupted."*
 * - *"Error in the tokenlist caused a wrong syntax of Blitter Fill to be
 *   converted into Pt Play. Funny :)"*
 *
 * Both are FIXED by the releases we hold, so neither is reproduced; they are
 * recorded because a program written against an older AMCAF may have been
 * built around them.
 *
 * ## There are TWO failure mechanisms, and one of them has a message table
 *
 * This section used to say the extension ships no error strings at all. It
 * does, and the correction is worth stating because the original claim was
 * made from a genuine reading — it just stopped one branch short.
 *
 * Failures reach `L_ScCopy` with an AMOS error NUMBER, which is a trappable
 * AMOS error and has no text of its own. Four of those are in use:
 *
 *   routine 389 → 24  Out of memory
 *   routine 390 → 23  Illegal function call
 *   routine 391 → 81  File format not recognised
 *   routine 392 → 94  Next without For in animation string
 *
 * The last two read as nonsense because they are: the numbers are borrowed and
 * the AMOS text has nothing to do with what failed. That is still what a
 * program's `Errn` reports.
 *
 * But routine 397 goes to `L_Dia_ScCopy` instead — a REQUESTER — with a
 * message index in d0 and a NUL-separated list of nineteen strings at $af94,
 * from "Can't reopen Workbench" to "MC68020 or higher required!". `AMCAF_ERRORS`
 * below holds them. The list starts on the terminator before the first string,
 * so the index is 1-based; the OS-2.0 gate passing `moveq #$c,d0` and landing
 * on "Kickstart 2.04 or greater required" is the proof.
 *
 * `Io Error` and `Io Error$` are a third thing again, and belong to neither:
 * they return **AmigaDOS** codes and strings — *"Returns the last dos error
 * code"*, *"Returns a dos errorstring"*.
 *
 * ## Contested names
 *
 * Thirteen of the 281 names are also spelled by something else, and seven of
 * those are ARMED — the other side is already ported, so a plain-name
 * registration would silently replace a working implementation:
 *
 *   Blitter Clear, Blitter Copy, Blitter Copy Limit,
 *   Set Ntsc, Set Pal, Speek              -> Personnal
 *   Sload, Ssave                          -> the Music extension, EME
 *
 * The decision is to declare all eight `qualified` in EXT_IMPLS, so they
 * register as `ext8:<name>` and dispatch resolves them by the slot the
 * program actually bound — which is what the machine does, where the two are
 * different tokens at different slots and coexist. Personnal keeps the plain
 * names.
 *
 * They cannot be declared ahead of the keywords: `extimpl.test.ts` requires
 * every qualified name to be one the port actually defines, which is what
 * stops the list rotting into a wish. So the declarations arrive with their
 * slices — Sload/Ssave in slice 5, the six Personnal names in slice 7.
 *
 * The remaining six are latent (neither side ported): `Bank Name`,
 * `Bank Name$`, `Open Workbench`, `Pal Spread`, `Raster Wait`, `Xfire`.
 *
 * ## State
 *
 * The extension keeps one data block, which `Amcaf Base` and `Amcaf Length`
 * hand a program the address and size of. Nothing is in it yet; each slice
 * adds the fields its keywords need.
 */

import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import type { Interp } from '../interp/interp'
import { AmosError, VI, VS, int, str, type Value } from '../interp/values'
import { DAY_MS, STAMP_EPOCH, TICKS_PER_SECOND, stampToYmd } from '../amiga/datestamp'
import { MAX_COMMENT, blocksFor, entryType, protectionString } from '../amiga/dos'
import { fillRow } from '../amiga/blitter'
import { AMIGA_PERIODS, clampVolume, periodToHz } from '../amiga/paula'
import { parseSampleBank } from './audio'
import { pp20Decrunch } from '../amiga/powerpacker'
import { JOY_DIRECTIONS, JOY_DOWN, JOY_FIRE, JOY_LEFT, JOY_RIGHT, JOY_UP, MAX_PORT, PORT_MOUSE, joyFire } from '../interp/gameport'
import { BitMap } from '../amiga/graphics'
import { amigaMatch } from '../amiga/dospattern'
import { joinAmigaPath } from '../amiga/vfs'

/**
 * The FileInfoBlock the Examine family fills in.
 *
 * `Examine Dir` "loads all information about the drawer into the
 * FileInfoBlock", `Examine Next$` steps it to each entry in turn, and
 * `Examine Object` fills it for one named object. The `Object *` accessors
 * then read whichever object it currently describes — which is why they all
 * have a no-argument form as well as a path one.
 */
export interface AmcafExamine {
  /** the directory being walked, or '' after Examine Stop */
  dir: string
  entries: string[]
  index: number
  /** the path the accessors currently answer for */
  current: string
}


/**
 * Splinters: pixels lifted off a picture that keep the colour they took.
 *
 * "Splinters are similar to Td Stars, but they don't destroy the background
 * and use the colour of the pixel they have removed and Splinters require a
 * list of coordinates. Each coordinate requires four bytes, i.e already a
 * field of 16x16 coordinates consumes 16 KB of memory."
 *
 * "Each Splinter requires 22 bytes of memory" in the bank, which is what
 * `Splinters Bank bank,splinum` reserves.
 */
export interface SplinterState {
  bank: number
  max: number
  coordsBank: number
  /** the (x,y) pairs Coords Read gathered, which Init feeds the engine from */
  coords: Array<[number, number]>
  next: number
  p: Array<{ x: number; y: number; vx: number; vy: number; c: number; life: number }>
  gx: number
  gy: number
  /** "the number of steps the splinters are moved before they vanish"; 0 = never */
  fuel: number
  /** "the max. amount of new Splinters to appear on each step"; -1 = no limit */
  maxNew: number
  bkColour: number
  planes: number
  limit: Limit | null
  saved: { x: number; y: number; c: number }[] | null
  /** the generation before `saved` — what a Double Del puts back */
  savedPrev: { x: number; y: number; c: number }[] | null
}

/**
 * Td Stars: a 3D starfield, "Each star consumes 12 bytes of memory".
 *
 * Unlike Splinters these DO destroy the background, which is why the manual
 * pairs Draw with a matching Del rather than saving anything.
 */
export interface TdStarState {
  bank: number
  max: number
  s: Array<{ x: number; y: number; z: number; vx: number; vy: number }>
  gx: number
  gy: number
  accelerate: boolean
  ox: number
  oy: number
  planes: number
  limit: Limit | null
}


/**
 * The ProTracker replayer's state — the third module player in this port,
 * after AMOS's own tracker and MED.
 *
 * The module itself stays in its AMOS bank; this holds only what the keywords
 * report and control. `cia` is the timing source the manual makes a point of:
 * "if you specify a value of zero, the timing will be switched from
 * CIA-Timing to Vertical Blank Timing. Then the bpm rate is automatically set
 * to exactly 125."
 */
export interface PtState {
  bank: number
  samBank: number
  playing: boolean
  pos: number
  row: number
  tick: number
  speed: number
  bpm: number
  cia: boolean
  volume: number
  /** which of the four voices the music may use */
  voices: number
  signal: number
  vu: number[]
  note: number[]
  instr: number[]
  /** Pt Free Voice: which voices are not claimed by the music */
  free: boolean[]
}

export interface AmcafState {
  /** the single Examine context; the extension keeps exactly one */
  examine: AmcafExamine
  /** the last AmigaDOS error, which Io Error reports */
  ioError: number
  /** BPLCON2's dual-playfield sprite priority, as Set Sprite Priority left it */
  spritePriority: number
  /**
   * The word at $2d2 of the extension's block — BITS PER GUN, not a flag.
   *
   * 4 means a 12-bit $RGB argument and 8 a 24-bit $RRGGBB one, and the
   * extension's own init routine sets it to 4, which is the manual's "the
   * default setting is 12 bit". Only Red Val, Green Val and Blue Val read it.
   */
  notationBits: number
  /**
   * Shade Bob state.
   *
   * `shadePlanes` is how many bitplanes a shade bob cycles through --
   * "protect the graphics in higher bitplanes from the influences of Shade
   * Bobs ... must be a value between 1 and 6" -- and `shadeMask` chooses
   * whether the bob's mask or its first bitplane says where it touches.
   */
  shadePlanes: number
  shadeMask: boolean
  /**
   * Qrnd's own generator state — a seed stirred by the beam register, and the
   * last result, which `Qrnd(0)` hands back. NOT AMOS's Rnd, whatever the
   * manual says: see the keyword.
   */
  qseed: number
  qlast: number
  /**
   * The rectangle Blitter Copy works within — "Before you can call Blitter
   * Copy, you MUST set the limits of the operation using Blitter Copy Limit".
   */
  bltLimit: Limit | null
  /** the bank Ptile blocks come from */
  ptileBank: number
  /** the two particle engines, which share a command shape but not a model */
  splinters: SplinterState
  stars: TdStarState
  /**
   * The second mouse's own position, speed and limits.
   *
   * A distinct pointer from AMOS's, exactly as Sticks' Mouse family is: the
   * hardware is a second mouse in the joystick port, and nothing here drives
   * one, so the position is wherever a program last put it.
   */
  smouse: { x: number; y: number; speed: number; limit: { x1: number; y1: number; x2: number; y2: number } | null }
  /** the ProTracker replayer's state */
  pt: PtState
  /** Vec Rot's angles, position and the last computed projection */
  vec: { ax: number; ay: number; az: number; px: number; py: number; pz: number; x: number; y: number; z: number }
  /**
   * The eight "interior palette memory" buffers Pal Get/Set address.
   *
   * "palnr must be range from 0 to 7", and each holds a whole screen's worth
   * of 12-bit entries: "This command is used to quickly store a specific
   * palette of a screen in a buffer."
   */
  palettes: Uint16Array[]
  /**
   * Placeholder for the extension's data base.
   *
   * `Amcaf Base` returns its address and `Amcaf Length` its size, so a
   * program can poke the internals — which the manual describes as being for
   * "Assembler and C freaks" and warns about. Both are slice 10; until then
   * there is nothing to point at.
   */
  readonly present: true
}

export function newAmcafState(): AmcafState {
  return {
    examine: { dir: '', entries: [], index: -1, current: '' },
    ioError: 0,
    spritePriority: 0,
    notationBits: 4,
    shadePlanes: 6,
    shadeMask: true,
    qseed: 0,
    qlast: 0,
    bltLimit: null,
    ptileBank: 0,
    splinters: {
      bank: 0, max: 0, coordsBank: 0, coords: [], next: 0,
      p: [], gx: 0, gy: 0, fuel: 0, maxNew: -1,
      bkColour: 0, planes: 6, limit: null, saved: null, savedPrev: null,
    },
    stars: {
      bank: 0, max: 0, s: [], gx: 0, gy: 0,
      accelerate: false, ox: 160, oy: 100, planes: 6, limit: null,
    },
    smouse: { x: 0, y: 0, speed: 1, limit: null },
    pt: {
      bank: 0, samBank: 0, playing: false, pos: 0, row: 0, tick: 0,
      speed: 6, bpm: 125, cia: true, volume: 64, voices: 0b1111,
      signal: 0, vu: [0, 0, 0, 0], note: [0, 0, 0, 0], instr: [0, 0, 0, 0],
      free: [true, true, true, true],
    },
    vec: { ax: 0, ay: 0, az: 0, px: 0, py: 0, pz: 256, x: 0, y: 0, z: 0 },
    palettes: Array.from({ length: 8 }, () => new Uint16Array(32)),
    present: true,
  }
}

/**
 * The keyword tables, filled a slice at a time.
 *
 * Empty is the correct starting state and not a stub: a name nothing
 * registers is simply unimplemented, the census counts it as missing, and
 * `coverage.test.ts` requires that an n/a keyword have NO handler. Wiring the
 * port up before the first keyword proves the plumbing — identity resolution,
 * slot binding and the qualified names — separately from any behaviour.
 */
export function makeAmcafInstructions(rt: Runtime): Record<string, Instr> {
  void rt
  return {

    /**
     * Examine Dir directory$ — routine 109 ($3a32). "Loads all information
     * about the drawer into the FileInfoBlock. Additionally, the contents of
     * the directory can be read out by Examine Next$."
     *
     * It opens with `Rbsr` into Examine Stop, so starting a second walk closes
     * the first rather than leaking its lock. Then `Lock(name, -2)` — a SHARED
     * lock — which failing is error 81, and `Examine()` into the block's own
     * FileInfoBlock at +$100, which failing is error 94.
     *
     * The check an earlier pass had no reason to expect is the last one:
     *
     *   tst.l  $4(a2)       ; fib_DirEntryType
     *   bmi.b  $3a70        ; negative -- a FILE -- so stop and fail
     *
     * so Examine Dir handed a plain file locks it, examines it, then throws it
     * away as error 94 rather than treating it as an empty directory.
     */
    'examine dir'(it) {
      const dir = amcafPath(it.evalStr())
      const kind = rt.vfs?.exists(dir) ?? null
      if (kind === null) {
        rt.amcaf.ioError = 205 // ERROR_OBJECT_NOT_FOUND
        amcafDosErr()
      }
      if (kind !== 'dir') {
        rt.amcaf.examine = { dir: '', entries: [], index: -1, current: '' }
        rt.amcaf.ioError = 212 // ERROR_OBJECT_WRONG_TYPE
        amcafExamineErr()
      }
      const entries = rt.vfs?.listDir(dir) ?? []
      rt.amcaf.examine = { dir, entries: entries.map((e) => e.name), index: -1, current: dir }
      rt.amcaf.ioError = 0
    },

    /**
     * Examine Object file$ — routine 112 ($3ad6). "Supplies you with all
     * available information about the [object], [readable through] the
     * functions without any parameters."
     *
     * The same Lock and Examine as Examine Dir, but it `UnLock`s straight away
     * and keeps nothing, so it works on a file as happily as on a directory
     * and leaves any directory walk in progress alone. Lock failing is error
     * 81 and Examine failing error 94.
     */
    'examine object'(it) {
      const path = amcafPath(it.evalStr())
      if (!rt.vfs || rt.vfs.exists(path) === null) {
        rt.amcaf.ioError = 205
        amcafDosErr()
      }
      rt.amcaf.examine.current = path
      rt.amcaf.ioError = 0
    },

    /**
     * Examine Stop — routine 111 ($3ab6). "Aborts the reading process of a
     * directory. After this command, you may not make any further calls to
     * Examine Next$."
     *
     * `UnLock` and clear, wrapped in a `movem.l` of everything it touches —
     * it is written to be called as a subroutine, which Examine Dir and
     * Examine Next$ both do.
     */
    'examine stop'() {
      rt.amcaf.examine = { dir: '', entries: [], index: -1, current: '' }
    },

    /**
     * Protect Object pathfile$,prot — routine 130 ($3c02), `SetProtection`
     * (dos.library -$ba) with the value straight through.
     *
     * `move.l (a3)+,d2` takes the whole LONGWORD, so bits above the eight
     * AmigaDOS names reach the library untouched; an earlier pass masked to a
     * byte. Failure is error 81, the same as every other dos.library call here.
     */
    'protect object'(it) {
      const path = it.evalStr()
      it.expect(',')
      const prot = it.evalInt()
      if (!rt.vfs || rt.vfs.exists(amcafPath(path)) === null) amcafDosErr()
      rt.vfs.setMeta(path, { protection: prot })
    },

    /**
     * Set Object Comment pathfile$,comment$ — routine 131 ($3c20),
     * `SetComment` (dos.library -$b4).
     *
     * NOTE: the routine copies the AMOS string to its own block with a plain
     * `dbra` loop and no length check at all, so the 79-character FileNote
     * limit is the LIBRARY's rather than the extension's — an over-long
     * comment reaches SetComment, which refuses it, and the result is error 81
     * rather than a silently truncated note. That is what this now does; the
     * earlier port truncated and reported success.
     */
    'set object comment'(it) {
      const path = it.evalStr()
      it.expect(',')
      const comment = it.evalStr()
      if (!rt.vfs || rt.vfs.exists(amcafPath(path)) === null) amcafDosErr()
      if (comment.length > MAX_COMMENT) amcafDosErr()
      rt.vfs.setMeta(path, { comment })
    },

    /**
     * Set Object Date pathfile$,date,time — routine 132 ($3c54),
     * `SetFileDate` (dos.library -$18c). "This command only works on OS2.0 and
     * higher", which is a real `cmp.w #$25` against ExecBase's LIB_VERSION.
     *
     * The arguments unwind time-first, and only the LOW WORDS of ds_Minute and
     * ds_Tick are written (`move.w d0,$38a(a2)`, `swap`, `move.w d0,$386`) —
     * the high words of both are left holding whatever the last DateStamp call
     * put there.
     */
    'set object date'(it) {
      const path = it.evalStr()
      it.expect(',')
      const days = it.evalInt()
      it.expect(',')
      const t = it.evalInt()
      if (!rt.vfs || rt.vfs.exists(amcafPath(path)) === null) amcafDosErr()
      rt.vfs.setMeta(path, { days, mins: timeMins(t), ticks: timeTicks(t) })
    },

    /**
     * File Copy sourcefile$ To targetfile$ — routine 108 ($395e).
     *
     * "This command allows you to even copy a file of 3 MB in size, even if
     * you only got 100 KB of free memory", and the routine shows exactly how:
     * it asks `AllocMem` for the whole file, and on failure HALVES the request
     * and asks again, giving up only below $2800 — ten kilobytes — at which
     * point it raises its own out-of-memory error rather than 81. Then it
     * copies in buffer-sized chunks.
     *
     * A source it cannot open is error 81 and so is a destination; a Read or
     * Write that fails part way through is error 94. A file of length zero
     * takes a short path that opens and closes the destination without
     * allocating anything, so the copy of an empty file is an empty file
     * rather than a failure.
     *
     * NOTE: there is no memory pressure here and no chunking, so the halving
     * loop and its floor are behaviour this port cannot reach — the result is
     * the same file either way.
     */
    'file copy'(it) {
      const from = it.evalStr()
      it.expect('to')
      const to = it.evalStr()
      const data = rt.vfs?.readFile(amcafPath(from)) ?? null
      if (data === null) {
        rt.amcaf.ioError = 205
        amcafDosErr()
      }
      rt.vfs?.writeFile(amcafPath(to), data)
      rt.amcaf.ioError = 0
    },

    /**
     * Wload / Dload file$,bank — "loads the file named file$ completely into
     * memory", the manual even giving the long way round:
     * `Open In 1,FILE$ : LE=Lof(1) : Close 1 : Reserve As Work BANK,LE ...`
     *
     * The pair differ only in the bank kind, Work against Data, which is the
     * Bank Temporary / Bank Permanent distinction again.
     */
    'wload'(it) {
      loadToBank(rt, it, false)
    },
    'dload'(it) {
      loadToBank(rt, it, true)
    },

    /** Wsave / Dsave file$,bank — "Dsave is exactly the same as Wsave" */
    'wsave'(it) {
      saveBank(rt, it)
    },
    'dsave'(it) {
      saveBank(rt, it)
    },


    /**
     * Pal Set palnr,index,colour — routine 338 ($74e6). "Palnr must be range
     * from 0 to 7", and the routine agrees: `cmp.w #$8,d0 / Rbge`.
     *
     * The INDEX bound is the one the manual leaves out and an earlier pass got
     * wrong. `cmp.w #$20,d1 / Rbge` — thirty-two, not 256 — and the address it
     * works out confirms it: `add.w d1,d1 / lsl.w #$6,d0 / or.w d0,d1` is
     * `pal*64 + index*2` into a block at $4aa(a2), which is eight palettes of
     * thirty-two WORDS and no more. Both bounds also reject a negative.
     */
    'pal set'(it) {
      const pal = it.evalInt()
      it.expect(',')
      const idx = it.evalInt()
      it.expect(',')
      const col = it.evalInt()
      if (pal < 0 || pal > 7 || idx < 0 || idx > 31) amcafErr()
      rt.amcaf.palettes[pal]![idx] = col & 0xffff
    },

    /**
     * Pal Get Screen palnr,screen / Pal Set Screen palnr,screen — routines 335
     * ($744c) and 336 ($747c), "Writes back the previously stored palette".
     *
     * Both are the same eight instructions with the `move.l` reversed, and
     * both copy `moveq #$f,d7` plus a `dbra` — SIXTEEN LONGWORDS, which is
     * **thirty-two colours** and no more. An earlier pass copied up to 256, so
     * on a 64- or 256-colour screen it was saving and restoring entries the
     * extension never touches. The buffer it copies into is the same 32-word
     * block Pal Get and Pal Set index, which is why the two agree.
     *
     * Pal Set Screen ends `movea.l -$8(a5),a0 / jsr $4(a0)` — a View, so the
     * change is on screen without the program asking. Pal Get Screen does not.
     */
    'pal get screen'(it) {
      const pal = it.evalInt()
      it.expect(',')
      const s = rt.screens.get(it.evalInt())
      if (pal < 0 || pal > 7 || !s) amcafErr()
      const buf = rt.amcaf.palettes[pal]!
      for (let i = 0; i < 32; i++) buf[i] = s.palette[i] ?? 0
    },

    'pal set screen'(it) {
      const pal = it.evalInt()
      it.expect(',')
      const s = rt.screens.get(it.evalInt())
      if (pal < 0 || pal > 7 || !s) amcafErr()
      const buf = rt.amcaf.palettes[pal]!
      for (let i = 0; i < 32 && i < s.palette.length; i++) s.palette[i] = buf[i]!
    },

    /**
     * Pal Spread c1,rgb1 To c2,rgb2 — routine 334 ($736a). "Creates a smooth
     * blend between the two colours ... The resulting colour set will be
     * stored between c1 and c2."
     *
     * Both pen numbers are checked against 32, and then `cmp.w d6,d7 / bgt`
     * with an `exg` pair behind it: **the ends are SWAPPED if they are the
     * wrong way round** rather than refused, so `Pal Spread 8,$FFF To 2,$000`
     * is the same blend as `2,$000 To 8,$FFF`. An earlier pass errored on it.
     * A span of zero writes the one entry and returns.
     *
     * Each gun is worked out at DOUBLE scale and halved with the carry added
     * back — `lsr.w #$1,d1 / addx.w d2,d1` — which is round-to-nearest rather
     * than the truncation a plain shift would give, and both halves are
     * rounded separately before being summed. The sum is then clamped to 15
     * (`cmp.w #$f,d2 / ble / moveq #$f,d2`), which matters because two rounded
     * halves can add to 16.
     *
     * It ends with a View, so the blend appears without the program asking.
     */
    'pal spread'(it) {
      let c1 = it.evalInt()
      it.expect(',')
      let rgb1 = it.evalInt()
      it.expect('to')
      let c2 = it.evalInt()
      it.expect(',')
      let rgb2 = it.evalInt()
      const s = rt.screen
      if (!s) amcafErr()
      if (c1 < 0 || c1 > 31 || c2 < 0 || c2 > 31) amcafErr()
      if (c2 <= c1) {
        ;[c1, c2] = [c2, c1]
        ;[rgb1, rgb2] = [rgb2, rgb1]
      }
      const span = c2 - c1
      if (span === 0) {
        if (c1 < s.palette.length) s.palette[c1] = rgb1 & 0xffff
        return
      }
      // `mulu.w d7,d1 / divu.w d6,d1 / lsr.w #$1 / addx.w` — the gun doubled,
      // scaled, then halved with the shifted-out bit added back
      const half = (gun: number, num: number): number => {
        const q = Math.floor((gun * 2 * num) / span)
        return (q >> 1) + (q & 1)
      }
      for (let i = 0; i <= span; i++) {
        const mix = (f: (v: number) => number): number =>
          Math.min(15, half(f(rgb1), span - i) + half(f(rgb2), i))
        if (c1 + i < s.palette.length) s.palette[c1 + i] = glue(mix(rV), mix(gV), mix(bV))
      }
    },

    /**
     * Convert Grey sourcescreen To targetscreen — "convert any screen into a
     * grey scale image ... The number of colours in the target screen will be
     * taken in account, but it makes no sense to open a HAM screen for that
     * purpose."
     *
     * The source palette decides each pixel's luminance; the target's own
     * palette becomes an even grey ramp and every pixel is remapped onto it.
     */
    'convert grey'(it) {
      const src = rt.screens.get(it.evalInt())
      it.expect('to')
      const dst = rt.screens.get(it.evalInt())
      if (!src || !dst) amcafErr()
      const levels = 1 << dst.rp.bitMap.depth
      for (let i = 0; i < levels && i < dst.palette.length; i++) {
        const v = Math.round((i * 15) / Math.max(1, levels - 1))
        dst.palette[i] = glue(v, v, v)
      }
      const sp = src.rp.bitMap.pixels
      const dp = dst.rp.bitMap.pixelsW()
      const w = Math.min(src.width, dst.width)
      const h = Math.min(src.height, dst.height)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const rgb = src.palette[sp[y * src.width + x]!] ?? 0
          // the usual luma weighting, in the 0..15 space the palette uses
          const lum = (rV(rgb) * 77 + gV(rgb) * 151 + bV(rgb) * 28) >> 8
          dp[y * dst.width + x] = Math.min(levels - 1, Math.round((lum * (levels - 1)) / 15))
        }
      }
      dst.rp.bitMap.invalidate()
    },

    /**
     * Ham Fade Out screen — "darkens the screen by one single step. After
     * calling it 16 times, the Ham screen is completely black."
     *
     * "Technically, it's not possible to fade in a ham screen without enormous
     * processor power, but for fading out, a modified Shade Bobs routine is"
     * enough — because darkening is monotone and needs no search.
     */
    'ham fade out'(it) {
      const s = rt.screens.get(it.evalInt())
      if (!s) amcafErr()
      for (let i = 0; i < s.palette.length; i++) {
        const c = s.palette[i]!
        s.palette[i] = glue(Math.max(0, rV(c) - 1), Math.max(0, gV(c) - 1), Math.max(0, bV(c) - 1))
      }
    },

    /**
     * Set Rain Colour rainbownr,newcolour — "you can change the colour index
     * of a rainbow ... This means that you can remove the irretating limit to
     * the first 16 colours and are now able to access all 32 colours."
     *
     * And the trick the manual is proud of: "A colour index of -63 enables you
     * to alter the hardware scrolling register, so you can create fancy water
     * and wobbel effects." That one is a copper poke at a register this port
     * models through the display list rather than by address, so the index is
     * stored and the scroll case is not reproduced.
     */
    'set rain colour'(it) {
      const n = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      const rb = rt.rainbows.get(n)
      if (!rb) amcafErr()
      rb.colour = c
    },

    /**
     * Rain Fade rainbownr,$RGB or rainbownr To targetrainbow.
     *
     * "Rain Fade works step by step only. Therefore you need a maximum of 16
     * calls to reach the new colour values" — one unit per channel per call,
     * which is the same ramp Ham Fade Out uses.
     */
    'rain fade'(it) {
      const n = it.evalInt()
      const rb = rt.rainbows.get(n)
      if (it.accept('to')) {
        const target = rt.rainbows.get(it.evalInt())
        if (!rb || !target) amcafErr()
        for (let i = 0; i < rb.table.length; i++) rb.table[i] = fadeStep(rb.table[i]!, target.table[i] ?? 0)
        return
      }
      it.expect(',')
      const rgb = it.evalInt() & 0xfff
      if (!rb) amcafErr()
      for (let i = 0; i < rb.table.length; i++) rb.table[i] = fadeStep(rb.table[i]!, rgb)
    },


    /**
     * Blitter Fill screen,bitplane[,x1,y1,x2,y2][ To ts,tp] — routine 74.
     *
     * "With Blitter Fill you can fill polygons. However ... It does only fill
     * the gap between two dots of a horizontal line. Therefore the limiting
     * lines may only be one pixel th[ick]. These lines can be either created
     * using Turbo Draw or Bcircle."
     *
     * That sentence is the specification of the chip's area-fill mode, and it
     * is what `fillRow` in the blitter back-end implements. ONE BITPLANE at a
     * time, which is why the plane is an argument.
     */
    'blitter fill'(it) {
      const src = planeOf(rt, it.evalInt(), (it.expect(','), it.evalInt()))
      let x1 = 0
      let y1 = 0
      let x2 = src.bm.width - 1
      let y2 = src.bm.height - 1
      if (it.accept(',')) {
        x1 = it.evalInt()
        it.expect(',')
        y1 = it.evalInt()
        it.expect(',')
        x2 = it.evalInt()
        it.expect(',')
        y2 = it.evalInt()
      }
      let dst = src
      if (it.accept('to')) {
        const ts = it.evalInt()
        it.expect(',')
        dst = planeOf(rt, ts, it.evalInt())
      }
      const bpr = src.bm.bytesPerRow
      const b1 = Math.max(0, x1 >> 3)
      const b2 = Math.min(bpr - 1, x2 >> 3)
      for (let y = Math.max(0, y1); y <= Math.min(src.bm.height - 1, y2); y++) {
        const row = src.planes.subarray(src.base + y * bpr + b1, src.base + y * bpr + b2 + 1)
        const work = row.slice()
        fillRow(work)
        dst.planes.set(work, dst.base + y * bpr + b1)
      }
      dst.bm.invalidate()
    },

    /**
     * Blitter Wait — "waits until the blitter has finished".
     *
     * Every blit here completes before the keyword returns, so there is never
     * anything to wait for. FAITHFUL rather than a stub: a program cannot
     * observe a difference afterwards.
     */
    'blitter wait'() {},

    /**
     * Turbo Plot x,y,c — routine 348 ($7a16), "Fast replacement for Plot".
     *
     * "Added clipping for Turbo Plot, Shade Pix and Turbo Point. Now they are
     * as secure as the normal Plot and Point commands" (V1.30 changelog) — and
     * the clipping is only what the changelog says: `bmi` on each coordinate
     * and `cmp.w $4e(a0)` / `cmp.w $4c(a0)` against the screen's own height and
     * width. An out-of-range point is a SILENT no-op, not an error.
     *
     * "Fast" means it bypasses the RastPort altogether. The loop is
     * `movea.l (a0)+,a1` down the plane pointers with `bset.b`/`bclr.b` chosen
     * by `btst.l d1,d0` on the colour, so it honours neither Gr Writing, nor
     * the plane mask, nor the Clip — which `rp.plot` all obey. `putPixel` is
     * that primitive: bounds only, no mode, no mask, no clip.
     *
     * NOTE: the row stride is `lsr.w #$3` of the screen WIDTH, so it truncates
     * where a real BitMap rounds up to a word. Every AMOS screen is a multiple
     * of sixteen wide, so the two agree on anything reachable.
     */
    'turbo plot'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      rt.screen?.rp.putPixel(x, y, c)
    },

    /**
     * Turbo Draw x1,y1 To x2,y2,c[,planes] — routines 346 ($7760) and 347.
     *
     * The five-argument form is thirty bytes that look the plane mask up and
     * fall into the six-argument one, so the two are the same routine. That
     * lookup is a SIX-BYTE table at $7778 — `01 03 07 0f 1f 3f` — indexed by
     * `depth - 1`, which is every plane of a screen up to six deep.
     *
     * DEFECT: the table stops at six. `move.b -$1(a0,d1.w),d0` with a depth of
     * 7 or 8 reads the two bytes after it, which are the first half of the
     * next routine's `movea.l $168(a5),a2` — $24 and $6d. So on an AGA screen
     * Turbo Draw's default plane mask is 36 or 109 rather than 127 or 255, and
     * the line comes out in the wrong colour. Reproduced.
     *
     * A plane mask of ZERO draws nothing at all: routine 347 opens `move.l
     * (a3)+,d6 / bne`, and the fall-through skips the five remaining arguments
     * and returns.
     */
    'turbo draw'(it) {
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      const s = rt.screen
      const depth = s ? s.rp.bitMap.depth : 1
      const planes = it.accept(',') ? it.evalInt() : (TURBO_DRAW_PLANES[depth - 1] ?? 0)
      if (planes === 0 || !s) return
      const was = s.rp.mask
      s.rp.mask = planes & 0xff
      try {
        s.rp.draw(x1, y1, x2, y2, c)
      } finally {
        s.rp.mask = was
      }
    },

    /**
     * Fcircle x,y,r — routine 350 ($7afa), TEN BYTES: `move.l (a3),-(a3)` to
     * duplicate the radius on the argument stack, then straight into Fellipse.
     * "A command which has been missed in AMOS for a long time."
     *
     * Neither takes a COLOUR. Routine 351 pops exactly four longs into d0-d3
     * and hands them to `jsr -$ba(a6)` on GfxBase — `AreaEllipse(rp, xc, yc,
     * a, b)` — followed by `AreaEnd` at -$108, so the fill uses the RastPort's
     * FgPen and AreaPtrn, which is AMOS's `Ink` and `Set Pattern`. The token
     * table agrees: `I0,0,0` for Fcircle and `I0,0,0,0` for Fellipse.
     *
     * An earlier pass read the last argument of each as a colour, which is one
     * argument too many for Fcircle and made Fellipse's `b` the colour.
     *
     * A failing AreaEllipse or AreaEnd is error 23, which is how a fill too
     * big for the TmpRas reports itself.
     */
    'fcircle'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const r = it.evalInt()
      const s = rt.screen
      if (!s) return
      s.rp.ellipse(x, y, r, r, s.rp.fgPen, true)
    },

    /** Fellipse x,y,a,b — the filled ellipse, from routine 351 */
    'fellipse'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      const s = rt.screen
      if (!s) return
      s.rp.ellipse(x, y, a, b, s.rp.fgPen, true)
    },

    /**
     * Bcircle x,y,r,plane — a circle outline into ONE bitplane.
     *
     * The odd argument is the point: the manual lists it beside Turbo Draw as
     * the way to draw the one-pixel boundary Blitter Fill then fills.
     */
    'bcircle'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const r = it.evalInt()
      it.expect(',')
      const plane = it.evalInt()
      const s = rt.screen
      if (!s) return
      const p = planeOf(rt, -1, plane)
      const steps = Math.max(16, r * 8)
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * 2 * Math.PI
        const px = x + Math.round(r * Math.cos(a))
        const py = y + Math.round(r * Math.sin(a))
        if (px < 0 || py < 0 || px >= p.bm.width || py >= p.bm.height) continue
        const off = p.base + py * p.bm.bytesPerRow + (px >> 3)
        p.planes[off] = p.planes[off]! | (0x80 >> (px & 7))
      }
      p.bm.invalidate()
    },

    /**
     * Set Ntsc / Set Pal — 60Hz and 50Hz.
     *
     * BEAMCON0 ($DFF1DC) is 0 for NTSC and $0020 for PAL, which is the same
     * register Personnal's pair of the same names writes. These are two of
     * the six ARMED contested names: both extensions do the same thing here,
     * but they are still different tokens at different slots on the machine,
     * so both register and `qualified` resolves them by slot.
     */
    'set ntsc'() {
      rt.beamcon0 = 0x0000
    },
    'set pal'() {
      rt.beamcon0 = 0x0020
    },


    /**
     * Raster Wait line[,x] — waits for the beam.
     *
     * DEVIATION: there is no beam to wait for between statements here; the
     * display is composited once a frame rather than raced. The keyword
     * yields the rest of the frame, which is the observable effect a program
     * synchronising to the raster is after, but a program timing two waits
     * against each other measures nothing.
     */
    'raster wait'(it) {
      it.evalInt()
      if (it.accept(',')) it.evalInt()
      // one frame is the smallest thing a program here can wait for
      it.block({ type: 'wait', until: it.tick + 1 })
    },

    /**
     * Set Sprite Priority n — "Changes the sprite priority in Dual playfield
     * mode", which is BPLCON2's PF1P2-PF2P2 fields.
     */
    'set sprite priority'(it) {
      rt.amcaf.spritePriority = it.evalInt() & 0x3f
    },

    /**
     * Amcaf Aga Notation On / Off — routines 80 ($307c) and 81 ($3088), each
     * twelve bytes, each a single `move.w #n,$2d2(a2)`.
     *
     * The manual says: *"After calling Amcaf Aga Notation On, all AMCAF
     * commands and functions take 24 bit values... The default setting is
     * 12 bit."*
     *
     * DEFECT: the two are the wrong way round. `On` writes **4** and `Off`
     * writes **8**, and the readers (`cmp.w #$4,d0`) take 4 as the 12-bit
     * path. The extension's own init routine writes 4 as well — the sequence
     * at $1eba is `Rbsr routine 24 / move.w #$4,$2d2(a2)` — which is the
     * manual's 12-bit default, so `Amcaf Aga Notation On` sets the mode it was
     * already in and does nothing, and `Off` is the only way to reach 24-bit.
     * Reproduced, because a program calling `On` and then passing $RRGGBB gets
     * AMCAF's answer, not the manual's.
     *
     * NOTE: "all AMCAF commands and functions" is wrong too. The flag is read
     * from exactly three places in the whole hunk — $3284, $32a4 and $32ca,
     * which are Red Val, Green Val and Blue Val. So the manual's careful
     * exception for Rgb To Rrggbb and Rrggbb To Rgb is redundant: nothing else
     * consults it either.
     */
    'amcaf aga notation on'() {
      rt.amcaf.notationBits = 4
    },
    'amcaf aga notation off'() {
      rt.amcaf.notationBits = 8
    },

    /**
     * Mask Copy screen1,x1,y1,x2,y2 To screen2,x3,y3,maskaddress.
     *
     * "just like Screen Copy. However, a mask bitplane can be given" — so a
     * set mask bit lets the source pixel through and a clear one leaves the
     * destination alone.
     *
     * NOTE: `maskaddress` is a raw pointer into a caller-built bitplane. When
     * it resolves to memory this port can read, the mask is honoured; when it
     * does not, the copy is unmasked, which is the same picture a program
     * gets from an all-ones mask.
     */
    'mask copy'(it) {
      const s1 = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect(',')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      it.expect('to')
      const s2 = it.evalInt()
      it.expect(',')
      const x3 = it.evalInt()
      it.expect(',')
      const y3 = it.evalInt()
      let maskAddr = 0
      if (it.accept(',')) maskAddr = it.evalInt()
      const src = rt.screens.get(s1)
      const dst = rt.screens.get(s2)
      if (!src || !dst) amcafErr()
      const mask = maskAddr === 0 ? null : rt.resolveAddr(maskAddr)
      const bpr = src.rp.bitMap.bytesPerRow
      for (let y = 0; y <= y2 - y1; y++) {
        for (let x = 0; x <= x2 - x1; x++) {
          if (mask) {
            const off = mask.off + y * bpr + ((x1 + x) >> 3)
            const bit = 0x80 >> ((x1 + x) & 7)
            if (off >= mask.data.length || !(mask.data[off]! & bit)) continue
          }
          const v = src.rp.point(x1 + x, y1 + y)
          if (v >= 0) dst.rp.putPixel(x3 + x, y3 + y, v)
        }
      }
      dst.rp.bitMap.invalidate()
    },

    /**
     * Bzoom s1,x1,y1,x2,y2 To s2,x3,y3,factor — an integer zoom.
     *
     * "the graphics are double, four times or eight times as wide and from 1
     * to 15 times as high", and the rounding is the blitter showing through:
     * "The coordinates x1 and x2 are rounded down to the next multiple of
     * eight, x3 is even rounded to the nearest multiple of 16."
     *
     * The factor packs both: the low nibble is the vertical multiple and the
     * high nibble selects the horizontal one.
     */
    'bzoom'(it) {
      const s1 = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt() & ~7
      it.expect(',')
      const y1 = it.evalInt()
      it.expect(',')
      const x2 = it.evalInt() & ~7
      it.expect(',')
      const y2 = it.evalInt()
      it.expect('to')
      const s2 = it.evalInt()
      it.expect(',')
      const x3 = it.evalInt() & ~15
      it.expect(',')
      const y3 = it.evalInt()
      it.expect(',')
      const factor = it.evalInt()
      const src = rt.screens.get(s1)
      const dst = rt.screens.get(s2)
      if (!src || !dst) amcafErr()
      const vy = Math.max(1, factor & 15)
      const hx = Math.max(1, (factor >> 4) & 15) || 1
      for (let y = 0; y <= y2 - y1; y++) {
        for (let x = 0; x <= x2 - x1; x++) {
          const v = src.rp.point(x1 + x, y1 + y)
          if (v < 0) continue
          for (let dy = 0; dy < vy; dy++) {
            for (let dx = 0; dx < hx; dx++) dst.rp.putPixel(x3 + x * hx + dx, y3 + y * vy + dy, v)
          }
        }
      }
      dst.rp.bitMap.invalidate()
    },

    /**
     * C2p Convert st,wx,wy To screen,ox,oy — chunky to planar.
     *
     * Undocumented beyond the changelog, which credits the routine: "New c2p
     * routine by Mikael Kalms. Up to 20%-80% faster". The conversion itself
     * is `planar.ts`'s `encode`, which this port has had since the display
     * work — a chunky buffer at `st`, `wx` by `wy`, into a screen's planes.
     */
    'c2p convert'(it) {
      const st = it.evalInt()
      it.expect(',')
      const wx = it.evalInt()
      it.expect(',')
      const wy = it.evalInt()
      it.expect('to')
      const scr = rt.screens.get(it.evalInt())
      let ox = 0
      let oy = 0
      if (it.accept(',')) {
        ox = it.evalInt()
        it.expect(',')
        oy = it.evalInt()
      }
      const src = rt.resolveAddr(st)
      if (!scr || !src) amcafErr()
      for (let y = 0; y < wy; y++) {
        for (let x = 0; x < wx; x++) {
          const at = src.off + y * wx + x
          if (at < src.data.length) scr.rp.putPixel(ox + x, oy + y, src.data[at]!)
        }
      }
      scr.rp.bitMap.invalidate()
    },


    /**
     * Shade Bob Planes n — "'amount' sets the number of bitplanes, that
     * should be drawn in and must be a value between 1 and 6", which is how
     * a program protects the graphics in the higher planes.
     */
    'shade bob planes'(it) {
      const n = it.evalInt()
      if (n < 1 || n > 6) amcafErr()
      rt.amcaf.shadePlanes = n
    },

    /**
     * Shade Bob Mask flag — "Either the mask or the first bitplane of the
     * object is used", and this is the switch.
     */
    'shade bob mask'(it) {
      rt.amcaf.shadeMask = it.evalInt() !== 0
    },

    /** Shade Bob Up / Down screen,x,y,image — the bob shape as a shade stamp */
    'shade bob up'(it) {
      shadeBob(rt, it, 1)
    },
    'shade bob down'(it) {
      shadeBob(rt, it, -1)
    },

    /**
     * Shade Pix x,y[,planes] — one pixel of the same idea.
     *
     * "increases the colour value at the given point ... If the highest
     * colour is reached, the colour is resetted to be cycled" — so it wraps
     * within the plane count rather than clamping, which is what separates
     * the Shade family from Pix Brighten and Pix Darken.
     */
    'shade pix'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const planes = it.accept(',') ? it.evalInt() : rt.amcaf.shadePlanes
      const s = rt.screen
      if (!s) return
      const v = s.rp.point(x, y)
      if (v < 0) return // clipped since V1.30, like Turbo Plot
      const mask = (1 << planes) - 1
      s.rp.putPixel(x, y, (v & ~mask) | ((v + 1) & mask))
    },

    /**
     * Pix Shift Up / Down and Pix Brighten / Darken —
     * `screen,c1,c2,x1,y1 To x2,y2[,bank]`.
     *
     * "you can increase the colour indexes in the rectangular area ... 'c1'
     * and 'c2' hold the border colours, which should be taken into account
     * for the colour cycling, other colours are not affected."
     *
     * The pair of pairs is the whole point: Shift wraps within c1..c2 and
     * Brighten/Darken stop at the ends. That is why the manual introduces
     * them as the slower, limitable alternative to Shade Bobs, which "cannot
     * limit the colours to a certain range but only the amount of bitplanes".
     */
    'pix shift up'(it) {
      pixShift(rt, it, 1, true)
    },
    'pix shift down'(it) {
      pixShift(rt, it, -1, true)
    },
    'pix brighten'(it) {
      pixShift(rt, it, 1, false)
    },
    'pix darken'(it) {
      pixShift(rt, it, -1, false)
    },

    /**
     * Make Pix Mask screen,x1,y1 To x2,y2,bank — "Grabs a specific part of
     * the screen and saves it into the bank ... can be used to create a mask
     * for the Pix Shift instruction. If you use such a mask, the size must be
     * exactly the same like the limits you specify with the Pix Shift
     * commands."
     */
    'make pix mask'(it) {
      const s = rt.screens.get(it.evalInt())
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      it.expect(',')
      const bank = it.evalInt()
      if (!s) amcafErr()
      const w = x2 - x1 + 1
      const h = y2 - y1 + 1
      if (w <= 0 || h <= 0) amcafErr()
      rt.reserveBank(bank, w * h, 'PixMask ')
      const d = rt.memBanks.get(bank)!.data
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = s.rp.point(x1 + x, y1 + y)
          d[y * w + x] = v > 0 ? 1 : 0
        }
      }
    },

    /**
     * Ptile Bank bank — and the manual's own view of the feature is worth
     * keeping: "Actually, you should not read this command description. The
     * Ptile commands seem to be only of very low use and are rather
     * uninteresting for you."
     */
    'ptile bank'(it) {
      rt.amcaf.ptileBank = it.evalInt()
    },

    /**
     * Paste Ptile x,y,t — "Places a Ptile block at the position x,y. These
     * coordinates must be given as block positions", so 1,4 is the second
     * block across and the fifth down rather than a pixel.
     */
    'paste ptile'(it) {
      const bx = it.evalInt()
      it.expect(',')
      const by = it.evalInt()
      it.expect(',')
      const t = it.evalInt()
      const bank = rt.memBanks.get(rt.amcaf.ptileBank)
      const s = rt.screen
      if (!bank || !s) amcafErr()
      const TILE = 16
      const src = t * TILE * TILE
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const v = bank.data[src + y * TILE + x]
          if (v !== undefined) s.rp.putPixel(bx * TILE + x, by * TILE + y, v)
        }
      }
      s.rp.bitMap.invalidate()
    },

    /**
     * Exchange Bob i1,i2 / Exchange Icon i1,i2 — "simply swaps the two images
     * ... i1 and i2 must exist as a valid image, otherwise an error will be
     * reported."
     */
    'exchange bob'(it) {
      exchangeImage(rt, it, true)
    },
    'exchange icon'(it) {
      exchangeImage(rt, it, false)
    },


    /* ---- Splinters ---- */

    /** Coords Bank bank[,coords] — 4 bytes a coordinate; no count re-selects */
    'coords bank'(it) {
      const n = it.evalInt()
      const sp = rt.amcaf.splinters
      sp.coordsBank = n
      if (it.accept(',')) {
        const count = it.evalInt()
        rt.reserveBank(n, count * 4, 'Coords  ')
        sp.coords = []
      }
      // "If this parameter is omitted the existing bank will only be switched
      // to without erasing it. So you can jump between predefined banks."
    },

    /**
     * Coords Read screen,colour,x1,y1 To x2,y2,bank,mode — "'colour'
     * represents the background colour, that will be left out when reading in
     * the dots ... all dots, which don't have the colour" are gathered.
     */
    'coords read'(it) {
      const scr = rt.screens.get(it.evalInt())
      it.expect(',')
      const bg = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      it.expect(',')
      const bank = it.evalInt()
      if (it.accept(',')) it.evalInt() // mode: the scan order, invisible here
      if (!scr) amcafErr()
      const out: Array<[number, number]> = []
      for (let y = y1; y <= y2; y++) {
        for (let x = x1; x <= x2; x++) {
          const v = scr.rp.point(x, y)
          if (v >= 0 && v !== bg) out.push([x, y])
        }
      }
      const sp = rt.amcaf.splinters
      sp.coordsBank = bank
      sp.coords = out
      const b = rt.memBanks.get(bank)
      if (b) {
        for (let i = 0; i < out.length && i * 4 + 3 < b.data.length; i++) {
          b.data[i * 4] = (out[i]![0] >> 8) & 0xff
          b.data[i * 4 + 1] = out[i]![0] & 0xff
          b.data[i * 4 + 2] = (out[i]![1] >> 8) & 0xff
          b.data[i * 4 + 3] = out[i]![1] & 0xff
        }
      }
    },

    /** Splinters Bank bank,splinum — "Each Splinter requires 22 bytes" */
    'splinters bank'(it) {
      const bank = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      rt.reserveBank(bank, n * 22, 'Splinter')
      const sp = rt.amcaf.splinters
      sp.bank = bank
      sp.max = n
      sp.p = []
    },

    /** Splinters Colour bkcolour,planes — what a lifted dot leaves behind */
    'splinters colour'(it) {
      const sp = rt.amcaf.splinters
      sp.bkColour = it.evalInt()
      it.expect(',')
      sp.planes = it.evalInt()
    },

    /** Splinters Gravity sx,sy — added to the speed each step */
    'splinters gravity'(it) {
      const sp = rt.amcaf.splinters
      sp.gx = it.evalInt()
      it.expect(',')
      sp.gy = it.evalInt()
    },

    /** Splinters Fuel time — steps before they vanish; 0 = only at the edges */
    'splinters fuel'(it) {
      rt.amcaf.splinters.fuel = it.evalInt()
    },

    /** Splinters Max amount — new splinters per step; 0 none, -1 unlimited */
    'splinters max'(it) {
      rt.amcaf.splinters.maxNew = it.evalInt()
    },

    /** Splinters Limit [x1,y1 To x2,y2] — the screen's own limits if omitted */
    'splinters limit'(it) {
      rt.amcaf.splinters.limit = readLimit(rt, it, 4)
    },

    /** Splinters Init — "fed with the coordinates and speeds you specified" */
    'splinters init'(it) {
      void it
      const sp = rt.amcaf.splinters
      const s = rt.screen
      sp.p = []
      sp.next = 0
      if (!s) return
      for (const [x, y] of sp.coords) {
        if (sp.max > 0 && sp.p.length >= sp.max) break
        const c = s.rp.point(x, y)
        sp.p.push({ x, y, vx: 0, vy: 0, c: c < 0 ? 0 : c, life: sp.fuel })
      }
    },

    /** Splinters Move — one step */
    'splinters move'(it) {
      void it
      moveSplinters(rt)
    },

    /** Splinters Draw — "Draws the Splinters onto the screen" */
    'splinters draw'(it) {
      void it
      drawSplinters(rt)
    },

    /**
     * Splinters Back — "Saves the background, on which [they] are to be
     * drawn in the next step".
     *
     * Keeps TWO generations, because Double Del wipes the PRE-last pixels
     * rather than the last ones — see the Del pair below.
     */
    'splinters back'(it) {
      void it
      backSplinters(rt)
    },

    /**
     * Splinters Single Do / Double Do — one call for the whole cycle.
     *
     * Routines 282 and 283 ($6c48, $6c60) spell the order out, and it is
     * FOUR steps, not two:
     *
     *     Rbsr 284 (single del) / Rbsr 285 (double del)
     *     Rbsr 286 (move)
     *     Rbsr 287 (back)          <- save the background at the NEW places
     *     Rbra 288 (draw)
     *
     * which is exactly what the manual tells a caller doing it by hand:
     * "Splinters Single Del or Splinters Double Del, then Splinters Move,
     * Splinters Back and Splinters Draw in this order".
     *
     * An earlier pass had Single Do as restore-move-draw and Double Do as
     * move-draw, on the reasoning that a double-buffered screen already has
     * the previous frame as its background. Both the routine and the manual
     * say otherwise: Double Do deletes too, just from the other generation.
     * Without the Back step the saved background never advanced, so the next
     * Del restored stale pixels.
     */
    'splinters single do'(it) {
      void it
      restoreSplinters(rt, false)
      moveSplinters(rt)
      backSplinters(rt)
      drawSplinters(rt)
    },
    'splinters double do'(it) {
      void it
      restoreSplinters(rt, true)
      moveSplinters(rt)
      backSplinters(rt)
      drawSplinters(rt)
    },

    /**
     * Splinters Single Del / Double Del — and they are NOT the same call.
     *
     * "As the clearing process must either wipe the pre-last pixels from the
     * screen (when using Double Buffering), or the last pixels (with Single
     * Buffered screens), you have to take the appropriate command for the
     * right screen type." A double-buffered target was last drawn TWO frames
     * ago, so it is the older generation that has to be put back.
     */
    'splinters single del'(it) {
      void it
      restoreSplinters(rt, false)
    },
    'splinters double del'(it) {
      void it
      restoreSplinters(rt, true)
    },

    /* ---- Td Stars ---- */

    /** Td Stars Bank bank,stars — "Each star consumes 12 bytes of memory" */
    'td stars bank'(it) {
      const bank = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      rt.reserveBank(bank, n * 12, 'TdStars ')
      const st = rt.amcaf.stars
      st.bank = bank
      st.max = n
      st.s = []
    },

    /** Td Stars Planes n — how many bitplanes the stars are drawn into */
    'td stars planes'(it) {
      rt.amcaf.stars.planes = it.evalInt()
    },

    /**
     * Td Stars Limit [x1,y1 To x2,y2] — and the manual's warning is the point:
     * "These coordinates must lie WITHIN the screen dimensions, otherwise the
     * stars could corrupt your memory." Here they cannot; the RastPort clips.
     */
    'td stars limit'(it) {
      const st = rt.amcaf.stars
      st.limit = readLimit(rt, it, 6)
      // DEFECT: both forms also overwrite the ORIGIN, and nothing documents
      // it — routine 291 stores a longword at $256, which is exactly where
      // `Td Stars Origin` puts its pair, so setting a limit silently
      // re-centres the starfield. Worse, the explicit form (292) computes
      // that centre as `add.w d1,d0 / lsr.w #1,d0` and `add.w d3,d2 / lsr.w
      // #1,d2` — which averages x1 with y1 and x2 with y2, MIXING THE AXES
      // rather than taking the middle of each. Identical in 1.50, so it was
      // never noticed. Reproduced: a program calling Td Stars Limit after
      // Td Stars Origin loses the origin it asked for, on the machine too.
      st.ox = Math.floor(st.limit.cx)
      st.oy = Math.floor(st.limit.cy)
    },

    /** Td Stars Origin x,y — "where stars start from, as soon as they have left" */
    'td stars origin'(it) {
      const st = rt.amcaf.stars
      st.ox = it.evalInt()
      it.expect(',')
      st.oy = it.evalInt()
    },

    /** Td Stars Gravity sx,sy — a drift added to the speed each step */
    'td stars gravity'(it) {
      const st = rt.amcaf.stars
      st.gx = it.evalInt()
      it.expect(',')
      st.gy = it.evalInt()
    },

    /** Td Stars Accelerate On/Off — "if the stars are to be accelerated" */
    'td stars accelerate on'() {
      rt.amcaf.stars.accelerate = true
    },
    'td stars accelerate off'() {
      rt.amcaf.stars.accelerate = false
    },

    /**
     * Td Stars Init — "the stars are moved by random values to avoid that
     * they all start in the origin. This command should therefore be called
     * once after all parameters have been set."
     */
    'td stars init'(it) {
      void it
      const st = rt.amcaf.stars
      st.s = []
      for (let i = 0; i < st.max; i++) {
        st.s.push({
          x: st.ox,
          y: st.oy,
          z: 1 + (i % 64),
          vx: ((i * 37) % 64) - 32,
          vy: ((i * 53) % 64) - 32,
        })
      }
    },

    /** Td Stars Move [star] — all of them, or one */
    'td stars move'(it) {
      if (!it.atStmtEnd()) {
        moveStar(rt, it.evalInt())
        return
      }
      for (let i = 0; i < rt.amcaf.stars.s.length; i++) moveStar(rt, i)
    },

    /** Td Stars Draw — every star onto the screen */
    'td stars draw'(it) {
      void it
      drawStars(rt, true)
    },
    'td stars single del'(it) {
      void it
      drawStars(rt, false)
    },
    'td stars double del'(it) {
      void it
      drawStars(rt, false)
    },
    'td stars single do'(it) {
      void it
      drawStars(rt, false)
      for (let i = 0; i < rt.amcaf.stars.s.length; i++) moveStar(rt, i)
      drawStars(rt, true)
    },
    'td stars double do'(it) {
      void it
      for (let i = 0; i < rt.amcaf.stars.s.length; i++) moveStar(rt, i)
      drawStars(rt, true)
    },


    /* ---- vector rotation ---- */

    /**
     * Vec Rot Angles ax,ay,az — the rotation about all three axes, in the
     * same 1024-to-the-turn units Qsin and Qcos use.
     */
    'vec rot angles'(it) {
      const v = rt.amcaf.vec
      v.ax = it.evalInt()
      it.expect(',')
      v.ay = it.evalInt()
      it.expect(',')
      v.az = it.evalInt()
    },

    /**
     * Vec Rot Pos x,y,z — the viewpoint. `z` is the distance the projection
     * divides by, which is what turns a rotated 3D point into a 2D one.
     */
    'vec rot pos'(it) {
      const v = rt.amcaf.vec
      v.px = it.evalInt()
      it.expect(',')
      v.py = it.evalInt()
      it.expect(',')
      v.pz = it.evalInt()
    },

    /**
     * Vec Rot Precalc — builds the rotation matrix once so the per-point
     * functions do not have to.
     *
     * Nothing here caches a matrix, so this is a no-op — FAITHFUL rather than
     * a stub, because the only thing a program can observe afterwards is that
     * the following Vec Rot X/Y/Z give the same answers either way.
     */
    'vec rot precalc'() {},

    /* ---- extension internals ---- */

    /**
     * Extremove / Extreinit / Extdefault extnb.
     *
     * "The Extremove command removes the extension in the slot from memory
     * like when exiting AMOS", and the manual is candid about what that
     * costs: "Otherwise, you can lose memory or even crash your computer."
     *
     * n/a here. An extension is a set of registered handlers rather than a
     * loaded library that can be unlinked, and the whole point of the trio is
     * to reclaim memory this port does not model as scarce. Reproducing them
     * would mean unregistering keywords mid-program to no observable end.
     */

    /**
     * Audio Lock / Audio Free — reserve the four channels from audio.device.
     *
     * "When you start AMOS, the audio.device will be not informed, that AMOS
     * wants to have the audio channels. Due to this flaw, other programs that
     * are running in the background can replay a sound at any time."
     *
     * There is no other program in the background here and no audio.device to
     * arbitrate with, so there is nothing to lock. FAITHFUL as a no-op: the
     * observable effect on the calling program is the same.
     */
    'audio lock'() {},
    'audio free'() {},

    /**
     * Flush Libs — asks exec to expunge unused libraries.
     *
     * The same idea as Jd Flush, and a no-op for the same reason: nothing a
     * program can see afterwards differs.
     */
    'flush libs'() {},

    /**
     * Open Workbench — "Tries to open the workbench again, if it has been
     * closed previously" with AMOS's Close Workbench, to get the memory back.
     *
     * There is no Workbench screen to reopen, and closing it here frees
     * nothing, so this has nothing to undo.
     */
    'open workbench'() {},


    /**
     * Smouse Speed value — "the factor by which power of 2 the mouse should
     * be slowed down. 0 is the maximum speed whereas 1 is about the speed of
     * the normal AMOS mouse. Higher values than 4 are not sensible."
     */
    'smouse speed'(it) {
      rt.amcaf.smouse.speed = it.evalInt()
    },

    /**
     * Limit Smouse [x1,y1 To x2,y2] — "Defines the region in which the mouse
     * can be moved ... If the parameters are omitted, the full size of the
     * current screen will be used as default."
     */
    'limit smouse'(it) {
      rt.amcaf.smouse.limit = readLimit(rt, it, 4)
    },


    /* ---- ProTracker ---- */

    /**
     * Pt Play bank[,songpos] — "starts a Protracker music module which has
     * be[en] situated in memory bank number 'bank'."
     */
    'pt play'(it) {
      const bank = it.evalInt()
      const pos = it.accept(',') ? it.evalInt() : 0
      const b = rt.memBanks.get(bank)
      if (!b) amcafErr()
      const pt = rt.amcaf.pt
      pt.bank = bank
      pt.playing = true
      pt.pos = pos
      pt.row = 0
      pt.tick = 0
      pt.signal = 0
    },

    /**
     * Pt Stop — and the changelog records the bug that made it worth
     * checking: "Fixed a bug in Pt Stop which cut off the channels, even if
     * no music had been playing." So a Stop with nothing playing must leave
     * the sample channels alone, which is what this does.
     */
    'pt stop'() {
      const pt = rt.amcaf.pt
      if (!pt.playing) return
      pt.playing = false
      for (let v = 0; v < 4; v++) {
        if (pt.voices & (1 << v)) rt.host.audio?.stop(v)
      }
    },

    /** Pt Continue — resume where Pt Stop left off */
    'pt continue'() {
      if (rt.amcaf.pt.bank !== 0) rt.amcaf.pt.playing = true
    },

    /**
     * Pt Bank bank — "if you want to play back instruments from a music
     * module but the music bank has not yet been specified with Pt Play".
     *
     * Routine 249 ($61f0) does two things beyond storing the number. It calls
     * `Rbsr 253` — Pt Stop — BEFORE reading its argument, so naming a bank
     * silences whatever was playing. And after resolving the bank's address
     * it checks where that address landed:
     *
     *     cmpa.l #$200000, a0
     *     Rbge   routine 372
     *
     * which is an error if the bank resolved at or above 2MB — outside chip
     * RAM, where Paula cannot fetch it.
     *
     * DEVIATION: that check is NOT reproduced. It compares a real address,
     * and this port models memory type as a flag on the bank rather than an
     * address space, so the nearest equivalent would reject every
     * `Reserve As Work` bank — including on the many machines where all
     * memory is chip and the original passes. Bank To Chip's note already
     * records the same limitation from the other side.
     */
    'pt bank'(it) {
      const n = it.evalInt()
      rt.amcaf.pt.playing = false
      rt.amcaf.pt.bank = n
    },
    /** Pt Sam Bank bank — the AMOS sample bank Pt Sam Play draws from */
    'pt sam bank'(it) {
      rt.amcaf.pt.samBank = it.evalInt()
    },

    /** Pt Volume n — the master volume, 0..64 as Paula counts it */
    'pt volume'(it) {
      rt.amcaf.pt.volume = clampVolume(it.evalInt())
    },

    /** Pt Voice mask — which of the four voices the music may use */
    'pt voice'(it) {
      rt.amcaf.pt.voices = it.evalInt() & 15
    },

    /**
     * Pt Cia Speed bpm — "the number of beats per minute or if you specify a
     * value of zero, the timing will be switched from CIA-Timing to Vertical
     * Blank Timing. Then the bpm rate is automatically set to exactly 125."
     */
    'pt cia speed'(it) {
      const bpm = it.evalInt()
      const pt = rt.amcaf.pt
      if (bpm === 0) {
        pt.cia = false
        pt.bpm = 125
        return
      }
      pt.cia = true
      pt.bpm = bpm
    },

    /**
     * Pt Sam Play [voice,]samnr[,freq] — a sample from an AMOS sample bank.
     *
     * "The advantage to the normal Sam Play instruction is that the sounds
     * 'interact'" with the music: the replayer knows which voices it is using
     * and a sample takes one that is free.
     */
    'pt sam play'(it) {
      const a = it.evalInt()
      let voice = -1
      let sam = a
      let freq = 0
      if (it.accept(',')) {
        voice = a
        sam = it.evalInt()
        if (it.accept(',')) freq = it.evalInt()
      }
      ptSamPlay(rt, voice, sam, freq)
    },

    /**
     * Pt Sam Stop chan — silence the channels in a MASK, not one voice.
     *
     * Routine 233 ($5ecc) is the same four-pass shape as Pt Sam Freq:
     *
     *     moveq #1,d1 / moveq #3,d7
     *     btst.b #0,d0 / beq
     *       st.b (a1)                 mark the channel free again
     *       move.w d1,$dff096         DMACON: clear this channel's DMA bit
     *       clr.w $8(a0)              and its AUDxVOL
     *     lsl.w #1,d1 / addq.l #1,a1 / lea $10(a0),a0 / lsr.w #1,d0
     *
     * so `Pt Sam Stop 3` silences channels 0 and 1. Taking the argument as an
     * index silenced channel 3 instead.
     */
    'pt sam stop'(it) {
      const mask = it.evalInt()
      for (let v = 0; v < 4; v++) if (mask & (1 << v)) rt.host.audio?.stop(v)
    },

    /** Pt Sam Volume voice[,vol] — set a voice's volume */
    'pt sam volume'(it) {
      const a = it.evalInt()
      if (it.accept(',')) {
        rt.host.audio?.setVolume(a & 3, clampVolume(it.evalInt()))
        return
      }
      for (let v = 0; v < 4; v++) rt.host.audio?.setVolume(v, clampVolume(a))
    },

    /**
     * Pt Sam Freq chan,freq — retune whatever is playing.
     *
     * Routine 232 ($5e70), and two things it does that the manual's "channel
     * chan" does not suggest:
     *
     *   - `chan` is a BITMASK, not an index. The routine loops four times,
     *     `btst.b #0,d0` then `lsr.w #1,d0`, stepping `lea $10(a0),a0` through
     *     the AUDxPER registers from $dff0a0 — so 3 retunes channels 0 and 1.
     *   - `freq` is CLAMPED to $190..$7530, 400..30000 Hz, before the period
     *     is derived as $369E99 / freq (the NTSC Paula clock again).
     *
     * A negative frequency becomes 0 first (`bpl` / `moveq #0,d1`) and is
     * then pulled up to 400 by the low clamp.
     */
    'pt sam freq'(it) {
      const mask = it.evalInt()
      it.expect(',')
      let freq = it.evalInt()
      if (freq < 0) freq = 0
      freq = Math.min(30000, Math.max(400, freq))
      for (let v = 0; v < 4; v++) if (mask & (1 << v)) rt.host.audio?.setFrequency(v, freq)
    },

    /** Pt Instr Play instr[,voice[,freq]] — one of the module's own samples */
    'pt instr play'(it) {
      const instr = it.evalInt()
      const voice = it.accept(',') ? it.evalInt() : -1
      const freq = it.accept(',') ? it.evalInt() : 0
      ptInstrPlay(rt, instr, voice, freq)
    },

    /**
     * Pt Raw Play voice,address,length,period — a raw sample straight at a
     * voice, bypassing every bank.
     */
    'pt raw play'(it) {
      const voice = it.evalInt() & 3
      it.expect(',')
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      it.expect(',')
      const period = it.evalInt()
      const m = rt.resolveAddr(addr)
      if (!m || len <= 0) return
      const pcm = new Int8Array(m.data.buffer, m.data.byteOffset + m.off, Math.min(len, m.data.length - m.off))
      rt.host.audio?.play(voice, pcm, periodToHz(period), rt.amcaf.pt.volume, -1)
    },


    /* ---- slice 13: the remainder ---- */

    /**
     * Smouse X n / Smouse Y n — place the second mouse.
     *
     * Routines 154 and 155 ($4650, $466a) SCALE what they are given by the
     * stored Smouse Speed before storing it:
     *
     *     move.l (a3)+, d0
     *     move.w $2ee(a2), d1      the speed
     *     asl.w  d1, d0            ...as a shift
     *     move.w d0, $2f4(a2)
     *
     * so the coordinate is kept in the same speed-multiplied units the
     * counter reads accumulate in, and `Smouse X 10` under `Smouse Speed 2`
     * puts the pointer at 40. Storing the raw value, as an earlier pass did,
     * puts it somewhere else entirely whenever the speed is not 1.
     */
    'smouse x'(it) {
      rt.amcaf.smouse.x = extW(it.evalInt() << (rt.amcaf.smouse.speed & 15))
    },
    'smouse y'(it) {
      rt.amcaf.smouse.y = extW(it.evalInt() << (rt.amcaf.smouse.speed & 15))
    },

    /**
     * Blitter Copy Limit screen | x1,y1 To x2,y2 — the rectangle Blitter Copy
     * will move, and it is not optional: *"Before you can call Blitter Copy,
     * you MUST set the limits of the operation using Blitter Copy Limit"*.
     *
     * "If you only specify the 'screen' parameter, the full screen dimensions
     * of the screen numbered 'screen' will be taken. Otherwise x1,y1
     * represents the upper left corner and x2,y2 the lower right ... This area
     * will be used for ALL screens."
     *
     * An earlier pass parsed both forms and threw the values away, on the
     * reasoning that a copy here is a bounded loop rather than a chip transfer
     * that can run away. That is true of the SAFETY and false of the
     * SEMANTICS: the rectangle is what Blitter Copy copies, so discarding it
     * left the keyword with nothing to work on.
     */
    'blitter copy limit'(it) {
      const first = it.evalInt()
      if (!it.accept(',')) {
        const s = rt.screens.get(first)
        if (!s) amcafErr()
        rt.amcaf.bltLimit = { x1: 0, y1: 0, x2: s.width - 1, y2: s.height - 1, cx: 0, cy: 0 }
        return
      }
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      rt.amcaf.bltLimit = { x1: first, y1, x2, y2, cx: 0, cy: 0 }
    },

    /**
     * Blitter Copy s1,p1[,s2,p2[,s3,p3]] To s4,p4[,minterm] — one BITPLANE
     * into another, optionally combining two or three through a minterm.
     *
     * Routine 62 ($28a0) is the short form: it pushes `#$f0` — D = A, a plain
     * copy — and falls into routine 63, which is the explicit-minterm one.
     * Routine 63 resolves each screen with `L_SaveBMHD` and then does the
     * check that matters:
     *
     *     move.w $50(a0), d4        the screen's DEPTH
     *     cmp.w  d4, d7
     *     Rbge   routine 372        plane >= depth is an error
     *     lsl.l  #2, d7
     *     move.l (a0, d7.w), $330(a2)   the plane pointer itself
     *
     * so a plane number outside the screen stops the program rather than
     * reading somewhere else.
     *
     * CONTESTED: Personnal has a `Blitter Copy` too, and means something
     * entirely different by it — an address form with BLTCON0 $09F0. Dispatch
     * is by name, so this is declared in `qualified` and binds to the slot the
     * program actually loaded. Before that declaration existed, every AMCAF
     * program calling Blitter Copy got Personnal's handler and its argument
     * shape.
     */
    'blitter copy'(it) {
      const src: Array<[number, number]> = []
      for (;;) {
        const s = it.evalInt()
        it.expect(',')
        src.push([s, it.evalInt()])
        if (!it.accept(',')) break
      }
      it.expect('to')
      const ds = it.evalInt()
      it.expect(',')
      const dp = it.evalInt()
      const minterm = it.accept(',') ? it.evalInt() : 0xf0
      bltCopyPlanes(rt, src, ds, dp, minterm)
    },

    /**
     * Blitter Clear screen,bitplane[,x1,y1 To x2,y2] — wipe ONE bitplane.
     *
     * "In comparison to the AMOS command Cls, Blitter Clear allows you to wipe
     * single bitplane instead of all." Routine 70 ($2d0a) is the short form
     * and it is written as the long one with the screen's own bounds pushed:
     * `move.w $4c(a0),d0` and `$4e(a0)` are its width and height.
     *
     * CONTESTED with Personnal's `Blitter Clear`, same as Blitter Copy.
     */
    'blitter clear'(it) {
      const sn = it.evalInt()
      it.expect(',')
      const plane = it.evalInt()
      const s = rt.screens.get(sn)
      if (!s) amcafErr()
      let r = { x1: 0, y1: 0, x2: s.width - 1, y2: s.height - 1 }
      if (it.accept(',')) {
        const x1 = it.evalInt()
        it.expect(',')
        const y1 = it.evalInt()
        it.expect('to')
        const x2 = it.evalInt()
        it.expect(',')
        const y2 = it.evalInt()
        r = { x1, y1, x2, y2 }
      }
      if (plane < 0 || plane >= s.rp.bitMap.depth) amcafErr()
      for (let y = Math.max(0, r.y1); y <= Math.min(s.height - 1, r.y2); y++) {
        for (let x = Math.max(0, r.x1); x <= Math.min(s.width - 1, r.x2); x++) {
          s.rp.bitMap.writePixel(x, y, s.rp.bitMap.pixelAt(x, y) & ~(1 << plane))
        }
      }
      s.rp.bitMap.invalidate()
    },

    /**
     * C2p Shift / C2p Fire st,wx,wy To st2,shift — the two undocumented
     * variants beside C2p Convert, named only in the changelog.
     *
     * Shift moves the chunky buffer by `shift` pixels as it converts; Fire
     * subtracts, which is the classic fire-effect decay. NOTE: neither has a
     * manual entry, and the changelog records one of them as unfinished
     * ("Trans C2p chkbuf NOT YET IMPLEMENTED"), so these follow the names and
     * the argument shapes rather than a specification. APPROXIMATED.
     */
    'c2p shift'(it) {
      c2pTransform(rt, it, false)
    },
    'c2p fire'(it) {
      c2pTransform(rt, it, true)
    },

    /**
     * Write Cli text$ — writes to the CLI the program was started from.
     *
     * Amos Cli is zero here, so there is no shell to write to; the text goes
     * to the AMOS console, which is where a program running without one would
     * see it anyway.
     */
    'write cli'(it) {
      it.write(it.evalStr())
    },

    /**
     * Ppunpack start To end — decrunch a PowerPacker block in place.
     *
     * The codec is `src/amiga/powerpacker.ts`, which this port has had since
     * the LDos work: PP20 is a real `powerpacker.library` format rather than
     * something AMCAF invented.
     */
    'ppunpack'(it) {
      const start = it.evalInt()
      it.expect('to')
      it.evalInt()
      const m = rt.resolveWrite(start)
      if (!m) amcafErr()
      try {
        pp20Decrunch(m.data.subarray(m.off))
      } catch {
        amcafErr()
      }
    },

    /**
     * Rnc Unpack address To address / =Rnp — the RNC ProPack pair, and both
     * are DEAD in every version this port carries.
     *
     * The author removed them, put them back, and removed them again:
     *
     *   V0.990 01-Jul-94  Removed some command to shrink the extension:
     *                     Rnc Unpack / =Rnp
     *   V1.00             Reimplemented some commands: Rnc Unpack and =Rnp.
     *   V1.31 03-Oct-95   Finally removed Rnc Unpack and =Rnp.
     *
     * The tokens had to stay — deleting one shifts every later token id and
     * breaks saved programs — so 1.40 and 1.50 still list them and neither
     * does anything. 1.50's routines are the whole story:
     *
     *     rnc unpack ($63c0, 6 bytes)   move.l (a3)+,d5 / move.l (a3)+,d0 / rts
     *     rnp        ($63c6, 2 bytes)   rts
     *
     * They pop their arguments and return. 1.40's are the same shape behind
     * the standard prologue, except its `rnp` has no `rts` at all and falls
     * into `Scanstr$`.
     *
     * So these are implemented AS THE STUBS THEY ARE. Wiring a real RNC
     * decompressor in — the obvious reading of the manual, which still
     * documents them — would be LESS faithful: a program calling Rnc Unpack
     * on the machine gets nothing back. A sweep of the whole corpus for the
     * RNC signature found no packed file either, so there is no second
     * consumer to serve.
     */
    'rnc unpack'(it) {
      it.evalInt()
      it.expect('to')
      it.evalInt()
    },

    /**
     * Ppfromdisk file$,bank — load a PowerPacked file, decrunching it.
     * Pptodisk is the other direction and is not implemented: this port has a
     * PP20 decoder but no encoder, which LDos's Ppsave already records.
     */
    'ppfromdisk'(it) {
      const file = it.evalStr()
      it.expect(',')
      const n = it.evalInt()
      const raw = rt.vfs?.readFile(file) ?? null
      if (raw === null) {
        rt.amcaf.ioError = 205
        amcafErr()
      }
      let data: Uint8Array = raw
      try {
        data = pp20Decrunch(raw)
      } catch {
        // not PowerPacked: the manual's own fallback is to take it as it is
      }
      rt.reserveBank(n, data.length, 'Amcaf   ')
      rt.memBanks.get(n)!.data.set(data)
    },

    /** Nop — routine 21 ($231a) is two bytes: `rts`. "has no effect et al" */
    nop() {},

    /**
     * Bank Permanent / Bank Temporary — routines 25 and 26.
     *
     * AMOS's bank flag bit 0 is the Data/Work distinction: a permanent bank
     * "will stay resident in your program until it is erased", a temporary
     * one goes at Default. The manual notes this "also has use on
     * MED-Modules ... and on Power and Imploder unpacked banks", which is
     * exactly the case of a bank built at run time that should outlive the
     * command that made it.
     */
    'bank permanent'(it) {
      const b = rt.memBanks.get(it.evalInt())
      if (!b) amcafErr()
      b.flags |= 1
    },
    'bank temporary'(it) {
      const b = rt.memBanks.get(it.evalInt())
      if (!b) amcafErr()
      b.flags &= ~1
    },

    /**
     * Bank To Chip / Bank To Fast — routines 27 and 28. The bank moves and
     * "will get a new starting address"; here the memory type is a flag on
     * the bank rather than a real pool, so the move is the flag.
     *
     * The manual's warning belongs to the machine and not to us: "Do not try
     * to replay musics or sounds that resist in fast ram."
     */
    'bank to chip'(it) {
      const b = rt.memBanks.get(it.evalInt())
      if (!b) amcafErr()
      b.memType = 1
    },
    'bank to fast'(it) {
      const b = rt.memBanks.get(it.evalInt())
      if (!b) amcafErr()
      b.memType = 0
    },

    /** Bank Name bank,name$ — routine 58. "the 8 characters long name" */
    'bank name'(it) {
      const n = it.evalInt()
      it.expect(',')
      const name = it.evalStr()
      const b = rt.memBanks.get(n)
      if (!b) amcafErr()
      // "Most AMOS commands ignore this ID, but e.g the AMOS Tracker commands
      // require a bank named 'Tracker '" -- which is why it pads to eight
      b.name = name.slice(0, 8).padEnd(8, ' ')
    },

    /**
     * Bank Stretch bank To length — routine 53. "Extents the bank ... to the
     * given new length", and "During this process, the starting address of
     * the bank is changed", which is a realloc.
     */
    'bank stretch'(it) {
      const n = it.evalInt()
      it.expect('to')
      const len = it.evalInt()
      const b = rt.memBanks.get(n)
      if (!b || len < 0) amcafErr()
      const next = new Uint8Array(len)
      next.set(b.data.subarray(0, Math.min(len, b.data.length)))
      b.data = next
    },

    /** Bank Copy source To target, or start,end To target — routine 57/56 */
    'bank copy'(it) {
      const first = it.evalInt()
      let src: Uint8Array
      if (it.accept(',')) {
        const end = it.evalInt()
        it.expect('to')
        src = bankRegion(rt, first, end)
      } else {
        it.expect('to')
        src = bankRegion(rt, first, null)
      }
      const target = it.evalInt()
      const dst = rt.memBanks.get(target)
      if (!dst) {
        rt.reserveBank(target, src.length, 'Amcaf   ')
        rt.memBanks.get(target)!.data.set(src)
        return
      }
      const next = new Uint8Array(src.length)
      next.set(src)
      dst.data = next
    },

    /**
     * Bank Delta Encode / Decode — routines 30/29 and 32/31.
     *
     * "Delta encoding just stores the difference from one byte to the next,
     * so it certain hull curve patterns in samples can be seen more 'clearly'
     * for packing algorithms." Not a packer itself: the length never changes.
     */
    'bank delta encode'(it) {
      const r = bankArgs(rt, it)
      let prev = 0
      for (let i = 0; i < r.length; i++) {
        const v = r[i]!
        r[i] = (v - prev) & 0xff
        prev = v
      }
    },
    'bank delta decode'(it) {
      const r = bankArgs(rt, it)
      let prev = 0
      for (let i = 0; i < r.length; i++) {
        prev = (prev + r[i]!) & 0xff
        r[i] = prev
      }
    },

    ...bankCodeOps(rt),

  }
}

/**
 * The extension's failure paths — three of them, and the numbers are now read
 * rather than assumed.
 *
 * Every range check ends in a branch to one of a small group of routines past
 * the keyword-named ones, which an earlier pass could only describe as "a call
 * out of the extension". They are inside it, and each is three instructions:
 *
 *   routine 390  Rbsr 354 / moveq #$17,d0 / Rjmp L_ScCopy   -- error 23
 *   routine 391  Rbsr 354 / moveq #$51,d0 / Rjmp L_ScCopy   -- error 81
 *   routine 392  Rbsr 354 / moveq #$5e,d0 / Rjmp L_ScCopy   -- error 94
 *
 * `L_ScCopy` is AMOS's own error raiser and d0 is the AMOS error NUMBER, so
 * the messages a program sees are AMOS's: 23 "Illegal function call", 81
 * "File format not recognised", 94 "Next without For in animation string".
 *
 * The last two read as nonsense here because they are — the extension ships no
 * message table (there is no printable error text anywhere in the hunk) and
 * borrows numbers whose AMOS text has nothing to do with what failed. That is
 * what a program's `Errn` sees, so it is what these raise.
 */
const amcafErr: () => never = () => {
  throw new AmosError('Illegal function call', 23)
}
/** routine 391 — the one every failed dos.library call raises */
const amcafDosErr: () => never = () => {
  throw new AmosError('File format not recognised', 81)
}
/** routine 392 — Examine failing, or Examine Dir handed something that is not one */
const amcafExamineErr: () => never = () => {
  throw new AmosError('Next without For in animation string', 94)
}
/** routine 389 — Reserve or AllocMem coming back empty */
const amcafMemErr: () => never = () => {
  throw new AmosError('Out of memory', 24)
}

/**
 * AMCAF's own messages, which an earlier pass reported did not exist.
 *
 * The header used to say "this extension ships no error strings at all",
 * having found no printable text where the failure branches led. It was
 * looking in the wrong place: the raisers above go to `L_ScCopy` with an AMOS
 * error NUMBER, but there is a second mechanism — routine 397 —
 *
 *     lea.l  $af94(pc), a0
 *     moveq  #$0, d1
 *     moveq  #$0, d3
 *     moveq  #$7, d2
 *     Rjmp   L_Dia_ScCopy
 *
 * which puts up a REQUESTER, and $af94 is the head of a NUL-separated list of
 * nineteen strings. The index is d0 from the caller and the list starts on the
 * terminator BEFORE the first string, so it is 1-based — proved by the OS-2.0
 * gate (routine 395, `moveq #$c,d0`) landing on "Kickstart 2.04 or greater
 * required", which is exactly what that gate is for.
 *
 * So the extension has two failure paths, not one: a trappable AMOS error and
 * a requester of its own. These are the requester's texts, in the binary's
 * order, with index 0 left as the empty string the table itself begins with.
 */
export const AMCAF_ERRORS = [
  '',
  "Can't reopen Workbench",
  'Not an RNC-packed file',
  "Couldn't allocate channels",
  'No icons- or spritesbanks allowed',
  'No powerpacker.library',
  'Crunching error',
  'File/bank is encrypted',
  'Not a PowerPacker/Imploder-Bank',
  'No diskfont.library',
  "Couldn't open font",
  "Couldn't launch process",
  'Kickstart 2.04 or greater required',
  'No icon.library',
  'Serious error during reinitialision',
  'At least 4 colours required in screen',
  'No CIA-Timer available',
  'Cannot open lowlevel.library',
  'At least 4 planes required!',
  'MC68020 or higher required!',
]

/** routine 397 — the requester, by the index the caller puts in d0 */
const amcafMsg: (n: number) => never = (n) => {
  throw new AmosError(AMCAF_ERRORS[n] ?? `AMCAF error ${n}`)
}

/**
 * Routine 363, the AMOS-string-to-C-string converter every path argument goes
 * through, and the reason a path here has a length limit at all.
 *
 * It is four instructions of check before it copies anything:
 *
 *   move.w  (a0)+, d0
 *   subq.w  #$1, d0
 *   cmp.w   #$80, d0
 *   Rbcc    routine 390
 *
 * `Rbcc` is UNSIGNED, so a length of zero underflows to $FFFF and fails the
 * same test a length of 129 fails. The legal range is 1..128 characters, and
 * an EMPTY path is an error 23 rather than a lookup that fails.
 */
function amcafPath(s: string): string {
  if (s.length < 1 || s.length > 128) amcafErr()
  return s
}

/**
 * The sine table, 1024 units to the turn, scaled by 256.
 *
 * `Qsin` (routine 260, $643a) reads a WORD from a table whose pointer sits at
 * `$696` in the extension's data block, multiplies by the radius and shifts
 * right by 8: `move.w (a0,d1.w),d3 / muls.w d0,d3 / asr.l #8,d3`. The shift
 * proves the scale is 256 and the `andi.w #$3ff` proves the length is 1024.
 *
 * The CONTENTS are the library's, not a reconstruction. An earlier pass could
 * not find the table and generated `round(256*sin)` instead, which disagreed
 * with the shipped one at 770 of its 1024 entries — by up to 3. The changelog
 * is what gave it away: *"Sine-Table moved and shortened, so I save about 1536
 * Bytes"*, and 2048 - 512 is exactly 1536, so what ships is a QUARTER table of
 * 256 words. It is at $a3a8 in 1.40 and $ab82 in 1.50, both byte-identical to
 *
 *     Q[i] = floor(256 * sin(pi * i / 512))
 *
 * at all 256 entries, which is why this derives the quarter rather than
 * embedding it. Note `floor`, not `round`.
 *
 * The init at $a2d8 expands it, and the expansion is the part no one would
 * guess:
 *
 *     move.w #$fe,d1 / move.w (a0)+,(a1)+     255 entries, full[0..254]
 *     move.w #$100,(a1)+                      full[255] = 256
 *     addq.l #2,a0 / move.w -(a0),(a1)+       256, full[256..511] = Q[255..0]
 *     move.w (a0)+,(a1) / neg.w (a1)+         255, full[512..766] = -Q[0..254]
 *     move.w #$ff00,(a1)+                     full[767] = -256
 *     addq.l #2,a0 / move.w -(a0),(a1)/neg.w  256, full[768..] = -Q[255..0]
 *
 * So the PEAK lands at index 255 and the trough at 767 — the table is not
 * symmetric about 256 — and the negative half is `-floor(x)` rather than
 * `floor(-x)`, which differ wherever x is not an integer.
 */
const SIN256 = ((): Int16Array => {
  const q = Array.from({ length: 256 }, (_, i) => Math.floor(256 * Math.sin((Math.PI * i) / 512)))
  const t = new Int16Array(1024)
  let n = 0
  for (let i = 0; i < 255; i++) t[n++] = q[i]!
  t[n++] = 256
  for (let j = 0; j < 256; j++) t[n++] = q[255 - j]!
  for (let i = 0; i < 255; i++) t[n++] = -q[i]!
  t[n++] = -256
  for (let j = 0; j < 256; j++) t[n++] = -q[255 - j]!
  return t
})()

/** sign-extend a word, which is what `ext.l d3` does to the result */
const extW = (v: number): number => (v << 16) >> 16

/**
 * `Qarc`'s arctangent table — 513 BYTES at $a5a8 in 1.40, pointer at $69a.
 *
 * Indexed by `(min(|dx|,|dy|) << 9) / max(...)`, so the domain is a ratio in
 * $000..$200 and the range is 0..128 — an eighth of the 1024-unit turn, which
 * is why the routine mirrors about 256 for the steep half. Byte-identical to
 * `floor(atan(i/512) * 1024 / 2pi)` at all 513 entries, `floor` again.
 *
 * The changelog dates it: *"Sine-Table moved and shortened ... added
 * Arctan-Table"*, the same entry that shortened the sine one.
 */
const QARC = Uint8Array.from({ length: 513 }, (_, i) => Math.floor((Math.atan(i / 512) * 1024) / (2 * Math.PI)))

/**
 * The shared tail of Qsin (routine 260, $643a) and Qcos (259, $6428).
 *
 * A radius of zero returns zero WITHOUT reading the angle — the routine tests
 * it first and steps `a3` past the second argument by hand. The `addx.w d2,d3`
 * after the shift adds the bit the `asr` pushed into X, so the result is
 * rounded on bit 7 rather than truncated, and the final `ext.l` narrows it to
 * a word: a radius large enough to overflow 16 bits wraps.
 *
 * Qcos is four instructions — `addi.w #$100,$6(a3)` then `Rbra` into Qsin —
 * so the quarter turn is applied to the ANGLE on the parameter stack, and
 * $6(a3) is the low word of the second longword because Qsin pops the radius
 * first.
 */
function qtrig(angle: number, radius: number, quarterTurn: number): number {
  if (radius === 0) return 0
  const e = SIN256[(angle + quarterTurn) & 0x3ff]!
  const p = Math.imul(e, extW(radius))
  return extW((p >> 8) + ((p >> 7) & 1))
}


/* ------------------------------------------------------------------ *
 * Slice 2: strings
 * ------------------------------------------------------------------ */

/**
 * Scancode to key name, for `Scanstr$`.
 *
 * NOTE: AMCAF's own spellings were not recovered. The extension ships no
 * string table at all — a search of the whole hunk for "Space", "Escape",
 * "Return" and friends finds nothing — so the names must come from AMOS or
 * the keymap, neither of which is modelled as text here. These are the Amiga
 * rawkey names for the codes the port already tracks, which answers the
 * question a program is asking ("what key is this?") without claiming to be
 * character-for-character what the library printed. Classified APPROXIMATED.
 */
const KEY_NAMES: Record<number, string> = {
  0x45: 'Esc', 0x40: 'Space', 0x44: 'Return', 0x41: 'Backspace', 0x42: 'Tab', 0x46: 'Del',
  0x4c: 'Up', 0x4d: 'Down', 0x4e: 'Right', 0x4f: 'Left',
  0x60: 'Shift', 0x61: 'Shift', 0x63: 'Ctrl', 0x64: 'Alt', 0x65: 'Alt',
  0x10: 'Q', 0x11: 'W', 0x12: 'E', 0x13: 'R', 0x14: 'T', 0x15: 'Y', 0x16: 'U', 0x17: 'I', 0x18: 'O', 0x19: 'P',
  0x20: 'A', 0x21: 'S', 0x22: 'D', 0x23: 'F', 0x24: 'G', 0x25: 'H', 0x26: 'J', 0x27: 'K', 0x28: 'L',
  0x31: 'Z', 0x32: 'X', 0x33: 'C', 0x34: 'V', 0x35: 'B', 0x36: 'N', 0x37: 'M',
  0x01: '1', 0x02: '2', 0x03: '3', 0x04: '4', 0x05: '5',
  0x06: '6', 0x07: '7', 0x08: '8', 0x09: '9', 0x0a: '0',
  0x50: 'F1', 0x51: 'F2', 0x52: 'F3', 0x53: 'F4', 0x54: 'F5',
  0x55: 'F6', 0x56: 'F7', 0x57: 'F8', 0x58: 'F9', 0x59: 'F10',
}

/** the shared body of Lsstr$ and Lzstr$ (routines 178 and 177, $488e) */
function padNum(v: number, n: number, pad: string): string {
  // `Rbeq` on zero and `cmp.w #$a / Rbhi` bound n to 1..10
  if (n < 1 || n > 10) amcafErr()
  // "The sign of the number will not be printed"
  const digits = String(Math.abs(v))
  // the routine walks exactly n positions of a power-of-ten table, so digits
  // past the field are never emitted rather than overflowing it
  return digits.length > n ? digits.slice(digits.length - n) : digits.padStart(n, pad)
}

/* ------------------------------------------------------------------ *
 * Slice 3: date and time
 * ------------------------------------------------------------------ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
/** Cd Weekday is 1 = Monday .. 7 = Sunday, and day 0 (1 Jan 1978) is a Sunday */
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * The two tables Cd Date$ builds its string from, laid out the way routine 328
 * ($74bc in 1.40) indexes them — and they OVERLAP.
 *
 * `lea $7556(pc,d6.w)` reads the month with d6 = month*4, so month 1 lands at
 * $755a and month 0 would land on $7556 — which is the SEVENTH weekday entry,
 * "Sun ". One four-byte slot serves as both the last weekday and the unused
 * month zero, which is why the month table starts with a hyphen and the
 * weekday one with a trailing space: they are one run of bytes read two ways.
 */
const CD_WEEK4 = ['Mon ', 'Tue ', 'Wed ', 'Thu ', 'Fri ', 'Sat ', 'Sun ']
const CD_MON4 = ['Sun ', '-Jan', '-Feb', '-Mar', '-Apr', '-May', '-Jun', '-Jul', '-Aug', '-Sep', '-Oct', '-Nov', '-Dec']

/**
 * The month-length table at $814a, dumped rather than assumed.
 *
 *   63 1c 1f 1e 1f 1e 1f 1f 1e 1f 1e 1f
 *
 * Index 0 is $63, a byte of the `rts` padding that is never read — the loop
 * increments its index BEFORE the first load, having already subtracted
 * January's 31 from a `moveq`. So entry 1 is February and entry 11 December.
 */
const AMCAF_MONTH_LEN = [0x63, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * Cd Year — routine 322 ($7104) in 1.50, 308 ($7398) in 1.40.
 *
 * A subtract-a-year-at-a-time loop from 1978 rather than a calendar formula,
 * and it leaves the REMAINING days behind for the month splitter, which is why
 * Cd Month is `Rbsr` into this and Cd Day is `Rbsr` into Cd Month.
 *
 * DEFECT: the leap test is `move.b d3,d4 / andi.b #$3,d4` — a bare `year & 3`,
 * with no hundred-or-four-hundred correction. 2100 is not a leap year and
 * AMCAF says it is, so from 1 March 2100 (day 44984) every date it reports is
 * one day out. Reproduced: a program that prints a date gets AMCAF's calendar.
 *
 * The year is a WORD (`move.w #$7ba,d3` then `addq.w #1,d3`), so it wraps at
 * 65536, and a negative day count exits before the first iteration and reports
 * 1978 with the negative remainder intact.
 */
function amcafYear(days: number): { year: number; rest: number } {
  let year = 0x7ba // 1978
  let rest = days | 0
  let len = 365
  while (rest >= len) {
    year = (year + 1) & 0xffff
    rest -= len
    len = (year & 3) === 0 ? 366 : 365
  }
  return { year, rest }
}

/**
 * The month splitter — routine 338 ($811e), which no token names: Cd Month
 * ends `Rbra` into it and Cd Day reaches it through Cd Month.
 *
 * Takes the year (for the leap flag) and the remaining days from `amcafYear`,
 * and returns the 1-based month with the days left over. February's extra day
 * is added to the table entry in place (`addq.b #$1,d1`) only when the index
 * is 1 and `year & 3` is zero, so it inherits `amcafYear`'s 2100 defect.
 */
function amcafMonth(year: number, restIn: number): { month: number; rest: number } {
  let rest = restIn
  let idx = 0
  let len = 31 // January, from the `moveq #$1f,d1` before the loop
  while (rest >= len) {
    idx++
    rest -= len
    len = AMCAF_MONTH_LEN[idx] ?? 0
    if ((year & 3) === 0 && idx === 1) len++
  }
  return { month: (idx + 1) & 0xff, rest }
}

/**
 * The two-digit printer shared by Cd Date$ ($7514) and Ct Time$ ($7638) —
 * byte for byte the same routine, assembled twice.
 *
 * It is not a formatter: it starts each digit at `'0'` and counts up, tens by
 * repeated subtraction of ten and units by repeated subtraction of one, with
 * every add and subtract BYTE-wide. There is no upper bound, so a value of 100
 * or more walks the tens character past `'9'` into punctuation rather than
 * growing the string, and the caller's length word stays 8 or 13 regardless.
 *
 * DEFECT: the tens test is `cmp.b #$a,d0` followed by `blt` — a SIGNED byte
 * compare. A byte of $80..$FF reads as negative, skips the tens loop entirely,
 * and then the units loop counts it down to zero one character at a time, so
 * `Ct Time$` of a time whose seconds byte is 200 emits `'0'` plus 200.
 */
function amcafTwoDigits(n: number): string {
  let v = n & 0xff
  let tens = 0x30
  let units = 0x30
  const signed = (b: number): number => (b << 24) >> 24
  while (signed(v) >= 10) {
    tens = (tens + 1) & 0xff
    v = (v - 10) & 0xff
  }
  while (v !== 0) {
    units = (units + 1) & 0xff
    v = (v - 1) & 0xff
  }
  return String.fromCharCode(tens, units)
}

/**
 * Cd Weekday — routine 311 ($73ec): `(days + 6) divu 7`, remainder plus one.
 *
 * Day 0 is 1 January 1978, a Sunday, so the +6 rotates the count onto a
 * Monday-first week and the answer is 7 rather than 1.
 *
 * DEFECT: `divu.w` is a 32-by-16 divide, and the 68000 leaves its operand
 * UNTOUCHED and sets V when the quotient will not fit a word. Past day 458745
 * — 3 April 3234 — the quotient overflows, and the code takes no notice: it
 * clears the low word, swaps, and increments a byte, so the answer becomes the
 * top half of the day count instead of a weekday. The same path catches any
 * day below -6, where the value read as unsigned is enormous.
 */
function amcafWeekday(days: number): number {
  const v = (days + 6) >>> 0
  if (Math.floor(v / 7) > 0xffff) {
    const hi = v >>> 16
    return (hi & 0xff00) | ((hi + 1) & 0xff)
  }
  return (v % 7) + 1
}

/**
 * AMCAF's packed time, which the manual spells out rather than leaving to be
 * guessed: *"the time is created out of Wordswap(minutes)+ticks"*.
 *
 * So the minutes since midnight sit in the HIGH word and the ticks — fiftieths
 * of a second within the minute, 0..2999 — in the low one. It says why, too:
 * *"This is NOT a value in the standard DOS-format as this one would require
 * two longwords."*
 */
const packTime = (mins: number, ticks: number): number => (((mins & 0xffff) << 16) | (ticks & 0xffff)) | 0
const timeMins = (t: number): number => (t >>> 16) & 0xffff
const timeTicks = (t: number): number => t & 0xffff

/* ------------------------------------------------------------------ *
 * Slice 4: banks
 * ------------------------------------------------------------------ */

/**
 * The two forms every bank command has: a bank number, or an explicit
 * `startaddress To endaddress` pair.
 *
 * The workers do not care which — they are handed a pointer and a length and
 * derive the count with `sub.l a0,d7`, so one region helper serves both. The
 * end address is EXCLUSIVE in that arithmetic.
 */
function bankRegion(rt: Runtime, a: number, b: number | null): Uint8Array {
  if (b === null) {
    const bank = rt.memBanks.get(a)
    if (!bank) amcafErr()
    return bank.data
  }
  const len = b - a
  if (len <= 0) amcafErr()
  const head = rt.resolveWrite(a)
  if (!head) amcafErr()
  const avail = head.data.length - head.off
  return head.data.subarray(head.off, head.off + Math.min(len, avail))
}

/** the `bank` / `start To end` argument pair every Bank Code command takes */
function bankArgs(rt: Runtime, it: Interp): Uint8Array {
  const first = it.evalInt()
  if (it.accept('to')) return bankRegion(rt, first, it.evalInt())
  return bankRegion(rt, first, null)
}

/**
 * The ten `Bank Code` encoders — five algorithms over bytes and words.
 *
 * Xor, Add, Rol and Ror are what their names say and the manual describes;
 * MIX is the one that needed the binary, and it is a small stream cipher
 * rather than a per-element operation (routines 37 and 47):
 *
 *     d1 = code XOR $AA          ; $FACE in the word version
 *     loop: d0 = d0 + d1         ; the key evolves every element
 *           (a0)+ = (a0) XOR d0
 *
 * So the key walks, which is why "So coded banks should be hard to decode"
 * and why decoding is the same command with the same code rather than the
 * negative one. The word form's constant is $FACE and NOT $AAAA, which is
 * the sort of thing only the binary tells you.
 *
 * Rol and Ror take a rotate count, so the manual bounds `code` to 1..7 on
 * `.b` and 1..15 on `.w`, and "To decode a bank either use the negative code
 * with the same instruction or the same key code along with the ... Ror
 * command" -- a negative count rotates the other way.
 */
function bankCodeOps(rt: Runtime): Record<string, Instr> {
  const out: Record<string, Instr> = {}
  const each = (r: Uint8Array, wide: boolean, f: (v: number, i: number) => number): void => {
    if (!wide) {
      for (let i = 0; i < r.length; i++) r[i] = f(r[i]!, i) & 0xff
      return
    }
    for (let i = 0; i + 1 < r.length; i += 2) {
      const v = f((r[i]! << 8) | r[i + 1]!, i >> 1) & 0xffff
      r[i] = (v >> 8) & 0xff
      r[i + 1] = v & 0xff
    }
  }
  const rot = (v: number, n: number, bits: number): number => {
    const mask = (1 << bits) - 1
    const k = ((n % bits) + bits) % bits
    return ((v << k) | (v >>> (bits - k))) & mask
  }
  for (const wide of [false, true]) {
    const sfx = wide ? '.w' : '.b'
    const bits = wide ? 16 : 8
    const mixConst = wide ? 0xface : 0xaa
    out[`bank code xor${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      each(bankArgs(rt, it), wide, (v) => v ^ code)
    }
    out[`bank code add${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      each(bankArgs(rt, it), wide, (v) => v + code)
    }
    out[`bank code mix${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      const step = (code ^ mixConst) & ((1 << bits) - 1)
      let k = code & ((1 << bits) - 1)
      each(bankArgs(rt, it), wide, (v) => {
        k = (k + step) & ((1 << bits) - 1)
        return v ^ k
      })
    }
    out[`bank code rol${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      each(bankArgs(rt, it), wide, (v) => rot(v, code, bits))
    }
    out[`bank code ror${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      each(bankArgs(rt, it), wide, (v) => rot(v, -code, bits))
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Slice 5: disk and DOS objects
 * ------------------------------------------------------------------ */

/**
 * Which object an `Object *` accessor answers for.
 *
 * Every one has two forms — with a path and without — and the no-argument
 * form reads whatever the Examine context currently describes. That is the
 * whole point of the family: walk a directory with Examine Next$ and read
 * each entry's details without naming it again.
 */
function objPath(rt: Runtime, a: Value[]): string {
  if (a.length > 0) return str(a[0]!)
  return rt.amcaf.examine.current
}

function objSize(rt: Runtime, path: string): number {
  if (!rt.vfs || rt.vfs.exists(path) !== 'file') return 0
  return rt.vfs.readFile(path)?.length ?? 0
}

/** Wload / Dload: the whole file into a bank, Work or Data */
/**
 * Wload / Dload — routines 104 ($384a) and 103 ($37f0), which differ in two
 * constants and nothing else.
 *
 * Open the file (a failure is error 81), take its length, and hand AMOS's own
 * `Reserve` a bank name and a type: `moveq #$0,d1` with **"Work    "** for
 * Wload and `moveq #$1,d1` with **"Datas   "** for Dload, both eight
 * characters. Both names are in the binary as literals, so the port's invented
 * "Amcaf   " was never on a real bank.
 *
 * Then the sign check the manual does document and an earlier pass missed:
 *
 *   move.l  d5, d0        ; the bank NUMBER
 *   bpl.b   ...
 *   neg.w   d0            ; (Dload spells it `not.l d0 / addq.w #$1,d0`)
 *   addq.w  #$2, d1       ; +2 on the Reserve type -- the CHIP flag
 *
 * "If 'bank' is a negative number, the file is loaded into Chip ram instead."
 *
 * A Reserve that comes back empty closes the file and raises error 24, and a
 * Read that fails part way is error 94.
 */
function loadToBank(rt: Runtime, it: Interp, dataBank: boolean): void {
  const file = it.evalStr()
  it.expect(',')
  const arg = it.evalInt()
  const chip = arg < 0
  const n = chip ? -arg : arg
  const bytes = rt.vfs?.readFile(amcafPath(file)) ?? null
  if (bytes === null) {
    rt.amcaf.ioError = 205
    amcafDosErr()
  }
  if (bytes.length === 0) amcafMemErr() // Reserve of nothing comes back empty
  rt.reserveBank(n, bytes.length, dataBank ? 'Datas   ' : 'Work    ', dataBank, chip)
  rt.memBanks.get(n)!.data.set(bytes)
  rt.amcaf.ioError = 0
}

/**
 * Wsave / Dsave — routine 105 ($38a2). "Dsave is exactly the same as Wsave in
 * every aspect", and the token table agrees: both names share the routine.
 *
 * It checks the bank before it opens anything:
 *
 *   move.w  -$c(a0), d0
 *   andi.w  #$c, d0
 *   bne     ...           ; moveq #$4,d0 / Rbra routine 397
 *
 * so a bank whose header carries either of those two type bits is refused with
 * AMCAF's own requester rather than an AMOS error — message 4, **"No icons- or
 * spritesbanks allowed"**, which names exactly what those bits mark.
 *
 * The length written is `move.l -$14(a0),d0` less SIXTEEN (`subq.l #$8` twice)
 * — the bank's own header, which is not part of what a program put there. An
 * output file it cannot open, and a Write that fails, are both error 94.
 */
function saveBank(rt: Runtime, it: Interp): void {
  const file = it.evalStr()
  it.expect(',')
  const b = rt.memBanks.get(it.evalInt())
  if (!b) amcafErr()
  if (b.kind !== 'memory') amcafMsg(4)
  rt.vfs?.writeFile(amcafPath(file), b.data)
  rt.amcaf.ioError = 0
}

/**
 * `Io Error$` texts.
 *
 * These are dos.library's, not the extension's — AMCAF ships no strings at
 * all, and the manual says the function "Returns a dos errorstring". Only the
 * codes a modelled filesystem can actually produce are listed; anything else
 * gets the empty string the manual describes for an unknown number ("If no
 * error number exists, an empty string will be returned").
 */
const DOS_ERRORS: Record<number, string> = {
  103: 'insufficient free store',
  105: 'task table full',
  120: 'argument line invalid or too long',
  121: 'file is not an object module',
  202: 'object in use',
  203: 'object already exists',
  204: 'directory not found',
  205: 'object not found',
  206: 'invalid window',
  210: 'invalid stream component name',
  212: 'object not of required type',
  213: 'disk not validated',
  214: 'disk write protected',
  216: 'directory not empty',
  218: 'device not mounted',
  221: 'disk full',
  222: 'file is protected from deletion',
  223: 'file is write protected',
  224: 'file is read protected',
  225: 'not a valid DOS disk',
  226: 'no disk in drive',
}
const dosErrorText = (n: number): string => DOS_ERRORS[n] ?? ''

/**
 * The tool types of an icon, one per line.
 *
 * NOTE: `.info` files are Workbench icons and this port does not decode them.
 * A program asking for tool types it did not write gets an empty string,
 * which is the same answer the manual gives for a file with no icon.
 */
function toolTypes(rt: Runtime, name: string): string {
  // the icon has to exist for there to be anything to say; its contents are
  // a Workbench DiskObject this port does not decode
  return rt.vfs?.readFile(`${name}.info`) === null ? '' : ''
}

/* ------------------------------------------------------------------ *
 * Slice 6: colour and palette
 * ------------------------------------------------------------------ */

const rV = (rgb: number): number => (rgb >> 8) & 15
const gV = (rgb: number): number => (rgb >> 4) & 15
const bV = (rgb: number): number => rgb & 15
const glue = (r: number, g: number, b: number): number => ((r & 15) << 8) | ((g & 15) << 4) | (b & 15)

/**
 * Turbo Draw's default plane mask, six bytes at $7778 — `01 03 07 0f 1f 3f`.
 *
 * `move.b -$1(a0,d1.w),d0` indexes it by `depth - 1`, so it is every plane of
 * a screen up to six deep. It STOPS at six: a depth of 7 or 8 reads the two
 * bytes that follow, which are the opening `movea.l $168(a5),a2` of the next
 * routine — $24 and $6d. Those are kept here because that is what an AGA
 * screen gets.
 */
const TURBO_DRAW_PLANES = [0x01, 0x03, 0x07, 0x0f, 0x1f, 0x3f, 0x24, 0x6d]

/**
 * Best Pen's colour distance, sixteen bytes at $3170 read straight out of the
 * hunk: `00 01 03 05 08 0c 10 14 1e 28 32 3c 46 50 5a 64`.
 *
 * Indexed by the absolute difference of ONE gun and summed over three, so it
 * is a hand-drawn curve rather than any standard metric — flat at the bottom
 * (a difference of 1 costs 1 where a square would cost 1 and a difference of 2
 * costs 3 where a square would cost 4) and steep above 7, where it jumps from
 * 20 to 30 and then climbs by tens. The effect is that it forgives being a
 * little wrong in every gun and punishes being badly wrong in one.
 */
const BEST_PEN_WEIGHT = [0, 1, 3, 5, 8, 12, 16, 20, 30, 40, 50, 60, 70, 80, 90, 100]

/**
 * HAM6's control byte, which is what `Ham Colour` decodes.
 *
 * Bits 4-5 choose: 00 take the palette entry whole, 01 replace BLUE, 10
 * replace RED, 11 replace GREEN, with the low four bits as the new component.
 * That is why the manual says a HAM pixel's colour depends on "the colour of
 * the pixel exactly before the current dot".
 */
function hamApply(c: number, oldRgb: number, palette: Uint16Array): number {
  const v = c & 15
  switch ((c >> 4) & 3) {
    case 1:
      return glue(rV(oldRgb), gV(oldRgb), v)
    case 2:
      return glue(v, gV(oldRgb), bV(oldRgb))
    case 3:
      return glue(rV(oldRgb), v, bV(oldRgb))
    default:
      return palette[v] ?? 0
  }
}

/**
 * The inverse: which control byte gets closest to `want` from `prev`.
 *
 * "As you cannot achieve the desired colour by plotting only one pixel in
 * [HAM]" — so the routine picks the best of the 64, and a caller walking a
 * scanline feeds each answer back in as the next `oldrgb`.
 */
function hamBest(want: number, prev: number, palette: Uint16Array): number {
  let best = 0
  let bestD = Infinity
  for (let c = 0; c < 64; c++) {
    const got = hamApply(c, prev, palette)
    const d =
      (rV(got) - rV(want)) ** 2 + (gV(got) - gV(want)) ** 2 + (bV(got) - bV(want)) ** 2
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

/** one fade step toward a target, which is what "step by step only" means */
const fadeStep = (from: number, to: number): number => {
  const step = (a: number, b: number): number => (a < b ? a + 1 : a > b ? a - 1 : a)
  return glue(step(rV(from), rV(to)), step(gV(from), gV(to)), step(bV(from), bV(to)))
}

/* ------------------------------------------------------------------ *
 * Slice 7: graphics
 * ------------------------------------------------------------------ */

/**
 * One bitplane of a screen, as the blitter keywords address it.
 *
 * Several of these take a screen AND a plane number, because they work a
 * plane at a time — Blitter Fill fills one, Bcircle draws the boundary into
 * one. A screen number below zero means the current screen.
 */
function planeOf(rt: Runtime, screen: number, plane: number): { bm: BitMap; planes: Uint8Array; base: number } {
  const s = screen < 0 ? rt.screen : rt.screens.get(screen)
  if (!s) amcafErr()
  const bm = s.rp.bitMap
  if (plane < 0 || plane >= bm.depth) amcafErr()
  return { bm, planes: bm.planeBytes(true), base: plane * bm.planeSize }
}

/* ------------------------------------------------------------------ *
 * Slice 8: the effect engines
 * ------------------------------------------------------------------ */

/**
 * The shared body of Shade Bob Up and Down.
 *
 * A shade bob is not a bob: it takes an image's SHAPE and uses it to bump the
 * colour index of whatever it lands on, cycling within the plane count. The
 * manual is explicit that it "supports the hot spot of the bob image" and
 * that "Shade Bobs may leave the screen boundaries".
 */
function shadeBob(rt: Runtime, it: Interp, dir: number): void {
  const s = rt.screens.get(it.evalInt())
  it.expect(',')
  const x = it.evalInt()
  it.expect(',')
  const y = it.evalInt()
  it.expect(',')
  const img = rt.spriteBank?.image(it.evalInt())
  if (!s || !img) amcafErr()
  const mask = (1 << rt.amcaf.shadePlanes) - 1
  const px = img.pixels
  for (let iy = 0; iy < img.height; iy++) {
    for (let ix = 0; ix < img.width; ix++) {
      // the mask, or the first bitplane, decides where the bob touches
      const on = rt.amcaf.shadeMask ? px[iy * img.width + ix]! !== 0 : (px[iy * img.width + ix]! & 1) !== 0
      if (!on) continue
      const sx = x + ix - img.hotX
      const sy = y + iy - img.hotY
      const v = s.rp.point(sx, sy)
      if (v < 0) continue
      s.rp.putPixel(sx, sy, (v & ~mask) | ((v + dir) & mask))
    }
  }
  s.rp.bitMap.invalidate()
}

/**
 * The shared body of the four Pix commands.
 *
 * `cyclic` is the difference between the pairs: Pix Shift Up/Down wrap round
 * the c1..c2 range, Pix Brighten/Darken stop at its ends. Colours outside the
 * range are "not affected" either way.
 */
function pixShift(rt: Runtime, it: Interp, dir: number, cyclic: boolean): void {
  const s = rt.screens.get(it.evalInt())
  it.expect(',')
  const c1 = it.evalInt()
  it.expect(',')
  const c2 = it.evalInt()
  it.expect(',')
  const x1 = it.evalInt()
  it.expect(',')
  const y1 = it.evalInt()
  it.expect('to')
  const x2 = it.evalInt()
  it.expect(',')
  const y2 = it.evalInt()
  const bank = it.accept(',') ? rt.memBanks.get(it.evalInt()) : undefined
  if (!s || c2 < c1) amcafErr()
  const w = x2 - x1 + 1
  const span = c2 - c1 + 1
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (bank && !bank.data[(y - y1) * w + (x - x1)]) continue
      const v = s.rp.point(x, y)
      if (v < 0 || v < c1 || v > c2) continue
      const next = v + dir
      if (cyclic) s.rp.putPixel(x, y, c1 + (((next - c1) % span) + span) % span)
      else s.rp.putPixel(x, y, Math.max(c1, Math.min(c2, next)))
    }
  }
  s.rp.bitMap.invalidate()
}

/** Exchange Bob / Exchange Icon: swap two images inside one bank */
function exchangeImage(rt: Runtime, it: Interp, sprites: boolean): void {
  const a = it.evalInt()
  it.expect(',')
  const b = it.evalInt()
  const list = (sprites ? rt.spriteBank : rt.iconBank)?.images
  if (!list || !list[a - 1] || !list[b - 1]) amcafErr()
  const tmp = list[a - 1]!
  list[a - 1] = list[b - 1]!
  list[b - 1] = tmp
}

/* ------------------------------------------------------------------ *
 * Slice 9: the particle engines
 * ------------------------------------------------------------------ */

/**
 * A limit rectangle in whole pixels, plus the origin the Td Stars forms
 * derive from it.
 */
export interface Limit {
  x1: number
  y1: number
  x2: number
  y2: number
  /** the origin routines 291/292 store at $256/$258 — see `td stars limit` */
  cx: number
  cy: number
}

/**
 * The shared `[x1,y1 To x2,y2]` limit argument.
 *
 * The bare form is *"If you don't give any parameters, AMCAF uses the limits
 * of the current screen"*, and routine 277 ($6b66) shows it SNAPSHOTS them
 * rather than deferring:
 *
 *     movea.l $52c(a5), a0        the current screen
 *     move.l  a0, d0 / Rbeq 376   ...and error if there is not one
 *     clr.l   $26e(a2)            low bound is 0,0
 *     move.w  $4c(a0), d0 / lsl.w #4, d0 / subq.w #1, d0
 *     move.w  $4e(a0), d0 / lsl.w #4, d0 / subq.w #1, d0
 *     move.l  d0, $272(a2)
 *
 * so the high bound is the screen size in SIXTEENTHS of a pixel less one —
 * the engine's own fixed point — which in whole pixels is `width - 1`. Taking
 * the size at call time is the visible difference: a program that resizes the
 * screen afterwards keeps the limits it asked for.
 *
 * `shift` is the engine's fixed point: 4 for Splinters (routines 277/278), 6
 * for Td Stars (291/292). It matters because the `To` bound has 1 subtracted
 * in those units, which makes it EXCLUSIVE in whole pixels.
 *
 * The explicit form also NORMALISES: `cmp.w d0,d2 / bhi / exg.l d0,d2` per
 * axis, so `30,20 To 1,2` is accepted and read backwards. The swap happens
 * after the subtract, so the two orderings are not quite mirror images —
 * ascending gives x1..x2-1 and descending gives x2..x1.
 *
 * `cx`/`cy` are the origin the Td Stars forms then store. See TdStarLimit.
 */
function readLimit(rt: Runtime, it: Interp, shift: number): Limit {
  const u = 1 << shift
  if (it.atStmtEnd()) {
    const s = rt.screen
    if (!s) amcafErr()
    return { x1: 0, y1: 0, x2: s.width - 1, y2: s.height - 1, cx: s.width / 2, cy: s.height / 2 }
  }
  const a = it.evalInt()
  it.expect(',')
  const b = it.evalInt()
  it.expect('to')
  const c = it.evalInt()
  it.expect(',')
  const d = it.evalInt()

  // In sub-pixel units, exactly as the routine holds them: `lsl.w #n` then
  // `subq.l #1` on the high pair, then `cmp.w`/`exg.l` to order each axis.
  let lx = a * u
  let hx = c * u - 1
  let ly = b * u
  let hy = d * u - 1
  if (!(hx > lx)) [lx, hx] = [hx, lx]
  if (!(hy > ly)) [ly, hy] = [hy, ly]

  // The origin the routine then computes — and it MIXES THE AXES.
  const cx = (lx + ly) / 2 / u
  const cy = (hx + hy) / 2 / u
  // Positions are truncated to whole pixels before being tested, so the
  // sub-pixel bounds collapse: `c*u - 1` excludes pixel c, `a*u` includes a.
  return { x1: Math.ceil(lx / u), y1: Math.ceil(ly / u), x2: Math.floor(hx / u), y2: Math.floor(hy / u), cx, cy }
}

const inLimit = (rt: Runtime, lim: Limit | null, x: number, y: number): boolean => {
  const s = rt.screen
  if (!s) return false
  if (!lim) return x >= 0 && y >= 0 && x < s.width && y < s.height
  return x >= lim.x1 && y >= lim.y1 && x <= lim.x2 && y <= lim.y2
}

function moveSplinters(rt: Runtime): void {
  const sp = rt.amcaf.splinters
  for (const q of sp.p) {
    q.vx += sp.gx
    q.vy += sp.gy
    q.x += q.vx
    q.y += q.vy
    // "If you set 'time' to 0, the Splinters only disappear at the edges"
    if (sp.fuel > 0 && q.life > 0) q.life--
  }
  sp.p = sp.p.filter((q) => (sp.fuel === 0 || q.life > 0) && inLimit(rt, sp.limit, q.x | 0, q.y | 0))
}

function drawSplinters(rt: Runtime): void {
  const sp = rt.amcaf.splinters
  const s = rt.screen
  if (!s) return
  const mask = (1 << sp.planes) - 1
  for (const q of sp.p) s.rp.putPixel(q.x | 0, q.y | 0, q.c & mask)
  s.rp.bitMap.invalidate()
}

/**
 * The channel argument the Pt query functions take, range-checked as they do.
 *
 * Routines 228 and 229 both open `move.l (a3)+,d7 / Rbmi 372` then
 * `cmp.b #4,d7 / Rbge 372`, so a negative channel or one past 3 is an ERROR
 * rather than something to mask. An earlier pass wrote `& 3`, which silently
 * answered for channel 0 where the machine stops the program.
 */
function ptChan(v: number): number {
  if (v < 0 || v >= 4) amcafErr()
  return v
}

/**
 * Blitter Copy's worker: one bitplane into another through a minterm.
 *
 * The A/B/C channels are the one, two or three sources in order, and a
 * channel with no source reads as all-ones — the same rule `mintermBit` in
 * ../amiga/blitter.ts documents, and what makes $F0 (D = A) a plain copy
 * whatever the other two are doing.
 */
function bltCopyPlanes(
  rt: Runtime,
  src: Array<[number, number]>,
  ds: number,
  dp: number,
  minterm: number,
): void {
  const lim = rt.amcaf.bltLimit
  // "Before you can call Blitter Copy, you MUST set the limits"
  if (!lim) amcafErr()
  const dst = rt.screens.get(ds)
  if (!dst || dp < 0 || dp >= dst.rp.bitMap.depth) amcafErr()
  const planes = src.map(([sn, pn]) => {
    const s = rt.screens.get(sn)
    // `cmp.w d4,d7 / Rbge 372` — the plane must be inside the screen's depth
    if (!s || pn < 0 || pn >= s.rp.bitMap.depth) amcafErr()
    return { bm: s.rp.bitMap, pn }
  })
  const bit = (i: number, x: number, y: number): number => {
    const p = planes[i]
    if (!p) return 1 // an absent channel reads as all ones
    if (x < 0 || y < 0 || x >= p.bm.width || y >= p.bm.height) return 0
    return (p.bm.pixelAt(x, y) >> p.pn) & 1
  }
  const x1 = Math.max(0, lim.x1)
  const y1 = Math.max(0, lim.y1)
  const x2 = Math.min(dst.width - 1, lim.x2)
  const y2 = Math.min(dst.height - 1, lim.y2)
  const mask = 1 << dp
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const d = mintermBit2(minterm, bit(0, x, y), bit(1, x, y), bit(2, x, y))
      const v = dst.rp.bitMap.pixelAt(x, y)
      dst.rp.bitMap.writePixel(x, y, d ? v | mask : v & ~mask)
    }
  }
  dst.rp.bitMap.invalidate()
}

/** the truth table indexed by (A<<2)|(B<<1)|C, which is what a minterm IS */
const mintermBit2 = (lf: number, a: number, b: number, c: number): number =>
  (lf >> ((a << 2) | (b << 1) | c)) & 1

/** Splinters Back: snapshot the pixels under the CURRENT positions */
function backSplinters(rt: Runtime): void {
  const sp = rt.amcaf.splinters
  const s = rt.screen
  if (!s) return
  sp.savedPrev = sp.saved
  sp.saved = sp.p.map((q) => ({ x: q.x | 0, y: q.y | 0, c: Math.max(0, s.rp.point(q.x | 0, q.y | 0)) }))
}

/**
 * Put back what Splinters Back saved, which is how the background survives.
 *
 * `prev` picks the older generation, for the double-buffered Del: the buffer
 * being cleared was last drawn two frames ago, so the pixels under it are the
 * ones saved two Backs ago.
 */
function restoreSplinters(rt: Runtime, prev: boolean): void {
  const sp = rt.amcaf.splinters
  const s = rt.screen
  const from = prev ? sp.savedPrev : sp.saved
  if (!s || !from) return
  for (const q of from) s.rp.putPixel(q.x, q.y, q.c)
  s.rp.bitMap.invalidate()
}

function moveStar(rt: Runtime, i: number): void {
  const st = rt.amcaf.stars
  const q = st.s[i]
  if (!q) return
  q.vx += st.gx
  q.vy += st.gy
  // an accelerating star gains speed as it approaches, which is what makes a
  // 3D field look like one rather than a drift
  if (st.accelerate) q.z += 1
  q.x += (q.vx * q.z) / 256
  q.y += (q.vy * q.z) / 256
  if (!inLimit(rt, st.limit, q.x | 0, q.y | 0)) {
    q.x = st.ox
    q.y = st.oy
    q.z = 1
  }
}

function drawStars(rt: Runtime, on: boolean): void {
  const st = rt.amcaf.stars
  const s = rt.screen
  if (!s) return
  const mask = (1 << st.planes) - 1
  for (const q of st.s) s.rp.putPixel(q.x | 0, q.y | 0, on ? mask : 0)
  s.rp.bitMap.invalidate()
}

/* ------------------------------------------------------------------ *
 * Slice 10: vector rotation
 * ------------------------------------------------------------------ */

/**
 * Rotate a point about all three axes and project it, caching the result.
 *
 * With three arguments all three coordinates are computed at once — "If you
 * call the function with the parameters x,y,z all three new coordinates are
 * calculated" — and a bare call reads the cache, which is why the trio has a
 * no-argument form.
 */
function vecRot(rt: Runtime, a: Value[]): { x: number; y: number; z: number } {
  const v = rt.amcaf.vec
  if (a.length < 3) return { x: v.x, y: v.y, z: v.z }
  let x = int(a[0]!) - v.px
  let y = int(a[1]!) - v.py
  let z = int(a[2]!) - v.pz
  const rot = (p: number, q: number, ang: number): [number, number] => {
    // the same 1024-to-the-turn units and 256-scaled table Qsin uses
    const si = SIN256[ang & 0x3ff]!
    const co = SIN256[(ang + 256) & 0x3ff]!
    return [(p * co - q * si) / 256, (p * si + q * co) / 256]
  }
  ;[y, z] = rot(y, z, v.ax)
  ;[x, z] = rot(x, z, v.ay)
  ;[x, y] = rot(x, y, v.az)
  // "automatically projected from 3D to 2D by dividing it through the distance"
  const d = z === 0 ? 1 : z
  v.x = Math.round((x * 256) / d)
  v.y = Math.round((y * 256) / d)
  v.z = Math.round(z)
  return { x: v.x, y: v.y, z: v.z }
}

/* ------------------------------------------------------------------ *
 * Slice 11: the four-player adaptor
 * ------------------------------------------------------------------ */

/**
 * A parallel-port joystick's bits.
 *
 * Zero, always. The adaptor is a homemade cable on CIA-A PRB — the manual
 * even includes a wiring diagram — and there is none attached here, which is
 * the same answer `sticks.ts` gives for the same registers. Reporting nothing
 * pressed is what an unused port reads as on the machine too.
 */
function fourPlayer(port: number): number {
  if (port < 0 || port > 1) amcafErr()
  return 0
}

/* ------------------------------------------------------------------ *
 * Slice 12: ProTracker
 * ------------------------------------------------------------------ */

/**
 * One sample out of a ProTracker module.
 *
 * The format is fixed and public: 20 bytes of song name, then 31 sample
 * headers of 30 bytes each (22-byte name, length in WORDS, finetune, volume,
 * repeat point and repeat length), the song length and restart byte, a
 * 128-entry pattern order, four magic bytes, then the patterns and finally
 * the sample data in order.
 */
function modSample(mod: Uint8Array, n: number): { off: number; len: number } | null {
  if (n < 1 || n > 31 || mod.length < 1084) return null
  const rd = (o: number): number => ((mod[o] ?? 0) << 8) | (mod[o + 1] ?? 0)
  let patterns = 0
  for (let i = 0; i < 128; i++) patterns = Math.max(patterns, (mod[952 + i] ?? 0) + 1)
  let off = 1084 + patterns * 1024
  for (let i = 1; i <= 31; i++) {
    const len = rd(20 + (i - 1) * 30 + 22) * 2
    if (i === n) return { off, len }
    off += len
  }
  return null
}

/**
 * Pt Sam Play: an AMOS sample bank entry onto the voices a MASK names.
 *
 * "The 'voice' parameter contains a bitmask, that describes, on which
 * channels the sample number 'samnr' should be replayed" — the manual is
 * explicit, and Pt Sam Freq / Pt Sam Stop / Pt Instr Play share the shape.
 * An earlier pass took it as an index in all four.
 *
 * "If it is omitted" the replayer picks: "the sounds 'interact' with the
 * Protracker music", so a bare call takes a channel the music is not holding.
 */
function ptSamPlay(rt: Runtime, voice: number, sam: number, freq: number): void {
  const pt = rt.amcaf.pt
  const b = rt.memBanks.get(pt.samBank || 5)
  if (!b) return
  const list = parseSampleBank(b.data)
  const e = list[sam - 1]
  if (!e) return
  if (voice < 0) {
    // omitted: take a channel the music is not using
    let v = 0
    for (let i = 0; i < 4; i++) {
      if (!pt.playing || (pt.voices & (1 << i)) === 0) {
        v = i
        break
      }
    }
    rt.host.audio?.play(v, e.pcm, freq || e.freq, pt.volume, -1)
    return
  }
  for (let i = 0; i < 4; i++) if (voice & (1 << i)) rt.host.audio?.play(i, e.pcm, freq || e.freq, pt.volume, -1)
}

/** Pt Instr Play: one of the MODULE's samples, rather than an AMOS bank's */
function ptInstrPlay(rt: Runtime, instr: number, voice: number, freq: number): void {
  const pt = rt.amcaf.pt
  const b = rt.memBanks.get(pt.bank)
  if (!b) return
  const s = modSample(b.data, instr)
  if (!s || s.len <= 0) return
  const pcm = new Int8Array(b.data.buffer, b.data.byteOffset + s.off, Math.min(s.len, b.data.length - s.off))
  // the same bitmask as Pt Sam Play, not an index
  const hz = freq || periodToHz(AMIGA_PERIODS[24]!)
  if (voice < 0) {
    rt.host.audio?.play(0, pcm, hz, pt.volume, -1)
    return
  }
  for (let i = 0; i < 4; i++) if (voice & (1 << i)) rt.host.audio?.play(i, pcm, hz, pt.volume, -1)
}

/** the shared body of C2p Shift and C2p Fire */
function c2pTransform(rt: Runtime, it: Interp, fire: boolean): void {
  const st = it.evalInt()
  it.expect(',')
  const wx = it.evalInt()
  it.expect(',')
  const wy = it.evalInt()
  it.expect('to')
  const st2 = it.evalInt()
  it.expect(',')
  const arg = it.evalInt()
  const src = rt.resolveAddr(st)
  const dst = rt.resolveWrite(st2)
  if (!src || !dst) amcafErr()
  for (let i = 0; i < wx * wy; i++) {
    const v = src.data[src.off + i] ?? 0
    const out = fire ? Math.max(0, v - arg) : v + arg
    if (dst.off + i < dst.data.length) dst.data[dst.off + i] = out & 0xff
  }
}

export function makeAmcafFunctions(rt: Runtime): Record<string, Func> {
  void rt
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0))
  const s0 = (a: Value[], n: number): string => str(a[n] ?? VS(''))
  return {

    /**
     * =Chr.w$(v) / =Chr.l$(v) — routines 179 and 180. A number as its raw
     * bytes, big-endian, "Using this technique, you can save numbers as
     * normal strings". Chr.w$ ignores the upper 16 bits.
     */
    'chr.w$': (_, a) => {
      const v = i0(a, 0) & 0xffff
      return VS(String.fromCharCode((v >> 8) & 0xff, v & 0xff))
    },
    'chr.l$': (_, a) => {
      const v = i0(a, 0)
      return VS(String.fromCharCode((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff))
    },

    /**
     * =Asc.w(s$) / =Asc.l(s$) — routines 181 and 182, the way back.
     *
     * Asc.w is UNSIGNED ("the result will be between 0 and 65535") and Asc.l
     * is SIGNED ("can range between -2147483648 and +2147483647"), which is
     * the only asymmetry in the group. A string too short to hold the value
     * is an error in both.
     */
    'asc.w': (_, a) => {
      const t = s0(a, 0)
      if (t.length < 2) amcafErr()
      return VI(((t.charCodeAt(0) & 0xff) << 8) | (t.charCodeAt(1) & 0xff))
    },
    'asc.l': (_, a) => {
      const t = s0(a, 0)
      if (t.length < 4) amcafErr()
      let v = 0
      for (let i = 0; i < 4; i++) v = ((v << 8) | (t.charCodeAt(i) & 0xff)) >>> 0
      return VI(v | 0)
    },

    /**
     * =Lsstr$(v,n) / =Lzstr$(v,n) — routines 178 and 177 ($488e).
     *
     * A number right-justified in exactly n characters. Lsstr$ pads with
     * spaces and Lzstr$ with zeros, and NEITHER prints the sign — the
     * manual says so and the routine never emits one.
     */
    'lsstr$': (_, a) => VS(padNum(i0(a, 0), i0(a, 1), ' ')),
    'lzstr$': (_, a) => VS(padNum(i0(a, 0), i0(a, 1), '0')),

    /**
     * =Insstr$(a$,b$,pos) — routine 187 ($4a44).
     *
     * `pos` is a COUNT OF LEADING CHARACTERS KEPT, not a 1-based index: the
     * routine errors on a negative one (`Rbmi`) and on `pos > len(a$)`
     * (`cmp.w d5,d7 / Rbhi`), so the legal range is 0..len inclusive. The
     * manual's example agrees — inserting "dear " at 6 into "Hello Ben!"
     * keeps the six characters "Hello " and gives "Hello dear Ben!".
     *
     * An empty b$ returns a$ untouched, which the routine takes as a special
     * case before allocating anything.
     */
    'insstr$': (_, a) => {
      const base = s0(a, 0)
      const ins = s0(a, 1)
      const pos = i0(a, 2)
      if (pos < 0 || pos > base.length) amcafErr()
      if (ins === '') return VS(base)
      return VS(base.slice(0, pos) + ins + base.slice(pos))
    },

    /**
     * =Cutstr$(s$,pos1 To pos2) — routine 188 ($4aae). Removes the run from
     * pos1 to pos2 INCLUSIVE, counting from 1: the manual's example cuts
     * 7 To 11 out of "Hello dear Ben!" and gets "Hello Ben!", which is the
     * five characters "dear ".
     *
     * NOTE: the routine's middle runs into bytes the disassembler cannot
     * separate from code — the same misdecode `Vmod` hits — so the bound
     * checks it makes (`Rbmi` on a negative position, on pos2 < pos1, and on
     * pos1 past the end) are legible but the exact arithmetic is not. The
     * worked example is unambiguous and is what this follows.
     */
    'cutstr$': (_, a) => {
      const t = s0(a, 0)
      const p1 = i0(a, 1)
      const p2 = i0(a, 2)
      if (p1 < 0 || p2 < p1 || p1 > t.length) amcafErr()
      return VS(t.slice(0, Math.max(0, p1 - 1)) + t.slice(p2))
    },

    /** =Replacestr$(s$,search$ To replace$) — routine 189, every occurrence */
    'replacestr$': (_, a) => {
      const t = s0(a, 0)
      const find = s0(a, 1)
      if (find === '') return VS(t)
      return VS(t.split(find).join(s0(a, 2)))
    },

    /**
     * =Itemstr$(s$,n) and =Itemstr$(s$,n,sep$) — routines 190 and 191.
     *
     * Items are numbered FROM ZERO and separated by '|' unless a single
     * character is given. "Empty strings for s$ are not allowed and will
     * create an error message, however, empty items can be used without
     * hesitation. Trying to access a item, that does not exist, will create
     * an error aswell."
     */
    'itemstr$': (_, a) => {
      const t = s0(a, 0)
      const n = i0(a, 1)
      const sep = a.length > 2 ? s0(a, 2) : '|'
      if (t === '' || n < 0 || sep === '') amcafErr()
      const parts = t.split(sep[0]!)
      if (n >= parts.length) amcafErr()
      return VS(parts[n]!)
    },

    /**
     * =Scanstr$(scancode) — routine 278. "returns the name of a key
     * according to the parameter 'scancode' ... If there is no key for the
     * scancode, an empty string will be returned."
     */
    'scanstr$': (_, a) => VS(KEY_NAMES[i0(a, 0)] ?? ''),


    /**
     * =Current Date — routine 320 ($70c4) in 1.50, 306 ($7348) in 1.40.
     *
     * `DateStamp()` (dos.library -$c0) into the extension's own block at
     * $380(a2), then `move.l (a2),d3` — the ds_Days longword and nothing else.
     * "Counts the days passed since 1st January 1978", which is the DateStamp
     * epoch exactly.
     */
    'current date': () => VI(rt.host.clock.now().days),

    /**
     * =Current Time — routine 321 ($70e0) / 307 ($736c), the same DateStamp
     * call read differently: `move.w $6(a2),d3 / swap d3 / move.w $a(a2),d3`.
     *
     * $380+6 is the LOW WORD of ds_Minute and $380+$a the low word of ds_Tick,
     * so the pair packs minutes over ticks and the two high words are dropped
     * rather than checked.
     */
    'current time': () => {
      const st = rt.host.clock.now()
      return VI(packTime(st.mins, st.ticks))
    },

    /**
     * =Cd Day(date) — routine 324 ($713e) / 310 ($73da). "A value between 1
     * and 31."
     *
     * `Rbsr` into Cd Month and then `move.l d0,d3 / addq.b #$1,d3`: the day is
     * whatever the month splitter left behind, made 1-based. Nothing bounds
     * it, so a negative date reports day 0.
     */
    'cd day': (_, a) => {
      const { year, rest } = amcafYear(i0(a, 0))
      return VI((amcafMonth(year, rest).rest + 1) | 0)
    },
    /**
     * =Cd Month(date) — routine 323 ($712e) / 309 ($73ca). "Lies between 1 and
     * 12": six bytes of `Rbsr` Cd Year, `Rbra` the month splitter.
     */
    'cd month': (_, a) => {
      const { year, rest } = amcafYear(i0(a, 0))
      return VI(amcafMonth(year, rest).month)
    },
    /** =Cd Year(date) — routine 322 ($7104) / 308 ($7398), the loop above */
    'cd year': (_, a) => VI(amcafYear(i0(a, 0)).year),

    /**
     * =Cd Weekday(date) — routine 325 ($7150) / 311 ($73ec). "Can range
     * between 1 (monday) and 7 (sunday)."
     */
    'cd weekday': (_, a) => VI(amcafWeekday(i0(a, 0))),

    /**
     * =Cd Date$(date) — routine 328 ($74bc in 1.40). "The format
     * 'WWW DD-MMM-YY'", and the length word it writes is a fixed 13.
     *
     * Built from the two overlapping four-byte tables rather than formatted:
     * weekday slot, two digits, month slot, a literal '-', two digits of
     * `year mod 100`. The weekday is read with `move.l (a3),d0` — WITHOUT
     * popping — because Cd Year is then called on the same argument.
     *
     * NOTE: it works the weekday out inline rather than calling Cd Weekday,
     * and uses the `divu` REMAINDER as the table index with no +1. Past the
     * overflow day the index becomes the top half of the day count shifted
     * left two, which reads whatever follows the tables; this port keeps the
     * remainder rather than inventing bytes for it.
     */
    'cd date$': (_, a) => {
      const d = i0(a, 0)
      const { year, rest } = amcafYear(d)
      const { month, rest: dayIdx } = amcafMonth(year, rest)
      const wd = CD_WEEK4[((d + 6) >>> 0) % 7] ?? CD_WEEK4[6]!
      return VS(`${wd}${amcafTwoDigits(dayIdx + 1)}${CD_MON4[month] ?? ''}-${amcafTwoDigits(year % 100)}`)
    },

    /**
     * =Cd String(date$) — routine 327 ($7464), and it really is dos.library:
     * `movea.l $2b8(a5),a6 / jsr -$2ee(a6)` is StrToDate, which is why the
     * manual says "This command only works on OS2.0 and higher" and why a
     * `cmp.w #$25,$14(a0)` against ExecBase's LIB_VERSION guards the entry.
     * NOTE: that gate is not modelled — the machine this port describes is an
     * A1200, so version 39, and the check can only pass.
     *
     * The DateTime it builds is `clr.w $c(a1)` — dat_Format 0 (FORMAT_DOS) and
     * dat_Flags 0 — with dat_StrDate set and dat_StrTime cleared, so the two
     * String keywords are one call site parameterised by which pointer is
     * filled in. On failure the library returns 0 and the routine answers -1.
     *
     * "DD-MMM-YY" or "DD-month-YY", plus Today, Tomorrow, Yesterday and a
     * weekday name, where "weekday strings refer to the last occurence of the
     * week, i.e 'Monday' represents last monday and not next monday" — which
     * AROS's StrToDate confirms is not a flag: DTF_SUBST governs DateToStr,
     * and only DTF_FUTURE would move a weekday forwards.
     *
     * DEVIATION: the library matches those words with `Strnicmp(table[t], ptr,
     * strlen(table[t]))`, a case-insensitive PREFIX test, so "Todayish" is
     * Today and "12-November-89" matches "Nov" and then fails on the leftover
     * "ember". This port matches the whole word and accepts the full month
     * names the manual promises, which is the union of the two: no string a
     * real machine accepted is refused here.
     */
    'cd string': (_, a) => {
      const t = s0(a, 0).trim().toLowerCase()
      const today = rt.host.clock.now().days
      if (t === 'today') return VI(today)
      if (t === 'tomorrow') return VI(today + 1)
      if (t === 'yesterday') return VI(today - 1)
      const wd = WEEKDAYS.findIndex((w) => w.toLowerCase() === t)
      if (wd >= 0) {
        // the LAST occurrence, so step back until the weekday matches
        for (let i = 1; i <= 7; i++) {
          const d = today - i
          if ((((d % 7) + 7) % 7 + 6) % 7 === wd) return VI(d)
        }
      }
      const m = /^(\d{1,2})-([a-z]+)-(\d{2,4})$/.exec(t)
      if (!m) return VI(-1)
      const mon = MONTHS.findIndex((x) => x.toLowerCase() === m[2])
      const monFull = MONTHS_FULL.findIndex((x) => x.toLowerCase() === m[2])
      const mi = mon >= 0 ? mon : monFull
      if (mi < 0) return VI(-1)
      const day = Number(m[1])
      let year = Number(m[3])
      // a two-digit year is 1978..2077, the range a DateStamp can hold
      if (year < 100) year += year < 78 ? 2000 : 1900
      const days = Math.floor((Date.UTC(year, mi, day) - STAMP_EPOCH) / DAY_MS)
      if (!Number.isFinite(days) || days < 0) return VI(-1)
      const [cy, cm, cd] = stampToYmd(days)
      if (cy !== year || cm !== mi + 1 || cd !== day) return VI(-1) // 31-Feb and friends
      return VI(days)
    },

    /**
     * =Ct Hour(time) — routine 329 ($758a). "Separates the hour from the
     * packed time": clear the low word, `swap`, `divu.w #$3c` and keep the
     * QUOTIENT. So the minutes-since-midnight field divided by sixty.
     */
    'ct hour': (_, a) => VI(Math.floor(timeMins(i0(a, 0)) / 60)),
    /**
     * =Ct Minute(time) — routine 330 ($75a4). The same divide, keeping the
     * REMAINDER instead: `move.w d2,d3 / swap d3` lifts it out of the high
     * word. Minutes within the hour.
     */
    'ct minute': (_, a) => VI(timeMins(i0(a, 0)) % 60),
    /**
     * =Ct Second(time) — routine 331 ($75be). `move.w d0,d1 / divu.w #$32,d1`
     * on the LOW word, quotient kept: the ticks field divided by fifty.
     */
    'ct second': (_, a) => VI(Math.floor(timeTicks(i0(a, 0)) / TICKS_PER_SECOND)),

    /**
     * =Ct Tick(time) — routine 332 ($75d8). "Calculates the number of vertical
     * blanks (=1/50 of a second) from the parameter 'time'".
     *
     * That sentence does not say whether the count is within the second or
     * within the minute, and an earlier pass read it as the whole low word —
     * which made Ct Tick and Ct Second two resolutions of one field. The
     * routine settles it: `divu.w #$32,d3` then `move.w d2,d3 / swap d3`
     * keeps the REMAINDER, the same shape as Ct Minute. So the pair partition
     * the field, and Ct Tick is 0..49.
     */
    'ct tick': (_, a) => VI(timeTicks(i0(a, 0)) % TICKS_PER_SECOND),

    /**
     * =Ct Time$(time) — routine 333 ($75f2). "A string in the format
     * 'HH:MM:SS'", with a length word of 8 written before any digit is.
     *
     * Hours and minutes come from one `divu.w #$3c` (quotient then, after a
     * `swap`, remainder) and seconds from `divu.w #$32` on the ticks, each
     * rendered by the count-up printer above rather than by a formatter.
     */
    'ct time$': (_, a) => {
      const t = i0(a, 0)
      const mins = timeMins(t)
      const two = amcafTwoDigits
      return VS(`${two(Math.floor(mins / 60))}:${two(mins % 60)}:${two(Math.floor(timeTicks(t) / TICKS_PER_SECOND))}`)
    },

    /**
     * =Ct String(time$) — routine 326 ($7406), Cd String's twin: the same
     * StrToDate call with dat_StrTime filled in and dat_StrDate cleared, then
     * `move.w $386(a2),d3 / swap / move.w $38a(a2),d3` to pack ds_Minute over
     * ds_Tick the way Current Time does. "HH:MM" or "HH:MM:SS", -1 when it
     * will not parse.
     *
     * NOTE: both String keywords copy the AMOS string to the START of the
     * extension's own block with no length check (`move.w (a0)+,d0` then a
     * `dbra` copy), and the DateTime they then fill in sits at +$380 of that
     * same block. A string of 896 characters or more overwrites the structure
     * it is about to be parsed into. Not reproduced — there is no block here
     * to overrun — but it is why an over-long argument on a real machine
     * misbehaves rather than simply failing.
     */
    'ct string': (_, a) => {
      const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s0(a, 0).trim())
      if (!m) return VI(-1)
      const h = Number(m[1])
      const mi = Number(m[2])
      const sec = m[3] === undefined ? 0 : Number(m[3])
      if (h > 23 || mi > 59 || sec > 59) return VI(-1)
      return VI(packTime(h * 60 + mi, sec * TICKS_PER_SECOND))
    },


    /**
     * =Bank Checksum(bank) or (start To end) — routines 55 and 54 ($2782).
     *
     * A plain LONGWORD SUM of the region, then `eori.l #$faceface`. The
     * author liked that constant: the word-wide Bank Code Mix uses $FACE and
     * the byte-wide one $AA.
     *
     * The region is measured in longwords (`lsr.l #2`), so a trailing byte,
     * word or three bytes are not counted.
     */
    'bank checksum': (_, a) => {
      const r = bankRegion(rt, i0(a, 0), a.length > 1 ? i0(a, 1) : null)
      let sum = 0
      const longs = r.length >>> 2
      for (let i = 0; i < longs; i++) {
        const o = i * 4
        sum = (sum + (((r[o]! << 24) | (r[o + 1]! << 16) | (r[o + 2]! << 8) | r[o + 3]!) | 0)) | 0
      }
      return VI((sum ^ 0xfaceface) | 0)
    },

    /** =Bank Name$(bank) — routine 59 */
    'bank name$': (_, a) => {
      const b = rt.memBanks.get(i0(a, 0))
      if (!b) amcafErr()
      return VS(b.name)
    },


    /**
     * =Examine Next$ — routine 110 ($3a80). "If the end of the directory list
     * is reached, file$ will contain an empty string and the drawer will be
     * closed."
     *
     * With no lock held it is error 23 rather than an empty string, which is
     * the manual's "you may not make any further calls to Examine Next$" made
     * enforceable. `ExNext` succeeding tail-calls straight into Object Name$
     * (`Rbne routine 114`), so the name it returns and the name the accessor
     * would return are literally the same instruction — and the whole
     * FileInfoBlock is left describing the entry, which is what makes the
     * walk-and-read idiom work.
     */
    'examine next$': () => {
      const e = rt.amcaf.examine
      if (e.dir === '') amcafErr()
      e.index++
      const name = e.entries[e.index]
      if (name === undefined) {
        rt.amcaf.examine = { dir: '', entries: [], index: -1, current: '' }
        return VS('')
      }
      e.current = joinAmigaPath(e.dir, name)
      return VS(name)
    },

    /**
     * The `Object *` accessors — routines 114 to 129, and every one of them is
     * three or four instructions reading a fixed offset of the FileInfoBlock
     * the last Examine filled in:
     *
     *   Object Type        $104(a2)  fib+4    fib_DirEntryType, raw
     *   Object Name$       $108(a2)  fib+8    fib_FileName
     *   Object Protection  $174(a2)  fib+116  fib_Protection
     *   Object Size        $17c(a2)  fib+124  fib_Size
     *   Object Blocks      $180(a2)  fib+128  fib_NumBlocks
     *   Object Date        $184(a2)  fib+132  fib_Date.ds_Days
     *   Object Time        $18a/$18e fib+138/142  the LOW WORDS of the pair
     *   Object Comment$    $190(a2)  fib+144  fib_Comment
     *
     * Not one of them takes an argument or checks anything — the token table
     * agrees, giving every one a spec of `"0"` or `"2"`. So they answer for
     * whatever the block holds, including before any Examine at all.
     */
    'object type': (_, a) => {
      const p = objPath(rt, a)
      const k = rt.vfs?.exists(p) ?? null
      return VI(k === null ? 0 : entryType(k === 'dir'))
    },
    'object size': (_, a) => VI(objSize(rt, objPath(rt, a))),
    'object blocks': (_, a) => VI(blocksFor(objSize(rt, objPath(rt, a)))),
    'object name$': (_, a) => {
      const p = objPath(rt, a)
      const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf(':'))
      return VS(cut >= 0 ? p.slice(cut + 1) : p)
    },
    'object date': (_, a) => VI(rt.vfs?.meta(objPath(rt, a)).days ?? 0),
    'object time': (_, a) => {
      const m = rt.vfs?.meta(objPath(rt, a))
      return VI(packTime(m?.mins ?? 0, m?.ticks ?? 0))
    },
    'object protection': (_, a) => VI(rt.vfs?.meta(objPath(rt, a)).protection ?? 0),
    'object comment$': (_, a) => VS(rt.vfs?.meta(objPath(rt, a)).comment ?? ''),

    /**
     * =Object Protection$(prot) — routine 127 ($3bb0). Note the argument: this
     * takes the NUMERIC VALUE, not a path, and unlike its neighbours it never
     * touches the FileInfoBlock. "Converts this numeric value into a string in
     * the format 'hsparwed'."
     *
     * The table it reads is twelve bytes at $3be0 — **"dewr----apsh"** — and
     * the loop counts d0 from 7 down to 0 taking `table[d0]` when the bit is
     * CLEAR and `table[d0+4]` when it is SET. The two halves overlap on the
     * four hyphens in the middle, which is how one table serves both the
     * inverted low four bits and the plain high four.
     */
    'object protection$': (_, a) => VS(protectionString(i0(a, 0) & 0xff)),

    /**
     * =Filename$("DH2:AMOS/AMOSPro") is "AMOSPro" — routine 96 ($3536).
     *
     * One left-to-right scan recording the position after the LAST ':' or '/'
     * it sees, so a separator of either kind counts and the last one wins.
     * Neither this nor Path$ goes through the path converter, so neither has
     * the 1..128 limit and an empty argument gives an empty answer rather than
     * an error.
     */
    'filename$': (_, a) => {
      const p = s0(a, 0)
      const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf(':'))
      return VS(cut >= 0 ? p.slice(cut + 1) : p)
    },
    /**
     * =Path$("DH2:AMOS/AMOSPro") is "DH2:AMOS" — routine 97 ($358e), "a kind
     * of Parent$".
     *
     * The same scan, with the one asymmetry that makes a device name work:
     * ':' records the position AFTER itself and '/' records the position
     * before (`move.w d3,d2 / subq.w #$1,d2`), so a colon is kept and a slash
     * dropped. Both are the same scan, so it is the LAST separator of either
     * kind that decides — "DH2:a/b:c" cuts at the second colon, not the slash.
     */
    'path$': (_, a) => {
      const p = s0(a, 0)
      const slash = p.lastIndexOf('/')
      const colon = p.lastIndexOf(':')
      if (colon > slash) return VS(p.slice(0, colon + 1))
      return VS(slash >= 0 ? p.slice(0, slash) : '')
    },

    /**
     * =Pattern Match(source$,pattern$) — routine 102 ($377a). "The pattern may
     * contain any regular DOS jokers[;] a asterik (*) will be converted into
     * '#?' automatically", and "only works on OS2.0 and higher", which is a
     * real `cmp.w #$25` on ExecBase's LIB_VERSION.
     *
     * The library calls are `jsr -$3c6(a6)` and `-$3cc(a6)` — the **NoCase**
     * pair, `ParsePatternNoCase` and `MatchPatternNoCase`, not the plain ones
     * an earlier pass assumed. So the match is case-INSENSITIVE, unlike LDos's
     * on the same matcher, which its own manual is explicit about.
     *
     * The conversion loop also treats an EMPTY pattern as `#?` rather than as
     * a pattern matching only the empty string: `move.w (a0)+,d0 / bne` falls
     * through to `move.w #$233f,(a1)+`, which is those two characters.
     *
     * A pattern ParsePattern refuses is error 23 (`moveq #$ff,d1 / cmp.l d1,d0
     * / Rbeq routine 390`), and the buffer it parses into is 512 bytes.
     */
    'pattern match': (_, a) => {
      const pat = s0(a, 1)
      return VI(amigaMatch(s0(a, 0), pat === '' ? '#?' : pat.replace(/\*/g, '#?'), false, true) ? -1 : 0)
    },

    /**
     * =Disk Type(directory$) — 0 a real device, 1 an assign, 2 a volume name.
     * "Using this function you can filter specific disk types out of a
     * device list."
     */
    'disk type': (_, a) => {
      // NOTE: an assign and a volume are not told apart here. The distinction
      // is a dos.library device-list walk, and this port's AmigaFS keeps its
      // assign map private, so a name that is not a floppy device answers 2.
      // APPROXIMATED for that reason.
      const name = s0(a, 0).replace(/:.*$/, '')
      return VI(/^df\d$/i.test(name) ? 0 : 2)
    },

    /**
     * =Disk State(directory$) — bit 0 write-protected or validating, bit 1
     * in use. The manual is candid about the third case: "If no disk is in
     * the drive, it normally should return -1, but I'm afraid..."
     *
     * Nothing here is write protected, being read from a mounted volume, and
     * nothing is mid-write when a keyword can observe it.
     */
    'disk state': (_, a) => VI(rt.vfs?.exists(s0(a, 0)) === null ? -1 : 0),

    /** =Io Error / =Io Error$ — the last AmigaDOS error, not an AMOS one */
    'io error': () => VI(rt.amcaf.ioError),
    'io error$': (_, a) => VS(dosErrorText(i0(a, 0))),

    /**
     * =Command Name$ — "the file name of the program under which AMOS or the
     * compiled program has been started. This is required for example to
     * read the own Tool Types."
     */
    'command name$': () => {
      // NOTE: nothing records the file a program was loaded from under a name
      // the program itself could have used, so this answers empty. A program
      // using it to find its own Tool Types gets the same nothing Tool Types$
      // gives, which at least keeps the pair consistent. APPROXIMATED.
      return VS('')
    },

    /**
     * =Tool Types$(filename$) — an icon's tool types, one per line.
     *
     * "The supplied file must not have a '.info' appended!" and "The various
     * Tool Types are seperated by a line feed character (Chr$(10)). So they
     * can be printed out easily using Print."
     */
    'tool types$': (_, a) => VS(toolTypes(rt, s0(a, 0))),

    /**
     * =Dos Hash(file$) — routine 99 ($365a). "Returns the hash value of a
     * file. Only for advanced users who want to read directly from dos disks."
     *
     * The AmigaDOS directory hash, instruction for instruction: seed with the
     * length, then per character `mulu.w #$d,d3 / add.l d2,d3 / andi.l
     * #$7ff,d3`, and finally `divu.w #$48,d3` keeping the remainder. $48 is
     * 72, which is 512/4 - 56 — the bucket count of a standard block.
     *
     * The case fold is the part an earlier pass missed:
     *
     *   cmp.b   #$61, d2      ; 'a'
     *   bcs.b   $368a
     *   cmp.b   #$7a, d2      ; 'z'
     *   bhi.b   $368a
     *   subi.b  #$20, d2
     *
     * so a lowercase letter is raised before it is folded in, and only ASCII
     * a..z — an accented character keeps its own byte, which is why two names
     * AmigaDOS considers the same can still land in different buckets.
     */
    'dos hash': (_, a) => {
      const name = s0(a, 0)
      let h = name.length & 0xffff
      for (let i = 0; i < name.length; i++) {
        let c = name.charCodeAt(i) & 0xff
        if (c >= 0x61 && c <= 0x7a) c -= 0x20
        h = (h * 13 + c) & 0x7ff
      }
      return VI(h % 72)
    },


    /**
     * =Red Val / =Green Val / =Blue Val — routines 87, 88 and 89 ($327a),
     * "separate the colour into its three contents".
     *
     * These three are the ONLY readers of the Amcaf Aga Notation flag in the
     * whole hunk, and each opens the same four instructions:
     *
     *   movea.l $168(a5), a2
     *   move.w  $2d2(a2), d0
     *   cmp.w   #$4, d0
     *   bne.b   ...
     *
     * With the flag at 4 they take a nibble each — Red is `lsl.l #$8` then a
     * clear-and-swap, which is a shift right by eight; with anything else they
     * take a byte each. Nothing checks that the argument fits.
     */
    'red val': (_, a) => VI(rt.amcaf.notationBits === 4 ? (i0(a, 0) >>> 8) & 0xffff : (i0(a, 0) >>> 16) & 0xffff),
    'green val': (_, a) => VI(rt.amcaf.notationBits === 4 ? (i0(a, 0) >>> 4) & 0xf : (i0(a, 0) >>> 8) & 0xff),
    'blue val': (_, a) => VI(rt.amcaf.notationBits === 4 ? i0(a, 0) & 0xf : i0(a, 0) & 0xff),

    /**
     * =Glue Colour(r,g,b) — routine 86 ($3260), the way back, and it does NOT
     * consult the notation flag: `moveq #$f,d0` then an `and` per gun, so
     * every component is masked to four bits and the answer is always 12-bit
     * whatever Red Val would have been reading.
     */
    'glue colour': (_, a) => VI(glue(i0(a, 0), i0(a, 1), i0(a, 2))),

    /**
     * =Rgb To Rrggbb(rgb) — 12 bits to 24, and "The missing bits are set to
     * zeros", so $FFF becomes $F0F0F0 rather than $FFFFFF.
     */
    'rgb to rrggbb': (_, a) => {
      const c = i0(a, 0)
      return VI((rV(c) << 20) | (gV(c) << 12) | (bV(c) << 4))
    },
    /** =Rrggbb To Rgb(rrggbb) — 24 to 12, "the other 12 bits will be discarded" */
    'rrggbb to rgb': (_, a) => {
      const c = i0(a, 0)
      return VI(glue((c >> 20) & 15, (c >> 12) & 15, (c >> 4) & 15))
    },

    /**
     * =Mix Colour(rgb1,rgb2) mixes two colours; the three-argument form
     * "added to the colour value 'oldrgb', if 'addrgb' is a positive value or
     * subtracted, if the value is negative", clamped between lrgb and urgb.
     */
    'mix colour': (_, a) => {
      if (a.length < 3) {
        // routine 84 ($3180): each gun added BYTE-wide and then halved
        // WORD-wide, so the two-colour form is the plain average as long as
        // the arguments are twelve bits, and wraps at 256 per gun if they are
        // not. The reds are taken as `(v & $ffff) >> 8` with no mask, so a
        // value wider than twelve bits carries its extra bits into the red.
        const x = i0(a, 0) & 0xffff
        const y = i0(a, 1) & 0xffff
        const r = ((x >> 8) + (y >> 8)) & 0xff
        const g = (((x >> 4) & 0xf) + ((y >> 4) & 0xf)) & 0xff
        const b = ((x & 0xf) + (y & 0xf)) & 0xff
        return VI(((((r >> 1) << 8) | ((g >> 1) << 4) | (b >> 1)) & 0xffff) | 0)
      }
      const old = i0(a, 0)
      const add = i0(a, 1)
      const lo = i0(a, 2)
      const up = i0(a, 3)
      const ch = (f: (v: number) => number): number =>
        Math.max(f(lo), Math.min(f(up), f(old) + (add < 0 ? -f(-add) : f(add))))
      return VI(glue(ch(rV), ch(gV), ch(bV)))
    },

    /**
     * =Best Pen($RGB) or ($RGB,c1 To c2) — routines 82 ($3094) and 83
     * ($30aa). "Acquires the pen which is nearest to the colour ... can be
     * used to recolour pictures with limited palette."
     *
     * The short form is six instructions that push `0` and `(1 << depth) - 1`
     * onto the argument stack and fall into the ranged one, so the two are
     * literally the same search. Both bounds must be 0..63 and the high one no
     * lower than the low, or it is error 23.
     *
     * Two things the port was guessing:
     *
     * **The metric is a lookup table, not a squared distance.** Sixteen bytes
     * at $3170 — `0 1 3 5 8 12 16 20 30 40 50 60 70 80 90 100` — indexed by
     * the absolute difference of one gun, summed over three. It is steeper
     * than a square at the top and shallower at the bottom, so it prefers a
     * pen that is a little wrong everywhere over one that is badly wrong in a
     * single gun. A search that runs out at 1000 (`move.l #$3e8,d4`) finds
     * nothing, and an exact match returns immediately without finishing.
     *
     * **Pens 32-63 are Extra Half-Brite.** `cmp.w #$1f,d6 / bls` sends any
     * index above 31 to `move.w -$42(a0),d0 / andi.w #$eee / lsr.w #$1` —
     * the entry 32 lower with the low bit of each gun dropped and the rest
     * halved, which is what the hardware displays for those pens. So Best Pen
     * over the full 0..63 range considers 32 colours that are not in the
     * palette at all.
     *
     * A tie takes the LAST pen, not the first: the comparison is `cmp.w d0,d4
     * / blt`, which skips only when the incumbent is STRICTLY better.
     */
    'best pen': (_, a) => {
      const want = i0(a, 0)
      const s = rt.screen
      if (!s) return VI(0)
      const lo = a.length > 1 ? i0(a, 1) : 0
      const hi = a.length > 2 ? i0(a, 2) : (1 << s.rp.bitMap.depth) - 1
      if (lo < 0 || lo > 63 || hi < 0 || hi > 63 || hi < lo) amcafErr()
      const entry = (i: number): number => {
        if (i <= 31) return s.palette[i] ?? 0
        return ((s.palette[i - 32] ?? 0) & 0xeee) >> 1
      }
      let best = 0
      let bestD = 1000 // `move.l #$3e8,d4`
      for (let i = lo; i <= hi; i++) {
        const c = entry(i)
        if (c === want) return VI(i) // the exact match short-circuits
        const d =
          BEST_PEN_WEIGHT[Math.abs(rV(c) - rV(want))]! +
          BEST_PEN_WEIGHT[Math.abs(gV(c) - gV(want))]! +
          BEST_PEN_WEIGHT[Math.abs(bV(c) - bV(want))]!
        if (bestD >= d) {
          bestD = d
          best = i
        }
      }
      return VI(best)
    },

    /**
     * =Pal Get(palnr,index) — routine 337 ($74b4), Pal Set's twin with the
     * `move.w` the other way round. Same two bounds: palette 0..7, index
     * 0..31.
     */
    'pal get': (_, a) => {
      const pal = i0(a, 0)
      const idx = i0(a, 1)
      if (pal < 0 || pal > 7 || idx < 0 || idx > 31) amcafErr()
      return VI(rt.amcaf.palettes[pal]![idx]!)
    },

    /** =Ham Colour(c,oldrgb) — the colour a HAM pixel becomes */
    'ham colour': (_, a) => {
      const s = rt.screen
      return VI(hamApply(i0(a, 0) & 63, i0(a, 1), s ? s.palette : new Uint16Array(16)))
    },
    /** =Ham Best(newrgb,oldrgb) — the control byte that gets closest */
    'ham best': (_, a) => {
      const s = rt.screen
      return VI(hamBest(i0(a, 0), i0(a, 1), s ? s.palette : new Uint16Array(16)))
    },

    /**
     * =Ham Point(x,y) — the real colour at a point, which in HAM needs the
     * whole line before it. "Ham Point can access any point on the screen
     * indiviually without preprocessing", and "If the point x,y is not on the
     * screen, rgb will contain -1".
     */
    'ham point': (_, a) => {
      const x = i0(a, 0)
      const y = i0(a, 1)
      const s = rt.screen
      if (!s || x < 0 || y < 0 || x >= s.width || y >= s.height) return VI(-1)
      const px = s.rp.bitMap.pixels
      let rgb = s.palette[0] ?? 0
      for (let i = 0; i <= x; i++) rgb = hamApply(px[y * s.width + i]! & 63, rgb, s.palette)
      return VI(rgb)
    },


    /**
     * =Blitter Busy — "returns -1 (True), if the Blitter chip is currently
     * busy". Nothing here overlaps a blit with the program, so it never is.
     */
    'blitter busy': () => VI(0),

    /** =Turbo Point(x,y) — "Fast replacement for Point", clipped since V1.30 */
    'turbo point': (_, a) => {
      const v = rt.screen?.rp.point(i0(a, 0), i0(a, 1)) ?? -1
      return VI(v < 0 ? 0 : v)
    },

    /**
     * =X Raster / =Y Raster — the beam position in hardware coordinates.
     *
     * The manual is refreshingly honest about the value: "This value is not
     * very accurate because the raster beam is very fast, sigh."
     *
     * X (routine 192, $4f68) reads ONE byte, $dff007, and doubles it:
     *
     *     move.b $dff007.l, d3 / add.w d3, d3
     *
     * because HPOS counts colour clocks, which are two lores pixels each.
     *
     * Y (routine 193, $4f7e) is a NINE-bit read, and that is the part an
     * earlier pass got wrong:
     *
     *     lea.l $dff005.l, a0
     *     move.b (a0)+, d3      VPOSR's low byte — bit 0 is V8
     *     lsl.w  #8, d3
     *     move.b (a0), d3       VHPOSR's high byte — VPOS bits 7..0
     *
     * It was `(beamWord() >> 8) & 0x1ff`, and beamWord is sixteen bits, so
     * the shift left at most eight and bit 8 could never be set. On a
     * 312-line PAL frame that wrapped Y Raster at 256 — the machine's does
     * not, which is exactly what V8 is for.
     */
    'x raster': () => VI((rt.interp.beamWord() & 0xff) << 1),
    'y raster': () => VI(rt.interp.beamLine() & 0x1ff),

    /**
     * =Vclip(val,lower To upper) — the CLAMPING sibling of Vmod, which wraps.
     * The manual pairs them deliberately.
     */
    vclip: (_, a) => VI(Math.max(i0(a, 1), Math.min(i0(a, 2), i0(a, 0)))),

    /**
     * =Aga Detect — whether the machine has AGA.
     *
     * The modelled machine is an A1200, which does; the 256-colour screens
     * and the LOCT palette the AGA port added are what make that true here
     * rather than a claim.
     */
    'aga detect': () => VI(-1),

    /**
     * =Scrn Rastport / Bitmap / Layer / Layerinfo / Region.
     *
     * "Here are some more commands for Assembler and C freaks" — a program
     * gets the address of the current screen's structure to poke directly.
     *
     * NOTE: this port has a RastPort and a BitMap as objects, not as bytes at
     * an address a program could walk, and it models no Layer or LayerInfo at
     * all. Returning a plausible pointer would invite exactly the poking the
     * manual warns about, into memory whose layout is not the machine's, so
     * these answer 0 — which is also what a program checking before using one
     * would treat as "not available". APPROXIMATED.
     */
    'scrn rastport': () => VI(0),
    'scrn bitmap': () => VI(0),
    'scrn layer': () => VI(0),
    'scrn layerinfo': () => VI(0),
    'scrn region': () => VI(0),


    /**
     * =Count Pixels(screen,colour,x1,y1 To x2,y2) — note the sense, which the
     * manual states and the name does not: it "Counts the pixels ... that
     * DON'T have the colour index colour".
     */
    'count pixels': (_, a) => {
      const s = rt.screens.get(i0(a, 0))
      if (!s) return VI(0)
      const c = i0(a, 1)
      let n = 0
      for (let y = i0(a, 3); y <= i0(a, 5); y++) {
        for (let x = i0(a, 2); x <= i0(a, 4); x++) {
          const v = s.rp.point(x, y)
          if (v >= 0 && v !== c) n++
        }
      }
      return VI(n)
    },

    /**
     * =Font Style — "replaces the AMOS function Text Styles, because this one
     * does not return the multicoloured font bit (Bit 6). Apart from this,
     * Font Style is totally identical with the AMOS function."
     */
    /**
     * =Font Style — routine 145 ($40fe), seven instructions:
     *
     *   movea.l $52c(a5), a1     ; the current screen
     *   movea.l $148(a1), a1     ; its RastPort
     *   movea.l $34(a1), a1      ; rp_Font
     *   move.b  $17(a1), d3      ; the byte at TextFont + 23
     *
     * The manual: *"This function replaces the AMOS function Text Styles,
     * because this one does not return the multicoloured font bit (Bit 6).
     * Apart from this, Font Style is totally identical with the AMOS
     * function."*
     *
     * DEFECT: it reads the wrong byte, by one. AMOS's Text Styles is
     * `move.b 56(a1),d3` off the RastPort (`FnTextStyle`, +Lib.s:9896) — that
     * is rp_AlgoStyle, whose bits are UNDERLINED/BOLD/ITALIC/EXTENDED. The
     * "multicoloured font bit" is FSF_COLORFONT, bit 6 of **tf_Style**, which
     * is TextFont + 22 = $16. AMCAF reads TextFont + 23 = $17, which is
     * **tf_Flags** — ROMFONT/DISKFONT/REVPATH/TALLDOT/WIDEDOT/PROPORTIONAL/
     * DESIGNED/REMOVED, a different set of bits entirely.
     *
     * So it never returns the style at all, and bit 6 (FPF_DESIGNED) is set on
     * essentially every real font — which is probably why the mistake survived
     * three years of releases: the bit the manual promises always looks set.
     * Reproduced.
     */
    'font style': () => VI(rt.screen?.rp.font?.flags ?? 0),

    /**
     * =Cop Pos — "If you create your own copperlist, you can use this
     * function to remember the position of the next copper instruction."
     */
    'cop pos': () => VI(rt.copLogicAddr() + rt.copPos),

    /** =Splinters Active — how many splinters are still alive */
    'splinters active': () => VI(rt.amcaf.splinters.p.length),


    /**
     * =Vec Rot X/Y/Z — with three arguments they rotate a point and cache all
     * three results; with none they return the cached one.
     *
     * "This coordinate is automatically projected from 3D to 2D by dividing
     * it through the distance", which is the `Vec Rot Pos` z.
     *
     * NOTE: the rotation order was not recovered from the binary, and the
     * changelog records the author fixing it once ("There was a bug in the
     * vector rotation calculation with negative positions"), so the sign
     * conventions had at least one life before this one. X then Y then Z is
     * what this applies. APPROXIMATED.
     */
    'vec rot x': (_, a) => VI(vecRot(rt, a).x),
    'vec rot y': (_, a) => VI(vecRot(rt, a).y),
    'vec rot z': (_, a) => VI(vecRot(rt, a).z),

    /**
     * =Speek(address) — "exactly the AMOS function Peek. However, Bit 7 is
     * used as sign bit so the result will be a value between -128 and 127."
     *
     * One of the six armed contested names: Personnal has a Speek too.
     */
    speek: (_, a) => {
      const m = rt.resolveAddr(i0(a, 0))
      return VI(m ? ((m.data[m.off] ?? 0) << 24) >> 24 : 0)
    },
    /** =Sdeek(address) — the same idea a word wide, -32768..32767 */
    sdeek: (_, a) => {
      const m = rt.resolveAddr(i0(a, 0))
      if (!m) return VI(0)
      return VI(((((m.data[m.off] ?? 0) << 8) | (m.data[m.off + 1] ?? 0)) << 16) >> 16)
    },

    /**
     * =Amos Cli — "the number of the cli process out of which the program has
     * been started off or zero, if AMOS has been started from Workbench."
     *
     * Nothing started this from a CLI, so zero — which the manual gives a use
     * for: "This gives you the choice to either interprete options from the
     * command line or from the tool types of the appropriate icon."
     */
    'amos cli': () => VI(0),

    /**
     * =Amcaf Version$ — the extension's own version string.
     *
     * NOTE: the binary holds no printable text at all, so the string the
     * library returned was not recovered. This answers the identity the
     * registry holds, which is the question a program asking is really
     * asking. APPROXIMATED.
     */
    'amcaf version$': () => VS('AMCAF 1.50'),


    /**
     * The four-player adaptor: =Pjoy(j), =Pfire(j), =Pjup/Pjdown/Pjleft/Pjright.
     *
     * "Corresponds to the AMOS function Joy, with the difference, that one of
     * the parallel port joysticks is checked instead of the normal
     * joysticks", and the bit layout is the same JOY_* packing.
     *
     * NOTE: there is no adaptor. This is the same hardware Sticks models --
     * CIA-A PRB, the parallel port's data register -- and Sticks already
     * answers "no adaptor" honestly rather than pretending. These agree with
     * it: an unused port reads as nothing pressed. `j` must be 0 or 1.
     */
    pjoy: (_, a) => VI(fourPlayer(i0(a, 0)) & JOY_DIRECTIONS),
    pjup: (_, a) => VI(fourPlayer(i0(a, 0)) & JOY_UP ? -1 : 0),
    pjdown: (_, a) => VI(fourPlayer(i0(a, 0)) & JOY_DOWN ? -1 : 0),
    pjleft: (_, a) => VI(fourPlayer(i0(a, 0)) & JOY_LEFT ? -1 : 0),
    pjright: (_, a) => VI(fourPlayer(i0(a, 0)) & JOY_RIGHT ? -1 : 0),
    pfire: (_, a) => VI(fourPlayer(i0(a, 0)) & JOY_FIRE ? -1 : 0),

    /**
     * =Xfire(port,button) — a second or later fire button.
     *
     * "If the lowlevel-library is available, all the other buttons can be
     * checked aswell." lowlevel.library is not modelled, and a plain gameport
     * has one button, so anything past the first reads as not pressed. The
     * first is the ordinary fire the host already supplies.
     */
    xfire: (_, a) => {
      const port = i0(a, 0)
      if (port < 0 || port > MAX_PORT) amcafErr()
      const bits = port === PORT_MOUSE ? rt.input.joy0 : rt.input.joy
      return VI(i0(a, 1) <= 1 && joyFire(bits) ? -1 : 0)
    },

    /**
     * =X Smouse / =Y Smouse / =Smouse Key — the second mouse.
     *
     * NOTE: nothing drives a second mouse here, exactly as in the Sticks
     * port, where the manual is explicit that this is "not ... the AMOS
     * pointer". The position holds wherever a program last put it and the
     * buttons read as up.
     */
    'x smouse': () => VI(rt.amcaf.smouse.x),
    'y smouse': () => VI(rt.amcaf.smouse.y),
    'smouse key': () => VI(0),


    /** =Pt Cpos — "the current 'row' ... a number between 0 and 63" */
    'pt cpos': () => VI(rt.amcaf.pt.row & 63),
    /** =Pt Cpattern — the song position being played */
    'pt cpattern': () => VI(rt.amcaf.pt.pos),
    /**
     * =Pt Cnote(chan) — "the frequency of an instrument being played on music
     * channel chan at that very moment", NOT a note number.
     *
     * Routine 229 ($5dc6) range-checks first — `Rbmi 372` on negative and
     * `cmp.b #4 / Rbge 372` — then indexes the replayer's per-channel state
     * at 44 ($2c) bytes a channel, reads the period WORD at +$10, returns 0
     * if it is zero, and otherwise divides:
     *
     *     move.l #$369e99, d0 / divu.w d0, d3
     *
     * $369E99 is 3,579,545 — the NTSC Paula clock — so the answer is a
     * sample rate in Hz, and it uses the NTSC constant whatever the machine.
     *
     * APPROXIMATED, and the reason is structural rather than arithmetic: this
     * port starts a module but does not step its patterns, so there is no
     * live period to divide. The range check and the error are reproduced;
     * the value is whatever was last triggered.
     */
    'pt cnote': (_, a) => VI(rt.amcaf.pt.note[ptChan(i0(a, 0))] ?? 0),
    /**
     * =Pt Cinstr(chan) — "a value between 0 and 31, whereas 0 tells you that
     * no sample has been trigged".
     *
     * Routine 228 ($5d94), the same range check, then `move.b $2(a0,d7.w),d3`
     * and `lsr.w #4`. NOTE: a byte shifted right by four can only produce
     * 0..15, so the routine cannot return the 16..31 its own manual promises
     * — the high bit of a ProTracker instrument number lives in the other
     * half of the note word. Recorded rather than corrected: the port has no
     * live channel state to read either way. APPROXIMATED.
     */
    'pt cinstr': (_, a) => VI(rt.amcaf.pt.instr[ptChan(i0(a, 0))] ?? 0),

    /**
     * =Pt Vu(channel) — "the current volume of channel number 'channel'. If a
     * new note is played, 'vol' contains the volume level else 0."
     *
     * So it is a note-on latch rather than a live meter, the same shape as
     * AMOS's own Vumeter.
     */
    'pt vu': (_, a) => {
      const c = i0(a, 0) & 3
      const v = rt.amcaf.pt.vu[c] ?? 0
      rt.amcaf.pt.vu[c] = 0
      return VI(v)
    },

    /**
     * =Pt Signal — the module's own effect commands surfacing to the program.
     *
     * The changelog pins one value: "When reaching the end of a song, Pt
     * Signal now reports $FF."
     */
    'pt signal': () => {
      // Routine 254 ($62e0) CLEARS the byte as it reads it —
      // `move.b $2(a0),d3 / clr.b $2(a0)` — so a signal is consumed by the
      // first read and a second one gives 0. Pt Vu (255) has the same shape
      // and this port already had that one; this one it did not.
      const v = rt.amcaf.pt.signal
      rt.amcaf.pt.signal = 0
      return VI(v)
    },

    /**
     * =Rnp — the dead half of the RNC pair. 1.50's routine 277 ($63c6) is a
     * bare `rts`, so it hands back whatever the result register held; 0 is the
     * only answer this port can give for that. See `rnc unpack` for why these
     * are stubs rather than a decompressor.
     */
    rnp: () => VI(0),

    /** =Pt Data Base — the replayer's data block, for the assembler crowd */
    'pt data base': () => VI(0),

    /** =Pt Instr Address(n) / =Pt Instr Length(n) — a module sample in memory */
    'pt instr address': (_, a) => {
      const b = rt.memBanks.get(rt.amcaf.pt.bank)
      if (!b) return VI(0)
      const inst = modSample(b.data, i0(a, 0))
      return VI(inst ? rt.bankBase(rt.amcaf.pt.bank) + inst.off : 0)
    },
    'pt instr length': (_, a) => {
      const b = rt.memBanks.get(rt.amcaf.pt.bank)
      if (!b) return VI(0)
      return VI(modSample(b.data, i0(a, 0))?.len ?? 0)
    },

    /**
     * =Pt Free Voice[(n)] — which voices the music is not using.
     *
     * A 1.50 addition with no manual entry: DISASSEMBLY tier by the author's
     * own "You'll have to find out the new commands since V1.40 yourself".
     * With an argument it answers for one voice, without it returns the first
     * free one or -1.
     */
    'pt free voice': (_, a) => {
      const pt = rt.amcaf.pt
      const isFree = (v: number): boolean => !pt.playing || (pt.voices & (1 << v)) === 0
      if (a.length > 0) return VI(isFree(i0(a, 0) & 3) ? -1 : 0)
      for (let v = 0; v < 4; v++) if (isFree(v)) return VI(v)
      return VI(-1)
    },


    /**
     * =Amcaf Base / =Amcaf Length — the extension's data block.
     *
     * "Gives back the address of the AMCAF data base" and its size, for the
     * "Assembler and C freaks" the manual addresses. NOTE: the state here is
     * TypeScript objects rather than a $23b6-byte block at an address — the
     * init routine allocates exactly that much — so the length is real and
     * the address is 0, the same choice the Scrn pointers made. APPROXIMATED.
     */
    'amcaf base': () => VI(0),
    'amcaf length': () => VI(0x23b6),

    /**
     * =Amos Task — "Returns the address of the AMOS task structure".
     *
     * There is one task and no exec task structure to point at. 0, like the
     * other pointer-into-the-machine functions.
     */
    'amos task': () => VI(0),

    /**
     * =Extpath$(name$) — where an extension was loaded from.
     *
     * Extensions here are compiled-in ports rather than files loaded off a
     * disk, so there is no path. The empty string is what the machine returns
     * for a slot that holds nothing, which is the nearest true answer.
     */
    'extpath$': () => VS(''),

    /** =Nfn — routine 22. "returns nothing useful ... used in speed testing" */
    nfn: () => VI(0),

    /**
     * =Cpu — routine 216 ($5026). Reads ExecBase+$128 (AttnFlags) and maps
     * the bits onto 68000/68010/68020/68030/68040/68060, cleverly: d3 starts
     * as the LONGWORD $109a0 (68000 decimal) and each hit overwrites only the
     * low WORD, so $9b4 turns it into $109b4 = 68020.
     *
     * The modelled machine is an A1200, which is AttnFlags bit 1 — the same
     * identity Jd Cpu reports and the same one the 2MB chip / fast-board
     * memory pools answer for.
     */
    cpu: () => VI(68020),

    /**
     * =Fpu — routine 217. Zero when nothing is fitted, which is the A1200 as
     * modelled; Jd Fpu agrees.
     */
    fpu: () => VI(0),

    /** =Even(v) — routine 193 ($4c9a): `btst #0` and -1 when the bit is clear */
    even: (_, a) => VI((i0(a, 0) & 1) === 0 ? -1 : 0),
    /** =Odd(v) — routine 192, the same test the other way up */
    odd: (_, a) => VI((i0(a, 0) & 1) !== 0 ? -1 : 0),

    /** =Wordswap(v) — routine 198 ($4cf6): one `swap d3` */
    wordswap: (_, a) => {
      const v = i0(a, 0)
      return VI(((v >>> 16) | (v << 16)) | 0)
    },

    /**
     * =Lsl(v,n) — routine 196 ($4ce2): `asl.l d0,d3`.
     *
     * The manual says "Rotates the number 'v' to the left", which it does not;
     * it shifts, and bits leaving the top are lost. Its own worked
     * description ("v*2 ... v*4 ... v*8") is the shift, so the word "rotates"
     * is loose writing rather than a second behaviour.
     */
    lsl: (_, a) => VI((i0(a, 0) << (i0(a, 1) & 63)) | 0),

    /**
     * =Lsr(v,n) — routine 197 ($4cec).
     *
     * DEVIATION: the keyword is named for a LOGICAL shift and the instruction
     * is `asr.l`, an arithmetic one, so the sign bit is replicated and a
     * negative value stays negative. That is the library's choice, and
     * it also makes the manual's claim — "does the same as a division by 2^n"
     * — false for negatives, because ASR rounds toward minus infinity where
     * division rounds toward zero. Lsr(-3,1) is -2, not -1. Reproduced.
     */
    lsr: (_, a) => VI(i0(a, 0) >> (i0(a, 1) & 63)),

    /**
     * =Binexp(a) — routine 194. 2^a, and the manual bounds a to 0..31.
     * A shift of 32 or more is undefined on the 68000 and meaningless here,
     * so the documented range is enforced.
     */
    binexp: (_, a) => {
      const n = i0(a, 0)
      if (n < 0 || n > 31) amcafErr()
      return VI((1 << n) | 0)
    },

    /**
     * =Binlog(v) — routine 195 ($4cc2), and the routine is the specification.
     *
     * Zero errors immediately (`Rbeq`). Otherwise it shifts right counting
     * until bit 0 is set, shifts once more, and errors if ANYTHING is left
     * (`tst.l d0 / Rbne`) — so a value that is not exactly a power of two is
     * an error rather than a floor, which is what the manual promises.
     */
    binlog: (_, a) => {
      const v = i0(a, 0) >>> 0
      if (v === 0 || (v & (v - 1)) !== 0) amcafErr()
      return VI(31 - Math.clz32(v))
    },

    /**
     * =Qsqr(v) — routine 271 ($6286): integer square root by Newton's method
     * over a scaled start, no maths library involved.
     *
     * Zero returns zero before anything else; a negative value takes the
     * `Rbmi` error branch.
     */
    qsqr: (_, a) => {
      const v = i0(a, 0)
      if (v === 0) return VI(0)
      if (v < 0) amcafErr()
      return VI(Math.floor(Math.sqrt(v)))
    },

    /**
     * =Qrnd(max) — routine 258 ($63f0), and the manual is wrong about it.
     *
     * "Totally identical to the Rnd function, with the only difference, that
     * this one is much faster" — so an earlier pass routed it to AMOS's own
     * generator. It is a different generator entirely:
     *
     *     move.w $dff006.l, d0
     *     add.w  d0, $292(a2)        stir the seed with the BEAM
     *     move.l (a3)+, d0 / beq     Qrnd(0) -> the last result at $294
     *     move.w $292(a2), d3
     *     moveq  #$f, d1
     *     lsr.w  #1, d3              15 bits of seed
     *     mulu.w d0, d3              times max, 32 bits wide
     *     lsr.l  d1, d3              back down by 15
     *     addx.l d2, d3              plus the bit that fell out: rounding
     *     move.w d3, $294(a2)
     *
     * so it is a scale-a-15-bit-fraction idiom rather than a linear
     * congruential step, and its randomness comes entirely from where the
     * raster happened to be. This port models the beam deterministically, so
     * the sequence is reproduced exactly rather than approximated — the same
     * argument Stars' nextRandom already makes.
     *
     * Qrnd(0) returning the previous result is the one thing it does share
     * with Rnd, and the seed is stirred even on that path.
     */
    qrnd: (it, a) => {
      const st = rt.amcaf
      // the seed is stirred by VHPOSR on EVERY call, including Qrnd(0)
      st.qseed = (st.qseed + it.beamWord()) & 0xffff
      const n = i0(a, 0) & 0xffff
      if (n === 0) return VI(st.qlast)
      const prod = (st.qseed >>> 1) * n
      st.qlast = ((prod >>> 15) + ((prod >>> 14) & 1)) & 0xffff
      return VI(st.qlast)
    },

    /** =Qsin(angle,radius) — routine 274 ($6326); 1024 units to the turn */
    qsin: (_, a) => VI(qtrig(i0(a, 0), i0(a, 1), 0)),
    /** =Qcos(angle,radius) — routine 273, a quarter turn ahead of Qsin */
    qcos: (_, a) => VI(qtrig(i0(a, 0), i0(a, 1), 256)),

    /**
     * =Qarc(deltax,deltay) — routine 261 ($646c). The inverse of the pair:
     * the angle to a relative point, in the same 1024-to-the-turn units,
     * "normally used for all kinds of 'aiming-at' routines".
     *
     * A table lookup, not an arctangent. The routine divides the SMALLER
     * magnitude by the larger to get a ratio in $0..$200, indexes the 513-byte
     * table at $69a(a2), and fixes up the quadrant afterwards:
     *
     *     cmp.l d5,d4 / bpl        |dx| >= |dy| ?
     *     lsl.l #8,d4 / add.l d4,d4 / divu.w d5,d4      ratio = (min<<9)/max
     *     move.b (a0,d4.w),d3      the table is BYTES
     *     neg.w d3 / addi.w #$100,d3   the steep half mirrors about 256
     *
     * An earlier pass used `Math.atan2` with `Math.round`, which is a
     * different function: the shipped table is floor(atan(i/512)*1024/2pi) at
     * all 513 entries, so rounding disagreed across most of the circle.
     *
     * DEFECT: the quadrant is decided by `tst.w`, a WORD test, while the
     * magnitudes were taken as longs. A delta whose low word looks positive
     * but whose long is negative — 65536 and beyond — lands in the wrong
     * quadrant. Reproduced.
     */
    qarc: (_, a) => {
      const dx = i0(a, 0) | 0
      const dy = i0(a, 1) | 0
      if (dx === 0 && extW(dy) === 0) return VI(0)
      const ax = Math.abs(dx)
      const ay = Math.abs(dy)
      let d3: number
      if (ax < ay) d3 = 256 - QARC[Math.floor((ax * 512) / ay)]!
      else d3 = QARC[Math.floor((ay * 512) / ax)]!
      if (extW(dx) < 0) d3 = extW(dy) < 0 ? d3 - 512 : 512 - d3
      else if (extW(dy) < 0) d3 = -d3
      return VI(d3 & 0x3ff)
    },

    /**
     * =Vin(val,lower To upper) — routine 184. True when the value lies
     * within the bounds, which the manual introduces with a joke about wine.
     */
    vin: (_, a) => {
      const v = i0(a, 0)
      return VI(v >= i0(a, 1) && v <= i0(a, 2) ? -1 : 0)
    },

    /**
     * =Vmod(val,upper) and =Vmod(val,lower To upper) — routines 185 and 186
     * ($49e6), two token forms of one idea.
     *
     * It WRAPS rather than clamping, which is what separates it from Vclip:
     * "If val exceeds upper by 1, it will be set to lower, if it exceeds
     * upper by 2, it will be set to lower+1. If it goes deeper than lower by
     * 1, it will be set to upper and so on." The routine divides by
     * `upper+1`, so the span is inclusive of both ends, and it takes the
     * `Rbmi` error branch on a negative upper bound.
     *
     * NOTE: the disassembly of the two-bound form runs into data the
     * disassembler renders as `dc.b "BCHCNuD"` and could not be read
     * straight through. The single-bound path is legible and the two-bound
     * one is implemented from the manual's worked description above.
     */
    vmod: (_, a) => {
      const v = i0(a, 0)
      const lower = a.length > 2 ? i0(a, 1) : 0
      const upper = a.length > 2 ? i0(a, 2) : i0(a, 1)
      if (upper < lower) amcafErr()
      const span = upper - lower + 1
      return VI(lower + (((v - lower) % span) + span) % span)
    },
  }
}
