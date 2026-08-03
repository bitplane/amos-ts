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
import { AmigaFS } from '../amiga/vfs'
import type { Screen } from './screen'
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
/**
 * The FileInfoBlock the extension keeps at $100 of its private block, which
 * is the ONLY thing the `Object *` accessors read.
 *
 * The offsets in the routines are that base plus the AmigaDOS field offsets:
 * $104 = fib+4 fib_DirEntryType, $108 = fib+8 fib_FileName, $174 = fib+116
 * fib_Protection, $17c = fib+124 fib_Size, $180 = fib+128 fib_NumBlocks,
 * $184 = fib+132 fib_Date.
 *
 * Keeping a snapshot rather than a path is the whole point: Examine fills the
 * block once and the accessors read it back with no filesystem access at all,
 * so they answer for the object as it was when it was examined even if it has
 * since changed or gone.
 */
export interface AmcafFib {
  type: number
  name: string
  protection: number
  size: number
  blocks: number
  days: number
  mins: number
  ticks: number
  comment: string
}

/** what the block holds before any Examine has filled it in */
export const EMPTY_FIB: AmcafFib = {
  type: 0,
  name: '',
  protection: 0,
  size: 0,
  blocks: 0,
  days: 0,
  mins: 0,
  ticks: 0,
  comment: '',
}

export interface AmcafExamine {
  /** the directory being walked, or '' after Examine Stop */
  dir: string
  entries: string[]
  index: number
  /** the path the accessors currently answer for */
  current: string
  /** the block Examine filled in, which is what the accessors read */
  fib: AmcafFib
}


/**
 * Splinters: pixels lifted off a picture that keep the colour they took.
 *
 * "Splinters are similar to Td Stars, but they don't destroy the background
 * and use the colour of the pixel they have removed and Splinters require a
 * list of coordinates. Each coordinate requires four bytes, i.e already a
 * field of 16x16 coordinates consumes 16 KB of memory."
 *
 * THE PARTICLES ARE NOT HERE. "Each Splinter requires 22 bytes of memory" in
 * the bank `Splinters Bank` reserves, and that bank is the whole engine's
 * working store — every one of the nine routines walks it with a `dbra` and
 * reads and writes the 22-byte records in place. See `SPL_*` below for the
 * layout, which comes out of routines 385 and 386.
 *
 * What this holds is the rest of the extension's private block: the fields
 * from `$266` to `$282`. Each is named with its offset, because they are the
 * engine's only other state and several of them are read by routines that
 * never mention the keyword that set them.
 *
 * AllocMem inside routine 0, at $1c32, passes `#$10001` — MEMF_PUBLIC|MEMF_CLEAR —
 * so every one of these starts at ZERO, and the zeros matter: an untouched
 * limit box is `0,0 To 0,0`, which routine 386 treats as "nowhere", and an
 * untouched `maxNew` is zero, which stops routine 385 from ever spawning.
 * A program that forgets Splinters Limit gets nothing on the machine too.
 */
export interface SplinterState {
  /** `$26a` — the bank holding the 22-byte records; 0 before Splinters Bank */
  bank: number
  /** `$280` + 1: how many records the table holds */
  max: number
  /**
   * `$266` — the pointer Coords Bank stores. The coordinates themselves live
   * in the bank and nowhere else; there is no parallel copy, because routine
   * 385 hands them out by advancing the cursor and offset in the bank's own
   * header.
   */
  coordsBank: number
  /**
   * `$26e`/`$270`/`$272`/`$274`, in SIXTEENTHS of a pixel — the same units the
   * positions are in. Routine 386 tests `bmi` against the low pair and `bpl`
   * against the high, so x1/y1 are inclusive and x2/y2 EXCLUSIVE.
   */
  limit: { x1: number; y1: number; x2: number; y2: number }
  /** `$276`/`$278` — sixteenths added to the speed each step, not pixels */
  gx: number
  gy: number
  /** `$27e` — the life a respawned splinter starts with, counted down by 386 */
  fuel: number
  /** `$282` — how many splinters may respawn in ONE Move; -1 is $ffff, so 65535 */
  maxNew: number
  /** `$27a` — "what a lifted dot leaves behind", written by the Del routines */
  bkColour: number
  /** `$27c` — the TOP plane the engine touches, stored as `planes - 1` */
  topPlane: number
}

/**
 * Td Stars: a 3D starfield, "Each star consumes 12 bytes of memory".
 *
 * Unlike Splinters these DO destroy the background, which is why the manual
 * pairs Draw with a matching Del rather than saving anything — and, like
 * Splinters, the stars live in the bank rather than here. See `TD_*` below.
 *
 * THERE IS NO Z. A twelve-byte star is a position, the position before it and
 * a speed, and the depth is entirely an illusion built from the speed:
 * routine 388 multiplies the speed by 17/16 every step when Accelerate is on,
 * and routine 319 draws a star's BRIGHTNESS from how fast it is going. A star
 * that has been running longer is faster, so it is brighter and moving further
 * each frame — which reads as "coming towards you" without a third axis
 * anywhere. The port had a `z` and scaled the speed by it, which is a
 * different way to get a similar picture and matches none of the arithmetic.
 *
 * Everything here is a field of the same MEMF_CLEAR block Splinters uses, so
 * all of it starts at zero — including the limit box, which routine 388 then
 * treats as nowhere.
 */
export interface TdStarState {
  /** `$24a` — the bank holding the 12-byte records; 0 before Td Stars Bank */
  bank: number
  /** `$264` + 1 */
  max: number
  /**
   * `$24e`..`$254`, in SIXTY-FOURTHS of a pixel. Routine 388 compares with
   * `bcs`/`bcc` — UNSIGNED, where Splinters uses signed `bmi`/`bpl` — so a
   * negative position does not sort below x1, it sorts above x2.
   */
  limit: { x1: number; y1: number; x2: number; y2: number }
  /** `$25a`/`$25c` — added to the speed each step, raw sixty-fourths */
  gx: number
  gy: number
  /** `$25e` — a WORD, though Accelerate On writes only its high byte */
  accelerate: number
  /** `$256`/`$258` — where a star is (re)born, in sixty-fourths */
  ox: number
  oy: number
  /**
   * `$260`/`$262` — the two planes Td Stars Planes named, each stored
   * MULTIPLIED BY FOUR, because that is the offset of a plane pointer in the
   * screen structure and routine 319 indexes with it directly.
   */
  planeA: number
  planeB: number
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
  /**
   * Vec Rot's block, `$300`..`$32e`, and the shape of it is the point.
   *
   * The angles are NOT used by the projection. Routine 373 reads only the
   * nine-word MATRIX at `$31e`, and the only thing that writes that matrix is
   * Vec Rot Precalc. So an angle set and not followed by a Precalc has no
   * effect at all, and a program that never calls Precalc projects through
   * the all-zero matrix the cleared block starts with. The port used to
   * recompute from the angles on every call, which quietly made Precalc
   * unnecessary — see the keyword.
   */
  vec: {
    /** `$300`/`$302`/`$304` — Vec Rot Pos, added AFTER the rotation */
    px: number
    py: number
    pz: number
    /**
     * `$306`/`$308`/`$30a` — the angles, masked to 1023 and DOUBLED, because
     * they are byte offsets into a 1024-entry word table. `$306` takes the
     * LAST argument of the three.
     */
    angA: number
    angB: number
    angC: number
    /** `$31e`..`$32e` — the nine-word rotation matrix Precalc builds */
    m: Int16Array
    /** `$30c`/`$30e`/`$310` — the last projection, which the bare forms read */
    x: number
    y: number
    z: number
  }
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
    examine: { dir: '', entries: [], index: -1, current: '', fib: EMPTY_FIB },
    ioError: 0,
    notationBits: 4,
    shadePlanes: 6,
    shadeMask: true,
    qseed: 0,
    qlast: 0,
    bltLimit: null,
    ptileBank: 0,
    // every one of these is a field of the MEMF_CLEAR block, so zero
    splinters: {
      bank: 0, max: 0, coordsBank: 0,
      limit: { x1: 0, y1: 0, x2: 0, y2: 0 },
      gx: 0, gy: 0, fuel: 0, maxNew: 0, bkColour: 0, topPlane: 0,
    },
    // as for Splinters, every one of these is a field of the cleared block
    stars: {
      bank: 0, max: 0, limit: { x1: 0, y1: 0, x2: 0, y2: 0 },
      gx: 0, gy: 0, accelerate: 0, ox: 0, oy: 0, planeA: 0, planeB: 0,
    },
    smouse: { x: 0, y: 0, speed: 1, limit: null },
    pt: {
      bank: 0, samBank: 0, playing: false, pos: 0, row: 0, tick: 0,
      speed: 6, bpm: 125, cia: true, volume: 64, voices: 0b1111,
      signal: 0, vu: [0, 0, 0, 0], note: [0, 0, 0, 0], instr: [0, 0, 0, 0],
      free: [true, true, true, true],
    },
    // MEMF_CLEAR again, matrix included: without a Vec Rot Precalc the
    // projection runs through all nine zeros, exactly as it does on the machine
    vec: { px: 0, py: 0, pz: 0, angA: 0, angB: 0, angC: 0, m: new Int16Array(9), x: 0, y: 0, z: 0 },
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
        rt.amcaf.examine = { dir: '', entries: [], index: -1, current: '', fib: EMPTY_FIB }
        rt.amcaf.ioError = 212 // ERROR_OBJECT_WRONG_TYPE
        amcafExamineErr()
      }
      const entries = rt.vfs?.listDir(dir) ?? []
      rt.amcaf.examine = {
        dir,
        entries: entries.map((e) => e.name),
        index: -1,
        current: dir,
        fib: captureFib(rt, dir),
      }
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
      rt.amcaf.examine.fib = captureFib(rt, path)
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
      rt.amcaf.examine = { dir: '', entries: [], index: -1, current: '', fib: EMPTY_FIB }
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
     * Routine 79 is a four-byte `Rbra routine 356`; 356 ($7f10) is 690 bytes
     * and does far more than remap. It reads a pixel out of the source's
     * planes, resolves it to an RGB through the SOURCE's palette, adds the
     * three nibbles, scales the sum by the destination's depth and looks the
     * result up in a ramp table it builds on the stack frame each call:
     *
     *     moveq #$0,d0 / moveq #$3f,d1
     *   L:move.b d0,(a0)+ / move.b d0,(a0)+ / addq.b #$1,d0 / move.b d0,(a0)+
     *     dbra d1,L
     *
     * 64 passes of `k, k, k+1` at $21b2, so entry i is i/3 ROUNDED TO NEAREST
     * — the same round-not-floor idiom that C2p Fire's table turned out to
     * use. Three nibbles summed and divided by three is a flat average of R, G
     * and B, not a weighted luma; an earlier pass used the usual 77/151/28
     * weights and also rewrote the destination's palette into a grey ramp,
     * which this routine never touches. It also wrote the chunky cache and
     * then called `invalidate()`, which threw the whole conversion away.
     *
     * Three source paths, chosen once by `move.w $50(a1),d5 / subq.w #$1,d5 /
     * cmp.w #$5,d5` and then `move.w $48(a1),d0 / btst #$b,d0`:
     *
     *   - a six-plane HAM source decodes hold-and-modify inline ($811c), the
     *     hold starting each ROW from `move.w $62(a1),d5`, palette entry 0
     *   - a six-plane non-HAM source is EHB, and colours 32..63 read
     *     `$22(a1,d3.w)` with d3 = colour*2, which is palette[colour-32], then
     *     divide by SIXTEEN rather than eight — that `lsr.w #$4,d3` against
     *     the other paths' `lsr.w #$3,d3` is the half-brightness
     *   - anything else is a plain palette lookup at `$62(a1,d3.w)`
     */
    'convert grey'(it) {
      const src = rt.screens.get(it.evalInt())
      it.expect('to')
      const dst = rt.screens.get(it.evalInt())
      if (!src || !dst) amcafErr()
      const ramp = new Uint8Array(192)
      for (let k = 0, i = 0; k < 64; k++) {
        ramp[i++] = k
        ramp[i++] = k
        ramp[i++] = k + 1
      }
      // `move.w $2(a7),d4 / lsl.w d4,d3` — the destination's depth LESS ONE
      const shift = dst.rp.bitMap.depth - 1
      const keep = (1 << dst.rp.bitMap.depth) - 1
      const deep = src.rp.bitMap.depth === 6
      const sp = src.rp.bitMap.pixels
      const dp = dst.rp.bitMap.pixelsW()
      const w = Math.min(src.width, dst.width)
      const h = Math.min(src.height, dst.height)
      for (let y = 0; y < h; y++) {
        let hold = src.palette[0] ?? 0
        for (let x = 0; x < w; x++) {
          const c = sp[y * src.width + x]!
          let rgb = src.palette[c] ?? 0
          let half = false
          if (deep && src.ham) {
            // the byte-width masks are why green leaves red alone
            if (c < 0x10) hold = src.palette[c] ?? 0
            else if (c < 0x20) hold = (hold & 0xff0) | (c & 15)
            else if (c < 0x30) hold = (hold & 0x0ff) | ((c & 15) << 8)
            else hold = (hold & 0xf0f) | ((c & 15) << 4)
            rgb = hold
          } else if (deep && c > 31) {
            rgb = src.palette[c - 32] ?? 0
            half = true
          }
          const sum = rV(rgb) + gV(rgb) + bV(rgb)
          dp[y * dst.width + x] = (ramp[(sum << shift) >> (half ? 4 : 3)] ?? 0) & keep
        }
      }
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
      // `move.w $48(a0),d0 / btst #$b,d0 / Rbeq routine 390` — bit 11 of the
      // screen's mode is HAM, and a screen without it is an error rather than
      // a no-op. An earlier pass had no check here at all.
      if (!s.ham) amcafErr()

      // `moveq #$f,d7` — SIXTEEN entries, not the whole palette
      for (let i = 0; i < 16; i++) {
        const c = s.palette[i]!
        s.palette[i] = glue(Math.max(0, rV(c) - 1), Math.max(0, gV(c) - 1), Math.max(0, bV(c) - 1))
      }

      /*
       * And then the half that was missing, which is what "a modified Shade
       * Bobs routine" in the manual actually refers to: the MODIFY NIBBLES in
       * the bitmap are darkened too, six planes at a time —
       *
       *   move.l (a5)+,d0 / or.l (a6)+,d0        control bits: is it a modify?
       *   move.l (a1),d1 / or.l (a2)... (a4)     is the nibble non-zero?
       *   and.l d1,d0                            decrement only where both
       *   eor.l d0,d2 / move.l d2,(a1)+          plane 0 flips
       *   and.l d2,d0 / eor.l d0,d3 ...          borrow into planes 1, 2, 3
       *
       * a bitwise 4-bit decrement with borrow. Fading only the palette leaves
       * every modify pixel at its original brightness, so the manual's "after
       * calling it 16 times, the Ham screen is completely black" would not
       * have held on a picture that uses any.
       *
       * NOTE: the walk is a flat longword count, `(($4c(a0) >> 5) * $4e(a0))`,
       * so on a screen whose width is not a multiple of 32 it covers less than
       * the bitmap and drifts out of step with the rows. Reproduced as-is —
       * the pixel order of a plane is the pixel order of the chunky cache
       * while the row length is a whole number of bytes.
       */
      const px = s.rp.bitMap.pixelsW()
      const n = (s.width >> 5) * s.height * 32
      for (let i = 0; i < n; i++) {
        const p = px[i]!
        if ((p & 0x30) !== 0 && (p & 0x0f) !== 0) px[i] = p - 1
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
      /*
       * Routine 201 ($4d18): the rainbow number is bounded to 0..3 before
       * anything else — `Rbmi routine 390` then `cmp.w #$4,d0 / Rbge routine
       * 390` — and the colour lands at `+$8` of a 24-byte record in AMOS's
       * own rainbow table at `-$868(a5)`, walked `lea $18(a1),a1` at a time.
       * Four rainbows, which is what AMOS has.
       */
      const n = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      if (n < 0 || n >= 4) amcafErr()
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
      /*
       * A `!` multi-arity entry: id $1348 spec `I0,0` is routine 202 ($4d40)
       * and id $135c spec `I0t0` is routine 203 ($4dd0).
       *
       * Both bound the rainbow number to 0..3 the way Set Rain Colour does,
       * and routine 203 adds one more check the port did not have:
       *
       *     cmp.w d0,d1 / Rbeq routine 390
       *
       * — fading a rainbow TO ITSELF is error 23, not a no-op. Routine 202
       * also refuses a rainbow whose length word at `+$a` is zero.
       *
       * The step is one unit per gun per call, compared a nibble at a time
       * (`andi.w #$f00` then `subi.w #$100` or `addi.w #$100`), which is what
       * the manual means by "Rain Fade works step by step only. Therefore you
       * need a maximum of 16 calls to reach the new colour values".
       */
      const n = it.evalInt()
      if (n < 0 || n >= 4) amcafErr()
      const rb = rt.rainbows.get(n)
      if (it.accept('to')) {
        const t = it.evalInt()
        if (t < 0 || t >= 4 || t === n) amcafErr()
        const target = rt.rainbows.get(t)
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
      // routine 75's region decode is routine 71's, so the same word
      // granularity, exclusive far corner and silent bail — see amcafRegion
      const box = amcafRegion(x1, y1, x2, y2)
      if (!box) return
      const bpr = src.bm.bytesPerRow
      const b1 = Math.max(0, box.x >> 3)
      const b2 = Math.min(bpr, (box.x + box.w) >> 3)
      for (let y = Math.max(0, box.y); y < Math.min(src.bm.height, box.y + box.h); y++) {
        const row = src.planes.subarray(src.base + y * bpr + b1, src.base + y * bpr + b2)
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
    /*
     * Routines 208 ($4f04) and 209 ($4f18), twenty bytes each, and each does
     * TWO things:
     *
     *     move.w #$0,$dff1dc.l        BEAMCON0: 0 is NTSC, $20 is PAL
     *     movea.l $4.w,a0
     *     move.b #$3c,$212(a0)        ExecBase->VBlankFrequency: 60 or 50
     *
     * DEVIATION: only the BEAMCON0 half is reproduced. `$212(a0)` is a field
     * of the real ExecBase, which this port does not model as memory — and
     * nothing here reads a frame rate from it, because the interpreter's tick
     * is its own clock. A program that pokes ExecBase to find out would see
     * the old value on the machine change and here not.
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
      /*
       * TWO token entries under the SAME name, not a `!` multi-arity pair:
       * id $0346 spec `I0` is routine 206 ($4eba) and id $0358 spec `I0,0` is
       * routine 207 ($4ed8). The one-argument form spins on the vertical
       * beam alone; the two-argument form then spins on the horizontal.
       *
       *     lea    $dff004.l,a0            VPOSR/VHPOSR as a long
       *     move.l (a0),d0 / lsr.l #$8,d0  the vertical position
       *     cmp.w  d3,d0 / blt (loop)      wait for the line
       *     move.b (a1),d0 / cmp.b d2,d0 / blt (loop)    then the column
       *
       * `lsr.l #$1,d2` halves the x argument, because VHPOSR counts colour
       * clocks and the manual's x is in lowres pixels; and d3 is the LAST
       * argument, so `Raster Wait x,y` waits for line y at column x.
       *
       * DEVIATION: this port has no beam to spin on inside a keyword — the
       * modelled VHPOSR only advances between statements — so both forms wait
       * one frame instead. A program using Raster Wait to split a copper
       * effect mid-frame gets frame granularity here.
       */
      it.evalInt()
      if (it.accept(',')) it.evalInt()
      it.block({ type: 'wait', until: it.tick + 1 })
    },

    /**
     * Set Sprite Priority n — routine 210 ($4f2c), sixteen bytes:
     *
     *     move.l  (a3)+, d0
     *     movea.l $52c(a5), a0        the CURRENT screen
     *     andi.w  #$3f, d0
     *     move.w  d0, $4a(a0)
     *
     * "Changes the sprite priority in Dual playfield mode", which is BPLCON2's
     * PF1P0-2 and PF2P0-2 fields — and it is PER SCREEN, at `$4a` of the
     * screen structure, two words before the width at `$4c`. The port kept it
     * as one global, so two screens could not differ.
     *
     * NOTE: the screen pointer is not tested. With none open the routine
     * writes through null; the port drops the write.
     */
    'set sprite priority'(it) {
      const n = it.evalInt() & 0x3f
      const s = rt.screen
      if (s) s.spritePriority = n
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
     * Mask Copy — THREE token entries and three routines. The table carries
     * `!mask copy` (id $086c, spec `I0t0,0`, routine 174) and two empty-named
     * continuations: `I0,0,0,0,0t0,0,0,0` (routine 175) and
     * `I0,0,0,0,0t0,0,0,0,0` (routine 176). An earlier pass implemented only
     * the middle one, made its mask optional, and never parsed the minterm.
     *
     * All three end in the same OS call:
     *
     *     movea.l -$18ae(a5), a6      graphics.library
     *     jsr     -$27c(a6)           BltMaskBitMapRastPort
     *
     * with a0 = the source's BitMap ($150), a1 = the destination's RastPort
     * ($148), a2 = the mask, d0/d1 = xSrc/ySrc, d2/d3 = xDest/yDest,
     * d4/d5 = xSize/ySize and d6 = the minterm. "just like Screen Copy.
     * However, a mask bitplane can be given" — a set mask bit lets the source
     * pixel through and a clear one leaves the destination alone.
     *
     * Routine 174, `Mask Copy s1 To s2,mask`, is the whole-screen form: it
     * zeroes all four coordinates and takes the sizes from the source,
     * `move.w $4c(a0),d4 / move.w $4e(a0),d5`.
     *
     * Routine 175 is twelve bytes — `moveq #$0,d0 / move.b #$e0,d0 /
     * move.l d0,-(a3) / Rbra routine 176`. It pushes the DEFAULT MINTERM $E0
     * and falls into the ten-argument form, so the nine- and ten-argument
     * spellings are one routine with one optional trailing minterm.
     *
     * Routine 176 sizes the blit with `sub.l d0,d4 / sub.l d1,d5`, so xSize =
     * x2-x1 and ySize = y2-y1 — the far corner is EXCLUSIVE, as it is in
     * Count Pixels, Coords Read and Bzoom.
     *
     * DEVIATION: a minterm other than $E0 is not reproduced. Which of A, B
     * and C carries the mask, the source and the destination is decided
     * inside graphics.library's BltMaskBitMapRastPort, not in this binary,
     * and the AROS material here is a partial checkout with no rom/graphics
     * sources — so there is nothing to verify a general minterm against. The
     * $E0 behaviour the manual describes is what is implemented for every
     * value.
     *
     * NOTE: the mask is a raw pointer into a caller-built plane. When it
     * resolves to memory this port can read, it is honoured; when it does
     * not, the copy is unmasked, which is the same picture a program gets
     * from an all-ones mask. Its stride is the SOURCE bitmap's, and it is
     * indexed by the source coordinates — that follows from the autodoc's
     * "mask plane of same dimensions as the source bitmap" rather than from
     * the AMCAF binary, which only passes the pointer through. An earlier
     * pass indexed the mask's rows from zero while indexing its columns from
     * x1, which registers the mask with the source only when y1 is 0.
     */
    'mask copy'(it) {
      const s1 = it.evalInt()
      // routine 174: `Mask Copy s1 To s2,mask`, the whole source at 0,0
      if (it.accept('to')) {
        const s2 = it.evalInt()
        it.expect(',')
        const maskAddr = it.evalInt()
        const src = rt.screens.get(s1)
        const dst = rt.screens.get(s2)
        if (!src || !dst) amcafErr()
        maskBlit(rt, src, dst, 0, 0, src.width, src.height, 0, 0, maskAddr)
        return
      }
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
      it.expect(',')
      const maskAddr = it.evalInt()
      if (it.accept(',')) it.evalInt() // the minterm — see the DEVIATION above
      const src = rt.screens.get(s1)
      const dst = rt.screens.get(s2)
      if (!src || !dst) amcafErr()
      maskBlit(rt, src, dst, x1, y1, x2 - x1, y2 - y1, x3, y3, maskAddr)
    },

    /**
     * Bzoom s1,x1,y1,x2,y2 To s2,x3,y3,factor — routine 352 ($7b56), 638
     * bytes. An integer zoom.
     *
     * "the graphics are double, four times or eight times as wide and from 1
     * to 15 times as high", and the rounding is the blitter showing through:
     * "The coordinates x1 and x2 are rounded down to the next multiple of
     * eight, x3 is even rounded to the nearest multiple of 16."
     *
     * The factor packs both nibbles, and an earlier pass had them THE WRONG
     * WAY ROUND. The routine validates the mode before it touches anything
     * else, which is what settles it:
     *
     *   move.l (a3)+,d0 / Rbmi routine 390          a negative mode
     *   move.w d0,d1 / andi.w #$f0,d0 / tst.w d0 / Rbeq routine 390
     *   lsr.w #$4,d0 / subq.w #$1,d0 / move.w d0,$342(a2)
     *   andi.w #$f,d1 / cmp #$1 / #$2 / #$4 / #$8 / Rbne routine 390
     *   move.w d1,$340(a2)
     *
     * `$342` is the HIGH nibble minus one, and it is read as `move.w
     * $342(a2),d1` for the count of extra times each finished destination row
     * is copied — so the HIGH nibble is the VERTICAL multiplier, 1 to 15.
     * `$340` is the LOW nibble and it selects between four whole code paths:
     *
     *   1  move.b (a4)+,(a5)+                            1x
     *   2  move.b (a4)+,d0 / add.w d0,d0
     *      / move.w $eb2(a2,d0.w),(a5)+                  2x, a 256-word table
     *   4  lsl.w #$2,d0 / move.l $10b2(a2,d0.w),(a5)+    4x, 256 longs
     *   8  lsl.w #$3,d0 / two longs from $14b2(a2)       8x, 256 pairs
     *
     * so the LOW nibble is the HORIZONTAL one, and only 1, 2, 4 and 8 exist
     * because each needs its own bit-stretching table. The three tables are
     * contiguous — $eb2 + 256*2 = $10b2, + 256*4 = $14b2 — which is what
     * confirms the reading rather than just fitting it.
     *
     * Both far corners are EXCLUSIVE. `sub.l d3,d5 / subq.l #$1,d5` and
     * `sub.l d2,d4 / lsr.w #$3,d4 / subq.w #$1,d4` are dbra counts, so the
     * copy is (y2-y1) rows of (x2-x1)/8 bytes from x1,y1.
     *
     * DEVIATION: those two `subq`s are also why a degenerate box does not
     * error — a zero extent underflows to $ffff and the dbra runs 65536
     * times, scribbling far past both bitmaps. Doing nothing is not what the
     * routine does; reproducing it is not something this port can do.
     *
     * NOTE: the masks are `andi.w`, so they clear the low bits of the WORD
     * and leave the high word alone — `& 0xff8` and `& 0xff0` rather than
     * `& ~7` and `& ~15`, which differ for a negative coordinate (-8 becomes
     * 4088, not -8). Reproduced.
     *
     * NOTE: the plane count is `move.w $50(a0),$334(a2)` off the SOURCE, and
     * six plane pointers are loaded for each screen regardless, so a
     * destination shallower than the source is written past the end of its
     * planes. The port masks to the source's depth instead, which also keeps
     * a deeper destination's upper planes — the routine leaves them alone
     * too. And there is no clipping at either end.
     */
    'bzoom'(it) {
      const s1 = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt() & 0xff8
      it.expect(',')
      const y1 = it.evalInt()
      it.expect(',')
      const x2 = it.evalInt() & 0xff8
      it.expect(',')
      const y2 = it.evalInt()
      it.expect('to')
      const s2 = it.evalInt()
      it.expect(',')
      const x3 = it.evalInt() & 0xff0
      it.expect(',')
      const y3 = it.evalInt()
      it.expect(',')
      const mode = it.evalInt()
      // the mode is popped and checked before any other argument is even read
      if (mode < 0) amcafErr()
      const vy = (mode >> 4) & 0xf
      const hx = mode & 0xf
      if (vy === 0) amcafErr()
      if (hx !== 1 && hx !== 2 && hx !== 4 && hx !== 8) amcafErr()
      const src = rt.screens.get(s1)
      const dst = rt.screens.get(s2)
      if (!src || !dst) amcafErr()
      if (x2 - x1 <= 0 || y2 - y1 <= 0) return // see the DEVIATION above

      const sbm = src.rp.bitMap
      const dbm = dst.rp.bitMap
      const sp = sbm.pixels
      const dp = dbm.pixelsW()
      const mask = (1 << sbm.depth) - 1
      for (let y = 0; y < y2 - y1; y++) {
        for (let x = 0; x < x2 - x1; x++) {
          const from = (y1 + y) * sbm.width + x1 + x
          if (from < 0 || from >= sp.length) continue
          const v = sp[from]! & mask
          for (let dy = 0; dy < vy; dy++) {
            for (let dx = 0; dx < hx; dx++) {
              const to = (y3 + y * vy + dy) * dbm.width + x3 + x * hx + dx
              if (to < 0 || to >= dp.length) continue
              dp[to] = (dp[to]! & ~mask) | v
            }
          }
        }
      }
    },

    /**
     * C2p Convert st,wx,wy To screen,ox,oy — chunky to planar. Routine 78
     * ($3036) is the 66-byte front-end; routine 382 ($9d0c) is 2044 bytes of
     * actual converter.
     *
     * Undocumented beyond the changelog, which credits it: "New c2p routine
     * by Mikael Kalms. Up to 20%-80% faster".
     *
     * All SIX arguments are required. The spec is `I0,0,0t0,0,0` and routine
     * 78 pops six longs unconditionally with no short-form entry pushing
     * defaults, so the offsets an earlier pass made optional cannot be
     * omitted.
     *
     * Two gates before any work happens:
     *
     *   movea.l $4.w,a0 / move.w $128(a0),d0 / btst #$1,d0    AFB_68020
     *   moveq #$13,d0 / Rbra routine 156                      message 19
     *   move.w $50(a0),d4 / cmp.w #$4,d4 / bge                the DEPTH
     *   moveq #$12,d0 / Rbra routine 156                      message 18
     *
     * and then routine 382's own entry checks, every one of which branches to
     * $a0ba — `movem.l (a7)+,d2-d7/a2-a6 / rts`, a plain return. Bad arguments
     * do NOTHING; they are not an error:
     *
     *   andi.w #$1f,d4    wx must be a multiple of 32
     *   andi.w #$7,d5     ox must be a multiple of 8
     *   move.w d0,$0(a2) / beq          wx of 0
     *   move.w d1,$2(a2) / beq          wy of 0
     *   lsl.w #$3,d4 / sub.w d0,d4 / bmi   wx wider than the bitmap
     *
     * And the part that was simply wrong: `movem.l $8(a1),a3-a6` loads FOUR
     * plane pointers from the BitMap, so it writes planes 0-3 and nothing else —
     * the low nibble of each source byte. That is what the depth gate is
     * guarding, and it means a deeper screen keeps whatever planes 4 and up
     * already held. The port wrote whole pixel values through every plane.
     *
     * NOTE: `oy` is never range-checked, and `ox` is added to the row offset
     * after the width check, so the real routine will run off the end of the
     * bitmap or into the following row. The bounds test below is the port's,
     * not the routine's.
     */
    'c2p convert'(it) {
      const st = it.evalInt()
      it.expect(',')
      const wx = it.evalInt()
      it.expect(',')
      const wy = it.evalInt()
      it.expect('to')
      const scr = rt.screens.get(it.evalInt())
      it.expect(',')
      const ox = it.evalInt()
      it.expect(',')
      const oy = it.evalInt()
      const src = rt.resolveAddr(st)
      if (!scr || !src) amcafErr()
      // NOTE: the 68020 gate is not expressible here — the modelled machine is
      // an A1200, so AttnFlags bit 1 is always set and message 19 (`MC68020 or
      // higher required!`) can never fire. Cpu answers 68020 for the same
      // reason.
      const bm = scr.rp.bitMap
      if (bm.depth < 4) amcafMsg(18)
      if ((wx & 31) !== 0 || (ox & 7) !== 0 || wx === 0 || wy === 0) return
      if (wx > bm.bytesPerRow * 8) return

      const px = bm.pixelsW()
      for (let y = 0; y < wy; y++) {
        for (let x = 0; x < wx; x++) {
          const at = src.off + y * wx + x
          const to = (oy + y) * bm.width + ox + x
          if (at >= src.data.length || to < 0 || to >= px.length) continue
          px[to] = (px[to]! & ~0x0f) | (src.data[at]! & 0x0f)
        }
      }
    },


    /**
     * Shade Bob Planes n — "'amount' sets the number of bitplanes, that
     * should be drawn in and must be a value between 1 and 6", which is how
     * a program protects the graphics in the higher planes.
     */
    'shade bob planes'(it) {
      /*
       * Routine 285 ($6626) checks the count THREE times before storing it:
       * `Rbeq routine 390` on zero, `Rbmi routine 390` on negative, and
       * `moveq #$6,d1 / cmp.l d1,d0 / Rbhi routine 390` on anything above six
       * — an unsigned compare against the whole LONG, so the manual's "must
       * be a value between 1 and 6" is enforced at both ends. `subq.w #$1,d0`
       * then stores it minus one, as the dbra bound the shading loop uses.
       */
      const n = it.evalInt()
      if (n < 1 || n > 6) amcafErr()
      rt.amcaf.shadePlanes = n
    },

    /**
     * Shade Bob Mask flag — "Either the mask or the first bitplane of the
     * object is used", and this is the switch.
     */
    'shade bob mask'(it) {
      // Routine 284 ($6610) normalises to 0 or 1 rather than storing the
      // argument: `move.l (a3)+,d0 / beq` then either `move.w #$1,$284(a2)`
      // or `clr.w $284(a2)`. Any non-zero value means the same thing.
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
     * Shade Pix x,y — routines 223 ($5180) and 224. "Increases the colour
     * value at the given point ... If the highest colour is reached, the
     * colour is resetted to be cycled."
     *
     * Routine 223 is EIGHT BYTES — `moveq #$6,d0 / move.l d0,-(a3)` and a
     * branch into the worker — so the plane count is a hardcoded **SIX**, not
     * `Shade Bob Planes` and not an argument. The token table agrees: `I0,0`,
     * two parameters. An earlier pass gave it an optional third and read the
     * Shade Bob setting when it was absent.
     *
     * The worker is a ripple adder rather than an arithmetic increment: per
     * plane, `btst` the bit, `bclr` and carry on if it was set, `bset` and
     * stop if it was not. The wrap the manual describes falls out of that —
     * 63 clears all six and runs out of planes — and so does the early stop:
     * `move.l a0,d0 / beq` bails on a null plane pointer, so a four-plane
     * screen carries through four planes and no further.
     *
     * Bounds are the same silent `bmi` / `cmp.w $4e(a2)` / `cmp.w $4c(a2)`
     * pair Turbo Plot uses, which is the clipping the V1.30 changelog added.
     */
    'shade pix'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const s = rt.screen
      if (!s) return
      const v = s.rp.point(x, y)
      if (v < 0) return // clipped since V1.30, like Turbo Plot
      const planes = Math.min(6, s.rp.bitMap.depth)
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
    /**
     * Make Pix Mask screen,x1,y1 To x2,y2,bank — routine 225 ($51ce), 140
     * bytes. Three things here were wrong.
     *
     * The far corner is EXCLUSIVE, and the bank is sized from it before the
     * dbra adjustment: `sub.w d4,d6 / sub.w d5,d7 / move.w d6,d2 /
     * mulu.w d7,d2` reserves (x2-x1) * (y2-y1) bytes, and only then does
     * `subq.w #$1,d6 / subq.w #$1,d7` turn the extents into loop counts.
     *
     * The bank's name is the literal at $5252, which is **"Pix Mask"** with a
     * space in the middle — not the "PixMask " an earlier pass guessed.
     *
     * And the mask is built from BITPLANE 0 alone. `movea.l (a2),a2` takes
     * the first plane pointer and `btst.l d4,(a2,d3.l)` tests that one bit,
     * writing `move.b #$1,(a1)+` or `clr.b (a1)+`. The port tested the whole
     * pixel value, so on any screen deeper than one plane a pixel of colour 2
     * masked in where the routine masks it out.
     *
     * NOTE: the Reserve is `Rjsr routine 1103` guarded by `Rbeq routine 389`,
     * so a failure is error 24 rather than the 23 this port's reserveBank
     * raises for a non-positive length. Only reachable for a degenerate box.
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
      const w = x2 - x1
      const h = y2 - y1
      if (w <= 0 || h <= 0) amcafErr()
      rt.reserveBank(bank, w * h, 'Pix Mask')
      const d = rt.memBanks.get(bank)!.data
      const bm = s.rp.bitMap
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const px = x1 + x
          const py = y1 + y
          const inside = px >= 0 && py >= 0 && px < bm.width && py < bm.height
          d[y * w + x] = inside && (bm.pixelAt(px, py) & 1) !== 0 ? 1 : 0
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
      // Routine 269 ($61d4) is twelve bytes and stores the bank NUMBER at
      // $360, not a resolved address: `move.l (a3)+,d0 / move.l d0,$360(a2)`.
      // Paste Ptile resolves it each time, so erasing and re-reserving the
      // bank between calls works, where a cached pointer would dangle.
      rt.amcaf.ptileBank = it.evalInt()
    },

    /**
     * Paste Ptile x,y,t — routine 270 ($61e0). "Places a Ptile block at the
     * position x,y. These coordinates must be given as block positions, that
     * means that position 1,4 corresponds to the screen coordinates 16,64."
     *
     * The bank format is the part an earlier pass had wrong: it read the tiles
     * as CHUNKY bytes, and they are PLANAR. The routine's opening reads two
     * header words —
     *
     *   move.l  (a3)+, d7        ; the tile number
     *   cmp.w   (a0)+, d7        ; word 0 is the tile COUNT
     *   Rbge    routine 390
     *   move.w  (a0)+, d0        ; word 1 is planes - 1
     *   lsl.l   #$5, d7          ; tile * 32
     *   ...     add.l d7,d6 / dbra d0
     *
     * so a tile is 32 bytes per plane — sixteen rows of one word — and its
     * planes are contiguous, giving a stride of `32 * planes`. The paste is
     * then a plain unrolled `movem.w (a1)+` into `movea.l (a0)+,a2` down the
     * SCREEN's plane pointers, opaque, with no mask and no write mode.
     *
     * The count check is `Rbge`, which is SIGNED, so a NEGATIVE tile number
     * passes it and indexes backwards out of the bank.
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
      const d = bank.data
      const count = ((d[0]! << 8) | d[1]!) & 0xffff
      const planes = (((d[2]! << 8) | d[3]!) & 0xffff) + 1
      if (t >= count) amcafErr()
      const bm = s.rp.bitMap
      const bytes = bm.planeBytes(true)
      const tile = 4 + t * 32 * planes
      for (let p = 0; p < planes && p < bm.depth; p++) {
        const base = p * bm.planeSize
        for (let row = 0; row < 16; row++) {
          const at = tile + p * 32 + row * 2
          const y = by * 16 + row
          if (y < 0 || y >= bm.height) continue
          const off = base + y * bm.bytesPerRow + bx * 2
          if (off < 0 || off + 1 >= bytes.length) continue
          bytes[off] = d[at] ?? 0
          bytes[off + 1] = d[at + 1] ?? 0
        }
      }
      bm.invalidate()
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

    /**
     * Coords Bank bank[,coords] — TWO token entries and two routines. The
     * table carries `!coords bank` (id $0d10, spec `I0`, routine 93) followed
     * by an empty-named continuation (id $0d24, spec `I0,0`, routine 94),
     * which is how AMOS spells one keyword with two arities — `!track play`
     * and its two blank followers are the same shape.
     *
     * Routine 93 ($33d4) is eighteen bytes and reserves NOTHING:
     *
     *     movea.l $168(a5),a2 / move.l (a3)+,d0 / Rjsr routine 1121
     *     move.l d0,$266(a2) / rts
     *
     * It resolves the bank to an address and stores the pointer, which is
     * exactly the manual's "the existing bank will only be switched to
     * without erasing it. So you can jump between predefined banks."
     *
     * Routine 94 ($33e6) is the one that allocates:
     *
     *     move.l (a3)+,d2 / Rbeq routine 390      a count of zero is an error
     *     lsl.l #$2,d2 / addq.l #$8,d2            four bytes each, plus a header
     *     lea $341a(pc),a0 / Rjsr routine 1103    Reserve, named "Coords  "
     *     Rbeq routine 389                        and out of memory if it fails
     *     move.w d7,(a0)+ / clr.w (a0)+ / moveq #$8,d0 / move.l d0,(a0)
     *
     * An earlier pass reserved `count * 4` with no header at all, which is
     * eight bytes short and left every reader of the bank without a count.
     *
     * NOTE: `move.w d2,d4 / move.l d4,d7` narrows the count to a WORD before
     * it is stored, while `lsl.l #$2,d2` sizes the Reserve from the full
     * long. Above 65535 the two disagree in the binary too, and that is
     * reproduced.
     */
    'coords bank'(it) {
      const n = it.evalInt()
      if (it.accept(',')) {
        const count = it.evalInt()
        if (count === 0) amcafErr()
        rt.reserveBank(n, COORDS_HEADER + count * 4, 'Coords  ')
        const v = coordsView(rt, n)
        if (v) {
          v.setUint16(0, count & 0xffff) // the count
          v.setUint16(2, 0) // the cursor
          v.setUint32(4, COORDS_HEADER) // the offset of the first entry
        }
      }
      rt.amcaf.splinters.coordsBank = n
    },

    /**
     * Coords Read screen,colour,x1,y1 To x2,y2,bank,mode — routine 95
     * ($3422), 276 bytes. "'colour' represents the background colour, that
     * will be left out when reading in the dots ... all dots, which don't
     * have the colour" are gathered.
     *
     * The scanner from $3486 to $34f0 is Count Pixels' scanner instruction
     * for instruction, so it carries the same two findings: the far corner is
     * EXCLUSIVE, and an empty or reversed box is an error before any work —
     * here through routine 157, which is a four-byte `Rbra routine 390`.
     * The colour is likewise a byte (`move.b d2,$2(a7)` / `cmp.b $a(a7),d0`).
     *
     * All EIGHT arguments are required; routine 95 pops eight longs and the
     * spec is `I0,0,0,0t0,0,0,0`. An earlier pass had `mode` optional.
     *
     * Each hit is written as `x<<4` and `y<<4` at the bank's next slot:
     *
     *     move.w d3,d2 / addq.l #$2,d2 / lsl.l #$2,d2 / adda.l d2,a0
     *     move.w d1,d2 / lsl.w #$4,d2 / move.w d2,(a0)
     *     move.w $a(a7),d2 / sub.w d7,d2 / add.w $6(a7),d2
     *     lsl.w #$4,d2 / move.w d2,$2(a0)
     *
     * — `(count + 2) * 4` is the eight-byte header plus four bytes an entry,
     * and the y arithmetic recovers the row from the countdown register. The
     * port wrote raw pixel coordinates at offset zero.
     *
     * `cmp.w (a0),d3 / beq` stops the scan when the count reaches the LIMIT
     * the bank's first word holds, which Coords Bank put there; `move.w
     * d3,(a0)` then replaces it with what was actually found. NOTE: that
     * means a second Coords Read into the same bank is limited by the FIRST
     * one's result, not by the bank's capacity — a real quirk, reproduced.
     *
     * NOTE: nothing bounds-checks the bank against its own length; the
     * routine trusts the limit word. The length test below is the port's.
     */
    'coords read'(it) {
      const scr = rt.screens.get(it.evalInt())
      it.expect(',')
      const bg = it.evalInt() & 0xff
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
      it.expect(',')
      const mode = it.evalInt()
      if (!scr) amcafErr()
      const w = ((x2 - x1) << 16) >> 16 // sub.w, so a WORD difference
      const h = ((y2 - y1) << 16) >> 16
      if (w <= 0 || h <= 0) amcafErr()
      const v = coordsView(rt, bank)
      if (!v) amcafErr()

      const limit = v.getUint16(0)
      let n = 0
      scan: for (let y = y1; y < y1 + h; y++) {
        for (let x = x1; x < x1 + w; x++) {
          const p = scr.rp.point(x, y)
          if (p < 0 || (p & 0xff) === bg) continue
          if (n === limit) break scan
          const at = COORDS_HEADER + n * 4
          if (at + 4 > v.byteLength) break scan
          v.setUint16(at, (x << 4) & 0xffff)
          v.setUint16(at + 2, (y << 4) & 0xffff)
          n++
        }
      }
      v.setUint16(0, n & 0xffff)

      /*
       * And what `mode` actually is. `move.w (a7),d0 / bne $3504` — a
       * non-zero mode SHUFFLES the finished list, swapping each entry with a
       * randomly chosen one:
       *
       *   lea $dff006.l,a1
       *   add.w (a1),d6 / move.w d6,d5 / mulu.w d7,d5 / swap d5
       *   ext.l d5 / lsl.l #$2,d5
       *   move.l $8(a0,d5.l),d0 / move.l (a2),$8(a0,d5.l) / move.l d0,(a2)+
       *
       * $dff006 is VHPOSR, the raster beam, used as the entropy source; d7
       * holds the count and the index is the high word of accumulator *
       * count. d6 arrives as $ffff, the value the x loop's `dbra` left.
       *
       * An earlier pass parsed `mode` and threw it away as "the scan order".
       *
       * NOTE: the modelled beam does not advance while a keyword runs, so
       * `beamWord()` returns the same value every iteration here and the
       * shuffle is a fixed permutation where the real one is not. Reading
       * VHPOSR is faithful; the standing-still is the port's clock.
       */
      if (mode !== 0 && n > 0) {
        let acc = 0xffff
        for (let i = 0; i < n; i++) {
          acc = (acc + rt.interp.beamWord()) & 0xffff
          const j = Math.floor((acc * n) / 0x10000)
          const a = COORDS_HEADER + i * 4
          const b = COORDS_HEADER + j * 4
          if (a + 4 > v.byteLength || b + 4 > v.byteLength) continue
          const t = v.getUint32(b)
          v.setUint32(b, v.getUint32(a))
          v.setUint32(a, t)
        }
      }

      rt.amcaf.splinters.coordsBank = bank
    },

    /** Splinters Bank bank,splinum — "Each Splinter requires 22 bytes" */
    /**
     * Splinters Bank bank,amount — routine 288 ($697c).
     *
     * The COUNT is checked and the bank number is not: `move.l (a3)+,d2 /
     * Rbeq routine 390` refuses a zero amount before it looks at anything
     * else. Then `mulu.w #$16,d2` — **22 bytes a splinter** — and AMOS's own
     * Reserve with the eight-character name **"Splinter"**, which is a literal
     * in the binary. A Reserve that comes back empty is error 24.
     *
     * It stores `amount - 1` as the loop bound, which is why every walk of the
     * table is a `dbra`.
     */
    'splinters bank'(it) {
      const bank = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      if (n === 0) amcafErr()
      rt.reserveBank(bank, n * 22, 'Splinter')
      const sp = rt.amcaf.splinters
      sp.bank = bank
      sp.max = n
      // NOTE: the records are NOT initialised here. The bank arrives zeroed
      // from Reserve, and a zero at +$10 means colour 0 rather than the $ff
      // that means free — so every splinter is "alive" at pixel 0 until
      // Splinters Init marks them free. That is the machine's behaviour too:
      // routine 288 stores the pointer and the count and returns.
    },

    /**
     * Splinters Colour bkcolour,planes — routine 294 ($6a38), "what a lifted
     * dot leaves behind".
     *
     * The plane count is bounded against the CURRENT SCREEN rather than
     * against six: `move.w $50(a1),d0` is the depth, `subq.w #$1,d2 / cmp.w
     * d2,d0 / Rble routine 390`, so `planes` above the screen's depth is error
     * 23 — and with no screen open at all it is error 47 (routine 394) before
     * that. Nothing bounds it below, and `planes - 1` is what gets stored.
     */
    'splinters colour'(it) {
      const sp = rt.amcaf.splinters
      const bk = it.evalInt()
      it.expect(',')
      const planes = it.evalInt()
      const s = rt.screen
      if (!s) throw new AmosError('Screen not opened', 47)
      if (s.rp.bitMap.depth <= planes - 1) amcafErr()
      sp.bkColour = bk
      sp.topPlane = planes - 1
    },

    /**
     * Splinters Gravity sx,sy — routine 293 ($6a26), added to the speed each
     * step.
     *
     * NOTE: the pair is stored RAW, and the speeds it is added to are in
     * sixteenths of a pixel (routine 386: `add.w $c(a0),d2` where d2 is the
     * `x<<4` position). So `Splinters Gravity 1,1` is a sixteenth of a pixel
     * per step per step, not a pixel — sixteen times gentler than the port's
     * whole-pixel arithmetic made it. Nothing scales it; only Limit and the
     * coordinates get the `lsl.w #$4`.
     */
    'splinters gravity'(it) {
      const sp = rt.amcaf.splinters
      sp.gx = extW(it.evalInt())
      it.expect(',')
      sp.gy = extW(it.evalInt())
    },

    /**
     * Splinters Fuel time — "the number of steps the splinters are moved
     * before they vanish". Routine 290 ($69be) narrows it to a word at $27e,
     * which routine 385 copies into each respawned splinter's `+$14`.
     *
     * Zero does not mean "never": routine 386 tests `tst.w $14(a0)` BEFORE it
     * decrements, so a life of zero respawns the splinter on its first Move.
     * The manual's "If you set 'time' to 0, the Splinters only disappear at
     * the edges" describes what a zero fuel looks like once the coordinate
     * list is exhausted — every splinter dies at once and stays dead.
     */
    'splinters fuel'(it) {
      rt.amcaf.splinters.fuel = it.evalInt() & 0xffff
    },

    /**
     * Splinters Max amount — "the max. amount of new Splinters to appear on
     * each step". Routine 289 ($69b2) narrows it to a word at $282.
     *
     * Routine 300 loads that word into d5 once per Move and routine 385
     * decrements it, `tst.w d5 / beq` refusing to spawn at zero — so it is an
     * UNSIGNED word allowance, and the manual's "-1 for no limit" works only
     * because -1 narrows to $ffff, which is 65535 spawns rather than infinity.
     */
    'splinters max'(it) {
      rt.amcaf.splinters.maxNew = it.evalInt() & 0xffff
    },

    /**
     * Splinters Limit [x1,y1 To x2,y2] — routine 291 ($69ca) bare, routine
     * 292 ($69f4) with the four corners. A `!` multi-arity entry, which is why
     * both forms exist as separate routines.
     *
     * Both store SIXTEENTHS, because that is what routine 386 compares
     * against. The bare form takes the current screen:
     *
     *     clr.l $26e(a2)                      x1 = y1 = 0
     *     move.w $4c(a0),d0 / lsl.w #$4,d0 / subq.w #$1,d0 / swap d0
     *     move.w $4e(a0),d0 / lsl.w #$4,d0 / subq.w #$1,d0
     *     move.l d0,$272(a2)                  x2, y2
     *
     * so the far corner is `width * 16 - 1`, one sixteenth short of the pixel
     * past the edge. With no screen open it is error 47 (routine 394).
     *
     * The explicit form shifts all four the same way, takes one off the high
     * pair, and then ORDERS each axis with an UNSIGNED compare — `cmp.w d0,d2
     * / bhi / exg.l d0,d2` — so a reversed rectangle is swapped rather than
     * rejected, and a negative x1 sorts as a very large one.
     */
    'splinters limit'(it) {
      const sp = rt.amcaf.splinters
      if (it.atStmtEnd()) {
        const s = rt.screen
        if (!s) throw new AmosError('Screen not opened', 47)
        sp.limit = { x1: 0, y1: 0, x2: extW(s.width * 16 - 1), y2: extW(s.height * 16 - 1) }
        return
      }
      let x1 = extW(it.evalInt() << 4)
      it.expect(',')
      let y1 = extW(it.evalInt() << 4)
      it.expect('to')
      let x2 = extW((it.evalInt() << 4) - 1)
      it.expect(',')
      let y2 = extW((it.evalInt() << 4) - 1)
      // `cmp.w d0,d2 / bhi` — UNSIGNED, and the exchange is the whole long
      if (!((x2 & 0xffff) > (x1 & 0xffff))) [x1, x2] = [x2, x1]
      if (!((y2 & 0xffff) > (y1 & 0xffff))) [y1, y2] = [y2, y1]
      sp.limit = { x1, y1, x2, y2 }
    },

    /**
     * Splinters Init — routine 295 ($6a60), and it is THIRTY-SIX BYTES:
     *
     *     movea.l $26a(a2),a0 / Rbeq routine 390
     *     move.w  $280(a2),d7
     *     moveq   #$ff,d0                     ...which is moveq #-1
     *     lea     $10(a0),a0
     *  L: move.l  d0,(a0) / lea $16(a0),a0 / dbra d7,L
     *
     * It writes $ffffffff over `+$10..+$13` of every record and returns. That
     * is the whole keyword: mark every splinter FREE, with no saved
     * background and no pending spawn. It does not look at the screen, the
     * coordinate list, the fuel or the speeds.
     *
     * The manual's "the Splinters are fed with the coordinates and speeds you
     * specified" describes the ENGINE, not this call — the feeding happens one
     * splinter at a time in routine 385, when a free or dead splinter is found
     * by a Move. An earlier pass read the manual and seeded a particle array
     * from the coordinate bank here, which is a different design: it took
     * every coordinate at once, ignored Splinters Max, and never advanced the
     * bank's cursor, so the engine had no way to run out.
     *
     * With no bank it is error 23 (routine 390).
     */
    'splinters init'(it) {
      void it
      const v = splinterTable(rt)
      if (!v) amcafErr()
      const sp = rt.amcaf.splinters
      for (let i = 0; i < sp.max; i++) v.setUint32(i * SPL + SPL_COLOUR, 0xffffffff)
    },

    /** Splinters Move — routine 300 ($6c32), one step for the whole table */
    'splinters move'(it) {
      void it
      splintersMove(rt)
    },

    /** Splinters Draw — routine 302 ($6ce2), "Draws the Splinters onto the screen" */
    'splinters draw'(it) {
      void it
      splintersDraw(rt)
    },

    /** Splinters Back — routine 301 ($6c74), and it does two jobs; see below */
    'splinters back'(it) {
      void it
      splintersBack(rt)
    },

    /**
     * Splinters Single Do / Double Do — one call for the whole cycle.
     *
     * Routines 296 and 297 ($6a84, $6a94) are sixteen bytes each and spell the
     * order out. It is FOUR steps, not two:
     *
     *     Rbsr routine 298 (single del) / Rbsr routine 299 (double del)
     *     Rbsr routine 300 (move)
     *     Rbsr routine 301 (back)      <- save the background at the NEW places
     *     Rbra routine 302 (draw)
     *
     * which is exactly what the manual tells a caller doing it by hand:
     * "Splinters Single Del or Splinters Double Del, then Splinters Move,
     * Splinters Back and Splinters Draw in this order".
     */
    'splinters single do'(it) {
      void it
      splintersDel(rt, false)
      splintersMove(rt)
      splintersBack(rt)
      splintersDraw(rt)
    },
    'splinters double do'(it) {
      void it
      splintersDel(rt, true)
      splintersMove(rt)
      splintersBack(rt)
      splintersDraw(rt)
    },

    /**
     * Splinters Single Del / Double Del — routines 298 ($6aa4) and 299
     * ($6b66), and they are NOT the same call.
     *
     * "As the clearing process must either wipe the pre-last pixels from the
     * screen (when using Double Buffering), or the last pixels (with Single
     * Buffered screens), you have to take the appropriate command for the
     * right screen type."
     *
     * Which is done by reading a different pair of fields. Single Del restores
     * `+$11` — the background under the CURRENT position — at `+$4`; Double Del
     * restores `+$12`, the generation before it, at `+$8`. Routine 386 shifts
     * one into the other at the top of every Move, so the two generations cost
     * six bytes a splinter rather than a second array.
     */
    'splinters single del'(it) {
      void it
      splintersDel(rt, false)
    },
    'splinters double del'(it) {
      void it
      splintersDel(rt, true)
    },

    /* ---- Td Stars ---- */

    /**
     * Td Stars Bank bank,stars — routine 304 ($6d84), Splinters Bank's twin.
     * "Each star consumes 12 bytes of memory", and `mulu.w #$c,d2` says so.
     * A count of ZERO is error 23 before anything else, and the eight-character
     * bank name is the literal **"Stars   "** rather than the port's invented
     * "TdStars ". A Reserve that comes back empty is error 24.
     */
    'td stars bank'(it) {
      const bank = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      if (n === 0) amcafErr()
      rt.reserveBank(bank, n * 12, 'Stars   ')
      const st = rt.amcaf.stars
      st.bank = bank
      st.max = n
    },

    /**
     * Td Stars Planes p1,p2 — routine 312 ($6ea6), and it takes TWO plane
     * numbers rather than a count, which an earlier pass read as one.
     *
     * It opens with a depth check that is the clearest use of AMCAF's own
     * message table in the whole extension:
     *
     *   move.w  $50(a1), d0
     *   cmp.w   #$2, d0
     *   bge.b   ...
     *   moveq   #$f, d0
     *   Rbra    routine 397
     *
     * — fifteen, which is **"At least 4 colours required in screen"**. Then
     * each plane number is bounded against that same depth (`cmp.w dN,d0 /
     * Rble routine 390`), so a plane at or above the depth is error 23, and
     * each is stored MULTIPLIED BY FOUR — `add.w d1,d1` twice — because that
     * is the offset of a plane pointer in the screen structure and routine
     * 319 indexes with it directly. Which is also why there are two of them
     * and not a count: they are the two planes a star's BRIGHTNESS is spread
     * across. See `tdStarsDraw`.
     *
     * `move.l (a3)+,d2` pops the SECOND argument first, so p1 lands at $260
     * and p2 at $262 — the order matters, because the dim end of the scale
     * lights p1 alone and the middle lights p2 alone.
     */
    'td stars planes'(it) {
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      const s = rt.screen
      if (!s) throw new AmosError('Screen not opened', 47)
      if (s.rp.bitMap.depth < 2) amcafMsg(15)
      if (s.rp.bitMap.depth <= a || s.rp.bitMap.depth <= b) amcafErr()
      rt.amcaf.stars.planeA = a * 4
      rt.amcaf.stars.planeB = b * 4
    },

    /**
     * Td Stars Limit [x1,y1 To x2,y2] — routines 305 ($6dba) and 306 ($6df2),
     * the sixty-fourths twin of Splinters Limit. "These coordinates must lie
     * WITHIN the screen dimensions, otherwise the stars could corrupt your
     * memory": here they cannot, because `tdStarsPoke` drops an index outside
     * the planes.
     */
    'td stars limit'(it) {
      const st = rt.amcaf.stars
      if (it.atStmtEnd()) {
        const s = rt.screen
        if (!s) throw new AmosError('Screen not opened', 47)
        const x2 = extW(s.width * 64 - 1)
        const y2 = extW(s.height * 64 - 1)
        st.limit = { x1: 0, y1: 0, x2, y2 }
        // the bare form's origin is `lsr.w #$1` of the SIZE before the
        // subtract — `move.w d0,d1 / subq.w #$1,d0 / lsr.w #$1,d1` — so it is
        // the true centre, unlike the explicit form below
        st.ox = extW((s.width * 64) >> 1)
        st.oy = extW((s.height * 64) >> 1)
        return
      }
      let x1 = extW(it.evalInt() << 6)
      it.expect(',')
      let y1 = extW(it.evalInt() << 6)
      it.expect('to')
      let x2 = extW((it.evalInt() << 6) - 1)
      it.expect(',')
      let y2 = extW((it.evalInt() << 6) - 1)
      if (!((x2 & 0xffff) > (x1 & 0xffff))) [x1, x2] = [x2, x1]
      if (!((y2 & 0xffff) > (y1 & 0xffff))) [y1, y2] = [y2, y1]
      st.limit = { x1, y1, x2, y2 }
      /*
       * DEFECT: both forms also overwrite the ORIGIN, and nothing documents
       * it — routine 305 stores a LONGWORD at $256, which is exactly where
       * Td Stars Origin (routine 307) puts its pair, so setting a limit
       * silently re-centres the starfield. Worse, the explicit form computes
       * that centre as
       *
       *     add.w d1,d0 / lsr.w #$1,d0      ->  $256 = (x1 + y1) / 2
       *     add.w d3,d2 / lsr.w #$1,d2      ->  $258 = (x2 + y2) / 2
       *
       * which averages x against y instead of each axis against its own pair.
       * Byte-identical in 1.50, so it survived every release. Reproduced: a
       * program calling Td Stars Limit after Td Stars Origin loses the origin
       * it asked for, on the machine too.
       */
      st.ox = extW(((x1 + y1) & 0xffff) >>> 1)
      st.oy = extW(((x2 + y2) & 0xffff) >>> 1)
    },

    /**
     * Td Stars Origin x,y — routine 307 ($6e30), "where stars start from, as
     * soon as they have left". Both are shifted into sixty-fourths, and
     * routine 387 copies the pair into a new star with a single `move.l`.
     */
    'td stars origin'(it) {
      const st = rt.amcaf.stars
      st.ox = extW(it.evalInt() << 6)
      it.expect(',')
      st.oy = extW(it.evalInt() << 6)
    },

    /**
     * Td Stars Gravity sx,sy — routine 309 ($6e80), added to the speed each
     * step and stored RAW, so like Splinters Gravity the unit is the engine's
     * fixed point: a sixty-fourth of a pixel per step per step.
     */
    'td stars gravity'(it) {
      const st = rt.amcaf.stars
      st.gx = extW(it.evalInt())
      it.expect(',')
      st.gy = extW(it.evalInt())
    },

    /**
     * Td Stars Accelerate On / Off — routines 310 ($6e92) and 311 ($6e9c),
     * "if the stars are to be accelerated".
     *
     * NOTE: the pair is asymmetric. On is `st.b $25e(a2)`, which writes $ff to
     * the HIGH byte of the word; Off is `clr.w $25e(a2)`, which clears both.
     * Routine 388 tests `tst.w`, so the two still pair up correctly — $ff00 is
     * non-zero — but a program peeking $25f would find On had left it alone.
     */
    'td stars accelerate on'() {
      rt.amcaf.stars.accelerate = 0xff00
    },
    'td stars accelerate off'() {
      rt.amcaf.stars.accelerate = 0
    },

    /**
     * Td Stars Init — routine 308 ($6e46), and the manual's sentence is
     * literal: "the stars are moved by random values to avoid that they all
     * start in the origin."
     *
     *     L: Rbsr routine 387            spawn this star at the origin
     *        clr.l $4(a0)                and give it no previous position
     *        add.w (a1),d5 / andi.w #$1f,d5
     *     M: Rbsr routine 388            ...then step it, 0 to 31 times
     *        dbra d5,M
     *        lea $c(a0),a0 / dbra d7,L
     *
     * So every star really is spawned at the origin and then run forward by
     * the SAME move routine Td Stars Move uses, which is what spreads them
     * out along their own tracks rather than scattering them. An earlier pass
     * invented `z: 1 + (i % 64)` and two multiplicative velocities here, a
     * different design that matches none of the arithmetic.
     *
     * NOTE: d5 is never initialised before the first star — `add.w (a1),d5`
     * reads whatever the interpreter left in it. `andi.w #$1f` bounds the
     * damage to 0..31 either way, and after the first `dbra` runs it to -1
     * every later star is deterministic. Modelled as zero.
     */
    'td stars init'(it) {
      void it
      const st = rt.amcaf.stars
      const v = tdStarTable(rt)
      if (!v) amcafErr()
      const d6 = { v: rt.interp.beamWord() & 0xffff }
      let d5 = 0
      for (let i = 0; i < st.max; i++) {
        const o = i * TD
        tdStarSpawn(rt, v, o, d6)
        v.setUint32(o + TD_PREV, 0)
        d5 = (d5 + rt.interp.beamWord()) & 0x1f
        for (let k = 0; k <= d5; k++) tdStarMove(rt, v, o, d6)
        d5 = 0xffff // what the dbra leaves behind, for the next star
      }
    },

    /**
     * Td Stars Move [star] — routines 317 ($6fd4) for the whole table and 318
     * ($6ffc) for one.
     *
     * DEFECT: the indexed form's bound is right and its stride is not.
     * `cmp.w d0,d7 / Rbmi routine 390` refuses an index past the count, then
     *
     *     lsl.w #$4, d0
     *     adda.w d0, a0
     *
     * multiplies it by SIXTEEN. A star is TWELVE bytes — routine 304 sizes the
     * bank with `mulu.w #$c` and every other loop steps `lea $c(a0),a0`. So
     * `Td Stars Move 1` lands four bytes into star 1's record and moves a
     * star made of star 1's speeds and star 2's position; by star 3 it is
     * off the end of the bank. Only index 0 is right. Reproduced.
     */
    'td stars move'(it) {
      const st = rt.amcaf.stars
      const v = tdStarTable(rt)
      if (!v) amcafErr()
      const d6 = { v: 0 }
      if (!it.atStmtEnd()) {
        const n = it.evalInt()
        if (st.max - 1 - ((n << 16) >> 16) < 0) amcafErr()
        d6.v = rt.interp.beamWord() & 0xffff
        tdStarMove(rt, v, (n & 0xffff) << 4, d6)
        return
      }
      d6.v = rt.interp.beamWord() & 0xffff
      for (let i = 0; i < st.max; i++) tdStarMove(rt, v, i * TD, d6)
    },

    /** Td Stars Draw — routine 319 ($7026); the brightness rule is in tdStarsDraw */
    'td stars draw'(it) {
      void it
      tdStarsDraw(rt)
    },

    /**
     * Td Stars Single Del / Double Del — routines 315 ($6efe) and 316 ($6f68).
     *
     * Both clear the bit in BOTH named planes, and the only difference is
     * WHERE: Single reads the position at `(a0)`, Double the one at `+$4`
     * that routine 388 saved before it moved. Same double-buffer reasoning as
     * the Splinters pair, done with four bytes instead of a second table --
     * and much simpler here, because a star destroys what it lands on and has
     * nothing to put back.
     */
    'td stars single del'(it) {
      void it
      tdStarsDel(rt, false)
    },
    'td stars double del'(it) {
      void it
      tdStarsDel(rt, true)
    },

    /**
     * Td Stars Single Do / Double Do — routines 313 ($6ee6) and 314 ($6ef2),
     * twelve bytes each:
     *
     *     Rbsr routine 315 (single del) / Rbsr routine 316 (double del)
     *     Rbsr routine 317 (move)
     *     Rbra routine 319 (draw)
     *
     * THREE calls where the Splinters pair has four -- there is no Back step,
     * because a star keeps nothing. An earlier pass had Double Do skip the
     * del entirely, which is the one thing neither routine does.
     */
    'td stars single do'(it) {
      void it
      tdStarsDel(rt, false)
      tdStarsMoveAll(rt)
      tdStarsDraw(rt)
    },
    'td stars double do'(it) {
      void it
      tdStarsDel(rt, true)
      tdStarsMoveAll(rt)
      tdStarsDraw(rt)
    },


    /* ---- vector rotation ---- */

    /**
     * Vec Rot Angles ax,ay,az — routine 3 ($1f6c), the rotation about all
     * three axes in the same 1024-to-the-turn units Qsin and Qcos use.
     *
     *     move.l (a3)+,d0 / andi.w #$3ff,d0 / add.w d0,d0 / move.w d0,$306(a2)
     *
     * three times over. Each angle is masked to 1023 and DOUBLED, because it
     * is kept as a byte offset into the 1024-entry word sine table rather than
     * as an angle — so a program peeking $306 finds twice what it set.
     *
     * The pop order matters: `(a3)+` takes the LAST argument first, so `$306`
     * holds `az` and `$30a` holds `ax`. Routine 4 then uses `$306`'s sine and
     * cosine as the FIRST of the three it composes.
     */
    'vec rot angles'(it) {
      const v = rt.amcaf.vec
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      v.angC = (a & 0x3ff) * 2
      v.angB = (b & 0x3ff) * 2
      v.angA = (c & 0x3ff) * 2
    },

    /**
     * Vec Rot Pos x,y,z — routine 2 ($1f54), three words at `$300`.
     *
     * NOT subtracted from the point before the rotation, which is how the
     * port had it. Routine 373 ADDS it afterwards: x and y scaled up by 256
     * to match the matrix products, and z at its face value into the divisor.
     * So it translates the CAMERA in rotated space, and its z is what pushes
     * the scene away from the eye.
     */
    'vec rot pos'(it) {
      const v = rt.amcaf.vec
      v.px = extW(it.evalInt())
      it.expect(',')
      v.py = extW(it.evalInt())
      it.expect(',')
      v.pz = extW(it.evalInt())
    },

    /**
     * Vec Rot Precalc — routine 4 ($1f96), 236 bytes, and IT IS NOT A NO-OP.
     *
     * An earlier pass wrote "Nothing here caches a matrix, so this is a no-op
     * — FAITHFUL rather than a stub, because the only thing a program can
     * observe afterwards is that the following Vec Rot X/Y/Z give the same
     * answers either way." That is exactly backwards. Routine 373, which is
     * every Vec Rot X/Y/Z with arguments, reads ONLY the nine-word matrix at
     * `$31e` — it never looks at an angle. This routine is the only thing
     * that writes that matrix.
     *
     * So on the machine:
     *
     *   - Vec Rot Angles followed by Vec Rot X gives the OLD rotation
     *   - Vec Rot X with no Precalc ever called projects through the zeros
     *     the cleared block starts with, and every point collapses
     *
     * The port recomputed from the angles on each call, which made the
     * keyword unnecessary and quietly fixed a program that had forgotten it.
     *
     * The build itself is transcribed rather than re-derived: it looks up six
     * table entries into `$312`..`$31c` (sine at the angle, cosine a quarter
     * turn on, `addi.w #$200 / andi.w #$7fe`) and then composes them with
     * `muls.w` and `asr.l #$8` throughout. `asr` is a FLOOR, not a truncation
     * toward zero, and at 8-bit fixed point that bias is visible in the
     * output, so it is reproduced with `>>`.
     */
    'vec rot precalc'() {
      vecRotPrecalc(rt)
    },

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
     * Smouse Speed value — routine 170 ($46e2). "The factor by which power of
     * 2 the mouse should be slowed down. 0 is the maximum speed whereas 1 is
     * about the speed of the normal AMOS mouse. Higher values than 4 are not
     * sensible."
     *
     * It is not a plain store. The pointer's position is held pre-shifted, so
     * changing the factor RESCALES it — `asr.w d3,d0` by the old shift and
     * `asl.w d4,d0` by the new, on both axes — which keeps the pointer where
     * it is on screen instead of jumping it. Nothing bounds the value, so the
     * manual's "higher values than 4 are not sensible" is advice rather than
     * a check, and a shift of 15 or more loses the position entirely.
     *
     * NOTE: no test pins the rescale, because nothing in a headless run moves
     * a second mouse — the position is always zero when the keyword is
     * reached, and zero rescales to zero. The arithmetic is here because a
     * program driving a real second mouse would see it.
     */
    'smouse speed'(it) {
      const sm = rt.amcaf.smouse
      const next = it.evalInt()
      const old = sm.speed
      sm.x = (sm.x >> old) << next
      sm.y = (sm.y >> old) << next
      sm.speed = next
    },

    /**
     * Limit Smouse [x1,y1 To x2,y2] — "Defines the region in which the mouse
     * can be moved ... If the parameters are omitted, the full size of the
     * current screen will be used as default."
     *
     * Routines 168 ($4682) and 169 ($46c4), and they share NOTHING with the
     * other two Limit keywords. The port borrowed Splinters' reader for all
     * three; only Splinters and Td Stars actually work that way.
     *
     * The explicit form is thirty bytes and stores the four arguments as they
     * arrive:
     *
     *     move.l (a3)+,d3 / move.l (a3)+,d2 / move.l (a3)+,d1 / move.l (a3)+,d0
     *     move.w d0,$2f8(a2) / move.w d1,$2fa(a2)
     *     move.w d2,$2fc(a2) / move.w d3,$2fe(a2)
     *
     * No `lsl.w #$4` — the second mouse's box is in WHOLE PIXELS, unlike the
     * particle engines' sixteenths. No `subq`, so the far corner is
     * INCLUSIVE. And no `cmp.w`/`exg.l`, so a reversed rectangle is stored
     * reversed rather than normalised, which is a box nothing can be inside.
     *
     * The bare form is the bigger surprise. It does not start at 0,0:
     *
     *     move.w $52(a0),d0 / move.w $54(a0),d1
     *     andi.w #$3ff,d0 / andi.w #$3ff,d1        the screen's DISPLAY position
     *     move.w $4c(a0),d2 / move.w $4e(a0),d3
     *     add.w d0,d2 / add.w d1,d3
     *     subq.w #$1,d2 / subq.w #$1,d3
     *
     * — the box is the screen's place on the HARDWARE display, so a screen
     * put at 190,80 by Screen Display limits the second mouse to 190..190+w-1.
     * That is consistent with the rest of the family: Smouse X/Y and X Smouse
     * are in the same hardware coordinates AMOS's own X Mouse uses, not in
     * screen pixels. `andi.w #$3ff` is the copper's ten-bit horizontal field.
     *
     * NOTE: routine 168 loads `$52c(a5)` without testing it, where the two
     * particle Limits both check. With no screen open it reads through a null
     * pointer; the port answers with the default 128,50 origin instead.
     */
    'limit smouse'(it) {
      const sm = rt.amcaf.smouse
      const s = rt.screen
      if (it.atStmtEnd()) {
        const x = (s?.displayX ?? 128) & 0x3ff
        const y = (s?.displayY ?? 50) & 0x3ff
        sm.limit = { x1: x, y1: y, x2: extW(x + (s?.width ?? 0) - 1), y2: extW(y + (s?.height ?? 0) - 1) }
        return
      }
      const x1 = extW(it.evalInt())
      it.expect(',')
      const y1 = extW(it.evalInt())
      it.expect('to')
      const x2 = extW(it.evalInt())
      it.expect(',')
      const y2 = extW(it.evalInt())
      sm.limit = { x1, y1, x2, y2 }
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

    /**
     * Pt Continue — routine 266 ($616e), "resume where Pt Stop left off", and
     * it is stricter than the port had it.
     *
     *   move.l  $2bc(a2), d0      ; the module address the last Pt Play kept
     *   Rbeq    routine 390       ; nothing to continue -> error 23
     *   cmp.l   #$200000, d0
     *   Rbge    routine 390       ; and it must be in the low 2MB
     *
     * So calling it with nothing ever played is an ERROR rather than a
     * no-op — the port silently did nothing. The 2MB test is Pt Bank's
     * chip-RAM check again, and carries the same DEVIATION: this port models
     * memory type as a flag on the bank rather than as an address, so the
     * comparison has nothing real to make and is not reproduced.
     *
     * Which of routines 376 and 377 it ends in depends on `$296(a2)`, the
     * CIA-versus-VBL flag Pt Cia Speed sets, so the two timings resume through
     * different code.
     */
    'pt continue'() {
      if (rt.amcaf.pt.bank === 0) amcafErr()
      rt.amcaf.pt.playing = true
    },

    /**
     * Pt Bank bank — "if you want to play back instruments from a music
     * module but the music bank has not yet been specified with Pt Play".
     *
     * Routine 263 ($610c) is thirty-four bytes and does no such thing as the
     * Pt Stop an earlier pass credited it with — there is no `Rbsr` in it at
     * all. What it does:
     *
     *     Rjsr    routine 1121            resolve the bank to an address
     *     move.l  d0, $2bc(a2)            keep it, as Pt Continue reads
     *     cmpa.l  #$200000, a0
     *     Rbge    routine 390             at or above 2MB is error 23
     *     moveq   #$0, d1 / moveq #$1, d0
     *     Rbra    routine 381             into the replayer, selector 1
     *
     * Selector 1 of routine 381, the arm at $8a16, is the module SET-UP, and it starts by
     * checking the signature at `$438(a0)` against `M.K.` ($4d2e4b2e) and
     * `M!K!` ($4d214b21) — anything else is error 23. Naming a bank that is
     * not a ProTracker module stops the program.
     *
     * It then resets the replayer: `move.b #$6,-$e(a5)` is speed 6,
     * `move.w #$7d,(a5)` is 125 bpm, and position, row and the four channel
     * states are cleared. `move.b d7,-$c(a5)` stores the d1 the caller passed
     * — ZERO here, one for Pt Play — so Pt Bank prepares a module without
     * starting it.
     *
     * DEVIATION: the 2MB check is NOT reproduced. It compares a real address,
     * and this port models memory type as a flag on the bank rather than an
     * address space, so the nearest equivalent would reject every
     * `Reserve As Work` bank — including on the many machines where all
     * memory is chip and the original passes. Bank To Chip's note already
     * records the same limitation from the other side.
     */
    'pt bank'(it) {
      const n = it.evalInt()
      const pt = rt.amcaf.pt
      pt.bank = n
      pt.playing = false
      pt.pos = 0
      pt.row = 0
      pt.tick = 0
      pt.speed = 6
      pt.bpm = 125
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
     * Routine 247 ($5e50) is the same four-pass shape as Pt Sam Freq:
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
     * Routine 246 ($5df6), and two things it does that the manual's "channel
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
     * Routines 166 and 167 ($465e, $4670) SCALE what they are given by the
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
        rt.amcaf.bltLimit = { x1: 0, y1: 0, x2: s.width - 1, y2: s.height - 1 }
        return
      }
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      /*
       * Routine 61 ($289e) decodes the region exactly as Blitter Clear and
       * Blitter Fill do — see amcafRegion — so x is word-granular and y2 is
       * exclusive. The one difference is what happens when it bails: those
       * two return quietly, this one does `Rbra routine 157`, an ERROR.
       *
       * The stored form is `$358` x1 in words, `$35a` y1, `$35c` the word
       * count and `$35e` the row count. It is kept here as an inclusive box
       * because that is what every reader of bltLimit expects; the conversion
       * is exact.
       */
      const box = amcafRegion(first, y1, x2, y2)
      if (!box) amcafErr()
      rt.amcaf.bltLimit = { x1: box.x, y1: box.y, x2: box.x + box.w - 1, y2: box.y + box.h - 1 }
    },

    /**
     * Blitter Copy s1,p1[,s2,p2[,s3,p3]] To s4,p4[,minterm] — one BITPLANE
     * into another, optionally combining two or three through a minterm.
     *
     * Routine 62 ($28d4) is the short form: it pushes `#$f0` — D = A, a plain
     * copy — and falls into routine 63, which is the explicit-minterm one.
     * Routine 63 resolves each screen with `L_SaveBMHD` and then does the
     * check that matters:
     *
     *     move.w $50(a0), d4        the screen's DEPTH
     *     cmp.w  d4, d7
     *     Rbge   routine 157        plane >= depth is an error, via 390
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
     * single bitplane instead of all." Routine 70 ($2cfe) is the short form
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
      // `sub.w d4,d6 / beq / bmi` and the same for the rows: routine 71 bails
      // with `addq.l #$8,a3 / rts`, which is a no-op and not an error
      const box = amcafRegion(r.x1, r.y1, r.x2, r.y2)
      if (!box) return
      for (let y = Math.max(0, box.y); y < Math.min(s.height, box.y + box.h); y++) {
        for (let x = Math.max(0, box.x); x < Math.min(s.width, box.x + box.w); x++) {
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
      c2pShift(rt, it)
    },
    'c2p fire'(it) {
      c2pFire(rt, it)
    },

    /**
     * Write Cli text$ — writes to the CLI the program was started from.
     *
     * Amos Cli is zero here, so there is no shell to write to; the text goes
     * to the AMOS console, which is where a program running without one would
     * see it anyway.
     */
    'write cli'(it) {
      // Routine 214 ($4fd4). DEVIATION: it writes to the process's own
      // output stream through dos.library, and Amos Cli is zero here, so
      // there is no shell to write to. The text goes to the AMOS console,
      // which is where a program running without one would see it anyway.
      it.write(it.evalStr())
    },

    /**
     * Ppunpack sourcebank To destinationbank — decrunch a PowerPacker BANK
     * into a freshly reserved one. An earlier pass read the two arguments as
     * ADDRESSES and decrunched in place, which is not what routine 236
     * ($59ec) does with either of them:
     *
     *     move.l (a3)+,d7 / move.l (a3)+,d0    the destination, then the source
     *     cmp.l  d0,d7 / Rbeq routine 390      the same bank twice is error 23
     *     Rjsr   routine 1121                  resolve the SOURCE to an address
     *     ...
     *     lea    $5a78(pc),a0                  "Work    "
     *     Rjsr   routine 1103                  RESERVE the destination
     *
     * The size it reserves is the decrunched length, which PP20 keeps in the
     * top three bytes of its last long -- `move.l -$4(a0,d6.l),d2 / lsr.l
     * #$8,d2`, where d6 is the bank's own length less sixteen. The decrunch
     * itself is powerpacker.library's, `movea.l $36c(a2),a6 / jsr -$24(a6)`,
     * which is ppDecrunchBuffer; `src/amiga/powerpacker.ts` has had the codec
     * since the LDos work.
     *
     * A NEGATIVE destination means chip memory, the same `bpl.b / neg.l d0`
     * convention Wload uses -- here the sign chooses the type it passes to
     * Reserve, `moveq #$2,d1`.
     *
     * The three requester messages come straight off the checks: `move.w
     * -$c(a0),d0 / andi.w #$c,d0` rejects an icon or sprite bank with message
     * 4, "PX20" is message 7 ("File/bank is encrypted"), and anything that is
     * neither is message 8. None of them existed here.
     */
    'ppunpack'(it) {
      const src = it.evalInt()
      it.expect('to')
      const arg = it.evalInt()
      if (src === arg) amcafErr()
      // NOTE: the kind bits live in the bank header twelve bytes below the
      // data, which this port has no equivalent of; banks 1 and 2 are the
      // sprite and icon banks by AMOS convention and stand in for them
      if ((src === 1 && rt.spriteBank) || (src === 2 && rt.iconBank)) amcafMsg(4)
      const bank = rt.memBanks.get(src)
      if (!bank) amcafErr()
      const sig = String.fromCharCode(...bank.data.subarray(0, 4))
      if (sig === 'PX20') amcafMsg(7)
      if (sig !== 'PP20') amcafMsg(8)
      let out: Uint8Array
      try {
        out = pp20Decrunch(bank.data)
      } catch {
        amcafMsg(8)
      }
      const chip = arg < 0
      const n = chip ? -arg : arg
      rt.reserveBank(n, out.length, 'Work    ', false, chip)
      rt.memBanks.get(n)!.data.set(out)
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
     *     rnc unpack (routine 276, $63c0, 6 bytes)
     *         move.l (a3)+,d5 / move.l (a3)+,d0 / rts
     *     rnp        (routine 277, $63c6, 2 bytes)
     *         rts
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

/** routine 394 — the guard on `$52c(a5)`, taken when no screen is open */
const amcafScreenErr: () => never = () => {
  throw new AmosError('Screen not opened', 47)
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
 * The month splitter — 1.40's routine 338 ($811e), which no token names: Cd Month
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
 * Cd Weekday — routine 325 ($7140), 1.40's 311 ($73ec): `(days + 6) divu 7`, remainder plus one.
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
 * Fill the FileInfoBlock, which is what `Examine` actually does — the
 * accessors afterwards are pure reads of it.
 *
 * NOTE: an earlier pass gave every accessor an optional path argument and had
 * it re-query the VFS on each call. The routines take no argument at all (12
 * to 20 bytes each, no library call in any of them) and the token table agrees,
 * specifying `"0"` or `"2"` — zero parameters — for all eight. Both halves of
 * that were wrong: the syntax accepted an argument AMOS never passes, and the
 * values tracked the live filesystem where the real extension reports whatever
 * the last Examine captured.
 */
/**
 * What all five Scrn pointers do: raise error 47 with no screen open, and
 * otherwise answer 0 because there is no address space to point into.
 */
function scrnPtr(rt: Runtime): Value {
  if (!rt.screen) amcafScreenErr()
  return VI(0)
}

function captureFib(rt: Runtime, path: string): AmcafFib {
  const kind = rt.vfs?.exists(path) ?? null
  if (kind === null) return EMPTY_FIB
  const m = rt.vfs?.meta(path)
  const size = kind === 'file' ? (rt.vfs?.readFile(path)?.length ?? 0) : 0
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf(':'))
  return {
    type: entryType(kind === 'dir'),
    name: cut >= 0 ? path.slice(cut + 1) : path,
    protection: m?.protection ?? 0,
    size,
    blocks: blocksFor(size),
    days: m?.days ?? 0,
    mins: m?.mins ?? 0,
    ticks: m?.ticks ?? 0,
    comment: m?.comment ?? '',
  }
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
 * `Io Error$` texts — AMCAF's OWN table, read out of the binary.
 *
 * An earlier pass wrote "AMCAF ships no strings at all" and listed dos.library
 * codes from memory. It ships twenty-six of them. Routine 173 is a four-byte
 * `Rbra routine 383`, and 383 ($a508) opens with a Kickstart check:
 *
 *     Rbsr routine 372                 movea.l $4.w,a0 / move.w $14(a0),d0
 *     cmp.w #$25,d0 / blt.b $a53c      exec.library's version, against 2.0
 *
 * At 37 or above it calls dos.library Fault() at `jsr -$1d4(a6)` with an EMPTY
 * header (four zero bytes at $a562), a 128-byte buffer at $21b2, and then
 * takes the result from $21b4 -- two bytes in, because Fault writes ": " in
 * front of the text even when the header is empty. Below 37 it walks this
 * table instead: a code byte, a NUL-terminated string, and a zero code to end.
 * It runs to $a7c6, which is exactly where routine 384 begins.
 *
 * The strings below are that table, character for character. DEVIATION: the
 * modelled machine is a Kickstart 3 A1200, so the real routine would take the
 * Fault() arm and dos.library's wording would win where the two differ. There
 * is no Fault() here to call, and this table is at least the same extension's
 * idea of the same errors. Anything not listed gets the empty string, which is
 * what both arms give: "If no error number exists, an empty string will be
 * returned".
 */
const DOS_ERRORS: Record<number, string> = {
  49: 'file not executable',
  103: 'not enough memory available',
  121: 'file is not executable',
  202: 'object is in use',
  203: 'object already exists',
  204: 'directory not found',
  205: 'object not found',
  207: 'object is too large',
  210: 'object name invalid',
  211: 'invalid object lock',
  212: 'object is not of required type',
  213: 'disk is not validated',
  214: 'disk is write-protected',
  215: 'rename across devices attempted',
  216: 'directory not empty',
  217: 'too many levels',
  218: 'device (or volume) is not mounted',
  219: 'seek failure',
  220: 'comment is too long',
  221: 'disk full',
  222: 'object is protected from deletion',
  223: 'file is write protected',
  224: 'file is read protected',
  225: 'not a valid DOS disk',
  226: 'no disk in drive',
  232: 'no more entries in directory',
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
 * How far apart two 12-bit colours are, by that table.
 *
 * The binary carries the table TWICE — `lea $3170(pc),a2` in routine 83
 * (Best Pen) and `lea $458a(pc),a2` in routine 162 (Ham Best) — and the
 * sixteen bytes at those two addresses are identical, as is the code that
 * reads them: three `move.b (a2,dn.w)` on the absolute per-gun differences,
 * summed as words. So it is one metric with two copies, not two metrics.
 */
const penDist = (a: number, b: number): number =>
  BEST_PEN_WEIGHT[Math.abs(rV(a) - rV(b))]! +
  BEST_PEN_WEIGHT[Math.abs(gV(a) - gV(b))]! +
  BEST_PEN_WEIGHT[Math.abs(bV(a) - bV(b))]!

/**
 * HAM6's control byte, which is what `Ham Colour` decodes.
 *
 * Bits 4-5 choose: 00 take the palette entry whole, 01 replace BLUE, 10
 * replace RED, 11 replace GREEN, with the low four bits as the new component.
 * That is why the manual says a HAM pixel's colour depends on "the colour of
 * the pixel exactly before the current dot".
 */
function hamApply(c: number, oldRgb: number, palette: Uint16Array): number {
  // Routine 161 ($440a) does NOT decode this as two bits and a nibble. It is
  // a chain of unsigned WORD compares whose last arm is an open `else`, not a
  // range check, so the control is not confined to 0..63 and an earlier pass
  // masking it with `& 63` gave a different answer above that:
  //
  //   d0 <= $f    add.w d0,d0 / move.w $62(a1,d0.w),d3   palette, 16 entries
  //   d0 <= $1f   subi #$10 / andi.b #$f0,d3 / or.b      set BLUE
  //   d0 <= $2f   subi #$20 / lsl.w #8 / andi.w #$ff,d3  set RED
  //   else        subi #$30 / lsl.b #4 / andi.b #$f,d3   set GREEN
  //
  // The last arm's shift is `lsl.b`, a BYTE, so a control of 64 becomes
  // 64-48 = $10 and shifts clean out of the byte for a green of 0 — where the
  // mask turned 64 into 0 and took the palette branch instead.
  const w = c & 0xffff
  if (w <= 0x0f) return palette[w] ?? 0
  if (w <= 0x1f) return glue(rV(oldRgb), gV(oldRgb), w - 0x10)
  if (w <= 0x2f) return glue(w - 0x20, gV(oldRgb), bV(oldRgb))
  return glue(rV(oldRgb), (w - 0x30) & 0x0f, bV(oldRgb))
}

/**
 * The inverse: which control byte gets closest to `want` from `prev`.
 * Routine 162 ($445c), 318 bytes.
 *
 * "As you cannot achieve the desired colour by plotting only one pixel in
 * [HAM]", so the routine searches — but it does NOT try all 64 controls, and
 * it does not measure with a sum of squares. An earlier pass did both.
 *
 * There are only NINETEEN candidates: the sixteen palette entries, and one
 * per modify arm. A modify arm has exactly one sensible nibble, the one the
 * target already asks for, so the routine builds each candidate directly —
 * `move.w d6,d4 / andi.w #$f00,d4 / move.w d7,d0 / andi.w #$ff,d0 / or.w d4,d0`
 * is the RED arm: the wanted red over the previous green and blue.
 *
 * The metric is `penDist`, shared with Best Pen (`lea $458a(pc),a2`).
 *
 * The order matters, because ties go to whoever is measured LAST — every
 * comparison is `cmp.w d0,d5 / blt`, which skips only on a strictly better
 * incumbent. The order is: palette 15 DOWN to 0 (`lea $82(a1),a0` then
 * `move.w -(a0),d0` with `dbra d4` from $f), then RED ($20), GREEN ($30),
 * BLUE ($10). So a tie between palette entries goes to the lower index, and a
 * tie between a palette entry and a modify goes to the modify.
 *
 * Any candidate that matches exactly returns at once, so a palette entry that
 * hits the target beats an equally exact modify.
 */
function hamBest(want: number, prev: number, palette: Uint16Array): number {
  // `cmp.w d6,d7 / beq` — nothing to change. It asks for the blue that is
  // already there rather than searching, and answers before the palette is
  // even looked at. NOTE: the return is built with `move.l d6,d3 /
  // andi.w #$f,d3 / addi.w #$10,d3`, a LONG move narrowed by word operations,
  // so the high word of the argument survives into the result — the only
  // path in the routine that leaks it.
  if ((want & 0xffff) === (prev & 0xffff)) return (want & ~0xffff) | (0x10 + (want & 0xf))

  let best = 0
  let bestD = 1000 // `move.w #$3e8,d5`
  for (let i = 15; i >= 0; i--) {
    const d = penDist(palette[i] ?? 0, want)
    if (d === 0) return i
    if (bestD >= d) {
      bestD = d
      best = i
    }
  }
  const arms: [number, number][] = [
    [0x20 + rV(want), (want & 0xf00) | (prev & 0x0ff)], // set RED
    [0x30 + gV(want), (want & 0x0f0) | (prev & 0xf0f)], // set GREEN
    [0x10 + bV(want), (want & 0x00f) | (prev & 0xff0)], // set BLUE
  ]
  for (const [control, got] of arms) {
    const d = penDist(got, want)
    if (d === 0) return control
    if (bestD >= d) {
      bestD = d
      best = control
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
 * The shared body of Shade Bob Up and Down — routines 286 ($6644) and 287
 * ($67e2), which share their whole set-up with routine 384 ($a7c6).
 *
 * A shade bob is not a bob: it takes an image's SHAPE and uses it to bump the
 * colour index of whatever it lands on. The bump is a bit-serial ripple carry
 * across the bitplanes, and it is the one place the two routines differ:
 *
 *     move.w (a1),d0 / move.w d0,d2      Up, at $66d0
 *     eor.w  d1,d0   / move.w d0,(a1)
 *     and.w  d2,d1                       carry out = the mask AND the OLD bits
 *
 *     move.w (a1),d0                     Down, at $686e
 *     eor.w  d1,d0   / move.w d0,(a1)
 *     and.w  d0,d1                       borrow  = the mask AND the NEW bits
 *
 * XOR is the sum bit either way; `d1 & old` propagates a carry (an add of one)
 * and `d1 & new` propagates a borrow (a subtract of one). `dbra d5` runs it
 * over `Shade Bob Planes` planes, so it WRAPS within them rather than
 * saturating, and leaves the planes above untouched.
 *
 * The set-up in 384 pops last-argument-first — image, y, x, screen — reads the
 * image record's five-word header, and subtracts the hot spot, which is how
 * the manual's "supports the hot spot of the bob image" is done. It then walks
 * the screen's plane pointers looking for the first NULL and lowers the plane
 * count to match, so a six-plane setting on a three-plane screen shades three;
 * that clamp needs no code here, because writing a value wider than the screen
 * drops the high bits to the same effect.
 *
 * Clipping is by whole words on the left and right and by whole rows top and
 * bottom, with a barrel shift ($67a0) for an x that is not a multiple of 16 —
 * the net effect is an exact clip to the screen, which `point`/`putPixel`
 * already give. Neither the RastPort clip nor Set Planes is consulted: the
 * routine walks the plane pointers itself, which is why `putPixel` is the
 * right primitive and not `plot`.
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
  /*
   * DEFECT: the hot spot X is truncated to a signed byte and the hot spot Y is
   * not. Routine 384 reads the two adjacent header words the same way and then
   * sign-extends only one of them:
   *
   *     move.w $8(a1),d0            the hot spot Y, a whole word
   *     move.l (a3)+,d1 / sub.w d0,d1 / move.w d1,$248(a2)
   *     move.w $6(a1),d0 / ext.w d0     ($a80c is 48 80, EXT.W D0)
   *     move.l (a3)+,d1 / sub.w d0,d1 / move.w d1,$246(a2)
   *
   * Bob images are usually narrower than 128 pixels, so a hot spot inside the
   * shape is unaffected and the bug stays invisible. On a wider image it is
   * not: a hot spot X of 160 reads as -96, and the shade lands 256 pixels to
   * the right of where every other AMOS command puts the same bob.
   */
  const hotX = (img.hotX << 24) >> 24
  const mask = (1 << rt.amcaf.shadePlanes) - 1
  const px = img.pixels
  for (let iy = 0; iy < img.height; iy++) {
    for (let ix = 0; ix < img.width; ix++) {
      // the mask, or the first bitplane, decides where the bob touches
      const on = rt.amcaf.shadeMask ? px[iy * img.width + ix]! !== 0 : (px[iy * img.width + ix]! & 1) !== 0
      if (!on) continue
      const sx = x + ix - hotX
      const sy = y + iy - img.hotY
      const v = s.rp.point(sx, sy)
      if (v < 0) continue
      s.rp.putPixel(sx, sy, (v & ~mask) | ((v + dir) & mask))
    }
  }
  s.rp.bitMap.invalidate()
}

/**
 * The shared body of the four Pix commands — routines 226/227 (Shift Up),
 * 228/229 (Shift Down), 230/231 (Brighten) and 232/233 (Darken), each a pair
 * with and without the mask bank.
 *
 * `cyclic` is the difference between the pairs: Pix Shift Up/Down wrap round
 * the c1..c2 range, Pix Brighten/Darken stop at its ends. Colours outside the
 * range are "not affected" either way — `cmp.b $10(a7),d4 / bmi` and
 * `cmp.b $12(a7),d4 / bhi` skip the pixel, and the wrap is `addq.b #$1,d4 /
 * cmp.b $12(a7),d4 / ble` falling through to `move.b $10(a7),d4`.
 *
 * The far corner is EXCLUSIVE: `sub.w d4,d6 / sub.w d5,d7 / subq.w #$1,d6 /
 * subq.w #$1,d7` and then dbra. An earlier pass had it inclusive, and the
 * `subq` pair was invisible because extdis rendered those six bytes as the
 * text run "SFSG?F" — see the note in src/cli/extdis.ts.
 *
 * NOTE: c1 and c2 are stored as BYTES (`move.b d1,(a7)` and `move.b d2,
 * $2(a7)`), so a colour above 255 wraps into range. NOTE: the two range
 * comparisons are not the same kind — `bmi` against c1 is SIGNED and `bhi`
 * against c2 is UNSIGNED — which cannot be told apart within a byte's 0..63
 * of real colours. NOTE: a degenerate box does not error; the subq underflows
 * to $ffff and the dbra runs 65536 times, the same runaway Bzoom has. Doing
 * nothing is this port's answer to that.
 */
function pixShift(rt: Runtime, it: Interp, dir: number, cyclic: boolean): void {
  const s = rt.screens.get(it.evalInt())
  it.expect(',')
  const c1 = it.evalInt() & 0xff
  it.expect(',')
  const c2 = it.evalInt() & 0xff
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
  const w = x2 - x1
  const h = y2 - y1
  if (w <= 0 || h <= 0) return // see the NOTE on the runaway
  const span = c2 - c1 + 1
  for (let y = y1; y < y1 + h; y++) {
    for (let x = x1; x < x1 + w; x++) {
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
}

/**
 * AMCAF's region decode, which routines 61, 71 and 75 share instruction for
 * instruction — Blitter Copy Limit, Blitter Clear and Blitter Fill:
 *
 *     move.l (a3)+,d5 / move.w d5,$33e(a2)     y1, kept
 *     move.l (a3)+,d4 / lsr.w #$4,d4           x1 DOWN to a 16-pixel boundary
 *     addi.w #$f,d6 / lsr.w #$4,d6             x2 UP to one
 *     sub.w d4,d6 / beq bail / bmi bail        the WORD count
 *     sub.w d5,d7 / beq bail / bmi bail        the ROW count
 *
 * So x is word-granular in both directions and y2 is exclusive, and a zero or
 * reversed extent bails before anything happens. The port worked in whole
 * pixels and treated both corners as inclusive.
 *
 * Returns null when the routine would bail; the CALLER decides what that
 * means, because the three do not agree: Blitter Clear and Blitter Fill do
 * `addq.l #$8,a3 / rts`, popping their remaining arguments and doing nothing,
 * while Blitter Copy Limit does `Rbra routine 157` — an error.
 */
function amcafRegion(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number; w: number; h: number } | null {
  const wx1 = (x1 & 0xffff) >> 4
  const wx2 = ((x2 & 0xffff) + 0xf) >> 4
  const words = ((wx2 - wx1) << 16) >> 16
  const rows = ((y2 - y1) << 16) >> 16
  if (words <= 0 || rows <= 0) return null
  return { x: wx1 * 16, y: y1, w: words * 16, h: rows }
}

/**
 * BltMaskBitMapRastPort, graphics.library -$27c — which is the whole of what
 * all three Mask Copy routines do once they have marshalled their arguments.
 * See the `mask copy` handler for the marshalling and for why the minterm is
 * not honoured.
 */
function maskBlit(
  rt: Runtime,
  src: Screen,
  dst: Screen,
  xs: number,
  ys: number,
  w: number,
  h: number,
  xd: number,
  yd: number,
  maskAddr: number,
): void {
  const mask = maskAddr === 0 ? null : rt.resolveAddr(maskAddr)
  const bpr = src.rp.bitMap.bytesPerRow
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask) {
        const off = mask.off + (ys + y) * bpr + ((xs + x) >> 3)
        const bit = 0x80 >> ((xs + x) & 7)
        if (off >= mask.data.length || !(mask.data[off]! & bit)) continue
      }
      const v = src.rp.point(xs + x, ys + y)
      if (v >= 0) dst.rp.putPixel(xd + x, yd + y, v)
    }
  }
  dst.rp.bitMap.invalidate()
}

/**
 * The Coords bank's eight-byte header, which three routines agree on.
 *
 * Routine 94 ($33e6) lays it down —
 *
 *     move.w d7,(a0)+ / clr.w (a0)+ / moveq #$8,d0 / move.l d0,(a0)
 *
 * routine 95 ($3422) fills the entries and rewrites the count, and routine
 * 385 ($a88a) hands them out one at a time:
 *
 *     move.w (a3),d0 / move.w $2(a3),d1 / cmp.w d0,d1 / beq    exhausted
 *     addq.w #$1,$2(a3) / move.l $4(a3),d0
 *     move.l (a3,d0.l),(a0) / addq.l #$4,$4(a3)
 *
 *     +0  word  the COUNT of coordinates
 *     +2  word  the CURSOR — how many have been handed out
 *     +4  long  the byte offset of the next entry, starting at 8
 *     +8..      four bytes each: x<<4 then y<<4, as words
 *
 * The `<<4` is not decoration. Routine 386 moves a splinter in the same
 * units — `move.w (a0),d2 / add.w $c(a0),d2` and then `lsr.w #$4,d2` to
 * reach a pixel — so a bank coordinate IS a splinter coordinate, in
 * sixteenths of a pixel, and routine 385 copies one straight across with a
 * single `move.l`.
 */
const COORDS_HEADER = 8

function coordsView(rt: Runtime, n: number): DataView | null {
  const b = rt.memBanks.get(n)
  if (!b || b.kind !== 'memory' || b.data.length < COORDS_HEADER) return null
  return new DataView(b.data.buffer, b.data.byteOffset, b.data.byteLength)
}

/* ------------------------------------------------------------------ *
 * The Splinters engine
 * ------------------------------------------------------------------ */

/**
 * A splinter is twenty-two bytes in the bank, and every field below is read
 * straight out of routines 385 ($a88a) and 386 ($a904).
 *
 *     +$00 word  x, in sixteenths of a pixel
 *     +$02 word  y, in sixteenths
 *     +$04 long  the flat BIT index of the pixel: (y>>4)*width + (x>>4)
 *     +$08 long  the previous +$04, saved at the top of every Move
 *     +$0c word  vx, sixteenths per step
 *     +$0e word  vy
 *     +$10 byte  the splinter's own colour; $ff means FREE
 *     +$11 byte  the background under +$04; $ff means nothing saved
 *     +$12 byte  the background under +$08 — the generation before it
 *     +$13 byte  the spawn marker: $ff fresh, 1 half-cleared, 0 settled
 *     +$14 word  life, counted down by every Move
 *
 * The four bytes from $10 to $13 are one longword to routine 295, which
 * writes $ffffffff over them to free the whole table, and the pair at $10/$11
 * is one word to routine 303, which counts a splinter as active unless all
 * three colour bytes are $ff.
 */
const SPL = 22
const SPL_X = 0x00
const SPL_Y = 0x02
const SPL_IDX = 0x04
const SPL_PIDX = 0x08
const SPL_VX = 0x0c
const SPL_VY = 0x0e
const SPL_COLOUR = 0x10
const SPL_BACK = 0x11
const SPL_PBACK = 0x12
const SPL_FRESH = 0x13
const SPL_LIFE = 0x14

/** the splinter table, or null when no bank has been named — error 23 to callers */
function splinterTable(rt: Runtime): DataView | null {
  const sp = rt.amcaf.splinters
  if (!sp.bank) return null
  const b = rt.memBanks.get(sp.bank)
  if (!b || b.kind !== 'memory' || b.data.length < sp.max * SPL) return null
  return new DataView(b.data.buffer, b.data.byteOffset, b.data.byteLength)
}

/**
 * A pixel by FLAT BIT INDEX, which is how all four drawing routines address
 * the screen:
 *
 *     move.l  $4(a0),d1
 *     move.b  d1,d2 / not.b d2          the bit, counted from the left
 *     lsr.l   #$3,d1                    the byte
 *     movea.l (a1)+,a2                  plane 0, then 1, then 2 ...
 *     bclr.b  d2,(a2,d1.l)  /  bset.b d2,(a2,d1.l)
 *
 * — one `dbra` over `$27c(a2)+1` planes, so only the planes Splinters Colour
 * named are touched and anything above them survives, which is the point of
 * that keyword's second argument.
 *
 * Routine 386 builds the index as `(y>>4) * $4c(a4) + (x>>4)`, and `$4c` is
 * the screen's WIDTH IN PIXELS. That is only the same as the bitplane row
 * width when the width is a multiple of eight, and AMOS rounds screen widths
 * up to sixteen — but a bank image with an odd width would skew, and it skews
 * here the same way, because the index is computed the same way.
 *
 * NOTE: the range check is the port's. The 68k writes wherever the index
 * lands, which is exactly what the manual warns about for the sister engine —
 * "These coordinates must lie WITHIN the screen dimensions, otherwise the
 * stars could corrupt your memory". Here an index outside the planes is
 * dropped rather than allowed to corrupt the heap.
 */
function splPeek(bm: BitMap, idx: number, top: number): number {
  const p = bm.planeBytes()
  const byte = idx >>> 3
  const bit = ~idx & 7
  let c = 0
  for (let n = 0; n <= top && n < bm.depth; n++) {
    const at = n * bm.planeSize + byte
    if (at >= p.length) break
    if (p[at]! & (1 << bit)) c |= 1 << n
  }
  return c
}

function splPoke(bm: BitMap, idx: number, colour: number, top: number): void {
  const p = bm.planeBytes(true)
  const byte = idx >>> 3
  const bit = ~idx & 7
  for (let n = 0; n <= top && n < bm.depth; n++) {
    const at = n * bm.planeSize + byte
    if (at >= p.length) break
    if (colour & (1 << n)) p[at]! |= 1 << bit
    else p[at]! &= ~(1 << bit)
  }
}

/**
 * Routine 385 ($a88a) — give one splinter a new life from the coordinate bank.
 *
 * `d5` is the allowance routine 300 loaded from `$282` once per Move and
 * every respawn decrements, so it is passed and returned here. Two ways to
 * fail, and both mark the splinter dead rather than raising anything:
 *
 *     tst.w d5 / beq  dead              the Splinters Max allowance is spent
 *     move.w (a3),d0 / move.w $2(a3),d1 / cmp.w d0,d1 / beq dead
 *                                       the coordinate list is exhausted
 *  dead:
 *     st.b $10(a0) / st.b $11(a0)       free, with no background to restore
 *
 * A live respawn takes the next four bytes the bank's cursor points at —
 * `move.l (a3,d0.l),(a0)` copies x and y across in ONE instruction, because a
 * bank coordinate and a splinter coordinate are the same sixteenths — then
 * advances both the cursor and the byte offset, clears the colour, marks the
 * splinter fresh with `st.b $13(a0)`, blanks the saved background, takes the
 * fuel from `$27e` and rolls two speeds off the beam.
 */
function splinterSpawn(
  rt: Runtime,
  v: DataView,
  o: number,
  cv: DataView | null,
  allowance: number,
  d6: { v: number },
): number {
  const sp = rt.amcaf.splinters
  const dead = (): number => {
    v.setUint8(o + SPL_COLOUR, 0xff)
    v.setUint8(o + SPL_BACK, 0xff)
    return allowance
  }
  if (allowance === 0 || !cv) return dead()
  const count = cv.getUint16(0)
  const cursor = cv.getUint16(2)
  if (cursor === count) return dead()
  const off = cv.getUint32(4)
  if (off + 4 > cv.byteLength) return dead()

  cv.setUint16(2, (cursor + 1) & 0xffff)
  const x = cv.getUint16(off)
  const y = cv.getUint16(off + 2)
  cv.setUint32(4, off + 4)
  v.setUint16(o + SPL_X, x)
  v.setUint16(o + SPL_Y, y)
  v.setUint32(o + SPL_IDX, splIndex(rt, x, y))
  v.setUint8(o + SPL_COLOUR, 0)
  v.setUint8(o + SPL_FRESH, 0xff)
  v.setUint8(o + SPL_BACK, 0xff)
  v.setUint16(o + SPL_LIFE, sp.fuel)
  v.setInt16(o + SPL_VX, splRandomSpeed(rt, d6))
  v.setInt16(o + SPL_VY, splRandomSpeed(rt, d6))
  return allowance - 1
}

/** `(y>>4) * $4c(a4) + (x>>4)` — the `lsr.w` is logical, so the words are unsigned */
function splIndex(rt: Runtime, x: number, y: number): number {
  const w = rt.screen?.width ?? 0
  return (((y & 0xffff) >>> 4) * w + ((x & 0xffff) >>> 4)) >>> 0
}

/**
 * `andi.w #$3f` off the beam, retried while zero, then `subi.w #$1f`:
 *
 *     add.w   (a1),d6 / move.w d6,d0 / andi.w #$3f,d0 / beq (retry)
 *     subi.w  #$1f,d0
 *
 * so a speed is 1..63 less 31 — anything from -30 to +32 sixteenths a step,
 * and never a dead stop. `a1` is $dff006, VHPOSR.
 *
 * The retry is the guard's reason. On the machine the beam has moved by the
 * time the loop comes round, so a zero is always transient; the modelled beam
 * stands still inside a keyword, so if `beamWord() & $3f` is zero the
 * accumulator never changes and the loop never ends. Sixty-four attempts is
 * more than the hardware would ever need, and taking the zero after that
 * gives -31, which is inside the range the routine produces anyway.
 */
function splRandomSpeed(rt: Runtime, d6: { v: number }): number {
  let d0 = 0
  for (let i = 0; i < 64; i++) {
    d6.v = (d6.v + rt.interp.beamWord()) & 0xffff
    d0 = d6.v & 0x3f
    if (d0 !== 0) break
  }
  return extW(d0 - 0x1f)
}

/**
 * Routine 300 ($6c32) plus routine 386 ($a904), one step for the whole table.
 *
 * Routine 300 is the loop and the argument setup: the table at `$26a`, the
 * count at `$280`, the coordinate bank at `$266` — a missing one is error 23
 * before anything moves — the allowance from `$282`, and the beam into d6.
 * Then `Rbsr routine 386` once per splinter with `lea $16(a0),a0` between.
 *
 * Routine 386 itself:
 *
 *     move.l  $4(a0),$8(a0)             the generations shift, ALWAYS, even
 *     move.b  $11(a0),$12(a0)           for a splinter about to respawn
 *     move.b  $10(a0),d0 / cmp.b #$ff,d0 / Rbeq routine 385
 *     tst.b   $13(a0) / beq / rts       a fresh splinter sits still one step
 *     tst.w   $14(a0) / Rbeq routine 385
 *     subq.w  #$1,$14(a0)
 *     move.w  (a0),d2 / add.w $c(a0),d2         x += vx, as WORDS
 *     cmp.w   $26e(a2),d2 / bmi  out            x <  x1
 *     cmp.w   $272(a2),d2 / bpl  out            x >= x2   <- EXCLUSIVE
 *     ... and the same pair for y ...
 *     move.w  $276(a2),d2 / add.w d2,$c(a0)     gravity, after the move
 *  out: Rbra routine 385
 *
 * Three things the port had wrong beyond the model. The far corner is
 * exclusive, so a splinter reaching x2 respawns rather than sitting on the
 * edge. Leaving the limit does not DELETE a splinter — it respawns it, which
 * is what makes an endless field endless. And the arithmetic is 16-bit
 * throughout: `add.w` wraps, and the comparisons are signed words.
 */
function splintersMove(rt: Runtime): void {
  const sp = rt.amcaf.splinters
  const v = splinterTable(rt)
  if (!v) amcafErr()
  if (!sp.coordsBank) amcafErr()
  const cv = coordsView(rt, sp.coordsBank)
  /*
   * NOTE: routine 300 loads `$52c(a5)` into a4 and never tests it, so with no
   * screen open routine 386's `mulu.w $4c(a4),d3` reads through a null
   * pointer. Error 47 stands in for a machine that would take a bus error;
   * every other routine in the family checks, and 300 is the one that forgot.
   */
  if (!rt.screen) throw new AmosError('Screen not opened', 47)

  // d6 and d5 are registers routine 300 holds for the length of ONE Move and
  // routines 385/386 update as they go; they do not outlive the keyword
  const d6 = { v: rt.interp.beamWord() & 0xffff }
  let allowance = sp.maxNew & 0xffff
  const lim = sp.limit

  for (let i = 0; i < sp.max; i++) {
    const o = i * SPL
    v.setUint32(o + SPL_PIDX, v.getUint32(o + SPL_IDX))
    v.setUint8(o + SPL_PBACK, v.getUint8(o + SPL_BACK))

    if (v.getUint8(o + SPL_COLOUR) === 0xff) {
      allowance = splinterSpawn(rt, v, o, cv, allowance, d6)
      continue
    }
    if (v.getUint8(o + SPL_FRESH) !== 0) continue
    if (v.getUint16(o + SPL_LIFE) === 0) {
      allowance = splinterSpawn(rt, v, o, cv, allowance, d6)
      continue
    }
    v.setUint16(o + SPL_LIFE, v.getUint16(o + SPL_LIFE) - 1)

    const x = extW(v.getInt16(o + SPL_X) + v.getInt16(o + SPL_VX))
    const y = extW(v.getInt16(o + SPL_Y) + v.getInt16(o + SPL_VY))
    if (x < lim.x1 || y < lim.y1 || x >= lim.x2 || y >= lim.y2) {
      allowance = splinterSpawn(rt, v, o, cv, allowance, d6)
      continue
    }
    v.setInt16(o + SPL_X, x)
    v.setInt16(o + SPL_Y, y)
    v.setUint32(o + SPL_IDX, splIndex(rt, x, y))
    v.setInt16(o + SPL_VX, extW(v.getInt16(o + SPL_VX) + sp.gx))
    v.setInt16(o + SPL_VY, extW(v.getInt16(o + SPL_VY) + sp.gy))
  }
}

/**
 * Routine 301 ($6c74) — Splinters Back, which does TWO jobs.
 *
 *     move.b  $10(a0),d5 / cmp.b #$ff,d5 / beq next     skip the free ones
 *     ... read the pixel at $4(a0) across $27c+1 planes into d5 ...
 *     move.b  d5,$11(a0)                                the background
 *     cmpi.b  #$ff,$13(a0) / bne next
 *     move.b  d5,$10(a0)                                <- and the COLOUR
 *
 * The second is the whole engine's premise: "they don't destroy the
 * background and use the colour of the pixel they have removed". A splinter
 * takes its colour on the first Back after it spawns, from whatever was on the
 * screen where the coordinate list put it. The colour is not in the bank and
 * nothing else supplies it — which is why the manual insists Back comes
 * before Draw in the cycle.
 */
function splintersBack(rt: Runtime): void {
  const sp = rt.amcaf.splinters
  const v = splinterTable(rt)
  if (!v) amcafErr()
  const s = rt.screen
  if (!s) throw new AmosError('Screen not opened', 47)

  for (let i = 0; i < sp.max; i++) {
    const o = i * SPL
    if (v.getUint8(o + SPL_COLOUR) === 0xff) continue
    const c = splPeek(s.rp.bitMap, v.getUint32(o + SPL_IDX), sp.topPlane)
    v.setUint8(o + SPL_BACK, c)
    if (v.getUint8(o + SPL_FRESH) === 0xff) v.setUint8(o + SPL_COLOUR, c)
  }
}

/** Routine 302 ($6ce2) — the colour at `+$10` onto the pixel at `+$4`, free ones skipped */
function splintersDraw(rt: Runtime): void {
  const sp = rt.amcaf.splinters
  const v = splinterTable(rt)
  if (!v) amcafErr()
  const s = rt.screen
  if (!s) throw new AmosError('Screen not opened', 47)

  for (let i = 0; i < sp.max; i++) {
    const o = i * SPL
    const c = v.getUint8(o + SPL_COLOUR)
    if (c === 0xff) continue
    splPoke(s.rp.bitMap, v.getUint32(o + SPL_IDX), c, sp.topPlane)
  }
  s.rp.bitMap.invalidate()
}

/**
 * Routines 298 ($6aa4) and 299 ($6b66) — Splinters Single Del and Double Del.
 *
 * Each is TWO passes over the table, and the second is the one nothing in the
 * manual prepares you for.
 *
 * The first pass puts the background back: Single reads the colour at `+$11`
 * and the position at `+$4`, Double reads `+$12` and `+$8`. A saved colour of
 * $ff means there is nothing to restore. Single additionally skips any
 * splinter whose `+$13` is set, because a fresh one has never been drawn.
 *
 * The second pass is the HOLE. A splinter lifted its colour off the picture,
 * so where it came from has to be filled with `$27b` — the byte Splinters
 * Colour stored — and that happens once, on the first Del after the spawn:
 *
 *     tst.b   $13(a0) / beq next          only a fresh splinter
 *     move.b  $11(a0),d0 / cmp.b #$ff,d0 / beq next
 *     clr.b   $13(a0)                     ... and only once
 *     ... write $27b(a2) at $4(a0) ...
 *
 * Double Del does the same with a two-stage counter instead, `$ff -> 1 -> 0`,
 * so the hole is punched into BOTH buffers of a double-buffered screen before
 * the marker clears. That is the only difference between the two second
 * passes, and it is the reason `+$13` holds $ff rather than a plain flag.
 */
function splintersDel(rt: Runtime, double: boolean): void {
  const sp = rt.amcaf.splinters
  const v = splinterTable(rt)
  if (!v) amcafErr()
  const s = rt.screen
  if (!s) throw new AmosError('Screen not opened', 47)
  const bm = s.rp.bitMap

  for (let i = 0; i < sp.max; i++) {
    const o = i * SPL
    const saved = v.getUint8(o + (double ? SPL_PBACK : SPL_BACK))
    if (saved === 0xff) continue
    if (!double && v.getUint8(o + SPL_FRESH) !== 0) continue
    splPoke(bm, v.getUint32(o + (double ? SPL_PIDX : SPL_IDX)), saved, sp.topPlane)
  }

  for (let i = 0; i < sp.max; i++) {
    const o = i * SPL
    const fresh = v.getUint8(o + SPL_FRESH)
    if (fresh === 0) continue
    if (v.getUint8(o + SPL_BACK) === 0xff) continue
    if (double) v.setUint8(o + SPL_FRESH, fresh === 0xff ? 1 : 0)
    else v.setUint8(o + SPL_FRESH, 0)
    splPoke(bm, v.getUint32(o + SPL_IDX), sp.bkColour & 0xff, sp.topPlane)
  }
  bm.invalidate()
}

/**
 * =Splinters Active — routine 303 ($6d4a), and it counts by a rule of its own:
 *
 *     moveq   #$ff,d0                    ...which is -1, so d0.w is $ffff
 *     cmp.w   $10(a0),d0 / bne  count     the colour AND the background
 *     cmp.b   $12(a0),d0 / bne  count     and the older background
 *
 * A splinter is active unless all THREE colour bytes are $ff. So one that
 * routine 385 has just given up on — `st.b $10 / st.b $11`, leaving `+$12`
 * from the frame before — still counts for one more Del, which is exactly how
 * long its pixels are still on the screen.
 */
function splintersActive(rt: Runtime): number {
  const sp = rt.amcaf.splinters
  const v = splinterTable(rt)
  if (!v) amcafErr()
  let n = 0
  for (let i = 0; i < sp.max; i++) {
    const o = i * SPL
    if (v.getUint16(o + SPL_COLOUR) !== 0xffff || v.getUint8(o + SPL_PBACK) !== 0xff) n++
  }
  return n
}

/**
 * The channel argument the Pt query functions take, range-checked as they do.
 *
 * Routines 228 and 229 both open `move.l (a3)+,d7 / Rbmi 390` then
 * `cmp.b #4,d7 / Rbge 390`, so a negative channel or one past 3 is an ERROR
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
    // `cmp.w d4,d7 / Rbge 390` — the plane must be inside the screen's depth
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

/* ------------------------------------------------------------------ *
 * The Td Stars engine
 * ------------------------------------------------------------------ */

/**
 * Twelve bytes a star, read out of routines 387 ($a982) and 388 ($a9be).
 *
 *     +$00 word  x, in sixty-fourths of a pixel
 *     +$02 word  y, in sixty-fourths
 *     +$04 long  the previous (x,y) PAIR, saved as one long by routine 388
 *     +$08 word  vx, sixty-fourths per step
 *     +$0a word  vy
 *
 * That is the whole star. There is no z and no colour: the depth cue is the
 * SPEED, which routine 388 grows by a sixteenth every step when Accelerate is
 * on, and routine 319 turns into a two-plane brightness.
 */
const TD = 12
const TD_X = 0x0
const TD_Y = 0x2
const TD_PREV = 0x4
const TD_VX = 0x8
const TD_VY = 0xa

function tdStarTable(rt: Runtime): DataView | null {
  const st = rt.amcaf.stars
  if (!st.bank) return null
  const b = rt.memBanks.get(st.bank)
  if (!b || b.kind !== 'memory' || b.data.length < st.max * TD) return null
  return new DataView(b.data.buffer, b.data.byteOffset, b.data.byteLength)
}

/**
 * Routine 387 ($a982) — put a star at the origin with a usable speed.
 *
 *     move.l  $256(a2),(a0)               the origin pair, in one move
 *  L: add.w   (a1),d6 / move.w d6,d0
 *     andi.w  #$7f,d0 / subi.w #$3f,d0    -63..64
 *     move.w  d0,d2 / bpl / not.w d2      ...roughly its magnitude
 *     ... the same for d1 into d3 ...
 *     add.w   d3,d2 / cmp.w #$10,d2 / blt L
 *     move.w  d0,$8(a0) / move.w d1,$a(a0)
 *
 * The retry is the interesting part: a star whose two speeds add up to less
 * than sixteen sixty-fourths — a quarter of a pixel a step — is REJECTED and
 * rolled again, so no star ever crawls. That is what stops the field piling
 * up at the origin, and it is why Init's random number of steps spreads them
 * along tracks rather than into a cloud.
 *
 * `not.w` rather than `neg.w` for the magnitude, so a negative speed counts
 * as one less than its size. Reproduced; routine 319 uses `neg.w` for the
 * same job and the two disagree by one.
 *
 * NOTE: the same beam guard as the Splinters spawn. The retry terminates on
 * the machine because VHPOSR has moved; here the modelled beam stands still
 * inside a keyword, so it is bounded at 64 attempts.
 */
function tdStarSpawn(rt: Runtime, v: DataView, o: number, d6: { v: number }): void {
  const st = rt.amcaf.stars
  v.setInt16(o + TD_X, st.ox)
  v.setInt16(o + TD_Y, st.oy)
  let d0 = 0
  let d1 = 0
  for (let i = 0; i < 64; i++) {
    d6.v = (d6.v + rt.interp.beamWord()) & 0xffff
    d0 = extW((d6.v & 0x7f) - 0x3f)
    d6.v = (d6.v + rt.interp.beamWord()) & 0xffff
    d1 = extW((d6.v & 0x7f) - 0x3f)
    const m0 = d0 >= 0 ? d0 : extW(~d0)
    const m1 = d1 >= 0 ? d1 : extW(~d1)
    if (extW(m0 + m1) >= 0x10) break
  }
  v.setInt16(o + TD_VX, d0)
  v.setInt16(o + TD_VY, d1)
}

/**
 * Routine 388 ($a9be) — one step for one star.
 *
 *     move.l  (a0),$4(a0)                 the previous position, always
 *     move.w  (a0),d2 / add.w $8(a0),d2   x += vx
 *     cmp.w   $24e(a2),d2 / bcs  out      x <  x1   UNSIGNED
 *     cmp.w   $252(a2),d2 / bcc  out      x >= x2   UNSIGNED, exclusive
 *     ... the same pair for y ...
 *     move.w  $25a(a2),d2 / add.w d2,$8(a0)   gravity, after the move
 *     tst.w   $25e(a2) / bne / rts            Accelerate?
 *     ... v += v/16, sign-aware ...
 *  out: Rbra  routine 387
 *
 * Two things worth naming. The clip is UNSIGNED where the Splinters engine's
 * is signed, so a star that walks off the left does not compare below x1 — it
 * wraps to a huge positive and fails the x2 test instead. Same outcome, and
 * only the same because both ends respawn.
 *
 * And the acceleration is multiplicative: `move.w d2,d0 / lsr.w #$4,d0 /
 * add.w d0,d2` is v * 17/16 a step, with the negative arm doing the mirror
 * through `not.w`. Compounding is what makes a star appear to rush past — an
 * earlier pass added a constant to a `z` instead, which grows linearly.
 */
function tdStarMove(rt: Runtime, v: DataView, o: number, d6: { v: number }): void {
  const st = rt.amcaf.stars
  if (o + TD > v.byteLength) return
  v.setUint32(o + TD_PREV, v.getUint32(o + TD_X))
  const x = extW(v.getInt16(o + TD_X) + v.getInt16(o + TD_VX))
  const y = extW(v.getInt16(o + TD_Y) + v.getInt16(o + TD_VY))
  const u = (n: number): number => n & 0xffff
  if (u(x) < u(st.limit.x1) || u(y) < u(st.limit.y1) || u(x) >= u(st.limit.x2) || u(y) >= u(st.limit.y2)) {
    tdStarSpawn(rt, v, o, d6)
    return
  }
  v.setInt16(o + TD_X, x)
  v.setInt16(o + TD_Y, y)
  v.setInt16(o + TD_VX, extW(v.getInt16(o + TD_VX) + st.gx))
  v.setInt16(o + TD_VY, extW(v.getInt16(o + TD_VY) + st.gy))
  if (st.accelerate === 0) return
  for (const at of [TD_VX, TD_VY]) {
    const s = v.getInt16(o + at)
    v.setInt16(o + at, s >= 0 ? extW(s + ((s & 0xffff) >>> 4)) : extW(s - ((extW(~s) & 0xffff) >>> 4)))
  }
}

function tdStarsMoveAll(rt: Runtime): void {
  const st = rt.amcaf.stars
  const v = tdStarTable(rt)
  if (!v) amcafErr()
  const d6 = { v: rt.interp.beamWord() & 0xffff }
  for (let i = 0; i < st.max; i++) tdStarMove(rt, v, i * TD, d6)
}

/**
 * The pixel address routines 315, 316 and 319 share, and it is NOT the flat
 * bit index the Splinters engine uses:
 *
 *     move.w  $4c(a1),d6 / lsr.w #$3,d6       the screen width in BYTES
 *     move.w  (a0),d0 / lsr.w #$6,d0          x, into whole pixels
 *     move.b  d0,d2 / not.b d2                the bit, from the left
 *     lsr.w   #$3,d0 / ext.l d0               the byte within the row
 *     move.w  $2(a0),d1 / lsr.w #$6,d1
 *     mulu.w  d6,d1 / add.l d0,d1             the byte offset
 *     bset.b  d2,(a2,d1.l)
 *
 * so the row stride is `width / 8` bytes rather than the BitMap's own
 * bytesPerRow. The two agree for every AMOS screen, whose width is a multiple
 * of sixteen, and this reproduces the routine's arithmetic rather than the
 * BitMap's so a screen where they differ differs the same way.
 *
 * The range check is the port's; the 68k writes wherever the offset lands,
 * which is exactly the corruption the manual warns about for this keyword.
 */
function tdStarPoke(rt: Runtime, bm: BitMap, x: number, y: number, plane: number, on: boolean): void {
  void rt
  const stride = (bm.width & 0xffff) >>> 3
  const px = (x & 0xffff) >>> 6
  const py = (y & 0xffff) >>> 6
  const bit = ~px & 7
  const at = (plane >> 2) * bm.planeSize + py * stride + (px >>> 3)
  const p = bm.planeBytes(true)
  if (at < 0 || at >= p.length) return
  if (on) p[at]! |= 1 << bit
  else p[at]! &= ~(1 << bit)
}

/** the depth guard routines 315, 316 and 319 all open with */
function tdStarsScreen(rt: Runtime): Screen {
  const s = rt.screen
  if (!s) throw new AmosError('Screen not opened', 47)
  if (s.rp.bitMap.depth < 2) amcafMsg(15)
  return s
}

/** Routines 315 ($6efe) and 316 ($6f68) — clear both planes, here or a frame back */
function tdStarsDel(rt: Runtime, prev: boolean): void {
  const st = rt.amcaf.stars
  const v = tdStarTable(rt)
  if (!v) amcafErr()
  const bm = tdStarsScreen(rt).rp.bitMap
  for (let i = 0; i < st.max; i++) {
    const o = i * TD + (prev ? TD_PREV : 0)
    if (o + 4 > v.byteLength) continue
    const x = v.getInt16(o)
    const y = v.getInt16(o + 2)
    tdStarPoke(rt, bm, x, y, st.planeA, false)
    tdStarPoke(rt, bm, x, y, st.planeB, false)
  }
  bm.invalidate()
}

/**
 * Routine 319 ($7026) — and a star's BRIGHTNESS is its speed.
 *
 *     move.w  $8(a0),d3 / bpl / neg.w d3      |vx|
 *     move.w  $a(a0),d4 / bpl / neg.w d4      |vy|
 *     add.w   d4,d3 / lsr.w #$6,d3            whole pixels a step
 *     cmp.w   #$3,d3 / bge   -> bset both planes
 *     cmp.w   #$2,d3 / bge   -> bclr A, bset B
 *                     else   -> bclr B, bset A
 *
 * Three levels across the two planes Td Stars Planes named, which is why that
 * keyword takes two plane NUMBERS and refuses a screen with fewer than four
 * colours. A fast star is bright, and Accelerate makes a star faster the
 * longer it has been running, so a field brightens towards the edges without
 * anything ever storing a depth. An earlier pass drew every star as a solid
 * `(1 << planes) - 1` and had no brightness at all.
 */
function tdStarsDraw(rt: Runtime): void {
  const st = rt.amcaf.stars
  const v = tdStarTable(rt)
  if (!v) amcafErr()
  const bm = tdStarsScreen(rt).rp.bitMap
  for (let i = 0; i < st.max; i++) {
    const o = i * TD
    if (o + TD > v.byteLength) continue
    const x = v.getInt16(o + TD_X)
    const y = v.getInt16(o + TD_Y)
    const vx = v.getInt16(o + TD_VX)
    const vy = v.getInt16(o + TD_VY)
    const speed = (extW(Math.abs(vx) + Math.abs(vy)) & 0xffff) >>> 6
    if (speed >= 3) {
      tdStarPoke(rt, bm, x, y, st.planeA, true)
      tdStarPoke(rt, bm, x, y, st.planeB, true)
    } else if (speed >= 2) {
      tdStarPoke(rt, bm, x, y, st.planeA, false)
      tdStarPoke(rt, bm, x, y, st.planeB, true)
    } else {
      tdStarPoke(rt, bm, x, y, st.planeB, false)
      tdStarPoke(rt, bm, x, y, st.planeA, true)
    }
  }
  bm.invalidate()
}

/* ------------------------------------------------------------------ *
 * Slice 10: vector rotation
 * ------------------------------------------------------------------ */

/**
 * Routine 4 ($1f96) — build the nine-word rotation matrix at `$31e`.
 *
 * Transcribed instruction for instruction rather than re-derived as an Euler
 * composition, because the arithmetic is where the behaviour is: every stage
 * is `muls.w` on the low WORDS and `asr.l #$8`, so each intermediate is
 * truncated to sixteen bits and floored at 8-bit fixed point before the next
 * multiply sees it. A clean matrix built in floating point and rounded at the
 * end would agree to within a unit or two and disagree constantly.
 *
 * The six table lookups it starts with are the sine at each angle and the
 * cosine a quarter turn on — `addi.w #$200,d0 / andi.w #$7fe,d0`, which is
 * 256 entries of two bytes, wrapped into the 2048-byte table.
 */
function vecRotPrecalc(rt: Runtime): void {
  const v = rt.amcaf.vec
  const tab = (off: number): number => SIN256[(off >> 1) & 0x3ff]!
  // $312..$31c: sin and cos of each of the three angles
  const s1 = tab(v.angA)
  const c1 = tab(v.angA + 0x200)
  const s2 = tab(v.angB)
  const c2 = tab(v.angB + 0x200)
  const s3 = tab(v.angC)
  const c3 = tab(v.angC + 0x200)
  const mul = (p: number, q: number): number => Math.imul(extW(p), extW(q))
  const m = v.m

  // row 0: `muls.w`/`asr.l #$8` on c2 against s1 and c1, then s2 straight
  m[0] = extW(mul(c1, c2) >> 8)
  m[1] = extW(mul(s1, c2) >> 8)
  m[2] = extW(s2)

  // row 1, where the `neg.w` on the second and third terms lives
  const d4 = mul(s3, s2) >> 8
  const d5 = mul(d4, s1)
  const r10 = mul(s1, c3) + mul(d4, c1)
  const r11 = mul(c1, c3) - d5
  m[3] = extW(r10 >> 8)
  m[4] = extW(-extW(r11 >> 8))
  m[5] = extW(-extW(mul(s3, c2) >> 8))

  // row 2, the same shape with c3 and s3 exchanged
  const e0 = mul(c3, s2) >> 8
  const r20 = mul(s3, s1) - mul(e0, c1)
  const r21 = mul(s3, c1) + mul(e0, s1)
  m[6] = extW(r20 >> 8)
  m[7] = extW(-extW(r21 >> 8))
  m[8] = extW(mul(c3, c2) >> 8)
}

/**
 * Routine 373 ($84e4) — rotate a point through the matrix and project it.
 *
 *     move.l (a3)+,d3                     the LAST argument, z
 *     muls.w $31e(a2),d3 / muls.w $324(a2),d4 / muls.w $32a(a2),d5
 *     ... then y against $320/$326/$32c, then x against $322/$328/$32e ...
 *     move.w $300(a2),d0 / ext.l d0 / asl.l d7,d0 / add.l d0,d3
 *     move.w $302(a2),d0 / ext.l d0 / asl.l d7,d0 / add.l d0,d4
 *     asr.l  d7,d5 / addx.w d2,d5 / add.w $304(a2),d5
 *     move.w d5,$310(a2)
 *     tst.w  d5 / Rbeq routine 390        a zero distance is error 23
 *     divs.w d5,d3 / move.w d3,$30c(a2)
 *     divs.w d5,d4 / move.w d4,$30e(a2)
 *
 * Three things the port had differently. The position is ADDED after the
 * rotation, not subtracted before it. The x and y sums are left at the
 * matrix's 256x scale and divided by the plain z, which IS the projection —
 * there is no separate multiply by 256. And a resulting z of zero is an
 * ERROR, where the port substituted 1 and carried on.
 *
 * DEFECT: the arguments reach the matrix BACKWARDS. `(a3)+` pops the last
 * argument first — the same order Qcos relies on when it adds a quarter turn
 * to `$6(a3)` — so the first pop is `z`, and the first pop is what multiplies
 * `$31e`, `$324` and `$32a`, the first COLUMN. Routine 4 builds that column
 * as `[c1*c2, ..., ...]` and the third as `[s2, ..., c3*c2]`, which is the
 * standard shape for a first column pairing with x and a third pairing with
 * z. So `Vec Rot X(x,y,z)` rotates the vector (z, y, x). Identical in 1.40
 * and 1.50; nothing in the manual mentions it, and a caller who fed a
 * symmetric point would never see it. Reproduced.
 *
 * `addx.w d2,d5` with d2 zeroed adds the bit `asr.l` pushed into X, so the
 * distance is rounded on bit 7 rather than floored — the same idiom Qsin
 * uses. `divs.w` is 32-by-16: NOTE that a quotient too big for a word leaves
 * the register untouched on the 68000 and sets V, which nothing here tests,
 * so a point very close to the eye reports the PREVIOUS x or y. Reproduced.
 */
function vecRot(rt: Runtime, a: Value[]): { x: number; y: number; z: number } {
  const v = rt.amcaf.vec
  if (a.length < 3) return { x: v.x, y: v.y, z: v.z }
  const x = extW(int(a[0]!))
  const y = extW(int(a[1]!))
  const z = extW(int(a[2]!))
  const m = v.m
  const mul = (p: number, q: number): number => Math.imul(extW(p), extW(q))
  let d3 = mul(z, m[0]!) + mul(y, m[1]!) + mul(x, m[2]!)
  let d4 = mul(z, m[3]!) + mul(y, m[4]!) + mul(x, m[5]!)
  const d5raw = mul(z, m[6]!) + mul(y, m[7]!) + mul(x, m[8]!)
  d3 += v.px << 8
  d4 += v.py << 8
  const d5 = extW((d5raw >> 8) + ((d5raw >> 7) & 1) + v.pz)
  v.z = d5
  if (d5 === 0) amcafErr()
  // `divs.w`, so the quotient is a word and an overflow leaves the old value
  const qx = (d3 / d5) | 0
  const qy = (d4 / d5) | 0
  if (qx === extW(qx)) v.x = qx
  if (qy === extW(qy)) v.y = qy
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

/**
 * C2p Shift src,wx,wy To dst,shift — routine 77 ($2ff2).
 *
 * A per-BYTE right shift done four bytes at a time, which the port had as an
 * ADD. The mask is the interesting part:
 *
 *     moveq #$ff,d0 / lsr.b d7,d0        what survives one byte's shift
 *     move.b d0,d1
 *     lsl.w #$8,d0 / move.b d1,d0
 *     lsl.l #$8,d0 / move.b d1,d0
 *     lsl.l #$8,d0 / move.b d1,d0        ...in all four
 *  L: move.l (a0)+,d1 / lsr.l d7,d1 / and.l d0,d1 / move.l d1,(a2)+
 *
 * `lsr.l` on the whole longword would drag each byte's low bits into the byte
 * above it; the mask clears exactly those. So the result is `b >> shift` for
 * every byte, computed a longword at a time.
 *
 * `beq $3022` gives a shift of zero its own arm, a plain `move.l (a0)+,(a2)+`
 * copy — which matters because `lsr.b #$0` would leave the mask at $ff and
 * work anyway, so the branch is speed rather than correctness.
 *
 * NOTE: the count is `wx * wy` divided by four with `lsr.l #$2`, so a size
 * that is not a multiple of four leaves its last one to three bytes
 * UNTOUCHED. Reproduced.
 */
function c2pShift(rt: Runtime, it: Interp): void {
  const st = it.evalInt()
  it.expect(',')
  const wx = it.evalInt()
  it.expect(',')
  const wy = it.evalInt()
  it.expect('to')
  const st2 = it.evalInt()
  it.expect(',')
  const shift = it.evalInt()
  const src = rt.resolveAddr(st)
  const dst = rt.resolveWrite(st2)
  if (!src || !dst) amcafErr()
  const longs = ((wx * wy) >>> 2) >>> 0
  for (let i = 0; i < longs * 4; i++) {
    const v = src.data[src.off + i] ?? 0
    if (dst.off + i < dst.data.length) dst.data[dst.off + i] = (v >> (shift & 7)) & 0xff
  }
}

/**
 * C2p Fire src,wx,wy To dst,decay — routine 76 ($2fa2), and it is a FLAME
 * filter rather than the plain decrement the port had.
 *
 *     move.b (a0,d5.w),d0        the byte one row BELOW  (+wx)
 *     move.b (a0,d4.w),d1        one row above           (-wx)
 *     move.b -$1(a0),d2          left
 *     add.w  d1,d0
 *     move.b (a0)+,d3            itself, and advance
 *     add.w  d2,d0
 *     move.b (a0),d1             right
 *     add.w  d3,d0 / add.w d1,d0
 *     move.b (a2,d0.w),d0        the sum through a table at $1cb2(a2)
 *     sub.w  d7,d0
 *     bpl / clr.b (a1)+          ... clamped at zero
 *     move.b d0,(a1)+
 *
 * Five neighbours summed, averaged through a table, then the decay taken off
 * and clamped — which is what makes a chunky buffer look like fire when it is
 * seeded along one edge. The port subtracted the decay from each byte on its
 * own and produced a fade, not a flame.
 *
 * The table is at `$1cb2` of the extension's runtime block, and routine 396
 * ($aa92) — reached from the init through routine 159 — builds it:
 *
 *     lea    $1cb2(a2),a1 / move.w #$ff,d7 / moveq #$0,d0
 *  L: move.b d0,(a1)+ / move.b d0,(a1)+ / move.b d0,(a1)+
 *     cmp.b  #$ff,d0 / beq skip
 *     addq.w #$1,d0
 *  skip: move.b d0,(a1)+ / move.b d0,(a1)+
 *     dbra   d7,L
 *
 * Five bytes per pass and 256 passes, so 1280 entries ending exactly where
 * the string buffer at `$21b2` begins. The value steps up between the THIRD
 * and fourth byte of each group, so entry `i` is `k` for `i % 5 < 3` and
 * `k + 1` above it, where `k = i / 5` — which is `i / 5` ROUNDED TO NEAREST,
 * since 2/5 rounds down and 3/5 up. Not floored, which is what a first
 * reading of "average" would have given.
 *
 * The `cmp.b #$ff,d0` caps it at 255, though the largest reachable sum is
 * 5 * 255 = 1275 and rounds to 255 anyway.
 *
 * NOTE: the routine reads one row either side of the buffer without checking,
 * so the first and last rows sample memory outside it. The port reads zero
 * there instead of whatever the heap held.
 */
function c2pFire(rt: Runtime, it: Interp): void {
  const st = it.evalInt()
  it.expect(',')
  const wx = it.evalInt()
  it.expect(',')
  const wy = it.evalInt()
  it.expect('to')
  const st2 = it.evalInt()
  it.expect(',')
  const decay = it.evalInt()
  const src = rt.resolveAddr(st)
  const dst = rt.resolveWrite(st2)
  if (!src || !dst) amcafErr()
  const n = wx * wy
  const at = (i: number): number => (i < 0 || i >= n ? 0 : (src.data[src.off + i] ?? 0))
  for (let i = 0; i < n; i++) {
    const sum = at(i + wx) + at(i - wx) + at(i - 1) + at(i) + at(i + 1)
    const k = (sum / 5) | 0
    const v = Math.min(255, sum % 5 < 3 ? k : k + 1) - decay
    if (dst.off + i < dst.data.length) dst.data[dst.off + i] = v < 0 ? 0 : v & 0xff
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
     * =Cd Day(date) — routine 324 ($7136) / 1.40's 310 ($73da). "A value between 1
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
     * =Cd Month(date) — routine 323 ($712e) / 1.40's 309 ($73ca). "Lies between 1 and
     * 12": six bytes of `Rbsr` Cd Year, `Rbra` the month splitter.
     */
    'cd month': (_, a) => {
      const { year, rest } = amcafYear(i0(a, 0))
      return VI(amcafMonth(year, rest).month)
    },
    /** =Cd Year(date) — routine 322 ($7104) / 1.40's 308 ($7398), the loop above */
    'cd year': (_, a) => VI(amcafYear(i0(a, 0)).year),

    /**
     * =Cd Weekday(date) — routine 325 ($7140) / 1.40's 311 ($73ec). "Can range
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
     * =Cd String(date$) — routine 327 ($71a8), and it really is dos.library:
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
     * =Ct Hour(time) — routine 329 ($72be). "Separates the hour from the
     * packed time": clear the low word, `swap`, `divu.w #$3c` and keep the
     * QUOTIENT. So the minutes-since-midnight field divided by sixty.
     */
    'ct hour': (_, a) => VI(Math.floor(timeMins(i0(a, 0)) / 60)),
    /**
     * =Ct Minute(time) — routine 330 ($72d0). The same divide, keeping the
     * REMAINDER instead: `move.w d2,d3 / swap d3` lifts it out of the high
     * word. Minutes within the hour.
     */
    'ct minute': (_, a) => VI(timeMins(i0(a, 0)) % 60),
    /**
     * =Ct Second(time) — routine 331 ($72e2). `move.w d0,d1 / divu.w #$32,d1`
     * on the LOW word, quotient kept: the ticks field divided by fifty.
     */
    'ct second': (_, a) => VI(Math.floor(timeTicks(i0(a, 0)) / TICKS_PER_SECOND)),

    /**
     * =Ct Tick(time) — routine 332 ($72f4). "Calculates the number of vertical
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
     * =Ct Time$(time) — routine 333 ($7306). "A string in the format
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
     * =Ct String(time$) — routine 326 ($7152), Cd String's twin: the same
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
        rt.amcaf.examine = { dir: '', entries: [], index: -1, current: '', fib: EMPTY_FIB }
        return VS('')
      }
      e.current = joinAmigaPath(e.dir, name)
      e.fib = captureFib(rt, e.current)
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
    'object type': () => VI(rt.amcaf.examine.fib.type),
    /*
     * Routines 114, 118, 120, 122 and 124 ($3b20, $3b4c, $3b60, $3b74,
     * $3b88), and every one is a dozen bytes reading a FIXED OFFSET into the
     * FileInfoBlock the last Examine filled at $100(a2). None of them takes a
     * path, which is what #186 settled; these add the offsets.
     *
     *     $17c = FIB +$7c   fib_Size
     *     $180 = FIB +$80   fib_NumBlocks
     *     $184 = FIB +$84   fib_Date.ds_Days
     *     $108 = FIB +$08   fib_FileName, returned through routine 366 (d2=2)
     *
     * Object Time is the only one that computes anything:
     *
     *     lea $18a(a2),a0 / move.w (a0),d3 / swap d3 / move.w $4(a0),d3
     *
     * — $18a and $18e are the LOW WORDS of ds_Minute and ds_Tick, packed into
     * one long with the minutes above the ticks. Both fit a word (1440 and
     * 3000), so nothing is lost, and it is the same packing Ct Time$ uses.
     */
    'object size': () => VI(rt.amcaf.examine.fib.size),
    'object blocks': () => VI(rt.amcaf.examine.fib.blocks),
    'object name$': () => VS(rt.amcaf.examine.fib.name),
    'object date': () => VI(rt.amcaf.examine.fib.days),
    'object time': () => {
      const f = rt.amcaf.examine.fib
      return VI(packTime(f.mins, f.ticks))
    },
    'object protection': () => VI(rt.amcaf.examine.fib.protection),
    'object comment$': () => VS(rt.amcaf.examine.fib.comment),

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
     *
     * Routine 100 ($3694) walks the real DosList, and the walk is what settles
     * the three answers: `$2b8(a5)` is DOSBase, `$22` its dl_Root, `$18` the
     * RootNode's rn_Info, `$4` the DosInfo's di_DevInfo, each a BPTR turned
     * into a pointer by `adda.l a1,a1` twice, and then `move.l $4(a1),d3` off
     * the matching entry is dol_Type verbatim. The names are BSTRs at `$28`,
     * compared with `bclr.b #$5` on both sides, so the match is
     * case-insensitive.
     *
     * Two checks the port did not have. The string is truncated to the first
     * colon (`clr.b (a1)` one past it) and the compare then requires
     * `cmpi.b #$3a,(a0)+` right after the device name, so a name with NO colon
     * runs off the end of the string into `Rbeq routine 390`, AMOS error 23.
     * And running off the end of the DosList without a match is routine 391,
     * error 81, rather than a guess.
     */
    'disk type': (_, a) => {
      const arg = s0(a, 0)
      if (!arg.includes(':')) amcafErr()
      const name = arg.slice(0, arg.indexOf(':'))
      const has = (list: string[]): boolean => list.some((n) => n.toLowerCase() === name.toLowerCase())
      if (has([...AmigaFS.DRIVES])) return VI(0)
      if (has(rt.vfs?.assignNames() ?? [])) return VI(1)
      if (has(rt.vfs?.volumeNames() ?? [])) return VI(2)
      amcafDosErr()
    },

    /**
     * =Disk State(directory$) — bit 0 write-protected or validating, bit 1
     * in use. The manual is candid about the third case: "If no disk is in
     * the drive, it normally should return -1, but I'm afraid..."
     *
     * Routine 101 ($3706) truncates at the colon exactly as Disk Type does and
     * then does the real three-call dance: `Lock(name, -2)` at `-$54` with
     * `moveq #$fe,d2` for SHARED_LOCK, `Info(lock, $168(a5))` at `-$72` into
     * the extension block's own first bytes, and `UnLock` at `-$5a`. A failed
     * Lock is routine 391 (error 81) and a failed Info routine 392 (error 94);
     * the port answered -1 for a name that does not resolve, which is the one
     * case the manual reserves for a drive with no disk in it.
     *
     * The three answers come straight off the InfoData: `move.l $18(a2),d0`
     * against `moveq #$ff,d1` -- id_DiskType against ID_NO_DISK_PRESENT, -1
     * because moveq sign-extends -- then `move.l $8(a2),d0 / cmp.b #$52,d0` is
     * id_DiskState against ID_VALIDATED, and `tst.l $20(a2)` is id_InUse.
     *
     * NOTE: nothing modelled here is write protected, mid-validation or in
     * use, so a volume that resolves answers 0. The shape of the test is the
     * routine's; the state it reads has nowhere to come from yet.
     */
    'disk state': (_, a) => {
      const arg = s0(a, 0)
      if (!arg.includes(':')) amcafErr()
      const name = arg.slice(0, arg.indexOf(':') + 1)
      if (rt.vfs?.exists(name) === null) amcafDosErr()
      return VI(0)
    },

    /** =Io Error / =Io Error$ — the last AmigaDOS error, not an AMOS one */
    'io error': () => VI(rt.amcaf.ioError),
    'io error$': (_, a) => VS(dosErrorText(i0(a, 0))),

    /**
     * =Command Name$ — "the file name of the program under which AMOS or the
     * compiled program has been started. This is required for example to
     * read the own Tool Types."
     */
    'command name$': () => {
      /*
       * Routine 340 ($752c) asks three sources in order, and each is a real
       * structure walk:
       *
       *     suba.l a1,a1 / movea.l $4.w,a6 / jsr -$126(a6)   FindTask(NULL)
       *     tst.l $8c(a0) / beq                              pr_TaskNum
       *     movea.l $ac(a0),a0 ... movea.l $10(a0),a0        pr_CLI, then
       *                                                      cli_CommandName
       *     movea.l $2d8(a5),a0 / movea.l $24(a0),a0         the WBStartup
       *     movea.l $4(a0),a0                                sm_ArgList, wa_Name
       *     movea.l $424(a5),a0 / addq.l #$8 / addq.l #$4    and AMOS's own
       *
       * both BPTRs turned into pointers by the `adda.l a0,a0` pairs, and the
       * three tails differing only in routine 367 for a BSTR against 366 for
       * a C string.
       *
       * DEVIATION: nothing here records the file a program was loaded from
       * under a name the program itself could have used, so all three sources
       * are empty and this answers empty. A program using it to find its own
       * Tool Types gets the same nothing Tool Types$ gives, which at least
       * keeps the pair consistent.
       */
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
        const d = penDist(c, want)
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
    /**
     * =Ham Colour(control,rgb) — routine 161 ($440a), 82 bytes. The pops
     * settle the order: `move.l (a3)+,d3` takes the SECOND argument and
     * `move.l (a3)+,d0` the first, so d0 is the control and d3 the old
     * colour. No masking — see hamApply for why that matters.
     *
     * NOTE: only the palette-index arm touches the screen, and it guards with
     * `Rbeq routine 394`, AMOS error 47. The fallback palette below is never
     * reached, because reading `rt.screen` with no screen open raises the
     * core's own error first — the same unsettled question as the Scrn
     * pointers, and it wants fixing once in the core rather than here.
     */
    'ham colour': (_, a) => {
      const s = rt.screen
      return VI(hamApply(i0(a, 0), i0(a, 1), s ? s.palette : new Uint16Array(16)))
    },
    /**
     * =Ham Best(newrgb,oldrgb) — routine 162 ($445c), the control byte that
     * gets closest. `move.l (a3)+,d7` takes oldrgb and the d6 popped after it
     * is newrgb, which is the one every candidate is measured against.
     *
     * See `hamBest`: nineteen candidates weighed by Best Pen's table, not
     * sixty-four weighed by a sum of squares.
     *
     * NOTE: the routine reads `$52c(a5)` with no guard at all. The fallback
     * palette below is unreachable for the same reason as Ham Colour's.
     */
    'ham best': (_, a) => {
      const s = rt.screen
      return VI(hamBest(i0(a, 0), i0(a, 1), s ? s.palette : new Uint16Array(16)))
    },

    /**
     * =Ham Point(x,y) — routine 160 ($4312), 248 bytes. The real colour at a
     * point, which in HAM needs the whole line before it: "Ham Point can
     * access any point on the screen indiviually without preprocessing".
     *
     * `move.l (a3)+,d7` takes the last argument and is multiplied by the row
     * length, so d7 is y and the d6 popped after it is x.
     *
     * DEVIATION: the manual says "If the point x,y is not on the screen, rgb
     * will contain -1". The routine returns the RGB of palette entry 0. Both
     * the y guard and the x guard land on the same three instructions —
     *
     *   $4334  moveq #$0,d3 / move.w (a0),d3 / moveq #$0,d2 / rts
     *
     * — where a0 is `$62(a1)`, the palette, so the answer is `Colour(0)`.
     * There is no -1 anywhere in the routine. On a screen whose colour 0 is
     * black that reads as 0, which is presumably how the manual's claim
     * survived. An earlier pass took the manual's word for it.
     *
     * The routine scans BACKWARDS from x, carrying a mask in d0 of which
     * nibbles are already settled and stopping early once `cmp.w #$fff,d0`
     * says all three are; running off the left edge takes the remaining
     * nibbles from palette entry 0 (`bra $4394` with d2 zeroed). Walking
     * forwards from 0 as below reaches the same colour — each nibble is set
     * by the last pixel at or before x that writes it — so the scan direction
     * is a cost difference, not a behavioural one.
     *
     * NOTE: two things here are deliberately not reproduced. The routine
     * reads six plane pointers (`$0`/`$4`/`$8`/`$c`/`$10`/`$14` of the
     * screen) unconditionally, so on a screen shallower than 6 planes it
     * btsts through whatever those slots hold; the chunky read below yields a
     * control of 0 instead. And both bounds are `cmp.w`, a WORD compare
     * against `$4c`/`$4e`, after only the LONG's sign has been tested — so a
     * coordinate of 65536 passes as 0 and one of 32768 passes as negative and
     * then indexes far outside the bitmap. The full-width check below is kept
     * rather than reproducing an out-of-bounds read.
     */
    'ham point': (_, a) => {
      const x = i0(a, 0)
      const y = i0(a, 1)
      const s = rt.screen
      const bg = s?.palette[0] ?? 0
      if (!s || x < 0 || y < 0 || x >= s.width || y >= s.height) return VI(bg)
      const px = s.rp.bitMap.pixels
      let rgb = bg
      for (let i = 0; i <= x; i++) rgb = hamApply(px[y * s.width + i]! & 63, rgb, s.palette)
      return VI(rgb)
    },


    /**
     * =Blitter Busy — "returns -1 (True), if the Blitter chip is currently
     * busy". Nothing here overlaps a blit with the program, so it never is.
     */
    /**
     * =Blitter Busy — routine 68 ($2cce), twenty bytes:
     * `btst.b #$6,$dff002.l` is bit 14 of DMACONR, BBUSY, and the answer is
     * `moveq #$ff,d3` (which is -1) when set and zero when clear.
     *
     * Always zero here, and FAITHFUL rather than a stub: every blitter
     * operation in this port completes inside the keyword that started it, so
     * there is never a moment when a program could observe one running. The
     * -1 arm is unreachable for the same reason.
     */
    'blitter busy': () => VI(0),

    /** =Turbo Point(x,y) — "Fast replacement for Point", clipped since V1.30 */
    'turbo point': (_, a) => {
      /*
       * Routine 349 ($7a8e), and the manual's "clipped since V1.30" means it
       * ANSWERS -1 rather than that it declines to read:
       *
       *     move.l (a3)+,d2 / bpl        the LAST argument, y
       *     addq.l #$4,a3               ...and if it is negative, skip x
       *  bad: moveq #$0,d2 / moveq #$ff,d3 / rts        -1
       *     move.l (a3)+,d1 / bmi bad                   x < 0
       *     cmp.w $4e(a0),d2 / bge bad                  y >= height
       *     move.w $4c(a0),d0 / cmp.w d0,d1 / bge bad   x >= width
       *
       * The port answered 0, which is a real colour and indistinguishable
       * from a black pixel inside the screen. `Point` proper returns -1 too,
       * so this was the odd one out.
       *
       * NOTE: the address is `(y * (width >> 3)) * 8 + x` in bits, the screen
       * WIDTH again rather than the BitMap's bytesPerRow, and a depth-1
       * screen takes a separate arm returning 0 or 1.
       */
      const s = rt.screen
      if (!s) return VI(-1)
      const x = i0(a, 0)
      const y = i0(a, 1)
      if (x < 0 || y < 0 || y >= s.height || x >= s.width) return VI(-1)
      const v = s.rp.point(x, y)
      return VI(v < 0 ? -1 : v)
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
    /**
     * The Scrn pointers — routines 279 to 283, which are the SAME eighteen
     * byte routine five times over:
     *
     *   movea.l $52c(a5), a0     ; the current screen
     *   move.l  a0, d0
     *   Rbeq    routine 394      ; error 47, "Screen not opened"
     *   move.l  $xxx(a0), d3     ; one fixed offset, and that is all
     *
     * with the offset the only difference between them — RastPort $148,
     * BitMap $150, LayerInfo $140, Layer $144, Region $14c.
     *
     * The value stays 0 for the reason the NOTES entry gives: this port holds
     * a RastPort and a BitMap as objects rather than bytes at an address, and
     * models no Layer or LayerInfo at all, so there is no address to hand
     * back.
     *
     * NOTE: the guard below does not currently fire. Reading `rt.screen` with
     * no screen open raises the core's own 'screen not opened' first, so a
     * program does get an error where an earlier pass returned 0 — but it is
     * not error 47 and not this code. Left in place deliberately: it is what
     * routine 394 does, and it becomes live the moment the core hands back a
     * missing screen instead of throwing. Every extension that reads
     * $52c(a5) has the same question and it should be settled once.
     */
    'scrn rastport': () => scrnPtr(rt),
    'scrn bitmap': () => scrnPtr(rt),
    'scrn layer': () => scrnPtr(rt),
    'scrn layerinfo': () => scrnPtr(rt),
    'scrn region': () => scrnPtr(rt),


    /**
     * =Count Pixels(screen,colour,x1,y1 To x2,y2) — routine 92 ($3336), 158
     * bytes. Note the sense, which the manual states and the name does not:
     * it "Counts the pixels ... that DON'T have the colour index colour".
     *
     * The far corner is EXCLUSIVE, which an earlier pass had inclusive:
     *
     *   sub.w d4,d6 / Rbeq routine 390 / Rbmi routine 390    x2 - x1
     *   sub.w d5,d7 / Rbeq routine 390 / Rbmi routine 390    y2 - y1
     *   subq.w #$1,d6 / subq.w #$1,d7                        dbra counts
     *
     * so the inner `dbra d6` runs x2-x1 times from x1, covering x1..x2-1. And
     * because a zero extent fails `Rbeq` before that, an empty region is AMOS
     * error 23 rather than a count of nothing — the two `Rbmi`s make a
     * reversed one an error too.
     *
     * The colour is compared as a BYTE — `move.b d2,$2(a7)` on the way in and
     * `cmp.b $a(a7),d0` in the loop (the offset differs because `movem.w
     * d0-d1/d4-d5,-(a7)` has pushed eight bytes by then) — so anything above
     * 255 wraps into range.
     *
     * NOTE: the routine has no clipping whatever. It walks plane memory from
     * `y1 * ($4c >> 3)` with no test against the screen, so a region off the
     * edge counts whatever is next in memory. Skipping out-of-range points
     * below is the port's, not the routine's.
     */
    'count pixels': (_, a) => {
      const s = rt.screens.get(i0(a, 0))
      if (!s) amcafErr()
      const c = i0(a, 1) & 0xff
      const x1 = i0(a, 2)
      const y1 = i0(a, 3)
      const w = ((i0(a, 4) - x1) << 16) >> 16 // sub.w, so a WORD difference
      const h = ((i0(a, 5) - y1) << 16) >> 16
      if (w <= 0 || h <= 0) amcafErr()
      let n = 0
      for (let y = y1; y < y1 + h; y++) {
        for (let x = x1; x < x1 + w; x++) {
          const v = s.rp.point(x, y)
          if (v >= 0 && (v & 0xff) !== c) n++
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

    /** =Splinters Active — routine 303 ($6d4a); see splintersActive for the rule */
    'splinters active': () => VI(splintersActive(rt)),


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
     * Routine 19, and the string IS in the binary — an earlier pass said the
     * hunk held no printable text at all and was looking in the wrong place.
     * Four instructions and then the literal, length word and all:
     *
     *   1.40, $2176:  0035 minus two -- 51 characters --
     *                 "AMCAF Erweiterung V1.40 26-Dec-95 von Chris Hodges."
     *   1.50, $22d8:  53 characters --
     *                 "AMCAF extension V1.50beta4 11-Jan-98 by Chris Hodges."
     *
     * The shareware release answered in GERMAN and the freeware final in
     * English, which is the same 1.40/1.50 split the demo guards showed.
     *
     * DEVIATION: this port cannot tell which release a program bound — one
     * body of code serves both and the token tables do not carry the registry
     * id — so it answers with 1.50's, the release the clean binary and the
     * manual both come from. The port's own "AMCAF 1.50" was never on any
     * machine.
     */
    'amcaf version$': () => VS('AMCAF extension V1.50beta4 11-Jan-98 by Chris Hodges.'),


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
     * Routine 243 ($5d5e) range-checks first — `Rbmi 390` on negative and
     * `cmp.b #4 / Rbge 390` — then indexes the replayer's per-channel state
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
     * Routine 242 ($5d34), the same range check, then `move.b $2(a0,d7.w),d3`
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
      // Routine 268 ($61bc) CLEARS the byte as it reads it —
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
     * =Qrnd(max) — routine 272 ($62ea), and the manual is wrong about it.
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
     * =Qarc(deltax,deltay) — routine 275 ($6350). The inverse of the pair:
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
