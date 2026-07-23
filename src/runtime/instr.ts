import { AmosError, VI, VS, int, str } from '../interp/values'
import type { Instr, Func } from '../interp/builtins'
import { parseAmosNumber } from '../interp/builtins'
import { parseAmosFile } from '../loader/amosfile'
import { parseIlbm } from '../loader/iff'
import { parsePacPic } from '../loader/pacpic'
import type { Runtime } from './runtime'
import { Screen, builtinPattern } from './screen'
import { ObjectBank } from './objects'
import { AmalChannel, AmalCompileError, compileAmal } from './amal'
import {
  DIALOG_ERRORS,
  DialogChannel,
  DialogError,
  dialogZoneAt,
  dialogZoneByNumber,
  dialogZoneValue,
  eraseDialog,
  prescanDialog,
  updateZone,
} from './dialog'
import { amigaPattern } from './vfs'
import { bellPcm, boomPcm, shootPcm } from './audio'

/**
 * Graphics/screen instruction and function registries, bound to a Runtime.
 * Merged over the core builtins when the interpreter is created.
 */

type It = Parameters<Instr>[0]

/** optional integer argument: elided (",," or end) yields def */
function optInt(it: It, def: number): number {
  if (it.atStmtEnd() || it.nm() === ',' || it.nm() === ')') return def
  return it.evalInt()
}

function pair(it: It): [number, number] {
  const x = it.evalInt()
  it.expect(',')
  return [x, it.evalInt()]
}

/** Rdialog/Rdialog$(c,zone[,item]) shared lookup (Dia_GetValue +Lib.s:20843) */
function rdialogValue(rt: Runtime, a: import('../interp/values').Value[]): { n: number; s: string | null } {
  const d = rt.dialogs.get(int(a[0]!))
  if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
  const item = a.length >= 3 ? int(a[2]!) : 1
  const z = dialogZoneByNumber(d, int(a[1]!), item)
  if (!z) throw new AmosError(DIALOG_ERRORS[6]!)
  return dialogZoneValue(z)
}

/** Vdialog(c,n)= / Vdialog$(c,n)= assignment forms (Dia_GetVariable +Lib.s:14548) */
function vdialogWrite(it: It, rt: Runtime, isStr: boolean): void {
  it.expect('(')
  const c = it.evalInt()
  it.expect(',')
  const n = it.evalInt()
  it.expect(')')
  it.expectOp('=')
  const d = rt.dialogs.get(c)
  if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
  if (n < 0 || n >= d.vars.length) throw new AmosError(DIALOG_ERRORS[8]!)
  d.vars[n] = isStr ? it.evalStr() : it.evalInt()
}

/** Set Slider/Set Pattern number → fill rows (0 solid, <0 sprite image, >0 builtin) */
function resolvePattern(rt: Runtime, n: number): Uint16Array | null {
  if (n === 0) return null
  if (n < 0) {
    const img = rt.spriteBank?.image(-n)
    if (!img) return null
    const rows = Math.min(16, img.height)
    const bits = new Uint16Array(rows)
    for (let y = 0; y < rows; y++) {
      let row = 0
      for (let x = 0; x < Math.min(16, img.width); x++) {
        if (img.pixels[y * img.width + x] !== 0) row |= 1 << (15 - x)
      }
      bits[y] = row
    }
    return bits
  }
  return builtinPattern(n)
}

/**
 * Hslider/Vslider x1,y1 To x2,y2,total,pos,size (InHSlider/InVSlider
 * +Lib.s:10143/10151): every argument non-negative, the box non-empty and
 * pos <= total, else function call error (GetSli/SlPa).
 */
function slider(it: It, s: Screen, vertical: boolean): void {
  const x1 = it.evalInt()
  it.expect(',')
  const y1 = it.evalInt()
  it.expect('to')
  const x2 = it.evalInt()
  it.expect(',')
  const y2 = it.evalInt()
  it.expect(',')
  const total = it.evalInt()
  it.expect(',')
  const pos = it.evalInt()
  it.expect(',')
  const size = it.evalInt()
  if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0 || total < 0 || pos < 0 || size < 0) {
    throw new AmosError('function call error')
  }
  if (x2 - x1 <= 0 || y2 - y1 <= 0 || pos > total) throw new AmosError('function call error')
  s.drawSlider(vertical, x1, y1, x2, y2, total, pos, size)
}

export function makeInstructions(rt: Runtime): Record<string, Instr> {
  const scr = (): Screen => rt.screen
  const byIndex = (n: number): Screen => {
    const s = rt.screens.get(n)
    if (!s) throw new AmosError(`screen not opened: ${n}`)
    return s
  }

  return {
    // ---- screens ----
    'screen open'(it) {
      const n = it.evalInt()
      it.expect(',')
      const w = it.evalInt()
      it.expect(',')
      const h = it.evalInt()
      it.expect(',')
      const nc = it.evalInt()
      it.expect(',')
      const mode = it.evalInt()
      rt.openScreen(n, w, h, nc, mode)
    },
    'screen close'(it) {
      rt.closeScreen(optInt(it, rt.currentIndex))
    },
    screen(it) {
      rt.setCurrent(it.evalInt())
    },
    'screen display'(it) {
      const s = byIndex(it.evalInt())
      if (it.accept(',')) {
        s.displayX = optInt(it, s.displayX)
        if (it.accept(',')) {
          s.displayY = optInt(it, s.displayY)
          // trailing ,w,h — accepted and ignored (size can't change)
          while (it.accept(',')) optInt(it, 0)
        }
      }
      s.visible = true
    },
    'screen offset'(it) {
      const s = byIndex(it.evalInt())
      it.expect(',')
      s.offsetX = optInt(it, s.offsetX)
      if (it.accept(',')) s.offsetY = optInt(it, s.offsetY)
    },
    'screen hide'(it) {
      byIndex(optInt(it, rt.currentIndex)).visible = false
    },
    'screen show'(it) {
      byIndex(optInt(it, rt.currentIndex)).visible = true
    },
    'screen to front'(it) {
      rt.toFront(optInt(it, rt.currentIndex))
    },
    'screen to back'(it) {
      rt.toBack(optInt(it, rt.currentIndex))
    },
    'screen swap'(it) {
      const n = optInt(it, rt.currentIndex)
      rt.screens.get(n)?.swap()
    },
    'double buffer'() {
      scr().doubleBuffer()
    },
    autoback(it) {
      scr().autoback = it.evalInt() & 3
    },
    'screen copy'(it) {
      const src = rt.resolveScreenId(it.evalInt())
      let x1 = 0
      let y1 = 0
      let x2 = src.s.width
      let y2 = src.s.height
      if (it.accept(',')) {
        x1 = it.evalInt()
        it.expect(',')
        y1 = it.evalInt()
        it.expect(',')
        x2 = it.evalInt()
        it.expect(',')
        y2 = it.evalInt()
      }
      it.expect('to')
      const dst = rt.resolveScreenId(it.evalInt())
      let dx = 0
      let dy = 0
      if (it.accept(',')) {
        dx = it.evalInt()
        it.expect(',')
        dy = it.evalInt()
        // optional blitter mode
        if (it.accept(',')) it.evalInt()
      }
      Screen.copyBuf(src.s, src.buf, x1, y1, x2, y2, dst.s, dst.buf, dx, dy)
    },

    // ---- drawing ----
    cls(it) {
      const s = scr()
      if (it.atStmtEnd()) {
        s.cls()
        return
      }
      const c = it.evalInt()
      if (it.accept(',')) {
        const [x1, y1] = pair(it)
        it.expect('to')
        const [x2, y2] = pair(it)
        s.cls(c, x1, y1, x2 - 1, y2 - 1)
      } else {
        s.cls(c)
      }
    },
    ink(it) {
      // Ink [pen][,[paper]][,[border]] — border goes to the outline pen
      const s = scr()
      if (it.nm() !== ',' && !it.atStmtEnd()) s.ink = it.evalInt()
      if (it.accept(',')) {
        if (it.nm() !== ',' && !it.atStmtEnd()) s.gPaper = it.evalInt()
        if (it.accept(',') && !it.atStmtEnd()) s.gBorder = it.evalInt()
      }
    },
    plot(it) {
      const [x, y] = pair(it)
      const s = scr()
      s.plot(x, y, it.accept(',') ? it.evalInt() : s.ink)
      s.grX = x
      s.grY = y
    },
    draw(it) {
      const s = scr()
      let x1 = s.grX
      let y1 = s.grY
      if (!it.accept('to')) {
        ;[x1, y1] = pair(it)
        it.expect('to')
      }
      const [x2, y2] = pair(it)
      s.line(x1, y1, x2, y2)
    },
    'draw to'(it) {
      const s = scr()
      const [x, y] = pair(it)
      s.line(s.grX, s.grY, x, y)
    },
    'gr locate'(it) {
      const s = scr()
      ;[s.grX, s.grY] = pair(it)
    },
    box(it) {
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      scr().box(x1, y1, x2, y2)
    },
    bar(it) {
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      scr().bar(x1, y1, x2, y2)
    },
    circle(it) {
      const [x, y] = pair(it)
      it.expect(',')
      const r = it.evalInt()
      scr().ellipse(x, y, r, r)
    },
    ellipse(it) {
      const [x, y] = pair(it)
      it.expect(',')
      const r1 = it.evalInt()
      it.expect(',')
      const r2 = it.evalInt()
      scr().ellipse(x, y, r1, r2)
    },
    polyline: polyish(false),
    polygon: polyish(true),
    paint(it) {
      // graphics.library Flood: mode 1 (default) fills the same-colour
      // region; mode 0 fills until the outline pen (Ink's 3rd argument)
      const [x, y] = pair(it)
      const mode = it.accept(',') ? it.evalInt() & 1 : 1
      scr().paint(x, y, scr().ink, mode === 0)
    },
    text(it) {
      const [x, y] = pair(it)
      it.expect(',')
      scr().text(x, y, it.evalStr())
    },
    clip(it) {
      const s = scr()
      if (it.atStmtEnd()) {
        s.clip = null
        return
      }
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      s.clip = { x1, y1, x2: x2 - 1, y2: y2 - 1 }
    },

    // ---- palette ----
    colour(it) {
      const s = scr()
      const n = it.evalInt()
      it.expect(',')
      s.palette[n & 31] = it.evalInt() & 0xfff
    },
    'colour back'(it) {
      rt.colourBack = it.evalInt() & 0xfff
    },
    palette(it) {
      const s = scr()
      let i = 0
      do {
        const v = it.atStmtEnd() || it.nm() === ',' ? -1 : it.evalInt()
        if (v >= 0 && i < 32) s.palette[i] = v & 0xfff
        i++
      } while (it.accept(','))
    },
    'get palette'(it) {
      const src = byIndex(it.evalInt())
      const mask = it.accept(',') ? it.evalInt() : -1
      const dst = scr()
      for (let i = 0; i < 32; i++) if (mask & (1 << i)) dst.palette[i] = src.palette[i]!
    },
    'shift up'(it) {
      const delay = it.evalInt()
      it.expect(',')
      const first = it.evalInt()
      it.expect(',')
      const last = it.evalInt()
      if (it.accept(',')) it.evalInt()
      rt.shifts.set(rt.currentIndex, { dir: 1, delay: Math.max(1, delay), first, last, count: 0 })
    },
    'shift down'(it) {
      const delay = it.evalInt()
      it.expect(',')
      const first = it.evalInt()
      it.expect(',')
      const last = it.evalInt()
      if (it.accept(',')) it.evalInt()
      rt.shifts.set(rt.currentIndex, { dir: -1, delay: Math.max(1, delay), first, last, count: 0 })
    },
    'shift off'() {
      rt.shifts.delete(rt.currentIndex)
    },
    'set line'(it) {
      scr().linePattern = it.evalInt() & 0xffff
    },
    'set paint'(it) {
      scr().outline = it.evalInt() !== 0
    },
    hslider(it) {
      slider(it, scr(), false)
    },
    vslider(it) {
      slider(it, scr(), true)
    },
    'set slider'(it) {
      // SliSet +W.s:5246: 8 params, elided ones keep their current value
      const cfg = scr().slider
      const vals: Array<number | null> = []
      for (let i = 0; i < 8; i++) {
        if (i > 0 && !it.accept(',')) break
        vals.push(it.atStmtEnd() || it.nm() === ',' ? null : it.evalInt())
      }
      const [fa, fb, fc, fpat, ia, ib, ic, ipat] = vals
      if (fa != null) cfg.fa = fa
      if (fb != null) cfg.fb = fb
      if (fc != null) cfg.fc = fc
      if (fpat != null) cfg.fpat = resolvePattern(rt, fpat)
      if (ia != null) cfg.ia = ia
      if (ib != null) cfg.ib = ib
      if (ic != null) cfg.ic = ic
      if (ipat != null) cfg.ipat = resolvePattern(rt, ipat)
    },
    'set pattern'(it) {
      const n = it.evalInt()
      const s = scr()
      if (n === 0) {
        s.pattern = null
        return
      }
      if (n < 0) {
        // negative: a sprite image is the fill pattern (SPat1)
        const img = rt.spriteBank?.image(-n)
        if (!img) return
        const rows = Math.min(16, img.height)
        const bits = new Uint16Array(rows)
        for (let y = 0; y < rows; y++) {
          let row = 0
          for (let x = 0; x < Math.min(16, img.width); x++) {
            if (img.pixels[y * img.width + x] !== 0) row |= 1 << (15 - x)
          }
          bits[y] = row
        }
        s.pattern = bits
        return
      }
      // positive patterns live in the system mouse/pattern bank
      it.unimplemented.set('set pattern (bank pattern)', (it.unimplemented.get('set pattern (bank pattern)') ?? 0) + 1)
    },
    fade(it) {
      // Fade speed[,colours...]: every `speed` ticks each RGB nibble steps
      // one toward its target; elided colours stay untouched (FadeI).
      const delay = Math.max(1, it.evalInt())
      const targets = new Int32Array(32).fill(-1)
      let i = 0
      let any = false
      while (it.accept(',')) {
        if (!(it.atStmtEnd() || it.nm() === ',')) {
          if (i < 32) targets[i] = it.evalInt() & 0xfff
          any = true
        }
        i++
      }
      if (!any) targets.fill(0) // no list: fade everything to black
      rt.fades.set(rt.currentIndex, { delay, count: 0, targets })
    },
    'flash off'() {
      rt.flashes.clear()
    },
    flash(it) {
      const reg = it.evalInt()
      it.expect(',')
      const spec = it.evalStr()
      const seq: Array<{ rgb: number; ticks: number }> = []
      for (const m of spec.matchAll(/\(\s*([0-9a-f]+)\s*,\s*(\d+)\s*\)/gi)) {
        seq.push({ rgb: parseInt(m[1]!, 16) & 0xfff, ticks: Math.max(1, parseInt(m[2]!, 10)) })
      }
      if (seq.length === 0) throw new AmosError('syntax error in flash string')
      rt.flashes.set(reg & 31, { seq, idx: 0, left: seq[0]!.ticks })
    },

    // ---- rainbows (stored; rendered when the copper composite lands) ----
    'set rainbow'(it) {
      const n = it.evalInt()
      it.expect(',')
      const base = it.evalInt()
      it.expect(',')
      const height = it.evalInt()
      it.expect(',')
      const r = it.evalStr()
      it.expect(',')
      const g = it.evalStr()
      it.expect(',')
      const b = it.evalStr()
      rt.rainbows.set(n, { base, height, r, g, b, colours: new Uint16Array(Math.max(16, height)), x: 0, y: 0, h: 0 })
    },
    rainbow(it) {
      const rb = rt.rainbows.get(it.evalInt())
      it.expect(',')
      const x = optInt(it, rb?.x ?? 0)
      it.accept(',')
      const y = optInt(it, rb?.y ?? 0)
      it.accept(',')
      const h = optInt(it, rb?.h ?? 0)
      if (rb) Object.assign(rb, { x, y, h })
    },
    'rainbow del'(it) {
      if (it.atStmtEnd()) rt.rainbows.clear()
      else rt.rainbows.delete(it.evalInt())
    },
    rain(it) {
      // assignment form: Rain(n,line) = colour
      it.expect('(')
      const n = it.evalInt()
      it.expect(',')
      const line = it.evalInt()
      it.expect(')')
      it.expectOp('=')
      const v = it.evalInt()
      const rb = rt.rainbows.get(n)
      if (rb && line >= 0 && line < rb.colours.length) rb.colours[line] = v & 0xfff
    },

    // ---- text console extras ----
    centre(it) {
      const s = scr()
      const t = it.evalStr()
      s.locate(Math.max(0, (s.cols - t.length) >> 1), -1)
      s.writeText(t)
    },
    cdown() {
      scr().newline()
    },
    cup() {
      const s = scr()
      s.curY = Math.max(0, s.curY - 1)
    },
    cleft() {
      const s = scr()
      s.curX = Math.max(0, s.curX - 1)
    },
    cright() {
      const s = scr()
      s.curX = Math.min(s.cols - 1, s.curX + 1)
    },
    cmove(it) {
      // relative cursor move; elided arguments mean 0 (WnCm1/WnCm3)
      const s = scr()
      const dx = optInt(it, 0)
      it.accept(',')
      const dy = optInt(it, 0)
      s.locate(Math.max(0, s.curX + dx), Math.max(0, s.curY + dy))
    },
    clw(it) {
      void it
      scr().clw() // clears the current WINDOW only
    },
    'memorize x'() {
      const s = scr()
      s.memX = s.curX
    },
    'memorize y'() {
      const s = scr()
      s.memY = s.curY
    },
    'remember x'() {
      const s = scr()
      s.curX = Math.min(s.cols - 1, s.memX)
    },
    'remember y'() {
      const s = scr()
      s.curY = Math.min(s.rows - 1, s.memY)
    },
    'set curs'(it) {
      it.skipToStmtEnd() // cursor shape definition — cursor isn't rendered
    },
    cline(it) {
      const s = scr()
      const n = it.atStmtEnd() ? s.cols - s.curX : it.evalInt()
      s.bar(s.curX * 8, s.curY * 8, (s.curX + n) * 8 - 1, s.curY * 8 + 7, s.paper)
    },
    'curs pen'(it) {
      it.evalInt()
    },
    writing(it) {
      // Writing w1[,w2]: 0 replace/1 OR/2 XOR/3 AND/4 ignore; w2: 0 both,
      // 1 paper only, 2 pen on colour 0 (console escape 'W')
      const w = scr().curWin
      w.writing1 = it.evalInt() & 7
      if (it.accept(',')) w.writing2 = it.evalInt() & 3
    },
    'gr writing'(it) {
      // SetDrMd: 0 JAM1 (transparent), 1 JAM2, 2 COMPLEMENT (XOR)
      scr().grMode = it.evalInt() & 7
    },
    'set tab'(it) {
      const n = Math.max(1, it.evalInt())
      scr().curWin.tab = n
      it.tabWidth = n // transcripts mirror the console
    },
    'wind open'(it) {
      const n = it.evalInt()
      it.expect(',')
      const [x, y] = pair(it)
      it.expect(',')
      const [w, h] = pair(it)
      const border = it.accept(',') ? it.evalInt() : 0
      if (border < 0 || border > 16) throw new AmosError('function call error')
      try {
        scr().windOpen(n, x, y, w, h, border)
      } catch (e) {
        throw new AmosError((e as Error).message)
      }
    },
    'wind close'() {
      scr().windClose()
    },
    'wind save'() {
      scr().windSave = true
    },
    'wind move'(it) {
      const s = scr()
      const [x, y] = pair(it)
      const w = s.curWin
      const b = w.border !== 0 ? 8 : 0
      w.x = ((x >> 4) << 4) + b
      w.y = y + b
      s.drawWindowFrame2()
    },
    'wind size'(it) {
      const s = scr()
      const [w2, h2] = pair(it)
      s.curWin.cols = w2
      s.curWin.rows = h2
      s.curWin.curX = 0
      s.curWin.curY = 0
      s.drawWindowFrame2()
    },
    window(it) {
      try {
        scr().selectWindow(it.evalInt())
      } catch (e) {
        throw new AmosError((e as Error).message)
      }
    },
    border(it) {
      // Border n[,paper][,pen]
      const s = scr()
      const w = s.curWin
      w.border = it.evalInt() & 31
      if (it.accept(',')) {
        if (it.nm() !== ',' && !it.atStmtEnd()) w.borPap = it.evalInt()
        if (it.accept(',') && !it.atStmtEnd()) w.borPen = it.evalInt()
      }
      s.drawWindowFrame2()
    },
    'title top'(it) {
      const s = scr()
      s.curWin.titleTop = it.evalStr()
      s.drawWindowFrame2()
    },
    'title bottom'(it) {
      const s = scr()
      s.curWin.titleBottom = it.evalStr()
      s.drawWindowFrame2()
    },

    // ---- misc no-ops that must parse ----
    hide: () => {},
    'hide on': () => {},
    show: () => {},
    'show on': () => {},
    'def scroll'(it) {
      const n = it.evalInt()
      it.expect(',')
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      it.expect(',')
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      rt.scrollZones.set(n, { x1, y1, x2, y2, dx, dy })
    },
    scroll(it) {
      const z = rt.scrollZones.get(it.evalInt())
      if (!z) return
      const s = scr()
      Screen.copy(s, z.x1, z.y1, z.x2, z.y2, s, z.x1 + z.dx, z.y1 + z.dy)
    },

    zoom(it) {
      // Zoom src,x1,y1,x2,y2 To dst,x1,y1,x2,y2 — scaled blit
      const src = rt.resolveScreenId(it.evalInt())
      it.expect(',')
      const [sx1, sy1] = pair(it)
      it.expect(',')
      const [sx2, sy2] = pair(it)
      it.expect('to')
      const dst = rt.resolveScreenId(it.evalInt())
      it.expect(',')
      const [dx1, dy1] = pair(it)
      it.expect(',')
      const [dx2, dy2] = pair(it)
      const sw = sx2 - sx1
      const sh = sy2 - sy1
      const dw = dx2 - dx1
      const dh = dy2 - dy1
      if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) throw new AmosError('function call error')
      for (let y = 0; y < dh; y++) {
        const ty = dy1 + y
        if (ty < 0 || ty >= dst.s.height) continue
        const sy = sy1 + Math.floor((y * sh) / dh)
        if (sy < 0 || sy >= src.s.height) continue
        for (let x = 0; x < dw; x++) {
          const tx = dx1 + x
          if (tx < 0 || tx >= dst.s.width) continue
          const sx = sx1 + Math.floor((x * sw) / dw)
          if (sx < 0 || sx >= src.s.width) continue
          dst.buf[ty * dst.s.width + tx] = src.buf[sy * src.s.width + sx]!
        }
      }
    },
    appear(it) {
      // Appear src To dst[,effect]: full copy (the dissolve order is a
      // full cycle, completed within the instruction)
      const src = rt.resolveScreenId(it.evalInt())
      it.expect('to')
      const dst = rt.resolveScreenId(it.evalInt())
      if (it.accept(',')) it.evalInt()
      const w = Math.min(src.s.width, dst.s.width)
      const h = Math.min(src.s.height, dst.s.height)
      Screen.copyBuf(src.s, src.buf, 0, 0, w, h, dst.s, dst.buf, 0, 0)
    },

    // ---- bobs ----
    bob(it) {
      const n = it.evalInt()
      const cur = rt.bobs.get(n)
      it.expect(',')
      const x = optInt(it, cur?.x ?? 0)
      it.accept(',')
      const y = optInt(it, cur?.y ?? 0)
      it.accept(',')
      const image = optInt(it, cur?.image ?? 1)
      rt.bobs.set(n, { n, x, y, image, screen: cur?.screen ?? rt.currentIndex })
    },
    'bob off'(it) {
      rt.clearBobs() // restore backgrounds, then drop
      if (it.atStmtEnd()) rt.bobs.clear()
      else rt.bobs.delete(it.evalInt())
    },
    'bob update'(it) {
      void it
      rt.updateBobs() // one manual update pass
    },
    'bob update on'() {
      rt.bobUpdateOn = true
    },
    'bob update off'() {
      rt.bobUpdateOn = false
    },
    'bob clear'() {
      rt.clearBobs()
    },
    'bob draw'() {
      rt.updateBobs()
    },
    'set bob'(it) {
      // Set Bob n,back,planes,mask: back 0 = save/restore, <0 = leave a
      // trail, >0 = restore with solid colour back-1 (planes/mask ignored)
      const n = it.evalInt()
      it.expect(',')
      const back = optInt(it, 0)
      while (it.accept(',')) optInt(it, 0)
      rt.bobModes.set(n, back)
    },
    'limit bob'(it) {
      // Limit Bob [n,]x1,y1 To x2,y2 | Limit Bob (clear all)
      if (it.atStmtEnd()) {
        rt.bobLimits.clear()
        return
      }
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      if (it.nm() === 'to') {
        it.advance()
        const [x2, y2] = pair(it)
        rt.bobLimits.set(-1, { x1: a, y1: b, x2, y2 })
        return
      }
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const [x2, y2] = pair(it)
      rt.bobLimits.set(a, { x1: b, y1, x2, y2 })
    },
    'limit mouse'(it) {
      it.skipToStmtEnd()
    },
    'paste bob'(it) {
      const [x, y] = pair(it)
      it.expect(',')
      const img = rt.spriteBank?.image(it.evalInt())
      if (img) rt.blit(scr(), img, x - img.hotX, y - img.hotY, img.opaque)
    },
    'paste icon'(it) {
      const [x, y] = pair(it)
      it.expect(',')
      const img = rt.iconBank?.image(it.evalInt())
      if (img) rt.blit(scr(), img, x, y, true)
    },
    'get bob': getObj('sprite'),
    'get sprite': getObj('sprite'),
    'get icon': getObj('icon'),
    'get sprite palette': bankPalette(),
    'get bob palette': bankPalette(),
    'get icon palette'(it) {
      const mask = it.atStmtEnd() ? -1 : it.evalInt()
      const pal = rt.iconBank?.palette
      if (pal) {
        for (let i = 0; i < Math.min(32, pal.length); i++) {
          if (mask & (1 << i)) scr().palette[i] = pal[i]!
        }
      }
    },
    'hot spot'(it) {
      const img = rt.spriteBank?.image(it.evalInt())
      if (it.accept(',')) {
        const a = it.evalInt()
        if (it.accept(',')) {
          const b = it.evalInt()
          if (img) {
            img.hotX = a
            img.hotY = b
          }
        } else if (img) {
          // predefined code $XY: nibbles select left/middle/right, top/middle/bottom
          const cx = (a >> 4) & 3
          const cy = a & 3
          img.hotX = cx === 1 ? img.width >> 1 : cx === 2 ? img.width : 0
          img.hotY = cy === 1 ? img.height >> 1 : cy === 2 ? img.height : 0
        }
      }
    },
    'make mask'(it) {
      if (!it.atStmtEnd()) it.evalInt() // masks are implicit here
    },
    'no mask'(it) {
      const img = rt.spriteBank?.image(it.atStmtEnd() ? 1 : it.evalInt())
      if (img) img.opaque = true
    },
    'priority on'() {
      rt.priorityOn = true
    },
    'priority off'() {
      rt.priorityOn = false
    },
    'priority reverse on'() {
      rt.priorityOn = true
      rt.priorityReverse = true
    },
    'priority reverse off'() {
      rt.priorityReverse = false
    },

    // ---- hardware sprites ----
    sprite(it) {
      const n = it.evalInt()
      const cur = rt.hwSprites.get(n)
      it.expect(',')
      const x = optInt(it, cur?.x ?? 0)
      it.accept(',')
      const y = optInt(it, cur?.y ?? 0)
      it.accept(',')
      const image = optInt(it, cur?.image ?? 1)
      rt.hwSprites.set(n, { n, x, y, image })
    },
    'sprite off'(it) {
      if (it.atStmtEnd()) rt.hwSprites.clear()
      else rt.hwSprites.delete(it.evalInt())
    },
    'sprite update'(it) {
      it.skipToStmtEnd()
    },

    // ---- zones ----
    'reserve zone'(it) {
      const n = it.atStmtEnd() ? 16 : it.evalInt()
      rt.zones = new Array<null>(n).fill(null)
    },
    'set zone'(it) {
      const n = it.evalInt()
      it.expect(',')
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      while (rt.zones.length < n) rt.zones.push(null)
      rt.zones[n - 1] = { x1, y1, x2, y2 }
    },
    'reset zone'(it) {
      if (it.atStmtEnd()) rt.zones.fill(null)
      else rt.zones[it.evalInt() - 1] = null
    },

    // ---- packed pictures and IFF ----
    unpack(it) {
      // first argument: a bank number, or an ADDRESS inside a bank (many
      // programs keep several packed pictures in one bank with an offset
      // table)
      const src = it.evalInt()
      let bytes: Uint8Array
      const bank = rt.memBanks.get(src)
      if (bank) {
        bytes = bank.data
      } else {
        const m = rt.resolveAddr(src)
        if (!m) throw new AmosError('bank not reserved')
        bytes = m.data.subarray(m.off)
      }
      const pic = parsePacPic(bytes)
      if (it.accept('to')) {
        const n = it.evalInt()
        const sc = pic.screen
        if (!sc) throw new AmosError('bank has no screen header')
        const s = rt.openScreen(n, sc.width, sc.height, sc.nColors, sc.mode)
        for (let i = 0; i < 32; i++) s.palette[i] = sc.palette[i]!
        rt.blit(s, pic, 0, 0, true)
        return
      }
      let x = pic.x
      let y = pic.y
      if (it.accept(',')) {
        x = optInt(it, x) & ~7
        if (it.accept(',')) y = optInt(it, y)
      }
      rt.blit(scr(), pic, x, y, true)
    },
    // ---- dialogs (Interface language) ----
    'dialog open'(it) {
      // InDialogOpen2/3/4 +Lib.s:14330: Dialog Open c,prog[,nvars[,buflen]];
      // prog is a string or a program number (<1024) in the resource bank
      const c = it.evalInt()
      if (c <= 0) throw new AmosError('function call error')
      it.expect(',')
      const prog = it.evalExpr()
      let nVars = 16
      let bufLen = 1024
      if (it.accept(',')) {
        nVars = it.evalInt()
        if (nVars < 0) throw new AmosError('function call error')
        if (it.accept(',')) {
          bufLen = it.evalInt()
          if (bufLen <= 256) throw new AmosError('function call error')
        }
      }
      if (rt.dialogs.has(c)) throw new AmosError(DIALOG_ERRORS[5]!)
      const res = rt.resource()
      let script: string
      if (prog.k === 'str') {
        script = prog.s
      } else {
        const n = int(prog)
        const progs = res.programs
        if (!progs || n < 1 || n > progs.length) throw new AmosError('function call error')
        script = progs[n - 1]!
      }
      const chan = new DialogChannel(c, nVars, res)
      chan.script = script
      chan.screenNb = rt.currentIndex
      try {
        const scan = prescanDialog(script)
        chan.labels = scan.labels
        chan.userInstrs = scan.userInstrs
      } catch (e) {
        if (e instanceof DialogError) {
          rt.dialogErrPos = e.position
          throw new AmosError(e.message)
        }
        throw e
      }
      rt.dialogErrPos = 0
      rt.dialogs.set(c, chan)
    },
    'dialog close'(it) {
      // InDialogClose0/1 +Lib.s:14399
      if (it.atStmtEnd()) {
        rt.dialogs.clear()
        return
      }
      const c = it.evalInt()
      if (c <= 0) throw new AmosError('function call error')
      if (!rt.dialogs.delete(c)) throw new AmosError(DIALOG_ERRORS[6]!)
    },
    'dialog clr'(it) {
      // InDialogClr +Lib.s:14415 → Dia_EffChannel: erase the display,
      // keep the channel
      const c = it.evalInt()
      if (c <= 0) throw new AmosError('function call error')
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      eraseDialog(d, rt.dialogDraw)
    },
    'dialog update'(it) {
      // InDialogUpdate2..5 +Lib.s:14462 → Dia_ZUpdate: push a value into
      // zone z of channel n; elided values just redraw
      const c = it.evalInt()
      if (c <= 0) throw new AmosError('function call error')
      it.expect(',')
      const z = it.evalInt()
      let v: number | null = null
      let p4: number | null = null
      let p5: number | null = null
      if (it.accept(',')) {
        v = it.atStmtEnd() || it.nm() === ',' ? null : it.evalInt()
        if (it.accept(',')) {
          p4 = it.atStmtEnd() || it.nm() === ',' ? null : it.evalInt()
          if (it.accept(',')) p5 = it.evalInt()
        }
      }
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      updateZone(d, z, v, p4, p5, rt.dialogHost, rt.dialogDraw)
    },
    'dialog freeze'(it) {
      // InDialogFreeze0/1 +Lib.s:14426
      if (it.atStmtEnd()) {
        for (const d of rt.dialogs.values()) d.frozen = true
        return
      }
      const c = it.evalInt()
      if (c <= 0) throw new AmosError('function call error')
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      d.frozen = true
    },
    'dialog unfreeze'(it) {
      if (it.atStmtEnd()) {
        for (const d of rt.dialogs.values()) d.frozen = false
        return
      }
      const c = it.evalInt()
      if (c <= 0) throw new AmosError('function call error')
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      d.frozen = false
    },
    vdialog(it) {
      // InVDialog +Lib.s:14550: Vdialog(c,n)=v
      vdialogWrite(it, rt, false)
    },
    'vdialog$'(it) {
      vdialogWrite(it, rt, true)
    },

    // ---- resource banks (Interface language) ----
    'resource bank'(it) {
      // InResourceBank +Lib.s:14933: negative bank = function call error
      const n = it.evalInt()
      if (n < 0) throw new AmosError('function call error')
      rt.resourceBankNumber = n
    },
    'resource unpack'(it) {
      // InResourceUnpack +Lib.s:14998: image n of the puzzle bank onto the
      // current screen at x,y
      const n = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const g = rt.resource().graphics
      if (!g || n <= 0 || n > g.count) throw new AmosError('function call error')
      const pic = g.image(n)
      if (!pic) throw new AmosError('function call error')
      rt.blit(scr(), pic, x, y, true)
    },
    'resource screen open'(it) {
      // InResourceScreenOpen +Lib.s:14912 → Dia_RScOpen 20995: screen n
      // sized sx,sy with colours/mode/palette from the graphics section;
      // colour `flash` gets the system flash animation (config message 46),
      // flash 0 turns the cursor off instead
      const n = it.evalInt()
      it.expect(',')
      const sx = it.evalInt()
      it.expect(',')
      const sy = it.evalInt()
      it.expect(',')
      const flash = it.evalInt()
      if (n >>> 0 >= 8) throw new AmosError('illegal screen number')
      const g = rt.resource().graphics
      if (!g) throw new AmosError('resource bank not present')
      const s = rt.openScreen(n, sx, sy, g.nColors, g.mode & 0x8004)
      for (let i = 0; i < 32; i++) s.palette[i] = g.palette[i]!
      if (flash === 0) {
        s.cursorOn = false
      } else {
        if (flash >= g.nColors) throw new AmosError('function call error')
        // +Interpreter_Config.s:186, system message 46
        const spec =
          '(000,2)(440,2)(880,2)(bb0,2)(dd0,2)(ee0,2)(ff2,2)(ff8,2)(ffc,2)(fff,2)(aaf,2)(88c,2)(66a,2)(226,2)(004,2)(001,2)'
        const seq: Array<{ rgb: number; ticks: number }> = []
        for (const m of spec.matchAll(/\(([0-9a-f]+),(\d+)\)/gi)) {
          seq.push({ rgb: parseInt(m[1]!, 16) & 0xfff, ticks: parseInt(m[2]!, 10) })
        }
        rt.flashes.set(flash & 31, { seq, idx: 0, left: seq[0]!.ticks })
      }
    },

    load(it) {
      // Load "file.abk"[,bank#] — install banks from an .Abk/.AMOS container
      const path = it.evalStr()
      const forced = it.accept(',') ? it.evalInt() : null
      const bytes = rt.fs?.read(path)
      if (!bytes) {
        if (it.policy === 'skip') {
          it.unimplemented.set('load (file missing)', (it.unimplemented.get('load (file missing)') ?? 0) + 1)
          return
        }
        throw new AmosError(`file not found: ${path}`)
      }
      const file = parseAmosFile(bytes)
      for (const bank of file.banks) {
        if (bank.kind === 'sprites') rt.spriteBank = ObjectBank.fromSpriteBank(bank)
        else if (bank.kind === 'icons') rt.iconBank = ObjectBank.fromSpriteBank(bank)
        else if (bank.kind === 'memory') rt.memBanks.set(forced ?? bank.number, bank)
      }
    },
    // ---- audio ----
    'sam bank'(it) {
      rt.samBankNum = it.evalInt()
    },
    'sam play'(it) {
      // Sam Play n | Sam Play voices,n | Sam Play voices,n,freq
      const a = it.evalInt()
      let mask = 0b1111
      let n = a
      let freq: number | null = null
      if (it.accept(',')) {
        mask = a
        n = it.evalInt()
        if (it.accept(',')) freq = it.evalInt()
      }
      const sample = rt.getSample(n)
      if (!sample) throw new AmosError(`sample not defined: ${n}`)
      rt.playPcm(mask, sample.pcm, freq ?? sample.freq, (rt.samLoopMask & mask) !== 0)
    },
    'sam stop'(it) {
      rt.stopVoices(it.atStmtEnd() ? 0b1111 : it.evalInt())
    },
    'sam loop on'(it) {
      rt.samLoopMask |= it.atStmtEnd() ? 0b1111 : it.evalInt()
    },
    'sam loop off'(it) {
      rt.samLoopMask &= ~(it.atStmtEnd() ? 0b1111 : it.evalInt())
    },
    volume(it) {
      // Volume v | Volume voices,v
      const a = it.evalInt()
      let mask = 0b1111
      let vol = a
      if (it.accept(',')) {
        mask = a
        vol = it.evalInt()
      }
      vol = Math.max(0, Math.min(63, vol))
      for (let v = 0; v < 4; v++) {
        if (!(mask & (1 << v))) continue
        rt.voices[v]!.volume = vol
        rt.audio.setVolume(v, vol)
      }
    },
    bell(it) {
      const pitch = it.atStmtEnd() ? 60 : it.evalInt()
      const { pcm, freq } = bellPcm(pitch)
      rt.playPcm(0b0001, pcm, freq, false)
    },
    shoot() {
      const { pcm, freq } = shootPcm()
      rt.playPcm(0b0010, pcm, freq, false)
    },
    boom() {
      const { pcm, freq } = boomPcm()
      rt.playPcm(0b0100, pcm, freq, false)
    },
    voice(it) {
      it.evalInt() // voice activation mask (music voices) — nothing to gate yet
    },
    'led on': () => {}, // the power-LED audio filter — no filter to toggle
    'led off': () => {},

    // ---- menus ----
    'menu$'(it) {
      // Menu$(m)="Title" / Menu$(m,i)="Item" / deeper sub-items accepted
      it.expect('(')
      const m = it.evalInt()
      const i = it.accept(',') ? it.evalInt() : null
      while (it.accept(',')) it.evalInt() // sub-sub menus: parsed, one level kept
      it.expect(')')
      it.expectOp('=')
      const t = it.evalStr()
      const menus = rt.menus
      if (i === null) {
        while (menus.titles.length < m) {
          menus.titles.push('')
          menus.items.push([])
        }
        menus.titles[m - 1] = t
      } else {
        while (menus.items.length < m) {
          menus.titles.push('')
          menus.items.push([])
        }
        const items = menus.items[m - 1]!
        while (items.length < i) items.push('')
        items[i - 1] = t
      }
    },
    'menu on'(it) {
      if (!it.atStmtEnd()) it.evalInt() // menu bank — unsupported
      rt.menus.on = true
    },
    'menu off'() {
      rt.menus.on = false
    },
    'on menu'(it) {
      // On Menu Gosub L1[,L2...] / On Menu Proc P1[,P2...]
      const kind = it.nm()
      if (kind !== 'gosub' && kind !== 'proc') throw new AmosError('On Menu needs Gosub or Proc')
      it.advance()
      const targets: string[] = []
      for (;;) {
        const t = it.tok()
        if (t === undefined || !('name' in t)) throw new AmosError('label expected')
        it.advance()
        targets.push(t.name.toLowerCase())
        if (!it.accept(',')) break
      }
      rt.onMenu = { kind, targets, armed: false }
    },
    'on menu on'() {
      if (rt.onMenu) rt.onMenu.armed = true
    },
    'on menu off'() {
      if (rt.onMenu) rt.onMenu.armed = false
    },
    'on menu del'() {
      rt.onMenu = null
    },
    'menu key'(it) {
      it.skipToStmtEnd() // keyboard shortcuts — not wired to selections yet
    },

    // ---- blocks ----
    'get block'(it) {
      const n = it.evalInt()
      it.expect(',')
      const [x, y] = pair(it)
      it.expect(',')
      const [w, h] = pair(it)
      const mask = it.accept(',') ? it.evalInt() !== 0 : false
      const img = rt.grab(scr(), x, y, x + w, y + h)
      rt.blocks.set(n, { x, y, w, h, pixels: img.pixels, mask })
    },
    'put block'(it) {
      const b = rt.blocks.get(it.evalInt())
      if (!b) throw new AmosError('block not defined')
      let x = b.x
      let y = b.y
      if (it.accept(',')) {
        x = it.evalInt()
        it.expect(',')
        y = it.evalInt()
        while (it.accept(',')) it.evalInt() // planes/minterm
      }
      rt.blit(scr(), { width: b.w, height: b.h, pixels: b.pixels }, x, y, !b.mask)
    },
    'del block'(it) {
      if (it.atStmtEnd()) rt.blocks.clear()
      else rt.blocks.delete(it.evalInt())
    },
    'get cblock'(it) {
      const n = it.evalInt()
      it.expect(',')
      const [x, y] = pair(it)
      it.expect(',')
      const [w, h] = pair(it)
      const img = rt.grab(scr(), x, y, x + w, y + h)
      rt.cblocks.set(n, { x, y, w, h, pixels: img.pixels })
    },
    'put cblock'(it) {
      const b = rt.cblocks.get(it.evalInt())
      if (!b) throw new AmosError('block not defined')
      let x = b.x
      let y = b.y
      if (it.accept(',')) {
        x = it.evalInt()
        it.expect(',')
        y = it.evalInt()
      }
      rt.blit(scr(), { width: b.w, height: b.h, pixels: b.pixels }, x, y, true)
    },
    'del cblock'(it) {
      if (it.atStmtEnd()) rt.cblocks.clear()
      else rt.cblocks.delete(it.evalInt())
    },

    // ---- screens extra ----
    'screen clone'(it) {
      const n = it.evalInt()
      const src = scr()
      const clone = rt.openScreen(n, src.width, src.height, src.nColors, (src.hires ? 0x8000 : 0) | (src.laced ? 4 : 0))
      clone.pixels = src.pixels // shared bitmap
      clone.back = src.back
      clone.palette = src.palette
      rt.setCurrent(src.index)
    },
    'sprite update on'() {
      rt.spriteUpdateOn = true
      rt.frozenSprites = null
    },
    'sprite update off'() {
      rt.frozenSprites = [...rt.hwSprites.values()].map((s2) => ({ ...s2 }))
      rt.spriteUpdateOn = false
    },
    'hscroll'(it) {
      // 1: line left, 2: window left, 3: line right, 4: window right
      const t = it.evalInt()
      const s = scr()
      const w = s.curWin
      const y1 = t === 1 || t === 3 ? w.y + w.curY * 8 : w.y
      const h = t === 1 || t === 3 ? 8 : w.rows * 8
      const dx = t <= 2 ? -8 : 8
      Screen.copy(s, w.x, y1, w.x + w.cols * 8, y1 + h, s, w.x + dx, y1)
    },
    'vscroll'(it) {
      // 1: down from cursor, 2: window up, 3: window down, 4: up from cursor
      const t = it.evalInt()
      const s = scr()
      const w = s.curWin
      const dy = t === 2 || t === 4 ? -8 : 8
      Screen.copy(s, w.x, w.y, w.x + w.cols * 8, w.y + w.rows * 8, s, w.x, w.y + dy)
    },

    // ---- text styles ----
    'under on'() {
      scr().curWin.style |= 1
    },
    'under off'() {
      scr().curWin.style &= ~1
    },
    'shade on'() {
      scr().curWin.shade = true
    },
    'shade off'() {
      scr().curWin.shade = false
    },
    'inverse on'() {
      scr().curWin.inverse = true
    },
    'inverse off'() {
      scr().curWin.inverse = false
    },
    'set text'(it) {
      scr().curWin.style = it.evalInt() & 7
    },
    'scroll on'() {
      scr().curWin.scrollOff = false
    },
    'scroll off'() {
      scr().curWin.scrollOff = true
    },
    'key speed'(it) {
      it.evalInt()
      if (it.accept(',')) it.evalInt() // repeat rates — host handles keys
    },
    'change mouse'(it) {
      it.evalInt() // pointer shape — host cursor is shown instead
    },

    // ---- memory / banks ----
    'reserve as data': reserve('Datas'),
    'reserve as work': reserve('Work'),
    'reserve as chip data': reserve('Datas'),
    'reserve as chip work': reserve('Work'),
    erase(it) {
      const n = it.evalInt()
      if (n === 1 && rt.spriteBank) {
        rt.spriteBank = null
        return
      }
      if (n === 2 && rt.iconBank) {
        rt.iconBank = null
        return
      }
      if (!rt.memBanks.delete(n)) throw new AmosError('bank not reserved')
    },
    'erase all'() {
      rt.memBanks.clear()
      rt.spriteBank = null
      rt.iconBank = null
    },
    'erase temp'() {
      for (const [n, b] of [...rt.memBanks]) {
        if (/work/i.test(b.name)) rt.memBanks.delete(n)
      }
    },
    'bank swap'(it) {
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      // banks 1/2 are the sprite/icon object banks
      if ((a === 1 || a === 2) && (b === 1 || b === 2) && a !== b) {
        const t = rt.spriteBank
        rt.spriteBank = rt.iconBank
        rt.iconBank = t
        return
      }
      const ba = rt.memBanks.get(a)
      const bb = rt.memBanks.get(b)
      if (!ba || !bb) throw new AmosError('bank not reserved')
      rt.memBanks.set(a, { ...bb, number: a })
      rt.memBanks.set(b, { ...ba, number: b })
    },
    'bank shrink'(it) {
      const n = it.evalInt()
      it.expect('to')
      const len = it.evalInt()
      const bank = rt.memBanks.get(n)
      if (!bank) throw new AmosError('bank not reserved')
      bank.data = bank.data.subarray(0, len)
    },
    'list bank'(it) {
      for (const [n, b] of [...rt.memBanks].sort((x, y2) => x[0] - y2[0])) {
        it.write(` ${n} ${b.name.padEnd(10)} S:$${rt.bankBase(n).toString(16).toUpperCase()} L:${b.data.length}\n`)
      }
    },
    poke(it) {
      const addr = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const m = rt.resolveAddr(addr)
      if (m) m.data[m.off] = v & 0xff
    },
    doke(it) {
      const addr = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const m = rt.resolveAddr(addr)
      if (m && m.off + 1 < m.data.length) {
        m.data[m.off] = (v >> 8) & 0xff
        m.data[m.off + 1] = v & 0xff
      }
    },
    loke(it) {
      const addr = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const m = rt.resolveAddr(addr)
      if (m && m.off + 3 < m.data.length) {
        m.data[m.off] = (v >>> 24) & 0xff
        m.data[m.off + 1] = (v >>> 16) & 0xff
        m.data[m.off + 2] = (v >>> 8) & 0xff
        m.data[m.off + 3] = v & 0xff
      }
    },
    'poke$'(it) {
      const addr = it.evalInt()
      it.expect(',')
      const str2 = it.evalStr()
      const m = rt.resolveAddr(addr)
      if (m) for (let i = 0; i < str2.length && m.off + i < m.data.length; i++) m.data[m.off + i] = str2.charCodeAt(i) & 0xff
    },
    fill(it) {
      const start = it.evalInt()
      it.expect('to')
      const end = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const m = rt.resolveAddr(start)
      if (!m) return
      const len = Math.min(end - start, m.data.length - m.off)
      for (let i = 0; i + 3 < len; i += 4) {
        m.data[m.off + i] = (v >>> 24) & 0xff
        m.data[m.off + i + 1] = (v >>> 16) & 0xff
        m.data[m.off + i + 2] = (v >>> 8) & 0xff
        m.data[m.off + i + 3] = v & 0xff
      }
    },
    copy(it) {
      const start = it.evalInt()
      it.expect(',')
      const end = it.evalInt()
      it.expect('to')
      const dest = it.evalInt()
      const src = rt.resolveAddr(start)
      const dst = rt.resolveAddr(dest)
      if (!src || !dst) return
      const len = Math.min(end - start, src.data.length - src.off, dst.data.length - dst.off)
      dst.data.set(src.data.subarray(src.off, src.off + len), dst.off)
    },
    bload(it) {
      const path = it.evalStr()
      it.expect(',')
      const dest = it.evalInt()
      const bytes = rt.fs?.read(path)
      if (!bytes) throw new AmosError(`file not found: ${path}`)
      if (dest > 0 && dest < 0x10000) {
        // small value: a bank number (Bnk.OrAdr)
        rt.memBanks.set(dest, { kind: 'memory', number: dest, memType: 0, name: 'Datas', flags: 0, data: Uint8Array.from(bytes) })
        return
      }
      const m = rt.resolveAddr(dest)
      if (m) m.data.set(bytes.subarray(0, m.data.length - m.off), m.off)
    },
    bsave(it) {
      const path = it.evalStr()
      it.expect(',')
      const start = it.evalInt()
      it.expect('to')
      const end = it.evalInt()
      const m = rt.resolveAddr(start)
      if (!m) throw new AmosError('address error')
      const len = Math.min(end - start, m.data.length - m.off)
      if (!rt.vfs?.writeFile(path, Uint8Array.from(m.data.subarray(m.off, m.off + len)))) {
        throw new AmosError('disc is write protected')
      }
    },
    'sam raw'(it) {
      const mask = it.evalInt()
      it.expect(',')
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      it.expect(',')
      const freq = it.evalInt()
      const m = rt.resolveAddr(addr)
      if (!m) return
      const pcm = new Int8Array(m.data.buffer, m.data.byteOffset + m.off, Math.min(len, m.data.length - m.off))
      rt.playPcm(mask, pcm, freq, false)
    },
    'hrev block'(it) {
      const b = rt.blocks.get(it.evalInt())
      if (!b) return
      for (let y = 0; y < b.h; y++) b.pixels.subarray(y * b.w, (y + 1) * b.w).reverse()
    },
    'vrev block'(it) {
      const b = rt.blocks.get(it.evalInt())
      if (!b) return
      for (let y = 0; y < b.h >> 1; y++) {
        const a = b.pixels.slice(y * b.w, (y + 1) * b.w)
        b.pixels.copyWithin(y * b.w, (b.h - 1 - y) * b.w, (b.h - y) * b.w)
        b.pixels.set(a, (b.h - 1 - y) * b.w)
      }
    },

    // ---- files (Open In/Out, Print #, sequential channels) ----
    'open in'(it) {
      const n = it.evalInt()
      it.expect(',')
      const path = it.evalStr()
      const data = rt.fs?.read(path)
      if (data == null) throw new AmosError(`file not found: ${path}`)
      rt.fileChans.set(n, { mode: 'in', path, data, pos: 0, out: [] })
    },
    'open out'(it) {
      const n = it.evalInt()
      it.expect(',')
      const path = it.evalStr()
      rt.fileChans.set(n, { mode: 'out', path, data: new Uint8Array(0), pos: 0, out: [] })
    },
    append(it) {
      const n = it.evalInt()
      it.expect(',')
      const path = it.evalStr()
      const existing = rt.fs?.read(path)
      rt.fileChans.set(n, { mode: 'out', path, data: new Uint8Array(0), pos: 0, out: existing ? [...existing] : [] })
    },
    close(it) {
      if (it.atStmtEnd()) {
        for (const n of [...rt.fileChans.keys()]) rt.closeChannel(n)
        return
      }
      rt.closeChannel(it.evalInt())
    },
    'print #'(it) {
      const n = it.evalInt()
      const c = rt.chan(n)
      if (c.mode !== 'out') throw new AmosError('file type mismatch')
      it.accept(',')
      const put = (t: string): void => {
        for (let i = 0; i < t.length; i++) c.out.push(t.charCodeAt(i) & 0xff)
      }
      let nl = true
      while (!it.atStmtEnd()) {
        if (it.accept(';')) {
          nl = false
          continue
        }
        if (it.accept(',')) {
          put('\x09')
          nl = false
          continue
        }
        put(it.formatValue(it.evalExpr()))
        nl = true
      }
      if (nl) put('\r\n') // sp14: CR+LF line ends
    },
    'input #'(it) {
      const n = it.evalInt()
      it.expect(',')
      do {
        const tg = it.parseTarget()
        const raw = rt.readField(n, true) // Input # splits at commas
        if (tg.type === 2) tg.set(VS(raw))
        else tg.set(parseAmosNumber(raw))
      } while (it.accept(','))
    },
    'line input #'(it) {
      const n = it.evalInt()
      it.expect(',')
      do {
        const tg = it.parseTarget()
        const raw = rt.readField(n, false)
        if (tg.type === 2) tg.set(VS(raw))
        else tg.set(parseAmosNumber(raw))
      } while (it.accept(','))
    },
    pof(it) {
      // assignment form: Pof(n) = position
      it.expect('(')
      const c = rt.chan(it.evalInt())
      it.expect(')')
      it.expectOp('=')
      const v = it.evalInt()
      if (c.mode === 'in') c.pos = Math.max(0, Math.min(c.data.length, v))
      else c.out.length = Math.max(0, Math.min(c.out.length, v))
    },
    'set input'(it) {
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      rt.chrInp = [a & 0xff, b < 0 ? -1 : b & 0xff]
    },
    mkdir(it) {
      if (!rt.vfs?.mkdir(it.evalStr())) throw new AmosError('disc error')
    },
    kill(it) {
      if (!rt.vfs?.deleteFile(it.evalStr())) throw new AmosError('file not found')
    },
    rename(it) {
      const from = it.evalStr()
      it.expect('to')
      if (!rt.vfs?.rename(from, it.evalStr())) throw new AmosError('file not found')
    },
    assign(it) {
      const name = it.evalStr()
      it.expect('to')
      rt.vfs?.assign(name, it.evalStr())
    },
    'dir$'(it) {
      // assignment form: Dir$ = "path"
      it.expectOp('=')
      const path = it.evalStr()
      if (!rt.vfs?.setCurrentDir(path)) throw new AmosError(`directory not found: ${path}`)
    },
    dir(it) {
      const path = it.atStmtEnd() ? '' : it.evalStr()
      const entries = rt.vfs?.listDir(path === '' ? rt.vfs.currentDir : path)
      if (!entries) throw new AmosError('directory not found')
      for (const e of entries) {
        it.write((e.isDir ? '*' + e.name : ' ' + e.name) + '\n')
      }
    },
    'set dir'(it) {
      it.skipToStmtEnd() // listing width/filter — cosmetic
    },

    // ---- AMAL ----
    amal(it) {
      const n = it.evalInt()
      it.expect(',')
      const v = it.evalExpr()
      if (v.k !== 'str') {
        // numeric form: a pre-compiled program from the AMAL bank
        it.unimplemented.set('amal (bank program)', (it.unimplemented.get('amal (bank program)') ?? 0) + 1)
        return
      }
      let prog
      try {
        prog = compileAmal(v.s)
      } catch (e) {
        if (e instanceof AmalCompileError) {
          rt.amalErrPos = e.position
          throw new AmosError(`syntax error in animation string: ${e.message}`)
        }
        throw e
      }
      const target = rt.chanTargets.get(n) ?? rt.makeChannelTarget('sprite', n)
      const ch = new AmalChannel(n, prog, target)
      ch.on = rt.amalDefaultOn
      rt.channels.set(n, ch)
    },
    channel(it) {
      const n = it.evalInt()
      it.expect('to')
      const kind = it.nm()
      if (
        kind !== 'bob' &&
        kind !== 'sprite' &&
        kind !== 'screen display' &&
        kind !== 'screen offset' &&
        kind !== 'screen size' &&
        kind !== 'rainbow'
      ) {
        throw new AmosError('Channel: Bob/Sprite/Screen Display/Screen Offset/Rainbow expected')
      }
      it.advance()
      const m = it.evalInt()
      const target = rt.makeChannelTarget(kind, m)
      rt.chanTargets.set(n, target)
      const ch = rt.channels.get(n)
      if (ch) ch.target = target
    },
    'amal on'(it) {
      if (it.atStmtEnd()) {
        rt.amalDefaultOn = true
        for (const ch of rt.channels.values()) {
          ch.on = true
          ch.frozen = false
        }
        return
      }
      const ch = rt.channels.get(it.evalInt())
      if (ch) {
        ch.on = true
        ch.frozen = false
      }
    },
    'amal off'(it) {
      if (it.atStmtEnd()) {
        rt.amalDefaultOn = false
        for (const ch of rt.channels.values()) ch.on = false
        return
      }
      const ch = rt.channels.get(it.evalInt())
      if (ch) ch.on = false
    },
    'amal freeze'(it) {
      if (it.atStmtEnd()) {
        for (const ch of rt.channels.values()) ch.frozen = true
        return
      }
      const ch = rt.channels.get(it.evalInt())
      if (ch) ch.frozen = true
    },
    synchro(it) {
      if (rt.synchroManual) rt.stepAmal()
      void it
    },
    'synchro on'() {
      rt.synchroManual = false
    },
    'synchro off'() {
      rt.synchroManual = true
    },
    amreg(it) {
      // assignment form: Amreg([channel,] n) = value
      it.expect('(')
      const a = it.evalInt()
      const b = it.accept(',') ? it.evalInt() : null
      it.expect(')')
      it.expectOp('=')
      const v = it.evalInt()
      if (b === null) {
        if (a >= 0 && a < 26) rt.amalGlobals[a] = v
      } else {
        const ch = rt.channels.get(a)
        if (ch && b >= 0 && b < 10) ch.regs[b] = v
      }
    },

    'load iff'(it) {
      const path = it.evalStr()
      const n = it.accept(',') ? it.evalInt() : null
      const bytes = rt.fs?.read(path)
      if (!bytes) {
        if (it.policy === 'skip') {
          it.unimplemented.set('load iff (file missing)', (it.unimplemented.get('load iff (file missing)') ?? 0) + 1)
          return
        }
        throw new AmosError(`file not found: ${path}`)
      }
      const img = parseIlbm(bytes)
      if (n !== null && img.width > 0) {
        rt.openScreen(n, img.width, img.height, 1 << img.depth, (img.mode & 0x8000) | (img.mode & 4))
      }
      const s = scr()
      for (let i = 0; i < Math.min(32, img.palette.length); i++) s.palette[i] = img.palette[i]!
      if (img.width > 0) rt.blit(s, img, 0, 0, true)
    },
  }

  /** Reserve As ... n,length */
  function reserve(name: string): Instr {
    return (it) => {
      const n = it.evalInt()
      it.expect(',')
      rt.reserveBank(n, it.evalInt(), name)
    }
  }

  function bankPalette(): Instr {
    return (it) => {
      const mask = it.atStmtEnd() ? -1 : it.evalInt()
      const pal = rt.spriteBank?.palette
      if (pal) {
        for (let i = 0; i < Math.min(32, pal.length); i++) {
          if (mask & (1 << i)) scr().palette[i] = pal[i]!
        }
      }
    }
  }

  /** Get Bob/Sprite/Icon: [screen,] image, x1,y1 To x2,y2 */
  function getObj(kind: 'sprite' | 'icon'): Instr {
    return (it) => {
      const args: number[] = [it.evalInt()]
      while (it.accept(',')) {
        args.push(it.evalInt())
        if (it.nm() === 'to') break
      }
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      let s = scr()
      let img: number
      let x1: number
      let y1: number
      if (args.length === 4) {
        const sc = rt.screens.get(args[0]!)
        if (!sc) throw new AmosError(`screen not opened: ${args[0]}`)
        s = sc
        ;[img, x1, y1] = [args[1]!, args[2]!, args[3]!]
      } else if (args.length === 3) {
        ;[img, x1, y1] = [args[0]!, args[1]!, args[2]!]
      } else {
        throw new AmosError('Get Bob: wrong arguments')
      }
      const bank = kind === 'icon' ? (rt.iconBank ??= new ObjectBank()) : rt.needSpriteBank()
      bank.setImage(img, rt.grab(s, x1, y1, x2, y2))
    }
  }

  function polyish(close: boolean): Instr {
    return (it) => {
      const s = scr()
      let x1: number
      let y1: number
      if (it.accept('to')) {
        x1 = s.grX
        y1 = s.grY
      } else {
        ;[x1, y1] = pair(it)
        it.expect('to')
      }
      const startX = x1
      const startY = y1
      do {
        const [x2, y2] = pair(it)
        s.line(x1, y1, x2, y2)
        x1 = x2
        y1 = y2
      } while (it.accept('to'))
      if (close) s.line(x1, y1, startX, startY)
    }
  }
}

/** raw-parsed runtime functions (their args use To syntax) */
export function makeRawFunctions(rt: Runtime): Record<string, (it: It) => import('../interp/values').Value> {
  return {
    array(it) {
      // =Array(A(0)): the array's "address" — in the port an opaque handle
      // (> 1024) resolvable by the dialog engine's AR/AS and list zones
      it.expect('(')
      const arr = it.parseArrayRef()
      it.expect(')')
      for (const [h, known] of rt.dialogArrays) if (known === arr) return VI(h)
      const handle = 0x10000 + rt.dialogArrays.size
      rt.dialogArrays.set(handle, arr)
      return VI(handle)
    },
    hunt(it) {
      // Hunt(start To finish, s$)
      it.expect('(')
      const start = it.evalInt()
      it.expect('to')
      const finish = it.evalInt()
      it.expect(',')
      const needle = it.evalStr()
      it.expect(')')
      const m = rt.resolveAddr(start)
      if (!m || needle === '') return VI(0)
      const len = Math.min(finish - start, m.data.length - m.off)
      outer: for (let i = 0; i + needle.length <= len; i++) {
        for (let k = 0; k < needle.length; k++) {
          if (m.data[m.off + i + k] !== (needle.charCodeAt(k) & 0xff)) continue outer
        }
        return VI(start + i)
      }
      return VI(0)
    },
  }
}

export function makeFunctions(rt: Runtime): Record<string, Func> {
  const scr = (): Screen => rt.screen
  return {
    point(_, a) {
      const [x, y] = [a[0], a[1]]
      if (x === undefined || y === undefined) throw new AmosError('wrong number of arguments')
      return VI(scr().point(int(x), int(y)))
    },
    screen(_, a) {
      void a
      return VI(rt.currentIndex)
    },
    'screen width'(_, a) {
      return VI((a.length > 0 ? rt.screens.get(int(a[0]!)) ?? scr() : scr()).width)
    },
    'screen height'(_, a) {
      return VI((a.length > 0 ? rt.screens.get(int(a[0]!)) ?? scr() : scr()).height)
    },
    'screen colour'(_, a) {
      void a
      return VI(scr().nColors)
    },
    colour(_, a) {
      if (a.length !== 1) throw new AmosError('wrong number of arguments')
      return VI(scr().palette[int(a[0]!) & 31]!)
    },
    xgr() {
      return VI(scr().grX)
    },
    ygr() {
      return VI(scr().grY)
    },
    lowres() {
      return VI(0)
    },
    hires() {
      return VI(0x8000)
    },
    laced() {
      return VI(0x4)
    },
    'x screen'(_, a) {
      const x = int(a[a.length - 1]!)
      return VI((x - 128) * (scr().hires ? 2 : 1) + scr().offsetX)
    },
    'y screen'(_, a) {
      const y = int(a[a.length - 1]!)
      return VI(y - 50 + scr().offsetY)
    },
    'x hard'(_, a) {
      const x = int(a[a.length - 1]!)
      return VI(Math.trunc((x - scr().offsetX) / (scr().hires ? 2 : 1)) + 128)
    },
    'y hard'(_, a) {
      const y = int(a[a.length - 1]!)
      return VI(y - scr().offsetY + 50)
    },
    'screen base'() {
      return VI(0)
    },
    logic(_, a) {
      // Logic() = $BFFFFFFF, Logic(n) = $80000000|n (FnLogic0/1)
      if (a.length === 0) return VI(0xbfffffff | 0)
      return VI((0x80000000 | (int(a[0]!) & 0xff)) | 0)
    },
    physic(_, a) {
      if (a.length === 0) return VI(-1)
      return VI((0xc0000000 | (int(a[0]!) & 0xff)) | 0)
    },
    'text length'(_, a) {
      return VI(str(a[0]!).length * 8)
    },
    'text base'() {
      return VI(6)
    },
    windon(_, a) {
      void a
      return VI(scr().curWin.n)
    },
    'x curs'(_, a) {
      void a
      return VI(scr().curX)
    },
    'y curs'(_, a) {
      void a
      return VI(scr().curY)
    },
    'zone$'(_, a) {
      void a
      return VS('')
    },

    // ---- objects ----
    'x bob'(_, a) {
      return VI(rt.bobs.get(int(a[0]!))?.x ?? 0)
    },
    'y bob'(_, a) {
      return VI(rt.bobs.get(int(a[0]!))?.y ?? 0)
    },
    'i bob'(_, a) {
      return VI(rt.bobs.get(int(a[0]!))?.image ?? 0)
    },
    'x sprite'(_, a) {
      return VI(rt.hwSprites.get(int(a[0]!))?.x ?? 0)
    },
    'y sprite'(_, a) {
      return VI(rt.hwSprites.get(int(a[0]!))?.y ?? 0)
    },
    'i sprite'(_, a) {
      return VI(rt.hwSprites.get(int(a[0]!))?.image ?? 0)
    },
    'bob col'(_, a) {
      return VI(rt.bobColCheck(int(a[0]!), a.length > 1 ? int(a[1]!) : -Infinity, a.length > 2 ? int(a[2]!) : Infinity))
    },
    'sprite col'(_, a) {
      return VI(rt.spriteColCheck(int(a[0]!), a.length > 1 ? int(a[1]!) : -Infinity, a.length > 2 ? int(a[2]!) : Infinity))
    },
    col(_, a) {
      return VI(rt.colSet.has(int(a[0]!)) ? -1 : 0)
    },
    zone(_, a) {
      // Zone(x,y) or Zone(screen,x,y) — coordinates are the last two args
      const x = int(a[a.length - 2]!)
      const y = int(a[a.length - 1]!)
      return VI(rt.zoneAt(x, y))
    },
    hzone(_, a) {
      const s = scr()
      const x = (int(a[a.length - 2]!) - s.displayX) * (s.hires ? 2 : 1) + s.offsetX
      const y = int(a[a.length - 1]!) - s.displayY + s.offsetY
      return VI(rt.zoneAt(x, y))
    },
    'mouse zone'(it, a) {
      void a
      const s = scr()
      const x = (it.inp.mouseX - s.displayX) * (s.hires ? 2 : 1) + s.offsetX
      const y = it.inp.mouseY - s.displayY + s.offsetY
      return VI(rt.zoneAt(x, y))
    },
    exist(_, a) {
      return VI(rt.fs?.read(str(a[0]!)) !== null && rt.fs !== null ? -1 : 0)
    },
    scin(_, a) {
      // ScIn(x,y): which screen is under this hardware coordinate?
      const x = int(a[a.length - 2]!)
      const y = int(a[a.length - 1]!)
      for (let i = rt.order.length - 1; i >= 0; i--) {
        const s = rt.screens.get(rt.order[i]!)
        if (!s || !s.visible) continue
        const sx = (x - s.displayX) * (s.hires ? 2 : 1)
        const sy = y - s.displayY
        if (sx >= 0 && sy >= 0 && sx < s.width && sy < s.height) return VI(s.index)
      }
      return VI(-1)
    },
    'key shift'(it, a) {
      void a
      let m = 0
      if (it.inp.keys.has(0x60)) m |= 1
      if (it.inp.keys.has(0x61)) m |= 2
      if (it.inp.keys.has(0x62)) m |= 4
      if (it.inp.keys.has(0x63)) m |= 8
      if (it.inp.keys.has(0x64)) m |= 16
      if (it.inp.keys.has(0x65)) m |= 32
      return VI(m)
    },
    length(_, a) {
      const n = int(a[0]!)
      if (n === 1) return VI(rt.spriteBank?.images.length ?? 0)
      if (n === 2) return VI(rt.iconBank?.images.length ?? 0)
      return VI(rt.memBanks.get(n)?.data.length ?? 0)
    },

    // ---- AMAL ----
    amreg(_, a) {
      if (a.length === 2) {
        const ch = rt.channels.get(int(a[0]!))
        const r = int(a[1]!)
        return VI(ch && r >= 0 && r < 10 ? ch.regs[r]! : 0)
      }
      const n = int(a[0]!)
      return VI(n >= 0 && n < 26 ? rt.amalGlobals[n]! : 0)
    },
    chanan(_, a) {
      return VI(rt.channels.get(int(a[0]!))?.animating ? -1 : 0)
    },
    chanmv(_, a) {
      return VI(rt.channels.get(int(a[0]!))?.moving ? -1 : 0)
    },
    amalerr() {
      return VI(rt.amalErrPos)
    },

    // ---- audio ----
    vumeter(_, a) {
      return VI(rt.vumeter(int(a[0]!)))
    },

    // ---- files ----
    eof(_, a) {
      const c = rt.chan(int(a[0]!))
      return VI(c.mode === 'in' && c.pos >= c.data.length ? -1 : 0)
    },
    lof(_, a) {
      const c = rt.chan(int(a[0]!))
      return VI(c.mode === 'in' ? c.data.length : c.out.length)
    },
    pof(_, a) {
      const c = rt.chan(int(a[0]!))
      return VI(c.mode === 'in' ? c.pos : c.out.length)
    },
    'input$'(it, a) {
      if (a.length === 2) {
        // Input$(channel, count): read raw bytes from the file
        const c = rt.chan(int(a[0]!))
        if (c.mode !== 'in') throw new AmosError('file type mismatch')
        const n = int(a[1]!)
        let out = ''
        for (let i = 0; i < n && c.pos < c.data.length; i++) out += String.fromCharCode(c.data[c.pos++]!)
        return VS(out)
      }
      // Input$(n): n keys from the keyboard queue (non-blocking best effort)
      const n = int(a[0]!)
      let out = ''
      for (let i = 0; i < n; i++) {
        const k = it.inp.keyQueue.shift()
        if (!k) break
        out += k.ch
      }
      return VS(out)
    },
    'dir$'(_, a) {
      void a
      return VS(rt.vfs?.currentDir ?? '')
    },
    'dir first$'(_, a) {
      const pattern = a.length > 0 ? str(a[0]!) : '*'
      const vfs = rt.vfs
      if (!vfs) return VS('')
      // a path prefix may be included: "Data:pics/*.IFF"
      const slash = Math.max(pattern.lastIndexOf('/'), pattern.lastIndexOf(':'))
      const dirPart = slash >= 0 ? pattern.slice(0, slash + 1) : ''
      const filePart = slash >= 0 ? pattern.slice(slash + 1) : pattern
      const entries = vfs.listDir(dirPart === '' ? vfs.currentDir : dirPart) ?? []
      const rx = amigaPattern(filePart === '' ? '*' : filePart)
      rt.dirIter = { entries: entries.filter((e) => rx.test(e.name)), idx: 0 }
      return VS(nextDirEntry())
    },
    'dir next$'(_, a) {
      void a
      return VS(nextDirEntry())
    },
    dfree(_, a) {
      void a
      return VI(0x7fffffff)
    },
    choice(_, a) {
      const m = rt.menus
      if (a.length === 0) {
        const v = m.choiceFlag ? -1 : 0
        m.choiceFlag = false
        return VI(v)
      }
      const which = int(a[0]!)
      if (!m.selection) return VI(0)
      return VI(which === 2 ? m.selection[1] : m.selection[0])
    },

    'dialog run'(it, a) {
      // FnDialogRun1/2/4 +Lib.s:14500: =Dialog Run(c[,label][,x,y]); RU in
      // the script blocks the interpreter until the wait loop exits
      const c = int(a[0]!)
      if (c <= 0) throw new AmosError('function call error')
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      if (d.runState === 'done') {
        d.runState = 'idle'
        return VI(d.ret)
      }
      if (d.runState === 'waiting') {
        it.block({ type: 'dialog', channel: c }, true)
        return VI(0)
      }
      const label = a.length >= 2 ? int(a[1]!) : -1
      if (label >= 65536) throw new AmosError('function call error')
      const x = a.length >= 4 ? int(a[2]!) : null
      const y = a.length >= 4 ? int(a[3]!) : null
      const r = rt.runDialog(c, label, x, y)
      if (r === 'blocked') {
        it.block({ type: 'dialog', channel: c }, true)
        return VI(0)
      }
      return VI(r)
    },
    'dialog box'(it, a) {
      // FnDialogBox1..5 +Lib.s:14655 → Dia_RunQuick 20437: a temporary
      // channel >= 65536 runs the script (or bank program) synchronously;
      // v and v$ seed vars 0 and 1
      if (rt.dialogBoxChan !== null) {
        const d = rt.dialogs.get(rt.dialogBoxChan)
        if (d && d.runState === 'done') {
          const ret = d.ret
          rt.dialogs.delete(rt.dialogBoxChan)
          rt.dialogBoxChan = null
          return VI(ret)
        }
        if (d && d.runState === 'waiting') {
          it.block({ type: 'dialog', channel: rt.dialogBoxChan }, true)
          return VI(0)
        }
        rt.dialogBoxChan = null
      }
      const res = rt.resource()
      let script: string
      if (a[0]!.k === 'str') {
        script = a[0]!.s
      } else {
        const n = int(a[0]!)
        const progs = res.programs
        if (!progs || n < 1 || n > progs.length) throw new AmosError('function call error')
        script = progs[n - 1]!
      }
      let c = 65536
      while (rt.dialogs.has(c)) c++
      const chan = new DialogChannel(c, 16, res)
      chan.script = script
      chan.screenNb = rt.currentIndex
      try {
        const scan = prescanDialog(script)
        chan.labels = scan.labels
        chan.userInstrs = scan.userInstrs
      } catch (e) {
        if (e instanceof DialogError) {
          rt.dialogErrPos = e.position
          throw new AmosError(e.message)
        }
        throw e
      }
      chan.vars[0] = a.length >= 2 ? int(a[1]!) : 0
      chan.vars[1] = a.length >= 3 ? str(a[2]!) : ''
      rt.dialogs.set(c, chan)
      const x = a.length >= 5 ? int(a[3]!) : null
      const y = a.length >= 5 ? int(a[4]!) : null
      const r = rt.runDialog(c, -1, x, y)
      if (r === 'blocked') {
        rt.dialogBoxChan = c
        it.block({ type: 'dialog', channel: c }, true)
        return VI(0)
      }
      rt.dialogs.delete(c)
      return VI(r)
    },
    dialog(_, a) {
      // FnDialog +Lib.s:14538 → Dia_GetReturn: -1 when not drawn, else the
      // return value, read-and-cleared (one-shot)
      const c = int(a[0]!)
      if (c <= 0) throw new AmosError('function call error')
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      if (!d.drawn) return VI(-1)
      const v = d.ret
      d.ret = 0
      return VI(v)
    },
    vdialog(_, a) {
      // FnVDialog +Lib.s:14563: raw long read; string slots read as 0
      const d = rt.dialogs.get(int(a[0]!))
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      const n = int(a[1]!)
      if (n < 0 || n >= d.vars.length) throw new AmosError(DIALOG_ERRORS[8]!)
      const v = d.vars[n]!
      return VI(typeof v === 'number' ? v : 0)
    },
    'vdialog$'(_, a) {
      const d = rt.dialogs.get(int(a[0]!))
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      const n = int(a[1]!)
      if (n < 0 || n >= d.vars.length) throw new AmosError(DIALOG_ERRORS[8]!)
      const v = d.vars[n]!
      return VS(typeof v === 'string' ? v : '')
    },
    edialog(_, a) {
      // FnEDialog +Lib.s:14391: position of the last dialog error
      void a
      return VI(rt.dialogErrPos)
    },
    'fsel$'(it, a) {
      // FnFileSelector1..4 +Lib.s:6778 → Dsk.FileSelector: the selector is
      // the default resource bank's dialog program 2 driven natively;
      // blocks until OK/Cancel, "" on cancel
      if (rt.fsel) {
        if (rt.fsel.done) {
          const r = rt.fsel.result
          rt.fsel = null
          return VS(r)
        }
        it.block({ type: 'fsel' }, true)
        return VS('')
      }
      const path = a.length >= 1 ? str(a[0]!) : ''
      const def = a.length >= 2 ? str(a[1]!) : ''
      const t1 = a.length >= 3 ? str(a[2]!) : ''
      const t2 = a.length >= 4 ? str(a[3]!) : ''
      if (!rt.startFsel(path, def, t1, t2)) return VS('') // no system bank/vfs
      it.block({ type: 'fsel' }, true)
      return VS('')
    },
    rdialog(_, a) {
      // FnRDialog2/3 +Lib.s:14588 → Dia_GetValue: a zone's numeric result
      // (string-valued zones read as 0)
      const v = rdialogValue(rt, a)
      return VI(v.s === null ? v.n : 0)
    },
    'rdialog$'(_, a) {
      const v = rdialogValue(rt, a)
      return VS(v.s ?? '')
    },
    zdialog(_, a) {
      // FnZDialog +Lib.s:14632 → Dia_GetZ: zone number at screen x,y
      const d = rt.dialogs.get(int(a[0]!))
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      const z = dialogZoneAt(d, int(a[1]!), int(a[2]!))
      return VI(z ? z.number : -1)
    },
    'resource$'(_, a) {
      // FnResource +ILib.s:6699: n>0 = message n of the puzzle bank; 0 =
      // the system path; negative = system/editor message tables (not
      // carried by the port — empty string)
      const n = int(a[0]!)
      if (n > 0) {
        const msgs = rt.resource().messages
        return VS(msgs?.[n - 1] ?? '')
      }
      if (n === 0) return VS('AMOSPro:')
      return VS('')
    },

    at(_, a) {
      // At(x,y) builds the locate escape the console interprets; elided
      // coordinates leave that axis alone
      let out = ''
      const x = int(a[0]!)
      const y = int(a[1]!)
      if (x >= 0) out += '\x1bX' + String.fromCharCode(48 + x)
      if (y >= 0) out += '\x1bY' + String.fromCharCode(48 + y)
      return VS(out)
    },

    // ---- flips, memory, conversions ----
    hrev(_, a) {
      return VI(int(a[0]!) | 0x8000) // flip flag consumed by image()
    },
    vrev(_, a) {
      return VI(int(a[0]!) | 0x4000)
    },
    start(_, a) {
      const n = int(a[0]!)
      if (!rt.memBanks.has(n)) throw new AmosError('bank not reserved')
      return VI(rt.bankBase(n))
    },
    peek(_, a) {
      const m = rt.resolveAddr(int(a[0]!))
      return VI(m ? m.data[m.off]! : 0)
    },
    deek(_, a) {
      const m = rt.resolveAddr(int(a[0]!))
      return VI(m && m.off + 1 < m.data.length ? (m.data[m.off]! << 8) | m.data[m.off + 1]! : 0)
    },
    leek(_, a) {
      const m = rt.resolveAddr(int(a[0]!))
      if (!m || m.off + 3 >= m.data.length) return VI(0)
      return VI(((m.data[m.off]! << 24) | (m.data[m.off + 1]! << 16) | (m.data[m.off + 2]! << 8) | m.data[m.off + 3]!) | 0)
    },
    'peek$'(_, a) {
      const m = rt.resolveAddr(int(a[0]!))
      if (!m) return VS('')
      const len = int(a[1]!)
      const stop = a.length > 2 ? str(a[2]!).charCodeAt(0) : -1
      let out = ''
      for (let i = 0; i < len && m.off + i < m.data.length; i++) {
        const b = m.data[m.off + i]!
        if (b === stop) break
        out += String.fromCharCode(b)
      }
      return VS(out)
    },
    btst(_, a) {
      return VI(int(a[1]!) & (1 << (int(a[0]!) & 31)) ? -1 : 0)
    },
    'x text'(_, a) {
      const x = int(a[0]!) >> 3
      return VI(x >= 0 && x < scr().width >> 3 ? x : -1)
    },
    'y text'(_, a) {
      const y = int(a[0]!) >> 3
      return VI(y >= 0 && y < scr().height >> 3 ? y : -1)
    },
    'x graphic'(_, a) {
      return VI(int(a[0]!) * 8)
    },
    'y graphic'(_, a) {
      return VI(int(a[0]!) * 8)
    },
    'mouse screen'(it, a) {
      void a
      for (let i = rt.order.length - 1; i >= 0; i--) {
        const s = rt.screens.get(rt.order[i]!)
        if (!s || !s.visible) continue
        const sx = (it.inp.mouseX - s.displayX) * (s.hires ? 2 : 1)
        const sy = it.inp.mouseY - s.displayY
        if (sx >= 0 && sy >= 0 && sx < s.width && sy < s.height) return VI(s.index)
      }
      return VI(-1)
    },
    scanshift(it, a) {
      void a
      let m2 = 0
      if (it.inp.keys.has(0x60)) m2 |= 1
      if (it.inp.keys.has(0x61)) m2 |= 2
      return VI(m2)
    },
    'pen$'(_, a) {
      return VS('\x1bP' + String.fromCharCode(48 + int(a[0]!)))
    },
    'paper$'(_, a) {
      return VS('\x1bB' + String.fromCharCode(48 + int(a[0]!)))
    },
    'cmove$'(_, a) {
      const x = a.length > 0 ? int(a[0]!) : 0
      const y = a.length > 1 ? int(a[1]!) : 0
      return VS('\x1bO' + String.fromCharCode(128 + x) + '\x1bN' + String.fromCharCode(128 + y))
    },
    'border$'(_, a) {
      void int(a[1] ?? a[0]!)
      return VS(str(a[0]!)) // TODO: border boxes around zone text
    },
  }

  function nextDirEntry(): string {
    const it2 = rt.dirIter
    if (!it2 || it2.idx >= it2.entries.length) return ''
    const e = it2.entries[it2.idx++]!
    return e.isDir ? '*' + e.name : e.name
  }
}
