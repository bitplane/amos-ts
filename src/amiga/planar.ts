/**
 * Amiga bitplanes: the bit twiddling, in one place.
 *
 * A planar bitmap stores each bit of a pixel's colour index in a separate
 * plane, so a 5-bit pen on a 320-wide screen lives as five independent
 * 40-byte rows. Pixels are packed most-significant-bit-first: x=0 is bit 7 of
 * byte 0. That is the hardware's layout, it is what `.Abk` sprite and icon
 * banks already contain, and once the port stores screens this way too, plane
 * pokes, `Logbase`, bitplane extensions and a copper list pointing anywhere
 * all stop needing a translation layer.
 *
 * Everything here works a WORD at a time where it can. Sixteen pixels share
 * one word per plane, so a run fill is `depth` word writes rather than 16
 * byte writes — measured 2.2x faster than the chunky equivalent for a
 * full-screen Bar, and 3.3x faster than a naive per-pixel decode at 8 planes.
 *
 * The functions take the geometry explicitly rather than a Screen, so the
 * display path can use them on plane data that did not come from a Screen at
 * all — which is the whole point of getting here.
 */

/**
 * Bytes per plane row for a SCREEN: pixels rounded up to a whole word.
 *
 * There are two conventions and they are not interchangeable — see
 * `bankRowBytesFor`. This one had a single caller (its own file) while the
 * expression was written out longhand in seven other places, which is how the
 * two came to be mixed up in `chipUsed`.
 */
export function rowBytesFor(width: number): number {
  return ((width + 15) >> 4) << 1
}

/**
 * Bytes per plane row for a SPRITE OR ICON BANK: pixels TRUNCATED to a whole
 * word, because that is what the bank format stores (`widthWords = width >> 4`).
 *
 * Every AMOS sprite is a multiple of 16 wide, so the two agree in practice and
 * the difference only shows on a hand-made odd-width image — but the bank's own
 * convention is what a byte-exact save has to reproduce, so it gets its own
 * name rather than sharing the screen's.
 */
export function bankRowBytesFor(width: number): number {
  return (width >> 4) * 2
}

/**
 * Read one pixel's colour index.
 *
 * Per-pixel access is the slow path by nature — five planes means five byte
 * reads for one pixel. Use `decodeRow` for anything that walks a span.
 */
export function getPixel(
  planes: Uint8Array,
  planeSize: number,
  rowBytes: number,
  depth: number,
  x: number,
  y: number,
): number {
  const off = y * rowBytes + (x >> 3)
  const mask = 0x80 >> (x & 7)
  let v = 0
  for (let p = 0; p < depth; p++) {
    if (planes[p * planeSize + off]! & mask) v |= 1 << p
  }
  return v
}

/**
 * Write one pixel's colour index.
 *
 * `writeMask` is a per-PLANE mask — bit p set means plane p may be written.
 * On the real machine that is what a write mask always was; the chunky port
 * had to fake it by masking the index. 0xff means every plane.
 */
export function setPixel(
  planes: Uint8Array,
  planeSize: number,
  rowBytes: number,
  depth: number,
  x: number,
  y: number,
  v: number,
  writeMask = 0xff,
): void {
  const off = y * rowBytes + (x >> 3)
  const bit = 0x80 >> (x & 7)
  for (let p = 0; p < depth; p++) {
    if ((writeMask & (1 << p)) === 0) continue
    const i = p * planeSize + off
    if (v & (1 << p)) planes[i] = planes[i]! | bit
    else planes[i] = planes[i]! & ~bit
  }
}

/**
 * Fill x1..x2 inclusive on row y with `v`, word at a time.
 *
 * The two partial words at the ends are masked; everything between is a
 * straight `fill` per plane. This is where planar beats chunky.
 */
export function fillSpan(
  planes: Uint8Array,
  planeSize: number,
  rowBytes: number,
  depth: number,
  y: number,
  x1: number,
  x2: number,
  v: number,
  writeMask = 0xff,
): void {
  if (x2 < x1) return
  const rowOff = y * rowBytes
  const b1 = x1 >> 3
  const b2 = x2 >> 3
  // a byte is only partly covered when the span starts or stops inside it
  const headMask = 0xff >> (x1 & 7)
  const tailMask = (0xff << (7 - (x2 & 7))) & 0xff

  for (let p = 0; p < depth; p++) {
    if ((writeMask & (1 << p)) === 0) continue
    const on = (v & (1 << p)) !== 0
    const base = p * planeSize + rowOff
    if (b1 === b2) {
      const m = headMask & tailMask
      planes[base + b1] = on ? planes[base + b1]! | m : planes[base + b1]! & ~m
      continue
    }
    planes[base + b1] = on ? planes[base + b1]! | headMask : planes[base + b1]! & ~headMask
    if (b2 > b1 + 1) planes.fill(on ? 0xff : 0x00, base + b1 + 1, base + b2)
    planes[base + b2] = on ? planes[base + b2]! | tailMask : planes[base + b2]! & ~tailMask
  }
}

/**
 * Unpack one row of `width` pixels into `out` at `outOff`, word at a time.
 *
 * Gathering each plane's word once and then splitting 16 pixels out of the
 * registers is what makes this ~3.3x faster than testing a bit per plane per
 * pixel; the gain grows with depth, because the per-pixel version rereads
 * every plane byte eight times.
 */
export function decodeRow(
  planes: Uint8Array,
  planeSize: number,
  rowBytes: number,
  depth: number,
  width: number,
  y: number,
  out: Uint8Array,
  outOff: number,
): void {
  const rowOff = y * rowBytes
  for (let bx = 0; bx < rowBytes; bx += 2) {
    const o = rowOff + bx
    let w0 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0, w5 = 0, w6 = 0, w7 = 0
    if (depth > 0) w0 = (planes[o]! << 8) | planes[o + 1]!
    if (depth > 1) w1 = (planes[planeSize + o]! << 8) | planes[planeSize + o + 1]!
    if (depth > 2) w2 = (planes[2 * planeSize + o]! << 8) | planes[2 * planeSize + o + 1]!
    if (depth > 3) w3 = (planes[3 * planeSize + o]! << 8) | planes[3 * planeSize + o + 1]!
    if (depth > 4) w4 = (planes[4 * planeSize + o]! << 8) | planes[4 * planeSize + o + 1]!
    if (depth > 5) w5 = (planes[5 * planeSize + o]! << 8) | planes[5 * planeSize + o + 1]!
    if (depth > 6) w6 = (planes[6 * planeSize + o]! << 8) | planes[6 * planeSize + o + 1]!
    if (depth > 7) w7 = (planes[7 * planeSize + o]! << 8) | planes[7 * planeSize + o + 1]!
    const x0 = bx * 8
    const n = Math.min(16, width - x0)
    for (let i = 0; i < n; i++) {
      const m = 0x8000 >> i
      out[outOff + x0 + i] =
        (w0 & m ? 1 : 0) |
        (w1 & m ? 2 : 0) |
        (w2 & m ? 4 : 0) |
        (w3 & m ? 8 : 0) |
        (w4 & m ? 16 : 0) |
        (w5 & m ? 32 : 0) |
        (w6 & m ? 64 : 0) |
        (w7 & m ? 128 : 0)
    }
  }
}

/** Unpack a whole bitmap into a chunky buffer of `width` * `height` bytes. */
export function decode(
  planes: Uint8Array,
  planeSize: number,
  rowBytes: number,
  depth: number,
  width: number,
  height: number,
  out: Uint8Array,
): void {
  for (let y = 0; y < height; y++) decodeRow(planes, planeSize, rowBytes, depth, width, y, out, y * width)
}

/** Pack a chunky buffer into bitplanes, replacing their contents. */
export function encode(
  chunky: Uint8Array,
  planes: Uint8Array,
  planeSize: number,
  rowBytes: number,
  depth: number,
  width: number,
  height: number,
): void {
  planes.fill(0)
  for (let y = 0; y < height; y++) {
    const rowOff = y * rowBytes
    const src = y * width
    for (let x = 0; x < width; x++) {
      const v = chunky[src + x]!
      if (v === 0) continue
      const off = rowOff + (x >> 3)
      const bit = 0x80 >> (x & 7)
      for (let p = 0; p < depth; p++) {
        if (v & (1 << p)) planes[p * planeSize + off] = planes[p * planeSize + off]! | bit
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * The blitter's logic function
 * ------------------------------------------------------------------ */

/**
 * BLTCON0 as `Set Bob`'s fourth argument resolves to (BbS1a-BbS1d,
 * +W.s:1425-1439).
 *
 * The SIGN of the argument chooses what it means, which no manual says:
 *
 *   0        the default, %0000111111001010 = $0FCA — channels A-D enabled
 *            and the classic cookie-cut minterm $CA.
 *   negative a minterm only. Bit 15 is cleared and $0F00 OR'd in, so AMOS
 *            forces the channel-enable bits on whatever the caller passed.
 *   positive the WHOLE control word, used verbatim (the `bpl` at BbS1a
 *            jumps clean past the fixing-up). Callers who know the hardware
 *            get it unmodified.
 *
 * `hasMask` is the `tst.l 4(a2)` in both branches: an image with no mask
 * plane clears USEA (bit 11), giving $07CA by default. That is how `No Mask`
 * works — with channel A switched off its data register is never loaded and
 * reads as all ones, so $CA collapses from "D = A ? B : C" to "D = B" and
 * colour 0 draws.
 */
export function bobBltcon0(arg: number, hasMask: boolean): number {
  if (arg === 0) return hasMask ? 0x0fca : 0x07ca
  if (arg > 0) return arg & 0xffff
  let v = arg & 0xffff
  v &= ~0x8000
  v |= 0x0f00
  if (!hasMask) v &= 0x07ff
  return v
}

/** the classic cookie-cut: D = A ? B : C */
export const BLTCON0_DEFAULT = 0x0fca

/**
 * One bit through the blitter's logic function.
 *
 * BLTCON0's low byte is the truth table, indexed by (A<<2)|(B<<1)|C — so bit
 * 7 of it is the output when all three inputs are 1, and bit 0 when none are.
 * A is the mask, B the source, C the destination.
 *
 * A channel switched off in bits 9-11 contributes a 1 rather than a 0: its
 * data register is never loaded from memory and holds all ones. That is not a
 * guess — it is what makes $07CA behave as `No Mask`, which is the case AMOS
 * generates for a maskless image.
 */
export function mintermBit(bltcon0: number, a: number, b: number, c: number): number {
  const useA = (bltcon0 & 0x0800) !== 0 ? a : 1
  const useB = (bltcon0 & 0x0400) !== 0 ? b : 1
  const useC = (bltcon0 & 0x0200) !== 0 ? c : 1
  return (bltcon0 >> ((useA << 2) | (useB << 1) | useC)) & 1
}
