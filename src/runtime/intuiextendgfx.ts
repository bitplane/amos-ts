/**
 * IntuiExtend 2.01b, the drawing and text group.
 *
 * What separates this group from the 3D one is the argument: every keyword
 * here takes a RastPort ADDRESS and calls graphics.library on it, where the 3D
 * block reached through AMOS's own `-$18ca(a5)`. The guide names the argument
 * RPORT throughout and `Wb Screen Rastport` is the routine that produces one:
 *
 *     $259c  move.l  (a3)+,d3
 *     $259e  addi.w  #$54,d3
 *
 * ten bytes that add the Screen struct's RastPort offset and hand it back. So
 * a RastPort address here is a Screen address plus $54, which is exactly how
 * ../amiga/intuition.ts already addresses screens, and `rastPortAt` below
 * turns one back into the port's own RastPort object.
 *
 * ## What the pens are
 *
 * The keywords do not carry a colour. `Wb Gfx Ink` is `SetAPen` and `SetBPen`
 * on the RastPort and everything afterwards draws in whatever those left,
 * which is the library's model rather than AMOS's. A caller who never calls
 * `Wb Gfx Ink` gets the RastPort's existing pens.
 *
 * ## Two defects
 *
 * `Wb Draw` transposes the point it starts from, and `Wb Print Xmove` and
 * `Wb Print Ymove` disagree about the size of the shift. See each.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, VS, int, str, type Value } from '../interp/values'
import type { RastPort } from '../amiga/graphics'
import { Runtime as RT } from './runtime'
import type { IntuiextendState } from './intuiextend'

/** `addi.w #$54,d3` at $259e — the Screen struct's RastPort offset */
export const IE_RASTPORT_OFFSET = 0x54

/** the low word, signed: every coordinate reaches graphics through a `move.w` */
const lo = (v: number): number => (v << 16) >> 16

/**
 * The state at workspace+$b0, which the `Wb Print` family shares.
 *
 * It is an IntuiText: FrontPen at +0, BackPen at +1, DrawMode at +2, LeftEdge
 * at +4, TopEdge at +6 and IText at +$c. `Wb Print` fills in the text pointer
 * and calls intuition `PrintIText` at -$d8; everything else in the family
 * writes one field of it and draws nothing.
 */
export interface IePrintState {
  frontPen: number
  backPen: number
  drawMode: number
  /** LeftEdge and TopEdge, in PIXELS -- the locate keywords multiply by eight */
  x: number
  y: number
}

export function newIePrintState(): IePrintState {
  return { frontPen: 1, backPen: 0, drawMode: 0, x: 0, y: 0 }
}

/**
 * `rol.w #$3` — what `Wb Print Locate` does to a character column.
 *
 * A ROTATE and not a shift, so a column of 8192 or more brings its top bits
 * back in at the bottom instead of losing them. `Wb X Locate` undoes it with
 * `ror.w #$3` and gets the column back for anything that did not wrap.
 */
export const rolW3 = (v: number): number => (((v << 3) | ((v & 0xffff) >>> 13)) & 0xffff)
export const rorW3 = (v: number): number => ((((v & 0xffff) >>> 3) | (v << 13)) & 0xffff)

/** `rol.l #$3`, which is what `Wb Print Ymove` uses where Xmove uses the word form */
export const rolL3 = (v: number): number => (((v << 3) | (v >>> 29)) | 0)

export function makeIntuiextendGfxInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): IntuiextendState => rt.intuiextend

  /**
   * The RastPort a `struct RastPort *` names.
   *
   * Screens live at `SCREEN_CTRL_BASE + slot * SCREEN_CTRL_SLOT` and a
   * RastPort is $54 past one, so the arithmetic runs backwards cleanly. An
   * address that is not a screen's RastPort answers null and the keyword does
   * nothing, which is what the library does with a pointer into nowhere on a
   * machine that happens not to trap it.
   */
  const rastPortAt = (addr: number): RastPort | null => {
    const off = (addr >>> 0) - IE_RASTPORT_OFFSET - RT.SCREEN_CTRL_BASE
    if (off < 0 || off % RT.SCREEN_CTRL_SLOT !== 0) return null
    const s = rt.screens.get(off / RT.SCREEN_CTRL_SLOT)
    return s ? s.rp : null
  }

  /** the RastPort AMOS is drawing through, `-$18ca(a5)` */
  const amosRp = (): RastPort | null => (rt.screen ? rt.screen.rp : null)

  /** `RPORT To a,b` and `RPORT To a,b,c,d`, the two shapes almost everything has */
  const args = (it: Parameters<Instr>[0], n: number): number[] => {
    const out = [it.evalInt()]
    it.expect('to')
    for (let i = 0; i < n; i++) {
      if (i > 0) it.expect(',')
      out.push(it.evalInt())
    }
    return out
  }

  return {
    /**
     * Wb Plot RPORT To X,Y — routine 48 ($2e40), graphics `WritePixel` at
     * -$144, in the RastPort's own APen.
     */
    'wb plot'(it) {
      const [rp, x, y] = args(it, 2)
      const r = rastPortAt(rp!)
      if (r) r.plot(lo(x!), lo(y!), r.fgPen)
    },

    /**
     * Wb Bar RPORT To X,Y,W,H — routine 57 ($2f4e), `RectFill` at -$132.
     *
     * The guide calls the last two W and H. They are not: they go straight
     * into RectFill's xMax and yMax, so they are the far corner. A caller who
     * believed the names draws a bar starting at the right place and ending
     * in the wrong one.
     */
    'wb bar'(it) {
      const [rp, x, y, w, h] = args(it, 4)
      const r = rastPortAt(rp!)
      if (r) r.rectFill(lo(x!), lo(y!), lo(w!), lo(h!), r.fgPen)
    },

    /**
     * Wb Box RPORT To X,Y,W,H — routine 59 ($2f72). Four `Draw` calls round
     * the rectangle, closing back on the start, with the same naming as
     * `Wb Bar`: the last pair is the far corner.
     */
    'wb box'(it) {
      const [rp, x1, y1, x2, y2] = args(it, 4)
      const r = rastPortAt(rp!)
      if (!r) return
      r.cpX = lo(x1!)
      r.cpY = lo(y1!)
      r.draw(r.cpX, r.cpY, lo(x2!), lo(y1!), r.fgPen)
      r.draw(lo(x2!), lo(y1!), lo(x2!), lo(y2!), r.fgPen)
      r.draw(lo(x2!), lo(y2!), lo(x1!), lo(y2!), r.fgPen)
      r.draw(lo(x1!), lo(y2!), lo(x1!), lo(y1!), r.fgPen)
      r.cpX = lo(x1!)
      r.cpY = lo(y1!)
    },

    /**
     * Wb Ellipse RPORT To X,Y,A,B — routine 50 ($2e70), `DrawEllipse` at
     * -$b4, centre and two radii.
     */
    'wb ellipse'(it) {
      const [rp, x, y, a, b] = args(it, 4)
      const r = rastPortAt(rp!)
      if (r) r.ellipse(lo(x!), lo(y!), lo(a!), lo(b!), r.fgPen)
    },

    /**
     * Wb Curs RPORT,X,Y — routine 45 ($2ddc). Writes rp_cp_x and rp_cp_y and
     * calls nothing, so it moves the graphics cursor without a `Move`.
     */
    'wb curs'(it) {
      const rp = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const r = rastPortAt(rp)
      if (!r) return
      r.cpX = lo(x)
      r.cpY = lo(y)
    },

    /** Wb Turtle Curs RPORT To DX,DY — routine 41 ($2d88), the cursor moved relatively */
    'wb turtle curs'(it) {
      const [rp, dx, dy] = args(it, 2)
      const r = rastPortAt(rp!)
      if (!r) return
      r.cpX = lo(r.cpX + lo(dx!))
      r.cpY = lo(r.cpY + lo(dy!))
    },

    /**
     * Wb Turtle Plot RPORT To DX,DY — routine 49 ($2e54).
     *
     * `WritePixel` at the cursor plus the offset, and it does NOT move the
     * cursor: the `add.w` at $2e60 is into d0 and d1, not into the RastPort.
     */
    'wb turtle plot'(it) {
      const [rp, dx, dy] = args(it, 2)
      const r = rastPortAt(rp!)
      if (r) r.plot(lo(r.cpX + lo(dx!)), lo(r.cpY + lo(dy!)), r.fgPen)
    },

    /**
     * Wb Turtle Draw RPORT To DX,DY — routine 43 ($2dac). `Draw` to the
     * cursor plus the offset, and `Draw` is what moves the cursor after it.
     */
    'wb turtle draw'(it) {
      const [rp, dx, dy] = args(it, 2)
      const r = rastPortAt(rp!)
      if (!r) return
      const nx = lo(r.cpX + lo(dx!))
      const ny = lo(r.cpY + lo(dy!))
      r.draw(r.cpX, r.cpY, nx, ny, r.fgPen)
      r.cpX = nx
      r.cpY = ny
    },

    /**
     * Wb Draw X0,Y0 To X1,Y1 — routine 278 ($50ea), on AMOS's own RastPort
     * rather than a given one.
     *
     * DEFECT: the start point is transposed. `movem.w d2-d3,$24(a1)` at $50f6
     * writes d2 to rp_cp_x and d3 to rp_cp_y, and the pops leave d2 holding
     * Y0 and d3 holding X0. So the line runs from (Y0, X0) to (X1, Y1). The
     * guide's synopsis is "Wb Draw X0,Y0 To X1,Y1" and its own example would
     * draw the wrong line.
     *
     * `movem` stores in register order whatever order the list was written
     * in, which is how a transposition like this survives review.
     */
    'wb draw'(it) {
      const x0 = it.evalInt()
      it.expect(',')
      const y0 = it.evalInt()
      it.expect('to')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      const r = amosRp()
      if (!r) return
      r.cpX = lo(y0) // yes, y into x
      r.cpY = lo(x0)
      r.draw(r.cpX, r.cpY, lo(x1), lo(y1), r.fgPen)
      r.cpX = lo(x1)
      r.cpY = lo(y1)
    },

    /**
     * Wb Bevel Box RPORT To X1,Y1,X2,Y2,PEN1,PEN2 — routine 40 ($2d40).
     *
     * Two `Draw` pairs in two pens: the top and left edges in the first, the
     * bottom and right in the second, which is what makes the box look raised
     * or sunk depending on which way round the caller passes them.
     */
    'wb bevel box'(it) {
      const [rp, x1, y1, x2, y2, p1, p2] = args(it, 6)
      const r = rastPortAt(rp!)
      if (!r) return
      r.cpX = lo(x2!)
      r.cpY = lo(y2!)
      r.draw(r.cpX, r.cpY, lo(x2!), lo(y1!), lo(p1!))
      r.draw(lo(x2!), lo(y1!), lo(x1!), lo(y1!), lo(p1!))
      r.draw(lo(x1!), lo(y1!), lo(x1!), lo(y2!), lo(p2!))
      r.draw(lo(x1!), lo(y2!), lo(x2!), lo(y2!), lo(p2!))
    },

    /**
     * Wb Gfx Ink RPORT To PEN,PAPER — routine 64 ($302a), `SetAPen` at -$156
     * then `SetBPen` at -$15c. The two pens every other keyword here draws in.
     */
    'wb gfx ink'(it) {
      const [rp, pen, paper] = args(it, 2)
      const r = rastPortAt(rp!)
      if (!r) return
      r.fgPen = lo(pen!) & 0xff
      r.bgPen = lo(paper!) & 0xff
    },

    /** Wb Gfx Mode RPORT,MODE — routine 65 ($3048), `SetDrMd` at -$162 */
    'wb gfx mode'(it) {
      const rp = it.evalInt()
      it.expect(',')
      const mode = it.evalInt()
      const r = rastPortAt(rp)
      if (r) r.drawMode = lo(mode) & 0xff
    },

    /** Wb Set Line RPORT,PATTERN — routine 62 ($2fc6), rp_LinePtrn at $22 direct */
    'wb set line'(it) {
      const rp = it.evalInt()
      it.expect(',')
      const p = it.evalInt()
      const r = rastPortAt(rp)
      if (r) r.linePtrn = p & 0xffff
    },

    /**
     * Wb Paint RPORT To X,Y — routine 56 ($2f30), graphics `Flood` at -$14a,
     * with the mode from workspace+$88 rather than an argument.
     */
    'wb paint'(it) {
      const [rp, x, y] = args(it, 2)
      const r = rastPortAt(rp!)
      if (r) r.flood(st().paintMode, lo(x!), lo(y!), r.fgPen)
    },

    /**
     * Wb Paint Mode MODE — routine 58 ($2f66), one longword into
     * workspace+$88 and nothing else. Flood's mode 0 fills to the outline
     * pen, mode 1 fills over anything that is not the colour already there.
     */
    'wb paint mode'(it) {
      st().paintMode = it.evalInt() | 0
    },

    /**
     * Wb Screen SCR — routine 190 ($424e), two instructions.
     *
     *     move.l  (a3)+,-$18ca(a5)
     *     addi.l  #$54,-$18ca(a5)
     *
     * It writes AMOS's own `T_RastPort` and nothing else, so every AMOS
     * drawing keyword afterwards goes to that screen. The guide: "Une
     * alternative à la commande 'Screen ECRAN' d'amos. Elle prend de cette
     * façon en compte les écran intuition."
     */
    'wb screen'(it) {
      const addr = it.evalInt()
      const off = (addr >>> 0) - RT.SCREEN_CTRL_BASE
      if (off < 0 || off % RT.SCREEN_CTRL_SLOT !== 0) return
      const slot = off / RT.SCREEN_CTRL_SLOT
      if (rt.screens.has(slot)) rt.currentIndex = slot
    },

    /** Wb Gfx Text RPORT,X,Y To TXT$ — routine 116 ($371a), `Text` at -$3c */
    'wb gfx text'(it) {
      const rp = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect('to')
      const s = it.evalStr()
      const r = rastPortAt(rp)
      if (!r) return
      r.text(lo(x), lo(y), s, r.fgPen)
    },

    /**
     * Wb Gfx Centre RPORT,Y,X To TXT$ — routine 157 ($3b2a).
     *
     * The same `Text` call with the left edge backed off by `rol.w #$2` of
     * the length, which is four pixels a character: half of the eight
     * `Wb Gfx Len` assumes. So it centres on X for an eight-pixel font and is
     * off for anything else.
     */
    'wb gfx centre'(it) {
      const rp = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect('to')
      const s = it.evalStr()
      const r = rastPortAt(rp)
      if (!r) return
      const cx = lo(lo(x) - (((s.length << 2) | ((s.length & 0xffff) >>> 14)) & 0xffff))
      r.text(cx, lo(y), s, r.fgPen)
    },

    /** Wb Text Spacing RPORT To N — routine 118 ($3746), rp_TxSpacing at $40 */
    'wb text spacing'(it) {
      const [rp, n] = args(it, 1)
      const r = rastPortAt(rp!)
      if (r) st().textSpacing = lo(n!)
    },

    /** Wb Text Style RPORT To N — routine 119 ($3750), rp_AlgoStyle at $38 */
    'wb text style'(it) {
      const [rp, n] = args(it, 1)
      const r = rastPortAt(rp!)
      if (r) r.algoStyle = lo(n!) & 0xff
    },

    /**
     * Wb Print TXT$ To RPORT — routine 47 ($2e1c), intuition `PrintIText` at
     * -$d8 with the IntuiText at workspace+$b0 and an offset of (0,0), so the
     * position is the one `Wb Print Locate` left in the struct.
     */
    'wb print'(it) {
      const s = it.evalStr()
      it.expect('to')
      const rp = it.evalInt()
      const r = rastPortAt(rp)
      if (!r) return
      const p = st().print
      const wasA = r.fgPen
      const wasB = r.bgPen
      const wasMode = r.drawMode
      r.fgPen = p.frontPen
      r.bgPen = p.backPen
      r.drawMode = p.drawMode
      r.text(p.x, p.y, s, r.fgPen)
      r.fgPen = wasA
      r.bgPen = wasB
      r.drawMode = wasMode
    },

    /**
     * Wb Print Ink PEN,PAPER — routine 44 ($2dc8).
     *
     * PEN lands in the IntuiText's BackPen at +1 and PAPER in its FrontPen at
     * +0: the first argument popped is the LAST one, and it is written to
     * $1(a0) before the second goes to (a0). So the guide's "PEN,PAPER" is
     * the wrong way round against what Intuition draws with.
     */
    'wb print ink'(it) {
      const pen = it.evalInt()
      it.expect(',')
      const paper = it.evalInt()
      const p = st().print
      p.backPen = lo(pen) & 0xff
      p.frontPen = lo(paper) & 0xff
    },

    /** Wb Print Mode MODE — routine 146 ($39b4), the IntuiText's DrawMode at +2 */
    'wb print mode'(it) {
      st().print.drawMode = it.evalInt() & 0xff
    },

    /**
     * Wb Print Locate LOCX,LOCY — routine 148 ($39e6).
     *
     * Both arguments go through `rol.w #$3`, eight pixels a character, so the
     * struct holds pixels and the keyword takes columns. A rotate rather than
     * a shift: a column of 8192 or more wraps its top bits back in.
     */
    'wb print locate'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const p = st().print
      p.x = rolW3(x)
      p.y = rolW3(y)
    },

    /**
     * Wb Print Xmove LOCX — routine 150 ($3a12), `rol.w #$3`, and
     * Wb Print Ymove LOCY — routine 149 ($3a00), `rol.l #$3`.
     *
     * DEFECT: the two are not the same shift. Xmove rotates a WORD and Ymove
     * a LONG, so a negative or large move behaves differently on the two
     * axes even though the guide describes them as a pair. The `add.w` that
     * follows takes only the low word either way, so the difference shows up
     * as what wraps into it.
     */
    'wb print xmove'(it) {
      const p = st().print
      p.x = (p.x + rolW3(it.evalInt())) & 0xffff
    },
    'wb print ymove'(it) {
      const p = st().print
      p.y = (p.y + rolL3(it.evalInt())) & 0xffff
    },

    /**
     * Wb Blit Copy SRC,X,Y,W,H To DST,X,Y,MINTERM — routine 120 ($375a),
     * graphics `ClipBlit` at -$228 between two RastPorts.
     */
    'wb blit copy'(it) {
      const src = it.evalInt()
      it.expect(',')
      const sx = it.evalInt()
      it.expect(',')
      const sy = it.evalInt()
      it.expect(',')
      const w = it.evalInt()
      it.expect(',')
      const h = it.evalInt()
      it.expect('to')
      const dst = it.evalInt()
      it.expect(',')
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      it.expect(',')
      it.evalInt() // the minterm; only $c0 is reachable through this port
      const s = rastPortAt(src)
      const d = rastPortAt(dst)
      if (!s || !d) return
      clipBlit(s, lo(sx), lo(sy), d, lo(dx), lo(dy), lo(w), lo(h))
    },
  }
}

/** `ClipBlit` with minterm $c0, which is the only one this group asks for */
function clipBlit(
  src: RastPort,
  sx: number,
  sy: number,
  dst: RastPort,
  dx: number,
  dy: number,
  w: number,
  h: number,
): void {
  if (w <= 0 || h <= 0) return
  const tmp = new Uint8Array(w * h)
  for (let ry = 0; ry < h; ry++) {
    for (let rx = 0; rx < w; rx++) {
      const x = sx + rx
      const y = sy + ry
      if (x < 0 || y < 0 || x >= src.bitMap.width || y >= src.bitMap.height) continue
      tmp[ry * w + rx] = src.bitMap.pixelAt(x, y)
    }
  }
  for (let ry = 0; ry < h; ry++) {
    for (let rx = 0; rx < w; rx++) {
      const x = dx + rx
      const y = dy + ry
      if (x < 0 || y < 0 || x >= dst.bitMap.width || y >= dst.bitMap.height) continue
      dst.bitMap.writePixel(x, y, tmp[ry * w + rx]!)
    }
  }
}

export function makeIntuiextendGfxFunctions(rt: Runtime): Record<string, Func> {
  const st = (): IntuiextendState => rt.intuiextend
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0)) | 0
  const s0 = (a: Value[], n: number): string => str(a[n] ?? VS(''))

  return {
    /**
     * =Wb Point(X,Y) — routine 264 ($4e04).
     *
     * Reads a pixel out of AMOS's own RastPort by walking the bitplanes and
     * setting one bit of the answer per plane, rather than calling
     * `ReadPixel`. Out of range is -1, and the range it checks is the
     * BitMap's own Rows and BytesPerRow * 8 -- so a negative coordinate or
     * one past the edge answers -1 rather than reading somebody else's memory.
     */
    'wb point': (_, a) => {
      const x = i0(a, 0)
      const y = i0(a, 1)
      const scr = rt.screen
      if (!scr) return VI(-1)
      const bm = scr.rp.bitMap
      if (y < 0 || y >= bm.height || x < 0 || x >= bm.width) return VI(-1)
      return VI(bm.pixelAt(x, y))
    },

    /**
     * =Wb Get Colour(SCREEN,N) — routine 54 ($2ef4).
     *
     * Screen+$30 is the ViewPort's ColorMap pointer and +$4 of that is the
     * table, so this reads one 12-bit entry straight out of it.
     */
    'wb get colour': (_, a) => {
      const scr = ieScreenAt(rt, i0(a, 0))
      const n = i0(a, 1)
      if (!scr) return VI(0)
      return VI(scr.palette[n & 0xff] ?? 0)
    },

    /** =Wb Gfx Len(TXT$) — routine 117 ($373a): `asl.l #$3`, eight pixels a
     * character whatever font the RastPort actually has */
    'wb gfx len': (_, a) => VI((s0(a, 0).length << 3) | 0),

    /** =Wb X Print / =Wb Y Print — routines 151 and 152, the IntuiText's edges in PIXELS */
    'wb x print': () => VI(st().print.x),
    'wb y print': () => VI(st().print.y),
    /** =Wb X Locate / =Wb Y Locate — 153 and 154, the same two through `ror.w #$3` */
    'wb x locate': () => VI(rorW3(st().print.x)),
    'wb y locate': () => VI(rorW3(st().print.y)),
  }
}

/** the Screen a `struct Screen *` names, for the two palette keywords */
function ieScreenAt(rt: Runtime, addr: number): { palette: readonly number[] } | null {
  const off = (addr >>> 0) - RT.SCREEN_CTRL_BASE
  if (off < 0 || off % RT.SCREEN_CTRL_SLOT !== 0) return null
  const s = rt.screens.get(off / RT.SCREEN_CTRL_SLOT)
  return s ? { palette: Array.from(s.palette) } : null
}
