import { AmosError, VI, VS, int, str } from '../interp/values'
import type { Instr, Func } from '../interp/builtins'
import type { Runtime } from './runtime'
import { Screen } from './screen'

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
      optInt(it, 0) // logical == physical until the double-buffer milestone
    },
    'double buffer': () => {},
    autoback(it) {
      it.evalInt()
    },
    'screen copy'(it) {
      const src = byIndex(it.evalInt())
      let x1 = 0
      let y1 = 0
      let x2 = src.width
      let y2 = src.height
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
      const dst = byIndex(it.evalInt())
      let dx = 0
      let dy = 0
      if (it.accept(',')) {
        dx = it.evalInt()
        it.expect(',')
        dy = it.evalInt()
        // optional blitter mode
        if (it.accept(',')) it.evalInt()
      }
      Screen.copy(src, x1, y1, x2, y2, dst, dx, dy)
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
      scr().ink = it.evalInt()
      while (it.accept(',')) optInt(it, 0) // pattern / border — later
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
      const [x, y] = pair(it)
      if (it.accept(',')) it.evalInt() // border mode — later
      scr().paint(x, y)
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
      it.evalInt() // border colour — no border in our composite yet
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
      if (it.accept(',')) it.evalInt() // mask — later
      scr().palette.set(src.palette)
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
    fade(it) {
      it.evalInt() // speed — instant for now
      const s = scr()
      let i = 0
      let any = false
      while (it.accept(',')) {
        const v = it.atStmtEnd() || it.nm() === ',' ? -1 : it.evalInt()
        if (v >= 0 && i < 32) s.palette[i] = v & 0xfff
        any = true
        i++
      }
      if (!any) s.palette.fill(0)
    },
    'flash off': () => {},
    flash(it) {
      it.skipToStmtEnd() // cursor flash sequences — cosmetic
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
    cline(it) {
      const s = scr()
      const n = it.atStmtEnd() ? s.cols - s.curX : it.evalInt()
      s.bar(s.curX * 8, s.curY * 8, (s.curX + n) * 8 - 1, s.curY * 8 + 7, s.paper)
    },
    'curs pen'(it) {
      it.evalInt()
    },
    writing(it) {
      scr().writing = it.evalInt()
      if (it.accept(',')) it.evalInt()
    },
    'gr writing'(it) {
      it.evalInt()
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
    'text length'(_, a) {
      return VI(str(a[0]!).length * 8)
    },
    'text base'() {
      return VI(6)
    },
    'cursor pen'() {
      return VI(scr().pen)
    },
    'zone$'(_, a) {
      void a
      return VS('')
    },
  }
}
