/**
 * The Amiga blitter — the logic function, BLTSIZE, and a rectangle copy.
 *
 * ## Why this exists
 *
 * The blitter's truth-table evaluator had been written **twice, at two
 * different widths, in two directories**:
 *
 * - `planar.ts`'s `mintermBit`, one bit at a time, honouring the channel
 *   enable bits — used by the bob compositor.
 * - `personnal.ts`'s `bltMinterm`, sixteen bits in parallel by unrolled
 *   boolean algebra, with no channel enables — used by Blit Mask, Blitter
 *   Copy and Blitter Clear.
 *
 * They are the same function. Neither could say so, because they did not
 * share a file, and nothing checked that the two agreed. `mintermWord` and
 * `mintermBit` are now one implementation and one test asserts the identity
 * across every control word and every input, which is a claim the split
 * version could not even express.
 *
 * `bltSize` came over from the same place: BLTSIZE's 10-bit row count and
 * 6-bit word count both mean their maximum when written as zero, which is
 * chip arithmetic that had no business living inside an extension port.
 *
 * ## What is NOT here — the policy
 *
 * `bobBltcon0` moved the OTHER way, out of `src/amiga` and into
 * `runtime/objects.ts`. It reads the SIGN of `Set Bob`'s fourth argument to
 * decide whether the value is a minterm, a whole control word or a request
 * for the default — an AMOS calling convention that no manual documents and
 * that the blitter knows nothing about. It sat in `planar.ts` because that is
 * where its one caller found it convenient, which is how policy gets into a
 * mechanism layer.
 *
 * ## What is deliberately absent: area fill
 *
 * BLTCON1's IFE, EFE and FCI bits are decoded here and nothing implements
 * them, because there is no caller and therefore no oracle. AMCAF's
 * `Blitter Fill` is the first keyword that would want it; the honest place to
 * write it is beside that port, tested against a program whose output can be
 * compared, rather than now from memory of what the hardware manual says
 * about which boundary bit an exclusive fill includes. The constants are here
 * so the seam is visible; the logic waits for its evidence.
 *
 * Cycle timing, the line-drawing mode and the barrel shifter's cross-word
 * carry are absent for the same reason: every caller today walks its own
 * geometry and asks this module only for the logic.
 */

import { BitMap } from './graphics'

/* ------------------------------------------------------------------ *
 * BLTCON0 / BLTCON1
 * ------------------------------------------------------------------ */

/** BLTCON0 bit 11 — channel A (usually the mask) reads from memory */
export const USEA = 0x0800
/** BLTCON0 bit 10 — channel B (usually the source) */
export const USEB = 0x0400
/** BLTCON0 bit 9 — channel C (usually the destination read) */
export const USEC = 0x0200
/** BLTCON0 bit 8 — channel D, the write */
export const USED = 0x0100

/** BLTCON1 bit 1 — descending: addresses step backwards */
export const DESC = 0x0002
/** BLTCON1 bit 2 — fill carry in */
export const FCI = 0x0004
/** BLTCON1 bit 3 — inclusive fill enable */
export const IFE = 0x0008
/** BLTCON1 bit 4 — exclusive fill enable */
export const EFE = 0x0010
/** BLTCON1 bit 0 — line draw mode */
export const LINE = 0x0001

/** the cookie-cut control word: all four channels, minterm $CA = A ? B : C */
export const COOKIE_CUT = 0x0fca

/** BLTCON0's low byte: the truth table itself */
export function logicFunction(bltcon0: number): number {
  return bltcon0 & 0xff
}

/** BLTCON0's top nibble — the channel A barrel shift */
export function shiftA(bltcon0: number): number {
  return (bltcon0 >> 12) & 15
}

/** BLTCON1's top nibble — the channel B barrel shift */
export function shiftB(bltcon1: number): number {
  return (bltcon1 >> 12) & 15
}

/* ------------------------------------------------------------------ *
 * The logic function
 * ------------------------------------------------------------------ */

/**
 * The truth table applied to sixteen bits at once.
 *
 * `lf` is BLTCON0's low byte, indexed by (A<<2)|(B<<1)|C — bit 7 is the
 * output when all three inputs are 1, bit 0 when none are. Each term is one
 * AND of the three channels or their complements, OR'd together, which is
 * the same evaluation the chip does in parallel across the word.
 */
export function mintermWord(lf: number, a: number, b: number, c: number): number {
  let d = 0
  if (lf & 0x80) d |= a & b & c
  if (lf & 0x40) d |= a & b & ~c
  if (lf & 0x20) d |= a & ~b & c
  if (lf & 0x10) d |= a & ~b & ~c
  if (lf & 0x08) d |= ~a & b & c
  if (lf & 0x04) d |= ~a & b & ~c
  if (lf & 0x02) d |= ~a & ~b & c
  if (lf & 0x01) d |= ~a & ~b & ~c
  return d & 0xffff
}

/**
 * One bit through the logic function, honouring the channel enables.
 *
 * A channel switched off in bits 9-11 contributes a 1 rather than a 0: its
 * data register is never loaded from memory and holds all ones. That is not a
 * guess — it is what makes $07CA behave as `No Mask`, which is the case AMOS
 * generates for a maskless image: with A off, $CA collapses from
 * "D = A ? B : C" to "D = B" and colour 0 draws.
 */
export function mintermBit(bltcon0: number, a: number, b: number, c: number): number {
  const useA = (bltcon0 & USEA) !== 0 ? a : 1
  const useB = (bltcon0 & USEB) !== 0 ? b : 1
  const useC = (bltcon0 & USEC) !== 0 ? c : 1
  return (bltcon0 >> ((useA << 2) | (useB << 1) | useC)) & 1
}

/**
 * A whole word through the logic function, honouring the channel enables —
 * `mintermBit` sixteen at a time, and the form a real blit loop wants.
 */
export function logicWord(bltcon0: number, a: number, b: number, c: number): number {
  return mintermWord(
    logicFunction(bltcon0),
    bltcon0 & USEA ? a : 0xffff,
    bltcon0 & USEB ? b : 0xffff,
    bltcon0 & USEC ? c : 0xffff,
  )
}

/* ------------------------------------------------------------------ *
 * BLTSIZE
 * ------------------------------------------------------------------ */

/**
 * BLTSIZE: ten bits of row count, six of words per row.
 *
 * **Zero means maximum in both fields** — 1024 rows and 64 words — which is
 * the one piece of this register that a reader cannot guess from its layout,
 * and the reason a blit written as `0` is the largest one rather than a
 * no-op.
 */
export function bltSize(v: number): { rows: number; words: number } {
  return { rows: (v >>> 6) & 0x3ff || 1024, words: (v & 0x3f) || 64 }
}

/* ------------------------------------------------------------------ *
 * BltBitMapRastPort
 * ------------------------------------------------------------------ */

/**
 * BltBitMapRastPort — a rectangle of one bitmap into another.
 *
 * `transparent` is the difference between the two calls an extension makes:
 * -1 is minterm $C0, a straight copy, and a pen number is
 * BltMaskBitMapRastPort with that pen standing in for the mask, which is how
 * a blit gets a transparent colour 0.
 *
 * Always through a chunky staging buffer, because source and destination are
 * routinely the SAME bitmap with overlapping rectangles — a screen scrolling
 * itself — and a straight forward copy would smear. The chip solves that with
 * the descending bit; this solves it with a buffer, and the visible result is
 * the same.
 */
export function bltBitMap(
  src: BitMap,
  sx: number,
  sy: number,
  dst: BitMap,
  dx: number,
  dy: number,
  w: number,
  h: number,
  transparent = -1,
): void {
  if (w <= 0 || h <= 0) return
  const tmp = new Uint8Array(w * h)
  for (let ry = 0; ry < h; ry++) {
    const y = sy + ry
    if (y < 0 || y >= src.height) continue
    for (let rx = 0; rx < w; rx++) {
      const x = sx + rx
      if (x < 0 || x >= src.width) continue
      tmp[ry * w + rx] = src.pixelAt(x, y)
    }
  }
  for (let ry = 0; ry < h; ry++) {
    const y = dy + ry
    if (y < 0 || y >= dst.height) continue
    for (let rx = 0; rx < w; rx++) {
      const x = dx + rx
      if (x < 0 || x >= dst.width) continue
      const v = tmp[ry * w + rx]!
      if (v === transparent) continue
      dst.writePixel(x, y, v)
    }
  }
  dst.invalidate()
}
