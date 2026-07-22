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

export class Screen {
  pixels: Uint8Array
  palette = Uint16Array.from(DEFAULT_PALETTE)
  hires: boolean
  laced: boolean
  visible = true
  /** display position in AMOS hardware coords (default 128,50 = top-left) */
  displayX = 128
  displayY = 50
  offsetX = 0
  offsetY = 0
  // graphics state
  ink = 2
  grX = 0
  grY = 0
  clip: { x1: number; y1: number; x2: number; y2: number } | null = null
  // text state
  pen = 2
  paper = 1
  curX = 0
  curY = 0
  cursorOn = true
  writing = 0

  constructor(
    readonly index: number,
    readonly width: number,
    readonly height: number,
    readonly nColors: number,
    mode = 0,
  ) {
    this.pixels = new Uint8Array(width * height)
    this.hires = (mode & 0x8000) !== 0
    this.laced = (mode & 0x4) !== 0
    if (nColors <= 2) {
      // 1-bitplane screens default to paper 0 / pen 1 (Wo3a in +W.s)
      this.paper = 0
      this.pen = 1
    }
  }

  get cols(): number {
    return this.width >> 3
  }

  get rows(): number {
    return this.height >> 3
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
    if (this.inClip(x, y)) this.pixels[y * this.width + x] = c & this.colorMask()
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
    for (;;) {
      this.plot(x1, y1, c)
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
    this.hline(x1, x2, y1, c)
    this.hline(x1, x2, y2, c)
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      this.plot(x1, y, c)
      this.plot(x2, y, c)
    }
  }

  bar(x1: number, y1: number, x2: number, y2: number, c = this.ink): void {
    if (y1 > y2) [y1, y2] = [y2, y1]
    y1 = Math.max(0, y1)
    y2 = Math.min(this.height - 1, y2)
    for (let y = y1; y <= y2; y++) this.hline(x1, x2, y, c)
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

  paint(x: number, y: number, c = this.ink): void {
    const target = this.point(x, y)
    if (target < 0 || target === (c & this.colorMask())) return
    const stack = [[x, y] as [number, number]]
    while (stack.length > 0) {
      const [px, py] = stack.pop()!
      if (!this.inClip(px, py) || this.point(px, py) !== target) continue
      // find span
      let x1 = px
      while (x1 > 0 && this.point(x1 - 1, py) === target && this.inClip(x1 - 1, py)) x1--
      let x2 = px
      while (x2 < this.width - 1 && this.point(x2 + 1, py) === target && this.inClip(x2 + 1, py)) x2++
      this.hline(x1, x2, py, c)
      for (let sx = x1; sx <= x2; sx++) {
        if (py > 0 && this.point(sx, py - 1) === target) stack.push([sx, py - 1])
        if (py < this.height - 1 && this.point(sx, py + 1) === target) stack.push([sx, py + 1])
      }
    }
  }

  cls(c = this.paper, x1 = 0, y1 = 0, x2 = this.width - 1, y2 = this.height - 1): void {
    if (x1 === 0 && y1 === 0 && x2 === this.width - 1 && y2 === this.height - 1 && this.clip === null) {
      this.pixels.fill(c & this.colorMask())
    } else {
      this.bar(x1, y1, x2, y2, c)
    }
    this.curX = 0
    this.curY = 0
  }

  /** Draw one 8x8 glyph at pixel position; opaque paper unless transparent. */
  drawChar(px: number, py: number, ch: number, pen: number, paper: number, transparent = false): void {
    const glyph = FONT8[ch & 0xff] ?? FONT8[32]!
    for (let row = 0; row < 8; row++) {
      const bits = glyph[row]!
      for (let col = 0; col < 8; col++) {
        const on = (bits >> (7 - col)) & 1
        if (on) this.plot(px + col, py + row, pen)
        else if (!transparent) this.plot(px + col, py + row, paper)
      }
    }
  }

  /** Graphics text (Text x,y,s$): y is the baseline, drawn with ink. */
  text(x: number, y: number, s: string): void {
    for (let i = 0; i < s.length; i++) {
      this.drawChar(x + i * 8, y - 6, s.charCodeAt(i), this.ink, 0, true)
    }
  }

  // ---- text console ----

  putChar(ch: number): void {
    this.drawChar(this.curX * 8, this.curY * 8, ch, this.pen, this.paper)
    this.curX++
    if (this.curX >= this.cols) this.newline()
  }

  newline(): void {
    this.curX = 0
    this.curY++
    if (this.curY >= this.rows) {
      this.scrollUp(8)
      this.curY = this.rows - 1
    }
  }

  writeText(text: string): void {
    for (const ch of text) {
      const c = ch.charCodeAt(0)
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
        case 9: // tab — next multiple of 4 columns (WiTab default)
          this.curX = Math.min(this.cols - 1, (Math.floor(this.curX / 4) + 1) * 4)
          break
        case 12: // FF — clear
          this.cls()
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

  scrollUp(px: number): void {
    this.pixels.copyWithin(0, px * this.width)
    this.pixels.fill(this.paper & this.colorMask(), (this.height - px) * this.width)
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
        tmp[y * w + x] = sx >= 0 && sy >= 0 && sx < src.width && sy < src.height ? src.pixels[sy * src.width + sx]! : 0
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tx = dx + x
        const ty = dy + y
        if (tx >= 0 && ty >= 0 && tx < dst.width && ty < dst.height) {
          dst.pixels[ty * dst.width + tx] = tmp[y * w + x]!
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
