/**
 * layers.library — the clipping engine underneath every Amiga window.
 *
 * ## What a layer actually is
 *
 * Windows on the Amiga are not a display feature. The copper does SCREENS —
 * y-banded ViewPorts with their own BPLxPT, palette and BPLCON — and there is
 * exactly one BitMap per screen. Everything a window is happens in software,
 * in this library, and it comes down to one sentence:
 *
 *     a layer's visible area is its rectangle minus the rectangles of every
 *     layer in front of it
 *
 * That difference is a set of disjoint rectangles — the ClipRect list — and
 * graphics.library clips every drawing operation to it. Nothing about the
 * display path changes to make a window appear, which is why this module
 * exists on its own and why it touches no renderer.
 *
 * ## The three refresh types, and why only one of them has damage
 *
 * When a layer is uncovered the pixels underneath are gone. What happens next
 * is the whole difference between the three types:
 *
 *   SIMPLE — nothing was kept. The newly exposed area goes into the layer's
 *     DamageList and the owner is told to redraw it. This is the only type
 *     that accumulates damage, and it is why `damage` is only ever written
 *     for a simple layer here.
 *   SMART — the obscured pixels were saved off to the side as the layer was
 *     covered, and are put back when it is uncovered. Nothing to redraw.
 *   SUPER — the layer has a SuperBitMap of its own that is always complete;
 *     the screen bitmap is a window onto it.
 *
 * NOTE: SMART and SUPER are modelled as far as the CHAIN is concerned — they
 * take part in clipping and depth arrangement exactly like simple layers, and
 * they correctly accumulate no damage. What is not here is the pixel movement:
 * no backing store is allocated and no SuperBitMap is copied. That is a
 * graphics.library operation (BltBitMap between the screen bitmap and the
 * store) and it belongs with the RastPort work, not here. A smart layer
 * therefore clips correctly and comes back blank rather than restored.
 *
 * ## Evidence
 *
 * The function list and argument order are Commodore's own, from
 * `fixtures/amigaos/FD1.3/layers_lib.fd` — 25 functions, LVO -30 down to
 * -174. The REGION calls are not among them: NewRegion, OrRectRegion,
 * AndRectRegion, ClearRectRegion, XorRectRegion, OrRegionRegion and
 * AndRegionRegion are all graphics.library (graphics_lib.fd:88-108), which is
 * why Region is defined here as a plain value type rather than as something
 * layers.library owns. It is passed IN, by InstallClipRegion.
 *
 * Behaviour from AROS's rom/hyperlayers (semantics only; AROS is APL/LGPL and
 * no code is copied) — in particular the refresh-type tests
 * `IS_SIMPLEREFRESH`/`IS_SMARTREFRESH`/`IS_SUPERREFRESH`
 * (layers_intern.h:99-101), which are what make SMART mean
 * `LAYERSMART && !LAYERSUPER` rather than just the one bit.
 *
 * Rectangles are INCLUSIVE at both ends, which is the AmigaOS convention
 * (`struct Rectangle { WORD MinX, MinY, MaxX, MaxY; }`) and not the
 * half-open one. A 1x1 rectangle has MinX == MaxX. Getting this wrong is an
 * off-by-one in every clip in the system, so it is stated once here and every
 * helper below obeys it.
 */

/** `struct Rectangle` — inclusive at both ends */
export interface Rect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const rect = (minX: number, minY: number, maxX: number, maxY: number): Rect => ({ minX, minY, maxX, maxY })

/** empty when either extent is inverted; MinX == MaxX is one pixel wide */
export const rectEmpty = (r: Rect): boolean => r.maxX < r.minX || r.maxY < r.minY

export const rectWidth = (r: Rect): number => (rectEmpty(r) ? 0 : r.maxX - r.minX + 1)
export const rectHeight = (r: Rect): number => (rectEmpty(r) ? 0 : r.maxY - r.minY + 1)
export const rectArea = (r: Rect): number => rectWidth(r) * rectHeight(r)

export const rectContains = (r: Rect, x: number, y: number): boolean =>
  x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY

export function rectIntersect(a: Rect, b: Rect): Rect {
  return {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  }
}

export const rectEqual = (a: Rect, b: Rect): boolean =>
  a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY

/**
 * a minus b, as up to four disjoint rectangles: the band above the overlap,
 * the band below it, and the left and right pieces of the middle band.
 *
 * Splitting top and bottom FULL WIDTH and the sides only across the middle is
 * what keeps the result disjoint. The other decomposition (full-height sides,
 * narrow top and bottom) is equally valid and layers.library uses a
 * top-and-bottom-first split for the same reason — a ClipRect list that
 * overlapped itself would draw twice.
 */
export function rectSubtract(a: Rect, b: Rect): Rect[] {
  const i = rectIntersect(a, b)
  if (rectEmpty(i)) return rectEmpty(a) ? [] : [{ ...a }]
  const out: Rect[] = []
  if (i.minY > a.minY) out.push({ minX: a.minX, minY: a.minY, maxX: a.maxX, maxY: i.minY - 1 })
  if (i.maxY < a.maxY) out.push({ minX: a.minX, minY: i.maxY + 1, maxX: a.maxX, maxY: a.maxY })
  if (i.minX > a.minX) out.push({ minX: a.minX, minY: i.minY, maxX: i.minX - 1, maxY: i.maxY })
  if (i.maxX < a.maxX) out.push({ minX: i.maxX + 1, minY: i.minY, maxX: a.maxX, maxY: i.maxY })
  return out
}

/**
 * `struct Region` — a set of pixels, held as disjoint rectangles.
 *
 * graphics.library's, not layers.library's (NewRegion is graphics -516), but
 * it is the type every layers call is expressed in, so it lives beside them.
 *
 * The rectangles are kept DISJOINT and never merged back together. The real
 * library keeps a y-banded RegionRectangle list and does coalesce; the
 * difference is only in how many rectangles describe the same set of pixels,
 * and every operation here is defined on the set rather than the list, so
 * nothing observable depends on it. `area()` and `contains()` are exact
 * either way, which is what the tests compare.
 */
export class Region {
  rects: Rect[] = []

  static fromRect(r: Rect): Region {
    const g = new Region()
    if (!rectEmpty(r)) g.rects.push({ ...r })
    return g
  }

  clone(): Region {
    const g = new Region()
    g.rects = this.rects.map((r) => ({ ...r }))
    return g
  }

  isEmpty(): boolean {
    return this.rects.length === 0
  }

  clear(): void {
    this.rects = []
  }

  /** ClearRectRegion: remove r from the set */
  clearRect(r: Rect): void {
    if (rectEmpty(r)) return
    const out: Rect[] = []
    for (const q of this.rects) out.push(...rectSubtract(q, r))
    this.rects = out
  }

  /** OrRectRegion: add r. Cutting it out first keeps the list disjoint. */
  orRect(r: Rect): void {
    if (rectEmpty(r)) return
    this.clearRect(r)
    this.rects.push({ ...r })
  }

  /** AndRectRegion: keep only what is inside r */
  andRect(r: Rect): void {
    const out: Rect[] = []
    for (const q of this.rects) {
      const i = rectIntersect(q, r)
      if (!rectEmpty(i)) out.push(i)
    }
    this.rects = out
  }

  /** XorRectRegion: in one or the other but not both */
  xorRect(r: Rect): void {
    if (rectEmpty(r)) return
    const inBoth = this.clone()
    inBoth.andRect(r)
    const onlyR = Region.fromRect(r)
    onlyR.clearRegion(this)
    this.clearRegion(inBoth)
    this.orRegion(onlyR)
  }

  orRegion(o: Region): void {
    for (const r of o.rects) this.orRect(r)
  }

  clearRegion(o: Region): void {
    for (const r of o.rects) this.clearRect(r)
  }

  andRegion(o: Region): void {
    const out: Rect[] = []
    for (const q of this.rects) {
      for (const r of o.rects) {
        const i = rectIntersect(q, r)
        if (!rectEmpty(i)) out.push(i)
      }
    }
    this.rects = out
  }

  contains(x: number, y: number): boolean {
    return this.rects.some((r) => rectContains(r, x, y))
  }

  /** pixels covered — exact, and independent of how the set is cut up */
  area(): number {
    let n = 0
    for (const r of this.rects) n += rectArea(r)
    return n
  }

  /** the smallest rectangle holding the whole set; empty when the set is */
  bounds(): Rect {
    if (this.rects.length === 0) return { minX: 0, minY: 0, maxX: -1, maxY: -1 }
    const b = { ...this.rects[0]! }
    for (const r of this.rects) {
      b.minX = Math.min(b.minX, r.minX)
      b.minY = Math.min(b.minY, r.minY)
      b.maxX = Math.max(b.maxX, r.maxX)
      b.maxY = Math.max(b.maxY, r.maxY)
    }
    return b
  }

  /** same set of pixels? compared by difference in both directions */
  equals(o: Region): boolean {
    const a = this.clone()
    a.clearRegion(o)
    const b = o.clone()
    b.clearRegion(this)
    return a.isEmpty() && b.isEmpty()
  }

  /** move the whole set */
  offset(dx: number, dy: number): void {
    for (const r of this.rects) {
      r.minX += dx
      r.maxX += dx
      r.minY += dy
      r.maxY += dy
    }
  }
}

export type RefreshType = 'simple' | 'smart' | 'super'

/**
 * NOTE: the flag VALUES are the Commodore header's (graphics/clip.h), which
 * is the weakest tier this port uses — no binary in the archive passes them
 * and AROS's copy of the header is generated rather than checked in. Nothing
 * in the model below depends on them: the chain works in terms of
 * RefreshType, and this table exists only to decode a `flags` word if one
 * ever arrives from a real caller. AROS's own tests are what fix the
 * MEANING, and those are structural: SMART is LAYERSMART set and LAYERSUPER
 * clear, not just the one bit (layers_intern.h:99-101).
 */
export const LAYERSIMPLE = 1
export const LAYERSMART = 2
export const LAYERSUPER = 4
export const LAYERBACKDROP = 0x40

export function refreshFromFlags(flags: number): RefreshType {
  if (flags & LAYERSUPER) return 'super'
  if (flags & LAYERSMART) return 'smart'
  return 'simple'
}

export class Layer {
  /** where the layer sits in the bitmap, inclusive */
  rect: Rect
  readonly refresh: RefreshType
  /** a backdrop layer can never be brought in front of a non-backdrop one */
  backdrop = false
  /** the ClipRect list: what is actually visible, recomputed by the chain */
  clip = new Region()
  /** DamageList — simple-refresh only; what has been uncovered and not redrawn */
  damage = new Region()
  /** BeginUpdate has restricted the clip to the damage; EndUpdate puts it back */
  updating = false
  private savedClip: Region | null = null
  /** InstallClipRegion: the owner's own extra clip, in layer coordinates */
  clipRegion: Region | null = null
  /** ScrollLayer: how far the layer's contents have been moved under it */
  scrollX = 0
  scrollY = 0

  constructor(r: Rect, refresh: RefreshType) {
    this.rect = { ...r }
    this.refresh = refresh
  }

  /**
   * What a drawing operation may actually touch: the ClipRects, further cut
   * down by any InstallClipRegion. The installed region is in LAYER
   * coordinates, so it is offset onto the bitmap before intersecting — a
   * program installs a region describing its own interior and does not know
   * where its window is.
   */
  visible(): Region {
    const v = this.clip.clone()
    if (this.clipRegion) {
      const cr = this.clipRegion.clone()
      cr.offset(this.rect.minX, this.rect.minY)
      v.andRegion(cr)
    }
    return v
  }

  /**
   * The ClipRects ignoring any update in progress — what the layer would be
   * clipped to if EndUpdate ran now. The chain works in these terms, because
   * an update narrows the clip temporarily and the chain's view of what is
   * visible must not be narrowed with it.
   */
  fullClip(): Region {
    return this.savedClip ?? this.clip
  }

  /** the chain has recomputed; keep any narrowing an update is doing */
  setClip(v: Region): void {
    if (!this.updating) {
      this.clip = v
      return
    }
    this.savedClip = v
    const c = v.clone()
    c.andRegion(this.damage)
    this.clip = c
  }

  /** BeginUpdate: draw only where the damage is */
  beginUpdate(): void {
    if (this.updating) return
    this.updating = true
    this.savedClip = this.clip
    const c = this.clip.clone()
    c.andRegion(this.damage)
    this.clip = c
  }

  /**
   * EndUpdate(layer, flag). The flag is what decides whether the damage was
   * DEALT WITH: TRUE clears the list, FALSE leaves it for another pass. A
   * program that only got through part of a redraw ends with FALSE and is
   * asked again.
   */
  endUpdate(done: boolean): void {
    if (!this.updating) return
    this.updating = false
    if (this.savedClip) this.clip = this.savedClip
    this.savedClip = null
    if (done) this.damage.clear()
  }
}

/**
 * `struct Layer_Info` — the layer chain over ONE bitmap.
 *
 * Held back to front, index 0 backmost, which is the same convention as the
 * screen order this port already uses. layers.library holds it the other way
 * up (Layer_Info->top_layer is the front and `back` walks down); the order is
 * an implementation choice and this one keeps "in front of" reading as
 * "later in the array" throughout.
 */
export class LayerInfo {
  readonly layers: Layer[] = []

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  /** the whole bitmap, as a rectangle */
  bounds(): Rect {
    return { minX: 0, minY: 0, maxX: this.width - 1, maxY: this.height - 1 }
  }

  /** CreateUpfrontLayer: a new layer in front of everything */
  createUpfrontLayer(r: Rect, refresh: RefreshType = 'simple'): Layer {
    const l = new Layer(r, refresh)
    this.layers.push(l)
    this.recompute()
    return l
  }

  /** CreateBehindLayer: behind everything, which is where a backdrop goes */
  createBehindLayer(r: Rect, refresh: RefreshType = 'simple'): Layer {
    const l = new Layer(r, refresh)
    this.layers.unshift(l)
    this.recompute()
    return l
  }

  deleteLayer(l: Layer): boolean {
    const i = this.layers.indexOf(l)
    if (i < 0) return false
    this.layers.splice(i, 1)
    this.recompute()
    return true
  }

  upfrontLayer(l: Layer): boolean {
    return this.moveTo(l, this.layers.length - 1)
  }

  behindLayer(l: Layer): boolean {
    return this.moveTo(l, 0)
  }

  /** MoveLayerInFrontOf(to_move, to_be_in_front_of) */
  moveLayerInFrontOf(l: Layer, target: Layer): boolean {
    const t = this.layers.indexOf(target)
    if (t < 0 || l === target) return false
    const i = this.layers.indexOf(l)
    if (i < 0) return false
    return this.moveTo(l, i < t ? t : t + 1)
  }

  private moveTo(l: Layer, to: number): boolean {
    const i = this.layers.indexOf(l)
    if (i < 0) return false
    this.layers.splice(i, 1)
    this.layers.splice(Math.max(0, Math.min(to, this.layers.length)), 0, l)
    this.recompute()
    return true
  }

  /** MoveLayer: shift the layer, contents and all */
  moveLayer(l: Layer, dx: number, dy: number): boolean {
    if (this.layers.indexOf(l) < 0) return false
    l.rect = {
      minX: l.rect.minX + dx,
      minY: l.rect.minY + dy,
      maxX: l.rect.maxX + dx,
      maxY: l.rect.maxY + dy,
    }
    // the damage list is in bitmap coordinates and moves with the layer, but
    // anything already damaged has been uncovered, so it stays damaged
    l.damage.offset(dx, dy)
    this.recompute()
    return true
  }

  /**
   * SizeLayer: grow or shrink the bottom-right corner by (dx,dy).
   *
   * On a simple-refresh layer the new area is damage: it has never been drawn
   * and there is nothing behind it to restore. recompute() finds that on its
   * own, because "gained visible area" is exactly what it measures.
   */
  sizeLayer(l: Layer, dx: number, dy: number): boolean {
    if (this.layers.indexOf(l) < 0) return false
    l.rect = { ...l.rect, maxX: l.rect.maxX + dx, maxY: l.rect.maxY + dy }
    this.recompute()
    return true
  }

  /**
   * ScrollLayer: move the layer's CONTENTS under a stationary layer.
   *
   * The strip that scrolls into view was never drawn, so on a simple-refresh
   * layer it is damage — that is what makes a scrolling window in a program
   * that does not keep its own backing store ask for a redraw of just the new
   * edge. dx > 0 scrolls the contents left, exposing the right edge.
   */
  scrollLayer(l: Layer, dx: number, dy: number): boolean {
    if (this.layers.indexOf(l) < 0) return false
    l.scrollX += dx
    l.scrollY += dy
    if (l.refresh !== 'simple' || (dx === 0 && dy === 0)) return true
    const r = l.rect
    const exposed = new Region()
    if (dx > 0) exposed.orRect({ ...r, minX: Math.max(r.minX, r.maxX - dx + 1) })
    else if (dx < 0) exposed.orRect({ ...r, maxX: Math.min(r.maxX, r.minX - dx - 1) })
    if (dy > 0) exposed.orRect({ ...r, minY: Math.max(r.minY, r.maxY - dy + 1) })
    else if (dy < 0) exposed.orRect({ ...r, maxY: Math.min(r.maxY, r.minY - dy - 1) })
    exposed.andRegion(l.fullClip())
    l.damage.orRegion(exposed)
    return true
  }

  /** WhichLayer(li,x,y): the frontmost layer whose rect covers the point */
  whichLayer(x: number, y: number): Layer | null {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i]!
      if (rectContains(l.rect, x, y)) return l
    }
    return null
  }

  /** InstallClipRegion(layer, region): returns the one it replaced */
  installClipRegion(l: Layer, r: Region | null): Region | null {
    const old = l.clipRegion
    l.clipRegion = r
    return old
  }

  /**
   * THE WHOLE LIBRARY, in eleven lines.
   *
   * Walk front to back accumulating what is already covered. Each layer's
   * ClipRects are its rectangle minus that, clipped to the bitmap — a layer
   * dragged off the edge of the screen is not visible there, and the real
   * library will not build a ClipRect outside the BitMap either.
   *
   * Damage is measured as the area a SIMPLE layer GAINED. That single
   * definition covers every case the library documents separately: a layer in
   * front went away or moved off it, this layer came forward, this layer was
   * sized bigger, this layer was moved out from under something. All of them
   * are "there is now visible area that was not visible before", and none of
   * them needs its own branch.
   */
  private recompute(): void {
    const bm = this.bounds()
    const covered = new Region()
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i]!
      const vis = Region.fromRect(rectIntersect(l.rect, bm))
      vis.clearRegion(covered)
      // SMART and SUPER kept their pixels; only SIMPLE has to be told.
      //
      // Compared against the layer's FULL clip, not the one BeginUpdate
      // narrowed it to. Without that, a chain change during an update reads
      // every ClipRect outside the damage as newly gained and re-damages the
      // whole layer, which is how an update can fail to converge.
      if (l.refresh === 'simple') {
        const gained = vis.clone()
        gained.clearRegion(l.fullClip())
        if (!gained.isEmpty()) l.damage.orRegion(gained)
      }
      l.setClip(vis)
      covered.orRect(l.rect)
    }
  }
}
