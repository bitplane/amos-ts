import type { Sprite, SpriteBank } from '../loader/amosfile'
import { decode as decodePlanes, encode as encodePlanes, getPixel as planarGet } from './planar'
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
  readonly rowBytes: number
  readonly planeSize: number
  /** the bitplanes, in the bank's layout */
  planes: Uint8Array
  private cache: Uint8Array
  private cacheValid = false
  private cacheDirty = false
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
    this.rowBytes = (width >> 4) * 2
    this.planeSize = this.rowBytes * height
    this.planes = planes ?? new Uint8Array(this.planeSize * depth)
    this.cache = new Uint8Array(width * height)
  }

  /** chunky pixels; 0 = transparent unless opaque. READ-ONLY by contract. */
  get pixels(): Uint8Array {
    if (this.cacheValid || this.cacheDirty) return this.cache
    decodePlanes(this.planes, this.planeSize, this.rowBytes, this.depth, this.width, this.height, this.cache)
    this.cacheValid = true
    return this.cache
  }
  /** the chunky buffer, for a caller about to write to it */
  pixelsW(): Uint8Array {
    const p = this.pixels
    this.cacheDirty = true
    return p
  }
  /** settle any chunky writes back into the planes */
  flush(): void {
    if (!this.cacheDirty) return
    encodePlanes(this.cache, this.planes, this.planeSize, this.rowBytes, this.depth, this.width, this.height)
    this.cacheDirty = false
    this.cacheValid = true
  }
  /** the planes, with any pending chunky write settled first */
  planeBytes(): Uint8Array {
    this.flush()
    return this.planes
  }
  pixelAt(x: number, y: number): number {
    if (this.cacheValid || this.cacheDirty) return this.cache[y * this.width + x]!
    return planarGet(this.planes, this.planeSize, this.rowBytes, this.depth, x, y)
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
