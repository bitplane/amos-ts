import type { Sprite, SpriteBank } from '../loader/amosfile'
import { bankRowBytesFor } from '../amiga/planar'
import { BitMap } from '../amiga/graphics'
import { COOKIE_CUT } from '../amiga/blitter'
import { AmosError } from '../interp/values'

/**
 * Blitter objects, hardware sprites and detection zones.
 *
 * Images come from the sprite bank (bank 1) / icon bank (bank 2), decoded
 * planar → chunky once. Bobs render as overlays at composite time
 * (equivalent to autoback: the framebuffer keeps the background), except
 * Paste Bob/Icon which stamp the framebuffer permanently.
 */

/**
 * A bob or icon: BITPLANES, with a chunky cache derived from them.
 *
 * Sprite and icon banks are already planar on disk. This used to unpack every
 * image to chunky on load and pack it back on save — a round trip for
 * nothing, and it meant a bob blit composed chunky bytes where the blitter
 * moved planes. The planes are now kept as they arrived, so a bank that is
 * loaded and saved comes back byte for byte, and `set bob`'s write mask has
 * real planes to mask.
 *
 * Same contract as Screen: `pixels` is a read-only-by-contract cache and
 * `pixelsW()` is what a writer takes, so a bank edit cannot land in the cache
 * and miss the planes.
 *
 * GEOMETRY IS THE BANK'S, NOT THE SCREEN'S. Sprite banks store
 * `widthWords = width >> 4`, truncating rather than rounding up the way a
 * screen's rowBytes does. Every AMOS sprite is a multiple of 16 wide so the
 * two agree in practice, but the bank's own convention is what is preserved
 * here — anything else would change the bytes a save produces.
 */
export class BankImage {
  /** the bitmap: planes in the BANK's layout, plus its chunky cache */
  private readonly bm: BitMap
  /** set by No Mask: colour 0 draws */
  opaque = false

  constructor(
    readonly width: number,
    readonly height: number,
    readonly depth: number,
    public hotX: number,
    public hotY: number,
    planes?: Uint8Array,
  ) {
    // bankRowBytesFor truncates where a screen's rowBytesFor rounds up; the
    // BitMap takes whichever it is told rather than choosing, which is what
    // lets a bank round-trip byte for byte
    this.bm = new BitMap(width, height, depth, bankRowBytesFor(width), planes)
  }

  get rowBytes(): number {
    return this.bm.bytesPerRow
  }
  get planeSize(): number {
    return this.bm.planeSize
  }
  /** the bitplanes, in the bank's layout */
  get planes(): Uint8Array {
    return this.bm.planes
  }
  set planes(p: Uint8Array) {
    this.bm.planes = p
    this.bm.invalidate()
  }

  /** chunky pixels; 0 = transparent unless opaque. READ-ONLY by contract. */
  get pixels(): Uint8Array {
    return this.bm.pixels
  }
  /** the chunky buffer, for a caller about to write to it */
  pixelsW(): Uint8Array {
    return this.bm.pixelsW()
  }
  /** settle any chunky writes back into the planes */
  flush(): void {
    this.bm.flush()
  }
  /** the planes, with any pending chunky write settled first */
  planeBytes(): Uint8Array {
    return this.bm.planeBytes()
  }
  pixelAt(x: number, y: number): number {
    return this.bm.pixelAt(x, y)
  }
}

/** Wrap a bank sprite. The planar bytes are kept, not converted. */
export function decodeSprite(s: Sprite): BankImage {
  const img = new BankImage(s.width, s.height, s.depth, s.hotX, s.hotY)
  // copy rather than alias: editing an image must not scribble on the bank
  // the loader parsed, and a short record still yields a whole bitmap
  img.planes.set(s.data.subarray(0, Math.min(s.data.length, img.planes.length)))
  return img
}

export class ObjectBank {
  /** 1-based image access, as in AMOS */
  images: BankImage[] = []
  palette: number[] = []
  private flipCache = new Map<number, BankImage>()

  static fromSpriteBank(bank: SpriteBank): ObjectBank {
    const b = new ObjectBank()
    b.images = bank.sprites.map(decodeSprite)
    b.palette = bank.palette
    return b
  }

  /**
   * Image lookup honouring Hrev/Vrev flip flags: bit 15 = horizontal,
   * bit 14 = vertical (hot spots mirror too). Flips are cached.
   */
  image(n: number): BankImage | undefined {
    const flags = n & 0xc000
    const base = this.images[(n & 0x3fff) - 1]
    if (!base || flags === 0) return base
    const cached = this.flipCache.get(n)
    if (cached) return cached
    // BobCalc +W.s:1408-1413: a flipped image's effective hot spot is
    // width-hotX / height-hotY (no -1; width is the 16-padded pixel width)
    const flipped = new BankImage(
      base.width,
      base.height,
      base.depth,
      flags & 0x8000 ? base.width - base.hotX : base.hotX,
      flags & 0x4000 ? base.height - base.hotY : base.hotY,
    )
    flipped.opaque = base.opaque
    // through the chunky view: a horizontal flip is a bit reversal per plane
    // row, which is not cheaper than this and is easier to get wrong
    const src = base.pixels
    const dst = flipped.pixelsW()
    for (let y = 0; y < base.height; y++) {
      const sy = flags & 0x4000 ? base.height - 1 - y : y
      for (let x = 0; x < base.width; x++) {
        const sx = flags & 0x8000 ? base.width - 1 - x : x
        dst[y * base.width + x] = src[sy * base.width + sx]!
      }
    }
    flipped.flush()
    this.flipCache.set(n, flipped)
    return flipped
  }

  /** Get Bob: (re)create image n from screen pixels. */
  setImage(n: number, img: BankImage): void {
    while (this.images.length < n) this.images.push(blankImage())
    this.images[n - 1] = img
    this.flipCache.clear()
  }

  /**
   * Ins Bob/Sprite/Icon n (Bnk.InsBob +Lib.s:8316): insert one blank image
   * at position n, shifting images n.. up by one.
   */
  insert(n: number): void {
    if (n < 1) throw new AmosError('Illegal function call', 23)
    while (this.images.length < n - 1) this.images.push(blankImage())
    this.images.splice(n - 1, 0, blankImage())
    this.flipCache.clear()
  }

  /**
   * Del Bob/Sprite/Icon n[ To m] (Bnk.DelBob +Lib.s:8372): remove images
   * n..m and compact — subsequent images renumber down. Returns false when
   * the bank becomes empty (the caller frees it).
   */
  delete(n: number, m = n): boolean {
    if (n < 1 || m < n || m > this.images.length) throw new AmosError('Illegal function call', 23)
    this.images.splice(n - 1, m - n + 1)
    this.flipCache.clear()
    return this.images.length > 0
  }
}

export function blankImage(): BankImage {
  return new BankImage(0, 0, 0, 0, 0)
}

export interface Bob {
  n: number
  x: number
  y: number
  image: number
  screen: number
}

export interface HwSprite {
  n: number
  /** hardware coords */
  x: number
  y: number
  image: number
}

export interface Zone {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * One slot of EasyLife's multi-zone index — four bytes per zone, kept in the
 * same table AMOS's zones live in.
 *
 * It is here beside `Zone` and not in easylife.ts because the LIFETIME is the
 * screen's: `Reserve Zone`, `Elzb Add` and closing the screen all replace
 * EcAZones and take the index with it, and that rule belongs where the table
 * does (Screen.reserveZones). The extension owns the meaning; the screen owns
 * the storage.
 */
export interface MultiZoneSlot {
  /** the group, 1..65535 — word 0 of the entry */
  group: number
  /** the zone id, 1..65535 — word 2, and ZERO is what marks the slot FREE */
  id: number
  /** the free-list link while `id` is 0: the next free slot, or -1 for $ffff */
  next: number
}

/**
 * The `$0000fefd` overlay `ElMz Reserve` (routine 80) lays over a screen's
 * zone table, and routine 81 recognises by that magic longword.
 *
 * On the machine it is all one allocation of `n*3/2 + 1` eight-byte records:
 * records 0..n-1 are the zone RECTANGLES — the very same layout AMOS's own
 * zones use, which is why the guide warns that "Normal screen zones will not
 * work with multi zones installed, but will not produce error messages, just
 * unreliable results" — then `n*4` bytes of index, then one trailer record
 * holding n, the free-list head and the magic.
 */
export interface MultiZoneTable {
  /** one per rectangle, so `slots[i]` describes `Screen.zones[i]` */
  slots: MultiZoneSlot[]
  /** the free-list head, a slot index, or -1 for $ffff (the table is full) */
  free: number
}

/** Pixel-precise overlap test between two placed images. */
export function imagesCollide(
  a: BankImage,
  ax: number,
  ay: number,
  b: BankImage,
  bx: number,
  by: number,
): boolean {
  const ax1 = ax - a.hotX
  const ay1 = ay - a.hotY
  const bx1 = bx - b.hotX
  const by1 = by - b.hotY
  const x1 = Math.max(ax1, bx1)
  const y1 = Math.max(ay1, by1)
  const x2 = Math.min(ax1 + a.width, bx1 + b.width)
  const y2 = Math.min(ay1 + a.height, by1 + b.height)
  if (x1 >= x2 || y1 >= y2) return false
  for (let y = y1; y < y2; y++) {
    const arow = (y - ay1) * a.width
    const brow = (y - by1) * b.width
    for (let x = x1; x < x2; x++) {
      if (a.pixels[arow + (x - ax1)] !== 0 && b.pixels[brow + (x - bx1)] !== 0) return true
    }
  }
  return false
}

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
 *
 * This is AMOS's calling convention, not the chip's, which is why it lives
 * here and not in `src/amiga/blitter.ts` — the blitter has no opinion about
 * what the sign of an AMOS argument means.
 */
export function bobBltcon0(arg: number, hasMask: boolean): number {
  if (arg === 0) return hasMask ? COOKIE_CUT : 0x07ca
  if (arg > 0) return arg & 0xffff
  let v = arg & 0xffff
  v &= ~0x8000
  v |= 0x0f00
  if (!hasMask) v &= 0x07ff
  return v
}
