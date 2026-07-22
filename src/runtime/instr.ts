import { AmosError, VI, VS, int, str } from '../interp/values'
import type { Instr, Func } from '../interp/builtins'
import { parseAmosFile } from '../loader/amosfile'
import { parseIlbm } from '../loader/iff'
import { parsePacPic } from '../loader/pacpic'
import type { Runtime } from './runtime'
import { Screen } from './screen'
import { ObjectBank } from './objects'
import { AmalChannel, AmalCompileError, compileAmal } from './amal'
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
      if (it.atStmtEnd()) rt.bobs.clear()
      else rt.bobs.delete(it.evalInt())
    },
    'bob update'(it) {
      it.skipToStmtEnd() // autoback is implicit in our overlay model
    },
    'bob clear': () => {},
    'bob draw': () => {},
    'set bob'(it) {
      it.skipToStmtEnd() // background modes — overlay model keeps background
    },
    'limit bob'(it) {
      it.skipToStmtEnd()
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
      if (!it.atStmtEnd()) it.evalInt()
      const pal = rt.iconBank?.palette
      if (pal) for (let i = 0; i < Math.min(32, pal.length); i++) scr().palette[i] = pal[i]!
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
      const bank = rt.memBanks.get(it.evalInt())
      if (!bank) throw new AmosError('bank not reserved')
      const pic = parsePacPic(bank.data)
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

  function bankPalette(): Instr {
    return (it) => {
      if (!it.atStmtEnd()) it.evalInt() // mask — later
      const pal = rt.spriteBank?.palette
      if (pal) for (let i = 0; i < Math.min(32, pal.length); i++) scr().palette[i] = pal[i]!
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
  }
}
