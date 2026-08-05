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
  /**
   * $8 — a word routine 7 initialises to $FFFF. Pbob (routine 2) overwrites
   * it with the image height.
   */
  f8: number
  /**
   * $12 — a word, initialised to $FFFF, and it is really TWO flag bytes.
   * `$12` is "this Pbob is off screen", set by Pbob's clip test; `$13` is
   * "there is nothing drawn to restore", which Pbob Clear tests first. Both
   * start set, which is what stops a Pbob Clear before any Pbob Draw from
   * restoring a buffer that has never been saved into.
   */
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
  /**
   * $a — the left clip limit, and it is NEGATIVE: `moveq #$f0` sign-extends
   * to -16 for a one-word image and `moveq #$e0` to -32 for a two-word one.
   * A Pbob at an x at or left of it is entirely off the screen.
   */
  leftLimit: number
  /** $24 — which icon table entry the last Pbob call resolved to, or -1 */
  iconEntry: number
  /**
   * $20 / $18 / $16 / $1a as this port keeps them: the blitter fields are a
   * destination byte offset, a BLTSIZE, a modulo and a plane count, all of
   * which say the same thing as the clipped rectangle the save covers. Kept
   * as the rectangle, because nothing reads them from BASIC and the pixels
   * are what has to match.
   */
  saveX: number
  saveY: number
  saveW: number
  saveH: number
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
  /**
   * $12 and $14 — the buffer selectors, and they are SEPARATE.
   *
   * Each is 0 or 4, added to a Pbob's table index so it lands on the normal
   * structure or the double-buffered one. Pbob Draw adds $12, Pbob Clear
   * adds $14, and Pswap Clear flips only the second with `eori.w #$4,$14`.
   * Two selectors rather than one is what lets a program clear the buffer it
   * is about to leave while drawing into the one it is about to show.
   */
  drawSel: number
  clearSel: number
  /** $18 / $1a — the range the last Pbob Draw was given, kept for its loop */
  drawLo: number
  drawHi: number
  /** $16 — Pbob Update's own selector, a THIRD one beside draw and clear */
  updateSel: number
  /** the four wrapping ranges: $504/$51c/$534/$54c and $554/$557/$55a/$55d */
  rInc: PRange
  rDec: PRange
  rAdd: PRange
  rSum: PRange
  /** $1b9, and the $1c/$1e pair Pdraw 25fps loads with 2 when it is on */
  fps25: boolean
  fps25a: number
  fps25b: number
}

export const newPowerBobsState = (): PowerBobsState => ({
  bobs: [],
  bobsDbuf: [],
  count: 0,
  dbuf: 0,
  fastMode: false,
  drawSel: 0,
  clearSel: 0,
  drawLo: 0,
  drawHi: 0,
  updateSel: 0,
  rInc: newRange(),
  rDec: newRange(),
  rAdd: newRange(),
  rSum: newRange(),
  fps25: false,
  fps25a: 0,
  fps25b: 0,
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
    // `moveq #$ff,d0` SIGN-EXTENDS: d0 is $FFFFFFFF, not $000000FF. So the
    // two `move.w` stores write $FFFF and only the `move.b` writes $FF.
    f8: 0xffff,
    f12: 0xffff,
    maxHeight,
    image8: 0,
    replace: 0,
    planeMask: 0xff, // move.b d0,$1f(a0)
    save: new Uint8Array(maxHeight * SAVE_BYTES_PER_LINE),
    leftLimit: 0,
    iconEntry: -1,
    saveX: 0,
    saveY: 0,
    saveW: 0,
    saveH: 0,
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
     * Pbob nr,x,y,image — routine 2 ($f64), 246 bytes, and the array form
     * `Pbob ax,ay,ai,start To end` is routine 15 ($211a). Neither appears in
     * extdis's --list, because both are unnamed alternate table entries under
     * the `!pbob` primary.
     *
     * It DEFINES rather than draws. Every field the blitter path will need is
     * worked out here and stored, and Pbob Draw walks the table later; that
     * split is the whole design, and it is why a Pbob survives a Screen Swap
     * without being restated.
     *
     * Five checks, in the order the routine makes them:
     *   no icon bank at all is routine 115's AMOS 36, "Bank not reserved"
     *   image <= 0, number <= 0, number > count  --- error 23
     *   image > the icon count (`cmp.w (a0),d7 / Rbhi`) --- error 23
     *   an image WIDER THAN TWO WORDS --- `cmp.w #$2,d1 / Rbhi` --- error 23,
     *     which is the doc's "the maximum width of the IMAGE is 32 pixels"
     *   an image TALLER than this Pbob's maximum --- routine 112, which the
     *     doc describes as a certain crash if the colours exceed the screen
     *
     * The clip test is four comparisons and it decides the flag at $12, not
     * whether anything is stored: the fields are written either way, and the
     * flag is what Pbob Draw tests. The left limit is NEGATIVE and comes from
     * the width --- `moveq #$f0` sign-extends to -16 for a one-word image,
     * `moveq #$e0` to -32 for a two-word one --- so a Pbob is off the left
     * only once its whole width has passed the edge.
     *
     * With Pbob Dbuf on, every field is written to BOTH structures.
     */
    pbob(it) {
      const nr = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const image = it.evalInt()
      const s = st()
      const bank = rt.iconBank
      // `moveq #$1,d0 / Rjsr <AMOS> / Rbeq routine 115` — AMOS 36
      if (!bank) throw new AmosError('Bank not reserved', 36)
      if (image <= 0) funcCall() // the LAST argument is popped first
      if (nr <= 0) funcCall()
      if (nr > s.count) funcCall()
      if (image > bank.images.length) funcCall() // cmp.w (a0),d7 / Rbhi
      const img = bank.image(image)
      if (!img) funcCall()
      const widthWords = Math.ceil(img!.width / 16)
      if (widthWords > 2) funcCall() // cmp.w #$2,d1 / Rbhi — 32 pixels
      const b = s.bobs[nr - 1]
      if (!b) funcCall() // move.l (a1,d4.w),d2 / Rbeq routine 111
      const height = img!.height
      if (height > b!.maxHeight) throw new AmosError('Illegal function call', 23)
      const leftLimit = widthWords === 2 ? -32 : -16
      // the four clip tests, at $fce-$fe4, against the CURRENT screen
      const scr = rt.screen
      const off = x <= leftLimit || y + height <= 0 || x >= scr.width || y >= scr.height
      const write = (t: Pbob): void => {
        t.f12 = off ? 0xff00 | (t.f12 & 0xff) : t.f12 & 0xff // st.b/sf.b $12
        t.x = x & 0xffff
        t.y = y & 0xffff
        t.f8 = height & 0xffff
        t.leftLimit = leftLimit
        t.image8 = (image << 3) & 0xffff
        t.iconEntry = image
      }
      write(b!)
      if (s.dbuf !== 0 && s.bobsDbuf[nr - 1]) write(s.bobsDbuf[nr - 1]!)
    },

    /**
     * Pbob Off — routines 3 ($105a), 4 ($108a) and 21 ($25fe), three forms of
     * one keyword and 48 to 80 bytes each.
     *
     * All three do the same single thing: `st.b $12(a1)`, the off-screen flag
     * Pbob's clip test writes, so a Pbob turned off is one Pbob Draw steps
     * over. Nothing is freed and no position is lost --- the doc's "Does the
     * same thing as the Amos Bob Off NR command".
     *
     * The bare form refuses outright when nothing is reserved (`move.w
     * $c(a2),d7 / Rble routine 125`), and the range form checks both ends
     * against the count and then `sub.w d5,d6 / Rbmi` for a reversed pair.
     *
     * DEVIATION: like X Pbob, none of the three tests the structure pointer
     * before writing through it, so on the real machine `Pbob Off` over a
     * reserved-but-undefined Pbob writes a byte to address $12. Skipped here.
     */
    'pbob off'(it) {
      const s = st()
      const kill = (n: number): void => {
        const b = s.bobs[n - 1]
        if (b) b.f12 = 0xff00 | (b.f12 & 0xff)
        if (s.dbuf !== 0) {
          const d = s.bobsDbuf[n - 1]
          if (d) d.f12 = 0xff00 | (d.f12 & 0xff)
        }
      }
      if (it.atStmtEnd()) {
        if (s.count <= 0) funcCall() // routine 3: Rble
        for (let n = 1; n <= s.count; n++) kill(n)
        return
      }
      const first = it.evalInt()
      if (!it.accept('to')) {
        if (first <= 0) funcCall() // routine 4
        if (first > s.count) funcCall()
        kill(first)
        return
      }
      const last = it.evalInt() // routine 21
      if (s.count <= 0) funcCall()
      if (last <= 0 || first <= 0) funcCall()
      if (last > s.count || first > s.count) funcCall()
      if (last - first < 0) funcCall() // sub.w d5,d6 / Rbmi
      for (let n = first; n <= last; n++) kill(n)
    },

    /**
     * Pdraw 25fps flag — routine 38 ($33da), 36 bytes.
     *
     * True sets the byte at $1b9 and loads TWO with 2, at $1c and $1e; false
     * clears the byte and both words with one `clr.l $1c(a2)`. The doc gives
     * the reason rather than the mechanism: "In ProjectX and Alien Breed and
     * quite a lot of other games, the main Sprite etc., is updated at 50
     * frames per second, but the Bobs are only updated at 25". It is reset to
     * 50fps every time a program runs, and it does not affect Pbob Update.
     */
    'pdraw 25fps'(it) {
      const s = st()
      if (it.evalInt() !== 0) {
        s.fps25 = true
        s.fps25a = 2
        s.fps25b = 2
      } else {
        s.fps25 = false
        s.fps25a = 0
        s.fps25b = 0
      }
    },

    /**
     * Pswap Clear — routine 39 ($33fe), TWELVE bytes: `eori.w #$4,$14(a2)`.
     *
     * Flips the buffer the next Pbob Clear will restore from, and only that
     * one --- Pbob Draw reads its own selector at $12. Two independent
     * selectors are what let a double-buffered program clear the buffer it is
     * leaving while drawing into the one it is about to show.
     */
    'pswap clear'() {
      st().clearSel ^= 4
    },

    /**
     * Pbob Clear start To end — routine 8 ($1246), 210 bytes.
     *
     * Restores the backgrounds the last draw took, over the range given. The
     * index gets `$14(a2)` added --- the CLEAR selector, which Pswap Clear
     * flips --- so a double-buffered program restores from the structure that
     * belongs to the buffer it is about to leave.
     *
     * Two skips, and they are what make it safe to call before any draw:
     * `tst.b $13(a2) / bne` steps over a Pbob that was off screen or never
     * drawn, and `move.w $1e(a2),d3 / bmi` over one whose Set Pbob replace
     * mode is on. That second one reads $1e and $1f TOGETHER as a word, so
     * bit 15 is the replace flag and the low byte is the plane mask the
     * restore then walks.
     */
    'pbob clear'(it) {
      const lo = it.evalInt()
      it.expect('to')
      const hi = it.evalInt()
      const s = st()
      if (hi < lo) funcCall() // cmp.w d6,d7 / Rblt
      if (hi > s.count) funcCall() // cmp.w $c(a2),d7 / Rbhi
      clearPass(rt, lo, hi, s.clearSel)
    },

    /**
     * Pbob Draw start To end — routine 9 ($1318), 692 bytes, the biggest
     * routine in the extension.
     *
     * Two passes over the range. The first takes every background --- BLTDPT
     * is the save buffer and BLTAPT the screen plane, so the blit runs screen
     * into buffer --- and only then does the second draw the images. Doing it
     * in that order is what makes a group of OVERLAPPING Pbobs come out
     * right: no image is on the screen yet when the last background is taken.
     *
     * Between the passes sits the buffer flip, and it is not unconditional:
     * only with Pbob Dbuf on, and in 25fps mode only every other call, by
     * counting `$1e(a2)` down from 2. Both selectors flip together there,
     * which is the one place Pbob Draw touches the clear side.
     *
     * The index gets `$12(a2)` added, the DRAW selector. Set Fastpbob Mode
     * takes a separate hundred-byte path at $1562 that skips the save
     * entirely, which this port expresses by skipping pass one.
     */
    'pbob draw'(it) {
      const lo = it.evalInt()
      it.expect('to')
      const hi = it.evalInt()
      const s = st()
      if (hi < lo) funcCall()
      if (hi > s.count) funcCall()
      s.drawLo = lo
      s.drawHi = hi
      drawPass(rt, lo, hi, s.drawSel)
    },

    /**
     * Pbob Update — routine 22 ($264e), 786 bytes.
     *
     * Pbob Clear and Pbob Draw over EVERY Pbob at once, through a THIRD
     * selector at `$16(a2)` --- draw has $12 and clear has $14. The doc: "Does
     * the same thing as the Amos Bob Update command, except that the Logical
     * and Physical Screens are not swapped. This allows a better control on
     * the updating process if you are using multiple double buffered
     * screens", and `Pdraw 25fps` deliberately does not reach it.
     *
     * `move.w $c(a2),d7 / Rbeq routine 125` --- with nothing reserved this is
     * error 23, where Pbob Clear and Pbob Draw would simply have an empty
     * range.
     */
    'pbob update'() {
      const s = st()
      if (s.count === 0) funcCall() // Rbeq, not Rble: only zero is refused
      clearPass(rt, 1, s.count, s.updateSel)
      drawPass(rt, 1, s.count, s.updateSel)
    },

    /**
     * The array arithmetic block — routines 58-77, and the fastest way to
     * move a whole table of Pbob coordinates in one statement.
     *
     * Every one takes a Varptr rather than an array, steps by FOUR because
     * the doc requires longwords, and offsets the pointer by `start * 4`
     * before a `dbra` over `end - start`. A reversed pair is `sub.w d6,d7 /
     * Rbmi routine 125`, error 23; a negative start is the same. Nothing
     * checks the array's LENGTH, which the doc says outright.
     *
     * Pinc, Pdec, Padd and Psum each consult a wrapping range if one is set.
     * The wrap is a CYCLE and not a clamp --- `cmp.l d1,d0 / blt` stores the
     * HIGH limit and `cmp.l d2,d0 / bgt` the LOW one --- which is what makes
     * them useful for animation counters that have to come back round.
     */
    pinc(it) {
      arrayOp(rt, it, 0, (v, _k, s) => wrapInto(v + 1, s.rInc))
    },
    pdec(it) {
      arrayOp(rt, it, 0, (v, _k, s) => wrapInto(v - 1, s.rDec))
    },
    padd(it) {
      arrayOp(rt, it, 1, (v, k, s) => wrapInto(v + k, s.rAdd))
    },
    psum(it) {
      arrayOp(rt, it, 1, (v, k, s) => wrapInto(v + k, s.rSum))
    },
    plsl(it) {
      arrayOp(rt, it, 1, (v, k) => (v << (k & 31)) | 0)
    },
    plsr(it) {
      arrayOp(rt, it, 1, (v, k) => (v >>> (k & 31)) | 0)
    },
    pasl(it) {
      arrayOp(rt, it, 1, (v, k) => (v << (k & 31)) | 0)
    },
    pasr(it) {
      arrayOp(rt, it, 1, (v, k) => v >> (k & 31))
    },

    /**
     * Pmul dest,src,factor,start To end — routine 62 ($3bd8), 64 bytes, and
     * Pmul Shift is routine 63 with an extra shift argument.
     *
     * The multiply is done by hand out of `mulu.w` and `swap`, because the
     * 68000 has no 32x32 multiply: the two halves are crossed and added.
     * Reproduced as a plain 32-bit multiply, which is the same answer.
     */
    pmul(it) {
      arrayOp2(rt, it, 0, (v, k) => Math.imul(v, k))
    },
    'pmul shift'(it) {
      arrayOp2(rt, it, 1, (v, k, sh) => Math.imul(v, k) >> (sh & 31))
    },

    /**
     * Pdiv dest,src,divisor,start To end — routine 77 ($3ede), 152 bytes.
     *
     * A zero divisor is `Rbeq routine 125`, error 23, rather than the trap
     * the 68000 would take.
     *
     * NOTE: `adda.l d6,a1` at $3efc adds the start offset to a1, which this
     * routine never loads and never reads --- three pointers are adjusted
     * where only two were popped. Harmless dead code, and a sign the routine
     * was copied from a three-array version.
     */
    pdiv(it) {
      arrayOp2(rt, it, 0, (v, k) => (v / k) | 0, true)
    },

    /** Set/Unset the four wrapping ranges — routines 58-61 and 64-67. */
    'set psum range'(it) {
      setRange(rt, it, (s) => s.rSum)
    },
    'set pinc range'(it) {
      setRange(rt, it, (s) => s.rInc)
    },
    'set pdec range'(it) {
      setRange(rt, it, (s) => s.rDec)
    },
    'unset psum range'() {
      st().rSum.on = false
    },
    'unset pinc range'() {
      st().rInc.on = false
    },
    'unset pdec range'() {
      st().rDec.on = false
    },
    'unset padd range'() {
      st().rAdd.on = false
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

/* ------------------------------------------------------------------ *
 * The draw engine
 * ------------------------------------------------------------------ */

/**
 * A Pbob's rectangle, clipped to the screen exactly where the routine clips.
 *
 * Pbob Draw does the clipping in blitter terms: `move.w $2(a2),d4 / bgt` sends
 * a y at or above zero down the ordinary path and a negative one to `add.w
 * d4,d1`, which SHORTENS the height by the overhang and then zeroes the row
 * offset; the bottom is `move.w $4e(a4),d0 / sub.w d4,d0 / cmp.w d0,d1 / ble`,
 * clamping the height to what is left of the screen. The horizontal side
 * works in words --- `andi.w #$fff0,d5` is the x rounded down to a word,
 * `sub.w d5,d2 / lsr.w #$4,d2` the words that fit, and `cmp.w d3,d5 / beq`
 * adds one more when the x is not word aligned, which is the shift margin.
 *
 * All of that says: the visible rectangle, clipped to the screen. It is kept
 * as a rectangle here rather than as BLTSIZE and a modulo because nothing
 * reads those from BASIC and the pixels are what has to match.
 */
function clipRect(
  b: Pbob,
  w: number,
  h: number,
  sw: number,
  sh: number,
): { x: number; y: number; w: number; h: number; sx: number; sy: number } {
  const bx = (b.x << 16) >> 16
  const by = (b.y << 16) >> 16
  const x = Math.max(0, bx)
  const y = Math.max(0, by)
  return {
    x,
    y,
    w: Math.min(bx + w, sw) - x,
    h: Math.min(by + h, sh) - y,
    sx: x - bx, // where in the image the visible part starts
    sy: y - by,
  }
}

/**
 * The plane mask, applied the way a plane-selective blit applies it.
 *
 * `lsr.b #$1,d3 / bcc` walks the byte at $1f one bit a plane and skips the
 * planes whose bit is clear, so a plane that is skipped keeps whatever the
 * screen already had. Copying plane p means the destination's bit p becomes
 * the source's, which over a whole pixel is exactly this.
 */
const merge = (dst: number, src: number, mask: number): number => (dst & ~mask) | (src & mask)

/**
 * Pbob Draw's two passes, and Pbob Update's.
 *
 * Pass one SAVES: `move.l $28(a2),$52(a1)` puts the save buffer in BLTDPT and
 * `move.l a3,(a5)` the screen plane in BLTAPT, so the blit runs screen ->
 * buffer. Pass two draws the image the other way. Between them sits the
 * buffer flip. Two passes rather than one is what makes a group of
 * overlapping Pbobs come out right: every background is taken before any
 * image lands on top of another one's.
 *
 * NOTE: BLTCON0 is $09f0 in all three routines --- USEA and USED only, with
 * minterm $f0, D = A. There is no B channel and no mask, so a Pbob is an
 * OPAQUE RECTANGLE and colour 0 is drawn like any other. That is the sharpest
 * difference from an AMOS bob, it is not in the doc, and only the register
 * value says it.
 */
function drawPass(rt: Runtime, lo: number, hi: number, sel: number): void {
  const s = rt.powerbobs
  const scr = rt.screen
  const pick = (n: number): Pbob | null => (sel === 0 ? s.bobs[n - 1] : s.bobsDbuf[n - 1]) ?? null
  const bank = rt.iconBank

  // pass one --- take every background before anything is drawn over it
  if (!s.fastMode) {
    for (let n = lo; n <= hi; n++) {
      const b = pick(n)
      if (!b || (b.f12 & 0xff00) !== 0) continue // tst.b $12(a2) / bne
      if (b.replace !== 0) continue // tst.b $1e(a2) --- saving is switched off
      const img = bank?.image(b.iconEntry)
      if (!img) continue
      const r = clipRect(b, img.width, img.height, scr.width, scr.height)
      b.saveX = r.x
      b.saveY = r.y
      b.saveW = Math.max(0, r.w)
      b.saveH = Math.max(0, r.h)
      for (let dy = 0; dy < b.saveH; dy++) {
        for (let dx = 0; dx < b.saveW; dx++) {
          b.save[dy * SAVE_BYTES_PER_LINE + dx] = scr.point(r.x + dx, r.y + dy)
        }
      }
    }
  }

  // the flip, at $14fc: only with Pbob Dbuf on, and in 25fps mode only every
  // other call --- `subq.w #$1,$1e(a2) / bne` then a reload of 2
  if (s.dbuf !== 0) {
    let flip = true
    if (s.fps25) {
      s.fps25b = (s.fps25b - 1) & 0xffff
      if (s.fps25b !== 0) flip = false
      else s.fps25b = 2
    }
    if (flip) {
      s.drawSel ^= 4
      s.clearSel ^= 4
    }
  }

  // pass two --- and $12 is copied into $13 first, which is how Pbob Clear
  // later knows whether this Pbob left anything behind to restore
  for (let n = lo; n <= hi; n++) {
    const b = pick(n)
    if (!b) continue
    b.f12 = (b.f12 & 0xff00) | ((b.f12 >> 8) & 0xff) // move.b $12(a4),d0 / move.b d0,$13(a4)
    if ((b.f12 & 0xff00) !== 0) continue
    const img = bank?.image(b.iconEntry)
    if (!img) continue
    const r = clipRect(b, img.width, img.height, scr.width, scr.height)
    for (let dy = 0; dy < r.h; dy++) {
      for (let dx = 0; dx < r.w; dx++) {
        const src = img.pixelAt(r.sx + dx, r.sy + dy)
        scr.putPixel(r.x + dx, r.y + dy, merge(scr.point(r.x + dx, r.y + dy), src, b.planeMask))
      }
    }
  }
}

/** Pbob Clear's single pass: the save buffer back onto the screen. */
function clearPass(rt: Runtime, lo: number, hi: number, sel: number): void {
  const s = rt.powerbobs
  const scr = rt.screen
  for (let n = lo; n <= hi; n++) {
    const b = (sel === 0 ? s.bobs[n - 1] : s.bobsDbuf[n - 1]) ?? null
    if (!b) continue
    if ((b.f12 & 0xff) !== 0) continue // tst.b $13(a2) / bne --- nothing was drawn
    if (b.replace !== 0) continue // move.w $1e(a2),d3 / bmi --- reads $1e AND $1f
    for (let dy = 0; dy < b.saveH; dy++) {
      for (let dx = 0; dx < b.saveW; dx++) {
        const src = b.save[dy * SAVE_BYTES_PER_LINE + dx]!
        scr.putPixel(b.saveX + dx, b.saveY + dy, merge(scr.point(b.saveX + dx, b.saveY + dy), src, b.planeMask))
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * The array arithmetic block
 * ------------------------------------------------------------------ */

/**
 * The four wrapping ranges, and where each keeps its flag and its two limits.
 *
 * Read out of the setters and the users rather than assumed --- they are not
 * in an obvious order, and Padd's setter has no NAMED table entry at all:
 *
 *   Psum  flag $55d  limits $54c/$550   set by routine 64, unset by 61
 *   Pdec  flag $557  limits $51c/$520   set by routine 65, unset by 58
 *   Pinc  flag $554  limits $504/$508   set by routine 66, unset by 59
 *   Padd  flag $55a  limits $534/$538   set by routine 67, unset by 60
 */
export interface PRange {
  on: boolean
  lo: number
  hi: number
}

const newRange = (): PRange => ({ on: false, lo: 0, hi: 0 })

/**
 * A range applied, and it WRAPS rather than clamping.
 *
 *     cmp.l d1,d0 / blt  -> store d2      below the low limit, take the HIGH
 *     cmp.l d2,d0 / bgt  -> store d1      above the high limit, take the LOW
 *
 * That is a cycle, not a clamp, and it is what makes these useful for
 * animation counters: a frame number that runs off the end comes back at the
 * start without the program testing for it.
 */
function wrapInto(v: number, r: PRange): number {
  if (!r.on) return v | 0
  if (v < r.lo) return r.hi | 0
  if (v > r.hi) return r.lo | 0
  return v | 0
}

/**
 * One element of the addressed array, as a signed long.
 *
 * Every one of these keywords takes an address rather than an array, and
 * steps by four: `add.w d6,d6 / add.w d6,d6 / adda.l d6,a0` is the start
 * index times four. The doc is explicit that the values must be LONGWORDS,
 * and that the array length is never checked --- "It has been carefully
 * optimised to give the best speed possible".
 *
 * DEVIATION: this reaches whatever the address space makes CONTIGUOUS, which
 * is memory banks --- the doc's own second option, "It is also possible to
 * use AMOS/Pro banks for storing the X/Y coordinates and the Image of the
 * Pbob's" --- but NOT a `Varptr` into a BASIC array. Varptr here hands out a
 * padded arena slot per variable cell rather than a view into one contiguous
 * array, so `Varptr(A(0)) + 4` does not arrive at `A(1)` and the walk stops
 * after the first element. That is a property of the arena, not of this
 * extension, and it is the one form the doc leads with. A program that uses
 * a bank gets the whole operation; one that uses Varptr gets one element.
 */
function elem(rt: Runtime, addr: number, i: number): number | null {
  const m = rt.resolveAddr(addr + i * 4)
  if (!m || m.off + 3 >= m.data.length) return null
  const d = m.data
  return ((d[m.off]! << 24) | (d[m.off + 1]! << 16) | (d[m.off + 2]! << 8) | d[m.off + 3]!) | 0
}

function setElem(rt: Runtime, addr: number, i: number, v: number): void {
  const m = rt.resolveWrite(addr + i * 4)
  if (!m || m.off + 3 >= m.data.length) return
  const d = m.data
  d[m.off] = (v >>> 24) & 0xff
  d[m.off + 1] = (v >>> 16) & 0xff
  d[m.off + 2] = (v >>> 8) & 0xff
  d[m.off + 3] = v & 0xff
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

/**
 * `<op> ptr[,k] start To end` — the shape all of Pinc, Pdec, Padd, Psum and
 * the four shifts share.
 *
 * `extra` is how many scalars sit between the pointer and the range. The pops
 * come off in reverse, so `end` is first and the pointer last.
 */
function arrayOp(
  rt: Runtime,
  it: Parameters<Instr>[0],
  extra: number,
  f: (v: number, k: number, s: PowerBobsState) => number,
): void {
  const addr = it.evalInt()
  it.expect(',')
  let k = 0
  for (let i = 0; i < extra; i++) {
    k = it.evalInt()
    it.expect(',')
  }
  const start = it.evalInt()
  it.expect('to')
  const end = it.evalInt()
  if (start < 0) funcCall() // Rbmi
  if (end - start < 0) funcCall() // sub.w d6,d7 / Rbmi
  const s = rt.powerbobs
  for (let i = start; i <= end; i++) {
    const v = elem(rt, addr, i)
    if (v === null) return // past the end of the region: the real one runs on
    setElem(rt, addr, i, f(v, k, s))
  }
}

/** Pmul, Pmul Shift and Pdiv: a source array and a separate destination. */
function arrayOp2(
  rt: Runtime,
  it: Parameters<Instr>[0],
  extra: number,
  f: (v: number, k: number, sh: number) => number,
  guardK = false,
): void {
  const dst = it.evalInt()
  it.expect(',')
  const src = it.evalInt()
  it.expect(',')
  const k = it.evalInt()
  if (guardK && k === 0) funcCall() // Pdiv: `move.l (a3)+,d4 / Rbeq routine 125`
  it.expect(',')
  let sh = 0
  for (let i = 0; i < extra; i++) {
    sh = it.evalInt()
    it.expect(',')
  }
  const start = it.evalInt()
  it.expect('to')
  const end = it.evalInt()
  if (start < 0 || end - start < 0) funcCall()
  for (let i = start; i <= end; i++) {
    const v = elem(rt, src, i)
    if (v === null) return
    setElem(rt, dst, i, f(v, k, sh))
  }
}

/** `Set P* Range lo To hi` — two longs and the flag, routines 64 to 67. */
function setRange(rt: Runtime, it: Parameters<Instr>[0], pick: (s: PowerBobsState) => PRange): void {
  const lo = it.evalInt()
  it.expect('to')
  const hi = it.evalInt()
  const r = pick(rt.powerbobs)
  r.lo = lo | 0
  r.hi = hi | 0
  r.on = true
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

    /**
     * =Same — routine 68 ($3cf4), TEN bytes and no arguments:
     * `move.l #$80000000,d3 / moveq #$0,d2 / rts`.
     *
     * A constant. -2147483648 is the most negative long there is, which is
     * why it works as the "leave this one alone" marker the array operations
     * are given: no coordinate can collide with it.
     */
    same: (): Value => VI(-0x80000000),
  }
}
