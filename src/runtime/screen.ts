import { FONT8 } from './font.gen'
import { AmosError } from '../interp/values'
import { glyphBit, glyphMetrics } from '../amiga/diskfont'
import type { DiskFont } from '../amiga/diskfont'
import { rowBytesFor } from '../amiga/planar'
import { BitMap, RastPort, type ClipRect } from '../amiga/graphics'

// ---- text-border glyphs (TEncadre +W.s:16725) -----------------------------
// Border$ draws its box out of the AMOS charset's own characters. Those
// bitmaps are not the ROM font's: AMOS pokes them over codes 0-31 and
// 128-159 from bin/+WFont.bin (+W.s:9640-9647), and genfont.ts bakes that
// binary into FONT8, so the glyphs these codes name are the real ones.
// Order per style: TL, top, TR, right, BR, bottom, BL, left.
const TENCADRE: number[][] = [
  [136, 137, 138, 139, 141, 137, 140, 139],
  [128, 129, 130, 132, 135, 134, 133, 131],
  [157, 1, 2, 3, 4, 5, 6, 7],
  [8, 9, 10, 11, 12, 13, 14, 15],
  [16, 17, 18, 19, 20, 21, 22, 23],
  [24, 25, 26, 158, 28, 29, 30, 31],
  [32, 32, 32, 32, 32, 32, 32, 32],
]

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

/** the default cursor shape: an underline (DefCurs +W.s:16736) */
export const CURSOR_SHAPE = [0, 0, 0, 0, 0, 0, 0xff, 0xff]

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
  /**
   * WiSys bit 1 (+W.s:13605): the cursor is a property of the WINDOW, not of
   * the screen. WOpen sets it on every window it creates (`bset #1,WiSys` at
   * +W.s:13778, right before its AffCur), so a Curs Off does not carry into
   * the next window a program opens, and two windows can disagree.
   */
  cursor: boolean
  /**
   * WiCuDraw: the cursor shape, eight bytes top row first, per window. WOpen
   * resets it to DefCurs rather than inheriting it (+W.s:13772-13778), and
   * Set Curs writes it for the current window only (WiSCur +W.s:14098).
   */
  curDraw: Uint8Array
  /**
   * WiFont (+Equ.s:686, `WiFont equ WiNext+4` — offset 8 into the window):
   * the 8x8 charset the CONSOLE prints with, 8 bytes a character indexed
   * straight by the byte, 2KB for the 256 of them.
   *
   * `null` is `T_JeuDefo`, the interpreter's own set, which is what WOpen
   * installs on every window it makes (`move.l T_JeuDefo(a3),WiFont(a5)`,
   * +W.s:13702) — so a new window does NOT inherit a replaced charset. The
   * only thing that replaces it is AMCAF's Change Print Font.
   */
  font8: Uint8Array | null
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
 * Amiga these live in the system mouse bank (SPat +W.s:4722), which the
 * runtime loads (fixtures/machine); these classic dithers only stand in
 * when no mouse bank was provided.
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
   * BITPLANES ARE THE BITMAP. The chunky array is a cache of them.
   *
   * This used to be the other way round — chunky was the drawing surface and
   * the planes were a mirror encoded on demand — which meant `Logbase` pokes,
   * bitplane extensions and anything reading a plane address were all served
   * a translation of the truth rather than the truth. Now `planarLog` and
   * `planarPhy` hold the pixels in the hardware's own layout, and everything
   * that wants a byte per pixel gets a derived view.
   *
   * The cache exists because plenty of code legitimately wants chunky —
   * `Point`, collision, `Zoom`, saving an IFF — and decoding per access would
   * be silly. It is a cache and not a second source of truth: `pixels` hands
   * back a read-only-by-contract view, `pixelsW()` is what a bulk chunky
   * writer takes (and says so), and a plane write invalidates it outright.
   *
   * Invariant: for each buffer, `valid` and `dirty` are never both set.
   * `valid` means the cache matches the planes; `dirty` means the cache has
   * writes the planes have not seen yet, and `flush()` is what settles them.
   */
  /**
   * The RastPort holds the LOGICAL bitmap and the drawing state; `phyBM` is
   * the physical one once Double Buffer has split them. Both bitmaps and all
   * twelve rp_ fields now live in ../amiga/graphics — this class keeps AMOS's
   * own half: the console, the windows, and the shapes whose implementations
   * are AMOS's rather than graphics.library's.
   */
  readonly rp: RastPort
  private phyBM: BitMap | null = null

  private get logBM(): BitMap {
    return this.rp.bitMap
  }

  /**
   * The LOGICAL buffer as chunky bytes. READ-ONLY by contract — writing
   * through this will be lost the next time the planes are touched. Bulk
   * writers take `pixelsW()` instead, which says what it is doing.
   */
  get pixels(): Uint8Array {
    return this.logBM.pixels
  }
  /** the logical chunky buffer, for a caller that is about to write to it */
  pixelsW(): Uint8Array {
    return this.logBM.pixelsW()
  }
  /** the PHYSICAL buffer when double-buffered (what the beam shows) */
  get back(): Uint8Array | null {
    return this.phyBM === null ? null : this.phyBM.pixels
  }
  /** the physical chunky buffer, for a caller that is about to write to it */
  backW(): Uint8Array | null {
    return this.phyBM === null ? null : this.phyBM.pixelsW()
  }

  /**
   * Screen Clone: share this screen's bitmaps rather than copy them.
   *
   * "Shared bitmap" is what the keyword means and now what it does. It used
   * to assign the chunky buffers across, which shared the cache but left each
   * screen its own planes — and the planes are the bitmap.
   */
  shareBitmapsFrom(src: Screen): void {
    this.rp.bitMap = src.rp.bitMap
    this.phyBM = src.phyBM
  }

  // ---- Amiga planar layout (faithful: Taille plan +W.s:1856) ----
  /** bytes per bitplane row = ceil(width/16)*2 (word-aligned) */
  get rowBytes(): number {
    return this.logBM.bytesPerRow
  }
  /** number of bitplanes = ceil(log2(nColors)) */
  readonly depth: number
  /** bytes per bitplane = rowBytes * height */
  get planeSize(): number {
    return this.logBM.planeSize
  }
  /** Autoback mode: 2 (default) = fully automatic, 0/1 = manual-ish */
  autoback = 2
  /**
   * The screen's own colour registers, 12-bit.
   *
   * 256 long, not 32: an eight-bitplane screen indexes all of them, and the
   * renderer no longer masks the index down to five bits. The first 32 are
   * AMOS's defaults and the rest start black, which is what a machine that
   * has never written the upper banks shows.
   */
  palette = ((): Uint16Array => {
    const p = new Uint16Array(256)
    p.set(DEFAULT_PALETTE)
    return p
  })()
  hires: boolean
  laced: boolean
  /** HAM6 (Screen Open with 4096 colours; CAMG bit $800) */
  ham: boolean
  /** extra-half-brite: 6 planes, lowres, not HAM — the hardware implies it */
  get ehb(): boolean {
    return !this.ham && this.depth === 6
  }
  visible = true
  /**
   * EcCon2's two playfield-priority fields (HsPri +W.s:11374). PF1P is bits
   * 0-2, PF2P bits 3-5; EcCree starts both at 4, every sprite pair in front.
   * These live on the screen, not the machine — two screens on the same
   * display can order sprites against their playfields differently.
   */
  pf1p = 4
  pf2p = 4
  /**
   * EcDual: which screen this one is paired with as a dual playfield, and
   * which half it is. The 68k packs both into one word (+EcDual, positive
   * for playfield 1 and -(partner+1) for playfield 2 — see HsPri's
   * neg/lsl walk back through T_EcAdr at +W.s:11374); split here for
   * legibility. null means an ordinary single-playfield screen.
   *
   * Pairing lives on the screens rather than on the machine because each
   * screen gets its own copper band, so several pairs can coexist down the
   * display.
   */
  dualPartner: number | null = null
  dualIsBack = false
  /** BPLCON2 PFBA: the back playfield draws in front (Dual Priority). */
  pf2Front = false
  /**
   * BPLCON2's low six bits — the sprite-versus-playfield priority fields,
   * PF1P0-2 and PF2P0-2. AMOS keeps them at `$4a` of the screen structure,
   * which is where AMCAF's Set Sprite Priority writes: `andi.w #$3f,d0 /
   * move.w d0,$4a(a0)` on the CURRENT screen, so it is per-screen state and
   * not a global. Nothing in the modelled display reads it yet.
   */
  spritePriority = 0
  /** display position in AMOS hardware coords (default 128,50 = top-left) */
  displayX = 128
  displayY = 50
  /** displayed-window size (Screen Display n,,,w,h → EcAWTx/EcAWTy); -1 = full */
  displayW = -1
  displayH = -1
  offsetX = 0
  offsetY = 0
  /*
   * The graphics state is the RastPort's. These accessors keep AMOS's names
   * on it — `Ink` sets three pens, `Gr Writing` a draw mode — so the keyword
   * implementations still read like the manual while the state itself has one
   * home. rp_ names are on the right of each pair.
   */
  get ink(): number {
    return this.rp.fgPen
  }
  set ink(v: number) {
    this.rp.fgPen = v
  }
  /** graphics background pen (Ink 2nd arg, BPen) — pattern 0-bits */
  get gPaper(): number {
    return this.rp.bgPen
  }
  set gPaper(v: number) {
    this.rp.bgPen = v
  }
  /** area outline pen (Ink 3rd arg, AOlPen) — Set Paint borders, Paint mode 1 */
  get gBorder(): number {
    return this.rp.aOlPen
  }
  set gBorder(v: number) {
    this.rp.aOlPen = v
  }
  /** Set Line: 16-bit line pattern, cycled per plotted pixel */
  get linePattern(): number {
    return this.rp.linePtrn
  }
  set linePattern(v: number) {
    this.rp.linePtrn = v
  }
  /** Set Paint: outline filled shapes with gBorder */
  get outline(): boolean {
    return this.rp.outline
  }
  set outline(v: boolean) {
    this.rp.outline = v
  }
  /** Set Pattern: 16-bit rows for area fills (null = solid) */
  get pattern(): Uint16Array | null {
    return this.rp.areaPtrn
  }
  set pattern(v: Uint16Array | null) {
    this.rp.areaPtrn = v
  }
  get grX(): number {
    return this.rp.cpX
  }
  set grX(v: number) {
    this.rp.cpX = v
  }
  get grY(): number {
    return this.rp.cpY
  }
  set grY(v: number) {
    this.rp.cpY = v
  }
  get clip(): ClipRect | null {
    return this.rp.clip
  }
  set clip(v: ClipRect | null) {
    this.rp.clip = v
  }
  // text state lives in windows; window 0 is the whole screen
  windows = new Map<number, Wind>()
  curWin: Wind
  /** Wind Save: subsequently opened windows save their background */
  windSave = false
  /** the CURRENT window's cursor flag — WiSys bit 1 of the window in hand */
  get cursorOn(): boolean {
    return this.curWin.cursor
  }
  set cursorOn(v: boolean) {
    this.curWin.cursor = v
  }
  /**
   * The text cursor lives IN the bitmap, as it does on the machine.
   *
   * AffCur (+W.s:13604) writes the cursor shape into the bitplanes and saves
   * the eight bytes per plane it covered; EffCur (+W.s:13642) puts them back.
   * The pair brackets every console operation — 32 call sites in W.s — so
   * between them the cursor is part of the picture.
   *
   * This used to be a compositor overlay, which is wrong in a way that shows:
   * an overlay is drawn on top of the finished frame every frame, so NOTHING
   * the program draws can cover it. eggit prints its message box, the box is
   * dismissed and the room repainted, and the cursor stayed floating over the
   * artwork for the rest of the game — the "shadow" that started this. In the
   * bitmap it is just pixels: the next Bar or Paint over that cell wipes it,
   * and it only comes back when the console next prints.
   *
   * One quirk comes with being faithful, and it is the machine's: EffCur puts
   * back what it SAVED, not what is there now. Draw over the cursor cell with
   * graphics and the next console operation restores the old eight bytes.
   *
   * Curs Off is clean, and the reason is worth recording because reading
   * `Curs` (+W.s:14818) alone says otherwise: it only clears the WiSys bit,
   * and EffCur is gated on that same bit, so it looks as though switching the
   * cursor off while it is displayed would strand it. It does not, because
   * Curs Off IS the escape ESC "C0" and every character goes through WOutC
   * (+W.s:15385), which is EffCur -> COut -> AffCur. The erase happens before
   * COut clears the bit. Hence `console()` below, and why the Curs On/Off
   * instruction has to go through it too.
   */
  private curSave = new Uint8Array(8 * 8)
  /** byte offset of the drawn cursor within a plane, or -1 when not drawn */
  private curDrawnAt = -1
  /** Gr Writing: 0 JAM1 (transparent), 1 JAM2, 2 XOR — rp_DrawMode */
  get grMode(): number {
    return this.rp.drawMode
  }
  set grMode(v: number) {
    this.rp.drawMode = v
  }
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
    this.depth = Math.max(1, Math.ceil(Math.log2(Math.max(2, nColors))))
    // rowBytesFor rounds a row up to a whole word — the SCREEN's convention;
    // a sprite bank truncates instead, and BitMap takes whichever it is told
    this.rp = new RastPort(new BitMap(width, height, this.depth, rowBytesFor(width)))
    this.hires = (mode & 0x8000) !== 0
    this.ham = (mode & 0x800) !== 0
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
      cursor: true,
      curDraw: Uint8Array.from(CURSOR_SHAPE),
      font8: null,
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

  /**
   * The bitplanes at Logbase/Phybase. These are the real bytes, not a mirror
   * made for the occasion — the only thing to settle first is a bulk chunky
   * write that has not been flushed yet. `write` invalidates the chunky cache,
   * because a plane poke changes pixels the cache cannot know about.
   */
  planarView(kind: 'log' | 'phy', write: boolean): Uint8Array {
    // single-buffered Phybase aliases the logical bitmap, as on the hardware
    const bm = kind === 'phy' && this.phyBM !== null ? this.phyBM : this.logBM
    return bm.planeBytes(write)
  }

  /** true once Double Buffer has split the physical bitmap from the logical */
  get doubleBuffered(): boolean {
    return this.phyBM !== null
  }

  /** Double Buffer: create the physical bitmap as a copy of the logical */
  doubleBuffer(): void {
    if (this.phyBM !== null) return
    this.phyBM = this.logBM.clone()
  }

  /** Screen Swap: exchange logical and physical. A pointer swap now. */
  swap(): void {
    if (this.phyBM === null) return
    const t = this.rp.bitMap
    this.rp.bitMap = this.phyBM
    this.phyBM = t
  }

  /** the buffer the display shows */
  get displayBuffer(): Uint8Array {
    // with autoback 2 both buffers are kept identical on the real
    // machine — showing the logical buffer is equivalent
    return this.back !== null && this.autoback === 0 ? this.back : this.pixels
  }

  /**
   * Buffer selection for Logic()/Physic() screen ids.
   *
   * `write` matters now that the planes are the bitmap: a caller that only
   * reads gets the cache as it stands, and one that writes has to say so, or
   * its pixels never reach the planes and Logbase serves stale bytes.
   */
  bufferFor(kind: 'logic' | 'physic', write = false): Uint8Array {
    if (this.back === null) return write ? this.pixelsW() : this.pixels
    const wantLog = kind === 'logic' || this.displayBuffer === this.pixels
    if (wantLog) return write ? this.pixelsW() : this.pixels
    return (write ? this.backW() : this.back)!
  }

  /** text columns/rows of the CURRENT WINDOW */
  get cols(): number {
    return this.curWin.cols
  }

  get rows(): number {
    return this.curWin.rows
  }


  /**
   * rp_Mask, the RastPort write mask — which bitplanes a write may touch.
   * All ones until TURBO's `Set Planes` narrows it: "Restricts most drawing
   * operations to a number of bitplanes, defined by the MASK parameter. Each
   * bit represents a bitplane."
   */
  get planeMask(): number {
    return this.rp.mask
  }
  set planeMask(v: number) {
    this.rp.mask = v
  }

  /**
   * Per-plane display offsets, in bytes, as TURBO's `Plane Offset` sets them
   * and `Plane Update` applies them — null while every plane is at zero,
   * which is the case that has to stay free.
   *
   * The routine biases the bitplane pointers the copper reads and puts them
   * straight back ("In fact I don't change the bitplane addresses at all"),
   * so this belongs to the display and not to the drawing surface: a plane's
   * pixels move on screen while Point and every drawing keyword carry on
   * seeing the buffer as it is.
   */
  planeOffsets: Int32Array | null = null

  /**
   * The pixel the display shows at (x,y) once plane offsets are in play.
   * A plane's offset is a byte offset into a linear bitplane, so it moves
   * that plane's bits eight pixels per byte and runs on into the rows below.
   */
  offsetPixel(buf: Uint8Array, y: number, x: number): number {
    const off = this.planeOffsets
    const base = y * this.width + x
    if (!off) return buf[base]!
    let v = 0
    for (let p = 0; p < this.depth; p++) {
      const at = base + off[p]! * 8
      // past either end of the plane the real one reads whatever is there
      if (at >= 0 && at < buf.length) v |= buf[at]! & (1 << p)
    }
    return v
  }

  /** apply the write mask: bits it excludes keep what the pixel already had */
  /** the pens this depth can hold — AMOS's shapes clamp against it too */
  private colorMask(): number {
    return (1 << this.depth) - 1
  }

  private masked(old: number, next: number): number {
    return this.rp.masked(old, next)
  }

  inClip(x: number, y: number): boolean {
    return this.rp.inClip(x, y)
  }

  /**
   * The single pixel primitive. Everything else — line, box, bar, ellipse,
   * fillPolygon, paint, cls, drawChar — reaches the bitmap through this or
   * through `hline`, which is why the planar flip is two functions rather
   * than a rewrite of the drawing API.
   */

  /**
   * Hardware coordinates to this screen's own, and back (SyZoHd, and AMAL's
   * X Screen / Y Screen / X Hard / Y Hard).
   *
   * X is not symmetric with Y: a hires screen shows two pixels per colour
   * clock, so hardware X scales by two coming in and divides (truncating)
   * going out, while Y is a plain offset. Both then shift by the screen's own
   * scroll offset.
   *
   * This was written out longhand in eight places -- instr.ts x4, sticks.ts,
   * turbo.ts, runtime.ts x2 -- plus the AmalHost.xy switch, which was the only
   * caller of anything resembling a helper. Every field it needs belongs to a
   * Screen, so it belongs here.
   */
  hardToScreenX(hx: number): number {
    return (hx - this.displayX) * (this.hires ? 2 : 1) + this.offsetX
  }
  hardToScreenY(hy: number): number {
    return hy - this.displayY + this.offsetY
  }
  screenToHardX(sx: number): number {
    return this.displayX + Math.trunc((sx - this.offsetX) / (this.hires ? 2 : 1))
  }
  screenToHardY(sy: number): number {
    return this.displayY + (sy - this.offsetY)
  }

  plot(x: number, y: number, c = this.ink): void {
    if (!this.inClip(x, y)) return
    // COMPLEMENT and a partial write mask both need the old pixel; a plain
    this.rp.plot(x, y, c)
  }

  point(x: number, y: number): number {
    return this.rp.point(x, y)
  }

  hline(x1: number, x2: number, y: number, c = this.ink): void {
    this.rp.hline(x1, x2, y, c)
  }

  /**
   * Keep the chunky cache in step with a single planar write.
   *
   * Write-through rather than invalidate: a plot would otherwise throw away
   * the whole cache and the next Point would decode the entire bitmap to
   * read one pixel back.
   */
  /** write an already-merged pixel value into the planes */
  putPixel(x: number, y: number, v: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    this.logBM.writePixel(x, y, v)
  }



  /** Draw, with Set Line's pattern — the graphics cursor is rp_cp_x/y */
  line(x1: number, y1: number, x2: number, y2: number, c = this.ink): void {
    this.rp.draw(x1, y1, x2, y2, c)
  }

  /**
   * InBox (+Lib.s:9702): ONE PolyDraw starting just below the top-left
   * corner — the Set Line dash pattern runs continuously around the box
   * and the start corner pixel is not double-drawn.
   */
  box(x1: number, y1: number, x2: number, y2: number, c = this.ink): void {
    let sy = y1 + 1
    if (sy >= y2) sy = y1 - 1
    this.rp.linePatCnt = 15
    this.rp.linePtrnCont = true
    this.line(x1, sy, x1, y2, c)
    this.line(x1, y2, x2, y2, c)
    this.line(x2, y2, x2, y1, c)
    this.line(x2, y1, x1, y1, c)
    this.rp.linePtrnCont = false
  }

  bar(x1: number, y1: number, x2: number, y2: number, c = this.ink): void {
    if (x1 > x2) [x1, x2] = [x2, x1]
    if (y1 > y2) [y1, y2] = [y2, y1]
    const cy1 = Math.max(0, y1)
    const cy2 = Math.min(this.height - 1, y2)
    if (this.pattern === null) {
      this.rp.rectFill(x1, y1, x2, y2, c)
    } else {
      // rp_AreaPtrn is AMOS's Set Pattern here: the 0-bits take the graphics
      // paper rather than being left alone, which is why this is not RectFill
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
    this.rp.ellipse(cx, cy, rx, ry, c, fill)
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

  /**
   * Paint x,y[,mode] — flood fill (TPaint, +W.s:4333).
   *
   * The fill runs over a mask, never over the screen. TPaint blits one into a
   * tempras first (PMask, +W.s:4657, under the comment "Met a UN toutes les
   * couleurs AUTRES" — set to ONE every colour *other* than the seed's), then
   * walks it: `btst d7,(a0)` at Pnt3/Pnt5 asks whether a pixel is available
   * and `bset d7,(a0)` at Pnt7 marks it done. The comparison colour is always
   * the colour under the seed, read by L_RPoint before the call
   * (+Lib.s:9962).
   *
   * Keeping the visited flags off the screen is what makes the fill
   * terminate. Testing the pixels instead only works while a filled pixel
   * reliably becomes `c` — which is true of Gr Writing 0 and false of
   * Gr Writing 2, where plot() xors and the result is whatever it was ^ c.
   * The fill would then find its own output still fillable and never finish:
   * `_rndcircles2.amos` on the AMOS PD Library CD (APD503) took 2 GB of heap
   * in ten seconds that way.
   *
   * One byte per pixel here against the original's one bit — the same idea,
   * bounded by the clip region either way, and TPaint refuses a region larger
   * than its tempras outright (+W.s:4380).
   */
  paint(x: number, y: number, c = this.ink, borderMode = false): void {
    const target = this.point(x, y)
    if (target < 0) return
    const border = this.gBorder & this.colorMask()
    // outside the clip is not painted at all, as TPaint bails on the same
    // four comparisons before it allocates anything (+W.s:4341-4348). They
    // are its only early exits besides a null tempras — there is no test for
    // the seed already being the fill colour, and there cannot usefully be
    // one: under Gr Writing 2 painting c over c writes 0, which is a real
    // change. Skipping it as a no-op is only right when plot() replaces.
    if (!this.inClip(x, y)) return

    const cl = this.clip
    const cx0 = Math.max(0, cl?.x1 ?? 0)
    const cy0 = Math.max(0, cl?.y1 ?? 0)
    const cx1 = Math.min(this.width - 1, cl?.x2 ?? this.width - 1)
    const cy1 = Math.min(this.height - 1, cl?.y2 ?? this.height - 1)
    const w = cx1 - cx0 + 1

    // 1 = unavailable: a different colour to the seed (mode 1), or the border
    // colour (mode 0, Flood's OUTLINE). Built once, from the screen as it
    // stands; the fill then sets a bit per pixel it takes, so nothing here
    // needs to describe what has already been painted.
    const blocked = new Uint8Array(w * (cy1 - cy0 + 1))
    for (let py = cy0; py <= cy1; py++) {
      for (let px = cx0; px <= cx1; px++) {
        const v = this.pixels[py * this.width + px]!
        const open = borderMode ? v !== border : v === target
        if (!open) blocked[(py - cy0) * w + (px - cx0)] = 1
      }
    }
    const at = (px: number, py: number): number => (py - cy0) * w + (px - cx0)

    // x and y interleaved rather than a pair per entry: the stack can hold one
    // seed per run per row, and an array each would be the bulk of the cost
    const stack: number[] = [x, y]
    while (stack.length > 0) {
      const py = stack.pop()!
      const px = stack.pop()!
      if (blocked[at(px, py)] === 1) continue
      let x1 = px
      while (x1 > cx0 && blocked[at(x1 - 1, py)] === 0) x1--
      let x2 = px
      while (x2 < cx1 && blocked[at(x2 + 1, py)] === 0) x2++
      for (let sx = x1; sx <= x2; sx++) blocked[at(sx, py)] = 1
      this.hline(x1, x2, py, c)
      // one seed where a run starts, not one per column: TPaint pushes only on
      // the transition into an available pixel, which is what the bclr/bset
      // #15,d5 edge flag at Pnt5/Pnt6 is tracking
      for (const ny of [py - 1, py + 1]) {
        if (ny < cy0 || ny > cy1) continue
        let inRun = false
        for (let sx = x1; sx <= x2; sx++) {
          const open = blocked[at(sx, ny)] === 0
          if (open && !inRun) stack.push(sx, ny)
          inRun = open
        }
      }
    }
  }

  /**
   * Cls c[,region] (EcCls +W.s:3660): clears the screen or a pixel region.
   * It does NOT home the text cursor — only Clw (Cls with no argument) does.
   */
  cls(c = this.paper, x1 = 0, y1 = 0, x2 = this.width - 1, y2 = this.height - 1): void {
    if (x1 === 0 && y1 === 0 && x2 === this.width - 1 && y2 === this.height - 1 && this.clip === null) {
      // whole screen: fill each plane outright rather than going row by row.
      // The write mask still applies — Cls through a partial planeMask has to
      // leave the excluded planes standing.
      const v = c & this.colorMask()
      const planes = this.logBM.planeBytes(true)
      for (let p = 0; p < this.depth; p++) {
        if ((this.planeMask & (1 << p)) === 0) continue
        planes.fill(v & (1 << p) ? 0xff : 0x00, p * this.planeSize, (p + 1) * this.planeSize)
      }
      // planeBytes(write) has already dropped the cache. With every plane
      // written the answer is uniform and can simply be refilled; a partial
      // mask would need the old pixels merged in, so it stays dropped and the
      // next read decodes
      if (this.planeMask === 0xff) this.logBM.refillCache(v)
    } else {
      this.bar(x1, y1, x2, y2, c)
    }
  }

  /** SoftStyle for the graphics Text instruction (Set Text, +Lib.s:9908) */
  textStyle = 0

  /** Draw one 8x8 glyph honouring the window Writing modes and styles. */
  drawChar(px: number, py: number, ch: number, pen: number, paper: number, transparent = false, styleFrom?: number, clipped = false): void {
    const w = this.curWin
    if (w.writing1 === 4) return // IGNORE
    if (w.inverse) {
      const t = pen
      pen = paper
      paper = t
    }
    // COut (+W.s:15661) is `lsl.w #3,d1 / move.l WiFont(a5),a2 / add.w d1,a2`
    // — the charset is indexed by the raw byte, and Change Print Font can
    // have replaced it with a 2KB bank
    const glyph = w.font8 ? w.font8.subarray((ch & 0xff) * 8, (ch & 0xff) * 8 + 8) : (FONT8[ch & 0xff] ?? FONT8[32]!)
    const bg = w.writing2 === 2 ? 0 : paper
    const style = styleFrom ?? w.style
    for (let row = 0; row < 8; row++) {
      // a Change Print Font bank shorter than the 2KB the manual demands
      // reads off its end on the machine; here it prints blank
      let bits = glyph[row] ?? 0
      if (style & 2) bits |= bits >> 1 // bold
      if (style & 4) bits = row < 4 ? (bits >> 1) & 0xff : bits // italic (slanted top)
      if (style & 1 && row === 7) bits = 0xff // underline
      if (w.shade) bits &= row & 1 ? 0x55 : 0xaa // dither mask
      for (let col = 0; col < 8; col++) {
        const x = px + col
        const y = py + row
        const on = (bits >> (7 - col)) & 1
        if (on) {
          if (w.writing2 === 1) continue // paper only
          this.writeMode(x, y, pen, w.writing1, clipped)
        } else if (!transparent) {
          this.writeMode(x, y, bg, w.writing1, clipped)
        }
      }
    }
  }

  /**
   * Apply a Writing mode: 0 replace, 1 OR, 2 XOR, 3 AND.
   * NOT clip-tested: this is the console character blitter's write — on
   * the real machine the AMOS console writes straight to the bitplanes,
   * bypassing the layer ClipRegion that Clip installs (Ec_SetClip
   * +W.s:4259 clips rastport graphics only). Eggit2 relies on printing
   * status text OUTSIDE its play-area Clip.
   */
  private writeMode(x: number, y: number, c: number, mode: number, clipped = false): void {
    if (clipped && !this.inClip(x, y)) return
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const old = this.point(x, y)
    switch (mode) {
      case 1:
        this.putPixel(x, y, this.masked(old, old | c))
        break
      case 2:
        this.putPixel(x, y, this.masked(old, old ^ c))
        break
      case 3:
        this.putPixel(x, y, this.masked(old, old & c))
        break
      default:
        this.putPixel(x, y, this.masked(old, c))
    }
  }

  /**
   * The graphics font set by Set Font (TSFont) — null = the built-in 8x8 face.
   *
   * This IS `rp_Font`, and says so rather than shadowing it. There were two
   * fields: a `font` here that Set Font wrote and `Text` read, and the
   * RastPort's, which nothing on an AMOS screen ever assigned — so AMCAF's
   * `=Font Style`, which reads `movea.l $34(a1),a1` off the RastPort, could
   * only ever answer 0. AMCAF's Change Font and Change Bank Font both end in
   * graphics.library SetFont (`jsr -$42(a6)`), so they have to land on the
   * same field Set Font does, and on the Amiga there is only ever one.
   */
  get font(): DiskFont | null {
    return this.rp.font
  }
  set font(f: DiskFont | null) {
    this.rp.font = f
  }

  /** Graphics text (Text x,y,s$): y is the baseline, drawn with ink. */
  text(x: number, y: number, s: string): void {
    const f = this.font
    if (!f) {
      for (let i = 0; i < s.length; i++) {
        this.drawChar(x + i * 8, y - 6, s.charCodeAt(i), this.ink, 0, true, this.textStyle, true)
      }
      return
    }
    // real diskfont glyphs: pen offset (kern), bit-span width, per-char
    // advance, glyph top = baseline - tf_Baseline (graphics.library Text)
    const w = this.curWin
    if (w.writing1 === 4) return // IGNORE
    let penX = x
    const top = y - f.baseline
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i)
      const m = glyphMetrics(f, ch)
      for (let gy = 0; gy < f.ySize; gy++) {
        for (let gx = 0; gx < m.width; gx++) {
          if (glyphBit(f, ch, gx, gy)) this.writeMode(penX + m.kern + gx, top + gy, this.ink, w.writing1, true)
        }
      }
      penX += m.advance
    }
  }

  /** Text Length with the current graphics font (TextLength sums advances) */
  measureText(s: string): number {
    const f = this.font
    if (!f) return s.length * 8
    let len = 0
    for (let i = 0; i < s.length; i++) len += glyphMetrics(f, s.charCodeAt(i)).advance
    return len
  }

  // ---- text console (window-relative) ----

  putChar(ch: number): void {
    this.console(() => this.putCharInner(ch))
  }

  private putCharInner(ch: number): void {
    const w = this.curWin
    this.drawChar(w.x + w.curX * 8, w.y + w.curY * 8, ch, w.pen, w.paper)
    w.curX++
    if (w.curX >= w.cols) this.newline()
  }

  newline(): void {
    this.console(() => this.newlineInner())
  }

  private newlineInner(): void {
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
    this.console(() => this.writeTextInner(text))
  }

  private writeTextInner(text: string): void {
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
            this.setPenChecked(arg(1))
            ti += 2
            break
          case 'B':
            this.setPaperChecked(arg(1))
            ti += 2
            break
          case 'E':
            // Encadre (+W.s:15169): 0 stores the border start, a style
            // number draws the box around the printed text
            if (arg(1) === 0) {
              this.encX = w.curX
              this.encY = w.curY
            } else {
              this.drawTextBorder(arg(1))
            }
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
        case 7: // ClEol — clear to the end of the cursor line (+W.s:14452)
          this.clEol()
          break
        case 12: // Home — cursor to top-left, NO clear (ChHom in +Lib.s)
        case 24: // ...and again at 24, which CCont maps to the same routine
          this.curX = 0
          this.curY = 0
          break
        // window scrolls (+W.s:16588-16595): Hscroll/Vscroll print these
        case 16: // cursor line one character left (ScGLine +W.s:14541)
          this.winHScroll(-1, true)
          break
        case 17: // whole window left (ScGWi)
          this.winHScroll(-1, false)
          break
        case 18: // cursor line right (ScDLine)
          this.winHScroll(1, true)
          break
        case 19: // whole window right (ScDWi)
          this.winHScroll(1, false)
          break
        case 20: // lines from the cursor down move DOWN one; cursor line cleared (ScBas)
          this.winVScroll(1)
          break
        case 21: // lines above the cursor move DOWN one; top line cleared (ScBasHaut)
          this.winVScroll(2)
          break
        case 22: // lines down to the cursor move UP one; cursor line cleared (ScHaut)
          this.winVScroll(3)
          break
        case 23: // lines below the cursor move UP one; bottom line cleared (ScHautBas)
          this.winVScroll(4)
          break
        case 25: // Clw — clear the window (ChClw)
          this.clw()
          break
        case 26: // ClLine — clear the cursor line (+W.s:14495)
          this.clLine()
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

  /**
   * AffCur (+W.s:13604): draw the cursor into the bitmap and save what it
   * covered. Per plane, the cursor colour's bit decides OR (set) or AND-NOT
   * (clear) — AfC2/AfC3 shift WiCuCol right one bit per plane.
   */
  private affCur(): void {
    if (this.curDrawnAt >= 0 || !this.cursorOn) return
    const w = this.curWin
    const x0 = w.x + w.curX * 8
    const y0 = w.y + w.curY * 8
    if (x0 < 0 || y0 < 0 || x0 + 8 > this.width || y0 + 8 > this.height) return
    // the planes directly, then the chunky cache pixel by pixel — 64 pixels
    // is far cheaper than invalidating the cache and re-decoding the screen,
    // which is what planarView(write) would do here
    const planes = this.logBM.planeBytes()
    const off = y0 * this.rowBytes + (x0 >> 3)
    for (let p = 0; p < this.depth; p++) {
      const base = p * this.planeSize + off
      const set = (w.cuCol >> p) & 1
      for (let r = 0; r < 8; r++) {
        const at = base + r * this.rowBytes
        const was = planes[at] ?? 0
        this.curSave[p * 8 + r] = was
        const bits = w.curDraw[r]!
        planes[at] = set ? was | bits : was & ~bits & 0xff
      }
    }
    this.curDrawnAt = off
    this.refreshCell(x0, y0)
  }

  /** re-derive the chunky cache for one 8x8 character cell */
  private refreshCell(x0: number, y0: number): void {
    this.logBM.refreshRect(x0, y0, 8, 8)
  }

  /**
   * EffCur (+W.s:13642): put back the bytes AffCur saved. Gated on the cursor
   * flag exactly as the 68k is, which is why Curs Off freezes the cursor into
   * the bitmap instead of erasing it.
   */
  private effCur(): void {
    if (this.curDrawnAt < 0 || !this.cursorOn) return
    const planes = this.logBM.planeBytes()
    for (let p = 0; p < this.depth; p++) {
      const base = p * this.planeSize + this.curDrawnAt
      for (let r = 0; r < 8; r++) planes[base + r * this.rowBytes] = this.curSave[p * 8 + r]!
    }
    const y0 = Math.floor(this.curDrawnAt / this.rowBytes)
    const x0 = (this.curDrawnAt % this.rowBytes) * 8
    this.curDrawnAt = -1
    this.refreshCell(x0, y0)
  }

  /**
   * Run a console operation with the cursor lifted out of the bitmap and put
   * back after — the EffCur/AffCur bracket the 68k writes around each of them.
   * GRAPHICS operations deliberately do not use this: on the machine they draw
   * straight over the cursor, and that is what makes the cursor coverable.
   */
  console<T>(op: () => T): T {
    // re-entrant: writeText -> putChar -> newline -> scrollUp are all console
    // operations, and only the outermost may lift and replace the cursor
    if (this.consoleDepth++ === 0) this.effCur()
    try {
      return op()
    } finally {
      if (--this.consoleDepth === 0) this.affCur()
    }
  }
  private consoleDepth = 0

  /**
   * Set Curs (InSetCurs +Lib.s:13261 -> WiSCur +W.s:14098): eight bytes into
   * the current window's WiCuDraw, bracketed by EffCur/AffCur so the shape
   * that is on screen changes with it. The 68k takes the arguments as
   * longwords and stores them with move.b, so each is simply truncated.
   */
  setCursShape(rows: readonly number[]): void {
    this.console(() => {
      for (let r = 0; r < 8; r++) this.curWin.curDraw[r] = (rows[r] ?? 0) & 0xff
    })
  }

  /**
   * Loca (+W.s:15364): coordinates outside the window's text area raise
   * window error 16 -> "Illegal text window parameter" (error 60).
   */
  locate(x: number, y: number): void {
    if (x >= this.cols || y >= this.rows) throw new AmosError('illegal text window parameter', 60)
    this.console(() => {
      if (x >= 0) this.curX = x
      if (y >= 0) this.curY = y
    })
  }

  /** the Pen/Paper escapes error above the screen colour count (+W.s:14893) */
  setPenChecked(n: number): void {
    if (n < 0 || n >= this.nColors) throw new AmosError('illegal text window parameter', 60)
    this.curWin.pen = n
  }

  setPaperChecked(n: number): void {
    if (n < 0 || n >= this.nColors) throw new AmosError('illegal text window parameter', 60)
    this.curWin.paper = n
  }

  /** Border$ start position (T_WiEncDX/DY — a task global on the 68k) */
  private encX = 0
  private encY = 0

  /**
   * Enc (+W.s:15182): draw the TEncadre style box from the stored start
   * to the current cursor; nothing is drawn when no column was printed.
   * The cursor is left where it was.
   */
  private drawTextBorder(n: number): void {
    const style = n & 7
    if (style === 0) return // the 68k would read garbage before the table
    const w = this.curWin
    if (w.curX - this.encX - 1 < 0) return // no column printed: skip (EncFin)
    if (w.curY - this.encY < 0) return
    const g = TENCADRE[style - 1]!
    const [tl, t, tr, r, br, b, bl, l] = g as [number, number, number, number, number, number, number, number]
    const put = (cx: number, cy: number, code: number): void => {
      if (cx < 0 || cy < 0 || cx >= w.cols || cy >= w.rows) return
      this.drawChar(w.x + cx * 8, w.y + cy * 8, code, w.pen, w.paper)
    }
    const x1 = this.encX - 1
    const y1 = this.encY - 1
    const x2 = w.curX
    const y2 = w.curY + 1
    put(x1, y1, tl)
    for (let cx = this.encX; cx < x2; cx++) put(cx, y1, t)
    put(x2, y1, tr)
    for (let cy = this.encY; cy <= w.curY; cy++) {
      put(x2, cy, r)
      put(x1, cy, l)
    }
    put(x2, y2, br)
    for (let cx = this.encX; cx < x2; cx++) put(cx, y2, b)
    put(x1, y2, bl)
  }

  /** raw paper-colour fill of a window region (the blit fills/ClFin) */
  private winFill(x: number, y: number, w: number, h: number, c: number): void {
    const px = this.pixelsW()
    for (let yy = y; yy < y + h; yy++) {
      if (yy < 0 || yy >= this.height) continue
      const row = yy * this.width
      for (let xx = x; xx < x + w; xx++) if (xx >= 0 && xx < this.width) px[row + xx] = c
    }
  }

  /**
   * Hscroll: shift the cursor line (or the whole window) one CHARACTER
   * left/right; the vacated column fills with paper (ScGLine/ScGWi/
   * ScDLine/ScDWi +W.s:14539-14655).
   */
  private winHScroll(dir: number, lineOnly: boolean): void {
    const w = this.curWin
    const y1 = lineOnly ? w.y + w.curY * 8 : w.y
    const h = lineOnly ? 8 : w.rows * 8
    const x1 = w.x
    const wpx = w.cols * 8
    if (dir < 0) {
      Screen.copy(this, x1 + 8, y1, x1 + wpx, y1 + h, this, x1, y1)
      this.winFill(x1 + wpx - 8, y1, 8, h, w.paper)
    } else {
      Screen.copy(this, x1, y1, x1 + wpx - 8, y1 + h, this, x1 + 8, y1)
      this.winFill(x1, y1, 8, h, w.paper)
    }
  }

  /**
   * Vscroll region scrolls (+W.s:14657-14760):
   *  1 ScBas     — cursor..bottom-1 move down one line, cursor line cleared
   *  2 ScBasHaut — top..cursor-1 move down one line, top line cleared
   *  3 ScHaut    — 1..cursor move up one line, cursor line cleared
   *  4 ScHautBas — cursor+1..bottom move up one line, bottom line cleared
   */
  private winVScroll(kind: number): void {
    const w = this.curWin
    const x1 = w.x
    const wpx = w.cols * 8
    const top = w.y
    const cy = w.y + w.curY * 8
    const bottom = w.y + w.rows * 8
    switch (kind) {
      case 1:
        Screen.copy(this, x1, cy, x1 + wpx, bottom - 8, this, x1, cy + 8)
        this.winFill(x1, cy, wpx, 8, w.paper)
        break
      case 2:
        Screen.copy(this, x1, top, x1 + wpx, cy, this, x1, top + 8)
        this.winFill(x1, top, wpx, 8, w.paper)
        break
      case 3:
        Screen.copy(this, x1, top + 8, x1 + wpx, cy + 8, this, x1, top)
        this.winFill(x1, cy, wpx, 8, w.paper)
        break
      default:
        Screen.copy(this, x1, cy + 8, x1 + wpx, bottom, this, x1, cy)
        this.winFill(x1, bottom - 8, wpx, 8, w.paper)
    }
  }

  /** scroll the CURRENT WINDOW's text area up by px pixels */
  /**
   * Scroll the current window up by `px` pixels.
   *
   * Plane block moves, not a pixel loop. Text windows are character-aligned,
   * so w.x and cols*8 are both multiples of 8 and every row copy is a whole
   * number of bytes — the case that would need bit shifting cannot arise.
   */
  scrollUp(px: number): void {
    const w = this.curWin
    const wPix = w.cols * 8
    const hPix = w.rows * 8
    const paper = w.paper & this.colorMask()
    const full = w.x === 0 && w.y === 0 && wPix === this.width && hPix === this.height
    const planes = this.logBM.planeBytes(true)
    for (let p = 0; p < this.depth; p++) {
      const base = p * this.planeSize
      const on = (paper & (1 << p)) !== 0 ? 0xff : 0x00
      if (full) {
        planes.copyWithin(base, base + px * this.rowBytes, base + this.planeSize)
        planes.fill(on, base + (this.height - px) * this.rowBytes, base + this.planeSize)
        continue
      }
      const x0 = w.x >> 3
      const nBytes = wPix >> 3
      for (let y = 0; y < hPix - px; y++) {
        const src = base + (w.y + y + px) * this.rowBytes + x0
        planes.copyWithin(base + (w.y + y) * this.rowBytes + x0, src, src + nBytes)
      }
      for (let y = hPix - px; y < hPix; y++) {
        const at = base + (w.y + y) * this.rowBytes + x0
        planes.fill(on, at, at + nBytes)
      }
    }
    // planeBytes(write) already dropped the cache: a block move rewrites more
    // pixels than it is worth tracking, and the next read decodes
  }

  /** Clw: clear the current window's text area and home the cursor */
  clw(): void {
    this.console(() => this.clwInner())
  }

  private clwInner(): void {
    const w = this.curWin
    // byte-aligned like scrollUp, for the same reason: text windows sit on
    // character boundaries
    const paper = w.paper & this.colorMask()
    const x0 = w.x >> 3
    const nBytes = (w.cols * 8) >> 3
    const planes = this.logBM.planeBytes(true)
    for (let p = 0; p < this.depth; p++) {
      const base = p * this.planeSize
      const on = (paper & (1 << p)) !== 0 ? 0xff : 0x00
      for (let y = 0; y < w.rows * 8; y++) {
        const at = base + (w.y + y) * this.rowBytes + x0
        planes.fill(on, at, at + nBytes)
      }
    }
    w.curX = 0
    w.curY = 0
  }

  /**
   * Clear a run of character cells on one text row, in the window's paper.
   *
   * The shape ClEol, ClLine and Clw all share: `ClFin` (+W.s:14503) takes a
   * start address, a height in pixels and a WIDTH IN CHARACTERS, and the three
   * callers differ only in what they pass. A character is eight pixels, so a
   * character count is a byte count in every plane.
   */
  private clRun(row: number, col: number, cols: number): void {
    const w = this.curWin
    const n = Math.min(cols, w.cols - col)
    if (n <= 0 || row < 0 || row >= w.rows) return
    const paper = w.paper & this.colorMask()
    const x0 = (w.x >> 3) + col
    const planes = this.logBM.planeBytes(true)
    for (let p = 0; p < this.depth; p++) {
      const base = p * this.planeSize
      const on = (paper & (1 << p)) !== 0 ? 0xff : 0x00
      for (let y = 0; y < 8; y++) {
        const at = base + (w.y + row * 8 + y) * this.rowBytes + x0
        planes.fill(on, at, at + n)
      }
    }
  }

  /**
   * ClEol (+W.s:14452) — clear from the cursor to the right edge of the line.
   *
   * The count it passes to ClFin is `WiX`, which is NOT the cursor column:
   * `AdCurs` (+W.s:15601) derives the column as `WiTx - WiX`, `CRight`
   * DECREMENTS it, and `Home` sets it to `WiTx`. So WiX is the number of
   * cells from the cursor to the right edge, the cursor's own included, and
   * passing it is exactly a clear-to-end-of-line.
   *
   * The routine's odd-address branch is a blitter constraint with nothing
   * behind it here: an odd `WiAdCur` cannot start a word blit, so it erases
   * the cursor's own byte with RazCur first and blits from the next one.
   */
  clEol(): void {
    this.console(() => this.clRun(this.curWin.curY, this.curWin.curX, this.curWin.cols))
  }

  /** ClLine (+W.s:14495) — the whole cursor line, cursor left where it is */
  clLine(): void {
    this.console(() => this.clRun(this.curWin.curY, 0, this.curWin.cols))
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
    return this.console(() => this.windOpenInner(n, x, y, cols, rows, border))
  }

  private windOpenInner(n: number, x: number, y: number, cols: number, rows: number, border: number): Wind {
    if (this.windows.has(n) && n !== 0) throw new AmosError('Text window already opened', 55)
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
      // WOpen turns the cursor on for the window it creates, whatever the
      // window it was opened from had, and resets the shape to DefCurs
      // rather than inheriting it (Wo4 +W.s:13772-13778)
      cursor: true,
      curDraw: Uint8Array.from(CURSOR_SHAPE),
      // WOpen re-installs T_JeuDefo rather than inheriting src.font8
      font8: null,
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
    this.console(() => this.windCloseInner())
  }

  private windCloseInner(): void {
    const w = this.curWin
    if (w.n === 0) return
    if (w.savedBg) {
      const bg = w.savedBg
      for (let yy = 0; yy < bg.h; yy++) {
        for (let xx = 0; xx < bg.w; xx++) {
          const px = bg.x + xx
          const py = bg.y + yy
          if (px >= 0 && py >= 0 && px < this.width && py < this.height) {
            this.putPixel(px, py, bg.data[yy * bg.w + xx]!)
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
    this.console(() => this.selectWindowInner(n))
  }

  private selectWindowInner(n: number): void {
    const w = this.windows.get(n)
    if (!w) throw new AmosError('Text window not opened', 54)
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
