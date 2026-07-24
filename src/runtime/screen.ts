import { FONT8 } from './font.gen'

/**
 * An AMOS screen: an indexed-colour framebuffer + a 12-bit RGB4 palette,
 * with the drawing primitives and the text engine. Pure TS — the canvas
 * only appears at composite time, so all of this is testable headless.
 */

/** The default 16-colour palette, from AMOSPro_Interpreter_Config. */
export const DEFAULT_PALETTE = [
  0x000, 0xa40, 0xfff, 0x000, 0xf00, 0x0f0, 0x00f, 0x666,
  0x555, 0x333, 0x733, 0x373, 0x773, 0x337, 0x737, 0x377,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]

/** A text window (WOpen): a character grid with its own console state. */
export interface Wind {
  n: number
  /** pixel origin of the text area */
  x: number
  y: number
  cols: number
  rows: number
  /** border style, 0 = none; the frame is 8px thick around the text area */
  border: number
  pen: number
  paper: number
  cuCol: number
  tab: number
  curX: number
  curY: number
  memX: number
  memY: number
  borPap: number
  borPen: number
  titleTop: string
  titleBottom: string
  /** background under the whole window, when Wind Save was active */
  savedBg: { x: number; y: number; w: number; h: number; data: Uint8Array } | null
  /** window that was current when this one opened (Wind Close returns) */
  prevN: number
  /** Writing modes: w1 replace/or/xor/and/ignore, w2 both/paper/pen */
  writing1: number
  writing2: number
  /** Scroll Off: printing past the bottom wraps to the top */
  scrollOff: boolean
  /** text styles: bit0 underline, bit1 bold, bit2 italic (Set Text) */
  style: number
  inverse: boolean
  /** Shade On: glyphs render through a dither mask */
  shade: boolean
}

/**
 * Built-in fill patterns (positive Set Pattern / Set Slider numbers). On the
 * Amiga these live in the system mouse bank (SPat +W.s:4722), which is not
 * in the fixture set — 1 and 2 (the slider defaults) are approximated as
 * classic dithers.
 */
export function builtinPattern(n: number): Uint16Array | null {
  if (n === 1) return Uint16Array.from([0xaaaa, 0x5555])
  if (n === 2) return Uint16Array.from([0x8888, 0x2222])
  return null
}

/**
 * SliPour (+W.s:5159): knob offset/length within a span, in the original
 * fixed-point ladder (×65536, ×256, ×1 depending on magnitudes), knob at
 * least 4px, clamped to the span, snapped to the far end when
 * pos+size >= total.
 */
export function sliderMetrics(span: number, total: number, pos: number, size: number): { off: number; len: number } {
  if (size >= total) {
    if (total === 0) total = 1
    size = total
  }
  const full = pos + size >= total
  let posPx: number
  let sizePx: number
  if (span < total) {
    const q = Math.floor((span * 0x10000) / total)
    posPx = (pos * q) >>> 16
    sizePx = (size * q + 0x8000) >>> 16
  } else if (Math.floor((span * 256) / total) < 0x10000) {
    const q = Math.floor((span * 256) / total)
    posPx = (pos * q) >>> 8
    sizePx = (size * q + 0x80) >>> 8
  } else {
    const q = Math.floor(span / total)
    posPx = pos * q
    sizePx = size * q
  }
  if (sizePx < 4) sizePx = 4
  let off = posPx
  if (off >= span) off = span - sizePx
  let end = off + sizePx
  if (end > span) {
    off = span - sizePx
    end = span
  }
  const len = end - off
  if (full) off = span - len
  return { off, len }
}

export class Screen {
  /**
   * The chunky buffers are the drawing surface; each has a faithful planar
   * mirror (Amiga bitplanes) that Logbase/Phybase/Screen Base address. Sync is
   * lazy and lossless: `get pixels`/`get back` pull any plane pokes back into
   * chunky (ensureChunky); resolving a plane address for reading encodes chunky
   * -> planar (ensurePlanar); a plane write marks the chunky side stale.
   */
  private _pixels: Uint8Array
  private _back: Uint8Array | null = null
  /** which representation is authoritative for each buffer */
  private logSrc: 'chunky' | 'planar' = 'chunky'
  private phySrc: 'chunky' | 'planar' = 'chunky'
  /** the LOGICAL buffer — all drawing and Point read this */
  get pixels(): Uint8Array {
    if (this.logSrc === 'planar') {
      this.decode(this.planarLog, this._pixels)
      this.logSrc = 'chunky'
    }
    return this._pixels
  }
  set pixels(v: Uint8Array) {
    this._pixels = v
    this.logSrc = 'chunky'
  }
  /** the PHYSICAL buffer when double-buffered (what the beam shows) */
  get back(): Uint8Array | null {
    if (this.phySrc === 'planar' && this._back && this.planarPhy) {
      this.decode(this.planarPhy, this._back)
      this.phySrc = 'chunky'
    }
    return this._back
  }
  set back(v: Uint8Array | null) {
    this._back = v
    this.phySrc = 'chunky'
  }
  // ---- Amiga planar layout (faithful: Taille plan +W.s:1856) ----
  /** bytes per bitplane row = ceil(width/16)*2 (word-aligned) */
  readonly rowBytes: number
  /** number of bitplanes = ceil(log2(nColors)) */
  readonly depth: number
  /** bytes per bitplane = rowBytes * height */
  readonly planeSize: number
  /** planar mirror of the logical buffer; Logbase(n) = planarLog + n*planeSize */
  private planarLog: Uint8Array
  /** planar mirror of the physical buffer (allocated by Double Buffer) */
  private planarPhy: Uint8Array | null = null
  /** Autoback mode: 2 (default) = fully automatic, 0/1 = manual-ish */
  autoback = 2
  palette = Uint16Array.from(DEFAULT_PALETTE)
  hires: boolean
  laced: boolean
  visible = true
  /** display position in AMOS hardware coords (default 128,50 = top-left) */
  displayX = 128
  displayY = 50
  /** displayed-window size (Screen Display n,,,w,h → EcAWTx/EcAWTy); -1 = full */
  displayW = -1
  displayH = -1
  offsetX = 0
  offsetY = 0
  // graphics state
  ink = 2
  /** graphics background pen (Ink 2nd arg, BPen) — pattern 0-bits */
  gPaper = 0
  /** area outline pen (Ink 3rd arg, AOlPen) — Set Paint borders, Paint mode 1 */
  gBorder = 0
  /** Set Line: 16-bit line pattern, cycled per plotted pixel */
  linePattern = 0xffff
  /** Set Paint: outline filled shapes with gBorder */
  outline = false
  /** Set Pattern: 16-bit rows for area fills (null = solid) */
  pattern: Uint16Array | null = null
  grX = 0
  grY = 0
  clip: { x1: number; y1: number; x2: number; y2: number } | null = null
  // text state lives in windows; window 0 is the whole screen
  windows = new Map<number, Wind>()
  curWin: Wind
  /** Wind Save: subsequently opened windows save their background */
  windSave = false
  cursorOn = true
  /** Gr Writing: 0 JAM1 (transparent), 1 JAM2, 2 XOR */
  grMode = 1
  /**
   * Set Slider state (SliSet +W.s:5246), per screen: frame inks A/B/C +
   * pattern, inner (knob) inks + pattern. Defaults from screen creation
   * (+W.s:3098-3109): frame/inner A,B = paper, C = pen, patterns 2 and 1.
   */
  slider = {
    fa: 1,
    fb: 1,
    fc: 2,
    fpat: builtinPattern(2),
    ia: 1,
    ib: 1,
    ic: 2,
    ipat: builtinPattern(1),
  }

  constructor(
    readonly index: number,
    readonly width: number,
    readonly height: number,
    readonly nColors: number,
    mode = 0,
  ) {
    this._pixels = new Uint8Array(width * height)
    this.rowBytes = ((width + 15) >> 4) << 1
    this.depth = Math.max(1, Math.ceil(Math.log2(Math.max(2, nColors))))
    this.planeSize = this.rowBytes * height
    this.planarLog = new Uint8Array(this.depth * this.planeSize)
    this.hires = (mode & 0x8000) !== 0
    this.laced = (mode & 0x4) !== 0
    const onePlane = nColors <= 2
    this.curWin = {
      n: 0,
      x: 0,
      y: 0,
      cols: width >> 3,
      rows: height >> 3,
      border: 0,
      // Wo3a defaults; 1-bitplane screens use paper 0 / pen 1
      pen: onePlane ? 1 : 2,
      paper: onePlane ? 0 : 1,
      cuCol: onePlane ? 1 : 3,
      tab: 4,
      curX: 0,
      curY: 0,
      memX: 0,
      memY: 0,
      borPap: onePlane ? 0 : 1,
      borPen: onePlane ? 1 : 2,
      titleTop: '',
      titleBottom: '',
      savedBg: null,
      prevN: 0,
      writing1: 0,
      writing2: 0,
      scrollOff: false,
      style: 0,
      inverse: false,
      shade: false,
    }
    this.windows.set(0, this.curWin)
  }

  // compatibility accessors — the console state is the current window's
  get pen(): number {
    return this.curWin.pen
  }
  set pen(v: number) {
    this.curWin.pen = v
  }
  get paper(): number {
    return this.curWin.paper
  }
  set paper(v: number) {
    this.curWin.paper = v
  }
  get curX(): number {
    return this.curWin.curX
  }
  set curX(v: number) {
    this.curWin.curX = v
  }
  get curY(): number {
    return this.curWin.curY
  }
  set curY(v: number) {
    this.curWin.curY = v
  }
  get memX(): number {
    return this.curWin.memX
  }
  set memX(v: number) {
    this.curWin.memX = v
  }
  get memY(): number {
    return this.curWin.memY
  }
  set memY(v: number) {
    this.curWin.memY = v
  }

  // ---- chunky <-> planar bijection (Amiga bitplanes) ------------------
  /** pack a chunky index buffer into `depth` contiguous bitplanes */
  private encode(chunky: Uint8Array, planar: Uint8Array): void {
    const { width, height, rowBytes, depth, planeSize } = this
    planar.fill(0)
    for (let y = 0; y < height; y++) {
      const rowBase = y * rowBytes
      for (let x = 0; x < width; x++) {
        const idx = chunky[y * width + x]!
        if (idx === 0) continue
        const byteOff = rowBase + (x >> 3)
        const mask = 0x80 >> (x & 7)
        for (let p = 0; p < depth; p++) {
          if (idx & (1 << p)) planar[p * planeSize + byteOff] = planar[p * planeSize + byteOff]! | mask
        }
      }
    }
  }
  /** unpack `depth` bitplanes back into a chunky index buffer */
  private decode(planar: Uint8Array, chunky: Uint8Array): void {
    const { width, height, rowBytes, depth, planeSize } = this
    for (let y = 0; y < height; y++) {
      const rowBase = y * rowBytes
      for (let x = 0; x < width; x++) {
        const byteOff = rowBase + (x >> 3)
        const mask = 0x80 >> (x & 7)
        let idx = 0
        for (let p = 0; p < depth; p++) {
          if (planar[p * planeSize + byteOff]! & mask) idx |= 1 << p
        }
        chunky[y * width + x] = idx
      }
    }
  }

  /**
   * The planar mirror of a buffer, addressable at Logbase/Phybase. `write`
   * marks the chunky side stale so the next `.pixels`/`.back` access re-decodes
   * (a plane poke); a read just refreshes the planar bytes from chunky.
   */
  planarView(kind: 'log' | 'phy', write: boolean): Uint8Array {
    if (kind === 'phy' && this._back !== null) {
      if (this.planarPhy === null) this.planarPhy = new Uint8Array(this.depth * this.planeSize)
      if (this.phySrc === 'chunky') this.encode(this._back, this.planarPhy)
      if (write) this.phySrc = 'planar'
      return this.planarPhy
    }
    // single-buffered Phybase aliases the logical bitmap, as on the hardware
    if (this.logSrc === 'chunky') this.encode(this._pixels, this.planarLog)
    if (write) this.logSrc = 'planar'
    return this.planarLog
  }

  /** true once Double Buffer has split the physical bitmap from the logical */
  get doubleBuffered(): boolean {
    return this._back !== null
  }

  /** Double Buffer: create the physical buffer */
  doubleBuffer(): void {
    if (this._back === null) {
      this._back = this._pixels.slice()
      this.phySrc = 'chunky'
    }
  }

  /** Screen Swap: exchange logical and physical */
  swap(): void {
    if (this._back === null) return
    // force both chunky sides current, then swap; the planar mirrors are
    // marked stale ('chunky' authoritative) and re-encode on the next access
    const log = this.pixels
    const phy = this.back!
    this._pixels = phy
    this._back = log
    this.logSrc = 'chunky'
    this.phySrc = 'chunky'
  }

  /** the buffer the display shows */
  get displayBuffer(): Uint8Array {
    // with autoback 2 both buffers are kept identical on the real
    // machine — showing the logical buffer is equivalent
    return this.back !== null && this.autoback === 0 ? this.back : this.pixels
  }

  /** buffer selection for Logic()/Physic() screen ids */
  bufferFor(kind: 'logic' | 'physic'): Uint8Array {
    if (this.back === null) return this.pixels
    return kind === 'logic' ? this.pixels : this.displayBuffer === this.pixels ? this.pixels : this.back
  }

  /** text columns/rows of the CURRENT WINDOW */
  get cols(): number {
    return this.curWin.cols
  }

  get rows(): number {
    return this.curWin.rows
  }

  private colorMask(): number {
    return this.nColors <= 2 ? 1 : this.nColors <= 4 ? 3 : this.nColors <= 8 ? 7 : this.nColors <= 16 ? 15 : 31
  }

  inClip(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false
    const c = this.clip
    return c === null || (x >= c.x1 && y >= c.y1 && x <= c.x2 && y <= c.y2)
  }

  plot(x: number, y: number, c = this.ink): void {
    if (!this.inClip(x, y)) return
    const i = y * this.width + x
    // Gr Writing 2 = COMPLEMENT: xor the destination
    if (this.grMode === 2) this.pixels[i] = (this.pixels[i]! ^ c) & this.colorMask()
    else this.pixels[i] = c & this.colorMask()
  }

  point(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1
    return this.pixels[y * this.width + x]!
  }

  hline(x1: number, x2: number, y: number, c = this.ink): void {
    if (x1 > x2) [x1, x2] = [x2, x1]
    // clamp to the drawable area so wild coordinates stay cheap
    if (y < 0 || y >= this.height) return
    x1 = Math.max(0, x1)
    x2 = Math.min(this.width - 1, x2)
    for (let x = x1; x <= x2; x++) this.plot(x, y, c)
  }

  line(x1: number, y1: number, x2: number, y2: number, c = this.ink): void {
    this.grX = x2
    this.grY = y2
    // Liang-Barsky clip to the screen so far-off endpoints don't cost
    // millions of Bresenham steps
    const dx = x2 - x1
    const dy = y2 - y1
    let t0 = 0
    let t1 = 1
    const edges: Array<[number, number]> = [
      [-dx, x1],
      [dx, this.width - 1 - x1],
      [-dy, y1],
      [dy, this.height - 1 - y1],
    ]
    for (const [p, q] of edges) {
      if (p === 0) {
        if (q < 0) return
        continue
      }
      const r = q / p
      if (p < 0) {
        if (r > t1) return
        if (r > t0) t0 = r
      } else {
        if (r < t0) return
        if (r < t1) t1 = r
      }
    }
    const cx1 = Math.round(x1 + t0 * dx)
    const cy1 = Math.round(y1 + t0 * dy)
    const cx2 = Math.round(x1 + t1 * dx)
    const cy2 = Math.round(y1 + t1 * dy)
    this.rawLine(cx1, cy1, cx2, cy2, c)
  }

  private rawLine(x1: number, y1: number, x2: number, y2: number, c: number): void {
    const dx = Math.abs(x2 - x1)
    const dy = -Math.abs(y2 - y1)
    const sx = x1 < x2 ? 1 : -1
    const sy = y1 < y2 ? 1 : -1
    let err = dx + dy
    let bit = 15 // Set Line pattern rotates from the top bit
    for (;;) {
      if ((this.linePattern >> bit) & 1) this.plot(x1, y1, c)
      bit = bit === 0 ? 15 : bit - 1
      if (x1 === x2 && y1 === y2) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x1 += sx
      }
      if (e2 <= dx) {
        err += dx
        y1 += sy
      }
    }
  }

  box(x1: number, y1: number, x2: number, y2: number, c = this.ink): void {
    this.line(x1, y1, x2, y1, c)
    this.line(x2, y1, x2, y2, c)
    this.line(x2, y2, x1, y2, c)
    this.line(x1, y2, x1, y1, c)
  }

  bar(x1: number, y1: number, x2: number, y2: number, c = this.ink): void {
    if (x1 > x2) [x1, x2] = [x2, x1]
    if (y1 > y2) [y1, y2] = [y2, y1]
    const cy1 = Math.max(0, y1)
    const cy2 = Math.min(this.height - 1, y2)
    if (this.pattern === null) {
      for (let y = cy1; y <= cy2; y++) this.hline(x1, x2, y, c)
    } else {
      const rows = this.pattern.length
      const cx1 = Math.max(0, x1)
      const cx2 = Math.min(this.width - 1, x2)
      for (let y = cy1; y <= cy2; y++) {
        const row = this.pattern[y % rows]!
        for (let x = cx1; x <= cx2; x++) {
          this.plot(x, y, (row >> (15 - (x & 15))) & 1 ? c : this.gPaper)
        }
      }
    }
    if (this.outline) {
      const saved = this.linePattern
      this.linePattern = 0xffff
      this.box(x1, y1, x2, y2, this.gBorder)
      this.linePattern = saved
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c = this.ink, fill = false): void {
    if (rx <= 0 || ry <= 0) {
      this.plot(cx, cy, c)
      return
    }
    if (fill) {
      const yLo = Math.max(-ry, -cy)
      const yHi = Math.min(ry, this.height - 1 - cy)
      for (let y = yLo; y <= yHi; y++) {
        const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))))
        this.hline(cx - w, cx + w, cy + y, c)
      }
      return
    }
    // sampled parametric outline is fine at these resolutions
    let px = cx + rx
    let py = cy
    const steps = Math.min(4096, Math.max(16, (rx + ry) * 2))
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * 2 * Math.PI
      const x = cx + Math.round(rx * Math.cos(a))
      const y = cy + Math.round(ry * Math.sin(a))
      this.line(px, py, x, y, c)
      px = x
      py = y
    }
  }

  /**
   * Hslider/Vslider (SliHor/SliVer, +W.s:5051/5086): track-before and
   * track-after rects in the frame colours, the knob in the inner colours,
   * all pattern-filled and outlined in ink C (SliPut). Dialog sliders pass
   * their own per-channel colour set.
   */
  drawSlider(
    vertical: boolean,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    total: number,
    pos: number,
    size: number,
    cfg = this.slider,
  ): void {
    const span = vertical ? y2 - y1 : x2 - x1
    const { off, len } = sliderMetrics(span, total, pos, size)
    const saved = { ink: this.ink, gPaper: this.gPaper, gBorder: this.gBorder, pattern: this.pattern, outline: this.outline, lp: this.linePattern }
    this.outline = true
    this.linePattern = 0xffff
    const rect = (a: number, b: number, inner: boolean): void => {
      if (b <= a) return // SliDess: strict extents only
      this.ink = inner ? cfg.ia : cfg.fa
      this.gPaper = inner ? cfg.ib : cfg.fb
      this.gBorder = inner ? cfg.ic : cfg.fc
      this.pattern = inner ? cfg.ipat : cfg.fpat
      if (vertical) this.bar(x1, a, x2, b)
      else this.bar(a, y1, b, y2)
    }
    const base = vertical ? y1 : x1
    rect(base, base + off, false)
    rect(base + off, base + off + len, true)
    rect(base + off + len, base + span, false)
    this.ink = saved.ink
    this.gPaper = saved.gPaper
    this.gBorder = saved.gBorder
    this.pattern = saved.pattern
    this.outline = saved.outline
    this.linePattern = saved.lp
  }

  /**
   * Filled polygon (InPolygon +ILib.s:5535 → InitArea/AreaEnd): scanline
   * fill in the ink/pattern, auto-closed, with an outline in the border pen
   * when Set Paint is on. Vertices are [x,y] pairs.
   */
  fillPolygon(pts: Array<[number, number]>, c = this.ink): void {
    if (pts.length < 3) {
      for (let i = 0; i + 1 < pts.length; i++) this.line(pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1], c)
      return
    }
    let yMin = Infinity
    let yMax = -Infinity
    for (const [, y] of pts) {
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
    }
    yMin = Math.max(yMin, 0)
    yMax = Math.min(yMax, this.height - 1)
    const rows = this.pattern
    for (let y = yMin; y <= yMax; y++) {
      const xs: number[] = []
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i]!
        const [bx, by] = pts[(i + 1) % pts.length]!
        if (ay === by) continue
        if ((y >= ay && y < by) || (y >= by && y < ay)) {
          xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay))
        }
      }
      xs.sort((p, q) => p - q)
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x0 = Math.round(xs[i]!)
        const x1 = Math.round(xs[i + 1]!)
        if (rows === null) this.hline(x0, x1, y, c)
        else {
          const row = rows[y % rows.length]!
          for (let x = Math.max(0, x0); x <= Math.min(this.width - 1, x1); x++) {
            this.plot(x, y, (row >> (15 - (x & 15))) & 1 ? c : this.gPaper)
          }
        }
      }
    }
    if (this.outline) {
      const saved = this.linePattern
      this.linePattern = 0xffff
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!
        const b = pts[(i + 1) % pts.length]!
        this.line(a[0], a[1], b[0], b[1], this.gBorder)
      }
      this.linePattern = saved
    }
  }

  paint(x: number, y: number, c = this.ink, borderMode = false): void {
    const target = this.point(x, y)
    if (target < 0 || target === (c & this.colorMask())) return
    const border = this.gBorder & this.colorMask()
    if (borderMode && target === border) return
    // mode 0: fill the same-colour region; mode 1: fill until gBorder
    const fillable = (px: number, py: number): boolean => {
      const v = this.point(px, py)
      if (v < 0) return false
      return borderMode ? v !== border && v !== (c & this.colorMask()) : v === target
    }
    const stack = [[x, y] as [number, number]]
    while (stack.length > 0) {
      const [px, py] = stack.pop()!
      if (!this.inClip(px, py) || !fillable(px, py)) continue
      let x1 = px
      while (x1 > 0 && fillable(x1 - 1, py) && this.inClip(x1 - 1, py)) x1--
      let x2 = px
      while (x2 < this.width - 1 && fillable(x2 + 1, py) && this.inClip(x2 + 1, py)) x2++
      this.hline(x1, x2, py, c)
      for (let sx = x1; sx <= x2; sx++) {
        if (py > 0 && fillable(sx, py - 1)) stack.push([sx, py - 1])
        if (py < this.height - 1 && fillable(sx, py + 1)) stack.push([sx, py + 1])
      }
    }
  }

  /**
   * Cls c[,region] (EcCls +W.s:3660): clears the screen or a pixel region.
   * It does NOT home the text cursor — only Clw (Cls with no argument) does.
   */
  cls(c = this.paper, x1 = 0, y1 = 0, x2 = this.width - 1, y2 = this.height - 1): void {
    if (x1 === 0 && y1 === 0 && x2 === this.width - 1 && y2 === this.height - 1 && this.clip === null) {
      this.pixels.fill(c & this.colorMask())
    } else {
      this.bar(x1, y1, x2, y2, c)
    }
  }

  /** Draw one 8x8 glyph honouring the window Writing modes and styles. */
  drawChar(px: number, py: number, ch: number, pen: number, paper: number, transparent = false): void {
    const w = this.curWin
    if (w.writing1 === 4) return // IGNORE
    if (w.inverse) {
      const t = pen
      pen = paper
      paper = t
    }
    const glyph = FONT8[ch & 0xff] ?? FONT8[32]!
    const bg = w.writing2 === 2 ? 0 : paper
    for (let row = 0; row < 8; row++) {
      let bits = glyph[row]!
      if (w.style & 2) bits |= bits >> 1 // bold
      if (w.style & 4) bits = row < 4 ? (bits >> 1) & 0xff : bits // italic (slanted top)
      if (w.style & 1 && row === 7) bits = 0xff // underline
      if (w.shade) bits &= row & 1 ? 0x55 : 0xaa // dither mask
      for (let col = 0; col < 8; col++) {
        const x = px + col
        const y = py + row
        const on = (bits >> (7 - col)) & 1
        if (on) {
          if (w.writing2 === 1) continue // paper only
          this.writeMode(x, y, pen, w.writing1)
        } else if (!transparent) {
          this.writeMode(x, y, bg, w.writing1)
        }
      }
    }
  }

  /** apply a Writing mode: 0 replace, 1 OR, 2 XOR, 3 AND */
  private writeMode(x: number, y: number, c: number, mode: number): void {
    if (!this.inClip(x, y)) return
    const i = y * this.width + x
    const m = this.colorMask()
    switch (mode) {
      case 1:
        this.pixels[i] = (this.pixels[i]! | c) & m
        break
      case 2:
        this.pixels[i] = (this.pixels[i]! ^ c) & m
        break
      case 3:
        this.pixels[i] = this.pixels[i]! & c & m
        break
      default:
        this.pixels[i] = c & m
    }
  }

  /** Graphics text (Text x,y,s$): y is the baseline, drawn with ink. */
  text(x: number, y: number, s: string): void {
    for (let i = 0; i < s.length; i++) {
      this.drawChar(x + i * 8, y - 6, s.charCodeAt(i), this.ink, 0, true)
    }
  }

  // ---- text console (window-relative) ----

  putChar(ch: number): void {
    const w = this.curWin
    this.drawChar(w.x + w.curX * 8, w.y + w.curY * 8, ch, w.pen, w.paper)
    w.curX++
    if (w.curX >= w.cols) this.newline()
  }

  newline(): void {
    const w = this.curWin
    w.curX = 0
    w.curY++
    if (w.curY >= w.rows) {
      if (w.scrollOff) {
        w.curY = 0 // Scroll Off: restart from the top of the window
      } else {
        this.scrollUp(8)
        w.curY = w.rows - 1
      }
    }
  }

  writeText(text: string): void {
    for (let ti = 0; ti < text.length; ti++) {
      const ch = text[ti]!
      const c = ch.charCodeAt(0)
      if (c === 27) {
        // console escape: letter + parameter characters (see +Lib.s ChXxx)
        const w = this.curWin
        const op = text[ti + 1] ?? ''
        const arg = (k: number): number => (text.charCodeAt(ti + 1 + k) || 48) - 48
        switch (op) {
          case 'X':
            this.locate(arg(1), -1)
            ti += 2
            break
          case 'Y':
            this.locate(-1, arg(1))
            ti += 2
            break
          case 'P':
            w.pen = arg(1)
            ti += 2
            break
          case 'B':
            w.paper = arg(1)
            ti += 2
            break
          case 'D':
            w.cuCol = arg(1)
            ti += 2
            break
          case 'T':
            w.tab = Math.max(1, arg(1))
            ti += 2
            break
          case 'C':
            this.cursorOn = arg(1) !== 0
            ti += 2
            break
          case 'W':
            w.writing2 = arg(1) >> 3
            w.writing1 = arg(1) & 7
            ti += 2
            break
          case 'N': // cmove Y, biased +128 (ChCMv)
            w.curY = Math.max(0, Math.min(w.rows - 1, w.curY + (text.charCodeAt(ti + 2) || 128) - 128))
            ti += 2
            break
          case 'O': // cmove X
            w.curX = Math.max(0, Math.min(w.cols - 1, w.curX + (text.charCodeAt(ti + 2) || 128) - 128))
            ti += 2
            break
          case 'M': {
            const m = arg(1)
            if (m === 0) w.memX = w.curX
            else if (m === 2) w.memY = w.curY
            else if (m === 1) w.curX = Math.min(w.cols - 1, w.memX)
            else w.curY = Math.min(w.rows - 1, w.memY)
            ti += 2
            break
          }
          default:
            ti += 1
        }
        continue
      }
      switch (c) {
        case 10: // LF
          this.newline()
          break
        case 13: // CR
          this.curX = 0
          break
        case 8: // backspace
          this.curX = Math.max(0, this.curX - 1)
          break
        case 9: {
          // tab — next multiple of the window tab (WiTab)
          const t = Math.max(1, this.curWin.tab)
          const next = (Math.floor(this.curX / t) + 1) * t
          if (next < this.cols) this.curX = next
          break
        }
        case 12: // Home — cursor to top-left, NO clear (ChHom in +Lib.s)
          this.curX = 0
          this.curY = 0
          break
        case 25: // Clw — clear the window (ChClw)
          this.clw()
          break
        case 28: // cursor right (Cright$)
          this.curX = Math.min(this.cols - 1, this.curX + 1)
          break
        case 29: // cursor left (Cleft$)
          this.curX = Math.max(0, this.curX - 1)
          break
        case 30: // cursor up (Cup$)
          this.curY = Math.max(0, this.curY - 1)
          break
        case 31: // cursor down (Cdown$)
          this.newline()
          break
        default:
          this.putChar(c)
      }
    }
  }

  locate(x: number, y: number): void {
    if (x >= 0) this.curX = Math.min(x, this.cols - 1)
    if (y >= 0) this.curY = Math.min(y, this.rows - 1)
  }

  /** scroll the CURRENT WINDOW's text area up by px pixels */
  scrollUp(px: number): void {
    const w = this.curWin
    const wPix = w.cols * 8
    const hPix = w.rows * 8
    if (w.x === 0 && w.y === 0 && wPix === this.width && hPix === this.height) {
      this.pixels.copyWithin(0, px * this.width)
      this.pixels.fill(w.paper & this.colorMask(), (this.height - px) * this.width)
      return
    }
    for (let y = 0; y < hPix - px; y++) {
      const src = (w.y + y + px) * this.width + w.x
      this.pixels.copyWithin((w.y + y) * this.width + w.x, src, src + wPix)
    }
    for (let y = hPix - px; y < hPix; y++) {
      this.pixels.fill(w.paper & this.colorMask(), (w.y + y) * this.width + w.x, (w.y + y) * this.width + w.x + wPix)
    }
  }

  /** Clw: clear the current window's text area and home the cursor */
  clw(): void {
    const w = this.curWin
    for (let y = 0; y < w.rows * 8; y++) {
      this.pixels.fill(w.paper & this.colorMask(), (w.y + y) * this.width + w.x, (w.y + y) * this.width + w.x + w.cols * 8)
    }
    w.curX = 0
    w.curY = 0
  }

  // ---- window management (WOpen/WinDel/QWindow/MoveWi/SBord/STitle) ----

  private drawWindowFrame(w: Wind): void {
    if (w.border === 0) return
    const x1 = w.x - 8
    const y1 = w.y - 8
    const x2 = w.x + w.cols * 8 + 7
    const y2 = w.y + w.rows * 8 + 7
    const saved = { ink: this.ink, gPaper: this.gPaper, pattern: this.pattern, outline: this.outline, lp: this.linePattern }
    this.pattern = null
    this.outline = false
    this.linePattern = 0xffff
    // frame in border paper, edged with border pen
    this.bar(x1, y1, x2, y1 + 7, w.borPap)
    this.bar(x1, y2 - 7, x2, y2, w.borPap)
    this.bar(x1, y1, x1 + 7, y2, w.borPap)
    this.bar(x2 - 7, y1, x2, y2, w.borPap)
    this.box(x1, y1, x2, y2, w.borPen)
    const title = (t: string, ty: number): void => {
      if (t === '') return
      const cx = w.x + Math.max(0, (w.cols - t.length) >> 1) * 8
      for (let i = 0; i < Math.min(t.length, w.cols); i++) {
        this.drawChar(cx + i * 8, ty, t.charCodeAt(i), w.borPen, w.borPap)
      }
    }
    // titles render through window 0 writing modes — force replace
    const cw = this.curWin
    this.curWin = w
    const w1 = w.writing1
    w.writing1 = 0
    title(w.titleTop, y1)
    title(w.titleBottom, y2 - 7)
    w.writing1 = w1
    this.curWin = cw
    this.ink = saved.ink
    this.gPaper = saved.gPaper
    this.pattern = saved.pattern
    this.outline = saved.outline
    this.linePattern = saved.lp
  }

  /** full pixel rect of a window including its border */
  private windowRect(w: Wind): { x: number; y: number; wPix: number; hPix: number } {
    const b = w.border !== 0 ? 8 : 0
    return { x: w.x - b, y: w.y - b, wPix: w.cols * 8 + 2 * b, hPix: w.rows * 8 + 2 * b }
  }

  windOpen(n: number, x: number, y: number, cols: number, rows: number, border: number): Wind {
    if (this.windows.has(n) && n !== 0) throw new Error('window already opened')
    const alignedX = (x >> 4) << 4
    const b = border !== 0 ? 8 : 0
    const src = this.curWin
    const w: Wind = {
      n,
      x: alignedX + b,
      y: y + b,
      cols,
      rows,
      border,
      pen: src.pen,
      paper: src.paper,
      cuCol: src.cuCol,
      tab: src.tab,
      curX: 0,
      curY: 0,
      memX: 0,
      memY: 0,
      borPap: src.borPap,
      borPen: src.borPen,
      titleTop: '',
      titleBottom: '',
      savedBg: null,
      prevN: src.n,
      writing1: 0,
      writing2: 0,
      scrollOff: false,
      style: 0,
      inverse: false,
      shade: false,
    }
    if (this.windSave) {
      const r = this.windowRect(w)
      const data = new Uint8Array(r.wPix * r.hPix)
      for (let yy = 0; yy < r.hPix; yy++) {
        for (let xx = 0; xx < r.wPix; xx++) {
          const v = this.point(r.x + xx, r.y + yy)
          data[yy * r.wPix + xx] = v < 0 ? 0 : v
        }
      }
      w.savedBg = { x: r.x, y: r.y, w: r.wPix, h: r.hPix, data }
    }
    this.windows.set(n, w)
    this.curWin = w
    this.drawWindowFrame(w)
    this.clw()
    return w
  }

  windClose(): void {
    const w = this.curWin
    if (w.n === 0) return
    if (w.savedBg) {
      const bg = w.savedBg
      for (let yy = 0; yy < bg.h; yy++) {
        for (let xx = 0; xx < bg.w; xx++) {
          const px = bg.x + xx
          const py = bg.y + yy
          if (px >= 0 && py >= 0 && px < this.width && py < this.height) {
            this.pixels[py * this.width + px] = bg.data[yy * bg.w + xx]!
          }
        }
      }
    }
    this.windows.delete(w.n)
    this.curWin = this.windows.get(w.prevN) ?? this.windows.get(0)!
  }

  /** redraw the current window's frame (Border/Title changes) */
  drawWindowFrame2(): void {
    this.drawWindowFrame(this.curWin)
  }

  selectWindow(n: number): void {
    const w = this.windows.get(n)
    if (!w) throw new Error(`window not opened: ${n}`)
    this.curWin = w
  }

  /** Rectangle blit (Screen Copy); handles overlap via an intermediate copy. */
  static copy(
    src: Screen,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    dst: Screen,
    dx: number,
    dy: number,
  ): void {
    Screen.copyBuf(src, src.pixels, x1, y1, x2, y2, dst, dst.pixels, dx, dy)
  }

  /** blit between explicit buffers (Logic/Physic aware) */
  static copyBuf(
    src: Screen,
    srcBuf: Uint8Array,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    dst: Screen,
    dstBuf: Uint8Array,
    dx: number,
    dy: number,
  ): void {
    // clamp the source rect (wild coordinates must not allocate wildly)
    if (x1 < 0) {
      dx -= x1
      x1 = 0
    }
    if (y1 < 0) {
      dy -= y1
      y1 = 0
    }
    x2 = Math.min(x2, src.width)
    y2 = Math.min(y2, src.height)
    const w = x2 - x1
    const h = y2 - y1
    if (w <= 0 || h <= 0) return
    const tmp = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x1 + x
        const sy = y1 + y
        tmp[y * w + x] = sx >= 0 && sy >= 0 && sx < src.width && sy < src.height ? srcBuf[sy * src.width + sx]! : 0
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tx = dx + x
        const ty = dy + y
        if (tx >= 0 && ty >= 0 && tx < dst.width && ty < dst.height) {
          dstBuf[ty * dst.width + tx] = tmp[y * w + x]!
        }
      }
    }
  }

  /** RGBA rendering of this screen's own pixels (no display offset). */
  renderRGBA(out?: Uint8ClampedArray): Uint8ClampedArray {
    const data = out ?? new Uint8ClampedArray(this.width * this.height * 4)
    for (let i = 0; i < this.pixels.length; i++) {
      const rgb4 = this.palette[this.pixels[i]! & 31]!
      data[i * 4] = ((rgb4 >> 8) & 15) * 17
      data[i * 4 + 1] = ((rgb4 >> 4) & 15) * 17
      data[i * 4 + 2] = (rgb4 & 15) * 17
      data[i * 4 + 3] = 255
    }
    return data
  }
}
