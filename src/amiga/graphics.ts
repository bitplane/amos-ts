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
import {
  decode as decodePlanes,
  encode as encodePlanes,
  fillSpan as planarFillSpan,
  getPixel as planarGet,
  setPixel as planarSet,
} from './planar'
import type { DiskFont } from './diskfont'

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

  /**
   * Write one already-merged pixel into the planes, keeping the cache.
   *
   * WRITE-THROUGH rather than invalidate, and that is the whole reason this
   * lives here instead of callers doing `planeBytes(true)`: invalidating would
   * throw the cache away on every plot, so the next `Point` would decode an
   * entire bitmap to read one pixel back.
   */
  writePixel(x: number, y: number, v: number): void {
    planarSet(this.planes, this.planeSize, this.bytesPerRow, this.depth, x, y, v)
    if (this.cacheValid || this.cacheDirty) this.cache[y * this.width + x] = v
  }

  /**
   * Fill a horizontal run with one value — a word per 16 pixels per plane
   * rather than a pixel at a time, which is where planar wins.
   *
   * Caller's job to clip and to have merged the write mask; this is the
   * unconditional span the blitter would do.
   */
  fillSpan(y: number, x1: number, x2: number, v: number): void {
    planarFillSpan(this.planes, this.planeSize, this.bytesPerRow, this.depth, y, x1, x2, v)
    if (this.cacheValid || this.cacheDirty) {
      this.cache.fill(v, y * this.width + x1, y * this.width + x2 + 1)
    }
  }

  /**
   * Re-derive the chunky cache for one rectangle, after a bulk plane write.
   *
   * The counterpart to writing `planeBytes()` directly: a character cell is
   * eight byte-writes per plane, far cheaper than eight-times-eight
   * read-modify-writes, but it leaves the cache describing the old pixels.
   * Refreshing 64 of them beats invalidating and re-decoding the screen.
   *
   * Does nothing when the cache is not live — there is then nothing to keep
   * in step, and the next read decodes anyway.
   */
  refreshRect(x0: number, y0: number, w: number, h: number): void {
    if (!this.cacheValid && !this.cacheDirty) return
    for (let r = 0; r < h; r++) {
      const y = y0 + r
      if (y < 0 || y >= this.height) continue
      for (let b = 0; b < w; b++) {
        const x = x0 + b
        if (x < 0 || x >= this.width) continue
        this.cache[y * this.width + x] = planarGet(
          this.planes,
          this.planeSize,
          this.bytesPerRow,
          this.depth,
          x,
          y,
        )
      }
    }
  }

  /**
   * Declare the whole bitmap to be one value, without re-deriving it.
   *
   * Only correct when the caller has just written every plane to that value —
   * `Cls` through a full write mask. With a partial mask the excluded planes
   * still hold their old bits, so the cache has to be dropped instead.
   */
  refillCache(v: number): void {
    this.cache.fill(v)
    this.cacheValid = true
    this.cacheDirty = false
  }

  /** an independent copy of the same image — Double Buffer's second bitmap */
  clone(): BitMap {
    this.flush()
    return new BitMap(this.width, this.height, this.depth, this.bytesPerRow, this.planes.slice())
  }
}


/** the drawing state, saved so a caller can put it back — see snapshot() */
export interface RastPortState {
  fgPen: number
  bgPen: number
  aOlPen: number
  drawMode: number
  linePtrn: number
  areaPtrn: Uint16Array | null
  outline: boolean
  cpX: number
  cpY: number
  mask: number
  clip: ClipRect | null
  algoStyle: number
  font: DiskFont | null
}

/** the clipping rectangle a Layer imposes on the RastPort's geometry ops */
export interface ClipRect {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * graphics.library's `struct RastPort` — the drawing state, and the two
 * primitives every other shape reaches the bitmap through.
 *
 * ## Why this is a type and not just fields on a Screen
 *
 * These twelve values were fields on `Screen`, several already carrying their
 * RastPort name in a comment (`planeMask` is annotated "rp_Mask, the RastPort
 * write mask"). Keeping them there conflated three Amiga structures in one
 * object — a BitMap, a RastPort and an AMOS console — which cost real things:
 *
 * - `menu.ts` saves and restores five of these by hand around every draw,
 *   because there is one set per screen and a menu needs its own.
 * - `dialog.ts` grew `interface DialogDraw`, a hand-rolled RastPort with
 *   setPen/setBPen/setOutlinePen/rectFill/line/ellipse, discovered by need.
 * - `td.ts` has `TdRaster`, and `tdPen` hand-rolls a two-plane write mask
 *   that `mask = 0b11` says directly.
 * - JD's `Jd Textfont` records a font size and throws the face away, because
 *   there was "no RastPort to attach one to".
 *
 * ## What is NOT here
 *
 * AMOS's policy. `paint()`'s tempras flood, `box()`'s start-one-row-below
 * corner, `bar()`'s Set Paint outline pass and the whole `Wind` console stay
 * in ../runtime/screen.ts, because they are AMOS's implementations of these
 * ideas rather than graphics.library's. A `DEFECT:` may never appear in this
 * directory and none of these would survive the move without one.
 */
export class RastPort {
  constructor(public bitMap: BitMap) {}

  /** rp_FgPen — Ink's first argument, and what a plot defaults to */
  fgPen = 2
  /** rp_BgPen — Ink's second, the 0-bits of an area pattern */
  bgPen = 0
  /** rp_AOlPen — Ink's third, Set Paint borders and Paint mode 1 */
  aOlPen = 0
  /** rp_DrawMode: 0 JAM1, 1 JAM2, 2 COMPLEMENT (Gr Writing) */
  drawMode = 1
  /** rp_LinePtrn (SetDrPt) — 16 bits, cycled per plotted pixel */
  linePtrn = 0xffff
  /** rp_AreaPtrn (SetAfPt) — 16-bit rows; null is solid */
  areaPtrn: Uint16Array | null = null
  /** AREAOUTLINE in rp_Flags — Set Paint */
  outline = false
  /** rp_cp_x / rp_cp_y, the graphics cursor */
  cpX = 0
  cpY = 0
  /**
   * rp_Mask — which bitplanes a write may touch. All ones until TURBO's
   * `Set Planes` narrows it.
   */
  mask = 0xff
  /** the Layer's ClipRegion, as far as anything here is concerned */
  clip: ClipRect | null = null
  /** rp_AlgoStyle (SetSoftStyle) — styles graphics Text, not the console */
  algoStyle = 0
  /** rp_Font — null is the built-in 8x8 face */
  font: DiskFont | null = null

  /**
   * The drawing state, to put back afterwards.
   *
   * Callers that draw "with these pens, then restore" were writing the field
   * list out by hand, and the lists did not agree: menu.ts saved five fields
   * around a `bar` and one around a `line`, so a keyword reading anything
   * else — the draw mode, the graphics cursor — leaked its change out of the
   * menu. Enumerating the fields HERE means the set cannot drift from the
   * class that owns them.
   *
   * The bitmap is deliberately not part of it: this saves the pens, not the
   * surface.
   */
  snapshot(): RastPortState {
    return {
      fgPen: this.fgPen,
      bgPen: this.bgPen,
      aOlPen: this.aOlPen,
      drawMode: this.drawMode,
      linePtrn: this.linePtrn,
      areaPtrn: this.areaPtrn,
      outline: this.outline,
      cpX: this.cpX,
      cpY: this.cpY,
      mask: this.mask,
      clip: this.clip,
      algoStyle: this.algoStyle,
      font: this.font,
    }
  }

  restore(s: RastPortState): void {
    this.fgPen = s.fgPen
    this.bgPen = s.bgPen
    this.aOlPen = s.aOlPen
    this.drawMode = s.drawMode
    this.linePtrn = s.linePtrn
    this.areaPtrn = s.areaPtrn
    this.outline = s.outline
    this.cpX = s.cpX
    this.cpY = s.cpY
    this.mask = s.mask
    this.clip = s.clip
    this.algoStyle = s.algoStyle
    this.font = s.font
  }

  get width(): number {
    return this.bitMap.width
  }
  get height(): number {
    return this.bitMap.height
  }
  get depth(): number {
    return this.bitMap.depth
  }

  /** the pens a bitmap of this depth can actually hold */
  private colorMask(): number {
    return (1 << this.bitMap.depth) - 1
  }

  /** apply rp_Mask: the planes it excludes keep what the pixel already had */
  masked(old: number, next: number): number {
    return (this.mask === 0xff ? next : (old & ~this.mask) | (next & this.mask)) & this.colorMask()
  }

  inClip(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false
    const c = this.clip
    return c === null || (x >= c.x1 && y >= c.y1 && x <= c.x2 && y <= c.y2)
  }

  /**
   * THE pixel primitive. Every shape reaches the bitmap through this or
   * through `hline`, which is what makes the drawing surface small enough to
   * move at all.
   */
  plot(x: number, y: number, c = this.fgPen): void {
    if (!this.inClip(x, y)) return
    // COMPLEMENT and a partial mask are the only cases needing the old pixel;
    // an opaque plot does not, and that is the common one
    const needsOld = this.drawMode === 2 || this.mask !== 0xff
    const old = needsOld ? this.point(x, y) : 0
    const v = this.masked(old, this.drawMode === 2 ? old ^ c : c)
    this.bitMap.writePixel(x, y, v)
  }

  point(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1
    return this.bitMap.pixelAt(x, y)
  }

  /** write an already-merged value: no clip, no mode, no mask */
  putPixel(x: number, y: number, v: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    this.bitMap.writePixel(x, y, v)
  }

  hline(x1: number, x2: number, y: number, c = this.fgPen): void {
    if (x1 > x2) [x1, x2] = [x2, x1]
    // clamp to the drawable area so wild coordinates stay cheap
    if (y < 0 || y >= this.height) return
    x1 = Math.max(0, x1)
    x2 = Math.min(this.width - 1, x2)
    if (x2 < x1) return
    const cl = this.clip
    if (cl !== null) {
      if (y < cl.y1 || y > cl.y2) return
      x1 = Math.max(x1, cl.x1)
      x2 = Math.min(x2, cl.x2)
      if (x2 < x1) return
    }
    // COMPLEMENT and a partial write mask both depend on what is already
    // there, so they stay per-pixel; a plain opaque run is one word write
    // per plane, which is where planar wins
    if (this.drawMode === 2 || this.mask !== 0xff) {
      for (let x = x1; x <= x2; x++) this.plot(x, y, c)
      return
    }
    this.bitMap.fillSpan(y, x1, x2, this.masked(0, c))
  }
}
