import type { Sprite, SpriteBank } from '../loader/amosfile'

/**
 * Blitter objects, hardware sprites and detection zones.
 *
 * Images come from the sprite bank (bank 1) / icon bank (bank 2), decoded
 * planar → chunky once. Bobs render as overlays at composite time
 * (equivalent to autoback: the framebuffer keeps the background), except
 * Paste Bob/Icon which stamp the framebuffer permanently.
 */

export interface BankImage {
  width: number
  height: number
  depth: number
  hotX: number
  hotY: number
  /** chunky pixels; 0 = transparent unless opaque */
  pixels: Uint8Array
  /** set by No Mask: colour 0 draws */
  opaque: boolean
}

export function decodeSprite(s: Sprite): BankImage {
  const widthWords = s.width >> 4
  const planeSize = widthWords * 2 * s.height
  const pixels = new Uint8Array(s.width * s.height)
  for (let p = 0; p < s.depth; p++) {
    const bit = 1 << p
    const base = p * planeSize
    for (let y = 0; y < s.height; y++) {
      const rowOff = base + y * widthWords * 2
      for (let x = 0; x < s.width; x++) {
        const byte = s.data[rowOff + (x >> 3)] ?? 0
        if ((byte >> (7 - (x & 7))) & 1) {
          pixels[y * s.width + x] = pixels[y * s.width + x]! | bit
        }
      }
    }
  }
  return { width: s.width, height: s.height, depth: s.depth, hotX: s.hotX, hotY: s.hotY, pixels, opaque: false }
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
    const flipped: BankImage = {
      ...base,
      pixels: new Uint8Array(base.pixels.length),
      hotX: flags & 0x8000 ? base.width - 1 - base.hotX : base.hotX,
      hotY: flags & 0x4000 ? base.height - 1 - base.hotY : base.hotY,
    }
    for (let y = 0; y < base.height; y++) {
      const sy = flags & 0x4000 ? base.height - 1 - y : y
      for (let x = 0; x < base.width; x++) {
        const sx = flags & 0x8000 ? base.width - 1 - x : x
        flipped.pixels[y * base.width + x] = base.pixels[sy * base.width + sx]!
      }
    }
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
    if (n < 1) throw new Error('function call error')
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
    if (n < 1 || m < n || m > this.images.length) throw new Error('function call error')
    this.images.splice(n - 1, m - n + 1)
    this.flipCache.clear()
    return this.images.length > 0
  }
}

export function blankImage(): BankImage {
  return { width: 0, height: 0, depth: 0, hotX: 0, hotY: 0, pixels: new Uint8Array(0), opaque: false }
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
