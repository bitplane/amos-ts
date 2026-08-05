/**
 * PowerBobs 1.0 — Manuel Andre's replacement for the AMOS bob and sprite
 * systems, at slot 13.
 *
 * A game defines a fixed table of Pbobs, gives each one a maximum height, and
 * then draws them with a blitter path that saves and restores the background
 * itself. The doc's pitch is speed: "a HIGH-speed AMOS/Pro extension, adding
 * numerous new commands to give your work the extra speed AMOS/Pro lacks",
 * and it is by the same author as TURBO Plus, which this port already has.
 *
 * ## Evidence
 *
 * `AMOSPro_PowerBobs.LIB`, a 17,072-byte code hunk, and `POWER_BOBS_DOC.asc`
 * beside it. The doc is unusually good — it gives the allocation sizes and
 * the numbering rules outright — but the binary is what is transcribed here
 * and it is the binary that settles anything the two disagree on.
 *
 * ## This is the SHAREWARE build, and the binary says so
 *
 * `Reserve Pbobs` refuses more than 64 with `cmp.l #$40,d0 / Rbhi`. The doc
 * says a registered copy does 256 and drops the startup screen. The cap is
 * reproduced because it is what this library does; a program written against
 * a registered copy would have met a different one, and that copy is not
 * here to read.
 *
 * ## The memory
 *
 * Everything is `AllocMem`, not AMOS banks: `jsr -$c6(a6)` with `a6` loaded
 * from `$4.w`, which is ExecBase, so the offsets are exec's -198 AllocMem and
 * -210 FreeMem rather than the graphics.library calls they resemble.
 * `$10001` is MEMF_PUBLIC|MEMF_CLEAR and `$10002` is MEMF_CHIP|MEMF_CLEAR ---
 * the save buffers have to be chip because the blitter reads them.
 *
 * No keyword hands the address of any of it back to BASIC, so the byte layout
 * is not observable and the structures are objects here. The FIELD WIDTHS are
 * kept, because those are observable: `$1c` is a word holding the image
 * number times eight, and `I Pbob` shifts it back down.
 *
 * ## The state block
 *
 * Static in the code hunk at $954, reached through `$1b8(a5)`. Routine 0
 * stores the reset hook at $6e0 into both `$1bc(a5)` and `$1c0(a5)`.
 *
 *   $0    the Pbob table, `count * 8` bytes --- TWO structure pointers per
 *         Pbob, the second used only when Pbob Dbuf is on
 *   $4    a second table, `count * 4` bytes, allocated and freed with the
 *         first. Nothing in this slice reads it.
 *   $c    the Pbob count, a word
 *   $10   the Pbob Dbuf flag, and $12 a long it clears beside it
 *   $1ba  Set Fastpbob Mode
 *
 * ## Errors
 *
 * Two, both reached by `Rjmp` to the AMOS error raiser:
 *
 *   routine 125  `moveq #$17,d0` --- AMOS 23, "Illegal function call", for
 *                every argument that is out of range
 *   routine 123  `moveq #$18,d0` --- AMOS 24, "Out of memory", when AllocMem
 *                returns null
 *
 * NOTE: extdis prints that raiser as `L_ScCopy`, which it plainly is not.
 * TOME's copy of the same call prints as `L_InSetPaint`. Two extensions, two
 * different wrong names for one routine — see the cross-library naming task.
 */
import { AmosError, VI, int } from '../interp/values'
import type { Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'

/** `AllocMem($2c)` — the PBOB_STRUCTURE, 44 bytes, one per Pbob per buffer. */
export interface Pbob {
  /** $0 / $2 — where the last Pbob call put it, as signed words */
  x: number
  y: number
  /** $8 and $12 — two words routine 7 initialises to $ff. Purpose unread. */
  f8: number
  f12: number
  /** $14 — the maximum height Pbob Height was given */
  maxHeight: number
  /** $1c — the image number TIMES EIGHT, which is how I Pbob reads it back */
  image8: number
  /** $1e — Set Pbob's replace mode: 0 saves the background, $ff does not */
  replace: number
  /** $1f — Set Pbob's plane mask, one bit a bitplane, $ff until set */
  planeMask: number
  /** $28 — `AllocMem(maxHeight * 36, CHIP)`, six bytes a line per bitplane */
  save: Uint8Array
}

/** The extension data block at `$1b8(a5)`, as far as this slice reads it. */
export interface PowerBobsState {
  /**
   * $0 — the table Reserve Pbobs allocates, as the two halves it really is.
   * A slot holds null until Pbob Height defines it.
   */
  bobs: Array<Pbob | null>
  bobsDbuf: Array<Pbob | null>
  /** $c — how many Reserve Pbobs asked for; 0 means none reserved */
  count: number
  /** $10 — Pbob Dbuf. Stored as $ffff or 0, and tested as a word. */
  dbuf: number
  /** $1ba — Set Fastpbob Mode, the global "never save the background" switch */
  fastMode: boolean
}

export const newPowerBobsState = (): PowerBobsState => ({
  bobs: [],
  bobsDbuf: [],
  count: 0,
  dbuf: 0,
  fastMode: false,
})

/** Routine 125: `moveq #$17,d0` — AMOS 23. Every range check lands here. */
const funcCall = (): never => {
  throw new AmosError('Illegal function call', 23)
}

/**
 * The most Pbobs this build will reserve.
 *
 * `cmp.l #$40,d0 / Rbhi routine 125` in routine 6. The doc: "You can reserve
 * a list for a maximum of 64 Pbobs. I can change this if you want more of
 * them, but 64 seems to be enough for most applications..." — and the
 * registered version does 256.
 */
const MAX_PBOBS = 64

/** `mulu.w #$24` — 36 bytes a line, six per bitplane across six bitplanes. */
const SAVE_BYTES_PER_LINE = 36

/** `AllocMem($2c, MEMF_PUBLIC|MEMF_CLEAR)` then the four non-zero fields. */
function newPbob(maxHeight: number): Pbob {
  return {
    x: 0,
    y: 0,
    f8: 0xff, // moveq #$ff,d0 / move.w d0,$8(a0)
    f12: 0xff, // move.w d0,$12(a0)
    maxHeight,
    image8: 0,
    replace: 0,
    planeMask: 0xff, // move.b d0,$1f(a0)
    save: new Uint8Array(maxHeight * SAVE_BYTES_PER_LINE),
  }
}

/**
 * The structure a numbered Pbob resolves to, or null.
 *
 * Every accessor does the same four instructions --- `Rble routine 125` for
 * zero or negative, `cmp.w $c(a2),d0 / Rbhi routine 125` for past the count,
 * then `subq.w #$1,d0 / lsl.w #$3,d0` because the numbering is 1-BASED and
 * the stride is eight. The doc calls that out: "the Pbob numbering starts at
 * 1, not 0 like the AMOS/Pro Bobs".
 */
function pbobOf(rt: Runtime, n: number): Pbob | null {
  const s = rt.powerbobs
  if (n <= 0) funcCall() // Rble — signed, so 0 and negatives are error 23
  if (n > s.count) funcCall() // Rbhi — unsigned, above the reserved count
  return s.bobs[n - 1] ?? null
}

export function makePowerBobsInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): PowerBobsState => rt.powerbobs

  return {
    /**
     * Reserve Pbobs n — routine 6 ($10e2), 100 bytes.
     *
     * `Rbsr routine 10` first, so reserving throws away whatever was there;
     * then three range checks, all to error 23: the count at $c must be zero
     * (so a second Reserve without an Erase between is refused --- except the
     * Erase at the top already cleared it, which makes that test dead code),
     * n must be positive, and n must not exceed 64.
     *
     * Two allocations, both MEMF_PUBLIC|MEMF_CLEAR: `n * 8` for the Pbob
     * table and `n * 4` for a second one at $4. Either failing is error 24.
     *
     * NOTE: the `tst.w $c(a2) / Rbne routine 125` at $10ea cannot fire. The
     * `Rbsr routine 10` two instructions earlier ends with `clr.w $c(a2)`,
     * so the field is always zero by the time it is tested. Transcribed as
     * the dead branch it is rather than dropped, because the next version of
     * this library might have reordered them.
     */
    'reserve pbobs'(it) {
      const n = it.evalInt()
      const s = st()
      eraseAll(s) // Rbsr routine 10
      if (n <= 0) funcCall() // Rble
      if (n > MAX_PBOBS) funcCall() // cmp.l #$40,d0 / Rbhi
      s.bobs = new Array<Pbob | null>(n).fill(null)
      s.bobsDbuf = new Array<Pbob | null>(n).fill(null)
      s.count = n
    },

    /**
     * Pbob Height nr,maxheight — routine 7 ($1146), 256 bytes.
     *
     * Gives one Pbob its structure and the buffer the background is saved
     * into. The height is a hard promise: the doc says the displayed image
     * "may NOT exceed the maximum height for this Pbob", and the buffer is
     * sized `maxheight * 36` — six bytes a line for each of six bitplanes,
     * which is also why an image may be at most 32 pixels wide.
     *
     * Four checks, all error 23: height positive, number positive, number
     * within the reserved count, and the slot not already defined. That last
     * one means Pbob Height cannot be used to resize a Pbob — only Pbob
     * Erase, which throws the whole table away, undoes it.
     *
     * With Pbob Dbuf on, the entire allocation happens twice and the second
     * structure goes in the slot's other half. So Pbob Dbuf has to be set
     * BEFORE any Pbob Height, exactly as the doc insists: "This command MUST
     * preceed all following commands!"
     */
    'pbob height'(it) {
      const nr = it.evalInt()
      it.expect(',')
      const height = it.evalInt()
      const s = st()
      if (height <= 0) funcCall() // the LAST argument is popped first
      if (nr <= 0) funcCall()
      if (nr > s.count) funcCall()
      if (s.bobs[nr - 1]) funcCall() // tst.l (a0,d6.w) / Rbne — already defined
      s.bobs[nr - 1] = newPbob(height)
      if (s.dbuf !== 0) s.bobsDbuf[nr - 1] = newPbob(height)
    },

    /**
     * Pbob Erase — routine 10 ($15cc), 138 bytes.
     *
     * Frees every structure and both tables, and zeroes the count. Routine 0
     * calls it from the reset hook, which is the doc's "executed internally
     * every time you run the AMOS/Pro program or when leaving AMOS/Pro".
     *
     * The walk steps by FOUR over a table of eight-byte slots (`addq.l #$4,d6
     * / cmp.w d7,d6 / blt` against `count * 8`), so one loop covers the
     * normal and double-buffered structures without knowing which is which.
     */
    'pbob erase'() {
      eraseAll(st())
    },

    /**
     * Pbob Dbuf flag — routine 12 ($20b2), 30 bytes.
     *
     * True stores $ffff at $10, false stores 0, and both clear the long at
     * $12. Nothing else happens: it does not allocate the second structures,
     * it only decides whether Pbob Height will. Setting it after the Pbob
     * Heights leaves a table with no second half, which is why the doc puts
     * it first.
     */
    'pbob dbuf'(it) {
      st().dbuf = it.evalInt() !== 0 ? 0xffff : 0
    },

    /**
     * Set Fastpbob Mode flag — routine 46 ($361e), 20 bytes: `st.b`/`sf.b`
     * into $1ba.
     *
     * The global form of Set Pbob's replace mode. The doc: "turning off the
     * background saving/restoring process for ALL Pbob's when set to True.
     * If set to False, every Pbob will be checked for". So the per-Pbob flag
     * is only consulted when this one is off.
     */
    'set fastpbob mode'(it) {
      st().fastMode = it.evalInt() !== 0
    },

    /**
     * Set Pbob nr,replace,planemask — routine 23 ($2960), 76 bytes.
     *
     * `replace` is normalised: `cmp.l #$0,d6 / beq` keeps zero and anything
     * else becomes `moveq #$ff`, so every non-zero value is the same value.
     * Zero means save and restore the background, which is the default.
     *
     * `planemask` picks which bitplanes of the Pbob reach the screen, one bit
     * each, and the doc's example is `Set Pbob 1,0,%100001` for planes 6
     * and 1. Both are stored as BYTES, so a mask above 255 keeps only its
     * low eight bits.
     *
     * Unlike X Pbob and its neighbours this one DOES check that the Pbob has
     * a structure --- `move.l (a0,d5.w),d0 / Rbeq routine 125` --- and with
     * Pbob Dbuf on it writes both copies, so the setting survives a swap.
     */
    'set pbob'(it) {
      const nr = it.evalInt()
      it.expect(',')
      const replace = it.evalInt()
      it.expect(',')
      const mask = it.evalInt()
      const s = st()
      if (nr <= 0) funcCall()
      if (nr > s.count) funcCall()
      const r = replace !== 0 ? 0xff : 0 // every non-zero collapses to $ff
      const b = s.bobs[nr - 1]
      if (!b) funcCall()
      b!.replace = r
      b!.planeMask = mask & 0xff
      if (s.dbuf !== 0) {
        const d = s.bobsDbuf[nr - 1]
        if (d) {
          d.replace = r
          d.planeMask = mask & 0xff
        }
      }
    },
  }
}

/**
 * Routine 10's body, shared with Reserve Pbobs which calls it first.
 *
 * Frees the save buffer (`$14(a0) * 36` bytes) and then the 44-byte structure
 * for every defined slot, then both tables, then clears the count. Here the
 * garbage collector does the freeing and only the clearing is visible.
 */
function eraseAll(s: PowerBobsState): void {
  s.bobs = []
  s.bobsDbuf = []
  s.count = 0 // clr.w $c(a2)
}

export function makePowerBobsFunctions(rt: Runtime): Record<string, Func> {
  /**
   * X Pbob(n) / Y Pbob(n) / I Pbob(n) — routines 13 ($20d0), 14 ($20f4) and
   * 5 ($10ba). The position the last Pbob call left, and the image it drew.
   *
   * `I Pbob` reads the word at $1c and shifts it right three, because the
   * image number is kept multiplied by eight — the stride of AMOS's icon
   * table, so the draw path never has to multiply.
   *
   * DEVIATION: all three resolve the structure pointer and read through it
   * WITHOUT testing it, where Set Pbob tests. A Pbob that was reserved but
   * never given a Pbob Height has a null pointer, and the real routine then
   * reads addresses $0, $2 and $1c — the bottom of the 68000 exception vector
   * table, which answers whatever the machine happens to hold. That is not a
   * value this port can reproduce and not one a program could rely on; 0 is
   * returned instead. The range checks either side of it ARE reproduced.
   */
  const field = (n: number, read: (b: Pbob) => number): Value => {
    const b = pbobOf(rt, n)
    return VI(b ? read(b) : 0)
  }

  return {
    'x pbob': (_, a): Value => field(int(a[0]!), (b) => (b.x << 16) >> 16),
    'y pbob': (_, a): Value => field(int(a[0]!), (b) => (b.y << 16) >> 16),
    'i pbob': (_, a): Value => field(int(a[0]!), (b) => (b.image8 & 0xffff) >>> 3),
  }
}
