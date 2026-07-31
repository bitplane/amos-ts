/**
 * graphics.library's `struct BitMap` — bitplanes, with a chunky cache.
 *
 * ## Why this exists
 *
 * Two classes implemented this contract independently. `Screen` holds two of
 * them (the logical and physical buffers) and `BankImage` holds one, and
 * `objects.ts` says so out loud: *"Same contract as Screen"*. Same flags, same
 * flush, same read-only-by-contract `pixels` beside a `pixelsW()` that admits
 * to writing — written twice, kept in step by hand.
 *
 * That is the four-calendars argument that created this directory. The next
 * thing wanting a bitmap — an Intuition screen, a blitter destination, a font
 * rendered off-screen — would have been the third copy.
 *
 * ## Bitplanes are the truth; chunky is a cache
 *
 * The planes hold the pixels in the hardware's layout, because that is what
 * `Logbase` pokes, the bitplane extensions and the copper's display fetch all
 * read. Plenty of code legitimately wants a byte per pixel — `Point`,
 * collision, `Zoom`, saving an IFF — so a derived chunky view is kept beside
 * them rather than decoded per access.
 *
 * It is a cache and not a second source of truth. `pixels` hands back a view
 * that must not be written; `pixelsW()` is what a bulk chunky writer takes and
 * says what it is doing; a plane write invalidates it outright.
 *
 * INVARIANT: `valid` and `dirty` are never both set. `valid` means the cache
 * matches the planes; `dirty` means the cache holds writes the planes have not
 * seen; `flush()` settles them.
 *
 * ## bytesPerRow is given, never computed
 *
 * There are two conventions in this port and both are correct. A screen rounds
 * its row up to a whole word (`rowBytesFor`); a sprite or icon bank truncates
 * (`bankRowBytesFor`, `width >> 4`). Every AMOS sprite is a multiple of 16
 * wide so they agree in practice, but a bank that is loaded and saved has to
 * come back byte for byte, so the caller's convention is the one that holds.
 */
import { decode as decodePlanes, encode as encodePlanes, getPixel as planarGet } from './planar'

export class BitMap {
  readonly planeSize: number
  /** the bitplanes, `depth` of them laid end to end */
  planes: Uint8Array
  private cache: Uint8Array
  private cacheValid: boolean
  private cacheDirty = false

  constructor(
    readonly width: number,
    readonly height: number,
    readonly depth: number,
    readonly bytesPerRow: number,
    planes?: Uint8Array,
  ) {
    this.planeSize = bytesPerRow * height
    this.planes = planes ?? new Uint8Array(this.planeSize * depth)
    this.cache = new Uint8Array(width * height)
    /*
     * The cache starts INVALID even for planes we allocated ourselves, where
     * both sides are zero and it would be accurate.
     *
     * Starting it valid looks like a free optimisation and is a trap: a
     * caller that allocates a bitmap and then fills `planes` directly — which
     * is how every sprite and icon arrives, and how the mouse pointer is
     * built — would read its chunky view back as zeros, because a valid cache
     * is believed. Three tests caught exactly that. One decode of an all-zero
     * bitmap on first read is not worth the class of bug.
     */
    this.cacheValid = false
  }

  /**
   * The pixels as chunky bytes. READ-ONLY by contract — a write through this
   * is lost the next time the planes are touched.
   */
  get pixels(): Uint8Array {
    if (!this.cacheValid && !this.cacheDirty) {
      decodePlanes(this.planes, this.planeSize, this.bytesPerRow, this.depth, this.width, this.height, this.cache)
      this.cacheValid = true
    }
    return this.cache
  }

  /** the chunky buffer, for a caller about to write to it */
  pixelsW(): Uint8Array {
    const p = this.pixels
    this.cacheValid = false
    this.cacheDirty = true
    return p
  }

  /** settle any pending chunky writes back into the planes */
  flush(): void {
    if (!this.cacheDirty) return
    encodePlanes(this.cache, this.planes, this.planeSize, this.bytesPerRow, this.depth, this.width, this.height)
    this.cacheDirty = false
    this.cacheValid = true
  }

  /**
   * The planes, with any pending chunky write settled first.
   *
   * `write` invalidates the chunky cache, because a plane poke changes pixels
   * the cache cannot know about. A reader that passes `false` and then writes
   * anyway is the bug this argument exists to make visible.
   */
  planeBytes(write = false): Uint8Array {
    this.flush()
    if (write) this.cacheValid = false
    return this.planes
  }

  /** the planes changed underneath us; the cache no longer describes them */
  invalidate(): void {
    this.cacheValid = false
    this.cacheDirty = false
  }

  /** one pixel, from whichever representation is current */
  pixelAt(x: number, y: number): number {
    if (this.cacheValid || this.cacheDirty) return this.cache[y * this.width + x]!
    return planarGet(this.planes, this.planeSize, this.bytesPerRow, this.depth, x, y)
  }

  /** an independent copy of the same image — Double Buffer's second bitmap */
  clone(): BitMap {
    this.flush()
    return new BitMap(this.width, this.height, this.depth, this.bytesPerRow, this.planes.slice())
  }

  /** swap two bitmaps' contents in place, for Screen Swap's pointer exchange */
  static exchange(a: BitMap, b: BitMap): void {
    a.flush()
    b.flush()
    const planes = a.planes
    a.planes = b.planes
    b.planes = planes
    a.invalidate()
    b.invalidate()
  }
}
