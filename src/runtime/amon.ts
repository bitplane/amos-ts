/**
 * AMon — Paul Overy, 1995. Twenty-four keywords at slot 25 (1.04) and
 * eighteen at slot 16 (1.03).
 *
 * A mouse, a keyboard, two joysticks, fixed-point trigonometry and four
 * graphics primitives, every one of them reading the hardware directly. The
 * author says why in the package's own document:
 *
 * > Amos can be sped up by throwing out the multitasking system.  Lets face
 * > it, how often do you make use of the multitasking system when playing a
 * > game?
 * >
 * > However this does have one bad side effect in that, mouse control is
 * > lost.  In fact all Amos mouse/keyboard commands because useless.
 *
 * With `Execall(-132)` — exec's Forbid — in force, AMOS's own `X Mouse`,
 * `Mouse Key` and `Inkey$` die, because input.device feeds them through the
 * multitasking system that has just been switched off. AMon reads JOY0DAT,
 * CIA-A and the keyboard's serial register itself, so it survives. That is
 * why the mouse keywords are duplicated under joke names — `Rodent X`,
 * `Lrodent`, `Rrodent` — rather than replacing AMOS's: both sets exist, and
 * each works under conditions the other does not.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier. `extdis amon-1.04` and `extdis amon-1.03` open the two
 * `AmosPro_Amon.lib` files. The documents that ship beside them —
 * `Amon_1.04.doc` and `Amon1.3.doc` — are an install note, the passage quoted
 * above and a copyright page, and they describe no keyword at all, so the
 * twelve example programs in `examples_asc/` are the only statement of syntax
 * the author made and every argument order below was checked against one. Every
 * ADDRESS below is 1.04's unless it says otherwise; the release possessive is
 * what `citecheck` reads to pick which library to hold a citation to.
 *
 * The slot is the binary's. Routine 0 publishes the data zone to `$278(a5)`,
 * which is `$f8 + (25-1)*16`, and ends `moveq #$18,d0` — the extension number
 * zero-based. 1.03 does the same to `$1e8(a5)` and `moveq #$f,d0`, so it is
 * slot 16, one more than its own install note asks for.
 *
 * ## The data zone, as the routines use it
 *
 *     +$0000  the arctan table, 2530 bytes    +$09d0  raw JOY0DAT X, last read
 *     +$09c4  rodent limit, minimum X         +$09d1  raw JOY0DAT Y, last read
 *     +$09c6  rodent limit, maximum X         +$09d2  and the read before it
 *     +$09c8  rodent limit, minimum Y         +$09d3  likewise for Y
 *     +$09ca  rodent limit, maximum Y         +$09d4  Count Colour's total
 *     +$09cc  rodent Y                        +$09d6  its colour argument
 *     +$09ce  rodent X                        +$09e2  the sine table
 *
 * 1.03's zone is the same minus the two Count Colour words, so its sine table
 * is at +$09d4 instead. Both are inside the library's own code hunk, which is
 * why the shipped bytes ARE the initial state — see `newAmonState`.
 *
 * ## The two tables
 *
 * **Sine**, 91 words, one per whole degree from 0 to 90 inclusive. It is
 * `round(sin(deg) * 65535)` and it is transcribed rather than computed,
 * because the rule and the table disagree at 30 degrees: the table holds
 * 32768, the exact rounding of 32767.5, and `Math.round(Math.sin(Math.PI/6) *
 * 65535)` gives 32767, because `Math.sin(Math.PI/6)` is 0.49999999999999994.
 * A one-bit difference at one angle, and computing it would have been wrong.
 *
 * **Arctan**, 2530 bytes indexed `dx + dy*50`, is computed, because there
 * `floor(degrees(atan2(dx, dy)) * 576/360)` reproduces the shipped bytes
 * EXACTLY — all 2,499 cells the routines can reach, zero mismatches. So a
 * full circle is 576 units and a quadrant is 144, which is why row `dy=0` is
 * all 144. `amon.corpus.test.ts` checks both against the binary.
 *
 * ## What differs between 1.03 and 1.04
 *
 * Every shared routine was compared instruction by instruction. Seventeen of
 * the eighteen are the same code; the differences are two, and both are
 * observable, so both are modelled rather than recorded — `isAmon103` reads
 * the binding the way `jdprt.ts`'s `isPre14` does.
 *
 * - **The rodent limits start at zero in 1.03.** 1.04 ships the zone holding
 *   `$78, $1b8, $26, $ee` — 120 to 440 across and 38 to 238 down, AMOS's
 *   hardware coordinates. 1.03's four words are all zero, so `Rodent X` and
 *   `Rodent Y` answer 0 there until the program calls `Limit Rodent`. Nothing
 *   in the code differs; the shipped data does.
 * - **`Fast Circle` is a different routine.** 1.03's routine 23 ($1054)
 *   pushes each of the eight octant points back onto the argument stack and
 *   calls its own `Fast Plot`, so a negative colour raises AMOS error 23 from
 *   there. 1.04's routine 23 ($11cc) inlines the plot and checks the colour
 *   itself first, `Rbmi routine 53`, which is error 149. The circle drawn is
 *   the same.
 *
 * The two RENUMBERED keywords are a detokenising matter and not this port's:
 * `test add` moved from id 306 to 374 and `fast circle` from 330 to 326, so a
 * 1.03 program's `Test Add` is `Fast Point` in 1.04. The token tables carry
 * that; dispatch here is by name and both spellings mean the same routine.
 *
 * ## Defects
 *
 * - **`Fast Point` leaves the argument stack two bytes short.** With Y below
 *   zero or at the screen height, routine 22 ($11c8) is `addq.l #$2,a3 /
 *   rts` where its two longword arguments need four. `Fast Plot`'s matching
 *   path ($117a) is `addq.l #$4,a3` and is right; the bytes are `54 8b`
 *   against `58 8b`. On the machine the expression the call sits in then
 *   evaluates against a skewed stack. NOT reproduced: there is no argument
 *   stack here to skew, and the observable intent — no pixel, answer 0 — is
 *   what the port does.
 * - **`Fast Point` answers whatever `d3` held when X is negative.** The
 *   `bmi.b $11c6` at $118e jumps PAST the `moveq #$0,d3 / moveq #$0,d2` that
 *   zeroes both the value and the type, so an X of -1 returns the previous
 *   routine's leftovers under the previous routine's type — and a type of 2
 *   is a string pointer. The X-too-large path lands after the zeroing and is
 *   fine. NOT reproduced, for the same reason: 0 is what the keyword means.
 * - **`Video Wait` accepts line 312 and rejects 313.** `cmp.l #$139,d0 /
 *   Rbcc routine 51` is the whole test, and $139 is 313, so the legal range
 *   is 0..312 — a PAL frame, and one line short of an NTSC-timed 313. That
 *   is the extension's own bound and it is reproduced.
 *
 * ## Errors
 *
 * AMon has no message table. Routines 51, 52 and 53 are three `moveq`s into
 * an `L_Error` call — 48, 23 and 149 — and the only `L_ErrorExt` sites are
 * the pair the extension skeleton ships (r54 and r55), whose single message
 * is the version banner `AMON Extension V1.04 (c) 1995 FryUp Productions`.
 * Nothing reaches them, so `errors` is not declared.
 */
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { AMOS_ERRORS, AmosError, VI, funcCall, int, type Value } from '../interp/values'
import { joyDatOf, mouseDat } from '../amiga/gameport'
import { sdrKeycode } from '../amiga/keyboard'

/**
 * The sine table at zone+$9e2 (1.04) and zone+$9d4 (1.03), 91 words, byte for
 * byte. `Mul Sin` and `Mul Cos` are its only readers and they use it as a
 * 16.16 multiplier. See the header for why this is not computed.
 */
export const AMON_SINE: readonly number[] = [
  0, 1144, 2287, 3430, 4571, 5712, 6850, 7987, 9121, 10252, 11380, 12505, 13625,
  14742, 15854, 16962, 18064, 19161, 20251, 21336, 22414, 23486, 24550, 25607,
  26655, 27696, 28729, 29752, 30767, 31772, 32768, 33753, 34728, 35693, 36647,
  37589, 38521, 39440, 40347, 41243, 42125, 42995, 43851, 44695, 45524, 46340,
  47142, 47929, 48702, 49460, 50203, 50930, 51642, 52339, 53019, 53683, 54331,
  54962, 55577, 56174, 56755, 57318, 57864, 58392, 58902, 59395, 59869, 60325,
  60763, 61182, 61583, 61965, 62327, 62671, 62996, 63302, 63588, 63855, 64103,
  64331, 64539, 64728, 64897, 65047, 65176, 65286, 65375, 65445, 65495, 65525,
  65535,
]

/** the arctan table's row stride, and the exclusive bound `Fast Angle` halves down to */
const ATAN_STRIDE = 50

/**
 * The arctan table at zone+$0, computed. 576 units to the circle.
 *
 * Built once and shared: it is 2,500 constant bytes and there is no state in
 * it. Cell (0,0) is the one the rule cannot state — `atan2(0,0)` is 0 where
 * the shipped byte is 144 — so it is written from the binary.
 */
let atanTable: Uint8Array | null = null
export function amonAtan(): Uint8Array {
  if (atanTable) return atanTable
  const t = new Uint8Array(ATAN_STRIDE * ATAN_STRIDE)
  for (let dy = 0; dy < ATAN_STRIDE; dy++) {
    for (let dx = 0; dx < ATAN_STRIDE; dx++) {
      t[dx + dy * ATAN_STRIDE] = Math.floor(((Math.atan2(dx, dy) * 180) / Math.PI) * (576 / 360))
    }
  }
  t[0] = 144
  atanTable = t
  return t
}

/** the rodent limits 1.04 ships in its zone; 1.03 ships four zeros */
const LIMITS_104 = { minX: 0x78, maxX: 0x1b8, minY: 0x26, maxY: 0xee }

export interface AmonState {
  /** zone+$9c4 to +$9ca, the four rodent limits */
  minX: number
  maxX: number
  minY: number
  maxY: number
  /** zone+$9ce and +$9cc */
  x: number
  y: number
  /** zone+$9d0/$9d1, the raw counter bytes as last read */
  lastX: number
  lastY: number
  /** zone+$9d2/$9d3, the reading before that */
  prevX: number
  prevY: number
}

export const newAmonState = (limits = LIMITS_104): AmonState => ({
  ...limits,
  x: 0,
  y: 0,
  lastX: 0,
  lastY: 0,
  prevX: 0,
  prevY: 0,
})

/**
 * Whether the program bound 1.03 rather than 1.04.
 *
 * Two things differ between the releases and a program can see both, so the
 * port asks instead of picking one. Unbound — which is every test that does
 * not say otherwise, and any program identified by table alone — this answers
 * false and 1.04 is what runs, because 1.04 is the release the port was read
 * from and the one whose six extra keywords exist.
 */
export function isAmon103(rt: Runtime): boolean {
  for (const def of rt.extBindings?.values() ?? []) if (def.id === 'amon-1.03') return true
  return false
}

/** AMOS error 48, `moveq #$30,d0` in routine 51 */
const screenParam = (): never => {
  throw new AmosError(AMOS_ERRORS[48]!, 48)
}
/** AMOS error 149, `move.l #$95,d0` in routine 53 */
const badParam = (): never => {
  throw new AmosError(AMOS_ERRORS[149]!, 149)
}

/**
 * `sub.w d1,d0` and then the two wrap tests, which are NOT the usual ones.
 *
 * The canonical eight-bit unwrap folds at $80, and `../amiga/gameport.ts`'s
 * `counterDelta` is that one. AMon folds at $7f: `cmp.w #$7f,d0 / blt` and
 * `cmp.w #$ff81,d0 / bgt`, so a delta of exactly 127 becomes -129 here and
 * stays 127 there. One count wide, at the speed where a mouse read is already
 * ambiguous, and it is the extension's own arithmetic.
 */
function amonDelta(now: number, prev: number): number {
  const d = now - prev
  if (d >= 0 && d >= 0x7f) return d - 0x100
  if (d < 0 && d <= -0x7f) return d + 0x100
  return d
}

/** JOY0DAT/JOY1DAT, the register a port has on it — port 0 carries the mouse */
const joyDat = (rt: Runtime, port: 0 | 1): number =>
  port === 0 ? mouseDat(rt.input.mouseX, rt.input.mouseY) : joyDatOf(rt.input.ports[1])

/**
 * Everything the four graphics keywords need out of `$52c(a5)`.
 *
 * They reach the screen through AMOS's own control block and take exactly
 * three fields from it: `$4e` EcTy the height, `$50` EcNPlan the depth and
 * `$b2` EcTLigne the bytes per row. The planes come from `$30`, which is
 * EcCurrent — kept equal to EcLogic by the screen swap (+W.s:2657) — so this
 * is the LOGICAL bitmap, the one AMOS's own Plot draws into.
 *
 * NOTE: none of the four tests `$52c(a5)` before following it, so on the
 * machine a program with no screen open reads through a null pointer. There
 * is always a current screen here, which is the standing difference every
 * port reading this field carries.
 */
const surface = (rt: Runtime) => {
  const bm = rt.screen.rp.bitMap
  return { bm, height: bm.height, depth: bm.depth, span: bm.bytesPerRow * 8 }
}

/**
 * The plot at the bottom of Fast Plot, Fast Circle and Array Plot.
 *
 * All three walk the planes from last to first doing `bset`/`bclr` of bit
 * `~x`, which is bit `7 - (x & 7)` of byte `y * bytesPerRow + x/8` — the
 * hardware's own layout, and what `writePixel` does. No clip region, no draw
 * mode and no write mask: this is not going through a RastPort on the machine
 * either.
 */
function fastPlot(rt: Runtime, x: number, y: number, colour: number): void {
  const s = surface(rt)
  if (y < 0 || y >= s.height) return
  if (x < 0 || x >= s.span) return
  // the plane loop writes `depth` bits of the colour and nothing above them
  rt.screen.rp.putPixel(x, y, colour & ((1 << s.depth) - 1))
}

/** the read half — routine 22's `btst` per plane, out of range answering 0 */
function fastPoint(rt: Runtime, x: number, y: number): number {
  const s = surface(rt)
  if (y < 0 || y >= s.height) return 0
  if (x < 0 || x >= s.span) return 0
  const c = rt.screen.rp.point(x, y)
  return c < 0 ? 0 : c
}

/**
 * The Bresenham walk `Count Colour` and `Find Colour` share, sampling with
 * Fast Point.
 *
 * Routines 20 ($1044) and 29 ($13d4) are the same code twice over, differing
 * only in where the counter is bumped: `Count Colour` compares first and adds
 * on a match, `Find Colour` adds first and stops on one. So one answers how
 * many pixels of that colour lie on the line and the other answers how many
 * steps along it the first one is, 1-based, or 0 for none.
 *
 * The endpoint is NOT sampled: the loop count is `major - 1` into a `dbra`,
 * so it runs `major` times starting at (x1,y1) and steps after each sample.
 * A zero-length line samples nothing at all and both answer 0 — the `tst.l
 * d6 / tst.l d7` pair at $1080 returns before the walk.
 */
function walkLine(rt: Runtime, x1: number, y1: number, x2: number, y2: number, want: number, findFirst: boolean): number {
  let dx = x2 - x1
  let dy = y2 - y1
  const sx = dx === 0 ? 0 : dx > 0 ? 1 : -1
  const sy = dy === 0 ? 0 : dy > 0 ? 1 : -1
  if (sx === 0 && sy === 0) return 0
  dx = Math.abs(dx)
  dy = Math.abs(dy)
  // the major axis is x when |dx| >= |dy| (`cmp.l d5,d4 / bge`); the two arms
  // of the routine are identical but for which delta each step moves
  const xMajor = dx >= dy
  const major = xMajor ? dx : dy
  const minor = xMajor ? dy : dx
  let err = 2 * minor - major
  let x = x1
  let y = y1
  let count = 0
  for (let i = 0; i < major; i++) {
    const c = fastPoint(rt, x, y)
    if (findFirst) {
      count++
      if (c === want) return count
    } else if (c === want) {
      count++
    }
    // `tst.l d1 / bmi` is a while, not an if — it is written as a loop and
    // reproduced as one
    while (err >= 0) {
      if (xMajor) y += sy
      else x += sx
      err -= 2 * major
    }
    if (xMajor) x += sx
    else y += sy
    err += 2 * minor
  }
  return findFirst ? 0 : count
}

/**
 * `Fast Angle`'s worker, routine 12 ($ea0), for both arities.
 *
 * `dx` is `x1 - x2` and `dy` is `y2 - y1`, which is the vector from the
 * second point to the first with the screen's downward Y flipped — so the
 * answer is a compass bearing measured clockwise from straight up. Both are
 * halved until each is inside the table's ±49, then one of four quadrant
 * cases indexes it and folds the result into a full circle.
 *
 * The three constants are the author's and two of them are two short: `$120`
 * is 288 and exact, but `$23e` is 574 where three quarters of 576 is 576-2,
 * and `$11f` is 287 where half is 288. Straight up answers 1, right 145 and
 * down 289 — the cardinals land — while up-left at 45 degrees answers 503
 * against the 505 the arithmetic would give. Reproduced as written.
 *
 * `res` is a right shift, so resolution r gives `576 >> r` steps, and the
 * `addq.w #$1` makes the answer 1-based.
 */
function fastAngle(dx0: number, dy0: number, res: number): number {
  let dx = dx0
  let dy = dy0
  while (dx >= ATAN_STRIDE || dx <= -ATAN_STRIDE || dy >= ATAN_STRIDE || dy <= -ATAN_STRIDE) {
    dx >>= 1
    dy >>= 1
  }
  const t = amonAtan()
  const at = (a: number, b: number): number => t[Math.abs(a) + Math.abs(b) * ATAN_STRIDE]!
  // `lsr.w` is a WORD shift of a value the folds keep under 576, and the
  // shift count is taken modulo 64 by the 68k
  const shift = (v: number): number => ((v & 0xffff) >>> (res & 63)) + 1
  if (dx >= 0 && dy >= 0) return shift(at(dx, dy))
  if (dx >= 0) return shift(0x120 - at(dx, dy))
  if (dy > 0) return shift(0x23e - at(dx, dy))
  return shift(0x11f + at(dx, dy))
}

/**
 * `Mul Sin` and `Mul Cos`, routines 18 ($fb0) and 19 ($ff6).
 *
 * `divu.w #$5a` splits the angle into a quadrant and an offset within it, and
 * the two keywords differ by exactly one bit test: SIN mirrors the offset to
 * `90 - offset` on ODD quadrants, COS on EVEN ones. Then a `mulu.w` by the
 * table word, `swap` to take the product's high half, and the `bpl / addq
 * #$1` after the swap is round-to-nearest on the discarded bit 15.
 *
 * The sign of `value` is taken off before the multiply and put back on the
 * longword at the end, so the whole of the middle runs on magnitudes.
 */
function mulTrig(angle: number, value: number, cos: boolean): number {
  // `move.w d3,d0 / bpl / neg.w d3` — everything below runs on the WORD's
  // magnitude and the sign goes back on the longword at the end
  const word = value & 0xffff
  const neg = word >= 0x8000
  const mag = neg ? 0x10000 - word : word
  /*
   * `divu.w #$5a` on the LONG d1, so quadrant and offset both come out of one
   * UNSIGNED division. DEVIATION: an angle above 5,898,150 — which every
   * negative angle is, read unsigned — overflows DIVU, and the 68k then
   * leaves d1 untouched and carries on with the angle's own two halves as
   * quadrant and offset. The offset that produces indexes past the 91-word
   * table into whatever follows it, so there is nothing to be faithful to;
   * this answers 0.
   */
  const a = angle >>> 0
  const q = Math.floor(a / 90)
  if (q > 0xffff) return 0
  let off = a % 90
  // the ONE bit that separates the two keywords: sin mirrors on odd
  // quadrants, cos on even ones
  if (cos === ((q & 1) === 0)) off = 90 - off
  const product = AMON_SINE[off]! * mag
  // `swap` takes the high half and `bpl / addq #$1` rounds it on the bit 15
  // that was thrown away
  const hi = ((product >>> 16) + (product & 0x8000 ? 1 : 0)) & 0xffff
  const flip = cos ? (q & 3) === 1 || (q & 3) === 2 : (q & 2) !== 0
  // neg.w, then ext.l of the word, then neg.l if the value was negative
  const out = ((flip ? 0x10000 - hi : hi) << 16) >> 16
  return neg ? -out : out
}

export function makeAmonInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): AmonState => rt.amon

  return {
    /**
     * Set Rodent X,Y — routine 9 ($e6a). Two longwords popped and written as
     * WORDS, Y first: `movem.w d0-d1,(a2)` over zone+$9cc. Not clamped — the
     * limits only apply when Rodent X or Rodent Y next reads the counter.
     */
    'set rodent'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const s = st()
      s.x = (x << 16) >> 16
      s.y = (y << 16) >> 16
    },

    /**
     * Video Wait n — routine 4 ($de8). Negative or 313 and above is AMOS
     * error 48; otherwise `$dff004` is read as a LONGWORD — VPOSR and VHPOSR
     * at once — shifted down eight and masked $1ff, and the routine spins
     * until that reaches n.
     *
     * DEVIATION: the modelled beam only advances between statements, so there
     * is nothing to spin on inside a keyword and this waits one frame. The
     * same limit EasyLife's `Elraster Wait` and AMCAF's `Raster Wait` carry,
     * and for the same reason.
     */
    'video wait'(it) {
      const n = it.evalInt()
      if (n < 0 || n >= 0x139) screenParam()
      it.block({ type: 'wait', until: it.tick + 1 })
    },

    /**
     * Limit Rodent X1,Y1 To X2,Y2 — routine 5 ($e0e). Four longwords popped
     * and stored as words in the order minX, maxX, minY, maxY, so the two
     * pairs are written interleaved with how they were typed.
     */
    'limit rodent'(it) {
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      const s = st()
      s.minX = (x1 << 16) >> 16
      s.maxX = (x2 << 16) >> 16
      s.minY = (y1 << 16) >> 16
      s.maxY = (y2 << 16) >> 16
    },

    /**
     * Fast Joy0 XADDR,XSTEP,YADDR,YSTEP — routines 14 and 15 ($f24, $f2a),
     * and Fast Joy1 through routine 13 ($f1a) with JOY1DAT instead.
     *
     * The two variables are passed BY ADDRESS and the author's example says
     * how: `_ADRX=Varptr(X) : Fast Joy1 _ADRX,1,_ADRY,1`. The routine adds or
     * subtracts the step in place, as a longword.
     *
     * The decode is the gameport's quadrature and not AMOS's `Joy()` packing:
     * down is `bit0 ^ bit1` and up is `bit8 ^ bit9`, right is bit 1 and left
     * bit 9. ../amiga/gameport.ts holds the encoding; these four tests are
     * exactly it. Vertical is decided first and `bra`s past horizontal's
     * else-arm, so a diagonal moves both.
     */
    'fast joy0': fastJoy(rt, 0),
    'fast joy1': fastJoy(rt, 1),

    /**
     * Fast Plot X,Y,COLOUR — routine 21 ($1124). A negative colour is AMOS
     * error 23 (`Rbmi routine 52`); an out-of-range coordinate draws nothing
     * and is not an error.
     */
    'fast plot'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      if (c < 0) funcCall()
      fastPlot(rt, x, y, c)
    },

    /**
     * Fast Circle X,Y,RADIUS,COLOUR — 1.04's routine 23 ($11cc) and 1.03's
     * 23 ($1054), the midpoint circle with all eight octants plotted a step.
     *
     * The decision variable starts at `-radius` and the eight points are
     * emitted in the binary's own order; a negative radius draws nothing.
     * The colour check is where the releases part: 1.04 tests it up front and
     * raises 149, 1.03 lets its `Fast Plot` raise 23 on the first point.
     */
    'fast circle'(it) {
      const cx = it.evalInt()
      it.expect(',')
      const cy = it.evalInt()
      it.expect(',')
      const r = it.evalInt()
      it.expect(',')
      const colour = it.evalInt()
      if (colour < 0) {
        if (isAmon103(rt)) funcCall()
        badParam()
      }
      if (r < 0) return
      let d = -r
      let a = r
      let b = 0
      while (b <= a) {
        for (const [px, py] of [
          [cx + a, cy - b],
          [cx + a, cy + b],
          [cx - a, cy + b],
          [cx - a, cy - b],
          [cx - b, cy + a],
          [cx - b, cy - a],
          [cx + b, cy - a],
          [cx + b, cy + a],
        ]) {
          fastPlot(rt, px!, py!, colour)
        }
        d += 2 * b + 1
        b += 1
        if (d >= 0) {
          d += 2 - 2 * a
          a -= 1
        }
      }
    },

    /**
     * Array Plot XADDR,YADDR,COLOUR,COUNT — routine 24 ($12c2). Three arrays
     * of longwords walked together, `Array Plot Varptr(X(0)),Varptr(Y(0)),
     * Varptr(C(0)),100` in the author's example, and COUNT+1 points are
     * plotted because the loop is a `dbra`.
     *
     * The third argument is a colour OR an address, decided by
     * `cmpa.l #$1000,a4 / ble`: at or below $1000 it is the colour itself and
     * the same one is used throughout, above it a third array is walked. A
     * negative one is AMOS error 23 either way.
     */
    'array plot'(it) {
      const xa = it.evalInt()
      it.expect(',')
      const ya = it.evalInt()
      it.expect(',')
      const ca = it.evalInt()
      it.expect(',')
      const count = it.evalInt()
      if (ca < 0) funcCall()
      const xs = rt.longsAt(xa)
      const ys = rt.longsAt(ya)
      const literal = (ca >>> 0) <= 0x1000
      const cs = literal ? null : rt.longsAt(ca)
      if (!xs || !ys || (!literal && !cs)) return
      for (let i = 0; i <= count; i++) {
        const c = literal ? ca : cs!.get(i)
        if (c < 0) funcCall()
        fastPlot(rt, xs.get(i), ys.get(i), c)
      }
    },

    /**
     * Test Add SRC,DEST,MATCH,VALUE,COUNT — routine 27 ($13ba), twenty-six
     * bytes: walk two longword arrays together and, wherever `src[i]` equals
     * MATCH, add VALUE to `dest[i]`. COUNT+1 elements, the `dbra` again, and
     * the destination pointer advances on the no-match path too
     * (`addq.l #$4,a0`) so the two stay in step.
     *
     * The order is the author's: `Test Add Varptr(TEST(0)),Varptr(A(0)),
     * TEST,-1,11`.
     */
    'test add'(it) {
      const src = it.evalInt()
      it.expect(',')
      const dest = it.evalInt()
      it.expect(',')
      const match = it.evalInt()
      it.expect(',')
      const value = it.evalInt()
      it.expect(',')
      const count = it.evalInt()
      const s = rt.longsAt(src)
      const d = rt.longsAt(dest)
      if (!s || !d) return
      for (let i = 0; i <= count; i++) if (s.get(i) === match) d.set(i, (d.get(i) + value) | 0)
    },
  }
}

/** the shared body of Fast Joy0 and Fast Joy1 — see the doc on the entries above */
function fastJoy(rt: Runtime, port: 0 | 1): Instr {
  return (it) => {
    const xAddr = it.evalInt()
    it.expect(',')
    const xStep = it.evalInt()
    it.expect(',')
    const yAddr = it.evalInt()
    it.expect(',')
    const yStep = it.evalInt()
    const w = joyDat(rt, port)
    const bump = (addr: number, by: number): void => {
      const cell = rt.longsAt(addr)
      cell?.set(0, (cell.get(0) + by) | 0)
    }
    if ((w & 1) ^ ((w & 2) >> 1)) bump(yAddr, yStep)
    else if ((w & 0x100) ^ ((w & 0x200) >> 1)) bump(yAddr, -yStep)
    if (w & 2) bump(xAddr, xStep)
    else if (w & 0x200) bump(xAddr, -xStep)
  }
}

export function makeAmonFunctions(rt: Runtime): Record<string, Func> {
  const st = (): AmonState => rt.amon

  /**
   * Rodent X and Rodent Y — routines 2 ($d2c) and 3 ($d8a), one per axis and
   * otherwise the same eight instructions.
   *
   * `$dff00b` is JOY0DAT's low byte, the horizontal counter, and `$dff00a`
   * its high byte, the vertical. Each read saves the byte, differences it
   * against the one before, adds that to the stored position and clamps to
   * the limits — so the position only moves when the keyword is called, and
   * a program that stops calling it stops tracking.
   */
  const rodent = (axis: 'x' | 'y'): number => {
    const s = st()
    const w = joyDat(rt, 0)
    const now = axis === 'x' ? w & 0xff : (w >> 8) & 0xff
    const prev = axis === 'x' ? s.lastX : s.lastY
    if (axis === 'x') {
      s.prevX = s.lastX
      s.lastX = now
    } else {
      s.prevY = s.lastY
      s.lastY = now
    }
    let v = (axis === 'x' ? s.x : s.y) + amonDelta(now, prev)
    const lo = axis === 'x' ? s.minX : s.minY
    const hi = axis === 'x' ? s.maxX : s.maxY
    if (v < lo) v = lo
    if (v > hi) v = hi
    if (axis === 'x') s.x = v
    else s.y = v
    return (v << 16) >> 16
  }

  /** CIA-A PRA bit 6, FIR0 — the left button, active low */
  const left = (): boolean => (rt.input.mouseK & 1) !== 0
  /** POTGOR bit 10, DATLY — the mouse's right button on the same pin a stick's second button uses */
  const right = (): boolean => (rt.input.mouseK & 2) !== 0

  /**
   * Joy3 and Joy4 — routines 25 ($1336) and 26 ($1378), the PARALLEL PORT
   * four-player adapter and the only keywords here that reach past the two
   * gameports.
   *
   * Joy3 takes its fire from CIA-B PRA `$bfd000` bit 2 and its directions
   * from CIA-A PRB `$bfe101` bits 3,2,1,0; Joy4 takes fire from `$bfd000`
   * bit 0 and directions from bits 7,6,5,4. Every line is active low, and the
   * five bits are packed into AMOS's own `Joy()` layout — bit 0 up, 1 down,
   * 2 left, 3 right, 4 fire — so a program can treat the answer exactly as
   * it treats `Joy(1)`.
   *
   * NOTE: nothing is wired to the parallel port here, so both answer 0. That
   * is what an Amiga with no adapter answers too: every line idles high and
   * the routine sets no bit. There is no third or fourth controller in the
   * input model to connect one to.
   */
  const adapterJoy = (): Value => VI(0)

  return {
    'rodent x': () => VI(rodent('x')),
    'rodent y': () => VI(rodent('y')),

    /** Lrodent — routine 6 ($e24), `btst.b #$6,$bfe001` and -1 when it is CLEAR */
    lrodent: () => VI(left() ? -1 : 0),
    /** Rrodent — routine 7 ($e36), `btst.b #$a` of POTGOR, likewise -1 */
    rrodent: () => VI(right() ? -1 : 0),
    /** Rodent Key — routine 8 ($e4a), the same two lines added as 1 and 2, so 0..3 */
    'rodent key': () => VI((left() ? 1 : 0) + (right() ? 2 : 0)),

    /**
     * Fast Angle — routines 10 and 11 ($e7c, $e8a) into the worker at $ea0,
     * two arities sharing one name because the token table gives the second
     * an unnamed row after the `!`-flagged first.
     *
     * Five arguments is `Fast Angle(X1,Y1 To X2,Y2,RES)`, the bearing from the
     * second point to the first. Three is `Fast Angle(X,Y,RES)`, and routine
     * 11 fills the other point from the CURRENT RODENT POSITION — reading
     * zone+$9cc and +$9ce directly, so it is the position as the last
     * `Rodent X`/`Rodent Y` left it and not a fresh read of the hardware.
     */
    'fast angle': (_, a): Value => {
      const s = st()
      if (a.length >= 5) {
        const [x1, y1, x2, y2, res] = a.map((v) => int(v))
        return VI(fastAngle(x1! - x2!, y2! - y1!, res!))
      }
      const [x, y, res] = a.map((v) => int(v))
      return VI(fastAngle(s.x - x!, y! - s.y, res!))
    },

    /**
     * Keycode — routine 16 ($f70). `btst.b #$0` of the RAW serial byte first:
     * that bit is the complement of the keycode's release flag, so a clear
     * bit means a release and the answer is 0. Otherwise `not.b` then
     * `ror.b #1`, which is the canonical undo, and the answer is the scancode.
     */
    keycode: () => {
      const raw = rt.input.sdr & 0xff
      return VI(raw & 1 ? sdrKeycode(raw) & 0x7f : 0)
    },

    /**
     * Key Press(n) — routine 17 ($f8a). Negative or $80 and above is AMOS
     * error 149; otherwise the same decode and -1 when it equals n. The whole
     * decoded byte is compared, so with n under $80 only a press can match.
     */
    'key press': (_, a): Value => {
      const n = int(a[0]!)
      if (n < 0 || n >= 0x80) badParam()
      return VI(sdrKeycode(rt.input.sdr & 0xff) === n ? -1 : 0)
    },

    'mul sin': (_, a): Value => VI(mulTrig(int(a[0]!), int(a[1]!), false)),
    'mul cos': (_, a): Value => VI(mulTrig(int(a[0]!), int(a[1]!), true)),

    /** Fast Point(X,Y) — routine 22 ($117e); see the header for its two defects */
    'fast point': (_, a): Value => VI(fastPoint(rt, int(a[0]!), int(a[1]!))),

    joy3: adapterJoy,
    joy4: adapterJoy,

    /**
     * Count Colour(X1,Y1 To X2,Y2,COL) — routine 20 ($1044). How many pixels
     * of COL lie on the line, endpoint excluded.
     */
    'count colour': (_, a): Value => {
      const [x1, y1, x2, y2, col] = a.map((v) => int(v))
      return VI(walkLine(rt, x1!, y1!, x2!, y2!, col!, false))
    },

    /**
     * Find Colour(X1,Y1 To X2,Y2,COL) — routine 29 ($13d4). How many steps
     * along the line the first COL is, counting the start as 1, or 0 for
     * none. The counter is bumped BEFORE the compare, which is the whole
     * difference from Count Colour.
     */
    'find colour': (_, a): Value => {
      const [x1, y1, x2, y2, col] = a.map((v) => int(v))
      return VI(walkLine(rt, x1!, y1!, x2!, y2!, col!, true))
    },
  }
}
